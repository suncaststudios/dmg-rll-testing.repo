/* ═══════════════════════════════════════════════════════════════════
   ACCOUNT DELETION — server-side finisher
   ---------------------------------------------------------------------
   Client-side (auth.js / _prefDeleteFinal) already:
     1. re-authenticates the user with their password
     2. deletes their `profiles` row in Supabase (cascades to owned
        items etc via FK)
   That's the part a client CAN safely do. What it can't do is delete
   the Firebase Auth account itself — the client SDK has no permission
   to do that for security reasons (any signed-in user could otherwise
   delete arbitrary accounts). That needs the Admin SDK, which only
   runs here, server-side.

   This is a "callable" function: the client calls it with
   firebase.functions().httpsCallable('deleteAccount')(), and Firebase
   automatically attaches + verifies the caller's ID token for us —
   context.auth.uid is only ever the UID of whoever is actually signed
   in, never something the client can spoof.
   ═══════════════════════════════════════════════════════════════════ */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.deleteAccount = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'You must be signed in to delete your account.'
        );
    }

    const uid = context.auth.uid;

    try {
        await admin.auth().deleteUser(uid);
    } catch (e) {
        // If the user is already gone (e.g. retried after a partial
        // failure), treat that as success rather than erroring the client.
        if (e.code !== 'auth/user-not-found') {
            console.error('[deleteAccount] failed for uid', uid, e);
            throw new functions.https.HttpsError('internal', 'Could not delete account.');
        }
    }

    return { success: true };
});

/* ═══════════════════════════════════════════════════════════════════
   FIREBASE → SUPABASE ROLE CLAIM
   ---------------------------------------------------------------------
   Required for the Firebase third-party-auth bridge (see js/supabase.js
   and firebase-auth.js) to actually work. Supabase inspects the `role`
   claim in any JWT it's asked to trust to decide which Postgres role to
   run the request as — Firebase doesn't set this claim on its own, so
   without it every request would still resolve as `anon`, not
   `authenticated`, even once the token itself verifies correctly. RLS
   policies that check auth.uid() would keep failing exactly as before.

   This runs on every new signup and sets that claim going forward.
   Existing users (signed up before this was added) won't have it until
   the one-time backfill script below has been run once — see the
   comment underneath this function.
   ═══════════════════════════════════════════════════════════════════ */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    try {
        await admin.auth().setCustomUserClaims(user.uid, { role: 'authenticated' });
    } catch (e) {
        console.error('[onUserCreate] failed to set role claim for', user.uid, e);
    }
});

/* ── One-time backfill for accounts created before onUserCreate existed ──
   Run this once, locally, with the Admin SDK service account credentials
   (NOT as a deployed function — it's a maintenance script):

     node -e "
     const { initializeApp } = require('firebase-admin/app');
     const { getAuth } = require('firebase-admin/auth');
     initializeApp();
     (async () => {
       let nextPageToken;
       do {
         const page = await getAuth().listUsers(1000, nextPageToken);
         nextPageToken = page.pageToken;
         await Promise.all(page.users.map(u =>
           getAuth().setCustomUserClaims(u.uid, { role: 'authenticated' })
             .catch(e => console.error('failed for', u.uid, e))
         ));
       } while (nextPageToken);
       console.log('done');
     })();
     "

   Every existing player needs to log out and back in (or just wait for
   their token's normal ~1hr refresh) afterward to pick up the new claim
   — a token already issued before the backfill won't retroactively
   gain it.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Note on syncing new signups to Supabase ─────────────────────────
   No server-side trigger needed here: js/auth.js already upserts the
   profile row client-side right after Firebase signUp succeeds, using
   whichever regional Supabase client the player is connected to. A
   `profiles` RLS policy of `auth.uid() = id` is what makes that safe —
   but only because js/supabase.js now bridges the client's Firebase ID
   token into every Supabase request (see the `accessToken` callback
   there), and the corresponding Firebase third-party-auth provider is
   configured in each Supabase project's dashboard. Without that bridge,
   auth.uid() has no way to know who's logged in (Supabase never issues
   its own session here) and is always null, silently failing this
   exact policy check. Adding a service-role trigger here instead would
   mean holding 4 full-database-access keys for no real security gain,
   so it's intentionally left out in favor of the bridge.
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   CLUB MODERATION — server-side authority
   ---------------------------------------------------------------------
   Every one of these actions writes to ANOTHER member's profiles/{uid}
   document (their club_role, club_id, or club_mute_until) or to the
   club document's banned map. Firestore security rules only let a user
   write their own profile doc (auth.uid() == uid) — there is no rule
   that could safely let "whoever happens to be club president" write
   arbitrary fields on arbitrary other users' documents from the client,
   since the client's own claim to be president is just JS state, easy
   to fake by editing the page. That's exactly the client-side call
   failing with "Missing or insufficient permissions" (js/clubs.js used
   to call fsSet directly for all of these).

   Every function below re-derives the caller's role from Firestore
   itself — never trusts a role the client claims to have — and only
   then performs the write with the Admin SDK, which isn't subject to
   security rules at all. This is also what closes the "client-side-only
   permission check" gap flagged earlier: even a modified client can no
   longer kick/ban/mute/reassign roles without actually holding that
   role server-side.
   ═══════════════════════════════════════════════════════════════════ */

const CLUB_ROLE_RANK = { member: 0, officer: 1, vp: 2, president: 3 };

function _requireAuth(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    return context.auth.uid;
}

async function _getClub(clubId) {
    const snap = await admin.firestore().collection('clubs').doc(clubId).get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Club not found.');
    return { id: snap.id, ...snap.data() };
}

async function _deriveRole(club, uid) {
    if (club.owner_id === uid) return 'president';
    const snap = await admin.firestore().collection('profiles').doc(uid).get();
    return snap.exists ? (snap.data().club_role || 'member') : 'member';
}

function _canKick(role)  { return role === 'president' || role === 'vp'; }
function _canBan(role)   { return role === 'president'; }
function _canMute(role)  { return role === 'president' || role === 'vp' || role === 'officer'; }
function _canAssignRole(myRole, targetRole, newRole) {
    if (myRole === 'president') return targetRole !== 'president' && newRole !== 'president';
    if (myRole === 'vp') {
        return (targetRole === 'member' || targetRole === 'officer')
            && (newRole === 'member' || newRole === 'officer');
    }
    return false;
}
function _deny(msg) { throw new functions.https.HttpsError('permission-denied', msg || "You don't have permission to do that."); }

exports.clubSetRole = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid, newRole } = data || {};
    if (!clubId || !targetUid || !newRole) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId, targetUid, or newRole.');
    if (!(newRole in CLUB_ROLE_RANK)) throw new functions.https.HttpsError('invalid-argument', 'Invalid role.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    const targetRole = await _deriveRole(club, targetUid);
    if (!_canAssignRole(myRole, targetRole, newRole)) _deny();

    await admin.firestore().collection('profiles').doc(targetUid)
        .set({ club_role: newRole === 'member' ? null : newRole }, { merge: true });
    return { success: true };
});

exports.clubKick = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid } = data || {};
    if (!clubId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId or targetUid.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (!_canKick(myRole)) _deny();
    if (targetUid === club.owner_id) _deny("The president can't be kicked.");

    await admin.firestore().collection('profiles').doc(targetUid)
        .set({ club_id: null, club_role: null }, { merge: true });
    return { success: true };
});

exports.clubBan = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid, hours } = data || {}; // hours: number, or null/undefined for permanent
    if (!clubId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId or targetUid.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (!_canBan(myRole)) _deny();
    if (targetUid === club.owner_id) _deny("The president can't be banned.");

    const maxHours = club.max_ban_hours || null;
    const requestedHours = (typeof hours === 'number' && hours > 0) ? hours : null;
    const cappedHours = (requestedHours !== null && maxHours) ? Math.min(requestedHours, maxHours) : requestedHours;
    const until = cappedHours === null ? null : Date.now() + cappedHours * 3600000;

    const banned = { ...(club.banned || {}) };
    banned[targetUid] = { until, by: uid, at: Date.now() };

    await admin.firestore().collection('clubs').doc(clubId).set({ banned }, { merge: true });
    await admin.firestore().collection('profiles').doc(targetUid)
        .set({ club_id: null, club_role: null }, { merge: true });
    return { success: true };
});

exports.clubUnban = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid } = data || {};
    if (!clubId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId or targetUid.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (!_canBan(myRole)) _deny();

    const banned = { ...(club.banned || {}) };
    delete banned[targetUid];
    await admin.firestore().collection('clubs').doc(clubId).set({ banned }, { merge: true });
    return { success: true };
});

exports.clubMute = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid, minutes } = data || {};
    if (!clubId || !targetUid || !minutes) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId, targetUid, or minutes.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (!_canMute(myRole)) _deny();
    if (targetUid === club.owner_id) _deny("The president can't be muted.");

    const maxMin = Math.round((club.max_mute_seconds || 86400) / 60);
    const cappedMin = Math.max(1, Math.min(maxMin, minutes));
    const until = Date.now() + cappedMin * 60000;

    await admin.firestore().collection('profiles').doc(targetUid)
        .set({ club_mute_until: until }, { merge: true });
    return { success: true, minutes: cappedMin };
});

exports.clubUnmute = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid } = data || {};
    if (!clubId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId or targetUid.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (!_canMute(myRole)) _deny();

    await admin.firestore().collection('profiles').doc(targetUid)
        .set({ club_mute_until: null }, { merge: true });
    return { success: true };
});

exports.clubTransferPresidency = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId, targetUid } = data || {};
    if (!clubId || !targetUid) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId or targetUid.');

    const club = await _getClub(clubId);
    const myRole = await _deriveRole(club, uid);
    if (myRole !== 'president') _deny('Only the president can transfer presidency.');
    if (targetUid === uid) _deny("You're already president.");

    await admin.firestore().collection('clubs').doc(clubId).set({ owner_id: targetUid }, { merge: true });
    await admin.firestore().collection('profiles').doc(targetUid).set({ club_role: null }, { merge: true }); // new president — role derives from owner_id
    await admin.firestore().collection('profiles').doc(uid).set({ club_role: 'vp' }, { merge: true }); // outgoing president becomes VP
    return { success: true };
});

exports.clubDisband = functions.https.onCall(async (data, context) => {
    const uid = _requireAuth(context);
    const { clubId } = data || {};
    if (!clubId) throw new functions.https.HttpsError('invalid-argument', 'Missing clubId.');

    const club = await _getClub(clubId);
    if (club.owner_id !== uid) _deny('Only the president can disband the club.');

    // Firestore has no FK cascade — every member pointing at this club
    // (club_id + club_role + any active mute) needs clearing explicitly,
    // or they're left referencing a club document that's about to not
    // exist. Doing this here (admin-privileged, single server-side call)
    // is also what makes it atomic-in-practice from the client's view —
    // the previous client-side version could delete the club doc (which
    // the owner IS allowed to do directly) while the per-member profile
    // clears silently failed one by one on permission-denied, leaving
    // other members' profiles still pointing at a deleted club.
    const membersSnap = await admin.firestore().collection('profiles').where('club_id', '==', clubId).get();
    const batch = admin.firestore().batch();
    membersSnap.forEach(doc => {
        batch.set(doc.ref, { club_id: null, club_role: null, club_mute_until: null }, { merge: true });
    });
    batch.delete(admin.firestore().collection('clubs').doc(clubId));
    await batch.commit();

    return { success: true };
});

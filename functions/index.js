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


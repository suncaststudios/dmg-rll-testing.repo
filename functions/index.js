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

/* ── Note on syncing new signups to Supabase ─────────────────────────
   No server-side trigger needed here: js/auth.js already upserts the
   profile row client-side right after Firebase signUp succeeds, using
   whichever regional Supabase client the player is connected to. A
   `profiles` RLS policy of `auth.uid() = id` is what actually makes
   that safe — not a server-side step. Adding a service-role trigger
   here would mean holding 4 full-database-access keys for no real
   security gain, so it's intentionally left out.
   ═══════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════════
   FIREBASE AUTH ADAPTER
   ---------------------------------------------------------------------
   auth.js was written against the Supabase Auth API shape
   ({ data, error } returns, sb.auth.signInWithPassword, etc). Rather
   than rewrite all 670+ lines of screen/state control flow, this file
   exposes window._fbAuth with the SAME method names and return shapes,
   backed by Firebase Auth underneath. auth.js was updated to call
   window._fbAuth instead of window._supabase for identity operations;
   .from(...) calls (profile data) still go to the real Supabase client
   via _fbAuth.from(), which just forwards to window._supabase.from().

   ⚠️ CONFIG REQUIRED: paste your Firebase project's config below
   (Firebase console → Project settings → General → Your apps → SDK
   setup and configuration → "Config").

   ⚠️ KNOWN GAPS from this migration (not silently glossed over):
   - Discord login: Firebase Auth has no built-in Discord provider
     (unlike Supabase). Discord login is currently DISABLED — the
     button is hidden — until Discord is registered as a custom OIDC
     provider in Firebase (requires Identity Platform, a paid upgrade,
     plus Discord's own OAuth app config). _authDiscord() is stubbed
     to show a "not available yet" message instead of silently failing.
   - MFA (TOTP): Firebase's free tier only supports SMS-based 2FA, not
     TOTP authenticator apps like Supabase did. The TOTP enroll/verify
     UI has been left in place but disabled with a clear message,
     rather than pretending it still works.
   - Account deletion: finished. auth.js deletes the Supabase profile
     row client-side (after re-auth), then calls the deleteAccount
     Cloud Function below (see /functions/index.js) to remove the
     actual Firebase Auth user server-side — client SDKs deliberately
     can't do that themselves for security reasons.
   ═══════════════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAyIEiWkalpZUnHJ9PIGxaOtT7kRiEVoIc",
    authDomain:        "damage-roll.firebaseapp.com",
    projectId:         "damage-roll",
    storageBucket:     "damage-roll.firebasestorage.app",
    messagingSenderId: "717309251273",
    appId:             "1:717309251273:web:2a829fd8c88c242c858718",
};

let _fbApp = null, _fbAuthInstance = null;
function _fbInit() {
    if (_fbApp) return;
    if (typeof firebase === 'undefined') {
        console.error('[DR Auth] Firebase SDK not loaded — check the <script> tags in index.html');
        return;
    }
    _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    _fbAuthInstance = firebase.auth();
    _fbAuthInstance.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
}

/* ── Firebase → Supabase identity bridge ──────────────────────────────
   Every existing Supabase RLS policy in this codebase (profiles, clubs,
   club_tournaments — see the "create policy" comments in clubs.js) was
   written assuming auth.uid() reflects whoever is logged in. It never
   did, because the client only ever logs into Firebase — Supabase never
   received a session of its own, so auth.uid() was permanently null and
   every one of those policies silently rejected every write.

   supabase-js v2 supports exactly this scenario via a third-party auth
   `accessToken` callback passed to createClient() (see js/supabase.js):
   Supabase can be configured (dashboard-side, once per project — see the
   note in supabase.js) to trust and verify Firebase-issued ID tokens
   directly, populating auth.uid() from the token's `sub` claim (the
   Firebase UID) with no Supabase login step ever needed. This function
   is what supplies that token on every request.

   Exposed on window (not just a module-local variable) because
   supabase.js is a `type="module"` script with its own separate scope —
   it can't see plain top-level `let`/`const` from this classic script. */
window._fbGetAccessToken = async function () {
    _fbInit();
    const user = _fbAuthInstance?.currentUser;
    if (!user) return null;
    try { return await user.getIdToken(); }
    catch (e) { console.warn('[DR Auth] getIdToken failed', e); return null; }
};

function _fbErrShape(e) {
    // Map Firebase's error.code to a plain message, Supabase-shape-compatible
    const map = {
        'auth/invalid-email':          'Invalid email address.',
        'auth/user-disabled':          'This account has been disabled.',
        'auth/user-not-found':         'No account found with that email.',
        'auth/wrong-password':         'Incorrect password.',
        'auth/email-already-in-use':   'An account with that email already exists.',
        'auth/weak-password':          'Password is too weak (minimum 6 characters).',
        'auth/invalid-credential':     'Incorrect email or password.',
        'auth/too-many-requests':      'Too many attempts — try again in a moment.',
        'auth/network-request-failed': 'Connection error — try again.',
    };
    return { message: map[e?.code] || e?.message || 'Something went wrong.' };
}

window._fbAuth = {
    /* ── Profile data still goes straight to the real Supabase client ── */
    /* Every call through here is a 'profiles' operation (see auth.js) —
       identity data, so it always goes to the home region regardless of
       which region the player picked for matchmaking. Falls back to the
       region-switchable client only if the home client somehow isn't up
       yet, so this never hard-fails during early page load. */
    from: (...args) => (window._supabaseHome || window._supabase).from(...args),

    auth: {
        signInWithPassword: async ({ email, password }) => {
            _fbInit();
            try {
                const cred = await _fbAuthInstance.signInWithEmailAndPassword(email, password);
                return { data: { user: cred.user, session: { user: cred.user } }, error: null };
            } catch (e) { return { data: null, error: _fbErrShape(e) }; }
        },

        signUp: async ({ email, password }) => {
            _fbInit();
            try {
                const cred = await _fbAuthInstance.createUserWithEmailAndPassword(email, password);
                return { data: { user: cred.user, session: { user: cred.user } }, error: null };
            } catch (e) { return { data: null, error: _fbErrShape(e) }; }
        },

        signOut: async () => {
            _fbInit();
            try { await _fbAuthInstance.signOut(); return { error: null }; }
            catch (e) { return { error: _fbErrShape(e) }; }
        },

        getSession: async () => {
            _fbInit();
            // Firebase's auth state is async on load — wait for the first
            // resolution instead of reading currentUser synchronously (which
            // is often null for a moment right after page load).
            const user = await new Promise(resolve => {
                const unsub = _fbAuthInstance.onAuthStateChanged(u => { unsub(); resolve(u); });
            });
            return { data: { session: user ? { user } : null } };
        },

        getUser: async () => {
            _fbInit();
            return { data: { user: _fbAuthInstance.currentUser } };
        },

        sendPasswordResetEmail: async (email) => {
            _fbInit();
            try { await _fbAuthInstance.sendPasswordResetEmail(email); return { error: null }; }
            catch (e) { return { error: _fbErrShape(e) }; }
        },

        // Calls the deleteAccount Cloud Function (see /functions/index.js).
        // Requires firebase-functions-compat.js to be included in index.html.
        deleteAccount: async () => {
            _fbInit();
            try {
                if (typeof firebase.functions !== 'function') {
                    return { error: { message: 'Account deletion isn\'t available right now — missing SDK.' } };
                }
                const call = firebase.functions().httpsCallable('deleteAccount');
                await call();
                return { error: null };
            } catch (e) { return { error: _fbErrShape(e) }; }
        },

        // Discord OAuth is not available — see the gap notice at the top of this file.
        signInWithOAuth: async () => ({ error: { message: 'Discord login isn\'t available yet on this account system.' } }),

        // TOTP MFA is not available on Firebase's free tier — see gap notice above.
        mfa: {
            enroll:      async () => ({ data: null, error: { message: 'Two-factor setup isn\'t available yet.' } }),
            listFactors: async () => ({ data: { totp: [] } }),
            unenroll:    async () => ({ error: null }),
            challenge:   async () => ({ data: null, error: { message: 'Two-factor isn\'t available yet.' } }),
            verify:      async () => ({ error: { message: 'Two-factor isn\'t available yet.' } }),
        },
    },
};

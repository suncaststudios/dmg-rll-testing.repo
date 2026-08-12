    // ─── CONFIG — one entry per region. Only "us-east" is a real, configured
    // project right now; the rest are placeholders until you spin up copies
    // of the schema in other regions. Paste each project's URL + anon key in
    // to bring it online — the settings dropdown auto-hides any region whose
    // url still starts with "PASTE_". ───────────────────────────────────────
    const SUPABASE_SERVERS = {
        'us-east': { label: 'US East',      url: 'https://dwfxqlbcardvexqrrrgn.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3ZnhxbGJjYXJkdmV4cXJycmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTg5MjMsImV4cCI6MjEwMDg3NDkyM30.kb-iUIYSNKIRO5V7qgV2Rv77-C8qeke4-jD0GjRkWQY' },
        'us-west': { label: 'US West',      url: 'https://svbilajztkfthuwidcqi.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2YmlsYWp6dGtmdGh1d2lkY3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTA4MTksImV4cCI6MjEwMDg2NjgxOX0.fKICu5-pHMhHlqbaWnxesZCUgnm6VOui8c8Hl4HABxU' },
        'eu':      { label: 'EU Central',   url: 'https://wegbiravtjyekjaaxnop.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlZ2JpcmF2dGp5ZWtqYWF4bm9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyODY4NTYsImV4cCI6MjEwMDg2Mjg1Nn0.tKalxwrNvuh69CV4hCe9TlH-zv6XsFHn-QeRU96bNOM' },
        'asia':    { label: 'AP Southeast', url: 'https://ndmfenkgsnvcxzdcibss.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kbWZlbmtnc252Y3h6ZGNpYnNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTc3NjksImV4cCI6MjEwMDg3Mzc2OX0.A92Ecyk9c63RPYqe9B_WbsIT3z53K1xVbXOc-fSAisc' },
    };
    const DEFAULT_SERVER_REGION = 'us-east';
    // The "home" region — where identity/progression data always lives,
    // regardless of which region the player has picked for matchmaking.
    // See the big comment block below for why this split exists.
    const HOME_REGION = 'us-east';

    function _isConfigured(region) {
        const s = SUPABASE_SERVERS[region];
        return !!s && !s.url.startsWith('PASTE_') && !s.key.startsWith('PASTE_');
    }

    function _pickServerRegion() {
        let saved = null;
        try { saved = localStorage.getItem('dr_server_region'); } catch (e) {}
        return (saved && _isConfigured(saved)) ? saved : DEFAULT_SERVER_REGION;
    }

    const _activeRegion = _pickServerRegion();
    const SUPABASE_URL = SUPABASE_SERVERS[_activeRegion].url;
    const SUPABASE_KEY = SUPABASE_SERVERS[_activeRegion].key;

    // Exposed so the Settings screen can build the region dropdown and know
    // which region is currently active, without duplicating this list.
    window._supabaseServers = SUPABASE_SERVERS;
    window._supabaseActiveRegion = _activeRegion;

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    /* ── Identity bridge: trust Firebase logins for RLS ────────────────
       Login happens exclusively through Firebase (see firebase-auth.js);
       Supabase never gets a login of its own. Every RLS policy in this
       codebase that checks auth.uid() (profiles, clubs, club_tournaments)
       was written assuming Supabase's own auth.uid() would reflect the
       logged-in user — without this, that's permanently null and those
       policies reject every write, no matter how legitimate.

       supabase-js v2's `accessToken` option lets a request carry a
       caller-supplied bearer token instead of Supabase's own session —
       here, the current Firebase ID token. Supabase verifies that token
       itself (Firebase's public keys, standard JWT signature check) and
       populates auth.uid() from it — no Supabase login step, no service
       key, no custom server code, and every existing auth.uid()-based
       policy in the dashboard starts working exactly as originally
       written.

       ⚠️ ONE-TIME DASHBOARD STEP REQUIRED (per Supabase project/region):
       Supabase → Authentication → Sign In / Providers → Third Party Auth
       → Add provider → Firebase → paste this project's Firebase Project
       ID ("damage-roll", from FIREBASE_CONFIG in firebase-auth.js).
       Until that's done here, this callback has no effect — the token
       gets sent, but Supabase won't yet recognize this project as a
       trusted issuer, so auth.uid() stays null and it fails exactly like
       before. This needs to be repeated for every region actually put
       into use (only "us-east" is a real project right now). */
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
        accessToken: async () => {
            try {
                return (typeof window._fbGetAccessToken === 'function')
                    ? await window._fbGetAccessToken()
                    : null;
            } catch (e) { return null; }
        },
    });
    window._supabase = sb;

    /* ── Home client: identity/progression, pinned to one region ──────────
       window._supabase above follows whatever region the player picks for
       matchmaking (Settings → Offline/Bot... → Server Region) — right for
       online_rooms/match_queue/lobby_rooms, which genuinely benefit from
       being close to the player, but wrong for everything else. Each
       region is a fully separate Supabase project with its own database
       and zero replication between them, so a player who switches regions
       would otherwise have their profile, XP, wins, clubs, and shop
       inventory silently vanish — the new region's database has simply
       never seen their uid before, and they'd look like a brand new
       account rather than "the same account, elsewhere."
       Weekly tournaments and shop popularity are deliberately kept on the
       region-switchable client instead (per-region leaderboards/trends
       are the intended behavior there, not a bug) — everything else that
       reads/writes 'profiles', 'clubs', 'club_tournaments', 'shop_owned',
       or 'quest_claims' should use this client instead so that data stays
       put regardless of which region is active for matchmaking. */
    const sbHome = (_activeRegion === HOME_REGION) ? sb : createClient(
        SUPABASE_SERVERS[HOME_REGION].url,
        SUPABASE_SERVERS[HOME_REGION].key,
        {
            accessToken: async () => {
                try {
                    return (typeof window._fbGetAccessToken === 'function')
                        ? await window._fbGetAccessToken()
                        : null;
                } catch (e) { return null; }
            },
        }
    );
    window._supabaseHome = sbHome;

    /* ── _db: thin wrapper so the rest of the game code is unchanged ──────────
       Rooms and matchmaking use the Supabase `online_rooms` / `match_queue`
       tables (one write to signal presence, then cleaned up after).
       Live move sync uses Supabase Realtime BROADCAST — no DB writes at all.
    ─────────────────────────────────────────────────────────────────────────── */

    // Parse a Firebase-style path like "onlineRooms/ABC123" or "matchQueue/uid"
    function _parsePath(path) {
        const parts = path.split('/');
        return { table: parts[0], id: parts[1] || null, field: parts[2] || null };
    }

    window._db = {

        // Read a row. Returns { data, error } — data is the row object or null.
        get: async (path) => {
            const { table, id } = _parsePath(path);
            const tbl = table === 'onlineRooms' ? 'online_rooms' : 'match_queue';
            const col = table === 'onlineRooms' ? 'code'         : 'uid';
            if (!id) {
                // Fetch entire table (used by matchmaking queue scan)
                const { data, error } = await sb.from(tbl).select('*');
                if (error) return { data: null, error };
                // Return as an object keyed by id, matching the old Firebase shape
                const obj = {};
                data.forEach(row => { obj[row[col]] = row; });
                return { data: Object.keys(obj).length ? obj : null, error: null };
            }
            const { data, error } = await sb.from(tbl).select('*').eq(col, id).maybeSingle();
            return { data, error };
        },

        // Insert or overwrite a row.
        set: async (path, value) => {
            const { table, id } = _parsePath(path);
            const tbl = table === 'onlineRooms' ? 'online_rooms' : 'match_queue';
            const col = table === 'onlineRooms' ? 'code'         : 'uid';
            const row = { [col]: id, ...value };
            const { error } = await sb.from(tbl).upsert(row, { onConflict: col });
            return { error };
        },

        // Merge fields into an existing row.
        update: async (path, value) => {
            const { table, id, field } = _parsePath(path);
            const tbl = table === 'onlineRooms' ? 'online_rooms' : 'match_queue';
            const col = table === 'onlineRooms' ? 'code'         : 'uid';
            // If path targets a sub-field (e.g. onlineRooms/ABC/move), wrap it
            const payload = field ? { [field]: value } : value;
            const { error } = await sb.from(tbl).update(payload).eq(col, id);
            return { error };
        },

        // Delete a row.
        remove: async (path) => {
            const { table, id } = _parsePath(path);
            const tbl = table === 'onlineRooms' ? 'online_rooms' : 'match_queue';
            const col = table === 'onlineRooms' ? 'code'         : 'uid';
            const { error } = await sb.from(tbl).delete().eq(col, id);
            return { error };
        },

        // Subscribe to row changes via Postgres CDC.
        // Returns an unsubscribe function, matching the old Firebase shape.
        sub: (path, cb) => {
            const { table, id } = _parsePath(path);
            const tbl = table === 'onlineRooms' ? 'online_rooms' : 'match_queue';
            const col = table === 'onlineRooms' ? 'code'         : 'uid';
            const channelName = `db-${tbl}-${id}-${Date.now()}`;
            const channel = sb.channel(channelName)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: tbl, filter: `${col}=eq.${id}` },
                    payload => cb({ data: payload.new })
                )
                .subscribe();
            return () => sb.removeChannel(channel);
        },

        // ── Broadcast: zero-DB live move sync ──────────────────────────────────
        // Returns a { send(payload), unsub() } handle.
        broadcast: (roomCode) => {
            const channel = sb.channel(`game-${roomCode}`, {
                config: { broadcast: { self: false } }
            });
            channel.subscribe();
            return {
                send: (payload) => channel.send({ type: 'broadcast', event: 'move', payload }),
                on:   (cb)      => { channel.on('broadcast', { event: 'move' }, ({ payload }) => cb(payload)); },
                unsub: ()       => sb.removeChannel(channel),
            };
        },
    };

    window._dbReady = true;
    if (typeof window._onDbReady === 'function') window._onDbReady();

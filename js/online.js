/* ONLINE MULTIPLAYER SYSTEM
   Backend: Supabase (Postgres + Realtime)

   Supabase tables required:
     online_rooms  — room signaling (created/joined/cleaned up)
     match_queue   — matchmaking queue entries

   SQL to run in Supabase SQL Editor:
   ─────────────────────────────────────────────────────────────────────
   create table online_rooms (
     code        text primary key,
     host        text,
     host_name   text,
     guest       text,
     guest_name  text,
     status      text default 'waiting',
     seed        bigint,
     created_at  timestamptz default now()
   );
   create table match_queue (
     uid         text primary key,
     name        text,
     room_code   text,
     joined_at   bigint
   );
   -- Enable realtime on both tables (Supabase dashboard → Database → Replication)
   alter publication supabase_realtime add table online_rooms;
   alter publication supabase_realtime add table match_queue;
   -- RLS: allow anonymous reads/writes (tighten once you have auth)
   alter table online_rooms  enable row level security;
   alter table match_queue   enable row level security;
   create policy "anon all" on online_rooms  for all using (true) with check (true);
   create policy "anon all" on match_queue   for all using (true) with check (true);
   ─────────────────────────────────────────────────────────────────────
   Game flow:
   • HOST creates room  → inserts row into online_rooms, waits via Realtime sub
   • GUEST joins by code → updates room row (guest + status='ready') → both start
   • Move sync uses Supabase Realtime BROADCAST (zero DB writes during gameplay)
   • Room row is deleted when game ends or is cancelled
═══════════════════════════════════════════════════════════════════════ */

let _onlineMode   = false;   // true when in an online game
let _onlineRole   = null;    // 'host' | 'guest'
let _onlineCode   = null;    // 6-char room code
let _onlineUid    = null;    // our identifier
let _onlineOppUid = null;    // opponent identifier
let _roomListener = null;    // Supabase realtime unsubscribe fn
let _mmListener   = null;    // matchmaking listener unsubscribe fn
let _mmQueueKey   = null;    // our key in the match_queue table
let _broadcastChannel = null; // Supabase broadcast channel for live moves

/* ── Generate a local UID for the session ── */
function _getOnlineUid() {
    if (_syncedCode) return _syncedCode;
    let uid = sessionStorage.getItem('dr_online_uid');
    if (!uid) { uid = Math.random().toString(36).slice(2,10).toUpperCase(); sessionStorage.setItem('dr_online_uid', uid); }
    return uid;
}

/* ── Generate a 6-char room code ── */
function _genRoomCode() {
    const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({length:6}, () => C[Math.floor(Math.random()*C.length)]).join('');
}

/* ── Get player display name ── */
function _getDisplayName() {
    return _profileData?.username || 'Wanderer';
}

/* ═══════════════════════════════════════════════════════════════════
   NOTE: the old room-create/room-join UI (openCreateRoom, _createRoom,
   copyRoomCode, cancelRoom, openJoinRoom, joinRoomByCode) that used to
   live here has been removed — it referenced DOM ids from a since-
   replaced UI (room-create-panel/room-join-panel/etc, none of which
   exist anymore) and an old window._db 'onlineRooms' path. The live
   private-room implementation is in lobby.js (menu-private-room-choice
   → menu-create-room-setup, backed by the 'lobby_rooms' table). It was
   silently shadowing this dead code purely because lobby.js loads
   after online.js in index.html — removing the dead copy here so that
   ordering isn't load-bearing. _genRoomCode() and _getDisplayName()
   above are still used by lobby.js and the matchmaking code below.
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════ MATCHMAKING ═══════════════════ */
function openMatchmaking() {
    if (!window._dbReady) { if(typeof _startScreenToast==='function') _startScreenToast('Connecting…'); return; }
    _onlineUid = _getOnlineUid();
    toggle('menu-start', false);
    toggle('menu-private-room-choice', false);
    toggle('menu-matchmaking', true);
    const statusEl = document.getElementById('mm-status-text');
    if (statusEl) statusEl.textContent = 'Searching for an opponent…';
    const queueEl = document.getElementById('mm-queue-info');
    if (queueEl) queueEl.textContent = '';
    const foundCard = document.getElementById('mm-found-card');
    if (foundCard) foundCard.classList.remove('show');
    const spinner = document.getElementById('mm-spinner');
    if (spinner) spinner.style.display = '';
    // Start elapsed timer
    clearInterval(window._mmElapsedTimer);
    let elapsed = 0;
    window._mmElapsedTimer = setInterval(() => {
        elapsed++;
        const el = document.getElementById('mm-elapsed');
        if (el) el.textContent = `Searching for ${elapsed}s…`;
    }, 1000);
    _enterMatchQueue();
}

async function _enterMatchQueue() {
    const f = window._db;
    if (!f) { document.getElementById('mm-status-text').textContent = 'Backend not ready — refresh and try again.'; return; }

    try {
        // Scan the queue for an available opponent
        const snap = await f.get('matchQueue');
        let foundMatch = false;
        if (snap && snap.data) {
            const queue = snap.data;
            for (const [key, entry] of Object.entries(queue)) {
                if (entry.uid === _onlineUid) continue;
                if (Date.now() - entry.joined_at > 60000) {
                    await f.remove('matchQueue/' + key);
                    continue;
                }
                // Found an opponent — join their room
                foundMatch = true;
                await f.remove('matchQueue/' + key);

                _onlineCode   = entry.room_code;
                _onlineRole   = 'guest';
                _onlineOppUid = entry.uid;

                document.getElementById('mm-status-text').textContent = 'Opponent found! Starting…';
                await f.update('onlineRooms/' + _onlineCode, {
                    guest:      _onlineUid,
                    guest_name: _getDisplayName(),
                    status:     'ready',
                });
                setTimeout(() => _startOnlineGame('guest', _onlineCode), 1200);
                break;
            }
        }

        if (!foundMatch) {
            // No one in queue — create a room and wait
            _onlineCode = _genRoomCode();
            _onlineRole = 'host';
            const seed = Math.floor(Math.random() * 999999);

            const { error: roomErr } = await f.set('onlineRooms/' + _onlineCode, {
                host: _onlineUid, host_name: _getDisplayName(),
                guest: null, guest_name: null,
                status: 'waiting', seed,
                // no "created" field — the table's created_at column has its
                // own DB-side default; sending an unknown column here made
                // every host-a-room upsert fail silently (error was never
                // checked below), leaving hosts waiting forever for nothing.
            });
            if (roomErr) {
                console.error('[DR Matchmaking] failed to create room:', roomErr.message);
                document.getElementById('mm-status-text').textContent = 'Could not create a match — try again.';
                return;
            }

            _mmQueueKey = _onlineUid;
            await f.set('matchQueue/' + _onlineUid, {
                uid:       _onlineUid,
                name:      _getDisplayName(),
                room_code: _onlineCode,
                joined_at: Date.now(),
            });

            let dotCount = 0;
            const dotInterval = setInterval(() => {
                dotCount = (dotCount + 1) % 4;
                document.getElementById('mm-status-text').textContent = 'Searching for an opponent' + '.'.repeat(dotCount + 1);
            }, 600);

            // Listen for someone joining our room
            _mmListener = f.sub('onlineRooms/' + _onlineCode, snap => {
                if (!snap || !snap.data) return;
                const room = snap.data;
                if (room.guest && room.status === 'ready') {
                    clearInterval(dotInterval);
                    _onlineOppUid = room.guest;
                    if (_mmListener) { _mmListener(); _mmListener = null; }
                    if (_mmQueueKey && window._db) {
                        try { window._db.remove('matchQueue/' + _mmQueueKey); } catch(e){}
                        _mmQueueKey = null;
                    }
                    clearInterval(window._mmElapsedTimer);
                    const mmSpinner = document.getElementById('mm-spinner');
                    if (mmSpinner) mmSpinner.style.display = 'none';
                    const mmFound = document.getElementById('mm-found-card');
                    const mmFoundName = document.getElementById('mm-found-name');
                    if (mmFoundName) mmFoundName.textContent = room.guest_name || 'Opponent';
                    if (mmFound) mmFound.classList.add('show');
                    document.getElementById('mm-status-text').textContent = '';
                    setTimeout(() => _startOnlineGame('host', _onlineCode), 1200);
                }
            });
        }
    } catch(e) {
        document.getElementById('mm-status-text').textContent = 'Connection error. Try again.';
        console.warn('[DR Online] matchmaking error', e);
    }
}

async function cancelMatchmaking() {
    clearInterval(window._mmElapsedTimer);
    const elapsed = document.getElementById('mm-elapsed');
    if (elapsed) elapsed.textContent = '';
    if (_mmListener) { _mmListener(); _mmListener = null; }
    if (_mmQueueKey && window._db) {
        try { await window._db.remove('matchQueue/' + _mmQueueKey); } catch(e){}
        _mmQueueKey = null;
    }
    if (_onlineCode && window._db) {
        try { await window._db.remove('onlineRooms/' + _onlineCode); } catch(e){}
        _onlineCode = null;
    }
    toggle('menu-matchmaking', false);
    toggle('menu-start', true); if(typeof _updateStartScreen==='function') _updateStartScreen();
}

/* ═══════════════════ START ONLINE GAME ═══════════════════ */
async function _startOnlineGame(role, code) {
    _onlineMode = true;
    _onlineRole = role;
    _onlineCode = code;

    toggle('menu-online-room', false);
    toggle('menu-matchmaking', false);

    // Show opponent name label
    let oppLabel = document.getElementById('online-opponent-label');
    if (!oppLabel) {
        oppLabel = document.createElement('div');
        oppLabel.id = 'online-opponent-label';
        const ah = document.getElementById('a-hand');
        if (ah && ah.parentNode) ah.parentNode.insertBefore(oppLabel, ah);
    }
    try {
        const snap = await window._db.get('onlineRooms/' + code);
        if (snap && snap.data) {
            const room = snap.data;
            const oppName = role === 'host' ? (room.guest_name || 'Opponent') : (room.host_name || 'Opponent');
            oppLabel.textContent = '⚔ vs ' + oppName;
        }
    } catch(e) {}

    // Open a Supabase Broadcast channel for live move sync (no DB writes)
    _broadcastChannel = window._db.broadcast(code);
    _broadcastChannel.on(msg => {
        if (!_onlineMode) return;
        if (!msg || msg.by === _onlineUid) return; // ignore our own echoes
        if (msg.type === 'play' && !state.turn) {
            _applyOpponentMove(msg);
        } else if (msg.type === 'chat') {
            _handleIncomingChat(msg);
        }
    });

    await initGame();
    toggleChat(false); // start minimized, but make the toggle button visible
}

/* ── Shared in-battle chat receiver — used by matchmaking, private
   rooms, and tournament matches alike so chat actually works in all
   three, not just matchmaking. ── */
function _handleIncomingChat(msg) {
    const msgsEl = document.getElementById('chat-messages');
    if (!msgsEl) return;
    const div = document.createElement('div');
    div.className = 'chat-msg chat-opponent';
    const safeText = msg.text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '';
    const safeName = msg.name?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || 'Opponent';
    div.innerHTML = `<span class="chat-name">${safeName}:</span> <span class="chat-text">${safeText}</span>`;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    // Show unread dot if the panel is currently minimized
    const chat = document.getElementById('game-chat');
    const dot  = document.getElementById('chat-unread-dot');
    if (chat && !chat.classList.contains('chat-open') && dot) dot.style.display = 'block';
}

/* ── Send a message in the in-battle chat (typed in #chat-input) ── */
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const raw   = (input?.value || '').trim();
    if (!raw || !_broadcastChannel) return;
    input.value = '';

    const filtered = typeof _filterChatMsg === 'function' ? _filterChatMsg(raw) : { text: raw };
    if (!filtered.text) return; // entire message was blocked by auto-mod

    const msg = {
        by:   _onlineUid,
        type: 'chat',
        name: (_profileData?.username) || 'Wanderer',
        text: filtered.text,
        ts:   Date.now(),
    };
    // Show our own message immediately (broadcast excludes the sender)
    const msgsEl = document.getElementById('chat-messages');
    if (msgsEl) {
        const div = document.createElement('div');
        div.className = 'chat-msg chat-self';
        const safeText = msg.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        div.innerHTML = `<span class="chat-name">You:</span> <span class="chat-text">${safeText}</span>`;
        msgsEl.appendChild(div);
        msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    _broadcastChannel.send(msg).catch(e => console.warn('[DR Chat] send failed', e));
}

/* ── Open/minimize the in-battle chat panel ── */
function toggleChat(show) {
    const chat = document.getElementById('game-chat');
    const btn  = document.getElementById('chat-toggle-btn');
    const dot  = document.getElementById('chat-unread-dot');
    if (!chat || !btn) return;
    chat.classList.toggle('chat-open', show);
    btn.classList.toggle('chat-btn-visible', !show);
    if (show && dot) dot.style.display = 'none'; // opening it clears the unread indicator
}

/* ═══════════════════ ONLINE MOVE SYNC ═══════════════════ */

/* Called by playerAct BEFORE resolving — sends move over Broadcast (no DB write) */
async function _broadcastMove(cardIndex) {
    if (!_onlineMode || !_broadcastChannel) return;
    try {
        await _broadcastChannel.send({
            by:    _onlineUid,
            type:  'play',
            index: cardIndex,
            ts:    Date.now(),
        });
    } catch(e) { console.warn('[DR Online] broadcast failed', e); }
}

/* Called when we receive the opponent's move */
async function _applyOpponentMove(move) {
    if (_forfeited || _gameOverFired) return;
    _forcedOnlineCard = move.index;
    await aiAct();
    _forcedOnlineCard = null;
}

/* _forcedOnlineCard: set before calling aiAct when online to force opponent's chosen index */
let _forcedOnlineCard = null;

/* ═══════════════════ ONLINE CLEANUP ═══════════════════ */
function _cleanupOnline() {
    _onlineMode = false;
    if (_roomListener)     { _roomListener(); _roomListener = null; }
    if (_broadcastChannel) { _broadcastChannel.unsub(); _broadcastChannel = null; }
    if (_onlineCode && window._db) {
        try { window._db.remove('onlineRooms/' + _onlineCode); } catch(e){}
    }
    _onlineCode = null; _onlineRole = null; _onlineOppUid = null;
    const lbl = document.getElementById('online-opponent-label');
    if (lbl) lbl.textContent = '';
}


/* ═══════════════════ SETTINGS REFRESH ═══════════════════ */
/* The settings screen h2 styling is handled by CSS above.
   This function re-applies the Cinzel font to dynamic elements
   that may be injected after page load. */
function _refreshSettingsUI() {
    // Already handled by CSS — no JS needed unless dynamic rows are added.
}

/* ═══════════════════════════════════════════════════════════════════════
   END ONLINE MULTIPLAYER SYSTEM
═══════════════════════════════════════════════════════════════════════ */



/* ═══════════════════════════════════════════════════════════════════
   MATCH RESULT — win/loss tracking + XP (via xp.js)
   Rank system removed entirely. Level/XP is the sole progression system.
======================================================================= */

async function _submitMatchResult(won) {
    // profiles = Firestore now, not Supabase (see js/firestore-db.js) —
    // wins/losses should accumulate the same regardless of which region
    // the match was actually played on.
    if (!_syncedUid) return;

    try {
        const myProfile = await fsGet('profiles', _syncedUid);
        if (!myProfile) return;

        const newWins   = (myProfile.wins   || 0) + (won ? 1 : 0);
        const newLosses = (myProfile.losses || 0) + (!won ? 1 : 0);

        fsSet('profiles', _syncedUid, {
            wins:   newWins,
            losses: newLosses,
        });

        _profileData.wins   = newWins;
        _profileData.losses = newLosses;
        saveProfileData();

        // XP awarded by xp.js
        if (typeof _xpOnMatchEnd === 'function') {
            const isPrivate = typeof _privateMatch !== 'undefined' && _privateMatch;
            _xpOnMatchEnd(won, true, isPrivate, false);
        }
    } catch(e) {
        console.warn('[DR Match] _submitMatchResult error', e);
    }
}


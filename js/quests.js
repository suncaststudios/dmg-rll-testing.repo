/* ═══════════════════════════════════════════════════════════════════
   DAILY & WEEKLY QUEST SYSTEM  —  quests.js
   ─────────────────────────────────────────────────────────────────
   Structure
   ─────────
   • 3 daily quests     — reset every day at midnight UTC
   • 2 weekly quests    — reset every Monday at midnight UTC
   • Unlimited quests   — no reset, no rotation. The whole pool is
     always visible; each is much harder than a daily/weekly and pays
     out a bigger flat reward once, permanently, whenever you clear it.
   • 1 club quest       — a single shared goal the whole club chases
     together, rotates weekly per-club. Every member's progress counts
     toward the same bar; once the club clears it, every member can
     claim their own reward independently.
   • 1 community quest  — same idea as a club quest but for literally
     everyone playing the game, rotates monthly.

   Rewards
   ───────
   • Daily quests give Gold (small amounts)
   • Weekly quests give Gold + XP bonus
   • Unlimited quests give a large flat Gold + XP reward
   • Club/Community quests give Gold + XP to every member who claims

   Storage
   ───────
   • localStorage: dr_quest_state — personal quests (daily/weekly/
     unlimited) and progress. Always the source of truth for guests.
   • Firebase (Firestore): quest_progress/{uid} mirrors that same
     personal quest state for logged-in accounts, so daily/weekly/
     unlimited progress carries over across devices instead of being
     stuck to whichever one earned it. Pushed on every _questSave()
     (debounced — see _scheduleQuestStateSync), and merged back in once
     after login (_questSyncFromFirebase) by taking the higher progress
     value and OR-ing claimed flags per quest, rather than blindly
     trusting either side — see that function for why daily/weekly only
     merge when the rotation period actually matches.
   • Supabase (home region — window._supabaseHome, not the region-
     switchable window._supabase): club_quests / club_quest_claims
     tables hold the shared progress counter for club quests. This is
     deliberately NOT Firestore — club members can be spread across
     different matchmaking regions, but they all need to see and
     contribute to the exact same counter, which only works if it lives
     in one fixed place. Progress increments go through a Postgres
     function (increment_club_quest_progress) rather than a client-side
     read-then-write, since concurrent contributions from different
     members landing close together would otherwise overwrite instead
     of add.
   • Firestore: community_quests/current holds the shared counter for
     the single global community quest — same underlying idea as club
     quests (many different players' clients all contributing to one
     counter needs an atomic increment, here via fsIncrement in
     firestore-db.js), just not region-sensitive the way club quests
     are, so there's no reason it needs to live in the home-region
     Supabase project specifically. Claim state per club/community
     quest lives in its own tiny document/row per claiming account
     rather than a growing array on the quest record itself — arrays
     that grow with the whole userbase are a well-known anti-pattern
     (document size limits, write contention as everyone fights to
     append to the same record).

   Quest pool
   ──────────
   Each quest has:
     id       — unique string
     type     — 'daily' | 'weekly' | 'unlimited' | 'club' | 'community'
     icon     — emoji
     name     — short title
     desc     — what you have to do
     goal     — target number
     stat     — which progress counter to watch
     gold     — gold reward on completion
     xp       — XP reward

   Progress is tracked via _questTick(stat, amount) called from
   the same tracking hooks used by achievements (trackCardPlayed,
   trackCrit, trackGameEnd, etc.) — that one hook now also feeds
   club/community quest contributions, not just personal ones.
═══════════════════════════════════════════════════════════════════ */

/* ─── Quest pool ─────────────────────────────────────────────────── */
const QUEST_POOL_DAILY = [
    { id:'d_win1',       icon:'⚔️', name:'First Victory',      desc:'Win 1 battle.',                          goal:1,  stat:'wins',       gold:15,  xp:0 },
    { id:'d_win3',       icon:'🗡️', name:'Three Victories',    desc:'Win 3 battles.',                         goal:3,  stat:'wins',       gold:35,  xp:0 },
    { id:'d_play10',     icon:'🃏', name:'Card Slinger',       desc:'Play 10 cards.',                         goal:10, stat:'cards',      gold:20,  xp:0 },
    { id:'d_play20',     icon:'🎴', name:'Heavy Hitter',       desc:'Play 20 cards.',                         goal:20, stat:'cards',      gold:35,  xp:0 },
    { id:'d_crit5',      icon:'🎲', name:'Hot Streak',         desc:'Roll 5 Crits.',                          goal:5,  stat:'crits',      gold:20,  xp:0 },
    { id:'d_crit10',     icon:'🎯', name:'On a Roll',          desc:'Roll 10 Crits.',                         goal:10, stat:'crits',      gold:35,  xp:0 },
    { id:'d_dmg50',      icon:'💥', name:'Damage Dealer',      desc:'Deal 50 total damage.',                  goal:50, stat:'damage',     gold:15,  xp:0 },
    { id:'d_dmg150',     icon:'🔥', name:'Destruction',        desc:'Deal 150 total damage.',                 goal:150,stat:'damage',     gold:30,  xp:0 },
    { id:'d_heal30',     icon:'🧪', name:'Patch Job',          desc:'Heal a total of 30 HP.',                 goal:30, stat:'healed',     gold:20,  xp:0 },
    { id:'d_chain',      icon:'⛓️', name:'Chain Reaction',     desc:'Land a 3-crit chain.',                   goal:1,  stat:'chains',     gold:25,  xp:0 },
    { id:'d_play_atk',   icon:'⚔️', name:'Keep Swinging',      desc:'Play Attack 3 times.',                   goal:3,  stat:'play_attack',gold:15,  xp:0 },
    { id:'d_play_heal',  icon:'🧪', name:'Stay Alive',         desc:'Play Heal 3 times.',                     goal:3,  stat:'play_heal',  gold:15,  xp:0 },
    { id:'d_play_vamp',  icon:'🦇', name:'Thirsty',            desc:'Play Vampire 2 times.',                  goal:2,  stat:'play_vampire',gold:20, xp:0 },
    { id:'d_survive',    icon:'💀', name:'Brush With Death',   desc:'Win a game after dropping below 20 HP.', goal:1,  stat:'low_hp_wins', gold:30, xp:0 },
    { id:'d_fail3',      icon:'💫', name:'Trust the Process',  desc:'Roll 3 Fails. It builds character.',     goal:3,  stat:'fails',      gold:10,  xp:0 },
    { id:'d_play_bomb',  icon:'💣', name:'Bomb Squad',         desc:'Play Bomb without it backfiring.',       goal:1,  stat:'bomb_succ',  gold:25,  xp:0 },
    { id:'d_play3games', icon:'🎮', name:'Show Up',            desc:'Play 3 games (win or lose).',            goal:3,  stat:'games',      gold:20,  xp:0 },
    { id:'d_poison',     icon:'☠️', name:'Slow Burn',          desc:'Apply poison 2 times.',                  goal:2,  stat:'poisoned',   gold:20,  xp:0 },
];

const QUEST_POOL_WEEKLY = [
    { id:'w_win10',      icon:'🏆', name:'Veteran Week',       desc:'Win 10 battles this week.',              goal:10, stat:'wins',       gold:100, xp:80  },
    { id:'w_win20',      icon:'👑', name:'Warlord Week',       desc:'Win 20 battles this week.',              goal:20, stat:'wins',       gold:200, xp:150 },
    { id:'w_dmg500',     icon:'💥', name:'Reign of Terror',    desc:'Deal 500 total damage this week.',       goal:500,stat:'damage',     gold:120, xp:90  },
    { id:'w_dmg1000',    icon:'☄️', name:'Apocalypse',         desc:'Deal 1000 total damage this week.',      goal:1000,stat:'damage',    gold:250, xp:180 },
    { id:'w_crit30',     icon:'🎲', name:'Fortune\'s Darling', desc:'Roll 30 Crits this week.',               goal:30, stat:'crits',      gold:100, xp:70  },
    { id:'w_chain5',     icon:'⛓️', name:'Chain Master',       desc:'Land 5 triple-crit chains this week.',   goal:5,  stat:'chains',     gold:150, xp:120 },
    { id:'w_heal200',    icon:'🧪', name:'Field Hospital',     desc:'Heal 200 total HP this week.',           goal:200,stat:'healed',     gold:100, xp:80  },
    { id:'w_decks3',     icon:'🎴', name:'Variety Pack',       desc:'Win with 3 different decks this week.',  goal:3,  stat:'deck_wins',   gold:150, xp:120 },
    { id:'w_online5',    icon:'🌐', name:'Online Presence',    desc:'Win 5 online matches this week.',        goal:5,  stat:'online_wins', gold:200, xp:150 },
    { id:'w_survive3',   icon:'💀', name:'Unkillable',         desc:'Win 3 games after dropping below 20 HP this week.', goal:3, stat:'low_hp_wins', gold:180, xp:140 },
    { id:'w_nodmg',      icon:'✨', name:'Ghost',              desc:'Win a game taking less than 10 total damage.', goal:1, stat:'low_dmg_wins', gold:200, xp:160 },
    { id:'w_play100',    icon:'🃏', name:'Card Factory',       desc:'Play 100 cards this week.',              goal:100,stat:'cards',      gold:120, xp:90  },
];

/* No rotation — every entry here is always visible and available at
   once. Much bigger goals, much bigger flat payouts, and (unlike daily/
   weekly) clearing one doesn't cost you a rotation slot — you can work
   on all of them in parallel indefinitely. */
const QUEST_POOL_UNLIMITED = [
    { id:'u_win100',     icon:'👑', name:'Living Legend',      desc:'Win 100 battles, ever.',                  goal:100,  stat:'wins',       gold:600,  xp:500 },
    { id:'u_dmg10000',   icon:'☄️', name:'Force of Nature',    desc:'Deal 10,000 total damage, ever.',         goal:10000,stat:'damage',     gold:600,  xp:500 },
    { id:'u_crit200',    icon:'🎲', name:'Blessed by the Dice',desc:'Roll 200 Crits, ever.',                   goal:200,  stat:'crits',      gold:450,  xp:350 },
    { id:'u_chain25',    icon:'⛓️', name:'Chainbreaker',       desc:'Land 25 triple-crit chains, ever.',       goal:25,   stat:'chains',     gold:500,  xp:400 },
    { id:'u_heal2000',   icon:'🧪', name:'Field Medic',        desc:'Heal 2,000 total HP, ever.',              goal:2000, stat:'healed',     gold:450,  xp:350 },
    { id:'u_play1000',   icon:'🎴', name:'Card Hoarder',       desc:'Play 1,000 cards, ever.',                 goal:1000, stat:'cards',      gold:400,  xp:300 },
    { id:'u_games250',   icon:'🎮', name:'No Life',            desc:'Play 250 games, ever.',                   goal:250,  stat:'games',      gold:500,  xp:400 },
    { id:'u_survive25',  icon:'💀', name:'Cheated Death',      desc:'Win 25 games after dropping below 20 HP.',goal:25,   stat:'low_hp_wins',gold:550,  xp:450 },
];

/* One active quest per club at a time, rotating weekly — much bigger
   goals than a personal weekly, sized for a whole roster's combined
   effort rather than one person's. Every club member's own play
   contributes to the same shared counter (see _questTick below). */
const CLUB_QUEST_POOL = [
    { id:'c_wins50',     icon:'🏆', name:'United Front',       desc:'Club wins 50 battles this week.',        goal:50,   stat:'wins',       gold:200, xp:150 },
    { id:'c_dmg5000',    icon:'💥', name:'Combined Arms',      desc:'Club deals 5,000 total damage this week.',goal:5000,stat:'damage',     gold:220, xp:170 },
    { id:'c_crit150',    icon:'🎲', name:'Lucky Guild',        desc:'Club rolls 150 Crits this week.',        goal:150,  stat:'crits',      gold:200, xp:150 },
    { id:'c_games100',   icon:'🎮', name:'All Hands',          desc:'Club plays 100 games this week.',        goal:100,  stat:'games',      gold:180, xp:130 },
    { id:'c_heal1000',   icon:'🧪', name:'Guild Infirmary',    desc:'Club heals 1,000 total HP this week.',   goal:1000, stat:'healed',     gold:190, xp:140 },
];

/* Same idea, but one single global quest for every player, rotating
   monthly. Goal sizes here are intentionally round, tunable numbers —
   there's no way to know actual playerbase size in advance, so these
   are a starting point to adjust once real usage data exists. */
const COMMUNITY_QUEST_POOL = [
    { id:'m_wins',   icon:'🌍', name:'Global Offensive', desc:'The community wins 5,000 battles this month.',    goal:5000,   stat:'wins',   gold:150, xp:120 },
    { id:'m_damage', icon:'🌋', name:'World Ender',      desc:'The community deals 500,000 total damage this month.', goal:500000, stat:'damage', gold:150, xp:120 },
    { id:'m_games',  icon:'🌐', name:'Everyone Plays',   desc:'The community plays 10,000 games this month.',    goal:10000,  stat:'games',  gold:130, xp:100 },
];

/* ─── State ───────────────────────────────────────────────────────── */
const QUEST_KEY = 'dr_quest_state';
let _questState = null;

/* ─── Date helpers ────────────────────────────────────────────────── */
function _questDayKey()  { return new Date().toISOString().slice(0, 10); }
function _questWeekKey() {
    const d = new Date();
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday
    const mon = new Date(d);
    mon.setUTCDate(diff);
    return mon.toISOString().slice(0, 10);
}

function _questSeed(str) {
    return str.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffffffff, 0);
}

function _questMonthKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function _questSeededPick(pool, count, seed) {
    const arr = [...pool];
    let s = seed;
    for (let i = arr.length - 1; i > 0; i--) {
        s = ((s * 1664525) + 1013904223) & 0xffffffff;
        const j = Math.abs(s) % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count).map(q => q.id);
}

/* ─── Load / init state ───────────────────────────────────────────── */
function _questLoad() {
    try {
        const raw = localStorage.getItem(QUEST_KEY);
        _questState = raw ? JSON.parse(raw) : {};
    } catch(e) { _questState = {}; }

    const today = _questDayKey();
    const week  = _questWeekKey();

    // Rotate daily quests if day changed
    if (_questState.seed_d !== today) {
        _questState.seed_d   = today;
        _questState.dailyIds = _questSeededPick(QUEST_POOL_DAILY, 3, _questSeed(today));
        // Reset daily progress + claims
        (_questState.dailyIds).forEach(id => {
            _questState['prog_' + id]    = 0;
            _questState['claimed_' + id] = false;
        });
    }

    // Rotate weekly quests if week changed
    if (_questState.seed_w !== week) {
        _questState.seed_w    = week;
        _questState.weeklyIds = _questSeededPick(QUEST_POOL_WEEKLY, 2, _questSeed(week + '_w'));
        (_questState.weeklyIds).forEach(id => {
            _questState['prog_' + id]    = 0;
            _questState['claimed_' + id] = false;
        });
    }

    // Weekly, but never unlimited — unlimited quests have no rotation at
    // all, so they just need their prog/claimed keys to exist once, ever.
    if (_questState._unlimitedInit !== true) {
        _questState._unlimitedInit = true;
        QUEST_POOL_UNLIMITED.forEach(q => {
            if (_questState['prog_' + q.id]    === undefined) _questState['prog_' + q.id]    = 0;
            if (_questState['claimed_' + q.id] === undefined) _questState['claimed_' + q.id] = false;
        });
    }

    _questSave();
}

function _questSave() {
    try { localStorage.setItem(QUEST_KEY, JSON.stringify(_questState)); } catch(e) {}
    // Also push to Firebase, debounced — daily/weekly/unlimited quest
    // progress for the logged-in account, so it carries over across
    // devices/browsers instead of being stuck to whichever one earned
    // it. Guests stay localStorage-only, same as everything else that
    // needs an account to sync at all.
    if (typeof _syncedUid !== 'undefined' && _syncedUid) _scheduleQuestStateSync();
}

let _questStateSyncTimer = null;
function _scheduleQuestStateSync() {
    clearTimeout(_questStateSyncTimer);
    _questStateSyncTimer = setTimeout(_pushQuestStateToFirebase, 1500);
}
async function _pushQuestStateToFirebase() {
    if (typeof _syncedUid === 'undefined' || !_syncedUid || typeof fsSet !== 'function') return;
    try { await fsSet('quest_progress', _syncedUid, { state: _questState }); }
    catch(e) { console.warn('[DR Quests] state sync error', e); }
}

/* ── One-time catch-up merge from Firebase, run after login ──
   _questLoad() itself stays synchronous (many call sites — _questTick,
   _questGetActive, claimQuest — call it without awaiting, and making
   it async would mean all of those risk running against incomplete
   state while a network fetch is still in flight). Instead, this runs
   once after login resolves, fetches whatever's saved server-side, and
   merges it into whatever's already loaded from localStorage — taking
   the higher progress value and OR-ing claimed flags per quest, rather
   than blindly overwriting either side, so switching devices mid-quest
   can't lose progress made on either one. Daily/weekly progress only
   merges if the server's rotation key matches the current period (an
   old day/week's numbers shouldn't bleed into a freshly-rotated set);
   unlimited quests never rotate, so they always merge safely regardless
   of when the server copy was last written. */
async function _questSyncFromFirebase() {
    if (typeof _syncedUid === 'undefined' || !_syncedUid || typeof fsGet !== 'function') return;
    if (!_questState) _questLoad();
    try {
        const server = await fsGet('quest_progress', _syncedUid);
        const s = server?.state;
        if (!s) return;

        const sameDay  = s.seed_d === _questState.seed_d;
        const sameWeek = s.seed_w === _questState.seed_w;
        const mergeIds = [
            ...(sameDay  ? (_questState.dailyIds  || []) : []),
            ...(sameWeek ? (_questState.weeklyIds || []) : []),
            ...QUEST_POOL_UNLIMITED.map(q => q.id),
        ];
        mergeIds.forEach(id => {
            const pKey = 'prog_' + id, cKey = 'claimed_' + id;
            _questState[pKey] = Math.max(_questState[pKey] || 0, s[pKey] || 0);
            _questState[cKey] = !!(_questState[cKey] || s[cKey]);
        });
        _questSave();
        _questRenderIfOpen();
    } catch(e) { console.warn('[DR Quests] state merge error', e); }
}

/* ─── Get active quests (personal: daily/weekly/unlimited) ─────────── */
function _questGetActive() {
    if (!_questState) _questLoad();
    const all = [...QUEST_POOL_DAILY, ...QUEST_POOL_WEEKLY, ...QUEST_POOL_UNLIMITED];
    const ids = [...(_questState.dailyIds || []), ...(_questState.weeklyIds || []), ...QUEST_POOL_UNLIMITED.map(q => q.id)];
    return ids.map(id => {
        const def = all.find(q => q.id === id);
        if (!def) return null;
        return {
            ...def,
            progress: _questState['prog_' + id] || 0,
            claimed:  _questState['claimed_' + id] || false,
            type:     id.startsWith('w_') ? 'weekly' : id.startsWith('u_') ? 'unlimited' : 'daily',
        };
    }).filter(Boolean);
}

/* ─── Progress tick — called from game tracking hooks ─────────────── */
function _questTick(stat, amount = 1) {
    if (!_questState) _questLoad();
    const quests = _questGetActive();
    let anyComplete = false;

    quests.forEach(q => {
        if (q.claimed) return;
        if (q.stat !== stat) return;
        const key = 'prog_' + q.id;
        const before = _questState[key] || 0;
        const after  = Math.min(before + amount, q.goal);
        _questState[key] = after;
        if (after >= q.goal && before < q.goal) {
            anyComplete = true;
            _questNotify(q);
        }
    });

    _questSave();
    if (anyComplete) _questRenderIfOpen();

    // Also feed club/community quests, if the currently-rotated one for
    // either happens to watch this same stat. These aren't written to
    // Firestore per-tick (that would mean a network write every single
    // card played) — contributions are accumulated locally and flushed
    // on a short debounce instead, same pattern as the XP/speedrun sync
    // debouncing elsewhere in the codebase.
    if (_clubQuestState?.def?.stat === stat)     { _pendingClubContribution     += amount; _scheduleQuestContributionFlush(); }
    if (_communityQuestState?.def?.stat === stat){ _pendingCommunityContribution += amount; _scheduleQuestContributionFlush(); }
}

/* ─── Completion notification ─────────────────────────────────────── */
function _questNotify(quest) {
    // Guests (not logged in) don't get quest-complete popups.
    if (typeof _isLoggedIn === 'function' && !_isLoggedIn()) return;

    let toast = document.getElementById('quest-complete-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'quest-complete-toast';
        toast.style.cssText = `
            position:fixed; top:22px; left:50%; transform:translateX(-50%);
            z-index:9998; background:rgba(10,6,2,.97);
            border:1px solid rgba(200,160,40,.55); border-radius:10px;
            padding:12px 22px; font-family:'Cinzel',serif;
            display:flex; align-items:center; gap:12px;
            box-shadow:0 8px 32px rgba(0,0,0,.8);
            opacity:0; transition:opacity .3s; pointer-events:none;
            white-space:nowrap;
        `;
        document.body.appendChild(toast);
    }
    const typeLabels = { weekly:'Weekly Quest', unlimited:'Unlimited Quest', club:'Club Quest', community:'Community Quest' };
    const typeLabel = typeLabels[quest.type] || 'Daily Quest';
    toast.innerHTML = `
        <span style="font-size:22px;">${quest.icon}</span>
        <div>
            <div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#7a5a30;">${typeLabel} Complete</div>
            <div style="font-size:12px;color:#e8c870;letter-spacing:1px;">${quest.name}</div>
            <div style="font-size:9px;color:#6b9a40;letter-spacing:1px;">🪙 ${quest.gold} Gold${quest.xp ? ' · ' + quest.xp + ' XP' : ''} — Claim in Quests</div>
        </div>
    `;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

/* ─── Claim reward ────────────────────────────────────────────────── */
function claimQuest(questId) {
    if (!_questState) _questLoad();
    const all   = [...QUEST_POOL_DAILY, ...QUEST_POOL_WEEKLY, ...QUEST_POOL_UNLIMITED];
    const def   = all.find(q => q.id === questId);
    if (!def) return;
    const prog  = _questState['prog_' + questId] || 0;
    const claimed = _questState['claimed_' + questId];
    if (prog < def.goal || claimed) return;

    _questState['claimed_' + questId] = true;
    _questSave();

    // Award gold
    if (typeof shopAwardGold === 'function') shopAwardGold(def.gold);
    if (typeof _showGoldToast === 'function') _showGoldToast(`+${def.gold} 🪙 Quest: ${def.name}`);

    // Award XP
    if (def.xp > 0 && typeof awardXP === 'function') {
        setTimeout(() => awardXP(def.xp, 'Quest: ' + def.name), 600);
    }

    // _questSave() above already handles both localStorage (always) and,
    // for a logged-in account, a debounced push to Firebase — see
    // _scheduleQuestStateSync near the top of the file. No separate sync
    // call needed here.
    if (typeof _recordChallengeCompleted === 'function') _recordChallengeCompleted();

    _questRenderIfOpen();
    playSfx('questComplete');
}

/* ═══════════════════════════════════════════════════════════════════
   CLUB & COMMUNITY QUESTS
   ─────────────────────────────────────────────────────────────────
   Shared, collaborative progress — unlike daily/weekly/unlimited quests
   above, these can't be tracked purely in localStorage, since many
   different players' clients are all contributing to the same counter.
   Firestore's atomic increment (fsIncrement, in firestore-db.js) is
   what makes that safe: it adds to whatever the current server value
   is at the moment the write lands, rather than the client computing
   "current + my contribution" from a possibly-stale local read and
   overwriting anyone else's contribution that landed in between.
═══════════════════════════════════════════════════════════════════ */

let _clubQuestState      = null; // { def, doc } for the active club quest, or null if not in a club
let _communityQuestState = null; // { def, doc } for the active community quest

let _pendingClubContribution      = 0;
let _pendingCommunityContribution = 0;
let _questContributionFlushTimer  = null;

function _scheduleQuestContributionFlush() {
    clearTimeout(_questContributionFlushTimer);
    _questContributionFlushTimer = setTimeout(_flushQuestContributions, 4000);
}

async function _flushQuestContributions() {
    const clubAmt = _pendingClubContribution;
    const comAmt  = _pendingCommunityContribution;
    _pendingClubContribution      = 0;
    _pendingCommunityContribution = 0;

    if (clubAmt > 0 && _clubQuestState?.doc) {
        // Club quests live in Supabase (home region), not Firestore — see
        // the increment_club_quest_progress() Postgres function, which is
        // the SQL-side equivalent of Firestore's atomic increment: it
        // applies `progress = progress + amount` against whatever the
        // current row value is at that moment, so two members'
        // contributions landing close together both count.
        const sb = window._supabaseHome;
        if (sb) {
            const { error } = await sb.rpc('increment_club_quest_progress', {
                p_club_id: _clubQuestState.doc.id, p_amount: clubAmt,
            });
            if (!error) {
                _clubQuestState.doc.progress = (_clubQuestState.doc.progress || 0) + clubAmt;
                _questCheckClubComplete();
            } else {
                _pendingClubContribution += clubAmt; // retry on next flush rather than losing it
            }
        } else {
            _pendingClubContribution += clubAmt;
        }
    }
    if (comAmt > 0 && _communityQuestState?.doc) {
        const { error } = await fsIncrement('community_quests', 'current', 'progress', comAmt);
        if (!error) {
            _communityQuestState.doc.progress = (_communityQuestState.doc.progress || 0) + comAmt;
            _questCheckCommunityComplete();
        } else {
            _pendingCommunityContribution += comAmt;
        }
    }
    _questRenderIfOpen();
}

function _questCheckClubComplete() {
    const s = _clubQuestState;
    if (s?.doc && !s._notified && s.doc.progress >= s.def.goal) {
        s._notified = true;
        _questNotify({ ...s.def, type: 'club' });
    }
}
function _questCheckCommunityComplete() {
    const s = _communityQuestState;
    if (s?.doc && !s._notified && s.doc.progress >= s.def.goal) {
        s._notified = true;
        _questNotify({ ...s.def, type: 'community' });
    }
}

/* ── Load/rotate the club's active quest ──
   Supabase (home region) — club_quests table, one row per club, keyed
   by club_id (the club's Firestore doc id, kept as plain text here
   since club identity itself still lives in Firebase; only the quest
   progress counter is Supabase). Overwritten (not incremented) whenever
   the week changes, since rotating is a reset, not a bump. Uses
   window._supabaseHome specifically, not the region-switchable
   window._supabase — a club's members can be spread across different
   matchmaking regions, but they all need to see and contribute to the
   exact same counter, which only works if it lives in one fixed place
   regardless of anyone's individual region setting. */
async function _questLoadClubQuest() {
    _clubQuestState = null;
    if (typeof _clubsState === 'undefined' || !_clubsState?.myClub) { _questRenderIfOpen(); return; }
    const sb = window._supabaseHome;
    if (!sb) { _questRenderIfOpen(); return; }
    const clubId = _clubsState.myClub.id;
    const week = _questWeekKey();
    try {
        const { data: existing } = await sb.from('club_quests').select('*').eq('club_id', clubId).maybeSingle();
        let doc = existing;
        if (!doc || doc.week_key !== week) {
            const questId = _questSeededPick(CLUB_QUEST_POOL, 1, _questSeed(clubId + '_' + week))[0];
            doc = { club_id: clubId, quest_id: questId, week_key: week, progress: 0 };
            await sb.from('club_quests').upsert(doc, { onConflict: 'club_id' });
        }
        const def = CLUB_QUEST_POOL.find(q => q.id === doc.quest_id);
        if (!def) { _questRenderIfOpen(); return; }
        let claimed = false;
        if (_syncedUid) {
            const { data: claim } = await sb.from('club_quest_claims')
                .select('uid').eq('club_id', clubId).eq('week_key', doc.week_key).eq('uid', _syncedUid).maybeSingle();
            claimed = !!claim;
        }
        // Normalize field names to match the rest of this module's
        // {def, doc:{id, progress}} shape (doc.id instead of club_id,
        // since that's what the render/flush code above already expects).
        _clubQuestState = { def, doc: { id: doc.club_id, questId: doc.quest_id, weekKey: doc.week_key, progress: doc.progress || 0 }, claimed, _notified: (doc.progress||0) >= def.goal };
    } catch(e) { console.warn('[DR Quests] club quest load error', e); }
    _questRenderIfOpen();
}

/* ── Load/rotate the community's active quest (stays on Firestore) ── */
async function _questLoadCommunityQuest() {
    _communityQuestState = null;
    const period = _questMonthKey();
    try {
        let doc = await fsGet('community_quests', 'current');
        if (!doc || doc.periodKey !== period) {
            const questId = _questSeededPick(COMMUNITY_QUEST_POOL, 1, _questSeed(period))[0];
            doc = { id: 'current', questId, periodKey: period, progress: 0 };
            await fsSet('community_quests', 'current', { questId, periodKey: period, progress: 0 });
        }
        const def = COMMUNITY_QUEST_POOL.find(q => q.id === doc.questId);
        if (!def) { _questRenderIfOpen(); return; }
        const claimDoc = _syncedUid ? await fsGet('community_quests', 'current__claims__' + _syncedUid) : null;
        _communityQuestState = { def, doc, claimed: !!claimDoc, _notified: (doc.progress||0) >= def.goal };
    } catch(e) { console.warn('[DR Quests] community quest load error', e); }
    _questRenderIfOpen();
}

/* ── Claim a completed club quest (Supabase) ──
   club_quest_claims has a composite primary key (club_id, week_key,
   uid), so a duplicate claim attempt just fails the insert outright —
   no separate existence check needed for correctness, though we still
   check `claimed` client-side first to avoid firing a pointless request. */
async function claimClubQuest() {
    const s = _clubQuestState;
    if (!s || !_syncedUid || s.claimed || (s.doc.progress||0) < s.def.goal) return;
    const sb = window._supabaseHome;
    if (!sb) return;
    const { error } = await sb.from('club_quest_claims').insert({
        club_id: s.doc.id, week_key: s.doc.weekKey, uid: _syncedUid,
    });
    if (error) return;
    s.claimed = true;
    if (typeof shopAwardGold === 'function') shopAwardGold(s.def.gold);
    if (typeof _showGoldToast === 'function') _showGoldToast(`+${s.def.gold} 🪙 Club Quest: ${s.def.name}`);
    if (s.def.xp > 0 && typeof awardXP === 'function') setTimeout(() => awardXP(s.def.xp, 'Club Quest: ' + s.def.name), 600);
    _questRenderIfOpen();
    playSfx('questComplete');
}

/* ── Claim a completed community quest (Firestore) ──
   Claim state tracked via a small dedicated doc per claiming account
   (see the "__claims__" doc id convention) rather than one growing
   array on the quest doc, since that array would otherwise need to
   hold every contributing player's uid forever and become a write-
   contention bottleneck as more people try to append to it at once. */
async function claimCommunityQuest() {
    const s = _communityQuestState;
    if (!s || !_syncedUid || s.claimed || (s.doc.progress||0) < s.def.goal) return;
    const { error } = await fsSet('community_quests', 'current__claims__' + _syncedUid, { uid: _syncedUid, claimedAt: new Date().toISOString() });
    if (error) return;
    s.claimed = true;
    if (typeof shopAwardGold === 'function') shopAwardGold(s.def.gold);
    if (typeof _showGoldToast === 'function') _showGoldToast(`+${s.def.gold} 🪙 Community Quest: ${s.def.name}`);
    if (s.def.xp > 0 && typeof awardXP === 'function') setTimeout(() => awardXP(s.def.xp, 'Community Quest: ' + s.def.name), 600);
    _questRenderIfOpen();
    playSfx('questComplete');
}

/* ─── Hooks into existing tracking system ─────────────────────────── */
// Called from achievements.js trackGameEnd
function _questOnGameEnd(won, isOnline) {
    _questTick('games', 1);
    if (won) {
        _questTick('wins', 1);
        if (isOnline) _questTick('online_wins', 1);
        // Low HP win
        if (typeof state !== 'undefined' && state.pHP <= 20) {
            _questTick('low_hp_wins', 1);
        }
        // Low damage taken win
        if (typeof achStats !== 'undefined' && (achStats._battleDmgTaken || 0) < 10) {
            _questTick('low_dmg_wins', 1);
        }
        // Deck variety (track which decks won this week)
        if (typeof selectedDeckId !== 'undefined') {
            const key = 'dr_quest_deck_wins_' + _questWeekKey();
            try {
                const won_decks = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
                won_decks.add(selectedDeckId);
                localStorage.setItem(key, JSON.stringify([...won_decks]));
                // Sync deck_wins stat
                const current = _questState['prog_' + (_questState.weeklyIds || []).find(id => {
                    const def = QUEST_POOL_WEEKLY.find(q => q.id === id);
                    return def && def.stat === 'deck_wins';
                })] || 0;
                if (won_decks.size > current) {
                    _questTick('deck_wins', won_decks.size - current);
                }
            } catch(e) {}
        }
    }
}

function _questOnCard(cardKey) {
    _questTick('cards', 1);
    if (cardKey === 'attack')  _questTick('play_attack',  1);
    if (cardKey === 'heal')    _questTick('play_heal',    1);
    if (cardKey === 'vampire') _questTick('play_vampire', 1);
    if (cardKey === 'plague' || cardKey === 'miasma' || cardKey === 'contagion' || cardKey === 'pandemic') {
        _questTick('poisoned', 1);
    }
}

function _questOnCrit()   { _questTick('crits',  1); }
function _questOnFail()   { _questTick('fails',  1); }
function _questOnDamage(amount) { _questTick('damage', amount); }
function _questOnHeal(amount)   { _questTick('healed', amount); }
function _questOnChain(len) { if (len >= 3) _questTick('chains', 1); }
function _questOnBombSuccess()  { _questTick('bomb_succ', 1); }

/* ─── Open quests screen ──────────────────────────────────────────── */
function openQuests() {
    _questLoad();
    playSfx('menuClick');
    toggle('menu-quests', true);
    _questRender();
    _questLoadClubQuest();
    _questLoadCommunityQuest();
}

/* ─── Render ──────────────────────────────────────────────────────── */
function _questRenderIfOpen() {
    const el = document.getElementById('menu-quests');
    if (el && el.style.display !== 'none') _questRender();
}

function _questRender() {
    const quests = _questGetActive();
    const daily     = quests.filter(q => q.type === 'daily');
    const weekly    = quests.filter(q => q.type === 'weekly');
    const unlimited = quests.filter(q => q.type === 'unlimited');

    _questRenderGroup('quest-daily-list',     daily);
    _questRenderGroup('quest-weekly-list',    weekly);
    _questRenderGroup('quest-unlimited-list', unlimited);
    _questRenderClub();
    _questRenderCommunity();
    _questUpdateTimers();
}

/* ── Club quest section ── */
function _questRenderClub() {
    const section = document.getElementById('quest-club-section');
    const list    = document.getElementById('quest-club-list');
    if (!section || !list) return;

    if (typeof _clubsState === 'undefined' || !_clubsState?.myClub) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    const s = _clubQuestState;
    if (!s) { list.innerHTML = `<div class="quest-loading-note">Loading…</div>`; return; }

    const progress = s.doc.progress || 0;
    const pct  = Math.min(100, Math.round((progress / s.def.goal) * 100));
    const done = progress >= s.def.goal;
    list.innerHTML = `
        <div class="quest-card ${done ? 'quest-done' : ''} ${s.claimed ? 'quest-claimed' : ''}">
            <div class="quest-icon">${s.def.icon}</div>
            <div class="quest-body">
                <div class="quest-name">${s.def.name}</div>
                <div class="quest-desc">${s.def.desc}</div>
                <div class="quest-bar-wrap"><div class="quest-bar-fill" style="width:${pct}%;background:#4090c0;"></div></div>
                <div class="quest-progress-text">${progress.toLocaleString()} / ${s.def.goal.toLocaleString()} (whole club)</div>
            </div>
            <div class="quest-reward">
                <div class="quest-gold">🪙 ${s.def.gold}</div>
                ${s.def.xp ? `<div class="quest-xp">+${s.def.xp} XP</div>` : ''}
                ${s.claimed
                    ? `<div class="quest-claimed-badge">✓ Claimed</div>`
                    : done
                        ? `<button class="quest-claim-btn" onclick="claimClubQuest()">Claim</button>`
                        : `<div class="quest-pct">${pct}%</div>`
                }
            </div>
        </div>`;
}

/* ── Community quest section ── */
function _questRenderCommunity() {
    const list = document.getElementById('quest-community-list');
    if (!list) return;
    const s = _communityQuestState;
    if (!s) { list.innerHTML = `<div class="quest-loading-note">Loading…</div>`; return; }

    const progress = s.doc.progress || 0;
    const pct  = Math.min(100, Math.round((progress / s.def.goal) * 100));
    const done = progress >= s.def.goal;
    list.innerHTML = `
        <div class="quest-card ${done ? 'quest-done' : ''} ${s.claimed ? 'quest-claimed' : ''}">
            <div class="quest-icon">${s.def.icon}</div>
            <div class="quest-body">
                <div class="quest-name">${s.def.name}</div>
                <div class="quest-desc">${s.def.desc}</div>
                <div class="quest-bar-wrap"><div class="quest-bar-fill" style="width:${pct}%;background:#c04090;"></div></div>
                <div class="quest-progress-text">${progress.toLocaleString()} / ${s.def.goal.toLocaleString()} (everyone)</div>
            </div>
            <div class="quest-reward">
                <div class="quest-gold">🪙 ${s.def.gold}</div>
                ${s.def.xp ? `<div class="quest-xp">+${s.def.xp} XP</div>` : ''}
                ${!_syncedUid
                    ? `<div class="quest-pct" style="font-size:8px;">Sign in to claim</div>`
                    : s.claimed
                        ? `<div class="quest-claimed-badge">✓ Claimed</div>`
                        : done
                            ? `<button class="quest-claim-btn" onclick="claimCommunityQuest()">Claim</button>`
                            : `<div class="quest-pct">${pct}%</div>`
                }
            </div>
        </div>`;
}

function _questRenderGroup(containerId, quests) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = quests.map(q => {
        const pct  = Math.min(100, Math.round((q.progress / q.goal) * 100));
        const done = q.progress >= q.goal;
        const barColor = done ? '#6a9a20' : (q.type === 'weekly' ? '#8040c0' : q.type === 'unlimited' ? '#c04040' : '#c8a020');
        return `
        <div class="quest-card ${done ? 'quest-done' : ''} ${q.claimed ? 'quest-claimed' : ''}">
            <div class="quest-icon">${q.icon}</div>
            <div class="quest-body">
                <div class="quest-name">${q.name}</div>
                <div class="quest-desc">${q.desc}</div>
                <div class="quest-bar-wrap">
                    <div class="quest-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                </div>
                <div class="quest-progress-text">${q.progress.toLocaleString()} / ${q.goal.toLocaleString()}</div>
            </div>
            <div class="quest-reward">
                <div class="quest-gold">🪙 ${q.gold}</div>
                ${q.xp ? `<div class="quest-xp">+${q.xp} XP</div>` : ''}
                ${q.claimed
                    ? `<div class="quest-claimed-badge">✓ Claimed</div>`
                    : done
                        ? `<button class="quest-claim-btn" onclick="claimQuest('${q.id}')">Claim</button>`
                        : `<div class="quest-pct">${pct}%</div>`
                }
            </div>
        </div>`;
    }).join('');
}

function _questUpdateTimers() {
    const now     = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const secsD    = Math.floor((midnight - now) / 1000);
    const hD = Math.floor(secsD / 3600);
    const mD = Math.floor((secsD % 3600) / 60);

    const dayOfWeek = now.getUTCDay();
    const daysUntilMon = (8 - dayOfWeek) % 7 || 7;
    const nextMon  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMon));
    const secsW    = Math.floor((nextMon - now) / 1000);
    const dW = Math.floor(secsW / 86400);
    const hW = Math.floor((secsW % 86400) / 3600);

    const dTimer = document.getElementById('quest-daily-timer');
    const wTimer = document.getElementById('quest-weekly-timer');
    if (dTimer) dTimer.textContent = `Resets in ${hD}h ${mD}m`;
    if (wTimer) wTimer.textContent = `Resets in ${dW}d ${hW}h`;
}

/* ─── Init ────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
    _questLoad();
    // Club/community quest state has to load proactively here, not just
    // when the Quests screen happens to be opened — _questTick() (called
    // from live gameplay tracking hooks) checks _clubQuestState/
    // _communityQuestState to decide whether to accumulate a
    // contribution. If those stayed null until the player opened the
    // Quests screen, anyone who never opened it during a session would
    // have every one of their club/community contributions silently
    // dropped despite actually playing.
    _questLoadCommunityQuest(); // doesn't depend on auth/club state
    // Club quest depends on knowing which club (if any) the player is
    // in, which isn't settled yet this early — see the matching call in
    // clubs.js's _loadMyClub(), which re-fires this every time club
    // membership is confirmed or changes (login, join, leave, disband).

    // Update timers every minute while screen is open
    setInterval(() => { if (document.getElementById('menu-quests')?.style.display !== 'none') _questUpdateTimers(); }, 60000);
});

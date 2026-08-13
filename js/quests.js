/* ═══════════════════════════════════════════════════════════════════
   DAILY & WEEKLY QUEST SYSTEM  —  quests.js
   ─────────────────────────────────────────────────────────────────
   Structure
   ─────────
   • 3 daily quests  — reset every day at midnight UTC
   • 2 weekly quests — reset every Monday at midnight UTC

   Rewards
   ───────
   • Daily quests give Gold (small amounts)
   • Weekly quests give Gold + XP bonus

   Storage
   ───────
   • localStorage: dr_quest_state  — { dailyIds, weeklyIds, progress, claimed, seed_d, seed_w }
   • Supabase:     synced on claim only (not on progress tick — saves reads/writes)

   Quest pool
   ──────────
   Each quest has:
     id       — unique string
     type     — 'daily' | 'weekly'
     icon     — emoji
     name     — short title
     desc     — what you have to do
     goal     — target number
     stat     — which progress counter to watch
     gold     — gold reward on completion
     xp       — XP reward (weekly only, 0 for daily)

   Progress is tracked via _questTick(stat, amount) called from
   the same tracking hooks used by achievements (trackCardPlayed,
   trackCrit, trackGameEnd, etc.)
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

    _questSave();
}

function _questSave() {
    try { localStorage.setItem(QUEST_KEY, JSON.stringify(_questState)); } catch(e) {}
}

/* ─── Get active quests ───────────────────────────────────────────── */
function _questGetActive() {
    if (!_questState) _questLoad();
    const all = [...QUEST_POOL_DAILY, ...QUEST_POOL_WEEKLY];
    const ids = [...(_questState.dailyIds || []), ...(_questState.weeklyIds || [])];
    return ids.map(id => {
        const def = all.find(q => q.id === id);
        if (!def) return null;
        return {
            ...def,
            progress: _questState['prog_' + id] || 0,
            claimed:  _questState['claimed_' + id] || false,
            type:     id.startsWith('w_') ? 'weekly' : 'daily',
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
    const typeLabel = quest.type === 'weekly' ? 'Weekly Quest' : 'Daily Quest';
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
    const all   = [...QUEST_POOL_DAILY, ...QUEST_POOL_WEEKLY];
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

    // Award XP (weekly only)
    if (def.xp > 0 && typeof awardXP === 'function') {
        setTimeout(() => awardXP(def.xp, 'Quest: ' + def.name), 600);
    }

    // Sync claim to Supabase (fire and forget)
    _questSyncClaim(questId, def);
    if (typeof _recordChallengeCompleted === 'function') _recordChallengeCompleted();

    _questRenderIfOpen();
    playSfx('questComplete');
}

async function _questSyncClaim(questId, def) {
    // quest_claims = personal progression, always home region (see supabase.js)
    const sb  = window._supabaseHome;
    const uid = window._syncedUid;
    if (!sb || !uid) return;
    try {
        await sb.from('quest_claims').insert({
            user_id:   uid,
            quest_id:  questId,
            quest_name:def.name,
            gold:      def.gold,
            xp:        def.xp || 0,
            claimed_at:new Date().toISOString(),
        });
    } catch(e) { /* non-critical */ }
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
}

/* ─── Render ──────────────────────────────────────────────────────── */
function _questRenderIfOpen() {
    const el = document.getElementById('menu-quests');
    if (el && el.style.display !== 'none') _questRender();
}

function _questRender() {
    const quests = _questGetActive();
    const daily  = quests.filter(q => q.type === 'daily');
    const weekly = quests.filter(q => q.type === 'weekly');

    _questRenderGroup('quest-daily-list',  daily);
    _questRenderGroup('quest-weekly-list', weekly);
    _questUpdateTimers();
}

function _questRenderGroup(containerId, quests) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = quests.map(q => {
        const pct  = Math.min(100, Math.round((q.progress / q.goal) * 100));
        const done = q.progress >= q.goal;
        const barColor = done ? '#6a9a20' : (q.type === 'weekly' ? '#8040c0' : '#c8a020');
        return `
        <div class="quest-card ${done ? 'quest-done' : ''} ${q.claimed ? 'quest-claimed' : ''}">
            <div class="quest-icon">${q.icon}</div>
            <div class="quest-body">
                <div class="quest-name">${q.name}</div>
                <div class="quest-desc">${q.desc}</div>
                <div class="quest-bar-wrap">
                    <div class="quest-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                </div>
                <div class="quest-progress-text">${q.progress} / ${q.goal}</div>
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
    // Update timers every minute while screen is open
    setInterval(() => { if (document.getElementById('menu-quests')?.style.display !== 'none') _questUpdateTimers(); }, 60000);
});

/* ═══════════════════════════════════════════════════════════════════
   WEEKLY AUTOMATED TOURNAMENTS
   ---------------------------------------------------------------------
   8-player single-elimination bracket, one per ISO week. Entirely
   client-driven + Supabase realtime broadcast, matching the pattern
   already used by lobby.js/online.js in this codebase (no server-side
   cron exists yet). Whoever opens the tournament screen after the
   entry cutoff and sees a full bracket with no matches yet generates
   it — a unique constraint on (week_key) prevents two clients from
   generating it twice.

   NOTE on the multi-region Supabase split: entries/matches correctly
   stay on the region-switchable client (window._supabase) — they're
   regional "hot path" data, exactly the kind of thing that should stay
   put per-region. Only the final result (tournaments_won, on the
   winner's profile) needs to go through window._supabaseHome instead,
   same as any other profile field — see _wtClaimChampionReward below.

   REQUIRED SUPABASE SCHEMA:
     create table if not exists weekly_tournament_entries (
       id           uuid primary key default gen_random_uuid(),
       week_key     text not null,
       user_id      uuid not null,
       username     text,
       avatar       text,
       seed         int,
       eliminated   boolean default false,
       joined_at    timestamptz default now(),
       unique(week_key, user_id)
     );
     create table if not exists weekly_tournament_matches (
       id           uuid primary key default gen_random_uuid(),
       week_key     text not null,
       round        int not null,
       match_index  int not null,
       p1_id        uuid,
       p2_id        uuid,
       winner_id    uuid,
       code         text,
       played       boolean default false,
       unique(week_key, round, match_index)
     );
     create table if not exists weekly_tournament_state (
       week_key        text primary key,
       bracket_built   boolean default false,
       entries_closed  boolean default false,
       champion_id     uuid
     );
   ═══════════════════════════════════════════════════════════════════ */

const WT_BRACKET_SIZE   = 8;   // players per weekly bracket
const WT_ENTRY_DAYS     = 3;   // entries open Mon–Wed (UTC), bracket runs Thu–Sun
let   _wtState          = null; // cached weekly state for the panel

/* ── ISO week key, e.g. "2026-W05" — same scheme quests.js already uses ── */
function _wtWeekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/* Entries are open for the first WT_ENTRY_DAYS days of the ISO week (UTC) */
function _wtEntriesOpen() {
    const dow = new Date().getUTCDay(); // 0=Sun..6=Sat
    const isoDow = dow === 0 ? 7 : dow; // 1=Mon..7=Sun
    return isoDow <= WT_ENTRY_DAYS;
}

/* ── Open the tournament panel ── */
async function openWeeklyTournament() {
    toggle('menu-tournament', true);
    await _wtRefresh();
}

async function _wtRefresh() {
    const sb  = window._supabase;
    const box = document.getElementById('tournament-body');
    if (!sb || !box) return;
    box.innerHTML = '<div class="lb-loading">Loading…</div>';

    const weekKey = _wtWeekKey();
    const uid = typeof _getOnlineUid === 'function' ? _getOnlineUid() : null;

    try {
        const [{ data: entries }, { data: state }] = await Promise.all([
            sb.from('weekly_tournament_entries').select('*').eq('week_key', weekKey).order('joined_at'),
            sb.from('weekly_tournament_state').select('*').eq('week_key', weekKey).maybeSingle(),
        ]);
        _wtState = { weekKey, entries: entries || [], state: state || null, uid };

        // Bracket not built yet, entries closed, and we have enough players → build it.
        // (unique PK on weekly_tournament_state.week_key means only one client's
        // insert actually lands if several try simultaneously)
        if (!_wtState.state?.bracket_built && !_wtEntriesOpen() && (entries || []).length >= 2) {
            await _wtTryBuildBracket(weekKey, entries);
            return _wtRefresh(); // re-fetch with the freshly built bracket
        }

        _wtRender(box);
    } catch (e) {
        console.warn('[DR Tournament] refresh error', e);
        box.innerHTML = '<div class="lb-loading">Couldn\'t load tournament data.</div>';
    }
}

/* ── Join this week's tournament ── */
async function wtEnterTournament() {
    const sb  = window._supabase;
    const uid = typeof _getOnlineUid === 'function' ? _getOnlineUid() : null;
    if (!sb || !uid) return;
    if (!_wtEntriesOpen()) { _showGoldToast?.('Entries are closed for this week — bracket already running.'); return; }

    const weekKey = _wtWeekKey();
    try {
        await sb.from('weekly_tournament_entries').insert({
            week_key: weekKey,
            user_id:  uid,
            username: _profileData?.username || 'Wanderer',
            avatar:   _profileData?.avatar    || '⚔️',
        });
        _showGoldToast?.('⚔ Entered this week\'s tournament!');
    } catch (e) {
        // unique(week_key,user_id) violation just means "already entered" — fine
    }
    _wtRefresh();
}

/* ── Build the bracket (first client past the cutoff does this) ── */
async function _wtTryBuildBracket(weekKey, entries) {
    const sb = window._supabase;
    // Claim the "build" slot — if this insert fails, someone else already built it.
    const { error } = await sb.from('weekly_tournament_state').insert({
        week_key: weekKey, bracket_built: true, entries_closed: true,
    });
    if (error) return; // someone else got there first

    // Take up to WT_BRACKET_SIZE entrants, shuffle for seeding, byes fill with null
    const pool = [...entries].sort(() => Math.random() - 0.5).slice(0, WT_BRACKET_SIZE);
    while (pool.length < WT_BRACKET_SIZE && pool.length > 1 && (pool.length & (pool.length - 1)) !== 0) {
        pool.push(null); // pad to a power of two with byes if needed
    }

    const matches = [];
    for (let i = 0; i < pool.length; i += 2) {
        const p1 = pool[i], p2 = pool[i + 1] || null;
        matches.push({
            week_key: weekKey, round: 1, match_index: i / 2,
            p1_id: p1?.user_id || null, p2_id: p2?.user_id || null,
            code: `wt-${weekKey}-r1-${i / 2}`,
            // A bye auto-advances the present player
            winner_id: (p1 && !p2) ? p1.user_id : (!p1 && p2) ? p2.user_id : null,
            played: !!((p1 && !p2) || (!p1 && p2)),
        });
    }
    if (matches.length) await sb.from('weekly_tournament_matches').insert(matches);
}

/* ── Render the panel: entry state, bracket, "play now" ── */
function _wtRender(box) {
    const { weekKey, entries, state, uid } = _wtState;
    const iEntered = entries.some(e => e.user_id === uid);
    const open     = _wtEntriesOpen();

    let html = `<div class="tournament-week-label">Week ${weekKey.split('-W')[1]} · ${entries.length}/${WT_BRACKET_SIZE} entered</div>`;

    if (open) {
        html += iEntered
            ? `<div class="tournament-status">You're in! Bracket locks in when entries close.</div>`
            : `<button class="btn primary" onclick="wtEnterTournament()">⚔ Enter This Week's Tournament</button>`;
        box.innerHTML = html;
        return;
    }

    if (!state?.bracket_built) {
        html += entries.length >= 2
            ? `<div class="tournament-status">Bracket is being generated — check back shortly.</div>`
            : `<div class="tournament-status">Not enough players entered this week. Try next week!</div>`;
        box.innerHTML = html;
        return;
    }

    // Bracket exists — fetch + render matches, find the player's current match
    _wtRenderBracket(box, weekKey, uid, html);
}

async function _wtRenderBracket(box, weekKey, uid, headerHtml) {
    const sb = window._supabase;
    const { data: matches } = await sb.from('weekly_tournament_matches')
        .select('*').eq('week_key', weekKey).order('round').order('match_index');
    if (!matches) { box.innerHTML = headerHtml; return; }

    const rounds = {};
    matches.forEach(m => (rounds[m.round] = rounds[m.round] || []).push(m));
    const maxRound = Math.max(...Object.keys(rounds).map(Number));

    let html = headerHtml + '<div class="tournament-bracket">';
    Object.keys(rounds).sort((a, b) => a - b).forEach(r => {
        html += `<div class="tournament-round"><div class="tournament-round-title">Round ${r}</div>`;
        rounds[r].forEach(m => {
            const p1n = m.p1_id ? (m.p1_id === uid ? 'You' : m.p1_id.slice(0, 6)) : 'BYE';
            const p2n = m.p2_id ? (m.p2_id === uid ? 'You' : m.p2_id.slice(0, 6)) : 'BYE';
            const done = m.played;
            const isMine = !done && (m.p1_id === uid || m.p2_id === uid) && m.p1_id && m.p2_id;
            html += `<div class="tournament-match ${done ? 'done' : ''}">
                <span class="${m.winner_id === m.p1_id ? 'wt-winner' : ''}">${p1n}</span> vs
                <span class="${m.winner_id === m.p2_id ? 'wt-winner' : ''}">${p2n}</span>
                ${isMine ? `<button class="btn primary" style="margin-left:8px;font-size:9px;" onclick="_wtPlayMatch('${m.code}','${m.p1_id}','${m.p2_id}')">Play</button>` : ''}
            </div>`;
        });
        html += '</div>';
    });
    html += '</div>';

    const champ = rounds[maxRound]?.[0];
    if (champ?.played && champ.winner_id && (rounds[maxRound + 1] === undefined)) {
        // Only the final round with a decided winner and no next round = champion
        const isFinal = matches.filter(m => m.round === maxRound).length === 1;
        if (isFinal) {
            html += `<div class="tournament-champion">🏆 Champion: ${champ.winner_id === uid ? 'You!' : champ.winner_id.slice(0,6)}</div>`;
            if (champ.winner_id === uid) _wtClaimChampionReward(weekKey);
        }
    }
    box.innerHTML = html;
}

/* ── Start a bracket match using the same 1v1 duel wiring as lobby matches ── */
function _wtPlayMatch(code, p1Id, p2Id) {
    const uid = _getOnlineUid();
    const role = uid === p1Id ? 'host' : 'guest';
    const oppUid = role === 'host' ? p2Id : p1Id;

    _onlineMode   = true;
    _onlineRole   = role;
    _onlineCode   = code;
    _onlineUid    = uid;
    _onlineOppUid = oppUid;
    _wtActiveMatch = { code };

    _broadcastChannel = window._db.broadcast(code);
    _broadcastChannel.on(move => {
        if (!_onlineMode || !move || move.by === _onlineUid) return;
        if (move.type === 'play' && !state.turn) _applyOpponentMove(move);
        else if (move.type === 'chat') _handleIncomingChat(move);
    });
    toggle('menu-tournament', false);
    initGame();
    toggleChat(false); // start minimized, but make the toggle button visible
}

let _wtActiveMatch = null;

/* ── Called when a tournament match ends (hook from trackGameEnd) ── */
async function _wtOnMatchEnd(won) {
    if (!_wtActiveMatch) return;
    const sb = window._supabase;
    const uid = _getOnlineUid();
    const { code } = _wtActiveMatch;
    _wtActiveMatch = null;
    if (!sb || !won) return; // loser doesn't need to write — winner records the result

    try {
        const { data: m } = await sb.from('weekly_tournament_matches').select('*').eq('code', code).maybeSingle();
        if (!m || m.played) return;
        await sb.from('weekly_tournament_matches').update({ winner_id: uid, played: true }).eq('id', m.id);

        // Advance winner into the next round's slot (deterministic bracket math)
        const nextRound = m.round + 1;
        const nextIndex = Math.floor(m.match_index / 2);
        const slotIsP1  = m.match_index % 2 === 0;
        const { data: nextMatch } = await sb.from('weekly_tournament_matches')
            .select('*').eq('week_key', m.week_key).eq('round', nextRound).eq('match_index', nextIndex).maybeSingle();
        if (nextMatch) {
            await sb.from('weekly_tournament_matches')
                .update(slotIsP1 ? { p1_id: uid } : { p2_id: uid }).eq('id', nextMatch.id);
        } else {
            // No next round exists yet — check if this was the final match
            const { data: sameRound } = await sb.from('weekly_tournament_matches')
                .select('id').eq('week_key', m.week_key).eq('round', m.round);
            if ((sameRound || []).length === 1) return; // this WAS the final, champion logic handles it in render
            await sb.from('weekly_tournament_matches').insert({
                week_key: m.week_key, round: nextRound, match_index: nextIndex,
                code: `wt-${m.week_key}-r${nextRound}-${nextIndex}`,
                [slotIsP1 ? 'p1_id' : 'p2_id']: uid,
            });
        }
    } catch (e) {
        console.warn('[DR Tournament] match-end error', e);
    }
}

/* ── Champion reward: gold + tournaments_won (feeds the leaderboard tab) ── */
async function _wtClaimChampionReward(weekKey) {
    const claimedKey = `dr_wt_claimed_${weekKey}`;
    if (localStorage.getItem(claimedKey)) return;
    localStorage.setItem(claimedKey, '1');

    if (typeof shopAwardGold === 'function') shopAwardGold(200);
    _showGoldToast?.('🏆 +200 🪙 Tournament Champion!');
    if (typeof playSfx === 'function') playSfx('tournamentWin');

    // profiles = identity data, always home region (see supabase.js) —
    // your tournament win count shouldn't depend on which region you
    // were playing in when you won.
    const sb  = window._supabaseHome;
    const uid = _getOnlineUid();
    if (!sb || !uid) return;
    try {
        const { data: p } = await sb.from('profiles').select('tournaments_won').eq('id', uid).maybeSingle();
        await sb.from('profiles').update({ tournaments_won: (p?.tournaments_won || 0) + 1 }).eq('id', uid);
    } catch (e) {}
}

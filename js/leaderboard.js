/* LEADERBOARD SYSTEM  –  Firestore backend
   ---------------------------------------------------------------
   Reads from the profiles and clubs collections in Firestore (see
   js/firestore-db.js), not Supabase — leaderboard data has to live
   wherever profiles/clubs actually live, and that's Firebase now,
   independent of whichever Supabase region the player picked for
   matchmaking.
================================================================ */

const _lbState = { tab: 'top-rank', loaded: {} };

function openLeaderboard() {
    playSfx('menuClick');
    toggle('menu-leaderboard', true);
    _fetchLbTab('top-rank');
}

function switchLbTab(id) {
    _lbState.tab = id;
    const tabs = ['top-rank','most-wins','most-losses','club-rank','tournaments','speedrun','challenges'];
    document.querySelectorAll('.lb-tab').forEach((t, i) =>
        t.classList.toggle('active', tabs[i] === id));
    document.querySelectorAll('.lb-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'lb-panel-' + id));
    _fetchLbTab(id);
}

async function _fetchLbTab(id) {
    if (_lbState.loaded[id]) return; // already loaded this session
    const panel = document.getElementById('lb-panel-' + id);
    if (!panel) return;
    panel.innerHTML = '<div class="lb-loading">Loading\u2026</div>';
    try {
        let rows = [];
        if (id === 'top-rank') {
            // Firestore can only orderBy one field server-side per query
            // (no compound level+xp sort without a composite index) — xp
            // is the finer-grained tiebreaker, so sort by that and let
            // level (which moves in much bigger, rarer steps) mostly take
            // care of itself through xp naturally correlating with it.
            const data = await fsList('profiles', { orderByField: 'xp', ascending: false, limit: 20 });
            rows = data.map((r,i) => {
                const tier = typeof levelTier === 'function' ? levelTier(r.level||1) : { label:'Iron', icon:'⚙️' };
                return _lbRow(i, r.avatar||'⚔️', r.username||'Wanderer',
                    `${tier.icon} Lv.${r.level||1} ${tier.label}`, r.xp??0, 'XP', r.id, r.avatar_img, r.equipped_cosmetics);
            });
        } else if (id === 'most-wins') {
            const data = await fsList('profiles', { orderByField: 'wins', ascending: false, limit: 20 });
            rows = data.map((r,i) => _lbRow(i, r.avatar||'\u2694\uFE0F', r.username||'Wanderer',
                null, r.wins??0, 'wins', r.id, r.avatar_img, r.equipped_cosmetics));
        } else if (id === 'most-losses') {
            const data = await fsList('profiles', { orderByField: 'losses', ascending: false, limit: 20 });
            rows = data.map((r,i) => _lbRow(i, r.avatar||'\u2694\uFE0F', r.username||'Wanderer',
                null, r.losses??0, 'losses', r.id, r.avatar_img, r.equipped_cosmetics));
        } else if (id === 'club-rank') {
            const data = await fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 20 });
            rows = data.map((r,i) => _lbRow(i, r.badge||'\u2694\uFE0F', r.name||'Unknown',
                '#'+r.tag, r.trophies??0, 'trophies', null));
        } else if (id === 'tournaments') {
            const data = await fsList('profiles', { orderByField: 'tournaments_won', ascending: false, limit: 20 });
            rows = data.map((r,i) => _lbRow(i, r.avatar||'\u2694\uFE0F', r.username||'Wanderer',
                null, r.tournaments_won??0, 'won', r.id, r.avatar_img, r.equipped_cosmetics));
        } else if (id === 'speedrun') {
            // Firestore's orderBy naturally excludes docs that don't have
            // the field set at all, which is exactly the "only show
            // players with a recorded time" filter the old Postgres
            // `.not('best_time','is',null)` was doing.
            const data = await fsList('profiles', { orderByField: 'best_time', ascending: true, limit: 20 });
            rows = data.filter(r => r.best_time != null).map((r,i) => _lbRow(i, r.avatar||'\u2694\uFE0F', r.username||'Wanderer',
                null, _lbFormatTime(r.best_time), 'fastest win', r.id, r.avatar_img, r.equipped_cosmetics));
        } else if (id === 'challenges') {
            const data = await fsList('profiles', { orderByField: 'challenges_completed', ascending: false, limit: 20 });
            rows = data.map((r,i) => _lbRow(i, r.avatar||'\u2694\uFE0F', r.username||'Wanderer',
                null, r.challenges_completed??0, 'challenges', r.id, r.avatar_img, r.equipped_cosmetics));
        }

        if (rows.length === 0) {
            panel.innerHTML = '<div class="lb-loading">No data yet \u2014 be the first!</div>';
        } else {
            panel.innerHTML = rows.join('');
        }
        _lbState.loaded[id] = true;
    } catch(e) {
        panel.innerHTML = '<div class="lb-loading">Failed to load \u2014 check connection.</div>';
        console.warn('[DR LB] fetch error', e);
    }
}

/* ── Format seconds as m:ss for the speedrun leaderboard ── */
function _lbFormatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function _lbRow(index, avatar, name, sub, value, unit, uid, avatarImg, cosmetics) {
    const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
    const isSelf = uid && uid === _syncedUid;
    // Same fallback pattern as profile.js: a custom uploaded photo
    // (avatar_img) takes priority over the emoji avatar. The emoji field
    // never gets cleared when someone uploads a real photo, so reading
    // only `avatar` here meant everyone with a custom pfp still showed
    // the default ⚔️ on the leaderboard.
    const avatarHtml = avatarImg
        ? `<img src="${avatarImg}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
        : avatar;
    const escapedName = _clubEsc(name);
    const namePlate = typeof renderNamePlate === 'function' ? renderNamePlate(escapedName, cosmetics) : escapedName;
    return `<div class="lb-row${isSelf?' is-self':''}">
        <span class="lb-rank ${rankClass}">${index+1}</span>
        <span class="lb-avatar">${avatarHtml}</span>
        <span class="lb-name-col">
            <span class="lb-name">${namePlate}${isSelf?' <span style="color:#c8a460;font-size:7px;">(you)</span>':''}</span>
            ${sub ? `<span class="lb-sub">${_clubEsc(sub)}</span>` : ''}
        </span>
        <span class="lb-value">${value}<span>${unit}</span></span>
    </div>`;
}

/* ===================== END LEADERBOARD SYSTEM ===================== */

/* CLUBS SYSTEM  –  Firestore backend
   ---------------------------------------------------------------
   Uses Firestore (via js/firestore-db.js), not Supabase — clubs are
   identity/progression data like profiles, and club membership is
   tracked via profiles.club_id, so this has to live in the same
   database as profiles regardless of which Supabase region the player
   picked for matchmaking (see the comment above window._supabaseHome's
   definition in supabase.js for why that split exists at all).

   Firestore collection: clubs/{clubId}
     { name, tag, badge, description, owner_id, wins, trophies,
       win_streak, created_at }
   profiles/{uid} gains a club_id field pointing at a clubs/{id} doc.

   Firestore has no server-side OR/ILIKE search the way Postgres did —
   searchClubs() below fetches a bounded, trophy-ordered batch and
   filters client-side instead of trying to fake full-text search.

   Security rules (Firestore console → Rules), matching the old RLS
   policies' intent:

     match /clubs/{clubId} {
       allow read: if true;
       allow create: if request.auth != null;
       allow update, delete: if request.auth != null
                              && request.auth.uid == resource.data.owner_id;
     }
   ---------------------------------------------------------------
   Local state:
     _clubsState.myClub  — club object the user belongs to, or null
     _clubsState.myRole  — 'owner' | 'member' | null
================================================================ */

const _clubsState = { myClub: null, myRole: null, bigTab: 'myclub', subTab: 'overview' };

/* Sub-tabs available under each big tab. Some are conditional (settings
   only for the president, tournament/settings only while in a club) —
   filtered at render time in _clubsRenderSubTabs(). */
const CLUBS_SUBTABS = {
    myclub:   [
        { id: 'overview', label: 'Overview' },
        { id: 'settings', label: 'Settings', ownerOnly: true },
    ],
    rankings: [
        { id: 'club-rank',  label: 'Club Ranking' },
        { id: 'member-lb',  label: 'Member Leaderboard' },
    ],
    browse: [
        { id: 'browse',     label: 'Browse Clubs' },
        { id: 'tournament', label: 'Tournaments', needsClub: true },
    ],
};

function openClubs() {
    playSfx('menuClick');
    toggle('menu-clubs', true);
    _loadMyClub().then(() => switchClubsBigTab('myclub'));
}

function switchClubsBigTab(bigTabId) {
    _clubsState.bigTab = bigTabId;
    document.querySelectorAll('#clubs-bigtabs .clubs-tab').forEach(t =>
        t.classList.toggle('active', t.id === 'clubs-bigtab-' + bigTabId));
    _clubsRenderSubTabs(bigTabId);
    // Default to that group's first (visible) sub-tab
    const first = CLUBS_SUBTABS[bigTabId].find(s => !s.ownerOnly || _clubsState.myRole === 'owner');
    switchClubsSubTab(first ? first.id : CLUBS_SUBTABS[bigTabId][0].id);
}

function _clubsRenderSubTabs(bigTabId) {
    const bar = document.getElementById('clubs-subtabs');
    if (!bar) return;
    const inClub = !!_clubsState.myClub;
    const isOwner = _clubsState.myRole === 'owner';
    const visible = CLUBS_SUBTABS[bigTabId].filter(s =>
        (!s.ownerOnly || isOwner) && (!s.needsClub || inClub));
    bar.innerHTML = visible.map(s =>
        `<button class="clubs-subtab" id="clubs-subtab-${s.id}" onclick="switchClubsSubTab('${s.id}')">${s.label}</button>`
    ).join('');
}

function switchClubsSubTab(id) {
    _clubsState.subTab = id;
    document.querySelectorAll('.clubs-subtab').forEach(t =>
        t.classList.toggle('active', t.id === 'clubs-subtab-' + id));
    document.querySelectorAll('.clubs-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'clubs-panel-' + id));

    if (id === 'overview')    { _renderMyClub(_clubsState.myClub); _openClubChat(); }
    else                      _closeClubChat();
    if (id === 'settings')    _clubSettingsPopulate();
    if (id === 'club-rank')   _loadClubRanking();
    if (id === 'member-lb')   _loadMemberLeaderboard();
    if (id === 'browse')      searchClubs();
    if (id === 'tournament')  _loadClubTournamentTab();
}

function _clubsSetTabVisibility(inClub) {
    // Re-render whichever sub-tab bar is currently showing, since
    // owner-only / needs-club sub-tabs can appear or disappear the moment
    // you join, leave, create, or get promoted.
    _clubsRenderSubTabs(_clubsState.bigTab);
    // Show/hide the no-club action buttons vs guest badge
    const authedBtns = document.getElementById('clubs-no-club-authed');
    const guestBadge = document.getElementById('clubs-no-club-guest');
    const isLoggedIn = !!_syncedUid;
    if (authedBtns) authedBtns.style.display = (!inClub && isLoggedIn) ? 'flex' : 'none';
    if (guestBadge) guestBadge.style.display  = (!inClub && !isLoggedIn) ? '' : 'none';
    // If the sub-tab we were on just became unavailable (e.g. left a club
    // while on Settings), fall back to Overview instead of showing a dead panel.
    const stillVisible = CLUBS_SUBTABS[_clubsState.bigTab]
        .some(s => s.id === _clubsState.subTab && (!s.ownerOnly || _clubsState.myRole==='owner') && (!s.needsClub || inClub));
    if (!stillVisible) switchClubsSubTab('overview');
}

function _clubsOpenCreateModal() {
    const modal = document.getElementById('clubs-create-modal');
    if (modal) modal.style.display = 'flex';
}

function _clubsCloseCreateModal() {
    const modal = document.getElementById('clubs-create-modal');
    if (modal) modal.style.display = 'none';
    const status = document.getElementById('club-create-status');
    if (status) status.textContent = '';
}

async function _loadMyClub() {
    if (!_syncedUid) { _renderMyClub(null); _refreshClubQuestState(); return; }
    try {
        const profile = await fsGet('profiles', _syncedUid);
        if (!profile?.club_id) { _renderMyClub(null); _refreshClubQuestState(); return; }
        const club = await fsGet('clubs', profile.club_id);
        _clubsState.myClub = club || null;
        _clubsState.myRole = club?.owner_id === _syncedUid ? 'owner' : 'member';
        _renderMyClub(club);
        _refreshClubQuestState();
    } catch(e) {
        console.warn('[DR Clubs] _loadMyClub error', e);
        _renderMyClub(null);
        _refreshClubQuestState();
    }
}

/* Re-syncs the club quest system (quests.js) whenever club membership is
   confirmed or changes — join, leave, create, disband, initial login.
   Without this, _clubQuestState in quests.js would stay stuck on
   whatever club (or lack of one) was active when the page first loaded,
   silently misdirecting or dropping contributions after switching clubs. */
function _refreshClubQuestState() {
    if (typeof _questLoadClubQuest === 'function') _questLoadClubQuest();
}

/* ── Club Settings modal (president only) ──
   Now an inline sub-tab (My Club → Settings) rather than a popup modal —
   two tabs inside it: "Edit Club Content" (name/tag/badge/description/
   max members/visibility) and "Danger Zone" (disband). Reuses the same
   fields/validation as createClub() where it makes sense (tag/name
   uniqueness). */

function _clubSettingsPopulate() {
    if (_clubsState.myRole !== 'owner' || !_clubsState.myClub) return;
    const club = _clubsState.myClub;
    const nameEl  = document.getElementById('cs-edit-name');
    const tagEl   = document.getElementById('cs-edit-tag');
    const badgeEl = document.getElementById('cs-edit-badge');
    const descEl  = document.getElementById('cs-edit-desc');
    const maxEl   = document.getElementById('cs-edit-maxmembers');
    if (nameEl)  nameEl.value  = club.name || '';
    if (tagEl)   tagEl.value   = club.tag  || '';
    if (badgeEl) badgeEl.value = club.badge || '⚔️';
    if (descEl)  descEl.value  = club.description || '';
    if (maxEl)   maxEl.value   = club.max_members || 50;
    document.querySelectorAll('#cs-edit-visibility .settings-opt-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (club.visibility || 'public')));
    _clubSetTxt('cs-edit-status', '');
    _clubSetTxt('cs-danger-status', '');
    _clubSettingsSwitchTab('content');
}

function _clubSettingsSelectVisibility(btn) {
    document.querySelectorAll('#cs-edit-visibility .settings-opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function _clubSettingsSwitchTab(tab) {
    const contentTab = document.getElementById('cs-tab-content');
    const dangerTab  = document.getElementById('cs-tab-danger');
    const contentPanel = document.getElementById('cs-panel-content');
    const dangerPanel  = document.getElementById('cs-panel-danger');
    const isContent = tab === 'content';
    if (contentTab)   { contentTab.style.color = isContent ? '#e8c870' : '#6b4f2a'; contentTab.style.borderBottomColor = isContent ? '#c8a460' : 'transparent'; }
    if (dangerTab)    { dangerTab.style.color  = !isContent ? '#e8c870' : '#6b4f2a'; dangerTab.style.borderBottomColor  = !isContent ? '#c8a460' : 'transparent'; }
    if (contentPanel) contentPanel.style.display = isContent ? '' : 'none';
    if (dangerPanel)  dangerPanel.style.display  = !isContent ? '' : 'none';
}

async function _clubSettingsSave() {
    const status = document.getElementById('cs-edit-status');
    if (_clubsState.myRole !== 'owner' || !_clubsState.myClub) { if (status) status.textContent = 'Only the club president can edit this.'; return; }
    const club   = _clubsState.myClub;
    const name   = (document.getElementById('cs-edit-name')?.value  || '').trim();
    const tag    = (document.getElementById('cs-edit-tag')?.value   || '').trim().toUpperCase();
    const badge  = (document.getElementById('cs-edit-badge')?.value || '⚔️').trim();
    const desc   = (document.getElementById('cs-edit-desc')?.value  || '').trim();
    const maxMembersRaw = parseInt(document.getElementById('cs-edit-maxmembers')?.value, 10);
    const maxMembers = Number.isFinite(maxMembersRaw) ? Math.min(200, Math.max(2, maxMembersRaw)) : 50;
    const visBtn = document.querySelector('#cs-edit-visibility .settings-opt-btn.active');
    const visibility = visBtn?.dataset.val || 'public';
    if (!name)          { if (status) status.textContent = 'Club name required.';     return; }
    if (tag.length < 3) { if (status) status.textContent = 'Tag must be 3–5 chars.'; return; }

    if (status) status.textContent = 'Saving…';
    try {
        // Same uniqueness check as createClub() — only flag a conflict if
        // the taken name/tag belongs to a DIFFERENT club than this one
        // (otherwise editing without changing the name/tag would always
        // "conflict" with itself).
        if (tag !== club.tag) {
            const tagTaken = await fsWhere('clubs', 'tag', tag, 1);
            if (tagTaken.length && tagTaken[0].id !== club.id) { if (status) status.textContent = 'That tag is already taken.'; return; }
        }
        if (name !== club.name) {
            const nameTaken = await fsWhere('clubs', 'name', name, 1);
            if (nameTaken.length && nameTaken[0].id !== club.id) { if (status) status.textContent = 'That name is already taken.'; return; }
        }

        const { error } = await fsUpdate('clubs', club.id, { name, tag, badge, description: desc, max_members: maxMembers, visibility });
        if (error) { if (status) status.textContent = error.message || 'Error — try again.'; return; }

        Object.assign(_clubsState.myClub, { name, tag, badge, description: desc, max_members: maxMembers, visibility });
        _renderMyClub(_clubsState.myClub);
        if (status) status.textContent = 'Saved!';
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] settings save error', e);
    }
}

async function _clubSettingsDelete() {
    const status = document.getElementById('cs-danger-status');
    if (_clubsState.myRole !== 'owner' || !_clubsState.myClub) { if (status) status.textContent = 'Only the club president can do this.'; return; }
    const club = _clubsState.myClub;
    if (!confirm(`Disband ${club.name}? This removes every member and cannot be undone.`)) return;

    if (status) status.textContent = 'Disbanding…';
    try {
        // Firestore has no FK cascade — clearing club_id off every member's
        // profile has to happen explicitly, or they'd be left pointing at
        // a club document that no longer exists.
        const members = await fsWhere('profiles', 'club_id', club.id, 200);
        await Promise.all(members.map(m => fsUpdate('profiles', m.id, { club_id: null })));
        await fsDelete('clubs', club.id);

        _clubsState.myClub = null;
        _clubsState.myRole = null;
        _renderMyClub(null);
        _refreshClubQuestState();
        switchClubsBigTab('myclub');
        if (typeof _showGoldToast === 'function') _showGoldToast(`${club.name} has been disbanded.`);
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] disband error', e);
    }
}

function _renderMyClub(club) {
    const noClub = document.getElementById('clubs-no-club');
    const myCard = document.getElementById('clubs-my-club-card');
    _clubsSetTabVisibility(!!club); // also handles falling back off now-hidden sub-tabs
    if (!club) {
        if (noClub) noClub.style.display = '';
        if (myCard) myCard.style.display = 'none';
        document.getElementById('clubs-bigtab-myclub').textContent = 'My Club';
        return;
    }
    if (noClub) noClub.style.display = 'none';
    if (myCard) myCard.style.display = '';
    _clubSetTxt('my-club-badge',    club.badge || '⚔️');
    _clubSetTxt('my-club-name',     club.name);
    _clubSetTxt('my-club-tag',      '#' + club.tag);
    _clubSetTxt('my-club-desc',     club.description || '');
    _clubSetTxt('my-club-wins',     club.wins       ?? 0);
    _clubSetTxt('my-club-trophies', club.trophies   ?? 0);
    _clubSetTxt('my-club-streak',   club.win_streak ?? 0);

    // The "My Club" big tab shows the actual club's name for members
    // (presidents keep seeing "My Club", since it's unambiguously theirs).
    const bigTabEl = document.getElementById('clubs-bigtab-myclub');
    if (bigTabEl) bigTabEl.textContent = (_clubsState.myRole === 'owner') ? 'My Club' : club.name;

    // Presidents can't leave — they have to disband instead (Danger Zone,
    // under Settings). Showing "Leave" and then telling them "no, disband
    // instead" after they click it was just confusing, so it's hidden
    // outright for the president rather than shown-then-blocked.
    const leaveBtn = document.getElementById('clubs-leave-btn');
    if (leaveBtn) leaveBtn.style.display = (_clubsState.myRole === 'owner') ? 'none' : '';

    // Member count + global rank — previously left permanently at their
    // hardcoded "0"/"#—" placeholders since nothing ever populated them.
    fsWhere('profiles', 'club_id', club.id, 200).then(members => {
        _clubSetTxt('my-club-members', members.length);
        _renderClubMemberList(members, club);
    });
    fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 200 }).then(ranked => {
        const idx = ranked.findIndex(c => c.id === club.id);
        _clubSetTxt('my-club-rank', idx >= 0 ? '#' + (idx + 1) : '#—');
    });
}

async function _loadClubRanking() {
    const list = document.getElementById('clubs-rank-list');
    if (!list) return;
    try {
        const ranked = await fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 500 });
        if (!ranked.length) {
            list.innerHTML = `<div class="clubs-auth-notice">
                <div class="clubs-auth-icon">🏆</div>
                <div class="clubs-auth-msg">No Clubs Yet</div>
                <div class="clubs-auth-sub">Be the first to create one and top this board.</div>
            </div>`;
            return;
        }
        const myId = _clubsState.myClub?.id;
        const myIdx = myId ? ranked.findIndex(c => c.id === myId) : -1;
        // In a club: show 4 above + your club + 4 below. Not in one (or
        // not found in the batch): just show the top 10 instead.
        let windowClubs, startRank;
        if (myIdx >= 0) {
            const start = Math.max(0, myIdx - 4);
            windowClubs = ranked.slice(start, start + 9);
            startRank = start + 1;
        } else {
            windowClubs = ranked.slice(0, 10);
            startRank = 1;
        }
        const rc = ['gold','silver','bronze'];
        list.innerHTML = (myIdx >= 0 ? `<div class="clubs-col-label">Around Your Club</div>` : `<div class="clubs-col-label">Top Clubs</div>`) +
            windowClubs.map((c, i) => {
                const rank = startRank + i;
                return `
            <div class="club-lb-row ${c.id === myId ? 'club-lb-row-mine' : ''}" style="cursor:pointer;" onclick="_clubBrowseToggle('${_clubEsc(c.id)}','rank')">
                <span class="club-lb-rank ${rc[rank-1]||''}">${rank}</span>
                <span class="club-lb-avatar">${c.badge||'⚔️'}</span>
                <span class="club-lb-name">${_clubEsc(c.name)}
                    <span style="color:#6b4f2a;font-size:8px;">#${_clubEsc(c.tag)}</span></span>
                <span class="club-lb-score">${c.trophies??0} ✦</span>
            </div>
            <div class="club-browse-expand" id="club-browse-expand-rank-${_clubEsc(c.id)}" style="display:none;" onclick="event.stopPropagation()"></div>`;
            }).join('');
    } catch(e) {
        console.warn('[DR Clubs] _loadClubRanking error', e);
        list.innerHTML = `<div class="clubs-auth-notice">
            <div class="clubs-auth-icon">⚠️</div>
            <div class="clubs-auth-sub">Couldn't load the ranking — try again in a moment.</div>
        </div>`;
    }
}

/* ── Member Leaderboard — your own club's members, ranked by wins ── */
async function _loadMemberLeaderboard() {
    const list = document.getElementById('clubs-member-lb-list');
    if (!list) return;
    if (!_clubsState.myClub) {
        list.innerHTML = `<div class="clubs-auth-notice">
            <div class="clubs-auth-icon">🏆</div>
            <div class="clubs-auth-msg">Member Leaderboard</div>
            <div class="clubs-auth-sub">Join a club to see this.</div>
        </div>`;
        return;
    }
    try {
        const members = await fsWhere('profiles', 'club_id', _clubsState.myClub.id, 200);
        if (!members.length) { list.innerHTML = `<div class="clubs-auth-notice"><div class="clubs-auth-sub">No members found.</div></div>`; return; }
        const ranked = [...members].sort((a,b) => (b.wins||0) - (a.wins||0));
        const rc = ['gold','silver','bronze'];
        list.innerHTML = ranked.map((m, i) => `
            <div class="club-lb-row" style="cursor:pointer;" onclick="_lobbyViewProfile('${_clubEsc(m.id)}')">
                <span class="club-lb-rank ${rc[i]||''}">${i+1}</span>
                <span class="club-lb-avatar">${m.avatar||'⚔️'}</span>
                <span class="club-lb-name">${_clubEsc(m.username||'Wanderer')}
                    ${m.id === _clubsState.myClub.owner_id ? '<span title="President">👑</span>' : ''}</span>
                <span class="club-lb-score">${m.wins??0} wins</span>
            </div>`).join('');
    } catch(e) {
        console.warn('[DR Clubs] _loadMemberLeaderboard error', e);
        list.innerHTML = `<div class="clubs-auth-notice"><div class="clubs-auth-sub">Couldn't load — try again.</div></div>`;
    }
}

async function searchClubs() {
    const q   = (document.getElementById('clubs-search-input')?.value||'').trim().toLowerCase();
    const out = document.getElementById('clubs-browse-list');
    if (!out) return;
    try {
        // Firestore can't do OR/ILIKE server-side — fetch a bounded batch
        // ordered by trophies and filter client-side against name/tag when
        // there's a search term. Fine at club-list scale; would need a
        // real search index (Algolia etc) if the club count ever got huge.
        const batch = await fsList('clubs', { orderByField: 'trophies', ascending: false, limit: q ? 100 : 15 });
        let clubs = q
            ? batch.filter(c => (c.name||'').toLowerCase().includes(q) || (c.tag||'').toLowerCase().includes(q)).slice(0, 15)
            : batch;
        // Invite-only clubs are hidden from casual/trending browsing, but
        // still reachable via an exact name/tag match — otherwise a
        // president couldn't actually get anyone in (Firestore doc ids
        // aren't public, so there'd be no way to join at all).
        const exactMatch = c => (c.tag||'').toLowerCase() === q || (c.name||'').toLowerCase() === q;
        clubs = clubs.filter(c => c.visibility !== 'invite' || (q && exactMatch(c)));
        if (!clubs || clubs.length === 0) {
            out.innerHTML = '<div class="clubs-auth-notice" style="padding-top:12px;"><div class="clubs-auth-sub">No clubs found.</div></div>';
            return;
        }
        // Clicking a card expands it in place (president, member count,
        // description, a real Join button) instead of instantly joining on
        // click — a single misclick used to join you into a club with no
        // confirmation at all.
        out.innerHTML = clubs.map(c => `
            <div class="club-card club-browse-card" id="club-browse-browse-${_clubEsc(c.id)}" style="cursor:pointer;" onclick="_clubBrowseToggle('${_clubEsc(c.id)}','browse')">
                <div class="club-card-header">
                    <div class="club-badge">${c.badge||'⚔️'}</div>
                    <div class="club-info">
                        <div class="club-name">${_clubEsc(c.name)}</div>
                        <div class="club-meta">${c.wins??0} wins · ${c.trophies??0} trophies</div>
                    </div>
                    <span class="club-tag">#${_clubEsc(c.tag)}</span>
                </div>
                ${c.description?`<div class="club-desc">${_clubEsc(c.description)}</div>`:''}
                <div class="club-browse-expand" id="club-browse-expand-browse-${_clubEsc(c.id)}" style="display:none;" onclick="event.stopPropagation()"></div>
            </div>`).join('');
    } catch(e) { console.warn('[DR Clubs] searchClubs error', e); }
}

/* ── Expand/collapse a browse card in place ──
   Loads the president's name and member count (and — reserved for
   later — a spot for club strikes) the first time a card is opened,
   then shows a real Join button rather than joining on click. */
async function _clubBrowseToggle(clubId, ctx) {
    ctx = ctx || 'browse';
    // Reused by both the Browse tab and the Club Ranking tab — scoped by
    // ctx since the same club can legitimately appear in both lists in
    // the same session, and reusing one shared id per club would create
    // duplicate DOM ids (one from each panel) — getElementById only ever
    // returns the first match, so whichever panel wasn't first in the
    // page would silently target the wrong (often hidden) element.
    const expandEl = document.getElementById('club-browse-expand-' + ctx + '-' + clubId);
    if (!expandEl) return;

    // Check the actual DOM state directly, rather than a separately
    // tracked open/closed Set — the list HTML gets regenerated fresh on
    // every search keystroke and every tab revisit, which reset the DOM
    // back to collapsed without ever clearing that tracking Set. Once out
    // of sync, a click would see "already open" from stale tracking and
    // just re-set display:none on something already none — clicking
    // would silently do nothing at all.
    const isOpen = expandEl.style.display === 'block';
    if (isOpen) {
        expandEl.style.display = 'none';
        return;
    }
    expandEl.style.display = 'block';
    expandEl.innerHTML = '<div style="font-family:\'Cinzel\',serif;font-size:9px;color:rgba(100,65,20,0.5);padding:8px 0;">Loading…</div>';

    try {
        const club = await fsGet('clubs', clubId);
        if (!club) { expandEl.innerHTML = '<div style="font-size:9px;color:#c0392b;">Club not found.</div>'; return; }
        const [president, members] = await Promise.all([
            club.owner_id ? fsGet('profiles', club.owner_id) : null,
            fsWhere('profiles', 'club_id', clubId, 200),
        ]);
        const alreadyInAClub = !!_clubsState.myClub;
        const isMyOwnClub    = _clubsState.myClub?.id === clubId;

        expandEl.innerHTML = `
            <div class="club-browse-detail">
                <div class="club-browse-row"><span class="club-browse-label">President</span>
                    <span class="club-browse-val" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="event.stopPropagation(); _lobbyViewProfile('${_clubEsc(club.owner_id||'')}')">${president ? _clubEsc(president.username||'Unknown') : 'Unknown'}</span></div>
                <div class="club-browse-row"><span class="club-browse-label">Members</span>
                    <span class="club-browse-val">${members.length}</span></div>
                ${members.length ? `<div class="club-browse-members">${members.slice(0,12).map(m =>
                    `<span class="club-browse-member-chip" style="cursor:pointer;" onclick="event.stopPropagation(); _lobbyViewProfile('${_clubEsc(m.id)}')">${m.avatar||'⚔️'} ${_clubEsc(m.username||'Wanderer')}</span>`).join('')}</div>` : ''}
                <!-- Reserved: club strikes go here once that system exists -->
                ${isMyOwnClub
                    ? `<div class="club-browse-you" style="margin-top:8px;">This is your club.</div>`
                    : alreadyInAClub
                        ? `<button class="clubs-search-btn" style="width:100%;padding:8px 0;margin-top:8px;" onclick="event.stopPropagation(); _clubRankChallenge('${_clubEsc(clubId)}', this)">⚔ Challenge</button>`
                        : `<button class="clubs-search-btn" style="width:100%;padding:8px 0;margin-top:8px;" onclick="event.stopPropagation(); joinClubById('${_clubEsc(clubId)}')">⚔ Join ${_clubEsc(club.name)}</button>`
                }
            </div>`;
    } catch(e) {
        expandEl.innerHTML = '<div style="font-size:9px;color:#c0392b;">Failed to load — try again.</div>';
        console.warn('[DR Clubs] browse expand error', e);
    }
}

function _refreshCreatePanel() {
    const authed   = document.getElementById('clubs-create-authed');
    const unauthed = document.getElementById('clubs-create-unauthed');
    if (!authed || !unauthed) return;
    authed.style.display   = _syncedUid ? 'flex' : 'none';
    unauthed.style.display = _syncedUid ? 'none' : '';
}

async function createClub() {
    const statusEl = document.getElementById('club-create-status');
    if (!_syncedUid) { if (statusEl) statusEl.textContent = 'Sign in first.'; return; }
    const name  = (document.getElementById('club-create-name')?.value  ||'').trim();
    const tag   = (document.getElementById('club-create-tag')?.value   ||'').trim().toUpperCase();
    const badge = (document.getElementById('club-create-badge')?.value ||'⚔️').trim();
    const desc  = (document.getElementById('club-create-desc')?.value  ||'').trim();
    if (!name)          { if (statusEl) statusEl.textContent = 'Club name required.';       return; }
    if (tag.length < 3) { if (statusEl) statusEl.textContent = 'Tag must be 3–5 chars.';   return; }
    if (_clubsState.myClub) { if (statusEl) statusEl.textContent = 'Leave current club first.'; return; }
    if (statusEl) statusEl.textContent = 'Creating…';
    try {
        // Firestore has no unique-column constraint like Postgres did, so
        // name/tag uniqueness has to be checked explicitly here. Not
        // perfectly race-proof against two simultaneous creates (would
        // need a Firestore transaction on a reserved-names doc for that),
        // but club creation is rare enough that this is a reasonable
        // trade-off rather than adding real transaction machinery for it.
        const [tagTaken, nameTaken] = await Promise.all([
            fsWhere('clubs', 'tag', tag, 1),
            fsWhere('clubs', 'name', name, 1),
        ]);
        if (tagTaken.length)  { if (statusEl) statusEl.textContent = 'That tag is already taken.';  return; }
        if (nameTaken.length) { if (statusEl) statusEl.textContent = 'That name is already taken.'; return; }

        const { id: clubId, error } = await fsAdd('clubs', {
            name, tag, badge, description: desc, owner_id: _syncedUid,
            wins: 0, trophies: 0, win_streak: 0,
            max_members: 50, visibility: 'public',
            created_at: new Date().toISOString(),
        });
        if (error) { if (statusEl) statusEl.textContent = error.message || 'Error — try again.'; return; }
        const club = { id: clubId, name, tag, badge, description: desc, owner_id: _syncedUid, wins: 0, trophies: 0, win_streak: 0, max_members: 50, visibility: 'public' };
        // Awaited (not fire-and-forget) — if the Clubs screen gets closed
        // and reopened quickly after creating, openClubs() re-fetches from
        // Firestore via _loadMyClub(), and a fire-and-forget write here
        // could easily lose that race, making a freshly-created club
        // "disappear" until the write eventually landed.
        await fsUpdate('profiles', _syncedUid, { club_id: clubId });
        _clubsState.myClub = club;
        _clubsState.myRole = 'owner';
        _refreshClubQuestState();
        if (statusEl) statusEl.textContent = 'Club founded!';
        if (typeof playSfx === 'function') playSfx('clubCreate');
        setTimeout(_clubsCloseCreateModal, 1200);
        setTimeout(() => switchClubsBigTab('myclub'), 1000);
    } catch(e) {
        if (statusEl) statusEl.textContent = 'Error — try again.';
        console.warn('[DR Clubs] createClub error', e);
    }
}

async function joinClubById(clubId) {
    if (!_syncedUid) { _showGoldToast('Sign in to join a club.'); return; }
    if (_clubsState.myClub) { _showGoldToast('Leave your current club first.'); return; }
    try {
        const [club, members] = await Promise.all([
            fsGet('clubs', clubId),
            fsWhere('profiles', 'club_id', clubId, 250),
        ]);
        if (!club) { _showGoldToast('Club not found.'); return; }
        const cap = club.max_members || 50;
        if (members.length >= cap) { _showGoldToast(`${club.name} is full (${cap}/${cap} members).`); return; }

        await fsUpdate('profiles', _syncedUid, { club_id: clubId });
        await _loadMyClub();
        switchClubsBigTab('myclub');
        if (typeof playSfx === 'function') playSfx('clubJoin');
    } catch(e) { console.warn('[DR Clubs] joinClubById error', e); }
}

async function leaveClub() {
    if (!_syncedUid || !_clubsState.myClub) return;
    if (_clubsState.myRole === 'owner') {
        if (typeof _showGoldToast === 'function') _showGoldToast('Presidents must disband the club instead of leaving.');
        else alert('Presidents must disband the club instead of leaving.');
        return;
    }
    if (!confirm('Leave ' + _clubsState.myClub.name + '?')) return;
    try {
        await fsUpdate('profiles', _syncedUid, { club_id: null });
        _clubsState.myClub = null;
        _clubsState.myRole = null;
        _renderMyClub(null);
        _refreshClubQuestState();
    } catch(e) { console.warn('[DR Clubs] leaveClub error', e); }
}

/* ── Member list (right column of Overview) ──
   Clicking a member opens their profile — reuses the exact same
   profile-view modal/function the lobby screen already built
   (_lobbyViewProfile in lobby.js), since it's a self-contained,
   uid-only function with no lobby-specific dependency. */
function _renderClubMemberList(members, club) {
    const list = document.getElementById('clubs-member-list');
    if (!list) return;
    if (!members.length) { list.innerHTML = '<div style="font-size:9px;color:rgba(100,65,20,0.5);">No members found.</div>'; return; }

    const sorted = [...members].sort((a, b) => {
        if (a.id === club.owner_id) return -1;
        if (b.id === club.owner_id) return 1;
        return (b.wins || 0) - (a.wins || 0);
    });
    list.innerHTML = sorted.map(m => `
        <div class="clubs-member-row" onclick="_lobbyViewProfile('${_clubEsc(m.id)}')">
            <span class="clubs-member-avatar">${m.avatar || '⚔️'}</span>
            <span class="clubs-member-name">${_clubEsc(m.username || 'Wanderer')}</span>
            ${m.id === club.owner_id ? '<span class="clubs-member-crown" title="President">👑</span>' : ''}
        </div>`).join('');
}

function _clubSetTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _clubEsc(s) {
    return String(s??'').replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ── Club chat ──
   Supabase Realtime broadcast only — same pattern as the lobby chat in
   lobby.js (sb.channel(...).on('broadcast', ...)). Nothing gets written
   to or read from any database table for this; messages only exist for
   as long as they're in transit between currently-connected clients,
   which keeps server reads/writes at zero regardless of how chatty a
   club is. The trade-off (by design, matching how lobby chat already
   works): message history isn't persisted, so it's empty again next
   time you open the tab. */
let _clubChatChannel = null;

function _openClubChat() {
    if (!_clubsState.myClub) return;
    if (_clubChatChannel && _clubChatChannel._clubId === _clubsState.myClub.id) return; // already connected to this club's channel
    _closeClubChat();

    const sb = window._supabase;
    if (!sb) return;
    const ch = sb.channel('club-chat-' + _clubsState.myClub.id, {
        config: { broadcast: { self: false } }
    });
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => _receiveClubChatMessage(payload));
    ch.subscribe();
    ch._clubId = _clubsState.myClub.id;
    _clubChatChannel = ch;

    const log = document.getElementById('club-chat-log');
    if (log) log.innerHTML = '<div class="club-chat-system">Connected — messages aren\'t saved, only visible while you\'re both here.</div>';
}

function _closeClubChat() {
    if (_clubChatChannel) { _clubChatChannel.unsubscribe(); _clubChatChannel = null; }
}

function sendClubChatMessage() {
    const input = document.getElementById('club-chat-input');
    if (!input || !_clubChatChannel) return;
    const text = input.value.trim();
    if (!text) return;
    const msg = {
        uid:  _syncedUid || _getOnlineUid?.(),
        name: (typeof _getDisplayName === 'function') ? _getDisplayName() : 'Wanderer',
        text: text.slice(0, 200),
        ts:   Date.now(),
    };
    _renderClubChatMessage(msg, true);   // show our own immediately (broadcast excludes sender)
    _clubChatChannel.send({ type: 'broadcast', event: 'chat', payload: msg });
    input.value = '';
}

function _receiveClubChatMessage(msg) { _renderClubChatMessage(msg, false); }

function _renderClubChatMessage(msg, isMe) {
    const log = document.getElementById('club-chat-log');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'club-chat-msg' + (isMe ? ' club-chat-msg-mine' : '');
    el.innerHTML = `<span class="club-chat-name" onclick="_lobbyViewProfile('${_clubEsc(msg.uid||'')}')">${_clubEsc(msg.name)}</span>: ${_clubEsc(msg.text)}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
}

/* ===================== END CLUBS SYSTEM ===================== */

/* ═══════════════════════════════════════════════════════════════════════
   CLUB TOURNAMENTS
   SQL to run in Supabase SQL Editor:
   ─────────────────────────────────────────────────────────────────────
   create table club_tournaments (
     id            uuid primary key default gen_random_uuid(),
     challenger_id uuid references clubs(id) on delete cascade,
     defender_id   uuid references clubs(id) on delete cascade,
     status        text default 'pending',  -- pending | active | done
     challenger_wins int default 0,
     defender_wins   int default 0,
     rounds        int default 3,           -- best of N
     created_at    timestamptz default now(),
     resolved_at   timestamptz
   );
   alter table club_tournaments enable row level security;
   create policy "read club tournaments"   on club_tournaments for select using (true);
   create policy "insert club tournaments" on club_tournaments for insert with check (auth.uid() is not null);
   create policy "update club tournaments" on club_tournaments for update using (true);
   ─────────────────────────────────────────────────────────────────────
   Flow:
   1. Club A owner/member challenges Club B by tag
   2. Row inserted with status='pending'
   3. Any Club B member can accept → status='active'
   4. Active tournament shows in both clubs' tournament tabs
   5. Members from each club play 1v1 matches from the lobby
   6. Each win increments their club's win counter
   7. First to ceil(rounds/2) wins takes the tournament → status='done'
   8. Winner club gets +50 trophies
======================================================================= */

const CLUB_TOURN_TROPHIES = 50;

/* ── Open tournament tab ── */
function _loadClubTournamentTab() {
    const noClub  = document.getElementById('clubs-tourn-no-club');
    const main    = document.getElementById('clubs-tourn-main');
    if (!_clubsState.myClub) {
        if (noClub) noClub.style.display = '';
        if (main)   main.style.display   = 'none';
        return;
    }
    if (noClub) noClub.style.display = 'none';
    if (main)   main.style.display   = 'flex';
    _fetchClubTournaments();
}

/* ── Fetch active and pending tournaments for our club ──
   club_tournaments now lives in Firestore too (collection:
   club_tournaments), not Supabase — it used to do a Postgres foreign-key
   join straight into `clubs` (challenger_id -> clubs.name/badge/tag),
   which can't work once clubs itself moved to Firestore. Rather than
   doing two round-trip lookups per tournament on every render, the
   challenger/defender's name/badge/tag are denormalized directly onto
   the tournament doc at creation time (see clubChallenge() below) — a
   standard Firestore pattern for avoiding joins. */
async function _fetchClubTournaments() {
    if (!_clubsState.myClub) return;
    const cid = _clubsState.myClub.id;
    try {
        const [asChallenger, asDefender] = await Promise.all([
            fsWhere('club_tournaments', 'challenger_id', cid, 25),
            fsWhere('club_tournaments', 'defender_id', cid, 25),
        ]);
        const data = [...asChallenger, ...asDefender].filter(t => t.status !== 'done');
        data.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        _renderClubTournaments(data);
    } catch(e) { console.warn('[DR ClubTourn] fetch error', e); }
}

function _renderClubTournaments(rows) {
    const list    = document.getElementById('clubs-tourn-list');
    const pending = document.getElementById('clubs-tourn-pending');
    if (!list || !pending) return;

    const active  = rows.filter(r => r.status === 'active');
    const pend    = rows.filter(r => r.status === 'pending');
    const myId    = _clubsState.myClub?.id;

    // Active
    if (active.length === 0) {
        list.innerHTML = '<div class="clubs-auth-notice" style="padding:12px 0;"><div class="clubs-auth-sub">No active tournaments right now.</div></div>';
    } else {
        list.innerHTML = active.map(t => {
            const isChallenger = t.challenger_id === myId;
            const us   = isChallenger
                ? { name: t.challenger_name, badge: t.challenger_badge, tag: t.challenger_tag }
                : { name: t.defender_name,   badge: t.defender_badge,   tag: t.defender_tag };
            const them = isChallenger
                ? { name: t.defender_name,   badge: t.defender_badge,   tag: t.defender_tag }
                : { name: t.challenger_name, badge: t.challenger_badge, tag: t.challenger_tag };
            const ourW = isChallenger ? t.challenger_wins : t.defender_wins;
            const thW  = isChallenger ? t.defender_wins   : t.challenger_wins;
            const need = Math.ceil(t.rounds / 2);
            return `
            <div class="club-card" style="gap:8px;">
                <div class="club-card-header">
                    <div class="club-badge">${us?.badge || '⚔️'}</div>
                    <div class="club-info">
                        <div class="club-name">${_clubEsc(us?.name || '?')} vs ${_clubEsc(them?.name || '?')}</div>
                        <div class="club-meta">Best of ${t.rounds} · First to ${need} wins</div>
                    </div>
                </div>
                <div style="display:flex;gap:0;border-top:1px solid rgba(100,65,20,0.2);padding-top:8px;">
                    <div class="club-stat"><div class="club-stat-val" style="color:#7ae87a;">${ourW}</div><div class="club-stat-label">Our Wins</div></div>
                    <div class="club-stat"><div class="club-stat-val" style="color:#e87a7a;">${thW}</div><div class="club-stat-label">Their Wins</div></div>
                    <div class="club-stat"><div class="club-stat-val">${need}</div><div class="club-stat-label">Needed</div></div>
                </div>
            </div>`;
        }).join('');
    }

    // Pending
    if (pend.length === 0) {
        pending.innerHTML = '<div style="font-family:\'Cinzel\',serif;font-size:9px;color:rgba(100,65,20,0.4);font-style:italic;">No pending challenges.</div>';
    } else {
        pending.innerHTML = pend.map(t => {
            const isChallenger = t.challenger_id === myId;
            const other = isChallenger
                ? { name: t.defender_name,   badge: t.defender_badge,   tag: t.defender_tag }
                : { name: t.challenger_name, badge: t.challenger_badge, tag: t.challenger_tag };
            const canAccept = !isChallenger;
            return `
            <div class="club-card" style="gap:8px;">
                <div class="club-card-header">
                    <div class="club-badge">${other?.badge || '⚔️'}</div>
                    <div class="club-info">
                        <div class="club-name">${isChallenger ? 'You challenged' : 'Challenge from'} ${_clubEsc(other?.name || '?')}</div>
                        <div class="club-meta">#${_clubEsc(other?.tag || '?')} · Best of ${t.rounds}</div>
                    </div>
                </div>
                ${canAccept ? `<button class="auth-btn" style="font-size:10px;padding:7px;" onclick="acceptClubChallenge('${t.id}')">⚔ Accept Challenge</button>` : ''}
                ${isChallenger ? `<button class="auth-btn secondary" style="font-size:9px;padding:6px;" onclick="cancelClubChallenge('${t.id}')">Cancel</button>` : ''}
            </div>`;
        }).join('');
    }
}

/* ── Challenge another club by tag ── */
async function clubChallenge() {
    const tag    = (document.getElementById('clubs-tourn-tag-input')?.value || '').trim().toUpperCase();
    const status = document.getElementById('clubs-tourn-status');
    if (!_syncedUid)                     { if (status) status.textContent = 'Sign in first.'; return; }
    if (!_clubsState.myClub)             { if (status) status.textContent = 'Join a club first.'; return; }
    if (!tag || tag.length < 2)          { if (status) status.textContent = 'Enter a valid club tag.'; return; }
    if (tag === _clubsState.myClub.tag)  { if (status) status.textContent = "You can't challenge your own club."; return; }

    if (status) status.textContent = 'Looking up club…';
    const matches = await fsWhere('clubs', 'tag', tag, 1);
    const target = matches[0];
    if (!target) { if (status) status.textContent = 'Club not found.'; return; }
    const result = await _clubSendChallenge(target);
    if (status) status.textContent = result.message;
    if (result.ok && document.getElementById('clubs-tourn-tag-input')) document.getElementById('clubs-tourn-tag-input').value = '';
    if (result.ok) setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

/* Reusable core, called both from the tag-input form above and directly
   from a club card in the Club Ranking tab (_clubRankChallenge below). */
async function _clubSendChallenge(target) {
    if (!_clubsState.myClub) return { ok: false, message: 'Join a club first.' };
    if (target.id === _clubsState.myClub.id) return { ok: false, message: "You can't challenge your own club." };
    try {
        // Check no existing active/pending tournament between these two clubs
        const [a, b] = await Promise.all([
            fsWhere('club_tournaments', 'challenger_id', _clubsState.myClub.id, 25),
            fsWhere('club_tournaments', 'defender_id', _clubsState.myClub.id, 25),
        ]);
        const existing = [...a, ...b].find(t =>
            t.status !== 'done' &&
            ((t.challenger_id === _clubsState.myClub.id && t.defender_id === target.id) ||
             (t.challenger_id === target.id && t.defender_id === _clubsState.myClub.id)));
        if (existing) return { ok: false, message: 'A tournament already exists with this club.' };

        const { error } = await fsAdd('club_tournaments', {
            challenger_id:     _clubsState.myClub.id,
            challenger_name:   _clubsState.myClub.name,
            challenger_badge:  _clubsState.myClub.badge || '⚔️',
            challenger_tag:    _clubsState.myClub.tag,
            defender_id:       target.id,
            defender_name:     target.name,
            defender_badge:    target.badge || '⚔️',
            defender_tag:      target.tag,
            status:            'pending',
            challenger_wins:   0,
            defender_wins:     0,
            rounds:            3,
            created_at:        new Date().toISOString(),
        });
        if (error) return { ok: false, message: error.message || 'Error — try again.' };
        _fetchClubTournaments();
        return { ok: true, message: `Challenge sent to ${target.name}!` };
    } catch(e) {
        console.warn('[DR ClubTourn] challenge error', e);
        return { ok: false, message: 'Error — try again.' };
    }
}

/* Click-to-challenge from a club card in the Club Ranking tab */
async function _clubRankChallenge(clubId, btnEl) {
    if (!_clubsState.myClub) { _showGoldToast('Join a club first.'); return; }
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }
    const target = await fsGet('clubs', clubId);
    if (!target) { _showGoldToast('Club not found.'); return; }
    const result = await _clubSendChallenge(target);
    _showGoldToast(result.message);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⚔ Challenge'; }
}

/* ── Accept a challenge ── */
async function acceptClubChallenge(tournId) {
    try {
        await fsUpdate('club_tournaments', tournId, { status: 'active' });
        _fetchClubTournaments();
    } catch(e) { console.warn('[DR ClubTourn] accept error', e); }
}

/* ── Cancel / decline a challenge ── */
async function cancelClubChallenge(tournId) {
    try {
        await fsDelete('club_tournaments', tournId);
        _fetchClubTournaments();
    } catch(e) { console.warn('[DR ClubTourn] cancel error', e); }
}

/* ── Record a match result for an active club tournament ── */
async function recordClubTournamentWin(winnersClubId) {
    if (!_clubsState.myClub) return;
    const myId = _clubsState.myClub.id;
    try {
        // Find the active tournament involving our club
        const [a, b] = await Promise.all([
            fsWhere('club_tournaments', 'challenger_id', myId, 25),
            fsWhere('club_tournaments', 'defender_id', myId, 25),
        ]);
        const tourn = [...a, ...b].find(t => t.status === 'active');
        if (!tourn) return;

        const isChallenger  = tourn.challenger_id === winnersClubId;
        const cWins = tourn.challenger_wins + (isChallenger ? 1 : 0);
        const dWins = tourn.defender_wins   + (!isChallenger ? 1 : 0);
        const need  = Math.ceil(tourn.rounds / 2);
        const done  = cWins >= need || dWins >= need;
        const winnerClubId = cWins >= need ? tourn.challenger_id : tourn.defender_id;

        const update = {
            challenger_wins: cWins,
            defender_wins:   dWins,
            ...(done ? { status: 'done', resolved_at: new Date().toISOString() } : {}),
        };
        await fsUpdate('club_tournaments', tourn.id, update);

        // Award trophies to winning club
        if (done) {
            const winClub = await fsGet('clubs', winnerClubId);
            if (winClub) {
                await fsUpdate('clubs', winnerClubId, { trophies: (winClub.trophies || 0) + CLUB_TOURN_TROPHIES });
            }
            if (typeof _lobbyChatSystem === 'function') _lobbyChatSystem(`🏆 Club tournament decided! ${winnersClubId === myId ? 'Your club wins!' : 'Opponent club wins.'} +${CLUB_TOURN_TROPHIES} trophies awarded.`);
        }
        _fetchClubTournaments();
    } catch(e) { console.warn('[DR ClubTourn] recordWin error', e); }
}

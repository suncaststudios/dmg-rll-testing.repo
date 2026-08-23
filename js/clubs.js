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

const _clubsState = { myClub: null, myRole: null, tab: 'my-club' };

function openClubs() {
    playSfx('menuClick');
    toggle('menu-clubs', true);
    _loadMyClub();
}

function switchClubsTab(id) {
    _clubsState.tab = id;
    const tabs = ['my-club','leaderboard','browse','tournament'];
    document.querySelectorAll('.clubs-tab').forEach(t =>
        t.classList.toggle('active', t.id === 'clubs-tab-' + (id === 'leaderboard' ? 'stats' : id)));
    document.querySelectorAll('.clubs-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'clubs-panel-' + id));
    // "my-club" was previously never re-rendered on tab switch at all — it
    // only ever painted once, when openClubs() first opened the whole
    // panel. That meant creating or joining a club (which updates
    // _clubsState.myClub in memory just fine) never actually showed up
    // here unless you closed and reopened the whole Clubs screen.
    if (id === 'my-club')     _renderMyClub(_clubsState.myClub);
    if (id === 'leaderboard') _loadLeaderboard();
    if (id === 'browse')      searchClubs();
    if (id === 'tournament')  _loadClubTournamentTab();
}

function _clubsSetTabVisibility(inClub) {
    // Show/hide tabs that only make sense when in a club
    const statsTab = document.getElementById('clubs-tab-stats');
    const tournTab = document.getElementById('clubs-tab-tournament');
    if (statsTab) statsTab.style.display = inClub ? '' : 'none';
    if (tournTab) tournTab.style.display = inClub ? '' : 'none';
    // Show/hide the no-club action buttons vs guest badge
    const authedBtns = document.getElementById('clubs-no-club-authed');
    const guestBadge = document.getElementById('clubs-no-club-guest');
    const isLoggedIn = !!_syncedUid;
    if (authedBtns) authedBtns.style.display = (!inClub && isLoggedIn) ? 'flex' : 'none';
    if (guestBadge) guestBadge.style.display  = (!inClub && !isLoggedIn) ? '' : 'none';
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
    if (!_syncedUid) { _renderMyClub(null); return; }
    try {
        const profile = await fsGet('profiles', _syncedUid);
        if (!profile?.club_id) { _renderMyClub(null); return; }
        const club = await fsGet('clubs', profile.club_id);
        _clubsState.myClub = club || null;
        _clubsState.myRole = club?.owner_id === _syncedUid ? 'owner' : 'member';
        _renderMyClub(club);
    } catch(e) {
        console.warn('[DR Clubs] _loadMyClub error', e);
        _renderMyClub(null);
    }
}

/* ── Club Settings modal (president only) ──
   Two tabs: "Edit Club Content" (name/tag/badge/description) and
   "Danger Zone" (disband). Reuses the same fields/validation as
   createClub() where it makes sense (tag/name uniqueness). */

function openClubSettings() {
    if (_clubsState.myRole !== 'owner' || !_clubsState.myClub) return;
    const club = _clubsState.myClub;
    const nameEl  = document.getElementById('cs-edit-name');
    const tagEl   = document.getElementById('cs-edit-tag');
    const badgeEl = document.getElementById('cs-edit-badge');
    const descEl  = document.getElementById('cs-edit-desc');
    if (nameEl)  nameEl.value  = club.name || '';
    if (tagEl)   tagEl.value   = club.tag  || '';
    if (badgeEl) badgeEl.value = club.badge || '⚔️';
    if (descEl)  descEl.value  = club.description || '';
    _clubSetTxt('cs-edit-status', '');
    _clubSetTxt('cs-danger-status', '');
    _clubSettingsSwitchTab('content');
    const modal = document.getElementById('club-settings-modal');
    if (modal) modal.style.display = 'flex';
    if (typeof playSfx === 'function') playSfx('menuClick');
}

function closeClubSettings() {
    const modal = document.getElementById('club-settings-modal');
    if (modal) modal.style.display = 'none';
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

        const { error } = await fsUpdate('clubs', club.id, { name, tag, badge, description: desc });
        if (error) { if (status) status.textContent = error.message || 'Error — try again.'; return; }

        Object.assign(_clubsState.myClub, { name, tag, badge, description: desc });
        _renderMyClub(_clubsState.myClub);
        if (status) status.textContent = 'Saved!';
        setTimeout(closeClubSettings, 900);
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
        closeClubSettings();
        _renderMyClub(null);
        if (typeof _showGoldToast === 'function') _showGoldToast(`${club.name} has been disbanded.`);
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] disband error', e);
    }
}

function _renderMyClub(club) {
    const noClub = document.getElementById('clubs-no-club');
    const myCard = document.getElementById('clubs-my-club-card');
    _clubsSetTabVisibility(!!club);
    if (!club) {
        if (noClub) noClub.style.display = '';
        if (myCard) myCard.style.display = 'none';
        // If on a member-only tab, switch back to my-club
        if (['leaderboard','tournament'].includes(_clubsState.tab)) switchClubsTab('my-club');
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

    // President-only Club Settings button
    const settingsBtn = document.getElementById('clubs-settings-btn');
    if (settingsBtn) settingsBtn.style.display = (_clubsState.myRole === 'owner') ? '' : 'none';

    // Member count + global rank — previously left permanently at their
    // hardcoded "0"/"#—" placeholders since nothing ever populated them.
    fsWhere('profiles', 'club_id', club.id, 200).then(members => {
        _clubSetTxt('my-club-members', members.length);
    });
    fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 200 }).then(ranked => {
        const idx = ranked.findIndex(c => c.id === club.id);
        _clubSetTxt('my-club-rank', idx >= 0 ? '#' + (idx + 1) : '#—');
    });
}

async function _loadLeaderboard() {
    const list = document.getElementById('clubs-lb-list');
    if (!list) return;
    try {
        const clubs = await fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 20 });
        if (!clubs || clubs.length === 0) {
            list.innerHTML = `<div class="clubs-auth-notice">
                <div class="clubs-auth-icon">🏆</div>
                <div class="clubs-auth-msg">No Clubs Yet</div>
                <div class="clubs-auth-sub">Be the first to create one and top this board.</div>
            </div>`;
            return;
        }
        const rc = ['gold','silver','bronze'];
        list.innerHTML = clubs.map((c, i) => `
            <div class="club-lb-row">
                <span class="club-lb-rank ${rc[i]||''}">${i+1}</span>
                <span class="club-lb-avatar">${c.badge||'⚔️'}</span>
                <span class="club-lb-name">${_clubEsc(c.name)}
                    <span style="color:#6b4f2a;font-size:8px;">#${_clubEsc(c.tag)}</span></span>
                <span class="club-lb-score">${c.trophies??0} ✦</span>
            </div>`).join('');
    } catch(e) {
        console.warn('[DR Clubs] _loadLeaderboard error', e);
        list.innerHTML = `<div class="clubs-auth-notice">
            <div class="clubs-auth-icon">⚠️</div>
            <div class="clubs-auth-sub">Couldn't load the leaderboard — try again in a moment.</div>
        </div>`;
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
        const clubs = q
            ? batch.filter(c => (c.name||'').toLowerCase().includes(q) || (c.tag||'').toLowerCase().includes(q)).slice(0, 15)
            : batch;
        if (!clubs || clubs.length === 0) {
            out.innerHTML = '<div class="clubs-auth-notice" style="padding-top:12px;"><div class="clubs-auth-sub">No clubs found.</div></div>';
            return;
        }
        // Clicking a card expands it in place (president, member count,
        // description, a real Join button) instead of instantly joining on
        // click — a single misclick used to join you into a club with no
        // confirmation at all.
        out.innerHTML = clubs.map(c => `
            <div class="club-card club-browse-card" id="club-browse-${_clubEsc(c.id)}" style="cursor:pointer;" onclick="_clubBrowseToggle('${_clubEsc(c.id)}')">
                <div class="club-card-header">
                    <div class="club-badge">${c.badge||'⚔️'}</div>
                    <div class="club-info">
                        <div class="club-name">${_clubEsc(c.name)}</div>
                        <div class="club-meta">${c.wins??0} wins · ${c.trophies??0} trophies</div>
                    </div>
                    <span class="club-tag">#${_clubEsc(c.tag)}</span>
                </div>
                ${c.description?`<div class="club-desc">${_clubEsc(c.description)}</div>`:''}
                <div class="club-browse-expand" id="club-browse-expand-${_clubEsc(c.id)}" style="display:none;" onclick="event.stopPropagation()"></div>
            </div>`).join('');
    } catch(e) { console.warn('[DR Clubs] searchClubs error', e); }
}

/* ── Expand/collapse a browse card in place ──
   Loads the president's name and member count (and — reserved for
   later — a spot for club strikes) the first time a card is opened,
   then shows a real Join button rather than joining on click. */
const _clubBrowseExpanded = new Set();
async function _clubBrowseToggle(clubId) {
    const card = document.getElementById('club-browse-' + clubId);
    const expandEl = document.getElementById('club-browse-expand-' + clubId);
    if (!card || !expandEl) return;

    const isOpen = _clubBrowseExpanded.has(clubId);
    if (isOpen) {
        _clubBrowseExpanded.delete(clubId);
        expandEl.style.display = 'none';
        return;
    }
    _clubBrowseExpanded.add(clubId);
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
                    <span class="club-browse-val">${president ? _clubEsc(president.username||'Unknown') : 'Unknown'}</span></div>
                <div class="club-browse-row"><span class="club-browse-label">Members</span>
                    <span class="club-browse-val">${members.length}</span></div>
                ${members.length ? `<div class="club-browse-members">${members.slice(0,12).map(m =>
                    `<span class="club-browse-member-chip">${m.avatar||'⚔️'} ${_clubEsc(m.username||'Wanderer')}</span>`).join('')}</div>` : ''}
                <!-- Reserved: club strikes go here once that system exists -->
                ${isMyOwnClub
                    ? `<div class="club-browse-you" style="margin-top:8px;">This is your club.</div>`
                    : alreadyInAClub
                        ? `<div class="club-browse-you" style="margin-top:8px;">Leave your current club to join another.</div>`
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
            created_at: new Date().toISOString(),
        });
        if (error) { if (statusEl) statusEl.textContent = error.message || 'Error — try again.'; return; }
        const club = { id: clubId, name, tag, badge, description: desc, owner_id: _syncedUid, wins: 0, trophies: 0, win_streak: 0 };
        // Awaited (not fire-and-forget) — if the Clubs screen gets closed
        // and reopened quickly after creating, openClubs() re-fetches from
        // Firestore via _loadMyClub(), and a fire-and-forget write here
        // could easily lose that race, making a freshly-created club
        // "disappear" until the write eventually landed.
        await fsUpdate('profiles', _syncedUid, { club_id: clubId });
        _clubsState.myClub = club;
        _clubsState.myRole = 'owner';
        if (statusEl) statusEl.textContent = 'Club founded!';
        if (typeof playSfx === 'function') playSfx('clubCreate');
        setTimeout(_clubsCloseCreateModal, 1200);
        setTimeout(() => switchClubsTab('my-club'), 1000);
    } catch(e) {
        if (statusEl) statusEl.textContent = 'Error — try again.';
        console.warn('[DR Clubs] createClub error', e);
    }
}

async function joinClubById(clubId) {
    if (!_syncedUid) { _showGoldToast('Sign in to join a club.'); return; }
    if (_clubsState.myClub) { _showGoldToast('Leave your current club first.'); return; }
    try {
        await fsUpdate('profiles', _syncedUid, { club_id: clubId });
        await _loadMyClub();
        switchClubsTab('my-club');
        if (typeof playSfx === 'function') playSfx('clubJoin');
    } catch(e) { console.warn('[DR Clubs] joinClubById error', e); }
}

async function leaveClub() {
    if (!_syncedUid || !_clubsState.myClub) return;
    if (!confirm('Leave ' + _clubsState.myClub.name + '?')) return;
    try {
        await fsUpdate('profiles', _syncedUid, { club_id: null });
        _clubsState.myClub = null;
        _clubsState.myRole = null;
        _renderMyClub(null);
    } catch(e) { console.warn('[DR Clubs] leaveClub error', e); }
}

function _clubSetTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _clubEsc(s) {
    return String(s??'').replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    try {
        const matches = await fsWhere('clubs', 'tag', tag, 1);
        const target = matches[0];
        if (!target) { if (status) status.textContent = 'Club not found.'; return; }

        // Check no existing active/pending tournament between these two clubs
        const [a, b] = await Promise.all([
            fsWhere('club_tournaments', 'challenger_id', _clubsState.myClub.id, 25),
            fsWhere('club_tournaments', 'defender_id', _clubsState.myClub.id, 25),
        ]);
        const existing = [...a, ...b].find(t =>
            t.status !== 'done' &&
            ((t.challenger_id === _clubsState.myClub.id && t.defender_id === target.id) ||
             (t.challenger_id === target.id && t.defender_id === _clubsState.myClub.id)));
        if (existing) { if (status) status.textContent = 'A tournament already exists with this club.'; return; }

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
        if (error) { if (status) status.textContent = error.message || 'Error — try again.'; return; }
        if (status) status.textContent = `Challenge sent to ${target.name}!`;
        if (document.getElementById('clubs-tourn-tag-input')) document.getElementById('clubs-tourn-tag-input').value = '';
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        _fetchClubTournaments();
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR ClubTourn] challenge error', e);
    }
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

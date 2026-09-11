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
     _clubsState.myRole  — 'president' | 'vp' | 'officer' | 'member' | null
================================================================ */

const _clubsState = { myClub: null, myRole: null, bigTab: 'myclub', subTab: 'overview' };

/* Club banner background themes — applied to .club-card via inline
   style wherever a club renders with its full card (Overview, Browse). */
const CUSTOMIZE_CLUB_BANNERS = {
    clubbanner_crimson:  'linear-gradient(160deg, rgba(90,10,10,0.5) 0%, rgba(20,2,2,0.2) 60%, transparent 100%)',
    clubbanner_azure:    'linear-gradient(160deg, rgba(10,50,90,0.5) 0%, rgba(2,15,30,0.2) 60%, transparent 100%)',
    clubbanner_verdant:  'linear-gradient(160deg, rgba(15,70,20,0.5) 0%, rgba(3,20,5,0.2) 60%, transparent 100%)',
    clubbanner_obsidian: 'linear-gradient(160deg, rgba(20,20,25,0.65) 0%, rgba(4,4,6,0.3) 60%, transparent 100%)',
};

/* Renders a club's badge — its crest cosmetic if the president has
   applied one, otherwise the plain emoji badge every club starts with. */
function _clubBadgeHtml(club) {
    if (club?.crest_id && typeof SHOP_POOL !== 'undefined') {
        const crest = SHOP_POOL.find(i => i.id === club.crest_id && i.class === 'crest');
        if (crest) return crest.icon;
    }
    return club?.badge || '⚔️';
}

/* Applies a club's banner cosmetic (if any) as a background on the
   nearest .club-card ancestor of the given element id. */
function _clubApplyBannerBg(elId, club) {
    const el = document.getElementById(elId);
    const card = el?.closest('.club-card');
    if (!card) return;
    const bg = club?.banner_id && CUSTOMIZE_CLUB_BANNERS[club.banner_id];
    card.style.background = bg || '';
}

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
    const first = CLUBS_SUBTABS[bigTabId].find(s => !s.ownerOnly || _clubsState.myRole === 'president');
    switchClubsSubTab(first ? first.id : CLUBS_SUBTABS[bigTabId][0].id);
}

function _clubsRenderSubTabs(bigTabId) {
    const bar = document.getElementById('clubs-subtabs');
    if (!bar) return;
    const inClub = !!_clubsState.myClub;
    const isOwner = _clubsState.myRole === 'president';
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
        .some(s => s.id === _clubsState.subTab && (!s.ownerOnly || _clubsState.myRole==='president') && (!s.needsClub || inClub));
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
        // President is derived from club.owner_id (unique, always in
        // sync with _clubTransferPresidency below). Every other role
        // lives on the member's own profile doc as club_role, defaulting
        // to 'member' for anyone who's never been assigned one (e.g.
        // everyone who joined before roles existed).
        _clubsState.myRole = club?.owner_id === _syncedUid ? 'president' : (profile.club_role || 'member');
        _renderMyClub(club);
        _refreshClubQuestState();
    } catch(e) {
        console.warn('[DR Clubs] _loadMyClub error', e);
        _renderMyClub(null);
        _refreshClubQuestState();
    }
}

/* ═══════════════════ ROLES & MODERATION ══════════════════════════
   Four roles, ranked low → high: member < officer < vp < president.
     president — everything: edit club, assign any role, transfer
                 presidency, kick, ban/perma-ban, mute.
     vp        — kick, mute, and can assign the officer role only
                 (promote member→officer or demote officer→member).
                 Cannot edit the club or ban anyone.
     officer   — mute (timeout) only.
     member    — no moderation actions.
   Only president + vp can change anyone's role; vp is restricted to
   the officer rank in both directions. ═══════════════════════════ */
const CLUB_ROLE_RANK  = { member: 0, officer: 1, vp: 2, president: 3 };
const CLUB_ROLE_LABEL = { member: 'Member', officer: 'Officer', vp: 'Vice President', president: 'President' };
const CLUB_ROLE_ICON  = { member: '', officer: '⭐', vp: '🎖', president: '👑' };

function _clubCanKick(myRole)   { return myRole === 'president' || myRole === 'vp'; }
function _clubCanBan(myRole)    { return myRole === 'president'; }
function _clubCanMute(myRole)   { return myRole === 'president' || myRole === 'vp' || myRole === 'officer'; }
function _clubCanEditClub(myRole) { return myRole === 'president'; }
// What roles `myRole` is allowed to SET on someone else (assigning a
// role never lets you touch a rank at or above your own, and vp is
// further restricted to the officer rank specifically in both
// directions, per spec).
function _clubAssignableRoles(myRole) {
    if (myRole === 'president') return ['member', 'officer', 'vp'];
    if (myRole === 'vp')        return ['member', 'officer']; // toggle only
    return [];
}
function _clubCanAssignRole(myRole, targetCurrentRole, newRole) {
    if (myRole === 'president') return targetCurrentRole !== 'president' && newRole !== 'president';
    if (myRole === 'vp') {
        // VP can only move someone between member and officer.
        return (targetCurrentRole === 'member' || targetCurrentRole === 'officer')
            && (newRole === 'member' || newRole === 'officer');
    }
    return false;
}

async function _clubKickMember(uid, name) {
    if (!_clubCanKick(_clubsState.myRole) || !_clubsState.myClub) return;
    if (uid === _clubsState.myClub.owner_id) { alert("The president can't be kicked."); return; }
    if (!confirm(`Kick ${name || 'this member'} from the club?`)) return;
    try {
        await fsSet('profiles', uid, { club_id: null, club_role: null });
        await _clubRefreshMemberPanel();
        if (typeof playSfx === 'function') playSfx('menuClick');
    } catch(e) { console.warn('[DR Clubs] kick error', e); }
}

async function _clubBanMember(uid, name) {
    if (!_clubCanBan(_clubsState.myRole) || !_clubsState.myClub) return;
    if (uid === _clubsState.myClub.owner_id) { alert("The president can't be banned."); return; }
    const maxHours = _clubsState.myClub.max_ban_hours || null; // null = president may set permanent
    const input = prompt(
        maxHours
            ? `Ban duration in hours (permanent ban not allowed — club max is ${maxHours}h):`
            : `Ban duration in hours (leave blank for a PERMANENT ban):`,
        ''
    );
    if (input === null) return;
    const hours = input.trim() === '' ? null : Math.max(1, parseFloat(input) || 1);
    const cappedHours = (hours !== null && maxHours) ? Math.min(hours, maxHours) : hours;
    const until = cappedHours === null ? null : Date.now() + cappedHours * 3600000;
    try {
        const club = _clubsState.myClub;
        const banned = { ...(club.banned || {}) };
        banned[uid] = { until, reason: '', by: _syncedUid, at: Date.now() };
        await fsSet('clubs', club.id, { banned });
        await fsSet('profiles', uid, { club_id: null, club_role: null });
        club.banned = banned;
        await _clubRefreshMemberPanel();
        _shopToast?.(`${name || 'Member'} ${until ? 'banned' : 'permanently banned'}.`, '🔨');
    } catch(e) { console.warn('[DR Clubs] ban error', e); }
}

async function _clubUnbanMember(uid) {
    if (!_clubCanBan(_clubsState.myRole) || !_clubsState.myClub) return;
    try {
        const club = _clubsState.myClub;
        const banned = { ...(club.banned || {}) };
        delete banned[uid];
        await fsSet('clubs', club.id, { banned });
        club.banned = banned;
        await _clubRefreshMemberPanel();
    } catch(e) { console.warn('[DR Clubs] unban error', e); }
}

/* Checks whether `uid` is currently banned from `club` (used when
   someone tries to join by browse/code — see joinClubById/_clubJoinByCode). */
function _clubIsBanned(club, uid) {
    const entry = club?.banned?.[uid];
    if (!entry) return false;
    if (entry.until === null) return true; // permanent
    return Date.now() < entry.until;
}

async function _clubMuteMember(uid, name) {
    if (!_clubCanMute(_clubsState.myRole) || !_clubsState.myClub) return;
    if (uid === _clubsState.myClub.owner_id) { alert("The president can't be muted."); return; }
    const maxMin = Math.round((_clubsState.myClub.max_mute_seconds || 86400) / 60);
    const input = prompt(`Mute duration in minutes (club max: ${maxMin}m):`, Math.min(30, maxMin));
    if (input === null) return;
    const minutes = Math.max(1, Math.min(maxMin, parseFloat(input) || 1));
    const until = Date.now() + minutes * 60000;
    try {
        await fsSet('profiles', uid, { club_mute_until: until });
        await _clubRefreshMemberPanel();
        _shopToast?.(`${name || 'Member'} muted for ${minutes}m.`, '🔇');
    } catch(e) { console.warn('[DR Clubs] mute error', e); }
}

async function _clubUnmuteMember(uid) {
    if (!_clubCanMute(_clubsState.myRole)) return;
    try {
        await fsSet('profiles', uid, { club_mute_until: null });
        await _clubRefreshMemberPanel();
    } catch(e) { console.warn('[DR Clubs] unmute error', e); }
}

async function _clubSetMemberRole(uid, targetCurrentRole, newRole, name) {
    if (!_clubsState.myClub) return;
    if (!_clubCanAssignRole(_clubsState.myRole, targetCurrentRole, newRole)) {
        alert("You don't have permission to assign that role.");
        return;
    }
    try {
        await fsSet('profiles', uid, { club_role: newRole === 'member' ? null : newRole });
        await _clubRefreshMemberPanel();
        _shopToast?.(`${name || 'Member'} is now ${CLUB_ROLE_LABEL[newRole]}.`, '🎖');
    } catch(e) { console.warn('[DR Clubs] set role error', e); }
}

/* Presidency transfer — irreversible from the outgoing president's
   side (per spec: explicit confirm, no way to get it back except the
   new president transferring it back to them manually). The outgoing
   president becomes Vice President rather than being fully demoted. */
async function _clubTransferPresidency(uid, name) {
    if (_clubsState.myRole !== 'president' || !_clubsState.myClub) return;
    const ok = confirm(
        `Transfer presidency of ${_clubsState.myClub.name} to ${name || 'this member'}?\n\n` +
        `You will become Vice President and CANNOT get the club back unless the new president gives it to you. This cannot be undone. Continue?`
    );
    if (!ok) return;
    try {
        const club = _clubsState.myClub;
        await fsSet('clubs', club.id, { owner_id: uid });
        await fsSet('profiles', uid, { club_role: null }); // new president — role derived from owner_id
        await fsSet('profiles', _syncedUid, { club_role: 'vp' });
        club.owner_id = uid;
        _clubsState.myRole = 'vp';
        await _clubRefreshMemberPanel();
        _renderMyClub(club);
        _shopToast?.(`Presidency transferred to ${name || 'the new president'}.`, '👑');
    } catch(e) { console.warn('[DR Clubs] transfer presidency error', e); }
}

async function _clubRefreshMemberPanel() {
    if (!_clubsState.myClub) return;
    try {
        const members = await fsWhere('profiles', 'club_id', _clubsState.myClub.id, 250);
        _renderClubMemberList(members, _clubsState.myClub);
    } catch(e) { console.warn('[DR Clubs] refresh member panel error', e); }
}

/* Club chat mute check — call before sending a message. Fetches the
   sender's own profile fresh (rather than trusting a local cache)
   since a mute can be applied by an officer/VP/president at any time
   from another client. Returns a user-facing reason string if muted,
   or null if clear to post. */
async function _clubMuteBlockReason() {
    if (!_syncedUid) return null;
    try {
        const profile = await fsGet('profiles', _syncedUid);
        const until = profile?.club_mute_until;
        if (until && Date.now() < until) {
            const mins = Math.ceil((until - Date.now()) / 60000);
            return `You're muted in club chat for another ${mins}m.`;
        }
    } catch(e) {}
    return null;
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
    if (_clubsState.myRole !== 'president' || !_clubsState.myClub) return;
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
    const maxMuteEl = document.getElementById('cs-max-mute-input');
    const maxBanEl  = document.getElementById('cs-max-ban-input');
    if (maxMuteEl) maxMuteEl.value = Math.round((club.max_mute_seconds || 86400) / 60);
    if (maxBanEl)  maxBanEl.value  = club.max_ban_hours || '';
    document.querySelectorAll('#cs-edit-visibility .settings-opt-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (club.visibility || 'public')));
    _clubInviteCodeRefreshVisibility();
    _clubRenderClubCosmeticsPicker();
    _clubSetTxt('cs-edit-status', '');
    _clubSetTxt('cs-danger-status', '');
    _clubSettingsSwitchTab('content');
}

function _clubSettingsSelectVisibility(btn) {
    document.querySelectorAll('#cs-edit-visibility .settings-opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _clubInviteCodeRefreshVisibility();
}

function _clubInviteCodeRefreshVisibility() {
    const block = document.getElementById('cs-invite-code-block');
    if (!block) return;
    const visBtn = document.querySelector('#cs-edit-visibility .settings-opt-btn.active');
    const isInvite = (visBtn?.dataset.val || 'public') === 'invite';
    block.style.display = isInvite ? '' : 'none';
    if (isInvite) {
        const valEl = document.getElementById('cs-invite-code-val');
        if (valEl) valEl.textContent = _clubsState.myClub?.invite_code || '——————';
    }
}

function _clubGenInviteCodeStr() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to misread
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

async function _clubRegenInviteCode() {
    const status = document.getElementById('cs-invite-code-status');
    if (_clubsState.myRole !== 'president' || !_clubsState.myClub) { if (status) status.textContent = 'Only the club president can do this.'; return; }
    const code = _clubGenInviteCodeStr();
    if (status) status.textContent = 'Generating…';
    try {
        const { error } = await fsSet('clubs', _clubsState.myClub.id, { invite_code: code });
        if (error) { if (status) status.textContent = 'Error — try again.'; return; }
        _clubsState.myClub.invite_code = code;
        const valEl = document.getElementById('cs-invite-code-val');
        if (valEl) valEl.textContent = code;
        if (status) status.textContent = 'New code generated!';
        if (typeof playSfx === 'function') playSfx('menuClick');
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] _clubRegenInviteCode error', e);
    }
}

function _clubCopyInviteCode() {
    const code = _clubsState.myClub?.invite_code;
    const status = document.getElementById('cs-invite-code-status');
    if (!code) { if (status) status.textContent = 'Generate a code first.'; return; }
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(() => { if (status) status.textContent = 'Copied!'; });
    } else if (status) {
        status.textContent = code; // clipboard API unavailable — at least show it plainly
    }
}

function _clubJoinCodeToggle() {
    const block = document.getElementById('clubs-joincode-block');
    if (!block) return;
    block.style.display = block.style.display === 'none' ? '' : 'none';
}

/* ── Club cosmetics (crest + banner) ──
   Personally owned (via the shop, same as titles/frames/card backs)
   but only the president can APPLY one to the whole club. Spending
   stays personal — the president buys the item for themselves, then
   donates its visual to the club by applying it here. */
function _clubRenderClubCosmeticsPicker() {
    const wrap = document.getElementById('cs-club-cosmetics-list');
    if (!wrap || !_clubsState.myClub) return;
    const club = _clubsState.myClub;

    const ownedCrests  = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).filter(i => i.class === 'crest'      && typeof _shopOwned !== 'undefined' && _shopOwned.has(i.id));
    const ownedBanners = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).filter(i => i.class === 'clubbanner' && typeof _shopOwned !== 'undefined' && _shopOwned.has(i.id));

    const section = (label, items, currentId, applyFn, clearFn) => `
        <div style="margin-bottom:12px;">
            <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#8a6535;margin-bottom:6px;">${label}</div>
            ${items.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${items.map(i => `
                        <button class="clubs-search-btn" style="padding:6px 10px;font-size:8px; ${currentId===i.id?'background:rgba(232,200,112,0.25);border-color:#e8c870;':''}"
                            onclick="${applyFn}('${i.id}')">${i.icon} ${i.name}</button>
                    `).join('')}
                    ${currentId ? `<button class="clubs-search-btn" style="padding:6px 10px;font-size:8px;background:rgba(60,20,10,0.6);" onclick="${clearFn}()">✕ Clear</button>` : ''}
                </div>` : `<div style="font-size:9px;color:rgba(100,65,20,0.5);">You don't own any yet — check the Shop's Cosmetics tab.</div>`}
        </div>`;

    wrap.innerHTML =
        section('Crest', ownedCrests, club.crest_id, '_clubApplyCrest', '_clubClearCrest') +
        section('Banner', ownedBanners, club.banner_id, '_clubApplyBanner', '_clubClearBanner');
}

async function _clubApplyCrest(itemId) {
    if (!_clubCanEditClub(_clubsState.myRole) || !_clubsState.myClub) return;
    try {
        await fsSet('clubs', _clubsState.myClub.id, { crest_id: itemId });
        _clubsState.myClub.crest_id = itemId;
        _clubRenderClubCosmeticsPicker();
        _renderMyClub(_clubsState.myClub);
        if (typeof playSfx === 'function') playSfx('equipItem');
    } catch(e) { console.warn('[DR Clubs] apply crest error', e); }
}
async function _clubClearCrest() {
    if (!_clubCanEditClub(_clubsState.myRole) || !_clubsState.myClub) return;
    try {
        await fsSet('clubs', _clubsState.myClub.id, { crest_id: null });
        _clubsState.myClub.crest_id = null;
        _clubRenderClubCosmeticsPicker();
        _renderMyClub(_clubsState.myClub);
    } catch(e) { console.warn('[DR Clubs] clear crest error', e); }
}
async function _clubApplyBanner(itemId) {
    if (!_clubCanEditClub(_clubsState.myRole) || !_clubsState.myClub) return;
    try {
        await fsSet('clubs', _clubsState.myClub.id, { banner_id: itemId });
        _clubsState.myClub.banner_id = itemId;
        _clubRenderClubCosmeticsPicker();
        _renderMyClub(_clubsState.myClub);
        if (typeof playSfx === 'function') playSfx('equipItem');
    } catch(e) { console.warn('[DR Clubs] apply banner error', e); }
}
async function _clubClearBanner() {
    if (!_clubCanEditClub(_clubsState.myRole) || !_clubsState.myClub) return;
    try {
        await fsSet('clubs', _clubsState.myClub.id, { banner_id: null });
        _clubsState.myClub.banner_id = null;
        _clubRenderClubCosmeticsPicker();
        _renderMyClub(_clubsState.myClub);
    } catch(e) { console.warn('[DR Clubs] clear banner error', e); }
}


async function _clubJoinByCode() {
    const status = document.getElementById('clubs-joincode-status');
    const input  = document.getElementById('clubs-joincode-input');
    const code   = (input?.value || '').trim().toUpperCase();
    if (!_syncedUid) { if (status) status.textContent = 'Sign in to join a club.'; return; }
    if (_clubsState.myClub) { if (status) status.textContent = 'Leave your current club first.'; return; }
    if (!code) { if (status) status.textContent = 'Enter a code.'; return; }
    if (status) status.textContent = 'Checking…';
    try {
        const matches = await fsWhere('clubs', 'invite_code', code, 1);
        if (!matches.length) { if (status) status.textContent = 'No club found with that code.'; return; }
        const club = matches[0];
        if (_clubIsBanned(club, _syncedUid)) { if (status) status.textContent = 'You are banned from this club.'; return; }
        const cap = club.max_members || 50;
        const members = await fsWhere('profiles', 'club_id', club.id, 250);
        if (members.length >= cap) { if (status) status.textContent = `${club.name} is full (${cap}/${cap} members).`; return; }

        await fsSet('profiles', _syncedUid, { club_id: club.id });
        await _loadMyClub();
        switchClubsBigTab('myclub');
        if (typeof playSfx === 'function') playSfx('clubJoin');
        if (status) status.textContent = '';
        if (input) input.value = '';
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] _clubJoinByCode error', e);
    }
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
    if (_clubsState.myRole !== 'president' || !_clubsState.myClub) { if (status) status.textContent = 'Only the club president can edit this.'; return; }
    const club   = _clubsState.myClub;
    const name   = (document.getElementById('cs-edit-name')?.value  || '').trim();
    const tag    = (document.getElementById('cs-edit-tag')?.value   || '').trim().toUpperCase();
    const badge  = (document.getElementById('cs-edit-badge')?.value || '⚔️').trim();
    const desc   = (document.getElementById('cs-edit-desc')?.value  || '').trim();
    const maxMembersRaw = parseInt(document.getElementById('cs-edit-maxmembers')?.value, 10);
    const maxMembers = Number.isFinite(maxMembersRaw) ? Math.min(200, Math.max(2, maxMembersRaw)) : 50;
    const visBtn = document.querySelector('#cs-edit-visibility .settings-opt-btn.active');
    const visibility = visBtn?.dataset.val || 'public';
    const maxMuteMinRaw = parseInt(document.getElementById('cs-max-mute-input')?.value, 10);
    const maxMuteSeconds = Number.isFinite(maxMuteMinRaw) ? Math.min(10080, Math.max(1, maxMuteMinRaw)) * 60 : 86400;
    const maxBanHoursRaw = parseFloat(document.getElementById('cs-max-ban-input')?.value);
    const maxBanHours = Number.isFinite(maxBanHoursRaw) && maxBanHoursRaw > 0 ? maxBanHoursRaw : null; // null = permanent bans allowed
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

        const { error } = await fsUpdate('clubs', club.id, { name, tag, badge, description: desc, max_members: maxMembers, visibility, max_mute_seconds: maxMuteSeconds, max_ban_hours: maxBanHours });
        if (error) { if (status) status.textContent = error.message || 'Error — try again.'; return; }

        Object.assign(_clubsState.myClub, { name, tag, badge, description: desc, max_members: maxMembers, visibility, max_mute_seconds: maxMuteSeconds, max_ban_hours: maxBanHours });
        _renderMyClub(_clubsState.myClub);
        if (status) status.textContent = 'Saved!';
    } catch(e) {
        if (status) status.textContent = 'Error — try again.';
        console.warn('[DR Clubs] settings save error', e);
    }
}

async function _clubSettingsDelete() {
    const status = document.getElementById('cs-danger-status');
    if (_clubsState.myRole !== 'president' || !_clubsState.myClub) { if (status) status.textContent = 'Only the club president can do this.'; return; }
    const club = _clubsState.myClub;
    if (!confirm(`Disband ${club.name}? This removes every member and cannot be undone.`)) return;

    if (status) status.textContent = 'Disbanding…';
    try {
        // Firestore has no FK cascade — clearing club_id off every member's
        // profile has to happen explicitly, or they'd be left pointing at
        // a club document that no longer exists.
        const members = await fsWhere('profiles', 'club_id', club.id, 200);
        await Promise.all(members.map(m => fsSet('profiles', m.id, { club_id: null })));
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
    _clubSetTxt('my-club-badge',    _clubBadgeHtml(club));
    _clubApplyBannerBg('my-club-badge', club);
    _clubSetTxt('my-club-name',     club.name);
    _clubSetTxt('my-club-tag',      '#' + club.tag);
    _clubSetTxt('my-club-desc',     club.description || '');
    _clubSetTxt('my-club-wins',     club.wins       ?? 0);
    _clubSetTxt('my-club-trophies', club.trophies   ?? 0);
    _clubSetTxt('my-club-streak',   club.win_streak ?? 0);

    // The "My Club" big tab shows the actual club's name for members
    // (presidents keep seeing "My Club", since it's unambiguously theirs).
    const bigTabEl = document.getElementById('clubs-bigtab-myclub');
    if (bigTabEl) bigTabEl.textContent = (_clubsState.myRole === 'president') ? 'My Club' : club.name;

    // Presidents can't leave — they have to disband instead (Danger Zone,
    // under Settings). Showing "Leave" and then telling them "no, disband
    // instead" after they click it was just confusing, so it's hidden
    // outright for the president rather than shown-then-blocked.
    const leaveBtn = document.getElementById('clubs-leave-btn');
    if (leaveBtn) leaveBtn.style.display = (_clubsState.myRole === 'president') ? 'none' : '';

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
        const rankedAll = await fsList('clubs', { orderByField: 'trophies', ascending: false, limit: 500 });
        // This ranking list had no visibility filter at all, so an
        // invite-only club still showed up here (with its name, tag,
        // and trophy count) to every player browsing the global rankings
        // — the exact "invite-only doesn't disappear from browse" leak,
        // just via this tab instead of the Browse search tab (which
        // already filtered correctly). Keep your own club visible in
        // this view regardless of its visibility, same as the Browse
        // tab's exact-match carve-out, so a president can still see and
        // click into their own invite-only club's rank.
        const myId = _clubsState.myClub?.id;
        const ranked = rankedAll.filter(c => c.visibility !== 'invite' || c.id === myId);
        if (!ranked.length) {
            list.innerHTML = `<div class="clubs-auth-notice">
                <div class="clubs-auth-icon">🏆</div>
                <div class="clubs-auth-msg">No Clubs Yet</div>
                <div class="clubs-auth-sub">Be the first to create one and top this board.</div>
            </div>`;
            return;
        }
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
                    <div class="club-badge">${_clubBadgeHtml(c)}</div>
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
        //
        // fsSet (merge), not fsUpdate — fsUpdate throws "No document to
        // update" if this account's profiles/{uid} doc doesn't exist yet
        // (e.g. a newer account that hasn't triggered a profile write
        // before), and fsSet creates it on demand instead of failing.
        await fsSet('profiles', _syncedUid, { club_id: clubId });
        _clubsState.myClub = club;
        _clubsState.myRole = 'president';
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
        if (_clubIsBanned(club, _syncedUid)) { _showGoldToast('You are banned from this club.'); return; }
        const cap = club.max_members || 50;
        if (members.length >= cap) { _showGoldToast(`${club.name} is full (${cap}/${cap} members).`); return; }

        // fsSet (merge), not fsUpdate — see the comment in createClub
        // above; this is exactly the "No document to update" failure
        // reported when joining a club as an account whose profiles/{uid}
        // doc hadn't been created yet.
        await fsSet('profiles', _syncedUid, { club_id: clubId });
        await _loadMyClub();
        switchClubsBigTab('myclub');
        if (typeof playSfx === 'function') playSfx('clubJoin');
    } catch(e) { console.warn('[DR Clubs] joinClubById error', e); }
}

async function leaveClub() {
    if (!_syncedUid || !_clubsState.myClub) return;
    if (_clubsState.myRole === 'president') {
        if (typeof _showGoldToast === 'function') _showGoldToast('Presidents must disband the club instead of leaving.');
        else alert('Presidents must disband the club instead of leaving.');
        return;
    }
    if (!confirm('Leave ' + _clubsState.myClub.name + '?')) return;
    try {
        await fsSet('profiles', _syncedUid, { club_id: null });
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

    const myRole = _clubsState.myRole;
    const roleRank = r => CLUB_ROLE_RANK[r] ?? 0;

    const sorted = [...members].sort((a, b) => {
        if (a.id === club.owner_id) return -1;
        if (b.id === club.owner_id) return 1;
        const ra = a.id === club.owner_id ? 'president' : (a.club_role || 'member');
        const rb = b.id === club.owner_id ? 'president' : (b.club_role || 'member');
        if (roleRank(rb) !== roleRank(ra)) return roleRank(rb) - roleRank(ra);
        return (b.wins || 0) - (a.wins || 0);
    });

    list.innerHTML = sorted.map(m => {
        const isPresident = m.id === club.owner_id;
        const targetRole = isPresident ? 'president' : (m.club_role || 'member');
        const escapedName = _clubEsc(m.username || 'Wanderer');
        const namePlate = typeof renderNamePlate === 'function' ? renderNamePlate(escapedName, m.equipped_cosmetics) : escapedName;
        const isSelf = m.id === _syncedUid;
        const muted = m.club_mute_until && Date.now() < m.club_mute_until;

        // Moderation menu — only rendered for members someone with
        // permission could actually act on (never yourself, never the
        // president since president can't be kicked/banned/muted/role-
        // changed by anyone else).
        let actions = '';
        if (!isSelf && !isPresident) {
            const roleOptions = _clubAssignableRoles(myRole)
                .filter(r => _clubCanAssignRole(myRole, targetRole, r))
                .map(r => `<option value="${r}" ${r===targetRole?'selected':''}>${CLUB_ROLE_LABEL[r]}</option>`).join('');
            actions = `
                <div class="clubs-member-actions" onclick="event.stopPropagation()">
                    ${roleOptions ? `<select class="clubs-member-role-select" onchange="_clubSetMemberRole('${m.id}','${targetRole}',this.value,'${escapedName.replace(/'/g,"\\'")}')">${roleOptions}</select>` : ''}
                    ${_clubCanMute(myRole) ? (muted
                        ? `<button class="clubs-member-action-btn" onclick="_clubUnmuteMember('${m.id}')" title="Unmute">🔊</button>`
                        : `<button class="clubs-member-action-btn" onclick="_clubMuteMember('${m.id}','${escapedName.replace(/'/g,"\\'")}')" title="Mute">🔇</button>`) : ''}
                    ${_clubCanKick(myRole) ? `<button class="clubs-member-action-btn" onclick="_clubKickMember('${m.id}','${escapedName.replace(/'/g,"\\'")}')" title="Kick">👢</button>` : ''}
                    ${_clubCanBan(myRole) ? `<button class="clubs-member-action-btn" onclick="_clubBanMember('${m.id}','${escapedName.replace(/'/g,"\\'")}')" title="Ban">🔨</button>` : ''}
                    ${myRole === 'president' ? `<button class="clubs-member-action-btn" onclick="_clubTransferPresidency('${m.id}','${escapedName.replace(/'/g,"\\'")}')" title="Transfer Presidency">👑</button>` : ''}
                </div>`;
        }

        return `
        <div class="clubs-member-row">
            <span class="clubs-member-avatar" onclick="_lobbyViewProfile('${_clubEsc(m.id)}')" style="cursor:pointer;">${m.avatar || '⚔️'}</span>
            <span class="clubs-member-name" onclick="_lobbyViewProfile('${_clubEsc(m.id)}')" style="cursor:pointer;">${namePlate}</span>
            ${CLUB_ROLE_ICON[targetRole] ? `<span class="clubs-member-role-badge" title="${CLUB_ROLE_LABEL[targetRole]}">${CLUB_ROLE_ICON[targetRole]}</span>` : ''}
            ${muted ? '<span title="Muted">🔇</span>' : ''}
            ${actions}
        </div>`;
    }).join('');
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

async function sendClubChatMessage() {
    const input = document.getElementById('club-chat-input');
    if (!input || !_clubChatChannel) return;
    const text = input.value.trim();
    if (!text) return;

    const blockReason = await _clubMuteBlockReason();
    if (blockReason) { if (typeof _shopToast === 'function') _shopToast(blockReason, '🔇'); return; }

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
                    <div class="club-badge">${_clubBadgeHtml(us)}</div>
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
                    <div class="club-badge">${_clubBadgeHtml(other)}</div>
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

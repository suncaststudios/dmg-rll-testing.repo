/* ═══════════════════════════════════════════════════════════════════
   CUSTOMIZE  —  equip owned cosmetics
   ─────────────────────────────────────────────────────────────────
   v2 — hats/auras/card-skins/fonts retired in favor of cosmetics that
   are actually visible to OTHER players: a card back (shown on your
   hidden hand to your online opponent), a title (shown next to your
   name in the leaderboard/lobby/club roster/profile), and a name-plate
   frame (border behind your username in those same places).

   One item equipped per class at a time. Reuses SHOP_POOL and
   _shopOwned from shop.js (loaded first).

   Storage: dr_equipped_cosmetics — { cardback, title, frame } ids,
   mirrored to profiles/{uid}.equipped_cosmetics in Firestore so other
   players' clients can actually render what you have equipped.
═══════════════════════════════════════════════════════════════════ */

/* Visual mapping for card backs — no separate art assets, so each back
   is expressed as a CSS gradient + a corner glyph, applied to the
   existing .ai-back element (opponent's hidden hand) via inline
   styles set in JS. */
const CUSTOMIZE_CARDBACKS = {
    back_crimson:  { bg: 'linear-gradient(160deg, #6b0000 0%, #2a0000 60%, #0a0000 100%)', glyph: '🩸', trim: 'rgba(220,60,60,0.5)' },
    back_starmap:  { bg: 'radial-gradient(ellipse at 30% 20%, #1a1a3a 0%, #05050f 60%, #000 100%)', glyph: '✨', trim: 'rgba(180,200,255,0.45)' },
    back_goldleaf: { bg: 'linear-gradient(160deg, #3a2c04 0%, #14100a 60%, #050400 100%)', glyph: '🟨', trim: 'rgba(232,200,80,0.6)' },
    back_grimoire: { bg: 'radial-gradient(ellipse at 50% 0%, #2a2010 0%, #14100a 55%, #060402 100%)', glyph: '📖', trim: 'rgba(200,170,110,0.45)' },
    back_circuit:  { bg: 'linear-gradient(160deg, #0a1a10 0%, #050a08 60%, #010302 100%)', glyph: '🟢', trim: 'rgba(80,220,120,0.5)' },
    back_bone:     { bg: 'linear-gradient(160deg, #2a241c 0%, #100e0a 60%, #030201 100%)', glyph: '🦴', trim: 'rgba(220,210,190,0.4)' },
};

/* Name-plate frame styles — applied wherever a username renders via
   .np-frame-<id> classes (see css/main.css). */
const CUSTOMIZE_FRAMES = {
    frame_ironbound: { border: '2px solid #7a7a80', bg: 'rgba(50,50,55,0.35)' },
    frame_gilded:    { border: '2px solid #e8c870', bg: 'rgba(90,70,20,0.25)' },
    frame_thorned:   { border: '2px solid #8a3050', bg: 'rgba(60,15,25,0.3)' },
    frame_static:    { border: '2px dashed #90a0b0', bg: 'rgba(40,50,60,0.3)' },
    frame_engraved:  { border: '2px solid #a07850', bg: 'rgba(60,40,20,0.3)' },
};

let _customizeActiveTab = 'cardback';
let _equippedCosmetics = { cardback: null, title: null, frame: null };

function _loadEquippedCosmetics() {
    // Mutate the existing object in place (don't reassign) so that
    // window._equippedCosmetics — captured once on DOMContentLoaded —
    // never goes stale after a reload from storage.
    Object.assign(_equippedCosmetics, { cardback: null, title: null, frame: null });

    // Guests (not logged in) never have cosmetics active — dr_equipped_cosmetics
    // is plain localStorage, so without this check whatever the last logged-in
    // account on this browser had equipped would keep showing up (main menu
    // card, in combat, everywhere) even after signing out.
    if (typeof _isLoggedIn === 'function' && !_isLoggedIn()) return;

    try {
        const raw = localStorage.getItem('dr_equipped_cosmetics');
        if (raw) Object.assign(_equippedCosmetics, JSON.parse(raw));
    } catch (e) {}
}

function _saveEquippedCosmetics() {
    try { localStorage.setItem('dr_equipped_cosmetics', JSON.stringify(_equippedCosmetics)); } catch (e) {}
    // Best-effort cloud sync, same pattern as profile saves — never blocks the UI.
    // profiles = Firestore now, not Supabase (see js/firestore-db.js). This is
    // what actually lets OTHER players' clients render your equipped title/
    // frame/card-back — without it, cosmetics would only ever be visible on
    // your own screen, which was the whole problem with the old hat/aura set.
    if (typeof _syncedUid !== 'undefined' && _syncedUid) {
        fsSet('profiles', _syncedUid, { equipped_cosmetics: _equippedCosmetics })
            .then(({ error }) => {
                if (error) console.warn('[customize] cloud sync failed', error);
            });
    }
}

/* ── Apply a card back to a single .ai-back element. ── */
function _applyCardBackToEl(el, cardbackId) {
    if (!el) return;
    const back = cardbackId && CUSTOMIZE_CARDBACKS[cardbackId];
    if (back) {
        el.style.background = back.bg;
        el.style.borderColor = back.trim;
        el.dataset.cosmeticGlyph = back.glyph;
    } else {
        el.style.background = '';
        el.style.borderColor = '';
        delete el.dataset.cosmeticGlyph;
    }
}

/* Applies whichever card back should currently show on the opponent's
   hidden hand (.ai-back), rebuilt fresh by render() every turn. In an
   online match this must be the OPPONENT's equipped cosmetic — cached
   in window._onlineOpponentCardback by _startOnlineGame — not your
   own, otherwise every re-render (i.e. every turn) would silently
   overwrite their card back with yours. Locally (vs AI) there's no
   opponent cosmetic, so this just previews your own equipped back. */
function _applyOwnCardBackPreview() {
    if (typeof _isLoggedIn === 'function' && !_isLoggedIn()) return;
    const cardbackId = (typeof window._onlineMode !== 'undefined' && window._onlineMode)
        ? (window._onlineOpponentCardback || null)
        : _equippedCosmetics.cardback;
    document.querySelectorAll('#a-hand .ai-back').forEach(el => _applyCardBackToEl(el, cardbackId));
}

function applyOpponentCardBack(cardbackId) {
    window._onlineOpponentCardback = cardbackId || null;
    document.querySelectorAll('#a-hand .ai-back').forEach(el => _applyCardBackToEl(el, cardbackId || null));
}
window.applyOpponentCardBack = applyOpponentCardBack;

/* ── Name-plate rendering ──
   Wraps a username string with its equipped title (suffix, e.g.
   "Rowan the Unlucky") and wraps the whole thing in a frame span if a
   frame is equipped. Used by leaderboard.js, lobby.js, clubs.js —
   anywhere a username currently gets dropped into a template string.
   Takes the raw name plus optional {title, frame} ids (so it can
   render OTHER players' cosmetics, not just your own) and returns an
   HTML string. Caller is responsible for escaping `name` first. */
function renderNamePlate(escapedName, cosmetics) {
    const c = cosmetics || {};
    const titleItem = c.title ? (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL.find(i => i.id === c.title && i.class === 'title') : null) : null;
    const frameId = c.frame && CUSTOMIZE_FRAMES[c.frame] ? c.frame : null;

    const inner = titleItem
        ? `${escapedName} <span class="np-title">${titleItem.icon} ${titleItem.name}</span>`
        : escapedName;

    return frameId ? `<span class="np-frame np-frame-${frameId}">${inner}</span>` : inner;
}
window.renderNamePlate = renderNamePlate;

document.addEventListener('DOMContentLoaded', _applyOwnCardBackPreview);

function openCustomize() {
    playSfx('menuClick');
    _loadEquippedCosmetics();
    toggle('menu-customize', true);
    _customizeSwitchTab(_customizeActiveTab);
    _customizeRenderPreview(null);
    _customizeInitRotate();
}

function _customizeClassLabel(cls) {
    return { cardback: 'Card Back', title: 'Title', frame: 'Frame' }[cls] || cls;
}

function _customizeSwitchTab(cls) {
    playSfx('menuClick');
    _customizeActiveTab = cls;
    document.querySelectorAll('.customize-tab').forEach(t => t.classList.toggle('active', t.dataset.class === cls));

    // Guests (not logged in) don't get to browse or equip cosmetics —
    // _shopOwned is just localStorage, so without this check whatever the
    // last logged-in account on this browser owned would still show up
    // and be equippable for anyone using the machine afterward.
    const loggedIn = typeof _isLoggedIn === 'function' ? _isLoggedIn() : true;
    const items = loggedIn
        ? (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : [])
            .filter(i => i.class === cls && typeof _shopOwned !== 'undefined' && _shopOwned.has(i.id))
        : [];
    const grid  = document.getElementById('customize-item-grid');
    const empty = document.getElementById('customize-empty');
    if (!grid) return;

    if (!items.length) {
        grid.innerHTML = '';
        if (empty) {
            empty.style.display = 'block';
            empty.textContent = loggedIn
                ? "You don't own any items in this category yet. Check the Shop!"
                : 'Log in to view and equip your cosmetics.';
        }
        return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = items.map(item => {
        const gifted = typeof _shopIsGifted === 'function' && _shopIsGifted(item.id);
        return `
        <div class="customize-item ${_equippedCosmetics[cls] === item.id ? 'equipped' : ''}"
             onclick="_customizeEquip('${item.id}')"
             onmouseenter="_customizeRenderPreview('${item.id}')"
             onmouseleave="_customizeRenderPreview(null)">
            <div class="ci-icon">${item.icon}</div>
            <div class="ci-name">${item.name}</div>
            ${gifted ? `<div class="ci-gifted-tag" title="Received as a gift">🎁 Gifted</div>` : ''}
        </div>
    `;
    }).join('');
}

function _customizeEquip(itemId) {
    // Defense-in-depth: guests shouldn't be able to equip anything even
    // if this gets called directly (the grid itself is empty for them,
    // per _customizeSwitchTab, so this is a backstop, not the main gate).
    if (typeof _isLoggedIn === 'function' && !_isLoggedIn()) return;

    playSfx('equipItem');
    const item = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === itemId);
    if (!item) return;
    // Clicking an already-equipped item unequips it; otherwise it swaps
    // in for whatever was equipped in that class before.
    _equippedCosmetics[item.class] = (_equippedCosmetics[item.class] === itemId) ? null : itemId;
    _saveEquippedCosmetics();
    _customizeSwitchTab(_customizeActiveTab);
    _customizeRenderPreview(null);
    _applyOwnCardBackPreview();
}

/* hoverItemId: if set, previews that one item in its class while the
   other two classes stay as actually equipped. Pass null to show the
   real, currently-equipped combo. */
function _customizeRenderPreview(hoverItemId) {
    const combo = Object.assign({}, _equippedCosmetics);
    if (hoverItemId) {
        const hovered = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === hoverItemId);
        if (hovered) combo[hovered.class] = hovered.id;
    }

    const cardEl   = document.getElementById('customize-preview-card');
    const backEl   = document.getElementById('customize-preview-back');
    const plateEl  = document.getElementById('customize-preview-nameplate');
    const capEl    = document.getElementById('customize-preview-caption');
    if (!cardEl) return;

    // Card back — shown on the reverse face of the rotating preview card.
    if (backEl) {
        const back = combo.cardback && CUSTOMIZE_CARDBACKS[combo.cardback];
        if (back) {
            backEl.style.background = back.bg;
            backEl.style.borderColor = back.trim;
            backEl.textContent = back.glyph;
            backEl.classList.add('on');
        } else {
            backEl.classList.remove('on');
        }
    }

    // Title + frame — shown on a small name-plate mock under the card.
    if (plateEl) {
        const displayName = (window._getDisplayName ? window._getDisplayName() : _profileData?.username) || 'Wanderer';
        plateEl.innerHTML = renderNamePlate(displayName, combo);
    }

    if (capEl) capEl.textContent = hoverItemId ? 'Previewing' : 'Currently equipped';
}

/* ── Rotate the preview card in 3D within its pane ──
   Drag horizontally to spin the card around (rotateY) and reveal the
   equipped card back on the reverse face; drag vertically to tilt it
   (rotateX, clamped so it can't flip upside down). Releasing eases
   back toward a neutral resting angle instead of staying stuck
   wherever you let go. */
let _customizeRotY = 0, _customizeRotX = 0;
const CUSTOMIZE_TILT_MAX = 22; // degrees, clamp on the vertical (X) axis

function _customizeInitRotate() {
    const wrap = document.getElementById('customize-preview-card-wrap');
    if (!wrap || wrap._rotateBound) return;
    wrap._rotateBound = true;

    let dragging = false, startX = 0, startY = 0, baseRotY = 0, baseRotX = 0;

    const applyTransform = () => {
        wrap.style.transform = `rotateX(${_customizeRotX}deg) rotateY(${_customizeRotY}deg)`;
    };

    wrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        dragging = true;
        wrap.classList.add('dragging');
        startX = e.clientX; startY = e.clientY;
        baseRotY = _customizeRotY; baseRotX = _customizeRotX;
        wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', e => {
        if (!dragging) return;
        _customizeRotY = baseRotY + (e.clientX - startX) * 0.5;   // horizontal drag → spin
        _customizeRotX = Math.max(-CUSTOMIZE_TILT_MAX, Math.min(CUSTOMIZE_TILT_MAX,
            baseRotX - (e.clientY - startY) * 0.3));               // vertical drag → tilt, clamped
        applyTransform();
    });
    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove('dragging');
        // Ease back to a resting spin (keep whichever full rotation they
        // landed nearest, so releasing mid-spin doesn't snap backward oddly)
        _customizeRotY = Math.round(_customizeRotY / 360) * 360;
        _customizeRotX = 0;
        applyTransform();
    };
    wrap.addEventListener('pointerup', endDrag);
    // NOTE: deliberately NOT listening for pointerleave here — see the
    // long-standing comment history on this drag handler; setPointerCapture()
    // makes pointerup fire reliably regardless of where the cursor ends up,
    // while pointerleave fires far too eagerly on a small element mid-spin.
    wrap.addEventListener('pointercancel', endDrag);
}

/* Expose the equipped loadout for battle rendering to consume later. */
window.addEventListener('DOMContentLoaded', () => {
    _loadEquippedCosmetics();
    window._equippedCosmetics = _equippedCosmetics;
});

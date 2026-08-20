/* ═══════════════════════════════════════════════════════════════════
   CUSTOMIZE  —  equip owned cosmetics
   ─────────────────────────────────────────────────────────────────
   Cosmetics are for the CARDS. "card" class items skin the card
   itself; hat/aura/font items decorate on top of whatever card is
   showing. One item equipped per class at a time (hat, aura, card,
   font) — a simple loadout, not per-card-instance.

   Storage: dr_equipped_cosmetics — { hat, aura, card, font } ids.
   Reuses SHOP_POOL and _shopOwned from shop.js (loaded first).
═══════════════════════════════════════════════════════════════════ */

/* Visual mappings — no separate art assets, so card skins/auras/fonts
   are expressed as CSS values keyed by item id. Hats just reuse each
   item's own emoji icon as a badge, no mapping needed for those. */
const CUSTOMIZE_CARD_SKINS = {
    card_trad:      'radial-gradient(ellipse at 50% 0%, #efe0b8 0%, #c8a45a 50%, #8a6028 100%)',
    card_steel:     'linear-gradient(160deg, #dbe3ea 0%, #93a0aa 45%, #4a5058 100%)',
    card_gel:       'linear-gradient(160deg, rgba(190,228,255,0.95) 0%, rgba(130,190,248,0.85) 50%, rgba(70,130,215,0.95) 100%)',
    card_obsidian:  'linear-gradient(160deg, #35353c 0%, #121216 55%, #030304 100%)',
    card_parchment: 'radial-gradient(ellipse at 50% 0%, #ede1c4 0%, #cabb8c 50%, #8a7850 100%)',
};
const CUSTOMIZE_FONTS = {
    font_mono:    "'Share Tech Mono', monospace",
    font_serif:   "'IM Fell English', serif",
    font_display: "'Cinzel Decorative', serif",
};
const CUSTOMIZE_AURA_RGB = {
    aura_supercharge: '255,204,0',
    aura_skulls: '210,210,220',
    aura_pixel:  '70,180,255',
    aura_flame:  '255,90,30',
    aura_runes:  '110,220,140',
    aura_void:   '150,60,220',
    aura_cod3breaker: '90,255,120',
};

let _customizeActiveTab = 'hat';
let _equippedCosmetics = { hat: null, aura: null, card: null, font: null };
// (old drag-position vars removed — see _customizeRotY/_customizeRotX below)

function _loadEquippedCosmetics() {
    // Mutate the existing object in place (don't reassign) so that
    // window._equippedCosmetics — captured once on DOMContentLoaded —
    // never goes stale after a reload from storage.
    Object.assign(_equippedCosmetics, { hat: null, aura: null, card: null, font: null });

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
    // profiles = Firestore now, not Supabase (see js/firestore-db.js).
    if (typeof _syncedUid !== 'undefined' && _syncedUid) {
        fsSet('profiles', _syncedUid, { equipped_cosmetics: _equippedCosmetics })
            .then(({ error }) => {
                if (error) console.warn('[customize] cloud sync failed', error);
            });
    }
}

/* ── Apply the equipped cosmetics to any real card element outside the
   Customize screen (main-menu showcase card, in-combat hand cards).
   Creates/removes the hat and aura effects on demand rather than
   requiring pre-existing markup, since hand cards are built fresh by
   render() every turn. hatSizeClass picks the hat's size for whatever
   context it's in ('hat-lg' | 'hat-md' | 'hat-sm', see CSS). ── */
function _applyCardCosmetics(cardEl, hatSizeClass) {
    if (!cardEl) return;

    const loggedIn = typeof _isLoggedIn === 'function' ? _isLoggedIn() : true;
    const combo = (loggedIn && typeof _equippedCosmetics !== 'undefined')
        ? _equippedCosmetics
        : { hat: null, aura: null, card: null, font: null };

    // Card skin
    cardEl.style.background = (combo.card && typeof CUSTOMIZE_CARD_SKINS !== 'undefined' && CUSTOMIZE_CARD_SKINS[combo.card])
        ? CUSTOMIZE_CARD_SKINS[combo.card] : '';

    // Font
    const fontFamily = (combo.font && typeof CUSTOMIZE_FONTS !== 'undefined' && CUSTOMIZE_FONTS[combo.font])
        ? CUSTOMIZE_FONTS[combo.font] : '';
    const nameEl = cardEl.querySelector('.c-name');
    const descEl = cardEl.querySelector('.c-desc');
    if (nameEl) nameEl.style.fontFamily = fontFamily;
    if (descEl) descEl.style.fontFamily = fontFamily;

    // Hat
    let hatEl = cardEl.querySelector('.cosmetic-hat');
    if (combo.hat) {
        const hatItem = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === combo.hat);
        if (!hatEl) {
            hatEl = document.createElement('div');
            hatEl.className = 'cosmetic-hat ' + (hatSizeClass || 'hat-md');
            cardEl.appendChild(hatEl);
        }
        hatEl.textContent = hatItem ? hatItem.icon : '';
    } else if (hatEl) {
        hatEl.remove();
    }

    // Aura (see .card.has-cosmetic-aura in CSS for why this is a filter,
    // not a layered child element)
    if (combo.aura && typeof CUSTOMIZE_AURA_RGB !== 'undefined' && CUSTOMIZE_AURA_RGB[combo.aura]) {
        const rgb = CUSTOMIZE_AURA_RGB[combo.aura];
        cardEl.style.setProperty('--cosmetic-aura-glow', `drop-shadow(0 0 20px rgba(${rgb},0.65))`);
        cardEl.classList.add('has-cosmetic-aura');
    } else {
        cardEl.style.removeProperty('--cosmetic-aura-glow');
        cardEl.classList.remove('has-cosmetic-aura');
    }

    if (typeof _customizeUpdateCod3breakerFx === 'function') {
        _customizeUpdateCod3breakerFx(cardEl, combo.aura === 'aura_cod3breaker');
    }
}

/* Refreshes the main-menu showcase card (#menu-float-card) with whatever
   is currently equipped. Called on load and whenever equip state or
   login state changes. */
function _refreshMenuCardCosmetics() {
    const el = document.querySelector('#menu-float-card .card');
    if (el) _applyCardCosmetics(el, 'hat-lg');
}

document.addEventListener('DOMContentLoaded', _refreshMenuCardCosmetics);

function openCustomize() {
    playSfx('menuClick');
    _loadEquippedCosmetics();
    toggle('menu-customize', true);
    _customizeSwitchTab(_customizeActiveTab);
    _customizeRenderPreview(null);
    _customizeInitRotate();
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

    grid.innerHTML = items.map(item => `
        <div class="customize-item ${_equippedCosmetics[cls] === item.id ? 'equipped' : ''}"
             onclick="_customizeEquip('${item.id}')"
             onmouseenter="_customizeRenderPreview('${item.id}')"
             onmouseleave="_customizeRenderPreview(null)">
            <div class="ci-icon">${item.icon}</div>
            <div class="ci-name">${item.name}</div>
        </div>
    `).join('');
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
    _refreshMenuCardCosmetics();
}

/* hoverItemId: if set, previews that one item in its class while the
   other three classes stay as actually equipped. Pass null to show the
   real, currently-equipped combo (e.g. after the mouse leaves an item,
   or right after an equip/unequip). */
function _customizeRenderPreview(hoverItemId) {
    const combo = Object.assign({}, _equippedCosmetics);
    if (hoverItemId) {
        const hovered = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === hoverItemId);
        if (hovered) combo[hovered.class] = hovered.id;
    }

    const cardEl = document.getElementById('customize-preview-card');
    const hatEl  = document.getElementById('customize-preview-hat');
    const auraEl = document.getElementById('customize-preview-aura');
    const nameEl = document.getElementById('customize-preview-name');
    const descEl = document.getElementById('customize-preview-desc');
    const capEl  = document.getElementById('customize-preview-caption');
    if (!cardEl) return;

    cardEl.style.background = (combo.card && CUSTOMIZE_CARD_SKINS[combo.card]) ? CUSTOMIZE_CARD_SKINS[combo.card] : '';

    const fontFamily = (combo.font && CUSTOMIZE_FONTS[combo.font]) ? CUSTOMIZE_FONTS[combo.font] : '';
    if (nameEl) nameEl.style.fontFamily = fontFamily;
    if (descEl) descEl.style.fontFamily = fontFamily;

    if (combo.hat) {
        const hatItem = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === combo.hat);
        if (hatEl) { hatEl.textContent = hatItem ? hatItem.icon : ''; hatEl.classList.add('on'); }
    } else if (hatEl) {
        hatEl.classList.remove('on');
    }

    if (combo.aura && CUSTOMIZE_AURA_RGB[combo.aura]) {
        const rgb = CUSTOMIZE_AURA_RGB[combo.aura];
        if (auraEl) {
            auraEl.style.background = `radial-gradient(circle, rgba(${rgb},0.35) 0%, rgba(${rgb},0.12) 45%, transparent 72%)`;
            auraEl.classList.add('on');
        }
    } else if (auraEl) {
        auraEl.classList.remove('on');
    }

    _customizeUpdateCod3breakerFx(cardEl, combo.aura === 'aura_cod3breaker');

    if (capEl) capEl.textContent = hoverItemId ? 'Previewing' : 'Currently equipped';
}

/* Cod3breaker aura: scanlines + a handful of falling matrix-code
   columns layered directly over the card. Built once and cached on
   the card element, then just shown/hidden as the equipped aura
   changes (no need to rebuild the DOM every render). */
const _cod3breakerChars = 'アカサタナ0123456789ハミラ日ロミグウ<>{}/#*'.split('');
function _customizeUpdateCod3breakerFx(cardEl, show) {
    if (!cardEl) return;
    let fx = cardEl.querySelector('.cod3breaker-fx');
    if (show && !fx) {
        fx = document.createElement('div');
        fx.className = 'cod3breaker-fx';
        const cols = 10;
        for (let i = 0; i < cols; i++) {
            const col = document.createElement('div');
            col.className = 'cod3breaker-col';
            col.style.left = `${(i / cols) * 100}%`;
            let text = '';
            for (let r = 0; r < 40; r++) text += _cod3breakerChars[Math.floor(Math.random() * _cod3breakerChars.length)] + '\n';
            col.textContent = text;
            col.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
            col.style.animationDelay = `-${Math.random() * 4}s`;
            fx.appendChild(col);
        }
        cardEl.appendChild(fx);
    }
    if (fx) fx.classList.toggle('on', !!show);
}

/* ── Rotate the preview card in 3D within its pane ──
   Drag horizontally to spin the card around (rotateY), drag vertically
   to tilt it (rotateX, clamped so it can't flip upside down). Releasing
   eases back toward a neutral resting angle instead of staying stuck
   wherever you let go, so it reads as "spin to inspect" rather than
   "drag it out of place". */
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
    // NOTE: deliberately NOT listening for pointerleave here. wrap.setPointerCapture()
    // above already makes pointerup fire reliably no matter where the cursor ends up —
    // but pointerleave still fires the instant the cursor's visual position crosses the
    // (small) card's bounding box, which happens constantly during a normal fast spin.
    // That was ending the drag mid-motion, snapping the card back, even with the mouse
    // button still held — i.e. exactly "I can't rotate the card". pointercancel is the
    // correct safety net instead (only fires on genuine interruption, e.g. an OS gesture).
    wrap.addEventListener('pointercancel', endDrag);
}

/* Expose the equipped loadout for battle rendering to consume later
   (e.g. game.js can read window._equippedCosmetics when drawing cards). */
window.addEventListener('DOMContentLoaded', () => {
    _loadEquippedCosmetics();
    window._equippedCosmetics = _equippedCosmetics;
});

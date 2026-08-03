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
    aura_saiyan: '255,204,0',
    aura_skulls: '210,210,220',
    aura_pixel:  '70,180,255',
    aura_flame:  '255,90,30',
    aura_runes:  '110,220,140',
    aura_void:   '150,60,220',
};

let _customizeActiveTab = 'hat';
let _equippedCosmetics = { hat: null, aura: null, card: null, font: null };
// (old drag-position vars removed — see _customizeRotY/_customizeRotX below)

function _loadEquippedCosmetics() {
    // Mutate the existing object in place (don't reassign) so that
    // window._equippedCosmetics — captured once on DOMContentLoaded —
    // never goes stale after a reload from storage.
    Object.assign(_equippedCosmetics, { hat: null, aura: null, card: null, font: null });
    try {
        const raw = localStorage.getItem('dr_equipped_cosmetics');
        if (raw) Object.assign(_equippedCosmetics, JSON.parse(raw));
    } catch (e) {}
}

function _saveEquippedCosmetics() {
    try { localStorage.setItem('dr_equipped_cosmetics', JSON.stringify(_equippedCosmetics)); } catch (e) {}
    // Best-effort cloud sync, same pattern as profile saves — never blocks the UI.
    if (window._supabase && typeof _syncedUid !== 'undefined' && _syncedUid) {
        window._supabase.from('profiles').update({ equipped_cosmetics: _equippedCosmetics })
            .eq('id', _syncedUid).then(({ error }) => {
                if (error) console.warn('[customize] cloud sync failed', error);
            });
    }
}

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

    const items = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : [])
        .filter(i => i.class === cls && typeof _shopOwned !== 'undefined' && _shopOwned.has(i.id));
    const grid  = document.getElementById('customize-item-grid');
    const empty = document.getElementById('customize-empty');
    if (!grid) return;

    if (!items.length) {
        grid.innerHTML = '';
        if (empty) empty.style.display = 'block';
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
    playSfx('menuClick');
    const item = (typeof SHOP_POOL !== 'undefined' ? SHOP_POOL : []).find(i => i.id === itemId);
    if (!item) return;
    // Clicking an already-equipped item unequips it; otherwise it swaps
    // in for whatever was equipped in that class before.
    _equippedCosmetics[item.class] = (_equippedCosmetics[item.class] === itemId) ? null : itemId;
    _saveEquippedCosmetics();
    _customizeSwitchTab(_customizeActiveTab);
    _customizeRenderPreview(null);
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

    if (capEl) capEl.textContent = hoverItemId ? 'Previewing' : 'Currently equipped';
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
    wrap.addEventListener('pointerleave', endDrag);
}

/* Expose the equipped loadout for battle rendering to consume later
   (e.g. game.js can read window._equippedCosmetics when drawing cards). */
window.addEventListener('DOMContentLoaded', () => {
    _loadEquippedCosmetics();
    window._equippedCosmetics = _equippedCosmetics;
});

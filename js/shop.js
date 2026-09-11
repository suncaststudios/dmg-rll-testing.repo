/* ═══════════════════════════════════════════════════════════════════
   ARCANE EMPORIUM  —  shop.js  v2
   ─────────────────────────────────────────────────────────────────
   • Daily rotation of 10 items from a pool of 20
   • Bundles: up to 3 per day, 3-5 items, no same class twice, 15% off
   • Purchase history: last 8 purchases, 80% refund forever
   • Gold only — no gems, no battle pass
   • Popularity tracked locally, synced to Supabase on quit
   ─────────────────────────────────────────────────────────────────
   Storage keys:
     dr_shop_gold         — current gold balance
     dr_shop_owned        — JSON array of owned item ids
     dr_shop_history      — JSON array of last 8 purchase objects
     dr_shop_popularity   — JSON object { itemId: localCount }
     dr_shop_pending_pop  — popularity increments not yet synced
     dr_shop_last_day     — YYYY-MM-DD of last rotation
     dr_shop_daily_ids    — JSON array of today's 10 item ids
═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════ COSMETIC POOL (26 items) ═══════════════════
   v3 — hats/auras/card-skins/fonts retired (most people never
   noticed they were equipped, and the ones that did were only
   visible on your own screen — nobody else in a match could ever
   see them). Replaced with cosmetics that are actually visible to
   OTHER players wherever a username renders (leaderboard, lobby,
   club roster) or that change something both players see mid-match
   (the back of your hidden hand). Ownership for everything below now
   lives on profiles/{uid}.owned_cosmetics in Firestore (see
   _shopSyncOwnedToCloud/_shopLoadOwnedFromCloud) instead of only
   localStorage, since gifting and other-player visibility both
   require the server to know what you own. */
const SHOP_POOL = [
    /* ── CARD BACKS (6) — shown on your hidden hand in online matches,
       so this is the one cosmetic your opponent actually sees mid-game. */
    { id:'back_crimson',   class:'cardback', name:'Crimson Ward',    icon:'🩸', desc:'A deep red lattice, like it was dyed rather than printed.',              price:220 },
    { id:'back_starmap',   class:'cardback', name:'Starmap',         icon:'✨', desc:'Constellations that don\'t match any sky anyone recognizes.',           price:260 },
    { id:'back_goldleaf',  class:'cardback', name:'Gold Leaf',       icon:'🟨', desc:'Thin gold foil over black. Catches the light when you fan your hand.',   price:340 },
    { id:'back_grimoire',  class:'cardback', name:'Grimoire Page',   icon:'📖', desc:'Torn from something old. The margins are full of notes in no language.', price:280 },
    { id:'back_circuit',   class:'cardback', name:'Circuit Weave',   icon:'🟢', desc:'Traces of green light running under a matte black weave.',              price:240 },
    { id:'back_bone',      class:'cardback', name:'Bone Lattice',    icon:'🦴', desc:'Interlocking, pale, and a little too well-organized to be comfortable.', price:300 },

    /* ── TITLES (6) — shown next to your name everywhere it renders. ── */
    { id:'title_wanderer',   class:'title', name:'the Wanderer',    icon:'🪙', desc:'For nobody in particular. Which is the point.',                          price:100 },
    { id:'title_unlucky',    class:'title', name:'the Unlucky',     icon:'🎲', desc:'Statistically, someone has to be. Might as well wear it.',               price:120 },
    { id:'title_dicewhisperer', class:'title', name:'the Dice Whisperer', icon:'🗣', desc:'They don\'t actually talk to you. You just like saying it out loud.', price:160 },
    { id:'title_undefeated', class:'title', name:'the Undefeated',  icon:'🛡', desc:'Accurate until it isn\'t. Wear it while it lasts.',                      price:200 },
    { id:'title_archivist',  class:'title', name:'the Archivist',   icon:'🗂', desc:'For people who remember every match they\'ve ever lost.',                price:140 },
    { id:'title_gambit',     class:'title', name:'the Gambit',      icon:'♟',  desc:'Sounds clever. Doesn\'t have to mean anything.',                          price:180 },

    /* ── NAME-PLATE FRAMES (5) — decorative border behind your username. ── */
    { id:'frame_ironbound', class:'frame', name:'Ironbound',   icon:'⚙', desc:'Riveted plate edges. Heavy-looking even as a thin border.',                    price:180 },
    { id:'frame_gilded',    class:'frame', name:'Gilded',      icon:'🟡', desc:'Thin gold trim. Doesn\'t need to be loud to be noticed.',                     price:260 },
    { id:'frame_thorned',   class:'frame', name:'Thorned',     icon:'🥀', desc:'Small dark thorns along the edge. Careful reaching for it.',                  price:220 },
    { id:'frame_static',    class:'frame', name:'Static',      icon:'📺', desc:'A faint flicker along the border, like bad reception.',                       price:200 },
    { id:'frame_engraved',  class:'frame', name:'Engraved',    icon:'🪵', desc:'Carved wood-grain trim. Looks handmade because it is, in the fiction.',       price:190 },

    /* ── VAULT-EXCLUSIVE (not for sale, not in daily rotation) ── */
    { id:'title_cod3breaker', class:'title', name:'the Cod3breaker', icon:'💻', desc:'Dragged out of somewhere you weren\'t supposed to be.', hidden:true },

    /* ── CLUB CRESTS (4) — purchased personally, but only a club
       president can apply one to their club (Settings → Club
       Cosmetics), replacing the plain emoji badge everywhere the club
       renders: browse cards, overview header, member-list header. ── */
    { id:'crest_wolfshead',  class:'crest', name:'Wolf\'s Head',   icon:'🐺', desc:'Old heraldry. Every club that\'s ever used it swears it was the first.', price:260 },
    { id:'crest_bastion',    class:'crest', name:'Bastion',        icon:'🏰', desc:'A wall with a door nobody\'s ever seen opened.',                       price:260 },
    { id:'crest_serpent',    class:'crest', name:'Coiled Serpent', icon:'🐍', desc:'Doesn\'t move. You checked. Twice.',                                    price:280 },
    { id:'crest_phoenix',    class:'crest', name:'Rising Phoenix', icon:'🦅', desc:'Mid-flight, always. Never seems to actually land.',                    price:300 },

    /* ── CLUB BANNERS (4) — background theme for the club's Overview
       panel, also president-applied. ── */
    { id:'clubbanner_crimson',  class:'clubbanner', name:'Crimson Hall',  icon:'🟥', desc:'Deep red, low light. Feels like somewhere decisions get made.', price:240 },
    { id:'clubbanner_azure',    class:'clubbanner', name:'Azure Court',   icon:'🟦', desc:'Cold and clean. Everything looks more official in blue.',       price:240 },
    { id:'clubbanner_verdant',  class:'clubbanner', name:'Verdant Keep',  icon:'🟩', desc:'Mossy stone and old green light. Quiet, in a good way.',        price:240 },
    { id:'clubbanner_obsidian', class:'clubbanner', name:'Obsidian Vault',icon:'⬛', desc:'Almost no light at all. Somehow still feels expensive.',        price:280 },
];


/* ═══════════════════ BUNDLE DEFINITIONS (rotated, max 3/day) ═════ */
const BUNDLE_POOL = [
    {
        id:'bundle_warmonger', name:'Warmonger Pack', icon:'⚔',
        desc:'Everything you need to hurt someone, look good doing it, and make sure they remember it.',
        itemIds:['back_bone','title_undefeated','frame_ironbound'],
    },
    {
        id:'bundle_haunted', name:'Haunted Set', icon:'💀',
        desc:'Dark, deliberate, and slightly uncomfortable to sit across from. Exactly right.',
        itemIds:['back_crimson','title_unlucky','frame_thorned'],
    },
    {
        id:'bundle_scholar', name:'Scholar\'s Collection', icon:'📜',
        desc:'Old paper, old words, old font. The kind of setup that makes people think you know something they don\'t.',
        itemIds:['back_grimoire','title_archivist','frame_engraved'],
    },
    {
        id:'bundle_retro', name:'Retro Rig', icon:'🟦',
        desc:'Low resolution, high confidence. The early days had a look and this is it.',
        itemIds:['back_circuit','title_gambit','frame_static'],
    },
    {
        id:'bundle_void', name:'Void Walker', icon:'🌑',
        desc:'Dark border, nothing else. Sometimes the most threatening thing is a card with no explanation.',
        itemIds:['back_starmap','title_dicewhisperer','frame_gilded'],
    },
];

/* ═══════════════════ GOLD EARN INFO ═════════════════════════════ */
const GOLD_SOURCES = [
    { icon:'⚡', label:'Win an online match',     amount:'+25 🪙' },
    { icon:'🏆', label:'Win a tournament',         amount:'+150 🪙' },
    { icon:'🔗', label:'Land a triple crit chain', amount:'+10 🪙' },
    { icon:'📅', label:'Daily login',              amount:'+5 🪙'  },
    { icon:'⚙',  label:'Complete an achievement',  amount:'+15–50 🪙' },
    { icon:'🎯', label:'First win of the day',     amount:'+20 🪙' },
];

/* ═══════════════════ STATE ══════════════════════════════════════ */
let _shopGold       = 0;
let _shopOwned      = new Set();
// Per-item metadata that doesn't fit a plain ownership Set:
//   gifted    — true if this copy was received via a gift code (can't
//               be re-gifted, sells for less, shows a "Gifted" tag).
//   disposals — [{type:'sale'|'gift', at}], one entry per time this
//               account has previously given up this item. Buyback
//               price = stock price × (1 + Σ increment), where each
//               'sale' disposal contributes 0.15 and each 'gift'
//               disposal contributes 0.10 (gifting away and buying
//               back your own gift is cheaper than repurchasing after
//               selling it outright).
let _shopMeta       = {};   // { itemId: { gifted, disposals } }
let _shopHistory    = [];   // [{id, name, icon, price, purchasedAt}]
let _shopPopularity = {};   // {itemId: globalCount} — loaded from Supabase or local
let _shopPendingPop = {};   // {itemId: delta} — to be synced on quit
let _shopDailyIds   = [];   // today's 10 item ids
let _shopDailyBundleIds = [];// today's (up to 3) bundle ids
let _shopActiveTab  = 'featured';
let _shopActiveSub  = 'all';

const SHOP_GIFT_FEE = 25; // flat gold cost to generate a gift code

function _shopMetaFor(id) {
    if (!_shopMeta[id]) _shopMeta[id] = { gifted: false, disposals: [] };
    return _shopMeta[id];
}
function _shopIsGifted(id) {
    return !!(_shopMeta[id] && _shopMeta[id].gifted);
}
function _shopDisposalIncrement(id) {
    const disposals = _shopMeta[id]?.disposals || [];
    return disposals.reduce((sum, d) => sum + (d.type === 'gift' ? 0.10 : 0.15), 0);
}
function _shopBuybackPrice(item) {
    return Math.ceil(item.price * (1 + _shopDisposalIncrement(item.id)));
}
window._shopIsGifted = _shopIsGifted;

/* ═══════════════════ INIT ═══════════════════════════════════════ */
function _shopLoad() {
    try {
        _shopGold       = parseInt(localStorage.getItem('dr_shop_gold')  || '0', 10) || 0;
        _shopOwned      = new Set(JSON.parse(localStorage.getItem('dr_shop_owned')   || '[]'));
        _shopMeta       = JSON.parse(localStorage.getItem('dr_shop_meta')            || '{}');
        _shopHistory    = JSON.parse(localStorage.getItem('dr_shop_history')         || '[]');
        _shopPopularity = JSON.parse(localStorage.getItem('dr_shop_popularity')      || '{}');
        _shopPendingPop = JSON.parse(localStorage.getItem('dr_shop_pending_pop')     || '{}');
    } catch(e) {}
    _shopResolveDailyRotation();
}

function _shopSave() {
    try {
        localStorage.setItem('dr_shop_gold',        String(_shopGold));
        localStorage.setItem('dr_shop_owned',       JSON.stringify([..._shopOwned]));
        localStorage.setItem('dr_shop_meta',        JSON.stringify(_shopMeta));
        localStorage.setItem('dr_shop_history',     JSON.stringify(_shopHistory));
        localStorage.setItem('dr_shop_popularity',  JSON.stringify(_shopPopularity));
        localStorage.setItem('dr_shop_pending_pop', JSON.stringify(_shopPendingPop));
    } catch(e) {}
}

/* ── Gold API (called by game on win/achievement/etc) ── */
async function shopAwardGold(amount) {

    _shopLoad();
    _shopGold = Math.max(0, _shopGold + amount);
    _shopSave();
    _shopUpdateCurrencyDisplay();
    if (amount > 0 && typeof playSfx === 'function') playSfx('goldGain');
}

/* ═══════════════════ DAILY ROTATION ════════════════════════════ */
function _shopTodayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/* Seeded shuffle — same seed = same order for everyone on same day */
function _shopSeededShuffle(arr, seed) {
    const a = [...arr];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = ((s * 1664525) + 1013904223) & 0xffffffff;
        const j = Math.abs(s) % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function _shopDateSeed(dateStr) {
    // Turn "2026-06-22" into an integer seed
    return dateStr.split('-').reduce((acc, n) => acc * 1000 + parseInt(n, 10), 0);
}

function _shopResolveDailyRotation() {
    const today = _shopTodayKey();
    const stored = localStorage.getItem('dr_shop_last_day');
    if (stored === today) {
        try {
            _shopDailyIds       = JSON.parse(localStorage.getItem('dr_shop_daily_ids')        || '[]');
            _shopDailyBundleIds = JSON.parse(localStorage.getItem('dr_shop_daily_bundle_ids') || '[]');
        } catch(e) {}
        if (_shopDailyIds.length === 10) return;
    }
    // New day — generate rotation
    const seed    = _shopDateSeed(today);
    const items   = _shopSeededShuffle(SHOP_POOL.filter(i => !i.hidden), seed);
    const bundles = _shopSeededShuffle(BUNDLE_POOL, seed + 7);
    _shopDailyIds       = items.slice(0, 10).map(i => i.id);
    _shopDailyBundleIds = bundles.slice(0, 3).map(b => b.id);
    localStorage.setItem('dr_shop_last_day',          today);
    localStorage.setItem('dr_shop_daily_ids',          JSON.stringify(_shopDailyIds));
    localStorage.setItem('dr_shop_daily_bundle_ids',   JSON.stringify(_shopDailyBundleIds));
}

/* ── Get today's listed items/bundles ── */
function _shopDailyItems() {
    return _shopDailyIds.map(id => SHOP_POOL.find(i => i.id === id)).filter(Boolean);
}

function _shopDailyBundles() {
    return _shopDailyBundleIds.map(id => BUNDLE_POOL.find(b => b.id === id)).filter(Boolean)
        .map(b => {
            const items = b.itemIds.map(id => SHOP_POOL.find(i => i.id === id)).filter(Boolean);
            const fullPrice   = items.reduce((s,i) => s + i.price, 0);
            const bundlePrice = Math.floor(fullPrice * 0.85);
            const savings     = fullPrice - bundlePrice;
            return { ...b, items, fullPrice, bundlePrice, savings };
        });
}

/* ═══════════════════ POPULARITY ════════════════════════════════ */
function _shopGetPopularity(id) {
    return (_shopPopularity[id] || 0) + (_shopPendingPop[id] || 0);
}

function _shopIncrementPop(id) {
    _shopPendingPop[id] = (_shopPendingPop[id] || 0) + 1;
    _shopPopularity[id] = (_shopPopularity[id] || 0) + 1;
    _shopSave();
}

/* Sync pending popularity to Supabase — called before window unload.
   Intentionally stays on the region-switchable client (window._supabase)
   — trending items are meant to reflect each region's own player base,
   not be merged into one global count. */
async function _shopSyncPopularity() {
    const sb = window._supabase;
    if (!sb || !Object.keys(_shopPendingPop).length) return;
    try {
        for (const [id, delta] of Object.entries(_shopPendingPop)) {
            // Upsert into a shop_popularity table
            const { data } = await sb.from('shop_popularity').select('count').eq('item_id', id).maybeSingle();
            const newCount  = (data?.count || 0) + delta;
            await sb.from('shop_popularity').upsert({ item_id: id, count: newCount }, { onConflict: 'item_id' });
        }
        _shopPendingPop = {};
        _shopSave();
    } catch(e) {}
}

/* Load global popularity from Supabase */
async function _shopLoadPopularity() {
    const sb = window._supabase;
    if (!sb) return;
    try {
        const { data } = await sb.from('shop_popularity').select('item_id,count');
        if (data) data.forEach(row => { _shopPopularity[row.item_id] = row.count; });
        _shopSave();
    } catch(e) {}
}

/* ═══════════════════ OPEN SHOP ═════════════════════════════════ */
function openShop() {
    _shopLoad();
    _shopLoadPopularity();
    toggle('menu-shop', true);
    switchShopTab('featured');
    _shopUpdateCurrencyDisplay();
}

function _shopUpdateCurrencyDisplay() {
    const el = document.getElementById('shop-gold-amt');
    if (el) el.textContent = _shopGold.toLocaleString();
}

/* ═══════════════════ TAB SWITCHING ═════════════════════════════ */
function switchShopTab(id) {
    _shopActiveTab = id;
    document.querySelectorAll('.shop-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.shop-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'shop-panel-' + id));
    playSfx('menuClick');

    if (id === 'featured')  _shopRenderFeatured();
    if (id === 'cosmetics') _shopRenderCosmetics(_shopActiveSub);
    if (id === 'bundles')   _shopRenderBundles();
    if (id === 'inventory') _shopRenderInventory();
    if (id === 'history')   _shopRenderHistory();
}

function switchShopSub(sub, btnEl) {
    _shopActiveSub = sub;
    document.querySelectorAll('.shop-filter').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    _shopRenderCosmetics(sub);
    playSfx('menuClick');
}

/* ═══════════════════ FEATURED ══════════════════════════════════ */
function _shopRenderFeatured() {
    const daily = _shopDailyItems();
    const bundles = _shopDailyBundles();

    // Top 3 cosmetics by popularity (from today's listed items)
    const topItems = [...daily]
        .sort((a,b) => _shopGetPopularity(b.id) - _shopGetPopularity(a.id))
        .slice(0, 3);

    // Top 2 bundles by popularity
    const topBundles = [...bundles]
        .sort((a,b) => _shopGetPopularity(b.id) - _shopGetPopularity(a.id))
        .slice(0, 2);

    const itemGrid   = document.getElementById('shop-feat-items');
    const bundleGrid = document.getElementById('shop-feat-bundles');
    const noItems    = document.getElementById('shop-feat-no-items');
    const noBundles  = document.getElementById('shop-feat-no-bundles');

    if (itemGrid) {
        if (!topItems.length) {
            itemGrid.innerHTML = '';
            if (noItems) noItems.style.display = 'block';
        } else {
            if (noItems) noItems.style.display = 'none';
            itemGrid.innerHTML = topItems.map((item, i) => _shopItemCard(item, ['🥇','🥈','🥉'][i] + ' ')).join('');
        }
    }

    if (bundleGrid) {
        if (!topBundles.length) {
            bundleGrid.innerHTML = '';
            if (noBundles) noBundles.style.display = 'block';
        } else {
            if (noBundles) noBundles.style.display = 'none';
            bundleGrid.innerHTML = topBundles.map(b => _shopBundleCard(b)).join('');
        }
    }
}

/* ═══════════════════ COSMETICS ═════════════════════════════════ */
function _shopRenderCosmetics(sub) {
    const daily = _shopDailyItems();
    const classMap = { cardbacks:'cardback', titles:'title', frames:'frame', crests:'crest', banners:'clubbanner' };
    const filterClass = classMap[sub] || null;
    const items = filterClass ? daily.filter(i => i.class === filterClass) : daily;

    const grid  = document.getElementById('shop-grid-cosmetics');
    const empty = document.getElementById('shop-empty-cosmetics');
    if (!grid) return;

    if (!items.length) {
        grid.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = items.map(item => _shopItemCard(item)).join('');
}

/* ═══════════════════ BUNDLES ═══════════════════════════════════ */
function _shopRenderBundles() {
    const bundles = _shopDailyBundles();
    const grid  = document.getElementById('shop-grid-bundles');
    const empty = document.getElementById('shop-empty-bundles');
    if (!grid) return;

    if (!bundles.length) {
        grid.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = bundles.map(b => _shopBundleCard(b)).join('');
}

/* ═══════════════════ HISTORY ═══════════════════════════════════ */
function _shopRenderHistory() {
    const el = document.getElementById('shop-history-list');
    const empty = document.getElementById('shop-history-empty');
    if (!el) return;

    if (!_shopHistory.length) {
        el.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';

    el.innerHTML = _shopHistory.slice(0, 8).map(h => {
        const refundAmt = Math.floor(h.price * 0.8);
        const alreadyRefunded = h.refunded;
        const date = new Date(h.purchasedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
        return `
        <div class="shop-history-row ${alreadyRefunded ? 'refunded' : ''}">
            <div class="shop-history-icon">${h.icon}</div>
            <div class="shop-history-info">
                <div class="shop-history-name">${h.name}</div>
                <div class="shop-history-meta">${_shopClassLabel(h.class)} · ${h.price} 🪙 · ${date}</div>
            </div>
            <div class="shop-history-right">
                ${alreadyRefunded
                    ? `<span class="shop-history-refunded-badge">Refunded</span>`
                    : `<button class="shop-btn shop-btn-refund" onclick="_shopRefund('${h.id}')">↩ ${refundAmt} 🪙</button>`
                }
            </div>
        </div>`;
    }).join('');
}

/* ═══════════════════ CARD HTML HELPERS ═════════════════════════ */
function _shopClassLabel(cls) {
    return { cardback:'Card Back', title:'Title', frame:'Frame', crest:'Club Crest', clubbanner:'Club Banner' }[cls] || cls;
}
function _shopClassColor(cls) {
    return { cardback:'#2080e0', title:'#e8a020', frame:'#8040e0', crest:'#c04030', clubbanner:'#20a060' }[cls] || '#c8a460';
}

function _shopItemCard(item, prefix = '') {
    const owned   = _shopOwned.has(item.id);
    const pop     = _shopGetPopularity(item.id);
    const clColor = _shopClassColor(item.class);
    // If this account previously gave this item up (sold or gifted),
    // buying it again costs more than the stock price — see
    // _shopBuybackPrice. Shown instead of the stock price whenever
    // there's disposal history, even though the item isn't currently
    // owned.
    const buyback = _shopDisposalIncrement(item.id) > 0 ? _shopBuybackPrice(item) : null;
    return `
    <div class="shop-item" onclick="_shopItemClick('${item.id}')">
        <div class="shop-item-class-bar" style="background:${clColor};"></div>
        <div class="shop-item-icon">${prefix}${item.icon}</div>
        <div class="shop-item-name">${item.name}</div>
        <div class="shop-item-type" style="color:${clColor};">${_shopClassLabel(item.class)}</div>
        <div class="shop-item-desc">${item.desc}</div>
        ${owned
            ? `<div class="shop-item-owned">✓ Owned</div>`
            : buyback
                ? `<div class="shop-item-price" title="You previously gave this item up — buying it back costs more than the stock price">🪙 ${buyback.toLocaleString()} <span style="font-size:8px;opacity:.7;">(buyback)</span></div>`
                : `<div class="shop-item-price">🪙 ${item.price.toLocaleString()}</div>`
        }
        ${pop > 0 ? `<div class="shop-item-pop">🔥 ${pop} purchased</div>` : ''}
    </div>`;
}

function _shopBundleCard(bundle) {
    const allOwned = bundle.items.every(i => _shopOwned.has(i.id));
    const someOwned = bundle.items.some(i => _shopOwned.has(i.id));
    const pop = _shopGetPopularity(bundle.id);
    return `
    <div class="shop-bundle-card" onclick="_shopBundleClick('${bundle.id}')">
        <div class="shop-bundle-header">
            <span class="shop-bundle-icon">${bundle.icon}</span>
            <div>
                <div class="shop-bundle-name">${bundle.name}</div>
                <div class="shop-bundle-desc">${bundle.desc}</div>
            </div>
        </div>
        <div class="shop-bundle-items">
            ${bundle.items.map(i => `
                <div class="shop-bundle-item ${_shopOwned.has(i.id) ? 'owned' : ''}">
                    <span>${i.icon}</span>
                    <span>${i.name}</span>
                    <span style="color:${_shopClassColor(i.class)};font-size:8px;">${_shopClassLabel(i.class)}</span>
                </div>`).join('')}
        </div>
        <div class="shop-bundle-footer">
            <div class="shop-bundle-pricing">
                <span class="shop-bundle-full-price">🪙 ${bundle.fullPrice}</span>
                <span class="shop-bundle-arrow">→</span>
                <span class="shop-bundle-price">🪙 ${bundle.bundlePrice}</span>
                <span class="shop-bundle-savings">Save ${bundle.savings}!</span>
            </div>
            ${allOwned
                ? `<div class="shop-item-owned">✓ All Owned</div>`
                : `<button class="shop-btn shop-btn-gold" style="font-size:9px;padding:6px 14px;"
                    ${someOwned ? 'title="Some items already owned — only unowned items will be purchased"' : ''}>
                    ${someOwned ? '⚡ Buy Remaining' : '📦 Buy Bundle'}
                  </button>`
            }
            ${pop > 0 ? `<div class="shop-item-pop" style="margin-top:6px;">🔥 ${pop} purchased</div>` : ''}
        </div>
    </div>`;
}

/* ═══════════════════ PURCHASE FLOW ═════════════════════════════ */
function _shopItemClick(id) {
    const item = SHOP_POOL.find(i => i.id === id);
    if (!item) return;
    playSfx('cardHover');

    if (_shopOwned.has(id)) { _shopToast('Already owned!', '✓'); return; }
    const increment = _shopDisposalIncrement(id);
    const price = increment > 0 ? _shopBuybackPrice(item) : item.price;
    _shopShowConfirm({
        icon: item.icon,
        name: item.name,
        type: _shopClassLabel(item.class),
        typeColor: _shopClassColor(item.class),
        desc: item.desc,
        price,
        note: increment > 0
            ? `Buyback price — you previously gave this item up, so it costs ${Math.round(increment*100)}% more than the ${item.price} 🪙 stock price.`
            : undefined,
        onConfirm: () => _shopDoPurchase(item, price),
    });
}

function _shopBundleClick(id) {
    const bundle = _shopDailyBundles().find(b => b.id === id);
    if (!bundle) return;
    playSfx('cardHover');

    const unowned = bundle.items.filter(i => !_shopOwned.has(i.id));
    if (!unowned.length) { _shopToast('You own everything in this bundle!', '✓'); return; }

    // If some items already owned, only charge for unowned at bundle ratio
    const effectivePrice = unowned.length === bundle.items.length
        ? bundle.bundlePrice
        : Math.floor(bundle.bundlePrice * (unowned.length / bundle.items.length));

    _shopShowConfirm({
        icon: bundle.icon,
        name: bundle.name,
        type: `Bundle · ${bundle.items.length} items`,
        typeColor: '#c8a460',
        desc: bundle.items.map(i => `${i.icon} ${i.name}`).join(' · '),
        price: effectivePrice,
        note: unowned.length < bundle.items.length
            ? `You already own ${bundle.items.length - unowned.length} item(s). Only unowned items will be added.`
            : `15% off — you save ${bundle.savings} 🪙`,
        onConfirm: () => {
            unowned.forEach(item => {
                _shopOwned.add(item.id);
                _shopHistory.unshift({ id:item.id, name:item.name, icon:item.icon,
                    class:item.class, price:Math.floor(effectivePrice/unowned.length),
                    purchasedAt:Date.now(), refunded:false });
            });
            _shopHistory = _shopHistory.slice(0, 8);
            _shopGold   -= effectivePrice;
            _shopIncrementPop(bundle.id);
            _shopSave();
            _shopUpdateCurrencyDisplay();
            _shopToast(`${bundle.name} purchased!`, '📦');
            document.getElementById('shop-confirm-modal')?.remove();
            _shopRefreshActive();
            _shopSyncOwned();
            playSfx('heal');
        },
    });
}

function _shopDoPurchase(item, price) {
    price = price ?? item.price;
    if (_shopGold < price) { _shopToast('Not enough Gold!', '❌'); playSfx('error'); return; }
    _shopOwned.add(item.id);
    // A shop purchase (even a buyback) is always a fresh, non-gifted
    // copy — only redeeming a gift code sets gifted:true.
    _shopMetaFor(item.id).gifted = false;
    _shopGold -= price;
    _shopHistory.unshift({
        id: item.id, name: item.name, icon: item.icon,
        class: item.class, price,
        purchasedAt: Date.now(), refunded: false,
    });
    _shopHistory = _shopHistory.slice(0, 8);
    _shopIncrementPop(item.id);
    _shopSave();
    _shopUpdateCurrencyDisplay();
    _shopToast(`${item.name} purchased!`, '✓');
    document.getElementById('shop-confirm-modal')?.remove();
    _shopRefreshActive();
    _shopSyncOwned();
    playSfx('purchase');
}

/* ── Refund (undo a recent purchase, 80% back, only from the last-8
   purchase history — separate from the general Sell action below) ── */
function _shopRefund(id) {
    const entry = _shopHistory.find(h => h.id === id && !h.refunded);
    if (!entry) return;
    const refundAmt = Math.floor(entry.price * 0.8);
    entry.refunded = true;
    _shopOwned.delete(id);
    _shopGold += refundAmt;
    _shopSave();
    _shopUpdateCurrencyDisplay();
    _shopToast(`Refunded ${refundAmt} 🪙`, '↩');
    _shopRenderHistory();
    _shopSyncOwned();
}

/* ── Sell (any owned item, any time) ──
   70% of stock price back, or only 50% if the item was received as a
   gift (gifted copies are worth less to sell — they cost the seller
   nothing to acquire beyond a redeemed code). Unlike _shopRefund above,
   this records a 'sale' disposal, so buying the item again later costs
   more (see _shopBuybackPrice). ── */
function _shopSellItem(id) {
    const item = SHOP_POOL.find(i => i.id === id);
    if (!item || !_shopOwned.has(id)) return;
    const gifted = _shopIsGifted(id);
    const refundAmt = Math.floor(item.price * (gifted ? 0.5 : 0.7));
    _shopShowConfirm({
        icon: item.icon,
        name: item.name,
        type: _shopClassLabel(item.class),
        typeColor: _shopClassColor(item.class),
        desc: `Sell this item back for ${refundAmt} 🪙 (${gifted ? '50%' : '70%'} of its ${item.price} 🪙 stock price${gifted ? ' — reduced because it was a gifted item' : ''}). Buying it again later will cost more than stock price.`,
        price: refundAmt,
        note: 'This is a sale, not a refund — the price shown is what you\'ll receive, not pay.',
        onConfirm: () => {
            _shopOwned.delete(id);
            _shopMetaFor(id).disposals.push({ type: 'sale', at: Date.now() });
            _shopMetaFor(id).gifted = false; // no longer relevant, item is gone
            _shopGold += refundAmt;
            _shopSave();
            _shopUpdateCurrencyDisplay();
            _shopToast(`Sold for ${refundAmt} 🪙`, '↩');
            document.getElementById('shop-confirm-modal')?.remove();
            _shopRefreshActive();
            _shopSyncOwned();
        },
    });
}

/* ── Gifting ──
   Costs a small flat fee (SHOP_GIFT_FEE) on top of losing the item —
   a spam/trade-abuse guard so gifting isn't a free way to shuffle
   inventory around. Generates a one-time-use code the recipient
   redeems via _shopRedeemGiftCode. ── */
async function _shopGiftItem(id) {
    const item = SHOP_POOL.find(i => i.id === id);
    if (!item || !_shopOwned.has(id)) return;
    if (_shopIsGifted(id)) { _shopToast("Gifted items can't be gifted again.", '❌'); return; }
    if (!_syncedUid) { _shopToast('Sign in to gift items.', '❌'); return; }
    if (_shopGold < SHOP_GIFT_FEE) { _shopToast(`Gifting costs ${SHOP_GIFT_FEE} 🪙 — not enough Gold.`, '❌'); return; }

    const note = (prompt('Add a short note to include with the gift (optional):', '') || '').slice(0, 200);

    const nextIncrement = _shopDisposalIncrement(id) + 0.10;
    const nextBuyback = Math.ceil(item.price * (1 + nextIncrement));

    _shopShowConfirm({
        icon: item.icon,
        name: item.name,
        type: _shopClassLabel(item.class),
        typeColor: _shopClassColor(item.class),
        desc: `You will LOSE this item and pay a ${SHOP_GIFT_FEE} 🪙 gifting fee. You'll receive a one-time gift code to send to another player. You can buy this item back later for 🪙 ${nextBuyback.toLocaleString()}.`,
        price: SHOP_GIFT_FEE,
        note: '⚠ This cannot be undone except by buying the item back at the increased price above.',
        onConfirm: async () => {
            document.getElementById('shop-confirm-modal')?.remove();
            try {
                const code = _shopGenGiftCode();
                const { error } = await fsSet('gift_codes', code, {
                    item_id: item.id,
                    item_name: item.name,
                    item_icon: item.icon,
                    from_uid: _syncedUid,
                    from_name: (window._getDisplayName ? window._getDisplayName() : _profileData?.username) || 'A player',
                    note,
                    redeemed: false,
                    to_uid: null,
                    created_at: Date.now(),
                });
                if (error) { _shopToast('Could not create gift — try again.', '❌'); return; }

                _shopOwned.delete(id);
                _shopMetaFor(id).disposals.push({ type: 'gift', at: Date.now() });
                _shopMetaFor(id).gifted = false;
                _shopGold -= SHOP_GIFT_FEE;
                _shopSave();
                _shopUpdateCurrencyDisplay();
                _shopSyncOwned();
                _shopRefreshActive();
                _shopShowGiftCodeModal(code, item);
            } catch (e) {
                console.warn('[DR Shop] gift error', e);
                _shopToast('Could not create gift — try again.', '❌');
            }
        },
    });
}

function _shopGenGiftCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'GIFT-';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function _shopShowGiftCodeModal(code, item) {
    const wrap = document.createElement('div');
    wrap.id = 'shop-confirm-modal';
    wrap.className = 'shop-confirm-overlay';
    wrap.innerHTML = `
        <div class="shop-confirm-box">
            <div class="shop-confirm-icon">🎁</div>
            <div class="shop-confirm-name">Gift Code Created!</div>
            <div class="shop-confirm-desc">Send this code to whoever you want to receive ${item.icon} ${item.name}. It can only be used once.</div>
            <div style="font-family:'Cinzel',serif; font-size:20px; letter-spacing:4px; color:#e8c870; background:rgba(0,0,0,0.35); border:1px solid rgba(100,65,20,0.4); border-radius:4px; padding:10px; text-align:center; margin:14px 0;">${code}</div>
            <div class="shop-confirm-actions">
                <button class="shop-btn" onclick="navigator.clipboard?.writeText('${code}'); _shopToast('Copied!','✓');">Copy Code</button>
                <button class="shop-btn shop-btn-gold" onclick="document.getElementById('shop-confirm-modal')?.remove();">Done</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
}

/* ── Redeem a gift code ──
   One-time use — the code doc's `redeemed` flag flips to true and is
   checked before use, so a second redemption attempt (even by the same
   person) fails once someone has claimed it. */
async function _shopRedeemGiftCode() {
    const input  = document.getElementById('shop-gift-redeem-input');
    const status = document.getElementById('shop-gift-redeem-status');
    const code = (input?.value || '').trim().toUpperCase();
    if (!_syncedUid) { if (status) status.textContent = 'Sign in to redeem a gift.'; return; }
    if (!code) { if (status) status.textContent = 'Enter a code.'; return; }
    if (status) status.textContent = 'Checking…';
    try {
        const doc = await fsGet('gift_codes', code);
        if (!doc) { if (status) status.textContent = 'No gift found with that code.'; return; }
        if (doc.redeemed) { if (status) status.textContent = 'This code has already been used.'; return; }
        if (doc.from_uid === _syncedUid) { if (status) status.textContent = "You can't redeem your own gift."; return; }

        const item = SHOP_POOL.find(i => i.id === doc.item_id);
        await fsSet('gift_codes', code, { redeemed: true, to_uid: _syncedUid, redeemed_at: Date.now() });

        _shopOwned.add(doc.item_id);
        _shopMetaFor(doc.item_id).gifted = true; // cannot be re-gifted, sells for less, shows a tag
        _shopSave();
        _shopSyncOwned();
        _shopRefreshActive();
        if (input) input.value = '';
        if (status) status.textContent = '';
        _shopToast(`Received ${doc.item_icon || ''} ${doc.item_name || item?.name || 'a gift'}!`, '🎁');
        if (doc.note) {
            setTimeout(() => alert(`A note from ${doc.from_name || 'the sender'}:\n\n"${doc.note}"`), 300);
        }
    } catch (e) {
        console.warn('[DR Shop] redeem error', e);
        if (status) status.textContent = 'Error — try again.';
    }
}

/* ── Inventory tab render ── */
function _shopRenderInventory() {
    const list  = document.getElementById('shop-inventory-list');
    const empty = document.getElementById('shop-inventory-empty');
    if (!list) return;
    const owned = [..._shopOwned].map(id => SHOP_POOL.find(i => i.id === id)).filter(Boolean);
    if (!owned.length) {
        list.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = owned.map(item => {
        const gifted = _shopIsGifted(item.id);
        const sellAmt = Math.floor(item.price * (gifted ? 0.5 : 0.7));
        return `
        <div class="shop-history-row">
            <div class="shop-history-icon">${item.icon}</div>
            <div class="shop-history-info">
                <div class="shop-history-name">${item.name} ${gifted ? '<span style="color:#e8c870;font-size:8px;letter-spacing:1px;text-transform:uppercase;">🎁 Gifted</span>' : ''}</div>
                <div class="shop-history-meta">${_shopClassLabel(item.class)}</div>
            </div>
            <div class="shop-history-right" style="display:flex;gap:6px;">
                ${gifted ? '' : `<button class="shop-btn" style="font-size:8px;padding:6px 10px;" onclick="_shopGiftItem('${item.id}')">🎁 Gift</button>`}
                <button class="shop-btn shop-btn-refund" style="font-size:8px;padding:6px 10px;" onclick="_shopSellItem('${item.id}')">Sell ${sellAmt} 🪙</button>
            </div>
        </div>`;
    }).join('');
}

/* ── Sync owned list to Firebase ──
   Personal inventory, same category as profile data — items you bought
   shouldn't disappear (or be tied to) whichever Supabase region you
   picked for matchmaking, so this lives in Firestore, not Supabase.
   Also syncs _shopMeta (gifted flags + disposal history) so buyback
   pricing and gift restrictions persist across devices, and equipped
   cosmetics (in customize.js) are readable by OTHER players' clients —
   that only works because ownership itself lives here, not just in
   localStorage. */
async function _shopSyncOwned() {
    const uid = window._syncedUid || (typeof _syncedUid !== 'undefined' ? _syncedUid : null);
    if (!uid) return;
    try {
        const ownedArr = [..._shopOwned].map(id => {
            const item = SHOP_POOL.find(i => i.id === id);
            const meta = _shopMeta[id] || {};
            return { item_id: id, item_name: item?.name || id, gifted: !!meta.gifted };
        });
        await fsSet('shop_owned', uid, { owned: ownedArr, meta: _shopMeta });
    } catch(e) {}
}

/* ── Load owned from Firebase on login ── */
async function _shopLoadOwned() {
    const uid = window._syncedUid || (typeof _syncedUid !== 'undefined' ? _syncedUid : null);
    if (!uid) return;
    try {
        const data = await fsGet('shop_owned', uid);
        if (data?.owned) {
            data.owned.forEach(e => _shopOwned.add(e.item_id));
        }
        if (data?.meta) Object.assign(_shopMeta, data.meta);
        _shopSave();
    } catch(e) {}
}

/* Fetches another player's equipped cosmetics + gifted-title/frame ids
   for rendering their name-plate/card-back elsewhere (leaderboard,
   lobby, club roster, opponent hand). Returns null on failure so
   callers can fall back to a plain name with no decoration. */
async function shopFetchPublicCosmetics(uid) {
    if (!uid) return null;
    try {
        const profile = await fsGet('profiles', uid);
        return profile?.equipped_cosmetics || null;
    } catch(e) { return null; }
}
window.shopFetchPublicCosmetics = shopFetchPublicCosmetics;

/* ─────────────────── CONFIRM MODAL ─────────────────── */
function _shopShowConfirm({ icon, name, type, typeColor, desc, price, note, onConfirm }) {
    const canAfford = _shopGold >= price;
    let modal = document.getElementById('shop-confirm-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'shop-confirm-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(5px);';
    modal.addEventListener('click', e => { if (e.target === modal) _shopCloseModal(); });
    modal.innerHTML = `
        <div style="background:linear-gradient(160deg,#1a1005,#0d0800);border:1px solid rgba(140,95,25,.45);border-radius:12px;padding:30px 34px;max-width:380px;width:90%;font-family:'Cinzel',serif;color:#d4b878;text-align:center;position:relative;">
            <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${typeColor};border-radius:12px 12px 0 0;"></div>
            <button onclick="_shopCloseModal()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:#5a3a10;font-size:18px;cursor:pointer;">✕</button>
            <div style="font-size:52px;margin:10px 0 10px;">${icon}</div>
            <div style="font-size:15px;font-weight:bold;letter-spacing:1px;margin-bottom:3px;">${name}</div>
            <div style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:${typeColor};margin-bottom:10px;">${type}</div>
            <div style="font-family:'IM Fell English',serif;font-size:11px;color:rgba(200,160,80,.6);font-style:italic;margin-bottom:14px;line-height:1.5;">${desc}</div>
            ${note ? `<div style="font-size:9px;color:#6b8040;letter-spacing:1px;margin-bottom:10px;">${note}</div>` : ''}
            <div style="font-size:9px;color:#5a3a10;letter-spacing:2px;margin-bottom:4px;text-transform:uppercase;">Price</div>
            <div style="font-size:24px;font-weight:bold;color:#e8c87a;margin-bottom:4px;">🪙 ${price.toLocaleString()}</div>
            <div style="font-size:9px;color:${canAfford ? '#4a8040' : '#8b0000'};letter-spacing:1px;margin-bottom:20px;">Your balance: ${_shopGold.toLocaleString()} 🪙</div>
            ${canAfford
                ? `<div style="display:flex;gap:10px;justify-content:center;">
                    <button class="shop-btn shop-btn-gold" data-role="confirm-purchase" style="min-width:120px;">Purchase</button>
                    <button class="shop-btn" style="border-color:rgba(100,65,20,.35);color:#5a3a10;min-width:80px;" onclick="_shopCloseModal()">Cancel</button>
                   </div>`
                : `<div style="font-family:'IM Fell English',serif;font-size:11px;color:rgba(180,60,60,.7);font-style:italic;margin-bottom:14px;">Not enough Gold to purchase this.</div>
                   <button class="shop-btn" style="border-color:rgba(100,65,20,.35);color:#5a3a10;" onclick="_shopCloseModal()">Close</button>`
            }
        </div>`;
    document.body.appendChild(modal);
    if (typeof playSfx === 'function') playSfx('modalOpen');
    // Wire up the confirm button with a real listener (keeping the onConfirm
    // closure intact) instead of serializing the function to a string and
    // re-embedding it as an inline onclick attribute — stringifying a
    // closure loses the variables it closed over (e.g. `item`, `bundle`,
    // `unowned`), so the reconstructed code threw a ReferenceError and the
    // purchase silently failed every time, for every item and bundle.
    modal.querySelector('[data-role="confirm-purchase"]')?.addEventListener('click', onConfirm);
}

/* ─────────────────── HELPERS ─────────────────── */
function _shopCloseModal() {
    document.getElementById('shop-confirm-modal')?.remove();
    if (typeof playSfx === 'function') playSfx('modalClose');
}

function _shopRefreshActive() {
    if (_shopActiveTab === 'featured')  _shopRenderFeatured();
    if (_shopActiveTab === 'cosmetics') _shopRenderCosmetics(_shopActiveSub);
    if (_shopActiveTab === 'bundles')   _shopRenderBundles();
    if (_shopActiveTab === 'history')   _shopRenderHistory();
    if (_shopActiveTab === 'inventory') _shopRenderInventory();
}

function _shopToast(msg, icon = '✓') {
    let t = document.getElementById('shop-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'shop-toast';
        t.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);z-index:99990;background:rgba(10,6,2,.96);border:1px solid rgba(140,95,25,.5);border-radius:999px;padding:8px 22px;font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:1.5px;color:#c8a460;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.7);opacity:0;transition:opacity .2s;pointer-events:none;display:flex;align-items:center;gap:8px;';
        document.body.appendChild(t);
    }
    t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    t.style.opacity = '1';
    if (typeof playSfx === 'function') playSfx('toastPop');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

/* ── Sync popularity to Supabase before page unload ── */
window.addEventListener('beforeunload', _shopSyncPopularity);

/* ── Init ── */
window.addEventListener('DOMContentLoaded', () => {
    _shopLoad();
    _shopUpdateCurrencyDisplay();
});

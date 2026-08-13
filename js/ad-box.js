/* ═══════════════════════════════════════════════════════════════════
   CORNER AD BOX
   ---------------------------------------------------------------------
   A small self-promo carousel that sits in the bottom-right corner of
   the main menu and auto-rotates through a handful of slides (Discord,
   socials, etc). Clicking it opens a bigger detail modal with side
   arrows to cycle through the same slides and an action button that
   performs the slide's actual action (usually opening a link).

   Purely presentational — no gameplay state involved. Visibility is
   restricted to the main menu screen only (hidden on every submenu and
   during combat) via _adBoxUpdateVisibility(), polled on an interval
   since screens/board get shown and hidden from a lot of different
   places across the codebase.
   ═══════════════════════════════════════════════════════════════════ */

const AD_BOX_SLIDES = [
    {
        icon: '💬',
        title: 'Join the Discord',
        sub: 'Chat, get updates, share decks',
        desc: 'Come hang out with the community — talk strategy, share your custom decks, get patch notes before anyone else, and let us know directly what you want to see next.',
        actionLabel: 'Join Discord',
        url: 'https://discord.gg/e2USWdSDKs',
    },
    {
        icon: '🐦',
        title: 'Follow us on X',
        sub: '@r3ctrr313 — dev updates & sneak peeks',
        desc: "We post work-in-progress screenshots, balance changes, and the occasional poll before anything's official. Good place to catch early previews.",
        actionLabel: 'Follow on X',
        url: 'https://x.com/r3ctrr313',
    },
    {
        icon: '▶️',
        title: 'Subscribe on YouTube',
        sub: 'Devlogs, trailers, and gameplay',
        desc: "Full devlogs walking through what changed and why, plus trailers and the odd gameplay showcase. If you'd rather watch than read a changelog, this is the place.",
        actionLabel: 'Subscribe',
        url: 'https://www.youtube.com/@SunCastStudiosYT',
    },
    {
        icon: '🎮',
        title: 'Find us on itch.io',
        sub: 'Solwave Studios — more games',
        desc: 'Check out the rest of what Solwave Studios has been building. If you like the vibe of Damage Roll, there\'s a decent chance you\'ll like what else is on the page.',
        actionLabel: 'Visit itch.io',
        url: 'https://suncast-studios.itch.io',
    },
];

const AD_BOX_INTERVAL_MS = 6000;
let _adBoxIndex = 0;
let _adBoxTimer = null;
let _adModalIndex = 0;
let _adModalOpen = false;

function _adBoxInit() {
    const track = document.getElementById('ad-box-track');
    if (!track) return;

    track.innerHTML = '';
    AD_BOX_SLIDES.forEach((slide, i) => {
        const el = document.createElement('div');
        el.className = 'ad-slide' + (i === 0 ? ' active' : '');
        el.innerHTML = `
            <div class="ad-slide-icon">${slide.icon}</div>
            <div class="ad-slide-text">
                <div class="ad-slide-title">${slide.title}</div>
                <div class="ad-slide-sub">${slide.sub}</div>
            </div>
        `;
        track.appendChild(el);
    });

    const dots = document.createElement('div');
    dots.id = 'ad-box-dots';
    AD_BOX_SLIDES.forEach((_, i) => {
        const d = document.createElement('div');
        d.className = 'ad-dot' + (i === 0 ? ' active' : '');
        dots.appendChild(d);
    });
    track.appendChild(dots);

    _adBoxIndex = 0;
    clearInterval(_adBoxTimer);
    _adBoxTimer = setInterval(_adBoxAdvance, AD_BOX_INTERVAL_MS);

    _adBoxUpdateVisibility();
    setInterval(_adBoxUpdateVisibility, 400);
}

function _adBoxAdvance() {
    if (_adModalOpen) return; // don't rotate the mini box while the modal has focus
    const slides = document.querySelectorAll('#ad-box-track .ad-slide');
    const dots   = document.querySelectorAll('#ad-box-dots .ad-dot');
    if (!slides.length) return;

    slides[_adBoxIndex]?.classList.remove('active');
    dots[_adBoxIndex]?.classList.remove('active');

    _adBoxIndex = (_adBoxIndex + 1) % slides.length;

    slides[_adBoxIndex]?.classList.add('active');
    dots[_adBoxIndex]?.classList.add('active');
}

/* Only show the ad box on the true main menu — never over a submenu
   screen (decks, shop, achievements, game mode select, etc) and never
   during a match. Polled rather than event-hooked since #board's
   visibility in particular gets flipped directly via style.display in
   several places rather than through one central function. */
function _adBoxUpdateVisibility() {
    const box = document.getElementById('ad-box');
    if (!box) return;

    const mainMenu = document.getElementById('menu-main');
    const board    = document.getElementById('board');

    const mainMenuVisible = !!mainMenu && getComputedStyle(mainMenu).display !== 'none';
    const boardVisible    = !!board && getComputedStyle(board).display !== 'none';
    const anySubmenuOpen  = !!document.querySelector('.screen.screen-visible, .screen[style*="display: flex"]:not(#menu-main)');

    const shouldShow = mainMenuVisible && !boardVisible && !anySubmenuOpen && !_adModalOpen;
    box.classList.toggle('ad-box-hidden', !shouldShow);
}

/* ─── Modal ─────────────────────────────────────────────────────────── */

function _adBoxOpenModal() {
    _adModalIndex = _adBoxIndex;
    _adModalOpen = true;
    _adModalRender();
    const overlay = document.getElementById('ad-modal-overlay');
    if (overlay) overlay.classList.add('open');
    if (typeof playSfx === 'function') playSfx('menuClick');
}

function _adModalClose() {
    _adModalOpen = false;
    const overlay = document.getElementById('ad-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    _adBoxUpdateVisibility();
}

function _adModalStep(delta) {
    _adModalIndex = (_adModalIndex + delta + AD_BOX_SLIDES.length) % AD_BOX_SLIDES.length;
    _adModalRender();
    if (typeof playSfx === 'function') playSfx('menuClick');
}

function _adModalRender() {
    const slide = AD_BOX_SLIDES[_adModalIndex];
    if (!slide) return;

    const title  = document.getElementById('ad-modal-title');
    const desc   = document.getElementById('ad-modal-desc');
    const icon   = document.getElementById('ad-modal-icon');
    const action = document.getElementById('ad-modal-action');

    if (title)  title.textContent = slide.title;
    if (desc)   desc.textContent  = slide.desc;
    if (icon)   icon.textContent  = slide.icon;
    if (action) action.textContent = slide.actionLabel;
}

function _adModalAction() {
    const slide = AD_BOX_SLIDES[_adModalIndex];
    if (slide && slide.url) window.open(slide.url, '_blank');
}

document.addEventListener('DOMContentLoaded', _adBoxInit);

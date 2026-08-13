/* ═══════════════════════════════════════════════════════════════════
   CORNER AD BOX
   ---------------------------------------------------------------------
   A small self-promo carousel that sits in the bottom-right corner and
   auto-rotates through a handful of slides (Discord, socials, etc).
   Clicking a slide opens its link in a new tab. Purely presentational
   — no gameplay state involved.
   ═══════════════════════════════════════════════════════════════════ */

const AD_BOX_SLIDES = [
    {
        icon: '💬',
        title: 'Join the Discord',
        sub: 'Chat, get updates, share decks',
        url: 'https://discord.gg/e2USWdSDKs',
    },
    {
        icon: '🐦',
        title: 'Follow us on X',
        sub: '@r3ctrr313 — dev updates & sneak peeks',
        url: 'https://x.com/r3ctrr313',
    },
    {
        icon: '▶️',
        title: 'Subscribe on YouTube',
        sub: 'Devlogs, trailers, and gameplay',
        url: 'https://www.youtube.com/@SunCastStudiosYT',
    },
    {
        icon: '🎮',
        title: 'Find us on itch.io',
        sub: 'Solwave Studios — more games',
        url: 'https://suncast-studios.itch.io',
    },
];

const AD_BOX_INTERVAL_MS = 6000;
let _adBoxIndex = 0;
let _adBoxTimer = null;

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
        el.addEventListener('click', () => window.open(slide.url, '_blank'));
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
}

function _adBoxAdvance() {
    const slides = document.querySelectorAll('#ad-box-track .ad-slide');
    const dots   = document.querySelectorAll('#ad-box-dots .ad-dot');
    if (!slides.length) return;

    slides[_adBoxIndex]?.classList.remove('active');
    dots[_adBoxIndex]?.classList.remove('active');

    _adBoxIndex = (_adBoxIndex + 1) % slides.length;

    slides[_adBoxIndex]?.classList.add('active');
    dots[_adBoxIndex]?.classList.add('active');
}

document.addEventListener('DOMContentLoaded', _adBoxInit);

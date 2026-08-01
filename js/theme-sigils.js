/* ═══════════════════════════════════════════════════════════════════
   THEME SIGILS — the ring/frame that encases the hero card on the
   main menu. Previously identical geometry (gothic hexagram+circles)
   across every theme, just recolored. Each theme now gets a shape
   language of its own so the menu reads as a different game at a
   glance, not a recolor of the same screen.
   ═══════════════════════════════════════════════════════════════════ */

function _sigilRing(cx, cy, r, opts = {}) {
    const { dash = '', op = 0.3, w = 1, color = '255,160,30' } = opts;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="rgba(${color},${op})" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
}

const THEME_SIGILS = {
    /* Default — the original gothic hexagram + circles, untouched */
    default: {
        outer: `
            <circle cx="160" cy="160" r="150" stroke="rgba(255,170,30,0.3)" stroke-width="1"/>
            <circle cx="160" cy="160" r="130" stroke="rgba(255,140,20,0.2)" stroke-width="1" stroke-dasharray="3 7"/>
            <polygon points="160,20 291,95 291,245 160,320 29,245 29,95" fill="none" stroke="rgba(255,160,30,0.25)" stroke-width="1"/>
            <path d="M160 30 L170 140 L280 160 L170 180 L160 290 L150 180 L40 160 L150 140 Z" fill="none" stroke="rgba(255,160,40,0.2)" stroke-width="1"/>
            <line x1="160" y1="10" x2="160" y2="22" stroke="rgba(255,200,80,0.6)" stroke-width="1.5"/>
            <line x1="160" y1="298" x2="160" y2="310" stroke="rgba(255,200,80,0.6)" stroke-width="1.5"/>
            <line x1="10" y1="160" x2="22" y2="160" stroke="rgba(255,200,80,0.6)" stroke-width="1.5"/>
            <line x1="298" y1="160" x2="310" y2="160" stroke="rgba(255,200,80,0.6)" stroke-width="1.5"/>`,
        inner: `
            <circle cx="120" cy="120" r="100" stroke="rgba(255,160,30,0.3)" stroke-width="1" stroke-dasharray="2 5"/>
            <circle cx="120" cy="120" r="80" stroke="rgba(255,140,20,0.2)" stroke-width="1"/>
            <polygon points="120,25 205,175 35,175" fill="none" stroke="rgba(255,170,40,0.3)" stroke-width="1"/>
            <polygon points="120,215 35,65 205,65" fill="none" stroke="rgba(255,150,30,0.25)" stroke-width="1"/>
            <circle cx="120" cy="120" r="18" stroke="rgba(255,200,60,0.5)" stroke-width="1.5"/>`,
    },

    /* Space — concentric orbital rings + planet dots on elliptical paths */
    space: {
        outer: `
            <ellipse cx="160" cy="160" rx="150" ry="60" stroke="rgba(120,180,255,0.25)" stroke-width="1"/>
            <ellipse cx="160" cy="160" rx="150" ry="60" stroke="rgba(120,180,255,0.15)" stroke-width="1" transform="rotate(60 160 160)"/>
            <ellipse cx="160" cy="160" rx="150" ry="60" stroke="rgba(120,180,255,0.15)" stroke-width="1" transform="rotate(120 160 160)"/>
            <circle cx="160" cy="160" r="150" stroke="rgba(120,180,255,0.2)" stroke-width="1" stroke-dasharray="1 6"/>
            <circle cx="292" cy="160" r="3" fill="rgba(180,220,255,0.8)"/>
            <circle cx="34" cy="160" r="2.5" fill="rgba(140,190,255,0.6)"/>
            <circle cx="160" cy="24" r="2" fill="rgba(160,200,255,0.5)"/>`,
        inner: `
            <circle cx="120" cy="120" r="100" stroke="rgba(120,180,255,0.25)" stroke-width="1"/>
            <circle cx="120" cy="120" r="70" stroke="rgba(120,180,255,0.15)" stroke-width="1" stroke-dasharray="1 5"/>
            <circle cx="120" cy="120" r="18" stroke="rgba(180,220,255,0.5)" stroke-width="1.5"/>
            <circle cx="120" cy="20" r="2" fill="rgba(160,200,255,0.7)"/>
            <circle cx="220" cy="120" r="1.5" fill="rgba(140,190,255,0.5)"/>`,
    },

    /* Aero — soft overlapping bubble/droplet circles, glassy */
    aero: {
        outer: `
            <circle cx="160" cy="160" r="150" stroke="rgba(120,210,230,0.35)" stroke-width="1.5"/>
            <circle cx="110" cy="110" r="55" stroke="rgba(160,230,240,0.25)" stroke-width="1"/>
            <circle cx="220" cy="130" r="40" stroke="rgba(180,235,220,0.2)" stroke-width="1"/>
            <circle cx="150" cy="240" r="45" stroke="rgba(200,240,235,0.2)" stroke-width="1"/>
            <ellipse cx="160" cy="100" rx="60" ry="20" fill="rgba(255,255,255,0.05)"/>`,
        inner: `
            <circle cx="120" cy="120" r="100" stroke="rgba(120,210,230,0.3)" stroke-width="1.5"/>
            <circle cx="90" cy="95" r="30" stroke="rgba(180,235,230,0.2)" stroke-width="1"/>
            <circle cx="120" cy="120" r="18" stroke="rgba(200,240,235,0.45)" stroke-width="1.5"/>`,
    },

    /* Cyberpunk — angular circuit-board traces, PCB nodes */
    cyberpunk: {
        outer: `
            <polygon points="160,20 291,95 291,245 160,320 29,245 29,95" fill="none" stroke="rgba(255,0,180,0.3)" stroke-width="1"/>
            <path d="M160 20 L160 60 M291 95 L255 95 L255 130 M291 245 L255 245 L255 210 M160 320 L160 280 M29 245 L65 245 L65 210 M29 95 L65 95 L65 130"
                  stroke="rgba(0,220,255,0.35)" stroke-width="1.5"/>
            <rect x="150" y="10" width="20" height="8" fill="rgba(255,0,180,0.4)"/>
            <rect x="55" y="122" width="10" height="16" fill="rgba(0,220,255,0.3)"/>
            <rect x="255" y="122" width="10" height="16" fill="rgba(0,220,255,0.3)"/>
            <circle cx="160" cy="160" r="150" stroke="rgba(255,0,180,0.15)" stroke-width="1" stroke-dasharray="1 8"/>`,
        inner: `
            <polygon points="120,20 220,120 120,220 20,120" fill="none" stroke="rgba(255,0,180,0.3)" stroke-width="1"/>
            <path d="M120 20 L120 45 M220 120 L195 120 M120 220 L120 195 M20 120 L45 120" stroke="rgba(0,220,255,0.4)" stroke-width="1.5"/>
            <rect x="112" y="112" width="16" height="16" fill="none" stroke="rgba(255,0,180,0.5)" stroke-width="1.5"/>`,
    },

    /* Scourge — pentagram + jagged bone-like inner spikes */
    scourge: {
        outer: `
            <circle cx="160" cy="160" r="150" stroke="rgba(120,220,90,0.25)" stroke-width="1"/>
            <polygon points="160,25 205,145 335,145 230,220 270,340 160,265 50,340 90,220 -15,145 115,145"
                     fill="none" stroke="rgba(120,220,90,0.3)" stroke-width="1" transform="translate(0,-10) scale(0.72)" />
            <path d="M160 20 L145 90 L160 100 L175 90 Z" fill="rgba(120,220,90,0.2)"/>
            <path d="M160 300 L145 230 L160 220 L175 230 Z" fill="rgba(120,220,90,0.2)"/>
            <circle cx="160" cy="160" r="110" stroke="rgba(180,255,150,0.15)" stroke-width="1" stroke-dasharray="4 4"/>`,
        inner: `
            <circle cx="120" cy="120" r="100" stroke="rgba(120,220,90,0.25)" stroke-width="1"/>
            <path d="M120 30 L145 100 L215 100 L160 145 L180 215 L120 175 L60 215 L80 145 L25 100 L95 100 Z"
                  fill="none" stroke="rgba(120,220,90,0.3)" stroke-width="1"/>
            <circle cx="120" cy="120" r="16" stroke="rgba(180,255,150,0.5)" stroke-width="1.5"/>`,
    },

    /* Wiki — plain, minimal editorial ring, no ornamentation */
    wiki: {
        outer: `
            <circle cx="160" cy="160" r="150" stroke="rgba(80,80,90,0.25)" stroke-width="1"/>
            <circle cx="160" cy="160" r="145" stroke="rgba(80,80,90,0.15)" stroke-width="0.5"/>`,
        inner: `
            <circle cx="120" cy="120" r="100" stroke="rgba(80,80,90,0.25)" stroke-width="1"/>
            <circle cx="120" cy="120" r="18" stroke="rgba(80,80,90,0.4)" stroke-width="1"/>`,
    },

    /* 8Space — blocky pixel-grid ring built from small squares */
    '8space': {
        outer: (() => {
            let s = '';
            const cx = 160, cy = 160, r = 148, n = 28;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
                const c = i % 3 === 0 ? '0,229,255' : '255,0,200';
                s += `<rect x="${(x-4).toFixed(1)}" y="${(y-4).toFixed(1)}" width="8" height="8" fill="rgba(${c},0.5)"/>`;
            }
            return s;
        })(),
        inner: (() => {
            let s = '';
            const cx = 120, cy = 120, r = 98, n = 20;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
                s += `<rect x="${(x-3).toFixed(1)}" y="${(y-3).toFixed(1)}" width="6" height="6" fill="rgba(0,229,255,0.4)"/>`;
            }
            return s;
        })(),
    },

    /* Casting Casings — gear/cog rings, wizard-gunsmith mechanism */
    castingcasings: {
        outer: (() => {
            const cx = 160, cy = 160, rOuter = 150, rInner = 138, teeth = 24;
            let pts = [];
            for (let i = 0; i < teeth * 2; i++) {
                const a = (i / (teeth * 2)) * Math.PI * 2;
                const r = i % 2 === 0 ? rOuter : rInner;
                pts.push(`${(cx + Math.cos(a)*r).toFixed(1)},${(cy + Math.sin(a)*r).toFixed(1)}`);
            }
            return `<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(220,160,60,0.3)" stroke-width="1.5"/>
                    <circle cx="${cx}" cy="${cy}" r="115" stroke="rgba(180,140,220,0.2)" stroke-width="1" stroke-dasharray="6 4"/>`;
        })(),
        inner: (() => {
            const cx = 120, cy = 120, rOuter = 98, rInner = 88, teeth = 16;
            let pts = [];
            for (let i = 0; i < teeth * 2; i++) {
                const a = (i / (teeth * 2)) * Math.PI * 2;
                const r = i % 2 === 0 ? rOuter : rInner;
                pts.push(`${(cx + Math.cos(a)*r).toFixed(1)},${(cy + Math.sin(a)*r).toFixed(1)}`);
            }
            return `<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(220,160,60,0.3)" stroke-width="1.5"/>
                    <circle cx="${cx}" cy="${cy}" r="18" stroke="rgba(180,140,220,0.4)" stroke-width="1.5"/>`;
        })(),
    },
};

function _applyThemeSigil(theme) {
    const pack = THEME_SIGILS[theme] || THEME_SIGILS.default;
    const outer = document.getElementById('title-sigil');
    const inner = document.getElementById('title-sigil-inner');
    if (outer) outer.innerHTML = pack.outer;
    if (inner) inner.innerHTML = pack.inner;
}

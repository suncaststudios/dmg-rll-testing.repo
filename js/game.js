const runeSymbols = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ','ᛞ','ᛟ','✦','⚔','☽','★'];
const runeGrid = document.getElementById('rune-grid');
for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'rune-cell';
    el.textContent = runeSymbols[Math.floor(Math.random() * runeSymbols.length)];
    el.style.left = (Math.random() * 100) + '%';
    el.style.top = (Math.random() * 100) + '%';
    el.style.setProperty('--rd', (3 + Math.random() * 6) + 's');
    el.style.setProperty('--delay', -(Math.random() * 8) + 's');
    el.style.fontSize = (14 + Math.random() * 18) + 'px';
    runeGrid.appendChild(el);
}

let _graphicsQuality  = 'mid';      

let _gameOverFired = false;
let _forfeited     = false;
let _battleStartTs = 0; // Date.now() when the current battle began — used for speedrun leaderboard timing
let _aiActTimer    = null;
let _pWasLow = false, _aWasLow = false;
let _cardDark      = 0;             

const emberCanvas = document.getElementById('embers');
const eCtx = emberCanvas.getContext('2d');
const embers = [];

function resizeEmberCanvas() {
    emberCanvas.width  = window.innerWidth;
    emberCanvas.height = window.innerHeight;
}
resizeEmberCanvas();
window.addEventListener('resize', resizeEmberCanvas);

function spawnEmber() {
    const hue = 20 + Math.random() * 30; // orange to gold
    return {
        x: Math.random() * window.innerWidth, y: window.innerHeight + 10,
        r: Math.random() * 2.5 + 0.8,
        dx: (Math.random() - 0.5) * 1.8,
        dy: -(Math.random() * 2.2 + 0.6),
        life: 1, decay: Math.random() * 0.003 + 0.0015,
        hue
    };
}
for (let i = 0; i < 60; i++) {
    const e = spawnEmber();
    e.y = Math.random() * window.innerHeight;
    e.life = Math.random();
    embers.push(e);
}
function animEmbers() {
    eCtx.clearRect(0, 0, emberCanvas.width, emberCanvas.height);
    
    const targetCount = _graphicsQuality === 'high' ? 120 : _graphicsQuality === 'low' ? 0 : 60;
    while (embers.length < targetCount) { const e = spawnEmber(); e.y = Math.random() * window.innerHeight; e.life = Math.random(); embers.push(e); }
    while (embers.length > targetCount) embers.pop();
    embers.forEach((e, idx) => {
        e.x += e.dx; e.y += e.dy; e.life -= e.decay;
        if (e.life <= 0) { embers[idx] = spawnEmber(); return; }
        const g = eCtx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 2.2);
        g.addColorStop(0, `hsla(${e.hue + 10}, 90%, 65%, ${e.life * 0.55})`);
        g.addColorStop(0.5, `hsla(${e.hue}, 80%, 35%, ${e.life * 0.3})`);
        g.addColorStop(1, 'transparent');
        eCtx.beginPath(); eCtx.arc(e.x, e.y, e.r * 2.2, 0, Math.PI * 2);
        eCtx.fillStyle = g; eCtx.fill();
    });
    requestAnimationFrame(animEmbers);
}
animEmbers();

/* ── CARD CURSOR TILT (tilts toward cursor within right panel) ── */
(function() {
    const card = document.getElementById('menu-float-card');
    if (!card) return;
    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;

    window.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth  * 0.3)));
        const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.3)));
        targetY =  nx * 22;
        targetX = -ny * 22;
    });

    function loop() {
        currentX += (targetX - currentX) * 0.08;
        currentY += (targetY - currentY) * 0.08;
        card.style.transform = `rotateX(${currentX}deg) rotateY(${currentY}deg)`;
        requestAnimationFrame(loop);
    }
    loop();
})();

const trailCanvas = document.getElementById('trail-canvas');
const tCtx = trailCanvas.getContext('2d');
let activeTrail = null;

function startTrail(sx, sy, ex, ey, color) {
    activeTrail = { sx, sy, ex, ey, color, t: 0 };
}
function animTrail() {
    tCtx.clearRect(0, 0, 980, 670);
    if (activeTrail) {
        const tr = activeTrail; tr.t = Math.min(tr.t + 0.07, 1);
        const cx = tr.sx + (tr.ex - tr.sx) * tr.t;
        const cy = tr.sy + (tr.ey - tr.sy) * tr.t;
        const g = tCtx.createLinearGradient(tr.sx, tr.sy, cx, cy);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.3, tr.color.replace('1)', '0.15)'));
        g.addColorStop(1, tr.color);
        tCtx.beginPath(); tCtx.moveTo(tr.sx, tr.sy); tCtx.lineTo(cx, cy);
        tCtx.strokeStyle = g; tCtx.lineWidth = 4;
        tCtx.shadowColor = tr.color; tCtx.shadowBlur = 14; tCtx.stroke(); tCtx.shadowBlur = 0;
        if (tr.t >= 1) setTimeout(() => { activeTrail = null; }, 150);
    }
    requestAnimationFrame(animTrail);
}
animTrail();

let AC = null, muted = false, musicVol = .4, sfxVol = .7;
let _musicNodes = null;
let _menuMusicNodes = null;

/* ── Volume sliders — SFX is fully live; music volume is stored for
   whatever the .ogg player reads once it's wired up. ── */
function setMusicVol(val) {
    musicVol = Math.max(0, Math.min(100, val)) / 100;
    try { localStorage.setItem('dr_music_vol', musicVol); } catch(e) {}
}
function setSfxVol(val) {
    sfxVol = Math.max(0, Math.min(100, val)) / 100;
    try { localStorage.setItem('dr_sfx_vol', sfxVol); } catch(e) {}
}

function getAC() {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    return AC;
}

function masterGain(vol) {
    const g = getAC().createGain();
    g.gain.setValueAtTime(muted ? 0 : vol, AC.currentTime);
    g.connect(AC.destination);
    return g;
}

function osc(type, freq, start, end, dur, gainVal, dest) {
    const ac = getAC(), now = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now + start);
    if (end !== null) o.frequency.exponentialRampToValueAtTime(end, now + start + dur);
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(gainVal, now + start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    o.connect(g); g.connect(dest);
    o.start(now + start); o.stop(now + start + dur + 0.01);
    return o;
}

function noise(dur, gainVal, filterFreq, dest) {
    const ac = getAC(), now = ac.currentTime;
    const bufLen = ac.sampleRate * dur;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq;
    filt.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(gainVal, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt); filt.connect(g); g.connect(dest);
    src.start(now); src.stop(now + dur);
}

function punchDest(vol) {
    const ac = getAC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 3;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.08;
    const g = ac.createGain();
    g.gain.setValueAtTime(muted ? 0 : vol, ac.currentTime);
    comp.connect(g); g.connect(ac.destination);
    return comp;
}

const SFX = {

    cardHover() {
        const dest = masterGain(sfxVol * 0.3);
        osc('triangle', 1800, 0, 900, 0.06, 0.08, dest);
        noise(0.04, 0.12, 4000, dest);
    },

    play() {
        const dest = punchDest(sfxVol * 0.85);
        osc('triangle', 800,  0,    180, 0.14, 0.45, dest);
        osc('sine',     350,  0,    100, 0.14, 0.35, dest);
        osc('square',   220,  0,    60,  0.10, 0.3,  dest);
        noise(0.10, 0.55, 1800, dest);
        noise(0.05, 0.35, 600,  dest);
    },

    dice() {
        const dest = punchDest(sfxVol * 0.9);
        osc('square',   800, 0,    200, 0.04, 0.6, dest);
        osc('triangle', 400, 0,    80,  0.06, 0.4, dest);
        noise(0.09, 0.7, 3500, dest);
        noise(0.07, 0.5, 1200, dest);
        noise(0.12, 0.3, 400,  dest);
    },

    dieLand() {
        const dest = punchDest(sfxVol * 1.0);
        osc('sine',     90,  0,    30,  0.18, 0.8, dest); 
        osc('triangle', 180, 0,    50,  0.12, 0.5, dest);
        noise(0.12, 0.6, 800,  dest);
        noise(0.06, 0.4, 3000, dest);
    },

    attackSwing() {
        const dest = punchDest(sfxVol * 0.8);
        osc('sawtooth', 600, 0, 80, 0.16, 0.45, dest);
        osc('triangle', 400, 0, 60, 0.12, 0.35, dest);
        noise(0.10, 0.5, 2500, dest);
    },

    attack() {
        const dest = punchDest(sfxVol * 1.1);
        osc('sawtooth', 240, 0,    35,  0.26, 0.7, dest);
        osc('square',   120, 0,    30,  0.32, 0.6, dest);
        osc('triangle', 480, 0.01, 80,  0.18, 0.45,dest);
        osc('sine',     55,  0,    18,  0.22, 0.8, dest); 
        osc('sawtooth', 360, 0.02, 50,  0.14, 0.5, dest); 
        noise(0.22, 0.90, 1500, dest);
        noise(0.14, 0.70, 400,  dest);
        noise(0.08, 0.45, 6000, dest); 
    },

    mirror() {
        const dest = punchDest(sfxVol * 0.75);
        [2093, 2637, 3136, 1760].forEach((f, i) =>
            osc('sine', f, i * 0.03, f * 0.5, 0.3, 0.22, dest));
        noise(0.08, 0.4, 5000, dest);
        osc('triangle', 3500, 0, 800, 0.12, 0.18, dest);
    },

    mirrorTrigger() {
        const dest = punchDest(sfxVol * 0.9);
        osc('square',   1200, 0,    200, 0.08, 0.5, dest);
        osc('sawtooth', 600,  0,    2400,0.12, 0.25,dest); 
        [1047, 1319, 1568].forEach((f, i) =>
            osc('sine', f, 0.05 + i * 0.04, f * 1.8, 0.25, 0.18, dest));
        noise(0.1, 0.55, 4000, dest);
    },

    heal() {
        const dest = punchDest(sfxVol * 0.8);
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((f, i) => {
            osc('sine',     f,     i * 0.06, f * 1.6, 0.4, 0.32, dest);
            osc('triangle', f * 2, i * 0.06, f * 3,   0.3, 0.10, dest);
        });
        noise(0.06, 0.2, 8000, dest); 
    },

    vampire() {
        const dest = punchDest(sfxVol * 0.85);
        osc('sawtooth', 600,  0,    80,  0.20, 0.5, dest);
        osc('sine',     300,  0,    40,  0.16, 0.6, dest);
        osc('triangle', 1200, 0,    200, 0.12, 0.4, dest);
        noise(0.18, 0.6, 900,  dest);
        osc('sine',     200,  0.15, 800, 0.25, 0.3, dest);
        osc('triangle', 400,  0.18, 1600,0.20, 0.2, dest);
    },

    tariff() {
        const dest = punchDest(sfxVol * 0.8);
        osc('square',   150, 0,    100, 0.22, 0.55,dest); 
        osc('sine',     80,  0,    60,  0.18, 0.6, dest); 
        noise(0.15, 0.5, 600,  dest); 
        noise(0.08, 0.3, 3000, dest); 
        osc('triangle', 300, 0.06, 200, 0.10, 0.35,dest);
    },

    plague() {
        const dest = punchDest(sfxVol * 0.8);
        noise(0.25, 0.6, 400,  dest); 
        noise(0.15, 0.4, 1200, dest);
        noise(0.08, 0.3, 200,  dest); 
        osc('sawtooth', 120, 0,    60,  0.14, 0.5, dest);
        osc('triangle', 240, 0.05, 80,  0.12, 0.4, dest);
        osc('sine',     80,  0,    40,  0.16, 0.55,dest);
    },

    poisonTick() {
        const dest = punchDest(sfxVol * 0.55);
        osc('sawtooth', 200, 0, 80,  0.12, 0.35, dest);
        noise(0.08, 0.35, 500, dest);
        osc('sine',     100, 0, 50,  0.10, 0.3,  dest);
    },

    pet() {
        const dest = punchDest(sfxVol * 1.0);
        osc('sawtooth', 110, 0,    55,  0.35, 0.7, dest);
        osc('sawtooth', 220, 0,    110, 0.28, 0.6, dest);
        osc('square',   165, 0,    82,  0.22, 0.55,dest);
        osc('sine',     55,  0,    30,  0.30, 0.8, dest); 
        noise(0.3,  0.7, 800,  dest);
        noise(0.15, 0.4, 3000, dest);
        osc('sawtooth', 180, 0.1, 90, 0.30, 0.6, dest);
    },

    petHit() {
        const dest = punchDest(sfxVol * 0.75);
        osc('sawtooth', 160, 0,    80,  0.18, 0.45, dest);
        noise(0.12, 0.55, 1000, dest);
        osc('sine',     60,  0,    30,  0.16, 0.5,  dest);
    },

    crit() {
        const dest = punchDest(sfxVol * 1.15);
        osc('sawtooth', 110, 0,    880,  0.42, 0.65, dest);
        osc('square',   165, 0,    1320, 0.36, 0.58, dest);
        osc('sawtooth', 220, 0,    1760, 0.34, 0.52, dest);
        osc('triangle', 440, 0,    3520, 0.26, 0.42, dest);
        osc('sawtooth', 330, 0.02, 2640, 0.20, 0.38, dest); 
        osc('sine',     880,  0.04, 3520, 0.24, 0.38, dest);
        osc('sine',     1760, 0.06, 7040, 0.20, 0.28, dest);
        osc('sine',     3520, 0.08, 7040, 0.12, 0.18, dest); 
        osc('sine',     50,  0,    18,   0.55, 0.45, dest);
        osc('sine',     38,  0,    14,   0.48, 0.40, dest);
        noise(0.22, 1.0, 5000, dest);
        noise(0.14, 0.8, 1200, dest);
        noise(0.10, 0.6, 300,  dest);
    },

    fail() {
        const dest = punchDest(sfxVol * 1.0);
        osc('sawtooth', 520, 0,    38,  0.34, 0.65, dest);
        osc('square',   260, 0,    28,  0.32, 0.58, dest);
        osc('sawtooth', 370, 0.03, 22,  0.28, 0.52, dest);
        osc('sawtooth', 180, 0.06, 18,  0.24, 0.48, dest);
        osc('sawtooth', 90,  0.08, 14,  0.20, 0.44, dest); 
        osc('sine',     75,  0,    22,  0.38, 0.65, dest); 
        noise(0.28, 0.85, 900,  dest);
        noise(0.18, 0.55, 250,  dest);
        noise(0.10, 0.45, 3500, dest);
    },

    selfHit() {
        const dest = punchDest(sfxVol * 0.9);
        osc('square',   300, 0,    50,  0.25, 0.6,  dest);
        osc('sine',     100, 0,    30,  0.22, 0.55, dest);
        noise(0.18, 0.7, 1000, dest);
        noise(0.10, 0.5, 300,  dest);
    },

    hpLow() {
        const dest = masterGain(sfxVol * 0.45);
        osc('sine',     220, 0,    200, 0.3, 0.3, dest);
        osc('triangle', 110, 0,    100, 0.3, 0.25,dest);
    },

    victory() {
        const dest = punchDest(sfxVol * 0.9);
        const melody = [523, 659, 784, 1047, 1319, 1047, 1319, 1568];
        melody.forEach((f, i) => {
            osc('triangle', f,     i * 0.11, f * 1.2,  0.32, 0.32, dest);
            osc('sine',     f * 2, i * 0.11, f * 2.4,  0.22, 0.14, dest);
            osc('square',   f * 0.5, i * 0.12, f * 0.6, 0.10, 0.22, dest); 
        });
        [261.6, 329.6, 392, 523].forEach((f, i) => {
            osc('sine', f, 0.05 + i * 0.04, f * 1.1, 0.18, 0.5, dest);
        });
        osc('sine', 55, 0, 28, 0.7, 0.6, dest);
        noise(0.12, 0.4, 6000, dest);
    },

    defeat() {
        const dest = punchDest(sfxVol * 0.9);
        [440, 349, 262, 196, 147, 110].forEach((f, i) => {
            osc('sawtooth', f,     i * 0.15, f * 0.45, 0.50, 0.30, dest);
            osc('sine',     f * 2, i * 0.17, f * 0.90, 0.20, 0.20, dest);
        });
        osc('sine', 220, 0.5,  218, 0.6, 1.2, dest);
        osc('sine', 110, 0.52, 108, 0.5, 1.0, dest);
        osc('sine', 55,  0,    18,  0.9, 0.7, dest);
        noise(0.35, 0.5, 400, dest);
    },

    menuHover() {
        const dest = masterGain(sfxVol * 0.28);
        osc('triangle', 1400, 0,    1000, 0.07, 0.14, dest);
        osc('sine',     2100, 0.01, 1500, 0.04, 0.10, dest);
        noise(0.03, 0.12, 5000, dest);
    },

    menuClick() {
        const dest = punchDest(sfxVol * 0.60);
        osc('square',   700, 0,    250, 0.10, 0.32, dest);
        osc('triangle', 1050,0,    500, 0.08, 0.22, dest);
        osc('sine',     350, 0,    150, 0.12, 0.28, dest);
        noise(0.07, 0.35, 3000, dest);
    },

    aiThink() {
        const dest = masterGain(sfxVol * 0.2);
        osc('triangle', 400, 0, 300, 0.05, 0.08, dest);
        noise(0.04, 0.1, 2000, dest);
    },

    aiReveal() {
        const dest = punchDest(sfxVol * 0.65);
        osc('triangle', 500, 0,    1200, 0.12, 0.25, dest);
        osc('sine',     800, 0.04, 1600, 0.10, 0.2,  dest);
        noise(0.08, 0.35, 3500, dest);
    },

    turnStart() {
        const dest = masterGain(sfxVol * 0.40);
        osc('sine',     880,  0,    1320, 0.18, 0.20, dest);
        osc('triangle', 1320, 0.05, 1760, 0.13, 0.17, dest);
        osc('sine',     440,  0,    660,  0.10, 0.22, dest); 
    },

    cardDeal() {
        const dest = masterGain(sfxVol * 0.32);
        osc('triangle', 1100, 0,    450, 0.09, 0.10, dest);
        osc('sine',     700,  0.01, 300, 0.06, 0.09, dest);
        noise(0.07, 0.18, 4000, dest);
        noise(0.04, 0.10, 800,  dest);
    },
};

/* ── playSfx: global dispatcher used by every onclick handler in index.html ──
   Wrapped in try/catch so a missing sound name or an audio-engine hiccup
   can NEVER throw and abort the rest of a button's onclick handler (which is
   exactly what was happening before this existed — playSfx() was undefined,
   so it threw a ReferenceError and every statement after it in the same
   onclick attribute silently never ran). */
window.playSfx = function playSfx(name) {
    try {
        if (muted) return;
        const fn = SFX[name];
        if (typeof fn === 'function') fn();
    } catch (e) {
        console.warn('[playSfx] failed for', name, e);
    }
};

/* Music system removed — was a procedural Web Audio synth engine
   (startMenuAudioTrack1-3, startBgAudioTrack1-3) plus a custom-folder
   file picker (openMusicFolder, setCustomTrack, etc). All gone.
   New music will be wired up around fixed .ogg files. */

function handleModDrop(event) {
    event.preventDefault();
    const zone = document.getElementById('mod-drop-zone');
    zone.style.borderColor = '';
    zone.style.background = '';
    const file = event.dataTransfer.files[0];
    if (file) loadModFile(file);
}

function handleModFileInput(input) {
    const file = input.files[0];
    if (file) loadModFile(file);
    input.value = '';
}

const MOD_CARD_CLASSES = {
    attack:   { label: 'Attack',   desc: 'Deals direct damage to the opponent.' },
    heal:     { label: 'Heal',     desc: 'Restores HP to the caster.' },
    drain:    { label: 'Drain',    desc: 'Steals HP from the opponent.' },
    debuff:   { label: 'Debuff',   desc: 'Applies a negative status to the opponent.' },
    buff:     { label: 'Buff',     desc: 'Grants a positive status to the caster.' },
    reflect:  { label: 'Reflect',  desc: 'Redirects or reflects incoming damage.' },
    poison:   { label: 'Poison',   desc: 'Applies damage-over-time poison to the opponent.' },
    burn:     { label: 'Burn',     desc: 'Applies damage-over-time burn to the opponent.' },
    freeze:   { label: 'Freeze',   desc: "Skips the opponent's turn." },
    curse:    { label: 'Curse',    desc: "Forces the opponent's next action to fail." },
    tariff:   { label: 'Tariff',   desc: 'Halves damage dealt by the opponent for a number of turns.' },
    chain:    { label: 'Chain',    desc: 'On crit, triggers an additional roll.' },
    pierce:   { label: 'Pierce',   desc: 'Bypasses shields and pets.' },
    multi:    { label: 'Multi',    desc: 'Hits multiple times per use.' },
    reroll:   { label: 'Reroll',   desc: 'Grants a free die reroll.' },
    utility:  { label: 'Utility',  desc: 'Does not fit into a single damage/heal category.' },
};

let BUILTIN_CARD_IDS = null;
function _getBuiltinIds() { if (!BUILTIN_CARD_IDS) BUILTIN_CARD_IDS = new Set(Object.values(ALL_CARDS).map(c => c.id)); return BUILTIN_CARD_IDS; }

function _sanitizeMod(mod) {
    const BLOCKED_KEYS = ['ai','difficulty','settings','aiThink','critMult','berserkerNerf','mechanics','weights'];
    const clean = {};
    for (const k of Object.keys(mod)) {
        if (!BLOCKED_KEYS.includes(k)) clean[k] = mod[k];
    }
    return clean;
}

function _applyModTheme(mod) {
    if (!mod.theme || typeof mod.theme !== 'object') return;
    const id = 'mod-theme-' + mod.name.replace(/[^a-z0-9]/gi, '_');
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const ALLOWED_VARS = [
        '--gold','--gold-dim','--gold-bright','--rare','--epic','--legendary','--common',
        '--bg-deep','--bg-mid','--bg-surface','--border-gold','--border-dim',
        '--text-primary','--text-secondary','--text-dim','--accent','--accent-dim',
        '--card-bg','--card-border','--card-text','--card-rarity-common','--card-rarity-uncommon',
        '--card-rarity-rare','--card-rarity-epic','--card-rarity-legendary',
        '--hp-bar-player','--hp-bar-enemy','--die-face','--die-text',
        '--btn-bg','--btn-border','--btn-text','--panel-bg','--panel-border',
    ];
    const varLines = [];
    for (const [k, v] of Object.entries(mod.theme)) {
        if (ALLOWED_VARS.includes(k) && typeof v === 'string' && v.length < 80) {
            varLines.push(`    ${k}: ${v};`);
        }
    }
    if (varLines.length === 0) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `body {\n${varLines.join('\n')}\n}`;
    document.head.appendChild(style);
    if (THEMES.indexOf(mod.name) === -1) THEMES.push(mod.name);
    if (!mod.theme._skipSwatch) {
        const picker = document.getElementById('opt-theme-picker');
        if (picker && !picker.querySelector(`[data-theme="${mod.name}"]`)) {
            const btn = document.createElement('button');
            btn.className = 'theme-swatch';
            btn.dataset.theme = mod.name;
            btn.title = mod.name;
            const bg = mod.theme['--accent'] || mod.theme['--gold'] || '#c8a460';
            btn.style.background = `linear-gradient(135deg, ${bg} 0%, #0d0400 100%)`;
            btn.innerHTML = `<span class="theme-swatch-label">${mod.name}</span>`;
            btn.addEventListener('click', function() { playSfx('menuClick'); selectTheme(mod.name); });
            picker.appendChild(btn);
        }
    }
}

function _removeModTheme(mod) {
    const id = 'mod-theme-' + mod.name.replace(/[^a-z0-9]/gi, '_');
    const el = document.getElementById(id);
    if (el) el.remove();
    const idx = THEMES.indexOf(mod.name);
    if (idx > -1) THEMES.splice(idx, 1);
    const picker = document.getElementById('opt-theme-picker');
    if (picker) { const btn = picker.querySelector(`[data-theme="${mod.name}"]`); if (btn) btn.remove(); }
    if (_currentTheme === mod.name) applyTheme('default');
}

function _applyModVisuals(mod) {
    if (!mod.visuals || typeof mod.visuals !== 'object') return;
    const id = 'mod-visuals-' + mod.name.replace(/[^a-z0-9]/gi, '_');
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const ALLOWED_SELECTORS = {
        'body-bg':        { sel: 'body',              props: ['background','background-color'] },
        'panel-bg':       { sel: '.panel',             props: ['background','border-color'] },
        'card-bg':        { sel: '.hand-card',         props: ['background','border-color','color'] },
        'btn-style':      { sel: '.btn',               props: ['background','border-color','color'] },
        'hp-bar-player':  { sel: '#hp-bar-p .hp-fill', props: ['background'] },
        'hp-bar-enemy':   { sel: '#hp-bar-a .hp-fill', props: ['background'] },
        'title-color':    { sel: '#game-title',        props: ['color','text-shadow'] },
        'overlay-bg':     { sel: '.overlay',           props: ['background'] },
        'tooltip-bg':     { sel: '.tooltip',           props: ['background','border-color','color'] },
    };
    const cssLines = [];
    for (const [key, val] of Object.entries(mod.visuals)) {
        const rule = ALLOWED_SELECTORS[key];
        if (!rule || typeof val !== 'object') continue;
        const decls = [];
        for (const [prop, v] of Object.entries(val)) {
            if (rule.props.includes(prop) && typeof v === 'string' && v.length < 120) {
                decls.push(`${prop}: ${v};`);
            }
        }
        if (decls.length) cssLines.push(`${rule.sel} { ${decls.join(' ')} }`);
    }
    if (cssLines.length === 0) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssLines.join('\n');
    document.head.appendChild(style);
}

function _removeModVisuals(mod) {
    const id = 'mod-visuals-' + mod.name.replace(/[^a-z0-9]/gi, '_');
    const el = document.getElementById(id);
    if (el) el.remove();
}

function loadModFile(file) {
    if (!file.name.endsWith('.json')) { showModError('Only .json mod files are supported.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const rawMod = JSON.parse(e.target.result);
            if (!rawMod.name) { showModError('Invalid mod: missing "name" field.'); return; }
            if (_loadedMods.find(m => m.name === rawMod.name)) {
                showModError(`Mod "${rawMod.name}" is already loaded.`); return;
            }
            const mod = _sanitizeMod(rawMod);
            if (Array.isArray(mod.cards)) {
                for (const c of mod.cards) {
                    if (c.id == null) continue;
                    if (_getBuiltinIds().has(c.id)) {
                        showModError(`ID conflict: card ID ${c.id} ("${c.n || '?'}") collides with a built-in card.`);
                        return;
                    }
                    for (const loaded of _loadedMods) {
                        if (Array.isArray(loaded.cards) && loaded.cards.some(lc => lc.id === c.id)) {
                            showModError(`ID conflict: card ID ${c.id} ("${c.n || '?'}") already used by mod "${loaded.name}".`);
                            return;
                        }
                    }
                }
            }
            _loadedMods.push(mod);
            applyMod(mod);
            renderModList();
            try { const mk = 'dr_saved_mods'; localStorage.setItem(mk, JSON.stringify(_loadedMods)); } catch(e) {}
        } catch(err) {
            showModError('Failed to parse mod file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function applyMod(mod) {
    if (Array.isArray(mod.cards)) {
        mod.cards.forEach(c => {
            if (c.id != null && c.n && c.i && c.d) {
                const validClass = c.class && MOD_CARD_CLASSES[c.class] ? c.class : 'utility';
                const multiplier = (typeof c.multiplier === 'number' && c.multiplier > 0 && c.multiplier <= 5)
                    ? c.multiplier : 1.0;
                const card = { ...c, class: validClass, multiplier, _fromMod: mod.name };
                if (typeof ALL_CARDS !== 'undefined') ALL_CARDS['mod_' + c.id] = card;
                const existing = CARDS.find(x => x.id === c.id);
                if (!existing) CARDS.push(card);
            }
        });
    }
    if (Array.isArray(mod.decks)) {
        mod.decks.forEach(d => {
            if (d.id && d.name && Array.isArray(d.cards)) {
                const existing = DECKS.findIndex(x => x.id === d.id);
                const deck = { ...d, isCustom: true, _fromMod: mod.name };
                if (existing >= 0) DECKS[existing] = deck;
                else DECKS.push(deck);
            }
        });
        buildDeckUI();
    }
    _applyModTheme(mod);
    _applyModVisuals(mod);
}

function unloadMod(name) {
    playSfx('menuClick');
    const idx = _loadedMods.findIndex(m => m.name === name);
    if (idx < 0) return;
    const mod = _loadedMods[idx];
    if (Array.isArray(mod.cards)) {
        mod.cards.forEach(c => {
            delete ALL_CARDS['mod_' + c.id];
            const ci = CARDS.findIndex(x => x.id === c.id && x._fromMod === name);
            if (ci >= 0) CARDS.splice(ci, 1);
        });
    }
    if (Array.isArray(mod.decks)) {
        mod.decks.forEach(d => {
            const di = DECKS.findIndex(x => x.id === d.id && x._fromMod === name);
            if (di >= 0) DECKS.splice(di, 1);
        });
        buildDeckUI();
    }
    _removeModTheme(mod);
    _removeModVisuals(mod);
    _loadedMods.splice(idx, 1);
    renderModList();
}

function renderModList() {
    const list = document.getElementById('mod-list');
    if (!list) return;
    list.innerHTML = '';
    if (_loadedMods.length === 0) {
        list.innerHTML = '<div style="font-family:\'IM Fell English\',serif; font-size:11px; color:#4a3010; font-style:italic; text-align:center; padding:8px 0;">No mods loaded</div>';
        return;
    }
    _loadedMods.forEach(mod => {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:rgba(20,10,2,0.85); border:1px solid rgba(100,65,20,0.5); border-radius:5px; padding:8px 12px;';
        const cardCount = Array.isArray(mod.cards) ? mod.cards.length : 0;
        const deckCount = Array.isArray(mod.decks) ? mod.decks.length : 0;
        const extras = [
            cardCount > 0 ? cardCount + ' card(s)' : null,
            deckCount > 0 ? deckCount + ' deck(s)' : null,
            mod.theme ? 'custom theme' : null,
            mod.visuals ? 'visuals' : null,
        ].filter(Boolean).join(' · ');
        el.innerHTML = `
            <div>
                <div style="font-family:'Cinzel',serif; font-size:11px; color:#c8a460; letter-spacing:1px;">${mod.name}</div>
                <div style="font-family:'IM Fell English',serif; font-size:10px; color:#5a3a10; font-style:italic; margin-top:2px;">
                    ${mod.version ? 'v' + mod.version + ' · ' : ''}${extras}
                </div>
            </div>
            <button onclick="unloadMod('${mod.name.replace(/'/g,"\'")}');" style="font-family:'Cinzel',serif; font-size:9px; letter-spacing:2px; background:rgba(40,10,5,0.9); border:1px solid rgba(120,40,30,0.5); color:rgba(200,70,50,0.8); padding:4px 10px; cursor:pointer; border-radius:3px; text-transform:uppercase;">Unload</button>`;
        list.appendChild(el);
    });
}

function showModError(msg) {
    const list = document.getElementById('mod-list');
    if (!list) return;
    const el = document.createElement('div');
    el.style.cssText = "font-family:'IM Fell English',serif; font-size:11px; color:#c62828; font-style:italic; text-align:center; padding:6px 0;";
    el.textContent = msg;
    list.prepend(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
}

function aiThinkMult() {
    if (_aiThink === 'fast') return 0.3;
    if (_aiThink === 'slow') return 2.0;
    return 1.0;
}

function toggleMute() {
    muted = !muted;
    document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
    // Music start/stop hooks removed along with the old procedural music
    // system — re-add here once the .ogg-based player is wired up.
}
document.getElementById('mute-btn').addEventListener('click', toggleMute);

/* Music system removed (was procedurally-generated Web Audio synths +
   a custom-folder file picker). Stubs kept so existing call sites
   (settings.js, ui.js, intro.js) don't throw — wire these up to real
   .ogg playback once the track files are in place. */
function startBgAudio()   {}
function stopBgAudio()    {}
function startMenuAudio() {}
function stopMenuAudio()  {}

const ALL_CARDS = {
    attack:  { id:0,  n:"Attack",   i:"⚔️",  rarity:"common",    d:"Your bread and butter. Roll well and you get to keep going — roll badly and you eat the hit yourself.",           m:"CRIT: Roll again for free | FAIL: You take the damage instead" },
    vampire: { id:5,  n:"Vampire",  i:"🦇",  rarity:"rare",      d:"Sink your teeth in. You deal damage and pocket half of it back as health — no risk on a fail.",       m:"CRIT: Drains a lot more | FAIL: Deals no damage, heals nothing" },
    heal:    { id:2,  n:"Heal",     i:"🧪",  rarity:"uncommon",  d:"Crack a vial and drink deep. Won't crit for much, but it never goes wrong either.",         m:"CRIT: Heals for a lot more | FAIL: Nothing happens, you're fine" },
    tariff:  { id:3,  n:"Tariff",   i:"📜",  rarity:"epic",      d:"Slap a trade restriction on them. Every hit they land gets taxed at 50% for the next few turns.",     m:"CRIT: Lasts 5 turns instead | FAIL: The tariff applies to you" },
    mirror:  { id:6,  n:"Mirror",   i:"🪞",  rarity:"rare",      d:"Hold up a mirror. The next attack that comes your way bounces straight back at whoever threw it.",  m:"CRIT: Reflects the full amount | FAIL: Mirror shatters, nothing happens" },
    plague:  { id:7,  n:"Plague",   i:"☠️",  rarity:"uncommon",  d:"A slow rot. They lose HP at the start of every turn — you don't have to do anything else.",             m:"CRIT: Each tick hits harder | FAIL: You poison yourself instead" },
    pet:     { id:4,  n:"Pet",      i:"🐉",  rarity:"legendary", d:"Your little guy stands in front of you and takes hits until he's gone. Crits make him a proper tank.",              m:"CRIT: Absorbs up to 50% of your max HP | FAIL: He turns on you" },
    bomb:    { id:8,  n:"Bomb",     i:"💣",  rarity:"rare",      d:"Huge damage if it goes off right. Huge problem if it doesn't. That's the deal.",         m:"CRIT: Goes off twice | FAIL: 8 damage to yourself" },
    shield:  { id:9,  n:"Shield",   i:"🛡️",  rarity:"uncommon",  d:"Put your guard up. Most of what they throw at you this turn just bounces off.",        m:"CRIT: Blocks everything completely | FAIL: Your guard breaks, you take extra" },
    storm:   { id:10, n:"Storm",    i:"⚡",  rarity:"epic",      d:"You don't stop at one. Hit them, then hit them again — crits get a third swing in.",            m:"CRIT: Three hits | FAIL: You get struck instead" },
    curse:   { id:11, n:"Curse",    i:"🔮",  rarity:"epic",      d:"Whatever they play next, it fails. Doesn't matter what it is. You just decided.",   m:"CRIT: Ruins their next two cards | FAIL: You curse yourself instead" },
    regen:   { id:12, n:"Regen",    i:"🌿",  rarity:"uncommon",  d:"Plant a little recovery seed. You'll heal at the start of each of your next few turns without doing anything.",        m:"CRIT: Heals more each tick | FAIL: Withers instead, you lose HP each turn" },
    snipe:   { id:13, n:"Snipe",    i:"🏹",  rarity:"rare",      d:"A clean shot straight through. No pet, no shield, no barrier is going to stop this one.",     m:"CRIT: Roll again for free | FAIL: Complete miss, nothing happens" },
    leech:   { id:14, n:"Leech",    i:"🩸",  rarity:"common",    d:"Not going to win you any fights on its own but it keeps you topped up while you poke away at them.",              m:"CRIT: Drains much more | FAIL: Doesn't connect, no harm done" },
    inferno: { id:15, n:"Inferno",  i:"🔥",  rarity:"legendary", d:"Lights them up right now and keeps them burning. Two kinds of hurt for the price of one card.",             m:"CRIT: Rolls again and the burn stacks | FAIL: You catch fire instead" },
    frost:   { id:16, n:"Frost",    i:"❄️",  rarity:"rare",      d:"Lock them in place. They're not going anywhere next turn, which gives you a free shot.",               m:"CRIT: They're stuck for two turns | FAIL: You freeze yourself" },
    gold:    { id:17, n:"Gold",     i:"💰",  rarity:"epic",      d:"Not happy with that roll? Spend this and try again. Just don't mess it up — the debt collector doesn't forget.",            m:"CRIT: Two free rerolls | FAIL: Lose 6 HP immediately" },
    bone:    { id:18, n:"Bone",     i:"🦴",  rarity:"common",    d:"Won't impress anyone but it never completely whiffs. Something always lands — crits are genuinely nasty.",         m:"CRIT: Bones everywhere, heavy damage | FAIL: Still does 1 damage somehow" },
    soul:    { id:19, n:"Soul",     i:"👻",  rarity:"legendary", d:"Tears a soul clean out and slams it into them. The upside is massive. The downside is 10 damage to yourself.",       m:"CRIT: Catastrophic — shatters their soul | FAIL: It possesses you for 10 damage" },

    
    lullaby:  { id:20, n:"Lullaby",   i:"🎵",  rarity:"uncommon",  d:"Hum something hypnotic and put them to sleep. Works great. Unless you accidentally put yourself under.",         m:"CRIT: They sleep through two turns | FAIL: You nod off instead" },
    aria:     { id:21, n:"Aria",      i:"🎶",  rarity:"rare",      d:"Hit the high note and it tears right through them. Crack it and you pay for the embarrassment.",                      m:"CRIT: Damage doubles | FAIL: Voice breaks, 4 damage to yourself" },
    serenade: { id:22, n:"Serenade",  i:"🌊",  rarity:"common",    d:"A quiet little tune that takes the edge off their attacks. They deal half damage for a bit. Safe if it fails.",                     m:"CRIT: Tariff lasts longer and hits harder | FAIL: They shrug it off, nothing happens" },
    banshee:  { id:23, n:"Banshee",   i:"👄",  rarity:"epic",      d:"A shriek that rattles bones. Big damage with a chance to chain — but scream wrong and something tears.",                                m:"CRIT: Shockwave chains the attack | FAIL: You rupture something, 8 damage" },
    chorus:   { id:24, n:"Chorus",    i:"🎤",  rarity:"uncommon",  d:"Belt out something loud enough to stop hits from landing. Crit and the sound keeps healing you after.",                     m:"CRIT: Shield plus 2 turns of healing | FAIL: Nothing, you're okay" },
    encore:   { id:25, n:"Encore",    i:"🌹",  rarity:"legendary", d:"You take everything from them and pour it back into yourself. Amazing when it works. Brutal when it doesn't.",                                 m:"CRIT: Both effects triple | FAIL: It backfires twice, 8 damage to you" },

    
    strum:     { id:26, n:"Strum",     i:"🎸",  rarity:"common",    d:"A solid strum. Nothing fancy but it gets the job done — crits let you keep the momentum going.",                                            m:"CRIT: Chains into another free roll | FAIL: A string snaps, 3 damage to yourself" },
    drumroll:  { id:27, n:"Drumroll",  i:"🥁",  rarity:"uncommon",  d:"Two hits. Crits squeeze in a third. Mess up the timing and you waste the whole thing.",                 m:"CRIT: Three hits | FAIL: You miss the beat, turn wasted" },
    shanty:    { id:28, n:"Shanty",    i:"⚓",  rarity:"rare",      d:"A sailor's tune that patches you up over time. Crits make it heal more. Fails make it a funeral song.",                  m:"CRIT: Heals 5 HP each turn | FAIL: Works in reverse, you lose HP each turn" },
    lute:      { id:29, n:"Lute",      i:"🪕",  rarity:"uncommon",  d:"A slow pulling melody that takes from them and gives to you. Like Vampire but set to music.",                         m:"CRIT: Drains a lot more | FAIL: Doesn't connect, no harm done" },
    ballad:    { id:30, n:"Ballad",    i:"📯",  rarity:"epic",      d:"A song with a hex woven through it. Ruins their next play and crits cut their damage too. Backfires badly.",                           m:"CRIT: Curse plus damage debuff | FAIL: The hex lands on you instead" },
    crescendo: { id:31, n:"Crescendo", i:"🎺",  rarity:"legendary", d:"Starts small. If you keep critting, each hit lands harder than the last. The finale either ends them or ends you.",                             m:"CRIT: Each chained hit escalates | FAIL: Fizzles out, 6 damage to yourself" },

    
    bulwark:   { id:32, n:"Bulwark",   i:"🏰",  rarity:"uncommon",  d:"Throw up walls and shorten any curse you're sitting under. Crits patch you up while you're at it.",           m:"CRIT: Also heals 4 HP | FAIL: Walls don't go up, nothing happens" },
    cleave:    { id:33, n:"Cleave",    i:"🪓",  rarity:"rare",      d:"A wide, brutal swing. Put real weight behind it. Overdo it on a fail and the axe comes back around.",                          m:"CRIT: Swing chains into another roll | FAIL: You overswing, 5 damage to yourself" },
    rally:     { id:34, n:"Rally",     i:"🚩",  rarity:"epic",      d:"A battle cry that clears whatever's eating at you and gets you back on your feet. Can't fail badly.",          m:"CRIT: Heals 5 HP per turn | FAIL: Cry falls flat, nothing happens" },
    destrier:  { id:35, n:"Destrier",  i:"🐴",  rarity:"legendary", d:"Full gallop, no stopping. Blows through shields, blows through pets, blows through whatever's in the way.",    m:"CRIT: Chains and keeps charging | FAIL: Horse trips, you take 10 damage" },

    
    volley:    { id:36, n:"Volley",    i:"🪃",  rarity:"common",    d:"Two arrows in quick succession. Crits get you a third shot. Nick yourself on a fail but it's minor.",                         m:"CRIT: Third arrow flies | FAIL: You nick yourself, 2 damage" },
    huntmark:  { id:37, n:"Huntmark",  i:"🦅",  rarity:"uncommon",  d:"Tag them. Their next hit lands softer — you've already found the weak spots. Crits keep the mark on longer.",                  m:"CRIT: Mark lasts 3 turns | FAIL: Doesn't stick, no harm done" },
    bramble:   { id:38, n:"Bramble",   i:"🌿",  rarity:"rare",      d:"Thorns wrap around them. They can't move next turn and the poison keeps ticking after that.",     m:"CRIT: Frozen longer, poison hits harder | FAIL: You get tangled, freeze yourself for a turn" },
    hawkstrike:{ id:39, n:"Hawkstrike",i:"🦆",  rarity:"epic",      d:"Come in fast from above. No shield stops it. Crits leave a poison behind as a parting gift.",           m:"CRIT: Pierces and poisons | FAIL: You miss completely, clip yourself for 3" },

    
    miasma:    { id:40, n:"Miasma",    i:"🫧",  rarity:"uncommon",  d:"Fill the air with something unpleasant. They breathe it in and start losing HP every turn. You're untouched.",               m:"CRIT: Poison ticks for more | FAIL: Cloud disperses harmlessly" },
    necrosis:  { id:41, n:"Necrosis",  i:"🦠",  rarity:"rare",      d:"Hit them and leave something behind. The wound starts burning on its own. Crits make it rot too.",         m:"CRIT: Adds poison on top of the burn | FAIL: You infect yourself, 4 damage" },
    contagion: { id:42, n:"Contagion", i:"💀",  rarity:"epic",      d:"Why pick one when you can have both? Poison and burn at the same time — they're losing HP from two directions.",             m:"CRIT: Both effects last longer | FAIL: Outbreak hits you instead" },
    pandemic:  { id:43, n:"Pandemic",  i:"⚗️",  rarity:"legendary", d:"The worst thing in the deck. Five damage, five turns, no cure. Fail it and you've just done that to yourself.",          m:"CRIT: Hits for 10 immediately then keeps going | FAIL: You catch the pandemic" },

    
    decree:    { id:44, n:"Decree",    i:"📋",  rarity:"uncommon",  d:"Issue an order. Their damage gets cut by half and there's nothing they can do about it for a few turns.",            m:"CRIT: Decree lasts 5 turns | FAIL: Decree is ignored, nothing happens" },
    tithe:     { id:45, n:"Tithe",     i:"💎",  rarity:"rare",      d:"While the tariff's running, milk it. Drain their HP and pocket the difference as health. Safe if it fails.",m:"CRIT: Huge drain plus regen on top | FAIL: They refuse to pay, nothing happens" },
    inquisitor:{ id:46, n:"Inquisitor",i:"⚖️",  rarity:"epic",      d:"Pass sentence. They're cursed and debuffed at the same time. Crits layer even more punishment on top.",              m:"CRIT: Curse and tariff both land | FAIL: The sentence applies to you" },
};

const DECKS = [
    {
        id: 'standard',
        name: 'Standard',
        icon: '⚔️',
        desc: 'The classic balanced deck. A bit of everything.',
        cards: ['attack','heal','vampire','tariff','mirror','plague','pet'],
        weights: [0.20, 0.43, 0.58, 0.71, 0.82, 0.92, 1.0],
    },
    {
        id: 'berserker',
        name: 'Berserker',
        icon: '💀',
        desc: 'Pure aggression. High risk, devastating payoff.',
        cards: ['attack','bomb','storm','snipe','inferno','soul','plague'],
        weights: [0.18, 0.40, 0.57, 0.68, 0.80, 0.92, 1.0],
    },
    {
        id: 'necromancer',
        name: 'Necromancer',
        icon: '🔮',
        desc: 'Dark magic, curses, and life-draining sorcery.',
        cards: ['vampire','curse','plague','leech','soul','mirror','heal'],
        weights: [0.25, 0.42, 0.57, 0.64, 0.75, 0.88, 1.0],
    },
    {
        id: 'guardian',
        name: 'Guardian',
        icon: '🛡️',
        desc: 'Outlast the opponent through defence and slow recovery.',
        cards: ['shield','heal','regen','mirror','pet','attack','frost'],
        weights: [0.28, 0.52, 0.66, 0.76, 0.84, 0.91, 1.0],
    },
    {
        id: 'trickster',
        name: 'Trickster',
        icon: '🃏',
        desc: 'Chaotic and unpredictable. Anything could happen.',
        cards: ['gold','curse','bomb','frost','tariff','bone','soul'],
        weights: [0.22, 0.40, 0.55, 0.68, 0.79, 0.86, 1.0],
    },
    {
        id: 'elemental',
        name: 'Elemental',
        icon: '⚡',
        desc: 'Harness storm, frost, and inferno in equal measure.',
        cards: ['storm','frost','inferno','attack','heal','snipe','regen'],
        weights: [0.24, 0.42, 0.56, 0.65, 0.77, 0.89, 1.0],
    },
    {
        id: 'siren',
        name: 'Siren',
        icon: '🎵',
        desc: 'Enchanting songs that freeze, drain, and shatter. Control the battlefield with voice alone.',
        cards: ['lullaby','aria','serenade','banshee','chorus','encore','lute'],
        weights: [0.18, 0.34, 0.50, 0.64, 0.76, 0.88, 1.0],
    },
    {
        id: 'bard',
        name: 'Bard',
        icon: '🎸',
        desc: 'Instruments as weapons. From healing shanties to skull-rattling crescendos.',
        cards: ['strum','drumroll','shanty','lute','ballad','crescendo','shanty'],
        weights: [0.20, 0.38, 0.52, 0.65, 0.78, 0.90, 1.0],
    },
    {
        id: 'iron_vanguard',
        name: 'Iron Vanguard',
        icon: '🏰',
        desc: 'Unyielding steel and unbreakable discipline. Shield the line, then crush the enemy.',
        cards: ['bulwark','cleave','shield','rally','attack','cleave','destrier'],
        weights: [0.18, 0.34, 0.48, 0.62, 0.74, 0.87, 1.0],
    },
    {
        id: 'forest_warden',
        name: 'Forest Warden',
        icon: '🏹',
        desc: 'Strike from the shadows, never seen. Arrows, traps, and nature\'s wrath.',
        cards: ['volley','huntmark','snipe','bramble','hawkstrike','volley','regen'],
        weights: [0.20, 0.38, 0.52, 0.64, 0.76, 0.88, 1.0],
    },
    {
        id: 'plague_herald',
        name: 'Plague Herald',
        icon: '⚗️',
        desc: 'The slow death. Poison, rot, and contagion consume everything.',
        cards: ['miasma','plague','necrosis','contagion','miasma','heal','pandemic'],
        weights: [0.22, 0.40, 0.56, 0.68, 0.78, 0.88, 1.0],
    },
    {
        id: 'gilded_throne',
        name: 'Gilded Throne',
        icon: '👑',
        desc: 'Rule by edict and tribute. Weaken your foe with decrees, then drain them dry.',
        cards: ['decree','tariff','tithe','inquisitor','decree','heal','tithe'],
        weights: [0.20, 0.38, 0.53, 0.66, 0.78, 0.89, 1.0],
    },
];

let selectedDeckId = 'standard';

let customDeckSelection = [];
let customDeckLogo = '⚔️';

const LOGO_EMOJIS = ['⚔️','🦇','🧪','📜','🪞','☠️','🐉','💣','🛡️','⚡','🔮','🌿','🏹','🩸','🔥','❄️','💰','🦴','👻','💀','🃏','👑','🌑','🎭','🎲','🔱','⚗️','🗡️','🌙','✦'];

let _editingDeckId = null; 

function openCustomDeckBuilder(existingDeck) {
    customDeckSelection = [];
    customDeckLogo = '⚔️';
    _editingDeckId = null;
    document.getElementById('cdb-name').value = '';
    document.getElementById('cdb-desc').value = '';
    document.getElementById('cdb-error').textContent = '';
    document.getElementById('cdb-export-str').value = '';
    document.getElementById('cdb-import-str').value = '';

    if (existingDeck) {
        _editingDeckId = existingDeck.id;
        document.getElementById('cdb-name').value = existingDeck.name;
        document.getElementById('cdb-desc').value = existingDeck.desc;
        customDeckLogo = existingDeck.icon || '⚔️';
        customDeckSelection = [...existingDeck.cards];
        document.getElementById('cdb-export-str').value = encodeDeck(existingDeck);
    }

    const h2 = document.querySelector('#menu-custom-deck h2');
    if (h2) h2.innerHTML = existingDeck ? '&#9998; Edit Deck' : '&#9997; Build Your Deck';

    buildLogoPickerGrid();
    buildCardPickerGrid();
    refreshDeckPreview();
    toggle('menu-decks', false);
    toggle('menu-custom-deck', true);
}

function buildLogoPickerGrid() {
    const grid = document.getElementById('logo-picker-grid');
    grid.innerHTML = '';
    LOGO_EMOJIS.forEach(emoji => {
        const el = document.createElement('div');
        el.className = 'logo-option' + (emoji === customDeckLogo ? ' selected' : '');
        el.textContent = emoji;
        el.title = emoji;
        el.addEventListener('mouseenter', () => playSfx('cardHover'));
        el.onclick = () => {
            playSfx('menuClick');
            customDeckLogo = emoji;
            document.querySelectorAll('.logo-option').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected');
        };
        grid.appendChild(el);
    });
}

function buildCardPickerGrid() {
    const grid = document.getElementById('card-picker-grid');
    grid.innerHTML = '';
    const filterRarity = document.getElementById('cdb-filter-rarity')?.value || '';
    Object.keys(ALL_CARDS).forEach(key => {
        const card = ALL_CARDS[key];
        if (filterRarity && card.rarity !== filterRarity) return;
        const el = document.createElement('div');
        el.className = 'picker-card' + (customDeckSelection.includes(key) ? ' selected' : '');
        el.dataset.key = key;
        el.innerHTML = `
            <div class="picker-card-icon">${card.i}</div>
            <div class="picker-card-name">${card.n}</div>
            <div class="picker-card-rarity ${card.rarity}">${card.rarity}</div>`;
        el.title = card.d;
        el.addEventListener('mouseenter', () => playSfx('cardHover'));
        el.onclick = () => togglePickerCard(key);
        grid.appendChild(el);
    });
}

function togglePickerCard(key) {
    playSfx('menuClick');
    const idx = customDeckSelection.indexOf(key);
    if (idx >= 0) {
        customDeckSelection.splice(idx, 1);
    } else {
        if (customDeckSelection.length >= 9) {
            showCdbError('Max 9 cards allowed in a deck.');
            return;
        }
        customDeckSelection.push(key);
    }
    document.getElementById('cdb-error').textContent = '';
    const el = document.querySelector(`.picker-card[data-key="${key}"]`);
    if (el) el.classList.toggle('selected', customDeckSelection.includes(key));
    refreshDeckPreview();
}

function refreshDeckPreview() {
    const slots = document.getElementById('deck-preview-slots');
    const count = document.getElementById('deck-slot-count');
    slots.innerHTML = '';
    for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div');
        if (i < customDeckSelection.length) {
            const key = customDeckSelection[i];
            const card = ALL_CARDS[key];
            slot.className = 'deck-preview-slot';
            slot.innerHTML = `
                <span class="deck-preview-slot-icon">${card.i}</span>
                <span class="deck-preview-slot-name">${card.n}</span>
                <span class="deck-preview-slot-remove" title="Remove" onclick="togglePickerCard('${key}')">&#10005;</span>`;
        } else {
            slot.className = 'deck-preview-slot empty';
            slot.innerHTML = `<span class="deck-preview-slot-icon" style="opacity:0.25">&#8212;</span><span class="deck-preview-slot-name" style="opacity:0.25">empty</span>`;
        }
        slots.appendChild(slot);
    }
    const n = customDeckSelection.length;
    count.textContent = n + ' / 9 card' + (n === 1 ? '' : 's');
    count.className = 'deck-slot-count ' + (n === 9 ? 'full' : n >= 3 ? 'ok' : 'low');
}

function showCdbError(msg) {
    const el = document.getElementById('cdb-error');
    el.textContent = msg;
}

function showShareMsg(msg, isError) {
    const el = document.getElementById('cdb-share-msg');
    el.textContent = msg;
    el.style.color = isError ? '#c62828' : '#6b9a40';
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function encodeDeck(deck) {
    try {
        const payload = { v: 1, n: deck.name, d: deck.desc, i: deck.icon, c: deck.cards };
        return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch(e) { return ''; }
}

function decodeDeck(str) {
    try {
        const json = decodeURIComponent(escape(atob(str.trim())));
        const p = JSON.parse(json);
        if (!p || !p.n || !p.d || !p.i || !Array.isArray(p.c)) return null;
        if (!p.c.every(k => ALL_CARDS[k])) return null;
        if (p.c.length < 1 || p.c.length > 9) return null;
        return p;
    } catch(e) { return null; }
}

function copyDeckCode() {
    const str = document.getElementById('cdb-export-str').value;
    if (!str) { showShareMsg('Save your deck first to generate a code.', true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(() => {
            showShareMsg('Code copied to clipboard!', false);
        }).catch(() => { fallbackCopy(str); });
    } else { fallbackCopy(str); }
}

function fallbackCopy(str) {
    const input = document.getElementById('cdb-export-str');
    input.removeAttribute('readonly');
    input.select();
    try { document.execCommand('copy'); showShareMsg('Code copied!', false); } catch(e) { showShareMsg('Select the code and copy manually.', true); }
    input.setAttribute('readonly', '');
}

function importDeckCode() {
    const str = document.getElementById('cdb-import-str').value.trim();
    if (!str) { showShareMsg('Paste a deck code first.', true); return; }
    const p = decodeDeck(str);
    if (!p) { showShareMsg('Invalid or corrupted deck code.', true); return; }
    document.getElementById('cdb-name').value = p.n;
    document.getElementById('cdb-desc').value = p.d;
    customDeckLogo = LOGO_EMOJIS.includes(p.i) ? p.i : '⚔️';
    customDeckSelection = [...p.c];
    buildLogoPickerGrid();
    buildCardPickerGrid();
    refreshDeckPreview();
    document.getElementById('cdb-error').textContent = '';
    document.getElementById('cdb-export-str').value = str;
    showShareMsg('Deck imported! Hit Save to keep it.', false);
}

function saveCustomDeck() {
    const name = document.getElementById('cdb-name').value.trim();
    const desc = document.getElementById('cdb-desc').value.trim();
    if (!name) { showCdbError('Your deck needs a name.'); return; }
    if (!desc)  { showCdbError('Add a description for your deck.'); return; }
    if (customDeckSelection.length < 1) { showCdbError('Pick at least 1 card.'); return; }
    if (customDeckSelection.length > 9) { showCdbError('Max 9 cards allowed.'); return; }

    const n = customDeckSelection.length;
    const weights = customDeckSelection.map((_, i) => parseFloat(((i + 1) / n).toFixed(4)));
    weights[weights.length - 1] = 1.0;

    const targetId = _editingDeckId || 'custom';
    const existingIdx = DECKS.findIndex(d => d.id === targetId);
    if (existingIdx >= 0) DECKS.splice(existingIdx, 1);

    const newDeck = {
        id: targetId,
        name: name,
        icon: customDeckLogo,
        desc: desc,
        cards: [...customDeckSelection],
        weights: weights,
        isCustom: true,
    };
    DECKS.push(newDeck);
    selectedDeckId = targetId;
    _editingDeckId = null;

    document.getElementById('cdb-export-str').value = encodeDeck(newDeck);

    toggle('menu-custom-deck', false);
    toggle('menu-decks', true);
    buildDeckUI();
    saveDeckData();
}

function deleteCustomDeck(deckId) {
    deckId = deckId || 'custom';
    playSfx('menuClick');
    const idx = DECKS.findIndex(d => d.id === deckId);
    if (idx >= 0) DECKS.splice(idx, 1);
    if (selectedDeckId === deckId) selectedDeckId = 'standard';
    buildDeckUI();
    saveDeckData();
}

function openLoadDeckPanel() {
    const panel = document.getElementById('load-deck-panel');
    const input = document.getElementById('load-deck-input');
    const msg   = document.getElementById('load-deck-msg');
    if (!panel) return;
    panel.style.display = 'block';
    input.value = '';
    msg.style.opacity = '0';
    msg.textContent = '';
    setTimeout(() => input.focus(), 80);
    input.onkeydown = (e) => { if (e.key === 'Enter') confirmLoadDeck(); };
}

function closeLoadDeckPanel() {
    const panel = document.getElementById('load-deck-panel');
    if (panel) panel.style.display = 'none';
}

function showLoadMsg(txt, isError) {
    const msg = document.getElementById('load-deck-msg');
    if (!msg) return;
    msg.textContent = txt;
    msg.style.color = isError ? '#c62828' : '#6b9a40';
    msg.style.opacity = '1';
    if (!isError) setTimeout(() => { msg.style.opacity = '0'; }, 2200);
}

function confirmLoadDeck() {
    playSfx('menuClick');
    const str = document.getElementById('load-deck-input').value.trim();
    if (!str) { showLoadMsg('Paste a deck code first.', true); return; }

    const p = decodeDeck(str);
    if (!p) { showLoadMsg('Invalid or corrupted deck code.', true); return; }

    const existingIdx = DECKS.findIndex(d => d.id === 'custom');
    if (existingIdx >= 0) DECKS.splice(existingIdx, 1);

    const n = p.c.length;
    const weights = p.c.map((_, i) => parseFloat(((i + 1) / n).toFixed(4)));
    weights[weights.length - 1] = 1.0;

    const loadedDeck = {
        id: 'custom',
        name: p.n,
        icon: LOGO_EMOJIS.includes(p.i) ? p.i : '⚔️',
        desc: p.d,
        cards: p.c,
        weights: weights,
        isCustom: true,
    };
    DECKS.push(loadedDeck);
    selectedDeckId = 'custom';
    buildDeckUI();
    saveDeckData();
    showLoadMsg('Deck loaded: ' + p.n, false);
    setTimeout(closeLoadDeckPanel, 1800);
}

function buildDeckUI() {
    const grid = document.getElementById('deck-grid');
    grid.innerHTML = '';
    DECKS.forEach(deck => {
        const el = document.createElement('div');
        el.className = 'deck-card' + (deck.id === selectedDeckId ? ' selected' : '');

        let customExtras = '';
        if (deck.isCustom) {
            const code = encodeDeck(deck);
            customExtras = `
                <div style="font-family:Cinzel,serif;font-size:8px;letter-spacing:2px;color:#6b9a40;margin-top:2px;">&#9997; CUSTOM</div>
                <div class="deck-share-popup" id="share-popup-${deck.id}">
                    <div class="deck-share-popup-row">
                        <input class="deck-share-popup-input" id="share-code-${deck.id}" readonly value="${code}">
                        <button class="deck-share-popup-btn" onclick="event.stopPropagation(); copyCardCode('${deck.id}')">Copy</button>
                    </div>
                    <div class="deck-share-popup-msg" id="share-popup-msg-${deck.id}"></div>
                </div>
                <div class="deck-custom-actions">
                    <button class="deck-action-btn share" title="Share deck" onclick="event.stopPropagation(); toggleSharePopup('${deck.id}')">&#128279;</button>
                    <button class="deck-action-btn edit"  title="Edit deck"  onclick="event.stopPropagation(); editCustomDeck('${deck.id}')">&#9998;</button>
                    <button class="deck-action-btn"       title="Duplicate deck" onclick="event.stopPropagation(); duplicateCustomDeck('${deck.id}')" style="color:rgba(100,180,100,0.7);">&#10064;</button>
                    <button class="deck-action-btn del"   title="Delete deck" onclick="event.stopPropagation(); deleteCustomDeck('${deck.id}')">&#128465;</button>
                </div>`;
        }

        el.innerHTML = `
            <div class="deck-card-icon">${deck.icon}</div>
            <div class="deck-card-name">${deck.name}</div>
            <div class="deck-card-desc">${deck.desc}</div>
            <div class="deck-card-cards">${deck.cards.map(k => ALL_CARDS[k].i).join(' ')}</div>
            <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;color:#5a4a2a;margin-top:3px;">${getDeckWL(deck.id)}</div>
            ${customExtras}`;
        el.onclick = () => {
            playSfx('menuClick');
            document.querySelectorAll('.deck-share-popup').forEach(p => p.classList.remove('open'));
            selectedDeckId = deck.id;
            buildDeckUI();
            saveDeckData();
        };
        grid.appendChild(el);
    });
}

function toggleSharePopup(deckId) {
    playSfx('menuClick');
    const popup = document.getElementById('share-popup-' + deckId);
    if (!popup) return;
    const isOpen = popup.classList.contains('open');
    document.querySelectorAll('.deck-share-popup').forEach(p => p.classList.remove('open'));
    if (!isOpen) popup.classList.add('open');
}

function copyCardCode(deckId) {
    const input = document.getElementById('share-code-' + deckId);
    const msgEl = document.getElementById('share-popup-msg-' + deckId);
    if (!input || !input.value) return;
    const str = input.value;
    const showMsg = (txt, err) => {
        msgEl.textContent = txt;
        msgEl.style.color = err ? '#c62828' : '#6b9a40';
        msgEl.style.opacity = '1';
        setTimeout(() => { msgEl.style.opacity = '0'; }, 2000);
    };
    window._copyToClipboard
        ? window._copyToClipboard(str, () => showMsg('Copied!', false), () => showMsg('Select & copy manually', true))
        : (input.select(), document.execCommand('copy'), showMsg('Copied!', false));
}

function editCustomDeck(deckId) {
    playSfx('menuClick');
    const deck = DECKS.find(d => d.id === deckId);
    if (!deck) return;
    openCustomDeckBuilder(deck);
}

function getActiveDeck() {
    return DECKS.find(d => d.id === selectedDeckId) || DECKS[0];
}
const CARDS = [
    { id:0, n:"Attack",   i:"⚔️",  rarity:"common",    d:"Deals damage. Crits chain into a free second roll.", m:"CRIT: +Chain | FAIL: Self-Strike" },
    { id:5, n:"Vampire",  i:"🦇",  rarity:"rare",      d:"Drains HP from the opponent and gives half to you.", m:"CRIT: Mega-Drain | FAIL: Safe — 0 effect" },
    { id:2, n:"Heal",     i:"🧪",  rarity:"uncommon",  d:"Restores your HP. Never backfires.", m:"CRIT: Mega-Heal | FAIL: Safe Dose" },
    { id:3, n:"Tariff",   i:"📜",  rarity:"epic",      d:"Halves all damage the opponent deals for 3 turns.", m:"CRIT: 5R Length | FAIL: Self-Debuff" },
    { id:6, n:"Mirror",   i:"🪞",  rarity:"rare",      d:"Reflects the next physical hit back at the attacker.", m:"CRIT: Full reflect | FAIL: Safe — breaks early" },
    { id:7, n:"Plague",   i:"☠️",  rarity:"uncommon",  d:"Poisons the opponent for 3 dmg/turn over 3 turns.", m:"CRIT: +2 dmg/turn | FAIL: Self-inflict" },
    { id:4, n:"Pet",      i:"🐉",  rarity:"legendary", d:"Summons a buffer that absorbs hits before your HP drops.", m:"CRIT: 50% HP Tank | FAIL: Ghost Betrayal" },
    { id:20, n:"Lullaby",   i:"🎵",  rarity:"uncommon",  d:"Skips the opponent's next turn. Fails and you skip yours.", m:"CRIT: Sleep 2 turns | FAIL: Self-daze" },
    { id:21, n:"Aria",      i:"🎶",  rarity:"rare",      d:"Deals double damage on a crit. Costs 4 HP on a fail.", m:"CRIT: x2 dmg | FAIL: Voice crack (self 4 dmg)" },
    { id:22, n:"Serenade",  i:"🌊",  rarity:"common",    d:"Applies tariff — halves opponent damage for 2 turns.", m:"CRIT: Disarming charm | FAIL: Safe" },
    { id:23, n:"Banshee",   i:"👄",  rarity:"epic",      d:"Heavy damage with chain potential. 8 self-damage on fail.", m:"CRIT: Deafening shockwave (chain) | FAIL: Rupture own throat (8 dmg)" },
    { id:24, n:"Chorus",    i:"🎤",  rarity:"uncommon",  d:"Shields you this turn. Crit also adds 2 turns of regen.", m:"CRIT: Sonic barrier (shield + regen) | FAIL: Safe" },
    { id:25, n:"Encore",    i:"🌹",  rarity:"legendary", d:"Big drain and self-heal. Crits amplify both. Risky fail.", m:"CRIT: Triple echo | FAIL: Encore fails twice (self 8 dmg)" },
    { id:26, n:"Strum",     i:"🎸",  rarity:"common",    d:"Standard attack. Crits chain into a free second roll.", m:"CRIT: Power chord (chain) | FAIL: Break string (self 3 dmg)" },
    { id:27, n:"Drumroll",  i:"🥁",  rarity:"uncommon",  d:"Hits twice. Crits hit three times. Fails waste the turn.", m:"CRIT: Triple strike | FAIL: Miss the beat" },
    { id:28, n:"Shanty",    i:"⚓",  rarity:"rare",      d:"Applies regen — heals 3 HP/turn for 3 turns. Safe card.", m:"CRIT: 5 HP/turn for 3 turns | FAIL: Grim shanty (lose HP)" },
    { id:29, n:"Lute",      i:"🪕",  rarity:"uncommon",  d:"Drains HP from the opponent. You recover most of it.", m:"CRIT: Mega-drain | FAIL: Safe" },
    { id:30, n:"Ballad",    i:"📯",  rarity:"epic",      d:"Curses the opponent. Crits also debuff damage. Risky fail.", m:"CRIT: Curse 2 turns + tariff | FAIL: Cursed by own verse" },
    { id:31, n:"Crescendo", i:"🎺",  rarity:"legendary", d:"Damage scales up with each crit in the chain. Gamble it.", m:"CRIT: Escalating blast | FAIL: Anticlimactic (self 6 dmg)" },
    { id:32, n:"Bulwark",   i:"🏰",  rarity:"uncommon",  d:"Raise fortress walls — shield self and reduce tariff duration by 1.", m:"CRIT: Also heal 4 HP | FAIL: Safe" },
    { id:33, n:"Cleave",    i:"🪓",  rarity:"rare",      d:"Heavy swing — deals high melee damage. Crits chain.", m:"CRIT: Cleave chain | FAIL: Overswing (self 5 dmg)" },
    { id:34, n:"Rally",     i:"🚩",  rarity:"epic",      d:"Banner cry — cures poison/burn on self and grants 3 turns of regen.", m:"CRIT: Regen 5 HP/turn | FAIL: Safe" },
    { id:35, n:"Destrier",  i:"🐴",  rarity:"legendary", d:"Mounted charge — massive damage ignoring shields. Risky fail.", m:"CRIT: Crushing chain | FAIL: Unhorsed (self 10 dmg)" },
    { id:36, n:"Volley",    i:"🪃",  rarity:"common",    d:"Loose a volley — hits twice. Crits hit a third time.", m:"CRIT: Third arrow | FAIL: Self-nick (self 2 dmg)" },
    { id:37, n:"Huntmark",  i:"🦅",  rarity:"uncommon",  d:"Mark the quarry — opponent's next card deals 2 less damage.", m:"CRIT: Marked for 3 turns | FAIL: Safe" },
    { id:38, n:"Bramble",   i:"🌿",  rarity:"rare",      d:"Entangle the foe — freeze 1 turn and poison 2 dmg/turn for 2 turns.", m:"CRIT: Freeze 2 + stronger poison | FAIL: Ensnared self" },
    { id:39, n:"Hawkstrike",i:"🦆",  rarity:"epic",      d:"Dive-bomb strike — bypasses shields. Crits also poison 3 dmg/turn.", m:"CRIT: Pierce + poison | FAIL: Miss (self 3 dmg)" },
    { id:40, n:"Miasma",    i:"🫧",  rarity:"uncommon",  d:"Toxic cloud — poisons enemy 4 dmg/turn for 3 turns. Safe card.", m:"CRIT: 6 dmg/turn poison | FAIL: Safe" },
    { id:41, n:"Necrosis",  i:"🦠",  rarity:"rare",      d:"Rotting wound — immediate damage and burn for 2 turns.", m:"CRIT: Also poisons for 2 turns | FAIL: Infect self (self 4 dmg)" },
    { id:42, n:"Contagion", i:"💀",  rarity:"epic",      d:"Spreading sickness — applies both poison AND burn simultaneously.", m:"CRIT: Extended duration | FAIL: Outbreak on self" },
    { id:43, n:"Pandemic",  i:"⚗️",  rarity:"legendary", d:"The Black Death — poisons 5 dmg/turn for 5 turns. Devastating fail.", m:"CRIT: Immediate 10 dmg + pandemic | FAIL: Self-inflict pandemic" },
    { id:44, n:"Decree",    i:"📋",  rarity:"uncommon",  d:"Royal decree — applies tariff on the enemy for 3 turns. Safe card.", m:"CRIT: Tariff 5 turns | FAIL: Safe" },
    { id:45, n:"Tithe",     i:"💎",  rarity:"rare",      d:"Collect tribute — drains enemy HP, scales with active tariff turns.", m:"CRIT: Mega-drain + regen | FAIL: Safe" },
    { id:46, n:"Inquisitor",i:"⚖️",  rarity:"epic",      d:"Judgment — curses the enemy and halves their damage for 2 turns.", m:"CRIT: Curse 2 turns + tariff 3 turns | FAIL: Condemned self" },
];

let state = {
    pHP: 75, aHP: 75, pHand: [],
    turn: true,
    pPet: 0, aPet: 0,
    pTariff: 0, aTariff: 0,
    pMirror: false, aMirror: false,
    pPoison: 0, aPoison: 0,
    pRegen: 0, aRegen: 0, pRegenAmt: 3, aRegenAmt: 3,
    pBurn: 0, aBurn: 0, pBurnDmg: 3, aBurnDmg: 3,
    pFreeze: 0, aFreeze: 0,
    pCurse: 0, aCurse: 0,
    pShield: false, aShield: false,
    pGoldRerolls: 0, aGoldRerolls: 0,
};

const opt = id => document.getElementById(id)?.checked ?? true;
function animSpeed() {
    const v = parseFloat(document.getElementById('opt-speed')?.value ?? '1');
    return isNaN(v) ? 1 : v;
}
function delay(ms) { return new Promise(r => setTimeout(r, _skipRequested ? 0 : ms / animSpeed())); }
function toggle(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    const isSubMenu = id !== 'menu-main';
    const changelog = document.getElementById('changelog-panel');
    if (show) {
        el.style.display = 'flex';
        if (isSubMenu) {
            // Must set visibility + pointerEvents too, not just opacity —
            // an opacity:0 element is still fully interactive and was
            // silently swallowing clicks meant for content underneath it
            // (e.g. the preferences sidebar's Sign Out / Delete Account /
            // Change Gender buttons, which sit in this same screen region).
            if (changelog) { changelog.style.opacity = '0'; changelog.style.visibility = 'hidden'; changelog.style.pointerEvents = 'none'; }
            el.classList.add('screen-animatable');
            el.offsetHeight;
            el.classList.remove('screen-closing');
            el.classList.add('screen-visible');
        }
    } else {
        if (isSubMenu && el.classList.contains('screen-animatable')) {
            el.classList.remove('screen-visible');
            el.classList.add('screen-closing');
            // Restore changelog immediately on close
            const anyOtherOpen = document.querySelector('.screen-visible');
            if (!anyOtherOpen && changelog) {
                const clEnabled = document.getElementById('opt-update-log')?.checked ?? true;
                changelog.style.visibility = '';
                changelog.style.pointerEvents = '';
                if (clEnabled) changelog.style.opacity = '1';
            }
            setTimeout(() => {
                if (el.classList.contains('screen-closing')) {
                    el.style.display = 'none';
                    el.classList.remove('screen-closing', 'screen-animatable');
                }
            }, 280);
        } else {
            el.style.display = 'none';
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════
   SFX ENGINE — procedural Web Audio synth, extracted out of game.js
   ---------------------------------------------------------------------
   Every sound effect in the game is synthesized on the fly (oscillators
   + filtered noise), not played from audio files — that's what osc()
   and noise() below are for. This file owns the whole pipeline: the
   shared AudioContext (AC/getAC), the mute flag, sfxVol, the per-theme
   tonal character (THEME_SFX), the two low-level building blocks
   (osc/noise) and two output busses (masterGain for ambient/UI sounds,
   punchDest for punchy combat hits with compression), the full SFX
   library, and the playSfx() dispatcher used by every onclick handler
   in index.html.

   Loaded as a plain classic script (not a module) — same as before —
   so AC / muted stay visible to music.js, ui.js, game-helpers.js, and
   visualizer.js exactly like when this all lived in game.js. Must load
   BEFORE those files (see index.html script order) since they read AC
   and muted directly rather than through a getter.

   musicVol / setMusicVol stay behind in game.js — this file is SFX
   only, music is a separate (file-based, not synthesized) system in
   music.js.
   ═══════════════════════════════════════════════════════════════════ */

let AC = null, muted = false, sfxVol = .7;

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

/* ── Per-theme SFX character — every sound effect in the game funnels
   through osc()/noise() below, so retuning pitch/waveform/filter here
   changes how the WHOLE game sounds per theme without needing to
   rewrite each individual playSfx() call. ── */
const THEME_SFX = {
    default:        { pitchMult: 1,    waveOverride: null,                          noiseMult: 1,   noiseQ: 0.8 },
    space:          { pitchMult: 0.85, waveOverride: null,                          noiseMult: 0.75,noiseQ: 0.6 },  // lower, airier, spacious
    aero:           { pitchMult: 1.18, waveOverride: null,                          noiseMult: 1.35,noiseQ: 1.1 },  // bright, glassy
    cyberpunk:      { pitchMult: 1.0,  waveOverride: { sine:'square', triangle:'sawtooth' }, noiseMult: 1.6, noiseQ: 3.2 }, // digital, glitchy
    scourge:        { pitchMult: 0.7,  waveOverride: { sine:'sawtooth', triangle:'sawtooth' }, noiseMult: 0.55, noiseQ: 0.5 }, // low, growling
    angelic:        { pitchMult: 1,    waveOverride: null,                          noiseMult: 1,   noiseQ: 0.8 },  // deliberately unchanged — plain/clean
    '8space':       { pitchMult: 1.0,  waveOverride: { sine:'square', triangle:'square', sawtooth:'square' }, noiseMult: 1, noiseQ: 4.5 }, // chiptune
    castingcasings: { pitchMult: 1.05, waveOverride: null,                          noiseMult: 1.25,noiseQ: 5.5 },  // resonant, metallic
};
function _themeSfx() {
    return THEME_SFX[(typeof _currentTheme === 'string' ? _currentTheme : 'default')] || THEME_SFX.default;
}

function osc(type, freq, start, end, dur, gainVal, dest) {
    const ac = getAC(), now = ac.currentTime;
    const preset = _themeSfx();
    const useType = (preset.waveOverride && preset.waveOverride[type]) || type;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = useType;
    o.frequency.setValueAtTime(freq * preset.pitchMult, now + start);
    if (end !== null) o.frequency.exponentialRampToValueAtTime(end * preset.pitchMult, now + start + dur);
    g.gain.setValueAtTime(0, now + start);
    g.gain.linearRampToValueAtTime(gainVal, now + start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    o.connect(g); g.connect(dest);
    o.start(now + start); o.stop(now + start + dur + 0.01);
    return o;
}

function noise(dur, gainVal, filterFreq, dest) {
    const ac = getAC(), now = ac.currentTime;
    const preset = _themeSfx();
    const bufLen = ac.sampleRate * dur;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq * preset.noiseMult;
    filt.Q.value = preset.noiseQ;
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

    /* ═══════════════════════════════════════════════════════════════
       20 NEW SFX — for menu/meta actions that never had sound before
       (shop, achievements, quests, clubs, login, tournaments, UI chrome).
       Same osc()/noise()/punchDest()/masterGain() building blocks, same
       per-theme tonal character via THEME_SFX, nothing new introduced.
       ═══════════════════════════════════════════════════════════════ */

    // Shop: satisfying "purchase confirmed" chime — bright ascending triad
    purchase() {
        const dest = punchDest(sfxVol * 0.8);
        [660, 880, 1320].forEach((f, i) =>
            osc('triangle', f, i * 0.05, f * 1.4, 0.22, 0.30, dest));
        osc('sine', 1760, 0.1, 2400, 0.18, 0.18, dest);
        noise(0.05, 0.25, 6000, dest);
    },

    // Shop/quests: coins clinking — quick layered metallic ticks
    goldGain() {
        const dest = masterGain(sfxVol * 0.4);
        [1800, 2200, 2000].forEach((f, i) =>
            osc('square', f, i * 0.04, f * 0.8, 0.08, 0.14, dest));
        noise(0.03, 0.15, 7000, dest);
    },

    // XP/leveling: soft upward sparkle tick, deliberately subtle (fires often)
    xpGain() {
        const dest = masterGain(sfxVol * 0.22);
        osc('sine', 1200, 0, 2000, 0.09, 0.16, dest);
        noise(0.03, 0.08, 8000, dest);
    },

    // Level up: rising 5-note arpeggio, bigger/brighter than xpGain
    levelUp() {
        const dest = punchDest(sfxVol * 0.9);
        [523, 659, 784, 1047, 1568].forEach((f, i) =>
            osc('triangle', f, i * 0.07, f * 1.5, 0.26, 0.30, dest));
        osc('sine', 2093, 0.35, 3000, 0.3, 0.25, dest);
        noise(0.1, 0.3, 6000, dest);
    },

    // Achievements: triumphant short fanfare, distinct from levelUp/victory
    achievementUnlock() {
        const dest = punchDest(sfxVol * 0.95);
        osc('square',   440, 0,    440, 0.12, 0.35, dest);
        osc('square',   660, 0.10, 660, 0.14, 0.35, dest);
        osc('triangle', 880, 0.20, 1760,0.30, 0.40, dest);
        osc('sine',     1320,0.20, 2640,0.28, 0.25, dest);
        noise(0.15, 0.35, 5000, dest);
    },

    // Quests: gentle two-note "done" chime
    questComplete() {
        const dest = masterGain(sfxVol * 0.5);
        osc('sine',     784, 0,    784, 0.14, 0.28, dest);
        osc('triangle', 1047,0.09, 1047,0.20, 0.24, dest);
        noise(0.04, 0.15, 6000, dest);
    },

    // Tournaments: bigger/epic version of victory — bracket championship
    tournamentWin() {
        const dest = punchDest(sfxVol * 1.0);
        const melody = [523, 659, 784, 1047, 1319, 1568, 2093];
        melody.forEach((f, i) =>
            osc('triangle', f, i * 0.09, f * 1.3, 0.35, 0.34, dest));
        [261.6, 392, 523, 784].forEach((f, i) =>
            osc('sine', f, 0.05 + i * 0.03, f * 1.1, 0.4, 0.4, dest));
        osc('sine', 55, 0, 22, 0.8, 0.65, dest);
        noise(0.2, 0.45, 6000, dest);
        noise(0.12, 0.35, 1200, dest);
    },

    // Clubs: warm welcoming two-tone chime for joining/creating a club
    clubJoin() {
        const dest = punchDest(sfxVol * 0.75);
        osc('triangle', 440, 0,    660, 0.18, 0.30, dest);
        osc('sine',     660, 0.08, 880, 0.20, 0.28, dest);
        noise(0.08, 0.25, 4500, dest);
    },

    // Clubs: firm confirming stamp for creating a new club (rarer action)
    clubCreate() {
        const dest = punchDest(sfxVol * 0.9);
        osc('square',   220, 0,    110, 0.20, 0.5, dest);
        osc('triangle', 440, 0.05, 660, 0.22, 0.35,dest);
        osc('sine',     880, 0.10, 1320,0.20, 0.25,dest);
        noise(0.1, 0.4, 3000, dest);
    },

    // Login/auth success: simple warm positive chime
    loginSuccess() {
        const dest = masterGain(sfxVol * 0.55);
        osc('sine',     523, 0,    784, 0.16, 0.28, dest);
        osc('triangle', 784, 0.07, 1047,0.16, 0.20, dest);
        noise(0.05, 0.15, 6000, dest);
    },

    // Login/auth failure or other soft error — short low buzzy beep,
    // deliberately unpleasant-but-brief, distinct from combat "fail"
    error() {
        const dest = punchDest(sfxVol * 0.7);
        osc('square', 180, 0, 140, 0.14, 0.4, dest);
        osc('square', 120, 0.05, 90, 0.14, 0.35, dest);
        noise(0.08, 0.3, 1500, dest);
    },

    // Generic toast/notification popping in
    toastPop() {
        const dest = masterGain(sfxVol * 0.3);
        osc('sine', 900, 0, 1400, 0.06, 0.18, dest);
        noise(0.02, 0.1, 6000, dest);
    },

    // Generic "you have a notification" ding — brighter/higher than toastPop
    notification() {
        const dest = masterGain(sfxVol * 0.35);
        osc('sine',     1568, 0,    1568, 0.12, 0.22, dest);
        osc('triangle', 2093, 0.06, 2093, 0.10, 0.14, dest);
    },

    // Settings: small mechanical toggle click (checkbox/switch)
    settingsToggle() {
        const dest = masterGain(sfxVol * 0.3);
        osc('square', 500, 0, 350, 0.05, 0.18, dest);
        noise(0.02, 0.15, 3500, dest);
    },

    // Settings/nav: soft swish for switching between tabs
    tabSwitch() {
        const dest = masterGain(sfxVol * 0.25);
        osc('triangle', 600, 0, 1000, 0.08, 0.14, dest);
        noise(0.05, 0.12, 4000, dest);
    },

    // Any modal/popup opening — quick rising whoosh
    modalOpen() {
        const dest = masterGain(sfxVol * 0.35);
        osc('sine', 300, 0, 900, 0.14, 0.20, dest);
        noise(0.06, 0.18, 3000, dest);
    },

    // Any modal/popup closing — quick falling whoosh, mirrors modalOpen
    modalClose() {
        const dest = masterGain(sfxVol * 0.3);
        osc('sine', 900, 0, 300, 0.10, 0.18, dest);
        noise(0.04, 0.14, 2500, dest);
    },

    // Copy-to-clipboard (invite links, room codes, etc.) — tiny confirm tick
    copyLink() {
        const dest = masterGain(sfxVol * 0.3);
        osc('square', 1400, 0, 1000, 0.05, 0.16, dest);
        osc('sine',   2100, 0.02, 1600, 0.05, 0.10, dest);
    },

    // Customize screen: equipping a cosmetic — short magic-ish clunk+shimmer
    equipItem() {
        const dest = punchDest(sfxVol * 0.7);
        osc('square',   200, 0,    100, 0.10, 0.3, dest);
        osc('sine',     1200,0.04, 2000, 0.14, 0.20,dest);
        osc('triangle', 1800,0.06, 2600, 0.12, 0.14,dest);
        noise(0.06, 0.2, 5000, dest);
    },

    // Deck builder: saving a custom deck — quick two-tap confirm, distinct
    // from equipItem/purchase since this is a mundane, frequent action
    deckSave() {
        const dest = masterGain(sfxVol * 0.35);
        osc('triangle', 700, 0,    500, 0.07, 0.20, dest);
        osc('sine',     1050,0.06, 800, 0.09, 0.16, dest);
        noise(0.03, 0.12, 5000, dest);
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

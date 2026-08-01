/* ═══════════════════════════════════════════════════════════════════
   MUSIC SYSTEM — per-theme tracks
   ---------------------------------------------------------------------
   Replaces the old procedural Web Audio synths entirely. Each theme
   has its own main-menu track and combat track (e.g. changing the
   theme from Default to Wiki while on the main menu swaps
   "default-main.opus" for "wiki-main.ogg" automatically). Falls back
   to the Default theme's track if a theme's track hasn't been
   delivered yet.

   Also exposes getMusicFrequencyData() — a live Uint8Array of the
   current track's frequency spectrum, used by the in-battle music
   visualizer (visualizer.js).
   ═══════════════════════════════════════════════════════════════════ */

// File extension per theme/context — some tracks aren't in yet
// (producer's on break); anything not listed here falls back to Default.
const MUSIC_MANIFEST = {
    default:        { main: 'default-main.opus',        combat: 'default-combat.opus' },
    space:          { main: 'space-main.ogg',            combat: 'space-combat.opus' },
    aero:           { main: 'aero-main.ogg',              combat: 'aero-combat.opus' },
    cyberpunk:      { main: 'cyberpunk-main.opus',        combat: 'cyberpunk-combat.mp3' },
    scourge:        { main: null,                          combat: 'scourge-combat.ogg' },
    wiki:           { main: null,                          combat: null },
    '8space':       { main: null,                          combat: null },
    castingcasings: { main: 'castingcasings-main.mp3',    combat: 'castingcasings-combat.mp3' },
};
const MUSIC_DIR = 'music/';

let _musicEl        = null;   // the single <audio> element used for both contexts
let _musicAnalyser   = null;
let _musicSourceNode = null;
let _musicFreqData    = null;
let _musicContext     = null; // 'menu' | 'battle' — which track should be playing
let _musicFadeTimer   = null;

function _musicTrackFor(theme, context) {
    const t = MUSIC_MANIFEST[theme] || MUSIC_MANIFEST.default;
    const file = t[context] || MUSIC_MANIFEST.default[context];
    return file ? (MUSIC_DIR + file) : null;
}

function _getMusicEl() {
    if (_musicEl) return _musicEl;
    _musicEl = new Audio();
    _musicEl.loop = true;
    _musicEl.volume = (typeof musicVol === 'number' ? musicVol : 0.4);
    // Hook the element into the shared AudioContext so the visualizer
    // can read live frequency data straight off whatever's playing.
    try {
        const ac = getAC();
        _musicSourceNode = ac.createMediaElementSource(_musicEl);
        _musicAnalyser = ac.createAnalyser();
        _musicAnalyser.fftSize = 128; // 64 frequency bins — plenty for a bar visualizer
        _musicSourceNode.connect(_musicAnalyser);
        _musicAnalyser.connect(ac.destination);
        _musicFreqData = new Uint8Array(_musicAnalyser.frequencyBinCount);
    } catch (e) {
        console.warn('[DR Music] analyser setup failed (visualizer will be inert):', e);
    }
    return _musicEl;
}

/* Returns a live Uint8Array of frequency magnitudes (0-255), or null if
   no analyser is available. Called every frame by the visualizer. */
function getMusicFrequencyData() {
    if (!_musicAnalyser || !_musicFreqData) return null;
    _musicAnalyser.getByteFrequencyData(_musicFreqData);
    return _musicFreqData;
}

function _musicPlayTrack(context) {
    _musicContext = context;
    const el = _getMusicEl();
    const theme = (typeof _currentTheme === 'string' ? _currentTheme : 'default');
    const src = _musicTrackFor(theme, context);

    if (!src) { el.pause(); return; } // no track for this theme/context yet — just silence, no error

    const fullSrc = src; // relative path, resolved against the page
    if (el.dataset.src === fullSrc && !el.paused) return; // already playing the right thing

    clearTimeout(_musicFadeTimer);
    const startNew = () => {
        el.src = fullSrc;
        el.dataset.src = fullSrc;
        el.volume = muted ? 0 : (typeof musicVol === 'number' ? musicVol : 0.4);
        el.play().catch(() => {}); // autoplay can be blocked before first user gesture — harmless
    };

    if (el.paused || !el.dataset.src) {
        startNew();
    } else {
        // Quick fade-out/in between tracks instead of a hard cut
        const fadeSteps = 10, stepMs = 15;
        let i = 0;
        const baseVol = el.volume;
        const fadeOut = setInterval(() => {
            i++;
            el.volume = Math.max(0, baseVol * (1 - i / fadeSteps));
            if (i >= fadeSteps) {
                clearInterval(fadeOut);
                startNew();
            }
        }, stepMs);
    }
}

/* ── Public API (called from settings.js / ui.js / intro.js) ── */
function startMenuAudio() { _musicPlayTrack('menu'); }
function stopMenuAudio()  { if (_musicContext === 'menu' && _musicEl) _musicEl.pause(); }
function startBgAudio()   { _musicPlayTrack('battle'); }
function stopBgAudio()    { if (_musicContext === 'battle' && _musicEl) _musicEl.pause(); }

/* ── Called by toggleMute() and the volume slider ── */
function _musicApplyVolume() {
    if (!_musicEl) return;
    _musicEl.volume = muted ? 0 : (typeof musicVol === 'number' ? musicVol : 0.4);
}

/* ── Called by applyTheme() whenever the theme changes — swap the
   track live if music is currently playing, in the same context. ── */
function _musicOnThemeChange() {
    if (!_musicContext) return; // nothing playing yet, nothing to swap
    _musicPlayTrack(_musicContext);
}

/* ═══════════════════════════════════════════════════════════════════
   MUSIC SYSTEM — per-theme tracks
   ---------------------------------------------------------------------
   Replaces the old procedural Web Audio synths entirely. Each theme
   has its own main-menu track and combat track (e.g. changing the
   theme from Default to Angelic while on the main menu swaps
   "default-main.opus" for "angelic-main.ogg" automatically). Falls back
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
    space:          { main: 'space-main.opus',           combat: 'space-combat.opus' },
    aero:           { main: 'aero-main.opus',            combat: 'aero-combat.opus' },
    cyberpunk:      { main: 'cyberpunk-main.opus',        combat: 'cyberpunk-combat.opus' },
    scourge:        { main: null,                          combat: 'scourge-combat.opus' },
    angelic:        { main: 'angelic-main.opus',          combat: 'angelic-combat.opus' },
    '8space':       { main: '8space-main.opus',           combat: '8space-combat.opus' },
    castingcasings: { main: 'castingcasings-main.opus',    combat: 'castingcasings-combat.opus' },
};
// "New" tracks live in sounds/songs/music/ (empty until the new set is
// delivered); the previous set lives in sounds/songs/legacy music/ —
// toggled via the Settings > Audio "Legacy Music" checkbox
// (dr_legacy_music), default off. Player-supplied tracks live in
// sounds/songs/custom music/, toggled via "Custom Music" (dr_custom_music)
// — see _musicCustomManifest() below for how those get picked up.
function _musicUseLegacy() {
    try { return localStorage.getItem('dr_legacy_music') === '1'; }
    catch (e) { return false; }
}
function _musicDir() {
    return _musicUseLegacy() ? 'sounds/songs/legacy music/' : 'sounds/songs/music/';
}

/* ── Custom Music ──────────────────────────────────────────────────────
   Player-supplied tracks live in sounds/songs/custom music/{main menu,
   combat}/, read directly off disk via the File System Access API — see
   js/custom-music.js for the folder-picker/scan/permission logic.
   Toggled via Settings > Audio "Custom Music" (dr_custom_music). */
function _musicUseCustom() {
    try { return localStorage.getItem('dr_custom_music') === '1'; }
    catch (e) { return false; }
}

let _musicEl        = null;   // the single <audio> element used for both contexts
let _musicAnalyser   = null;
let _musicSourceNode = null;
let _musicFreqData    = null;
let _musicContext     = null; // 'menu' | 'battle' — which track should be playing
let _musicFadeTimer   = null;

function _musicTrackFor(theme, context) {
    // Callers pass 'menu' / 'battle' (see startMenuAudio/startBgAudio below),
    // but MUSIC_MANIFEST entries are keyed 'main' / 'combat' — that mismatch
    // meant every lookup silently missed and music never played, at all,
    // ever, regardless of theme. Normalize here.
    const field = context === 'battle' ? 'combat' : 'main';
    const t = MUSIC_MANIFEST[theme] || MUSIC_MANIFEST.default;
    const file = t[field] || MUSIC_MANIFEST.default[field];
    return file ? (_musicDir() + file) : null;
}

/* Resolves the actual source to play for this context — tries Custom
   Music first (async: a real file read off disk), falling back to the
   normal legacy/default lookup if custom music is off, unsupported,
   not yet authorized, or has no files for this context. */
async function _musicResolveSrc(theme, context) {
    if (_musicUseCustom() && typeof _customMusicTrackUrl === 'function') {
        const field = context === 'battle' ? 'combat' : 'main';
        const customUrl = await _customMusicTrackUrl(field);
        if (customUrl) return customUrl;
    }
    return _musicTrackFor(theme, context);
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

async function _musicPlayTrack(context) {
    _musicContext = context;
    const el = _getMusicEl();
    const theme = (typeof _currentTheme === 'string' ? _currentTheme : 'default');
    const src = await _musicResolveSrc(theme, context);

    // Context may have changed again while we were awaiting a custom-music
    // file read — if so, a newer call to _musicPlayTrack already owns
    // deciding what plays now, so this stale resolution should back off.
    if (_musicContext !== context) return;

    if (!src) { el.pause(); return; } // no track for this theme/context yet — just silence, no error

    const fullSrc = src; // relative path (or blob: URL for custom tracks)
    if (el.dataset.src === fullSrc && !el.paused) return; // already playing the right thing

    // Cancel any fade already in progress — this was previously a no-op
    // (clearTimeout was called on a timer that was never assigned, since
    // the fade actually used setInterval into a local var), which let
    // rapid theme/legacy-toggle switches stack multiple overlapping fades
    // fighting over el.volume and el.src.
    clearInterval(_musicFadeTimer);
    _musicFadeTimer = null;

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
        _musicFadeTimer = setInterval(() => {
            i++;
            el.volume = Math.max(0, baseVol * (1 - i / fadeSteps));
            if (i >= fadeSteps) {
                clearInterval(_musicFadeTimer);
                _musicFadeTimer = null;
                startNew();
            }
        }, stepMs);
    }
}

/* ── Public API (called from settings.js / ui.js / intro.js) ── */
function setLegacyMusicToggle(enabled) {
    try { localStorage.setItem('dr_legacy_music', enabled ? '1' : '0'); } catch (e) {}
    // Re-trigger playback for whatever context is currently active so the
    // switch takes effect immediately instead of waiting for the next
    // theme change or screen transition.
    if (_musicContext && typeof _musicPlayTrack === 'function') _musicPlayTrack(_musicContext);
}

async function setCustomMusicToggle(enabled) {
    try { localStorage.setItem('dr_custom_music', enabled ? '1' : '0'); } catch (e) {}
    if (!enabled) {
        if (_musicContext && typeof _musicPlayTrack === 'function') _musicPlayTrack(_musicContext);
        return;
    }
    // Turning it on: if we've never picked a folder (or the browser's
    // permission grant for a previously-picked one has lapsed), this is
    // the one moment we have an actual user gesture (the click on this
    // checkbox) to work with — file pickers and permission re-prompts
    // both require one, so this is the only reliable place to ask.
    if (typeof _customMusicScan === 'function') {
        const ok = await _customMusicScan();
        if (!ok && typeof _customMusicPickFolder === 'function') {
            await _customMusicPickFolder();
        }
    }
    if (_musicContext && typeof _musicPlayTrack === 'function') _musicPlayTrack(_musicContext);
}

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

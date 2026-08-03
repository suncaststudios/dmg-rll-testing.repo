/* ═══════════════════════════════════════════════════════════════════
   MUSIC VISUALIZER — combat only
   ---------------------------------------------------------------------
   Two effects, both subtle by design:
   1. A row of frequency bars ("sound bars") drawn faintly in the
      background of the battle scene, behind the cards/zones.
   2. The battlefield zones + field line get a very slight scale pulse
      synced to the bass — enough to feel alive, not enough to distract
      from an actual card game.
   Reads live frequency data from music.js's getMusicFrequencyData().
   Does nothing outside of combat — started in initGame(), stopped in
   returnToMenu()/rematch().
   ═══════════════════════════════════════════════════════════════════ */

let _vizRunning = false;
let _vizCanvas  = null;
let _vizCtx     = null;
let _vizRAF     = null;
let _vizBassSmooth = 0; // smoothed bass level, avoids jittery pulsing

function _vizEnsureCanvas() {
    if (_vizCanvas) return _vizCanvas;
    const container = document.getElementById('game-container');
    if (!container) return null;
    const canvas = document.createElement('canvas');
    canvas.id = 'music-visualizer';
    canvas.style.cssText = 'position:absolute; inset:0; z-index:1; pointer-events:none; opacity:0.5;';
    // Sits just above #embers but below the actual battle UI (zones, cards, etc)
    const embers = document.getElementById('embers');
    if (embers && embers.nextSibling) container.insertBefore(canvas, embers.nextSibling);
    else container.appendChild(canvas);
    _vizCanvas = canvas;
    _vizCtx = canvas.getContext('2d');
    return canvas;
}

function _vizResize() {
    if (!_vizCanvas) return;
    const container = document.getElementById('game-container');
    _vizCanvas.width  = container.clientWidth;
    _vizCanvas.height = container.clientHeight;
}

function startVisualizer() {
    if (_vizRunning) return;
    const canvas = _vizEnsureCanvas();
    if (!canvas) return;
    _vizResize();
    window.addEventListener('resize', _vizResize);
    _vizRunning = true;
    _vizBassSmooth = 0;
    _vizFrame();
}

function stopVisualizer() {
    _vizRunning = false;
    if (_vizRAF) cancelAnimationFrame(_vizRAF);
    window.removeEventListener('resize', _vizResize);
    if (_vizCtx && _vizCanvas) _vizCtx.clearRect(0, 0, _vizCanvas.width, _vizCanvas.height);
    // Reset any pulse transforms so the field doesn't get stuck mid-pulse
    document.querySelectorAll('.zone, #field-line').forEach(el => { el.style.transform = ''; });
}

function _vizFrame() {
    if (!_vizRunning) return;
    _vizRAF = requestAnimationFrame(_vizFrame);

    const data = (typeof getMusicFrequencyData === 'function') ? getMusicFrequencyData() : null;
    const ctx = _vizCtx, w = _vizCanvas.width, h = _vizCanvas.height;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!data || muted) return; // nothing playing (or user muted) — stay blank, not fake motion

    // ── Bars (mirrored, centered, faint — reads as ambient not decoration-hogging) ──
    const barCount = Math.min(40, data.length);
    const barW = w / barCount;
    const baseY = h * 0.86; // sits low, near the field line, out of the way of cards
    const maxBarH = h * 0.16;

    let bassSum = 0;
    for (let i = 0; i < barCount; i++) {
        const v = data[i] / 255; // 0..1
        if (i < 6) bassSum += v;
        const barH = v * maxBarH;
        const x = i * barW;
        const hue = 40 - i * 0.6; // warm gold fading slightly, matches the game's default palette
        ctx.fillStyle = `hsla(${Math.max(0,hue)}, 70%, 55%, ${0.10 + v * 0.18})`;
        ctx.fillRect(x, baseY - barH, barW * 0.7, barH);
        // faint mirror below the line
        ctx.fillStyle = `hsla(${Math.max(0,hue)}, 70%, 55%, ${0.04 + v * 0.08})`;
        ctx.fillRect(x, baseY, barW * 0.7, barH * 0.4);
    }

    // ── Subtle UI pulse synced to bass ──
    const bassLevel = bassSum / 6; // 0..1
    _vizBassSmooth += (bassLevel - _vizBassSmooth) * 0.15; // smoothing, avoids jitter
    const pulse = 1 + _vizBassSmooth * 0.025; // max ~2.5% scale — deliberately subtle
    document.querySelectorAll('.zone').forEach(el => { el.style.transform = `scale(${pulse})`; });
    const fieldLine = document.getElementById('field-line');
    if (fieldLine) fieldLine.style.opacity = (0.5 + _vizBassSmooth * 0.3).toFixed(2);
}

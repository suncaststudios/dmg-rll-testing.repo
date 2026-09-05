/* ═══════════════════════════════════════════════════════════════════
   3D MODE — js/3dmode.js
   ═══════════════════════════════════════════════════════════════════
   Purely local, purely reactive visualization of `state` (js/game.js)
   and the theme system (applyTheme() in js/settings.js). Never mutates
   game state, never touches anything that gets broadcast over the
   network (js/online.js / js/lobby.js). A 3D-mode player and a 2D-mode
   player can play each other with zero special-casing anywhere else.

   Loaded as an ES module (see the <script type="importmap"> + this
   <script type="module"> tag in index.html). Everything else in this
   codebase is classic (non-module) script, so this file talks to it by
   reading/writing a few `window.*` globals and by wrapping a small set
   of existing global functions (render, rollDie3D, initGame, rematch,
   returnToMenu) rather than editing settings.js/game.js directly.
   ═══════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ThreeMode = (() => {

    /* ── palette per theme (hex, matches css/themes/*.css --die-bg-a/b
       and --intro-* custom properties) ────────────────────────────── */
    const PALETTES = {
        default:        { wall: 0x4a3520, wood: 0x6b4a28, trim: 0xc9963c, glow: 0xffb347, cloth: 0x7a1f1f, style: 'tavern' },
        scourge:        { wall: 0x14301c, wood: 0x1f5a14, trim: 0x6fe05a, glow: 0x6fe05a, cloth: 0x0e2010, style: 'tavern' },
        castingcasings: { wall: 0x3a2a12, wood: 0x14100a, trim: 0xf0d8a8, glow: 0xc9963c, cloth: 0x241a0a, style: 'tavern' },
        cyberpunk:      { wall: 0x2a0040, wood: 0x120018, trim: 0xff00aa, glow: 0xff88cc, cloth: 0x1a0028, style: 'hightech' },
        space:          { wall: 0x16225c, wood: 0x0a1030, trim: 0x5580e0, glow: 0xb8d0ff, cloth: 0x0c1240, style: 'station' },
        aero:           { wall: 0xeaf9ff, wood: 0x7ec8e3, trim: 0x0098d8, glow: 0x55b8e0, cloth: 0xcfefff, style: 'aero' },
        angelic:        { wall: 0xffffff, wood: 0xf0e6c8, trim: 0x202122, glow: 0xeaecf0, cloth: 0xf5f0e0, style: 'angelic' },
        '8space':       { wall: 0x1a0a2e, wood: 0x05030d, trim: 0x00e5ff, glow: 0xa0e8ff, cloth: 0x0d0620, style: 'arcade' },
    };

    let renderer = null, scene = null, camera = null, canvas = null;
    let animHandle = null;
    let active = false;
    let currentTheme = null;
    let clock = new THREE.Clock();

    const objs = { environment: null, opponent: null, dieRig: null, handCards: [], drawPile: null, playedPile: null };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    /* ── public: is 3D mode enabled in settings? ─────────────────── */
    function enabled() {
        const cb = document.getElementById('opt-3d-mode');
        return !!(cb && cb.checked);
    }

    /* ── setup / teardown, gated strictly on #board visibility ────── */
    function boardVisible() {
        const b = document.getElementById('board');
        return !!(b && b.style.display !== 'none' && b.offsetParent !== null);
    }

    function sync() {
        if (enabled() && boardVisible()) {
            if (!active) start();
            else if (currentTheme !== (window._currentTheme || 'default')) rebuildEnvironment();
        } else {
            if (active) stop();
        }
        document.body.classList.toggle('mode-3d-active', enabled() && boardVisible());
    }

    function start() {
        active = true;
        currentTheme = window._currentTheme || 'default';

        canvas = document.createElement('canvas');
        canvas.id = 'three-canvas';
        canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; z-index:1; pointer-events:auto;';
        const board = document.getElementById('board');
        board.insertBefore(canvas, board.firstChild);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(board.clientWidth, board.clientHeight);
        renderer.shadowMap.enabled = true;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, board.clientWidth / board.clientHeight, 0.1, 100);
        // Fixed atmospheric "sitting at the table" angle — not player-controlled.
        camera.position.set(0, 4.4, 6.4);
        camera.lookAt(0, 1.1, -0.4);

        buildEnvironment(currentTheme);
        buildDieRig();
        buildPiles();
        buildOpponent();
        syncHand();

        canvas.addEventListener('click', onCanvasClick);
        window.addEventListener('resize', onResize);
        animate();
    }

    function stop() {
        active = false;
        window.removeEventListener('resize', onResize);
        if (canvas) canvas.removeEventListener('click', onCanvasClick);
        if (animHandle) cancelAnimationFrame(animHandle);
        animHandle = null;
        if (renderer) {
            renderer.dispose();
            renderer.forceContextLoss?.();
        }
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        renderer = null; scene = null; camera = null; canvas = null;
        objs.environment = objs.opponent = objs.dieRig = objs.drawPile = objs.playedPile = null;
        objs.handCards = [];
    }

    function rebuildEnvironment() {
        currentTheme = window._currentTheme || 'default';
        if (objs.environment) { scene.remove(objs.environment); disposeObj(objs.environment); }
        buildEnvironment(currentTheme);
        buildOpponent(); // re-tint cloak to new theme too
    }

    function onResize() {
        if (!renderer || !camera) return;
        const board = document.getElementById('board');
        renderer.setSize(board.clientWidth, board.clientHeight);
        camera.aspect = board.clientWidth / board.clientHeight;
        camera.updateProjectionMatrix();
    }

    function animate() {
        animHandle = requestAnimationFrame(animate);
        const dt = clock.getDelta();
        if (dieAnim.active) stepDieAnim(dt);
        renderer.render(scene, camera);
    }

    function disposeObj(o) {
        o.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                const mats = Array.isArray(n.material) ? n.material : [n.material];
                mats.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
            }
        });
    }

    /* ── canvas texture helpers ─────────────────────────────────── */
    function canvasTexture(draw, w = 256, h = 256) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        return tex;
    }

    function woodTexture(base = '#6b4a28') {
        return canvasTexture((ctx, w, h) => {
            ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 0.25;
            for (let i = 0; i < 18; i++) {
                ctx.strokeStyle = i % 2 ? '#000' : '#fff';
                ctx.lineWidth = 1 + Math.random() * 2;
                ctx.beginPath();
                const y = (i / 18) * h + (Math.random() * 6 - 3);
                ctx.moveTo(0, y);
                ctx.bezierCurveTo(w * 0.3, y + 8, w * 0.7, y - 8, w, y);
                ctx.stroke();
            }
        }, 256, 256);
    }

    /* ── ENVIRONMENT ─────────────────────────────────────────────── */
    function buildEnvironment(theme) {
        const pal = PALETTES[theme] || PALETTES.default;
        const group = new THREE.Group();

        const amb = new THREE.AmbientLight(0xffffff, 0.55);
        const key = new THREE.PointLight(pal.glow, 1.4, 20);
        key.position.set(0, 3.5, 2);
        key.castShadow = true;
        const rim = new THREE.PointLight(pal.trim, 0.6, 15);
        rim.position.set(-3, 2, -3);
        group.add(amb, key, rim);

        // Table (shared by every theme)
        const tableTop = new THREE.Mesh(
            new THREE.CylinderGeometry(2.1, 2.1, 0.14, 24),
            new THREE.MeshStandardMaterial({ map: woodTexture('#' + pal.wood.toString(16).padStart(6, '0')), roughness: 0.7 })
        );
        tableTop.position.set(0, 1.0, -0.3);
        tableTop.receiveShadow = true;
        const tableLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.3, 1.0, 12),
            new THREE.MeshStandardMaterial({ color: pal.wood })
        );
        tableLeg.position.set(0, 0.5, -0.3);
        group.add(tableTop, tableLeg);

        // Floor
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: mulColor(pal.wall, 0.6) })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        group.add(floor);

        // Back wall
        const wall = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 8),
            new THREE.MeshStandardMaterial({ color: pal.wall })
        );
        wall.position.set(0, 4, -5);
        group.add(wall);

        // Cloth runner across the table (theme-tinted)
        const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(1.1, 3.6),
            new THREE.MeshStandardMaterial({ color: pal.cloth, side: THREE.DoubleSide })
        );
        cloth.rotation.x = -Math.PI / 2;
        cloth.position.set(0, 1.08, -0.3);
        group.add(cloth);

        switch (pal.style) {
            case 'hightech':  buildHightechProps(group, pal); break;
            case 'station':   buildStationProps(group, pal); break;
            case 'aero':      buildAeroProps(group, pal); break;
            case 'angelic':   buildAngelicProps(group, pal); break;
            case 'arcade':    buildArcadeProps(group, pal); break;
            case 'tavern':
            default:          buildTavernProps(group, pal); break;
        }

        scene.add(group);
        objs.environment = group;
    }

    function mulColor(hex, f) {
        const c = new THREE.Color(hex);
        c.multiplyScalar(f);
        return c;
    }

    // default / scourge / castingcasings — medieval tavern, recolored per palette
    function buildTavernProps(group, pal) {
        // Support beams
        for (const x of [-3.2, 3.2]) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), new THREE.MeshStandardMaterial({ color: pal.wood }));
            beam.position.set(x, 3, -2);
            group.add(beam);
        }
        // Hanging lantern
        const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color: pal.trim, emissive: pal.glow, emissiveIntensity: 1.2 }));
        lantern.position.set(0, 3.6, 0.5);
        group.add(lantern);
        // Barrels
        for (const [x, z] of [[-2.6, -1], [2.7, -1.4]]) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 16), new THREE.MeshStandardMaterial({ color: pal.wood }));
            barrel.position.set(x, 0.4, z);
            group.add(barrel);
        }
        // Bench trim strip along wall
        const trim = new THREE.Mesh(new THREE.BoxGeometry(6, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: pal.trim }));
        trim.position.set(0, 2.2, -4.9);
        group.add(trim);
    }

    function buildHightechProps(group, pal) {
        for (const x of [-3, 3]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0010, emissive: pal.trim, emissiveIntensity: 0.6 }));
            pillar.position.set(x, 3, -2.5);
            group.add(pillar);
        }
        const neon = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.05, 8, 32), new THREE.MeshStandardMaterial({ color: pal.trim, emissive: pal.trim, emissiveIntensity: 2 }));
        neon.position.set(0, 3.6, -4.5);
        group.add(neon);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x120018, emissive: pal.glow, emissiveIntensity: 0.4 }));
        bar.position.set(0, 0.45, -4.5);
        group.add(bar);
    }

    function buildStationProps(group, pal) {
        const port = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshStandardMaterial({ color: 0x000010, emissive: pal.glow, emissiveIntensity: 0.5 }));
        port.position.set(0, 3.2, -4.9);
        group.add(port);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 8, 32), new THREE.MeshStandardMaterial({ color: pal.trim }));
        ring.position.set(0, 3.2, -4.85);
        group.add(ring);
        for (const [x, y] of [[-3, 1.5], [3, 2.2], [-2.6, 3]]) {
            const light = new THREE.PointLight(pal.glow, 0.5, 6);
            light.position.set(x, y, -1);
            group.add(light);
        }
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), new THREE.MeshStandardMaterial({ color: pal.trim }));
        hull.rotation.z = Math.PI / 2;
        hull.position.set(0, 5.4, -3);
        group.add(hull);
    }

    function buildAeroProps(group, pal) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 12, 32, Math.PI), new THREE.MeshStandardMaterial({ color: pal.trim }));
        arch.position.set(0, 3.2, -4.5);
        group.add(arch);
        for (const x of [-2.2, 2.2]) {
            const cloudPuff = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
            cloudPuff.position.set(x, 5, -3.5);
            group.add(cloudPuff);
        }
        const skylight = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshStandardMaterial({ color: pal.wood, transparent: true, opacity: 0.5 }));
        skylight.position.set(0, 5.5, -1);
        skylight.rotation.x = Math.PI / 2.4;
        group.add(skylight);
    }

    function buildAngelicProps(group, pal) {
        for (const x of [-2.6, 2.6]) {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 5.5, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
            pillar.position.set(x, 2.75, -3);
            group.add(pillar);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 16), new THREE.MeshStandardMaterial({ color: pal.trim }));
            cap.position.set(x, 5.7, -3);
            group.add(cap);
        }
        const halo = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 8, 32), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffe066, emissiveIntensity: 1.5 }));
        halo.rotation.x = Math.PI / 2;
        halo.position.set(0, 5.4, -1.5);
        group.add(halo);
    }

    function buildArcadeProps(group, pal) {
        for (const x of [-3, 3]) {
            const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.6), new THREE.MeshStandardMaterial({ color: 0x100820, emissive: pal.trim, emissiveIntensity: 0.5 }));
            cab.position.set(x, 1.1, -3.6);
            group.add(cab);
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), new THREE.MeshStandardMaterial({ color: pal.glow, emissive: pal.glow, emissiveIntensity: 1.5 }));
            screen.position.set(x, 1.5, -3.29);
            group.add(screen);
        }
        const grid = new THREE.GridHelper(10, 20, pal.trim, pal.trim);
        grid.position.y = 0.02;
        group.add(grid);
    }

    /* ── DIE ──────────────────────────────────────────────────────── */
    // Face → outward local axis, matches the FACE_RESTING table in
    // settings.js so the 3D landing orientation always shows the same
    // pip count the 2D CSS die would show for the same roll.
    const FACE_NORMALS = {
        1: new THREE.Vector3(0, 0, 1),
        2: new THREE.Vector3(0, 1, 0),
        3: new THREE.Vector3(1, 0, 0),
        4: new THREE.Vector3(-1, 0, 0),
        5: new THREE.Vector3(0, -1, 0),
        6: new THREE.Vector3(0, 0, -1),
    };

    function pipTexture(n) {
        const layout = {
            1: [[0.5, 0.5]],
            2: [[0.28, 0.28], [0.72, 0.72]],
            3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
            4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
            5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
            6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
        };
        return canvasTexture((ctx, w, h) => {
            ctx.fillStyle = '#f4ead2'; ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#c9963c'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
            ctx.fillStyle = '#241a10';
            for (const [px, py] of layout[n]) {
                ctx.beginPath();
                ctx.arc(px * w, py * h, w * 0.09, 0, Math.PI * 2);
                ctx.fill();
            }
        }, 128, 128);
    }

    function buildDieRig() {
        const size = 0.42;
        const mats = [1, 2, 3, 4, 5, 6].map(() => null);
        // three.js BoxGeometry face order: +x -x +y -y +z -z → pip 3 4 2 5 1 6
        const order = [3, 4, 2, 5, 1, 6];
        const materials = order.map(n => new THREE.MeshStandardMaterial({ map: pipTexture(n) }));
        const die = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materials);
        die.castShadow = true;
        die.visible = false;
        die.position.set(0, 3, 1);
        scene.add(die);
        objs.dieRig = die;
    }

    const dieAnim = { active: false, t: 0, dur: 0.9, startPos: new THREE.Vector3(), startQuat: new THREE.Quaternion(), targetQuat: new THREE.Quaternion() };

    function throwDie3D(targetRoll) {
        const die = objs.dieRig;
        if (!die) return;
        die.visible = true;
        die.position.set((Math.random() - 0.5) * 1.5, 3.2, 1.2);
        die.quaternion.identity();
        dieAnim.startPos.copy(die.position);
        dieAnim.startQuat.setFromEuler(new THREE.Euler(0, 0, 0));
        die.quaternion.random();
        dieAnim.startQuat.copy(die.quaternion);

        // Random tumble count so it feels thrown, then align so FACE_NORMALS[targetRoll]
        // points up (+Y) at landing — this is what makes the correct pip count end on top.
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI * (4 + Math.random() * 2), Math.PI * (3 + Math.random() * 2), Math.PI * (2 + Math.random() * 2)));
        const alignUp = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[targetRoll], new THREE.Vector3(0, 1, 0));
        dieAnim.targetQuat.copy(spin).multiply(alignUp);

        dieAnim.t = 0;
        dieAnim.active = true;
    }

    function stepDieAnim(dt) {
        dieAnim.t += dt / dieAnim.dur;
        const t = Math.min(dieAnim.t, 1);
        const die = objs.dieRig;
        const ease = 1 - Math.pow(1 - t, 3);
        // Thrown arc: parabolic drop onto the table.
        die.position.set(
            dieAnim.startPos.x * (1 - ease * 0.6),
            THREE.MathUtils.lerp(3.2, 1.14, ease) + Math.sin(Math.PI * (1 - t)) * (t < 0.5 ? 0.6 : 0),
            THREE.MathUtils.lerp(1.2, 0.4, ease)
        );
        die.quaternion.slerpQuaternions(dieAnim.startQuat, dieAnim.targetQuat, ease);
        if (t >= 1) dieAnim.active = false;
    }

    /* ── CARDS (hand) ─────────────────────────────────────────────── */
    function cardTexture(card) {
        return canvasTexture((ctx, w, h) => {
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, '#2a1c10'); grad.addColorStop(1, '#140c06');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#c9963c'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, w - 16, h - 16);
            ctx.fillStyle = '#f0d8a8'; ctx.font = 'bold 26px serif'; ctx.textAlign = 'center';
            ctx.fillText(card.n || '', w / 2, 44);
            ctx.font = '72px serif';
            ctx.fillText(card.i || '', w / 2, h / 2 + 24);
            ctx.font = '16px serif'; ctx.fillStyle = '#d8c090';
            wrapText(ctx, card.d || '', w / 2, h - 60, w - 40, 20);
        }, 300, 420);
    }

    function wrapText(ctx, text, x, y, maxW, lineH) {
        const words = String(text).split(' ');
        let line = '', yy = y;
        for (const word of words) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, x, yy); line = word + ' '; yy += lineH;
            } else line = test;
        }
        ctx.fillText(line, x, yy);
    }

    function syncHand() {
        if (!active || !scene || !window.state) return;
        objs.handCards.forEach(c => { scene.remove(c); disposeObj(c); });
        objs.handCards = [];
        const hand = window.state.pHand || [];
        const n = hand.length;
        hand.forEach((card, i) => {
            const geo = new THREE.BoxGeometry(0.62, 0.86, 0.02);
            const tex = cardTexture(card);
            const mat = new THREE.MeshStandardMaterial({ map: tex });
            const back = new THREE.MeshStandardMaterial({ color: 0x241a10 });
            const mesh = new THREE.Mesh(geo, [back, back, back, back, mat, back]);
            const spread = Math.min(n - 1, 4) * 0.4;
            const x = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
            const tiltZ = n > 1 ? (i / (n - 1) - 0.5) * -0.5 : 0;
            mesh.position.set(x, 0.55 + Math.abs(x) * -0.04, 2.4);
            mesh.rotation.set(-0.55, 0, tiltZ);
            mesh.userData.handIndex = i;
            mesh.castShadow = true;
            scene.add(mesh);
            objs.handCards.push(mesh);
        });
    }

    function onCanvasClick(e) {
        if (!camera || !objs.handCards.length) return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(objs.handCards, false);
        if (hits.length) {
            const idx = hits[0].object.userData.handIndex;
            // Same call path a 2D card's onclick uses — no parallel game logic.
            if (window.state && window.state.turn && typeof window.playerAct === 'function') {
                window.playerAct(idx);
            }
        }
    }

    /* ── DRAW / PLAYED PILES (visual only) ───────────────────────── */
    function buildPiles() {
        const backMat = new THREE.MeshStandardMaterial({ color: 0x241a10 });
        const drawGroup = new THREE.Group();
        const count = 8;
        for (let i = 0; i < count; i++) {
            const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.84, 0.02), backMat);
            c.position.set(-1.55, 1.08 + i * 0.012, -0.9);
            c.rotation.x = -Math.PI / 2;
            drawGroup.add(c);
        }
        scene.add(drawGroup);
        objs.drawPile = drawGroup;

        objs.playedPile = new THREE.Group();
        scene.add(objs.playedPile);
    }

    function addToPlayedPile(card) {
        if (!active || !objs.playedPile) return;
        const tex = cardTexture(card);
        const mat = new THREE.MeshStandardMaterial({ map: tex });
        const back = new THREE.MeshStandardMaterial({ color: 0x241a10 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.84, 0.02), [back, back, back, back, mat, back]);
        const n = objs.playedPile.children.length;
        mesh.position.set(1.55, 1.08 + n * 0.012, -0.9);
        mesh.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.6);
        objs.playedPile.add(mesh);
    }

    /* ── OPPONENT ─────────────────────────────────────────────────── */
    function buildOpponent() {
        if (objs.opponent) { scene.remove(objs.opponent); disposeObj(objs.opponent); }
        const pal = PALETTES[currentTheme] || PALETTES.default;
        const group = new THREE.Group();

        // Placeholder robed figure — swap for a real .glb later by pointing
        // OPPONENT_MODEL_PATH at an asset; loadOpponentModel() already wires
        // a GLTFLoader call, it just has nothing to load yet.
        const robeMat = new THREE.MeshStandardMaterial({ color: pal.cloth, roughness: 0.9 });
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 16), robeMat);
        body.position.set(0, 0.75, -2.6);
        const hood = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), robeMat);
        hood.position.set(0, 1.62, -2.6);
        group.add(body, hood);

        const faceGeo = new THREE.CircleGeometry(0.22, 24);
        const faceMat = new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true });
        const face = new THREE.Mesh(faceGeo, faceMat);
        face.position.set(0, 1.55, -2.42);
        group.add(face);
        objs.opponentFace = face;

        loadOpponentAvatarTexture().then(tex => {
            if (!tex || !objs.opponentFace) return;
            objs.opponentFace.material.map = tex;
            objs.opponentFace.material.color.set(0x808080); // darken/shadow-under-hood
            objs.opponentFace.material.opacity = 0.55;
            objs.opponentFace.material.transparent = true;
            objs.opponentFace.material.needsUpdate = true;
        });

        // Generic loader path for a real model later.
        loadOpponentModel(group);

        scene.add(group);
        objs.opponent = group;
    }

    const OPPONENT_MODEL_PATH = null; // set to e.g. 'assets/models/opponent.glb' once a real asset exists
    function loadOpponentModel(group) {
        if (!OPPONENT_MODEL_PATH) return; // no asset yet — placeholder cone/sphere stands in
        const loader = new GLTFLoader();
        loader.load(OPPONENT_MODEL_PATH, gltf => {
            group.children.filter(c => c !== objs.opponentFace).forEach(c => group.remove(c));
            gltf.scene.position.set(0, 0, -2.6);
            group.add(gltf.scene);
        }, undefined, () => { /* keep placeholder on failure */ });
    }

    async function loadOpponentAvatarTexture() {
        try {
            let url = null;
            if (typeof window._onlineOppUid !== 'undefined' && window._onlineOppUid && typeof window.fsGet === 'function') {
                const prof = await window.fsGet('profiles', window._onlineOppUid);
                url = prof && prof.avatar_img;
            }
            if (!url) return null;
            return await new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(url, resolve, undefined, reject);
            });
        } catch (e) {
            return null;
        }
    }

    /* ── hooks into the existing (non-module) game code ────────────── */
    function installHooks() {
        const wrap = (name, after) => {
            const orig = window[name];
            if (typeof orig !== 'function') return;
            window[name] = function (...args) {
                const r = orig.apply(this, args);
                try { after(...args); } catch (e) { console.error('[3dmode]', name, e); }
                return r;
            };
        };

        wrap('render', () => { sync(); if (active) syncHand(); });
        wrap('initGame', () => sync());
        wrap('rematch', () => sync());
        wrap('returnToMenu', () => sync());
        wrap('applyTheme', () => { if (active) rebuildEnvironment(); });

        // rollDie3D determines the real result; wrap it so the 3D die always
        // lands on that same value, never an independently-rolled one.
        const origRoll = window.rollDie3D;
        if (typeof origRoll === 'function') {
            window.rollDie3D = async function (...args) {
                const roll = await origRoll.apply(this, args);
                if (active) throwDie3D(roll);
                return roll;
            };
        }

        // playerAct splices the played card out of state.pHand before resolve();
        // capture it here (by index) so the played-pile pickup shows the right card.
        const origPlayerAct = window.playerAct;
        if (typeof origPlayerAct === 'function') {
            window.playerAct = async function (i) {
                const card = window.state && window.state.pHand && window.state.pHand[i];
                const r = await origPlayerAct.apply(this, [i]);
                if (active && card) addToPlayedPile(card);
                return r;
            };
        }

        const cb = document.getElementById('opt-3d-mode');
        if (cb) cb.addEventListener('change', sync);

        // #board's display is toggled directly in a few places (forfeit
        // popup, etc.) without going through the wrapped functions above —
        // watch it directly as a fallback so 3D mode never keeps rendering
        // in the background.
        const board = document.getElementById('board');
        if (board) {
            new MutationObserver(sync).observe(board, { attributes: true, attributeFilter: ['style'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installHooks);
    } else {
        installHooks();
    }

    return { sync, enabled };
})();

window.ThreeMode = ThreeMode;

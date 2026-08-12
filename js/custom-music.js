/* ═══════════════════════════════════════════════════════════════════
   CUSTOM MUSIC — reads real files from sounds/songs/custom music/
   ---------------------------------------------------------------------
   Design (per spec): the player drops audio files into two subfolders
   — "main menu" and "combat" — inside sounds/songs/custom music/. With
   Custom Music turned on, the game plays whatever's actually in the
   matching folder for the current context, picking randomly when a
   folder has more than one file. No manifest, no filename convention.

   This is built on the browser's File System Access API
   (showDirectoryPicker). That's a deliberate, unavoidable constraint,
   not a shortcut: a web page cannot read arbitrary files from a
   player's disk without the player explicitly choosing them through a
   real OS file dialog — allowing anything else would mean any website
   could silently read your files. The player picks the "custom music"
   folder once; after that, provided the browser still remembers the
   permission grant (persisted via IndexedDB below), it just works on
   every later launch with no further prompting.

   Browser support: Chromium-based browsers (Chrome, Edge, Opera, and
   Electron itself, which is Chromium under the hood) support this.
   Firefox and Safari currently don't implement showDirectoryPicker —
   _cmSupported() below detects that and the UI falls back to a clear
   explanation instead of a silently broken button.
   ═══════════════════════════════════════════════════════════════════ */

const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'opus', 'wav', 'm4a', 'flac', 'aac', 'weba'];

let _cmRootHandle   = null;              // FileSystemDirectoryHandle for "custom music/"
let _cmTracks       = { main: [], combat: [] }; // FileSystemFileHandle[] per context
let _cmActiveUrl     = { main: null, combat: null }; // current blob: URL per context, so we can revoke it
let _cmScanPromise   = null;             // in-flight scan, so concurrent callers share one scan

function _cmSupported() {
    return typeof window.showDirectoryPicker === 'function';
}

/* ── IndexedDB: persist the directory handle across sessions ────────── */
function _cmOpenDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('dr_custom_music', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}
async function _cmSaveHandle(handle) {
    try {
        const db = await _cmOpenDB();
        await new Promise((res, rej) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(handle, 'root');
            tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
    } catch (e) { console.warn('[Custom Music] could not save folder handle', e); }
}
async function _cmLoadSavedHandle() {
    try {
        const db = await _cmOpenDB();
        return await new Promise((res, rej) => {
            const tx = db.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get('root');
            req.onsuccess = () => res(req.result || null);
            req.onerror   = () => rej(req.error);
        });
    } catch (e) { return null; }
}

/* Checks (without prompting) whether we still have read permission on a
   previously-saved handle. Returns true/false/'prompt' — 'prompt' means
   the browser needs an actual user gesture (a click) before it'll
   re-grant, which a bare page load can never provide on its own. */
async function _cmHasPermission(handle) {
    try {
        const state = await handle.queryPermission({ mode: 'read' });
        return state; // 'granted' | 'denied' | 'prompt'
    } catch (e) { return 'denied'; }
}

/* ── Folder picker (the one and only prompt the player ever sees) ───── */
async function _customMusicPickFolder() {
    if (!_cmSupported()) {
        _cmShowUnsupportedMessage();
        return false;
    }
    try {
        const handle = await window.showDirectoryPicker({
            id: 'dr-custom-music',
            mode: 'read',
            startIn: 'music',
        });
        _cmRootHandle = handle;
        await _cmSaveHandle(handle);
        await _customMusicScan(true);
        return true;
    } catch (e) {
        if (e.name !== 'AbortError') console.warn('[Custom Music] folder pick failed', e);
        return false;
    }
}

/* ── Scan main menu/ and combat/ for audio files ─────────────────────
   Matches subfolder names case-insensitively and tolerates "main-menu"/
   "mainmenu" as well as "main menu", since players renaming/recreating
   folders by hand is an easy place for an exact-match lookup to quietly
   fail. */
async function _customMusicScan(forceReprompt) {
    if (_cmScanPromise) return _cmScanPromise;
    _cmScanPromise = (async () => {
        if (!_cmRootHandle) {
            const saved = await _cmLoadSavedHandle();
            if (!saved) return false;
            const perm = await _cmHasPermission(saved);
            if (perm !== 'granted') {
                // Can't silently re-prompt without a user gesture — surface
                // this so the settings UI can show a "click to re-allow"
                // affordance instead of custom music just mysteriously not
                // playing with no explanation.
                window._cmNeedsReauth = true;
                return false;
            }
            _cmRootHandle = saved;
        }
        window._cmNeedsReauth = false;

        const findSubfolder = async (names) => {
            for await (const [name, entryHandle] of _cmRootHandle.entries()) {
                if (entryHandle.kind === 'directory' &&
                    names.includes(name.toLowerCase().replace(/[\s_-]+/g, ''))) {
                    return entryHandle;
                }
            }
            return null;
        };
        const scanFolder = async (dirHandle) => {
            if (!dirHandle) return [];
            const files = [];
            for await (const [name, entryHandle] of dirHandle.entries()) {
                if (entryHandle.kind !== 'file') continue;
                const ext = name.split('.').pop().toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext)) files.push(entryHandle);
            }
            return files;
        };

        const [mainDir, combatDir] = await Promise.all([
            findSubfolder(['mainmenu', 'main']),
            findSubfolder(['combat', 'battle', 'fight']),
        ]);
        const [mainFiles, combatFiles] = await Promise.all([
            scanFolder(mainDir), scanFolder(combatDir),
        ]);
        _cmTracks = { main: mainFiles, combat: combatFiles };
        return true;
    })();
    const result = await _cmScanPromise;
    _cmScanPromise = null;
    return result;
}

/* ── Resolve a playable URL for the given context, picking randomly
   among that folder's files. Returns null if custom music isn't usable
   right now (unsupported browser, no folder picked yet, folder empty,
   or permission needs re-granting) — callers fall back to legacy/default
   music in that case rather than playing silence. ── */
async function _customMusicTrackUrl(context) {
    const field = context === 'combat' ? 'combat' : 'main';
    if (!_cmRootHandle && !_cmScanPromise) await _customMusicScan();
    else if (_cmScanPromise) await _cmScanPromise;

    const pool = _cmTracks[field];
    if (!pool || !pool.length) return null;

    const handle = pool[Math.floor(Math.random() * pool.length)];
    try {
        const file = await handle.getFile();
        if (_cmActiveUrl[field]) URL.revokeObjectURL(_cmActiveUrl[field]);
        const url = URL.createObjectURL(file);
        _cmActiveUrl[field] = url;
        return url;
    } catch (e) {
        console.warn('[Custom Music] could not read file', e);
        return null;
    }
}

/* ── "Show in Explorer" button ───────────────────────────────────────
   Electron build: opens the real, native file manager via a main-process
   API exposed on window.electronAPI — NOT implemented here, since this
   codebase only contains the renderer/web assets, not the Electron main
   process. Whoever owns that side needs to add a handler roughly like:

     // main process
     ipcMain.handle('show-custom-music-folder', () => {
       shell.showItemInFolder(path.join(app.getPath('userData'), ...));
     });
     // preload
     contextBridge.exposeInMainWorld('electronAPI', {
       ...,
       showCustomMusicFolder: () => ipcRenderer.invoke('show-custom-music-folder'),
     });

   Browser (non-Electron): there is no browser API that opens a native
   file manager — this falls back to re-opening the folder picker, which
   is the closest real equivalent and also doubles as how the player
   fixes a lapsed permission grant. */
async function customMusicShowInExplorer() {
    if (window.electronAPI && typeof window.electronAPI.showCustomMusicFolder === 'function') {
        try { await window.electronAPI.showCustomMusicFolder(); return; }
        catch (e) { console.warn('[Custom Music] electron showCustomMusicFolder failed', e); }
    }
    if (!_cmSupported()) { _cmShowUnsupportedMessage(); return; }
    await _customMusicPickFolder();
    if (typeof _cmUpdateReauthHint === 'function') _cmUpdateReauthHint();
    if (_musicContext && typeof _musicPlayTrack === 'function') _musicPlayTrack(_musicContext);
}

function _cmShowUnsupportedMessage() {
    const msg = 'Custom Music needs a Chromium-based browser (Chrome, Edge, or the desktop app) — ' +
                'this browser can\'t grant a web page read access to a folder.';
    if (typeof _showGoldToast === 'function') _showGoldToast(msg);
    else alert(msg);
}

(function () {

    
    
    
    window.quitGame = function () {
        
        if (window.electronAPI && window.electronAPI.updatePresence) {
            try { window.electronAPI.updatePresence({ screen: 'clear' }); } catch(e) {}
        }
        if (window.electronAPI && window.electronAPI.quit) {
            window.electronAPI.quit();
        } else {
            window.close();
        }
    };

    
    window.addEventListener('beforeunload', function () {
        if (window.electronAPI && window.electronAPI.updatePresence) {
            try { window.electronAPI.updatePresence({ screen: 'clear' }); } catch(e) {}
        }
    });

    
    
    
    function unlockAudio() {
        // NOTE: was checking window.AC, but AC is declared with `let` in
        // game.js — that never attaches to window, so this always silently
        // no-op'd and the AudioContext (created suspended, per browser
        // autoplay policy) never actually got resumed. getAC() itself is a
        // real global `function` declaration, so it's safely callable here,
        // and it resumes internally if suspended.
        if (typeof getAC === 'function') {
            try { getAC(); } catch (e) {}
        }
        // Also retry actual track playback: intro.js starts music from
        // inside a 900ms setTimeout after the dismiss click, which some
        // browsers (Safari in particular) no longer treat as gesture-linked
        // by the time it fires, so the original .play() can get silently
        // rejected. _musicPlayTrack() is safe to call again — it no-ops if
        // the right track is already playing.
        if (typeof _musicPlayTrack === 'function' && typeof _musicContext !== 'undefined' && _musicContext) {
            try { _musicPlayTrack(_musicContext); } catch (e) {}
        }
        document.removeEventListener('click',   unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
    }
    document.addEventListener('click',   unlockAudio);
    document.addEventListener('keydown', unlockAudio);

    
    
    
    
    
    
    

    
    
    
    
    
    window._copyToClipboard = function (text, onSuccess, onFail) {
        const wrappedSuccess = () => {
            if (typeof playSfx === 'function') playSfx('copyLink');
            if (onSuccess) onSuccess();
        };
        if (window.electronAPI && window.electronAPI.copyToClipboard) {
            window.electronAPI.copyToClipboard(text);
            wrappedSuccess();
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(wrappedSuccess).catch(onFail || (() => {}));
        } else {
            
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); wrappedSuccess(); }
            catch(e) { if (onFail) onFail(e); }
            document.body.removeChild(ta);
        }
    };

    
    window._origCopyDeckCode = window.copyDeckCode;
    window.copyDeckCode = function () {
        const str = document.getElementById('cdb-export-str')?.value;
        if (!str) { showShareMsg('Save your deck first to generate a code.', true); return; }
        window._copyToClipboard(str,
            () => showShareMsg('Code copied to clipboard!', false),
            () => showShareMsg('Select the code and copy manually.', true)
        );
    };

    
    
    document.addEventListener('dragover',  e => e.preventDefault());
    document.addEventListener('drop',      e => {
        if (!e.target.closest('#mod-drop-zone')) e.preventDefault();
    });

    
    
    document.addEventListener('contextmenu', e => e.preventDefault());

    
    
    document.querySelectorAll('#embers, #rune-grid, #menu-bg, #menu-frame, .corner-rune, .candle-glow').forEach(el => {
        el.style.pointerEvents = 'none';
    });

})();

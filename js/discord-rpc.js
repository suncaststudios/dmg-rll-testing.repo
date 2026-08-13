(function () {
    if (!window.electronAPI) return;

    
    const RPC_KEY = 'dr_discord_rpc_enabled';
    let rpcEnabled = localStorage.getItem(RPC_KEY) !== 'false'; 

    // There is no single '#screen-game' element — the battle HUD lives
    // directly under #game-container and is simply whatever's left visible
    // once every '.screen' overlay (menus, which sit above it at z-index
    // 2000) is hidden. So "in battle" is detected by absence of any visible
    // overlay, not by looking up an id that was never actually in the DOM.
    function _isInBattle() {
        const overlays = document.querySelectorAll('.screen');
        for (const el of overlays) {
            if (el.style.display && el.style.display !== 'none') return false;
        }
        return true;
    }

    window.setDiscordRPC = function (enabled) {
        rpcEnabled = enabled;
        localStorage.setItem(RPC_KEY, enabled ? 'true' : 'false');

        const hint = document.getElementById('discord-rpc-hint');
        if (hint) hint.textContent = enabled
            ? 'Shows your game status on Discord'
            : 'Rich Presence is disabled';

        if (enabled) {
            const screens = [
                'menu-main', 'menu-decks', 'menu-custom-deck',
                'menu-settings', 'menu-credits', 'screen-end'
            ];
            const active = screens.find(id => {
                const el = document.getElementById(id);
                return el && el.style.display !== 'none';
            });
            if (active) sendPresence(active === 'screen-end' ? getEndScreen() : active);
            else if (_isInBattle()) sendPresence('screen-game');
        } else {
            window.electronAPI.updatePresence({ screen: 'clear' });
        }
    };

    function getEndScreen() {
        const et = document.getElementById('end-title');
        return (et && et.textContent.includes('VICTORY')) ? 'screen-end-victory' : 'screen-end-defeat';
    }

    function sendPresence(screenOverride) {
        if (!rpcEnabled) return; 

        const deck = (typeof DECKS !== 'undefined' && typeof selectedDeckId !== 'undefined')
            ? DECKS.find(d => d.id === selectedDeckId)
            : null;

        window.electronAPI.updatePresence({
            screen:    screenOverride,
            deckName:  deck ? deck.name : null,
            deckIcon:  deck ? deck.icon : null,
            pHP:       (typeof state !== 'undefined') ? state.pHP : null,
            aHP:       (typeof state !== 'undefined') ? state.aHP : null,
            winStreak: (typeof achStats !== 'undefined') ? achStats.winStreak : 0,
            customMsg: (typeof getRpcCustomMsg === 'function') ? getRpcCustomMsg() : null,
        });
    }

    const _originalToggle = window.toggle;
    window.toggle = function (id, show) {
        if (_originalToggle) _originalToggle.apply(this, arguments);

        
        const cl = document.getElementById('changelog-panel');
        if (cl) {
            if (id === 'menu-main' && show) {
                const enabled = document.getElementById('opt-update-log')?.checked ?? true;
                cl.style.opacity = enabled ? '1' : '0';
            } else if (_isInBattle()) {
                // Whether this call just showed a menu or hid the last one,
                // if no overlay remains visible we've landed on the battle
                // HUD — keep the changelog panel out of the way there.
                cl.style.opacity = '0';
            }
        }

        const presenceMap = {
            'menu-main':        'menu-main',
            'menu-decks':       'menu-decks',
            'menu-custom-deck': 'menu-custom-deck',
            'menu-settings':    'menu-settings',
            'menu-credits':     'menu-credits',
        };

        if (show && presenceMap[id]) {
            sendPresence(presenceMap[id]);
            return;
        }

        if (show && id === 'screen-end') {
            setTimeout(() => {
                sendPresence(getEndScreen());
            }, 50);
            return;
        }

        // Any screen being hidden away (e.g. menu-start once a match
        // begins) can drop us straight into the battle HUD.
        if (_isInBattle()) sendPresence('screen-game');
    };

    const _originalUpdateHUD = window.updateHUD;
    window.updateHUD = function () {
        if (_originalUpdateHUD) _originalUpdateHUD.apply(this, arguments);
        if (_isInBattle()) sendPresence('screen-game');
    };

    window.addEventListener('DOMContentLoaded', () => {
        const checkbox = document.getElementById('opt-discord-rpc');
        if (checkbox) {
            checkbox.checked = rpcEnabled;
            const hint = document.getElementById('discord-rpc-hint');
            if (hint && !rpcEnabled) hint.textContent = 'Rich Presence is disabled';
        }

        sendPresence('menu-main');
    });

})();

/* ═══════════════════════════════════════════════════════════════════
   THE VAULT — Geometry Dash-style secret code entry
   ---------------------------------------------------------------------
   Each entry:
       'CODE': {
           response: 'shown the first time this code is claimed',
           already: 'shown on repeat entries (optional — falls back to
                      `response` if omitted)',
           reward: () => { ... },  // only ever runs once per code
       }

   Code matching is case-insensitive and trims whitespace. Claimed
   codes are tracked in localStorage (dr_vault_claimed) so the reward
   only fires once per code, even across sessions — re-entering a
   claimed code just replays the `already` (or `response`) message.

   Any code NOT found in VAULT_CODES falls through to a random entry
   from VAULT_ERROR_RESPONSES below instead.
   ═══════════════════════════════════════════════════════════════════ */

/* Default reward for codes that don't specify their own — 100 gold + 20 xp */
function _vaultDefaultReward() {
    if (typeof shopAwardGold === 'function') shopAwardGold(100);
    if (typeof awardXP === 'function') awardXP(20, 'Vault code');
}

/* Unlocks a cosmetic (by SHOP_POOL id) the normal shop-ownership way,
   so it shows up in Customize immediately. */
function _vaultGrantCosmetic(itemId) {
    if (typeof _shopLoad === 'function') _shopLoad();
    if (typeof _shopOwned !== 'undefined') _shopOwned.add(itemId);
    if (typeof _shopSave === 'function') _shopSave();
}

const VAULT_CODES = {
    'GIMME MONEY': {
        response: 'that was my life savings, you know',
        already:  'you already took everything i had! now your asking for more?',
        reward:   () => { if (typeof shopAwardGold === 'function') shopAwardGold(1000); },
    },
    'SANE GAME WHEN': {
        response: 'i have no idea what your talking about...',
        reward:   _vaultDefaultReward,
    },
    'COD3BREAKER': {
        response: 'what is this some kind of reference?',
        reward:   () => {
            _vaultGrantCosmetic('aura_cod3breaker');
            if (typeof awardXP === 'function') awardXP(20, 'Vault code');
        },
    },
    'TARS IS GOAT': {
        response: 'he was indeed, the goat',
        reward:   _vaultDefaultReward,
    },
    'SAYIN': {
        response: "its over 9000!",
        reward:   _vaultDefaultReward,
    },
    'BEST NECROMANCER EVER': {
        response: 'complete facts',
        reward:   _vaultDefaultReward,
    },
    '2020-2023': {
        response: 'rip QB',
        reward:   _vaultDefaultReward,
    },
    'YEAH BABY': {
        response: 'Shagadelic, baby!',
        reward:   _vaultDefaultReward,
    },

    /* ── extra codes ── */
    'GG EZ': {
        response: "im lagging i swear!",
        reward:   _vaultDefaultReward,
    },
    'DOUBLE OR NOTHING': {
        response: "he never says no to that.",
        reward:   _vaultDefaultReward,
    },
    'UP UP DOWN DOWN': {
        response: "left right left right B A start",
        reward:   _vaultDefaultReward,
    },
    'ROLL FOR INITIATIVE': {
        response: "damn! nat 20.",
        reward:   _vaultDefaultReward,
    },
    'THE CAKE IS A LIE': {
        response: "it really is, sorry.",
        reward:   _vaultDefaultReward,
    },
    'FLUMBUS': {
        response: "i always wonder how a flumbus got made",
        reward:   _vaultDefaultReward,
    },
    'TESSERACT': {
        response: "time works differently in here.",
        reward:   _vaultDefaultReward,
    },
    'RADIANCE': {
        response: "what are we going to do, fight the sun?",
        reward:   _vaultDefaultReward,
    },
    'FOR THE HIGH SCORE': {
        response: "may as well put your name on it.",
        reward:   _vaultDefaultReward,
    },
    'NUMBER ONE VICTORY ROYALE': {
        response: "10 kills on the board right now!",
        reward:   _vaultDefaultReward,
    },
};

const VAULT_ERROR_RESPONSES = [
    "That code means nothing to me.",
    "Hmm, not quite. Try again?",
    "The Vault doesn't recognize that one.",
    "What are you trying to accomplish?",
    "...no, that's not it.",
    "Not quite, but nice try.",
    "The Vault Keeper shrugs.",
    "Close, maybe? Still no, though.",
    "That one's never worked for anyone.",
    "That code isn't in here, sorry.",
    "You'll have to try a different one.",
    "The Vault Keeper thinks for a moment, then shakes his head.",
    "Not this time.",
    "Just a guess, huh?",
    "The lock stays put.",
    "No luck with that one.",
    "The Vault hums quietly, unmoved.",
    "Not it, I'm afraid.",
    "Someone must've told you that one wrong.",
    "The Vault Keeper looks away, unbothered.",
];

function _vaultClaimedCodes() {
    try { return new Set(JSON.parse(localStorage.getItem('dr_vault_claimed') || '[]')); }
    catch (e) { return new Set(); }
}
function _vaultMarkClaimed(key) {
    try {
        const claimed = _vaultClaimedCodes();
        claimed.add(key);
        localStorage.setItem('dr_vault_claimed', JSON.stringify([...claimed]));
    } catch (e) {}
}

function openVault() {
    playSfx('menuClick');
    toggle('menu-vault', true);
    const input = document.getElementById('vault-code-input');
    const resp  = document.getElementById('vault-response');
    if (input) input.value = '';
    if (resp) resp.textContent = 'Enter a code, if you have one.';
}

function submitVaultCode() {
    const input = document.getElementById('vault-code-input');
    const resp  = document.getElementById('vault-response');
    if (!input || !resp) return;

    const raw = input.value.trim();
    if (!raw) return;

    playSfx('menuClick');

    const key = raw.toUpperCase();
    const entry = VAULT_CODES[key];

    if (entry) {
        const claimed = _vaultClaimedCodes();
        const alreadyClaimed = claimed.has(key);

        resp.textContent = alreadyClaimed ? (entry.already || entry.response) : entry.response;
        resp.classList.add('vault-response-success');

        if (!alreadyClaimed) {
            if (typeof entry.reward === 'function') {
                try { entry.reward(); } catch (e) { console.error('[DR Vault] reward error for', key, e); }
            }
            _vaultMarkClaimed(key);
        }
    } else {
        resp.classList.remove('vault-response-success');
        const msg = VAULT_ERROR_RESPONSES[Math.floor(Math.random() * VAULT_ERROR_RESPONSES.length)];
        resp.textContent = msg;
    }

    input.value = '';
}

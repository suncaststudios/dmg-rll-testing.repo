/* ═══════════════════════════════════════════════════════════════════
   THE VAULT — Geometry Dash-style secret code entry
   ---------------------------------------------------------------------
   VAULT_CODES is empty for now. To add a real code + reward, add an
   entry like:

       'SOMECODE': {
           response: 'The Vault Keeper nods slowly. "...impressive."',
           reward: () => { grantWhateverHere(); }, // shop currency, a cosmetic unlock, an achievement, etc.
       },

   Code matching is case-insensitive and trims whitespace. Any code
   NOT found in VAULT_CODES falls through to a random entry from
   VAULT_ERROR_RESPONSES below instead.
   ═══════════════════════════════════════════════════════════════════ */

const VAULT_CODES = {
    // (empty — real codes go here later)
};

const VAULT_ERROR_RESPONSES = [
    "That code means nothing to me.",
    "Wrong. Try again, if you dare.",
    "The Vault does not recognize that.",
    "What are you trying to accomplish?",
    "...No. That's not it.",
    "Hmm. Not quite.",
    "The Vault Keeper shakes his head.",
    "Nice try. Really. But no.",
    "That code has never once worked. Not for anyone.",
    "Invalid. The Vault remains sealed.",
    "You'll have to do better than that.",
    "The Vault Keeper stares at you in silence.",
    "Not even close.",
    "That's just a guess, isn't it?",
    "The lock doesn't budge.",
    "Denied. Come back with something real.",
    "The Vault hums, unimpressed.",
    "Absolutely not.",
    "Someone told you that would work, didn't they? They lied.",
    "The Vault Keeper mutters something and looks away.",
];

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
        resp.textContent = entry.response;
        resp.classList.add('vault-response-success');
        if (typeof entry.reward === 'function') {
            try { entry.reward(); } catch (e) { console.error('[DR Vault] reward error for', key, e); }
        }
    } else {
        resp.classList.remove('vault-response-success');
        const msg = VAULT_ERROR_RESPONSES[Math.floor(Math.random() * VAULT_ERROR_RESPONSES.length)];
        resp.textContent = msg;
    }

    input.value = '';
}

// DIG WARS — the Vault: one bank pad per team base. Drive onto your own
// team's pad, choose how much gem dust to cash out, and it channels from
// your satchel into your banked balance. Taking damage interrupts the
// channel — the last seconds at the vault are part of the run.
//
// Banked dust lives on the SOCKET (safe forever within the session): dying
// drops carried dust as usual but never touches the bank.

const gems = require('./gems.js');

const PAD_RADIUS   = 95;    // world units — a chunky landmark in each base
const DEPOSIT_RATE = 300;   // gem dust banked per second while channeling
const PROGRESS_MS  = 100;   // how often the client hears channel progress

let vaults = null;

// One vault per team, centered vertically in each base column.
function getVaults() {
    if (vaults) return vaults;
    const room = global.gameManager.room;
    if (!room || !room.width) return [];
    const tileW = room.width / (room.xgrid || 15);
    vaults = [
        { x: -room.width / 2 + tileW / 2, y: 0, r: PAD_RADIUS, team: TEAM_BLUE },
        { x:  room.width / 2 - tileW / 2, y: 0, r: PAD_RADIUS, team: TEAM_RED  },
    ];
    return vaults;
}

// Compact list for the TG snapshot so every client can draw the doors.
function snapshot() {
    return getVaults().map(v => ({ x: v.x, y: v.y, r: v.r, team: v.team }));
}

function talkProgress(body) {
    if (!body.socket) return;
    const d = body.vaultDeposit;
    body.socket.talk('VP', d ? Math.ceil(d.remaining) : 0, d ? d.total : 0);
}

function cancelDeposit(body, notify = true) {
    if (!body.vaultDeposit) return;
    body.vaultDeposit = null;
    if (notify) talkProgress(body);
}

const MIN_DEPOSIT = 15;  // mirrored by VAULT_MIN_DEPOSIT in client app.js

// Client asked to cash out `amount` gem dust.
function requestDeposit(socket, amount) {
    const body = socket.player && socket.player.body;
    if (!body || body.isDead() || !body.vaultOnPad) return;
    amount = Math.floor(amount);
    const carried = body.carriedGems | 0;
    if (!(amount > 0) || carried < MIN_DEPOSIT) return;
    const total = Math.min(amount, carried);
    body.vaultDeposit = {
        remaining: total,
        total,
        lastHealth: body.health.amount,
        lastTalk: 0,
    };
    talkProgress(body);
}

function requestCancel(socket) {
    const body = socket.player && socket.player.body;
    if (body) cancelDeposit(body);
}

// Per-terrain-tick pad handling for every player.
function tick(players, dtMs) {
    const list = getVaults();
    if (!list.length) return;
    const now = Date.now();
    for (const player of players) {
        const body = player.body;
        if (!body || body.isGhost) continue;
        if (body.isDead()) {
            if (body.vaultOnPad) { body.vaultOnPad = false; }
            cancelDeposit(body, false);
            continue;
        }

        let pad = null;
        for (const v of list) {
            if (v.team !== body.team) continue;
            const dx = body.x - v.x, dy = body.y - v.y;
            if (dx * dx + dy * dy < v.r * v.r) { pad = v; break; }
        }

        const was = !!body.vaultOnPad;
        body.vaultOnPad = !!pad;
        if (was !== body.vaultOnPad && body.socket) {
            body.socket.talk('VU', body.vaultOnPad ? 1 : 0);
            if (!body.vaultOnPad) cancelDeposit(body);
        }

        const d = body.vaultDeposit;
        if (!d) continue;

        // damage interrupts the channel — no drive-by banking under fire
        if (body.health.amount < d.lastHealth - 1e-3) {
            cancelDeposit(body);
            continue;
        }
        d.lastHealth = body.health.amount;

        // channel: move dust satchel → bank at a steady rate (floats while
        // channeling, snapped back to whole dust when the channel ends so
        // no fraction is ever stranded in either pocket)
        const chunk = Math.min(
            d.remaining,
            body.carriedGems || 0,
            (DEPOSIT_RATE * dtMs) / 1000
        );
        if (chunk <= 0) { cancelDeposit(body); continue; }
        d.remaining -= chunk;
        body.carriedGems = Math.max(0, (body.carriedGems || 0) - chunk);
        const socket = body.socket;
        if (socket) {
            socket.gemBanked = (socket.gemBanked || 0) + chunk;
            body.bankedGems = socket.gemBanked;
        }

        const done = d.remaining < 0.5;
        if (done) {
            body.vaultDeposit = null;
            body.carriedGems = Math.round(body.carriedGems);
            if (socket) {
                socket.gemBanked = Math.round(socket.gemBanked);
                body.bankedGems = socket.gemBanked;
            }
        }
        if (done || now - d.lastTalk >= PROGRESS_MS) {
            if (!done) d.lastTalk = now;
            gems.updateSatchel(body);
            gems.talkGems(body, 0);
            talkProgress(body);
        }
    }
}

module.exports = { tick, snapshot, requestDeposit, requestCancel, getVaults };

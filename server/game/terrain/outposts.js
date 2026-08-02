// DIG WARS — Forward Outposts: three fixed sites carved into the wall
// (upper canyon midpoint, deep core, lower canyon midpoint). Each site has
// a permanent STRUCTURE standing on it — grey and neutral at boot. You
// conquer it by DESTROYING it: kill the grey structure and it is instantly
// rebuilt in your team's colors. Kill an enemy team's structure and it
// falls back to grey for anyone to take.
//
// The structure barely shoves anything (rammers can grind it point-blank,
// teammates can sit on it), never hurts anyone, and heals itself very
// slowly. Owning a site gives the team:
//   1. forward respawn — you come back at the owned pad nearest your death
//      (wired into getSpawnLocation in sockets.js)
//   2. field banking — the pad runs the vault deposit channel at 80% credit
//
// Captures and losses announce globally, like the emerald ticker.

const gems = require('./gems.js');

const PAD_RADIUS   = 95;
const EFFICIENCY   = 0.8;     // field banking credits 80% (home vault = 100%)
const DEPOSIT_RATE = 300;     // gem dust banked per second while channeling
const PROGRESS_MS  = 100;
const MIN_DEPOSIT  = 15;
const HEAL_FRAC_PS = 0.0015;  // structure self-heal: 0.15% of max hp per second
const NEUTRAL_YELLOW = "#caca4e";   // the theme's Neutral Team yellow

let outposts = null;

// Build from the terrain grid's carved sites; safe to call before the grid
// exists (returns [] until it does). The neutral structures are raised on
// first touch of the game loop.
function getOutposts() {
    if (outposts) return outposts;
    const tg = global.gameManager && global.gameManager.terrainGrid;
    if (!tg || !tg.outpostSites || !tg.outpostSites.length) return [];
    outposts = tg.outpostSites.map(s => ({
        id: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        r: PAD_RADIUS,
        team: 0,           // 0 = neutral; else TEAM_BLUE / TEAM_RED
        banner: null,      // the living structure entity
    }));
    return outposts;
}

// Static list for the TG snapshot (positions never change).
function snapshot() {
    return getOutposts().map(o => ({ id: o.id, name: o.name, x: o.x, y: o.y, r: o.r }));
}

// Dynamic state for the 250ms OP broadcast.
function stateSnapshot() {
    return getOutposts().map(o => ({
        id: o.id,
        t: o.team,
        h: o.banner && !o.banner.isDead()
            ? Math.max(0, Math.min(1, o.banner.health.amount / o.banner.health.max))
            : 0,
    }));
}

// Owned pads for a team — the forward-respawn candidates.
function ownedBy(team) {
    return getOutposts().filter(o => o.team === team && o.banner && !o.banner.isDead());
}

function announce(msg) {
    global.gameManager.socketManager.broadcast(msg);
}

const teamName = (team) => team === TEAM_BLUE ? "Blue" : team === TEAM_RED ? "Red" : "Someone";

// Raise the structure — grey/neutral (team 0, hostile to everyone so both
// sides can chew it down) or in a team's colors once conquered.
function spawnStructure(site, team) {
    site.team = team;
    const o = new Entity({ x: site.x, y: site.y });
    o.define('outpostBanner');
    o.team = team === 0 ? TEAM_ENEMIES : team;
    o.color.base = team === 0 ? NEUTRAL_YELLOW : getTeamColor(team);
    // the pad's small label carries the site name — the structure itself
    // stays nameless (no floating nameplate, no vestigial score)
    o.name = "";
    o.isOutpostBanner = true;
    // PIN the structure to its pad — it is permanent and immovable, so no
    // amount of ramming can shove it around (see collide() in game/index.js
    // and the per-tick re-pin in tick()).
    o.pinX = site.x;
    o.pinY = site.y;
    o.on('dead', () => onStructureDeath(site));
    site.banner = o;
    site._hpTrack = o.health.max;   // heal-clamp baseline
}

// Death = ownership change. A grey structure rebuilds in its killer's
// colors (conquest); a team structure falls back to grey.
function onStructureDeath(site) {
    const dead = site.banner;
    site.banner = null;
    if (site.team === 0) {
        // conquered: whichever team landed the kill takes it
        let team = 0;
        for (const k of (dead && dead.finalKillers) || []) {
            if (k && (k.team === TEAM_BLUE || k.team === TEAM_RED)) { team = k.team; break; }
        }
        if (team) {
            spawnStructure(site, team);
            announce(`${teamName(team)} has captured the ${site.name}!`);
        } else {
            spawnStructure(site, 0);   // died to something teamless — rebuild grey
        }
    } else {
        const owner = site.team;
        spawnStructure(site, 0);
        announce(`The ${site.name} has fallen — ${teamName(owner)} lost it!`);
    }
}

// Per-terrain-tick pad handling (called beside vault.tick).
function tick(players, dtMs) {
    const list = getOutposts();
    if (!list.length) return;
    const now = Date.now();

    for (const site of list) {
        // raise the boot-time neutral structure once the world is live
        if (!site.banner) spawnStructure(site, site.team);
        // heal CLAMP: the engine's built-in regen (which accelerates as the
        // structure recovers) is capped down to a flat, modest rate —
        // damage may drop health freely, but gains never exceed
        // HEAL_FRAC_PS per second
        const b = site.banner;
        if (b && !b.isDead()) {
            const allowed = Math.min(b.health.max,
                (site._hpTrack ?? b.health.amount) + b.health.max * HEAL_FRAC_PS * (dtMs / 1000));
            if (b.health.amount > allowed) b.health.amount = allowed;
            site._hpTrack = b.health.amount;
        }
        // PIN the structure back onto its pad each tick — permanent, immovable.
        if (b) {
            b.x = site.x; b.y = site.y;
            b.velocity.x = 0; b.velocity.y = 0;
            b.accel.x = 0;    b.accel.y = 0;
        }
    }

    for (const player of players) {
        const body = player.body;
        if (!body || body.isGhost) continue;
        if (body.isDead()) {
            if (body.outpostDeposit) { body.outpostDeposit = null; talkOutpostProgress(body); }
            continue;
        }

        // which pad (if any) is this body standing on?
        let pad = null;
        for (const o of list) {
            const dx = body.x - o.x, dy = body.y - o.y;
            if (dx * dx + dy * dy < o.r * o.r) { pad = o; break; }
        }

        // ── FIELD BANKING: own team's pad runs the vault channel at 80% ──
        const onOwnPad = !!(pad && pad.team === body.team && pad.banner && !pad.banner.isDead());
        const was = !!body.outpostOnPad;
        body.outpostOnPad = onOwnPad;
        if (was !== onOwnPad && body.socket) {
            // reuse the vault pad UI channel — the client's deposit panel
            // works unchanged; OU tells it which kind of pad it's on
            body.socket.talk('OU', onOwnPad ? 1 : 0);
            if (!onOwnPad && body.outpostDeposit) {
                body.outpostDeposit = null;
                talkOutpostProgress(body);
            }
        }

        const d = body.outpostDeposit;
        if (!d) continue;
        if (body.health.amount < d.lastHealth - 1e-3) {
            body.outpostDeposit = null;
            talkOutpostProgress(body);
            continue;
        }
        d.lastHealth = body.health.amount;
        const chunk = Math.min(
            d.remaining,
            body.carriedGems || 0,
            (DEPOSIT_RATE * dtMs) / 1000
        );
        if (chunk <= 0) { body.outpostDeposit = null; talkOutpostProgress(body); continue; }
        d.remaining -= chunk;
        body.carriedGems = Math.max(0, (body.carriedGems || 0) - chunk);
        const socket = body.socket;
        if (socket) {
            // the 20% field-banking tax, applied as the dust goes in
            socket.gemBanked = (socket.gemBanked || 0) + chunk * EFFICIENCY;
            body.bankedGems = socket.gemBanked;
        }
        const done = d.remaining < 0.5;
        if (done) {
            body.outpostDeposit = null;
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
            talkOutpostProgress(body);
        }
    }
}

function talkOutpostProgress(body) {
    if (!body.socket) return;
    const d = body.outpostDeposit;
    body.socket.talk('VP', d ? Math.ceil(d.remaining) : 0, d ? d.total : 0);
}

// Client asked to cash out on an outpost pad.
function requestDeposit(socket, amount) {
    const body = socket.player && socket.player.body;
    if (!body || body.isDead() || !body.outpostOnPad) return;
    amount = Math.floor(amount);
    const carried = body.carriedGems | 0;
    if (!(amount > 0) || carried < MIN_DEPOSIT) return;
    const total = Math.min(amount, carried);
    body.outpostDeposit = {
        remaining: total,
        total,
        lastHealth: body.health.amount,
        lastTalk: 0,
    };
    talkOutpostProgress(body);
}

function requestCancel(socket) {
    const body = socket.player && socket.player.body;
    if (body && body.outpostDeposit) {
        body.outpostDeposit = null;
        talkOutpostProgress(body);
    }
}

module.exports = {
    tick, snapshot, stateSnapshot, ownedBy, getOutposts,
    requestDeposit, requestCancel, EFFICIENCY,
};

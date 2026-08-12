// TUTORIAL SESSION
//
// Runtime state for the tutorial server: which learner owns which plot, and the
// scripted bots each plot spawns on demand.
//
// Plot isolation is what makes one room feel like nine private worlds. See
// terrain/tutorialPlots.js for the geometry and why culling guarantees privacy.

const plots = require('./terrain/tutorialPlots.js');

// socket -> plot index, and the reverse occupancy table.
const owners = new Array(plots.plotCount()).fill(null);

// Per-plot scripted bots: { dummy: Entity|null, fighter: Entity|null }
const bots = new Array(plots.plotCount()).fill(null).map(() => ({ dummy: null, fighter: null }));

function plotOf(socket) {
    return socket && socket._tutorialPlot != null ? socket._tutorialPlot : -1;
}

// Claim the first free plot. Returns -1 when the server is full, which the
// caller turns into a "come back in a moment" rejection rather than dropping
// two learners into one world.
function claimPlot(socket) {
    const existing = plotOf(socket);
    if (existing >= 0) return existing;
    for (let i = 0; i < owners.length; i++) {
        if (owners[i] === null) {
            owners[i] = socket;
            socket._tutorialPlot = i;
            return i;
        }
    }
    return -1;
}

function releasePlot(socket) {
    const i = plotOf(socket);
    if (i < 0) return;
    owners[i] = null;
    socket._tutorialPlot = null;
    clearBots(i);
}

function freePlots() {
    return owners.reduce((n, o) => n + (o === null ? 1 : 0), 0);
}

function spawnPointFor(socket) {
    const i = plotOf(socket);
    if (i < 0) return null;
    return plots.plotPoint(i, 'spawn');
}

// ─── scripted bots ────────────────────────────────────────────────────────

function killBot(entity) {
    if (entity && !entity.isDead()) {
        entity.kill();
        entity.destroy();
    }
}

function clearBots(plotIndex) {
    const slot = bots[plotIndex];
    if (!slot) return;
    killBot(slot.dummy);
    killBot(slot.fighter);
    slot.dummy = slot.fighter = null;
}

// Shared setup for both practice targets. They are real tanks on the enemy
// team so damage, health bars, death and gem drops all behave exactly as they
// will in a real match - the tutorial teaches the real game, not a mock of it.
function baseTarget(loc, name) {
    const o = new Entity(loc);
    o.define(Config.spawn_class);
    o.refreshBodyAttributes();
    o.team = TEAM_RED;
    o.color.base = getTeamColor(TEAM_RED);
    o.leaderboardColor = o.color.base;
    o.minimapColor = o.color.base;
    o.name = name;
    o.isBot = true;
    o.isTutorialBot = true;
    // Practice targets are lesson props, not competitors.
    o.settings.leaderboardable = false;
    // View-based activation would freeze these before the learner arrives.
    o.alwaysActive = true;

    // Level up to the same tier the learner spawns at, so the health bar and
    // the damage numbers match what a real opponent looks like. A level-1
    // target would die to a single shot and teach nothing.
    o.skill.reset();
    while (o.skill.level < Config.level_cap_cheat) {
        o.skill.score += o.skill.levelScore;
        o.skill.maintain();
    }
    o.refreshBodyAttributes();

    // Dig Wars tanks carry a satchel; without one these drop nothing on death.
    if (Config.dig_wars) require('./terrain/gems.js').initSatchel(o);
    return o;
}

// A target that never moves and never shoots: the first kill should be about
// aiming and holding fire, nothing else.
function spawnDummy(plotIndex) {
  try {
    const slot = bots[plotIndex];
    if (!slot) return null;
    if (slot.dummy && !slot.dummy.isDead()) return slot.dummy;

    const loc = plots.plotPoint(plotIndex, 'dummy');
    const o = baseTarget(loc, 'Practice Dummy');
    o.controllers = [];               // no AI at all
    o.define({ CONTROLLERS: [] }, false, false, false);
    o.settings.hasNoRecoil = true;    // its own guns never fire, but be sure
    slot.dummy = o;
    return o;
  } catch (e) { util.warn("tutorial: dummy spawn failed - " + (e && e.message)); return null; }
}

// The first opponent that shoots back, pinned to the bottom of the skill range.
// botSkill drives decision quality only (not damage or speed), so a low value
// gives a real fight that a beginner can win.
function spawnFighter(plotIndex) {
  try {
    const slot = bots[plotIndex];
    if (!slot) return null;
    if (slot.fighter && !slot.fighter.isDead()) return slot.fighter;

    const loc = plots.plotPoint(plotIndex, 'fighter');
    const o = baseTarget(loc, 'Rookie');
    o.define({ CONTROLLERS: ["digWarsGoals"] }, false, false, false);
    o.botSkill = 0.1;
    o.botStyle = 'normal';
    o.botTemperament = 'passive';
    o.botRammerAllowed = false;
    o.botStatsFixed = true;
    o.botRespawnsRemaining = 0;
    slot.fighter = o;
    return o;
  } catch (e) { util.warn("tutorial: fighter spawn failed - " + (e && e.message)); return null; }
}

// ─── step gating ──────────────────────────────────────────────────────────
//
// A tutorial step teaches ONE thing, and a learner who wanders off to dump
// stat points or evolve into something the next lesson is not written for
// ends up in a state the script cannot recover from. So each step declares
// what it permits, and everything else is refused at the socket - not merely
// hidden in the UI, because the keyboard shortcuts bypass the UI entirely.
//
// Movement and firing are never gated: being unable to drive feels broken,
// and every lesson is easier to follow while you can move.
const CAPS = ['stats', 'upgrade', 'bank'];

function setAllowed(body, csv) {
    const list = String(csv || '').split(',').map(x => x.trim()).filter(Boolean);
    body._tutorialAllow = new Set(list.filter(c => CAPS.includes(c)));
}

// Default-closed: if a step never declared its permissions, assume the strict
// set. A missing declaration should not silently unlock the whole game.
function allows(body, cap) {
    if (!Config.tutorial) return true;
    if (!body || !body._tutorialAllow) return false;
    return body._tutorialAllow.has(cap);
}

// ─── forced upgrade path ──────────────────────────────────────────────────
//
// The tutorial teaches one build at a time: a bullet tank first, a drone tank
// second. Rather than trusting the learner to pick the right box out of six,
// the class menu is filtered down to the single tank the lesson is about.

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The lock takes a comma-separated PATH, not a single tank: a target such as
// Penta Shot sits several tiers up the tree (basic - Twin - Triple Shot -
// Penta Shot), and a menu filtered to only the final tank shows NOTHING at
// tier one - the learner stares at an empty upgrade box. Naming every rung
// lets each tier offer exactly one choice: the next step along the path.
function lockUpgrades(body, path) {
    const names = String(path || '').split(',').map(normalise).filter(Boolean);
    body._tutorialLock = names.length ? names : null;
}

function unlockUpgrades(body) {
    body._tutorialLock = null;
}

// Consulted by sockets.js while it builds the offered-upgrade list.
function upgradeAllowed(body, upgrade) {
    if (!body || !body._tutorialLock) return true;
    for (const c of (upgrade.class || [])) {
        if (!c) continue;
        // Entries here are usually raw definition KEYS ('twin', 'pentaShot')
        // - entity.js pushes the unresolved strings - but resolve to the
        // class object too and match its display label, so lessons can name
        // tanks the way players see them ("Penta Shot").
        if (typeof c === 'string') {
            if (body._tutorialLock.includes(normalise(c))) return true;
            const def = Class[c];
            if (def && body._tutorialLock.includes(normalise(def.LABEL))) return true;
            continue;
        }
        if (body._tutorialLock.includes(normalise(c.LABEL)) ||
            body._tutorialLock.includes(normalise(c.NAME)) ||
            body._tutorialLock.includes(normalise(c.index))) return true;
    }
    return false;
}

// Turn the learner's tank into a specific class outright. The drone lesson
// needs this: by then they are a Penta Shot at the top of the bullet branch,
// and the upgrade tree cannot reach Director from there - no menu filtering
// can teach a drone tank to someone who already finished a different branch.
// Allowlisted so the TUT packet can never morph anyone into an arbitrary tank.
const MORPHS = ['director', 'pentaShot'];

function morph(body, className) {
    try {
        const key = String(className || '').trim();
        if (!MORPHS.includes(key) || !Class[key]) return;
        body.define(key);
        body.refreshBodyAttributes();
    } catch (e) { util.warn("tutorial: morph failed - " + (e && e.message)); }
}

// Keep each practice bot near its home point.
//
// Two problems this solves. The obvious one: a bot that leaves its plot could
// drift into a neighbour's world, which plot isolation must never allow. The
// subtler one, and the reason the leash is a RADIUS rather than the plot
// border: a plot is far bigger than the screen, so digWarsGoals is perfectly
// entitled to go mine a rock across the plot - and the learner is left staring
// at an empty field waiting for an opponent that is alive, well, and 3000
// units away. The lesson has to happen where the learner can see it.
const LEASH_RADIUS = 1100;

function tickLeash() {
    for (let i = 0; i < bots.length; i++) {
        const slot = bots[i];
        for (const key of ['dummy', 'fighter']) {
            const o = slot[key];
            if (!o || o.isDead()) continue;
            const home = plots.plotPoint(i, key);
            const dx = o.x - home.x, dy = o.y - home.y;
            const d = Math.hypot(dx, dy);
            if (d <= LEASH_RADIUS) continue;
            // Slide it back to the edge of its leash rather than snapping it
            // home, so a bot circling the learner is nudged, not teleported.
            const k = LEASH_RADIUS / d;
            o.x = home.x + dx * k;
            o.y = home.y + dy * k;
            if (o.velocity) { o.velocity.x *= 0.2; o.velocity.y *= 0.2; }
        }
    }
}

// Hold every learner out of their plot's enemy base. Runs on the gamemode
// loop, so it applies on every step - a learner who wanders into the base
// during the mining lesson would die to something nothing has explained yet.
function tickBaseGuard() {
    for (let i = 0; i < owners.length; i++) {
        const socket = owners[i];
        const body = socket && socket.player && socket.player.body;
        if (!body || body.isDead()) continue;
        plots.keepOutOfBase(body, i);
    }
}

// Drop plots whose owner vanished (disconnect, crash, tab close).
function tickReap() {
    for (let i = 0; i < owners.length; i++) {
        const socket = owners[i];
        if (!socket) continue;
        if (socket.closed || socket.readyState === 3 || socket._tutorialPlot !== i) {
            owners[i] = null;
            if (socket) socket._tutorialPlot = null;
            clearBots(i);
        }
    }
}

module.exports = {
    claimPlot, releasePlot, plotOf, freePlots, spawnPointFor,
    spawnDummy, spawnFighter, clearBots,
    lockUpgrades, unlockUpgrades, upgradeAllowed, morph,
    setAllowed, allows,
    tickLeash, tickReap, tickBaseGuard,
    plotCount: plots.plotCount,
    plotPoint: plots.plotPoint,
};

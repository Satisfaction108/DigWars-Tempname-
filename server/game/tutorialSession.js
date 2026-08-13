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

// Everything the client needs to know about its own arena, shipped in the TUTI
// packet. The client cannot derive any of it: it is handed the room and the
// terrain, but nothing tells it how the room was divided.
//
// The landmarks matter beyond drawing markers. Without them the lesson script
// falls back on "the first outpost in the list" and "the nearest rock", both of
// which happily point at a NEIGHBOUR's arena - the outpost list is room-wide
// and the terrain renderer holds every rock in the room. Every world lookup on
// the client is filtered through `arena` for that reason.
function plotInfo(index) {
    const pt = (k) => {
        const p = plots.plotPoint(index, k);
        return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const c = plots.plotCenter(index);
    const r = plots.plotRect(index);
    return {
        plot: index,
        spawn: pt('spawn'),
        rocks: pt('rocks'),
        base: pt('base'),              // the lethal, red one
        homeBase: pt('homeBase'),
        vault: pt('vaultBlue'),        // the one they can actually bank at
        outpost: pt('outpost'),
        chamberBlue: pt('chamberBlue'),
        chamberRed: pt('chamberRed'),
        // Frame for the full map, and the filter for every world lookup.
        cx: Math.round(c.x), cy: Math.round(c.y),
        size: plots.PLOT_SIZE,
        arena: {
            x0: Math.round(r.x0), y0: Math.round(r.y0),
            x1: Math.round(r.x1), y1: Math.round(r.y1),
        },
    };
}

function talkPlotInfo(socket) {
    const i = plotOf(socket);
    if (i < 0) return;
    try { socket.talk("TUTI", JSON.stringify(plotInfo(i))); } catch (e) { }
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

// Somewhere just off the learner's shoulder. Practice targets used to spawn at
// a fixed point in the arena, which meant the learner had to go looking for
// them - and if they had wandered, the target was off screen when it appeared
// and the lesson sat there waiting on a bot that was "there".
function besidePlayer(plotIndex, dx, dy) {
    const socket = owners[plotIndex];
    const body = socket && socket.player && socket.player.body;
    if (!body || body.isDead()) return plots.plotPoint(plotIndex, 'dummy');
    const r = plots.plotRect(plotIndex);
    const m = 140;
    return {
        x: Math.max(r.x0 + m, Math.min(r.x1 - m, body.x + dx)),
        y: Math.max(r.y0 + m, Math.min(r.y1 - m, body.y + dy)),
    };
}

// A target that never moves and never shoots: the first kill should be about
// aiming and holding fire, nothing else.
function spawnDummy(plotIndex) {
  try {
    const slot = bots[plotIndex];
    if (!slot) return null;
    if (slot.dummy && !slot.dummy.isDead()) return slot.dummy;

    const o = baseTarget(besidePlayer(plotIndex, 460, -110), 'Practice Dummy');
    o.controllers = [];               // no AI at all
    o.define({ CONTROLLERS: [] }, false, false, false);
    o.settings.hasNoRecoil = true;    // its own guns never fire, but be sure
    slot.dummy = o;
    return o;
  } catch (e) { util.warn("tutorial: dummy spawn failed - " + (e && e.message)); return null; }
}

// The first opponent that shoots back.
//
// It is a Penta Shot, same as the learner, on a deliberately thin stat spread
// rather than a blank one: an opponent with no stats at all dies to a sneeze
// and teaches nothing about aiming or backing off. Display-order stats, which
// setStats maps onto the raw skill array.
const FIGHTER_STATS = [3, 3, 4, 5, 5, 5, 5, 1, 0, 0];

function spawnFighter(plotIndex) {
  try {
    const slot = bots[plotIndex];
    if (!slot) return null;
    if (slot.fighter && !slot.fighter.isDead()) return slot.fighter;

    const o = baseTarget(besidePlayer(plotIndex, 520, 140), 'Rookie');
    o.define('pentaShot');
    // io_tutorialDuelist, not the full bot brain: see controllers.js for why.
    o.define({ CONTROLLERS: ["tutorialDuelist"] }, false, false, false);
    o.tutorialFoe = (owners[plotIndex] && owners[plotIndex].player)
        ? owners[plotIndex].player.body : null;
    o.botStatsFixed = true;
    o.botRespawnsRemaining = 0;
    setStats(o, FIGHTER_STATS);
    o.refreshBodyAttributes();
    slot.fighter = o;
    return o;
  } catch (e) { util.warn("tutorial: fighter spawn failed - " + (e && e.message)); return null; }
}

// ─── staging helpers the lesson script drives ─────────────────────────────

// The skill bar the player sees is ordered
//   body damage, max health, bullet speed, bullet health, bullet penetration,
//   bullet damage, reload, movement speed, shield regen, shield capacity
// while Skill.raw is ordered [rld, pen, str, dam, spd, shi, atk, hlt, rgn, mob].
// Lessons talk in the order the player can see, so the mapping lives here once.
const DISPLAY_TO_RAW = [6, 7, 4, 2, 1, 3, 0, 9, 8, 5];

function setStats(body, list) {
    if (!body || !body.skill) return;
    const raw = body.skill.raw.slice();
    for (let i = 0; i < DISPLAY_TO_RAW.length && i < list.length; i++) {
        const v = Math.max(0, Math.min(Config.skill_cap, list[i] | 0));
        raw[DISPLAY_TO_RAW[i]] = v;
    }
    // set() clamps to caps and refunds the overflow into points, which is
    // exactly right: asking a rammer for bullet damage should hand the point
    // back rather than silently vanish it.
    const spent = raw.reduce((a, b) => a + b, 0);
    const before = body.skill.raw.reduce((a, b) => a + b, 0);
    body.skill.set(raw);
    body.skill.points = Math.max(0, body.skill.points + before - spent);
    body.refreshBodyAttributes();
}

// Hand the learner points to spend. Used when a morph opens up a stat they
// have never seen (a rammer's Engine Acceleration) after everything was spent.
function grantPoints(body, n) {
    if (!body || !body.skill) return;
    body.skill.points = Math.max(body.skill.points, n | 0);
}

// Put the learner on top of the landmark the lesson is about. Walking 2000
// units in silence is not a lesson, and the edge arrow only helps if you
// already know why you are walking.
function teleport(socket, key) {
    const i = plotOf(socket);
    const body = socket && socket.player && socket.player.body;
    if (i < 0 || !body || body.isDead()) return;
    let p;
    try { p = plots.plotPoint(i, key); } catch (e) { return; }
    // Land beside a structure rather than inside it: dropping a tank on top of
    // a chamber ring wedges it in the collision geometry.
    const off = (key === 'outpost' || key === 'chamberRed' || key === 'chamberBlue') ? -260 : 0;
    body.x = p.x + off;
    body.y = p.y;
    if (body.velocity) { body.velocity.x = 0; body.velocity.y = 0; }
    if (socket.camera) { socket.camera.x = body.x; socket.camera.y = body.y; }
}

// Force a player command flag (the drone lesson turns auto-fire off so the
// learner sees drones recall when they release the button).
function setCommand(socket, name, on) {
    const p = socket && socket.player;
    if (!p || !p.command) return;
    if (!['autofire', 'autospin', 'override', 'autoalt', 'spinlock'].includes(name)) return;
    p.command[name] = !!on;
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
// Every tank the curriculum walks through, plus the bullet tank it returns to
// between chapters. Allowlisted so a crafted TUT packet cannot morph anyone
// into an arbitrary class.
const MORPHS = ['director', 'overlord', 'auto3', 'smasher', 'pentaShot'];

function morph(body, className) {
    try {
        const key = String(className || '').trim();
        if (!MORPHS.includes(key) || !Class[key]) return;
        body.define(key);
        body.refreshBodyAttributes();
    } catch (e) { util.warn("tutorial: morph failed - " + (e && e.message)); }
}

// Keep each practice bot on the learner's screen.
//
// The duelist controller already circles the player, so this is a backstop for
// the cases the controller cannot cover: knockback, a bot spawned before the
// player moved, and the stationary dummy after the learner has walked off. The
// radius is set by the VERTICAL view cull (fov * 0.5625, about 1125 units),
// which is far tighter than the horizontal one - a bot 1200 units above the
// learner is culled out of their client entirely and reads as "it vanished".
const LEASH_RADIUS = 820;

function tickLeash() {
    for (let i = 0; i < bots.length; i++) {
        const slot = bots[i];
        const socket = owners[i];
        const player = socket && socket.player && socket.player.body;
        for (const key of ['dummy', 'fighter']) {
            const o = slot[key];
            if (!o || o.isDead()) continue;
            // Anchor on the learner, not on a fixed point: the lesson has to
            // happen where they can see it, wherever that is.
            const home = (player && !player.isDead()) ? player : plots.plotPoint(i, key);
            const dx = o.x - home.x, dy = o.y - home.y;
            const d = Math.hypot(dx, dy);
            if (d <= LEASH_RADIUS) continue;
            // Slide it back to the edge of its leash rather than snapping it
            // home, so a bot circling the learner is nudged, not teleported.
            const k = LEASH_RADIUS / d;
            o.x = home.x + dx * k;
            o.y = home.y + dy * k;
            if (o.velocity) { o.velocity.x *= 0.2; o.velocity.y *= 0.2; }
            plots.keepInPlot(o, i);
        }
    }
}

// Hold every learner inside their own arena, and out of its enemy base.
//
// The arena fence itself is NOT applied here: entity.confinementToTheseEarthly-
// Shackles() does it, using the same soft push the real room border uses, so
// the edge of the training ground feels like the edge of the real map instead
// of a snap-back. All this loop does is publish the bounds onto the body and
// keep the lethal base out of reach.
function tickBaseGuard() {
    for (let i = 0; i < owners.length; i++) {
        const socket = owners[i];
        const body = socket && socket.player && socket.player.body;
        if (!body || body.isDead()) continue;
        body.arenaBounds = plots.plotRect(i);
        plots.pushOutOfBase(body, i);
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
    plotInfo, talkPlotInfo,
    spawnDummy, spawnFighter, clearBots,
    lockUpgrades, unlockUpgrades, upgradeAllowed, morph,
    setAllowed, allows,
    setStats, grantPoints, teleport, setCommand,
    tickLeash, tickReap, tickBaseGuard,
    plotCount: plots.plotCount,
    plotPoint: plots.plotPoint,
};

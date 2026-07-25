// DIG WARS — mining power as HITS-TO-BREAK, not damage math.
//
// PvP damage is stock arras and stays that way; rocks use their own system:
// every projectile removes (barren rock HP / hits) per contact, where
// `hits` comes from the table below, keyed by the firing tank's class.
// So the table literally reads "how many hits does this tank need to break
// a plain rock" — no stat scaling, no per-projectile damage management.
//
// Ore rocks stack on top automatically (copper ×1.8, azurite ×2.2, shard
// ×3 health), as does the per-player mining budget (max 2 barren rocks of
// HP per second).
//
// Design ladder (fewer hits = better miner), anchored to real firepower:
//   monster single shots (annihilator 2, big cheese 2.2) > builder blocks
//   > launchers > snipers > traps > per-drone chips (overlord 8, director
//   10) > spam bullets (basic 10+) > swarm darts. A tank not listed falls
//   back to a default by projectile type.

const MINE_HITS = {
    // ── bullet lines ────────────────────────────────────────────────────
    // spam guns pay per-volume (each pellet is a sliver, throughput comes
    // from fire rate); heavy single shots crack rock like they crack tanks
    basic: 10, twin: 10, doubleTwin: 10, tripleTwin: 10, hewnDouble: 10,
    triplet: 9.5, tripleShot: 9.5, pentaShot: 9, spreadshot: 9,
    octoTank: 10, hexaTank: 10, flankGuard: 10, auto3: 10, auto5: 9.5,
    machineGun: 11, sprayer: 11, gunner: 12, autoGunner: 11.5,
    minigun: 10.5, streamliner: 11, nailgun: 12, atomizer: 11,
    triAngle: 10, fighter: 9.5, booster: 9.5, falcon: 9.5,
    sniper: 7, assassin: 6, hunter: 6.5, rifle: 7, marksman: 5.5,
    ranger: 5, stalker: 6, predator: 5.5, xHunter: 5.5, dual: 7,
    pounder: 4.5, eagle: 4, destroyer: 2.5, conqueror: 3, shotgun: 7,
    annihilator: 2, hybrid: 3, blower: 3.5,
    launcher: 4.5, skimmer: 4, twister: 4.5, rocketeer: 4, sidewinder: 5,
    fieldGun: 5, artillery: 6, mortar: 5.5, ordnance: 5.5,

    // ── trap lines (slow cycle → strong per block) ──────────────────────
    trapper: 7, triTrapper: 7.5, hexaTrapper: 8, septaTrapper: 8,
    megaAutoTrapper: 4.5, gunnerTrapper: 7.5, overtrapper: 7.5, autoTrapper: 7.5,
    tripleAutoTrapper: 7.5, beekeeper: 7,
    barricade: 6.5, fortress: 7,
    builder: 4, autoBuilder: 4.5, engineer: 4, boomer: 5.5,
    assembler: 4.5, architect: 4,
    construct: 2.4,   // "6/5ths of annihilator"

    // ── drone lines (each hit costs the drone; per-drone damage rules) ──
    director: 10, overseer: 9, overlord: 8, manager: 9, banshee: 9,
    autoOverseer: 9.5, autoDouble: 10.5, underseer: 10, necromancer: 10,
    maleficitor: 10, infestor: 9.5,
    factory: 8, autoSpawner: 9.5, spawner: 9,
    bigCheese: 2.2, fork: 9, hive: 10,
    // swarm launchers: fast-cycling clouds of tiny darts
    cruiser: 13, battleship: 13, carrier: 12.5, swarmer: 12,

    // ── smasher-adjacent / misc shooters ────────────────────────────────
    single: 9, deadeye: 6, revolver: 8, musket: 7, prodigy: 7.5,
};

// Unknown tank? Fall back by what actually hit the rock.
const MINE_HITS_DEFAULT = {
    bullet: 9,
    trap: 6.5,
    drone: 9,
    satellite: 9,
    swarm: 13,
};

// How many hits this projectile's tank needs for a barren rock.
// Walks the owner's definition chain so upgraded tanks resolve by their
// current class key (e.g. 'annihilator'), not what they spawned as.
function rockHitsFor(owner, projectile) {
    if (owner && Array.isArray(owner.defs)) {
        for (let i = owner.defs.length - 1; i >= 0; i--) {
            const d = owner.defs[i];
            if (typeof d === 'string' && MINE_HITS[d]) return MINE_HITS[d];
        }
    }
    return MINE_HITS_DEFAULT[projectile.type] || 9;
}

// Bullet-stat investment is the whole mining build: speed scales from
// 0.1× (nothing invested in damage/pen/health — near-zero chip damage) up
// to 1× (all three maxed). The table's hit counts are the maxed-build
// truth.
// skill.raw indices: 1 = bullet pen, 2 = bullet health, 3 = bullet damage.
function skillFactor(owner) {
    const raw = owner && owner.skill && owner.skill.raw;
    if (!raw) return 1;
    const cap = Config.skill_cap || 9;
    const invested = (raw[1] + raw[2] + raw[3]) / (3 * cap);
    return 0.1 + 0.9 * Math.min(1, invested);
}

// ── Body grinding: how ram tanks (and ram builds) mine ───────────────────
// Any tank with AT LEAST 1 point of body damage can grind rock with its
// hull; with zero points your hull is harmless to stone. Scaling is pure
// body damage, no per-tank table — seconds to grind a barren rock
// (rock-mining only, PvP body damage untouched). The divisor is expressed
// against the damage base; with rocks 1.3× tougher the REAL times on a
// barren rock are:
//   1 pt → 24s crawl · 6 pts → 4s · 9 pts (normal cap) → 2.7s ·
//   12 pts (smasher cap) → 2s
// Returns null when the hull can't mine at all.
// skill.raw index 6 = body damage.
function grindSecondsFor(owner) {
    const raw = owner && owner.skill && owner.skill.raw;
    const b = raw ? raw[6] : 0;
    if (!(b >= 1)) return null;
    return 18.5 / b;
}

module.exports = { rockHitsFor, skillFactor, grindSecondsFor, MINE_HITS, MINE_HITS_DEFAULT };

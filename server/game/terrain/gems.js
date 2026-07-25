// DIG WARS — the gem economy: ore bursts, pickups, the satchel, and
// drop-on-death. The life of a gem: mined → carried (dangerous) → banked
// (safe, later phase) → spent (later phase).
//
// Everything here runs off globals set up by the loader (Entity, Prop,
// TEAM_ROOM, ...) and is driven from the terrain loop in game/index.js.

const { ORE } = require('./terrainGrid.js');

// What one deposit pays, by tier. A rock pays out one gem PER visible
// crystal deposit in its face (see depositLayout in terrainGrid.js), at the
// crystal's exact spot — copper rocks carry 3-4 deposits, azurite 2-3,
// shard and emerald rocks a single big center crystal.
const DEPOSIT_VALUE = {
    [ORE.COPPER]:  15,
    [ORE.VEIN]:    30,
    [ORE.SHARD]:   150,  // one stone per shard rock
    [ORE.EMERALD]: 500,  // one huge stone per emerald rock — the jackpot
};
const SHARD_BIG = 150;  // shard rocks only hold the big stone now
const ORE_CLASS = {
    [ORE.COPPER]:  'gemPickupCopper',
    [ORE.VEIN]:    'gemPickupVein',
    [ORE.SHARD]:   'gemPickupShard',
    [ORE.EMERALD]: 'gemPickupEmerald',
};
// light table facet + white sparkle riding every pickup, so loot reads as a
// cut crystal instead of a flat polygon (same layered look as the rock-face
// markings — entity define() doesn't build PROPS, so attach them live)
const FACET_CLASS = {
    gemPickupCopper:      'gemFacetCopper',
    gemPickupVein:        'gemFacetVein',
    gemPickupShard:       'gemFacetShard',
    gemPickupShardCore:   'gemFacetShard',
    gemPickupEmerald:     'gemFacetEmerald',
    gemPickupEmeraldCore: 'gemFacetEmerald',
    gemPickupLoot:        'gemFacetLoot',
};

// Satchel tuning. Cap 4k — a long greedy run before banking. The speed
// penalty scales with the load up to −20% at a full satchel (never lower)
// so rich runners are visibly rich and visibly slower.
// NOTE: the satchel prop scaling and the client's full-blink detection both
// key off load = carried/cap, so they track any cap change automatically.
const SATCHEL_CAP  = 4000;
// With a tight 1.5k satchel cap, a 60% drop made kills pay peanuts next to
// farming — dying now spills nearly everything carried, so a fat runner is
// a genuinely worthwhile target (still economy-neutral: gems only move,
// they're never minted by kills).
const DEATH_DROP   = 0.85;  // fraction of carried gems dropped as pickups
// Dying also costs part of your BANKED dust — and it hits the floor as
// real loot, never just evaporating. Keeps the leader catchable.
const BANK_DEATH_LOSS = 0.4;
const MAGNET_BONUS = 110;   // flat world-unit reach on top of body size
const PICKUP_SLOP  = 0.6;   // fraction of the gem's size that may overlap

function spawnGem(x, y, value, cls, size, vx = 0, vy = 0) {
    const o = new Entity({ x, y });
    o.define(cls);
    o.team = TEAM_ROOM;
    o.isGemPickup = true;
    o.gemValue = value;
    o.coreSize = o.SIZE = size;
    o.velocity.x = vx;
    o.velocity.y = vy;
    // stagger the despawn so a pile doesn't vanish as one block; generous
    // lifetime — a gem quietly evaporating near a busy dig site reads as
    // "my pickup didn't count"
    o.RANGE = o.range = 5400 + Math.random() * 900;
    o.refreshBodyAttributes();
    // facet layers: light table + white sparkle, drawn above the body
    const facetCls = FACET_CLASS[cls];
    if (facetCls) {
        const facet = new Prop([10.5, 0, -1.2, 0, 1], o);
        facet.define(facetCls);
        const sparkle = new Prop([4, -2.2, -3.4, 12, 1], o);
        sparkle.define('gemSparkle');
    }
    return o;
}

// A broken ore rock pays out AT its crystals: one gem per deposit, at the
// deposit's exact spot and size. The puff drifts TOWARD whoever broke the
// rock — at the formation edge an outward puff used to nudge gems into
// crevices or open ground where they'd despawn unnoticed ("my first
// coppers didn't count").
function spawnOreBurst(rock, breaker) {
    if (!rock.ore) return;
    const cls = ORE_CLASS[rock.ore];
    const deposits = rock.deposits && rock.deposits.length
        ? rock.deposits
        : [{ wx: rock.wx, wy: rock.wy, wr: 9, big: false }];
    for (const d of deposits) {
        // shard rocks pay a premium on their big center stone; an emerald
        // rock holds a single huge stone that pays the full jackpot
        const value = d.big && rock.ore === ORE.SHARD ? SHARD_BIG : DEPOSIT_VALUE[rock.ore];
        const bigCls = rock.ore === ORE.EMERALD ? 'gemPickupEmeraldCore' : 'gemPickupShardCore';
        // pickups match their marking's size exactly — what you saw in the
        // rock is what lands in the crater
        const size  = Math.max(6, Math.min(34, d.wr));
        const ang   = breaker && breaker.x !== undefined
            ? Math.atan2(breaker.y - d.wy, breaker.x - d.wx)
            : (Math.atan2(d.wy - rock.wy, d.wx - rock.wx) || Math.random() * Math.PI * 2);
        spawnGem(d.wx, d.wy, value, d.big ? bigCls : cls, size,
                 Math.cos(ang) * 1.5, Math.sin(ang) * 1.5);
    }
}

function talkGems(body, delta) {
    if (body.socket) {
        body.socket.talk('GEM', body.carriedGems | 0, body.gemCap | 0, delta | 0,
                         (body.socket.gemBanked || 0) | 0);
    }
}

// The visible hoard: a gold crown-jewel gem centered on the hull. Grows
// with the load (sqrt so the first finds already show); the light facet
// rides on top for the cut-crystal look. The movement penalty is
// re-applied through refreshBodyAttributes.
function updateSatchel(body) {
    const p = body.gemHoardProp, f = body.gemHoardFacetProp;
    if (p) {
        const load = Math.min(1, (body.carriedGems || 0) / (body.gemCap || SATCHEL_CAP));
        // starts as a tiny chip on the first find and grows linearly to a
        // fat stone (full load clears the client's 0.89 blink threshold)
        const size = load > 0 ? 0.12 + 0.8 * load : 0;
        p.bound.size = size;
        if (f) f.bound.size = size * 0.52;
    }
    body.refreshBodyAttributes();
}

// Called on every fresh player body (and again on respawn). Attaches the
// hoard jewel props, the drop-on-death hook, and pushes the initial HUD
// state.
function initSatchel(body) {
    body.carriedGems ??= 0;
    body.gemCap = SATCHEL_CAP;
    // banked dust survives death: it lives on the socket, the body only
    // mirrors it for convenience
    if (body.socket) body.bankedGems = body.socket.gemBanked = body.socket.gemBanked || 0;
    if (!body.gemHoardProp) {
        // layer 1: the jewel sits ON TOP of hull and barrels, dead center.
        // Team-colored: blue wears emerald, red wears core-shard purple.
        const kind = body.team === TEAM_RED ? 'gemHoardShard' : 'gemHoardEmerald';
        const p = new Prop([0, 0, 0, 0, 1], body);
        p.define(kind);
        body.gemHoardProp = p;
        const f = new Prop([0, 0, -0.06, 0, 1], body);
        f.define(kind + 'Facet');
        body.gemHoardFacetProp = f;
        // define() clears the props map on every upgrade — re-register
        body.on('define', () => {
            if (body.gemHoardProp) body.props.set(body.gemHoardProp.id, body.gemHoardProp);
            if (body.gemHoardFacetProp) body.props.set(body.gemHoardFacetProp.id, body.gemHoardFacetProp);
        });
        body.on('dead', () => dropGemsOnDeath(body));
    }
    updateSatchel(body);
    talkGems(body, 0);
}

// Dying spills most of the satchel PLUS 40% of banked dust as gold loot
// pickups; the small carried remainder is destroyed with you. Everything
// lost from the bank lands on the floor — gems move, they're never minted
// or burned by kills. The pile scatters hard so the killer has to sweep.
function dropGemsOnDeath(body) {
    const carried = body.carriedGems | 0;
    // no socket = nothing to deduct from, so nothing extra may drop
    const banked  = body.socket ? (body.socket.gemBanked | 0) : 0;
    const bankLoss = Math.floor(banked * BANK_DEATH_LOSS);
    if (carried <= 0 && bankLoss <= 0) return;
    body.carriedGems = 0;
    if (bankLoss > 0 && body.socket) {
        body.socket.gemBanked = banked - bankLoss;
        body.bankedGems = body.socket.gemBanked;
    }
    updateSatchel(body);
    talkGems(body, -carried);
    const drop = Math.floor(carried * DEATH_DROP) + bankLoss;
    if (drop <= 0) return;
    // split into 3-8 uneven chunks — a lootable pile, not one mega-gem
    const n = Math.min(8, Math.max(3, Math.ceil(drop / 150)));
    const values = [];
    let left = drop;
    for (let i = n; i > 1; i--) {
        const v = Math.max(1, Math.round(left / i * (0.7 + Math.random() * 0.6)));
        values.push(Math.min(v, left - (i - 1)));
        left -= values[values.length - 1];
    }
    values.push(left);
    for (const v of values) {
        if (v <= 0) continue;
        const ang = Math.random() * Math.PI * 2;
        const sp  = 14 * (0.45 + Math.random() * 0.55);
        spawnGem(body.x, body.y, v, 'gemPickupLoot',
                 Math.max(6.5, Math.min(15, 4.5 + 1.1 * Math.sqrt(v))),
                 Math.cos(ang) * sp, Math.sin(ang) * sp);
    }
}

// Per-gem tick, run from the terrain loop. Rock walls are solid to loot,
// miners with room vacuum it in, and a FULL satchel actively shoves gems
// away — the world itself tells you to go bank.
function tickGem(gem, tg, players) {
    // gems collide with the rock: slide out along the face, and kill any
    // velocity still pointing into the wall so they rest against it clean
    const p = tg.pushCircleFromVoronoi(gem, gem.realSize);
    if (p.dx !== 0 || p.dy !== 0) {
        const pl = Math.hypot(p.dx, p.dy);
        const nx = p.dx / pl, ny = p.dy / pl;
        const vDot = gem.velocity.x * nx + gem.velocity.y * ny;
        if (vDot < 0) {
            gem.velocity.x -= vDot * nx;
            gem.velocity.y -= vDot * ny;
        }
    }
    // tunneling backstop: the face push only sees nearby edges, so a gem
    // cornered hard enough can get shoved clean THROUGH a face. If its
    // center ends up inside live rock, snap back to the last known safe
    // spot instead of ghosting through.
    if (tg.pointInRock(gem.x, gem.y)) {
        if (gem.gemSafeX !== undefined) {
            gem.x = gem.gemSafeX;
            gem.y = gem.gemSafeY;
        }
        gem.velocity.x = 0;
        gem.velocity.y = 0;
    } else {
        gem.gemSafeX = gem.x;
        gem.gemSafeY = gem.y;
    }

    if (!(gem.gemValue > 0)) return;

    let best = null, bestD = Infinity;
    for (const player of players) {
        const body = player.body;
        if (!body || body.isDead() || body.isGhost) continue;
        const dx = body.x - gem.x, dy = body.y - gem.y;
        const d = Math.hypot(dx, dy) || 1;
        const full = (body.carriedGems | 0) >= (body.gemCap | 0);
        if (full) {
            // full satchel: a firm bubble that shoves loot out of the way
            const repR = body.realSize * 1.8 + MAGNET_BONUS * 0.5;
            if (d < repR) {
                const push = (1 - d / repR) * 6;
                gem.velocity.x -= (dx / d) * push;
                gem.velocity.y -= (dy / d) * push;
            }
            continue;
        }
        if (d < bestD) { bestD = d; best = body; }
    }
    if (!best) return;

    const pickR = best.realSize + gem.realSize * PICKUP_SLOP;
    if (bestD <= pickR) {
        // collect: the last gem may overfill slightly (nothing is ever
        // silently lost at the cap boundary); "full" = carried >= cap
        const v = gem.gemValue;
        gem.gemValue = 0;
        best.carriedGems = (best.carriedGems | 0) + v;
        updateSatchel(best);
        talkGems(best, v);
        gem.kill();
        return;
    }

    const magR = best.realSize * 2.6 + MAGNET_BONUS;
    if (bestD < magR) {
        // velocity steering: ease toward the tank, faster the closer it gets
        const pull  = 1 - bestD / magR;
        const speed = 4 * pull + 22 * pull * pull;
        const ux = (best.x - gem.x) / bestD, uy = (best.y - gem.y) / bestD;
        gem.velocity.x += (ux * speed - gem.velocity.x) * 0.25;
        gem.velocity.y += (uy * speed - gem.velocity.y) * 0.25;
        // the crystal leans into the pull: pavilion point easing onto its
        // flight bearing (the GEM_CUT tip sits at +y in shape space, so the
        // facing is the bearing minus a quarter turn). Swift, not snappy —
        // each tick closes a slice of the remaining turn.
        const want = Math.atan2(uy, ux) - Math.PI / 2;
        let turn = want - gem.facing;
        while (turn >  Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        gem.facingType = 'manual';
        gem.facingTypeArgs = { angle: gem.facing + turn * 0.15 };
    } else if (gem.facingType !== 'spin') {
        // out of everyone's reach again — resume the lazy treasure spin
        gem.facingType = 'spin';
        gem.facingTypeArgs = { speed: 0.02 };
    }
}

// Loot keeps its personal space: any two overlapping gems shove each other
// apart, so payouts settle into readable clusters instead of a single
// blurred stack. Runs on the (small) list of live gems each terrain tick.
function separateGems(gemList) {
    for (let i = 0; i < gemList.length; i++) {
        const a = gemList[i];
        for (let j = i + 1; j < gemList.length; j++) {
            const b = gemList[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const min = (a.realSize + b.realSize) * 0.9;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const push = (min - d) / 2;
            const ux = dx / d, uy = dy / d;
            a.x -= ux * push; a.y -= uy * push;
            b.x += ux * push; b.y += uy * push;
        }
    }
}

module.exports = { spawnOreBurst, initSatchel, updateSatchel, dropGemsOnDeath, tickGem, separateGems, talkGems, SATCHEL_CAP };

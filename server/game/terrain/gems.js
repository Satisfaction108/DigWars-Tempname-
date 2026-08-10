

const { ORE } = require('./terrainGrid.js');

const DEPOSIT_VALUE = {
    [ORE.COPPER]:  15,
    [ORE.VEIN]:    30,
    [ORE.SHARD]:   150,  
    [ORE.EMERALD]: 500,  
};
const SHARD_BIG = 150;  
const ORE_CLASS = {
    [ORE.COPPER]:  'gemPickupCopper',
    [ORE.VEIN]:    'gemPickupVein',
    [ORE.SHARD]:   'gemPickupShard',
    [ORE.EMERALD]: 'gemPickupEmerald',
};

const FACET_CLASS = {
    gemPickupCopper:      'gemFacetCopper',
    gemPickupVein:        'gemFacetVein',
    gemPickupShard:       'gemFacetShard',
    gemPickupShardCore:   'gemFacetShard',
    gemPickupEmerald:     'gemFacetEmerald',
    gemPickupEmeraldCore: 'gemFacetEmerald',
    gemPickupLoot:        'gemFacetLoot',
};

const SATCHEL_CAP  = 4000;

const DEATH_DROP   = 0.85;  

const BANK_DEATH_LOSS = 0.4;
const MAGNET_BONUS = 110;
// A full gem radius of grab slack: at 0.6 a gem sliding past a moving tank
// could stay just outside the touch ring for its whole flyby, which read as
// "the gem passed straight through me".
const PICKUP_SLOP  = 1.0;

const GEM_MAX_SPEED = 6;

function spawnGem(x, y, value, cls, size, vx = 0, vy = 0) {
    const o = new Entity({ x, y });
    o.define(cls);
    o.team = TEAM_ROOM;
    o.isGemPickup = true;
    o.gemValue = value;
    o.coreSize = o.SIZE = size;
    o.velocity.x = vx;
    o.velocity.y = vy;
    
    
    
    o.RANGE = o.range = 5400 + Math.random() * 900;
    o.gemBornAt = Date.now();
    o.refreshBodyAttributes();
    
    const facetCls = FACET_CLASS[cls];
    if (facetCls) {
        const facet = new Prop([10.5, 0, -1.2, 0, 1], o);
        facet.define(facetCls);
        const sparkle = new Prop([4, -2.2, -3.4, 12, 1], o);
        sparkle.define('gemSparkle');
    }
    return o;
}

function spawnOreBurst(rock, breaker) {
    if (!rock.ore) return;
    const cls = ORE_CLASS[rock.ore];
    const deposits = rock.deposits && rock.deposits.length
        ? rock.deposits
        : [{ wx: rock.wx, wy: rock.wy, wr: 9, big: false }];
    for (const d of deposits) {
        
        
        const value = d.big && rock.ore === ORE.SHARD ? SHARD_BIG : DEPOSIT_VALUE[rock.ore];
        const bigCls = rock.ore === ORE.EMERALD ? 'gemPickupEmeraldCore' : 'gemPickupShardCore';
        
        
        const size  = Math.max(6, Math.min(34, d.wr));
        const ang   = breaker && breaker.x !== undefined
            ? Math.atan2(breaker.y - d.wy, breaker.x - d.wx)
            : (Math.atan2(d.wy - rock.wy, d.wx - rock.wx) || Math.random() * Math.PI * 2);
        const gem = spawnGem(d.wx, d.wy, value, d.big ? bigCls : cls, size,
                             Math.cos(ang) * 1.5, Math.sin(ang) * 1.5);
        if (gem && breaker && breaker.id !== undefined) gem.gemSourceId = breaker.id;
        // Reserve the drop for a player still working through the tutorial:
        // being sniped by a passing veteran mid-lesson is a miserable first
        // five minutes, and the tutorial explicitly asks them to collect THIS.
        if (gem && breaker) {
            let root = breaker, guard = 0;
            while (root.master && root.master !== root && guard++ < 8) root = root.master;
            if (root.inTutorial && root.id !== undefined) gem.gemOwnerId = root.id;
        }
    }
}

function talkGems(body, delta) {
    if (body.socket) {
        body.socket.talk('GEM', body.carriedGems | 0, body.gemCap | 0, delta | 0,
                         (body.socket.gemBanked || 0) | 0);
    }
}

function actorBody(actor) {
    return actor && actor.body ? actor.body : actor;
}

function bankedFor(body) {
    return body.socket ? (body.socket.gemBanked || 0) | 0 : (body.botBanked || 0) | 0;
}

function setBanked(body, amount) {
    amount = Math.max(0, Math.round(amount));
    if (body.socket) body.socket.gemBanked = amount;
    else body.botBanked = amount;
    body.bankedGems = amount;
    return amount;
}

function updateSatchel(body) {
    const p = body.gemHoardProp, f = body.gemHoardFacetProp;
    if (p) {
        const load = Math.min(1, (body.carriedGems || 0) / (body.gemCap || SATCHEL_CAP));
        // starts as a tiny chip on the first find and grows linearly to a
        
        const size = load > 0 ? 0.12 + 0.8 * load : 0;
        p.bound.size = size;
        if (f) f.bound.size = size * 0.52;
    }
    body.refreshBodyAttributes();
}

function initSatchel(body) {
    body.carriedGems ??= 0;
    body.gemCap = SATCHEL_CAP;
    
    
    body.botBanked ??= 0;
    if (body.socket) body.bankedGems = body.socket.gemBanked = body.socket.gemBanked || 0;
    else body.bankedGems = body.botBanked;
    if (!body.gemHoardProp) {
        
        
        const kind = body.team === TEAM_RED ? 'gemHoardShard' : 'gemHoardEmerald';
        const p = new Prop([0, 0, 0, 0, 1], body);
        p.define(kind);
        body.gemHoardProp = p;
        const f = new Prop([0, 0, -0.06, 0, 1], body);
        f.define(kind + 'Facet');
        body.gemHoardFacetProp = f;
        
        body.on('define', () => {
            if (body.gemHoardProp) body.props.set(body.gemHoardProp.id, body.gemHoardProp);
            if (body.gemHoardFacetProp) body.props.set(body.gemHoardFacetProp.id, body.gemHoardFacetProp);
        });
        body.on('dead', () => dropGemsOnDeath(body));
    }
    updateSatchel(body);
    talkGems(body, 0);
}

function dropGemsOnDeath(body) {
    const carried = body.carriedGems | 0;
    
    const banked  = bankedFor(body);
    const bankLoss = Math.floor(banked * BANK_DEATH_LOSS);
    // The death screen shows the wealth you had at the moment you died -
    // carried + banked BEFORE the drop. Snapshot it here because this runs
    // (on 'dead') before the death packet's records() is built.
    if (body.socket) {
        body.socket.gemDeathScore = carried + banked;
        // Snapshot the split too. records() reads body.carriedGems, which this
        // function zeroes a few lines down, so the death screen was always
        // reporting 0 carried. Banked is captured pre-loss so that the three
        // figures still add up: score = carried + banked.
        body.socket.gemDeathCarried = carried;
        body.socket.gemDeathBanked = banked;
    }
    if (carried <= 0 && bankLoss <= 0) return;
    body.carriedGems = 0;
    if (bankLoss > 0) setBanked(body, banked - bankLoss);
    updateSatchel(body);
    talkGems(body, -carried);
    const drop = Math.floor(carried * DEATH_DROP) + bankLoss;
    if (drop <= 0) return;
    
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

        const sp  = 1.6 * (0.45 + Math.random() * 0.55);
        const gem = spawnGem(body.x, body.y, v, 'gemPickupLoot',
                 Math.max(6.5, Math.min(15, 4.5 + 1.1 * Math.sqrt(v))),
                 Math.cos(ang) * sp, Math.sin(ang) * sp);
        // A player's death drop is reserved from BOTS for a grace window so
        // the player can run back for it. Other humans may take it freely.
        if (gem) gem.gemLootFromPlayer = !!body.socket;
    }
}

function tickGem(gem, tg, players) {
    
    
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
    
    
    
    
    if (tg.pointInRock(gem.x, gem.y)) {
        const safeStillOpen = gem.gemSafeX !== undefined && !tg.pointInRock(gem.gemSafeX, gem.gemSafeY);
        if (safeStillOpen) {
            gem.x = gem.gemSafeX;
            gem.y = gem.gemSafeY;
        } else {
            // Rock regrew over the last known open spot, so the gem has no
            // memory to fall back on and used to sit inside the boulder until
            // somebody mined it out. Walk outward for the nearest free ground.
            const now = Date.now();
            if (now - (gem.gemDigOutAt || 0) > 400) {
                gem.gemDigOutAt = now;
                const step = Math.max(18, gem.realSize * 2);
                let freed = false;
                for (let ring = 1; ring <= 6 && !freed; ring++) {
                    for (let i = 0; i < 12; i++) {
                        const a = (i / 12) * Math.PI * 2 + ring * 0.26;
                        const x = gem.x + Math.cos(a) * step * ring;
                        const y = gem.y + Math.sin(a) * step * ring;
                        if (tg.pointInRock(x, y)) continue;
                        gem.x = x; gem.y = y;
                        gem.gemSafeX = x; gem.gemSafeY = y;
                        freed = true;
                        break;
                    }
                }
            }
        }
        gem.velocity.x = 0;
        gem.velocity.y = 0;
    } else {
        gem.gemSafeX = gem.x;
        gem.gemSafeY = gem.y;
    }

    if (!(gem.gemValue > 0)) return;

    // Two separate questions: who is the gem flying toward (one actor, the
    // magnet), and who is actually touching it (anyone). They used to be the
    // same answer, so a gem reserved by a distant miner could not be picked up
    // by the player standing on top of it - it simply passed through them.
    let best = null, bestD = Infinity, bestScore = Infinity;
    let toucher = null, toucherD = Infinity;
    const bias = gem.chamberBias;
    for (const actor of players) {
        const body = actorBody(actor);
        if (!body || body.isDead() || body.isGhost) continue;
        // Bots keep their hands off a dead player's loot during the reclaim
        // window - no magnet, no pickup. Humans are unaffected.
        if (body.isBot && gem.gemLootFromPlayer &&
            Date.now() - (gem.gemBornAt || 0) < 15000) continue;
        const dx = body.x - gem.x, dy = body.y - gem.y;
        const d = Math.hypot(dx, dy) || 1;
        // A drop reserved for a tutorial player behaves toward everyone else
        // exactly like loot does around a full satchel: shoved away, never
        // collected. Trapping it or body-blocking it changes nothing.
        if (gem.gemOwnerId !== undefined && body.id !== gem.gemOwnerId) {
            const repR = body.realSize * 1.8 + MAGNET_BONUS * 0.5;
            if (d < repR) {
                const push = (1 - d / repR) * 1.5;
                gem.velocity.x -= (dx / d) * push;
                gem.velocity.y -= (dy / d) * push;
            }
            continue;
        }
        if (bias) {
            
            
            
            
            if (body.team === bias) {
                const repR = body.realSize * 1.8 + MAGNET_BONUS * 0.7;
                if (d < repR) {
                    const push = (1 - d / repR) * 1.5;
                    gem.velocity.x -= (dx / d) * push;
                    gem.velocity.y -= (dy / d) * push;
                }
                continue;
            }
        }
        const full = (body.carriedGems | 0) >= (body.gemCap | 0);
        if (full) {
            // full satchel: a firm bubble that shoves loot out of the way
            const repR = body.realSize * 1.8 + MAGNET_BONUS * 0.5;
            if (d < repR) {
                const push = (1 - d / repR) * 1.5;
                gem.velocity.x -= (dx / d) * push;
                gem.velocity.y -= (dy / d) * push;
            }
            continue;
        }
        const pickR = body.realSize + gem.realSize * PICKUP_SLOP;
        if (d <= pickR && d < toucherD) { toucherD = d; toucher = body; }
        // No ownership: loose gems belong to whoever is closest, full stop.
        // Every "breaker gets a head start" variant ended the same way - a
        // gem fleeing from the player standing on it toward the bot that
        // mined it, which felt like the gem had no collision at all.
        if (d < bestScore) { bestScore = d; bestD = d; best = body; }
    }

    if (toucher) {
        const v = gem.gemValue;
        gem.gemValue = 0;
        toucher.carriedGems = (toucher.carriedGems | 0) + v;
        updateSatchel(toucher);
        talkGems(toucher, v);
        gem.kill();
        return;
    }

    // hard ceiling: loot never outruns a tank - the shove bubbles above
    
    
    const spNow = Math.hypot(gem.velocity.x, gem.velocity.y);
    if (spNow > GEM_MAX_SPEED) {
        gem.velocity.x *= GEM_MAX_SPEED / spNow;
        gem.velocity.y *= GEM_MAX_SPEED / spNow;
    }
    if (!best) return;

    const magR = (best.realSize * 2.6 + MAGNET_BONUS) * (bias ? 1.45 : 1);
    if (bestD < magR) {
        
        
        const pull  = 1 - bestD / magR;
        const speed = 1.4 * pull + 4 * pull * pull;
        const ux = (best.x - gem.x) / bestD, uy = (best.y - gem.y) / bestD;
        gem.velocity.x += (ux * speed - gem.velocity.x) * 0.25;
        gem.velocity.y += (uy * speed - gem.velocity.y) * 0.25;
        // the crystal leans into the pull: pavilion point easing onto its
        
        
        
        const want = Math.atan2(uy, ux) - Math.PI / 2;
        let turn = want - gem.facing;
        while (turn >  Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        gem.facingType = 'manual';
        gem.facingTypeArgs = { angle: gem.facing + turn * 0.15 };
    } else if (gem.facingType !== 'spin') {
        // out of everyone's reach again - resume the lazy treasure spin
        gem.facingType = 'spin';
        gem.facingTypeArgs = { speed: 0.02 };
    }
}

module.exports = { spawnOreBurst, spawnGem, initSatchel, updateSatchel, dropGemsOnDeath, tickGem, talkGems, SATCHEL_CAP };

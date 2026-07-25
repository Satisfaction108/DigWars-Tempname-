# REGROWTH — Implementation Plan (Phase 3, "The Living Wall")

This is a complete, build-ready plan for the rock regrowth system in Dig Wars.
It is written for an implementer with no prior context: every file, structure,
message, constant, and edge case is spelled out. Read DESIGN.md and TASKS.md
(Phase 3) for flavor; **this file is the spec** and it supersedes the older
one-line task entries where they differ.

---

## 0. The one-paragraph version

Every destroyed rock cell grows back. ~35 seconds after a cell dies (faster —
down to a hard floor of 15s — for whichever side of the wall has more holes),
if at least one neighboring cell is alive, the rock **physically grows back
over ~7 seconds**: it expands outward from the cell's center, pushing tanks,
gems, and everything else out of its way, developing HP as it grows. Its ore
is **re-rolled every regrowth** (never the same rock twice). The rock body
finishes first; only then do ore crystals sprout on top. A growing rock can be
shot and killed prematurely — it dies like any rock but **pays out zero gems**,
and the regrow timer restarts. A player squeezed between rocks with nowhere to
be pushed is never teleported: they get slowly crushed, taking damage until
they escape through a gap or die. Mined emeralds respawn at fresh deep spots so
the arena always holds ~3. The "front line" pacing is **server-only** — no
client HUD, no marker, nothing rendered.

---

## 1. Existing architecture you must work inside

### 1.1 Server — `server/game/terrain/terrainGrid.js`
- `TerrainGrid` holds a lattice of Voronoi rock cells. Each cell is a record
  in `this.rocks` (a `Map` keyed by `k = vi * 100003 + vj`):
  `{ k, vi, vj, health, maxHealth, alive, ore, deposits, wx, wy }`.
- `buildVoronoiColliders()` (line ~451) builds every cell's clipped Voronoi
  polygon and pushes its edges as segments into `this._voronoiMap` (a spatial
  bucket hash). Segments carry a back-pointer `seg.rock`; every collision /
  hit query skips segments whose `seg.rock.alive` is false. **This is the
  load-bearing fact of the whole plan**: a dead cell's colliders still exist,
  they are just ignored — so regrowth never needs to rebuild `_voronoiMap`.
  Flipping `rock.alive = true` restores full-size collision instantly.
- `pointInRock`, `rockHitByCircle`, `pushCircleFromVoronoi`, `nearestRock` are
  the four queries the game loop uses. All respect `rock.alive`.
- `damageRock(rock, dmg, wx, wy, grind)` applies damage and queues a delta
  onto `this.rockEvents` (`{ k, h, d, o?, g?, x?, y? }`).
- Ore: `_oreTierFor(vi, vj, viLo, viHi)` rolls tier from depth +
  `_oreRoll(vi, vj, salt)` (integer avalanche hash). Emeralds are NOT rolled —
  exactly `EMERALD_COUNT = 3` cells are hand-picked in the deep band
  (depth ≥ 0.7, ≥6 cells apart, ranked by `_oreRoll(vi, vj, oreSalt + 13)`).
- Deposits: `TerrainGrid.depositLayout(...)` + `_dh` hash are **bit-identical
  mirrors** of the client's `_depositsFor` / `_h` — the crystal spots the
  client draws are exactly where the server spawns gems. Any new seed input
  (like a generation counter) must be added to BOTH sides identically.
- `rockStateSnapshot()` / `oreSnapshot()` ride the `TG` map snapshot for late
  joiners.
- `this._voroViLo/ViHi/VjLo/VjHi` bound the lattice block; `_voroRockSz` is
  lattice-to-grid scale; `viLo..viHi` midpoint is the wall's spine.

### 1.2 Server — `server/game/index.js` (terrain loop, ~line 567)
An 8ms `setInterval` that, per entity: slides/collects gems (`gems.tickGem`),
pushes tanks out of rock (`pushCircleFromVoronoi`) + body-grind mining, and
kills projectiles on rock contact (`rockHitByCircle`) with hits-table damage
(`mining.rockHitsFor` × `skillFactor`, per-player `mineBudget`). On destroy of
an ore cell it calls `gems.spawnOreBurst(rock, breaker)` and, for emerald,
`announceEmerald`. At the bottom it flushes `_tg.rockEvents` to every client
as a `TR` message. **All regrowth server logic slots into this same loop**
(with its own coarser cadence — see §3.6).

### 1.3 Client — `public/client/terrainRenderer.js`
- `init(cells, cols, rows, rockState, oreState, oreSalt)` ingests the `TG`
  snapshot; `applyRockEvents(events)` (line ~207) ingests `TR` deltas:
  `_rockHealth` map, `_rockDead` set, shatter FX, camera shake, and — on any
  destroy — `this._silClip = this._buildVoronoiBoundary()` (the rebuilt
  outer silhouette that excludes dead cells) plus `this.mapDirty = true`
  (minimap/full-map Path2D cache rebuild in app.js).
- Rocks are rendered by a GL shader (voronoi field) masked by `_silClip`;
  dead cells are excluded from the boundary so they read as craters. Damage
  cracks/pockmarks are 2D canvas overlays batched in `_damageBatch`.
- `_cellPolys` (key → `{poly (tile coords), cx, cy}`) already stores every
  cell's polygon client-side — the growth animation can be drawn from it
  directly, in 2D, without touching the shader.
- **The four mirrored Voronoi implementations (server JS, client CPU, client
  GLSL, map renderer) must stay bit-identical. Regrowth must not alter cell
  geometry anywhere — a growing cell is the SAME polygon, scaled visually
  around its centroid. Never re-derive or jitter the lattice.**

### 1.4 Client — `public/client/socketinit.js` / `app.js`
`TR` messages are parsed in socketinit and forwarded to
`terrainRenderer.applyRockEvents`. The maps in app.js (`getMapPaths`,
`drawWorldWindow`, corner minimap epoch cache) rebuild when
`terrainRenderer.mapDirty` flips — regrow completion must flip it too.

### 1.5 Gems — `server/game/terrain/gems.js`
`spawnOreBurst(rock, breaker)` spawns one pickup per `rock.deposits` entry.
Deposits are computed once in `buildVoronoiColliders`. For re-rolled ore the
deposits must be **recomputed at regrow time** (see §3.4).

---

## 2. Decisions (locked)

| # | Decision |
|---|----------|
| D1 | Base regrow delay: **35s** after a cell's death. |
| D2 | Rubber band (server-only "front line"): the side of the wall with more holes regrows faster. `delay = clamp(35 − 0.3 × max(0, myGaps − theirGaps), 15, 35)` seconds. (2 vs 2 → 35s each; 37 vs 2 → ~24.5s for the 37-hole side; hard floor 15s, never lower.) Evaluated **live** each pacing tick, not frozen at death time. |
| D3 | Eligibility: a dead cell may only start regrowing if **≥1 of its 4 lattice neighbors (vi±1, vj±1) is a living rock** (inside the block bounds). Regrowth creeps in from the living wall; holes in the middle of a big excavation heal last, from the edges inward. If ineligible when its timer fires, it re-checks each pacing tick until a neighbor lives. |
| D4 | Growth duration: **7.0s**, animated (expanding), NOT a fade. |
| D5 | Ore is **re-rolled on every regrowth** via a per-cell generation counter mixed into the existing ore hash — deterministic, but different each life. Emeralds are never part of the roll (they respawn by placement, §3.5). |
| D6 | Rock body grows first (0 → ~100% over 7s); ore crystals grow **after** the body completes (staggered pop-in, client-only flourish). |
| D7 | HP develops with growth: `health = maxHealth × max(0.15, easeGrowth(p))`. A growing rock is damageable and killable the whole time. |
| D8 | Premature kill (death before growth completes): **zero gems**, even if the roll was ore — no `spawnOreBurst`, no emerald announcement. The cell dies normally and its regrow timer restarts (with a fresh generation → fresh roll next time). |
| D9 | The growing rock **pushes everything** (tanks, minions, minibosses, gems) out radially. Entities are never teleported through solid rock. An entity that cannot be pushed out (squeezed) is **entombed**: hard push stops, it moves freely (so it can slip out through gaps/borders), and it takes crush damage of **6% of its max health per second** until it exits or dies. |
| D10 | Depth hardness (old task 18): **dropped**. Not part of this build. |
| D11 | Front line (old task 20): **server-only pacing input**. No client HUD marker, no message, no rendering of any kind. |
| D12 | Emerald respawn: when an emerald cell is destroyed (fully grown, paid out), a replacement emerald is planted in a **fresh deterministic deep spot** ~60s later, keeping ~3 in the wall at all times. |
| D13 | Base zones / originally-empty grid cells never grow rock. Only cells that were part of the original lattice block (`this.rocks`) participate. |

Easing (shared constant on both sides, but only the server's output matters
for gameplay — see §3.3): `easeGrowth(p) = p*p*(3-2*p)` (smoothstep — slow
start, fast middle, gentle landing). The client may layer juice on top
(overshoot), but collision and HP use smoothstep of real elapsed time.

---

## 3. Server implementation

All server work lives in `terrainGrid.js` (state + math) and the terrain loop
in `server/game/index.js` (ticking + integration), mirroring how mining is
already split.

### 3.1 New per-rock state (terrainGrid.js)

Extend the rock record created in `buildVoronoiColliders`:

```js
rock.gen        = 0;      // regrowth generation (0 = original boot roll)
rock.growing    = false;  // true while expanding
rock.growStart  = 0;      // Date.now() when growth began
rock.diedAt     = 0;      // Date.now() when it was destroyed (0 = alive)
rock.worldPoly  = poly.map(p => [p[0]*rockSz*cellSize - halfW,
                                 p[1]*rockSz*cellSize - halfH]);
rock.worldCx / rock.worldCy = centroid of worldPoly;  // NOT the seed wx/wy —
    // the seed can sit off-center; push math needs the true centroid
```

`worldPoly` is computed once at boot from the same `poly` the segments are
built from (it's in scope in the builder loop). Memory: ~1500 cells × ~8 pts —
trivial.

Grid-level state on the TerrainGrid instance:

```js
this.growEvents = [];        // regrow deltas for TR (merged with rockEvents flush)
this._spineMid  = (viLo + viHi) / 2;   // save in buildVoronoiColliders
this._pendingEmeralds = [];  // [{at: timestamp}] queued replacements
```

### 3.2 The cell lifecycle (state machine)

```
ALIVE ──(health ≤ 0, damageRock)──▶ DEAD
DEAD ──(elapsed ≥ sideDelay AND ≥1 living 4-neighbor)──▶ GROWING
GROWING ──(7s elapsed)──▶ ALIVE (full HP, ore active)
GROWING ──(health ≤ 0)──▶ DEAD (no gems, gen already advanced, timer restarts)
```

Concretely:

**On death** (inside `damageRock` when `destroyed`): set
`rock.diedAt = Date.now()`, `rock.growing = false`. If it died *while
growing*, suppress the ore payout flag: add `ev.p = 1` (premature) to the
destroy delta so the caller in index.js knows to skip `spawnOreBurst` — see
§3.7. (Cleanest wiring: `damageRock` returns `destroyed`, and index.js checks
`rock.growing` **before** calling damageRock, or damageRock stamps
`rock._prematureKill = true`; pick one and keep the gem-skip in index.js where
`spawnOreBurst` already lives.)

**Start of growth** — new method `startRegrow(rock, now)`:

```js
rock.gen++;                                  // new life, new roll
rock.growing   = true;
rock.growStart = now;
rock.diedAt    = 0;
rock.alive     = false;                      // ← stays false! see §3.3
rock.ore       = this._rollRegrownOre(rock); // §3.4
rock.maxHealth = ROCK_HEALTH * ORE_HP[rock.ore];
rock.health    = rock.maxHealth * 0.15;      // HP floor at spawn
rock.deposits  = rock.ore ? <recompute, §3.4> : null;
this.growEvents.push({ k: rock.k, r: 1, o: rock.ore, gen: rock.gen });
```

(`ORE_HP` is currently a local const inside `buildVoronoiColliders` — hoist it
to module scope so `startRegrow` can use it.)

**Completion** — when `now - rock.growStart >= GROW_MS (7000)`:

```js
rock.growing = false;
rock.alive   = true;          // full-size colliders snap back on
rock.health  = rock.maxHealth;
this.growEvents.push({ k: rock.k, r: 2 });
// then the entity-eviction sweep, §3.9
```

### 3.3 Collision & damage during growth — the scaled-polygon pass

`rock.alive` stays **false** during growth so every existing query
(`pointInRock`, `rockHitByCircle`, `pushCircleFromVoronoi`, `nearestRock`)
keeps ignoring the cell at full size — a 20%-grown rock must not block bullets
or bodies at its full-size boundary. Instead, growing cells get a dedicated
pass with the polygon scaled around the centroid:

```js
growthScale(rock, now) = 0.12 + 0.88 * easeGrowth(clamp((now - rock.growStart)/7000, 0, 1))
// starts at 12% (a visible nub, immediately shootable), reaches 1.0 at 7s
scaledPoly(rock, s) = worldPoly.map(([x,y]) =>
    [rock.worldCx + (x - rock.worldCx) * s, rock.worldCy + (y - rock.worldCy) * s])
```

Add three helpers to TerrainGrid (straightforward geometry, use the
point-in-poly / dist-to-edge routines already written in `depositLayout` as
reference — factor them out rather than duplicating):

- `growingRocks()` → cached array of rocks with `rock.growing` (rebuild the
  cache when the set changes; typical count is small, < 40).
- `growingRockHitByCircle(x, y, r, now)` → the first growing rock whose
  *scaled* polygon the circle overlaps (centroid-distance prefilter first:
  skip if `dist > r + rock.maxPolyRadius` — precompute `maxPolyRadius` at
  boot). Used by the projectile branch.
- `pushCircleFromGrowing(entity, r, now)` → for each nearby growing rock
  whose scaled poly overlaps the entity circle: compute the push-out vector
  (from centroid through entity position to the scaled edge + r). Returns
  `{ dx, dy, entombed }` — see the squeeze rules below.

**Performance budget:** the terrain loop runs at 8ms. Growing rocks are few;
prefilter by centroid distance and only run polygon math within
`maxPolyRadius + entityR`. Do NOT insert scaled segments into `_voronoiMap`
(that would mean per-tick spatial-hash churn) — the small brute-force list is cheaper.

**Push rules (the anti-teleport contract):**

1. Compute the desired push-out along `(entity − centroid)` normalized (if the
   entity sits exactly on the centroid, pick the direction toward the nearest
   scaled-poly edge). Cap displacement per terrain tick to
   `MAX_PUSH_PER_TICK = cellWorldSize * 0.06` — growth is slow, so per-tick
   push is small; the cap prevents launch-catapults at high growth speed.
2. After applying the push, run the standard `pushCircleFromVoronoi(entity,
   r)` (living full rocks) **and** re-test other growing rocks. If the
   combined resolution leaves the entity still overlapping the growing poly —
   it is squeezed between this rock and something solid — **revert to its
   pre-push position** and mark it entombed this tick.
3. Entombed tick: no hard push at all (the entity moves freely under its own
   control, letting it walk out through any gap or along the rock border), and
   it takes crush damage: `entity.health.amount -= entity.health.max * 0.06 *
   (tickMs / 1000)`. Inspect how the engine applies damage (search entity.js
   for how `health.amount` is modified and whether a `damageBy`/killer
   attribution exists) — attribute the kill to the environment (no killer),
   and confirm the death message path tolerates a killer-less death. Respect
   the existing exemptions in the loop head (`noclip`, `godmode`,
   `isArenaCloser` are already skipped before this code runs).
4. Velocity cancellation along the push normal, exactly like the existing
   full-rock push does (lines ~587-594 of index.js) — otherwise entities
   jitter against the growing face.
5. Gems (`isGemPickup`): pushed with the same routine (they're in the same
   entity sweep, in the gems branch — add the growing-push after
   `gems.tickGem`). Gems never take crush damage; if a gem ends up inside a
   *completed* rock, the existing gem slide-out logic (`tickGem` already
   slides gems out of rock via the voronoi push) handles it the next tick.
6. Projectiles: in the projectile branch, after the existing full-rock check
   misses, call `growingRockHitByCircle`. On hit: identical treatment to a
   live rock — mining damage via `damageRock`, budget spend, freeze + kill the
   projectile. The hits-table damage applies to the growing rock's
   *current* `health` (which is scaled — so early-growth rocks die to a
   single hit, by design).
7. Body grinding: `rockHitByCircle(instance.x, instance.y, r * 1.06)` in the
   grind branch misses growing rocks; extend it with a
   `growingRockHitByCircle` fallback so rammers can also shave a growing rock.

### 3.4 Ore re-roll (deterministic, per generation)

New method on TerrainGrid:

```js
_rollRegrownOre(rock) {
    // same depth-banded tier logic as _oreTierFor, but the roll salt mixes
    // the generation so every life is a different (still deterministic) roll
    // → refactor _oreTierFor to accept a salt offset instead of duplicating:
    //   _oreTierFor(vi, vj, viLo, viHi, saltExtra = 0) using
    //   this.oreSalt + 11 + saltExtra  and  ... + 12 + saltExtra
    return this._oreTierFor(rock.vi, rock.vj, this._voroViLo, this._voroViHi,
                            rock.gen * 7919);   // prime stride, no collisions
}
```

Emeralds are excluded automatically (they're placed, not rolled — a regrown
former-emerald cell rolls like any deep cell: shard-chance at best).

**Deposits must be regenerated** with the generation mixed into the layout
hash, or every regrown life would put crystals at identical spots:

- Server: in `startRegrow`, rebuild `rock.deposits` by re-running the same
  deposit block that `buildVoronoiColliders` runs (factor that block into a
  private method `_buildDeposits(rock, poly, rockSz)` — the tile-space poly
  can be recovered from `worldPoly` by inverting the world transform, or
  simpler: also store `rock.tilePoly`/`tileCx/tileCy` at boot). The layout
  closure becomes:
  `h = (i, s) => TerrainGrid._dh(i, kk, (s + this.oreSalt + rock.gen * 7919) | 0)`
- Client: `_depositsFor` in terrainRenderer.js builds the mirror closure —
  add the same `+ gen * 7919` term, with per-cell generation arriving over the
  wire (§3.7). Generation defaults to 0 everywhere so all boot-time behavior
  is byte-identical to today. **These two closures must stay bit-identical —
  this is the only mirrored-math change in the whole feature.**

### 3.5 Emerald respawn

In `damageRock`, when a destroyed rock has `ore === ORE.EMERALD` **and was
fully grown** (not premature), push `{ at: Date.now() + 60_000 }` onto
`this._pendingEmeralds`.

In the pacing tick (§3.6), for each due entry: pick the replacement cell
deterministically —

- Candidates: alive, not growing, `ore === ORE.NONE`, depth ≥ 0.7 (same
  formula as the boot placement), ≥6 lattice cells from every *current*
  emerald cell (alive-or-growing with `ore === EMERALD`).
- Rank by `this._oreRoll(vi, vj, this.oreSalt + 13 + <emerald respawn
  counter> * 104729)` — a counter incremented per respawn keeps picks
  deterministic-but-fresh. Take the lowest score.
- Mutate: `rock.ore = ORE.EMERALD`; scale HP proportionally
  (`rock.maxHealth = ROCK_HEALTH * 6; rock.health = min(rock.health /
  oldMax, 1) * rock.maxHealth`); rebuild deposits (emerald layout = single
  big center stone). Emit `{ k, e: 1 }` in growEvents so clients start
  drawing the emerald vein + aura on that cell (client: set `_ore`, clear
  `_veinCache` for the key, small "vein revealed" glint — see §4.5).
- If no candidate qualifies (wall obliterated), retry next pacing tick.

### 3.6 The pacing tick (front line, timers, completion)

Do NOT run regrow bookkeeping at 8ms. Inside the existing terrain loop add a
gated block: `if (nowT - this._lastRegrowTick >= 500) { ... }` (2Hz). Each
pacing tick:

1. **Gap census.** Iterate `this.rocks`: count dead-and-not-growing cells per
   side (`vi < this._spineMid` = one side, `vi > this._spineMid` = other; a
   cell exactly on an odd-width spine counts toward neither). Which side is
   blue's vs red's does not matter to the formula — each side's delay uses
   its own deficit vs the other. Verify orientation once against
   `roomSetup`/`teams.js` (blue base is on the low-vi side in the current
   map) and leave a comment, but the math is symmetric.
2. **Delays.** `delayFor(side) = clamp(35_000 − 300 * max(0, gaps[side] −
   gaps[other]), 15_000, 35_000)` (D2; 0.3s per hole of deficit).
3. **Starts.** For each dead cell (`!alive && !growing && diedAt > 0`):
   if `nowT - diedAt >= delayFor(sideOf(cell))` and the D3 neighbor check
   passes (`rocks.get((vi±1)*100003+vj)?.alive || rocks.get(vi*100003+vj±1)
   ?.alive` — growing neighbors do NOT count, only fully alive), call
   `startRegrow`. A cell whose timer is up but has no living neighbor just
   waits; it starts on the first tick a neighbor completes.
4. **Completions.** For each growing cell past 7000ms: complete (§3.2), then
   the eviction sweep (§3.9).
5. **Emerald respawns** (§3.5).
6. **HP tracking while growing.** Each pacing tick, raise a growing rock's
   *ceiling*: `target = maxHealth * max(0.15, easeGrowth(p))`; set
   `rock.health = min(target, rock.health + (target − lastTarget))` — i.e.
   the rock gains the HP the growth curve added, but damage taken is never
   healed back (track `rock._lastGrowTarget`). Simpler equivalent: store
   `damageTaken` accumulated during growth and compute
   `health = target − damageTaken`, dying when ≤ 0. Choose the second — it's
   cleaner and makes the "no heal" property obvious.

Between pacing ticks, the per-tick (8ms) work is ONLY: the scaled-poly
push/entomb/projectile pass from §3.3, using `growthScale` computed on the
fly (cheap: one smoothstep per growing rock per tick).

### 3.7 Protocol (TR channel — extend, don't add a channel)

Flush `growEvents` together with `rockEvents` in the existing TR broadcast
(concat before `JSON.stringify`). New event shapes, all keyed by `k`:

| Event | Shape | Meaning |
|---|---|---|
| Regrow start | `{ k, r: 1, o: tier, gen }` | begin 7s growth anim; remember tier + generation |
| Regrow done | `{ k, r: 2 }` | snap to fully-grown state (authoritative resync) |
| Emerald plant | `{ k, e: 1 }` | living cell becomes the emerald cell |
| Destroy (existing) | `{ k, h: 0, d: 1, o? }` | unchanged; **during growth the server omits `o` and skips `spawnOreBurst`** (D8) so clients also skip the ore-colored shatter and gem expectations |

Damage deltas on growing rocks reuse the existing `{ k, h, x, y }` shape —
`h` is `health / maxHealth` as always; the client draws impact sparks with the
same code path.

**Snapshot (late joiners):** `rockStateSnapshot()` currently emits
`{ k, h, d }` for damaged/destroyed rocks. Extend:
- growing cell → `{ k, h, d: 0, r: <elapsed ms>, o: tier, gen }`
- destroyed cell → unchanged `{ k, h: 0, d: 1 }`
- any cell with `gen > 0` that is alive+ore → include `gen` so the client's
  deposit mirror uses the right seed: `{ k, h, gen }` (and `oreSnapshot()`
  gains nothing — it already pairs key/tier; but the client needs `gen` per
  ore cell, so ride it in rockStateSnapshot as above even at full health).
- The emerald cell set can change at runtime now; `oreSnapshot()` already
  reflects live `rock.ore`, so late joiners are automatically correct.

### 3.8 No-gems-when-premature (D8) — exact wiring

In index.js, both destroy sites (grind ~line 630, projectile ~line 673)
currently do `if (destroyed && rock.ore) gems.spawnOreBurst(...)`. Change
both to `if (destroyed && rock.ore && !wasGrowing)` where `wasGrowing` is
captured from `rock.growing` **before** the `damageRock` call. Also gate the
emerald announcement identically. In `damageRock`, when a growing rock dies,
also clear the destroy delta's `o` field (§3.7) and reset
`rock.growing = false; rock.diedAt = Date.now()` so the timer restarts.

### 3.9 Completion eviction sweep

At the instant a rock completes, anything still overlapping its full polygon
must not be trapped silently INSIDE a now-solid rock (the entombed-damage rule
only ran while it was "growing"). On completion, run one final overlap check
over nearby entities: any tank/minion/miniboss still inside keeps the entombed
treatment — the standard queries (`pointInRock`) now return this rock, and the
existing full-rock push in the loop will shove them to the nearest face; if
that push can't resolve (fully enclosed), they must keep taking crush damage.
**Implementation:** give entities an `entombedUntil`-style flag set by either
the growing pass or a `pointInRock(entity.x, entity.y)`-inside condition in
the tank branch of the terrain loop; while flagged, skip velocity-cancel hard
push (rule 3 of §3.3) and apply crush DPS. This single mechanism covers both
"squeezed by growth" and "sealed inside a finished rock" — and it's also the
long-promised fix for TASKS item 17 (Crush).

### 3.10 Constants (top of terrainGrid.js, one block)

```js
const REGROW = {
    BASE_DELAY_MS:   35_000,
    MIN_DELAY_MS:    15_000,
    DEFICIT_MS_PER_GAP: 300,
    GROW_MS:          7_000,
    START_SCALE:      0.12,
    HP_FLOOR:         0.15,
    CRUSH_DPS_FRAC:   0.06,   // of victim max health, per second
    MAX_PUSH_PER_TICK_FRAC: 0.06,  // of cell world size
    PACING_MS:        500,
    EMERALD_RESPAWN_MS: 60_000,
};
```

---

## 4. Client implementation (`public/client/terrainRenderer.js` + app.js)

### 4.1 State

```js
this._growing = new Map();  // key -> { start: performance.now(), tier, gen }
this._gen     = new Map();  // key -> generation (for the deposit hash mirror)
```

`applyRockEvents` additions:
- `ev.r === 1`: `_rockDead.delete(k)`; `_growing.set(k, {start: now, tier:
  ev.o, gen: ev.gen})`; `_gen.set(k, ev.gen)`; if `ev.o` set `_ore.set(k,
  ev.o)` and purge `_veinCache` for k; purge crack/pock/bite/frac caches for
  k (fresh rock = fresh face); `_rockHealth.set(k, 0.15)`. Do **not** rebuild
  the silhouette yet — the cell stays out of `_silClip` while growing (it's
  drawn separately, §4.3).
- `ev.r === 2`: `_growing.delete(k)`; `_rockHealth.set(k, 1)`; mark a
  **throttled** silhouette rebuild (see 4.4); `this.mapDirty = true`
  (crater→rock on both maps); completion flourish (§4.5).
- destroy delta on a growing key: `_growing.delete(k)`, `_rockDead.add(k)`,
  run a **muted collapse** effect (≈30% of the normal shatter particle count,
  no hit-stop, no camera shake, no ore coloring — it was a husk, and D8 means
  no gems will arrive) instead of the full `_spawnShatter` celebration.
- `ev.e === 1` (emerald plant): `_ore.set(k, 4)`, purge `_veinCache[k]`,
  brief reveal glint at the cell (reuse the ore-glint sparkle already drawn
  for veins, just triggered once, bigger).
- Snapshot path (`init`): entries with `r` populate `_growing` with
  `start = now − ev.r` (elapsed rides the snapshot); entries with `gen`
  populate `_gen`.

### 4.2 Deposit hash mirror (the one mirrored-math change)

In `_depositsFor` (or wherever the client builds the layout closure with
`_h(i, kk, s + oreSalt)`), thread the generation:
`s + oreSalt + (this._gen.get(k) || 0) * 7919`. Must match §3.4 exactly.
Verify with a temporary parity harness if in doubt: log `deposits` for one
regrown cell server-side and client-side and diff — then delete the logging.

### 4.3 The growth rendering — make it look INSANE (but game-themed)

Growing cells are excluded from the shader/silhouette and drawn as 2D canvas
polygons on top of the floor, using `_cellPolys.get(k)` scaled around
`(cx, cy)` by the same `0.12 + 0.88 * smoothstep(p)` — matching server
collision so what you see IS what pushes you. On top of the base scale, add a
client-only **elastic settle**: for the last 15% of growth, overlay
`scaleVis = scale * (1 + 0.05 * sin((p−0.85)/0.15 * π) * (1−p))` — a ~4%
overshoot-and-settle wobble. Collision doesn't overshoot; visual does. Nobody
will feel a 4% one-frame disagreement, and the landing reads ALIVE.

Timeline per cell (all times from `growStart`):

| Window | Effect |
|---|---|
| −0.0s (on `r:1` receipt) | **Telegraph:** the crater floor rumbles — 6-8 deterministic pebbles (reuse `_pebbles` particle system) jitter and slide toward the centroid; a soft dark ring pulses twice at the cell footprint (stroke of the full-size poly at alpha ~0.12). Skip entirely if off-screen (`_onScreen`). |
| 0 → 7s | **The rise:** fill the scaled poly with the rock body look. Match the shader's tone by sampling the same fills the damage/crack overlays already use — flat dark basalt fill + the standard edge stroke (reuse the silhouette edge width 0.072/0.11 rockSz strokes so it's indistinguishable from shader rock at a glance). Draw the growing poly with a slight upward-shadow: a 2-3px darker rim on the bottom-right (light comes from vec2(0,−1) with per-cell jitter — reuse the cell's hash angle so the lit side matches the shader when it snaps in). |
| continuous | **Grind dust:** every ~120ms, 2-3 small dust puffs + rock chips spawn at random points ON the scaled poly's edge (deterministic via `_h(k, tick)`), drifting outward and fading in ~400ms — the ground being displaced. Reuse the impact-spark particle shape from `_impacts`, tinted dusty gray. Cap: if more than ~12 cells grow on-screen simultaneously, halve the emission (perf guard). |
| continuous | **Tremble:** apply `_trembleOf(k, now)` × 1.5 to the drawn poly position — the rock strains as it grows. |
| damage while growing | Existing crack overlays keyed by `_rockHealth` already draw per stage — clip them to the *scaled* poly so cracks ride the growing face correctly (pass the scale into the damage-batch draw for growing keys, or simpler: draw growing cells' cracks immediately after the growing poly, outside `_damageBatch`, since growing cells are few). |
| 7.0s (`r:2`) | **Landing:** one camera micro-shake (amount 3, 160ms) if on-screen; a bright rim flash tracing the full poly (stroke, alpha 0.7 → 0 over 250ms); a ring of 10-14 dust chips bursting outward (half the shatter particle budget, inverted feel — birth, not death); silhouette rebuild folds the cell back into the shader. |
| 7.0 → 8.2s (ore cells only) | **Ore sprouts (D6):** each deposit crystal scales 0 → full with a 0.3s pop, staggered 150ms apart (order by deposit index), each landing with a white glint tick (reuse the vein glint). Emerald deposits additionally ramp the aura in over 1s. Implementation: draw the vein art with a per-deposit scale factor during this window, then fall back to the cached `_veinCache` path. |

Where to draw: inside the renderer's main `draw()`, after the shader blit and
before the damage overlays (growing rocks are ground-level rock, damage rides
on top). All effects must be deterministic per cell (seeded by `k` and tick
index via `_h`) — every client sees the same birth.

### 4.4 Silhouette rebuild throttling

`_buildVoronoiBoundary()` is called per destroy already; completions can
cluster (rubber-banded side catching up = several per second). Add a rebuild
coalescer: on `r:2`, set `this._silRebuildAt = min(existing, now + 120)`;
in `draw()`, if `now >= _silRebuildAt`, rebuild once and clear. Destroys keep
their immediate rebuild (a hole appearing late looks like lag; a rock face
snapping into the shader 100ms late is invisible behind the landing flash).
`mapDirty` needs no throttle (map Path2D rebuild is already epoch-cached in
app.js).

### 4.5 Maps (app.js) — nothing new to build

`getMapPaths` / `drawWorldWindow` / the corner minimap already rebuild off
`terrainRenderer.mapDirty` and treat dead cells as craters. Regrow completion
flips `mapDirty` (§4.1) and the cell reads as rock again. Growing cells count
as **craters** on maps until complete (no per-frame map animation — cheap and
honest: you can't hide behind it until it's real). Emerald plant events don't
touch maps (ores aren't shown on maps by design).

### 4.6 Explicit non-goals on the client

- No front-line HUD, marker, bar, or announcement of any kind (D11).
- No shader changes. The GLSL voronoi field is untouched; growth is 2D-canvas
  drawn on top and the cell only re-enters the shader mask when fully grown.
  (This is what keeps the 4 mirrored voronoi implementations identical.)
- No sound work (sound system is globally disabled).

---

## 5. Edge cases — handle every one

1. **Killed at 99% grown** → still premature: no gems (D8). The rule is
   binary on `rock.growing`, no partial payouts.
2. **Damage during growth outpacing HP gain** → `health = target −
   damageTaken ≤ 0` → dies mid-growth (handled by §3.6.6's damage-accumulator
   formulation; make sure `damageRock` works against growing rocks'
   `maxHealth` fraction for the `h` delta so client cracks look right).
3. **Player standing dead-center on the cell when growth starts** → the 12%
   nub spawns under them; push moves them outward each tick. If they fight
   the push inward, they stay overlapping → entombed rule → crush damage.
   They can always shoot the nub dead (it has 15% HP early).
4. **Two adjacent cells growing toward each other with a player between** →
   pushed by both; when the gap closes below their diameter, push can't
   resolve → entombed → crush until they slide out along the seam or die.
   Verify no oscillation: the "revert position + free movement" rule (§3.3.3)
   prevents ping-pong.
5. **Entity sealed inside a completed rock** → §3.9 eviction sweep +
   `pointInRock` entombed handling; crush continues until escape/death. NEVER
   teleport to the nearest face.
6. **Gem pickup in the path of growth** → pushed like everything else; if
   sealed at completion, the existing gem slide-out in `tickGem` (voronoi
   push) walks it to the face — acceptable (gems are small and slippery).
7. **Projectile spawned inside a growing rock** (long barrel poking in) →
   `growingRockHitByCircle` in the projectile branch kills it exactly like
   the full-rock path does today.
8. **Late joiner mid-growth** → snapshot `r: elapsed` (§3.7); client resumes
   the animation at the right point; if elapsed ≥ 7000 arrives stale, treat
   as fully grown.
9. **Regrow timer fires while every neighbor is dead** → waits (D3), re-checks
   at 2Hz; a fully-excavated region heals strictly from its edges inward.
10. **Corner/edge lattice cells** with fewer than 4 in-block neighbors →
    out-of-block neighbors count as dead (they're not in `this.rocks`); the
    guaranteed in-block neighbor keeps them regrowable.
11. **Emerald cell mined premature after regrow?** Impossible by construction:
    emerald cells regrow as normal rolls (D5/D12); emerald respawn plants on
    *living* cells only.
12. **Emerald destroyed while its replacement is pending** → each destroy
    queues one pending entry; the census in §3.5 spaces new picks ≥6 cells
    from current emerald cells, so counts stay ~3 (never enforce a hard cap —
    transient 2 or 4 during the 60s windows is fine).
13. **`nearestRock` (idle drones chew rock)** → returns only `alive` rocks;
    leave as-is (drones ignoring growing nubs is fine and avoids drone
    thrash).
14. **Vault pads / base tiles** → bases were never inside the lattice block
    (D13); no rock can grow in a base. Verify once with the map bounds.
15. **Server perf** → growing set is bounded by dead-cell count; pacing at
    2Hz; per-8ms-tick growing work is centroid-prefiltered polygon tests
    only. Budget: with 40 growing cells and 16 players + bullets, target
    < 0.5ms per tick added. Measure with a temporary `console.time` during
    the playtest, then remove it.
16. **`_lastTrickle`, `_hitFlash`, `_crackSnap`, `_bites`, `_fracCache`
    residue from the previous life** → all purged on `r:1` (§4.1) so no
    ghost cracks from the old rock haunt the new one.

---

## 6. Build order (do it in this sequence, testable at every step)

1. **Server state + lifecycle, no pacing:** rock record fields, `startRegrow`,
   completion, fixed 10s delay + 2s growth (dev-speed constants), `alive`
   flip, `damageRock` premature handling, TR events, snapshot extension.
   Test: break a rock; watch TR traffic; confirm it becomes solid again
   (walk into the invisible wall — client not built yet, that's expected).
2. **Client minimal:** parse `r:1/r:2`, draw the scaled poly (flat fill only,
   no juice), silhouette rebuild + mapDirty on complete. Test: watch a rock
   visibly grow, block movement matching visuals, maps flip crater→rock.
3. **Growing collision pass:** push, entomb, crush, projectile hits, grind
   fallback, completion eviction. Test with two browser tabs: stand in the
   way, get pushed; wall yourself in, confirm crush damage and escape.
4. **Ore re-roll + deposits generation mirror + no-gems-premature.** Test:
   break the same cell twice; different ore/no-ore across lives; premature
   kill drops nothing; full growth then break pays at crystal spots exactly.
5. **Pacing:** real constants, gap census, rubber band, D3 eligibility.
   Test: dig 30 holes on one side, 2 on the other; log per-side delays.
6. **Emerald respawn.** Test: mine an emerald, confirm a new aura cell
   appears deep in the wall ~60s later, ≥6 cells from the others.
7. **The juice (§4.3 full timeline)** — telegraph, dust, tremble, landing,
   ore sprout stagger. Tune until it looks unreasonable.
8. Flip dev-speed constants back to REGROW values. Update TASKS.md: check
   items 15-17/19-20, note 18 dropped, and note item 17 (Crush) landed as the
   entomb rule.

## 7. Acceptance checklist (the playtest script)

- [ ] Rock destroyed → regrows ~35s later over ~7s, visibly expanding (not
      fading), pushing a tank standing on it smoothly out.
- [ ] Regrown cell's ore differs across lives; deposits sit where crystals
      are drawn (bank a copper from a regrown cell — values still exact).
- [ ] Kill a rock at ~50% growth → no gems, muted collapse, regrows again
      later with a different roll.
- [ ] Squeeze yourself between two growing rocks → steady health drain, no
      teleport, no cross-wall pop-through; escape through the seam ends the
      drain; staying kills you with a clean death (no crash on killer-less
      death).
- [ ] Dig one side heavily → that side's holes visibly refill faster; single
      isolated deep holes wait for neighbors before healing.
- [ ] Nothing about the front line is visible client-side.
- [ ] Mine an emerald → replacement appears at a fresh deep spot in ~60s;
      ticker still fires on the mined one only.
- [ ] Late joiner during heavy regrowth sees mid-growth rocks at the correct
      sizes and correct veins.
- [ ] Corner minimap + full map flip crater→rock only on completion.
- [ ] 16-player-scale bullet spam against a regrowing face: no server tick
      degradation, no client FPS cliff (12+ simultaneous growths on-screen).

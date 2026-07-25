const CELL = { BASALT: 0, EMPTY: 1 };

const { basePolygonHealth } = require('../../lib/definitions/constants.js');
// Mining damage and the per-second budget are fractions of the DAMAGE BASE
// (the long-standing tuned value), while actual rock hp is that base times
// ROCK_TOUGHNESS. Raising toughness makes every rock take proportionally
// more hits — per-shot damage and the per-second cap stay exactly where
// they were. Rocks never heal.
const ROCK_DAMAGE_BASE = 0.75 * 0.7 * 0.75 * 562.5 * basePolygonHealth;
const ROCK_TOUGHNESS = 1.3;
const ROCK_HEALTH = ROCK_TOUGHNESS * ROCK_DAMAGE_BASE;

// Ore tiers riding inside rock cells. The tier is what the cell pays when
// broken; deeper rock rolls richer tiers (copper at the face, gem veins in
// the middle, core shards only near the wall's spine).
const ORE = { NONE: 0, COPPER: 1, VEIN: 2, SHARD: 3, EMERALD: 4 };
const ORE_CHANCE = 0.22;   // ~22% of cells carry ore
// Emeralds are placed, not rolled: exactly this many per arena, always in
// the deepest band of the wall, seeded per boot off oreSalt.
const EMERALD_COUNT = 3;

// Richer rock is tougher rock: ore cells take more chewing before they pay
// out, so a shard find is a commitment, not a snack. (Module scope so the
// regrowth path can re-tier a rock's health when its ore is re-rolled.)
const ORE_HP = { [ORE.NONE]: 1, [ORE.COPPER]: 1.8, [ORE.VEIN]: 2.2,
                 [ORE.SHARD]: 3, [ORE.EMERALD]: 6 };

// ─── THE LIVING WALL ─────────────────────────────────────────────────────
// Every hole in the wall closes again. A destroyed cell waits, then GROWS
// back over a few seconds — expanding from its own centre, shoving anything
// standing there out of the way, hardening as it goes. Nothing about it is
// cosmetic: the growing stone collides, takes damage, and can be killed
// before it finishes (in which case it pays nothing — it was never ore yet).
const REGROW = {
    BASE_DELAY_MS:      35_000, // a hole's grace period before it heals
    MIN_DELAY_MS:       15_000, // hard floor, no matter how far behind a side is
    DEFICIT_MS_PER_GAP:    300, // the losing side heals faster, per hole of deficit
    GROW_MS:             7_000, // how long the rise takes
    START_SCALE:          0.12, // visible, shootable nub the instant it starts
    HP_FLOOR:             0.15, // fraction of max hp a fresh nub carries
    CRUSH_DPS_FRAC:       0.06, // of a trapped victim's max health, per second
    MAX_PUSH_PER_TICK:    0.06, // fraction of a lattice cell, per terrain tick
    PACING_MS:             500, // bookkeeping cadence (NOT the 8ms terrain tick)
    EMERALD_RESPAWN_MS: 60_000, // a mined emerald reappears elsewhere, deep
    ORE_GEN_STRIDE:       7919, // prime salt stride per regrowth generation
};

// Smoothstep: slow to break ground, quick through the middle, gentle landing.
// Both the collision scale and the drawn scale ride this exact curve.
function easeGrowth(p) { return p * p * (3 - 2 * p); }

class TerrainGrid {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = new Uint8Array(cols * rows).fill(CELL.BASALT);
        this.cellSize = 1;

        // Populated by buildContour():
        this._contourSegs   = null; // flat segment array [{ax,ay,bx,by,edx,edy,nx,ny,len,_tick}]
        this._contourMap    = null; // spatial bucket Map
        this._contourBucket = 1;
        this._contourTick   = 0;   // GC-free seen-dedup counter
        this._boundary      = null; // Uint8Array: 1 = solid cell adjacent to empty
        // Populated by buildVoronoiColliders() (called from buildContour):
        this._voronoiMap    = null;
        this._voronoiBucket = 1;
        this._voronoiTick   = 0;
        // Destructible rock state: key (vi*100003+vj) -> rock record
        this.rocks      = new Map();
        this.rockEvents = [];
        // ── Living wall (regrowth) ──
        this.growEvents  = [];      // regrow deltas, flushed with rockEvents on TR
        this._growing    = [];      // rocks currently rising (tiny list, scanned per tick)
        this._spineMid   = 0;       // lattice mid-column: the wall's spine
        this._pendingEmeralds  = [];// [{ at }] queued emerald replacements
        this._emeraldRespawns  = 0; // counter salting each replacement pick
        this._lastRegrowTick   = 0;
        this._regrowDelay = [REGROW.BASE_DELAY_MS, REGROW.BASE_DELAY_MS]; // per side
        // Per-boot ore salt: rolled once at startup and mixed into the ore
        // tier rolls AND the deposit layout, so ore cells and crystal spots
        // land differently every server run. Rides the TG snapshot so the
        // client's mirrored layout math stays in lockstep.
        this.oreSalt = 1 + ((Math.random() * 0x7ffffffe) | 0);   // pending {k, h, d} deltas for broadcast
        // Mining pace: each player may remove at most one rock's worth of
        // HP per second (see the mining budget in the terrain loop).
        // the damage/budget base — deliberately NOT the toughened hp, so
        // per-hit damage and the mining cap don't scale with toughness
        this.baseRockHealth = ROCK_DAMAGE_BASE;
    }

    get(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return CELL.EMPTY;
        return this.cells[row * this.cols + col];
    }

    set(col, row, type) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
        this.cells[row * this.cols + col] = type;
    }

    isSolid(col, row) { return this.get(col, row) === CELL.BASALT; }

    serialize() { return Array.from(this.cells); }

    worldToCell(worldX, worldY) {
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        return {
            col: Math.floor((worldX + halfW) / this.cellSize),
            row: Math.floor((worldY + halfH) / this.cellSize),
        };
    }

    getCellWorldBounds(col, row) {
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        const cs    = this.cellSize;
        const minX  = col * cs - halfW;
        const minY  = row * cs - halfH;
        return { minX, maxX: minX + cs, minY, maxY: minY + cs,
                 cx: minX + cs / 2, cy: minY + cs / 2 };
    }

    circleOverlapsCells(cx, cy, radius) {
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        const cs    = this.cellSize;
        const c0 = Math.floor((cx - radius + halfW) / cs);
        const c1 = Math.floor((cx + radius + halfW) / cs);
        const r0 = Math.floor((cy - radius + halfH) / cs);
        const r1 = Math.floor((cy + radius + halfH) / cs);
        const hits = [];
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (!this.isSolid(c, r)) continue;
                const cellMinX = c * cs - halfW;
                const cellMinY = r * cs - halfH;
                const nearX = Math.max(cellMinX, Math.min(cx, cellMinX + cs));
                const nearY = Math.max(cellMinY, Math.min(cy, cellMinY + cs));
                const dx = cx - nearX, dy = cy - nearY;
                if (dx * dx + dy * dy <= radius * radius) hits.push({ col: c, row: r });
            }
        }
        return hits;
    }

    raycastCells(ox, oy, dirX, dirY, maxDist) {
        if (maxDist <= 0) return [];
        const len = Math.hypot(dirX, dirY);
        if (len === 0) return [];
        const ndx = dirX / len, ndy = dirY / len;
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        const cs    = this.cellSize;
        let col = Math.floor((ox + halfW) / cs);
        let row = Math.floor((oy + halfH) / cs);
        const stepCol = ndx > 0 ? 1 : ndx < 0 ? -1 : 0;
        const stepRow = ndy > 0 ? 1 : ndy < 0 ? -1 : 0;
        const cellLeft = col * cs - halfW, cellTop = row * cs - halfH;
        let tMaxX = stepCol === 0 ? Infinity : stepCol > 0 ? (cellLeft + cs - ox) / ndx : (cellLeft - ox) / ndx;
        let tMaxY = stepRow === 0 ? Infinity : stepRow > 0 ? (cellTop  + cs - oy) / ndy : (cellTop  - oy) / ndy;
        const tDeltaX = stepCol === 0 ? Infinity : cs / Math.abs(ndx);
        const tDeltaY = stepRow === 0 ? Infinity : cs / Math.abs(ndy);
        const hits = []; let t = 0;
        while (t <= maxDist) {
            if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) break;
            if (this.isSolid(col, row)) hits.push({ col, row, t });
            if (tMaxX < tMaxY) { if (tMaxX > maxDist) break; t = tMaxX; col += stepCol; tMaxX += tDeltaX; }
            else               { if (tMaxY > maxDist) break; t = tMaxY; row += stepRow; tMaxY += tDeltaY; }
        }
        return hits;
    }

    // ─── Contour builder ───────────────────────────────────────────────────────
    // Replicates the client's _buildContours + _jag pipeline so the server
    // collision boundary exactly matches the rendered silhouette.
    buildContour() {
        const { cols, rows, cellSize } = this;
        const halfW = cols * cellSize / 2, halfH = rows * cellSize / 2;
        const solid = (c, r) =>
            c >= 0 && c < cols && r >= 0 && r < rows && this.cells[r * cols + c] === 0;

        // ── Step 1: walk grid edges into raw loops ────────────────────────────
        // Each edge is stored as [ax, ay, bx, by] (in cell coords).
        // Winding: EMPTY is always to the LEFT of the edge direction.
        const edges = [], startMap = new Map();
        const addE = (ax, ay, bx, by) => {
            const i = edges.length / 4;
            edges.push(ax, ay, bx, by);
            const k = `${ax},${ay}`;
            let arr = startMap.get(k); if (!arr) { arr = []; startMap.set(k, arr); }
            arr.push(i);
        };
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!solid(c, r)) continue;
                if (!solid(c,   r-1)) addE(c,   r,   c+1, r  );
                if (!solid(c+1, r  )) addE(c+1, r,   c+1, r+1);
                if (!solid(c,   r+1)) addE(c+1, r+1, c,   r+1);
                if (!solid(c-1, r  )) addE(c,   r+1, c,   r  );
            }
        }
        const numEdges = edges.length / 4;
        const used = new Uint8Array(numEdges);
        const rawLoops = [];
        for (let i = 0; i < numEdges; i++) {
            if (used[i]) continue;
            const pts = [];
            let cur = i;
            while (cur !== -1 && !used[cur]) {
                used[cur] = 1;
                pts.push([edges[cur*4], edges[cur*4+1]]);
                const ex = edges[cur*4+2], ey = edges[cur*4+3];
                const cand = startMap.get(`${ex},${ey}`);
                let nxt = -1;
                if (cand) for (const j of cand) { if (!used[j]) { nxt = j; break; } }
                cur = nxt;
            }
            if (pts.length >= 3) rawLoops.push(pts);
        }

        // ── Step 2: remove collinear vertices (simplify) ──────────────────────
        const simplified = rawLoops.map(loop => {
            const n = loop.length, out = [];
            for (let i = 0; i < n; i++) {
                const p = loop[(i-1+n)%n], q = loop[i], s = loop[(i+1)%n];
                const d1x = q[0]-p[0], d1y = q[1]-p[1];
                const d2x = s[0]-q[0], d2y = s[1]-q[1];
                if (d1x*d2y - d1y*d2x !== 0 || d1x*d2x + d1y*d2y <= 0) out.push(q);
            }
            return out.length >= 3 ? out : loop;
        });

        // ── Step 3: smooth-clip loop — exact replica of client _smoothClipLoop ──
        // Pins all 4 map borders, 6-pass Laplacian smooth, every-3rd subsample,
        // then pushes top/bottom near-border points outside the grid with jagOut.
        // That outward push is what turns the sharp 90° map-edge corner into a
        // smooth diagonal bevel: the segment from the last side-edge vertex to the
        // first pushed-outside vertex is a short diagonal whose normal gradually
        // rotates, matching exactly what _silClip looks like on the client.
        const Hh = (x, y, s) => {
            let v = (Math.imul(x+1, 374761393) ^ Math.imul(y+1, 1284865837) ^
                     Math.imul((s|0)+1, 668265263)) | 0;
            v = Math.imul(v ^ (v >>> 13), 1540483477);
            v ^= v >>> 15;
            return (v >>> 0) / 0x100000000;
        };
        const jagOut = (x, seed) => {
            const blk = Math.floor(x / 5);
            return 1 + Math.round(Hh(blk, seed, 60) * 2 + Hh(blk, seed + 7, 60) * 1);
        };
        const smoothClipLoop = (loop) => {
            const n = loop.length;
            let pts = [];
            for (let i = 0; i < n; i++) {
                const A = loop[i], B = loop[(i+1)%n];
                const dx = B[0]-A[0], dy = B[1]-A[1];
                const steps = Math.max(1, Math.round(Math.hypot(dx, dy)));
                for (let k = 0; k < steps; k++)
                    pts.push([A[0]+dx*(k/steps), A[1]+dy*(k/steps)]);
            }
            const m = pts.length;
            if (m < 4) return loop;
            // pin all 4 map borders (identical to client _smoothClipLoop)
            const pin = pts.map(p => p[0] <= 0 || p[0] >= cols || p[1] <= 0 || p[1] >= rows);
            // 6-pass Laplacian smooth, pinned points fixed
            for (let pass = 0; pass < 6; pass++) {
                const np = pts.slice();
                for (let i = 0; i < m; i++) {
                    if (pin[i]) continue;
                    const a = pts[(i-1+m)%m], b = pts[i], c = pts[(i+1)%m];
                    np[i] = [a[0]*0.25+b[0]*0.5+c[0]*0.25, a[1]*0.25+b[1]*0.5+c[1]*0.25];
                }
                pts = np;
            }
            // subsample every 3rd point then push top/bottom border points outside
            // the grid — same as client — so the corner becomes a diagonal bevel
            // rather than a horizontal-then-vertical 90° kink
            const out = [];
            for (let i = 0; i < m; i += 3) {
                let x = pts[i][0], y = pts[i][1];
                if (x > 0.5 && x < cols - 0.5) {
                    if      (y <= 0.5)        y = -jagOut(Math.round(x), 0);
                    else if (y >= rows - 0.5) y =  rows + jagOut(Math.round(x), 1);
                }
                out.push([x, y]);
            }
            return out.length >= 3 ? out : loop;
        };

        // ── Step 4: convert to world-coord segments with outward normals ──────
        // Edge winding: EMPTY on LEFT → outward normal = RIGHT perpendicular of
        // edge direction = (dy/len, -dx/len).
        const segs = [];
        for (const loop of simplified.map(smoothClipLoop)) {
            const n = loop.length;
            for (let i = 0; i < n; i++) {
                const a = loop[i], b = loop[(i+1)%n];
                const ax = a[0]*cellSize - halfW, ay = a[1]*cellSize - halfH;
                const bx = b[0]*cellSize - halfW, by = b[1]*cellSize - halfH;
                const dx = bx-ax, dy = by-ay, len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                segs.push({
                    ax, ay, bx, by,
                    edx: dx/len, edy: dy/len,
                    nx: dy/len, ny: -dx/len,
                    len, _tick: 0,
                });
            }
        }

        // ── Step 5: spatial bucket hash ───────────────────────────────────────
        const BUCKET = cellSize * 4;
        const smap = new Map();
        for (const seg of segs) {
            const x0 = Math.min(seg.ax, seg.bx), x1 = Math.max(seg.ax, seg.bx);
            const y0 = Math.min(seg.ay, seg.by), y1 = Math.max(seg.ay, seg.by);
            const c0 = Math.floor(x0/BUCKET), c1 = Math.floor(x1/BUCKET);
            const r0 = Math.floor(y0/BUCKET), r1 = Math.floor(y1/BUCKET);
            for (let bc = c0; bc <= c1; bc++) {
                for (let br = r0; br <= r1; br++) {
                    const k = bc * 997 + br;
                    let arr = smap.get(k); if (!arr) { arr = []; smap.set(k, arr); }
                    arr.push(seg);
                }
            }
        }

        // ── Step 6: precompute boundary cell bitmask ──────────────────────────
        // Boundary cells = solid cells with at least one empty orthogonal neighbour.
        // The contour collision handles these; grid-cell collision skips them.
        const boundary = new Uint8Array(cols * rows);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!solid(c, r)) continue;
                if (!solid(c-1,r) || !solid(c+1,r) || !solid(c,r-1) || !solid(c,r+1))
                    boundary[r*cols+c] = 1;
            }
        }

        this._contourSegs   = segs;
        this._contourMap    = smap;
        this._contourBucket = BUCKET;
        this._boundary      = boundary;

        this.buildVoronoiColliders();
    }

    // ─── Voronoi hash (matches client CPU + GPU seed texture exactly) ────────
    // Final values quantised to 8 bits — the client uploads the same values
    // as a texture so the shader never disagrees with collision.
    _hash2(i, j) {
        const f32 = Math.fround;
        let px = f32(f32(i) * f32(5.3983));
        px = f32(px - Math.floor(px));
        let py = f32(f32(j) * f32(5.4427));
        py = f32(py - Math.floor(py));
        const d = f32(f32(py * f32(f32(px) + f32(21.5351))) + f32(f32(px) * f32(f32(py) + f32(14.3137))));
        px = f32(px + d); py = f32(py + d);
        const pxy = f32(px * py);
        let rx = f32(pxy * f32(95.4307)); rx = f32(rx - Math.floor(rx));
        let ry = f32(pxy * f32(97.597));  ry = f32(ry - Math.floor(ry));
        rx = f32(f32(0.5) + f32(f32(rx - f32(0.5)) * f32(0.55)));
        ry = f32(f32(0.5) + f32(f32(ry - f32(0.5)) * f32(0.55)));
        return [Math.round(rx * 255) / 255, Math.round(ry * 255) / 255];
    }

    // Deterministic per-cell ore roll (integer avalanche hash, independent of
    // the float seed hash so ore layout never couples to cell shape).
    _oreRoll(vi, vj, s) {
        let h = (Math.imul(vi + 1, 374761393) ^ Math.imul(vj + 1, 1284865837) ^
                 Math.imul((s | 0) + 1, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1540483477);
        h ^= h >>> 15;
        return (h >>> 0) / 0x100000000;
    }

    // Ore tier for a lattice cell. depth is 0 at the carved wall faces and 1
    // at the wall's vertical spine — the risk gradient IS the depth gradient:
    // copper lives where it's safe, shards live at dead center where everyone
    // is farthest from home. Copper stays the common sight at every depth;
    // azurite is a mid-depth find and shards are a deep rarity, so blue and
    // purple actually feel special when they turn up.
    // saltExtra shifts the whole roll: regrown cells pass their generation in
    // so a cell that came back is a genuinely different cell — barren stone
    // one life, a copper seam the next. Deterministic either way.
    _oreTierFor(vi, vj, viLo, viHi, saltExtra = 0) {
        if (this._oreRoll(vi, vj, this.oreSalt + 11 + saltExtra) >= ORE_CHANCE) return ORE.NONE;
        const halfSpan = Math.max(1, (viHi - viLo) / 2);
        const depth = Math.min(vi - viLo, viHi - vi) / halfSpan; // 0 face → 1 spine
        const t = this._oreRoll(vi, vj, this.oreSalt + 12 + saltExtra);
        // fractions tuned against the 22% ore roll; the trailing NONE slices
        // trim copper to 3/4 of its former density without touching azurite
        // (~7.5% mid/deep) or shards (~2.6% of deep cells) — the jackpot
        // stays a jackpot
        if (depth <= 0.40) return t < 0.75 ? ORE.COPPER : ORE.NONE;
        if (depth <= 0.75) return t < 0.35 ? ORE.VEIN : t < 0.8375 ? ORE.COPPER : ORE.NONE;
        return t < 0.08 ? ORE.SHARD : t < 0.45 ? ORE.VEIN : t < 0.8625 ? ORE.COPPER : ORE.NONE;
    }

    // ─── Ore deposit layout (MIRRORED — see _depositsFor in
    // public/client/terrainRenderer.js; both must stay bit-identical) ────────
    // Every ore cell holds a handful of discrete crystal DEPOSITS at fixed
    // spots inside the cell polygon. The client draws a crystal marking at
    // each spot; when the rock breaks, the server spawns exactly one gem
    // pickup per deposit AT that spot with the matching size — what you saw
    // in the rock face is literally what pops out of it.
    //
    // Works in renderer TILE coordinates (lattice × rockSz) so both sides run
    // the same float ops on the same numbers. h(i, s) = the shared avalanche
    // hash closed over the cell key: (i, s) => hash(i, kk, s).
    static depositLayout(tier, poly, cx, cy, rockSz, h) {
        const want  = tier === 4 ? 1
                    : tier === 3 ? 1
                    : tier === 2 ? 2 + (h(0, 220) < 0.5 ? 0 : 1)
                    :              3 + (h(0, 220) < 0.5 ? 0 : 1);
        const baseR = (tier === 4 ? 0.14 : tier === 3 ? 0.15 : tier === 2 ? 0.16 : 0.13) * rockSz;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        const inPoly = (x, y) => {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i][0], yi = poly[i][1];
                const xj = poly[j][0], yj = poly[j][1];
                if ((yi > y) !== (yj > y) &&
                    x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        };
        const distToBorder = (x, y) => {
            let best = Infinity;
            for (let i = 0; i < poly.length; i++) {
                const a = poly[i], b = poly[(i + 1) % poly.length];
                const dx = b[0] - a[0], dy = b[1] - a[1];
                const L2 = dx * dx + dy * dy || 1e-12;
                const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
                const ddx = x - (a[0] + t * dx), ddy = y - (a[1] + t * dy);
                const d = ddx * ddx + ddy * ddy;
                if (d < best) best = d;
            }
            return Math.sqrt(best);
        };

        const out = [];
        // the core-shard / emerald crystal sits dead center — a neat,
        // glowing anchor (emerald cuts the largest stone of all)
        if (tier === 3 || tier === 4) {
            out.push({ x: cx, y: cy, r: (tier === 4 ? 0.34 : 0.30) * rockSz,
                       rot: (h(1, 221) - 0.5) * 0.7, big: true });
        }
        for (let t = 0; t < 40 && out.length < want; t++) {
            const x = minX + h(t, 222) * (maxX - minX);
            const y = minY + h(t, 223) * (maxY - minY);
            if (!inPoly(x, y)) continue;
            if (distToBorder(x, y) < baseR * 1.5) continue;
            let ok = true;
            for (const d of out) {
                const dx = x - d.x, dy = y - d.y;
                const need = (d.r + baseR) * 1.7;
                if (dx * dx + dy * dy < need * need) { ok = false; break; }
            }
            if (!ok) continue;
            out.push({ x, y, r: baseR * (0.85 + h(t, 224) * 0.3),
                       rot: (h(t, 225) - 0.5) * 0.9, big: false });
        }
        return out;
    }

    // The shared avalanche hash the deposit layout runs on — identical to the
    // client's _h(x, y, s) in terrainRenderer.js.
    static _dh(x, y, s) {
        let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 1284865837) ^
                 Math.imul((s | 0) + 1, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1540483477);
        h ^= h >>> 15;
        return (h >>> 0) / 0x100000000;
    }

    // ─── Per-Voronoi-cell collision builder ───────────────────────────────────
    // Exact JS port of the fragment shader's hash2 + Sutherland-Hodgman clipping.
    // Stored in _voronoiMap (separate from _contourMap) so the outer silhouette
    // is never touched.
    //
    // Edge inclusion uses the same shader nearest-seed query on both sides of the
    buildVoronoiColliders() {
        const { cols, rows, cellSize } = this;
        const halfW  = cols * cellSize / 2, halfH = rows * cellSize / 2;
        const rockSz = cols / 50.0;
        const hash2 = (i, j) => this._hash2(i, j);

        const clip = (poly, mx, my, ndx, ndy) => {
            const out = [], n = poly.length;
            for (let i = 0; i < n; i++) {
                const [ax, ay] = poly[i], [bx, by] = poly[(i+1) % n];
                const da = (ax-mx)*ndx + (ay-my)*ndy;
                const db = (bx-mx)*ndx + (by-my)*ndy;
                if (da <= 0) out.push([ax, ay]);
                if ((da < 0) !== (db < 0)) {
                    const t = da / (da - db);
                    out.push([ax + t*(bx-ax), ay + t*(by-ay)]);
                }
            }
            return out;
        };

        let maxLeft = 0, minRight = cols - 1, minLeft = cols, maxRight = 0;
        for (let r = 0; r < rows; r++) {
            let le = 0; while (le < cols && !this.isSolid(le, r)) le++;
            let re = cols - 1; while (re >= 0 && !this.isSolid(re, r)) re--;
            if (le < cols) { if (le > maxLeft) maxLeft = le; if (le < minLeft) minLeft = le; }
            if (re >= 0)   { if (re < minRight) minRight = re; if (re > maxRight) maxRight = re; }
        }
        const vxMin = maxLeft / rockSz;
        const vxMax = (minRight + 1) / rockSz;

        // Square arrangement: rocks are exactly the Voronoi lattice cells
        // whose index falls inside the square — a rectangular block of cells.
        // The border follows straight lattice lines with only the natural
        // cell-shape wiggle, so nothing sticks out and nothing is missing.
        const viLo = Math.round(vxMin), viHi = Math.round(vxMax) - 1;
        const vjLo = 0,                 vjHi = Math.round(rows / rockSz) - 1;

        // Saved for point-in-rock queries (pointInRock / circleHitsRock)
        this._voroRockSz = rockSz;
        this._voroViLo = viLo; this._voroViHi = viHi;
        this._voroVjLo = vjLo; this._voroVjHi = vjHi;
        // the wall's spine: everything left of it is one side's frontier,
        // everything right of it the other's (regrowth pacing, §front line)
        this._spineMid = (viLo + viHi) / 2;
        this._cellWorld = rockSz * cellSize;   // world units across one lattice cell
        this._growing.length = 0;
        this.growEvents.length = 0;
        this._pendingEmeralds.length = 0;

        const BUCKET = this._contourBucket;
        const vmap   = new Map();
        this.rocks      = new Map();
        this.rockEvents = [];

        // EMERALDS — exactly EMERALD_COUNT cells per arena, hand-placed in
        // the deepest band (spine third) with a minimum spread so they never
        // cluster. Deterministic per boot: candidates are ranked by the same
        // salted ore hash, so every client agrees via the ore snapshot.
        const emeraldKeys = new Set();
        {
            const halfSpan = Math.max(1, (viHi - viLo) / 2);
            const cands = [];
            for (let vj = vjLo; vj <= vjHi; vj++) {
                for (let vi = viLo; vi <= viHi; vi++) {
                    const depth = Math.min(vi - viLo, viHi - vi) / halfSpan;
                    if (depth < 0.7) continue;
                    cands.push({ vi, vj, s: this._oreRoll(vi, vj, this.oreSalt + 13) });
                }
            }
            cands.sort((a, b) => a.s - b.s);
            const picked = [];
            for (const c of cands) {
                if (picked.length >= EMERALD_COUNT) break;
                let ok = true;
                for (const p of picked) {
                    const di = c.vi - p.vi, dj = c.vj - p.vj;
                    if (di * di + dj * dj < 36) { ok = false; break; } // ≥6 cells apart
                }
                if (!ok) continue;
                picked.push(c);
                emeraldKeys.add(c.vi * 100003 + c.vj);
            }
        }

        for (let vj = vjLo; vj <= vjHi; vj++) {
            for (let vi = viLo; vi <= viHi; vi++) {
                const [hx, hy] = hash2(vi, vj);
                const sx = vi+hx, sy = vj+hy;

                // One destructible rock per cell. wx/wy = seed world coords,
                // used as the gem fallback spawn spot. ore = the tier this
                // cell pays when broken (0 = barren); ore HP scales with tier.
                const ore = emeraldKeys.has(vi * 100003 + vj)
                    ? ORE.EMERALD
                    : this._oreTierFor(vi, vj, viLo, viHi);
                const hp  = ROCK_HEALTH * ORE_HP[ore];
                const rock = {
                    k: vi * 100003 + vj, vi, vj,
                    health: hp, maxHealth: hp,
                    alive: true,
                    ore,
                    deposits: null,
                    wx: sx * rockSz * cellSize - halfW,
                    wy: sy * rockSz * cellSize - halfH,
                    // ── living-wall state ──
                    gen: 0,          // 0 = the rock this arena booted with
                    growing: false,
                    growStart: 0,
                    growDamage: 0,   // damage taken during THIS rise (never healed back)
                    diedAt: 0,       // when it was destroyed (0 = not dead)
                    worldPoly: null, // full-size outline in world coords (regrowth math)
                    worldCx: 0, worldCy: 0, maxPolyRadius: 0,
                    tilePoly: null, tileCx: 0, tileCy: 0, // for deposit re-layout
                };
                this.rocks.set(rock.k, rock);

                let poly = [[sx-3,sy-3],[sx+3,sy-3],[sx+3,sy+3],[sx-3,sy+3]];
                for (let dj = -2; dj <= 2 && poly.length >= 3; dj++) {
                    for (let di = -2; di <= 2 && poly.length >= 3; di++) {
                        if (di === 0 && dj === 0) continue;
                        const [nhx, nhy] = hash2(vi+di, vj+dj);
                        const tx = vi+di+nhx, ty = vj+dj+nhy;
                        poly = clip(poly, (sx+tx)/2, (sy+ty)/2, tx-sx, ty-sy);
                    }
                }
                if (poly.length < 3) continue;
                let area = 0;
                for (let ai = 0; ai < poly.length; ai++) {
                    const [ax, ay] = poly[ai], [bx, by] = poly[(ai+1)%poly.length];
                    area += ax*by - bx*ay;
                }
                if (Math.abs(area) / 2 < 0.05) continue;

                // Cell geometry, cached in both spaces: tile coords for the
                // mirrored deposit layout, world coords for the regrowth
                // push math (a rising rock shoves bodies out along its own
                // outline, so it needs the real polygon, not just the seed).
                {
                    let pcx = 0, pcy = 0;
                    for (const p of poly) { pcx += p[0]; pcy += p[1]; }
                    pcx = pcx / poly.length * rockSz;
                    pcy = pcy / poly.length * rockSz;
                    rock.tilePoly = poly.map(p => [p[0] * rockSz, p[1] * rockSz]);
                    rock.tileCx = pcx;
                    rock.tileCy = pcy;
                    rock.worldPoly = rock.tilePoly.map(p => [p[0] * cellSize - halfW,
                                                             p[1] * cellSize - halfH]);
                    rock.worldCx = pcx * cellSize - halfW;
                    rock.worldCy = pcy * cellSize - halfH;
                    let far = 0;
                    for (const p of rock.worldPoly) {
                        const d = Math.hypot(p[0] - rock.worldCx, p[1] - rock.worldCy);
                        if (d > far) far = d;
                    }
                    rock.maxPolyRadius = far;
                }

                // Ore deposits: same tile-space layout the client renders
                // (mirrored math — see depositLayout), converted to world
                // coords so broken rocks pay out AT their visible crystals.
                if (ore) rock.deposits = this._buildDeposits(rock);

                const wsx = sx*rockSz*cellSize-halfW, wsy = sy*rockSz*cellSize-halfH;

                for (let e = 0; e < poly.length; e++) {
                    const [vax, vay] = poly[e], [vbx, vby] = poly[(e+1)%poly.length];

                    const wax = vax*rockSz*cellSize-halfW, way = vay*rockSz*cellSize-halfH;
                    const wbx = vbx*rockSz*cellSize-halfW, wby = vby*rockSz*cellSize-halfH;
                    const edx = wbx-wax, edy = wby-way, len = Math.hypot(edx, edy);
                    if (len < 1e-6) continue;

                    const ux = edx/len, uy = edy/len;
                    let nx = -uy, ny = ux;
                    const mx = (wax+wbx)*0.5, my = (way+wby)*0.5;
                    if ((wsx-mx)*nx + (wsy-my)*ny > 0) { nx = -nx; ny = -ny; }

                    const seg = { ax:wax, ay:way, bx:wbx, by:wby,
                                   edx:ux, edy:uy, nx, ny, len, _tick:0, rock };
                    const x0=Math.min(wax,wbx), x1=Math.max(wax,wbx);
                    const y0=Math.min(way,wby), y1=Math.max(way,wby);
                    const c0=Math.floor(x0/BUCKET), c1=Math.floor(x1/BUCKET);
                    const r0=Math.floor(y0/BUCKET), r1=Math.floor(y1/BUCKET);
                    for (let bc=c0; bc<=c1; bc++) for (let br=r0; br<=r1; br++) {
                        const key = bc * 997 + br;
                        let arr=vmap.get(key); if(!arr){arr=[];vmap.set(key,arr);}
                        arr.push(seg);
                    }
                }
            }
        }

        this._voronoiMap    = vmap;
        this._voronoiBucket = BUCKET;
    }

    // ═══ THE LIVING WALL ══════════════════════════════════════════════════
    // Crystal spots for a rock's CURRENT life. The generation rides the
    // layout salt, so a regrown seam sits in different places than the one
    // that was mined out. MIRRORED on the client (_getVeinArt) — the two
    // salt expressions must stay character-for-character equivalent.
    _buildDeposits(rock) {
        const cellSize = this.cellSize;
        const halfW = this.cols * cellSize / 2, halfH = this.rows * cellSize / 2;
        const rockSz = this._voroRockSz;
        const kk = rock.k & 0xffff;
        const gsalt = rock.gen * REGROW.ORE_GEN_STRIDE;
        const h = (i, s) => TerrainGrid._dh(i, kk, (s + this.oreSalt + gsalt) | 0);
        return TerrainGrid.depositLayout(
            rock.ore, rock.tilePoly, rock.tileCx, rock.tileCy, rockSz, h
        ).map(d => ({
            wx: d.x * cellSize - halfW,
            wy: d.y * cellSize - halfH,
            wr: d.r * cellSize,
            big: d.big,
        }));
    }

    // Which frontier a cell belongs to: 0 = low-vi side (blue's approach in
    // the stock map), 1 = high-vi side, -1 = dead on the spine (counts for
    // neither). The pacing math is symmetric, so the labels don't matter.
    _sideOf(rock) {
        return rock.vi < this._spineMid ? 0 : rock.vi > this._spineMid ? 1 : -1;
    }

    // How far along a rising rock is: 0 the instant it breaks ground, 1 grown.
    growthProgress(rock, now) {
        if (!rock.growing) return 1;
        return Math.max(0, Math.min(1, (now - rock.growStart) / REGROW.GROW_MS));
    }

    // Its collision size right now, as a fraction of the full cell. The
    // client draws with this exact curve, so what you see is what shoves you.
    growthScale(rock, now) {
        return REGROW.START_SCALE +
               (1 - REGROW.START_SCALE) * easeGrowth(this.growthProgress(rock, now));
    }

    growingRocks() { return this._growing; }

    // ── Convex-polygon helpers, all in the rock's UNSCALED frame ──────────
    // Uniform scaling about the centroid means a query point can simply be
    // divided back into full-size space — no per-tick polygon rebuilds.
    static _pointInPoly(poly, x, y) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1];
            const xj = poly[j][0], yj = poly[j][1];
            if ((yi > y) !== (yj > y) &&
                x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    static _distToPoly(poly, x, y) {
        let best = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const L2 = dx * dx + dy * dy || 1e-12;
            const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
            const ddx = x - (a[0] + t * dx), ddy = y - (a[1] + t * dy);
            const d = ddx * ddx + ddy * ddy;
            if (d < best) best = d;
        }
        return Math.sqrt(best);
    }

    // Distance from the centroid to the outline along a direction. Voronoi
    // cells are convex and the centroid is inside, so the ray exits exactly
    // once — this is the rock's "radius" in that direction.
    static _rayExit(poly, cx, cy, dx, dy) {
        let best = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const ex = b[0] - a[0], ey = b[1] - a[1];
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / den;
            const u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / den;
            if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
        }
        return best === Infinity ? 0 : best;
    }

    // Does a circle touch this rising rock at its current size?
    _circleHitsGrowing(rock, x, y, r, now) {
        if (!rock.worldPoly) return false;
        const s = this.growthScale(rock, now);
        const dx = x - rock.worldCx, dy = y - rock.worldCy;
        const reach = rock.maxPolyRadius * s + r;
        if (dx * dx + dy * dy > reach * reach) return false;
        // pull the query back into full-size space (uniform scale, exact)
        const qx = rock.worldCx + dx / s, qy = rock.worldCy + dy / s;
        if (TerrainGrid._pointInPoly(rock.worldPoly, qx, qy)) return true;
        return TerrainGrid._distToPoly(rock.worldPoly, qx, qy) <= r / s;
    }

    // The rising rock a projectile just ran into, or null. Same contract as
    // rockHitByCircle so the mining path treats both kinds of stone alike.
    growingRockHitByCircle(x, y, r, now = Date.now()) {
        for (const rock of this._growing) {
            if (this._circleHitsGrowing(rock, x, y, r, now)) return rock;
        }
        return null;
    }

    // Shove a body out of every rising rock it overlaps. Mutates pos.
    //
    // The contract that matters: NOTHING is ever teleported. If the push
    // can't get the body clear — it's pinned between the growing stone and
    // something solid — we put it back where it was and report `entombed`,
    // and the caller starts crushing it instead. A pinned player keeps full
    // control and can still walk out through any seam; they just bleed.
    pushCircleFromGrowing(pos, r, now = Date.now()) {
        if (!this._growing.length) return { dx: 0, dy: 0, entombed: false };
        const startX = pos.x, startY = pos.y;
        const cap = (this._cellWorld || 100) * REGROW.MAX_PUSH_PER_TICK;
        let touched = false;

        for (const rock of this._growing) {
            if (!rock.worldPoly) continue;
            const s = this.growthScale(rock, now);
            let dx = pos.x - rock.worldCx, dy = pos.y - rock.worldCy;
            const reach = rock.maxPolyRadius * s + r;
            if (dx * dx + dy * dy > reach * reach) continue;

            let dist = Math.hypot(dx, dy), ux, uy;
            if (dist < 1e-6) {
                // dead centre: leave along the shortest way out
                let bestT = Infinity, bx = 1, by = 0;
                for (let i = 0; i < rock.worldPoly.length; i++) {
                    const a = rock.worldPoly[i], b = rock.worldPoly[(i + 1) % rock.worldPoly.length];
                    const mx = (a[0] + b[0]) / 2 - rock.worldCx;
                    const my = (a[1] + b[1]) / 2 - rock.worldCy;
                    const t = Math.hypot(mx, my) || 1e-9;
                    if (t < bestT) { bestT = t; bx = mx / t; by = my / t; }
                }
                ux = bx; uy = by; dist = 0;
            } else { ux = dx / dist; uy = dy / dist; }

            // where the rock's face sits along this direction, right now
            const exit = TerrainGrid._rayExit(rock.worldPoly, rock.worldCx, rock.worldCy, ux, uy);
            const need = exit * s + r - dist;
            if (need <= 0) continue;
            touched = true;
            // rate-limited so a fast-closing face nudges rather than punts
            pos.x += ux * Math.min(need, cap);
            pos.y += uy * Math.min(need, cap);
        }

        if (!touched) return { dx: 0, dy: 0, entombed: false };

        // settle against finished rock too, then judge the outcome by PROGRESS,
        // not by whether we got fully clear: a body being walked out of the way
        // moves; a body pinned between two closing faces (or between stone and
        // a wall) has its pushes cancel and goes nowhere. The second case is
        // the one that gets crushed — and it keeps its original position, so
        // nothing is ever flung or teleported.
        this.pushCircleFromVoronoi(pos, r);
        const moved = Math.hypot(pos.x - startX, pos.y - startY);
        if (moved < cap * 0.35) {
            for (const rock of this._growing) {
                if (this._circleHitsGrowing(rock, pos.x, pos.y, r, now)) {
                    pos.x = startX; pos.y = startY;
                    return { dx: 0, dy: 0, entombed: true };
                }
            }
        }
        return { dx: pos.x - startX, dy: pos.y - startY, entombed: false };
    }

    // A hole starts closing: fresh generation, fresh ore roll, fresh crystals.
    startRegrow(rock, now) {
        if (!rock.worldPoly || rock.alive || rock.growing) return;
        rock.gen++;
        rock.growing    = true;
        rock.growStart  = now;
        rock.growDamage = 0;
        rock.diedAt     = 0;
        rock.alive      = false;   // full-size colliders stay off until it lands
        rock.ore        = this._oreTierFor(rock.vi, rock.vj, this._voroViLo, this._voroViHi,
                                          rock.gen * REGROW.ORE_GEN_STRIDE);
        rock.maxHealth  = ROCK_HEALTH * ORE_HP[rock.ore];
        rock.health     = rock.maxHealth * REGROW.HP_FLOOR;
        rock.deposits   = rock.ore ? this._buildDeposits(rock) : null;
        this._growing.push(rock);
        this.growEvents.push({ k: rock.k, r: 1, o: rock.ore, gen: rock.gen });
    }

    _unlistGrowing(rock) {
        const i = this._growing.indexOf(rock);
        if (i !== -1) this._growing.splice(i, 1);
    }

    // It made it. Full size, full health, colliders back on, ore live.
    completeRegrow(rock) {
        rock.growing    = false;
        rock.alive      = true;
        rock.health     = rock.maxHealth;
        rock.growDamage = 0;
        this._unlistGrowing(rock);
        this.growEvents.push({ k: rock.k, r: 2 });
    }

    // ── Pacing: timers, the frontier rubber band, completions, emeralds ──
    // Runs at REGROW.PACING_MS, never at the 8ms terrain cadence.
    regrowTick(now) {
        if (!this._voronoiMap) return;
        if (now - this._lastRegrowTick < REGROW.PACING_MS) return;
        this._lastRegrowTick = now;

        // 1. finish anything that has served its 7 seconds
        for (let i = this._growing.length - 1; i >= 0; i--) {
            const rock = this._growing[i];
            if (now - rock.growStart >= REGROW.GROW_MS) { this.completeRegrow(rock); continue; }
            // 2. harden as it rises — the curve raises the ceiling, and any
            //    damage taken on the way up is permanently deducted from it
            const target = rock.maxHealth *
                Math.max(REGROW.HP_FLOOR, easeGrowth(this.growthProgress(rock, now)));
            rock.health = Math.max(1, target - rock.growDamage);
        }

        // 3. count the holes on each side of the spine — this IS the front
        //    line: no HUD, no marker, purely how fast stone comes back
        let gap0 = 0, gap1 = 0;
        for (const rock of this.rocks.values()) {
            if (rock.alive || rock.growing || !rock.diedAt) continue;
            const side = this._sideOf(rock);
            if (side === 0) gap0++; else if (side === 1) gap1++;
        }
        const delayFor = (mine, theirs) => Math.max(REGROW.MIN_DELAY_MS,
            Math.min(REGROW.BASE_DELAY_MS,
                REGROW.BASE_DELAY_MS - REGROW.DEFICIT_MS_PER_GAP * Math.max(0, mine - theirs)));
        this._regrowDelay[0] = delayFor(gap0, gap1);
        this._regrowDelay[1] = delayFor(gap1, gap0);

        // 4. start what's due AND touching living stone: the wall heals from
        //    its edges inward, so a deep excavation closes from the outside
        for (const rock of this.rocks.values()) {
            if (rock.alive || rock.growing || !rock.diedAt || !rock.worldPoly) continue;
            const side = this._sideOf(rock);
            const delay = side === -1
                ? Math.min(this._regrowDelay[0], this._regrowDelay[1])
                : this._regrowDelay[side];
            if (now - rock.diedAt < delay) continue;
            if (!this._hasLivingNeighbour(rock)) continue;
            this.startRegrow(rock, now);
        }

        // 5. keep ~3 emeralds in the wall
        if (this._pendingEmeralds.length) this._tickEmeraldRespawns(now);
    }

    // Only fully grown neighbours count — a rising nub can't seed more growth.
    _hasLivingNeighbour(rock) {
        const { vi, vj } = rock;
        const n = (i, j) => {
            const r = this.rocks.get(i * 100003 + j);
            return !!(r && r.alive);
        };
        return n(vi - 1, vj) || n(vi + 1, vj) || n(vi, vj - 1) || n(vi, vj + 1);
    }

    _tickEmeraldRespawns(now) {
        for (let i = this._pendingEmeralds.length - 1; i >= 0; i--) {
            if (this._pendingEmeralds[i].at > now) continue;
            if (this._plantEmerald()) this._pendingEmeralds.splice(i, 1);
            // no room right now (wall shot to pieces) → try again next tick
        }
    }

    // Pick the deepest-band cell that's furthest from the emeralds still in
    // the wall, deterministically, and turn it into the new jackpot.
    _plantEmerald() {
        const viLo = this._voroViLo, viHi = this._voroViHi;
        const halfSpan = Math.max(1, (viHi - viLo) / 2);
        const current = [];
        for (const rock of this.rocks.values()) {
            if (rock.ore === ORE.EMERALD && (rock.alive || rock.growing)) current.push(rock);
        }
        const salt = this.oreSalt + 13 + (++this._emeraldRespawns) * 104729;
        let best = null, bestScore = Infinity;
        for (const rock of this.rocks.values()) {
            if (!rock.alive || rock.growing || rock.ore !== ORE.NONE) continue;
            const depth = Math.min(rock.vi - viLo, viHi - rock.vi) / halfSpan;
            if (depth < 0.7) continue;
            let ok = true;
            for (const c of current) {
                const di = rock.vi - c.vi, dj = rock.vj - c.vj;
                if (di * di + dj * dj < 36) { ok = false; break; } // ≥6 cells apart
            }
            if (!ok) continue;
            const score = this._oreRoll(rock.vi, rock.vj, salt);
            if (score < bestScore) { bestScore = score; best = rock; }
        }
        if (!best) { this._emeraldRespawns--; return false; }
        const oldMax = best.maxHealth || 1;
        const frac = Math.min(1, best.health / oldMax);
        best.ore       = ORE.EMERALD;
        best.maxHealth = ROCK_HEALTH * ORE_HP[ORE.EMERALD];
        best.health    = frac * best.maxHealth;
        best.deposits  = this._buildDeposits(best);
        this.growEvents.push({ k: best.k, e: 1 });
        return true;
    }

    // ─── Point / circle vs rock queries ───────────────────────────────────────
    // A point is inside a rock iff its nearest Voronoi seed (same float32 hash
    // as the renderer) is one of the included lattice cells. This is exact
    // with respect to the drawn rocks — no grid approximation.
    pointInRock(wx, wy) {
        if (!this._voronoiMap) return false;
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        const s  = this._voroRockSz * this.cellSize; // world units per Voronoi cell
        const px = (wx + halfW) / s, py = (wy + halfH) / s;
        const nx = Math.floor(px), ny = Math.floor(py);
        let best = Infinity, bi = 0, bj = 0;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                const [hx, hy] = this._hash2(nx + di, ny + dj);
                const sx = nx + di + hx, sy = ny + dj + hy;
                const d = (px - sx) * (px - sx) + (py - sy) * (py - sy);
                if (d < best) { best = d; bi = nx + di; bj = ny + dj; }
            }
        }
        if (bi < this._voroViLo || bi > this._voroViHi ||
            bj < this._voroVjLo || bj > this._voroVjHi) return false;
        const rock = this.rocks.get(bi * 100003 + bj);
        return rock && rock.alive ? rock : false;
    }

    // The rock a circle touches, or null: either the centre is inside a live
    // rock cell (e.g. spawned there by a long barrel) or the circle overlaps
    // the nearest live rock edge — the same segments tanks collide with, so
    // projectiles die exactly where bodies are blocked. One rock per query so
    // a single bullet never damages two rocks at once.
    rockHitByCircle(x, y, r) {
        const inside = this.pointInRock(x, y);
        if (inside) return inside;
        if (!this._voronoiMap) return null;
        const BUCKET = this._voronoiBucket, smap = this._voronoiMap;
        const c0 = Math.floor((x - r) / BUCKET), c1 = Math.floor((x + r) / BUCKET);
        const r0 = Math.floor((y - r) / BUCKET), r1 = Math.floor((y + r) / BUCKET);
        const rr = r * r;
        let best = rr, hit = null;
        for (let bc = c0; bc <= c1; bc++) {
            for (let br = r0; br <= r1; br++) {
                const arr = smap.get(bc * 997 + br);
                if (!arr) continue;
                for (const seg of arr) {
                    if (seg.rock && !seg.rock.alive) continue;
                    const dax = x - seg.ax, day = y - seg.ay;
                    const t   = Math.max(0, Math.min(seg.len, dax * seg.edx + day * seg.edy));
                    const dx  = x - (seg.ax + t * seg.edx);
                    const dy  = y - (seg.ay + t * seg.edy);
                    const d2  = dx * dx + dy * dy;
                    if (d2 < best) { best = d2; hit = seg.rock; }
                }
            }
        }
        return hit;
    }

    circleHitsRock(x, y, r) { return !!this.rockHitByCircle(x, y, r); }

    // Nearest living rock (by seed position) within maxR world units — used
    // by idle drones that treat the rockline as an enemy and chew on it.
    nearestRock(wx, wy, maxR = 450) {
        if (!this._voronoiMap) return null;
        const halfW = this.cols * this.cellSize / 2;
        const halfH = this.rows * this.cellSize / 2;
        const s  = this._voroRockSz * this.cellSize; // world units per lattice cell
        const ni = Math.floor((wx + halfW) / s);
        const nj = Math.floor((wy + halfH) / s);
        const reach = Math.ceil(maxR / s) + 1;
        let best = maxR * maxR, hit = null;
        for (let dj = -reach; dj <= reach; dj++) {
            for (let di = -reach; di <= reach; di++) {
                const vi = ni + di, vj = nj + dj;
                if (vi < this._voroViLo || vi > this._voroViHi ||
                    vj < this._voroVjLo || vj > this._voroVjHi) continue;
                const rock = this.rocks.get(vi * 100003 + vj);
                if (!rock || !rock.alive) continue;
                const dx = rock.wx - wx, dy = rock.wy - wy;
                const d2 = dx * dx + dy * dy;
                if (d2 < best) { best = d2; hit = rock; }
            }
        }
        return hit;
    }

    // Apply damage; queues a network delta. Rocks never heal, die once.
    // wx/wy (world coords of the impact) let every client draw the hit spark
    // at the same spot; sent in renderer tile units.
    damageRock(rock, dmg, wx, wy, grind) {
        if (!rock || (!rock.alive && !rock.growing) || !(dmg > 0)) return false;
        // a rising rock is real stone: it takes hits, and what it loses on
        // the way up is never healed back by the growth curve
        const wasGrowing = rock.growing;
        if (wasGrowing) rock.growDamage += dmg;
        rock.health -= dmg;
        const destroyed = rock.health <= 0;
        if (destroyed) {
            rock.health = 0;
            rock.alive = false;
            // killed before it finished = a husk. It pays NOTHING (the caller
            // checks `growing` to skip the gem burst) and its clock restarts.
            if (wasGrowing) { rock.growing = false; this._unlistGrowing(rock); }
            rock.growDamage = 0;
            rock.diedAt = Date.now();
            // a mined-out emerald reappears elsewhere in the deep — but only
            // if it was actually mined, not shot down mid-rise
            if (!wasGrowing && rock.ore === ORE.EMERALD)
                this._pendingEmeralds.push({ at: rock.diedAt + REGROW.EMERALD_RESPAWN_MS });
        }
        const ev = { k: rock.k, h: rock.health / rock.maxHealth, d: destroyed ? 1 : 0 };
        // grind flag: hull scraping — clients draw soft grind sparks
        // instead of full bullet-impact bursts
        if (grind && !destroyed) ev.g = 1;
        // ore tier rides the destroy delta so every client colors the
        // shatter (and stops drawing the vein) without a second message.
        // A premature kill sends no tier: there was no treasure to spill.
        if (destroyed && rock.ore && !wasGrowing) ev.o = rock.ore;
        // premature: clients play a muted collapse instead of the full
        // celebration, and expect no gems
        if (destroyed && wasGrowing) ev.p = 1;
        if (wx !== undefined) {
            const halfW = this.cols * this.cellSize / 2;
            const halfH = this.rows * this.cellSize / 2;
            ev.x = Math.round((wx + halfW) / this.cellSize * 100) / 100;
            ev.y = Math.round((wy + halfH) / this.cellSize * 100) / 100;
        }
        this.rockEvents.push(ev);
        return destroyed;
    }

    // Damaged/destroyed/rising rocks — sent to late joiners with the map, so
    // someone joining mid-regrowth sees every nub at exactly the size the
    // rest of the server sees it, with the right seam in it.
    rockStateSnapshot() {
        const out = [];
        const now = Date.now();
        for (const rock of this.rocks.values()) {
            if (rock.growing) {
                out.push({ k: rock.k, h: rock.health / rock.maxHealth, d: 1,
                           r: Math.max(0, now - rock.growStart),
                           o: rock.ore, gen: rock.gen });
            } else if (!rock.alive) {
                out.push({ k: rock.k, h: 0, d: 1 });
            } else if (rock.health < rock.maxHealth || rock.gen > 0) {
                // gen rides along even at full health: the client needs it to
                // place a regrown cell's crystals where the server will
                out.push({ k: rock.k, h: rock.health / rock.maxHealth, d: 0, gen: rock.gen });
            }
        }
        return out;
    }

    // Living ore cells as [key, tier] pairs — rides the TG snapshot so every
    // client (including late joiners) draws the same veins.
    oreSnapshot() {
        const out = [];
        for (const rock of this.rocks.values()) {
            if (rock.alive && rock.ore) out.push([rock.k, rock.ore]);
        }
        return out;
    }

    // ─── Circle-vs-Voronoi-cell collision resolver ────────────────────────────
    // Identical logic to pushCircleFromContour but uses _voronoiMap so the two
    // segment sets never interfere with each other.
    pushCircleFromVoronoi(pos, r) {
        if (!this._voronoiMap) return { dx: 0, dy: 0 };
        const BUCKET = this._voronoiBucket;
        const smap   = this._voronoiMap;
        const startX = pos.x, startY = pos.y;
        const tick   = ++this._voronoiTick;

        for (let pass = 0; pass < 3; pass++) {
            const cx = pos.x, cy = pos.y;
            const c0 = Math.floor((cx-r)/BUCKET), c1 = Math.floor((cx+r)/BUCKET);
            const r0 = Math.floor((cy-r)/BUCKET), r1 = Math.floor((cy+r)/BUCKET);
            let moved = false;

            for (let bc = c0; bc <= c1; bc++) {
                for (let br = r0; br <= r1; br++) {
                    const arr = smap.get(bc * 997 + br);
                    if (!arr) continue;
                    for (const seg of arr) {
                        if (seg._tick === tick) continue;
                        seg._tick = tick;
                        if (seg.rock && !seg.rock.alive) continue;
                        const dax = pos.x-seg.ax, day = pos.y-seg.ay;
                        const t   = Math.max(0, Math.min(seg.len, dax*seg.edx+day*seg.edy));
                        const ncx = seg.ax+t*seg.edx, ncy = seg.ay+t*seg.edy;
                        const dx  = pos.x-ncx, dy = pos.y-ncy;
                        const dist2 = dx*dx + dy*dy;
                        if (dist2 >= r*r) continue;
                        const dist = Math.sqrt(dist2);
                        let pnx, pny;
                        if (dist < 1e-6) { pnx = seg.nx; pny = seg.ny; }
                        else {
                            pnx = dx/dist; pny = dy/dist;
                            if (pnx*seg.nx+pny*seg.ny < 0) { pnx=-pnx; pny=-pny; }
                        }
                        pos.x += pnx*(r-dist); pos.y += pny*(r-dist);
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }
        return { dx: pos.x-startX, dy: pos.y-startY };
    }

    // ─── Circle-vs-contour collision resolver ──────────────────────────────────
    // Mutates pos.x / pos.y in-place.
    // Returns {dx, dy} — the total displacement — for velocity cancellation.
    pushCircleFromContour(pos, r) {
        if (!this._contourMap) return { dx: 0, dy: 0 };
        const BUCKET = this._contourBucket;
        const smap   = this._contourMap;
        const startX = pos.x, startY = pos.y;
        const tick   = ++this._contourTick;

        // Up to 3 sequential passes so chained contacts converge
        for (let pass = 0; pass < 3; pass++) {
            const cx = pos.x, cy = pos.y;
            const c0 = Math.floor((cx - r) / BUCKET), c1 = Math.floor((cx + r) / BUCKET);
            const r0 = Math.floor((cy - r) / BUCKET), r1 = Math.floor((cy + r) / BUCKET);
            let moved = false;

            for (let bc = c0; bc <= c1; bc++) {
                for (let br = r0; br <= r1; br++) {
                    const arr = smap.get(bc * 997 + br);
                    if (!arr) continue;
                    for (const seg of arr) {
                        if (seg._tick === tick) continue;
                        seg._tick = tick;

                        const dax = pos.x - seg.ax, day = pos.y - seg.ay;
                        const t   = Math.max(0, Math.min(seg.len,
                                        dax * seg.edx + day * seg.edy));
                        const ncx = seg.ax + t * seg.edx;
                        const ncy = seg.ay + t * seg.edy;
                        const dx  = pos.x - ncx, dy = pos.y - ncy;
                        const dist2 = dx*dx + dy*dy;
                        if (dist2 >= r*r) continue;
                        const dist = Math.sqrt(dist2);

                        let pnx, pny;
                        if (dist < 1e-6) {
                            pnx = seg.nx; pny = seg.ny;
                        } else {
                            pnx = dx / dist; pny = dy / dist;
                            if (pnx * seg.nx + pny * seg.ny < 0) { pnx = -pnx; pny = -pny; }
                        }
                        const ov = r - dist;
                        pos.x += pnx * ov;
                        pos.y += pny * ov;
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }
        return { dx: pos.x - startX, dy: pos.y - startY };
    }
}

module.exports = { TerrainGrid, CELL, ORE, REGROW, easeGrowth };

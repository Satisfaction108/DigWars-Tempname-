// TUTORIAL PLOTS
//
// The engine runs one shared room per server process, so "every learner gets
// their own world" is bought a different way: the room is carved into a grid of
// plots spaced further apart than anyone's view distance. sockets.eyes() culls
// by |dx| < fov + 1.5*size + 100, so two players in different plots never end
// up in each other's `nearby` map - they are in the same room and never once
// receive each other.
//
// Everything a plot needs is placed per-plot: a rock patch to mine, a vault pad
// to bank at, an outpost, a core chamber, and an enemy base tile to demonstrate
// why you don't touch one. Outposts/chambers/vaults are transmitted to the
// client as snapshots inside the 'TG' packet, so placing them freely does NOT
// desync the client - unlike the voronoi rock geometry, which is derived on
// both sides from (cols, rows, cells, oreSalt) and must stay untouched.

const { CELL, ORE } = require('./terrainGrid.js');

const TILE = 420;          // world units per room tile (Config.map_tile_width)
const SUBCELLS = 8;        // terrain cells per tile, matches mapGen.SUBCELLS
// Plot size is bounded from BELOW by the view cull, not by taste: two
// learners must never see each other, and the horizontal cull reaches about
// 2000 units each way, so plots below ~4000 across would leak. 12 tiles
// (5040) keeps a comfortable margin. The grid is what shrinks the world.
const PLOT_TILES = 12;     // 12 * 420 = 5040 world units per plot
// A SQUARE grid on purpose: it makes the room a whole number of plots on both
// axes, so the in-game full map can lock to exactly one plot with a single
// zoom factor (room / plot) and show the learner their training ground and
// nothing else. A 3x2 grid needs different zooms per axis and bleeds the
// neighbouring plots into view.
const PLOT_COLS = 2;       // 2 x 2 = 4 concurrent learners
const PLOT_ROWS = 2;

const PLOT_SIZE = PLOT_TILES * TILE;
const ROOM_TILES_X = PLOT_COLS * PLOT_TILES;
const ROOM_TILES_Y = PLOT_ROWS * PLOT_TILES;

// Where things sit inside a plot, as offsets from the plot centre. Kept as
// fractions of PLOT_SIZE so retuning PLOT_TILES doesn't scatter the furniture.
const LAYOUT = {
    spawn:   { x: -0.34, y:  0.00 },
    // A modest patch - a training ground with some rocks, not a mining field.
    rocks:   { x:  0.02, y:  0.00, rx: 0.15, ry: 0.18 }, // rock patch + radii
    vault:   { x: -0.40, y: -0.30 },
    outpost: { x:  0.34, y: -0.28 },
    chamber: { x:  0.34, y:  0.30 },
    // Practice targets sit close to the spawn on purpose. The view cull is
    // tighter vertically than horizontally (|dy| < fov*0.5625, roughly 1125
    // units, versus ~2000 across), so a target parked much further down the
    // plot never reaches the learner's client at all - it simply never
    // appears, and the lesson waits forever on a bot that is "there".
    dummy:   { x: -0.18, y: -0.10 }, // stationary practice bot
    fighter: { x: -0.16, y:  0.12 }, // low-skill combat bot
    // Enemy base block. Kept as exact twelfths so it lands on the centre of the
    // 2x2 base tiles that room_tutorial paints - see BASE_TILES below.
    base:    { x: -5 / 12, y:  5 / 12 },
};

// Plot-local tile coordinates of the enemy base block, consumed by
// room_tutorial.js. LAYOUT.base points at the centre of these four tiles.
const BASE_TILES = { x0: 0, x1: 1, y0: 10, y1: 11 };

const plotCount = () => PLOT_COLS * PLOT_ROWS;

// Plot index -> world centre. Room spans [-roomW/2, +roomW/2].
function plotCenter(index) {
    const gx = index % PLOT_COLS;
    const gy = Math.floor(index / PLOT_COLS) % PLOT_ROWS;
    const roomW = ROOM_TILES_X * TILE;
    const roomH = ROOM_TILES_Y * TILE;
    return {
        x: -roomW / 2 + (gx + 0.5) * PLOT_SIZE,
        y: -roomH / 2 + (gy + 0.5) * PLOT_SIZE,
    };
}

// A named point inside a plot, in world coordinates.
function plotPoint(index, key) {
    const c = plotCenter(index);
    const l = LAYOUT[key];
    if (!l) throw new Error(`tutorialPlots: unknown layout point "${key}"`);
    return { x: c.x + l.x * PLOT_SIZE, y: c.y + l.y * PLOT_SIZE };
}

// Which plot a world position falls in (-1 when outside every plot).
function plotAt(x, y) {
    const roomW = ROOM_TILES_X * TILE;
    const roomH = ROOM_TILES_Y * TILE;
    const gx = Math.floor((x + roomW / 2) / PLOT_SIZE);
    const gy = Math.floor((y + roomH / 2) / PLOT_SIZE);
    if (gx < 0 || gx >= PLOT_COLS || gy < 0 || gy >= PLOT_ROWS) return -1;
    return gy * PLOT_COLS + gx;
}

// Terrain: empty everything, then grow one rock patch per plot.
//
// Clearing the map wholesale is a deliberate performance choice - a full-size
// dig-wars map of rock across every plot would mean thousands of colliders and
// regrow ticks for a world where only a handful of small patches are mined.
function carveTerrain(grid) {
    for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) grid.set(c, r, CELL.EMPTY);
    }

    const cellSize = TILE / SUBCELLS;
    const halfW = (grid.cols * cellSize) / 2;
    const halfH = (grid.rows * cellSize) / 2;

    for (let i = 0; i < plotCount(); i++) {
        const c = plotCenter(i);
        const patchX = c.x + LAYOUT.rocks.x * PLOT_SIZE;
        const patchY = c.y + LAYOUT.rocks.y * PLOT_SIZE;
        const rx = LAYOUT.rocks.rx * PLOT_SIZE;
        const ry = LAYOUT.rocks.ry * PLOT_SIZE;

        const c0 = Math.max(0, Math.floor((patchX - rx + halfW) / cellSize));
        const c1 = Math.min(grid.cols - 1, Math.ceil((patchX + rx + halfW) / cellSize));
        const r0 = Math.max(0, Math.floor((patchY - ry + halfH) / cellSize));
        const r1 = Math.min(grid.rows - 1, Math.ceil((patchY + ry + halfH) / cellSize));

        for (let r = r0; r <= r1; r++) {
            for (let col = c0; col <= c1; col++) {
                // Cell centre back to world space, then an ellipse test so the
                // patch reads as a natural blob rather than a rectangle.
                const wx = col * cellSize - halfW + cellSize / 2;
                const wy = r * cellSize - halfH + cellSize / 2;
                const dx = (wx - patchX) / rx;
                const dy = (wy - patchY) / ry;
                if (dx * dx + dy * dy <= 1) grid.set(col, r, CELL.BASALT);
            }
        }
    }
}

// Replace the lane-based dig-wars sites with one outpost and one chamber per
// plot. Called after buildContour(), which is what populates rocks/sites.
function installSites(grid) {
    grid.outpostSites = [];
    grid.coreChamberSites = [];
    for (let i = 0; i < plotCount(); i++) {
        const o = plotPoint(i, 'outpost');
        grid.outpostSites.push({ id: i, name: 'Training Outpost', x: o.x, y: o.y });

        const ch = plotPoint(i, 'chamber');
        grid.coreChamberSites.push({
            id: i,
            name: 'Training Core Chamber',
            team: TEAM_RED,
            x: ch.x,
            y: ch.y,
        });
    }
}

// One vault pad per plot, on the learner's own team so banking works.
function vaultSites() {
    const out = [];
    for (let i = 0; i < plotCount(); i++) {
        const v = plotPoint(i, 'vault');
        out.push({ x: v.x, y: v.y, r: 95, team: TEAM_BLUE });
    }
    return out;
}

// Guarantee the mining lesson can always find each ore tier. The generator
// rolls ore by position, so a small patch can easily contain no emerald - we
// stamp one rock of each tier near the patch centre instead of hoping.
function seedOres(grid) {
    const wanted = [ORE.COPPER, ORE.VEIN, ORE.SHARD, ORE.EMERALD];
    for (let i = 0; i < plotCount(); i++) {
        const c = plotCenter(i);
        const patchX = c.x + LAYOUT.rocks.x * PLOT_SIZE;
        const patchY = c.y + LAYOUT.rocks.y * PLOT_SIZE;

        const inPatch = [];
        for (const rock of grid.rocks.values()) {
            if (!rock.alive || !rock.worldPoly) continue;
            const dx = rock.worldCx - patchX;
            const dy = rock.worldCy - patchY;
            inPatch.push({ rock, d2: dx * dx + dy * dy });
        }
        inPatch.sort((a, b) => a.d2 - b.d2);
        for (let k = 0; k < wanted.length && k < inPatch.length; k++) {
            inPatch[k].rock.ore = wanted[k];
        }
    }
}

// The enemy base block in world coordinates, plus a keep-out margin.
//
// The base lesson has to teach that touching a base deletes you - without ever
// deleting anyone. Dying in a tutorial is confusing (the learner does not yet
// know what killed them) and it drops their satchel, which the banking lesson
// then depends on. So the base stays genuinely lethal, and we simply never let
// them reach it: the barrier below stops the tank at the edge on EVERY step,
// not just the one that mentions bases.
const BASE_KEEPOUT = 90;

function baseRect(index) {
    const c = plotCenter(index);
    const originX = c.x - PLOT_SIZE / 2;
    const originY = c.y - PLOT_SIZE / 2;
    return {
        x0: originX + BASE_TILES.x0 * TILE - BASE_KEEPOUT,
        y0: originY + BASE_TILES.y0 * TILE - BASE_KEEPOUT,
        x1: originX + (BASE_TILES.x1 + 1) * TILE + BASE_KEEPOUT,
        y1: originY + (BASE_TILES.y1 + 1) * TILE + BASE_KEEPOUT,
    };
}

// Push a body back out of its plot's base block by the shortest axis, so
// sliding along the edge still feels like a wall rather than a trap.
function keepOutOfBase(body, index) {
    const r = baseRect(index);
    if (body.x <= r.x0 || body.x >= r.x1 || body.y <= r.y0 || body.y >= r.y1) return false;

    const dLeft = body.x - r.x0, dRight = r.x1 - body.x;
    const dTop = body.y - r.y0, dBottom = r.y1 - body.y;
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min === dLeft) body.x = r.x0;
    else if (min === dRight) body.x = r.x1;
    else if (min === dTop) body.y = r.y0;
    else body.y = r.y1;
    if (body.velocity) { body.velocity.x *= 0.1; body.velocity.y *= 0.1; }
    return true;
}

module.exports = {
    BASE_KEEPOUT, baseRect, keepOutOfBase,
    TILE, PLOT_TILES, PLOT_COLS, PLOT_ROWS, PLOT_SIZE,
    ROOM_TILES_X, ROOM_TILES_Y, LAYOUT, BASE_TILES,
    plotCount, plotCenter, plotPoint, plotAt,
    carveTerrain, installSites, vaultSites, seedOres,
};

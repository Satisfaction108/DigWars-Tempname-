const { TerrainGrid, CELL } = require('./terrainGrid.js');

const SUBCELLS = 8;

function hash(x, y, seed) {
    let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 1284865837) ^ Math.imul((seed | 0) + 1, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1540483477);
    h ^= h >>> 15;
    return (h >>> 0) / 0x100000000;
}

function generate(cfg) {
    const tileCols = cfg.cols ?? 15;
    const tileRows = cfg.rows ?? 15;
    const cols     = tileCols * SUBCELLS;
    const rows     = tileRows * SUBCELLS;
    const seed     = cfg.seed ?? 7;

    const grid = new TerrainGrid(cols, rows);

    const lo = Math.max(2, SUBCELLS - 3);

    for (let r = 0; r < rows; r++) {
        const lf  = hash(Math.floor(r / 6), 0, seed);
        const hf  = hash(r,               1, seed);
        const lfR = hash(Math.floor(r / 6), 2, seed);
        const hfR = hash(r,               3, seed);

        const leftEdge  = lo + Math.round(lf * 2 + hf * 1);
        const rightEdge = (cols - 1) - (lo + Math.round(lfR * 2 + hfR * 1));

        for (let c = 0; c < leftEdge; c++)           grid.set(c, r, CELL.EMPTY);
        for (let c = rightEdge + 1; c < cols; c++) grid.set(c, r, CELL.EMPTY);
    }

    grid.subCellsPerTile = SUBCELLS;
    grid.tileCols        = tileCols;
    grid.tileRows        = tileRows;
    grid.leftSafeCol     = 0;
    grid.rightSafeCol    = tileCols - 1;
    return grid;
}

module.exports = { generate, hash, SUBCELLS };

const CELL = { BASALT: 0, EMPTY: 1 };

class TerrainGrid {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = new Uint8Array(cols * rows).fill(CELL.BASALT);
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
}

module.exports = { TerrainGrid, CELL };

// Tutorial room: a PLOT_COLS x PLOT_ROWS grid of identical learner plots.
// Every plot carries its own 2x2 enemy base block so the "never touch an enemy
// base" lesson can be demonstrated safely inside the learner's own world.
//
// Room files are evaluated with `tileClass` in scope (see loaders/global.js).

const plots = require('../../terrain/tutorialPlots.js');

const roomWidth = plots.ROOM_TILES_X;
const roomHeight = plots.ROOM_TILES_Y;

const room = Array(roomHeight).fill(null).map(() => Array(roomWidth).fill(tileClass.normal));

for (let gy = 0; gy < plots.PLOT_ROWS; gy++) {
    for (let gx = 0; gx < plots.PLOT_COLS; gx++) {
        const ox = gx * plots.PLOT_TILES;
        const oy = gy * plots.PLOT_TILES;
        const b = plots.BASE_TILES;
        for (let y = b.y0; y <= b.y1; y++) {
            for (let x = b.x0; x <= b.x1; x++) {
                // base2 == TEAM_RED, i.e. hostile to the learner (TEAM_BLUE).
                room[oy + y][ox + x] = tileClass.base2;
            }
        }
    }
}

module.exports = room;

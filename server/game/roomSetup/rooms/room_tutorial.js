// Tutorial room: a PLOT_COLS x PLOT_ROWS grid of identical learner arenas,
// each a miniature of room_dig_wars.js - a friendly base column down the left
// edge and a lethal enemy base column down the right - separated by gutters of
// plain tiles that nobody can see across.
//
// Room files are evaluated with `tileClass` in scope (see loaders/global.js).

const plots = require('../../terrain/tutorialPlots.js');

const roomWidth = plots.ROOM_TILES_X;
const roomHeight = plots.ROOM_TILES_Y;

const room = Array(roomHeight).fill(null).map(() => Array(roomWidth).fill(tileClass.normal));

for (let i = 0; i < plots.plotCount(); i++) {
    const o = plots.plotTileOrigin(i);
    for (let y = 0; y < plots.PLOT_TILES; y++) {
        // base1 == TEAM_BLUE, the learner's own team: safe to stand on, and
        // where their vault sits. base2 == TEAM_RED, hostile and lethal.
        room[o.y + y][o.x + plots.BASE_COL_BLUE] = tileClass.base1;
        room[o.y + y][o.x + plots.BASE_COL_RED]  = tileClass.base2;
    }
}

module.exports = room;

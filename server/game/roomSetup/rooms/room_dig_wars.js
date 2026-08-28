// Map size is the single strongest density lever in the game, so it lives in
// the gamemode config (dig_wars_terrain.room_width / room_height) rather than
// being baked in here. Everything downstream scales off the room's tile
// dimensions: game.js feeds Config.roomWidth/roomHeight into mapGen, and the
// canyons, outposts and core chambers are all placed as fractions of the
// resulting grid span - so these two numbers move the whole world at once.
//
// Deliberately WIDE, not square. The war runs left-to-right between the two
// base columns, so width IS the risk gradient (base -> deep rock -> base, the
// haul that has to stay long enough to be scary) while height is pure spread:
// it only decides how far apart two players can be while doing the exact same
// thing. Height was the cheap half of the map to cut. A square world put the
// upper canyon, the lower canyon and the Deep Core outpost thousands of units
// apart and split a thin population three ways; a wide one stacks them into
// one shared front.
const cfg = (typeof Config !== "undefined" && Config.dig_wars_terrain) || {};
const roomWidth  = cfg.room_width  ?? 13;
const roomHeight = cfg.room_height ?? 9;

const room = Array(roomHeight).fill(null).map(() => Array(roomWidth).fill(tileClass.normal));

for (let y = 0; y < roomHeight; y++) {
    room[y][0] = tileClass.base1;
    room[y][roomWidth - 1] = tileClass.base2;
}

module.exports = room;

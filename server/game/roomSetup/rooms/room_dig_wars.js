const roomHeight = 15, roomWidth = 15;
const room = Array(roomHeight).fill(null).map(() => Array(roomWidth).fill(tileClass.normal));

for (let y = 0; y < roomHeight; y++) {
    room[y][0] = tileClass.base1;
    room[y][roomWidth - 1] = tileClass.base2;
}

module.exports = room;

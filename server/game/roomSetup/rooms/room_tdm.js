let teams = require('../../gamemodes/config/tdm.js').teams,
	roomHeight = 15,
	roomWidth = 15,
	room = Array(roomHeight).fill(null).map(() => Array(roomWidth).fill()),
	spacing = 0,
locations = [
	[
		[[ 0 + spacing,  0 + spacing], [ 1 + spacing,  0 + spacing], [ 0 + spacing,  1 + spacing]],
		[[ 1 + spacing,  1 + spacing]]
	],[
		[
			[roomHeight - 1 - spacing, roomWidth - 1 - spacing],
			[roomHeight - 2 - spacing, roomWidth - 1 - spacing],
			[roomHeight - 1 - spacing, roomWidth - 2 - spacing]
		],
		[[roomHeight - 2 - spacing, roomWidth - 2 - spacing]]
	],[
		[
			[ 0 + spacing, roomWidth - 1 - spacing],
			[ 1 + spacing, roomWidth - 1 - spacing],
			[ 0 + spacing, roomWidth - 2 - spacing]
		],
		[[ 1 + spacing, roomWidth - 2 - spacing]]
	],[
		[
			[roomHeight - 1 - spacing,  0 + spacing],
			[roomHeight - 1 - spacing,  1 + spacing],
			[roomHeight - 2 - spacing,  0 + spacing]
		],
		[[roomHeight - 2 - spacing,  1 + spacing]]
	],[
		[
			[0 + spacing,  Math.floor(roomWidth / 2) - 1],
			[1 + spacing,  Math.floor(roomWidth / 2)],
			[0 + spacing,  Math.floor(roomWidth / 2) + 1]
		],
		[[0 + spacing,  Math.floor(roomWidth / 2)]]
	],[
		[
			[Math.floor(roomHeight / 2) - 1,  roomWidth - 1 - spacing],
			[Math.floor(roomHeight / 2),		 roomWidth - 2 - spacing],
			[Math.floor(roomHeight / 2) + 1,  roomWidth - 1 - spacing]
		],
		[[Math.floor(roomHeight / 2),  roomWidth - 1 - spacing]]
	],[
		[
			[roomHeight - 1 - spacing,  Math.floor(roomWidth / 2) - 1],
			[roomHeight - 2 - spacing,  Math.floor(roomWidth / 2)],
			[roomHeight - 1 - spacing,  Math.floor(roomWidth / 2) + 1]
		],
		[[roomHeight - 1 - spacing,  Math.floor(roomWidth / 2)]]
	],[
		[
			[Math.floor(roomHeight / 2) - 1,  0 + spacing],
			[Math.floor(roomHeight / 2),  	 1 + spacing],
			[Math.floor(roomHeight / 2) + 1,  0 + spacing]
		],
		[[Math.floor(roomHeight / 2),  0 + spacing]]
	]
];

if (teams === 2 && !spacing) {
	let baseprotGap = Math.ceil((roomHeight - 1) / 6);
	for (let y = 0; y < roomHeight; y++) {
		room[y][0] = tileClass.base1;
		room[y][roomWidth - 1] = tileClass.base2;
	}
	for (let i = -2; i <= 2; i++) {
		let y = Math.floor(roomHeight / 2 - baseprotGap * i);
		room[y][0] = tileClass.baseprotected1;
		room[y][roomWidth - 1] = tileClass.baseprotected2;
	}
} else {
	for (let i = 1; i <= teams; i++) {
		let [ spawns, protectors ] = locations[i - 1];
		for (let [y, x] of spawns) room[y][x] = tileClass[`base${i}`];
		for (let [y, x] of protectors) room[y][x] = tileClass[`baseprotected${i}`];
	}
}

module.exports = room;

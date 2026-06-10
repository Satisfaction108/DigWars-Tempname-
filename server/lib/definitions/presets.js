const {combineStats, weaponMirror} = require('./facilitators.js')
const g = require('./gunvals.js')
module.exports = {
	// Tooltips
	tooltip: {
		menu_lag: "WARNING: There are a lot of entities in here and having this menu open may cause noticeable frame drops!"
	},

	// Regular Functions
	makeAuto: {
		mega: {
			type: "megaAutoTurret", size: 12
		},
		ultra: {
			type: "ultraAutoTurret", size: 14
		},
		triple: {
			size: 6.5, x: 5.2, angle: 0, total: 3
		},
		penta: {
			size: 5.2, x: 6.5, angle: 0, total: 5
		},
		hepta: {
			size: 4, x: 6.5, angle: 0, total: 7
		}
	},
	makeDrive: {
		minion: {
			projectileType: 'minion'
		},
		sunchip: {
			projectileType: 'sunchip'
		},
		swarm: {
			projectileType: 'swarm', hatType: 'triangleHat', hatSize: 8, hatAngle: 180
		}
	},
	makeOver: {
		hybrid: {
			count: 1, independent: true, cycle: false
		}
	},

}

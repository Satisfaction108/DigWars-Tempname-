const war = require('../../terrain/war.js');

class DigWars {
    constructor(gameManager) { this.gameManager = gameManager; }
    start() { war.reset(); }
    loop() { war.tick(1000); }
    reset() { war.reset(); }
    redefine(gm) { this.gameManager = gm; }
}

module.exports = { DigWars };

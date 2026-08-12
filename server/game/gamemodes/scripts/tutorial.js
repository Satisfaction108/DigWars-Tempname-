const session = require('../../tutorialSession.js');

// Housekeeping only - the interesting work (plot claiming, scripted bots) is
// driven by the client's lesson progress through sockets.js.
class Tutorial {
    constructor(gameManager) { this.gameManager = gameManager; }
    start() {}
    loop() {
        session.tickReap();
        session.tickLeash();
        session.tickBaseGuard();
    }
    reset() {}
    redefine(gm) { this.gameManager = gm; }
}

module.exports = { Tutorial };

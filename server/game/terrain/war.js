// The team war layer for Dig Wars.
//
// Every gem a miner banks also feeds their team's war effort (war.add is
// called from vault.js and outposts.js on each credited chunk). Holding an
// outpost adds a slow trickle. The HUD bar is a live blue/red score - there
// is no win target and the round never ends from this layer.

let state = null;

function reset() {
    state = {
        blue: 0,
        red: 0,
        over: false,
        winner: 0,
        overUntil: 0,
    };
    return state;
}

function get() {
    return state || reset();
}

function add(team, amount) {
    if (Config.tutorial || !Config.war_enabled) return;
    if (!(amount > 0)) return;
    const s = get();
    if (team === TEAM_BLUE) s.blue += amount;
    else if (team === TEAM_RED) s.red += amount;
}

function broadcastWar() {
    const s = get();
    for (const client of global.gameManager.socketManager.clients) {
        client.talk('WR',
            Math.round(s.blue), Math.round(s.red),
            0,
            0,
            0,
            0,
            0);
    }
}

// Called once a second from the Dig Wars gamemode loop.
function tick(dtMs) {
    if (Config.tutorial || !Config.war_enabled) return;
    const s = get();

    if (Config.war_outpost_trickle > 0) {
        const trickle = Config.war_outpost_trickle * (dtMs / 1000);
        const outposts = require('./outposts.js');
        for (const o of outposts.getOutposts()) {
            if (o.team === TEAM_BLUE) s.blue += trickle;
            else if (o.team === TEAM_RED) s.red += trickle;
        }
    }

    broadcastWar();
}

module.exports = { tick, add, reset, get, broadcastWar };

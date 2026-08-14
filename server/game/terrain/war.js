// The team war layer for Dig Wars.
//
// Every gem a miner banks also feeds their team's war effort (war.add is
// called from vault.js and outposts.js on each credited chunk). The first
// team to reach Config.war_target wins the round: a victory banner is shown,
// every miner on the winning side gets a gem bonus into their personal bank,
// and after Config.war_round_over_ms the round score resets and a new war
// begins. Personal banked gems are never reset by the war layer - they are
// yours forever (the shop will spend them).

const gems = require('./gems.js');

const fmt = n => Math.round(n).toLocaleString('en-US');

let state = null;

function reset() {
    state = {
        blue: 0,
        red: 0,
        over: false,
        winner: 0,      // normalized for the wire: 0 none, 1 blue, 2 red
        overUntil: 0,
    };
    return state;
}

function get() {
    return state || reset();
}

// The one place war effort is credited. `team` is TEAM_BLUE / TEAM_RED.
function add(team, amount) {
    if (Config.tutorial || !Config.war_enabled) return;
    if (!(amount > 0)) return;
    const s = get();
    if (team === TEAM_BLUE) s.blue += amount;
    else if (team === TEAM_RED) s.red += amount;
}

const teamName = team => team === TEAM_BLUE ? 'Blue' : 'Red';

function broadcastWar() {
    const s = get();
    const winner = s.winner === TEAM_BLUE ? 1 : s.winner === TEAM_RED ? 2 : 0;
    const resetIn = s.over ? Math.max(0, Math.ceil(s.overUntil - Date.now())) : 0;
    for (const client of global.gameManager.socketManager.clients) {
        client.talk('WR',
            Math.round(s.blue), Math.round(s.red),
            Config.war_target | 0,
            s.over ? 1 : 0,
            winner,
            resetIn,
            Config.war_win_bonus | 0);
    }
}

function declareVictory(winner) {
    const s = get();
    s.over = true;
    s.winner = winner;
    s.overUntil = Date.now() + Config.war_round_over_ms;
    const name = teamName(winner);
    global.gameManager.socketManager.broadcast(
        `★ ${name} team wins the war! +${fmt(Config.war_win_bonus)} gems for every ${name} miner.`);
    payBonus(winner);
    broadcastWar();
}

function payBonus(winner) {
    const bonus = Config.war_win_bonus | 0;
    if (!(bonus > 0)) return;
    for (const player of global.gameManager.socketManager.players) {
        const body = player && player.body;
        if (!body || body.isDead() || body.team !== winner) continue;
        const cur = (body.socket && body.socket.gemBanked) || 0;
        gems.setBanked(body, cur + bonus);
        gems.talkGems(body, 0);
    }
    for (const bot of global.gameManager.gameHandler.bots) {
        if (!bot || bot.isDead() || bot.team !== winner) continue;
        bot.botBanked = (bot.botBanked || 0) + bonus;
        bot.bankedGems = bot.botBanked;
    }
}

// Called once a second from the Dig Wars gamemode loop.
function tick(dtMs) {
    if (Config.tutorial || !Config.war_enabled) return;
    const s = get();
    const now = Date.now();

    if (s.over) {
        if (now >= s.overUntil) {
            reset();
            global.gameManager.socketManager.broadcast(
                `A new war begins - first team to ${fmt(Config.war_target)} wins!`);
        }
        broadcastWar();
        return;
    }

    // Holding an outpost funnels a steady trickle of war effort, so territory
    // control matters even when nobody is actively mining it right now.
    if (Config.war_outpost_trickle > 0) {
        const trickle = Config.war_outpost_trickle * (dtMs / 1000);
        const outposts = require('./outposts.js');
        for (const o of outposts.getOutposts()) {
            if (o.team === TEAM_BLUE) s.blue += trickle;
            else if (o.team === TEAM_RED) s.red += trickle;
        }
    }

    if (s.blue >= Config.war_target || s.red >= Config.war_target) {
        declareVictory(s.blue >= Config.war_target ? TEAM_BLUE : TEAM_RED);
        return;
    }
    broadcastWar();
}

module.exports = { tick, add, reset, get, broadcastWar };

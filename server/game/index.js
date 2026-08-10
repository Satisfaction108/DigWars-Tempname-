const fs = require('fs');
const gems = require('./terrain/gems.js');
const mining = require('./terrain/mining.js');
const vault = require('./terrain/vault.js');
const outposts = require('./terrain/outposts.js');
const coreChambers = require('./terrain/coreChambers.js');
const { REGROW: TG_REGROW } = require('./terrain/terrainGrid.js');
const { chamberRingHit, chamberFaceRadius, chamberNormal } = coreChambers;

// A natural mirror bounce: the ring reflects a shot off the face it struck,
// keeping the incoming speed but redirecting it along the surface normal -
// grazing shots slide off, dead-on shots bounce back. No freeze, no swallow.
const REBOUND_KEEP = 0.85;    // how much of the shot's speed survives the bounce

function deflectBullet(chamber, body) {
    const dx = body.x - chamber.x, dy = body.y - chamber.y;
    const d = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const { nx, ny } = chamberNormal(chamber, ang);
    // mirror the velocity across the face normal, then keep a little momentum
    const vn = body.velocity.x * nx + body.velocity.y * ny;
    if (vn < 0) {
        body.velocity.x -= 2 * vn * nx;
        body.velocity.y -= 2 * vn * ny;
        body.velocity.x *= REBOUND_KEEP;
        body.velocity.y *= REBOUND_KEEP;
    }
    body.accel.x = 0;
    body.accel.y = 0;
    const outR = chamberFaceRadius(chamber, ang) + (body.realSize || body.size || 1) + 1;
    body.x = chamber.x + nx * outR;
    body.y = chamber.y + ny * outR;
}

function pushOutOfChamberRing(chamber, body) {
    const dx = body.x - chamber.x, dy = body.y - chamber.y;
    const d = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const { nx, ny } = chamberNormal(chamber, ang);
    const r = body.realSize || body.size || 1;
    const rest = chamberFaceRadius(chamber, ang) + r;
    if (d < rest) {
        body.x += nx * (rest - d);
        body.y += ny * (rest - d);
        const vn = body.velocity.x * nx + body.velocity.y * ny;
        if (vn < 0) {
            body.velocity.x -= vn * nx;
            body.velocity.y -= vn * ny;
        }
        const an = body.accel.x * nx + body.accel.y * ny;
        if (an < 0) {
            body.accel.x -= an * nx;
            body.accel.y -= an * ny;
        }
    }
}

class gameHandler {
    constructor(parent) {
        this.gameManager = parent;
        this.loopCounter = 0;
        this.loophealCounter = 0;
        this.bots = [];
        this.foods = [];
        this.nestFoods = [];
        this.enemyFoods = [];
        this.auraCollideTypes = ["miniboss", "tank", "food", "crasher"]
        this.naturallySpawnedBosses = [];
        this.bossTimer = 0;
        this.active = false;
        this.botStats = new Map();
        this.botTelemetryAt = Date.now();
        this.soakMspt = [];
        this.soakStartedAt = Date.now();
        this.pendingBotRespawns = 0;
        this.botChatAt = 0;
        this.botChatAiAvailable = null;
        this.botChatAiRetryAt = 0;
        Events.on('chatMessage', payload => this.handleBotChat(payload));
    }
    checkUsers = () => global.gameManager.clients.length >= 1 || !!Config.bot_soak_mode;

    // Gem and vault systems consume body-like actors. Keep socket players in
    // their existing wrapper shape and append bot bodies, which have no socket.
    gemActors = () => {
        const actors = [];
        for (const player of global.gameManager.socketManager.players) {
            const body = player && player.body;
            if (body && !body.isDead() && !body.isGhost) actors.push(player);
        }
        for (const bot of this.bots) {
            if (bot && !bot.isDead() && !bot.isGhost) actors.push(bot);
        }
        return actors;
    };
    
    collide = (instance, other) => {

        
        if (instance.noclip || other.noclip) return 0;

        
        instance.emit('collide', { body: instance, instance, other });
        other.emit('collide', { body: other, instance: other, other: instance });
        
        if (instance.tickHandler) instance.tickHandler(instance, instance, other);
        if (other.tickHandler) other.tickHandler(other, other, instance);

        if (instance.settings.no_collisions || 
            instance.master.master.settings.no_collisions || 
            other.settings.no_collisions || 
            other.master.master.settings.no_collisions
        )  return 0;

        
        for (const obj of [instance, other]) {
            if (obj.isGhost || obj.isDead()) {
                if (obj.isInGrid) {
                    obj.destroy();
                }
                return 0;
            }
        }

        
        if (
            (instance.isArenaCloser && !instance.alpha) ||
            (other.isArenaCloser && !other.alpha)
        ) return 0;

        
        if (
            instance.settings.hitsOwnType === "never" &&
            other.settings.hitsOwnType === "never" &&
            instance.team === other.team &&
            instance.type === "wall" && other.type === "wall"
        ) return;
        switch (true) {
            case instance.isPortal || other.isPortal:
                let [portal, otherBody] = instance.isPortal ? [instance, other] : [other, instance];

                if (portal.settings.destination && otherBody.isPlayer && otherBody.socket) {
                    global.gameManager.socketManager.sendToServer(otherBody.socket, portal.settings.destination);
                } else if (["bullet", "drone", "trap", "satellite"].includes(otherBody.type)) {
                    if (otherBody.master !== portal) otherBody.kill();
                }
                else if (!["wall", "aura"].includes(otherBody.type)) advancedcollide(portal, otherBody, false, false);
                break;
            case instance.type === "wall" || other.type === "wall":
                if (instance.type === "wall" && other.type === "wall") return;
                if (instance.type === "aura" || other.type === "aura") return;
                if (instance.type === "satellite" || other.type === "satellite") return;
                let wall = instance.type === "wall" ? instance : other;
                let entity = instance.type === "wall" ? other : instance;
                if (entity.isArenaCloser || entity.master.isArenaCloser) return;
                switch (wall.shape) {
                    case 4:
                        switch (wall.walltype) {
                            case 1:
                                mazewallcollide(wall, entity);
                                break;
                            default:
                                mazewallcustomcollide(wall, entity);
                                break;
                        }
                        break;
                    default:
                        mooncollide(wall, entity);
                        break;
                }
                break;
            case instance.isOutpostBanner || other.isOutpostBanner: {
                
                
                
                
                
                
                const banner = instance.isOutpostBanner ? instance : other;
                const body = instance.isOutpostBanner ? other : instance;
                if (banner.team === body.team) return;
                if (["bullet", "drone", "trap", "satellite", "swarm"].includes(body.type)) {
                    
                    advancedcollide(instance, other, true, true);
                    body.velocity.x = 0; body.velocity.y = 0;
                    body.accel.x = 0;    body.accel.y = 0;
                    body.kill();
                } else {
                    
                    
                    
                    advancedcollide(instance, other, true, true);
                    firmcollide(instance, other, 2);
                    
                    
                    
                    if (banner.pinX !== undefined) {
                        banner.x = banner.pinX; banner.y = banner.pinY;
                        banner.velocity.x = 0;  banner.velocity.y = 0;
                        banner.accel.x = 0;     banner.accel.y = 0;
                    }
                }
            } break;
            case instance.isCoreChamber || other.isCoreChamber: {
                
                
                
                
                
                
                
                
                
                
                
                
                const chamber = instance.isCoreChamber ? instance : other;
                const body = instance.isCoreChamber ? other : instance;
                if (chamber.isDead?.()) break;
                if (!chamberRingHit(chamber, body)) break;
                if (["bullet", "drone", "trap", "satellite", "swarm"].includes(body.type)) {
                    const enemy = chamber.team !== body.team;
                    if (enemy && chamber.chamberAlive) {
                        // the ring drinks hostile fire: absorbed outright
                        advancedcollide(instance, other, true, true);
                        body.velocity.x = 0; body.velocity.y = 0;
                        body.accel.x = 0;    body.accel.y = 0;
                        body.kill();
                    } else {
                        // friendly fire (and drones & friends) mirror off the face
                        deflectBullet(chamber, body);
                    }
                } else {
                    
                    
                    pushOutOfChamberRing(chamber, body);
                    
                    
                    if (chamber.pinX !== undefined) {
                        chamber.x = chamber.pinX; chamber.y = chamber.pinY;
                        chamber.velocity.x = 0;  chamber.velocity.y = 0;
                        chamber.accel.x = 0;     chamber.accel.y = 0;
                    }
                }
            } break;
            case instance.team === other.team &&
                (instance.settings.hitsOwnType === "pushOnlyTeam" ||
                    other.settings.hitsOwnType === "pushOnlyTeam"):
                {
                    let pusher = instance.settings.hitsOwnType === "pushOnlyTeam" ? instance : other;
                    let entity = instance.settings.hitsOwnType === "pushOnlyTeam" ? other : instance;
                    
                    if (
                        instance.settings.hitsOwnType === other.settings.hitsOwnType ||
                        entity.settings.hitsOwnType === "never"
                    ) return;
                    let a = 1 + 10 / (Math.max(entity.velocity.length, pusher.velocity.length) + 10);
                    advancedcollide(pusher, entity, false, false, a);
                }
                break;
            case instance.team === other.team &&
                (instance.settings.hitsOwnType === "droneCollision" &&
                    other.settings.hitsOwnType === "droneCollision"):
                {
                    let a = 1 + 10 / (Math.max(instance.velocity.length, other.velocity.length));
                    firmcollide(instance, other, a);
                }
                break;
            case (instance.type === "crasher" && other.type === "food" && instance.team === other.team) ||
                (other.type === "crasher" && instance.type === "food" && other.team === instance.team):
                firmcollide(instance, other);
                break;
            case instance.team !== other.team ||
                (instance.team === other.team && (instance.healer && instance.master.id !== other.id) || (other.healer && other.master.id !== instance.id)):
                
                if (instance.type === "aura") {
                    if (!(this.auraCollideTypes.includes(other.type))) return;
                } else if (other.type === "aura") {
                    if (!(this.auraCollideTypes.includes(instance.type))) return;
                }
                advancedcollide(instance, other, true, true);
                break;
            case instance.settings.hitsOwnType == "never" ||
                other.settings.hitsOwnType == "never":
                break;
            case instance.settings.hitsOwnType === other.settings.hitsOwnType:
                switch (instance.settings.hitsOwnType) {
                    case 'assembler': {
                        if (instance.assemblerLevel == null) instance.assemblerLevel = 1;
                        if (other.assemblerLevel == null) other.assemblerLevel = 1;
                        const [target1, target2] = (instance.id > other.id) ? [instance, other] : [other, instance];
                        if (
                            target2.assemblerLevel >= 10 || target1.assemblerLevel >= 10 ||
                            target1.isDead() || target2.isDead() ||
                            (target1.parent.id !== target2.parent.id &&
                                target1.parent.id != null &&
                                target2.parent.id != null)
                        ) {
                            advancedcollide(instance, other, false, false); 
                            break;
                        }
                        const better = (state) => (target1[state] > target2[state] ? target1[state] : target2[state]);
                        target1.assemblerLevel = Math.min(target2.assemblerLevel + target1.assemblerLevel, 10);
                        target1.SIZE = better('SIZE') * 1.15;
                        target1.SPEED = better('SPEED') * 0.9;
                        target1.HEALTH = better('HEALTH') * 1.2;
                        target1.health.amount = target1.health.max;
                        target1.DAMAGE = better('DAMAGE') * 1.1;
                        target2.kill();
                        target1.refreshBodyAttributes();
                        for (let i = 0; i < 10; ++i) {
                            const o = new Entity(target1, target1);
                            o.define('assemblerEffect');
                            o.team = target1.team;
                            o.color = target1.color;
                            o.SIZE = target1.SIZE / 1.5;
                            o.velocity = new Vector((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 15);
                            o.refreshBodyAttributes();
                            o.life();
                        }
                    } // don't break
                    case "push":
                        advancedcollide(instance, other, false, false);
                        break;
                    case "hard":
                        firmcollide(instance, other);
                        break;
                    case "hardWithBuffer":
                        firmcollide(instance, other, 30);
                        break;
                    case "hardOnlyTanks":
                        if (
                            instance.type === "tank" &&
                            other.type === "tank" &&
                            !instance.isDominator &&
                            !other.isDominator
                        ) {
                            switch (Config.train) {
                                case true:
                                    firmcollidehard(instance, other, 20);
                                    break;
                                default: 
                                    firmcollide(instance, other);
                                    break;
                            }
                            
                        };
                        break;
                    case "hardOnlyBosses":
                        if (instance.type === other.type && instance.type === "miniboss")
                            firmcollide(instance, other);
                        break;
                    case "repel":
                        simplecollide(instance, other);
                        break;
                }
                break;
        }
    };

    gameloop() {
        logs.loops.tally();
        logs.master.set();

        // Do entities life
        logs.entities.set();
        grid.clear();
        for (const instance of entities.values()) {
            if (instance.contemplationOfMortality() === 1) {
                if (Config.outbreak && !instance.zombified && (instance.isPlayer || instance.isBot)) {
                    instance.zombified = true;
                    instance.settings.no_collisions = true;
                    instance.alpha = 0;
                    instance.takeSelfie();
                    Config.OURBREAK_FUNCTIONS.zombify(instance);
                } else instance.destroy();
                continue;
            }

            // Reset collision array once at the beginning
            instance.collisionArray = [];

            // Handle physics only if not bonded
            if (instance.bond == null) {
                // Resolve the physical behavior from the last collision cycle.
                logs.physics.set();
                instance.physics();
                logs.physics.mark();
            }

            if (instance.activation.active || instance.isPlayer) {
                logs.entities.tally();
                // Think about my actions.
                logs.life.set();
                instance.life();
                logs.life.mark();
                // Take a selfie.
                logs.selfie.set();
                instance.takeSelfie();
                logs.selfie.mark();
                // Apply friction.
                instance.friction();
                instance.confinementToTheseEarthlyShackles();
            }

            // Terrain collision handled by the dedicated terrain loop below

            // Update axis-aligned bounding box
            instance.updateAABB(instance.activation.active);
            // Check collisions.
            logs.collide.set();
            for (const other of grid.query(instance.minX, instance.minY, instance.maxX, instance.maxY).values()) {
                this.collide(instance, other);
            }
            if (instance.isInGrid) grid.insert(instance, instance.minX, instance.minY, instance.maxX, instance.maxY);
            logs.collide.mark();
            if ((instance.touchingSizeWall === false || instance.collisionArray.length === 0) && instance.originalSize) {
                instance.SIZE = instance.originalSize;
                instance.originalSize = undefined;
            }
            if ((instance.touchingFovWall === false || instance.collisionArray.length === 0) && instance.originalFov) {
                instance.FOV = instance.originalFov;
                instance.originalFov = undefined;
            }
            // Check whether we want to live.
            logs.activation.set();
            instance.activation.update();
            logs.activation.mark();

            instance.emit('tick', { body: instance });
        }
        logs.entities.mark();
        logs.master.mark();
        // Update lastCycle only once
        global.gameManager.room.lastCycle = util.time();
        for (let i = 0; i < global.gameManager.clients.length; i++) {
            let client = global.gameManager.clients[i];
            if (client.status.readyToBroadcast) {
                client.view.gazeUpon();
            }
        }
    };

    foodloop() {
        if (global.gameManager.arenaClosed) return;

        // Helper to pick a type from a weighted set
        const pickFromChanceSet = (set) => {
            while (Array.isArray(set)) {
                set = set[ran.chooseChance(...set.map(e => e[0]))][1];
            }
            return set;
        };

        // Helper to spawn a food entity
        const spawnFoodEntity = (tile, layeredSet) => {
            const o = new Entity(tile);
            const type = pickFromChanceSet(layeredSet);
            o.define(type);
            o.facing = ran.randomAngle();
            o.team = TEAM_ENEMIES;
            o.isFood = true;
            return o;
        };

        if (Math.random() >= 0.1) return; // 1/10 chance to spawn food

        let totalFoods = 1;
        if (Math.random() < 0.2) { // 1/5 chance to spawn a group
            totalFoods = 1 + Math.floor(Math.random() * Config.food_group_cap);
        }

        // Helper for cleanup interval
        const setupCleanup = (arr, o) => {
            const loop = setInterval(() => {
                if (o.isDead()) {
                    util.remove(arr, arr.indexOf(o));
                    clearInterval(loop);
                }
            }, 1500);
        };

        // Nest food/enemy spawn
        if (Math.random() < 1 / 3 && global.gameManager.room.spawnable[TEAM_ENEMIES]) {
            // Enemy spawn
            if (Config.classic_food && Math.random() < 1 / 3 && this.enemyFoods.length < Config.enemy_cap_nest) {
                const tile = ran.choose(global.gameManager.room.spawnable[TEAM_ENEMIES]).randomInside();
                const o = spawnFoodEntity(tile, Config.classic_enemy_types_nest);
                this.enemyFoods.push(o);
                setupCleanup(this.enemyFoods, o);
            }
            // Nest food spawn
            if (this.nestFoods.length < Config.food_cap_nest) {
                const tile = ran.choose(global.gameManager.room.spawnable[TEAM_ENEMIES]).randomInside();
                for (let i = 0; i < totalFoods; i++) {
                    if (Config.classic_food) {
                        const o = spawnFoodEntity(tile, Config.classic_food_types_nest);
                        this.nestFoods.push(o);
                        setupCleanup(this.nestFoods, o);
                    } else {
                        const o = spawnFoodEntity(tile, Config.food_types_nest);
                        this.nestFoods.push(o);
                        setupCleanup(this.nestFoods, o);
                    }
                }
            }
        } else if (this.foods.length < Config.food_cap) {
            // Regular food spawn
            const tile = ran.choose(global.gameManager.room.spawnableDefault).randomInside();
            for (let i = 0; i < totalFoods; i++) {
                if (Config.classic_food) {
                    const o = spawnFoodEntity(tile, Config.classic_food_types);
                    this.foods.push(o);
                    setupCleanup(this.foods, o);
                } else {
                    const o = spawnFoodEntity(tile, Config.food_types);
                    this.foods.push(o);
                    setupCleanup(this.foods, o);
                }
            }
        }
    }

    regenHealthAndShield() {
        for (let instance of entities.values()) {
            if (instance.shield.max) {
                instance.shield.regenerate();
            }
            if (instance.health.amount) {
                instance.health.regenerate(instance.shield.max && instance.shield.max === instance.shield.amount);
            }
        }
    };
    
    maintainloop = () => {   
        // Upgrade bots's skill
        for (let i = 0; i < this.bots.length; i++) {
            let o = this.bots[i];
            if (o.skill.level < Config.level_cap && o.skill.level >= Config.bot_start_level) {
                o.skill.score += Config.bot_xp_gain;            
            }
        }
        
        if (this.checkUsers() && Config.enable_bosses && !this.naturallySpawnedBosses.length && this.bossTimer++ > Config.boss_spawn_cooldown) {
            this.bossTimer = -Config.boss_spawn_delay - 2;
            let selection = Config.boss_types[ran.chooseChance(...Config.boss_types.map((selection) => selection.chance))],
                amount = ran.chooseChance(...selection.amount) + 1;
            if (selection.message) {
                global.gameManager.socketManager.broadcast(selection.message);
            }
            global.gameManager.socketManager.broadcast(amount > 1 ? "Visitors are coming." : "A visitor is coming.");
            setSyncedTimeout(() => {
                let names = ran.chooseBossName(selection.nameType, amount);

                for (let i = 0; i < amount; i++) {
                    let spot, attempts = 30, name = names[i];
                    do { spot = getSpawnableArea(TEAM_ENEMIES, global.gameManager); } while (attempts-- && dirtyCheck(spot, 500));

                    let boss = new Entity(spot);
                    boss.define(selection.bosses.sort(() => 0.5 - Math.random())[i % selection.bosses.length]);
                    boss.team = TEAM_ENEMIES;
                    if (name) {
                        boss.name = name;
                    }

                    this.naturallySpawnedBosses.push(boss);
                    boss.on('dead', () => util.remove(this.naturallySpawnedBosses, this.naturallySpawnedBosses.indexOf(boss)));
                }

                global.gameManager.socketManager.broadcast(`${util.listify(names)} ${names.length == 1 ? 'has' : 'have'} arrived!`);
            }, Config.boss_spawn_delay * 30);
        }
    };

    quickMaintainLoop = () => {
        
        for (let i = 0; i < this.bots.length; i++) {
            let o = this.bots[i];
            o.skill.maintain();
            o.skillUp([ "atk", "hlt", "spd", "str", "pen", "dam", "rld", "mob", "rgn", "shi" ][ran.chooseChance(...Config.bot_skill_upgrade_chances)]);
            o.refreshSkills();
            if (o.leftoverUpgrades && o.upgrade(ran.irandomRange(0, o.upgrades.length))) {
                o.leftoverUpgrades--;
            }
        }
        
        if (!global.gameManager.arenaClosed && !global.cannotRespawn &&
            this.bots.length + this.pendingBotRespawns < Config.bot_cap) {
            let team = Config.mode === "tdm" || Config.mode === "tag" ? getWeakestTeam(global.gameManager) : undefined,
            limit = 20, 
            loc;
            do {
                loc = getSpawnableArea(team, global.gameManager);
            } while (limit-- && dirtyCheck(loc, 50, global.gameManager))

            this.spawnBots(loc, team);
        }
    }

    spawnBots(loc, team, existingName = null, lifecycle = null) {
        const nameKey = lifecycle?.nameKey || (existingName ? null : ran.chooseBotName());
        let botName = existingName || Config.bot_name_prefix + nameKey;
        let o = new Entity(loc);
        o.define(Config.spawn_class);
        o.define({ CONTROLLERS: ["unstick", "digWarsGoals", "minesRocks", "nearestDifferentMaster"] }, false, false, false);
        o.refreshBodyAttributes();
        o.isBot = true;
        o.botFamilyId = lifecycle?.familyId ?? o.id;
        o.botNameKey = nameKey;
        o.botRespawnsRemaining = lifecycle?.respawnsRemaining ?? ran.irandomRange(2, 3);
        // This value changes decisions, not damage or movement stats. A broad
        // spread keeps a lobby from feeling like eight copies of one machine.
        o.botSkill = util.clamp(ran.gauss(0.55, 0.25), 0.1, 0.95);
        o.name = botName;
        o.invuln = true;
        o.leftoverUpgrades = ran.chooseChance(...Config.bot_class_upgrade_chances);
        let color = Config.random_body_colors ? Math.floor(Math.random() * 20) : team ? getTeamColor(team) : "darkGrey";
        o.color.base = color;
        o.leaderboardColor = color;
        o.minimapColor = color;
        o.skill.reset();
        let leveling = setInterval(() => {
            if (o.skill.level < Config.bot_start_level) {
                o.skill.score += o.skill.levelScore;
                o.skill.maintain();
            } else clearInterval(leveling);
        }, 100)
        o.refreshBodyAttributes();
        if (team) o.team = team;
        if (Config.dig_wars) gems.initSatchel(o);
        this.bots.push(o);
        this.botStats.set(o.id, {
            id: o.id,
            name: o.name,
            skill: o.botSkill,
            spawnedAt: Date.now(),
            deaths: 0,
            gemsMined: 0,
            gemsBanked: 0,
            stuckEvents: 0,
            kills: 0,
            goalSeconds: {},
            stationarySeconds: 0,
            stationaryOver3s: 0,
            stationaryReported: false,
            lastX: o.x,
            lastY: o.y,
        });
        if (Config.tag) Config.tag_data.addBot(o), global.nextTagBotTeam = null;
        setTimeout(() => {
            if (o.isDead()) return;
            let CC = Class[o.defs[0]];
            if (!CC) CC = {};
            o.controllers = [];
            o.define({
                CONTROLLERS: CC.CONTROLLERS ? [...Class.bot.CONTROLLERS, ...CC.CONTROLLERS] : Class.bot.CONTROLLERS,
                FACING_TYPE: CC.FACING_TYPE ? CC.FACING_TYPE : Class.bot.FACING_TYPE,
                AI: Class.bot.AI,
            }, false, true, false)
            if (CC && CC.HEALING_TANK) {
                o.controllers = [];
                o.define({
                    CONTROLLERS: ["healTeamMasters", "minion", ["wanderAroundMap", { replicatePlayerMovement: true, lookAtGoal: true }]],
                    FACING_TYPE: CC.FACING_TYPE ? CC.FACING_TYPE : Class.bot.FACING_TYPE,
                    AI: Class.bot.AI,
                }, false, true, false);
            }
            o.name = botName;
            o.refreshBodyAttributes();
            o.invuln = false;
            o.on("define", () => {
                let CC = Class[o.defs[0]];
                if (CC && CC.HEALING_TANK) {
                    o.controllers = [];
                    o.define({ 
                        CONTROLLERS: ["healTeamMasters", "minion", ["wanderAroundMap", { replicatePlayerMovement: true, lookAtGoal: true }]],
                        FACING_TYPE: CC.FACING_TYPE ? CC.FACING_TYPE : Class.bot.FACING_TYPE,
                        AI: Class.bot.AI,
                    }, false, true, false);
                }
                o.define({ FACING_TYPE: CC.FACING_TYPE ? CC.FACING_TYPE : Class.bot.FACING_TYPE, AI: Class.bot.AI, }, false, true, false) 
            })
        }, 3000 + Math.floor(Math.random() * 7000));
        o.on('dead', () => {
            const stats = this.botStats.get(o.id);
            if (stats) stats.deaths++;
            util.remove(this.bots, this.bots.indexOf(o));

            // A bot is a little persistent character, not a disposable tank.
            // Keep its name through a small run of deaths, then let the slot
            // receive a genuinely new bot with a new name.
            const respawnsRemaining = o.botRespawnsRemaining || 0;
            if (respawnsRemaining > 0 && !global.gameManager.arenaClosed && !global.cannotRespawn) {
                this.pendingBotRespawns++;
                setTimeout(() => {
                    this.pendingBotRespawns = Math.max(0, this.pendingBotRespawns - 1);
                    if (global.gameManager.arenaClosed || global.cannotRespawn) {
                        ran.releaseBotName(o.botNameKey);
                        return;
                    }
                    const respawnTeam = o.team;
                    const respawnLoc = getSpawnableArea(respawnTeam, global.gameManager);
                    this.spawnBots(respawnLoc, respawnTeam, botName, {
                        familyId: o.botFamilyId,
                        nameKey: o.botNameKey,
                        respawnsRemaining: respawnsRemaining - 1,
                    });
                }, 6500 + Math.floor(Math.random() * 4500));
            } else {
                ran.releaseBotName(o.botNameKey);
                this.pendingBotRespawns++;
                setTimeout(() => {
                    this.pendingBotRespawns = Math.max(0, this.pendingBotRespawns - 1);
                    if (global.gameManager.arenaClosed || global.cannotRespawn) return;
                    const team = global.nextTagBotTeam || o.team;
                    this.spawnBots(getSpawnableArea(team, global.gameManager), team);
                }, 6500 + Math.floor(Math.random() * 4500));
            }
        });
    };

    botChatReply(bot, rawMessage) {
        const message = String(rawMessage || '').trim().toLowerCase();
        const saysNo = /^(nah|no|nope|dont|don't|i dont|i don't|not really|maybe not)/.test(message);
        if (bot._askedDiscordAt && Date.now() - bot._askedDiscordAt < 25_000) {
            bot._askedDiscordAt = 0;
            return saysNo ? ran.choose(['all good lol', 'fair enough', 'no worries']) : ran.choose(['alr ill add u lol', 'bet, ill add u', 'sounds good']);
        }
        if (/^(hi|hey|hello|yo|sup|heyy|hiya)\b/.test(message)) {
            return ran.choose(['yo', 'hey', 'yo lol', 'sup', 'heyy']);
        }
        if (/discord|dc\b/.test(message)) {
            bot._askedDiscordAt = Date.now();
            return ran.choose(['whats ur discord', 'u got discord?', "what's ur dc", 'drop ur discord']);
        }
        if (/^(thanks|thx|ty)\b/.test(message)) return ran.choose(['np', 'all good', 'yw lol']);
        if (/^(bye|cya|later)\b/.test(message)) return ran.choose(['later', 'cya', 'peace']);
        return ran.choose(['fr', 'lol yeah', 'true', 'same tbh', 'no way lol', 'yeah i feel that', 'lmao']);
    }

    sanitizeBotReply(reply) {
        return String(reply || '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/^['"`]+|['"`]+$/g, '')
            .trim()
            .toLowerCase()
            .slice(0, 96);
    }

    async aiBotChatReply(bot, rawMessage) {
        const fallback = this.botChatReply(bot, rawMessage);
        const now = Date.now();
        if (!Config.bot_chat_ai_enabled || typeof fetch !== 'function' || now < this.botChatAiRetryAt)
            return fallback;

        bot._chatHistory ??= [];
        const history = bot._chatHistory.slice(-8);
        const system = "you are a casual player in a fast multiplayer tank game. reply like a real teen in one short sentence, mostly lowercase, with normal slang. do not sound like an assistant, do not write paragraphs, do not claim you actually added someone or performed an action outside the game, and do not mention being a bot or an ai.";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Config.bot_chat_timeout_ms);
        try {
            const headers = { 'content-type': 'application/json' };
            if (Config.bot_chat_api_key) headers.authorization = `Bearer ${Config.bot_chat_api_key}`;
            const response = await fetch(Config.bot_chat_api_url, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model: Config.bot_chat_model,
                    stream: false,
                    messages: [
                        { role: 'system', content: system },
                        ...history,
                        { role: 'user', content: String(rawMessage).slice(0, 160) },
                    ],
                    options: { temperature: 0.9, num_predict: 32 },
                }),
            });
            if (!response.ok) throw new Error(`chat api ${response.status}`);
            const data = await response.json();
            const reply = this.sanitizeBotReply(data?.message?.content || data?.choices?.[0]?.message?.content);
            if (!reply) throw new Error('empty chat reply');
            this.botChatAiAvailable = true;
            bot._chatHistory.push({ role: 'user', content: String(rawMessage).slice(0, 160) });
            bot._chatHistory.push({ role: 'assistant', content: reply });
            bot._chatHistory = bot._chatHistory.slice(-8);
            return reply;
        } catch {
            this.botChatAiAvailable = false;
            this.botChatAiRetryAt = now + 60_000;
            return fallback;
        } finally {
            clearTimeout(timer);
        }
    }

    handleBotChat({ message, socket }) {
        if (!Config.dig_wars || !socket?.player?.body || typeof message !== 'string') return;
        const player = socket.player.body;
        const text = message.trim();
        if (!text || text.startsWith('$') || player.isDead()) return;

        const nearby = this.bots.filter(bot => bot && !bot.isDead() && !bot.isGhost)
            .map(bot => ({ bot, distance: Math.hypot(bot.x - player.x, bot.y - player.y) }))
            .filter(entry => entry.distance <= 760)
            .sort((a, b) => a.distance - b.distance);
        if (!nearby.length) return;

        const greeting = /^(hi|hey|hello|yo|sup|heyy|hiya)\b/i.test(text);
        const selected = nearby.find(({ bot }) => !bot._chatPending && Date.now() >= (bot._nextChatAt || 0) &&
            (greeting ? Math.random() < 0.8 : Math.random() < 0.22));
        if (!selected) return;

        const bot = selected.bot;
        bot._chatPending = true;
        bot._nextChatAt = Date.now() + 9000 + Math.random() * 7000;
        setTimeout(async () => {
            try {
                const reply = await this.aiBotChatReply(bot, text);
                if (!bot.isDead() && !bot.isGhost && Math.hypot(bot.x - player.x, bot.y - player.y) <= 900)
                    bot.say(reply);
            } finally {
                bot._chatPending = false;
            }
        }, 1100 + Math.random() * 1500);
    }

    botAmbientChat() {
        const now = Date.now();
        if (!Config.dig_wars || now < this.botChatAt || this.bots.length < 2) return;
        this.botChatAt = now + 12_000 + Math.random() * 18_000;
        const pairs = [];
        for (let i = 0; i < this.bots.length; i++) {
            for (let j = i + 1; j < this.bots.length; j++) {
                const a = this.bots[i], b = this.bots[j];
                if (a.isDead() || b.isDead() || a.team !== b.team) continue;
                if (Math.hypot(a.x - b.x, a.y - b.y) < 430) pairs.push([a, b]);
            }
        }
        if (!pairs.length || Math.random() > 0.3) return;
        const [a, b] = ran.choose(pairs);
        a.say(ran.choose(['u heading mid?', 'u mining here too?', 'hold up lol', 'we got this']));
        setTimeout(() => {
            if (!b.isDead() && Math.hypot(a.x - b.x, a.y - b.y) < 650)
                b.say(ran.choose(['yeah lol', 'yep', 'on my way', 'bet', 'same here']));
        }, 1200 + Math.random() * 1600);
    }

    sampleBotTelemetry() {
        const now = Date.now();
        const dt = Math.min(1, Math.max(0, now - this.botTelemetryAt) / 1000);
        this.botTelemetryAt = now;
        for (const bot of this.bots) {
            let stats = this.botStats.get(bot.id);
            if (!stats) {
                stats = {
                    id: bot.id,
                    name: bot.name,
                    skill: bot.botSkill,
                    spawnedAt: now,
                    deaths: 0,
                    gemsMined: 0,
                    gemsBanked: 0,
                    stuckEvents: 0,
                    kills: 0,
                    goalSeconds: {},
                    stationarySeconds: 0,
                    stationaryOver3s: 0,
                    stationaryReported: false,
                    lastX: bot.x,
                    lastY: bot.y,
                };
                this.botStats.set(bot.id, stats);
            }
            const goal = bot._digWarsGoal || 'wander';
            stats.goalSeconds[goal] = (stats.goalSeconds[goal] || 0) + dt;
            stats.gemsMined = bot.gemsMined || 0;
            stats.gemsBanked = bot.botGemsBanked || 0;
            stats.stuckEvents = bot._unstickCount || 0;
            stats.kills = bot.killCount ? bot.killCount.solo | 0 : 0;
            const moved = Math.hypot(bot.x - stats.lastX, bot.y - stats.lastY);
            const intentionallyMining = goal === 'mine' && bot.grindTouchUntil > now;
            if (!intentionallyMining && moved < Math.max(0.5, (bot.size || 1) * 0.05)) {
                stats.stationarySeconds += dt;
                if (stats.stationarySeconds > 3 && !stats.stationaryReported) {
                    stats.stationaryOver3s++;
                    stats.stationaryReported = true;
                }
            } else {
                stats.stationarySeconds = 0;
                stats.stationaryReported = false;
            }
            stats.lastX = bot.x;
            stats.lastY = bot.y;
        }
    }

    writeBotSoakReport() {
        if (!Config.bot_soak_report_path) return;
        this.sampleBotTelemetry();
        const bots = Array.from(this.botStats.values()).map(stats => ({
            ...stats,
            alive: this.bots.some(bot => bot.id === stats.id),
            stationaryReported: undefined,
            lastX: undefined,
            lastY: undefined,
        }));
        const elapsedSeconds = Math.max(1, (Date.now() - this.soakStartedAt) / 1000);
        const totalGoalSeconds = bots.reduce((sum, bot) =>
            sum + Object.values(bot.goalSeconds).reduce((a, b) => a + b, 0), 0);
        const wanderSeconds = bots.reduce((sum, bot) => sum + (bot.goalSeconds.wander || 0), 0);
        const report = {
            elapsedSeconds,
            botCap: Config.bot_cap,
            msptAverage: this.soakMspt.length
                ? this.soakMspt.reduce((a, b) => a + b, 0) / this.soakMspt.length
                : 0,
            bots,
            summary: {
                botInstances: bots.length,
                botsBankedAtLeastOnce: bots.filter(bot => bot.gemsBanked > 0).length,
                wanderPercent: totalGoalSeconds ? wanderSeconds / totalGoalSeconds * 100 : 0,
                stationaryBotsOver3s: bots.filter(bot => bot.stationaryOver3s > 0).length,
                stuckEventsPerBotPerMinute: bots.length
                    ? bots.reduce((sum, bot) => sum + bot.stuckEvents, 0) / bots.length / (elapsedSeconds / 60)
                    : 0,
            },
        };
        try {
            fs.writeFileSync(Config.bot_soak_report_path, JSON.stringify(report, null, 2));
        } catch (error) {
            console.error(`[BOT SOAK] Could not write report: ${error.message}`);
        }
    }

    run() {
        this.active = true;
        if (Config.bot_soak_mode && Config.bot_soak_duration_ms > 0) {
            this.soakTimer = setTimeout(() => {
                this.writeBotSoakReport();
                this.stop();
            }, Config.bot_soak_duration_ms);
        }
        let gameLoop = setInterval(() => {
            if (!this.active) return clearInterval(gameLoop);
            if (this.checkUsers()) {
                try {
                    const cycleStarted = performance.now();
                    this.gameloop();
                    if (Config.bot_soak_mode) {
                        this.soakMspt.push(performance.now() - cycleStarted);
                        if (this.soakMspt.length > 3000) this.soakMspt.shift();
                    }
                    syncedDelaysLoop();
                    if (Config.enable_food) this.foodloop();
                    global.gameManager.roomLoop();
                    global.gameManager.gamemodeManager.request("quickloop");
                } catch (e) {
                    global.gameManager.gameSpeedCheckHandler.onError(e);
                    this.stop();
                };
            }
        }, global.gameManager.room.cycleSpeed);
        let maintainloop = setInterval(() => {
            if (!this.active) return clearInterval(maintainloop);
            global.gameManager.gameSpeedCheckHandler.update();
            global.gameManager.gamemodeManager.request("loop");
            this.maintainloop();
        }, 1000);
        let otherloop = setInterval(() => {
            if (!this.active) return clearInterval(otherloop);
            this.quickMaintainLoop();
            this.sampleBotTelemetry();
            this.botAmbientChat();
            global.gameManager.socketManager.chatLoop();
        }, 200)
        let healingLoop = setInterval(() => {
            if (!this.active) return clearInterval(healingLoop);
            this.regenHealthAndShield();
        }, Config.regenerate_tick);

        
        
        
        
        const mineBudget = new Map(); 
        
        
        const announceEmerald = (miner) => {
            const who = miner && miner.name ? miner.name : "An unnamed player";
            global.gameManager.socketManager.broadcast(`${who} has destroyed an emerald shard!`);
        };
        const rootMaster = (e) => {
            let m = e, hops = 0;
            while (m.master && m.master !== m && hops++ < 4) m = m.master;
            return m;
        };
        
        
        
        
        const crush = (instance, ms) => {
            if (!instance.health || !(instance.health.max > 0)) return;
            const dmg = instance.health.max * TG_REGROW.CRUSH_DPS_FRAC * (ms / 1000);
            instance.health.amount -= dmg;
            if (instance.health.amount <= 0 && !instance._crushedNoted) {
                instance._crushedNoted = true;
                instance.deathCause = "rock";
                instance.dontSendDeathMessage = true;
                if (instance.sendMessage) instance.sendMessage("You were crushed by the living wall.");
            }
        };
        let lastTerrainTick = Date.now();
        let terrainLoop = setInterval(() => {
            if (!this.active) return clearInterval(terrainLoop);
            const _tg = global.gameManager.terrainGrid;
            if (!_tg || !_tg._voronoiMap) return;
            if (mineBudget.size > 256) mineBudget.clear(); // stale-id backstop
            
            
            const tickNow = Date.now();
            const tickMs = Math.min(50, tickNow - lastTerrainTick) || 8;
            lastTerrainTick = tickNow;
            _tg.regrowTick(tickNow);
            const growingNow = _tg.growingRocks().length > 0;
            const gemActors = this.gemActors();
            for (const instance of global.entities.values()) {
                if (!instance || instance.isDead?.()) continue;
                if (instance.noclip || instance.godmode || instance.isArenaCloser) continue;
                
                
                
                
                
                if (instance.isOutpostBanner || instance.isCoreChamber) continue;

                if (instance.isGemPickup) {
                    
                    
                    if (instance.chamberHome !== undefined) {
                        coreChambers.tickContainedGem(instance);
                    } else {
                        
                        gems.tickGem(instance, _tg, gemActors);
                        
                        
                        if (growingNow) _tg.pushCircleFromGrowing(instance, instance.realSize, tickNow);
                    }
                } else if (instance.type === 'tank' || instance.type === 'miniboss' ||
                           instance.type === 'minion') {
                    const r = instance.realSize;
                    const p = _tg.pushCircleFromVoronoi(instance, r);
                    let dx = p.dx, dy = p.dy;
                    const nowT = Date.now();
                    
                    
                    
                    
                    let entombed = false;
                    if (growingNow) {
                        const g = _tg.pushCircleFromGrowing(instance, r, tickNow);
                        entombed = g.entombed;
                        if (g.dx !== 0 || g.dy !== 0) { dx += g.dx; dy += g.dy; }
                        
                        
                        if (g.buried) {
                            instance.velocity.x = 0; instance.velocity.y = 0;
                            instance.accel.x = 0;    instance.accel.y = 0;
                        }
                    }
                    
                    
                    
                    
                    if (_tg.pointInRock(instance.x, instance.y)) {
                        entombed = true;
                        instance.velocity.x = 0; instance.velocity.y = 0;
                        instance.accel.x = 0;    instance.accel.y = 0;
                    }
                    if (entombed && !instance.invuln) crush(instance, tickMs);
                    else instance._crushedNoted = false;
                    if (dx !== 0 || dy !== 0) {
                        const pLen = Math.hypot(dx, dy);
                        const nx = dx / pLen, ny = dy / pLen;
                        const vDot = instance.velocity.x * nx + instance.velocity.y * ny;
                        if (vDot < 0) {
                            instance.velocity.x -= vDot * nx;
                            instance.velocity.y -= vDot * ny;
                        }
                        
                        
                        
                        
                        instance.grindTouchUntil = nowT + 300;
                        instance.grindNx = nx;
                        instance.grindNy = ny;
                    }
                    
                    
                    
                    
                    
                    
                    if (instance.type === 'tank' && instance.grindTouchUntil > nowT) {
                        const gsec = mining.grindSecondsFor(instance);
                        if (gsec) {
                            instance.grindAcc = Math.min(
                                _tg.baseRockHealth * 0.6, 
                                (instance.grindAcc || 0) + (_tg.baseRockHealth / gsec) * 0.008
                            );
                            if (!instance.grindLast || nowT - instance.grindLast >= 150) {
                                instance.grindLast = nowT;
                                const rock = _tg.rockHitByCircle(instance.x, instance.y, r * 1.06)
                                    || (growingNow ? _tg.growingRockHitByCircle(instance.x, instance.y, r * 1.06, tickNow) : null);
                                if (rock) {
                                    let mb = mineBudget.get(instance.id);
                                    if (!mb || nowT - mb.t >= 1000) {
                                        mb = { t: nowT, left: _tg.baseRockHealth * 1.5 };
                                        mineBudget.set(instance.id, mb);
                                    }
                                    const dmg = Math.min(instance.grindAcc, mb.left);
                                    if (dmg > 0) {
                                        mb.left -= dmg;
                                        instance.grindAcc -= dmg;
                                        // soft spark at the hull contact point
                                        const wasGrowing = rock.growing;
                                        const destroyed = _tg.damageRock(rock, dmg,
                                            instance.x - (instance.grindNx || 0) * r,
                                            instance.y - (instance.grindNy || 0) * r,
                                            true);
                                        
                                        
                                        if (destroyed) instance.rocksMined = (instance.rocksMined || 0) + 1;
                                        if (destroyed && rock.ore && !wasGrowing) {
                                            instance.gemsMined = (instance.gemsMined || 0) + 1;
                                            gems.spawnOreBurst(rock, instance);
                                            if (rock.ore === 4) announceEmerald(instance);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if (instance.type === 'bullet' || instance.type === 'drone' ||
                           instance.type === 'trap'   || instance.type === 'satellite' ||
                           instance.type === 'swarm') {
                    
                    
                    
                    
                    
                    
                    
                    const rock = _tg.rockHitByCircle(instance.x, instance.y, instance.realSize)
                        || (growingNow ? _tg.growingRockHitByCircle(instance.x, instance.y, instance.realSize, tickNow) : null);
                    if (rock) {
                        const owner = rootMaster(instance);
                        const nowT = Date.now();
                        let mb = mineBudget.get(owner.id);
                        if (!mb || nowT - mb.t >= 1000) {
                            
                            mb = { t: nowT, left: _tg.baseRockHealth * 3 };
                            mineBudget.set(owner.id, mb);
                        }
                        
                        
                        
                        
                        
                        
                        
                        const raw = _tg.baseRockHealth / mining.rockHitsFor(owner, instance)
                                  * mining.skillFactor(owner);
                        const dmg = Math.min(raw, mb.left);
                        if (dmg > 0) {
                            mb.left -= dmg;
                            const wasGrowing = rock.growing;
                            const destroyed = _tg.damageRock(rock, dmg, instance.x, instance.y);
                            // breaking an ore cell erupts its gem payout -
                            
                            
                            if (destroyed) owner.rocksMined = (owner.rocksMined || 0) + 1;
                            if (destroyed && rock.ore && !wasGrowing) {
                                owner.gemsMined = (owner.gemsMined || 0) + 1;
                                gems.spawnOreBurst(rock, owner);
                                if (rock.ore === 4) announceEmerald(owner);
                            }
                        }
                        
                        
                        instance.velocity.x = 0; instance.velocity.y = 0;
                        instance.accel.x = 0;    instance.accel.y = 0;
                        instance.kill();
                    }
                }
            }

            
            const vNow = Date.now();
            vault.tick(gemActors,
                       Math.min(50, vNow - (this._lastVaultTick || vNow)) || 8);
            
            outposts.tick(global.gameManager.socketManager.players,
                          Math.min(50, vNow - (this._lastVaultTick || vNow)) || 8);
            
            coreChambers.tick(Math.min(50, vNow - (this._lastVaultTick || vNow)) || 8);
            this._lastVaultTick = vNow;

            
            
            
            
            
            if (_tg.rockEvents.length) {
                const payload = JSON.stringify(_tg.rockEvents);
                _tg.rockEvents.length = 0;
                for (const client of global.gameManager.socketManager.clients) {
                    client.talk('TR', payload);
                }
            }
        }, 8);
    }
    stop() {
        this.active = false;
        if (this.soakTimer) {
            clearTimeout(this.soakTimer);
            this.soakTimer = null;
        }
    }
}

module.exports = { gameHandler };

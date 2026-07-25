const gems = require('./terrain/gems.js');
const mining = require('./terrain/mining.js');
const vault = require('./terrain/vault.js');
const { REGROW: TG_REGROW } = require('./terrain/terrainGrid.js');

class gameHandler {
    constructor() {
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
    }
    checkUsers = () => global.gameManager.clients.length >= 1;
    // Collision stuff
    collide = (instance, other) => {

        // Fast exit for noclip or ghosts
        if (instance.noclip || other.noclip) return 0;

        // Emit collision events
        instance.emit('collide', { body: instance, instance, other });
        other.emit('collide', { body: other, instance: other, other: instance });
        // Custom tick handlers for bullet entities
        if (instance.tickHandler) instance.tickHandler(instance, instance, other);
        if (other.tickHandler) other.tickHandler(other, other, instance);

        if (instance.settings.no_collisions || 
            instance.master.master.settings.no_collisions || 
            other.settings.no_collisions || 
            other.master.master.settings.no_collisions
        )  return 0;

        // Ghost checks (merged for less code repetition)
        for (const obj of [instance, other]) {
            if (obj.isGhost || obj.isDead()) {
                if (obj.isInGrid) {
                    obj.destroy();
                }
                return 0;
            }
        }

        // Fast exit for inactive or invisible entities
        if (
            (instance.isArenaCloser && !instance.alpha) ||
            (other.isArenaCloser && !other.alpha)
        ) return 0;

        // Fast exit for wall-vs-wall with never-collide
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
            case instance.team === other.team &&
                (instance.settings.hitsOwnType === "pushOnlyTeam" ||
                    other.settings.hitsOwnType === "pushOnlyTeam"):
                {
                    let pusher = instance.settings.hitsOwnType === "pushOnlyTeam" ? instance : other;
                    let entity = instance.settings.hitsOwnType === "pushOnlyTeam" ? other : instance;
                    // Dominator / Mothership collisions
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
                // Exits if the aura is not hitting a boss, tank, food, or crasher
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
                            advancedcollide(instance, other, false, false); // continue push
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
        // Spawn bosses
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
        // Auto get score
        for (let i = 0; i < this.bots.length; i++) {
            let o = this.bots[i];
            o.skill.maintain();
            o.skillUp([ "atk", "hlt", "spd", "str", "pen", "dam", "rld", "mob", "rgn", "shi" ][ran.chooseChance(...Config.bot_skill_upgrade_chances)]);
            o.refreshSkills();
            if (o.leftoverUpgrades && o.upgrade(ran.irandomRange(0, o.upgrades.length))) {
                o.leftoverUpgrades--;
            }
        }
        // Add new bots if arena is open
        if (!global.gameManager.arenaClosed && !global.cannotRespawn && this.bots.length < Config.bot_cap) {
            let team = Config.mode === "tdm" || Config.mode === "tag" ? getWeakestTeam(global.gameManager) : undefined,
            limit = 20, // give up after 20 attempts and just pick whatever is currently chosen
            loc;
            do {
                loc = getSpawnableArea(team, global.gameManager);
            } while (limit-- && dirtyCheck(loc, 50, global.gameManager))

            this.spawnBots(loc, team);
        }
    }

    spawnBots(loc, team) {
        let botName = Config.bot_name_prefix + ran.chooseBotName();
        let o = new Entity(loc);
        o.define(Config.spawn_class);
        o.define({ CONTROLLERS: ["nearestDifferentMaster"] }, false, false, false);
        o.refreshBodyAttributes();
        o.isBot = true;
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
        this.bots.push(o);
        if (Config.tag) Config.tag_data.addBot(o), global.nextTagBotTeam = null;
        setTimeout(() => {
            // allow them to move
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
                o.define({ FACING_TYPE: CC.FACING_TYPE ? CC.FACING_TYPE : Class.bot.FACING_TYPE, AI: Class.bot.AI, }, false, true, false) // Just reoverride the facing type.
            })
        }, 3000 + Math.floor(Math.random() * 7000));
        o.on('dead', () => {
            setTimeout(() => {
                if (global.nextTagBotTeam) {
                    let loc = getSpawnableArea(global.nextTagBotTeam, global.gameManager);
                    this.spawnBots(loc, global.nextTagBotTeam);
                }
            }, 10)
            util.remove(this.bots, this.bots.indexOf(o));
        });
    };

    run() {
        this.active = true;
        let gameLoop = setInterval(() => {
            if (!this.active) return clearInterval(gameLoop);
            if (this.checkUsers()) {
                try {
                    this.gameloop();
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
            global.gameManager.socketManager.chatLoop();
        }, 200)
        let healingLoop = setInterval(() => {
            if (!this.active) return clearInterval(healingLoop);
            this.regenHealthAndShield();
        }, Config.regenerate_tick);

        // Mining budget: each player may remove at most ONE rock's worth of
        // HP per second, no matter the build — an octo can't strip the wall.
        // Overflow damage is discarded (bullets still die on the face), so
        // damage just abruptly stops until the next second.
        const mineBudget = new Map(); // ownerId -> { t: windowStart, left: hp }
        // Emerald ticker: cracking one of the arena's three emerald cells is
        // a server-wide event, just like a boss arrival.
        const announceEmerald = (miner) => {
            const who = miner && miner.name ? miner.name : "An unnamed player";
            global.gameManager.socketManager.broadcast(`${who} has destroyed an emerald shard!`);
        };
        const rootMaster = (e) => {
            let m = e, hops = 0;
            while (m.master && m.master !== m && hops++ < 4) m = m.master;
            return m;
        };
        // Being crushed: a body pinned by rising stone (or sealed inside a
        // rock that finished growing around it) bleeds out slowly instead of
        // being teleported anywhere. It keeps full control the whole time —
        // walk out through a seam and the bleeding stops.
        const crush = (instance, ms) => {
            if (!instance.health || !(instance.health.max > 0)) return;
            const dmg = instance.health.max * TG_REGROW.CRUSH_DPS_FRAC * (ms / 1000);
            instance.health.amount -= dmg;
            if (instance.health.amount <= 0 && !instance._crushedNoted) {
                instance._crushedNoted = true;
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
            // THE LIVING WALL: timers, the frontier rubber band, completions
            // and emerald reseeding — self-throttled to 2Hz inside.
            const tickNow = Date.now();
            const tickMs = Math.min(50, tickNow - lastTerrainTick) || 8;
            lastTerrainTick = tickNow;
            _tg.regrowTick(tickNow);
            const growingNow = _tg.growingRocks().length > 0;
            const liveGems = [];
            for (const instance of global.entities.values()) {
                if (!instance || instance.isDead?.()) continue;
                if (instance.noclip || instance.godmode || instance.isArenaCloser) continue;

                if (instance.isGemPickup) {
                    // loot pass: slide out of rock, home toward miners, collect
                    gems.tickGem(instance, _tg, global.gameManager.socketManager.players);
                    // rising stone shoves loose gems aside too (never crushes
                    // them — they just get nudged out of the way)
                    if (growingNow) _tg.pushCircleFromGrowing(instance, instance.realSize, tickNow);
                    if (instance.gemValue > 0) liveGems.push(instance);
                } else if (instance.type === 'tank' || instance.type === 'miniboss' ||
                           instance.type === 'minion') {
                    const r = instance.realSize;
                    const p = _tg.pushCircleFromVoronoi(instance, r);
                    let dx = p.dx, dy = p.dy;
                    const nowT = Date.now();
                    // ── THE LIVING WALL pushes back ──
                    // Rising stone displaces bodies along its own outline. If
                    // it can't get you clear you're pinned, not teleported:
                    // you keep control and bleed until you slip out or die.
                    let entombed = false;
                    if (growingNow) {
                        const g = _tg.pushCircleFromGrowing(instance, r, tickNow);
                        entombed = g.entombed;
                        if (g.dx !== 0 || g.dy !== 0) { dx += g.dx; dy += g.dy; }
                    }
                    // sealed inside stone that finished growing around you:
                    // the ordinary face push has nowhere to put you
                    if (!entombed && _tg.pointInRock(instance.x, instance.y)) entombed = true;
                    if (entombed) crush(instance, tickMs);
                    else instance._crushedNoted = false;
                    if (dx !== 0 || dy !== 0) {
                        const pLen = Math.hypot(dx, dy);
                        const nx = dx / pLen, ny = dy / pLen;
                        const vDot = instance.velocity.x * nx + instance.velocity.y * ny;
                        if (vDot < 0) {
                            instance.velocity.x -= vDot * nx;
                            instance.velocity.y -= vDot * ny;
                        }
                        // remember the wall contact: physics only shoves the
                        // tank on GAME ticks (30Hz), so displacement is only
                        // seen on ~1 in 4 terrain ticks — grinding must keep
                        // accumulating between them or it runs at 1/4 rate
                        instance.grindTouchUntil = nowT + 300;
                        instance.grindNx = nx;
                        instance.grindNy = ny;
                    }
                    // Body grinding: a tank pressing its hull into the face
                    // chips it — how ram tanks (and ram builds) mine. Pure
                    // body-damage scaling (mining.js): 0 pts = harmless
                    // hull, 1 pt = crawl, 12 pts ≈ 3s/rock. Damage lands in
                    // 150ms chunks flagged as grind events so the client
                    // renders soft grinding sparks, not bullet impacts.
                    if (instance.type === 'tank' && instance.grindTouchUntil > nowT) {
                        const gsec = mining.grindSecondsFor(instance);
                        if (gsec) {
                            instance.grindAcc = Math.min(
                                _tg.baseRockHealth * 0.6, // no banking huge charges
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
                                        // a rock killed mid-rise pays nothing:
                                        // its seam never finished forming
                                        if (destroyed && rock.ore && !wasGrowing) {
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
                    // Same Voronoi geometry the bodies collide with: touching a
                    // rock face (or spawning inside one — e.g. a long barrel
                    // poking into the rock) kills the projectile like hitting
                    // a polygon, and chips the rock's health. One rule, no
                    // special cases.
                    // rising stone is stone: a nub eats bullets exactly like a
                    // finished rock does (and dies fast, since it's soft)
                    const rock = _tg.rockHitByCircle(instance.x, instance.y, instance.realSize)
                        || (growingNow ? _tg.growingRockHitByCircle(instance.x, instance.y, instance.realSize, tickNow) : null);
                    if (rock) {
                        const owner = rootMaster(instance);
                        const nowT = Date.now();
                        let mb = mineBudget.get(owner.id);
                        if (!mb || nowT - mb.t >= 1000) {
                            // 1.5 rocks' worth of HP per player per second
                            mb = { t: nowT, left: _tg.baseRockHealth * 1.5 };
                            mineBudget.set(owner.id, mb);
                        }
                        // Mining power = HITS-TO-BREAK per tank family
                        // (terrain/mining.js): each contact removes
                        // (barren rock HP / hits) × a bounded skill factor.
                        // Bullet damage/pen/health investment matters, but
                        // only within 0.6×..1× — the table stays the truth
                        // (its numbers are the maxed-build hit counts). Ore
                        // HP tiers and the budget stack on top.
                        const raw = _tg.baseRockHealth / mining.rockHitsFor(owner, instance)
                                  * mining.skillFactor(owner);
                        const dmg = Math.min(raw, mb.left);
                        if (dmg > 0) {
                            mb.left -= dmg;
                            const wasGrowing = rock.growing;
                            const destroyed = _tg.damageRock(rock, dmg, instance.x, instance.y);
                            // breaking an ore cell erupts its gem payout —
                            // unless it was still rising, in which case there
                            // was nothing in it to spill yet
                            if (destroyed && rock.ore && !wasGrowing) {
                                gems.spawnOreBurst(rock, owner);
                                if (rock.ore === 4) announceEmerald(owner);
                            }
                        }
                        // Freeze the projectile so its death fade stays at the
                        // rock face instead of drifting into the rock.
                        instance.velocity.x = 0; instance.velocity.y = 0;
                        instance.accel.x = 0;    instance.accel.y = 0;
                        instance.kill();
                    }
                }
            }

            // loot keeps its personal space — no two gems overlap
            if (liveGems.length > 1) gems.separateGems(liveGems);

            // vault pads: pad presence + active deposit channels
            const vNow = Date.now();
            vault.tick(global.gameManager.socketManager.players,
                       Math.min(50, vNow - (this._lastVaultTick || vNow)) || 8);
            this._lastVaultTick = vNow;

            // Broadcast rock damage/destroy deltas so every player sees the
            // same cracks and shatter effects.
            // Regrow deltas ride the same channel, always LAST in the batch so
            // an authoritative "it's grown" can't be undone by a stale hit in
            // the same flush.
            if (_tg.rockEvents.length || _tg.growEvents.length) {
                const batch = _tg.growEvents.length
                    ? _tg.rockEvents.concat(_tg.growEvents)
                    : _tg.rockEvents;
                const payload = JSON.stringify(batch);
                _tg.rockEvents.length = 0;
                _tg.growEvents.length = 0;
                for (const client of global.gameManager.socketManager.clients) {
                    client.talk('TR', payload);
                }
            }
        }, 8);
    }
    stop() {
        this.active = false;
    }
}

module.exports = { gameHandler };

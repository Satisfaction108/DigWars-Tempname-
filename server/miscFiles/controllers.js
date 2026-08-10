let compressMovementOffsets = [
        { x: 1, y: 0},
        { x: 1, y: 1},
        { x: 0, y: 1},
        { x:-1, y: 1},
        { x:-1, y: 0},
        { x:-1, y:-1},
        { x: 0, y:-1},
        { x: 1, y:-1}
    ],
    compressMovement = (current, goal) => {
        let offset = compressMovementOffsets[Math.round(( Math.atan2(current.y - goal.y, current.x - goal.x) / (Math.PI * 2) ) * 8 + 4) % 8];
        return {
            x: current.x + offset.x,
            y: current.y + offset.y
        }
    },
    CLLonSegment = (p0, p1, q0, q1, r0, r1) => {
        return q0 <= Math.max(p0, r0) && q0 >= Math.min(p0, r0) && q1 <= Math.max(p1, r1) && q1 >= Math.min(p1, r1);
    },
    CLLorientation = (p0, p1, q0, q1, r0, r1) => {
        let v = (q1 - p1) * (r0 - q0) - (q0 - p0) * (r1 - q1);
        return !v ? 0 : v > 0 ? 1 : 2; // clock or counterclock wise
    },
    collisionLineLine = (p10, p11, q10, q11, p20, p21, q20, q21) => {
        // Find the four orientations needed for general and special cases
        let o1 = CLLorientation(p10, p11, q10, q11, p20, p21),
            o2 = CLLorientation(p10, p11, q10, q11, q20, q21),
            o3 = CLLorientation(p20, p21, q20, q21, p10, p11),
            o4 = CLLorientation(p20, p21, q20, q21, q10, q11);

        return (
            (o1 == 0 && CLLonSegment(p10, p11, p20, p21, q10, q11)) ||
            (o2 == 0 && CLLonSegment(p10, p11, q20, q21, q10, q11)) ||
            (o3 == 0 && CLLonSegment(p20, p21, p10, p11, q20, q21)) ||
            (o4 == 0 && CLLonSegment(p20, p21, q10, q11, q20, q21)) ||
            (o1 != o2 && o3 != o4)
        );
    },
    // me: { ...Vector }
    // enemy: data to calculte where it is gonna be soon
    // walls: Array<{ ...Vector, hitboxRadius, hitbox: Array<[Vector, Vector]> }>
    wouldHitWall = (me, enemy, directWallCheck = false) => {
        if (directWallCheck) {
            if (!me.justHittedAWallTimeout) me.justHittedAWallTimeout = "ready";
            if (me.justHittedAWall && me.justHittedAWallTimeout === "ready") {
                me.justHittedAWall = false;
                me.justHittedAWallTimeout = "null";
                setTimeout(() => {
                    me.justHittedAWallTimeout = "ready";
                    me.justHittedAWall = false;
                }, 300);
                return true;
            }
            return false;
        }
        // thing for culling off walls where theres no point of checking
        let inclusionCircle = {
            x: (me.x + enemy.x) / 2,
            y: (me.y + enemy.y) / 2,
            radius: util.getDistance(me, enemy) / 2
        };

        for (let i = 0; i < walls.length; i++) {
            let crate = walls[i];

            //avoid calculating collisions if it would just be a waste
            if (util.getDistanceSquared(inclusionCircle, crate) > (inclusionCircle.radius + crate.hitboxRadius) ** 2) continue;

            //if the crate intersects with the line, add them to the list of walls that have been hit
            //works by checking if the line from the gun end to the enemy position collides with any line from the crate hitbox
            for (let j = 0; j < crate.hitbox.length; j++) {
                let hitboxLine = crate.hitbox[j];
                if (collisionLineLine(
                    me.x, me.y,
                    enemy.x, enemy.y,
                    crate.x + hitboxLine[0].x, crate.y + hitboxLine[0].y,
                    crate.x + hitboxLine[1].x, crate.y + hitboxLine[1].y
                )) return true;
            }
        }
        return false;
    };

// Define IOs (AI)
class IO {
    constructor(body) {
        this.body = body
        this.acceptsFromTop = true
    }
    think() {
        return {
            target: null,
            goal: null,
            fire: null,
            main: null,
            alt: null,
            power: null,
        }
    }
}
class io_siegeAI extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.enabled = true;
        this.goalDefault = gameManager.room.center;
    }
    think(input) {
        let tile = global.gameManager.room.getAt(this.body);
        if (tile && tile.name == "stopAI") {
            this.enabled = false;
        }
        if (this.enabled) {
            return {
                goal: this.goalDefault
            }
        }
    }
}
class io_doNothing extends IO {
    constructor(body) {
        super(body)
        this.acceptsFromTop = false
    }
    think() {
        return {
            goal: {
                x: this.body.x,
                y: this.body.y,
            },
            main: false,
            alt: false,
            fire: false,
        }
    }
}
class io_moveInCircles extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.acceptsFromTop = false
        this.timer = ran.irandom(5) + 3
        this.pathAngle = ran.random(2 * Math.PI);
        this.goal = {
            x: this.body.x + 10 * Math.cos(this.pathAngle),
            y: this.body.y + 10 * Math.sin(this.pathAngle)
        }
    }
    think() {
        if (!this.timer--) {
            this.timer = 5
            this.goal = {
                x: this.body.x + 10 * Math.cos(this.pathAngle),
                y: this.body.y + 10 * Math.sin(this.pathAngle)
            }
            // turnWithSpeed turn speed (but condensed over 5 ticks)
            this.pathAngle -= ((this.body.velocity.length / 90) * Math.PI) / global.gameManager.runSpeed * 5;
        }
        return {
            goal: this.goal,
            power: this.body.ACCELERATION > 0.1 ? 0.2 : 1
        }
    }
}
class io_listenToPlayer extends IO {
    constructor(b, opts = { static: false }) {
        super(b);
        if ("object" != typeof opts.player) throw new Error('Required IO Option "player" is not an object');
        this.player = opts.player;
        this.static = opts.static;
        this.acceptsFromTop = false;
    }
    // THE PLAYER MUST HAVE A VALID COMMAND AND TARGET OBJECT
    think() {
        let fire = this.player.command.autofire || this.player.command.lmb,
            alt = this.player.command.autoalt || this.player.command.rmb,
            target = {
                x: this.player.target.x,
                y: this.player.target.y,
            };
        if (this.body.reverseTargetWithTank) {
            target.x *= this.body.reverseTank;
            target.y *= this.body.reverseTank;
        }
        this.body.facingLocked = this.player.command.spinlock;
        if (this.player.command.autospin && !this.player.body.settings.braindamagemode) {
            let kk = Math.atan2(this.body.control.target.y, this.body.control.target.x) + 0.04;
            if (this.body.autospinBoost) {
                let thing = 0.05 * 1 * this.body.autospinBoost;
                if (this.player.command.lmb) thing = thing * 1.5;
                if (this.player.command.rmb) thing = thing * -1;
                kk += thing;
            }
            target = {
                x: 100 * Math.cos(kk),
                y: 100 * Math.sin(kk),
            };
        }
        if (this.body.invuln) {
            if (this.player.command.right || this.player.command.left || this.player.command.up || this.player.command.down || this.player.command.lmb) {
                this.body.invuln = false;
            }
        }
        this.body.autoOverride = this.player.command.override;
        return {
            target,
            fire,
            alt,
            goal: this.static ? null : {
                x: this.body.x + this.player.command.right - this.player.command.left,
                y: this.body.y + this.player.command.down - this.player.command.up,
            },
            main: fire || this.player.command.autospin
        };
    }
}
class io_mapTargetToGoal extends IO {
    constructor(b) {
        super(b)
    }
    think(input) {
        if (input.main || input.alt) {
            return {
                goal: {
                    x: input.target.x + this.body.x,
                    y: input.target.y + this.body.y,
                },
                power: 1,
            }
        }
    }
}
class io_boomerang extends IO {
    constructor(b) {
        super(b)
        this.r = 0
        this.b = b
        this.m = b.master
        this.turnover = false
        let len = 10 * util.getDistance({
            x: 0,
            y: 0
        }, b.master.control.target)
        this.myGoal = {
            x: 3 * b.master.control.target.x + b.master.x,
            y: 3 * b.master.control.target.y + b.master.y,
        }
    }
    think(input) {
        if (this.b.range > this.r) this.r = this.b.range
        let t = 1; //1 - Math.sin(2 * Math.PI * this.b.range / this.r) || 1
        if (!this.turnover) {
            if (this.r && this.b.range < this.r * 0.5) {
                this.turnover = true;
            }
            return {
                goal: this.myGoal,
                power: t,
            }
        } else {
            return {
                goal: {
                    x: this.m.x,
                    y: this.m.y,
                },
                power: t,
            }
        }
    }
}
class io_goToMasterTarget extends IO {
    constructor(body) {
        super(body)

        const master = body.master

        // Start with the raw mouse/input offset
        let offsetX = master.control.target.x
        let offsetY = master.control.target.y

        // Match how facing/turrets handle reverse:
        // reverse = 1 if reverseTargetWithTank is true,
        // otherwise use reverseTank (usually 1 or -1)
        const reverseTank = master.reverseTank != null ? master.reverseTank : 1
        const reverseTargetWithTank = !!master.reverseTargetWithTank
        const reverse = reverseTargetWithTank ? 1 : reverseTank

        // If reverseTank is -1 (and reverseTargetWithTank is false),
        // this flips the offset across the tank
        offsetX *= reverse
        offsetY *= reverse

        this.myGoal = {
            x: master.x + offsetX,
            y: master.y + offsetY,
        }
        this.countdown = 5;
    }
    think() {
        if (this.countdown) {
            if (util.getDistance(this.body, this.myGoal) < 5) {
                this.countdown--;
            }
            return {
                goal: {
                    x: this.myGoal.x,
                    y: this.myGoal.y,
                },
            }
        }
    }
}
class io_canRepel extends IO {
    constructor(b) {
        super(b)
    }
    think(input) {
        if (input.alt && input.target) {
            let x = this.body.master.master.x - this.body.x
            let y = this.body.master.master.y - this.body.y
            // if (x * x + y * y < 2250000) // (50 * 30) ^ 2
            return {
                target: {
                    x: -input.target.x,
                    y: -input.target.y,
                },
                main: true,
            }
        }
    }
}
class io_alwaysFire extends IO {
    constructor(body) {
        super(body)
    }
    think() {
        return {
            fire: true,
        }
    }
}
class io_targetSelf extends IO {
    constructor(body) {
        super(body)
    }
    think() {
        return {
            main: true,
            target: {
                x: 0,
                y: 0,
            },
        }
    }
}
class io_mapAltToFire extends IO {
    constructor(body) {
        super(body)
    }
    think(input) {
        if (input.alt) {
            return {
                fire: true,
            }
        }
    }
}
class io_mapFireToAlt extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.onlyIfHasAltFireGun = opts.onlyIfHasAltFireGun;
    }
    think(input) {
        if (input.fire) for (let i = 0; i < this.body.gunsArrayed.length; i++) if (!this.onlyIfHasAltFireGun || this.body.gunsArrayed[i].altFire) return { alt: true }
    }
}
class io_onlyAcceptInArc extends IO {
    constructor(body) {
        super(body)
    }
    think(input) {
        if (input.target && this.body.firingArc != null) {
            if (Math.abs(util.angleDifference(Math.atan2(input.target.y, input.target.x), this.body.firingArc[0])) >= this.body.firingArc[1]) {
                return {
                    fire: false,
                    alt: false,
                    main: false
                }
            }
        }
    }
}
class io_stackGuns extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.timeUntilFire = opts.timeUntilFire || 0;
    }
    think ({ target }) {

        //why even bother?
        if (!target) {
            return;
        }

        //find gun that is about to shoot
        let lowestReadiness = Infinity,
            readiestGun;
        for (let i = 0; i < this.body.guns.length; i++) {
            let gun = this.body.guns[i];
            if (!gun.canShoot || !gun.stack) continue;
            let reloadStat = (gun.calculator == "necro" || gun.calculator == "fixed reload") ? 1 : (gun.bulletStats === "master" ? this.body.skill : gun.bulletStats).rld,
                readiness = (1 - gun.cycle) / (gun.settings.reload * reloadStat);
            if (lowestReadiness > readiness) {
                lowestReadiness = readiness;
                readiestGun = gun;
            }
        }

        //if we aren't ready, don't spin yet
        if (!readiestGun || (this.timeUntilFire && this.timeUntilFire > lowestReadiness)) {
            return;
        }

        //rotate the target vector based on the gun
        let targetAngle = Math.atan2(target.y, target.x) - readiestGun.angle,
            targetLength = Math.sqrt(target.x ** 2 + target.y ** 2);
        return {
            target: {
                x: targetLength * Math.cos(targetAngle),
                y: targetLength * Math.sin(targetAngle)
            }
        };
    }
}
class io_nearestDifferentMaster extends IO {
    static validEntityTypes = new Set(["tank", "miniboss", "crasher"]);
    constructor(body, opts = {}) {
        super(body);
        this.targetLock = undefined;
        this.tick = ran.irandom(30);
        this.lead = 0;
        this.timeout = opts.timeout || 90;
        this.lockThroughWalls = opts.lockThroughWalls;
        this.mapGoal = opts.mapGoal;
        this.validTargets = [];
        this.botAimAngle = null;
        this.botAimNoise = 0;
        this.botAimNoiseAt = 0;
        this.pendingTargetId = null;
        this.pendingTargetUntil = 0;
        this.targetLockStarted = 0;
    }
    validate(e, m, mm, sqrRange, sqrRangeMaster) {
        const myMaster = this.body.master.master;
        const aiSettings = this.body.aiSettings;
        const theirMaster = e.master.master;
        if (e.health.amount <= 0) return false;
        if (theirMaster.team === myMaster.team || theirMaster.team === TEAM_ROOM) return false;
        if (theirMaster.ignoredByAi) return false;
        if (e.bond) return false;
        if (e.invuln || e.godmode || theirMaster.godmode || theirMaster.passive || myMaster.passive) return false;
        if (isNaN(e.dangerValue)) return false;
        if (!(aiSettings.seeInvisible || this.body.isArenaCloser || e.alpha > 0.5)) return false;
        if (!io_nearestDifferentMaster.validEntityTypes.has(e.type)) {
            if ((aiSettings.IGNORE_SHAPES || myMaster.aiSettings.IGNORE_SHAPES) && e.type === "food") return false;
        }
        if (!aiSettings.BLIND) {
            if ((e.x - m.x) * (e.x - m.x) >= sqrRange) return false;
            if ((e.y - m.y) * (e.y - m.y) >= sqrRange) return false;
        }
        if (!aiSettings.SKYNET) {
            if ((e.x - mm.x) * (e.x - mm.x) >= sqrRangeMaster) return false;
            if ((e.y - mm.y) * (e.y - mm.y) >= sqrRangeMaster) return false;
        }
        return true;
    }
    wouldHitWall(entity) {
        if (!this.lockThroughWalls) return wouldHitWall(this.body, entity);
        else return false;
    }
    buildList(range) {
        const sqrRange = range * range;
        const sqrRangeMaster = sqrRange * 4 / 3;
        const validCandidates = [];
        for (const e of targetableEntities.values()) {
            if (this.validate(e, this.body, this.body.master.master, sqrRange, sqrRangeMaster) && !this.wouldHitWall(e)) {
                if (this.body.aiSettings.view360 || Math.abs(util.angleDifference(util.getDirection(this.body, e), this.body.firingArc[0])) < this.body.firingArc[1]) {
                    validCandidates.push(e);
                }
            }
        }
        if (!validCandidates.length) {
            this.targetLock = undefined;
            return [];
        }
        let mostDangerous = 0;
        for (const e of validCandidates) {
            mostDangerous = Math.max(e.dangerValue, mostDangerous);
        }
        let keepTarget = false;
        const finalTargets = validCandidates.filter((e) => {
            // Even more expensive
            return !this.wouldHitWall(e);
        }).filter(e => {
            if (this.body.aiSettings.farm || e.dangerValue === mostDangerous) {
                if (this.targetLock && e.id === this.targetLock.id) {
                    keepTarget = true;
                }
                return true;
            }
            return false;
        });
        // Reset target if it's not in there
        if (!keepTarget) {
            this.targetLock = undefined;
        }
        return finalTargets;
    }
    think(input) {
        if (this.body.isBot && this.body._digWarsCollecting) {
            this.targetLock = undefined;
            return {};
        }
        if (input.main || input.alt || this.body.master.autoOverride) {
            this.targetLock = undefined;
            return {};
        }
        let tracking = this.body.topSpeed,
            range = this.body.fov;
        // Use whether we have functional guns to decide
        for (let i = 0; i < this.body.guns.length; i++) {
            if (this.body.guns[i].canShoot && !this.body.aiSettings.SKYNET) {
                let v = this.body.guns[i].getTracking();
                if (v.speed == 0 || v.range == 0) continue;
                tracking = v.speed;
                range = Math.min(range, (v.speed || 1.5) * (v.range < (this.body.size * 2) ? this.body.fov : v.range));
                break;
            }
        }
        if (!Number.isFinite(tracking)) {
            tracking = this.body.topSpeed + .01;
        }
        if (!Number.isFinite(range)) {
            range = 640 * this.body.FOV;
        }
        // Lets see if the entity still lives
        if (this.targetLock && (
            !this.validate(this.targetLock, this.body, this.body.master.master, range * range, range * range * 4 / 3) ||
            this.wouldHitWall(this.body, this.targetLock) // Very expensive
        )) {
            this.targetLock = undefined;
            this.pendingTargetId = null;
            this.tick = 100;
        }
        if (this.targetLock && this.body.isBot && this.targetLockStarted &&
            Date.now() - this.targetLockStarted > 2200 + (1 - util.clamp(this.body.botSkill ?? 0.5, 0, 1)) * 2800 &&
            this.tick % 30 === 0) {
            this.targetLock = undefined;
            this.targetLockStarted = 0;
        }
        // OK, now let's try reprocessing the targets!
        this.tick++;
        if (this.tick > 2) {
            this.tick = 0;
            this.validTargets = this.buildList(range);
            if (this.targetLock && this.validTargets.indexOf(this.targetLock) === -1) {
                this.targetLock = undefined;
            }
            if (this.targetLock == null && this.validTargets.length) {
                const preferred = this.body._digWarsCombatTarget && this.validTargets.find(target =>
                    target.id === this.body._digWarsCombatTarget.id
                );
                const candidate = preferred || ((this.validTargets.length === 1) ? this.validTargets[0] : nearest(this.validTargets, {
                    x: this.body.x,
                    y: this.body.y
                }));
                if (this.body.isBot) {
                    const delay = 90 + (1 - util.clamp(this.body.botSkill ?? 0.5, 0, 1)) * 310;
                    if (this.pendingTargetId !== candidate.id) {
                        this.pendingTargetId = candidate.id;
                        this.pendingTargetUntil = Date.now() + delay;
                        return {};
                    }
                    if (Date.now() < this.pendingTargetUntil) return {};
                    this.pendingTargetId = null;
                }
                this.targetLock = candidate;
                this.targetLockStarted = Date.now();
                this.tick = -5;
            }
        }
        if (this.targetLock != null) {
            let radial = this.targetLock.velocity,
                diff = {
                    x: this.targetLock.x - this.body.x,
                    y: this.targetLock.y - this.body.y,
                };
            if (this.tick % 2 === 0) {
                this.lead = 0;
                if (!this.body.aiSettings.CHASE) {
                    let toi = timeOfImpact(diff, radial, tracking);
                    this.lead = toi;
                }
            }
            if (!Number.isFinite(this.lead)) {
                this.lead = 0;
            }
            let target = {
                x: diff.x + this.lead * radial.x,
                y: diff.y + this.lead * radial.y,
            };
            if (this.body.isBot) {
                const skill = util.clamp(this.body.botSkill ?? 0.5, 0, 1);
                const desired = Math.atan2(target.y, target.x);
                if (this.botAimAngle == null) this.botAimAngle = desired;
                let turn = desired - this.botAimAngle;
                while (turn > Math.PI) turn -= Math.PI * 2;
                while (turn < -Math.PI) turn += Math.PI * 2;
                this.botAimAngle += turn * (0.12 + skill * 0.28);
                if (Date.now() >= this.botAimNoiseAt) {
                    this.botAimNoiseAt = Date.now() + 140;
                    this.botAimNoise = ran.gauss(0, (1 - skill) * 0.16);
                }
                const c = Math.cos(this.botAimAngle + this.botAimNoise), s = Math.sin(this.botAimAngle + this.botAimNoise);
                const length = Math.hypot(target.x, target.y);
                target = { x: length * c, y: length * s };
            }
            return {
                target,
                goal: this.mapGoal ? {
                    x: this.targetLock.x,
                    y: this.targetLock.y,
                } : undefined,
                fire: true,
                main: true
            };
        }
        // Nothing hostile in reach. Auto turrets only ever considered
        // targetableEntities, and rock is terrain rather than an entity, so a
        // player whose only weapon is an auto turret could never mine at all.
        // Fall back to chewing the nearest rock, which keeps enemies strictly
        // higher priority because we only get here with no target lock.
        const rock = this.rockTarget(range);
        if (rock) return { target: rock, fire: true, main: true };
        return {};
    }
    // Throttled: nearestRock scans a grid neighbourhood, so re-query rarely and
    // reuse the answer in between. Player-owned turrets only - bosses and
    // sentries have no business grinding the terrain down.
    rockTarget(range) {
        const b = this.body;
        if (!b || b.master.autoOverride) return null;
        let root = b, guard = 0;
        while (root.master && root.master !== root && guard++ < 8) root = root.master;
        if (!root.isPlayer) return null;
        const tg = global.gameManager && global.gameManager.terrainGrid;
        if (!tg || !tg.nearestRock) return null;
        const now = Date.now();
        if (this._rockAt && now - this._rockAt < 400 && this._rock) {
            if (this._rock.alive) return { x: this._rock.wx - b.x, y: this._rock.wy - b.y };
            this._rock = null;
        }
        this._rockAt = now;
        this._rock = tg.nearestRock(b.x, b.y, Math.min(range || 500, 620));
        if (!this._rock || !this._rock.alive) { this._rock = null; return null; }
        return { x: this._rock.wx - b.x, y: this._rock.wy - b.y };
    }
}
class io_healTeamMasters extends IO {
    constructor(body) {
        super(body);
        this.targetLock = undefined;
        this.tick = ran.irandom(30);
        this.lead = 0;
        this.validTargets = [];
        this.pendingTargetId = null;
        this.pendingTargetUntil = 0;
        this.targetLockStarted = 0;
    }
    validate(e) {
        const myMaster = this.body.master.master;
        const theirMaster = e.master.master;
        let fear = e.fear ?? 0.7;
        if (e.health.amount <= 0) return false;
        if (theirMaster.team !== myMaster.team) return false;
        if (theirMaster.ignoredByAi) return false;
        if (e.bond) return false;
        if (e.type !== "tank") return false;
        if (e.isDominator) return false;
        if (e.health.amount > e.health.max * fear) return false;
        if (e.invuln || e.godmode || theirMaster.godmode || theirMaster.passive || myMaster.passive) return false;
        if (isNaN(e.dangerValue)) return false;
        return true;
    }
    wouldHitWall(entity) {
        if (!this.lockThroughWalls) return wouldHitWall(this.body, entity);
        else return false;
    }
    buildList(range) {
        const sqrRange = range * range;
        const sqrRangeMaster = sqrRange * 4 / 3;
        const validCandidates = [];
        for (const e of targetableEntities.values()) {
            if (this.validate(e, this.body, this.body.master.master, sqrRange, sqrRangeMaster) && !this.wouldHitWall(e)) {
                if (this.body.aiSettings.view360 || Math.abs(util.angleDifference(util.getDirection(this.body, e), this.body.firingArc[0])) < this.body.firingArc[1]) {
                    validCandidates.push(e);
                }
            }
        }
        if (!validCandidates.length) {
            this.targetLock = undefined;
            return [];
        }
        let mostDangerous = 0;
        for (const e of validCandidates) {
            mostDangerous = Math.max(e.dangerValue, mostDangerous);
        }
        let keepTarget = false;
        const finalTargets = validCandidates.filter((e) => {
            // Even more expensive
            return !this.wouldHitWall(e);
        }).filter(e => {
            if (this.body.aiSettings.farm || e.dangerValue === mostDangerous) {
                if (this.targetLock && e.id === this.targetLock.id) {
                    keepTarget = true;
                }
                return true;
            }
            return false;
        });
        // Reset target if it's not in there
        if (!keepTarget) {
            this.targetLock = undefined;
        }
        return finalTargets;
    }
    think(input) {
        if (this.body.isBot && this.body._digWarsCollecting) {
            this.targetLock = undefined;
            return {};
        }
        if (input.main || input.alt || this.body.master.autoOverride) {
            this.targetLock = undefined;
            return {};
        }
        let tracking = this.body.topSpeed,
            range = this.body.fov;
        // Use whether we have functional guns to decide
        for (let i = 0; i < this.body.guns.length; i++) {
            if (this.body.guns[i].canShoot && !this.body.aiSettings.SKYNET) {
                let v = this.body.guns[i].getTracking();
                if (v.speed == 0 || v.range == 0) continue;
                tracking = v.speed;
                range = Math.min(range, (v.speed || 1.5) * (v.range < (this.body.size * 2) ? this.body.fov : v.range));
                break;
            }
        }
        if (!Number.isFinite(tracking)) {
            tracking = this.body.topSpeed + .01;
        }
        if (!Number.isFinite(range)) {
            range = 340 * this.body.FOV;
        }
        // Lets see if the entity still lives
        if (this.targetLock && (
            !this.validate(this.targetLock, this.body, this.body.master.master, range * range, range * range * 4 / 3) ||
            this.wouldHitWall(this.body, this.targetLock) // Very expensive
        )) {
            this.targetLock = undefined;
            this.pendingTargetId = null;
            this.tick = 100;
        }
        if (this.targetLock && this.body.isBot && this.targetLockStarted &&
            Date.now() - this.targetLockStarted > 2200 + (1 - util.clamp(this.body.botSkill ?? 0.5, 0, 1)) * 2800 &&
            this.tick % 30 === 0) {
            this.targetLock = undefined;
            this.targetLockStarted = 0;
        }
        // OK, now let's try reprocessing the targets!
        this.tick++;
        if (this.tick > 2) {
            this.tick = 0;
            this.validTargets = this.buildList(range);
            if (this.targetLock && this.validTargets.indexOf(this.targetLock) === -1) {
                this.targetLock = undefined;
            }
            if (this.targetLock == null && this.validTargets.length) {
                const preferred = this.body._digWarsCombatTarget && this.validTargets.find(target =>
                    target.id === this.body._digWarsCombatTarget.id
                );
                const candidate = preferred || ((this.validTargets.length === 1) ? this.validTargets[0] : nearest(this.validTargets, {
                    x: this.body.x,
                    y: this.body.y
                }));
                if (this.body.isBot) {
                    const delay = 90 + (1 - util.clamp(this.body.botSkill ?? 0.5, 0, 1)) * 310;
                    if (this.pendingTargetId !== candidate.id) {
                        this.pendingTargetId = candidate.id;
                        this.pendingTargetUntil = Date.now() + delay;
                        return {};
                    }
                    if (Date.now() < this.pendingTargetUntil) return {};
                    this.pendingTargetId = null;
                }
                this.targetLock = candidate;
                this.targetLockStarted = Date.now();
                this.tick = -5;
            }
        }
        if (this.targetLock != null) {
            let radial = this.targetLock.velocity,
                diff = {
                    x: this.targetLock.x - this.body.x,
                    y: this.targetLock.y - this.body.y,
                };
            if (this.tick % 2 === 0) {
                this.lead = 0;
            }
            if (!Number.isFinite(this.lead)) {
                this.lead = 0;
            }
            return {
                target: {
                    x: diff.x + this.lead * radial.x,
                    y: diff.y + this.lead * radial.y,
                },
                goal: undefined,
                fire: true,
                main: true
            };
        }
        return {};
    }
}
class io_avoid extends IO {
    constructor(body) {
        super(body)
    }
    think(input) {
        let masterId = this.body.master.id
        let range = this.body.size * this.body.size * 100
        this.avoid = nearest(entities, {
            x: this.body.x,
            y: this.body.y
        }, function (test, sqrdst) {
            return (test.master.id !== masterId && (test.type === 'bullet' || test.type === 'drone' || test.type === 'swarm' || test.type === 'trap' || test.type === 'block') && sqrdst < range);
        })
        // Aim at that target
        if (this.avoid != null) {
            // Consider how fast it's moving.
            let delt = new Vector(this.body.velocity.x - this.avoid.velocity.x, this.body.velocity.y - this.avoid.velocity.y)
            let diff = new Vector(this.avoid.x - this.body.x, this.avoid.y - this.body.y);
            let comp = (delt.x * diff.x + delt.y * diff.y) / delt.length / diff.length
            let goal = {}
            if (comp > 0) {
                if (input.goal) {
                    let goalDist = Math.sqrt(range / (input.goal.x * input.goal.x + input.goal.y * input.goal.y))
                    goal = {
                        x: input.goal.x * goalDist - diff.x * comp,
                        y: input.goal.y * goalDist - diff.y * comp,
                    }
                } else {
                    goal = {
                        x: -diff.x * comp,
                        y: -diff.y * comp,
                    }
                }
                return goal
            }
        }
    }
}
class io_minion extends IO {
    constructor(body, opts = {}) {
        super(body)
        this.turnwise = 1
        this.opts = opts;
    }
    think(input) {
        if (input.goal != null && (this.body._digWarsGoalLocked || this.body._digWarsGoal === 'mine')) return {};
        if (this.body.aiSettings.reverseDirection && ran.chance(0.005)) {
            this.turnwise = -1 * this.turnwise;
        }
        if (input.target != null && (input.alt || input.main)) {
            let sizeFactor = Math.sqrt(this.body.master.size / this.body.master.SIZE)
            let leash = 82 * sizeFactor
            let orbit = this.opts.turnwiserange ?? 140 * sizeFactor
            let repel = 142 * sizeFactor
            let goal
            let power = 1
            let target = new Vector(input.target.x, input.target.y)
            if (input.alt) {
                // Leash
                if (target.length < leash) {
                    goal = {
                        x: this.body.x + target.x,
                        y: this.body.y + target.y,
                    }
                    // Spiral repel
                } else if (target.length < repel) {
                    let dir = -this.turnwise * target.direction + Math.PI / 5
                    goal = {
                        x: this.body.x + Math.cos(dir),
                        y: this.body.y + Math.sin(dir),
                    }
                    // Free repel
                } else {
                    goal = {
                        x: this.body.x - target.x,
                        y: this.body.y - target.y,
                    }
                }
            } else if (input.main) {
                // Orbit point
                let dir = this.turnwise * target.direction + 0.01
                goal = {
                    x: this.body.x + target.x - orbit * Math.cos(dir),
                    y: this.body.y + target.y - orbit * Math.sin(dir),
                }
                if (Math.abs(target.length - orbit) < this.body.size * 2) {
                    power = 0.7
                }
            }
            return {
                goal: goal,
                power: power,
            }
        }
    }
}
class io_hangOutNearMaster extends IO {
    constructor(body) {
        super(body)
        this.acceptsFromTop = false
        this.orbit = 30
        this.currentGoal = {
            x: this.body.source.x,
            y: this.body.source.y,
        }
        this.timer = 0
    }
    think(input) {
        if (this.body.invisible[1]) return {}
        if (this.body.source !== this.body) {
            let bound1 = this.orbit * 0.8 + this.body.source.size + this.body.size
            let bound2 = this.orbit * 1.5 + this.body.source.size + this.body.size
            let dist = util.getDistance(this.body, this.body.source) + Math.PI / 8;
            let output = {
                target: {
                    x: this.body.velocity.x,
                    y: this.body.velocity.y,
                },
                goal: this.currentGoal,
                power: undefined,
            };
            // Set a goal
            if (dist > bound2 || this.timer > 30) {
                this.timer = 0
                let dir = util.getDirection(this.body, this.body.source) + Math.PI * ran.random(0.5);
                let len = ran.randomRange(bound1, bound2)
                let x = this.body.source.x - len * Math.cos(dir)
                let y = this.body.source.y - len * Math.sin(dir)
                this.currentGoal = { x: x, y: y };
            }
            if (dist < bound2) {
                output.power = 0.15
                if (ran.chance(0.3)) {
                    this.timer++;
                }
            }
            return output
        }
    }
}
class io_spin extends IO {
    constructor(b, opts = {}) {
        super(b)
        this.a = opts.startAngle || 0;
        this.speed = opts.speed ?? 0.04;
        this.onlyWhenIdle = opts.onlyWhenIdle;
        this.independent = opts.independent;
    }
    think(input) {
        if (this.onlyWhenIdle && input.target) {
            this.a = Math.atan2(input.target.y, input.target.x);
            return input;
        }
        this.a += this.speed;
        let offset = (this.independent && this.body.bond != null) ? this.body.bound.angle : 0;
        return {
            target: {
                x: Math.cos(this.a + offset),
                y: Math.sin(this.a + offset),
            },
            main: true,
        };
    }
}
class io_spin2 extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.speed = opts.speed ?? 0.04;
        this.reverseOnAlt = opts.reverseOnAlt ?? true;
        this.lastAlt = -1;
        this.reverseOnTheFly = opts.reverseOnTheFly ?? false;

        // On spawn logic
        let alt = this.body.master.control.alt;
        let reverse = (this.reverseOnAlt && alt) ? -1 : 1;
        this.body.facingType = "spin";
        this.body.facingTypeArgs = {speed: this.speed * reverse};
    }
    think(input) {
        if (!this.reverseOnTheFly || !this.reverseOnAlt) return;

        // Live logic
        let alt = this.body.master.control.alt;
        if (this.lastAlt != alt) {
            let reverse = alt ? -1 : 1;
            this.body.facingType = "spin";
            this.body.facingTypeArgs = {speed: this.speed * reverse};
            this.lastAlt = alt;
        }
    }
}
class io_fleeAtLowHealth extends IO {
    constructor(b) {
        super(b)
        this.fear = util.clamp(ran.gauss(0.7, 0.15), 0.1, 0.9);
        b.fear = this.fear;
    }
    think(input) {
        if (input.goal != null && this.body._digWarsGoalLocked) return {};
        if (input.fire && input.target != null && this.body.health.amount < this.body.health.max * this.fear) {
            return {
                goal: {
                    x: this.body.x - input.target.x,
                    y: this.body.y - input.target.y,
                },
            }
        }
    }
}

class io_zoom extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.distance = opts.distance || 225;
        this.dynamic = opts.dynamic;
        this.permanent = opts.permanent;
    }

    think(input) {
        if (this.permanent || (input.alt && input.target)) {
            if (this.dynamic || this.body.cameraOverrideX === null) {
                let direction = Math.atan2(input.target.y, input.target.x);
                this.body.cameraOverrideX = this.body.x + this.distance * Math.cos(direction);
                this.body.cameraOverrideY = this.body.y + this.distance * Math.sin(direction);
            }
        } else {
            this.body.cameraOverrideX = null;
            this.body.cameraOverrideY = null;
        }
    }
}
class io_wanderAroundMap extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.lookAtGoal = opts.lookAtGoal;
        this.replicatePlayerMovement = opts.replicatePlayerMovement;
        this.spot = ran.choose(global.gameManager.room.spawnableDefault).randomInside();

        this.bossWander = opts.diepBossWander;
        this.howFarAwayFromEdgeOfMap = 15;
        this.tick = 0;
        this.currentGoal = {x:0,y:0};
        this.i = 0;
        this.enabled = true;
        this.botMoveEnabled = true;
    }
    think(input) {
        if (Config.BOT_MOVE && this.botMoveEnabled) {
            this.enabled = false;
            for (let e of Config.BOT_MOVE) {
                if ((e.TEAM === "any" || this.body.team == e.TEAM) && e.MOVEMENT && !input.fire) {
                    if (!this.moveArray) this.botMove_active = true, this.moveArray = 0, this.arrayLength = e.MOVEMENT.length - 1; // Set flags
                    let i = e.MOVEMENT[this.moveArray];
                    let [locX, locY] = i;
                    if (new Vector( this.body.x - locX * 30, this.body.y - locY * 30 ).isShorterThan(e.RANGE ?? 50)) {
                        if (this.moveArray == this.arrayLength) this.botMoveEnabled = false, this.enabled = true;
                        this.moveArray++;
                    }
                    if (input.goal == null && !this.body.autoOverride) {
                        let loc = compressMovement(this.body, { x: locX * 30, y: locY * 30 });
                        return {
                            target: (this.lookAtGoal && input.target == null) ? {
                                x: locX * 30 - this.body.x,
                                y: locY * 30 - this.body.y
                            } : null,
                            goal: loc,
                        };
                    }
                }
            }
            if (!this.botMove_active) this.botMoveEnabled = false, this.enabled = true;
        }
        if (this.enabled) {
            if (this.bossWander) {
                let points = [{
                    x: global.gameManager.room.width / this.howFarAwayFromEdgeOfMap, // top left
                    y: global.gameManager.room.height / this.howFarAwayFromEdgeOfMap
                }, {
                    x: global.gameManager.room.width - (global.gameManager.room.width / this.howFarAwayFromEdgeOfMap), // top right
                    y: global.gameManager.room.height / this.howFarAwayFromEdgeOfMap
                }, {
                    x: global.gameManager.room.width - (global.gameManager.room.width / this.howFarAwayFromEdgeOfMap), // bottom right
                    y: global.gameManager.room.height - (global.gameManager.room.height / this.howFarAwayFromEdgeOfMap)
                }, {
                    x: global.gameManager.room.width / this.howFarAwayFromEdgeOfMap, // bottom left
                    y: global.gameManager.room.height - (global.gameManager.room.height / this.howFarAwayFromEdgeOfMap)
                }]
                this.tick++
                this.currentGoal = points[this.i]
                let distanceFromPoint = util.getDistance(this.body, this.currentGoal)
                if (this.tick >= 100 + distanceFromPoint + (this.body.SPEED < 5 ? 1000 : 0)) {
                    this.tick = 0
                    if (this.i >= points.length - 1) {
                        this.i = 0
                    } else {
                        this.i++
                    }
                    this.currentGoal = points[this.i]
                }
                return {
                    goal: {
                        x: this.currentGoal.x,
                        y: this.currentGoal.y
                    },
                    target: this.lookAtGoal ? {
                        x: this.currentGoal.x,
                        y: this.currentGoal.y
                    } : null
                }
            }
            if (new Vector( this.body.x - this.spot.x, this.body.y - this.spot.y ).isShorterThan(50) || wouldHitWall(this.body, this.spot, true)) {
                this.spot = ran.choose(global.gameManager.room.spawnableDefault).randomInside();
            }
            if (input.goal == null && !this.body.autoOverride) {
                let goal = this.spot;
                if (this.replicatePlayerMovement) {
                    goal = compressMovement(this.body, goal);
                }
                return {
                    target: (this.lookAtGoal && input.target == null) ? {
                        x: this.spot.x - this.body.x,
                        y: this.spot.y - this.body.y
                    } : null,
                    goal
                };
            }
        }
    }
}
// returns deviation from origin angle in radians
let io_formulaTarget_sineDefault = (frame, body) => Math.sin(frame / 30);
class io_formulaTarget extends IO {
    constructor (b, opts = {}) {
        super(b);
        this.masterAngle = opts.masterAngle;
        this.formula = opts.formula || io_formulaTarget_sineDefault;
        //this.updateOriginAngle = opts.updateOriginAngle;
        this.originAngle = this.masterAngle ? b.master.facing : b.facing;
        this.frame = 0;
    }
    think () {
        // if (this.updateOriginAngle) {
        //     this.originAngle = this.masterAngle ? b.master.facing : getTheGunThatSpawnedMe("how do i do that????").angle;
        // }

        let angle = this.originAngle + this.formula(this.frame += 1 / global.gameManager.runSpeed, this.body);
        return {
            goal: {
                x: this.body.x + Math.sin(angle),
                y: this.body.y + Math.cos(angle)
            }
        };
    }
}
class io_whirlwind extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.body.useOwnMaster = opts.useOwnMaster;
        this.body.angle = 0;
        this.minDistance = opts.minDistance ?? 3.5;
        this.maxDistance = opts.maxDistance ?? 10;
        this.body.dist = opts.initialDist || this.minDistance * this.body.size;
        this.body.inverseDist = this.maxDistance * this.body.size - this.body.dist + this.minDistance * this.body.size;
        this.radiusScalingSpeed = opts.radiusScalingSpeed || 10;
    }
    
    think(input) {
        this.body.angle += (this.body.skill.spd * 2 + this.body.aiSettings.SPEED) * Math.PI / 180;
        let trueMaxDistance = this.maxDistance * this.body.size;
        let trueMinDistance = this.minDistance * this.body.size;
        if(input.fire){
            if(this.body.dist <= trueMaxDistance) {
                this.body.dist += this.radiusScalingSpeed;
                this.body.inverseDist -= this.radiusScalingSpeed;
            }
        }
        else if(input.alt){
            if(this.body.dist >= trueMinDistance) {
                this.body.dist -= this.radiusScalingSpeed;
                this.body.inverseDist += this.radiusScalingSpeed;
            }
        }
        this.body.dist = Math.min(trueMaxDistance, Math.max(trueMinDistance, this.body.dist));
        this.body.inverseDist = Math.min(trueMaxDistance, Math.max(trueMinDistance, this.body.inverseDist));
    }
}
class io_orbit extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.realDist = 0;
        this.invert = opts.invert ?? false;
    }
  
    think(input) {
        let invertFactor = this.invert ? -1 : 1,
            master = this.body.master.useOwnMaster ? this.body.master : this.body.master.master,
            dist = this.invert ? master.inverseDist : master.dist,
            angle = (this.body.angle * Math.PI / 180 + master.angle) * invertFactor;
        
        if(this.realDist > dist){
            this.realDist -= Math.min(10, Math.abs(this.realDist - dist));
        }
        else if(this.realDist < dist){
            this.realDist += Math.min(10, Math.abs(dist - this.realDist));
        }
        this.body.x = master.x + Math.cos(angle) * this.realDist;
        this.body.y = master.y + Math.sin(angle) * this.realDist;
        
        this.body.facing = angle;
    }
}
class io_snake extends IO {
    constructor(body, opts = {}) {
        super(body);
        this.waveInvert = opts.invert ? -1 : 1;
        this.wavePeriod = opts.period ?? 5;
        this.waveAmplitude = opts.amplitude ?? 150;
        this.yOffset = opts.yOffset ?? 0;

        this.reverseWave = this.body.master.control.alt ? -1 : 1;
        this.velocityMagnitude = 0;
        this.body.damp = 0;
        this.waveAngle = this.body.master.facing + (opts.angle ?? 0);
        this.startX = this.body.x;
        this.startY = this.body.y;
        this.body.x += Math.cos(this.body.velocity.direction) * this.body.size * Config.bullet_spawn_offset + 0;
        this.body.y += Math.sin(this.body.velocity.direction) * this.body.size * Config.bullet_spawn_offset + 0;
        // Clamp scale to [45, 75]
        // Attempts to get the bullets to intersect with the cursor
        this.waveHorizontalScale = util.clamp(util.getDistance(this.body.master.master.control.target, {x: 0, y: 0}) / Math.PI, 45, 75);
    }
    think(input) {
        // Define a sin wave for the bullet to follow
        let waveX = this.waveHorizontalScale * (this.body.RANGE - this.body.range) / this.wavePeriod;
        let waveY = this.waveAmplitude * Math.sin(waveX / this.waveHorizontalScale) * this.waveInvert * this.reverseWave + this.yOffset;
        // Rotate the sin wave
        let trueWaveX = Math.cos(this.waveAngle) * waveX - Math.sin(this.waveAngle) * waveY;
        let trueWaveY = Math.sin(this.waveAngle) * waveX + Math.cos(this.waveAngle) * waveY;
        // Follow the sin wave
        this.body.x = util.lerp(this.body.x, this.startX + trueWaveX, this.velocityMagnitude);
        this.body.y = util.lerp(this.body.y, this.startY + trueWaveY, this.velocityMagnitude);
        // Accelerate after spawning
        this.velocityMagnitude = Math.min(0.1, this.velocityMagnitude + 0.01 / global.gameManager.runSpeed)
    }
}

class io_disableOnOverride extends IO {
    constructor(body) {
        super(body);
        this.pacify = false;
        this.lastPacify = false;
        this.savedDamage = 0;
    }

    think(input) {
        if (!this.initialAlpha) {
            this.initialAlpha = this.body.alpha;
            this.targetAlpha = this.initialAlpha;
        }
        
        this.pacify = (this.body.parent.master.autoOverride || this.body.parent.master.master.autoOverride);
        if (this.pacify && !this.lastPacify) {
            this.targetAlpha = 0;
            this.savedDamage = this.body.DAMAGE;
            this.body.DAMAGE = 0;
            this.body.refreshBodyAttributes();
        } else if (!this.pacify && this.lastPacify) {
            this.targetAlpha = this.initialAlpha;
            this.body.DAMAGE = this.savedDamage;
            this.body.refreshBodyAttributes();
        }
        this.lastPacify = this.pacify;

        if (this.body.alpha != this.targetAlpha) {
            this.body.alpha += util.clamp(this.targetAlpha - this.body.alpha, -0.05, 0.05);
            if (this.body.flattenedPhoto) this.body.flattenedPhoto.alpha = this.body.alpha;
        }
    }
}

class io_scaleWithMaster extends IO {
    constructor(body) {
        super(body);
        this.storedSize = 0;
    }
    think(input) {
        let masterSize = this.body.master.size;
        if (masterSize != this.storedSize) {
            this.storedSize = masterSize;
            this.body.SIZE = masterSize * this.body.size / this.body.master.size;
        }
    }
}

// Dig Wars: every bot controller chain starts with this. When the body has
// a movement goal but hasn't actually moved anywhere in about two seconds it
// jams against rock, so we pick an escape heading perpendicular to the
// blocked direction and override movement for 600-1000ms. Repeated jams at
// the same spot escalate: try the other side, then reverse out entirely.
// acceptsFromTop = false while escaping so nothing above can hijack the
// escape, and controllers below (notably wanderAroundMap) already check
// input.goal == null so they defer automatically.
class io_unstick extends IO {
    constructor(body) {
        super(body);
        this.history = [];
        this.escapeUntil = 0;
        this.lastJam = null;
        this.lastEscapeDir = 0;
        this.nextJamAt = 0;
        this.escalation = 0;
        this.lastMineProgress = body.gemsMined || body.rocksMined || 0;
        this.lastMineProgressAt = Date.now();
    }
    think(input) {
        const now = Date.now(), b = this.body;

        // A replying bot briefly stops its hull and guns so chat feels like a
        // real interruption instead of text appearing while it keeps farming.
        if (b._chatPending || (b._chatPauseUntil || 0) > now) {
            this.history.length = 0;
            this.escapeUntil = 0;
            this.nextJamAt = now + 500;
            this.acceptsFromTop = false;
            return {
                goal: { x: b.x, y: b.y },
                target: { x: 0, y: 0 },
                fire: false,
                main: false,
                alt: false,
                power: 0,
            };
        }
        this.acceptsFromTop = true;

        // Record position
        this.history.push({ x: b.x, y: b.y, t: now });
        while (this.history.length > 1 && now - this.history[0].t > 1800)
            this.history.shift();

        // Already escaping — hold the line until the timer expires
        if (now < this.escapeUntil) {
            this.acceptsFromTop = false;
            return {};
        }
        this.acceptsFromTop = true;
        this.escapeUntil = 0;

        const mineProgress = b.gemsMined || b.rocksMined || 0;
        if (mineProgress !== this.lastMineProgress) {
            this.lastMineProgress = mineProgress;
            this.lastMineProgressAt = now;
        }
        if (b._digWarsGoal !== 'mine') this.lastMineProgressAt = now;

        // Grinding into a rock is deliberate progress while the rock keeps
        // losing health. A contact that produces no break for several seconds
        // is instead treated as a stalled wall path and gets abandoned.
        const miningContact = b._digWarsGoal === 'mine' && b.grindTouchUntil > now;
        const miningStalled = miningContact && now - this.lastMineProgressAt > 3000;
        if (miningContact && !miningStalled) {
            this.history.length = 0;
            return {};
        }
        // Armed miners use a deliberate firing lane, not hull contact. Do not
        // let the generic jam escape make them reverse away from a rock and
        // then lurch forward again while their bullets are working.
        if (b._digWarsGoal === 'mine' && !b.botIsRammer) {
            this.history.length = 0;
            return {};
        }
        if (miningStalled) {
            b._digWarsIgnoredRock = b._digWarsMineRock || null;
            b._digWarsIgnoredRockUntil = now + 4000;
        }

        // Give an escape a short settling window so one jam becomes one
        // recovery event instead of being counted once per tick.
        if (now < this.nextJamAt) {
            this.history.length = 0;
            return {};
        }

        // Nothing wanted movement last tick — reset and stay quiet
        const goalDistance = b.control?.goal
            ? Math.hypot(b.control.goal.x - b.x, b.control.goal.y - b.y)
            : 0;
        const hadGoal = goalDistance > Math.max(35, b.size * 2);
        // Being nearly on top of a waypoint is not a jam. Treating that as a
        // stuck event made objective bots reverse just as they reached their
        // firing lane, which looked like pointless back-and-forth motion.
        if (!hadGoal) { this.history.length = 0; this.escalation = 0; return {}; }

        if (this.history.length < 2) return {};

        const first = this.history[0], last = this.history[this.history.length - 1];
        const dist = Math.hypot(last.x - first.x, last.y - first.y);
        // Tanks are large but their world-speed is comparatively small. Using
        // half the hull size here called ordinary slow movement "stuck" every
        // second, which made bots twitch and flee from perfectly open ground.
        const progressThreshold = Math.max(1.5, Math.min(b.size * 0.5, (b.topSpeed || 1) * 0.12));
        if (dist >= progressThreshold) {
            // Moving freely — cool down escalation after a few seconds
            if (this.lastJam && now - this.lastJam.t > 3000) {
                this.escalation = 0; this.lastJam = null;
            }
            return {};
        }

        // ── stuck ──
        b._unstickCount = (b._unstickCount || 0) + 1;

        if (this.lastJam) {
            const jd = Math.hypot(b.x - this.lastJam.x, b.y - this.lastJam.y);
            if (jd < b.size * 2 && now - this.lastJam.t < 4000)
                this.escalation = Math.min(2, this.escalation + 1);
            else this.escalation = 0;
        }
        this.lastJam = { x: b.x, y: b.y, t: now };

        // Blocked direction = toward last tick's goal
        const gx = b.control.goal.x - b.x, gy = b.control.goal.y - b.y;
        const gl = Math.hypot(gx, gy) || 1;
        const bdx = gx / gl, bdy = gy / gl;

        let angle;
        if (this.escalation >= 2) {
            angle = Math.atan2(-bdy, -bdx);                 // reverse
        } else if (this.escalation >= 1) {
            angle = this.lastEscapeDir + Math.PI;            // other side
        } else {
            // Probe both perpendiculars, pick the more open side
            const tg = global.gameManager && global.gameManager.terrainGrid;
            let s1 = 0, s2 = 0;
            if (tg && tg.rockHitByCircle) {
                for (let d = b.size; d <= b.size * 5; d += b.size) {
                    if (!tg.rockHitByCircle(b.x - bdy * d, b.y + bdx * d, b.size)) s1++;
                    if (!tg.rockHitByCircle(b.x + bdy * d, b.y - bdx * d, b.size)) s2++;
                }
            } else { s1 = s2 = 1; }
            const px = s1 >= s2 ? -bdy : bdy;
            const py = s1 >= s2 ? bdx  : -bdx;
            angle = Math.atan2(py, px);
        }
        this.lastEscapeDir = angle;

        this.escapeUntil = now + 600 + Math.random() * 400;
        this.nextJamAt = now + 1200;
        this.history.length = 0;
        this.acceptsFromTop = false;
        return {
            goal: { x: b.x + Math.cos(angle) * b.size * 8,
                    y: b.y + Math.sin(angle) * b.size * 8 },
            power: 1,
        };
    }
}

// The goal controller owns the bot's job while the controllers below it own
// the weapons. Holding the job here prevents the chain from making a bot
// retarget or abandon a vault every frame.
const digWarsVault = require('../game/terrain/vault.js');
const digWarsOutposts = require('../game/terrain/outposts.js');
const digWarsChambers = require('../game/terrain/coreChambers.js');

class io_digWarsGoals extends IO {
    constructor(body) {
        super(body);
        this.current = null;
        this.goalUntil = 0;
        this.bankThreshold = null;
        this.orbitSign = ran.chance(0.5) ? 1 : -1;
        this.overrideUntil = 0;
        this.pendingReactionKey = null;
        this.pendingReactionUntil = 0;
        this.aimError = 0;
        this.aimErrorAt = 0;
        this.movementPlan = null;
        this.thrustUntil = 0;
        this.nextThrustAt = 0;
        this.senseAt = 0;
        this.cachedRobber = null;
        this.cachedCombat = null;
        this.cachedGem = null;
        this.cachedMarkerHelp = null;
        this.cachedImmediateThreat = null;
        this.cachedPlayer = null;
        this.cachedKing = null;
        this.cachedDefense = null;
        this.nextRockAt = 0;
        this.showoffUntil = 0;
        this.nextShowoffAt = Date.now() + 5000 + Math.random() * 8000;
        this.showoffAngle = ran.random(2 * Math.PI);
        this.cachedObjective = null;
        // Each bot gets a different orbit phase and pace. These are deliberately
        // independent from the squad target so a push looks like people moving
        // together, not a synchronized animation.
        this.orbitPlan = null;
        this.minePlan = null;
    }

    skillLevel() {
        return util.clamp(this.body.botSkill ?? 0.5, 0, 1);
    }

    advancedChance() {
        return 0.15 + this.skillLevel() * 0.8;
    }

    reactionDelay() {
        return 400 - this.skillLevel() * 310;
    }

    canReactTo(key, now) {
        if (this.pendingReactionKey !== key) {
            this.pendingReactionKey = key;
            this.pendingReactionUntil = now + this.reactionDelay();
            return false;
        }
        if (now < this.pendingReactionUntil) return false;
        this.pendingReactionKey = null;
        return true;
    }

    aimVector(x, y, now) {
        if (now - this.aimErrorAt > 110) {
            this.aimErrorAt = now;
            this.aimError = ran.gauss(0, (1 - this.skillLevel()) * 0.07);
        }
        const c = Math.cos(this.aimError), s = Math.sin(this.aimError);
        return { x: x * c - y * s, y: x * s + y * c };
    }

    aimAt(entity, now) {
        if (!entity) return { x: 0, y: 0 };
        const dx = entity.x - this.body.x, dy = entity.y - this.body.y;
        const distance = Math.hypot(dx, dy);
        let projectileSpeed = 0;
        for (const gun of this.body.guns?.values?.() || []) {
            if (!gun.canShoot || !gun.getTracking) continue;
            const tracking = gun.getTracking();
            if (tracking && tracking.speed > projectileSpeed) projectileSpeed = tracking.speed;
        }
        const lead = projectileSpeed > 0 ? util.clamp(distance / projectileSpeed, 0, 0.7) : 0.2;
        const vx = entity.velocity?.x || 0, vy = entity.velocity?.y || 0;
        return this.aimVector(dx + vx * lead, dy + vy * lead, now);
    }

    isRammer() {
        return this.body.botIsRammer ?? (!this.body.guns || this.body.guns.size === 0);
    }

    combatNumbers(range = 760) {
        const enemies = new Set(), allies = new Set();
        const entities = global.targetableEntities;
        if (!entities) return { enemies, allies };
        for (const entity of entities.values()) {
            if (!['tank', 'miniboss', 'crasher'].includes(entity.type)) continue;
            const root = this.rootOf(entity);
            if (!root || root === this.body || !root.health || root.health.amount <= 0) continue;
            if (Math.hypot(root.x - this.body.x, root.y - this.body.y) > range) continue;
            if (root.team === this.body.team && (root.isBot || root.isPlayer)) allies.add(root.id);
            else if (this.visibleEnemy(root, range)) enemies.add(root.id);
        }
        return { enemies, allies };
    }

    shouldRetreatFrom(entity) {
        const root = this.rootOf(entity);
        const healthRatio = this.body.health.max ? this.body.health.amount / this.body.health.max : 1;
        const temperament = this.body.botTemperament || 'balanced';
        const threshold = temperament === 'aggressive' ? 0.28 : temperament === 'passive' ? 0.62 : 0.46;
        const numbers = this.combatNumbers();
        const outnumbered = numbers.enemies.size > numbers.allies.size + 1;
        return healthRatio < threshold || outnumbered || (root && root.isBot && temperament === 'passive');
    }

    rootOf(entity) {
        let root = entity, hops = 0;
        while (root && root.master && root.master !== root && hops++ < 8) root = root.master;
        return root || entity;
    }

    distanceTo(point) {
        return Math.hypot(point.x - this.body.x, point.y - this.body.y);
    }

    ownVault() {
        return digWarsVault.getVaults().find(v => v.team === this.body.team) || null;
    }

    enemy(entity) {
        const root = this.rootOf(entity);
        return root && root !== this.body && root.team !== this.body.team &&
            root.team !== TEAM_ROOM && !root.godmode && !root.passive &&
            !(root.isDead && root.isDead());
    }

    visibleEnemy(entity, range) {
        if (!this.enemy(entity)) return false;
        if (!entity.health || entity.health.amount <= 0) return false;
        if (entity.invuln || this.rootOf(entity).invuln) return false;
        if (entity.alpha != null && entity.alpha <= 0.5 && !this.body.aiSettings?.seeInvisible) return false;
        const dx = entity.x - this.body.x, dy = entity.y - this.body.y;
        return dx * dx + dy * dy <= range * range;
    }

    findEnemy(predicate, range = this.body.fov || 1200) {
        const candidates = [];
        const entities = global.targetableEntities;
        if (!entities) return null;
        for (const entity of entities.values()) {
            if (!['tank', 'miniboss', 'crasher'].includes(entity.type)) continue;
            if (!this.visibleEnemy(entity, range) || !predicate(entity, this.rootOf(entity))) continue;
            candidates.push(entity);
        }
        return candidates.length ? candidates.sort((a, b) => {
            const ar = this.rootOf(a), br = this.rootOf(b);
            const av = predicate(a, ar) === true ? (ar.carriedGems || 0) : 0;
            const bv = predicate(b, br) === true ? (br.carriedGems || 0) : 0;
            return (this.distanceTo(a) - av * 0.08) - (this.distanceTo(b) - bv * 0.08);
        })[0] : null;
    }

    findRobTarget() {
        const cap = this.body.gemCap || 4000;
        const minimum = Math.max(30, cap * 0.05);
        return this.findEnemy((entity, root) => (root.carriedGems || 0) >= minimum);
    }

    findKingTarget() {
        const kingId = global.gameManager?.room?.topPlayerID;
        const king = kingId != null ? global.entities.get(kingId) : null;
        return king && king.type === 'tank' && this.visibleEnemy(king, this.body.fov || 1200)
            ? king : null;
    }

    findCombatTarget() {
        // Real players outrank every polygon and bot. The top player is the
        // server's king, so a visible king gets priority after humans nearby.
        return this.findEnemy((entity, root) => !!root.isPlayer) ||
            this.findKingTarget() ||
            this.findEnemy(() => true);
    }

    findRealPlayerTarget() {
        const players = global.gameManager?.socketManager?.players || [];
        let best = null, bestDistance = Infinity;
        for (const socketPlayer of players) {
            const player = socketPlayer?.body;
            if (!player || player.isDead?.() || player.isGhost || player.team === this.body.team || player.invuln) continue;
            const distance = this.distanceTo(player);
            const nearObjective = digWarsOutposts.getOutposts().some(site =>
                Math.hypot(player.x - site.x, player.y - site.y) <= 700 &&
                Math.hypot(this.body.x - site.x, this.body.y - site.y) <= 1900
            );
            if (distance > (this.body.fov || 1200) * 1.45 && !nearObjective) continue;
            if (distance < bestDistance) { best = player; bestDistance = distance; }
        }
        return best;
    }

    findNearbyGem() {
        if ((this.body.carriedGems || 0) >= (this.body.gemCap || 4000)) return null;
        const now = Date.now();
        let best = null, bestScore = Infinity;
        for (const entity of global.entities.values()) {
            if (!entity.isGemPickup || !(entity.gemValue > 0) || entity.isDead?.()) continue;
            const distance = this.distanceTo(entity);
            if (distance > 850) continue;
            const ownMine = entity.gemSourceId === this.body.id;
            const recentKillLoot = (this.body._collectLootUntil || 0) > now && entity.gemSourceId === undefined;
            if (!ownMine && !recentKillLoot && distance > 260) continue;
            const score = distance - (ownMine ? 900 : 0) - (recentKillLoot ? 500 : 0);
            if (score < bestScore) { best = entity; bestScore = score; }
        }
        return best;
    }

    findMarkerHelp() {
        const markers = global.gameManager?.gameHandler?.activeEnemyMarkers?.(this.body.team) || [];
        const assigned = this.body._botHelpMarker && this.body._botHelpMarker.expiresAt > Date.now()
            ? this.body._botHelpMarker : null;
        const pool = assigned ? [assigned] : markers;
        return pool
            .filter(marker => marker && marker.expiresAt > Date.now())
            .sort((a, b) => this.distanceTo(a) - this.distanceTo(b))[0] || null;
    }

    findEnemyNear(point, range) {
        const entities = global.targetableEntities;
        if (!entities) return null;
        const maxFromBot = (this.body.fov || 1200) * 1.35;
        let best = null, bestDistance = Infinity;
        for (const entity of entities.values()) {
            if (!['tank', 'miniboss', 'crasher'].includes(entity.type)) continue;
            if (!this.enemy(entity) || !entity.health || entity.health.amount <= 0) continue;
            if (entity.invuln || this.rootOf(entity).invuln) continue;
            const fromBot = this.distanceTo(entity);
            const fromPoint = Math.hypot(entity.x - point.x, entity.y - point.y);
            if (fromBot > maxFromBot || fromPoint > range) continue;
            if (fromBot < bestDistance) { best = entity; bestDistance = fromBot; }
        }
        return best;
    }

    findPlayerNearObjective() {
        const players = [];
        const entities = global.targetableEntities;
        if (!entities) return null;
        for (const entity of entities.values()) {
            const player = this.rootOf(entity);
            if (entity !== player || !player.isPlayer || player.team === this.body.team || player.isDead?.()) continue;
            if (!player.health || player.health.amount <= 0 || player.invuln) continue;
            for (const site of digWarsOutposts.getOutposts()) {
                const nearSite = Math.hypot(player.x - site.x, player.y - site.y) <= 650;
                const botCanJoin = Math.hypot(this.body.x - site.x, this.body.y - site.y) <= 1800;
                if (nearSite && botCanJoin) {
                    players.push({ player, distance: Math.hypot(player.x - this.body.x, player.y - this.body.y) });
                    break;
                }
            }
        }
        return players.sort((a, b) => a.distance - b.distance)[0]?.player || null;
    }

    findDefenseTarget() {
        const states = new Map(digWarsOutposts.stateSnapshot().map(s => [s.id, s]));
        const options = [];
        for (const site of digWarsOutposts.getOutposts()) {
            if (site.team !== this.body.team || !site.banner || site.banner.isDead()) continue;
            const state = states.get(site.id);
            const threat = this.findEnemyNear(site, 850);
            const health = state ? state.h : 1;
            if (!threat && health > 0.72) continue;
            options.push({
                point: site,
                target: threat,
                score: this.distanceTo(site) + health * 180 - (threat ? 350 : 0),
            });
        }
        return options.sort((a, b) => a.score - b.score)[0] || null;
    }

    findObjective() {
        const room = global.gameManager && global.gameManager.room;
        const range = room ? Math.hypot(room.width, room.height) : Math.max(1200, this.body.fov || 0);
        const options = [];
        const outpostList = digWarsOutposts.getOutposts();
        const outpostStates = new Map(digWarsOutposts.stateSnapshot().map(s => [s.id, s]));
        const push = this.body._botPushTarget && (this.body._botPushTargetUntil || 0) > Date.now()
            ? this.body._botPushTarget : null;
        const pushSite = push && outpostList.find(site => site.id === push.id &&
            (site.team === 0 || site.team !== this.body.team));
        for (const site of outpostList) {
            const state = outpostStates.get(site.id);
            const enemyHeld = site.team !== 0 && site.team !== this.body.team;
            const unclaimed = site.team === 0;
            if (!unclaimed && !enemyHeld) continue;
            const distance = this.distanceTo(site);
            if (distance <= range) options.push({
                kind: 'outpost', point: site, health: state ? state.h : 1,
                score: distance + (unclaimed ? 0 : (state ? state.h : 1) * 250),
            });
        }

        const chamberList = digWarsChambers.getChambers();
        const chamberStates = new Map(digWarsChambers.stateSnapshot().map(s => [s.id, s]));
        for (const chamber of chamberList) {
            const state = chamberStates.get(chamber.id);
            // A chamber with missing/neutral ownership is not a valid bot
            // objective. This explicit check prevents a bad team value from
            // turning a friendly core into an attack target.
            if (chamber.team == null || chamber.team === TEAM_ROOM ||
                chamber.team === this.body.team || !state || state.st !== 0 || state.h > 0.8) continue;
            const distance = this.distanceTo(chamber);
            if (distance <= range) options.push({
                kind: 'chamber', point: chamber, health: state.h,
                score: distance + state.h * 250,
            });
        }
        if (pushSite) {
            const pushed = options.find(option => option.point.id === pushSite.id);
            if (pushed) return { ...pushed, score: pushed.score - 1000 };
        }
        return options.sort((a, b) => a.score - b.score)[0] || null;
    }

    sense(now) {
        if (now < this.senseAt) return;
        this.cachedRobber = this.findRobTarget();
        this.cachedPlayer = this.findRealPlayerTarget() ||
            this.findEnemy((entity, root) => !!root.isPlayer) || this.findPlayerNearObjective();
        this.cachedGem = this.findNearbyGem();
        this.cachedMarkerHelp = this.findMarkerHelp();
        this.cachedKing = this.findKingTarget();
        // Nearby enemy tanks are an immediate situation, not background map
        // traffic. Notice them before defending or mining so a bot either
        // fights back or takes an open route away from the attacker.
        const recentAttacker = this.body._lastDamageSource &&
            now - (this.body._lastDamageAt || 0) < 2500 &&
            this.visibleEnemy(this.body._lastDamageSource, Math.min(this.body.fov || 1200, 900))
            ? this.body._lastDamageSource : null;
        this.cachedImmediateThreat = recentAttacker ||
            this.findEnemy(() => true, Math.min(this.body.fov || 1200, 1600));
        this.cachedCombat = this.cachedPlayer || this.cachedKing || this.findEnemy(() => true);
        this.cachedDefense = this.findDefenseTarget();
        this.cachedObjective = this.findObjective();
        this.senseAt = now + 100 + (1 - this.skillLevel()) * 100;
    }

    nearestRock() {
        if (Date.now() < this.nextRockAt) return null;
        const terrain = global.gameManager && global.gameManager.terrainGrid;
        if (!terrain) return null;
        const ignored = this.body._digWarsIgnoredRockUntil > Date.now()
            ? this.body._digWarsIgnoredRock
            : null;
        if (ignored && terrain.rocks) {
            let best = null, bestDistance = 450 * 450;
            for (const rock of terrain.rocks.values()) {
                if (!rock.alive || rock === ignored) continue;
                const dx = rock.wx - this.body.x, dy = rock.wy - this.body.y;
                const distance = dx * dx + dy * dy;
                if (distance < bestDistance) { bestDistance = distance; best = rock; }
            }
            if (best) return best;
        }
        return terrain.nearestRock ? terrain.nearestRock(this.body.x, this.body.y, 450) : null;
    }

    pushFormationPoint(target, desiredRange) {
        const slot = this.body._botPushSlot ?? 0;
        const size = this.body._botPushSize || 1;
        const base = Math.atan2(this.body.y - target.y, this.body.x - target.x);
        const angle = base + (slot - (size - 1) / 2) * 0.6;
        const radius = desiredRange + Math.abs(slot - (size - 1) / 2) * 28;
        return { x: target.x + Math.cos(angle) * radius, y: target.y + Math.sin(angle) * radius };
    }

    orbitGoal(target, desiredRange, now, key) {
        const slot = this.body._botPushSlot ?? 0;
        const size = this.body._botPushSize || 1;
        if (!this.orbitPlan || this.orbitPlan.key !== key) {
            const startingAngle = Math.atan2(this.body.y - target.y, this.body.x - target.x);
            this.orbitPlan = {
                key,
                startedAt: now,
                phase: startingAngle + ran.gauss(0, 0.35),
                rate: (0.00018 + Math.random() * 0.00024) * (ran.chance(0.5) ? 1 : -1),
            };
        }
        const offset = slot - (size - 1) / 2;
        const angle = this.orbitPlan.phase + (now - this.orbitPlan.startedAt) * this.orbitPlan.rate + offset * 0.58;
        const radius = desiredRange + Math.abs(offset) * 28;
        return {
            x: target.x + Math.cos(angle) * radius,
            y: target.y + Math.sin(angle) * radius,
        };
    }

    mineFiringPoint(rock, now) {
        const key = `mine:${rock.k ?? rock.wx}`;
        if (!this.minePlan || this.minePlan.key !== key) {
            const angle = Math.atan2(this.body.y - rock.wy, this.body.x - rock.wx) || this.orbitSign * Math.PI / 2;
            this.minePlan = {
                key,
                startedAt: now,
                phase: angle + ran.gauss(0, 0.18),
                rate: (0.00012 + Math.random() * 0.00016) * (ran.chance(0.5) ? 1 : -1),
            };
        }
        const range = Math.max(145, (this.body.realSize || this.body.size || 1) * 2.8);
        const angle = this.minePlan.phase + (now - this.minePlan.startedAt) * this.minePlan.rate;
        return {
            x: rock.wx + Math.cos(angle) * range,
            y: rock.wy + Math.sin(angle) * range,
        };
    }

    engagePoint(target, desiredRange) {
        const dx = target.x - this.body.x, dy = target.y - this.body.y;
        const distance = Math.hypot(dx, dy) || 1;
        const ux = dx / distance, uy = dy / distance;
        const tangent = { x: -uy * this.orbitSign, y: ux * this.orbitSign };
        const side = Math.min(100, Math.max(35, desiredRange * 0.45));
        return {
            x: target.x - ux * desiredRange + tangent.x * side,
            y: target.y - uy * desiredRange + tangent.y * side,
        };
    }

    desiredCombatRange() {
        if (this.isRammer()) return Math.max(this.body.size * 2.5, 45);
        const defs = (this.body.defs || []).join(' ').toLowerCase();
        if (/sniper|assassin|ranger|marksman|stalker|rifle|predator/.test(defs)) return 280;
        if (/destroyer|artillery|mortar|launcher|ordnance/.test(defs)) return 230;
        return 135;
    }

    hasRecoilDrive() {
        const defs = (this.body.defs || []).join(' ').toLowerCase();
        return /penta|triplet|triple|spread|machinegun|minigun|sprayer|booster|fighter|falcon|annihilator/.test(defs);
    }

    steerGoal(target, now, key, combat = false, finalDistance = 80, stable = false) {
        const b = this.body;
        const dx = target.x - b.x, dy = target.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= finalDistance) return { x: target.x, y: target.y };

        const base = Math.atan2(dy, dx);
        const planDistance = this.movementPlan
            ? Math.hypot(this.movementPlan.x - b.x, this.movementPlan.y - b.y)
            : Infinity;
        if (!this.movementPlan || this.movementPlan.key !== key || now >= this.movementPlan.until || planDistance < Math.max(28, b.size * 2)) {
            const skill = this.skillLevel();
            const side = ran.chance(0.5) ? 1 : -1;
            let angle = base;
            if (combat) {
                const desired = this.desiredCombatRange();
                const correction = util.clamp((distance - desired) / Math.max(desired, 1), -1, 1) * 0.35;
                const weave = distance > desired + 70 ? ran.randomRange(0.12, 0.32) : Math.PI / 2 + ran.gauss(0, 0.12);
                angle = base + side * weave - correction * side;
            } else {
                // Commit to short waypoints instead of recomputing a point
                // directly in front of the hull every tick. Objective pushes
                // opt into the stable branch because the orbit itself already
                // supplies imperfect movement.
                angle = stable ? base : base + side * ran.randomRange(0.08, 0.24 + (1 - skill) * 0.16);
            }
            const reach = Math.min(distance, combat ? 260 : 330);
            this.movementPlan = {
                key,
                until: now + (combat ? 650 : 850) + ran.random(1000 + skill * 1200),
                angle,
                x: b.x + Math.cos(angle) * reach,
                y: b.y + Math.sin(angle) * reach,
            };
        }
        return { x: this.movementPlan.x, y: this.movementPlan.y };
    }

    rockSafeGoal(goal, target) {
        const tg = global.gameManager && global.gameManager.terrainGrid;
        if (!tg || !tg.rockHitByCircle || !goal) return goal;
        // The old 0.82 multiplier allowed the hull edge to scrape a canyon
        // face, then the movement controller kept requesting the same blocked
        // waypoint. Give the whole tank a small clearance margin.
        const radius = Math.max(this.body.realSize || this.body.size || 1, 12) * 1.05 + 3;
        const room = global.gameManager && global.gameManager.room;
        const insideRoom = point => !room || (
            Math.abs(point.x) < room.width / 2 - radius - 35 &&
            Math.abs(point.y) < room.height / 2 - radius - 35
        );
        const pathBlockCount = (from, to) => {
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            const steps = Math.max(3, Math.ceil(distance / Math.max(radius * 2, 22)));
            let blocked = 0;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                if (tg.rockHitByCircle(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius)) blocked++;
            }
            return blocked;
        };
        const pathBlocked = (from, to) => pathBlockCount(from, to) > 0;
        if (insideRoom(goal) && !pathBlocked(this.body, goal)) return goal;

        const tx = target?.x ?? goal.x, ty = target?.y ?? goal.y;
        const dx = tx - this.body.x, dy = ty - this.body.y;
        const distance = Math.hypot(dx, dy) || 1;
        const base = Math.atan2(dy, dx);
        const distances = [radius * 4, radius * 7, radius * 10, radius * 13];
        const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
            3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI];
        const candidates = [];
        for (const reach of distances) {
            for (const offset of angles) {
                const angle = base + offset;
                const point = {
                    x: this.body.x + Math.cos(angle) * reach,
                    y: this.body.y + Math.sin(angle) * reach,
                };
                if (!insideRoom(point)) continue;
                candidates.push({ point, blocks: pathBlockCount(this.body, point) });
            }
        }
        const clear = candidates.filter(candidate =>
            candidate.blocks === 0 && !tg.rockHitByCircle(candidate.point.x, candidate.point.y, radius)
        );
        if (clear.length) {
            return clear.sort((a, b) =>
                Math.hypot(a.point.x - tx, a.point.y - ty) - Math.hypot(b.point.x - tx, b.point.y - ty)
            )[0].point;
        }
        // A bot can be partially buried, so sometimes every complete path
        // probe reports a hit. Still choose the least-blocked outward heading;
        // returning its current position was the part that made the screenshot
        // look permanently stuck.
        return candidates.sort((a, b) =>
            a.blocks - b.blocks ||
            Math.hypot(a.point.x - tx, a.point.y - ty) - Math.hypot(b.point.x - tx, b.point.y - ty)
        )[0]?.point || {
            x: this.body.x - Math.cos(base) * radius * 5,
            y: this.body.y - Math.sin(base) * radius * 5,
        };
    }

    playfulGoal(goal, now) {
        if (this.body.botStyle === 'normal' || ['combat', 'rob', 'bank', 'defend', 'survive'].includes(this.current?.kind)) {
            this.showoffUntil = 0;
            return goal;
        }
        if (!this.showoffUntil && now >= this.nextShowoffAt && ran.chance(0.45)) {
            this.showoffUntil = now + 650 + Math.random() * 900;
            this.showoffAngle = ran.random(2 * Math.PI);
        }
        if (this.showoffUntil && now < this.showoffUntil) {
            this.showoffAngle += this.body.botStyle === 'spinner' ? 0.42 : 0.16;
            const radius = this.body.size * (this.body.botStyle === 'spinner' ? 7 : 4);
            return {
                x: this.body.x + Math.cos(this.showoffAngle) * radius,
                y: this.body.y + Math.sin(this.showoffAngle) * radius,
            };
        }
        if (this.showoffUntil) {
            this.showoffUntil = 0;
            this.nextShowoffAt = now + 7000 + Math.random() * 10000;
        }
        return goal;
    }

    playfulAim(target, now) {
        if (!target || !this.showoffUntil || this.body.botStyle !== 'spinner') return target;
        const length = Math.hypot(target.x, target.y);
        const angle = Math.atan2(target.y, target.x) + Math.sin(now / 70) * 0.3;
        return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
    }

    recoilAim(now, movementGoal) {
        if (!this.hasRecoilDrive() || this.isRammer()) return null;
        const dx = movementGoal.x - this.body.x, dy = movementGoal.y - this.body.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 100) return null;
        if (!this.thrustUntil && now < this.nextThrustAt) return null;
        if (!this.thrustUntil) {
            this.nextThrustAt = now + 900 + ran.random(1800);
            if (!ran.chance(0.18 + this.advancedChance() * 0.45)) return null;
            this.thrustUntil = now + 260 + ran.random(420);
        }
        if (now >= this.thrustUntil) {
            this.thrustUntil = 0;
            return null;
        }
        // Aim behind the hull while firing. Recoil then supplies a forward
        // burst, the same small cursor correction a human uses on recoil tanks.
        return this.aimVector(-dx / distance * 140, -dy / distance * 140, now);
    }

    choose(kind, data, now, locked = false) {
        this.current = { kind, ...data };
        const hold = 1500 + (1 - this.skillLevel()) * 1500;
        this.goalUntil = now + hold;
        this.body._digWarsGoalLocked = locked;
        this.body._digWarsGoal = kind;
        this.body._digWarsObjectivePoint = kind === 'objective' ? data.point : null;
        this.body._digWarsObjectiveKind = kind === 'objective' ? data.structureKind : null;
    }

    validCurrent() {
        if (!this.current) return false;
        if (this.current.kind === 'bank') {
            return !!this.body.vaultDeposit || (this.body.carriedGems || 0) >= 15;
        }
        if (this.current.kind === 'rob' || this.current.kind === 'combat') {
            return this.current.target && this.visibleEnemy(this.current.target, (this.body.fov || 1200) * 1.35);
        }
        if (this.current.kind === 'defend') {
            return !!this.current.point && (!this.current.target || this.visibleEnemy(this.current.target, (this.body.fov || 1200) * 1.35));
        }
        if (this.current.kind === 'mine') {
            if (this.body._digWarsIgnoredRock === this.current.rock && Date.now() < (this.body._digWarsIgnoredRockUntil || 0)) return false;
            return !!this.current.rock && this.current.rock.alive;
        }
        if (this.current.kind === 'collect') return !!this.current.gem && this.current.gem.gemValue > 0;
        if (this.current.kind === 'marker') return !!this.current.marker && this.current.marker.expiresAt > Date.now();
        if (this.current.kind === 'objective') {
            if (!this.current.point) return false;
            if (this.current.structureKind === 'chamber') {
                return this.current.point.team != null &&
                    this.current.point.team !== TEAM_ROOM &&
                    this.current.point.team !== this.body.team;
            }
            return true;
        }
        return true;
    }

    maybeOverride(now) {
        if (this.overrideUntil && now >= this.overrideUntil) {
            this.body.autoOverride = false;
            this.overrideUntil = 0;
        }
        if (this.current?.kind !== 'objective' || this.overrideUntil || this.body.autoOverride) return;
        const defs = (this.body.defs || []).join(' ').toLowerCase();
        if ((this.body.turrets?.size || 0) > 0 && /overseer|director|overlord|manager|factory|spawner|carrier|cruiser/.test(defs) && ran.chance(0.05 + this.skillLevel() * 0.35)) {
            this.overrideUntil = now + 700;
            this.body.autoOverride = true;
        }
    }

    output(now) {
        const goal = this.current;
        if (!goal) {
            this.body._digWarsGoal = 'wander';
            this.body._digWarsGoalLocked = false;
            this.body._digWarsCollecting = false;
            return {};
        }
        this.body._digWarsGoal = goal.kind;
        this.body._digWarsCollecting = goal.kind === 'collect';
        this.maybeOverride(now);

        if (goal.kind === 'bank') {
            this.body._digWarsCombatTarget = null;
            const vault = this.ownVault();
            if (!vault) return {};
            if (this.body.vaultOnPad) {
                if (!this.body.vaultDeposit && (this.body.carriedGems || 0) >= 15)
                    digWarsVault.depositFor(this.body, this.body.carriedGems);
                return { goal: { x: this.body.x, y: this.body.y } };
            }
            const movementGoal = this.steerGoal(vault, now, 'bank');
            const recoil = this.recoilAim(now, movementGoal);
            return recoil ? { goal: movementGoal, target: recoil, fire: true, main: true } : { goal: movementGoal };
        }
        if (goal.kind === 'survive') {
            this.body._digWarsCombatTarget = null;
            const vault = this.ownVault();
            const retreatPoint = vault || goal.point;
            return { goal: this.rockSafeGoal(this.steerGoal(retreatPoint, now, 'survive'), retreatPoint) };
        }
        if (goal.kind === 'defend') {
            this.body._digWarsCombatTarget = goal.target || null;
            const target = goal.target && this.visibleEnemy(goal.target, (this.body.fov || 1200) * 1.35)
                ? goal.target : null;
            const destination = target || goal.point;
            const movementGoal = this.rockSafeGoal(
                this.steerGoal(destination, now, `defend:${goal.point.id}`, !!target), destination
            );
            return {
                goal: movementGoal,
                target: target ? this.aimAt(target, now) : this.aimVector(destination.x - this.body.x, destination.y - this.body.y, now),
                fire: true,
                main: true,
            };
        }
        if (goal.kind === 'objective') {
            this.body._digWarsCombatTarget = null;
            const desiredRange = this.desiredCombatRange();
            const pushTarget = this.body._botPushTarget && (this.body._botPushTargetUntil || 0) > now
                ? this.body._botPushTarget : goal.point;
            const destination = this.isRammer()
                ? pushTarget
                : this.orbitGoal(pushTarget, desiredRange, now, `objective:${goal.point.id}`);
            // Armed tanks keep drifting around the objective instead of
            // parking on one pixel. Every bot has its own phase and orbit rate,
            // while rammer tanks still take the direct contact lane.
            const movementGoal = this.rockSafeGoal(
                this.playfulGoal(this.steerGoal(destination, now, `objective:${goal.point.id}`, false, 28, true), now), destination
            );
            const showingOff = this.showoffUntil > now && this.body.botStyle !== 'normal';
            // Recoil steering around an objective made tanks repeatedly reverse
            // their hull while still technically making progress. Save recoil
            // movement for actual combat; pushes use the stable orbit instead.
            const recoil = null;
            return recoil ? { goal: movementGoal, target: recoil, fire: true, main: true } : {
                goal: movementGoal,
                target: this.playfulAim(this.aimVector(pushTarget.x - this.body.x, pushTarget.y - this.body.y, now), now),
                fire: !showingOff,
                main: !showingOff,
            };
        }
        if (goal.kind === 'marker') {
            this.body._digWarsCombatTarget = null;
            const movementGoal = this.rockSafeGoal(
                this.steerGoal(goal.marker, now, `marker:${goal.marker.by}`, false, 70), goal.marker
            );
            return {
                goal: movementGoal,
                target: this.aimVector(goal.marker.x - this.body.x, goal.marker.y - this.body.y, now),
                fire: false,
                main: false,
                alt: false,
            };
        }
        if (goal.kind === 'collect') {
            this.body._digWarsCombatTarget = null;
            const movementGoal = this.rockSafeGoal(
                this.steerGoal(goal.gem, now, `collect:${goal.gem.id}`, false, 20), goal.gem
            );
            return {
                goal: movementGoal,
                target: { x: goal.gem.x - this.body.x, y: goal.gem.y - this.body.y },
                fire: false,
                main: false,
                alt: false,
            };
        }
        if (goal.kind === 'rob' || goal.kind === 'combat') {
            this.body._digWarsCombatTarget = goal.target;
            const movementGoal = this.rockSafeGoal(
                this.steerGoal(goal.target, now, `${goal.kind}:${this.rootOf(goal.target).id ?? goal.target.id}`, true), goal.target
            );
            const target = this.aimAt(goal.target, now);
            return { goal: movementGoal, target, fire: true, main: true };
        }
        if (goal.kind === 'mine') {
            this.body._digWarsCombatTarget = null;
            this.body._digWarsMineRock = goal.rock;
            // Only true rammers should physically enter the rock line. Armed
            // tanks use a slowly moving firing lane, which makes them feel
            // alive without ever steering their hull into the rock.
            const rockPoint = { x: goal.rock.wx, y: goal.rock.wy };
            const movementGoal = this.isRammer()
                ? this.steerGoal(rockPoint, now, `mine:${goal.rock.k ?? goal.rock.wx}`, false, 25)
                : this.rockSafeGoal(this.mineFiringPoint(goal.rock, now), rockPoint);
            if (this.isRammer()) {
                // A rammer breaks terrain through contact, never through an
                // imaginary ranged attack while it is still approaching.
                return { goal: movementGoal, fire: false, main: false, alt: false };
            }
            const target = this.aimVector(goal.rock.wx - this.body.x, goal.rock.wy - this.body.y, now);
            return { goal: movementGoal, target, fire: true, main: true };
        }
        return {};
    }

    think(input) {
        const b = this.body, now = Date.now();
        if (!b.isBot || b.type !== 'tank') return {};
        // An earlier unstick escape is deliberately preserved for this tick.
        if (input.goal != null) return {};

        const healthRatio = b.health.max ? b.health.amount / b.health.max : 1;
        const retreatThreshold = b.botTemperament === 'aggressive' ? 0.28
            : b.botTemperament === 'passive' ? 0.62 : 0.46;
        // Retreat decisions happen before mining or objective decisions. The
        // tank still gets personality, but it does not throw itself into a
        // hopeless fight or flee blindly through the rock.
        const nearbyThreat = this.findEnemy(() => true, b.fov || 1200);
        if (healthRatio < 0.2 + this.skillLevel() * 0.1 ||
            (nearbyThreat && healthRatio < retreatThreshold)) {
            if (!this.current || this.current.kind !== 'survive') {
                const threat = this.findEnemy(() => true, b.fov || 1200);
                const vault = this.ownVault();
                this.choose('survive', { point: vault || {
                    x: b.x - ((threat ? threat.x : b.x + 1) - b.x),
                    y: b.y - ((threat ? threat.y : b.y + 1) - b.y),
                } }, now, true);
            }
            return this.output(now);
        }

        const cap = b.gemCap || 4000;
        this.bankThreshold ??= cap * (0.55 + Math.random() * 0.35);
        const carryingPressure = healthRatio < 0.45;
        const bankUnderPressure = !carryingPressure || ran.chance(this.advancedChance());
        if ((b.carriedGems || 0) >= this.bankThreshold && this.current?.kind !== 'bank' && bankUnderPressure)
            this.choose('bank', {}, now, true);

        if (this.current && !this.validCurrent()) {
            if (this.current.kind === 'mine' && this.current.rock && !this.current.rock.alive)
                this.nextRockAt = now + 900 + Math.random() * 900;
            this.current = null;
        }
        if (this.current?.kind === 'bank' && (b.carriedGems || 0) < 15 && !b.vaultDeposit) this.current = null;

        // Once a bot has committed to a visible player, keep that fight as the
        // whole job until the target dies, escapes, or the bot must survive.
        // Re-check the numbers, though: a second attacker turning up makes a
        // lone bot disengage instead of suiciding into a 2v1.
        if (this.current?.kind === 'combat' && this.validCurrent()) {
            if (this.shouldRetreatFrom(this.current.target)) {
                const retreatPoint = this.ownVault() || {
                    x: b.x - (this.current.target.x - b.x),
                    y: b.y - (this.current.target.y - b.y),
                };
                this.choose('survive', { point: retreatPoint }, now, true);
            }
            return this.output(now);
        }

        // Robbery is allowed to interrupt mining, but a committed robbery is
        // not retargeted every frame. Objectives similarly outrank mining,
        // while every selected goal still gets its short human-like hold time.
        this.sense(now);
        if (this.cachedPlayer) {
            if (this.shouldRetreatFrom(this.cachedPlayer)) {
                const retreatPoint = this.ownVault() || {
                    x: b.x - (this.cachedPlayer.x - b.x),
                    y: b.y - (this.cachedPlayer.y - b.y),
                };
                this.choose('survive', { point: retreatPoint }, now, true);
                return this.output(now);
            }
            // Human players are never a background objective. Snap the job to
            // the player immediately, even if the bot was banking or pushing.
            if (this.current?.kind !== 'combat' || this.current.target.id !== this.cachedPlayer.id)
                this.choose('combat', { target: this.cachedPlayer }, now, true);
            return this.output(now);
        }
        // A nearby enemy bot is already part of the fight. Do not let an
        // outpost-defense assignment make the tank ignore it.
        if (this.cachedImmediateThreat) {
            const threat = this.cachedImmediateThreat;
            if (this.shouldRetreatFrom(threat)) {
                const retreatPoint = this.ownVault() || {
                    x: b.x - (threat.x - b.x),
                    y: b.y - (threat.y - b.y),
                };
                this.choose('survive', { point: retreatPoint }, now, true);
                return this.output(now);
            }
            if (this.current?.kind !== 'combat' || this.current.target.id !== threat.id)
                this.choose('combat', { target: threat }, now, true);
            return this.output(now);
        }

        const shouldCollect = this.cachedGem &&
            (this.current?.kind !== 'bank' || (this.body._lastKillAt || 0) > now - 5000);
        if (shouldCollect) {
            if (this.current?.kind !== 'collect' || this.current.gem.id !== this.cachedGem.id)
                this.choose('collect', { gem: this.cachedGem }, now, true);
            return this.output(now);
        }

        // Team danger pings are a secondary call for help: they beat mining,
        // wandering, and outpost pushing, but never beat a real enemy in view
        // or a bot carrying out immediate loot collection.
        if (this.cachedMarkerHelp && this.current?.kind !== 'bank') {
            if (this.current?.kind !== 'marker' || this.current.marker.by !== this.cachedMarkerHelp.by)
                this.choose('marker', { marker: this.cachedMarkerHelp }, now, true);
            return this.output(now);
        }

        const defense = this.current?.kind === 'defend'
            ? (this.validCurrent() ? this.current : null)
            : this.cachedDefense;
        if (defense && this.current?.kind !== 'bank') {
            const defenseKey = `defend:${defense.point.id}`;
            const ready = this.current?.kind === 'defend' || this.canReactTo(defenseKey, now);
            if (ready) {
                if (this.current?.kind !== 'defend' || now >= this.goalUntil)
                    this.choose('defend', { point: defense.point, target: defense.target }, now, true);
                return this.output(now);
            }
            if (this.current?.kind === 'defend') return this.output(now);
        }

        const carryingTarget = this.current?.kind === 'rob'
            ? (this.validCurrent() ? this.current.target : null)
            : this.cachedRobber;
        if (carryingTarget && this.current?.kind !== 'bank') {
            const targetKey = `rob:${this.rootOf(carryingTarget).id ?? carryingTarget.id}`;
            const ready = this.current?.kind === 'rob' || this.canReactTo(targetKey, now);
            if (ready && (this.current?.kind !== 'rob' || now >= this.goalUntil))
                this.choose('rob', { target: carryingTarget }, now, true);
            else if (ready) return this.output(now);
        } else {
            const combatTarget = this.current?.kind === 'combat'
                ? (this.validCurrent() ? this.current.target : null)
                : this.cachedCombat;
            if (combatTarget && this.current?.kind !== 'bank') {
                if (this.shouldRetreatFrom(combatTarget)) {
                    const retreatPoint = this.ownVault() || {
                        x: b.x - (combatTarget.x - b.x),
                        y: b.y - (combatTarget.y - b.y),
                    };
                    this.choose('survive', { point: retreatPoint }, now, true);
                    return this.output(now);
                }
                const targetKey = `combat:${this.rootOf(combatTarget).id ?? combatTarget.id}`;
                const ready = this.current?.kind === 'combat' || this.canReactTo(targetKey, now);
                if (ready && (this.current?.kind !== 'combat' || now >= this.goalUntil))
                    this.choose('combat', { target: combatTarget }, now, true);
                else if (ready) return this.output(now);
            } else {
                const objectiveHeld = ['rob', 'bank', 'combat', 'defend'].includes(this.current?.kind) ||
                    (this.current?.kind === 'objective' && now < this.goalUntil);
                const objective = objectiveHeld ? null : this.cachedObjective;
                const objectiveKey = objective && `${objective.kind}:${objective.point.id}`;
                if (objective && (this.current?.kind === 'objective' || this.canReactTo(objectiveKey, now)))
                    this.choose('objective', { point: objective.point, structureKind: objective.kind }, now, true);
                else if (this.current && now < this.goalUntil && this.validCurrent()) {
                    return this.output(now);
                } else {
                    const rock = this.nearestRock();
                    if (rock) this.choose('mine', { rock }, now);
                    else this.current = null;
                }
            }
        }
        return this.output(now);
    }
}

// Dig Wars: gunless tanks can press into the rockline when they have no
// player command or living target. Armed tanks aim from where they are, so
// even body-damage builds do not drive into walls. No-ops without terrain.
// acceptsFromTop = false so a real target or a player order always wins.
class io_minesRocks extends IO {
    constructor(body) {
        super(body);
        this.acceptsFromTop = false;
        this.tick = ran.irandom(8);
        this.rock = null;
        this.nextRockAt = 0;
    }
    think(input) {
        if (this.body.type !== 'tank') return {};
        if (input.main || input.alt || input.target != null) return {};
        if (this.body._digWarsGoal && this.body._digWarsGoal !== 'mine') return {};
        if (this.body.master.autoOverride) return {};
        const tg = global.gameManager && global.gameManager.terrainGrid;
        if (!tg || !tg._voronoiMap) return {};
        const now = Date.now();
        if (now < this.nextRockAt) return {};
        if (this.rock && !this.rock.alive) {
            this.rock = null;
            this.nextRockAt = now + 900 + Math.random() * 900;
            return {};
        }
        if (++this.tick >= 8 || !this.rock) {
            this.tick = 0;
            this.rock = tg.nearestRock(this.body.x, this.body.y, 420);
        }
        if (!this.rock || !this.rock.alive) return {};
        return {
            target: { x: this.rock.wx - this.body.x, y: this.rock.wy - this.body.y },
            goal: { x: this.rock.wx, y: this.rock.wy },
            fire: true,
            power: 1,
        };
    }
}

let ioTypes = {
    //misc
    zoom: io_zoom,
    doNothing: io_doNothing,
    listenToPlayer: io_listenToPlayer,
    alwaysFire: io_alwaysFire,
    mapAltToFire: io_mapAltToFire,
    mapFireToAlt: io_mapFireToAlt,
    whirlwind: io_whirlwind,
    disableOnOverride: io_disableOnOverride,
    scaleWithMaster: io_scaleWithMaster,

    //aiming related
    stackGuns: io_stackGuns,
    nearestDifferentMaster: io_nearestDifferentMaster,
    healTeamMasters: io_healTeamMasters,
    targetSelf: io_targetSelf,
    onlyAcceptInArc: io_onlyAcceptInArc,
    spin: io_spin,
    spin2: io_spin2,

    //movement related
    unstick: io_unstick,
    digWarsGoals: io_digWarsGoals,
    canRepel: io_canRepel,
    mapTargetToGoal: io_mapTargetToGoal,
    siegeAI: io_siegeAI,
    moveInCircles: io_moveInCircles,
    boomerang: io_boomerang,
    formulaTarget: io_formulaTarget,
    orbit: io_orbit,
    goToMasterTarget: io_goToMasterTarget,
    avoid: io_avoid,
    minion: io_minion,
    snake: io_snake,
    hangOutNearMaster: io_hangOutNearMaster,
    fleeAtLowHealth: io_fleeAtLowHealth,
    wanderAroundMap: io_wanderAroundMap,
    minesRocks: io_minesRocks,
};

module.exports = { ioTypes, IO };

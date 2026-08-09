# Dig Wars bot plan

Five self-contained tasks. Do them in order: each one depends on the one
before it. Every task ends with a stated, checkable result.

Read this section first, it will save you from three dead ends.

---

## Ground truth about this codebase

These were verified by reading the code. Do not assume otherwise.

### Bots today

`server/game/index.js` → `spawnBots(loc, team)` creates a bot with exactly one
controller:

```js
o.define({ CONTROLLERS: ["nearestDifferentMaster"] }, false, false, false);
o.isBot = true;
o.name = Config.bot_name_prefix + ran.chooseBotName();
```

That single controller steers straight at the nearest enemy forever, which is
the whole reason bots look monotonous. There is no wander, no mining, no
objectives.

Bots are **off**: `bot_cap: 0` in two places, and the Dig Wars server uses the
per-server one:

- `server/config.js` line ~41, inside the Dig Wars server entry
  `properties: { teams: 2, bot_cap: 0 }`  ← this is the one that matters
- `server/config.js` line ~100, the global default

### Behaviour is a composable chain, not a monolith

`server/miscFiles/controllers.js` defines `class IO` with:

```js
think(input) -> { target, goal, fire, main, alt, power }   // any field may be null
```

Bodies hold `this.controllers = []` and run them in order. A controller sets
`this.acceptsFromTop = false` in its constructor when it must not be
overridden by controllers above it. Everything is registered in the `ioTypes`
map near the bottom of the file, and referenced by string in `CONTROLLERS`.

Already present and usable, do not rewrite them:

| controller | what it does |
| --- | --- |
| `nearestDifferentMaster` | acquire + aim + fire at nearest valid enemy |
| `minesRocks` | **already exists**: finds nearest rock within 420 and fires at it |
| `wanderAroundMap` | idle roaming |
| `avoid` | steer away from a thing |
| `fleeAtLowHealth` | retreat when hurt |
| `mapTargetToGoal`, `goToMasterTarget`, `orbit`, `minion`, `spin` | steering pieces |

### The AI layer knows nothing about Dig Wars

There is no reference to gems, carrying, banking, outposts or chambers
anywhere in `controllers.js`. That is the gap you are filling.

### THE BLOCKER, read this twice

Gem pickup and vault banking are wired to **socket-connected players only**:

```js
// server/game/index.js
gems.tickGem(instance, _tg, global.gameManager.socketManager.players);   // line ~738
vault.tick(global.gameManager.socketManager.players, ...);               // line ~892
```

`socketManager.players` contains only real clients. A bot has no socket, so
today a bot **cannot pick up a gem and cannot bank one**, no matter what its
AI decides to do. `vault.requestDeposit(socket, amount)` also takes a socket
and reads `body.vaultOnPad`, which only `vault.tick` ever sets.

Task 3 fixes this. If you skip it, bot mining will silently do nothing and
you will waste hours debugging the AI instead of the plumbing.

### Useful server APIs

- `global.gameManager.terrainGrid`
  - `nearestRock(wx, wy, maxR = 450)` → rock with `.wx .wy .alive` or null
  - `rockHitByCircle(x, y, r)`
- `require('./terrain/vault.js')` → `getVaults()` → `[{x, y, r, team}]`
- `require('./terrain/outposts.js')` → `getOutposts()`, `stateSnapshot()` → `[{id, t, h}]`
  (`t` = owning team, `0` = unclaimed; `h` = health 0..1)
- `require('./terrain/coreChambers.js')` → `getChambers()`, `stateSnapshot()` → `[{id, st, h}]`
- Body fields: `carriedGems`, `gemCap`, `team`, `isBot`, `guns` (**a Map, use
  `.size`**), `skill.raw` (server order is
  `rld,pen,str,dam,spd,shi,atk,hlt,rgn,mob`, NOT the display order)
- A gunless tank (`body.guns.size === 0`) is a rammer and mines by driving into
  rock. It cannot damage outposts or chambers at all.

### House style

- No em dashes in any string a player can see.
- Comments explain **why**, not what. Do not narrate the code.
- Do not commit. Leave changes in the working tree.

---

## Task 1: Locomotion and unsticking

**Do this first. Nothing else works if bots cannot move reliably.**

Bots will jam against rock constantly. This is observed, not theoretical: test
tanks wedged at `x ≈ -2764` and `x ≈ -2798` during manual testing and never
recovered on their own.

### Build

New controller `io_unstick` in `controllers.js`, registered in `ioTypes` as
`unstick`. It must run **above** every other movement controller and set
`acceptsFromTop = false` while it is actively escaping.

Logic:

1. Each tick record `body.x, body.y`. Keep a short rolling window, about 1s.
2. "Stuck" = the controller chain below wanted movement (a `goal` was set on
   the previous tick) **and** total displacement over the window is under
   roughly `body.size * 0.5`.
3. On stuck: choose an escape heading perpendicular to the blocked direction,
   picking the side with more open space (probe with
   `terrainGrid.rockHitByCircle` a few body-lengths out on each side). Emit
   that as `goal` for 600 to 1000ms, then release.
4. If the same spot jams again within a few seconds, escape the other way, then
   reverse away from it entirely.
5. Count escapes on `body._unstickCount` for the soak test in Task 5.

Add `unstick` as the first entry of the bot `CONTROLLERS` list.

### Done when

A soak of 8 bots for 5 minutes with no humans records **zero bots stationary
for more than 3 seconds**, and total `_unstickCount` stops growing once bots
are in open terrain.

---

## Task 2: Believable names

Current names come from a fixed 49-entry list in `server/lib/random.js`
(`nameLists.bots`: `Alice, Bob, ... Alpha, Bravo, Zulu`) behind an `[AI] `
prefix from `Config.bot_name_prefix`. With even six bots you get duplicates,
and the prefix announces them.

### Build

Replace `exports.chooseBotName` with a combinatorial generator. Real io names
are short, lowercase and slightly ugly. Mix these shapes with weights:

- `word` + optional digits: `frost`, `zephyr7`, `mole42`
- two words joined: `ironmole`, `dustkite`, `rock_eater`
- decorated: `xX_gravel_Xx`, `_venom_`, `iiToxiciiv`
- clan tagged: `TNT | rustler`, `[KOR] jinho`
- leetish: `d1gg3r`, `n0trly`, `sh4rd`
- rarely, one unicode glyph appended

Rules:

- Track issued names in a Set; never issue a duplicate while both are alive.
- Cap length at **24** characters, matching `maxlength="24"` on the client name
  input, so bot names cannot render wider than a real one.
- Bias heavily toward lowercase and short. Do not use Fortnite-style
  `ProGamer_YT` patterns.

**Decide deliberately:** set `bot_name_prefix` to `""` to hide bots, or keep a
marker. This choice binds the scoreboard later, see Task 5.

### Done when

100 generated names contain no duplicates, none exceed 24 characters, and a
person reading the leaderboard cannot pick out the bots by name alone.

---

## Task 3: Make gems and vaults work for bots (the plumbing)

**This is a server systems task, not an AI task. No behaviour work here.**

### Build

1. Introduce one list of "gem actors" = socket players **plus** live bot
   bodies. Simplest shape: a helper such as
   `gemActors()` returning `[...socketManager.players.map(p => p.body), ...bots]`
   filtered to alive, non-ghost bodies.
   Note `tickGem` and `vault.tick` currently receive objects with a `.body`
   property, so either normalise to bodies at the call site or keep the shape
   consistent. Pick one and apply it to both.
2. Update the two call sites in `server/game/index.js` (lines ~738 and ~892) to
   use it.
3. `gems.tickGem` and `vault.tick` must tolerate a body with **no socket**:
   - `gems.talkGems(body, delta)` already early-returns without a socket, good.
   - `vault.tick` writes `body.vaultOnPad`, which is fine for bots.
   - `vault.requestDeposit(socket, amount)` is socket-only. Add a
     body-level variant (for example `depositFor(body, amount)`) holding the
     real logic, and let `requestDeposit` delegate to it. Bots call the body
     variant directly.
4. Bank storage: real players use `socket.gemBanked`. Bots need an equivalent
   on the body, for example `body.botBanked`. Keep `MIN_DEPOSIT = 15`.
5. Respect the tutorial reservation already in `gems.tickGem`: a gem with
   `gemOwnerId` set must stay unavailable to everyone else, **bots included**.
   Do not weaken that check.

### Done when

A bot driven manually onto a loose gem picks it up (`carriedGems` rises), and a
bot standing on its own team vault pad with 15 or more carried banks them
(`carriedGems` falls, its bank rises). Verify by logging, not by eye.

---

## Task 4: The goal loop

Only now write behaviour. Add one controller, `io_digWarsGoals`, registered as
`digWarsGoals`. It decides **what the bot wants** and expresses it mainly as
`goal` (a world point to drive to), leaving aiming and firing to the
controllers below it.

### Goals, highest priority first

1. **Survive**: health below roughly 30 percent: head toward own vault or away
   from the nearest threat.
2. **Bank**: `carriedGems >= threshold`: drive to own team vault pad
   (`vault.getVaults()` filtered by `body.team`), then call the Task 3 deposit.
   Give each bot its own threshold between about 55 and 90 percent of `gemCap`
   so they do not all bank in unison.
3. **Rob**: an enemy within sight carrying a lot of gems: chase it.
4. **Objective**: an enemy-held or unclaimed outpost, or an enemy chamber,
   with low `h`, within range: go and hit it. **Skip this goal entirely when
   `body.guns.size === 0`**, since rammers cannot damage structures.
5. **Mine**: nearest ore rock. `io_minesRocks` already does the aiming and
   firing; this goal just needs to drive there. Rammers mine by ramming, so for
   a gunless body the goal is to press into the rock.
6. **Wander**: nothing to do, defer to `wanderAroundMap`.

### Rules that make it look human

- **Hysteresis.** Once a goal is chosen, hold it for at least 1.5 to 3 seconds
  unless Survive fires. Re-evaluating every tick is what makes bots twitch.
- **Commitment.** Keep a combat target for a beat instead of retargeting each
  tick.
- **Engagement range.** Snipers hold distance, rammers close, others sit in the
  middle. Strafe or orbit at range instead of walking a straight line at the
  target. **A bot must never hold a straight line at an enemy for more than
  about a second.**
- **Override.** Drone and auto tanks should occasionally press override to
  focus their drones, especially when pushing a structure.

### Suggested controller order for bots

```js
["unstick", "digWarsGoals", "minesRocks", "nearestDifferentMaster", "wanderAroundMap"]
```

`digWarsGoals` should set `acceptsFromTop = false` only while it is committed
to a goal that must not be overridden, such as banking.

### Done when

Watching a single bot for two minutes, it visibly mines, collects, banks, and
engages an enemy without walking a straight line at it, and its goal changes at
a human-looking cadence rather than every tick.

---

## Task 5: Difficulty, tuning and the soak harness

### Difficulty

Give each bot a `skill` from 0 to 1 at spawn, spread across the population so a
lobby has weak and strong ones. Drive **behaviour** from it, never stats:

- reaction delay before acting on a new target (roughly 400ms down to 90ms)
- aim error in radians, shrinking with skill
- retarget rate and goal hysteresis
- whether it uses advanced actions at all (override, banking under pressure,
  retreating with a full satchel)

Do **not** tune difficulty by handing bots better stats or faster reloads. That
produces bots that feel cheap rather than skilled.

Existing knobs to reuse: `bot_skill_upgrade_chances`,
`bot_class_upgrade_chances`, `bot_start_level`, `bot_xp_gain` in
`server/config.js`.

### Debug overlay

Bots must report their current goal so it can be read live. Send the goal
string with the bot's entity data and draw it under the bot when a debug flag
is on. You cannot tune what you cannot see.

### Soak harness

A headless script: N bots, zero humans, run 10 minutes, log per bot:

- gems mined, gems banked
- stuck events (`_unstickCount`)
- deaths, kills
- seconds spent in each goal

**Pass criteria**

| metric | target |
| --- | --- |
| stuck events per bot per minute | < 0.2 |
| bots that banked at least once | > 80 percent |
| time in Wander | < 25 percent |
| bots stationary > 3s | 0 |
| server mspt with 8 bots | within 20 percent of the empty-server baseline |

Measure the empty-server baseline first. Note that a loaded development machine
inflates these numbers badly, so take the baseline and the measurement in the
same session.

### Decide before finishing

**Do bots count on the scoreboard?** The DB scoreboard is coming. Retrofitting
bot exclusion into stored history is painful. Decide now, and if bots are
excluded, tag their records at write time rather than filtering by name later.

---

## Suggested order and why

1. **Locomotion**: everything else is worthless if bots pile into walls.
2. **Names**: cheap, and makes every later screenshot readable.
3. **Plumbing**: must precede behaviour, or mining silently does nothing.
4. **Goal loop**: the actual bot.
5. **Tuning**: only meaningful once the loop runs.

Shop and skins are **not** dependencies. Bots do not need to buy anything: give
them a cosmetic from the catalogue directly. Making bots transact would require
wallets, accounts and DB rows, which pollutes the economy and leaderboard for
no player-visible gain.

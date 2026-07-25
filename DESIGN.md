# DIG WARS — The Eternal Siege

> One world, one mountain, a war that never ends. The wall heals, the tunnels
> shift, and the deep always has something worth dying for.

**The philosophy in one sentence:** the wall is a living thing that heals; the
game is the eternal argument between two teams about where its edge should be.

---

## 1. What this game is

An infinite, persistent match. No rounds, no resets, no winning — the server
is a world. Arras gives us the combat for free; **our game is the wall**: a
destructible Voronoi mountain between two team bases that players carve in
real time and that continuously grows back.

Players spawn at level 45 with a short ramp to the top tank tier (~4 tiers
total). Combat progression is intentionally shallow and fast — you're
battle-ready in minutes. All long-term progression lives in the **economy**
(gems, gear, status), never in raw combat stats.

Two kinds of players must both have a great night: the **miner** (dig, get
rich, get home alive) and the **fighter** (hunt, raid, hold ground). Every
system below feeds one of them and creates work for the other.

### Anti-goals — what this game refuses to be
- **Not an idle miner.** Mining must never be optimal AFK or by holding one
  button against a wall. Budgets and ore-hunting keep it decision-driven.
- **No combat nerfs in service of mining.** PvP is arras, untouched. All
  mining limits live in the rock-damage path only.
- **No permanent player-built advantage.** Nothing outlives the geology; the
  wall must always be able to digest history, or the world calcifies.
- **No walking simulator.** Nobody should ever be more than ~20 seconds from
  a fight they can choose to join. Outposts, the Rift, and event pings exist
  to guarantee fight density.
- **No pay-to-anything.** Status is earned in-world.

---

## 2. The load-bearing pillar: the living wall

A round-based game can end when the wall is gone. An infinite game must
guarantee the wall is **never gone**.

- **Regrowth:** destroyed cells regrow after ~45s, only from cells adjacent to
  living rock — tunnels heal from the walls inward. A tunnel you use stays
  open (you keep clearing regrowth at its mouth); an abandoned one seals up.
- **Natural canyons:** two pre-carved winding routes (north and south)
  connect the bases from world-gen, with the Rift between them at center.
  Regrowth inside a canyon is ~4× slower and can never fully seal its
  centerline — there is always a walkable road to a fight, from minute zero.
  Canyons are the arteries; player-dug tunnels are the capillaries: flanks,
  ambushes, ore runs, secret heist approaches.
- **Equilibrium:** mining pressure pushes the rockline back; regrowth pushes
  it forward. The map at any moment is the battle line between those forces.
  A quiet server heals nearly solid; a raided one is swiss cheese. The world
  state tells the story of the last hour — no two logins see the same
  mountain.
- **Rubber-band geology:** regrowth is slightly faster on the side of the
  team that is losing ground, so the front line always drifts back toward
  center. Self-balancing disguised as nature.
- **Depth hardness:** rock HP scales 1× at the surface to ~3× at the wall's
  center-line. The middle of the mountain is a commitment.
- **Rock is a weapon (see §7):** regrowing rock *crushes* — it damages and
  shoves anything standing in a cell as it seals. Geology is a combatant.

## 3. The rhythm: siege cycles instead of rounds

Infinity with no peaks is a screensaver. The heartbeat:

- Team bases keep arras base protection — enemy tanks that drive into a base
  die. Spawns are sacred. Which is exactly why each team's **Core** is NOT in
  the base: it sits in a sealed chamber in the **deep rock on that team's
  side of the wall**. The only road to an enemy Core is through the rock —
  you dig your heist route (or branch off a canyon).
- The Core is a big, tanky, *permanent* structure. Killing it ends nothing.
  It's a **heist**: the Core cracks open, erupts a fountain of top-tier gems
  for every attacker present, then goes dormant and regrows over ~10 minutes
  while the rock on that side regrows at triple speed, resealing the breach
  and resetting the frontier.
- The eternal cycle: *quiet mining era → tunnels creep toward enemy territory
  → breach attempt → defense or heist → wall reseals → new era.* Attack has a
  payday; defense has a comeback; nobody ever loses the war — they lose an
  afternoon's siege, which is the right amount of losing for a game you come
  back to tomorrow.
- Server-wide announcement at Core 50%: **"The Blue Core is exposed!"** — one
  shared moment that pulls the whole lobby to the same place.

### What replaces "winning" (status, not victory)
- **The front line** — a pure status readout, not a mechanic: the server
  computes the average x-position of the remaining rock (the wall's center
  of mass) and draws a marker. If Blue has been out-mining and out-pushing,
  the wall's mass sits shifted toward Red — the marker says "Blue is winning
  ground right now." Always live, never final.
- **Heist counter** — Cores cracked today / this week per team.
- **Personal legend** — persistent ladder stats that fit the fantasy: deepest
  dig, lifetime ore, Cores cracked, tunnel kills, Rift time held, biggest gem
  haul carried home alive.

---

## 4. Mining

- **Per-player mining budget** (~140 rock HP/s, total across all rocks):
  focused digging is fast; spray-clearing the wall with an octo is impossible
  *by construction*. Zero PvP impact.
- **Per-hit cap** (~20% of a rock's HP per bullet): no build one-shots rocks;
  every rock shows its crack stages.
- **Ore veins:** ~15% of cells contain visible ore. Tiers are simply how
  much the vein pays (one currency: gems), gated by depth:

  | Tier | Where | Pays | Extra |
  |---|---|---|---|
  | **Copper** | surface rock | ~5 gems | common, everywhere |
  | **Gem vein** | mid-depth | ~25 gems | the bread and butter |
  | **Core shard** | deep only | ~150 gems | glows through the rock from a distance; server ticker announces the find; ALSO a collectible material — top-tier purchases (Drill V, prestige cosmetics) cost gems *plus* shards |

  Ore respawns inside regrown rock, slightly richer in rock that regrew
  deep. The mountain is a renewable mine, and the best veins are always
  where it's most dangerous.

## 5. The economy — what gems are FOR

Gems are **not** tank upgrades (combat is capped at the top tier on purpose).
Gems are wealth, and wealth is a *behavior generator*: earned in danger,
carried in fear, spent on things that change how you play.

**The life of a gem: mined → carried (dangerous) → banked (safe) → spent.**

### Earning
| Source | Payout | Notes |
|---|---|---|
| Mining ore | small, steady | scales with ore tier / depth |
| Core heists | huge burst | split among attackers present |
| **Kills** | victim's carried gems | see §6 |
| Bounties | posted reward | see §6 |
| Holding the Rift | steady shower while held | see §7 — the fighter's "mining" |
| Robbing the Hauler | medium burst | see §7 |
| Events (blooms, deep boss) | medium burst | see §8 |

### Carrying (the tension mechanic)
Mined gems ride **on your tank** — a visible, growing satchel (others can see
roughly how rich you are). Die and you **drop 60%** of what you carry as
pickups; the rest is lost. A deep miner with a bulging satchel is the most
interesting object in the game: a target, an escort mission, and a gambling
problem all at once.

The run home must never be trivial, even on a compact map:
- **Gems are heavy:** carried value slows you, up to ~−20% speed at a fat
  load. Rich runners are visibly rich and visibly slower — escorts become
  necessary, pirates get a fair chase.
- **Satchel cap:** you can only carry so much before you must bank. Big
  sessions become multiple exposed trips, not one safe mega-haul.
- **The risk gradient IS the distance gradient:** copper is next to your
  base and worth little; shards are at dead center, farthest from both
  vaults. Easy cash-outs are small cash-outs by geometry.
- **Canyons are busy, not safe:** the fast routes home are the most-watched
  real estate on the map. The safe way home is digging a private exit — it
  costs time and budget, and it regrows behind you. Safety is purchasable,
  never free.

### Banking
Two places to cash out, one tradeoff:
- **Base Vault pad — 100%.** The long, dangerous walk home pays full value.
- **Forward outpost — 80%.** Field banking deep in the wall; a convenience
  fee for not hauling.

Banking is a **channel, not a touch**: standing on the pad drains the
satchel over a few seconds (~2s per large chunk) and damage interrupts it —
no drive-by deposits; the last seconds at the pad are part of the run.
Outpost channels are slower on top of the worse rate.

Banking converts carried gems into **banked gems** — safe forever — and a
cut automatically feeds team **War Effort** (§8). Banking runs the core
emotional loop: *one more vein, or run it home now?*

### The Shop
A physical **Shop pad** next to the Vault pad in your base. Drive onto it, a
menu opens, spend banked gems. Buying is only possible while standing in
your own base — gearing up is a trip home, and that matters. It sells the
three non-cosmetic categories below plus cosmetics.

### Spending (banked gems)
1. **Mining gear** — the long progression track, PvP-neutral by design:
   - **Drill tiers** (I–V): raise *your* mining budget and per-hit cap.
     Escalating prices; on death you drop one tier.
   - **Ore scanner:** see veins through rock in a radius around you.
   - **Gem magnet:** wider pickup radius (grab and run).
2. **Consumables** (bought at base, lost on death):
   - **Seismic charge** — instant 3×3 hole. Breach tool *and* combat tool
     (open a flank mid-fight, drop the wall out from under a trapper nest).
   - **Support strut** — one marked cell cannot regrow for 3 minutes. Holds
     a tunnel mouth open during a push.
   - **Decoy satchel** — drop a fake gem pile; it pings killers' greed.
3. **War Effort donations** — dump wealth into the team meter (§8); big
   donors get their name on the triggered event.
4. **Cosmetics** — the forever sink: nameplate badges, tank tints, trail
   effects, custom shatter colors for rocks *you* break, satchel skins.
   Pure status. Never gameplay.

## 6. Kills — what fighting pays

- **Loot:** victims drop 60% of carried gems. Hunting fat miners in tunnels
  is a profession ("tunnel piracy"); escorting your team's miners is the
  counter-profession.
- **Bounties:** a player who racks up kills or banks heavily accrues an
  automatic bounty (visible skull + amount). Killing them pays the bounty
  from the world, not their pocket — being hunted feels like fame, not
  punishment.
- **Ground held:** kills inside the wall tick War Effort for your team —
  fighters feed the siege meter too, not just miners.
- **Kill streaks = heat, not power:** streaks raise your bounty and put you
  on the ticker. No damage buffs — status instead of snowballing.

## 7. The combat layer — where the fights come from

Mining makes the money; these systems make the *war*. Each one is a fight
generator: a place or moment where combat is the whole point.

### The Rift (king of the hill, always on)
Dead center of the wall, equidistant from both bases, sits a permanent
cavern that regrowth can never fully seal — the **Rift**. Standing in it
showers your team with a steady trickle of gems and War Effort; every ~8
minutes it **erupts**, multiplying the payout for a minute (announced
server-wide). It is deliberately too rich to ignore and too central to hold
safely. This is the fighter's "mining": you farm it with a gun, and there is
*always* a fight to walk into at the middle of the map.

### Forward outposts (capturable territory)
Any team can capture a cleared pocket inside the wall by holding a dropped
**banner beacon** for 30 seconds. An outpost provides:
- **Forward respawn** for its team (this is the action-pacing engine — dying
  at the front puts you back at the front, not at base; fights *sustain*
  instead of fizzling)
- **Field banking** at a worse rate (80%) — miners can cash out deep
- A small no-regrow radius that keeps its chamber open

Outposts are killable (shoot the beacon) and squeezed by geology — the wall
constantly tries to grow over their approaches. Expect the entire mid-game
meta to be fights over outpost chains. Cap per team (2–3) so the front stays
focused.

### The Hauler (a moving objective)
Every ~10 minutes a neutral armored **gem hauler** NPC spawns at one edge of
the wall and slowly tunnels its own winding path to the other, carrying a fat
cargo. Crack it open and the cargo spills for whoever's standing there. Both
teams get the same ping. It's a moving, neutral, timed fight — a brawl that
travels through everyone's tunnels and drags spectators in as it passes.

### Rock is a weapon
- **Crush:** when a cell finishes regrowing, anything standing in it takes
  heavy damage and gets shoved out. Baiting an enemy into a resealing tunnel
  is a legitimate kill.
- **Seismic charges in combat:** collapse a flank open, drop a wall between
  you and a chaser, breach directly into a fight's rear.
- **Reinforce as a trap:** trigger the team regrowth surge while enemies are
  deep in *your* tunnels and watch the exits seal.

### The War Horn (scheduled aggression)
Every ~20 minutes the horn sounds for 3 minutes: kills pay double War Effort
and double bounty everywhere. It's a server-wide "fight now" bell that
synchronizes both teams' aggression into a shared brawl window — and gives
lone-wolf fighters a recurring reason to go hunting.

### Tunnel combat (free content)
The existing arras roster changes meaning underground: rangers dominate
straight galleries, smashers rule tight bends, trappers seal breaches,
directors flood corridors. Balance emerges from *geometry players dig* —
every era plays differently at zero new-content cost. Persistent tunnels give
the lobby known geography ("the north gallery", "that cursed mid-wall choke")
that regulars learn — until the wall slowly digests it.

## 8. War Effort — the team layer

A shared meter fed by banking cuts, donations, tunnel kills, and Rift
control. Spent on **siege verbs** (auto-triggered at thresholds or
majority-voted):

- **Reinforce** — your side's rock regrows 2× faster for 2 minutes (defense
  *and* trap, per §7).
- **Seismic surge** — a team-sized breach: instantly clears a tunnel-width
  seam several cells deep at a chosen point on the front.
- **Overclock** — whole team's mining budget +50% for 60s (the "gold rush"
  horn).

A stockpiled War Effort bar is a raid announcement in itself — scouts learn
to read the enemy's meter like a weather forecast.

## 9. Keeping forever fresh (the 3am problem)

Infinite servers die of quiet hours. Cheap, event-driven drama built on
existing tech:

- **Ore blooms** — a wall region temporarily sprouts rich veins under a
  visible golden glow. Draws everyone to one spot → fights happen.
- **Earthquakes** — rarely, a jagged seam of cells across the wall dies at
  once (chained shatter effect). Free new geography; can reopen old tunnels.
- **The deep boss** — occasionally a rock-armored miniboss spawns inside the
  wall's center and digs its own tunnels toward a base. The wall itself
  attacks. Core-tier payout for the kill.
- **Announcement ticker** — "★ WarriorX unearthed a Core Shard!", "The Red
  Core is exposed!", "Bounty claimed: 4,200 gems." Envy is a retention
  mechanic.

## 10. Feel checklist (the invisible 50% of "good")

- **Sound** — the single biggest missing piece. Crack pitch rises as a rock
  nears death; bass crunch on break; gem chime on pickup; satchel jingle that
  gets heavier as you get richer (audible to nearby enemies… delicious).
- Last-hit celebration — built ✓ (hit-stop, chip burst, shake).
- Ore glint animation so veins read at a glance.
- Scoreboard shows mining stats beside combat stats (ore banked, deepest dig,
  Rift time, Cores cracked) — every playstyle gets a number to be proud of.

---

## 11. Build order (every phase ships into the live world)

| Phase | Contents | Why this order |
|---|---|---|
| **1. Feel-complete mining** | sound; mining budget + per-hit cap | days of work; the loop must feel right before it pays |
| **2. Ore, gems & carrying** | veins, tiers, depth scaling, satchel, drop-on-death, Vault-pad banking | digging gets a *why*; kills get loot for free |
| **3. The living wall** | regrowth, crush damage, depth hardness, rubber-band geology | the world becomes eternal; rock becomes a weapon |
| **4. The battlegrounds** | the Rift, forward outposts (respawn + field bank), the Hauler | the action layer — fights now have addresses |
| **5. Cores & heists** | the siege rhythm, exposure announcements, fast reseal | the war gets a heartbeat |
| **6. Economy depth** | drill tiers, scanner/magnet, consumables, bounties, War Horn, War Effort verbs | the long game arrives |
| **7. Eras & events** | ore blooms, earthquakes, deep boss, front-line indicator, ticker, cosmetics | the world gets moods and status |

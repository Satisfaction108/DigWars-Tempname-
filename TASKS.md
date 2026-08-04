# DIG WARS — Build Tasks (start to finish)

Companion to [DESIGN.md](DESIGN.md). Do them in order; every phase ends with
the game live and better. Check them off as they land.

## Phase 1 — Feel-complete mining
1. [x] **Mining budget (server):** per-player budget of ONE rock's HP per
   second (hard cutoff — overflow damage discarded, bullets still die on
   the face), clamped in the projectile→rock path in `server/game/index.js`
2. [ ] ~~Per-hit cap~~ — skipped by decision
3. [x] **Client audio manager:** `public/client/sound.js` — synthesized Web
   Audio (no asset files), distance attenuation + stereo pan, per-sound
   throttling, busy-ducking, master compressor; `gameSound.setVolume(0..1)`
4. [x] **Game sounds wired:** rock crack pitch rises per damage stage
   (terrainRenderer TR events), warm crunch + rubble on rock break, soft
   shot pops on every gun fire in view (socketinit), size-based pop for
   every entity death in view (app.js)
5. [ ] **Tuning pass:** playtest rock HP / budget / sound levels with 2+
   players

## Phase 2 — Ore, gems & carrying
6. [x] **Ore seeding (server):** deterministic per-cell ore tier by depth
   (copper / azurite / core shard, ~15% of cells), included in the `TG`
   snapshot and `TR` events; ore rocks carry more HP (×1.5/×2.2/×3);
   discrete crystal DEPOSITS per cell (mirrored layout, server+client)
7. [x] **Ore rendering (client):** gem-cut crystal markings, one per
   deposit; per-tier crack colors; shard aura glows through the rock;
   slow quiet glints
8. [x] **Gem drops:** breaking an ore rock spawns one gem pickup per
   visible deposit at its exact spot/size (copper 40 / azurite 90 /
   shard 400+100s); faceted gem-cut pickups; gems collide with rock,
   never overlap each other
9. [x] **Satchel (server + client):** carried-gem total per player; visible
   peach money-bag that grows; speed penalty scaling to ~−20% at full load
10. [x] **Satchel cap (1600)** + full-satchel warning; a full satchel
    repels loose gems
11. [x] **Drop-on-death:** dying drops 60% of carried gems as pickups, rest
    destroyed
12. [x] **Vault pad:** vault door in each base (procedural art, animated);
    player picks the exact gem-dust amount, channel deposits at 300/s,
    damage interrupts; banked balance per session (socket-persistent)
13. [x] **HUD:** carried / banked readout under the leaderboard (slides
    with entries, carried blinks red at cap), +N gem popups, pickup chime,
    deposit tick/complete sounds
14. [x] **Core-shard ticker:** landed as the EMERALD ticker instead — shards
    are too common to announce, so the server-wide broadcast fires for the
    rare emerald tier ("X has destroyed an emerald shard!")

## Meta / pre-release
- [ ] **Name + logo:** decide the final game name (keep or replace "Dig
    Wars") and design a logo for the landing page and browser tab
- [ ] **Mining damage stat (later on):** a new skill-bar stat that scales
    rock-mining power, replacing/augmenting the bullet-stat skillFactor
- [ ] **On-tank wealth visual (post-skins):** re-decide how carried wealth
    shows on the tank once skins exist (bag/ring/jewel all rejected; the
    hidden Hoard prop still broadcasts load for whatever design wins)
- [ ] **Tank skins system**

## Phase 3 — The living wall
15. [ ] **Regrowth (server):** destroyed cells regrow after ~45s only if
    adjacent to living rock; broadcast regrow events over `TR`; update
    colliders + silhouette. DECIDED: regrown cells RE-ROLL their ore (the
    arena never runs dry), and mined emeralds respawn at fresh
    deterministic deep spots so there are always ~3 in the wall
16. [ ] **Regrowth (client):** regrowing-cell render state (fade back in),
    silhouette rebuild on regrow
17. [ ] **Crush:** a cell that finishes regrowing damages and shoves
    anything standing in it
18. [ ] **Depth hardness:** rock max HP scales 1×→3× by distance from the
    original wall face
19. [ ] **Ore respawn:** regrown cells re-roll ore, slightly richer when deep
20. [ ] **Front line:** server computes wall center-of-mass; client HUD
    marker; rubber-band regrowth (loser's side regrows faster)

## Phase 4 — The battlegrounds
21. [ ] **Map rework:** widen room (~18×15 tiles) for open staging strips in
    front of each rock face; pre-carve two winding canyons base-to-base in
    `mapGen.js`
22. [ ] **Canyon regrowth rules:** ~4× slower inside canyons; centerline can
    never fully seal
23. [ ] **The Rift:** permanent unsealable cavern at map center; standing in
    it trickles gems + War Effort; eruption every ~8 min with server-wide
    announcement and multiplied payout
24. [ ] **Forward outposts:** placeable banner beacon, 30s capture,
    forward respawn for the owning team, field banking at 80% (slower
    channel), small no-regrow radius, beacon killable, cap 2–3 per team
25. [ ] **The Hauler:** neutral NPC that digs a winding path across the
    wall every ~10 min carrying cargo; pinged to both teams; drops cargo
    when destroyed

## Phase 5 — Cores & heists
26. [x] **Core chambers:** map-gen sealed pockets in the deep rock on each
    side, same row as the Deep Core Outpost, 2–3 lattice cells in from each
    rock face; destroyable team-colored octagon boulder (18k HP, bullet-only
    damage) packed with 4000 dust of unsuckable gems that spin/drift inside;
    out-of-combat self-repair after 60s
27. [x] **Heist logic:** Core exposure announcement at 50%; on death the
    chamber shatters (announced) and erupts its gems - they flee the owner
    team and home toward attackers, then despawn if unclaimed; the pocket
    stays empty ~20s, then a sliver regrows over ~5 min as the gems return
    in waves (reform announced at completion); deflected bullets and
    invulnerability during regrow
28. [ ] **Base protection audit:** confirm enemy-base lethality plays fair
    with tunnels dug near base edges and outpost respawns

## Phase 6 — Economy depth
29. [ ] **Shop pad + UI:** pad next to the Vault pad; menu while standing on
    it; purchases only in own base
30. [ ] **Drill tiers I–V:** personal mining budget / per-hit cap upgrades;
    escalating gem prices; top tier also costs shards; drop one tier on
    death
31. [ ] **Ore scanner & gem magnet:** see veins through rock in a radius;
    wider pickup radius
32. [ ] **Consumables:** seismic charge (instant 3×3 hole), support strut
    (cell can't regrow for 3 min), decoy satchel
33. [ ] **Bounties:** auto-bounty from kill streaks / heavy banking; visible
    skull + amount; paid by the world on claim
34. [ ] **War Effort:** team meter fed by banking cut, donations, tunnel
    kills, Rift control; verbs — Reinforce (2× regrowth 2 min), Seismic
    surge (team breach), Overclock (+50% team mining 60s); enemy meter
    visible
35. [ ] **War Horn:** every ~20 min, 3 min of double bounty + double War
    Effort from kills, announced server-wide

## Phase 7 — Eras, events & status
36. [ ] **Ore blooms:** temporary rich-vein region with a visible glow
37. [ ] **Earthquakes:** rare chained-shatter seam across the wall
38. [ ] **Deep boss:** rock-armored miniboss that digs toward a base;
    Core-tier payout
39. [ ] **Scoreboard & ladder:** mining stats beside combat stats (ore
    banked, deepest dig, Rift time, Cores cracked, biggest haul)
40. [ ] **Cosmetics:** shop tab — tank tints, trails, custom shatter colors,
    satchel skins, nameplate badges
41. [ ] **Full balance pass:** economy prices, budgets, regrowth rates,
    event timers — one week of live tuning

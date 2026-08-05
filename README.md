# Dig Wars

Dig Wars is a 2 team tank battle game where the whole map is a giant rock that never stops growing back. Your team starts on one side, the enemy starts on the other, and the rock in the middle is the battlefield.

You mine through the rock to collect gems, carry them back to your base vault to bank them, and fight the other team for control of the tunnels. The deeper you dig, the better the ore. The bigger your bank, the closer your team gets to winning.

The wall heals itself over time. Every hole you dig will slowly close back up, so a tunnel someone carved last round might be gone by now. Players spawn at level 45 with a fast path to the top tanks, so the real progress in a match comes from the economy, not your stats.

Two kinds of players both have a good time here. Miners dig, find ore, and race home with a full satchel. Fighters chase the miners, raid the enemy tunnels, and protect the vaults. Every system in the game feeds one of those jobs and makes the other harder.

## Files

- index.js - the server entry point
- public/client/app.js - the whole game renderer and HUD
- public/client/global.js - shared client state and settings
- public/client/socketinit.js - client to server networking
- public/client/terrainRenderer.js - draws the mineable rock wall
- public/index.html - the landing page and game canvas
- public/home.css - landing page styling
- public/main.css - in game styling
- server/server.js - starts the game server
- server/game/index.js - the main game loop and all entity logic
- server/game/terrain/ - the rock grid, mining, vaults, outposts and core chambers
- server/game/gamemodes/ - every gamemode config and script
- server/lib/definitions/ - all tank, bullet, boss and prop definitions
- server/config.js - server settings and gamemode selection
- DESIGN.md - the full design doc for the game
- TASKS.md - the build task list
- plan.md - the original planning doc
- credits.md - who worked on what
- diary.md - dev notes
- devlog.md - competition devlog

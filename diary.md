# Project Diary

06/09/26

## Arms Race & Server Setup

- Found all Arms Race tanks in `server/lib/definitions/entityAddons/armsRace/tanks.js`
- Added Arms Race as a selectable gamemode in the server selector 
- Added a new Arms Race FFA server on port 3004 (ID: `ar`) in `server/config.js`
- Set Arms Race level cap to 75 so higher-tier upgrades are reachable
- Removed an early `return` in `tanks.js` that was blocking higher-tier tank definitions from loading
- Fixed level cap logic so tiers unlock correctly (`<` instead of `<=`)
- [AI] Replaced `tanks.js` with the fuller version from upstream `unstable` branch (~200 more tank definitions)
- Fixed typo: `autoHybridMarksmaj_AR` → `autoHybridMarksman_AR` (was crashing the server on startup)
- Set `increased_level_cap = true` in Arms Race tank definitions

## Removed Retrograde Gamemode

- [AI] Deleted Retrograde completely (didn't know what it was / didn't want it)
- [AI] Removed Retrograde FFA server from `server/config.js`
- [AI] Deleted `server/game/gamemodes/config/retrograde.js`
- [AI] Removed all Retrograde references from tank definitions, presets, bosses, dev menu, and `game.js`

## Homepage UI Redesign

- Completely refactored `index.html` homepage with a mbetter look
- [AI] Made 2 themes: **Dark** (neon) and **Light** (pastel) using CSS variables in `home.css`
- [AI] Replaced old Arras green styling with simple, clean colors (no gradients)
- Made buttons sleeker with no heavy effects
- Refactored the main container — adjusted size, text, and layout to look more modern
- Replaced the "Source Code" button with a **Theme** toggle button (top-right corner, separate from settings)
- Theme button only affects the homepage and settings - not ingame visuals
- [AI] Added a snowfall background effect on the homepage (`home.js` canvas animation)
- Replaced the old "view options" button with a top-left triangle settings button (like ingame)
- Moved name and token input fields down, closer to the Play button
- Gave the gamemode dropdown more space (increased height to 140px)
- Centered bulletin/patch notes content
- Replaced Discord members widget with a sleek **Credits** panel:
  - Zyrox — Discord: `fire_warriorx` — Role: Developer
  - Shrew — Discord: `aimbot_user` — Role: Developer
- Added a placeholder logo (`A` text) instead of the old round image
- Set **light mode as the default** theme instead of dark

## New Settings Panel (Homepage)

- Switched from old "view options" slide-out to a new floating settings panel with rounded corners
- Settings panel has 3 tabs: **Options**, **Theme**, **Keybinds**
- Options tab mirrors ingame settings (checkboxes, dropdowns, etc.)
- Theme tab lets you pick between Dark and Light themes
- Keybinds tab replaced the old "coming soon" page with a real, usable keybind editor
- Keybinds are in a clean 2-column grid with boxes around each bind
- Keybinds are ordered logically: W, A, S, D, then the rest (not random order)
- Hidden compatibility elements kept in `index.html` so existing `app.js` logic still works
- `home.js` delegates keybind clicks to the hidden controls table and syncs labels back

## Server Gamemode Filter Tabs

- Updated filter tabs to: **All**, **Normal**, **Growth**, **Arms Race**, **Other** (minigames), **Sandbox**
- Normal = servers without Growth or Arms Race
- Updated filter logic in `serverSelectorHandler.js`

## Ingame Settings Updates

- Added **Theme** tab to ingame settings (canvas-drawn in `app.js` / `canvas.js`)
- Added **Keybinds** tab to ingame settings with 2-column layout (mirrors homepage)
- Homepage settings and ingame settings share the same Options / Theme / Keybinds structure
- Removed the extra homepage-style settings/theme buttons from ingame (kept only the original green arrow button)

## Bug Fixes

- Resolved merge conflicts after pulling Shrew's changes (integrated `maze` gamemode, fixed `lb` server)
- Fixed inability to join game after UI redesign (hidden compat elements for `app.js`)
- Fixed homepage settings panel not showing content (layout/overflow issues)
- Fixed dropdowns and buttons being cut off in settings (overrode `main.css` select height)
- Optimized homepage lag: reduced snowfall particles, removed expensive CSS effects (backdrop-filter)

## Files Created / Modified

- **Created:** `public/home.css`, `public/client/home.js`, `diary.md`
- **Modified:** `public/index.html`, `public/client/app.js`, `public/client/canvas.js`, `public/client/serverSelectorHandler.js`, `server/config.js`, `server/game.js`, `server/game/gamemodes/config/arms_race.js`, `server/lib/definitions/entityAddons/armsRace/tanks.js`, `server/lib/definitions/groups/tanks.js`, `server/lib/definitions/presets.js`, boss definition files, `server/lib/definitions/entityAddons/arrasMenu/dev.js`
- **Deleted:** `server/game/gamemodes/config/retrograde.js`

import { global } from "./global.js";
import { gui } from "./socketinit.js";

// ── Intergliouette: Dig Wars interactive tutorial ──────────────────────
// A guided, play-while-you-read walkthrough. Autodetects the action the
// player is being taught (fire, mine, bank, ping…) and advances on its
// own, but every step also has a Next button so nobody is ever forced.
// Persists via localStorage so it only plays once per browser.

const STORAGE_KEY = "digwarsTutorialDone";

const DEFAULTS = {
    KEY_UP: "W", KEY_DOWN: "S", KEY_LEFT: "A", KEY_RIGHT: "D",
    KEY_AUTO_FIRE: "E", KEY_AUTO_SPIN: "C",
    KEY_AUTO_ALT: "G", KEY_TOGGLE_MAP: "F",
    KEY_CHOOSE_1: "Y", KEY_CHOOSE_2: "U", KEY_CHOOSE_3: "I",
    KEY_CHOOSE_4: "H", KEY_CHOOSE_5: "J", KEY_CHOOSE_6: "K",
    KEY_UPGRADE_ATK: "1", KEY_UPGRADE_HTL: "2", KEY_UPGRADE_SPD: "3",
    KEY_UPGRADE_STR: "4", KEY_UPGRADE_PEN: "5", KEY_UPGRADE_DAM: "6",
    KEY_UPGRADE_RLD: "7", KEY_UPGRADE_MOB: "8", KEY_UPGRADE_RGN: "9",
    KEY_UPGRADE_SHI: "0",
};

const FIRE_KEY = 32; // space (left mouse has no keycode)

let keyLabelCache = null;
function keyLabels() {
    if (keyLabelCache) return keyLabelCache;
    keyLabelCache = {};
    let kb = {};
    try {
        const raw = localStorage.getItem("keybinds");
        if (raw && raw.startsWith("{")) kb = JSON.parse(raw) || {};
    } catch (e) { }
    for (const id of Object.keys(DEFAULTS)) {
        if (kb[id] && kb[id][0]) keyLabelCache[id] = kb[id][0];
        else keyLabelCache[id] = DEFAULTS[id];
    }
    return keyLabelCache;
}

function lbl(id) {
    return keyLabels()[id] || DEFAULTS[id] || id;
}

function fillBody(text) {
    return text.replace(/\{\{KEY_([A-Z0-9_]+)\}\}/g, (m, id) => {
        const k = lbl("KEY_" + id);
        return `<span class="dwTutKey">${k}</span>`;
    });
}

// ── building blocks for the step definitions ───────────────────────────
const state = {
    running: false,
    visible: false,
    step: 0,
    glide: 1,
    glowT: 0,
    spawnX: 0,
    spawnY: 0,
    lastCarried: 0,
    lastUpgrades: 0,
    lastPoints: 0,
    lastPings: 0,
    lastRocks: 0,
    buttonPulse: 0,
};

function waitMove() {
    const dx = global.player.cx.animX - state.spawnX;
    const dy = global.player.cy.animY - state.spawnY;
    return Math.hypot(dx, dy) > 40;
}

function waitShoot() { return state.fireSeen; }

function waitSpin() { return state.spinSeen; }
function waitAutofire() { return state.autofireSeen; }

function waitGems() { return global.gems.carried > 0; }

function waitUpgrade() {
    return (gui.upgrades || []).length > state.lastUpgrades ||
           gui.points < state.lastPoints;
}

function waitVault() { return !!global.vault.onPad; }

function waitPing() { return global.enemyPings.length > state.lastPings; }

function waitMap() { return !!global.showBigMap; }

function waitRocks() { return (window.dwRocksBroken || 0) > state.lastRocks; }

// fired from socketinit when a rock is destroyed
window.dwTutorialRock = () => { window.dwRocksBroken = (window.dwRocksBroken || 0) + 1; };

// ── the steps ──────────────────────────────────────────────────────────
const steps = [
    {
        title: "Welcome to Dig Wars",
        body: "You're a tank on a living rock map. Two teams fight to mine gems and bank them before the enemy does. Let's learn how to play — this is fully interactive, so just do what you're told and the tutorial advances on its own. (Or hit Next to skip a step.)",
        target: null,
        detect: () => true,
        autoNext: false,
    },
    {
        title: "Move around",
        body: "Press {{KEY_UP}} {{KEY_DOWN}} {{KEY_LEFT}} {{KEY_RIGHT}} (or the arrow keys) to move your tank. Try drifting through the rocks to get a feel for the controls.",
        target: null,
        detect: waitMove,
        autoNext: true,
    },
    {
        title: "Aim & shoot",
        body: "Your tank aims at your cursor. Hold the the mouse's left button — or press and hold {{KEY_MOUSE_0_SP}} — to fire a stream of bullets at whatever's in front of you.",
        target: null,
        detect: waitShoot,
        autoNext: true,
    },
    {
        title: "Auto-fire & auto-spin",
        body: "Don't want to hold the button all game? Press {{KEY_AUTO_FIRE}} to toggle auto-fire (your tank shoots on its own), and {{KEY_AUTO_SPIN}} to make your guns spin around.",
        target: null,
        detect: () => waitAutofire() || waitSpin(),
        autoNext: true,
    },
    {
        title: "Destroy rocks",
        body: "Shoot the grey rock around you to break it apart. Mining rock is how you expose the shiny gem ore buried underneath — and it clears the way to move around the map.",
        target: null,
        detect: waitRocks,
        autoNext: true,
    },
    {
        title: "Collect gems",
        body: "Gems drop from broken ore and from defeated enemies. Drive over them to pick them up — they're stored in your satchel on the spot. Watch your carried count tick up!",
        target: null,
        detect: waitGems,
        autoNext: true,
    },
    {
        title: "Level up your tank",
        body: "When tanks are destroyed you gain upgrade choices. Pick a tank upgrade from the bar at the bottom and spend stat points with keys {{KEY_UPGRADE_ATK}}–{{KEY_UPGRADE_SHI}} to get stronger.",
        target: "upgrades",
        detect: waitUpgrade,
        autoNext: true,
    },
    {
        title: "Bank your gems",
        body: "Carrying gems makes you a target. Find your team's Vault and park on it to cash out — your gems are then safe and count toward your team's score. Don't hold them forever!",
        target: "vault",
        detect: waitVault,
        autoNext: true,
    },
    {
        title: "Mark enemies",
        body: "Spot an enemy sneaking up? Press {{KEY_AUTO_ALT}} to drop a danger marker at your cursor for your whole team to see. Use it to point out threats on the map.",
        target: null,
        detect: waitPing,
        autoNext: true,
    },
    {
        title: "Check the map",
        body: "Press {{KEY_TOGGLE_MAP}} to open the full map (or glance at the minimap in the corner). It shows the battlefield, the vaults, and where your team is.",
        target: "minimap",
        detect: waitMap,
        autoNext: true,
    },
    {
        title: "That's it! Have fun playing!",
        body: "You now know the basics: move, shoot, mine, bank, and mark. Head out there, dig deep, and out-bank the enemy team. Good luck, miner!",
        target: null,
        detect: () => true,
        autoNext: false,
        final: true,
    },
];

// ── DOM scaffold ───────────────────────────────────────────────────────
let root = null, bodyEl = null, titleEl = null, dotsEl = null,
    nextBtn = null, skipBtn = null, spotlight = null, dim = null;

function ensureRoot() {
    if (root) return;
    dim = document.createElement("div");
    dim.id = "dwTutDim";

    spotlight = document.createElement("div");
    spotlight.id = "dwTutSpotlight";

    root = document.createElement("div");
    root.id = "dwTutorial";

    titleEl = document.createElement("div");
    titleEl.className = "dwTutTitle";
    bodyEl = document.createElement("div");
    bodyEl.className = "dwTutBody";

    dotsEl = document.createElement("div");
    dotsEl.className = "dwTutDots";

    const btnWrap = document.createElement("div");
    btnWrap.className = "dwTutBtns";

    skipBtn = document.createElement("button");
    skipBtn.className = "dwTutBtn dwTutSkip";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", onSkip);

    nextBtn = document.createElement("button");
    nextBtn.className = "dwTutBtn dwTutNext";
    nextBtn.textContent = "Next";
    nextBtn.addEventListener("click", onNext);

    btnWrap.appendChild(skipBtn);
    btnWrap.appendChild(nextBtn);

    root.appendChild(titleEl);
    root.appendChild(bodyEl);
    root.appendChild(btnWrap);
    root.appendChild(dotsEl);

    document.body.appendChild(dim);
    document.body.appendChild(spotlight);
    document.body.appendChild(root);
}

function renderStep() {
    const s = steps[state.step];
    if (!s) return;
    titleEl.textContent = s.title;
    bodyEl.innerHTML = fillBody(s.body);

    nextBtn.textContent = s.final ? "Play!" : "Next";
    skipBtn.style.display = s.final ? "none" : "";

    dotsEl.textContent = "";
    for (let i = 0; i < steps.length; i++) {
        const d = document.createElement("span");
        d.className = "dwTutDot" + (i === state.step ? " active" : "") + (i < state.step ? " done" : "");
        dotsEl.appendChild(d);
    }
    positionSpotlight(s.target);
}

// spotlight targets, in viewport px (computed fresh each time)
function spotlightRect(target) {
    const W = window.innerWidth, H = window.innerHeight;
    switch (target) {
        case "vault":
            return { x: W / 2 - 175, y: H - 320, w: 350, h: 150 };
        case "minimap": {
            const len = Math.min(210, W / 4);
            return { x: W - len - 24, y: 20, w: len, h: len };
        }
        case "upgrades":
            return { x: W / 2 - 200, y: H - 185, w: 400, h: 90 };
        default:
            return null;
    }
}

function positionSpotlight(target) {
    const r = spotlightRect(target);
    if (!r) {
        spotlight.style.opacity = "0";
        spotlight.style.transform = "scale(0.8)";
        return;
    }
    spotlight.style.opacity = "1";
    spotlight.style.left = r.x + "px";
    spotlight.style.top = r.y + "px";
    spotlight.style.width = r.w + "px";
    spotlight.style.height = r.h + "px";
}

// ── input listeners for the "do it yourself" steps ─────────────────────
function onKeyDown(e) {
    if (!state.running) return;
    const kc = e.keyCode;
    if (kc === global["KEY_AUTO_FIRE"]) state.autofireSeen = true;
    if (kc === global["KEY_AUTO_SPIN"]) state.spinSeen = true;
    if (kc === FIRE_KEY) state.fireSeen = true;
    // enemy ping is sent on keyup of KEY_AUTO_ALT; we detect via pings
    // array anyway, but also light it up on press for responsiveness
    if (kc === global["KEY_AUTO_ALT"]) state.pingPressed = true;
}
function onMouseDown(e) {
    if (!state.running) return;
    if (e.button === 0) state.fireSeen = true;
}

function onNext() {
    advance();
}
function onSkip() {
    finish();
}

function advance() {
    if (!state.running) return;
    if (state.step >= steps.length - 1) { finish(); return; }
    state.step++;
    snapshot();
    renderStep();
    pulse();
}

function snapshot() {
    state.spawnX = global.player.cx.animX;
    state.spawnY = global.player.cy.animY;
    state.lastCarried = global.gems.carried;
    state.lastUpgrades = (gui.upgrades || []).length;
    state.lastPoints = gui.points;
    state.lastPings = global.enemyPings.length;
    state.lastRocks = window.dwRocksBroken || 0;
    state.fireSeen = false;
    state.spinSeen = false;
    state.autofireSeen = false;
    state.pingPressed = false;
}

function pulse() {
    state.buttonPulse = 1;
    nextBtn.classList.remove("dwTutPulse");
    void nextBtn.offsetWidth;
    nextBtn.classList.add("dwTutPulse");
}

function finish() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) { }
    hide();
}

function open() {
    ensureRoot();
    state.running = true;
    state.step = 0;
    snapshot();
    renderStep();
    show();
}

function show() {
    state.visible = true;
    requestAnimationFrame(() => {
        root.classList.add("show");
        dim.classList.add("show");
        spotlight.classList.add("show");
    });
}

function hide() {
    state.visible = false;
    state.running = false;
    root.classList.remove("show");
    dim.classList.remove("show");
    spotlight.classList.remove("show");
}

export function isComplete() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
}

export function startTutorial() {
    if (isComplete()) return;
    open();
}

export function replayTutorial() {
    open();
}

// autostart when the very first spawn happens
let startedOnce = false;
export function hook() {
    if (startedOnce) return;
    if (global.gameStart && !global.died && !isComplete()) {
        startedOnce = true;
        open();
    }
}

// per-frame: autodetect to advance the current step
function tick() {
    requestAnimationFrame(tick);
    if (!state.running || !state.visible) return;
    const s = steps[state.step];
    if (s && s.autoNext && s.detect && s.detect()) {
        // small delay so the player sees their action register
        if (!s._waitT) s._waitT = performance.now() + 350;
        else if (performance.now() > s._waitT) {
            s._waitT = 0;
            advance();
        }
    }
}
tick();

// wire listeners once
document.addEventListener("keydown", onKeyDown);
document.addEventListener("mousedown", onMouseDown);
import { global } from "./global.js";
import { util } from "./util.js";
import { gui } from "./socketinit.js";

// ── Dig Wars interactive tutorial ──────────────────────────────────────
// A guided, do-it-yourself walkthrough. Prompts float above your tank or
// box the relevant UI, and auto-advance the moment you actually DO the
// thing being taught (move, shoot, mine, upgrade, bank, ping, map…). Every
// step also has a Next button so nobody is ever forced.
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

const SPACE_KEY = 32;

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
function lbl(id) { return keyLabels()[id] || DEFAULTS[id] || id; }

function fillBody(text) {
    return text.replace(/\{\{KEY_([A-Z0-9_]+)\}\}/g, (m, id) => {
        const k = lbl("KEY_" + id);
        return `<span class="dwTutKey">${k}</span>`;
    });
}

// ── state ──────────────────────────────────────────────────────────────
const state = {
    running: false,
    visible: false,
    step: 0,
    spawnX: 0, spawnY: 0,
    lastCarried: 0,
    lastPoints: 0,
    lastPings: 0,
    lastRocks: 0,
    lastGuiType: "",
    fireSeen: false,
    spinSeen: false,
    autofireSeen: false,
    moveSeen: false,
    _waitT: 0,
};

const ratio = () => util.getRatio();
const gw = () => global.gameWidth, gh = () => global.gameHeight;
const halfW = () => gw() / 2, halfH = () => gh() / 2;

function worldToScreen(wx, wy) {
    const px = global.player.renderx, py = global.player.rendery;
    const roomX = -px + global.screenWidth / 2 - ratio() * halfW();
    const roomY = -py + global.screenHeight / 2 - ratio() * halfH();
    return {
        x: roomX + (wx + halfW()) * ratio(),
        y: roomY + (wy + halfH()) * ratio(),
    };
}

function tr() { return window.terrainRenderer; }
function ctx2() { return window.dwCtx && window.dwCtx[1]; }

// the view rectangle in world coords (what's on screen)
function viewWorld() {
    const screenW = global.screenWidth, screenH = global.screenHeight;
    const r = ratio();
    const px = global.player.renderx, py = global.player.rendery;
    const vw = screenW / r, vh = screenH / r;
    return { px, py, vw, vh, left: px - vw / 2, right: px + vw / 2,
             top: py - vh / 2, bottom: py + vh / 2 };
}

function findRockInView() {
    const t = tr();
    if (!t || !t.ready) return null;
    const w = t._world;
    const v = viewWorld();
    let best = null, bestD = Infinity;
    for (const [k] of t._rockHealth) {
        if (t._rockDead.has(k)) continue;
        const cell = t._cellPolys.get(k);
        if (!cell) continue;
        const wx = cell.cx * w.s - halfW(), wy = cell.cy * w.s - halfH();
        if (wx < v.left - 40 || wx > v.right + 40 || wy < v.top - 40 || wy > v.bottom + 40) continue;
        const dx = wx - v.px, dy = wy - v.py;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { wx, wy }; }
    }
    return best;
}

function findOreInView() {
    const t = tr();
    if (!t || !t.ready) return null;
    const w = t._world;
    const v = viewWorld();
    let best = null, bestD = Infinity;
    for (const [k] of t._ore) {
        if (t._rockDead.has(k)) continue;
        const cell = t._cellPolys.get(k);
        if (!cell) continue;
        const wx = cell.cx * w.s - halfW(), wy = cell.cy * w.s - halfH();
        if (wx < v.left - 40 || wx > v.right + 40 || wy < v.top - 40 || wy > v.bottom + 40) continue;
        const dx = wx - v.px, dy = wy - v.py;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { wx, wy, tier: t._ore.get(k) }; }
    }
    return best;
}

function findVault() {
    if (!global.vaults.length) return null;
    let best = null, bestD = Infinity;
    for (const v of global.vaults) {
        const dx = v.x - global.player.renderx, dy = v.y - global.player.rendery;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
}

// ── detection ──────────────────────────────────────────────────────────
const detectMove = () => {
    const dx = global.player.cx.animX - state.spawnX;
    const dy = global.player.cy.animY - state.spawnY;
    return Math.hypot(dx, dy) > 50;
};
const detectShoot = () => state.fireSeen;
const detectSpin = () => state.spinSeen;
const detectAutofire = () => state.autofireSeen;
const detectRocks = () => (window.dwRocksBroken || 0) > state.lastRocks;
const detectGems = () => global.gems.carried > 0;
const detectUpgrade = () => gui.type !== state.lastGuiType;
const detectStats = () => gui.points < state.lastPoints;
const detectVault = () => !!global.vault.onPad;
const detectPing = () => global.enemyPings.length > state.lastPings;
const detectMap = () => !!global.showBigMap;

// ── the steps ──────────────────────────────────────────────────────────
const steps = [
    {
        title: "Welcome to Dig Wars",
        body: "Two teams fight to mine gems and bank them before the enemy does. Let's learn how to play — this is fully interactive, so just do what you're told and it advances on its own. (Or hit Next to skip.)",
        target: "none",
        detect: () => false,
        autoNext: false,
    },
    {
        title: "Move around",
        body: "Press {{KEY_UP}} {{KEY_DOWN}} {{KEY_LEFT}} {{KEY_RIGHT}} or the arrow keys to move your tank. Go ahead — drift through the rocks!",
        target: "tank",
        detect: detectMove,
        autoNext: true,
    },
    {
        title: "Aim & shoot",
        body: "Your tank aims at your cursor. Hold the mouse's left button (or hold SPACE) to fire.",
        target: "tank",
        detect: detectShoot,
        autoNext: true,
    },
    {
        title: "Auto-fire & auto-spin",
        body: "Press {{KEY_AUTO_FIRE}} to toggle auto-fire (tank shoots on its own), and {{KEY_AUTO_SPIN}} to spin your guns.",
        target: "tank",
        detect: () => detectAutofire() || detectSpin(),
        autoNext: true,
    },
    {
        title: "Destroy rocks",
        body: "Shoot the grey rock! Every rock in your view is flashing yellow — break one to expose the gem ore underneath.",
        target: "rocks",
        detect: detectRocks,
        autoNext: true,
    },
    {
        title: "Mine the gem ore",
        body: "See that glowing ore? Destroy its rock to release the gems, then drive over them to collect them into your satchel.",
        target: "ore",
        detect: detectGems,
        autoNext: true,
    },
    {
        title: "Level up your tank",
        body: "Destroying tanks earns you upgrade choices. Pick one from the bar at the bottom to evolve your tank.",
        target: "upgrades",
        detect: detectUpgrade,
        autoNext: false,
    },
    {
        title: "Upgrade your stats",
        body: "Now spend your stat points — press {{KEY_UPGRADE_ATK}}–{{KEY_UPGRADE_SHI}} or click the skill bars on the left to buff your tank.",
        target: "skills",
        detect: detectStats,
        autoNext: true,
    },
    {
        title: "Bank your gems",
        body: "Carrying gems makes you a target. Head to your team's Vault and park on the pad to cash out — the arrow points the way.",
        target: "vault",
        detect: detectVault,
        autoNext: true,
    },
    {
        title: "Mark enemies",
        body: "Spot an enemy? Press {{KEY_AUTO_ALT}} to drop a danger marker at your cursor for your whole team.",
        target: "tank",
        detect: detectPing,
        autoNext: true,
    },
    {
        title: "Check the map",
        body: "Press {{KEY_TOGGLE_MAP}} to open the full map, or glance at the minimap in the corner.",
        target: "minimap",
        detect: detectMap,
        autoNext: true,
    },
    {
        title: "That's it! Have fun playing!",
        body: "You now know how to move, shoot, mine, upgrade, bank, and mark. Head out there and out-bank the enemy team. Good luck, miner!",
        target: "none",
        detect: () => false,
        autoNext: false,
        final: true,
    },
];

// ── DOM scaffold ───────────────────────────────────────────────────────
let root = null, bodyEl = null, titleEl = null, dotsEl = null,
    nextBtn = null, skipBtn = null, dim = null;

function ensureRoot() {
    if (root) return;
    dim = document.createElement("div");
    dim.id = "dwTutDim";

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
}

// ── input ──────────────────────────────────────────────────────────────
function onKeyDown(e) {
    if (!state.running) return;
    const kc = e.keyCode;
    if (kc === global["KEY_AUTO_FIRE"]) state.autofireSeen = true;
    if (kc === global["KEY_AUTO_SPIN"]) state.spinSeen = true;
    if (kc === SPACE_KEY) state.fireSeen = true;
    if (kc === global["KEY_AUTO_ALT"]) state.pingPressed = true;
    const moves = [global["KEY_UP"], global["KEY_DOWN"], global["KEY_LEFT"],
                   global["KEY_RIGHT"], 38, 40, 37, 39];
    if (moves.includes(kc)) state.moveSeen = true;
}
function onMouseDown(e) {
    if (!state.running) return;
    if (e.button === 0) state.fireSeen = true;
}

function onNext() { advance(); }
function onSkip() { finish(); }

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
    state.lastPoints = gui.points;
    state.lastPings = global.enemyPings.length;
    state.lastRocks = window.dwRocksBroken || 0;
    state.lastGuiType = gui.type;
    state.fireSeen = false;
    state.spinSeen = false;
    state.autofireSeen = false;
    state.moveSeen = false;
    state._waitT = 0;
}

function pulse() {
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
    });
}
function hide() {
    state.visible = false;
    state.running = false;
    root.classList.remove("show");
    dim.classList.remove("show");
}

export function isComplete() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
}
export function startTutorial() { if (isComplete()) return; open(); }
export function replayTutorial() { open(); }

let startedOnce = false;
export function hook() {
    if (startedOnce) return;
    if (global.gameStart && !global.died && !isComplete()) {
        startedOnce = true;
        open();
    }
}

// ── per-frame render + auto-advance ────────────────────────────────────
function tick() {
    requestAnimationFrame(tick);
    if (!state.running || !state.visible) return;
    const s = steps[state.step];
    if (!s) return;

    if (s.autoNext && s.detect && s.detect()) {
        if (!state._waitT) state._waitT = performance.now() + 400;
        else if (performance.now() > state._waitT) { advance(); return; }
    } else {
        state._waitT = 0;
    }

    drawMarkers(s);
}

function uiBoxRect(target) {
    const W = global.screenWidth, H = global.screenHeight;
    switch (target) {
        case "upgrades": {
            // tank upgrade bar at the bottom
            if (!(gui.upgrades || []).length) return { x: W / 2 - 200, y: H - 150, w: 400, h: 120 };
            return { x: W / 2 - 220, y: H - 170, w: 440, h: 140 };
        }
        case "skills": {
            // skill bars on the left
            return { x: 12, y: 10, w: 210, h: H - 60 };
        }
        case "minimap": {
            const len = Math.min(210, W / 4);
            return { x: W - len - 24, y: 20, w: len, h: len };
        }
        case "vault": {
            return { x: W / 2 - 175, y: H - 320, w: 350, h: 150 };
        }
        default:
            return null;
    }
}

function drawUiBox(target) {
    const c = ctx2();
    const r = uiBoxRect(target);
    if (!r || !c) return;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    c.save();
    c.lineWidth = 3;
    c.strokeStyle = `rgba(255,215,94,${0.55 + 0.45 * pulse})`;
    c.lineJoin = "round";
    c.strokeRect(r.x, r.y, r.w, r.h);
    // soft outer glow
    c.lineWidth = 8;
    c.strokeStyle = `rgba(255,215,94,${0.12 + 0.1 * pulse})`;
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.restore();
}

function drawMarkers(s) {
    const c = ctx2();
    if (!c) return;
    const now = performance.now();

    // UI highlight boxes (screen-space)
    if (s.target === "upgrades" || s.target === "skills" ||
        s.target === "minimap" || s.target === "vault") {
        drawUiBox(s.target);
    }

    if (s.target === "rocks") {
        const t = tr();
        if (!t || !t.ready) return;
        const w = t._world;
        const v = viewWorld();
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        c.save();
        c.lineWidth = 3;
        c.strokeStyle = `rgba(255,215,94,${0.5 + 0.5 * pulse})`;
        let any = false;
        for (const [k] of t._rockHealth) {
            if (t._rockDead.has(k)) continue;
            const cell = t._cellPolys.get(k);
            if (!cell) continue;
            const wx = cell.cx * w.s - halfW(), wy = cell.cy * w.s - halfH();
            if (wx < v.left - 40 || wx > v.right + 40 || wy < v.top - 40 || wy > v.bottom + 40) continue;
            const sp = worldToScreen(wx, wy);
            c.beginPath();
            c.arc(sp.x, sp.y, 14 + 2 * Math.sin(now / 150 + k), 0, Math.PI * 2);
            c.stroke();
            any = true;
        }
        c.restore();
        return;
    }

    if (s.target === "ore") {
        const o = findOreInView();
        if (!o) { drawWorldArrow("Find some ore to mine!", "gold", { x: 0, y: 0 }); return; }
        const sp = worldToScreen(o.wx, o.wy);
        const pulse = 0.5 + 0.5 * Math.sin(now / 200);
        c.save();
        c.lineWidth = 3;
        c.strokeStyle = `rgba(120,255,200,${0.6 + 0.4 * pulse})`;
        c.beginPath();
        c.arc(sp.x, sp.y, 20 + 3 * Math.sin(now / 160), 0, Math.PI * 2);
        c.stroke();
        c.restore();
        return;
    }

    if (s.target === "vault") {
        const v = findVault();
        if (!v) { drawWorldArrow("Find the vault!", "gold", { x: 0, y: 0 }); return; }
        const sp = worldToScreen(v.x, v.y);
        const onScreen = sp.x > 0 && sp.x < global.screenWidth && sp.y > 0 && sp.y < global.screenHeight;
        if (onScreen) {
            const pulse = 0.5 + 0.5 * Math.sin(now / 250);
            c.save();
            c.lineWidth = 3;
            c.strokeStyle = `rgba(255,215,94,${0.6 + 0.4 * pulse})`;
            c.beginPath();
            c.arc(sp.x, sp.y, 22 + 3 * Math.sin(now / 180), 0, Math.PI * 2);
            c.stroke();
            c.restore();
        } else {
            drawWorldArrow("Vault →", "gold", { x: v.x, y: v.y });
        }
        return;
    }
}

// a screen-edge arrow pointing toward a world target
function drawWorldArrow(text, col, target) {
    const c = ctx2();
    if (!c || !target) return;
    const px = global.player.renderx, py = global.player.rendery;
    const sp = worldToScreen(target.x, target.y);
    const cx = global.screenWidth / 2, cy = global.screenHeight / 2;
    const dx = sp.x - cx, dy = sp.y - cy;
    const ang = Math.atan2(dy, dx);
    const margin = 46;
    const r = Math.min(cx, cy) - margin;
    const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    c.save();
    c.translate(ax, ay);
    c.rotate(ang);
    c.globalAlpha = 0.7 + 0.3 * pulse;
    c.fillStyle = col;
    c.strokeStyle = "#000";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(10, 0); c.lineTo(-6, -7); c.lineTo(-6, 7); c.closePath();
    c.fill(); c.stroke();
    c.restore();
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("mousedown", onMouseDown);
tick();
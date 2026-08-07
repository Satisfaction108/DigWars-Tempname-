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

// socketinit.js calls this whenever the server reports a rock was broken —
// wire it to a counter the tutorial's "destroy rocks" step can watch.
window.dwTutorialRock = () => { window.dwRocksBroken = (window.dwRocksBroken || 0) + 1; };

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
    spinSnapshot: false,
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
// dwCtx[0]=background, [1]=gameplay (world entities — rocks, tanks, ore),
// [2]=GUI (minimap, skill bars, upgrade bar). World-space markers must draw
// on the gameplay layer to sit with the entities they're pointing at; UI
// highlight boxes must draw on the GUI layer or the GUI panel they're meant
// to outline (drawn after, on top) paints right over them.
function ctx2() { return window.dwCtx && window.dwCtx[1]; }
function ctxGui() { return window.dwCtx && window.dwCtx[2]; }

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
const detectShoot = () => state.fireSeen ||
    (global.mobile && global.canvas && global.canvas.controlTouch !== null);
const detectSpin = () => state.spinSeen || global.autoSpin !== state.spinSnapshot;
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
        body: () => global.mobile
            ? "Drag the joystick on the <b>left</b> side of the screen to move your tank. Go ahead — drift through the rocks!"
            : "Press {{KEY_UP}} {{KEY_DOWN}} {{KEY_LEFT}} {{KEY_RIGHT}} or the arrow keys to move your tank. Go ahead — drift through the rocks!",
        target: "tank",
        detect: detectMove,
        autoNext: true,
    },
    {
        title: "Aim & shoot",
        body: () => global.mobile
            ? "Hold down on the <b>right</b> side of the screen to aim and fire — drag it around to aim, keep holding to keep shooting."
            : "Your tank aims at your cursor. Hold the mouse's left button (or hold SPACE) to fire.",
        target: "tank",
        detect: detectShoot,
        autoNext: true,
    },
    {
        title: "Auto-fire & auto-spin",
        body: () => global.mobile
            ? "Tap the <b>+</b> button to open the action menu, then tap <b>Autofire</b> (shoots on its own) or <b>Autospin</b> (spins your guns)."
            : "Press {{KEY_AUTO_FIRE}} to toggle auto-fire (tank shoots on its own), and {{KEY_AUTO_SPIN}} to spin your guns.",
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
        body: () => global.mobile
            ? "Destroying enemy tanks earns you upgrade choices. Tap one from the bar in the top-left to evolve your tank."
            : "Destroying tanks earns you upgrade choices. Pick one from the bar to evolve your tank.",
        target: "upgrades",
        detect: detectUpgrade,
        autoNext: false,
    },
    {
        title: "Upgrade your stats",
        body: () => global.mobile
            ? "Now spend your stat points — tap the skill bars along the top to buff your tank."
            : "Now spend your stat points — press {{KEY_UPGRADE_ATK}}–{{KEY_UPGRADE_SHI}} or click the skill bars on the left to buff your tank.",
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
        body: () => global.mobile
            ? "Enemy pings are a desktop-only feature for now — teammates on keyboard press {{KEY_AUTO_ALT}} to drop a danger marker for the team."
            : "Spot an enemy? Press {{KEY_AUTO_ALT}} to drop a danger marker at your cursor for your whole team.",
        target: "tank",
        detect: detectPing,
        autoNext: () => !global.mobile,
    },
    {
        title: "Check the map",
        body: () => global.mobile
            ? "Keep an eye on the minimap in the corner to track the action as you play."
            : "Press {{KEY_TOGGLE_MAP}} to open the full map, or glance at the minimap in the corner.",
        target: "minimap",
        detect: detectMap,
        autoNext: () => !global.mobile,
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
    bodyEl.innerHTML = fillBody(typeof s.body === "function" ? s.body() : s.body);
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
// Autofire has no client-observable on/off state (server-authoritative), on
// either platform — so unlike auto-spin (global.autoSpin) it can only be
// detected by catching the action that triggers it. On mobile that means
// watching for a tap that actually lands on the "Autofire" button, using the
// game's own hit-testing (mobileButtons index 3 — see canvas.js touchStart).
function onTouchStart(e) {
    if (!state.running || !global.mobile || !global.clickables) return;
    for (const touch of e.changedTouches) {
        const mpos = { x: touch.clientX * global.ratio, y: touch.clientY * global.ratio };
        if (global.clickables.mobileButtons.check(mpos) === 3) state.autofireSeen = true;
    }
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
    state.spinSnapshot = global.autoSpin;
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
// Called every frame from app.js, right after drawGUI() — this is the hook
// point that lets our overlay draw last (on top of the GUI layer) instead of
// racing our own independent requestAnimationFrame loop against the game's,
// which non-deterministically painted our highlight boxes UNDER that frame's
// GUI redraw and made them invisible.
export function hook() {
    render();
    if (startedOnce) return;
    if (global.gameStart && !global.died && !isComplete()) {
        startedOnce = true;
        open();
    }
}

function render() {
    if (!state.running || !state.visible) return;
    const s = steps[state.step];
    if (!s) return;
    drawMarkers(s);
}

// ── auto-advance (timing only — no drawing here, see render()) ─────────
function tick() {
    requestAnimationFrame(tick);
    if (!state.running || !state.visible) return;
    const s = steps[state.step];
    if (!s) return;

    const autoNext = typeof s.autoNext === "function" ? s.autoNext() : s.autoNext;
    if (autoNext && s.detect && s.detect()) {
        if (!state._waitT) state._waitT = performance.now() + 400;
        else if (performance.now() > state._waitT) { advance(); return; }
    } else {
        state._waitT = 0;
    }
}

// Bounding box around a set of live UI rects, padded a bit. Rects come from
// global.clickables' Region.rect(i) — the exact geometry the game itself
// just placed this frame, so this tracks desktop and mobile layouts (which
// put the skill bar and upgrade bar in very different places) automatically,
// instead of us duplicating each layout's position math and drifting out of
// sync whenever app.js's GUI layout changes.
function unionRect(rects) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const r of rects) {
        if (!r) continue;
        any = true;
        minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    if (!any) return null;
    const pad = 8;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function uiBoxRect(target) {
    const cl = global.clickables;
    switch (target) {
        case "upgrades": {
            // tank upgrade choice bar — same Region on desktop & mobile
            const n = (gui.upgrades || []).length;
            const rs = [];
            for (let i = 0; i < n; i++) rs.push(cl.upgrade.rect(i));
            return unionRect(rs);
        }
        case "skills": {
            // stat spend bars — bottom-left vertical stack on desktop,
            // top horizontal row on mobile; live rects cover both
            const rs = [];
            for (let i = 0; i < cl.stat.size(); i++) rs.push(cl.stat.rect(i));
            return unionRect(rs);
        }
        case "minimap": {
            // reproduces app.js drawMinimapAndDebug's own layout formula
            const spacing = 20;
            const alcoveSize = 200 / util.getScreenRatio();
            const len = alcoveSize;
            const height = (len / gw()) * gh();
            const x = global.mobile ? spacing : global.screenWidth - spacing - len - 5;
            const y = global.mobile ? spacing : global.screenHeight - height - spacing - 5;
            return { x, y, w: len, h: height };
        }
        case "vault": {
            // reproduces app.js drawVaultUI's own layout formula (same on both platforms)
            const W = 340, H = 136;
            return { x: (global.screenWidth - W) / 2, y: global.screenHeight - 318, w: W, h: H };
        }
        default:
            return null;
    }
}

function drawUiBox(target) {
    const c = ctxGui();
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
document.addEventListener("touchstart", onTouchStart, { passive: true });
tick();
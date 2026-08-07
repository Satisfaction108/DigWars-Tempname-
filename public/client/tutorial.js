import { global } from "./global.js";
import { util } from "./util.js";
import { gui } from "./socketinit.js";
import { gameSound } from "./sound.js";

// ── Dig Wars — guided descent ──────────────────────────────────────────
// A diegetic, objective-driven tutorial. Instead of a dialog box telling you
// to "go break a rock", it *picks a rock*, paints its real silhouette in the
// world, walks a trail of chevrons to it, tracks that specific rock's health
// as you chip it, and bursts when it dies. Then it points at the gems that
// fell out. Then at your vault.
//
// Two render passes, both on the game's own canvases:
//   drawWorld(px, py, ratio)  — world-anchored markers, called from
//                               drawGameplay() so it shares the camera
//                               transform the entities were just drawn with.
//   hook()                    — screen-space HUD, called after drawGUI() so
//                               the objective card sits above everything.
//
// Progress persists in localStorage so it plays once per browser.

const STORAGE_KEY = "digwarsTutorialDone";

// socketinit.js pings this on every terrain rock event; keep a cheap counter
// so steps can notice "something broke" without diffing the whole terrain.
window.dwTutorialRock = () => { window.dwRocksBroken = (window.dwRocksBroken || 0) + 1; };

// ── palette ────────────────────────────────────────────────────────────
const GOLD = "255,215,94";
const PALE = "242,234,214";
const MINT = "120,255,200";
const FONT = "Rubik, Ubuntu, sans-serif";

// ── keybind labels ─────────────────────────────────────────────────────
const DEFAULTS = {
    KEY_UP: "W", KEY_DOWN: "S", KEY_LEFT: "A", KEY_RIGHT: "D",
    KEY_AUTO_FIRE: "E", KEY_AUTO_SPIN: "C",
    KEY_AUTO_ALT: "G", KEY_TOGGLE_MAP: "F",
    KEY_UPGRADE_ATK: "1", KEY_UPGRADE_SHI: "0",
};
let keyLabelCache = null;
function lbl(id) {
    if (!keyLabelCache) {
        keyLabelCache = {};
        let kb = {};
        try {
            const raw = localStorage.getItem("keybinds");
            if (raw && raw.startsWith("{")) kb = JSON.parse(raw) || {};
        } catch (e) { }
        for (const k of Object.keys(DEFAULTS))
            keyLabelCache[k] = (kb[k] && kb[k][0]) || DEFAULTS[k];
    }
    return keyLabelCache[id] || DEFAULTS[id] || id;
}

// ── small math ─────────────────────────────────────────────────────────
const T = () => performance.now();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const SW = () => global.screenWidth;
const SH = () => global.screenHeight;
// One scale factor so every glyph, pad and stroke tracks the viewport. Phones
// get a bump because the same physical size is a much smaller slice of screen.
const US = () => clamp(Math.min(SW(), SH()) / 760, 0.7, 1.45) * (global.mobile ? 1.04 : 1);

function ctxWorld() { return window.dwCtx && window.dwCtx[1]; }
function ctxGui() { return window.dwCtx && window.dwCtx[2]; }

// The camera transform drawGameplay() hands us: px/py are already ratio-scaled.
function w2s(wx, wy, px, py, ratio) {
    return { x: -px + SW() / 2 + ratio * wx, y: -py + SH() / 2 + ratio * wy };
}

function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

// ── audio stingers (built from the game's own synth primitives) ────────
function canSound() {
    try { return !!(gameSound && gameSound._ready && gameSound._ready()); }
    catch (e) { return false; }
}
function sfxObjective() {
    if (!canSound()) return;
    try {
        gameSound._tone({ freq: 523.25, type: "sine", dur: 0.13, peak: 0.13, attack: 0.003 });
        gameSound._tone({ freq: 783.99, type: "sine", dur: 0.20, peak: 0.11, delay: 0.08, attack: 0.004 });
        gameSound._ring({ freqs: [1046.5, 1568], dur: 0.14, peak: 0.05, delay: 0.08 });
    } catch (e) { }
}
function sfxAdvance() {
    if (!canSound()) return;
    try { gameSound._tone({ freq: 330, type: "triangle", dur: 0.07, peak: 0.05, attack: 0.002 }); }
    catch (e) { }
}
function sfxFinale() {
    if (!canSound()) return;
    try {
        gameSound._ring({ freqs: [261.6, 392, 523.25], dur: 0.5, peak: 0.13 });
        gameSound._tone({ freq: 783.99, type: "sine", dur: 0.5, peak: 0.09, delay: 0.16, attack: 0.02 });
    } catch (e) { }
}

// ── terrain access ─────────────────────────────────────────────────────
function terr() {
    const t = window.terrainRenderer;
    return (t && t.ready && t._world && t._cellPolys) ? t : null;
}
// A rock cell's polygon and centroid live in column units; scale by world.s
// and recentre to get true world coordinates.
function rockAt(t, k) {
    const cell = t._cellPolys.get(k);
    if (!cell) return null;
    const w = t._world;
    return { k, cell, x: cell.cx * w.s - w.hw, y: cell.cy * w.s - w.hh, s: w.s, hw: w.hw, hh: w.hh };
}
function rockAlive(t, k) {
    return t._cellPolys.has(k) && !t._rockDead.has(k);
}
// Pick a rock that makes a good first target: ore-bearing if we can, and at a
// comfortable stand-off so the player has to actually aim rather than bump it.
function acquireRock(wantOre) {
    const t = terr();
    if (!t) return null;
    const px = global.player.renderx, py = global.player.rendery;
    // Judge distance in *screen* terms, not world units: the camera zoom and
    // the viewport both vary, and what actually matters is that the marked
    // rock lands comfortably inside the view — close enough to see it and the
    // marker together, far enough that you have to aim. World-unit thresholds
    // put the target in the screen corner (under the minimap) on wide screens.
    const r = util.getRatio() || 1;
    const span = Math.min(SW(), SH());
    const ideal = (span * 0.24) / r;
    const near = (span * 0.09) / r;
    // Soft preference, not a hard window: you spawn inside a cleared base
    // pocket, so the closest rock can be well outside the viewport. Score by
    // distance from ideal and always return the best candidate — if it starts
    // off-screen the edge arrow walks you to it, which is the point.
    let best = null, bestScore = Infinity;
    const keys = wantOre ? t._ore.keys() : t._rockHealth.keys();
    for (const k of keys) {
        if (!rockAlive(t, k)) continue;
        const rk = rockAt(t, k);
        if (!rk) continue;
        const d = Math.hypot(rk.x - px, rk.y - py);
        if (d < near) continue;
        const score = Math.abs(d - ideal) + (d > ideal ? 0 : 400);
        if (score < bestScore) { bestScore = score; best = rk; }
    }
    if (!best && wantOre) return acquireRock(false);
    return best;
}
function nearestVault() {
    if (!global.vaults || !global.vaults.length) return null;
    const px = global.player.renderx, py = global.player.rendery;
    let best = null, bestD = Infinity;
    for (const v of global.vaults) {
        const d = Math.hypot(v.x - px, v.y - py);
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
}

// ── state ──────────────────────────────────────────────────────────────
const state = {
    running: false,
    step: -1,
    stepAt: 0,          // when the current objective began
    completedAt: 0,     // when it was satisfied (drives the flourish)
    phase: "idle",      // idle | active | clearing | finished
    target: null,       // {kind:'rock'|'point'|'vault'|'ui', ...}
    base: {},           // per-step baseline snapshot
    fireSeen: false,
    bursts: [],         // world-space completion particles
    titleAt: 0,
    hudAlpha: 0,
};

function snapshot() {
    state.base = {
        x: global.player.renderx,
        y: global.player.rendery,
        carried: global.gems.carried,
        banked: global.gems.banked,
        points: gui.points,
        type: gui.type,
        rocks: window.dwRocksBroken || 0,
    };
    state.fireSeen = false;
}

// ── objectives ─────────────────────────────────────────────────────────
// Each: label (short, uppercase-ish), hint (tokens with {{KEY_x}} glyphs),
// acquire() to lock a world target, progress() 0..1, done() to advance.
const STEPS = [
    {
        id: "wake",
        title: "DIG WARS",
        subtitle: "Mine the deep. Bank it before they do.",
        card: true,
        hold: 2600,
        done: () => T() - state.stepAt > 2600,
    },
    {
        id: "move",
        label: "Move",
        hint: () => global.mobile
            ? "Drag the left side of the screen to drive."
            : "{{KEY_UP}}{{KEY_LEFT}}{{KEY_DOWN}}{{KEY_RIGHT}} to drive.",
        target: () => ({ kind: "self" }),
        progress: () => clamp(Math.hypot(
            global.player.renderx - state.base.x,
            global.player.rendery - state.base.y) / 260, 0, 1),
        done: () => Math.hypot(
            global.player.renderx - state.base.x,
            global.player.rendery - state.base.y) > 260,
    },
    {
        id: "fire",
        label: "Fire",
        hint: () => global.mobile
            ? "Hold the right side of the screen to aim and shoot."
            : "Aim with the mouse. Hold left click or SPACE to shoot.",
        target: () => ({ kind: "self" }),
        done: () => state.fireSeen ||
            (global.mobile && global.canvas && global.canvas.controlTouch !== null),
    },
    {
        id: "rock",
        label: "Break the rock",
        hint: () => "Shoot the marked rock until it shatters.",
        acquire: () => {
            const r = acquireRock(true);
            return r ? { kind: "rock", k: r.k, x: r.x, y: r.y } : null;
        },
        // Re-lock if our rock is taken out from under us (someone else's shot,
        // terrain regrowth) so the marker is never pointing at nothing.
        revalidate: (tg) => {
            const t = terr();
            if (!t) return tg;
            if (tg && rockAlive(t, tg.k)) {
                const r = rockAt(t, tg.k);
                if (r) { tg.x = r.x; tg.y = r.y; }
                return tg;
            }
            return null;
        },
        progress: (tg) => {
            const t = terr();
            if (!t || !tg) return 0;
            const h = t._rockHealth.get(tg.k);
            return h === undefined ? 0 : clamp(1 - h, 0, 1);
        },
        done: (tg) => {
            const t = terr();
            if (!t || !tg) return false;
            return t._rockDead.has(tg.k);
        },
        // Remember where it died so the next objective can point at the debris.
        onDone: (tg) => { if (tg) state.lastBreak = { x: tg.x, y: tg.y }; },
    },
    {
        id: "gems",
        label: "Collect the gems",
        hint: () => "Drive over the loose gems to scoop them up.",
        acquire: () => state.lastBreak
            ? { kind: "point", x: state.lastBreak.x, y: state.lastBreak.y }
            : null,
        progress: () => global.gems.cap
            ? clamp(global.gems.carried / Math.max(1, global.gems.cap), 0, 1) : 0,
        done: () => global.gems.carried > state.base.carried,
    },
    {
        id: "bank",
        label: "Bank your haul",
        hint: () => "Carried gems drop when you die. Park on the vault pad to bank them.",
        acquire: () => {
            const v = nearestVault();
            return v ? { kind: "vault", x: v.x, y: v.y, r: v.r || 95 } : null;
        },
        revalidate: () => {
            const v = nearestVault();
            return v ? { kind: "vault", x: v.x, y: v.y, r: v.r || 95 } : null;
        },
        done: () => global.gems.banked > state.base.banked ||
            (global.vault.onPad && state.base.carried > 0 && global.gems.carried === 0),
    },
    {
        id: "done",
        title: "GOOD LUCK, MINER",
        subtitle: "Out-bank the enemy team.",
        card: true,
        hold: 3200,
        final: true,
        done: () => T() - state.stepAt > 3200,
    },
];

// Contextual prompts — these fire the first time the game actually offers the
// thing, rather than blocking the main chain on state that may never arrive.
const TIPS = [
    {
        id: "stat",
        label: "Spend a stat point",
        hint: () => global.mobile
            ? "Tap the stat bars to strengthen your tank."
            : "Press {{KEY_UPGRADE_ATK}}–{{KEY_UPGRADE_SHI}} or click the bars to strengthen your tank.",
        when: () => gui.points > 0,
        ui: "skills",
        done: (b) => gui.points < b,
        base: () => gui.points,
    },
    {
        id: "evolve",
        label: "Evolve your tank",
        hint: () => global.mobile
            ? "Tap a class to evolve."
            : "Click a class to evolve, or press its key.",
        when: () => (gui.upgrades || []).length > 0,
        ui: "upgrades",
        done: (b) => gui.type !== b,
        base: () => gui.type,
    },
];
let tip = null, tipShown = {};

// ── UI rects (live geometry straight from the game's own hit regions) ───
function uiRect(kind) {
    const cl = global.clickables;
    if (!cl) return null;
    const pad = 10 * US();
    const rs = [];
    if (kind === "skills") {
        for (let i = 0; i < cl.stat.size(); i++) rs.push(cl.stat.rect(i));
    } else if (kind === "upgrades") {
        const n = (gui.upgrades || []).length;
        for (let i = 0; i < n; i++) rs.push(cl.upgrade.rect(i));
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const r of rs) {
        if (!r) continue;
        any = true;
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    if (!any) return null;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

// ── step machine ───────────────────────────────────────────────────────
function stepDef() { return STEPS[state.step]; }

function enterStep(i) {
    state.step = i;
    state.stepAt = T();
    state.completedAt = 0;
    state.phase = "active";
    state.target = null;
    snapshot();
    const s = stepDef();
    if (!s) return finish();
    if (s.acquire) state.target = s.acquire();
    if (s.card) { state.titleAt = T(); if (s.final) sfxFinale(); }
    else sfxAdvance();
}

function completeStep() {
    const s = stepDef();
    if (!s) return;
    state.phase = "clearing";
    state.completedAt = T();
    if (s.onDone) s.onDone(state.target);
    if (!s.card) {
        sfxObjective();
        if (state.target && (state.target.kind === "rock" || state.target.kind === "point"))
            burst(state.target.x, state.target.y);
    }
}

function advance() {
    if (state.step >= STEPS.length - 1) return finish();
    enterStep(state.step + 1);
}

function burst(x, y) {
    for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 190;
        state.bursts.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            born: T(), life: 480 + Math.random() * 420,
        });
    }
}

function update() {
    const s = stepDef();
    if (!s) return;

    if (state.phase === "active") {
        // Success is checked BEFORE re-targeting: for the rock objective the
        // target's death *is* the win condition, and revalidate treats a dead
        // rock as "lost" — re-acquiring first would swap in a fresh live rock
        // every time you broke one, so the step could never complete.
        if (s.done(state.target)) {
            completeStep();
        } else if (s.revalidate) {
            const next = s.revalidate(state.target);
            state.target = (!next && s.acquire) ? s.acquire() : next;
        } else if (!state.target && s.acquire) {
            state.target = s.acquire();
        }
    } else if (state.phase === "clearing") {
        const wait = s.card ? 620 : 900;
        if (T() - state.completedAt > wait) advance();
    }

    // contextual tips run alongside the main chain, but never over a title
    // card and never before the player has their hands on the controls
    if (!tip) {
        if (s.card || state.step < 2) return;
        for (const t of TIPS) {
            if (tipShown[t.id]) continue;
            if (t.when()) {
                tip = { def: t, at: T(), base: t.base(), gone: 0 };
                tipShown[t.id] = true;
                sfxAdvance();
                break;
            }
        }
    } else if (!tip.gone) {
        if (tip.def.done(tip.base)) { tip.gone = T(); sfxObjective(); }
        else if (T() - tip.at > 14000) tip.gone = T();
    } else if (T() - tip.gone > 900) {
        tip = null;
    }
}

// ── world pass ─────────────────────────────────────────────────────────
export function drawWorld(px, py, ratio) {
    const c = ctxWorld();
    if (!c || !state.running) return;
    const now = T();

    // completion debris always draws, even after the step moved on
    if (state.bursts.length) {
        c.save();
        for (let i = state.bursts.length - 1; i >= 0; i--) {
            const p = state.bursts[i];
            const age = (now - p.born) / p.life;
            if (age >= 1) { state.bursts.splice(i, 1); continue; }
            const t = age;
            const wx = p.x + p.vx * t, wy = p.y + p.vy * t;
            const sp = w2s(wx, wy, px, py, ratio);
            c.globalAlpha = (1 - t) * 0.9;
            c.fillStyle = `rgb(${GOLD})`;
            const r = (2.6 - 2 * t) * ratio * 1.6;
            c.beginPath(); c.arc(sp.x, sp.y, Math.max(0.6, r), 0, Math.PI * 2); c.fill();
        }
        c.restore();
    }

    const s = stepDef();
    if (!s) return;
    const tg = state.target;
    if (!tg) return;

    const clearing = state.phase === "clearing";
    const fade = clearing ? 1 - clamp((now - state.completedAt) / 520, 0, 1) : 1;
    if (fade <= 0) return;

    if (tg.kind === "self") { drawSelfRing(c, px, py, ratio, fade); return; }

    const sp = w2s(tg.x, tg.y, px, py, ratio);
    const onScreen = sp.x > -60 && sp.x < SW() + 60 && sp.y > -60 && sp.y < SH() + 60;
    // last known screen position of the marker, in logical units (debug aid)
    state.screen = { x: sp.x, y: sp.y, sw: SW(), sh: SH(), on: onScreen };

    if (onScreen) {
        if (tg.kind === "rock") drawRockTarget(c, tg, sp, px, py, ratio, fade);
        else if (tg.kind === "vault") drawVaultTarget(c, tg, sp, ratio, fade);
        else drawPointTarget(c, sp, ratio, fade);
        drawChevrons(c, sp, px, py, ratio, fade);
    } else {
        drawEdgeArrow(c, sp, tg, fade);
    }
}

// pulse ring around your own tank (move / fire steps)
function drawSelfRing(c, px, py, ratio, fade) {
    const s = stepDef();
    const sp = { x: SW() / 2, y: SH() / 2 };
    const now = T();
    const pr = s && s.progress ? s.progress() : 0;
    const R = 46 * ratio * 0.9 + 6 * Math.sin(now / 260);
    c.save();
    c.globalAlpha = 0.5 * fade;
    c.lineWidth = 2.5;
    c.strokeStyle = `rgb(${GOLD})`;
    c.setLineDash([7, 9]);
    c.lineDashOffset = -now / 26;
    c.beginPath(); c.arc(sp.x, sp.y, R, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    if (pr > 0) {
        c.globalAlpha = 0.95 * fade;
        c.lineWidth = 3.5;
        c.beginPath();
        c.arc(sp.x, sp.y, R, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2);
        c.stroke();
    }
    c.restore();
}

// the marked rock: its real silhouette, breathing brackets, damage arc
function drawRockTarget(c, tg, sp, px, py, ratio, fade) {
    const t = terr();
    const now = T();
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    let minX = sp.x, minY = sp.y, maxX = sp.x, maxY = sp.y;

    if (t) {
        const cell = t._cellPolys.get(tg.k);
        const w = t._world;
        if (cell && cell.poly && cell.poly.length > 2) {
            c.save();
            c.beginPath();
            for (let i = 0; i < cell.poly.length; i++) {
                const wx = cell.poly[i][0] * w.s - w.hw;
                const wy = cell.poly[i][1] * w.s - w.hh;
                const p = w2s(wx, wy, px, py, ratio);
                if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            c.closePath();
            c.globalAlpha = (0.10 + 0.07 * pulse) * fade;
            c.fillStyle = `rgb(${GOLD})`;
            c.fill();
            c.globalAlpha = (0.75 + 0.25 * pulse) * fade;
            c.strokeStyle = `rgb(${GOLD})`;
            c.lineWidth = 2.5;
            c.setLineDash([9, 7]);
            c.lineDashOffset = -now / 34;
            c.stroke();
            c.setLineDash([]);
            c.restore();
        }
    }

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const half = Math.max(26, Math.max(maxX - minX, maxY - minY) / 2 + 12);
    drawBrackets(c, cx, cy, half + 5 * pulse, fade);

    const s = stepDef();
    const pr = s && s.progress ? s.progress(tg) : 0;
    if (pr > 0.001) drawArc(c, cx, cy, half + 13, pr, fade);
    drawCaret(c, cx, cy - half - 20, fade);
}

function drawVaultTarget(c, tg, sp, ratio, fade) {
    const now = T();
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);
    const R = Math.max(34, tg.r * ratio * 1.12);
    c.save();
    c.globalAlpha = (0.55 + 0.4 * pulse) * fade;
    c.strokeStyle = `rgb(${GOLD})`;
    c.lineWidth = 3;
    c.setLineDash([12, 10]);
    c.lineDashOffset = -now / 30;
    c.beginPath(); c.arc(sp.x, sp.y, R, 0, Math.PI * 2); c.stroke();
    c.restore();
    drawBrackets(c, sp.x, sp.y, R + 12 + 4 * pulse, fade);
    drawCaret(c, sp.x, sp.y - R - 26, fade);
}

function drawPointTarget(c, sp, ratio, fade) {
    const now = T();
    const pulse = 0.5 + 0.5 * Math.sin(now / 240);
    c.save();
    c.globalAlpha = (0.6 + 0.4 * pulse) * fade;
    c.strokeStyle = `rgb(${MINT})`;
    c.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
        const t = ((now / 1100) + i * 0.5) % 1;
        c.globalAlpha = (1 - t) * 0.75 * fade;
        c.beginPath();
        c.arc(sp.x, sp.y, 16 + t * 52, 0, Math.PI * 2);
        c.stroke();
    }
    c.restore();
    drawCaret(c, sp.x, sp.y - 46, fade, MINT);
}

function drawBrackets(c, cx, cy, r, fade) {
    const arm = r * 0.42;
    c.save();
    c.globalAlpha = 0.9 * fade;
    c.strokeStyle = `rgb(${GOLD})`;
    c.lineWidth = 3;
    c.lineCap = "round";
    for (let i = 0; i < 4; i++) {
        const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1;
        const x = cx + sx * r, y = cy + sy * r;
        c.beginPath();
        c.moveTo(x - sx * arm, y); c.lineTo(x, y); c.lineTo(x, y - sy * arm);
        c.stroke();
    }
    c.restore();
}

function drawArc(c, cx, cy, r, pr, fade) {
    c.save();
    c.globalAlpha = 0.28 * fade;
    c.strokeStyle = `rgb(${PALE})`;
    c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.95 * fade;
    c.strokeStyle = `rgb(${GOLD})`;
    c.lineCap = "round";
    c.beginPath();
    c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + clamp(pr, 0, 1) * Math.PI * 2);
    c.stroke();
    c.restore();
}

// bobbing diamond above a target
function drawCaret(c, x, y, fade, col = GOLD) {
    const bob = Math.sin(T() / 300) * 5;
    c.save();
    c.translate(x, y + bob);
    c.globalAlpha = 0.95 * fade;
    c.fillStyle = `rgb(${col})`;
    c.strokeStyle = "rgba(0,0,0,.55)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 9); c.lineTo(8, -4); c.lineTo(-8, -4);
    c.closePath();
    c.fill(); c.stroke();
    c.restore();
}

// a short trail of chevrons from the player toward the target
function drawChevrons(c, sp, px, py, ratio, fade) {
    const ox = SW() / 2, oy = SH() / 2;
    const dx = sp.x - ox, dy = sp.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist < 150) return;
    const ang = Math.atan2(dy, dx);
    const now = T();
    const n = Math.min(4, Math.floor(dist / 90));
    c.save();
    c.strokeStyle = `rgb(${GOLD})`;
    c.lineWidth = 3;
    c.lineCap = "round";
    for (let i = 0; i < n; i++) {
        const t = ((now / 1300) + i / n) % 1;
        const d = lerp(74, Math.min(dist - 46, 74 + n * 90), t);
        const x = ox + Math.cos(ang) * d, y = oy + Math.sin(ang) * d;
        c.globalAlpha = Math.sin(t * Math.PI) * 0.5 * fade;
        c.save();
        c.translate(x, y); c.rotate(ang);
        c.beginPath();
        c.moveTo(-6, -7); c.lineTo(4, 0); c.lineTo(-6, 7);
        c.stroke();
        c.restore();
    }
    c.restore();
}

// off-screen target: arrow pinned to the screen edge, with distance
function drawEdgeArrow(c, sp, tg, fade) {
    const cx = SW() / 2, cy = SH() / 2;
    const ang = Math.atan2(sp.y - cy, sp.x - cx);
    const m = 74 * US();
    const rx = Math.max(40, cx - m), ry = Math.max(40, cy - m);
    // project onto the screen-edge ellipse so it reads on any aspect ratio
    const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
    const dist = Math.hypot(tg.x - global.player.renderx, tg.y - global.player.rendery);
    const now = T();
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    const S = US();

    c.save();
    c.globalAlpha = fade;
    c.translate(x, y);
    c.save();
    c.rotate(ang);
    c.fillStyle = `rgb(${GOLD})`;
    c.strokeStyle = "rgba(0,0,0,.6)";
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(17 * S, 0); c.lineTo(-9 * S, -12 * S); c.lineTo(-3 * S, 0); c.lineTo(-9 * S, 12 * S);
    c.closePath();
    c.globalAlpha = (0.75 + 0.25 * pulse) * fade;
    c.fill(); c.stroke();
    c.restore();

    const txt = `${Math.round(dist / 10)}m`;
    c.font = `700 ${12 * S}px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    const ty = Math.sin(ang) * 24 * S, tx = Math.cos(ang) * 24 * S;
    c.globalAlpha = 0.9 * fade;
    c.lineWidth = 3;
    c.strokeStyle = "rgba(0,0,0,.75)";
    c.strokeText(txt, tx, ty);
    c.fillStyle = `rgb(${PALE})`;
    c.fillText(txt, tx, ty);
    c.restore();
}

// ── HUD pass ───────────────────────────────────────────────────────────
// text is tokenised so {{KEY_X}} renders as a real keycap glyph inline
function tokenize(str) {
    const out = [];
    const re = /\{\{(KEY_[A-Z0-9_]+)\}\}/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
        if (m.index > last)
            for (const w of str.slice(last, m.index).split(/\s+/).filter(Boolean))
                out.push({ t: "w", s: w });
        out.push({ t: "k", s: lbl(m[1]) });
        last = m.index + m[0].length;
    }
    for (const w of str.slice(last).split(/\s+/).filter(Boolean)) out.push({ t: "w", s: w });
    return out;
}

function measure(c, tok, S) {
    if (tok.t === "k") {
        c.font = `800 ${12 * S}px ${FONT}`;
        return Math.max(20 * S, c.measureText(tok.s).width + 14 * S);
    }
    c.font = `500 ${14 * S}px ${FONT}`;
    return c.measureText(tok.s).width;
}

function layout(c, tokens, maxW, S) {
    const space = 4.5 * S;
    const lines = [];
    let cur = [], w = 0;
    for (const tok of tokens) {
        const tw = measure(c, tok, S);
        if (cur.length && w + space + tw > maxW) { lines.push({ toks: cur, w }); cur = []; w = 0; }
        if (cur.length) w += space;
        cur.push({ tok, w: tw });
        w += tw;
    }
    if (cur.length) lines.push({ toks: cur, w });
    return lines;
}

function drawLine(c, line, cx, y, S) {
    const space = 4.5 * S;
    let x = cx - line.w / 2;
    for (const it of line.toks) {
        if (it.tok.t === "k") {
            const h = 19 * S;
            roundRect(c, x, y - h / 2, it.w, h, 5 * S);
            c.fillStyle = "rgba(6,7,10,.92)";
            c.fill();
            c.strokeStyle = `rgba(${GOLD},.75)`;
            c.lineWidth = 1.5;
            c.stroke();
            c.font = `800 ${12 * S}px ${FONT}`;
            c.fillStyle = `rgb(${GOLD})`;
            c.textAlign = "center";
            c.fillText(it.tok.s, x + it.w / 2, y + 0.5 * S);
        } else {
            c.font = `500 ${14 * S}px ${FONT}`;
            c.fillStyle = `rgba(${PALE},.93)`;
            c.textAlign = "left";
            c.fillText(it.tok.s, x, y);
        }
        x += it.w + space;
    }
}

// wide-tracked uppercase, drawn glyph by glyph (canvas letterSpacing is not
// universally supported, and we want exact centring regardless)
function trackedText(c, str, cx, y, size, color, track, alpha) {
    c.font = `800 ${size}px ${FONT}`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    const chars = [...str];
    let total = 0;
    for (const ch of chars) total += c.measureText(ch).width + track;
    total -= track;
    let x = cx - total / 2;
    c.globalAlpha = alpha;
    for (const ch of chars) {
        const w = c.measureText(ch).width;
        c.lineWidth = Math.max(3, size / 7);
        c.strokeStyle = "rgba(0,0,0,.7)";
        c.strokeText(ch, x, y);
        c.fillStyle = color;
        c.fillText(ch, x, y);
        x += w + track;
    }
}

function drawTitleCard(c, s) {
    const S = US();
    const t = T() - state.stepAt;
    const inA = smooth(t / 700);
    const outA = state.phase === "clearing"
        ? 1 - smooth((T() - state.completedAt) / 560) : 1;
    const a = inA * outA;
    if (a <= 0) return;
    const cx = SW() / 2, cy = SH() * (global.mobile ? 0.32 : 0.36);

    // vignette so the card reads over a busy cavern
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(SW(), SH()) * 0.72);
    g.addColorStop(0, `rgba(0,0,0,${0.62 * a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.save();
    c.fillStyle = g;
    c.fillRect(0, 0, SW(), SH());

    const size = Math.min(54 * S, SW() / (s.title.length * 0.62));
    const rise = (1 - inA) * 14;
    trackedText(c, s.title, cx, cy - rise, size, `rgb(${GOLD})`, size * 0.16, a);

    // hairline rules that draw themselves outward
    const halfW = Math.min(SW() * 0.34, 240 * S) * easeOut(t / 900);
    c.globalAlpha = a * 0.75;
    c.strokeStyle = `rgba(${GOLD},.6)`;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - halfW, cy + size * 0.72); c.lineTo(cx + halfW, cy + size * 0.72);
    c.stroke();

    if (s.subtitle) {
        c.globalAlpha = a * smooth((t - 320) / 700);
        c.font = `500 ${15 * S}px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.lineWidth = 3;
        c.strokeStyle = "rgba(0,0,0,.6)";
        c.strokeText(s.subtitle, cx, cy + size * 0.72 + 22 * S);
        c.fillStyle = `rgba(${PALE},.92)`;
        c.fillText(s.subtitle, cx, cy + size * 0.72 + 22 * S);
    }
    c.restore();
}

// the objective card: label, hint, progress pips
function drawObjective(c) {
    const s = stepDef();
    if (!s || s.card) return;
    const S = US();
    const t = T() - state.stepAt;
    const cleared = state.phase === "clearing";
    const inA = smooth(t / 420);
    const outA = cleared ? 1 - smooth((T() - state.completedAt) / 620) : 1;
    const a = inA * outA;
    if (a <= 0) return;

    const maxW = Math.min(SW() * (global.mobile ? 0.94 : 0.86), 470 * S);
    const hint = typeof s.hint === "function" ? s.hint() : s.hint;
    const lines = layout(c, tokenize(hint), maxW - 36 * S, S);
    const lineH = 21 * S;
    const padX = 18 * S, padY = 14 * S;
    const labelH = 26 * S;
    const boxH = padY * 2 + labelH + lines.length * lineH + 10 * S;
    const boxW = maxW;
    const x = (SW() - boxW) / 2;
    // Desktop: below the game's spawn/status messages, which stack at
    // top-centre. Mobile: the top strip belongs to the DOM buttons and the
    // class picker, so sit in the band between the joysticks and the gem bar.
    const y = (global.mobile
        ? SH() - boxH - 152 * S
        : 78 * S) + (1 - inA) * -12;
    const cx = SW() / 2;

    c.save();
    c.globalAlpha = a;

    roundRect(c, x, y, boxW, boxH, 12 * S);
    c.fillStyle = "rgba(10,11,15,.80)";
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = `rgba(${GOLD},.28)`;
    c.stroke();

    // left accent bar that fills with step progress
    const pr = cleared ? 1 : (s.progress ? clamp(s.progress(state.target), 0, 1) : 0);
    roundRect(c, x, y, 3.5 * S, boxH, 2 * S);
    c.fillStyle = `rgba(${GOLD},.25)`;
    c.fill();
    if (pr > 0) {
        roundRect(c, x, y + boxH * (1 - pr), 3.5 * S, boxH * pr, 2 * S);
        c.fillStyle = `rgb(${GOLD})`;
        c.fill();
    }

    // label — struck through and ticked once satisfied
    const ly = y + padY + labelH / 2;
    const done = cleared;
    trackedText(c, (done ? "✓  " : "") + (s.label || "").toUpperCase(), cx, ly,
        16 * S, done ? `rgb(${MINT})` : `rgb(${GOLD})`, 1.6 * S, a);
    c.globalAlpha = a;

    let ty = y + padY + labelH + 12 * S;
    c.textBaseline = "middle";
    for (const line of lines) { drawLine(c, line, cx, ty, S); ty += lineH; }

    // step pips
    const total = STEPS.filter(s2 => !s2.card).length;
    const idx = STEPS.slice(0, state.step + 1).filter(s2 => !s2.card).length - 1;
    const gap = 13 * S;
    let dx = cx - (total - 1) * gap / 2;
    for (let i = 0; i < total; i++) {
        c.beginPath();
        c.arc(dx, y + boxH - 9 * S, (i === idx ? 3.6 : 2.4) * S, 0, Math.PI * 2);
        c.fillStyle = i === idx ? `rgb(${GOLD})`
            : i < idx ? `rgba(${GOLD},.5)` : "rgba(255,255,255,.18)";
        c.fill();
        dx += gap;
    }
    c.restore();

    // remember the card's band so the tip can dodge it when it has no UI anchor
    state.card = { y, h: boxH };
    // mobile stacks the card at the bottom, so the skip control goes above it
    layoutSkip(global.mobile ? y - 36 * S : y + boxH);
}

// contextual tip card, anchored to the UI it is talking about
function drawTip(c) {
    if (!tip) return;
    const S = US();
    const a = smooth((T() - tip.at) / 380) *
        (tip.gone ? 1 - smooth((T() - tip.gone) / 700) : 1);
    if (a <= 0) return;
    const box = uiRect(tip.def.ui);

    c.save();
    c.globalAlpha = a;

    if (box) {
        const pulse = 0.5 + 0.5 * Math.sin(T() / 260);
        c.lineWidth = 2.5;
        c.strokeStyle = `rgba(${GOLD},${0.55 + 0.4 * pulse})`;
        roundRect(c, box.x, box.y, box.w, box.h, 8 * S);
        c.stroke();
        c.lineWidth = 8;
        c.strokeStyle = `rgba(${GOLD},${0.08 + 0.07 * pulse})`;
        c.stroke();
    }

    const hint = typeof tip.def.hint === "function" ? tip.def.hint() : tip.def.hint;
    const maxW = Math.min(SW() * 0.8, 340 * S);
    const lines = layout(c, tokenize(hint), maxW - 30 * S, S);
    const lineH = 20 * S;
    const boxW = maxW, boxH = 20 * S + 20 * S + lines.length * lineH;
    const gap = 12 * S, edge = 8 * S;
    let x, y;
    if (!box) {
        // no UI to anchor to — tuck it against the objective card
        x = (SW() - boxW) / 2;
        y = state.card
            ? (global.mobile ? state.card.y - boxH - 12 * S : state.card.y + state.card.h + 34 * S)
            : SH() - boxH - 90 * S;
        y = clamp(y, edge, SH() - boxH - edge);
    } else {
        // Never cover the thing we are pointing at. Prefer the side of the
        // highlight with room; fall back to above/below. The stat bars hug a
        // screen corner, so "below" is usually off-screen and "beside" wins.
        const roomR = SW() - (box.x + box.w) - gap - edge;
        const roomL = box.x - gap - edge;
        const roomB = SH() - (box.y + box.h) - gap - edge;
        const roomT = box.y - gap - edge;
        if (roomR >= boxW || roomL >= boxW) {
            x = roomR >= boxW ? box.x + box.w + gap : box.x - gap - boxW;
            y = clamp(box.y + box.h / 2 - boxH / 2, edge, SH() - boxH - edge);
        } else if (roomB >= boxH || roomT >= boxH) {
            y = roomB >= boxH ? box.y + box.h + gap : box.y - gap - boxH;
            x = clamp(box.x + box.w / 2 - boxW / 2, edge, SW() - boxW - edge);
        } else {
            x = clamp(box.x + box.w / 2 - boxW / 2, edge, SW() - boxW - edge);
            y = clamp(SH() - boxH - 90 * S, edge, SH() - boxH - edge);
        }
    }

    roundRect(c, x, y, boxW, boxH, 10 * S);
    c.fillStyle = "rgba(10,11,15,.86)";
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = `rgba(${GOLD},.3)`;
    c.stroke();

    const cx2 = x + boxW / 2;
    const done = !!tip.gone && tip.def.done(tip.base);
    trackedText(c, (done ? "✓  " : "") + tip.def.label.toUpperCase(), cx2, y + 18 * S,
        13 * S, done ? `rgb(${MINT})` : `rgb(${GOLD})`, 1.4 * S, a);
    c.globalAlpha = a;
    let ty = y + 20 * S + 18 * S;
    c.textBaseline = "middle";
    for (const line of lines) { drawLine(c, line, cx2, ty, S); ty += lineH; }
    c.restore();
}

// ── skip control (DOM, so it is reliably clickable/tappable) ───────────
let skipEl = null;
function ensureSkip() {
    if (skipEl) return;
    skipEl = document.createElement("button");
    skipEl.id = "dwTutSkip";
    skipEl.textContent = "Skip tutorial";
    skipEl.addEventListener("click", (e) => { e.stopPropagation(); finish(); });
    document.body.appendChild(skipEl);
}
// glue the button just under the canvas-drawn card (logical → CSS px)
function layoutSkip(belowY) {
    if (!skipEl) return;
    const k = window.innerHeight / Math.max(1, SH());
    skipEl.style.top = Math.round(belowY * k + 8) + "px";
}
function showSkip(on) {
    if (!skipEl) return;
    skipEl.classList.toggle("show", !!on);
}

// ── input ──────────────────────────────────────────────────────────────
function onKeyDown(e) {
    if (!state.running) return;
    if (e.keyCode === 32) state.fireSeen = true;
}
function onMouseDown(e) {
    if (!state.running) return;
    if (e.button === 0) state.fireSeen = true;
}

// ── lifecycle ──────────────────────────────────────────────────────────
function open() {
    ensureSkip();
    state.running = true;
    state.bursts = [];
    state.lastBreak = null;
    tip = null; tipShown = {};
    showSkip(true);
    enterStep(0);
}
function finish() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) { }
    state.running = false;
    state.phase = "finished";
    state.target = null;
    tip = null;
    showSkip(false);
}

export function isComplete() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
}
export function startTutorial() { if (!isComplete()) open(); }
export function replayTutorial() { open(); }

let startedOnce = false;
// Called every frame from app.js right after drawGUI() — screen-space pass.
export function hook() {
    if (!startedOnce && global.gameStart && !global.died && !isComplete() && terr()) {
        startedOnce = true;
        open();
    }
    if (!state.running) return;
    if (global.died || global.disconnected) return;

    update();

    const c = ctxGui();
    if (!c) return;
    const s = stepDef();
    c.save();
    c.textBaseline = "middle";
    if (s && s.card) {
        drawTitleCard(c, s);
        // park the skip control under the title card; no skipping the outro
        layoutSkip(SH() * 0.46);
        showSkip(!s.final);
    } else {
        drawObjective(c);   // positions the skip control under its card
        showSkip(true);
    }
    drawTip(c);
    c.restore();
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("mousedown", onMouseDown);

// read-only handle for debugging/automation: which objective is live and what
// it is currently pointing at
window.dwTut = state;

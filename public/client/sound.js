// Dig Wars sound system — stylized, ear-friendly foley.
//
// Design: Fortnite-like punch (layered sub + body + air) without realistic
// stone/metal and without sci-fi lasers. Every event is a rounded mid-low
// "tok / foomp / bloom" built from sines and brown/pink noise. No white-noise
// gravel, no 1ms clicks, no 3kHz ice-picks, no pebble grains.
//
// Master bus high-cuts the fatiguing band so a bullet-storm stays soft.
// World sounds are distance-attenuated and stereo-panned, with throttles
// and busy-ducking so mining never turns into a machine gun.
//
// Console API: gameSound.setVolume(0..1), gameSound.mute()
import { global } from "./global.js";

const VOLUME_KEY = 'dw_soundVolume';

// MASTER KILL SWITCH — flip to false to silence everything; call sites stay wired.
const SOUND_ENABLED = true;

const jit = (n, amt = 0.06) => n * (1 - amt + Math.random() * amt * 2);

class GameSound {
    constructor() {
        this.ctx     = null;
        this.master  = null;
        this._pink   = null;
        this._brown  = null;
        this._last   = {};
        this._recent = [];
        let v = parseFloat(localStorage.getItem(VOLUME_KEY));
        this.volume  = isNaN(v) ? 0.7 : v;
        this._hookGesture();
    }

    _hookGesture() {
        const kick = () => { this._init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
        for (const ev of ['pointerdown', 'keydown', 'touchstart'])
            document.addEventListener(ev, kick, { passive: true });
    }

    _init() {
        if (!SOUND_ENABLED) return;
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();

        // gain -> highshelf (cut harsh air) -> gentle lowpass ceiling -> compressor -> out
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;

        const shelf = this.ctx.createBiquadFilter();
        shelf.type = 'highshelf';
        shelf.frequency.value = 2200;
        shelf.gain.value = -12;

        const air = this.ctx.createBiquadFilter();
        air.type = 'lowpass';
        air.frequency.value = 4800;
        air.Q.value = 0.45;

        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -26;
        comp.knee.value      = 30;
        comp.ratio.value     = 3.2;
        comp.attack.value    = 0.01;
        comp.release.value   = 0.28;

        this.master.connect(shelf);
        shelf.connect(air);
        air.connect(comp);
        comp.connect(this.ctx.destination);

        this._pink  = this._makeNoise('pink');
        this._brown = this._makeNoise('brown');
    }

    _makeNoise(kind) {
        const len = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        if (kind === 'brown') {
            let last = 0;
            for (let i = 0; i < len; i++) {
                last += (Math.random() * 2 - 1) * 0.014;
                last *= 0.996;
                d[i] = last;
            }
        } else {
            // Paul Kellet pink
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + w * 0.0555179;
                b1 = 0.99332 * b1 + w * 0.0750759;
                b2 = 0.96900 * b2 + w * 0.1538520;
                b3 = 0.86650 * b3 + w * 0.3104856;
                b4 = 0.55000 * b4 + w * 0.5329522;
                b5 = -0.7616 * b5 - w * 0.0168980;
                d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
                b6 = w * 0.115926;
            }
        }
        let peak = 0;
        for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
        const g = peak > 0 ? 0.9 / peak : 1;
        for (let i = 0; i < len; i++) d[i] *= g;
        return buf;
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        localStorage.setItem(VOLUME_KEY, this.volume);
        if (this.master) this.master.gain.value = this.volume;
    }
    mute() { this.setVolume(0); }

    _ready() { return this.ctx && this.ctx.state === 'running' && this.volume > 0; }

    _spatial(x, y) {
        const lx = global.player ? global.player.renderx : 0;
        const ly = global.player ? global.player.rendery : 0;
        const dx = x - lx, dy = y - ly;
        const d  = Math.hypot(dx, dy);
        const MAXD = 3200;
        if (d > MAXD) return null;
        const t   = Math.max(0, (d - 500) / (MAXD - 500));
        const vol = (1 - t) * (1 - t);
        const pan = Math.max(-0.75, Math.min(0.75, dx / 1600));
        return { vol, pan };
    }

    _throttle(name, gapMs) {
        const now = performance.now();
        if (this._last[name] !== undefined && now - this._last[name] < gapMs) return false;
        this._last[name] = now;
        return true;
    }

    _busyGain() {
        const now = performance.now();
        this._recent = this._recent.filter(t => now - t < 280);
        this._recent.push(now);
        return 1 / Math.sqrt(Math.max(1, this._recent.length * 0.75));
    }

    // Rounded envelope: never a click. Attack is the difference between
    // "tok" and "clack".
    _out(pan, when, dur, peak, attack = 0.008) {
        const g = this.ctx.createGain();
        const a = Math.max(0.005, attack);
        const d = Math.max(a + 0.02, dur);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), when + a);
        g.gain.exponentialRampToValueAtTime(0.0001, when + d);
        let node = g;
        if (this.ctx.createStereoPanner) {
            const p = this.ctx.createStereoPanner();
            p.pan.value = pan;
            g.connect(p);
            node = p;
        }
        node.connect(this.master);
        return g;
    }

    _tone({ freq, glideTo, type = 'sine', dur = 0.1, peak = 0.2, pan = 0, delay = 0, attack = 0.008 }) {
        const t0 = this.ctx.currentTime + delay;
        const o  = this.ctx.createOscillator();
        o.type = type === 'sawtooth' || type === 'square' ? 'triangle' : type;
        const f0 = Math.max(40, jit(freq, 0.03));
        o.frequency.setValueAtTime(f0, t0);
        if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), t0 + dur);
        o.connect(this._out(pan, t0, dur, peak, attack));
        o.start(t0);
        o.stop(t0 + dur + 0.03);
    }

    // Soft air: brown (whoosh/weight) or pink (a little presence). Always
    // band-limited in the mids — never a slamming lowpass on white noise.
    _puff({ kind = 'brown', cut = 600, cutTo, Q = 0.7, dur = 0.08, peak = 0.1,
            pan = 0, delay = 0, attack = 0.01, rate = 1 } = {}) {
        const t0 = this.ctx.currentTime + delay;
        const s  = this.ctx.createBufferSource();
        s.buffer = kind === 'pink' ? this._pink : this._brown;
        s.loop = true;
        s.playbackRate.value = jit(rate, 0.08);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = Q;
        const c0 = Math.max(80, jit(cut, 0.08));
        f.frequency.setValueAtTime(c0, t0);
        if (cutTo) f.frequency.exponentialRampToValueAtTime(Math.max(80, cutTo), t0 + dur);
        s.connect(f);
        f.connect(this._out(pan, t0, dur, peak, attack));
        s.start(t0);
        s.stop(t0 + dur + 0.03);
    }

    // Quiet harmonic bloom. Slow attack so it never reads as a clack.
    _ring({ freqs = [180, 270], dur = 0.12, peak = 0.08, pan = 0, delay = 0 } = {}) {
        const d = jit(1, 0.03);
        for (let i = 0; i < freqs.length; i++) {
            this._tone({
                freq: freqs[i] * d,
                type: 'sine',
                dur: dur * (1 - i * 0.12),
                peak: peak / (i + 1.4),
                pan, delay,
                attack: 0.012,
            });
        }
    }

    // The Fortnite-style punch, stylized: felt sub + rounded body drop +
    // a whisper of brown air. Used by breaks, hurts, kills — never by chips.
    _impact({ pan = 0, v = 1, sub = 72, body = 170, bodyTo = 88, air = 480,
              weight = 0.28, dur = 0.14 } = {}) {
        this._tone({ freq: sub, glideTo: sub * 0.7, type: 'sine', dur: dur * 1.15,
                     peak: 0.22 * weight * v, pan, attack: 0.01 });
        this._tone({ freq: body, glideTo: bodyTo, type: 'sine', dur,
                     peak: 0.32 * weight * v, pan, attack: 0.008 });
        this._puff({ kind: 'brown', cut: air, cutTo: air * 0.45, Q: 0.65,
                     dur: dur * 0.85, peak: 0.12 * weight * v, pan, attack: 0.012 });
    }

    // Compatibility aliases so tutorial / console never hit the old gravel synth.
    _hiss(opts = {}) {
        this._puff({
            kind: 'brown',
            cut: opts.lowpass ? opts.lowpass * 0.45 : 550,
            dur: opts.dur, peak: (opts.peak || 0.1) * 0.6,
            pan: opts.pan, delay: opts.delay, attack: Math.max(0.01, opts.attack || 0.01),
        });
    }
    _thump(opts = {}) {
        this._impact({
            pan: opts.pan || 0, v: 1,
            body: Math.max(90, (opts.cut1 || 200) * 0.7),
            bodyTo: 70,
            air: Math.min(900, (opts.cut0 || 800) * 0.35),
            weight: (opts.peak || 0.3) * 0.7,
            dur: opts.dur || 0.1,
        });
    }


    // ── game sounds ─────────────────────────────────────────────────────────

    // Mining chip: a hollow wooden "tok". Progress brightens the body a little,
    // never the noise. Soft/graze hits are almost a murmur.
    rockHit(x, y, stage = 0, soft = false) {
        if (!this._ready() || !this._throttle('rockHit', soft ? 130 : 55)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain() * (soft ? 0.28 : 1);
        const st = 1 + stage * 0.07;
        this._tone({
            freq: 196 * st, glideTo: 128 * st, type: 'sine',
            dur: 0.07, peak: 0.16 * v, pan: sp.pan, attack: 0.007,
        });
        this._puff({
            kind: 'brown', cut: 620 * st, cutTo: 340, Q: 0.6,
            dur: 0.05, peak: 0.055 * v, pan: sp.pan, attack: 0.01,
        });
    }

    // Rock gone: a cushioned bloom — tension releasing, not a crumble.
    rockBreak(x, y) {
        if (!this._ready() || !this._throttle('rockBreak', 80)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        this._impact({ pan: sp.pan, v, sub: 64, body: 148, bodyTo: 72,
                       air: 420, weight: 0.42, dur: 0.18 });
        this._tone({ freq: 98, type: 'sine', dur: 0.22, peak: 0.08 * v,
                     pan: sp.pan, delay: 0.04, attack: 0.02 });
    }

    // Gun: a muted air pulse. Texture in a fight, never a pew and never a clap.
    shoot(x, y, power = 1) {
        if (!this._ready() || !this._throttle('shoot', 60)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        const p = Math.min(1.5, 0.55 + (power || 1) * 0.4);
        this._puff({
            kind: 'brown', cut: 520, cutTo: 280, Q: 0.75,
            dur: 0.055, peak: 0.07 * p * v, pan: sp.pan, attack: 0.008,
        });
        this._tone({
            freq: 92, glideTo: 64, type: 'sine',
            dur: 0.05, peak: 0.045 * p * v, pan: sp.pan, attack: 0.008,
        });
    }

    // Ore: the same bloom, plus a warm harmonic glow (fifths, not broken glass).
    oreBreak(x, y, tier = 1) {
        if (!this._ready() || !this._throttle('oreBreak', 80)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        const t = Math.max(1, Math.min(4, tier | 0));
        this._impact({ pan: sp.pan, v, sub: 68, body: 160, bodyTo: 80,
                       air: 500, weight: 0.36, dur: 0.16 });
        const base = 330 + t * 55;
        this._ring({
            freqs: [base, base * 1.5],
            dur: 0.22 + t * 0.03,
            peak: 0.07 * v,
            pan: sp.pan,
            delay: 0.03,
        });
    }

    // Gem: the one melodic beat. Soft bell, pentatonic chain, no hiss.
    gemPickup(combo = 0) {
        if (!this._ready() || !this._throttle('gem', 50)) return;
        const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        const st = steps[Math.min(combo, steps.length - 1)];
        const f  = 659.25 * Math.pow(2, st / 12);
        this._tone({ freq: f, type: 'sine', dur: 0.16, peak: 0.12, attack: 0.01 });
        this._tone({ freq: f * 1.5, type: 'sine', dur: 0.12, peak: 0.035, delay: 0.012, attack: 0.014 });
    }

    // Vault trickle: a tiny wooden clock tick.
    depositTick() {
        if (!this._ready() || !this._throttle('depositTick', 95)) return;
        this._tone({ freq: 246, glideTo: 196, type: 'sine', dur: 0.04, peak: 0.055, attack: 0.006 });
    }

    // Vault seals: warm low bloom + a major-third chime.
    depositDone() {
        if (!this._ready() || !this._throttle('depositDone', 400)) return;
        this._impact({ sub: 70, body: 132, bodyTo: 78, air: 380, weight: 0.38, dur: 0.18 });
        this._tone({ freq: 392, type: 'sine', dur: 0.28, peak: 0.09, delay: 0.08, attack: 0.02 });
        this._tone({ freq: 494, type: 'sine', dur: 0.26, peak: 0.055, delay: 0.14, attack: 0.024 });
    }

    // Satchel cap: two soft knocks, like knuckles on a desk.
    satchelFull() {
        if (!this._ready() || !this._throttle('satchelFull', 1500)) return;
        this._tone({ freq: 164, glideTo: 110, type: 'sine', dur: 0.09, peak: 0.14, attack: 0.008 });
        this._tone({ freq: 174, glideTo: 116, type: 'sine', dur: 0.11, peak: 0.16, delay: 0.14, attack: 0.008 });
    }

    // Death in view: size = weight of the bloom. Always muffled.
    die(x, y, size = 20) {
        if (!this._ready()) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        if (size <= 22) {
            if (!this._throttle('dieS', 70)) return;
            const v = sp.vol * this._busyGain();
            this._puff({ kind: 'brown', cut: 480, cutTo: 240, dur: 0.05,
                         peak: 0.06 * v, pan: sp.pan, attack: 0.012 });
        } else if (size <= 55) {
            if (!this._throttle('dieM', 100)) return;
            const v = sp.vol * this._busyGain();
            this._impact({ pan: sp.pan, v, sub: 80, body: 150, bodyTo: 90,
                           air: 400, weight: 0.26, dur: 0.12 });
        } else {
            if (!this._throttle('dieL', 150)) return;
            const v = sp.vol * this._busyGain();
            this._impact({ pan: sp.pan, v, sub: 58, body: 128, bodyTo: 64,
                           air: 360, weight: 0.4, dur: 0.2 });
        }
    }

    // Landed a hit: a rounded mid tick. Crits add a fifth, still in the mids.
    combatHit(tier = 0) {
        if (!this._ready() || !this._throttle('combatHit', 45)) return;
        const t = Math.max(0, Math.min(2, tier | 0));
        const v = this._busyGain();
        const f = 620 + t * 90;
        this._tone({ freq: f, glideTo: f * 0.82, type: 'sine',
                     dur: 0.055 + t * 0.015, peak: 0.09 * v, attack: 0.006 });
        this._puff({ kind: 'pink', cut: 900, cutTo: 520, Q: 0.7,
                     dur: 0.035, peak: 0.04 * v, attack: 0.008 });
        if (t >= 2) this._tone({ freq: f * 1.5, type: 'sine', dur: 0.07,
                                 peak: 0.035 * v, delay: 0.01, attack: 0.01 });
    }

    // Took a hit: cushioned thud, heavier with the chunk of life lost.
    combatHurt(frac = 0.3) {
        if (!this._ready() || !this._throttle('combatHurt', 60)) return;
        const f = Math.max(0.15, Math.min(1, frac));
        const v = this._busyGain();
        this._impact({
            v, sub: 62, body: 120 + 20 * f, bodyTo: 68,
            air: 340, weight: 0.22 + 0.22 * f, dur: 0.12 + f * 0.06,
        });
    }

    // You got the kill: deeper bloom + a short warm lift. Satisfying, not mean.
    combatKill() {
        if (!this._ready() || !this._throttle('combatKill', 180)) return;
        this._impact({ sub: 56, body: 138, bodyTo: 66, air: 380, weight: 0.48, dur: 0.2 });
        this._tone({ freq: 246, type: 'sine', dur: 0.16, peak: 0.08, delay: 0.05, attack: 0.016 });
        this._tone({ freq: 330, type: 'sine', dur: 0.2, peak: 0.05, delay: 0.1, attack: 0.02 });
    }

    // Banked a milestone: gold triad, slow attacks, no noise hit.
    bankCelebrate() {
        if (!this._ready() || !this._throttle('bankCelebrate', 400)) return;
        this._tone({ freq: 98, type: 'sine', dur: 0.18, peak: 0.1, attack: 0.016 });
        this._tone({ freq: 392, type: 'sine', dur: 0.28, peak: 0.1, delay: 0.04, attack: 0.02 });
        this._tone({ freq: 494, type: 'sine', dur: 0.3, peak: 0.07, delay: 0.1, attack: 0.024 });
        this._tone({ freq: 587, type: 'sine', dur: 0.34, peak: 0.045, delay: 0.16, attack: 0.03 });
    }
}

export const gameSound = new GameSound();
window.gameSound = gameSound;

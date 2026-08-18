// Dig Wars sound system — procedural foley, synthesized live.
//
// The design language is the modern-game "physical impact" (think
// Fortnite harvesting): every sound is a NOISE TRANSIENT shaped by a
// fast-closing lowpass filter (the "whud" of a real hit), plus a quiet
// damped material ring and scattered debris grains. Nothing is a musical
// note — no blips, no pews, no drums. Every call gets random variation
// so rapid fire never loops.
//
// Everything runs through one master compressor so a bullet-storm stays
// smooth instead of clipping into mess. All world-positioned sounds are
// attenuated by distance from the camera and lightly stereo-panned, with
// per-sound throttles and global busy-ducking.
//
// Console API: gameSound.setVolume(0..1), gameSound.mute()
import { global } from "./global.js";

const VOLUME_KEY = 'dw_soundVolume';

// MASTER KILL SWITCH — sound is disabled for now. Flip to true to bring
// the whole foley system back; every call site stays wired.
const SOUND_ENABLED = true;

class GameSound {
    constructor() {
        this.ctx     = null;
        this.master  = null;
        this._noise  = null;      // shared 1s noise buffer
        this._last   = {};        // per-name last-play time (throttle)
        this._recent = [];        // timestamps of recent plays (busy ducking)
        let v = parseFloat(localStorage.getItem(VOLUME_KEY));
        this.volume  = isNaN(v) ? 0.75 : v;
        this._hookGesture();
    }

    // Browsers only allow audio after a user gesture.
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
        // master gain -> gentle compressor -> out. The compressor is what
        // keeps overlapping sounds soft instead of harsh.
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value      = 24;
        comp.ratio.value     = 6;
        comp.attack.value    = 0.004;
        comp.release.value   = 0.18;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        // shared noise buffer
        const len = this.ctx.sampleRate;
        this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this._noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        localStorage.setItem(VOLUME_KEY, this.volume);
        if (this.master) this.master.gain.value = this.volume;
    }
    mute() { this.setVolume(0); }

    // ── internals ───────────────────────────────────────────────────────────
    _ready() { return this.ctx && this.ctx.state === 'running' && this.volume > 0; }

    // distance/pan from the camera; null = inaudible
    _spatial(x, y) {
        const lx = global.player ? global.player.renderx : 0;
        const ly = global.player ? global.player.rendery : 0;
        const dx = x - lx, dy = y - ly;
        const d  = Math.hypot(dx, dy);
        const MAXD = 3200;
        if (d > MAXD) return null;
        // smooth rolloff: full inside ~500, fading to 0 at MAXD
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

    // when lots of sounds fire at once, everything gets quieter together
    _busyGain() {
        const now = performance.now();
        this._recent = this._recent.filter(t => now - t < 220);
        this._recent.push(now);
        return 1 / Math.sqrt(Math.max(1, this._recent.length * 0.55));
    }

    _out(pan, when, dur, peak, attack = 0.005) {
        // gain envelope -> panner -> master; returns the gain node to feed
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(peak, when + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
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

    _tone({ freq, glideTo, type = 'sine', dur = 0.1, peak = 0.2, pan = 0, delay = 0, attack = 0.005 }) {
        const t0 = this.ctx.currentTime + delay;
        const o  = this.ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
        o.connect(this._out(pan, t0, dur, peak, attack));
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    _hiss({ dur = 0.08, peak = 0.15, lowpass = 900, pan = 0, delay = 0, attack = 0.004, rate = 1 }) {
        const t0 = this.ctx.currentTime + delay;
        const s  = this.ctx.createBufferSource();
        s.buffer = this._noise;
        s.playbackRate.value = rate;
        s.loop = true;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lowpass;
        f.Q.value = 0.6;
        s.connect(f);
        f.connect(this._out(pan, t0, dur, peak, attack));
        s.start(t0);
        s.stop(t0 + dur + 0.02);
    }

    // The physical impact: noise through a lowpass whose cutoff SLAMS shut.
    // This is how real hits sound — bright for a few milliseconds, then
    // instantly muffled. The backbone of every sound below.
    _thump({ cut0 = 2500, cut1 = 300, dur = 0.07, peak = 0.4, pan = 0, delay = 0 }) {
        const t0 = this.ctx.currentTime + delay;
        const s  = this.ctx.createBufferSource();
        s.buffer = this._noise;
        s.loop = true;
        s.playbackRate.value = 0.9 + Math.random() * 0.2;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 0.8;
        f.frequency.setValueAtTime(cut0 * (0.9 + Math.random() * 0.2), t0);
        f.frequency.exponentialRampToValueAtTime(Math.max(60, cut1), t0 + dur);
        s.connect(f);
        f.connect(this._out(pan, t0, dur, peak, 0.001));
        s.start(t0);
        s.stop(t0 + dur + 0.02);
    }

    // Quiet damped "material ring": a couple of inharmonic partials with a
    // very fast decay — the stony body under the noise, kept short and low
    // so it never reads as a drum or a note.
    _ring({ freqs = [180, 292], dur = 0.06, peak = 0.1, pan = 0, delay = 0 }) {
        const d = 0.96 + Math.random() * 0.08;
        for (let i = 0; i < freqs.length; i++) {
            this._tone({ freq: freqs[i] * d, type: 'sine', dur: dur * (1 - i * 0.2),
                         peak: peak / (i + 1), pan, delay, attack: 0.001 });
        }
    }

    // Debris: a scatter of tiny random noise taps trailing an impact.
    _grains({ n = 4, span = 0.2, cutLo = 500, cutHi = 1800, peak = 0.08, pan = 0, delay = 0 }) {
        for (let i = 0; i < n; i++) {
            this._hiss({ dur: 0.02 + Math.random() * 0.025,
                         peak: peak * (0.5 + Math.random() * 0.5),
                         lowpass: cutLo + Math.random() * (cutHi - cutLo),
                         pan: pan + (Math.random() - 0.5) * 0.2,
                         delay: delay + Math.random() * span, attack: 0.001 });
        }
    }


    // ── game sounds (world coordinates) ─────────────────────────────────────

    // Bullet chips a rock: a compact physical "chk" — bright noise snapping
    // shut over a faint stony ring, with a chip or two of debris. The ring
    // tightens (rises) as the rock's damage stage climbs, so progress is
    // audible but stays physical, never musical.
    rockHit(x, y, stage = 0, soft = false) {
        if (!this._ready() || !this._throttle('rockHit', soft ? 110 : 40)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain() * (soft ? 0.35 : 1);
        const st = 1 + stage * 0.1;
        this._thump({ cut0: 2600 * st, cut1: 350, dur: 0.055, peak: 0.55 * v, pan: sp.pan });
        this._ring({ freqs: [165 * st, 262 * st], dur: 0.055, peak: 0.09 * v, pan: sp.pan });
        this._grains({ n: 2, span: 0.06, cutLo: 700, cutHi: 2000, peak: 0.07 * v, pan: sp.pan, delay: 0.02 });
    }

    // Rock destroyed: a real crumble — a deep muffled crunch, a low body,
    // and a shower of debris grains settling over a quarter second.
    rockBreak(x, y) {
        if (!this._ready() || !this._throttle('rockBreak', 70)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        this._thump({ cut0: 2000, cut1: 140, dur: 0.13, peak: 0.6 * v, pan: sp.pan });
        this._thump({ cut0: 900, cut1: 110, dur: 0.16, peak: 0.35 * v, pan: sp.pan, delay: 0.05 });
        this._ring({ freqs: [95, 148], dur: 0.12, peak: 0.14 * v, pan: sp.pan });
        this._grains({ n: 7, span: 0.24, cutLo: 400, cutHi: 1600, peak: 0.11 * v, pan: sp.pan, delay: 0.04 });
    }

    // A gun fired somewhere in view: a soft muffled "thoop" — a small filter
    // snap with a whisper of low air. Texture, not an event.
    shoot(x, y, power = 1) {
        if (!this._ready() || !this._throttle('shoot', 55)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        const p = Math.min(1.6, 0.5 + (power || 1) * 0.5);
        this._thump({ cut0: 1000, cut1: 220, dur: 0.045, peak: 0.10 * p * v, pan: sp.pan });
        this._tone({ freq: 105, type: 'sine', dur: 0.04, peak: 0.03 * p * v, pan: sp.pan, attack: 0.002 });
    }

    // Ore rock destroyed: the usual crumble plus a glassy crystalline ring —
    // still physical (broken mineral, not a jingle), brighter per tier so a
    // shard find is audible across a tunnel.
    oreBreak(x, y, tier = 1) {
        if (!this._ready() || !this._throttle('oreBreak', 70)) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        const v = sp.vol * this._busyGain();
        this._thump({ cut0: 2200, cut1: 150, dur: 0.12, peak: 0.55 * v, pan: sp.pan });
        // inharmonic glassy partials — pitch and shimmer climb with the tier
        const base = 620 + tier * 240;
        this._ring({ freqs: [base, base * 1.53, base * 2.11], dur: 0.16 + tier * 0.04,
                     peak: 0.10 * v, pan: sp.pan, delay: 0.03 });
        this._grains({ n: 5 + tier * 2, span: 0.3, cutLo: 1200, cutHi: 4200,
                       peak: 0.09 * v, pan: sp.pan, delay: 0.05 });
    }

    // You picked up a gem. The one deliberately melodic sound in the game —
    // a tiny glass "plink" whose pitch climbs while you chain pickups, so
    // hoovering a fresh pile plays a little rising run. Local player only.
    gemPickup(combo = 0) {
        if (!this._ready()) return;
        if (!this._throttle('gem', 45)) return;
        // pentatonic steps keep any chain musical, capped an octave up
        const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        const st = steps[Math.min(combo, steps.length - 1)];
        const f  = 880 * Math.pow(2, st / 12);
        this._tone({ freq: f, type: 'sine', dur: 0.09, peak: 0.16, attack: 0.002 });
        this._tone({ freq: f * 2, type: 'sine', dur: 0.05, peak: 0.05, attack: 0.002 });
        this._hiss({ dur: 0.03, peak: 0.05, lowpass: 6000, attack: 0.001 });
    }

    // Vault channel running: a soft mechanical ratchet tick — the sound of
    // dust pouring into the bank, one notch at a time.
    depositTick() {
        if (!this._ready() || !this._throttle('depositTick', 90)) return;
        this._thump({ cut0: 1900, cut1: 500, dur: 0.025, peak: 0.10 });
        this._tone({ freq: 340, type: 'triangle', dur: 0.03, peak: 0.035, attack: 0.001 });
    }

    // Deposit complete: the vault seals — a heavy soft clunk with a warm
    // low chime. Wealth is safe now.
    depositDone() {
        if (!this._ready() || !this._throttle('depositDone', 400)) return;
        this._thump({ cut0: 1200, cut1: 90, dur: 0.14, peak: 0.5 });
        this._ring({ freqs: [110, 165], dur: 0.16, peak: 0.14 });
        this._tone({ freq: 440, type: 'sine', dur: 0.22, peak: 0.10, delay: 0.10, attack: 0.01 });
        this._tone({ freq: 660, type: 'sine', dur: 0.20, peak: 0.06, delay: 0.16, attack: 0.01 });
    }

    // Satchel hit the cap: a firm double knock, low and unmissable but calm.
    satchelFull() {
        if (!this._ready() || !this._throttle('satchelFull', 1500)) return;
        this._thump({ cut0: 900, cut1: 120, dur: 0.09, peak: 0.4 });
        this._thump({ cut0: 900, cut1: 120, dur: 0.11, peak: 0.45, delay: 0.13 });
        this._tone({ freq: 196, type: 'sine', dur: 0.12, peak: 0.08, delay: 0.13 });
    }

    // Something died in view. Size decides the weight of the impact — all
    // of them muffled physical hits, scaled from a flick to a soft whump.
    die(x, y, size = 20) {
        if (!this._ready()) return;
        const sp = this._spatial(x, y);
        if (!sp) return;
        if (size <= 22) {
            if (!this._throttle('dieS', 60)) return;
            const v = sp.vol * this._busyGain();
            this._thump({ cut0: 1600, cut1: 400, dur: 0.03, peak: 0.10 * v, pan: sp.pan });
        } else if (size <= 55) {
            if (!this._throttle('dieM', 90)) return;
            const v = sp.vol * this._busyGain();
            this._thump({ cut0: 1800, cut1: 250, dur: 0.07, peak: 0.32 * v, pan: sp.pan });
            this._ring({ freqs: [140, 215], dur: 0.06, peak: 0.07 * v, pan: sp.pan });
        } else {
            if (!this._throttle('dieL', 140)) return;
            const v = sp.vol * this._busyGain();
            this._thump({ cut0: 1400, cut1: 100, dur: 0.15, peak: 0.45 * v, pan: sp.pan });
            this._ring({ freqs: [80, 128], dur: 0.14, peak: 0.12 * v, pan: sp.pan });
            this._grains({ n: 4, span: 0.16, cutLo: 300, cutHi: 1000, peak: 0.09 * v, pan: sp.pan, delay: 0.04 });
        }
    }

    // You landed a hit. A bright tick that climbs with the tier so a
    // Critical! is a different sound from chip, without becoming a jingle.
    combatHit(tier = 0) {
        if (!this._ready() || !this._throttle('combatHit', 40)) return;
        const t = Math.max(0, Math.min(2, tier | 0));
        const v = this._busyGain();
        this._thump({ cut0: 3200 + t * 700, cut1: 700, dur: 0.028, peak: 0.16 * v });
        this._tone({ freq: 1560 + t * 420, type: 'sine', dur: 0.045 + t * 0.015, peak: 0.055 * v, attack: 0.001 });
        if (t >= 2) this._tone({ freq: 2340, type: 'triangle', dur: 0.06, peak: 0.04 * v, delay: 0.012, attack: 0.002 });
    }

    // You got hit. A muffled thud; heavier when the chunk of life is bigger.
    combatHurt(frac = 0.3) {
        if (!this._ready() || !this._throttle('combatHurt', 55)) return;
        const f = Math.max(0.15, Math.min(1, frac));
        const v = this._busyGain();
        this._thump({ cut0: 900, cut1: 90, dur: 0.08 + f * 0.05, peak: (0.18 + 0.28 * f) * v });
        this._tone({ freq: 90 + 40 * f, type: 'sine', dur: 0.07, peak: 0.05 * f * v, attack: 0.002 });
    }

    // You killed someone. A heavier slam plus a short rising sting.
    combatKill() {
        if (!this._ready() || !this._throttle('combatKill', 180)) return;
        this._thump({ cut0: 1800, cut1: 80, dur: 0.16, peak: 0.55 });
        this._thump({ cut0: 900, cut1: 70, dur: 0.2, peak: 0.32, delay: 0.04 });
        this._tone({ freq: 220, type: 'sine', dur: 0.12, peak: 0.1, attack: 0.002 });
        this._tone({ freq: 330, type: 'triangle', dur: 0.16, peak: 0.07, delay: 0.05, attack: 0.004 });
    }

    // Banked a milestone. Warm gold hit, not a jingle.
    bankCelebrate() {
        if (!this._ready() || !this._throttle('bankCelebrate', 400)) return;
        this._thump({ cut0: 1600, cut1: 110, dur: 0.14, peak: 0.45 });
        this._tone({ freq: 392, type: 'sine', dur: 0.22, peak: 0.12, attack: 0.006 });
        this._tone({ freq: 523, type: 'sine', dur: 0.24, peak: 0.09, delay: 0.06, attack: 0.008 });
        this._tone({ freq: 784, type: 'sine', dur: 0.28, peak: 0.06, delay: 0.12, attack: 0.01 });
    }
}

export const gameSound = new GameSound();
window.gameSound = gameSound;

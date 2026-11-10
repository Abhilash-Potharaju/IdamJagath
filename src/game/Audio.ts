import type { Vector3 } from "@babylonjs/core";
import { Feel, Shake } from "./feel";

/**
 * Every sound the game can request. This list is the contract between gameplay code and the audio system.
 */
export type SoundName =
  // weapons / player
  | "vajra_fire" | "trishul_fire" | "reload" | "switch" | "hit" | "player_hurt" | "pickup" | "secret"
  // enemies
  | "crawler_windup" | "crawler_lunge" | "crawler_bite"
  | "spitter_charge" | "spitter_spit" | "glob_splash"
  | "warden_land" | "warden_roar" | "warden_charge" | "warden_impact" | "warden_stun" | "warden_death"
  | "enemy_hurt" | "enemy_death"
  // world / mission
  | "pylon_hit" | "pylon_explode" | "alarm" | "cage_open" | "captives_freed" | "win" | "lose"
  // game feel
  | "footstep" | "footstep_run" | "land" | "heartbeat" | "shell_drop" | "impact_stone" | "impact_flesh" | "kill_confirm";

const MAX_VOICES = 4; // per sound name
const MAX_DIST = 60;

type Recipe = (s: Synth, t: number) => number; // returns duration in seconds

/** Small helper bound to one output node: builds oscillators / noise with envelopes. */
class Synth {
  readonly ctx: AudioContext;
  readonly out: AudioNode;
  readonly noiseBuf: AudioBuffer;
  readonly pitch: number; // random per-play pitch multiplier
  private distCurve: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, out: AudioNode, noiseBuf: AudioBuffer, distCurve: Float32Array<ArrayBuffer>) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuf = noiseBuf;
    this.distCurve = distCurve;
    this.pitch = 1 + (Math.random() - 0.5) * 0.12;
  }

  /** Gain envelope: quick attack, exponential decay to silence at t + dur. */
  env(vol: number, t: number, dur: number, attack = 0.004, dest: AudioNode = this.out): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    return g;
  }

  /** Oscillator with an exponential pitch sweep from f0 to f1. */
  tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number,
    opts: { attack?: number; dest?: AudioNode; detune?: number } = {}): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0 * this.pitch), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.pitch), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    o.connect(this.env(vol, t, dur, opts.attack, opts.dest));
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  /** Filtered noise burst with a sweeping filter frequency. */
  noise(t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number,
    opts: { q?: number; attack?: number; dest?: AudioNode } = {}): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    src.connect(f);
    f.connect(this.env(vol, t, dur, opts.attack, opts.dest));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** A distortion node feeding the output; route sources into it for grit. */
  dirt(amount = 1): AudioNode {
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.distCurve;
    ws.oversample = "2x";
    const g = this.ctx.createGain();
    g.gain.value = 0.6 / amount;
    ws.connect(g);
    g.connect(this.out);
    const pre = this.ctx.createGain();
    pre.gain.value = amount;
    pre.connect(ws);
    return pre;
  }

  /** Amplitude-modulated (tremolo) tone: chittering, warbles, sirens. */
  trem(type: OscillatorType, f0: number, f1: number, rate: number, t: number, dur: number, vol: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * this.pitch, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.pitch), t + dur);
    const am = this.ctx.createGain();
    am.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = rate;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG);
    lfoG.connect(am.gain);
    o.connect(am);
    am.connect(this.env(vol, t, dur));
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
}

// ───────────────────────── sound recipes ─────────────────────────
const R: Record<SoundName, Recipe> = {
  footstep: (s, t) => {
    s.noise(t, 0.07, 0.35, "lowpass", 900 + Math.random() * 300, 200);
    s.noise(t, 0.025, 0.12, "bandpass", 2400 + Math.random() * 800, 1600, { q: 3 });
    s.tone("sine", 95, 60, t, 0.06, 0.18);
    return 0.09;
  },
  footstep_run: (s, t) => {
    s.noise(t, 0.08, 0.55, "lowpass", 1200 + Math.random() * 300, 220);
    s.noise(t, 0.03, 0.2, "bandpass", 2800 + Math.random() * 800, 1800, { q: 3 });
    s.tone("sine", 105, 55, t, 0.07, 0.25);
    return 0.1;
  },
  land: (s, t) => {
    s.noise(t, 0.16, 0.7, "lowpass", 700, 90);
    s.tone("sine", 85, 40, t, 0.18, 0.5);
    return 0.2;
  },
  heartbeat: (s, t) => {
    s.tone("sine", 62, 40, t, 0.12, 0.55);
    s.tone("sine", 58, 38, t + 0.2, 0.14, 0.45);
    return 0.4;
  },
  shell_drop: (s, t) => {
    for (const [dt, f] of [[0, 3800], [0.07, 4600], [0.13, 3400]] as const) s.tone("triangle", f, f * 0.96, t + dt, 0.05, 0.05);
    return 0.2;
  },
  impact_stone: (s, t) => {
    s.noise(t, 0.05, 0.3, "bandpass", 2200 + Math.random() * 1200, 900, { q: 2 });
    s.noise(t, 0.12, 0.12, "lowpass", 900, 200);
    return 0.13;
  },
  impact_flesh: (s, t) => {
    s.noise(t, 0.09, 0.35, "lowpass", 700, 160);
    s.tone("sine", 260, 120, t, 0.08, 0.14);
    return 0.11;
  },
  kill_confirm: (s, t) => {
    s.tone("square", 1500, 1500, t, 0.04, 0.08);
    s.tone("square", 2100, 2100, t + 0.05, 0.07, 0.08);
    return 0.13;
  },
  vajra_fire: (s, t) => {
    s.tone("square", 1400, 180, t, 0.13, 0.22);
    s.tone("sawtooth", 700, 90, t, 0.1, 0.12, { dest: s.dirt(2) });
    s.noise(t, 0.06, 0.25, "highpass", 3000, 1200);
    return 0.15;
  },
  trishul_fire: (s, t) => {
    const d = s.dirt(4);
    s.noise(t, 0.08, 0.7, "bandpass", 2500, 600, { q: 0.7, dest: d });
    s.noise(t, 0.45, 0.6, "lowpass", 1800, 120);
    s.tone("sine", 140, 38, t, 0.4, 0.9);
    s.tone("square", 90, 40, t, 0.18, 0.25, { dest: d });
    return 0.5;
  },
  reload: (s, t) => {
    for (const [dt, f] of [[0, 2200], [0.18, 1600], [0.55, 2600], [0.7, 1900]] as const) {
      s.noise(t + dt, 0.04, 0.35, "bandpass", f, f * 0.8, { q: 6 });
      s.tone("square", f / 4, f / 6, t + dt, 0.03, 0.06);
    }
    return 0.8;
  },
  switch: (s, t) => {
    s.noise(t, 0.05, 0.3, "bandpass", 3200, 2000, { q: 5 });
    s.tone("triangle", 900, 500, t + 0.02, 0.06, 0.12);
    return 0.1;
  },
  hit: (s, t) => {
    s.tone("square", 2600, 2200, t, 0.035, 0.12);
    return 0.05;
  },
  player_hurt: (s, t) => {
    s.noise(t, 0.18, 0.5, "lowpass", 600, 100);
    s.tone("sawtooth", 160, 85, t, 0.22, 0.25, { dest: s.dirt(2) });
    return 0.25;
  },
  pickup: (s, t) => {
    [660, 880, 1320].forEach((f, i) => s.tone("triangle", f, f * 1.02, t + i * 0.07, 0.18, 0.2));
    return 0.4;
  },
  secret: (s, t) => {
    [523, 659, 784, 1046, 1318].forEach((f, i) => s.tone("sine", f, f, t + i * 0.11, 0.6, 0.18, { attack: 0.02 }));
    s.noise(t, 1.0, 0.06, "highpass", 6000, 9000, { attack: 0.3 });
    return 1.2;
  },
  crawler_windup: (s, t) => {
    s.trem("sawtooth", 500, 900, 38, t, 0.45, 0.18);
    s.noise(t, 0.45, 0.12, "bandpass", 3000, 5000, { q: 4, attack: 0.1 });
    return 0.5;
  },
  crawler_lunge: (s, t) => {
    s.noise(t, 0.3, 0.35, "highpass", 2500, 5000, { attack: 0.02 });
    s.tone("sawtooth", 900, 300, t, 0.25, 0.14);
    return 0.3;
  },
  crawler_bite: (s, t) => {
    s.noise(t, 0.05, 0.5, "bandpass", 1800, 900, { q: 3 });
    s.noise(t + 0.06, 0.05, 0.4, "bandpass", 1500, 800, { q: 3 });
    s.tone("square", 220, 120, t, 0.08, 0.1);
    return 0.15;
  },
  spitter_charge: (s, t) => {
    s.trem("sine", 120, 420, 22, t, 0.6, 0.3);
    s.noise(t, 0.6, 0.12, "bandpass", 300, 1200, { q: 6, attack: 0.2 });
    return 0.65;
  },
  spitter_spit: (s, t) => {
    s.noise(t, 0.2, 0.45, "bandpass", 1200, 300, { q: 2 });
    s.tone("sine", 300, 90, t, 0.18, 0.35);
    return 0.22;
  },
  glob_splash: (s, t) => {
    s.noise(t, 0.08, 0.35, "lowpass", 900, 300);
    s.noise(t + 0.03, 0.6, 0.2, "highpass", 5000, 8000, { attack: 0.03 });
    return 0.65;
  },
  warden_land: (s, t) => {
    s.tone("sine", 90, 25, t, 1.0, 1.0);
    s.noise(t, 0.9, 0.7, "lowpass", 900, 60, { dest: s.dirt(3) });
    return 1.0;
  },
  warden_roar: (s, t) => {
    const d = s.dirt(3);
    for (const det of [-14, 0, 11]) s.tone("sawtooth", 70, 52, t, 1.1, 0.22, { attack: 0.12, dest: d, detune: det });
    s.trem("sawtooth", 140, 95, 13, t, 1.1, 0.12);
    s.noise(t, 1.1, 0.3, "bandpass", 500, 250, { q: 1.5, attack: 0.15 });
    return 1.15;
  },
  warden_charge: (s, t) => {
    for (let i = 0; i < 8; i++) {
      s.tone("sine", 70, 35, t + i * 0.22, 0.18, 0.7);
      s.noise(t + i * 0.22, 0.12, 0.3, "lowpass", 400, 80);
    }
    return 1.9;
  },
  warden_impact: (s, t) => {
    const d = s.dirt(4);
    s.noise(t, 0.7, 0.9, "lowpass", 3000, 80, { dest: d });
    s.tone("sine", 110, 30, t, 0.8, 1.0);
    s.noise(t + 0.05, 0.4, 0.3, "bandpass", 2400, 900, { q: 4 });
    return 0.85;
  },
  warden_stun: (s, t) => {
    for (let i = 0; i < 6; i++) s.tone("sine", i % 2 ? 900 : 700, i % 2 ? 650 : 950, t + i * 0.18, 0.2, 0.12);
    return 1.2;
  },
  warden_death: (s, t) => {
    const d = s.dirt(3);
    for (const det of [-20, 0, 15]) s.tone("sawtooth", 95, 30, t, 2.2, 0.22, { attack: 0.1, dest: d, detune: det });
    s.noise(t, 2.0, 0.3, "bandpass", 700, 120, { q: 1.2, attack: 0.1 });
    s.tone("sine", 80, 22, t + 1.6, 1.0, 1.0);
    s.noise(t + 1.6, 1.0, 0.8, "lowpass", 1200, 60);
    return 2.7;
  },
  enemy_hurt: (s, t) => {
    s.noise(t, 0.08, 0.3, "bandpass", 900, 400, { q: 3 });
    s.tone("sine", 400, 220, t, 0.07, 0.12);
    return 0.1;
  },
  enemy_death: (s, t) => {
    s.noise(t, 0.12, 0.5, "lowpass", 1500, 200);
    s.tone("sawtooth", 1100, 180, t, 0.35, 0.16, { dest: s.dirt(2) });
    s.noise(t + 0.05, 0.4, 0.15, "highpass", 4000, 7000);
    return 0.45;
  },
  pylon_hit: (s, t) => {
    s.noise(t, 0.07, 0.25, "highpass", 4000, 2000);
    s.tone("square", 1800 + Math.random() * 900, 600, t, 0.06, 0.06);
    return 0.08;
  },
  pylon_explode: (s, t) => {
    const d = s.dirt(4);
    s.noise(t, 1.4, 0.9, "lowpass", 4000, 60, { dest: d });
    s.tone("sine", 120, 28, t, 1.3, 1.0);
    s.trem("square", 2400, 300, 45, t, 0.9, 0.08);
    s.tone("sawtooth", 1600, 60, t, 0.9, 0.12);
    return 1.5;
  },
  alarm: (s, t) => {
    for (let i = 0; i < 5; i++) {
      s.tone("square", 740, 740, t + i * 0.5, 0.25, 0.12, { attack: 0.02 });
      s.tone("square", 520, 520, t + i * 0.5 + 0.25, 0.25, 0.12, { attack: 0.02 });
    }
    return 2.6;
  },
  cage_open: (s, t) => {
    s.noise(t, 0.3, 0.6, "bandpass", 900, 300, { q: 2, dest: s.dirt(3) });
    s.tone("sine", 160, 60, t, 0.35, 0.6);
    s.tone("sine", 300, 1800, t + 0.15, 0.9, 0.15, { attack: 0.1 });
    s.noise(t + 0.15, 0.9, 0.12, "highpass", 3000, 9000, { attack: 0.1 });
    return 1.1;
  },
  captives_freed: (s, t) => {
    [392, 523, 659, 784, 1046].forEach((f, i) => s.tone("triangle", f, f * 1.5, t + i * 0.06, 0.8, 0.12, { attack: 0.03 }));
    s.noise(t, 1.2, 0.1, "highpass", 5000, 10000, { attack: 0.2 });
    return 1.3;
  },
  win: (s, t) => {
    [[523, 0], [659, 0.15], [784, 0.3], [1046, 0.5]].forEach(([f, dt]) => {
      s.tone("square", f, f, t + dt, dt === 0.5 ? 1.0 : 0.2, 0.12, { attack: 0.01 });
      s.tone("triangle", f / 2, f / 2, t + dt, dt === 0.5 ? 1.0 : 0.2, 0.15);
    });
    return 1.6;
  },
  lose: (s, t) => {
    [[392, 0], [349, 0.3], [311, 0.6], [196, 0.9]].forEach(([f, dt]) => {
      s.tone("sawtooth", f, f * 0.97, t + dt, dt === 0.9 ? 1.4 : 0.32, 0.1, { attack: 0.02 });
      s.tone("sine", f / 2, f / 2, t + dt, dt === 0.9 ? 1.4 : 0.32, 0.2);
    });
    return 2.4;
  },
};

/** Base loudness per sound (before distance falloff). */
const VOLUME: Partial<Record<SoundName, number>> = {
  vajra_fire: 0.55, hit: 0.6, pylon_hit: 0.5, enemy_hurt: 0.6, alarm: 0.7, warden_roar: 1.0, warden_death: 1.0,
  footstep: 0.32, footstep_run: 0.42, land: 0.6, heartbeat: 0.9, shell_drop: 0.25, impact_stone: 0.4, impact_flesh: 0.5, kill_confirm: 0.55,
};

/** Camera-shake trauma added when these sounds play (scaled by distance for positioned sounds). */
const SHAKE: Partial<Record<SoundName, number>> = {
  trishul_fire: 0.2, vajra_fire: 0.025, pylon_explode: 0.55, warden_land: 0.65, warden_impact: 0.45, warden_charge: 0.12,
  cage_open: 0.15, warden_death: 0.4,
};

/** Synthesizes every game sound at runtime with the Web Audio API: no files, no libraries. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private distCurve!: Float32Array<ArrayBuffer>;
  private voices = new Map<SoundName, number>();
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  muted = false;

  constructor() {
    Feel.on("footstep", (e) => this.play(e.sprint ? "footstep_run" : "footstep"));
    Feel.on("land", (e) => { if (e.strength > 0.05) this.play("land"); });
    Feel.on("heartbeat", () => this.play("heartbeat"));
  }

  /** Play a sound; `at` = world position for distance falloff/panning (omit for UI/player sounds). */
  play(name: SoundName, at?: Vector3): void {
    const shake = SHAKE[name];
    if (shake) {
      let k = 1;
      if (at) k = Math.max(0, 1 - Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z) / 40);
      if (k > 0) Shake.add(shake * k);
    }
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== "running") return;
    const n = this.voices.get(name) ?? 0;
    if (n >= MAX_VOICES) return;

    let gain = (VOLUME[name] ?? 0.8) * (0.9 + Math.random() * 0.2);
    let pan = 0;
    if (at) {
      const dx = at.x - this.listener.x, dy = at.y - this.listener.y, dz = at.z - this.listener.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= MAX_DIST) return;
      gain *= Math.pow(1 - dist / MAX_DIST, 2) / (1 + dist * 0.04);
      if (dist > 0.5) {
        const yaw = this.listener.yaw;
        const right = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.hypot(dx, dz || 1e-6);
        pan = Math.max(-0.85, Math.min(0.85, right * 0.85));
      }
    }
    if (gain < 0.01) return;

    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(this.sfx);
    panner.connect(this.reverbIn);

    const dur = R[name](new Synth(ctx, out, this.noiseBuf, this.distCurve), t);
    this.voices.set(name, n + 1);
    window.setTimeout(() => {
      this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      out.disconnect();
      panner.disconnect();
    }, (dur + 0.3) * 1000);
  }

  /** Called every frame with the listener (camera) position and yaw. */
  update(listener: Vector3, yaw: number): void {
    this.listener.x = listener.x;
    this.listener.y = listener.y;
    this.listener.z = listener.z;
    this.listener.yaw = yaw;
  }

  /** Must be called from a user gesture (browser autoplay rules). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Toggle mute; returns true when sound is now ON. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
    return !this.muted;
  }

  get state(): string {
    return this.ctx?.state ?? "uninitialised";
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // master → limiter → speakers
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(limiter);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);

    // Short dark reverb (generated impulse) for a sense of stone streets
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(ctx, 1.6, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master);

    // Cached 2 s white-noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Soft-clip distortion curve
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    this.distCurve = curve;

    this.startAmbience();
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Low eerie drone (detuned alien hum) + distant wind, looping forever at low volume. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const amb = ctx.createGain();
    amb.gain.setValueAtTime(0, ctx.currentTime);
    amb.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 3);
    amb.connect(this.master);

    // Hum: detuned low oscillators through a slowly sweeping low-pass
    const hum = ctx.createBiquadFilter();
    hum.type = "lowpass";
    hum.frequency.value = 260;
    hum.Q.value = 4;
    hum.connect(amb);
    for (const [type, f, v] of [["sawtooth", 55, 0.18], ["sawtooth", 55.6, 0.18], ["sine", 82.4, 0.25], ["triangle", 110.3, 0.06]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      o.connect(g);
      g.connect(hum);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 140;
    lfo.connect(lfoG);
    lfoG.connect(hum.frequency);
    lfo.start();

    // Wind: band-passed noise with slowly wandering level and centre
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const windG = ctx.createGain();
    windG.gain.value = 0.35;
    src.connect(bp);
    bp.connect(windG);
    windG.connect(amb);
    src.start();
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.11;
    const wlG = ctx.createGain();
    wlG.gain.value = 0.22;
    wl.connect(wlG);
    wlG.connect(windG.gain);
    wl.start();
    const wf = ctx.createOscillator();
    wf.frequency.value = 0.05;
    const wfG = ctx.createGain();
    wfG.gain.value = 250;
    wf.connect(wfG);
    wfG.connect(bp.frequency);
    wf.start();
  }
}

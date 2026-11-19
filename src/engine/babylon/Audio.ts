
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
  | "footstep" | "footstep_run" | "land" | "heartbeat" | "shell_drop" | "impact_stone" | "impact_flesh" | "kill_confirm"
  // reload phases (WeaponView), creature presence (CreatureAudio)
  | "vajra_mag_out" | "vajra_mag_in" | "vajra_bolt" | "trishul_shell" | "trishul_pump"
  | "crawler_idle" | "spitter_idle" | "spitter_death" | "warden_idle" | "warden_step";

/**
 * File-only layers (no synth recipe): a gunshot is crack + body + space-dependent tail (+ distant echo in the open).
 * When a weapon's crack layer isn't loaded, its single synth/file sound plays instead.
 */
type LayerName = "vajra_crack" | "vajra_body" | "trishul_crack" | "trishul_body" | "gun_tail_lane" | "gun_tail_plaza" | "gun_echo";
const GUN_LAYERS: Partial<Record<SoundName, { crack: LayerName; body: LayerName; gain: number; tail: number; tailRate: number; echo: number }>> = {
  vajra_fire: { crack: "vajra_crack", body: "vajra_body", gain: 0.62, tail: 0.5, tailRate: 1, echo: 0.3 },
  trishul_fire: { crack: "trishul_crack", body: "trishul_body", gain: 0.85, tail: 0.75, tailRate: 0.86, echo: 0.45 },
};

const MAX_VOICES = 4; // per sound name
const MAX_DIST = 60;

type Recipe = (s: Synth, t: number) => number; // returns duration in seconds

/** Per-play pitch variation (±6%) so repeats don't sound robotic. Applied to both synth and file playback. */
function randomPitch(): number {
  return 1 + (Math.random() - 0.5) * 0.12;
}

/** Every sound name, in a stable order (used for loading and exporting). */
export const SOUND_NAMES = [
  "vajra_fire", "trishul_fire", "reload", "switch", "hit", "player_hurt", "pickup", "secret",
  "crawler_windup", "crawler_lunge", "crawler_bite", "spitter_charge", "spitter_spit", "glob_splash",
  "warden_land", "warden_roar", "warden_charge", "warden_impact", "warden_stun", "warden_death",
  "enemy_hurt", "enemy_death", "pylon_hit", "pylon_explode", "alarm", "cage_open", "captives_freed", "win", "lose",
  "footstep", "footstep_run", "land", "heartbeat", "shell_drop", "impact_stone", "impact_flesh", "kill_confirm",
  "vajra_mag_out", "vajra_mag_in", "vajra_bolt", "trishul_shell", "trishul_pump",
  "crawler_idle", "spitter_idle", "spitter_death", "warden_idle", "warden_step",
] as const satisfies readonly SoundName[];
const LAYER_NAMES: readonly string[] = ["vajra_crack", "vajra_body", "trishul_crack", "trishul_body", "gun_tail_lane", "gun_tail_plaza", "gun_echo"] satisfies readonly LayerName[];

/**
 * Audio files: in-house renders of the recipes (tools/dev/export_audio.mjs) and Freesound-built sounds
 * (tools/audio/build.mjs → public/audio/fs/). ?synthaudio forces live synthesis.
 */
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;
const USE_FILES = !new URLSearchParams(location.search).has("synthaudio");
/** Manifest entry: `files` = random variants (older manifests have just `file`); `sources` = Freesound provenance. */
interface AudioManifest { sounds: { name: string; file: string; files?: string[]; duration: number; sources?: unknown[] }[]; ambience?: { file: string; duration: number } }

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function makeDistCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 3);
  }
  return curve;
}

/** 16-bit PCM WAV encoding (mono or stereo). */
function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, chans[c][i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
  }
  return out;
}

function toBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Small helper bound to one output node: builds oscillators / noise with envelopes. */
class Synth {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly noiseBuf: AudioBuffer;
  readonly pitch: number; // random per-play pitch multiplier
  private distCurve: Float32Array<ArrayBuffer>;

  constructor(ctx: BaseAudioContext, out: AudioNode, noiseBuf: AudioBuffer, distCurve: Float32Array<ArrayBuffer>, pitch?: number) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuf = noiseBuf;
    this.distCurve = distCurve;
    this.pitch = pitch ?? randomPitch();
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

/** Short mechanical clicks (synth fallback for the reload phases). */
function clicks(s: Synth, t: number, at: readonly (readonly [number, number])[]): void {
  for (const [dt, f] of at) {
    s.noise(t + dt, 0.04, 0.35, "bandpass", f, f * 0.8, { q: 6 });
    s.tone("square", f / 4, f / 6, t + dt, 0.03, 0.06);
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
  // The core's reload cue is silent: WeaponView plays per-weapon phases (mag out / in, bolt…) in time with the motion.
  reload: () => 0,
  vajra_mag_out: (s, t) => { clicks(s, t, [[0, 2200], [0.07, 1600]]); return 0.15; },
  vajra_mag_in: (s, t) => { clicks(s, t, [[0, 2600]]); s.noise(t, 0.06, 0.25, "lowpass", 900, 200); return 0.1; },
  vajra_bolt: (s, t) => { clicks(s, t, [[0, 1900], [0.11, 2500]]); return 0.18; },
  trishul_shell: (s, t) => { clicks(s, t, [[0, 1700]]); return 0.08; },
  trishul_pump: (s, t) => {
    s.noise(t, 0.12, 0.2, "bandpass", 1200, 2600, { q: 2 });
    clicks(s, t, [[0.02, 1500], [0.16, 2100]]);
    return 0.25;
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
  crawler_idle: (s, t) => {
    s.trem("sawtooth", 700, 520, 31, t, 0.35, 0.1);
    s.noise(t, 0.3, 0.06, "bandpass", 3500, 2500, { q: 5, attack: 0.05 });
    return 0.4;
  },
  spitter_idle: (s, t) => {
    s.trem("sine", 180, 120, 17, t, 0.5, 0.2);
    s.noise(t, 0.5, 0.08, "bandpass", 500, 300, { q: 5, attack: 0.1 });
    return 0.55;
  },
  spitter_death: (s, t) => {
    s.trem("sine", 260, 70, 14, t, 0.8, 0.25);
    s.noise(t, 0.7, 0.15, "lowpass", 900, 150);
    return 0.85;
  },
  warden_idle: (s, t) => {
    const d = s.dirt(2);
    for (const det of [-12, 9]) s.tone("sawtooth", 62, 50, t, 0.9, 0.12, { attack: 0.15, dest: d, detune: det });
    return 0.95;
  },
  warden_step: (s, t) => {
    s.tone("sine", 70, 35, t, 0.2, 0.7);
    s.noise(t, 0.14, 0.35, "lowpass", 450, 80);
    return 0.25;
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

/** Base loudness per sound (before distance falloff), as tuned for the synth recipes / in-house files. */
const VOLUME: Partial<Record<SoundName, number>> = {
  vajra_fire: 0.55, hit: 0.6, pylon_hit: 0.5, enemy_hurt: 0.6, alarm: 0.7, warden_roar: 1.0, warden_death: 1.0,
  footstep: 0.32, footstep_run: 0.42, land: 0.6, heartbeat: 0.9, shell_drop: 0.25, impact_stone: 0.4, impact_flesh: 0.5, kill_confirm: 0.55,
};

/** Loudness of the Freesound-built files (tools/audio/build.mjs normalises them, so they need their own mix). */
const FILE_VOLUME: Partial<Record<SoundName, number>> = {
  hit: 0.3, switch: 0.55, shell_drop: 0.32, impact_stone: 0.8, impact_flesh: 0.75, kill_confirm: 0.8, player_hurt: 0.85,
  vajra_mag_out: 0.6, vajra_mag_in: 0.7, vajra_bolt: 0.7, trishul_shell: 0.6, trishul_pump: 0.8,
  crawler_idle: 0.75, crawler_windup: 0.9, crawler_lunge: 0.95, crawler_bite: 0.9, enemy_hurt: 0.75, enemy_death: 1.0,
  spitter_idle: 0.8, spitter_charge: 0.9, spitter_spit: 0.9, glob_splash: 0.8, spitter_death: 0.85,
  warden_idle: 1.0, warden_step: 1.0, warden_roar: 1.1, warden_charge: 1.1, warden_land: 1.1, warden_impact: 1.1, warden_stun: 1.0, warden_death: 1.1,
};

/** Per-name voice limits that differ from MAX_VOICES (fast-firing layers, pellet impacts, tails that get cut). */
const VOICES: Partial<Record<string, number>> = {
  vajra_crack: 6, vajra_body: 6, impact_stone: 6, impact_flesh: 5, gun_tail_lane: 8, gun_tail_plaza: 8, gun_echo: 8, warden_step: 3,
};

type Vec = { x: number; y: number; z: number };
/** Distance to the first surface along `dir` from `from`, or null if nothing within `range` (engine raycast). */
export type SpaceProbe = (from: Vec, dir: Vec, range: number) => number | null;
/** True when solid geometry blocks the straight line between the two points. */
export type OcclusionTest = (from: Vec, to: Vec) => boolean;

const PROBE_RANGE = 40;
const PROBE_INTERVAL = 0.25; // s

function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

// (Camera shake that some sounds carry is gameplay-relevant (it moves the aim) and lives in the core: world.ts SOUND_SHAKE.)

/**
 * Game audio. Plays the files in public/audio/ (see public/audio/manifest.json: in-house renders + Freesound-built
 * sounds with random variants), with per-sound gain, distance falloff, air absorption, occlusion muffling, HRTF 3D
 * panning, voice limits, pitch variation and a shared reverb. Gunshots are layered (crack + body + a tail chosen by
 * how open the space around the player is, + a distant echo in the open). The Web Audio synth recipes remain the
 * fallback for anything not loaded (and the source the in-house files were rendered from).
 */
export class Audio {
  private buffers = new Map<string, AudioBuffer[]>();
  /** Names whose loaded files are Freesound-built (use FILE_VOLUME). */
  private sourced = new Set<string>();
  private ambienceBuffer: AudioBuffer | null = null;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private distCurve!: Float32Array<ArrayBuffer>;
  private voices = new Map<string, number>();
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Current gun tails per weapon sound (cut when the next shot starts its own). */
  private tails = new Map<string, { src: AudioBufferSourceNode; input: GainNode }[]>();
  /** 0 = tight lane / enclosed, 1 = open plaza (smoothed; from `spaceProbe`). */
  openness = 0.5;
  /** Set by the composition root: engine raycast for measuring the space around the listener. */
  spaceProbe: SpaceProbe | null = null;
  /** Set by the composition root: line-of-sight test for muffling sounds behind walls. */
  occlusion: OcclusionTest | null = null;
  private probeAt = -1;
  private probeIdx = 0;
  muted = false;
  // Volume buses (Settings): master × (sfx | music). Base levels below are the mix the game was tuned with.
  private vol = { master: 1, sfx: 1, music: 1 };
  private ambGain: GainNode | null = null;
  private static readonly BASE = { master: 0.9, sfx: 0.8, music: 0.11 };

  /** Set bus volumes 0..1 (applied smoothly; safe before the audio context exists). */
  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.vol = { master: v.master, sfx: v.sfx, music: v.music };
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : Audio.BASE.master * v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(Audio.BASE.sfx * v.sfx, t, 0.05);
    this.ambGain?.gain.setTargetAtTime(Audio.BASE.music * v.music, t, 0.2);
  }

  /** Play a sound; `at` = world position for distance falloff/panning (omit for UI/player sounds). */
  play(name: SoundName, at?: Vec): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== "running") return;
    const gun = GUN_LAYERS[name];
    if (gun && this.buffers.has(gun.crack) && this.buffers.has(gun.body)) { this.playGun(name, gun); return; }

    const variants = this.buffers.get(name);
    const base = (variants && this.sourced.has(name) ? FILE_VOLUME[name] : undefined) ?? VOLUME[name] ?? 0.8;
    const r = this.route(name, base, at);
    if (!r) return;
    const t = ctx.currentTime + 0.005;
    if (variants) {
      this.startBuffer(name, pick(variants), r, randomPitch(), t);
    } else {
      const dur = R[name](new Synth(ctx, r.input, this.noiseBuf, this.distCurve), t);
      window.setTimeout(() => this.release(name, r.nodes), (dur + 0.3) * 1000);
    }
  }

  /**
   * One voice's signal chain: input gain → [air-absorption / occlusion low-pass → HRTF panner] → sfx bus + reverb send.
   * Returns null when the voice limit is reached or it would be inaudible.
   */
  private route(name: string, base: number, at?: Vec, wet = 1): { input: GainNode; nodes: AudioNode[] } | null {
    const ctx = this.ctx!;
    const n = this.voices.get(name) ?? 0;
    if (n >= (VOICES[name] ?? MAX_VOICES)) return null;
    let gain = base * (0.9 + Math.random() * 0.2);
    const input = ctx.createGain();
    const nodes: AudioNode[] = [input];
    let last: AudioNode = input;
    if (at) {
      const L = this.listener;
      const dx = at.x - L.x, dy = at.y - L.y, dz = at.z - L.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= MAX_DIST) return null;
      gain *= Math.pow(1 - dist / MAX_DIST, 2) / (1 + dist * 0.04);
      if (gain < 0.01) return null;
      // Air absorption (highs fade with distance) and occlusion (a wall in between muffles and lowers it)
      let cutoff = 22000 * Math.pow(0.5, dist / 14);
      if (dist > 2.5 && this.occlusion?.(L, at)) { cutoff = Math.min(cutoff, 650); gain *= 0.55; }
      if (cutoff < 15000) {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = Math.max(300, cutoff);
        last.connect(f); last = f; nodes.push(f);
      }
      // HRTF panning in listener space (the Web Audio listener stays at the origin facing −Z)
      const p = ctx.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "linear";
      p.rolloffFactor = 0; // distance gain is ours (above)
      const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
      const right = dx * c - dz * s, fwd = dx * s + dz * c;
      const k = dist > 0.3 ? 1 / dist : 0;
      p.positionX.value = right * k;
      p.positionY.value = dy * k;
      p.positionZ.value = dist > 0.3 ? -fwd * k : -1;
      last.connect(p); last = p; nodes.push(p);
    }
    if (gain < 0.01) return null;
    input.gain.value = gain;
    last.connect(this.sfx);
    if (wet >= 1) last.connect(this.reverbIn);
    else if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      last.connect(w); w.connect(this.reverbIn); nodes.push(w);
    }
    this.voices.set(name, n + 1);
    return { input, nodes };
  }

  private release(name: string, nodes: AudioNode[]): void {
    this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
    for (const n of nodes) n.disconnect();
  }

  private startBuffer(name: string, buf: AudioBuffer, r: { input: GainNode; nodes: AudioNode[] }, rate: number, t: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(r.input);
    src.onended = () => { src.disconnect(); this.release(name, r.nodes); };
    src.start(t);
    return src;
  }

  /** Layered gunshot: crack + body (tight, mostly dry) + a space-dependent tail and, in the open, a delayed echo. */
  private playGun(name: SoundName, L: NonNullable<(typeof GUN_LAYERS)[SoundName]>): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.004;
    const pitch = 1 + (Math.random() - 0.5) * 0.06;
    const layer = (layer: string, gain: number, rate: number, wet: number, delay = 0) => {
      const bufs = this.buffers.get(layer);
      if (!bufs || gain < 0.01) return null;
      const r = this.route(layer, gain, undefined, wet);
      if (!r) return null;
      return { src: this.startBuffer(layer, pick(bufs), r, rate, t + delay), input: r.input };
    };
    layer(L.crack, L.gain, pitch, 0.2);
    layer(L.body, L.gain * 0.95, pitch * (0.98 + Math.random() * 0.04), 0.2);

    // Sustained fire = one continuous reverb: each shot fades the previous tail out and starts its own
    for (const v of this.tails.get(name) ?? []) {
      v.input.gain.setTargetAtTime(0, t, 0.035);
      try { v.src.stop(t + 0.2); } catch { /* already stopped */ }
    }
    const open = this.openness;
    const lane = Math.cos((open * Math.PI) / 2), plaza = Math.sin((open * Math.PI) / 2); // equal-power crossfade
    const tails = [
      layer("gun_tail_lane", L.gain * L.tail * lane, L.tailRate * pitch, 0.08, 0.008),
      layer("gun_tail_plaza", L.gain * L.tail * plaza, L.tailRate * pitch, 0.08, 0.012),
      open > 0.4 ? layer("gun_echo", L.gain * L.echo * (open - 0.4) / 0.6, L.tailRate * (0.96 + Math.random() * 0.08), 0, 0.2 + Math.random() * 0.25) : null,
    ].filter((v): v is NonNullable<typeof v> => v !== null);
    this.tails.set(name, tails);
  }

  /** Called every frame with the listener (camera) position and yaw. */
  update(listener: Vec, yaw: number): void {
    this.listener.x = listener.x;
    this.listener.y = listener.y;
    this.listener.z = listener.z;
    this.listener.yaw = yaw;
    const now = performance.now() / 1000;
    if (this.spaceProbe && now - this.probeAt >= PROBE_INTERVAL) {
      this.probeAt = now;
      this.measureSpace(this.spaceProbe);
    }
  }

  /**
   * How open is it around the listener? 8 horizontal rays (alternately offset by 22.5°) + one up. The median free
   * distance (robust to the two rays that run down a lane) ≈ 5 m in the bazaar lane → 0, ≳ 14 m in the plaza → 1;
   * a low ceiling (stair shaft, arcade) closes it further.
   */
  private measureSpace(probe: SpaceProbe): void {
    const from = { x: this.listener.x, y: this.listener.y, z: this.listener.z };
    const off = (this.probeIdx++ % 2) * (Math.PI / 8);
    const ds: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = off + (i * Math.PI) / 4;
      ds.push(probe(from, { x: Math.sin(a), y: 0, z: Math.cos(a) }, PROBE_RANGE) ?? PROBE_RANGE);
    }
    ds.sort((a, b) => a - b);
    const median = (ds[3] + ds[4]) / 2;
    const up = probe(from, { x: 0, y: 1, z: 0 }, 25) ?? 25;
    let open = Math.max(0, Math.min(1, (median - 5) / 9));
    if (up < 8) open *= 0.35;
    this.openness += (open - this.openness) * 0.5;
  }

  /** Diagnostics for automated checks: loaded file-backed sound names and the current space estimate. */
  debugInfo(): { loaded: string[]; sourced: number; openness: number; state: string } {
    return { loaded: [...this.buffers.keys()].sort(), sourced: this.sourced.size, openness: +this.openness.toFixed(3), state: this.state };
  }

  /** Must be called from a user gesture (browser autoplay rules). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Toggle mute; returns true when sound is now ON. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : Audio.BASE.master * this.vol.master, this.ctx.currentTime, 0.03);
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
    this.master.gain.value = this.muted ? 0 : Audio.BASE.master * this.vol.master;
    this.master.connect(limiter);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = Audio.BASE.sfx * this.vol.sfx;
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

    // Cached 2 s white-noise buffer + soft-clip curve (synth fallback)
    this.noiseBuf = makeNoise(ctx);
    this.distCurve = makeDistCurve();

    if (USE_FILES) void this.loadFiles(ctx);
    else this.startAmbience();
  }

  /** Number of decoded sound files (for diagnostics/tests). */
  get loadedFiles(): number {
    let n = this.ambienceBuffer ? 1 : 0;
    for (const v of this.buffers.values()) n += v.length;
    return n;
  }

  /** Fetch + decode every file in the manifest; anything missing falls back to the synth recipe. */
  private async loadFiles(ctx: AudioContext): Promise<void> {
    let manifest: AudioManifest | null = null;
    try {
      const r = await fetch(`${AUDIO_BASE}manifest.json`);
      if (r.ok) manifest = (await r.json()) as AudioManifest;
    } catch { /* offline/missing: synth fallback */ }
    if (!manifest) { this.startAmbience(); return; }
    const decode = async (file: string): Promise<AudioBuffer | null> => {
      try {
        const r = await fetch(AUDIO_BASE + file);
        if (!r.ok) return null;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { return null; }
    };
    const amb = manifest.ambience ? decode(manifest.ambience.file) : Promise.resolve(null);
    await Promise.all(manifest.sounds.map(async (s) => {
      if (!(s.name in R) && !LAYER_NAMES.includes(s.name)) return;
      const bufs = (await Promise.all((s.files ?? [s.file]).map(decode))).filter((b): b is AudioBuffer => b !== null);
      if (!bufs.length) return;
      this.buffers.set(s.name, bufs);
      if (s.sources) this.sourced.add(s.name);
    }));
    this.ambienceBuffer = await amb;
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
    amb.gain.linearRampToValueAtTime(Audio.BASE.music * this.vol.music, ctx.currentTime + 3);
    amb.connect(this.master);
    this.ambGain = amb;
    if (this.ambienceBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.ambienceBuffer;
      src.loop = true;
      src.connect(amb);
      src.start();
      return;
    }
    buildAmbience(ctx, amb, this.noiseBuf);
  }

  /**
   * Dev/export: render every recipe (dry, pitch 1) and the ambience loop to 44.1 kHz WAV, base64-encoded.
   * Used by tools/dev/export_audio.mjs to produce public/audio/*.wav.
   */
  static async renderAll(): Promise<{ name: string; wav: string; duration: number }[]> {
    const SR = 44100;
    const out: { name: string; wav: string; duration: number }[] = [];
    const curve = makeDistCurve();
    for (const name of SOUND_NAMES) {
      // Pass 1 measures the recipe's duration, pass 2 renders it with a 0.3 s tail for reverb-free decay
      const probe = new OfflineAudioContext(1, SR, SR);
      const dur = R[name](new Synth(probe, probe.createGain(), makeNoise(probe), curve, 1), 0);
      const len = Math.ceil((dur + 0.3) * SR);
      const off = new OfflineAudioContext(1, len, SR);
      R[name](new Synth(off, off.destination, makeNoise(off), curve, 1), 0.005);
      const buf = await off.startRendering();
      out.push({ name, wav: toBase64(encodeWav(buf)), duration: +(len / SR).toFixed(3) });
    }
    // Ambience: render 24 s, crossfade the last 2 s into the start for a seamless 22 s loop
    const LOOP = 22, FADE = 2;
    const off = new OfflineAudioContext(1, (LOOP + FADE) * SR, SR);
    buildAmbience(off, off.destination, makeNoise(off));
    const raw = await off.startRendering();
    const src = raw.getChannelData(0);
    const loop = new AudioBuffer({ length: LOOP * SR, numberOfChannels: 1, sampleRate: SR });
    const dst = loop.getChannelData(0);
    for (let i = 0; i < LOOP * SR; i++) {
      if (i < FADE * SR) { const k = i / (FADE * SR); dst[i] = src[i] * k + src[i + LOOP * SR] * (1 - k); }
      else dst[i] = src[i];
    }
    out.push({ name: "ambience", wav: toBase64(encodeWav(loop)), duration: LOOP });
    return out;
  }
}

/** The ambience synth graph (alien hum + wind), into `dest`. Shared by live fallback and the exporter. */
function buildAmbience(ctx: BaseAudioContext, amb: AudioNode, noiseBuf: AudioBuffer): void {
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
  src.buffer = noiseBuf;
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

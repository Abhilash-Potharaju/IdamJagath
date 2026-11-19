/**
 * Sound recipes for tools/audio/build.mjs: every game sound built from Freesound sources.
 * Each sound has one or more variants (picked at random at runtime); a variant mixes one or more parts.
 *
 * Part fields (times in seconds, relative to the source file):
 *   id     Freesound sound id (source previews cached in tools/audio/.cache/)
 *   t0,t1  cut range; `onset: true` moves t0 forward to the first transient (tight attack)
 *   at     where the part starts in the output
 *   gain   dB;  hp / lp: 2-pole high/low-pass (Hz; `hp2`/`lp2` = 4-pole)
 *   rate   playback-speed change (pitch + time), e.g. 0.85 = lower and longer
 *   fi/fo  fade in / out (s);  decay = exponential fade to −60 dB over this many seconds (shortens tails)
 * Sound fields: rms = target loudness of the active part (dBFS, default −16), peak limit −1 dBFS.
 *
 * Licences: only CC0 and CC BY (see LICENSES below; CC BY sources are credited via data/assets.json).
 */

/** Freesound ids that are CC BY (everything else used here is CC0). Checked by build.mjs against the API metadata. */
export const CC_BY = [179005, 179006];

const crack = (id, t1 = 0.2, extra = {}) => ({ parts: [{ id, t0: 0, t1, onset: true, hp: 600, fo: 0.09, ...extra }] });
const body = (id, t1 = 0.4, extra = {}) => ({ parts: [{ id, t0: 0, t1, onset: true, lp: 520, fo: 0.18, ...extra }] });

export const SOUNDS = {
  // ───────────── guns (layered at runtime: crack + body + tail [+ echo], see Audio.ts GUN_LAYERS) ─────────────
  // Vajra (assault rifle): crack = real M4A1 range recordings (DVIDS via qubodup), body = bulky shots low-passed
  vajra_crack: { rms: -14, variants: [crack(854228), crack(854230), crack(854231), crack(854207), crack(855655, 0.22, { t0: 0.0 })] },
  vajra_body: { rms: -15, variants: [body(386845), body(371041), body(855655, 0.45), body(450853, 0.4)] },
  // Trishul (heavy spread gun): shotgun blasts, the body pitched down for weight
  trishul_crack: { rms: -13, variants: [crack(473846, 0.32, { hp: 400 }), crack(564480, 0.3, { hp: 400 }), crack(405504, 0.35, { hp: 400 })] },
  trishul_body: { rms: -13, variants: [body(564480, 0.55, { lp: 380, rate: 0.85 }), body(473846, 0.6, { lp: 380, rate: 0.85 }), body(371041, 0.55, { lp: 320, rate: 0.75 })] },
  // Tails: open plaza = long rolling outdoor echo; narrow lane = shorter, brighter slap/flutter
  gun_tail_plaza: {
    rms: -20, variants: [
      { parts: [{ id: 563015, t0: 0.78, t1: 3.1, fi: 0.03, fo: 0.4, hp: 120 }] },
      { parts: [{ id: 734096, t0: 0.05, t1: 3.4, fi: 0.03, fo: 0.5, hp: 120 }] },
      { parts: [{ id: 427597, t0: 0.78, t1: 2.3, fi: 0.04, fo: 0.4, hp: 120 }] },
    ],
  },
  gun_tail_lane: {
    rms: -19, variants: [
      { parts: [{ id: 563015, t0: 0.74, t1: 1.9, fi: 0.02, decay: 1.0, hp: 300 }, { id: 854228, t0: 0, t1: 0.12, at: 0.028, lp: 2500, gain: -8, fo: 0.05 }] },
      { parts: [{ id: 815476, t0: 0.08, t1: 1.3, fi: 0.02, decay: 0.95, hp: 300 }, { id: 854230, t0: 0, t1: 0.12, at: 0.04, lp: 2500, gain: -8, fo: 0.05 }] },
      { parts: [{ id: 370304, t0: 0.12, t1: 1.3, fi: 0.03, decay: 0.9, hp: 300, lp: 5000 }] },
    ],
  },
  // Distant echo off the far buildings (plaza): delayed and dark
  gun_echo: {
    rms: -18, variants: [
      { parts: [{ id: 337240, t0: 0, t1: 1.2, onset: true, lp: 1800, fo: 0.4 }] },
      { parts: [{ id: 427597, t0: 0.5, t1: 1.9, onset: true, lp: 1600, fo: 0.5 }] },
    ],
  },

  // ───────────── reloads (played by WeaponView at fixed points of the reload) ─────────────
  // Real AR-15 handling (wadaltmon) + an AK reload (serøutōnin--deprivəd)
  vajra_mag_out: { rms: -17, variants: [{ parts: [{ id: 263513, t0: 0.18, t1: 0.5, onset: true, fo: 0.06 }] }, { parts: [{ id: 263513, t0: 2.22, t1: 2.55, onset: true, fo: 0.06 }] }, { parts: [{ id: 674742, t0: 0, t1: 0.42, onset: true, fo: 0.06 }] }] },
  vajra_mag_in: { rms: -15, variants: [{ parts: [{ id: 263513, t0: 1.52, t1: 1.82, onset: true, fo: 0.06 }] }, { parts: [{ id: 263513, t0: 2.83, t1: 3.12, onset: true, fo: 0.06 }] }, { parts: [{ id: 674742, t0: 0.8, t1: 1.28, onset: true, fo: 0.06 }] }] },
  vajra_bolt: { rms: -15, variants: [{ parts: [{ id: 263513, t0: 3.4, t1: 3.92, onset: true, fo: 0.06 }] }, { parts: [{ id: 107793, t0: 0.26, t1: 0.62, onset: true, fo: 0.06 }] }] },
  trishul_shell: { rms: -17, variants: [{ parts: [{ id: 108793, t0: 0.03, t1: 0.38, onset: true, fo: 0.05 }] }, { parts: [{ id: 108793, t0: 0.03, t1: 0.38, onset: true, fo: 0.05, rate: 0.92 }] }] },
  trishul_pump: { rms: -14, variants: [{ parts: [{ id: 677662, t0: 0.66, t1: 1.3, onset: true, fo: 0.08 }] }, { parts: [{ id: 673320, t0: 0.76, t1: 1.0, onset: true, fo: 0.04 }, { id: 673320, t0: 2.9, t1: 3.15, at: 0.2, onset: true, fo: 0.05 }] }] },
  switch: { rms: -19, variants: [{ parts: [{ id: 263513, t0: 1.0, t1: 1.2, onset: true, fo: 0.05 }] }, { parts: [{ id: 263513, t0: 4.23, t1: 4.42, onset: true, fo: 0.05 }] }] },

  // ───────────── casings, impacts, hit / kill feedback ─────────────
  shell_drop: {
    rms: -20, variants: [
      { parts: [{ id: 179005, t0: 0.02, t1: 1.0, onset: true, fo: 0.15 }] },
      { parts: [{ id: 179006, t0: 0.0, t1: 0.8, onset: true, fo: 0.15 }] },
      { parts: [{ id: 179005, t0: 0.02, t1: 0.75, onset: true, fo: 0.15, rate: 1.08 }] },
      { parts: [{ id: 523059, t0: 0, t1: 0.9, onset: true, fo: 0.2 }] },
    ],
  },
  impact_stone: {
    rms: -16, variants: [
      { parts: [{ id: 789388, t0: 0, t1: 0.45, onset: true, fo: 0.15 }] },
      { parts: [{ id: 569506, t0: 0, t1: 0.4, onset: true, fo: 0.12 }] },
      { parts: [{ id: 569497, t0: 0, t1: 0.38, onset: true, fo: 0.12 }] },
      { parts: [{ id: 789388, t0: 0, t1: 0.4, onset: true, fo: 0.12, rate: 1.15 }, { id: 569506, t0: 0, t1: 0.25, onset: true, gain: -6, at: 0.01, fo: 0.08 }] },
    ],
  },
  impact_flesh: {
    rms: -15, variants: [0.04, 0.34, 0.68, 1.07, 1.43, 1.77, 2.13].map((t) => ({ parts: [{ id: 423301, t0: t, t1: t + 0.3, onset: true, fo: 0.08 }] })),
  },
  kill_confirm: {
    rms: -14, variants: [
      { parts: [{ id: 779805, t0: 0, t1: 0.32, onset: true, fo: 0.1 }, { id: 634619, t0: 0.08, t1: 0.42, onset: true, at: 0.015, gain: -7, fo: 0.1 }] },
      { parts: [{ id: 522091, t0: 0, t1: 0.42, onset: true, fo: 0.12 }, { id: 816237, t0: 0, t1: 0.3, onset: true, at: 0.01, gain: -8, fo: 0.1 }] },
    ],
  },
  hit: { rms: -22, variants: [{ parts: [{ id: 478057, t0: 0, t1: 0.13, onset: true, fo: 0.04, lp: 6000 }] }] },
  player_hurt: {
    rms: -16, variants: [
      { parts: [{ id: 517744, t0: 0.42, t1: 0.8, onset: true, lp: 2200, fo: 0.12 }] },
      { parts: [{ id: 779805, t0: 0, t1: 0.35, onset: true, lp: 1600, fo: 0.12, rate: 0.85 }] },
    ],
  },

  // ───────────── creatures ─────────────
  // Crawler (spider-like): wet chitters, hiss + rattle tell, screech lunge, snapping bite
  crawler_idle: {
    rms: -18, variants: [
      { parts: [{ id: 106126, t0: 0, t1: 0.6, fo: 0.1 }] },
      { parts: [{ id: 800277, t0: 0.25, t1: 1.65, fo: 0.2 }] },
      { parts: [{ id: 205753, t0: 0.1, t1: 1.05, fo: 0.2, rate: 1.15 }] },
      { parts: [{ id: 106126, t0: 0, t1: 0.6, fo: 0.1, rate: 0.85 }] },
    ],
  },
  crawler_windup: {
    rms: -15, variants: [
      { parts: [{ id: 205754, t0: 0.1, t1: 0.95, fo: 0.15 }, { id: 758900, t0: 0.04, t1: 0.45, at: 0.15, gain: -4, fo: 0.1 }] },
      { parts: [{ id: 205753, t0: 0.1, t1: 0.95, fo: 0.15 }, { id: 106126, t0: 0, t1: 0.5, at: 0.1, gain: -3, fo: 0.1 }] },
    ],
  },
  crawler_lunge: {
    rms: -14, variants: [
      { parts: [{ id: 416053, t0: 0.04, t1: 0.8, onset: true, fo: 0.25, rate: 1.2 }] },
      { parts: [{ id: 442957, t0: 0, t1: 0.75, onset: true, fo: 0.25, rate: 1.25 }] },
    ],
  },
  crawler_bite: {
    rms: -14, variants: [
      { parts: [{ id: 816237, t0: 0, t1: 0.3, onset: true, fo: 0.08 }, { id: 457475, t0: 0.24, t1: 0.55, at: 0.0, gain: -4, fo: 0.08 }] },
      { parts: [{ id: 816237, t0: 0, t1: 0.3, onset: true, fo: 0.08, rate: 0.85 }] },
    ],
  },
  enemy_hurt: {
    rms: -16, variants: [
      { parts: [{ id: 555425, t0: 0, t1: 0.5, onset: true, fo: 0.12, rate: 1.2 }] },
      { parts: [{ id: 555422, t0: 0, t1: 0.3, onset: true, fo: 0.08, rate: 1.2 }] },
      { parts: [{ id: 555420, t0: 0.03, t1: 0.5, onset: true, fo: 0.12, rate: 1.15 }] },
    ],
  },
  enemy_death: {
    rms: -14, variants: [
      { parts: [{ id: 416049, t0: 0.25, t1: 1.7, onset: true, fo: 0.5 }] },
      { parts: [{ id: 416051, t0: 0.06, t1: 1.4, onset: true, fo: 0.4 }] },
      { parts: [{ id: 416052, t0: 0.1, t1: 1.5, onset: true, fo: 0.4 }] },
    ],
  },
  // Spitter: throaty gurgles, gag build-up before the spit, acid splash
  spitter_idle: {
    rms: -18, variants: [
      { parts: [{ id: 196719, t0: 0.08, t1: 0.82, fo: 0.15, rate: 0.85 }] },
      { parts: [{ id: 196722, t0: 2.7, t1: 3.3, fo: 0.15, rate: 0.85 }] },
      { parts: [{ id: 196722, t0: 0.85, t1: 1.85, fo: 0.2, rate: 0.85 }] },
    ],
  },
  spitter_charge: { rms: -15, variants: [{ parts: [{ id: 446001, t0: 0.62, t1: 1.5, fi: 0.05, fo: 0.08 }] }] },
  spitter_spit: {
    rms: -14, variants: [
      { parts: [{ id: 500734, t0: 1.44, t1: 1.8, onset: true, fo: 0.08 }] },
      { parts: [{ id: 500734, t0: 0.18, t1: 0.6, onset: true, fo: 0.1 }, { id: 147017, t0: 0, t1: 0.35, at: 0.05, gain: -6, fo: 0.08 }] },
    ],
  },
  glob_splash: { rms: -16, variants: [{ parts: [{ id: 147017, t0: 0, t1: 0.38, onset: true, fo: 0.1 }, { id: 758633, t0: 0.16, t1: 1.3, at: 0.03, gain: -4, fi: 0.03, fo: 0.4 }] }] },
  spitter_death: { rms: -16, variants: [{ parts: [{ id: 196722, t0: 1.15, t1: 2.15, fo: 0.3, rate: 0.8 }] }] },
  // Warden (brute): deep growls, roar, heavy stomps, crash into walls, collapse
  warden_idle: {
    rms: -15, variants: [
      { parts: [{ id: 77632, t0: 0.05, t1: 2.0, fo: 0.4, rate: 0.85 }] },
      { parts: [{ id: 77635, t0: 0.04, t1: 2.2, fo: 0.4, rate: 0.85 }] },
      { parts: [{ id: 707685, t0: 0.95, t1: 2.5, fo: 0.4 }] },
      { parts: [{ id: 315775, t0: 0.4, t1: 1.5, fo: 0.3, rate: 0.85 }] },
    ],
  },
  warden_roar: { rms: -12, variants: [{ parts: [{ id: 476083, t0: 0, t1: 2.6, onset: true, fo: 0.8 }] }] },
  warden_charge: { rms: -12, variants: [{ parts: [{ id: 466830, t0: 0.05, t1: 2.3, onset: true, fo: 0.6 }] }] },
  warden_land: { rms: -12, variants: [{ parts: [{ id: 77027, t0: 0.05, t1: 0.9, onset: true, fo: 0.3 }, { id: 703247, t0: 0, t1: 1.6, onset: true, gain: -5, fo: 0.6 }] }] },
  warden_impact: { rms: -12, variants: [{ parts: [{ id: 812538, t0: 0.14, t1: 1.0, onset: true, fo: 0.3 }, { id: 703248, t0: 0, t1: 1.3, onset: true, gain: -3, fo: 0.5 }] }] },
  warden_stun: { rms: -14, variants: [{ parts: [{ id: 442966, t0: 0, t1: 1.25, onset: true, fo: 0.3, rate: 0.85 }] }] },
  warden_death: {
    rms: -12, variants: [{
      parts: [
        { id: 347410, t0: 0.28, t1: 3.0, onset: true, fo: 0.9 },
        { id: 504626, t0: 0.3, t1: 1.3, onset: true, at: 2.1, gain: -2, fo: 0.4 },
        { id: 703247, t0: 0, t1: 1.2, onset: true, at: 2.15, gain: -9, fo: 0.5 },
      ],
    }],
  },
  warden_step: {
    rms: -14, variants: [
      { parts: [{ id: 812538, t0: 0.14, t1: 0.8, onset: true, fo: 0.3 }] },
      { parts: [{ id: 812538, t0: 1.55, t1: 2.15, onset: true, fo: 0.3 }] },
      { parts: [{ id: 721601, t0: 0.05, t1: 0.75, onset: true, fo: 0.3 }] },
      { parts: [{ id: 77027, t0: 0.05, t1: 0.7, onset: true, fo: 0.3 }] },
    ],
  },
};

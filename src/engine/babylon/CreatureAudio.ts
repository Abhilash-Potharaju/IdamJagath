import type { GameWorld } from "../../core/world";
import type { Enemy } from "../../core/entities/enemies";
import type { EnemyType } from "../../data/schemas";
import type { Audio, SoundName } from "./Audio";

/**
 * Creature presence audio (presentation only; polls the core, never affects gameplay):
 *  - idle vocals on a random timer for awake enemies near the player (chitters, gurgles, growls), all positional;
 *  - the Warden's heavy footsteps, paced by how far it actually moved (faster cadence when it charges);
 *  - type-specific death layers (the spitter's gurgling death on top of the shared death cry).
 * Attack tells (windup, spit charge, roar…) stay core sound events.
 */
const IDLE: Record<EnemyType, { sound: SoundName; min: number; max: number; range: number }> = {
  crawler: { sound: "crawler_idle", min: 2.2, max: 5.5, range: 26 },
  spitter: { sound: "spitter_idle", min: 3, max: 6.5, range: 30 },
  warden: { sound: "warden_idle", min: 3.5, max: 7, range: 45 },
};
/** Metres per Warden footstep (stalking); charging strides are longer but come faster. */
const WARDEN_STRIDE = 1.9;
const WARDEN_CHARGE_STRIDE = 2.6;
/** Minimum gap between any two idle vocals (keeps a pack from turning into a choir). */
const IDLE_GAP = 0.7;

interface Track { idleT: number; lastX: number; lastZ: number; stride: number }

export class CreatureAudio {
  private readonly world: GameWorld;
  private readonly audio: Audio;
  private readonly tracks = new Map<number, Track>();
  private sinceIdle = 0;

  constructor(world: GameWorld, audio: Audio) {
    this.world = world;
    this.audio = audio;
    world.events.on("enemyKilled", (e) => {
      this.tracks.delete(e.id);
      if (e.type === "spitter") window.setTimeout(() => audio.play("spitter_death", e.at), 140);
    });
  }

  /** Per render frame; `listener` = camera position. */
  update(dt: number, listener: { x: number; y: number; z: number }): void {
    this.sinceIdle += dt;
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      let tr = this.tracks.get(e.id);
      if (!tr) {
        tr = { idleT: 1 + Math.random() * 3, lastX: e.pos.x, lastZ: e.pos.z, stride: 0 };
        this.tracks.set(e.id, tr);
      }
      if (e.type === "warden") this.wardenSteps(e, tr);
      if (!e.awake || e.tell !== "none") continue;
      const cfg = IDLE[e.type];
      tr.idleT -= dt;
      if (tr.idleT > 0) continue;
      tr.idleT = cfg.min + Math.random() * (cfg.max - cfg.min);
      const d = Math.hypot(e.pos.x - listener.x, e.pos.y - listener.y, e.pos.z - listener.z);
      if (d > cfg.range || this.sinceIdle < IDLE_GAP) continue;
      if (e.type === "warden" && (e as unknown as { state: string }).state === "drop") continue;
      this.sinceIdle = 0;
      this.audio.play(cfg.sound, e.pos);
    }
  }

  private wardenSteps(e: Enemy, tr: Track): void {
    const dx = e.pos.x - tr.lastX, dz = e.pos.z - tr.lastZ;
    tr.lastX = e.pos.x; tr.lastZ = e.pos.z;
    const state = (e as unknown as { state: string }).state;
    if (state === "drop" || state === "stunned") { tr.stride = 0; return; }
    const step = Math.hypot(dx, dz);
    if (step > 3) return; // teleport / spawn, not walking
    tr.stride += step;
    if (tr.stride >= (state === "charge" ? WARDEN_CHARGE_STRIDE : WARDEN_STRIDE)) {
      tr.stride = 0;
      this.audio.play("warden_step", { x: e.pos.x, y: e.pos.y - e.halfHeight + 0.2, z: e.pos.z });
    }
  }
}

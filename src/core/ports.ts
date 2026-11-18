import type { Vec3 } from "./math";

/**
 * The ONLY interfaces the core uses to touch the outside world. An engine adapter implements them
 * (src/engine/babylon/BabylonPhysics.ts today; a Unity/Godot/Unreal port re-implements just these).
 */

export type BodyId = number;

/** What a ray hit, when it's something the game cares about (otherwise it's plain world geometry). */
export interface HitTarget {
  kind: "enemy" | "shield" | "pylon" | "secretWall";
  /** Enemy id / pylon index / 0 for the secret wall. */
  id: number;
  /** Damage multiplier for this part (weak spots). */
  mul: number;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  target?: HitTarget;
  /** Opaque engine handle for the surface that was hit (passed back to the adapter in impact events, e.g. for decals). */
  surface?: unknown;
}

export interface IPhysics {
  /** Create a kinematic collision body (an ellipsoid with the given half extents) at `pos`. */
  createBody(halfExtents: Vec3, pos: Vec3, name: string): BodyId;
  /** The core is done with this body (the adapter may keep it for a death animation). */
  releaseBody(id: BodyId): void;
  /**
   * Slide the body from `from` by `disp`, resolving collisions with solid world geometry.
   * `from` is authoritative (the core may teleport bodies). Returns the resolved position.
   */
  move(id: BodyId, from: Vec3, disp: Vec3): Vec3;
  /** First shootable thing (world geometry, enemies, pylons…) along the ray, within `range`. */
  raycast(origin: Vec3, dir: Vec3, range: number): RayHit | null;
  /** True when no solid world geometry blocks the segment a→b. */
  lineOfSight(a: Vec3, b: Vec3): boolean;
}

/**
 * One simulation step's input, as plain actions (the adapter maps devices → actions).
 * "Held" fields are the current state; "Pressed" fields are edges since the previous step; look/wheel are
 * accumulated since the previous step.
 */
export interface InputSnapshot {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  jumpPressed: boolean;
  fire: boolean;
  aim: boolean;
  reloadPressed: boolean;
  weapon1Pressed: boolean;
  weapon2Pressed: boolean;
  weaponLastPressed: boolean;
  /** Mouse-wheel notches: +1 = scrolled down. */
  wheel: number;
  /** Look deltas in raw mouse units (scaled by the player's sensitivity). */
  lookDX: number;
  lookDY: number;
}

export const NO_INPUT: InputSnapshot = Object.freeze({
  forward: false, back: false, left: false, right: false, sprint: false, crouch: false, crouchPressed: false,
  jumpPressed: false, fire: false, aim: false, reloadPressed: false, weapon1Pressed: false, weapon2Pressed: false,
  weaponLastPressed: false, wheel: 0, lookDX: 0, lookDY: 0,
});

/** Read-only level anchors the mission needs (plain data, extracted from the level by the adapter). */
export interface Rect { x1: number; x2: number; z1: number; z2: number }
export interface LevelAnchors {
  playerSpawn: Vec3;
  extraction: Rect;
  cageTrigger: Rect;
  plazaEntryZ: number;
  pylonSpots: Vec3[];
  healthSpots: Vec3[];
  secretPickup: Vec3;
  cageDoor: Vec3;
}

/**
 * IDAM JAGATH: portable game core.
 *
 * Rules for everything under src/core/:
 *  - No engine or DOM imports (no @babylonjs, no window/document). Plain TypeScript + data/schemas types only.
 *  - Deterministic: fixed timestep (SIM_DT = 1/60 s), all randomness from the seeded Rng, no wall-clock reads.
 *    Same seed + same InputSnapshots ⇒ identical state (GameWorld.stateHash()).
 *  - The outside world is reached ONLY through the ports in ports.ts (IPhysics) and observed through the
 *    EventBus (events.ts). Presentation (meshes, particles, sound playback, HUD, camera) lives in an engine adapter.
 *
 * Conventions: SI units (metres, seconds, m/s, radians). Left-handed, +Y up, +Z = north/forward.
 * Yaw = radians about +Y, 0 faces +Z: forward = (sin yaw, 0, cos yaw). Pitch > 0 looks down.
 * Entity positions are the centre of their collision ellipsoid; ground-plane data positions are [x, z].
 */
export { Vec3, clamp, lerp, wrapAngle, forwardOf, rightOf, viewDir, rotateY, spring } from "./math";
export { Rng } from "./rng";
export { FixedStep, SIM_DT } from "./time";
export { EventBus, type GameEvents, type Phase, type ImpactKind } from "./events";
export type { IPhysics, BodyId, HitTarget, RayHit, InputSnapshot, LevelAnchors, Rect } from "./ports";
export { NO_INPUT } from "./ports";
export { GameWorld, type GameplayData, type WorldOptions, type Glob } from "./world";
export { Mission, fmtTime, type Pylon, type Pickup } from "./mission";
export { Player, type PlayerView } from "./entities/player";
export { Arsenal, Gun } from "./entities/weapons";
export { Enemy, Crawler, Spitter, Warden, type Tell } from "./entities/enemies";

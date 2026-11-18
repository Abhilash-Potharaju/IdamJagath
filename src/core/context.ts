import type { EventBus } from "./events";
import type { IPhysics } from "./ports";
import type { Rng } from "./rng";
import type { Vec3 } from "./math";

/** Shared services every core entity can use (handed out by GameWorld; no engine types). */
export interface CoreContext {
  readonly physics: IPhysics;
  readonly events: EventBus;
  readonly rng: Rng;
  /** Emit a sound event (and the camera shake some sounds carry). */
  sound(name: string, at?: Vec3): void;
  /** Show a one-time tutorial hint (deduplicated by id). */
  hint(id: string, text: string): void;
  message(text: string, seconds: number): void;
}

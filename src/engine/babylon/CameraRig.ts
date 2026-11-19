import { FreeCamera, Vector3, type Scene } from "@babylonjs/core";
import type { Player } from "../../core/entities/player";
import { lerp } from "../../core/math";

/**
 * Kill "punch": a small, quick camera kick (pitch up + a hint of roll) and FOV squeeze on a kill. Presentation only:
 * the core's view/aim are untouched, so it never changes the simulation. ?nopunch disables it.
 */
export const PUNCH = {
  enabled: !new URLSearchParams(location.search).has("nopunch"),
  pitch: 0.0065,  // rad of upward kick per unit strength
  roll: 0.004,    // rad of roll (random side)
  fov: 0.012,     // fraction the FOV narrows
  stiffness: 260, // spring (1/s²)
  damping: 26,    // (1/s)
  max: 2.2,       // cap on stacked strength
};

/** The first-person camera: shows the core player's view, interpolated between simulation steps. */
export class CameraRig {
  readonly camera: FreeCamera;
  private readonly player: Player;
  /** Punch spring: x = pitch, y = roll, z = fov; and velocities. */
  private readonly kick = new Vector3();
  private readonly kickV = new Vector3();

  constructor(scene: Scene, player: Player) {
    this.player = player;
    const v = player.view;
    this.camera = new FreeCamera("cam", new Vector3(v.eye.x, v.eye.y, v.eye.z), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.fov = v.fov;
    scene.activeCamera = this.camera;
  }

  /** Kick the camera (strength ~1 for a kill; more for heavy / weak-spot kills). */
  punch(strength = 1): void {
    if (!PUNCH.enabled) return;
    const s = Math.min(strength, PUNCH.max);
    const impulse = Math.sqrt(PUNCH.stiffness) * 1.6;
    this.kickV.x += PUNCH.pitch * s * impulse;
    this.kickV.y += PUNCH.roll * s * impulse * (Math.random() < 0.5 ? -1 : 1);
    this.kickV.z += PUNCH.fov * s * impulse;
  }

  /** alpha ∈ [0,1]: 0 = previous step's view, 1 = current step's view. */
  apply(alpha: number): void {
    const a = this.player.prevView, b = this.player.view, c = this.camera;
    const k = this.stepPunch();
    c.position.set(lerp(a.eye.x, b.eye.x, alpha), lerp(a.eye.y, b.eye.y, alpha), lerp(a.eye.z, b.eye.z, alpha));
    c.rotation.set(lerp(a.pitch, b.pitch, alpha) - k.x, lerp(a.yaw, b.yaw, alpha), lerp(a.roll, b.roll, alpha) + k.y);
    c.fov = lerp(a.fov, b.fov, alpha) * (1 - k.z);
  }

  /** Advance the punch spring by the real frame time. */
  private stepPunch(): Vector3 {
    if (this.kick.lengthSquared() < 1e-12 && this.kickV.lengthSquared() < 1e-10) return this.kick.setAll(0);
    const dt = Math.min(0.033, this.camera.getScene().getEngine().getDeltaTime() / 1000);
    const K = PUNCH.stiffness, D = PUNCH.damping;
    this.kickV.x += (-K * this.kick.x - D * this.kickV.x) * dt;
    this.kickV.y += (-K * this.kick.y - D * this.kickV.y) * dt;
    this.kickV.z += (-K * this.kick.z - D * this.kickV.z) * dt;
    this.kick.addInPlace(this.kickV.scale(dt));
    return this.kick;
  }

  forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }
}

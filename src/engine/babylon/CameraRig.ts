import { FreeCamera, Vector3, type Scene } from "@babylonjs/core";
import type { Player } from "../../core/entities/player";
import { lerp } from "../../core/math";

/** The first-person camera: shows the core player's view, interpolated between simulation steps. */
export class CameraRig {
  readonly camera: FreeCamera;
  private readonly player: Player;

  constructor(scene: Scene, player: Player) {
    this.player = player;
    const v = player.view;
    this.camera = new FreeCamera("cam", new Vector3(v.eye.x, v.eye.y, v.eye.z), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.fov = v.fov;
    scene.activeCamera = this.camera;
  }

  /** alpha ∈ [0,1]: 0 = previous step's view, 1 = current step's view. */
  apply(alpha: number): void {
    const a = this.player.prevView, b = this.player.view, c = this.camera;
    c.position.set(lerp(a.eye.x, b.eye.x, alpha), lerp(a.eye.y, b.eye.y, alpha), lerp(a.eye.z, b.eye.z, alpha));
    c.rotation.set(lerp(a.pitch, b.pitch, alpha), lerp(a.yaw, b.yaw, alpha), lerp(a.roll, b.roll, alpha));
    c.fov = lerp(a.fov, b.fov, alpha);
  }

  forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }
}

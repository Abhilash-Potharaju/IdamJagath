import { Mesh, MeshBuilder, Ray, type Scene } from "@babylonjs/core";
import type { Vec3 } from "../../core/math";
import type { BodyId, HitTarget, IPhysics, RayHit } from "../../core/ports";
import { isWorld } from "../../game/types";
import { fromV3, toV3 } from "./convert";

/**
 * IPhysics on Babylon's built-in collision system: each body is an invisible mesh with a collision ellipsoid moved
 * with moveWithCollisions; rays use scene picking. Enemy views parent their visuals to the body mesh, so shots hit
 * the visible parts (tagged with metadata.target, see convert.ts).
 */
export class BabylonPhysics implements IPhysics {
  private readonly scene: Scene;
  private readonly bodies = new Map<BodyId, Mesh>();
  private seq = 0;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  createBody(halfExtents: Vec3, pos: Vec3, name: string): BodyId {
    const m = MeshBuilder.CreateBox(name, { size: name === "player" ? 0.5 : 0.1 }, this.scene);
    m.isVisible = false;
    m.isPickable = false;
    m.ellipsoid = toV3(halfExtents);
    m.position.copyFrom(toV3(pos));
    const id = ++this.seq;
    this.bodies.set(id, m);
    return id;
  }

  /** The engine mesh behind a body (views attach visuals to it). */
  mesh(id: BodyId): Mesh | undefined {
    return this.bodies.get(id);
  }

  releaseBody(id: BodyId): void {
    // The enemy view keeps the mesh for its death animation and disposes it; just forget it here.
    this.bodies.delete(id);
  }

  move(id: BodyId, from: Vec3, disp: Vec3): Vec3 {
    const m = this.bodies.get(id);
    if (!m) return from.add(disp);
    m.position.set(from.x, from.y, from.z);
    m.computeWorldMatrix(true);
    m.moveWithCollisions(toV3(disp));
    return fromV3(m.position);
  }

  raycast(origin: Vec3, dir: Vec3, range: number): RayHit | null {
    const hit = this.scene.pickWithRay(new Ray(toV3(origin), toV3(dir), range),
      (m) => m.isPickable && m.isEnabled() && m.isVisible && !m.name.startsWith("muzzle-flash"));
    if (!hit?.hit || !hit.pickedPoint || !hit.pickedMesh) return null;
    const n = hit.getNormal(true, true);
    const target = hit.pickedMesh.metadata?.target as HitTarget | undefined;
    return {
      point: fromV3(hit.pickedPoint),
      normal: n ? fromV3(n) : dir.scale(-1),
      distance: hit.distance,
      target,
      surface: target ? undefined : hit.pickedMesh,
    };
  }

  lineOfSight(a: Vec3, b: Vec3): boolean {
    const d = b.subtract(a);
    const len = d.length();
    if (len === 0) return true;
    const hit = this.scene.pickWithRay(new Ray(toV3(a), toV3(d.normalize()), len), (m) => isWorld(m) && m.isEnabled());
    return !hit?.hit || hit.distance > len - 0.3;
  }
}

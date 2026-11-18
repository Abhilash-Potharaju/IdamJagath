import { type AbstractMesh, Mesh, MeshBuilder, Ray, type Scene, Vector3 } from "@babylonjs/core";
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
    // Two passes (standard character-controller practice): horizontal slide first, then vertical. A single combined
    // move with the ground-stick push let the ellipsoid slip into convex wall corners and get trapped.
    if (disp.x !== 0 || disp.z !== 0) { m.moveWithCollisions(new Vector3(disp.x, 0, disp.z)); m.computeWorldMatrix(true); }
    if (disp.y !== 0) m.moveWithCollisions(new Vector3(0, disp.y, 0));
    this.depenetrate(m);
    return fromV3(m.position);
  }

  // ── Safety net: if a body still ends up inside a solid wall box, push it out to the nearest face ──
  private blockers: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; mesh: AbstractMesh }[] = [];
  private blockersAt = -1;

  /** Axis-aligned solid level boxes (walls, buildings, pillars, crates), cached and refreshed every second. */
  private solidBoxes() {
    const now = performance.now();
    if (now - this.blockersAt > 1000) {
      this.blockersAt = now;
      this.blockers = [];
      for (const mesh of this.scene.meshes) {
        if (!mesh.checkCollisions || !mesh.isEnabled() || mesh.isDisposed() || !isWorld(mesh)) continue;
        if (/minaret|ground|street|alley|slab/i.test(mesh.name)) continue; // round or flat: AABB isn't the shape
        mesh.computeWorldMatrix(true);
        const b = mesh.getBoundingInfo().boundingBox;
        if (b.maximumWorld.y - b.minimumWorld.y < 0.3) continue;
        this.blockers.push({ x0: b.minimumWorld.x, x1: b.maximumWorld.x, y0: b.minimumWorld.y, y1: b.maximumWorld.y,
          z0: b.minimumWorld.z, z1: b.maximumWorld.z, mesh });
      }
    }
    return this.blockers;
  }

  private depenetrate(m: Mesh): void {
    const r = m.ellipsoid.x, h = m.ellipsoid.y;
    for (let iter = 0; iter < 3; iter++) {
      const p = m.position;
      let pushed = false;
      for (const b of this.solidBoxes()) {
        if (b.mesh.isDisposed() || !b.mesh.isEnabled()) continue;
        if (p.y + h * 0.8 < b.y0 || p.y - h * 0.8 > b.y1) continue;
        // Inside = centre within the box grown by 60% of the radius (a resting body touches at exactly 1 radius)
        const g = r * 0.6;
        if (p.x <= b.x0 - g || p.x >= b.x1 + g || p.z <= b.z0 - g || p.z >= b.z1 + g) continue;
        const out = [[b.x0 - r - 0.01 - p.x, 0], [b.x1 + r + 0.01 - p.x, 0], [0, b.z0 - r - 0.01 - p.z], [0, b.z1 + r + 0.01 - p.z]]
          .sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]))[0];
        p.x += out[0]; p.z += out[1];
        pushed = true;
      }
      if (!pushed) break;
    }
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

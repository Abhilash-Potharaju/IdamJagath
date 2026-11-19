import { type AbstractMesh, type Mesh, Ray, type Scene, type TransformNode, Vector3 } from "@babylonjs/core";
import { isWorld } from "../../game/types";

/**
 * Visual wall clearance for monster models (presentation only; the core's AI, collider and stats are unchanged).
 *
 * A monster's collision ellipsoid is round and much smaller than its model (a crawler's legs reach 1.3 m sideways
 * from a 0.5 m body; a spitter is 4.4 m long on a 0.4 m body). Pressed against a thin wall (the Charminar's stair
 * shaft, the roof parapet), the model used to poke out the far side. A few times a second, short rays from the body
 * measure the free space around it in its own frame; the model then slides away from the walls, and where even that
 * isn't enough (the stair passage), folds in along that axis, so it never renders inside level geometry.
 */

/** Model footprint in the enemy root's local frame (all distances positive, metres from the body centre). */
export interface Footprint { px: number; nx: number; pz: number; nz: number; bottom: number; top: number }

/** Measure a model's bind-pose footprint relative to its enemy root. */
export function measureFootprint(root: TransformNode, meshes: AbstractMesh[]): Footprint {
  root.computeWorldMatrix(true);
  const inv = root.getWorldMatrix().clone().invert();
  const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    for (const v of m.getBoundingInfo().boundingBox.vectorsWorld) {
      const l = Vector3.TransformCoordinates(v, inv);
      mn.minimizeInPlace(l); mx.maximizeInPlace(l);
    }
  }
  return { px: Math.max(0.05, mx.x), nx: Math.max(0.05, -mn.x), pz: Math.max(0.05, mx.z), nz: Math.max(0.05, -mn.z), bottom: mn.y, top: mx.y };
}

/** ?noclearance: A/B the old behaviour (models clip through thin walls). */
const DISABLED = new URLSearchParams(location.search).has("noclearance");
const UPDATE_S = 0.08;       // re-measure period per monster
const RANGE = 45;            // only monsters this close to the camera (beyond it a few cm of clipping can't be seen)
const MARGIN = 0.04;         // keep the model this far off a wall
const MIN_SQUEEZE = 0.45;    // fold legs in to at most this fraction of their span
const SNAP_IN = 30;          // 1/s: ease into a tighter fit fast (no visible clipping while closing on a wall)
const RELAX = 6;             // 1/s: ease back out gently
// 8 directions in the root frame: 4 axes then 4 diagonals
const DIRS = Array.from({ length: 8 }, (_, i) => {
  const a = (i < 4 ? i * 90 : 45 + (i - 4) * 90) * Math.PI / 180;
  return { x: Math.sin(a), z: Math.cos(a) };
});
const isWall = (m: AbstractMesh) => isWorld(m) && m.checkCollisions && m.isEnabled() && !m.isDisposed();

// Wall meshes with their world AABBs, cached per scene and refreshed every second (scene picking tests all ~1300
// meshes per ray; testing only the few walls within a monster's reach is ~50x cheaper, and zero in open ground).
interface Wall { mesh: AbstractMesh; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const wallCache = new WeakMap<Scene, { at: number; walls: Wall[] }>();
function walls(scene: Scene): Wall[] {
  const now = performance.now();
  let c = wallCache.get(scene);
  if (!c || now - c.at > 1000) {
    const list: Wall[] = [];
    for (const mesh of scene.meshes) {
      if (!isWall(mesh)) continue;
      mesh.computeWorldMatrix(true);
      const b = mesh.getBoundingInfo().boundingBox;
      list.push({ mesh, x0: b.minimumWorld.x, x1: b.maximumWorld.x, y0: b.minimumWorld.y, y1: b.maximumWorld.y, z0: b.minimumWorld.z, z1: b.maximumWorld.z });
    }
    c = { at: now, walls: list };
    wallCache.set(scene, c);
  }
  return c.walls;
}

/**
 * Keep `node` (a transform between the enemy root and its model) clear of world geometry. Returns a dispose function.
 * `alive` stops the adjustment (a dying monster keeps its last offset).
 */
export function keepClearOfWalls(scene: Scene, root: TransformNode, node: TransformNode, fp: Footprint, alive: () => boolean): () => void {
  if (DISABLED) return () => {};
  let timer = Math.random() * UPDATE_S;
  const target = { ox: 0, oz: 0, sx: 1, sz: 1 };
  const ray = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
  const heights = [fp.bottom + 0.25, Math.max(fp.bottom + 0.25, Math.min(0.3, fp.top - 0.15))];
  const reach = Math.max(fp.px, fp.nx, fp.pz, fp.nz) + MARGIN, hMin = heights[0], hMax = heights[1];
  const radius = (dx: number, dz: number) => {
    const a = dx >= 0 ? fp.px : fp.nx, b = dz >= 0 ? fp.pz : fp.nz;
    return 1 / Math.sqrt((dx / a) ** 2 + (dz / b) ** 2);
  };

  const measure = () => {
    const yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const p = root.getAbsolutePosition();
    const near: AbstractMesh[] = [];
    for (const w of walls(scene)) {
      if (p.x + reach < w.x0 || p.x - reach > w.x1 || p.z + reach < w.z0 || p.z - reach > w.z1) continue;
      if (p.y + hMax < w.y0 || p.y + hMin > w.y1) continue;
      near.push(w.mesh);
    }
    if (!near.length) { target.ox = target.oz = 0; target.sx = target.sz = 1; return; }
    const free: number[] = [], need: number[] = [];
    for (const d of DIRS) {
      const r = radius(d.x, d.z);
      need.push(r);
      let h = r + MARGIN;
      ray.direction.set(d.x * c + d.z * s, 0, -d.x * s + d.z * c); // root frame -> world (Babylon yaw)
      ray.length = r + MARGIN;
      for (const y of heights) {
        ray.origin.set(p.x, p.y + y, p.z);
        for (const m of near) {
          if (m.isDisposed()) continue;
          const hit = ray.intersectsMesh(m as Mesh, false);
          if (!hit.hit || hit.distance >= h) continue;
          const n = hit.getNormal(true, false);
          if (n && Math.abs(n.y) > 0.7) continue; // floors, stair ramp, roof: walk surfaces, not walls
          h = hit.distance;
        }
      }
      free.push(h - MARGIN);
    }
    // Per axis: fold in if both sides are blocked, then slide into the free span. Axis rays: 0 +z, 1 +x, 2 -z, 3 -x.
    const axis = (fwd: number, back: number, ePos: number, eNeg: number) => {
      const fp_ = Math.max(0, free[fwd]), fn = Math.max(0, free[back]);
      const sq = Math.max(MIN_SQUEEZE, Math.min(1, (fp_ + fn) / (ePos + eNeg)));
      const upper = fp_ - ePos * sq, lower = eNeg * sq - fn;
      const o = upper >= lower ? Math.min(Math.max(0, lower), upper) : (upper + lower) / 2;
      return { sq, o };
    };
    const ax = axis(1, 3, fp.px, fp.nx), az = axis(0, 2, fp.pz, fp.nz);
    let ox = ax.o, oz = az.o;
    // Diagonals: corners (e.g. the spider's splayed legs at a wall corner) push the model along the diagonal
    for (let i = 4; i < 8; i++) {
      const pen = need[i] * Math.min(ax.sq, az.sq) - free[i];
      if (pen > 0) { ox -= DIRS[i].x * pen * 0.7; oz -= DIRS[i].z * pen * 0.7; }
    }
    const lim = Math.max(fp.px, fp.nx, fp.pz, fp.nz);
    target.ox = Math.max(-lim, Math.min(lim, ox));
    target.oz = Math.max(-lim, Math.min(lim, oz));
    target.sx = ax.sq; target.sz = az.sq;
  };

  const obs = scene.onBeforeRenderObservable.add(() => {
    if (!alive() || root.isDisposed()) return;
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    timer -= dt;
    if (timer <= 0) {
      timer += UPDATE_S;
      const cam = scene.activeCamera;
      if (cam && Vector3.DistanceSquared(cam.globalPosition, root.getAbsolutePosition()) < RANGE * RANGE) measure();
      else { target.ox = target.oz = 0; target.sx = target.sz = 1; }
    }
    const fast = 1 - Math.exp(-SNAP_IN * dt), slow = 1 - Math.exp(-RELAX * dt);
    const ease = (cur: number, to: number, tighter: boolean) => cur + (to - cur) * (tighter ? fast : slow);
    node.position.x = ease(node.position.x, target.ox, Math.abs(target.ox) > Math.abs(node.position.x));
    node.position.z = ease(node.position.z, target.oz, Math.abs(target.oz) > Math.abs(node.position.z));
    node.scaling.x = ease(node.scaling.x, target.sx, target.sx < node.scaling.x);
    node.scaling.z = ease(node.scaling.z, target.sz, target.sz < node.scaling.z);
  });
  return () => scene.onBeforeRenderObservable.remove(obs);
}

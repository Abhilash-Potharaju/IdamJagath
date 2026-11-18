import { Vec3 } from "../../src/core/math";
import type { BodyId, HitTarget, InputSnapshot, IPhysics, LevelAnchors, RayHit } from "../../src/core/ports";
import { NO_INPUT } from "../../src/core/ports";
import { GameWorld, type WorldOptions } from "../../src/core/world";
import { GAMEPLAY } from "../../src/data/gameplay";

export interface Box { min: Vec3; max: Vec3 }
export interface SphereTarget { center: () => Vec3; radius: number; target: HitTarget }

/**
 * Tiny deterministic physics for tests: flat ground at y = 0, axis-aligned box walls, bodies as boxes with their
 * half extents (axis-separated slide), rays against walls + sphere targets.
 */
export class FakePhysics implements IPhysics {
  readonly walls: Box[] = [];
  readonly targets: SphereTarget[] = [];
  /** When true the ground stops supporting bodies (to test coyote time). */
  noGround = false;
  private halves = new Map<BodyId, Vec3>();
  private seq = 0;

  createBody(halfExtents: Vec3): BodyId {
    const id = ++this.seq;
    this.halves.set(id, halfExtents.clone());
    return id;
  }

  releaseBody(): void {}

  move(id: BodyId, from: Vec3, disp: Vec3): Vec3 {
    const h = this.halves.get(id) ?? new Vec3(0.4, 0.9, 0.4);
    const p = from.clone();
    p.x += disp.x;
    if (this.hitsWall(p, h)) p.x -= disp.x;
    p.z += disp.z;
    if (this.hitsWall(p, h)) p.z -= disp.z;
    p.y += disp.y;
    if (!this.noGround && p.y - h.y < 0) p.y = h.y;
    return p;
  }

  raycast(origin: Vec3, dir: Vec3, range: number): RayHit | null {
    let best: RayHit | null = null;
    for (const w of this.walls) {
      const t = rayBox(origin, dir, w);
      if (t !== null && t <= range && (!best || t < best.distance)) {
        best = { point: origin.add(dir.scale(t)), normal: dir.scale(-1), distance: t, surface: w };
      }
    }
    for (const s of this.targets) {
      const t = raySphere(origin, dir, s.center(), s.radius);
      if (t !== null && t <= range && (!best || t < best.distance)) {
        best = { point: origin.add(dir.scale(t)), normal: dir.scale(-1), distance: t, target: s.target };
      }
    }
    return best;
  }

  lineOfSight(a: Vec3, b: Vec3): boolean {
    const d = b.subtract(a);
    const len = d.length();
    if (len === 0) return true;
    d.normalize();
    return !this.walls.some((w) => { const t = rayBox(a, d, w); return t !== null && t < len - 0.3; });
  }

  private hitsWall(p: Vec3, h: Vec3): boolean {
    return this.walls.some((w) =>
      p.x + h.x > w.min.x && p.x - h.x < w.max.x && p.y + h.y > w.min.y && p.y - h.y < w.max.y && p.z + h.z > w.min.z && p.z - h.z < w.max.z);
  }
}

function rayBox(o: Vec3, d: Vec3, b: Box): number | null {
  let tmin = 0, tmax = Infinity;
  for (const k of ["x", "y", "z"] as const) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < b.min[k] || o[k] > b.max[k]) return null; continue; }
    let t1 = (b.min[k] - o[k]) / d[k], t2 = (b.max[k] - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const oc = o.subtract(c);
  const b = Vec3.dot(oc, d), cc = Vec3.dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export const LEVEL: LevelAnchors = {
  playerSpawn: new Vec3(0, 1, -8),
  extraction: { x1: -6, x2: 6, z1: -14, z2: -5 },
  cageTrigger: { x1: -4, x2: 4, z1: 101, z2: 105 },
  plazaEntryZ: 64,
  pylonSpots: [new Vec3(-30, 0, 29), new Vec3(18, 0, 72), new Vec3(-18, 0, 100)],
  healthSpots: [new Vec3(-2, 0, 40), new Vec3(20, 0, 105), new Vec3(-33, 0, 37)],
  secretPickup: new Vec3(7.3, 0, 18),
  cageDoor: new Vec3(0, 1.6, 100.15),
};

export function makeWorld(opts: Partial<WorldOptions> = {}, physics = new FakePhysics()): { world: GameWorld; physics: FakePhysics } {
  const world = new GameWorld({ data: GAMEPLAY, level: LEVEL, physics, seed: 1, ...opts });
  // Every enemy is shootable as a sphere around its body centre
  world.events.on("enemySpawned", ({ id }) => {
    const e = () => world.enemies.find((x) => x.id === id);
    physics.targets.push({ center: () => e()?.pos ?? new Vec3(1e6, 1e6, 1e6), radius: 0.6, target: { kind: "enemy", id, mul: 1 } });
  });
  world.start();
  return { world, physics };
}

export const input = (p: Partial<InputSnapshot> = {}): InputSnapshot => ({ ...NO_INPUT, ...p });

/** Run `seconds` of fixed steps with a constant input (or a per-step input function). */
export function run(world: GameWorld, seconds: number, inp: InputSnapshot | ((i: number) => InputSnapshot) = input()): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) world.step(1 / 60, typeof inp === "function" ? inp(i) : inp);
}

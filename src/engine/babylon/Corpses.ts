import { type AbstractMesh, Matrix, MeshBuilder, Quaternion, Ray, type Scene, TransformNode, Vector3, type Mesh } from "@babylonjs/core";
import { isWorld } from "../../game/types";
import { Fx, ichorPoolMaterial } from "./fx";

/**
 * Kill presentation (purely visual; the core forgot the enemy the moment it died).
 *
 * A dying enemy's root is re-parented under a pivot at its body centre. A scripted physical fall then plays:
 * a short stagger along the shot, legs give out (the body squashes), it topples or rolls along the shot with some
 * slide, rests on the ground (never through it: its bind-pose bounding box is kept above the floor every frame),
 * twitches while an ichor pool spreads under it, then (after ~2.5 s) settles slightly and fades out, and is disposed.
 */

/** Per-type death tuning. Angles in rad, distances in m, times in s. */
export interface DeathProfile {
  /** "dir": topple along the shot (tall bodies, flipping bugs); "side": roll onto the flank the shot pushes (long bodies). */
  axis: "dir" | "side";
  tip: number; heavyTip: number; weakTip: number;
  slide: number; heavySlide: number;
  /** Yaw twist (rad) the momentum adds while falling. */
  spin: number;
  stagger: number;
  fall: number;
  /** Body height fraction once the legs give out. */
  squash: number;
  /** Ichor pool radius. */
  pool: number;
  /**
   * Fraction of the horizontal bounds that is rigid when resting on the floor (legs splay and fold, so a leggy bug
   * lies on its body, not on the tips of its legs).
   */
  rigid: number;
}

export const CORPSE = {
  /** Corpses kept at once; beyond this the oldest sinks away early. */
  max: 6,
  /** Seconds a corpse stays on the ground (after landing) before it fades: long enough to read the kill, short enough not to clutter. */
  linger: 2.5,
  /** Seconds to settle a little and fade out. */
  sink: 0.9,
  /** How far (m) it settles into the floor while fading; kept shallow so it never pokes out under the thin roof slab. */
  sinkDepth: 0.15,
  /** Early fade when evicted by the cap. */
  evictSink: 0.4,
  /** Presentation-only hit-stop: the corpse holds its impact pose this long (s). */
  hitStop: 0.045,
  weakHitStop: 0.07,
  /** Seconds for the pool to spread to full size. */
  poolGrow: 1.6,
};
const NO_HITSTOP = new URLSearchParams(location.search).has("nohitstop");

/** Live state the view/model reads to pose limbs (procedural rigs and GLB animations). */
export interface DeathState {
  /** 0 → 1 as the limbs go limp. */
  limp: number;
  /** 0..1 pulse while a twitch plays. */
  twitch: number;
  /** True during hit-stop (animation holds still). */
  frozen: boolean;
}

export interface DeathInfo {
  /** Horizontal unit direction of the killing blow. */
  dir: Vector3;
  /** Where it landed. */
  hit: Vector3;
  weak: boolean;
  /** Heavy weapon (Trishul): stronger knockback. */
  heavy: boolean;
}

export interface CorpseHooks {
  /** Pose limbs: k = limp 0..1, twitch 0..1. */
  limbs(k: number, twitch: number): void;
  /** Dim own glow: k 0..1. */
  dim(k: number): void;
  /** Dispose everything the enemy owned. */
  dispose(): void;
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const isGround = (m: AbstractMesh) => isWorld(m) && m.isEnabled() && !m.isDisposed();

class Corpse {
  private readonly scene: Scene;
  private readonly pivot: TransformNode;
  private readonly hooks: CorpseHooks;
  private readonly state: DeathState;
  private readonly p: DeathProfile;
  private readonly corners: Vector3[] = [];
  private readonly meshes: AbstractMesh[];
  private readonly axis: Vector3;
  private readonly tipDir: Vector3;
  private readonly slideDir: Vector3;
  private readonly start: Vector3;
  private readonly groundY: number;
  private readonly height: number;
  private readonly tip: number;
  private readonly slide: number;
  private readonly spin: number;
  private readonly stagger: number;
  private pool: Mesh | null = null;
  private poolT = 0;
  private t = 0;
  private hold: number;
  private vy = 0;
  private landedAt = -1;
  private sinkAt = Infinity;
  private sinkDur = CORPSE.sink;
  private twitches: number[] = [];
  private readonly mat = new Matrix();
  private readonly tmp = new Vector3();
  done = false;

  constructor(scene: Scene, root: Mesh, profile: DeathProfile, info: DeathInfo, hooks: CorpseHooks, state: DeathState) {
    this.scene = scene;
    this.p = profile;
    this.hooks = hooks;
    this.state = state;
    const strength = info.heavy ? 1 : 0;
    this.tip = info.weak ? Math.max(profile.weakTip, info.heavy ? profile.heavyTip : 0) : info.heavy ? profile.heavyTip : profile.tip;
    this.spin = profile.spin * (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8) * (info.heavy ? 1.5 : 1);
    this.stagger = info.weak ? 0.03 : profile.stagger * (info.heavy ? 0.6 : 1);
    this.hold = NO_HITSTOP ? 0 : info.weak ? CORPSE.weakHitStop : CORPSE.hitStop;

    // Visible bounds (procedural parts hidden under a GLB model are ignored)
    root.computeWorldMatrix(true);
    this.meshes = root.getChildMeshes(false).filter((m) => m.isVisible && m.isEnabled());
    const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of this.meshes) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      mn.minimizeInPlace(b.minimumWorld); mx.maximizeInPlace(b.maximumWorld);
    }
    if (!this.meshes.length) { mn.copyFrom(root.position).addInPlaceFromFloats(-0.4, -0.4, -0.4); mx.copyFrom(root.position).addInPlaceFromFloats(0.4, 0.4, 0.4); }
    const centre = mn.add(mx).scale(0.5);
    this.height = mx.y - mn.y;

    // Ground under the body (roof, stairs, street); fall back to the bounds' bottom
    const down = scene.pickWithRay(new Ray(centre, new Vector3(0, -1, 0), this.height + 3), isGround);
    this.groundY = down?.hit && down.pickedPoint ? Math.max(down.pickedPoint.y, mn.y - 0.3) : mn.y;
    // Corners relative to the pivot (pivot is world-aligned and unscaled at the start)
    for (const x of [mn.x, mx.x]) for (const y of [mn.y, mx.y]) for (const z of [mn.z, mx.z]) {
      const c = new Vector3(x, y, z).subtract(centre);
      this.corners.push(new Vector3(c.x * profile.rigid, c.y, c.z * profile.rigid));
    }

    // Which way it falls: along the shot, or (long bodies) onto the flank the shot pushes
    const dir = info.dir.clone(); dir.y = 0;
    if (dir.lengthSquared() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.slideDir = dir;
    if (profile.axis === "side") {
      const yaw = root.rotation.y;
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const d = Vector3.Dot(dir, right);
      const side = Math.abs(d) < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(d);
      this.tipDir = right.scale(side);
    } else this.tipDir = dir.clone();
    // Rotation axis that tips the body's up toward tipDir (verified numerically; no handedness guesswork)
    const axis = Vector3.Cross(Vector3.Up(), this.tipDir).normalize();
    Matrix.RotationAxisToRef(axis, 0.5, this.mat);
    if (Vector3.Dot(Vector3.TransformNormal(Vector3.Up(), this.mat), this.tipDir) < 0) axis.scaleInPlace(-1);
    this.axis = axis;

    // Slide, stopped short of walls
    let slide = (info.heavy ? profile.heavySlide : profile.slide) * (info.weak ? 0.5 : 1) * (0.8 + Math.random() * 0.4);
    const half = Math.max(mx.x - mn.x, mx.z - mn.z) / 2;
    const wall = scene.pickWithRay(new Ray(new Vector3(centre.x, this.groundY + 0.35, centre.z), dir, slide + half + 0.1),
      (m) => isGround(m) && m.checkCollisions);
    if (wall?.hit) slide = Math.max(0, Math.min(slide, wall.distance - half * 0.6));
    this.slide = slide;

    this.pivot = new TransformNode("corpse", scene);
    this.pivot.position.copyFrom(centre);
    this.pivot.rotationQuaternion = Quaternion.Identity();
    this.start = centre.clone();
    root.setParent(this.pivot);

    // The killing blow: spray from the wound (weak spot / heavy = much more)
    Fx.for(scene).killSpray(info.hit, dir.add(new Vector3(0, 0.25, 0)).normalize(), info.weak ? 2.4 : strength ? 1.7 : 0.8);
    this.twitches = [0.3 + Math.random() * 0.4, ...(Math.random() < 0.6 ? [1.1 + Math.random() * 0.8] : [])]; // within the linger
  }

  /** Cap eviction: sink away soon. */
  evict(): void {
    if (this.sinkAt !== Infinity && this.t >= this.sinkAt) return;
    this.sinkAt = this.t;
    this.sinkDur = CORPSE.evictSink;
  }

  get sinking(): boolean { return this.t >= this.sinkAt; }

  update(dtReal: number): void {
    if (this.done) return;
    const dt = Math.min(dtReal, 0.05);
    if (this.hold > 0) { this.hold -= dt; this.state.frozen = true; return; }
    this.state.frozen = false;
    this.t += dt;
    const p = this.p, t = this.t;

    // Angle: small shove during the stagger, then an accelerating topple, then a damped bounce on landing
    const u = (t - this.stagger) / p.fall;
    let ang: number, squash: number;
    if (u < 0) {
      const s = t / this.stagger;
      ang = 0.12 * Math.sin(s * Math.PI * 0.5);
      squash = 1 - (1 - p.squash) * 0.25 * s;
    } else if (u < 1) {
      ang = 0.12 + (this.tip - 0.12) * u * u;
      squash = 1 - (1 - p.squash) * (0.25 + 0.75 * smooth(u * 1.5));
    } else {
      if (this.landedAt < 0) this.land();
      const tau = t - this.landedAt;
      ang = this.tip - Math.min(0.12, this.tip * 0.08) * Math.exp(-7 * tau) * Math.abs(Math.sin(tau * 16));
      squash = p.squash;
    }
    // Twitches after landing: a quick jerk of the whole body plus the limbs
    let tw = 0;
    if (this.landedAt >= 0) {
      const tau = t - this.landedAt;
      for (const at of this.twitches) { const d = tau - at; if (d > 0 && d < 0.22) tw = Math.max(tw, Math.sin((d / 0.22) * Math.PI)); }
      ang += tw * 0.035;
    }
    const spinNow = this.spin * smooth(u);
    const limp = Math.min(1, Math.max(0, (t - this.stagger * 0.5) / (p.fall * 0.9)));
    this.state.limp = limp;
    this.state.twitch = tw;
    this.hooks.limbs(limp, tw);
    this.hooks.dim(Math.min(1, t / (this.stagger + p.fall + 0.6)));

    // Rotation matrix: squash (body frame) → tip → yaw twist
    Matrix.ScalingToRef(1 + (1 - squash) * 0.3, squash, 1 + (1 - squash) * 0.3, this.mat);
    const r = Matrix.RotationAxis(this.axis, ang).multiply(Matrix.RotationY(spinNow)); // tip, then twist about world up (keeps it on the floor)
    const m = this.mat.multiply(r);
    Quaternion.FromRotationMatrixToRef(r, this.pivot.rotationQuaternion!);
    this.pivot.scaling.set(1 + (1 - squash) * 0.3, squash, 1 + (1 - squash) * 0.3);

    // Horizontal: stagger shove + slide with friction
    const shove = 0.1 * smooth(t / Math.max(0.01, this.stagger));
    const sl = this.slide * (1 - Math.exp(-3.2 * Math.max(0, t - this.stagger * 0.5)));
    this.pivot.position.x = this.start.x + this.slideDir.x * (shove + sl);
    this.pivot.position.z = this.start.z + this.slideDir.z * (shove + sl);

    // Vertical: gravity, but the rotated bounds never go below the floor (rolls over edges, pops when flipping)
    let minY = Infinity;
    for (const c of this.corners) { Vector3.TransformCoordinatesToRef(c, m, this.tmp); minY = Math.min(minY, this.tmp.y); }
    const rest = this.groundY - minY - 0.02 * limp; // settle a touch into soft ground as it goes limp
    if (t >= this.sinkAt) {
      const k = Math.min(1, (t - this.sinkAt) / this.sinkDur);
      this.pivot.position.y = rest - Math.min(CORPSE.sinkDepth, this.height * 0.3) * k;
      const vis = 1 - smooth(k / 0.85); // fades in place (a deep sink went through the roof slab)
      for (const mm of this.meshes) if (!mm.isDisposed()) mm.visibility = vis;
      if (this.pool) this.pool.visibility = vis;
      if (k >= 1) this.dispose();
      return;
    }
    this.vy -= 18 * dt;
    let y = this.pivot.position.y + this.vy * dt;
    if (y <= rest) { y = rest; this.vy = 0; }
    this.pivot.position.y = y;

    if (this.pool) {
      this.poolT += dt;
      const g = 1 - Math.pow(1 - Math.min(1, this.poolT / CORPSE.poolGrow), 2.2);
      this.pool.scaling.setAll(p.pool * 2 * (0.12 + 0.88 * g));
      // follows the body if it is still sliding
      this.pool.position.x = this.pivot.position.x; this.pool.position.z = this.pivot.position.z;
    }
    if (this.landedAt >= 0 && t - this.landedAt > CORPSE.linger && this.sinkAt === Infinity) this.sinkAt = t;
  }

  private land(): void {
    this.landedAt = this.t;
    const fx = Fx.for(this.scene);
    const at = new Vector3(this.pivot.position.x, this.groundY + 0.05, this.pivot.position.z);
    fx.dust.emit(at, new Vector3(0, 0.4, 0), Math.round(3 + this.p.pool * 3), 1.1, 1.4);
    // Ichor pool on the floor under the body
    const pool = MeshBuilder.CreatePlane("ichor-pool", { size: 1 }, this.scene);
    pool.isPickable = false;
    pool.material = ichorPoolMaterial(this.scene);
    pool.rotation.set(Math.PI / 2, Math.random() * Math.PI * 2, 0);
    pool.position.set(at.x, this.groundY + 0.012, at.z);
    pool.scaling.setAll(0.01);
    pool.receiveShadows = true;
    this.pool = pool;
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    this.hooks.dispose();
    this.pool?.dispose();
    this.pivot.dispose();
  }
}

/** Scene-wide corpse list: drives the falls and enforces the cap. */
export class Corpses {
  private static byScene = new WeakMap<Scene, Corpses>();
  static for(scene: Scene): Corpses {
    let c = Corpses.byScene.get(scene);
    if (!c) { c = new Corpses(scene); Corpses.byScene.set(scene, c); }
    return c;
  }

  private list: Corpse[] = [];

  private constructor(scene: Scene) {
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (const c of this.list) c.update(dt);
      if (this.list.some((c) => c.done)) this.list = this.list.filter((c) => !c.done);
    });
  }

  add(scene: Scene, root: Mesh, profile: DeathProfile, info: DeathInfo, hooks: CorpseHooks, state: DeathState): void {
    this.list.push(new Corpse(scene, root, profile, info, hooks, state));
    // Over the cap: oldest still-resting corpses sink away early; hard cap disposes immediately
    let resting = this.list.filter((c) => !c.sinking);
    while (resting.length > CORPSE.max) { resting[0].evict(); resting = resting.slice(1); }
    while (this.list.length > CORPSE.max * 2) this.list.shift()!.dispose();
  }

  /** Live corpse count (tests). */
  get count(): number { return this.list.length; }

  /** Dev/test: advance every corpse by `seconds` in 1/60 s steps (headless renders run at ~1 FPS). */
  advance(seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 60) for (const c of this.list) c.update(1 / 60);
    this.list = this.list.filter((c) => !c.done);
  }
}

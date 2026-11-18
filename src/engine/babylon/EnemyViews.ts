import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Crawler, Enemy, Spitter, Warden } from "../../core/entities/enemies";
import type { GameWorld } from "../../core/world";
import { burst } from "./fx";
import { attachMonsterModel } from "./monsterModels";
import { setTarget, type DamageFn } from "./convert";
import { lerp } from "../../core/math";
import { GAMEPLAY } from "../../data/gameplay";

// Visual-only tuning that mirrors gameplay data (weak spot multipliers come from enemies.json)
const CR = GAMEPLAY.enemies.crawler, SP = GAMEPLAY.enemies.spitter;

/** Per-instance material (its colours may be animated). */
function mat(scene: Scene, diffuse: string, emissive = "#000000"): StandardMaterial {
  const m = new StandardMaterial("e", scene);
  m.diffuseColor = Color3.FromHexString(diffuse);
  m.emissiveColor = Color3.FromHexString(emissive);
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  m.maxSimultaneousLights = 8;
  return m;
}

/** Material shared by every enemy of a type (never animated, never disposed with an enemy). */
const sharedCache = new Map<string, StandardMaterial>();
function shared(scene: Scene, key: string, diffuse: string, emissive = "#000000"): StandardMaterial {
  const k = `${scene.uid}:${key}`;
  let m = sharedCache.get(k);
  if (!m) {
    m = mat(scene, diffuse, emissive);
    m.name = "shared-" + key;
    sharedCache.set(k, m);
  }
  return m;
}

function node(name: string, scene: Scene, parent: TransformNode, x = 0, y = 0, z = 0): TransformNode {
  const n = new TransformNode(name, scene);
  n.parent = parent;
  n.position.set(x, y, z);
  return n;
}

/** Frame-rate independent ease toward a target. */
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);
const WHITE = new Color3(1, 1, 1);
const TELL: Record<string, Color3> = {
  lunge: new Color3(1, 0.45, 0),
  charge: new Color3(1, 0.1, 0.1),
  stunned: new Color3(0.9, 0.8, 0.1),
};

/**
 * Base enemy presentation. The root is the physics body mesh (its collision ellipsoid is moved by the core through
 * IPhysics); visual parts parent to it, are tagged as shootable, and animate from the core enemy's state.
 */
export abstract class EnemyView {
  readonly core: Enemy;
  readonly root: Mesh;
  protected readonly scene: Scene;
  readonly damage: DamageFn;
  bodyMat: StandardMaterial;
  protected restEmissive: Color3;
  /** Animation clock, per-instance offset so a group doesn't move in lockstep. */
  protected time = Math.random() * 10;
  /** Measured horizontal speed (m/s), drives walk cycles. */
  protected speed = 0;
  /** 1 right after being hit, decays to 0: drives the flinch pose. */
  protected flinch = 0;
  protected deathTime = 0.5;
  protected deathColor = "#b06cff";
  protected deathSize = 0.6;
  private ownMats: StandardMaterial[] = [];
  private flashT = 0;
  private lastPos: Vector3;
  private prev: Vector3;
  private cur: Vector3;
  private prevYaw = 0;
  private curYaw = 0;
  private dying = false;

  constructor(scene: Scene, core: Enemy, root: Mesh, bodyMat: StandardMaterial, damage: DamageFn) {
    this.scene = scene;
    this.core = core;
    this.root = root;
    this.damage = damage;
    this.bodyMat = this.own(bodyMat);
    this.restEmissive = bodyMat.emissiveColor.clone();
    this.cur = new Vector3(core.pos.x, core.pos.y, core.pos.z);
    this.prev = this.cur.clone();
    this.lastPos = this.cur.clone();
    this.curYaw = this.prevYaw = core.yaw;
    root.position.copyFrom(this.cur);
  }

  get alive(): boolean { return this.core.alive; }

  protected own<T extends StandardMaterial>(m: T): T {
    this.ownMats.push(m);
    return m;
  }

  /** Make a mesh a shootable part of this enemy; `mul` scales damage (weak spots). */
  protected part(m: Mesh, mul = 1, parent: TransformNode = this.root, material: StandardMaterial = this.bodyMat): Mesh {
    m.parent = parent;
    m.material = material;
    m.isPickable = true;
    setTarget(m, { kind: "enemy", id: this.core.id, mul }, this.damage);
    return m;
  }

  onHurt(): void {
    this.flashT = 0.06;
    this.flinch = 1;
  }

  /** Before a simulation step: put the body exactly where the core has it (so shots test the true position). */
  snap(): void {
    if (this.dying) return;
    this.root.position.set(this.core.pos.x, this.core.pos.y, this.core.pos.z);
    this.root.rotation.y = this.core.yaw;
  }

  /** After a simulation step: remember the last two states for interpolation. */
  record(): void {
    this.prev.copyFrom(this.cur);
    this.cur.set(this.core.pos.x, this.core.pos.y, this.core.pos.z);
    this.prevYaw = this.curYaw;
    this.curYaw = this.core.yaw;
  }

  /** Per render frame: interpolate the transform and animate. */
  render(alpha: number, dt: number): void {
    if (this.dying || this.root.isDisposed()) return;
    Vector3.LerpToRef(this.prev, this.cur, alpha, this.root.position);
    this.root.rotation.y = lerp(this.prevYaw, this.curYaw, alpha);
    this.time += dt;
    this.flinch = Math.max(0, this.flinch - dt * 7);
    if (this.flashT > 0) this.flashT -= dt;
    const base = TELL[this.core.tell] ?? this.restEmissive;
    this.bodyMat.emissiveColor = this.flashT > 0 ? WHITE.clone() : base.clone();
    const p = this.root.position;
    this.speed = dt > 0 ? Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / dt : 0;
    this.lastPos.copyFrom(p);
    this.animate(dt);
  }

  /** Death: no longer shootable; a short collapse animation plays, then the meshes are disposed. */
  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.bodyMat.emissiveColor = this.restEmissive.clone();
    for (const m of this.root.getChildMeshes()) m.isPickable = false;
    const scene = this.scene;
    const startY = this.root.position.y;
    let k = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      k = Math.min(1, k + scene.getEngine().getDeltaTime() / 1000 / this.deathTime);
      this.deathPose(k, startY);
      if (k >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        burst(scene, this.root.getAbsolutePosition().clone(), this.deathColor, this.deathSize, 0.35);
        this.root.dispose(false, false); // shared materials must survive
        for (const m of this.ownMats) m.dispose();
      }
    });
  }

  /** Default death pose: tip over sideways, sink and shrink. k goes 0 → 1. */
  protected deathPose(k: number, startY: number): void {
    const e = k * k;
    this.root.rotation.z = e * 1.5;
    this.root.position.y = startY - this.core.halfHeight * 0.55 * e;
    this.root.scaling.setAll(1 - 0.35 * e);
  }

  /** Pose the rig for this frame (purely visual). */
  protected abstract animate(dt: number): void;
}

// ───────────────────────── CRAWLER ─────────────────────────

interface Leg { hip: TransformNode; knee: TransformNode; side: number; group: number; baseYaw: number }

export class CrawlerView extends EnemyView {
  declare readonly core: Crawler;
  private rig: TransformNode;
  private head: TransformNode;
  private mandibles: TransformNode[] = [];
  private legs: Leg[] = [];
  private gait = Math.random() * 6;
  private crouch = 0;
  private tuck = 0;
  private open = 0;
  private twitchT = 0;
  private twitchYaw = 0;

  constructor(scene: Scene, core: Crawler, root: Mesh, damage: DamageFn) {
    super(scene, core, root, mat(scene, "#5a1f2e", "#1a0408"), damage);
    const s = scene;
    const shell = shared(s, "crawler-shell", "#2e0f18", "#0a0204");
    const eyeMat = shared(s, "crawler-eye", "#000000", "#ffdd33");

    this.rig = node("crawler-rig", s, this.root);
    const thorax = this.part(MeshBuilder.CreateSphere("crawler", { diameter: 1, segments: 8 }, s), 1, this.rig);
    thorax.scaling.set(0.7, 0.42, 0.72);
    thorax.position.set(0, 0.02, 0.14);
    const ab1 = this.part(MeshBuilder.CreateSphere("crawler", { diameter: 1, segments: 8 }, s), 1, this.rig);
    ab1.scaling.set(0.8, 0.5, 0.62);
    ab1.position.set(0, 0.07, -0.36);
    const ab2 = this.part(MeshBuilder.CreateSphere("crawler", { diameter: 1, segments: 8 }, s), 1, this.rig, shell);
    ab2.scaling.set(0.58, 0.4, 0.5);
    ab2.position.set(0, 0.1, -0.76);
    for (const [z, h] of [[0.1, 0.22], [-0.3, 0.28], [-0.66, 0.2]] as const) {
      const sp = this.part(MeshBuilder.CreateCylinder("spike", { diameterTop: 0, diameterBottom: 0.12, height: h, tessellation: 5 }, s), 1, this.rig, shell);
      sp.position.set(0, 0.3 + h / 3, z);
      sp.rotation.x = -0.5;
    }
    this.head = node("crawler-head", s, this.rig, 0, 0.04, 0.5);
    const headM = this.part(MeshBuilder.CreateSphere("crawler-head", { diameter: 1, segments: 8 }, s), 1, this.head);
    headM.scaling.set(0.46, 0.34, 0.42);
    for (const x of [-0.12, 0.12]) {
      const e = this.part(MeshBuilder.CreateSphere("eye", { diameter: 0.13, segments: 6 }, s), CR.weakSpots.eye, this.head, eyeMat);
      e.position.set(x, 0.08, 0.17);
    }
    for (const side of [-1, 1]) {
      const n = node("mandible", s, this.head, side * 0.1, -0.07, 0.16);
      const md = this.part(MeshBuilder.CreateBox("mandible", { width: 0.05, height: 0.05, depth: 0.28 }, s), 1, n, shell);
      md.position.z = 0.12;
      md.rotation.y = -side * 0.25;
      this.mandibles.push(n);
    }
    const zs = [0.3, 0.06, -0.2];
    for (const side of [1, -1]) {
      zs.forEach((z, i) => {
        const hip = node("hip", s, this.rig, side * 0.27, 0, z);
        const baseYaw = -side * (1 - i) * 0.45;
        hip.rotation.y = baseYaw;
        const upper = this.part(MeshBuilder.CreateBox("leg", { width: 0.46, height: 0.07, depth: 0.07 }, s), 1, hip, shell);
        upper.position.set(side * 0.2, 0.11, 0);
        upper.rotation.z = side * 0.5;
        const knee = node("knee", s, hip, side * 0.4, 0.22, 0);
        const lower = this.part(MeshBuilder.CreateBox("leg", { width: 0.06, height: 0.64, depth: 0.06 }, s), 1, knee, shell);
        lower.position.set(side * 0.1, -0.3, 0);
        lower.rotation.z = side * 0.3;
        this.legs.push({ hip, knee, side, group: (i + (side > 0 ? 0 : 1)) % 2, baseYaw });
      });
    }
    attachMonsterModel(this, CR.model);
  }

  protected animate(dt: number): void {
    const windup = this.core.state === "windup";
    const lunge = this.core.state === "lunge";
    this.crouch = approach(this.crouch, windup ? 1 : 0, 14, dt);
    this.tuck = approach(this.tuck, lunge ? 1 : 0, 18, dt);
    this.open = approach(this.open, windup || lunge ? 1 : 0, 16, dt);
    const moving = Math.min(1, this.speed / 4);
    this.gait += dt * (1.5 + Math.min(this.speed, 8) * 2.4);
    for (const L of this.legs) {
      const ph = this.gait + L.group * Math.PI;
      const swing = moving * 0.45 * Math.sin(ph) * (1 - this.tuck);
      const lift = moving * 0.4 * Math.max(0, Math.cos(ph)) * (1 - this.tuck);
      L.hip.rotation.y = L.baseYaw - L.side * (swing - 0.75 * this.tuck);
      L.hip.rotation.z = L.side * (lift + 0.3 * this.tuck - 0.35 * this.crouch);
      L.knee.rotation.z = L.side * (-0.35 * this.crouch + 0.5 * this.tuck);
    }
    const breathe = Math.sin(this.time * 2.2) * 0.025;
    const bob = moving * 0.05 * Math.abs(Math.sin(this.gait));
    this.rig.position.y = breathe + bob - this.crouch * 0.16 + this.tuck * 0.05 - this.flinch * 0.06;
    this.rig.rotation.x = -this.flinch * 0.3 + this.tuck * 0.18 - this.crouch * 0.12;
    this.rig.rotation.z = Math.sin(this.gait * 2) * 0.04 * moving;
    this.rig.scaling.y = 1 - this.crouch * 0.12;
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchYaw = (Math.random() - 0.5) * 0.7;
      this.twitchT = 0.12 + Math.random() * 0.45;
    }
    this.head.rotation.y = approach(this.head.rotation.y, windup ? 0 : this.twitchYaw, 22, dt);
    this.head.rotation.x = -0.3 * this.open;
    this.mandibles[0].rotation.y = 0.15 + this.open * 0.75 + Math.sin(this.time * 18) * 0.05;
    this.mandibles[1].rotation.y = -(0.15 + this.open * 0.75 + Math.sin(this.time * 18 + 1) * 0.05);
  }

  /** Flips onto its back, legs curling. */
  protected deathPose(k: number, startY: number): void {
    const e = k * k;
    this.root.rotation.z = e * 2.9;
    this.root.position.y = startY + Math.sin(k * Math.PI) * 0.4 - e * 0.1;
    this.root.scaling.setAll(1 - 0.25 * e);
    for (const L of this.legs) {
      L.hip.rotation.z = L.side * (0.6 * k);
      L.knee.rotation.z = L.side * (1.2 * k + Math.sin(k * 40) * 0.2 * (1 - k));
    }
  }
}

// ───────────────────────── SPITTER ─────────────────────────

export class SpitterView extends EnemyView {
  declare readonly core: Spitter;
  private sac: Mesh;
  private sacMat: StandardMaterial;
  private base: Mesh;
  private segs: TransformNode[] = [];
  private tendrils: TransformNode[] = [];
  private rear = 0;
  private snapT = 0;
  private wasWinding = false;

  constructor(scene: Scene, core: Spitter, root: Mesh, damage: DamageFn) {
    super(scene, core, root, mat(scene, "#2f4a2a", "#061006"), damage);
    const s = scene;
    const ridge = shared(s, "spitter-ridge", "#1b2c18", "#020602");
    this.base = this.part(MeshBuilder.CreateCylinder("spitter", { diameterTop: 0.5, diameterBottom: 0.95, height: 0.55, tessellation: 9 }, s));
    this.base.position.y = -0.82;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const n = node("tendril", s, this.root, Math.sin(a) * 0.38, -1.0, Math.cos(a) * 0.38);
      n.rotation.y = a;
      const tm = this.part(MeshBuilder.CreateCylinder("tendril", { diameterTop: 0.02, diameterBottom: 0.09, height: 0.6, tessellation: 5 }, s), 1, n, ridge);
      tm.rotation.x = Math.PI / 2;
      tm.position.z = 0.28;
      this.tendrils.push(n);
    }
    let parent: TransformNode = this.root;
    for (let i = 0; i < 4; i++) {
      const n = node("neck", s, parent, 0, i === 0 ? -0.55 : 0.4, 0);
      const seg = this.part(MeshBuilder.CreateCylinder("spitter", {
        diameterTop: 0.36 - i * 0.05, diameterBottom: 0.46 - i * 0.05, height: 0.42, tessellation: 8,
      }, s), 1, n);
      seg.position.y = 0.2;
      const ring = this.part(MeshBuilder.CreateTorus("ring", { diameter: 0.44 - i * 0.05, thickness: 0.06, tessellation: 10 }, s), 1, n, ridge);
      ring.position.y = 0.02;
      this.segs.push(n);
      parent = n;
    }
    this.sacMat = this.own(mat(s, "#000000", "#4dff4d"));
    this.sac = this.part(MeshBuilder.CreateSphere("sac", { diameter: 0.7, segments: 8 }, s), SP.weakSpots.sac, parent, this.sacMat);
    this.sac.position.y = 0.55;
    const beak = this.part(MeshBuilder.CreateCylinder("beak", { diameterTop: 0, diameterBottom: 0.2, height: 0.35, tessellation: 6 }, s), 1, parent, ridge);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.35, 0.3);
    attachMonsterModel(this, SP.model, (local) => core.muzzleLocal.set(local.x, local.y, local.z));
  }

  protected animate(dt: number): void {
    const windup = this.core.windup;
    if (windup > 0) {
      const k = 1 - windup / SP.fire.windup;
      this.sac.scaling.setAll(1 + k * 0.6);
      this.sacMat.emissiveColor = Color3.Lerp(Color3.FromHexString("#4dff4d"), new Color3(0.9, 1, 0.6), k);
    } else if (this.wasWinding) {
      // Just fired
      this.sac.scaling.setAll(1);
      this.sacMat.emissiveColor = Color3.FromHexString("#4dff4d");
      this.snapT = 1;
    }
    this.wasWinding = windup > 0;
    this.rear = approach(this.rear, windup > 0 ? 1 : 0, 7, dt);
    this.snapT = Math.max(0, this.snapT - dt * 3.5);
    const snapBend = Math.sin(this.snapT * Math.PI) * 0.32;
    const moving = Math.min(1, this.speed / 3);
    this.segs.forEach((n, i) => {
      n.rotation.z = Math.sin(this.time * 1.3 + i * 0.6) * 0.07 + moving * Math.sin(this.time * 4 + i) * 0.03;
      n.rotation.x = Math.sin(this.time * 1.1 + i * 0.7) * 0.05 - 0.2 * this.rear + snapBend + (i === 0 ? -this.flinch * 0.25 : 0);
    });
    const breathe = Math.sin(this.time * 2.2);
    this.base.scaling.set(1 + breathe * 0.05, 1 - breathe * 0.04, 1 + breathe * 0.05);
    if (windup <= 0) this.sac.scaling.setAll(1 + Math.max(0, Math.sin(this.time * 2.2)) * 0.06);
    this.tendrils.forEach((n, i) => {
      n.rotation.x = 0.55 + Math.sin(this.time * 3.2 + i * 1.7) * 0.25;
      n.rotation.z = Math.sin(this.time * 2.1 + i) * 0.2;
    });
  }

  protected deathPose(k: number, startY: number): void {
    super.deathPose(k, startY);
    this.segs.forEach((n, i) => { n.rotation.x = k * (0.3 + i * 0.12); });
  }
}

// ───────────────────────── WARDEN ─────────────────────────

export class WardenView extends EnemyView {
  declare readonly core: Warden;
  private shield: Mesh;
  private torso: TransformNode;
  private head: TransformNode;
  private arms: { root: TransformNode; elbow: TransformNode; side: number }[] = [];
  private legs: { hip: TransformNode; knee: TransformNode; side: number }[] = [];
  private gait = 0;
  private rearUp = 0;
  private lean = 0;
  private slump = 0;
  private sparkT = 0;
  private lastStep = 0;
  private thudDone = false;

  constructor(scene: Scene, core: Warden, root: Mesh, damage: DamageFn) {
    super(scene, core, root, mat(scene, "#3b2a4f", "#12061f"), damage);
    this.deathTime = 0.9;
    this.deathColor = "#ffe066";
    this.deathSize = 2.2;
    const s = scene;
    const armor = shared(s, "warden-armor", "#221830", "#05020a");
    const horn = shared(s, "warden-horn", "#d8cfc0", "#1a1410");
    const eyeMat = shared(s, "warden-eye", "#000000", "#ff5a3a");
    for (const side of [-1, 1]) {
      const hip = node("hip", s, this.root, side * 0.55, -0.35, -0.05);
      const thigh = this.part(MeshBuilder.CreateBox("warden", { width: 0.62, height: 0.75, depth: 0.7 }, s), 1, hip);
      thigh.position.y = -0.35;
      const knee = node("knee", s, hip, 0, -0.7, 0);
      const shin = this.part(MeshBuilder.CreateBox("warden", { width: 0.52, height: 0.5, depth: 0.58 }, s), 1, knee, armor);
      shin.position.y = -0.2;
      const foot = this.part(MeshBuilder.CreateBox("foot", { width: 0.7, height: 0.16, depth: 0.95 }, s), 1, knee, armor);
      foot.position.set(0, -0.42, 0.15);
      this.legs.push({ hip, knee, side });
    }
    this.torso = node("torso", s, this.root, 0, 0.05, 0);
    const chest = this.part(MeshBuilder.CreateBox("warden", { width: 2.0, height: 1.4, depth: 1.3 }, s), 1, this.torso);
    chest.position.y = 0.75;
    const belly = this.part(MeshBuilder.CreateBox("warden", { width: 1.5, height: 0.6, depth: 1.1 }, s), 1, this.torso);
    belly.position.y = -0.05;
    for (const side of [-1, 1]) {
      const plate = this.part(MeshBuilder.CreateBox("plate", { width: 0.9, height: 0.35, depth: 1.15 }, s), 1, this.torso, armor);
      plate.position.set(side * 1.05, 1.42, 0);
      plate.rotation.z = -side * 0.35;
    }
    for (const [y, h] of [[1.45, 0.45], [1.05, 0.38], [0.65, 0.3]] as const) {
      const sp = this.part(MeshBuilder.CreateCylinder("spine", { diameterTop: 0, diameterBottom: 0.22, height: h, tessellation: 5 }, s), 1, this.torso, armor);
      sp.position.set(0, y, -0.68);
      sp.rotation.x = -1.0;
    }
    this.head = node("head", s, this.torso, 0, 1.3, 0.62);
    this.part(MeshBuilder.CreateBox("warden", { width: 0.75, height: 0.6, depth: 0.75 }, s), 1, this.head);
    const jaw = this.part(MeshBuilder.CreateBox("jaw", { width: 0.62, height: 0.2, depth: 0.5 }, s), 1, this.head, armor);
    jaw.position.set(0, -0.36, 0.15);
    for (const side of [-1, 1]) {
      const e = this.part(MeshBuilder.CreateBox("eye", { width: 0.16, height: 0.06, depth: 0.04 }, s), 1, this.head, eyeMat);
      e.position.set(side * 0.18, 0.08, 0.38);
      const hn = this.part(MeshBuilder.CreateCylinder("horn", { diameterTop: 0, diameterBottom: 0.2, height: 1.0, tessellation: 6 }, s), 1, this.head, horn);
      hn.position.set(side * 0.55, 0.45, -0.05);
      hn.rotation.z = -side * 0.95;
      hn.rotation.x = -0.25;
    }
    for (const side of [-1, 1]) {
      const sh = node("shoulder", s, this.torso, side * 1.2, 1.05, 0);
      const upper = this.part(MeshBuilder.CreateBox("warden", { width: 0.5, height: 0.9, depth: 0.55 }, s), 1, sh);
      upper.position.y = -0.4;
      const elbow = node("elbow", s, sh, 0, -0.85, 0);
      const fore = this.part(MeshBuilder.CreateBox("forearm", { width: 0.6, height: 0.8, depth: 0.65 }, s), 1, elbow, armor);
      fore.position.y = -0.35;
      const fist = this.part(MeshBuilder.CreateBox("warden", { width: 0.7, height: 0.5, depth: 0.7 }, s), 1, elbow);
      fist.position.y = -0.85;
      this.arms.push({ root: sh, elbow, side });
    }
    // Shield (absorbs fire; toggled by the core's "shield" event)
    const sm = this.own(mat(s, "#000000", "#5a2cff"));
    sm.alpha = 0.55;
    this.shield = MeshBuilder.CreateBox("shield", { width: 2.8, height: 3.0, depth: 0.2 }, s);
    this.shield.material = sm;
    this.shield.parent = this.root;
    this.shield.position.set(0, 0.1, 1.15);
    this.shield.isPickable = true;
    setTarget(this.shield, { kind: "shield", id: core.id, mul: 1 }, damage);
  }

  setShield(up: boolean): void { this.shield.setEnabled(up); }
  shieldBurst(at: Vector3): void { burst(this.scene, at, "#5a2cff", 0.35, 0.12); }
  landed(at: Vector3): void { burst(this.scene, at, "#8a5cff", 3, 0.4); this.flinch = 1; }
  stunned(at: Vector3): void { burst(this.scene, at, "#ffe066", 2, 0.3); }

  protected animate(dt: number): void {
    const st = this.core.state;
    this.rearUp = approach(this.rearUp, st === "windup" ? 1 : 0, 6, dt);
    this.lean = approach(this.lean, st === "charge" ? 1 : 0, 10, dt);
    this.slump = approach(this.slump, st === "stunned" ? 1 : 0, 8, dt);
    const falling = st === "drop";
    const moving = falling ? 0 : Math.min(1, this.speed / 2.5);
    this.gait += dt * (1.2 + Math.min(this.speed, 22) * 0.9);
    const sg = Math.sin(this.gait);
    for (const L of this.legs) {
      const s = sg * L.side;
      L.hip.rotation.x = falling ? -0.5 : s * 0.5 * moving - 0.25 * this.lean;
      L.knee.rotation.x = falling ? 0.9 : Math.max(0, -Math.cos(this.gait + (L.side > 0 ? 0 : Math.PI))) * 0.6 * moving + 0.35 * this.slump;
    }
    const step = Math.abs(sg);
    this.torso.position.y = 0.05 - (1 - step) * 0.12 * moving - this.slump * 0.25 + Math.sin(this.time * 2) * 0.02;
    if (moving > 0.5 && step < 0.15 && this.lastStep >= 0.15) {
      burst(this.scene, this.root.position.add(new Vector3(0, -1.45, 0)), "#4a3a5e", 0.8, 0.2);
    }
    this.lastStep = step;
    this.torso.rotation.x = -0.45 * this.rearUp + 0.45 * this.lean + 0.55 * this.slump - this.flinch * 0.15;
    this.torso.rotation.z = sg * 0.06 * moving + Math.sin(this.time * 6) * 0.04 * this.slump;
    this.torso.scaling.x = 1 + Math.sin(this.time * 2) * 0.02;
    for (const A of this.arms) {
      const swing = -sg * A.side * 0.35 * moving;
      A.root.rotation.x = falling ? -1.2 : swing - 1.5 * this.rearUp + 0.9 * this.lean + 0.3 * this.slump;
      A.root.rotation.z = A.side * (0.12 + 0.45 * this.rearUp + (falling ? 0.6 : 0));
      A.elbow.rotation.x = -0.5 * this.rearUp - 0.3 * this.lean + 0.2 * this.slump;
    }
    this.head.rotation.x = -0.35 * this.rearUp + 0.25 * this.lean + 0.45 * this.slump;
    this.head.rotation.z = Math.sin(this.time * 3) * 0.35 * this.slump;
    this.head.rotation.y = Math.sin(this.time * 0.7) * 0.12 * (1 - this.slump);
    if (this.slump > 0.5) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.18;
        const p = this.head.getAbsolutePosition().add(new Vector3((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 1.2));
        burst(this.scene, p, "#ffe066", 0.25, 0.18);
      }
    }
  }

  protected deathPose(k: number, startY: number): void {
    const e = k * k;
    this.root.rotation.x = e * 1.45;
    this.root.position.y = startY - 0.9 * e;
    this.torso.rotation.x = 0.4 * k;
    this.head.rotation.x = 0.6 * k;
    for (const A of this.arms) A.root.rotation.x = -1.2 * k;
    if (k > 0.85 && !this.thudDone) {
      this.thudDone = true;
      burst(this.scene, this.root.position.add(new Vector3(0, -0.6, 0)), "#3a2e48", 1.6, 0.25);
    }
  }

  die(): void {
    this.shield.setEnabled(false);
    super.die();
  }
}

/** Creates/destroys enemy views from core events and drives them each frame. */
export class EnemyViews {
  readonly views = new Map<number, EnemyView>();

  constructor(scene: Scene, world: GameWorld, bodyMesh: (body: number) => Mesh | undefined, damage: DamageFn) {
    const ev = world.events;
    ev.on("enemySpawned", (e) => {
      const core = world.enemies.find((x) => x.id === e.id);
      const root = bodyMesh(e.body);
      if (!core || !root) return;
      const v = e.type === "crawler" ? new CrawlerView(scene, core as Crawler, root, damage)
        : e.type === "spitter" ? new SpitterView(scene, core as Spitter, root, damage)
        : new WardenView(scene, core as Warden, root, damage);
      this.views.set(e.id, v);
    });
    ev.on("enemyHurt", (e) => this.views.get(e.id)?.onHurt());
    ev.on("enemyKilled", (e) => { this.views.get(e.id)?.die(); this.views.delete(e.id); });
    const warden = (id: number) => this.views.get(id) as WardenView | undefined;
    ev.on("shield", (e) => warden(e.id)?.setShield(e.up));
    ev.on("shieldHit", (e) => warden(e.id)?.shieldBurst(new Vector3(e.at.x, e.at.y, e.at.z)));
    ev.on("wardenLanded", (e) => warden(e.id)?.landed(new Vector3(e.at.x, e.at.y, e.at.z)));
    ev.on("wardenStunned", (e) => warden(e.id)?.stunned(new Vector3(e.at.x, e.at.y, e.at.z)));
  }

  snap(): void { for (const v of this.views.values()) v.snap(); }
  record(): void { for (const v of this.views.values()) v.record(); }
  render(alpha: number, dt: number): void { for (const v of this.views.values()) v.render(alpha, dt); }
}

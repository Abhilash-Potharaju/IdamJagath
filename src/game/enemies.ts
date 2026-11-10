import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Player } from "./Player";
import type { HUD } from "./HUD";
import { setDamageable, type Damageable } from "./types";
import { burst } from "./fx";
import type { SoundName } from "./Audio";
import { Feel } from "./feel";
import { attachMonsterModel, CRAWLER_MODEL, SPITTER_MODEL } from "./monsterModels";
import { GAMEPLAY } from "../data/gameplay";

// Tuning from data/gameplay/enemies.json (engine-neutral)
const CR = GAMEPLAY.enemies.crawler, SP = GAMEPLAY.enemies.spitter, WA = GAMEPLAY.enemies.warden;

/** What enemies need from the game, kept narrow to avoid circular deps. */
export interface GameCtx {
  scene: Scene;
  player: Player;
  hud: HUD;
  /** True when nothing solid sits between a and b. */
  los(a: Vector3, b: Vector3): boolean;
  spawnGlob(from: Vector3, dir: Vector3): void;
  onEnemyKilled(e: Enemy): void;
  /** One-time tutorial hints keyed by id. */
  hint(id: string, text: string): void;
  /** Play a sound effect (optionally positioned in the world). */
  sound(name: SoundName, at?: Vector3): void;
}

// ───────────────────────── helpers ─────────────────────────

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

// ───────────────────────── base enemy ─────────────────────────

export abstract class Enemy implements Damageable {
  readonly ctx: GameCtx;
  readonly root: Mesh;
  hp: number;
  /** False from the moment of death (the death animation plays afterwards). */
  alive = true;
  awake = false;
  radius: number;
  protected halfHeight: number;
  protected bodyMat: StandardMaterial;
  protected baseEmissive: Color3;
  protected restEmissive = new Color3(0, 0, 0);
  protected sightRange = 30;
  /** Animation clock, per-instance offset so a group doesn't move in lockstep. */
  protected time = Math.random() * 10;
  /** Measured horizontal speed (m/s), drives walk cycles. */
  protected speed = 0;
  /** 1 right after being hit, decays to 0: drives the flinch pose. */
  protected flinch = 0;
  protected deathTime = 0.5;
  protected deathColor = "#b06cff";
  protected deathSize = 0.6;
  protected deathSound: SoundName = "enemy_death";
  private ownMats: StandardMaterial[] = [];
  private flashT = 0;
  private hurtSndCd = 0;
  private lastPos: Vector3;

  constructor(ctx: GameCtx, pos: Vector3, halfHeight: number, radius: number, hp: number, bodyMat: StandardMaterial) {
    this.ctx = ctx;
    this.hp = hp;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.bodyMat = bodyMat;
    this.own(bodyMat);
    this.baseEmissive = bodyMat.emissiveColor.clone();
    this.root = MeshBuilder.CreateBox("enemy-root", { size: 0.1 }, ctx.scene);
    this.root.isVisible = false;
    this.root.isPickable = false;
    this.root.ellipsoid = new Vector3(radius, halfHeight, radius);
    this.root.position.set(pos.x, halfHeight, pos.z);
    this.lastPos = this.root.position.clone();
  }

  get pos(): Vector3 { return this.root.position; }

  /** Register a per-instance material so it's disposed with this enemy. */
  protected own<T extends StandardMaterial>(m: T): T {
    this.ownMats.push(m);
    return m;
  }

  /** Make a mesh a shootable part of this enemy; `mul` scales damage (weak spots). */
  protected part(m: Mesh, mul = 1, parent: TransformNode = this.root, material: StandardMaterial = this.bodyMat): Mesh {
    m.parent = parent;
    m.material = material;
    m.isPickable = true;
    const self = this;
    setDamageable(m, { takeDamage: (a, p) => self.takeDamage(a * mul, p) });
    return m;
  }

  takeDamage(amount: number, point: Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    Feel.emit("enemyHurt", { at: point });
    this.awake = true;
    this.flashT = 0.06;
    this.flinch = 1;
    if (this.hp <= 0) { this.die(); return; }
    if (this.hurtSndCd <= 0) {
      this.ctx.sound("enemy_hurt", this.pos.clone());
      this.hurtSndCd = 0.15;
    }
  }

  /**
   * Death: the enemy is removed from gameplay immediately (not shootable, no attacks, onEnemyKilled fires once),
   * then a short collapse animation plays before the mesh is disposed.
   */
  protected die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.bodyMat.emissiveColor = this.restEmissive.clone();
    for (const m of this.root.getChildMeshes()) m.isPickable = false;
    this.ctx.sound(this.deathSound, this.pos.clone());
    Feel.emit("enemyKilled", { at: this.pos.clone() });
    this.ctx.onEnemyKilled(this);

    const scene = this.ctx.scene;
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
    this.root.position.y = startY - this.halfHeight * 0.55 * e;
    this.root.scaling.setAll(1 - 0.35 * e);
  }

  distToPlayer(): number {
    const p = this.ctx.player.body.position;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  eye(): Vector3 { return this.pos.add(new Vector3(0, 0.3, 0)); }

  seesPlayer(): boolean {
    return this.distToPlayer() < this.sightRange && this.ctx.los(this.eye(), this.ctx.player.eye);
  }

  /** Horizontal unit vector toward the player. */
  dirToPlayer(): Vector3 {
    const d = this.ctx.player.body.position.subtract(this.pos);
    d.y = 0;
    return d.lengthSquared() > 0 ? d.normalize() : new Vector3(0, 0, 1);
  }

  /** Moves with collisions; returns the fraction of the requested distance actually travelled. */
  move(dir: Vector3, speed: number, dt: number): number {
    const want = dir.scale(speed * dt);
    want.y = 0;
    const before = this.pos.clone();
    this.root.moveWithCollisions(want);
    this.pos.y = before.y; // flat ground: lock height
    const got = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    const req = want.length();
    return req > 0 ? got / req : 1;
  }

  face(dir: Vector3, dt: number, turnRate = 8): void {
    const target = Math.atan2(dir.x, dir.z);
    let d = target - this.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.time += dt;
    this.hurtSndCd -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 7);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.bodyMat.emissiveColor = this.flashT > 0 ? WHITE.clone() : this.baseEmissive.clone();
    }
    if (!this.awake && this.seesPlayer()) this.awake = true;
    if (this.awake) this.think(dt);
    else this.idle(dt);
    if (!this.alive) return; // died during think (shouldn't happen, but be safe)

    const dx = this.pos.x - this.lastPos.x, dz = this.pos.z - this.lastPos.z;
    this.speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    this.lastPos.copyFrom(this.pos);
    this.animate(dt);
  }

  protected idle(_dt: number): void {}
  protected abstract think(dt: number): void;
  /** Pose the rig for this frame (purely visual). */
  protected abstract animate(dt: number): void;

  /** Temporarily override the glow colour (used for attack telegraphs). */
  protected glow(c: Color3 | null): void {
    this.baseEmissive = c ?? this.restEmissive;
    if (this.flashT <= 0) this.bodyMat.emissiveColor = this.baseEmissive.clone();
  }
}

// ───────────────────────── CRAWLER ─────────────────────────

interface Leg { hip: TransformNode; knee: TransformNode; side: number; group: number; baseYaw: number }

/**
 * CRAWLER: fast, low, six-legged; zig-zags toward you.
 * Tell: crouches, glows orange and opens its mandibles before it LUNGES. Counter: strafe sideways when it flashes.
 */
export class Crawler extends Enemy {
  private state: "chase" | "windup" | "lunge" | "recover" = "chase";
  private t = 0;
  private lungeDir = Vector3.Zero();
  private lungeHit = false;
  private biteCd = 0;
  private lungeCd = CR.lunge.initialCooldown;
  private phase = Math.random() * 10;
  // rig
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

  constructor(ctx: GameCtx, pos: Vector3) {
    const m = mat(ctx.scene, "#5a1f2e", "#1a0408");
    super(ctx, pos, CR.halfHeight, CR.radius, CR.hp, m);
    this.restEmissive = m.emissiveColor.clone();
    const s = ctx.scene;
    const shell = shared(s, "crawler-shell", "#2e0f18", "#0a0204");
    const eyeMat = shared(s, "crawler-eye", "#000000", "#ffdd33");

    this.rig = node("crawler-rig", s, this.root);
    // Segmented body: thorax + two abdomen segments + dorsal spikes
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

    // Head with twitch, glowing eyes (weak spot ×1.5) and mandibles
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
      md.rotation.y = -side * 0.25; // curve inward
      this.mandibles.push(n);
    }

    // Six legs, alternating tripod gait groups
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
    this.sightRange = CR.sightRange;
    attachMonsterModel(this, CRAWLER_MODEL);
  }

  protected idle(dt: number): void {
    this.phase += dt;
  }

  protected think(dt: number): void {
    this.phase += dt;
    this.biteCd -= dt;
    this.lungeCd -= dt;
    const dist = this.distToPlayer();
    const toP = this.dirToPlayer();

    switch (this.state) {
      case "chase": {
        this.face(toP, dt);
        const side = new Vector3(toP.z, 0, -toP.x).scale(Math.sin(this.phase * CR.zigzagRate) * CR.zigzagWeight);
        this.move(toP.add(side).normalize(), CR.chaseSpeed, dt);
        if (dist < CR.bite.range && this.biteCd <= 0) {
          this.ctx.player.hurt(CR.bite.damage, this.pos, CR.bite.knockback);
          this.ctx.hud.damageFlash();
          this.ctx.sound("crawler_bite", this.pos.clone());
          this.biteCd = CR.bite.cooldown;
        } else if (dist < CR.lunge.maxRange && dist > CR.lunge.minRange && this.lungeCd <= 0 && this.seesPlayer()) {
          this.state = "windup";
          this.t = CR.lunge.windup;
          this.glow(new Color3(1, 0.45, 0));
          this.ctx.sound("crawler_windup", this.pos.clone());
          this.ctx.hint("crawler", "Crawlers glow orange before they lunge — strafe sideways!");
        }
        break;
      }
      case "windup":
        this.face(toP, dt, 20);
        this.t -= dt;
        if (this.t <= 0) {
          this.state = "lunge";
          this.t = CR.lunge.duration;
          this.lungeDir = toP.clone();
          this.lungeHit = false;
          this.glow(null);
          this.ctx.sound("crawler_lunge", this.pos.clone());
        }
        break;
      case "lunge":
        this.t -= dt;
        this.move(this.lungeDir, CR.lunge.speed, dt);
        if (!this.lungeHit && dist < CR.lunge.hitRange) {
          this.lungeHit = true;
          this.ctx.player.hurt(CR.lunge.damage, this.pos, CR.lunge.knockback);
          this.ctx.hud.damageFlash();
          this.ctx.sound("crawler_bite", this.pos.clone());
        }
        if (this.t <= 0) { this.state = "recover"; this.t = CR.lunge.recover; }
        break;
      case "recover":
        this.t -= dt;
        if (this.t <= 0) { this.state = "chase"; this.lungeCd = CR.lunge.cooldown; }
        break;
    }
  }

  protected animate(dt: number): void {
    const windup = this.state === "windup";
    const lunge = this.state === "lunge";
    this.crouch = approach(this.crouch, windup ? 1 : 0, 14, dt);
    this.tuck = approach(this.tuck, lunge ? 1 : 0, 18, dt);
    this.open = approach(this.open, windup || lunge ? 1 : 0, 16, dt);

    // Tripod gait: phase advances with ground speed (plus a little when idle so legs fidget)
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

    // Twitchy head
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

/**
 * SPITTER: a tall swaying stalk that keeps its distance and lobs slow acid globs.
 * Tell: its sac swells and its neck rears back before firing. Counter: sidestep the glob; shoot the glowing SAC for double damage.
 */
export class Spitter extends Enemy {
  private fireCd = SP.fire.initialCooldown;
  private windup = 0;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;
  private strafeT = 2;
  private sac: Mesh;
  private sacMat: StandardMaterial;
  // rig
  private base: Mesh;
  private segs: TransformNode[] = [];
  private tendrils: TransformNode[] = [];
  private rear = 0;
  private snap = 0;

  constructor(ctx: GameCtx, pos: Vector3) {
    const m = mat(ctx.scene, "#2f4a2a", "#061006");
    super(ctx, pos, SP.halfHeight, SP.radius, SP.hp, m);
    this.restEmissive = m.emissiveColor.clone();
    const s = ctx.scene;
    const ridge = shared(s, "spitter-ridge", "#1b2c18", "#020602");

    // Bulbous foot with wriggling tendrils
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

    // Segmented neck: a chain of nodes so bends accumulate up the stalk
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
    // Glowing sac on top (weak spot ×2) with a small beak under it
    this.sacMat = this.own(mat(s, "#000000", "#4dff4d"));
    this.sac = this.part(MeshBuilder.CreateSphere("sac", { diameter: 0.7, segments: 8 }, s), SP.weakSpots.sac, parent, this.sacMat);
    this.sac.position.y = 0.55;
    const beak = this.part(MeshBuilder.CreateCylinder("beak", { diameterTop: 0, diameterBottom: 0.2, height: 0.35, tessellation: 6 }, s), 1, parent, ridge);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.35, 0.3);
    this.sightRange = SP.sightRange;
    attachMonsterModel(this, SPITTER_MODEL);
  }

  eye(): Vector3 { return this.pos.add(new Vector3(0, 1.0, 0)); }

  protected think(dt: number): void {
    const dist = this.distToPlayer();
    const toP = this.dirToPlayer();
    const sees = this.seesPlayer();
    this.face(toP, dt, 5);

    if (this.windup > 0) {
      this.windup -= dt;
      const k = 1 - this.windup / SP.fire.windup;
      this.sac.scaling.setAll(1 + k * 0.6);
      this.sacMat.emissiveColor = Color3.Lerp(Color3.FromHexString("#4dff4d"), new Color3(0.9, 1, 0.6), k);
      if (this.windup <= 0) {
        this.sac.scaling.setAll(1);
        this.sacMat.emissiveColor = Color3.FromHexString("#4dff4d");
        const from = this.sac.getAbsolutePosition().clone();
        const dir = this.ctx.player.eye.subtract(from).normalize();
        this.ctx.spawnGlob(from, dir);
        this.ctx.sound("spitter_spit", this.pos.clone());
        this.snap = 1;
        this.fireCd = SP.fire.cooldown;
      }
      return;
    }

    // Keep range 10–20 m, strafe while doing so
    let want = Vector3.Zero();
    if (!sees || dist > SP.maxRange) want = toP;
    else if (dist < SP.minRange) want = toP.scale(-1);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 1.5 + Math.random() * 2; }
    if (sees) want = want.add(new Vector3(toP.z, 0, -toP.x).scale(this.strafeDir * SP.strafeWeight));
    if (want.lengthSquared() > 0) this.move(want.normalize(), SP.moveSpeed, dt);

    this.fireCd -= dt;
    if (sees && this.fireCd <= 0) {
      this.windup = SP.fire.windup;
      this.ctx.sound("spitter_charge", this.pos.clone());
      this.ctx.hint("spitter", "Spitters' sacs swell before they fire — shoot the glowing sac for double damage.");
    }
  }

  protected animate(dt: number): void {
    this.rear = approach(this.rear, this.windup > 0 ? 1 : 0, 7, dt);
    this.snap = Math.max(0, this.snap - dt * 3.5);
    const snapBend = Math.sin(this.snap * Math.PI) * 0.32; // whip forward, then settle
    const moving = Math.min(1, this.speed / 3);
    this.segs.forEach((n, i) => {
      n.rotation.z = Math.sin(this.time * 1.3 + i * 0.6) * 0.07 + moving * Math.sin(this.time * 4 + i) * 0.03;
      n.rotation.x = Math.sin(this.time * 1.1 + i * 0.7) * 0.05 - 0.2 * this.rear + snapBend + (i === 0 ? -this.flinch * 0.25 : 0);
    });
    const breathe = Math.sin(this.time * 2.2);
    this.base.scaling.set(1 + breathe * 0.05, 1 - breathe * 0.04, 1 + breathe * 0.05);
    if (this.windup <= 0) this.sac.scaling.setAll(1 + Math.max(0, Math.sin(this.time * 2.2)) * 0.06);
    this.tendrils.forEach((n, i) => {
      n.rotation.x = 0.55 + Math.sin(this.time * 3.2 + i * 1.7) * 0.25;
      n.rotation.z = Math.sin(this.time * 2.1 + i) * 0.2;
    });
  }

  /** Neck droops as it topples. */
  protected deathPose(k: number, startY: number): void {
    super.deathPose(k, startY);
    this.segs.forEach((n, i) => { n.rotation.x = k * (0.3 + i * 0.12); });
  }
}

// ───────────────────────── WARDEN ─────────────────────────

/**
 * WARDEN: the special monster. A shielded two-legged brute guarding the Charminar.
 * Its front shield absorbs all fire. Tell: it rears up and glows red, then CHARGES in a straight line.
 * Counter: dodge so it slams into a wall: it's stunned, its shield drops, and it takes double damage.
 */
export class Warden extends Enemy {
  private state: "drop" | "stalk" | "windup" | "charge" | "stunned" | "recover" = "drop";
  private t = 0;
  private chargeCd = WA.charge.initialCooldown;
  private chargeDir = Vector3.Zero();
  private chargeHit = false;
  private shield: Mesh;
  private dropY = WA.dropHeight;
  // rig
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

  constructor(ctx: GameCtx, pos: Vector3) {
    const m = mat(ctx.scene, "#3b2a4f", "#12061f");
    super(ctx, pos, WA.halfHeight, WA.radius, WA.hp, m);
    this.restEmissive = m.emissiveColor.clone();
    this.deathTime = 0.9;
    this.deathColor = "#ffe066";
    this.deathSize = 2.2;
    this.deathSound = "warden_death";
    const s = ctx.scene;
    const armor = shared(s, "warden-armor", "#221830", "#05020a");
    const horn = shared(s, "warden-horn", "#d8cfc0", "#1a1410");
    const eyeMat = shared(s, "warden-eye", "#000000", "#ff5a3a");

    // Legs: hip → thigh, knee → shin + foot
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

    // Torso pivots at the hips so it can rear up / lean / slump
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

    // Head: jaw, eye slits, swept horns
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

    // Arms: shoulder → upper arm, elbow → forearm + fist
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

    // Shield (absorbs fire; not part of the body)
    const sm = this.own(mat(s, "#000000", "#5a2cff"));
    sm.alpha = 0.55;
    this.shield = MeshBuilder.CreateBox("shield", { width: 2.8, height: 3.0, depth: 0.2 }, s);
    this.shield.material = sm;
    this.shield.parent = this.root;
    this.shield.position.set(0, 0.1, 1.15);
    this.shield.isPickable = true;
    setDamageable(this.shield, {
      takeDamage: (_a, p) => {
        burst(ctx.scene, p, "#5a2cff", 0.35, 0.12);
        ctx.hint("warden-shield", "The Warden's shield absorbs fire — bait its charge into a wall!");
      },
    });

    this.awake = true;
    this.sightRange = WA.sightRange;
    this.root.position.y = this.dropY;
  }

  takeDamage(amount: number, point: Vector3): void {
    super.takeDamage(this.state === "stunned" ? amount * WA.stun.damageMultiplier : amount, point);
  }

  protected think(dt: number): void {
    const toP = this.dirToPlayer();
    const dist = this.distToPlayer();
    switch (this.state) {
      case "drop":
        this.root.position.y = Math.max(WA.halfHeight, this.root.position.y - dt * WA.dropSpeed);
        if (this.root.position.y <= WA.halfHeight) {
          burst(this.ctx.scene, this.pos.clone(), "#8a5cff", 3, 0.4);
          this.ctx.sound("warden_land", this.pos.clone());
          if (dist < WA.land.radius) { this.ctx.player.hurt(WA.land.damage, this.pos, WA.land.knockback); this.ctx.hud.damageFlash(); }
          this.state = "stalk";
          this.flinch = 1; // knees buckle on landing
        }
        break;
      case "stalk":
        this.face(toP, dt, WA.turnRate); // slow turner: you can flank it
        this.move(toP, WA.stalkSpeed, dt);
        this.chargeCd -= dt;
        if (dist < WA.contact.range) { this.ctx.player.hurt(WA.contact.damagePerSecond * dt, this.pos, WA.contact.knockback); }
        if (this.chargeCd <= 0 && dist > WA.charge.minRange && dist < WA.charge.maxRange && this.seesPlayer()) {
          this.state = "windup";
          this.t = WA.charge.windup;
          this.glow(new Color3(1, 0.1, 0.1));
          this.ctx.sound("warden_roar", this.pos.clone());
          this.ctx.hint("warden-charge", "It's about to charge — get out of the line!");
        }
        break;
      case "windup":
        this.face(toP, dt, 4);
        this.t -= dt;
        if (this.t <= 0) {
          this.state = "charge";
          this.t = WA.charge.duration;
          // Lock direction to where it is FACING, so sidestepping late works
          this.chargeDir = new Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
          this.chargeHit = false;
          this.ctx.sound("warden_charge", this.pos.clone());
        }
        break;
      case "charge": {
        this.t -= dt;
        const frac = this.move(this.chargeDir, WA.charge.speed, dt);
        if (!this.chargeHit && dist < WA.charge.hitRange) {
          this.chargeHit = true;
          this.ctx.player.hurt(WA.charge.damage, this.pos, WA.charge.knockback);
          this.ctx.hud.damageFlash();
        }
        if (frac < WA.charge.wallStopFraction) {
          // Slammed into a wall
          this.state = "stunned";
          this.t = WA.stun.duration;
          this.shield.setEnabled(false);
          this.glow(new Color3(0.9, 0.8, 0.1));
          burst(this.ctx.scene, this.pos.add(this.chargeDir.scale(1.2)), "#ffe066", 2, 0.3);
          this.ctx.sound("warden_impact", this.pos.clone());
          this.ctx.sound("warden_stun", this.pos.clone());
          this.ctx.hud.message("WARDEN STUNNED — SHIELD DOWN!", 2);
        } else if (this.t <= 0) {
          this.state = "recover";
          this.t = WA.charge.recover;
          this.glow(null);
        }
        break;
      }
      case "stunned":
        this.t -= dt;
        if (this.t <= 0) {
          this.shield.setEnabled(true);
          this.glow(null);
          this.state = "stalk";
          this.chargeCd = WA.charge.cooldownAfterStun;
        }
        break;
      case "recover":
        this.t -= dt;
        if (this.t <= 0) { this.state = "stalk"; this.chargeCd = WA.charge.cooldownAfterRecover; }
        break;
    }
  }

  protected animate(dt: number): void {
    const st = this.state;
    this.rearUp = approach(this.rearUp, st === "windup" ? 1 : 0, 6, dt);
    this.lean = approach(this.lean, st === "charge" ? 1 : 0, 10, dt);
    this.slump = approach(this.slump, st === "stunned" ? 1 : 0, 8, dt);
    const falling = st === "drop";

    // Heavy stomping walk; faster cycle when charging
    const moving = falling ? 0 : Math.min(1, this.speed / 2.5);
    this.gait += dt * (1.2 + Math.min(this.speed, 22) * 0.9);
    const sg = Math.sin(this.gait);
    for (const L of this.legs) {
      const s = sg * L.side;
      L.hip.rotation.x = falling ? -0.5 : s * 0.5 * moving - 0.25 * this.lean;
      L.knee.rotation.x = falling ? 0.9 : Math.max(0, -Math.cos(this.gait + (L.side > 0 ? 0 : Math.PI))) * 0.6 * moving + 0.35 * this.slump;
    }
    // A stomp each time a foot plants (|sin| crosses zero): a small ground thump visible as a bob
    const step = Math.abs(sg);
    this.torso.position.y = 0.05 - (1 - step) * 0.12 * moving - this.slump * 0.25 + Math.sin(this.time * 2) * 0.02;
    if (moving > 0.5 && step < 0.15 && this.lastStep >= 0.15) {
      burst(this.ctx.scene, this.pos.add(new Vector3(0, -1.45, 0)), "#4a3a5e", 0.8, 0.2);
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

    // Sparks while stunned
    if (this.slump > 0.5) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.18;
        const p = this.head.getAbsolutePosition().add(new Vector3((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 1.2));
        burst(this.ctx.scene, p, "#ffe066", 0.25, 0.18);
      }
    }
  }

  /** Topples forward onto its face. */
  protected deathPose(k: number, startY: number): void {
    const e = k * k;
    this.root.rotation.x = e * 1.45;
    this.root.position.y = startY - 0.9 * e;
    this.torso.rotation.x = 0.4 * k;
    this.head.rotation.x = 0.6 * k;
    for (const A of this.arms) A.root.rotation.x = -1.2 * k;
    if (k > 0.85 && !this.thudDone) {
      this.thudDone = true; // one dust puff as it hits the ground
      burst(this.ctx.scene, this.pos.add(new Vector3(0, -0.6, 0)), "#3a2e48", 1.6, 0.25);
    }
  }

  protected die(): void {
    if (!this.alive) return;
    this.ctx.hud.message("THE WARDEN HAS FALLEN", 3);
    this.shield.setEnabled(false);
    super.die();
  }
}

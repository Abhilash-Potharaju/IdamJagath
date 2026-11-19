import { Vec3, rotateY, wrapAngle } from "../math";
import type { BodyId } from "../ports";
import type { CrawlerData, EnemyType, SpitterData, WardenData } from "../../data/schemas";
import type { CoreContext } from "../context";
import type { HitInfo } from "../events";

/** Optional source of a hit (only feeds presentation events; never changes damage or AI). */
export interface DamageSource { dir?: Vec3; weapon?: number; mul?: number }
import type { Player } from "./player";

export interface EnemyContext extends CoreContext {
  readonly player: Player;
  spawnGlob(from: Vec3, dir: Vec3): void;
  onEnemyKilled(e: Enemy): void;
  nextId(): number;
}

/** Attack telegraph shown by presentation (glow colour). */
export type Tell = "none" | "lunge" | "charge" | "stunned";

/**
 * Base enemy: collision body, health, wake-up on sight, movement/turning via IPhysics, damage + death.
 * Subclasses implement `think` (the AI state machine). All visuals live in the engine adapter.
 */
export abstract class Enemy {
  readonly id: number;
  readonly type: EnemyType;
  readonly body: BodyId;
  /** Centre of the collision ellipsoid. */
  readonly pos: Vec3;
  yaw = 0;
  hp: number;
  /** False from the moment of death. */
  alive = true;
  awake = false;
  readonly radius: number;
  readonly halfHeight: number;
  sightRange: number;
  tell: Tell = "none";
  protected readonly ctx: EnemyContext;
  protected deathSound = "enemy_death";
  private hurtSndCd = 0;

  constructor(ctx: EnemyContext, type: EnemyType, at: Vec3, stats: { hp: number; halfHeight: number; radius: number; sightRange: number }) {
    this.ctx = ctx;
    this.type = type;
    this.id = ctx.nextId();
    this.hp = stats.hp;
    this.radius = stats.radius;
    this.halfHeight = stats.halfHeight;
    this.sightRange = stats.sightRange;
    this.pos = new Vec3(at.x, at.y + stats.halfHeight, at.z); // at.y = floor height (roof spawns)
    this.body = ctx.physics.createBody(new Vec3(stats.radius, stats.halfHeight, stats.radius), this.pos, "enemy-root");
  }

  takeDamage(amount: number, point: Vec3, src?: DamageSource): void {
    if (!this.alive) return;
    this.hp -= amount;
    const info: HitInfo = { dir: src?.dir ? src.dir.clone() : null, weapon: src?.weapon ?? -1, weak: (src?.mul ?? 1) > 1 };
    this.ctx.events.emit("enemyHurt", { id: this.id, at: Vec3.from(point), ...info });
    this.awake = true;
    if (this.hp <= 0) { this.die(Vec3.from(point), info); return; }
    if (this.hurtSndCd <= 0) {
      this.ctx.sound("enemy_hurt", this.pos.clone());
      this.hurtSndCd = 0.15;
    }
  }

  protected die(hit: Vec3 = this.pos.clone(), info: HitInfo = { dir: null, weapon: -1, weak: false }): void {
    if (!this.alive) return;
    this.alive = false;
    this.ctx.sound(this.deathSound, this.pos.clone());
    this.ctx.events.emit("enemyKilled", { id: this.id, type: this.type, at: this.pos.clone(), hit, ...info });
    this.ctx.physics.releaseBody(this.body);
    this.ctx.onEnemyKilled(this);
  }

  distToPlayer(): number {
    const p = this.ctx.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  eye(): Vec3 { return this.pos.add(new Vec3(0, 0.3, 0)); }

  /**
   * Can a melee/contact attack actually reach the player? Horizontal range AND about the same floor height AND a
   * clear line of sight, so monsters can't bite through walls, floors or the Charminar stair shaft.
   */
  canReach(range: number): boolean {
    if (this.distToPlayer() >= range) return false;
    const myFeet = this.pos.y - this.halfHeight;
    const p = this.ctx.player.pos;
    const theirFeet = p.y - 0.9; // player capsule half-height
    if (Math.abs(myFeet - theirFeet) > 1.6) return false;
    return this.ctx.physics.lineOfSight(this.eye(), this.ctx.player.eye);
  }

  seesPlayer(): boolean {
    return this.distToPlayer() < this.sightRange && this.ctx.physics.lineOfSight(this.eye(), this.ctx.player.eye);
  }

  /** Horizontal unit vector toward the player. */
  dirToPlayer(): Vec3 {
    const d = this.ctx.player.pos.subtract(this.pos);
    d.y = 0;
    return d.lengthSquared() > 0 ? d.normalize() : new Vec3(0, 0, 1);
  }

  /** Moves with collisions on flat ground; returns the fraction of the requested distance actually travelled. */
  move(dir: Vec3, speed: number, dt: number): number {
    const want = dir.scale(speed * dt);
    want.y = 0;
    const before = this.pos.clone();
    this.pos.copyFrom(this.ctx.physics.move(this.body, this.pos, want));
    this.pos.y = before.y; // flat ground: lock height
    const got = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    const req = want.length();
    return req > 0 ? got / req : 1;
  }

  /** Push (used by crowd separation), no height lock. */
  push(disp: Vec3): void {
    this.pos.copyFrom(this.ctx.physics.move(this.body, this.pos, disp));
  }

  face(dir: Vec3, dt: number, turnRate = 8): void {
    const d = wrapAngle(Math.atan2(dir.x, dir.z) - this.yaw);
    this.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
  }

  /**
   * Guard post (e.g. the Charminar roof guards): while the player is on another floor the guard stays at its post
   * instead of chasing the player's horizontal position (which crowded them on the roof right above the stair shaft).
   */
  post: Vec3 | null = null;

  /** True while a guard should hold its post: the player isn't on its floor. */
  holdingPost(): boolean {
    if (!this.post) return false;
    const myFeet = this.pos.y - this.halfHeight, theirFeet = this.ctx.player.pos.y - 0.9;
    return Math.abs(myFeet - theirFeet) > 0.8; // stricter than canReach: engage only once the player is out on the roof
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.hurtSndCd -= dt;
    if (!this.awake && this.seesPlayer()) this.awake = true;
    if (this.awake && this.holdingPost()) this.returnToPost(dt);
    else if (this.awake) this.think(dt);
    else this.idle(dt);
  }

  /** Walk back to the post, then stand facing the player. */
  protected returnToPost(dt: number): void {
    this.tell = "none";
    const d = this.post!.subtract(this.pos);
    d.y = 0;
    if (d.length() > 0.6) { const dir = d.normalize(); this.move(dir, 2.5, dt); this.face(dir, dt); }
    else this.face(this.dirToPlayer(), dt, 3);
  }

  protected idle(_dt: number): void {}
  protected abstract think(dt: number): void;
}

/**
 * CRAWLER: fast and low; zig-zags toward you and bites.
 * Tell: crouches and glows orange before it LUNGES. Counter: strafe sideways when it flashes.
 */
export class Crawler extends Enemy {
  state: "chase" | "windup" | "lunge" | "recover" = "chase";
  t = 0;
  private lungeDir = Vec3.zero();
  private lungeHit = false;
  private biteCd = 0;
  private lungeCd: number;
  private phase: number;
  private readonly D: CrawlerData;

  constructor(ctx: EnemyContext, at: Vec3, data: CrawlerData) {
    super(ctx, "crawler", at, data);
    this.D = data;
    this.lungeCd = data.lunge.initialCooldown;
    this.phase = ctx.rng.next() * 10;
  }

  protected idle(dt: number): void {
    this.phase += dt;
  }

  protected think(dt: number): void {
    const D = this.D, ctx = this.ctx;
    this.phase += dt;
    this.biteCd -= dt;
    this.lungeCd -= dt;
    const dist = this.distToPlayer();
    const toP = this.dirToPlayer();

    switch (this.state) {
      case "chase": {
        this.face(toP, dt);
        const side = new Vec3(toP.z, 0, -toP.x).scale(Math.sin(this.phase * D.zigzagRate) * D.zigzagWeight);
        this.move(toP.add(side).normalize(), D.chaseSpeed, dt);
        if (this.biteCd <= 0 && dist < D.bite.range && this.canReach(D.bite.range)) {
          ctx.player.hurt(D.bite.damage, this.pos, D.bite.knockback);
          ctx.events.emit("damageFlash", {});
          ctx.sound("crawler_bite", this.pos.clone());
          this.biteCd = D.bite.cooldown;
        } else if (dist < D.lunge.maxRange && dist > D.lunge.minRange && this.lungeCd <= 0 && this.seesPlayer()) {
          this.state = "windup";
          this.t = D.lunge.windup;
          this.tell = "lunge";
          ctx.sound("crawler_windup", this.pos.clone());
          ctx.hint("crawler", "Crawlers glow orange before they lunge — strafe sideways!");
        }
        break;
      }
      case "windup":
        this.face(toP, dt, 20);
        this.t -= dt;
        if (this.t <= 0) {
          this.state = "lunge";
          this.t = D.lunge.duration;
          this.lungeDir = toP.clone();
          this.lungeHit = false;
          this.tell = "none";
          ctx.sound("crawler_lunge", this.pos.clone());
        }
        break;
      case "lunge":
        this.t -= dt;
        this.move(this.lungeDir, D.lunge.speed, dt);
        if (!this.lungeHit && dist < D.lunge.hitRange && this.canReach(D.lunge.hitRange)) {
          this.lungeHit = true;
          ctx.player.hurt(D.lunge.damage, this.pos, D.lunge.knockback);
          ctx.events.emit("damageFlash", {});
          ctx.sound("crawler_bite", this.pos.clone());
        }
        if (this.t <= 0) { this.state = "recover"; this.t = D.lunge.recover; }
        break;
      case "recover":
        this.t -= dt;
        if (this.t <= 0) { this.state = "chase"; this.lungeCd = D.lunge.cooldown; }
        break;
    }
  }
}

/**
 * SPITTER: keeps its distance and lobs slow acid globs.
 * Tell: its sac swells before firing. Counter: sidestep the glob; shoot the sac for double damage.
 */
export class Spitter extends Enemy {
  /** Seconds of fire wind-up left (0 = not winding up). */
  windup = 0;
  /**
   * Where globs leave from, in the enemy's local space (rotated by yaw). Presentation may set this once to match its
   * model (the glowing sac); it's static per model, so the simulation stays deterministic.
   */
  muzzleLocal = new Vec3(0, 1.2, 0);
  private fireCd: number;
  private strafeDir: number;
  private strafeT = 2;
  private readonly D: SpitterData;

  constructor(ctx: EnemyContext, at: Vec3, data: SpitterData) {
    super(ctx, "spitter", at, data);
    this.D = data;
    this.fireCd = data.fire.initialCooldown;
    this.strafeDir = ctx.rng.next() < 0.5 ? 1 : -1;
  }

  eye(): Vec3 { return this.pos.add(new Vec3(0, 1.0, 0)); }

  muzzle(): Vec3 { return this.pos.add(rotateY(this.muzzleLocal, this.yaw)); }

  protected think(dt: number): void {
    const D = this.D, ctx = this.ctx;
    const dist = this.distToPlayer();
    const toP = this.dirToPlayer();
    const sees = this.seesPlayer();
    this.face(toP, dt, 5);

    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        const from = this.muzzle();
        const dir = ctx.player.eye.subtract(from).normalize();
        ctx.spawnGlob(from, dir);
        ctx.sound("spitter_spit", this.pos.clone());
        this.fireCd = D.fire.cooldown;
      }
      return;
    }

    // Keep range (minRange..maxRange), strafing while doing so
    let want = Vec3.zero();
    if (!sees || dist > D.maxRange) want = toP;
    else if (dist < D.minRange) want = toP.scale(-1);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 1.5 + ctx.rng.next() * 2; }
    if (sees) want = want.add(new Vec3(toP.z, 0, -toP.x).scale(this.strafeDir * D.strafeWeight));
    if (want.lengthSquared() > 0) this.move(want.normalize(), D.moveSpeed, dt);

    this.fireCd -= dt;
    if (sees && this.fireCd <= 0) {
      this.windup = D.fire.windup;
      ctx.sound("spitter_charge", this.pos.clone());
      ctx.hint("spitter", "Spitters' sacs swell before they fire — shoot the glowing sac for double damage.");
    }
  }
}

/**
 * WARDEN: shielded brute. Its front shield absorbs fire. Tell: glows red, then CHARGES in a straight line.
 * Counter: dodge so it slams into a wall: it's stunned, its shield drops, and it takes extra damage.
 */
export class Warden extends Enemy {
  state: "drop" | "stalk" | "windup" | "charge" | "stunned" | "recover" | "withdraw" = "drop";
  t = 0;
  /** Seconds spent pressed against geometry while unable to reach the player (anti-stalemate). */
  private blockedT = 0;
  shieldUp = true;
  private chargeCd: number;
  private chargeDir = Vec3.zero();
  private chargeHit = false;
  private readonly D: WardenData;

  constructor(ctx: EnemyContext, at: Vec3, data: WardenData) {
    super(ctx, "warden", at, data);
    this.D = data;
    this.chargeCd = data.charge.initialCooldown;
    this.deathSound = "warden_death";
    this.awake = true;
    this.pos.y = data.dropHeight;
  }

  takeDamage(amount: number, point: Vec3, src?: DamageSource): void {
    super.takeDamage(this.state === "stunned" ? amount * this.D.stun.damageMultiplier : amount, point, src);
  }

  private setShield(up: boolean): void {
    if (this.shieldUp === up) return;
    this.shieldUp = up;
    this.ctx.events.emit("shield", { id: this.id, up });
  }

  protected think(dt: number): void {
    const D = this.D, ctx = this.ctx;
    const toP = this.dirToPlayer();
    const dist = this.distToPlayer();
    switch (this.state) {
      case "drop":
        this.pos.y = Math.max(D.halfHeight, this.pos.y - dt * D.dropSpeed);
        if (this.pos.y <= D.halfHeight) {
          ctx.events.emit("wardenLanded", { id: this.id, at: this.pos.clone() });
          ctx.sound("warden_land", this.pos.clone());
          if (dist < D.land.radius && this.canReach(D.land.radius)) { ctx.player.hurt(D.land.damage, this.pos, D.land.knockback); ctx.events.emit("damageFlash", {}); }
          this.state = "stalk";
        }
        break;
      case "stalk":
        this.face(toP, dt, D.turnRate); // slow turner: you can flank it
        const reach = this.canReach(D.contact.range);
        const frac = this.move(toP, D.stalkSpeed, dt);
        this.chargeCd -= dt;
        if (reach) ctx.player.hurt(D.contact.damagePerSecond * dt, this.pos, D.contact.knockback);
        // Anti-stalemate: too big for a doorway (the Charminar leg) or wedged at a corner, it would stand there with
        // its shield up, too close to charge and unable to touch the player. Back off into the open instead, which
        // lets the player out and sets up a charge (into the wall, so stunned).
        this.blockedT = frac < 0.3 && !reach ? this.blockedT + dt : Math.max(0, this.blockedT - dt * 2);
        if (this.blockedT > D.unstick.after) {
          this.blockedT = 0;
          this.state = "withdraw";
          this.t = D.unstick.maxTime;
          break;
        }
        if (this.chargeCd <= 0 && dist > D.charge.minRange && dist < D.charge.maxRange && this.seesPlayer()) {
          this.state = "windup";
          this.t = D.charge.windup;
          this.tell = "charge";
          ctx.sound("warden_roar", this.pos.clone());
          ctx.hint("warden-charge", "It's about to charge — get out of the line!");
        }
        break;
      case "windup":
        this.face(toP, dt, 4);
        this.t -= dt;
        if (this.t <= 0) {
          this.state = "charge";
          this.t = D.charge.duration;
          // Lock direction to where it is FACING, so sidestepping late works
          this.chargeDir = new Vec3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.chargeHit = false;
          ctx.sound("warden_charge", this.pos.clone());
        }
        break;
      case "charge": {
        this.t -= dt;
        const frac = this.move(this.chargeDir, D.charge.speed, dt);
        if (!this.chargeHit && dist < D.charge.hitRange && this.canReach(D.charge.hitRange)) {
          this.chargeHit = true;
          ctx.player.hurt(D.charge.damage, this.pos, D.charge.knockback);
          ctx.events.emit("damageFlash", {});
        }
        if (frac < D.charge.wallStopFraction) {
          // Slammed into a wall
          this.state = "stunned";
          this.t = D.stun.duration;
          this.setShield(false);
          this.tell = "stunned";
          ctx.events.emit("wardenStunned", { id: this.id, at: this.pos.add(this.chargeDir.scale(1.2)) });
          ctx.sound("warden_impact", this.pos.clone());
          ctx.sound("warden_stun", this.pos.clone());
          ctx.message("WARDEN STUNNED — SHIELD DOWN!", 2);
        } else if (this.t <= 0) {
          this.state = "recover";
          this.t = D.charge.recover;
          this.tell = "none";
        }
        break;
      }
      case "stunned":
        this.t -= dt;
        if (this.t <= 0) {
          this.setShield(true);
          this.tell = "none";
          this.state = "stalk";
          this.chargeCd = D.charge.cooldownAfterStun;
        }
        break;
      case "recover":
        this.t -= dt;
        if (this.t <= 0) { this.state = "stalk"; this.chargeCd = D.charge.cooldownAfterRecover; }
        break;
      case "withdraw": {
        // Back away (shield still toward the player); if that's blocked too, try veering left/right.
        this.face(toP, dt, D.turnRate);
        this.t -= dt;
        const away = toP.scale(-1);
        let frac = this.move(away, D.stalkSpeed, dt);
        if (frac < 0.3) frac = this.move(rotateY(away, 1.0), D.stalkSpeed, dt);
        if (frac < 0.3) this.move(rotateY(away, -1.0), D.stalkSpeed, dt);
        if (this.t <= 0 || dist >= D.unstick.distance) {
          this.state = "stalk";
          this.chargeCd = Math.min(this.chargeCd, D.unstick.chargeCooldown);
        }
        break;
      }
    }
  }

  /** Shots that hit the front shield are absorbed. */
  shieldHit(at: Vec3): void {
    this.ctx.events.emit("shieldHit", { id: this.id, at: Vec3.from(at) });
    this.ctx.hint("warden-shield", "The Warden's shield absorbs fire — bait its charge into a wall!");
  }

  protected die(hit?: Vec3, info?: HitInfo): void {
    if (!this.alive) return;
    this.ctx.message("THE WARDEN HAS FALLEN", 3);
    this.setShield(false);
    super.die(hit, info);
  }
}

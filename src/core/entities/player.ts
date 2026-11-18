import { Vec3, clamp, forwardOf, rightOf, spring, viewDir } from "../math";
import type { BodyId, InputSnapshot } from "../ports";
import type { PlayerData } from "../../data/schemas";
import type { CoreContext } from "../context";

/** What the camera should show this step (the adapter interpolates between steps). */
export interface PlayerView {
  eye: Vec3;
  pitch: number;
  yaw: number;
  roll: number;
  fov: number;
}

/**
 * First-person player: collision body, movement (walk/sprint/crouch/slide/jump with acceleration and coyote time),
 * health, recoil kick, camera shake, head-bob and the resulting view. Pure logic: collisions go through IPhysics.
 */
export class Player {
  readonly body: BodyId;
  /** Centre of the collision ellipsoid. */
  readonly pos: Vec3;
  health: number;
  maxHealth: number;
  yaw = 0;
  pitch = 0;
  /** 0 = hip, 1 = fully zoomed (aim). Smoothly animated. */
  zoom = 0;

  // ── read by presentation (weapon sway/bob, footsteps) ──
  /** Horizontal speed in m/s (after collisions). */
  speed = 0;
  sprinting = false;
  crouch = 0;
  sliding = false;
  grounded = false;
  /** Head-bob phase (radians); a footstep happens every π. */
  bobPhase = 0;
  /** Strafe input −1..1 (smoothed). */
  strafe = 0;
  /** Landing dip 0..1, springs back. */
  landDip = 0;
  /** Camera-shake trauma 0..1 (offset ∝ trauma²). */
  trauma = 0;

  readonly view: PlayerView;
  readonly prevView: PlayerView;

  private readonly ctx: CoreContext;
  private readonly P: PlayerData;
  private readonly bobScale: number;
  private groundTimer = 0;
  private velY = 0;
  private vel = Vec3.zero();
  private knock = Vec3.zero();
  private slideT = 0;
  private slideDir = Vec3.zero();
  private kickPitch = 0; private kickPitchV = 0;
  private kickYaw = 0; private kickYawV = 0;
  private landDipV = 0;
  private eyeCrouch = 0;
  private shakeT = 0;
  private lastStep = 0;
  private fovSprint = 0;
  private tilt = 0;

  constructor(ctx: CoreContext, data: PlayerData, spawn: Vec3, bobScale = 1) {
    this.ctx = ctx;
    this.P = data;
    this.bobScale = bobScale;
    this.health = data.maxHealth;
    this.maxHealth = data.maxHealth;
    this.pos = spawn.clone();
    this.body = ctx.physics.createBody(Vec3.fromArray(data.collisionHalfExtents), this.pos, "player");
    const v = (): PlayerView => ({ eye: spawn.add(new Vec3(0, data.eyeHeight, 0)), pitch: 0, yaw: 0, roll: 0, fov: data.fov });
    this.view = v();
    this.prevView = v();
  }

  get alive(): boolean { return this.health > 0; }
  /** Camera position this step. */
  get eye(): Vec3 { return this.view.eye; }
  /** Aim direction this step (includes recoil kick and shake, exactly what the camera shows). */
  aimDir(): Vec3 { return viewDir(this.view.pitch, this.view.yaw); }

  hurt(amount: number, from?: Vec3, push = 0): void {
    if (!this.alive) return;
    this.health -= amount;
    if (from && push > 0) {
      const d = this.pos.subtract(from);
      d.y = 0;
      this.knock.addInPlace(d.normalize().scale(push));
    }
    this.addTrauma(Math.min(0.45, 0.12 + amount / 70));
    this.ctx.events.emit("hurt", { amount, from: from?.clone(), playerPos: this.pos.clone(), yaw: this.yaw });
  }

  heal(amount: number, cap = this.maxHealth): void {
    this.health = Math.min(Math.max(cap, this.health), this.health + amount);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Recoil: part of the kick is permanent (aim drifts up), most of it springs back. */
  addKick(pitch: number, yaw = 0): void {
    this.pitch -= pitch * 0.3;
    this.kickPitchV -= pitch * 0.7 * 28;
    this.kickYawV += yaw * 28;
  }

  /** Teleport (debug / respawn). */
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    this.pos.set(x, y, z);
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
  }

  update(dt: number, input: InputSnapshot): void {
    const P = this.P;
    const pv = this.prevView, v = this.view;
    pv.eye.copyFrom(v.eye); pv.pitch = v.pitch; pv.yaw = v.yaw; pv.roll = v.roll; pv.fov = v.fov;

    // Zoom (aim): animate FOV and slow mouse-look in proportion so aiming stays steady
    this.zoom += ((input.aim ? 1 : 0) - this.zoom) * Math.min(1, dt * P.zoomSpeed);
    const baseFov = P.fov + (P.zoomFov - P.fov) * this.zoom;
    const sens = P.mouseSensitivity * (baseFov / P.fov);
    this.yaw += input.lookDX * sens;
    this.pitch = clamp(this.pitch + input.lookDY * sens, -1.45, 1.45);

    // Input direction relative to view yaw
    const fwd = forwardOf(this.yaw);
    const right = rightOf(this.yaw);
    const wish = Vec3.zero();
    let strafe = 0;
    if (input.forward) wish.addInPlace(fwd);
    if (input.back) wish.subtractInPlace(fwd);
    if (input.right) { wish.addInPlace(right); strafe += 1; }
    if (input.left) { wish.subtractInPlace(right); strafe -= 1; }
    this.strafe += (strafe - this.strafe) * Math.min(1, dt * 8);
    const moving = wish.lengthSquared() > 0;
    const crouchHeld = input.crouch;
    const wantSprint = input.sprint && !input.aim && moving && !crouchHeld;

    // Slide: crouch pressed while sprinting on the ground → burst of speed that decays
    if (input.crouchPressed && this.sprinting && this.grounded && this.speed > 7) {
      this.slideT = P.slideTime;
      this.slideDir = this.vel.lengthSquared() > 0.01 ? this.vel.clone().normalize() : fwd.clone();
    }
    this.sliding = this.slideT > 0;
    this.sprinting = wantSprint && !this.sliding;
    this.crouch += ((crouchHeld || this.sliding ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);

    // Target velocity with acceleration
    let targetSpeed = this.sprinting ? P.sprintSpeed : crouchHeld ? P.crouchSpeed : P.walkSpeed;
    targetSpeed *= 1 - 0.35 * this.zoom; // slower while aiming down sights
    const targetVel = moving ? wish.normalize().scale(targetSpeed) : Vec3.zero();
    if (this.sliding) {
      this.slideT -= dt;
      const k = Math.max(0, this.slideT / P.slideTime);
      this.vel.copyFrom(this.slideDir.scale(P.crouchSpeed + (P.slideBoost - P.crouchSpeed) * k));
    } else {
      const accel = this.grounded ? (moving ? P.accelGround : P.decelGround) : P.accelAir;
      const diff = targetVel.subtract(this.vel);
      const step = accel * dt;
      const len = diff.length();
      if (len <= step) this.vel.copyFrom(targetVel);
      else this.vel.addInPlace(diff.scale(step / len));
    }

    // Knockback decays quickly
    const move = this.vel.add(this.knock);
    this.knock.scaleInPlace(Math.max(0, 1 - dt * 6));

    // Gravity + jump
    if (this.grounded && input.jumpPressed) {
      this.velY = P.jumpSpeed;
      this.grounded = false;
      this.groundTimer = 0;
      this.slideT = 0;
    }
    this.velY += P.gravity * dt;
    // Stick-to-ground probe: while grounded always push down a little so the collision test hits the floor every
    // step (a tiny gravity step alone sometimes misses, which made `grounded` flicker and the gun bob switch on/off).
    if (this.grounded && this.velY <= 0) this.velY = Math.min(this.velY, -3);

    const disp = new Vec3(move.x * dt, this.velY * dt, move.z * dt);
    const before = this.pos.clone();
    const velYBefore = this.velY;
    this.pos.copyFrom(this.ctx.physics.move(this.body, this.pos, disp));
    const movedY = this.pos.y - before.y;
    const wasGrounded = this.grounded;
    if (this.velY < 0 && movedY > disp.y + 0.001) {
      this.groundTimer = 0.12; // standing on something; short grace period ("coyote time") covers missed steps
      this.velY = 0;
    } else {
      if (this.velY > 0 && movedY < disp.y - 0.001) this.velY = 0; // bumped head
      this.groundTimer -= dt;
    }
    this.grounded = this.groundTimer > 0;
    // Landing: camera dip scaled by fall speed + thud
    if (!wasGrounded && this.grounded && velYBefore < -4) {
      const strength = Math.min(1, (-velYBefore - 4) / 14);
      this.landDipV -= 2.2 + strength * 6;
      this.ctx.events.emit("land", { strength });
      if (strength > 0.5) this.addTrauma(strength * 0.25);
    }
    this.speed = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-4);
    if (this.speed < this.vel.length() * 0.3) this.vel.scaleInPlace(0.5); // don't keep pushing into walls
    if (this.pos.y < -5) this.pos.y = 2; // safety net if we ever fall through the floor

    // Head-bob phase + footsteps (every half cycle)
    if (this.grounded && this.speed > 0.8 && !this.sliding) {
      const rate = this.sprinting ? 13 : crouchHeld ? 6.5 : 9.5;
      this.bobPhase += dt * rate * Math.min(1.2, this.speed / P.walkSpeed + 0.3);
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        if (!(crouchHeld && this.speed < 2)) this.ctx.events.emit("footstep", { sprint: this.sprinting });
      }
    }

    // Springs: recoil recovery, landing dip
    [this.kickPitch, this.kickPitchV] = spring(this.kickPitch, this.kickPitchV, 140, 18, dt);
    [this.kickYaw, this.kickYawV] = spring(this.kickYaw, this.kickYawV, 140, 18, dt);
    [this.landDip, this.landDipV] = spring(this.landDip, this.landDipV, 90, 14, dt);

    // Camera shake (trauma², smooth deterministic noise)
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 32;
    const sh = this.trauma * this.trauma;
    const n = (o: number) => Math.sin(this.shakeT * 1.13 + o) * 0.6 + Math.sin(this.shakeT * 2.37 + o * 1.7) * 0.4;
    const shP = sh * 0.06 * n(0), shY = sh * 0.06 * n(10), shR = sh * 0.08 * n(20);

    // Eye height: crouch + head-bob + landing dip
    this.eyeCrouch += (this.crouch * P.crouchEyeDrop - this.eyeCrouch) * Math.min(1, dt * 14);
    const bobAmt = this.bobScale * (this.grounded ? Math.min(1, this.speed / P.walkSpeed) : 0) * (1 - 0.7 * this.zoom);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.05 * bobAmt * (this.sprinting ? 1.4 : 1);
    const bobRoll = Math.sin(this.bobPhase) * 0.006 * bobAmt;
    v.eye.copyFrom(this.pos).addInPlaceFromFloats(0, P.eyeHeight - this.eyeCrouch - bobY + this.landDip * 0.12, 0);

    // FOV: zoom + a touch wider while sprinting
    this.fovSprint += ((this.sprinting ? 1 : 0) - this.fovSprint) * Math.min(1, dt * 6);
    v.fov = baseFov + P.sprintFovBonus * this.fovSprint * (1 - this.zoom);

    // Roll: slide tilt + slight strafe lean
    this.tilt += ((this.sliding ? 0.09 : 0) + -this.strafe * 0.012 - this.tilt) * Math.min(1, dt * 8);
    v.pitch = this.pitch + this.kickPitch + shP;
    v.yaw = this.yaw + this.kickYaw + shY;
    v.roll = this.tilt + bobRoll + shR;
  }
}

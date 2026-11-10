import { FreeCamera, Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import type { Input } from "./Input";
import { Feel, FeelSettings, Shake } from "./feel";

const GRAVITY = -24;
const WALK = 6.5;
const SPRINT = 10;
const CROUCH = 3.6;
const SLIDE_BOOST = 13.5;
const SLIDE_TIME = 0.65;
const JUMP = 8;
const EYE = 0.7; // eye height above the collision ellipsoid's centre
const CROUCH_DROP = 0.55; // how much lower the eye goes when crouched
const SENS = 0.0022;
const FOV = 1.25;
const SPRINT_FOV = 0.08; // extra FOV while sprinting
const ZOOM_FOV = 0.55; // ~2.3x zoom on right click
const ZOOM_SPEED = 12;
const ACCEL_GROUND = 70; // m/s² toward the target velocity (snappy but not instant)
const DECEL_GROUND = 55;
const ACCEL_AIR = 14;

/** First-person player: collision capsule + camera + health, with modern movement/camera feel. */
export class Player {
  readonly body: Mesh;
  readonly camera: FreeCamera;
  health = 100;
  maxHealth = 100;
  yaw = 0;
  pitch = 0;
  /** 0 = hip, 1 = fully zoomed (right mouse). Smoothly animated. */
  zoom = 0;

  // ── read by the weapon for sway/bob/poses ──
  /** Horizontal speed in m/s. */
  speed = 0;
  sprinting = false;
  crouch = 0; // 0..1 smoothed
  sliding = false;
  grounded = false;
  private groundTimer = 0;
  /** Head-bob phase (radians); a footstep happens every π. */
  bobPhase = 0;
  /** Strafe input −1..1 (for weapon roll). */
  strafe = 0;
  /** Landing dip 0..1, springs back. */
  landDip = 0;

  private velY = 0;
  private vel = Vector3.Zero(); // horizontal velocity
  private knock = Vector3.Zero();
  private slideT = 0;
  private slideDir = Vector3.Zero();
  private kickPitch = 0; private kickPitchV = 0; // recovering recoil (spring)
  private kickYaw = 0; private kickYawV = 0;
  private landDipV = 0;
  private eyeCrouch = 0;
  private shakeT = 0;
  private lastStep = 0;
  private fovSprint = 0;
  private tilt = 0;

  constructor(scene: Scene, spawn: Vector3) {
    this.body = MeshBuilder.CreateBox("player", { size: 0.5 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.ellipsoid = new Vector3(0.4, 0.9, 0.4);
    this.body.position.copyFrom(spawn);

    this.camera = new FreeCamera("cam", spawn.add(new Vector3(0, EYE, 0)), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.fov = FOV;
    scene.activeCamera = this.camera;
  }

  get eye(): Vector3 {
    return this.camera.position;
  }

  get alive(): boolean {
    return this.health > 0;
  }

  forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }

  hurt(amount: number, from?: Vector3, push = 0): void {
    if (!this.alive) return;
    this.health -= amount;
    if (from && push > 0) {
      const d = this.body.position.subtract(from);
      d.y = 0;
      this.knock.addInPlace(d.normalize().scale(push));
    }
    Shake.add(Math.min(0.45, 0.12 + amount / 70));
    Feel.emit("hurt", { amount, from: from?.clone(), playerPos: this.body.position.clone(), yaw: this.yaw });
  }

  heal(amount: number, cap = this.maxHealth): void {
    this.health = Math.min(Math.max(cap, this.health), this.health + amount);
  }

  /** Recoil: part of the kick is permanent (aim drifts up), most of it springs back. */
  addKick(pitch: number, yaw = 0): void {
    this.pitch -= pitch * 0.3;
    this.kickPitchV -= pitch * 0.7 * 28;
    this.kickYawV += yaw * 28;
  }

  update(dt: number, input: Input): void {
    const k = input.keys;
    // Zoom (right mouse): animate FOV, and slow mouse-look in proportion so aiming stays steady
    const target = input.aimDown ? 1 : 0;
    this.zoom += (target - this.zoom) * Math.min(1, dt * ZOOM_SPEED);

    // Mouse look
    const baseFov = FOV + (ZOOM_FOV - FOV) * this.zoom;
    const sens = SENS * (baseFov / FOV);
    this.yaw += input.mouseDX * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + input.mouseDY * sens));

    // Input direction relative to view yaw
    const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = Vector3.Zero();
    let strafe = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) wish.addInPlace(fwd);
    if (k.has("KeyS") || k.has("ArrowDown")) wish.subtractInPlace(fwd);
    if (k.has("KeyD") || k.has("ArrowRight")) { wish.addInPlace(right); strafe += 1; }
    if (k.has("KeyA") || k.has("ArrowLeft")) { wish.subtractInPlace(right); strafe -= 1; }
    this.strafe += (strafe - this.strafe) * Math.min(1, dt * 8);
    const moving = wish.lengthSquared() > 0;
    const crouchHeld = k.has("KeyC") || k.has("ControlLeft");
    const wantSprint = (k.has("ShiftLeft") || k.has("ShiftRight")) && !input.aimDown && moving && !crouchHeld;

    // Slide: crouch pressed while sprinting on the ground → burst of speed that decays
    if ((input.wasPressed("KeyC") || input.wasPressed("ControlLeft")) && this.sprinting && this.grounded && this.speed > 7) {
      this.slideT = SLIDE_TIME;
      this.slideDir = this.vel.lengthSquared() > 0.01 ? this.vel.clone().normalize() : fwd.clone();
    }
    this.sliding = this.slideT > 0;
    this.sprinting = wantSprint && !this.sliding;
    this.crouch += ((crouchHeld || this.sliding ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);

    // Target velocity
    let targetSpeed = this.sprinting ? SPRINT : crouchHeld ? CROUCH : WALK;
    targetSpeed *= 1 - 0.35 * this.zoom; // slower while aiming down sights
    const targetVel = moving ? wish.normalize().scale(targetSpeed) : Vector3.Zero();
    if (this.sliding) {
      this.slideT -= dt;
      const kslide = Math.max(0, this.slideT / SLIDE_TIME);
      this.vel.copyFrom(this.slideDir.scale(CROUCH + (SLIDE_BOOST - CROUCH) * kslide));
    } else {
      const accel = this.grounded ? (moving ? ACCEL_GROUND : DECEL_GROUND) : ACCEL_AIR;
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
    if (this.grounded && input.wasPressed("Space")) {
      this.velY = JUMP;
      this.grounded = false;
      this.groundTimer = 0;
      this.slideT = 0;
    }
    this.velY += GRAVITY * dt;
    // Stick-to-ground probe: while on the ground always push down a little, so the collision test hits the floor
    // every frame (a tiny gravity step alone sometimes misses, which made `grounded` flicker every other frame and
    // the gun/camera bob switch on and off: the "after-image" while walking).
    if (this.grounded && this.velY <= 0) this.velY = Math.min(this.velY, -3);

    const disp = new Vector3(move.x * dt, this.velY * dt, move.z * dt);
    const before = this.body.position.clone();
    const velYBefore = this.velY;
    this.body.moveWithCollisions(disp);
    const movedY = this.body.position.y - before.y;
    const wasGrounded = this.grounded;
    if (this.velY < 0 && movedY > disp.y + 0.001) {
      this.groundTimer = 0.12; // standing on something; short grace period ("coyote time") covers missed frames
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
      Feel.emit("land", { strength });
      if (strength > 0.5) Shake.add(strength * 0.25);
    }
    // Actual horizontal speed (after collisions), for bob/footsteps/weapon
    this.speed = Math.hypot(this.body.position.x - before.x, this.body.position.z - before.z) / Math.max(dt, 1e-4);
    // Kill velocity into walls so we don't keep pushing
    if (this.speed < this.vel.length() * 0.3) this.vel.scaleInPlace(0.5);
    // Safety net if we ever fall through the floor
    if (this.body.position.y < -5) this.body.position.y = 2;

    // Head-bob phase + footsteps (every half cycle)
    if (this.grounded && this.speed > 0.8 && !this.sliding) {
      const rate = this.sprinting ? 13 : crouchHeld ? 6.5 : 9.5;
      this.bobPhase += dt * rate * Math.min(1.2, this.speed / WALK + 0.3);
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        if (!(crouchHeld && this.speed < 2)) Feel.emit("footstep", { sprint: this.sprinting });
      }
    }

    // Springs: recoil recovery, landing dip
    const spring = (x: number, v: number, kk: number, c: number) => {
      v += (-kk * x - c * v) * dt;
      return [x + v * dt, v];
    };
    [this.kickPitch, this.kickPitchV] = spring(this.kickPitch, this.kickPitchV, 140, 18);
    [this.kickYaw, this.kickYawV] = spring(this.kickYaw, this.kickYawV, 140, 18);
    [this.landDip, this.landDipV] = spring(this.landDip, this.landDipV, 90, 14);

    // Camera shake (trauma²)
    Shake.trauma = Math.max(0, Shake.trauma - dt * 1.6);
    this.shakeT += dt * 32;
    const sh = Shake.trauma * Shake.trauma;
    const n = (o: number) => Math.sin(this.shakeT * 1.13 + o) * 0.6 + Math.sin(this.shakeT * 2.37 + o * 1.7) * 0.4;
    const shP = sh * 0.06 * n(0), shY = sh * 0.06 * n(10), shR = sh * 0.08 * n(20);

    // Eye height: crouch + head-bob + landing dip
    this.eyeCrouch += (this.crouch * CROUCH_DROP - this.eyeCrouch) * Math.min(1, dt * 14);
    const bobAmt = FeelSettings.bob * (this.grounded ? Math.min(1, this.speed / WALK) : 0) * (1 - 0.7 * this.zoom);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.05 * bobAmt * (this.sprinting ? 1.4 : 1);
    const bobRoll = Math.sin(this.bobPhase) * 0.006 * bobAmt;
    this.camera.position.copyFrom(this.body.position).addInPlaceFromFloats(0, EYE - this.eyeCrouch - bobY + this.landDip * 0.12, 0);

    // FOV: zoom + a touch wider while sprinting
    this.fovSprint += ((this.sprinting ? 1 : 0) - this.fovSprint) * Math.min(1, dt * 6);
    this.camera.fov = baseFov + SPRINT_FOV * this.fovSprint * (1 - this.zoom);

    // Roll: slide tilt + slight strafe lean
    this.tilt += ((this.sliding ? 0.09 : 0) + -this.strafe * 0.012 - this.tilt) * Math.min(1, dt * 8);
    this.camera.rotation.set(this.pitch + this.kickPitch + shP, this.yaw + this.kickYaw + shY, this.tilt + bobRoll + shR);
  }
}

import { Vec3 } from "../math";
import type { HitTarget, InputSnapshot } from "../ports";
import type { WeaponData } from "../../data/schemas";
import type { CoreContext } from "../context";
import type { Player } from "./player";

export interface DamageResult { enemy: boolean; killed: boolean }

export interface WeaponContext extends CoreContext {
  damageTarget(target: HitTarget, amount: number, point: Vec3): DamageResult;
}

/** One gun instance: its data, ammo and reload state. */
export class Gun {
  readonly spec: WeaponData;
  ammo: number;
  /** Seconds of reload left (0 = not reloading). */
  reloading = 0;

  constructor(spec: WeaponData) {
    this.spec = spec;
    this.ammo = spec.mag;
  }

  get heavy(): boolean { return this.spec.pellets > 1; }
}

/**
 * The player's weapons: fire rate, ammo, reload, switching (1/2, wheel, last), sprint-lowered pose, spread,
 * hitscan pellets via IPhysics.raycast, damage. Presentation (gun motion, flash, shells, decals) reacts to events.
 */
export class Arsenal {
  static readonly SWITCH_TIME = 0.4;

  readonly guns: Gun[];
  current = 0;
  previous = 1;
  /** Weapon being switched to (−1 = none). */
  pending = -1;
  /** >0 while lowering (first half) / raising (second half). */
  switchT = 0;
  cooldown = 0;
  /** Smoothed 0..1: gun lowered while sprinting (can't fire above 0.3). */
  sprintPose = 0;

  private readonly ctx: WeaponContext;
  private readonly player: Player;

  constructor(ctx: WeaponContext, player: Player, specs: WeaponData[]) {
    this.ctx = ctx;
    this.player = player;
    this.guns = specs.map((s) => new Gun(s));
  }

  get gun(): Gun { return this.guns[this.current]; }

  update(dt: number, input: InputSnapshot): void {
    this.handleSwitchInput(input);
    this.cooldown -= dt;

    if (this.switchT > 0) {
      const half = Arsenal.SWITCH_TIME / 2;
      this.switchT -= dt;
      if (this.pending >= 0 && this.switchT <= half) {
        this.previous = this.current;
        this.current = this.pending;
        this.pending = -1;
      }
    }
    this.sprintPose += ((this.player.sprinting ? 1 : 0) - this.sprintPose) * Math.min(1, dt * 10);

    if (this.switchT > 0) return;
    const g = this.gun;
    if (g.reloading > 0) {
      g.reloading -= dt;
      if (g.reloading <= 0) g.ammo = g.spec.mag;
      return;
    }
    if ((input.reloadPressed && g.ammo < g.spec.mag) || g.ammo === 0) {
      g.reloading = g.spec.reloadTime;
      this.ctx.events.emit("reloadStart", { weapon: this.current });
      this.ctx.sound("reload");
      return;
    }
    // Can't fire while sprinting (gun is lowered); releasing sprint brings it back fast
    if (input.fire && this.cooldown <= 0 && this.sprintPose < 0.3) this.fire();
  }

  private handleSwitchInput(input: InputSnapshot): void {
    let to = -1;
    if (input.weapon1Pressed) to = 0;
    if (input.weapon2Pressed) to = 1;
    if (input.weaponLastPressed) to = this.previous;
    if (input.wheel !== 0) to = (this.current + (input.wheel > 0 ? 1 : -1) + this.guns.length) % this.guns.length;
    if (to < 0 || to >= this.guns.length || to === this.current || this.switchT > 0) return;
    this.gun.reloading = 0; // switching cancels a reload
    this.pending = to;
    this.switchT = Arsenal.SWITCH_TIME;
    this.ctx.events.emit("switchStart", { to });
    this.ctx.sound("switch");
  }

  private fire(): void {
    const ctx = this.ctx, rng = ctx.rng;
    const g = this.gun;
    const spec = g.spec;
    const heavy = g.heavy;
    this.cooldown = spec.fireInterval;
    g.ammo--;
    this.player.addKick(spec.kick, (rng.next() - 0.5) * spec.kick * 0.7);
    ctx.events.emit("shot", { weapon: this.current, heavy });
    ctx.sound(spec.sound);

    const spread = spec.spread * (1 - 0.6 * this.player.zoom);
    const origin = this.player.eye.clone();
    const aim = this.player.aimDir();
    let hitSomething = false, killed = false, flesh = false;
    for (let i = 0; i < spec.pellets; i++) {
      const dir = aim.clone();
      dir.addInPlaceFromFloats((rng.next() - 0.5) * spread, (rng.next() - 0.5) * spread, (rng.next() - 0.5) * spread);
      dir.normalize();
      const hit = ctx.physics.raycast(origin, dir, spec.range);
      if (!heavy && i === 0) ctx.events.emit("tracer", { to: hit ? hit.point.clone() : origin.add(dir.scale(spec.range)) });
      if (!hit) continue;
      if (hit.target) {
        const r = ctx.damageTarget(hit.target, spec.damage * hit.target.mul, hit.point);
        hitSomething = true;
        if (r.killed) killed = true;
        if (r.enemy) flesh = true;
        ctx.events.emit("impact", { point: hit.point, normal: hit.normal, kind: r.enemy ? "flesh" : "energy" });
      } else {
        ctx.events.emit("impact", { point: hit.point, normal: hit.normal, kind: "world", surface: hit.surface });
      }
    }
    if (hitSomething) {
      ctx.events.emit("shotResult", { hit: true, killed, flesh });
      ctx.sound(killed ? "kill_confirm" : "hit");
      if (flesh) ctx.sound("impact_flesh");
    }
  }
}

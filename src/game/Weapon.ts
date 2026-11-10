import { Color3, Mesh, MeshBuilder, PointLight, Ray, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { Feel, FeelSettings } from "./feel";
import type { Input } from "./Input";
import type { Player } from "./Player";
import type { HUD } from "./HUD";
import { getDamageable } from "./types";
import { Fx, flashTexture } from "./fx";
import type { SoundName } from "./Audio";
import { place } from "./Props";
import { GAMEPLAY } from "../data/gameplay";

/** Tunable numbers for one weapon. */
export interface WeaponSpec {
  name: string;
  mag: number;
  fireInterval: number;
  reloadTime: number;
  damage: number; // per pellet
  pellets: number;
  spread: number; // hip-fire spread (radians-ish)
  range: number;
  kick: number; // view kick per shot
  flash: string;
  sound: SoundName;
  /** Simple procedural gun: shown instantly, and kept as the fallback if the model fails to load. */
  build(scene: Scene): Mesh;
  /** Detailed first-person model in public/models/weapons/ (see tools/blender/optimize_weapons.py). */
  model?: string;
  /** Muzzle distance in front of the gun root (local units) for flash/smoke/tracers. */
  muzzle?: number;
  /** Recoil feel: weapon kick back (m/s impulse) and barrel climb (rad/s impulse). */
  kickBack?: number;
  kickClimb?: number;
}

function metal(scene: Scene): StandardMaterial {
  const m = new StandardMaterial("gun", scene);
  m.diffuseColor = Color3.FromHexString("#2b2833");
  m.emissiveColor = Color3.FromHexString("#0d0b10");
  m.specularColor = new Color3(0.3, 0.3, 0.3);
  return m;
}

function glowPart(scene: Scene, hex: string): StandardMaterial {
  const m = new StandardMaterial("core", scene);
  m.emissiveColor = Color3.FromHexString(hex);
  // Black diffuse/specular: only the (dim) emissive shows, so scene lights can't blow it out to white
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  return m;
}

/** Built-in fallback meshes, referenced by `proceduralMesh` in data/gameplay/weapons.json. */
const PROCEDURAL_MESHES: Record<string, (scene: Scene) => Mesh> = {
  vajra(scene: Scene): Mesh {
    const body = MeshBuilder.CreateBox("vajra", { width: 0.12, height: 0.14, depth: 0.7 }, scene);
    body.material = metal(scene);
    const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.06, height: 0.4, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.5; barrel.parent = body; barrel.material = body.material;
    const core = MeshBuilder.CreateBox("core", { width: 0.13, height: 0.05, depth: 0.25 }, scene);
    core.material = glowPart(scene, "#6e3810"); core.position.y = 0.08; core.parent = body;
    return body;
  },
  trishul(scene: Scene): Mesh {
    const body = MeshBuilder.CreateBox("trishul", { width: 0.2, height: 0.17, depth: 0.6 }, scene);
    body.material = metal(scene);
    for (const x of [-0.05, 0.05]) {
      const b = MeshBuilder.CreateCylinder("barrel", { diameter: 0.08, height: 0.35, tessellation: 8 }, scene);
      b.rotation.x = Math.PI / 2; b.position.set(x, 0.02, 0.45); b.parent = body; b.material = body.material;
    }
    // three prongs over the muzzle, a nod to the trident
    for (const x of [-0.07, 0, 0.07]) {
      const p = MeshBuilder.CreateBox("prong", { width: 0.025, height: 0.025, depth: x === 0 ? 0.2 : 0.14 }, scene);
      p.position.set(x, 0.1, 0.55); p.parent = body; p.material = glowPart(scene, "#11786e");
    }
    const core = MeshBuilder.CreateBox("core", { width: 0.21, height: 0.04, depth: 0.2 }, scene);
    core.material = glowPart(scene, "#11786e"); core.position.set(0, 0.06, -0.1); core.parent = body;
    return body;
  },
};

/** Weapon specs from data/gameplay/weapons.json (1 · VAJRA rifle, 2 · TRISHUL scatter cannon). */
const SPECS: WeaponSpec[] = GAMEPLAY.weapons.map((w) => {
  const build = PROCEDURAL_MESHES[w.proceduralMesh];
  if (!build) throw new Error(`[weapons.json] unknown proceduralMesh "${w.proceduralMesh}"`);
  return {
    name: w.name, mag: w.mag, fireInterval: w.fireInterval, reloadTime: w.reloadTime, damage: w.damage,
    pellets: w.pellets, spread: w.spread, range: w.range, kick: w.kick, flash: w.flashColor,
    sound: w.sound as SoundName, build, model: w.model, muzzle: w.muzzle, kickBack: w.kickBack, kickClimb: w.kickClimb,
  };
});
export const VAJRA: WeaponSpec = SPECS[0];
export const TRISHUL: WeaponSpec = SPECS[1];

const BASE_X = 0.2, BASE_Y = -0.17, BASE_Z = 0.45;

/** One gun instance: its mesh, ammo and reload state. */
class Gun {
  readonly spec: WeaponSpec;
  readonly mesh: Mesh;
  readonly flash: Mesh;
  ammo: number;
  reloading = 0;

  constructor(scene: Scene, spec: WeaponSpec, camera: Player["camera"], flashMat: StandardMaterial) {
    this.spec = spec;
    this.ammo = spec.mag;
    this.mesh = spec.build(scene);
    for (const m of [this.mesh, ...this.mesh.getChildMeshes()]) { m.isPickable = false; m.renderingGroupId = 1; }
    this.mesh.parent = camera;
    this.mesh.scaling.setAll(0.55);
    this.mesh.position.set(BASE_X, BASE_Y, BASE_Z);
    // Muzzle flash: two crossed billboard quads at the muzzle (shown for a frame or two per shot)
    this.flash = MeshBuilder.CreatePlane("muzzle-flash", { size: 0.22 }, scene);
    const side = MeshBuilder.CreatePlane("muzzle-flash-side", { width: 0.3, height: 0.14 }, scene);
    side.rotation.y = Math.PI / 2;
    side.parent = this.flash;
    for (const f of [this.flash, side]) {
      f.material = flashMat; f.isPickable = false; f.renderingGroupId = 1;
    }
    this.flash.parent = this.mesh;
    this.flash.position.set(0, 0.03, spec.muzzle ?? 0.42);
    this.flash.setEnabled(false);
    this.mesh.setEnabled(false);
    if (spec.model) this.loadModel(scene, spec.model);
  }

  /** Swap the procedural gun for the detailed model once it has loaded (motion animates the same root). */
  private async loadModel(scene: Scene, file: string): Promise<void> {
    try {
      const procedural = [this.mesh, ...this.mesh.getChildMeshes()].filter((m) => !m.name.startsWith("muzzle-flash"));
      const m = await place(scene, `weapons/${file}`, Vector3.Zero(), 0);
      m.root.parent = this.mesh;
      m.root.position.setAll(0);
      const glow = scene.getGlowLayerByName("glow");
      for (const mesh of m.meshes) {
        mesh.isPickable = false;
        mesh.renderingGroupId = 1; // drawn on top of the world, like the old gun
        glow?.addExcludedMesh(mesh as Mesh);
      }
      for (const p of procedural) p.isVisible = false;
    } catch (e) {
      console.warn(`[weapon] model ${file} failed to load; keeping the simple gun`, e);
    }
  }
}

/** Damped spring step: returns [x, v]. */
function spring(x: number, v: number, k: number, c: number, dt: number): [number, number] {
  v += (-k * x - c * v) * dt;
  return [x + v * dt, v];
}

/**
 * The player's weapons. Switch with 1/2, the mouse wheel, or Q (last weapon).
 * Modern feel: spring recoil, sway/bob/breathing, sprint pose, reload/switch motion, muzzle flash, smoke,
 * shells, tracers, surface-aware impacts + decals, kill-confirm hit markers.
 */
export class Arsenal {
  private scene: Scene;
  private player: Player;
  private hud: HUD;
  private guns: Gun[];
  private current = 0;
  private previous = 1;
  private pending = -1; // weapon we're switching to
  private switchT = 0; // >0 while lowering (first half) / raising (second half)
  private cooldown = 0;
  private flash: PointLight;
  private flashT = 0;
  private play: (name: SoundName) => void;
  private fx: Fx;
  // motion state
  private time = 0;
  private sprint = 0;
  private swayX = 0; private swayY = 0;
  private kickZ = 0; private kickZv = 0;
  private kickRot = 0; private kickRotV = 0;
  private kickRoll = 0; private kickRollV = 0;
  private enemyHit = false;
  private killed = false;

  static readonly SWITCH_TIME = 0.4;

  constructor(scene: Scene, player: Player, hud: HUD, play: (name: SoundName) => void = () => {}) {
    this.scene = scene;
    this.player = player;
    this.hud = hud;
    this.play = play;
    this.fx = Fx.for(scene);
    const flashMat = new StandardMaterial("muzzle-flash", scene);
    flashMat.diffuseTexture = flashTexture(scene);
    flashMat.emissiveTexture = flashMat.diffuseTexture;
    flashMat.useAlphaFromDiffuseTexture = true;
    flashMat.disableLighting = true;
    flashMat.alpha = 0.75;
    // Glow from the emissive map only (diffuse + emissive together doubled it to pure white); diffuse just supplies alpha
    flashMat.diffuseColor = Color3.Black();
    flashMat.specularColor = Color3.Black();
    flashMat.emissiveTexture!.level = 0.65;
    flashMat.backFaceCulling = false;
    this.guns = SPECS.map((s) => new Gun(scene, s, player.camera, flashMat));
    this.guns[0].mesh.setEnabled(true);

    this.flash = new PointLight("muzzle", Vector3.Zero(), scene);
    this.flash.intensity = 0;
    this.flash.range = 7;
    this.flash.parent = player.camera;
    this.flash.position.set(0.25, -0.15, 1.9); // in front of the gun so it doesn't blow out the gun itself
    Feel.on("enemyHurt", () => { this.enemyHit = true; });
    Feel.on("enemyKilled", () => { this.killed = true; });
    this.refreshHud();
  }

  private get gun(): Gun { return this.guns[this.current]; }

  /** Live effect counts (for automated checks). */
  fxStats(): ReturnType<Fx["stats"]> { return this.fx.stats(); }

  update(dt: number, input: Input): void {
    this.handleSwitchInput(input);
    this.cooldown -= dt;
    this.time += dt;
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 40);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.gun.flash.setEnabled(false); }

    // Switching animation: lower + tilt the old gun, swap, raise the new one
    let drop = 0;
    if (this.switchT > 0) {
      const half = Arsenal.SWITCH_TIME / 2;
      this.switchT -= dt;
      if (this.pending >= 0 && this.switchT <= half) {
        this.gun.mesh.setEnabled(false);
        this.gun.flash.setEnabled(false);
        this.previous = this.current;
        this.current = this.pending;
        this.pending = -1;
        this.gun.mesh.setEnabled(true);
        this.refreshHud();
      }
      const k = Math.max(0, 1 - Math.abs(this.switchT - half) / half);
      drop = k * k * (3 - 2 * k); // smoothstep
    }

    const p = this.player;
    const z = p.zoom;
    const g = this.gun;
    // Springs: recoil kick-back, barrel climb, roll
    [this.kickZ, this.kickZv] = spring(this.kickZ, this.kickZv, 260, 22, dt);
    [this.kickRot, this.kickRotV] = spring(this.kickRot, this.kickRotV, 220, 20, dt);
    [this.kickRoll, this.kickRollV] = spring(this.kickRoll, this.kickRollV, 180, 16, dt);
    // Sway: the gun lags behind mouse look
    const lag = Math.min(1, dt * 9);
    this.swayX += (Math.max(-0.05, Math.min(0.05, -input.mouseDX * 0.0007)) - this.swayX) * lag;
    this.swayY += (Math.max(-0.04, Math.min(0.04, input.mouseDY * 0.0006)) - this.swayY) * lag;
    // Sprint pose
    this.sprint += ((p.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 10);
    // Bob (synced with the camera's head-bob phase) + idle breathing
    const bobA = FeelSettings.bob * (p.grounded ? Math.min(1.2, p.speed / 6.5) : 0) * (1 - 0.85 * z);
    const bobX = Math.cos(p.bobPhase) * 0.014 * bobA;
    const bobY = -Math.abs(Math.sin(p.bobPhase)) * 0.016 * bobA;
    const breath = Math.sin(this.time * 1.7) * 0.004 * (1 - z);
    // Reload motion: tilt + roll down, a mag-in jolt at 60%, then back up
    let rDip = 0, rRoll = 0, rPitch = 0;
    if (g.reloading > 0) {
      const r = 1 - g.reloading / g.spec.reloadTime;
      const inOut = Math.min(1, r / 0.2) * Math.min(1, (1 - r) / 0.2);
      const ease = inOut * inOut * (3 - 2 * inOut);
      rDip = ease * 0.07;
      rRoll = ease * 0.55;
      rPitch = ease * 0.22;
      if (r > 0.58 && r < 0.66) rDip += Math.sin(((r - 0.58) / 0.08) * Math.PI) * 0.025; // mag slap
    }
    const sw = 1 - 0.75 * z;
    g.mesh.position.set(
      BASE_X * (1 - z) + bobX + this.swayX * sw + this.sprint * 0.04,
      BASE_Y + 0.05 * z + bobY + breath + this.swayY * sw + p.landDip * 0.06 - rDip - drop * 0.3 - this.sprint * 0.05,
      BASE_Z - this.kickZ,
    );
    g.mesh.rotation.set(
      -this.kickRot + this.sprint * 0.35 + rPitch + drop * 0.5,
      this.sprint * -0.55 + this.swayX * 2.5,
      -p.strafe * 0.035 * sw + this.kickRoll + rRoll + this.sprint * 0.3 + drop * 0.6,
    );

    if (this.switchT > 0) return;

    if (g.reloading > 0) {
      g.reloading -= dt;
      if (g.reloading <= 0) { g.ammo = g.spec.mag; this.refreshHud(); }
      return;
    }
    if ((input.wasPressed("KeyR") && g.ammo < g.spec.mag) || g.ammo === 0) {
      g.reloading = g.spec.reloadTime;
      this.hud.setAmmo("…");
      this.play("reload");
      return;
    }
    // Can't fire while sprinting (gun is lowered); releasing sprint brings it back fast
    if (input.mouseDown && this.cooldown <= 0 && this.sprint < 0.3) this.fire();
  }

  private handleSwitchInput(input: Input): void {
    let to = -1;
    if (input.wasPressed("Digit1")) to = 0;
    if (input.wasPressed("Digit2")) to = 1;
    if (input.wasPressed("KeyQ")) to = this.previous;
    if (input.wheel !== 0) to = (this.current + (input.wheel > 0 ? 1 : -1) + this.guns.length) % this.guns.length;
    if (to < 0 || to === this.current || this.switchT > 0) return;
    this.gun.reloading = 0; // switching cancels a reload
    this.pending = to;
    this.switchT = Arsenal.SWITCH_TIME;
    this.play("switch");
  }

  private fire(): void {
    const g = this.gun;
    const spec = g.spec;
    const heavy = spec.pellets > 1;
    this.cooldown = spec.fireInterval;
    g.ammo--;
    // Recoil: spring impulses (weapon) + recovering camera kick
    const zk = 1 - 0.5 * this.player.zoom;
    this.kickZv += (spec.kickBack ?? 1) * zk;
    this.kickRotV += (spec.kickClimb ?? 3) * zk;
    this.kickRollV += (Math.random() - 0.5) * (heavy ? 5 : 1.6);
    this.player.addKick(spec.kick, (Math.random() - 0.5) * spec.kick * 0.7);
    // Muzzle flash sprite + light + smoke
    this.flash.diffuse = Color3.FromHexString(spec.flash);
    this.flash.intensity = heavy ? 1.6 : 0.9; // was 7/4: with PBR + bloom it whited out the screen
    g.flash.setEnabled(true);
    g.flash.rotation.z = Math.random() * Math.PI * 2;
    g.flash.scaling.setAll((heavy ? 1.5 : 1) * (0.8 + Math.random() * 0.45));
    this.flashT = heavy ? 0.06 : 0.04;
    this.play(spec.sound);
    this.refreshHud();

    const cam = this.player.camera;
    const camF = this.player.forward();
    const camR = cam.getDirection(Vector3.Right());
    const camU = cam.getDirection(Vector3.Up());
    g.mesh.computeWorldMatrix(true);
    g.flash.computeWorldMatrix(true);
    const muzzle = g.flash.getAbsolutePosition().clone();
    this.fx.muzzleSmoke(muzzle, camF.add(camU.scale(0.3)), heavy);
    // Shell casing out of the ejection port (to the right)
    const port = g.mesh.getAbsolutePosition().add(camR.scale(0.03)).add(camU.scale(0.03)).add(camF.scale(0.05));
    this.fx.shell(port, camR.scale(1.8 + Math.random() * 0.8).add(camU.scale(1.6 + Math.random() * 0.8)).add(camF.scale(-0.4)), heavy);
    if (Math.random() < 0.5) window.setTimeout(() => this.play("shell_drop"), 450 + Math.random() * 200);

    const spread = spec.spread * (1 - 0.6 * this.player.zoom);
    const origin = this.player.eye.clone();
    let hitSomething = false;
    this.enemyHit = false;
    this.killed = false;
    let flesh = false;
    for (let i = 0; i < spec.pellets; i++) {
      const dir = camF.clone();
      dir.addInPlaceFromFloats((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
      const hit = this.scene.pickWithRay(new Ray(origin, dir.normalize(), spec.range),
        (m) => m.isPickable && m.isEnabled() && m.isVisible && !m.name.startsWith("muzzle-flash"));
      const end = hit?.pickedPoint ?? origin.add(dir.scale(spec.range));
      if (!heavy && i === 0) this.fx.tracer(muzzle, end);
      if (!hit?.hit || !hit.pickedPoint || !hit.pickedMesh) continue;
      const normal = hit.getNormal(true, true);
      const target = getDamageable(hit.pickedMesh);
      if (target) {
        const before: boolean = this.enemyHit;
        this.enemyHit = false;
        target.takeDamage(spec.damage, hit.pickedPoint);
        const wasEnemy: boolean = this.enemyHit as boolean;
        this.enemyHit = before || wasEnemy;
        hitSomething = true;
        this.fx.impact(hit.pickedPoint, normal, wasEnemy ? "flesh" : "energy");
        if (wasEnemy) flesh = true;
      } else {
        this.fx.impact(hit.pickedPoint, normal, "world", hit.pickedMesh);
      }
    }
    if (hitSomething) {
      this.hud.hitMarker(this.killed);
      this.play(this.killed ? "kill_confirm" : "hit");
      if (flesh) this.play("impact_flesh");
    }
  }

  private refreshHud(): void {
    this.hud.setWeapon(this.current, this.guns.map((g) => g.spec.name));
    this.hud.setAmmo(String(this.gun.ammo));
  }
}

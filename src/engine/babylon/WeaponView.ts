import { Color3, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, Vector3, type FreeCamera } from "@babylonjs/core";
import type { GameWorld } from "../../core/world";
import { spring } from "../../core/math";
import type { HUD } from "./HUD";
import { Fx, flashTexture } from "./fx";
import type { Audio } from "./Audio";
import { place } from "../../game/Props";
import { toV3 } from "./convert";
import { GAMEPLAY } from "../../data/gameplay";

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

const BASE_X = 0.2, BASE_Y = -0.17, BASE_Z = 0.45;

/** One gun's visuals: its mesh (procedural fallback, swapped for the detailed model) and muzzle flash. */
class GunVisual {
  readonly mesh: Mesh;
  readonly flash: Mesh;

  constructor(scene: Scene, w: (typeof GAMEPLAY.weapons)[number], camera: FreeCamera, flashMat: StandardMaterial) {
    const build = PROCEDURAL_MESHES[w.proceduralMesh];
    if (!build) throw new Error(`[weapons.json] unknown proceduralMesh "${w.proceduralMesh}"`);
    this.mesh = build(scene);
    for (const m of [this.mesh, ...this.mesh.getChildMeshes()]) { m.isPickable = false; m.renderingGroupId = 1; }
    this.mesh.parent = camera;
    this.mesh.scaling.setAll(0.55);
    this.mesh.position.set(BASE_X, BASE_Y, BASE_Z);
    // Muzzle flash: two crossed billboard quads at the muzzle (shown for a frame or two per shot)
    this.flash = MeshBuilder.CreatePlane("muzzle-flash", { size: 0.22 }, scene);
    const side = MeshBuilder.CreatePlane("muzzle-flash-side", { width: 0.3, height: 0.14 }, scene);
    side.rotation.y = Math.PI / 2;
    side.parent = this.flash;
    for (const f of [this.flash, side]) { f.material = flashMat; f.isPickable = false; f.renderingGroupId = 1; }
    this.flash.parent = this.mesh;
    this.flash.position.set(0, 0.03, w.muzzle ?? 0.42);
    this.flash.setEnabled(false);
    this.mesh.setEnabled(false);
    if (w.model) this.loadModel(scene, w.model);
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
        mesh.renderingGroupId = 1; // drawn on top of the world
        glow?.addExcludedMesh(mesh as Mesh);
      }
      for (const p of procedural) p.isVisible = false;
    } catch (e) {
      console.warn(`[weapon] model ${file} failed to load; keeping the simple gun`, e);
    }
  }
}

/**
 * First-person weapon presentation: spring recoil, sway/bob/breathing, sprint pose, reload/switch motion, muzzle
 * flash + light, smoke, shells, tracers, impacts + decals, hit markers, HUD ammo. Reads core Arsenal/Player state
 * and reacts to core events; never decides gameplay.
 */
export class WeaponView {
  private readonly world: GameWorld;
  private readonly camera: FreeCamera;
  private readonly hud: HUD;
  private readonly audio: Audio;
  private readonly guns: GunVisual[];
  private readonly light: PointLight;
  private readonly fx: Fx;
  private shown = 0;
  private lastAmmo = "";
  private flashT = 0;
  private time = 0;
  private swayX = 0; private swayY = 0;
  private kickZ = 0; private kickZv = 0;
  private kickRot = 0; private kickRotV = 0;
  private kickRoll = 0; private kickRollV = 0;
  private muzzle = Vector3.Zero();
  private readonly bobScale: number;

  constructor(scene: Scene, world: GameWorld, camera: FreeCamera, hud: HUD, audio: Audio, bobScale: number) {
    this.world = world;
    this.camera = camera;
    this.hud = hud;
    this.audio = audio;
    this.bobScale = bobScale;
    this.fx = Fx.for(scene);
    const flashMat = new StandardMaterial("muzzle-flash", scene);
    flashMat.diffuseTexture = flashTexture(scene);
    flashMat.emissiveTexture = flashMat.diffuseTexture;
    flashMat.useAlphaFromDiffuseTexture = true;
    flashMat.disableLighting = true;
    flashMat.alpha = 0.75;
    // Glow from the emissive map only (diffuse + emissive together doubled it to pure white); diffuse supplies alpha
    flashMat.diffuseColor = Color3.Black();
    flashMat.specularColor = Color3.Black();
    flashMat.emissiveTexture!.level = 0.65;
    flashMat.backFaceCulling = false;
    this.guns = GAMEPLAY.weapons.map((w) => new GunVisual(scene, w, camera, flashMat));
    this.guns[0].mesh.setEnabled(true);

    this.light = new PointLight("muzzle", Vector3.Zero(), scene);
    this.light.intensity = 0;
    this.light.range = 7;
    this.light.parent = camera;
    this.light.position.set(0.25, -0.15, 1.9); // in front of the gun so it doesn't blow out the gun itself

    const ev = world.events;
    ev.on("shot", (e) => this.onShot(e.weapon, e.heavy));
    ev.on("tracer", (e) => this.fx.tracer(this.muzzle, toV3(e.to)));
    ev.on("impact", (e) => this.fx.impact(toV3(e.point), toV3(e.normal), e.kind, e.surface as Mesh | undefined));
    ev.on("shotResult", (e) => this.hud.hitMarker(e.killed));
    this.refreshHud();
  }

  /** Live effect counts (for automated checks). */
  fxStats(): ReturnType<Fx["stats"]> { return this.fx.stats(); }

  /** Per render frame. `lookDX/DY` = this frame's mouse movement (sway). */
  update(dt: number, lookDX: number, lookDY: number): void {
    const A = this.world.arsenal, p = this.world.player;
    this.time += dt;
    this.light.intensity = Math.max(0, this.light.intensity - dt * 40);
    const gv = this.guns[this.shown];
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) gv.flash.setEnabled(false); }

    // Swap meshes when the core switches weapon (halfway through the switch)
    if (A.current !== this.shown) {
      gv.mesh.setEnabled(false);
      gv.flash.setEnabled(false);
      this.shown = A.current;
      this.guns[this.shown].mesh.setEnabled(true);
      this.refreshHud();
    }
    const g = this.guns[this.shown];
    const gun = A.guns[this.shown];
    const ammo = gun.reloading > 0 ? "…" : String(gun.ammo);
    if (ammo !== this.lastAmmo) { this.lastAmmo = ammo; this.hud.setAmmo(ammo); }

    let drop = 0;
    if (A.switchT > 0) {
      const half = 0.4 / 2;
      const k = Math.max(0, 1 - Math.abs(A.switchT - half) / half);
      drop = k * k * (3 - 2 * k); // smoothstep
    }
    const z = p.zoom;
    [this.kickZ, this.kickZv] = spring(this.kickZ, this.kickZv, 260, 22, dt);
    [this.kickRot, this.kickRotV] = spring(this.kickRot, this.kickRotV, 220, 20, dt);
    [this.kickRoll, this.kickRollV] = spring(this.kickRoll, this.kickRollV, 180, 16, dt);
    const lag = Math.min(1, dt * 9);
    this.swayX += (Math.max(-0.05, Math.min(0.05, -lookDX * 0.0007)) - this.swayX) * lag;
    this.swayY += (Math.max(-0.04, Math.min(0.04, lookDY * 0.0006)) - this.swayY) * lag;
    const sprint = A.sprintPose;
    const bobA = this.bobScale * (p.grounded ? Math.min(1.2, p.speed / 6.5) : 0) * (1 - 0.85 * z);
    const bobX = Math.cos(p.bobPhase) * 0.014 * bobA;
    const bobY = -Math.abs(Math.sin(p.bobPhase)) * 0.016 * bobA;
    const breath = Math.sin(this.time * 1.7) * 0.004 * (1 - z);
    let rDip = 0, rRoll = 0, rPitch = 0;
    if (gun.reloading > 0) {
      const r = 1 - gun.reloading / gun.spec.reloadTime;
      const inOut = Math.min(1, r / 0.2) * Math.min(1, (1 - r) / 0.2);
      const ease = inOut * inOut * (3 - 2 * inOut);
      rDip = ease * 0.07;
      rRoll = ease * 0.55;
      rPitch = ease * 0.22;
      if (r > 0.58 && r < 0.66) rDip += Math.sin(((r - 0.58) / 0.08) * Math.PI) * 0.025; // mag slap
    }
    const sw = 1 - 0.75 * z;
    g.mesh.position.set(
      BASE_X * (1 - z) + bobX + this.swayX * sw + sprint * 0.04,
      BASE_Y + 0.05 * z + bobY + breath + this.swayY * sw + p.landDip * 0.06 - rDip - drop * 0.3 - sprint * 0.05,
      BASE_Z - this.kickZ,
    );
    g.mesh.rotation.set(
      -this.kickRot + sprint * 0.35 + rPitch + drop * 0.5,
      sprint * -0.55 + this.swayX * 2.5,
      -p.strafe * 0.035 * sw + this.kickRoll + rRoll + sprint * 0.3 + drop * 0.6,
    );
  }

  private onShot(weapon: number, heavy: boolean): void {
    const spec = this.world.arsenal.guns[weapon].spec;
    const g = this.guns[weapon] ?? this.guns[this.shown];
    const zk = 1 - 0.5 * this.world.player.zoom;
    this.kickZv += spec.kickBack * zk;
    this.kickRotV += spec.kickClimb * zk;
    this.kickRollV += (Math.random() - 0.5) * (heavy ? 5 : 1.6);
    this.light.diffuse = Color3.FromHexString(spec.flashColor);
    this.light.intensity = heavy ? 1.6 : 0.9;
    g.flash.setEnabled(true);
    g.flash.rotation.z = Math.random() * Math.PI * 2;
    g.flash.scaling.setAll((heavy ? 1.5 : 1) * (0.8 + Math.random() * 0.45));
    this.flashT = heavy ? 0.06 : 0.04;

    const cam = this.camera;
    const camF = cam.getDirection(Vector3.Forward());
    const camR = cam.getDirection(Vector3.Right());
    const camU = cam.getDirection(Vector3.Up());
    g.mesh.computeWorldMatrix(true);
    g.flash.computeWorldMatrix(true);
    this.muzzle = g.flash.getAbsolutePosition().clone();
    this.fx.muzzleSmoke(this.muzzle, camF.add(camU.scale(0.3)), heavy);
    const port = g.mesh.getAbsolutePosition().add(camR.scale(0.03)).add(camU.scale(0.03)).add(camF.scale(0.05));
    this.fx.shell(port, camR.scale(1.8 + Math.random() * 0.8).add(camU.scale(1.6 + Math.random() * 0.8)).add(camF.scale(-0.4)), heavy);
    if (Math.random() < 0.5) window.setTimeout(() => this.audio.play("shell_drop"), 450 + Math.random() * 200);
  }

  private refreshHud(): void {
    this.hud.setWeapon(this.shown, this.world.arsenal.guns.map((g) => g.spec.name));
    const g = this.world.arsenal.guns[this.shown];
    this.lastAmmo = g.reloading > 0 ? "…" : String(g.ammo);
    this.hud.setAmmo(this.lastAmmo);
  }
}

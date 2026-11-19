import {
  Color3, Matrix, Mesh, MeshBuilder, PointLight, StandardMaterial, Vector3, type Engine, type FreeCamera,
  type HemisphericLight, type Scene,
} from "@babylonjs/core";
import type { GameWorld } from "../../core/world";
import type { Level } from "../../game/Level";
import { place } from "../../game/Props";
import { HEMI_COLOR } from "../../game/Environment";
import { burst } from "./fx";
import { Captives } from "./Captives";
import type { HUD } from "./HUD";
import { setTarget, toV3, type DamageFn } from "./convert";

/**
 * Presentation of the mission objects: pylons (crystal model + beam + light), pickups, the secret wall, captives,
 * cage door, extraction beacon/pad, spitter globs, the ambush alarm, the objective marker and HUD objective text.
 */
export class MissionView {
  /** Extraction pad (dim until the escape phase). */
  pad!: Mesh;
  private readonly scene: Scene;
  private readonly world: GameWorld;
  private readonly level: Level;
  private readonly hud: HUD;
  private readonly hemi: HemisphericLight;
  private readonly modelJobs: Promise<unknown>[];
  private pickupMeshes: Mesh[] = [];
  private captives!: Captives;
  private beacon!: Mesh;
  private globs = new Map<number, Mesh>();
  private pylonParts: { mesh: Mesh; beam: Mesh; light: PointLight; obs: unknown }[] = [];
  private alarmT = 0;
  private time = 0;

  constructor(scene: Scene, world: GameWorld, level: Level, hud: HUD, hemi: HemisphericLight, damage: DamageFn, modelJobs: Promise<unknown>[]) {
    this.scene = scene;
    this.world = world;
    this.level = level;
    this.hud = hud;
    this.hemi = hemi;
    this.modelJobs = modelJobs;
    this.buildPylons(damage);
    this.buildPickups();
    setTarget(level.secretWall, { kind: "secretWall", id: 0, mul: 1 }, damage);
    this.captives = new Captives(scene);
    modelJobs.push(this.captives.ready);
    this.buildBeacon();

    const ev = world.events;
    ev.on("pylonHit", (e) => burst(scene, toV3(e.at), "#ff9a80", 0.4, 0.12));
    ev.on("pylonDestroyed", (e) => this.destroyPylon(e.index));
    ev.on("secretWallHit", (e) => burst(scene, toV3(e.at), "#c8b8d8", 0.35, 0.15));
    ev.on("secretWallBroken", () => {
      const wall = level.secretWall;
      burst(scene, wall.position.clone(), "#c8b8d8", 3, 0.4);
      wall.dispose();
    });
    ev.on("pickup", (e) => this.pickupMeshes[e.index]?.dispose()); // shared material survives
    ev.on("cageOpened", () => {
      const door = level.cageDoor;
      burst(scene, door.position.clone(), "#ff2a1a", 2.5, 0.4);
      door.dispose();
    });
    ev.on("captivesFreed", () => {
      this.captives.freeAll();
      this.beacon.setEnabled(true);
      this.pad.visibility = 1;
    });
    ev.on("ambush", (e) => { this.alarmT = e.alarmSeconds; });
    ev.on("globSpawned", (e) => this.spawnGlob(e.id, toV3(e.pos)));
    ev.on("globEnded", (e) => {
      const m = this.globs.get(e.id);
      if (!m) return;
      burst(scene, toV3(e.pos), "#7dff3a", e.hitPlayer ? 0.8 : 0.6, 0.2);
      m.dispose(false, true);
      this.globs.delete(e.id);
    });
    ev.on("objective", (e) => hud.setObjective(e.text));
  }

  private buildPylons(damage: DamageFn): void {
    this.level.pylonSpots.forEach((p, index) => {
      const s = this.scene;
      const mat = new StandardMaterial("pylon", s);
      mat.emissiveColor = Color3.FromHexString("#ff1e1e");
      mat.diffuseColor = Color3.Black();
      const pylon = MeshBuilder.CreateCylinder("pylon", { diameterTop: 0.6, diameterBottom: 1.6, height: 4.5, tessellation: 6 }, s);
      pylon.position.set(p.x, p.y + 2.25, p.z);
      pylon.material = mat;
      pylon.checkCollisions = true;
      const beam = MeshBuilder.CreateCylinder("beam", { diameter: 0.25, height: 80, tessellation: 6 }, s);
      beam.position.set(p.x, p.y + 42, p.z);
      beam.material = mat;
      beam.isPickable = false;
      const light = new PointLight("pylonLight", new Vector3(p.x, p.y + 3, p.z), s);
      light.diffuse = Color3.FromHexString("#ff2a1a");
      light.intensity = 1.2;
      light.range = 16;
      let t = Math.random() * 6;
      const obs = s.onBeforeRenderObservable.add(() => {
        t += s.getEngine().getDeltaTime() / 1000;
        light.intensity = 1 + Math.sin(t * 4) * 0.3;
        pylon.rotation.y += 0.01;
      });
      const target = { kind: "pylon" as const, id: index, mul: 1 };
      setTarget(pylon, target, damage);
      this.pylonParts[index] = { mesh: pylon, beam, light, obs };
      // Swap the cylinder for the Blender crystal pylon (the cylinder stays as an invisible collider)
      this.modelJobs.push(place(s, "street_props.glb", Vector3.Zero(), 0, "Pylon").then((m) => {
        if (pylon.isDisposed()) { m.root.dispose(); return; }
        m.root.parent = pylon;
        m.root.position.y = -2.25;
        pylon.isVisible = false;
        for (const part of m.meshes) setTarget(part, target, damage);
      }));
    });
  }

  private destroyPylon(index: number): void {
    const p = this.pylonParts[index];
    if (!p) return;
    this.scene.onBeforeRenderObservable.remove(p.obs as Parameters<Scene["onBeforeRenderObservable"]["remove"]>[0]);
    burst(this.scene, p.mesh.position.clone(), "#ff3a20", 6, 0.6);
    p.mesh.dispose(); p.beam.dispose(); p.light.dispose();
  }

  private buildPickups(): void {
    const s = this.scene;
    const hm = new StandardMaterial("hp", s);
    hm.emissiveColor = Color3.FromHexString("#3dff8a");
    hm.diffuseColor = Color3.Black();
    for (const k of this.world.mission.pickups) {
      if (k.kind === "health") {
        const m = MeshBuilder.CreateBox("health", { width: 0.7, height: 0.25, depth: 0.7 }, s);
        const v = MeshBuilder.CreateBox("health-v", { width: 0.25, height: 0.26, depth: 0.7 }, s);
        v.rotation.y = Math.PI / 2; v.parent = m; v.material = hm; v.isPickable = false;
        m.material = hm; m.isPickable = false;
        m.position.set(k.pos.x, 0.8, k.pos.z);
        this.pickupMeshes[k.index] = m;
      } else {
        const sm = new StandardMaterial("secret", s);
        sm.emissiveColor = Color3.FromHexString("#ffd24d");
        sm.diffuseColor = Color3.Black();
        const m = MeshBuilder.CreatePolyhedron("secret", { type: 1, size: 0.45 }, s);
        m.material = sm; m.isPickable = false;
        m.position.set(k.pos.x, 1, k.pos.z);
        this.pickupMeshes[k.index] = m;
      }
    }
  }

  private buildBeacon(): void {
    const m = new StandardMaterial("beacon", this.scene);
    m.emissiveColor = Color3.FromHexString("#3dff8a");
    m.diffuseColor = Color3.Black();
    m.alpha = 0.5;
    const e = this.level.extraction;
    const pad = MeshBuilder.CreateGround("pad", { width: e.x2 - e.x1, height: e.z2 - e.z1 }, this.scene);
    pad.position.set((e.x1 + e.x2) / 2, 0.03, (e.z1 + e.z2) / 2);
    pad.material = m;
    pad.isPickable = false;
    pad.visibility = 0.12; // dim until the escape phase
    this.pad = pad;
    this.beacon = MeshBuilder.CreateCylinder("beacon", { diameter: 0.6, height: 80, tessellation: 8 }, this.scene);
    this.beacon.position.set(0, 40, -10);
    this.beacon.material = m;
    this.beacon.isPickable = false;
    this.beacon.setEnabled(false);
  }

  private spawnGlob(id: number, at: Vector3): void {
    const m = MeshBuilder.CreateSphere("glob", { diameter: 0.45, segments: 6 }, this.scene);
    const mat = new StandardMaterial("globm", this.scene);
    mat.emissiveColor = Color3.FromHexString("#7dff3a");
    mat.diffuseColor = Color3.Black();
    m.material = mat;
    m.isPickable = false;
    m.position.copyFrom(at);
    this.globs.set(id, m);
  }

  /** Per render frame. */
  update(dt: number, camera: FreeCamera, engine: Engine): void {
    this.time += dt;
    for (const k of this.world.mission.pickups) {
      const m = this.pickupMeshes[k.index];
      if (k.taken || !m || m.isDisposed()) continue;
      m.rotation.y += dt * 2;
      m.position.y = 0.8 + Math.sin(this.time * 3) * 0.1;
    }
    for (const g of this.world.globs) this.globs.get(g.id)?.position.set(g.pos.x, g.pos.y, g.pos.z);
    if (this.alarmT > 0) {
      this.alarmT -= dt;
      const on = Math.sin(this.alarmT * 18) > 0;
      this.hemi.diffuse = this.alarmT > 0 && on ? Color3.FromHexString("#ff4a4a") : HEMI_COLOR;
    }
    this.updateWaypoint(camera, engine);
    this.hud.setHealth(this.world.player.health);
  }

  /** Project the objective onto the screen; pin it to the screen edge when it's off-screen or behind. */
  private updateWaypoint(cam: FreeCamera, engine: Engine): void {
    const t = this.world.mission.objectiveTarget();
    if (!t) { this.hud.setWaypoint(null); return; }
    const target = toV3(t);
    const canvas = engine.getRenderingCanvas()!;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const toT = target.subtract(cam.position);
    const dist = toT.length();
    const fwd = cam.getDirection(Vector3.Forward());
    const pad = 40;
    let x: number, y: number;
    if (Vector3.Dot(toT, fwd) > 0.1) {
      const p = Vector3.Project(target, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      x = p.x; y = p.y;
    } else {
      const yaw = this.world.player.yaw;
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      x = Vector3.Dot(toT, right) > 0 ? w - pad : pad;
      y = h / 2;
    }
    x = Math.max(pad, Math.min(w - pad, x));
    y = Math.max(pad + 40, Math.min(h - pad - 40, y));
    this.hud.setWaypoint({ x, y }, dist);
  }
}

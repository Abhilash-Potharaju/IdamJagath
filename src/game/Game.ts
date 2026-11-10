import {
  Color3, Engine, GlowLayer, HemisphericLight, Matrix, Mesh, MeshBuilder, PointLight, Ray,
  Scene, StandardMaterial, Vector3,
} from "@babylonjs/core";
import { Input } from "./Input";
import { HUD } from "./HUD";
import { Level } from "./Level";
import { Player } from "./Player";
import { Arsenal } from "./Weapon";
import { Crawler, Enemy, Spitter, Warden, type GameCtx } from "./enemies";
import { isWorld, setDamageable } from "./types";
import { burst } from "./fx";
import { place } from "./Props";
import { dressLevel } from "./Dressing";
import { applyBeautyMaterials, placeBeautyProps } from "./Beauty";
import { Audio, type SoundName } from "./Audio";
import { Environment, HEMI_COLOR } from "./Environment";
import { applyResolution, graphicsSettings, setupGraphics, type GraphicsHandles, fpsCounter } from "./Graphics";

type Phase = "pylons" | "cage" | "escape" | "won" | "dead";

interface Glob { mesh: Mesh; vel: Vector3; life: number }
interface Pickup { mesh: Mesh; kind: "health" | "secret"; taken: boolean }


/** Owns the scene and runs mission logic for Level 1. */
export class Game implements GameCtx {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: Input;
  readonly hud = new HUD();
  readonly level: Level;
  readonly player: Player;
  readonly weapon: Arsenal;
  /** Model loads in flight; `ready` resolves when they're all done (failures fall back to gray boxes). */
  private modelJobs: Promise<unknown>[] = [];
  /** ?explore: sightseeing mode, no monsters, no ambush, no damage. */
  readonly explore = new URLSearchParams(location.search).has("explore");
  /** ?zoo: monsters spawn but stay frozen (no attacks, no ambush), player can't be hurt. For looking at models. */
  readonly zoo = new URLSearchParams(location.search).has("zoo");
  get ready(): Promise<void> {
    return Promise.allSettled(this.modelJobs).then(() => undefined);
  }

  enemies: Enemy[] = [];
  private globs: Glob[] = [];
  private pickups: Pickup[] = [];
  private pylonsLeft = 3;
  private phase: Phase = "pylons";
  private running = false;
  private time = 0;
  private kills = 0;
  private secrets = 0;
  private ambushDone = false;
  private hints = new Set<string>();
  private hemi: HemisphericLight;
  private env: Environment;
  /** Shadow/SSAO/SSR handles (see Graphics.ts). */
  gfx: GraphicsHandles = {};
  private glow: GlowLayer;
  private alarmT = 0;
  private beacon!: Mesh;
  private extractionPad!: Mesh;
  private captives: Mesh[] = [];
  private lastHealth = 100;
  private hurtCd = 0;
  private pylonTargets: { pos: Vector3; alive: boolean }[] = [];
  private onEnd: (title: string, body: string) => void;
  private onPause: () => void;

  constructor(canvas: HTMLCanvasElement, onEnd: (title: string, body: string) => void, onPause: () => void) {
    this.onEnd = onEnd;
    this.onPause = onPause;
    this.engine = new Engine(canvas, !graphicsSettings.retro, { stencil: true });
    // Full-resolution, DPR-aware rendering by default (?retro = old half-res pixel look). See Graphics.ts.
    applyResolution(this.engine);

    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    // Sky, fog, base lights (see Environment.ts)
    this.env = new Environment(this.scene);
    this.hemi = this.env.hemi;
    this.glow = new GlowLayer("glow", this.scene, { mainTextureSamples: 1, blurKernelSize: 24 });
    this.glow.intensity = 0.45;

    this.input = new Input(canvas);
    this.level = new Level(this.scene);
    this.level.build();
    applyBeautyMaterials(this.scene, this.level); // photo-scanned PBR surfaces + HDRI lighting (?classic = old look)
    const decorated = this.level.decorate();
    const dressed = dressLevel(this.scene, this.level); // building fronts, shop signs, debris
    this.modelJobs.push(decorated, dressed);
    // Real street props replace some scripted ones, so they go in after the scripted set-dressing has loaded
    this.modelJobs.push(Promise.allSettled([decorated, dressed]).then(() => placeBeautyProps(this.scene, this.level)));
    this.player = new Player(this.scene, this.level.playerSpawn);
    this.weapon = new Arsenal(this.scene, this.player, this.hud, (n) => this.sound(n));
    // Keep the first-person gun out of the glow layer (it bloomed into a white bar)
    for (const m of this.scene.meshes) if (m.renderingGroupId === 1) this.glow.addExcludedMesh(m as Mesh);
    const post = this.env.setupPost(this.player.camera);
    // Modern rendering: AA, cascaded moon shadows, SSAO, SSR, adaptive resolution, quality presets
    this.gfx = setupGraphics(this.engine, this.scene, this.player.camera, this.env.moon, post);
    fpsCounter(this.engine);
    this.env.addLamps([[-3.7, 17], [3.7, 26], [-3.7, 45], [3.7, 57]]);
    this.env.addFire(new Vector3(0, 0, 33.75)); // the wrecked rickshaw burns
    this.env.addAmbientParticles();
    this.modelJobs.push(this.env.addMothership());
    this.modelJobs.push(this.env.addFleet()); // key-art saucer fleet + red beams + skyline smoke

    this.buildPylons();
    this.buildPickups();
    this.buildSecretWall();
    this.buildCaptives();
    this.buildBeacon();
    // The pad's green emissive was bleeding through the glow layer over the whole view (and the gun)
    this.glow.addExcludedMesh(this.extractionPad);
    if (!this.explore) this.spawnInitialEnemies();
    this.updateObjective();
    this.hud.setHealth(this.player.health);
    this.env.restrictPointLights();
    this.ready.then(() => this.env.restrictPointLights());

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.running) { this.running = false; this.onPause(); }
    });
    window.addEventListener("resize", () => this.engine.resize());

    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
      if (this.running) this.update(dt);
      this.scene.render();
      this.input.endFrame();
    });

    (window as unknown as { __game: Game }).__game = this; // for automated playtests
  }

  /** Called from a user click (pointer lock needs a user gesture). */
  start(): void {
    this.audio.unlock();
    this.input.lock();
    this.running = true;
    this.hud.show(true);
  }

  /** Dev/test only: place the camera and run without pointer lock (used for headless screenshots). */
  debugStart(x: number, z: number, yawDeg: number, pitchDeg = 0, y = 1): void {
    this.player.body.position.set(x, y, z);
    this.player.yaw = (yawDeg * Math.PI) / 180;
    this.player.pitch = (pitchDeg * Math.PI) / 180;
    this.running = true;
    this.hud.show(true);
  }

  /** Dev/test only: advance the simulation instantly by `seconds` at 60 Hz. */
  simulate(seconds: number): void {
    for (const m of this.scene.meshes) m.computeWorldMatrix(true);
    for (let t = 0; t < seconds && this.running; t += 1 / 60) {
      // No render happens here, so refresh moving meshes' transforms for the collision system
      this.player.body.computeWorldMatrix(true);
      for (const e of this.enemies) e.root.computeWorldMatrix(true);
      this.update(1 / 60);
      this.input.endFrame();
    }
  }

  // ───────────────────────── setup ─────────────────────────

  private buildPylons(): void {
    for (const p of this.level.pylonSpots) {
      const mat = new StandardMaterial("pylon", this.scene);
      mat.emissiveColor = Color3.FromHexString("#ff1e1e");
      mat.diffuseColor = Color3.Black();
      const pylon = MeshBuilder.CreateCylinder("pylon", { diameterTop: 0.6, diameterBottom: 1.6, height: 4.5, tessellation: 6 }, this.scene);
      pylon.position.set(p.x, 2.25, p.z);
      pylon.material = mat;
      pylon.checkCollisions = true;
      const beam = MeshBuilder.CreateCylinder("beam", { diameter: 0.25, height: 80, tessellation: 6 }, this.scene);
      beam.position.set(p.x, 42, p.z);
      beam.material = mat;
      beam.isPickable = false;
      const target = { pos: new Vector3(p.x, 3, p.z), alive: true };
      this.pylonTargets.push(target);
      const light = new PointLight("pylonLight", new Vector3(p.x, 3, p.z), this.scene);
      light.diffuse = Color3.FromHexString("#ff2a1a");
      light.intensity = 1.2;
      light.range = 16;

      let hp = 160;
      let t = Math.random() * 6;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t += this.engine.getDeltaTime() / 1000;
        light.intensity = 1 + Math.sin(t * 4) * 0.3;
        pylon.rotation.y += 0.01;
      });
      const damage = {
        takeDamage: (a: number, at: Vector3) => {
          if (hp <= 0) return;
          hp -= a;
          burst(this.scene, at, "#ff9a80", 0.4, 0.12);
          this.sound("pylon_hit", at);
          if (hp <= 0) {
            this.scene.onBeforeRenderObservable.remove(obs);
            burst(this.scene, pylon.position.clone(), "#ff3a20", 6, 0.6);
            this.sound("pylon_explode", pylon.position.clone());
            pylon.dispose(); beam.dispose(); light.dispose();
            target.alive = false;
            this.pylonDestroyed();
          }
        },
      };
      setDamageable(pylon, damage);

      // Swap the cylinder for the Blender crystal pylon. The cylinder stays as an invisible collider,
      // and every part of the model forwards hits to the same damage handler.
      this.modelJobs.push(place(this.scene, "street_props.glb", Vector3.Zero(), 0, "Pylon").then((m) => {
        if (pylon.isDisposed()) { m.root.dispose(); return; }
        m.root.parent = pylon;
        m.root.position.y = -2.25;
        pylon.isVisible = false;
        for (const part of m.meshes) setDamageable(part, damage);
      }));
    }
  }

  private buildPickups(): void {
    const hm = new StandardMaterial("hp", this.scene);
    hm.emissiveColor = Color3.FromHexString("#3dff8a");
    hm.diffuseColor = Color3.Black();
    for (const p of this.level.healthSpots) {
      const m = MeshBuilder.CreateBox("health", { width: 0.7, height: 0.25, depth: 0.7 }, this.scene);
      const v = MeshBuilder.CreateBox("health-v", { width: 0.25, height: 0.26, depth: 0.7 }, this.scene);
      v.rotation.y = Math.PI / 2; v.parent = m; v.material = hm; v.isPickable = false;
      m.material = hm; m.isPickable = false;
      m.position.set(p.x, 0.8, p.z);
      this.pickups.push({ mesh: m, kind: "health", taken: false });
    }
    const sm = new StandardMaterial("secret", this.scene);
    sm.emissiveColor = Color3.FromHexString("#ffd24d");
    sm.diffuseColor = Color3.Black();
    const s = MeshBuilder.CreatePolyhedron("secret", { type: 1, size: 0.45 }, this.scene);
    s.material = sm; s.isPickable = false;
    s.position.set(this.level.secretPickup.x, 1, this.level.secretPickup.z);
    this.pickups.push({ mesh: s, kind: "secret", taken: false });
  }

  private buildSecretWall(): void {
    const wall = this.level.secretWall;
    let hp = 60;
    setDamageable(wall, {
      takeDamage: (a, at) => {
        if (hp <= 0) return;
        hp -= a;
        burst(this.scene, at, "#c8b8d8", 0.35, 0.15);
        if (hp <= 0) {
          burst(this.scene, wall.position.clone(), "#c8b8d8", 3, 0.4);
          wall.dispose();
          this.hud.message("A crumbling wall… something glints inside.", 3);
        }
      },
    });
  }

  private buildCaptives(): void {
    const m = new StandardMaterial("captive", this.scene);
    m.diffuseColor = Color3.FromHexString("#c79a6b");
    m.emissiveColor = Color3.FromHexString("#2a1530");
    for (const [x, z] of [[-2.5, 103], [0, 104.5], [2.5, 102.5]]) {
      const c = MeshBuilder.CreateCapsule("captive", { height: 1.7, radius: 0.3 }, this.scene);
      c.position.set(x, 0.85, z);
      c.material = m;
      c.isPickable = false;
      this.captives.push(c);
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
    this.extractionPad = pad;
    this.beacon = MeshBuilder.CreateCylinder("beacon", { diameter: 0.6, height: 80, tessellation: 8 }, this.scene);
    this.beacon.position.set(0, 40, -10);
    this.beacon.material = m;
    this.beacon.isPickable = false;
    this.beacon.setEnabled(false);
  }

  private spawnInitialEnemies(): void {
    const C = (x: number, z: number) => this.enemies.push(new Crawler(this, new Vector3(x, 0, z)));
    const S = (x: number, z: number) => this.enemies.push(new Spitter(this, new Vector3(x, 0, z)));
    // Lane
    C(0, 25); C(2, 36); C(-2, 50); S(0, 56);
    // West courtyard
    S(-31, 36); C(-28, 22); C(-33, 26);
    // Plaza
    S(20, 96); S(-20, 72); C(10, 68); C(-12, 90);
  }

  // ───────────────────────── GameCtx ─────────────────────────

  los(a: Vector3, b: Vector3): boolean {
    const d = b.subtract(a);
    const len = d.length();
    const hit = this.scene.pickWithRay(new Ray(a, d.normalize(), len), (m) => isWorld(m) && m.isEnabled());
    return !hit?.hit || hit.distance > len - 0.3;
  }

  spawnGlob(from: Vector3, dir: Vector3): void {
    const m = MeshBuilder.CreateSphere("glob", { diameter: 0.45, segments: 6 }, this.scene);
    const mat = new StandardMaterial("globm", this.scene);
    mat.emissiveColor = Color3.FromHexString("#7dff3a");
    mat.diffuseColor = Color3.Black();
    m.material = mat;
    m.isPickable = false;
    m.position.copyFrom(from);
    this.globs.push({ mesh: m, vel: dir.scale(15), life: 5 });
  }

  onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  readonly audio = new Audio();

  sound(name: SoundName, at?: Vector3): void {
    this.audio.play(name, at);
  }

  hint(id: string, text: string): void {
    if (this.hints.has(id)) return;
    this.hints.add(id);
    this.hud.message(text, 3.5);
  }

  // ───────────────────────── loop ─────────────────────────

  private update(dt: number): void {
    this.time += dt;
    if (this.input.wasPressed("KeyM")) this.hud.message(this.audio.toggleMute() ? "Sound on" : "Sound off", 1.2);
    this.player.update(dt, this.input);
    this.audio.update(this.player.eye, this.player.yaw);
    this.weapon.update(dt, this.input);
    if (this.zoo) this.player.health = this.player.maxHealth; // invulnerable while viewing
    else for (const e of [...this.enemies]) e.update(dt);
    this.separate();
    this.updateGlobs(dt);
    this.updatePickups(dt);
    this.updateTriggers();
    this.updateAlarm(dt);
    this.updateWaypoint();
    this.hud.setHealth(this.player.health);

    // Hurt sound whenever health drops (throttled)
    this.hurtCd -= dt;
    if (this.player.health < this.lastHealth - 0.5 && this.hurtCd <= 0 && this.player.alive) {
      this.sound("player_hurt");
      this.hurtCd = 0.25;
    }
    this.lastHealth = this.player.health;

    if (!this.player.alive && this.phase !== "dead") {
      this.phase = "dead";
      this.sound("lose");
      this.finish("YOU FELL", `The occupation holds… for now.<br/>Time ${this.fmtTime()} · Kills ${this.kills}`);
    }
  }

  /** Keep enemies from stacking and from walking through the player. */
  private separate(): void {
    const pp = this.player.body.position;
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d > 0.001 && d < min) {
          const push = new Vector3(dx / d, 0, dz / d).scale((min - d) / 2);
          b.root.moveWithCollisions(push);
          a.root.moveWithCollisions(push.scale(-1));
        }
      }
      const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = a.radius + 0.4;
      if (d > 0.001 && d < min && Math.abs(pp.y - a.pos.y) < 2.5) {
        this.player.body.moveWithCollisions(new Vector3(dx / d, 0, dz / d).scale(min - d));
      }
    }
  }

  private updateGlobs(dt: number): void {
    const eye = this.player.eye;
    this.globs = this.globs.filter((g) => {
      g.life -= dt;
      const step = g.vel.scale(dt);
      const blocked = !this.los(g.mesh.position, g.mesh.position.add(step));
      g.mesh.position.addInPlace(step);
      if (Vector3.Distance(g.mesh.position, eye) < 0.9 || Vector3.Distance(g.mesh.position, this.player.body.position) < 0.8) {
        this.player.hurt(14);
        this.hud.damageFlash();
        burst(this.scene, g.mesh.position.clone(), "#7dff3a", 0.8, 0.2);
        g.mesh.dispose(false, true);
        return false;
      }
      if (blocked || g.life <= 0 || g.mesh.position.y < 0.05) {
        if (g.life > 0) this.sound("glob_splash", g.mesh.position.clone());
        burst(this.scene, g.mesh.position.clone(), "#7dff3a", 0.6, 0.2);
        g.mesh.dispose(false, true);
        return false;
      }
      return true;
    });
  }

  private updatePickups(dt: number): void {
    const p = this.player.body.position;
    for (const k of this.pickups) {
      if (k.taken) continue;
      k.mesh.rotation.y += dt * 2;
      k.mesh.position.y = 0.8 + Math.sin(this.time * 3) * 0.1;
      if (Math.hypot(p.x - k.mesh.position.x, p.z - k.mesh.position.z) > 1.1) continue;
      if (k.kind === "health") {
        if (this.player.health >= this.player.maxHealth) continue;
        this.player.heal(25);
        this.sound("pickup");
        this.hud.message("+25 health", 1.2);
      } else {
        this.secrets++;
        this.sound("secret");
        this.player.heal(100, 200);
        this.hud.message("SECRET FOUND · Ancestor's Blessing: +100 overcharge", 3.5);
      }
      k.taken = true;
      // Don't dispose materials: all health packs share one material
      k.mesh.dispose();
    }
  }

  private inRect(r: { x1: number; x2: number; z1: number; z2: number }): boolean {
    const p = this.player.body.position;
    return p.x >= r.x1 && p.x <= r.x2 && p.z >= r.z1 && p.z <= r.z2;
  }

  private updateTriggers(): void {
    const p = this.player.body.position;

    // Surprise encounter: the Warden drops from the Charminar when you enter the plaza
    if (!this.ambushDone && !this.explore && !this.zoo && p.z > this.level.plazaEntryZ) {
      this.ambushDone = true;
      this.alarmT = 2.5;
      this.sound("alarm");
      this.hud.message("AMBUSH!", 2);
      this.enemies.push(new Warden(this, new Vector3(0, 0, 73)));
      for (const [x, z] of [[-22, 108], [22, 108], [-22, 64]]) this.enemies.push(new Crawler(this, new Vector3(x, 0, z)));
      for (const e of this.enemies) if (e.pos.z > 60) e.awake = true;
    }

    if (this.phase === "cage" && this.inRect(this.level.cageTrigger)) {
      this.phase = "escape";
      for (const c of this.captives) burst(this.scene, c.position.clone(), "#3dff8a", 2, 0.5);
      for (const c of this.captives) c.dispose();
      this.sound("captives_freed");
      this.beacon.setEnabled(true);
      this.extractionPad.visibility = 1;
      this.hud.message("Captives freed and beamed to the shelter! Get back to extraction.", 3.5);
      // Escape wave in the lane
      if (!this.explore) for (const [x, z] of [[0, 18], [2, 30], [-2, 44], [0, 52]]) {
        const c = new Crawler(this, new Vector3(x, 0, z)); c.awake = true; this.enemies.push(c);
      }
      if (!this.explore) for (const [x, z] of [[-18, 29], [0, 6]]) {
        const s = new Spitter(this, new Vector3(x, 0, z)); s.awake = true; this.enemies.push(s);
      }
      this.updateObjective();
    }

    if (this.phase === "escape" && this.inRect(this.level.extraction)) {
      this.phase = "won";
      this.sound("win");
      const secretTxt = `Secrets ${this.secrets}/1`;
      this.finish("MISSION COMPLETE",
        `Charminar sector liberated.<br/>Time ${this.fmtTime()} · Kills ${this.kills} · ${secretTxt} · Health ${Math.ceil(this.player.health)}`);
    }
  }

  private updateAlarm(dt: number): void {
    if (this.alarmT <= 0) return;
    this.alarmT -= dt;
    const on = Math.sin(this.alarmT * 18) > 0;
    this.hemi.diffuse = this.alarmT > 0 && on ? Color3.FromHexString("#ff4a4a") : HEMI_COLOR;
  }

  private pylonDestroyed(): void {
    this.pylonsLeft--;
    if (this.pylonsLeft > 0) {
      this.hud.message(`Pylon destroyed · ${this.pylonsLeft} left`, 2);
    } else {
      this.phase = "cage";
      const door = this.level.cageDoor;
      burst(this.scene, door.position.clone(), "#ff2a1a", 2.5, 0.4);
      this.sound("cage_open", door.position.clone());
      door.dispose();
      this.hud.message("All pylons down — the cage is open!", 3);
    }
    this.updateObjective();
  }

  private updateObjective(): void {
    if (this.zoo) {
      this.hud.setObjective("▸ ZOO MODE: monsters frozen for viewing. Crawlers in the lane, Spitters at the lane end / courtyard / plaza");
      return;
    }
    if (this.explore) {
      this.hud.setObjective("▸ EXPLORE MODE: no monsters. Walk around freely (remove ?explore from the URL to play the mission)");
      return;
    }
    const t: Record<string, string> = {
      pylons: `▸ Destroy the conversion pylons (${3 - this.pylonsLeft}/3) — follow the ◆ marker or the purple beams`,
      cage: "▸ The cage is open! Walk INTO the cage north of the Charminar to free the captives (◆)",
      escape: "▸ Run back to the extraction pad at the start — follow the ◆ marker / green beam",
    };
    this.hud.setObjective(t[this.phase] ?? "");
  }

  /** World position of the current objective (nearest live pylon, the cage, or extraction). */
  private objectiveTarget(): Vector3 | null {
    if (this.phase === "pylons") {
      const p = this.player.body.position;
      let best: Vector3 | null = null;
      let bestD = Infinity;
      for (const t of this.pylonTargets) {
        if (!t.alive) continue;
        const d = Vector3.DistanceSquared(t.pos, p);
        if (d < bestD) { bestD = d; best = t.pos; }
      }
      return best;
    }
    if (this.phase === "cage") return new Vector3(0, 1.5, 103);
    if (this.phase === "escape") return new Vector3(0, 1.5, -10);
    return null;
  }

  /** Project the objective onto the screen; pin it to the screen edge when it's off-screen or behind. */
  private updateWaypoint(): void {
    const target = this.objectiveTarget();
    if (!target) { this.hud.setWaypoint(null); return; }
    const cam = this.player.camera;
    const canvas = this.engine.getRenderingCanvas()!;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const toT = target.subtract(cam.position);
    const dist = toT.length();
    const fwd = this.player.forward();
    const pad = 40;
    let x: number, y: number;
    if (Vector3.Dot(toT, fwd) > 0.1) {
      const p = Vector3.Project(target, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      x = p.x; y = p.y;
    } else {
      // Behind you: show it on the left/right edge, on the side you should turn toward
      const right = new Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
      x = Vector3.Dot(toT, right) > 0 ? w - pad : pad;
      y = h / 2;
    }
    x = Math.max(pad, Math.min(w - pad, x));
    y = Math.max(pad + 40, Math.min(h - pad - 40, y));
    this.hud.setWaypoint({ x, y }, dist);
  }

  private fmtTime(): string {
    const s = Math.floor(this.time);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  private finish(title: string, body: string): void {
    this.running = false;
    this.hud.show(false);
    document.exitPointerLock();
    this.onEnd(title, body);
  }

  get isOver(): boolean {
    return this.phase === "won" || this.phase === "dead";
  }
}

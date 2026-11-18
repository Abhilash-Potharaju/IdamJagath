import { Engine, GlowLayer, Scene, type Mesh } from "@babylonjs/core";
import { GameWorld } from "../core/world";
import { FixedStep, SIM_DT } from "../core/time";
import type { LevelAnchors } from "../core/ports";
import { GAMEPLAY } from "../data/gameplay";
import { Level } from "./Level";
import { dressLevel } from "./Dressing";
import { applyBeautyMaterials } from "./Beauty";
import { Environment } from "./Environment";
import { applyResolution, graphicsSettings, setupGraphics, type GraphicsHandles, fpsCounter } from "./Graphics";
import { BabylonPhysics } from "../engine/babylon/BabylonPhysics";
import { InputDevice } from "../engine/babylon/InputDevice";
import { CameraRig } from "../engine/babylon/CameraRig";
import { WeaponView } from "../engine/babylon/WeaponView";
import { EnemyViews } from "../engine/babylon/EnemyViews";
import { MissionView } from "../engine/babylon/MissionView";
import { HUD } from "../engine/babylon/HUD";
import { Audio, type SoundName } from "../engine/babylon/Audio";
import { fromV3, type DamageFn } from "../engine/babylon/convert";

const params = new URLSearchParams(location.search);
/** ?bob=0..1 scales head-bob (accessibility); default 1. */
const BOB = Math.max(0, Math.min(1, Number(params.get("bob") ?? "1") || (params.get("bob") === "0" ? 0 : 1)));

/**
 * Composition root: builds the Babylon engine/scene and the level presentation, the engine adapter (physics, input,
 * camera, views, audio, HUD) and the portable core GameWorld, then runs the fixed-timestep loop:
 *   render frame → FixedStep.advance(frameDt) → N × [input.consume → world.step(SIM_DT)] → views.render(alpha) → scene.render
 */
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly input: InputDevice;
  readonly hud = new HUD();
  readonly audio = new Audio();
  readonly level: Level;
  readonly physics: BabylonPhysics;
  readonly world: GameWorld;
  readonly camera: CameraRig;
  readonly weapon: WeaponView;
  readonly enemyViews: EnemyViews;
  readonly mission: MissionView;
  readonly explore = params.has("explore");
  readonly zoo = params.has("zoo");
  /** Shadow/SSAO/SSR handles (see Graphics.ts). */
  gfx: GraphicsHandles = {};
  private readonly env: Environment;
  private readonly clock = new FixedStep(SIM_DT, 5);
  private modelJobs: Promise<unknown>[] = [];
  private running = false;
  private readonly onEnd: (title: string, body: string) => void;
  private readonly onPause: () => void;

  /** Model loads in flight; resolves when they're all done (failures fall back to gray boxes). */
  get ready(): Promise<void> {
    return Promise.allSettled(this.modelJobs).then(() => undefined);
  }

  constructor(canvas: HTMLCanvasElement, onEnd: (title: string, body: string) => void, onPause: () => void) {
    this.onEnd = onEnd;
    this.onPause = onPause;
    this.engine = new Engine(canvas, !graphicsSettings.retro, { stencil: true });
    applyResolution(this.engine); // full-res, DPR-aware (?retro = old half-res pixel look)
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.env = new Environment(this.scene);
    const glow = new GlowLayer("glow", this.scene, { mainTextureSamples: 1, blurKernelSize: 24 });
    glow.intensity = 0.45;

    // ── Level presentation (Babylon) ──
    this.input = new InputDevice(canvas);
    this.level = new Level(this.scene);
    this.level.build();
    applyBeautyMaterials(this.scene, this.level);
    this.modelJobs.push(this.level.decorate(), dressLevel(this.scene, this.level));

    // ── Portable core ──
    this.physics = new BabylonPhysics(this.scene);
    const L = this.level;
    const anchors: LevelAnchors = {
      playerSpawn: fromV3(L.playerSpawn), extraction: L.extraction, cageTrigger: L.cageTrigger, plazaEntryZ: L.plazaEntryZ,
      pylonSpots: L.pylonSpots.map(fromV3), healthSpots: L.healthSpots.map(fromV3), secretPickup: fromV3(L.secretPickup),
      cageDoor: fromV3(L.cageDoor.position),
    };
    this.world = new GameWorld({
      data: GAMEPLAY, level: anchors, physics: this.physics, seed: Number(params.get("seed") ?? 1) || 1,
      explore: this.explore, zoo: this.zoo, bobScale: BOB,
    });
    const damage: DamageFn = (t, a, p) => { this.world.damageTarget(t, a, p); };

    // ── Views ──
    this.camera = new CameraRig(this.scene, this.world.player);
    this.weapon = new WeaponView(this.scene, this.world, this.camera.camera, this.hud, this.audio, BOB);
    for (const m of this.scene.meshes) if (m.renderingGroupId === 1) glow.addExcludedMesh(m as Mesh); // gun out of glow
    const post = this.env.setupPost(this.camera.camera);
    this.gfx = setupGraphics(this.engine, this.scene, this.camera.camera, this.env.moon, post);
    fpsCounter(this.engine);
    this.env.addLamps();
    this.env.addFire();
    this.env.addAmbientParticles();
    this.modelJobs.push(this.env.addMothership(), this.env.addFleet());
    this.mission = new MissionView(this.scene, this.world, this.level, this.hud, this.env.hemi, damage, this.modelJobs);
    glow.addExcludedMesh(this.mission.pad); // its green emissive bled over the whole view
    this.enemyViews = new EnemyViews(this.scene, this.world, (b) => this.physics.mesh(b), damage);
    this.wireEvents();

    this.world.start(); // initial spawns + objective (views are subscribed now)
    this.hud.setHealth(this.world.player.health);
    this.env.restrictPointLights();
    this.ready.then(() => this.env.restrictPointLights());

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.running) { this.running = false; this.onPause(); }
    });
    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.frame());
    this.exposeForTests();
  }

  /** Core events → presentation that isn't owned by a specific view. */
  private wireEvents(): void {
    const ev = this.world.events, hud = this.hud, audio = this.audio;
    ev.on("sound", (e) => audio.play(e.name as SoundName, e.at));
    ev.on("message", (e) => hud.message(e.text, e.seconds));
    ev.on("hint", (e) => hud.message(e.text, 3.5));
    ev.on("hurt", (e) => hud.onHurt(e));
    ev.on("damageFlash", () => hud.damageFlash());
    ev.on("footstep", (e) => audio.play(e.sprint ? "footstep_run" : "footstep"));
    ev.on("land", (e) => { if (e.strength > 0.05) audio.play("land"); });
    hud.onHeartbeat = () => audio.play("heartbeat");
    ev.on("missionEnd", (e) => this.finish(e.title, e.body));
  }

  /** One fixed simulation step. */
  private step(dt: number): void {
    const input = this.input.consume();
    this.enemyViews.snap(); // bodies exactly at core positions for this step's raycasts
    this.world.step(dt, input);
    this.enemyViews.record();
  }

  private frame(): void {
    const frameDt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    let alpha = 1;
    if (this.running) {
      if (this.input.framePressed("KeyM")) this.hud.message(this.audio.toggleMute() ? "Sound on" : "Sound off", 1.2);
      alpha = this.clock.advance(Math.min(this.engine.getDeltaTime() / 1000, 0.25), (dt) => { if (this.running) this.step(dt); });
      this.renderViews(alpha, frameDt);
    } else {
      this.input.consume(); // drop input gathered while paused
      this.camera.apply(1);
    }
    this.scene.render();
    this.input.endFrame();
  }

  private renderViews(alpha: number, dt: number): void {
    this.camera.apply(alpha);
    this.audio.update(this.camera.camera.position, this.world.player.yaw);
    this.weapon.update(dt, this.input.frameDX, this.input.frameDY);
    this.enemyViews.render(alpha, dt);
    this.mission.update(dt, this.camera.camera, this.engine);
  }

  /** Called from a user click (pointer lock needs a user gesture). */
  start(): void {
    this.audio.unlock();
    this.input.lock();
    this.running = true;
    this.clock.reset();
    this.hud.show(true);
  }

  /** Dev/test only: place the player and run without pointer lock (used for headless checks). */
  debugStart(x: number, z: number, yawDeg: number, pitchDeg = 0, y = 1): void {
    this.world.player.teleport(x, y, z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
    this.running = true;
    this.hud.show(true);
  }

  /** Dev/test only: advance the simulation instantly by `seconds` of fixed steps (no rendering). */
  simulate(seconds: number): void {
    for (const m of this.scene.meshes) m.computeWorldMatrix(true);
    for (let t = 0; t < seconds && this.running; t += SIM_DT) {
      this.step(SIM_DT);
      this.renderViews(1, SIM_DT);
      this.input.endFrame();
    }
  }

  private finish(title: string, body: string): void {
    this.running = false;
    this.hud.show(false);
    document.exitPointerLock();
    this.onEnd(title, body);
  }

  get isOver(): boolean { return this.world.isOver; }

  /** window.__game: a stable surface for scripted playtests (tools/dev/cdp.mjs). */
  private exposeForTests(): void {
    const self = this, w = this.world;
    const player = {
      get body() { return { position: w.player.pos }; },
      get yaw() { return w.player.yaw; }, set yaw(v: number) { w.player.yaw = v; },
      get pitch() { return w.player.pitch; }, set pitch(v: number) { w.player.pitch = v; },
      get health() { return w.player.health; }, set health(v: number) { w.player.health = v; },
      get maxHealth() { return w.player.maxHealth; },
      get grounded() { return w.player.grounded; },
      get eye() { return w.player.eye; },
      get alive() { return w.player.alive; },
      get speed() { return w.player.speed; },
    };
    (window as unknown as { __game: unknown }).__game = {
      get ready() { return self.ready; },
      scene: this.scene, engine: this.engine, input: this.input, level: this.level, world: w, audio: this.audio,
      hud: this.hud, physics: this.physics,
      get gfx() { return self.gfx; },
      player,
      get enemies() { return w.enemies; },
      get phase() { return w.phase; },
      get kills() { return w.kills; },
      get pylonsLeft() { return w.mission.pylonsLeft; },
      get extractionPad() { return self.mission.pad; },
      weapon: { get current() { return w.arsenal.current; }, core: w.arsenal, fxStats: () => self.weapon.fxStats() },
      simulate: (s: number) => self.simulate(s),
      debugStart: (x: number, z: number, yaw: number, pitch?: number, y?: number) => self.debugStart(x, z, yaw, pitch, y),
      start: () => self.start(),
      get isOver() { return self.isOver; },
      stateHash: () => w.stateHash(),
    };
  }
}

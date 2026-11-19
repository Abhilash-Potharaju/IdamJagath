import {
  type AbstractMesh, type AnimationGroup, Color3, Constants, DynamicTexture, LoadAssetContainerAsync, MeshBuilder, PBRMaterial,
  PointLight, Quaternion, type Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "../../game/Props"; // configures the locally hosted meshopt decoder before any model loads
import type { GameWorld } from "../../core/world";
import { GAMEPLAY } from "../../data/gameplay";

/**
 * The captives in the Charminar cage (presentation only; the core just knows "cage opened" and "captives freed", and
 * monsters never target them, so they can't be hurt).
 *
 * Four different Hyderabadis (tools/blender/build_captives.py). Caged: a man in a kurta grips the energy door, a
 * woman kneels and pleads, a teenager cowers, and a bearded man in a hoodie is half-converted: deformed (swollen,
 * elongated arm), grey-green skin with glowing alien veins and red eyes, dark growths breaking out of him, hunched and
 * twitching under a violet conversion beam. When the door opens, the man at the door waves the player in. When the player walks in, the beam
 * dies, the conversion drains out of the third man, and all three follow the player to the extraction point: they
 * walk the player's own footpath (so never through walls), 2.4–5.4 m behind, standing when the player stops.
 */

interface CaptiveSpec {
  file: string;
  idle: string;
  /** Feet position on the cage floor and facing (Babylon yaw; π = toward the door / the Charminar). */
  at: [number, number];
  yaw: number;
  converted?: boolean;
  /** Clip to switch to once the door is open (else keeps `idle`). */
  doorOpen?: string;
  /** Trail distance behind the player while following (m). */
  follow: number;
  /** Sideways offset from the footpath while following (m; + = player's left), so all three stay visible. */
  side: number;
}

const SPECS: CaptiveSpec[] = [
  { file: "blue.glb", idle: "Grip", doorOpen: "Wave", at: [-0.9, 100.85], yaw: Math.PI, follow: 2.4, side: 0.55 },
  { file: "woman.glb", idle: "Kneel", at: [1.2, 101.9], yaw: Math.PI - 0.3, follow: 3.4, side: -0.7 },
  { file: "teen.glb", idle: "Cower", at: [-1.5, 102.9], yaw: Math.PI + 0.5, follow: 4.4, side: 0.35 },
  { file: "mutant.glb", idle: "Hunch", at: [0.3, 104.6], yaw: Math.PI, converted: true, follow: 5.4, side: -0.4 },
];
const WALK_REF = 1.45;      // m/s the walk clip is authored for
const RUN_REF = 4.0;        // m/s the run clip is authored for
const MAX_SPEED = 7.2;      // keeps up with a sprinting player
const PERSONAL_SPACE = 1.6; // never closer to the player than this
const TRAIL_STEP = 0.35;    // m between recorded footpath points
const CONVERT_GLOW = new Color3(1.5, 0.12, 0.08);
const CONVERT_TINT = new Color3(0.5, 0.6, 0.46); // sickly grey-green skin
const EYE_GLOW = new Color3(1.6, 0.15, 0.05);
const BLEND = 0.12;

interface TrailPoint { p: Vector3; s: number }

interface Captive {
  spec: CaptiveSpec;
  root: TransformNode;
  meshes: AbstractMesh[];
  /** Converted man: skin materials (tint + veins), eyes (glow), alien spikes (shrink away once free). */
  skin: PBRMaterial[];
  eyes: PBRMaterial[];
  spikes: AbstractMesh[];
  clips: Map<string, AnimationGroup>;
  current?: AnimationGroup;
  mode: "caged" | "joining" | "following";
  /** Arc-length position along the player's trail while following. */
  s: number;
  freedT: number;
  /** Current sideways offset (eases toward the spec's, or 0 where there's no room). */
  lat: number;
}

export class Captives {
  private readonly scene: Scene;
  private readonly world: GameWorld;
  private readonly list: Captive[] = [];
  private beam: { mesh: AbstractMesh; light: PointLight; mat: StandardMaterial } | null = null;
  private time = 0;
  private freed = false;
  private doorOpen = false;
  private done = false;
  private trail: TrailPoint[] = [];
  private readonly feetOffset = GAMEPLAY.player.collisionHalfExtents[1];
  /** Resolves once the models are in (the loading screen waits on it). */
  readonly ready: Promise<unknown>;

  constructor(scene: Scene, world: GameWorld) {
    this.scene = scene;
    this.world = world;
    this.ready = Promise.allSettled(SPECS.map((s) => this.load(s)));
    this.buildBeam();
    world.events.on("missionEnd", () => { this.done = true; });
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  private async load(spec: CaptiveSpec): Promise<void> {
    const c = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/captives/${spec.file}`, this.scene);
    const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = new TransformNode(`captive-${spec.file}`, this.scene);
    // build_captives.py exports them 1.70 m tall with the feet at the origin
    for (const r of inst.rootNodes) r.parent = root;
    root.position.set(spec.at[0], 0, spec.at[1]);
    root.rotation.y = spec.yaw;
    const meshes = root.getChildMeshes(false);
    const skin: PBRMaterial[] = [], eyes: PBRMaterial[] = [];
    for (const m of meshes) {
      m.isPickable = false; // bullets pass; the people are never targets
      m.receiveShadows = true;
      const mt = m.material;
      if (!spec.converted || !(mt instanceof PBRMaterial)) continue;
      // the avatar models keep skin, eyes and clothes in separate materials (each file has its own)
      if (/Avatar(Body|Head)/i.test(mt.name) && !skin.includes(mt)) skin.push(mt);
      else if (/Eyeball/i.test(mt.name) && !eyes.includes(mt)) eyes.push(mt);
    }
    for (const mt of skin) { mt.emissiveTexture = veinTexture(this.scene); mt.albedoColor = CONVERT_TINT.clone(); }
    const spikes = spec.converted ? this.growSpikes(root, inst.skeletons[0]?.bones ?? []) : [];
    const clips = new Map<string, AnimationGroup>();
    for (const g of inst.animationGroups) {
      g.stop();
      g.enableBlending = true;
      g.blendingSpeed = BLEND;
      clips.set(g.name.replace(/\.\d+$/, ""), g);
    }
    const cap: Captive = { spec, root, meshes, skin, eyes, spikes, clips, mode: "caged", s: 0, freedT: 0, lat: 0 };
    this.list.push(cap);
    const startClip = this.doorOpen && spec.doorOpen ? spec.doorOpen : spec.idle;
    this.play(cap, startClip, 0.9 + Math.random() * 0.2, true);
    if (this.freed) this.free(cap); // freed before the model finished loading
  }

  private play(c: Captive, name: string, speed = 1, randomStart = false): void {
    const g = c.clips.get(name);
    if (!g) return;
    if (c.current === g) { g.speedRatio = speed; return; }
    c.current?.stop();
    c.current = g;
    g.start(true, speed, randomStart ? g.from + Math.random() * (g.to - g.from) : g.from);
  }

  /**
   * Dark alien growths breaking out of the converted man: along his spine, his swollen right shoulder and mutated
   * forearm, and the back of his skull. Parented to his bones, so they follow every twitch.
   */
  private growSpikes(root: TransformNode, bones: { name: string; getTransformNode(): TransformNode | null }[]): AbstractMesh[] {
    const mat = new PBRMaterial("alien-growth", this.scene);
    mat.albedoColor = Color3.FromHexString("#0b070c");
    mat.metallic = 0.0;
    mat.roughness = 0.45;
    mat.emissiveColor = Color3.FromHexString("#200204");
    const node = (re: RegExp) => bones.find((b) => re.test(b.name))?.getTransformNode() ?? null;
    root.computeWorldMatrix(true);
    const yaw = root.rotation.y;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = Vector3.Up();
    const out: AbstractMesh[] = [];
    const spike = (re: RegExp, at: Vector3, dir: Vector3, len: number, base: number) => {
      const n = node(re);
      if (!n) return;
      n.computeWorldMatrix(true);
      const m = MeshBuilder.CreateCylinder("alien-spike", { height: len, diameterTop: 0, diameterBottom: base, tessellation: 7 }, this.scene);
      m.material = mat;
      m.isPickable = false;
      const d = dir.normalize();
      m.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), d, new Quaternion());
      m.position.copyFrom(n.getAbsolutePosition().add(at).add(d.scale(len * 0.38)));
      m.computeWorldMatrix(true);
      m.setParent(n);
      out.push(m);
    };
    const back = fwd.scale(-1);
    for (const [y, x, l] of [[-0.05, 0.06, 0.22], [0.05, -0.07, 0.28], [0.14, 0.05, 0.2], [0.0, -0.01, 0.16]] as const) {
      spike(/^Spine2/, up.scale(y).add(right.scale(x)).add(back.scale(0.1)), back.scale(0.8).add(up.scale(0.55)).add(right.scale(x * 3)), l, 0.06);
    }
    spike(/^RightShoulder/, up.scale(0.04), right.scale(0.6).add(up.scale(0.8)).add(back.scale(0.2)), 0.26, 0.07);
    spike(/^RightArm/, up.scale(0.03), right.scale(0.8).add(up.scale(0.5)), 0.2, 0.06);
    spike(/^RightForeArm/, right.scale(0.04), right.scale(0.7).add(back.scale(0.6)), 0.18, 0.05);
    spike(/^RightForeArm/, right.scale(0.03).add(up.scale(-0.06)), right.scale(0.5).add(back.scale(0.5)).add(up.scale(-0.5)), 0.14, 0.04);
    spike(/^Head_/, back.scale(0.08).add(up.scale(0.06)), back.scale(0.6).add(up.scale(0.8)), 0.13, 0.04);
    return out;
  }

  /** A violet conversion beam from the cage roof onto the half-converted captive. */
  private buildBeam(): void {
    const spec = SPECS.find((s) => s.converted)!;
    const mat = new StandardMaterial("conversion-beam", this.scene);
    mat.emissiveColor = Color3.FromHexString("#9a4dff");
    mat.disableLighting = true;
    mat.alpha = 0.2;
    mat.alphaMode = Constants.ALPHA_ADD; // adds light over him instead of tinting him violet
    // from the cage roof down onto his head and shoulders (enveloping his whole body washed him out to flat violet)
    const mesh = MeshBuilder.CreateCylinder("conversion-beam", { height: 1.75, diameterTop: 0.3, diameterBottom: 0.85, tessellation: 18, cap: 0 }, this.scene);
    mesh.position.set(spec.at[0], 3.2 - 1.75 / 2, spec.at[1] + 0.15);
    mesh.material = mat;
    mesh.isPickable = false;
    const light = new PointLight("conversion-light", new Vector3(spec.at[0], 2.4, spec.at[1] - 0.6), this.scene);
    light.diffuse = Color3.FromHexString("#a050ff");
    light.intensity = 1.4;
    light.range = 6;
    this.beam = { mesh, light, mat };
    // A cold work-light inside the cage so the people read from the plaza (the cage is otherwise a dark box)
    const lamp = new PointLight("cage-lamp", new Vector3(0.2, 2.9, 101.8), this.scene);
    lamp.diffuse = Color3.FromHexString("#d8e4ff");
    lamp.intensity = 1.6;
    lamp.range = 7;
  }

  /** The pylons are down and the cage door is gone: the man at the door waves the player in. */
  doorOpened(): void {
    this.doorOpen = true;
    for (const c of this.list) if (c.mode === "caged" && c.spec.doorOpen) this.play(c, c.spec.doorOpen);
  }

  /** The player walked in: the beam dies and everyone follows the player out. */
  freeAll(): void {
    if (this.freed) return;
    this.freed = true;
    this.trail = [{ p: this.playerFeet(), s: 0 }];
    if (this.beam) {
      this.beam.mesh.dispose();
      this.beam.light.dispose();
      this.beam.mat.dispose();
      this.beam = null;
    }
    for (const c of this.list) this.free(c);
  }

  private free(c: Captive): void {
    c.mode = "joining";
    c.freedT = 0;
  }

  private playerFeet(): Vector3 {
    const p = this.world.player.pos;
    return new Vector3(p.x, p.y - this.feetOffset, p.z);
  }

  /** Point on the recorded footpath at arc length s. */
  private trailAt(s: number): Vector3 {
    const t = this.trail;
    if (s <= 0 || t.length === 1) return t[0].p.clone();
    let lo = 0, hi = t.length - 1;
    if (s >= t[hi].s) return t[hi].p.clone();
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m].s <= s) lo = m; else hi = m; }
    const k = (s - t[lo].s) / Math.max(1e-6, t[hi].s - t[lo].s);
    return Vector3.Lerp(t[lo].p, t[hi].p, k);
  }

  private update(dt: number): void {
    this.time += dt;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 5.3) * Math.sin(this.time * 1.7 + 1);
    if (this.beam) {
      this.beam.mat.alpha = 0.14 + 0.1 * pulse;
      this.beam.light.intensity = 1.1 + 0.6 * pulse;
    }
    if (this.freed && !this.done) {
      // record the player's footpath
      const f = this.playerFeet(), last = this.trail[this.trail.length - 1];
      const d = Vector3.Distance(f, last.p);
      if (d >= TRAIL_STEP) this.trail.push({ p: f, s: last.s + d });
    }
    for (const c of this.list) {
      // The conversion: alien-red veins pulse under grey-green skin; once free it drains out over 2.5 s
      if (c.spec.converted) {
        const k = c.mode === "caged" ? 1 : Math.max(0, 1 - c.freedT / 2.5);
        for (const m of c.skin) {
          m.emissiveColor = CONVERT_GLOW.scale(k * pulse);
          m.albedoColor = Color3.Lerp(Color3.White(), CONVERT_TINT, k);
        }
        for (const m of c.eyes) m.emissiveColor = EYE_GLOW.scale(k * (0.7 + 0.3 * pulse));
        if (c.spikes.length) {
          for (const sp of c.spikes) sp.scaling.setAll(Math.max(0.001, k));
          if (k <= 0) { for (const sp of c.spikes) sp.dispose(); c.spikes = []; }
        }
      }
      if (c.mode === "caged") continue;
      c.freedT += dt;
      if (this.done) { this.play(c, "Idle"); continue; }
      this.follow(c, dt);
    }
  }

  private follow(c: Captive, dt: number): void {
    const p = c.root.position;
    const player = this.playerFeet();
    const total = this.trail[this.trail.length - 1].s;
    let target: Vector3;
    if (c.mode === "joining") {
      // walk to where the player stood when freeing them, then onto the footpath
      target = this.trailAt(Math.max(0, total - c.spec.follow));
      if (Vector3.Distance(p, this.trail[0].p) < 0.4 || total > c.spec.follow + 1.5) {
        c.mode = "following";
        c.s = this.nearestS(p);
      }
    } else {
      c.s = Math.max(c.s, this.nearestS(p, c.s));
      const sT = Math.max(c.s, total - c.spec.follow);
      target = this.trailAt(sT);
      // stagger sideways off the footpath where the nav grid says there's room (ground floor only)
      const back = this.trailAt(sT - 0.8), dir = target.subtract(back);
      dir.y = 0;
      let want = 0;
      if (dir.lengthSquared() > 0.04 && target.y < 1) {
        dir.normalize();
        const left = new Vector3(-dir.z, 0, dir.x), nav = this.world.nav();
        const o = target.add(left.scale(c.spec.side));
        if (nav && nav.clearanceAt(o.x, o.z) > 0.45 && nav.lineClear(target.x, target.z, o.x, o.z, 0.35)) want = c.spec.side;
        c.lat += (want - c.lat) * Math.min(1, dt * 2.5);
        target.addInPlace(left.scale(c.lat));
      } else {
        c.lat += (0 - c.lat) * Math.min(1, dt * 2.5);
      }
    }
    const toTarget = target.subtract(p);
    toTarget.y = 0;
    const gap = toTarget.length();
    const playerDist = Math.hypot(player.x - p.x, player.z - p.z);
    let speed = playerDist < PERSONAL_SPACE ? 0 : Math.min(MAX_SPEED, gap * 2.2);
    if (speed < 0.25) speed = 0;
    if (speed > 0) {
      const step = Math.min(gap, speed * dt);
      p.addInPlace(toTarget.scale(step / gap));
      p.y += (target.y - p.y) * Math.min(1, dt * 8); // stairs/slopes: the footpath carries the height
      this.turn(c, Math.atan2(toTarget.x, toTarget.z), dt, 10);
    } else {
      this.turn(c, Math.atan2(player.x - p.x, player.z - p.z), dt, 4);
    }
    if (speed === 0) this.play(c, "Idle");
    else if (speed < 3.0) this.play(c, "Walk", Math.max(0.6, speed / WALK_REF));
    else this.play(c, "Run", Math.min(1.6, speed / RUN_REF));
  }

  /** Arc length of the trail point nearest to p (searching forward from `from`). */
  private nearestS(p: Vector3, from = 0): number {
    let best = from, bd = Infinity;
    for (const t of this.trail) {
      if (t.s < from - 1) continue;
      const d = (t.p.x - p.x) ** 2 + (t.p.z - p.z) ** 2 + (t.p.y - p.y) ** 2;
      if (d < bd) { bd = d; best = t.s; }
      if (t.s > from + 12) break;
    }
    return best;
  }

  private turn(c: Captive, want: number, dt: number, rate: number): void {
    let d = want - c.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    c.root.rotation.y += d * Math.min(1, dt * rate);
  }
}

/** Glowing alien veins (emissive) for the half-converted captive: branching red lines on black. */
let veins: DynamicTexture | null = null;
function veinTexture(scene: Scene): DynamicTexture {
  if (veins && veins.getScene() === scene) return veins;
  const N = 512;
  const t = new DynamicTexture("conversion-veins", { width: N, height: N }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.fillStyle = "#000";
  g.fillRect(0, 0, N, N);
  g.lineCap = "round";
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const branch = (x: number, y: number, a: number, w: number, depth: number) => {
    let len = 0;
    while (len < 60 + depth * 30 && w > 0.4) {
      const nx = x + Math.cos(a) * 6, ny = y + Math.sin(a) * 6;
      g.strokeStyle = `rgba(255,${40 + Math.floor(rnd() * 50)},20,${0.55 + 0.45 * rnd()})`;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny; a += (rnd() - 0.5) * 0.7; w *= 0.97; len += 6;
      if (depth > 0 && rnd() < 0.08) branch(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), w * 0.7, depth - 1);
    }
  };
  for (let i = 0; i < 26; i++) branch(rnd() * N, rnd() * N, rnd() * Math.PI * 2, 2.5 + rnd() * 2.5, 2);
  t.update();
  veins = t;
  return t;
}

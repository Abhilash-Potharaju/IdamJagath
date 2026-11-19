import {
  type AbstractMesh, type AnimationGroup, Color3, LoadAssetContainerAsync, MeshBuilder, PBRMaterial, PointLight, type Scene,
  StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "../../game/Props"; // configures the locally hosted meshopt decoder before any model loads

/**
 * The captives in the Charminar cage (presentation only; the core just knows "captives freed").
 *
 * Three Hyderabadi civilians (tools/blender/build_captives.py): one grips the cage's energy door, one kneels and
 * pleads, and one is half-converted: hunched and twitching under a violet conversion beam, glowing alien red. When
 * the player walks in, the beam dies, the red glow drains out of him, and all three run out through the door and
 * south under the Charminar's arches, then fade from view.
 */

interface CaptiveSpec {
  file: string;
  idle: string;
  /** Feet position (cage floor) and facing (Babylon yaw; 0 = +z, π = toward the Charminar). */
  at: [number, number];
  yaw: number;
  converted?: boolean;
  /** Seconds after the cage opens before this one starts running. */
  delay: number;
  /** Lateral lane of the escape run (m from the centre line), so they don't run through each other. */
  lane: number;
}

const SPECS: CaptiveSpec[] = [
  { file: "blue.glb", idle: "Grip", at: [-0.6, 100.85], yaw: Math.PI, delay: 0.15, lane: -0.8 },
  { file: "white.glb", idle: "Kneel", at: [1.9, 101.9], yaw: Math.PI - 0.35, delay: 0.55, lane: 0.9 },
  { file: "red.glb", idle: "Hunch", at: [-1.9, 104.2], yaw: Math.PI + 0.25, converted: true, delay: 1.1, lane: -0.1 },
];
const RUN_SPEED = 4.6;       // m/s
const RUN_ANIM_SPEED = 1.15; // run clip playback rate matched to RUN_SPEED
const RUN_TIME = 6.5;        // s of running before fading out
const FADE = 1.2;
const CONVERT_GLOW = new Color3(0.55, 0.04, 0.06);

interface Captive {
  spec: CaptiveSpec;
  root: TransformNode;
  meshes: AbstractMesh[];
  mats: PBRMaterial[];
  idle?: AnimationGroup;
  run?: AnimationGroup;
  t: number;          // seconds since freed (-1 = still captive)
  path: Vector3[];
  leg: number;
  done: boolean;
}

export class Captives {
  private readonly scene: Scene;
  private readonly list: Captive[] = [];
  private beam: { mesh: AbstractMesh; light: PointLight; mat: StandardMaterial } | null = null;
  private time = 0;
  private freedAt = -1;
  /** Resolves once the models are in (the loading screen waits on it). */
  readonly ready: Promise<unknown>;

  constructor(scene: Scene) {
    this.scene = scene;
    this.ready = Promise.allSettled(SPECS.map((s) => this.load(s)));
    this.buildBeam();
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  private async load(spec: CaptiveSpec): Promise<void> {
    const c = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/captives/${spec.file}`, this.scene);
    const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = new TransformNode(`captive-${spec.file}`, this.scene);
    const holder = new TransformNode("captive-model", this.scene);
    holder.parent = root;
    for (const r of inst.rootNodes) r.parent = holder;
    const meshes = holder.getChildMeshes(false);
    // build_captives.py exports them 1.70 m tall with the feet at the origin (skinned bounds are unreliable here)
    root.position.set(spec.at[0], 0, spec.at[1]);
    root.rotation.y = spec.yaw;
    const mats: PBRMaterial[] = [];
    for (const m of meshes) {
      m.isPickable = false; // bullets pass; the cage door is the target, not the people
      m.receiveShadows = true;
      if (m.material instanceof PBRMaterial && !mats.includes(m.material)) {
        if (spec.converted) m.material = m.material.clone(`${m.material.name}-converted`);
        mats.push(m.material as PBRMaterial);
      }
    }
    const idle = inst.animationGroups.find((g) => g.name.startsWith(spec.idle));
    const run = inst.animationGroups.find((g) => g.name.startsWith("Run"));
    for (const g of inst.animationGroups) g.stop();
    idle?.start(true, 0.9 + Math.random() * 0.2, idle.from + Math.random() * (idle.to - idle.from));
    const cap: Captive = { spec, root, meshes, mats, idle, run, t: -1, path: [], leg: 0, done: false };
    this.list.push(cap);
    if (this.freedAt >= 0) this.free(cap); // freed before the model finished loading
  }

  /** A violet conversion beam from the cage roof onto the half-converted captive. */
  private buildBeam(): void {
    const spec = SPECS.find((s) => s.converted)!;
    const mat = new StandardMaterial("conversion-beam", this.scene);
    mat.emissiveColor = Color3.FromHexString("#9a4dff");
    mat.disableLighting = true;
    mat.alpha = 0.22;
    const mesh = MeshBuilder.CreateCylinder("conversion-beam", { height: 3.2, diameterTop: 0.5, diameterBottom: 1.3, tessellation: 18, cap: 0 }, this.scene);
    mesh.position.set(spec.at[0], 1.6, spec.at[1]);
    mesh.material = mat;
    mesh.isPickable = false;
    const light = new PointLight("conversion-light", new Vector3(spec.at[0], 2.4, spec.at[1]), this.scene);
    light.diffuse = Color3.FromHexString("#a050ff");
    light.intensity = 1.4;
    light.range = 6;
    this.beam = { mesh, light, mat };
    // A cold work-light inside the cage so the people read from the plaza (the cage is otherwise a dark box)
    const lamp = new PointLight("cage-lamp", new Vector3(0.6, 2.9, 102.4), this.scene);
    lamp.diffuse = Color3.FromHexString("#d8e4ff");
    lamp.intensity = 1.6;
    lamp.range = 7;
  }

  /** The player walked in: the beam dies and everyone runs for it. */
  freeAll(): void {
    if (this.freedAt >= 0) return;
    this.freedAt = this.time;
    if (this.beam) {
      this.beam.mesh.dispose();
      this.beam.light.dispose();
      this.beam.mat.dispose();
      this.beam = null;
    }
    for (const c of this.list) this.free(c);
  }

  private free(c: Captive): void {
    c.t = 0;
    const x = c.spec.at[0], l = c.spec.lane;
    // out of the door, south under the Charminar's central arch, round the plaza cover, toward the lane
    c.path = [new Vector3(x * 0.4, 0, 100.8), new Vector3(l * 0.6, 0, 98.6), new Vector3(l, 0, 86), new Vector3(l, 0, 74.5),
      new Vector3(-3 + l, 0, 71), new Vector3(-3 + l, 0, 60), new Vector3(l, 0, 50)];
  }

  private update(dt: number): void {
    this.time += dt;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 5.3) * Math.sin(this.time * 1.7 + 1);
    if (this.beam) {
      this.beam.mat.alpha = 0.16 + 0.1 * pulse;
      this.beam.light.intensity = 1.1 + 0.6 * pulse;
    }
    for (const c of this.list) {
      if (c.done) continue;
      // The converted man glows alien red while the beam holds him; the glow drains out once he's free
      if (c.spec.converted) {
        const k = c.t < 0 ? pulse : Math.max(0, 1 - c.t / 1.5) * pulse;
        for (const m of c.mats) m.emissiveColor = CONVERT_GLOW.scale(k);
      }
      if (c.t < 0) continue;
      c.t += dt;
      const runT = c.t - c.spec.delay;
      if (runT < 0) continue;
      if (c.run && !c.run.isPlaying) {
        c.idle?.stop();
        c.run.start(true, RUN_ANIM_SPEED);
      }
      // follow the path
      let step = RUN_SPEED * dt * Math.min(1, runT / 0.35); // quick acceleration
      while (step > 0 && c.leg < c.path.length) {
        const tgt = c.path[c.leg], p = c.root.position;
        const d = tgt.subtract(p);
        d.y = 0;
        const len = d.length();
        if (len < 1e-3) { c.leg++; continue; }
        const mv = Math.min(step, len);
        p.addInPlace(d.scale(mv / len));
        step -= mv;
        const want = Math.atan2(d.x, d.z);
        let dy = want - c.root.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.root.rotation.y += dy * Math.min(1, dt * 10);
        if (mv >= len) c.leg++;
      }
      const fade = Math.min(1, Math.max(0, (runT - RUN_TIME) / FADE));
      if (fade > 0) for (const m of c.meshes) m.visibility = 1 - fade;
      if (fade >= 1 || c.leg >= c.path.length) this.dispose(c);
    }
  }

  private dispose(c: Captive): void {
    c.done = true;
    c.idle?.dispose();
    c.run?.dispose();
    c.root.dispose(false, true);
  }
}

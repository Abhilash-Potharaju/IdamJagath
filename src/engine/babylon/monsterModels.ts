import {
  type AbstractMesh, type AnimationGroup, type AssetContainer, Color3, LoadAssetContainerAsync, type Mesh, PBRMaterial,
  Quaternion, type Scene, Space, StandardMaterial, type Texture, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "../../game/Props"; // configures the locally hosted meshopt decoder before any model loads
import { keepClearOfWalls, measureFootprint } from "./clearance";
import { setTarget, type DamageFn } from "./convert";

/**
 * Skins a code-driven enemy with an animated Sketchfab model (CC BY, see src/credits.ts).
 * The enemy's AI, collider, health, tells and counters are unchanged: the procedural body is hidden and the model
 * (parented to the enemy root) takes the hits, plays clips chosen from the enemy's state (idle / walk / run / attack /
 * hit / stun, cross-faded; walk speed matched to the actual movement), and glows with its tells. Views can add
 * procedural bone motion on top of the clips (see `poseModel`).
 */
export interface MonsterModelSpec {
  file: string;            // in public/models/monsters/
  length: number;          // metres along the model's own `axis` (y = standing height)
  axis: "x" | "y" | "z";   // which local axis `length` is measured on
  yaw: number;             // rotation to make the model face the enemy's forward (+Z)
  anim: string;            // animation-group name suffix of the main loop (the walk cycle)
  animSpeedRef: number;    // m/s at which the walk clip plays at speed 1
  keep?: string[];         // procedural part names to keep visible, re-seated on the model's back (the Spitter's sac)
  keepInPlace?: string[];  // procedural part names to keep visible where they are (the Warden's shield)
  clips?: Partial<Record<ClipRole, string>>; // extra clips by role (name suffixes); missing roles fall back to the walk
  eyes?: string[];         // material names of the eyes (glow)
  eyeColor?: string;       // eye glow colour (hex)
}

export type ClipRole = "idle" | "walk" | "run" | "attack" | "hit" | "stun" | "death";

/** A loaded model, handed to the view's `poseModel` hook every frame (after the clips are applied). */
export interface MonsterModel {
  readonly holder: TransformNode;
  readonly groups: Partial<Record<ClipRole, AnimationGroup>>;
  /** Skeleton joint by name (the glTF node, without the exporter's `_<n>` suffix), or undefined. */
  bone(name: string): TransformNode | undefined;
  /**
   * Rotate a joint by `angle` (radians) about an axis given in the enemy's own frame (x right, y up, z forward),
   * on top of this frame's clip pose. The offset is undone after rendering, so it never accumulates.
   */
  turn(bone: TransformNode | undefined, axis: Vector3, angle: number): void;
}

/** What a model needs from an enemy view (see EnemyViews.ts). */
export interface SkinnableEnemy {
  readonly root: Mesh;
  readonly alive: boolean;
  readonly core: { id: number; tell?: string; state?: string };
  /** Which clip to play now; default: idle / walk / run by speed. */
  modelClip?(speed: number): ClipRole;
  /** Procedural motion on top of the clips (called every frame after the animation update). */
  poseModel?(m: MonsterModel, dt: number, speed: number): void;
  /** Set when the model has a death clip (presentation of death is up to the view; see EnemyView.die). */
  deathAnim?: AnimationGroup;
}

/** ?classicmonsters keeps the old procedural monsters. */
const ENABLED = !new URLSearchParams(location.search).has("classicmonsters");
const cache = new Map<string, Promise<AssetContainer>>();

function load(scene: Scene, file: string): Promise<AssetContainer> {
  let p = cache.get(file);
  if (!p) {
    p = LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/monsters/${file}`, scene);
    cache.set(file, p);
  }
  return p;
}

// Presence: wet organic skin with a faint blood-red inner glow (the alien palette); tells add on top
const SKIN_GLOW = new Color3(0.16, 0.015, 0.02);  // multiplies the albedo texture used as emissive
const SKIN_GLOW_FLAT = new Color3(0.05, 0.004, 0.006); // materials without an albedo texture
const BLEND_RATE = 7; // 1/s clip cross-fade

/** Make a model material look wet and alien; returns its own resting emissive. */
function wetAlien(m: PBRMaterial | StandardMaterial, isEye: boolean, eye: Color3): Color3 {
  if (m instanceof PBRMaterial) {
    if (isEye) {
      m.emissiveColor = eye.clone();
      m.roughness = 0.15;
      return m.emissiveColor.clone();
    }
    // Lower roughness (glossy, slimy), a thin clear coat for the wet sheen
    m.roughness = Math.min(m.roughness ?? 1, 1) * 0.62;
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.45;
    m.clearCoat.roughness = 0.18;
    if (!m.emissiveTexture && m.albedoTexture) {
      m.emissiveTexture = m.albedoTexture as Texture;
      m.emissiveColor = SKIN_GLOW.clone();
    } else if (!m.emissiveTexture) {
      m.emissiveColor = SKIN_GLOW_FLAT.clone();
    }
    m.maxSimultaneousLights = 8;
    return m.emissiveColor.clone();
  }
  return m.emissiveColor.clone();
}

/**
 * `onMuzzle` receives the local position where a kept part (e.g. the Spitter's sac) was re-seated, so the core can
 * fire from the visible weak spot (set once per model; deterministic).
 */
export function attachMonsterModel(view: SkinnableEnemy, spec: MonsterModelSpec, onMuzzle?: (local: { x: number; y: number; z: number }) => void): void {
  if (!ENABLED) return;
  const e = view as SkinnableEnemy & { bodyMat: StandardMaterial; damage: DamageFn };
  const scene = e.root.getScene();
  const restGlow = e.bodyMat.emissiveColor.clone(); // the enemy's own resting emissive: anything else is a tell/flash
  load(scene, spec.file).then((c) => {
    if (e.root.isDisposed() || !e.alive) return;
    const inst = c.instantiateModelsToScene((n) => n, true, { doNotInstantiate: true });
    // root (physics body) -> clear (visual wall clearance, see clearance.ts) -> holder (fitted model)
    const clear = new TransformNode("monster-clearance", scene);
    clear.parent = e.root;
    const holder = new TransformNode("monster-model", scene);
    holder.parent = clear;
    for (const r of inst.rootNodes) r.parent = holder;
    const meshes = holder.getChildMeshes(false) as AbstractMesh[];

    // Fit: measure in the holder's space at bind pose, scale to the target length, put the feet on the ground
    holder.computeWorldMatrix(true);
    const inv = holder.getWorldMatrix().clone().invert();
    const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      for (const v of m.getBoundingInfo().boundingBox.vectorsWorld) {
        const l = Vector3.TransformCoordinates(v, inv);
        mn.minimizeInPlace(l); mx.maximizeInPlace(l);
      }
    }
    const extent = spec.axis === "x" ? mx.x - mn.x : spec.axis === "y" ? mx.y - mn.y : mx.z - mn.z;
    const s = spec.length / Math.max(extent, 1e-3);
    const half = e.root.ellipsoid.y; // enemy root sits half its height above the ground
    holder.scaling.setAll(s);
    // Centre offset is measured in the model's own (unrotated) space, so rotate it by the yaw too
    const cx = -((mn.x + mx.x) / 2) * s, cz = -((mn.z + mx.z) / 2) * s;
    const cy = Math.cos(spec.yaw), sy = Math.sin(spec.yaw);
    holder.position.set(cx * cy + cz * sy, -half - mn.y * s, -cx * sy + cz * cy);
    holder.rotation.y = spec.yaw;
    const baseY = holder.position.y;
    const topY = -half + (mx.y - mn.y) * s; // model top, relative to the enemy root

    // Hide the procedural body (kept parts stay); the model becomes the hit target
    const own = new Set(meshes);
    for (const m of e.root.getChildMeshes(false)) {
      if (own.has(m)) continue;
      if (spec.keepInPlace?.some((k) => m.name === k)) continue;
      if (spec.keep?.some((k) => m.name === k)) {
        // Re-seat kept parts on the model's back (e.g. the Spitter's sac, its weak spot + firing tell)
        m.setParent(clear);
        m.position.set(0, topY + 0.05, spec.length * 0.12);
        onMuzzle?.(m.position);
        continue;
      }
      m.isVisible = false;
    }
    const stopClearance = keepClearOfWalls(scene, e.root, clear, measureFootprint(e.root, meshes), () => e.alive);
    const eyeColor = Color3.FromHexString(spec.eyeColor ?? "#ff2a12");
    const mats = new Map<PBRMaterial | StandardMaterial, { rest: Color3; eye: boolean }>();
    for (const m of meshes) {
      m.isPickable = true;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds don't follow the animation; avoid culling pops
      setTarget(m, { kind: "enemy", id: e.core.id, mul: 1 }, e.damage);
      const mat = m.material as PBRMaterial | StandardMaterial | null;
      if (mat && !mats.has(mat)) {
        const eye = !!spec.eyes?.includes(mat.name);
        mats.set(mat, { rest: wetAlien(mat, eye, eyeColor), eye });
      }
    }

    // Joints by name (glTF exporters append "_<index>"); per-frame procedural offsets are undone after rendering
    const joints = new Map<string, TransformNode>();
    for (const t of holder.getChildTransformNodes(false)) joints.set(t.name.replace(/_\d+$/, ""), t);
    const turned = new Map<TransformNode, Quaternion>();
    const tmpAxis = new Vector3();
    const model: MonsterModel = {
      holder,
      groups: {},
      bone: (n) => joints.get(n),
      turn(b, axis, angle) {
        if (!b || Math.abs(angle) < 1e-4) return;
        if (!b.rotationQuaternion) b.rotationQuaternion = Quaternion.FromEulerVector(b.rotation);
        if (!turned.has(b)) turned.set(b, b.rotationQuaternion.clone());
        Vector3.TransformNormalToRef(axis, e.root.getWorldMatrix(), tmpAxis);
        b.rotate(tmpAxis.normalize(), angle, Space.WORLD);
      },
    };
    const undoTurns = scene.onAfterRenderObservable.add(() => {
      for (const [b, q] of turned) b.rotationQuaternion?.copyFrom(q);
      turned.clear();
    });

    // Clips: the main loop plus optional role clips, cross-faded by weight
    const find = (suffix?: string) => suffix ? inst.animationGroups.find((g) => g.name.endsWith(suffix)) : undefined;
    const group: AnimationGroup | undefined = find(spec.anim) ?? inst.animationGroups[0];
    const roles: ClipRole[] = ["idle", "walk", "run", "attack", "hit", "stun", "death"];
    for (const r of roles) {
      const g = r === "walk" ? group : find(spec.clips?.[r]);
      if (g) model.groups[r] = g;
    }
    const playing = new Set<AnimationGroup>(Object.values(model.groups).filter((g) => g !== model.groups.death));
    if (model.groups.death) { view.deathAnim = model.groups.death; model.groups.death.stop(); }
    for (const g of inst.animationGroups) if (!playing.has(g) && g !== model.groups.death) g.stop();
    const weight = new Map<AnimationGroup, number>();
    for (const g of playing) {
      g.start(true, 1);
      g.weight = g === group ? 1 : 0;
      weight.set(g, g.weight);
    }
    const defaultClip = (speed: number): ClipRole =>
      speed < 0.25 && model.groups.idle ? "idle" : speed > spec.animSpeedRef * 1.8 && model.groups.run ? "run" : "walk";

    const last = e.root.position.clone();
    let speed = 0, crouch = 0, strike = 0, breath = Math.random() * 6;
    const obs = scene.onBeforeRenderObservable.add(() => {
      if (e.root.isDisposed()) {
        scene.onBeforeRenderObservable.remove(obs);
        scene.onAfterRenderObservable.remove(undoTurns);
        stopClearance();
        for (const g of inst.animationGroups) g.dispose();
        for (const sk of inst.skeletons) sk.dispose(); // per-instance clones: free them with the corpse
        for (const m of mats.keys()) m.dispose(false, false); // cloned materials (textures stay shared)
        return;
      }
      const dt = Math.max(scene.getEngine().getDeltaTime() / 1000, 1e-3);
      const raw = Math.hypot(e.root.position.x - last.x, e.root.position.z - last.z) / dt;
      speed += (raw - speed) * Math.min(1, dt * 10); // smoothed: the fixed-step sim makes per-frame speed jittery
      last.copyFrom(e.root.position);
      // Tells/flash glow mirrored from the enemy's body material; at rest the model keeps its own faint red glow
      const glow = e.bodyMat.emissiveColor;
      const tell = !glow.equalsWithEpsilon(restGlow, 0.01);
      for (const [m, st] of mats) m.emissiveColor = tell ? (st.eye ? glow.scale(2) : glow.scale(1.4)) : st.rest;
      if (e.alive) {
        // Cross-fade toward the clip for the current state; the walk clip's rate follows the actual speed
        const role = view.modelClip?.(speed) ?? defaultClip(speed);
        const want = model.groups[role] ?? group;
        for (const g of playing) {
          const w = weight.get(g)! + ((g === want ? 1 : 0) - weight.get(g)!) * Math.min(1, dt * BLEND_RATE);
          weight.set(g, w);
          g.weight = w;
        }
        // (a model whose only clip is an idle keeps it at its own pace; the view strides procedurally)
        if (group && group !== model.groups.idle) group.speedRatio = Math.min(2.5, Math.max(0.35, speed / spec.animSpeedRef));
        const run = model.groups.run;
        if (run && run !== group) run.speedRatio = Math.min(2, Math.max(0.6, speed / (spec.animSpeedRef * 2.5)));
        holder.position.y = baseY;
        if (view.poseModel) view.poseModel(model, dt, speed);
        else {
          // Generic tells for single-clip models: crouch/rear back in a windup, stretch into a lunge; slow breathing
          const c = e.core as { state?: string; windup?: number };
          const winding = c.state === "windup" || (c.windup ?? 0) > 0;
          crouch += ((winding ? 1 : 0) - crouch) * Math.min(1, dt * 12);
          strike += ((c.state === "lunge" ? 1 : 0) - strike) * Math.min(1, dt * 16);
          breath += dt * (1 + crouch);
          const h = topY + half; // model height
          holder.position.y = baseY - crouch * 0.12 * h + strike * 0.08 * h;
          holder.scaling.y = s * (1 + Math.sin(breath * 2.2) * 0.025 - crouch * 0.1 + strike * 0.05);
          clear.rotation.x = -0.14 * crouch + 0.16 * strike; // about the enemy's own x axis (nose up, then down)
        }
      } else if (playing.size > 1) {
        // Dying: keep only the dominant clip so the death presentation below works on a single group
        let top = group;
        for (const g of playing) if (top && weight.get(g)! > weight.get(top)!) top = g;
        for (const g of playing) if (g !== top) g.stop();
        if (top) top.weight = 1;
        playing.clear();
      }
      if (!e.alive) {
        // Death (the corpse moves the whole body, see Corpses.ts): the gait thrashes on for a moment, then winds down
        // as the limbs go limp; twitches replay a few frames; the hit-stop holds it still
        const ds = (e as unknown as { death?: { limp: number; twitch: number; frozen: boolean } }).death;
        const ratio = !ds || ds.frozen ? 0 : Math.max(1.4 * (1 - ds.limp) ** 2, ds.twitch * 2.2);
        if (group) {
          if (ratio < 0.03) group.pause();
          else { group.speedRatio = ratio; if (!group.isPlaying) group.play(true); }
        }
      }
    });
  }).catch((err) => console.warn(`[monster] ${spec.file} failed; keeping the procedural body`, err));
}

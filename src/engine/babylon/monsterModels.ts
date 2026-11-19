import {
  type AbstractMesh, type AnimationGroup, type AssetContainer, LoadAssetContainerAsync, type Mesh, PBRMaterial,
  type Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "../../game/Props"; // configures the locally hosted meshopt decoder before any model loads
import { keepClearOfWalls, measureFootprint } from "./clearance";
import { setTarget, type DamageFn } from "./convert";

/**
 * Skins a code-driven enemy with an animated Sketchfab model (CC BY, see src/credits.ts).
 * The enemy's AI, collider, health, tells and counters are unchanged: the procedural body is hidden and the model
 * (parented to the enemy root) takes the hits, plays its walk cycle at the enemy's speed, and glows with its tells.
 */
export interface MonsterModelSpec {
  file: string;            // in public/models/monsters/
  length: number;          // metres along the model's own long axis (before yaw)
  axis: "x" | "z";         // which local axis `length` is measured on
  yaw: number;             // rotation to make the model face the enemy's forward (+Z)
  anim: string;            // animation-group name suffix to loop
  animSpeedRef: number;    // m/s at which the animation plays at speed 1
  keep?: string[];         // procedural part names to keep visible (e.g. the Spitter's glowing sac)
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

/** What a model needs from an enemy view (see EnemyViews.ts). */
export interface SkinnableEnemy {
  readonly root: Mesh;
  readonly alive: boolean;
  readonly core: { id: number };
}

/**
 * `onMuzzle` receives the local position where a kept part (e.g. the Spitter's sac) was re-seated, so the core can
 * fire from the visible weak spot (set once per model; deterministic).
 */
export function attachMonsterModel(view: SkinnableEnemy, spec: MonsterModelSpec, onMuzzle?: (local: { x: number; y: number; z: number }) => void): void {
  if (!ENABLED) return;
  const e = view as SkinnableEnemy & { bodyMat: StandardMaterial; damage: DamageFn };
  const scene = e.root.getScene();
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
    const extent = spec.axis === "x" ? mx.x - mn.x : mx.z - mn.z;
    const s = spec.length / Math.max(extent, 1e-3);
    const half = e.root.ellipsoid.y; // enemy root sits half its height above the ground
    holder.scaling.setAll(s);
    // Centre offset is measured in the model's own (unrotated) space, so rotate it by the yaw too
    const cx = -((mn.x + mx.x) / 2) * s, cz = -((mn.z + mx.z) / 2) * s;
    const cy = Math.cos(spec.yaw), sy = Math.sin(spec.yaw);
    holder.position.set(cx * cy + cz * sy, -half - mn.y * s, -cx * sy + cz * cy);
    holder.rotation.y = spec.yaw;
    const topY = -half + (mx.y - mn.y) * s; // model top, relative to the enemy root

    // Hide the procedural body (kept parts stay); the model becomes the hit target
    const own = new Set(meshes);
    for (const m of e.root.getChildMeshes(false)) {
      if (own.has(m)) continue;
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
    const mats = new Set<PBRMaterial | StandardMaterial>();
    for (const m of meshes) {
      m.isPickable = true;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds don't follow the animation; avoid culling pops
      setTarget(m, { kind: "enemy", id: e.core.id, mul: 1 }, e.damage);
      if (m.material) mats.add(m.material as PBRMaterial | StandardMaterial);
    }

    // Walk cycle follows actual movement speed; tells/flash glow mirrored from the enemy's body material
    const group: AnimationGroup | undefined =
      inst.animationGroups.find((g) => g.name.endsWith(spec.anim)) ?? inst.animationGroups[0];
    for (const g of inst.animationGroups) if (g !== group) g.stop();
    group?.start(true, 1);
    const last = e.root.position.clone();
    let dying = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      if (e.root.isDisposed()) {
        scene.onBeforeRenderObservable.remove(obs);
        stopClearance();
        for (const g of inst.animationGroups) g.dispose();
        return;
      }
      const dt = Math.max(scene.getEngine().getDeltaTime() / 1000, 1e-3);
      const speed = Math.hypot(e.root.position.x - last.x, e.root.position.z - last.z) / dt;
      last.copyFrom(e.root.position);
      if (group) group.speedRatio = Math.min(2.5, Math.max(0.35, speed / spec.animSpeedRef));
      const glow = e.bodyMat.emissiveColor;
      for (const m of mats) m.emissiveColor = glow.scale(1.4);
      if (!e.alive) {
        // Death: freeze the animation and topple over (the enemy disposes its root after its own death timer)
        group?.pause();
        dying += dt;
        holder.rotation.z = Math.min(1.5, dying * 4);
      }
    });
  }).catch((err) => console.warn(`[monster] ${spec.file} failed; keeping the procedural body`, err));
}

import { Color3, Mesh, PointLight, StandardMaterial, Texture, type TransformNode, Vector3, type Scene } from "@babylonjs/core";
import type { Level } from "./Level";
import { place } from "./Props";
import { dressWarDamage } from "./WarDressing";

/**
 * Set dressing from the Blender kits: old-city building fronts on the plain blocks,
 * shop signs in Telugu/Hindi/Urdu, and war debris (burning car, drop-pod, sandbags…).
 * Purely visual, except for a few invisible colliders added for the bigger debris.
 */

// Facade modules by height: [name, width]
const MODULES: Record<9 | 11 | 14, [string, number][]> = {
  9: [["Facade_C_6x9", 6], ["Facade_A_4x9", 4]],
  11: [["Facade_D_6x11", 6], ["Facade_B_4x11", 4]],
  14: [["Facade_E_6x14", 6], ["Facade_F_4x14", 4]],
};

// Shop signs: 10 pre-rendered variants (tools/textures/generators.ts → public/textures/generated/sign_NN.png),
// drawn upside down because the facade sign panel's V axis is flipped. Cycled across the facades in placement order.
const SIGN_COUNT = 10;
const BASE = import.meta.env.BASE_URL;
let signIdx = 0;
const signMats = new Map<number, StandardMaterial>();

function signMaterial(scene: Scene): StandardMaterial {
  const i = signIdx++ % SIGN_COUNT;
  let m = signMats.get(i);
  if (!m) {
    const tex = new Texture(`${BASE}textures/generated/sign_${String(i).padStart(2, "0")}.png`, scene);
    m = new StandardMaterial(`signMat${i}`, scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex; // lit sign boards read at night and add colour
    m.emissiveColor = new Color3(0.55, 0.55, 0.55);
    m.specularColor = Color3.Black();
    signMats.set(i, m);
  }
  return m;
}

/**
 * Tile building fronts along a wall run.
 * wall: the coordinate of the wall face (x for N–S runs, z for E–W runs);
 * from/to: the run extent along the other axis; yaw: which way the fronts face.
 * The back of each module sits flush on the block's face (2 cm out to avoid z-fighting); details protrude into the street.
 */
async function facadeRun(scene: Scene, axis: "x" | "z", wall: number, from: number, to: number, height: 9 | 11 | 14,
  yaw: number, inset: number): Promise<void> {
  const length = to - from;
  const widths: [string, number][] = [];
  let used = 0, flip = 0;
  // Greedy fill with alternating 6 m / 4 m modules
  while (true) {
    const pick = MODULES[height][flip % 2];
    if (used + pick[1] > length) {
      const other = MODULES[height][(flip + 1) % 2];
      if (used + other[1] <= length) { widths.push(other); used += other[1]; }
      break;
    }
    widths.push(pick); used += pick[1]; flip++;
  }
  const gap = (length - used) / (widths.length + 1);
  let cursor = from + gap;
  const jobs: Promise<unknown>[] = [];
  for (const [name, w] of widths) {
    const mid = cursor + w / 2;
    const pos = axis === "x" ? new Vector3(wall + inset, 0, mid) : new Vector3(mid, 0, wall + inset);
    jobs.push(place(scene, "facades.glb", pos, yaw, name).then((p) => {
      for (const m of p.meshes) {
        if (m.name.endsWith("_Sign")) m.material = signMaterial(scene);
      }
      // Performance: merge each module's ~100 parts into one mesh (one sub-mesh per material), which cuts draw
      // calls and shadow-caster work dramatically. World transforms are baked in.
      // Only parts with the same vertex layout can merge, so group by attribute set (signs have UVs, most parts don't).
      const groups = new Map<string, Mesh[]>();
      for (const m of p.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0 || m.skeleton) continue;
        const key = m.getVerticesDataKinds().slice().sort().join("|");
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
      }
      for (const parts of groups.values()) {
        if (parts.length < 2) continue;
        const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
        if (merged) {
          merged.name = `${name}-merged`;
          merged.isPickable = true; // bullets spark on the facades
          merged.checkCollisions = false;
        }
      }
    }));
    cursor += w + gap;
  }
  await Promise.all(jobs);
}

export async function dressLevel(scene: Scene, level: Level): Promise<void> {
  signIdx = 0;
  // Building fronts tiled along the wall runs listed in the level data
  const jobs: Promise<unknown>[] = level.data.facadeRuns.map((f) =>
    facadeRun(scene, f.axis, f.wall, f.from, f.to, f.height, f.yaw, f.inset));
  // (Debris, wrecks, rubble and street props are placed from the level data by Level.decorate().)
  jobs.push(dressWarDamage(scene, level)); // key-art banners, screens, decals, puddles
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) console.warn(`[dressLevel] ${failed.length} placements failed`, failed);
}

/** Burning car: flickering fire light + pulsing flame materials (placed by the level data's "burningCar" effect). */
export function burningCarFire(scene: Scene, at: Vector3, root: TransformNode): void {
  const fire = new PointLight("fire", at, scene);
  fire.diffuse = Color3.FromHexString("#ff8a2a");
  fire.range = 11;
  let t = 0;
  const flames = scene.materials.filter((m) => m.name === "FireGlow" || m.name === "FireCore") as unknown as { emissiveIntensity: number }[];
  scene.onBeforeRenderObservable.add(() => {
    if (root.isDisposed()) return;
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = 0.75 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.13;
    fire.intensity = 1.6 * k;
    for (const f of flames) f.emissiveIntensity = k * 1.2;
  });
}

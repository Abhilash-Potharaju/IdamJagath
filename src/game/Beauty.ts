import {
  Color3, HDRCubeTexture, PBRMaterial, Texture, TransformNode, Vector3, type Mesh, type Scene,
} from "@babylonjs/core";
import type { Level } from "./Level";
import { makeSolid, place } from "./Props";
import { tileUVs } from "./Environment";

/**
 * "Beauty pass" v1 for the bazaar lane: photo-scanned PBR materials (Poly Haven, CC0), image-based lighting
 * from a real night-street HDRI, and real Indian street props (Sketchfab CC BY + Poly Haven CC0, optimized by
 * tools/blender/optimize_props.py). On by default; `?classic` shows the previous look for comparison.
 */
export const BEAUTY = !new URLSearchParams(location.search).has("classic");

const BASE = import.meta.env.BASE_URL;

/** A tiling PBR material from a Poly Haven texture set in public/textures/<id>/ (diff, nor_gl, arm at 1K). */
function pbr(scene: Scene, id: string, tint?: string): PBRMaterial {
  const m = new PBRMaterial(`pbr-${id}-${tint ?? ""}`, scene);
  const t = (map: string) => {
    const tex = new Texture(`${BASE}textures/${id}/${id}_${map}_1k.jpg`, scene);
    tex.anisotropicFilteringLevel = 8;
    return tex;
  };
  m.albedoTexture = t("diff");
  m.bumpTexture = t("nor_gl");
  m.metallicTexture = t("arm"); // R = ambient occlusion, G = roughness, B = metal
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = 1;
  if (tint) m.albedoColor = Color3.FromHexString(tint);
  // Match the falloff the rest of the scene's lights were tuned for (StandardMaterial-style, not inverse-square)
  m.usePhysicalLightFalloff = false;
  m.maxSimultaneousLights = 8;
  return m;
}

/** Swap the gray-box level surfaces for photo-scanned materials. Call right after level.build(). */
export function applyBeautyMaterials(scene: Scene, level: Level): void {
  if (!BEAUTY) return;
  // Image-based lighting: reflections and soft ambient from a real night street
  const env = new HDRCubeTexture(`${BASE}hdri/cobblestone_street_night_2k.hdr`, scene, 256, false, true, false, true);
  scene.environmentTexture = env;
  scene.environmentIntensity = 0.55;

  const cobbles = pbr(scene, "patterned_cobblestone");
  cobbles.roughness = 0.52; // damp night sheen: catches lamp light, env map and screen-space reflections
  const ground = pbr(scene, "stone_floor", "#c9b8a4");
  ground.roughness = 0.5; // wet plaza stone: lamp/fire/alien light streaks across it like the key art
  const yardBrick = pbr(scene, "painted_worn_brick", "#d8c7a8");
  const courtBrick = pbr(scene, "broken_brick_wall");
  const plasters = [
    pbr(scene, "red_plaster_weathered"),
    pbr(scene, "blue_plaster_weathered"),
    pbr(scene, "painted_plaster_wall", "#e8d9a8"),
    pbr(scene, "damaged_plaster"),
    pbr(scene, "rough_plaster_brick"),
    pbr(scene, "painted_plaster_wall", "#a9d0c4"),
  ];
  let i = 0;
  for (const m of level.world as Mesh[]) {
    const n = m.name;
    if (n === "street" || n === "alley") { m.material = cobbles; tileUVs(m, 2.5, 2.5); }
    else if (n === "ground") { m.material = ground; tileUVs(m, 3, 3); }
    else if (/^(L\d|R\d|arcade-|plaza-)/.test(n)) { m.material = plasters[i++ % plasters.length]; tileUVs(m, 3, 3); }
    else if (/^yard-/.test(n)) { m.material = yardBrick; tileUVs(m, 2.5, 2.5); }
    else if (/^court-[nsw]/.test(n)) { m.material = courtBrick; tileUVs(m, 2.5, 2.5); }
  }
}

/** Dispose a previously placed model holder at (x,z) (used to swap our scripted props for real ones). */
function removeHolder(scene: Scene, file: string, x: number, z: number): void {
  for (const t of scene.transformNodes as TransformNode[]) {
    if (t.name === `${file}-holder` && Math.abs(t.position.x - x) < 0.2 && Math.abs(t.position.z - z) < 0.2) t.dispose();
  }
}

/** Place the real street props along the lane. Call after Level.decorate() and dressLevel() finished. */
export async function placeBeautyProps(scene: Scene, _level: Level): Promise<void> {
  if (!BEAUTY) return;
  const P = (file: string, x: number, z: number, yaw = 0, y = 0) => place(scene, `props/${file}.glb`, new Vector3(x, y, z), yaw);
  /** Place a prop that the player and enemies can't walk through. */
  const S = (file: string, x: number, z: number, yaw = 0, y = 0) => P(file, x, z, yaw, y).then((p) => { makeSolid(p); return p; });
  const E = Math.PI / 2, W = -Math.PI / 2;
  const jobs: Promise<unknown>[] = [];

  // Street-food carts replace three of the scripted stalls (same collider spots)
  removeHolder(scene, "bazaar_stall.glb", -3.2, 8);
  removeHolder(scene, "bazaar_stall.glb", 3.2, 13);
  removeHolder(scene, "bazaar_stall.glb", -3.2, 38);
  jobs.push(S("bhelpuri_cart", -3.15, 8, E));
  jobs.push(S("thela_stall", 3.0, 13, W));
  jobs.push(S("thela_stall", -3.0, 38, E));

  // Real auto-rickshaws replace the scripted ones (plaza cover + start yard)
  for (const [x, z] of [[-14, 68], [15, 90], [6.5, -11]]) removeHolder(scene, "rickshaw.glb", x, z);
  jobs.push(S("autorickshaw", -14, 68, E));
  jobs.push(S("autorickshaw", 15, 90, -Math.PI / 2.4));
  jobs.push(S("autorickshaw", 6.5, -11, 0.4));

  // Parked cycle-rickshaw and a paan kiosk at the shelter yard
  jobs.push(S("cycle_rickshaw", 2.85, 40, 0.08));
  jobs.push(S("paan_kiosk", -8.6, -8.5, Math.PI));

  // AC units on the facades (mounted ~5 m up, facing the lane)
  for (const [x, y, z, yaw] of [[-3.25, 5.2, 5.5, E], [-3.25, 4.7, 19, E], [-3.25, 6.8, 44, E], [3.25, 5.0, 8.5, W], [3.25, 6.1, 33, W], [3.25, 4.8, 54, W]]) {
    jobs.push(P("aircon", x, z, yaw, y));
  }

  // Street clutter: crates with brass ware, boxes, barrels, bins, tyres, plants, utility box, manholes
  jobs.push(S("plastic_crate", -3.45, 11.3, 0.3), P("brass_pot_01", -3.45, 11.3, 0, 0.26), P("brass_vase_01", -3.2, 11.0, 0, 0));
  jobs.push(S("plastic_crate", 3.5, 15.6, 1.2), P("brass_pot_02", 3.5, 15.6, 0, 0.26));
  jobs.push(S("cardboard_box", 3.45, 27.6, 0.4), P("cardboard_box", 3.5, 28.2, 1.1, 0.34));
  jobs.push(S("barrel", -3.45, 47.2));
  jobs.push(S("trash_can", 3.5, 4.5, W), S("trash_can", -3.5, 33.6, E));
  jobs.push(S("old_tyre", 3.4, 48.6, 0.5));
  jobs.push(S("potted_plant", -3.5, 2.6), S("potted_plant", 3.5, 23.2));
  jobs.push(S("utility_box", -3.6, 29.6, E));
  jobs.push(P("manhole", 0.4, 15.5, 0, 0.012), P("manhole", -0.8, 42, 0, 0.012));

  const r = await Promise.allSettled(jobs);
  const failed = r.filter((x) => x.status === "rejected");
  if (failed.length) console.warn(`[beauty] ${failed.length} prop placements failed`, failed);
}

/**
 * The Charminar's surface: tiling photo-scanned lime plaster over stone (Poly Haven `plaster_stone_wall_01`, CC0)
 * on the model's second UV set (world-scale box projection, 1 tile = 2.5 m), multiplied by the baked weathering map
 * (contact shadows + grime/rain streaks) on the first UV set. Tinted toward the monument's ivory stucco.
 */
export function charminarMaterial(scene: Scene): PBRMaterial {
  // Smooth lime plaster (Poly Haven `painted_plaster_wall`, CC0) tinted to the monument's warm cream stucco.
  // The earlier stone-embedded texture read as dark holes/blotches under the red lighting.
  const m = pbr(scene, "painted_plaster_wall");
  m.albedoColor = new Color3(0.98, 0.9, 0.76);
  for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture]) {
    if (!t) continue;
    const tx = t as Texture;
    tx.coordinatesIndex = 1;
    tx.uScale = tx.vScale = 0.8;
  }
  if (m.bumpTexture) m.bumpTexture.level = 0.45;
  m.backFaceCulling = false; // the source model has some one-sided faces; never let them read as see-through holes
  m.twoSidedLighting = true;
  // Baked weathering (contact shadows + soft grime) gives depth to arches, balconies and recesses
  const weather = new Texture(`${BASE}textures/charminar/charminar_weathering_2k.jpg`, scene, false, false);
  weather.coordinatesIndex = 0;
  m.ambientTexture = weather;
  m.ambientTextureStrength = 0.7;
  m.useAmbientInGrayScale = true;
  m.ambientTextureImpactOnAnalyticalLights = 0.5;
  return m;
}

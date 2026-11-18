import { Color3, HDRCubeTexture, PBRMaterial, Texture, type Mesh, type Scene } from "@babylonjs/core";
import type { Level } from "./Level";
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

/** Swap the gray-box level surfaces for photo-scanned materials (rules in the level data). Call after level.build(). */
export function applyBeautyMaterials(scene: Scene, level: Level): void {
  if (!BEAUTY) return;
  const bs = level.data.beautySurfaces;
  // Image-based lighting: reflections and soft ambient from a real night street
  const env = new HDRCubeTexture(`${BASE}${bs.environment.hdri}`, scene, 256, false, true, false, true);
  scene.environmentTexture = env;
  scene.environmentIntensity = bs.environment.intensity;

  const make = (m: { material: string; tint?: string }, roughness?: number) => {
    const mat = pbr(scene, m.material, m.tint);
    if (roughness !== undefined) mat.roughness = roughness;
    return mat;
  };
  const rules = bs.rules.map((r) => ({
    re: new RegExp(r.match), tile: r.tile, i: 0,
    mats: r.cycle ? r.cycle.map((c) => make(c, r.roughness)) : [make({ material: r.material!, tint: r.tint }, r.roughness)],
  }));
  for (const m of level.world as Mesh[]) {
    const rule = rules.find((r) => r.re.test(m.name));
    if (!rule) continue;
    m.material = rule.mats[rule.i++ % rule.mats.length];
    tileUVs(m, rule.tile, rule.tile);
  }
  void level.applyLightmap(); // baked GI on the shell (after its final materials are set)
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
  m.albedoColor = new Color3(0.9, 0.82, 0.68); // real Charminar: warm beige lime stucco over granite
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
  // As a shadow-map lightmap it multiplies ALL lighting (moon, red beams, fires, sky), so grime, rain streaks down
  // the minarets and dark crevices stay visible. (As an AO/ambient texture it was washed out by the direct light.)
  m.lightmapTexture = weather;
  m.useLightmapAsShadowmap = true;
  return m;
}


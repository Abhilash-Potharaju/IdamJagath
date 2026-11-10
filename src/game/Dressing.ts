import { Color3, DynamicTexture, Mesh, PointLight, StandardMaterial, Vector3, type Scene } from "@babylonjs/core";
import type { Level } from "./Level";
import { makeSolid, place } from "./Props";
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

// Shop-sign texts (generic, no real brands). Laad Bazaar is famous for bangles; Irani chai is a Hyderabad staple.
const SIGNS: { text: string; font: string; bg: string; fg: string }[] = [
  { text: "లాడ్ బజార్", font: "bold 64px sans-serif", bg: "#b8202a", fg: "#ffe9a8" },      // Telugu: Laad Bazaar
  { text: "ఇరానీ చాయ్", font: "bold 64px sans-serif", bg: "#1d5e8c", fg: "#ffffff" },      // Telugu: Irani chai
  { text: "గాజుల దుకాణం", font: "bold 58px sans-serif", bg: "#7b2d8e", fg: "#ffd36b" },    // Telugu: bangle shop
  { text: "लाड बाज़ार", font: "bold 64px sans-serif", bg: "#d4851c", fg: "#2a1200" },       // Hindi: Laad Bazaar
  { text: "पान भंडार", font: "bold 64px sans-serif", bg: "#226b3a", fg: "#fff4c2" },        // Hindi: paan shop
  { text: "बिरयानी हाउस", font: "bold 60px sans-serif", bg: "#8c1c1c", fg: "#ffe0a0" },     // Hindi: biryani house
  { text: "لاڈ بازار", font: "bold 64px sans-serif", bg: "#0f6b62", fg: "#ffffff" },        // Urdu: Laad Bazaar
  { text: "ایرانی چائے", font: "bold 60px sans-serif", bg: "#5a3a1a", fg: "#ffd27a" },      // Urdu: Irani chai
  { text: "NAWAB BANGLES", font: "bold 60px sans-serif", bg: "#e8e0c8", fg: "#9a1b2e" },
  { text: "CHAI • BUN MASKA", font: "bold 52px sans-serif", bg: "#f2c12e", fg: "#3a1a00" },
];
let signIdx = 0;

function signMaterial(scene: Scene): StandardMaterial {
  const s = SIGNS[signIdx++ % SIGNS.length];
  const tex = new DynamicTexture("signTex", { width: 512, height: 96 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = s.fg;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.font = s.font;
  ctx.fillStyle = s.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The sign panel's V axis is flipped in the facade model (verified with a Latin test string), so draw upside down
  ctx.save();
  ctx.translate(0, 96);
  ctx.scale(1, -1);
  ctx.fillText(s.text, 256, 48, 480);
  ctx.restore();
  tex.update(true);
  const m = new StandardMaterial("signMat", scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex; // lit sign boards read at night and add colour
  m.emissiveColor = new Color3(0.55, 0.55, 0.55);
  m.specularColor = Color3.Black();
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
  const E = Math.PI / 2, W = -Math.PI / 2, N = 0, S = Math.PI;
  const jobs: Promise<unknown>[] = [
    // Bazaar lane, west side (wall face x = -4, fronts face east)
    facadeRun(scene, "x", -4, 0.5, 25.5, 9, E, 0.02),
    facadeRun(scene, "x", -4, 32.5, 59.5, 11, E, 0.02),
    // Bazaar lane, east side (wall face x = 4, fronts face west); skip the secret-room wall (z 15–21)
    facadeRun(scene, "x", 4, 0.5, 14.5, 11, W, -0.02),
    facadeRun(scene, "x", 4, 21.5, 39.5, 9, W, -0.02),
    facadeRun(scene, "x", 4, 40.5, 59.5, 14, W, -0.02),
    // Plaza: south wall (fronts face north), north wall (face south), west and east walls
    facadeRun(scene, "z", 60, -25.5, -4.5, 11, N, 0.02),
    facadeRun(scene, "z", 60, 4.5, 25.5, 11, N, 0.02),
    facadeRun(scene, "z", 112, -25.5, 25.5, 11, S, -0.02),
    facadeRun(scene, "x", -26, 85, 111.5, 11, E, 0.02),
    facadeRun(scene, "x", 26, 60.5, 79.5, 11, W, -0.02),
    facadeRun(scene, "x", 26, 98.5, 111.5, 11, W, -0.02),
  ];

  // ── Debris: tells the story of the invasion ──
  const solid = (x1: number, x2: number, z1: number, z2: number, h: number) => {
    level.box("debris-collider", x1, x2, z1, z2, 0, h, "#000000").isVisible = false;
  };
  // Burning car at the plaza entrance (warm light against the alien purple)
  jobs.push(place(scene, "debris.glb", new Vector3(-9, 0, 63.5), 0.35, "Burning_Car").then((p) => {
    solid(-10.9, -7.1, 62.6, 64.4, 1.4);
    const fire = new PointLight("fire", new Vector3(-9, 1.8, 63.5), scene);
    fire.diffuse = Color3.FromHexString("#ff8a2a");
    fire.range = 11;
    let t = 0;
    const flames = scene.materials.filter((m) => m.name === "FireGlow" || m.name === "FireCore") as unknown as { emissiveIntensity: number }[];
    scene.onBeforeRenderObservable.add(() => {
      if (p.root.isDisposed()) return;
      t += scene.getEngine().getDeltaTime() / 1000;
      const k = 0.75 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.13;
      fire.intensity = 1.6 * k;
      for (const f of flames) f.emissiveIntensity = k * 1.2;
    });
  }));
  // Alien drop-pod rammed into the plaza near the cage
  jobs.push(place(scene, "debris.glb", new Vector3(16, 0, 103), -0.6, "Crashed_Pod").then(() => {
    const c = level.box("pod-collider", 14, 18, 101, 105, 0, 3, "#000000");
    c.isVisible = false;
  }));
  // Human defences at the shelter yard (start / extraction)
  jobs.push(place(scene, "debris.glb", new Vector3(-7.5, 0, -2.2), 0, "Sandbag_Wall").then(() => solid(-9.1, -5.9, -2.45, -1.95, 1)));
  jobs.push(place(scene, "debris.glb", new Vector3(7.5, 0, -2.2), 0, "Sandbag_Wall").then(() => solid(5.9, 9.1, -2.45, -1.95, 1)));
  jobs.push(place(scene, "debris.glb", new Vector3(2.6, 0, 1.6), -0.5, "Barricade"));
  // Rubble from shelled buildings (low, walk-over decor)
  // (The old scripted "Rubble_Pile" was loose blocks that read as floating stones; use the photoscanned rubble instead.)
  for (const [file, x, z, yaw] of [["concrete_chunks", -3.1, 18.5, 0.3], ["concrete_chunks", 3.25, 44.3, 2.1],
    ["rubble_pile", -20, 106, 1], ["rubble_pile", 21, 66, 4], ["concrete_debris", -29, 38, 0.8]] as [string, number, number, number][]) {
    jobs.push(place(scene, `props/${file}.glb`, new Vector3(x, 0, z), yaw).then((p) => makeSolid(p)));
  }

  jobs.push(dressWarDamage(scene, level)); // key-art war damage: wrecks, rubble, banners, screens, decals, puddles
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) console.warn(`[dressLevel] ${failed.length} placements failed`, failed);
}

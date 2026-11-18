import { Color3, type Material, PBRMaterial, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, Texture, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { markWorld } from "./types";
import { makeSolid, place } from "./Props";
import { BEAUTY, charminarMaterial } from "./Beauty";
import { Surfaces } from "./Environment";
import { burningCarFire } from "./Dressing";
import { smoulder } from "./WarDressing";
import { LEVEL1, levelGeometryHash, loadLevelGeometry, type BlockGeometry, type LevelData, type LevelGeometry, type PropData } from "../data/level";

/**
 * The level SHELL comes from the portable asset public/models/level/level1.glb (built from level1.json by
 * tools/blender/build_level.py). It is fetched with a module-level await, so the GLB is in memory before Game
 * constructs the Level and build() can stay synchronous (no Game.ts changes). If the file is missing, unreadable or
 * stale (its source_hash doesn't match the JSON), build() falls back to generating the same blocks in code.
 * ?codelevel forces that fallback for A/B comparisons.
 */
const FORCE_CODE_LEVEL = new URLSearchParams(location.search).has("codelevel");
/** Read at load time (the UI may later rewrite the URL). */
const NO_LIGHTMAP = new URLSearchParams(location.search).has("nolightmap");
const LEVEL_SHELL: LevelGeometry | null = FORCE_CODE_LEVEL ? null : await loadLevelGeometry(`${import.meta.env.BASE_URL}models/level/level1.glb`);

/** +1/-1: winding convention of Babylon's own box (first triangle's geometric normal vs its vertex normal). */
function windingSign(pos: ArrayLike<number>, nrm: ArrayLike<number>, idx: ArrayLike<number>, t = 0): number {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.sign(cx * nrm[a] + cy * nrm[a + 1] + cz * nrm[a + 2]) || 1;
}
const BABYLON_WINDING = (() => { const v = VertexData.CreateBox({ size: 1 }); return windingSign(v.positions!, v.normals!, v.indices!); })();

/**
 * Level 1: "Charminar under occupation". All layout lives in data/level/level1.json (engine-neutral); this class
 * is the Babylon adapter that builds the gray-box blocks and places the props described there.
 * Coordinates are metres; +Z is north. Layout:
 *
 *   z 112 ┌──────────── PLAZA (x -26..26) ─────────────┐
 *         │   P3        [cage z100-106]                 │
 *         │           ╔═ CHARMINAR (0,86) ═╗            │
 *         │           ╚════════════════════╝      P2    │
 *   z 60  └──────────┐  LANE  ┌──────────────────────────┘
 *   COURTYARD ─ alley│ x -4..4│ [secret room east, z15-21]
 *   (P1, x-36..-24)  │        │
 *   z 0              └─START──┘  extraction pad (z -14..-6)
 */
const v3 = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);
const rect = (r: { min: [number, number]; max: [number, number] }) => ({ x1: r.min[0], x2: r.max[0], z1: r.min[1], z2: r.max[1] });

export class Level {
  readonly scene: Scene;
  readonly data: LevelData;
  readonly world: Mesh[] = [];
  private mats = new Map<string, StandardMaterial>();
  /** Textured, coloured materials chosen per block name (see Environment.ts). */
  private surfaces: Surfaces;

  // Gameplay anchor points used by Game.ts (sourced from the level data)
  readonly playerSpawn: Vector3;
  readonly extraction: { x1: number; x2: number; z1: number; z2: number };
  readonly plazaEntryZ: number;
  readonly cageTrigger: { x1: number; x2: number; z1: number; z2: number };
  readonly pylonSpots: Vector3[];
  readonly healthSpots: Vector3[];
  readonly secretPickup: Vector3;
  readonly climbEntry?: Vector3;
  cageDoor!: Mesh;
  secretWall!: Mesh;

  /** Blocks by id and by tag, so props can hide the gray-box stand-ins they replace. */
  private byId = new Map<string, Mesh>();
  private byTag = new Map<string, Mesh[]>();

  constructor(scene: Scene, data: LevelData = LEVEL1) {
    this.scene = scene;
    this.data = data;
    this.surfaces = new Surfaces(scene);
    const a = data.anchors;
    this.playerSpawn = v3(a.playerSpawn);
    this.extraction = rect(a.extraction);
    this.plazaEntryZ = a.plazaEntryZ;
    this.cageTrigger = rect(a.cageTrigger);
    this.pylonSpots = a.pylons.map(v3);
    this.healthSpots = a.healthPacks.map(v3);
    this.secretPickup = v3(a.secretPickup);
    this.climbEntry = a.climbEntry ? v3(a.climbEntry) : undefined;
  }

  /** Where the shell geometry came from: the portable GLB, or generated in code from the JSON (fallback). */
  shellSource: "glb" | "code" = "code";

  /** Build the gray-box blocks (collision, line of sight, and the classic look). */
  build(): void {
    const shell = this.usableShell();
    this.shellSource = shell ? "glb" : "code";
    this.data.blocks.forEach((b, i) => {
      let m: Mesh;
      const g = shell?.blocks.get(i);
      if (g) {
        m = this.meshFromGeometry(b.name, g);
        this.finish(m, b.color);
      } else if (b.shape === "box") {
        m = this.box(b.name, b.min[0], b.max[0], b.min[2], b.max[2], b.min[1], b.max[1], b.color);
      } else if (b.shape === "slab") {
        m = MeshBuilder.CreateGround(b.name, { width: b.max[0] - b.min[0], height: b.max[2] - b.min[2] }, this.scene);
        m.position.set((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
        this.finish(m, b.color);
      } else if (b.shape === "ground") {
        m = MeshBuilder.CreateGround(b.name, { width: b.size[0], height: b.size[1] }, this.scene);
        m.position.set(b.center[0], b.center[1], b.center[2]);
        this.finish(m, b.color);
      } else {
        m = MeshBuilder.CreateCylinder(b.name, { diameter: b.diameter, height: b.height, tessellation: b.segments }, this.scene);
        m.position.set(b.center[0], b.center[1], b.center[2]);
        this.finish(m, b.color);
      }
      if (b.id) this.byId.set(b.id, m);
      for (const t of b.tags ?? []) (this.byTag.get(t) ?? this.byTag.set(t, []).get(t)!).push(m);
    });
    this.secretWall = this.byId.get("secret-wall")!;
    this.cageDoor = this.byId.get("cage-door")!;
  }

  /**
   * Baked global-illumination lightmap for the GLB shell (tools/blender/bake_level.py): bounce light, contact
   * occlusion in corners and warm lamp/fire pools, applied as a MULTIPLY over all real-time lighting on UV1
   * (1.0 = unchanged, <1 darker, up to `level` brighter). Only for the GLB shell whose source_hash matches the bake.
   * `?nolightmap` disables it for A/B comparison. Call after the shell's final materials are assigned.
   */
  async applyLightmap(): Promise<void> {
    if (this.shellSource !== "glb" || !LEVEL_SHELL || NO_LIGHTMAP) return;
    const base = `${import.meta.env.BASE_URL}textures/lightmaps/`;
    let meta: { image: string; level: number; uv: number; source_hash: string };
    try {
      meta = await (await fetch(`${base}level1_lightmap.json`)).json();
    } catch {
      return; // no bake: lighting stays fully real-time
    }
    if (meta.source_hash !== LEVEL_SHELL.sourceHash) {
      console.warn("[level] lightmap was baked for a different shell; skipping. Re-run tools/blender/bake_level.py");
      return;
    }
    // invertY=false: the shell's UVs are glTF UVs (v = 0 at the top of the image), and the baker writes rows top-down
    const tex = new Texture(base + meta.image, this.scene, false, false);
    tex.coordinatesIndex = meta.uv;
    tex.level = meta.level;
    tex.gammaSpace = true; // values are stored gamma-encoded (better precision in the darks)
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const clones = new Map<Material, Material>();
    for (const m of this.world) {
      if (m.metadata?.levelBlock === undefined || !m.material || !m.isVerticesDataPresent(VertexBuffer.UV2Kind)) continue;
      let c = clones.get(m.material);
      if (!c) {
        // Clone per original material so meshes outside the shell (no UV1) never get a lightmap
        c = m.material.clone(`${m.material.name}-lm`) as Material;
        const lm = c as PBRMaterial | StandardMaterial;
        lm.lightmapTexture = tex;
        lm.useLightmapAsShadowmap = true;
        clones.set(m.material, c);
      }
      m.material = c;
    }
    this.lightmapped = clones.size > 0;
  }
  lightmapped = false;

  /** The loaded shell GLB, if it exists and was built from this exact block layout. */
  private usableShell(): LevelGeometry | null {
    if (!LEVEL_SHELL || this.data !== LEVEL1) return null;
    const want = levelGeometryHash(this.data);
    if (LEVEL_SHELL.sourceHash !== want || LEVEL_SHELL.blocks.size !== this.data.blocks.length) {
      console.warn(`[level] level1.glb is stale (hash ${LEVEL_SHELL.sourceHash} vs JSON ${want}); building blocks from JSON. ` +
        "Rebuild: blender --background --factory-startup --python tools/blender/build_level.py");
      return null;
    }
    return LEVEL_SHELL;
  }

  /**
   * Babylon mesh from engine-neutral block geometry. The file's coordinates are game coordinates; only the
   * triangle winding differs between glTF (right-handed) and Babylon (left-handed), so indices are flipped to match.
   */
  private meshFromGeometry(name: string, g: BlockGeometry): Mesh {
    const idx = g.indices.slice();
    if (windingSign(g.positions, g.normals, idx) !== BABYLON_WINDING) {
      for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
    }
    const vd = new VertexData();
    vd.positions = g.positions; vd.normals = g.normals; vd.indices = idx;
    if (g.uv0) vd.uvs = g.uv0;
    if (g.uv1) vd.uvs2 = g.uv1;
    const m = new Mesh(name, this.scene);
    vd.applyToMesh(m);
    m.position.set(g.translation[0], g.translation[1], g.translation[2]);
    m.metadata = { ...(m.metadata ?? {}), levelBlock: g.blockIndex };
    return m;
  }

  /**
   * Place every prop listed in the level data. Gray boxes a model replaces turn invisible but keep their
   * collisions (players/enemies) and world tag (line of sight).
   */
  /**
   * Spiral staircase inside the Charminar's south-west leg (tools/blender/build_charminar_stairs.py): visible stone
   * steps + door frame + hatch rail, and invisible COL_* collision proxies (a smooth helical ramp, the shaft ring, the
   * roof-hatch railing). Two warm torches light the shaft.
   */
  private async placeCharminarStairs(): Promise<void> {
    const p = await place(this.scene, "charminar_stairs.glb", new Vector3(0, 0, 86));
    for (const m of p.meshes) {
      if (m.name.startsWith("COL_")) {
        m.isVisible = false;
        m.isPickable = false;
        m.checkCollisions = true;
        markWorld(m);
      } else {
        m.checkCollisions = false; // visual steps: the smooth ramp proxy is the walk surface
      }
    }
    const shaft = new Vector3(6.97, 0, 79.03); // south-east leg (glTF import mirrors Blender X)
    for (const h of [4.5, 13]) {
      const torch = new PointLight("stair-torch", shaft.add(new Vector3(0, h, 0)), this.scene);
      torch.diffuse = Color3.FromHexString("#ffb060");
      torch.intensity = 1.1;
      torch.range = 7;
    }
  }

  async decorate(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const jobs: Promise<unknown>[] = [];
    for (const p of this.data.props) {
      if (p.mode === "beauty" && !BEAUTY) continue;
      if (p.mode === "classic" && BEAUTY) continue;
      jobs.push(this.placeProp(p, params));
    }
    jobs.push(this.placeCharminarStairs());
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) console.warn(`[decorate] ${failed.length} model placements failed`, failed);
  }

  private async placeProp(p: PropData, params: URLSearchParams): Promise<void> {
    const s = this.scene;
    const alt = p.altModel && params.has(p.altModel.flag);
    const placed = await place(s, alt ? p.altModel!.model : p.model, v3(p.pos), p.yaw, p.node);
    if (p.roll) placed.root.rotation.z = p.roll;
    for (const h of p.hides ?? []) {
      const list = h.startsWith("#") ? this.byTag.get(h.slice(1)) ?? [] : [this.byId.get(h)!];
      for (const m of list) m.isVisible = false;
    }
    if (p.solid === "fitted") makeSolid(placed, p.fit);
    for (const c of p.colliders ?? []) {
      this.box(c.name, c.min[0], c.max[0], c.min[2], c.max[2], c.min[1], c.max[1], "#000000").isVisible = false;
    }
    if (!alt) this.applyMaterial(p.material, placed.meshes as Mesh[]);
    for (const e of p.effects ?? []) {
      if (e.type === "smoulder") smoulder(s, v3(e.pos));
      else if (e.type === "burningCar") burningCarFire(s, v3(e.pos), placed.root);
    }
  }

  /** Named material treatments referenced by the level data. */
  private applyMaterial(key: string | undefined, meshes: Mesh[]): void {
    if (key === "charminar") {
      if (!BEAUTY) return;
      const m = charminarMaterial(this.scene);
      for (const mesh of meshes) mesh.material = m;
    } else if (key === "burnt") {
      for (const m of meshes) {
        const src = m.material as PBRMaterial | null;
        if (!src) continue;
        const burnt = src.clone("auto-burnt") as PBRMaterial;
        // Keep the real yellow/green paint, darkened with soot (no orange emissive: it made the whole auto orange)
        burnt.albedoColor = new Color3(0.42, 0.4, 0.38);
        burnt.roughness = 0.95;
        burnt.metallic = 0;
        burnt.emissiveColor = new Color3(0, 0, 0);
        burnt.maxSimultaneousLights = 4;
        m.material = burnt;
      }
    }
  }

  /** Axis-aligned solid block from (x1,y1,z1) to (x2,y2,z2). */
  box(name: string, x1: number, x2: number, z1: number, z2: number, y1: number, y2: number, color: string): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: x2 - x1, height: y2 - y1, depth: z2 - z1 }, this.scene);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    this.finish(m, color);
    return m;
  }

  private finish(m: Mesh, color: string): void {
    this.surfaces.apply(m, color);
    m.checkCollisions = true;
    m.isPickable = true;
    markWorld(m);
    this.world.push(m);
  }

  mat(color: string, emissive?: string): StandardMaterial {
    const key = color + (emissive ?? "");
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new StandardMaterial("m" + key, this.scene);
      mat.diffuseColor = Color3.FromHexString(color);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      if (emissive) mat.emissiveColor = Color3.FromHexString(emissive);
      mat.maxSimultaneousLights = 8;
      this.mats.set(key, mat);
    }
    return mat;
  }
}

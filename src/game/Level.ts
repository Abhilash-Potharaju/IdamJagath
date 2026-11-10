import { Color3, PBRMaterial, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { markWorld } from "./types";
import { makeSolid, place } from "./Props";
import { BEAUTY, charminarMaterial } from "./Beauty";
import { Surfaces } from "./Environment";
import { burningCarFire } from "./Dressing";
import { smoulder } from "./WarDressing";
import { LEVEL1, type LevelData, type PropData } from "../data/level";

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
  }

  /** Build the gray-box blocks (collision, line of sight, and the classic look). */
  build(): void {
    for (const b of this.data.blocks) {
      let m: Mesh;
      if (b.shape === "box") {
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
    }
    this.secretWall = this.byId.get("secret-wall")!;
    this.cageDoor = this.byId.get("cage-door")!;
  }

  /**
   * Place every prop listed in the level data. Gray boxes a model replaces turn invisible but keep their
   * collisions (players/enemies) and world tag (line of sight).
   */
  async decorate(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const jobs: Promise<unknown>[] = [];
    for (const p of this.data.props) {
      if (p.mode === "beauty" && !BEAUTY) continue;
      if (p.mode === "classic" && BEAUTY) continue;
      jobs.push(this.placeProp(p, params));
    }
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

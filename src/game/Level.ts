import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { markWorld } from "./types";
import { makeSolid, place } from "./Props";
import { BEAUTY, charminarMaterial } from "./Beauty";
import { Surfaces } from "./Environment";

/**
 * Level 1 gray box: "Charminar under occupation".
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
export class Level {
  readonly scene: Scene;
  readonly world: Mesh[] = [];
  private mats = new Map<string, StandardMaterial>();
  /** Textured, coloured materials chosen per block name (see Environment.ts). */
  private surfaces: Surfaces;

  // Gameplay anchor points used by Game.ts
  readonly playerSpawn = new Vector3(0, 1.0, -8);
  readonly extraction = { x1: -6, x2: 6, z1: -14, z2: -5 };
  readonly plazaEntryZ = 64;
  readonly cageTrigger = { x1: -4, x2: 4, z1: 101, z2: 105 };
  readonly pylonSpots = [new Vector3(-30, 0, 29), new Vector3(18, 0, 72), new Vector3(-18, 0, 100)];
  readonly healthSpots = [new Vector3(-2, 0, 40), new Vector3(20, 0, 105), new Vector3(-33, 0, 37)];
  readonly secretPickup = new Vector3(7.3, 0, 18);
  cageDoor!: Mesh;
  secretWall!: Mesh;

  // Gray-box pieces that get a real model on top (and become invisible colliders)
  readonly stallSpots: [number, number][] = [[-3.2, 8], [3.2, 13], [-3.2, 22], [3.2, 30], [-3.2, 38], [3.2, 46], [-3.2, 53]];
  private stallBoxes: Mesh[] = [];
  private charminarBoxes: Mesh[] = [];
  private rickshawBoxes: Mesh[] = [];
  private cart!: Mesh;

  /**
   * Load the Blender-made models and dress the level. Gray boxes they replace turn invisible
   * but keep their collisions (players/enemies) and world tag (line of sight).
   */
  async decorate(): Promise<void> {
    const s = this.scene;
    const hide = (m: Mesh) => { m.isVisible = false; };
    const jobs: Promise<unknown>[] = [];

    // Charminar + pulsing alien growth
    // Charminar: the detailed Sketchfab model ("Charminar, Hyderabad" by Dolores, CC BY 4.0; see art/CREDITS.md),
    // converted by tools/blender/import_charminar_skfb.py, dressed with a tiling photo-scanned lime-plaster material
    // + baked weathering (Beauty.ts). The old scripted model's purple alien vines were removed (looked primitive).
    // ?oldcharminar shows the original scripted model (with its vines) for comparison.
    const useOld = new URLSearchParams(location.search).has("oldcharminar");
    if (useOld) {
      jobs.push(place(s, "charminar.glb", new Vector3(0, 0, 86)).then(() => this.charminarBoxes.forEach(hide)));
    } else {
      jobs.push(place(s, "charminar_skfb.glb", new Vector3(0, 0, 86)).then((p) => {
        this.charminarBoxes.forEach(hide);
        if (BEAUTY) { const m = charminarMaterial(s); for (const mesh of p.meshes) mesh.material = m; }
      }));
    }

    // Bazaar stalls, fronts facing the middle of the lane
    this.stallSpots.forEach(([x, z], i) => {
      jobs.push(place(s, "bazaar_stall.glb", new Vector3(x, 0, z), x < 0 ? Math.PI / 2 : -Math.PI / 2)
        .then(() => hide(this.stallBoxes[i])));
    });

    // Wrecked rickshaw in the lane; two parked rickshaws as plaza cover
    jobs.push(place(s, "rickshaw_wrecked.glb", new Vector3(0, 0, 33.75), Math.PI / 2).then(() => hide(this.cart)));
    jobs.push(place(s, "rickshaw.glb", new Vector3(-14, 0, 68), Math.PI / 2).then(() => hide(this.rickshawBoxes[0])));
    jobs.push(place(s, "rickshaw.glb", new Vector3(15, 0, 90), -Math.PI / 2.4).then(() => hide(this.rickshawBoxes[1])));
    jobs.push(place(s, "rickshaw.glb", new Vector3(6.5, 0, -11), 0.4)); // abandoned at the start yard (decor)

    // Street furniture (decor only, no colliders)
    for (const [x, z, yaw] of [[-3.7, 17, Math.PI / 2], [3.7, 26, -Math.PI / 2], [-3.7, 45, Math.PI / 2], [3.7, 57, -Math.PI / 2]]) {
      jobs.push(place(s, "street_props.glb", new Vector3(x, 0, z), yaw, "Lamp_Post").then((p) => makeSolid(p, 0.35)));
    }
    for (const z of [11, 40]) jobs.push(place(s, "street_props.glb", new Vector3(-3.8, 0, z), 0, "Wire_Pole"));
    // (Free-standing signboards replaced by the shop-sign bands on the facades; see Dressing.ts)
    for (const [x, z] of [[-3.3, 27], [3.3, 35.5], [-24, 66], [21, 104]]) {
      jobs.push(place(s, "street_props.glb", new Vector3(x, 0, z), Math.random() * 3, "Water_Drum").then((p) => makeSolid(p)));
    }

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) console.warn(`[decorate] ${failed.length} model placements failed`, failed);
  }

  constructor(scene: Scene) {
    this.scene = scene;
    this.surfaces = new Surfaces(scene);
  }

  build(): void {
    const C = {
      ground: "#3b3742", street: "#4a4550", bldA: "#6e6474", bldB: "#5f5866", bldC: "#7a6c66",
      perim: "#45404d", stall: "#8a6a40", lime: "#c9b8a0", limeDark: "#a8987f", cage: "#3a3a3a",
      crack: "#7c6f84",
    };

    // Ground
    const ground = MeshBuilder.CreateGround("ground", { width: 120, height: 150 }, this.scene);
    ground.position.set(-5, 0, 48);
    this.finish(ground, C.ground);
    this.slab("street", -4, 4, 0, 60, C.street);

    // Start yard (extraction)
    this.box("yard-back", -11, 11, -17, -16, 0, 6, C.perim);
    this.box("yard-w", -12, -11, -17, 0, 0, 6, C.perim);
    this.box("yard-e", 11, 12, -17, 0, 0, 6, C.perim);
    this.box("yard-sw", -11, -4, -1, 0, 0, 6, C.perim);
    this.box("yard-se", 4, 11, -1, 0, 0, 6, C.perim);

    // Lane buildings (Laad Bazaar)
    this.box("L1", -24, -4, 0, 26, 0, 10, C.bldA);
    this.box("L2", -24, -4, 32, 60, 0, 11, C.bldB);
    this.box("R1", 4, 14, 0, 15, 0, 12, C.bldC);
    this.box("R2", 4, 14, 21, 40, 0, 9, C.bldA);
    this.box("R3", 4, 14, 40, 60, 0, 14, C.bldB);
    // Shop awnings / stalls as cover along the lane
    for (const [x, z] of this.stallSpots) {
      this.stallBoxes.push(this.box("stall", x - 0.7, x + 0.7, z - 1.2, z + 1.2, 0, 1.3, C.stall));
    }
    this.cart = this.box("cart", -1.5, 1.5, 33, 34.5, 0, 1.1, C.stall);

    // Secret room (east of lane). Breakable wall faces the lane.
    this.box("secret-back", 10, 14, 15, 21, 0, 12, C.perim);
    this.box("secret-roof", 4, 14, 15, 21, 4, 4.5, C.perim);
    this.secretWall = this.box("secret-wall", 4, 4.5, 15, 21, 0, 4, C.crack);

    // West alley + pylon courtyard
    this.slab("alley", -24, -4, 26, 32, C.street);
    this.box("court-w", -37, -36, 17, 41, 0, 9, C.perim);
    this.box("court-s", -37, -24, 17, 18, 0, 9, C.perim);
    this.box("court-n", -37, -24, 40, 41, 0, 9, C.perim);
    this.box("court-crate1", -34, -32, 20, 22, 0, 1.6, C.stall);
    this.box("court-crate2", -27, -25.5, 34, 36, 0, 2.2, C.stall);

    // Plaza perimeter
    this.box("plaza-sw", -27, -4, 59, 60, 0, 12, C.perim);
    this.box("plaza-se", 4, 27, 59, 60, 0, 12, C.perim);
    this.box("plaza-w", -27, -26, 59, 113, 0, 12, C.perim);
    this.box("plaza-e", 26, 27, 59, 113, 0, 12, C.perim);
    this.box("plaza-n", -27, 27, 112, 113, 0, 12, C.perim);
    // Arcades along plaza edges
    this.box("arcade-e", 22, 26, 80, 98, 0, 7, C.bldA);
    this.box("arcade-w", -26, -22, 66, 84, 0, 7, C.bldC);
    // Plaza cover
    for (const [x, z, w, d, h] of [
      [-14, 68, 3, 1.5, 1.4], [12, 64, 1.5, 3, 1.4], [-16, 92, 2, 2, 1.8], [15, 90, 3, 1.2, 1.2],
      [-8, 106, 2.5, 1.2, 1.3], [10, 104, 1.2, 2.5, 1.5], [0, 70, 4, 1, 1.0],
    ]) {
      const b = this.box("cover", x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h, C.stall);
      // The two long low covers become auto-rickshaws once models load
      if ((x === -14 && z === 68) || (x === 15 && z === 90)) this.rickshawBoxes.push(b);
    }

    // Charminar (gray box): 4 pillars, 4 arches, roof, upper storey, 4 minarets.
    // These stay as invisible colliders once the real model loads.
    for (const [x1, x2, z1, z2] of [[-8, -3, 78, 83], [3, 8, 78, 83], [-8, -3, 89, 94], [3, 8, 89, 94]]) {
      this.charminarBoxes.push(this.box("ch-pillar", x1, x2, z1, z2, 0, 12, C.lime));
    }
    this.charminarBoxes.push(this.box("ch-roof", -8, 8, 78, 94, 12, 14, C.limeDark));
    this.charminarBoxes.push(this.box("ch-upper", -6, 6, 80, 92, 14, 18, C.lime));
    for (const [x, z] of [[-7.5, 78.5], [7.5, 78.5], [-7.5, 93.5], [7.5, 93.5]]) {
      const m = MeshBuilder.CreateCylinder("ch-minaret", { diameter: 2.6, height: 34, tessellation: 12 }, this.scene);
      m.position.set(x, 17, z);
      this.finish(m, C.lime);
      this.charminarBoxes.push(m);
    }

    // Captive cage north of the Charminar; door on the south side
    const bars: [number, number, number, number][] = [
      [-5, 5, 106, 106.3], [-5, -4.7, 100, 106.3], [4.7, 5, 100, 106.3],
      [-5, -1.6, 100, 100.3], [1.6, 5, 100, 100.3],
    ];
    for (const [x1, x2, z1, z2] of bars) this.box("cage", x1, x2, z1, z2, 0, 3.2, C.cage);
    this.box("cage-top", -5, 5, 100, 106.3, 3.2, 3.5, C.cage);
    this.cageDoor = this.box("cage-door", -1.6, 1.6, 100, 100.3, 0, 3.2, "#6b2a8a");
  }

  /** Axis-aligned solid block from (x1,y1,z1) to (x2,y2,z2). */
  box(name: string, x1: number, x2: number, z1: number, z2: number, y1: number, y2: number, color: string): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: x2 - x1, height: y2 - y1, depth: z2 - z1 }, this.scene);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    this.finish(m, color);
    return m;
  }

  private slab(name: string, x1: number, x2: number, z1: number, z2: number, color: string): void {
    const m = MeshBuilder.CreateGround(name, { width: x2 - x1, height: z2 - z1 }, this.scene);
    m.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2);
    this.finish(m, color);
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

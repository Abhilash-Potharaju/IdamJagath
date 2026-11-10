# Blender asset pipeline (Idam Jagath)

These scripts build every 3D model procedurally with Python. They need no add-ons, no downloads and no Blender UI. Run them from the project root (`idam-jagath/`):

```bash
blender --background --factory-startup --python tools/blender/charminar.py
blender --background --factory-startup --python tools/blender/rickshaw.py       # also builds rickshaw_wrecked
blender --background --factory-startup --python tools/blender/bazaar_stall.py
blender --background --factory-startup --python tools/blender/street_props.py
blender --background --factory-startup --python tools/blender/facades.py
blender --background --factory-startup --python tools/blender/mothership.py
blender --background --factory-startup --python tools/blender/debris.py
```

Each run writes:
- `public/models/<name>.glb`: the game asset (glTF binary)
- `tools/blender/previews/<name>.png`: a 960×540 Eevee preview render
- `tools/blender/src/<name>.blend`: the Blender source, for hand-editing

Shared helpers live in `common.py` (primitives, lathe, tubes, materials, export, preview rendering, stats).

## Conventions
- **Units:** metres, real-world scale.
- **Origin:** the bottom centre of each asset (ground contact at z = 0). Transforms are baked into the mesh.
- **Style:** low poly; flat-coloured Principled materials (no image textures); smooth-by-angle shading (35°), so boxes stay crisp and columns/domes look round.
- **Export:** glTF binary with +Y up (the exporter converts from Blender's Z-up). Normals are included; UVs only where needed (`export_glb(..., uvs=True)`, currently just `street_props` for the signboard panel); there's no Draco/meshopt compression (Babylon needs no extra decoder), and emissive materials use `KHR_materials_emissive_strength`.
- **Axis mapping into Babylon.js.** Babylon's glTF loader adds a `__root__` node (rotated 180° about Y, Z flipped). Derived from the loader's conversion and not yet checked in-engine:
  `Babylon (x, y, z) = (−x_blender, z_blender, −y_blender)`
  - Blender **−Y** = Babylon **+Z** = game **north**. Blender **+Y** = game **south**.
  - Blender **+X** = Babylon **−X** = game **west**.
  - "Front" of the rickshaw, stall and signboard = Blender −Y, so they face game north (+Z) by default. Rotate the instance to face elsewhere.

## Assets

| File | Size | Tris | Bounding box (Blender X × Y × Z) | Nodes |
|---|---|---|---|---|
| `charminar.glb` | 438 KB | 13,182 | 19.9 × 19.6 × 35.3 m (structure alone: 17.7 × 17.7 × 35 m) | `Charminar_Structure`, `Alien_Growth_Minaret_SW`, `Alien_Growth_Minaret_NE`, `Alien_Growth_Arch_South` |
| `rickshaw.glb` | 34 KB | 632 | 1.40 × 2.61 × 1.70 m | `Rickshaw` |
| `rickshaw_wrecked.glb` | 31 KB | 592 | 2.04 × 3.12 × 2.16 m (tilted, includes the lost wheel) | `Rickshaw_Wrecked` |
| `bazaar_stall.glb` | 128 KB | 2,510 | 2.50 × 1.72 × 2.43 m | `Bazaar_Stall` |
| `street_props.glb` | 90 KB | 1,840 | kit laid out along X | `Lamp_Post`, `Signboard` (+ child `Signboard_Panel`), `Water_Drum`, `Pylon` (+ child `Pylon_Core`), `Wire_Pole` |
| `facades.glb` | 478 KB | 7,928 | kit laid out along X | 6 building fronts + 3 pilasters (see below), each front with a `*_Sign` child |
| `mothership.glb` | 123 KB | 3,034 | 142 × 137 × 33 m (hull disc 100 m; spines reach ~140 m) | `Mothership` (+ children `Mothership_Lights`, `Mothership_Beam_Emitter`) |
| `debris.glb` | 121 KB | 2,314 | kit laid out along X | `Burning_Car`, `Rubble_Pile`, `Crashed_Pod`, `Sandbag_Wall`, `Barricade` |

### Charminar
- The footprint matches the Level 1 gray box in `src/game/Level.ts`:
  - 16 × 16 m base centred on the origin
  - Pillars at ±[3, 8]
  - 6 m-wide pointed arches on all four sides (spring at 5.5 m, apex about 10.7 m), so the centre stays walkable
  - Roof slab 12–14 m, upper storey 12 × 12 m at 14–18 m
  - Minarets at (±7.5, ±7.5), each with 3 balconies, a lantern, an onion dome and a finial at about 35 m
- Details: a clock dial above each arch, arched niches on the upper storey, merlon parapets, and a small mosque dome on the west side of the roof.
- **Toggleable alien occupation layer.** These are separate meshes with identity transforms, so hide them with `setEnabled(false)`:
  - `Alien_Growth_Minaret_SW`: tendrils spiralling up the game-south-west minaret (Blender (+7.5, +7.5)), with roots and glowing pustules
  - `Alien_Growth_Minaret_NE`: the same on the game-north-east minaret (Blender (−7.5, −7.5))
  - `Alien_Growth_Arch_South`: tendrils framing the **south** arch, which players see first when they enter the plaza, plus a glowing hive mass at the apex and hanging tendrils. These end at about 8 m or higher, so the passage stays clear.
  - Materials: `AlienFlesh` (dark, faint purple emissive) and `AlienGlow` (#b14dff, emissive strength 4). For a pulsing effect, animate `AlienGlow`'s emissive intensity in code.

### Street-props kit (`street_props.glb`)
Each prop is a top-level node with its own origin at its bottom centre. In the file they're spread along X (lamp 0, signboard 3, drum 5.5, pylon 8, wire pole 16) for the preview. **In the game, clone a node and set its position directly.**
- `Lamp_Post`: 5.5 m. The lamp-head material `LampGlow` is emissive; add a Babylon PointLight under the head (local about (0, 4.9, −1.0) in Blender terms) for real light.
- `Signboard` + `Signboard_Panel`: the panel is a separate UV-mapped quad (0..1). Swap its material for a texture or DynamicTexture with shop text (Telugu/Hindi/Urdu).
- `Water_Drum`: a blue plastic drum, 0.9 m.
- `Pylon` + `Pylon_Core`: replaces the game's purple cylinder. 3 dark crystal shards + 3 small shards on a hex plinth (`Pylon`), with a 4.5 m glowing core (`Pylon_Core`, material `PylonCore`). Pulse or scale the core in code; make the core (or an invisible cylinder) the damageable hit target.
- `Wire_Pole`: a 7.2 m concrete pole with crossarms, insulators and a transformer, plus about 12 sagging cables reaching ±7 m in X and a coil of spare cable.

### Facade kit (`facades.glb`): Hyderabad old-city building fronts
Stick these onto the plain gray-box buildings so the lanes stop looking like blank blocks.
- **Origin = bottom centre of the BACK face** (Blender y = 0), the face that touches the building wall. The front faces
  Blender **−Y** (= Babylon **+Z** = game north by default). Details protrude up to **0.8 m** in front of the back face.
  To dress a wall facing direction *d*, put the module's origin on that wall's surface and rotate it so +Z points along *d*
  (east-facing wall: yaw +π/2; west-facing: −π/2; south-facing: π).
- `Facade_C_6x9` and `Facade_E_6x14` carry black roof water tanks that sit **behind** the back face (Blender y up to +1.35 m),
  resting on the building roof. Their bounding boxes are deeper for that reason.
- Modules (width × height match the gray-box buildings: lane buildings 9–14 m tall; tile 4 m and 6 m widths; cover leftover
  gaps and seams with pilasters):

| Node | W × H (m) | Tris | Wall colour | Ground floor | Upper floors |
|---|---|---|---|---|---|
| `Facade_A_4x9` | 4 × 9 | 1,130 | faded turquoise | teal rolling shutter | pointed-arch windows, brown shutters, balcony, laundry line |
| `Facade_B_4x11` | 4 × 11 | 746 | ochre / mustard | open shop (lit tube-light, shelves of goods, counter) | rectangular windows with chajjas, green shutters, balcony, AC unit |
| `Facade_C_6x9` | 6 × 9 | 1,122 | salmon pink | blue + grey rolling shutters | rectangular windows, blue shutters, balcony, AC, roof water tank |
| `Facade_D_6x11` | 6 × 11 | 1,502 | lime-wash white (blue trim) | two open shops | arched windows, blue shutters, festival banner on the parapet, AC |
| `Facade_E_6x14` | 6 × 14 | 1,794 | sky blue | grey shutter + open shop | 3 floors, 2 balconies, laundry line, 2 roof water tanks |
| `Facade_F_4x14` | 4 × 14 | 1,334 | mint green | grey rolling shutter | 3 floors of arched windows, brown shutters, balcony, parapet banner |
| `Facade_Pilaster_9` / `_11` / `_14` | 0.6 × 9 / 11 / 14 | 88–112 | sandstone | — | column with floor bands and a finial; use it to hide seams between modules |

- Every front has a child **`<Module>_Sign`**: a UV-mapped (0..1) quad, (W − 0.45) × 0.6 m, over the shop-sign band at
  2.9–3.5 m. Its material `Sign_<Letter>` is a solid colour; swap it for a DynamicTexture with Telugu/Hindi/Urdu shop names.
- About a quarter of the upper windows (9/35) use the shared emissive material **`WindowLit`** (warm amber); the rest use
  `GlassDark`. Open shops also have a `WindowLit` tube-light. To flicker or switch off windows, animate `WindowLit`.
- Each module has its own wall (`Wall_<Letter>`), grime (`Grime_<Letter>`, a darker band at the base and under the
  parapet) and trim (`Trim_<Letter>`) materials, so you can re-tint walls in code.
- Layout offsets in the file (centre X): A 2.0, B 6.8, C 12.6, D 19.4, E 26.2, F 32.0, pilasters 35.1 / 36.5 / 37.9.
  Zero the node's position when placing it.

### Mothership (`mothership.glb`)
- A dark spiked disc for the sky: hull disc **100 m** across (claws reach about 140 m), 33 m tall. **Origin at the ship's
  centre** (not the bottom), so it scales and rotates around its middle. It reads as a silhouette from below.
- Children: `Mothership_Lights` (two glowing rings under the rim, 20 crown port lights, 4 pod lights) and
  `Mothership_Beam_Emitter` (the downward nozzle with a glowing lens at z = −16.3 m), both using **`ShipGlow`**
  (#d84dff, emissive strength 8). Pulse `ShipGlow` in code; the GlowLayer gives the halo.
- The tractor beam itself is not modelled. Add it in-engine as a long, transparent, additive cone hanging below the emitter.
- Suggested placement: scale 2–4×, about 250–400 m up and 300+ m away, behind the Charminar. Fog will tint it.

### Debris kit (`debris.glb`)
Each node has its origin at its own bottom centre. Layout offsets along X: car 0, rubble 6, pod 12, sandbags 18, barricade 23
(zero the node position when placing it). Long axes run along Blender X.

| Node | Size (X × Y × Z, m) | Tris | Notes |
|---|---|---|---|
| `Burning_Car` | 3.9 × 2.7 × 2.5 (incl. flames and the lost wheel) | 524 | crushed hatchback, tilted (one wheel missing, lying beside it); flame tongues use **`FireGlow`** (orange) and **`FireCore`** (yellow). Flicker their emissive intensity and add an orange PointLight about 1.5 m above. Collider: about 3.8 × 1.7 × 1.4 m |
| `Rubble_Pile` | 2.4 × 2.8 × 2.3 (rebar sticks up to 2.1 m) | 372 | masonry, brick and concrete chunks with rusty rebar; low cover |
| `Crashed_Pod` | 6.7 × 6.2 × 4.2 | 694 | alien drop-pod rammed diagonally into a scorched crater (radius 3.2 m); glowing seams and window use **`PodGlow`** (#b14dff). The hull dips about 0.8 m below ground. Collider: an invisible cylinder about 2 m in radius, 3 m tall |
| `Sandbag_Wall` | 3.2 × 0.5 × 1.15 | 464 | 4 rows of sandbags with 2 wooden posts; chest-high cover (collider 3.2 × 0.5 × 1.0 m) |
| `Barricade` | 2.2 × 0.7 × 1.4 | 260 | yellow/black striped police barrier with a blue plate |

## Integration notes for Babylon.js
- Load with `SceneLoader.ImportMeshAsync("", "/models/", "charminar.glb", scene)` (needs `@babylonjs/loaders/glTF`).
- **Collisions:** keep the existing gray-box collision meshes from `Level.ts` and make them invisible (`isVisible = false`, keep `checkCollisions` and the `world` metadata for bullets and line of sight). Treat the .glb meshes as **visual only** (`checkCollisions = false`; `isPickable = false` unless you want bullet decals on them). The Charminar was built to match those boxes. For rickshaws and stalls, add a simple invisible box collider (about 1.4 × 1.7 × 2.6 m for the rickshaw; the stall counter is about 2.3 × 0.9 × 0.94 m).
- Don't add collisions to cables, alien growth, bangles or other small props.
- Emissive parts look best with the game's existing GlowLayer.
- Sizes are uncompressed; gzip/brotli on the web server roughly halves the transfer size.

## Known limitations
- The axis mapping above is derived from the loader's conversion, not checked in-engine. If props face the wrong way, rotate the instance by 180° about Y.
- The Charminar is 438 KB, above the 300 KB target but under the 1 MB limit. Most of it is the structure (about 9k tris). If needed: fewer minaret segments (12 → 10) or fewer merlons.
- The Charminar's alien-growth roots dip about 0.27 m below z = 0, so they sit slightly into the ground. The structure itself starts at z = 0.
- The preview renders use Eevee without bloom, so emissive surfaces appear as flat bright colour there. In-game the GlowLayer handles bloom.

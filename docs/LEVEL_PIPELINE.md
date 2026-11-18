# Level pipeline (Level 1 shell)

The level **shell** (ground, street slabs, buildings, perimeter and plaza walls, the Charminar collision blocks, the
captive cage, the secret room) is a portable 3D asset. Props, facades, lights and effects are separate data (see
`data/level/level1.json` → `props`, `facadeRuns`, `lights`, …).

```
data/level/level1.json  ──►  tools/blender/build_level.py  ──►  tools/blender/src/level1.blend
   (blocks[]: source of truth)        (headless Blender)          public/models/level/level1.glb  ──►  src/game/Level.ts
```

## Rebuild
```bash
cd idam-jagath
blender --background --factory-startup --python tools/blender/build_level.py
```
Prints `LEVEL_OK blocks=<n> hash=<h> kb=<size>`. Run it after **any** change to `blocks` in the JSON.

## Which file wins
- **`level1.json` is the source of truth** for block layout. The `.blend` and `.glb` are generated; don't hand-edit
  block positions there (the next rebuild overwrites them).
- The GLB stores a `source_hash` (scene extras) of the block geometry. At runtime `Level.ts` compares it with the
  JSON (`levelGeometryHash()` in `src/data/level.ts`). **If they differ, the GLB is stale**: the game logs a
  warning and builds the blocks from the JSON instead, so the JSON always wins.
- Hand-modelled detail (trims, steps, curbs, baked-light geometry) should go in a **separate** asset
  (e.g. `level1_detail.glb`) placed as a prop, not into the generated shell.

## Coordinates
- glTF coordinates in `level1.glb` **are game coordinates**: metres, +Y up, +Z north (right-handed glTF).
- The glTF exporter maps Blender (X, Y, Z) → glTF (X, Z, −Y), so a game point (x, y, z) sits at Blender (x, −z, y).
- Each block is one node whose **translation is the block centre**; nodes have no rotation or scale.
- Engines differ only in handedness: Babylon (left-handed) flips triangle winding on load (`Level.ts`,
  `meshFromGeometry`); Unity/Godot/Unreal glTF importers handle it automatically.

## Naming conventions
| Item | Convention |
|---|---|
| Render mesh | the block's `name` from the JSON (Blender adds `.001`… for duplicates; use extras instead) |
| glTF extras on render nodes | `block_index` (index into `blocks[]`), `block_name`, `block_shape`, `block_id` (if any) |
| Collision primitive | `COL_<name>` in collection `Level_Colliders`, extras `collider_for: <block_index>`; boxes, cylinders as 8-sided prisms |
| Collections | `Level_Visual`, `Level_Colliders` |
| Material slot | `color_<hex>` (the block's gray-box colour); engines assign real materials by block name/rule |
| Gameplay-removable blocks | `cage-door` and `secret-wall` are separate objects (ids in extras) |

The Babylon build uses the render meshes as colliders (they're the same boxes), so it ignores `COL_*`; the colliders
are there for engines that import collision meshes by naming convention.

## UV channels
- **UV0 `UVMap`**: world-scale box projection, 1 UV unit = 1 m (same axes as `tileUVs()`), so tiling textures line
  up across blocks. The game currently re-tiles per material rule (`Surfaces.apply`, `applyBeautyMaterials`).
- **UV1 `LightmapUV`**: non-overlapping per-object unwrap (Smart UV Project), reserved for light baking.

## Baking lighting later (not wired yet)
1. In `build_level.py` (or a `bake_level.py` that opens `level1.blend`): add the static props/facades, the Charminar
   and lights (sun from the moon direction, warm point lights at the lamp/fire positions from the JSON), switch to
   Cycles, and bake **Diffuse (direct + indirect, no colour)** or **Combined** per object into one or more atlas
   images using UV1 (or a single combined lightmap atlas via a joined copy).
2. Save the lightmaps to `public/textures/lightmaps/` and record the per-object image/offset in the GLB extras.
3. In the engine: assign each material's `lightmapTexture` with `coordinatesIndex = 1` (`useLightmapAsShadowmap`
   for a multiply blend), and dim the real-time lights that the bake replaces.

## Runtime loading (Babylon adapter)
`src/game/Level.ts` fetches the GLB with a **module-level `await`** (`loadLevelGeometry()` in `src/data/level.ts`,
an engine-neutral GLB reader), so the geometry is in memory before `Game` constructs the `Level` and `build()` stays
synchronous. `level.shellSource` is `"glb"` or `"code"`. `?codelevel` forces the code-built fallback for A/B checks.

## Climbable Charminar (2026-11-18)
- `tools/blender/import_charminar_skfb.py`: FOOTPRINT 24.64 (1.4×; ≈26.4 m wide incl. minarets, 42.6 m tall, roof terrace at y 20.58). Boolean-cuts a doorway (1.4 × 2.5 m) and a Ø3.8 m shaft + roof hatch into one leg. **Note: the glTF import mirrors Blender X, so Blender (-6.97, 6.97) is the game's SOUTH-EAST leg (game x +6.97, z 79.03).**
- `tools/blender/build_charminar_stairs.py` → `public/models/charminar_stairs.glb`: 114 stone steps (0.18 m rise, 7.48 turns, pitch 2.75 m), column, door frame, hatch rail + invisible `COL_*` proxies (smooth helical ramp, shaft ring with door gap, hatch railing). Loaded by `Level.placeCharminarStairs()` (COL_* → collision only; 2 torch lights).
- `data/level/level1.json`: `ch-*` colliders rebuilt (hollow SE leg `ch-shaft-*` with door gap, roof split around the hatch `ch-roof-a..d`, `ch-parapet` ×4, minarets Ø3.8 at (±10.4, 75.6/96.4)); `anchors.pylons[2]` = roof centre `[0, 20.58, 86]`; `anchors.climbEntry` = door (waypoint guides there while the target pylon is high above the player).
- After changing the Charminar: run import → stairs → `build_level.py` → `bake_level.py`, copy the new raw GLBs into `art/_public_backup/models/` and run `node tools/assets/optimize_glb.mjs public/models/charminar_skfb.glb public/models/charminar_stairs.glb`.
- Tests: `tools/dev/climb_test.js` (`climbTest()`, `descendTest()`), `stuckTestClimb()` in `tools/dev/stuck_test.js`.

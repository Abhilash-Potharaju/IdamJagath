# Asset optimization (web delivery)

Masters live in `art/` (library sources, .blend files). `public/` holds the **web-optimized** copies the game loads.
Pristine pre-optimization copies of `public/` are kept in `art/_public_backup/` (git-ignored); every optimizer reads
from there, so the pipeline is re-runnable and reversible (copy the backup back to undo).

## Pipeline (`npm run assets:optimize`)
| Step | Script | What it does |
|---|---|---|
| Models | `tools/assets/optimize_glb.mjs` | glTF-Transform: dedup, prune, weld, resample animations, **WebP textures** (EXT_texture_webp; normal maps q92, others q84, max 2048, Charminar fallback 1024), reorder + quantize (KHR_mesh_quantization), **meshopt compression** (EXT_meshopt_compression). Never grows a file (keeps the original if not smaller). Skips `public/models/level/` (owned by the level/lighting pipeline). |
| Textures | `tools/assets/optimize_textures.mjs` | Re-encodes standalone JPEGs in place with mozjpeg (same names/format: normal maps q90 4:4:4, others q82). Skips `textures/lightmaps/`. |
| HDRI | `tools/assets/resize_hdri.py` (Blender) | 2K → 1K equirect (the game prefilters it into a 256 px cube). Same file name/format. |

Run a single model: `node tools/assets/optimize_glb.mjs public/models/props/autorickshaw.glb`.

## Runtime decoders
- **meshopt**: Babylon's `MeshoptCompression` is pointed at a **locally hosted** decoder, `public/decoders/meshopt_decoder.js`
  (copied from the `meshoptimizer` npm package), in `configureDecoders()` (`src/game/Props.ts`). No CDN dependency, so it
  works offline and on game portals.
- **WebP** textures are decoded natively by the browser (all current browsers). KTX2/Basis was not used: it needs the
  `toktx`/`basisu` tools; it's a future step for lower GPU memory on mobile.

## Portability
Formats are standard glTF extensions supported by Unity (glTFast), Godot 4, Unreal (glTF importer) and three.js/Babylon.
For engines that don't support meshopt/WebP, re-export from `art/_public_backup/` or the `art/` masters.

## Results (2026-11-18)
Assets fetched by a full load (explore mode): **49.1 MB → 20.7 MB**; headless time-to-ready 46 s → 32 s.
GLBs 37.1 → 13.3 MB (e.g. Charminar 8.6 → 1.1, spiderthing 4.0 → 1.7, bhelpuri cart 2.1 → 0.44); JPEG textures
15.7 → 9.0 MB (Charminar weathering 4.2 → 2.3); HDRI 7.1 → 1.8 MB.

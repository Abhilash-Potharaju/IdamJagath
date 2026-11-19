# Asset optimization (web delivery)

Masters live in `art/` (library sources, .blend files). `public/` holds the **web-optimized** copies the game loads.
Pristine pre-optimization copies of `public/` are kept in `art/_public_backup/` (git-ignored); every optimizer reads
from there, so the pipeline is re-runnable and reversible (copy the backup back to undo).


> **Licence rule (owner, 2026-11-19): CC0, CC BY (credited) or self-made only.** Never ambiguous or
> redistribution-restricting licences, such as Sketchfab "Free Standard"/Standard, Editorial, NC, ND, "royalty-free"
> store licences, personal-use-only, custom/unclear or unlicensed. The repo is public, so every asset in it is
> redistributed. Details: `CLAUDE.md`.
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

## Audio (Freesound pipeline, 2026-11-19)
Combat and creature sounds are built from **Freesound** recordings (CC0 first; CC BY only where clearly better and then
credited). In-house synth renders (`tools/dev/export_audio.mjs`) remain for UI/mission/ambience sounds, and the Web Audio
synth recipes in `Audio.ts` are still the fallback for anything that fails to load (`?synthaudio` forces it).

| Step | Tool | What it does |
|---|---|---|
| Search | `node tools/audio/freesound.mjs search "<query>" [--any] [--max s]` | CC0 only by default (`--any` adds CC BY; NC / sampling+ never). Key: `FREESOUND_API_KEY` in `.env.local` (git-ignored). |
| Fetch | `node tools/audio/freesound.mjs fetch <id> <dir>` | HQ OGG preview + licence/author JSON (refuses other licences). |
| Inspect | `node tools/audio/analyze.mjs <files…>` | Duration, peak, events (start/end, level, brightness, low-end share) to pick cut points. |
| Build | `node tools/audio/build.mjs [name…]` | Renders `tools/audio/recipes.mjs` (trim to onset, filter, pitch, fades, mixes, loudness-normalise, peak −1 dBFS) to `public/audio/fs/<name>_<n>.m4a` (AAC mono 80–96 kbps), merges them into `public/audio/manifest.json` (`files` = random variants, `sources` = provenance) and writes one `audio/freesound/<id>` entry per source into `data/assets.json` (CC BY ones get `credit_order`, so they show in the credits). Sources are cached in `tools/audio/.cache/` (git-ignored, re-fetched on demand). |

Run `build.mjs` again after any `export_audio.mjs` run (that tool rewrites the manifest from scratch).

Runtime (`src/engine/babylon/Audio.ts`, `CreatureAudio.ts`): gunshots are layered (crack + body + tail; the tail
crossfades between a short "lane" slap and a long "plaza" echo from an 8-ray openness probe around the player, plus a
delayed distant echo in the open; each shot cuts the previous tail so bursts stay clean). Positional sounds use HRTF
panning, distance low-pass and a line-of-sight muffle behind walls. Reload phases (mag out / in, bolt; shells + pump)
are timed to the reload motion in `WeaponView.ts`. Awake enemies near the player vocalise on random timers; the Warden
has distance-paced footsteps.

Total: about 0.95 MB of new audio (`public/audio/fs/`), 111 decoded files with the in-house ones.

## Monster models (`public/models/monsters/`)
Skinned Sketchfab creatures (CC BY, credited from `data/assets.json`) that skin the code-driven enemies. Fit, clips,
eye materials and kept procedural parts are set in `data/gameplay/enemies.json` (`model`); the runtime is
`src/engine/babylon/monsterModels.ts`. Raw downloads live in `art/_public_backup/models/monsters/`.

| File | Enemy | Source | Tris | Web size | Clips |
|---|---|---|---|---|---|
| `spiderthing.glb` | Crawler | "Spiderthing take 3", Rasmus82 | 68k | 1.67 MB | walk |
| `alien_quadruped.glb` | Spitter | "alien monster", victory_ | 81k | 0.64 MB | walk |
| `cyclops_brute.glb` | Warden | ["Cyclops Rig"](https://sketchfab.com/3d-models/cyclops-rig-e5cc86878c314f5bae6d7268bb7541d9), SuperKapoo913 | 11k | 0.95 MB (raw 5.2 MB) | idle; stride, roar, charge lean, stun slump, drop tuck and landing crouch are layered procedurally on its named skeleton (`WardenView.poseModel`) |

## First-person arms (`public/models/weapons/arms_*.glb`)
"FP arms" by bumstrum (CC BY; credited from `data/assets.json`), posed onto each gun by
`tools/blender/build_fp_arms.py`: shoulders placed relative to the game camera (forward, just under the view: the usual
viewmodel cheat), two-bone IK to each wrist, hands turned to a grip frame with the knuckles nudged onto the grip
point, fingers curled; then baked to a static mesh in the gun model's own frame. `weapons.json` → `arms`; WeaponView
places it exactly like the gun model under the same root, so it shares all recoil/sway/reload motion and the scope
fade. `?noarms` shows the floating gun. Vajra: right hand on the raked grip, left hand clamping the forend; Trishul:
left hand on the barrel shroud (its foregrip block is below the bottom of the screen).

## Captives (`public/models/captives/`)
Four different Hyderabadis in the cage (CC BY; credited from `data/assets.json`): `blue` (kurta-pyjama, Himanshuvaid)
grips the energy door, then waves the player in; `woman` (office woman, ar.jethin) kneels and pleads; `teen`
(ar.jethin) cowers; `mutant` (bearded man in a hoodie, ar.jethin) is the half-converted one. `tools/blender/build_captives.py`
authors the clips (limb directions per key pose, aimed bone by bone; the avatars keep their own motion-capture idle):
Grip/Wave, Kneel, Cower, Hunch (with bone-scale deformation: swollen, elongated right arm, swollen back and shoulder),
plus Idle/Walk/Run for following the player. Poses start from the imported (bind) pose (the importer keeps a hip
offset in the pose bones) and each clip is authored with the NLA muted. The script also drops the importer's
bone-display icosphere and the teeth, decimates (~6k tris per part, hair 10k), shrinks the avatars' maps to 512 and
normalises each person's height with the feet at the origin. Raw exports go to `art/_public_backup/models/captives/`,
then `optimize_glb.mjs` (0.4–1.0 MB each, 3.3 MB total). Runtime: `src/engine/babylon/Captives.ts` (conversion
beam; the mutant's skin tint, vein glow, red eyes and growths, which drain/shrink away once freed; waving once the door
opens; once freed they follow the player's footpath to the extraction point, staggered where the nav grid has room).

Runtime presence (all models): lower roughness plus a thin clear coat (wet look), a faint blood-red glow (the albedo
reused as emissive), glowing eyes (`eyes` material names) and the enemy's tell/flash colour on top. Single-clip
models also crouch/rear in a windup, stretch into a lunge and breathe (generic, from the core state).

# Asset library: the project standard

All third-party and generated assets live here as **full-quality sources**. Game builds use optimized copies
(compressed textures, decimated meshes, baked lighting) exported into `public/models/`.

## Sourcing order (use the first that fits)
1. **Poly Haven / ambientCG (CC0)**: materials, HDRI skies, generic props. Fetch with
   `python3 -I tools/assets/polyhaven_fetch.py <textures|models|hdris> <res> <ids...>`.
2. **Sketchfab (CC0 / CC BY only)**: India-specific items (rickshaws, shopfronts, Mughal details) via the
   `sketchfab` MCP (license-filtered search). Record every CC BY asset in `art/CREDITS.md`.
3. **Meshy / fal (AI image→3D)**: monsters, alien objects, anything unique.
4. **Blender scripts (`tools/blender/`)**: level shell, unique geometry, trims.

## Look rules
- One realistic style: PBR materials (color + normal + roughness/AO) on everything; no flat colors or code-painted textures.
- Real scale in metres; origin at the bottom centre; +Y up in glTF.
- Lighting gets baked in Blender for static geometry; game adds real-time lights/shadows for moving things.

## Layout
- `polyhaven/{textures,models,hdris}/<id>/` + `polyhaven/manifest.json` (source, license, authors, files)
- `previews/`: contact sheets (`tools/assets/library_preview.py`)

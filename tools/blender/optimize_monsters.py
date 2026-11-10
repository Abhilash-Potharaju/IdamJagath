"""Shrink textures of rigged/animated monster models while keeping skeleton + animations intact.

Run from idam-jagath/:
  blender --background --disable-autoexec --factory-startup --python tools/blender/optimize_monsters.py
Scale/orientation are handled in the game (src/game/monsterModels.ts), so the rig is not touched here.
"""
import glob
import os

import bpy

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "public/models/monsters")
MONSTERS = {
    "spiderthing": ("art/library/sketchfab/monster_spiderthing/*.glb", 1024),
    "alien_quadruped": ("art/library/sketchfab/monster_alien_quadruped/*.glb", 1024),
}
os.makedirs(OUT, exist_ok=True)
for name, (pattern, tex) in MONSTERS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=sorted(glob.glob(os.path.join(ROOT, pattern)))[0])
    for img in bpy.data.images:
        if max(img.size) > tex:
            k = tex / max(img.size)
            img.scale(int(img.size[0] * k), int(img.size[1] * k))
    out = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=82,
                              export_animations=True, export_skins=True)
    print(f"MONSTER {name}: actions={[a.name for a in bpy.data.actions]} kb={os.path.getsize(out)//1024}")

"""Make Sketchfab weapon models first-person-ready.

Run from idam-jagath/:
  blender --background --disable-autoexec --factory-startup --python tools/blender/optimize_weapons.py
Output: public/models/weapons/<name>.glb  (barrel along Blender -Y = game +Z/forward, top up, centred, real length)

Muzzle direction is found automatically: the barrel axis is the longest horizontal axis, and the muzzle is the end
with the smaller cross-section (stock + grip make the rear end bulkier). Set FLIP below if a gun comes out backwards.
"""
import glob
import math
import os

import bpy
from mathutils import Matrix, Vector

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "public/models/weapons")
TEX_MAX = 1024
# name: (source glob, length in metres, flip 180 deg if the auto-detection picks the wrong end)
GUNS = {
    "ar_h470": ("art/library/sketchfab/gun_ar_h470/*.glb", 0.82, False),
    "rl0n_25": ("art/library/sketchfab/gun_rl0n_25/*.glb", 0.95, False),
}


def process(name, pattern, length, flip):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=sorted(glob.glob(os.path.join(ROOT, pattern)))[0])
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    me = obj.data
    vs = [v.co.copy() for v in me.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    dims = mx - mn
    # 1) rotate so the barrel (longest horizontal axis) runs along Y
    if dims.x > dims.y:
        me.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
    vs = [v.co.copy() for v in me.vertices]
    ys = [v.y for v in vs]; y0, y1 = min(ys), max(ys); L = y1 - y0

    def section(lo, hi):
        sl = [v for v in vs if lo <= v.y <= hi]
        if not sl:
            return 0.0
        return (max(v.x for v in sl) - min(v.x for v in sl)) * (max(v.z for v in sl) - min(v.z for v in sl))
    front, back = section(y0, y0 + 0.12 * L), section(y1 - 0.12 * L, y1)
    # 2) muzzle (smaller end) must point to -Y (= game forward); if it's at +Y, turn 180 degrees
    muzzle_at_plus_y = back < front
    if muzzle_at_plus_y != flip:
        me.transform(Matrix.Rotation(math.radians(180), 4, "Z"))
    # 3) centre on the bounding box and scale to the real length
    vs = [v.co.copy() for v in me.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    s = length / (mx.y - mn.y)
    c = (mn + mx) / 2
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-c))
    me.update()
    # 4) textures <= 1K
    for img in bpy.data.images:
        if max(img.size) > TEX_MAX:
            k = TEX_MAX / max(img.size)
            img.scale(int(img.size[0] * k), int(img.size[1] * k))
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=82)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"GUN {name}: tris={tris} muzzle_was_plus_y={muzzle_at_plus_y} sections(front/back)={front:.4f}/{back:.4f} kb={os.path.getsize(out)//1024}")


for n, (pat, length, flip) in GUNS.items():
    process(n, pat, length, flip)

"""Make library props game-ready: real-world scale, origin at bottom centre, decimated, textures <= 1K, GLB out.

Run from idam-jagath/:
  blender --background --disable-autoexec --factory-startup --python tools/blender/optimize_props.py
Reads PROPS below; writes public/models/props/<name>.glb and tools/blender/previews/props/<name>.png
"""
import glob
import math
import os

import bpy
from mathutils import Vector

ROOT = os.getcwd()
LIB = os.path.join(ROOT, "art/library")
OUT = os.path.join(ROOT, "public/models/props")
PREV = os.path.join(ROOT, "tools/blender/previews/props")
TEX_MAX = 1024
# Per-prop overrides: texture size (small props don't need 1K) and, for Poly Haven kits that ship several
# variants in one file, a substring of the object to keep (weathered variants suit a war zone).
OPTS = {
    "aircon": {"tex": 512, "pick": "rusted_01"}, "trash_can": {"tex": 512, "pick": "rust"},
    "manhole": {"tex": 512}, "brass_pot_01": {"tex": 512}, "brass_pot_02": {"tex": 512}, "brass_vase_01": {"tex": 512},
    "plastic_crate": {"tex": 512}, "cardboard_box": {"tex": 512}, "barrel": {"tex": 512}, "old_tyre": {"tex": 512},
    "potted_plant": {"tex": 512}, "utility_box": {"tex": 512}, "thela_stall": {"tex": 512}, "autorickshaw": {"tex": 1024},
    "bhelpuri_cart": {"tex": 1024}, "car_burned_pair": {"tex": 1024}, "car_crashed": {"tex": 1024},
    "car_sedan_abandoned": {"tex": 1024}, "rubble_pile": {"tex": 1024}, "concrete_debris": {"tex": 512}, "concrete_chunks": {"tex": 512}, "cycle_rickshaw": {"tex": 512}, "kirana_shopfront": {"tex": 1024}, "paan_kiosk": {"tex": 1024},
}

# name: (source glob under art/library, sizing rule, size in metres, max tris)
#   sizing rule: "len" = longest horizontal side, "h" = height, "keep" = already real scale (Poly Haven)
PROPS = {
    "autorickshaw":   ("sketchfab/autorickshaw/*.glb", "len", 2.65, 9000),
    "paan_kiosk":     ("sketchfab/paan_kiosk/*.glb", "h", 2.5, 2000),
    "thela_stall":    ("sketchfab/thela_stall/*.glb", "len", 2.3, 14000),
    "bhelpuri_cart":  ("sketchfab/bhelpuri_cart/*.glb", "h", 2.3, 14000),
    "cycle_rickshaw": ("sketchfab/cycle_rickshaw/*.glb", "len", 2.5, 14000),
    "kirana_shopfront": ("sketchfab/kirana_shopfront/*.glb", "len", 4.0, 3000),
    "aircon":         ("polyhaven/models/exterior_aircon_unit/*.gltf", "keep", 0, 3000),
    "trash_can":      ("polyhaven/models/metal_trash_can/*.gltf", "keep", 0, 3000),
    "manhole":        ("polyhaven/models/water_manhole_cover/*.gltf", "keep", 0, 1500),
    "brass_pot_01":   ("polyhaven/models/brass_pot_01/*.gltf", "keep", 0, 3000),
    "brass_pot_02":   ("polyhaven/models/brass_pot_02/*.gltf", "keep", 0, 3000),
    "brass_vase_01":  ("polyhaven/models/brass_vase_01/*.gltf", "keep", 0, 3000),
    "plastic_crate":  ("polyhaven/models/plastic_crate_01/*.gltf", "keep", 0, 2000),
    "cardboard_box":  ("polyhaven/models/cardboard_box_01/*.gltf", "keep", 0, 1000),
    "barrel":         ("polyhaven/models/barrel_03/*.gltf", "keep", 0, 3000),
    "old_tyre":       ("polyhaven/models/old_tyre/*.gltf", "keep", 0, 2500),
    "potted_plant":   ("polyhaven/models/potted_plant_01/*.gltf", "keep", 0, 5000),
    "utility_box":    ("polyhaven/models/utility_box_01/*.gltf", "keep", 0, 2000),
    # key-art war damage (Sketchfab CC BY)
    "car_burned_pair":     ("sketchfab/car_burned_pair/*.glb", "len", 4.6, 4000),
    "car_crashed":         ("sketchfab/car_crashed/*.glb", "len", 4.5, 9000),
    "car_sedan_abandoned": ("sketchfab/car_sedan_abandoned/*.glb", "len", 4.6, 10000),
    "rubble_pile":         ("sketchfab/rubble_pile/*.glb", "len", 3.4, 9000),
    "concrete_debris":     ("sketchfab/concrete_debris/*.glb", "len", 2.6, 7300),
    "concrete_chunks":     ("sketchfab/concrete_chunks/*.glb", "len", 2.2, 8000),
}


def eevee():
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"


def process(name, pattern, rule, size, max_tris):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = sorted(glob.glob(os.path.join(LIB, pattern)))[0]
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    pick = OPTS.get(name, {}).get("pick")
    if pick:
        keep = [o for o in meshes if pick in o.name.lower()]
        if keep:
            for o in meshes:
                if o not in keep:
                    bpy.data.objects.remove(o, do_unlink=True)
            meshes = keep
    # bake parent transforms, drop empties, join
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
    # scale + origin at bottom centre
    vs = [v.co for v in obj.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    dims = mx - mn
    s = 1.0
    if rule == "len":
        s = size / max(dims.x, dims.y)
    elif rule == "h":
        s = size / dims.z
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for v in obj.data.vertices:
        v.co = (v.co - c) * s
    obj.data.update()
    # decimate if needed
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > max_tris:
        d = obj.modifiers.new("dec", "DECIMATE"); d.ratio = max_tris / tris
        bpy.ops.object.modifier_apply(modifier=d.name)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    # shrink textures
    tex_max = OPTS.get(name, {}).get("tex", TEX_MAX)
    used = {n.image for m in bpy.data.materials if m.node_tree for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}
    for img in bpy.data.images:
        if img not in used:
            continue
        if img.size[0] > tex_max or img.size[1] > tex_max:
            k = tex_max / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG",
                              export_jpeg_quality=78, export_apply=True)
    # preview (front = Blender -Y, which becomes game +Z)
    vs = [v.co for v in obj.data.vertices]
    h = max(v.z for v in vs); r = max(max(abs(v.x) for v in vs), max(abs(v.y) for v in vs), h / 2)
    sc = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = Vector((r * 1.6, -r * 2.6, h * 0.9 + r * 0.6))
    cam.rotation_euler = (Vector((0, 0, h * 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
    sun.rotation_euler = (0.9, 0.2, 0.8); sun.data.energy = 3
    sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.35, 0.35, 0.38)
    sc.render.engine = eevee(); sc.render.resolution_x, sc.render.resolution_y = 480, 360
    os.makedirs(PREV, exist_ok=True); sc.render.filepath = os.path.join(PREV, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"PROP {name}: tris={tris} dims={[round(x * s, 2) for x in dims]} kb={os.path.getsize(out) // 1024}")


import sys as _sys
_only = _sys.argv[_sys.argv.index("--") + 1:] if "--" in _sys.argv else []
for n, (pat, rule, size, mt) in PROPS.items():
    if _only and n not in _only:
        continue
    try:
        process(n, pat, rule, size, mt)
    except Exception as e:  # keep going; report
        print(f"PROP {n}: FAILED {e}")

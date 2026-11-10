"""Mid-size alien saucer for the fleet over the city (key-art style: metallic grey disc, red light ring, red emitter).

Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/saucer.py
Output: public/models/saucer.glb (~15 m across, origin at the centre). Materials: SaucerHull, SaucerTrim, SaucerGlow (red emissive).
"""
import math
import os

import bpy
import bmesh

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "public/models/saucer.glb")


def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def lathe(name, profile, segs, material):
    """Revolve a (radius, z) profile around Z."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return o


bpy.ops.wm.read_factory_settings(use_empty=True)
hull = mat("SaucerHull", (0.32, 0.33, 0.36), metal=0.85, rough=0.38)
trim = mat("SaucerTrim", (0.12, 0.12, 0.14), metal=0.7, rough=0.5)
glow = mat("SaucerGlow", (0.0, 0.0, 0.0), emit=(1.0, 0.06, 0.04), strength=7.0)

R = 7.5
# Main disc: thin rim, domed top, shallow underside
lathe("Saucer_Hull", [(0.01, 2.3), (1.6, 2.2), (3.2, 1.55), (5.4, 0.75), (R, 0.15), (R, -0.05),
                      (6.6, -0.45), (4.6, -0.85), (2.6, -1.05), (0.01, -1.1)], 40, hull)
# Raised panel ring on top and a darker trim band on the rim
lathe("Saucer_TopRing", [(3.3, 1.6), (3.5, 1.72), (4.9, 1.05), (5.0, 0.95)], 40, trim)
lathe("Saucer_Rim", [(R + 0.02, 0.2), (R + 0.12, 0.05), (R + 0.02, -0.1)], 40, trim)
# Red light ring under the rim + a ring of small light pods
lathe("Saucer_LightRing", [(6.75, -0.38), (6.95, -0.34), (6.95, -0.46), (6.75, -0.5)], 40, glow)
for i in range(12):
    a = 2 * math.pi * i / 12
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.28, location=(5.9 * math.cos(a), 5.9 * math.sin(a), 0.62))
    o = bpy.context.active_object
    o.name = f"Saucer_Pod_{i}"
    o.data.materials.append(glow)
# Downward emitter (the tractor beam comes from here)
lathe("Saucer_Emitter", [(1.5, -1.0), (1.3, -1.35), (0.9, -1.55), (0.01, -1.6)], 24, glow)
lathe("Saucer_EmitterCollar", [(2.1, -0.95), (2.15, -1.12), (1.5, -1.2)], 24, trim)

# Join to one object, export
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = bpy.data.objects["Saucer_Hull"]
bpy.ops.object.join()
o = bpy.context.active_object
o.name = "Saucer"
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB")
tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
print(f"SAUCER_OK tris={tris} kb={os.path.getsize(OUT) // 1024}")

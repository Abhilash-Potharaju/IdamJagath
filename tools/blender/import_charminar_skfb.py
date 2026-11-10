"""Convert the Sketchfab Charminar into a game-ready asset.

Source: "Charminar, Hyderabad" by Dolores (https://skfb.ly/YqOB), CC BY 4.0. Credit required (see art/CREDITS.md).
Input:  art/sketchfab/charminar/charminar_hyderabad.glb  (~113k tris, untextured)
Output: public/models/charminar_skfb.glb                 (decimated, AO-baked limestone texture)
        tools/blender/previews/charminar_skfb.png
        tools/blender/src/charminar_skfb.blend

Run from idam-jagath/:
  blender --background --disable-autoexec --factory-startup --python tools/blender/import_charminar_skfb.py

Steps: drop the display plinth -> join -> centre + scale so the footprint matches the level's
16 m gray-box (minaret outer edges ~17.6 m) -> decimate -> UV unwrap -> bake ambient occlusion
-> composite AO over a limestone colour into one 2K texture -> export GLB.
"""
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.getcwd()
SRC = os.path.join(ROOT, "art/sketchfab/charminar/charminar_hyderabad.glb")
OUT_GLB = os.path.join(ROOT, "public/models/charminar_skfb.glb")
OUT_PREVIEW = os.path.join(ROOT, "tools/blender/previews/charminar_skfb.png")
OUT_BLEND = os.path.join(ROOT, "tools/blender/src/charminar_skfb.blend")

FOOTPRINT = 17.6      # metres across the base (minaret outer edges), matches Level.ts colliders
DECIMATE_RATIO = 0.35  # ~113k -> ~40k tris
TEX = 2048
LIMESTONE = (0.80, 0.73, 0.62)  # warm granite/lime plaster

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# 1) Remove the display plinth ("Cube") and empties; keep the building meshes
meshes = []
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and not o.name.startswith("Cube"):
        meshes.append(o)
for o in list(bpy.context.scene.objects):
    if o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)

# Apply parent transforms, then join into one object
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = "Charminar"

# 2) Centre on the base, scale to the level footprint
pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
low = [p for p in pts if p.z < mn.z + 0.05 * (mx.z - mn.z)]
base_w = max(max(p.x for p in low) - min(p.x for p in low), max(p.y for p in low) - min(p.y for p in low))
s = FOOTPRINT / base_w
centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for v in obj.data.vertices:
    v.co = (obj.matrix_world @ v.co - centre) * s
obj.matrix_world.identity()
obj.data.update()

# Merge duplicate vertices from the Sketchfab export, then decimate
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
bm.to_mesh(obj.data)
bm.free()
dec = obj.modifiers.new("dec", "DECIMATE")
dec.ratio = DECIMATE_RATIO
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.ops.object.shade_auto_smooth(angle=0.6) if hasattr(bpy.ops.object, "shade_auto_smooth") else None

# 3) UV unwrap for the AO bake
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# 4) Bake ambient occlusion (Cycles, CPU)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 384
img_ao = bpy.data.images.new("charminar_ao", TEX, TEX, alpha=False)
mat = bpy.data.materials.new("Charminar_Limestone")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
tex_node = nt.nodes.new("ShaderNodeTexImage")
tex_node.image = img_ao
nt.nodes.active = tex_node
obj.data.materials.clear()
obj.data.materials.append(mat)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.bake(type="AO", margin=4)

# 5) Weathering layer: AO (contact shadows) x patchy grime (procedural noise, baked as emission) -> greyscale map.
#    The game multiplies this over a tiling photo-scanned stone/plaster PBR material (see Beauty.ts).
noise_mat = bpy.data.materials.new("Grime"); noise_mat.use_nodes = True
gt = noise_mat.node_tree
for n in list(gt.nodes):
    if n.type != "OUTPUT_MATERIAL":
        gt.nodes.remove(n)
outn = [n for n in gt.nodes if n.type == "OUTPUT_MATERIAL"][0]
coord = gt.nodes.new("ShaderNodeTexCoord")
big = gt.nodes.new("ShaderNodeTexNoise"); big.inputs["Scale"].default_value = 0.18; big.inputs["Detail"].default_value = 6
streak = gt.nodes.new("ShaderNodeTexNoise"); streak.inputs["Scale"].default_value = 0.6; streak.inputs["Detail"].default_value = 3
mapping = gt.nodes.new("ShaderNodeMapping"); mapping.inputs["Scale"].default_value = (6.0, 6.0, 0.35)  # vertical rain streaks
gt.links.new(coord.outputs["Object"], big.inputs["Vector"])
gt.links.new(coord.outputs["Object"], mapping.inputs["Vector"]); gt.links.new(mapping.outputs["Vector"], streak.inputs["Vector"])
ramp1 = gt.nodes.new("ShaderNodeValToRGB"); ramp1.color_ramp.elements[0].position = 0.42; ramp1.color_ramp.elements[1].position = 0.68
ramp1.color_ramp.elements[0].color = (0.62, 0.62, 0.62, 1); ramp1.color_ramp.elements[1].color = (1, 1, 1, 1)
ramp2 = gt.nodes.new("ShaderNodeValToRGB"); ramp2.color_ramp.elements[0].position = 0.35; ramp2.color_ramp.elements[1].position = 0.6
ramp2.color_ramp.elements[0].color = (0.78, 0.78, 0.78, 1); ramp2.color_ramp.elements[1].color = (1, 1, 1, 1)
gt.links.new(big.outputs["Fac"], ramp1.inputs["Fac"]); gt.links.new(streak.outputs["Fac"], ramp2.inputs["Fac"])
mul = gt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
gt.links.new(ramp1.outputs["Color"], mul.inputs[6]); gt.links.new(ramp2.outputs["Color"], mul.inputs[7])
emit = gt.nodes.new("ShaderNodeEmission"); gt.links.new(mul.outputs[2], emit.inputs["Color"]); gt.links.new(emit.outputs["Emission"], outn.inputs["Surface"])
img_grime = bpy.data.images.new("charminar_grime", TEX, TEX, alpha=False)
gtex = gt.nodes.new("ShaderNodeTexImage"); gtex.image = img_grime; gt.nodes.active = gtex
obj.data.materials[0] = noise_mat
scene.cycles.samples = 4
bpy.ops.object.bake(type="EMIT", margin=4)
obj.data.materials[0] = mat

img_final = bpy.data.images.new("charminar_weathering", TEX, TEX, alpha=False)
ao = list(img_ao.pixels); gr = list(img_grime.pixels)
out = [0.0] * len(ao)
for i in range(0, len(ao), 4):
    k = (0.22 + 0.78 * ao[i]) * gr[i]
    out[i] = out[i + 1] = out[i + 2] = k
    out[i + 3] = 1.0
img_final.pixels = out
img_final.file_format = "JPEG"
WEATHER_OUT = os.path.join(ROOT, "public/textures/charminar/charminar_weathering_2k.jpg")
os.makedirs(os.path.dirname(WEATHER_OUT), exist_ok=True)
img_final.filepath_raw = WEATHER_OUT
img_final.save()
# Fallback look in the GLB itself (limestone x weathering), in case the game material override isn't applied
tex_node.image = img_final
nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
img_final.pack()

# 5b) Second UV map ("Tiling"): world-space box projection at 1 tile = 2.5 m, for the tiling stone material
import bmesh as _bm
bmx = _bm.new(); bmx.from_mesh(obj.data)
uvl = bmx.loops.layers.uv.new("Tiling")
for f in bmx.faces:
    nrm = f.normal
    ax = max(range(3), key=lambda k: abs(nrm[k]))
    for l in f.loops:
        co = l.vert.co
        if ax == 2: u, v = co.x, co.y
        elif ax == 0: u, v = (co.y if nrm.x > 0 else -co.y), co.z
        else: u, v = (-co.x if nrm.y > 0 else co.x), co.z
        l[uvl].uv = (u / 2.5, v / 2.5)
bmx.to_mesh(obj.data); bmx.free()

# 6) Export + preview + source
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=False,
                          export_image_format="JPEG", export_jpeg_quality=85, export_apply=True)
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
pts = [v.co for v in obj.data.vertices]
dims = [round(max(p[i] for p in pts) - min(p[i] for p in pts), 2) for i in range(3)]
print(f"CHARMINAR_OK tris={tris} dims={dims} scale={s:.3f} size_kb={os.path.getsize(OUT_GLB)//1024}")

# Preview render (Eevee) from a 3/4 view
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = Vector((30, -38, 22))
cam.rotation_euler = (Vector((0, 0, 12)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
scene.collection.objects.link(sun)
sun.rotation_euler = (0.9, 0.2, 0.6)
sun.data.energy = 3.5
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.12, 0.11, 0.16)
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 960, 720
scene.render.filepath = OUT_PREVIEW
bpy.ops.render.render(write_still=True)
os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print("CHARMINAR_DONE")

"""Render contact sheets of the Poly Haven library (materials as tiles, props in a lineup).
Run from idam-jagath/:  blender --background --factory-startup --python tools/assets/library_preview.py
Writes art/library/previews/materials.png and props.png"""
import bpy, os, json, math
from mathutils import Vector
ROOT = os.getcwd(); LIB = os.path.join(ROOT, "art/library/polyhaven"); OUT = os.path.join(ROOT, "art/library/previews")
os.makedirs(OUT, exist_ok=True)
man = json.load(open(os.path.join(LIB, "manifest.json")))

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    hdr = os.path.join(LIB, "hdris/narrow_moonlit_road/narrow_moonlit_road_2k.hdr")
    env = w.node_tree.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(hdr)
    bg = w.node_tree.nodes["Background"]; w.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 3.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
    sun.rotation_euler = (0.85, 0.15, 0.7); sun.data.energy = 3.0
    return sc

def pbr_material(aid):
    d = os.path.join(LIB, "textures", aid); m = bpy.data.materials.new(aid); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    def img(suffix, non_color=False):
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = bpy.data.images.load(os.path.join(d, f"{aid}_{suffix}_2k.jpg"))
        if non_color: n.image.colorspace_settings.name = "Non-Color"
        return n
    nt.links.new(img("diff").outputs["Color"], b.inputs["Base Color"])
    arm = img("arm", True); sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(arm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], b.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(img("nor_gl", True).outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m

def cam_at(sc, loc, target, ortho=None):
    c = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(c); sc.camera = c
    c.location = loc; c.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho: c.data.type = "ORTHO"; c.data.ortho_scale = ortho

# --- materials sheet: 5 x 4 tiles (rounded cubes, lit at grazing angle to show normal maps)
sc = reset(); tex = sorted(k for k, v in man.items() if v["type"] == "textures")
cols = 5
for i, aid in enumerate(tex):
    x, y = (i % cols) * 2.4, -(i // cols) * 2.4
    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, y, 0)); o = bpy.context.active_object
    bev = o.modifiers.new("b", "BEVEL"); bev.width = 0.12; bev.segments = 4
    o.data.materials.append(pbr_material(aid))
    bpy.ops.object.text_add(location=(x - 1, y - 1.25, 1.02)); t = bpy.context.active_object; t.data.body = aid; t.data.size = 0.17
rows = math.ceil(len(tex) / cols)
cam_at(sc, ((cols - 1) * 1.2, -(rows - 1) * 1.2 - 0.4, 14), ((cols - 1) * 1.2, -(rows - 1) * 1.2, 0), ortho=max(cols, rows) * 2.5)
sc.render.resolution_x, sc.render.resolution_y = 1600, 1300; sc.render.filepath = os.path.join(OUT, "materials.png")
bpy.ops.render.render(write_still=True)

# --- props lineup
sc = reset(); props = sorted(k for k, v in man.items() if v["type"] == "models"); x = 0.0; rowx = []; row = 0; y = 0.0
for aid in props:
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(LIB, "models", aid, f"{aid}.gltf"))
    objs = [o for o in bpy.data.objects if o not in before]; meshes = [o for o in objs if o.type == "MESH"]
    if not meshes: continue
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector(map(min, *pts)); mx = Vector(map(max, *pts)); w = max(mx.x - mn.x, 0.3)
    roots = [o for o in objs if o.parent is None]
    if x > 22: x = 0.0; y -= 5.0
    for r in roots: r.location += Vector((x - mn.x, y - (mn.y + mx.y) / 2, -mn.z))
    x += w + 0.6
cam_at(sc, (11, -24, 12), (11, -6, 0.5))
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000; sc.render.filepath = os.path.join(OUT, "props.png")
bpy.ops.render.render(write_still=True)
print("PREVIEWS_OK")

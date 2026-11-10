"""Shared helpers for Idam Jagath asset scripts (run inside Blender 5.x, headless).

Conventions
- Metres, Blender Z-up while modelling; the glTF exporter converts to +Y-up.
- Each asset's origin sits at its bottom centre.
- Flat-coloured Principled materials only (no image textures).
"""
import math
import os
import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "models")
PREVIEWS = os.path.join(HERE, "previews")
SRC = os.path.join(HERE, "src")


# ───────────────────────── scene ─────────────────────────

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for d in (MODELS, PREVIEWS, SRC):
        os.makedirs(d, exist_ok=True)


def hex_rgb(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear (Blender colour sockets are linear)
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


_mats = {}


def mat(name, color, rough=0.8, metal=0.0, emit=None, strength=1.0, alpha=1.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*hex_rgb(emit), 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*hex_rgb(color), alpha)
    _mats[name] = m
    return m


def _link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def _obj_from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    _link(ob)
    if material:
        me.materials.append(material)
    return ob


# ───────────────────────── primitives ─────────────────────────

def box(name, sx, sy, sz, loc=(0, 0, 0), material=None, rot=(0, 0, 0)):
    """Box of size (sx, sy, sz) whose BOTTOM centre is at loc."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, sz / 2), verts=bm.verts)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def box_minmax(name, x1, x2, y1, y2, z1, z2, material=None):
    return box(name, x2 - x1, y2 - y1, z2 - z1, ((x1 + x2) / 2, (y1 + y2) / 2, z1), material)


def cyl(name, r, h, loc=(0, 0, 0), seg=12, material=None, r_top=None, rot=(0, 0, 0)):
    """Cylinder/cone standing on loc (bottom centre)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r, radius2=r if r_top is None else r_top, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def lathe(name, profile, seg=12, loc=(0, 0, 0), material=None, close_top=True):
    """Revolve a (radius, z) profile around Z. First/last points with r=0 close the ends."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        n = 1 if r <= 1e-6 else seg
        for i in range(n):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(seg):
                bm.faces.new((a[0], b[i], b[(i + 1) % seg]))
        elif len(b) == 1:
            for i in range(seg):
                bm.faces.new((a[i], b[0], a[(i + 1) % seg])[::-1])
        else:
            for i in range(seg):
                bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    if len(rings[0]) > 1:
        bm.faces.new(rings[0][::-1])
    if close_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    return ob


def prism(name, pts_xz, depth, material=None, loc=(0, 0, 0), rot_z=0.0):
    """Extrude a closed 2D polygon given in the XZ plane along Y (centred on y=0)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts_xz]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts_xz]
    n = len(pts_xz)
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return ob


def ico(name, r, loc=(0, 0, 0), material=None, subdiv=1, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    ob.scale = scale
    return ob


def torus(name, R, r, loc=(0, 0, 0), material=None, seg=12, minor=6, rot=(0, 0, 0)):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = Vector((R * math.cos(a), R * math.sin(a), 0))
        ring = []
        for j in range(minor):
            b = 2 * math.pi * j / minor
            d = Vector((math.cos(a), math.sin(a), 0)) * (r * math.cos(b)) + Vector((0, 0, r * math.sin(b)))
            ring.append(bm.verts.new(c + d))
        rings.append(ring)
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for j in range(minor):
            k = (j + 1) % minor
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def tube(name, points, radius, material=None, sides=6, taper_end=None):
    """Polyline tube (via a curve with bevel), converted to a mesh. taper_end: radius at the last point."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = max(0, sides // 4 - 1)
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
        if taper_end is not None:
            t = i / max(1, len(points) - 1)
            sp.points[i].radius = 1 + (taper_end / radius - 1) * t
    ob = bpy.data.objects.new(name, cu)
    _link(ob)
    if material:
        cu.materials.append(material)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def quad_uv(name, w, h, loc=(0, 0, 0), material=None):
    """Upright quad facing -Y (towards the viewer of a front view), UV-mapped 0..1. loc = bottom centre."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new(p) for p in ((-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h))]
    f = bm.faces.new(vs)
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
    ob = _obj_from_bm(name, bm, material)
    ob.location = loc
    return ob


def parent(child, par):
    """Parent without moving the child: the local transform becomes relative to the parent."""
    bpy.context.view_layer.update()
    m = child.matrix_world.copy()
    child.parent = par
    child.matrix_parent_inverse.identity()
    child.matrix_basis = par.matrix_world.inverted() @ m


# ───────────────────────── object utilities ─────────────────────────

def join(name, objs):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def apply_all(objs=None):
    objs = objs or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def set_origin(ob, point):
    """Move ob's origin to world `point` without moving its geometry."""
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = (0, 0, 0)


def smooth_by_angle(objs=None, deg=35.0):
    """Smooth shading with hard edges above `deg`: boxes stay crisp, round parts look round.
    Also shrinks the .glb (fewer split vertices than fully flat shading)."""
    lim = math.radians(deg)
    for o in objs or mesh_objects():
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if not e.is_manifold or e.calc_face_angle(math.pi) > lim:
                e.smooth = False
        bm.to_mesh(o.data)
        bm.free()


def shade_flat(objs=None):
    for o in objs or bpy.context.scene.objects:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = False


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def bbox(objs=None):
    objs = objs or mesh_objects()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def tri_count(objs=None):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs or mesh_objects():
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def drop_to_ground(objs=None):
    """Translate everything so the lowest point sits at z = 0 and the XY bbox centre at the origin."""
    objs = objs or mesh_objects()
    lo, hi = bbox(objs)
    off = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for o in objs:
        if o.parent is None:
            o.location += off


# ───────────────────────── output ─────────────────────────

def export_glb(name, objs=None, uvs=False):
    objs = objs or mesh_objects()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=uvs, export_materials="EXPORT",
        export_cameras=False, export_lights=False,
    )
    return path


def save_blend(name):
    path = os.path.join(SRC, name + ".blend")
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


def report(name, objs=None):
    objs = objs or mesh_objects()
    lo, hi = bbox(objs)
    size = os.path.getsize(os.path.join(MODELS, name + ".glb"))
    dims = hi - lo
    print(f"ASSET {name}: dims {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m (x,y,z Blender) | "
          f"bbox z {lo.z:.2f}..{hi.z:.2f} | tris {tri_count(objs)} | glb {size / 1024:.1f} KB")
    print("OBJECTS", name, sorted(o.name for o in objs))


def render_preview(filename, cam_loc, target, lens=35, res=(960, 540), sun_dir=(-0.6, -0.4, -0.7), world="#1b1a22",
                   extra_light=True):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    # world
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*hex_rgb(world), 1)
    bg.inputs[1].default_value = 1.0
    # camera
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam_data.clip_end = 500
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = cam_loc
    direction = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    # lights
    sun_d = bpy.data.lights.new("PreviewSun", "SUN")
    sun_d.energy = 3.0
    sun_d.angle = math.radians(8)
    sun = bpy.data.objects.new("PreviewSun", sun_d)
    sc.collection.objects.link(sun)
    sun.rotation_euler = Vector(sun_dir).to_track_quat("-Z", "Y").to_euler()
    made = [cam, sun]
    if extra_light:
        fill_d = bpy.data.lights.new("PreviewFill", "SUN")
        fill_d.energy = 0.8
        fill_d.color = (0.6, 0.65, 1.0)
        fill = bpy.data.objects.new("PreviewFill", fill_d)
        sc.collection.objects.link(fill)
        fill.rotation_euler = Vector((0.5, 0.6, -0.3)).to_track_quat("-Z", "Y").to_euler()
        made.append(fill)
    path = os.path.join(PREVIEWS, filename + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # remove preview-only objects so they never end up in .blend/.glb
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    print("PREVIEW", path)
    return path

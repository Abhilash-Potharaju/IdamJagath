"""Build the Level 1 shell (gray-box blocks) as a portable Blender scene + glTF.

Source of truth: data/level/level1.json  (blocks[]).  Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/build_level.py
Outputs:
  tools/blender/src/level1.blend          (generated: rebuild instead of hand-editing block positions)
  public/models/level/level1.glb          (loaded by src/game/Level.ts)

Conventions (see docs/LEVEL_PIPELINE.md):
  * Coordinates: the GLB's glTF coordinates ARE game coordinates (metres, +Y up, +Z north). The glTF exporter
    maps Blender (X, Y, Z) -> glTF (X, Z, -Y), so a game point (x, y, z) is placed at Blender (x, -z, y).
  * One object per block, origin at the block centre (glTF node translation = block centre, like the game's
    mesh.position). Custom properties exported as glTF extras: block_index, block_name, block_id, block_shape.
  * Render meshes live in collection Level_Visual; collision primitives COL_<name> in Level_Colliders
    (boxes; cylinders get an 8-sided prism). Engines that import "COL_" meshes as colliders can use them directly.
  * Material slot per block colour: "color_<hex>" with that base colour (the game assigns its own PBR materials).
  * UV0 "UVMap": world-scale box projection, 1 UV unit = 1 m, same axes as the game's tileUVs().
    UV1 "LightmapUV": non-overlapping per-object unwrap for a future Cycles lightmap bake.
  * Scene extra "source_hash": hash of the block geometry fields; the game falls back to building blocks from the
    JSON if the GLB is stale (JSON wins).
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = os.getcwd()
SRC = os.path.join(ROOT, "data/level/level1.json")
OUT_GLB = os.path.join(ROOT, "public/models/level/level1.glb")
OUT_BLEND = os.path.join(ROOT, "tools/blender/src/level1.blend")


def g2b(x, y, z):
    """Game/glTF coordinates -> Blender coordinates."""
    return Vector((x, -z, y))


# ── geometry hash (must match levelGeometryHash() in src/data/level.ts) ──
def mm(v):
    return int(math.floor(v * 1000 + 0.5))


def block_hash(blocks):
    parts = []
    for b in blocks:
        nums = []
        for k in ("min", "max", "center", "size"):
            if k in b:
                nums += [mm(v) for v in b[k]]
        for k in ("diameter", "height", "segments"):
            if k in b:
                nums.append(mm(b[k]))
        parts.append(b["name"] + "|" + b["shape"] + "|" + ",".join(str(n) for n in nums))
    s = ";".join(parts)
    h = 0x811C9DC5
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def material(hexcol, cache={}):
    key = hexcol.lower()
    if key not in cache:
        m = bpy.data.materials.new("color_" + key.lstrip("#"))
        m.use_nodes = True
        c = tuple(int(key[i:i + 2], 16) / 255 for i in (1, 3, 5))
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1)
        m.diffuse_color = (*c, 1)
        cache[key] = m
    return cache[key]


def world_uvs(obj):
    """UV0: world-scale box projection in game axes (mirrors tileUVs() with tile = 1 m)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    loc = obj.location
    for f in bm.faces:
        n = f.normal  # Blender axes
        nx, ny, nz = n.x, n.z, -n.y  # -> game axes
        for l in f.loops:
            co = l.vert.co + loc
            x, y, z = co.x, co.z, -co.y
            if abs(ny) > 0.5:
                u, v = x, z
            elif abs(nx) > abs(nz):
                u, v = (-z if nx > 0 else z), y
            else:
                u, v = (x if nz > 0 else -x), y
            l[uv].uv = (u, v)
    bm.to_mesh(me)
    bm.free()


def lightmap_uvs(obj):
    me = obj.data
    if "LightmapUV" not in me.uv_layers:
        me.uv_layers.new(name="LightmapUV")
    me.uv_layers.active = me.uv_layers["LightmapUV"]
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active = me.uv_layers["UVMap"]
    me.uv_layers["UVMap"].active_render = True


def new_object(name, mesh, coll, loc):
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    obj.location = loc
    return obj


def box_mesh(name, dx, dy, dz):
    """Axis-aligned box centred on the origin, Blender extents (dx, dy, dz)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dx, v.co.y * dy, v.co.z * dz))
    bm.to_mesh(me)
    bm.free()
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    return me


def plane_mesh(name, dx, dy):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * dx, v.co.y * dy, 0))
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.new(name="UVMap")
    return me


def cylinder_mesh(name, radius, depth, segments):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.new(name="UVMap")
    for p in me.polygons:  # smooth sides, flat caps (like the game's cylinder)
        p.use_smooth = abs(p.normal.z) < 0.5
    return me


def main():
    data = json.load(open(SRC))
    blocks = data["blocks"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    vis = bpy.data.collections.new("Level_Visual")
    col = bpy.data.collections.new("Level_Colliders")
    sc.collection.children.link(vis)
    sc.collection.children.link(col)

    for i, b in enumerate(blocks):
        shape = b["shape"]
        name = b["name"]
        if shape in ("box", "slab"):
            mn, mx = b["min"], b["max"]
            dx, dy, dz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
            c = [(mn[k] + mx[k]) / 2 for k in range(3)]
            if shape == "box":
                me = box_mesh(name, dx, dz, dy)
                loc = g2b(*c)
            else:  # slab: a horizontal plane at min y
                me = plane_mesh(name, dx, dz)
                loc = g2b(c[0], mn[1], c[2])
            col_dims, col_c = (dx, max(dy, 0.02), dz), (c[0], c[1] if shape == "box" else mn[1], c[2])
        elif shape == "ground":
            cx, cy, cz = b["center"]
            w, d = b["size"]
            me = plane_mesh(name, w, d)
            loc = g2b(cx, cy, cz)
            col_dims, col_c = (w, 0.02, d), (cx, cy, cz)
        else:  # cylinder (axis = game +Y)
            cx, cy, cz = b["center"]
            me = cylinder_mesh(name, b["diameter"] / 2, b["height"], b.get("segments", 12))
            loc = g2b(cx, cy, cz)
            col_dims, col_c = (b["diameter"], b["height"], b["diameter"]), (cx, cy, cz)

        me.materials.append(material(b["color"]))
        obj = new_object(name, me, vis, loc)
        obj["block_index"] = i
        obj["block_name"] = name
        obj["block_shape"] = shape
        if b.get("id"):
            obj["block_id"] = b["id"]
        world_uvs(obj)
        lightmap_uvs(obj)

        # Collision primitive
        if shape == "cylinder":
            cme = cylinder_mesh("COL_" + name, b["diameter"] / 2, b["height"], 8)
        else:
            gx, gy, gz = col_dims
            cme = box_mesh("COL_" + name, gx, gz, gy)
        cobj = new_object("COL_" + name, cme, col, g2b(*col_c))
        cobj["collider_for"] = i
        cobj.display_type = "WIRE"
        cobj.hide_render = True

    sc["source_hash"] = block_hash(blocks)
    sc["source"] = "data/level/level1.json"
    sc["block_count"] = len(blocks)

    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False)
    print(f"LEVEL_OK blocks={len(blocks)} hash={sc['source_hash']} kb={os.path.getsize(OUT_GLB) // 1024}")


main()

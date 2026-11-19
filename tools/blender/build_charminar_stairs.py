"""Spiral staircase inside the Charminar's south-west leg (procedural, in-house).

Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/build_charminar_stairs.py
Output: public/models/charminar_stairs.glb   (placed like the Charminar at game (0, 0, 86), yaw 0)
        tools/blender/src/charminar_stairs.blend

Matches the door + shaft cut in import_charminar_skfb.py (shaft centre (-6.97, 6.97) Blender = game (-6.97, 79.03),
radius 1.9, roof at 20.58 m). Contents:
  Visual:  StairSteps (stone wedge steps, 0.18 m rise), StairColumn, DoorFrame, HatchRail
  Collision (invisible in game, industry-standard proxies):
    COL_StairRamp   smooth helical ramp solid (walk surface; no snagging on step edges)
    COL_StairColumn central column
    COL_ShaftRing   ring wall just outside the stair (door gap) so you can't fall into the shaft's corners
    COL_HatchRail   railing around the roof hatch (gap where the stair arrives)
Blender coords: +Z up, game south = +Y.
"""
import math
import os

import bmesh
import bpy

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "public/models/charminar_stairs.glb")
BLEND = os.path.join(ROOT, "tools/blender/src/charminar_stairs.blend")

CX, CY = -6.97, 6.97     # shaft centre
ROOF = 20.58             # roof terrace height
PITCH = 3.2              # rise per full turn: 6.4 turns to the roof (was 2.75 / 7.5); headroom 3.0 m under the turn above
R_IN, R_OUT = 0.18, 1.86 # walkable band: out to the shaft wall (was 0.3-1.75). The shaft can't grow: above ~10 m the
                         # leg's outer skin is only ~2.0-2.1 m from the shaft centre, a wider cut would hole the monument
COL_R = 0.14             # central newel radius (was 0.25)
SHAFT_R = 1.9
STEP_RISE = 0.18
THICK = 0.2
START = math.pi / 2      # ramp starts on the door side (+Y = game south) and climbs counter-clockwise
TURNS = ROOF / PITCH
TOTAL = TURNS * 2 * math.pi

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


STONE = mat("StairStone", (0.55, 0.47, 0.38))
DARK = mat("StairStoneDark", (0.33, 0.28, 0.23))


def obj_from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material:
        me.materials.append(material)
    return o


def pt(r, a, z):
    return (CX + r * math.cos(a), CY + r * math.sin(a), z)


def height(a):
    return (a - START) / (2 * math.pi) * PITCH


# ── Collision ramp: a closed helical solid (top = walk surface) ──
bm = bmesh.new()
N = int(TURNS * 64)
rows = []
for i in range(N + 1):
    a = START + TOTAL * i / N
    h = min(ROOF, height(a))
    rows.append([bm.verts.new(pt(R_IN, a, h)), bm.verts.new(pt(R_OUT, a, h)),
                 bm.verts.new(pt(R_OUT, a, h - THICK)), bm.verts.new(pt(R_IN, a, h - THICK))])
for i in range(N):
    a, b = rows[i], rows[i + 1]
    for k in range(4):
        bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
bm.faces.new(rows[0][::-1])
bm.faces.new(rows[-1])
obj_from_bm("COL_StairRamp", bm)

# ── Visual steps: stone wedges at 0.18 m rise ──
bm = bmesh.new()
nsteps = int(ROOF / STEP_RISE)
da = 2 * math.pi * STEP_RISE / PITCH
for s in range(nsteps):
    a0 = START + s * da
    a1 = a0 + da * 1.04
    top = min(ROOF, (s + 1) * STEP_RISE)
    bot = top - STEP_RISE - 0.12
    v = [bm.verts.new(pt(r, a, z)) for z in (bot, top) for a in (a0, a1) for r in (COL_R, R_OUT + 0.05)]
    # v index: z(bot,top) * 4 + a(a0,a1) * 2 + r(in,out)
    q = lambda zi, ai, ri: v[zi * 4 + ai * 2 + ri]
    bm.faces.new((q(1, 0, 0), q(1, 0, 1), q(1, 1, 1), q(1, 1, 0)))   # tread
    bm.faces.new((q(0, 0, 0), q(0, 1, 0), q(0, 1, 1), q(0, 0, 1)))   # underside
    bm.faces.new((q(0, 0, 0), q(0, 0, 1), q(1, 0, 1), q(1, 0, 0)))   # riser (front)
    bm.faces.new((q(0, 1, 0), q(1, 1, 0), q(1, 1, 1), q(0, 1, 1)))   # back
    bm.faces.new((q(0, 0, 1), q(0, 1, 1), q(1, 1, 1), q(1, 0, 1)))   # outer end
    bm.faces.new((q(0, 0, 0), q(1, 0, 0), q(1, 1, 0), q(0, 1, 0)))   # inner end
obj_from_bm("StairSteps", bm, STONE)

# ── Central column (visual + collider) ──
for name, material in (("StairColumn", DARK), ("COL_StairColumn", None)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=COL_R, depth=ROOF + 1.0, location=(CX, CY, (ROOF + 1.0) / 2))
    o = bpy.context.active_object
    o.name = name
    if material:
        o.data.materials.append(material)


# ── Ring wall collider just outside the stair, with a gap at the door (game south, +Y) ──
def ring(name, r0, r1, z0, z1, gap_from, gap_to, segs=36):
    bm = bmesh.new()
    for i in range(segs):
        a0 = 2 * math.pi * i / segs
        a1 = 2 * math.pi * (i + 1) / segs
        mid = (a0 + a1) / 2
        d = (mid - gap_from) % (2 * math.pi)
        if d < (gap_to - gap_from) % (2 * math.pi):
            continue
        v = [bm.verts.new(pt(r, a, z)) for z in (z0, z1) for a in (a0, a1) for r in (r0, r1)]
        q = lambda zi, ai, ri: v[zi * 4 + ai * 2 + ri]
        for f in ((0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0), (1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1)):
            pass
        bm.faces.new((q(1, 0, 0), q(1, 0, 1), q(1, 1, 1), q(1, 1, 0)))
        bm.faces.new((q(0, 0, 0), q(0, 1, 0), q(0, 1, 1), q(0, 0, 1)))
        bm.faces.new((q(0, 0, 0), q(0, 0, 1), q(1, 0, 1), q(1, 0, 0)))
        bm.faces.new((q(0, 1, 0), q(1, 1, 0), q(1, 1, 1), q(0, 1, 1)))
        bm.faces.new((q(0, 0, 1), q(0, 1, 1), q(1, 1, 1), q(1, 0, 1)))
        bm.faces.new((q(0, 0, 0), q(1, 0, 0), q(1, 1, 0), q(0, 1, 0)))
    return bm


door_gap = math.radians(32)
obj_from_bm("COL_ShaftRing", ring("COL_ShaftRing", SHAFT_R - 0.03, SHAFT_R + 0.35, 0, 2.6, START - door_gap, START + door_gap))
bm_upper = ring("COL_ShaftRingUpper", SHAFT_R - 0.03, SHAFT_R + 0.35, 2.6, ROOF, 0, 0)
obj_from_bm("COL_ShaftRingUpper", bm_upper)

# ── Railing round the roof hatch, leaving an exit where the stair arrives ──
end_a = (START + TOTAL) % (2 * math.pi)
exit_from, exit_to = end_a - math.radians(10), end_a + math.radians(70)
for name, material, r0, r1 in (("HatchRail", STONE, SHAFT_R + 0.02, SHAFT_R + 0.22), ("COL_HatchRail", None, SHAFT_R + 0.02, SHAFT_R + 0.25)):
    o = obj_from_bm(name, ring(name, r0, r1, ROOF, ROOF + 1.0, exit_from, exit_to, segs=40), material)

# ── Door frame: a simple stone surround on the leg's south face (y = 9.34) to hide the cut edges ──
bm = bmesh.new()
FY, DW, DH = 9.34, 1.4, 2.5
def slab(x0, x1, y0, y1, z0, z1):
    v = [bm.verts.new((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([v[i] for i in f])
slab(CX - DW / 2 - 0.3, CX - DW / 2, FY - 0.05, FY + 0.25, 0, DH + 0.3)      # left jamb
slab(CX + DW / 2, CX + DW / 2 + 0.3, FY - 0.05, FY + 0.25, 0, DH + 0.3)      # right jamb
slab(CX - DW / 2 - 0.3, CX + DW / 2 + 0.3, FY - 0.05, FY + 0.3, DH, DH + 0.45)  # lintel
obj_from_bm("DoorFrame", bm, STONE)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True)
os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print(f"STAIRS_OK turns={TURNS:.2f} steps={nsteps} end_angle_deg={math.degrees(end_a):.0f} kb={os.path.getsize(OUT)//1024}")

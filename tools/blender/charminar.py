"""Charminar (Hyderabad), low-poly, matching the Level 1 gray-box footprint.

Run:  blender --background --factory-startup --python tools/blender/charminar.py

Footprint (Blender coords, Z up; origin = ground centre):
  base 16 x 16 m, corner pillars 5 x 5 m (x,y in ±[3, 8]), 6 m arched openings on all four sides,
  main roof slab 12-14 m, upper storey 12 x 12 m at 14-18 m, minaret centres at (±7.5, ±7.5), ~35 m tall.

Axis mapping after glTF export + Babylon import (Babylon's loader adds a 180° Y-rotation and Z flip):
  Babylon (x, y, z) = (-x_blender, z_blender, -y_blender)
  => game NORTH (+Z) = Blender -Y, game SOUTH (-Z) = Blender +Y, game EAST (+X) = Blender -X.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.reset()
random.seed(7)

LIME = C.mat("Lime", "#c9b8a0", rough=0.85)
TRIM = C.mat("LimeTrim", "#a8987f", rough=0.85)
DARK = C.mat("NicheShadow", "#3d332b", rough=1.0)
DIAL = C.mat("ClockDial", "#ece6d6", rough=0.6)
IRON = C.mat("ClockIron", "#2a241f", rough=0.5, metal=0.6)
FLESH = C.mat("AlienFlesh", "#1c0b26", rough=0.45, emit="#b14dff", strength=0.35)
GLOW = C.mat("AlienGlow", "#b14dff", rough=0.3, emit="#b14dff", strength=4.0)

parts = []

# ───────── pillars (+ plinths and trim bands) ─────────
for sx in (-1, 1):
    for sy in (-1, 1):
        cx, cy = sx * 5.5, sy * 5.5
        parts.append(C.box("pillar", 5, 5, 12, (cx, cy, 0), LIME))
        parts.append(C.box("plinth", 5.4, 5.4, 0.5, (cx, cy, 0), TRIM))
        for z in (5.3, 11.4):
            parts.append(C.box("band", 5.15, 5.15, 0.25, (cx, cy, z), TRIM))


# ───────── pointed arches on the four faces ─────────
def pointed_arch_pts(half_w, spring, top, steps=6):
    """Polygon above a pointed (equilateral) arch spanning x in [-half_w, half_w]: the spandrel wall."""
    R = 2 * half_w
    left = [(half_w - R * math.cos(t), spring + R * math.sin(t))
            for t in [math.radians(60) * i / steps for i in range(steps + 1)]]
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return [(-half_w, top)] + left + right + [(half_w, top)]


def arch_outline(half_w, spring, steps=8):
    R = 2 * half_w
    left = [(half_w - R * math.cos(t), spring + R * math.sin(t))
            for t in [math.radians(60) * i / steps for i in range(steps + 1)]]
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return [(-half_w, 0.6)] + left + right + [(half_w, 0.6)]


SPRING = 5.5
for k in range(4):  # 0: +Y (game south), 1: -X, 2: -Y, 3: +X
    ang = k * math.pi / 2
    wall = C.prism("spandrel", pointed_arch_pts(3.0, SPRING, 12.0), 5.0, LIME)
    # prism is centred on y=0 and spans y ±2.5; move it to y in [3, 8] then rotate about Z
    wall.location = (-5.5 * math.sin(ang), 5.5 * math.cos(ang), 0)  # rotate the offset about the building centre
    wall.rotation_euler = (0, 0, ang)
    parts.append(wall)
    # darker moulding that traces the arch on the outer face
    pts = [(x, 8.06, z) for x, z in arch_outline(3.0, SPRING)]
    rim = C.tube("archRim", pts, 0.14, TRIM, sides=4)
    rim.rotation_euler = (0, 0, ang)
    parts.append(rim)
    # clock dial on the roof-slab face above each arch
    dial = C.cyl("dial", 0.75, 0.08, (0, 0, 0), seg=16, material=DIAL, rot=(math.pi / 2, 0, 0))
    dial.location = (0, 8.1, 12.85)
    ring = C.cyl("dialRim", 0.86, 0.05, (0, 0, 0), seg=16, material=IRON, rot=(math.pi / 2, 0, 0))
    ring.location = (0, 8.05, 12.85)
    h1 = C.box("hand", 0.07, 0.03, 0.55, (0, 8.16, 12.85), IRON)
    h2 = C.box("hand", 0.07, 0.03, 0.4, (0, 8.16, 12.85), IRON, rot=(0, math.radians(115), 0))
    for o in (dial, ring, h1, h2):
        o.location.rotate(__import__("mathutils").Euler((0, 0, ang)))
        o.rotation_euler.z += ang
        parts.append(o)

# ───────── roof slab, cornice, parapet ─────────
parts.append(C.box("roofSlab", 16, 16, 1.6, (0, 0, 12), LIME))
parts.append(C.box("cornice", 16.6, 16.6, 0.4, (0, 0, 13.6), TRIM))


def parapet(half, z, h=0.6, thick=0.3, tooth=0.5, gap=0.75, mat=LIME):
    out = []
    L = 2 * half
    for k in range(4):
        ang = k * math.pi / 2
        w = C.box("parapet", L, thick, h, (0, half - thick / 2, z), mat)
        w.location.rotate(__import__("mathutils").Euler((0, 0, ang)))
        w.rotation_euler.z = ang
        out.append(w)
        n = int(L / (tooth + gap))
        for i in range(n):
            x = -half + (i + 0.5) * (tooth + gap)
            t = C.box("merlon", tooth, thick, 0.35, (x, half - thick / 2, z + h), mat)
            t.location.rotate(__import__("mathutils").Euler((0, 0, ang)))
            t.rotation_euler.z = ang
            out.append(t)
    return out


parts += parapet(8.0, 14.0)

# ───────── upper storey with arched niches ─────────
parts.append(C.box("upperStorey", 12, 12, 3.6, (0, 0, 14), LIME))
parts.append(C.box("upperCornice", 12.5, 12.5, 0.35, (0, 0, 17.6), TRIM))
parts += parapet(6.25, 17.95, h=0.4, tooth=0.4, gap=0.6)
for k in range(4):
    ang = k * math.pi / 2
    for i in range(5):
        x = -4.8 + i * 2.4
        outline = arch_outline(0.7, 1.5, steps=4)  # starts (-0.7, 0.6) ... ends (0.7, 0.6)
        outline = [(-0.7, 0.0)] + outline[1:-1] + [(0.7, 0.0)]
        niche = C.prism("niche", [(px + x, pz) for px, pz in outline], 0.08, DARK)
        niche.location = (0, 6.02, 14.6)
        niche.location.rotate(__import__("mathutils").Euler((0, 0, ang)))
        niche.rotation_euler.z = ang
        parts.append(niche)

# small mosque dome on the west side of the roof (game west = Blender +X)
parts.append(C.cyl("domeDrum", 1.7, 0.8, (2.8, 0, 18.3), seg=12, material=LIME))
parts.append(C.lathe("mosqueDome", [(1.75, 0), (1.85, 0.5), (1.6, 1.2), (1.0, 1.8), (0.35, 2.15), (0, 2.25)],
                     seg=12, loc=(2.8, 0, 19.1), material=LIME))
parts.append(C.cyl("domeFinial", 0.06, 0.8, (2.8, 0, 21.3), seg=4, material=IRON))

# ───────── minarets ─────────
TIERS = [  # (z0, z1, radius)
    (0.0, 20.0, 1.3),
    (20.35, 26.0, 1.12),
    (26.35, 30.0, 0.96),
]


def minaret(cx, cy):
    out = []
    for z0, z1, r in TIERS:
        out.append(C.cyl("shaft", r, z1 - z0, (cx, cy, z0), seg=12, material=LIME))
        for zb in [z for z in (8.0, 16.5, 23.5, 28.3) if z0 + 0.5 < z < z1 - 0.5]:
            out.append(C.cyl("shaftBand", r + 0.06, 0.25, (cx, cy, zb), seg=12, material=TRIM))
    for z, r_in in ((20.0, 1.3), (26.0, 1.12), (30.0, 0.96)):
        R = r_in + 0.6
        out.append(C.cyl("corbel", r_in, 0.6, (cx, cy, z - 0.6), seg=12, material=TRIM, r_top=R))
        out.append(C.cyl("balcony", R, 0.35, (cx, cy, z), seg=12, material=LIME))
        out.append(C.torus("railing", R - 0.08, 0.07, (cx, cy, z + 0.85), TRIM, seg=12, minor=3))
        out.append(C.cyl("balconyWall", R - 0.05, 0.45, (cx, cy, z + 0.35), seg=12, material=LIME, r_top=R - 0.05))
    out.append(C.cyl("lantern", 0.75, 1.3, (cx, cy, 30.35), seg=12, material=LIME))
    for i in range(6):
        a = 2 * math.pi * i / 6
        out.append(C.box("lanternOpening", 0.35, 0.05, 0.8, (cx + 0.74 * math.cos(a), cy + 0.74 * math.sin(a), 30.6),
                         DARK, rot=(0, 0, a + math.pi / 2)))
    out.append(C.lathe("onionDome", [(0.8, 0), (1.05, 0.35), (1.08, 0.75), (0.85, 1.25), (0.45, 1.75), (0.15, 2.15), (0, 2.4)],
                       seg=12, loc=(cx, cy, 31.65), material=LIME))
    out.append(C.cyl("finial", 0.07, 1.0, (cx, cy, 34.0), seg=4, material=IRON))
    out.append(C.ico("finialBall", 0.14, (cx, cy, 34.35), IRON, subdiv=1))
    return out


for sx in (-1, 1):
    for sy in (-1, 1):
        parts += minaret(sx * 7.5, sy * 7.5)

C.apply_all(parts)
structure = C.join("Charminar_Structure", parts)
C.set_origin(structure, (0, 0, 0))


# ───────── alien occupation layer (toggleable) ─────────
def shaft_radius(z):
    for z0, z1, r in TIERS:
        if z <= z1 + 0.2:
            return r
    return 0.8


def jitter(a):
    return (random.random() - 0.5) * a


def growth_on_minaret(name, cx, cy, top, strands=4):
    objs = []
    for s in range(strands):
        phase = 2 * math.pi * s / strands + jitter(0.6)
        turns = 1.3 + random.random() * 0.8
        z_end = top * (0.75 + random.random() * 0.25)
        pts = []
        # roots creeping along the ground towards the minaret
        a0 = phase + 0.6
        for i in range(3):
            d = 2.9 - i * 0.6
            pts.append((cx + d * math.cos(a0) + jitter(0.3), cy + d * math.sin(a0) + jitter(0.3), 0.12))
        n = 22
        for i in range(n + 1):
            t = i / n
            z = 0.2 + t * z_end
            a = phase + t * turns * 2 * math.pi
            r = shaft_radius(z) + 0.18 + jitter(0.12)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
        objs.append(C.tube(f"{name}_strand", pts, 0.22 - 0.03 * s, FLESH, sides=6, taper_end=0.04))
        # glowing pustules along the strand
        for p in random.sample(pts[4:], 5):
            objs.append(C.ico("pustule", 0.22 + random.random() * 0.2, p, GLOW, subdiv=1))
    # a fleshy collar where the growth erupts from the base
    for i in range(6):
        a = random.random() * 2 * math.pi
        objs.append(C.ico("blob", 0.5 + random.random() * 0.4,
                          (cx + 1.6 * math.cos(a), cy + 1.6 * math.sin(a), 0.25), FLESH, subdiv=1, scale=(1.2, 1.2, 0.6)))
    C.apply_all(objs)
    ob = C.join(name, objs)
    C.set_origin(ob, (0, 0, 0))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


g_sw = growth_on_minaret("Alien_Growth_Minaret_SW", 7.5, 7.5, top=26.0)   # game SW = Blender (+x, +y)
g_ne = growth_on_minaret("Alien_Growth_Minaret_NE", -7.5, -7.5, top=31.0)  # game NE = Blender (-x, -y)

# Growth over the SOUTH arch (Blender +Y face), the one players see first when entering the plaza.
objs = []
FACE_Y = 8.25
for side in (-1, 1):
    for k in range(3):
        x0 = side * (3.4 + k * 0.7)
        pts = [(x0 + jitter(0.2), FACE_Y + 0.6, 0.1), (x0 + jitter(0.2), FACE_Y + 0.15, 1.0)]
        for i in range(14):
            z = 1.5 + i * 0.9
            pts.append((x0 + side * jitter(0.5) + side * 0.08 * i, FACE_Y + 0.05 + jitter(0.1), z))
        # creep across the arch head towards the apex
        for i in range(5):
            t = (i + 1) / 5
            pts.append((x0 * (1 - t) + side * 0.4 * t, FACE_Y + jitter(0.15), 14.0 + 0.2 * math.sin(t * 3)))
        objs.append(C.tube("archStrand", pts, 0.2 - 0.03 * k, FLESH, sides=6, taper_end=0.05))
        for p in random.sample(pts[2:], 3):
            objs.append(C.ico("pustule", 0.2 + random.random() * 0.18, p, GLOW, subdiv=1))
# tendrils hanging from the arch head (they end well above head height: the passage stays clear)
for i in range(7):
    x = -2.4 + i * 0.8 + jitter(0.2)
    top_z = 10.4 - abs(x) * 0.9
    L = 1.2 + random.random() * 1.6
    pts = [(x, FACE_Y - 0.1, top_z + 0.3)] + [(x + jitter(0.15), FACE_Y - 0.2 - 0.1 * j, top_z - L * j / 4) for j in range(1, 5)]
    objs.append(C.tube("hanging", pts, 0.12, FLESH, sides=4, taper_end=0.02))
    objs.append(C.ico("drip", 0.13, pts[-1], GLOW, subdiv=1))
# a pulsing hive mass at the apex
objs.append(C.ico("hive", 1.0, (0, FACE_Y + 0.2, 11.2), FLESH, subdiv=2, scale=(1.4, 0.7, 1.0)))
for i in range(6):
    a = 2 * math.pi * i / 6
    objs.append(C.ico("hiveEye", 0.22, (1.1 * math.cos(a), FACE_Y + 0.75, 11.2 + 0.7 * math.sin(a)), GLOW, subdiv=1))
C.apply_all(objs)
g_arch = C.join("Alien_Growth_Arch_South", objs)
C.set_origin(g_arch, (0, 0, 0))
for p in g_arch.data.polygons:
    p.use_smooth = True

C.smooth_by_angle([structure], 35)
C.smooth_by_angle([g_sw, g_ne, g_arch], 70)

final = [structure, g_sw, g_ne, g_arch]
C.export_glb("charminar", final)
C.report("charminar", final)
C.save_blend("charminar")
C.render_preview("charminar", cam_loc=(42, 48, 16), target=(0, 0, 15), lens=28)
C.render_preview("charminar_front", cam_loc=(0, 58, 9), target=(0, 0, 15.5), lens=30)

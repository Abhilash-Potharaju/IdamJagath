"""War-debris kit: burning car, rubble pile, crashed alien pod, sandbag wall, police barricade.

Run:  blender --background --factory-startup --python tools/blender/debris.py
Output: public/models/debris.glb (+ preview + .blend)

Each prop is a separate top-level node with its origin at its own bottom centre (ground contact at z = 0).
In the file they are spread along Blender X for the preview (offsets: car 0, rubble 6, pod 12, sandbags 18,
barricade 23); in the game, clone a node and set its position directly.
Long axes run along Blender X. Fronts (car bonnet, barricade face) face Blender -Y = game north by default.
Animated/emissive materials: `FireGlow` + `FireCore` (flames on the car; flicker them), `PodGlow` (pod seams).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import bpy  # noqa: E402

C.reset()
rnd = random.Random(5)

CAR_BODY = C.mat("CarBurnt", "#3b2722", rough=0.7, metal=0.4)
CAR_PAINT = C.mat("CarPaintRed", "#8f2a22", rough=0.5, metal=0.4)
CHAR = C.mat("Char", "#120e0c", rough=0.95)
GLASS = C.mat("CarGlassBroken", "#1a1f24", rough=0.2, metal=0.3)
TYRE = C.mat("Tyre", "#141414", rough=0.9)
FIRE = C.mat("FireGlow", "#ff6a14", emit="#ff6a14", strength=7.0)
FIRE_CORE = C.mat("FireCore", "#ffd34d", emit="#ffd34d", strength=9.0)
STONE = [C.mat("RubbleStone", "#b9a98f", rough=0.95), C.mat("RubbleBrick", "#9a5a42", rough=0.95),
         C.mat("RubbleConcrete", "#8d867a", rough=0.95)]
REBAR = C.mat("Rebar", "#6b3d24", rough=0.7, metal=0.6)
DIRT = C.mat("ScorchedEarth", "#3e3329", rough=1.0)
POD = C.mat("PodHull", "#241a30", rough=0.35, metal=0.7)
POD_GLOW = C.mat("PodGlow", "#b14dff", emit="#b14dff", strength=6.0)
SAND = [C.mat("Sandbag", "#b5a27a", rough=1.0), C.mat("SandbagDark", "#998660", rough=1.0)]
PLANK = C.mat("PostWood", "#5a4030", rough=0.9)
YELLOW = C.mat("BarrierYellow", "#f2c230", rough=0.6)
BLACK = C.mat("BarrierBlack", "#1a1a1a", rough=0.6)
STEEL = C.mat("BarrierSteel", "#9aa0a6", rough=0.4, metal=0.8)
BLUE = C.mat("PoliceBlue", "#1f3f8a", rough=0.5)

nodes = []


def finish(name, parts, x):
    C.apply_all(parts)
    ob = C.join(name, parts)
    C.set_origin(ob, (x, 0, 0))
    C.smooth_by_angle([ob], 35)
    nodes.append(ob)
    return ob


def flame(x, y, z, h, r):
    """A flame tongue: outer orange cone + inner yellow core."""
    out = [C.lathe("flame", [(r, 0), (r * 0.9, h * 0.35), (r * 0.45, h * 0.75), (0, h)], seg=6,
                   loc=(x, y, z), material=FIRE)]
    out.append(C.lathe("flameCore", [(r * 0.5, 0), (r * 0.42, h * 0.3), (0, h * 0.6)], seg=5,
                       loc=(x, y, z + 0.02), material=FIRE_CORE))
    for o in out:
        o.rotation_euler = (rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), rnd.uniform(0, 6))
    return out


# 1 · burning crushed hatchback (x = 0), length along X, slightly tilted (one wheel gone)
X = 0.0
p = []
body = C.prism("body", [(-1.85, 0.32), (1.85, 0.32), (1.9, 0.75), (1.2, 0.95), (-1.6, 0.95), (-1.9, 0.7)], 1.65,
               CAR_PAINT, loc=(X, 0, 0))
cabin = C.prism("cabin", [(-1.45, 0.95), (0.95, 0.95), (0.35, 1.32), (-1.1, 1.38)], 1.45, GLASS, loc=(X, 0, 0))
roof = C.prism("roofCrushed", [(-1.15, 1.36), (0.4, 1.3), (0.3, 1.38), (-1.05, 1.44)], 1.5, CHAR, loc=(X, 0, 0))
p += [body, cabin, roof]
# scorch patches
p.append(C.box("scorchBonnet", 1.1, 1.5, 0.03, (X + 1.35, 0, 0.93), CHAR))
p.append(C.box("scorchDoor", 1.2, 1.67, 0.35, (X - 0.4, 0, 0.45), CAR_BODY))
for wx, wy, present in ((1.25, -0.78, True), (1.25, 0.78, True), (-1.2, -0.78, True), (-1.2, 0.78, False)):
    if present:
        w = C.cyl("wheel", 0.33, 0.24, (X + wx, wy - 0.12, 0.33), seg=10, material=TYRE, rot=(math.radians(90), 0, 0))
        w.location = (X + wx, wy + (0.12 if wy < 0 else -0.12), 0.33)
        p.append(w)
# burnt-out wheel lying beside the car
p.append(C.cyl("lostWheel", 0.33, 0.22, (X - 1.6, 1.45, 0), seg=10, material=TYRE))
# flames: inside the cabin and on the bonnet
for fx, fy, fz, h, r in ((-0.4, 0.0, 1.0, 1.4, 0.4), (-0.9, 0.3, 1.0, 1.0, 0.3), (0.1, -0.3, 1.0, 1.1, 0.32),
                         (1.3, 0.2, 0.95, 0.9, 0.3), (1.5, -0.3, 0.95, 0.6, 0.22), (-1.3, -0.2, 1.0, 0.8, 0.25)):
    p += flame(X + fx, fy, fz, h, r)
finish("Burning_Car", p, X)
# tilt the whole car toward the missing wheel
car = nodes[-1]
car.rotation_euler = (math.radians(-4), math.radians(3), 0)
C.apply_all([car])

# 2 · rubble pile (x = 6)
X = 6.0
p = []
for i in range(16):
    a = rnd.uniform(0, 2 * math.pi)
    d = rnd.uniform(0, 1.4) * (1 - i / 22)
    s = rnd.uniform(0.35, 0.9) * (1.15 - d / 2)
    chunk = C.box("chunk", s * rnd.uniform(0.8, 1.6), s * rnd.uniform(0.7, 1.3), s * rnd.uniform(0.4, 0.8),
                  (X + d * math.cos(a), d * math.sin(a), max(0, 0.55 - d * 0.35) * rnd.uniform(0.5, 1.0)),
                  rnd.choice(STONE), rot=(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 3)))
    p.append(chunk)
for i in range(5):
    p.append(C.ico("stone", rnd.uniform(0.25, 0.45), (X + rnd.uniform(-1.4, 1.4), rnd.uniform(-1.2, 1.2), 0.1),
                   material=rnd.choice(STONE), subdiv=0, scale=(1.3, 1.0, 0.7)))
for i in range(4):
    a = rnd.uniform(0, 2 * math.pi)
    p.append(C.tube("rebar", [(X + 0.3 * math.cos(a), 0.3 * math.sin(a), 0.4),
                              (X + 0.8 * math.cos(a), 0.8 * math.sin(a), 1.2 + 0.3 * i % 2),
                              (X + 1.0 * math.cos(a), 1.0 * math.sin(a), 1.5)], 0.025, REBAR, sides=4))
finish("Rubble_Pile", p, X)

# 3 · crashed alien drop-pod, half buried in a scorched crater (x = 12)
X = 12.0
p = []
p.append(C.lathe("crater", [(3.2, 0.0), (2.6, 0.35), (2.0, 0.28), (1.2, 0.05), (0.0, 0.02)], seg=14,
                 loc=(X, 0, 0), material=DIRT))
# build the pod upright at (X, 0), then tilt the whole group about its base so it looks rammed into the ground
pod_parts = [C.lathe("podHull", [(0, -1.2), (0.9, -0.9), (1.25, 0), (1.2, 1.4), (0.95, 2.6), (0.5, 3.4), (0, 3.7)],
                     seg=12, loc=(X, 0, 0), material=POD)]
for k, zz in enumerate((0.4, 1.4, 2.4)):
    pod_parts.append(C.torus("podSeam", 1.25 - 0.1 * k - 0.15 * (k == 2), 0.07, (X, 0, zz), POD_GLOW, seg=14, minor=4))
for i in range(3):
    a = 2 * math.pi * i / 3
    pod_parts.append(C.box("podFin", 0.12, 0.9, 1.4, (X + 1.1 * math.cos(a), 1.1 * math.sin(a), 2.0), POD, rot=(0, 0, a)))
pod_parts.append(C.ico("podWindow", 0.42, (X, -1.05, 1.9), material=POD_GLOW, subdiv=1, scale=(1, 0.45, 1.4)))
C.apply_all(pod_parts)
pod_grp = C.join("podGroup", pod_parts)
C.set_origin(pod_grp, (X, 0, 0))
pod_grp.rotation_euler = (math.radians(14), math.radians(52), math.radians(20))
pod_grp.location.z += 0.45
C.apply_all([pod_grp])
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
p.append(pod_grp)
for i in range(6):
    a = rnd.uniform(0, 2 * math.pi)
    d = rnd.uniform(2.0, 3.0)
    p.append(C.box("clod", 0.4, 0.3, 0.25, (X + d * math.cos(a), d * math.sin(a), 0.1), DIRT,
                   rot=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), a)))
pod_node = finish("Crashed_Pod", p, X)

# 4 · sandbag wall, 3 m long along X (x = 18)
X = 18.0
p = []
rows = [(0.0, 6, 0.0), (0.21, 6, 0.26), (0.42, 6, 0.0), (0.63, 5, 0.26)]
for z, n, off in rows:
    for i in range(n):
        bx = X - 1.5 + 0.27 + off + i * 0.52
        if bx > X + 1.45:
            continue
        p.append(C.ico("sandbag", 0.5, (bx, rnd.uniform(-0.03, 0.03), z + 0.13), material=rnd.choice(SAND),
                       subdiv=1, scale=(0.58, 0.4, 0.26)))
for sx in (-1.55, 1.55):
    p.append(C.box("post", 0.1, 0.1, 1.15, (X + sx, 0.25, 0), PLANK))
finish("Sandbag_Wall", p, X)

# 5 · police barricade, yellow/black striped steel barrier, 2.2 m along X (x = 23)
X = 23.0
p = []
for sx in (-1.0, 1.0):
    for sy in (-0.3, 0.3):
        leg = C.box("leg", 0.05, 0.05, 1.15, (X + sx, sy * 0.5, 0), STEEL, rot=(math.radians(-15 if sy < 0 else 15), 0, 0))
        p.append(leg)
    p.append(C.box("foot", 0.08, 0.7, 0.05, (X + sx, 0, 0), STEEL))
for z in (0.55, 0.9):
    n = 8
    for i in range(n):
        seg_x = X - 1.1 + (2.2 / n) * (i + 0.5)
        p.append(C.box("stripe", 2.2 / n, 0.06, 0.22, (seg_x, 0, z), YELLOW if i % 2 == 0 else BLACK))
p.append(C.box("plate", 0.7, 0.07, 0.24, (X, -0.01, 1.15), BLUE))
p.append(C.box("plateWhite", 0.5, 0.075, 0.08, (X, -0.012, 1.23), C.mat("PlateWhite", "#f0f0f0", rough=0.5)))
finish("Barricade", p, X)

C.export_glb("debris", nodes)
C.report("debris", nodes)
for n in nodes:
    lo, hi = C.bbox([n])
    print(f"NODE {n.name}: x {n.location.x:.1f} | dims {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} | "
          f"z {lo.z:.2f}..{hi.z:.2f} | tris {C.tri_count([n])}")
C.save_blend("debris")
C.render_preview("debris", cam_loc=(11.5, -27, 8.0), target=(11.5, 0, 0.9), lens=30, res=(1280, 540))

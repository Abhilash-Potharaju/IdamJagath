"""Street-props kit: lamp post, signboard, wire pole with sagging cables, water drum, alien conversion pylon.

Run:  blender --background --factory-startup --python tools/blender/street_props.py
Output: public/models/street_props.glb

Each prop is a separate top-level node with its origin at its own bottom centre. In the file they are laid out
along Blender X for the preview; in the game, clone a node and set its position (ignore the layout offset).
Front-facing props (signboard) face Blender -Y = Babylon +Z.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.reset()

IRON = C.mat("IronGreen", "#2b3a2e", rough=0.6, metal=0.5)
LAMP = C.mat("LampGlow", "#ffcf7a", emit="#ffcf7a", strength=4.0)
CONCRETE = C.mat("Concrete", "#8a8a85", rough=0.95)
CABLE = C.mat("Cable", "#111111", rough=0.7)
CERAMIC = C.mat("Insulator", "#d9d4c7", rough=0.4)
TRANSF = C.mat("Transformer", "#5d6b5a", rough=0.7, metal=0.3)
SIGN = C.mat("SignPanel", "#c8302f", rough=0.6)
SIGN_FRAME = C.mat("SignFrame", "#e8b923", rough=0.5, metal=0.3)
DRUM = C.mat("DrumBlue", "#1f5fbf", rough=0.45)
CRYSTAL = C.mat("PylonCrystal", "#2a0f3d", rough=0.25, metal=0.3, emit="#5a1f8a", strength=0.4)
CORE = C.mat("PylonCore", "#d07bff", emit="#d07bff", strength=5.0)
BASE = C.mat("PylonBase", "#16101c", rough=0.6, metal=0.4)

nodes = []


def finish(name, parts, x):
    C.apply_all(parts)
    ob = C.join(name, parts)
    C.set_origin(ob, (x, 0, 0))
    C.smooth_by_angle([ob], 35)
    nodes.append(ob)
    return ob


# 1 · lamp post (x = 0)
X = 0.0
p = [C.cyl("base", 0.2, 0.5, (X, 0, 0), seg=8, material=IRON),
     C.cyl("pole", 0.075, 5.0, (X, 0, 0.5), seg=8, material=IRON, r_top=0.055),
     C.box("arm", 0.08, 1.1, 0.08, (X, -0.5, 5.25), IRON),
     C.cyl("head", 0.28, 0.25, (X, -1.0, 5.0), seg=8, material=IRON, r_top=0.1),
     C.cyl("bulb", 0.2, 0.06, (X, -1.0, 4.96), seg=8, material=LAMP)]
finish("Lamp_Post", p, X)

# 2 · signboard (x = 3), with a separate UV-mapped panel for text/art later
X = 3.0
p = [C.box("postL", 0.1, 0.1, 2.7, (X - 0.95, 0, 0), IRON),
     C.box("postR", 0.1, 0.1, 2.7, (X + 0.95, 0, 0), IRON),
     C.box("board", 2.1, 0.08, 1.1, (X, 0.02, 1.55), SIGN_FRAME)]
sign = finish("Signboard", p, X)
panel = C.quad_uv("Signboard_Panel", 1.95, 0.95, (X, -0.025, 1.625), SIGN)
C.set_origin(panel, (X, -0.025, 1.625))
C.parent(panel, sign)

# 3 · water drum (x = 5.5)
X = 5.5
p = [C.cyl("drum", 0.3, 0.9, (X, 0, 0), seg=14, material=DRUM),
     C.cyl("ridge", 0.315, 0.05, (X, 0, 0.3), seg=14, material=DRUM),
     C.cyl("ridge", 0.315, 0.05, (X, 0, 0.6), seg=14, material=DRUM),
     C.cyl("lid", 0.12, 0.04, (X + 0.1, 0, 0.9), seg=8, material=DRUM)]
finish("Water_Drum", p, X)

# 4 · alien conversion pylon (x = 8): dark crystal shards around a glowing core (core is a separate child)
X = 8.0
p = [C.cyl("plinth", 1.0, 0.3, (X, 0, 0), seg=6, material=BASE, r_top=0.85)]
for i in range(3):
    a = 2 * math.pi * i / 3
    shard = C.lathe("shard", [(0.42, 0), (0.48, 0.6), (0.3, 2.4), (0, 3.6 - 0.3 * i)], seg=6, material=CRYSTAL)
    shard.location = (X + 0.45 * math.cos(a), 0.45 * math.sin(a), 0.25)
    shard.rotation_euler = (math.radians(-12) * math.sin(a), math.radians(12) * math.cos(a), a)
    p.append(shard)
for i in range(3):
    a = 2 * math.pi * (i + 0.5) / 3
    small = C.lathe("shardSmall", [(0.2, 0), (0.22, 0.3), (0, 1.3)], seg=6, material=CRYSTAL)
    small.location = (X + 0.8 * math.cos(a), 0.8 * math.sin(a), 0.2)
    small.rotation_euler = (math.radians(-25) * math.sin(a), math.radians(25) * math.cos(a), a)
    p.append(small)
pylon = finish("Pylon", p, X)
core = C.lathe("Pylon_Core", [(0.22, 0), (0.34, 0.8), (0.3, 3.0), (0.12, 4.0), (0, 4.5)], seg=6, loc=(X, 0, 0), material=CORE)
C.smooth_by_angle([core], 35)
C.parent(core, pylon)

# 5 · wire pole with a tangle of sagging cables (x = 16; cables span about ±7 m in X)
X = 16.0
p = [C.cyl("pole", 0.14, 7.2, (X, 0, 0), seg=8, material=CONCRETE, r_top=0.1),
     C.box("crossarm", 1.8, 0.1, 0.1, (X, 0, 6.6), CONCRETE),
     C.box("crossarm2", 1.2, 0.08, 0.08, (X, 0, 5.9), CONCRETE),
     C.box("transformer", 0.6, 0.5, 0.8, (X, 0.35, 4.3), TRANSF)]
anchors = []
for ax in (-0.8, -0.3, 0.3, 0.8):
    p.append(C.cyl("insulator", 0.05, 0.14, (X + ax, 0, 6.7), seg=6, material=CERAMIC))
    anchors.append((X + ax, 0.0, 6.82))
for ax in (-0.5, 0.5):
    anchors.append((X + ax, 0.0, 6.0))


def cable(a, b, sag, steps=10):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        z = a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)
        pts.append((x, y, z))
    return C.tube("cable", pts, 0.018, CABLE, sides=4)


for k, an in enumerate(anchors):
    for side in (-1, 1):
        far = (X + side * (6.5 + 0.3 * k), (k - 2.5) * 0.25, an[2] - 0.3 - 0.1 * k)
        p.append(cable(an, far, 0.6 + 0.15 * k))
# a messy loop of spare cable hanging off the pole
loop_pts = [(X + 0.15 + 0.35 * math.cos(t), -0.15, 5.4 + 0.5 * math.sin(t)) for t in [i * 0.5 for i in range(14)]]
p.append(C.tube("coil", loop_pts, 0.02, CABLE, sides=4))
finish("Wire_Pole", p, X)

C.export_glb("street_props", nodes, uvs=True)  # UVs for the signboard panel
C.report("street_props", nodes + [panel, core])
C.save_blend("street_props")
C.render_preview("street_props", cam_loc=(8, -17, 5.0), target=(8.5, 0, 2.6), lens=28)

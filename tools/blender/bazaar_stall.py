"""Laad Bazaar market stall: striped sloped awning, wooden counter, crates, sacks, fruit and bangles.

Run:  blender --background --factory-startup --python tools/blender/bazaar_stall.py
Output: public/models/bazaar_stall.glb  (~2.4 m wide (X) x 1.4 m deep (Y) x 2.4 m tall)
FRONT (customer side) faces Blender -Y = Babylon +Z.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.reset()
random.seed(3)

WOOD = C.mat("Wood", "#7a5230", rough=0.9)
WOOD_D = C.mat("WoodDark", "#4f341e", rough=0.9)
WOOD_L = C.mat("WoodLight", "#b08a5a", rough=0.9)
SAFFRON = C.mat("AwningSaffron", "#f28c28", rough=0.8)
CREAM = C.mat("AwningCream", "#efe4cc", rough=0.8)
BURLAP = C.mat("Burlap", "#b59a6a", rough=1.0)
ORANGE = C.mat("Fruit", "#f2862b", rough=0.6)
LIMEF = C.mat("FruitGreen", "#7fb03a", rough=0.6)
BULB = C.mat("Bulb", "#ffd98a", emit="#ffd98a", strength=3.0)
BANGLES = [C.mat(f"Bangle{i}", c, rough=0.25, metal=0.6) for i, c in
           enumerate(["#d4262b", "#e8b923", "#2e8b57", "#2459c6", "#c2268f"])]

parts = []
# posts
for x in (-1.15, 1.15):
    parts.append(C.box("postFront", 0.08, 0.08, 2.0, (x, -0.65, 0), WOOD_D))
    parts.append(C.box("postBack", 0.08, 0.08, 2.4, (x, 0.65, 0), WOOD_D))
# counter with plank lines
parts.append(C.box("counter", 2.3, 0.9, 0.88, (0, -0.15, 0), WOOD))
parts.append(C.box("counterTop", 2.38, 0.98, 0.06, (0, -0.15, 0.88), WOOD_L))
for i in range(5):
    parts.append(C.box("plank", 2.31, 0.02, 0.03, (0, -0.61, 0.14 + i * 0.16), WOOD_D))
# back shelf
parts.append(C.box("shelfBack", 2.3, 0.06, 1.5, (0, 0.67, 0.9), WOOD_D))
for z in (1.3, 1.8):
    parts.append(C.box("shelf", 2.2, 0.3, 0.04, (0, 0.5, z), WOOD_L))

# striped sloped awning (back z 2.4 -> front z 1.95, overhanging the front by ~0.3 m)
y0, z0, y1, z1 = 0.72, 2.42, -0.98, 1.95
length = math.hypot(y1 - y0, z1 - z0)
tilt = math.atan2(z0 - z1, y0 - y1)
n = 8
for i in range(n):
    x = -1.25 + (i + 0.5) * (2.5 / n)
    s = C.box("stripe", 2.5 / n, length, 0.03, (x, (y0 + y1) / 2, (z0 + z1) / 2 - 0.015), SAFFRON if i % 2 == 0 else CREAM,
              rot=(tilt, 0, 0))
    parts.append(s)
    # scalloped valance: a hanging triangle under each stripe
    tri = C.prism("valance", [(-2.5 / n / 2, 0), (2.5 / n / 2, 0), (0, -0.22)], 0.02, SAFFRON if i % 2 == 0 else CREAM)
    tri.location = (x, y1 - 0.01, z1)
    parts.append(tri)

# hanging bulb
parts.append(C.cyl("wire", 0.006, 0.35, (0, -0.4, 1.8), seg=4, material=WOOD_D))
parts.append(C.ico("bulb", 0.07, (0, -0.4, 1.75), BULB, subdiv=1))

# bangles hanging on a rod at the front
parts.append(C.cyl("bangleRod", 0.015, 2.2, (-1.1, -0.72, 1.72), seg=6, material=WOOD_D, rot=(0, math.pi / 2, 0)))
for i in range(10):
    x = -0.92 + i * 0.205
    for j in range(random.randint(2, 4)):
        parts.append(C.torus("bangle", 0.055, 0.008, (x + j * 0.012, -0.72, 1.66 - j * 0.004),
                             BANGLES[(i + j) % len(BANGLES)], seg=8, minor=3, rot=(math.pi / 2, 0, 0)))

# goods on the counter (top at z ~0.94)
TOP = 0.94
parts.append(C.box("crate", 0.45, 0.35, 0.26, (-0.8, -0.1, TOP), WOOD_L))
parts.append(C.box("crateRim", 0.47, 0.37, 0.04, (-0.8, -0.1, TOP + 0.24), WOOD_D))
for i in range(9):
    parts.append(C.ico("orange", 0.065, (-0.92 + (i % 3) * 0.12, -0.2 + (i // 3) * 0.11, TOP + 0.3), ORANGE, subdiv=1))
for k in range(3):
    parts.append(C.ico("sack", 0.22, (0.15 + k * 0.38, 0.0, TOP + 0.15), BURLAP, subdiv=1, scale=(1.0, 0.9, 0.75)))
for i in range(10):
    parts.append(C.ico("lime", 0.045, (0.7 + random.uniform(-0.15, 0.15), -0.35 + random.uniform(-0.08, 0.08),
                                       TOP + 0.05 + random.uniform(0, 0.05)), LIMEF, subdiv=1))
# goods on the shelves
for z in (1.34, 1.84):
    for i in range(6):
        parts.append(C.box("jar", 0.14, 0.14, 0.2, (-0.9 + i * 0.36, 0.5, z), BANGLES[i % len(BANGLES)]))

C.apply_all(parts)
stall = C.join("Bazaar_Stall", parts)
C.set_origin(stall, (0, 0, 0))
C.smooth_by_angle([stall], 35)

C.export_glb("bazaar_stall", [stall])
C.report("bazaar_stall", [stall])
C.save_blend("bazaar_stall")
C.render_preview("bazaar_stall", cam_loc=(-3.0, -4.4, 2.3), target=(0, 0, 1.25), lens=32)

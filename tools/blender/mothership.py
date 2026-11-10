"""Alien mothership: a huge sky silhouette (about 100 m across) for the backdrop.

Run:  blender --background --factory-startup --python tools/blender/mothership.py
Output: public/models/mothership.glb (+ preview + .blend)

- Origin at the CENTRE of the ship (not the bottom), so it can be scaled and rotated in the sky.
- Single top-level node `Mothership` (hull, spines, ribs) with children `Mothership_Lights` (material `ShipGlow`,
  emissive violet/magenta; pulse it in code) and `Mothership_Beam_Emitter` (the downward tractor-beam nozzle,
  also `ShipGlow`). A real beam is best done in-engine (a long transparent additive cone below the emitter).
- The front of the crescent opening faces Blender -Y (= game north by default).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.reset()

HULL = C.mat("ShipHull", "#16111f", rough=0.45, metal=0.7)
PLATE = C.mat("ShipPlate", "#2a2138", rough=0.5, metal=0.6)
SPINE = C.mat("ShipSpine", "#0d0a12", rough=0.4, metal=0.5)
GLOW = C.mat("ShipGlow", "#d84dff", emit="#d84dff", strength=8.0)

SEG = 28
hull = []
# Main disc: thick lens with a raised armoured crown and a sunken underside bowl
hull.append(C.lathe("disc", [(0, -7), (10, -8), (24, -7.5), (36, -5), (46, -2.2), (50, 0),
                             (47, 2.0), (38, 3.6), (26, 5.5), (16, 8.5), (8, 11), (0, 12)], seg=SEG, material=HULL))
hull.append(C.lathe("crown", [(15, 7.9), (14, 10.5), (9, 13.5), (4, 16), (0, 16.5)], seg=SEG // 2, material=PLATE))
# Lower armour ring
hull.append(C.lathe("underRing", [(38, -4.2), (30, -8.8), (22, -10), (14, -9.4), (14, -8)], seg=SEG, material=PLATE,
                    close_top=False))

# Spines: long curved claws reaching out (a crescent of claws on the front side) + dorsal spikes
for i in range(14):
    a = 2 * math.pi * i / 14
    L = 26 if (i % 2 == 0) else 16
    if -0.9 < math.sin(a) < -0.2:  # front arc: longer claws curving down = menacing crescent
        L += 10
    pts = []
    for k in range(5):
        t = k / 4
        r = 44 + L * t
        z = -2 - 9 * t * t
        pts.append((r * math.cos(a), r * math.sin(a), z))
    hull.append(C.tube("spine", pts, 1.6, SPINE, sides=4, taper_end=0.1))
for i in range(8):
    a = 2 * math.pi * (i + 0.5) / 8
    sp = C.cyl("dorsal", 2.2, 12, (24 * math.cos(a), 24 * math.sin(a), 4.5), seg=5, material=SPINE, r_top=0.05)
    sp.rotation_euler = (math.radians(-35) * math.sin(a), math.radians(35) * math.cos(a), 0)
    hull.append(sp)
# Organic ribs over the crown
for i in range(10):
    a = 2 * math.pi * i / 10
    pts = [(r * math.cos(a), r * math.sin(a), z) for r, z in ((4, 15.5), (12, 11), (22, 7), (34, 4.1), (44, 1.6))]
    hull.append(C.tube("rib", pts, 0.9, PLATE, sides=4))
# Bulbous engine pods underneath
for i in range(4):
    a = 2 * math.pi * i / 4 + 0.4
    hull.append(C.ico("pod", 5, (30 * math.cos(a), 30 * math.sin(a), -7.5), material=PLATE, subdiv=1,
                      scale=(1.4, 1.0, 0.7)))

C.apply_all(hull)
ship = C.join("Mothership", hull)
C.set_origin(ship, (0, 0, 0))
C.smooth_by_angle([ship], 40)

# Glowing lights: two rings under the rim + a row of port lights on the crown + pod lights
lights = []
lights.append(C.torus("ringOuter", 41, 0.7, (0, 0, -4.6), GLOW, seg=36, minor=4))
lights.append(C.torus("ringInner", 22, 0.6, (0, 0, -9.9), GLOW, seg=24, minor=4))
for i in range(20):
    a = 2 * math.pi * i / 20
    lights.append(C.box("port", 1.6, 1.6, 0.6, (33 * math.cos(a), 33 * math.sin(a), 4.2), GLOW,
                        rot=(0, 0, a)))
for i in range(4):
    a = 2 * math.pi * i / 4 + 0.4
    lights.append(C.ico("podLight", 1.8, (30 * math.cos(a), 30 * math.sin(a), -10.6), material=GLOW, subdiv=1))
C.apply_all(lights)
lit = C.join("Mothership_Lights", lights)
C.set_origin(lit, (0, 0, 0))
C.parent(lit, ship)

# Tractor-beam emitter pointing down
emit_parts = [C.lathe("nozzle", [(9, -9.5), (7, -13), (4.5, -15.5), (4.5, -16)], seg=16, material=PLATE, close_top=False),
              C.cyl("lens", 4.2, 0.6, (0, 0, -16.3), seg=16, material=GLOW)]
for i in range(6):
    a = 2 * math.pi * i / 6
    fin = C.box("fin", 0.8, 5.5, 4.5, (6.5 * math.cos(a), 6.5 * math.sin(a), -15.5), SPINE, rot=(0, 0, a + math.pi / 2))
    emit_parts.append(fin)
C.apply_all(emit_parts)
emitter = C.join("Mothership_Beam_Emitter", emit_parts)
C.set_origin(emitter, (0, 0, 0))
C.parent(emitter, ship)

C.export_glb("mothership", [ship])
C.report("mothership", [ship, lit, emitter])
C.save_blend("mothership")
C.render_preview("mothership", cam_loc=(0, -150, -55), target=(0, 0, 0), lens=35, sun_dir=(-0.3, 0.4, -0.8),
                 world="#2a1d3a")

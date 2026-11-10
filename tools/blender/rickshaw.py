"""Indian auto-rickshaw (green/yellow, black canvas roof) + a wrecked variant.

Run:  blender --background --factory-startup --python tools/blender/rickshaw.py
Outputs: public/models/rickshaw.glb, public/models/rickshaw_wrecked.glb

Size ~2.6 m long (Blender Y), 1.3 m wide (X), 1.7 m tall. FRONT faces Blender -Y
(= Babylon +Z after import, i.e. it "looks" north by default).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def palette(wrecked):
    if not wrecked:
        return dict(
            green=C.mat("AutoGreen", "#2f7d3a", rough=0.5), yellow=C.mat("AutoYellow", "#f2c12e", rough=0.45),
            canvas=C.mat("Canvas", "#1b1b1d", rough=0.95), seat=C.mat("Seat", "#3a2a22", rough=0.8),
            metal=C.mat("Chrome", "#9a9da3", rough=0.3, metal=0.9), tyre=C.mat("Tyre", "#151515", rough=0.9),
            glass=C.mat("Glass", "#9fc6d8", rough=0.1, alpha=0.45),
            lamp=C.mat("Headlamp", "#fff2c0", emit="#fff2c0", strength=2.5),
        )
    return dict(
        green=C.mat("AutoGreenBurnt", "#2b4a2e", rough=0.9), yellow=C.mat("AutoYellowBurnt", "#8a6b26", rough=0.9),
        canvas=C.mat("CanvasBurnt", "#0e0e0f", rough=1.0), seat=C.mat("SeatBurnt", "#1f1712", rough=1.0),
        metal=C.mat("MetalRust", "#4d3a2c", rough=0.8, metal=0.4), tyre=C.mat("TyreBurnt", "#0d0d0d", rough=1.0),
        glass=None, lamp=C.mat("HeadlampDead", "#2a2a24", rough=0.6),
    )


def build(wrecked):
    P = palette(wrecked)
    parts = []
    # wheels: axis along X
    wheels = [(0.0, -1.0), (-0.62, 0.78), (0.62, 0.78)]
    for i, (x, y) in enumerate(wheels):
        if wrecked and i == 2:
            continue  # one rear wheel is gone
        w = C.cyl("wheel", 0.25, 0.14, (x - 0.07, y, 0.25), seg=12, material=P["tyre"], rot=(0, math.pi / 2, 0))
        hub = C.cyl("hub", 0.11, 0.16, (x - 0.08, y, 0.25), seg=8, material=P["metal"], rot=(0, math.pi / 2, 0))
        parts += [w, hub]
    # chassis + body
    parts.append(C.box("floor", 1.2, 2.2, 0.12, (0, 0.05, 0.33), P["green"]))
    nose = C.cyl("nose", 0.43, 0.72, (0, -1.0, 0.36), seg=12, material=P["green"], r_top=0.4)
    nose.scale = (1.0, 0.72, 1.0)
    nose_top = C.cyl("noseTop", 0.44, 0.12, (0, -1.0, 1.06), seg=12, material=P["yellow"], r_top=0.38)
    nose_top.scale = (1.0, 0.72, 1.0)
    parts += [nose, nose_top]
    parts.append(C.box("mudguard", 0.32, 0.6, 0.08, (0, -1.03, 0.5), P["yellow"]))
    parts.append(C.box("dash", 1.15, 0.2, 0.3, (0, -0.8, 0.8), P["green"]))
    for sx in (-1, 1):
        parts.append(C.box("sidePanel", 0.06, 1.45, 0.48, (sx * 0.6, 0.38, 0.42), P["green"]))
        parts.append(C.box("sideStripe", 0.07, 1.45, 0.1, (sx * 0.6, 0.38, 0.9), P["yellow"]))
    parts.append(C.box("rearHump", 1.25, 0.32, 0.78, (0, 1.1, 0.38), P["green"]))
    parts.append(C.box("rearStripe", 1.27, 0.34, 0.1, (0, 1.1, 1.08), P["yellow"]))
    # seats + controls
    parts.append(C.box("driverSeat", 0.48, 0.36, 0.16, (0, -0.45, 0.72), P["seat"]))
    parts.append(C.box("bench", 1.1, 0.46, 0.16, (0, 0.62, 0.66), P["seat"]))
    parts.append(C.box("benchBack", 1.1, 0.1, 0.45, (0, 0.9, 0.82), P["seat"]))
    parts.append(C.cyl("handlebar", 0.025, 0.62, (-0.31, -0.68, 1.05), seg=6, material=P["metal"], rot=(0, math.pi / 2, 0)))
    parts.append(C.cyl("headlamp", 0.085, 0.06, (0, -1.28, 0.88), seg=10, material=P["lamp"], rot=(math.pi / 2, 0, 0)))
    if P["glass"]:
        parts.append(C.box("windshield", 1.08, 0.03, 0.55, (0, -0.86, 1.08), P["glass"], rot=(math.radians(-12), 0, 0)))
    # roof poles
    for x, y in ((-0.6, -0.86), (0.6, -0.86), (-0.62, 1.2), (0.62, 1.2)):
        if wrecked and (x, y) == (0.6, -0.86):
            parts.append(C.cyl("poleBent", 0.025, 0.5, (x, y, 0.95), seg=6, material=P["metal"], rot=(0.5, 0.3, 0)))
            continue
        parts.append(C.cyl("pole", 0.025, 0.72, (x, y, 0.93), seg=6, material=P["metal"]))
    # canvas roof
    if not wrecked:
        parts.append(C.box("roof", 1.32, 2.16, 0.07, (0, 0.16, 1.62), P["canvas"]))
        parts.append(C.box("roofLip", 1.34, 0.12, 0.12, (0, -0.9, 1.58), P["canvas"]))
        parts.append(C.box("roofBack", 1.32, 0.06, 0.62, (0, 1.24, 1.04), P["canvas"], rot=(math.radians(8), 0, 0)))
    else:
        # torn roof: the back half sags, the front is ripped away
        parts.append(C.box("roofTorn", 1.32, 1.1, 0.06, (0.05, 0.65, 1.5), P["canvas"], rot=(math.radians(-14), math.radians(9), 0)))
        parts.append(C.box("roofFlap", 0.7, 0.5, 0.04, (-0.35, 0.0, 1.38), P["canvas"], rot=(math.radians(35), math.radians(-20), 0)))
        parts.append(C.box("roofBack", 1.32, 0.06, 0.5, (0, 1.24, 1.0), P["canvas"], rot=(math.radians(16), 0, 0)))
        # the lost wheel lying on the ground beside it
        parts.append(C.cyl("lostWheel", 0.25, 0.14, (1.25, 1.35, 0.0), seg=12, material=P["tyre"]))
    C.apply_all(parts)
    ob = C.join("Rickshaw_Wrecked" if wrecked else "Rickshaw", parts)
    if wrecked:
        # sits on its missing-wheel corner: roll toward +X and yaw slightly
        ob.rotation_euler = (math.radians(-3), math.radians(9), math.radians(12))
        C.apply_all([ob])
    C.set_origin(ob, (0, 0, 0))
    C.drop_to_ground([ob])
    C.apply_all([ob])
    bpy_ob_loc_to_origin(ob)
    C.smooth_by_angle([ob], 35)
    return ob


def bpy_ob_loc_to_origin(ob):
    """After drop_to_ground moved the object, bake its location into the mesh so the origin is (0,0,0)."""
    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


for wrecked, name in ((False, "rickshaw"), (True, "rickshaw_wrecked")):
    C.reset()
    C._mats.clear()
    ob = build(wrecked)
    C.export_glb(name, [ob])
    C.report(name, [ob])
    C.save_blend(name)
    C.render_preview(name, cam_loc=(-3.6, -4.2, 2.3), target=(0, 0, 0.8), lens=35)

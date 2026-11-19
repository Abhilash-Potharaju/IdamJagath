"""Captives in the Charminar cage: three Hyderabadi civilians (kurta-pyjama) with hand-authored animation clips.

Sources (CC BY 4.0, credited in data/assets.json): art/library/sketchfab/captive_blue, captive_red (Himanshuvaid).
Both are Mixamo-rigged with no usable animation, so this script authors the clips itself. Poses are written as limb
DIRECTIONS in the character's own frame (forward / up / left), and each bone is aimed with a minimal rotation, which
works whatever bone roll the glTF importer chose. Clips (looping, in place):
  Grip   - standing at the bars, gripping and shaking them        (blue)
  Kneel  - kneeling, hands together, pleading and rocking         (white: the blue model with the kurta recoloured)
  Hunch  - half-converted: hunched, arms hanging, twitching       (red)
  Run    - escape run cycle                                        (all)

Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/build_captives.py
  node tools/assets/optimize_glb.mjs public/models/captives/*.glb
"""
import glob
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = os.getcwd()
RAW = os.path.join(ROOT, "art/_public_backup/models/captives")
os.makedirs(RAW, exist_ok=True)
FPS = 24

VARIANTS = {
    # name: (source folder, idle clip, recolour)
    "blue": ("captive_blue", "Grip", None),
    "white": ("captive_blue", "Kneel", "cream"),
    "red": ("captive_red", "Hunch", None),
}


def find(arm, key):
    """Pose bone whose name contains `key` (Mixamo names carry a numeric suffix, e.g. mixamorig:LeftArm_09)."""
    for pb in arm.pose.bones:
        n = pb.name.split(":")[-1]
        if n.rsplit("_", 1)[0] == key:
            return pb
    return None


def norm(v):
    return Vector(v).normalized()


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.mw = arm.matrix_world.copy()
        bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
        w = lambda k: self.mw @ find(arm, k).head
        self.L = (w("LeftArm") - w("RightArm")).normalized()          # character's left
        self.U = Vector((0, 0, 1))
        self.F = self.U.cross(self.L).normalized()                     # forward (right-handed: L x U points back)
        if (w("LeftToeBase") - w("LeftFoot")).dot(self.F) < 0:
            self.F = -self.F
        self.height = (w("HeadTop_End") - (w("LeftToeBase") + w("RightToeBase")) / 2).z
        self.leg = (w("LeftUpLeg") - w("LeftLeg")).length + (w("LeftLeg") - w("LeftFoot")).length

    def vec(self, f=0.0, u=0.0, l=0.0):
        return (self.F * f + self.U * u + self.L * l).normalized()

    def reset(self):
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = Vector()
        bpy.context.view_layer.update()

    def aim(self, key, d):
        pb = find(self.arm, key)
        if pb is None:
            return
        mw = self.mw @ pb.matrix
        loc, rot, scl = mw.decompose()
        cur = (rot.to_matrix() @ Vector((0, 1, 0))).normalized()
        q = cur.rotation_difference(d)
        new = Matrix.LocRotScale(loc, q @ rot, scl)
        pb.matrix = self.mw.inverted() @ new
        bpy.context.view_layer.update()

    def drop_hips(self, metres, fwd=0.0):
        pb = find(self.arm, "Hips")
        mw = self.mw @ pb.matrix
        loc, rot, scl = mw.decompose()
        new = Matrix.LocRotScale(loc - self.U * metres + self.F * fwd, rot, scl)
        pb.matrix = self.mw.inverted() @ new
        bpy.context.view_layer.update()

    def pose(self, p):
        """p: {'hips': (drop, fwd), bone: (f, u, l)}; right-side bones may be given as 'R:Arm' to mirror 'L:Arm'."""
        self.reset()
        if "hips" in p:
            self.drop_hips(*p["hips"])
        order = ["Spine", "Spine1", "Spine2", "Neck", "Head",
                 "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
                 "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"]
        for key in order:
            if key in p:
                f, u, l = p[key]
                self.aim(key, self.vec(f, u, l))

    def key(self, frame):
        for pb in self.arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if pb.name.split(":")[-1].startswith("Hips"):
                pb.keyframe_insert("location", frame=frame)


def mirror(p):
    """Swap left/right bones and flip the sideways component (for the second half of the run cycle)."""
    out = {}
    for k, v in p.items():
        if k == "hips":
            out[k] = v
            continue
        nk = k.replace("Left", "@").replace("Right", "Left").replace("@", "Right")
        out[nk] = (v[0], v[1], -v[2])
    return out


def stand(**over):
    base = {
        "Spine": (0, 1, 0), "Spine1": (0, 1, 0), "Spine2": (0, 1, 0), "Neck": (0.05, 1, 0), "Head": (0.05, 1, 0),
        "LeftArm": (0, -1, 0.12), "LeftForeArm": (0.1, -1, 0.05), "RightArm": (0, -1, -0.12), "RightForeArm": (0.1, -1, -0.05),
        "LeftUpLeg": (0, -1, 0.03), "LeftLeg": (0, -1, 0), "LeftFoot": (1, -0.5, 0),
        "RightUpLeg": (0, -1, -0.03), "RightLeg": (0, -1, 0), "RightFoot": (1, -0.5, 0),
    }
    base.update(over)
    return base


def clip_grip(r):
    """Gripping the cage bars just ahead at head height, pulling and shaking, looking around."""
    keys = []
    for i, (lean, pull, look) in enumerate([(0.15, 0.0, 0.0), (0.25, 0.25, 0.25), (0.1, -0.1, -0.1), (0.3, 0.3, -0.3), (0.15, 0.0, 0.0)]):
        keys.append((i * 12, stand(**{
            "Spine": (lean, 1, 0), "Spine1": (lean, 1, 0), "Spine2": (lean * 0.5, 1, 0), "Neck": (0.2, 1, look), "Head": (0.25, 1, look),
            "LeftArm": (0.8 - pull * 0.3, 0.15, 0.35), "LeftForeArm": (0.75, 0.5 + pull * 0.2, -0.15),
            "RightArm": (0.8 + pull * 0.2, 0.15, -0.35), "RightForeArm": (0.75, 0.5 - pull * 0.2, 0.15),
        })))
    return keys


def clip_kneel(r):
    """Kneeling upright, hands pressed together, bowing and rocking."""
    shin = r.leg * 0.5
    keys = []
    for i, (bow, sway) in enumerate([(0.15, 0.0), (0.4, 0.06), (0.2, 0.0), (0.45, -0.06), (0.15, 0.0)]):
        keys.append((i * 18, {
            "hips": (shin * 0.95, -shin * 0.15),
            "Spine": (bow, 1, sway), "Spine1": (bow, 1, sway), "Spine2": (bow * 0.6, 1, 0), "Neck": (0.35 + bow, 1, 0), "Head": (0.4 + bow, 1, 0),
            "LeftArm": (0.45, -0.8, 0.25), "LeftForeArm": (0.7, 0.6, -0.5), "LeftHand": (0.4, 1, -0.2),
            "RightArm": (0.45, -0.8, -0.25), "RightForeArm": (0.7, 0.6, 0.5), "RightHand": (0.4, 1, 0.2),
            "LeftUpLeg": (0.12, -1, 0.08), "LeftLeg": (-1, -0.12, 0), "LeftFoot": (-0.5, -0.9, 0),
            "RightUpLeg": (0.12, -1, -0.08), "RightLeg": (-1, -0.12, 0), "RightFoot": (-0.5, -0.9, 0),
        }))
    return keys


def clip_hunch(r):
    """Half-converted: hunched over, arms hanging, knees bent; spasms jerk the head and an arm."""
    keys = []
    poses = [(0, 0, 0), (0.25, 0.0, 0.0), (-0.3, 0.35, 0.0), (0.05, 0.0, 0.0), (0.0, 0.0, 0.5), (0.3, -0.2, 0.0), (0, 0, 0)]
    frames = [0, 10, 12, 26, 28, 40, 54]
    for fr, (jerk, armj, legj) in zip(frames, poses):
        keys.append((fr, {
            "hips": (r.leg * 0.12, 0.0),
            "Spine": (0.55, 1, 0), "Spine1": (0.6, 1, jerk * 0.3), "Spine2": (0.5, 1, 0), "Neck": (0.9, 0.5, jerk), "Head": (0.9, 0.2 - abs(jerk) * 0.5, jerk * 1.2),
            "LeftArm": (0.35, -1, 0.22 + armj), "LeftForeArm": (0.45, -1, 0.05),
            "RightArm": (0.3, -1, -0.22), "RightForeArm": (0.4 + armj, -1, -0.05 - armj),
            "LeftUpLeg": (0.32, -1, 0.1 + legj * 0.1), "LeftLeg": (-0.22, -1, 0), "LeftFoot": (1, -0.4, 0),
            "RightUpLeg": (0.3, -1, -0.1), "RightLeg": (-0.25, -1, 0), "RightFoot": (1, -0.4, 0),
        }))
    return keys


def clip_run(r):
    """Run cycle (16 frames = 0.67 s): contact, passing, mirrored contact, mirrored passing."""
    contact = {
        "hips": (r.leg * 0.06, 0.0),
        "Spine": (0.25, 1, 0), "Spine1": (0.2, 1, 0), "Spine2": (0.1, 1, 0), "Neck": (0.1, 1, 0), "Head": (0.15, 1, 0),
        "LeftUpLeg": (0.65, -1, 0.04), "LeftLeg": (0.25, -1, 0), "LeftFoot": (1, -0.2, 0),
        "RightUpLeg": (-0.55, -1, -0.04), "RightLeg": (-1.1, -0.7, 0), "RightFoot": (0.2, -1, 0),
        "RightArm": (0.45, -1, -0.18), "RightForeArm": (0.6, 0.85, -0.15),
        "LeftArm": (-0.5, -1, 0.18), "LeftForeArm": (0.25, -0.5, 0.05),
    }
    passing = {
        "hips": (-r.leg * 0.02, 0.0),
        "Spine": (0.25, 1, 0), "Spine1": (0.2, 1, 0), "Spine2": (0.1, 1, 0), "Neck": (0.1, 1, 0), "Head": (0.15, 1, 0),
        "LeftUpLeg": (0.05, -1, 0.04), "LeftLeg": (-0.35, -1, 0), "LeftFoot": (1, -0.3, 0),
        "RightUpLeg": (0.45, -1, -0.04), "RightLeg": (-1.2, -0.5, 0), "RightFoot": (0.5, -1, 0),
        "RightArm": (0.05, -1, -0.18), "RightForeArm": (0.7, 0.6, -0.1),
        "LeftArm": (-0.05, -1, 0.18), "LeftForeArm": (0.7, 0.6, 0.1),
    }
    return [(0, contact), (4, passing), (8, mirror(contact)), (12, mirror(passing)), (16, contact)]


CLIPS = {"Grip": clip_grip, "Kneel": clip_kneel, "Hunch": clip_hunch, "Run": clip_run}


def recolour_cream(img):
    """Blue kurta -> cream: only strongly blue pixels change (skin, pyjama and sandals keep their colours)."""
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx, mn = rgb.max(1), rgb.min(1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    blue = (rgb[:, 2] >= mx - 1e-6) & (sat > 0.25) & (rgb[:, 2] > rgb[:, 0] * 1.25)
    lum = (0.3 * rgb[:, 0] + 0.59 * rgb[:, 1] + 0.11 * rgb[:, 2])
    ref = float(np.percentile(lum[blue], 90)) if blue.any() else 1.0
    shade = 0.62 + 0.38 * np.clip(lum / max(1e-3, ref), 0.0, 1.0)  # keep the folds, lose the blue print's darkness
    cream = np.stack([0.96 * shade, 0.92 * shade, 0.82 * shade], 1)
    rgb[blue] = cream[blue]
    px[:, :3] = rgb
    img.pixels[:] = px.ravel()
    img.update()


for name, (src, idle, recolour) in VARIANTS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    path = sorted(glob.glob(os.path.join(ROOT, f"art/library/sketchfab/{src}/*.glb")))[0]
    bpy.ops.import_scene.gltf(filepath=path)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)  # empty "mixamo.com" placeholder
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if arm.animation_data:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
    # The sources carry a stray unskinned Icosphere (2 m across): keep only meshes deformed by the rig
    for o in [o for o in bpy.data.objects if o.type == "MESH" and not any(md.type == "ARMATURE" for md in o.modifiers)]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Lighter mesh (keeps skin weights): ~12k triangles
    for m in meshes:
        tris = sum(len(p.vertices) - 2 for p in m.data.polygons)
        if tris > 14000:
            mod = m.modifiers.new("dec", "DECIMATE")
            mod.ratio = 12000 / tris
            while m.modifiers[0] != mod:
                bpy.context.view_layer.objects.active = m
                bpy.ops.object.modifier_move_up(modifier="dec")
            bpy.context.view_layer.objects.active = m
            bpy.ops.object.modifier_apply(modifier="dec")
    for img in bpy.data.images:
        if max(img.size) > 1024:
            k = 1024 / max(img.size)
            img.scale(int(img.size[0] * k), int(img.size[1] * k))
        if recolour == "cream":
            recolour_cream(img)
            img.pack()

    # Normalise: 1.70 m tall, feet on z=0, centred (measured on the deformed vertices; object bounds lie here)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    vs = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        vs += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
    cx, cy = sum(v.x for v in vs) / len(vs), sum(v.y for v in vs) / len(vs)
    k = 1.70 / (zmax - zmin)
    for o in [o for o in bpy.data.objects if o.parent is None]:
        o.scale = o.scale * k
        o.location = (o.location - Vector((cx, cy, zmin))) * k
    bpy.context.view_layer.update()

    rig = Rig(arm)
    arm.animation_data_create()
    for clip in (idle, "Run"):
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        arm.animation_data.action = act
        for frame, p in CLIPS[clip](rig):
            rig.pose(p)
            rig.key(frame)
        # stash on an NLA track so the exporter writes every clip
        tr = arm.animation_data.nla_tracks.new()
        tr.name = clip
        tr.strips.new(clip, 0, act)
        arm.animation_data.action = None
    rig.reset()

    out = os.path.join(RAW, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True, export_skins=True,
                              export_animation_mode="NLA_TRACKS", export_image_format="JPEG", export_jpeg_quality=85)
    print(f"CAPTIVE {name}: height={rig.height:.2f} clips={[t.name for t in arm.animation_data.nla_tracks]} "
          f"tris={sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)} kb={os.path.getsize(out) // 1024}")

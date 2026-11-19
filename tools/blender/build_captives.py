"""Captives in the Charminar cage: four different Hyderabadis with hand-authored animation clips.

Sources (CC BY 4.0, credited in data/assets.json): art/library/sketchfab/captive_blue (Himanshuvaid: kurta-pyjama),
captive_woman / captive_teen / captive_hoodie (ar.jethin: office woman, teenager, bearded man in a hoodie, who becomes
the half-converted captive). All Mixamo-style rigs; the avatars bring a motion-capture idle, the rest this script
authors itself. Poses are written as limb
DIRECTIONS in the character's own frame (forward / up / left), and each bone is aimed with a minimal rotation, which
works whatever bone roll the glTF importer chose. Clips (looping, in place):
  Grip   - standing at the bars, gripping and shaking them        (blue)
  Kneel  - kneeling, hands together, pleading and rocking         (woman)
  Cower  - crouched, arms over the head, rocking and flinching     (teen)
  Hunch  - half-converted: hunched, twitching, deformed (bone scales: a swollen, elongated right arm) (mutant)
  Wave   - the door is open: waving the player in                   (blue)
  Idle / Walk / Run - following the player to the extraction point   (all)

Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/build_captives.py
  node tools/assets/optimize_glb.mjs public/models/captives/*.glb
"""
import glob
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.getcwd()
RAW = os.path.join(ROOT, "art/_public_backup/models/captives")
os.makedirs(RAW, exist_ok=True)
FPS = 24

VARIANTS = {
    # name: (source folder, captive clip(s), options). Every variant also gets Walk / Run (and Idle: the source's own
    # motion-capture idle where it has one, else authored) for following the player to the extraction point.
    "blue": ("captive_blue", ["Grip", "Wave"], {"height": 1.70}),
    "woman": ("captive_woman", ["Kneel"], {"height": 1.62, "mocap_idle": True}),
    "teen": ("captive_teen", ["Cower"], {"height": 1.68, "mocap_idle": True}),
    # the half-converted man: his Hunch clip also deforms him (bone scales); his own clips return him to normal
    "mutant": ("captive_hoodie", ["Hunch"], {"height": 1.78, "mutant": True}),
}
# Mutation in the Hunch clip: an oversized, elongated right arm and hand, a swollen shoulder and back (local bone
# scale; y runs along the bone). Child bones inherit, so these compound: forearm ≈1.5x, hand ≈1.7x life size.
MUTATION = {
    "RightShoulder": (1.25, 1.1, 1.25), "RightArm": (1.1, 1.12, 1.1), "RightForeArm": (1.05, 1.22, 1.05),
    "RightHand": (1.1, 1.12, 1.1), "Spine2": (1.15, 1.0, 1.22), "LeftShoulder": (1.12, 1.0, 1.12), "Neck": (1.18, 0.88, 1.18),
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


BASE = {}


def capture_base(arm):
    """Remember the imported pose; poses are built from it (the importer stores real offsets in the pose bones)."""
    BASE.clear()
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        BASE[pb.name] = (pb.location.copy(), pb.rotation_quaternion.copy())


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
        self.mutant = False

    def vec(self, f=0.0, u=0.0, l=0.0):
        return (self.F * f + self.U * u + self.L * l).normalized()

    def reset(self):
        """Back to the imported (bind) pose, not identity: see capture_base."""
        for pb in self.arm.pose.bones:
            loc, rot = BASE[pb.name]
            pb.rotation_quaternion = rot.copy()
            pb.location = loc.copy()
            pb.scale = Vector((1, 1, 1))
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
        for key, sc in p.get("scale", {}).items():
            pb = find(self.arm, key)
            if pb:
                pb.scale = Vector(sc)
        bpy.context.view_layer.update()
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
            pb.keyframe_insert("scale", frame=frame)  # keyed everywhere, so other clips undo the mutation
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
            "LeftUpLeg": (0.12, -1, 0.08), "LeftLeg": (-1, -0.12, 0), "LeftFoot": (-1, -0.15, 0),
            "RightUpLeg": (0.12, -1, -0.08), "RightLeg": (-1, -0.12, 0), "RightFoot": (-1, -0.15, 0),
        }))
    return keys


def clip_hunch(r):
    """Half-converted: hunched over, arms hanging, knees bent; spasms jerk the head and an arm. On the mutant the
    MUTATION scales are part of every key."""
    keys = []
    poses = [(0, 0, 0), (0.25, 0.0, 0.0), (-0.3, 0.35, 0.0), (0.05, 0.0, 0.0), (0.0, 0.0, 0.5), (0.3, -0.2, 0.0), (0, 0, 0)]
    frames = [0, 10, 12, 26, 28, 40, 54]
    for fr, (jerk, armj, legj) in zip(frames, poses):
        keys.append((fr, {
            "scale": MUTATION if r.mutant else {},
            "hips": (r.leg * 0.06, 0.0),
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


def clip_cower(r):
    """Crouched against the cage, arms over the head, rocking and flinching."""
    keys = []
    for i, (rock, flinch) in enumerate([(0.0, 0.0), (0.12, 0.0), (0.0, 0.25), (0.12, 0.0), (0.0, 0.0)]):
        keys.append((i * 14, {
            "hips": (r.leg * 0.48, -r.leg * 0.12),
            "Spine": (0.75 + rock, 1, 0), "Spine1": (0.7 + rock, 1, 0), "Spine2": (0.5, 1, 0), "Neck": (0.9, 0.6, flinch * 0.3), "Head": (1.0, 0.3, flinch * 0.4),
            "LeftUpLeg": (1, 0.15, 0.18), "LeftLeg": (-0.35, -1, 0.05), "LeftFoot": (1, -0.3, 0),
            "RightUpLeg": (1, 0.15, -0.18), "RightLeg": (-0.35, -1, -0.05), "RightFoot": (1, -0.3, 0),
            "LeftArm": (0.6, 0.55 + flinch, 0.35), "LeftForeArm": (0.1, 0.5, -1), "LeftHand": (-0.3, 0.3, -1),
            "RightArm": (0.6, 0.55 + flinch, -0.35), "RightForeArm": (0.1, 0.5, 1), "RightHand": (-0.3, 0.3, 1),
        }))
    return keys


def clip_idle(r):
    """Standing, nervous: breathing, glancing around, arms held in."""
    keys = []
    for i, (look, lean) in enumerate([(0.0, 0.05), (0.45, 0.08), (0.1, 0.04), (-0.5, 0.08), (0.0, 0.05)]):
        keys.append((i * 24, stand(**{
            "Spine": (lean, 1, 0), "Spine1": (lean, 1, 0), "Neck": (0.1, 1, look * 0.6), "Head": (0.1, 1, look),
            "LeftArm": (0.12, -1, 0.1), "LeftForeArm": (0.45, -0.8, -0.1),
            "RightArm": (0.12, -1, -0.1), "RightForeArm": (0.45, -0.8, 0.1),
        })))
    return keys


def clip_walk(r):
    """Hurried walk cycle (24 frames = 1 s)."""
    contact = {
        "hips": (-r.leg * 0.05, 0.0),
        "Spine": (0.1, 1, 0), "Spine1": (0.08, 1, 0), "Neck": (0.08, 1, 0), "Head": (0.1, 1, 0),
        "LeftUpLeg": (0.4, -1, 0.03), "LeftLeg": (0.15, -1, 0), "LeftFoot": (1, -0.25, 0),
        "RightUpLeg": (-0.3, -1, -0.03), "RightLeg": (-0.5, -1, 0), "RightFoot": (0.5, -1, 0),
        "RightArm": (0.3, -1, -0.12), "RightForeArm": (0.5, -0.7, -0.05),
        "LeftArm": (-0.25, -1, 0.12), "LeftForeArm": (0.15, -1, 0.05),
    }
    passing = {
        "hips": (0.0, 0.0),
        "Spine": (0.1, 1, 0), "Spine1": (0.08, 1, 0), "Neck": (0.08, 1, 0), "Head": (0.1, 1, 0),
        "LeftUpLeg": (0.0, -1, 0.03), "LeftLeg": (0.0, -1, 0), "LeftFoot": (1, -0.4, 0),
        "RightUpLeg": (0.3, -1, -0.03), "RightLeg": (-0.6, -1, 0), "RightFoot": (0.6, -1, 0),
        "RightArm": (0.05, -1, -0.12), "RightForeArm": (0.3, -0.9, -0.05),
        "LeftArm": (0.0, -1, 0.12), "LeftForeArm": (0.3, -0.9, 0.05),
    }
    return [(0, contact), (6, passing), (12, mirror(contact)), (18, mirror(passing)), (24, contact)]


def clip_wave(r):
    """The cage door is open: waving the player in with the right arm overhead, calling for help."""
    keys = []
    for i, sway in enumerate([0.0, 0.55, -0.1, 0.55, 0.0]):
        keys.append((i * 8, stand(**{
            "Spine": (-0.05, 1, 0), "Spine1": (-0.05, 1, 0.05), "Neck": (0.0, 1, 0.1), "Head": (-0.15, 1, 0.1),
            "RightArm": (0.25, 1, -0.55), "RightForeArm": (0.15, 1, -0.2 + sway), "RightHand": (0.1, 1, -0.2 + sway * 1.2),
            "LeftArm": (0.35, -1, 0.2), "LeftForeArm": (0.8, 0.2, 0.0),
        })))
    return keys


CLIPS = {"Grip": clip_grip, "Kneel": clip_kneel, "Hunch": clip_hunch, "Run": clip_run, "Idle": clip_idle,
         "Walk": clip_walk, "Wave": clip_wave, "Cower": clip_cower}


for name, (src, idle, opt) in VARIANTS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    path = sorted(glob.glob(os.path.join(ROOT, f"art/library/sketchfab/{src}/*.glb")))[0]
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if arm.animation_data:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
        arm.animation_data.action = None
    # Keep the source's motion-capture idle (renamed "Idle"); drop placeholders
    mocap = None
    for a in list(bpy.data.actions):
        if opt.get("mocap_idle") and mocap is None and a.frame_range[1] - a.frame_range[0] > 30:
            mocap = a
            a.name = "Idle"
            a.use_fake_user = True
        else:
            bpy.data.actions.remove(a)
    # Teeth are never seen (mouths stay closed); they're 7k triangles per person
    for o in [o for o in bpy.data.objects if o.type == "MESH" and any("Teeth" in (sl.material.name if sl.material else "") for sl in o.material_slots)]:
        bpy.data.objects.remove(o, do_unlink=True)
    # The sources carry a stray unskinned Icosphere (2 m across): keep only meshes deformed by the rig
    for o in [o for o in bpy.data.objects if o.type == "MESH" and not any(md.type == "ARMATURE" for md in o.modifiers)]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Lighter mesh (keeps skin weights): ~12k triangles for a single-mesh person, ~6k per part (hair 10k) for the
    # multi-part avatars
    multi = len(meshes) > 2
    for m in meshes:
        tris = sum(len(p.vertices) - 2 for p in m.data.polygons)
        mat = m.material_slots[0].material.name if m.material_slots and m.material_slots[0].material else ""
        cap = (10000 if "hair" in mat.lower() else 6000) if multi else 12000
        if tris > cap * 1.15:
            mod = m.modifiers.new("dec", "DECIMATE")
            mod.ratio = cap / tris
            while m.modifiers[0] != mod:
                bpy.context.view_layer.objects.active = m
                bpy.ops.object.modifier_move_up(modifier="dec")
            bpy.context.view_layer.objects.active = m
            bpy.ops.object.modifier_apply(modifier="dec")
    tex = 512 if multi else 1024  # the avatars carry ~16 maps each
    for img in bpy.data.images:
        if max(img.size) > tex:
            k = tex / max(img.size)
            img.scale(int(img.size[0] * k), int(img.size[1] * k))
            img.pack()

    # Normalise: 1.70 m tall, feet on z=0, centred (measured on the deformed vertices; object bounds lie here).
    # Measured in the imported pose, which Rig.reset() restores (the importer keeps the root conversion and a 0.77 m
    # hip offset in the pose bones; zeroing them, as a first version did, sank the feet below the floor).
    capture_base(arm)
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
    k = opt["height"] / (zmax - zmin)
    for o in [o for o in bpy.data.objects if o.parent is None]:
        o.scale = o.scale * k
        o.location = (o.location - Vector((cx, cy, zmin))) * k
    bpy.context.view_layer.update()

    rig = Rig(arm)
    rig.mutant = bool(opt.get("mutant"))
    arm.animation_data_create()
    arm.animation_data.use_nla = False  # author each clip alone (stashed clips would otherwise leak into its keys)
    if mocap:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = "Idle"
        tr.strips.new("Idle", 0, mocap)
    for clip in [*idle, *([] if mocap else ["Idle"]), "Walk", "Run"]:
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

"""First-person arms holding each gun: "FP arms" by bumstrum (CC BY 4.0), posed onto each weapon model and baked.

Output: one static mesh per gun, in that gun's own model frame (art/_public_backup/models/weapons/arms_<gun>.glb),
which the game places exactly like the gun model, under the same recoil/sway/reload root (WeaponView), so the hands
follow every motion of the gun for free.

Posing (Blender coordinates of the gun GLB: forward = -Y, up = +Z, the player's right = -X):
  - the shoulders sit where they would relative to the game camera (WeaponView: gun root at camera (0.2,-0.17,0.45),
    scale 0.55);
  - each arm is a two-bone IK from the shoulder to a wrist target (elbow toward a pole direction);
  - each hand is turned to a target frame (knuckle line, finger direction; the palm follows) and the wrist is nudged
    until the knuckles land on the grip point; fingers and thumb curl around it.
A preview from the in-game camera is rendered next to each output (…/arms_<gun>_view.png) for checking.

Run from idam-jagath/:
  blender --background --factory-startup --python tools/blender/build_fp_arms.py
  node tools/assets/optimize_glb.mjs public/models/weapons/arms_ar_h470.glb public/models/weapons/arms_rl0n_25.glb
"""
import glob
import math
import os

import bpy
from mathutils import Matrix, Vector

ROOT = os.getcwd()
WEAP = os.path.join(ROOT, "art/_public_backup/models/weapons")
ARMS_SRC = sorted(glob.glob(os.path.join(ROOT, "art/library/sketchfab/fp_arms/*.glb")))[0]
PREVIEW = os.environ.get("ARMS_PREVIEW_DIR", "")

GUN_ROOT_CAM = Vector((0.2, -0.17, 0.45))  # WeaponView BASE_X/Y/Z (Babylon camera space)
GUN_SCALE = 0.55                           # WeaponView gun scaling
ARM_REAL_SCALE = 0.9                       # hands a touch smaller than life, to suit the compact guns
CAM_FOV = 1.25                             # data/gameplay/player.json fov (vertical, rad)


def cam_to_blender(p):
    """Babylon camera-space point -> Blender coordinates in the gun model's frame."""
    g = (Vector(p) - GUN_ROOT_CAM) / GUN_SCALE          # Babylon gun frame
    return Vector((-g.x, -g.z, g.y))                    # Babylon (X,Y,Z) = (-bx, bz, -by)


def norm(v):
    return Vector(v).normalized()


GUNS = {
    # grip: right-hand knuckle centre, grip axis (pointing down the grip); fore: left-hand knuckle centre, finger dir
    "ar_h470": {
        "fwd": norm((0, -0.95, -0.30)),
        "grip": Vector((-0.045, 0.02, -0.085)), "grip_axis": norm((0, 0.75, -0.66)),
        "fore": Vector((-0.035, -0.25, -0.115)), "fore_fingers": norm((-1, 0, 0.25)),
        "curl_r": (62, 75, 55), "curl_l": (40, 50, 35),
    },
    "rl0n_25": {
        "fwd": norm((0, -1, 0)),
        "grip": Vector((-0.04, 0.24, -0.075)), "grip_axis": norm((0, 0.42, -0.91)),
        # its foregrip block sits below the bottom of the screen, so the left hand cups the barrel shroud instead
        "fore": Vector((-0.035, -0.17, -0.062)), "fore_fingers": norm((-1, 0, 0.3)),
        "curl_r": (62, 75, 55), "curl_l": (40, 50, 35),
    },
}

SHOULDER_MID_CAM = (0.05, -0.33, 0.16)  # viewmodel cheat: shoulders forward, just under the view, so the arms reach the gun


def bone(arm, key):
    for pb in arm.pose.bones:
        if pb.name.rsplit("_", 1)[0] == key:
            return pb
    raise KeyError(key)


class Arms:
    def __init__(self, arm):
        self.arm = arm
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"

    def W(self, pb):  # world matrix of a pose bone
        return self.arm.matrix_world @ pb.matrix

    def head(self, key):
        return self.arm.matrix_world @ bone(self.arm, key).head

    def set_world(self, pb, mw):
        pb.matrix = self.arm.matrix_world.inverted() @ mw
        bpy.context.view_layer.update()

    def rotate_world(self, key, rot, pivot=None):
        """Rotate a bone (and so its children) by a world-space rotation matrix about its head."""
        pb = bone(self.arm, key)
        mw = self.W(pb)
        loc, q, scl = mw.decompose()
        p = loc if pivot is None else pivot
        new_q = rot.to_quaternion() @ q
        new_loc = p + rot @ (loc - p)
        self.set_world(pb, Matrix.LocRotScale(new_loc, new_q, scl))

    def aim(self, key, target_point):
        pb = bone(self.arm, key)
        mw = self.W(pb)
        loc, q, scl = mw.decompose()
        cur = (q.to_matrix() @ Vector((0, 1, 0))).normalized()
        want = (target_point - loc).normalized()
        r = cur.rotation_difference(want)
        self.set_world(pb, Matrix.LocRotScale(loc, r @ q, scl))

    def ik(self, side, wrist, pole):
        """Two-bone IK: arm.<s> from the shoulder to the elbow, elbow+forearm.<s> on to the wrist."""
        s = side
        S = self.head(f"arm.{s}")
        a = (self.head(f"elbow.{s}") - S).length
        b = (self.head(f"hand.{s}") - self.head(f"elbow.{s}")).length
        d_vec = wrist - S
        d = min(d_vec.length, (a + b) * 0.999)
        u = d_vec.normalized()
        v = (pole - pole.dot(u) * u).normalized()
        cos_a = max(-1, min(1, (a * a + d * d - b * b) / (2 * a * d)))
        E = S + a * (cos_a * u + math.sqrt(1 - cos_a * cos_a) * v)
        self.aim(f"arm.{s}", E)
        self.aim(f"elbow.{s}", S + u * d)
        self.aim(f"forearm.{s}", S + u * d)

    def hand_frame(self, side):
        h = self.head(f"hand.{side}")
        k = self.head(f"middle1.{side}")
        finger = (k - h).normalized()
        knuckle = (self.head(f"point1.{side}") - self.head(f"pink1.{side}"))
        knuckle = (knuckle - knuckle.dot(finger) * finger).normalized()
        return finger, knuckle, k

    def orient_hand(self, side, finger_t, knuckle_t):
        finger_c, knuckle_c, _ = self.hand_frame(side)
        C = Matrix((knuckle_c, finger_c, knuckle_c.cross(finger_c))).transposed()
        kt = (knuckle_t - knuckle_t.dot(finger_t) * finger_t).normalized()
        T = Matrix((kt, finger_t, kt.cross(finger_t))).transposed()
        self.rotate_world(f"hand.{side}", T @ C.transposed())

    def curl(self, side, angles, thumb=40):
        finger, knuckle, _ = self.hand_frame(side)
        palm = knuckle.cross(finger) if side == "R" else finger.cross(knuckle)
        axis = knuckle if (knuckle.cross(finger)).dot(palm) > 0 else -knuckle
        for f in ("point", "middle", "ring", "pink"):
            for i, ang in enumerate(angles, start=1):
                self.rotate_world(f"{f}{i}.{side}", Matrix.Rotation(math.radians(ang), 3, axis))
        # thumb wraps around the other side of the grip
        t_axis = finger if (finger.cross(knuckle)).dot(palm) > 0 else -finger
        for i, ang in enumerate((thumb * 0.5, thumb, thumb * 0.7), start=1):
            self.rotate_world(f"thumb{i}.{side}", Matrix.Rotation(math.radians(ang), 3, t_axis))


def pose_hand(rig, side, knuckle_target, finger_t, knuckle_t, pole, iters=4):
    """IK the arm so that, with the hand oriented to (finger_t, knuckle_t), its knuckle centre lands on the target."""
    wrist = knuckle_target - finger_t * 0.15
    for _ in range(iters):
        rig.ik(side, wrist, pole)
        rig.orient_hand(side, finger_t, knuckle_t)
        _, _, k = rig.hand_frame(side)
        wrist += knuckle_target - k
    _, _, k = rig.hand_frame(side)
    print(f"HAND {side}: knuckle miss {(k - knuckle_target).length:.3f}, shoulder->wrist {(wrist - rig.head(f'arm.{side}')).length:.3f}")


def build(gun, cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(WEAP, f"{gun}.glb"))
    gun_objs = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ARMS_SRC)
    new = [o for o in bpy.data.objects if o not in gun_objs]
    for o in [o for o in new if o.type == "MESH" and not any(m.type == "ARMATURE" for m in o.modifiers)]:
        bpy.data.objects.remove(o, do_unlink=True)  # stray icosphere in the source
    new = [o for o in bpy.data.objects if o not in gun_objs]
    arm = next(o for o in new if o.type == "ARMATURE")
    mesh = next(o for o in new if o.type == "MESH")
    top = [o for o in new if o.parent is None]

    # Scale/place the whole rig: shoulders at the body position relative to the camera, arms reaching forward (-Y)
    k = ARM_REAL_SCALE / GUN_SCALE
    bpy.context.view_layer.update()
    rig = Arms(arm)
    mid = (rig.head("arm.L") + rig.head("arm.R")) / 2
    for o in top:
        o.scale = o.scale * k
    bpy.context.view_layer.update()
    mid = (rig.head("arm.L") + rig.head("arm.R")) / 2
    shift = cam_to_blender(SHOULDER_MID_CAM) - mid
    for o in top:
        o.location = o.location + shift
    bpy.context.view_layer.update()

    fwd = cfg["fwd"]
    # Right hand on the pistol grip: knuckle line up the grip, fingers forward (then curled round), palm toward the gun
    g = cfg["grip_axis"]
    finger_r = (fwd - fwd.dot(g) * g).normalized()
    pose_hand(rig, "R", cfg["grip"], finger_r, -g, pole=norm((-1, 0.3, -1)))
    rig.curl("R", cfg["curl_r"])
    # Left hand: under the forend (fingers across to the far side) or on a vertical foregrip (like the right hand)
    if "fore_axis" in cfg:
        ga = cfg["fore_axis"]
        finger_l = (fwd - fwd.dot(ga) * ga).normalized()
        pose_hand(rig, "L", cfg["fore"], finger_l, -ga, pole=norm((1, 0.2, -1)))
    else:
        pose_hand(rig, "L", cfg["fore"], cfg["fore_fingers"], fwd, pole=norm((1, 0.3, -1)))
    rig.curl("L", cfg["curl_l"])

    if PREVIEW:
        render_view(os.path.join(PREVIEW, f"arms_{gun}_view.png"))
        render_view(os.path.join(PREVIEW, f"arms_{gun}_side.png"), side=True)

    # Bake the pose into the mesh, drop the rig and the gun, export in the gun's frame
    bpy.context.view_layer.objects.active = mesh
    for m in list(mesh.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = mw
    for o in list(bpy.data.objects):
        if o != mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    for img in bpy.data.images:
        if max(img.size) > 1024:
            s = 1024 / max(img.size)
            img.scale(int(img.size[0] * s), int(img.size[1] * s))
    out = os.path.join(WEAP, f"arms_{gun}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_skins=False, export_animations=False,
                              export_image_format="JPEG", export_jpeg_quality=85)
    print(f"ARMS {gun}: tris={sum(len(p.vertices) - 2 for p in mesh.data.polygons)} kb={os.path.getsize(out) // 1024}")


def render_view(path, side=False):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.light = "STUDIO"
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = CAM_FOV
    cam.data.clip_start = 0.01
    cam.location = cam_to_blender((0, 0, 0))
    cam.rotation_euler = (math.radians(90), 0, 0)  # look along -Y? default looks -Z; X+90 -> looks +Y
    cam.rotation_euler = (math.radians(90), 0, math.radians(180))  # look along -Y (Babylon forward)
    if side:  # from the player's left (Blender +X), orthographic, framing the gun and hands
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 1.4
        cam.location = Vector((2.0, 0.2, 0.0))
        cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


for gun, cfg in GUNS.items():
    build(gun, cfg)

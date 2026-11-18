"""Bake a global-illumination lightmap for the Level 1 shell (Cycles, headless).

Run AFTER build_level.py (from idam-jagath/):
  blender --background --factory-startup --python tools/blender/bake_level.py [-- --size 4096 --samples 256]

What it does
1. Opens tools/blender/src/level1.blend and repacks UV1 ("LightmapUV") of every shell object into ONE shared atlas
   (uniform texel density), then re-saves the .blend and re-exports public/models/level/level1.glb (same geometry and
   source_hash; only TEXCOORD_1 changes).
2. Adds static occluders (the Charminar model at its game position) and the light sources that the lightmap captures:
   a neutral sky dome, warm sodium lamps and the fires (positions from data/level/level1.json). The moon is NOT baked;
   it stays a real-time light in game (it casts the dynamic shadows).
3. Bakes Diffuse (direct + indirect, no albedo) = how much light reaches each texel, including bounce light and
   contact occlusion, into a float atlas.
4. Normalises it so open ground under the sky = 1.0 (so the game's overall exposure doesn't change), clamps to 0..2,
   stores value/2 gamma-encoded (x^(1/2.2)) in public/textures/lightmaps/level1_lightmap.jpg, plus a JSON with
   the encoding and the shell's source_hash. In game it multiplies all lighting on the shell (level = 2):
   corners and under-awning areas darken, lamp/fire pools brighten warm.
"""
import json
import math
import os
import struct
import sys
import time
import zlib

import bpy
import numpy as np

ROOT = os.getcwd()
BLEND = os.path.join(ROOT, "tools/blender/src/level1.blend")
GLB = os.path.join(ROOT, "public/models/level/level1.glb")
DATA = os.path.join(ROOT, "data/level/level1.json")
# Occluder source: the Charminar's .blend (independent of the web GLB, which may be compressed for delivery)
CHARMINAR_BLEND = os.path.join(ROOT, "tools/blender/src/charminar_skfb.blend")
OUT_DIR = os.path.join(ROOT, "public/textures/lightmaps")
OUT_PNG = os.path.join(OUT_DIR, "level1_lightmap.png")   # intermediate (lossless), converted to JPG
OUT_JPG = os.path.join(OUT_DIR, "level1_lightmap.jpg")
OUT_META = os.path.join(OUT_DIR, "level1_lightmap.json")

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return type(default)(args[args.index(name) + 1]) if name in args else default
SIZE = arg("--size", 4096)
SAMPLES = arg("--samples", 256)
LREF = arg("--lref", 0.0)       # irradiance that maps to 1.0; 0 = auto (median of lit texels)
CONTRAST = arg("--contrast", 0.65)  # exponent on L/LREF: <1 compresses (keeps deep lanes from going too dark)
GAIN_MAX = 2.0                   # stored range 0..2 (texture holds value/2)
RAW = arg("--raw", "")           # optional path to cache the raw float bake (.npy)
ENCODE_ONLY = "--encode-only" in args  # re-encode from --raw without baking (fast tuning)


def g2b(x, y, z):
    """Game (x, y, z) +Y up → Blender (x, -z, y)."""
    return (x, -z, y)


def main():
    t0 = time.time()
    if ENCODE_ONLY:
        raw = np.load(RAW)
        encode(raw, json.load(open(OUT_META))["source_hash"] if os.path.exists(OUT_META) else None, raw.shape[0], t0)
        return
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    sc = bpy.context.scene
    data = json.load(open(DATA))
    vis = bpy.data.collections["Level_Visual"]
    targets = [o for o in vis.objects if o.type == "MESH"]

    # ── 1) One shared lightmap atlas on UV1 ──
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets:
        o.select_set(True)
        o.data.uv_layers.active = o.data.uv_layers["LightmapUV"]
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.0012)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in targets:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        o.data.uv_layers["UVMap"].active_render = True
    sc["lightmap_uv"] = "atlas-v1"
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False)
    print(f"ATLAS_OK objects={len(targets)} glb_kb={os.path.getsize(GLB) // 1024}")

    # ── 2) Bake scene: occluders, lights, a neutral grey material with the atlas as the active bake target ──
    for o in bpy.data.collections.get("Level_Colliders", vis).objects:
        o.hide_render = True
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(CHARMINAR_BLEND, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "Charminar"]
    for o in dst.objects:
        sc.collection.objects.link(o)
        o.location = g2b(0, 0, 86)   # .blend is Z-up with origin at the base centre
    occluder_mat = bpy.data.materials.new("Occluder")
    occluder_mat.use_nodes = True
    occluder_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.5, 0.42, 1)
    for o in set(bpy.data.objects) - before:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(occluder_mat)

    img = bpy.data.images.new("level1_lightmap", SIZE, SIZE, alpha=False, float_buffer=True)
    bake_mat = bpy.data.materials.new("LightmapBake")
    bake_mat.use_nodes = True
    nt = bake_mat.node_tree
    nt.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.4, 0.38, 1)  # bounce albedo
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.nodes.active = node
    for o in targets:
        o.data.materials.clear()
        o.data.materials.append(bake_mat)
        o.data.uv_layers.active = o.data.uv_layers["LightmapUV"]   # bake into UV1

    # Neutral sky dome (the game supplies sky colour/intensity in real time; the bake only captures how much of it
    # reaches each point, plus local warm sources)
    world = bpy.data.worlds.new("BakeSky")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

    def point(name, gx, gy, gz, watts, rgb, radius=0.25):
        ld = bpy.data.lights.new(name, "POINT")
        ld.energy = watts
        ld.color = rgb
        ld.shadow_soft_size = radius
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        ob.location = g2b(gx, gy, gz)
    sodium = (1.0, 0.68, 0.36)
    for (x, z) in data["lights"]["lamps"]:
        # lamp heads hang ~1 m out from the post over the lane, ~4.9 m up
        point("lamp", x - math.copysign(1.0, x), 4.9, z, 700, sodium, 0.3)
    fire = (1.0, 0.45, 0.12)
    for (x, y, z) in data["lights"]["fires"]:
        point("fire", x, 1.5, z, 320, fire, 0.6)
    for p in data["props"]:
        for e in p.get("effects", []):
            x, y, z = e["pos"]
            if e["type"] == "burningCar":
                point("fire", x, y, z, 380, fire, 0.6)
            elif e["type"] == "smoulder":
                point("smoulder", x, y, z, 90, fire, 0.4)

    # ── 3) Bake ──
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU" if any(d.use and d.type != "CPU" for d in prefs.devices) else "CPU"
    except Exception as e:  # noqa: BLE001
        print("GPU unavailable, using CPU:", e)
        sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 6
    sc.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    tb = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=6, use_clear=True)
    print(f"BAKE_OK device={sc.cycles.device} size={SIZE} samples={SAMPLES} secs={time.time() - tb:.0f}")

    # ── 4) Normalise, encode, write ──
    px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(SIZE, SIZE, 4)[:, :, :3].copy()
    if RAW:
        np.save(RAW, rgb)
    encode(rgb, sc.get("source_hash"), SIZE, t0)


def encode(rgb, source_hash, size, t0):
    lum = rgb.mean(axis=2)
    lit = lum[lum > 0.02]
    lref = LREF if LREF > 0 else float(np.median(lit))
    m = np.clip(np.power(np.maximum(rgb, 0) / lref, CONTRAST), 0.0, GAIN_MAX)
    enc = np.power(m / GAIN_MAX, 1 / 2.2)
    out = (np.clip(enc, 0, 1) * 255 + 0.5).astype(np.uint8)
    out = np.flipud(out)  # Blender rows start at the bottom; image files start at the top (= glTF v = 0)
    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(OUT_PNG, out)
    os.system(f'sips -s format jpeg -s formatOptions 88 "{OUT_PNG}" --out "{OUT_JPG}" >/dev/null 2>&1')
    if os.path.exists(OUT_JPG):
        os.remove(OUT_PNG)
    meta = {
        "image": "level1_lightmap.jpg" if os.path.exists(OUT_JPG) else "level1_lightmap.png",
        "uv": 1, "source_hash": source_hash, "encoding": "gamma2.2", "level": GAIN_MAX,
        "lref": round(lref, 4), "contrast": CONTRAST, "size": size, "samples": SAMPLES,
        "note": "multiply (shadow-map) lightmap: value/level stored gamma-encoded; 1.0 = open ground under the sky",
    }
    json.dump(meta, open(OUT_META, "w"), indent=1)
    stats = np.percentile(m[:, :, 1][m[:, :, 1] > 0.001], [5, 50, 95])
    print(f"LIGHTMAP_OK {meta['image']} kb={os.path.getsize(os.path.join(OUT_DIR, meta['image'])) // 1024} "
          f"p5/p50/p95={stats.round(2).tolist()} total_secs={time.time() - t0:.0f}")


def write_png(path, arr):
    """Minimal RGB8 PNG writer (no colour management: values are written exactly)."""
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


main()

"""Resize the scene HDRI (the game prefilters it into a 256 px cube, so 1K equirect is plenty).
blender --background --factory-startup --python tools/assets/resize_hdri.py
Source: art/_public_backup/hdri/<name>.hdr → public/hdri/<name>.hdr (same name/format; content 1024x512)."""
import bpy, os
src = os.path.join(os.getcwd(), "art/_public_backup/hdri/cobblestone_street_night_2k.hdr")
out = os.path.join(os.getcwd(), "public/hdri/cobblestone_street_night_2k.hdr")
img = bpy.data.images.load(src)
img.scale(1024, 512)
img.filepath_raw = out
img.file_format = "HDR"
img.save()
print("HDRI", img.size[:], os.path.getsize(out))

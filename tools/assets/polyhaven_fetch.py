"""Fetch CC0 assets from Poly Haven (https://polyhaven.com) into the project asset library.

Usage (from idam-jagath/):
  python3 -I tools/assets/polyhaven_fetch.py textures 2k <id> [<id> ...]
  python3 -I tools/assets/polyhaven_fetch.py models   1k <id> [<id> ...]
  python3 -I tools/assets/polyhaven_fetch.py hdris    2k <id> [<id> ...]

Output: art/library/polyhaven/<type>/<id>/...  plus art/library/polyhaven/manifest.json
- Textures: color (diff), OpenGL normal (nor_gl), packed AO/Rough/Metal (arm) as JPG.
- Models: glTF (.gltf + .bin + textures) at the chosen texture resolution.
- HDRIs: .hdr
Every file is checked against Poly Haven's md5. All Poly Haven assets are CC0 (no attribution required),
but we still record source + license in the manifest.
"""
import hashlib
import json
import os
import sys
import time
import urllib.request

API = "https://api.polyhaven.com"
UA = "idam-jagath-asset-pipeline/1.0"
ROOT = os.path.join(os.getcwd(), "art", "library", "polyhaven")
MANIFEST = os.path.join(ROOT, "manifest.json")
TEX_MAPS = {"Diffuse": "diff", "nor_gl": "nor_gl", "arm": "arm"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def safe_join(base, rel):
    """Join without allowing path traversal out of `base`."""
    p = os.path.normpath(os.path.join(base, rel))
    if not p.startswith(os.path.normpath(base) + os.sep):
        raise ValueError(f"unsafe path in API response: {rel}")
    return p


def fetch_file(entry, dest):
    if os.path.exists(dest) and hashlib.md5(open(dest, "rb").read()).hexdigest() == entry["md5"]:
        return 0
    data = get(entry["url"])
    if hashlib.md5(data).hexdigest() != entry["md5"]:
        raise ValueError(f"md5 mismatch for {entry['url']}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def main():
    kind, res, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    assert kind in ("textures", "models", "hdris"), kind
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    total = 0
    for aid in ids:
        info = json.loads(get(f"{API}/info/{aid}"))
        files = json.loads(get(f"{API}/files/{aid}"))
        out = os.path.join(ROOT, kind, aid)
        got = []
        if kind == "textures":
            for key, short in TEX_MAPS.items():
                e = files[key][res]["jpg"]
                dest = os.path.join(out, f"{aid}_{short}_{res}.jpg")
                total += fetch_file(e, dest)
                got.append(os.path.relpath(dest, ROOT))
        elif kind == "models":
            g = files["gltf"][res]["gltf"]
            dest = os.path.join(out, f"{aid}.gltf")
            total += fetch_file(g, dest)
            got.append(os.path.relpath(dest, ROOT))
            for rel, e in g.get("include", {}).items():
                d = safe_join(out, rel)
                total += fetch_file(e, d)
                got.append(os.path.relpath(d, ROOT))
        else:
            e = files["hdri"][res]["hdr"]
            dest = os.path.join(out, f"{aid}_{res}.hdr")
            total += fetch_file(e, dest)
            got.append(os.path.relpath(dest, ROOT))
        manifest[aid] = {
            "type": kind, "name": info.get("name", aid), "resolution": res,
            "source": f"https://polyhaven.com/a/{aid}", "license": "CC0",
            "authors": list(info.get("authors", {}).keys()), "files": got,
            "fetched": time.strftime("%Y-%m-%d"),
        }
        print(f"ok  {kind:8s} {aid}")
    os.makedirs(ROOT, exist_ok=True)
    json.dump(manifest, open(MANIFEST, "w"), indent=1, sort_keys=True)
    print(f"downloaded {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

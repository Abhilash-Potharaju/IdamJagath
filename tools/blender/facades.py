"""Facade kit: Hyderabad old-city building fronts to dress the plain gray-box blocks.

Run:  blender --background --factory-startup --python tools/blender/facades.py
Output: public/models/facades.glb, tools/blender/previews/facades.png, tools/blender/src/facades.blend

Conventions for every module (top-level node):
- Origin = bottom centre of the BACK face (the face that touches the building wall), at Blender y = 0.
- The front faces Blender -Y (= Babylon +Z = game north by default); details protrude up to ~0.75 m towards -Y.
  Roof water tanks sit BEHIND the back face (y > 0), on the building's roof.
- Width x height in the name: Facade_A_4x9 = 4 m wide, 9 m tall.
- Each module has one child `<Module>_Sign`: a UV-mapped (0..1) quad over the shop sign band for text later.
- Lit windows use the shared emissive material `WindowLit` (about 30 % of windows); dark glass is `GlassDark`.
In the file the modules are laid out side by side along X for the preview; in the game, clone a node and set its
position directly (ignore the layout offset, see README).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.reset()
rnd = random.Random(11)

# ───────────────────────── shared materials ─────────────────────────
LIT = C.mat("WindowLit", "#ffb347", rough=0.5, emit="#ffb347", strength=3.0)
GLASS = C.mat("GlassDark", "#1c2430", rough=0.15, metal=0.3)
SHOP_DARK = C.mat("ShopDark", "#24190f", rough=0.9)
IRON = C.mat("IronRail", "#1e2421", rough=0.6, metal=0.5)
TRIM = C.mat("TrimWhite", "#efe8d8", rough=0.85)
CHAJJA = C.mat("ConcreteLedge", "#b9b3a6", rough=0.95)
AC_MAT = C.mat("ACUnit", "#d4d6d4", rough=0.5)
AC_GRILL = C.mat("ACGrill", "#4a4f52", rough=0.6, metal=0.3)
TANK = C.mat("WaterTankBlack", "#1b1b1d", rough=0.5)
SHUT_GREEN = C.mat("ShutterGreen", "#2f6b3a", rough=0.7)
SHUT_BLUE = C.mat("ShutterBlue", "#2d5d9a", rough=0.7)
SHUT_BROWN = C.mat("ShutterBrown", "#6b3f22", rough=0.8)
ROLL_GREY = C.mat("RollShutterGrey", "#7d8288", rough=0.45, metal=0.6)
ROLL_TEAL = C.mat("RollShutterTeal", "#3d7f80", rough=0.5, metal=0.5)
ROLL_BLUE = C.mat("RollShutterBlue", "#33558a", rough=0.5, metal=0.5)
COUNTER = C.mat("ShopCounter", "#7a4a2a", rough=0.8)
GOODS = [C.mat(f"Goods{i}", c, rough=0.6) for i, c in enumerate(
    ["#e8742a", "#2e8b57", "#d4304a", "#f2c230", "#3a7bd5", "#9b59b6", "#f5f0e1"])]
CLOTH = [C.mat(f"Cloth{i}", c, rough=0.9) for i, c in enumerate(
    ["#e94e77", "#f2c230", "#3a7bd5", "#2e8b57", "#ffffff", "#e8742a"])]
LINE = C.mat("LaundryLine", "#2a2a2a", rough=0.8)
BANNER_SAFFRON = C.mat("BannerSaffron", "#f28c28", rough=0.9)
BANNER_GREEN = C.mat("BannerGreen", "#138808", rough=0.9)
BANNER_PURPLE = C.mat("BannerPurple", "#7b2d8e", rough=0.9)


def shade(hexcol, k):
    h = hexcol.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "#%02x%02x%02x" % (int(r * k), int(g * k), int(b * k))


# ───────────────────────── building blocks ─────────────────────────

def arch_pts(w, h, pointed=True, steps=6):
    """Window outline in XZ (bottom at z = 0): straight sides then a (pointed) arch."""
    r = w / 2
    spring = h - r * (1.25 if pointed else 1.0)
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(steps + 1):
        a = math.pi / 2 * i / steps  # right side, bottom -> top
        x = r * math.cos(a)
        z = spring + r * (1.25 if pointed else 1.0) * math.sin(a)
        pts.append((x, z))
    if pointed:
        pts[-1] = (0.0, h)  # sharpen the apex
    for i in range(steps - 1, -1, -1):
        a = math.pi / 2 * i / steps
        pts.append((-r * math.cos(a), spring + r * (1.25 if pointed else 1.0) * math.sin(a)))
    # remove duplicate apex point
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > 1e-4 or abs(out[-1][1] - p[1]) > 1e-4:
            out.append(p)
    return out


def window(parts, x, z, w, h, arched, shutter_mat, wall_trim):
    """One upper-floor window at bottom-centre (x, z) on the wall front (y = -0.25)."""
    lit = rnd.random() < 0.3
    closed = (not lit) and rnd.random() < 0.25
    if arched:
        parts.append(C.prism("winFrame", arch_pts(w + 0.24, h + 0.2), 0.06, wall_trim, loc=(x, -0.27, z - 0.1)))
        parts.append(C.prism("winGlass", arch_pts(w, h), 0.05, LIT if lit else GLASS, loc=(x, -0.30, z)))
    else:
        parts.append(C.box("winFrame", w + 0.24, 0.06, h + 0.2, (x, -0.27, z - 0.1), wall_trim))
        parts.append(C.box("winGlass", w, 0.05, h, (x, -0.30, z), LIT if lit else GLASS))
        # little chajja (sunshade) over rectangular windows
        parts.append(C.box("winChajja", w + 0.5, 0.35, 0.07, (x, -0.42, z + h + 0.12), CHAJJA))
    if closed:
        # shutters closed over the glass
        for s in (-1, 1):
            parts.append(C.box("shutClosed", w / 2 - 0.02, 0.04, h * (0.78 if arched else 1.0),
                               (x + s * w / 4, -0.34, z), shutter_mat))
    elif rnd.random() < 0.75:
        # shutters folded open beside the window
        for s in (-1, 1):
            parts.append(C.box("shutOpen", w * 0.45, 0.04, h * (0.78 if arched else 1.0),
                               (x + s * (w / 2 + w * 0.25 + 0.08), -0.29, z), shutter_mat))
    # window sill
    parts.append(C.box("sill", w + 0.3, 0.18, 0.06, (x, -0.34, z - 0.12), CHAJJA))
    return lit


def balcony(parts, x, z, bw):
    """Small iron-railing balcony; slab top at z."""
    parts.append(C.box("balSlab", bw, 0.5, 0.12, (x, -0.5, z - 0.12), CHAJJA))
    parts.append(C.box("balRail", bw, 0.05, 0.05, (x, -0.73, z + 0.9), IRON))
    parts.append(C.box("balRailMid", bw, 0.03, 0.03, (x, -0.73, z + 0.45), IRON))
    n = max(3, int(bw / 0.6))
    for i in range(n + 1):
        bx = x - bw / 2 + 0.03 + (bw - 0.06) * i / n
        parts.append(C.box("baluster", 0.03, 0.03, 0.9, (bx, -0.73, z), IRON))
    for s in (-1, 1):
        parts.append(C.box("balSide", 0.04, 0.48, 0.05, (x + s * (bw / 2 - 0.02), -0.5, z + 0.9), IRON))


def ac_unit(parts, x, z):
    parts.append(C.box("ac", 0.8, 0.32, 0.5, (x, -0.41, z), AC_MAT))
    parts.append(C.box("acGrill", 0.42, 0.02, 0.42, (x + 0.12, -0.575, z + 0.04), AC_GRILL))


def shop(parts, x, ow, kind):
    """Ground-floor shop opening (bottom at z = 0)."""
    if kind.startswith("roll"):
        m = {"roll_grey": ROLL_GREY, "roll_teal": ROLL_TEAL, "roll_blue": ROLL_BLUE}[kind]
        parts.append(C.box("rollShutter", ow, 0.05, 2.6, (x, -0.28, 0.02), m))
        for i in range(6):
            parts.append(C.box("rollRib", ow, 0.03, 0.04, (x, -0.31, 0.25 + i * 0.4), m))
        parts.append(C.box("rollHousing", ow + 0.12, 0.28, 0.26, (x, -0.39, 2.6), m))
        parts.append(C.box("rollHandle", 0.4, 0.04, 0.05, (x, -0.33, 0.35), IRON))
        # a smudge of grime/graffiti tag in a bright colour
        if rnd.random() < 0.6:
            parts.append(C.box("tag", ow * 0.4, 0.01, 0.35, (x + rnd.uniform(-0.3, 0.3), -0.335, 1.0),
                               rnd.choice(GOODS)))
    else:  # open shop with lit tube-light and goods
        parts.append(C.box("shopInterior", ow, 0.05, 2.62, (x, -0.27, 0.02), SHOP_DARK))
        parts.append(C.box("tubeLight", ow - 0.3, 0.04, 0.08, (x, -0.31, 2.4), LIT))
        for k, sz in enumerate((0.75, 1.35, 1.95)):
            parts.append(C.box("shelf", ow - 0.3, 0.08, 0.04, (x, -0.33, sz), COUNTER))
            for g in range(3):
                gx = x - ow / 2 + 0.35 + (ow - 0.7) * (g + rnd.random() * 0.3) / 3
                parts.append(C.box("goods", 0.28, 0.08, 0.3, (gx, -0.35, sz + 0.04), rnd.choice(GOODS)))
        parts.append(C.box("counter", ow - 0.2, 0.42, 0.9, (x, -0.5, 0.0), COUNTER))
        parts.append(C.box("counterTop", ow - 0.1, 0.48, 0.05, (x, -0.5, 0.9), CHAJJA))


def laundry(parts, x1, x2, z):
    pts = []
    for i in range(9):
        t = i / 8
        pts.append((x1 + (x2 - x1) * t, -0.62, z - 0.25 * 4 * t * (1 - t)))
    parts.append(C.tube("laundryLine", pts, 0.012, LINE, sides=4))
    n = int((x2 - x1) / 0.7)
    for i in range(n):
        t = (i + 0.5) / n
        cx = x1 + (x2 - x1) * t
        cz = z - 0.25 * 4 * t * (1 - t)
        h = rnd.uniform(0.45, 0.8)
        parts.append(C.box("cloth", rnd.uniform(0.3, 0.45), 0.02, h, (cx, -0.62, cz - h), rnd.choice(CLOTH)))


def banner(parts, x, W, H, mat_a, mat_b):
    """Horizontal festival/political banner stretched across the parapet front."""
    parts.append(C.box("banner", W - 0.7, 0.03, 0.55, (x, -0.35, H - 0.64), mat_a))
    parts.append(C.box("bannerStripe", W - 0.7, 0.035, 0.12, (x, -0.355, H - 0.42), mat_b))
    for s_ in (-1, 1):
        parts.append(C.box("bannerTie", 0.05, 0.05, 0.6, (x + s_ * (W / 2 - 0.35), -0.36, H - 0.66), IRON))


def water_tank(parts, x, H):
    parts.append(C.box("tankStand", 1.2, 1.2, 0.25, (x, 0.75, H), CHAJJA))
    parts.append(C.cyl("tank", 0.55, 1.1, (x, 0.75, H + 0.25), seg=10, material=TANK))
    parts.append(C.cyl("tankLid", 0.22, 0.1, (x, 0.75, H + 1.35), seg=8, material=TANK))


# ───────────────────────── modules ─────────────────────────
MODULES = [
    dict(name="Facade_A_4x9", W=4, H=9, wall="#5fa8a0", shut=SHUT_BROWN, arched=True,
         shops=["roll_teal"], sign="#c8302f", balcony={0}, extras={"laundry"}),
    dict(name="Facade_B_4x11", W=4, H=11, wall="#d6a23a", shut=SHUT_GREEN, arched=False,
         shops=["open"], sign="#2e8b57", balcony={1}, extras={"ac"}),
    dict(name="Facade_C_6x9", W=6, H=9, wall="#e08f7a", shut=SHUT_BLUE, arched=False,
         shops=["roll_blue", "roll_grey"], sign="#f2c230", balcony={0}, extras={"tank", "ac"}),
    dict(name="Facade_D_6x11", W=6, H=11, wall="#e9e4d4", shut=SHUT_BLUE, arched=True,
         shops=["open", "open"], sign="#1f5fbf", balcony=set(), extras={"banner", "ac"}),
    dict(name="Facade_E_6x14", W=6, H=14, wall="#6fa8dc", shut=SHUT_GREEN, arched=False,
         shops=["roll_grey", "open"], sign="#d4304a", balcony={0, 2}, extras={"tank", "laundry"}),
    dict(name="Facade_F_4x14", W=4, H=14, wall="#8fd1a8", shut=SHUT_BROWN, arched=True,
         shops=["roll_grey"], sign="#e8742a", balcony={1}, extras={"banner"}),
]

GF = 3.8  # ground-floor height
nodes = []
signs = []
lit_count = 0
win_count = 0
layout = []


def build_module(cfg, X):
    global lit_count, win_count
    W, H = cfg["W"], cfg["H"]
    tag = cfg["name"].split("_")[1]
    wall = C.mat(f"Wall_{tag}", cfg["wall"], rough=0.92)
    grime = C.mat(f"Grime_{tag}", shade(cfg["wall"], 0.55), rough=0.95)
    trim = C.mat(f"Trim_{tag}", shade(cfg["wall"], 1.12) if cfg["wall"] != "#e9e4d4" else "#3d6fb0", rough=0.85)
    sign_mat = C.mat(f"Sign_{tag}", cfg["sign"], rough=0.5, emit=cfg["sign"], strength=0.25)
    p = []
    # wall slab + grime band at the base + upper grime streak under the parapet
    p.append(C.box("wall", W, 0.25, H, (X, -0.125, 0), wall))
    p.append(C.box("grime", W + 0.02, 0.02, 1.1, (X, -0.255, 0), grime))
    p.append(C.box("grimeTop", W + 0.02, 0.02, 0.35, (X, -0.255, H - 1.05), grime))
    # ground floor
    n_shop = len(cfg["shops"])
    ow = (W - 0.6) / n_shop - (0.3 if n_shop > 1 else 0)
    for i, kind in enumerate(cfg["shops"]):
        sx = X - W / 2 + (W / n_shop) * (i + 0.5)
        shop(p, sx, ow, kind)
    # sign band frame + chajja over the shops
    p.append(C.box("signFrame", W - 0.2, 0.1, 0.78, (X, -0.3, 2.8), trim))
    p.append(C.box("gfChajja", W + 0.1, 0.55, 0.12, (X, -0.525, 3.62), CHAJJA))
    # upper floors
    n_fl = max(1, round((H - GF - 0.7) / 2.8))
    fh = (H - GF - 0.7) / n_fl
    xs = [-1.0, 1.0] if W == 4 else [-1.85, 0.0, 1.85]
    ww = 0.9 if W == 4 else 0.95
    wh = min(1.55, fh - 0.75)
    for f in range(n_fl):
        z0 = GF + f * fh
        # floor cornice band
        p.append(C.box("cornice", W + 0.04, 0.12, 0.12, (X, -0.31, z0), trim))
        wz = z0 + (fh - wh) / 2 + 0.05
        for wx in xs:
            lit = window(p, X + wx, wz, ww, wh, cfg["arched"], cfg["shut"], trim)
            win_count += 1
            lit_count += int(lit)
        if f in cfg["balcony"]:
            balcony(p, X, z0 + 0.12, W - 0.8)
        if "ac" in cfg["extras"] and f == n_fl - 1:
            ac_unit(p, X + xs[-1] + (0.0 if W == 6 else 0.0) - 0.05, wz - 0.75 if wz - 0.75 > z0 + 0.2 else z0 + 0.2)
    # parapet + cap
    p.append(C.box("parapet", W, 0.32, 0.7, (X, -0.16, H - 0.7), trim))
    p.append(C.box("parapetCap", W + 0.08, 0.4, 0.08, (X, -0.18, H), CHAJJA))
    for k in range(int(W / 1.0)):
        p.append(C.box("merlon", 0.35, 0.3, 0.25, (X - W / 2 + 0.5 + k, -0.16, H + 0.08), trim))
    # extras
    if "laundry" in cfg["extras"]:
        laundry(p, X - W / 2 + 0.2, X + W / 2 - 0.2, GF + fh * (1 if n_fl > 1 else 0.95) - 0.15)
    if "banner" in cfg["extras"]:
        banner(p, X, W, H, rnd.choice([BANNER_SAFFRON, BANNER_PURPLE]), BANNER_GREEN)
    if "tank" in cfg["extras"]:
        water_tank(p, X - W / 2 + 1.0, H)
        if W == 6 and H >= 14:
            water_tank(p, X + W / 2 - 1.0, H)

    C.apply_all(p)
    ob = C.join(cfg["name"], p)
    C.set_origin(ob, (X, 0, 0))
    C.smooth_by_angle([ob], 35)
    nodes.append(ob)
    # UV-mapped sign quad (child), over the sign frame
    sign = C.quad_uv(f"{cfg['name']}_Sign", W - 0.45, 0.6, (X, -0.36, 2.89), sign_mat)
    C.set_origin(sign, (X, -0.36, 2.89))
    C.parent(sign, ob)
    signs.append(sign)
    layout.append((cfg["name"], X, W, H))


def build_pilaster(H, X):
    p = []
    stone = C.mat("PilasterStone", "#e3c99a", rough=0.9)
    dark = C.mat("PilasterGrime", "#8a7f6c", rough=0.95)
    p.append(C.box("shaft", 0.6, 0.7, H, (X, -0.35, 0), stone))
    p.append(C.box("plinth", 0.75, 0.82, 0.9, (X, -0.41, 0), dark))
    p.append(C.box("capital", 0.78, 0.84, 0.35, (X, -0.42, H - 0.35), stone))
    z = GF
    while z < H - 1.0:
        p.append(C.box("band", 0.7, 0.78, 0.14, (X, -0.39, z), stone))
        z += 2.9
    p.append(C.cyl("finial", 0.18, 0.6, (X, -0.35, H), seg=8, material=stone, r_top=0.02))
    C.apply_all(p)
    name = f"Facade_Pilaster_{H}"
    ob = C.join(name, p)
    C.set_origin(ob, (X, 0, 0))
    C.smooth_by_angle([ob], 35)
    nodes.append(ob)
    layout.append((name, X, 0.6, H))


x = 0.0
for cfg in MODULES:
    x += cfg["W"] / 2
    build_module(cfg, x)
    x += cfg["W"] / 2 + 0.8
for H in (9, 11, 14):
    x += 0.3
    build_pilaster(H, x)
    x += 0.3 + 0.8

C.export_glb("facades", nodes, uvs=True)
C.report("facades", nodes + signs)
for n in nodes:
    lo, hi = C.bbox([n] + list(n.children))
    print(f"MODULE {n.name}: x_center {n.location.x:.2f} | dims {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} | "
          f"y {lo.y:.2f}..{hi.y:.2f} | tris {C.tri_count([n] + list(n.children))}")
print(f"WINDOWS lit {lit_count}/{win_count} = {lit_count / max(1, win_count):.0%}")
C.save_blend("facades")
mid = x / 2
C.render_preview("facades", cam_loc=(mid - 6, -30, 9.0), target=(mid, 0, 6.0), lens=26, res=(1280, 540))

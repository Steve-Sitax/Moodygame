"""Height maps for the town wall's pictures (the bump audit, 2026-09-26; Steve: "textures from the wall are not
bump-mapped and still flat").

The town wall (tools/blender/build_wall.py -> client/public/models/wall.glb, drawn by client/src/world/rampart.ts)
paints its own small pictures in the Blender script and packs them into the glb: the brick in stretcher bond, the
quoins, the grey plinth and the pale ashlar, the slates, the planked doors with their straps, the iron, the windows,
the arms over the gates, the sail cloth. The game draws them pixel sharp. This works out a height map from each of
those pictures as they are in the glb, so every joint, slate edge and strap of the bump lies under the one drawn:

    brick, quoin    the faces high with rounded arrises, the lime mortar sunk. The mortar is lighter than the brick,
                    so the light of the picture is not its height: a joint is where the colour loses its red
                    (saturation), and on the quoins' pale stones where the picture is darker than the stone round it
    plinth, stone   ashlar: the joints are the dark lines of the courses and the cuts
    slate           courses stepping down the roof: the dark row is the butt's edge in shade, the slate over it high,
                    thinning up to the next course; the dark cuts between slates sunk
    wood            planks with sunk gaps, the iron straps proud of them, the nails on top
    iron, canvas    only the grain of the picture (hammered iron, sewn cloth: faint)
    window          the stone frame and sill proud, the glass flat and back, the glazing bars between
    arms            the panel with its sunk frame, the shield raised, the lion proud on it
    coping          (the look pass) bluestone slabs, four side by side: each slab high with a rounded arris all
                    round, the tooled strokes faint, cracks and chipped corners sunk, moss standing in cushions

    python tools/textures/townwall_maps.py            every picture in KINDS
    python tools/textures/townwall_maps.py --check    which height maps are missing or older than their picture

writes client/public/textures/townwall_<name>_h.png and client/public/textures/townwall_maps.json with the SHA-256
of the picture as packed in wall.glb (its PNG's bytes) and how strong the game draws it (three.js bumpScale). The game
(client/src/world/townWallBumps.ts) hashes the pictures of the glb it loaded and uses a height map only with the
picture it was made from: a wall.glb rebuilt with other pictures gets a flat wall until this runs again, never the
old bricks. Previews go to data/shots/townwallh_<name>.jpg.
"""
import hashlib
import json
import os
import struct
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
GLB = os.path.join(ROOT, "client", "public", "models", "wall.glb")
TEX = os.path.join(ROOT, "client", "public", "textures")
SHOTS = os.path.join(ROOT, "data", "shots")
MANIFEST = os.path.join(TEX, "townwall_maps.json")

# material name in wall.glb: (kind of relief, bump strength in the game: three.js bumpScale, which tilts the normal by
# the height's change from one screen pixel to the next; 0.3 and under hardly shows)
KINDS = {
    "wall_brick": ("brick", 1.6),
    "wall_quoin": ("quoin", 1.4),
    "wall_plinth": ("ashlar", 1.2),
    "wall_stone": ("ashlar", 1.1),
    "wall_slate": ("slate", 1.0),
    "wall_wood": ("wood", 1.0),
    "wall_iron": ("grain", 0.45),
    "wall_window": ("window", 0.8),
    "wall_arms": ("arms", 1.1),
    "wall_canvas": ("cloth", 0.3),
    "wall_coping": ("coping", 1.5),
    "wall_props": ("grain", 0.6),
}
OUT = 512  # the longest side of a height map


def glb_images():
    """{material name: PNG bytes} of the glb's base colour pictures."""
    b = open(GLB, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    js = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack("<I", b[off:off + 4])[0]
    binc = b[off + 8:off + 8 + bl]
    out = {}
    for m in js["materials"]:
        t = m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        if t is None:
            continue
        im = js["images"][js["textures"][t]["source"]]
        bv = js["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        out[m["name"]] = binc[o:o + bv["byteLength"]]
    return out


def up(a, s, nearest=True):
    h, w = a.shape[:2]
    return cv2.resize(a.astype(np.float32), (w * s, h * s), interpolation=cv2.INTER_NEAREST if nearest else cv2.INTER_LINEAR)


def tile3(a):
    return np.tile(a, (3, 3))


def mid(a, h, w):
    return a[h:2 * h, w:2 * w]


def wrap_blur(a, sigma):
    h, w = a.shape
    return mid(cv2.GaussianBlur(tile3(a.astype(np.float32)), (0, 0), sigma), h, w)


def detail(lum, s):
    """The picture's own light and dark in a face, -1..1, smoothed up to the height map's size (stone grain)."""
    h, w = lum.shape
    hp = lum - mid(cv2.GaussianBlur(tile3(lum.astype(np.float32)), (0, 0), 2.0), h, w)
    hp = hp / (np.percentile(np.abs(hp), 98) + 1e-6)
    return np.clip(up(hp, s, nearest=False), -1, 1)


def lines_only(mask, n=3):
    """Keep the pixels of a mask that lie on a horizontal or vertical run of at least n (joints, not specks)."""
    m = mask.astype(np.uint8)
    t = tile3(m)
    h, w = m.shape
    hor = cv2.morphologyEx(t, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (n, 1)))
    ver = cv2.morphologyEx(t, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, n)))
    return mid((hor | ver) > 0, h, w)


def faces_height(face, lum, s, floor=0.14, top=0.86, arris=0.7, grain=0.08):
    """Faces high with rounded arrises (arris in picture pixels), the rest at the floor; the picture's grain on top."""
    f = up(face.astype(np.float32), s) > 0.5
    h, w = f.shape
    e = mid(ndi.distance_transform_edt(tile3(f)), h, w)
    dome = np.sqrt(1 - (1 - np.clip(e / (arris * s), 0, 1)) ** 2)
    d = detail(lum, s)
    return np.where(f, floor + (top - floor) * dome + grain * d, floor + 0.03 * d)


def sat_of(img):
    mx = img.max(axis=2)
    mn = img.min(axis=2)
    return (mx - mn) / np.maximum(mx, 1e-3)


def local_ratio(lum, k=5):
    """The picture against the median round each pixel (wrapping): a joint is well under 1."""
    h, w = lum.shape
    med = mid(cv2.medianBlur((tile3(lum) * 255).astype(np.uint8), k).astype(np.float32) / 255, h, w)
    return lum / np.maximum(med, 1e-3)


def brick(img, lum, s):
    joint = sat_of(img) < 0.3
    return faces_height(~joint, lum, s), ~joint


def quoin(img, lum, s):
    low = sat_of(img) < 0.3
    h, w = low.shape
    stone = mid(cv2.morphologyEx(tile3(low.astype(np.uint8)), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))), h, w) > 0
    sl = lum[stone & ~(local_ratio(lum) < 0.82)]
    dark = stone & (lum < 0.8 * (np.median(sl) if sl.size else lum.mean()))
    joint = (low & ~stone) | dark
    return faces_height(~joint, lum, s), ~joint


def ashlar(img, lum, s):
    joint = lines_only(local_ratio(lum, 7) < 0.8, 3)
    return faces_height(~joint, lum, s, floor=0.12, arris=1.0), ~joint


def slate(img, lum, s):
    # (the painter's rows run from the bottom of the picture: work in its way up, turn back at the end)
    L = np.flipud(lum)
    h, w = L.shape
    rows = L.mean(axis=1)
    dark_row = rows < 0.75 * np.median(rows)
    # the course: rows from each dark row (the butt's edge) up to the next
    k = np.zeros(h, np.float32)
    last = -1
    for pass_ in range(2):
        for r in range(h):
            if dark_row[r]:
                last = r
            if last >= 0:
                k[r] = (r - last) % h
    n = max(2, int(np.median(np.diff(np.flatnonzero(dark_row))) if dark_row.sum() > 1 else 8))
    prof = np.where(k == 0, 0.45, 0.95 - 0.4 * (k - 1) / max(1, n - 2))
    base = np.repeat(prof[:, None], w, axis=1)
    cut = lines_only((local_ratio(L, 5) < 0.8) & ~dark_row[:, None], 3)
    base = np.where(cut, 0.2, base)
    hmap = up(base, s, nearest=True)
    hmap = hmap + 0.05 * detail(L, s)
    face = ~cut & ~dark_row[:, None]
    return np.flipud(hmap), np.flipud(face)


def wood(img, lum, s):
    h, w = lum.shape
    strap_row = np.median(lum, axis=1) < 0.16
    strap = np.repeat(strap_row[:, None], w, axis=1)
    nail = strap & (lum > 0.2)
    gap = lines_only((local_ratio(lum, 5) < 0.7) & ~strap, 4)
    plank = ~gap & ~strap
    hp = faces_height(plank, lum, s, floor=0.12, top=0.62, arris=0.8, grain=0.1)
    st = up(strap.astype(np.float32), s) > 0.5
    ht = faces_height(strap, lum, s, floor=0.12, top=0.85, arris=0.5, grain=0.0)
    hmap = np.where(st, np.maximum(hp, ht), hp)
    # the nail heads: round bosses on the straps
    nf = up(nail.astype(np.float32), s) > 0.5
    hn, wn = nf.shape
    e = mid(ndi.distance_transform_edt(tile3(nf)), hn, wn)
    boss = np.sqrt(np.clip(e / max(1.0, 0.5 * s), 0, 1))
    hmap = np.where(nf, np.maximum(hmap, 0.85 + 0.15 * boss), hmap)
    return hmap, plank | strap


def grain(img, lum, s):
    d = detail(lum, s)
    return 0.5 + 0.3 * d, np.ones_like(lum, bool)


def cloth(img, lum, s):
    d = detail(lum, s)
    return 0.55 + 0.3 * d, np.ones_like(lum, bool)


def window(img, lum, s):
    r, b = img[:, :, 0], img[:, :, 2]
    dark = lum < 0.25
    bar = dark & (r > b) & (lum > 0.09)
    glass = dark & ~bar
    frame = ~dark
    hmap = faces_height(frame, lum, s, floor=0.3, top=0.9, arris=0.8, grain=0.05)
    hb = faces_height(bar, lum, s, floor=0.3, top=0.6, arris=0.4, grain=0.0)
    return np.maximum(hmap, hb), frame | bar


def arms(img, lum, s):
    q = np.round(img * 255).astype(int)
    def is_col(c):
        return (np.abs(q - np.round(np.array(c) * 255)).max(axis=2) <= 1)
    h, w = lum.shape
    shield = is_col((0.58, 0.55, 0.48)) | is_col((0.78, 0.74, 0.65)) | is_col((0.36, 0.34, 0.30))
    shield = mid(cv2.morphologyEx(tile3(shield.astype(np.uint8)), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))), h, w) > 0
    shield = ndi.binary_fill_holes(shield)
    lion = shield & is_col((0.36, 0.34, 0.30))
    frame = is_col((0.45, 0.42, 0.37)) & ~shield
    panel = ~shield & ~frame
    hmap = faces_height(panel, lum, s, floor=0.2, top=0.5, arris=1.0, grain=0.04)
    hs = faces_height(shield, lum, s, floor=0.2, top=0.72, arris=1.5, grain=0.0)
    hl = faces_height(lion, lum, s, floor=0.2, top=0.95, arris=0.9, grain=0.0)
    lf = up(lion.astype(np.float32), s) > 0.5
    sf = up(shield.astype(np.float32), s) > 0.5
    hmap = np.where(sf, hs, hmap)
    hmap = np.where(lf, np.maximum(hs, hl), hmap)
    return hmap, panel | shield


def coping(img, lum, s):
    h, w = lum.shape
    cw = 128 if w % 128 == 0 else w  # the picture's slabs (build_wall.py COPING_W)
    x = np.arange(w) % cw
    y = np.arange(h)
    border = (np.minimum(x, cw - 1 - x)[None, :] < 1) | (np.minimum(y, h - 1 - y)[:, None] < 1)
    dark = local_ratio(lum, 7) < 0.72
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    moss = (g > r * 1.15) & (g > b * 1.25) & (lum < 0.4)
    face = ~border & ~(dark & ~moss)
    hmap = faces_height(face, lum, s, floor=0.1, top=0.84, arris=2.2, grain=0.06)
    mf = up(moss.astype(np.float32), s) > 0.5
    return np.where(mf, np.maximum(hmap, 0.93), hmap), face


RELIEF = {"brick": brick, "quoin": quoin, "ashlar": ashlar, "slate": slate, "wood": wood, "grain": grain, "cloth": cloth, "window": window, "arms": arms, "coping": coping}


def make(name, png):
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
    lum = img @ np.array([0.3, 0.59, 0.11], np.float32)
    s = max(1, OUT // max(img.shape[:2]))
    kind, _ = KINDS[name]
    hmap, face = RELIEF[kind](img, lum, s)
    hmap = wrap_blur(np.clip(hmap, 0, 1), 0.35 * s ** 0.5)
    out = np.clip(hmap * 255, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(TEX, f"townwall_{name.removeprefix('wall_')}_h.png"), out)
    os.makedirs(SHOTS, exist_ok=True)
    big = up(img, s)
    vis = big * 0.55
    f = up(face.astype(np.float32), s) < 0.5
    vis[f] = vis[f] * 0.4 + np.array([0.6, 0, 0])
    hv = np.repeat(out[:, :, None], 3, axis=2).astype(np.float32) / 255
    cv2.imwrite(os.path.join(SHOTS, f"townwallh_{name}.jpg"), (np.hstack([big, vis, hv])[:, :, ::-1] * 255).astype(np.uint8))
    return hashlib.sha256(png).hexdigest()


def main(args):
    pics = glb_images()
    have = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    if args[:1] == ["--check"]:
        for name in KINDS:
            png = pics.get(name)
            state = "no picture" if png is None else ("ok" if have.get(name, {}).get("sha256") == hashlib.sha256(png).hexdigest() else "stale")
            print(f"{name:14s} {state}")
        return
    for name in args or list(KINDS):
        if name not in KINDS or name not in pics:
            sys.exit(f"unknown wall picture: {name} (KINDS in {__file__}, materials in wall.glb)")
        have[name] = {"sha256": make(name, pics[name]), "kind": KINDS[name][0], "bump": KINDS[name][1], "map": f"townwall_{name.removeprefix('wall_')}_h.png"}
        print("height map", name, KINDS[name][0])
    json.dump(dict(sorted(have.items())), open(MANIFEST, "w", newline="\n"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])

"""Face pictures on MakeHuman's CC0 skins (docs/people.md "Skin and face pictures").

A face picture is the face square of the face layer (texture-layout.md): MakeHuman's head island over the full height,
the inside of the mouth, the eye sockets, the eyeball's picture (mhbody.EYE_RECT) and two hair swatches the hair
pieces use (HAIR_RECT strands, BRAID_RECT a plait's weave). Its base is one of MakeHuman's skins (young, middle-aged,
old; light, dark, East Asian; mhskin.SKINS) moved into our layout; on top our painter adds what makes a face of
Antwerp in 1873: the skin's tone, weathering, a flush, a drinker's nose, pox scars, freckles, coal dust, stubble, the
scalp's hair or a bald crown, brows and lashes baked from MakeHuman's own brow and lash pictures, the eye's colour, and
a height field (pores, wrinkles, stubble, scars) turned into the normal map.

The painter works per texel on the reference head of the face's group (GROUP_BODY), in that head's own frame (the
eyes' midpoint at the origin, game axes), so masks are measured in metres on the head.
"""

import math

import numpy as np

from . import mh
from . import mhbody
from . import mhskin
from .paint import _noise3

SIZE = 1024
GROUP_BODY = {"m": ("man", "middling"), "f": ("woman", "middling"), "c": ("child", "middling"),
              "om": ("old_man", "stooped"), "of": ("old_woman", "stooped")}
HAIR_RECT = (0.585, 0.395, 0.975, 0.585)  # strands run along v
BRAID_RECT = (0.585, 0.605, 0.975, 0.785)  # a plait's weave
HAIR = {"black": (0.09, 0.075, 0.065), "dark": (0.17, 0.12, 0.09), "brown": (0.32, 0.22, 0.14),
        "light": (0.48, 0.36, 0.23), "fair": (0.62, 0.51, 0.34), "red": (0.47, 0.22, 0.10), "grey": (0.50, 0.48, 0.46),
        "white": (0.72, 0.71, 0.68), "greydark": (0.33, 0.31, 0.30)}
EYES = {"brown": "brown", "brownlight": "brownlight", "blue": "blue", "lightblue": "lightblue", "grey": "grey",
        "green": "green", "deepblue": "deepblue", "bluegreen": "bluegreen"}


# ---------------------------------------------------------------- rasterising in UV space

def raster(uv, attrs, size, pad=0.02):
    """Triangles (n, 3, 2) in UV (0..1, v up) with per-corner attributes (n, 3, k): per pixel the attribute of the
    triangle drawn there (last wins) and a coverage mask."""
    k = attrs.shape[2]
    out = np.zeros((size, size, k), np.float32)
    has = np.zeros((size, size), bool)
    U = uv * size - 0.5
    for t in range(len(U)):
        tri = U[t]
        x0, y0 = np.floor(tri.min(0)).astype(int)
        x1, y1 = np.ceil(tri.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        a, b, c = tri
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -pad) & (l1 >= -pad) & (l2 >= -pad)
        if not m.any():
            continue
        L = np.stack((l0[m], l1[m], l2[m]), 1)
        out[ys[m], xs[m]] = L @ attrs[t]
        has[ys[m], xs[m]] = True
    return out, has


def vertex_normals(V, T):
    n = np.zeros_like(V)
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    for k in range(3):
        np.add.at(n, T[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


# ---------------------------------------------------------------- the reference head of a group

_GEO = {}


def geometry(group):
    """Per texel of the face square: the point of the group's reference head it shows (the head's frame: the eyes'
    midpoint at the origin), its normal, its island; and the head's landmarks and surface (for baking brows)."""
    if group in _GEO:
        return _GEO[group]
    body = mhbody.get_body(*GROUP_BODY[group])
    b = body.b
    P = body.P0
    isl = mhbody.island_ids()
    eyes = (b.cube(P, "l-eye") + b.cube(P, "r-eye")) / 2
    Q = P - eyes
    btris, src = b.tris()
    N = vertex_normals(Q, btris)
    sel = [i for i, fi in enumerate(src)]
    fis = {fi: k for k, fi in enumerate(b.body_faces)}
    uvs, att, tri_ids = [], [], []
    for t, (tri, fi) in enumerate(zip(btris, src)):
        name = isl[fis[fi]]
        if name not in mhbody.FACE_ISLANDS:
            continue
        f = b.F[fi]
        ft = b.FT[fi]
        corner = [f.index(v) for v in tri]
        u = mhbody.face_uv(b.VT[[ft[c] for c in corner]], name)
        uvs.append(u)
        att.append(np.concatenate((Q[tri], N[tri], np.full((3, 1), mhbody.ISLAND_NAMES.index(name))), 1))
        tri_ids.append(t)
    uvs = np.array(uvs)
    att = np.array(att)
    out, has = raster(uvs, att, SIZE)
    G = {"body": body, "pos": out[..., :3], "nrm": out[..., 3:6], "island": np.where(has, out[..., 6], -1).round(),
         "has": has, "eyes": eyes, "Q": Q, "tris": btris[tri_ids], "tri_uv": uvs}
    # landmarks (head frame, metres)
    head = np.isin(body.parts, ("head",)) & np.isin(np.arange(mh.NV), b.body)
    H = Q[head]
    G["eyeL"], G["eyeR"] = b.cube(P, "l-eye") - eyes, b.cube(P, "r-eye") - eyes
    mid = H[np.abs(H[:, 0]) < 0.004]
    nose = mid[(mid[:, 1] < -0.01) & (mid[:, 1] > -0.07)]
    G["nose"] = nose[np.argmax(nose[:, 2])]
    lips = mid[(mid[:, 1] < G["nose"][1] - 0.012) & (mid[:, 1] > G["nose"][1] - 0.05)]
    G["mouth"] = lips[np.argmax(lips[:, 2])]
    G["chin"] = mid[np.argmin(mid[:, 1] - 0.3 * mid[:, 2])]
    G["crown"] = H[np.argmax(H[:, 1])]
    ears = Q[np.isin(np.arange(mh.NV), b.body) & (mh.regions(b).astype(str) == "ear")]
    G["earL"] = ears[ears[:, 0] > 0].mean(0)
    G["earR"] = ears[ears[:, 0] < 0].mean(0)
    _GEO[group] = G
    return G


def bake_card(G, asset_rel, png_rel):
    """MakeHuman's brow or lash cards (an .mhclo asset and its RGBA picture), baked onto the face square: every card
    vertex is put on the head where it lies, and the card's picture drawn there. Returns RGBA (SIZE, SIZE, 4)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    body = G["body"]
    a = mh.MhAsset(asset_rel)
    co = a.fit(body.P0) - G["eyes"]
    tris, tuv = G["tris"], G["tri_uv"]
    bvh = BVHTree.FromPolygons([tuple(p) for p in G["Q"]], [tuple(t) for t in tris], all_triangles=True)
    vuv = np.zeros((len(co), 2))
    for i, p in enumerate(co):
        loc, nrm, fi, d = bvh.find_nearest(Vector(p))
        t = tris[fi]
        w = mh.barycentric(np.array(loc), G["Q"][t[0]], G["Q"][t[1]], G["Q"][t[2]])
        vuv[i] = w @ tuv[fi]
    o = a.obj
    tri_uv, tri_att = [], []
    for f, ft in zip(o["F"], o["FT"]):
        for k in range(1, len(f) - 1):
            idx = [0, k, k + 1]
            uv3 = vuv[[f[j] for j in idx]]
            # a card's triangle that lands across the face (its corners put on far-apart skin) is left out
            if np.linalg.norm(uv3 - uv3.mean(0), axis=1).max() > 0.02:
                continue
            tri_uv.append(uv3)
            tri_att.append(o["VT"][[ft[j] for j in idx]])
    src_uv, has = raster(np.array(tri_uv), np.array(tri_att), SIZE, pad=0.0)
    pic = mhskin.read_png(mh.path(png_rel), channels=4)
    rgba = mhskin.sample(pic, src_uv[..., 0], src_uv[..., 1])
    rgba[~has] = 0
    return rgba


def eye_picture(iris):
    """MakeHuman's eye picture, its iris a little quieter (their irises are bright enough to look painted on at
    1 m in the game's light)."""
    p = mh.path("system/eyes/materials/%s_eye.png" % EYES.get(iris, "brown"))
    pic = mhskin.read_png(p, 3)
    lum = pic.mean(-1, keepdims=True)
    return np.clip(lum + (pic - lum) * 0.72, 0, 1)


# ---------------------------------------------------------------- the painter

def _sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def above(v, a, b):
    """0 below a, 1 above b, smooth between."""
    return _sm(a, b, v)


def below(v, a, b):
    """1 below a, 0 above b, smooth between."""
    return 1.0 - _sm(a, b, v)


HEAD_C = np.array((0.0, 0.02, -0.06))  # the head's middle in the head frame (between the ears, a little high)


def head_angles(pos):
    """Elevation and azimuth (degrees) of head points seen from HEAD_C: azimuth 0 ahead, 90 at the side, 180 behind."""
    d = pos - HEAD_C
    r = np.linalg.norm(d, axis=-1) + 1e-9
    el = np.degrees(np.arcsin(np.clip(d[..., 1] / r, -1, 1)))
    az = np.degrees(np.abs(np.arctan2(d[..., 0], d[..., 2])))
    return el, az


HAIRLINE = {  # azimuth -> elevation of the hairline (men; women a little lower at the front and temples)
    "m": ([0, 25, 45, 62, 78, 92, 110, 135, 160, 180], [27, 28, 26, 17, 6, 0, -12, -38, -55, -60]),
    "f": ([0, 25, 45, 62, 78, 92, 110, 135, 160, 180], [24, 24, 21, 13, 4, -2, -14, -40, -57, -62]),
}


def hairline(az, sex, recede=0.0):
    a, e = HAIRLINE["f" if sex == "f" else "m"]
    line = np.interp(az, a, e)
    # receding temples (older men): the line rises at 30-60 degrees
    return line + recede * 12.0 * np.exp(-((az - 42) / 18.0) ** 2) + recede * 4.0 * np.exp(-(az / 20.0) ** 2)


def bald_line(az):
    """A bald crown: hair only below this elevation, and only at the sides and back."""
    return np.interp(az, [0, 55, 75, 100, 140, 180], [-40, -40, 12, 14, 8, 2])


def beard_zone(pos, G, soft=1.0):
    """Where a man's beard grows, 0..1 (head frame, metres). soft widens every edge (a beard's thinning edge)."""
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    ax = np.abs(x)
    nose, mouth, chin = G["nose"], G["mouth"], G["chin"]
    # below the cheekbones: a line from the nose's wing (low) rising to the sideburn in front of the ear
    cheek_line = nose[1] - 0.012 + 0.55 * np.clip(ax - 0.022, 0, None) + 0.25 * np.clip(ax - 0.05, 0, None)
    zone = below(y, cheek_line - 0.004 * soft, cheek_line + 0.004 * soft)
    zone *= above(z, G["earL"][2] + 0.012, G["earL"][2] + 0.03)  # in front of the ear
    # under the chin and the jaw, fading out down the throat
    zone *= above(y, chin[1] - 0.05 - 0.006 * (soft - 1), chin[1] - 0.025)
    # not on the lips, not on the nose
    lips = ((x / 0.027) ** 2 + ((y - mouth[1]) / 0.011) ** 2)
    zone *= above(lips, 0.85, 1.25)
    nose_m = below(ax, 0.017, 0.023) * above(y, nose[1] - 0.014, nose[1] - 0.008)
    zone *= 1 - nose_m
    # the sideburns up to the ear's middle
    side = above(ax, 0.055, 0.062) * below(y, G["eyeL"][1] - 0.005, G["eyeL"][1] + 0.005) *         above(z, G["earL"][2] + 0.012, G["earL"][2] + 0.025) * below(z, G["earL"][2] + 0.045, G["earL"][2] + 0.06)
    return np.clip(np.maximum(zone, side), 0, 1)


def _blob(pos, c, r):
    return np.exp(-np.sum(((pos - c) / r) ** 2, -1))


def paint(look):
    """A face picture and its normal map (SIZE, v up, sRGB colour; normals OpenGL green-up) for a look:
    group (m, f, c, om, of), skin (light, dark, asian), age (young, middle, old), tone (rgb multiplier), hair (HAIR
    name or rgb), scalp (hair, bald, fringe), brow (eyebrow asset), stubble, weather, ruddy, drinker, pox, freckles,
    soot (0..1), iris, seed."""
    lk = look
    group = lk["group"]
    G = geometry(group)
    sex = "f" if group in ("f", "of") or lk.get("sex") == "f" else "m"
    key = (sex, lk.get("age", "young"), lk.get("skin", "light"))
    if key not in mhskin.SKINS:
        key = (sex, "middle", lk.get("skin", "light")) if (sex, "middle", lk.get("skin", "light")) in mhskin.SKINS \
            else (sex, "young", "light")
    base, cover = mhskin.remap(mhskin.load(key), "face", SIZE)
    rgb = mhskin.dilate(base, cover, 24)
    plain = np.clip(rgb * np.array(lk.get("tone", (1, 1, 1)), np.float32), 0, 1)  # what the body picture has
    pos, nrm, has = G["pos"], G["nrm"], G["has"]
    isl = G["island"]
    head = isl == mhbody.ISLAND_NAMES.index("head")
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    seed = int(lk.get("seed", 1))
    hgt = np.zeros((SIZE, SIZE), np.float32)
    # the skin's tone: the cheeks' mean moved to the look's colour, the rest with it
    cheek = head & (np.abs(x) > 0.025) & (np.abs(x) < 0.05) & (y < -0.01) & (y > -0.04) & (z > 0)
    tone = np.array(lk.get("tone", (1, 1, 1)), np.float32)
    rgb = np.clip(rgb * tone, 0, 1)
    # weathering: outdoor skin darker, browner and rougher on the face's front
    w = float(lk.get("weather", 0.0))
    front = _sm(-0.06, 0.04, z) * head
    if w > 0:
        n = 0.5 + 0.5 * _noise3(pos, 90.0, seed)
        rgb = rgb * (1 - 0.12 * w * front[..., None]) * (1 - 0.06 * w * n[..., None] * front[..., None])
        rgb[..., 2] *= (1 - 0.06 * w * front)
    # a flush on the cheeks, the nose and the ears; a drinker's nose
    ruddy = float(lk.get("ruddy", 0.0))
    drink = float(lk.get("drinker", 0.0))
    flush = (_blob(pos, np.array((0.033, -0.032, G["nose"][2] - 0.025)), np.array((0.02, 0.016, 0.03))) +
             _blob(pos, np.array((-0.033, -0.032, G["nose"][2] - 0.025)), np.array((0.02, 0.016, 0.03))))
    nose = _blob(pos, G["nose"] + np.array((0, 0.004, -0.004)), np.array((0.012, 0.014, 0.012)))
    ears = _blob(pos, G["earL"], 0.03) + _blob(pos, G["earR"], 0.03)
    red = np.array((1.0, 0.80, 0.80), np.float32)
    m = np.clip(ruddy * 0.45 * flush + (ruddy * 0.35 + drink * 0.6) * nose + ruddy * 0.25 * ears, 0, 0.75) * has
    rgb = rgb * (1 - m[..., None]) + rgb * red * m[..., None]
    if drink > 0:
        veins = np.clip(_noise3(pos * np.array((1.0, 2.5, 1.0)), 900.0, seed + 3) - 0.55, 0, 1) * 2.2
        vm = (nose * 1.2 + flush * 0.6) * drink * veins
        rgb = rgb * (1 - 0.35 * vm[..., None]) + np.array((0.55, 0.12, 0.12)) * 0.35 * vm[..., None]
    # pox scars: small round pits on the cheeks and forehead
    pox = float(lk.get("pox", 0.0))
    if pox > 0:
        rng = np.random.default_rng(seed + 11)
        pits = rng.normal(0, 1, (int(140 * pox), 3)) * np.array((0.035, 0.03, 0.01))
        pits[:, 2] = 0
        zone = head & (z > -0.02)
        P2 = pos[zone]
        dmin = np.full(len(P2), 1.0)
        for c in pits:
            c3 = np.array((c[0], c[1] - 0.005, 0.0))
            d = np.sqrt((P2[:, 0] - c3[0]) ** 2 + (P2[:, 1] - c3[1]) ** 2)
            dmin = np.minimum(dmin, d)
        pit = np.clip(1 - dmin / 0.0016, 0, 1)
        sub = rgb[zone]
        rgb[zone] = sub * (1 - 0.18 * pit[:, None])
        hgt[zone] -= 0.00025 * pit
    # freckles
    fr = float(lk.get("freckles", 0.0))
    if fr > 0:
        sp = np.clip(_noise3(pos, 1400.0, seed + 5) - 0.35, 0, 1) * 3
        fm = fr * sp * _blob(pos, np.array((0, -0.02, 0.07)), np.array((0.06, 0.04, 0.06))) * head
        rgb = rgb * (1 - 0.30 * fm[..., None]) + np.array((0.55, 0.32, 0.18)) * 0.30 * fm[..., None]
    hair = np.array(HAIR.get(lk.get("hair"), lk.get("hair_rgb", HAIR["brown"])) if isinstance(lk.get("hair"), str)
                    else lk.get("hair", HAIR["brown"]), np.float32)
    # the scalp: hair-coloured under the hair pieces (no skin through a gap), or a bald crown with a fringe
    scalp = lk.get("scalp", "hair")
    el, az = head_angles(pos)
    line = hairline(az, sex, lk.get("recede", 0.0)) + 1.2 * _noise3(pos, 70.0, seed + 41)
    thin = 0.55 + 0.45 * np.clip(_noise3(pos, 900.0, seed + 47) * 0.8 + 0.5, 0, 1)  # single hairs at the line
    sc = above(el, line - 3.0, line + 3.5) * head
    sc = np.where(el < line + 3.5, sc * thin, sc)
    if scalp == "bald":
        bl = bald_line(az) + 3.0 * _noise3(pos, 120.0, seed + 43)
        sc = sc * below(el, bl - 5.0, bl + 3.0) * 0.85
    if scalp != "none":
        strands = 0.5 + 0.5 * _noise3(pos * np.array((1.0, 0.3, 1.0)), 650.0, seed + 7)
        hc = hair * (0.52 + 0.30 * strands[..., None])  # as dark as the shaded hair pieces over it (no light rim)
        sc = sc * (0.80 + 0.2 * strands)
        rgb = rgb * (1 - 0.95 * sc[..., None]) + hc * 0.95 * sc[..., None]
        hgt += 0.00025 * sc * strands
    # stubble: the beard's zone (below the cheekbones, the upper lip, the chin, under the jaw, the sideburns)
    st = float(lk.get("stubble", 0.0))
    if st > 0:
        zone = beard_zone(pos, G) * head
        dots = np.clip(_noise3(pos, 2200.0, seed + 9) * 0.5 + 0.55, 0, 1)
        sm_ = zone * st
        rgb = rgb * (1 - 0.42 * sm_[..., None] * dots[..., None]) + hair * 0.42 * sm_[..., None] * dots[..., None]
        rgb[..., 2] = rgb[..., 2] * (1 + 0.05 * sm_)
        hgt += 0.00005 * sm_ * dots
    # soot
    so = float(lk.get("soot", 0.0))
    if so > 0:
        n = np.clip(_noise3(pos, 45.0, seed + 13) * 0.6 + 0.4, 0, 1)
        sm_ = so * n * head * (0.5 + 0.5 * front)
        rgb = rgb * (1 - 0.45 * sm_[..., None])
    # brows and lashes from MakeHuman's own pictures, in the look's hair colour
    brow = lk.get("brow", "eyebrow001")
    bc = bake_card(G, "system/eyebrows/%s" % brow, "system/eyebrows/%s/%s.png" % (brow, brow))
    a = np.clip(bc[..., 3] * float(lk.get("brow_k", 1.0)), 0, 1)
    shade = 0.7 + 0.6 * bc[..., :3].mean(-1, keepdims=True)
    bcol = np.clip(hair * 0.9 * shade, 0, 1)
    rgb = rgb * (1 - a[..., None]) + bcol * a[..., None]
    hgt += 0.00012 * a
    lash = lk.get("lash", "eyelashes01")
    lc = bake_card(G, "system/eyelashes/%s" % lash, "system/eyelashes/%s/%s.png" % (lash, lash))
    la = np.clip(lc[..., 3] * 0.55, 0, 1)
    rgb = rgb * (1 - la[..., None]) + np.array((0.05, 0.04, 0.035)) * la[..., None]
    # toward the neck's seam the face's own paint fades into the plain skin the body picture has (no step)
    holes = (np.linalg.norm(pos - G["eyeL"], axis=-1) < 0.03) | (np.linalg.norm(pos - G["eyeR"], axis=-1) < 0.03) |         (np.linalg.norm((pos - G["mouth"]) * (1, 1.4, 1), axis=-1) < 0.04)
    edge = np.where(holes, 1.0, seam_fade(head, 40))  # the neck's seam, not the lids' and lips' edges
    rgb = plain * (1 - edge[..., None]) + rgb * edge[..., None]
    # pores and fine relief everywhere on the skin; wrinkles from the skin's own darker lines (a high pass)
    lum = rgb.mean(-1)
    hp = lum - blur(lum, 6)
    skin = has & (isl >= 0)
    hgt += np.where(skin, 0.0011 * hp, 0)
    pores = _noise3(pos, 3000.0, seed + 17) * 0.5 + _noise3(pos, 1100.0, seed + 19) * 0.5
    hgt += np.where(head, 0.000035 * pores * (1 - sc), 0)
    # the eyeball's picture (MakeHuman's, by the eye's colour) in its corner of the square
    eye = eye_picture(lk.get("iris", "brown"))
    u0, v0, u1, v1 = mhbody.EYE_RECT
    x0, y0, x1, y1 = int(u0 * SIZE), int(v0 * SIZE), int(u1 * SIZE), int(v1 * SIZE)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    ev = mhskin.sample(eye, (xx - x0 + 0.5) / (x1 - x0), (yy - y0 + 0.5) / (y1 - y0))
    ev = ev * np.array((0.86, 0.84, 0.82))  # the whites dimmed (they glow in the fog otherwise)
    rgb[y0:y1, x0:x1] = ev
    # the hair swatches: strands along v, and a plait's weave
    for (a0, b0, a1, b1), braid in ((HAIR_RECT, False), (BRAID_RECT, True)):
        X0, Y0, X1, Y1 = int(a0 * SIZE), int(b0 * SIZE), int(a1 * SIZE), int(b1 * SIZE)
        yy, xx = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)
        u = (xx - X0) / (X1 - X0)
        v = (yy - Y0) / (Y1 - Y0)
        p3 = np.stack((u * 0.12, v * 0.5, np.zeros_like(u)), -1)
        if braid:
            ph = (v * 7 + 0.5 * np.abs(np.sin(u * math.pi * 3))) % 1.0
            band = np.sin(ph * math.pi) ** 0.6
            st_ = 0.55 + 0.45 * _noise3(np.stack((u * 0.5, ph * 0.04, np.zeros_like(u)), -1), 900.0, seed + 23)
            k = 0.45 + 0.55 * band * st_
            h = 0.0012 * band + 0.0002 * st_
        else:
            # strands along v: fine straight streaks (about 2.5 texels wide, half the swatch long), a few broader
            # ones, soft locks and a sheen band that wanders with them (no wavy grain: that read as wood)
            q = lambda fu, fv: np.stack((u * fu, v * fv, np.zeros_like(u)), -1)  # noqa: E731
            wav = 0.010 * np.sin(v * 7.0 + u * 19.0)
            st_ = 0.5 + 0.5 * _noise3(q(165.0, 2.2) + np.stack((wav * 165, 0 * u, 0 * u), -1), 1.0, seed + 29)
            st2 = 0.5 + 0.5 * _noise3(q(62.0, 1.4), 1.0, seed + 31)
            lock = 0.5 + 0.5 * _noise3(q(9.0, 0.6), 1.0, seed + 33)
            part_ = np.clip(1.0 - np.abs(lock - 0.5) * 16.0, 0, 1)  # a faint line between two locks
            sheen = np.exp(-((v - 0.5 - 0.08 * np.sin(u * 23.0) - 0.05 * (lock - 0.5)) / 0.09) ** 2)
            k = 0.60 + 0.36 * (st_ - 0.5) + 0.16 * (st2 - 0.5) + 0.10 * (lock - 0.5) - 0.10 * part_ +                 0.20 * sheen * (0.6 + 0.8 * st_)
            h = 0.00050 * st_ + 0.00020 * st2 + 0.00030 * lock - 0.0002 * part_
        rgb[Y0:Y1, X0:X1] = np.clip(hair * k[..., None], 0, 1)
        hgt[Y0:Y1, X0:X1] = h
    nm = normal_map(hgt, pos, has)
    return np.clip(rgb, 0, 1).astype(np.float32), nm


def seam_fade(mask, px):
    """0 at the edge of the mask, rising to 1 px texels inside it (smooth)."""
    d = np.zeros(mask.shape, np.float32)
    m = mask.copy()
    for k in range(px):
        er = m.copy()
        er[1:, :] &= m[:-1, :]
        er[:-1, :] &= m[1:, :]
        er[:, 1:] &= m[:, :-1]
        er[:, :-1] &= m[:, 1:]
        d[m & ~er] = k
        m = er
    d[m] = px
    t = d / px
    return np.where(mask, t * t * (3 - 2 * t), 1.0).astype(np.float32)


def blur(a, r):
    """A box blur of radius r (twice: close to a Gaussian), edges clamped."""
    out = a.astype(np.float64)
    for _ in range(2):
        for ax in (0, 1):
            pad = [(0, 0), (0, 0)]
            pad[ax] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode="edge"), axis=ax)
            n = out.shape[ax]
            hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax)
            lo = np.take(c, np.arange(0, n), axis=ax)
            out = (hi - lo) / (2 * r + 1)
    return out.astype(np.float32)


def normal_map(height, pos, has):
    """The height field as a tangent-space normal map through the position map (metres along u and v)."""
    du = np.linalg.norm(np.gradient(pos, axis=1), axis=-1)
    dv = np.linalg.norm(np.gradient(pos, axis=0), axis=-1)
    flat = np.median(du[has & (du > 0) & (du < 0.01)]) if (has & (du > 0)).any() else 3e-4
    du = np.where(has & (du < 0.01) & (du > 1e-6), du, flat)
    dv = np.where(has & (dv < 0.01) & (dv > 1e-6), dv, flat)
    dhu = np.gradient(height, axis=1) / du
    dhv = np.gradient(height, axis=0) / dv
    n = np.stack([-dhu, -dhv, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)

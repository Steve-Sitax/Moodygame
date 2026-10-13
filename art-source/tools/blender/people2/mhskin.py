"""MakeHuman's CC0 skins as the base of our pictures (docs/people.md "Skin and face pictures").

MakeHuman's skins (young, middle-aged and old; light, dark and asian skinned; men and women) are painted on its UV
layout. Our copies keep that layout but split it: the head, the inside of the mouth and the eye sockets fill the face
square (mhbody.face_uv), the body's islands go into the body's rectangle (mhbody.body_uv). These functions move a
MakeHuman picture into those layouts, so our painters (face_paint, paint, hands) work on top of a real skin.

Pictures here are float arrays with row 0 at the bottom (v up), as the kit's painters use them.
"""

import os

import numpy as np

from . import mh
from . import mhbody

SKINS = {
    # (sex, age group, skin) -> the system pack's folder and file
    ("m", "young", "light"): ("young_caucasian_male", "young_lightskinned_male_diffuse.png"),
    ("m", "middle", "light"): ("middleage_caucasian_male", "middleage_lightskinned_male_diffuse.png"),
    ("m", "old", "light"): ("old_caucasian_male", "old_lightskinned_male_diffuse.png"),
    ("f", "young", "light"): ("young_caucasian_female", "young_lightskinned_female_diffuse.png"),
    ("f", "middle", "light"): ("middleage_caucasian_female", "middleage_lightskinned_female_diffuse.png"),
    ("f", "old", "light"): ("old_caucasian_female", "old_lightskinned_female_diffuse.png"),
    ("m", "middle", "dark"): ("middleage_african_male", "middleage_darkskinned_male_diffuse.png"),
    ("f", "middle", "dark"): ("middleage_african_female", "middleage_darkskinned_female_diffuse.png"),
    ("m", "middle", "asian"): ("middleage_asian_male", "middleage_lightskinned_male_diffuse2.png"),
}

_CACHE = {}


def load(key):
    """A MakeHuman skin as a float array (v up), 2048 px."""
    if key not in _CACHE:
        folder, fname = SKINS[key]
        _CACHE[key] = read_png(mh.path("system/skins/%s/%s" % (folder, fname)))
    return _CACHE[key]


def read_png(p, channels=3):
    """A picture file through Blender (its stored values, v up: Blender keeps rows from the bottom)."""
    import bpy
    im = bpy.data.images.load(p, check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(h, w, 4)[:, :, :channels].copy()


def sample(img, u, v):
    """Bilinear sample of a v-up picture at UVs (arrays)."""
    h, w = img.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1.001)
    y = np.clip(v * h - 0.5, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


_MASK = {}


def island_mask(size=1024):
    """MakeHuman's UV layout rasterised: per pixel the island's index (mhbody.ISLAND_NAMES) or -1."""
    if size in _MASK:
        return _MASK[size]
    b = mh.base()
    isl = mhbody.island_ids()
    out = -np.ones((size, size), np.int16)
    for k, fi in enumerate(b.body_faces):
        uv = b.VT[list(b.FT[fi])] * size - 0.5
        idx = mhbody.ISLAND_NAMES.index(isl[k])
        for t in range(1, len(uv) - 1):
            tri = uv[[0, t, t + 1]]
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            a, bb, c = tri
            den = (bb[1] - c[1]) * (a[0] - c[0]) + (c[0] - bb[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l0 = ((bb[1] - c[1]) * (xs - c[0]) + (c[0] - bb[0]) * (ys - c[1])) / den
            l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
            m = (l0 >= -0.03) & (l1 >= -0.03) & (1 - l0 - l1 >= -0.03)
            out[ys[m], xs[m]] = idx
    _MASK[size] = out
    return out


def _inverse(island, q, kind, rect=None, size=1024):
    """Our layout's UV q -> MakeHuman's UV for one island (the transforms are a scale, a shift and a quarter turn)."""
    if kind == "face":
        o = mhbody.face_uv(np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]), island)
    else:
        o = mhbody.body_uv(np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]), island, rect, size)
    A = np.stack((o[1] - o[0], o[2] - o[0]), 1)  # columns: images of the unit vectors
    return (q - o[0]) @ np.linalg.inv(A).T


def remap(src, kind, size=1024, rect=None):
    """A MakeHuman-layout picture (v up) into our face square (kind 'face') or a body rectangle (kind 'body').
    Returns (picture, coverage mask)."""
    out = np.zeros((size, size, src.shape[2]), np.float32)
    have = np.zeros((size, size), bool)
    mask = island_mask(1024)
    ys, xs = np.mgrid[0:size, 0:size]
    q = np.stack(((xs + 0.5) / size, (ys + 0.5) / size), -1).reshape(-1, 2)
    islands = mhbody.FACE_ISLANDS if kind == "face" else ("body", "handL", "handR", "foot")
    for isl in islands:
        u = _inverse(isl, q, kind, rect, size)
        inside = (u[:, 0] >= 0) & (u[:, 0] < 1) & (u[:, 1] >= 0) & (u[:, 1] < 1)
        mi = np.zeros(len(q), bool)
        uu = u[inside]
        mx = np.clip((uu[:, 0] * 1024).astype(int), 0, 1023)
        my = np.clip((uu[:, 1] * 1024).astype(int), 0, 1023)
        mi[np.nonzero(inside)[0]] = mask[my, mx] == mhbody.ISLAND_NAMES.index(isl)
        sel = mi & ~have.reshape(-1)
        if not sel.any():
            continue
        vals = sample(src, u[sel, 0], u[sel, 1])
        flat = out.reshape(-1, src.shape[2])
        flat[sel] = vals
        have.reshape(-1)[sel] = True
    return out, have


def dilate(img, have, steps=16):
    """Grow the covered pixels outward (against mipmap bleeding at the islands' edges)."""
    img = img.copy()
    have = have.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(have.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sh = np.roll(np.roll(have, dy, 0), dx, 1)
            acc += np.roll(np.roll(img, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~have) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        have = have | grow
    return img


# ---------------------------------------------------------------- the body's picture

SKIN_REF = {"m": ("m", "young", "light"), "f": ("f", "young", "light"), "boy": ("m", "young", "light"),
            "old_m": ("m", "old", "light"), "old_f": ("f", "old", "light")}


def body_raster(body, size, rect):
    """The near copy's body islands (not the face's) rasterised into a rectangle of a layer: per pixel the body
    point (rest space), its normal, its part (index into the returned names), MakeHuman's UV there, and coverage."""
    from . import mhface
    T = mhbody.topology(0)
    co = T.binding.eval(body.Pf)
    tris = []
    for f in T.faces:
        for k in range(1, len(f) - 1):
            tris.append((f[0], f[k], f[k + 1]))
    N = mhface.vertex_normals(co, np.array(tris))
    names = sorted(set(T.part))
    pid = np.array([names.index(p) for p in T.part])
    uvs, att = [], []
    for fi, f in enumerate(T.faces):
        isl = T.face_island[fi]
        if isl in mhbody.FACE_ISLANDS:
            continue
        ls = T.loop_start[fi]
        luv = T.loop_uv[ls:ls + len(f)]
        tuv = mhbody.body_uv(luv, isl, rect, size)
        for k in range(1, len(f) - 1):
            c = [0, k, k + 1]
            vs = [f[j] for j in c]
            uvs.append(tuv[c])
            # a part is a name, not a number to blend: one part per triangle (the most of its corners'), so a
            # texel between a neck and a torso corner never reads as a part whose index lies between them
            pv = pid[vs]
            tp = pv[0] if pv[0] == pv[1] or pv[0] == pv[2] else pv[1] if pv[1] == pv[2] else pv[0]
            att.append(np.concatenate((co[vs], N[vs], np.full((3, 1), float(tp)), luv[c]), 1))
    out, has = mhface.raster(np.array(uvs), np.array(att), size, pad=0.01)
    part = np.where(has, np.round(out[..., 6]).astype(int), -1)
    return out[..., :3], out[..., 3:6], part, names, out[..., 7:9], has


def seam_away(body, pos, sel, near=0.004, far=0.030):
    """0 at the seam between the head's island and the body's (the neck), rising to 1 `far` metres from it; 1 where
    sel is False. pos: texel positions (rest space)."""
    T = mhbody.topology(0)
    co = T.binding.eval(body.Pf)
    head_v, body_v = set(), set()
    for fi, f in enumerate(T.faces):
        (head_v if T.face_island[fi] == "head" else body_v if T.face_island[fi] not in mhbody.FACE_ISLANDS
         else set()).update(f)
    seam = co[sorted(head_v & body_v)]
    out = np.ones(pos.shape[:2], np.float32)
    if not len(seam):
        return out
    idx = np.nonzero(sel)
    pts = pos[idx]
    d = np.full(len(pts), 1.0)
    for k in range(0, len(seam), 64):
        sk = seam[k:k + 64]
        d = np.minimum(d, np.sqrt(((pts[:, None, :] - sk[None]) ** 2).sum(-1)).min(1))
    t = np.clip((d - near) / (far - near), 0, 1)
    out[idx] = t * t * (3 - 2 * t)
    return out


def body_picture(b, group, tone=(1.0, 1.0, 1.0), size=1024, rect=None, underwear=True, kind=None):
    """A body's picture in the clothes layer: MakeHuman's skin of the group (SKIN_REF) moved into the rectangle,
    the tone, the sun on the hands and the neck, the base bodies' worn linen drawers and vest, a kind's own extras
    (socks, grime: Kind.skin), and the normal map. Returns (rgb, normal, zones)."""
    from . import body as bd
    from . import paint
    from . import pictures
    from .paint import _noise3
    rect = rect or (0, 0, size, size)
    body = b["mhbody"]
    P = b["P"]
    pos, nrm, part, names, muv, has = body_raster(body, size, rect)
    src = load(SKIN_REF[group])
    rgb = sample(src, muv[..., 0], muv[..., 1]).astype(np.float32)
    rgb = np.clip(rgb * np.array(tone, np.float32), 0, 1)
    pn = np.array(names + [""])
    pname = pn[np.where(has, part, len(names))]
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    ax = np.abs(x)
    Y = lambda f: bd.Y(P, f)  # noqa: E731
    female = P["female"]
    is_torso = pname == "torso"
    is_arm = np.char.startswith(pname, "arm")
    is_leg = np.char.startswith(pname, "leg")
    is_finger = np.char.startswith(pname, "finger")
    is_neck = pname == "neck"
    # the sun and the weather on what work leaves bare: the hands and wrists, the nape and the throat
    amount = 0.55 if female else (0.6 if P["child"] else 1.0)
    ta = np.clip((Y(0.60) - y) / (Y(0.60) - Y(0.49)), 0, 1)
    tan = (is_arm | is_finger) * ta * ta * (3 - 2 * ta)
    tn = np.clip((y - Y(0.80)) / max(Y(0.845) - Y(0.80), 1e-3), 0, 1)
    tn = tn * seam_away(body, pos, has & (is_neck | is_torso) & (y > Y(0.76)))  # plain at the head's seam
    tan = np.clip(tan + (is_neck | is_torso) * tn * np.clip(1.3 - ax / 0.09, 0, 1), 0, 1) * amount
    rgb *= (1 - tan[..., None] * (1 - paint.TAN))
    hand = is_finger | (is_arm & (y < Y(0.49)))
    rgb = rgb * np.where(hand[..., None], np.array((0.96, 0.92, 0.90), np.float32), 1.0)
    hgt = np.zeros(rgb.shape[:2], np.float32)
    lum = rgb.mean(-1)
    from .mhface import blur
    hgt += np.where(has, 0.0008 * (lum - blur(lum, 5)), 0)
    zones = pictures.skin_zones(pos, part, names, P)
    if underwear:
        n2 = _noise3(pos, 45.0, 3)
        n4 = _noise3(pos, 22.0, 7)
        weave = 1 + 0.035 * np.sin(y * 2200) * np.sin(x * 2100 + z * 2100) + 0.03 * n2 + 0.035 * n4
        knee, waist = Y(0.33), Y(0.607)
        drawers = (is_leg | is_torso) & (y > knee) & (y < waist + 0.01)
        if not female:
            neck_line = np.where(z > 0, Y(0.790) + (ax / 0.12) ** 2 * (Y(0.83) - Y(0.79)), Y(0.825))
            sleeve = Y(0.735)
        else:
            neck_line = np.where(z > 0, Y(0.775) + (ax / 0.11) ** 1.5 * (Y(0.83) - Y(0.775)), Y(0.815))
            sleeve = Y(0.715)
            drawers = drawers | (is_torso & (y < waist))
        vest = (is_torso | is_arm | is_neck) & (y > waist - 0.06) & (y < neck_line - 0.012) & (~is_arm | (y > sleeve))
        cloth = (drawers | vest) & has
        shade = 1 - 0.06 * np.clip(-nrm[..., 1], 0, 1)
        cl = np.array(paint.LINEN, np.float32) * (weave * shade)[..., None]
        grime = np.clip(np.exp(-((y - knee) / 0.05) ** 2) * 0.8 + (z < 0) * np.exp(-((y - Y(0.54)) / 0.07) ** 2) * 0.6,
                        0, 1) * (0.6 + 0.4 * n4)
        cl *= (1 - 0.14 * grime[..., None])
        hem = (np.abs(y - knee - 0.006) < 0.005) | (np.abs(y - sleeve - 0.006) < 0.005) | (np.abs(y - waist) < 0.004)
        cl *= np.where((hem & cloth)[..., None], 0.86, 1.0)
        rgb = np.where(cloth[..., None], cl, rgb)
        hgt += np.where(cloth, 0.00025 * (weave - 1) * 10, 0)
    if kind is not None and kind.skin is not None:
        from . import clothes_kit as ck
        idx = np.nonzero(has)
        ctx = ck.Ctx(pos[idx].astype(np.float64), nrm[idx].astype(np.float64), np.zeros(len(idx[0]), bool), None,
                     None, rgb[idx].copy(), hgt[idx].astype(np.float64), 7)
        ctx.part = pname[idx]
        ctx.P = P
        ctx.detail_zone = zones[idx].copy()
        kind.skin(ctx)
        zones[idx] = ctx.detail_zone
        rgb[idx] = ctx.rgb
        hgt[idx] = ctx.h
    from .mhface import normal_map
    nm = normal_map(hgt, pos, has)
    rgb = dilate(rgb, has, 12)
    nm = dilate(nm, has, 12)
    zones = paint.dilate(zones[..., None], has)[..., 0]
    return np.clip(rgb, 0, 1).astype(np.float32), nm, zones


def cell_meta(name, lk, rgb):
    """What the game needs of a face picture: its group, the hair colour, and the tone the body's skin takes to
    match the face at the neck (the face's cheeks against the plain MakeHuman skin the body pictures start from)."""
    from . import mhface
    group = lk["group"]
    G = mhface.geometry(group)
    pos = G["pos"]
    head = G["island"] == mhbody.ISLAND_NAMES.index("head")
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    # the ring along the neck's seam: there the face picture has faded to its plain skin, and the body's picture
    # (its skin times bodyTone) must carry on with the same colour
    from .mhface import seam_fade
    holes = (np.linalg.norm(pos - G["eyeL"], axis=-1) < 0.03) | (np.linalg.norm(pos - G["eyeR"], axis=-1) < 0.03) |         (np.linalg.norm((pos - G["mouth"]) * (1, 1.4, 1), axis=-1) < 0.04)
    cheek = head & ~holes & (seam_fade(head, 40) < 0.3) & (y < G["chin"][1] - 0.01)
    sex = "f" if group in ("f", "of") or lk.get("sex") == "f" else "m"
    ref_key = SKIN_REF[{"m": "m", "f": "f", "c": "boy", "om": "old_m", "of": "old_f"}[group]]  # the body's own
    ref, _ = remap(load(ref_key), "face", 1024)
    c = rgb[cheek].mean(0)
    r = ref[cheek].mean(0)
    tone = np.clip(c / np.maximum(r, 1e-3), 0.25, 1.25)
    hair = lk["hair"]
    from .mhface import HAIR
    return {"group": group, "sex": sex, "skin": lk["skin"], "age": lk["age"], "hair": hair,
            "hairRgb": [round(float(v), 3) for v in (HAIR[hair] if isinstance(hair, str) else hair)],
            "bodyTone": [round(float(v), 3) for v in tone], "scalp": lk.get("scalp", "hair")}


def preview_material(name, body_rgb, body_n, face_rgb, face_n):
    """A Blender material for the check pictures: the body's picture and a face picture, chosen per corner by the
    face flag (as the game's people2 shader does)."""
    import bpy

    def img(n, a, noncolor=False):
        im = bpy.data.images.new(n, a.shape[1], a.shape[0])
        rgba = np.ones((a.shape[0], a.shape[1], 4), np.float32)
        rgba[..., :3] = a[..., :3]
        im.pixels.foreach_set(rgba.ravel())
        if noncolor:
            im.colorspace_settings.name = "Non-Color"
        return im
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = img(name + "_body", body_rgb)
    tf = nt.nodes.new("ShaderNodeTexImage")
    tf.image = img(name + "_face", face_rgb)
    tbn = nt.nodes.new("ShaderNodeTexImage")
    tbn.image = img(name + "_body_n", body_n, True)
    tfn = nt.nodes.new("ShaderNodeTexImage")
    tfn.image = img(name + "_face_n", face_n, True)
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "picture_flags"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(ca.outputs["Color"], sep.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mix.inputs["Factor"])
    nt.links.new(tb.outputs["Color"], mix.inputs[6])
    nt.links.new(tf.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    mixn = nt.nodes.new("ShaderNodeMix")
    mixn.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mixn.inputs["Factor"])
    nt.links.new(tbn.outputs["Color"], mixn.inputs[6])
    nt.links.new(tfn.outputs["Color"], mixn.inputs[7])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(mixn.outputs[2], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.6
    m.use_backface_culling = True
    return m

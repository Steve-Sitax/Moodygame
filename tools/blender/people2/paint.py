"""The base skin pictures (docs/people.md "The pictures").

Every body has the same topology and the same UVs, so one picture fits every body of a sex: one for men and boys,
one for women. The picture is painted in 3D: the near copy is drawn into its own UV square once to learn, for every
texel, the point of the body it shows (a position map), and each texel is then coloured by where it is on the body
(skin, the flush of the knuckles and knees, a cropped head of hair, brows, eyes and lips, linen underclothes). B and
C can use the same position map (position_map()) for faces and clothes.

Linear, mipmapped in the games; the texels round every island are grown outward (dilate) so the mipmaps do not
bleed the background into the seams.
"""

import math

import numpy as np

from . import body as bd


def position_map(ob, size, part_of=None):
    """Rasterise a triangulated copy of the mesh in UV space. Returns pos (size, size, 3) in game space, nrm, a part
    index map (-1 where nothing is drawn) and the part names."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    vparts = part_of or [None] * len(bm.verts)
    names = sorted({p for p in vparts if p})
    pid = {n: i for i, n in enumerate(names)}
    pos = np.zeros((size, size, 3), np.float32)
    nrm = np.zeros((size, size, 3), np.float32)
    part = -np.ones((size, size), np.int32)
    for f in bm.faces:
        uv = np.array([l[uvl].uv[:] for l in f.loops]) * size - 0.5
        P = np.array([(v.co.x, v.co.z, -v.co.y) for v in f.verts])
        Nn = np.array([(v.normal.x, v.normal.z, -v.normal.y) for v in f.verts])
        x0, y0 = np.floor(uv.min(axis=0)).astype(int)
        x1, y1 = np.ceil(uv.max(axis=0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        a, b, c = uv
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not m.any():
            continue
        L = np.stack([l0[m], l1[m], l2[m]], axis=1)
        yy, xx = ys[m], xs[m]
        pos[yy, xx] = L @ P
        nn = L @ Nn
        nrm[yy, xx] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
        vp = vparts[f.verts[0].index]
        part[yy, xx] = pid.get(vp, -1) if vp else -1
    bm.free()
    return pos, nrm, part, names


def dilate(img, mask, steps=12):
    """Grow painted texels outward into the empty ones."""
    img = img.copy()
    m = mask.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(m.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sm = np.roll(np.roll(m, dy, 0), dx, 1)
                si = np.roll(np.roll(img, dy, 0), dx, 1)
                acc += si * sm[..., None]
                cnt += sm
        new = (~m) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        m = m | new
    img[~m] = img[m].mean(axis=0)
    return img


def _noise3(p, scale, seed=0):
    """Cheap smooth value noise in 3D, in [-1, 1]."""
    q = p * scale + seed * 17.13
    i = np.floor(q)
    f = q - i
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 13.0) * 43758.5453
        return (n - np.floor(n)) * 2 - 1

    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wgt = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (
                    f[..., 2] if dz else 1 - f[..., 2])
                out = out + wgt * h(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz)
    return out


def srgb(c):
    return np.array(c, np.float32)


def paint_skin(pos, nrm, part, names, P, female, seed=1873):
    """The base picture: skin, hair, a face, underclothes. Colours in sRGB 0..1."""
    size = pos.shape[0]
    has = part >= 0
    pn = np.array(names + [""])
    pname = pn[np.where(has, part, len(names))]
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    ax = np.abs(x)
    H = P["H"]
    Y = lambda f: bd.Y(P, f)
    hs, hw = P["hs"], P["hw"]
    chin = Y(0.870)
    t = (y - chin) / hs  # height over the chin on the reference head
    hx = ax / hw
    hz = z / hw - bd.HEAD_Z
    is_head = np.char.startswith(pname, "head")
    is_neck = np.char.startswith(pname, "neck")
    is_torso = np.char.startswith(pname, "torso")
    is_arm = np.char.startswith(pname, "arm")
    is_leg = np.char.startswith(pname, "leg")
    is_finger = np.char.startswith(pname, "finger")

    skin = srgb((0.80, 0.63, 0.53)) if not female else srgb((0.83, 0.67, 0.58))
    img = np.ones((size, size, 3), np.float32) * skin
    n1 = _noise3(pos, 9.0, seed)
    n2 = _noise3(pos, 45.0, seed + 1)
    n3 = _noise3(pos, 160.0, seed + 2)
    img *= (1 + 0.035 * n1 + 0.018 * n2 + 0.012 * n3)[..., None]

    def mix(mask_w, col):
        nonlocal img
        wv = np.clip(mask_w, 0, 1)[..., None]
        img = img * (1 - wv) + srgb(col) * wv

    flush = (0.80, 0.50, 0.44)
    # the flush of the joints, the cheeks, the nose and the ears
    sh = bd.shoulder_x(P)
    knee_f = is_leg * np.exp(-((y - Y(0.287)) / (0.03 * H)) ** 2) * np.clip(z / (0.05 * P["w"]), 0, 1)
    mix(knee_f * 0.35, flush)
    elbow = is_arm * np.exp(-((y - Y(0.630)) / (0.025 * H)) ** 2) * np.clip(-z / (0.035 * P["w"]), 0, 1)
    mix(elbow * 0.3, flush)
    knuckles = is_finger * np.clip((ax - sh + 0.004) / 0.012, 0, 1) * (0.5 + 0.5 * np.cos(n2 * 3)) * 0.25
    mix(knuckles, flush)
    palm = (is_arm | is_finger) * np.clip((sh - ax - 0.004) / 0.01, 0, 1) * (y < Y(0.49))
    mix(palm * 0.35, (0.88, 0.72, 0.64))
    cheek = is_head * np.exp(-(((hx - 0.045) / 0.018) ** 2 + ((t - 0.085) / 0.02) ** 2)) * (hz > 0.03)
    mix(cheek * (0.35 if not female else 0.3), flush)
    nose = is_head * np.exp(-((hx / 0.012) ** 2 + ((t - 0.08) / 0.014) ** 2)) * (hz > 0.09)
    mix(nose * 0.3, flush)
    ears = is_head * np.exp(-(((hx - 0.077) / 0.008) ** 2 + ((t - 0.105) / 0.03) ** 2 + ((hz + 0.005) / 0.02) ** 2))
    mix(ears * 0.4, flush)
    # the nails are painted by B (hands.paint_hands), on the modelled hands
    # a little shade in the deep parts: under the chin, the armpits, between the legs
    under = is_neck * np.clip((chin - y) / (0.03 * H) + 0.3, 0, 1) * (z > 0) * 0.0
    pit = (is_torso | is_arm) * np.exp(-((y - Y(0.765)) / (0.02 * H)) ** 2) * np.exp(-((ax - sh + 0.04) / 0.02) ** 2)
    img *= (1 - 0.18 * np.clip(pit, 0, 1))[..., None]

    # ---- the face
    face = is_head & (hz > 0.035)
    brow_y = 0.130 + 0.006 * np.exp(-((hx - 0.032) / 0.02) ** 2)
    brow = face * (hx > 0.010) * (hx < 0.054) * np.exp(-((t - brow_y) / (0.0045 if not female else 0.0032)) ** 2)
    brow *= np.clip(0.8 + 0.4 * n3, 0, 1)
    hair_col = (0.20, 0.15, 0.11) if not female else (0.30, 0.20, 0.13)
    mix(brow * 0.85, hair_col)
    # soft shade where the face goes in: the eye sockets, under the nose, beside the mouth, under the lip
    sock = np.exp(-(((hx - 0.033) / 0.021) ** 2 + ((t - 0.116) / 0.013) ** 2))
    nostril = np.exp(-((hx / 0.016) ** 2 + ((t - 0.071) / 0.005) ** 2))
    fold = np.exp(-(((hx - 0.020 - (0.075 - t) * 0.25) / 0.005) ** 2)) * (t > 0.052) * (t < 0.078)
    chin_pit = np.exp(-((hx / 0.02) ** 2 + ((t - 0.043) / 0.005) ** 2))
    shade_f = face * (0.13 * sock + 0.10 * nostril + 0.06 * fold + 0.07 * chin_pit)
    img *= (1 - shade_f)[..., None]
    # the eyes: an almond with a white, a coloured ring and a dark lid line
    ex, ey = 0.033, 0.112
    du, dv = (hx - ex) / 0.0145, (t - ey) / 0.0058
    dv_up = dv - 0.25 * du * du
    almond = face * ((du * du + dv_up * dv_up) < 1.0)
    mix(almond * 0.9, (0.72, 0.68, 0.63))
    iris_r = np.sqrt(((hx - ex) / 0.0062) ** 2 + ((t - ey + 0.0004) / 0.0062) ** 2)
    iris_col = (0.30, 0.24, 0.17) if not female else (0.34, 0.40, 0.44)
    mix(almond * (iris_r < 1.0) * 1.0, iris_col)
    mix(almond * (iris_r < 0.45) * 1.0, (0.07, 0.06, 0.06))
    lid = face * (np.abs(np.sqrt(du * du + dv_up * dv_up) - 1.0) < 0.22) * (dv_up > -0.1)
    mix(lid * 0.85, (0.22, 0.15, 0.13))
    crease = face * (np.abs(np.sqrt((du * 0.92) ** 2 + ((t - ey - 0.0042) / 0.0062 - 0.2 * du * du) ** 2) - 1.0) < 0.15) * (t > ey)
    mix(crease * 0.35, (0.55, 0.38, 0.33))
    # the lips
    my = 0.0565
    lw = 0.024
    lu = hx / lw
    up_lip = face * (lu < 1) * ((t - my) > 0) * ((t - my) < 0.0055 * (1 - lu ** 2) + 0.0008)
    lo_lip = face * (lu < 1) * ((my - t) > 0) * ((my - t) < 0.0075 * (1 - lu ** 2) + 0.0008)
    lip_col = (0.70, 0.42, 0.38) if not female else (0.74, 0.44, 0.42)
    mix((up_lip + lo_lip) * 0.75, lip_col)
    mouth = face * (lu < 1.05) * (np.abs(t - my) < 0.0009)
    mix(mouth * 0.8, (0.30, 0.15, 0.13))
    # ---- the hair: cropped for the men and boys, drawn back to a knot for the women
    ang = np.degrees(np.arctan2(hx, hz))  # 0 the front, 90 the side, 180 the back
    if not female:
        line = np.interp(ang, [0, 30, 60, 85, 100, 125, 180], [0.188, 0.180, 0.158, 0.142, 0.115, 0.075, 0.060])
        if P["old"]:
            line = np.interp(ang, [0, 40, 70, 100, 125, 180], [0.210, 0.205, 0.165, 0.118, 0.078, 0.062])
    else:
        line = np.interp(ang, [0, 30, 60, 85, 100, 125, 180], [0.182, 0.174, 0.150, 0.128, 0.100, 0.070, 0.050])
    soft = 0.006
    hair = (is_head | is_neck) * np.clip((t - line) / soft + 0.5, 0, 1)
    if P["old"] and not female:
        crown_bald = np.exp(-((hx / 0.045) ** 2 + ((hz - 0.01) / 0.06) ** 2)) * (t > 0.2)
        hair *= np.clip(1 - crown_bald * 1.2, 0, 1)
    strands = 0.75 + 0.25 * _noise3(pos * np.array((1, 0.25, 1)), 260.0, seed + 5)
    if female:
        # a parting in the middle, the hair combed down and back
        part_line = np.exp(-(hx / 0.0025) ** 2) * (hz > -0.04) * (t > 0.17)
        strands = 0.72 + 0.28 * _noise3(np.stack([pos[..., 0] * 40, pos[..., 1] * 4, pos[..., 2] * 4], -1), 4.0, seed + 6)
        hair *= (1 - 0.6 * part_line)
    hc = srgb(hair_col)
    if P["old"]:
        hc = srgb((0.62, 0.60, 0.57)) if not female else srgb((0.66, 0.63, 0.60))
    hair_img = hc * strands[..., None]
    wv = np.clip(hair, 0, 1)[..., None] * 0.97
    img = img * (1 - wv) + hair_img * wv

    # ---- the underclothes: linen drawers and a vest (a chemise for the women)
    linen = srgb((0.84, 0.81, 0.73))
    weave = 1 + 0.03 * np.sin(pos[..., 1] * 2200) * np.sin(pos[..., 0] * 2100 + pos[..., 2] * 2100) + 0.03 * n2
    knee = Y(0.33)
    waist = Y(0.607)
    drawers = (is_leg | is_torso) & (y > knee) & (y < waist + 0.01)
    if not female:
        neck_line = np.where(z > 0, Y(0.790) + (ax / (0.12 * P["w"])) ** 2 * (Y(0.83) - Y(0.79)), Y(0.825))
        sleeve = Y(0.735)
    else:
        neck_line = np.where(z > 0, Y(0.775) + (ax / (0.11 * P["w"])) ** 1.5 * (Y(0.83) - Y(0.775)), Y(0.815))
        sleeve = Y(0.715)
    vest = (is_torso & (y > waist - 0.06) & (y < neck_line)) | (is_arm & (y > sleeve) & (y < Y(0.84)))
    if female:
        drawers = drawers | (is_torso & (y < waist))
    cloth = drawers | vest
    cw = cloth.astype(np.float32)
    # fold shadow: darker where the surface turns down
    shade = 1 - 0.06 * np.clip(-nrm[..., 1], 0, 1)
    cloth_img = linen * (weave * shade)[..., None]
    # seams: down the sides, the waistband, the hems
    seam = (np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 90) < 0.9) & cloth & is_torso
    band = cloth & (np.abs(y - waist) < 0.012)
    hem = cloth & ((np.abs(y - knee - 0.006) < 0.005) | (np.abs(y - sleeve - 0.006) < 0.005))
    cloth_img = cloth_img * np.where((seam | hem)[..., None], 0.86, 1.0) * np.where(band[..., None], 0.92, 1.0)
    if not female:
        # three bone buttons down the front of the vest
        for k in range(3):
            by = Y(0.775) - k * 0.045 * P["w"]
            b = cloth & is_torso & (z > 0.05) & (((x / 0.006) ** 2 + ((y - by) / 0.006) ** 2) < 1)
            cloth_img[b] = srgb((0.70, 0.66, 0.58))
    img = img * (1 - cw[..., None]) + cloth_img * cw[..., None]
    img = np.clip(img, 0, 1)
    return dilate(img, has)


def to_image(name, rgb, path=None):
    import bpy

    h, w_ = rgb.shape[:2]
    im = bpy.data.images.new(name, w_, h, alpha=False)
    rgba = np.ones((h, w_, 4), np.float32)
    rgba[..., :3] = rgb
    im.pixels.foreach_set(rgba.ravel())
    if path:
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
    im.pack()
    return im

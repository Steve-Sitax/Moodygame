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


def vertex_map(ob, size, values):
    """Rasterise one value per vertex of ob into its UV square (the same triangles as position_map), interpolated
    across each triangle. Returns (size, size) float32, 0 where nothing is drawn."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.active
    out = np.zeros((size, size), np.float32)
    vals = np.asarray(values, np.float32)
    for f in bm.faces:
        uv = np.array([l[uvl].uv[:] for l in f.loops]) * size - 0.5
        V = vals[[v.index for v in f.verts]]
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
        out[ys[m], xs[m]] = l0[m] * V[0] + l1[m] * V[1] + l2[m] * V[2]
    bm.free()
    return out


def _ao_dirs(n=40):
    """Fixed, evenly spread directions over the upper hemisphere (+z), cosine weighted."""
    k = np.arange(n) + 0.5
    r = np.sqrt(k / n)
    phi = k * math.pi * (3 - math.sqrt(5))
    return np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - r * r)], -1)


def vertex_occlusion(ob, vparts, P, reach=0.05, rays=40):
    """Ambient occlusion per vertex of a body's near copy at rest (game space), by rays over each vertex's
    hemisphere up to `reach` metres: the crevices that are crevices in every pose. Hits on a part that moves on its
    own are not counted (the hanging arm against the chest below the armpit, the hands against the thighs, one
    thigh against the other below the crotch), so the rest pose does not bake its own closeness into the skin."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    me = ob.data
    co = [v.co.copy() for v in me.vertices]
    nr = [v.normal.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    tree = BVHTree.FromPolygons(co, polys)
    vp = [p or "" for p in vparts]
    ppart = [vp[p[0]] for p in polys]
    dirs = _ao_dirs(rays)
    y_pit = bd.Y(P, 0.735)  # the arm and the chest only shade each other above this (the armpit)
    y_crotch = bd.Y(P, 0.44)  # and the thighs only above this

    def group(part):
        if part.startswith(("finger", "eye")):
            return part[:6] + part[-1:]
        return part

    occ = np.zeros(len(co), np.float32)
    for i, (c, n) in enumerate(zip(co, nr)):
        a = vp[i]
        if a.startswith("eye") or not a:
            continue
        # a frame round the normal
        t = n.orthogonal().normalized()
        bt = n.cross(t)
        o = c + n * 0.0015
        zc = c.z  # Blender z is the game's up
        acc = 0.0
        for d in dirs:
            dv = t * float(d[0]) + bt * float(d[1]) + n * float(d[2])
            hit, hn, fi, dist = tree.ray_cast(o, dv, reach)
            if hit is None:
                continue
            b = ppart[fi]
            ga, gb = group(a), group(b)
            if ga != gb:
                arm_a, arm_b = a.startswith(("arm", "finger")), b.startswith(("arm", "finger"))
                if (arm_a and b.startswith("leg")) or (arm_b and a.startswith("leg")):
                    continue
                if arm_a != arm_b and (a.startswith("finger") or b.startswith("finger")) and not (
                        a[-1:] == b[-1:] and (a.startswith("arm") or b.startswith("arm"))):
                    continue  # a finger against the trunk or the head (but its own palm counts)
                if arm_a != arm_b and (zc < y_pit or hit.z < y_pit):
                    continue
                if a.startswith("arm") and b.startswith("arm"):
                    continue  # one arm against the other
                if a.startswith("leg") and b.startswith("leg") and (zc < y_crotch or hit.z < y_crotch):
                    continue
            acc += (1.0 - (dist / reach) ** 2) * float(d[2])
        occ[i] = acc
    w = float(np.sum(dirs[:, 2]))
    return np.clip(occ / w, 0.0, 1.0)


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


def _skin_mottle(pos, seed=1873):
    """The skin's mottling at three scales: a factor near 1 per texel (replaced by noise.skin_mottle at the art2
    merge, one noise for the head and the body)."""
    n1 = _noise3(pos, 9.0, seed)
    n2 = _noise3(pos, 45.0, seed + 1)
    n3 = _noise3(pos, 160.0, seed + 2)
    return 1 + 0.035 * n1 + 0.018 * n2 + 0.012 * n3


LINEN = (0.77, 0.71, 0.60)  # worn, washed-out linen: darker and warmer than new
TAN = np.array((0.90, 0.84, 0.78))  # a weathered outdoor hand and neck against the covered skin
AO_SKIN, AO_CLOTH = 0.55, 0.45  # how dark the deepest crevice gets


# the toes across the front of the foot, from the inner edge (0) to the outer (1): (centre, half width, tip back
# from the big toe's tip in foot units, nail half width)
TOES = [(0.15, 0.15, 0.000, 0.10), (0.39, 0.085, 0.004, 0.055), (0.56, 0.08, 0.010, 0.05), (0.72, 0.075, 0.017, 0.045),
        (0.87, 0.07, 0.026, 0.04)]


def _paint_toes(img, pos, nrm, is_leg, P):
    """The bare foot's toes, painted (the mesh has no separate toes): the dark gaps between them from the tips back to
    their roots, a toenail on each, a little grime on the tips. img is changed in place."""
    w, ff = P["w"], P["f"]["foot"]
    lx = bd.hip_x(P)
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    sg = np.sign(x)
    xr = (x * sg - lx) / (w * ff)  # across the foot, + outward
    zr = z / (w * ff)  # forward from the ankle's line
    u = (xr + 0.049) / 0.082  # 0 the inner edge of the toes, 1 the outer
    front = is_leg & (y < 0.045 * w) & (zr > 0.12)
    if not front.any():
        return img
    idx = np.nonzero(front)
    uu, zz, ny = u[idx], zr[idx], nrm[..., 1][idx]
    tip0 = bd.TOE_Z + 0.008  # the big toe's tip, roughly
    col = img[idx]
    tz_of = []
    for c_, hw_, back, nw in TOES:
        tz_of.append(tip0 - back)
    # the gaps between the toes: soft dark lines from the tips back as far as the toes stand free, widest at the tips
    shade = np.zeros(len(uu), np.float32)
    for (a_, b_), tza, tzb in zip(zip(TOES[:-1], TOES[1:]), tz_of[:-1], tz_of[1:]):
        g = (a_[0] + a_[1] + b_[0] - b_[1]) / 2
        tz = min(tza, tzb)
        length = 0.030
        along = np.clip((zz - (tz - length)) / length, 0, 1)
        width = 0.010 + 0.014 * along
        shade = np.maximum(shade, np.exp(-((uu - g) / width) ** 2) * np.sqrt(along) * (zz < tz + 0.004))
    col *= (1 - 0.28 * shade)[:, None]
    for (c_, hw_, back, nw), tz in zip(TOES, tz_of):
        tzc = tz - 0.010 * (np.clip(np.abs(uu - c_) / hw_, 0, 1.5)) ** 2
        # a soft nail on top near the tip
        nr = np.hypot((uu - c_) / nw, (zz - (tz - 0.004 - 0.03 * nw)) / (0.004 + 0.03 * nw))
        nail = np.clip(1.2 - nr, 0, 1) * np.clip(ny * 3, 0, 1)
        col = col * (1 - 0.30 * nail[:, None]) + np.array((0.86, 0.76, 0.70)) * 0.30 * nail[:, None]
        # grime on the tips that touch the ground
        tipd = np.exp(-((zz - tzc) / 0.004) ** 2) * (np.abs(uu - c_) < hw_) * (ny < 0.3)
        col *= (1 - 0.12 * tipd)[:, None]
    img[idx] = col
    return img


def paint_skin(pos, nrm, part, names, P, female, seed=1873, ao=None):
    """The base picture: skin, hair, a face, underclothes. Colours in sRGB 0..1. ao: an occlusion map (vertex_map
    of vertex_occlusion) to bake into skin and cloth: the armpits, the crotch, under the chin, between the fingers."""
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
    img *= _skin_mottle(pos, seed)[..., None]
    n2 = _noise3(pos, 45.0, seed + 1)
    n3 = _noise3(pos, 160.0, seed + 2)
    # the sun and the weather on what work leaves bare: the hands and wrists (fading out up the forearm), the nape
    # and the front of the neck down into the collar's V; the neck fades back to the plain tone at the head's join
    # (the face painter weathers the face itself)
    amount = 0.55 if female else (0.6 if P["child"] else 1.0)
    sh_ = bd.shoulder_x(P)
    ta = np.clip((Y(0.60) - y) / (Y(0.60) - Y(0.49)), 0, 1)
    tan_arm = (is_arm | is_finger) * ta * ta * (3 - 2 * ta)
    nb = Y(0.846)
    tn = np.clip((y - (nb - 0.05 * P["w"])) / (0.05 * P["w"]), 0, 1)
    tan_neck = (is_neck | is_torso) * tn * tn * (3 - 2 * tn) \
        * np.clip((chin - 0.002 * H - y) / (0.012 * H), 0, 1) * np.clip(1.25 - ax / (0.09 * P["w"]), 0, 1)
    vee = is_torso * (z > 0) * np.clip((y - Y(0.80)) / (0.02 * H), 0, 1) * np.clip(1 - ax / (0.06 * P["w"]), 0, 1)
    tan = np.clip(tan_arm + tan_neck + vee * 0.7, 0, 1) * amount
    tan *= np.clip(0.85 + 0.25 * n2, 0.6, 1.1)
    img *= (1 - tan[..., None] * (1 - TAN))

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
    palm = (is_arm | is_finger) * np.clip((sh - ax - 0.004) / 0.01, 0, 1) * np.clip((Y(0.492) - y) / (0.012 * H), 0, 1)
    mix(palm * 0.35, (0.88, 0.72, 0.64))
    cheek = is_head * np.exp(-(((hx - 0.045) / 0.018) ** 2 + ((t - 0.085) / 0.02) ** 2)) * (hz > 0.03)
    mix(cheek * (0.35 if not female else 0.3), flush)
    nose = is_head * np.exp(-((hx / 0.012) ** 2 + ((t - 0.08) / 0.014) ** 2)) * (hz > 0.09)
    mix(nose * 0.3, flush)
    ears = is_head * np.exp(-(((hx - 0.077) / 0.008) ** 2 + ((t - 0.105) / 0.03) ** 2 + ((hz + 0.005) / 0.02) ** 2))
    mix(ears * 0.4, flush)
    # the nails are painted by B (hands.paint_hands), on the modelled hands
    img = _paint_toes(img, pos, nrm, is_leg, P)
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

    # ---- the underclothes: linen drawers and a vest (a chemise for the women), worn and washed grey
    linen = srgb(LINEN)
    n4 = _noise3(pos, 22.0, seed + 7)
    weave = 1 + 0.035 * np.sin(pos[..., 1] * 2200) * np.sin(pos[..., 0] * 2100 + pos[..., 2] * 2100) + 0.03 * n2 \
        + 0.035 * n4
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
    # wear: grey grime at the hems, the seat and the knees, yellowed sweat under the arms and at the collar
    grime = np.clip(np.exp(-((y - knee) / (0.03 * H)) ** 2) * 0.8 + np.exp(-((y - sleeve) / (0.02 * H)) ** 2) * 0.5
                    + (z < 0) * np.exp(-((y - Y(0.54)) / (0.04 * H)) ** 2) * 0.6, 0, 1) * (0.6 + 0.4 * n4)
    cloth_img *= (1 - 0.14 * grime[..., None])
    sweat = np.exp(-((y - Y(0.755)) / (0.035 * H)) ** 2) * np.exp(-((ax - sh_ + 0.035) / 0.03) ** 2) \
        + 0.6 * np.exp(-((y - neck_line) / (0.012 * H)) ** 2)
    cloth_img = cloth_img * (1 - 0.35 * np.clip(sweat, 0, 1)[..., None]) \
        + srgb((0.62, 0.55, 0.38)) * 0.35 * np.clip(sweat, 0, 1)[..., None]
    if not female:
        # three bone buttons down the front of the vest
        for k in range(3):
            by = Y(0.775) - k * 0.045 * P["w"]
            b = cloth & is_torso & (z > 0.05) & (((x / 0.006) ** 2 + ((y - by) / 0.006) ** 2) < 1)
            cloth_img[b] = srgb((0.70, 0.66, 0.58))
    img = img * (1 - cw[..., None]) + cloth_img * cw[..., None]
    if ao is not None:
        k = np.where(cw > 0.5, AO_CLOTH, AO_SKIN)
        img *= (1 - k * np.clip(ao, 0, 1) ** 0.8)[..., None]
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

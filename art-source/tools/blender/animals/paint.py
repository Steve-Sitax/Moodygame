"""The pictures, painted in 3D: the near copy is drawn into its own UV square once to learn, for every texel, the
point of the animal it shows (a position map), and each texel is coloured by where it is on the body. Fur is drawn as
strands lying along the hair's flow (a line-integral of 3D noise along the flow, so the strands run on unbroken
across the picture's seams), clumped, longer on the body than on the face and legs; the strands' height becomes the
normal map. The nose leather is pebbled, the pads leathery, the eyes have an iris and a pupil, the mouth is dark
inside, the inner ear is skin. Crevices are darkened from the distance field (ambient occlusion baked in, since the
game lights skinned figures without it).

Every picture is our own: painted here, no photographs, no downloads (assets/ATTRIBUTION.md). Painted at twice the
size and filtered down; linear and mipmapped in the game; islands grown outward so mipmaps do not bleed.
"""

import math

import numpy as np

from .body import unit


def hexc(h):
    return np.array([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255])


# ---------------------------------------------------------------- the position map

def raster(ob, size, vparts):
    """For each texel: position and normal (game space), part index, covered mask. Game space from Blender's."""
    import bmesh
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    names = sorted(set(vparts))
    pid = {n: i for i, n in enumerate(names)}
    vpi = np.array([pid[p] for p in vparts])
    # per-vertex normals: the mesh's (custom normals were set from the field)
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    vn = np.zeros((len(me.vertices), 3))
    for l in me.loops:
        vn[l.vertex_index] += np.array(l.normal[:])
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    pos = np.zeros((size, size, 3), np.float32)
    nrm = np.zeros((size, size, 3), np.float32)
    part = -np.ones((size, size), np.int32)
    tri = np.zeros((size, size, 3), np.int32)
    bary = np.zeros((size, size, 3), np.float32)
    for f in bm.faces:
        uv = np.array([l[uvl].uv[:] for l in f.loops])
        uv = np.stack([uv[:, 0] * size - 0.5, (1 - uv[:, 1]) * size - 0.5], 1)
        vi = [v.index for v in f.verts]
        P = np.array([(f.verts[k].co.x, f.verts[k].co.z, -f.verts[k].co.y) for k in range(3)])
        Nb = vn[vi]
        Nn = np.stack([Nb[:, 0], Nb[:, 2], -Nb[:, 1]], 1)
        x0, y0 = np.floor(uv.min(0)).astype(int)
        x1, y1 = np.ceil(uv.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
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
        m = (l0 >= -0.03) & (l1 >= -0.03) & (l2 >= -0.03)
        if not m.any():
            continue
        L = np.stack([l0[m], l1[m], l2[m]], 1)
        yy, xx = ys[m], xs[m]
        inside = (L.min(1) >= 0)
        # texels inside the triangle win over the ones just outside another's edge
        take = inside | (part[yy, xx] < 0)
        yy, xx, L = yy[take], xx[take], L[take]
        pos[yy, xx] = L @ P
        tri[yy, xx] = vi
        bary[yy, xx] = np.clip(L, 0, 1) / np.clip(L, 0, 1).sum(1, keepdims=True)
        nn = L @ Nn
        nrm[yy, xx] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
        parts3 = vpi[vi]
        maj = np.bincount(parts3).argmax() if len(set(parts3)) < 3 else parts3[0]
        part[yy, xx] = maj
    bm.free()
    co = np.array([(v.co.x, v.co.z, -v.co.y) for v in me.vertices])
    vng = np.stack([vn[:, 0], vn[:, 2], -vn[:, 1]], 1)
    return pos, nrm, part, names, dict(tri=tri, bary=bary, co=co, vn=vng)


def dilate(img, mask, steps=16):
    img = img.copy()
    m = mask.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(m.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sm = np.roll(np.roll(m, dy, 0), dx, 1)
            si = np.roll(np.roll(img, dy, 0), dx, 1)
            acc[sm] += si[sm]
            cnt[sm] += 1
        grow = (~m) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    img[~m] = img[m].mean(0)
    return img


def down2(img):
    return (img[0::2, 0::2] + img[1::2, 0::2] + img[0::2, 1::2] + img[1::2, 1::2]) / 4


# ---------------------------------------------------------------- noise

def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF) / float(0x1000000)


def vnoise(p, freq, seed=0):
    """Value noise in 3D at points p (n, 3), cells of 1 / freq metres, smooth (0..1)."""
    q = p * freq
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        wx = f[:, 0] if dx else 1 - f[:, 0]
        for dy in (0, 1):
            wy = f[:, 1] if dy else 1 - f[:, 1]
            for dz in (0, 1):
                wz = f[:, 2] if dz else 1 - f[:, 2]
                out = out + wx * wy * wz * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, freq, oct=3, seed=0):
    s, a, t = 0.0, 1.0, 0.0
    for o in range(oct):
        s = s + a * vnoise(p, freq * 2 ** o, seed + o * 17)
        t += a
        a *= 0.5
    return s / t


def strands(P, flow, nrm, width, length, taps=12, seed=0):
    """Hair: 3D noise of cell `width` averaged along the flow over `length` (a line integral), normalised 0..1.
    Returns the strand value and a per-texel tuft phase."""
    d = flow - nrm * (flow * nrm).sum(1, keepdims=True)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    acc = np.zeros(len(P))
    for k in range(taps):
        s = (k / (taps - 1) - 0.5) * length
        acc += vnoise(P + d * s, 1.0 / width, seed)
    acc /= taps
    lo, hi = np.percentile(acc, 2), np.percentile(acc, 98)
    v = np.clip((acc - lo) / max(hi - lo, 1e-6), 0, 1)
    return v, d


def ambient(Bd, P, N, H):
    occ = np.zeros(len(P))
    for i in range(1, 6):
        dlt = i * 0.014 * H
        dd = Bd.sdf(P + N * dlt)
        occ += (dlt - np.clip(dd, -dlt, dlt)) / dlt / (2 ** i)
    return np.clip(1.0 - 0.85 * occ, 0.35, 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- coats

COATS = {
    # base, back (dorsal), belly, plus markings; tone of the hair tips; strand contrast
    "mongrel_brown": dict(base=0x80552f, back=0x4a301a, belly=0xc9a275, marks=["blaze", "toes_white", "muzzle_dark"], blaze=0xe6dccb,
                          muzzle=0x3a2616, pad=0x1e1814, nose=0x16110e, iris=0x5a3714, claw=0x2a2420),
    "mongrel_black": dict(base=0x24211e, back=0x151312, belly=0x3a3530, marks=["blaze"], blaze=0xd8d0c2, pad=0x151211, nose=0x0e0c0b,
                          iris=0x5c3a16, claw=0x1a1816, tips=0x4a3f34),
    "mongrel_spotted": dict(base=0xdcd3c1, back=0xd2c8b2, belly=0xe9e3d6, marks=["patches", "ears_patch", "eye_patch"], patch=0x6b4426,
                            pad=0x2a2220, nose=0x231a16, iris=0x4a2f12, claw=0xb8ab98),
    "mongrel_grey": dict(base=0x7d7a74, back=0x55524e, belly=0xb5b0a6, marks=["brindle", "muzzle_dark"], brindle=0x3a3734,
                         muzzle=0x4a4744, pad=0x1e1c1b, nose=0x141313, iris=0x6a4a20, claw=0x2a2826),
    "draught_fawn": dict(base=0xb88a52, back=0x8e6538, belly=0xd8b88a, marks=["mask", "ears_dark"], mask=0x2a2018, ears=0x3a2a1c,
                         pad=0x1c1714, nose=0x120f0d, iris=0x4a2c10, claw=0x262220),
    "draught_brindle": dict(base=0x7a5531, back=0x5a3c22, belly=0xa27c55, marks=["brindle", "mask", "blaze_small"], brindle=0x241a12,
                            mask=0x1e1712, blaze=0xd8ccb6, pad=0x1a1512, nose=0x100d0b, iris=0x4a2c10, claw=0x22201e),
    "schipperke_black": dict(base=0x1b1a19, back=0x121111, belly=0x262422, marks=[], pad=0x141211, nose=0x0b0a0a, iris=0x4a2a10,
                             claw=0x1a1817, tips=0x3a3632),
    "terrier_white": dict(base=0xe8e3d7, back=0xe0dacb, belly=0xefebe2, marks=["head_tan", "saddle", "beard_grey"], tan=0xa8733c,
                          saddle=0x2a2420, beard=0xcfc8b8, pad=0x2a2321, nose=0x141110, iris=0x3e2610, claw=0xb5a995, wire=True),
    "terrier_wheaten": dict(base=0xc9a86a, back=0xb08d52, belly=0xdcc493, marks=["ears_dark", "beard_grey"], ears=0x8a6638,
                            beard=0xd2bf96, pad=0x231d19, nose=0x141110, iris=0x3e2610, claw=0x2a2420, wire=True),
    "cat_tabby": dict(base=0x86735a, back=0x6a5a44, belly=0xc4b49a, marks=["tabby", "chin_pale"], stripes=0x2e261c, pad=0x3a2a28,
                      nose=0xa06a62, iris=0x8c9440, claw=0xd8d0c4),
    "cat_black": dict(base=0x1e1d1c, back=0x161515, belly=0x2a2826, marks=[], pad=0x1a1716, nose=0x2a2222, iris=0xc8b42a, claw=0xd0c8bc,
                      tips=0x3a332c),
    "cat_ginger": dict(base=0xc8762f, back=0xa85b1f, belly=0xebcb9c, marks=["tabby", "chin_pale"], stripes=0x8a4416, stripe_amt=0.6,
                       pad=0xc08070, nose=0xc07a70, iris=0xb0a030, claw=0xe0d8cc),
    "cat_white": dict(base=0xe4e2da, back=0xdcdad2, belly=0xefeee8, marks=["cap_grey", "tail_grey"], patch=0x6a6a68, pad=0xd09a94,
                      nose=0xd08a88, iris=0x7a9a3a, claw=0xe8e4dc),
    "cat_tuxedo": dict(base=0x1d1c1b, back=0x151414, belly=0x2a2826, marks=["tux"], white=0xe9e6de, pad=0x3a2c2a, nose=0x3a2a2a,
                       iris=0xb8a830, claw=0xd8d0c4),
    "cat_tortie": dict(base=0x2a221c, back=0x1e1814, belly=0x4a3828, marks=["tortie", "chin_pale"], orange=0xb2622a, cream=0xd8a86a,
                       pad=0x2e2222, nose=0x3a2626, iris=0xb09028, claw=0xd0c8bc),
    "pig_pink": dict(base=0xddac9a, back=0xd29e8b, belly=0xe8c0ae, marks=["mud"], mud=0x5e4a36, pad=0x6a5a4c, nose=0xc88878,
                     iris=0x2a1c12, claw=0x6a5a4c, skin=True),
    "pig_spotted": dict(base=0xe0b5a3, back=0xd6a894, belly=0xebc6b4, marks=["pig_spots", "mud"], patch=0x2a2422, mud=0x5a4634,
                        pad=0x5e5044, nose=0xc4887a, iris=0x2a1c12, claw=0x5e5044, skin=True),
}


class Field:
    """What a coat needs to know of every covered texel."""

    def __init__(self, Bd, pos, nrm, part, names, size, vert=None):
        self.Bd = Bd
        self.size = size
        self.mask = part >= 0
        self.P = pos[self.mask].astype(np.float64)
        self.N = nrm[self.mask].astype(np.float64)
        self.part = np.array(names)[part[self.mask]]
        H = Bd.H
        tau = 0.02 * H
        body = ~np.isin(self.part, ["eye", "ear", "claw"])
        fl = np.zeros_like(self.P)
        fl[body] = Bd.flow(self.P[body], tau)
        self.fur = np.zeros(len(self.P))
        self.fur[body] = Bd.fur(self.P[body], tau)
        # ears: hair from the root to the tip; claws, eyes: none
        o, R, L = Bd.marks["head"]
        ear = self.part == "ear"
        if ear.any():
            for S_ in "LR":
                base = Bd.J["ear" + S_]
                tip = Bd.J.get("earTip" + S_, base + R[:, 1] * 0.2 * L)
                m = ear & ((self.P[:, 0] > 0) == (S_ == "L"))
                fl[m] = unit(tip - base)
            self.fur[ear] = 0.55
        fl[np.linalg.norm(fl, axis=1) < 1e-6] = (0, 0, -1)
        self.flow = fl
        # occlusion per vertex (on the true surface), interpolated: per texel the flat triangles would facet it
        ao_v = ambient(Bd, vert["co"], vert["vn"], H)
        tri, bary = vert["tri"][self.mask], vert["bary"][self.mask]
        self.ao = (ao_v[tri] * bary).sum(1)
        q = (self.P - o) @ R / L  # head coordinates
        self.hq = q
        # smooth memberships of the regions (the hard part of a texel is its triangle's, which would draw markings
        # with the triangles' edges): the soft share of each region's prims at the texel, the separate pieces hard
        names = [pr.part for pr in Bd.prims]
        groups = sorted({n for n in names if n})
        self.soft = {g: np.zeros(len(self.P)) for g in groups}
        idx = np.nonzero(body)[0]
        for c0 in range(0, len(idx), 60000):
            sel = idx[c0:c0 + 60000]
            a = Bd.soft(self.P[sel], 0.02 * H)
            for j, nm in enumerate(names):
                if nm:
                    self.soft[nm][sel] += a[:, j]
        for hard in ("eye", "ear", "claw"):
            self.soft[hard] = (self.part == hard).astype(float)
        self.head = self.s("head", "muzzle", "nose", "jaw", "beard", "eye")
        self.headb = self.head > 0.5

    def s(self, *names):
        out = np.zeros(len(self.P))
        for n in names:
            if n in self.soft:
                out += self.soft[n]
        return np.clip(out, 0, 1)

    def put(self, img_flat):
        out = np.zeros((self.size, self.size, img_flat.shape[1]), np.float32)
        out[self.mask] = img_flat
        return out


def coat(F, coat_name, rig, seed=1873, strand_v=None):
    """The colour of every covered texel (n, 3) for a coat, and the fur height (n,)."""
    c = COATS[coat_name]
    Bd = F.Bd
    H = Bd.H
    J = Bd.J
    P, N, part = F.P, F.N, F.part
    n = len(P)
    rng_seed = seed
    sp = rig["species"]
    skin = c.get("skin", False)
    base, back, belly = hexc(c["base"]), hexc(c["back"]), hexc(c["belly"])
    up = N[:, 1]
    # dorsal shading: the back and the top of the head darker, the belly and the inside of the legs lighter
    dors = smoothstep(-0.1, 0.8, up)
    ventral = smoothstep(0.1, -0.8, up) * (P[:, 1] < J["chest"][1] * 0.9)
    lowleg = smoothstep(J["elbowL"][1] * 0.9, J["carpusL"][1] * 0.6, P[:, 1]) * (1 - F.s("torso", "belly", "chest"))
    col = base[None, :] * (1 - dors[:, None] * 0.75 - ventral[:, None] * 0.6) + back[None, :] * dors[:, None] * 0.75 + belly[None, :] * ventral[:, None] * 0.6
    col = col * (1 - 0.25 * lowleg[:, None]) + belly[None, :] * 0.25 * lowleg[:, None]
    # large slow variation of the coat
    var = fbm(P, 9.0 / H, 3, rng_seed)
    col *= (0.88 + 0.24 * var)[:, None]
    marks = c.get("marks", [])
    ox, oR, oL = Bd.marks["head"]
    hq = F.hq
    sgx = np.sign(P[:, 0])

    def mix(m, colr, a=1.0):
        nonlocal col
        m = np.clip(m, 0, 1)[:, None] * a
        col = col * (1 - m) + np.asarray(colr)[None, :] * m

    edge = lambda v: smoothstep(0.42, 0.58, v)
    if "blaze" in marks or "blaze_small" in marks:
        # a white chest and throat
        cz = J["shoulderL"][2]
        d = np.hypot(P[:, 0] / (0.10 * H), (P[:, 1] - J["shoulderL"][1] + 0.05 * H) / (0.22 * H)) + np.maximum(0, cz - 0.02 * H - P[:, 2]) / (0.12 * H)
        sz = 1.0 if "blaze" in marks else 0.6
        wob = fbm(P, 30 / H, 2, rng_seed + 5) * 0.5
        m = smoothstep(1.05 * sz + 0.15, 0.85 * sz, d + wob * 0.5) * smoothstep(-0.5, -0.1, N[:, 2]) * (1 - F.s("leg", "paw", "pad", "jaw"))
        throat = F.s("throat") * 0.8 + F.s("jaw") * smoothstep(0.0, -0.6, N[:, 1]) * 0.9
        mix(np.maximum(m, throat * sz), hexc(c["blaze"]))
    if "toes_white" in marks:
        mix(smoothstep(0.075 * H, 0.04 * H, P[:, 1]) * F.s("paw", "leg", "pad"), hexc(c.get("blaze", 0xe0d8c8)), 0.92)
    if "muzzle_dark" in marks:
        m = F.head * smoothstep(0.55, 0.85, hq[:, 2])
        mix(m, hexc(c["muzzle"]), 0.7)
    if "mask" in marks:
        m = F.head * (smoothstep(0.38, 0.62, hq[:, 2]) + smoothstep(0.14, 0.06, np.hypot(np.abs(hq[:, 0]) - 0.12, hq[:, 1] - 0.17)))
        mix(m, hexc(c["mask"]), 0.92)
    if "ears_dark" in marks:
        mix(part == "ear", hexc(c["ears"]), 0.85)
    if "patches" in marks or "pig_spots" in marks:
        v = fbm(P, (7.0 if "patches" in marks else 9.0) / H, 3, rng_seed + 11)
        thr = 0.56 if "patches" in marks else 0.6
        m = smoothstep(thr - 0.02, thr + 0.02, v) * (1 - F.s("nose", "pad", "claw", "eye"))
        mix(m, hexc(c["patch"]))
    if "ears_patch" in marks:
        mix(part == "ear", hexc(c["patch"]))
    if "eye_patch" in marks:
        e = Bd.marks["eyes"][0][0]
        m = F.head * smoothstep(0.32, 0.22, np.linalg.norm((P - e) / (0.5 * oL), axis=1) + 0.25 * fbm(P, 40 / H, 2, 3)) * (P[:, 0] > 0)
        mix(m, hexc(c["patch"]))
    if "brindle" in marks:
        # stripes running down the sides, broken and wavy
        z = P[:, 2] / H + 0.05 * fbm(P, 14 / H, 2, rng_seed + 21) + 0.02 * P[:, 1] / H
        s = np.sin(2 * math.pi * z * 13.0 + 2.6 * fbm(P, 7 / H, 2, rng_seed + 22))
        brk = smoothstep(0.35, 0.6, fbm(P, 20 / H, 2, rng_seed + 23))
        m = smoothstep(0.5, 0.85, s) * brk * smoothstep(0.9, 0.3, np.abs(up)) * (1 - F.head) * (1 - F.s("paw", "pad", "claw")) * 0.6
        mix(m, hexc(c["brindle"]))
    if "head_tan" in marks:
        m = np.maximum(F.head * smoothstep(0.62, 0.48, hq[:, 2]) * (hq[:, 1] > -0.05), (part == "ear") * 1.0)
        mix(m, hexc(c["tan"]), 0.95)
        mix(F.head * smoothstep(0.08, 0.03, np.abs(hq[:, 0])) * (hq[:, 2] < 0.7), hexc(c["base"]), 0.9)  # the white blaze up the face
    if "saddle" in marks:
        cz = (J["hips"][2] + J["spine"][2]) / 2
        d = np.hypot((P[:, 2] - cz) / (0.28 * H), (P[:, 1] - J["spine"][1] - 0.02 * H) / (0.16 * H)) + 0.25 * fbm(P, 18 / H, 2, 9)
        mix(smoothstep(1.0, 0.85, d) * (up > -0.2), hexc(c["saddle"]))
    if "beard_grey" in marks:
        # the beard and the long hair of the muzzle, greying in ragged wisps (no edge the eye can follow)
        wisp = 0.25 * (fbm(P, 90 / H, 2, rng_seed + 41) - 0.5)
        mix(np.clip(F.s("beard") + F.head * smoothstep(0.6, 0.9, hq[:, 2] + wisp) * smoothstep(0.08, -0.08, hq[:, 1] + wisp), 0, 1),
            hexc(c["beard"]), 0.8)
    if "tabby" in marks:
        stripe = hexc(c["stripes"])
        amt = c.get("stripe_amt", 0.85)
        # mackerel: thin stripes down the sides from the spine line, rings on the legs and the tail, the M on the brow
        z = P[:, 2] / H
        w = fbm(P, 7 / H, 3, rng_seed + 31) - 0.5
        drop = np.clip((J["chest"][1] - P[:, 1]) / H, 0, 1)  # how far down the side
        # wavy stripes about a centimetre wide down the sides from the spine, leaning back as they go down, breaking
        # into bars low down; soft edged, the hair tips of the stripe and the ground mixing at the border
        sides = np.sin(2 * math.pi * (z * 7.0 + w * 0.9 + drop * 1.6))
        brk = smoothstep(0.3, 0.5, fbm(P, 22 / H, 2, rng_seed + 33) + 0.35 * (1 - drop))
        torso = F.s("torso", "belly", "chest", "thigh", "shoulder", "neck")
        m = smoothstep(0.38, 0.8, sides + 0.25 * (fbm(P, 60 / H, 2, rng_seed + 35) - 0.5)) * brk * torso * smoothstep(-0.6, 0.1, up)
        m = np.maximum(m, torso * smoothstep(0.035 * H, 0.012 * H, np.abs(P[:, 0])) * (up > 0.6))  # the spine line
        legs = F.s("leg", "arm", "paw")
        rings = np.sin(2 * math.pi * P[:, 1] / (0.05 * H) + 3 * w)
        m = np.maximum(m, legs * smoothstep(0.45, 0.85, rings) * (P[:, 1] > 0.06 * H))
        tl = F.s("tail")
        tz = np.linalg.norm(P - J["tail0"], axis=1) / H
        m = np.maximum(m, tl * np.maximum(smoothstep(0.5, 0.85, np.sin(2 * math.pi * tz * 6.0)), smoothstep(0.95, 1.05, tz)))
        # the tabby's face: thin lines running back over the crown from the brow (the "M" where they meet the
        # forehead), and two lines back across each cheek from the outer corner of the eye
        crown = F.head * smoothstep(0.12, 0.22, hq[:, 1]) * smoothstep(0.66, 0.5, hq[:, 2])
        lines = smoothstep(0.62, 0.9, np.cos(2 * math.pi * hq[:, 0] / 0.11 + 0.6 * np.sin(2 * math.pi * hq[:, 2] * 1.5)))
        brow = crown * lines * smoothstep(0.4, 0.3, np.abs(hq[:, 0]))
        side = smoothstep(0.24, 0.32, np.abs(hq[:, 0])) * smoothstep(0.72, 0.6, hq[:, 2]) * smoothstep(0.1, 0.25, hq[:, 2])
        cheek = F.head * side * (smoothstep(0.022, 0.006, np.abs(hq[:, 1] - 0.12 + 0.25 * (0.62 - hq[:, 2])))
                                 + smoothstep(0.02, 0.005, np.abs(hq[:, 1] + 0.0 + 0.2 * (0.62 - hq[:, 2]))))
        m = np.maximum(m, np.maximum(brow, cheek * 0.8))
        mix(m * amt, stripe)
    if "chin_pale" in marks:
        mix(F.s("jaw") + F.head * smoothstep(0.75, 0.9, hq[:, 2]) * smoothstep(0.0, -0.05, hq[:, 1]), hexc(c["belly"]), 0.75)
    if "cap_grey" in marks:
        mix(F.head * smoothstep(0.08, 0.16, hq[:, 1]) * smoothstep(0.65, 0.55, hq[:, 2]) * smoothstep(0.35, 0.25, np.abs(hq[:, 0])) + (part == "ear"), hexc(c["patch"]), 0.9)
    if "tail_grey" in marks:
        mix(F.s("tail"), hexc(c["patch"]), 0.95)
    if "tux" in marks:
        white = hexc(c["white"])
        chest = F.s("chest", "throat", "belly") * smoothstep(0.3, -0.4, up)
        paws = F.s("paw", "leg", "pad") * smoothstep(0.06 * H, 0.03 * H, P[:, 1])
        face = F.head * smoothstep(0.62, 0.78, hq[:, 2]) * smoothstep(0.28, 0.22, np.abs(hq[:, 0])) + F.s("jaw")
        mix(np.maximum(np.maximum(chest, paws), face), white)
    if "tortie" in marks:
        v1 = fbm(P, 10 / H, 3, rng_seed + 41)
        v2 = fbm(P, 16 / H, 3, rng_seed + 43)
        mix(smoothstep(0.5, 0.56, v1), hexc(c["orange"]))
        mix(smoothstep(0.62, 0.68, v2) * 0.8, hexc(c["cream"]))
    if "mud" in marks:
        m = smoothstep(0.22 * H, 0.06 * H, P[:, 1] + 0.08 * H * fbm(P, 12 / H, 2, 51)) + np.isin(part, ["belly"]) * smoothstep(0.0, -0.8, up) * 0.5
        mix(m * F.s("leg", "paw", "belly", "hoof", "thigh"), hexc(c["mud"]), 0.7)
    # ---- the fur (or skin) itself
    if strand_v is None:
        strand_v = np.zeros(n)
    tips = hexc(c["tips"]) if "tips" in c else None
    hair = F.fur
    if skin:
        # pig skin: fine mottling, sparse pale bristles, wrinkles at the neck and the joints
        mot = fbm(P, 60 / H, 3, rng_seed + 61)
        col *= (0.94 + 0.10 * mot)[:, None]
        bristle = strand_v ** 6 * hair
        col = col * (1 - 0.18 * bristle[:, None]) + hexc(0xf0e0c8)[None, :] * 0.18 * bristle[:, None]
        height = 0.35 * strand_v * hair
    else:
        wire = c.get("wire", False)
        k = 0.42 if wire else 0.34
        col *= (1 - k * hair + 2 * k * hair * strand_v)[:, None] ** 1.0
        if tips is not None:
            t = (strand_v ** 3 * hair)[:, None]
            col = col * (1 - 0.35 * t) + tips[None, :] * 0.35 * t
        height = strand_v * hair
    # ---- the parts that are not fur
    pad = np.isin(part, ["pad"]) | (np.isin(part, ["paw", "hoof"]) & (N[:, 1] < -0.55) & (P[:, 1] < 0.03 * H))
    padc = hexc(c["pad"])
    pebble = vnoise(P, 900 / H * 0.5, 7)
    col[pad] = padc * (0.85 + 0.3 * pebble[pad])[:, None]
    height[pad] = 0.25 * pebble[pad]
    if sp == "pig":
        hoof = part == "hoof"
        col[hoof] = hexc(0x3a3028) * (0.8 + 0.4 * vnoise(P[hoof], 200 / H, 3))[:, None]
        height[hoof] = 0.1 * vnoise(P[hoof], 300 / H, 4)
    claw = part == "claw"
    col[claw] = hexc(c["claw"]) * (0.85 + 0.25 * vnoise(P[claw], 400 / H, 5))[:, None]
    height[claw] = 0.0
    # the nose leather
    nose = part == "nose"
    if sp == "pig":
        # the snout disc is its flat front only (by the surface, not the triangles); its rim is skin
        o_, R_, L_ = Bd.marks["head"]
        nose = F.headb & (hq[:, 2] > 0.93) & ((N @ R_[:, 2]) > 0.55)
    nw = smoothstep(0.25, 0.6, F.s("nose")) if sp != "pig" else nose.astype(float)
    nose = nw > 0.0
    if nose.any():
        nc = hexc(c["nose"])
        peb = vnoise(P[nose], 1300 / H * (0.5 if sp == "pig" else 1.0), 11)
        wn = nw[nose][:, None]
        col[nose] = col[nose] * (1 - wn) + nc * (0.8 + 0.35 * peb)[:, None] * wn
        height[nose] = height[nose] * (1 - wn[:, 0]) + 0.45 * peb * wn[:, 0]
        # the nostrils: two dark commas low on the front (the pig's two round ones in the disc)
        nq = hq[nose]
        if sp == "pig":
            m = smoothstep(0.045, 0.03, np.hypot(np.abs(nq[:, 0]) - 0.055, nq[:, 1] + 0.005)) * (nq[:, 2] > 0.99)
        else:
            m = smoothstep(0.035, 0.022, np.hypot(np.abs(nq[:, 0]) - 0.045 * (1 if sp == "dog" else 0.5), nq[:, 1] - 0.02)) * (nq[:, 2] > 0.93)
        cc = col[nose]
        col[nose] = cc * (1 - m[:, None] * 0.85)
        h = height[nose]
        height[nose] = h * (1 - m) - 0.5 * m
    # the mouth: dark lips and a dark pink inside
    mc, mr, mR = Bd.marks["mouth"]
    mq = (P - mc) @ mR / mr
    inside = (np.linalg.norm(mq * np.array((1.0, 0.75, 1.0)), axis=1) < 1.6) & ((N * ((P - mc) @ mR @ mR.T)).sum(1) < 0) & F.headb
    # the lips: a dark band along the mouth line only, fading out above and below it (not a patch on the muzzle)
    lw = (F.headb & ~inside) * smoothstep(1.9, 0.9, np.abs(mq[:, 1])) * smoothstep(1.25, 1.0, np.hypot(mq[:, 0], mq[:, 2])) * (1 - nw)
    col = col * (1 - 0.55 * lw[:, None]) + hexc(c["nose"]) * 0.35 * lw[:, None]
    col[inside] = hexc(0x6a2a2a) * (0.75 + 0.3 * vnoise(P[inside], 300 / H, 13))[:, None]
    height[inside] *= 0.2
    height *= 1 - 0.8 * lw
    # the eyes: iris and pupil by the angle from the look; a dark rim round the opening
    eye = part == "eye"
    if eye.any():
        irc = hexc(c["iris"])
        out = np.zeros((eye.sum(), 3))
        Pe = P[eye]
        best = np.full(len(Pe), -2.0)
        for (ec, look, er, _lids) in Bd.marks["eyes"]:
            dv = Pe - ec
            cosang = (dv @ look) / np.maximum(np.linalg.norm(dv, axis=1), 1e-9)
            take = np.linalg.norm(dv, axis=1) < er * 1.6
            ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
            # the cat's pupil is a tall slit: squash the angle sideways
            if sp == "cat":
                side = unit(np.cross(np.array((0, 1.0, 0)), look))
                lat = np.degrees(np.arcsin(np.clip((dv @ side) / np.maximum(np.linalg.norm(dv, axis=1), 1e-9), -1, 1)))
                vert = np.sqrt(np.maximum(ang ** 2 - lat ** 2, 0))
                pup = np.hypot(lat / 0.32, vert) < 30
            elif sp == "pig":
                pup = ang < 14
            else:
                pup = ang < 17
            iris = ang < (52 if sp == "cat" else 47)
            ring = ang < 56
            cc = np.tile(hexc(0x3a2a20), (len(Pe), 1))  # the dark sclera at the edge
            tex = 0.75 + 0.5 * vnoise(Pe, 2400 / H, 21)
            cc[ring] = irc * 0.55
            cc[iris] = irc[None, :] * tex[iris, None] * (0.75 + 0.45 * (ang[iris, None] / 50))
            cc[pup] = hexc(0x060505)
            out[take] = cc[take]
        col[eye] = out
        height[eye] = 0.0
        # the lids: a dark rim on the skin round each eye
        for (ec, look, er, _lids) in Bd.marks["eyes"]:
            d = np.linalg.norm(P - ec, axis=1)
            rim = F.headb & ~eye & (d < er * 1.16)
            col[rim] = col[rim] * 0.35 + hexc(0x1a1210) * 0.65
    # the inner ear: skin, few hairs
    ear = part == "ear"
    if ear.any():
        o_, R_, L_ = Bd.marks["head"]
        erect = rig["P"]["ears"] in ("cat", "prick")
        inner_dir = R_[:, 2] if erect else None
        if erect:
            inner = ear & ((N @ inner_dir) > 0.15)
        else:
            centre = o_ + R_ @ np.array((0, 0.2, 0.3)) * L_
            inner = ear & (((P - centre) * N).sum(1) < 0)
        skinc = hexc(0xb88078) if c["base"] > 0x404040 or sp != "dog" else hexc(0x5a3a34)
        if c["base"] < 0x303030:
            skinc = hexc(0x4a3432)
        if sp == "cat":
            # the cat's ear: pale skin under fine hair, not bare pink
            col[inner] = col[inner] * 0.5 + hexc(0xc8a296) * 0.5 * (0.85 + 0.3 * strand_v[inner])[:, None]
            height[inner] *= 0.6
        else:
            col[inner] = col[inner] * 0.35 + skinc * 0.65 * (0.85 + 0.3 * strand_v[inner])[:, None]
            height[inner] *= 0.35
    col *= F.ao[:, None]
    return np.clip(col, 0, 1), height


def normal_map(height, pos, mask, strength):
    """Normals from the height picture (top row first): slopes per metre of the surface, flat across islands."""
    du = np.linalg.norm(np.gradient(pos, axis=1), axis=-1)
    dv = np.linalg.norm(np.gradient(pos, axis=0), axis=-1)
    dhu = np.gradient(height, axis=1) / np.maximum(du, 1e-5)
    dhv = np.gradient(height, axis=0) / np.maximum(dv, 1e-5)
    edge = (du > 0.02) | (dv > 0.02) | ~mask
    dhu[edge] = 0.0
    dhv[edge] = 0.0
    # rows run down the picture: the shader's v grows downward, so the green channel is -dh/dv (rows)
    n = np.stack([-dhu * strength, -dhv * strength, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)


def paint_rig(ob, Bd, vparts, rig, coats, size=512, seed=1873):
    """Colour pictures for each coat of a rig and the rig's one normal picture. Painted at 2x and filtered down."""
    S2 = size * 2
    pos, nrm, part, names, vert = raster(ob, S2, vparts)
    F = Field(Bd, pos, nrm, part, names, S2, vert)
    H = Bd.H
    sp = rig["species"]
    coat_kind = rig["P"].get("coat", "short")
    width = {"cat": 0.0008, "pig": 0.0016}.get(sp, 0.0012 * math.sqrt(H / 0.5))
    length = {"short": 0.012, "smooth": 0.010, "ruff": 0.022, "wire": 0.016, "cat": 0.010, "pig": 0.008}.get(coat_kind, 0.012)
    sv, _ = strands(F.P, F.flow, F.N, width, length, taps=12, seed=seed)
    clump = fbm(F.P, 1.0 / (width * 6), 2, seed + 3)
    sv = np.clip(0.75 * sv + 0.45 * (clump - 0.5) + 0.12, 0, 1)
    out = {}
    hgt = None
    for name in coats:
        col, height = coat(F, name, rig, seed, sv)
        img = F.put(col)
        img = dilate(img, F.mask)
        out[name] = down2(img)
        if hgt is None:
            hgt = height
    hmap = F.put(hgt[:, None])[..., 0]
    strength = {"cat": 0.0014, "pig": 0.0018}.get(sp, 0.002)
    nm = normal_map(hmap, pos, F.mask, strength)
    nm = dilate(nm, F.mask)
    n = down2(nm) * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    return out, (n * 0.5 + 0.5).astype(np.float32), F

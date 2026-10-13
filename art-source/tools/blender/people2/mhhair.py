"""Hair, beards and moustaches on the MakeHuman head (docs/people.md "Hair").

The same two kinds of piece as hair.py, made on MakeHuman's head instead of the old one:
- shells: the head's own skin under the hair (the scalp for a hair style, the beard's zone for a beard), pushed out
  along the skin's normals by a thickness that grows from the hairline (0 at the line, sunk a millimetre there so the
  rim meets the skin without a seam), reduced to the piece's triangle budget;
- tubes: buns, plaits, a coronet, moustaches, an imperial tuft, swept along paths on the head (hair._tube).
Every piece is bound to the base mesh (mh.Binding), so it carries the face and body sliders like the skin under it,
and weighted like that skin (head; the jaw for what grows on the jaw). Its UVs run over the face picture's hair
swatches (mhface.HAIR_RECT strands, BRAID_RECT a plait), so a piece has the hair colour of the face it goes with.
The hairline and the beard's zone are the face painter's own (mhface.hairline, beard_zone): paint and piece agree.
"""

import math

import numpy as np

from . import B
from . import mh
from . import mhface
from . import rig

# ---------------------------------------------------------------- the pictures: strand swatches with alpha

# Where the hair pieces' pictures sit in the face square (u0, v0, u1, v1; v up). HAIR_RECT and BRAID_RECT are
# mhface's; LOCK_RECT and BEARD_RECT use the square's free corners (no island within 25 texels).
HAIR_RECT = mhface.HAIR_RECT  # shells: fine strands along v, mirrored in u
BRAID_RECT = mhface.BRAID_RECT  # a plait's weave along v
LOCK_RECT = (0.815, 0.015, 0.985, 0.385)  # locks: NLOCK columns, each a lock from its root (v0) to its tip (v1)
BEARD_RECT = (0.555, 0.805, 0.785, 0.990)  # beards and moustaches: coarse, wavy strands along v
NLOCK = 4  # lock columns: 0, 1 fine head hair, 2 coarse and wavy (beards), 3 a twisted, waxed point
PAD = 3  # texels kept free inside a swatch's edge (linear filtering never reaches past it)

# Hair colour as a pigment and a share of white strands (the old: grey is pigment and white mixed strand by strand,
# not a grey dye). mhface.HAIR keeps each name's mean colour for brows and stubble.
PIGMENT = {"grey": ((0.30, 0.22, 0.15), 0.55), "greydark": ((0.20, 0.15, 0.11), 0.35),
           "white": ((0.42, 0.37, 0.31), 0.88)}
WHITE_HAIR = np.array((0.80, 0.79, 0.76), np.float32)


def _pigment(look):
    """(pigment rgb, share of white strands) of a look's hair."""
    name = look.get("hair")
    if isinstance(name, str) and name in PIGMENT:
        p, w = PIGMENT[name]
        return np.array(p, np.float32), w
    rgb = mhface.HAIR.get(name, mhface.HAIR["brown"]) if isinstance(name, str) else name
    return np.array(rgb, np.float32), 0.0


def _rect_px(rect, size):
    a0, b0, a1, b1 = rect
    return int(round(a0 * size)), int(round(b0 * size)), int(round(a1 * size)), int(round(b1 * size))


class Strands:
    """A swatch drawn strand by strand: colour, coverage, the top strand's height and a relief field. Strands are
    drawn back to front (by height); each is a soft line along the rows with its own width, shade and ends."""

    def __init__(self, w, h, wrap=True):
        self.w, self.h, self.wrap = w, h, wrap
        self.col = np.zeros((h, w, 3), np.float32)
        self.cov = np.zeros((h, w), np.float32)
        self.top = np.zeros((h, w), np.float32)
        self.rel = np.zeros((h, w), np.float32)

    def draw(self, xs, ws, y0, y1, rgb, height, op=1.0, soft=6.0):
        """One strand: xs (h,) its x on every row, ws (h,) its half width in texels, rows y0..y1 (floats; ends fade
        over `soft` rows), rgb its colour, height its place in the stack (0 under, 1 on top)."""
        rows = np.arange(self.h)
        act = np.clip((rows - y0) / soft, 0, 1) * np.clip((y1 - rows) / soft, 0, 1) * op
        m = act > 0.01
        if not m.any():
            return
        r = rows[m]
        x = xs[m]
        w = np.maximum(ws[m], 0.35)
        a0 = act[m]
        base = np.floor(x).astype(int)
        for dx in range(-3, 4):
            ix = base + dx
            d = (ix + 0.5 - x) / w
            a = np.exp(-d * d) * a0
            if self.wrap:
                ix = ix % self.w
            else:
                ok = (ix >= 0) & (ix < self.w)
                ix, a, rr = ix[ok], a[ok], r[ok]
                if not len(ix):
                    continue
            rr = r if self.wrap else rr
            c = self.col[rr, ix]
            self.col[rr, ix] = c * (1 - a[:, None]) + np.asarray(rgb, np.float32)[None] * a[:, None]
            self.cov[rr, ix] = 1 - (1 - self.cov[rr, ix]) * (1 - a)
            self.top[rr, ix] = np.where(a > 0.35, height, self.top[rr, ix])
            self.rel[rr, ix] = np.maximum(self.rel[rr, ix], a * (0.6 + 0.4 * height))


def _equalize(f):
    """Ranks of a field mapped to 0..1: a threshold t keeps the share 1 - t of its texels."""
    r = np.argsort(np.argsort(f.ravel(), kind="stable"), kind="stable")
    return (r / max(r.size - 1, 1)).reshape(f.shape).astype(np.float32)


def _strand_rgb(rng, pig, white, n, lo=0.70, hi=1.25):
    """Every strand's own colour: the pigment a little lighter or darker, white strands among them (the old)."""
    k = rng.uniform(lo, hi, n).astype(np.float32)
    c = np.clip(pig[None] * k[:, None], 0, 1)
    if white > 0:
        wm = rng.uniform(0, 1, n) < white
        wk = rng.uniform(0.82, 1.08, n).astype(np.float32)
        c[wm] = np.clip((WHITE_HAIR * 0.72 + pig * 0.28)[None] * wk[wm, None], 0, 1)
        c[~wm] = np.clip(c[~wm] * (1.0 + 0.9 * white) + 0.12 * white, 0, 1)
    return c


def _shell_swatch(w, h, pig, white, seed, coarse=False, coil=False):
    """Strands along v for shells and their fuzz: colour, alpha (0.02..0.98, an even spread: a vertex alpha a keeps
    about the share a of the texels, top strands first), relief."""
    rng = np.random.default_rng(seed)
    S = Strands(w, h, wrap=True)
    gap = pig * ((0.40 if not coarse else 0.55) if not white else 0.6) + (WHITE_HAIR * 0.35 * white if white else 0)
    S.col[:] = gap
    rows = np.arange(h, dtype=np.float32)
    n = int(w * h / (40 if not coarse else 34)) if not coil else int(w * h / 9)
    cols = _strand_rgb(rng, pig, white, n)
    heights = rng.uniform(0, 1, n)
    order = np.argsort(heights)
    for i in order:
        if coil:  # tight coils: small loops, drawn as short arcs
            x0, yc = rng.uniform(0, w), rng.uniform(-4, h + 4)
            r0, ln = rng.uniform(1.0, 2.2), rng.uniform(5, 11)
            t = rows - yc
            xs = x0 + r0 * np.sin(t * 2.4 + rng.uniform(0, 6.3))
            S.draw(xs, np.full(h, rng.uniform(0.5, 0.8)), yc - ln / 2, yc + ln / 2, cols[i], heights[i], soft=2.0)
            continue
        x0 = rng.uniform(0, w)
        L = rng.uniform(0.35, 1.0) * h * (0.6 if coarse else 1.0)
        y0 = rng.uniform(-0.2 * h, h - 0.3 * L)
        edge = min(x0, w - x0) / 24.0  # 0 at a mirrored edge
        calm = min(1.0, edge) ** 2
        amp = rng.uniform(0.2, 1.4) * (1.6 if coarse else 1.0) * calm
        lam = rng.uniform(40, 140) * (0.35 if coarse else 1.0)
        drift = rng.uniform(-0.04, 0.04) * (2.0 if coarse else 1.0) * calm
        xs = x0 + amp * np.sin(rows / lam * 6.283 + rng.uniform(0, 6.3)) + drift * (rows - y0)
        ws = np.full(h, rng.uniform(0.50, 0.85) * (1.1 if coarse else 1.0))
        S.draw(xs, ws, y0, y0 + L, cols[i], heights[i], soft=8.0)
    f = S.cov * (0.25 + 0.75 * S.top)
    alpha = 0.02 + 0.96 * _equalize(f + 1e-4 * rng.uniform(0, 1, f.shape))
    # light falls on the strands on top, the gaps under them stay dark
    shade = 0.78 + 0.34 * alpha
    col = S.col * shade[..., None]
    rel = S.rel
    return col, alpha, rel


def _lock_swatch(w, h, pig, white, seed, kind):
    """One lock: v from its root (row 0) to its tip (row h-1). Strands run the lock's length, narrowing to the
    tip and ending one by one; the alpha is the strands' coverage (0 between and past them)."""
    rng = np.random.default_rng(seed)
    S = Strands(w, h, wrap=False)
    S.col[:] = pig * 0.70
    rows = np.arange(h, dtype=np.float32)
    t = rows / (h - 1)
    c = (w - 1) / 2.0
    coarse = kind == 2
    n = {0: 60, 1: 60, 2: 46, 3: 70}[kind]
    cols = _strand_rgb(rng, pig, white, n, 0.84, 1.16)
    heights = rng.uniform(0, 1, n)
    for i in np.argsort(heights):
        x0 = c + (w * 0.46) * np.clip(rng.normal(0, 0.45), -1, 1)
        if kind == 3:  # a waxed point: the strands drawn tight together and twisted
            taper = 1 - 0.92 * t ** 0.8
            xs = c + (x0 - c) * taper + 1.2 * np.sin(t * 22.0 + rng.uniform(0, 6.3)) * taper
        else:
            taper = 1 - (0.80 if coarse else 0.72) * t ** 1.6
            amp = rng.uniform(0.2, 1.0) * (2.6 if coarse else 1.0)
            lam = rng.uniform(0.25, 0.7) * (0.45 if coarse else 1.0)
            xs = c + (x0 - c) * taper + amp * np.sin(t / lam * 6.283 + rng.uniform(0, 6.3))
        end = rng.uniform(0.62, 1.0) if kind != 3 else rng.uniform(0.85, 1.0)
        start = rng.uniform(0.0, 0.08)
        ws = (rng.uniform(0.55, 0.9) * (1.4 if coarse else 1.0)) * (1 - 0.35 * t)
        S.draw(xs, ws, start * h, end * h, cols[i], heights[i], soft=10.0)
    across = np.abs(np.arange(w) - c) / (w * 0.5)
    shade = (0.86 + 0.20 * S.top) * (1.0 - 0.15 * across[None, :] ** 2)
    col = S.col * shade[..., None]
    alpha = np.clip(S.cov * 1.15, 0, 0.98) * np.clip(1.6 - 1.6 * across[None, :], 0, 1)
    return col, alpha, S.rel


def _braid_swatch(w, h, pig, white, seed):
    """A plait's weave along v: three strands crossing (lobes), each lobe drawn strand by strand."""
    rng = np.random.default_rng(seed)
    S = Strands(w, h, wrap=True)
    S.col[:] = pig * 0.35
    rows = np.arange(h, dtype=np.float32)
    v = rows / h
    nlobe = 7
    n = int(w * h / 30)
    cols = _strand_rgb(rng, pig, white, n)
    heights = rng.uniform(0, 1, n)
    for i in np.argsort(heights):
        k = rng.integers(0, nlobe)
        ph = (k + rng.uniform(0.05, 0.95)) / nlobe
        x0 = rng.uniform(0, w)
        # within a lobe the strands bow across the plait
        y0, y1 = (ph - 0.5 / nlobe) * h, (ph + 0.55 / nlobe) * h
        s = (v - ph) * nlobe
        xs = x0 + 9.0 * np.sin(np.clip(s, -0.6, 0.6) * 2.6) * (1 if k % 2 else -1)
        S.draw(xs, np.full(h, rng.uniform(0.6, 1.0)), y0, y1, cols[i], heights[i], soft=4.0)
    lobe = np.sin(((v * nlobe) % 1.0) * math.pi) ** 0.6
    f = S.cov * (0.3 + 0.7 * S.top) * (0.4 + 0.6 * lobe[:, None])
    alpha = 0.02 + 0.96 * _equalize(f + 1e-4 * rng.uniform(0, 1, f.shape))
    col = S.col * (0.55 + 0.55 * lobe[:, None, None]) * (0.85 + 0.25 * alpha[..., None])
    return col, alpha, S.rel * (0.5 + 0.5 * lobe[:, None])


def _pad(img, X0, Y0, X1, Y1, n=8):
    """Repeat a swatch's edge texels outward (filtering and mipmaps there read the swatch, not black)."""
    H, W = img.shape[:2]
    for k in range(1, n + 1):
        if Y0 - k >= 0:
            img[Y0 - k, X0:X1] = img[Y0, X0:X1]
        if Y1 - 1 + k < H:
            img[Y1 - 1 + k, X0:X1] = img[Y1 - 1, X0:X1]
    for k in range(1, n + 1):
        if X0 - k >= 0:
            img[max(Y0 - n, 0):min(Y1 + n, H), X0 - k] = img[max(Y0 - n, 0):min(Y1 + n, H), X0]
        if X1 - 1 + k < W:
            img[max(Y0 - n, 0):min(Y1 + n, H), X1 - 1 + k] = img[max(Y0 - n, 0):min(Y1 + n, H), X1 - 1]


def paint_swatches(rgb, hgt, look, size):
    """The hair pieces' pictures in a face picture (rgb and the height field painted in place): shell strands, a
    plait's weave, the locks and the beard's coarse strands, in the look's hair. Returns the picture's alpha: 1
    everywhere but the swatches, where it is the strands' coverage (docs/people.md "Hair": a hair fragment is kept
    where picture alpha + vertex alpha > 1)."""
    alpha = np.ones(rgb.shape[:2], np.float32)
    pig, white = _pigment(look)
    seed = int(look.get("seed", 1))
    coil = look.get("skin") == "dark"  # the African sailors' tightly coiled hair
    jobs = [(HAIR_RECT, "shell"), (BRAID_RECT, "braid"), (BEARD_RECT, "beard")]
    for rect, what in jobs:
        X0, Y0, X1, Y1 = _rect_px(rect, size)
        w, h = X1 - X0, Y1 - Y0
        if what == "shell":
            col, a, rel = _shell_swatch(w, h, pig, white, seed + 101, coil=coil)
        elif what == "braid":
            col, a, rel = _braid_swatch(w, h, pig, white, seed + 103)
        else:
            col, a, rel = _shell_swatch(w, h, pig, white, seed + 105, coarse=True, coil=coil)
        rgb[Y0:Y1, X0:X1] = np.clip(col, 0, 1)
        alpha[Y0:Y1, X0:X1] = a
        hgt[Y0:Y1, X0:X1] = 0.0005 * rel
        for img in (rgb, alpha, hgt):
            _pad(img, X0, Y0, X1, Y1)
    X0, Y0, X1, Y1 = _rect_px(LOCK_RECT, size)
    lw = (X1 - X0) // NLOCK
    for k in range(NLOCK):
        x0 = X0 + k * lw
        col, a, rel = _lock_swatch(lw, Y1 - Y0, pig, white, seed + 111 + k, k)
        rgb[Y0:Y1, x0:x0 + lw] = np.clip(col, 0, 1)
        alpha[Y0:Y1, x0:x0 + lw] = a
        hgt[Y0:Y1, x0:x0 + lw] = 0.0006 * rel
    for img in (rgb, alpha, hgt):
        _pad(img, X0, Y0, X0 + lw * NLOCK, Y1)
    return alpha


def lock_uv(k, s, t):
    """UVs on lock column k: s across (-1..1), t along (0 root .. 1 tip), kept PAD texels inside."""
    a0, b0, a1, b1 = LOCK_RECT
    size = mhface.SIZE
    cw = (a1 - a0) / NLOCK
    pad = PAD / size
    u = a0 + k * cw + pad + (cw - 2 * pad) * (0.5 + 0.5 * np.clip(s, -1, 1))
    v = b0 + pad + (b1 - b0 - 2 * pad) * np.clip(t, 0, 1)
    return np.stack((u, v), -1)


def rect_uv(rect, u, v):
    """UVs in a swatch: u, v 0..1 kept PAD texels inside its edges."""
    a0, b0, a1, b1 = rect
    pad = PAD / mhface.SIZE
    return np.stack((a0 + pad + (a1 - a0 - 2 * pad) * np.clip(u, 0, 1),
                     b0 + pad + (b1 - b0 - 2 * pad) * np.clip(v, 0, 1)), -1)


def paint_scalp(rgb, hgt, look, G, pos, head, sex, seed):
    """The scalp under the hair: hair-coloured where hair grows (no skin through a gap between strands), thinning to
    single hairs at the hairline; a bald crown is clean skin (MakeHuman's old skins carry painted stubble there, read
    as a ginger scalp) with a fringe below it. Returns the hair's share per texel (for the pores)."""
    el, az = mhface.head_angles(pos)
    pig, white = _pigment(look)
    scalp = look.get("scalp", "hair")
    line = mhface.hairline(az, sex, look.get("recede", 0.0)) + 1.2 * _noise(pos, 70.0, seed + 41)
    thin = 0.55 + 0.45 * np.clip(_noise(pos, 900.0, seed + 47) * 0.8 + 0.5, 0, 1)  # single hairs at the line
    sc = mhface.above(el, line - 3.0, line + 3.5) * head
    sc = np.where(el < line + 3.5, sc * thin, sc)
    if scalp == "bald":
        bl = mhface.bald_line(az) + 3.0 * _noise(pos, 120.0, seed + 43)
        crown = mhface.above(el, bl - 2.0, bl + 6.0) * mhface.above(el, line - 6.0, line) * head
        # the crown's skin: the forehead's own colour, a little pinker and smoother, with faint freckles of age
        fore = head & (pos[..., 2] > 0.02) & (pos[..., 1] > 0.035) & (pos[..., 1] < 0.06) & (np.abs(pos[..., 0]) < 0.03)
        skin = rgb[fore].mean(0) if fore.any() else np.array((0.7, 0.55, 0.45), np.float32)
        skin = np.clip(skin * np.array((1.03, 0.98, 0.97)), 0, 1)
        mott = 1.0 + 0.05 * _noise(pos, 25.0, seed + 49) + 0.03 * _noise(pos, 90.0, seed + 51)
        spots = np.clip(_noise(pos, 140.0, seed + 53) - 0.55, 0, 1) * 1.5 * (look.get("age") == "old")
        bare = skin[None, None] * mott[..., None] * (1 - 0.18 * spots[..., None])
        rgb[:] = rgb * (1 - crown[..., None]) + bare * crown[..., None]
        sc = sc * mhface.below(el, bl - 5.0, bl + 3.0) * 0.9
    if scalp != "none":
        strands = 0.5 + 0.5 * _noise(pos * np.array((1.0, 0.3, 1.0)), 650.0, seed + 7)
        mean = pig * (1 - white) + WHITE_HAIR * white
        hc = mean * (0.52 + 0.30 * strands[..., None])  # as dark as the shaded hair pieces over it (no light rim)
        if white > 0:  # single white hairs at the line and in the fringe, not a grey wash
            wh = np.clip(_noise(pos, 1300.0, seed + 55) * 0.5 + 0.5, 0, 1) < white
            mix = mean * (0.55 + 0.30 * strands[..., None])
            hc = np.where(wh[..., None], mix * 1.12, mix * 0.92)
        sc = sc * (0.80 + 0.2 * strands)
        rgb[:] = rgb * (1 - 0.95 * sc[..., None]) + hc * 0.95 * sc[..., None]
        hgt += 0.00025 * sc * strands
    return sc


def _noise(p, scale, seed):
    from .paint import _noise3
    return _noise3(p, scale, seed)


# ---------------------------------------------------------------- the head and its surfaces

MEN = ["crop", "side", "long", "bald", "capped"]
WOMEN = ["bun", "plaits", "coronet", "undercap"]
BEARDS = ["full", "short", "chops", "sideburns", "chin", "imperial"]
MOUSTACHES = ["walrus", "handlebar", "chevron"]
HEAD_C = mhface.HEAD_C
SINK = 0.0014  # a piece's faded edge lies this far under the skin (no line where hair meets skin)


def styles_for(base):
    """The pieces a base body gets: hair styles, beards, moustaches."""
    if base in ("woman", "old_woman"):
        return (list(WOMEN) if base == "woman" else ["bun", "undercap"]), [], []
    if base == "child":
        return ["crop", "plaits"], [], []
    return list(MEN), list(BEARDS), list(MOUSTACHES)


def _unit(v):
    v = np.asarray(v, np.float64)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def angles(D):
    """Elevation and azimuth (degrees, azimuth 0 ahead, 180 behind, both sides alike) of directions from HEAD_C."""
    el = np.degrees(np.arcsin(np.clip(D[..., 1], -1, 1)))
    az = np.degrees(np.abs(np.arctan2(D[..., 0], D[..., 2])))
    return el, az


def direction(el, az, side=1.0):
    e, a = np.radians(el), np.radians(az)
    return np.stack((side * np.cos(e) * np.sin(a), np.sin(e) + 0 * a, np.cos(e) * np.cos(a)), -1)


def _bvh(P, T):
    from mathutils.bvhtree import BVHTree
    return BVHTree.FromPolygons([tuple(p) for p in P], [tuple(int(i) for i in t) for t in T], all_triangles=True)


class Head:
    """One body's head (lod 0 or 1): the copy's head triangles in the head frame (the eyes' midpoint at the origin,
    game axes), its normals, the painter's landmarks of the body's own head, and the surfaces hair is laid on: the
    skull (the head without its ears: MakeHuman's full head for the near copy, never inside the copy's own skin) and
    the ears."""

    def __init__(self, body, lod=0):
        from . import mhbody
        self.body = body
        self.lod = lod
        b = body.b
        T = mhbody.topology(lod)
        P = T.binding.eval(body.Pf)  # the copy's own skin: a shell made on it never lets that skin through
        self.P = P
        self.eyes = (body.Pf[b.vsets["joint-l-eye"]].mean(0) + body.Pf[b.vsets["joint-r-eye"]].mean(0)) / 2
        tris = []
        for f in T.faces:
            for k in range(1, len(f) - 1):
                tris.append((f[0], f[k], f[k + 1]))
        tris = np.array(tris, np.int64)
        head = np.array([p == "head" for p in T.part])
        self.head_tris = tris[head[tris].all(1)]
        self.N = mhface.vertex_normals(P, tris)
        self.Q = P - self.eyes
        G = mhface.geometry({"man": "m", "woman": "f", "child": "c", "old_man": "om",
                             "old_woman": "of"}[body.base])
        self.G = dict(G)
        self.bvh = _bvh(self.Q, self.head_tris)
        ear = np.asarray(T.region).astype(str) == "ear"
        # the skull goes on down the neck (the nape's hair lies there), ears left out
        chin = body.chin_y(body.Pf)
        nk = np.array([p in ("head", "neck") for p in T.part]) & (P[:, 1] > chin - 0.05)
        self.skull_tris = tris[nk[tris].all(1) & ~ear[tris].any(1)]
        self.skull = _bvh(self.Q, self.skull_tris)
        self.ears = _bvh(self.Q, self.head_tris[ear[self.head_tris].any(1)])
        self.fine_tris = None
        self.fine_skull = self.fine_ears = None
        if lod == 0:
            btris, src = b.tris()
            isl = mhbody.island_ids()
            k_of = {int(fi): k for k, fi in enumerate(b.body_faces)}
            on_head = np.array([isl[k_of[int(fi)]] == "head" for fi in src])
            hv = np.asarray(body.parts) == "head"
            self.fine_tris = btris[on_head & hv[btris].all(1)]
            self.fP = body.Pf
            self.fN = mhface.vertex_normals(body.Pf, btris)
            fear = mh.regions(b).astype(str) == "ear"
            fQ = body.Pf - self.eyes
            fnk = np.isin(np.asarray(body.parts), ("head", "neck")) & (body.Pf[:, 1] > chin - 0.05) &                 np.isin(np.arange(len(body.Pf)), b.body)
            self.fine_skull = _bvh(fQ, btris[fnk[btris].all(1) & ~fear[btris].any(1)])
            self.fine_ears = _bvh(fQ, self.fine_tris[fear[self.fine_tris].any(1)])

    # -- rays from outside toward HEAD_C: the outermost surface in a direction
    @staticmethod
    def _cast(bvh, D, reach=0.40):
        from mathutils import Vector
        r = np.full(len(D), np.nan)
        n = np.zeros((len(D), 3))
        for i, d in enumerate(D):
            hit = bvh.ray_cast(Vector(tuple(HEAD_C + d * reach)), Vector(tuple(-d)), reach)
            if hit[0] is not None:
                nn = np.array(hit[1])
                if nn @ d > 0.02:
                    r[i] = np.linalg.norm(np.array(hit[0]) - HEAD_C)
                    n[i] = nn
        return r, n

    def skull_r(self, D):
        """Distance from HEAD_C to the skull (ears left out) in each direction, and its normal (nan: no skull)."""
        r, n = self._cast(self.skull, D)
        if self.fine_skull is not None:
            rf, nf = self._cast(self.fine_skull, D)
            take = np.isnan(r) | (rf > r)
            r = np.where(np.isnan(r), rf, np.fmax(r, rf))
            n = np.where(take[:, None], nf, n)
        return r, n

    def ear_r(self, D):
        r, n = self._cast(self.ears, D)
        if self.fine_ears is not None:
            rf, nf = self._cast(self.fine_ears, D)
            r = np.fmax(r, rf)
        return r

    def onto(self, pts, out=0.0):
        """Points (head frame) put on the head's skin, `out` metres along its normal."""
        from mathutils import Vector
        res = []
        for p in pts:
            loc, nrm, fi, d = self.bvh.find_nearest(Vector(p))
            res.append(np.array(loc) + np.array(nrm) * out)
        return np.array(res)

    def at(self, el, az, out=0.0, side=1.0):
        """The skull seen from HEAD_C at elevation el and azimuth az (side +1 the person's left), `out` metres
        along its normal."""
        d = direction(el, az, side)
        r, n = self.skull_r(d[None])
        if np.isnan(r[0]):
            from mathutils import Vector
            loc, nrm, fi, dd = self.bvh.find_nearest(Vector(tuple(HEAD_C + d * 0.1)))
            return np.array(loc) + np.array(nrm) * out
        return HEAD_C + d * r[0] + n[0] * out

    def front(self, pts, out=0.0):
        """Points brought straight back (along -z) onto the face, `out` along the normal."""
        from mathutils import Vector
        res = []
        for p in pts:
            hit = self.bvh.ray_cast(Vector((p[0], p[1], 0.3)), Vector((0, 0, -1.0)))
            if hit[0] is None:
                loc, nrm, fi, d = self.bvh.find_nearest(Vector(p))
            else:
                loc, nrm = hit[0], hit[1]
            res.append(np.array(loc) + np.array(nrm) * out)
        return np.array(res)

    def front_n(self, pts):
        """Like front(), with the skin's normals."""
        from mathutils import Vector
        P, N = [], []
        for p in pts:
            hit = self.bvh.ray_cast(Vector((p[0], p[1], 0.3)), Vector((0, 0, -1.0)))
            if hit[0] is None:
                loc, nrm, fi, d = self.bvh.find_nearest(Vector(p))
            else:
                loc, nrm = hit[0], hit[1]
            P.append(np.array(loc))
            N.append(np.array(nrm))
        return np.array(P), np.array(N)


# ---------------------------------------------------------------- mesh helpers

def icosphere(subdiv):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    V = np.array([v.co[:] for v in bm.verts])
    F = np.array([[v.index for v in f.verts] for f in bm.faces])
    bm.free()
    return _unit(V), F


def adjacency(n, F):
    nb = [set() for _ in range(n)]
    for a, b, c in F:
        nb[a] |= {b, c}
        nb[b] |= {a, c}
        nb[c] |= {a, b}
    return [np.array(sorted(s), np.int64) for s in nb]


def smooth_field(vals, nb, iters, mask=None, keep_max=False):
    """Neighbour averaging (mask: only these move); keep_max: never below the start (a smooth envelope)."""
    v = vals.astype(np.float64).copy()
    v0 = v.copy()
    for _ in range(iters):
        nv = np.array([v[x].mean() if len(x) else v[i] for i, x in enumerate(nb)])
        if mask is not None:
            nv = np.where(mask, nv, v)
        v = np.maximum(nv, v0) if keep_max else nv
    return v


def fill_nan(vals, nb, iters=60):
    v = vals.copy()
    for _ in range(iters):
        bad = np.isnan(v)
        if not bad.any():
            break
        for i in np.nonzero(bad)[0]:
            good = v[nb[i]][~np.isnan(v[nb[i]])]
            if len(good):
                v[i] = good.mean()
    return np.where(np.isnan(v), np.nanmean(v), v)


def clip(P, N, t, tris, t0):
    """The part of the triangles where t > t0, cut along the contour t = t0 (new points on the edges, shared by the
    triangles on both sides): positions, normals, field, triangles, and which points lie on the contour."""
    out_p, out_n, out_t, edge = [], [], [], []
    vid = {}
    eid = {}

    def vert(i):
        if i not in vid:
            vid[i] = len(out_p)
            out_p.append(P[i])
            out_n.append(N[i])
            out_t.append(t[i])
            edge.append(False)
        return vid[i]

    def cut(i, j):
        k = (min(i, j), max(i, j))
        if k not in eid:
            a = (t0 - t[i]) / (t[j] - t[i])
            eid[k] = len(out_p)
            out_p.append(P[i] + (P[j] - P[i]) * a)
            n = N[i] + (N[j] - N[i]) * a
            out_n.append(n / max(np.linalg.norm(n), 1e-12))
            out_t.append(t0)
            edge.append(True)
        return eid[k]
    F = []
    for tri in tris:
        ins = [t[v] > t0 for v in tri]
        n_in = sum(ins)
        if n_in == 0:
            continue
        if n_in == 3:
            F.append(tuple(vert(v) for v in tri))
            continue
        poly = []
        for k in range(3):
            a, b = tri[k], tri[(k + 1) % 3]
            if ins[k]:
                poly.append(vert(a))
            if ins[k] != ins[(k + 1) % 3]:
                poly.append(cut(a, b))
        for k in range(1, len(poly) - 1):
            F.append((poly[0], poly[k], poly[k + 1]))
    return np.array(out_p), np.array(out_n), np.array(out_t), F, np.array(edge)


def split_sagittal(P, F):
    """The mesh cut along x = 0 (new points on the plane, shared by both halves): the strands' UVs mirror there, and a
    fold inside a triangle drew zigzag contours."""
    out_p, out_f = [], []
    key = {}

    def vid(p):
        k = (round(float(p[0]), 7), round(float(p[1]), 7), round(float(p[2]), 7))
        if k not in key:
            key[k] = len(out_p)
            out_p.append(np.array(p, float))
        return key[k]
    for sgn in (1.0, -1.0):
        Pc, _, _, Fc, _ = clip(P, P, sgn * P[:, 0] + 1e-12 * sgn, F, 0.0)
        for f in Fc:
            out_f.append(tuple(vid(Pc[i]) for i in f))
    out_f = [f for f in out_f if len(set(f)) == 3]
    return np.array(out_p), np.array(out_f, np.int64)


def decimate(P, F, budget, inner, name):
    """Blender's collapse to `budget` triangles, symmetric in x, only the `inner` points may go. (P, F) back."""
    import bpy
    n = len(F)
    if n <= budget:
        return P, np.asarray(F)
    me = bpy.data.meshes.new("_dec_" + name)
    me.from_pydata([tuple(B(*p)) for p in P], [], [tuple(int(i) for i in f) for f in F])
    me.update()
    ob = bpy.data.objects.new("_dec_" + name, me)
    bpy.context.scene.collection.objects.link(ob)
    vg = ob.vertex_groups.new(name="inner")
    vg.add([int(i) for i in np.nonzero(inner)[0]], 1.0, "REPLACE")
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = max(0.02, budget / n)
    m.use_symmetry = True
    m.symmetry_axis = "X"
    m.vertex_group = "inner"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    from . import G as toG
    Pd = np.array([toG(v.co) for v in ob.data.vertices])
    Fd = np.array([tuple(p.vertices) for p in ob.data.polygons if len(p.vertices) == 3])
    quads = [tuple(p.vertices) for p in ob.data.polygons if len(p.vertices) > 3]
    if quads:
        extra = [(q[0], q[k], q[k + 1]) for q in quads for k in range(1, len(q) - 1)]
        Fd = np.concatenate((Fd, np.array(extra))) if len(Fd) else np.array(extra)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return Pd, Fd


def face_normals(P, F):
    return _unit(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]))


class Part:
    """A piece's part: positions (head frame), triangles, per-vertex UV, alpha (the fade: docs/people.md "Hair")
    and occlusion (vertex blue)."""

    def __init__(self, P, F, UV, A, O):
        self.P, self.F, self.UV = np.asarray(P, np.float64), np.asarray(F, np.int64).reshape(-1, 3), np.asarray(UV)
        self.A = np.clip(np.asarray(A, np.float64), 0, 1)
        self.O = np.clip(np.asarray(O, np.float64), 0, 1)


# ---------------------------------------------------------------- shells over the scalp, sampled by direction

def pole_uv(D, pole, ref, theta_max):
    """Strands running away from (or into) a pole: u the angle round the pole (0 toward ref, 1 opposite, mirrored
    left and right: no seam), v the angle from the pole over theta_max."""
    p = _unit(pole)
    th = np.degrees(np.arccos(np.clip(D @ p, -1, 1)))
    e1 = _unit(np.asarray(ref, float) - p * (np.asarray(ref, float) @ p))
    e2 = np.cross(p, e1)
    phi = np.arctan2(D @ e2, D @ e1)
    return np.abs(phi) / math.pi, th / theta_max


class Shell:
    """A hair style's mass over the scalp. Built on a fine sphere of directions from HEAD_C: the style's coverage
    (1 where its hair is full, falling to 0 past its hairline: the faded edge), its thickness and its strands' flow
    (u across, v along) per direction; cut along coverage 0.02, laid on the skull (ears left out) and out by the
    thickness, with grooves between locks along the flow; reduced to the budget (the fade band keeps its points)."""

    def __init__(self, head, style, budget, name):
        D, F = icosphere(5 if head.lod == 0 else 4)
        cov = style.coverage(head, D)
        F = F[cov[F].max(1) > 0.02]
        Dc, _, cc, Fc, edge = clip(D, D, cov, F, 0.02)
        Fc = np.array(Fc, np.int64)
        on_edge = {tuple(np.round(p, 7)) for p in Dc[edge]}
        Dc, Fc = split_sagittal(Dc, Fc)
        edge = np.array([tuple(np.round(p, 7)) in on_edge for p in Dc])
        Dc = _unit(Dc)
        P = self._place(head, style, Dc, Fc)
        inner = (style.coverage(head, Dc) > 0.985) & ~edge & (np.abs(Dc[:, 0]) > 1e-6)
        Pd, Fd = decimate(P, Fc, budget, inner, name)
        # every point back onto the full-density surface (the reduction lays its triangles flat over the head)
        surf = _bvh(P, Fc)
        Dd = _unit(Pd - HEAD_C)
        from mathutils import Vector
        for i, d in enumerate(Dd):
            hit = surf.ray_cast(Vector(tuple(HEAD_C + d * 0.4)), Vector(tuple(-d)), 0.4)
            if hit[0] is not None:
                Pd[i] = np.array(hit[0])
        self.D, self.F, self.P = Dd, np.asarray(Fd, np.int64), Pd
        self.cov = np.clip(style.coverage(head, Dd), 0, 1)
        self.uv = style.flow(Dd)
        self.N = mhface.vertex_normals(self.P, self.F)
        self.dense = surf
        print("[people2]   shell %s: %d triangles from %d (budget %d)" % (name, len(self.F), len(Fc), budget))

    @staticmethod
    def _place(head, style, D, F):
        r0, n0 = head.skull_r(D)
        nb = adjacency(len(D), F)
        r0 = fill_nan(r0, nb)
        cov = np.clip(style.coverage(head, D), 0, 1)
        th = style.thickness(head, D)
        u, v = style.flow(D, raw=True)
        lump = style.lumps(u, v, D)
        g = np.clip(cov, 0, 1) ** 1.4
        r = r0 + th * g * lump - SINK * (1 - mhface.above(cov, 0.0, 0.5))
        if style.over_ears:
            re = head.ear_r(D)
            need = np.where(np.isnan(re), 0.0, np.maximum(re + style.ear_gap - r, 0.0)) * (cov > 0.02)
            need = smooth_field(need, nb, 30, keep_max=True)
            r = r + np.maximum(smooth_field(need, nb, 8), need)
        return HEAD_C + D * r[:, None]

    def layer(self, k, step, alpha, ao):
        """The k-th fuzz layer over the shell (0: the shell itself): out by k * step (none at the faded edge), its
        alpha the coverage times `alpha`."""
        g = np.clip(self.cov, 0, 1) ** 1.4
        P = self.P + self.N * (k * step * g)[:, None]
        return Part(P, self.F, rect_uv(HAIR_RECT, self.uv[:, 0], self.uv[:, 1]), self.cov * alpha,
                    np.full(len(P), ao) * (0.75 + 0.25 * g))

    def surface(self, D, lift=0.0, fallback=None):
        """Points on the shell's outer side in directions D (and its normal), `lift` out; past its edge the skull."""
        from mathutils import Vector
        P, N = np.zeros((len(D), 3)), np.zeros((len(D), 3))
        for i, d in enumerate(D):
            hit = self.dense.ray_cast(Vector(tuple(HEAD_C + d * 0.4)), Vector(tuple(-d)), 0.4)
            if hit[0] is not None and np.array(hit[1]) @ d > 0:
                P[i], N[i] = np.array(hit[0]), np.array(hit[1])
            else:
                r, n = fallback.skull_r(d[None])
                if np.isnan(r[0]):
                    P[i], N[i] = HEAD_C + d * 0.09, d
                else:
                    P[i], N[i] = HEAD_C + d * r[0], n[0]
        return P + N * np.asarray(lift, float).reshape(-1, 1) if np.ndim(lift) else P + N * lift, N


# ---------------------------------------------------------------- locks: tapered ribbons along the hair's flow

def _catmull(C, n):
    """A smooth curve through control points C (k, 3), n points, evenly spread by length."""
    C = np.asarray(C, float)
    if len(C) == 2:
        C = np.array([C[0], (2 * C[0] + C[1]) / 3, (C[0] + 2 * C[1]) / 3, C[1]])
    ext = np.concatenate(([2 * C[0] - C[1]], C, [2 * C[-1] - C[-2]]))
    pts = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for t in np.linspace(0, 1, 12, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(C[-1])
    pts = np.array(pts)
    L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))))
    s = np.linspace(0, L[-1], n)
    return np.stack([np.interp(s, L, pts[:, k]) for k in range(3)], 1)


def lock(points, normals, width, k=0, lift=0.002, bulge=0.3, root=0.15, alpha=0.95, taper=0.45, tip_t=1.0,
         ao=(0.80, 1.0), droop=None):
    """One lock along a path on the hair (points and the surface's normals there, root first): a ribbon of three
    points across (its middle raised by `bulge` of its width: a rounded lock), narrowing to its tip, lying `lift`
    over the surface; its UVs over lock column k (tip_t: how far along the lock's picture the path's end reaches);
    alpha fading in over the first `root` of its length (a root in the open), the strands' own taper at the tip."""
    P = np.asarray(points, float)
    N = _unit(np.asarray(normals, float))
    n = len(P)
    T = np.gradient(P, axis=0)
    T = _unit(T)
    X = _unit(np.cross(N, T))
    L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))))
    t = L / max(L[-1], 1e-9)
    w = np.asarray(width, float) * (1 - taper * t ** 1.5) if np.ndim(width) == 0 else np.asarray(width, float)
    lf = np.full(n, lift) if np.ndim(lift) == 0 else np.asarray(lift, float)
    V, UV, A, O = [], [], [], []
    for i in range(n):
        for s in (-1.0, 0.0, 1.0):
            up = lf[i] + (bulge * w[i] * (1 - s * s)) * (1 - 0.6 * t[i])
            V.append(P[i] + X[i] * (0.5 * w[i] * s) + N[i] * (up - 0.25 * lf[i] * s * s))
            UV.append(lock_uv(k, s, t[i] * tip_t))
            a = alpha * (mhface.above(t[i], 0.0, root) if root > 0 else 1.0) * (1.0 - 0.42 * s * s)
            A.append(a)
            O.append(ao[1] if s == 0 else ao[0])
    F = []
    for i in range(n - 1):
        a0, b0 = 3 * i, 3 * (i + 1)
        for j in range(2):
            F += [(a0 + j, a0 + j + 1, b0 + j + 1), (a0 + j, b0 + j + 1, b0 + j)]
    F = np.array(F)
    # facing out of the head (the side the lock is seen from)
    fn = face_normals(np.array(V), F)
    out = np.array([N[i // 3] for i in F[:, 0]])
    flip = (fn * out).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return Part(np.array(V), F, np.array(UV), np.array(A), np.array(O))


def lock_on(shell, head, ctrl, n, width, lift=0.002, **kw):
    """A lock whose path is given by control points (el, az, side) on the hair's surface."""
    D = _unit(np.array([direction(e, a, s) for e, a, s in ctrl]))
    Dc = _unit(_catmull(D, n * 3))
    P, N = shell.surface(Dc, 0.0, fallback=head)
    L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))))
    s = np.linspace(0, L[-1], n)
    Pn = np.stack([np.interp(s, L, P[:, k]) for k in range(3)], 1)
    Nn = _unit(np.stack([np.interp(s, L, N[:, k]) for k in range(3)], 1))
    return lock(Pn, Nn, width, lift=lift, **kw)


def join(parts):
    """Parts into one (positions, triangles, per-vertex UV, colour)."""
    P, F, UV, C = [], [], [], []
    n0 = 0
    for p in parts:
        if p is None or not len(p.F):
            continue
        P.append(p.P)
        F.append(p.F + n0)
        UV.append(p.UV)
        c = np.zeros((len(p.P), 4))
        c[:, 1] = 1.0
        c[:, 2] = p.O
        c[:, 3] = p.A
        C.append(c)
        n0 += len(p.P)
    return np.concatenate(P), np.concatenate(F), np.concatenate(UV), np.concatenate(C)

# ---------------------------------------------------------------- hair styles of Antwerp, 1873

# Where hats sit (head angles, measured on the built kinds, docs/people.md "Hair"): below these lines hair shows.
# Men's caps and the police kepi: their band's lower edge (the lower of the two); the women's linen cap: its front
# edge from ear to ear, then its back edge round the nape.
CAP_AZ = [0, 32, 71, 95, 122, 155, 180]
CAP_EL = [12.6, 10.0, 4.7, 2.5, -6.5, -9.5, -7.0]
HOOD_AZ = [0, 50, 76, 88, 98, 104, 122, 151, 180]
HOOD_EL = [55, 42, 18, 1, -13, -12, -15.5, -21, -24]


def _sm(a, b, x):
    return mhface.above(x, a, b)


def _pt(D):
    """A direction's point on an average skull (head frame), for features placed in metres."""
    return HEAD_C + D * 0.092


def _slerp(a, b, t):
    a, b = _unit(a), _unit(b)
    om = math.acos(float(np.clip(a @ b, -1, 1)))
    if om < 1e-6:
        return a
    return (math.sin((1 - t) * om) * a + math.sin(t * om) * b) / math.sin(om)


def _ang(d):
    el, az = angles(np.asarray(d)[None])
    return float(el[0]), float(az[0]), (1.0 if d[0] >= 0 else -1.0)


class Scalp:
    """A hair style over the scalp: its coverage, thickness, flow and lumps per direction (Shell), its fuzz layers,
    its locks and its tubes. Subclasses set the numbers."""
    sex = "m"
    recede = 0.0
    over_ears = False
    ear_gap = 0.004
    pole = (0.0, math.sin(math.radians(64)), -math.cos(math.radians(64)))  # the crown's whorl
    ref = (0.0, 0.0, 1.0)
    theta_max = 140.0
    n_lumps = 8
    lump_amp = 0.18
    fur = ((1, 0.0020, 0.60, 0.92), (2, 0.0020, 0.30, 1.0))  # (k, step, alpha, occlusion)
    budget = 900
    lock_budget = 0
    locks_fade = True  # locks fade with the style's coverage (Long lets its tips hang past the line)

    def __init__(self, base="man"):
        self.base = base
        if base == "old_man":
            self.recede = 0.65

    def line(self, az):
        line = mhface.hairline(az, self.sex, self.recede)
        if self.sex == "m":
            line = line - 16.0 * np.exp(-((az - 85.0) / 6.0) ** 2)
        elif self.over_ears:
            line = line - 9.0 * np.exp(-((az - 102.0) / 13.0) ** 2)
        return line

    def ear_clear(self, head, D):
        """1 away from the ears, 0 on and beside them (a man's hair is cut round the ear)."""
        if not hasattr(head, "_ear_dirs"):
            from . import mhbody
            ear = np.asarray(mhbody.topology(head.lod).region).astype(str) == "ear"
            head._ear_dirs = _unit(head.Q[ear] - HEAD_C)
        c = D @ head._ear_dirs.T
        ang = np.degrees(np.arccos(np.clip(c.max(1), -1, 1)))
        return _sm(0.4, 2.2, ang)

    def coverage(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        cov = _sm(line - 1.0, line + 5.0 + (4.0 if self.sex == "m" else 9.0) * _sm(120, 170, az), el)
        if not self.over_ears:
            cov = cov * self.ear_clear(head, D)
        return cov * self.extra_cov(head, D, el, az)

    def extra_cov(self, head, D, el, az):
        return 1.0

    def thickness(self, head, D):
        raise NotImplementedError

    def flow(self, D, raw=False):
        u, v = pole_uv(D, self.pole, self.ref, self.theta_max)
        return (u, v) if raw else np.stack((u, np.clip(v, 0, 1)), 1)

    def lumps(self, u, v, D):
        ph = u * self.n_lumps + 0.35 * np.sin(v * 9.0 + u * 5.0)
        return 1.0 + self.lump_amp * (np.cos(ph * 2 * math.pi) * 0.5 + 0.5 * np.cos(ph * 4.7 + 1.3) * 0.4)

    def fur_mask(self, D):
        return 1.0

    def locks(self, shell, head):
        return []

    def tubes(self, shell, head):
        return []


class Crop(Scalp):
    """A short crop (workmen, boys): a centimetre on top, less over the ears and at the nape."""
    budget = 760

    def thickness(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        th = (0.0040 + 0.0050 * _sm(25, 62, el)) * (0.15 + 0.85 * _sm(line - 1, line + 15, el))
        th *= 1 - 0.30 * (1 - _sm(-42, -15, el)) * _sm(110, 150, az)
        if self.base == "child":
            th *= 0.8
        return th


class Capped(Crop):
    """A crop under a cap or kepi: full below the band, pressed flat under it and gone a little above it."""
    fur = ((1, 0.0014, 0.55, 0.92),)

    def lim(self, az):
        return np.interp(az, CAP_AZ, CAP_EL) - 1.5

    def thickness(self, head, D):
        el, az = angles(D)
        th = Crop.thickness(self, head, D)
        a = _sm(self.lim(az) - 3.0, self.lim(az), el)
        return th * (1 - a) + np.minimum(th, 0.0028) * a

    def extra_cov(self, head, D, el, az):
        return 1.0 - _sm(self.lim(az) + 3.0, self.lim(az) + 12.0, el)

    def fur_mask(self, D):
        el, az = angles(D)
        return 1.0 - _sm(self.lim(az) - 3.0, self.lim(az), el)


class Side(Scalp):
    """A side parting (clerks, gentlemen, townsmen): the top combed over from a parting on the left, oiled, with a
    little rise at the front; the sides and back short."""
    parting_x = 0.024
    budget = 820
    lock_budget = 900
    fur = ((1, 0.0014, 0.50, 0.95),)

    def thickness(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        p = _pt(D)
        x, z = p[:, 0], p[:, 2]
        top = _sm(18, 45, el)
        front = _sm(-0.02, 0.05, z)
        big = 1 - _sm(self.parting_x - 0.004, self.parting_x + 0.004, x)
        th = 0.0045 + top * (big * (0.0080 + 0.0040 * front) + (1 - big) * 0.0035)
        groove = np.exp(-((x - self.parting_x) / 0.0035) ** 2) * _sm(line + 1, line + 6, el) * _sm(-0.11, -0.07, z)
        th *= 1 - 0.7 * groove
        th *= 0.45 + 0.55 * _sm(line, line + 8, el)
        th *= 1 - 0.30 * (1 - _sm(-42, -15, el)) * _sm(110, 150, az)
        return th

    def parting(self, s):
        """The parting's point s (0 at the front hairline, 1 at the crown) as a direction."""
        a = math.radians(30 + 72 * s)
        xr = self.parting_x / 0.092
        c = math.sqrt(1 - xr * xr)
        return _unit(np.array((xr, c * math.sin(a), c * math.cos(a))) - HEAD_C / 0.092 * 0.0)

    def locks(self, shell, head):
        out = []
        rng = np.random.default_rng(17)
        # the big side: from the parting across the top and down toward the right ear, the front ones swept back
        n = 15
        for i in range(n):
            s = (i + 0.5) / n
            root = self.parting(s)
            tgt = direction(2 + 10 * s, 92 + 40 * s, -1.0)
            mid = _slerp(root, tgt, 0.45) + np.array((0, 0.08 - 0.05 * s, -0.10 + 0.05 * s))
            end = _slerp(root, tgt, 0.78 - 0.30 * s)
            ctrl = [_ang(root), _ang(_unit(mid)), _ang(end)]
            out.append(lock_on(shell, head, ctrl, 9, 0.028 + 0.004 * rng.uniform(), lift=0.0006 + 0.0006 * (i % 3),
                               k=i % 2, bulge=0.14, root=0.10, tip_t=0.95, taper=0.35))
        # the small side: down from the parting toward the left ear
        for i in range(5):
            s = (i + 0.5) / 5
            root = self.parting(s * 0.85)
            tgt = direction(-2 + 8 * s, 85 + 45 * s, 1.0)
            end = _slerp(root, tgt, 0.70)
            ctrl = [_ang(root), _ang(_slerp(root, tgt, 0.35)), _ang(end)]
            out.append(lock_on(shell, head, ctrl, 7, 0.017, lift=0.0011, k=(i + 1) % 2, bulge=0.2, root=0.10,
                               tip_t=0.9))
        return out


class Long(Scalp):
    """A workman's longer hair: over the ear tops and down to the collar, in locks from the crown, a few falling
    forward."""
    over_ears = True
    locks_fade = False
    budget = 820
    lock_budget = 1100
    fur = ((1, 0.0016, 0.55, 0.92),)

    def line(self, az):
        line = mhface.hairline(az, "m", self.recede)
        return line - 9.0 * np.exp(-((az - 100) / 16.0) ** 2) - 14.0 * _sm(110, 160, az)

    def thickness(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        th = 0.0075 + 0.0045 * _sm(20, 60, el) + 0.003 * _sm(70, 110, az) * (1 - _sm(10, 40, el))
        return th * (0.45 + 0.55 * _sm(line, line + 8, el))

    def locks(self, shell, head):
        out = []
        rng = np.random.default_rng(23)
        pole = _unit(np.array(self.pole))
        n = 22
        for i in range(n):
            # roots round the whorl, every lock running away from it to the hairline and a little past
            a = (i + 0.5) / n * 2 * math.pi
            side = 1.0 if math.sin(a) >= 0 else -1.0
            az = abs(math.degrees(a)) if a <= math.pi else 360 - math.degrees(a)
            az = min(az, 180.0)
            tgt_el = float(self.line(np.array([az]))[0]) - 6.0
            tgt = direction(tgt_el, az, side)
            root = _slerp(pole, tgt, 0.18 + 0.08 * rng.uniform())
            end = _slerp(pole, tgt, 1.04 + 0.05 * rng.uniform())
            ctrl = [_ang(root), _ang(_slerp(root, end, 0.5)), _ang(end)]
            out.append(lock_on(shell, head, ctrl, 9, 0.024 + 0.006 * rng.uniform(), lift=0.0015 + 0.001 * (i % 2),
                               k=i % 2, bulge=0.28, root=0.12, tip_t=1.0, taper=0.5))
        # forelocks: from the top falling onto the forehead
        for i, (az, sd) in enumerate(((8, 1), (20, -1), (30, 1))):
            root = direction(62, az, sd)
            end = direction(float(self.line(np.array([az]))[0]) - 9, az + 6, sd)
            ctrl = [_ang(root), _ang(_slerp(root, end, 0.5)), _ang(end)]
            out.append(lock_on(shell, head, ctrl, 8, 0.016, lift=0.0028, k=i % 2, bulge=0.3, root=0.15))
        return out


class Bald(Scalp):
    """A bald crown with a fringe round the sides and back, thinning up into the crown."""
    budget = 520
    n_lumps = 10
    fur = ((1, 0.0014, 0.55, 0.92), (2, 0.0014, 0.28, 1.0))

    def __init__(self, base="man"):
        Scalp.__init__(self, base)
        self.recede = 1.0

    def extra_cov(self, head, D, el, az):
        bl = mhface.bald_line(az)
        return 1.0 - _sm(bl - 4.0, bl + 6.0, el)

    def thickness(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        bl = mhface.bald_line(az)
        th = (0.0040 + 0.0016 * _sm(120, 170, az)) * (0.5 + 0.5 * _sm(line, line + 7, el))
        return th * (0.5 + 0.5 * (1 - _sm(bl - 6, bl + 2, el)))


class Women(Scalp):
    """A woman's hair of 1873: parted in the middle, smoothed flat over the top, brought down over the temples and
    the tops of the ears in two smooth bands and drawn back to the knot; the hair of the nape drawn up to it."""
    sex = "f"
    over_ears = True
    ear_gap = 0.0035
    bun = (4.0, 180.0)  # where the knot sits (elevation, azimuth)
    ref = (0.0, 1.0, 0.0)
    theta_max = 175.0
    n_lumps = 10
    lump_amp = 0.10
    fur = ((1, 0.0012, 0.38, 0.95),)
    budget = 860
    lock_budget = 1300
    k_thin = 1.0

    def __init__(self, base="woman"):
        Scalp.__init__(self, base)
        self.pole = tuple(direction(self.bun[0], self.bun[1], 1.0))
        if base == "old_woman":
            self.k_thin = 0.72
        if base == "child":
            self.k_thin = 0.8

    def extra_cov(self, head, D, el, az):
        p = _pt(D)
        line = self.line(az)
        part = np.exp(-(p[:, 0] / 0.0016) ** 2) * _sm(line + 1.0, line + 4.0, el) * _sm(-0.075, -0.045, p[:, 2])
        return 1.0 - 0.95 * part

    def thickness(self, head, D):
        el, az = angles(D)
        line = self.line(az)
        band = np.exp(-((az - 80) / 30.0) ** 2) * (1 - _sm(18, 38, el)) * _sm(-14, -2, el)
        th = 0.0034 + 0.0085 * band * self.k_thin + 0.0020 * _sm(120, 165, az) * _sm(-30, -5, el)
        th *= 1 - 0.45 * (1 - _sm(-48, -25, el)) * _sm(115, 150, az)  # the nape's hair drawn up tight
        p = _pt(D)
        th *= 1 - 0.6 * np.exp(-(p[:, 0] / 0.004) ** 2) * _sm(-0.075, -0.045, p[:, 2]) * _sm(line + 1, line + 5, el)
        return th * self.k_thin * (0.5 + 0.5 * _sm(line, line + 6, el))

    def parting(self, s, side):
        a = math.radians(28 + 58 * s)
        return _unit(np.array((side * 0.03, math.sin(a), math.cos(a))))

    def drawn_back(self, shell, head, n=7, end_el=None, limit=None, k0=0):
        """The locks from the parting, down over the temple and the ear's top and back to the knot."""
        out = []
        be, ba = self.bun
        for side in (1.0, -1.0):
            for i in range(n):
                s = i / (n - 1)
                root = self.parting(s * 0.92, side)
                r_el, r_az, _ = _ang(root)
                low = 10 - 20 * (1 - s) ** 1.3
                ctrl = [(r_el, r_az, side), (r_el - 12 - 10 * (1 - s), 28 + 40 * (1 - s) + 25 * s, side),
                        (low, 95 + 20 * s, side), (be + 2 - 6 * (1 - s), ba - 22 + 6 * s, side),
                        (be + 1, ba - 12, side)]
                ctrl = [(max(e, float(self.line(np.array([a]))[0]) + 7.0), a, sd) for e, a, sd in ctrl]
                if limit is not None:
                    ctrl = limit(ctrl)
                out.append(lock_on(shell, head, ctrl, 12, 0.026 + 0.004 * (i % 2), lift=0.0010 + 0.0008 * (i % 3),
                                   k=(i + k0) % 2, bulge=0.12, root=0.06, tip_t=0.95, taper=0.30))
        return out

    def nape_up(self, shell, head, n=4, top=None):
        out = []
        be, ba = self.bun
        for side in (1.0, -1.0):
            for i in range(n):
                az = 180 - 12 - 38 * i / max(n - 1, 1)
                lo = float(self.line(np.array([az]))[0])
                ctrl = [(lo - 2, az, side), (lo + 25, az + 4, side), (be - 4 if top is None else top, ba - 8, side)]
                out.append(lock_on(shell, head, ctrl, 8, 0.022, lift=0.0006, k=i % 2, bulge=0.08, root=0.35,
                                   tip_t=0.9, taper=0.3))
        return out

    def locks(self, shell, head):
        return self.drawn_back(shell, head)

    def knot(self, shell, head, R=0.028, r=0.0095, turns=1.7, lift=0.0, flat=0.004):
        """The knot: a coil of hair at the back of the head, and a fuzz round it."""
        be, ba = self.bun
        d = direction(be, ba, 1.0)
        o, n = shell.surface(d[None], lift)
        o, n = o[0], _unit(n[0])
        e1 = _unit(np.cross(n, (1.0, 0.0, 0.0)))
        e2 = np.cross(n, e1)
        steps = 30 if head.lod == 0 else 10
        path, rad = [], []
        for i in range(steps):
            t = i / (steps - 1)
            ang = 2 * math.pi * turns * t
            rr = R * (1 - 0.62 * t)
            path.append(o + rr * (math.cos(ang) * e1 + math.sin(ang) * e2) + n * (r * (0.45 + 0.45 * t) - flat * t))
            rad.append(r * (1 - 0.30 * t))
        return coil(path, rad, head.lod)

    def tubes(self, shell, head):
        return self.knot(shell, head)


class Bun(Women):
    pass


class Undercap(Women):
    """The hair under the women's linen cap: the front shows (parting and bands over the temples), behind the cap's
    edge it lies flat, with a small flat knot."""
    budget = 760
    lock_budget = 900
    bun = (2.0, 180.0)

    def lim(self, az):
        return np.interp(az, HOOD_AZ, HOOD_EL) - 2.0

    def thickness(self, head, D):
        el, az = angles(D)
        th = Women.thickness(self, head, D)
        a = _sm(self.lim(az) - 3.0, self.lim(az) + 1.0, el)
        return th * (1 - a) + np.minimum(th, 0.0042) * a

    def fur_mask(self, D):
        el, az = angles(D)
        return 1.0 - _sm(self.lim(az) - 3.0, self.lim(az), el)

    def locks(self, shell, head):
        def limit(ctrl):
            return ctrl
        out = self.drawn_back(shell, head, n=6)
        # under the cap the locks lie flat: their lift goes with the shell
        return out

    def tubes(self, shell, head):
        return self.knot(shell, head, R=0.022, r=0.0060, turns=1.5, lift=0.0015, flat=0.004)


class Plaits(Women):
    """Two plaits pinned round the back of the head from behind the ears (women), or hanging behind the ears down
    the back (girls)."""
    bun = (6.0, 180.0)

    def tubes(self, shell, head):
        out = []
        if self.base == "child":
            for s in (1, -1):
                top = shell.surface(direction(-6, 128, s)[None], 0.006)[0][0]
                pts = [top, top + np.array((s * 0.004, -0.05, -0.012)), top + np.array((s * 0.006, -0.10, -0.022)),
                       top + np.array((s * 0.004, -0.15, -0.030))]
                path = _catmull(np.array(pts), 22 if head.lod == 0 else 8)
                rad = list(0.0085 * (1 - 0.35 * np.linspace(0, 1, len(path)) ** 2))
                out += plait(path, rad, head.lod)
            return out
        for s in (1, -1):
            pts = [shell.surface(direction(el, az, s)[None], 0.0075)[0][0] for el, az in
                   ((24, 112), (12, 125), (2, 142), (-3, 160), (4, 176), (16, 172), (26, 152))]
            path = _catmull(np.array(pts), 24 if head.lod == 0 else 9)
            out += plait(path, [0.0078] * len(path), head.lod)
        return out

    def locks(self, shell, head):
        if self.base == "child":
            return self.drawn_back(shell, head, n=5)
        return self.drawn_back(shell, head)


class Coronet(Women):
    """Plaits wound over the crown like a coronet; the hair drawn up to them from every side."""
    bun = (40.0, 180.0)

    def tubes(self, shell, head):
        n_ = 36 if head.lod == 0 else 12
        pts = []
        for a in np.linspace(0, 360, n_ + 1)[:-1]:
            az = abs(((a + 180) % 360) - 180)
            side = 1.0 if ((a + 180) % 360) - 180 >= 0 else -1.0
            pts.append(shell.surface(direction(48 + 6 * math.cos(math.radians(a)), az, side)[None], 0.0080)[0][0])
        pts.append(pts[0])
        return plait(np.array(pts), [0.0080] * len(pts), head.lod, closed=True)

    def locks(self, shell, head):
        return self.drawn_back(shell, head, n=6)


SCALP = {"crop": Crop, "capped": Capped, "side": Side, "long": Long, "bald": Bald, "bun": Bun, "plaits": Plaits,
         "coronet": Coronet, "undercap": Undercap}


# ---------------------------------------------------------------- tubes: knots, plaits

def _tube(path, rad, segs, closed=False):
    """A tube along a path: rings of segs points (u along the path's length, s round it), closed at the ends
    unless the path is closed."""
    path = np.asarray(path, float)
    n = len(path)
    T = _unit(np.gradient(path, axis=0))
    ref = np.array((0.0, 1.0, 0.0)) if abs(T[0][1]) < 0.9 else np.array((1.0, 0.0, 0.0))
    nrm = _unit(np.cross(T[0], ref))
    L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))))
    V, S, U = [], [], []
    for i in range(n):
        if i > 0:
            nrm = _unit(nrm - T[i] * (nrm @ T[i]))
        bi = np.cross(T[i], nrm)
        for k in range(segs):
            a = 2 * math.pi * k / segs
            V.append(path[i] + (nrm * math.cos(a) + bi * math.sin(a)) * rad[i])
            S.append(k / segs)
            U.append(L[i])
    F = []
    rings = n - 1
    for i in range(rings):
        for k in range(segs):
            a, b = i * segs + k, i * segs + (k + 1) % segs
            c, d = a + segs, b + segs
            F += [(a, c, d), (a, d, b)]
    if not closed:
        for end, sgn in ((0, -1), (n - 1, 1)):
            cv = len(V)
            V.append(path[end] + T[end] * rad[end] * 0.6 * sgn)
            S.append(0.0)
            U.append(L[end])
            for k in range(segs):
                a, b = end * segs + k, end * segs + (k + 1) % segs
                F.append((cv, b, a) if end == 0 else (cv, a, b))
    V, F = np.array(V), np.array(F)
    # outward
    cen = np.concatenate((np.repeat(path, segs, axis=0), V[n * segs:]))
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    out = V[F].mean(1) - cen[F].mean(1)
    flip = (fn * out).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F, np.array(S), np.array(U), cen


def coil(path, rad, lod):
    """A knot of coiled hair: a tube with strands along it (shell strands, mirrored round it) and a sparse fuzz."""
    segs = 9 if lod == 0 else 5
    V, F, S, U, cen = _tube(path, rad, segs)
    rep = 0.05
    v = np.abs(((U / rep) % 2.0) - 1.0)
    u = np.abs((S * 2) % 2 - 1) * 0.5 + 0.25
    parts = [Part(V, F, rect_uv(HAIR_RECT, u * 0.5 + 0.1, v), np.full(len(V), 1.0), np.full(len(V), 0.85))]
    if lod == 0:
        Vf = cen + (V - cen) * 1.16
        parts.append(Part(Vf, F, rect_uv(HAIR_RECT, u * 0.5 + 0.1, v), np.full(len(V), 0.35), np.full(len(V), 1.0)))
    return parts


def plait(path, rad, lod, closed=False):
    """A plait: a tube with the weave's lobes (three strands crossing) in its shape and picture, and a fuzz."""
    segs = 8 if lod == 0 else 5
    path = np.asarray(path, float)
    L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))))
    rad = np.asarray(rad, float)
    V, F, S, U, cen = _tube(path, rad, segs, closed=closed)
    if lod == 0:  # each lobe bulges to one side, the next to the other
        ring = np.arange(len(V)) // segs
        ring = np.minimum(ring, len(path) - 1)
        ph = L[ring] / 0.011 * math.pi
        side = np.cos(S * 2 * math.pi) * np.sign(np.sin(ph) + 1e-9)
        lobe = np.abs(np.sin(ph))
        V = cen + (V - cen) * (1.0 + 0.16 * lobe * side + 0.06 * lobe)[:, None]
    rep = 0.034
    v = np.abs(((U / rep) % 2.0) - 1.0)
    u = np.abs((S * 2) % 2 - 1)
    parts = [Part(V, F, rect_uv(BRAID_RECT, u, v), np.full(len(V), 1.0), np.full(len(V), 0.85))]
    if lod == 0:
        Vf = cen + (V - cen) * 1.15
        parts.append(Part(Vf, F, rect_uv(BRAID_RECT, u, v), np.full(len(V), 0.40), np.full(len(V), 1.0)))
    return parts

# ---------------------------------------------------------------- beards: shells on the face's skin, locks below

def beard_fields(Q, G, style):
    """Coverage 0..1 (the faded edge) and thickness (metres) of a beard at head points Q."""
    x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
    zone = mhface.beard_zone(Q, G, soft=3.0)
    chin, mouth = G["chin"], G["mouth"]
    ax = np.abs(x)
    under = 1 - _sm(chin[1] - 0.005, chin[1] + 0.03, y)  # the chin and under it
    if style == "full":
        th = 0.0045 + 0.0035 * (1 - _sm(mouth[1] - 0.02, mouth[1] + 0.02, y)) +             0.010 * under * (1 - _sm(0.02, 0.055, ax))
    elif style == "short":
        th = 0.0040 + 0.0025 * under
    elif style == "chops":  # whiskers broad on the cheeks to the mouth's corners, the chin shaved round (a moustache
        # joins them)
        shaved = ((x / 0.031) ** 2 + ((y - (mouth[1] - 0.030)) / 0.040) ** 2)
        zone = zone * _sm(1.0, 1.7, shaved) * _sm(chin[1] - 0.012, chin[1] + 0.010, y)
        th = 0.0050 + 0.0045 * _sm(0.035, 0.055, ax) * (1 - _sm(mouth[1] - 0.01, mouth[1] + 0.025, y))
    elif style == "sideburns":
        ez = G["earL"][2]
        zone = _sm(0.050, 0.057, ax) * _sm(ez + 0.005, ez + 0.015, z) * (1 - _sm(ez + 0.040, ez + 0.052, z)) * \
            _sm(mouth[1] - 0.004, mouth[1] + 0.010, y) * (1 - _sm(G["eyeL"][1] + 0.035, G["eyeL"][1] + 0.050, y))
        th = 0.0022 + 0.0012 * (1 - _sm(mouth[1] + 0.01, mouth[1] + 0.03, y))
    elif style == "chin":  # a chin curtain: along the jaw and under the chin, the lips and cheeks bare
        jaw = np.maximum(1 - _sm(mouth[1] - 0.022, mouth[1] - 0.010, y), _sm(0.042, 0.052, ax))
        zone = zone * jaw
        th = 0.007 + 0.008 * under
    else:
        raise KeyError(style)
    zone = zone * _sm(G["earL"][2] + 0.008, G["earL"][2] + 0.028, z)  # up to the ear's front, never behind it
    lips = (x / 0.027) ** 2 + ((y - mouth[1]) / 0.011) ** 2
    zone = zone * _sm(1.25, 1.9, lips)  # the lips stay bare, with a margin
    # the upper lip is the moustache's (its own piece): a beard never grows over it
    nose = G["nose"]
    upper = (1 - _sm(0.024, 0.034, ax)) * _sm(mouth[1] + 0.001, mouth[1] + 0.007, y) *         (1 - _sm(nose[1] - 0.004, nose[1] + 0.004, y))
    zone = zone * (1 - upper)
    th = th * (0.35 + 0.65 * _sm(1.4, 3.2, lips))  # and the beard lies thin next to them
    cov = np.clip(zone * 1.25 - 0.1, 0, 1)
    return cov, th


def beard_uv(head, P):
    """u round the face (mirrored), v down the strands: down the face and on back under the jaw, at the same density
    both ways (an elevation map squeezed the strands under the chin into streaks)."""
    Q = P - head.eyes if P is not None else None
    el, az = mhface.head_angles(Q)
    chin = head.G["chin"]
    under = np.clip((chin[1] + 0.015 - Q[:, 1]) / 0.02, 0, 1)
    s = Q[:, 1] - under * np.maximum(0.0, chin[2] - Q[:, 2])
    u = np.abs(((np.abs(az) / 180.0 * 2.2) % 2.0) - 1.0)
    v = np.clip((s - (chin[1] - 0.07)) / 0.18, 0, 1)
    return np.stack((u, v), 1)


class SkinShell:
    """A shell on the skin (beards): MakeHuman's full head (the near copy) cut along coverage 0.02, every point laid
    out from the copy's own skin by its thickness (none at the faded edge, SINK under the skin there), with clumps
    along the strands; reduced to the budget (the fade band keeps its points)."""

    def __init__(self, head, fields, budget, name, lumps=(16, 0.28), uvf=None):
        from mathutils import Vector
        fine = head.fine_tris is not None
        T = head.fine_tris if fine else head.head_tris
        P0 = head.fP if fine else head.P
        N0 = head.fN if fine else head.N
        cov, th = fields(P0 - head.eyes)
        cov = np.clip(cov, 0, 1)
        P, N, cc, F, edge = clip(P0, N0, cov, T, 0.02)
        F = np.array(F, np.int64)
        if not len(F):
            self.P = np.zeros((0, 3))
            self.F = np.zeros((0, 3), np.int64)
            return
        cv, tv = fields(P - head.eyes)
        cv = np.clip(cv, 0, 1)
        uv = (uvf or beard_uv)(head, P)
        nl, amp = lumps
        ph = uv[:, 0] * nl * 5.0 + 0.4 * np.sin(uv[:, 1] * 11.0 + uv[:, 0] * 30.0)
        tv = tv * (1.0 + amp * (np.cos(ph * 2 * math.pi) * 0.6 + 0.4 * np.cos(ph * 5.1 + 1.0)))
        copy_bvh = _bvh(head.P, head.head_tris)
        g = np.clip(cv, 0, 1) ** 1.8
        out = np.zeros_like(P)
        for i in range(len(P)):
            loc, nrm, fi, d = copy_bvh.find_nearest(Vector(tuple(P[i])))
            tri = head.head_tris[fi]
            w = mh.barycentric(np.array(loc), head.P[tri[0]], head.P[tri[1]], head.P[tri[2]])
            n = _unit(w @ head.N[tri])
            above = float((P[i] - np.array(loc)) @ n)
            out[i] = np.array(loc) + n * (max(above, 0.0) + tv[i] * g[i] - SINK * (1 - mhface.above(cv[i], 0, 0.5)) +
                                          0.0003)
        inner = (cv > 0.985) & ~edge
        Pd, Fd = decimate(out, F, budget, inner, name)
        dense = _bvh(out, F)
        cd, ud = np.zeros(len(Pd)), np.zeros((len(Pd), 2))
        for i, p in enumerate(Pd):
            loc, nrm, fi, d = dense.find_nearest(Vector(tuple(p)))
            tri = F[fi]
            w = mh.barycentric(np.array(loc), out[tri[0]], out[tri[1]], out[tri[2]])
            w = np.clip(w, 0, 1)
            w = w / max(w.sum(), 1e-9)
            Pd[i] = np.array(loc)
            cd[i] = w @ cv[tri]
            ud[i] = w @ uv[tri]
        self.P, self.F, self.cov, self.uv = Pd, np.asarray(Fd, np.int64), cd, ud
        self.N = mhface.vertex_normals(self.P, self.F)
        self.dense = dense
        self.dense_P, self.dense_F = out, F
        self.fmask = 1.0
        print("[people2]   shell %s: %d triangles from %d (budget %d)" % (name, len(self.F), len(F), budget))

    def layer(self, k, step, alpha, ao, rect=None):
        g = np.clip(self.cov, 0, 1) ** 1.8
        P = self.P + self.N * (k * step * g)[:, None]
        return Part(P, self.F, rect_uv(rect or BEARD_RECT, self.uv[:, 0], self.uv[:, 1]), self.cov * alpha,
                    np.full(len(P), ao) * (0.75 + 0.25 * g))

    def trace_down(self, start, length, n, sag=(0.0, -1.0, 0.25), lift=0.0, air=0.016):
        """A path from `start` down the beard's surface (the way the strands fall), on past its edge into the air,
        falling: points and normals, n of them."""
        from mathutils import Vector
        pts, nrm = [], []
        p = np.array(start, float)
        loc, nn, fi, d = self.dense.find_nearest(Vector(tuple(p)))
        p, nn = np.array(loc), np.array(nn)
        step = length / (n - 1)
        down = _unit(np.array(sag))
        on = True
        last_t = down
        flown = 0.0
        for i in range(n):
            pts.append(p + nn * lift)
            nrm.append(nn)
            if not on and flown >= air:
                break
            if on:
                t = _unit(down - nn * (down @ nn))
                q = p + t * step
                loc, n2, fi, d = self.dense.find_nearest(Vector(tuple(q)))
                if d > step * 0.6:  # off the beard's edge: on into the air
                    on = False
                    p = p + t * step
                    last_t = t
                else:
                    p, nn = np.array(loc), np.array(n2)
                    last_t = t
            else:
                last_t = _unit(last_t + np.array((0.0, -0.35, 0.05)))
                p = p + last_t * step
                flown += step
        pts, nrm = np.array(pts), np.array(nrm)
        if len(pts) < n:  # stopped in the air: the same number of points over the shorter path
            L = np.concatenate(([0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))))
            s_ = np.linspace(0, L[-1], n)
            pts = np.stack([np.interp(s_, L, pts[:, k]) for k in range(3)], 1)
            nrm = _unit(np.stack([np.interp(s_, L, nrm[:, k]) for k in range(3)], 1))
        return pts, nrm


def beard_locks(sh, head, style):
    """Locks over a beard: clumps down the cheeks and the chin, their tips hanging past the beard's lower edge."""
    if not len(sh.F) or head.lod != 0:
        return []
    G = head.G
    mouth = G["mouth"]
    out = []
    rng = np.random.default_rng(31)
    rows = {"full": [(-0.010, 13, 0.065), (-0.026, 9, 0.045)], "chin": [(-0.020, 11, 0.050)],
            "chops": [(-0.004, 6, 0.040)], "short": [], "sideburns": []}.get(style, [])
    for dy, n, length in rows:
        for i in range(n):
            s = (i + 0.5) / n * 2 - 1
            if style == "chops":
                x = (0.040 + 0.012 * abs(s)) * (1 if s >= 0 else -1)
                y0 = mouth[1] + 0.020 + dy
                z0 = G["earL"][2] + 0.035
            else:
                x = s * (0.040 if dy < -0.02 else 0.052)
                y0 = mouth[1] + dy + 0.022 * abs(s) ** 2
                z0 = 0.10
            from mathutils import Vector
            start = HEAD_C * 0 + np.array((x, y0, z0)) + head.eyes
            loc, nn, fi, d = sh.dense.find_nearest(Vector(tuple(start)))
            P, N = sh.trace_down(np.array(loc), length * (0.85 + 0.3 * rng.uniform()), 7,
                                 sag=(-0.15 * s, -1.0, 0.35), lift=0.0010 + 0.0012 * (i % 2))
            out.append(lock(P, N, 0.013 + 0.004 * rng.uniform(), k=2, lift=0.0008, bulge=0.30, root=0.25,
                            alpha=0.92, taper=0.55, ao=(0.78, 1.0)))
    return out


# ---------------------------------------------------------------- moustaches and the imperial: locks from the lip

def mous_fields(Q, G, style):
    """Coverage and thickness of a moustache's mass on the upper lip (its locks lie over it)."""
    x, y = Q[..., 0], Q[..., 1]
    mouth, nose = G["mouth"], G["nose"]
    base_y = nose[1] - 0.012
    ax = np.abs(x)
    half = {"walrus": 0.031, "chevron": 0.027, "handlebar": 0.025, "imperial": 0.0}[style]
    zone = (1 - _sm(half - 0.006, half + 0.002, ax)) * _sm(mouth[1] + 0.0015, mouth[1] + 0.005, y) *         (1 - _sm(base_y - 0.002, base_y + 0.004, y))
    # under the nostrils the lip rises into the nose: the zone stays below its wings
    zone = zone * (1 - (1 - _sm(0.012, 0.018, ax)) * _sm(base_y - 0.004, base_y + 0.001, y) * 0.0)
    th = {"walrus": 0.0055, "chevron": 0.0045, "handlebar": 0.0025, "imperial": 0.002}[style]
    th = th * (0.6 + 0.4 * (1 - _sm(0.0, half, ax)))
    return np.clip(zone * 1.3 - 0.1, 0, 1), th + 0 * x


def _lip_paths(head, style):
    """A moustache's locks (head frame, root first): (points, width, lift, lock column, taper, how far along the
    lock's picture its end reaches)."""
    G = head.G
    mouth, nose = G["mouth"], G["nose"]
    base_y = nose[1] - 0.013  # the nose's base
    top = (mouth[1] + base_y) / 2 + 0.002  # the upper lip
    paths = []
    if style == "walrus":  # heavy, drooping over the lip and past the mouth's corners
        for x0, layer in ((0.002, 0.0), (0.007, 0.0), (0.012, 0.0), (0.017, 0.0), (0.022, 0.0), (0.026, 0.0),
                          (0.005, 0.6), (0.012, 0.6), (0.019, 0.6), (0.024, 0.6)):
            f = x0 / 0.026
            pts = [(x0, base_y + 0.001, 0), (x0 + 0.004 + 0.004 * f, top - 0.003, 0),
                   (x0 + 0.007 + 0.010 * f, mouth[1] - 0.004 - 0.012 * f ** 2, 0)]
            paths.append((pts, 0.012, 0.0015 + 0.0025 * layer, 2, 0.40, 0.95))
    elif style == "chevron":  # thick and wide, trimmed square at the lip's edge
        for x0, layer in ((0.002, 0.0), (0.007, 0.0), (0.012, 0.0), (0.017, 0.0), (0.022, 0.0), (0.005, 0.5),
                          (0.014, 0.5), (0.021, 0.5)):
            pts = [(x0, base_y + 0.001, 0), (x0 + 0.002, top - 0.001, 0), (x0 + 0.003, mouth[1] + 0.0015, 0)]
            paths.append((pts, 0.011, 0.0015 + 0.0015 * layer, 2, 0.08, 0.55))
    elif style == "handlebar":  # waxed: out along the lip into points that turn up
        for x0, ly in ((0.002, 0.0), (0.007, 0.0), (0.012, 0.0), (0.017, 0.0), (0.005, 0.5), (0.012, 0.5)):
            pts = [(x0, base_y + 0.001, 0), (x0 + 0.010, top - 0.003, 0), (0.028, top - 0.002, 0),
                   (0.040, top + 0.003, 0), (0.047, top + 0.012, 0)]
            paths.append((pts, 0.012 - 0.002 * ly, 0.0013 + 0.0016 * ly, 3, 0.85, 1.0))
    elif style == "imperial":  # a tuft under the lower lip, drawn to a point
        for x0 in (-0.0035, 0.0, 0.0035):
            pts = [(x0, mouth[1] - 0.010, 0), (x0 * 0.6, mouth[1] - 0.021, 0), (0.0, mouth[1] - 0.033, 0)]
            paths.append((pts, 0.0085, 0.0012, 3, 0.75, 1.0))
    return paths


def lip_locks(head, style):
    out = []
    n = 8 if head.lod == 0 else 4
    specs = _lip_paths(head, style)
    if head.lod != 0:
        specs = specs[::2]
    for side in ((1.0, -1.0) if style != "imperial" else (1.0,)):
        for pts, w, lift, k, taper, tip_t in specs:
            pts = np.array(pts, float)
            pts[:, 0] *= side
            dense = _catmull(pts, n)
            # on the face where the skin is (brought straight back onto it); the free ends keep the lift
            P, N = head.front_n(dense)
            out.append(lock(P, N, w, k=k, lift=lift, bulge=0.38, root=0.22, alpha=0.95, taper=taper, tip_t=tip_t,
                            ao=(0.70, 1.0)))
    return out


def strand_uv(head, P):
    """Sideburns: strands down the side of the head (u round the head, v by height), in the scalp's swatch."""
    el, az = mhface.head_angles(P - head.eyes)
    return np.stack((np.clip(np.abs(az) / 180.0, 0, 1), np.clip((el + 80.0) / 170.0, 0, 1)), 1)


# ---------------------------------------------------------------- one piece

FUR_BEARD = ((1, 0.0024, 0.58, 0.9), (2, 0.0024, 0.30, 1.0))


def piece(head, kind, style, lod, sex):
    """A piece's geometry in the body's rest space: (positions, triangles, UVs per vertex, colour per vertex: green
    the face flag, blue its occlusion, alpha its fade) and a count of its parts' triangles."""
    base = head.body.base
    in_head, in_body = [], []
    if kind == "hair":
        st = SCALP[style](base)
        sh = Shell(head, st, st.budget if lod == 0 else max(st.budget // 4, 180), style)
        sh.fmask = np.asarray(st.fur_mask(sh.D)) * np.ones(len(sh.D))
        in_head.append(sh.layer(0, 0.0, 1.0, 0.62))
        if lod == 0:
            for k, step, a, ao in st.fur:
                lp = sh.layer(k, step, a, ao)
                lp.A = lp.A * sh.fmask
                in_head.append(lp)
            for lp in st.locks(sh, head):
                if st.locks_fade:  # a lock fades where the style's own hair fades
                    lp.A = lp.A * np.clip(st.coverage(head, _unit(lp.P - HEAD_C)) * 1.4, 0, 1)
                in_head.append(lp)
        in_head += st.tubes(sh, head)
    elif kind == "beard":
        if style == "imperial":
            in_head += lip_locks(head, "imperial")
        else:
            budget = {"full": 900, "short": 640, "chops": 620, "sideburns": 320, "chin": 640}[style]
            sb = style == "sideburns"
            sh = SkinShell(head, lambda Q: beard_fields(Q, head.G, style), budget if lod == 0 else budget // 4, style,
                           uvf=strand_uv if sb else None)
            if len(sh.F):
                rect = HAIR_RECT if sb else BEARD_RECT
                in_body.append(sh.layer(0, 0.0, 1.0, 0.60, rect))
                if lod == 0:
                    for k, step, a, ao in (FUR_BEARD if not sb else FUR_BEARD[:1]):
                        in_body.append(sh.layer(k, step * (0.6 if style in ("short", "sideburns") else 1.0), a, ao,
                                                rect))
                    in_body += beard_locks(sh, head, style)
    else:
        if style != "imperial":
            sh = SkinShell(head, lambda Q: mous_fields(Q, head.G, style), 220 if lod == 0 else 60, "mous_" + style,
                           lumps=(6, 0.15))
            if len(sh.F):
                in_body.append(sh.layer(0, 0.0, 1.0, 0.55))
                if lod == 0:
                    in_body.append(sh.layer(1, 0.0016, 0.5, 0.85))
        in_head += lip_locks(head, style)
    for p in in_head:
        p.P = p.P + head.eyes
    parts = [p for p in in_head + in_body if p is not None and len(p.F)]
    co, F, UV, C = join(parts)
    return co, F, UV, C


def hang_weights(co, W, body):
    """Weights of a piece's points: the skin's under them, but what hangs below the jaw (a girl's plaits) goes over
    to the neck and then the chest, so it follows the body, not only the turning head."""
    chin = body.chin_y(body.Pf)
    y = np.asarray(co)[:, 1]
    k = np.clip((chin - 0.01 - y) / 0.10, 0, 1)
    if not (k > 0).any():
        return W
    ix = {n: i for i, n in enumerate(rig.NAMES)}
    W = np.array(W, np.float64)
    to = np.zeros_like(W)
    to[:, ix["neck"]] = 1 - np.clip((k - 0.4) / 0.6, 0, 1)
    to[:, ix["upperChest"]] = np.clip((k - 0.4) / 0.6, 0, 1)
    a = np.clip(k * 1.5, 0, 1)[:, None]
    return W * (1 - a) + to * a

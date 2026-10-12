"""The boat builder's common parts (tools/blender/build_boats.py builds every boat from these).

The mesh builder (build_props' Mesh with the rigging as lines, the lamps and the stoves as extras), the
painters of the boat materials and the materials themselves, the hull loft (Hull), the water cap
(cap_object), and the small parts every family uses: spars, rigging, sails, name boards, houses,
barrels, sacks, anchors, lanterns, fenders, the ship's boat on its skids. The boat contract that every
builder keeps is docs/boats.md.

Everything here is our own work: the shapes are built from code, the textures painted by the functions
below. Material constants (WOOD, TAR, ...) are indices into MATS, the material list of every boat mesh.
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # tools/blender
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import build_props as bp  # noqa: E402  (mesh helpers, painters, the prop materials)
import lantern_kit  # noqa: E402  (the town's lamps and lanterns, one design)
from build_props import col, move, rot_z, speckle, vnoise  # noqa: E402,F401

ROOT = bp.ROOT


class Mesh(bp.Mesh):
    """build_props' mesh builder, plus the rigging kept as line segments: the game draws them
    as 1-pixel lines (thin tubes break up into dots at 480x270)."""

    def __init__(self, ao=0.45):
        super().__init__(ao)
        self.lines = []
        self.smoke = []
        self.hulls = []
        self.extras = {}
        # M7 boats: a colour cast on the baked shade, by where the vertex is (model frame): the
        # green-brown slime of the waterline, weed below it, soot, rust. None: grey shade only.
        self.tintfn = None

    def face(self, vs, uvs, mat, shade=1.0, smooth=False, local=None):
        f = super().face(vs, uvs, mat, shade, smooth, local)
        if f is not None and self.tintfn is not None:
            for loop in f.loops:
                c = loop[self.col]
                r, g, b = self.tintfn(loop.vert.co)
                loop[self.col] = (c[0] * r, c[1] * g, c[2] * b, 1.0)
        return f

    def line(self, a, b):
        self.lines.append((self.xf @ Vector(a), self.xf @ Vector(b)))

    def lamp(self, p, kind=0):
        """M7 boats: a lantern's flame here (model frame), for the game's lamp APIs: kind 0 a white
        riding or stern light, 1 red (port), 2 green (starboard)."""
        q = self.xf @ Vector(p)
        self.extras.setdefault("lamps", []).append([round(q.x, 3), round(q.y, 3), round(q.z, 3), kind])

    def stove(self, p):
        """M7 boats: the top of a cabin's stovepipe (a thin coal smoke, weaker than a funnel's)."""
        q = self.xf @ Vector(p)
        self.extras.setdefault("stove", []).append([round(q.x, 3), round(q.y, 3), round(q.z, 3)])


def waterline_tint(p):
    """Grime of a hull that lives in the Schelde: green-brown slime round the waterline (the tide
    moves it up and down a hand's breadth), weed and a pale bloom below it."""
    z = p.z
    band = math.exp(-((z - 0.05) / 0.22) ** 2)
    weed = min(1.0, max(0.0, (-0.12 - z) / 0.5))
    return (1 - 0.34 * band - 0.28 * weed, 1 - 0.18 * band - 0.08 * weed, 1 - 0.42 * band - 0.34 * weed)

OUT = os.path.join(ROOT, "client", "public", "models", "boats.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

EXTRA = ["tar", "clinker", "iron_hull", "iron_ports", "band", "copper", "redlead", "deck", "paint_green",
         "paint_white", "canvas", "canvas_tan", "rigging", "shrouds", "lattice", "funnel", "window", "hatch",
         "tarp", "flag", "names", "washing", "names2", "funnel_star", "names3",
         # M7 boats: the detail pass and the small boats
         "tar_weed", "names4", "netting", "coal", "sand", "streaks", "bilge", "varnish", "hood",
         # the portal crane's detail pass (docs/milestones/vehicle-detail.md): riveted plate, chequer plate,
         # the cabin's upright boarding, the cast plate on the portal
         "crane_plate", "chequer", "cabin_planks", "crane_board"]
# the street-prop materials we use, painted with build_props' painters (our own list: props.glb may change)
BASE = ["wood", "wood_dark", "iron", "rope", "sackcloth", "crate", "barrel", "stone", "glass"]
WOOD, DARK, IRON, ROPE, SACK, CRATE, BARREL, STONE, GLASS = range(len(BASE))
MATS = BASE + EXTRA
(TAR, CLINKER, IRONHULL, PORTS, BAND, COPPER, REDLEAD, DECK, GREEN, WHITE, CANVAS, TAN, RIG, SHROUD, LATTICE,
 FUNNEL, WINDOW, HATCH, TARP, FLAG, NAMES, WASH, NAMES2, FUNNEL_STAR, NAMES3,
 TARWEED, NAMES4, NET, COAL, SAND, STREAKS, BILGE, VARNISH, HOOD,
 PLATE, CHEQUER, BOARDS, CBOARD) = range(len(BASE), len(MATS))
# thin parts, seen from both sides (the game makes these double-sided too)
THIN = {"shrouds", "lattice", "flag", "canvas", "canvas_tan", "tarp", "washing", "netting", "streaks"}
# metres per texture tile for faces mapped by position
TILE = {TAR: 2.0, TARWEED: 2.0, VARNISH: 1.2, CLINKER: 1.0, IRONHULL: 2.0, COPPER: 2.0, REDLEAD: 2.0, GREEN: 1.6, WHITE: 1.6, DECK: 1.6,
        WOOD: 1.6, DARK: 1.2}

# ------------------------------------------------------------------ textures
#
# B0, 2026-10-11 (Steve: "Remodel all boats in high detail, good textures ... Bumpmapping where possible"): every
# boat material is painted as a Surf, its colour, its height (0 low to 1 high, 0.5 level: the relief the game lights,
# drawn with the same strokes as the colour, docs/rendering.md "Bumps") and, for the cut-out ones, its alpha. A square
# picture is painted at P px and averaged down to CELL px (two samples a texel: clean seams and rivets). write_atlas
# puts every material in its CELL of one picture of ATLAS_N x ATLAS_N cells (2048 px): client/public/textures/
# boats_atlas.webp (colour and cut-out), boats_atlas_h.png (height) and boats_atlas.json (the cells by material).
# The game draws every boat, the lock's and the bridges' boat parts and the ferry from it (world/boats.ts
# loadModelSet). Each material also keeps a GLB_PX copy of its colour in the glb, for lock.ts and the Godot model
# library. Pictures are arrays [v, u] with row 0 at the bottom (Blender's v = 0), as before.
#
# A hull is mapped by position (Hull._uv: u along the hull, v = height / TILE), so v = 0 is the waterline on every
# tile: nothing is banded by height in a picture that repeats up the side (the waterline grime is the vertex colour,
# waterline_tint).

P = 512
CELL = 256
ATLAS_N = 8
GLB_PX = 128
# the size of each material's picture in Blender and the glb (a preview may set CELL for its close-ups)
IMG_PX = [GLB_PX]
ATLAS_DIR = os.path.join(ROOT, "client", "public", "textures")


class Surf:
    """A painted material: colour [v, u, 3], height [v, u] (0.5 level) and alpha [v, u] or None."""

    def __init__(self, c, h, a=None):
        self.c, self.h, self.a = c, h, a


def noise(rng, w, h, cu, cv):
    """Tileable value noise of any size (cropped from a square field: tiles only along a side of full length)."""
    n = max(w, h)
    return vnoise(rng, n, int(cu), int(cv))[:h, :w]


def fbm(rng, w, h, cu, cv, octaves=4):
    """Noise of several sizes, the finer ones fainter, 0..1, tileable."""
    acc, tot, k = 0.0, 0.0, 1.0
    for o in range(octaves):
        acc = acc + k * noise(rng, w, h, cu * 2 ** o, cv * 2 ** o)
        tot += k
        k *= 0.5
    return acc / tot


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """a toward b by t (t [v, u] or a number); b a colour or a picture."""
    t = np.asarray(t, dtype=np.float64)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + np.asarray(b) * t


def blur(a, r):
    """A box blur that wraps (the pictures tile), r px each way, along v and u."""
    r = int(r)
    if r < 1:
        return a
    out = a
    for ax in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=ax)
        out = acc / (2 * r + 1)
    return out


def down(a, f):
    """Average f x f blocks."""
    if f == 1:
        return a
    h, w = a.shape[:2]
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean(axis=(1, 3))


def resize(a, h, w):
    """To h x w: whole halvings by averaging, then linear."""
    a = np.asarray(a, dtype=np.float64)
    H, W = a.shape[:2]
    while H >= 2 * h and H % 2 == 0:
        a = a.reshape(H // 2, 2, W, *a.shape[2:]).mean(axis=1)
        H //= 2
    while W >= 2 * w and W % 2 == 0:
        a = a.reshape(H, W // 2, 2, *a.shape[2:]).mean(axis=2)
        W //= 2
    if (H, W) == (h, w):
        return a
    ys = np.clip((np.arange(h) + 0.5) * H / h - 0.5, 0, H - 1)
    xs = np.clip((np.arange(w) + 0.5) * W / w - 0.5, 0, W - 1)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, H - 1)
    x1 = np.minimum(x0 + 1, W - 1)
    fy = (ys - y0).reshape(-1, *([1] * (a.ndim - 1)))
    a = a[y0] * (1 - fy) + a[y1] * fy
    fx = (xs - x0).reshape(1, -1, *([1] * (a.ndim - 2)))
    return a[:, x0] * (1 - fx) + a[:, x1] * fx


def stamp(H, C, cx, cy, r, hfn=None, colour=None, cfn=None, rx=None):
    """A round thing at (cx, cy) px, radius r (rx across u if not round), wrapping: the height changed by hfn(d) and
    the colour mixed toward `colour` by cfn(d), d the distance over the radius (0 centre, 1 rim)."""
    h_, w_ = H.shape
    rx = r if rx is None else rx
    Rx, Ry = int(np.ceil(rx * 1.6)) + 1, int(np.ceil(r * 1.6)) + 1
    xs = np.arange(int(cx) - Rx, int(cx) + Rx + 1)
    ys = np.arange(int(cy) - Ry, int(cy) + Ry + 1)
    X, Y = np.meshgrid(xs, ys)
    d = np.hypot((X + 0.5 - cx) / rx, (Y + 0.5 - cy) / r)
    ix = np.ix_(ys % h_, xs % w_)
    if hfn is not None:
        H[ix] += hfn(d)
    if colour is not None and C is not None:
        m = np.clip(cfn(d), 0, 1)[..., None]
        C[ix] = C[ix] * (1 - m) + np.asarray(colour) * m


def dome(height, rim=0.0):
    """A rivet or nail head: a round top, a dark fillet of shadow (rim) round it."""
    return lambda d: height * np.sqrt(np.clip(1 - d * d, 0, 1)) - rim * sstep(1.0, 1.15, d) * sstep(1.6, 1.15, d)


def disc(soft=0.15):
    return lambda d: sstep(1.0, 1.0 - soft, d)


def run_down(H, C, rng, x, y, length, width, colour, strength=0.7, raise_=0.0, wander=0.6):
    """A run (rust, tar, soot, slime) from (x, y) down the picture (v falls), tapering and fading."""
    for k in range(0, int(length), 2):
        t = k / max(1.0, length)
        wk = max(0.8, width * (1 - 0.7 * t))
        a = strength * (1 - t) ** 1.2
        x += rng.normal(0, wander * 0.5)
        stamp(H, C, x, y - k, wk, (lambda d, a=a: raise_ * a * np.clip(1 - d, 0, 1)) if raise_ else None,
              colour, lambda d, a=a: a * sstep(1.0, 0.4, d), rx=wk * 0.7)


class Boards:
    """Boards (strakes, planks) running along u, n of them up v; butt joints on some of the frames.

    b: the board of each row; across: 0 at its lower seam to 1 at its upper; dv: px to the nearest long seam;
    du [v, u]: px to the nearest butt; seg [v, u]: one number per length of board (a tone for each)."""

    def __init__(self, rng, w, h, n, frames=4, butt_p=0.3, frame_off=0.0):
        bh = h / n
        vv = np.arange(h) + 0.5
        uu = np.arange(w) + 0.5
        self.n, self.w, self.h, self.bh = n, w, h, bh
        self.b = np.minimum((vv // bh).astype(int), n - 1)
        self.across = (vv - self.b * bh) / bh
        self.dv = np.minimum(vv - self.b * bh, (self.b + 1) * bh - vv)
        self.frames = [(((j + 0.5) / frames + frame_off) % 1.0) * w for j in range(frames)]
        self.du = np.full((h, w), 1e9)
        self.seg = np.zeros((h, w), int)
        self.cuts = []
        prev = set()
        for k in range(n):
            rows = self.b == k
            js = [j for j in range(frames) if j not in prev and rng.random() < butt_p]
            prev = set(js)
            cuts = sorted(self.frames[j] for j in js)
            self.cuts.append(cuts)
            if cuts:
                d = np.min([np.abs(((uu - c) + w / 2) % w - w / 2) for c in cuts], axis=0)
                self.du[rows] = d[None, :]
                idx = np.searchsorted(cuts, uu) % len(cuts)
                self.seg[rows] = (k * 16 + idx)[None, :]
            else:
                self.seg[rows] = k * 16

    def edge(self):
        return np.minimum(self.dv[:, None], self.du)

    def tone(self, rng, lo=0.85, hi=1.15):
        return rng.uniform(lo, hi, 16 * self.n + 16)[self.seg]

    def height(self, seam_px=1.5, arris=3.0, cup=0.06, seam_h=0.22, face=0.62):
        """The boards' faces, a little rounded across (cup), their edges rounded down into the seams."""
        e = self.edge()
        f = face + cup * (1 - (2 * self.across[:, None] - 1) ** 2)
        return seam_h + (f - seam_h) * sstep(seam_px, seam_px + arris, e), e

    def per_board(self, field, rng):
        """The field shifted along u by its own amount on each board (no grain runs on across a seam)."""
        out = np.empty_like(field)
        for k in range(self.n):
            rows = self.b == k
            out[rows] = np.roll(field, int(rng.integers(0, self.w)), axis=1)[rows]
        return out


def wood_grain(rng, w, h, n, bh=None):
    """Grain along u: long streaks (g, 0..1) and the thin dark lines of the year rings (fig, 0..1)."""
    g = 0.5 * noise(rng, w, h, 3, 6 * n) + 0.3 * noise(rng, w, h, 6, 16 * n) + 0.2 * noise(rng, w, h, 16, 48 * n)
    bh = bh or h / n
    warp = noise(rng, w, h, 2, 2 * n) * 3.0 + noise(rng, w, h, 8, 4 * n) * 0.6
    ring = np.abs(np.sin(np.pi * (np.arange(h)[:, None] / (bh / 4.5) + warp)))
    fig = sstep(0.16, 0.0, ring)
    return g, fig


def knots(H, C, rng, w, h, count, col_dark, size=(5, 12)):
    for _ in range(count):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(*size)
        stamp(H, C, cx, cy, r * 0.55, lambda d: 0.05 * np.clip(1 - d, 0, 1) - 0.06 * sstep(1.4, 1.0, d) * sstep(0.7, 1.0, d),
              col_dark, lambda d: 0.75 * sstep(1.1, 0.5, d), rx=r * 1.6)


def letters(C, rng, text, cx, ytop, px, ink, adv=None, keep=1.0):
    """Painted letters (FONT, 5 x 7) centred on cx, their top at row ytop (rows run bottom-up), px a font pixel."""
    adv = adv or 6 * px
    x0 = cx - (len(text) * adv - px) / 2
    for k, ch in enumerate(text):
        for gy, row in enumerate(FONT.get(ch, FONT[" "])):
            for gx, bit in enumerate(row):
                if bit == "1" and rng.random() < keep:
                    x = int(round(x0 + k * adv + gx * px))
                    y = int(round(ytop - (gy + 1) * px))
                    C[y:y + px, x:x + px] = ink * (0.88 + 0.24 * rng.random())


def done(c, h, a=None, k=1.0, cavity=0.6):
    """The finished picture: the height's relief made k times stronger (round level) and kept in 0..1, and the
    colour darkened in its own hollows (seams, pits, the shadow under a lap: they read in the shade too, where a bump
    has no light to tilt)."""
    h = np.clip(0.5 + (h - 0.5) * k, 0, 1)
    c = c * (1 - cavity * np.clip(0.48 - h, 0, 1))[..., None]
    return Surf(np.clip(c, 0, 1), h, None if a is None else np.clip(a, 0, 1))


# ---- the planked hulls


def surf_tar(seed, base=(0.2, 0.165, 0.13), drips=True):
    """Tarred carvel planking above the water (2 m a tile): 8 strakes of 25 cm, caulked seams payed with pitch, oak
    trenails two a strake on each frame (every 50 cm), the butts' iron spikes, tar drips from the seams, thin places
    where the wood shows brown, salt bloom, fender scrapes."""
    rng = np.random.default_rng(seed)
    w = h = P
    B = Boards(rng, w, h, 8, frames=4, butt_p=0.28)
    g, fig = wood_grain(rng, w, h, 8)
    g, fig = B.per_board(g, rng), B.per_board(fig, rng)
    H, e = B.height(seam_px=1.4, arris=4.0, cup=0.07, seam_h=0.3)
    tone = B.tone(rng, 0.8, 1.2)
    C = col(base) * (tone * (0.76 + 0.44 * g) * (1 - 0.22 * fig))[..., None]
    thin = sstep(0.55, 0.8, fbm(rng, w, h, 4, 10)) * sstep(0.35, 0.7, g)
    C = mix(C, col((0.21, 0.15, 0.1)) * (0.75 + 0.5 * g)[..., None], thin * 0.55)
    gloss = sstep(0.62, 0.85, noise(rng, w, h, 5, 34))
    C *= (1 + 0.28 * gloss)[..., None]
    H += 0.06 * (g - 0.5) - 0.05 * fig * (1 - gloss) + 0.02 * gloss
    seam = sstep(2.6, 0.9, e)
    C = mix(C, col((0.035, 0.03, 0.028)), seam * 0.92)
    # the pitch in the seams stands a hair proud where it was payed thick
    H += 0.06 * seam * sstep(0.5, 0.8, noise(rng, w, h, 24, 8))
    for k in range(B.n):
        for f in B.frames:
            for a_ in (0.3, 0.72):
                cx = f + rng.normal(0, 1.5)
                cy = (k + a_ + rng.normal(0, 0.02)) * B.bh
                stamp(H, C, cx, cy, 4.0, lambda d: 0.03 * np.clip(1 - d, 0, 1) - 0.09 * sstep(0.8, 1.0, d) * sstep(1.35, 1.0, d),
                      col((0.2, 0.14, 0.09)) * rng.uniform(0.7, 1.1), lambda d: 0.85 * sstep(1.0, 0.75, d))
        for c in B.cuts[k]:
            for side in (-9, 9):
                for a_ in (0.28, 0.72):
                    x, y = c + side, (k + a_) * B.bh
                    stamp(H, C, x, y, 3.0, dome(0.12, 0.05), col((0.06, 0.055, 0.05)), disc())
                    if rng.random() < 0.6:
                        run_down(H, C, rng, x, y - 2, rng.uniform(12, 40), 2.2, col((0.26, 0.12, 0.06)), 0.45)
    if drips:
        for _ in range(55):
            k = int(rng.integers(1, B.n))
            run_down(H, C, rng, rng.uniform(0, w), k * B.bh - 1, rng.uniform(10, 70), rng.uniform(2.0, 4.0),
                     col((0.03, 0.026, 0.024)), 0.85, raise_=0.12, wander=0.3)
    salt = sstep(0.6, 0.82, fbm(rng, w, h, 5, 4)) * (0.4 + 0.6 * noise(rng, w, h, 40, 10))
    C = mix(C, col((0.25, 0.24, 0.21)), salt * 0.32)
    for _ in range(9):
        y = rng.uniform(0, h)
        x0 = rng.uniform(0, w)
        ln = rng.uniform(80, 360)
        xs = (x0 + np.arange(int(ln))).astype(int) % w
        ys = (y + np.cumsum(rng.normal(0, 0.15, int(ln)))).astype(int) % h
        C[ys, xs] = mix(C[ys, xs], col((0.27, 0.21, 0.15)), 0.55)
        H[ys, xs] -= 0.05
    return done(speckle(C, rng, 0.04, 0.7, 1.25), H)


def surf_tar_weed(seed):
    """Tarred planks under the water (the bottoms that show on the mud): slime over everything, weed hanging in
    strands, barnacles in clusters, the seams still showing. As dense all over (the tile repeats down the side)."""
    rng = np.random.default_rng(seed)
    w = h = P
    s = surf_tar(seed, base=(0.155, 0.145, 0.105), drips=False)
    C, H = s.c, (s.h - 0.5) * 0.8 + 0.5
    slime = fbm(rng, w, h, 4, 4)
    C = mix(C, col((0.1, 0.13, 0.065)), 0.35 + 0.35 * slime)
    H = H * 0.85 + 0.075
    for _ in range(160):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        ln = rng.uniform(16, 90)
        wd = rng.uniform(1.5, 3.5)
        c = col((0.09, 0.15, 0.055)) * rng.uniform(0.7, 1.4)
        ph, lam = rng.uniform(0, 6.3), rng.uniform(8, 20)
        for k in range(0, int(ln), 2):
            t = k / ln
            stamp(H, C, x + 3.0 * math.sin(k / lam + ph), y - k, max(0.8, wd * (1 - 0.6 * t)),
                  lambda d, t=t: 0.09 * (1 - t) * np.clip(1 - d, 0, 1), c, lambda d, t=t: 0.9 * (1 - 0.5 * t) * sstep(1.0, 0.4, d))
    for _ in range(26):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        for _ in range(int(rng.integers(6, 22))):
            r = rng.uniform(2.8, 7.0)
            x, y = cx + rng.normal(0, 18), cy + rng.normal(0, 14)
            shell = col((0.5, 0.49, 0.43)) * rng.uniform(0.7, 1.15)
            stamp(H, C, x, y, r, lambda d: 0.22 * np.clip(1 - d, 0, 1) ** 0.8 - 0.16 * sstep(0.4, 0.2, d), shell, disc(0.25))
            stamp(H, C, x, y, r * 0.38, None, col((0.07, 0.07, 0.06)), disc(0.3))
    bloom = sstep(0.62, 0.8, noise(rng, w, h, 7, 7)) * (rng.random((h, w)) < 0.4)
    C = mix(C, col((0.32, 0.31, 0.26)), bloom * 0.5)
    return done(speckle(C, rng, 0.05, 0.6, 1.3), H)


def surf_clinker(seed, base=(0.23, 0.18, 0.13)):
    """Lapped strakes of a small boat (1 m a tile, 8 strakes): each strake's lower edge stands proud over the one below
    and casts its shadow on it; copper clench nails along every lap; worn pale on the lap edges; oiled and tarred."""
    rng = np.random.default_rng(seed)
    w = h = P
    B = Boards(rng, w, h, 8, frames=5, butt_p=0.12)
    g, fig = wood_grain(rng, w, h, 8)
    g, fig = B.per_board(g, rng), B.per_board(fig, rng)
    a = B.across[:, None]
    H = 0.3 + 0.52 * sstep(0.0, 0.06, a) * (1 - 0.9 * a) + 0.0 * g
    H = H + 0.05 * (g - 0.5) - 0.04 * fig
    tone = B.tone(rng, 0.85, 1.15)
    C = col(base) * (tone * (0.8 + 0.36 * g) * (1 - 0.2 * fig))[..., None]
    C *= (1 - 0.55 * sstep(0.82, 1.0, a))[..., None]
    lap = sstep(0.09, 0.01, a) * (0.5 + 0.5 * noise(rng, w, h, 24, 8))
    C = mix(C, col((0.38, 0.35, 0.3)), lap * 0.5)
    H = np.minimum(H, 0.3 + 0.6 * sstep(1.2, 3.0, B.du))
    wear = sstep(0.6, 0.85, fbm(rng, w, h, 6, 6))
    C = mix(C, col((0.36, 0.34, 0.3)) * (0.8 + 0.4 * g)[..., None], wear * 0.6)
    for k in range(B.n):
        y = (k + 0.07) * B.bh
        x = rng.uniform(0, 40)
        while x < w:
            stamp(H, C, x, y + rng.normal(0, 0.6), 3.0, dome(0.14, 0.05), col((0.36, 0.25, 0.15)) * rng.uniform(0.8, 1.15), disc())
            if rng.random() < 0.25:
                stamp(H, C, x, y - 3, 2.6, None, col((0.24, 0.36, 0.28)), lambda d: 0.5 * sstep(1.0, 0.3, d))
            x += rng.uniform(36, 46)
    return done(speckle(C, rng, 0.04), H)


def surf_varnish(seed):
    """A gig's varnished carvel planking (1.2 m a tile, 8 strakes): warm brown, the figure of the wood, the varnish's
    shine along each strake, thin seams."""
    rng = np.random.default_rng(seed)
    w = h = P
    B = Boards(rng, w, h, 8, frames=3, butt_p=0.15)
    g, fig = wood_grain(rng, w, h, 8)
    g, fig = B.per_board(g, rng), B.per_board(fig, rng)
    H, e = B.height(seam_px=0.8, arris=2.5, cup=0.04, seam_h=0.32)
    H += 0.02 * (g - 0.5)
    C = col((0.38, 0.21, 0.1)) * (B.tone(rng, 0.88, 1.12) * (0.8 + 0.32 * g) * (1 - 0.3 * fig))[..., None]
    shine = np.exp(-((B.across - 0.62) / 0.16) ** 2)[:, None] * (0.6 + 0.4 * noise(rng, w, h, 4, 8))
    C *= (1 + 0.22 * shine)[..., None]
    C = mix(C, col((0.12, 0.06, 0.03)), sstep(1.8, 0.6, e) * 0.8)
    scuff = sstep(0.7, 0.86, fbm(rng, w, h, 8, 8))
    C = mix(C, col((0.42, 0.33, 0.24)), scuff * 0.4)
    return done(speckle(C, rng, 0.02), H, k=0.8)


def surf_deck(seed, base=(0.47, 0.44, 0.38)):
    """Deck planking (1.6 m a tile): 10 planks of 16 cm, black pitch in the seams, butts on the beams, bungs over the
    bolts two a plank on each beam, the grain raised by the weather and the holystone, tar spots, a cask's ring."""
    rng = np.random.default_rng(seed)
    w = h = P
    B = Boards(rng, w, h, 10, frames=4, butt_p=0.14, frame_off=0.06)
    g, fig = wood_grain(rng, w, h, 10)
    g, fig = B.per_board(g, rng), B.per_board(fig, rng)
    H, e = B.height(seam_px=1.4, arris=2.5, cup=0.05, seam_h=0.34)
    H += 0.09 * (g - 0.5) - 0.09 * fig
    C = col(base) * (B.tone(rng, 0.86, 1.12) * (0.78 + 0.34 * g) * (1 - 0.28 * fig))[..., None]
    grey = sstep(0.4, 0.75, fbm(rng, w, h, 3, 3))
    C = mix(C, col((0.5, 0.49, 0.46)) * (0.85 + 0.25 * g)[..., None], grey * 0.35)
    dirt = sstep(5.0, 1.0, e)
    C *= (1 - 0.25 * dirt)[..., None]
    C = mix(C, col((0.035, 0.03, 0.028)), sstep(2.4, 1.0, e) * 0.95)
    for k in range(B.n):
        for f in B.frames:
            for a_ in (0.3, 0.7):
                stamp(H, C, f + rng.normal(0, 1.2), (k + a_) * B.bh, 3.8,
                      lambda d: -0.02 * np.clip(1 - d, 0, 1) - 0.06 * sstep(0.8, 1.0, d) * sstep(1.3, 1.0, d),
                      col((0.37, 0.33, 0.27)) * rng.uniform(0.85, 1.1), lambda d: 0.9 * sstep(1.0, 0.8, d))
    for _ in range(14):
        stamp(H, C, rng.uniform(0, w), rng.uniform(0, h), rng.uniform(2, 7), lambda d: 0.04 * np.clip(1 - d, 0, 1),
              col((0.06, 0.05, 0.045)), disc(0.4))
    cx, cy, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(26, 40)
    stamp(H, C, cx, cy, r, None, col((0.24, 0.2, 0.16)), lambda d: 0.18 * sstep(0.12, 0.0, np.abs(d - 0.9)))
    return done(speckle(C, rng, 0.03, 0.75, 1.15), H)


def surf_planks(seed, base, boards=4, seams=True, butts=0.35, nails=True, n_knots=3, checks=0, tile_grain=1.0):
    """Weathered boards along u: seams, butt joints nailed, knots, drying checks."""
    rng = np.random.default_rng(seed)
    w = h = P
    B = Boards(rng, w, h, boards, frames=4, butt_p=butts if seams else 0.0)
    g, fig = wood_grain(rng, w, h, boards)
    g, fig = B.per_board(g, rng), B.per_board(fig, rng)
    if seams:
        H, e = B.height(seam_px=1.6, arris=3.0, cup=0.06, seam_h=0.2)
    else:
        H, e = 0.6 + 0.0 * g, np.full((h, w), 1e9)
    H = H + 0.08 * (g - 0.5) * tile_grain - 0.07 * fig
    C = col(base) * (B.tone(rng, 0.85, 1.15) * (0.78 + 0.38 * g) * (1 - 0.25 * fig))[..., None]
    if seams:
        C = mix(C, col(base) * 0.25, sstep(2.6, 1.0, e) * 0.9)
        C *= (1 - 0.18 * sstep(6.0, 1.5, e))[..., None]
    knots(H, C, rng, w, h, n_knots, col(base) * 0.45)
    for _ in range(checks):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        ln = int(rng.uniform(30, 130))
        xs = (x + np.arange(ln)).astype(int) % w
        ys = (y + np.cumsum(rng.normal(0, 0.12, ln))).astype(int) % h
        C[ys, xs] *= 0.4
        H[ys, xs] -= 0.18
        C[(ys + 1) % h, xs] *= 0.8
    if nails and seams:
        for k in range(B.n):
            for c in B.cuts[k]:
                for side in (-7, 7):
                    for a_ in (0.25, 0.75):
                        stamp(H, C, c + side, (k + a_) * B.bh, 2.6, dome(0.12, 0.05), col((0.09, 0.08, 0.075)), disc())
    return done(speckle(C, rng, 0.04), H), B


def surf_painted(seed, base, boards, under, chip=0.6, streak=0.12, transpose=False):
    """Painted boarding: the paint's brush marks along the boards, dirt run down from above, chips through to the grey
    wood with a raised edge of paint round each, the seams and butts filled with paint."""
    rng = np.random.default_rng(seed)
    w = h = P
    wood, B = surf_planks(seed + 1000, under, boards=boards, butts=0.3, nails=True, n_knots=1)
    H = (wood.h - 0.5) * 0.6 + 0.5
    e = B.edge()
    brush = noise(rng, w, h, 4, 90) * 0.6 + noise(rng, w, h, 12, 160) * 0.4
    C = col(base) * (0.9 + 0.12 * fbm(rng, w, h, 6, 6) + 0.06 * (brush - 0.5))[..., None]
    C *= (1 - 0.42 * sstep(2.2, 0.8, e))[..., None]
    C *= (1 - 0.12 * sstep(6.0, 1.5, e))[..., None]
    H = H + 0.04 + 0.025 * (brush - 0.5)
    runs = noise(rng, w, h, 46, 3) * 0.7 + noise(rng, w, h, 90, 5) * 0.3
    C = mix(C, col((0.18, 0.16, 0.13)), sstep(0.55, 0.9, runs) * streak)
    m = fbm(rng, w, h, 10, 10)
    cm = sstep(chip + 0.22, chip + 0.26, m)
    spots = np.zeros((h, w))
    for _ in range(90):
        stamp(spots, None, rng.uniform(0, w), rng.uniform(0, h), rng.uniform(1.5, 6), lambda d: sstep(1.0, 0.8, d), rx=rng.uniform(2, 12))
    cm = np.clip(np.maximum(cm, spots), 0, 1)
    rim = np.clip(blur(cm, 2) - cm, 0, 1)
    C = mix(C, wood.c, cm)
    C *= (1 - 0.35 * rim)[..., None]
    H = H - 0.07 * cm + 0.05 * rim
    s = done(speckle(C, rng, 0.02, 0.85, 1.1), H)
    if transpose:
        s = Surf(s.c.transpose(1, 0, 2).copy(), s.h.T.copy())
    return s


# ---- iron and copper


def plating(rng, w, h, strakes=2, pitch=19, frames=4, butts=(0.25, 0.75)):
    """Riveted iron plates in and out (2 m a tile): the outer strakes lap over the inner ones above and below, double
    rows of rivets along every lap and at the plates' butts, single rows on the frames. Returns the height, the
    rivets ((x, y), radius) and the lap and seam lines (as masks)."""
    sh = h / strakes
    ov = sh * 0.07
    vv = np.arange(h) + 0.5
    uu = np.arange(w) + 0.5
    k = np.minimum((vv // sh).astype(int), strakes - 1)
    outer = np.zeros(h, bool)
    for j in range(strakes):
        if j % 2 == 1:
            lo, hi = j * sh - ov, (j + 1) * sh + ov
            outer |= ((vv >= lo) & (vv < hi)) | ((vv - h >= lo) & (vv - h < hi)) | ((vv + h >= lo) & (vv + h < hi))
    H = np.where(outer, 0.62, 0.46)[:, None] * np.ones((1, w))
    # the outer strakes' edges rounded off
    d_edge = np.full(h, 1e9)
    for j in range(strakes):
        if j % 2 == 1:
            for b in (j * sh - ov, (j + 1) * sh + ov):
                d_edge = np.minimum(d_edge, np.abs(((vv - b) + h / 2) % h - h / 2))
    bev = sstep(0.0, 3.0, d_edge)
    H = 0.46 + (H - 0.46) * np.where(outer, bev, 1.0)[:, None]
    lap = np.zeros((h, w))
    lap += (sstep(1.6, 0.4, d_edge) * outer)[:, None]
    rivets = []
    for j in range(strakes):
        b = j * sh
        for off in (-0.45 * ov, 0.45 * ov):
            x = rng.uniform(0, pitch)
            while x < w:
                rivets.append(((x, (b + off) % h), 3.0))
                x += pitch
    seams = np.zeros((h, w))
    for j in range(strakes):
        bu = butts[j % len(butts)] * w
        rows = k == j
        d = np.abs(((uu - bu) + w / 2) % w - w / 2)
        seams[rows] = np.maximum(seams[rows], sstep(1.2, 0.3, d)[None, :])
        for off in (-14, -6, 6, 14):
            y = j * sh + ov * 1.4
            while y < (j + 1) * sh - ov * 1.4:
                rivets.append((((bu + off) % w, y), 2.8))
                y += pitch * 0.9
    for f in range(frames):
        fx = (f + 0.5) / frames * w
        y = rng.uniform(0, pitch * 2)
        while y < h:
            if all(abs(((fx - (butts[int(y // sh) % len(butts)] * w)) + w / 2) % w - w / 2) > 30 for _ in (0,)):
                rivets.append(((fx, y), 2.8))
            y += pitch * 2.6
    H = H - 0.12 * seams
    return H, rivets, lap, seams, k, sh


def surf_iron_hull(seed, paint=(0.13, 0.125, 0.13), under=(0.32, 0.11, 0.065), red=False):
    """Black-painted iron plating in and out (2 m a tile: two strakes of 1 m, plates of 2 m): rivet rows along the laps,
    the butts and the frames, rust bleeding from the laps and running down from rivets, chips through to the red
    lead, dents. red: the red lead bottom of a steamer (the same plates, the red lead worn and fouled)."""
    rng = np.random.default_rng(seed)
    w = h = P
    H, rivets, lap, seams, k, sh = plating(rng, w, h)
    dents = noise(rng, w, h, 4, 4) - 0.5
    H += 0.05 * dents
    C = col(paint) * (0.84 + 0.3 * fbm(rng, w, h, 8, 8) + 0.9 * dents * 0.25)[..., None]
    if red:
        chalk = sstep(0.5, 0.8, fbm(rng, w, h, 6, 6))
        C = mix(C, col((0.46, 0.22, 0.15)), chalk * 0.35)
    C *= (1 - 0.5 * lap)[..., None]
    C *= (1 - 0.55 * seams)[..., None]
    rust = col((0.34, 0.15, 0.07))
    cm = sstep(0.8, 0.84, fbm(rng, w, h, 14, 14)) * (rng.random((h, w)) < 0.85)
    C = mix(C, col(under) * (0.8 + 0.4 * noise(rng, w, h, 40, 40))[..., None], cm)
    H -= 0.04 * cm
    for (x, y), r in rivets:
        stamp(H, C, x, y, r, dome(0.24, 0.07), col(paint) * rng.uniform(1.2, 1.7), lambda d: 0.6 * sstep(1.0, 0.3, d))
    picks = rng.choice(len(rivets), size=min(len(rivets), 70), replace=False)
    for i in picks:
        (x, y), r = rivets[i]
        run_down(H, C, rng, x, y - r, rng.uniform(14, 90), rng.uniform(1.6, 3.2), rust * rng.uniform(0.8, 1.15),
                 rng.uniform(0.35, 0.7))
    # rust in the laps' lower edges, where the water stands
    for j in range(2):
        y = (j * sh) % h
        bleed = sstep(0.5, 0.85, noise(rng, w, 1, 30, 1))[0]
        for x in np.nonzero(bleed > 0.1)[0][::3]:
            if rng.random() < 0.5:
                run_down(H, C, rng, float(x), y - 2, rng.uniform(4, 28), 1.8, rust, 0.4 * bleed[x])
    if red:
        grime = sstep(0.4, 0.75, fbm(rng, w, h, 3, 5))
        C = mix(C, col((0.12, 0.1, 0.07)), grime * 0.45)
        for _ in range(40):
            stamp(H, C, rng.uniform(0, w), rng.uniform(0, h), rng.uniform(2, 5), lambda d: 0.04 * np.clip(1 - d, 0, 1),
                  col((0.1, 0.15, 0.06)), disc(0.5))
    return done(speckle(C, rng, 0.04, 0.75, 1.25), H, k=0.9)


def surf_copper(seed):
    """Copper sheathing (2 m a tile): sheets of 1 m by 40 cm, each row half a sheet along from the next, every sheet
    lapping the one below and the one aft; nails close along every edge and in a lozenge over the sheet; brown
    tarnish, green verdigris at the edges, the nails and in runs, bright where it was rubbed."""
    rng = np.random.default_rng(seed)
    w = h = P
    rows, per = 5, 2
    rh, sw = h / rows, w / per
    vv = (np.arange(h) + 0.5)[:, None]
    uu = (np.arange(w) + 0.5)[None, :]
    r = np.minimum((vv // rh).astype(int), rows - 1)
    shift = (r % 2) * sw / 2
    us = (uu - shift) % w
    s = (us // sw).astype(int)
    fv = vv - r * rh
    fu = us - s * sw
    sheet = r * per + s
    H = 0.52 + 0.06 * (noise(rng, w, h, 10, 12) - 0.5)
    ov = 5.0
    H = H + 0.08 * sstep(ov + 2, ov - 1, fv) - 0.05 * sstep(rh - 4, rh, fv)
    H = H + 0.05 * sstep(ov + 2, ov - 1, sw - fu) - 0.04 * sstep(3, 0, fu)
    edge = np.minimum(np.minimum(fv, rh - fv), np.minimum(fu, sw - fu))
    tone = rng.uniform(0.85, 1.15, rows * per + 1)[sheet]
    C = col((0.38, 0.22, 0.13)) * (tone * (0.82 + 0.3 * fbm(rng, w, h, 8, 8)))[..., None]
    dark = sstep(0.5, 0.75, fbm(rng, w, h, 5, 5))
    C = mix(C, col((0.17, 0.11, 0.075)), dark * 0.45)
    C *= (1 - 0.45 * sstep(2.0, 0.0, np.minimum(fv, fu)))[..., None]
    nails = []
    for ri in range(rows):
        for si in range(per):
            x0 = si * sw + (ri % 2) * sw / 2
            y0 = ri * rh
            for t in np.arange(4, sw - 2, 7.0):
                nails.append((x0 + t, y0 + 3.0))
                nails.append((x0 + t, y0 + rh - 3.0))
            for t in np.arange(4, rh - 2, 7.0):
                nails.append((x0 + 3.0, y0 + t))
                nails.append((x0 + sw - 3.0, y0 + t))
            for a_ in np.arange(0.2, 0.85, 0.2):
                for b_ in (0.33, 0.66):
                    nails.append((x0 + a_ * sw + (b_ - 0.5) * 18, y0 + b_ * rh))
    green = np.clip(fbm(rng, w, h, 7, 7) * 1.5 - 0.62 + 0.45 * sstep(10, 0, edge), 0, 1)
    vg = col((0.25, 0.43, 0.34))
    C = mix(C, vg * (0.85 + 0.35 * noise(rng, w, h, 50, 50))[..., None], green * 0.8)
    crust = sstep(0.7, 0.95, green) * noise(rng, w, h, 70, 70)
    C = mix(C, col((0.42, 0.55, 0.45)), crust * 0.5)
    H += 0.035 * crust
    for x, y in nails:
        stamp(H, C, x % w, y % h, 1.5, dome(0.1, 0.0), col((0.2, 0.3, 0.24)) if rng.random() < 0.45 else col((0.45, 0.28, 0.16)), disc(0.4))
    for _ in range(60):
        x, y = nails[int(rng.integers(0, len(nails)))]
        run_down(H, C, rng, x % w, y % h - 1.5, rng.uniform(10, 50), 1.6, vg, 0.4)
    for _ in range(12):
        y, x0, ln = rng.uniform(0, h), rng.uniform(0, w), int(rng.uniform(40, 200))
        xs = (x0 + np.arange(ln)).astype(int) % w
        ys = (y + np.arange(ln) * rng.normal(0, 0.05)).astype(int) % h
        for dy in (0, 1):
            C[(ys + dy) % h, xs] = mix(C[(ys + dy) % h, xs], col((0.62, 0.37, 0.21)), 0.5)
    return done(speckle(C, rng, 0.03, 0.8, 1.2), H, k=0.9)


def surf_iron(seed, base=(0.15, 0.15, 0.16)):
    """Iron fittings (bitts, chains, anchors, windlasses, stoves): dark, pitted, rust blooming in patches and flaking."""
    rng = np.random.default_rng(seed)
    w = h = P
    n = fbm(rng, w, h, 6, 6)
    rust = sstep(0.52, 0.66, n)
    C = mix(col(base) * (0.84 + 0.3 * fbm(rng, w, h, 24, 24))[..., None],
            col((0.33, 0.18, 0.1)) * (0.8 + 0.4 * noise(rng, w, h, 60, 60))[..., None], rust)
    H = 0.5 + 0.06 * (fbm(rng, w, h, 30, 30) - 0.5)
    flake = rust * noise(rng, w, h, 40, 40)
    H += 0.08 * sstep(0.5, 0.8, flake)
    pits = rng.random((h, w)) < 0.006
    pits = blur(pits.astype(float), 1) > 0.1
    H -= 0.12 * pits
    C[pits] *= 0.55
    return done(speckle(C, rng, 0.05, 0.6, 0.9), H, k=0.8)


# ---- cloth, rope, net


def weave(w, h, period, rng):
    """A plain weave: the threads' roundness, over and under (0..1)."""
    uu = (np.arange(w) + 0.5)[None, :] / period
    vv = (np.arange(h) + 0.5)[:, None] / period
    iu, iv = np.floor(uu), np.floor(vv)
    fu, fv = uu - iu, vv - iv
    over = ((iu + iv) % 2 == 0)
    warp = np.cos(np.pi * (fu - 0.5))
    weft = np.cos(np.pi * (fv - 0.5))
    t = np.where(over, warp * (0.6 + 0.4 * weft), weft * (0.6 + 0.4 * warp))
    thick = rng.uniform(0.85, 1.15, int(np.ceil(w / period)) + 1)[iu.astype(int) % (int(np.ceil(w / period)) + 1)] * \
        rng.uniform(0.85, 1.15, int(np.ceil(h / period)) + 1)[iv.astype(int) % (int(np.ceil(h / period)) + 1)]
    return t * thick


def surf_canvas(seed, base, gaskets=True, tan=False):
    """Furled sailcloth: folds and sharp creases along the bundle (constant u), the cloth's weave, mildew, the gaskets
    (the rope bands that hold a furled sail) a metre apart. Without gaskets: a canvas hood with stitched seams."""
    rng = np.random.default_rng(seed)
    w = h = P
    u = (np.arange(w) + 0.5)[None, :] / w
    warp = noise(rng, w, h, 3, 4) * 0.08
    folds = 0.5 + 0.3 * np.sin(2 * np.pi * (u * 5 + warp) + rng.uniform(0, 6)) + 0.15 * np.sin(2 * np.pi * (u * 11 + warp * 2))
    folds = folds * np.ones((h, 1))
    if not gaskets:
        folds = 0.5 + (folds - 0.5) * 0.5
    H = 0.5 + 0.35 * (folds - 0.5)
    C = col(base) * (0.78 + 0.3 * folds)[..., None]
    C *= (0.88 + 0.18 * noise(rng, w, h, 32, 4))[..., None]
    for _ in range(7):
        x = rng.uniform(0, w)
        d = np.abs(((np.arange(w) + 0.5 - x) + w / 2) % w - w / 2)[None, :] + 0.0 * H
        cr = sstep(3.0, 0.0, d) * (0.5 + 0.5 * noise(rng, w, h, 2, 8))
        C *= (1 - 0.4 * cr)[..., None]
        H -= 0.12 * cr
    wv = weave(w, h, 5.0, rng)
    C *= (0.95 + 0.06 * wv)[..., None]
    H += 0.03 * (wv - 0.5)
    mil = sstep(0.66, 0.85, fbm(rng, w, h, 6, 6)) * noise(rng, w, h, 40, 40)
    C = mix(C, col((0.3, 0.32, 0.27)) if not tan else col((0.2, 0.12, 0.07)), mil * 0.4)
    if tan:
        patch = sstep(0.45, 0.75, fbm(rng, w, h, 3, 3))
        C *= (1 - 0.18 * patch)[..., None]
    if gaskets:
        uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
        for v0 in (14 / 64 * h, 46 / 64 * h):
            band = (vv >= v0) & (vv < v0 + 3 / 64 * h)
            t = (vv - v0) / (3 / 64 * h)
            lay = 0.5 + 0.5 * np.sin(2 * np.pi * (uu / 10.0 + t * 1.5)) ** 2
            prof = np.sin(np.pi * np.clip(t, 0, 1))
            C[band] = (col((0.2, 0.16, 0.11)) * (0.6 + 0.5 * lay * prof)[..., None])[band]
            H[band] = (0.55 + 0.35 * prof * (0.75 + 0.25 * lay))[band]
            sh = (vv >= v0 - 4) & (vv < v0)
            C[sh] *= 0.75
    else:
        for x in (0.25 * w, 0.75 * w):
            for dx in (-4, 4):
                xs = int(x + dx)
                C[:, xs] *= 0.78
                H[:, xs] -= 0.04
                C[::5, xs - 1] *= 0.85
    return done(speckle(C, rng, 0.03), H, k=1.0)


def surf_tarp(seed):
    """Tarred tarpaulin over the hatches: broad folds and sharp creases slanting across, the tar's shine, worn pale
    over the hatch coamings' edges, lashed with ropes every 0.8 m (columns)."""
    rng = np.random.default_rng(seed)
    w = h = P
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    fold = fbm(rng, w, h, 3, 4)
    H = 0.5 + 0.3 * (fold - 0.5)
    C = col((0.14, 0.16, 0.13)) * (0.72 + 0.5 * fold)[..., None]
    t = ((uu + vv * 0.6) % 168) / 168
    cr = sstep(0.04, 0.0, np.abs(t - 0.5)) * (0.4 + 0.6 * noise(rng, w, h, 4, 4))
    C *= (1 - 0.35 * cr)[..., None]
    H -= 0.12 * cr
    sheen = sstep(0.6, 0.85, noise(rng, w, h, 6, 9))
    C *= (1 + 0.3 * sheen)[..., None]
    wear = sstep(0.68, 0.85, fbm(rng, w, h, 8, 8))
    C = mix(C, col((0.3, 0.3, 0.26)), wear * 0.45)
    for x in (15 / 64 * w, 47 / 64 * w):
        d = np.abs(uu - x)
        rope = d < 11
        prof = np.sqrt(np.clip(1 - (d / 11) ** 2, 0, 1))
        lay = 0.5 + 0.5 * np.sin(2 * np.pi * (vv / 14.0 + d / 22.0)) ** 2
        C[rope] = (col((0.33, 0.28, 0.19)) * (0.55 + 0.5 * prof * (0.7 + 0.3 * lay))[..., None])[rope]
        H[rope] = (0.55 + 0.4 * prof * (0.8 + 0.2 * lay))[rope]
        shadow = (d >= 11) & (d < 17)
        C[shadow] *= 0.7
        H[shadow] -= 0.05
    return done(speckle(C, rng, 0.04), H)


def surf_rope(seed, base=(0.5, 0.42, 0.29)):
    """Laid rope: three strands twisting along (four lays a tile, slanting), their fibres, the strands rounded."""
    rng = np.random.default_rng(seed)
    w = h = P
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    s = ((uu + vv) % 128) / 128.0
    prof = np.sin(np.pi * s) ** 0.7
    fib = noise(rng, w, h, 64, 8)
    fib = np.roll(fib, 0, axis=0)
    fibres = 0.5 * fib + 0.5 * noise(rng, w, h, 128, 16)
    C = col(base) * (prof * (0.6 + 0.5 * fibres) + 0.12)[..., None]
    C *= (0.85 + 0.25 * fbm(rng, w, h, 4, 4))[..., None]
    H = 0.2 + 0.65 * prof + 0.06 * (fibres - 0.5)
    return done(speckle(C, rng, 0.05), H)


def surf_shrouds(seed):
    """Shrouds and ratlines, cut out: four tarred shrouds across u, a ratline every eighth of v, rounded, laid."""
    rng = np.random.default_rng(seed)
    w = h = P
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    C = np.ones((h, w, 3)) * col((0.08, 0.065, 0.05))
    H = np.full((h, w), 0.5)
    A = np.zeros((h, w))
    for cu in (1, 21, 42, 62):
        x = cu / 64 * w
        d = np.abs(((uu - x) + w / 2) % w - w / 2)
        on = d < 8
        prof = np.sqrt(np.clip(1 - (d / 8) ** 2, 0, 1))
        lay = 0.5 + 0.5 * np.sin(2 * np.pi * (vv / 12.0 + d / 16.0)) ** 2
        A[on] = 1
        C[on] = (col((0.085, 0.07, 0.055)) * (0.55 + 0.6 * prof * (0.75 + 0.25 * lay))[..., None])[on]
        H[on] = (0.3 + 0.6 * prof)[on]
    dv = np.abs(((vv % (h / 8)) - 4.0))
    on = (dv < 4.0) & (A == 0)
    prof = np.sqrt(np.clip(1 - (dv / 4.0) ** 2, 0, 1))
    A[on] = 1
    C[on] = (col((0.16, 0.13, 0.1)) * (0.6 + 0.5 * prof)[..., None])[on]
    H[on] = (0.3 + 0.45 * prof)[on]
    return done(C, H, A)


def surf_netting(seed):
    """Tanned net, cut out: a diamond mesh of twine (four meshes a tile), knotted at the crossings."""
    rng = np.random.default_rng(seed)
    w = h = P
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    p = 128.0
    d1 = np.abs(((uu + vv) % p) - p / 2)
    d2 = np.abs(((uu - vv) % p) - p / 2)
    d = np.minimum(d1, d2) / np.sqrt(2)
    r = 5.5
    A = (d < r).astype(float)
    prof = np.sqrt(np.clip(1 - (d / r) ** 2, 0, 1))
    H = 0.3 + 0.55 * prof
    C = col((0.24, 0.16, 0.09)) * (0.55 + 0.55 * prof)[..., None] * (0.8 + 0.4 * rng.random((h, w, 1)))
    for i in range(4):
        for j in range(4):
            for cx, cy in (((i + 0.5) * p, (j + 0.0) * p), ((i + 0.0) * p, (j + 0.5) * p)):
                stamp(H, C, cx, cy, 9, lambda d_: 0.25 * np.sqrt(np.clip(1 - d_ * d_, 0, 1)), col((0.2, 0.13, 0.07)), disc(0.3))
                stamp(A, None, cx, cy, 9, lambda d_: (d_ < 1).astype(float))
    return done(C, H, np.clip(A, 0, 1))


def surf_sack(seed):
    """Jute sacking, plain woven (64 threads a tile), with the worn merchant's mark (a ring, a mast with a crossbar and
    a flag: a merchant's "four") of the town's sacks."""
    rng = np.random.default_rng(seed)
    w = h = P
    wv = weave(w, h, 8.0, rng)
    C = col((0.56, 0.46, 0.31)) * (0.78 + 0.26 * wv)[..., None]
    C *= (0.84 + 0.28 * fbm(rng, w, h, 4, 4))[..., None]
    H = 0.4 + 0.3 * wv
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    cx, cy = w / 2, h / 2
    d = np.hypot(uu - cx, vv - cy)
    s = w / 64
    mark = np.abs(d - 13 * s) < 1.5 * s
    mark |= (np.abs(uu - cx) < 1.3 * s) & (np.abs(vv - cy) < 10 * s)
    mark |= (np.abs(vv - (cy - 3 * s)) < 1.2 * s) & (np.abs(uu - cx) < 7 * s)
    mark |= (np.abs((uu - cx) - (vv - cy - 3 * s)) < 1.3 * s) & (uu >= cx) & (uu <= cx + 6 * s) & (vv > cy)
    mark = mark & (fbm(rng, w, h, 16, 16) < 0.62)
    C[mark] = C[mark] * 0.35 + col((0.09, 0.07, 0.05)) * 0.35
    return done(speckle(C, rng, 0.03), H, k=0.9)


# ---- crates, casks, stone, glass


def surf_crate(seed, number="N.127"):
    """The side of a packing crate fitted to the face: four pine boards across, pale worn ends, the stencilled mark (a
    diamond with a K), ANTWERPEN and a number, nail heads where the battens cross the boards (the street's crate)."""
    rng = np.random.default_rng(seed)
    w = h = P
    s, B = surf_planks(seed, (0.57, 0.46, 0.31), boards=4, butts=0.0, nails=False, n_knots=2)
    C, H = s.c, s.h
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    wear = np.clip(1 - np.minimum(uu, w - uu) / 40.0, 0, 1) * (0.5 + 0.5 * noise(rng, w, h, 40, 40))
    C = C * (1 + 0.35 * wear[..., None])
    k = w / 64
    dia = np.abs(uu - 32 * k) + np.abs(vv - 55 * k) * 1.25
    ink = col((0.07, 0.06, 0.05))
    mark = (dia > 7.5 * k) & (dia < 9.5 * k) & (noise(rng, w, h, 50, 50) < 0.7)
    C[mark] = C[mark] * 0.3 + ink * 0.6
    letters(C, rng, "K", 32 * k, 58 * k, 5, ink, keep=0.9)
    letters(C, rng, "ANTWERPEN", 32 * k, 40 * k, 5, ink, keep=0.88)
    letters(C, rng, number, 32 * k, 24 * k, 5, ink, keep=0.88)
    for u in (3, 60):
        for v in (4, 20, 36, 52):
            stamp(H, C, (u + 1) * k, (v + 1) * k, 4.5, dome(0.14, 0.06), col((0.1, 0.09, 0.08)), disc())
    return done(speckle(C, rng, 0.02, 0.8, 1.0), H)


def surf_staves(seed):
    """A cask's oak staves standing along v, 8 a tile: each rounded across, the joints dark, the grain along v."""
    rng = np.random.default_rng(seed)
    s, B = surf_planks(seed, (0.4, 0.27, 0.16), boards=8, butts=0.0, nails=False, n_knots=1)
    return Surf(s.c.transpose(1, 0, 2).copy(), s.h.T.copy())


def surf_stone(seed):
    """Dressed stone blocks (ballast, a stove's hearth): two courses a tile, half a block along from each other,
    tooled faces, the arrises knocked, sunk lime joints."""
    rng = np.random.default_rng(seed)
    w = h = P
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    r = (vv // (h / 2)).astype(int)
    us = (uu + (r % 2) * w / 4) % w
    bu = us // (w / 2)
    fu, fv = us - bu * w / 2, vv - r * h / 2
    e = np.minimum(np.minimum(fu, w / 2 - fu), np.minimum(fv, h / 2 - fv))
    tool = fbm(rng, w, h, 24, 24)
    H = 0.22 + (0.62 + 0.12 * (tool - 0.5) - 0.22) * sstep(3.0, 9.0 + 6 * noise(rng, w, h, 20, 20), e)
    tone = rng.uniform(0.88, 1.12, 8)[(r * 2 + bu).astype(int) % 8]
    C = col((0.46, 0.45, 0.42)) * (tone * (0.82 + 0.3 * tool))[..., None]
    C = mix(C, col((0.36, 0.35, 0.32)), sstep(4.0, 2.0, e))
    C *= (1 - 0.3 * sstep(9, 3, e))[..., None]
    return done(speckle(C, rng, 0.15, 0.75, 1.2), H)


def surf_glass(seed):
    """A lantern's glass, lit: amber, sooted toward the top, its frame dark at the edges. Smooth (no relief)."""
    rng = np.random.default_rng(seed)
    n = CELL
    vv = (np.arange(n) + 0.5)[:, None, None] / n
    C = np.ones((n, n, 3)) * col((0.78, 0.68, 0.46))
    C *= 1 - 0.45 * vv ** 2
    C *= (0.9 + 0.2 * noise(rng, n, n, 4, 4))[..., None]
    e = n // 16
    C[:e] = C[-e:] = 0.08
    C[:, :e] = C[:, -e:] = 0.08
    return done(C, np.full((n, n), 0.5))


# ---- metal parts with paint


def surf_funnel(seed, star=False):
    """A funnel, v up: black, plate rings lapped with rivet rows, a vertical seam, the red band (the liner: a broad
    white band with the line's red star), heat-browned and sooted toward the top."""
    rng = np.random.default_rng(seed)
    w = h = P
    k = h / 64
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    C = col((0.07, 0.065, 0.06)) * (0.85 + 0.3 * fbm(rng, w, h, 6, 6))[..., None]
    H = 0.5 + 0.02 * (fbm(rng, w, h, 20, 20) - 0.5)
    if star:
        b0, b1 = 30 * k, 48 * k
        band = (vv >= b0) & (vv < b1)
        C[band] = (col((0.72, 0.7, 0.64)) * (0.92 + 0.12 * noise(rng, w, h, 8, 8))[..., None])[band]
        cu, cv = w / 2, (b0 + b1) / 2
        a = np.arctan2(vv - cv, (uu - cu) * 0.5) - math.pi / 2
        rr = np.hypot((uu - cu) * 0.5, vv - cv)
        kk = np.cos(math.pi / 5) / np.cos((a % (2 * math.pi / 5)) - math.pi / 5)
        st = rr < 7.2 * k * (0.42 + 0.58 * (kk - np.cos(math.pi / 5)) / (1 - np.cos(math.pi / 5)))
        C[band & st] = col((0.55, 0.06, 0.05))
        rings = (10, 22, 30, 48, 56)
    else:
        band = (vv >= 36 * k) & (vv < 46 * k)
        C[band] = (col((0.42, 0.08, 0.06)) * (0.9 + 0.15 * noise(rng, w, h, 8, 8))[..., None])[band]
        rings = (10, 22, 34, 48)
    for r_ in rings:
        y = r_ * k
        d = vv - y
        H += 0.1 * sstep(-1.0, 1.5, d) * sstep(12.0, 9.0, d) - 0.05 * sstep(-3, -0.5, d) * sstep(0.5, -0.5, d)
        C *= (1 - 0.45 * (sstep(-3.0, -0.5, d) * sstep(0.5, -0.5, d)))[..., None]
        x = rng.uniform(0, 14)
        while x < w:
            stamp(H, C, x, y + 4, 2.8, dome(0.2, 0.06), col((0.11, 0.1, 0.09)), lambda d_: 0.6 * sstep(1, 0.3, d_))
            x += 14
    for sx in (0.0, 0.5):
        x = sx * w + 2
        y = 4.0
        while y < h:
            stamp(H, C, x + 5, y, 2.8, dome(0.2, 0.06), col((0.11, 0.1, 0.09)), lambda d_: 0.6 * sstep(1, 0.3, d_))
            y += 14
        C[:, int(x)] *= 0.6
    heat = sstep(44 * k, 60 * k, vv) * noise(rng, w, h, 6, 4)
    C = mix(C, col((0.2, 0.13, 0.09)), heat * 0.3)
    soot = sstep(50 * k, 64 * k, vv) if not star else sstep(52 * k, 64 * k, vv)
    C *= (1 - 0.55 * soot)[..., None]
    for _ in range(18):
        run_down(H, C, rng, rng.uniform(0, w), rng.uniform(40, 60) * k, rng.uniform(20, 80), 2.0, col((0.03, 0.03, 0.03)), 0.5)
    return done(speckle(C, rng, 0.04), H, k=0.8)


def surf_window(seed):
    """A deckhouse window: a cream-painted frame and a cross bar round four dark panes, the putty's bevel, a shine."""
    rng = np.random.default_rng(seed)
    n = P
    k = n / 32
    uu, vv = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    fr = np.ones((n, n), bool)
    fr[int(3 * k):int(n - 3 * k), int(3 * k):int(n - 3 * k)] = False
    fr[int(15 * k):int(17 * k)] = True
    fr[:, int(15 * k):int(17 * k)] = True
    C = col((0.56, 0.53, 0.46)) * (0.86 + 0.25 * fbm(rng, n, n, 8, 8))[..., None]
    dist = blur((~fr).astype(float), 6)
    H = 0.4 + 0.26 * np.clip(1 - dist * 1.4, 0, 1)
    pane = ~fr
    glass = col((0.04, 0.05, 0.06)) * (0.9 + 0.2 * noise(rng, n, n, 3, 3))[..., None]
    sh = np.exp(-(((uu - vv) / n - 6 / 32) / 0.05) ** 2) * 0.13
    C[pane] = (glass + sh[..., None] * col((1.0, 1.05, 1.1)))[pane]
    C *= (1 - 0.35 * (np.clip(dist, 0, 1) * (1 - np.clip(dist, 0, 1)) * 4 * fr))[..., None]
    chips = sstep(0.82, 0.86, fbm(rng, n, n, 12, 12)) * fr
    C = mix(C, col((0.3, 0.26, 0.2)), chips)
    H -= 0.05 * chips
    return done(speckle(C, rng, 0.02, 0.85, 1.1), H, k=0.8)


def surf_hatch(seed):
    """Hatch boards across the ship (columns): tarred, weathered at the joints."""
    rng = np.random.default_rng(seed)
    s, B = surf_planks(seed, (0.2, 0.16, 0.12), boards=2, butts=0.0, nails=False, n_knots=1)
    C = s.c.transpose(1, 0, 2).copy()
    H = s.h.T.copy()
    wear = sstep(0.62, 0.85, fbm(rng, P, P, 6, 6))
    C = mix(C, col((0.33, 0.3, 0.26)), wear * 0.35)
    return done(C, H)


def surf_heap(seed, base, coal=True):
    """A heap seen from above. Coal: lumps of all sizes with their facets and glints; sand: fine grain, ripples and the
    wet dark where it was rained on."""
    rng = np.random.default_rng(seed)
    w = h = P
    if coal:
        H = np.full((h, w), 0.2)
        C = np.ones((h, w, 3)) * col(base)
        for _ in range(900):
            r = rng.uniform(6, 26) * rng.uniform(0.5, 1.0)
            rx = r * rng.uniform(0.7, 1.3)
            x, y = rng.uniform(0, w), rng.uniform(0, h)
            hb = rng.uniform(0.35, 0.8)
            facet = rng.uniform(0.6, 1.4)
            xs = np.arange(int(x - rx) - 1, int(x + rx) + 2)
            ys = np.arange(int(y - r) - 1, int(y + r) + 2)
            X, Y = np.meshgrid(xs, ys)
            hh = hb * np.clip(1 - np.hypot((X + 0.5 - x) / rx, (Y + 0.5 - y) / r) ** 1.6, 0, 1)
            ix = np.ix_(ys % h, xs % w)
            win, cw = H[ix], C[ix]
            m = hh > win
            win[m] = hh[m]
            cw[m] = col(base) * facet
            H[ix], C[ix] = win, cw
        H = blur(H, 1)
        gy, gx = np.gradient(H)
        lit = np.clip(0.5 - 6 * gx - 6 * gy, 0, 1)
        C *= (0.6 + 0.8 * lit)[..., None]
        glint = (rng.random((h, w)) < 0.004) & (lit > 0.6)
        C[glint] = col((0.32, 0.32, 0.34))
        return done(C, H, k=1.0)
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    rip = np.sin(2 * np.pi * (vv / 46.0 + 1.2 * noise(rng, w, h, 3, 3))) * 0.5 + 0.5
    grain = noise(rng, w, h, 128, 128)
    H = 0.45 + 0.18 * rip + 0.1 * (grain - 0.5)
    C = col(base) * (0.82 + 0.14 * rip + 0.18 * grain)[..., None]
    wet = sstep(0.5, 0.7, fbm(rng, w, h, 4, 4))
    C *= (1 - 0.3 * wet)[..., None]
    for _ in range(40):
        stamp(H, C, rng.uniform(0, w), rng.uniform(0, h), rng.uniform(2, 6), lambda d: 0.1 * np.clip(1 - d, 0, 1),
              col(base) * 0.7, disc(0.5))
    return done(speckle(C, rng, 0.08, 0.6, 1.4), H, k=0.8)


def surf_streaks(seed):
    """Rust and soot running down a hull or a wall under a fitting, cut out: dark tapering runs."""
    rng = np.random.default_rng(seed)
    n = P
    C = np.zeros((n, n, 3))
    A = np.zeros((n, n))
    H = np.full((n, n), 0.5)
    for _ in range(9):
        u = rng.uniform(32, n - 32)
        ln = rng.uniform(n / 3, n - 16)
        wd = rng.uniform(5, 14)
        rust = rng.random() < 0.7
        c = col((0.34, 0.15, 0.07)) if rust else col((0.05, 0.045, 0.04))
        for k in range(0, int(ln), 2):
            t = k / ln
            ww = max(3.0, wd * (1 - t) + 2)
            u += rng.normal(0, 0.5)
            stamp(A, C, u, n - 10 - k, ww, lambda d: sstep(1.0, 0.7, d), c * (0.8 + 0.4 * rng.random()), lambda d: sstep(1.0, 0.6, d), rx=ww * 0.5)
    return done(C, H, np.clip(A, 0, 1))


def surf_bilge(seed):
    """Bilge boards under a film of foul water in an old boat: the boards and their seams dim under it, a scum in
    clots, straws, an oily sheen. Nearly level (the water's face)."""
    rng = np.random.default_rng(seed)
    w = h = P
    s, B = surf_planks(seed, (0.12, 0.11, 0.075), boards=3, butts=0.2, nails=True, n_knots=1)
    C = mix(s.c, col((0.07, 0.08, 0.05)), 0.55)
    C *= (0.75 + 0.5 * fbm(rng, w, h, 5, 5))[..., None]
    H = 0.5 + (s.h - 0.5) * 0.15
    sheen = sstep(0.55, 0.8, noise(rng, w, h, 3, 5))
    C = mix(C, col((0.13, 0.14, 0.14)), sheen * 0.35)
    for _ in range(26):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        for _ in range(int(rng.integers(3, 12))):
            stamp(H, C, cx + rng.normal(0, 10), cy + rng.normal(0, 8), rng.uniform(2, 6), lambda d: 0.06 * np.clip(1 - d, 0, 1),
                  col((0.22, 0.22, 0.16)) * rng.uniform(0.8, 1.2), disc(0.5))
    for _ in range(12):
        x, y, a = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(0, math.pi)
        for t in range(0, int(rng.uniform(20, 60)), 2):
            stamp(H, C, x + t * math.cos(a), y + t * math.sin(a), 1.4, lambda d: 0.04 * np.clip(1 - d, 0, 1), col((0.45, 0.4, 0.24)), disc(0.4))
    return done(C, H)


def surf_washing(seed):
    """Washing: four cloths, one a quarter: linen, a blue check shirt, a faded red cloth, a striped sheet; the weave,
    hanging folds."""
    rng = np.random.default_rng(seed)
    n = P
    q = n // 2
    uu, vv = np.meshgrid(np.arange(q), np.arange(q))
    c = q / 32
    quarters = [col((0.78, 0.76, 0.68)) * np.ones((q, q, 3)),
                np.where((((uu // (4 * c)) + (vv // (4 * c))) % 2 == 0)[..., None], col((0.3, 0.36, 0.48)), col((0.6, 0.62, 0.64))),
                col((0.52, 0.2, 0.16)) * np.ones((q, q, 3)),
                np.where(((uu // (3 * c)) % 3 == 0)[..., None], col((0.35, 0.4, 0.5)), col((0.76, 0.74, 0.66)))]
    C = np.zeros((n, n, 3))
    C[q:, :q], C[q:, q:], C[:q, :q], C[:q, q:] = quarters
    fold = 0.5 + 0.5 * np.sin(2 * np.pi * (np.arange(n)[None, :] / (n / 6) + noise(rng, n, n, 3, 2) * 0.6))
    C *= (0.78 + 0.22 * fold + 0.15 * (fbm(rng, n, n, 8, 8) - 0.5))[..., None]
    wv = weave(n, n, 4.0, rng)
    C *= (0.95 + 0.06 * wv)[..., None]
    return done(C, 0.5 + 0.2 * (fold - 0.5) + 0.02 * (wv - 0.5))


def surf_flag(seed):
    """Eight flags, v up, each a 16 x 16 square of a 64 x 32 picture, stretched to the flag's own shape by the quad.
    Top row: the white house flag with a red star, the Norwegian (red, a blue cross edged white), the Danish (red, a
    white cross), plain red (pennants). Bottom row: the Dutch, the Belgian, the German merchant flag (black, white,
    red) and the British red ensign. Muted colours, the bunting's weave. Smooth (cloth)."""
    rng = np.random.default_rng(seed)
    w, h = P, P // 2
    k = w / 64
    C = np.zeros((h, w, 3))
    red, white, blue = col((0.5, 0.07, 0.06)), col((0.78, 0.76, 0.7)), col((0.12, 0.18, 0.36))
    black, yellow = col((0.05, 0.05, 0.05)), col((0.66, 0.54, 0.16))

    def region(u0, v0):
        """The flag at (u0, v0) units: its slice of C and its own coordinates fx (hoist 0 to fly 1), fy (0 bottom)."""
        sl = C[int(v0 * k):int((v0 + 16) * k), int(u0 * k):int((u0 + 16) * k)]
        n = sl.shape[0]
        fx, fy = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n)
        return sl, fx, fy

    def cross(sl, fx, fy, x0, x1, y0, y1, c):
        sl[((fx >= x0) & (fx < x1)) | ((fy >= y0) & (fy < y1))] = c

    # the house flag
    sl, fx, fy = region(0, 16)
    sl[:] = white
    a = np.arctan2(fy - 0.5, (fx - 0.5) * 1.5) - math.pi / 2
    r = np.hypot((fx - 0.5) * 1.5, fy - 0.5)
    kk = np.cos(math.pi / 5) / np.cos((a % (2 * math.pi / 5)) - math.pi / 5)
    sl[r < 0.39 * (0.45 + 0.55 * (kk - np.cos(math.pi / 5)) / (1 - np.cos(math.pi / 5)))] = red
    # Norway: 6-1-2-1-12 across, 6-1-2-1-6 down
    sl, fx, fy = region(16, 16)
    sl[:] = red
    cross(sl, fx, fy, 6 / 22, 10 / 22, 6 / 16, 10 / 16, white)
    cross(sl, fx, fy, 7 / 22, 9 / 22, 7 / 16, 9 / 16, blue)
    # Denmark: 12-4-21 across, 12-4-12 down
    sl, fx, fy = region(32, 16)
    sl[:] = red
    cross(sl, fx, fy, 12 / 37, 16 / 37, 12 / 28, 16 / 28, white)
    # plain red, for pennants
    region(48, 16)[0][:] = red
    # the Netherlands
    sl, fx, fy = region(0, 0)
    sl[:] = blue
    sl[fy >= 1 / 3] = white
    sl[fy >= 2 / 3] = red
    # Belgium
    sl, fx, fy = region(16, 0)
    sl[:] = black
    sl[fx >= 1 / 3] = yellow
    sl[fx >= 2 / 3] = red
    # the German merchant flag (1867)
    sl, fx, fy = region(32, 0)
    sl[:] = red
    sl[fy >= 1 / 3] = white
    sl[fy >= 2 / 3] = black
    # the red ensign: the union in the upper hoist quarter
    sl, fx, fy = region(48, 0)
    sl[:] = red
    cu, cv = fx / 0.5, (fy - 0.5) / 0.5  # 0..1 inside the canton
    inside = (fx < 0.5) & (fy >= 0.5)
    un = np.zeros(fx.shape, dtype=int)  # 0 blue, 1 white, 2 red
    d1, d2 = np.abs(cu - cv), np.abs(cu + cv - 1)
    un[(d1 < 0.12) | (d2 < 0.12)] = 1
    un[(d1 < 0.05) | (d2 < 0.05)] = 2
    un[(np.abs(cu - 0.5) < 0.15) | (np.abs(cv - 0.5) < 0.17)] = 1
    un[(np.abs(cu - 0.5) < 0.08) | (np.abs(cv - 0.5) < 0.1)] = 2
    for i, c_ in enumerate((blue, white, red)):
        sl[inside & (un == i)] = c_
    C *= (0.85 + 0.25 * noise(rng, w, h, 8, 4))[..., None]
    wv = weave(w, h, 4.0, rng)
    C *= (0.96 + 0.05 * wv)[..., None]
    return done(C, np.full((h, w), 0.5))


FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    " ": ["00000"] * 7,
    # figures (the crane's cast plate)
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
}
# rows of the name texture (row 0 at the top); name_board() picks one
NAME_ROWS = ["ELISABETH", "ANTWERPEN", "SCHELDE", "HERCULES", "DE HOOP", "NOORDSTER", "ST ANNA", "ZWALUW"]
NAME_ROWS2 = ["ANNA MARIA", "ANTWERPEN", "BRIG", "", "", "", "", ""]
# the ocean steamer at anchor (liner): her name and port (a -land name, as the line of 1873 gave them)
NAME_ROWS3 = ["KEMPENLAND", "ANTWERPEN", "", "", "", "", "", ""]
# M7 boats: home ports on the sterns of the barges and lighters, two barge names, the water police's gig
NAME_ROWS4 = ["ANTWERPEN", "BOOM", "TEMSE", "LILLO", "DOEL", "DRIE GEBR", "JOZEF", "POLITIE"]


def surf_names(seed, rows=None):
    """Ship names in painted letters, eight rows (row 0 at the top): cream on black, the paint's brush and wear. Flat:
    lettering has no relief (world/bumps.ts flatLettering). Laid out as before at four times the size."""
    rng = np.random.default_rng(seed)
    n = P
    C = col((0.05, 0.045, 0.04)) * (0.8 + 0.4 * noise(rng, n, n, 16, 16))[..., None] * np.ones((n, n, 1))
    ink = col((0.8, 0.72, 0.52))
    s = n / 128
    for r, text in enumerate(rows or NAME_ROWS):
        letters(C, rng, text, n / 2, n - 16 * s * r - 2 * s, int(2 * s), ink, adv=12 * s)
        y = int(n - 16 * s * (r + 1))
        C[y:y + int(s)] *= 0.5
    C *= (0.92 + 0.12 * noise(rng, n, n, 60, 6))[..., None]
    return done(C, np.full((n, n), 0.5))


CRANE_BOARD = ["ANTWERPEN", "3000 KIL."]


def surf_crane_board(seed):
    """The crane's cast plate: cream letters and a rim on black (2:1). Flat, as lettering is."""
    rng = np.random.default_rng(seed)
    w, h = P, P // 2
    C = col((0.06, 0.055, 0.05)) * (0.8 + 0.4 * noise(rng, w, h, 16, 8))[..., None] * np.ones((h, w, 1))
    ink = col((0.74, 0.68, 0.52))
    s = w / 128
    for r, text in enumerate(CRANE_BOARD):
        letters(C, rng, text, w / 2, h - 8 * s - 26 * s * r, int(2 * s), ink, adv=12 * s)
    e = int(3 * s)
    C[:e] = C[-e:] = ink * 0.75
    C[:, :e] = C[:, -e:] = ink * 0.75
    return done(C, np.full((h, w), 0.5))


def surf_crane_plate(seed):
    """Riveted plate of the portal crane (4:1, u along the member, v across a face): painted iron gone rusty at the
    rivets and the edges, a row of rivets along each edge, the flange angles' toes, a butt strap at u = 0."""
    rng = np.random.default_rng(seed)
    w, h = 4 * P // 2, P // 2
    k = w / 128
    C = col((0.15, 0.15, 0.155)) * (0.84 + 0.3 * noise(rng, w, h, 16, 4))[..., None] * np.ones((h, w, 1))
    rust = np.clip((noise(rng, w, h, 12, 3) - 0.63) * 2.8, 0, 1)
    C = mix(C, col((0.27, 0.16, 0.1)), rust)
    H = np.full((h, w), 0.5) + 0.03 * (noise(rng, w, h, 40, 10) - 0.5)
    vv = (np.arange(h) + 0.5)[:, None]
    for r in (6 * k, h - 7 * k):
        d = np.abs(vv - r)
        C *= (1 - 0.45 * sstep(k, 0, d))[..., None] * np.ones((1, w, 1))
        H = H - 0.1 * sstep(k, 0, d)
    C[:int(2 * k)] *= 0.72
    C[-int(2 * k):] *= 0.72
    C[:, :int(12 * k)] *= 1.1
    H[:, :int(12 * k)] += 0.08
    C[:, int(12 * k)] *= 0.5

    def rivet(u, v):
        stamp(H, C, u, v, 0.55 * k, dome(0.25, 0.08), col((0.3, 0.29, 0.28)), lambda d: 0.7 * sstep(1, 0.3, d))
        if rng.random() < 0.3:
            run_down(H, C, rng, u, v - k, 4 * k, 0.6 * k, col((0.34, 0.17, 0.08)), 0.6)

    for u in np.arange(4, 128, 7):
        rivet(u * k, 3.5 * k)
        rivet(u * k, h - 3.5 * k)
    for v in np.arange(9, 32 - 8, 4):
        rivet(3.5 * k, v * k)
        rivet(9.5 * k, v * k)
    return done(speckle(C, rng, 0.03, 0.6, 1.2), H, k=0.9)


def surf_chequer(seed):
    """Chequer plate for the crane's gallery: raised bars turned a quarter from cell to cell (8 cells a tile), worn
    bright on top, rust in the hollows."""
    rng = np.random.default_rng(seed)
    n = P
    cs = n / 8
    uu, vv = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    iu, iv = uu // cs, vv // cs
    fu, fv = (uu - iu * cs) / cs - 0.5, (vv - iv * cs) / cs - 0.5
    flip = ((iu + iv) % 2 == 1)
    a = np.where(flip, fu + fv, fu - fv) / np.sqrt(2)
    b = np.where(flip, fu - fv, fu + fv) / np.sqrt(2)
    bar = np.clip(1 - (np.abs(b) / 0.09) ** 2, 0, 1) * sstep(0.36, 0.3, np.abs(a))
    prof = np.sqrt(bar)
    H = 0.42 + 0.45 * prof
    C = col((0.17, 0.17, 0.175)) * (0.85 + 0.3 * fbm(rng, n, n, 8, 8))[..., None]
    rust = sstep(0.6, 0.75, fbm(rng, n, n, 5, 5)) * (1 - prof)
    C = mix(C, col((0.29, 0.17, 0.1)), rust)
    C = mix(C, col((0.36, 0.36, 0.35)), prof * 0.8)
    return done(speckle(C, rng, 0.03), H)


def surf_lattice(seed):
    """A lattice girder's side, cut out: flanges top and bottom, posts and diagonals, rivets at the joints, rust."""
    rng = np.random.default_rng(seed)
    n = P
    k = n / 64
    C = col((0.1, 0.1, 0.105)) * (0.8 + 0.4 * fbm(rng, n, n, 8, 8))[..., None] * np.ones((n, n, 1))
    rust = np.clip((fbm(rng, n, n, 6, 6) - 0.55) * 3, 0, 1)
    C = mix(C, col((0.3, 0.15, 0.08)), rust)
    uu, vv = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    A = np.zeros((n, n))
    A[:int(5 * k)] = A[-int(5 * k):] = 1
    for u in (0, 32):
        A[:, max(0, int((u - 2) * k)):int((u + 2) * k)] = 1
    A[:, int(62 * k):] = 1
    for u0 in (0, 32):
        d1 = np.abs((uu / k - u0) - (vv / k - 4) * 32 / 55)
        d2 = np.abs((uu / k - u0 - 32) + (vv / k - 4) * 32 / 55)
        A[((d1 < 1.6) | (d2 < 1.6)) & (uu / k >= u0) & (uu / k < u0 + 32)] = 1
    H = 0.45 + 0.1 * blur(A, 3)
    for x in (2 * k, 32 * k, n - 2 * k):
        for y in (2.5 * k, n - 2.5 * k):
            for dx in (-2.5 * k, 2.5 * k):
                stamp(H, C, x + dx, y, 0.9 * k, dome(0.2, 0.05), col((0.16, 0.15, 0.15)), disc())
    return done(speckle(C, rng, 0.03), H, A)


def surf_ports(seed, w_m=8.0, h_m=0.55):
    """The strip of iron hull with round brass-rimmed portholes, one every 2 m (8 m by 0.55 m a tile): rivet rows at
    the laps above and below, rust run down from under each port."""
    rng = np.random.default_rng(seed)
    w, h = 2 * P, P // 4
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    mu, mv = w_m / w, h_m / h
    C = col((0.13, 0.125, 0.13)) * (0.84 + 0.3 * noise(rng, w, h, 32, 4))[..., None]
    H = 0.5 + 0.03 * (noise(rng, w, h, 40, 6) - 0.5)
    for frac in (0.125, 0.375, 0.625, 0.875):
        cu = frac * w
        d = np.hypot((uu - cu) * mu, (vv - h / 2) * mv)
        rim = (d < 0.19) & (d >= 0.14)
        C[rim] = (col((0.36, 0.28, 0.14)) * (0.8 + 0.4 * noise(rng, w, h, 60, 8))[..., None])[rim]
        H += 0.22 * sstep(0.2, 0.18, d) * sstep(0.13, 0.15, d)
        glass = d < 0.14
        C[glass] = col((0.04, 0.05, 0.06))
        H -= 0.12 * sstep(0.145, 0.13, d)
        shine = glass & (np.abs(((uu - cu) * mu) - ((vv - h / 2) * mv) + 0.03) < 0.02)
        C[shine] = col((0.2, 0.22, 0.24))
        for k in range(10):
            x = cu + rng.normal(0, 0.06) / mu
            run_down(H, C, rng, x, h / 2 - 0.19 / mv, rng.uniform(0.05, 0.2) / mv, 1.5, col((0.3, 0.14, 0.07)), 0.45, wander=0.2)
    for y in (3.0, h - 3.0):
        x = rng.uniform(0, 5)
        while x < w:
            stamp(H, C, x, y, 1.6, dome(0.2, 0.05), col((0.12, 0.11, 0.11)), disc())
            x += 0.075 / mu
    C[:2] *= 0.4
    C[-2:] *= 0.4
    return done(C, H, k=0.9)


def surf_band(seed):
    """A sailing ship's painted port band (strip): cream, with black painted ports, dark lines top and bottom."""
    rng = np.random.default_rng(seed)
    w, h = 2 * P, P // 4
    k = w / 128
    C = col((0.7, 0.68, 0.6)) * (0.9 + 0.1 * noise(rng, w, h, 16, 2) + 0.06 * noise(rng, w, h, 128, 8))[..., None]
    vv = (np.arange(h) + 0.5)[:, None]
    H = 0.5 + 0.02 * (noise(rng, w, h, 100, 10) - 0.5) - 0.1 * sstep(2.0, 0.0, np.abs(vv - h / 2)) * np.ones((1, w))
    C *= (1 - 0.3 * sstep(2.0, 0.0, np.abs(vv - h / 2)))[..., None]
    for cu in (32 * k, 96 * k):
        C[int(h * 4 / 16):int(h * 12 / 16), int(cu - 7 * k):int(cu + 7 * k)] = col((0.05, 0.05, 0.05))
        C[int(h * 3 / 16):int(h * 4 / 16), int(cu - 7 * k):int(cu + 7 * k)] *= 0.6
    runs = sstep(0.6, 0.9, noise(rng, w, h, 60, 2))
    C = mix(C, col((0.3, 0.27, 0.22)), runs * 0.3)
    e = max(2, int(h / 16))
    C[:e] = C[-e:] = col((0.06, 0.06, 0.06))
    return done(C, H)


# ---- the painters by material; the ferry's own materials come from build_ferry.py

SURF = {
    "wood": lambda: surf_planks(1, (0.43, 0.37, 0.29), boards=4, n_knots=3)[0],
    "wood_dark": lambda: surf_planks(2, (0.25, 0.19, 0.14), boards=2, seams=False, nails=False, n_knots=1, checks=26)[0],
    "iron": lambda: surf_iron(3),
    "rope": lambda: surf_rope(4),
    "sackcloth": lambda: surf_sack(5),
    "crate": lambda: surf_crate(6),
    "barrel": lambda: surf_staves(7),
    "stone": lambda: surf_stone(8),
    "glass": lambda: surf_glass(9),
    "tar": lambda: surf_tar(101),
    "clinker": lambda: surf_clinker(102),
    "iron_hull": lambda: surf_iron_hull(103),
    "iron_ports": lambda: surf_ports(104),
    "band": lambda: surf_band(105),
    "copper": lambda: surf_copper(106),
    "redlead": lambda: surf_iron_hull(107, paint=(0.36, 0.12, 0.075), under=(0.1, 0.1, 0.1), red=True),
    "deck": lambda: surf_deck(108),
    "paint_green": lambda: surf_painted(109, (0.11, 0.22, 0.16), 2, (0.3, 0.25, 0.18), chip=0.55),
    "paint_white": lambda: surf_painted(110, (0.66, 0.64, 0.57), 4, (0.36, 0.34, 0.3), chip=0.6, streak=0.14),
    "canvas": lambda: surf_canvas(111, (0.66, 0.63, 0.55)),
    "canvas_tan": lambda: surf_canvas(112, (0.42, 0.26, 0.15), tan=True),
    "rigging": lambda: surf_rope(113, base=(0.14, 0.11, 0.08)),
    "shrouds": lambda: surf_shrouds(114),
    "lattice": lambda: surf_lattice(115),
    "funnel": lambda: surf_funnel(116),
    "window": lambda: surf_window(117),
    "hatch": lambda: surf_hatch(118),
    "tarp": lambda: surf_tarp(119),
    "flag": lambda: surf_flag(120),
    "names": lambda: surf_names(121),
    "washing": lambda: surf_washing(122),
    "names2": lambda: surf_names(123, NAME_ROWS2),
    "funnel_star": lambda: surf_funnel(124, star=True),
    "names3": lambda: surf_names(125, NAME_ROWS3),
    "tar_weed": lambda: surf_tar_weed(126),
    "names4": lambda: surf_names(127, NAME_ROWS4),
    "netting": lambda: surf_netting(128),
    "coal": lambda: surf_heap(129, (0.06, 0.06, 0.065)),
    "sand": lambda: surf_heap(130, (0.42, 0.36, 0.25), coal=False),
    "streaks": lambda: surf_streaks(131),
    "bilge": lambda: surf_bilge(132),
    "varnish": lambda: surf_varnish(133),
    "hood": lambda: surf_canvas(134, (0.44, 0.4, 0.33), gaskets=False),
    "crane_plate": lambda: surf_crane_plate(135),
    "chequer": lambda: surf_chequer(136),
    "cabin_planks": lambda: surf_painted(137, (0.31, 0.27, 0.22), 4, (0.4, 0.31, 0.21), chip=0.58, transpose=True),
    "crane_board": lambda: surf_crane_board(138),
}
# how much relief a picture from build_ferry.py gets (its height made from its own light: the bump rule)
FERRY_RELIEF = {"fan": 0.6, "ferry_band": 0.35, "float_slime": 1.0, "notice": 0.0, "wet": 0.6, "lifebuoy": 0.4,
                "stage_deck": 1.0, "lamp_glass": 0.0}


def to_cell(s):
    """A painted Surf at CELL x CELL (a strip or a 2:1 picture stretched to the square cell, as the game's uv do)."""
    def fit(a):
        return None if a is None else resize(a, CELL, CELL)
    return Surf(fit(s.c), fit(s.h), fit(s.a))


def height_from_light(c, k):
    """A picture's height from its own light (the bump rule for a picture painted without one): light high, dark low,
    its own level round each texel taken off."""
    lum = c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11
    hp = lum - blur(blur(lum, CELL // 16), CELL // 16)
    top = np.percentile(np.abs(hp), 98) or 1.0
    return np.clip(0.5 + 0.5 * k * hp / top, 0, 1)


def ferry_surfs():
    """The ferry's own materials (build_ferry.py NEW, its painters PAINT), each at CELL with a height from its light.
    {} when build_ferry cannot be read (the ferry then draws those parts grey)."""
    try:
        import build_ferry as bf  # noqa: PLC0415  (it imports build_boats: read here, when the build runs)
    except Exception as e:  # noqa: BLE001
        print(f"[boats] the ferry's materials not in the atlas: {e}")
        return {}
    out = {}
    for k, name in enumerate(bf.NEW):
        res = bf.PAINT[name](701 + k)
        arr, alpha = res if isinstance(res, tuple) else (res, None)
        c = resize(np.clip(arr, 0, 1), CELL, CELL)
        a = None if alpha is None else resize(alpha, CELL, CELL)
        out[name] = Surf(c, height_from_light(c, FERRY_RELIEF.get(name, 0.6)), a)
    return out


def png_write(path, arr):
    """An 8-bit PNG (grey [h, w] or RGB(A) [h, w, 3|4], values 0..1, row 0 the top), each row filtered by the one
    above (PNG filter 2): our own writer, as Blender has none for one grey channel."""
    import struct  # noqa: PLC0415
    import zlib  # noqa: PLC0415
    a = np.clip(np.round(np.asarray(arr) * 255), 0, 255).astype(np.uint8)
    if a.ndim == 2:
        a = a[..., None]
    h, w, ch = a.shape
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    rows = a.reshape(h, w * ch).astype(np.int16)
    up = np.vstack([np.zeros((1, w * ch), np.int16), rows[:-1]])
    filt = ((rows - up) % 256).astype(np.uint8)
    raw = np.hstack([np.full((h, 1), 2, np.uint8), filt]).tobytes()

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def write_atlas(cells):
    """The boat atlas: every material's CELL in an ATLAS_N x ATLAS_N picture, in MATS order and then the ferry's, the
    last cell a plain grey for a material it does not know. Writes boats_atlas.webp (colour, cut-out in alpha),
    boats_atlas_h.png (height, grey) and boats_atlas.json ({"n", "cell", "cells": {name: [column, row from the
    top]}, "missing"}) into client/public/textures/."""
    N, S_ = ATLAS_N, CELL
    names = list(cells)
    if len(names) > N * N - 1:
        raise RuntimeError(f"boat atlas: {len(names)} materials, room for {N * N - 1}")
    W = N * S_
    colour = np.ones((W, W, 4)) * np.array([0.35, 0.35, 0.35, 1.0])
    height = np.full((W, W), 0.5)
    where = {}
    for i, name in enumerate(names):
        c, r = i % N, i // N
        s = cells[name]
        # rows of the arrays run bottom-up; the atlas is laid out from the top (as the game reads it)
        y0 = W - (r + 1) * S_
        colour[y0:y0 + S_, c * S_:(c + 1) * S_, :3] = s.c
        if s.a is not None:
            colour[y0:y0 + S_, c * S_:(c + 1) * S_, 3] = s.a
        height[y0:y0 + S_, c * S_:(c + 1) * S_] = s.h
        where[name] = [c, r]
    os.makedirs(ATLAS_DIR, exist_ok=True)
    img = bpy.data.images.new("boats_atlas", W, W, alpha=True)
    img.pixels.foreach_set(colour.astype(np.float32).ravel())
    img.file_format = "WEBP"
    path = os.path.join(ATLAS_DIR, "boats_atlas.webp")
    img.filepath_raw = path
    img.save(filepath=path, quality=90)
    bpy.data.images.remove(img)
    png_write(os.path.join(ATLAS_DIR, "boats_atlas_h.png"), height[::-1])
    with open(os.path.join(ATLAS_DIR, "boats_atlas.json"), "w", encoding="utf-8") as f:
        json.dump({"about": "the boat atlas, made by tools/blender/boats/common.py write_atlas: column, row from the top",
                   "n": N, "cell": S_, "cells": where, "missing": [N - 1, N - 1]}, f, separators=(",", ":"))
    print(f"[boats] atlas: {len(names)} materials -> {path} ({os.path.getsize(path) // 1024} KB), height "
          f"{os.path.getsize(os.path.join(ATLAS_DIR, 'boats_atlas_h.png')) // 1024} KB")


# the pictures of this run (painting them takes a while: build_lock and build_bridges call make_materials too)
_CELLS = {}


def cells_painted():
    if not _CELLS:
        for name in MATS:
            if name in SURF:
                _CELLS[name] = to_cell(SURF[name]())
        _CELLS.update({k: v for k, v in ferry_surfs().items() if k not in _CELLS})
    return _CELLS


def glb_picture(name):
    """A material's picture for the glb (IMG_PX): (colour, alpha or None), rows bottom-up."""
    s = cells_painted()[name]
    f = max(1, CELL // IMG_PX[0])
    return down(s.c, f), (None if s.a is None else down(s.a, f))


# the painters by their old names (build_ferry.py paints its copies of our materials with them): the glb picture
def _old(name):
    def paint(*_a, **_k):
        c, a = glb_picture(name)
        return c if a is None else (c, a)
    return paint


paint_tar, paint_iron_hull, paint_white, paint_rigging = _old("tar"), _old("iron_hull"), _old("paint_white"), _old("rigging")
paint_funnel, paint_window, paint_flag, paint_names = _old("funnel"), _old("window"), _old("flag"), _old("names")


def paint_metal(seed, *_a, **_k):
    c, _ = glb_picture("copper" if seed == 106 else "redlead")
    return c


def paint_canvas(seed, *_a, **_k):
    c, _ = glb_picture({111: "canvas", 112: "canvas_tan"}.get(seed, "hood"))
    return c


def image_rgba(name, arr, alpha=None):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    if alpha is not None:
        rgba[..., 3] = alpha
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_materials():
    """The boat materials (MATS), each with its glb picture and, for Blender's own pictures, its height as a bump;
    and the boat atlas the game draws them from (write_atlas)."""
    cells = cells_painted()
    write_atlas(cells)
    for name in MATS:
        c, alpha = glb_picture(name)
        img = image_rgba(f"{name}_tex", c, alpha)
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Linear"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha is not None:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0
        if IMG_PX[0] == CELL:
            # (previews only: the glb takes no bump node, and the game reads the atlas's height)
            hs = cells[name].h
            himg = image_rgba(f"{name}_h", np.repeat(hs[..., None], 3, axis=2))
            himg.colorspace_settings.name = "Non-Color"
            th = nt.nodes.new("ShaderNodeTexImage")
            th.image = himg
            th.interpolation = "Linear"
            bump = nt.nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 0.6
            bump.inputs["Distance"].default_value = 0.004
            nt.links.new(th.outputs["Color"], bump.inputs["Height"])
            nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    cap = bpy.data.materials.new("cap")
    t = cap.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = image_rgba("cap_tex", np.zeros((1, 1, 3)))
    for m in bpy.data.materials:
        m.use_backface_culling = m.name not in THIN


# ------------------------------------------------------------------ helpers


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def cl(x, a=0.0, b=1.0):
    return min(b, max(a, x))


def table(tab, u):
    for (u0, v0), (u1, v1) in zip(tab, tab[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * cl((u - u0) / max(u1 - u0, 1e-9))
    return tab[-1][1]


def V(x, y, z):
    return Vector((x, y, z))


def mirror(p, sx):
    return Vector((p.x * sx, p.y, p.z))


def to_object(m, name, parent=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    m.bm.to_mesh(me)
    m.bm.free()
    for mt in MATS:
        me.materials.append(bpy.data.materials[mt])
    try:
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except (KeyError, AttributeError):
        pass
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    if getattr(m, "lines", None):
        flat = [round(c, 3) for a, b in m.lines for c in (a.x, a.y, a.z, b.x, b.y, b.z)]
        ob["rig"] = json.dumps(flat, separators=(",", ":"))
    if getattr(m, "smoke", None):
        ob["smoke"] = json.dumps([round(c, 3) for p in m.smoke for c in (p.x, p.y, p.z)])
    for k, v in (getattr(m, "extras", None) or {}).items():
        ob[k] = json.dumps(v, separators=(",", ":"))
    return ob


def cap_object(hull, name, parent):
    """The water cap: an invisible lid over the hull at its rail. The game draws it before the
    water into the stencil, and the water leaves those pixels alone, so it never shows inside a
    hull (open boats, holds, low decks in a swell). Material "cap", one n-gon."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in hull.rim()]
    try:
        f = bm.faces.new(vs)
        if f.normal.z < 0:
            f.normal_flip()
    except ValueError:
        pass
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["cap"])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


class Hull:
    """A lofted hull. Stations t run 0 (stern) to 1 (bow); the bow is at -Y.
    `levels` are functions t -> z from keel to sheer; `hb(t, z)` the half-breadth;
    `mats[k]` = (material, fit) for the strip between level k and k+1: fit 0 maps the
    texture by position, fit > 0 stretches v over the strip and repeats u every `fit` m."""

    def __init__(self, L, ts, levels, hb, mats, yfn=None, shade=None):
        self.L, self.ts, self.levels, self.hbf, self.mats, self.yfn = L, ts, levels, hb, mats, yfn
        self.shade = shade

    def zs(self, t, levels=None):
        out = []
        for f in levels or self.levels:
            z = f(t)
            if out:
                z = max(z, out[-1] + 0.004)
            out.append(z)
        return out

    def y(self, t, z):
        return self.L / 2 - t * self.L + (self.yfn(t, z) if self.yfn else 0.0)

    def hb(self, t, z):
        return self.hbf(t, z)

    def P(self, t, z, sx=1, inset=0.0):
        return V(sx * max(0.0, self.hb(t, z) - inset), self.y(t, z), z)

    def _uv(self, pts, mat, fit, lo_hi, along="y"):
        if fit:
            if along == "y":
                return [(-p.y / fit, f) for p, f in zip(pts, lo_hi)]
            return [(p.x / fit, f) for p, f in zip(pts, lo_hi)]
        tile = TILE.get(mat, 2.0)
        if along == "y":
            return [(-p.y / tile, p.z / tile) for p in pts]
        return [(p.x / tile, p.z / tile) for p in pts]

    def outer(self, m, skip=None):
        """skip(sx, k, ta, tb): leave out that face (a gangway port in the bulwark)."""
        if hasattr(m, "hulls"):
            m.hulls.append(self)
        T = self.ts
        Z = [self.zs(t) for t in T]
        K = len(self.levels)
        m.shadefn = self.shade
        # M7 boats: the waterline's slime and the weed below it, on every hull
        tint_was = getattr(m, "tintfn", None)
        if hasattr(m, "tintfn") and getattr(self, "tint", True):
            m.tintfn = waterline_tint
        for i in range(len(T) - 1):
            ta, tb = T[i], T[i + 1]
            for k in range(K - 1):
                mat, fit = self.mats[k]
                for sx in (1, -1):
                    if skip and skip(sx, k, ta, tb):
                        continue
                    pts = [self.P(ta, Z[i][k], sx), self.P(tb, Z[i + 1][k], sx), self.P(tb, Z[i + 1][k + 1], sx),
                           self.P(ta, Z[i][k + 1], sx)]
                    m.poly(pts, mat, out=(sx, 0, 0), uvs=self._uv(pts, mat, fit, (0, 0, 1, 1)))
            pts = [self.P(ta, Z[i][0], 1), self.P(tb, Z[i + 1][0], 1), self.P(tb, Z[i + 1][0], -1), self.P(ta, Z[i][0], -1)]
            mat = self.mats[0][0]
            tile = TILE.get(mat, 2.0)
            m.poly(pts, mat, out=(0, 0, -1), uvs=[(-p.y / tile, p.x / tile) for p in pts])
        for i, ty in ((0, 1), (len(T) - 1, -1)):
            t = T[i]
            for k in range(K - 1):
                mat, fit = self.mats[k]
                pts = [self.P(t, Z[i][k], 1), self.P(t, Z[i][k + 1], 1), self.P(t, Z[i][k + 1], -1), self.P(t, Z[i][k], -1)]
                m.poly(pts, mat, out=(0, ty, 0), uvs=self._uv(pts, mat, fit, (0, 1, 1, 0), along="x"))
        m.shadefn = None
        if hasattr(m, "tintfn"):
            m.tintfn = tint_was

    def wale(self, m, zfn, t0, t1, h=0.12, out=0.06, mat=None, shade=0.8):
        """M7 boats: a wale (a thick rubbing strake) along the side from t0 to t1, its top at zfn(t)."""
        mat = DARK if mat is None else mat
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                a0, b0 = self.P(ta, zfn(ta) - h, sx), self.P(tb, zfn(tb) - h, sx)
                a1, b1 = self.P(ta, zfn(ta), sx), self.P(tb, zfn(tb), sx)
                o = V(sx * out, 0, 0)
                m.poly([a0 + o, b0 + o, b1 + o, a1 + o], mat, out=(sx, 0, 0), shade=shade,
                       uvs=[(-p.y / 1.2, p.z / 1.2) for p in (a0, b0, b1, a1)])
                m.poly([a1, b1, b1 + o, a1 + o], mat, out=(0, 0, 1), shade=shade * 1.1)
                m.poly([a0, b0, b0 + o, a0 + o], mat, out=(0, 0, -1), shade=shade * 0.6)

    def decal(self, m, t, z, w, h, sx, mat=None, u=(0.0, 1.0), off=0.03):
        """M7 boats: a cut-out picture laid on the side (rust and soot runs): centre at (t, z), w along, h down."""
        mat = STREAKS if mat is None else mat
        p = self.P(t, z, sx) + V(sx * off, 0, 0)
        tan = (self.P(min(1.0, t + 0.02), z, sx) - self.P(max(0.0, t - 0.02), z, sx)).normalized()
        r = -tan if sx > 0 else tan
        up = V(0, 0, 1)
        pts = [p - r * w / 2 - up * h, p + r * w / 2 - up * h, p + r * w / 2, p - r * w / 2]
        m.poly(pts, mat, out=(sx, 0, 0), uvs=[(u[0], 0), (u[1], 0), (u[1], 1), (u[0], 1)])

    def rim(self, drop=0.03):
        """The outline of the hull at its rail, starboard stern to bow, port bow to stern."""
        top = self.levels[-1]
        side = [self.P(t, top(t) - drop, 1) for t in self.ts]
        return side + [mirror(p, -1) for p in reversed(side)]

    def span(self, t0, t1):
        return [t0] + [t for t in self.ts if t0 + 1e-6 < t < t1 - 1e-6] + [t1]

    def deck(self, m, zfn, t0, t1, inset, mat, tile=1.6, shade=0.95):
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            a, b = self.P(ta, zfn(ta), 1, inset), self.P(tb, zfn(tb), 1, inset)
            pts = [mirror(a, -1), a, b, mirror(b, -1)]
            m.poly(pts, mat, out=(0, 0, 1), shade=shade, uvs=[(-p.y / tile, p.x / tile) for p in pts])

    def rail(self, m, zlo, ztop, t0, t1, thick, mat, cap_mat, end0=True, end1=False, shade=0.85, skip=None):
        """The inside of the bulwark from the deck up, and the rail cap on top."""
        T = self.span(t0, t1)
        tile = TILE.get(mat, 1.6)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                if skip and skip(sx, -1, ta, tb):
                    continue
                pts = [self.P(ta, zlo(ta), sx, thick), self.P(tb, zlo(tb), sx, thick), self.P(tb, ztop(tb), sx, thick),
                       self.P(ta, ztop(ta), sx, thick)]
                m.poly(pts, mat, out=(-sx, 0, 0), shade=shade, uvs=[(-p.y / tile, p.z / tile) for p in pts])
                pts = [self.P(ta, ztop(ta), sx), self.P(tb, ztop(tb), sx), self.P(tb, ztop(tb), sx, thick),
                       self.P(ta, ztop(ta), sx, thick)]
                m.poly(pts, cap_mat, out=(0, 0, 1), uvs=[(-p.y / 1.2, p.x / 1.2) for p in pts])
        for t, on, dy in ((t0, end0, -1), (t1, end1, 1)):
            if not on:
                continue
            zl, zt = zlo(t), ztop(t)
            w0, w1 = self.hb(t, zl) - thick, self.hb(t, zt) - thick
            if w1 < 0.15:
                continue
            y = self.y(t, zt) + dy * thick
            pts = [V(-w0, y, zl), V(w0, y, zl), V(w1, y, zt), V(-w1, y, zt)]
            m.poly(pts, mat, out=(0, dy, 0), shade=shade, uvs=[(p.x / tile, p.z / tile) for p in pts])
            y0 = self.y(t, zt)
            pts = [V(-w1, y0, zt), V(w1, y0, zt), V(w1, y, zt), V(-w1, y, zt)]
            m.poly(pts, cap_mat, out=(0, 0, 1), uvs=[(p.x / 1.2, p.y / 1.2) for p in pts])

    def inner(self, m, levels, t0, t1, inset, mat, floor_mat, end0=True, end1=True, shade=0.8):
        """The inside skin of an open hull (or hold) with a floor, facing inward."""
        T = self.span(t0, t1)
        Z = [self.zs(t, levels) for t in T]
        K = len(levels)
        tile = TILE.get(mat, 1.2)
        for i in range(len(T) - 1):
            ta, tb = T[i], T[i + 1]
            for k in range(K - 1):
                for sx in (1, -1):
                    pts = [self.P(ta, Z[i][k], sx, inset), self.P(tb, Z[i + 1][k], sx, inset),
                           self.P(tb, Z[i + 1][k + 1], sx, inset), self.P(ta, Z[i][k + 1], sx, inset)]
                    s = shade * (0.8 if k == 0 else 1.0)
                    m.poly(pts, mat, out=(-sx, 0, 0), shade=s, uvs=[(-p.y / tile, p.z / tile) for p in pts])
            pts = [self.P(ta, Z[i][0], 1, inset), self.P(tb, Z[i + 1][0], 1, inset), self.P(tb, Z[i + 1][0], -1, inset),
                   self.P(ta, Z[i][0], -1, inset)]
            ft = TILE.get(floor_mat, 1.2)
            m.poly(pts, floor_mat, out=(0, 0, 1), shade=shade * 0.75, uvs=[(-p.y / ft, p.x / ft) for p in pts])
        for i, on, dy in ((0, end0, -1), (len(T) - 1, end1, 1)):
            if not on:
                continue
            t = T[i]
            for k in range(K - 1):
                pts = [self.P(t, Z[i][k], 1, inset), self.P(t, Z[i][k + 1], 1, inset), self.P(t, Z[i][k + 1], -1, inset),
                       self.P(t, Z[i][k], -1, inset)]
                m.poly(pts, mat, out=(0, dy, 0), shade=shade * 0.9, uvs=[(p.x / tile, p.z / tile) for p in pts])

    def cap(self, m, zfn, t0, t1, inset, mat):
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                pts = [self.P(ta, zfn(ta), sx), self.P(tb, zfn(tb), sx), self.P(tb, zfn(tb), sx, inset),
                       self.P(ta, zfn(ta), sx, inset)]
                m.poly(pts, mat, out=(0, 0, 1), uvs=[(-p.y / 1.2, p.x / 1.2) for p in pts])


# ---- spars, rigging and small parts


def spar(m, a, b, r0, r1, mat=DARK, sides=6, cap=False):
    m.tube([Vector(a), Vector(b)], [r0, r1], sides, mat, smooth=False, urep=1, vscale=0.5, cap1=cap)


def rig(m, a, b, r=0.022, mat=RIG):
    """Rope, wire or chain: a line in the game. Bars 4 cm and thicker stay solid."""
    if r >= 0.04:
        m.tube([Vector(a), Vector(b)], [r, r], 4, mat, smooth=False, urep=1, vscale=0.3)
    else:
        m.line(a, b)


def rope_path(m, pts, r=0.022, mat=RIG):
    m.tube([Vector(p) for p in pts], [r] * len(pts), 3, mat, smooth=False, urep=1, vscale=0.3)


def bundle(m, a, b, r, mat=CANVAS, n=4, sides=5, droop=0.0):
    """A furled sail: a sausage of canvas from a to b, thickest in the middle."""
    a, b = Vector(a), Vector(b)
    path, radii = [], []
    for i in range(n + 1):
        f = i / n
        p = a.lerp(b, f)
        p.z -= droop * math.sin(math.pi * f)
        path.append(p)
        w = 0.4 + 0.6 * math.sin(math.pi * f) ** 0.6
        radii.append((r * w, r * w * 0.85))
    m.tube(path, radii, sides, mat, side=(0, 0, 1), smooth=False, cap0=True, cap1=True, urep=2, vscale=0.5)


def sail(m, h0, h1, f0, f1, belly, nu=4, nv=3, mat=CANVAS):
    """A sail set and drawing: a sheet between the head (h0 -> h1) and the foot (f0 -> f1),
    bulging by the vector `belly` in the middle (downwind). A triangle: give h0 == h1."""
    h0, h1, f0, f1, belly = Vector(h0), Vector(h1), Vector(f0), Vector(f1), Vector(belly)
    P = []
    for j in range(nv + 1):
        v = j / nv
        row = []
        for i in range(nu + 1):
            u = i / nu
            p = h0.lerp(h1, u).lerp(f0.lerp(f1, u), v)
            p = p + belly * (math.sin(math.pi * u) * math.sin(math.pi * min(1.0, 0.15 + 0.85 * v)))
            row.append(p)
        P.append(row)
    w = max((h1 - h0).length, (f1 - f0).length, 0.5)
    h = max(((f0 + f1) / 2 - (h0 + h1) / 2).length, 0.5)
    for j in range(nv):
        for i in range(nu):
            pts = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]
            uvs = [(i / nu * w / 2, -j / nv * h / 2), ((i + 1) / nu * w / 2, -j / nv * h / 2),
                   ((i + 1) / nu * w / 2, -(j + 1) / nv * h / 2), (i / nu * w / 2, -(j + 1) / nv * h / 2)]
            m.poly(pts, mat, uvs=uvs)


def yard(m, c, length, r, sail_r, mat=DARK, sail=CANVAS, lifts_to=None):
    c = Vector(c)
    for sx in (1, -1):
        spar(m, c, c + V(sx * length / 2, 0, 0), r, r * 0.45, mat, sides=5)
    if sail_r > 0:
        bundle(m, c + V(-length / 2 * 0.86, -0.05, r + sail_r * 0.5), c + V(length / 2 * 0.86, -0.05, r + sail_r * 0.5),
               sail_r, sail)
    if lifts_to is not None:
        for sx in (1, -1):
            rig(m, c + V(sx * length / 2 * 0.95, 0, 0), Vector(lifts_to), 0.018)


def shroud_quad(m, b0, b1, t1, t0, n=4, ratline=0.5):
    """A set of shrouds from the chains (b0..b1) up to the mast (t0..t1), with ratlines across."""
    b0, b1, t0, t1 = Vector(b0), Vector(b1), Vector(t0), Vector(t1)
    for i in range(n):
        f = i / (n - 1)
        m.line(b0.lerp(b1, f), t0.lerp(t1, f))
    h = ((b0 + b1) / 2 - (t0 + t1) / 2).length
    k = 1
    while k * ratline < h * 0.86:
        f = k * ratline / h
        m.line(b0.lerp(t0, f), b1.lerp(t1, f))
        k += 1


def name_board(m, c, right, up, w, h, row, off=0.03, mat=None):
    """A name painted on a board or straight on the hull: row of NAME_ROWS (0 = top)."""
    c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    c = c + n * off
    v0, v1 = 1 - (row + 1) / 8, 1 - row / 8
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    m.poly(pts, NAMES if mat is None else mat, out=n, uvs=[(0, v0), (1, v0), (1, v1), (0, v1)])


def hull_name(m, hull, t, z, w, h, row, both=True, mat=None):
    """A name on the bow (or quarter) of a hull, following the planking there."""
    for sx in ((1, -1) if both else (1,)):
        p = hull.P(t, z, sx)
        tan = (hull.P(min(1.0, t + 0.02), z, sx) - hull.P(max(0.0, t - 0.02), z, sx)).normalized()
        right = -tan if sx > 0 else tan
        name_board(m, p, right, (0, 0, 1), w, h, row, off=0.04, mat=mat)


def washing_line(m, a, b, seed=1, n=5):
    """A line with washing hung out to dry: shirts, a sheet, a red cloth."""
    rnd = random.Random(seed)
    a, b = Vector(a), Vector(b)
    m.line(a, b)
    for i in range(n):
        f0 = (i + 0.3) / n
        f1 = f0 + rnd.uniform(0.35, 0.6) / n
        p0, p1 = a.lerp(b, f0) - V(0, 0, 0.03), a.lerp(b, f1) - V(0, 0, 0.03)
        hgt = rnd.uniform(0.45, 0.9)
        qx, qy = rnd.choice([(0, 0.5), (0.5, 0.5), (0, 0), (0.5, 0)])
        side = (p1 - p0).cross(V(0, 0, 1)).normalized() * rnd.uniform(-0.06, 0.06)
        m.poly([p0 - V(0, 0, hgt) + side, p1 - V(0, 0, hgt * 0.92) + side, p1, p0], WASH,
               uvs=[(qx, qy), (qx + 0.5, qy), (qx + 0.5, qy + 0.5), (qx, qy + 0.5)])


def coil(m, c, r=0.32):
    """A flaked coil of rope on deck."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.35, 0.0), (r, 0.0), (r * 1.02, 0.08), (r * 0.8, 0.13), (r * 0.35, 0.1)], 8, ROPE, smooth=False,
                urep=4, vscale=2)


# each flag's corner in the flag picture (surf_flag); a flag is a quarter of it wide, half of it high
FLAG_UV = {"house": (0.0, 0.5), "norwegian": (0.25, 0.5), "danish": (0.5, 0.5), "red": (0.75, 0.5),
           "dutch": (0.0, 0.0), "belgian": (0.25, 0.0), "german": (0.5, 0.0), "british": (0.75, 0.0)}


def flag(m, top, w, h, along=(0, 1, 0), wave=0.12, kind="house"):
    """A flag hoisted at `top`, flying along `along`: two quads with a little wave."""
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    up = V(0, 0, h)
    mid = top + d * (w / 2) + side * wave
    end = top + d * w - side * wave * 0.5
    u0, v0 = FLAG_UV[kind]
    m.poly([top - up, mid - up, mid, top], FLAG, uvs=[(u0, v0), (u0 + 0.125, v0), (u0 + 0.125, v0 + 0.5), (u0, v0 + 0.5)])
    m.poly([mid - up, end - up, end, mid], FLAG,
           uvs=[(u0 + 0.125, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0 + 0.125, v0 + 0.5)])


def pennant(m, top, length, along=(0, 1, 0), h=0.3):
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    mid = top + d * (length * 0.5) + side * 0.08 - V(0, 0, h * 0.35)
    m.poly([top - V(0, 0, h), mid, top], FLAG, uvs=[(0.78, 0.55), (0.92, 0.75), (0.78, 0.95)])
    m.poly([mid, top + d * length - V(0, 0, h * 0.6), mid + V(0, 0, 0.05)], FLAG, uvs=[(0.84, 0.65), (0.97, 0.75), (0.84, 0.85)])


def panel(m, c, right, up, w, h, mat=WINDOW, off=0.02):
    """A flat picture (window, door) on a wall: centre c, the wall's right and up directions."""
    c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    c = c + n * off
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    m.poly(pts, mat, out=n, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])


def house(m, x0, x1, y0, y1, z0, z1, wall=WHITE, roof=DARK, over=0.12, windows=(), door=None, roof_rise=0.0):
    """A deckhouse box: walls, a roof slab (slightly arched if roof_rise), windows as
    (side, position along, z centre) with side in '+x', '-x', '+y', '-y'."""
    m.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), wall, tile=1.6, skip=("+z", "-z"))
    xa, xb, ya, yb = x0 - over, x1 + over, y0 - over, y1 + over
    if roof_rise > 0:
        xs = [xa, xa + (xb - xa) * 0.25, (xa + xb) / 2, xa + (xb - xa) * 0.75, xb]
        zs = [z1, z1 + roof_rise * 0.75, z1 + roof_rise, z1 + roof_rise * 0.75, z1]
        for i in range(4):
            pts = [V(xs[i], ya, zs[i]), V(xs[i + 1], ya, zs[i + 1]), V(xs[i + 1], yb, zs[i + 1]), V(xs[i], yb, zs[i])]
            m.poly(pts, roof, out=(xs[i] + xs[i + 1] - xa - xb, 0, 1), uvs=[(p.y / 1.2, p.x / 1.2) for p in pts])
        for yy, dy in ((ya, -1), (yb, 1)):
            m.poly([V(x, yy, z) for x, z in zip(xs, zs)], roof, out=(0, dy, 0), shade=0.8)
        m.poly([V(xa, ya, z1 - 0.01), V(xb, ya, z1 - 0.01), V(xb, yb, z1 - 0.01), V(xa, yb, z1 - 0.01)], roof,
               out=(0, 0, -1), shade=0.6)
    else:
        m.box(((x0 + x1) / 2, (y0 + y1) / 2, z1 + 0.05), (xb - xa, yb - ya, 0.1), roof, tile=1.2, shade=0.9)
    for side, a, zc in windows:
        if side == "+x":
            panel(m, (x1, a, zc), (0, -1, 0), (0, 0, 1), 0.55, 0.5)
        elif side == "-x":
            panel(m, (x0, a, zc), (0, 1, 0), (0, 0, 1), 0.55, 0.5)
        elif side == "-y":
            panel(m, (a, y0, zc), (1, 0, 0), (0, 0, 1), 0.55, 0.5)
        else:
            panel(m, (a, y1, zc), (-1, 0, 0), (0, 0, 1), 0.55, 0.5)
    if door:
        side, a, w, h = door
        zc = z0 + h / 2 + 0.05
        if side == "-y":
            panel(m, (a, y0, zc), (1, 0, 0), (0, 0, 1), w, h, DARK)
        elif side == "+y":
            panel(m, (a, y1, zc), (-1, 0, 0), (0, 0, 1), w, h, DARK)
        elif side == "+x":
            panel(m, (x1, a, zc), (0, -1, 0), (0, 0, 1), w, h, DARK)
        else:
            panel(m, (x0, a, zc), (0, 1, 0), (0, 0, 1), w, h, DARK)


def chimney(m, x, y, z, h=0.9, r=0.1):
    with m.at(move(x, y, z)):
        m.lathe([(r, 0), (r, h), (r * 1.6, h + 0.05), (r * 1.6, h + 0.14), (r * 0.5, h + 0.2)], 6, IRON, smooth=False,
                cap1=True)


def bitts(m, x, y, z, h=0.55, w=0.2):
    m.box((x, y, z + h / 2), (w, w, h), DARK, shade=0.85)


def barrel_lo(m, c, lying=False, yaw=0.0):
    c = Vector(c)
    prof = [(0.27, 0.0), (0.32, 0.2), (0.335, 0.475), (0.32, 0.75), (0.27, 0.95)]
    if lying:
        M = move(c.x, c.y, c.z + 0.335) @ rot_z(yaw) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ move(0, 0, -0.475)
    else:
        M = move(*c) @ rot_z(yaw)
    with m.at(M):
        m.lathe(prof, 8, BARREL, cap0=True, cap1=True, urep=2, smooth=False)
        for z in (0.12, 0.83):
            m.lathe([(0.312, z), (0.312, z + 0.05)], 8, IRON, smooth=False, urep=2)


# Where each model's sacks are (2026-09-28: one sack model, client game/sackModel.ts): by model name, the sack's
# matrix in the model's glTF frame and its size; written to client/src/world/boats_sack_sockets.json (build_ferry.py
# writes its own). A model with sacks gets a "_bare" copy without them; the game draws the one sack model there.
SACK_SOCKETS = {}
CUR = [None]
NO_SACKS = [False]


def sack_lo(m, c, yaw=0.0, lift=0.0):
    c = Vector(c)
    M = move(c.x, c.y, c.z) @ rot_z(yaw) @ Matrix.Rotation(lift, 4, "X")
    if CUR[0] is not None and not NO_SACKS[0]:
        C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
        g = C @ (m.xf @ M) @ C.inverted()
        SACK_SOCKETS.setdefault(CUR[0], []).append(dict(k="lying", m=[round(g[r][cc], 4) for cc in range(4) for r in range(4)],
                                                       L=0.9, W=0.52, H=0.26))
    if NO_SACKS[0]:
        return
    with m.at(M):
        path = [V(-0.45, 0, 0.12), V(-0.3, 0, 0.13), V(0.3, 0, 0.13), V(0.45, 0, 0.12)]
        radii = [(0.06, 0.17), (0.13, 0.26), (0.13, 0.26), (0.06, 0.17)]
        m.tube(path, radii, 6, SACK, side=(0, 0, 1), smooth=False, cap0=True, cap1=True, urep=1, vscale=1.0)


def crate_lo(m, c, size=(0.9, 0.7, 0.65), yaw=0.0):
    c = Vector(c)
    with m.at(move(*c) @ rot_z(yaw)):
        m.box((0, 0, size[2] / 2), size, CRATE, mode="fit", shade=0.9)


def anchor(m, top, side=(1, 0, 0), size=1.0):
    """A stocked anchor hanging from `top`: shank down, arms up at the crown, stock across."""
    top = Vector(top)
    s = size
    crown = top - V(0, 0, 2.0 * s)
    m.beam(top, crown, 0.12 * s, 0.12 * s, IRON, side=side)
    for d in (1, -1):
        tip = crown + V(0, d * 0.75 * s, 0.55 * s)
        m.beam(crown, tip, 0.11 * s, 0.11 * s, IRON, side=(1, 0, 0))
        m.beam(tip, tip + V(0, d * 0.12 * s, 0.25 * s), 0.2 * s, 0.05 * s, IRON, side=(1, 0, 0))
    m.beam(top - V(0.9 * s, 0, 0.15 * s), top + V(0.9 * s, 0, -0.15 * s), 0.08 * s, 0.08 * s, IRON, side=(0, 1, 0))


def wheel_helm(m, c, r=0.6, axis="y"):
    """A ship's wheel standing across the deck (its axle along y)."""
    c = Vector(c)
    pts = []
    for i in range(9):
        a = 2 * math.pi * i / 8
        pts.append(c + V(r * math.cos(a), 0, r * math.sin(a)))
    m.tube(pts[:-1], [0.035] * 8, 3, DARK, side=(0, 1, 0), closed_path=True, smooth=False)
    for i in range(4):
        a = math.pi * i / 4
        d = V(math.cos(a), 0, math.sin(a))
        m.beam(c - d * (r + 0.12), c + d * (r + 0.12), 0.03, 0.03, DARK, side=(0, 1, 0), caps=False)


def windlass(m, x, y, z, w=1.6, r=0.2):
    with m.at(move(x, y, z) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(r, -w / 2), (r * 1.2, -w / 2 + 0.1), (r * 1.2, w / 2 - 0.1), (r, w / 2)], 8, DARK, smooth=False,
                cap0=True, cap1=True, cap_mat=IRON)
    for sx in (1, -1):
        m.box((x + sx * (w / 2 + 0.1), y, z - 0.15 + (r + 0.35) / 2 - 0.1), (0.18, 0.4, r + 0.55), DARK)


# ------------------------------------------------------------------ M7 boats: small parts


def lantern(m, c, kind=0, bail=True):
    """A ship's lantern standing (or hung by its bail) with its flame at c: the town's oil lantern (2026-10-11,
    tools/blender/lantern_kit.py oil_lantern) at a ship's size. Registered for the game's lamp APIs (Mesh.lamp)."""
    c = Vector(c)
    k = lantern_kit.Kit()
    with k.at(lantern_kit.move(c.x, c.y, c.z)):
        lantern_kit.oil_lantern(k, 0.17, 0.21, bail=bail)
    bp.kit_faces(m, k.faces, {"iron": IRON, "glass": GLASS, "brass": IRON})
    m.lamp(c, kind)


def fender(m, p, sx, drop=0.45, r=0.13):
    """A rope fender hung over the side by its lanyard: a fat plaited sausage."""
    p = Vector(p)
    a = p + V(sx * (r + 0.02), 0, -0.05)
    m.line(p + V(0, 0, 0.05), a)
    m.tube([a, a - V(0, 0, drop)], [(r * 0.8, r), (r * 0.8, r)], 5, ROPE, side=(0, 1, 0), smooth=False, cap0=True, cap1=True)


def ribs(m, hull, ts, zlo, ztop, inset, w=0.04, mat=None):
    """The frames inside an open boat, keelson to gunwale, at the stations ts."""
    mat = WOOD if mat is None else mat
    for t in ts:
        z0, z1 = zlo(t), ztop(t) - 0.04
        for sx in (1, -1):
            pts = [hull.P(t, z0 + (z1 - z0) * k / 3, sx, inset + 0.01) for k in range(4)]
            for a, b in zip(pts, pts[1:]):
                m.beam(a, b, w, w * 0.8, mat, side=(0, 1, 0), shade=0.75)


def thole(m, p, gap=0.1):
    """A pair of iron thole pins on the gunwale: the oar works between them."""
    p = Vector(p)
    for dy in (-gap / 2, gap / 2):
        m.box(p + V(0, dy, 0.06), (0.03, 0.03, 0.14), IRON)


def stern_name(m, hull, t, z, w, h, row, both=True):
    """A home port or a name on a stern quarter (NAMES4)."""
    hull_name(m, hull, t, z, w, h, row, both, mat=NAMES4)


def basket(m, c, r=0.22, h=0.28, mat=None):
    """A round wicker basket."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.75, 0.0), (r, h), (r * 0.9, h - 0.02)], 7, ROPE if mat is None else mat, smooth=False, cap0=True,
                urep=2, vscale=2)


def eel_trap(m, a, b, r=0.3):
    """A fyke (eel trap): netting over wooden hoops, from its mouth a to its tail b."""
    a, b = Vector(a), Vector(b)
    n = 4
    path = [a.lerp(b, k / n) for k in range(n + 1)]
    radii = [r * (1 - 0.7 * k / n) for k in range(n + 1)]
    m.tube(path, radii, 7, NET, side=(0, 0, 1), smooth=False, urep=2, vscale=1.5)
    for k in range(n):
        p = path[k]
        d = (b - a).normalized()
        s = d.cross(V(0, 0, 1)).normalized()
        u = d.cross(s)
        ring = [p + (s * math.cos(2 * math.pi * i / 7) + u * math.sin(2 * math.pi * i / 7)) * radii[k] for i in range(7)]
        m.tube(ring, [0.015] * 7, 3, WOOD, side=d, closed_path=True, smooth=False)


def oars_stowed(m, a, b, blade_at_b=True):
    """A pair of oars laid in along the thwarts (a to b), blades aft."""
    a, b = Vector(a), Vector(b)
    for dx in (-0.09, 0.09):
        o = V(dx, 0, 0)
        m.beam(a + o, b + o, 0.045, 0.045, WOOD, side=(0, 0, 1))
        d = (b - a).normalized()
        e = b if blade_at_b else a
        s = -1 if blade_at_b else 1
        m.slab([e + o - V(0.07, 0, 0), e + o + V(0.07, 0, 0), e + o + d * s * 0.55 + V(0.07, 0, 0),
                e + o + d * s * 0.55 - V(0.07, 0, 0)], 0.02, DARK, out=(0, 0, 1))


# ---- the open boat's hull and the ship's boat carried on deck (used by the small boats, barges and ships)


def boat_hull(L, B, D, mats, stern_w=0.55):
    kz, sz = -0.3 * D, 0.7 * D

    def keel(t):
        return kz + 0.3 * D * sm((t - 0.78) / 0.22) ** 1.3 + 0.08 * D * sm((0.12 - t) / 0.12)

    def sheer(t):
        return sz + 0.22 * D * sm((t - 0.55) / 0.45) ** 2 + 0.12 * D * sm((0.45 - t) / 0.45) ** 2

    SEC = [(0, 0.15), (0.15, 0.55), (0.5, 0.9), (1, 1.0)]

    def hb(t, z):
        u = cl((z - kz) / (sz - kz))
        sec = table(SEC, u)
        if t > 0.5:
            f = (t - 0.5) / 0.5
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 0.8 * (1 - u))
        else:
            base = stern_w * u ** 0.8
            p = base + (1 - base) * sm(t / 0.42) ** 0.6
        return max(0.015, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z - kz) / (sz - kz))
        return -0.06 * L * u * sm((t - 0.85) / 0.15) + 0.03 * L * u * sm((0.1 - t) / 0.1)

    levels = [keel, lambda t: keel(t) + 0.12 * D, lambda t: 0.5 * (keel(t) + sheer(t)) + 0.05 * D, sheer]
    ts = [0, 0.07, 0.18, 0.32, 0.48, 0.62, 0.74, 0.84, 0.92, 0.97, 1.0]
    mats = [(mats, 0)] * 3 if isinstance(mats, int) else mats
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.6 + 0.4 * sm((p.z - kz) / (sz - kz)))
    return hull, keel, sheer


def ships_boat(m, c, L, B, D, yaw=0.0, mat=WHITE, cover=CANVAS):
    """A ship's boat under a canvas cover, for davits and deckhouse roofs. c = keel bottom centre."""
    hull, keel, sheer = boat_hull(L, B, D, mat, stern_w=0.35)
    k = -keel(0.5)
    with m.at(move(c[0], c[1], c[2] + k) @ rot_z(yaw)):
        hull.outer(m)
        hull.deck(m, lambda t: sheer(t) - 0.02, 0, 1, 0.0, cover, tile=1.0)
    return hull

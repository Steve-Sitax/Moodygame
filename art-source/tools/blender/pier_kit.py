"""Parts shared by the arrival ferry, the Werf landing stage and its two bridges (build_ferry.py).

Our own work. Two things live here.

BMesh is bb.Mesh with bevelled boxes and beams. AGENTS.md: exposed edges get a geometric bevel suited to the
material (wood 3 to 6 mm, cast and wrought iron 2 to 3 mm). Every m.box and m.beam of the ferry and the stage
goes through it, so the edge catches the light without rewriting each call. A box with faces left out (skip) and a
tapered beam stay sharp: those are mating surfaces.

The painters draw the stage's deck at 2048 x 1536 px, a board to a band, with the height beside the colour (the game
lights the height: models/ModelBump.cs reads assets/game-models/heights/<material>.png when it exists).
"""

import math

import numpy as np
from mathutils import Matrix, Vector

import build_boats as bb
from build_props import col

# ------------------------------------------------------------------ bevelled timber and iron

# bevel width in metres by material name, and the share of the thinnest side it may take
BEVEL = {"wood": 0.004, "wood_dark": 0.005, "deck": 0.003, "crate": 0.004, "varnish": 0.003, "cabin_planks": 0.003,
         "stage_deck": 0.003, "iron": 0.0025, "iron_hull": 0.002, "chequer": 0.002, "crane_plate": 0.002,
         "stage_timber": 0.006, "stage_iron": 0.003}
SHARE = 0.22

AXES = (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))


class BMesh(bb.Mesh):
    """bb.Mesh whose box and beam bevel their edges (BEVEL) and chamfer-light them a little (a worn arris is paler)."""

    def radius(self, mat, thinnest):
        name = bb.MATS[mat] if 0 <= mat < len(bb.MATS) else ""
        return min(BEVEL.get(name, 0.0), SHARE * thinnest)

    def block(self, c, axes, half, r, mat, shade=1.0, tile=1.0, mode="metric"):
        """A box about c with unit axes (a, b, c) and half sizes, every edge chamfered by r: 6 faces, 12 strips, 8 corners."""
        c = Vector(c)
        lit = shade * 1.07
        for a in range(3):
            b, d = [i for i in range(3) if i != a]
            for sa in (1, -1):
                pts = [c + axes[a] * (sa * half[a]) + axes[b] * (sb * (half[b] - r)) + axes[d] * (sd * (half[d] - r))
                       for sb, sd in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                self.poly(pts, mat, out=axes[a] * sa, shade=shade, tile=tile, mode=mode)
        for a, b in ((0, 1), (0, 2), (1, 2)):
            d = 3 - a - b
            for sa in (1, -1):
                for sb in (1, -1):
                    p = [c + axes[a] * (sa * half[a]) + axes[b] * (sb * (half[b] - r)) + axes[d] * (t * (half[d] - r)) for t in (-1, 1)]
                    q = [c + axes[a] * (sa * (half[a] - r)) + axes[b] * (sb * half[b]) + axes[d] * (t * (half[d] - r)) for t in (1, -1)]
                    self.poly(p + q, mat, out=axes[a] * sa + axes[b] * sb, shade=lit, tile=tile, mode=mode)
        for sx in (1, -1):
            for sy in (1, -1):
                for sz in (1, -1):
                    s = (sx, sy, sz)
                    pts = []
                    for a in range(3):
                        pts.append(c + sum((axes[i] * (s[i] * (half[i] if i == a else half[i] - r)) for i in range(3)), Vector()))
                    self.poly(pts, mat, out=sum((axes[i] * s[i] for i in range(3)), Vector()), shade=lit, tile=tile, mode=mode)

    def box(self, c, size, mat, shade=1.0, tile=1.0, mode="metric", skip=()):
        r = self.radius(mat, min(size))
        if r < 0.0008 or skip:
            return super().box(c, size, mat, shade, tile, mode, skip)
        self.block(c, AXES, [s / 2 for s in size], r, mat, shade, tile, mode)

    def beam(self, a, b, w, h, mat, side=None, shade=1.0, tile=1.0, caps=True, w2=None, h2=None):
        r = self.radius(mat, min(w, h))
        if r < 0.0008 or not caps or w2 is not None or h2 is not None:
            return super().beam(a, b, w, h, mat, side, shade, tile, caps, w2, h2)
        a, b = Vector(a), Vector(b)
        t = b - a
        length = t.length
        if length < 4 * r:
            return super().beam(a, b, w, h, mat, side, shade, tile, caps, w2, h2)
        t.normalize()
        if side is None:
            s = Vector((0, 0, 1)).cross(t)
            if s.length < 1e-4:
                s = Vector((1, 0, 0))
        else:
            s = Vector(side)
            s = s - t * s.dot(t)
            if s.length < 1e-4:
                s = t.orthogonal()
        s.normalize()
        k = s.cross(t)
        # (the long axis first: the picture's u runs along the timber)
        self.block((a + b) / 2, (t, s, k), (length / 2, w / 2, h / 2), r, mat, shade, tile)

    def plank(self, a0, a1, b0, b1, ztop, thick, mat, r=0.003, shade=1.0, uvf=None, along="x", ends=True):
        """A deck board from a0 to a1 along its length and b0 to b1 across (along "x": a is x and b is y; along "y": a is
        y and b is x), its top and the two long top edges chamfered by r, the sides and ends plain. uvf(a, b) gives the
        picture's (u, v) at a point of the top."""
        if along == "y":
            with self.at(Matrix.Rotation(math.pi / 2, 4, "Z")):  # (local x runs on as global y, local y as -x)
                return self.plank(a0, a1, -b1, -b0, ztop, thick, mat, r, shade, (lambda a, b: uvf(a, -b)) if uvf else None, "x", ends)
        x0, x1, y0, y1 = a0, a1, b0, b1
        zb = ztop - thick
        lit = shade * 1.08
        top = [Vector((x0, y0 + r, ztop)), Vector((x1, y0 + r, ztop)), Vector((x1, y1 - r, ztop)), Vector((x0, y1 - r, ztop))]
        self.poly(top, mat, out=(0, 0, 1), shade=shade, uvs=[uvf(p.x, p.y) for p in top] if uvf else None)
        for sy, yy in ((-1, y0), (1, y1)):
            e = [Vector((x0, yy, ztop - r)), Vector((x1, yy, ztop - r)), Vector((x1, yy - sy * r, ztop)), Vector((x0, yy - sy * r, ztop))]
            self.poly(e, mat, out=(0, sy, 1), shade=lit)
            f = [Vector((x0, yy, zb)), Vector((x1, yy, zb)), Vector((x1, yy, ztop - r)), Vector((x0, yy, ztop - r))]
            self.poly(f, mat, out=(0, sy, 0), shade=shade * 0.9)
        if ends:
            for sx, xx in ((-1, x0), (1, x1)):
                e = [Vector((xx, y0 + r, ztop)), Vector((xx, y1 - r, ztop)), Vector((xx, y1, ztop - r)), Vector((xx, y0, ztop - r))]
                self.poly(e, mat, out=(sx, 0, 0), shade=lit)
                self.poly([Vector((xx, y0, zb)), Vector((xx, y1, zb)), Vector((xx, y1, ztop - r)), Vector((xx, y0, ztop - r))], mat,
                          out=(sx, 0, 0), shade=shade * 0.9)
        self.poly([Vector((x0, y0, zb)), Vector((x1, y0, zb)), Vector((x1, y1, zb)), Vector((x0, y1, zb))], mat, out=(0, 0, -1), shade=shade * 0.6)

    def wall_boards(self, origin, up, across, normal, length, height, mat, rng, pitch=0.2, thick=0.025):
        """A wall of upright boards, each chamfered along its long edges and its own band of the oak picture. From `origin`
        (the top of the wall's first edge, on its outer face) along `across` for `length`, `height` down; the outer face
        looks along `normal`."""
        ex, ey, ez = -Vector(up).normalized(), Vector(across).normalized(), Vector(normal).normalized()
        o = Vector(origin)
        if ex.cross(ey).dot(ez) < 0:  # (a left-handed frame: lay the boards from the far end back)
            o = o + ey * length
            ey = -ey
        frame = Matrix(((ex.x, ey.x, ez.x, o.x), (ex.y, ey.y, ez.y, o.y), (ex.z, ey.z, ez.z, o.z), (0, 0, 0, 1)))
        n = max(1, int(round(length / pitch)))
        w = length / n
        pick = rng.randrange if hasattr(rng, "randrange") else (lambda k: int(rng.integers(0, k)))  # (random.Random or numpy's)
        with self.at(frame):
            for k in range(n):
                b0, b1 = k * w + 0.004, (k + 1) * w - 0.004
                self.plank(0.0, height, b0, b1, 0.0, thick, mat, r=0.003, shade=float(rng.uniform(0.85, 1.05)),
                           uvf=deck_uvf(b0, b1, pick(DECK_BANDS), bool(pick(2))))

    def bolt(self, p, normal, r=0.012, h=0.006, mat=None, sides=6, shade=1.0):
        """A bolt or rivet head on a face at p, looking along normal: a low hexagonal dome."""
        mat = bb.IRON if mat is None else mat
        n = Vector(normal).normalized()
        s = n.orthogonal().normalized()
        k = n.cross(s)
        p = Vector(p)
        ring = [p + s * (r * math.cos(2 * math.pi * i / sides)) + k * (r * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
        crown = p + n * h
        for i in range(sides):
            j = (i + 1) % sides
            self.poly([ring[i], ring[j], crown], mat, out=(ring[i] + ring[j]) / 2 + n * h - p, shade=shade)


DECK_BANDS, DECK_TILE = 8, 2.7  # bands in the deck picture, metres of board it holds


def deck_uvf(b0, b1, band, mirror=False):
    """The picture's uv for a deck board from b0 to b1 across: its whole band across, the grain along u at 2.7 m a
    picture. The nail columns sit at u = 0.204, 0.5 and 0.796, which is where the stage's stringers (x = -2.15, +-1.35,
    2.15) and the bridge's transoms (y = 0.55, 1.35, 2.15 and every 2.7 m on) fall when u = a / 2.7."""
    s = -1.0 if mirror else 1.0
    return lambda a, b: (s * a / DECK_TILE, (band + (b - b0) / (b1 - b0)) / DECK_BANDS)


# ------------------------------------------------------------------ painters (colour, height; rows run bottom-up)


def _band_noise(rng, w, h, cells_u, cells_v):
    """bb.noise with cells_v counted across the picture's own height (bb.noise counts them over the longer side)."""
    return bb.noise(rng, w, h, cells_u, max(1, int(round(cells_v * max(w, h) / h))))


def deck_surf(seed, w=2048, bands=8, band_px=192, base=(0.42, 0.385, 0.335), nails_u=None):
    """The stage's deck boards, one board to each of `bands` bands (a band a board's width, 22 cm), the grain running
    along u (2.7 m a picture). Silvered oak: pores, year rings, checks along the grain, knots, damp patches, black
    nail heads with a rust run on the stringers (u0 - 0.296, u0, u0 + 0.296: x = -2.15 / +-1.35 / 2.15), the board's
    rounded arris at each long edge. Returns (colour [h, w, 3], height [h, w])."""
    h = bands * band_px
    rng = np.random.default_rng(seed)
    C = np.zeros((h, w, 3))
    H = np.zeros((h, w))
    u0 = 0.5
    nails_u = [u0 - 0.296, u0, u0 + 0.296] if nails_u is None else nails_u
    vv = (np.arange(band_px) + 0.5) / band_px
    for b in range(bands):
        r = np.random.default_rng(seed * 100 + b)
        g = 0.45 * _band_noise(r, w, band_px, 4, 22) + 0.3 * _band_noise(r, w, band_px, 11, 60) + 0.25 * _band_noise(r, w, band_px, 34, 130)
        warp = _band_noise(r, w, band_px, 3, 2) * 2.2 + _band_noise(r, w, band_px, 9, 5) * 0.5
        ring = np.abs(np.sin(np.pi * (np.arange(band_px)[:, None] / (band_px / 5.0) + warp)))
        fig = bb.sstep(0.2, 0.0, ring)  # late wood lines
        pores = (r.random((band_px, w)) < 0.022) * (bb.blur(r.random((band_px, w)), 0) > 0)
        pores = np.roll(pores, 1, axis=1) | pores | np.roll(pores, 2, axis=1) | np.roll(pores, 3, axis=1)  # short dashes along the grain
        tone = r.uniform(0.84, 1.1)
        warm = r.uniform(-0.04, 0.05)
        tint = col(base) * np.array([1 + warm, 1, 1 - warm * 1.3])
        silver = bb.sstep(0.35, 0.8, _band_noise(r, w, band_px, 4, 2))
        c = tint * (tone * (0.8 + 0.34 * g) * (1 - 0.2 * fig))[..., None]
        c = bb.mix(c, col((0.5, 0.485, 0.45)) * (0.86 + 0.22 * g)[..., None], 0.38 * silver)
        c *= (1 - 0.35 * pores)[..., None]
        hgt = 0.5 + 0.1 * (g - 0.5) - 0.08 * fig - 0.07 * pores
        # damp, dark patches and dirt packed at the edges
        damp = bb.sstep(0.5, 0.9, _band_noise(r, w, band_px, 5, 5))
        c *= (1 - 0.2 * damp)[..., None]
        edge = np.minimum(vv, 1 - vv) * band_px  # px to the nearest long edge
        c *= (1 - 0.3 * bb.sstep(9.0, 1.5, edge))[:, None, None]
        # the chamfer: 5 px down at each edge, the arris catching the light just inside it
        hgt = hgt - 0.3 * bb.sstep(5.5, 0.5, edge)[:, None] + 0.03 * bb.sstep(0.0, 2.0, edge - 5.0)[:, None] * bb.sstep(9.0, 5.0, edge)[:, None]
        # checks along the grain, a few knots
        for _ in range(int(r.integers(2, 6))):
            x, y = r.uniform(0, w), r.uniform(8, band_px - 8)
            ln = int(r.uniform(120, 700))
            xs = (x + np.arange(ln)).astype(int) % w
            ys = np.clip((y + np.cumsum(r.normal(0, 0.1, ln))).astype(int), 1, band_px - 2)
            depth = 0.5 + 0.5 * np.sin(np.pi * np.arange(ln) / ln)
            c[ys, xs] *= (1 - 0.6 * depth)[:, None]
            c[ys + 1, xs] *= (1 - 0.25 * depth)[:, None]
            hgt[ys, xs] -= 0.3 * depth
        for _ in range(int(r.integers(0, 3))):
            cx, cy = r.uniform(0, w), r.uniform(40, band_px - 40)
            rx, ry = r.uniform(26, 50), r.uniform(10, 18)
            xs = np.arange(int(cx - rx * 1.6), int(cx + rx * 1.6))
            ys = np.arange(int(cy - ry * 1.6), int(cy + ry * 1.6))
            X, Y = np.meshgrid(xs, ys)
            d = np.hypot((X - cx) / rx, (Y - cy) / ry)
            ix = np.ix_(ys % band_px, xs % w)
            c[ix] = c[ix] * (1 - 0.65 * bb.sstep(1.15, 0.45, d))[..., None] + col(base) * 0.3 * (0.65 * bb.sstep(1.15, 0.45, d))[..., None]
            hgt[ix] += 0.1 * np.clip(1 - d, 0, 1) - 0.1 * bb.sstep(1.35, 1.0, d) * bb.sstep(0.6, 1.0, d)
            ring2 = 0.5 + 0.5 * np.sin(d * 14)
            c[ix] *= (1 - 0.18 * ring2 * bb.sstep(1.3, 0.3, d))[..., None]
        # nail heads: two to a stringer, 9 mm across, a rust run down the grain
        for nu in nails_u:
            for vf in (0.23, 0.77):
                cx, cy = nu * w, vf * band_px
                xs = np.arange(int(cx - 12), int(cx + 13))
                ys = np.arange(int(cy - 12), int(cy + 13))
                X, Y = np.meshgrid(xs, ys)
                d = np.hypot((X + 0.5 - cx), (Y + 0.5 - cy)) / 6.5
                ix = np.ix_(ys % band_px, xs % w)
                head = bb.sstep(1.0, 0.8, d)
                c[ix] = c[ix] * (1 - head)[..., None] + col((0.07, 0.06, 0.055)) * head[..., None] * (0.8 + 0.4 * r.random())
                hgt[ix] += 0.1 * np.sqrt(np.clip(1 - d * d, 0, 1)) - 0.12 * bb.sstep(1.0, 1.4, d) * bb.sstep(2.0, 1.4, d)
                halo = bb.sstep(2.6, 0.9, d)
                c[ix] = c[ix] * (1 - 0.35 * halo)[..., None] + col((0.3, 0.15, 0.08)) * (0.35 * halo)[..., None]
                run = int(r.uniform(18, 60))
                xs3 = (int(cx) + 5 + np.arange(run)) % w
                yy = int(cy) % band_px
                fade = 0.45 * (1 - np.arange(run) / run)
                c[yy, xs3] = c[yy, xs3] * (1 - fade)[:, None] + col((0.26, 0.15, 0.09)) * fade[:, None]
        y0 = b * band_px
        C[y0:y0 + band_px] = c
        H[y0:y0 + band_px] = hgt
    rng2 = np.random.default_rng(seed + 7)
    C = np.clip(C * (0.97 + 0.06 * rng2.random((h, w, 1))), 0, 1)
    return C, np.clip(H, 0, 1)

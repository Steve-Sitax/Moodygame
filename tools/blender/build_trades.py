"""Working trades and market goods of Antwerp, 1873 (M3i).

    blender -b --factory-startup -P tools/blender/build_trades.py
    blender -b --factory-startup -P tools/blender/build_trades.py -- --preview

Writes client/public/models/trades.glb (Draco). One node per model, real scale in metres,
low poly (PS1 look), one texture atlas. client/src/world/trades.ts places the trade scenes
(merged per scene); client/src/game/market.ts puts the market goods round the stalls on a
market day (merged per market).

  market   crates and fish boxes behind the stalls, flat fish baskets, vegetable baskets,
           a stool, barrows with fish and with vegetables, a spilled crate, cabbage leaves
           and fish scraps on the stones, cheese, baskets and second-hand goods for the
           Grote Markt tables, a fish bench, a gull sitting on a box
  trades   a boat repair yard (a rowing boat on chocks being caulked, a punt on trestles,
           sawhorses, planks, oakum, the caulking pot on its brazier), a farrier's lean-to
           (forge with glowing coals, bellows, anvil, quench tub, horseshoes on the wall)
           and a horse with a hind hoof lifted, a rope walk (the wheel, its frame and hooks,
           the trestles the yarns run over, hemp), a cooper's yard (casks, a cask being
           fired over a basket of shavings, hoops, a shaving horse, staves), a sailmaker's
           canvas on the stones with his bench, nets hung on poles with stools and baskets;
           each with its own small sign

Frames. Blender is Z-up and the export turns it Y-up: Blender (x, y, z) is game (x, z, -y).
Things stand on their origin, their front toward -Y (game +z). The rope wheel that turns
(tr_rope_spin) has its origin on its axle, the axle along Blender x.

Materials, by name: tr_solid (the atlas), tr_decal (an RGBA atlas for nets, leaves and
scraps; alpha tested), tr_glow (coals and flames: drawn unlit). The vertex colour "Col"
carries a baked shade. All textures are painted by the functions below, nearest filter; the
letters are the 5x7 pixel font of build_streetlife.py (our own). Our own work: no
downloaded models, images or fonts. Plain English on the signs; Dutch only in names.

--preview renders the models to data/shots/trades_preview.png.
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "trades.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

SOLID, DECAL, GLOW = range(3)
MAT_NAMES = ["tr_solid", "tr_decal", "tr_glow"]

# ------------------------------------------------------------------ pixel font and painting (as build_quayfurniture.py)

# ------------------------------------------------------------------ pixel font (5x7, as build_streetlife.py)

GLYPHS = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    ".": [".", ".", ".", ".", ".", ".", "#"],
    "-": ["...", "...", "...", "###", "...", "...", "..."],
    " ": ["...", "...", "...", "...", "...", "...", "..."],
}


def text_width(s, scale=1):
    return (sum(len(GLYPHS[c][0]) + 1 for c in s) - 1) * scale


def draw_text(img, s, x, y, rgba, scale=1, wear=None):
    """Letters into an image array [row, col, ch], top left of the text at (x, y).
    wear: an rng; some pixels are left out (flaked paint)."""
    for c in s:
        g = GLYPHS[c]
        for r, row in enumerate(g):
            for k, ch in enumerate(row):
                if ch != "#":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        if wear is not None and wear.random() < 0.12:
                            continue
                        yy, xx = y + r * scale + dy, x + k * scale + dx
                        if 0 <= yy < img.shape[0] and 0 <= xx < img.shape[1]:
                            img[yy, xx, : len(rgba)] = rgba
        x += (len(g[0]) + 1) * scale


# ------------------------------------------------------------------ painting helpers

def vnoise(rng, w, h, cu, cv):
    """Tileable value noise, [h, w]."""
    g = rng.random((cv, cu))

    def axis(n, c):
        t = np.arange(n) * c / n
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    u0, u1, fu = axis(w, cu)
    v0, v1, fv = axis(h, cv)
    a = g[np.ix_(v0, u0)]
    b = g[np.ix_(v0, u1)]
    c = g[np.ix_(v1, u0)]
    d = g[np.ix_(v1, u1)]
    fu = fu[None, :]
    fv = fv[:, None]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def flat(seed, w, h, rgb, amt=0.18, cells=4):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, w, h, cells, cells) * 0.6 + vnoise(rng, w, h, cells * 4, cells * 4) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (1 - amt + 2 * amt * n)[..., None]
    m = rng.random((h, w)) < 0.06
    img[m, :3] *= 0.8
    return img


def grain(seed, w, h, rgb, streaks=True):
    """Wood: grain along u (the long way of a board)."""
    rng = np.random.default_rng(seed)
    g = vnoise(rng, w, h, 3, max(2, h // 2)) * 0.6 + vnoise(rng, w, h, 8, h) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (0.78 + 0.4 * g)[..., None]
    if streaks:
        for _ in range(h // 6):
            r = int(rng.integers(0, h))
            img[r, :, :3] *= 0.8
    return img


def rusty(seed, w, h, base, rust=(0.36, 0.18, 0.08), amt=0.35):
    """Painted iron with rust breaking through."""
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, base, 0.25)
    n = vnoise(rng, w, h, 5, 5) * 0.7 + vnoise(rng, w, h, 16, 16) * 0.3
    m = n > 1 - amt
    img[m, :3] = np.array(rust) * (0.8 + 0.4 * rng.random((m.sum(), 1)))
    # rust runs down from the top
    for _ in range(w // 5):
        c = int(rng.integers(0, w))
        L = int(rng.integers(h // 4, h))
        img[:L, c, :3] = img[:L, c, :3] * 0.5 + np.array(rust) * 0.5
    return img


def rope_tex(seed, w, h, rgb, tar=0.0):
    """Laid rope: the strands as diagonal bands."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    band = ((xx + yy * 2) % 6) / 6.0
    shade = 0.7 + 0.45 * np.sin(band * math.pi)
    img[..., :3] = np.array(rgb) * shade[..., None]
    img[..., :3] *= (0.9 + 0.2 * rng.random((h, w)))[..., None]
    if tar:
        img[..., :3] *= 1 - tar
    return img


def wicker(seed, w, h, rgb):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    over = ((yy // 2) + (xx // 4)) % 2
    img[..., :3] = np.array(rgb) * (0.75 + 0.35 * over)[..., None]
    img[yy % 2 == 1, :3] *= 0.85
    img[xx % 4 == 0, :3] *= 0.7  # the stakes
    img[..., :3] *= (0.9 + 0.2 * rng.random((h, w)))[..., None]
    return img


def weave(seed, w, h, rgb):
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, rgb, 0.15)
    yy, xx = np.mgrid[0:h, 0:w]
    img[(xx + yy) % 2 == 0, :3] *= 0.88
    return img


def coal_tex(seed, w, h):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    n = vnoise(rng, w, h, 8, 8)
    img[..., :3] = (0.05 + 0.07 * n)[..., None]
    m = rng.random((h, w)) < 0.08
    img[m, :3] = 0.22  # glints
    return img


def planks(seed, w, h, rgb, rows, tar_lo=0.0, band=None):
    """Planking across v: `rows` strakes with dark seams; tar_lo darkens the lower part."""
    img = grain(seed, w, h, rgb)
    for r in range(rows + 1):
        y = min(h - 1, int(r * h / rows))
        img[y, :, :3] *= 0.45
    if tar_lo:
        img[int(h * (1 - tar_lo)):, :, :3] *= 0.35
    if band is not None:
        y0, y1, col = band
        img[int(h * y0):int(h * y1), :, :3] = np.array(col) * (0.85 + 0.2 * np.random.default_rng(seed).random((int(h * y1) - int(h * y0), w, 1)))
    return img


def brick(seed, w, h):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = (0.42, 0.20, 0.13)
    for r in range(0, h, 4):
        img[r, :, :3] = (0.55, 0.52, 0.46)
        off = 4 if (r // 4) % 2 else 0
        for c in range(off, w, 8):
            img[r:r + 4, c, :3] = (0.55, 0.52, 0.46)
    img[..., :3] *= (0.85 + 0.3 * rng.random((h, w)))[..., None]
    return img


def window_tex(seed, w, h):
    img = np.ones((h, w, 4))
    img[..., :3] = (0.05, 0.06, 0.07)
    img[..., :3] += np.random.default_rng(seed).random((h, w, 1)) * 0.04
    frame = (0.72, 0.70, 0.64)
    img[:1, :, :3] = frame
    img[-1:, :, :3] = frame
    img[:, :1, :3] = frame
    img[:, -1:, :3] = frame
    img[h // 2, :, :3] = frame
    img[:, w // 2, :3] = frame
    return img


def door_tex(seed, w, h, rgb):
    img = grain(seed, w, h, rgb, streaks=False)
    for c in range(0, w, 4):
        img[:, c, :3] *= 0.6
    img[h // 2:h // 2 + 1, :, :3] *= 0.6
    img[:2, :, :3] *= 0.6
    return img


def fish_tex(seed, w, h):
    """Herring and plaice in a basket: silver bodies on dark."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = (0.10, 0.10, 0.09)
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(26):
        cx, cy = rng.random() * w, rng.random() * h
        a = rng.random() * math.pi
        L, R = 5 + rng.random() * 3, 1.3 + rng.random() * 0.6
        u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
        v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
        m = (u / L) ** 2 + (v / R) ** 2 < 1
        tone = 0.55 + rng.random() * 0.25
        img[m, :3] = (tone, tone * 1.02, tone * 1.05)
        img[m & (v < -R * 0.3), :3] *= 0.6  # dark backs
    return img


def glass_tex(w, h):
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    img[..., 0] = 1.0
    img[..., 1] = 0.82 - 0.2 * d
    img[..., 2] = 0.5 - 0.3 * d
    img[0, :, :3] = img[-1, :, :3] = 0.1
    return img


def fire_tex(w, h):
    img = np.ones((h, w, 4))
    t = np.linspace(0, 1, h)[:, None] * np.ones((1, w))  # 0 at the top row
    img[..., 0] = 1.0
    img[..., 1] = 0.25 + 0.6 * t
    img[..., 2] = 0.05 + 0.3 * t ** 3
    return img


# ------------------------------------------------------------------ decals


def alpha_blob(rng, w, h, soft=0.35):
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx + 0.5 - w / 2) / (w / 2), (yy + 0.5 - h / 2) / (h / 2))
    n = vnoise(rng, w, h, 4, 4)
    return np.clip((1 - d + (n - 0.5) * 0.5) / soft, 0, 1)


def paint_net(seed):
    """Knotted net: tarred twine in diamonds, holes clear."""
    w, h = 32, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.20, 0.15, 0.10)
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((xx + yy) % 5 == 0) | ((xx - yy) % 5 == 0)
    img[m, 3] = 1
    img[..., :3] *= (0.8 + 0.4 * rng.random((h, w, 1)))
    return img



def paint_board(lines, seed, bg, fg, border=None):
    w = max(text_width(s) for s in lines) + 8
    h = 8 * len(lines) + 6
    img = grain(seed, w, h, bg, streaks=False)
    if border is not None:
        img[:1, :, :3] = border
        img[-1:, :, :3] = border
        img[:, :1, :3] = border
        img[:, -1:, :3] = border
    for i, s in enumerate(lines):
        draw_text(img, s, (w - text_width(s)) // 2, 3 + i * 8, (*fg, 1), 1, wear=np.random.default_rng(seed + 7 + i))
    return img


# ------------------------------------------------------------------ the atlases


class Atlas:
    """Shelf-packed atlas; cells are (x, y, w, h) in pixels from the top left."""

    def __init__(self, width):
        self.W = width
        self.items = []
        self.cells = {}

    def add(self, name, arr):
        self.items.append((name, arr))

    def pack(self):
        order = sorted(self.items, key=lambda it: (-it[1].shape[0], -it[1].shape[1]))
        x = y = shelf = 0
        placed = []
        for name, a in order:
            h, w = a.shape[:2]
            if x + w > self.W:
                x, y, shelf = 0, y + shelf, 0
            placed.append((name, a, x, y))
            self.cells[name] = (x, y, w, h)
            x += w
            shelf = max(shelf, h)
        H = 1
        while H < y + shelf:
            H *= 2
        self.H = H
        img = np.zeros((H, self.W, 4))
        for name, a, x0, y0 in placed:
            h, w = a.shape[:2]
            img[y0:y0 + h, x0:x0 + w] = a
        self.img = img
        return self

    def uv(self, name, u, v):
        x, y, w, h = self.cells[name]
        U = (x + 0.5 + min(max(u, 0.0), 1.0) * (w - 1)) / self.W
        row = y + 0.5 + (1 - min(max(v, 0.0), 1.0)) * (h - 1)
        return (U, 1 - row / self.H)


def bl_image(name, arr, alpha):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    rgba = np.clip(arr[::-1], 0, 1).astype(np.float32).copy()
    if not alpha:
        rgba[..., 3] = 1
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img





def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def fit_uv(pts):
    n = newell(pts)
    n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
    if abs(n.z) < 0.7:
        va = Vector((0, 0, 1))
        va = (va - n * va.dot(n)).normalized()
        ua = va.cross(n)
    else:
        e = max(((pts[(i + 1) % len(pts)] - pts[i]) for i in range(len(pts))), key=lambda v: v.length)
        ua = (e - n * e.dot(n)).normalized()
        va = n.cross(ua)
    c = [(p.dot(ua), p.dot(va)) for p in pts]
    u0, u1 = min(a for a, _ in c), max(a for a, _ in c)
    v0, v1 = min(b for _, b in c), max(b for _, b in c)
    return [((a - u0) / max(u1 - u0, 1e-6), (b - v0) / max(v1 - v0, 1e-6)) for a, b in c]


class Mesh:
    """bmesh with atlas cells: every face gets a cell name and cell-local uvs (0..1)."""

    def __init__(self, ao=0.0):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.xf = Matrix.Identity(4)
        self.ao = ao

    def at(self, M):
        m = self

        class Ctx:
            def __enter__(self_):
                self_.old = m.xf
                m.xf = m.xf @ M

            def __exit__(self_, *a):
                m.xf = self_.old

        return Ctx()

    def face(self, pts, cell, uvs=None, mat=SOLID, shade=1.0, out=None):
        pts = [Vector(p) for p in pts]
        if out is not None and newell(pts).dot(Vector(out)) < 0:
            pts = pts[::-1]
            if uvs:
                uvs = uvs[::-1]
        uvs = uvs or fit_uv(pts)
        vs = [self.bm.verts.new(self.xf @ p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        atlas = DECAL_ATLAS if mat == DECAL else SOLID_ATLAS
        for loop, (u, v), p in zip(f.loops, uvs, pts):
            loop[self.uv].uv = atlas.uv(cell, u, v)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, (self.xf @ p).z / self.ao))
            loop[self.col] = (s, s, s, 1.0)
        return f

    def quad(self, pts, cell, mat=SOLID, shade=1.0, out=None):
        return self.face(pts, cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=mat, shade=shade, out=out)

    def box(self, c, size, cell, shade=1.0, cells=None, skip=()):
        """Axis box; cells may override per face: keys -x +x -y +y -z +z."""
        cx, cy, cz = c
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        P = [Vector((cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz))) for i in range(8)]
        faces = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
        for k, idx in faces.items():
            if k in skip:
                continue
            ce = (cells or {}).get(k, cell)
            self.face([P[i] for i in idx], ce, shade=shade * (0.8 if k == "-z" else 1.0))

    def beam(self, a, b, w, h, cell, shade=1.0, side=None, ends=True):
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        s = Vector(side) if side else Vector((0, 0, 1)).cross(t)
        if s.length < 1e-4:
            s = Vector((1, 0, 0))
        s = (s - t * s.dot(t)).normalized()
        k = s.cross(t)
        P = []
        for i in range(8):
            base = b if i & 2 else a
            P.append(base + s * (w / 2 if i & 1 else -w / 2) + k * (h / 2 if i & 4 else -h / 2))
        idxs = [(0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        if ends:
            idxs += [(0, 2, 3, 1), (4, 5, 7, 6)]
        mid = (a + b) / 2
        for idx in idxs:
            pts = [P[i] for i in idx]
            c = sum(pts, Vector()) / 4
            self.face(pts, cell, shade=shade, out=c - mid if (c - mid).length > 1e-6 else None)

    def lathe(self, prof, sides, cell, rot=0.0, cap0=False, cap1=False, shade=1.0, arc=None, cells=None, M=None, cap_cell=None):
        """Turned shape about +Z; profile (r, z) bottom to top."""
        if M is not None:
            with self.at(M):
                return self.lathe(prof, sides, cell, rot=rot, cap0=cap0, cap1=cap1, shade=shade, arc=arc, cells=cells, cap_cell=cap_cell)
        a0, a1 = arc if arc else (0.0, 2 * math.pi)
        full = arc is None
        n = sides if full else sides + 1
        rings = [[Vector((r * math.cos(rot + a0 + (a1 - a0) * i / sides), r * math.sin(rot + a0 + (a1 - a0) * i / sides), z)) for i in range(n)]
                 for r, z in prof]
        L = [0.0]
        for j in range(1, len(prof)):
            L.append(L[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
        tot = L[-1] or 1
        for j in range(len(rings) - 1):
            ce = cells[j] if cells else cell
            for i in range(sides):
                i1 = (i + 1) % n
                pts = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
                uvs = [(i / sides, L[j] / tot), ((i + 1) / sides, L[j] / tot), ((i + 1) / sides, L[j + 1] / tot), (i / sides, L[j + 1] / tot)]
                mid = sum(pts, Vector()) / 4
                self.face(pts, ce, uvs=uvs, shade=shade, out=mid - Vector((0, 0, mid.z)))
        if cap0 and full and prof[0][0] > 1e-4:
            self.face(rings[0], cap_cell or (cells[0] if cells else cell), shade=shade * 0.8, out=(0, 0, -1))
        if cap1 and full and prof[-1][0] > 1e-4:
            self.face(rings[-1], cap_cell or (cells[-1] if cells else cell), shade=shade, out=(0, 0, 1))

    def tube(self, path, r, sides, cell, closed=False, shade=1.0, up=None):
        path = [Vector(p) for p in path]
        N = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed:
                t = path[(k + 1) % N] - path[(k - 1) % N]
            else:
                t = path[min(k + 1, N - 1)] - path[max(k - 1, 0)]
            t.normalize()
            s = Vector(up) if up else Vector((1, 0, 0))
            if abs(s.dot(t)) > 0.9:
                s = Vector((0, 1, 0)) if not up else Vector((1, 0, 0))
            s = (s - t * s.dot(t)).normalized()
            b = t.cross(s)
            rings.append([p + s * r * math.cos(2 * math.pi * i / sides) + b * r * math.sin(2 * math.pi * i / sides) for i in range(sides)])
        seg = range(N) if closed else range(N - 1)
        for j in seg:
            j1 = (j + 1) % N
            for i in range(sides):
                i1 = (i + 1) % sides
                pts = [rings[j][i], rings[j][i1], rings[j1][i1], rings[j1][i]]
                mid = sum(pts, Vector()) / 4
                c = (path[j] + path[j1]) / 2
                self.face(pts, cell, uvs=[(i / sides, 0), ((i + 1) / sides, 0), ((i + 1) / sides, 1), (i / sides, 1)], shade=shade, out=mid - c)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT_NAMES:
            me.materials.append(bpy.data.materials[m])
        try:
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (KeyError, AttributeError):
            pass
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def move(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def rot(axis, a):
    return Matrix.Rotation(a, 4, axis)


def ring_path(r, n, cx=0.0, cy=0.0, cz=0.0, plane="xz", ry=None):
    """A closed loop of n points: in the x-z plane (hanging on a wall) or x-y (lying)."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        if plane == "xz":
            out.append((cx + r * math.cos(a), cy, cz + (ry or r) * math.sin(a)))
        else:
            out.append((cx + r * math.cos(a), cy + (ry or r) * math.sin(a), cz))
    return out


# ------------------------------------------------------------------ models: the wall face


# ------------------------------------------------------------------ own textures


def bumpy(seed, w, h, rgb, dark=0.55, n=18, rmin=2.0, rmax=4.0, ground=(0.10, 0.09, 0.07)):
    """Round things heaped: potatoes, apples, cabbages, cheeses seen from above."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = ground
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(n):
        cx, cy = rng.random() * w, rng.random() * h
        r = rmin + rng.random() * (rmax - rmin)
        d = np.hypot(xx - cx, yy - cy) / r
        m = d < 1
        tone = (0.75 + 0.35 * rng.random()) * (1 - dark * d[m] ** 2)
        img[m, :3] = np.array(rgb) * tone[:, None]
    return img


def coat(seed, w, h, rgb):
    """A horse's coat: soft value noise, darker along the top."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, w, h, 4, 4) * 0.6 + vnoise(rng, w, h, 12, 12) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (0.82 + 0.3 * n)[..., None]
    img[: h // 5, :, :3] *= 0.8
    return img


def canvas_tex(seed, w, h, rgb, seams=4):
    img = weave(seed, w, h, rgb)
    for k in range(1, seams):
        x = int(k * w / seams)
        img[:, x, :3] *= 0.7
    return img


def paint_leaves(seed):
    """Cabbage leaves and straw on the stones."""
    w, h = 32, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(7):
        cx, cy = rng.random() * w, rng.random() * h
        r = 3 + rng.random() * 3
        d = np.hypot((xx - cx) / r, (yy - cy) / (r * 0.7))
        m = d < 1
        g = 0.28 + 0.2 * rng.random()
        img[m, :3] = (g * 0.7, g * 1.2, g * 0.45)
        img[m & (np.abs(xx - cx) < 0.6), :3] = (0.6, 0.66, 0.46)  # the rib
        img[m, 3] = 1
    for _ in range(26):
        x0, y0 = rng.random() * w, rng.random() * h
        a = rng.random() * math.pi
        for t in range(6):
            x, y = int(x0 + math.cos(a) * t), int(y0 + math.sin(a) * t)
            if 0 <= x < w and 0 <= y < h:
                img[y, x] = (0.62, 0.52, 0.28, 1)
    return img


def paint_scraps(seed):
    """Fish heads, guts and scales in a wet patch."""
    w, h = 32, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.06, 0.07, 0.07)
    img[..., 3] = alpha_blob(rng, w, h, 0.5) * 0.55
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(9):
        cx, cy = 6 + rng.random() * (w - 12), 6 + rng.random() * (h - 12)
        a = rng.random() * math.pi
        u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
        v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
        m = (u / 3.2) ** 2 + (v / 1.4) ** 2 < 1
        t = 0.5 + rng.random() * 0.3
        img[m, :3] = (t, t, t * 1.05)
        img[m & (u > 1.8), :3] = (0.42, 0.12, 0.10)  # the cut
        img[m, 3] = 1
    return img


def paint_shoes(seed):
    """Horseshoes hung on nails on a board."""
    w, h = 32, 16
    img = grain(seed, w, h, (0.30, 0.22, 0.15), streaks=False)
    yy, xx = np.mgrid[0:h, 0:w]
    for i in range(4):
        for j in range(2):
            cx, cy = 4 + i * 8, 4 + j * 8
            d = np.hypot((xx - cx) / 2.8, (yy - cy) / 3.2)
            m = (d < 1) & (d > 0.55) & (yy < cy + 2)
            img[m, :3] = (0.12, 0.12, 0.12)
    return img


PLAIN = {
    "iron": ((0.10, 0.10, 0.11), 0.3),
    "iron_light": ((0.24, 0.24, 0.25), 0.25),
    "black": ((0.05, 0.05, 0.05), 0.2),
    "tar": ((0.07, 0.06, 0.05), 0.3),
    "ash": ((0.22, 0.21, 0.20), 0.3),
    "water": ((0.10, 0.13, 0.14), 0.2),
    "paper": ((0.74, 0.70, 0.60), 0.12),
    "cloth_red": ((0.46, 0.14, 0.10), 0.18),
    "cloth_blue": ((0.20, 0.26, 0.38), 0.18),
    "cloth_white": ((0.72, 0.70, 0.64), 0.12),
    "leather": ((0.26, 0.16, 0.09), 0.25),
    "copper": ((0.50, 0.30, 0.16), 0.25),
    "stone": ((0.34, 0.34, 0.33), 0.25),
    "bluestone": ((0.28, 0.30, 0.32), 0.25),
    "gull": ((0.82, 0.82, 0.80), 0.08),
    "gull_grey": ((0.46, 0.49, 0.52), 0.1),
    "beak": ((0.78, 0.62, 0.20), 0.1),
    "hoof": ((0.14, 0.12, 0.10), 0.2),
    "mane": ((0.08, 0.06, 0.05), 0.25),
    "carrot": ((0.70, 0.36, 0.10), 0.2),
    "bread": ((0.56, 0.36, 0.16), 0.25),
    "canvas": ((0.62, 0.59, 0.50), 0.12),
    "sail_tan": ((0.48, 0.24, 0.13), 0.18),
    "hemp": ((0.66, 0.58, 0.40), 0.2),
    "oakum": ((0.38, 0.30, 0.20), 0.3),
    "shavings": ((0.70, 0.58, 0.38), 0.3),
}

# Signs. Plain English; Dutch only in names.
SIGNS = {
    "boatyard": (["J. DE KEYSER", "BOATS REPAIRED"], (0.10, 0.16, 0.20), (0.88, 0.84, 0.70)),
    "farrier": (["K. WOUTERS", "FARRIER"], (0.30, 0.08, 0.06), (0.90, 0.84, 0.66)),
    "ropewalk": (["H. VERHAEGEN", "ROPE WALK"], (0.10, 0.12, 0.10), (0.84, 0.80, 0.64)),
    "cooper": (["J. HUYGHE", "COOPER"], (0.30, 0.22, 0.14), (0.92, 0.88, 0.76)),
    "sailmaker": (["L. MAES", "SAILMAKER"], (0.80, 0.78, 0.70), (0.12, 0.12, 0.16)),
    "nets": (["WED. CLAES", "NETS MENDED"], (0.14, 0.22, 0.28), (0.90, 0.88, 0.80)),
}
PX = 0.022  # metres per texel of sign lettering

SOLID_ATLAS = Atlas(256)
DECAL_ATLAS = Atlas(128)


def build_atlases():
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        SOLID_ATLAS.add(name, flat(100 + i, 16, 16, rgb, amt))
    SOLID_ATLAS.add("iron_rust", rusty(150, 32, 32, (0.09, 0.09, 0.10)))
    SOLID_ATLAS.add("wood", grain(160, 32, 32, (0.40, 0.31, 0.21)))
    SOLID_ATLAS.add("wood_dark", grain(161, 32, 32, (0.20, 0.15, 0.10)))
    SOLID_ATLAS.add("wood_grey", grain(162, 32, 32, (0.42, 0.40, 0.36)))
    SOLID_ATLAS.add("oak", grain(163, 32, 32, (0.30, 0.24, 0.17)))
    SOLID_ATLAS.add("new_wood", grain(164, 32, 32, (0.62, 0.50, 0.34)))
    SOLID_ATLAS.add("endgrain", flat(165, 16, 16, (0.46, 0.36, 0.24), 0.3))
    SOLID_ATLAS.add("rope", rope_tex(170, 16, 16, (0.50, 0.42, 0.30)))
    SOLID_ATLAS.add("yarn", rope_tex(171, 16, 16, (0.70, 0.62, 0.44)))
    SOLID_ATLAS.add("wicker", wicker(180, 32, 32, (0.55, 0.44, 0.26)))
    SOLID_ATLAS.add("wicker_dark", wicker(181, 32, 32, (0.36, 0.28, 0.17)))
    SOLID_ATLAS.add("jute", weave(190, 32, 32, (0.56, 0.47, 0.32)))
    SOLID_ATLAS.add("fish", fish_tex(240, 32, 32))
    SOLID_ATLAS.add("potato", bumpy(241, 32, 32, (0.52, 0.40, 0.24), n=30, rmin=2, rmax=3.5))
    SOLID_ATLAS.add("apple", bumpy(242, 32, 32, (0.62, 0.16, 0.10), n=26, rmin=2.5, rmax=3.5))
    SOLID_ATLAS.add("cabbage", bumpy(243, 32, 32, (0.36, 0.52, 0.26), dark=0.4, n=10, rmin=4, rmax=6))
    SOLID_ATLAS.add("cheese", flat(244, 16, 16, (0.80, 0.62, 0.22), 0.15))
    SOLID_ATLAS.add("cheese_rind", flat(245, 16, 16, (0.62, 0.18, 0.10), 0.15))
    SOLID_ATLAS.add("brick", brick(220, 32, 32))
    SOLID_ATLAS.add("hull_side", planks(211, 32, 32, (0.30, 0.24, 0.16), 5, band=(0.0, 0.2, (0.14, 0.26, 0.20))))
    SOLID_ATLAS.add("hull_in", planks(212, 32, 32, (0.46, 0.36, 0.24), 5))
    SOLID_ATLAS.add("hull_tar", planks(213, 32, 32, (0.2, 0.16, 0.12), 5))
    SOLID_ATLAS.add("roof_planks", planks(214, 32, 64, (0.24, 0.20, 0.16), 6))
    SOLID_ATLAS.add("horse", coat(260, 32, 32, (0.36, 0.22, 0.12)))
    SOLID_ATLAS.add("canvas_seams", canvas_tex(261, 32, 32, (0.66, 0.63, 0.54)))
    SOLID_ATLAS.add("coal_glow", bumpy(262, 16, 16, (1.0, 0.45, 0.10), dark=0.6, n=14, rmin=1.5, rmax=2.5, ground=(0.25, 0.05, 0.02)))
    SOLID_ATLAS.add("fire", fire_tex(8, 16))
    SOLID_ATLAS.add("shoes", paint_shoes(263))
    for i, (key, (lines, bg, fg)) in enumerate(SIGNS.items()):
        SOLID_ATLAS.add(f"sign_{key}", paint_board(lines, 300 + i, bg, fg, border=tuple(np.array(fg) * 0.8)))
    DECAL_ATLAS.add("net", paint_net(504))
    DECAL_ATLAS.add("leaves", paint_leaves(505))
    DECAL_ATLAS.add("scraps", paint_scraps(506))
    SOLID_ATLAS.pack()
    DECAL_ATLAS.pack()


def make_materials():
    solid = bl_image("tr_solid_tex", SOLID_ATLAS.img, False)
    decal = bl_image("tr_decal_tex", DECAL_ATLAS.img, True)
    for name, img in zip(MAT_NAMES, [solid, decal, solid]):
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except AttributeError:
            pass
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if img is decal:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ small parts


def sign_board(m, key, c, face=(0, -1, 0), scale=1.0):
    """A painted board, centred at c, its face toward `face` (and painted on the back too)."""
    x, y, w, h = SOLID_ATLAS.cells[f"sign_{key}"]
    W, H = w * PX * scale, h * PX * scale
    fx, fy = face[0], face[1]
    sx, sy = -fy, fx  # along the board
    cx, cy, cz = c
    t = 0.03
    for s in (1, -1):
        px, py = cx + fx * t * s, cy + fy * t * s
        pts = [(px - sx * W / 2, py - sy * W / 2, cz - H / 2), (px + sx * W / 2, py + sy * W / 2, cz - H / 2),
               (px + sx * W / 2, py + sy * W / 2, cz + H / 2), (px - sx * W / 2, py - sy * W / 2, cz + H / 2)]
        if s == -1:
            pts = [pts[1], pts[0], pts[3], pts[2]]
        m.face(pts, f"sign_{key}", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], out=(fx * s, fy * s, 0))
    m.beam((cx - sx * W / 2, cy - sy * W / 2, cz + H / 2 + 0.02), (cx + sx * W / 2, cy + sy * W / 2, cz + H / 2 + 0.02), 0.07, 0.04, "wood_dark")
    return W, H


def post_sign(m, key, x, y, h=1.9, face=(0, -1, 0)):
    """A signboard on two posts."""
    W, H = SOLID_ATLAS.cells[f"sign_{key}"][2] * PX, SOLID_ATLAS.cells[f"sign_{key}"][3] * PX
    sx, sy = -face[1], face[0]
    for s in (-1, 1):
        px, py = x + sx * (W / 2 + 0.04) * s, y + sy * (W / 2 + 0.04) * s
        m.beam((px, py, 0), (px, py, h + 0.05), 0.07, 0.07, "wood_dark")
    sign_board(m, key, (x, y, h - H / 2), face)


def crate(m, c, size=(0.6, 0.4, 0.3), a=0.0, top="wood_grey", open_=False):
    with m.at(move(*c) @ rot("Z", a)):
        m.box((0, 0, size[2] / 2), size, "wood_grey", cells={"+z": top})
        if open_:
            # a slat across the top: the box has no lid
            m.box((0, 0, size[2] + 0.005), (size[0], 0.05, 0.01), "wood_dark")


def basket(m, c, r=0.32, h=0.2, fill="fish", cell="wicker", a=0.0):
    with m.at(move(*c) @ rot("Z", a)):
        m.lathe([(r * 0.75, 0.0), (r, h), (r * 1.02, h + 0.02)], 8, cell)
        # the floor 1.5 cm up: on the ground it lay in the ground's plane (the material is two-sided; z-fight check)
        m.face([(r * 0.76 * math.cos(2 * math.pi * i / 8), r * 0.76 * math.sin(2 * math.pi * i / 8), 0.015) for i in range(8)], cell, shade=0.8, out=(0, 0, 1))
        if fill:
            m.lathe([(r * 0.98, h - 0.02), (r * 0.6, h + 0.05), (0.0, h + 0.07)], 8, fill)


def lump(m, c, r, cell, squash=0.8, sides=6):
    """A round thing (cabbage, cheese, potato): a squashed double cone."""
    with m.at(move(*c)):
        m.lathe([(0.0, 0.0), (r * 0.8, r * 0.35 * squash), (r, r * squash), (r * 0.7, r * 1.6 * squash), (0.0, r * 1.8 * squash)], sides, cell)


def wheel(m, c, r, w, cell="wood_dark", sides=8, axis="X"):
    """A wheel standing up, its axle along x (or y)."""
    M = move(*c) @ (rot("Y", math.pi / 2) if axis == "X" else rot("X", math.pi / 2))
    m.lathe([(r * 0.2, -w / 2), (r, -w / 2), (r, w / 2), (r * 0.2, w / 2)], sides, cell, M=M, cap0=False, cap1=False)
    m.lathe([(0.0, -w / 2 - 0.01), (r * 0.98, -w / 2 - 0.005)], sides, "wood", M=M)
    m.lathe([(r * 0.98, w / 2 + 0.005), (0.0, w / 2 + 0.01)], sides, "wood", M=M)


def trestle(m, x, y, h, span=1.4, cell="wood_grey"):
    m.beam((x, y - span / 2, h), (x, y + span / 2, h), 0.1, 0.1, cell)
    for sy in (-1, 1):
        m.beam((x - 0.25, y + sy * span * 0.38, 0.0), (x, y + sy * span * 0.38, h), 0.06, 0.06, cell)
        m.beam((x + 0.25, y + sy * span * 0.38, 0.0), (x, y + sy * span * 0.38, h), 0.06, 0.06, cell)


def flames(m, c, r, h, n=3):
    cx, cy, cz = c
    for k in range(n):
        a = k * math.pi / n
        ca, sa = math.cos(a), math.sin(a)
        pts = [(cx - r * ca, cy - r * sa, cz), (cx + r * ca, cy + r * sa, cz), (cx + r * 0.5 * ca, cy + r * 0.5 * sa, cz + h * 0.6),
               (cx + 0.1 * r * ca, cy + 0.1 * r * sa, cz + h * (1 - 0.1 * k)), (cx - r * 0.4 * ca, cy - r * 0.4 * sa, cz + h * 0.7)]
        m.face(pts, "fire", uvs=[(0, 0), (1, 0), (0.8, 0.6), (0.5, 1), (0.2, 0.7)], mat=GLOW)


def disc(m, c, r, cell, mat=GLOW, n=6):
    pts = [(c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n), c[2]) for i in range(n)]
    m.face(pts, cell, uvs=[(0.5 + 0.5 * math.cos(2 * math.pi * i / n), 0.5 + 0.5 * math.sin(2 * math.pi * i / n)) for i in range(n)], mat=mat, out=(0, 0, 1))


def fish_top(m, c, w, d):
    cx, cy, cz = c
    m.quad([(cx - w / 2, cy - d / 2, cz), (cx + w / 2, cy - d / 2, cz), (cx + w / 2, cy + d / 2, cz), (cx - w / 2, cy + d / 2, cz)], "fish", out=(0, 0, 1))


def ground_decal(m, cell, c, w, d, a=0.0, y=0.006):
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for lx, ly in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        pts.append((c[0] + lx * ca - ly * sa, c[1] + lx * sa + ly * ca, y))
    m.face(pts, cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, 0, 1))


# ------------------------------------------------------------------ the market


def mk_crates():
    """Two or three fish boxes stacked behind a stall, the top one open with fish."""
    m = Mesh(ao=0.8)
    crate(m, (0, 0, 0), a=0.05)
    crate(m, (0.02, 0.01, 0.3), a=-0.08)
    crate(m, (0.65, 0.05, 0), (0.6, 0.4, 0.3), a=0.2, top="fish", open_=True)
    return m


def mk_fishbox():
    m = Mesh(ao=0.3)
    crate(m, (0, 0, 0), (0.62, 0.42, 0.22), top="fish", open_=True)
    return m


def mk_basket_fish():
    m = Mesh(ao=0.3)
    basket(m, (0, 0, 0), 0.34, 0.18, "fish")
    basket(m, (0.55, 0.25, 0), 0.3, 0.16, "fish", "wicker_dark")
    return m


def mk_basket_veg():
    m = Mesh(ao=0.4)
    basket(m, (0, 0, 0), 0.32, 0.28, "potato")
    basket(m, (0.6, -0.1, 0), 0.3, 0.24, None, "wicker_dark")
    for i, (x, y) in enumerate(((0.52, -0.16), (0.7, -0.02), (0.6, -0.2))):
        lump(m, (x, y, 0.12 + 0.05 * i), 0.12, "cabbage")
    # a bunch of carrots lying by it
    for k in range(3):
        m.beam((-0.2 + k * 0.05, -0.45, 0.03), (0.15 + k * 0.05, -0.55, 0.02), 0.04, 0.04, "carrot")
    return m


def mk_basket_tall():
    m = Mesh(ao=0.6)
    m.lathe([(0.2, 0.0), (0.26, 0.45), (0.27, 0.47)], 8, "wicker", cap0=True)
    m.lathe([(0.26, 0.44), (0.18, 0.5), (0.0, 0.52)], 8, "cloth_white")
    m.tube([(-0.22, 0, 0.46), (0, 0, 0.72), (0.22, 0, 0.46)], 0.018, 3, "wicker_dark")
    return m


def mk_stool():
    m = Mesh()
    m.lathe([(0.17, 0.42), (0.17, 0.46), (0.0, 0.46)], 8, "wood", cap0=True)
    for i in range(3):
        a = i * 2 * math.pi / 3
        m.beam((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.42), (math.cos(a) * 0.19, math.sin(a) * 0.19, 0.0), 0.04, 0.04, "wood_dark")
    return m


def barrow(m, load):
    """A wooden wheelbarrow, the wheel at +x, the handles back to -x."""
    # the tray: sloping sides
    x0, x1, w0, w1 = -0.55, 0.45, 0.32, 0.4
    z0, z1 = 0.32, 0.62
    P = [(x0, -w0, z0), (x1, -w0, z0), (x1, w0, z0), (x0, w0, z0)]
    Q = [(x0 - 0.12, -w1, z1), (x1 + 0.12, -w1, z1), (x1 + 0.12, w1, z1), (x0 - 0.12, w1, z1)]
    m.face(P, "wood", out=(0, 0, 1))
    for i in range(4):
        j = (i + 1) % 4
        mid = Vector(((P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2, 0))
        m.face([P[i], P[j], Q[j], Q[i]], "wood", out=tuple(mid))
        m.face([Q[i], Q[j], P[j], P[i]], "wood_dark", shade=0.6, out=tuple(-mid))
    for sy in (-1, 1):
        m.beam((0.72, sy * 0.1, 0.22), (-1.25, sy * 0.3, 0.55), 0.05, 0.05, "wood_dark")
        m.beam((-0.5, sy * 0.28, 0.4), (-0.55, sy * 0.3, 0.0), 0.05, 0.05, "wood_dark")
    wheel(m, (0.72, 0, 0.22), 0.22, 0.08, "wood_dark", 8, axis="Y")
    if load == "fish":
        fish_top(m, (-0.05, 0, 0.58), 0.95, 0.66)
        basket(m, (-0.3, 0.05, 0.58), 0.22, 0.12, "fish")
    elif load == "veg":
        m.quad([(-0.6, -0.36, 0.58), (0.5, -0.36, 0.58), (0.5, 0.36, 0.58), (-0.6, 0.36, 0.58)], "potato", out=(0, 0, 1))
        for x, y in ((-0.25, -0.12), (0.1, 0.1), (0.2, -0.15)):
            lump(m, (x, y, 0.56), 0.13, "cabbage")


def mk_barrow_fish():
    m = Mesh(ao=0.6)
    barrow(m, "fish")
    return m


def mk_barrow_veg():
    m = Mesh(ao=0.6)
    barrow(m, "veg")
    return m


def mk_cart():
    """A two-wheeled costermonger's cart with baskets and a box, the shafts down on the stones."""
    m = Mesh(ao=0.8)
    m.box((0, 0, 0.62), (1.5, 0.9, 0.06), "wood")
    for sy in (-1, 1):
        m.box((0, sy * 0.45, 0.72), (1.5, 0.04, 0.16), "wood_dark")
        m.beam((0.75, sy * 0.3, 0.6), (1.9, sy * 0.28, 0.02), 0.06, 0.06, "wood_dark")
        wheel(m, (-0.05, sy * 0.55, 0.45), 0.45, 0.07, "wood_dark", 10, axis="Y")
    m.beam((-0.05, -0.55, 0.45), (-0.05, 0.55, 0.45), 0.05, 0.05, "iron")
    m.beam((-0.7, 0, 0.62), (-0.85, 0, 0.0), 0.05, 0.05, "wood_dark")
    basket(m, (-0.4, -0.2, 0.65), 0.24, 0.22, "apple")
    basket(m, (0.1, 0.18, 0.65), 0.26, 0.2, "potato", "wicker_dark")
    crate(m, (0.45, -0.18, 0.65), (0.5, 0.36, 0.26), top="cabbage")
    return m


def mk_spilled():
    """A crate tipped over, potatoes and apples rolled out over the stones."""
    m = Mesh(ao=0.3)
    with m.at(move(0, 0, 0.2) @ rot("Y", 1.35)):
        m.box((0, 0, 0), (0.6, 0.42, 0.3), "wood_grey", cells={"-x": "potato"})
    rng = np.random.default_rng(5)
    for i in range(12):
        a = rng.random() * 1.6 - 0.8
        d = 0.35 + rng.random() * 0.9
        lump(m, (0.35 + math.cos(a) * d, math.sin(a) * d, 0.0), 0.05 + rng.random() * 0.02, "apple" if i % 3 == 0 else "potato", sides=4)
    ground_decal(m, "leaves", (0.6, 0.1), 1.3, 1.0, 0.4)
    return m


def mk_leaves():
    m = Mesh()
    ground_decal(m, "leaves", (0, 0), 1.4, 1.0, 0.3)
    ground_decal(m, "leaves", (0.9, 0.5), 0.9, 0.7, -0.6, 0.007)
    return m


def mk_scraps():
    m = Mesh()
    ground_decal(m, "scraps", (0, 0), 1.2, 1.0, 0.2)
    return m


def mk_goods_cheese():
    """Cheeses on a board: whole wheels, one cut. Stands on its origin (the table top)."""
    m = Mesh()
    m.box((0, 0, 0.015), (1.6, 0.6, 0.03), "wood")
    for i, (x, y, r, h) in enumerate(((-0.55, 0.0, 0.2, 0.12), (-0.12, 0.08, 0.22, 0.12), (-0.14, 0.06, 0.2, 0.1), (0.32, -0.05, 0.17, 0.1),
                                      (0.62, 0.1, 0.13, 0.13))):
        z = 0.03 + (0.12 if i == 2 else 0)
        m.lathe([(r * 0.9, z), (r, z + 0.02), (r, z + h - 0.02), (r * 0.9, z + h)], 8, "cheese_rind", M=move(x, y, 0))
        m.lathe([(r * 0.9, z + h), (0.0, z + h)], 8, "cheese", M=move(x, y, 0))
    return m


def mk_goods_baskets():
    """Wicker baskets for sale, stacked and hung. Origin: the table top."""
    m = Mesh()
    for i, (x, y) in enumerate(((-0.55, 0.0), (0.0, 0.05), (0.55, -0.02))):
        for k in range(3 - i % 2):
            m.lathe([(0.18, k * 0.1), (0.25, 0.14 + k * 0.1), (0.26, 0.15 + k * 0.1)], 8, "wicker" if (i + k) % 2 else "wicker_dark", M=move(x, y, 0), cap0=(k == 0))
    m.lathe([(0.12, 0.0), (0.16, 0.3), (0.17, 0.31)], 6, "wicker", M=move(0.3, 0.2, 0), cap0=True)
    return m


def mk_goods_junk():
    """Second-hand goods: pots, a kettle, boots, a clock, bundled cloth, a lamp. Origin: the table top."""
    m = Mesh()
    m.lathe([(0.1, 0.0), (0.13, 0.12), (0.11, 0.2), (0.05, 0.24), (0.0, 0.25)], 6, "copper", M=move(-0.6, 0.05, 0), cap0=True)
    m.beam((-0.6, 0.18, 0.12), (-0.6, 0.25, 0.2), 0.03, 0.03, "copper")
    m.lathe([(0.12, 0.0), (0.12, 0.14), (0.13, 0.15)], 6, "iron", M=move(-0.25, -0.1, 0), cap0=True)
    for sx in (0, 0.14):
        m.box((0.05 + sx, 0.1, 0.1), (0.1, 0.25, 0.2), "leather")
        m.box((0.05 + sx, 0.0, 0.04), (0.1, 0.12, 0.08), "leather")
    m.box((0.45, 0.05, 0.16), (0.2, 0.12, 0.32), "wood_dark")
    m.lathe([(0.07, 0.0), (0.0, 0.0)], 8, "paper", M=move(0.45, -0.011, 0.22) @ rot("X", math.pi / 2))
    m.box((0.72, -0.05, 0.07), (0.3, 0.3, 0.14), "cloth_blue")
    m.box((0.7, 0.0, 0.18), (0.26, 0.26, 0.08), "cloth_red")
    return m


def mk_bench():
    """A fish bench: a stone slab on two stone blocks, fish laid out on it."""
    m = Mesh(ao=0.8)
    m.box((0, 0, 0.74), (2.2, 0.8, 0.1), "bluestone")
    for sx in (-0.85, 0.85):
        m.box((sx, 0, 0.345), (0.26, 0.6, 0.69), "bluestone")
    fish_top(m, (0, 0, 0.795), 2.0, 0.66)
    basket(m, (0.6, 0.1, 0.79), 0.2, 0.1, "fish")
    return m


def mk_gull():
    """A herring gull standing, beak toward -y."""
    m = Mesh()
    m.lathe([(0.0, 0.0), (0.07, 0.05), (0.09, 0.14), (0.08, 0.24), (0.05, 0.3), (0.0, 0.32)], 5, "gull",
            M=move(0, 0.02, 0.1) @ rot("X", -1.2))
    m.lathe([(0.0, 0.0), (0.045, 0.03), (0.04, 0.08), (0.0, 0.1)], 5, "gull", M=move(0, -0.13, 0.22))
    m.beam((0, -0.2, 0.25), (0, -0.27, 0.24), 0.02, 0.02, "beak")
    for sx in (-1, 1):
        m.face([(sx * 0.07, -0.08, 0.2), (sx * 0.08, 0.2, 0.17), (sx * 0.04, 0.3, 0.14), (sx * 0.06, -0.02, 0.13)], "gull_grey", out=(sx, 0, 0.3))
        m.beam((sx * 0.03, 0.0, 0.1), (sx * 0.03, 0.0, 0.0), 0.012, 0.012, "beak")
    return m


# ------------------------------------------------------------------ boat repair yard


def boat_upright(m, L, B, D):
    """A clinker rowing boat keel down: stations along x, open at the top."""
    stations, half = 9, 5
    secs = []
    for i in range(stations):
        t = i / (stations - 1)
        x = -L / 2 + L * t
        w = B / 2 * (math.sin(math.pi * t) ** 0.55)
        d = D * (0.62 + 0.38 * math.sin(math.pi * t) ** 0.4)
        sec = []
        for j in range(half):
            a = j / (half - 1) * math.pi / 2  # 0 at the gunwale, pi/2 at the keel
            sec.append((w * math.cos(a) ** 0.8, D - d * math.sin(a) ** 1.3))
        secs.append((x, sec))
    for i in range(stations - 1):
        (xa, sa), (xb, sb) = secs[i], secs[i + 1]
        for side in (-1, 1):
            for j in range(half - 1):
                q = [(xa, side * sa[j][0], sa[j][1]), (xb, side * sb[j][0], sb[j][1]), (xb, side * sb[j + 1][0], sb[j + 1][1]),
                     (xa, side * sa[j + 1][0], sa[j + 1][1])]
                outc = "hull_side" if j < 2 else "hull_tar"
                m.face(q, outc, out=(0, side, -0.4))
                # the inside 2.5 cm in (the planking): in the same plane the two-sided faces fought (z-fight check)
                qn = newell([Vector(p) for p in q]).normalized()
                if qn.dot(Vector((0, side, -0.4))) < 0:
                    qn = -qn
                m.face([Vector(p) - qn * 0.025 for p in q[::-1]], "hull_in", shade=0.7)
    m.beam((-L / 2 - 0.05, 0, 0.03), (L / 2 + 0.05, 0, 0.03), 0.07, 0.08, "wood_dark")
    for x in (-L * 0.3, 0.0, L * 0.3):
        m.box((x, 0, D - 0.2), (0.22, B * 0.85, 0.04), "wood")  # thwarts


def tr_boatyard():
    m = Mesh(ao=1.2)
    # the rowing boat on chocks, being caulked; a new strake lies ready
    for x in (-1.2, 0.0, 1.2):
        m.box((x, 0, 0.14), (0.25, 0.9, 0.28), "wood_dark")
    with m.at(move(0, 0, 0.28)):
        boat_upright(m, 4.4, 1.4, 0.62)
    m.beam((-2.0, -0.9, 0.3), (2.0, -0.95, 0.35), 0.18, 0.025, "new_wood")
    # the punt, upturned on two trestles behind
    for x in (-1.3, 1.3):
        trestle(m, x, 2.4, 0.7)
    m.box((0, 2.4, 0.86), (4.2, 1.2, 0.14), "hull_tar")
    for sy in (-1, 1):
        m.box((0, 2.4 + sy * 0.58, 0.72), (4.16, 0.06, 0.3), "hull_side")  # ends inside the bottom's (z-fight check)
    # sawhorses with a plank; the plank stack
    for x in (3.2, 4.2):
        trestle(m, x, 0.3, 0.6, 0.9, "wood")
    m.box((3.7, 0.3, 0.64), (2.6, 0.24, 0.05), "new_wood")
    for k in range(5):
        m.box((-3.6, 2.2 + k * 0.02, 0.05 + k * 0.05), (3.0 - k * 0.2, 0.26, 0.05), "new_wood" if k % 2 else "wood")
    m.box((-3.6, 2.2, 0.02), (0.1, 0.5, 0.04), "wood_dark")
    # oakum bales and a tool bench
    for x, y in ((2.8, 2.2), (3.3, 2.4)):
        m.box((x, y, 0.2), (0.5, 0.4, 0.4), "oakum")
    m.box((3.9, 1.9, 0.62), (1.2, 0.4, 0.06), "wood")
    for sx in (3.4, 4.4):
        m.beam((sx, 1.9, 0.6), (sx, 1.9, 0.0), 0.06, 0.25, "wood_dark")
    m.box((3.7, 1.85, 0.68), (0.28, 0.08, 0.08), "wood_dark")  # the mallet
    m.beam((3.7, 1.85, 0.68), (3.7, 1.55, 0.68), 0.03, 0.03, "wood")
    m.box((4.1, 1.95, 0.67), (0.25, 0.05, 0.03), "iron")  # caulking irons
    m.box((4.2, 1.8, 0.67), (0.22, 0.04, 0.03), "iron")
    # the caulking pot on its brazier, tar bubbling, the fire under it
    with m.at(move(-2.6, -0.8, 0)):
        for i in range(3):
            a = i * 2 * math.pi / 3
            m.beam((math.cos(a) * 0.16, math.sin(a) * 0.16, 0.38), (math.cos(a) * 0.26, math.sin(a) * 0.26, 0.0), 0.03, 0.03, "iron")
        m.lathe([(0.2, 0.18), (0.24, 0.38), (0.0, 0.38)], 6, "iron_rust")
        disc(m, (0, 0, 0.21), 0.18, "coal_glow")
        m.lathe([(0.12, 0.4), (0.16, 0.58), (0.17, 0.6)], 6, "iron", cap0=True)
        m.lathe([(0.16, 0.58), (0.0, 0.57)], 6, "tar")
        flames(m, (0, 0, 0.2), 0.1, 0.25)
        m.beam((0.1, 0, 0.58), (0.35, 0.1, 0.9), 0.02, 0.02, "wood")  # the tar brush
    post_sign(m, "boatyard", -1.0, -2.3, 1.7)
    return m


# ------------------------------------------------------------------ the farrier


def tr_farrier():
    """An open-fronted forge shed (its plank back at +y, local y 2.6): the forge, the anvil in front."""
    m = Mesh(ao=1.6)
    W, D = 5.0, 2.6
    hb, hf = 3.0, 2.35
    # posts and roof
    for x in (-W / 2, 0.0, W / 2):
        m.beam((x, 0.0, 0.0), (x, 0.0, hf), 0.12, 0.12, "oak")
    m.beam((-W / 2 - 0.1, 0.0, hf), (W / 2 + 0.1, 0.0, hf), 0.14, 0.14, "oak")
    m.beam((-W / 2 - 0.1, D, hb), (W / 2 + 0.1, D, hb), 0.1, 0.1, "oak")
    for x in (-W / 2, -W / 4, 0.0, W / 4, W / 2):
        m.beam((x, -0.2, hf - 0.03), (x, D, hb), 0.07, 0.09, "oak")
    roof = [(-W / 2 - 0.2, -0.3, hf + 0.04), (W / 2 + 0.2, -0.3, hf + 0.04), (W / 2 + 0.2, D, hb + 0.08), (-W / 2 - 0.2, D, hb + 0.08)]
    m.face(roof, "roof_planks", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -0.3, 1))
    # the underside 4 cm down (the boards' thickness): in one plane the two-sided faces fought (z-fight check)
    m.face([(x, y, z - 0.04) for x, y, z in roof[::-1]], "roof_planks", shade=0.45)
    # it stands free: back posts and a plank back wall
    for x in (-W / 2, 0.0, W / 2):
        m.beam((x, D, 0.0), (x, D, hb), 0.12, 0.12, "oak")
    m.face([(W / 2, D + 0.02, 0.0), (-W / 2, D + 0.02, 0.0), (-W / 2, D + 0.02, hb), (W / 2, D + 0.02, hb)], "roof_planks", out=(0, 1, 0))
    m.face([(-W / 2, D, 0.0), (W / 2, D, 0.0), (W / 2, D, hb), (-W / 2, D, hb)], "roof_planks", shade=0.5, out=(0, -1, 0))
    # a plank side wall on the left
    m.face([(-W / 2, 0.0, 0.0), (-W / 2, D, 0.0), (-W / 2, D, hb), (-W / 2, 0.0, hf)], "roof_planks", out=(-1, 0, 0))
    m.face([(-W / 2 + 0.025, D, 0.0), (-W / 2 + 0.025, 0.0, 0.0), (-W / 2 + 0.025, 0.0, hf), (-W / 2 + 0.025, D, hb)], "roof_planks", shade=0.5, out=(1, 0, 0))
    # the forge: a brick hearth against the wall, glowing coals, a hood and chimney
    m.box((-1.4, D - 0.5, 0.4), (1.3, 0.95, 0.8), "brick")
    m.quad([(-1.95, D - 0.9, 0.81), (-0.85, D - 0.9, 0.81), (-0.85, D - 0.2, 0.81), (-1.95, D - 0.2, 0.81)], "coal_glow", mat=GLOW, out=(0, 0, 1))
    flames(m, (-1.4, D - 0.55, 0.8), 0.18, 0.28, 2)
    hood = [(-2.0, D - 1.0, 1.6), (-0.8, D - 1.0, 1.6), (-1.1, D - 0.15, 2.4), (-1.7, D - 0.15, 2.4)]
    m.face(hood, "brick", out=(0, -1, 0.4))
    for sx in (-1, 1):
        x0 = -1.4 + sx * 0.6
        x1 = -1.4 + sx * 0.3
        m.face([(x0, D - 1.0, 1.6), (x0, D, 1.6), (x1, D, 2.4), (x1, D - 0.15, 2.4)], "brick", out=(sx, 0, 0))
    m.box((-1.4, D - 0.1, 2.75), (0.6, 0.3, 0.7), "brick")
    # the bellows beside the hearth, its handle up
    with m.at(move(-0.35, D - 0.45, 0.55)):
        m.face([(-0.3, 0, 0.0), (0.4, 0, -0.05), (0.4, 0, 0.12), (-0.3, 0, 0.25)], "leather", out=(0, -1, 0))
        m.face([(-0.3, 0.02, 0.25), (0.4, 0.02, 0.12), (0.4, 0.02, -0.05), (-0.3, 0.02, 0.0)], "leather", out=(0, 1, 0))
        m.beam((-0.3, 0.01, 0.12), (-0.8, 0.01, 0.2), 0.04, 0.04, "wood_dark")
        m.beam((0.3, 0.01, -0.05), (0.3, 0.01, -0.55), 0.06, 0.06, "wood_dark")
    # the anvil on its block, out under the roof edge; a quench tub
    m.lathe([(0.24, 0.0), (0.22, 0.5), (0.2, 0.52)], 7, "oak", M=move(0.3, 0.6, 0), cap1=True, cap_cell="endgrain")
    with m.at(move(0.3, 0.6, 0.52)):
        m.box((0, 0, 0.1), (0.24, 0.16, 0.2), "iron")
        m.box((0, 0, 0.24), (0.42, 0.14, 0.08), "iron")
        m.face([(0.21, -0.07, 0.2), (0.21, 0.07, 0.2), (0.42, 0.0, 0.25), (0.21, 0.0, 0.28)], "iron", out=(1, 0, 0))
        m.face([(0.21, 0.07, 0.2), (0.21, -0.07, 0.2), (0.21, 0.0, 0.28), (0.42, 0.0, 0.25)], "iron", out=(1, 0, 0))
        m.box((-0.05, 0.0, 0.29), (0.3, 0.04, 0.02), "iron_light")  # a shoe on the face
    m.lathe([(0.3, 0.0), (0.33, 0.45), (0.34, 0.47)], 8, "wood_dark", M=move(1.3, 1.2, 0), cap0=True)
    m.lathe([(0.33, 0.4), (0.0, 0.4)], 8, "water", M=move(1.3, 1.2, 0))
    for zz in (0.08, 0.36):
        m.lathe([(0.315, zz), (0.325, zz + 0.04)], 8, "iron", M=move(1.3, 1.2, 0))
    # horseshoes on a board on the wall; a tool rack; a bar stock pile
    with m.at(move(1.2, D - 0.02, 1.4)):
        m.face([(-0.5, 0, -0.25), (0.5, 0, -0.25), (0.5, 0, 0.25), (-0.5, 0, 0.25)], "shoes", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
    for i in range(4):
        m.beam((2.0 + i * 0.12, D - 0.05, 1.3), (2.0 + i * 0.12, D - 0.12, 0.4), 0.025, 0.025, "iron")
    for k in range(4):
        m.beam((1.5, D - 0.3 + k * 0.05, 0.03 + (k % 2) * 0.04), (2.4, D - 0.28 + k * 0.05, 0.03), 0.03, 0.03, "iron_rust")
    post_sign(m, "farrier", 1.6, -0.35, 1.2, (0, -1, 0))
    # a hitching post for the horse, to the right
    m.beam((3.1, 0.3, 0.0), (3.1, 0.3, 1.15), 0.12, 0.12, "oak")
    m.lathe([(0.05, 0.9), (0.06, 0.93), (0.0, 0.96)], 6, "iron", M=move(3.1, 0.23, 0))
    return m


def tr_horse():
    """A draught horse standing along -x (head at -x), the near hind hoof lifted for the shoe."""
    m = Mesh(ao=1.6)
    # body: sections along x
    secs = [(0.95, 0.16, 1.28, 0.2), (0.75, 0.26, 1.3, 0.34), (0.3, 0.3, 1.3, 0.38), (-0.2, 0.3, 1.32, 0.38), (-0.6, 0.28, 1.36, 0.36),
            (-0.85, 0.2, 1.45, 0.28)]
    sides = 6
    rings = []
    for x, hw, zc, hh in secs:
        rings.append([Vector((x, hw * math.cos(2 * math.pi * i / sides), zc + hh * math.sin(2 * math.pi * i / sides))) for i in range(sides)])
    for j in range(len(rings) - 1):
        for i in range(sides):
            i1 = (i + 1) % sides
            pts = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
            mid = sum(pts, Vector()) / 4
            m.face(pts, "horse", out=mid - Vector((mid.x, 0, secs[j][2])))
    m.face(rings[0][::-1], "horse", out=(1, 0, 0))
    # neck and head
    m.tube([(-0.78, 0, 1.42), (-1.02, 0, 1.72), (-1.16, 0, 1.92)], 0.22, 6, "horse")
    with m.at(move(-1.2, 0, 2.0) @ rot("Y", -2.2)):
        m.lathe([(0.13, 0.0), (0.15, 0.15), (0.12, 0.42), (0.1, 0.58), (0.0, 0.62)], 6, "horse")
    for sy in (-1, 1):
        m.beam((-1.12, sy * 0.08, 2.1), (-1.06, sy * 0.11, 2.26), 0.05, 0.03, "horse")
    m.beam((-0.8, 0, 1.68), (-1.2, 0, 2.08), 0.06, 0.1, "mane")
    # halter and the lead rope to the post (at +3.1 m in the farrier scene: the rope goes to -x here; trades.ts places it)
    m.beam((-1.55, -0.12, 1.62), (-1.55, 0.12, 1.62), 0.03, 0.03, "leather")
    m.tube([(-1.62, 0, 1.55), (-1.85, 0, 1.15), (-2.05, 0, 0.95)], 0.012, 3, "rope")
    # legs: fore legs straight, off hind straight, near hind (y -) lifted
    for x, y in ((-0.6, -0.18), (-0.6, 0.18), (0.8, 0.18)):
        m.beam((x, y, 1.15), (x, y, 0.45), 0.13, 0.13, "horse")
        m.beam((x, y, 0.46), (x + 0.02, y, 0.1), 0.09, 0.09, "horse")
        m.box((x + 0.02, y, 0.05), (0.14, 0.14, 0.1), "hoof")
    m.beam((0.8, -0.18, 1.15), (0.9, -0.2, 0.6), 0.13, 0.13, "horse")
    m.beam((0.9, -0.2, 0.6), (1.2, -0.22, 0.52), 0.09, 0.09, "horse")
    m.box((1.25, -0.22, 0.5), (0.1, 0.14, 0.14), "hoof")
    # tail
    m.tube([(0.95, 0, 1.35), (1.08, 0, 1.1), (1.1, 0, 0.7)], 0.07, 4, "mane")
    return m


# ------------------------------------------------------------------ the rope walk


def tr_rope_wheel():
    """The wheel frame and the hook board; the wheel itself turns (tr_rope_spin). Yarns leave toward +x."""
    m = Mesh(ao=1.2)
    for sy in (-0.35, 0.35):
        m.beam((0, sy, 0.0), (0, sy, 1.45), 0.12, 0.12, "oak")
        m.beam((-0.4, sy, 0.0), (0.4, sy, 0.0), 0.12, 0.1, "oak")
        m.beam((-0.35, sy, 0.05), (0, sy, 0.7), 0.06, 0.06, "oak")
    m.beam((0, -0.4, 1.2), (0, 0.4, 1.2), 0.06, 0.06, "iron")  # the axle
    # the hook board ahead of the wheel: the whirls the yarns hang on
    for sy in (-0.3, 0.3):
        m.beam((0.9, sy, 0.0), (0.9, sy, 1.15), 0.1, 0.1, "oak")
    m.box((0.9, 0, 1.05), (0.12, 0.8, 0.28), "wood_dark")
    for k in range(4):
        y = -0.24 + k * 0.16
        m.beam((0.95, y, 1.05), (1.08, y, 1.05), 0.025, 0.025, "iron")
    # the band from the wheel to the whirls
    m.tube([(0, 0.0, 1.8), (0.9, 0.0, 1.15), (0, 0.0, 0.6)], 0.01, 3, "rope")
    # hemp bales by the wheel
    for x, y, z in ((-0.9, -0.5, 0.0), (-1.1, 0.2, 0.0), (-1.0, -0.15, 0.36)):
        m.box((x, y, z + 0.18), (0.6, 0.4, 0.36), "hemp")
    post_sign(m, "ropewalk", -0.9, -1.2, 1.6)
    return m


def tr_rope_spin():
    """The big wheel (radius 0.62) in the x-z plane, its axle along Blender y at the origin; the crank on it."""
    m = Mesh()
    r, n = 0.62, 10
    ring = [(r * math.cos(2 * math.pi * i / n), 0.0, r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    m.tube(ring, 0.04, 4, "wood", closed=True, up=(0, 1, 0))
    for i in range(0, n, 2):
        m.beam((0, 0, 0), ring[i], 0.035, 0.035, "wood_dark")
    m.lathe([(0.08, -0.1), (0.08, 0.1)], 6, "wood_dark", M=rot("X", math.pi / 2))
    m.beam((0.45, 0.0, 0.0), (0.45, -0.28, 0.0), 0.04, 0.04, "iron")  # the crank handle, toward the boy (-y)
    return m


def tr_rope_post():
    """A rope trestle: a post with a cross-head of pegs the yarns lie over (1.05 m)."""
    m = Mesh()
    m.beam((0, 0, 0), (0, 0, 1.05), 0.15, 0.15, "wood")
    for sy in (-1, 1):
        m.beam((0, sy * 0.3, 0.0), (0, 0, 0.45), 0.07, 0.07, "wood")  # struts
    m.box((0, 0, 1.0), (0.14, 0.9, 0.1), "wood")
    for k in range(5):
        y = -0.32 + k * 0.16
        m.beam((0, y, 1.04), (0, y, 1.16), 0.035, 0.035, "wood_dark")
    return m


# ------------------------------------------------------------------ the cooper


def cask(m, c, r=0.3, h=0.8, a=0.0, lying=False, cell="oak"):
    M = move(*c) @ rot("Z", a)
    if lying:
        M = M @ move(0, 0, r) @ rot("Y", math.pi / 2) @ move(0, 0, -h / 2)
    with m.at(M):
        m.lathe([(r * 0.86, 0.0), (r, h * 0.5), (r * 0.86, h)], 8, cell, cap0=True, cap1=True, cap_cell="endgrain")
        for zz in (0.08, 0.3, h - 0.34, h - 0.12):
            rr = r * (0.9 + 0.1 * math.sin(math.pi * (zz + 0.02) / h))
            m.lathe([(rr + 0.008, zz), (rr + 0.008, zz + 0.04)], 8, "iron")


def tr_cooper():
    m = Mesh(ao=1.2)
    cask(m, (-1.6, 0.8, 0))
    cask(m, (-1.0, 1.1, 0), 0.28, 0.75)
    cask(m, (-1.35, 1.35, 0.8), 0.28, 0.75)
    cask(m, (-2.2, 0.2, 0), 0.3, 0.8, a=0.3, lying=True)
    # the cask being fired: staves splayed at the foot, one hoop, the cresset of shavings burning inside
    with m.at(move(0.6, 0.2, 0)):
        n = 8
        for i in range(n):
            a = 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            m.face([(0.42 * ca - 0.1 * sa, 0.42 * sa + 0.1 * ca, 0.0), (0.42 * ca + 0.1 * sa, 0.42 * sa - 0.1 * ca, 0.0),
                    (0.28 * ca + 0.08 * sa, 0.28 * sa - 0.08 * ca, 0.85), (0.28 * ca - 0.08 * sa, 0.28 * sa + 0.08 * ca, 0.85)], "new_wood", out=(ca, sa, 0.2))
            # the stave's inside 2 cm in: in one plane the two-sided faces fought (z-fight check)
            ix, iy = -0.02 * ca, -0.02 * sa
            m.face([(0.28 * ca - 0.08 * sa + ix, 0.28 * sa + 0.08 * ca + iy, 0.85), (0.28 * ca + 0.08 * sa + ix, 0.28 * sa - 0.08 * ca + iy, 0.85),
                    (0.42 * ca + 0.1 * sa + ix, 0.42 * sa - 0.1 * ca + iy, 0.0), (0.42 * ca - 0.1 * sa + ix, 0.42 * sa + 0.1 * ca + iy, 0.0)], "wood_dark", shade=0.5)
        m.lathe([(0.3, 0.72), (0.3, 0.78)], 8, "iron")
        m.lathe([(0.2, 0.0), (0.22, 0.25), (0.0, 0.26)], 6, "iron_rust", cap0=False)
        disc(m, (0, 0, 0.25), 0.2, "coal_glow")
        flames(m, (0, 0, 0.25), 0.16, 0.45)
    # hoops leaning on the wall behind, a stack of staves, the shaving horse. (The yard's house has its kerb,
    # 0.12 m high, from 1.5 to 2.2 m behind, and a plinth 7 cm out of its wall: the hoops and the staves lie on the
    # kerb, not half in it nor in the plinth: the prop check)
    K = 0.12
    for k in range(4):
        m.tube(ring_path(0.34 + k * 0.03, 10, 1.6 + k * 0.06, 1.8, K + 0.4 + k * 0.02, plane="xz"), 0.012, 3, "iron")
    for k in range(6):
        m.box((0.2 + (k % 3) * 0.13, 1.81, K + 0.03 + (k // 3) * 0.05), (0.1, 0.54, 0.04), "new_wood")  # (clear of the wall's plinth)
    with m.at(move(2.3, 0.5, 0) @ rot("Z", 0.4)):
        m.box((0, 0, 0.5), (1.5, 0.28, 0.08), "wood")
        for sx in (-0.6, 0.6):
            for sy in (-1, 1):
                m.beam((sx, sy * 0.1, 0.48), (sx * 1.1, sy * 0.25, 0.0), 0.05, 0.05, "wood_dark")
        m.box((0.3, 0, 0.62), (0.3, 0.24, 0.16), "wood_dark")
        m.beam((0.45, 0, 0.8), (0.45, 0, 0.3), 0.05, 0.05, "wood_dark")
    ground_decal(m, "leaves", (1.2, -0.4), 1.6, 1.2, 0.5)
    # shavings heaped
    m.lathe([(0.5, 0.0), (0.3, 0.12), (0.0, 0.16)], 6, "shavings", M=move(1.6, -0.2, 0))
    post_sign(m, "cooper", -0.4, -1.1, 1.7)
    return m


# ------------------------------------------------------------------ the sailmaker


def tr_sailmaker():
    m = Mesh(ao=0.6)
    # the canvas spread on the stones, pegged, a fold along one edge
    W, D = 5.0, 3.2
    m.face([(-W / 2, -D / 2, 0.012), (W / 2, -D / 2, 0.012), (W / 2, D / 2, 0.012), (-W / 2, D / 2, 0.012)], "canvas_seams",
           uvs=[(0, 0), (4, 0), (4, 1), (0, 1)], out=(0, 0, 1))
    m.face([(-W / 2, D / 2, 0.012), (W / 2, D / 2, 0.012), (W / 2 - 0.2, D / 2 - 0.3, 0.1), (-W / 2 + 0.2, D / 2 - 0.3, 0.1)], "canvas", out=(0, -1, 1))
    m.face([(-W / 2 + 0.2, D / 2 - 0.3, 0.1), (W / 2 - 0.2, D / 2 - 0.3, 0.1), (W / 2 - 0.4, D / 2 - 0.6, 0.012), (-W / 2 + 0.4, D / 2 - 0.6, 0.012)], "canvas", out=(0, 1, 1))
    for x, y in ((-W / 2, -D / 2), (W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2), (0, -D / 2)):
        m.beam((x, y, 0.0), (x, y, 0.1), 0.03, 0.03, "wood_dark")
    # the sail bench: a long low bench with the tools, a roll of canvas and a sail bag
    with m.at(move(-3.3, 0.0, 0) @ rot("Z", math.pi / 2)):
        m.box((0, 0, 0.42), (1.9, 0.36, 0.06), "wood")
        for sx in (-0.8, 0.8):
            m.box((sx, 0, 0.2), (0.06, 0.32, 0.4), "wood_dark")
        m.box((0.6, 0.0, 0.47), (0.18, 0.12, 0.05), "leather")
        m.beam((0.3, -0.05, 0.47), (0.5, -0.05, 0.47), 0.02, 0.02, "wood")
    # a roll of canvas beside the bench, along the quay (it lay out across the edge, its end over the water: the prop check)
    m.lathe([(0.18, -0.6), (0.18, 0.6)], 6, "canvas", M=move(-3.3, 1.3, 0.18) @ rot("Y", math.pi / 2), cap0=True, cap1=True)
    m.lathe([(0.25, 0.0), (0.3, 0.3), (0.2, 0.6), (0.08, 0.7), (0.0, 0.72)], 6, "sail_tan", M=move(-3.6, -1.3, 0))
    post_sign(m, "sailmaker", -3.7, 1.3, 1.6, (1, 0, 0))
    return m


# ------------------------------------------------------------------ the net menders


def tr_nets():
    m = Mesh(ao=0.6)
    xs = (-2.6, -0.9, 0.8, 2.5)
    h = 2.2
    for x in xs:
        m.lathe([(0.05, 0.0), (0.045, h), (0.0, h + 0.03)], 4, "wood_grey", M=move(x, 0, 0))
    m.tube([(xs[0], 0, h - 0.1), (xs[1], 0, h - 0.2), (xs[2], 0, h - 0.18), (xs[3], 0, h - 0.1)], 0.012, 3, "rope")
    for b in range(3):
        x0, x1 = xs[b] + 0.08, xs[b + 1] - 0.08
        n = 3
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            xa, xb = x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1
            ya = h - 0.15 - 0.06 * math.sin(math.pi * t0)
            yb = h - 0.15 - 0.06 * math.sin(math.pi * t1)
            la = 1.55 + 0.3 * math.sin(t0 * 6 + b * 2)
            lb = 1.55 + 0.3 * math.sin(t1 * 6 + b * 2)
            m.face([(xa, 0.03, ya), (xa, 0.1 + 0.1 * math.sin(t0 * 7 + b), ya - la), (xb, 0.1 + 0.1 * math.sin(t1 * 7 + b), yb - lb), (xb, 0.03, yb)],
                   "net", uvs=[(t0 * 2, 1), (t0 * 2, 0), (t1 * 2, 0), (t1 * 2, 1)], mat=DECAL)
        for i in range(3):
            t = (i + 0.5) / 3
            m.box((x0 + (x1 - x0) * t, 0, h - 0.17 - 0.06 * math.sin(math.pi * t)), (0.07, 0.07, 0.05), "cloth_white")
    # a net heaped on the ground with a basket; two stools before the nets
    m.lathe([(0.7, 0.0), (0.4, 0.12), (0.0, 0.18)], 6, "wood_dark", M=move(-1.8, -1.2, 0))
    m.face([(-2.4, -1.8, 0.2), (-1.2, -1.8, 0.2), (-1.2, -0.6, 0.2), (-2.4, -0.6, 0.2)], "net", uvs=[(0, 0), (2, 0), (2, 2), (0, 2)], mat=DECAL)
    basket(m, (1.9, -1.1, 0), 0.3, 0.3, None)
    for x in (-0.3, 1.2):
        with m.at(move(x, -1.0, 0)):
            m.lathe([(0.15, 0.4), (0.15, 0.44), (0.0, 0.44)], 6, "wood", cap0=True)
            for i in range(3):
                a = i * 2 * math.pi / 3
                m.beam((math.cos(a) * 0.08, math.sin(a) * 0.08, 0.4), (math.cos(a) * 0.17, math.sin(a) * 0.17, 0.0), 0.035, 0.035, "wood_dark")
    post_sign(m, "nets", 3.2, -0.8, 1.6)
    return m


# ------------------------------------------------------------------ build


def build_models():
    B = [
        ("mk_crates", mk_crates()), ("mk_fishbox", mk_fishbox()), ("mk_basket_fish", mk_basket_fish()), ("mk_basket_veg", mk_basket_veg()),
        ("mk_basket_tall", mk_basket_tall()), ("mk_stool", mk_stool()), ("mk_barrow_fish", mk_barrow_fish()), ("mk_barrow_veg", mk_barrow_veg()),
        ("mk_cart", mk_cart()), ("mk_spilled", mk_spilled()), ("mk_leaves", mk_leaves()), ("mk_scraps", mk_scraps()),
        ("mk_goods_cheese", mk_goods_cheese()), ("mk_goods_baskets", mk_goods_baskets()), ("mk_goods_junk", mk_goods_junk()),
        ("mk_bench", mk_bench()), ("mk_gull", mk_gull()),
        ("tr_boatyard", tr_boatyard()), ("tr_farrier", tr_farrier()), ("tr_horse", tr_horse()),
        ("tr_rope_wheel", tr_rope_wheel()), ("tr_rope_spin", tr_rope_spin()), ("tr_rope_post", tr_rope_post()),
        ("tr_cooper", tr_cooper()), ("tr_sailmaker", tr_sailmaker()), ("tr_nets", tr_nets()),
    ]
    return B


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def preview_materials():
    for mt in bpy.data.materials:
        if not mt.name.startswith("tr_"):
            continue
        nt = mt.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        if mt.name == "tr_glow":
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 3.0
        try:
            mt.surface_render_method = "DITHERED"
        except AttributeError:
            pass


def preview(objs):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.24, 0.26, 0.29, 1)
        bg.inputs[1].default_value = 0.9
    except AttributeError:
        pass
    sc.world = world
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    for p in [(-40, -20, 0), (40, -20, 0), (40, 40, 0), (-40, 40, 0)]:
        bm.verts.new(p)
    bm.faces.new(bm.verts)
    bm.to_mesh(me)
    mt = bpy.data.materials.new("ground_m")
    mt.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.12, 0.12, 0.11, 1)
    me.materials.append(mt)
    sc.collection.objects.link(bpy.data.objects.new("ground", me))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    rows = [[n for n in objs if n.startswith("mk_")], ["tr_boatyard", "tr_farrier", "tr_horse", "tr_rope_wheel"], ["tr_cooper", "tr_sailmaker", "tr_nets", "tr_rope_post"]]

    def lay(names, y, gap=0.6):
        x = 0.0
        placed = []
        for n in names:
            o = objs[n]
            o.location = (0, 0, 0)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            o.location = (x - lo, y, 0)
            placed.append(o)
            x += hi - lo + gap
        for o in placed:
            o.location.x -= x / 2

    lay(rows[0], 0.0, 0.3)
    lay(rows[1], 6.0, 1.0)
    lay(rows[2], 13.0, 1.0)
    objs["tr_rope_spin"].location = objs["tr_rope_wheel"].location + Vector((0, 0, 1.2))
    bpy.context.view_layer.update()

    def aim(loc, target, lens):
        cam.location = Vector(loc)
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens

    def render(path, res):
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.render.render(write_still=True)
        print(f"[build_trades] preview -> {path}")

    aim((0, -10, 5), (0, 0.5, 0.3), 24)
    render(os.path.join(SHOTS, "trades_preview_market.png"), (1920, 800))
    aim((0, -8, 8), (0, 9, 0.8), 18)
    render(os.path.join(SHOTS, "trades_preview.png"), (1920, 1080))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    make_materials()
    objs = {}
    for name, mesh in build_models():
        objs[name] = mesh.to_object(name)
    counts = {n: tris(o) for n, o in objs.items()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_trades] {n:20s} {c:5d} tris")
    print(f"[build_trades] atlases: solid {SOLID_ATLAS.W}x{SOLID_ATLAS.H}, decal {DECAL_ATLAS.W}x{DECAL_ATLAS.H}")
    print(f"[build_trades] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview_materials()
        preview(objs)


if __name__ == "__main__":
    main()

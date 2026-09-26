"""Litter of Antwerp, 1873: the dirt and waste of a port town's streets (M3j filth).

    blender -b --factory-startup -P tools/blender/build_litter.py
    blender -b --factory-startup -P tools/blender/build_litter.py -- --preview

Writes client/public/models/litter.glb (Draco). One node per model ("prototype"), real
scale in metres, standing on its origin; client/src/world/litter.ts places copies of them
(one BatchedMesh for all the solid bits, one for the flat marks, one for what floats).
What is modelled follows the research in docs/milestones/M3j-filth.md: horse dung fresh
and in heaps, straw, broken crate slats, torn sacking and rags, cabbage leaves and rotten
vegetables, fish heads, guts and whole small fish, mussel and oyster shells, bottles and
broken glass, crockery, ash and cinders, coal, rope ends, paper, a dead rat, a slop
bucket, a refuse heap, a manure heap and a dung barrow.

The flat marks on the ground (wet muck, trodden dung, straw, urine, oil, tar, soot, coal
dust, slops, fish scales and guts, leaf mush, paper, grain, ash, glass, crushed shells,
the gutter's dark water, drain gratings) are cells of an RGBA atlas: the node
"litter_meta" carries in its extras (JSON) the cells and the size each mark is drawn at,
so the game builds those quads itself.

Frames. Blender is Z-up and the export turns it Y-up: Blender (x, y, z) is game (x, z, -y).
Materials, by name: lt_solid (one atlas for everything solid, drawn double-sided),
lt_decal (the RGBA atlas of flat marks). The vertex colour "Col" carries a baked shade.
All textures are painted by the functions below (nearest filter). Our own work: no
downloaded models, images or fonts. Period pictures were looked at for reference only.

--preview renders the models to data/shots/litter_preview.png.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "litter.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

SOLID, DECAL = 0, 1
MAT_NAMES = ["lt_solid", "lt_decal"]

# ------------------------------------------------------------------ painting


def vnoise(rng, w, h, cu, cv):
    """Smooth value noise, h x w, with cu x cv cells (tiles)."""
    g = rng.random((cv + 1, cu + 1))
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    y = np.linspace(0, cv, h, endpoint=False)
    x = np.linspace(0, cu, w, endpoint=False)
    y0 = np.floor(y).astype(int)
    x0 = np.floor(x).astype(int)
    fy = (y - y0)[:, None]
    fx = (x - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def flat(seed, w, h, rgb, amt=0.2, cells=4, speck=0.06):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, w, h, cells, cells) * 0.6 + vnoise(rng, w, h, cells * 4, cells * 4) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (1 - amt + 2 * amt * n)[..., None]
    m = rng.random((h, w)) < speck
    img[m, :3] *= 0.75
    return img


def strokes(img, rng, n, rgb, length, width=1, jitter=0.25, alpha=None, angle=None):
    """Thin straight strokes (straw stalks, fibres, cinders) painted over img."""
    h, w = img.shape[:2]
    for _ in range(n):
        a = angle if angle is not None else rng.random() * math.pi
        a += (rng.random() - 0.5) * 0.4
        L = length * (0.5 + rng.random())
        x0, y0 = rng.random() * w, rng.random() * h
        k = 0.75 + rng.random() * 0.5
        col = np.array(rgb) * k
        for t in np.linspace(0, L, int(L * 2) + 2):
            x = int(x0 + math.cos(a) * t) % w
            y = int(y0 + math.sin(a) * t) % h
            for dw in range(width):
                yy = (y + dw) % h
                if alpha is not None and img[yy, x, 3] < 0.05:
                    continue
                img[yy, x, :3] = col * (1 + (rng.random() - 0.5) * jitter)
                if alpha is not None:
                    img[yy, x, 3] = max(img[yy, x, 3], alpha)
    return img


def grain(seed, w, h, rgb):
    """Wood: grain along u."""
    rng = np.random.default_rng(seed)
    g = vnoise(rng, w, h, 3, max(2, h // 2)) * 0.6 + vnoise(rng, w, h, 8, h) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (0.75 + 0.45 * g)[..., None]
    for _ in range(h // 5):
        img[int(rng.integers(0, h)), :, :3] *= 0.78
    return img


def weave(seed, w, h, rgb):
    """Jute sacking: a coarse weave, stained."""
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, rgb, 0.18)
    yy, xx = np.mgrid[0:h, 0:w]
    img[((xx + yy) % 2) == 0, :3] *= 0.82
    st = vnoise(rng, w, h, 3, 3) > 0.68
    img[st, :3] *= 0.6
    return img


def blob_mask(rng, w, h, edge=0.28, cells=5, squash=1.0, hole=0.0):
    """An irregular soft-edged patch filling the cell: 0..1."""
    yy, xx = np.mgrid[0:h, 0:w]
    u = (xx + 0.5) / w * 2 - 1
    v = ((yy + 0.5) / h * 2 - 1) * squash
    r = np.sqrt(u * u + v * v)
    n = vnoise(rng, w, h, cells, cells) * 0.65 + vnoise(rng, w, h, cells * 3, cells * 3) * 0.35
    f = 1 - r + (n - 0.5) * 0.9
    m = np.clip((f - 0.15) / edge, 0, 1)
    if hole > 0:
        m *= np.clip((vnoise(rng, w, h, cells * 2, cells * 2) - hole) / 0.1 + 1, 0, 1)
    return m


def decal(seed, w, h, rgb, alpha=0.85, amt=0.25, edge=0.28, cells=5, squash=1.0, hole=0.0):
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, rgb, amt, cells=cells)
    img[..., 3] = blob_mask(rng, w, h, edge, cells, squash, hole) * alpha
    return img


def paint_gutter(seed, w=64, h=16):
    """The gutter's water along u (tiles along u): dark, oily, a lighter wet edge, bits in it."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    n = vnoise(rng, w, h, 4, 2)
    yy = (np.arange(h)[:, None] + 0.5) / h
    wob = (vnoise(rng, w, 1, 6, 1)[0] - 0.5) * 0.25
    c = 0.5 + wob[None, :]
    d = np.abs(yy - c)
    core = np.clip((0.3 - d) / 0.12, 0, 1)
    img[..., 0] = 0.07 + 0.05 * n
    img[..., 1] = 0.06 + 0.04 * n
    img[..., 2] = 0.04 + 0.03 * n
    img[..., 3] = core * (0.72 + 0.2 * n)
    # the wet shine: a pale line of sky along the water's edge and glints on it, a lighter
    # slick now and then, scraps of straw carried along
    edge = np.clip(1 - np.abs(d - 0.2) / 0.05, 0, 1) * (vnoise(rng, w, h, 10, 2) > 0.35)
    img[..., :3] = img[..., :3] * (1 - edge[..., None]) + np.array((0.34, 0.35, 0.36)) * edge[..., None]
    img[..., 3] = np.maximum(img[..., 3], edge * 0.8)
    sl = vnoise(rng, w, h, 8, 2) > 0.7
    img[sl & (core > 0.5), :3] = (0.24, 0.24, 0.23)
    gl = (rng.random((h, w)) < 0.05) & (core > 0.6)
    img[gl, :3] = (0.4, 0.41, 0.42)
    strokes(img, rng, 5, (0.55, 0.46, 0.25), 6, alpha=0.9, angle=0.0)
    return img


def paint_drain(seed, s=16):
    """An iron drain grating in a stone frame, the gutter's water running into it."""
    img = np.zeros((s, s, 4))
    img[..., :3] = (0.3, 0.3, 0.29)
    img[..., 3] = 1.0
    img[2:-2, 2:-2, :3] = (0.05, 0.05, 0.05)
    for x in range(3, s - 2, 3):
        img[2:-2, x, :3] = (0.14, 0.13, 0.12)
    rng = np.random.default_rng(seed)
    img[..., :3] *= (0.85 + 0.3 * rng.random((s, s)))[..., None]
    return img


def paint_paper(seed, w=24, h=32):
    """A torn newspaper sheet: columns of print, dirty, a corner torn."""
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, (0.72, 0.69, 0.6), 0.12)
    for col in (2, 13):
        for y in range(4, h - 3, 2):
            L = int(rng.integers(6, 10))
            img[y, col:col + L, :3] = (0.3, 0.29, 0.27)
    img[1:3, 2:w - 2, :3] = (0.2, 0.2, 0.2)
    img[..., 3] = 0.95
    yy, xx = np.mgrid[0:h, 0:w]
    img[(xx + (h - yy)) < 9, 3] = 0
    mud = vnoise(rng, w, h, 3, 3) > 0.62
    img[mud, :3] *= 0.55
    return img


def paint_scales(seed, s=32):
    """Fish scales on wet stone: a dark wet patch with silver glints."""
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.12, 0.13, 0.13), 0.6, cells=4)
    m = (rng.random((s, s)) < 0.18) & (img[..., 3] > 0.2)
    img[m, :3] = (0.62, 0.66, 0.66)
    img[m, 3] = 0.95
    return img


def paint_straw(seed, s=32):
    rng = np.random.default_rng(seed)
    img = np.zeros((s, s, 4))
    img[..., :3] = (0.5, 0.42, 0.24)
    m = blob_mask(rng, s, s, 0.4, 4)
    tmp = np.zeros((s, s, 4))
    strokes(tmp, rng, 26, (0.66, 0.55, 0.3), 10, alpha=1.0)
    strokes(tmp, rng, 10, (0.45, 0.36, 0.2), 8, alpha=1.0)
    img[..., :3] = tmp[..., :3]
    img[..., 3] = tmp[..., 3] * np.clip(m * 1.6, 0, 1)
    return img


def paint_glass(seed, s=16):
    rng = np.random.default_rng(seed)
    img = np.zeros((s, s, 4))
    m = rng.random((s, s)) < 0.16
    img[m, :3] = np.array((0.25, 0.35, 0.27)) * (0.6 + rng.random((m.sum(), 1)) * 0.9)
    img[m, 3] = 0.95
    img[..., 3] *= blob_mask(rng, s, s, 0.3, 3)
    return img


def paint_ash(seed, s=32):
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.34, 0.33, 0.31), 0.8, amt=0.3, cells=4)
    m = (rng.random((s, s)) < 0.1) & (img[..., 3] > 0.3)
    img[m, :3] = (0.06, 0.06, 0.06)
    return img


def paint_coal_dust(seed, s=32):
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.035, 0.035, 0.04), 0.9, amt=0.3, edge=0.5, cells=4)
    m = (rng.random((s, s)) < 0.12) & (img[..., 3] > 0.2)
    img[m, :3] = (0.14, 0.14, 0.15)
    img[m, 3] = 1.0
    return img


def paint_dung_flat(seed, s=32):
    """Trodden horse dung: a flattened brown-green splat, straw fibres in it."""
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.33, 0.27, 0.12), 0.95, amt=0.35, edge=0.2, cells=6, hole=0.25)
    tmp = img.copy()
    strokes(tmp, rng, 8, (0.42, 0.35, 0.18), 5)
    inside = img[..., 3] > 0.4
    img[inside, :3] = tmp[inside, :3]
    return img


def paint_slop(seed, w=48, h=32):
    """Slops thrown from a door: a fan of wet dark water with scraps, widest away from the door (v = 0)."""
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, (0.09, 0.085, 0.07), 0.3)
    yy, xx = np.mgrid[0:h, 0:w]
    v = (yy + 0.5) / h
    u = (xx + 0.5) / w * 2 - 1
    spread = 0.25 + 0.75 * (1 - v)
    n = vnoise(rng, w, h, 6, 4)
    m = np.clip((spread - np.abs(u) + (n - 0.5) * 0.5) / 0.2, 0, 1) * np.clip((1 - v) * 4, 0, 1) * np.clip(v * 6, 0, 1)
    img[..., 3] = m * 0.8
    bits = (rng.random((h, w)) < 0.05) & (m > 0.5)
    img[bits, :3] = (0.35, 0.3, 0.18)
    img[bits, 3] = 1
    return img


def paint_urine(seed, w=32, h=32):
    """A stain running out from a corner: dark wet, a yellow-brown rim where it dried."""
    rng = np.random.default_rng(seed)
    m = blob_mask(rng, w, h, 0.35, 4, squash=1.4)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.14, 0.12, 0.07)
    rim = (m > 0.05) & (m < 0.4)
    img[rim, :3] = (0.3, 0.25, 0.1)
    img[..., 3] = np.where(m > 0.05, 0.35 + 0.45 * m, 0)
    return img


def paint_urine_wall(seed, w=16, h=32):
    """The same on the foot of a wall: a dark wet tongue up from the ground (v = 0 at the ground)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.12, 0.1, 0.06)
    yy, xx = np.mgrid[0:h, 0:w]
    v = 1 - (yy + 0.5) / h
    u = (xx + 0.5) / w
    n = vnoise(rng, w, h, 4, 6)
    top = 0.35 + 0.5 * n
    m = np.clip((top - v) / 0.15, 0, 1) * np.clip((0.95 - np.abs(u - 0.4) * 2.0) / 0.3, 0, 1)
    img[..., 3] = m * 0.55
    salt = (m > 0.1) & (m < 0.3)
    img[salt, :3] = (0.36, 0.33, 0.24)
    return img


def paint_tar(seed, s=32, drips=False):
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.03, 0.025, 0.02), 0.95, amt=0.2, edge=0.12, cells=5 if not drips else 8, hole=0.3 if drips else 0)
    edge = (img[..., 3] > 0.05) & (img[..., 3] < 0.5)
    img[edge, :3] = (0.14, 0.09, 0.04)
    gl = (rng.random((s, s)) < 0.04) & (img[..., 3] > 0.8)
    img[gl, :3] = (0.25, 0.24, 0.23)
    return img


def paint_oil(seed, s=32):
    img = decal(seed, s, s, (0.05, 0.045, 0.04), 0.55, amt=0.25, edge=0.5, cells=3)
    return img


def paint_muck(seed, s=32, rgb=(0.2, 0.14, 0.07)):
    """Wet trodden mud and dung: dark, uneven, lighter where it dries."""
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, rgb, 0.85, amt=0.35, edge=0.35, cells=5)
    dry = vnoise(rng, s, s, 6, 6) > 0.62
    img[dry, :3] = np.array(rgb) * 1.8
    wet = vnoise(rng, s, s, 5, 5) > 0.66
    img[wet, :3] = np.array(rgb) * 0.55
    return img


def paint_guts(seed, s=16):
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.3, 0.12, 0.1), 0.85, amt=0.35, edge=0.2, cells=4, hole=0.3)
    m = (rng.random((s, s)) < 0.15) & (img[..., 3] > 0.3)
    img[m, :3] = (0.55, 0.42, 0.36)
    return img


def paint_leafmush(seed, s=32):
    rng = np.random.default_rng(seed)
    img = decal(seed, s, s, (0.16, 0.2, 0.08), 0.85, amt=0.4, edge=0.25, cells=6, hole=0.35)
    brown = vnoise(rng, s, s, 5, 5) > 0.5
    img[brown, :3] = (0.2, 0.15, 0.07)
    return img


def paint_grain(seed, s=32):
    rng = np.random.default_rng(seed)
    img = np.zeros((s, s, 4))
    m = blob_mask(rng, s, s, 0.4, 4)
    d = rng.random((s, s)) < (0.2 + 0.7 * m)
    img[d, :3] = np.array((0.66, 0.54, 0.3)) * (0.7 + 0.5 * rng.random((d.sum(), 1)))
    img[d, 3] = 0.95 * np.clip(m[d] * 2, 0, 1)
    return img


def paint_shellgrit(seed, s=32):
    rng = np.random.default_rng(seed)
    img = np.zeros((s, s, 4))
    m = blob_mask(rng, s, s, 0.4, 4)
    d = rng.random((s, s)) < (0.15 + 0.6 * m)
    pick = rng.random(d.sum())
    cols = np.where(pick[:, None] < 0.55, np.array((0.1, 0.11, 0.16)), np.array((0.62, 0.6, 0.55)))
    img[d, :3] = cols * (0.7 + 0.5 * rng.random((d.sum(), 1)))
    img[d, 3] = 0.95 * np.clip(m[d] * 2, 0, 1)
    return img


def paint_soot(seed, s=32):
    return decal(seed, s, s, (0.04, 0.04, 0.04), 0.6, amt=0.3, edge=0.6, cells=3)


# ---- autumn leaves (picture round 2026-09-26, package 1): the plane and lime leaves of the quays and squares,
# fallen and blown into drifts against the kerbs and the wall feet, round the tree pits and into the corners.
# Each leaf is painted as a little pixel shape: a plane leaf a five-pointed star (palmate), a lime leaf a heart;
# ochre, rust, brown and a dull yellow, some darker where they lie wet under the others.

LEAF_COLS = [(0.62, 0.42, 0.13), (0.56, 0.26, 0.09), (0.4, 0.25, 0.11), (0.68, 0.54, 0.2), (0.48, 0.33, 0.12), (0.3, 0.19, 0.09)]


def leaf_sprite(rng, size, kind):
    """A leaf as an alpha mask (size x size) and its midrib; kind 0 plane (five lobes), 1 lime (heart)."""
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size * 2 - 1
    v = (yy + 0.5) / size * 2 - 1
    a = rng.random() * 2 * math.pi
    ca, sa = math.cos(a), math.sin(a)
    x = u * ca - v * sa
    y = u * sa + v * ca
    r = np.sqrt(x * x + y * y)
    t = np.arctan2(y, x)
    if kind == 0:
        edge = 0.62 + 0.3 * np.abs(np.cos(t * 2.5))
    else:
        edge = 0.55 + 0.35 * np.abs(np.sin(t * 0.5 + 0.8)) ** 0.7
    m = r < edge
    rib = (np.abs(x) < 0.12) & m & (y > -0.4)
    return m, rib


def paint_leaves(seed, w, h, n, spread="drift", big=1.0):
    """Leaves strewn over a transparent cell. spread: "drift" (thick along the bottom edge: the side that lies
    against the kerb or the wall, thinning to a ragged top), "patch" (a clump, thick in the middle) or "scatter"
    (a few big ones apart: a carpet under the plane trees)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    for _ in range(n):
        if spread == "drift":
            fy = 1 - rng.random() ** 2.2
            fx = rng.random()
            # (the drift's top edge is ragged: lumps and gaps along it)
            if fy < 0.55 and math.sin(fx * 9 + seed) * 0.5 + 0.5 < rng.random() * 0.8:
                continue
        elif spread == "patch":
            rr = math.sqrt(rng.random()) * 0.5 * (0.6 + 0.4 * rng.random())
            aa = rng.random() * 2 * math.pi
            fx, fy = 0.5 + math.cos(aa) * rr, 0.5 + math.sin(aa) * rr
        else:
            fx, fy = 0.1 + rng.random() * 0.8, 0.1 + rng.random() * 0.8
        size = int(max(4, round((4 + rng.random() * 4) * big)))
        kind = 0 if rng.random() < 0.65 else 1
        m, rib = leaf_sprite(rng, size, kind)
        x0 = int(fx * (w - size))
        y0 = int(fy * (h - size))
        col = np.array(LEAF_COLS[rng.integers(len(LEAF_COLS))]) * (0.8 + 0.35 * rng.random())
        # (the ones under the others darker: they lie wet and rot)
        if spread != "scatter" and rng.random() < 0.3:
            col = col * 0.6
        sub = img[y0:y0 + size, x0:x0 + size]
        mm = m[:sub.shape[0], :sub.shape[1]]
        rb = rib[:sub.shape[0], :sub.shape[1]]
        sub[mm, :3] = col
        sub[rb, :3] = col * 0.62
        sub[mm, 3] = 1.0
        # a speck of shading on each, a lighter or darker side
        sh = rng.random((sub.shape[0], sub.shape[1])) < 0.18
        sub[mm & sh, :3] *= 0.8
    return img


# ------------------------------------------------------------------ atlases


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


SOLID_ATLAS = Atlas(256)
DECAL_ATLAS = Atlas(256)

# flat marks: name -> (painter, drawn width m, drawn depth m)
DECALS = {
    "muck_0": (lambda: paint_muck(501), 1.6, 1.3),
    "muck_1": (lambda: paint_muck(502, rgb=(0.17, 0.13, 0.07)), 2.2, 1.4),
    "muck_2": (lambda: paint_muck(503, rgb=(0.22, 0.17, 0.08)), 1.1, 1.0),
    "dungflat_0": (lambda: paint_dung_flat(511), 0.45, 0.4),
    "dungflat_1": (lambda: paint_dung_flat(512), 0.6, 0.45),
    "straw_0": (lambda: paint_straw(521), 0.8, 0.8),
    "straw_1": (lambda: paint_straw(522), 1.1, 0.7),
    "urine_0": (lambda: paint_urine(531), 0.9, 1.3),
    "urine_wall": (lambda: paint_urine_wall(532), 0.6, 0.55),
    "oil_0": (lambda: paint_oil(541), 1.4, 1.1),
    "tar_0": (lambda: paint_tar(542), 1.0, 0.8),
    "tar_1": (lambda: paint_tar(543, drips=True), 0.7, 0.7),
    "soot_0": (lambda: paint_soot(544), 1.6, 1.4),
    "coaldust_0": (lambda: paint_coal_dust(551), 3.0, 2.4),
    "coaldust_1": (lambda: paint_coal_dust(552), 1.4, 1.1),
    "slop_0": (lambda: paint_slop(561), 1.5, 1.7),
    "scales_0": (lambda: paint_scales(571), 0.9, 0.8),
    "guts_0": (lambda: paint_guts(572), 0.35, 0.3),
    "leafmush_0": (lambda: paint_leafmush(573), 0.7, 0.6),
    "paper_0": (lambda: paint_paper(581), 0.38, 0.5),
    "grain_0": (lambda: paint_grain(582), 1.2, 0.9),
    "ash_0": (lambda: paint_ash(583), 0.9, 0.8),
    "glass_0": (lambda: paint_glass(584), 0.45, 0.45),
    "shells_0": (lambda: paint_shellgrit(585), 0.8, 0.7),
    "drain": (lambda: paint_drain(586), 0.5, 0.5),
    "gutter": (lambda: paint_gutter(590), 1.6, 0.5),
    # package 1: autumn leaves (drawn at 2.5-3 cm a pixel: a plane leaf is 6 to 8 pixels)
    "leafdrift_0": (lambda: paint_leaves(601, 64, 24, 150, "drift"), 1.75, 0.6),
    "leafdrift_1": (lambda: paint_leaves(602, 48, 24, 115, "drift"), 1.3, 0.62),
    "leafpatch_0": (lambda: paint_leaves(603, 40, 40, 90, "patch"), 1.1, 1.1),
    "leafpatch_1": (lambda: paint_leaves(604, 32, 32, 60, "patch"), 0.85, 0.85),
    "leafscatter_0": (lambda: paint_leaves(605, 48, 48, 26, "scatter", big=1.45), 1.6, 1.6),
    "leafscatter_1": (lambda: paint_leaves(606, 48, 48, 18, "scatter", big=1.5), 1.6, 1.6),
}


def build_atlases():
    A = SOLID_ATLAS
    A.add("dung", flat(1, 32, 32, (0.38, 0.32, 0.15), 0.35, cells=6, speck=0.15))
    A.add("dung_old", flat(2, 32, 32, (0.4, 0.36, 0.27), 0.3, cells=6, speck=0.1))
    straw = flat(3, 32, 32, (0.55, 0.45, 0.24), 0.2)
    strokes(straw, np.random.default_rng(3), 40, (0.72, 0.6, 0.33), 12, angle=0.1)
    A.add("straw", straw)
    A.add("wood", grain(4, 32, 16, (0.45, 0.36, 0.24)))
    A.add("wood_grey", grain(5, 32, 16, (0.4, 0.38, 0.34)))
    A.add("wood_dark", grain(6, 32, 16, (0.22, 0.17, 0.11)))
    A.add("jute", weave(7, 32, 32, (0.5, 0.42, 0.28)))
    A.add("rag_red", weave(8, 16, 16, (0.4, 0.14, 0.1)))
    A.add("rag_blue", weave(9, 16, 16, (0.2, 0.25, 0.33)))
    A.add("rag_grey", weave(10, 16, 16, (0.38, 0.36, 0.32)))
    leaf = flat(11, 16, 16, (0.3, 0.42, 0.16), 0.25)
    leaf[7:9, :, :3] = (0.55, 0.62, 0.38)
    A.add("cabbage", leaf)
    A.add("rotten", flat(12, 16, 16, (0.16, 0.12, 0.06), 0.4, speck=0.2))
    A.add("carrot", flat(13, 16, 16, (0.6, 0.3, 0.08), 0.2))
    A.add("turnip", flat(14, 16, 16, (0.62, 0.56, 0.5), 0.2))
    fish = flat(15, 32, 16, (0.55, 0.58, 0.58), 0.2)
    fish[:6, :, :3] = (0.16, 0.2, 0.22)
    A.add("fish", fish)
    A.add("guts", flat(16, 16, 16, (0.5, 0.18, 0.15), 0.35, speck=0.2))
    A.add("gill", flat(17, 8, 8, (0.55, 0.12, 0.1), 0.2))
    A.add("mussel", flat(18, 16, 16, (0.08, 0.09, 0.13), 0.3))
    A.add("mussel_in", flat(19, 16, 16, (0.5, 0.52, 0.58), 0.2))
    A.add("oyster", flat(20, 16, 16, (0.5, 0.48, 0.42), 0.35, speck=0.25))
    sh = flat(36, 32, 32, (0.1, 0.1, 0.12), 0.3, speck=0.0)
    rs = np.random.default_rng(36)
    m = rs.random((32, 32)) < 0.3
    sh[m, :3] = np.array((0.55, 0.53, 0.5)) * (0.7 + 0.5 * rs.random((m.sum(), 1)))
    m = rs.random((32, 32)) < 0.12
    sh[m, :3] = (0.36, 0.34, 0.3)
    A.add("shells", sh)
    A.add("glass_green", flat(21, 16, 16, (0.12, 0.2, 0.12), 0.25))
    A.add("glass_brown", flat(22, 16, 16, (0.22, 0.12, 0.05), 0.25))
    A.add("crock", flat(23, 16, 16, (0.46, 0.28, 0.14), 0.2))
    A.add("crock_in", flat(24, 16, 16, (0.62, 0.56, 0.44), 0.15))
    ash = flat(25, 32, 32, (0.36, 0.35, 0.33), 0.25, speck=0.0)
    rng = np.random.default_rng(25)
    m = rng.random((32, 32)) < 0.12
    ash[m, :3] = (0.07, 0.07, 0.07)
    m = rng.random((32, 32)) < 0.03
    ash[m, :3] = (0.45, 0.2, 0.1)
    A.add("ash", ash)
    coal = flat(26, 16, 16, (0.05, 0.05, 0.055), 0.3, speck=0.0)
    m = np.random.default_rng(26).random((16, 16)) < 0.08
    coal[m, :3] = (0.25, 0.25, 0.27)
    A.add("coal", coal)
    rope = flat(27, 16, 16, (0.48, 0.4, 0.28), 0.15)
    for i in range(16):
        rope[i, (np.arange(16) + i) % 4 == 0, :3] *= 0.6
    A.add("rope", rope)
    A.add("fur", flat(28, 16, 16, (0.28, 0.26, 0.23), 0.25, speck=0.2))
    A.add("tail", flat(29, 8, 8, (0.46, 0.38, 0.36), 0.15))
    A.add("paper", flat(30, 16, 16, (0.7, 0.67, 0.58), 0.15))
    A.add("iron", flat(31, 16, 16, (0.12, 0.11, 0.1), 0.3))
    A.add("refuse", flat(32, 32, 32, (0.3, 0.26, 0.19), 0.45, cells=8, speck=0.2))
    man = flat(33, 32, 32, (0.17, 0.12, 0.06), 0.35, cells=6, speck=0.1)
    strokes(man, np.random.default_rng(33), 30, (0.5, 0.41, 0.22), 7)
    A.add("manure", man)
    A.add("earth", flat(34, 16, 16, (0.24, 0.2, 0.15), 0.3))
    A.add("wicker", grain(35, 16, 16, (0.46, 0.36, 0.2)))
    lv = paint_leaves(37, 32, 32, 70, "scatter")
    under = flat(38, 32, 32, (0.3, 0.2, 0.09), 0.3, speck=0.2)
    lv[..., :3] = np.where(lv[..., 3:4] > 0.5, lv[..., :3], under[..., :3])
    lv[..., 3] = 1
    A.add("leaves", lv)
    for name, (fn, _w, _d) in DECALS.items():
        DECAL_ATLAS.add(name, fn())
    SOLID_ATLAS.pack()
    DECAL_ATLAS.pack()


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


def make_materials():
    solid = bl_image("lt_solid_tex", SOLID_ATLAS.img, False)
    dec = bl_image("lt_decal_tex", DECAL_ATLAS.img, True)
    for name, img in zip(MAT_NAMES, [solid, dec]):
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
        if img is dec:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry


class Mesh:
    """Faces with an atlas cell each: cell-local uvs from a planar fit, a baked shade by height."""

    def __init__(self, ao=0.25):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.cols = []
        self.mats = []
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

    def face(self, pts, cell, uvs=None, shade=1.0, mat=SOLID):
        P = [self.xf @ Vector(p) for p in pts]
        if uvs is None:
            n = Vector((0, 0, 0))
            for i in range(len(P)):
                a, b = P[i], P[(i + 1) % len(P)]
                n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
            ax = max(range(3), key=lambda k: abs(n[k]))
            k0, k1 = [(1, 2), (0, 2), (0, 1)][ax]
            cs = [(p[k0], p[k1]) for p in P]
            u0, u1 = min(c[0] for c in cs), max(c[0] for c in cs)
            v0, v1 = min(c[1] for c in cs), max(c[1] for c in cs)
            uvs = [((c[0] - u0) / max(u1 - u0, 1e-6), (c[1] - v0) / max(v1 - v0, 1e-6)) for c in cs]
        base = len(self.verts)
        self.verts.extend(P)
        self.faces.append(list(range(base, base + len(P))))
        atlas = DECAL_ATLAS if mat == DECAL else SOLID_ATLAS
        self.uvs.append([atlas.uv(cell, u, v) for u, v in uvs])
        cols = []
        for p in P:
            s = shade
            if self.ao > 0:
                s *= 0.62 + 0.38 * min(1.0, max(0.0, p.z / self.ao))
            cols.append((s, s, s, 1.0))
        self.cols.append(cols)
        self.mats.append(mat)

    def stalk(self, c, L, w, yaw, cell, pitch=0.0, shade=1.0):
        """One straw stalk or fibre: a thin flat quad (drawn double-sided in the game)."""
        d = Vector((math.cos(yaw) * math.cos(pitch), math.sin(yaw) * math.cos(pitch), math.sin(pitch))) * (L / 2)
        s = Vector((-math.sin(yaw), math.cos(yaw), 0)) * (w / 2)
        c = Vector(c)
        self.face([c - d - s, c + d - s, c + d + s, c - d + s], cell, uvs=[(0, 0), (1, 0), (1, 0.3), (0, 0.3)], shade=shade)

    def tri_fan(self, ring, top, cell, shade=1.0):
        for i in range(len(ring)):
            self.face([ring[i], ring[(i + 1) % len(ring)], top], cell, shade=shade)

    def lump(self, c, r, cell, seed, flat_bottom=True, shade=1.0, detail=0):
        """A jittered icosahedron (a dung ball, a lump of coal, a cinder)."""
        rng = np.random.default_rng(seed)
        t = (1 + 5 ** 0.5) / 2
        V = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        if detail == -1:  # an octahedron: 8 faces, for the smallest bits
            V = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
            F = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
        rx, ry, rz = r if isinstance(r, (tuple, list)) else (r, r, r)
        pts = []
        for v in V:
            vv = Vector(v).normalized() * (1 + (rng.random() - 0.5) * 0.35)
            p = Vector((c[0] + vv.x * rx, c[1] + vv.y * ry, c[2] + vv.z * rz))
            if flat_bottom:
                p.z = max(p.z, 0.0)
            pts.append(p)
        for f in F:
            self.face([pts[i] for i in f], cell, shade=shade)

    def box(self, c, size, cell, M=None, shade=1.0, cells=None):
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        P = [Vector((c[0] + (sx if i & 1 else -sx), c[1] + (sy if i & 2 else -sy), c[2] + (sz if i & 4 else -sz))) for i in range(8)]
        if M is not None:
            cc = Vector(c)
            P = [cc + (M @ (p - cc)) for p in P]
        faces = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
        for k, idx in faces.items():
            self.face([P[i] for i in idx], (cells or {}).get(k, cell), shade=shade * (0.7 if k == "-z" else 1.0))

    def sheet(self, w, d, nx, ny, cell, seed, lift=0.03, tear=0.0, shade=1.0, curl=0.0):
        """A crumpled cloth or sack lying on the ground: a grid, lifted in folds, some cells torn out."""
        rng = np.random.default_rng(seed)
        H = [[(rng.random() * lift + (curl * ((i / nx - 0.5) ** 2) * 4 if curl else 0)) for i in range(nx + 1)] for j in range(ny + 1)]
        for j in range(ny + 1):
            for i in range(nx + 1):
                if i in (0, nx) or j in (0, ny):
                    H[j][i] *= 0.4
        P = [[Vector(((i / nx - 0.5) * w + (rng.random() - 0.5) * w / nx * 0.4, (j / ny - 0.5) * d + (rng.random() - 0.5) * d / ny * 0.4, 0.004 + H[j][i])) for i in range(nx + 1)] for j in range(ny + 1)]
        for j in range(ny):
            for i in range(nx):
                if tear and rng.random() < tear and (i in (0, nx - 1) or j in (0, ny - 1)):
                    continue
                self.face([P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]], cell,
                          uvs=[(i / nx, j / ny), ((i + 1) / nx, j / ny), ((i + 1) / nx, (j + 1) / ny), (i / nx, (j + 1) / ny)], shade=shade)

    def tube(self, pts, r, cell, sides=4, shade=1.0, taper=1.0):
        pts = [Vector(p) for p in pts]
        rings = []
        for k, p in enumerate(pts):
            t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            a = Vector((0, 0, 1)).cross(t)
            if a.length < 1e-4:
                a = Vector((1, 0, 0))
            a.normalize()
            b = t.cross(a).normalized()
            rr = r * (1 - (1 - taper) * k / max(1, len(pts) - 1))
            rings.append([p + (a * math.cos(2 * math.pi * s / sides) + b * math.sin(2 * math.pi * s / sides)) * rr for s in range(sides)])
        for k in range(len(rings) - 1):
            for s in range(sides):
                s1 = (s + 1) % sides
                self.face([rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]], cell,
                          uvs=[(s / sides, k / (len(rings) - 1)), ((s + 1) / sides, k / (len(rings) - 1)), ((s + 1) / sides, (k + 1) / (len(rings) - 1)), (s / sides, (k + 1) / (len(rings) - 1))], shade=shade)

    def lathe(self, prof, sides, cell, M=None, cap0=True, cap1=True, shade=1.0, cells=None):
        """Turned shape about the local +z axis, profile (r, z) bottom to top; M places it."""
        M = M or Matrix.Identity(4)
        rings = [[M @ Vector((r * math.cos(2 * math.pi * s / sides), r * math.sin(2 * math.pi * s / sides), z)) for s in range(sides)] for r, z in prof]
        for k in range(len(rings) - 1):
            ce = (cells or {}).get(k, cell)
            for s in range(sides):
                s1 = (s + 1) % sides
                self.face([rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]], ce, shade=shade)
        if cap0 and prof[0][0] > 0:
            self.face(rings[0][::-1], cell, shade=shade * 0.8)
        if cap1 and prof[-1][0] > 0:
            self.face(rings[-1], cell, shade=shade)

    def mound(self, rx, ry, h, cell, seed, rings=4, sides=10, jit=0.2, shade=1.0, peak=(0.0, 0.0)):
        rng = np.random.default_rng(seed)
        R = []
        for j in range(rings):
            f = 1 - j / rings
            z = h * (1 - f ** 1.6) if j else 0.0
            row = []
            for i in range(sides):
                a = 2 * math.pi * i / sides
                jj = 1 + (rng.random() - 0.5) * jit * 2
                row.append(Vector((rx * f * math.cos(a) * jj + peak[0] * (1 - f), ry * f * math.sin(a) * jj + peak[1] * (1 - f), z * (1 + (rng.random() - 0.5) * jit) if j else 0.0)))
            R.append(row)
        for j in range(rings - 1):
            for i in range(sides):
                i1 = (i + 1) % sides
                self.face([R[j][i], R[j][i1], R[j + 1][i1], R[j + 1][i]], cell, shade=shade)
        top = Vector((peak[0], peak[1], h))
        self.tri_fan(R[-1], top, cell, shade=shade)

    def leaf(self, c, L, W, yaw, cup, cell, shade=1.0):
        """A cupped leaf lying on the ground: a strip of 3 x 2 quads, curled up at the sides."""
        M = Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, "Z")
        with self.at(M):
            xs = [-L / 2, -L / 6, L / 6, L / 2]
            wf = [0.3, 1.0, 0.9, 0.2]
            for k in range(3):
                a0, a1 = xs[k], xs[k + 1]
                w0, w1 = W * wf[k] / 2, W * wf[k + 1] / 2
                for side in (-1, 1):
                    self.face([(a0, 0, 0.005), (a1, 0, 0.005), (a1, side * w1, cup), (a0, side * w0, cup)], cell,
                              uvs=[(k / 3, 0.5), ((k + 1) / 3, 0.5), ((k + 1) / 3, 0.5 + side * 0.5), (k / 3, 0.5 + side * 0.5)], shade=shade)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.update()
        for m in MAT_NAMES:
            me.materials.append(bpy.data.materials[m])
        uv = me.uv_layers.new(name="UVMap")
        col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        li = 0
        for fi, poly in enumerate(me.polygons):
            poly.material_index = self.mats[fi]
            for k, loop_index in enumerate(poly.loop_indices):
                uv.data[loop_index].uv = self.uvs[fi][k]
                col.data[loop_index].color = self.cols[fi][k]
                li += 1
        try:
            me.color_attributes.active_color = col
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (KeyError, AttributeError):
            pass
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def rotz(a):
    return Matrix.Rotation(a, 4, "Z")


def rot3(yaw, pitch=0.0, roll=0.0):
    return (Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "Y") @ Matrix.Rotation(roll, 4, "X")).to_3x3()


# ------------------------------------------------------------------ models


def dung(seed, n, spread, cell="dung"):
    """Horse droppings: a little pile of balls, some broken, straw in them."""
    m = Mesh(ao=0.08)
    rng = np.random.default_rng(seed)
    for k in range(n):
        a = rng.random() * 2 * math.pi
        d = rng.random() * spread
        r = 0.055 + rng.random() * 0.025
        z = r * 0.6 + (0.05 if k >= n - 2 and n > 4 else 0)
        m.lump((math.cos(a) * d, math.sin(a) * d, z), (r, r * 0.9, r * 0.8), cell, seed * 10 + k, detail=0 if k < 2 else -1)
    for k in range(3):
        a = rng.random() * math.pi
        L = 0.12 + rng.random() * 0.08
        m.stalk(((rng.random() - 0.5) * spread, (rng.random() - 0.5) * spread, 0.02), L, 0.012, a, "straw")
    return m


def straw_heap():
    m = Mesh(ao=0.2)
    m.mound(0.5, 0.38, 0.2, "straw", 40, rings=3, sides=9, jit=0.3)
    rng = np.random.default_rng(41)
    for k in range(14):
        a = rng.random() * math.pi
        L = 0.3 + rng.random() * 0.25
        r = rng.random() * 0.5
        b = rng.random() * 2 * math.pi
        z = 0.02 + rng.random() * 0.14
        m.stalk((math.cos(b) * r * 0.9, math.sin(b) * r * 0.7, z), L, 0.016, a, "straw", pitch=(rng.random() - 0.5) * 0.4)
    return m


def straw_wisp():
    m = Mesh(ao=0)
    rng = np.random.default_rng(42)
    for k in range(10):
        a = rng.random() * math.pi
        L = 0.25 + rng.random() * 0.25
        m.stalk(((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0.006 + k * 0.002), L, 0.014, a, "straw")
    return m


def slats(seed, crushed=False):
    """Broken crate slats: boards, one snapped; or a crushed crate, its sides kicked flat."""
    m = Mesh(ao=0.1)
    rng = np.random.default_rng(seed)
    if crushed:
        m.box((0, 0, 0.012), (0.62, 0.42, 0.024), "wood_grey", M=rot3(0.1).to_4x4())
        m.box((0.05, 0.28, 0.1), (0.62, 0.022, 0.26), "wood_grey", M=rot3(0.15, 0, 1.1).to_4x4())
        m.box((-0.35, -0.05, 0.08), (0.022, 0.44, 0.2), "wood", M=rot3(0.1, 0.9).to_4x4())
        for k in range(3):
            m.box(((rng.random() - 0.5) * 0.9, (rng.random() - 0.5) * 0.8, 0.012 + k * 0.004), (0.35 + rng.random() * 0.3, 0.07, 0.016), "wood_grey", M=rot3(rng.random() * 3).to_4x4())
        return m
    for k in range(3):
        L = 0.4 + rng.random() * 0.4
        y = (k - 1) * 0.12 + (rng.random() - 0.5) * 0.08
        a = (rng.random() - 0.5) * 0.8
        lift = 0.035 if k == 1 else 0.009
        m.box((0, y, lift), (L, 0.075, 0.016), "wood" if k != 2 else "wood_grey", M=rot3(a, (rng.random() - 0.5) * 0.15).to_4x4())
    # the snapped end: a splinter
    m.face([(0.3, 0.2, 0.01), (0.42, 0.24, 0.01), (0.3, 0.26, 0.012)], "wood")
    return m


def sacking(seed):
    m = Mesh(ao=0)
    m.sheet(0.75, 0.5, 4, 3, "jute", seed, lift=0.05, tear=0.35)
    return m


def rag(seed, cell):
    m = Mesh(ao=0)
    m.sheet(0.34, 0.26, 3, 3, cell, seed, lift=0.05, tear=0.2)
    return m


def paper_ball():
    m = Mesh(ao=0)
    m.lump((0, 0, 0.04), (0.05, 0.045, 0.04), "paper", 60)
    m.sheet(0.22, 0.3, 2, 2, "paper", 61, lift=0.02)
    return m


def cabbage_leaves(seed):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    for k in range(4):
        m.leaf(((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0.004 * k), 0.2 + rng.random() * 0.08, 0.16, rng.random() * 6.28, 0.03 + rng.random() * 0.03, "cabbage" if k < 3 else "rotten")
    return m


def rotten_veg():
    m = Mesh(ao=0.1)
    # half a cabbage, gone brown
    m.lathe([(0.09, 0.0), (0.085, 0.04), (0.06, 0.075), (0.0, 0.09)], 7, "cabbage", M=Matrix.Translation((0.05, 0, 0)) @ Matrix.Rotation(0.2, 4, "X"), cap0=True, cap1=False, shade=0.7)
    m.lump((-0.12, 0.08, 0.03), (0.05, 0.04, 0.035), "rotten", 70)
    m.lump((-0.06, -0.1, 0.025), (0.04, 0.035, 0.03), "rotten", 71)
    # a carrot and a turnip
    m.lathe([(0.018, 0.0), (0.014, 0.07), (0.0, 0.14)], 5, "carrot", M=Matrix.Translation((0.12, -0.12, 0.018)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Rotation(0.4, 4, "X"), cap1=False)
    m.lump((-0.02, 0.16, 0.035), 0.04, "turnip", 72)
    m.leaf((0.0, 0.0, 0.002), 0.22, 0.15, 1.1, 0.02, "rotten")
    return m


def fish_body(m, L, c, yaw, head_only=False, cell="fish"):
    """A small fish (a herring, a sprat) on its side, or just its head cut off."""
    M = Matrix.Translation(Vector(c)) @ rotz(yaw)
    with m.at(M):
        h = L * 0.22
        t = L * 0.08
        if head_only:
            xs = [0.0, L * 0.12, L * 0.25]
            hs = [h * 0.95, h, h * 0.35]
        else:
            xs = [0.0, L * 0.15, L * 0.45, L * 0.8, L]
            hs = [h * 0.95, h, h * 0.9, h * 0.35, h * 0.1]
        for k in range(len(xs) - 1):
            for sgn in (1, -1):
                z0, z1 = t * (1 if k else 0.6), t
                m.face([(xs[k], -hs[k] / 2, t * 0.3 + (sgn > 0) * 0.0), (xs[k + 1], -hs[k + 1] / 2, t * 0.3), (xs[k + 1], hs[k + 1] / 2, t * 0.3), (xs[k], hs[k] / 2, t * 0.3)], cell,
                       uvs=[(k / (len(xs) - 1), 0), ((k + 1) / (len(xs) - 1), 0), ((k + 1) / (len(xs) - 1), 1), (k / (len(xs) - 1), 1)])
                m.face([(xs[k], hs[k] / 2, t * 0.3), (xs[k + 1], hs[k + 1] / 2, t * 0.3), (xs[k + 1], 0, z1 + t * 0.3), (xs[k], 0, z0 + t * 0.3)], cell)
                m.face([(xs[k], -hs[k] / 2, t * 0.3), (xs[k], 0, z0 + t * 0.3), (xs[k + 1], 0, z1 + t * 0.3), (xs[k + 1], -hs[k + 1] / 2, t * 0.3)], cell)
                break
        # the snout, and the tail or the red cut
        m.face([(0.0, -h * 0.47, t * 0.3), (0.0, h * 0.47, t * 0.3), (-L * 0.06, 0, t * 0.5)], cell)
        if head_only:
            m.face([(xs[-1], -hs[-1] / 2, t * 0.3), (xs[-1], hs[-1] / 2, t * 0.3), (xs[-1] + 0.005, 0, t * 1.2)], "gill")
        else:
            m.face([(L, 0, t * 0.3), (L + L * 0.16, h * 0.45, t * 0.3), (L + L * 0.1, 0, t * 0.35), (L + L * 0.16, -h * 0.45, t * 0.3)], cell)
        # the eye
        m.face([(L * 0.07, -h * 0.12, t * 1.05), (L * 0.1, -h * 0.12, t * 1.05), (L * 0.085, h * 0.02, t * 1.05)], "iron")


def fish_heads(seed):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    for k in range(3):
        fish_body(m, 0.26 + rng.random() * 0.1, ((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0.004 * k), rng.random() * 6.28, head_only=True)
    m.face([(0.1, 0.1, 0.006), (0.18, 0.13, 0.006), (0.14, 0.02, 0.006)], "fish")
    return m


def fish_small(seed):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    fish_body(m, 0.22, (-0.11, 0, 0), 0.3)
    fish_body(m, 0.2, (-0.05, 0.12, 0.004), 2.6 + rng.random())
    return m


def fish_guts():
    m = Mesh(ao=0)
    m.tube([(0, 0, 0.012), (0.05, 0.03, 0.014), (0.1, 0.0, 0.012), (0.08, -0.05, 0.012), (0.03, -0.04, 0.013)], 0.012, "guts", sides=4)
    m.tube([(-0.04, 0.02, 0.01), (-0.08, 0.06, 0.012), (-0.12, 0.03, 0.01)], 0.01, "guts", sides=3, taper=0.5)
    m.lump((-0.02, -0.03, 0.012), (0.03, 0.02, 0.012), "gill", 80)
    return m


def mussel(m, c, yaw, open_=True):
    M = Matrix.Translation(Vector(c)) @ rotz(yaw)
    with m.at(M):
        L, W = 0.055, 0.028
        pts = [(0, 0, 0.002), (L * 0.35, W / 2, 0.002), (L, W * 0.3, 0.002), (L, -W * 0.3, 0.002), (L * 0.35, -W / 2, 0.002)]
        top = (L * 0.5, 0, 0.016)
        for i in range(len(pts)):
            m.face([pts[i], pts[(i + 1) % len(pts)], top], "mussel")
        if open_:
            m.face([p for p in pts][::-1], "mussel_in")


def mussels(seed, n=9):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    for k in range(n):
        mussel(m, ((rng.random() - 0.5) * 0.35, (rng.random() - 0.5) * 0.35, 0.0), rng.random() * 6.28, rng.random() < 0.7)
    return m


def oysters(seed, n=5):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    for k in range(n):
        c = Vector(((rng.random() - 0.5) * 0.4, (rng.random() - 0.5) * 0.4, 0.0))
        r = 0.04 + rng.random() * 0.025
        ring = []
        for i in range(6):
            a = 2 * math.pi * i / 6
            j = 1 + (rng.random() - 0.5) * 0.4
            ring.append(c + Vector((math.cos(a) * r * j * 1.3, math.sin(a) * r * j, 0.003)))
        m.tri_fan(ring, c + Vector((0, 0, 0.018)), "oyster")
    return m


def shell_heap():
    m = Mesh(ao=0.1)
    m.mound(0.42, 0.34, 0.12, "shells", 90, rings=3, sides=8, jit=0.35)
    rng = np.random.default_rng(91)
    for k in range(10):
        a = rng.random() * 6.28
        r = 0.35 + rng.random() * 0.2
        mussel(m, (math.cos(a) * r, math.sin(a) * r * 0.8, 0.0), rng.random() * 6.28)
    for k in range(4):
        a = rng.random() * 6.28
        r = rng.random() * 0.25
        mussel(m, (math.cos(a) * r, math.sin(a) * r, 0.1), rng.random() * 6.28)
    return m


def bottle(cell="glass_green", broken=False):
    m = Mesh(ao=0)
    prof = [(0.036, 0.0), (0.038, 0.17), (0.03, 0.2), (0.014, 0.23), (0.014, 0.28)]
    if broken:
        prof = [(0.014, 0.19), (0.014, 0.25)]
    M = Matrix.Translation((-0.12, 0, 0.036)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Rotation(0.3, 4, "X")
    m.lathe(prof, 6, cell, M=M, cap0=not broken, cap1=False)
    if broken:
        rng = np.random.default_rng(95)
        for k in range(6):
            c = Vector(((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0.004))
            a = rng.random() * 6.28
            s = 0.02 + rng.random() * 0.03
            m.face([c, c + Vector((math.cos(a) * s, math.sin(a) * s, 0)), c + Vector((math.cos(a + 2) * s * 0.7, math.sin(a + 2) * s * 0.7, 0.004))], cell)
    return m


def crockery():
    """A broken pot: curved shards, glazed brown outside, pale inside."""
    m = Mesh(ao=0)
    rng = np.random.default_rng(100)
    for k in range(5):
        a0 = rng.random() * 6.28
        a1 = a0 + 0.5 + rng.random() * 0.6
        R = 0.09
        c = Vector(((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0))
        tilt = rng.random() * 6.28
        with m.at(Matrix.Translation(c) @ rotz(tilt) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            for i in range(2):
                b0 = a0 + (a1 - a0) * i / 2
                b1 = a0 + (a1 - a0) * (i + 1) / 2
                p = [(R * math.cos(b0), R * math.sin(b0) - R + 0.01, 0), (R * math.cos(b1), R * math.sin(b1) - R + 0.01, 0),
                     (R * math.cos(b1), R * math.sin(b1) - R + 0.01, 0.06), (R * math.cos(b0), R * math.sin(b0) - R + 0.01, 0.06)]
                m.face(p, "crock")
                m.face(p[::-1], "crock_in")
    return m


def ash_heap():
    """Ash and cinders put out by the door for the ash cart."""
    m = Mesh(ao=0.18)
    m.mound(0.34, 0.28, 0.16, "ash", 110, rings=3, sides=9, jit=0.3)
    rng = np.random.default_rng(111)
    for k in range(6):
        a = rng.random() * 6.28
        r = 0.3 + rng.random() * 0.12
        m.lump((math.cos(a) * r, math.sin(a) * r * 0.8, 0.012), 0.018, "coal" if k % 2 else "ash", 112 + k, detail=-1)
    return m


def coal_lumps(seed, n=8):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    for k in range(n):
        a = rng.random() * 6.28
        d = rng.random() * 0.35
        r = 0.025 + rng.random() * 0.03
        m.lump((math.cos(a) * d, math.sin(a) * d, r * 0.5), (r, r * 0.8, r * 0.7), "coal", seed * 10 + k, detail=-1 if k > 0 else 0)
    return m


def rope_end(seed):
    m = Mesh(ao=0)
    rng = np.random.default_rng(seed)
    pts = []
    a = rng.random() * 6.28
    p = Vector((-0.25, 0, 0.018))
    for k in range(7):
        pts.append(p.copy())
        a += (rng.random() - 0.5) * 1.1
        p += Vector((math.cos(a), math.sin(a), 0)) * 0.08
    m.tube(pts, 0.016, "rope", sides=3)
    # the frayed end
    e = pts[-1]
    for k in range(4):
        b = a + (k - 1.5) * 0.35
        m.stalk(tuple(e + Vector((math.cos(b), math.sin(b), 0)) * 0.03), 0.06, 0.008, b, "rope")
    return m


def rat_dead():
    """A dead rat on its side, the tail out behind."""
    m = Mesh(ao=0)
    m.lump((0, 0, 0.035), (0.09, 0.04, 0.035), "fur", 120)
    m.lump((0.1, 0.0, 0.028), (0.035, 0.025, 0.022), "fur", 121)
    m.tube([(-0.08, 0, 0.012), (-0.14, 0.03, 0.006), (-0.2, 0.02, 0.005), (-0.26, 0.06, 0.005)], 0.007, "tail", sides=3, taper=0.3)
    for k, (x, y) in enumerate([(0.04, 0.045), (-0.04, 0.045), (0.05, 0.05), (-0.03, 0.05)]):
        m.box((x, y, 0.03 + 0.01 * (k % 2)), (0.012, 0.04, 0.01), "tail")
    m.face([(0.13, -0.01, 0.045), (0.14, 0.01, 0.045), (0.125, 0.0, 0.07)], "tail")
    return m


def bucket():
    """A wooden slop bucket on its side, two iron hoops."""
    m = Mesh(ao=0)
    M = Matrix.Translation((0, 0, 0.13)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Rotation(0.2, 4, "Z")
    m.lathe([(0.12, -0.14), (0.125, -0.12), (0.128, -0.1), (0.14, 0.1), (0.141, 0.12), (0.145, 0.14)], 8, "wood", M=M, cap0=True, cap1=False,
            cells={0: "iron", 4: "iron"})
    return m


def refuse_heap():
    """A heap of household refuse dumped in a back corner: ash, sweepings, cabbage stalks,
    a broken basket, rags, crocks and a board or two."""
    m = Mesh(ao=0.5)
    m.mound(1.25, 0.95, 0.7, "refuse", 130, rings=4, sides=12, jit=0.25, peak=(0.2, 0.25))
    m.mound(0.7, 0.55, 0.3, "ash", 131, rings=3, sides=9, jit=0.3)
    rng = np.random.default_rng(132)
    for k in range(3):
        a = rng.random() * 6.28
        m.box((math.cos(a) * 0.5, math.sin(a) * 0.4, 0.35), (0.9, 0.08, 0.018), "wood_grey", M=rot3(a, 0.5).to_4x4())
    with m.at(Matrix.Translation((0.7, -0.5, 0.18)) @ Matrix.Rotation(0.8, 4, "Y")):
        m.lathe([(0.16, 0.0), (0.22, 0.25)], 7, "wicker", cap0=True, cap1=False)
    for k in range(5):
        a = rng.random() * 6.28
        r = 0.9 + rng.random() * 0.45
        m.leaf((math.cos(a) * r, math.sin(a) * r * 0.8, 0.003), 0.22, 0.16, rng.random() * 6.28, 0.04, "cabbage" if k % 2 else "rotten")
    with m.at(Matrix.Translation((-0.4, 0.3, 0.45))):
        m.sheet(0.4, 0.3, 2, 2, "rag_grey", 133, lift=0.08)
    with m.at(Matrix.Translation((0.3, -0.2, 0.55))):
        m.sheet(0.3, 0.25, 2, 2, "rag_red", 134, lift=0.06)
    for k in range(4):
        a = rng.random() * 6.28
        m.face([(math.cos(a) * 1.2, math.sin(a) * 0.9, 0.02), (math.cos(a) * 1.2 + 0.06, math.sin(a) * 0.9 + 0.02, 0.02), (math.cos(a) * 1.2, math.sin(a) * 0.9 + 0.07, 0.06)], "crock")
    return m


def manure_heap():
    """The stable's dung heap: a steaming mound of dung and straw inside a board edging, a fork in it."""
    m = Mesh(ao=0.6)
    m.mound(1.4, 1.05, 0.95, "manure", 140, rings=4, sides=12, jit=0.2, peak=(0.15, 0.1))
    rng = np.random.default_rng(141)
    for k in range(16):
        a = rng.random() * 6.28
        r = rng.random() * 1.1
        m.stalk((math.cos(a) * r, math.sin(a) * r * 0.75, 0.25 + (1 - r / 1.1) * 0.55), 0.35, 0.02, rng.random() * 3, "straw", pitch=(rng.random() - 0.5) * 0.6)
    # the board edging on the back and one side
    m.box((0, 1.12, 0.22), (3.0, 0.05, 0.44), "wood_dark")
    m.box((-1.5, 0.35, 0.22), (0.05, 1.55, 0.44), "wood_dark")
    for x, y in ((-1.5, 1.12), (1.5, 1.12), (-1.5, -0.4)):
        m.box((x, y, 0.3), (0.08, 0.08, 0.6), "wood_dark")
    # a dung fork stuck in the heap
    with m.at(Matrix.Translation((0.5, -0.1, 0.55)) @ Matrix.Rotation(-0.45, 4, "Y")):
        m.box((0, 0, 0.6), (0.035, 0.035, 1.25), "wood")
        m.box((0, 0, -0.02), (0.2, 0.02, 0.02), "iron")
        for dx in (-0.09, -0.03, 0.03, 0.09):
            m.box((dx, 0, -0.15), (0.012, 0.012, 0.26), "iron")
    for k in range(5):
        a = rng.random() * 6.28
        m.lump((math.cos(a) * 1.5, math.sin(a) * 1.2 - 0.3, 0.03), 0.05, "dung", 142 + k)
    return m


def dung_barrow():
    """The dung collector's wheelbarrow, half full, a shovel across it and a broom leaning on it."""
    m = Mesh(ao=0.4)
    # the box of the barrow: bottom and sloping sides
    b = [(-0.35, -0.28), (0.35, -0.28), (0.35, 0.28), (-0.35, 0.28)]
    z0, z1 = 0.32, 0.62
    m.face([(x, y, z0) for x, y in b], "wood_dark")
    for i in range(4):
        (x0, y0), (x1, y1) = b[i], b[(i + 1) % 4]
        m.face([(x0, y0, z0), (x1, y1, z0), (x1 * 1.25, y1 * 1.2, z1), (x0 * 1.25, y0 * 1.2, z1)], "wood")
        m.face([(x1 * 1.25, y1 * 1.2, z1), (x1, y1, z0), (x0, y0, z0), (x0 * 1.25, y0 * 1.2, z1)], "wood_dark")
    with m.at(Matrix.Translation((0, 0, 0.46))):
        m.mound(0.4, 0.3, 0.2, "manure", 150, rings=2, sides=8, jit=0.2)
    # handles and legs
    for s in (-1, 1):
        m.box((-0.75, s * 0.25, 0.42), (1.3, 0.04, 0.04), "wood", M=rot3(0, 0.12).to_4x4())
        m.box((-0.3, s * 0.25, 0.16), (0.04, 0.04, 0.32), "wood")
    m.lathe([(0.2, -0.025), (0.2, 0.025)], 8, "wood_dark", M=Matrix.Translation((0.48, 0, 0.2)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    # a shovel across the load
    m.box((0.0, 0.05, 0.72), (1.1, 0.03, 0.03), "wood", M=rot3(0.3, -0.12).to_4x4())
    m.box((0.55, 0.22, 0.66), (0.24, 0.2, 0.012), "iron", M=rot3(0.3, -0.12).to_4x4())
    # the broom leaning on the wheel side
    with m.at(Matrix.Translation((0.62, 0.45, 0.0)) @ Matrix.Rotation(-0.35, 4, "X")):
        m.box((0, 0, 0.75), (0.03, 0.03, 1.4), "wood")
        m.box((0, 0, 0.08), (0.1, 0.1, 0.18), "straw")
    return m


def leaf_pile(seed, rx, ry, h):
    """A low pile of leaves blown into a corner or against a wall foot: a flat mound covered in leaves, loose
    leaves round its foot (package 1). Low enough to walk through (the game gives it no collider)."""
    m = Mesh(ao=0.3)
    rng = np.random.default_rng(seed)
    m.mound(rx, ry, h, "leaves", seed, rings=3, sides=9, jit=0.35, peak=(0.0, -ry * 0.25))
    for k in range(10):
        a = rng.random() * 2 * math.pi
        d = 0.75 + rng.random() * 0.35
        m.leaf((math.cos(a) * rx * d, math.sin(a) * ry * d, 0.004 + 0.002 * k), 0.13 + rng.random() * 0.06, 0.12, rng.random() * 6.28, 0.012, "leaves")
    return m


def build_models():
    B = []
    B.append(("dung_0", dung(1, 6, 0.12)))
    B.append(("dung_1", dung(2, 8, 0.16)))
    B.append(("dung_2", dung(3, 4, 0.1, cell="dung_old")))
    B.append(("straw_heap", straw_heap()))
    B.append(("straw_wisp", straw_wisp()))
    B.append(("slats_0", slats(10)))
    B.append(("slats_1", slats(11, crushed=True)))
    B.append(("sacking_0", sacking(20)))
    B.append(("sacking_1", sacking(21)))
    B.append(("rag_0", rag(22, "rag_red")))
    B.append(("rag_1", rag(23, "rag_blue")))
    B.append(("rag_2", rag(24, "rag_grey")))
    B.append(("paper_ball", paper_ball()))
    B.append(("cabbage_0", cabbage_leaves(30)))
    B.append(("cabbage_1", cabbage_leaves(31)))
    B.append(("veg_rotten", rotten_veg()))
    B.append(("fish_heads", fish_heads(40)))
    B.append(("fish_small", fish_small(41)))
    B.append(("fish_guts", fish_guts()))
    B.append(("mussels", mussels(50)))
    B.append(("oysters", oysters(51)))
    B.append(("shell_heap", shell_heap()))
    B.append(("bottle", bottle()))
    B.append(("bottle_brown", bottle("glass_brown")))
    B.append(("glass_broken", bottle("glass_green", broken=True)))
    B.append(("crockery", crockery()))
    B.append(("ash_heap", ash_heap()))
    B.append(("coal_0", coal_lumps(60, 8)))
    B.append(("coal_1", coal_lumps(61, 4)))
    B.append(("rope_end_0", rope_end(70)))
    B.append(("rope_end_1", rope_end(71)))
    B.append(("rat_dead", rat_dead()))
    B.append(("bucket", bucket()))
    B.append(("refuse_heap", refuse_heap()))
    B.append(("manure_heap", manure_heap()))
    B.append(("dung_barrow", dung_barrow()))
    B.append(("leafpile_0", leaf_pile(80, 0.42, 0.3, 0.07)))
    B.append(("leafpile_1", leaf_pile(81, 0.6, 0.34, 0.09)))
    # one quad that carries the flat marks' atlas into the glb (the game builds those quads itself)
    carrier = Mesh(ao=0)
    carrier.face([(0, 0, 0), (0.1, 0, 0), (0.1, 0.1, 0), (0, 0.1, 0)], "muck_0", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL)
    B.append(("decal_atlas", carrier))
    meta = {
        "decals": {k: {"cell": list(DECAL_ATLAS.cells[k]), "w": w, "d": d} for k, (_fn, w, d) in DECALS.items()},
        "decalSize": [DECAL_ATLAS.W, DECAL_ATLAS.H],
    }
    return B, meta


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def preview(objs):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.7, 0.2, 0.5)
    sc.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.color = (0.35, 0.36, 0.38)
    # a floor of wet grey stone
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.001))
    fl = bpy.context.active_object
    fm = bpy.data.materials.new("floor")
    fm.diffuse_color = (0.18, 0.18, 0.17, 1)
    fl.data.materials.append(fm)
    for m in MAT_NAMES:
        mat = bpy.data.materials[m]
        try:
            mat.blend_method = "HASHED"
        except AttributeError:
            pass
    x = -6.0
    row = 0
    for n, o in objs.items():
        big = n in ("refuse_heap", "manure_heap", "dung_barrow")
        o.location = (x, row * 1.2 + (3.5 if big else 0), 0)
        x += 3.4 if big else 0.8
        if x > 6:
            x = -6.0
            row += 1
    # the flat marks laid out in a row in front
    me = Mesh(ao=0)
    x = -7.0
    for k, (_fn, w, d) in DECALS.items():
        if k in ("urine_wall",):
            continue
        me.face([(x, -2.5, 0.002), (x + w, -2.5, 0.002), (x + w, -2.5 + d, 0.002), (x, -2.5 + d, 0.002)], k, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL)
        x += w + 0.15
    me.to_object("decals_preview")
    cam.location = (0, -9, 6.5)
    d = Vector((0, 1.5, 0)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 22
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.filepath = os.path.join(SHOTS, "litter_preview.png")
    os.makedirs(SHOTS, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_litter] preview -> {sc.render.filepath}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    make_materials()
    models, meta = build_models()
    objs = {}
    for name, mesh in models:
        objs[name] = mesh.to_object(name)
    counts = {n: tris(o) for n, o in objs.items()}
    node = bpy.data.objects.new("litter_meta", None)
    node["meta"] = json.dumps(meta, separators=(",", ":"))
    bpy.context.scene.collection.objects.link(node)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_litter] {n:16s} {c:5d} tris")
    print(f"[build_litter] atlases: solid {SOLID_ATLAS.W}x{SOLID_ATLAS.H}, decal {DECAL_ATLAS.W}x{DECAL_ATLAS.H}")
    print(f"[build_litter] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


main()

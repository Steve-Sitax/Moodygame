"""Three churches of 1873 Antwerp, the Stadspark's pond and furniture, and the town pump, modelled
and painted by this script.

    blender -b --factory-startup -P tools/blender/build_churches.py
    blender -b --factory-startup -P tools/blender/build_churches.py -- --preview [name,name] [--context]

Reads shared/city.json: landmarks.carolus / stpaul / stjacob (the outline "fp" and its "frame": centre
c, long axis ax, cross axis n, length L, width W, the open side), decor.park (outline, ponds),
decor.rampart.inner_line (the town face of the wall, which cuts the park) and alleys.pumps (only
counted: the game places the pump). Writes client/public/models/churches.glb (Draco, 20-bit
positions) and client/public/models/park.json (the park's solids for the walk map).

Frame: a game point (x, y, z) sits at Blender (x, -z, y). The glTF export turns Blender Z-up into
Y-up, so the glb loads in game coordinates. church_*, park: origin at the world origin, placed as
they are. pump: origin at its foot, spout toward +z; the game places copies.

The walk map treats a landmark's outline and its minimum rotated rectangle as solid, so each church
fills that rectangle: the church itself, and round it what stood there (the Jesuit house and the
Lady Chapel beside the Carolus front, the Dominican convent round St Paul's choir, a walled
churchyard and a sacristy at St James). Nothing but roof eaves and cornices reaches past it.

  church_carolus  Sint-Carolus Borromeus (Jesuits, 1615-21): the three-storey Baroque front on the
                  Conscienceplein (columns, niches with statues, the IHS medallion, volutes, the
                  pediment), a basilica with galleries, a round apse, the tower behind the choir
                  with its octagon and dome
  church_stpaul   Sint-Pauluskerk (Dominicans, 1517-71): brick and white stone, aisles under a row
                  of cross gables, transept, long choir, the Baroque tower (1679) with its bulb
  church_stjacob  Sint-Jacobskerk (Brabant Gothic, 1491-1656): the great square west tower, never
                  finished, with its lantern; nave, aisles, chapels, transept, choir with an
                  ambulatory; a churchyard wall
  park            the Stadspark (1867-69): the pond (a stone rim, the water at y -0.35, material
                  park_water), a timber footbridge over its narrow waist, benches, park lanterns,
                  the iron railing on a stone kerb with three openings toward the streets
  pump            a cast-iron town pump on a stone base with a stone trough

Materials (a small texture each, painted below, nearest filter; vertex colour "Col" carries the
shade: darker at the foot and in reveals):
  church_stone (pale sandstone), church_greystone (grey Brabant stone), church_brick,
  church_slate, church_lead (domes, bulbs, flat roofs), church_atlas (windows with their tracery,
  doors, louvres, niches with statues, the IHS medallion, clock faces; each opening maps one cell),
  park_stone (blue-grey stone), park_water, park_iron (drawn double-sided: the railing's pickets are
  single faces), park_wood, park_lamp_glow (lantern glass: the game draws it bright).
One texture scale per tiling material (TILE); atlas cells are fitted per opening.

No two faces in one plane: where two masses meet, the one behind has no face there; relief (bands,
buttresses, columns) is sunk into its wall; nothing lies flat at y 0 (the game's ground). The check
runs on the exported glb (it prints any pair it finds).

--preview renders data/shots/churches_*.png; --context also loads city.glb and wall.glb round them.
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
WALK = os.path.join(ROOT, "client", "public", "city", "walk.png")
OUT = os.path.join(ROOT, "client", "public", "models", "churches.glb")
PARK_JSON = os.path.join(ROOT, "client", "public", "models", "park.json")
SHOTS = os.path.join(ROOT, "data", "shots")

MATS = ["church_stone", "church_greystone", "church_brick", "church_slate", "church_lead", "church_atlas",
        "park_stone", "park_water", "park_iron", "park_wood", "park_lamp_glow"]
STONE, GREY, BRICK, SLATE, LEAD, ATLAS, PSTONE, WATER, IRON, WOOD, GLOW = range(len(MATS))
# metres per texture repeat (u, v)
TILE = {STONE: (2.4, 2.4), GREY: (2.4, 2.4), BRICK: (2.4, 1.8), SLATE: (1.6, 1.6), LEAD: (0.8, 0.8), ATLAS: (1.0, 1.0),
        PSTONE: (1.2, 1.2), WATER: (2.0, 2.0), IRON: (1.0, 1.0), WOOD: (1.2, 1.2), GLOW: (1.0, 1.0)}

SEG = 4.0  # longest face edge on walls and roofs (the game's textures swim on big faces)
FOOT = -0.3  # walls start under the ground
M = 0.15  # walls on the rectangle's edge stand this far inside it (their plinth fits)


# ------------------------------------------------------------------ small helpers


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def B(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def tint(x, z):
    return 0.95 + 0.05 * math.sin(x * 0.13 + 1.1 * math.cos(z * 0.09)) * math.cos(z * 0.11 - x * 0.05)


def amb(p, floor=0.0):
    dy = p[1] - floor
    s = 0.55 if dy < 0 else 0.64 + 0.36 * sm(dy / 2.2)
    return s * tint(p[0], p[2])


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def refine(vals, step):
    out = []
    for a, b in zip(vals, vals[1:]):
        n = max(1, math.ceil((b - a) / step - 1e-9))
        out += [a + (b - a) * i / n for i in range(n)]
    out.append(vals[-1])
    return out


def clip_half(poly, f):
    """The part of a polygon where f(p) >= 0 (f linear along edges)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp, fq = f(p), f(q)
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0) and abs(fp - fq) > 1e-12:
            t = fp / (fp - fq)
            out.append(tuple(a + (b - a) * t for a, b in zip(p, q)))
    res = []
    for p in out:
        if not res or max(abs(a - b) for a, b in zip(p, res[-1])) > 1e-7:
            res.append(p)
    if len(res) > 1 and max(abs(a - b) for a, b in zip(res[0], res[-1])) < 1e-7:
        res.pop()
    return res


def area2(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def inside(p, ring):
    x, z = p
    c = False
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c


def seg_dist(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / max(ax * ax + az * az, 1e-12)))
    return math.hypot(a[0] + ax * t - p[0], a[1] + az * t - p[1])


def poly_dist(p, ring):
    return min(seg_dist(p, ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring)))


def head_h(shape, w):
    """Height of an opening's arched head over its springing (w wide)."""
    if shape == "round":
        return w / 2
    if shape == "pointed":
        r = 0.8 * w
        return math.sqrt(r * r - (r - w / 2) ** 2)
    return 0.0


def arch_arc(u0, u1, ys, shape):
    """The arch from the right springing over the top to the left springing."""
    w = u1 - u0
    um = (u0 + u1) / 2
    if shape == "round":
        n = 8
        r = w / 2
        return [(um + r * math.cos(math.pi * i / n), ys + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    r = 0.8 * w
    h = head_h("pointed", w)
    phi = math.atan2(h, r - w / 2)
    right = [(u1 - r + r * math.cos(phi * i / 3), ys + r * math.sin(phi * i / 3)) for i in range(4)]
    left = [(u0 + r + r * math.cos(math.pi - phi + phi * i / 3), ys + r * math.sin(math.pi - phi + phi * i / 3)) for i in range(1, 4)]
    right[-1] = (um, ys + h)
    left[-1] = (u0, ys)
    return right + left


# ------------------------------------------------------------------ textures


def C(*rgb):
    return np.array(rgb, dtype=np.float64)


def noise2(rng, h, w, cv, cu):
    """Tileable value noise, h x w, cv x cu cells."""
    g = rng.random((cv, cu))

    def axis(n, c):
        t = np.arange(n) * c / n
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    v0, v1, fv = axis(h, cv)
    u0, u1, fu = axis(w, cu)
    fu, fv = fu[None, :], fv[:, None]
    return ((g[np.ix_(v0, u0)] * (1 - fu) + g[np.ix_(v0, u1)] * fu) * (1 - fv)
            + (g[np.ix_(v1, u0)] * (1 - fu) + g[np.ix_(v1, u1)] * fu) * fv)


def speckle(img, rng, amount, lo=0.6, hi=0.9):
    m = rng.random(img.shape[:2]) < amount
    img[m] *= rng.uniform(lo, hi, (int(m.sum()), 1))
    return img


# rows of the arrays run from the bottom of the picture (v = 0) up


def paint_ashlar(rng, n, base, joint, course, lo, hi, streaks=0.0):
    img = np.empty((n, n, 3))
    for r in range(n // course):
        u = int(rng.integers(0, n))
        start = u
        cuts = []
        while True:
            cuts.append(u)
            u += int(rng.integers(lo, hi))
            if u >= start + n - lo // 2:
                break
        for i, c0 in enumerate(cuts):
            c1 = cuts[i + 1] if i + 1 < len(cuts) else start + n
            col = base * rng.uniform(0.88, 1.08)
            for uu in range(c0, c1):
                img[r * course:(r + 1) * course, uu % n] = col
            img[r * course:(r + 1) * course, c0 % n] = joint
        img[r * course] = joint
    img *= (0.93 + 0.11 * noise2(rng, n, n, 8, 8))[..., None]
    if streaks:
        img *= (1.0 - streaks * noise2(rng, n, n, 3, 11))[..., None]
    return speckle(img, rng, 0.07, 0.85, 1.08)


def paint_brick(rng, w=128, h=96, px=4, blen=16):
    img = np.empty((h, w, 3))
    img[:] = C(0.52, 0.49, 0.44)
    for c in range(h // px):
        off = (c % 2) * (blen // 2)
        for b in range(w // blen + 1):
            u0 = b * blen + off
            r = rng.random()
            if r < 0.1:
                col = C(0.30, 0.15, 0.14) * rng.uniform(0.9, 1.1)
            elif r < 0.16:
                col = C(0.60, 0.36, 0.25)
            else:
                col = C(0.48, 0.23, 0.17) * rng.uniform(0.84, 1.1)
            for u in range(u0 + 1, u0 + blen):
                img[c * px + 1:(c + 1) * px, u % w] = col
    img *= (0.9 + 0.15 * noise2(rng, h, w, 6, 8))[..., None]
    return speckle(img, rng, 0.06, 0.85, 0.95)


def paint_slate(rng, n=64):
    img = np.empty((n, n, 3))
    for r in range(n // 8):
        off = (r % 2) * 4
        for c in range(n // 8 + 1):
            col = C(0.22, 0.24, 0.29) * rng.uniform(0.82, 1.15)
            if rng.random() < 0.08:
                col = C(0.30, 0.32, 0.36)
            for u in range(c * 8 + off, c * 8 + off + 8):
                img[r * 8:(r + 1) * 8, u % n] = col
            img[r * 8:(r + 1) * 8, (c * 8 + off) % n] = col * 0.6
        img[r * 8] *= 0.5
    img *= (0.9 + 0.16 * noise2(rng, n, n, 8, 8))[..., None]
    return img


def paint_lead(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.42, 0.46, 0.48)
    img *= (0.9 + 0.14 * noise2(rng, n, n, 4, 4))[..., None]
    for x in (0, 16):
        img[:, x] = C(0.30, 0.33, 0.35)
        img[:, x + 1] = C(0.52, 0.56, 0.58)
    for y, off in ((0, 0), (16, 8)):
        img[y, :] *= 0.8
    return speckle(img, rng, 0.05, 0.8, 1.1)


def paint_water(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.13, 0.19, 0.18)
    nz = noise2(rng, n, n, 4, 4)
    yy, xx = np.mgrid[0:n, 0:n]
    rip = np.sin((yy + 3 * nz * 4) * 2 * math.pi / 8)
    img *= (0.85 + 0.25 * nz)[..., None]
    img[rip > 0.85] = C(0.24, 0.30, 0.29)
    return img


def paint_iron(rng, n=16):
    img = np.ones((n, n, 3)) * C(0.08, 0.09, 0.085)
    return img * (0.85 + 0.3 * rng.random((n, n, 1)))


def paint_wood(rng, n=64):
    """Boards along u (bench slats, the footbridge's planks)."""
    img = np.empty((n, n, 3))
    grain = noise2(rng, n, n, 3, 16)
    for b in range(n // 8):
        col = C(0.40, 0.31, 0.22) * rng.uniform(0.82, 1.12)
        img[b * 8:(b + 1) * 8] = col
        img[b * 8] = col * 0.45
    img *= (0.82 + 0.3 * grain)[..., None]
    return img


def paint_glow(rng, n=16):
    img = np.ones((n, n, 3)) * C(1.0, 0.86, 0.52)
    yy, xx = np.mgrid[0:n, 0:n]
    img *= (1.0 - 0.25 * (np.hypot(xx - 7.5, yy - 7.5) / 8))[..., None]
    img[0, :] = img[-1, :] = img[:, 0] = img[:, -1] = C(0.1, 0.1, 0.09)
    return img


# ---- the atlas: windows, doors, louvres, niches, medallions

AT = 256
CELL = {  # name: (x0, y0, w, h, head shape) in pixels, y from the bottom
    "goth4": (0, 0, 64, 128, "pointed"),
    "goth2": (0, 128, 32, 96, "pointed"),
    "round": (32, 128, 32, 80, "round"),
    "door_r": (64, 0, 64, 96, "round"),
    "door_g": (128, 0, 64, 96, "pointed"),
    "clock": (64, 96, 32, 32, "rect"),
    "hwin": (96, 96, 32, 48, "rect"),
    "louv_p": (64, 144, 32, 64, "pointed"),
    "louv_r": (96, 144, 32, 64, "round"),
    "niche": (128, 96, 32, 64, "round"),
    "blind": (160, 96, 32, 96, "pointed"),
    "ihs": (192, 0, 64, 64, "rect"),
    "rose": (192, 64, 64, 64, "rect"),
    "gilt": (192, 128, 8, 8, "rect"),
    "iron": (200, 128, 8, 8, "rect"),
    "dark": (208, 128, 8, 8, "rect"),
    "lead": (216, 128, 8, 8, "rect"),
}


def cell_uv(name, fu, fv, part="all"):
    x0, y0, w, h, shape = CELL[name]
    hh = head_h(shape, w)
    u = x0 + 0.5 + fu * (w - 1)
    if part == "body":
        v = y0 + 0.5 + fv * (h - hh - 0.5)
    elif part == "head":
        v = y0 + (h - hh) + fv * (hh - 0.5)
    else:
        v = y0 + 0.5 + fv * (h - 1)
    return (u / AT, v / AT)


def arch_mask(W, H, x0, ww, hb, shape):
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    xr = xx - x0
    inx = (xr >= 0) & (xr <= ww)
    m = inx & (yy < hb)
    if shape == "round":
        m |= inx & (yy >= hb) & ((xr - ww / 2) ** 2 + (yy - hb) ** 2 <= (ww / 2) ** 2)
    elif shape == "pointed":
        r = 0.8 * ww
        m |= (yy >= hb) & ((xr - r) ** 2 + (yy - hb) ** 2 <= r * r) & ((xr - (ww - r)) ** 2 + (yy - hb) ** 2 <= r * r)
    else:
        m = inx & (yy < H)
    return m


def erode(m):
    return m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)


def edge(m):
    e = m & ~erode(m)
    e[0, :] = m[0, :]
    e[:, 0] |= m[:, 0]
    e[:, -1] |= m[:, -1]
    return e


def leaded(rng, h, w, base, came, step=4, rect=False):
    yy, xx = np.mgrid[0:h, 0:w]
    if rect:
        cid = (xx // step) * 97 + (yy // (step + 1))
        lines = (xx % step == 0) | (yy % (step + 1) == 0)
    else:
        cid = ((xx + yy) // step) * 97 + ((xx - yy) // step)
        lines = ((xx + yy) % step == 0) | ((xx - yy) % step == 0)
    tab = rng.uniform(0.75, 1.2, 97 * 97 * 2)
    img = np.ones((h, w, 3)) * base * tab[(cid % len(tab))][..., None]
    img[lines] = came
    return img


def paint_goth(rng, w, h, lights):
    hh = head_h("pointed", w)
    hb = h - hh
    stone = C(0.72, 0.68, 0.60)
    img = np.ones((h, w, 3)) * stone * (0.92 + 0.1 * rng.random((h, w, 1)))
    m = arch_mask(w, h, 0, w, hb, "pointed")
    gl = leaded(rng, h, w, C(0.11, 0.14, 0.19), C(0.035, 0.035, 0.04), 4)
    gl *= (0.7 + 0.7 * (np.arange(h) / h))[:, None, None]
    tints = [C(0.35, 0.10, 0.10), C(0.10, 0.14, 0.35), C(0.40, 0.30, 0.08)]
    yy, xx = np.mgrid[0:h, 0:w]
    blob = rng.random((h // 4 + 1, w // 4 + 1))
    col_pick = (blob[yy // 4, xx // 4] < 0.12) & (yy > hb * 0.55)
    for i, t in enumerate(tints):
        sel = col_pick & ((xx // 4 + yy // 4) % 3 == i)
        gl[sel] = t
    img[m] = gl[m]
    stone_px = np.zeros((h, w), bool)
    stone_px |= edge(m)
    for i in range(1, lights):
        x = int(round(i * w / lights))
        stone_px[1:int(hb) + 1, x - 1:x + 1] = True
    ty = int(hb * 0.48)
    stone_px[ty:ty + 2, :] = True
    # the head: an arch over each pair of lights, a circle between them with a quatrefoil
    halves = [(0.0, w / 2), (w / 2, w / 2)]
    for x0, ww in halves:
        sm_ = arch_mask(w, h, x0, ww, hb, "pointed")
        stone_px |= edge(sm_) & (yy >= hb - 1)
    yyf, xxf = yy + 0.5, xx + 0.5
    R = w * 0.17
    cy = hb + hh * 0.6
    d = np.hypot(xxf - w / 2, yyf - cy)
    stone_px |= (np.abs(d - R) < 1.0)
    for ang in (0, 90, 180, 270):
        ox, oy = math.cos(math.radians(ang)) * R * 0.5, math.sin(math.radians(ang)) * R * 0.5
        dd = np.hypot(xxf - w / 2 - ox, yyf - cy - oy)
        stone_px |= (np.abs(dd - R * 0.45) < 0.6) & (d < R)
    stone_px &= m
    img[stone_px] = stone * 0.97
    # mullions throw a shadow to the right
    sh = np.roll(stone_px, 1, 1) & ~stone_px & m
    img[sh] *= 0.55
    return img


def paint_round_win(rng, w, h):
    hh = w / 2
    hb = h - hh
    stone = C(0.73, 0.69, 0.60)
    img = np.ones((h, w, 3)) * stone
    m = arch_mask(w, h, 0, w, hb, "round")
    gl = leaded(rng, h, w, C(0.24, 0.28, 0.29), C(0.07, 0.07, 0.08), 4, rect=True)
    gl *= (0.75 + 0.55 * (np.arange(h) / h))[:, None, None]
    for y in range(12, h, 14):
        gl[y] = C(0.05, 0.05, 0.06)
    img[m] = gl[m]
    img[edge(m)] = stone * 0.95
    x = w // 2
    img[1:int(hb), x - 1:x + 1] = stone
    img[1:int(hb), x + 1] *= 0.6
    return img


def paint_door(rng, w, h, shape):
    hh = head_h(shape, w)
    hb = int(round(h - hh))
    stone = C(0.70, 0.66, 0.58)
    img = np.ones((h, w, 3)) * stone * (0.93 + 0.08 * rng.random((h, w, 1)))
    wood = C(0.25, 0.15, 0.09) if shape == "round" else C(0.27, 0.18, 0.11)
    grain = noise2(rng, h, w, 12, 4)
    leaf = np.ones((h, w, 3)) * wood * (0.8 + 0.35 * grain)[..., None]
    yy, xx = np.mgrid[0:h, 0:w]
    if shape == "round":
        # three raised panels a leaf
        for lx0 in (2, w // 2 + 1):
            lw = w // 2 - 3
            for p0, p1 in ((3, hb * 0.3), (hb * 0.34, hb * 0.66), (hb * 0.7, hb - 3)):
                p0, p1 = int(p0), int(p1)
                leaf[p0:p1, lx0 + 2:lx0 + lw - 2] *= 1.12
                leaf[p1 - 1, lx0 + 2:lx0 + lw - 2] = wood * 1.5
                leaf[p0:p1, lx0 + 2] = wood * 1.4
                leaf[p0, lx0 + 2:lx0 + lw - 2] = wood * 0.5
                leaf[p0:p1, lx0 + lw - 3] = wood * 0.55
    else:
        leaf[:, ::6] *= 0.5
        for y0 in (int(hb * 0.18), int(hb * 0.72)):
            leaf[y0:y0 + 3, 3:w - 3] = C(0.07, 0.07, 0.08)
            leaf[y0 + 1, 5:w - 5:5] = C(0.25, 0.24, 0.22)
    leaf[:, w // 2 - 1:w // 2 + 1] = C(0.06, 0.04, 0.03)
    for cx in (w // 2 - 5, w // 2 + 4):
        dd = np.hypot(xx + 0.5 - cx, yy + 0.5 - hb * 0.45)
        leaf[(dd > 1.6) & (dd < 2.8)] = C(0.08, 0.08, 0.08)
    body = arch_mask(w, h, 0, w, hb, shape) & (yy < hb)
    img[body] = leaf[body]
    head = arch_mask(w, h, 0, w, hb, shape) & (yy >= hb)
    if shape == "round":
        # a stone transom, a fanlight with bars from the middle
        fan = head & (yy >= hb + 3)
        ang = np.arctan2(yy + 0.5 - hb - 3, xx + 0.5 - w / 2)
        glass = np.ones((h, w, 3)) * C(0.09, 0.11, 0.13)
        bars = (np.abs(((ang / math.pi * 8) % 1.0) - 0.5) > 0.42) | (np.hypot(xx + 0.5 - w / 2, yy + 0.5 - hb - 3) < 6)
        glass[bars] = C(0.12, 0.10, 0.08)
        img[fan] = glass[fan]
        img[head & (yy < hb + 3)] = stone * 1.05
    else:
        # the tympanum: a blind trefoil
        dd = np.hypot(xx + 0.5 - w / 2, yy + 0.5 - hb - hh * 0.42)
        img[head & (np.abs(dd - hh * 0.3) < 1.0)] = stone * 0.6
        img[head & (yy < hb + 2)] = stone * 0.8
    img[edge(arch_mask(w, h, 0, w, hb, shape))] *= 0.75
    return img


def paint_louvre(rng, w, h, shape):
    hh = head_h(shape, w)
    hb = h - hh
    stone = C(0.70, 0.66, 0.58)
    img = np.ones((h, w, 3)) * stone
    m = arch_mask(w, h, 0, w, hb, shape)
    lv = np.ones((h, w, 3)) * C(0.04, 0.04, 0.045)
    for y in range(2, h, 4):
        lv[y] = C(0.30, 0.26, 0.21)
        lv[y + 1 if y + 1 < h else y] = C(0.20, 0.17, 0.14)
    lv *= (0.85 + 0.3 * rng.random((h, 1, 1)))
    img[m] = lv[m]
    img[edge(m)] = stone * 0.9
    return img


def paint_niche(rng, w, h):
    hh = w / 2
    hb = h - hh
    img = np.ones((h, w, 3)) * C(0.36, 0.34, 0.31)
    yy, xx = np.mgrid[0:h, 0:w]
    img *= (1.0 - 0.35 * (yy / h))[..., None]
    ang = np.arctan2(yy + 0.5 - hb, xx + 0.5 - w / 2)
    rib = (yy >= hb) & (((ang / math.pi * 9) % 1.0) < 0.35)
    img[rib] = C(0.52, 0.49, 0.44)
    fig = C(0.76, 0.74, 0.68)
    cx = w / 2
    f = np.zeros((h, w), bool)
    f |= (yy < 6) & (np.abs(xx + 0.5 - cx) < 7)
    for y in range(6, 38):
        hw = 6.5 - 2.3 * (y - 6) / 32
        f[y] |= np.abs(np.arange(w) + 0.5 - cx) < hw
    f |= (yy >= 36) & (yy < 39) & (np.abs(xx + 0.5 - cx) < 5)
    f |= np.hypot(xx + 0.5 - cx, yy + 0.5 - 42.5) < 3.4
    img[f] = fig
    img[f & (xx + 0.5 > cx + 1.5)] = fig * 0.78
    img[(yy < 6) & (np.abs(xx + 0.5 - cx) < 7)] = C(0.62, 0.60, 0.55)
    img[edge(f)] *= 0.7
    return img


def paint_blind(rng, w, h):
    hh = head_h("pointed", w)
    hb = h - hh
    stone = C(0.62, 0.60, 0.55)
    img = np.ones((h, w, 3)) * stone * (0.92 + 0.1 * rng.random((h, w, 1)))
    line = C(0.40, 0.38, 0.35)
    m = arch_mask(w, h, 0, w, hb, "pointed")
    inner = erode(erode(erode(m)))
    img[edge(inner)] = line
    img[3:int(hb), w // 2] = line
    img[3:int(hb), w // 2 + 1] = stone * 1.1
    yy, xx = np.mgrid[0:h, 0:w]
    for x0 in (3.0, w / 2):
        sm_ = arch_mask(w, h, x0, w / 2 - 3, hb, "pointed")
        img[edge(sm_) & (yy >= hb - 1) & inner] = line
    d = np.hypot(xx + 0.5 - w / 2, yy + 0.5 - hb - hh * 0.62)
    img[(np.abs(d - 3.5) < 0.7) & inner] = line
    return img


FONT = {
    "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
}


def paint_ihs(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.70, 0.66, 0.58) * (0.94 + 0.08 * rng.random((n, n, 1)))
    yy, xx = np.mgrid[0:n, 0:n]
    dx, dy = xx + 0.5 - n / 2, yy + 0.5 - n / 2
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    k = (ang / (2 * math.pi) * 32) % 1.0
    ray_len = np.where(((ang / (2 * math.pi) * 32) // 1) % 2 == 0, 29.5, 24.0) * (1 - np.abs(k - 0.5) * 0.9)
    gilt, dgilt = C(0.80, 0.63, 0.27), C(0.55, 0.42, 0.17)
    img[(r > 12) & (r < ray_len)] = gilt
    img[(r > 12) & (r < ray_len) & (k > 0.5)] = dgilt
    img[r < 13.5] = gilt * 1.05
    img[np.abs(r - 13.5) < 0.8] = dgilt * 0.8
    txt = np.zeros((n, n), bool)
    x = n // 2 - 17
    for ch in "IHS":
        for rr, row in enumerate(FONT[ch]):
            for cc, c in enumerate(row):
                if c == "#":
                    y = n // 2 + 6 - rr * 2
                    txt[y - 1:y + 1, x + cc * 2:x + cc * 2 + 2] = True
        x += 12
    img[txt] = C(0.14, 0.10, 0.07)
    img[n // 2 + 9:n // 2 + 15, n // 2 - 1:n // 2 + 1] = C(0.14, 0.10, 0.07)
    img[n // 2 + 12:n // 2 + 14, n // 2 - 3:n // 2 + 3] = C(0.14, 0.10, 0.07)
    img[np.abs(r - 31) < 1.0] *= 0.7
    return img


def paint_rose(rng, n=64):
    stone = C(0.72, 0.68, 0.60)
    img = np.ones((n, n, 3)) * stone
    yy, xx = np.mgrid[0:n, 0:n]
    dx, dy = xx + 0.5 - n / 2, yy + 0.5 - n / 2
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    gl = leaded(rng, n, n, C(0.12, 0.15, 0.20), C(0.04, 0.04, 0.05), 4)
    tints = [C(0.35, 0.10, 0.10), C(0.10, 0.14, 0.35), C(0.40, 0.30, 0.08)]
    sect = ((ang / (2 * math.pi) * 8) // 1).astype(int) % 3
    for i, t in enumerate(tints):
        gl[(sect == i) & (r > 12) & (r < 18)] = t
    m = r < 27
    img[m] = gl[m]
    spoke = (np.abs(((ang / (2 * math.pi) * 8) % 1.0) - 0.5) > 0.45) & (r < 27) & (r > 8)
    img[spoke] = stone
    img[np.abs(r - 8) < 1.2] = stone
    img[np.abs(r - 27) < 1.5] = stone * 0.9
    for i in range(8):
        a = (i + 0.5) * 2 * math.pi / 8
        d = np.hypot(dx - math.cos(a) * 20, dy - math.sin(a) * 20)
        img[np.abs(d - 4.2) < 0.7] = stone
    img[np.abs(r - 31) < 1.0] *= 0.7
    return img


def paint_clock(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.70, 0.66, 0.58)
    yy, xx = np.mgrid[0:n, 0:n]
    dx, dy = xx + 0.5 - n / 2, yy + 0.5 - n / 2
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    img[r < 15.5] = C(0.10, 0.12, 0.18)
    img[r < 12.5] = C(0.82, 0.79, 0.68)
    for i in range(12):
        a = i * 2 * math.pi / 12
        d = np.hypot(dx - math.cos(a) * 11, dy - math.sin(a) * 11)
        img[d < 1.0] = C(0.1, 0.1, 0.1)
    for a, L in ((math.radians(150), 6.0), (math.radians(60), 10.0)):
        t = dx * math.cos(a) + dy * math.sin(a)
        perp = np.abs(-dx * math.sin(a) + dy * math.cos(a))
        img[(t > 0) & (t < L) & (perp < 0.9)] = C(0.78, 0.62, 0.27) if L > 8 else C(0.1, 0.1, 0.1)
    img[r < 1.5] = C(0.1, 0.1, 0.1)
    img[np.abs(r - 15.5) < 0.8] = C(0.78, 0.62, 0.27)
    return img


def paint_hwin(rng, w=32, h=48):
    frame = C(0.80, 0.78, 0.72)
    img = np.ones((h, w, 3)) * frame
    glass = C(0.07, 0.08, 0.10)
    yy, xx = np.mgrid[0:h, 0:w]
    g = (xx >= 2) & (xx < w - 2) & (yy >= 4) & (yy < h - 2)
    img[g] = glass
    refl = g & ((xx - yy) % 13 < 3) & (yy > h * 0.5)
    img[refl] = C(0.22, 0.25, 0.28)
    img[(yy >= h // 2) & (yy < h // 2 + 2)] = frame
    img[g & (xx == w // 2)] = frame
    for y in (4 + (h // 2 - 4) // 2 * 1, h // 2 + 2 + (h // 2 - 4) // 2):
        img[y, 2:w - 2] = frame
    img[0:4, :] = C(0.62, 0.60, 0.55)
    return img


def paint_atlas(rng):
    A = np.ones((AT, AT, 3)) * C(0.5, 0.48, 0.44)

    def put(name, img):
        x0, y0, w, h, _ = CELL[name]
        A[y0:y0 + h, x0:x0 + w] = np.clip(img, 0, 1)

    put("goth4", paint_goth(rng, 64, 128, 4))
    put("goth2", paint_goth(rng, 32, 96, 2))
    put("round", paint_round_win(rng, 32, 80))
    put("door_r", paint_door(rng, 64, 96, "round"))
    put("door_g", paint_door(rng, 64, 96, "pointed"))
    put("louv_p", paint_louvre(rng, 32, 64, "pointed"))
    put("louv_r", paint_louvre(rng, 32, 64, "round"))
    put("niche", paint_niche(rng, 32, 64))
    put("blind", paint_blind(rng, 32, 96))
    put("ihs", paint_ihs(rng, 64))
    put("rose", paint_rose(rng, 64))
    put("clock", paint_clock(rng, 32))
    put("hwin", paint_hwin(rng, 32, 48))
    for name, col in (("gilt", C(0.78, 0.62, 0.28)), ("iron", C(0.09, 0.09, 0.10)), ("dark", C(0.03, 0.03, 0.035)),
                      ("lead", C(0.40, 0.43, 0.45))):
        x0, y0, w, h, _ = CELL[name]
        A[y0:y0 + h, x0:x0 + w] = col
    return A


def make_materials():
    rng = np.random.default_rng(1621)
    paint = {
        "church_stone": lambda: paint_ashlar(rng, 128, C(0.73, 0.68, 0.57), C(0.56, 0.52, 0.45), 16, 26, 50),
        "church_greystone": lambda: paint_ashlar(rng, 128, C(0.62, 0.61, 0.58), C(0.45, 0.45, 0.43), 16, 26, 50, streaks=0.1),
        "church_brick": lambda: paint_brick(rng),
        "church_slate": lambda: paint_slate(rng),
        "church_lead": lambda: paint_lead(rng),
        "church_atlas": lambda: paint_atlas(rng),
        "park_stone": lambda: paint_ashlar(rng, 64, C(0.42, 0.43, 0.45), C(0.26, 0.27, 0.28), 16, 18, 34),
        "park_water": lambda: paint_water(rng),
        "park_iron": lambda: paint_iron(rng),
        "park_wood": lambda: paint_wood(rng),
        "park_lamp_glow": lambda: paint_glow(rng),
    }
    for name in MATS:
        arr = np.clip(paint[name](), 0, 1)
        h, w, _ = arr.shape
        img = bpy.data.images.new(name + "_tex", w, h, alpha=False)
        rgba = np.ones((h, w, 4), dtype=np.float32)
        rgba[..., :3] = arr
        img.pixels.foreach_set(rgba.ravel())
        img.pack()
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0
        if name.endswith("_glow"):
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        m.use_backface_culling = name != "park_iron"


# ------------------------------------------------------------------ geometry store


def planar(pts, n, mat):
    tu, tv = TILE[mat]
    h = math.hypot(n.x, n.z)
    if h < 0.05:
        return [(p.x / tu, p.z / tv) for p in pts]
    hd = Vector((n.z, 0.0, -n.x)) / h
    w = n.cross(hd)
    return [(p.dot(hd) / tu, p.dot(w) / tv) for p in pts]


class Geo:
    """Faces in game coordinates, grouped into objects."""

    def __init__(self):
        self.groups = {}
        self.grp = None

    def face(self, pts, mat, out=None, uvs=None, shade=None, floor=0.0, k=1.0, cell=None):
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        if n.length < 1e-7:
            return
        if out is not None and n.dot(Vector(out)) < 0:
            pts.reverse()
            n = -n
            if uvs:
                uvs = list(reversed(uvs))
        n.normalize()
        if uvs is None:
            if mat == ATLAS:
                uvs = [cell_uv(cell or "dark", 0.5, 0.5)] * len(pts)
            else:
                uvs = planar(pts, n, mat)
        if shade is None:
            cols = [amb(p, floor) * k for p in pts]
        else:
            cols = [shade * k * tint(p.x, p.z) for p in pts]
        self.groups.setdefault(self.grp, []).append((pts, uvs, cols, mat))

    def to_objects(self):
        objs = {}
        for name, faces in self.groups.items():
            used = sorted({f[3] for f in faces})
            idx = {m: i for i, m in enumerate(used)}
            bm = bmesh.new()
            uvl = bm.loops.layers.uv.new("UVMap")
            col = bm.loops.layers.float_color.new("Col")
            for pts, uvs, cols, mat in faces:
                vs = [bm.verts.new(B(p)) for p in pts]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = idx[mat]
                f.smooth = False
                for loop, uv, c in zip(f.loops, uvs, cols):
                    loop[uvl].uv = uv
                    c = min(1.0, max(0.0, c))
                    loop[col] = (c, c, c, 1.0)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for m in used:
                me.materials.append(bpy.data.materials[MATS[m]])
            try:
                me.color_attributes.active_color = me.color_attributes["Col"]
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            except (KeyError, AttributeError):
                pass
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            objs[name] = ob
        return objs


# ------------------------------------------------------------------ walls with openings


class Hole:
    def __init__(self, u0, u1, yb, yt, shape="rect", cell=None, depth=0.3, rmat=STONE, k=1.0, sill=True):
        self.u0, self.u1, self.yb, self.yt = u0, u1, yb, yt
        self.shape, self.cell, self.depth, self.rmat, self.k, self.sill = shape, cell, depth, rmat, k, sill


def Hc(uc, w, yb, yt, shape="rect", cell=None, **kw):
    return Hole(uc - w / 2, uc + w / 2, yb, yt, shape, cell, **kw)


class Wall:
    """A flat upright wall from world point A to B (x, z), looking along n; u runs from A, depth d
    goes into the wall (negative: proud of it)."""

    def __init__(self, g, A, B, n, y0, y1, mat, top=None, k=1.0):
        self.g = g
        self.A = Vector((A[0], A[1]))
        self.B = Vector((B[0], B[1]))
        d = self.B - self.A
        self.L = d.length
        self.t = d / self.L
        self.n = Vector((n[0], n[1])).normalized()
        self.y0, self.y1 = y0, y1
        self.mat = mat
        self.top = top
        self.k = k
        # u runs to the viewer's right when the wall is seen from outside (else pictures mirror)
        self.flip = self.t.x * self.n.y - self.t.y * self.n.x < 0

    def fu(self, u, u0, w):
        f = (u - u0) / w
        return 1.0 - f if self.flip else f

    def pt(self, u, y, d=0.0):
        q = self.A + self.t * u - self.n * d
        return (q.x, y, q.y)

    def out(self, s=1.0):
        return (self.n.x * s, 0.0, self.n.y * s)

    def inplane(self, du, dy):
        return (self.t.x * du, dy, self.t.y * du)

    def top_at(self, ua, ub):
        if not self.top:
            return self.y1, self.y1
        mu = (ua + ub) / 2
        T = self.top
        for (sa, ya), (sb, yb) in zip(T, T[1:]):
            if sa - 1e-9 <= mu <= sb + 1e-9 and sb - sa > 1e-9:
                f = lambda u: ya + (yb - ya) * (u - sa) / (sb - sa)
                return f(ua), f(ub)
        return T[-1][1], T[-1][1]

    def build(self, holes=(), bands=(), cuts=()):
        L = self.L
        us = {0.0, L}
        ymax = max(y for _, y in self.top) if self.top else self.y1
        ys = {self.y0, ymax}
        if self.top:
            us |= {u for u, _ in self.top}
            ys |= {y for _, y in self.top}
        for h in holes:
            us |= {h.u0, h.u1}
            ys |= {h.yb, h.yt}
        for c in cuts:
            us |= {c[0], c[1]}
            ys |= {c[2], c[3]}
        for b in bands:
            ys |= {b[0], b[1]}
        us = sorted(u for u in us if -1e-9 <= u <= L + 1e-9)
        ys = sorted(y for y in ys if self.y0 - 1e-9 <= y <= ymax + 1e-9)
        uu = refine(us, SEG)
        yy = refine(ys, SEG)
        for ua, ub in zip(uu, uu[1:]):
            if ub - ua < 1e-5:
                continue
            mu = (ua + ub) / 2
            ta, tb = self.top_at(ua, ub)
            for va, vb in zip(yy, yy[1:]):
                if vb - va < 1e-5 or va >= max(ta, tb) - 1e-6:
                    continue
                mv = (va + vb) / 2
                if any(h.u0 <= mu <= h.u1 and h.yb <= mv <= h.yt for h in holes):
                    continue
                if any(c[0] <= mu <= c[1] and c[2] <= mv <= c[3] for c in cuts):
                    continue
                m = self.mat
                for b in bands:
                    if b[0] <= mv <= b[1]:
                        m = b[2]
                poly = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
                if vb > min(ta, tb) + 1e-6:
                    poly = clip_half(poly, lambda p: (ta + (tb - ta) * (p[0] - ua) / (ub - ua)) - p[1])
                    if len(poly) < 3:
                        continue
                self.g.face([self.pt(u, y) for u, y in poly], m, out=self.out(), k=self.k)
        for h in holes:
            self.opening(h)
        return self

    def opening(self, h):
        w = h.u1 - h.u0
        um = (h.u0 + h.u1) / 2
        hh = head_h(h.shape, w)
        ys = h.yt - hh
        g = self.g
        if h.shape == "rect":
            outline = [(h.u0, h.yb), (h.u1, h.yb), (h.u1, h.yt), (h.u0, h.yt)]
            arc = None
        else:
            arc = arch_arc(h.u0, h.u1, ys, h.shape)
            outline = [(h.u0, h.yb), (h.u1, h.yb)] + arc
            ap = len(arc) // 2
            for sp in ([(h.u0, h.yt)] + arc[ap:], [(h.u1, h.yt)] + list(reversed(arc[:ap + 1]))):
                g.face([self.pt(u, y) for u, y in sp], self.mat, out=self.out(), k=self.k)
        cu = sum(u for u, _ in outline) / len(outline)
        cy = sum(y for _, y in outline) / len(outline)
        n = len(outline)
        for i in range(n):
            (pu, py), (qu, qy) = outline[i], outline[(i + 1) % n]
            eu, ey = qu - pu, qy - py
            if math.hypot(eu, ey) < 1e-6:
                continue
            nu, ny = -ey, eu
            mu_, my = (pu + qu) / 2, (py + qy) / 2
            if nu * (cu - mu_) + ny * (cy - my) < 0:
                nu, ny = -nu, -ny
            ln = math.hypot(nu, ny)
            nu, ny = nu / ln, ny / ln
            if ny > 0.7 and not h.sill:
                continue
            kk = 1.0 if ny > 0.7 else (0.6 if ny < -0.3 else 0.8)
            pts = [self.pt(pu, py), self.pt(qu, qy), self.pt(qu, qy, h.depth), self.pt(pu, py, h.depth)]
            g.face(pts, h.rmat, out=self.inplane(nu, ny), k=self.k * kk)
        cell = h.cell or "dark"
        part_b = "body" if h.shape != "rect" else "all"
        if ys - h.yb > 1e-4:
            body = [(h.u0, h.yb), (h.u1, h.yb), (h.u1, ys), (h.u0, ys)]
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - h.yb) / (ys - h.yb), part_b) for u, y in body]
            g.face([self.pt(u, y, h.depth) for u, y in body], ATLAS, out=self.out(), uvs=uvs, k=self.k * h.k)
        if arc:
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - ys) / hh, "head") for u, y in arc]
            g.face([self.pt(u, y, h.depth) for u, y in arc], ATLAS, out=self.out(), uvs=uvs, k=self.k * h.k)


def extrude(g, W, poly, d_front, d_back, mat, side_mat=None, back=False, k=1.0, front_uv=None, cell=None, skip_edges=()):
    """A flat shape in a wall's plane W (u, y), from depth d_back to d_front (negative = proud)."""
    side_mat = mat if side_mat is None else side_mat
    uvs = [front_uv(u, y) for u, y in poly] if front_uv else None
    g.face([W.pt(u, y, d_front) for u, y in poly], mat, out=W.out(), uvs=uvs, k=k, cell=cell)
    if back:
        g.face([W.pt(u, y, d_back) for u, y in poly], mat, out=W.out(-1), k=k * 0.8, cell=cell)
    ccw = area2(poly) > 0
    n = len(poly)
    for i in range(n):
        if i in skip_edges:
            continue
        (pu, py), (qu, qy) = poly[i], poly[(i + 1) % n]
        eu, ey = qu - pu, qy - py
        if math.hypot(eu, ey) < 1e-6:
            continue
        nu, ny = (ey, -eu) if ccw else (-ey, eu)
        g.face([W.pt(pu, py, d_back), W.pt(qu, qy, d_back), W.pt(qu, qy, d_front), W.pt(pu, py, d_front)], side_mat,
               out=W.inplane(nu, ny), k=k * (0.7 if ny < -0.5 else 0.9), cell=cell)


def disc(g, W, uc, yc, r, cell, d_front=-0.2, d_back=0.05, sides=16, side_mat=STONE, k=1.0):
    poly = [(uc + r * math.cos(2 * math.pi * i / sides), yc + r * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
    extrude(g, W, poly, d_front, d_back, ATLAS, side_mat=side_mat, k=k,
            front_uv=lambda u, y: cell_uv(cell, W.fu(u, uc - r, 2 * r), (y - yc + r) / (2 * r)))


# ------------------------------------------------------------------ solids


HEX_FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}


def solid8(g, P, mat, skip=(), **kw):
    P = [Vector(p) for p in P]
    c = sum(P, Vector()) / 8
    for key, idx in HEX_FACES.items():
        if key in skip:
            continue
        pts = [P[i] for i in idx]
        fc = sum(pts, Vector()) / 4
        g.face(pts, mat, out=fc - c, **kw)


def bar(g, a, b, w, mat, h=None, skip_ends=False, skip=(), **kw):
    """A square bar from a to b (w across, h the other way)."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    s = t.cross(Vector((0, 1, 0)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    kv = s.cross(t)
    h = w if h is None else h
    P = []
    for i in range(8):
        base = b if i & 2 else a
        P.append(base + s * (w / 2 if i & 1 else -w / 2) + kv * (h / 2 if i & 4 else -h / 2))
    solid8(g, P, mat, skip=tuple(skip) + (("-y", "+y") if skip_ends else ()), **kw)


def lathe(g, c, prof, sides, mat, rot=0.0, **kw):
    """A turned shape about the vertical through c (game x, y, z); prof = (r, dy) from the bottom up."""
    cx, cy, cz = c
    for j in range(len(prof) - 1):
        (r0, y0), (r1, y1) = prof[j], prof[j + 1]
        if r0 < 1e-6 and r1 < 1e-6:
            continue
        nr, ny = (y1 - y0), -(r1 - r0)
        ln = math.hypot(nr, ny) or 1.0
        nr, ny = nr / ln, ny / ln
        for i in range(sides):
            a0 = rot + 2 * math.pi * i / sides
            a1 = rot + 2 * math.pi * (i + 1) / sides
            am = (a0 + a1) / 2
            p = [(cx + r0 * math.cos(a0), cy + y0, cz + r0 * math.sin(a0)), (cx + r0 * math.cos(a1), cy + y0, cz + r0 * math.sin(a1)),
                 (cx + r1 * math.cos(a1), cy + y1, cz + r1 * math.sin(a1)), (cx + r1 * math.cos(a0), cy + y1, cz + r1 * math.sin(a0))]
            if r0 < 1e-6:
                p = [p[0], p[2], p[3]]
            elif r1 < 1e-6:
                p = [p[0], p[1], p[2]]
            g.face(p, mat, out=(math.cos(am) * nr, ny, math.sin(am) * nr), **kw)


def pyramid(g, base, apex, mat, **kw):
    base = [Vector(p) for p in base]
    apex = Vector(apex)
    c = sum(base, Vector()) / len(base)
    inner = c + (apex - c) * 0.25
    for i in range(len(base)):
        tri = [base[i], base[(i + 1) % len(base)], apex]
        fc = sum(tri, Vector()) / 3
        g.face(tri, mat, out=fc - inner, **kw)


def cross(g, x, y, z, h=1.8, mat=ATLAS, cell="iron"):
    bar(g, (x, y, z), (x, y + h, z), 0.12, mat, cell=cell, shade=0.9)
    bar(g, (x - 0.45 * h / 1.8, y + h * 0.68, z), (x + 0.45 * h / 1.8, y + h * 0.68, z), 0.26, mat, h=0.1, cell=cell, shade=0.9)


def offsets(P, closed, side=1):
    """Mitred unit offsets at each vertex of a polyline/polygon (right of travel * side)."""
    n = len(P)
    ne = n if closed else n - 1
    N = []
    for i in range(ne):
        d = (P[(i + 1) % n] - P[i]).normalized()
        N.append(Vector((d.y, -d.x)) * side)
    off = []
    for j in range(n):
        if closed:
            n1, n2 = N[j - 1], N[j]
        elif j == 0:
            n1 = n2 = N[0]
        elif j == n - 1:
            n1 = n2 = N[-1]
        else:
            n1, n2 = N[j - 1], N[j]
        off.append((n1 + n2) / (1 + n1.dot(n2)))
    return N, off


def ring_band(g, pts, y0, y1, proj, mat, closed=True, side=None, inset=0.0, k=1.0, caps=(True, True), bottom=True):
    """A band (a cornice, a plinth) round a polygon or along a polyline (world x, z), `proj` proud.
    For a polyline `side` = +1 when the outside is on the right of travel."""
    P = [Vector((p[0], p[1])) for p in pts]
    if closed:
        side = 1 if area2([(p.x, p.y) for p in P]) > 0 else -1
    N, off = offsets(P, closed, side)
    n = len(P)
    O = [P[j] + off[j] * proj for j in range(n)]
    I = [P[j] - off[j] * inset for j in range(n)]
    ne = n if closed else n - 1
    for i in range(ne):
        j, j2 = i, (i + 1) % n
        nv = (N[i].x, 0.0, N[i].y)
        g.face([(O[j].x, y0, O[j].y), (O[j2].x, y0, O[j2].y), (O[j2].x, y1, O[j2].y), (O[j].x, y1, O[j].y)], mat, out=nv, k=k)
        g.face([(I[j].x, y1, I[j].y), (I[j2].x, y1, I[j2].y), (O[j2].x, y1, O[j2].y), (O[j].x, y1, O[j].y)], mat, out=(0, 1, 0), k=k)
        if bottom:
            g.face([(I[j].x, y0, I[j].y), (I[j2].x, y0, I[j2].y), (O[j2].x, y0, O[j2].y), (O[j].x, y0, O[j].y)], mat, out=(0, -1, 0),
                   k=k * 0.7)
    if not closed:
        for j, sgn, on in ((0, -1, caps[0]), (n - 1, 1, caps[1])):
            if not on:
                continue
            d = (P[1] - P[0]).normalized() if j == 0 else (P[-1] - P[-2]).normalized()
            g.face([(I[j].x, y0, I[j].y), (O[j].x, y0, O[j].y), (O[j].x, y1, O[j].y), (I[j].x, y1, I[j].y)], mat,
                   out=(d.x * sgn, 0, d.y * sgn), k=k)


def kerb(g, pts, hw, y0, y1, mat, caps=(True, True), top=True, k=1.0, closed=False):
    """A free-standing low wall along a polyline (both sides, mitred corners)."""
    P = [Vector((p[0], p[1])) for p in pts]
    N, off = offsets(P, closed, 1)
    n = len(P)
    Lf = [P[j] + off[j] * hw for j in range(n)]
    Rt = [P[j] - off[j] * hw for j in range(n)]
    ne = n if closed else n - 1
    for i in range(ne):
        j, j2 = i, (i + 1) % n
        for S, sg in ((Lf, 1), (Rt, -1)):
            g.face([(S[j].x, y0, S[j].y), (S[j2].x, y0, S[j2].y), (S[j2].x, y1, S[j2].y), (S[j].x, y1, S[j].y)], mat,
                   out=(N[i].x * sg, 0, N[i].y * sg), k=k)
        if top:
            g.face([(Lf[j].x, y1, Lf[j].y), (Lf[j2].x, y1, Lf[j2].y), (Rt[j2].x, y1, Rt[j2].y), (Rt[j].x, y1, Rt[j].y)], mat,
                   out=(0, 1, 0), k=k)
    if not closed:
        for j, sgn, on in ((0, -1, caps[0]), (n - 1, 1, caps[1])):
            if not on:
                continue
            d = (P[1] - P[0]).normalized() if j == 0 else (P[-1] - P[-2]).normalized()
            g.face([(Lf[j].x, y0, Lf[j].y), (Rt[j].x, y0, Rt[j].y), (Rt[j].x, y1, Rt[j].y), (Lf[j].x, y1, Lf[j].y)], mat,
                   out=(d.x * sgn, 0, d.y * sgn), k=k)


def garden_wall(g, pts, h, mat, coping=None, hw=0.2):
    """A wall between two masses (its ends hidden in them) with a coping stone on top."""
    kerb(g, pts, hw, FOOT, h - 0.2, mat, caps=(False, False), top=False)
    kerb(g, pts, hw + 0.07, h - 0.25, h, coping if coping is not None else mat, caps=(False, False))


def ring_between(g, c, outer, inner, y, mat, k=1.0):
    """A flat ring at height y between two convex polygons round the point c (x, z)."""
    def ang(p):
        return math.atan2(p[1] - c[1], p[0] - c[0])

    def srt(poly):
        return sorted(poly, key=ang)

    outer, inner = srt(outer), srt(inner)

    def hit(th):
        d = (math.cos(th), math.sin(th))
        best = None
        for i in range(len(outer)):
            a, b = outer[i], outer[(i + 1) % len(outer)]
            ex, ez = b[0] - a[0], b[1] - a[1]
            den = d[0] * ez - d[1] * ex
            if abs(den) < 1e-12:
                continue
            wx, wz = a[0] - c[0], a[1] - c[1]
            t = (wx * ez - wz * ex) / den
            u = (wx * d[1] - wz * d[0]) / den
            if t > 0 and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best):
                best = t
        return (c[0] + d[0] * best, c[1] + d[1] * best)

    ni = len(inner)
    for i in range(ni):
        p, q = inner[i], inner[(i + 1) % ni]
        ta, tb = ang(p), ang(q)
        span = (tb - ta) % (2 * math.pi)
        mids = [o for o in outer if 1e-6 < (ang(o) - ta) % (2 * math.pi) < span - 1e-6]
        mids.sort(key=lambda o: (ang(o) - ta) % (2 * math.pi))
        poly = [hit(ta)] + mids + [hit(tb), q, p]
        g.face([(x, y, z) for x, z in poly], mat, out=(0, 1, 0), k=k)


# ------------------------------------------------------------------ local frames


class Frame:
    """Local (a, s) -> world (x, z): origin o, unit vectors ua and us."""

    def __init__(self, o, ua, us):
        self.o = (float(o[0]), float(o[1]))
        self.ua = (float(ua[0]), float(ua[1]))
        self.us = (float(us[0]), float(us[1]))

    def P(self, a, s):
        return (self.o[0] + self.ua[0] * a + self.us[0] * s, self.o[1] + self.ua[1] * a + self.us[1] * s)

    def p(self, a, s, y):
        x, z = self.P(a, s)
        return (x, y, z)

    def V(self, da, ds):
        return (self.ua[0] * da + self.us[0] * ds, self.ua[1] * da + self.us[1] * ds)

    def v(self, da, ds, dy=0.0):
        x, z = self.V(da, ds)
        return (x, dy, z)

    def rot(self):
        return Frame(self.o, self.us, self.ua)


def wall(g, F, A, Bp, out, y0, y1, mat, top=None, holes=(), bands=(), cuts=(), k=1.0):
    """A wall in a frame from local (a, s) A to Bp; u runs from A; out = local (da, ds)."""
    return Wall(g, F.P(*A), F.P(*Bp), F.V(*out), y0, y1, mat, top, k).build(holes, bands, cuts)


def plane(g, F, A, Bp, out, mat=STONE):
    return Wall(g, F.P(*A), F.P(*Bp), F.V(*out), 0, 0, mat)


def box(g, F, a0, a1, s0, s1, y0, y1, mat, skip=(), k=1.0, top_mat=None, bands=()):
    if "-a" not in skip:
        wall(g, F, (a0, s0), (a0, s1), (-1, 0), y0, y1, mat, k=k, bands=bands)
    if "+a" not in skip:
        wall(g, F, (a1, s0), (a1, s1), (1, 0), y0, y1, mat, k=k, bands=bands)
    if "-s" not in skip:
        wall(g, F, (a0, s0), (a1, s0), (0, -1), y0, y1, mat, k=k, bands=bands)
    if "+s" not in skip:
        wall(g, F, (a0, s1), (a1, s1), (0, 1), y0, y1, mat, k=k, bands=bands)
    if "+y" not in skip:
        g.face([F.p(a0, s0, y1), F.p(a1, s0, y1), F.p(a1, s1, y1), F.p(a0, s1, y1)], top_mat if top_mat is not None else mat,
               out=(0, 1, 0), k=k)
    if "-y" not in skip:
        g.face([F.p(a0, s0, y0), F.p(a1, s0, y0), F.p(a1, s1, y0), F.p(a0, s1, y0)], mat, out=(0, -1, 0), k=k * 0.7)


def gable_roof(g, F, a0, a1, s0, s1, ye, yr, mat=SLATE, t=0.22, oe=(0.45, 0.45), og=(0.35, 0.35), caps=(True, True, True, True),
               shade=0.92):
    """A pitched roof, ridge along a. Its underside passes through the wall tops (s0, ye), (s1, ye).
    caps: fascia at the s0 eave, at the s1 eave, the verge end at a0, at a1."""
    smid = (s0 + s1) / 2
    half = (s1 - s0) / 2
    m = (yr - ye) / half
    A0, A1 = a0 - og[0], a1 + og[1]
    na = max(1, math.ceil((A1 - A0) / SEG - 1e-9))
    E = [(s0 - oe[0], ye - oe[0] * m, -1), (s1 + oe[1], ye - oe[1] * m, 1)]
    for side, (es, ey, sg) in enumerate(E):
        ns = max(1, math.ceil(math.hypot(smid - es, yr - ey) / SEG - 1e-9))
        for i in range(na):
            aa, ab = A0 + (A1 - A0) * i / na, A0 + (A1 - A0) * (i + 1) / na
            for j in range(ns):
                f0, f1 = j / ns, (j + 1) / ns
                sa, sb = es + (smid - es) * f0, es + (smid - es) * f1
                ya, yb = ey + (yr - ey) * f0, ey + (yr - ey) * f1
                g.face([F.p(aa, sa, ya + t), F.p(ab, sa, ya + t), F.p(ab, sb, yb + t), F.p(aa, sb, yb + t)], mat,
                       out=F.v(0, sg * m, 1.0), shade=shade)
                g.face([F.p(aa, sa, ya), F.p(ab, sa, ya), F.p(ab, sb, yb), F.p(aa, sb, yb)], mat, out=F.v(0, -sg * m, -1.0),
                       shade=shade * 0.45)
            if caps[side]:
                g.face([F.p(aa, es, ey), F.p(ab, es, ey), F.p(ab, es, ey + t), F.p(aa, es, ey + t)], mat, out=F.v(0, sg, 0),
                       shade=shade * 0.7)
    (e0s, e0y, _), (e1s, e1y, _) = E
    for A, sg, on in ((A0, -1, caps[2]), (A1, 1, caps[3])):
        if on:
            g.face([F.p(A, e0s, e0y), F.p(A, e0s, e0y + t), F.p(A, smid, yr + t), F.p(A, e1s, e1y + t), F.p(A, e1s, e1y),
                    F.p(A, smid, yr)], mat, out=F.v(sg, 0), shade=shade * 0.7)


def lean_to(g, F, a0, a1, s_lo, s_hi, y_lo, y_hi, mat=SLATE, t=0.2, oe=0.4, og=(0.3, 0.3), caps=(True, True, True), shade=0.92):
    """A roof in one slope from the low eave at s_lo up to a wall at s_hi. caps: eave, end a0, end a1."""
    dirs = 1.0 if s_hi > s_lo else -1.0
    m = (y_hi - y_lo) / abs(s_hi - s_lo)
    es, ey = s_lo - dirs * oe, y_lo - oe * m
    A0, A1 = a0 - og[0], a1 + og[1]
    na = max(1, math.ceil((A1 - A0) / SEG - 1e-9))
    ns = max(1, math.ceil(math.hypot(s_hi - es, y_hi - ey) / SEG - 1e-9))
    for i in range(na):
        aa, ab = A0 + (A1 - A0) * i / na, A0 + (A1 - A0) * (i + 1) / na
        for j in range(ns):
            f0, f1 = j / ns, (j + 1) / ns
            sa, sb = es + (s_hi - es) * f0, es + (s_hi - es) * f1
            ya, yb = ey + (y_hi - ey) * f0, ey + (y_hi - ey) * f1
            g.face([F.p(aa, sa, ya + t), F.p(ab, sa, ya + t), F.p(ab, sb, yb + t), F.p(aa, sb, yb + t)], mat,
                   out=F.v(0, -dirs * m, 1.0), shade=shade)
            g.face([F.p(aa, sa, ya), F.p(ab, sa, ya), F.p(ab, sb, yb), F.p(aa, sb, yb)], mat, out=F.v(0, dirs * m, -1.0),
                   shade=shade * 0.45)
        if caps[0]:
            g.face([F.p(aa, es, ey), F.p(ab, es, ey), F.p(ab, es, ey + t), F.p(aa, es, ey + t)], mat, out=F.v(0, -dirs, 0),
                   shade=shade * 0.7)
    for A, sg, on in ((A0, -1, caps[1]), (A1, 1, caps[2])):
        if on:
            g.face([F.p(A, es, ey), F.p(A, es, ey + t), F.p(A, s_hi, y_hi + t), F.p(A, s_hi, y_hi)], mat, out=F.v(sg, 0),
                   shade=shade * 0.7)


def apse_pts(ac, r, n=5):
    return [(ac + r * math.cos(math.radians(-90 + 180 * i / n)), r * math.sin(math.radians(-90 + 180 * i / n))) for i in range(n + 1)]


def eave_ring(ac, r, oe, n=5):
    """The apse's eave line oe out from its walls; its ends at (ac, +-(r + oe)) meet a roof along a."""
    P = [Vector(p) for p in apse_pts(ac, r, n)]
    out = []
    for j, p in enumerate(P):
        if j == 0 or j == n:
            out.append(Vector((ac, p.y + (oe if p.y > 0 else -oe))))
            continue
        rd = (p - Vector((ac, 0))).normalized()
        out.append(p + rd * oe / math.cos(math.pi / n / 2))
    return out


def apse_roof(g, F, ac, r, ye, yr, mat=SLATE, t=0.22, oe=0.45, n=5, shade=0.92):
    m = (yr - ye) / r
    E = eave_ring(ac, r, oe, n)
    ey = ye - oe * m
    apex = (ac, 0.0)
    for i in range(n):
        a, b = E[i], E[i + 1]
        mid = (a + b) / 2
        rd = (mid - Vector(apex)).normalized()
        g.face([F.p(a.x, a.y, ey + t), F.p(b.x, b.y, ey + t), F.p(ac, 0, yr + t)], mat, out=F.v(rd.x * m, rd.y * m, 1.0), shade=shade)
        g.face([F.p(a.x, a.y, ey), F.p(b.x, b.y, ey), F.p(ac, 0, yr)], mat, out=F.v(-rd.x * m, -rd.y * m, -1.0), shade=shade * 0.45)
        g.face([F.p(a.x, a.y, ey), F.p(b.x, b.y, ey), F.p(b.x, b.y, ey + t), F.p(a.x, a.y, ey + t)], mat, out=F.v(rd.x, rd.y, 0),
               shade=shade * 0.7)


def apse_walls(g, F, ac, r, y0, y1, mat, n=5, holes=None, bands=()):
    P = apse_pts(ac, r, n)
    for i in range(n):
        a, b = P[i], P[i + 1]
        mid = ((a[0] + b[0]) / 2 - ac, (a[1] + b[1]) / 2)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        wall(g, F, a, b, mid, y0, y1, mat, holes=holes(i, L) if holes else (), bands=bands)


def buttress(g, F, a, s, out, w, dep, y1, y2=None, mat=STONE, slope=0.9, k=1.0):
    """A buttress on a wall at local (a, s), `out` = local unit direction off the wall."""
    ox, oz = F.V(*out)
    tx, tz = -oz, ox
    bx, bz = F.P(a, s)

    def P(t, d, y):
        return (bx + tx * t + ox * d, y, bz + tz * t + oz * d)

    def stage(ww, dd, ya, yb):
        ys = yb + (dd + 0.1) * slope
        h = ww / 2
        g.face([P(-h, dd, ya), P(h, dd, ya), P(h, dd, yb), P(-h, dd, yb)], mat, out=(ox, 0, oz), k=k)
        for sg in (-1, 1):
            g.face([P(sg * h, -0.1, ya), P(sg * h, dd, ya), P(sg * h, dd, yb), P(sg * h, -0.1, ys)], mat, out=(tx * sg, 0, tz * sg), k=k)
        g.face([P(-h, dd, yb), P(h, dd, yb), P(h, -0.1, ys), P(-h, -0.1, ys)], mat, out=(ox, slope, oz), k=k)

    stage(w, dep, FOOT, y1)
    if y2 is not None:
        stage(w - 0.12, dep * 0.55, y1 - 0.05, y2)


def poly_walls(g, c, R, n, rot, y0, y1, mat, holes=None, bands=()):
    """A regular polygon of walls round c (x, z), circumradius R; face i looks along rot + (i + 0.5) * 360 / n."""
    V = [(c[0] + R * math.cos(rot + 2 * math.pi * i / n), c[1] + R * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        a, b = V[i], V[(i + 1) % n]
        am = rot + 2 * math.pi * (i + 0.5) / n
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        Wall(g, a, b, (math.cos(am), math.sin(am)), y0, y1, mat).build(holes(i, L) if holes else (), bands)
    return V


def rect_pts(F, a0, a1, s0, s1):
    return [F.P(a0, s0), F.P(a1, s0), F.P(a1, s1), F.P(a0, s1)]


# ------------------------------------------------------------------ Sint-Carolus Borromeus


def frame_front_open(fr):
    """The front on the open side (the Carolus): a from the front inward, s along the long axis."""
    op = fr["open"]
    n, ax, c = fr["n"], fr["ax"], fr["c"]
    o = (c[0] + op * n[0] * fr["W"] / 2, c[1] + op * n[1] * fr["W"] / 2)
    return Frame(o, (-op * n[0], -op * n[1]), (ax[0], ax[1])), fr["W"], fr["L"] / 2


def frame_west_end(fr):
    """The west front at the +ax end (design.py turned the OSM outlines so): a runs east, s north."""
    n, ax, c = fr["n"], fr["ax"], fr["c"]
    o = (c[0] + ax[0] * fr["L"] / 2, c[1] + ax[1] * fr["L"] / 2)
    return Frame(o, (-ax[0], -ax[1]), (-n[0], -n[1])), fr["L"], fr["W"] / 2


def carolus(g, fr):
    g.grp = "church_carolus"
    F, D, S = frame_front_open(fr)
    FA = 0.9  # the front's face
    FB = FA + 0.8  # its back
    NV, AW = 5.5, 12.0  # nave half width, aisle outer wall
    E1, E2 = 10.5, 19.6  # tops of the two lower storeys' entablatures
    P3, PK = 26.6, 30.0  # the third storey's cornice top, the pediment's apex
    NE, RID = 25.6, 29.6
    AE, AH = 17.0, 19.2
    AC = D - 5.8  # the apse's centre
    TA0 = AC - 0.7  # the tower's front
    HE, HR = 13.0, 17.8  # the Jesuit house: eave, ridge
    CE, CR = 11.0, 15.4  # the Lady Chapel
    SE = 9.8  # the sacristy's high side
    ST = STONE
    # ---- the front: a slab with three storeys, the top one over the nave only
    u = lambda s: s + AW  # noqa: E731
    top = [(0, E2), (u(-6.2), E2), (u(-6.2), P3), (u(0), PK), (u(6.2), P3), (u(6.2), E2), (u(AW), E2)]
    holes = [Hc(u(0), 3.4, 0.15, 6.6, "round", "door_r", depth=0.55),
             Hc(u(-4.2), 1.2, 1.9, 5.6, "round", "niche", depth=0.35),
             Hc(u(4.2), 1.2, 1.9, 5.6, "round", "niche", depth=0.35),
             Hc(u(0), 3.6, 11.4, 17.8, "round", "round", depth=0.45),
             Hc(u(-4.2), 1.2, 12.3, 16.4, "round", "niche", depth=0.35),
             Hc(u(4.2), 1.2, 12.3, 16.4, "round", "niche", depth=0.35),
             Hc(u(-4.3), 1.0, 20.7, 24.2, "round", "niche", depth=0.3),
             Hc(u(4.3), 1.0, 20.7, 24.2, "round", "niche", depth=0.3)]
    for sg in (-1, 1):
        holes += [Hc(u(sg * 8.4), 2.2, 0.15, 4.6, "round", "door_r", depth=0.45),
                  Hc(u(sg * 8.4), 1.3, 5.7, 8.9, "round", "niche", depth=0.35),
                  Hc(u(sg * 8.4), 1.8, 11.8, 17.0, "round", "round", depth=0.4)]
    Wf = wall(g, F, (FA, -AW), (FA, AW), (-1, 0), FOOT, E2, ST, top=top, holes=holes)
    wall(g, F, (FB, -AW), (FB, AW), (1, 0), 15.5, E2, ST, top=top)
    for (ua, ya), (ub, yb) in zip(top, top[1:]):
        sa, sb = ua - AW, ub - AW
        if abs(ua - ub) < 1e-6:
            sg = -1 if ya < yb else 1
            if sa > 0:
                sg = -sg
            g.face([F.p(FA, sa, ya), F.p(FB, sa, ya), F.p(FB, sa, yb), F.p(FA, sa, yb)], ST, out=F.v(0, -1 if sa < 0 else 1))
        else:
            g.face([F.p(FA, sa, ya), F.p(FA, sb, yb), F.p(FB, sb, yb), F.p(FB, sa, ya)], ST, out=(0, 1, 0))
    for sg in (-1, 1):  # the front's ends above the houses' roofs
        wall(g, F, (FA, sg * AW), (FB, sg * AW), (0, sg), HE - 1.0 if sg < 0 else CE - 1.0, E2, ST)
    # entablatures, plinth
    front = lambda s0, s1: [F.P(FA, s0), F.P(FA, s1)]  # noqa: E731
    # the outside of the front lies to the right of travel from -s to +s? find it
    d = Vector(F.V(0, 1))
    right = Vector((d.y, -d.x))
    sd = 1 if right.dot(Vector(F.V(-1, 0))) > 0 else -1
    ring_band(g, front(-AW, AW), FOOT, 0.9, 0.14, ST, closed=False, side=sd, caps=(False, False), bottom=False)
    ring_band(g, front(-AW, AW), 9.7, E1, 0.8, ST, closed=False, side=sd, caps=(False, False))
    ring_band(g, front(-AW, AW), 18.8, E2, 0.6, ST, closed=False, side=sd)
    ring_band(g, front(-6.8, 6.8), 26.0, P3, 0.45, ST, closed=False, side=sd)
    # the pediment's raking cornice
    chev = [(u(-6.8), 26.3), (u(0), PK + 0.42), (u(6.8), 26.3), (u(6.15), 26.3), (u(0), PK - 0.05), (u(-6.15), 26.3)]
    extrude(g, Wf, chev, -0.3, 0.05, ST, back=True)
    # columns below, pilasters above
    for s in (-11.2, -5.6, -2.8, 2.8, 5.6, 11.2):
        box(g, F, FA - 0.85, FA + 0.05, s - 0.55, s + 0.55, FOOT, 1.5, ST, skip=("+a", "-y"))
        prof = [(0.5, 0.0), (0.5, 0.18), (0.42, 0.34), (0.4, 0.5), (0.36, 7.4), (0.44, 7.55), (0.52, 7.8), (0.52, 8.3)]
        x, y, z = F.p(FA - 0.42, s, 1.5)
        lathe(g, (x, y, z), prof, 8, ST, rot=0.0)
        box(g, F, FA - 0.72, FA + 0.05, s - 0.5, s + 0.5, E1 - 0.05, E1 + 0.05 + 0.02, ST, skip=("+a", "-y", "+y"))
        box(g, F, FA - 0.3, FA + 0.05, s - 0.42, s + 0.42, E1 - 0.02, 18.85, ST, skip=("+a", "-y", "+y"))
    for s in (-5.72, -2.6, 2.6, 5.72):
        box(g, F, FA - 0.25, FA + 0.05, s - 0.35, s + 0.35, E2 - 0.02, 26.05, ST, skip=("+a", "-y", "+y"))
    # the IHS medallion, the volutes, urns, the cross
    disc(g, Wf, u(0), 22.9, 1.75, "ihs", d_front=-0.28, d_back=0.05, sides=16)
    for sg in (-1, 1):
        pts = [(6.15, E2 - 0.05), (11.0, E2 - 0.05)]
        for i in range(7):
            tt = i / 6
            pts.append((11.0 - 4.85 * tt, 20.5 + 5.3 * tt ** 2.2))
        poly = [(u(sg * s_), y) for s_, y in pts]
        extrude(g, Wf, poly, -0.38, 0.05, ST, back=True)
        disc(g, Wf, u(sg * 10.35), 20.4, 0.72, "rose", d_front=-0.55, d_back=-0.35, sides=10)
        x, y, z = F.p(FA - 0.1, sg * 11.3, E2 - 0.02)
        lathe(g, (x, y, z), [(0.42, 0.0), (0.42, 0.7), (0.3, 0.78), (0.2, 0.9), (0.42, 1.3), (0.3, 1.65), (0.1, 1.8), (0.18, 2.0),
                             (0.0, 2.6)], 8, ST, rot=math.pi / 8)
    x, y, z = F.p(FA + 0.4, 0, PK - 0.1)
    lathe(g, (x, y, z), [(0.28, 0.0), (0.28, 0.5), (0.2, 0.6), (0.2, 0.75)], 8, ST, rot=math.pi / 8)
    cross(g, x, y + 0.7, z, 1.9)
    # ---- nave, aisles, apse
    clere = lambda L_: [Hc(a - FB, 1.8, 20.3, 24.5, "round", "round", depth=0.4) for a in (5.2, 10.4, 15.6, 20.8, 26.0) if a < FB + L_ - 1.2]  # noqa: E731
    wall(g, F, (FB, -NV), (AC, -NV), (0, -1), 18.0, NE, ST, holes=clere(AC - FB))
    wall(g, F, (FB, NV), (TA0, NV), (0, 1), 18.0, NE, ST, holes=clere(TA0 - FB))
    gable_roof(g, F, FB, AC, -NV, NV, NE, RID, oe=(0.4, 0.4), og=(0, 0), caps=(True, True, False, False))
    gal = lambda L_: [Hc(a - FB, 1.5, 13.8, 16.4, "round", "round", depth=0.35) for a in (5.2, 10.4, 15.6, 20.8, 26.0) if a < FB + L_ - 1.0]  # noqa: E731
    wall(g, F, (FB, -AW), (AC, -AW), (0, -1), FOOT, AE, ST, holes=gal(AC - FB))
    wall(g, F, (FB, AW), (TA0, AW), (0, 1), FOOT, AE, ST, holes=gal(TA0 - FB))
    lean_to(g, F, FB, AC, -AW, -NV, AE, AH, oe=0.4, og=(0, 0.3), caps=(True, False, True))
    lean_to(g, F, FB, TA0, AW, NV, AE, AH, oe=0.4, og=(0, 0), caps=(True, False, False))
    wall(g, F, (AC, -AW), (AC, -NV), (1, 0), FOOT, AE, ST, top=[(0, AE), (AW - NV, AH)])
    apse_walls(g, F, AC, NV, FOOT, NE, ST, holes=lambda i, L: [Hc(L / 2, 1.5, 12.2, 20.5, "round", "round", depth=0.4)] if 1 <= i <= 3 else [])
    apse_roof(g, F, AC, NV, NE, RID, oe=0.4)
    # ---- the tower behind the choir
    a0, a1, s0, s1 = TA0, D - M, NV, AW
    T1 = 29.9
    tc = F.P((a0 + a1) / 2, (s0 + s1) / 2)
    wall(g, F, (a0, s0), (a0, s1), (-1, 0), FOOT, T1, ST, holes=[Hc((s1 - s0) / 2, 1.0, 21.0, 23.6, "round", "round")])
    wall(g, F, (a1, s0), (a1, s1), (1, 0), FOOT, T1, ST,
         holes=[Hc((s1 - s0) / 2, 1.0, h0, h0 + 2.4, "round", "round") for h0 in (7.0, 14.0, 21.0)])
    wall(g, F, (a0, s0), (a1, s0), (0, -1), FOOT, T1, ST, holes=[Hc((a1 - a0) / 2, 1.0, 27.0, 29.0, "round", "round")])
    wall(g, F, (a0, s1), (a1, s1), (0, 1), FOOT, T1, ST,
         holes=[Hc((a1 - a0) / 2, 1.0, h0, h0 + 2.4, "round", "round") for h0 in (14.0, 21.0)])
    Wt = plane(g, F, (a0, s0), (a0, s1), (-1, 0))
    disc(g, Wt, (s1 - s0) / 2, 26.6, 1.1, "clock", d_front=-0.12, d_back=0.05, sides=12)
    Wt = plane(g, F, (a1, s1), (a1, s0), (1, 0))
    disc(g, Wt, (s1 - s0) / 2, 26.6, 1.1, "clock", d_front=-0.12, d_back=0.05, sides=12)
    sq = rect_pts(F, a0, a1, s0, s1)
    ring_band(g, sq, T1 - 0.5, T1, 0.3, ST)
    q = 0.4
    sq2 = rect_pts(F, a0 + q, a1 - q, s0 + q, s1 - q)
    ring_between(g, tc, sq, sq2, T1, ST)
    T2 = 36.0
    lw = (s1 - s0) - 2 * q
    for (A, Bq, out) in (((a0 + q, s0 + q), (a0 + q, s1 - q), (-1, 0)), ((a1 - q, s1 - q), (a1 - q, s0 + q), (1, 0)),
                         ((a1 - q, s0 + q), (a0 + q, s0 + q), (0, -1)), ((a0 + q, s1 - q), (a1 - q, s1 - q), (0, 1))):
        L_ = math.hypot(*(Vector(F.P(*Bq)) - Vector(F.P(*A))))
        wall(g, F, A, Bq, out, T1 - 0.05, T2, ST, holes=[Hc(L_ / 2, 1.5, T1 + 1.1, T1 + 5.1, "round", "louv_r", depth=0.5)])
    ring_band(g, sq2, T2 - 0.45, T2, 0.3, ST)
    R8 = 2.55
    rot8 = math.pi / 8
    oct_ = [(tc[0] + R8 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + R8 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)]
    ring_between(g, tc, sq2, oct_, T2, LEAD)
    T3 = 40.6
    poly_walls(g, tc, R8, 8, rot8, T2 - 0.05, T3, ST,
               holes=lambda i, L: [Hc(L / 2, 0.95, T2 + 0.8, T2 + 3.7, "round", "louv_r", depth=0.35)] if i % 2 == 0 else [])
    ring_band(g, oct_, T3 - 0.4, T3, 0.25, ST)
    dome = [(R8 * 0.97, 0.0), (2.35, 0.55), (2.05, 1.25), (1.5, 1.95), (0.85, 2.45), (0.62, 2.6), (0.62, 4.1), (0.82, 4.15),
            (0.82, 4.3), (0.62, 4.35), (0.35, 5.0), (0.12, 5.35), (0.2, 5.55), (0.0, 5.8)]
    lathe(g, (tc[0], T3 - 0.05, tc[1]), dome, 8, LEAD, rot=rot8)
    cross(g, tc[0], T3 + 5.7, tc[1], 1.6)
    # ---- the Jesuit house (left) and the Lady Chapel (right)
    hs0, hs1 = -S + M, -AW
    hw_ = hs1 - hs0
    hu = lambda s: s - hs0  # noqa: E731
    wins = []
    for yb in (1.4, 5.4, 9.4):
        for uc in (hw_ * 0.2, hw_ * 0.5, hw_ * 0.8):
            if yb < 2 and abs(uc - hw_ / 2) < 1:
                continue
            wins.append(Hc(uc, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22))
    hb_ = [(FOOT, 0.8, ST), (4.5, 4.75, ST), (8.5, 8.75, ST), (HE - 0.35, HE, ST)]
    wall(g, F, (M, hs1), (M, hs0), (-1, 0), FOOT, HE, BRICK, top=[(0, HE), (hw_ / 2, HR), (hw_, HE)],
         holes=[Hc(hw_ - uc_.u0 - 0.55, 1.1, uc_.yb, uc_.yt, "rect", "hwin", depth=0.22) for uc_ in wins]
         + [Hc(hw_ / 2, 1.7, 0.15, 3.4, "round", "door_r", depth=0.35), Hc(hw_ / 2, 0.9, HE + 0.6, HE + 2.0, "rect", "hwin", depth=0.2)],
         bands=hb_)
    wall(g, F, (0.0 + M, hs1), (FA, hs1), (0, 1), FOOT, HE, BRICK, bands=hb_)
    sw = [Hc(a, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22) for yb in (1.4, 5.4, 9.4) for a in np.arange(2.2, D - 1.5, 3.3)
          if not (yb < 2 and abs(a - D / 2) < 1.8)]
    wall(g, F, (M, hs0), (D - M, hs0), (0, -1), FOOT, HE, BRICK, holes=sw + [Hc(D / 2 - M, 1.5, 0.15, 3.2, "round", "door_r", depth=0.3)],
         bands=hb_)
    wall(g, F, (D - M, hs0), (D - M, hs1), (1, 0), FOOT, HE, BRICK, top=[(0, HE), (hw_ / 2, HR), (hw_, HE)],
         holes=[Hc(uc, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22) for yb in (5.4, 9.4) for uc in (hw_ * 0.3, hw_ * 0.7)],
         bands=hb_)
    wall(g, F, (AC, hs1), (D - M, hs1), (0, 1), FOOT, HE, BRICK, bands=hb_,
         holes=[Hc((D - M - AC) / 2, 1.0, 10.6, 12.2, "rect", "hwin", depth=0.2)])
    gable_roof(g, F, M, D - M, hs0, hs1, HE, HR, oe=(0.4, 0.0), og=(0.3, 0.3), caps=(True, False, True, True))
    for a in (D * 0.3, D * 0.72):
        box(g, F, a - 0.5, a + 0.5, hs0 + hw_ * 0.5 - 0.6, hs0 + hw_ * 0.5 + 0.6, HR - 1.0, HR + 1.3, BRICK, skip=("-y",), top_mat=ST)
    cs0, cs1 = AW, S - M - 0.3
    cw_ = cs1 - cs0
    wall(g, F, (M, cs0), (M, cs1), (-1, 0), FOOT, CE, ST, top=[(0, CE), (cw_ / 2, CR), (cw_, CE)],
         holes=[Hc(cw_ / 2, 2.0, 0.15, 4.4, "round", "door_r", depth=0.4), Hc(cw_ / 2, 1.6, 5.6, 9.6, "round", "round", depth=0.35)])
    Wc = plane(g, F, (M, cs0), (M, cs1), (-1, 0))
    disc(g, Wc, cw_ / 2, 12.7, 0.75, "rose", d_front=-0.15, d_back=0.05, sides=12)
    wall(g, F, (M, cs0), (FA, cs0), (0, -1), FOOT, CE, ST)
    wall(g, F, (M, cs1), (D - M, cs1), (0, 1), FOOT, CE, ST,
         holes=[Hc(a - M, 1.6, 4.4, 9.2, "round", "round", depth=0.35) for a in (4.2, 9.4, 14.6, 19.8, 25.0, 30.2) if a < D - 2])
    for a in (1.6, 6.8, 12.0, 17.2, 22.4, 27.6, 32.8):
        if a < D - M - 0.5:
            box(g, F, a - 0.4, a + 0.4, cs1 - 0.05, S - M + 0.05, FOOT, CE - 0.6, ST, skip=("-s", "-y"))
    wall(g, F, (D - M, cs1), (D - M, cs0), (1, 0), FOOT, CE, ST, top=[(0, CE), (cw_ / 2, CR), (cw_, CE)])
    ring_band(g, [F.P(M, cs0), F.P(M, cs1)], CE - 0.5, CE, 0.25, ST, closed=False, side=sd, caps=(False, True))
    gable_roof(g, F, M, D - M, cs0, cs1, CE, CR, oe=(0.0, 0.4), og=(0.3, 0.3), caps=(False, True, True, True))
    # ---- the sacristy behind the left aisle
    wall(g, F, (AC, -NV), (D - M, -NV), (0, 1), FOOT, 8.0, ST,
         holes=[Hc((D - M - AC) / 2, 1.2, 3.0, 6.0, "round", "round", depth=0.3)])
    wall(g, F, (D - M, -AW), (D - M, -NV), (1, 0), FOOT, SE, ST, top=[(0, SE), (AW - NV, 8.0)])
    lean_to(g, F, AC, D - M, -NV, -AW, 8.0, SE, oe=0.35, og=(0, 0.3), caps=(True, False, True))
    # a garden wall behind the apse, from the sacristy to the tower
    garden_wall(g, [F.P(D - M - 0.2, -NV), F.P(D - M - 0.2, NV)], 3.4, ST)


# ------------------------------------------------------------------ Sint-Pauluskerk


def stpaul(g, fr):
    g.grp = "church_stpaul"
    F, D, S = frame_west_end(fr)
    BD = 0.7  # buttresses reach the rectangle's edge from here
    NV, AO, CO = 5.5, 15.0, S - BD  # nave half width, aisle outer wall, chapel outer wall
    AE, AR = 10.5, 14.5  # aisle eave, the cross gables' ridge
    NE, RID = 20.5, 27.0
    CL, CH = 6.8, 8.6  # the chapels' lean-to
    TX0, TX1 = 40.0, 51.5  # transept
    CHE = 69.5  # the apse's centre
    TW0, TW1, TS0, TS1 = TX1, TX1 + 8.0, NV, NV + 8.0  # the tower
    VE, VR = 9.0, 14.0  # the convent wings
    nb = 5
    bays = [BD + (TX0 - BD) * i / nb for i in range(nb + 1)]
    bw = bays[1] - bays[0]
    bands = [(FOOT, 0.9, STONE)]
    # ---- west front
    Ww = wall(g, F, (BD, -NV), (BD, NV), (-1, 0), FOOT, NE, BRICK, top=[(0, NE), (NV, RID), (2 * NV, NE)],
              holes=[Hc(NV, 2.6, 0.15, 5.3, "pointed", "door_g", depth=0.9), Hc(NV, 4.2, 7.6, 17.6, "pointed", "goth4", depth=0.45)],
              bands=bands + [(6.4, 6.8, STONE)])
    disc(g, Ww, NV, 21.9, 1.0, "rose", d_front=-0.12, d_back=0.05, sides=14)
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * AO))
        wall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, AE, BRICK, holes=[Hc((AO - NV) / 2, 2.0, 3.4, 8.8, "pointed", "goth2", depth=0.35)],
             bands=bands + [(6.4, 6.8, STONE)])
        s_a, s_b = sorted((sg * AO, sg * CO))
        top = [(0, CH), (CO - AO, CL)] if sg > 0 else [(0, CL), (CO - AO, CH)]
        wall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, CH, BRICK, top=top, bands=bands)
        for s_, h1, h2 in ((sg * NV, 12.0, 19.0), (sg * AO, 7.0, 9.8), (sg * CO, 5.2, 6.4)):
            buttress(g, F, BD, s_, (-1, 0), 0.9, BD - 0.02, h1, h2)
    # ---- the aisles under their cross gables, the chapels, the clerestory
    for sg in (-1, 1):
        prof = []
        for i in range(nb):
            prof += [(bays[i] - BD, AE), ((bays[i] + bays[i + 1]) / 2 - BD, AR)]
        prof.append((TX0 - BD, AE))
        wall(g, F, (BD, sg * AO), (TX0, sg * AO), (0, sg), FOOT, AR, BRICK, top=prof,
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - BD, 2.4, CH + 0.35, 13.1, "pointed", "goth2", depth=0.35) for i in range(nb)],
             bands=[(AE - 0.35, AE, STONE)])
        wall(g, F, (BD, sg * CO), (TX0, sg * CO), (0, sg), FOOT, CL, BRICK,
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - BD, 1.5, 2.0, 5.7, "pointed", "goth2", depth=0.3) for i in range(nb)], bands=bands)
        for a in bays[1:-1]:
            buttress(g, F, a, sg * CO, (0, sg), 0.8, BD - 0.02, 5.6)
        wall(g, F, (BD, sg * NV), (TX0, sg * NV), (0, sg), AE - 0.5, NE, BRICK,
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - BD, 1.8, 15.3, 19.6, "pointed", "goth2", depth=0.35) for i in range(nb)],
             bands=[(NE - 0.4, NE, STONE)])
        s_lo, s_hi = sg * CO, sg * AO
        lean_to(g, F, BD, TX0, s_lo, s_hi, CL, CH, oe=0.28, og=(0.3, 0.0), caps=(True, True, False))
        Fr = F.rot()
        for i in range(nb):
            first, last = i == 0, i == nb - 1
            ss0, ss1 = sorted((sg * NV, sg * AO))
            og = (0.0, 0.35) if sg > 0 else (0.35, 0.0)
            caps_end = (False, True) if sg > 0 else (True, False)
            gable_roof(g, Fr, ss0, ss1, bays[i], bays[i + 1], AE, AR, oe=(0.4 if first else 0.0, 0.0), og=og,
                       caps=(first, False, caps_end[0], caps_end[1]))
    # ---- nave and choir roof, transept
    gable_roof(g, F, BD, CHE, -NV, NV, NE, RID, oe=(0.4, 0.4), og=(0.35, 0.0), caps=(True, True, True, False))
    TE = S - BD
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * TE))
        wall(g, F, (TX0, s_a), (TX0, s_b), (-1, 0), FOOT, NE, BRICK, bands=[(NE - 0.4, NE, STONE)],
             holes=[Hc((TE - NV) * (0.78 if sg > 0 else 0.22), 1.8, 11.0, 17.8, "pointed", "goth2", depth=0.35)])
        if sg < 0:
            wall(g, F, (TX1, -TE), (TX1, -NV), (1, 0), FOOT, NE, BRICK, bands=[(NE - 0.4, NE, STONE)],
                 holes=[Hc((TE - NV) / 2, 1.8, 11.0, 17.8, "pointed", "goth2", depth=0.35)])
        else:
            wall(g, F, (TX1, TS1), (TX1, TE), (1, 0), FOOT, NE, BRICK, bands=[(NE - 0.4, NE, STONE)])
        holes = [Hc((TX1 - TX0) / 2, 4.8, 7.4 if sg > 0 else 4.6, 18.4, "pointed", "goth4", depth=0.45)]
        if sg > 0:
            holes.append(Hc((TX1 - TX0) / 2, 2.8, 0.15, 5.6, "pointed", "door_g", depth=0.9))
        Wt = wall(g, F, (TX0, sg * TE), (TX1, sg * TE), (0, sg), FOOT, NE, BRICK,
                  top=[(0, NE), ((TX1 - TX0) / 2, RID), (TX1 - TX0, NE)], holes=holes, bands=bands + [(6.6, 7.0, STONE)])
        if sg > 0:
            disc(g, Wt, (TX1 - TX0) / 2, 21.9, 1.0, "rose", d_front=-0.12, d_back=0.05, sides=14)
        for a, h1, h2 in ((TX0 + 0.5, 13.0, 19.2), (TX1 - 0.5, 13.0, 19.2)):
            buttress(g, F, a, sg * TE, (0, sg), 0.9, BD - 0.02, h1, h2)
    gable_roof(g, F.rot(), -TE, TE, TX0, TX1, NE, RID, oe=(0.4, 0.4), og=(0.35, 0.35))
    # ---- choir and apse
    wall(g, F, (TX1, -NV), (CHE, -NV), (0, -1), 7.0, NE, BRICK, bands=[(NE - 0.4, NE, STONE)],
         holes=[Hc(a - TX1, 2.0, 11.2, 19.2, "pointed", "goth2", depth=0.35) for a in (55.0, 60.2, 65.4)])
    wall(g, F, (TW1, NV), (CHE, NV), (0, 1), 7.0, NE, BRICK, bands=[(NE - 0.4, NE, STONE)],
         holes=[Hc(a - TW1, 2.0, 11.2, 19.2, "pointed", "goth2", depth=0.35) for a in (62.6, 67.0)])
    apse_walls(g, F, CHE, NV, FOOT, NE, BRICK, holes=lambda i, L: [Hc(L / 2, 1.8, 10.4, 18.6, "pointed", "goth2", depth=0.35)],
               bands=[(FOOT, 0.9, STONE), (NE - 0.4, NE, STONE)])
    for P_ in apse_pts(CHE, NV)[1:-1]:
        rd = Vector((P_[0] - CHE, P_[1])).normalized()
        buttress(g, F, P_[0], P_[1], (rd.x, rd.y), 0.8, 0.6, 12.0, 18.4)
    apse_roof(g, F, CHE, NV, NE, RID, oe=0.4)
    # ---- the convent round the choir
    DE = D - M
    wall(g, F, (TX1, -(S - M)), (DE, -(S - M)), (0, -1), FOOT, VE, BRICK, bands=bands + [(4.4, 4.6, STONE)],
         holes=[Hc(a - TX1, 1.1, yb, yb + 1.8, "rect", "hwin", depth=0.22) for yb in (1.4, 5.6) for a in np.arange(53.5, DE - 1.2, 3.2)])
    wall(g, F, (DE, -(S - M)), (DE, -NV), (1, 0), FOOT, VE, BRICK, top=[(0, VE), ((S - M - NV) / 2, VR), (S - M - NV, VE)], bands=bands,
         holes=[Hc(uc, 1.1, yb, yb + 1.8, "rect", "hwin", depth=0.22) for yb in (1.4, 5.6) for uc in (3.0, 7.0, 11.0)])
    wall(g, F, (CHE, -NV), (DE, -NV), (0, 1), FOOT, VE, BRICK, bands=bands)
    gable_roof(g, F, TX1, DE, -(S - M), -NV, VE, VR, oe=(0.4, 0.0), og=(0.0, 0.3), caps=(True, False, False, True))
    N1 = TS1  # the north wing from the tower's side to the edge
    wall(g, F, (TX1, S - M), (DE, S - M), (0, 1), FOOT, VE, BRICK, bands=bands + [(4.4, 4.6, STONE)],
         holes=[Hc(a - TX1, 1.1, yb, yb + 1.8, "rect", "hwin", depth=0.22) for yb in (1.4, 5.6) for a in np.arange(53.5, DE - 1.2, 3.2)])
    wall(g, F, (DE, N1), (DE, S - M), (1, 0), FOOT, VE, BRICK, top=[(0, VE), ((S - M - N1) / 2, VE + 3.0), (S - M - N1, VE)], bands=bands)
    wall(g, F, (TW1, N1), (DE, N1), (0, -1), FOOT, VE, BRICK, bands=bands)
    gable_roof(g, F, TX1, DE, N1, S - M, VE, VE + 3.0, oe=(0.0, 0.4), og=(0.0, 0.3), caps=(False, True, False, True))
    wall(g, F, (DE, NV), (DE, N1), (1, 0), FOOT, 10.2, BRICK, top=[(0, 10.2), (N1 - NV, 8.0)], bands=bands,
         holes=[Hc((N1 - NV) / 2, 1.1, 1.6, 3.4, "rect", "hwin", depth=0.22)])
    wall(g, F, (CHE, NV), (DE, NV), (0, -1), FOOT, 10.2, BRICK, bands=bands)
    lean_to(g, F, TW1, DE, N1, NV, 8.0, 10.2, oe=0.0, og=(0.0, 0.3), caps=(False, False, True))
    garden_wall(g, [F.P(DE - 0.2, -NV), F.P(DE - 0.2, NV)], 3.8, BRICK, coping=STONE)
    # ---- the tower: brick with stone corners, a stone octagon, the bulb
    T1 = 24.2
    tc = F.P((TW0 + TW1) / 2, (TS0 + TS1) / 2)
    tb = bands + [(T1 - 0.6, T1, STONE)]
    wall(g, F, (TW0, TS0), (TW0, TS1), (-1, 0), FOOT, T1, BRICK, bands=tb)
    wall(g, F, (TW1, TS1), (TW1, TS0), (1, 0), FOOT, T1, BRICK, bands=tb,
         holes=[Hc(4.0, 0.9, h0, h0 + 1.9, "round", "round", depth=0.3) for h0 in (12.0, 16.5)])
    wall(g, F, (TW0, TS1), (TW1, TS1), (0, 1), FOOT, T1, BRICK, bands=tb,
         holes=[Hc(4.0, 0.9, h0, h0 + 1.9, "round", "round", depth=0.3) for h0 in (11.0, 15.0)])
    wall(g, F, (TW1, TS0), (TW0, TS0), (0, -1), FOOT, T1, BRICK, bands=tb)
    Wt = plane(g, F, (TW0, TS1), (TW1, TS1), (0, 1))
    disc(g, Wt, 4.0, 20.6, 1.15, "clock", d_front=-0.12, d_back=0.05, sides=12)
    Wt = plane(g, F, (TW1, TS1), (TW1, TS0), (1, 0))
    disc(g, Wt, 4.0, 20.6, 1.15, "clock", d_front=-0.12, d_back=0.05, sides=12)
    for (ca, cs, da, ds) in ((TW0, TS1, 1, -1), (TW1, TS1, -1, -1), (TW1, TS0, -1, 1)):
        a_lo, a_hi = sorted((ca - da * 0.15, ca + da * 0.75))
        s_lo, s_hi = sorted((cs - ds * 0.15, cs + ds * 0.75))
        skip = ["-y", "+y"]
        box(g, F, a_lo, a_hi, s_lo, s_hi, FOOT, T1 - 0.6, STONE, skip=tuple(skip + [("+a" if da > 0 else "-a"), ("+s" if ds > 0 else "-s")]))
    sq = rect_pts(F, TW0, TW1, TS0, TS1)
    ring_band(g, sq, T1 - 0.25, T1 + 0.3, 0.35, STONE)
    R8 = 3.75
    rot8 = math.pi / 8
    oct_ = [(tc[0] + R8 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + R8 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)]
    ring_between(g, tc, sq, oct_, T1 + 0.3, LEAD)
    T2 = 31.6
    poly_walls(g, tc, R8, 8, rot8, T1 + 0.25, T2, STONE,
               holes=lambda i, L: [Hc(L / 2, 1.25, T1 + 1.5, T1 + 5.6, "round", "louv_r", depth=0.4)])
    for i in range(8):
        a = rot8 + 2 * math.pi * i / 8
        x, z = tc[0] + (R8 + 0.02) * math.cos(a), tc[1] + (R8 + 0.02) * math.sin(a)
        lathe(g, (x, T1 + 0.25, z), [(0.28, 0.0), (0.28, T2 - T1 - 0.7)], 4, STONE, rot=a + math.pi / 4)
    ring_band(g, oct_, T2 - 0.5, T2, 0.3, STONE)
    bulb = [(R8 * 0.95, 0.0), (3.5, 0.45), (3.95, 1.4), (3.85, 2.4), (3.25, 3.4), (2.2, 4.2), (1.1, 4.8), (0.8, 5.2), (0.8, 7.0),
            (1.05, 7.05), (1.05, 7.25), (0.72, 7.35), (1.08, 7.95), (0.92, 8.6), (0.42, 9.1), (0.25, 9.5), (0.0, 12.8)]
    lathe(g, (tc[0], T2 - 0.05, tc[1]), bulb, 8, LEAD, rot=rot8)
    x, y, z = tc[0], T2 + 12.6, tc[1]
    lathe(g, (x, y, z), [(0.0, 0.0), (0.22, 0.12), (0.25, 0.3), (0.2, 0.45), (0.0, 0.55)], 8, ATLAS, cell="gilt", shade=1.0)
    cross(g, x, y + 0.5, z, 1.6, cell="gilt")


# ------------------------------------------------------------------ Sint-Jacobskerk


def stjacob(g, fr):
    g.grp = "church_stjacob"
    F, D, S = frame_west_end(fr)
    G = GREY
    BD = 0.8
    NV, AO, CO = 6.0, 14.0, 20.5
    CL, CH = 8.2, 10.2  # chapels' lean-to
    AE, AH = 15.0, 19.5  # aisles' lean-to
    NE, RID = 26.5, 34.0
    TW = 13.0  # the tower's back (a)
    TX0, TX1 = 45.0, 57.0
    CHE, CR_ = 64.0, 6.0  # apse centre, radius
    AMB, AMBE = 13.2, 12.0  # ambulatory outer radius, its eave
    TE = S - BD
    bands = [(FOOT, 0.9, G)]
    nb = 7
    bays = [BD + (TX0 - BD) * i / nb for i in range(nb + 1)]
    # ---- the west tower
    T1, T2, T3, TT = 24.8, 34.6, 44.0, 45.4
    tb = bands + [(T1, T1 + 0.4, G), (T2, T2 + 0.4, G)]
    tw = 2 * NV
    blind = lambda L_: [Hc(L_ * f, 2.3, T1 + 1.2, T2 - 0.8, "pointed", "blind", depth=0.14) for f in (0.2, 0.5, 0.8)]  # noqa: E731
    belfry = lambda L_: [Hc(L_ * f, 1.7, T2 + 1.4, T3 - 1.2, "pointed", "louv_p", depth=0.6) for f in (0.3, 0.7)]  # noqa: E731
    Wt = wall(g, F, (BD, -NV), (BD, NV), (-1, 0), FOOT, TT, G, bands=tb,
              holes=[Hc(NV, 3.3, 0.15, 6.6, "pointed", "door_g", depth=1.2), Hc(NV, 4.8, 8.6, 22.8, "pointed", "goth4", depth=0.5)]
              + belfry(tw))
    disc(g, Wt, NV, 29.8, 1.5, "clock", d_front=-0.15, d_back=0.05, sides=14, side_mat=G)
    for sg in (-1, 1):
        wall(g, F, (BD, sg * NV), (TW, sg * NV), (0, sg), FOOT, TT, G, bands=tb, holes=blind(TW - BD) + belfry(TW - BD))
    wall(g, F, (TW, NV), (TW, -NV), (1, 0), 30.0, TT, G, bands=[(T2, T2 + 0.4, G)], holes=belfry(tw))
    sq = rect_pts(F, BD, TW, -NV, NV)
    tc = F.P((BD + TW) / 2, 0)
    for s_ in (-NV, NV):
        buttress(g, F, BD, s_ - 0.7 * (1 if s_ > 0 else -1), (-1, 0), 1.2, BD - 0.02, 14.0, 30.0, mat=G)
    # the parapet round the flat top, corner turrets, the lantern
    q = 0.4
    inn = rect_pts(F, BD + q, TW - q, -NV + q, NV - q)
    for i in range(4):
        a, b = inn[i], inn[(i + 1) % 4]
        mid = ((a[0] + b[0]) / 2 - tc[0], (a[1] + b[1]) / 2 - tc[1])
        Wall(g, b, a, (-mid[0], -mid[1]), T3, TT, G).build()
    ring_between(g, tc, sq, inn, TT, G)
    g.face([(p[0], T3, p[1]) for p in inn], LEAD, out=(0, 1, 0))
    ring_band(g, sq, TT - 0.35, TT + 0.05, 0.25, G)
    for p in sq:
        dx, dz = tc[0] - p[0], tc[1] - p[1]
        ln = math.hypot(dx, dz)
        x, z = p[0] + dx / ln * 0.5, p[1] + dz / ln * 0.5
        lathe(g, (x, TT - 0.05, z), [(0.72, 0.0), (0.72, 2.3), (0.82, 2.4), (0.82, 2.6)], 8, G, rot=math.pi / 8)
        lathe(g, (x, TT + 2.55, z), [(0.82, 0.0), (0.0, 2.8)], 8, G, rot=math.pi / 8)
    R8, rot8 = 2.6, math.pi / 8
    L1 = 49.4
    poly_walls(g, tc, R8, 8, rot8, T3 - 0.05, L1, G,
               holes=lambda i, L: [Hc(L / 2, 1.0, T3 + 1.2, T3 + 4.0, "round", "louv_r", depth=0.3)] if i % 2 == 0 else [])
    oct_ = [(tc[0] + R8 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + R8 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)]
    ring_band(g, oct_, L1 - 0.4, L1, 0.25, G)
    onion = [(R8 * 0.97, 0.0), (2.35, 0.3), (2.75, 1.3), (2.55, 2.3), (1.75, 3.2), (0.75, 3.9), (0.32, 4.4), (0.32, 4.9), (0.5, 5.0),
             (0.5, 5.2), (0.22, 5.3), (0.0, 6.9)]
    lathe(g, (tc[0], L1 - 0.05, tc[1]), onion, 8, LEAD, rot=rot8)
    cross(g, tc[0], L1 + 6.7, tc[1], 1.7, cell="gilt")
    # ---- the west fronts of the aisles and chapels, aisles, chapels, nave
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * AO))
        top = [(0, AH), (AO - NV, AE)] if sg > 0 else [(0, AE), (AO - NV, AH)]
        wall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, AH, G, top=top, bands=bands,
             holes=[Hc((AO - NV) / 2, 3.2, 5.6, 13.0, "pointed", "goth4", depth=0.4)])
        s_a, s_b = sorted((sg * AO, sg * CO))
        top = [(0, CH), (CO - AO, CL)] if sg > 0 else [(0, CL), (CO - AO, CH)]
        wall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, CH, G, top=top, bands=bands,
             holes=[Hc((CO - AO) / 2, 1.6, 2.2, 6.4, "pointed", "goth2", depth=0.3)])
        for s_, h1, h2 in ((sg * AO, 9.0, 13.5), (sg * CO, 5.4, 7.2)):
            buttress(g, F, BD, s_, (-1, 0), 1.0, BD - 0.02, h1, h2, mat=G)
        wall(g, F, (BD, sg * AO), (TX0, sg * AO), (0, sg), FOOT, AE, G, bands=[(AE - 0.35, AE, G)],
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - BD, 2.2, CH + 0.8, AE - 0.6, "pointed", "goth2", depth=0.35) for i in range(nb)])
        wall(g, F, (BD, sg * CO), (TX0, sg * CO), (0, sg), FOOT, CL, G, bands=bands,
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - BD, 1.8, 2.3, 6.8, "pointed", "goth2", depth=0.3) for i in range(nb)])
        for a in bays[1:-1]:
            buttress(g, F, a, sg * CO, (0, sg), 0.9, 0.8, 5.8, 7.6, mat=G)
        wall(g, F, (TW, sg * NV), (TX0, sg * NV), (0, sg), 18.8, NE, G, bands=[(NE - 0.4, NE, G)],
             holes=[Hc((bays[i] + bays[i + 1]) / 2 - TW, 2.3, 20.4, 25.6, "pointed", "goth2", depth=0.35) for i in range(nb)
                    if bays[i] >= TW - 0.5])
        lean_to(g, F, BD, TX0, sg * CO, sg * AO, CL, CH, oe=0.35, og=(0.3, 0.0), caps=(True, True, False))
        lean_to(g, F, BD, TX0, sg * AO, sg * NV, AE, AH, oe=0.4, og=(0.3, 0.0), caps=(True, True, False))
    gable_roof(g, F, TW, CHE, -NV, NV, NE, RID, oe=(0.45, 0.45), og=(0.0, 0.0), caps=(True, True, False, False))
    # ---- transept
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * TE))
        wall(g, F, (TX0, s_a), (TX0, s_b), (-1, 0), FOOT, NE, G, bands=bands + [(NE - 0.4, NE, G)],
             holes=[Hc((TE - NV) - (24.0 - NV) if sg > 0 else 24.0 - NV, 2.0, 4.2, 11.6, "pointed", "goth2", depth=0.35)])
        wall(g, F, (TX1, s_a), (TX1, s_b), (1, 0), FOOT, NE, G, bands=bands + [(NE - 0.4, NE, G)],
             holes=[Hc((TE - NV) - (21.0 - NV) if sg > 0 else 21.0 - NV, 2.0, 15.0, 22.6, "pointed", "goth2", depth=0.35)])
        holes = [Hc((TX1 - TX0) / 2, 5.4, 8.4 if sg < 0 else 5.4, 23.2, "pointed", "goth4", depth=0.5)]
        if sg < 0:
            holes.append(Hc((TX1 - TX0) / 2, 3.0, 0.15, 6.0, "pointed", "door_g", depth=1.0))
        wall(g, F, (TX0, sg * TE), (TX1, sg * TE), (0, sg), FOOT, NE, G, top=[(0, NE), ((TX1 - TX0) / 2, RID), (TX1 - TX0, NE)],
             holes=holes, bands=bands + [(NE - 0.4, NE, G)])
        for a in (TX0 + 0.6, TX1 - 0.6):
            buttress(g, F, a, sg * TE, (0, sg), 1.1, BD - 0.02, 12.0, 21.0, mat=G)
        for a, da in ((TX0, -1), (TX1, 1)):
            buttress(g, F, a, sg * (TE - 0.65), (da, 0), 1.1, 0.8, 12.0, 21.0, mat=G)
    gable_roof(g, F.rot(), -TE, TE, TX0, TX1, NE, RID, oe=(0.45, 0.45), og=(0.35, 0.35))
    # ---- choir, apse, ambulatory
    for sg in (-1, 1):
        wall(g, F, (TX1, sg * NV), (CHE, sg * NV), (0, sg), 16.5, NE, G, bands=[(NE - 0.4, NE, G)],
             holes=[Hc((CHE - TX1) / 2, 2.2, 18.0, 25.4, "pointed", "goth2", depth=0.35)])
        wall(g, F, (TX1, sg * AMB), (CHE, sg * AMB), (0, sg), FOOT, AMBE, G, bands=bands,
             holes=[Hc((CHE - TX1) / 2, 2.6, 3.0, 10.2, "pointed", "goth2", depth=0.35)])
        lean_to(g, F, TX1, CHE, sg * AMB, sg * NV, AMBE, 17.0, oe=0.4, og=(0.0, 0.0), caps=(True, False, False))
    apse_walls(g, F, CHE, CR_, 16.5, NE, G, holes=lambda i, L: [Hc(L / 2, 2.0, 18.0, 25.4, "pointed", "goth2", depth=0.35)],
               bands=[(NE - 0.4, NE, G)])
    apse_roof(g, F, CHE, CR_, NE, RID, oe=0.45)
    apse_walls(g, F, CHE, AMB, FOOT, AMBE, G, holes=lambda i, L: [Hc(L / 2, 3.0, 2.8, 10.4, "pointed", "goth4", depth=0.4)], bands=bands)
    for P_ in apse_pts(CHE, AMB)[1:-1]:
        rd = Vector((P_[0] - CHE, P_[1])).normalized()
        buttress(g, F, P_[0], P_[1], (rd.x, rd.y), 0.9, 0.8, 8.0, 11.0, mat=G)
    # the ambulatory's roof: a lean-to round the apse
    oe = 0.4
    m = (17.0 - AMBE) / (AMB - CR_)
    Eo = eave_ring(CHE, AMB, oe)
    Pi = [Vector(p) for p in apse_pts(CHE, CR_)]
    for i in range(5):
        a, b = Eo[i], Eo[i + 1]
        c_, d_ = Pi[i + 1], Pi[i]
        rd = ((a + b) / 2 - Vector((CHE, 0))).normalized()
        for t, sh, sg in ((0.2, 0.92, 1), (0.0, 0.42, -1)):
            ye = AMBE - oe * m + t
            g.face([F.p(a.x, a.y, ye), F.p(b.x, b.y, ye), F.p(c_.x, c_.y, 17.0 + t), F.p(d_.x, d_.y, 17.0 + t)], SLATE,
                   out=F.v(rd.x * m * sg, rd.y * m * sg, sg), shade=sh)
        g.face([F.p(a.x, a.y, AMBE - oe * m), F.p(b.x, b.y, AMBE - oe * m), F.p(b.x, b.y, AMBE - oe * m + 0.2),
                F.p(a.x, a.y, AMBE - oe * m + 0.2)], SLATE, out=F.v(rd.x, rd.y, 0), shade=0.65)
    # ---- the sacristy (north of the choir) and the churchyard wall
    SQ0, SQ1, SA1 = AMB, S - M, 68.0
    wall(g, F, (TX1, SQ1), (SA1, SQ1), (0, 1), FOOT, 8.0, G, bands=bands,
         holes=[Hc(a - TX1, 1.4, 2.6, 6.2, "pointed", "goth2", depth=0.3) for a in (59.5, 63.5)])
    wall(g, F, (SA1, SQ1), (SA1, SQ0), (1, 0), FOOT, 8.0, G, top=[(0, 8.0), ((SQ1 - SQ0) / 2, 12.2), (SQ1 - SQ0, 8.0)], bands=bands,
         holes=[Hc((SQ1 - SQ0) / 2, 1.4, 2.6, 6.2, "pointed", "goth2", depth=0.3)])
    wall(g, F, (CHE, SQ0), (SA1, SQ0), (0, -1), FOOT, 8.0, G, bands=bands)
    gable_roof(g, F, TX1, SA1, SQ0, SQ1, 8.0, 12.2, oe=(0.3, 0.4), og=(0.0, 0.3), caps=(True, True, False, True))
    cw = 0.225
    CWH = 2.5
    yard = [[(bays[0] - 0.225 + 0.0, CO), (BD - cw, S - M - cw), (TX0 + 0.3, S - M - cw)],
            [(SA1, S - M - cw), (D - M - cw, S - M - cw), (D - M - cw, -(S - M - cw)), (TX1 - 0.3, -(S - M - cw))],
            [(TX0 + 0.3, -(S - M - cw)), (BD - cw, -(S - M - cw)), (BD - cw, -CO)]]
    yard[0][0] = (BD - cw, CO + 0.3)
    yard[2][-1] = (BD - cw, -(CO + 0.3))
    for pl, caps in zip(yard, ((False, False), (False, False), (False, False))):
        pts = [F.P(a, s) for a, s in pl]
        kerb(g, pts, cw, FOOT, CWH - 0.2, G, caps=caps, top=False)
        kerb(g, pts, cw + 0.08, CWH - 0.25, CWH, G, caps=caps)
    # a few headstones in the yard
    rng = np.random.default_rng(6155)
    for a0_, a1_, sg in ((3.0, 42.0, 1), (3.0, 42.0, -1), (60.0, 76.0, -1)):
        for a in np.arange(a0_, a1_, 5.5):
            s = sg * (CO + 1.8 + rng.uniform(0, 3.5)) if a < 44 else sg * (AMB + 5.0 + rng.uniform(0, 7.0))
            if a > 58 and abs(s) < AMB + 3.0:
                continue
            h = rng.uniform(0.7, 1.1)
            x, z = F.P(a + rng.uniform(-1, 1), s)
            box(g, Frame((x, z), F.ua, F.us), -0.06, 0.06, -0.3, 0.3, -0.1, h, G, skip=("-y",), k=0.9)


# ------------------------------------------------------------------ the Stadspark


_WALK = []


def load_walk():
    if not _WALK:
        img = bpy.data.images.load(WALK)
        w, h = img.size
        arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        bpy.data.images.remove(img)
        _WALK.append((arr, w, h))
    return _WALK[0]


def walk_free(city, x, z):
    walk, ww, wh = load_walk()
    W0 = city["walk"]
    col = int((z - W0["z0"]) / W0["res"])
    row = int((x - W0["x0"]) / W0["res"])
    if not (0 <= col < ww and 0 <= row < wh):
        return False
    px = walk[wh - 1 - row, col]
    return px[0] < 0.5 and px[1] < 0.5 and px[2] < 0.5


def street_eye(city, fr, a, s, out, far=30.0, side=0.0):
    """An eye in the street off a church side: from local (a, s) on its rectangle go out along `out`
    while the walk map is free (at most `far`), then `side` metres along the wall."""
    F = frame_west_end(fr)[0] if fr.get("_west") else frame_front_open(fr)[0]
    x0, z0 = F.P(a, s)
    ox, oz = F.V(*out)
    d = 0.5
    while d < 5.0 and not walk_free(city, x0 + ox * d, z0 + oz * d):
        d += 0.5
    while d < far and walk_free(city, x0 + ox * (d + 0.5), z0 + oz * (d + 0.5)):
        d += 0.5
    tx, tz = F.V(out[1], -out[0])
    return (x0 + ox * d + tx * side, 1.7, z0 + oz * d + tz * side)


def park(g, city):
    g.grp = "park"
    P = city["decor"]["park"]
    outline = [tuple(p) for p in P["outline"]]
    if area2(outline) < 0:
        outline.reverse()
    ponds = P["ponds"]
    inner = [tuple(p) for p in city["decor"]["rampart"]["inner_line"]]
    xs = [p[0] for p in outline]
    zs = [p[1] for p in outline]
    bb = (min(xs) - 40, min(zs) - 40, max(xs) + 40, max(zs) + 40)
    town_c = (sum(p[0] for p in inner) / len(inner), sum(p[1] for p in inner) / len(inner))
    lines = []  # the wall's town face near the park: half-planes, the town on the + side
    for i in range(len(inner)):
        a, b = inner[i], inner[(i + 1) % len(inner)]
        if max(a[0], b[0]) < bb[0] or min(a[0], b[0]) > bb[2] or max(a[1], b[1]) < bb[1] or min(a[1], b[1]) > bb[3]:
            continue
        ex, ez = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(ex, ez)
        nx, nz = -ez / ln, ex / ln
        if (town_c[0] - a[0]) * nx + (town_c[1] - a[1]) * nz < 0:
            nx, nz = -nx, -nz
        lines.append((a, (nx, nz)))

    def town_side(poly, margin):
        for a, (nx, nz) in lines:
            poly = clip_half(poly, lambda p, a=a, nx=nx, nz=nz: (p[0] - a[0]) * nx + (p[1] - a[1]) * nz - margin)
        return poly

    ring = town_side(outline, 0.0)
    if area2(ring) < 0:
        ring.reverse()
    n = len(ring)
    on_wall = []
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        on_wall.append(any(abs((a[0] - l[0][0]) * l[1][0] + (a[1] - l[0][1]) * l[1][1]) < 1e-3
                           and abs((b[0] - l[0][0]) * l[1][0] + (b[1] - l[0][1]) * l[1][1]) < 1e-3 for l in lines))
    # ---- openings: on the three longest town edges, where a street runs furthest from the park
    def free(x, z):
        return walk_free(city, x, z)

    ccw = area2(ring) > 0
    edges = []
    for i in range(n):
        if on_wall[i]:
            continue
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        edges.append((i, (b - a).length))
    edges.sort(key=lambda e: -e[1])
    openings = []
    for i, L in edges[:3]:
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        t = (b - a) / L
        nrm = Vector((t.y, -t.x)) if ccw else Vector((-t.y, t.x))  # outward
        best = None
        for s in np.arange(3.5, L - 3.5 + 1e-6, 0.5):
            p = a + t * s
            run = 0.0
            while run < 30 and free(p.x + nrm.x * (1.5 + run), p.y + nrm.y * (1.5 + run)):
                run += 0.5
            score = run - 0.01 * abs(s - L / 2)
            if best is None or score > best[0]:
                best = (score, s)
        openings.append((i, best[1], 4.0))
    # ---- the pond: two circles joined smoothly, kept 3 m off the wall
    cA, rA = Vector(ponds[0][:2]), ponds[0][2]
    cB, rB = (Vector(ponds[1][:2]), ponds[1][2]) if len(ponds) > 1 else (Vector(ponds[0][:2]), ponds[0][2])
    KS = 10.0
    WGAP = 0.05  # the water stops this short of the wall's town face (Steve 2026-09-25: the wall is the pond's edge there)

    def wall_d(p):
        """Distance from the wall's town face (the nearest line of it), positive on the town side."""
        return min((p.x - a[0]) * nx + (p.y - a[1]) * nz for a, (nx, nz) in lines) if lines else 1e9

    def sdf(p):
        d1 = (p - cA).length - rA
        d2 = (p - cB).length - rB
        h = max(0.0, min(1.0, 0.5 + 0.5 * (d2 - d1) / KS))
        d = d2 * (1 - h) + d1 * h - KS * h * (1 - h)
        return max(d, -(wall_d(p) - WGAP))

    ax_ = (cB - cA)
    best = None
    for f in np.linspace(0, 1, 101):
        p = cA + ax_ * f
        dd = sdf(p)
        if dd < -0.5 and (best is None or dd > best[0]) and rA < (p - cA).length and (p - cB).length > rB * 0.5:
            best = (dd, p)
    p0 = best[1] if best else (cA + cB) / 2
    rays = 96
    rad = []
    for k in range(rays):
        th = 2 * math.pi * k / rays
        d = Vector((math.cos(th), math.sin(th)))
        r = 45.0
        while r > 0 and sdf(p0 + d * r) > 0:
            r -= 0.25
        lo, hi = r, r + 0.25
        for _ in range(20):
            mid = (lo + hi) / 2
            if sdf(p0 + d * mid) < 0:
                lo = mid
            else:
                hi = mid
        rad.append(lo)
    pond = [(p0.x + math.cos(2 * math.pi * k / rays) * rad[k], p0.y + math.sin(2 * math.pi * k / rays) * rad[k]) for k in range(rays)]

    def on_line(q):
        return abs(wall_d(Vector(q)) - WGAP) < 0.01

    def run_end(k):
        return on_line(pond[k]) and not (on_line(pond[k - 1]) and on_line(pond[(k + 1) % len(pond)]))

    # drop points on straight runs (keep the two ends of the run along the wall)
    keep = []
    for k in range(rays):
        a, b, c = Vector(pond[k - 1]), Vector(pond[k]), Vector(pond[(k + 1) % rays])
        if (b - a).normalized().dot((c - b).normalized()) < 0.9995 or run_end(k):
            keep.append(pond[k])
    pond = keep
    ends = [Vector(p) for k, p in enumerate(pond) if run_end(k)]
    # even spacing, then two smoothing passes (the rays from the waist bunch up and zig-zag there);
    # points on the wall line stay where they are
    Pp = [Vector(p) for p in pond]
    per = sum((Pp[(i + 1) % len(Pp)] - Pp[i]).length for i in range(len(Pp)))
    nres = max(24, int(per / 0.9))
    res, acc, i, step = [], 0.0, 0, per / nres
    seg_l = [(Pp[(j + 1) % len(Pp)] - Pp[j]).length for j in range(len(Pp))]
    for k in range(nres):
        target = k * step
        while acc + seg_l[i] < target:
            acc += seg_l[i]
            i += 1
        f = (target - acc) / max(seg_l[i], 1e-9)
        res.append(Pp[i] + (Pp[(i + 1) % len(Pp)] - Pp[i]) * f)
    for e_ in ends:  # the run's ends exactly (resampling may have cut the corners)
        j = min(range(len(res)), key=lambda j: (res[j] - e_).length)
        res[j] = e_.copy()
    for _ in range(2):
        res = [res[j].copy() if on_line(res[j]) else (res[j - 1] + res[j] * 2 + res[(j + 1) % len(res)]) / 4 for j in range(len(res))]
    pond = [(p.x, p.y) for p in res]
    RIM, RY = 0.45, 0.25
    PV = [Vector(p) for p in pond]
    npd = len(PV)
    N_, off = offsets(PV, True, 1 if area2(pond) > 0 else -1)
    at_wall = [on_line(PV[j]) and on_line(PV[(j + 1) % npd]) for j in range(npd)]
    outer = [PV[j] + off[j] * RIM for j in range(npd)]
    wall_touch = []
    for j in range(npd):
        j2 = (j + 1) % npd
        n_ = N_[j]
        if at_wall[j]:
            # no rim: the wall's face is the edge; under the water a stone face closes off the wall's foot
            a, b = PV[j], PV[j2]
            g.face([(a.x, -1.0, a.y), (b.x, -1.0, b.y), (b.x, -0.62, b.y), (a.x, -0.62, a.y)], PSTONE, out=(-n_.x, 0, -n_.y),
                   shade=0.4)
            continue
        a, b, c, d = PV[j], PV[j2], outer[j2], outer[j]
        # at an end of the run along the wall the rim runs on into the wall
        for idx, nb in ((j, (j - 1) % npd), (j2, j2)):
            if at_wall[nb]:
                tdir = (PV[idx] - (PV[j2] if idx == j else PV[j])).normalized()
                into = max((wall_d(PV[idx]) - wall_d(PV[idx] + tdir * 0.01)) / 0.01, 0.25)
                e_ = PV[idx] + tdir * min((WGAP + 0.2) / into, 1.2)
                if idx == j:
                    a, d = e_, e_ + n_ * RIM
                else:
                    b, c = e_, e_ + n_ * RIM
                wall_touch.append(PV[idx])
        g.face([(a.x, RY, a.y), (b.x, RY, b.y), (c.x, RY, c.y), (d.x, RY, d.y)], PSTONE, out=(0, 1, 0))
        g.face([(d.x, -0.2, d.y), (c.x, -0.2, c.y), (c.x, RY, c.y), (d.x, RY, d.y)], PSTONE, out=(n_.x, 0, n_.y))
        g.face([(a.x, -1.0, a.y), (b.x, -1.0, b.y), (b.x, RY, b.y), (a.x, RY, a.y)], PSTONE, out=(-n_.x, 0, -n_.y), floor=-0.35)
    for y, mat, sh in ((-0.35, WATER, 0.95), (-1.0, PSTONE, 0.3)):
        for j in range(npd):
            j2 = (j + 1) % npd
            a, b = PV[j], PV[j2]
            for f0, f1 in ((0.0, 0.34), (0.34, 0.67), (0.67, 1.0)):
                q = [p0 + (a - p0) * f1, p0 + (b - p0) * f1]
                if f0 == 0:
                    pts = [(p0.x, y, p0.y), (q[1].x, y, q[1].y), (q[0].x, y, q[0].y)]
                else:
                    r0 = [p0 + (a - p0) * f0, p0 + (b - p0) * f0]
                    pts = [(r0[0].x, y, r0[0].y), (r0[1].x, y, r0[1].y), (q[1].x, y, q[1].y), (q[0].x, y, q[0].y)]
                g.face(pts, mat, out=(0, 1, 0), shade=sh)
    # the solid pond: the rim's outer edge, and along the wall the water's edge (0.05 m off the face)
    pond_outer = [(PV[j].x, PV[j].y) if (at_wall[j] or at_wall[j - 1]) else (outer[j].x, outer[j].y) for j in range(npd)]
    # where the water meets the wall's face: the run's two ends moved onto the face
    touch = []
    if lines and wall_touch:
        wl = min(lines, key=lambda l: sum(abs((p.x - l[0][0]) * l[1][0] + (p.y - l[0][1]) * l[1][1] - WGAP) for p in wall_touch))
        for p in wall_touch:
            dd = (p.x - wl[0][0]) * wl[1][0] + (p.y - wl[0][1]) * wl[1][1]
            touch.append([round(p.x - wl[1][0] * dd, 3), round(p.y - wl[1][1] * dd, 3)])

    def ray_hit(o, d, poly):
        best = None
        for i in range(len(poly)):
            a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
            e = b - a
            den = d.x * e.y - d.y * e.x
            if abs(den) < 1e-12:
                continue
            w = a - o
            t = (w.x * e.y - w.y * e.x) / den
            u = (w.x * d.y - w.y * d.x) / den
            if t > 0 and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best):
                best = t
        return best

    solids = {"railing": [], "piers": [], "benches": [], "lanterns": [], "bridge_rails": []}

    def orect(c, t, hl, hw):
        c, t = Vector(c), Vector(t).normalized()
        nn = Vector((-t.y, t.x))
        return [[round(v, 3) for v in (c + t * sa * hl + nn * sb * hw)] for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

    # ---- the footbridge over the waist
    bdir = Vector((-ax_.y, ax_.x)).normalized()
    d1 = ray_hit(p0, bdir, pond)
    d2 = ray_hit(p0, -bdir, pond)
    bridge = None
    if d1 and d2 and d1 + d2 < 14:
        RAMP = 1.4
        e0 = p0 - bdir * (d2 + RIM + RAMP)
        e1 = p0 + bdir * (d1 + RIM + RAMP)
        span = (e1 - e0).length
        wA, wB = RAMP, span - RAMP  # the rims' outer edges
        HW = 0.9

        def ytop(sv):
            if sv <= wA:
                return 0.05 + 0.37 * sv / wA
            if sv >= wB:
                return 0.05 + 0.37 * (span - sv) / RAMP
            return 0.42 + 0.16 * math.sin(math.pi * (sv - wA) / (wB - wA))

        st = [0.0, wA * 0.5, wA] + [wA + (wB - wA) * i / 6 for i in range(1, 6)] + [wB, wB + RAMP * 0.5, span]
        nn = Vector((-bdir.y, bdir.x))

        def pt(sv, off, y):
            q = e0 + bdir * sv + nn * off
            return (q.x, y, q.y)

        for sa, sb in zip(st, st[1:]):
            ya, yb = ytop(sa), ytop(sb)
            g.face([pt(sa, -HW, ya), pt(sb, -HW, yb), pt(sb, HW, yb), pt(sa, HW, ya)], WOOD, out=(0, 1, 0))
            g.face([pt(sa, -HW, ya - 0.14), pt(sb, -HW, yb - 0.14), pt(sb, HW, yb - 0.14), pt(sa, HW, ya - 0.14)], WOOD, out=(0, -1, 0), k=0.5)
            for sg in (-1, 1):
                g.face([pt(sa, sg * HW, ya - 0.14), pt(sb, sg * HW, yb - 0.14), pt(sb, sg * HW, yb), pt(sa, sg * HW, ya)], WOOD,
                       out=(nn.x * sg, 0, nn.y * sg), k=0.8)
        for sv, sg in ((0.0, -1), (span, 1)):
            y = ytop(sv)
            g.face([pt(sv, -HW, y - 0.14), pt(sv, HW, y - 0.14), pt(sv, HW, y), pt(sv, -HW, y)], WOOD, out=(bdir.x * sg, 0, bdir.y * sg))
        posts = [0.25, wA, wA + (wB - wA) / 3, wA + 2 * (wB - wA) / 3, wB, span - 0.25]
        for sg in (-1, 1):
            tops = []
            for sv in posts:
                y = ytop(sv)
                bot = min(-0.95, y - 0.2) if wA < sv < wB else y - 0.3
                if sv <= 0.3 or sv >= span - 0.3:
                    bot = -0.2
                base = pt(sv, sg * (HW + 0.06), 0)
                bar(g, (base[0], bot, base[2]), (base[0], y + 1.0, base[2]), 0.1, WOOD, k=0.85)
                tops.append((base, y))
            for (pa, ya), (pb, yb) in zip(tops, tops[1:]):
                # each rail from post to post, its ends inside the posts (the rails do not meet)
                for dy, w_, h_ in ((0.97, 0.07, 0.06), (0.5, 0.05, 0.05)):
                    A_ = Vector((pa[0], ya + dy, pa[2]))
                    B_ = Vector((pb[0], yb + dy, pb[2]))
                    t_ = (B_ - A_).normalized()
                    bar(g, A_ + t_ * 0.03, B_ - t_ * 0.03, w_, WOOD, h=h_, k=0.9)
            c = e0 + bdir * (span / 2) + nn * sg * (HW + 0.06)
            solids["bridge_rails"].append(orect((c.x, c.y), bdir, span / 2, 0.08))
        bridge = {"from": [round(e0.x, 3), round(e0.y, 3)], "to": [round(e1.x, 3), round(e1.y, 3)], "width": 2 * HW,
                  "deck": [[round(sv, 3), round(ytop(sv), 3)] for sv in st]}
    # ---- railing on a stone kerb, piers at the openings
    op_by_edge = {i: (s, w) for i, s, w in openings}
    runs, cur = [], []
    start = next((i for i in range(n) if on_wall[i - 1] and not on_wall[i]), None)
    order = list(range(n)) if start is None else [(start + k) % n for k in range(n)]
    ends_wall = []
    for i in order:
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        if on_wall[i]:
            if cur:
                runs.append(cur)
                cur = []
            continue
        L = (b - a).length
        t = (b - a) / L
        if not cur:
            cur = [a - t * 0.1] if on_wall[i - 1] else [a]
        if i in op_by_edge:
            s, w = op_by_edge[i]
            cur.append(a + t * (s - w / 2))
            runs.append(cur)
            cur = [a + t * (s + w / 2)]
        nxt = (i + 1) % n
        cur.append(b + t * 0.1 if on_wall[nxt] else b)
    if cur:
        if runs and start is None:
            runs[0] = cur[:-1] + runs[0]
        else:
            runs.append(cur)
    KH, KY = 0.18, 0.28
    rail_len = 0.0
    for run in runs:
        pts = [(p.x, p.y) for p in run]
        kerb(g, pts, KH, -0.2, KY, PSTONE, caps=(False, False))
        for si, (pa, pb) in enumerate(zip(run, run[1:])):
            L = (pb - pa).length
            if L < 1e-3:
                continue
            t = (pb - pa) / L
            c = (pa + pb) / 2
            solids["railing"].append(orect((c.x, c.y), t, L / 2 + KH, KH))
            rail_len += L
            nposts = max(1, math.ceil(L / 2.4))
            for k in range(0 if si == 0 else 1, nposts + 1):
                q = pa + t * (L * k / nposts)
                bar(g, (q.x, KY - 0.03, q.y), (q.x, 1.12, q.y), 0.06, IRON, skip_ends=True, shade=0.9)
                pyramid(g, [(q.x - 0.045, 1.12, q.y - 0.045), (q.x + 0.045, 1.12, q.y - 0.045), (q.x + 0.045, 1.12, q.y + 0.045),
                            (q.x - 0.045, 1.12, q.y + 0.045)], (q.x, 1.24, q.y), IRON, shade=0.9)
            for y in (0.42, 1.0):
                bar(g, (pa.x, y, pa.y), (pb.x, y, pb.y), 0.03, IRON, h=0.035, shade=0.85)
            npk = int(L / 0.16)
            nn = Vector((-t.y, t.x))
            for k in range(1, npk):
                q = pa + t * (L * k / npk)
                a_ = q - t * 0.011
                b_ = q + t * 0.011
                g.face([(a_.x, KY - 0.02, a_.y), (b_.x, KY - 0.02, b_.y), (b_.x, 1.06, b_.y), (a_.x, 1.06, a_.y)], IRON,
                       out=(nn.x, 0, nn.y), shade=0.85)
                g.face([(a_.x, 1.06, a_.y), (b_.x, 1.06, b_.y), (q.x, 1.13, q.y)], IRON, out=(nn.x, 0, nn.y), shade=0.85)
    for i, s, w in openings:
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        t = (b - a).normalized()
        for sg in (-1, 1):
            c = a + t * (s + sg * (w / 2))
            x, z = c.x, c.y
            Fp = Frame((x, z), (t.x, t.y), (-t.y, t.x))
            box(g, Fp, -0.28, 0.28, -0.28, 0.28, -0.2, 1.35, PSTONE, skip=("-y", "+y"))
            box(g, Fp, -0.35, 0.35, -0.35, 0.35, 1.35, 1.5, PSTONE)
            lathe(g, (x, 1.5, z), [(0.12, 0.0), (0.18, 0.08), (0.22, 0.22), (0.18, 0.36), (0.0, 0.44)], 8, PSTONE)
            solids["piers"].append(orect((x, z), t, 0.35, 0.35))
    # ---- benches and lanterns
    def bench(c, face):
        c, f = Vector(c), Vector(face).normalized()
        t = Vector((f.y, -f.x))

        def P(xl, y, zl):
            q = c + t * xl + f * zl
            return (q.x, y, q.y)

        for xl in (-0.82, 0.82):
            bar(g, P(xl, -0.05, 0.2), P(xl, 0.45, 0.2), 0.05, IRON, shade=0.85)
            bar(g, P(xl, -0.05, -0.2), P(xl - 0.001, 0.9, -0.3), 0.05, IRON, h=0.045, shade=0.85)
            bar(g, P(xl, 0.41, 0.25), P(xl + 0.001, 0.41, -0.24), 0.045, IRON, h=0.05, shade=0.85, skip=("+z",))
        for zl in (0.17, 0.04, -0.09):
            bar(g, P(-0.97, 0.465, zl), P(0.97, 0.465, zl), 0.1, WOOD, h=0.035, shade=0.95)
        for y, zl in ((0.62, -0.235), (0.79, -0.28)):
            bar(g, P(-0.97, y, zl), P(0.97, y, zl), 0.035, WOOD, h=0.11, shade=0.9)
        solids["benches"].append(orect((c + f * -0.05).to_tuple(), t, 1.0, 0.33))

    def lantern(c):
        x, z = c
        lathe(g, (x, -0.05, z), [(0.19, 0.0), (0.19, 0.15), (0.14, 0.3), (0.12, 0.55), (0.075, 0.75), (0.06, 2.55), (0.09, 2.6), (0.09, 2.7),
                                 (0.05, 2.75), (0.05, 2.95)], 8, IRON, shade=0.85, rot=math.pi / 8)
        bar(g, (x - 0.32, 2.45, z), (x + 0.32, 2.45, z), 0.035, IRON, shade=0.85)
        b0, b1, y0, y1 = 0.12, 0.2, 2.95, 3.4
        bp = [(x - b0, y0, z - b0), (x + b0, y0, z - b0), (x + b0, y0, z + b0), (x - b0, y0, z + b0)]
        tp = [(x - b1, y1, z - b1), (x + b1, y1, z - b1), (x + b1, y1, z + b1), (x - b1, y1, z + b1)]
        for i in range(4):
            j = (i + 1) % 4
            g.face([bp[i], bp[j], tp[j], tp[i]], GLOW, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], shade=1.0,
                   out=((bp[i][0] + bp[j][0]) / 2 - x, 0.2, (bp[i][2] + bp[j][2]) / 2 - z))
        g.face(bp, IRON, out=(0, -1, 0), shade=0.8)
        q = b1 + 0.05
        pyramid(g, [(x - q, y1, z - q), (x + q, y1, z - q), (x + q, y1, z + q), (x - q, y1, z + q)], (x, y1 + 0.32, z), IRON, shade=0.85)
        g.face([(x - q, y1, z - q), (x + q, y1, z - q), (x + q, y1, z + q), (x - q, y1, z + q)], IRON, out=(0, -1, 0), shade=0.7)
        lathe(g, (x, y1 + 0.3, z), [(0.03, 0.0), (0.06, 0.06), (0.0, 0.16)], 6, IRON, shade=0.85)
        solids["lanterns"].append(orect((x, z), (1, 0), 0.2, 0.2))

    # the wall's stairs down into the park (flight and landing, build_wall.py): park things keep clear of them
    stairs = [[tuple(q) for q in st[k_]] for st in city["decor"]["rampart"].get("stairs", []) for k_ in ("flight", "landing") if k_ in st]

    def off_stairs(p, clear=2.5):
        return all(not inside(p, sp) and poly_dist(p, sp) >= clear for sp in stairs)

    def ok(p, clear=2.6):
        if not inside(p, ring) or poly_dist(p, ring) < clear or not off_stairs(p, 3.5):
            return False
        if poly_dist(p, pond_outer) < 1.8 or inside(p, pond_outer):
            return False
        if bridge and seg_dist(p, bridge["from"], bridge["to"]) < 2.6:
            return False
        return True

    placed = []
    lamp_at = []
    for i, s, w in openings:
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        t = (b - a).normalized()
        inw = Vector((-t.y, t.x)) if ccw else Vector((t.y, -t.x))
        for sg in (1, -1):
            c = a + t * (s + sg * (w / 2 + 0.2)) + inw * 1.3
            if inside((c.x, c.y), ring) and poly_dist((c.x, c.y), pond_outer) > 2:
                lamp_at.append((c.x, c.y))
                break
    if bridge:
        e0, e1 = Vector(bridge["from"]), Vector(bridge["to"])
        bd = (e1 - e0).normalized()
        nn = Vector((-bd.y, bd.x))
        for e, sg in ((e0, 1), (e1, -1)):
            c = e + bd * sg * 0.4 + nn * 1.45
            lamp_at.append((c.x, c.y))
    lamp_at = [c for c in lamp_at if off_stairs(c, 1.5)]
    for c in lamp_at:
        lantern(c)
        placed.append(Vector(c))
    # benches round the pond, facing it
    cands = []
    for k in range(0, 360, 6):
        th = math.radians(k)
        d = Vector((math.cos(th), math.sin(th)))
        for cen, r in ((cA, rA), (cB, rB)):
            dist = ray_hit(cen, d, pond_outer)
            if dist is None:
                continue
            q = cen + d * (dist + 2.3)
            if ok((q.x, q.y)) and poly_dist((q.x, q.y), pond_outer) > 1.9:
                cands.append((q, -d))
    chosen = []
    while cands and len(chosen) < 4:
        if not chosen:
            pick = max(cands, key=lambda c: (c[0] - p0).length)
        else:
            pick = max(cands, key=lambda c: min((c[0] - o).length for o in [x[0] for x in chosen] + placed))
        if chosen and min((pick[0] - o).length for o in [x[0] for x in chosen] + placed) < 6:
            break
        chosen.append(pick)
        cands.remove(pick)
    for q, f in chosen:
        bench((q.x, q.y), (f.x, f.y))
    # two more along the railing, facing into the park
    runs_by_len = sorted(((sum((b - a).length for a, b in zip(r, r[1:])), r) for r in runs), key=lambda x: -x[0])
    for L, run in runs_by_len[:2]:
        acc = 0.0
        for a, b in zip(run, run[1:]):
            l = (b - a).length
            if acc + l >= L / 2:
                t = (b - a).normalized()
                inw = Vector((-t.y, t.x)) if ccw else Vector((t.y, -t.x))
                q = a + t * (L / 2 - acc) + inw * 1.5
                if inside((q.x, q.y), ring) and poly_dist((q.x, q.y), pond_outer) > 2.5 and off_stairs((q.x, q.y), 3.5) and \
                        min((q - o).length for o in placed + [x[0] for x in chosen]) > 3.0:
                    bench((q.x, q.y), (inw.x, inw.y))
                break
            acc += l
    info = {
        "about": "Stadspark furniture (tools/blender/build_churches.py -> churches.glb, object 'park'). World x, z. "
                 "Rects are 4 corners. Solid for the walk map: railing (the stone kerb under the iron railing), piers, "
                 "benches, lanterns, bridge_rails, and the pond (its rim's outer edge) except the bridge deck, which "
                 "is walked on: deck = [distance from 'from', y of the planks]. The grass is drawn by the game; cut "
                 "the pond out of it (the water lies at water_y, the rim's top at rim_y). water = the water's own edge. water_wall = the two "
                 "ends of the stretch of the wall's town face (decor.rampart.inner_line) the water runs up to: no rim there, "
                 "the water stops 0.05 m off the face.",
        "outline": [[round(x, 3), round(z, 3)] for x, z in ring],
        "openings": [[round((Vector(ring[i]) + (Vector(ring[(i + 1) % n]) - Vector(ring[i])).normalized() * s).x, 3),
                      round((Vector(ring[i]) + (Vector(ring[(i + 1) % n]) - Vector(ring[i])).normalized() * s).y, 3), w]
                     for i, s, w in openings],
        "pond": [[round(x, 3), round(z, 3)] for x, z in pond_outer],
        "water": [[round(x, 3), round(z, 3)] for x, z in pond],
        "water_wall": touch,
        "water_y": -0.35,
        "rim_y": RY,
        "bridge": bridge,
        **solids,
        "solids": [r for k in ("railing", "piers", "benches", "lanterns", "bridge_rails") for r in solids[k]],
    }
    # nothing of the park may stand in or over the water but the footbridge (its planks, posts, rails)
    wet = []
    for pts_, _, _, mat_ in g.groups.get("park", []):
        if mat_ in (WATER, WOOD) or max(p_.y for p_ in pts_) < 0.3:
            continue
        cx_ = sum(p_.x for p_ in pts_) / len(pts_)
        cz_ = sum(p_.z for p_ in pts_) / len(pts_)
        if inside((cx_, cz_), pond):
            wet.append((MATS[mat_], round(cx_, 2), round(cz_, 2)))
    wet_solids = [k_ for k_ in ("railing", "piers", "benches", "lanterns") for r_ in solids[k_]
                  if any(inside(tuple(q_), pond) for q_ in r_) or inside((sum(q_[0] for q_ in r_) / 4, sum(q_[1] for q_ in r_) / 4), pond)]
    print(f"[build_churches] park parts over the water: {len(wet)} faces {wet[:5]}, solids {wet_solids}")
    stats = {"water_wall": touch, "rail_m": round(rail_len, 1), "benches": len(solids["benches"]), "lanterns": len(solids["lanterns"]),
             "openings": len(openings), "bridge": bridge is not None}
    return info, stats, ring, pond_outer


# ------------------------------------------------------------------ the pump


def pump(g):
    g.grp = "pump"
    F = Frame((0.0, 0.0), (0.0, 1.0), (1.0, 0.0))  # a along +z (the spout), s along +x
    box(g, F, -0.3, 0.3, -0.3, 0.3, -0.1, 0.24, PSTONE, skip=("-y",))
    prof = [(0.2, 0.0), (0.2, 0.08), (0.15, 0.16), (0.13, 0.24), (0.105, 1.16), (0.14, 1.22), (0.14, 1.3), (0.115, 1.35),
            (0.16, 1.42), (0.16, 1.5), (0.1, 1.58), (0.05, 1.7), (0.075, 1.75), (0.0, 1.86)]
    lathe(g, (0.0, 0.22, 0.0), prof, 8, IRON, rot=math.pi / 8, shade=0.9)
    bar(g, (0, 1.0, 0.06), (0, 1.0, 0.44), 0.075, IRON, shade=0.85)
    bar(g, (0, 1.02, 0.42), (0, 0.86, 0.5), 0.062, IRON, shade=0.85)
    bar(g, (0.1, 1.46, 0.0), (0.2, 1.46, 0.0), 0.05, IRON, shade=0.85)
    bar(g, (0.21, 1.46, 0.12), (0.21, 1.74, -0.56), 0.045, IRON, h=0.04, shade=0.85)
    bar(g, (0.205, 1.72, -0.52), (0.205, 1.62, -0.66), 0.05, IRON, h=0.05, shade=0.85)
    # the trough
    x0, x1, z0, z1, yt = -0.5, 0.5, 0.26, 0.96, 0.5
    Ft = Frame((0.0, 0.0), (0.0, 1.0), (1.0, 0.0))
    for (A, Bq, out) in (((z0, x0), (z0, x1), (-1, 0)), ((z1, x1), (z1, x0), (1, 0)), ((z1, x0), (z0, x0), (0, -1)),
                         ((z0, x1), (z1, x1), (0, 1))):
        if out == (-1, 0):
            continue
        wall(g, Ft, A, Bq, out, -0.1, yt, PSTONE)
    wall(g, Ft, (z0, x0), (z0, -0.3), (-1, 0), -0.1, yt, PSTONE)
    wall(g, Ft, (z0, 0.3), (z0, x1), (-1, 0), -0.1, yt, PSTONE)
    wall(g, Ft, (z0, -0.3), (z0, 0.3), (-1, 0), 0.24, yt, PSTONE)
    q = 0.11
    outer = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    inner = [(x0 + q, z0 + q), (x1 - q, z0 + q), (x1 - q, z1 - q), (x0 + q, z1 - q)]
    ring_between(g, (0.0, (z0 + z1) / 2), outer, inner, yt, PSTONE)
    for i in range(4):
        a, b = inner[i], inner[(i + 1) % 4]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - (z0 + z1) / 2)
        g.face([(a[0], 0.36, a[1]), (b[0], 0.36, b[1]), (b[0], yt, b[1]), (a[0], yt, a[1])], PSTONE, out=(-mid[0], 0, -mid[1]), k=0.8)
    g.face([(p[0], 0.36, p[1]) for p in inner], WATER, out=(0, 1, 0), shade=0.9)


# ------------------------------------------------------------------ export, check


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=20, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def tri_area_overlap(A, Bt):
    """Area of the overlap of two triangles in 2D (convex clip)."""
    poly = list(A)
    ccw = area2(Bt) > 0
    for i in range(3):
        a, b = Bt[i], Bt[(i + 1) % 3]
        ex, ez = b[0] - a[0], b[1] - a[1]
        sgn = 1 if ccw else -1
        poly = clip_half(poly, lambda p, a=a, ex=ex, ez=ez: sgn * (ex * (p[1] - a[1]) - ez * (p[0] - a[0])))
        if len(poly) < 3:
            return 0.0
    return abs(area2(poly))


def plane_check(path):
    """Every pair of faces in the exported file that lie in one plane (or within 5 cm, parallel) and overlap."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    T = []
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        me.calc_loop_triangles()
        Mw = ob.matrix_world
        vs = [Mw @ v.co for v in me.vertices]
        for lt in me.loop_triangles:
            p = [Vector((vs[i].x, vs[i].z, -vs[i].y)) for i in lt.vertices]
            n = (p[1] - p[0]).cross(p[2] - p[0])
            if n.length < 1e-9:
                continue
            ar = n.length / 2
            n.normalize()
            nf = n.copy()
            for comp in (n.x, n.y, n.z):
                if abs(comp) > 1e-6:
                    if comp < 0:
                        n = -n
                    break
            mname = me.materials[lt.material_index].name if me.materials else ""
            T.append((p, n, n.dot(p[0]), ob.name, mname, ar, nf))
    bins = {}
    for i, (p, n, d, *_rest) in enumerate(T):
        key = (round(n.x * 40), round(n.y * 40), round(n.z * 40))
        bins.setdefault(key, []).append(i)
    fights, close = [], []
    seen = set()
    cos_lim = math.cos(math.radians(1.5))
    for key, idx in bins.items():
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    k2 = (key[0] + dx, key[1] + dy, key[2] + dz)
                    if k2 >= key and k2 in bins:
                        cand.append(k2)
        for k2 in cand:
            J = bins[k2]
            A_ = sorted(idx, key=lambda i: T[i][2])
            B_ = sorted(J, key=lambda i: T[i][2])
            dB = [T[i][2] for i in B_]
            import bisect
            for i in A_:
                p, n, d = T[i][0], T[i][1], T[i][2]
                lo = bisect.bisect_left(dB, d - 0.051)
                hi = bisect.bisect_right(dB, d + 0.051)
                for j in B_[lo:hi]:
                    if j == i or (k2 == key and j < i):
                        continue
                    pair = (min(i, j), max(i, j))
                    if pair in seen:
                        continue
                    seen.add(pair)
                    q, m = T[j][0], T[j][1]
                    if n.dot(m) < cos_lim:
                        continue
                    mn = [min(v[c] for v in p) for c in range(3)]
                    mx = [max(v[c] for v in p) for c in range(3)]
                    mn2 = [min(v[c] for v in q) for c in range(3)]
                    mx2 = [max(v[c] for v in q) for c in range(3)]
                    if any(mx[c] < mn2[c] - 0.06 or mx2[c] < mn[c] - 0.06 for c in range(3)):
                        continue
                    gap = abs(n.dot(sum(q, Vector()) / 3) - d)
                    same = T[i][6].dot(T[j][6]) > 0
                    if gap > (0.05 if same else 0.005):
                        continue
                    u = n.orthogonal().normalized()
                    w = n.cross(u)
                    a2 = [(v.dot(u), v.dot(w)) for v in p]
                    b2 = [(v.dot(u), v.dot(w)) for v in q]
                    ov = tri_area_overlap(a2, b2)
                    if ov < 0.002:
                        continue
                    c = sum(p, Vector()) / 3
                    item = (round(ov, 3), round(gap, 4), (round(c.x, 2), round(c.y, 2), round(c.z, 2)), T[i][3], T[i][4], T[j][3], T[j][4])
                    (fights if gap < 0.005 else close).append(item)
    flat0 = [t for t in T if abs(t[1].y) > 0.999 and abs(t[0][0].y) < 0.03]
    print(f"[build_churches] plane check: {len(T)} triangles, {len(fights)} pairs in one plane, {len(close)} pairs within 5 cm, "
          f"{len(flat0)} flat faces near y 0")
    from collections import Counter
    for lab, lst in (("one plane", fights), ("within 5 cm", close)):
        cnt = Counter((it[3], it[4], it[5], it[6]) for it in lst)
        for k_, v_ in cnt.most_common(12):
            print(f"   {lab} by part: {v_} x {k_}")
            for it in [x for x in lst if (x[3], x[4], x[5], x[6]) == k_][:3]:
                print(f"        e.g. {it[:3]}")
    for it in sorted(fights, key=lambda x: -x[0])[:25]:
        print("   one plane:", it)
    for it in sorted(close, key=lambda x: -x[0])[:25]:
        print("   within 5 cm:", it)
    for t in flat0[:10]:
        print("   flat at y~0:", t[3], t[4], [tuple(round(c, 2) for c in v) for v in t[0]])
    return len(fights), len(close)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
        nt = mt.node_tree
        if nt is None:
            continue
        bsdf = nt.nodes.get("Principled BSDF")
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if bsdf is None or tex is None:
            continue
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        if mt.name.endswith("_glow"):
            bsdf.inputs["Emission Strength"].default_value = 3.0


def flat_mat(name, rgb):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = 0.9
    return m


def preview_ground(park_ring, pond):
    bm = bmesh.new()
    xs = [p[0] for p in park_ring]
    zs = [p[1] for p in park_ring]
    X0, X1, Z0, Z1 = min(xs) - 1, max(xs) + 1, min(zs) - 1, max(zs) + 1
    for (x0, z0, x1, z1) in ((-700, -300, 500, Z0), (-700, Z1, 500, 700), (-700, Z0, X0, Z1), (X1, Z0, 500, Z1)):
        vs = [bm.verts.new(B((x, -0.002, z))) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    for x in np.arange(X0, X1, 0.5):
        for z in np.arange(Z0, Z1, 0.5):
            c = (x + 0.25, z + 0.25)
            if not inside(c, park_ring) and not any(inside(q, pond) for q in ((x, z), (x + 0.5, z), (x + 0.5, z + 0.5), (x, z + 0.5))):
                vs = [bm.verts.new(B((px, -0.002, pz))) for px, pz in ((x, z), (x + 0.5, z), (x + 0.5, z + 0.5), (x, z + 0.5))]
                f = bm.faces.new(vs)
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
    me = bpy.data.meshes.new("prev_ground")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(flat_mat("prev_street", (0.30, 0.29, 0.27)))
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("prev_ground", me))
    bm = bmesh.new()
    xs = [p[0] for p in park_ring]
    zs = [p[1] for p in park_ring]
    cs = 0.5
    for x in np.arange(min(xs), max(xs), cs):
        for z in np.arange(min(zs), max(zs), cs):
            c = (x + cs / 2, z + cs / 2)
            corners = ((x, z), (x + cs, z), (x + cs, z + cs), (x, z + cs), c)
            if inside(c, park_ring) and not any(inside(q, pond) for q in corners):
                vs = [bm.verts.new(B((px, 0.004, pz))) for px, pz in ((x, z), (x + cs, z), (x + cs, z + cs), (x, z + cs))]
                f = bm.faces.new(vs)
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
    me = bpy.data.meshes.new("prev_grass")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(flat_mat("prev_grass_m", (0.20, 0.26, 0.11)))
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("prev_grass", me))


def stage():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    try:
        sc.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    world = bpy.data.worlds.new("sky")
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.55, 0.6, 0.66, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_start = 0.1
    cam.data.clip_end = 3000
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shot(cam, name, eye, look, lens=30, res=(1280, 800)):
    cam.location = B(eye)
    cam.rotation_euler = (B(look) - B(eye)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.join(SHOTS, name)
    os.makedirs(SHOTS, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_churches] preview -> {sc.render.filepath}")


def preview(city, objs, park_ring, pond, only=None, context=False, pinfo=None):
    pinfo = pinfo or {}
    preview_materials()
    preview_ground(park_ring, pond)
    ctx_objs = []
    if context:
        for f in ("city.glb", "wall.glb"):
            p = os.path.join(ROOT, "client", "public", "models", f)
            if os.path.exists(p):
                before = set(bpy.context.scene.objects)
                bpy.ops.import_scene.gltf(filepath=p)
                for o in set(bpy.context.scene.objects) - before:
                    ctx_objs.append(o)
                    if o.type == "MESH":
                        for ms in o.material_slots:
                            if ms.material:
                                ms.material.use_backface_culling = False
    pumpo = objs.get("pump")
    if pumpo:
        pumpo.location = B((-300.0, 0.0, 250.0))
    cam = stage()
    L = city["landmarks"]
    views = []
    fc = dict(L["carolus"]["frame"])
    Fc, Dc, Sc = frame_front_open(fc)
    at = lambda F, a, s, y: F.p(a, s, y)  # noqa: E731
    views += [("churches_carolus_square.png", street_eye(city, fc, 0, 0, (-1, 0), 16), at(Fc, 2, 0, 15.0), 13),
              ("churches_carolus_front.png", street_eye(city, fc, 0, 12, (-1, 0), 14, side=-4), at(Fc, 1, 0, 10.0), 15),
              ("churches_carolus_close.png", street_eye(city, fc, 0, -3, (-1, 0), 8), at(Fc, 1, 3, 4.0), 20),
              ("churches_carolus_above.png", at(Fc, -40, -30, 55), at(Fc, Dc / 2, 0, 10), 26),
              ("churches_carolus_back.png", at(Fc, Dc + 38, 26, 30), at(Fc, Dc / 2, 0, 16), 24),
              ("churches_carolus_top.png", at(Fc, 14, 16, 34), at(Fc, 1.5, 0, 26), 26)]
    fp = dict(L["stpaul"]["frame"], _west=True)
    Fp, Dp, Sp = frame_west_end(fp)
    views += [("churches_stpaul_square.png", at(Fp, 42, Sp + 26, 1.7), at(Fp, 50, 0, 16), 16),
              ("churches_stpaul_west.png", at(Fp, -30, -6, 1.7), at(Fp, 10, 0, 14), 16),
              ("churches_stpaul_side.png", at(Fp, 18, Sp + 30, 1.7), at(Fp, 26, 0, 12), 16),
              ("churches_stpaul_above.png", at(Fp, -45, 60, 65), at(Fp, Dp / 2, 0, 10), 26),
              ("churches_stpaul_tower.png", at(Fp, 42, 34, 16), at(Fp, 55.5, 9.5, 32), 24)]
    fj = dict(L["stjacob"]["frame"], _west=True)
    Fj, Dj, Sj = frame_west_end(fj)
    views += [("churches_stjacob_square.png", at(Fj, 46, -Sj - 30, 1.7), at(Fj, 46, 0, 20), 15),
              ("churches_stjacob_west.png", at(Fj, -34, 8, 1.7), at(Fj, 8, 0, 22), 15),
              ("churches_stjacob_side.png", at(Fj, 18, -Sj - 32, 1.7), at(Fj, 30, 0, 14), 15),
              ("churches_stjacob_above.png", at(Fj, -50, -70, 80), at(Fj, Dj / 2, 0, 10), 26),
              ("churches_stjacob_east.png", at(Fj, Dj + 40, 30, 28), at(Fj, Dj - 20, 0, 14), 22)]
    pk = city["decor"]["park"]["outline"]
    px = sum(p[0] for p in pk) / len(pk)
    pz = sum(p[1] for p in pk) / len(pk)
    views += [("churches_park_above.png", (px + 40, 70, pz - 60), (px, 0, pz + 5), 24),
              ("churches_park_eye.png", (px + 30, 1.7, pz - 26), (px - 5, 0.5, pz + 5), 20),
              ("churches_park_bridge.png", (px - 2, 3.0, pz - 14), (px + 12, 0.3, pz - 14), 24),
              ("churches_park_wallcorner.png", None, None, 24),
              ("churches_park_wallcheck.png", (-300.0, 1.7, 312.0), (-308.0, 0.5, 326.0), 18),
              ("churches_park_wallcheck_wide.png", (-300.0, 1.7, 312.0), (-302.0, 2.0, 326.0), 12),
              ("churches_park_wallcheck_top.png", (-303.0, 40.0, 318.0), (-303.0, 0.0, 325.5), 30),
              ("churches_pump.png", (-298.2, 1.5, 252.6), (-300.0, 0.8, 250.0), 30)]
    ww_ = pinfo.get("water_wall") or []
    if len(ww_) == 2:
        (ax0, az0), (bx0, bz0) = ww_
        mx, mz = (ax0 + bx0) / 2, (az0 + bz0) / 2
        tx, tz = bx0 - ax0, bz0 - az0
        ln = math.hypot(tx, tz)
        nx_, nz_ = -tz / ln, tx / ln
        if inside((mx + nx_ * 2, mz + nz_ * 2), park_ring) is False:
            nx_, nz_ = -nx_, -nz_
        views = [(n_, e_, l_, le_) if n_ != "churches_park_wallcorner.png" else
                 (n_, (mx + nx_ * 11 + tx / ln * 7, 3.2, mz + nz_ * 11 + tz / ln * 7), (mx - tx / ln * 1.5, 0.2, mz - tz / ln * 1.5), le_)
                 for n_, e_, l_, le_ in views]
    views = [v for v in views if v[1] is not None]
    for name, eye, look, lens in views:
        if only and not any(o in name for o in only):
            continue
        for o in ctx_objs:
            o.hide_render = eye[1] < 5 and "carolus" not in name and "park" not in name
        shot(cam, name, eye, look, lens)


def fill_check(g, city):
    """How much of each church's rectangle (the walk map's solid) its walls close off at 1 m over the
    street: a flood fill from outside through the plan cut of the walls; what it reaches inside the
    rectangle is ground the walk map calls solid but the eye sees open."""
    for name in ("carolus", "stpaul", "stjacob"):
        fr = city["landmarks"][name]["frame"]
        faces = g.groups.get("church_" + name, [])
        c, ax, nn, L, W = fr["c"], fr["ax"], fr["n"], fr["L"], fr["W"]
        res = 0.25
        nu, nv = int((L + 6) / res), int((W + 6) / res)
        wall_ = np.zeros((nu, nv), bool)

        def loc(x, z):
            dx, dz = x - c[0], z - c[1]
            return (dx * ax[0] + dz * ax[1] + L / 2 + 3) / res, (dx * nn[0] + dz * nn[1] + W / 2 + 3) / res

        for pts, _, _, _ in faces:
            ys = [p.y for p in pts]
            if not (min(ys) < 1.0 < max(ys)):
                continue
            cut = []
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                if (a.y - 1.0) * (b.y - 1.0) < 0:
                    t = (1.0 - a.y) / (b.y - a.y)
                    cut.append((a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))
            if len(cut) < 2:
                continue
            (x0, z0), (x1, z1) = cut[0], cut[1]
            u0, v0 = loc(x0, z0)
            u1, v1 = loc(x1, z1)
            n = int(max(abs(u1 - u0), abs(v1 - v0)) * 2) + 2
            for k in range(n + 1):
                uu, vv = u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n
                iu, iv = int(uu), int(vv)
                if 0 <= iu < nu and 0 <= iv < nv:
                    wall_[iu, iv] = True
        seen = np.zeros_like(wall_)
        stack = [(0, 0)]
        seen[0, 0] = True
        while stack:
            i, j = stack.pop()
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = i + di, j + dj
                if 0 <= a < nu and 0 <= b < nv and not seen[a, b] and not wall_[a, b]:
                    seen[a, b] = True
                    stack.append((a, b))
        m = int(3 / res)
        rect_seen = seen[m:nu - m, m:nv - m]
        open_frac = rect_seen.mean()
        # the open cells more than 1 m inside the rectangle (the walk map keeps 0.8 m anyway)
        k1 = int(1.0 / res)
        deep = rect_seen[k1:-k1, k1:-k1]
        where = ""
        if deep.any():
            iu, iv = np.nonzero(deep)
            u_ = (iu + k1) * res - L / 2
            v_ = (iv + k1) * res - W / 2
            xs_ = c[0] + ax[0] * u_ + nn[0] * v_
            zs_ = c[1] + ax[1] * u_ + nn[1] * v_
            where = f" (around x {xs_.min():.1f}..{xs_.max():.1f}, z {zs_.min():.1f}..{zs_.max():.1f})"
        print(f"[build_churches] fill {name}: {100 * (1 - open_frac):.1f}% of the rectangle closed; "
              f"{deep.sum() * res * res:.1f} m2 open more than 1 m inside{where}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(CITY) as f:
        city = json.load(f)
    make_materials()
    g = Geo()
    L = city["landmarks"]
    carolus(g, L["carolus"]["frame"])
    stpaul(g, L["stpaul"]["frame"])
    stjacob(g, L["stjacob"]["frame"])
    info, stats, park_ring, pond = park(g, city)
    pump(g)
    fill_check(g, city)
    objs = g.to_objects()
    export()
    with open(PARK_JSON, "w", newline="\n") as f:
        json.dump(info, f, separators=(",", ":"))
    total = 0
    for nme in sorted(objs):
        c = tris(objs[nme])
        total += c
        mats = ", ".join(m.name for m in objs[nme].data.materials)
        print(f"[build_churches] {nme:16s} {c:6d} tris  [{mats}]")
    print(f"[build_churches] {len(objs)} objects, {total} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    print(f"[build_churches] park: {stats}; pumps in city.json: {len(city.get('alleys', {}).get('pumps', []))} -> {PARK_JSON}")
    if "--preview" in argv:
        i = argv.index("--preview")
        only = argv[i + 1].split(",") if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        preview(city, objs, park_ring, pond, only, "--context" in argv, info)
    if "--nocheck" not in argv:
        plane_check(OUT)


if __name__ == "__main__":
    main()

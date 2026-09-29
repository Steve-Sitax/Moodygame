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
  park            the Stadspark (1867-69): the pond (a bank of earth and stones, the water at y -0.35,
                  material park_water) with a small island, Keilig's iron suspension footbridge (1869,
                  white, its ends in rocaille) over its narrow waist, benches and park lanterns along
                  the gravel paths (decor.park.lines, tools/city/park.py), the iron railing on a stone
                  kerb with three openings toward the streets
  pump            a cast-iron town pump on a stone base with a stone trough

Materials (a small texture each, painted below, nearest filter; vertex colour "Col" carries the
shade: darker at the foot and in reveals):
  church_stone (pale sandstone), church_greystone (grey Brabant stone), church_brick,
  church_slate, church_lead (domes, bulbs, flat roofs), church_atlas (windows with their tracery,
  doors, louvres, niches with statues, the IHS medallion, clock faces; each opening maps one cell),
  park_stone (blue-grey stone), park_water, park_iron (drawn double-sided: the railing's pickets are
  single faces), park_wood, park_lamp_glow (lantern glass: the game draws it bright), park_bank (the
  pond's earth bank and the island), park_rock (rocaille and bank stones), park_iron_white (the bridge).
One texture scale per tiling material (TILE); atlas cells are fitted per opening.

No two faces in one plane: where two masses meet, the one behind has no face there; relief (bands,
buttresses, columns) is sunk into its wall; nothing lies flat at y 0 (the game's ground). The check
runs on the exported glb (it prints any pair it finds).

--preview renders data/shots/churches_*.png; --context also loads city.glb and wall.glb round them.
"""

import json
import math
import os
import random
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
        "park_stone", "park_water", "park_iron", "park_wood", "park_lamp_glow",
        "carolus_sand", "carolus_blue", "carolus_art", "church_gilt", "carolus_pale", "pj_brick", "pj_white", "pj_brabant",
        "park_bank", "park_rock", "park_iron_white", "church_atlas_lit"]
(STONE, GREY, BRICK, SLATE, LEAD, ATLAS, PSTONE, WATER, IRON, WOOD, GLOW, SAND, BLUE, ART, GILT, PALE, PBRICK, PWHITE,
 PBRAB, BANK, ROCK, WIRON, ALIT) = range(len(MATS))
# Issue #10 (interiors are real, docs/building-with-interior.md): the windows over the three churches' halls are cut
# through. Their stone mullions and a few iron saddle bars stay in the shell (glazing()); their painted panes (the
# atlas cells, as before) go to a mesh of their own per church, "church_<id>_lit_glass" with the material
# church_atlas_lit (the same picture), that the street never draws: the hall behind takes a copy as its own stained
# glass (world/shellGlass.ts), world/landmarkWindows.ts lights a copy of it at night. Each real opening (and each
# church's open door) is written twice: an empty "opening_<id>" in the glb and a row of shared/churchesShell.ts.
SHELL_TS = os.path.join(ROOT, "shared", "churchesShell.ts")
# metres per texture repeat (u, v); carolus_sand and carolus_blue take pictures in the game (world/churches.ts:
# client/public/textures/carolus_sandstone.jpg, carolus_bluestone.jpg), one repeat each
TILE = {STONE: (2.4, 2.4), GREY: (2.4, 2.4), BRICK: (2.4, 1.8), SLATE: (1.6, 1.6), LEAD: (0.8, 0.8), ATLAS: (1.0, 1.0),
        PSTONE: (1.2, 1.2), WATER: (2.0, 2.0), IRON: (1.0, 1.0), WOOD: (1.2, 1.2), GLOW: (1.0, 1.0),
        SAND: (3.6, 3.6), BLUE: (3.0, 3.0), ART: (1.0, 1.0), GILT: (0.6, 0.6), PALE: (1.2, 1.2),
        PBRICK: (2.0, 2.0), PWHITE: (3.2, 3.2), PBRAB: (3.4, 3.4), BANK: (1.6, 1.6), ROCK: (1.4, 1.4), WIRON: (1.0, 1.0),
        ALIT: (1.0, 1.0)}
ART_DIR = os.path.join(ROOT, "tools", "blender", "art")

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
    # the park pass (2026-09-26): still pond water shows its ripples faintly (they were bright bands)
    img[rip > 0.9] = C(0.17, 0.23, 0.22)
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


def paint_bank(rng, n=64):
    """The pond's bank (the park pass, 2026-09-26): wet dark earth trodden by ducks, tufts of grass, a few
    fallen leaves and pebbles."""
    nz = noise2(rng, n, n, 6, 6)
    fine = noise2(rng, n, n, 24, 24)
    img = np.ones((n, n, 3)) * C(0.23, 0.19, 0.14)
    img *= (0.8 + 0.35 * nz * (0.7 + 0.3 * fine))[..., None]
    grass = (nz > 0.52) & (rng.random((n, n)) < 0.55)
    img[grass] = C(0.26, 0.31, 0.15) * rng.uniform(0.75, 1.2, (int(grass.sum()), 1))
    for _ in range(26):  # grass blades: short upright strokes (v up the bank)
        x, y = int(rng.integers(0, n)), int(rng.integers(0, n))
        for k in range(int(rng.integers(2, 5))):
            img[(y + k) % n, x % n] = C(0.34, 0.38, 0.18) * rng.uniform(0.8, 1.15)
    for _ in range(14):  # leaves: yellow, rust
        x, y = int(rng.integers(0, n - 2)), int(rng.integers(0, n - 2))
        col = [C(0.62, 0.45, 0.14), C(0.52, 0.26, 0.10), C(0.40, 0.28, 0.13)][int(rng.integers(0, 3))]
        img[y:y + 2, x:x + 2] = col
    for _ in range(18):  # pebbles
        x, y = int(rng.integers(0, n)), int(rng.integers(0, n))
        img[y, x] = C(0.46, 0.44, 0.40) * rng.uniform(0.8, 1.1)
    return speckle(img, rng, 0.08, 0.7, 0.95)


def paint_rock(rng, n=64):
    """Artificial rock (rocaille): lumps of rough grey-brown stone with dark cracks, lichen and soot."""
    big = noise2(rng, n, n, 5, 5)
    mid = noise2(rng, n, n, 11, 11)
    fine = noise2(rng, n, n, 32, 32)
    img = np.ones((n, n, 3)) * C(0.43, 0.41, 0.37)
    img *= (0.72 + 0.34 * big + 0.12 * fine)[..., None]
    crack = np.abs(mid - 0.5) < 0.035
    img[crack] *= 0.45
    lich = (big > 0.62) & (fine > 0.45)
    img[lich] = img[lich] * 0.5 + C(0.44, 0.47, 0.33) * 0.5
    moss = (big < 0.3) & (fine > 0.5)
    img[moss] = img[moss] * 0.45 + C(0.20, 0.26, 0.12) * 0.55
    return speckle(img, rng, 0.1, 0.7, 1.1)


def paint_iron_white(rng, n=32):
    """Iron painted white in 1869, four winters of coal smoke on it: off-white, grey soot, rust at the joints."""
    img = np.ones((n, n, 3)) * C(0.74, 0.73, 0.69)
    img *= (0.8 + 0.25 * noise2(rng, n, n, 4, 4))[..., None]
    soot = noise2(rng, n, n, 3, 8) > 0.62
    img[soot] *= 0.72
    rust = rng.random((n, n)) < 0.03
    img[rust] = C(0.45, 0.28, 0.16)
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
    """uv of a point in an atlas cell: the churches' atlas (CELL) or the Carolus front's (ART_CELL)."""
    x0, y0, w, h, shape = CELL[name] if name in CELL else ART_CELL[name]
    size = AT if name in CELL else AT2
    hh = head_h(shape, w)
    u = x0 + 0.5 + fu * (w - 1)
    if part == "body":
        v = y0 + 0.5 + fv * (h - hh - 0.5)
    elif part == "head":
        v = y0 + (h - hh) + fv * (hh - 0.5)
    else:
        v = y0 + 0.5 + fv * (h - 1)
    return (u / size, v / size)


def cell_mat(name):
    return ART if name in ART_CELL else ATLAS


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
    # no hands: the game's live hands show its time (clock_mark, client/src/world/clockHands.ts)
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


# ---- the Carolus front's atlas: the pediment's relief and the IHS medallion (pictures made with Codex,
# tools/blender/art, assets/ATTRIBUTION.md), the carved doors, niches, windows

AT2 = 512
ART_CELL = {
    "relief": (0, 320, 512, 192, "rect"),
    "c_ihs": (0, 64, 256, 256, "rect"),
    "door_main": (256, 0, 96, 160, "round"),
    "door_side": (352, 0, 64, 128, "rect"),
    "niche_back": (416, 0, 48, 112, "round"),
    "win_rect": (464, 0, 48, 96, "rect"),
    "a_gilt": (256, 160, 16, 16, "rect"),
    "a_dark": (272, 160, 16, 16, "rect"),
}


def load_picture(name, w, h):
    """A picture from tools/blender/art as an array (rows from the bottom), w x h."""
    path = os.path.join(ART_DIR, name)
    img = bpy.data.images.load(path)
    img.scale(w, h)
    a = np.array(img.pixels[:], dtype=np.float64).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    return a


def paint_door_main(rng, w=96, h=160):
    """The great west door: two oak leaves with raised panels and nail heads; over the transom the
    carved radiant sun of the door's soffit (a fan of wooden rays), all dark with age."""
    hh = w / 2
    hb = int(round(h - hh))
    img = np.ones((h, w, 3)) * C(0.30, 0.29, 0.28)
    yy, xx = np.mgrid[0:h, 0:w]
    wood = C(0.22, 0.13, 0.075)
    grain = noise2(rng, h, w, 16, 5)
    leaf = np.ones((h, w, 3)) * wood * (0.78 + 0.4 * grain)[..., None]
    for lx0 in (3, w // 2 + 1):
        lw = w // 2 - 4
        for p0, p1 in ((5, hb * 0.26), (hb * 0.3, hb * 0.62), (hb * 0.66, hb - 6)):
            p0, p1 = int(p0), int(p1)
            leaf[p0:p1, lx0 + 3:lx0 + lw - 3] *= 1.14
            leaf[p1 - 1:p1, lx0 + 3:lx0 + lw - 3] = wood * 1.6
            leaf[p0:p1, lx0 + 3] = wood * 1.45
            leaf[p0:p0 + 1, lx0 + 3:lx0 + lw - 3] = wood * 0.45
            leaf[p0:p1, lx0 + lw - 4] = wood * 0.5
            # a lozenge on each panel
            cy, cx = (p0 + p1) / 2, lx0 + lw / 2
            d = np.abs(xx + 0.5 - cx) / (lw * 0.3) + np.abs(yy + 0.5 - cy) / ((p1 - p0) * 0.32)
            leaf[(d < 1.0) & (d > 0.78)] = wood * 0.55
        for y in range(8, hb - 4, 10):
            for x in (lx0 + 1, lx0 + lw - 1):
                leaf[y, x] = C(0.10, 0.10, 0.10)
    leaf[:, w // 2 - 1:w // 2 + 1] = C(0.05, 0.035, 0.025)
    for cx in (w // 2 - 6, w // 2 + 5):
        dd = np.hypot(xx + 0.5 - cx, yy + 0.5 - hb * 0.47)
        leaf[(dd > 2.0) & (dd < 3.4)] = C(0.07, 0.07, 0.07)
    body = yy < hb
    img[body] = leaf[body]
    # the transom and the carved sun above it
    img[(yy >= hb) & (yy < hb + 4)] = C(0.16, 0.10, 0.06)
    head = (yy >= hb + 4) & (np.hypot(xx + 0.5 - w / 2, yy + 0.5 - hb) <= hh)
    ang = np.arctan2(yy + 0.5 - hb - 4, xx + 0.5 - w / 2)
    r = np.hypot(xx + 0.5 - w / 2, yy + 0.5 - hb - 4)
    rays = ((ang / math.pi * 18) % 1.0) < 0.5
    sun = np.ones((h, w, 3)) * C(0.12, 0.075, 0.045)
    sun[rays] = C(0.25, 0.16, 0.09)
    sun[r < 11] = C(0.36, 0.26, 0.12)
    sun[np.abs(r - 11) < 1.0] = C(0.10, 0.06, 0.04)
    sun[np.abs(r - hh + 3) < 1.2] = C(0.18, 0.11, 0.07)
    img[head] = sun[head]
    return img


def paint_door_side(rng, w=64, h=128):
    wood = C(0.23, 0.14, 0.08)
    grain = noise2(rng, h, w, 14, 4)
    img = np.ones((h, w, 3)) * wood * (0.8 + 0.38 * grain)[..., None]
    tb = int(h * 0.78)
    for lx0 in (2, w // 2 + 1):
        lw = w // 2 - 3
        for p0, p1 in ((4, tb * 0.45), (tb * 0.5, tb - 4)):
            p0, p1 = int(p0), int(p1)
            img[p0:p1, lx0 + 2:lx0 + lw - 2] *= 1.15
            img[p1 - 1, lx0 + 2:lx0 + lw - 2] = wood * 1.6
            img[p0, lx0 + 2:lx0 + lw - 2] = wood * 0.45
            img[p0:p1, lx0 + 2] = wood * 1.4
            img[p0:p1, lx0 + lw - 3] = wood * 0.5
    img[:tb, w // 2 - 1:w // 2 + 1] = C(0.05, 0.035, 0.025)
    img[tb:tb + 3] = C(0.14, 0.09, 0.05)
    gl = leaded(rng, h - tb - 3, w - 6, C(0.10, 0.12, 0.14), C(0.04, 0.04, 0.045), 5, rect=True)
    img[tb + 3:h, 3:w - 3] = gl
    img[tb + 3:h, w // 2 - 1:w // 2 + 1] = C(0.14, 0.09, 0.05)
    return img


def paint_niche_back(rng, w=48, h=112):
    """The back of a statue's niche: dark stone, the shell in its head."""
    hh = w / 2
    hb = h - hh
    img = np.ones((h, w, 3)) * C(0.40, 0.38, 0.34)
    yy, xx = np.mgrid[0:h, 0:w]
    img *= (0.55 + 0.35 * (1 - np.abs(xx + 0.5 - w / 2) / (w / 2)))[..., None]
    img *= (1.0 - 0.25 * (yy / h))[..., None]
    ang = np.arctan2(yy + 0.5 - hb, xx + 0.5 - w / 2)
    r = np.hypot(yy + 0.5 - hb, xx + 0.5 - w / 2)
    rib = (yy >= hb) & (((ang / math.pi * 11) % 1.0) < 0.42)
    img[rib] *= 1.45
    img[(yy >= hb) & (r < 5)] = C(0.30, 0.28, 0.25)
    img[(yy >= hb - 2) & (yy < hb)] = C(0.52, 0.50, 0.45)
    return img * (0.92 + 0.1 * rng.random((h, w, 1)))


def paint_win_rect(rng, w=48, h=96):
    """A window with a stone cross (mullion and transom) and four leaded lights."""
    stone = C(0.50, 0.52, 0.54)
    img = np.ones((h, w, 3)) * stone
    gl = leaded(rng, h, w, C(0.12, 0.15, 0.17), C(0.04, 0.04, 0.045), 4)
    gl *= (0.7 + 0.6 * (np.arange(h) / h))[:, None, None]
    m = np.zeros((h, w), bool)
    m[2:h - 2, 2:w - 2] = True
    ty = int(h * 0.66)
    m[ty - 2:ty + 2, :] = False
    m[:, w // 2 - 2:w // 2 + 2] = False
    img[m] = gl[m]
    img[np.roll(~m, 1, 1) & m] *= 0.55
    return img


def paint_art(rng):
    A = np.ones((AT2, AT2, 3)) * C(0.3, 0.29, 0.27)

    def put(name, img):
        x0, y0, w, h, _ = ART_CELL[name]
        A[y0:y0 + h, x0:x0 + w] = np.clip(img, 0, 1)

    rel = load_picture("carolus_relief.jpg", 512, 192)
    put("relief", np.clip((rel - rel.mean()) * 1.4 + rel.mean() * 1.15, 0, 1))
    put("c_ihs", load_picture("carolus_ihs.jpg", 256, 256))
    put("door_main", paint_door_main(rng))
    put("door_side", paint_door_side(rng))
    put("niche_back", paint_niche_back(rng))
    put("win_rect", paint_win_rect(rng))
    for name, col in (("a_gilt", C(0.74, 0.57, 0.24)), ("a_dark", C(0.03, 0.03, 0.035))):
        x0, y0, w, h, _ = ART_CELL[name]
        A[y0:y0 + h, x0:x0 + w] = col
    return A


def paint_pale(rng, n=64):
    """The statues' stone: pale, smooth, no joints; a little grey in the hollows."""
    img = np.ones((n, n, 3)) * C(0.86, 0.82, 0.74)
    img *= (0.88 + 0.16 * noise2(rng, n, n, 6, 6))[..., None]
    img *= (0.95 + 0.06 * noise2(rng, n, n, 16, 16))[..., None]
    return speckle(img, rng, 0.04, 0.8, 0.95)


def paint_gilt(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.70, 0.53, 0.21)
    img *= (0.72 + 0.5 * noise2(rng, n, n, 4, 4))[..., None]
    img *= (1.0 - 0.3 * noise2(rng, n, n, 2, 9))[..., None]  # soot running down
    return speckle(img, rng, 0.08, 0.55, 0.8)


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
        "carolus_sand": lambda: paint_ashlar(rng, 128, C(0.74, 0.68, 0.55), C(0.60, 0.56, 0.48), 13, 22, 44),
        "carolus_blue": lambda: paint_ashlar(rng, 128, C(0.44, 0.47, 0.50), C(0.58, 0.58, 0.57), 16, 30, 60, streaks=0.1),
        "carolus_art": lambda: paint_art(rng),
        "church_gilt": lambda: paint_gilt(rng),
        "carolus_pale": lambda: paint_pale(rng),
        "pj_brick": lambda: paint_brick(rng),
        "pj_white": lambda: paint_ashlar(rng, 128, C(0.80, 0.78, 0.74), C(0.66, 0.64, 0.60), 14, 24, 44),
        "pj_brabant": lambda: paint_ashlar(rng, 128, C(0.66, 0.62, 0.55), C(0.54, 0.51, 0.46), 12, 22, 46, streaks=0.1),
        # the park pass (2026-09-26): a new generator each, so the older textures above stay as they were
        "park_bank": lambda: paint_bank(np.random.default_rng(1868)),
        "park_rock": lambda: paint_rock(np.random.default_rng(1869)),
        "park_iron_white": lambda: paint_iron_white(np.random.default_rng(1870)),
    }
    for name in MATS:
        if name == "church_atlas_lit":
            # (issue #10: the real windows' old panes keep the atlas's own picture; nothing new is painted, so the
            # random pictures of the others stay as they were)
            img = bpy.data.images["church_atlas_tex"]
        else:
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
        m.use_backface_culling = name not in ("park_iron", "park_iron_white")


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
        self.grime = None  # (p) -> a shade factor for walls shaded by height (the Carolus: soot, damp)

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
            elif mat == ART:
                uvs = [cell_uv(cell or "a_dark", 0.5, 0.5)] * len(pts)
            else:
                uvs = planar(pts, n, mat)
        if shade is None:
            cols = [amb(p, floor) * k * (self.grime(p) if self.grime else 1.0) for p in pts]
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
        # issue #10: a real opening (a hall behind it): its human label, window or door, its lights, stained colour
        self.real, self.kind, self.lights, self.colour = None, "window", 1, False


def real(h, label, kind="window", lights=1, colour=False):
    """Mark a hole as a real opening of the hall behind it (issue #10)."""
    h.real, h.kind, h.lights, h.colour = label, kind, lights, colour
    return h


# ---- real openings (issue #10)
OPENINGS = []
CHURCH_OF = {"church_carolus": "carolus", "church_stpaul": "stpaul", "church_stjacob": "stjacob"}
ID_OF = {"carolus": "cb", "stpaul": "sp", "stjacob": "sj"}


def real_opening(W, h, outline):
    """Record a real opening of a wall W (outline (u, y) where the reveal ends, from the bottom left)."""
    um = (h.u0 + h.u1) / 2
    x, _, z = W.pt(um, 0.0)
    OPENINGS.append(dict(church=CHURCH_OF[W.g.grp], part=W.g.grp, kind=h.kind, label=h.real, glaze="lead" if h.kind == "window" else "", shape="rect",
                         x=x, z=z, tx=W.t.x, tz=W.t.y, nx=W.n.x, nz=W.n.y, hw=(h.u1 - h.u0) / 2, yb=h.yb, yt=max(y for _, y in outline),
                         arch=False, depth=h.depth, poly=[(u - um, y) for u, y in outline], lights=h.lights, colour=h.colour))


def glazing(W, h, ys):
    """A real window's iron in the shell (issue #10): saddle bars across it every 0.62 m under its head (the stone
    mullions are gwin's), and a slim iron mullion up the middle of a window that has none of stone; a little in front
    of the glass (the hall's, at the reveal's back)."""
    g = W.g
    d = h.depth - 0.04
    w = h.u1 - h.u0
    top = ys if ys is not None else h.yt
    n = max(1, int((top - h.yb - 0.25) / 0.62))
    for i in range(1, n + 1):
        y = h.yb + (top - h.yb) * i / (n + 1)
        # (not at the interior check's sight lines through it, dev/interiorcheck.ts: 0.18 and 0.54 of its height)
        for f in (0.18, 0.54):
            if abs(y - (h.yb + f * (h.yt - h.yb))) < 0.06:
                y += 0.12
        # (none along gwin's stone transom)
        if h.lights >= 2 and ys is not None and ys - h.yb > 3.2 and abs(y - (h.yb + (ys - h.yb) * 0.48)) < 0.16:
            continue
        bar(g, W.pt(h.u0 + 0.004, y, d), W.pt(h.u1 - 0.004, y, d), 0.03, IRON, skip_ends=True, shade=0.55)
    if h.lights <= 1 and w > 0.7:
        um = (h.u0 + h.u1) / 2
        bar(g, W.pt(um, h.yb + 0.004, d - 0.02), W.pt(um, h.yt - 0.02, d - 0.02), 0.045, IRON, skip_ends=True, shade=0.55)


def opening_markers():
    """Every real opening as an empty in the glb (dev/interiorcheck.ts reads them) and shared/churchesShell.ts."""
    count = {}
    for o in OPENINGS:
        c = o["church"]
        o["id"] = f"{ID_OF[c]}_{count.get(c, 0):03d}"
        count[c] = count.get(c, 0) + 1
        ob = bpy.data.objects.new("opening_" + o["id"], None)
        ob.empty_display_size = max(0.2, o["hw"])
        ob.location = B((o["x"], (o["yb"] + o["yt"]) / 2, o["z"]))
        for k in ("kind", "label", "glaze", "shape", "church", "part"):
            ob[k] = str(o[k])
        for k in ("hw", "yb", "yt", "nx", "nz", "tx", "tz", "depth"):
            ob[k] = float(o[k])
        ob["arch"] = 0
        bpy.context.scene.collection.objects.link(ob)
    f3 = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")  # noqa: E731
    lines = [
        "// GENERATED by tools/blender/build_churches.py (issue #10, interiors are real): do not edit. Every real opening of the",
        "// three churches' shells (client/public/models/churches.glb, whose empties opening_<id> are the same), in the WORLD's",
        "// frame (the halls move them into theirs: shellOpening.ts inFrame). x, z: its middle on the wall's outer face; (tx, tz)",
        "// along it, (nx, nz) out of it; poly its outline where the reveal ends (u along from the middle, world y); depth the",
        "// reveal's depth into the wall. church: whose; lights: its lights (mullions + 1); colour: stained glass in colours.",
        "",
        'import type { ShellOpening } from "./shellOpening.js";',
        "",
        'export type ChurchOpening = ShellOpening & { church: "carolus" | "stpaul" | "stjacob"; lights: number; colour: boolean };',
        "",
        "export const SHELL_OPENINGS: ChurchOpening[] = [",
    ]
    for o in OPENINGS:
        parts_ = []
        for k in ("id", "church", "kind", "part", "label", "glaze", "shape", "x", "z", "tx", "tz", "nx", "nz", "hw", "yb", "yt", "arch", "depth", "lights", "colour"):
            v = o[k]
            parts_.append(f"{k}: {json.dumps(v) if isinstance(v, (str, bool)) else f3(float(v))}")
        parts_.append("poly: [" + ", ".join(f"[{f3(u)}, {f3(y)}]" for u, y in o["poly"]) + "]")
        lines.append("  { " + ", ".join(parts_) + " },")
    lines += ["];", ""]
    with open(SHELL_TS, "w", newline="\n") as f:
        f.write("\n".join(lines))
    return count


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
        if h.real:
            real_opening(self, h, outline)
        if cell == "open":  # a real opening (the Carolus's main door: the hall behind it, the leaves hung in the game)
            return
        # issue #10: a real window's pane goes to its church's lit glass (never drawn by the street: the hall's glass)
        mat = ALIT if h.real else cell_mat(cell)
        grp = g.grp
        if h.real:
            g.grp = grp + "_lit_glass"
        part_b = "body" if h.shape != "rect" else "all"
        if ys - h.yb > 1e-4:
            body = [(h.u0, h.yb), (h.u1, h.yb), (h.u1, ys), (h.u0, ys)]
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - h.yb) / (ys - h.yb), part_b) for u, y in body]
            g.face([self.pt(u, y, h.depth) for u, y in body], mat, out=self.out(), uvs=uvs, k=self.k * h.k)
        if arc:
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - ys) / hh, "head") for u, y in arc]
            g.face([self.pt(u, y, h.depth) for u, y in arc], mat, out=self.out(), uvs=uvs, k=self.k * h.k)
        g.grp = grp
        if h.real:
            glazing(self, h, ys if arc else None)


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


# ------------------------------------------------------------------ live clock hands

# Every clock in the game shows the game's time (Steve, 2026-09-26): the dials are painted without hands, and
# the game hangs live hands (client/src/world/clockHands.ts) on an empty named clock_face_<name> at the middle
# of each face: `radius` the face's radius, nx/ny/nz out of the face (game axes), minute/hour/width the hands
# as parts of the radius (the painted marks stand at about 0.69 of it).
CLOCK_MARKS = []


def clock_mark(name, p, out, r, minute=0.64, hour=0.43, width=0.14):
    CLOCK_MARKS.append((name, p, out, r, minute, hour, width))


def clock_markers():
    for name, p, out, r, minute, hour, width in CLOCK_MARKS:
        ob = bpy.data.objects.new("clock_face_" + name, None)
        ob.empty_display_size = r
        ob.location = B(p)
        ob["radius"], ob["minute"], ob["hour"], ob["width"] = float(r), float(minute), float(hour), float(width)
        ob["nx"], ob["ny"], ob["nz"] = float(out[0]), float(out[1]), float(out[2])
        bpy.context.scene.collection.objects.link(ob)
    return len(CLOCK_MARKS)


def disc(g, W, uc, yc, r, cell, d_front=-0.2, d_back=0.05, sides=16, side_mat=STONE, k=1.0, crop=1.0):
    """A round medallion proud of a wall; `crop` < 1 maps only the middle of the cell (its inner circle)."""
    poly = [(uc + r * math.cos(2 * math.pi * i / sides), yc + r * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
    extrude(g, W, poly, d_front, d_back, cell_mat(cell), side_mat=side_mat, k=k,
            front_uv=lambda u, y: cell_uv(cell, 0.5 + (W.fu(u, uc - r, 2 * r) - 0.5) * crop,
                                          0.5 + ((y - yc + r) / (2 * r) - 0.5) * crop))


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


# The Carolus front's numbers, in the frame of frame_front_open (a from the rectangle's front edge inward,
# s along the front, + to the east; the Conscienceplein at a < 0). shared/carolusPlan.ts has the same
# numbers for walking (the terrace, the flights, the railing).
#   FA, FB   the front's face and back (a slab 1 m thick); FT, TB the stair towers' face and back
#   NV, AW, TW  the nave's walls, the aisles' outer walls, the stair towers' outer sides (s)
#   Y0       the terrace and the doors' sills; G0..G2 the ground storey (pedestals, columns, entablature)
#   B1       the band of pedestals and balustrades over it; M1, M2 the middle storey; B2 the second band
#   C1, C2   the crown over the nave; PK the pediment's apex (the front is about 33 m high and 30.6 wide)
CF = dict(FA=0.9, FB=1.9, NV=6.5, AW=12.8, TW=15.3, FT=1.4, TB=4.4, Y0=0.6,
          G0=1.9, G1=10.0, G2=11.7, B1=12.9, M1=19.3, M2=20.8, B2=21.9, C1=27.4, C2=28.7, PK=33.0,
          NE=20.8, RID=25.2, AE=15.4, AH=18.6, LK=10.6,
          TA=-2.2, TS=10.9, RISE=0.15, TREAD=0.3, FLIGHTS=((-2.6, 2.6), (-10.9, -8.4), (8.4, 10.9)),
          DOOR=(3.4, 7.2), SIDE=9.35, END=0.15,
          OPEN=True, CHAPEL=(12.4, 26.2, 10.2))
# OPEN: the main door a real opening and the Lady Chapel's room cut out of the shell (the interior in the game:
# client/src/world/carolusHall.ts); CHAPEL: that room's a0, a1 and its ceiling


def carolus_grime(p):
    """Soot washed down under each cornice, damp at the foot (a shade factor for the Carolus's walls)."""
    y = p[1]
    f = 1.0
    for yc in (CF["G1"], CF["M1"], CF["C1"]):
        d = yc - y
        if 0.0 <= d < 2.4:
            f *= 0.88 + 0.12 * d / 2.4
    if y < 1.8:
        f *= 0.9 + 0.1 * max(0.0, y) / 1.8
    return f


def entab(y0, y1, big=0.72):
    """An entablature's layers: architrave and frieze (sandstone), the cornice's bed (bluestone), its crown."""
    h = y1 - y0
    return [(y0, y0 + 0.3 * h, 0.30, SAND), (y0 + 0.3 * h, y0 + 0.62 * h, 0.24, SAND), (y0 + 0.62 * h, y0 + 0.76 * h, 0.46, BLUE),
            (y0 + 0.76 * h, y1, big, SAND)]


def stack(g, F, a_wall, s0, s1, layers, ress=(), caps=(True, True)):
    """A cornice, entablature or band along the wall a = a_wall (the square in -a), from s0 to s1:
    layers (y0, y1, proj, mat) from the bottom up; ress = (sa, sb, extra): where it breaks forward
    over columns and pilasters. Only the faces one can see: each layer's top and bottom where the
    next layer leaves it."""
    cuts = {s0, s1}
    for sa, sb, _ in ress:
        for v in (sa, sb):
            if s0 < v < s1:
                cuts.add(v)
    cuts = refine(sorted(cuts), SEG)
    segs = []
    for sa, sb in zip(cuts, cuts[1:]):
        if sb - sa < 1e-6:
            continue
        m = (sa + sb) / 2
        segs.append((sa, sb, max([e for ra, rb, e in ress if ra <= m <= rb] + [0.0])))
    n = len(layers)
    for li, (y0, y1, p, mat) in enumerate(layers):
        P = [p + e for _, _, e in segs]
        Pb = [layers[li - 1][2] + e for _, _, e in segs] if li > 0 else [0.0] * len(segs)
        Pa = [layers[li + 1][2] + e for _, _, e in segs] if li < n - 1 else [0.0] * len(segs)
        for j, (sa, sb, e) in enumerate(segs):
            A = a_wall - P[j]
            g.face([F.p(A, sa, y0), F.p(A, sb, y0), F.p(A, sb, y1), F.p(A, sa, y1)], mat, out=F.v(-1, 0))
            if P[j] > Pa[j] + 1e-6:
                Aa = a_wall - Pa[j]
                g.face([F.p(A, sa, y1), F.p(A, sb, y1), F.p(Aa, sb, y1), F.p(Aa, sa, y1)], mat, out=(0, 1, 0))
            if P[j] > Pb[j] + 1e-6:
                Ab = a_wall - Pb[j]
                g.face([F.p(A, sa, y0), F.p(A, sb, y0), F.p(Ab, sb, y0), F.p(Ab, sa, y0)], mat, out=(0, -1, 0), k=0.7)
            if j + 1 < len(segs) and abs(P[j + 1] - P[j]) > 1e-6:
                lo, hi = min(P[j], P[j + 1]), max(P[j], P[j + 1])
                sg = 1 if P[j] > P[j + 1] else -1
                g.face([F.p(a_wall - lo, sb, y0), F.p(a_wall - hi, sb, y0), F.p(a_wall - hi, sb, y1), F.p(a_wall - lo, sb, y1)], mat,
                       out=F.v(0, sg), k=0.85)
        for j, sg, on in ((0, -1, caps[0]), (len(segs) - 1, 1, caps[1])):
            if on:
                s_ = segs[j][0] if sg < 0 else segs[j][1]
                g.face([F.p(a_wall, s_, y0), F.p(a_wall - P[j], s_, y0), F.p(a_wall - P[j], s_, y1), F.p(a_wall, s_, y1)], mat,
                       out=F.v(0, sg), k=0.85)


def pedestal(g, F, a_wall, s, half, dep, y0, y1, mat=BLUE):
    """A pedestal against the wall: base, die, cap."""
    box(g, F, a_wall - dep - 0.07, a_wall, s - half - 0.07, s + half + 0.07, y0, y0 + 0.18, mat, skip=("+a", "-y"))
    box(g, F, a_wall - dep, a_wall, s - half, s + half, y0 + 0.18, y1 - 0.2, mat, skip=("+a", "-y", "+y"))
    box(g, F, a_wall - dep - 0.09, a_wall, s - half - 0.09, s + half + 0.09, y1 - 0.2, y1, mat, skip=("+a",))


def pilaster(g, F, a_wall, s, half, dep, y0, y1, mat=SAND):
    box(g, F, a_wall - dep - 0.06, a_wall, s - half - 0.06, s + half + 0.06, y0, y0 + 0.3, mat, skip=("+a", "-y"))
    box(g, F, a_wall - dep, a_wall, s - half, s + half, y0 + 0.3, y1 - 0.4, mat, skip=("+a", "-y", "+y"))
    box(g, F, a_wall - dep - 0.08, a_wall, s - half - 0.1, s + half + 0.1, y1 - 0.4, y1, mat, skip=("+a", "+y"))


def column(g, F, a_c, s, y0, y1, r, order):
    """A free column of bluestone: square plinth, base, a shaft with entasis, its order's capital; the
    abacus's top is left to the architrave over it."""
    x, _, z = F.p(a_c, s, 0)
    q = r * 1.3
    box(g, F, a_c - q, a_c + q, s - q, s + q, y0, y0 + 0.14, BLUE, skip=("-y",))
    H = y1 - y0
    ch = {"doric": 0.5, "ionic": 0.56, "corinth": 1.05}[order]
    st = H - ch
    L = st - 0.42
    prof = [(r * 1.22, 0.14), (r * 1.16, 0.2), (r * 1.03, 0.27), (r * 1.08, 0.33), (r, 0.42),
            (r, 0.42 + L * 0.33), (r * 0.94, 0.42 + L * 0.72), (r * 0.86, st), (r * 0.94, st + 0.03), (r * 0.94, st + 0.1),
            (r * 0.86, st + 0.13)]
    ab = 1.28
    if order == "doric":
        prof += [(r * 0.9, st + 0.24), (r * 1.18, H - 0.14)]
    elif order == "ionic":
        prof += [(r * 1.02, st + 0.2)]
        ab = 1.36
    else:
        prof += [(r * 0.98, st + 0.45), (r * 1.12, st + 0.78), (r * 1.3, H - 0.14)]
        ab = 1.42
    lathe(g, (x, y0, z), prof, 12, BLUE, rot=math.pi / 12)
    if order == "ionic":
        yb = y0 + st + 0.2
        box(g, F, a_c - 1.12 * r, a_c + 1.12 * r, s - 1.5 * r, s + 1.5 * r, yb, y1 - 0.1, BLUE, skip=("+y",))
        W = Wall(g, F.P(a_c - 1.12 * r, 0.0), F.P(a_c - 1.12 * r, 1.0), F.V(-1, 0), 0, 0, BLUE)
        for sg in (-1, 1):
            cu, cy, rr = s + sg * 1.2 * r, yb + 0.12, 0.3 * r
            poly = [(cu + rr * math.cos(2 * math.pi * i / 8), cy + rr * math.sin(2 * math.pi * i / 8)) for i in range(8)]
            extrude(g, W, poly, -0.07, 0.0, BLUE)
        box(g, F, a_c - ab * r, a_c + ab * r, s - ab * r, s + ab * r, y1 - 0.1, y1, BLUE, skip=("+y",))
    else:
        box(g, F, a_c - ab * r, a_c + ab * r, s - ab * r, s + ab * r, y1 - 0.14, y1, BLUE, skip=("+y",))
    if order == "corinth":
        for i in range(8):
            ang = math.pi / 8 + 2 * math.pi * i / 8
            c_, s_ = math.cos(ang), math.sin(ang)
            bar(g, (x + c_ * r * 0.9, y0 + st + 0.16, z + s_ * r * 0.9), (x + c_ * r * 1.3, y0 + st + 0.62, z + s_ * r * 1.3), 0.16, BLUE,
                h=0.04, k=0.95)


def balustrade(g, F, a_wall, s0, s1, y0, y1, dep=0.42, rail=None):
    """A stone balustrade against the wall: plinth, turned balusters, rail (no end faces: it runs between pedestals)."""
    rail = SAND if rail is None else rail
    box(g, F, a_wall - dep, a_wall, s0, s1, y0, y0 + 0.18, rail, skip=("+a", "-y", "-s", "+s"))
    box(g, F, a_wall - dep - 0.05, a_wall, s0, s1, y1 - 0.16, y1, rail, skip=("+a", "-s", "+s"))
    n = max(1, int((s1 - s0) / 0.34))
    h = (y1 - 0.16) - (y0 + 0.18)
    prof = [(0.1, 0.0), (0.1, 0.1 * h), (0.065, 0.2 * h), (0.14, 0.55 * h), (0.07, 0.86 * h), (0.1, 0.92 * h), (0.1, h)]
    for i in range(n):
        s = s0 + (s1 - s0) * (i + 0.5) / n
        x, _, z = F.p(a_wall - dep / 2, s, 0)
        lathe(g, (x, y0 + 0.18, z), prof, 6, SAND, rot=0.0)


FIG = [(0.17, 0.0), (0.175, 0.04), (0.16, 0.08), (0.14, 0.35), (0.125, 0.58), (0.14, 0.72), (0.155, 0.78), (0.1, 0.815),
       (0.06, 0.83), (0.058, 0.86), (0.075, 0.9), (0.07, 0.955), (0.04, 0.99), (0.0, 1.0)]


def statue(g, F, a, s, y0, h, arm=1, staff=False, k=1.08):
    """A saint in a robe (turned), one arm bent to hold a book or a key, perhaps a staff."""
    x, _, z = F.p(a, s, 0)
    lathe(g, (x, y0, z), [(r * h, y * h) for r, y in FIG], 8, PALE, rot=math.pi / 8, k=k)
    sh = F.p(a - 0.02 * h, s + arm * 0.13 * h, y0 + 0.76 * h)
    el = F.p(a - 0.1 * h, s + arm * 0.12 * h, y0 + 0.6 * h)
    hand = F.p(a - 0.17 * h, s + arm * 0.03 * h, y0 + 0.65 * h)
    bar(g, sh, el, 0.05 * h, PALE, k=k)
    bar(g, el, hand, 0.045 * h, PALE, k=k)
    bar(g, F.p(a - 0.18 * h, s, y0 + 0.6 * h), F.p(a - 0.18 * h, s, y0 + 0.71 * h), 0.08 * h, PALE, h=0.03 * h, k=k * 0.92)
    if staff:
        bar(g, F.p(a - 0.1 * h, s - arm * 0.17 * h, y0), F.p(a - 0.1 * h, s - arm * 0.17 * h, y0 + 1.04 * h), 0.022 * h, PALE, k=k)


def niche_statue(g, F, W, s, yb, depth, h, arm=1, staff=False):
    """A statue on its plinth in a niche (the Hole at s, from yb, `depth` deep)."""
    a = CF["FA"] + depth * 0.45
    box(g, F, CF["FA"], CF["FA"] + depth - 0.05, s - 0.34, s + 0.34, yb, yb + 0.22, SAND, skip=("-y", "+a"), k=0.95)
    statue(g, F, a, s, yb + 0.22, h, arm, staff)


def urn(g, c, sc, mat=SAND, fire=False, **kw):
    """A vase on a pedestal's top (stone), or a gilded fire-pot."""
    prof = [(0.2, 0.0), (0.22, 0.05), (0.12, 0.15), (0.1, 0.24), (0.3, 0.45), (0.34, 0.6), (0.28, 0.78), (0.14, 0.86), (0.17, 0.94)]
    if fire:
        prof += [(0.12, 1.0), (0.2, 1.12), (0.15, 1.3), (0.06, 1.5), (0.0, 1.62)]
    else:
        prof += [(0.08, 1.02), (0.1, 1.1), (0.0, 1.2)]
    lathe(g, c, [(r * sc, y * sc) for r, y in prof], 8, mat, rot=math.pi / 8, **kw)


def pineapple(g, c, sc=1.0):
    prof = [(0.1, 0.0), (0.16, 0.06), (0.24, 0.2), (0.28, 0.42), (0.25, 0.62), (0.16, 0.8), (0.06, 0.88), (0.13, 0.95), (0.05, 1.08),
            (0.0, 1.22)]
    lathe(g, c, [(r * sc, y * sc) for r, y in prof], 8, GILT, rot=0.0)


def gilt_cross(g, x, y, z, h):
    bar(g, (x, y, z), (x, y + h, z), 0.13, GILT, k=1.0, skip=("-y",))
    bar(g, (x - 0.3 * h, y + h * 0.7, z), (x + 0.3 * h, y + h * 0.7, z), 0.24, GILT, h=0.13, k=1.0)


def arch_band(g, W, uc, yb, ys, w, band, d_front, mat=SAND, k=1.0, n=8, jambs=True):
    """The moulded frame round a round-headed opening (w wide, springing at ys): two jambs and the arch."""
    r0, r1 = w / 2, w / 2 + band
    if jambs:
        for sg in (-1, 1):
            u0, u1 = sorted((uc + sg * r0, uc + sg * r1))
            extrude(g, W, [(u0, yb), (u1, yb), (u1, ys), (u0, ys)], d_front, 0.0, mat, k=k, skip_edges=(0, 2))
    for i in range(n):
        t0, t1 = math.pi * i / n, math.pi * (i + 1) / n
        poly = [(uc + r0 * math.cos(t0), ys + r0 * math.sin(t0)), (uc + r1 * math.cos(t0), ys + r1 * math.sin(t0)),
                (uc + r1 * math.cos(t1), ys + r1 * math.sin(t1)), (uc + r0 * math.cos(t1), ys + r0 * math.sin(t1))]
        sk = tuple(e for e, on in ((0, jambs or i > 0), (2, jambs or i < n - 1)) if on)
        extrude(g, W, poly, d_front, 0.0, mat, k=k, skip_edges=sk)


def rect_frame(g, W, uc, w, yb, yt, band, d_front, mat=SAND, ears=0.12):
    """An eared architrave round a rectangular opening."""
    u0, u1 = uc - w / 2, uc + w / 2
    for a_, b_ in ((u0 - band, u0), (u1, u1 + band)):
        extrude(g, W, [(a_, yb), (b_, yb), (b_, yt), (a_, yt)], d_front, 0.0, mat, skip_edges=(0, 2))
    extrude(g, W, [(u0 - band - ears, yt), (u1 + band + ears, yt), (u1 + band + ears, yt + band), (u0 - band - ears, yt + band)],
            d_front * 1.2, 0.0, mat)


def tri_pediment(g, W, uc, hw, yb, h, d_front, mat=SAND, fill=SAND):
    """A small triangular pediment: its tympanum (in shade) and a raking cornice."""
    extrude(g, W, [(uc - hw + 0.15, yb), (uc + hw - 0.15, yb), (uc, yb + h - 0.12)], d_front * 0.5, 0.0, fill, skip_edges=(0,), k=0.82)
    t = 0.2
    chev = [(uc - hw, yb), (uc, yb + h + t * 0.4), (uc + hw, yb), (uc + hw - 0.3, yb), (uc, yb + h - 0.12), (uc - hw + 0.3, yb)]
    extrude(g, W, chev, d_front, 0.0, mat, skip_edges=(2, 5))
    extrude(g, W, [(uc - hw - 0.1, yb - 0.18), (uc + hw + 0.1, yb - 0.18), (uc + hw + 0.1, yb), (uc - hw - 0.1, yb)], d_front, 0.0, mat)


def volute(g, F, sg, c):
    """The great scroll from the crown's side down over the aisle's bay (a plate from the band up,
    its front flush with the front's face), a rolled rim along its top, the two eyes."""
    FA, FB, B2 = c["FA"], c["FB"], c["B2"]
    s_in, s_top, s_eye, r_b, s_out = 6.5, 7.0, 11.25, 0.72, 11.97
    y_hi, y_eye = 26.8, 22.75

    def ytop(s):
        if s <= s_top:
            return y_hi
        if s <= s_eye:
            t = (s - s_top) / (s_eye - s_top)
            return (y_eye + r_b) + (y_hi - y_eye - r_b) * (1 - t) ** 2
        return y_eye + math.sqrt(max(0.0, r_b * r_b - (s - s_eye) ** 2))

    ss = [s_in, s_top] + [s_top + (s_eye - s_top) * i / 8 for i in range(1, 9)] + [s_eye + (s_out - s_eye) * i / 4 for i in range(1, 5)]
    for s0, s1 in zip(ss, ss[1:]):
        y0, y1 = ytop(s0), ytop(s1)
        A, Bq = sg * s0, sg * s1
        g.face([F.p(FA, A, B2), F.p(FA, Bq, B2), F.p(FA, Bq, y1), F.p(FA, A, y0)], SAND, out=F.v(-1, 0), k=0.8)
        g.face([F.p(FB, A, B2), F.p(FB, Bq, B2), F.p(FB, Bq, y1), F.p(FB, A, y0)], SAND, out=F.v(1, 0), k=0.85)
        nrm = F.v(0, sg * (y0 - y1), abs(s1 - s0))
        g.face([F.p(FA, A, y0), F.p(FA, Bq, y1), F.p(FB, Bq, y1), F.p(FB, A, y0)], SAND, out=nrm)
    g.face([F.p(FA, sg * s_out, B2), F.p(FB, sg * s_out, B2), F.p(FB, sg * s_out, y_eye), F.p(FA, sg * s_out, y_eye)], SAND,
           out=F.v(0, sg), k=0.85)
    # the rim: a rolled edge well proud of the plate along its top; an inner line under it; the eyes turned
    # in three steps like a spiral; a row of leaves on the plate. The plate itself stays in shade.
    W = Wall(g, F.P(FA, 0.0), F.P(FA, 1.0), F.V(-1, 0), 0, 0, SAND)
    rim = [s for s in ss if s <= s_eye]
    for i, (s0, s1) in enumerate(zip(rim, rim[1:])):
        y0, y1 = ytop(s0), ytop(s1)
        poly = [(sg * s0, y0 - 0.46), (sg * s1, y1 - 0.46), (sg * s1, y1), (sg * s0, y0)]
        sk = tuple(e for e, on in ((1, i < len(rim) - 2), (3, i > 0)) if on)
        extrude(g, W, poly, -0.52, 0.0, SAND, k=1.12, skip_edges=sk)
    inner = [s for s in ss if s_top + 0.3 <= s <= s_eye - r_b - 0.15]
    for i, (s0, s1) in enumerate(zip(inner, inner[1:])):
        y0, y1 = ytop(s0) - 1.15, ytop(s1) - 1.15
        poly = [(sg * s0, y0 - 0.16), (sg * s1, y1 - 0.16), (sg * s1, y1), (sg * s0, y0)]
        sk = tuple(e for e, on in ((1, i < len(inner) - 2), (3, i > 0)) if on)
        extrude(g, W, poly, -0.24, 0.0, SAND, k=1.08, skip_edges=sk)
    for (cs, cy, rr, dd) in ((s_eye, y_eye, r_b, -0.66), (s_eye, y_eye, r_b * 0.68, -0.82), (s_eye, y_eye, r_b * 0.36, -0.98),
                             (s_top - 0.1, y_hi - 0.62, 0.44, -0.64), (s_top - 0.1, y_hi - 0.62, 0.26, -0.8)):
        poly = [(sg * cs + rr * math.cos(2 * math.pi * i / 14), cy + rr * math.sin(2 * math.pi * i / 14)) for i in range(14)]
        extrude(g, W, poly, dd, 0.0, SAND, k=1.14)
    for j in range(5):
        sc_ = s_top + 0.8 + j * (s_eye - r_b - 1.2 - s_top) / 4
        yc_ = ytop(sc_) - 0.8
        leaf = [(sg * sc_ + 0.26 * math.cos(2 * math.pi * i / 8) * (1.0 if i % 2 else 0.7), yc_ + 0.34 * math.sin(2 * math.pi * i / 8))
                for i in range(8)]
        extrude(g, W, leaf, -0.18, 0.0, SAND, k=1.06)


def angel(g, W, uc, y0, sg, d=-0.5):
    """A kneeling angel in relief beside the medallion (sg: the side), a wing behind, an arm reaching in."""
    def P(pts):
        return [(uc + sg * x, y0 + y) for x, y in pts]
    body = [(0.05, 0.0), (0.45, -0.05), (0.8, 0.2), (0.9, 0.6), (0.72, 1.05), (0.5, 1.35), (0.3, 1.3), (0.15, 0.95), (0.0, 0.5)]
    wing = [(0.55, 1.15), (1.05, 1.95), (1.22, 1.5), (1.08, 0.98), (0.82, 0.82)]
    extrude(g, W, P(wing), d + 0.18, 0.0, PALE, k=1.02)
    extrude(g, W, P(body), d, 0.0, PALE, k=1.08)
    hx, hy = uc + sg * 0.42, y0 + 1.55
    extrude(g, W, [(hx + 0.16 * math.cos(2 * math.pi * i / 10), hy + 0.16 * math.sin(2 * math.pi * i / 10)) for i in range(10)], d - 0.02,
            -0.1, PALE, k=1.1)
    extrude(g, W, P([(0.32, 1.08), (0.4, 1.22), (-0.12, 1.42), (-0.16, 1.3)]), d - 0.06, d + 0.2, PALE, back=True, k=1.08)


def carolus_terrace(g, F, c):
    """The terrace before the front (bluestone slabs at Y0), three flights of steps to the doors, the
    iron railing on a stone kerb with piers between them. The game walks it (shared/carolusPlan.ts)."""
    TA, Y0, TS, R, T = c["TA"], c["Y0"], c["TS"], c["RISE"], c["TREAD"]
    FA = c["FA"]
    nR = round(Y0 / R)
    a_ft = TA - (nR - 1) * T
    ss = refine([-TS, TS], SEG)
    aa = refine([TA, FA], SEG)
    for s0, s1 in zip(ss, ss[1:]):
        for a0, a1 in zip(aa, aa[1:]):
            g.face([F.p(a0, s0, Y0), F.p(a1, s0, Y0), F.p(a1, s1, Y0), F.p(a0, s1, Y0)], BLUE, out=(0, 1, 0))
    fl = sorted(c["FLIGHTS"])
    # the terrace's front: the plinth between the flights, the top riser in them
    edges = [-TS] + [v for f in fl for v in f] + [TS]
    for i, (s0, s1) in enumerate(zip(edges, edges[1:])):
        if s1 - s0 < 1e-6:
            continue
        in_flight = any(f[0] - 1e-6 <= (s0 + s1) / 2 <= f[1] + 1e-6 for f in fl)
        y0 = Y0 - R if in_flight else FOOT
        for a_, b_ in zip(refine([s0, s1], SEG), refine([s0, s1], SEG)[1:]):
            g.face([F.p(TA, a_, y0), F.p(TA, b_, y0), F.p(TA, b_, Y0), F.p(TA, a_, Y0)], BLUE, out=F.v(-1, 0))
    for sg in (-1, 1):
        g.face([F.p(TA, sg * TS, FOOT), F.p(FA, sg * TS, FOOT), F.p(FA, sg * TS, Y0), F.p(TA, sg * TS, Y0)], BLUE, out=F.v(0, sg))
    for s0, s1 in fl:
        for kk in range(nR - 1):
            a0 = a_ft + kk * T
            y0 = FOOT if kk == 0 else kk * R
            g.face([F.p(a0, s0, y0), F.p(a0, s1, y0), F.p(a0, s1, (kk + 1) * R), F.p(a0, s0, (kk + 1) * R)], BLUE, out=F.v(-1, 0), k=0.85)
            g.face([F.p(a0, s0, (kk + 1) * R), F.p(a0, s1, (kk + 1) * R), F.p(a0 + T, s1, (kk + 1) * R), F.p(a0 + T, s0, (kk + 1) * R)],
                   BLUE, out=(0, 1, 0))
        side = [(a_ft, FOOT)]
        for kk in range(nR - 1):
            side += [(a_ft + kk * T, (kk + 1) * R), (a_ft + (kk + 1) * T, (kk + 1) * R)]
        side += [(TA, FOOT)]
        for sg, s_ in ((-1, s0), (1, s1)):
            g.face([F.p(a_, s_, y_) for a_, y_ in side], BLUE, out=F.v(0, sg), k=0.85)
    # the railing: kerb, piers, iron
    ar = TA + 0.15
    e = TS - c["END"]
    runs = [((ar, -8.4), (ar, -2.6)), ((ar, 2.6), (ar, 8.4)), ((ar, -e), (FA - 0.06, -e)), ((ar, e), (FA - 0.06, e))]
    piers = [(ar, -8.4), (ar, -2.6), (ar, 2.6), (ar, 8.4), (ar, -e), (ar, e)]
    for (a0, s0), (a1, s1) in runs:
        if abs(a1 - a0) < 1e-6:
            box(g, F, a0 - 0.13, a0 + 0.13, s0, s1, Y0, Y0 + 0.14, BLUE, skip=("-y",))
        else:
            box(g, F, a0, a1, s0 - 0.13, s0 + 0.13, Y0, Y0 + 0.14, BLUE, skip=("-y",))
        L = math.hypot(a1 - a0, s1 - s0)
        n = max(2, int(L / 0.13))
        for yr in (Y0 + 0.24, Y0 + 0.86):
            bar(g, F.p(a0, s0, yr), F.p(a1, s1, yr), 0.035, IRON, shade=0.9)
        for i in range(1, n):
            t = i / n
            aa_, s_ = a0 + (a1 - a0) * t, s0 + (s1 - s0) * t
            dx, dz = F.V((a1 - a0) / L * 0.011, (s1 - s0) / L * 0.011)
            x, _, z = F.p(aa_, s_, 0)
            yt = Y0 + 0.98
            g.face([(x - dx, Y0 + 0.14, z - dz), (x + dx, Y0 + 0.14, z + dz), (x + dx, yt, z + dz), (x - dx, yt, z - dz)], IRON,
                   out=F.v(-1, 0) if abs(a1 - a0) < 1e-6 else F.v(0, -1), shade=0.9)
            g.face([(x - 3 * dx, yt, z - 3 * dz), (x + 3 * dx, yt, z + 3 * dz), (x, yt + 0.1, z)], IRON,
                   out=F.v(-1, 0) if abs(a1 - a0) < 1e-6 else F.v(0, -1), shade=0.9)
    for a_, s_ in piers:
        box(g, F, a_ - 0.2, a_ + 0.2, s_ - 0.2, s_ + 0.2, Y0, Y0 + 1.0, BLUE, skip=("-y", "+y"))
        box(g, F, a_ - 0.26, a_ + 0.26, s_ - 0.26, s_ + 0.26, Y0 + 1.0, Y0 + 1.12, BLUE)
        x, _, z = F.p(a_, s_, 0)
        lathe(g, (x, Y0 + 1.12, z), [(0.16, 0.0), (0.18, 0.08), (0.1, 0.16), (0.14, 0.28), (0.0, 0.36)], 8, BLUE, rot=math.pi / 8)


def grime_under(ys, foot=True):
    """A shade factor by height: soot washed down under each cornice in `ys`, damp at the foot (modest)."""
    def f(p):
        y = p[1]
        v = 1.0
        for yc in ys:
            d = yc - y
            if 0.0 <= d < 2.0:
                v *= 0.88 + 0.12 * d / 2.0
        if foot and y < 1.8:
            v *= 0.9 + 0.1 * max(0.0, y) / 1.8
        return v
    return f


def pil(g, W, u, w, y0, y1, dep=0.18, mat=SAND, k=1.0, bottom=True):
    """A pilaster strip proud of a wall W (u across, y up)."""
    extrude(g, W, [(u - w / 2, y0), (u + w / 2, y0), (u + w / 2, y1), (u - w / 2, y1)], -dep, 0.03, mat, k=k,
            skip_edges=() if bottom else (0,))


def open_side(P0, P1, outv):
    """For ring_band / ring_stack along an open line P0 -> P1: +1 when `outv` (x, z) is on the right of travel."""
    d = Vector((P1[0] - P0[0], P1[1] - P0[1])).normalized()
    return 1 if d.y * outv[0] - d.x * outv[1] > 0 else -1


def ring_stack(g, pts, layers, closed=True, side=None, caps=(True, True), k=1.0):
    """A cornice or band of several layers round a polygon or along a line (world x, z), mitred at the corners:
    layers (y0, y1, proj, mat) from the bottom up; a ledge only where a layer stands out beyond the next."""
    P = [Vector((p[0], p[1])) for p in pts]
    if closed:
        side = 1 if area2([(p.x, p.y) for p in P]) > 0 else -1
    N, off = offsets(P, closed, side)
    n = len(P)
    ne = n if closed else n - 1
    projs = [l_[2] for l_ in layers]
    for li, (y0, y1, pr, mat) in enumerate(layers):
        below = projs[li - 1] if li > 0 else 0.0
        above = projs[li + 1] if li < len(layers) - 1 else 0.0
        O = [P[j] + off[j] * pr for j in range(n)]
        A = [P[j] + off[j] * above for j in range(n)]
        Bl = [P[j] + off[j] * below for j in range(n)]
        for i in range(ne):
            j, j2 = i, (i + 1) % n
            nv = (N[i].x, 0.0, N[i].y)
            g.face([(O[j].x, y0, O[j].y), (O[j2].x, y0, O[j2].y), (O[j2].x, y1, O[j2].y), (O[j].x, y1, O[j].y)], mat, out=nv, k=k)
            if pr > above + 1e-6:
                g.face([(A[j].x, y1, A[j].y), (A[j2].x, y1, A[j2].y), (O[j2].x, y1, O[j2].y), (O[j].x, y1, O[j].y)], mat, out=(0, 1, 0), k=k)
            if pr > below + 1e-6:
                g.face([(Bl[j].x, y0, Bl[j].y), (Bl[j2].x, y0, Bl[j2].y), (O[j2].x, y0, O[j2].y), (O[j].x, y0, O[j].y)], mat, out=(0, -1, 0),
                       k=k * 0.7)
        if not closed:
            for j, sgn, on in ((0, -1, caps[0]), (n - 1, 1, caps[1])):
                if not on:
                    continue
                d = (P[1] - P[0]).normalized() if j == 0 else (P[-1] - P[-2]).normalized()
                g.face([(P[j].x, y0, P[j].y), (O[j].x, y0, O[j].y), (O[j].x, y1, O[j].y), (P[j].x, y1, P[j].y)], mat,
                       out=(d.x * sgn, 0, d.y * sgn), k=k * 0.85)


def cornice(yt, proj, h=0.62, bed=BLUE):
    """A small cornice ending at yt: a fascia, a bluestone bed moulding, the crown standing out `proj`."""
    return [(yt - h, yt - h * 0.62, proj * 0.55, SAND), (yt - h * 0.62, yt - h * 0.42, proj * 0.3, SAND),
            (yt - h * 0.42, yt - h * 0.26, proj * 0.8, bed), (yt - h * 0.26, yt, proj, SAND)]


def gutter(g, p0, p1, y, outv, off):
    """A lead box gutter under an eave, `off` out from the wall line p0 -> p1 (world x, z)."""
    ox, oz = outv[0] * off, outv[1] * off
    bar(g, (p0[0] + ox, y, p0[1] + oz), (p1[0] + ox, y, p1[1] + oz), 0.2, LEAD, h=0.16, shade=0.8)


def downpipe(g, p, y_top, outv, off=0.16):
    """An iron downpipe from a gutter to a shoe at the foot of the wall."""
    x, z = p[0] + outv[0] * off, p[1] + outv[1] * off
    bar(g, (x, 0.12, z), (x, y_top - 0.3, z), 0.11, IRON, shade=0.85)
    bar(g, (x, y_top - 0.32, z), (x, y_top, z), 0.24, IRON, shade=0.8)
    bar(g, (x, 0.02, z), (x + outv[0] * 0.25, 0.14, z + outv[1] * 0.25), 0.13, IRON, shade=0.8)


def dormer(g, F, a, s_face, sg, y0, w=1.0, h=1.5, back=1.6, mat=SAND, cell="louv_r", shape="round"):
    """A small dormer on a roof slope that rises away from s_face in the -sg direction (sg = the way out):
    its front at s_face, its cheeks going back into the roof, a little gabled lead roof."""
    s_back = s_face - sg * back
    s0_, s1_ = sorted((s_face, s_back))
    W = wall(g, F, (a - w / 2 - 0.12, s_face), (a + w / 2 + 0.12, s_face), (0, sg), y0, y0 + h, mat,
             holes=[Hc(w / 2 + 0.12, w * 0.62, y0 + 0.25, y0 + h - 0.15, shape, cell, depth=0.12, rmat=mat)])
    for sa in (-1, 1):
        wall(g, F, (a + sa * (w / 2 + 0.12), s_face), (a + sa * (w / 2 + 0.12), s_back), (sa, 0), y0 - 0.9, y0 + h, mat, k=0.85)
    gable_roof(g, F.rot(), s0_, s1_, a - w / 2 - 0.12, a + w / 2 + 0.12, y0 + h, y0 + h + 0.55, mat=LEAD, t=0.08, oe=(0.12, 0.12),
               og=(0.1, 0.0) if sg < 0 else (0.0, 0.1), caps=(True, True, sg < 0, sg > 0))
    return W


def ihs_medallion(g, W, uc, yc, R=1.45, rays=True):
    """The IHS medallion (the Codex picture) in gilded rays, proud of a wall."""
    if rays:
        for i in range(24):
            ang = math.pi / 2 + 2 * math.pi * i / 24
            Rr = R * (1.66 if i % 2 == 0 else 1.35)
            cs_, sn_ = math.cos(ang), math.sin(ang)
            poly = [(uc + R * 0.9 * cs_ + 0.12 * R * sn_, yc + R * 0.9 * sn_ - 0.12 * R * cs_), (uc + Rr * cs_, yc + Rr * sn_),
                    (uc + R * 0.9 * cs_ - 0.12 * R * sn_, yc + R * 0.9 * sn_ + 0.12 * R * cs_)]
            extrude(g, W, poly, -0.2, 0.0, GILT)
    disc(g, W, uc, yc, R, "c_ihs", d_front=-0.36, d_back=0.0, sides=20, side_mat=GILT, crop=0.64)


def carolus_sides(g, F, c, D, S, AC, TA0, HE, HR, CE, CR, SE):
    """Every side of the Carolus one sees from the streets round it and from the roofs: the aisles' upper walls
    and the nave's clerestory with pilasters, window surrounds, cornices and gutters; the roofs with their ridges
    and dormers; the apse; the tower behind the choir storey by storey (after the real one: a base with the IHS,
    Doric, Ionic with the sound openings, the lantern with its Serlian openings and angels, the dome with its
    dormers, the small lantern, the cross); the Jesuit house and the Lady Chapel with their fronts, frames,
    cornices, gutters and downpipes; the sacristy and the garden wall."""
    FB, NV, AW, TW, TB, LK, NE, RID, AE, AH, FT = (c[k] for k in ("FB", "NV", "AW", "TW", "TB", "LK", "NE", "RID", "AE", "AH", "FT"))
    OPEN = c.get("OPEN", False)
    # ---- the aisles: the walls, their upper part (seen over the low ranges) with windows, pilasters, a cornice
    g.grime = grime_under((15.1, 20.4))
    win_a = [a for a in (6.4, 10.2, 14.0, 17.8, 21.6, 25.4)]
    # (issue #10: real, the galleries behind them)
    gal = lambda a0, a1, side: [real(Hc(a - a0, 1.7, 11.0, 14.2, "round", "round", depth=0.35), "the Carolus, the %s gallery, window %d" % (side, j + 1))  # noqa: E731
                                for j, a in enumerate(win_a) if a0 + 1.2 < a < a1 - 1.2]
    CH = c.get("CHAPEL")  # the Lady Chapel's room (a0, a1, y1): cut out of the walls it stands in
    for sg in (-1, 1):
        a_end = AC if sg < 0 else TA0
        cuts = [(CH[0] - TB, CH[1] - TB, FOOT - 0.1, CH[2])] if (OPEN and CH and sg > 0) else []
        W = wall(g, F, (TB, sg * AW), (a_end, sg * AW), (0, sg), FOOT, AE, SAND, holes=gal(TB, a_end, "east" if sg > 0 else "west"), cuts=cuts)
        for a in win_a:
            if TB + 1.2 < a < a_end - 1.2:
                arch_band(g, W, a - TB, 11.0, 14.2 - 0.85, 1.7, 0.2, -0.14)
                extrude(g, W, [(a - TB - 1.05, 10.85), (a - TB + 1.05, 10.85), (a - TB + 1.05, 11.0), (a - TB - 1.05, 11.0)], -0.16, 0.0, SAND)
        for a in [TB + 0.55] + [(p + q) / 2 for p, q in zip(win_a, win_a[1:])] + [a_end - 0.55]:
            if TB + 0.3 < a < a_end - 0.3:
                pil(g, W, a - TB, 0.7, LK + 0.03, 14.33, bottom=False)
        p0, p1 = F.P(TB, sg * AW), F.P(a_end, sg * AW)
        outv = F.V(0, sg)
        ring_stack(g, [p0, p1], [(14.35, 14.6, 0.26, SAND), (14.6, 14.8, 0.14, SAND), (14.8, 14.92, 0.3, BLUE), (14.92, 15.1, 0.36, SAND)],
                   closed=False, side=open_side(p0, p1, outv), caps=(False, True))
        # the nave's clerestory over the aisle roof: pilasters on the bays, a cornice under the eave
        a_ne = AC if sg < 0 else TA0
        Wn = wall(g, F, (FB, sg * NV), (a_ne, sg * NV), (0, sg), AH - 0.6, NE, SAND)
        for a in [TB + 0.55] + [(p + q) / 2 for p, q in zip(win_a, win_a[1:])]:
            if a < a_ne - 0.6:
                pil(g, Wn, a - FB, 0.6, AH + 0.03, 19.78, dep=0.16, bottom=False)
        q0, q1 = F.P(FB, sg * NV), F.P(a_ne, sg * NV)
        ring_stack(g, [q0, q1], [(19.8, 20.0, 0.2, SAND), (20.0, 20.12, 0.28, BLUE), (20.12, 20.4, 0.34, SAND)], closed=False,
                   side=open_side(q0, q1, F.V(0, sg)), caps=(False, False))
        gutter(g, F.P(FB + 0.06, sg * (NV + 0.45)), F.P(a_ne - 0.06, sg * (NV + 0.45)), 20.38, (0, 0), 0.0)
        gutter(g, F.P(TB + 0.06, sg * (AW + 0.48)), F.P(a_end - 0.06, sg * (AW + 0.48)), 15.06, (0, 0), 0.0)
    gable_roof(g, F, FB, AC, -NV, NV, NE, RID, oe=(0.4, 0.4), og=(0, 0), caps=(True, True, False, False))
    bar(g, F.p(FB + 0.06, 0, RID + 0.26), F.p(AC, 0, RID + 0.26), 0.26, LEAD, h=0.16, shade=0.85)  # the ridge's lead
    for a in (9.0, 21.0):  # two small dormers each side of the nave roof
        for sg in (-1, 1):
            dormer(g, F, a, sg * 4.35, sg, 22.05, w=0.9, h=1.25, back=1.6)
    lean_to(g, F, FB, AC, -AW, -NV, AE, AH, oe=0.4, og=(0, 0.3), caps=(True, False, True))
    lean_to(g, F, FB, TA0, AW, NV, AE, AH, oe=0.4, og=(0, 0), caps=(True, False, False))
    wall(g, F, (AC, -AW), (AC, -NV), (1, 0), FOOT, AE, SAND, top=[(0, AE), (AW - NV, AH)])
    # ---- the apse: pilasters at its corners, framed windows, the cornice round it
    P = apse_pts(AC, NV)
    for i in range(5):
        a, b = P[i], P[i + 1]
        mid = ((a[0] + b[0]) / 2 - AC, (a[1] + b[1]) / 2)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        W = wall(g, F, a, b, mid, FOOT, NE, SAND,
                 holes=[real(Hc(L / 2, 1.5, 11.0, 18.5, "round", "round", depth=0.4), "the Carolus, the apse, window %d" % i, colour=True)] if 1 <= i <= 3 else [])
        if 1 <= i <= 3:
            arch_band(g, W, L / 2, 11.0, 18.5 - 0.75, 1.5, 0.22, -0.14)
        for u, on in ((0.3, i > 0), (L - 0.3, i < 4)):
            if on:
                pil(g, W, u, 0.5, 3.6, 19.78, dep=0.2)
    AP = [F.P(a, s) for a, s in P]
    ring_stack(g, AP, [(19.8, 20.0, 0.24, SAND), (20.0, 20.12, 0.3, BLUE), (20.12, 20.4, 0.34, SAND)], closed=False,
               side=open_side(AP[1], AP[2], F.V(1, 0)), caps=(False, False))
    apse_roof(g, F, AC, NV, NE, RID, oe=0.4)
    # ---- the tower behind the choir, storey by storey
    a0, a1, s0, s1 = TA0, D - M, NV, AW
    tc = F.P((a0 + a1) / 2, (s0 + s1) / 2)
    T1, T2, T3 = 12.4, 21.4, 30.4  # the tops of the base, the Doric and the Ionic storeys (their entablatures above)
    g.grime = grime_under((T1, T2, T3), foot=True)
    faces = [((a1, s0), (a1, s1), (1, 0)), ((a0, s1), (a0, s0), (-1, 0)), ((a0, s0), (a1, s0), (0, -1)), ((a1, s1), (a0, s1), (0, 1))]
    top_y = T3 + 1.0
    for fi, (A, Bq, out) in enumerate(faces):
        L_ = math.hypot(*(Vector(F.P(*Bq)) - Vector(F.P(*A))))
        holes = [Hc(L_ / 2, 1.6, T2 + 1.9, T2 + 6.6, "round", "louv_r", depth=0.5),
                 Hc(L_ / 2, 1.0, T1 + 2.4, T1 + 5.8, "round", "round", depth=0.4)]
        if fi == 0:
            holes.append(Hc(L_ / 2, 1.0, 3.0, 6.0, "round", "round", depth=0.35))
        W = wall(g, F, A, Bq, out, FOOT, top_y, SAND, holes=holes)
        for (y0, y1, dep) in ((0.9, T1 + 1.0, 0.2), (T1 + 1.02, T2 + 1.0, 0.22), (T2 + 1.02, T3 + 1.0, 0.2)):
            for u in (0.45, L_ - 0.45):
                pil(g, W, u, 0.7, y0, y1 - 1.02, dep=dep)
        arch_band(g, W, L_ / 2, T2 + 1.9, T2 + 6.6 - 0.8, 1.6, 0.22, -0.16)
        arch_band(g, W, L_ / 2, T1 + 2.4, T1 + 5.8 - 0.5, 1.0, 0.18, -0.14)
        disc(g, W, L_ / 2, T3 - 1.3, 0.62, "clock", d_front=-0.14, d_back=0.0, sides=12, side_mat=SAND)
        clock_mark("carolus_%d" % fi, W.pt(L_ / 2, T3 - 1.3, -0.14), W.out(), 0.62)
        if fi == 0:
            arch_band(g, W, L_ / 2, 3.0, 6.0 - 0.5, 1.0, 0.18, -0.14)
            ihs_medallion(g, W, L_ / 2, 9.2, R=1.05)
    sq = rect_pts(F, a0, a1, s0, s1)
    for yt in (T1 + 1.0, T2 + 1.0, T3 + 1.0):
        ring_stack(g, sq, entab(yt - 1.0, yt, big=0.62))
    g.face([F.p(a0, s0, top_y), F.p(a1, s0, top_y), F.p(a1, s1, top_y), F.p(a0, s1, top_y)], LEAD, out=(0, 1, 0))
    # the platform's balustrade and the four angels blowing their horns at its corners
    q = 0.35
    for (A, Bq) in (((a0 + q, s0 + q), (a1 - q, s0 + q)), ((a1 - q, s0 + q), (a1 - q, s1 - q)), ((a1 - q, s1 - q), (a0 + q, s1 - q)),
                    ((a0 + q, s1 - q), (a0 + q, s0 + q))):
        pa, pb = F.p(A[0], A[1], top_y), F.p(Bq[0], Bq[1], top_y)
        L_ = math.hypot(pb[0] - pa[0], pb[2] - pa[2])
        n_ = int((L_ - 1.4) / 0.34)
        for i in range(n_):
            t = (0.7 + (i + 0.5) * (L_ - 1.4) / n_) / L_
            x_, z_ = pa[0] + (pb[0] - pa[0]) * t, pa[2] + (pb[2] - pa[2]) * t
            lathe(g, (x_, top_y, z_), [(0.09, 0.0), (0.06, 0.12), (0.12, 0.4), (0.06, 0.66), (0.09, 0.72)], 6, SAND)
        ta, tb_ = 0.32 / L_, 1 - 0.32 / L_
        bar(g, (pa[0] + (pb[0] - pa[0]) * ta, top_y + 0.8, pa[2] + (pb[2] - pa[2]) * ta),
            (pa[0] + (pb[0] - pa[0]) * tb_, top_y + 0.8, pa[2] + (pb[2] - pa[2]) * tb_), 0.24, SAND, h=0.14)
    for (a_, s_) in ((a0 + q, s0 + q), (a1 - q, s0 + q), (a1 - q, s1 - q), (a0 + q, s1 - q)):
        box(g, F, a_ - 0.3, a_ + 0.3, s_ - 0.3, s_ + 0.3, top_y, top_y + 0.95, SAND, skip=("-y",))
        statue(g, F, a_, s_, top_y + 0.95, 1.7, arm=1 if s_ < (s0 + s1) / 2 else -1)
    # the lantern: an octagon with a Serlian opening on each side (an arch between two narrow lights), pilasters between
    R8 = 2.55
    rot8 = math.pi / 8
    L0, L1 = top_y, top_y + 6.4
    oct_ = poly_walls(g, tc, R8, 8, rot8, L0 - 0.05, L1, SAND,
                      holes=lambda i, L: ([Hc(L / 2, 0.8, L0 + 1.0, L0 + 4.2, "round", "louv_r", depth=0.3),
                                          Hc(L / 2 - 0.62, 0.22, L0 + 1.0, L0 + 3.0, "rect", "louv_r", depth=0.25),
                                          Hc(L / 2 + 0.62, 0.22, L0 + 1.0, L0 + 3.0, "rect", "louv_r", depth=0.25)] if i % 2 == 0 else []))
    for i in range(8):
        am = rot8 + 2 * math.pi * (i + 0.5) / 8
        a_, b_ = oct_[i], oct_[(i + 1) % 8]
        Wl = Wall(g, a_, b_, (math.cos(am), math.sin(am)), 0, 0, SAND)
        if i % 2 == 1:
            pil(g, Wl, Wl.L / 2, 0.5, L0 + 0.1, L1 - 0.92, dep=0.2, mat=BLUE)
        else:
            arch_band(g, Wl, Wl.L / 2, L0 + 1.0, L0 + 4.2 - 0.4, 0.8, 0.09, -0.1)
    ring_stack(g, oct_, entab(L1 - 0.9, L1, big=0.48))
    # the dome with four small dormers, the small lantern, the gilded ball and the cross
    dome = [(R8 * 0.99, 0.0), (2.5, 0.7), (2.2, 1.55), (1.7, 2.3), (1.05, 2.8), (0.72, 2.95)]
    lathe(g, (tc[0], L1 - 0.02, tc[1]), dome, 16, LEAD, rot=rot8 / 2)
    for i in range(4):
        am = 2 * math.pi * i / 4
        cx, cz = tc[0] + math.cos(am) * 2.55, tc[1] + math.sin(am) * 2.55
        Fd = Frame((cx, cz), (-math.cos(am), -math.sin(am)), (-math.sin(am), math.cos(am)))
        box(g, Fd, -0.25, 0.5, -0.32, 0.32, L1 + 0.6, L1 + 1.45, SAND, skip=("-y",), top_mat=LEAD)
        Wd = plane(g, Fd, (-0.25, -0.32), (-0.25, 0.32), (-1, 0))
        disc(g, Wd, 0.32, L1 + 1.02, 0.2, "dark", d_front=-0.09, d_back=0.0, sides=8, side_mat=SAND)
    SL0 = L1 + 2.9
    oct2 = poly_walls(g, tc, 0.72, 8, rot8, SL0 - 0.05, SL0 + 1.9, SAND,
                      holes=lambda i, L: [Hc(L / 2, 0.3, SL0 + 0.4, SL0 + 1.4, "round", "louv_r", depth=0.12)] if i % 2 == 0 else [])
    ring_band(g, oct2, SL0 + 1.7, SL0 + 1.95, 0.12, SAND)
    lathe(g, (tc[0], SL0 + 1.93, tc[1]), [(0.84, 0.0), (0.72, 0.35), (0.45, 0.62), (0.2, 0.75), (0.1, 0.8)], 8, LEAD, rot=rot8)
    lathe(g, (tc[0], SL0 + 2.7, tc[1]), [(0.0, 0.0), (0.2, 0.06), (0.28, 0.25), (0.2, 0.45), (0.0, 0.52)], 8, GILT, rot=rot8)
    gilt_cross(g, tc[0], SL0 + 3.2, tc[1], 1.7)
    # ---- the Jesuit house (left): brick with sandstone bands, framed windows, a cornice, a gutter, downpipes, dormers
    g.grime = grime_under((HE - 0.6,))
    hs0, hs1 = -S + M, -TW
    hw_ = hs1 - hs0
    hb_ = [(FOOT, 0.8, SAND), (4.5, 4.75, SAND), (8.5, 8.75, SAND)]
    rows = (1.4, 5.4, 9.4)

    def framed(W, specs):
        for (uc, w, yb, yt) in specs:
            rect_frame(g, W, uc, w, yb, yt, 0.14, -0.1, ears=0.06)
            extrude(g, W, [(uc - w / 2 - 0.2, yb - 0.14), (uc + w / 2 + 0.2, yb - 0.14), (uc + w / 2 + 0.2, yb), (uc - w / 2 - 0.2, yb)], -0.14, 0.0,
                    SAND)

    fw = [(hw_ - uc - 0.55, yb) for yb in rows for uc in (hw_ * 0.25, hw_ * 0.75)]
    W = wall(g, F, (M, hs1), (M, hs0), (-1, 0), FOOT, HE, BRICK, top=[(0, HE), (hw_ / 2, HR), (hw_, HE)],
             holes=[Hc(uc, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22) for uc, yb in fw]
             + [Hc(hw_ / 2, 0.9, HE + 0.6, HE + 2.0, "rect", "hwin", depth=0.2)], bands=hb_)
    framed(W, [(uc, 1.1, yb, yb + 1.75) for uc, yb in fw] + [(hw_ / 2, 0.9, HE + 0.6, HE + 2.0)])
    # the gable's coping
    extrude(g, W, [(-0.25, HE - 0.25), (hw_ / 2, HR + 0.45), (hw_ + 0.25, HE - 0.25), (hw_, HE - 0.25), (hw_ / 2, HR - 0.25), (0.0, HE - 0.25)],
            -0.22, 0.05, SAND, back=True, skip_edges=(2, 5))
    wall(g, F, (M, hs1), (FT, hs1), (0, 1), FOOT, HE, BRICK, bands=hb_)
    sa_ = [a for a in np.arange(2.2, D - 1.5, 3.3)]
    sw = [(a, yb) for yb in rows for a in sa_ if not (yb < 2 and abs(a - D / 2) < 1.8)]
    W = wall(g, F, (M, hs0), (D - M, hs0), (0, -1), FOOT, HE, BRICK,
             holes=[Hc(a, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22) for a, yb in sw] + [Hc(D / 2 - M, 1.5, 0.15, 3.2, "round", "door_r", depth=0.3)],
             bands=hb_)
    framed(W, [(a, 1.1, yb, yb + 1.75) for a, yb in sw])
    arch_band(g, W, D / 2 - M, 0.15, 3.2 - 0.75, 1.5, 0.22, -0.14)
    tri_pediment(g, W, D / 2 - M, 1.25, 3.55, 0.7, -0.3)
    p0, p1 = F.P(M, hs0), F.P(D - M, hs0)
    ring_stack(g, [p0, p1], cornice(HE - 0.62, 0.3, h=0.5), closed=False, side=open_side(p0, p1, F.V(0, -1)))
    gutter(g, p0, p1, HE - 0.72, F.V(0, -1), 0.45)
    for a in (0.6, D / 2 + 2.4, D - 0.6):
        downpipe(g, F.P(a, hs0), HE - 0.82, F.V(0, -1), 0.45)
    for a in (5.0, 11.6, 18.2 + 3.0, 27.8):
        dormer(g, F, a, hs0 + 1.0, -1, 14.3, w=0.9, h=1.4, back=1.4, mat=BRICK, cell="hwin", shape="rect")
    W = wall(g, F, (D - M, hs0), (D - M, hs1), (1, 0), FOOT, HE, BRICK, top=[(0, HE), (hw_ / 2, HR), (hw_, HE)],
             holes=[Hc(uc, 1.1, yb, yb + 1.75, "rect", "hwin", depth=0.22) for yb in (5.4, 9.4) for uc in (hw_ * 0.3, hw_ * 0.7)],
             bands=hb_)
    framed(W, [(uc, 1.1, yb, yb + 1.75) for yb in (5.4, 9.4) for uc in (hw_ * 0.3, hw_ * 0.7)])
    extrude(g, W, [(-0.25, HE - 0.25), (hw_ / 2, HR + 0.45), (hw_ + 0.25, HE - 0.25), (hw_, HE - 0.25), (hw_ / 2, HR - 0.25), (0.0, HE - 0.25)],
            -0.22, 0.05, SAND, back=True, skip_edges=(2, 5))
    W = wall(g, F, (TB, hs1), (D - M, hs1), (0, 1), FOOT, HE, BRICK, bands=hb_,
             holes=[Hc(a - TB, 1.0, 11.0, 12.4, "rect", "hwin", depth=0.2) for a in np.arange(7.0, D - 2.0, 4.4)])
    framed(W, [(a - TB, 1.0, 11.0, 12.4) for a in np.arange(7.0, D - 2.0, 4.4)])
    gable_roof(g, F, M, D - M, hs0, hs1, HE, HR, oe=(0.4, 0.3), og=(0.12, 0.12), caps=(True, True, True, True))
    bar(g, F.p(M + 0.04, (hs0 + hs1) / 2, HR + 0.26), F.p(D - M - 0.04, (hs0 + hs1) / 2, HR + 0.26), 0.22, LEAD, h=0.14, shade=0.85)
    for a in (D * 0.3, D * 0.72):
        box(g, F, a - 0.5, a + 0.5, hs0 + hw_ * 0.5 - 0.6, hs0 + hw_ * 0.5 + 0.6, HR - 1.0, HR + 1.3, BRICK, skip=("-y",), top_mat=SAND)
    # ---- the Lady Chapel (right): sandstone on a bluestone plinth, framed windows, buttresses, the front to the square
    g.grime = grime_under((CE - 0.7,))
    cs0, cs1 = TW, S - M - 0.3
    cw_ = cs1 - cs0
    cp_ = [(FOOT, 0.7, BLUE)]
    W = wall(g, F, (M, cs0), (M, cs1), (-1, 0), FOOT, CE, SAND, top=[(0, CE), (cw_ / 2, CR), (cw_, CE)], bands=cp_,
             holes=[Hc(cw_ / 2, 2.0, 0.15, 4.4, "round", "door_r", depth=0.4), Hc(cw_ / 2, 1.6, 5.6, 9.6, "round", "round", depth=0.35)])
    arch_band(g, W, cw_ / 2, 0.15, 4.4 - 1.0, 2.0, 0.26, -0.16)
    arch_band(g, W, cw_ / 2, 5.6, 9.6 - 0.8, 1.6, 0.2, -0.14)
    tri_pediment(g, W, cw_ / 2, 1.55, 4.75, 0.8, -0.34)
    for u in (0.45, cw_ - 0.45):
        pil(g, W, u, 0.7, 0.7, CE - 0.32, dep=0.22)
    disc(g, W, cw_ / 2, 12.7, 0.75, "rose", d_front=-0.15, d_back=0.05, sides=12, side_mat=SAND)
    extrude(g, W, [(-0.3, CE - 0.3), (cw_ / 2, CR + 0.45), (cw_ + 0.3, CE - 0.3), (cw_, CE - 0.3), (cw_ / 2, CR - 0.25), (0.0, CE - 0.3)],
            -0.26, 0.05, SAND, back=True, skip_edges=(2, 5))
    x_, _, z_ = F.p(M + 0.55, (cs0 + cs1) / 2, 0)
    urn(g, (x_, CR + 0.3, z_), 0.8, GILT, fire=True)
    wall(g, F, (M, cs0), (FT, cs0), (0, -1), FOOT, CE, SAND, bands=cp_)
    ccuts = [(CH[0] - TB, CH[1] - TB, FOOT - 0.1, CH[2])] if (OPEN and CH) else []
    wall(g, F, (TB, cs0), (D - M, cs0), (0, -1), FOOT, CE, SAND, cuts=ccuts)
    ca_ = [a for a in (4.2, 9.4, 14.6, 19.8, 25.0, 30.2) if a < D - 2]
    W = wall(g, F, (M, cs1), (D - M, cs1), (0, 1), FOOT, CE, SAND, bands=cp_,
             holes=[real(Hc(a - M, 1.6, 4.4, 9.2, "round", "round", depth=0.35), "the Carolus, the Lady Chapel, window %d" % (j + 1), colour=True)
                    if (OPEN and CH and CH[0] + 0.8 < a < CH[1] - 0.8) else Hc(a - M, 1.6, 4.4, 9.2, "round", "round", depth=0.35) for j, a in enumerate(ca_)])
    for a in ca_:
        arch_band(g, W, a - M, 4.4, 9.2 - 0.8, 1.6, 0.2, -0.14)
    for a in (1.6, 6.8, 12.0, 17.2, 22.4, 27.6, 32.8):
        if a < D - M - 0.5:
            box(g, F, a - 0.4, a + 0.4, cs1 - 0.05, S - M + 0.05, FOOT, 0.7, BLUE, skip=("-s", "-y"))
            box(g, F, a - 0.36, a + 0.36, cs1 - 0.05, S - M, 0.7, CE - 1.5, SAND, skip=("-s", "-y"))
            buttress_cap = [F.p(a - 0.36, S - M, CE - 1.5), F.p(a + 0.36, S - M, CE - 1.5), F.p(a + 0.36, cs1 - 0.05, CE - 1.05),
                            F.p(a - 0.36, cs1 - 0.05, CE - 1.05)]
            g.face(buttress_cap, BLUE, out=F.v(0, 0.9, 1.0))
            for sa in (-1, 1):
                g.face([F.p(a + sa * 0.36, S - M, CE - 1.5), F.p(a + sa * 0.36, cs1 - 0.05, CE - 1.5), F.p(a + sa * 0.36, cs1 - 0.05, CE - 1.05)],
                       BLUE, out=F.v(sa, 0))
    p0, p1 = F.P(M, cs1), F.P(D - M, cs1)
    ring_stack(g, [p0, p1], cornice(CE - 0.62, 0.3, h=0.5), closed=False, side=open_side(p0, p1, F.V(0, 1)))
    gutter(g, p0, p1, CE - 0.72, F.V(0, 1), 0.45)
    for a in (0.6, 14.9, D - 0.6):
        downpipe(g, F.P(a, cs1), CE - 0.82, F.V(0, 1), 0.45)
    W = wall(g, F, (D - M, cs1), (D - M, cs0), (1, 0), FOOT, CE, SAND, top=[(0, CE), (cw_ / 2, CR), (cw_, CE)], bands=cp_,
             holes=[Hc(cw_ / 2, 1.4, 5.2, 9.2, "round", "round", depth=0.35)])
    arch_band(g, W, cw_ / 2, 5.2, 9.2 - 0.7, 1.4, 0.2, -0.14)
    extrude(g, W, [(-0.3, CE - 0.3), (cw_ / 2, CR + 0.45), (cw_ + 0.3, CE - 0.3), (cw_, CE - 0.3), (cw_ / 2, CR - 0.25), (0.0, CE - 0.3)],
            -0.26, 0.05, SAND, back=True, skip_edges=(2, 5))
    gable_roof(g, F, M, D - M, cs0, cs1, CE, CR, oe=(0.3, 0.4), og=(0.12, 0.12), caps=(True, True, True, True))
    bar(g, F.p(M + 0.04, (cs0 + cs1) / 2, CR + 0.26), F.p(D - M - 0.04, (cs0 + cs1) / 2, CR + 0.26), 0.22, LEAD, h=0.14, shade=0.85)
    for sg in (-1, 1):  # the low ranges between the house or chapel and the aisle, behind the stair towers
        s0_, s1_ = sorted((sg * AW, sg * TW))
        g.face([F.p(TB, s0_, LK), F.p(D - M, s0_, LK), F.p(D - M, s1_, LK), F.p(TB, s1_, LK)], LEAD, out=(0, 1, 0))
        wall(g, F, (D - M, s0_), (D - M, s1_), (1, 0), FOOT, LK, BRICK if sg < 0 else SAND)
    # ---- the sacristy behind the left aisle, the garden wall behind the apse
    g.grime = grime_under((7.6,))
    W = wall(g, F, (AC, -NV), (D - M, -NV), (0, 1), FOOT, 8.0, SAND, holes=[Hc((D - M - AC) / 2, 1.2, 3.0, 6.0, "round", "round", depth=0.3)])
    arch_band(g, W, (D - M - AC) / 2, 3.0, 6.0 - 0.6, 1.2, 0.18, -0.12)
    W = wall(g, F, (D - M, -AW), (D - M, -NV), (1, 0), FOOT, SE, SAND, top=[(0, SE), (AW - NV, 8.0)],
             holes=[Hc((AW - NV) / 2, 1.1, 2.6, 5.2, "round", "round", depth=0.3)])
    arch_band(g, W, (AW - NV) / 2, 2.6, 5.2 - 0.55, 1.1, 0.16, -0.12)
    lean_to(g, F, AC, D - M, -NV, -AW, 8.0, SE, oe=0.35, og=(0, 0.3), caps=(True, False, True))
    garden_wall(g, [F.P(D - M - 0.2, -NV), F.P(D - M - 0.2, NV)], 3.4, SAND, coping=BLUE)
    g.grime = None


def carolus(g, fr):
    g.grp = "church_carolus"
    F, D, S = frame_front_open(fr)
    c = CF
    FA, FB, NV, AW, TW, FT, TB, Y0 = (c[k] for k in ("FA", "FB", "NV", "AW", "TW", "FT", "TB", "Y0"))
    G0, G1, G2, B1, M1, M2, B2, C1, C2, PK = (c[k] for k in ("G0", "G1", "G2", "B1", "M1", "M2", "B2", "C1", "C2", "PK"))
    NE, RID, AE, AH, LK = (c[k] for k in ("NE", "RID", "AE", "AH", "LK"))
    AC = D - M - NV - 0.2  # the apse's centre
    TA0 = AC - 0.7  # the tower behind the choir: its front
    HE, HR = 13.0, 17.8  # the Jesuit house: eave, ridge
    CE, CR = 11.0, 15.4  # the Lady Chapel
    SE = 9.8  # the sacristy's high side
    ST = STONE
    g.grime = carolus_grime
    soot = [(y, y, SAND) for y in (G1 - 2.4, M1 - 2.4, C1 - 2.4, 1.8)]
    u = lambda s: s + AW  # noqa: E731
    # ---- the front: a slab 1 m thick, the ground and middle storeys full width, the crown over the nave
    top = [(0, B2), (u(-6.5), B2), (u(-6.5), C2), (u(6.5), C2), (u(6.5), B2), (u(AW), B2)]
    DW, DH = c["DOOR"]
    holes = [real(Hc(u(0), DW, Y0, Y0 + DH, "round", "open", depth=FB - FA, rmat=BLUE), "the Carolus, the main door", kind="door") if c.get("OPEN")
             else Hc(u(0), DW, Y0, Y0 + DH, "round", "door_main", depth=FB - FA, rmat=BLUE),
             Hc(u(0), 1.8, 22.6, 26.9, "round", "niche_back", depth=0.7, rmat=SAND, k=0.8)]
    for sg in (-1, 1):
        holes += [Hc(u(sg * 4.45), 1.4, 3.0, 7.9, "round", "niche_back", depth=0.75, rmat=SAND, k=0.8),
                  Hc(u(sg * 9.35), 1.9, Y0, Y0 + 4.1, "rect", "door_side", depth=0.5, rmat=BLUE),
                  real(Hc(u(sg * 9.35), 1.1, 6.7, 8.7, "round", "round", depth=0.4, rmat=SAND),
                       "the Carolus, the front, the round window over the %s side door" % ("east" if sg > 0 else "west")),
                  Hc(u(sg * 4.45), 1.3, 13.6, 18.3, "round", "niche_back", depth=0.7, rmat=SAND, k=0.8),
                  Hc(u(sg * 9.35), 2.0, 13.6, 17.6, "rect", "win_rect", depth=0.45, rmat=SAND),
                  Hc(u(sg * 4.1), 1.1, 22.9, 26.4, "round", "niche_back", depth=0.6, rmat=SAND, k=0.8)]
    Wf = wall(g, F, (FA, -AW), (FA, AW), (-1, 0), FOOT, B2, SAND, top=top, holes=holes, bands=soot)
    wall(g, F, (FB, -AW), (FB, AW), (1, 0), AE - 0.6, B2, SAND, top=top, k=0.85)
    for (ua, ya), (ub, yb) in zip(top, top[1:]):
        sa, sb = ua - AW, ub - AW
        if abs(ua - ub) < 1e-6:
            g.face([F.p(FA, sa, ya), F.p(FB, sa, ya), F.p(FB, sa, yb), F.p(FA, sa, yb)], SAND, out=F.v(0, -1 if sa < 0 else 1), k=0.85)
        else:
            g.face([F.p(FA, sa, ya), F.p(FA, sb, yb), F.p(FB, sb, yb), F.p(FB, sa, ya)], SAND, out=(0, 1, 0))
    for sg in (-1, 1):  # the slab's ends in the stair towers' setback
        wall(g, F, (FA, sg * AW), (FT, sg * AW), (0, sg), FOOT, B2, SAND, k=0.85)
    # ---- the orders: pedestals, columns and pilasters, entablatures, the bands between
    CS = (2.9, 6.0, 12.05)  # free columns (and mirrored)
    PS = 7.35  # pilasters
    cols = [sg * s for s in CS for sg in (-1, 1)]
    pils = [sg * PS for sg in (-1, 1)]
    storeys = [  # (column base, top, entablature top, radius, order, pedestal half, pedestal depth, extra)
        (G0, G1, G2, 0.42, "doric", 0.62, 1.25, 0.95),
        (B1, M1, M2, 0.38, "ionic", 0.58, 1.2, 0.9),
    ]
    ped_y = [(Y0, G0), (G2, B1)]
    for (yb, yt, ye, r, order, ph, pd, ex), (py0, py1) in zip(storeys, ped_y):
        for s in cols:
            pedestal(g, F, FA, s, ph, pd, FOOT if (py0 == Y0 and abs(s) > c["TS"]) else py0, py1)
            column(g, F, FA - pd / 2, s, yb, yt, r, order)
        for s in pils:
            pedestal(g, F, FA, s, 0.5, 0.35, py0, py1)
            pilaster(g, F, FA, s, 0.45, 0.25, yb, yt)
        ress = [(s - ph, s + ph, ex) for s in cols] + [(s - 0.55, s + 0.55, 0.25) for s in pils]
        stack(g, F, FA, -AW, AW, entab(yt, ye), ress)
    # band 1: balustrades between the middle storey's pedestals
    peds = sorted([(s, 0.58 + 0.09) for s in cols] + [(s, 0.5 + 0.09) for s in pils])
    edges = [(-AW, -AW)] + [(s - h, s + h) for s, h in peds] + [(AW, AW)]
    for (_, e0), (e1, _) in zip(edges, edges[1:]):
        if e1 - e0 > 0.6:
            balustrade(g, F, FA, e0, e1, G2, B1)
    # band 2: pedestals for the crown's columns and the vases; balustrades before the volutes
    CC = (2.3, 5.9)
    ccols = [sg * s for s in CC for sg in (-1, 1)]
    vases = [-12.1, 12.1]
    for s in ccols:
        pedestal(g, F, FA, s, 0.52, 1.1, M2, B2)
    for s in vases:
        pedestal(g, F, FA, s, 0.55, 1.1, M2, B2)
        x, _, z = F.p(FA - 0.55, s, 0)
        urn(g, (x, B2, z), 1.5)
    peds2 = sorted([(s, 0.61) for s in ccols] + [(s, 0.64) for s in vases])
    edges = [(-AW, -AW)] + [(s - h, s + h) for s, h in peds2] + [(AW, AW)]
    for (_, e0), (e1, _) in zip(edges, edges[1:]):
        if e1 - e0 > 0.6:
            balustrade(g, F, FA, e0, e1, M2, B2)
    for s in ccols:
        column(g, F, FA - 0.55, s, B2, C1, 0.34, "corinth")
    stack(g, F, FA, -6.5, 6.5, entab(C1, C2), [(s - 0.52, s + 0.52, 0.85) for s in ccols])
    # the plinth of the front's ends, where the terrace does not reach
    for sg in (-1, 1):
        s0_, s1_ = sorted((sg * c["TS"], sg * AW))
        stack(g, F, FA, s0_, s1_, [(FOOT, Y0, 0.12, BLUE)], caps=(sg < 0, sg > 0))
    # ---- the doors
    ysp = Y0 + DH - DW / 2
    arch_band(g, Wf, u(0), Y0, ysp, DW, 0.38, -0.2, SAND)
    extrude(g, Wf, [(u(-0.26), Y0 + DH - 0.05), (u(0.26), Y0 + DH - 0.05), (u(0.36), Y0 + DH + 0.62), (u(-0.36), Y0 + DH + 0.62)],
            -0.34, 0.0, SAND, k=1.05)
    # the segmental pediment over the main door, on two consoles
    Rp, yc_, n_ = 3.56, 8.6 + 0.8 - 3.56, 10
    t0 = math.asin(2.25 / Rp)
    for i in range(n_):
        a0_, a1_ = -t0 + 2 * t0 * i / n_, -t0 + 2 * t0 * (i + 1) / n_
        poly = [(u(Rp * math.sin(a0_)), yc_ + Rp * math.cos(a0_)), (u(Rp * math.sin(a1_)), yc_ + Rp * math.cos(a1_)),
                (u((Rp + 0.3) * math.sin(a1_)), yc_ + (Rp + 0.3) * math.cos(a1_)), (u((Rp + 0.3) * math.sin(a0_)), yc_ + (Rp + 0.3) * math.cos(a0_))]
        extrude(g, Wf, poly, -0.46, 0.0, SAND, skip_edges=tuple(e for e, on in ((3, i > 0), (1, i < n_ - 1)) if on))
    for sg in (-1, 1):
        extrude(g, Wf, [(u(sg * 2.05), 8.62), (u(sg * 2.35), 8.62), (u(sg * 2.3), 7.6), (u(sg * 2.12), 7.6)], -0.4, 0.0, SAND)
    for sg in (-1, 1):
        uc = u(sg * 9.35)
        rect_frame(g, Wf, uc, 1.9, Y0, Y0 + 4.1, 0.3, -0.18)
        disc(g, Wf, uc, 5.3, 0.32, "a_dark", d_front=-0.24, d_back=0.0, sides=12, side_mat=SAND)
        tri_pediment(g, Wf, uc, 1.38, 5.75, 0.72, -0.36)
        arch_band(g, Wf, uc, 6.7, 8.15, 1.1, 0.2, -0.14)
        # the middle storey's windows: frame and pediment
        rect_frame(g, Wf, uc, 2.0, 13.6, 17.6, 0.28, -0.18)
        tri_pediment(g, Wf, uc, 1.5, 17.98, 0.78, -0.38)
        # niches: frames and statues
        for (s_, yb, yt, w, dep, h, ar, stf) in ((4.45, 3.0, 7.9, 1.4, 0.75, 2.75, 1, sg < 0), (4.45, 13.6, 18.3, 1.3, 0.7, 2.55, -1, False),
                                                 (4.1, 22.9, 26.4, 1.1, 0.6, 2.2, 1, False)):
            s_ *= sg
            arch_band(g, Wf, u(s_), yb, yt - w / 2, w, 0.18, -0.12)
            niche_statue(g, F, Wf, s_, yb, dep, h, arm=ar * sg, staff=stf)
    arch_band(g, Wf, u(0), 22.6, 26.9 - 0.9, 1.8, 0.22, -0.14)
    # St Ignatius's bust in the crown's niche, on a pedestal; the wreath over it
    box(g, F, FA, FA + 0.62, -0.42, 0.42, 22.6, 23.9, SAND, skip=("-y", "+a"), k=0.95)
    x, _, z = F.p(FA + 0.3, 0.0, 0)
    lathe(g, (x, 23.9, z), [(0.46, 0.0), (0.5, 0.08), (0.46, 0.42), (0.2, 0.55), (0.15, 0.62), (0.2, 0.78), (0.19, 0.96), (0.1, 1.06),
                            (0.0, 1.1)], 8, PALE, rot=math.pi / 8, k=1.1)
    wr = [(u(0) + 0.62 * math.cos(2 * math.pi * i / 12), 27.0 + 0.3 * math.sin(2 * math.pi * i / 12)) for i in range(12)]
    extrude(g, Wf, wr, -0.3, 0.0, GILT)
    # ---- the IHS medallion with its rays, the angels, the winged crown
    ym = (B1 + M1) / 2
    for i in range(24):
        ang = math.pi / 2 + 2 * math.pi * i / 24
        R = 2.4 if i % 2 == 0 else 1.95
        cs_, sn_ = math.cos(ang), math.sin(ang)
        poly = [(u(0) + 1.3 * cs_ + 0.17 * sn_, ym + 1.3 * sn_ - 0.17 * cs_), (u(0) + R * cs_, ym + R * sn_),
                (u(0) + 1.3 * cs_ - 0.17 * sn_, ym + 1.3 * sn_ + 0.17 * cs_)]
        extrude(g, Wf, poly, -0.26, 0.0, GILT)
    disc(g, Wf, u(0), ym, 1.45, "c_ihs", d_front=-0.45, d_back=0.0, sides=20, side_mat=GILT, crop=0.64)
    for sg in (-1, 1):
        angel(g, Wf, u(0) + sg * 1.25, ym - 1.3, sg)
    x, _, z = F.p(FA - 0.4, 0.0, 0)
    lathe(g, (x, ym + 2.05, z), [(0.3, 0.0), (0.34, 0.1), (0.28, 0.18), (0.36, 0.4), (0.2, 0.44), (0.07, 0.52), (0.1, 0.6), (0.0, 0.68)], 8,
          GILT, rot=math.pi / 8)
    for sg in (-1, 1):
        wing = [(0.22, 0.12), (0.55, -0.12), (1.0, -0.08), (1.3, 0.2), (1.48, 0.62), (1.05, 0.46), (0.5, 0.4)]
        extrude(g, Wf, [(u(0) + sg * x_, ym + 2.0 + y_) for x_, y_ in wing], -0.34, -0.12, GILT, back=True)
    # ---- the crown: the volutes, the pediment with its relief, fire-pots and the cross
    for sg in (-1, 1):
        volute(g, F, sg, c)
    half = 6.5

    def ruv(uu, y):
        return cell_uv("relief", 0.015 + 0.97 * Wf.fu(uu, u(-half), 2 * half), 0.02 + 0.96 * (y - C2) / (PK - C2))

    ptri = [(u(-half), C2), (u(half), C2), (u(0), PK)]
    extrude(g, Wf, ptri, 0.0, FB - FA, ART, side_mat=SAND, front_uv=ruv, skip_edges=(0,))
    g.face([Wf.pt(uu, y, FB - FA) for uu, y in ptri], SAND, out=Wf.out(-1), k=0.8)
    # the relief's masses stand out of the tympanum, each with the picture on its face: the clouds low, the
    # two angels, the sun proudest
    cloud = [(5.4, 0.0), (5.1, 0.5), (3.6, 0.75), (2.0, 0.7), (0.9, 0.95), (0.0, 0.7), (-0.9, 0.95), (-2.0, 0.7), (-3.6, 0.75), (-5.1, 0.5),
             (-5.4, 0.0)]
    extrude(g, Wf, [(u(x_), C2 + y_) for x_, y_ in cloud], -0.14, 0.0, ART, side_mat=PALE, front_uv=ruv, skip_edges=(len(cloud) - 1,), k=0.95)
    body = [(4.45, 0.45), (1.0, 0.5), (0.6, 1.3), (0.9, 2.2), (1.6, 2.85), (2.4, 2.55), (3.3, 1.85), (4.15, 1.15)]
    for sg in (-1, 1):
        extrude(g, Wf, [(u(sg * x_), C2 + y_) for x_, y_ in body], -0.3, 0.0, ART, side_mat=PALE, front_uv=ruv, k=1.0)
    sun = [(u(0) + 0.58 * math.cos(2 * math.pi * i / 12), C2 + 2.45 + 0.58 * math.sin(2 * math.pi * i / 12)) for i in range(12)]
    extrude(g, Wf, sun, -0.4, 0.0, ART, side_mat=GILT, front_uv=ruv, k=1.05)
    chev = [(u(-7.0), C2), (u(0), PK + 0.55), (u(7.0), C2), (u(6.35), C2), (u(0), PK - 0.1), (u(-6.35), C2)]
    extrude(g, Wf, chev, -0.5, FB - FA + 0.12, SAND, back=True, skip_edges=(2, 5))
    for sg in (-1, 1):  # under the raking cornice's feet, past the crown's cornice
        g.face([F.p(FA - 0.5, sg * 6.5, C2), F.p(FA - 0.5, sg * 7.0, C2), F.p(FB + 0.12, sg * 7.0, C2), F.p(FB + 0.12, sg * 6.5, C2)], SAND,
               out=(0, -1, 0), k=0.7)
        x, _, z = F.p(FA - 1.0, sg * 6.0, 0)
        urn(g, (x, C2, z), 1.05, GILT, fire=True)
    box(g, F, FA + 0.1, FA + 0.9, -0.38, 0.38, PK + 0.2, PK + 0.85, SAND, skip=("-y",))
    x, _, z = F.p(FA + 0.5, 0.0, 0)
    gilt_cross(g, x, PK + 0.85, z, 2.5)
    # ---- the stair towers (bays 1 and 7), set back; small domed lanterns with gilded pineapples
    for sg in (-1, 1):
        s_in, s_out = sg * AW, sg * TW
        s0_, s1_ = min(s_in, s_out), max(s_in, s_out)
        th = [Hc(1.25, 0.8, 2.6, 4.8, "round", "round", depth=0.35, rmat=SAND), Hc(1.25, 0.8, 6.3, 8.5, "round", "round", depth=0.35, rmat=SAND),
              Hc(1.25, 0.9, 14.0, 17.0, "round", "round", depth=0.35, rmat=SAND)]
        wall(g, F, (FT, s0_), (FT, s1_), (-1, 0), FOOT, B2, SAND, holes=th, bands=soot)
        wall(g, F, (FB, s_in), (TB, s_in), (0, -sg), FOOT, B2, SAND, k=0.9)
        wall(g, F, (FT, s_out), (TB, s_out), (0, sg), (HE if sg < 0 else CE) - 1.0, B2, SAND, k=0.9)
        wall(g, F, (TB, s0_), (TB, s1_), (1, 0), LK - 0.4, B2, SAND, k=0.85)
        g.face([F.p(FT, s0_, B2), F.p(TB, s0_, B2), F.p(TB, s1_, B2), F.p(FT, s1_, B2)], LEAD, out=(0, 1, 0))
        e0, e1 = (s0_ + 0.03, s1_) if sg < 0 else (s0_, s1_ - 0.03)
        cp = (True, False) if sg < 0 else (False, True)
        stack(g, F, FT, e0, e1, [(FOOT, Y0, 0.12, BLUE)], caps=cp)
        stack(g, F, FT, e0, e1, entab(G1, G2), caps=cp)
        stack(g, F, FT, e0, e1, entab(M1, M2), caps=cp)
        for y0_, y1_ in ((G2, B1), (M2, B2)):
            box(g, F, FT - 0.16, FT, e0, e1, y0_, y1_, SAND, skip=("+a", "-y", "-s" if sg > 0 else "+s"))
        for sq in (sg * 13.25, sg * 14.85):
            for (y0_, y1_) in ((Y0, G1), (B1, M1)):
                pilaster(g, F, FT, sq, 0.3, 0.2, y0_, y1_)
        # the lantern
        tc = F.P((FT + TB) / 2, sg * (AW + TW) / 2)
        box(g, F, (FT + TB) / 2 - 1.2, (FT + TB) / 2 + 1.2, sg * (AW + TW) / 2 - 1.2, sg * (AW + TW) / 2 + 1.2, B2, B2 + 0.4, BLUE,
            skip=("-y",))
        R8 = 1.05
        oc = poly_walls(g, tc, R8, 8, math.pi / 8, B2 + 0.4, B2 + 3.2, SAND,
                        holes=lambda i, L: [Hc(L / 2, 0.42, B2 + 0.9, B2 + 2.5, "round", "louv_r", depth=0.2)] if i % 2 == 0 else [])
        ring_band(g, oc, B2 + 2.95, B2 + 3.25, 0.16, BLUE)
        lathe(g, (tc[0], B2 + 3.25, tc[1]), [(1.18, 0.0), (1.1, 0.4), (0.9, 0.85), (0.58, 1.2), (0.25, 1.38), (0.2, 1.52)], 8, SAND,
              rot=math.pi / 8, k=0.95)
        pineapple(g, (tc[0], B2 + 3.25 + 1.5, tc[1]), 1.1)
    carolus_sides(g, F, c, D, S, AC, TA0, HE, HR, CE, CR, SE)
    # ---- the terrace, the flights, the railing (colliders and heights: shared/carolusPlan.ts)
    g.grime = carolus_grime
    carolus_terrace(g, F, c)
    g.grime = None
    print(f"[build_churches] carolus: frame o {F.o}, a along {F.ua}, s along {F.us}; front at a {FA}, door {DW} x {DH} "
          f"(sill {Y0}), apse centre a {AC:.2f}, stair towers a {FT}..{TB}")


# ------------------------------------------------------------------ Gothic parts (St Paul, St James)


def parc(u0, u1, ys, n=5):
    """A pointed arch from the left springing (u0, ys) over the apex to the right one (u1, ys): 2n + 1 points."""
    w = u1 - u0
    r = 0.8 * w
    h = head_h("pointed", w)
    cl = u0 + r
    aa = math.atan2(h, (u0 + w / 2) - cl)
    left = [(cl + r * math.cos(math.pi + (aa - math.pi) * i / n), ys + r * math.sin(math.pi + (aa - math.pi) * i / n)) for i in range(n + 1)]
    left[-1] = (u0 + w / 2, ys + h)
    return left + [(u0 + u1 - x, y) for x, y in reversed(left[:-1])]


def pband(g, W, uc, ys, w, band, d_front, mat, yb=None, n=5, k=1.0, d_back=0.0, foot=True):
    """A pointed moulding (a hood, an arch's order) round an opening w wide springing at ys, `band` wide, proud of
    the wall W by -d_front; with jambs down to yb if given."""
    inner = parc(uc - w / 2, uc + w / 2, ys, n)
    outer = parc(uc - w / 2 - band, uc + w / 2 + band, ys, n)
    last = len(inner) - 2
    for i in range(len(inner) - 1):
        poly = [inner[i], outer[i], outer[i + 1], inner[i + 1]]
        sk = tuple(e for e, on in ((0, i > 0 or yb is not None), (2, i < last or yb is not None)) if on)
        extrude(g, W, poly, d_front, d_back, mat, k=k, skip_edges=sk)
    if yb is not None:
        for u_in, u_out in ((uc - w / 2, uc - w / 2 - band), (uc + w / 2, uc + w / 2 + band)):
            a_, b_ = sorted((u_in, u_out))
            extrude(g, W, [(a_, yb), (b_, yb), (b_, ys), (a_, ys)], d_front, d_back, mat, k=k, skip_edges=(2,) if foot else (0, 2))


def gwin(g, W, h, lights, mat, hood=0.15, transom=True, k=1.0, sill=True):
    """The stone of a Gothic window in its Hole h (already built into W): mullions and a transom in the reveal in
    front of the glass, a hood moulding with label stops, a sill."""
    u0, u1, yb, yt = h.u0, h.u1, h.yb, h.yt
    w = u1 - u0
    hh = head_h("pointed", w)
    ys = yt - hh
    df, db = 0.1, max(0.14, h.depth - 0.03)
    for i in range(1, lights):
        u = u0 + w * i / lights
        extrude(g, W, [(u - 0.05, yb), (u + 0.05, yb), (u + 0.05, ys + 0.08), (u - 0.05, ys + 0.08)], df, db, mat, k=k, skip_edges=(0,))
    if transom and lights >= 2 and ys - yb > 3.2:
        yt_ = yb + (ys - yb) * 0.48
        extrude(g, W, [(u0, yt_ - 0.05), (u1, yt_ - 0.05), (u1, yt_ + 0.05), (u0, yt_ + 0.05)], df + 0.07, db, mat, k=k, skip_edges=(1, 3))
    if hood:
        pband(g, W, (u0 + u1) / 2, ys, w + 0.04, hood, -0.12, mat, yb=ys - 0.35, k=k)
    if sill:
        extrude(g, W, [(u0 - 0.16, yb - 0.14), (u1 + 0.16, yb - 0.14), (u1 + 0.16, yb), (u0 - 0.16, yb)], -0.13, 0.0, mat, k=k * 0.95)


def pinnacle(g, x, y, z, w, h, mat, rot=0.0, k=1.0):
    """A square pinnacle: shaft, a moulded cap, the spire, a finial."""
    r = w * 0.7071
    lathe(g, (x, y, z), [(r, 0.0), (r, h * 0.36), (r * 1.18, h * 0.38), (r * 1.18, h * 0.43)], 4, mat, rot=rot + math.pi / 4, k=k)
    lathe(g, (x, y + h * 0.43, z), [(r * 1.05, 0.0), (0.0, h * 0.5)], 4, mat, rot=rot + math.pi / 4, k=k)
    lathe(g, (x, y + h * 0.9, z), [(0.0, 0.0), (w * 0.22, h * 0.03), (w * 0.12, h * 0.07), (0.0, h * 0.1)], 4, mat, rot=rot, k=k)


def gbuttress(g, F, a, s, out, w, dep, y1, y2=None, mat=STONE, pin=2.6, k=1.0):
    """A stepped buttress (buttress()) with a pinnacle on its top."""
    buttress(g, F, a, s, out, w, dep, y1, y2, mat=mat, k=k)
    if not pin:
        return
    dd = dep * 0.55 if y2 is not None else dep
    ytop = y2 if y2 is not None else y1
    ww = (w - 0.12 if y2 is not None else w) * 0.6
    ox, oz = F.V(*out)
    bx, bz = F.P(a, s)
    tx, tz = -oz, ox
    x, z = bx + ox * dd * 0.5, bz + oz * dd * 0.5
    pinnacle(g, x, ytop + (dd * 0.5 + 0.1) * 0.9 - 0.25, z, ww, pin, mat, rot=math.atan2(tz, tx), k=k)


def fly(g, p0, p1, w, h, mat, k=1.0):
    """A flying buttress: a sloping stone bar from p0 (the pier, low) to p1 (the clerestory, high), and its web
    down to an arc under it."""
    bar(g, p0, p1, w, mat, h=h, k=k)
    a, b = Vector(p0), Vector(p1)
    for t in (0.33, 0.66):
        q = a + (b - a) * t
        drop = h * 1.1 * math.sin(math.pi * t)
        bar(g, (q.x, q.y - h / 2, q.z), (q.x, q.y - h / 2 - drop, q.z), w * 0.55, mat, h=w * 0.55, k=k * 0.9, skip=("+y",))


def figure(g, x, y, z, h, face, mat=SAND, k=1.05, arm=1):
    """A standing figure turned toward `face` (x, z): robe, head, an arm bent."""
    lathe(g, (x, y, z), [(r * h, yy * h) for r, yy in FIG], 8, mat, rot=math.pi / 8, k=k)
    fx, fz = face
    ln = math.hypot(fx, fz) or 1.0
    fx, fz = fx / ln, fz / ln
    sx, sz = -fz * arm, fx * arm
    sh = (x + sx * 0.13 * h, y + 0.76 * h, z + sz * 0.13 * h)
    el = (x + sx * 0.12 * h + fx * 0.1 * h, y + 0.6 * h, z + sz * 0.12 * h + fz * 0.1 * h)
    hand = (x + sx * 0.03 * h + fx * 0.17 * h, y + 0.66 * h, z + sz * 0.03 * h + fz * 0.17 * h)
    bar(g, sh, el, 0.05 * h, mat, k=k)
    bar(g, el, hand, 0.045 * h, mat, k=k)


def gable_coping(g, W, u0, u1, ye, yr, mat, crockets=True, finial=True, t=0.24, d_back=0.3, k=1.0, ends=(True, True)):
    """The stone coping along a gable's raking edges (u0..u1 at the eaves ye, apex yr), crockets on it, a finial.
    ends: whether it runs out past each foot (not where two gables of a row meet)."""
    mid = (u0 + u1) / 2
    e0 = t if ends[0] else 0.0
    e1 = t if ends[1] else 0.0
    chev = [(u0 - e0, ye - 0.12), (mid, yr + t * 1.3), (u1 + e1, ye - 0.12), (u1 - (0.0 if ends[1] else t), ye - 0.12), (mid, yr - 0.05),
            (u0 + (0.0 if ends[0] else t), ye - 0.12)]
    extrude(g, W, chev, -0.2, d_back, mat, back=True, k=k, skip_edges=(2, 5))
    if crockets:
        L = math.hypot(mid - u0, yr - ye)
        n = max(2, int(L / 1.3))
        for sgn, ua in ((1, u0 - t), (-1, u1 + t)):
            for i in range(1, n):
                f = i / n
                u = ua + (mid - ua) * f
                y = (ye - 0.12) + (yr + t * 1.3 - ye + 0.12) * f + 0.08
                p = W.pt(u, y, -0.05)
                q = W.pt(u - sgn * 0.08, y + 0.32, -0.05)
                bar(g, p, q, 0.13, mat, k=k * 1.05)
    if finial:
        x, y, z = W.pt(mid, yr + t * 1.3 - 0.05, 0.05)
        lathe(g, (x, y, z), [(0.2, 0.0), (0.2, 0.35), (0.34, 0.5), (0.1, 0.75), (0.28, 0.95), (0.0, 1.4)], 4, mat, rot=math.pi / 4, k=k)


def canopy(g, x, y, z, w, face, mat, k=1.0):
    """A small canopy over a statue: a hood on its back plate, a spirelet on top."""
    fx, fz = face
    ln = math.hypot(fx, fz) or 1.0
    fx, fz = fx / ln, fz / ln
    cx, cz = x + fx * w * 0.35, z + fz * w * 0.35
    lathe(g, (cx, y, cz), [(w * 0.62, 0.0), (w * 0.7, w * 0.3), (w * 0.62, w * 0.42)], 6, mat, rot=math.atan2(fz, fx), k=k)
    lathe(g, (cx, y + w * 0.42, cz), [(w * 0.5, 0.0), (0.0, w * 1.3)], 6, mat, rot=math.atan2(fz, fx), k=k)


def gportal(g, W, uc, w, yb, ys, orders, mat, P=0.9, gable=True, statues=2, fig_mat=None, k=1.0, top_extra=1.6):
    """A Gothic portal standing out of the wall W: `orders` pointed orders stepping in from a porch front P proud
    (the outermost) to the door's order at the wall; statues on corbels under canopies beside it; a crocketed
    gable (wimperg) over it with a finial. The door itself is the wall's Hole (its cell, its reveal)."""
    fig_mat = fig_mat if fig_mat is not None else mat
    step = 0.3
    for i in range(orders, 0, -1):
        wi = w + 2 * step * i
        wo = wi + 2 * step + 0.02
        hh_o = head_h("pointed", wo)
        dfront = -P * i / orders
        u0, u1 = uc - wo / 2, uc + wo / 2
        top = ys + hh_o + 0.05
        if i == orders and gable:
            # the porch front: a gable over the outer arch
            ga = top + top_extra
            Wp = Wall(g, W.A + W.t * u0 - W.n * dfront, W.A + W.t * u1 - W.n * dfront, W.n, yb, ga, mat,
                      top=[(0, top - 0.3), (wo / 2, ga), (wo, top - 0.3)], k=k)
        else:
            Wp = Wall(g, W.A + W.t * u0 - W.n * dfront, W.A + W.t * u1 - W.n * dfront, W.n, yb, top, mat, k=k)
        if W.flip:
            Wp.flip = True
        Wp.build(holes=[Hole((wo - wi) / 2, (wo + wi) / 2, yb, ys + head_h("pointed", wi), "pointed",
                             "open", depth=P / orders, rmat=mat, k=k, sill=False)])
        # the porch's returns to the wall behind (only the outermost is seen)
        if i == orders:
            for u in (u0, u1):
                sg = -1 if u == u0 else 1
                yt_ = top - 0.3 if gable else top
                g.face([W.pt(u, yb, dfront), W.pt(u, yb, 0.0), W.pt(u, yt_, 0.0), W.pt(u, yt_, dfront)], mat,
                       out=W.inplane(sg, 0), k=k * 0.85)
            if gable:
                for (ua, ya), (ub, yb_) in (((u0, top - 0.3), (uc, ga)), ((uc, ga), (u1, top - 0.3))):
                    g.face([W.pt(ua, ya, dfront), W.pt(ub, yb_, dfront), W.pt(ub, yb_, 0.0), W.pt(ua, ya, 0.0)], mat,
                           out=(0, 1, 0), k=k)
                gable_coping(g, Wp, 0, wo, top - 0.3, ga, mat, d_back=0.12, k=k)
                # a statue in a niche in the gable
                x, y, z = W.pt(uc, top + 0.1, dfront - 0.25)
                figure(g, x, y, z, 1.35, (W.n.x, W.n.y), fig_mat)
            else:
                g.face([W.pt(u0, top, dfront), W.pt(u1, top, dfront), W.pt(u1, top, 0.0), W.pt(u0, top, 0.0)], mat, out=(0, 1, 0), k=k)
    # statues beside the porch on corbels, under canopies
    wo = w + 2 * step * orders + 2 * step
    for n_ in range(statues):
        for sg in (-1, 1):
            u = uc + sg * (wo / 2 + 0.5 + n_ * 0.9)
            x, y, z = W.pt(u, yb + 1.9, -0.35)
            extrude(g, W, [(u - 0.28, yb + 1.55), (u + 0.28, yb + 1.55), (u + 0.28, yb + 1.9), (u - 0.2, yb + 1.9)],
                    -0.55, 0.0, mat, k=k)
            figure(g, x, y, z, 1.75, (W.n.x, W.n.y), fig_mat, arm=sg)
            cx, cy, cz = W.pt(u, yb + 1.9 + 1.85, -0.2)
            canopy(g, cx, cy, cz, 0.55, (W.n.x, W.n.y), mat, k=k)


def blind_panel(g, W, uc, w, yb, yt, mat, d=0.1, lights=2, k=1.0):
    """Blind tracery on a wall: a pointed frame with mullions, proud of it."""
    hh = head_h("pointed", w)
    ys = yt - hh
    pband(g, W, uc, ys, w, 0.12, -d, mat, yb=yb, k=k, foot=False)
    for i in range(1, lights):
        u = uc - w / 2 + w * i / lights
        extrude(g, W, [(u - 0.05, yb), (u + 0.05, yb), (u + 0.05, ys + hh * 0.35), (u - 0.05, ys + hh * 0.35)], -d, 0.0, mat, k=k, skip_edges=(0,))
    extrude(g, W, [(uc - w / 2 - 0.12, yb - 0.12), (uc + w / 2 + 0.12, yb - 0.12), (uc + w / 2 + 0.12, yb), (uc - w / 2 - 0.12, yb)], -d - 0.04, 0.0,
            mat, k=k)


def parapet(g, pts, y0, h, mat, closed=False, k=1.0, avoid=()):
    """An open parapet along a line (world x, z): a plinth, little posts, the coping (it reads as a pierced rail)."""
    kerb(g, pts, 0.12, y0, y0 + 0.14, mat, closed=closed, k=k)
    kerb(g, pts, 0.14, y0 + h - 0.14, y0 + h, mat, closed=closed, k=k)
    P = [Vector((p[0], p[1])) for p in pts]
    segs = list(zip(P, P[1:] + ([P[0]] if closed else [])))
    for si, (a, b) in enumerate(segs):
        L = (b - a).length
        n = max(1, int(L / 0.55))
        for i in range(n + (0 if closed or si < len(segs) - 1 else 1)):
            q = a + (b - a) * (i / n)
            if any(math.hypot(q.x - ax, q.y - az) < 0.75 for ax, az in avoid):
                continue
            bar(g, (q.x, y0 + 0.14, q.y), (q.x, y0 + h - 0.14, q.y), 0.1, mat, k=k, skip_ends=True)


def ridge_turret(g, x, z, y, r, h, mat_wall, mat_roof, k=1.0):
    """A ridge turret (dakruiter): an open octagonal lantern on the ridge and its lead spire, a cross."""
    oc = poly_walls(g, (x, z), r, 8, math.pi / 8, y - 0.8, y + 2.6, mat_wall,
                    holes=lambda i, L: [Hc(L / 2, L * 0.55, y + 0.2, y + 2.1, "pointed", "louv_p", depth=0.12)])
    ring_band(g, oc, y + 2.4, y + 2.75, 0.12, mat_wall)
    lathe(g, (x, y + 2.7, z), [(r * 1.05, 0.0), (r * 0.35, h * 0.55), (r * 0.18, h * 0.8), (0.0, h)], 8, mat_roof, rot=math.pi / 8, k=k)
    cross(g, x, y + 2.7 + h - 0.1, z, 1.2, cell="gilt")


def gwall(g, F, A, Bp, out, y0, y1, mat, wins=(), top=None, bands=(), cuts=(), k=1.0, frame=None, hood=0.15, extra=()):
    """A wall in a frame with Gothic windows: wins = [(u centre, width, sill, head, lights, cell[, label[, colour]])]; their
    stone parts drawn. A window with a label is real (issue #10): the hall stands behind it."""
    frame = mat if frame is None else frame
    hs = []
    for spec in wins:
        uc, w, yb, yt, lights, cell = spec[:6]
        h = Hc(uc, w, yb, yt, "pointed", cell, depth=0.42, rmat=frame)
        if len(spec) > 6 and spec[6]:
            real(h, spec[6], lights=lights, colour=len(spec) > 7 and spec[7])
        hs.append((h, lights))
    W = wall(g, F, A, Bp, out, y0, y1, mat, top=top, holes=[h for h, _ in hs] + list(extra), bands=bands, cuts=cuts, k=k)
    for h, lights in hs:
        gwin(g, W, h, lights, frame, hood=hood, k=k)
    return W



# ------------------------------------------------------------------ Sint-Pauluskerk


# St Paul's numbers (frame_west_end: a east from the west front, s: + north (world -z), - south (world +z))
PF = dict(BD=0.7, NV=5.5, AO=15.0, AE=10.5, AR=14.5, NE=20.5, RID=27.0, CL=6.8, CH=8.6, TX0=40.0, TX1=51.5, CHE=69.5,
          OPEN=True, DOOR_W=(2.6, 5.2), DOOR_N=(2.8, 5.6))
# OPEN: the west door a real opening (the interior in the game: client/src/world/gothicHall.ts); the north transept door stays painted


def rock(g, c, sx, sy, sz, rng, mat=BLUE, k=0.62):
    """A rough block of rock (the Calvary's mound): a box with its corners pushed about."""
    x, y, z = c
    P = []
    for i in range(8):
        dx = (sx / 2) * (1 if i & 1 else -1) * rng.uniform(0.75, 1.15)
        dy = (sy if i & 2 else 0.0) * (rng.uniform(0.8, 1.1) if i & 2 else 1.0)
        dz = (sz / 2) * (1 if i & 4 else -1) * rng.uniform(0.75, 1.15)
        P.append((x + dx, y + dy - (0.25 + rng.uniform(0.0, 0.2) if not i & 2 else 0.0), z + dz))
    solid8(g, P, mat, k=k * rng.uniform(0.85, 1.1))


def calvary(g, F, a0, a1, s_wall, s_out, top=9.2):
    """The Calvary garden (1697-1747) against the south aisle: a wall with an iron railing and a gate to the square,
    the angels' path with the instruments of the Passion up to the Holy Sepulchre's grotto, the prophets' garden (west)
    and the evangelists' (east), the rock mound in three terraces with the crucifix on top."""
    rng = np.random.default_rng(1697)
    sg = -1  # the south
    dep = abs(s_out - s_wall)
    # the enclosing wall on the square (west) and along the garden's outer side, the railing on it, the gate
    WA = [F.P(a0, s_wall + sg * 0.05), F.P(a0, s_out)]
    kerb(g, [F.P(a0 + 0.2, s_wall + sg * 0.95), F.P(a0 + 0.2, s_out - sg * 0.4)], 0.2, FOOT, 1.0, PBRICK, caps=(False, False))
    kerb(g, [F.P(a0 + 0.2, s_wall + sg * 0.95), F.P(a0 + 0.2, s_out - sg * 0.4)], 0.26, 1.0, 1.15, PWHITE, caps=(False, False))
    for i in range(16):
        s_ = s_wall + sg * (1.35 + (dep - 2.1) * i / 15)
        x, z = F.P(a0 + 0.2, s_)
        bar(g, (x, 1.15, z), (x, 2.6, z), 0.035, IRON, shade=0.9)
        g.face([(x - 0.05, 2.6, z), (x + 0.05, 2.6, z), (x, 2.75, z)], IRON, out=F.v(-1, 0), shade=0.9)
    for yy in (1.35, 2.45):
        bar(g, F.p(a0 + 0.2, s_wall + sg * 1.25, yy), F.p(a0 + 0.2, s_out - sg * 0.65, yy), 0.04, IRON, shade=0.9)
    for s_ in (s_wall + sg * 0.95, s_out - sg * 0.4):
        box(g, F, a0 - 0.1, a0 + 0.5, min(s_ - 0.3, s_ + 0.3), max(s_ - 0.3, s_ + 0.3), FOOT, 2.9, PWHITE, skip=("-y",))
        x, z = F.P(a0 + 0.2, s_)
        urn(g, (x, 2.9, z), 0.7, PWHITE)
    kerb(g, [F.P(a0 + 0.2, s_out - sg * 0.2), F.P(a1, s_out - sg * 0.2)], 0.2, FOOT, 3.2, PBRICK, caps=(False, True))
    # the gravel path along the aisle wall, the angels on pedestals facing the path
    am = (a0 + a1) / 2
    for i in range(10):
        a = a0 + 2.2 + i * (am - 3.0 - a0 - 2.2) / 9
        s_ = s_out - sg * 0.75
        box(g, F, a - 0.3, a + 0.3, min(s_ - 0.3, s_ + 0.3), max(s_ - 0.3, s_ + 0.3), -0.1, 0.55, PWHITE, skip=("-y",))
        x, z = F.P(a, s_)
        fx, fz = F.V(0, -sg)
        figure(g, x, 0.55, z, 1.6, (fx, fz), PALE, arm=1 if i % 2 else -1)
        # a wing each side
        bx_, bz_ = F.V(1, 0)
        for w_ in (-1, 1):
            bar(g, (x + bx_ * 0.16 * w_, 1.25, z + bz_ * 0.16 * w_), (x + bx_ * 0.34 * w_ - fx * 0.12, 1.95, z + bz_ * 0.34 * w_ - fz * 0.12), 0.06,
                PALE, h=0.3, k=1.05)
    # the rock mound: three terraces rising to the crucifix at the middle, against the aisle wall
    for tier, (h0, h1, span, depth_) in enumerate(((0.0, 2.6, 10.0, dep * 0.95), (2.4, 5.2, 6.5, dep * 0.75), (5.0, 7.6, 3.6, dep * 0.55))):
        n = int(span / 1.1) + 2
        for i in range(n):
            a = am - span / 2 + span * i / (n - 1) + rng.uniform(-0.3, 0.3)
            s_ = s_wall + sg * (depth_ * rng.uniform(0.35, 0.6))
            x, z = F.P(a, s_)
            rock(g, (x, h0, z), rng.uniform(1.1, 1.8), h1 - h0 + rng.uniform(-0.3, 0.4), depth_ * rng.uniform(0.7, 1.0), rng)
    # the Holy Sepulchre's grotto at the mound's foot: a dark round mouth, a white figure lying in it
    x, z = F.P(am, s_wall + sg * dep * 0.95)
    Wg = Wall(g, F.P(am - 1.0, s_wall + sg * (dep * 0.97)), F.P(am + 1.0, s_wall + sg * (dep * 0.97)), F.V(0, sg), 0, 0, BLUE)
    extrude(g, Wg, [(0.1 + 0.9 * (1 - math.cos(math.pi * i / 10)), 1.8 * math.sin(math.pi * i / 10)) for i in range(11)], -0.05, 0.3, ART,
            cell="a_dark", skip_edges=(10,))
    # the crucifix on the top, the Virgin and St John beside it, a few prophets and evangelists on the terraces
    x, z = F.P(am, s_wall + sg * dep * 0.3)
    bar(g, (x, 7.4, z), (x, top + 2.6, z), 0.22, WOOD, shade=0.8)
    tx, tz = F.V(1, 0)
    bar(g, (x - tx * 1.1, top + 1.8, z - tz * 1.1), (x + tx * 1.1, top + 1.8, z + tz * 1.1), 0.12, WOOD, h=0.2, shade=0.8)
    fx, fz = F.V(0, sg)
    lathe(g, (x + fx * 0.14, top - 0.2, z + fz * 0.14), [(0.12, 0.0), (0.16, 0.9), (0.2, 1.5), (0.1, 1.75), (0.13, 1.95), (0.0, 2.2)], 6, PALE)
    bar(g, (x - tx * 0.95 + fx * 0.14, top + 1.72, z - tz * 0.95 + fz * 0.14), (x + tx * 0.95 + fx * 0.14, top + 1.72, z + tz * 0.95 + fz * 0.14),
        0.09, PALE)
    for d, arm in ((-1.6, 1), (1.6, -1)):
        x2, z2 = F.P(am + d, s_wall + sg * dep * 0.5)
        figure(g, x2, 5.2, z2, 1.7, (fx, fz), PALE, arm=arm)
    for a, h0, sd in ((am - 4.0, 2.6, 0.75), (am + 4.0, 2.6, 0.75), (am - 2.6, 2.6, 0.55), (am + 2.6, 2.6, 0.55)):
        x2, z2 = F.P(a, s_wall + sg * dep * sd)
        figure(g, x2, h0, z2, 1.65, (fx, fz), PALE)
    for i, a in enumerate(np.arange(am + 6.2, a1 - 1.0, 2.1)):
        s_ = s_out - sg * 1.0
        box(g, F, a - 0.35, a + 0.35, min(s_ - 0.35, s_ + 0.35), max(s_ - 0.35, s_ + 0.35), -0.1, 0.7, PWHITE, skip=("-y",))
        x2, z2 = F.P(a, s_)
        figure(g, x2, 0.7, z2, 1.7, (fx, fz), PALE, arm=1 if i % 2 else -1)


def stpaul(g, fr):
    g.grp = "church_stpaul"
    F, D, S = frame_west_end(fr)
    c = PF
    BD, NV, AO, AE, AR, NE, RID, CL, CH, TX0, TX1, CHE = (c[k] for k in ("BD", "NV", "AO", "AE", "AR", "NE", "RID", "CL", "CH", "TX0", "TX1", "CHE"))
    CO = S - BD
    B_, Wt_ = PBRICK, PWHITE
    nb = 5
    bays = [BD + (TX0 - BD) * i / nb for i in range(nb + 1)]
    plinth = [(FOOT, 0.9, Wt_)]
    wb = lambda *ys: [(y - 0.3, y, Wt_) for y in ys]  # noqa: E731  white stone bands in the brick
    g.grime = grime_under((NE - 0.4, AE - 0.3, 6.8))
    # ================= the west front (17th century, its top rebuilt 1680-81) and the Baroque portal of 1734
    DW, DH = c["DOOR_W"]
    door = Hc(NV, DW, 0.15, DH, "round", "open" if c["OPEN"] else "door_r", depth=0.9, rmat=Wt_)
    if c["OPEN"]:
        real(door, "St Paul's, the west door", kind="door")
    Ww = gwall(g, F, (BD, -NV), (BD, NV), (-1, 0), FOOT, NE, B_, top=[(0, NE), (NV, RID), (2 * NV, NE)], frame=Wt_,
               wins=[(NV, 4.4, 11.4, 18.6, 4, "goth4", "St Paul's, the west front, the great window over the door")], extra=[door],
               bands=plinth + wb(10.2, NE))
    disc(g, Ww, NV, 22.3, 0.95, "rose", d_front=-0.14, d_back=0.05, sides=14, side_mat=Wt_)
    gable_coping(g, Ww, 0, 2 * NV, NE, RID, Wt_, crockets=False)
    for sg in (-1, 1):
        x, z = F.P(BD - 0.2, sg * (NV - 0.3))
        pinnacle(g, x, NE - 0.4, z, 0.8, 3.6, Wt_)
        gbuttress(g, F, BD, sg * NV, (-1, 0), 1.0, BD - 0.02, 12.5, 18.8, mat=Wt_, pin=2.8)
    # the portal: paired pilasters and columns of white stone on pedestals, an entablature breaking forward, a relief
    # of the Virgin giving the rosary to St Dominic, a pediment with Mary, Paul and Dominic
    Fd = F
    a_w = BD
    ped_y1 = 1.4
    for s_ in (-2.4, -1.5, 1.5, 2.4):
        pedestal(g, Fd, a_w, s_, 0.3, 0.62, FOOT, ped_y1, mat=BLUE)
        if abs(s_) < 2:
            column(g, Fd, a_w - 0.31, s_, ped_y1, 6.1, 0.26, "ionic")
        else:
            pilaster(g, Fd, a_w, s_, 0.28, 0.22, ped_y1, 6.1, mat=Wt_)
    arch_band(g, Ww, NV, 0.15, DH - DW / 2, DW, 0.22, -0.16, Wt_)
    stack(g, F, a_w, -2.75, 2.75, [(6.1, 6.45, 0.4, Wt_), (6.45, 6.75, 0.34, BLUE), (6.75, 7.1, 0.72, Wt_)],
          [(s - 0.36, s + 0.36, 0.3) for s in (-2.4, -1.5, 1.5, 2.4)])
    extrude(g, Ww, [(NV - 1.9, 7.1), (NV + 1.9, 7.1), (NV + 1.9, 9.32), (NV - 1.9, 9.32)], -0.4, 0.0, Wt_, k=0.95, skip_edges=(0, 2))
    for d_, arm in ((-0.55, 1), (0.55, -1)):
        x, y, z = Ww.pt(NV + d_, 7.15, -0.62)
        figure(g, x, y, z, 1.95, (Ww.n.x, Ww.n.y), PALE, arm=arm)
    for i in range(12):
        ang = math.pi * i / 11
        if 0.2 < ang < math.pi - 0.2:
            extrude(g, Ww, [(NV, 8.55), (NV + 0.7 * math.cos(ang - 0.1), 8.55 + 0.7 * math.sin(ang - 0.1)),
                            (NV + 0.7 * math.cos(ang + 0.1), 8.55 + 0.7 * math.sin(ang + 0.1))], -0.46, -0.38, GILT)
    tri_pediment(g, Ww, NV, 2.5, 9.5, 1.5, -0.5, mat=Wt_, fill=Wt_)
    for d_, yy in ((-2.35, 9.35), (0.0, 11.1), (2.35, 9.35)):
        x, y, z = Ww.pt(NV + d_, yy, -0.35)
        figure(g, x, y, z, 1.5, (Ww.n.x, Ww.n.y), PALE, arm=1 if d_ <= 0 else -1)
    # ================= the aisles: west fronts, the cross gables over each bay, windows (south), blind panels (north)
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * AO))
        gwall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, AE, B_, frame=Wt_, bands=plinth + wb(6.8, AE),
              wins=[((AO - NV) / 2, 2.6, 3.4, 9.2, 2, "goth2", "St Paul's, the %s aisle's west window" % ("north" if sg > 0 else "south"))])
        gbuttress(g, F, BD, sg * AO, (-1, 0), 1.0, BD - 0.02, 7.0, 9.8, mat=Wt_, pin=2.4)
        prof = []
        for i in range(nb):
            prof += [(bays[i] - BD, AE), ((bays[i] + bays[i + 1]) / 2 - BD, AR)]
        prof.append((TX0 - BD, AE))
        if sg < 0:
            wins = [((bays[i] + bays[i + 1]) / 2 - BD, 2.8, 3.2, 12.9, 4, "goth4", "St Paul's, the south aisle, bay %d" % (i + 1)) for i in range(nb)]
            W = gwall(g, F, (BD, sg * AO), (TX0, sg * AO), (0, sg), FOOT, AR, B_, top=prof, frame=Wt_, wins=wins, bands=plinth + wb(AE))
        else:
            # (from over the chapels' ceiling, under their roof: issue #10, no face of the shell in the hall)
            W = gwall(g, F, (BD, sg * AO), (TX0, sg * AO), (0, sg), CL - 0.3, AR, B_, top=prof, frame=Wt_, bands=wb(AE),
                      wins=[((bays[0] + bays[1]) / 2 - BD, 2.4, CH + 0.4, 13.1, 2, "goth2", "St Paul's, the north aisle, bay 1, over the chapels")])
            for i in range(1, nb):
                blind_panel(g, W, (bays[i] + bays[i + 1]) / 2 - BD, 2.4, CH + 0.4, 13.1, Wt_)
        for i in range(nb):
            gable_coping(g, W, bays[i] - BD, bays[i + 1] - BD, AE, AR, Wt_, crockets=False, ends=(i == 0, i == nb - 1))
        for a in bays[1:-1]:
            if sg < 0:
                gbuttress(g, F, a, sg * AO, (0, sg), 0.85, 0.75, 7.5, 10.2, mat=Wt_, pin=2.2)
        # the north chapels along the nave
        if sg > 0:
            gwall(g, F, (BD, CO), (TX0, CO), (0, 1), FOOT, CL, B_, frame=Wt_, bands=plinth + wb(CL),
                  wins=[((bays[i] + bays[i + 1]) / 2 - BD, 1.6, 2.0, 5.8, 2, "goth2", "St Paul's, a north chapel, bay %d" % (i + 1)) for i in range(nb)])
            gwall(g, F, (BD, AO), (BD, CO), (-1, 0), FOOT, CH, B_, top=[(0, CH), (CO - AO, CL)], frame=Wt_, bands=plinth)
            for a in bays[1:-1]:
                gbuttress(g, F, a, CO, (0, 1), 0.8, BD - 0.02, 5.6, None, mat=Wt_, pin=1.8)
            lean_to(g, F, BD, TX0, CO, AO, CL, CH, oe=0.28, og=(0.3, 0.0), caps=(True, True, False))
        Fr = F.rot()
        for i in range(nb):
            first = i == 0
            ss0, ss1 = sorted((sg * NV, sg * AO))
            og = (0.0, 0.6) if sg > 0 else (0.6, 0.0)
            caps_end = (False, True) if sg > 0 else (True, False)
            gable_roof(g, Fr, ss0, ss1, bays[i], bays[i + 1], AE, AR, oe=(0.4 if first else 0.0, 0.0), og=og,
                       caps=(first, False, caps_end[0], caps_end[1]))
        # the clerestory: four-light windows, a white stone cornice
        W = gwall(g, F, (BD, sg * NV), (TX0, sg * NV), (0, sg), AE - 0.5, NE, B_, frame=Wt_, bands=wb(NE),
                  wins=[((bays[i] + bays[i + 1]) / 2 - BD, 2.4, 15.2, 19.6, 3, "goth4",
                         "St Paul's, the nave's clerestory, %s side, bay %d" % ("north" if sg > 0 else "south", i + 1)) for i in range(nb)])
        p0, p1 = F.P(BD, sg * NV), F.P(TX0, sg * NV)
        ring_stack(g, [p0, p1], [(NE - 0.3, NE - 0.1, 0.16, Wt_), (NE - 0.1, NE + 0.02, 0.26, Wt_)], closed=False,
                   side=open_side(p0, p1, F.V(0, sg)), caps=(False, False))
    # the Calvary against the south aisle
    calvary(g, F, BD, TX0, -AO, -(S - 0.25))
    # ================= nave and choir roof; transept: the north front with its portal, the south one against the houses
    gable_roof(g, F, BD, CHE, -NV, NV, NE, RID, oe=(0.4, 0.4), og=(0.35, 0.0), caps=(True, True, True, False))
    bar(g, F.p(BD + 0.5, 0, RID + 0.26), F.p(CHE, 0, RID + 0.26), 0.24, LEAD, h=0.15, shade=0.85)
    TE = S - BD
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * TE))
        # (issue #10: no face of the shell inside the hall: where the aisle, and on the north the chapels, run on
        # into the transept's arm, the west face stands only over their roofs)
        ua = (0.0, AO - NV) if sg > 0 else (TE - AO, TE - NV)
        wcut = [(ua[0], ua[1], FOOT - 0.1, AE)] + ([(AO - NV, TE - NV, FOOT - 0.1, CL)] if sg > 0 else [])
        gwall(g, F, (TX0, s_a), (TX0, s_b), (-1, 0), FOOT, NE, B_, frame=Wt_, bands=plinth + wb(NE), cuts=wcut,
              wins=[((TE - NV) * (0.78 if sg > 0 else 0.22), 2.0, 11.0, 17.8, 2, "goth2",
                     "St Paul's, the %s transept's west face" % ("north" if sg > 0 else "south"))])
        if sg > 0:
            gwall(g, F, (TX1, NV), (TX1, TE), (1, 0), FOOT, NE, B_, frame=Wt_, bands=plinth + wb(NE),
                  wins=[((TE - NV) / 2, 2.0, 11.0, 17.8, 2, "goth2", "St Paul's, the north transept's east face")])
        else:
            gwall(g, F, (TX1, -TE), (TX1, -(NV + 8.0)), (1, 0), FOOT, NE, B_, frame=Wt_, bands=plinth + wb(NE))
        extra = []
        if sg > 0:
            DNW, DNH = c["DOOR_N"]
            extra = [Hc((TX1 - TX0) / 2, DNW, 0.15, DNH, "pointed", "door_g", depth=0.9, rmat=Wt_)]
        Wt = gwall(g, F, (TX0, sg * TE), (TX1, sg * TE), (0, sg), FOOT, NE, B_, top=[(0, NE), ((TX1 - TX0) / 2, RID), (TX1 - TX0, NE)],
                   frame=Wt_, extra=extra, bands=plinth + wb(7.0, NE),
                   wins=[((TX1 - TX0) / 2, 4.8, 8.2 if sg > 0 else 4.6, 18.4, 4, "goth4",
                          "St Paul's, the %s transept's great window" % ("north" if sg > 0 else "south"), True)])
        if sg > 0:
            DNW, DNH = c["DOOR_N"]
            gportal(g, Wt, (TX1 - TX0) / 2, DNW, 0.15, DNH - head_h("pointed", DNW), 2, Wt_, P=0.7, gable=True, statues=1, fig_mat=PALE,
                    top_extra=1.0)
            disc(g, Wt, (TX1 - TX0) / 2, 21.9, 1.0, "rose", d_front=-0.12, d_back=0.05, sides=14, side_mat=Wt_)
        gable_coping(g, Wt, 0, TX1 - TX0, NE, RID, Wt_)
        for a in (TX0 + 0.6, TX1 - 0.6):
            gbuttress(g, F, a, sg * TE, (0, sg), 0.9, BD - 0.02, 13.0, 19.2, mat=Wt_, pin=2.8)
    gable_roof(g, F.rot(), -TE, TE, TX0, TX1, NE, RID, oe=(0.4, 0.4), og=(0.35, 0.35))
    # ================= the long choir and the apse
    for sg, a0_ in ((1, TX1), (-1, TX1 + 8.0)):
        W = gwall(g, F, (a0_, sg * NV), (CHE, sg * NV), (0, sg), 7.0, NE, B_, frame=Wt_, bands=wb(NE),
                  wins=[(a - a0_, 2.0, 11.2, 19.2, 2, "goth2", "St Paul's, the choir, %s side, window %d" % ("north" if sg > 0 else "south", j + 1), True)
                        for j, a in enumerate((55.0, 60.2, 65.4)) if a > a0_ + 1.5])
        p0, p1 = F.P(a0_, sg * NV), F.P(CHE, sg * NV)
        ring_stack(g, [p0, p1], [(NE - 0.3, NE - 0.1, 0.16, Wt_), (NE - 0.1, NE + 0.02, 0.26, Wt_)], closed=False,
                   side=open_side(p0, p1, F.V(0, sg)), caps=(False, False))
        for a in (57.6, 62.8, 67.6):
            if a > a0_ + 0.8:
                gbuttress(g, F, a, sg * NV, (0, sg), 0.8, 0.7, 13.0, 18.6, mat=Wt_, pin=2.6)
    P5 = apse_pts(CHE, NV)
    for i in range(5):
        a, b = P5[i], P5[i + 1]
        mid = ((a[0] + b[0]) / 2 - CHE, (a[1] + b[1]) / 2)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        gwall(g, F, a, b, mid, FOOT, NE, B_, frame=Wt_, bands=plinth + wb(NE), wins=[(L / 2, 1.8, 10.4, 18.6, 2, "goth2", "St Paul's, the apse, window %d" % (i + 1), True)])
    AP = [F.P(a, s) for a, s in P5]
    ring_stack(g, AP, [(NE - 0.3, NE - 0.1, 0.16, Wt_), (NE - 0.1, NE + 0.02, 0.26, Wt_)], closed=False, side=open_side(AP[1], AP[2], F.V(1, 0)),
               caps=(False, False))
    for P_ in P5[1:-1]:
        rd = Vector((P_[0] - CHE, P_[1])).normalized()
        gbuttress(g, F, P_[0], P_[1], (rd.x, rd.y), 0.8, 0.6, 12.0, 18.4, mat=Wt_, pin=2.6)
    apse_roof(g, F, CHE, NV, NE, RID, oe=0.4)
    # ================= the convent round the choir: the north wing, the south wing behind the tower
    g.grime = grime_under((9.0 - 0.3,))
    DE = D - M
    VE, VR = 9.0, 14.0
    for sg in (1, -1):
        s_in = NV if sg > 0 else NV + 8.0
        s_out = S - M
        a_st = TX1 if sg > 0 else TX1 + 8.0
        W = wall(g, F, (TX1, sg * s_out), (DE, sg * s_out), (0, sg), FOOT, VE, B_, bands=plinth + wb(4.6),
                 holes=[Hc(a - TX1, 1.1, yb, yb + 1.8, "rect", "hwin", depth=0.22) for yb in (1.4, 5.6) for a in np.arange(53.5, DE - 1.2, 3.2)])
        for a in np.arange(53.5, DE - 1.2, 3.2):
            for yb in (1.4, 5.6):
                rect_frame(g, W, a - TX1, 1.1, yb, yb + 1.8, 0.12, -0.08, mat=Wt_, ears=0.05)
        wall(g, F, (DE, sg * s_in), (DE, sg * s_out), (1, 0), FOOT, VE, B_, top=[(0, VE), ((s_out - s_in) / 2, VR), (s_out - s_in, VE)],
             bands=plinth, holes=[Hc(uc, 1.1, yb, yb + 1.8, "rect", "hwin", depth=0.22, rmat=PWHITE) for yb in (1.4, 5.6)
                                  for uc in ((3.0, (s_out - s_in) - 3.0) if s_out - s_in > 8 else ((s_out - s_in) / 2,))])
        wall(g, F, (a_st if sg < 0 else CHE, sg * s_in), (DE, sg * s_in), (0, -sg), FOOT, VE, B_, bands=plinth)
        ss0, ss1 = sorted((sg * s_in, sg * s_out))
        oe = (0.4, 0.0) if sg < 0 else (0.0, 0.4)
        caps = (sg < 0, sg > 0, False, True)
        gable_roof(g, F, a_st if sg < 0 else TX1, DE, ss0, ss1, VE, VR, oe=oe, og=(0.0, 0.3), caps=caps)
    wall(g, F, (DE, -NV), (DE, -(NV + 8.0)), (1, 0), FOOT, 10.2, B_, top=[(0, 10.2), (8.0, 8.0)], bands=plinth)
    wall(g, F, (CHE, -NV), (DE, -NV), (0, 1), FOOT, 10.2, B_, bands=plinth)
    lean_to(g, F, TX1 + 8.0, DE, -(NV + 8.0), -NV, 8.0, 10.2, oe=0.0, og=(0.0, 0.3), caps=(False, False, True))
    garden_wall(g, [F.P(DE - 0.2, -NV), F.P(DE - 0.2, NV)], 3.8, B_, coping=Wt_)
    # ================= the tower (1679-82, Millich): a closed square brick base of five storeys with white stone drip
    # mouldings and small round windows, the white octagonal belfry with Ionic three-quarter columns and two tiers of
    # openings, the ribbed cupola, the balustrade, the open lantern of eight arches, the little dome, the orb and cross
    g.grime = grime_under((4.8, 9.6, 14.4, 19.2, 24.0, 30.0, 36.0))
    TW0, TW1, TS0, TS1 = TX1, TX1 + 8.0, -NV, -(NV + 8.0)
    tc = F.P((TW0 + TW1) / 2, (TS0 + TS1) / 2)
    T1 = 24.0
    tb = plinth + [(y - 0.28, y, Wt_) for y in (4.8, 9.6, 14.4, 19.2)] + [(T1 - 0.6, T1, Wt_)]
    for fi, (A, Bq, out) in enumerate((((TW0, TS0), (TW0, TS1), (-1, 0)), ((TW1, TS1), (TW1, TS0), (1, 0)), ((TW0, TS1), (TW1, TS1), (0, -1)),
                                       ((TW1, TS0), (TW0, TS0), (0, 1)))):
        if fi == 3:
            y0 = NE - 1.0
        elif fi == 0:
            y0 = NE - 1.0
        else:
            y0 = FOOT
        holes = [Hc(4.0, 0.8, h0, h0 + 1.7, "round", "round", depth=0.3, rmat=Wt_) for h0 in (10.8, 15.6, 20.4) if h0 > y0 + 0.5
                 and not (fi in (1, 2) and h0 > 20)]
        W = wall(g, F, A, Bq, out, y0, T1, B_, bands=[b for b in tb if b[1] > y0 + 0.01], holes=holes)
        for h_ in holes:
            arch_band(g, W, 4.0, h_.yb, h_.yt - 0.4, 0.8, 0.14, -0.1, Wt_)
        if fi in (1, 2):
            disc(g, W, 4.0, 22.0 - 0.3, 1.0, "clock", d_front=-0.12, d_back=0.05, sides=12, side_mat=Wt_)
            clock_mark("stpaul_%d" % fi, W.pt(4.0, 22.0 - 0.3, -0.12), W.out(), 1.0)
    sq = rect_pts(F, TW0, TW1, TS0, TS1)
    ring_stack(g, sq, [(T1 - 0.2, T1 + 0.05, 0.22, Wt_), (T1 + 0.05, T1 + 0.35, 0.4, Wt_)])
    R8, rot8 = 3.7, math.pi / 8
    oct_ = [(tc[0] + R8 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + R8 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)]
    ring_between(g, tc, sq, oct_, T1 + 0.35, LEAD)
    O1, O2 = T1 + 0.3, T1 + 12.0
    OM = (O1 + O2) / 2
    oc = poly_walls(g, tc, R8, 8, rot8, O1, O2, Wt_,
                    holes=lambda i, L: [Hc(L / 2, 1.1, O1 + 0.9, OM - 0.6, "round", "louv_r", depth=0.4, rmat=Wt_),
                                        Hc(L / 2, 1.1, OM + 0.6, O2 - 1.3, "round", "louv_r", depth=0.4, rmat=Wt_)])
    for i in range(8):
        am = rot8 + 2 * math.pi * i / 8
        # an Ionic three-quarter column at each corner, over both tiers
        x, z = tc[0] + (R8 + 0.05) * math.cos(am), tc[1] + (R8 + 0.05) * math.sin(am)
        lathe(g, (x, O1, z), [(0.34, 0.0), (0.3, 0.2), (0.26, 0.35), (0.24, O2 - O1 - 1.2), (0.3, O2 - O1 - 1.0), (0.36, O2 - O1 - 0.9)], 8, Wt_,
              rot=am)
        a_, b_ = oct_[i], oct_[(i + 1) % 8]
        amid = rot8 + 2 * math.pi * (i + 0.5) / 8
        Wl = Wall(g, a_, b_, (math.cos(amid), math.sin(amid)), 0, 0, Wt_)
        for yb, yt in ((O1 + 0.9, OM - 0.6), (OM + 0.6, O2 - 1.3)):
            arch_band(g, Wl, Wl.L / 2, yb, yt - 0.55, 1.1, 0.14, -0.1, Wt_)
        extrude(g, Wl, [(0.3, OM - 0.2), (Wl.L - 0.3, OM - 0.2), (Wl.L - 0.3, OM), (0.3, OM)], -0.14, 0.0, Wt_)
    ring_stack(g, oc, [(O2 - 0.9, O2 - 0.5, 0.3, Wt_), (O2 - 0.5, O2 - 0.3, 0.36, BLUE), (O2 - 0.3, O2, 0.5, Wt_)])
    # the cupola with eight ribs
    cup = [(R8 * 0.98, 0.0), (3.45, 1.1), (2.9, 2.3), (2.0, 3.2), (1.25, 3.7), (1.25, 3.95)]
    lathe(g, (tc[0], O2 - 0.02, tc[1]), cup, 8, LEAD, rot=rot8)
    for i in range(8):
        am = rot8 + 2 * math.pi * i / 8
        pts = [(tc[0] + r * math.cos(am) * 1.03, O2 + y, tc[1] + r * math.sin(am) * 1.03) for r, y in cup[:-1]]
        for p, q in zip(pts, pts[1:]):
            bar(g, p, q, 0.16, Wt_, h=0.14, k=1.02)
    # the balustrade round the cupola's crown, the open lantern of eight arches with herms, the little dome, the orb
    L0 = O2 + 3.9
    oc2 = [(tc[0] + 1.25 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + 1.25 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)]
    parapet(g, [(tc[0] + 1.7 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + 1.7 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)], L0, 0.85,
            Wt_, closed=True)
    ring_between(g, tc, [(tc[0] + 1.9 * math.cos(rot8 + 2 * math.pi * i / 8), tc[1] + 1.9 * math.sin(rot8 + 2 * math.pi * i / 8)) for i in range(8)],
                 oc2, L0, Wt_)
    for i in range(8):
        am = rot8 + 2 * math.pi * i / 8
        x, z = tc[0] + 1.2 * math.cos(am), tc[1] + 1.2 * math.sin(am)
        lathe(g, (x, L0, z), [(0.16, 0.0), (0.12, 0.3), (0.1, 2.4), (0.18, 2.6), (0.18, 2.8)], 6, Wt_, rot=am)
    ring_band(g, oc2, L0 + 2.8, L0 + 3.1, 0.2, Wt_)
    g.face([(p[0], L0 + 2.8, p[1]) for p in reversed(oc2)], Wt_, out=(0, -1, 0), k=0.7)
    lathe(g, (tc[0], L0 + 3.08, tc[1]), [(1.38, 0.0), (1.1, 0.5), (0.7, 0.95), (0.35, 1.3), (0.25, 1.55)], 8, LEAD, rot=rot8)
    lathe(g, (tc[0], L0 + 4.55, tc[1]), [(0.0, 0.0), (0.26, 0.12), (0.34, 0.36), (0.26, 0.6), (0.0, 0.72)], 8, GILT, rot=rot8)
    gilt_cross(g, tc[0], L0 + 5.2, tc[1], 1.9)
    g.grime = None


# ------------------------------------------------------------------ Sint-Jacobskerk


# St James's numbers (build_churches.py frame_west_end: a east from the west front, s: + north (world -z), - south)
JF = dict(BD=0.8, NV=6.0, AO=14.0, CO=20.5, CL=8.2, CH=10.2, AE=15.0, AH=19.5, NE=26.5, RID=34.0, TW=13.0, TX0=45.0, TX1=57.0,
          CHE=64.0, CR=6.0, AMB=13.2, AMBE=12.0, OPEN=True, DOOR_W=(3.6, 6.2), DOOR_S=(3.0, 6.0))
# OPEN: the tower door a real opening (the interior in the game: client/src/world/gothicHall.ts); the south transept door stays painted


def stjacob(g, fr):
    g.grp = "church_stjacob"
    F, D, S = frame_west_end(fr)
    G = PBRAB
    c = JF
    BD, NV, AO, CO, CL, CH, AE, AH, NE, RID, TW, TX0, TX1, CHE, CR_, AMB, AMBE = (
        c[k] for k in ("BD", "NV", "AO", "CO", "CL", "CH", "AE", "AH", "NE", "RID", "TW", "TX0", "TX1", "CHE", "CR", "AMB", "AMBE"))
    TE = S - BD
    nb = 7
    bays = [TW + (TX0 - TW) * i / 5 for i in range(6)]  # five bays of the nave east of the tower
    bays_all = [BD] + bays
    g.grime = grime_under((NE - 0.5, AE - 0.4, CL - 0.3, 8.5, 18.0, 27.5, 37.0))
    plinth = [(FOOT, 0.8, G)]
    # ================= the west tower: five storeys, corner buttresses, the blunt top with two slate roofs
    TY = [0.0, 8.6, 18.0, 27.5, 37.0, 45.4]
    tb = plinth + [(y - 0.35, y, G) for y in TY[1:-1]]
    DW, DH = c["DOOR_W"]
    wd = "open" if c["OPEN"] else "door_g"
    # the west face: the portal (a broad basket arch in a frame), the great window, the belfry's two lights, blind panels
    door = Hc(NV, DW, 0.15, DH, "pointed", wd, depth=1.4, rmat=G)
    if c["OPEN"]:
        real(door, "St James's, the tower door", kind="door")
    bel = [(NV + sg * 2.4, 1.9, TY[3] + 1.2, TY[4] - 0.8, 2, "louv_p") for sg in (-1, 1)]
    Wt = gwall(g, F, (BD, -NV), (BD, NV), (-1, 0), FOOT, TY[5], G, bands=tb, extra=[door],
               wins=[(NV, 5.2, TY[1] + 1.2, TY[3] - 0.6, 4, "goth4", "St James's, the tower's great west window over the door")] + bel)
    pband(g, Wt, NV, DH - head_h("pointed", DW), DW + 0.1, 0.34, -0.3, G, yb=0.15)
    pband(g, Wt, NV, DH - head_h("pointed", DW), DW + 0.8, 0.3, -0.5, G, yb=0.15)
    # the Baroque shell over the portal (late 17th century): a fan of ribs in a round frame
    for i in range(9):
        a0_, a1_ = math.pi * i / 9, math.pi * (i + 1) / 9
        yc_ = DH + 0.5
        poly = [(NV, yc_), (NV + 1.3 * math.cos(a0_), yc_ + 1.3 * math.sin(a0_)), (NV + 1.3 * math.cos(a1_), yc_ + 1.3 * math.sin(a1_))]
        sk = () if i % 2 else tuple(e for e, on in ((0, i > 0), (2, i < 8)) if on)
        extrude(g, Wt, poly, -0.2 - 0.12 * (i % 2), 0.0, G, k=1.05, skip_edges=sk)
    for uc_ in (NV - 4.6, NV + 4.6):
        blind_panel(g, Wt, uc_, 1.2, TY[4] + 1.0, TY[5] - 1.2, G)
    for u in (NV - 2.4, NV + 2.4):
        blind_panel(g, Wt, u, 1.8, TY[4] + 1.0, TY[5] - 1.2, G)
    for sg in (-1, 1):
        # the tower's side faces (seen over the aisles), the east face over the nave roof
        s_ = sg * NV
        # (issue #10: open where the tower hall's arches to the aisles are, world/gothicHall.ts; no face in the hall)
        W = gwall(g, F, (BD, s_), (TW, s_), (0, sg), FOOT, TY[5], G, bands=tb, cuts=[(4.4, 8.0, FOOT - 0.1, 9.2)],
                  wins=[((TW - BD) / 2 + d, 1.9, TY[3] + 1.2, TY[4] - 0.8, 2, "louv_p") for d in (-2.4, 2.4)])
        for d in (-2.4, 2.4):
            blind_panel(g, W, (TW - BD) / 2 + d, 1.8, TY[2] + 0.8, TY[3] - 0.9, G)
            blind_panel(g, W, (TW - BD) / 2 + d, 1.8, TY[4] + 1.0, TY[5] - 1.2, G)
    W = gwall(g, F, (TW, NV), (TW, -NV), (1, 0), RID - 3.0, TY[5], G, bands=[(y - 0.35, y, G) for y in TY[3:5]],
              wins=[(NV + d, 1.9, TY[3] + 1.2, TY[4] - 0.8, 2, "louv_p") for d in (-2.4, 2.4)])
    tq = rect_pts(F, BD, TW, -NV, NV)
    tc = F.P((BD + TW) / 2, 0)
    for y in TY[1:-1]:
        ring_stack(g, tq, [(y - 0.35, y - 0.1, 0.18, G), (y - 0.1, y, 0.28, G)])
    # the four corner buttresses, stepping back three times, pinnacles on their offsets
    for (ca, cs) in ((BD, -NV), (BD, NV), (TW, -NV), (TW, NV)):
        for out in ((-1 if ca == BD else 1, 0), (0, -1 if cs < 0 else 1)):
            if ca == TW and out[0] == 1:
                continue  # the east ones stand in the nave's roof
            a_ = ca + (0.75 if ca == BD else -0.75) if out[0] == 0 else ca
            s_ = cs + (0.75 if cs < 0 else -0.75) if out[1] == 0 else cs
            dep = 0.75 if out[0] != 0 else 1.4
            gbuttress(g, F, a_, s_, out, 1.4, dep, 16.5, 30.0, mat=G, pin=0 if out[1] != 0 else 3.2)
            ox, oz = F.V(*out)
            bx, bz = F.P(a_, s_)
            if out[1] != 0:  # the third offset: a slimmer shaft up to the parapet (no pinnacle on the second)
                box(g, Frame((bx + ox * 0.3, bz + oz * 0.3), F.ua, F.us), -0.45, 0.45, -0.36, 0.36, 29.5, TY[5] - 0.2, G, skip=("-y",))
    # the parapet round the top, corner pinnacles, the two small slate roofs (the tower was never finished)
    inn = rect_pts(F, BD + 0.3, TW - 0.3, -NV + 0.3, NV - 0.3)
    ring_stack(g, tq, [(TY[5] - 0.55, TY[5] - 0.3, 0.2, G), (TY[5] - 0.3, TY[5], 0.32, G)])
    g.face([(p[0], TY[5] - 0.02, p[1]) for p in inn], LEAD, out=(0, 1, 0))
    ring_between(g, tc, tq, inn, TY[5], G)
    parapet(g, [F.P(BD + 0.15, -NV + 0.15), F.P(BD + 0.15, NV - 0.15), F.P(TW - 0.15, NV - 0.15), F.P(TW - 0.15, -NV + 0.15)],
            TY[5], 1.0, G, closed=True)
    for (ca, cs) in ((BD, -NV), (BD, NV), (TW, -NV), (TW, NV)):
        x, z = F.P(ca + (0.6 if ca == BD else -0.6), cs + (0.6 if cs < 0 else -0.6))
        pinnacle(g, x, TY[5], z, 0.7, 4.2, G)
    for sg in (-1, 1):
        s0_, s1_ = sorted((0.0, sg * (NV - 0.6)))
        am = (BD + TW) / 2
        pyramid(g, [F.p(BD + 0.6, s0_ + 0.1, TY[5]), F.p(TW - 0.6, s0_ + 0.1, TY[5]), F.p(TW - 0.6, s1_ - 0.1, TY[5]), F.p(BD + 0.6, s1_ - 0.1, TY[5])],
                F.p(am, (s0_ + s1_) / 2, TY[5] + 6.2), SLATE, shade=0.92)
        x, y, z = F.p(am, (s0_ + s1_) / 2, TY[5] + 6.1)
        cross(g, x, y, z, 1.3, cell="gilt")
    # ================= aisles, chapels, nave
    g.grime = grime_under((NE - 0.5, AE - 0.4, CL - 0.3))
    for sg in (-1, 1):
        # the west fronts of the aisle and the chapels
        s_a, s_b = sorted((sg * NV, sg * AO))
        top = [(0, AH), (AO - NV, AE)] if sg > 0 else [(0, AE), (AO - NV, AH)]
        gwall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, AH, G, top=top, bands=plinth,
              wins=[((AO - NV) / 2, 3.2, 5.6, 13.0, 4, "goth4", "St James's, the %s aisle's west window" % ("north" if sg > 0 else "south"))])
        if sg > 0:
            s_a, s_b = sorted((sg * AO, sg * CO))
            top = [(0, CH), (CO - AO, CL)]
            gwall(g, F, (BD, s_a), (BD, s_b), (-1, 0), FOOT, CH, G, top=top, bands=plinth,
                  wins=[((CO - AO) / 2, 1.6, 2.2, 6.4, 2, "goth2", "St James's, the north chapels' west window")])
        for s_, h1, h2 in ((sg * AO, 9.0, 13.5),) + (((sg * CO, 5.4, 7.2),) if sg > 0 else ()):
            gbuttress(g, F, BD, s_, (-1, 0), 1.0, BD - 0.02, h1, h2, mat=G, pin=2.4)
        # the chapels' outer wall along the nave, windows between buttresses (the south's first bay is the baptistery)
        a_ch0 = BD if sg > 0 else bays_all[1] + 0.6
        wins = [((bays_all[i] + bays_all[i + 1]) / 2 - a_ch0, 2.0, 2.2, 7.0, 2, "goth2",
                 "St James's, a %s chapel, bay %d" % ("north" if sg > 0 else "south", i + 1)) for i in range(len(bays_all) - 1)
                if (bays_all[i] + bays_all[i + 1]) / 2 > a_ch0 + 1.2]
        gwall(g, F, (a_ch0, sg * CO), (TX0, sg * CO), (0, sg), FOOT, CL, G, bands=plinth, wins=wins)
        p0, p1 = F.P(a_ch0, sg * CO), F.P(TX0, sg * CO)
        ring_stack(g, [p0, p1], [(CL - 0.35, CL - 0.12, 0.16, G), (CL - 0.12, CL + 0.02, 0.26, G)], closed=False, side=open_side(p0, p1, F.V(0, sg)),
                   caps=(True, False))
        # the aisle's upper wall over the chapels' roof, the clerestory, flying buttresses from the aisle's piers
        W = gwall(g, F, (BD, sg * AO), (TX0, sg * AO), (0, sg), CH - 0.6, AE, G,
                  wins=[((bays_all[i] + bays_all[i + 1]) / 2 - BD, 2.4, CH + 0.8, AE - 0.7, 3, "goth4",
                         "St James's, the %s aisle, bay %d, over the chapels" % ("north" if sg > 0 else "south", i + 1)) for i in range(len(bays_all) - 1)])
        p0, p1 = F.P(BD, sg * AO), F.P(TX0, sg * AO)
        ring_stack(g, [p0, p1], [(AE - 0.4, AE - 0.15, 0.18, G), (AE - 0.15, AE, 0.42, G)], closed=False, side=open_side(p0, p1, F.V(0, sg)),
                   caps=(True, False))
        parapet(g, [F.P(BD + 0.2, sg * (AO + 0.16)), F.P(TX0 - 0.2, sg * (AO + 0.16))], AE, 0.85, G,
                avoid=[F.P(a, sg * (AO + 0.16)) for a in bays[1:-1]])
        W = gwall(g, F, (TW, sg * NV), (TX0, sg * NV), (0, sg), AH - 0.6, NE, G,
                  wins=[((bays[i] + bays[i + 1]) / 2 - TW, 2.6, 20.4, 25.6, 3, "goth4",
                         "St James's, the nave's clerestory, %s side, bay %d" % ("north" if sg > 0 else "south", i + 1)) for i in range(5)])
        p0, p1 = F.P(TW, sg * NV), F.P(TX0, sg * NV)
        ring_stack(g, [p0, p1], [(NE - 0.45, NE - 0.15, 0.2, G), (NE - 0.15, NE, 0.42, G)], closed=False, side=open_side(p0, p1, F.V(0, sg)),
                   caps=(False, False))
        parapet(g, [F.P(TW + 0.45, sg * (NV + 0.16)), F.P(TX0 - 0.2, sg * (NV + 0.16))], NE, 0.9, G,
                avoid=[F.P(a, sg * (NV + 0.16)) for a in bays[1:-1]])
        for a in bays[1:-1]:
            # the chapels' buttress (low), the aisle's pier with its pinnacle, the flyer to the clerestory
            gbuttress(g, F, a, sg * CO, (0, sg), 0.9, 0.75, 5.8, 7.6, mat=G, pin=1.8)
            box(g, Frame(F.P(a, sg * (AO + 0.45)), F.ua, F.us), -0.45, 0.45, -0.45, 0.45, AE - 0.3, AE + 3.2, G, skip=("-y", "-s" if sg > 0 else "+s"))
            x, z = F.P(a, sg * (AO + 0.45))
            pinnacle(g, x, AE + 3.2, z, 0.8, 3.0, G)
            fly(g, F.p(a, sg * (AO + 0.1), AE + 2.4), F.p(a, sg * (NV + 0.05), NE - 3.2), 0.42, 0.6, G)
            box(g, Frame(F.P(a, sg * (NV + 0.25)), F.ua, F.us), -0.35, 0.35, -0.25, 0.25, AH - 0.3, NE - 0.4, G, skip=("-y", "-s" if sg > 0 else "+s"))
        if sg > 0:
            lean_to(g, F, BD, TX0, sg * CO, sg * AO, CL, CH, oe=0.6, og=(0.3, 0.0), caps=(True, True, False))
        else:
            lean_to(g, F, bays_all[1] + 0.6, TX0, sg * CO, sg * AO, CL, CH, oe=0.6, og=(0.0, 0.0), caps=(True, False, False))
        lean_to(g, F, BD, TX0, sg * AO, sg * NV, AE, AH, oe=0.0, og=(0.3, 0.0), caps=(False, True, False))
    wall(g, F, (BD, -AO), (bays_all[1] + 0.6, -AO), (0, -1), FOOT, CH - 0.6, G, bands=plinth)
    wall(g, F, (bays_all[1] + 0.6, -AO), (bays_all[1] + 0.6, -CO), (-1, 0), FOOT, CL, G, bands=plinth)
    # the baptistery (1804): a round domed chapel south of the tower, in the first chapel's place
    bc = F.P((BD + bays_all[1] + 0.6) / 2, -(AO + CO) / 2)
    Rb = min((bays_all[1] + 0.6 - BD) / 2, (CO - AO) / 2) - 0.1
    oc = poly_walls(g, bc, Rb, 12, 0.0, FOOT, 6.6, PWHITE,
                    holes=lambda i, L: [Hc(L / 2, L * 0.5, 2.4, 5.0, "round", "round", depth=0.3, rmat=PWHITE)] if i % 3 == 1 else [],
                    bands=[(FOOT, 0.7, BLUE)])
    ring_stack(g, oc, [(6.1, 6.35, 0.14, PWHITE), (6.35, 6.6, 0.26, PWHITE)])
    lathe(g, (bc[0], 6.55, bc[1]), [(Rb * 1.02, 0.0), (Rb * 0.95, 0.9), (Rb * 0.75, 1.8), (Rb * 0.4, 2.5), (0.3, 2.75), (0.3, 3.1)], 12, LEAD)
    lathe(g, (bc[0], 9.6, bc[1]), [(0.0, 0.0), (0.2, 0.1), (0.25, 0.3), (0.0, 0.55)], 8, GILT)
    gable_roof(g, F, TW, CHE, -NV, NV, NE, RID, oe=(0.0, 0.0), og=(0.0, 0.0), caps=(False, False, False, False))
    bar(g, F.p(TW + 0.06, 0, RID + 0.26), F.p(CHE, 0, RID + 0.26), 0.26, LEAD, h=0.16, shade=0.85)
    # ================= transept: great windows, gables with crockets, corner turrets; the south portal (1864)
    for sg in (-1, 1):
        s_a, s_b = sorted((sg * NV, sg * TE))
        # (issue #10: from the ground, but only over the roofs where the aisle and the chapels run on into the arm: no
        # face of the shell in the hall, and none missing beyond the chapels)
        ua = (0.0, AO - NV) if sg > 0 else (TE - AO, TE - NV)
        uc = (AO - NV, CO - NV) if sg > 0 else (TE - CO, TE - AO)
        gwall(g, F, (TX0, s_a), (TX0, s_b), (-1, 0), FOOT, NE, G, bands=plinth, cuts=[(ua[0], ua[1], FOOT - 0.1, AE), (uc[0], uc[1], FOOT - 0.1, CL)],
              wins=[((TE - NV) - (22.0 - NV) if sg > 0 else 22.0 - NV, 2.4, 15.8, 23.8, 3, "goth4",
                     "St James's, the %s transept's west face" % ("north" if sg > 0 else "south"))])
        # (issue #10: from the ground beyond the choir's aisle, where there was no face)
        ub = (0.0, AMB - NV) if sg > 0 else (TE - AMB, TE - NV)
        gwall(g, F, (TX1, s_a), (TX1, s_b), (1, 0), FOOT, NE, G, bands=plinth, cuts=[(ub[0], ub[1], FOOT - 0.1, AMBE - 0.6)],
              wins=[((TE - NV) - (21.0 - NV) if sg > 0 else 21.0 - NV, 2.4, 15.0, 23.4, 3, "goth4",
                     "St James's, the %s transept's east face" % ("north" if sg > 0 else "south"))])
        extra = []
        if sg < 0:
            DSW, DSH = c["DOOR_S"]
            extra = [Hc((TX1 - TX0) / 2, DSW, 0.15, DSH, "pointed", "door_g", depth=1.0, rmat=G)]
        Wt = gwall(g, F, (TX0, sg * TE), (TX1, sg * TE), (0, sg), FOOT, NE, G, top=[(0, NE), ((TX1 - TX0) / 2, RID), (TX1 - TX0, NE)],
                   bands=plinth, extra=extra, wins=[((TX1 - TX0) / 2, 5.6, 10.2 if sg < 0 else 5.4, 23.6, 6, "goth4",
                                                     "St James's, the %s transept's great window" % ("north" if sg > 0 else "south"), True)])
        if sg < 0:
            gportal(g, Wt, (TX1 - TX0) / 2, DSW, 0.15, DSH - head_h("pointed", DSW), 3, G, P=0.9, gable=True, statues=1, fig_mat=PALE, top_extra=1.2)
        # (the coping from the corner turrets up: they stand on its feet)
        cut_ = 1.4
        gable_coping(g, Wt, cut_, TX1 - TX0 - cut_, NE + (RID - NE) * cut_ / ((TX1 - TX0) / 2), RID, G, ends=(False, False))
        for a in (TX0, TX1):
            x, z = F.P(a + (0.55 if a == TX0 else -0.55), sg * (TE - 0.55))
            oc = poly_walls(g, (x, z), 0.8, 8, math.pi / 8, NE - 3.0, NE + 1.6, G)
            lathe(g, (x, NE + 1.55, z), [(0.84, 0.0), (0.0, 3.4)], 8, G, rot=math.pi / 8)
            pinnacle(g, x, NE + 4.6, z, 0.3, 1.2, G)
        for a in (TX0 + 0.6, TX1 - 0.6):
            gbuttress(g, F, a, sg * TE, (0, sg), 1.1, BD - 0.02, 12.0, 21.0, mat=G, pin=3.0)
        for a, da in ((TX0, -1), (TX1, 1)):
            gbuttress(g, F, a, sg * (TE - 0.65), (da, 0), 1.1, 0.8, 12.0, 21.0, mat=G, pin=3.0)
        p0, p1 = F.P(TX0, sg * NV), F.P(TX0, sg * TE)
    gable_roof(g, F.rot(), -TE, TE, TX0, TX1, NE, RID, oe=(0.45, 0.45), og=(0.35, 0.35))
    x, z = F.P((TX0 + TX1) / 2, 0)
    ridge_turret(g, x, z, RID - 0.6, 1.1, 7.5, G, LEAD)
    # ================= choir, apse, ambulatory with its three radiating chapels, flyers
    for sg in (-1, 1):
        gwall(g, F, (TX1, sg * NV), (CHE, sg * NV), (0, sg), 16.5, NE, G,
              wins=[((CHE - TX1) / 2, 2.2, 18.0, 25.4, 2, "goth2", "St James's, the choir's clerestory, %s side" % ("north" if sg > 0 else "south"), True)])
        p0, p1 = F.P(TX1, sg * NV), F.P(CHE, sg * NV)
        ring_stack(g, [p0, p1], [(NE - 0.45, NE - 0.15, 0.2, G), (NE - 0.15, NE, 0.34, G)], closed=False, side=open_side(p0, p1, F.V(0, sg)),
                   caps=(False, False))
        gwall(g, F, (TX1, sg * AMB), (CHE, sg * AMB), (0, sg), FOOT, AMBE, G, bands=plinth,
              wins=[((CHE - TX1) / 2, 2.6, 3.0, 10.2, 3, "goth4", "St James's, the %s choir aisle's window" % ("north" if sg > 0 else "south"))])
        lean_to(g, F, TX1, CHE, sg * AMB, sg * NV, AMBE, 17.0, oe=0.4, og=(0.0, 0.0), caps=(True, False, False))
        fly(g, F.p((TX1 + CHE) / 2, sg * (AMB + 0.2), AMBE + 1.6), F.p((TX1 + CHE) / 2, sg * (NV + 0.05), NE - 3.0), 0.4, 0.55, G)
        gbuttress(g, F, (TX1 + CHE) / 2, sg * AMB, (0, sg), 1.0, 0.8, 8.0, 11.5, mat=G, pin=3.4)
    P5 = apse_pts(CHE, CR_)
    for i in range(5):
        a, b = P5[i], P5[i + 1]
        mid = ((a[0] + b[0]) / 2 - CHE, (a[1] + b[1]) / 2)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        gwall(g, F, a, b, mid, 16.5, NE, G, wins=[(L / 2, 2.0, 18.0, 25.4, 2, "goth2", "St James's, the apse's clerestory, window %d" % (i + 1), True)])
    AP = [F.P(a, s) for a, s in P5]
    ring_stack(g, AP, [(NE - 0.45, NE - 0.15, 0.2, G), (NE - 0.15, NE, 0.34, G)], closed=False, side=open_side(AP[1], AP[2], F.V(1, 0)),
               caps=(False, False))
    apse_roof(g, F, CHE, CR_, NE, RID, oe=0.45)
    PA = apse_pts(CHE, AMB)
    for i in range(5):
        a, b = PA[i], PA[i + 1]
        mid = ((a[0] + b[0]) / 2 - CHE, (a[1] + b[1]) / 2)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if 1 <= i <= 3:
            # a radiating chapel (1626-38): a shallow three-sided bay out of this side, its own roof
            md = Vector(mid).normalized()
            tn = Vector((b[0] - a[0], b[1] - a[1])).normalized()
            dp = 1.5
            q0 = Vector(a) + tn * 0.9
            q3 = Vector(b) - tn * 0.9
            q1 = q0 + md * dp + tn * 0.9
            q2 = q3 + md * dp - tn * 0.9
            wall(g, F, tuple(a), tuple(q0), tuple(md), FOOT, AMBE, G, bands=plinth)
            wall(g, F, tuple(q3), tuple(b), tuple(md), FOOT, AMBE, G, bands=plinth)
            cname = {1: "the south-east radiating chapel", 2: "Rubens's chapel in the axis", 3: "the north-east radiating chapel"}[i]
            for j, (p_, q_) in enumerate(((q0, q1), (q1, q2), (q2, q3))):
                nrm = Vector((q_.y - p_.y, -(q_.x - p_.x)))
                if nrm.dot(md) < 0:
                    nrm = -nrm
                Lq = (q_ - p_).length
                gwall(g, F, tuple(p_), tuple(q_), tuple(nrm), FOOT, AMBE - 1.0, G, bands=plinth,
                      wins=[(Lq / 2, min(1.6, Lq * 0.55), 2.6, AMBE - 2.4, 2, "goth2", "St James's, %s, window %d" % (cname, j + 1))] if Lq > 1.5 else [])
            pts = [F.p(p_.x, p_.y, AMBE - 1.0) for p_ in (q0, q1, q2, q3)]
            ctr = (q0 + q3) / 2
            pyramid(g, pts, F.p(ctr.x, ctr.y, AMBE + 1.4), SLATE, shade=0.9)
        else:
            gwall(g, F, a, b, mid, FOOT, AMBE, G, bands=plinth,
                  wins=[(L / 2, 3.0, 2.8, 10.4, 3, "goth4", "St James's, the ambulatory, %s side" % ("south" if i == 0 else "north"))])
    for P_ in PA[1:-1]:
        rd = Vector((P_[0] - CHE, P_[1])).normalized()
        gbuttress(g, F, P_[0], P_[1], (rd.x, rd.y), 0.9, 0.8, 8.0, 11.0, mat=G, pin=3.0)
        q = Vector(P_) + rd * 0.3
        qi = Vector((CHE, 0)) + rd * (CR_ + 0.05)
        fly(g, F.p(q.x, q.y, AMBE + 1.2), F.p(qi.x, qi.y, NE - 3.4), 0.36, 0.5, G)
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
    # ================= the sacristy (north of the choir) and the churchyard wall with its headstones
    g.grime = grime_under((7.6,))
    SQ0, SQ1, SA1 = AMB, S - M, 68.0
    gwall(g, F, (TX1, SQ1), (SA1, SQ1), (0, 1), FOOT, 8.0, G, bands=plinth,
          wins=[(a - TX1, 1.4, 2.6, 6.2, 2, "goth2") for a in (59.5, 63.5)])
    gwall(g, F, (SA1, SQ1), (SA1, SQ0), (1, 0), FOOT, 8.0, G, top=[(0, 8.0), ((SQ1 - SQ0) / 2, 12.2), (SQ1 - SQ0, 8.0)], bands=plinth,
          wins=[((SQ1 - SQ0) / 2, 1.4, 2.6, 6.2, 2, "goth2")])
    wall(g, F, (CHE, SQ0), (SA1, SQ0), (0, -1), FOOT, 8.0, G, bands=plinth)
    gable_roof(g, F, TX1, SA1, SQ0, SQ1, 8.0, 12.2, oe=(0.3, 0.4), og=(0.0, 0.3), caps=(True, True, False, True))
    cw = 0.225
    CWH = 2.5
    yard = [[(BD - cw, CO + 0.3), (BD - cw, S - M - cw), (TX0 + 0.3, S - M - cw)],
            [(SA1, S - M - cw), (D - M - cw, S - M - cw), (D - M - cw, -(S - M - cw)), (TX1 - 0.3, -(S - M - cw))],
            [(TX0 + 0.3, -(S - M - cw)), (BD - cw, -(S - M - cw)), (BD - cw, -(CO + 0.3))]]
    for pl in yard:
        pts = [F.P(a, s) for a, s in pl]
        kerb(g, pts, cw, FOOT, CWH - 0.2, G, caps=(False, False), top=False)
        kerb(g, pts, cw + 0.08, CWH - 0.25, CWH, BLUE, caps=(False, False))
    rng = np.random.default_rng(6155)
    for a0_, a1_, sg in ((3.0, 42.0, 1), (9.0, 42.0, -1), (60.0, 76.0, -1)):
        for a in np.arange(a0_, a1_, 5.5):
            s = sg * (CO + 1.8 + rng.uniform(0, 3.5)) if a < 44 else sg * (AMB + 5.0 + rng.uniform(0, 7.0))
            if a > 58 and abs(s) < AMB + 3.0:
                continue
            h = rng.uniform(0.7, 1.1)
            x, z = F.P(a + rng.uniform(-1, 1), s)
            box(g, Frame((x, z), F.ua, F.us), -0.06, 0.06, -0.3, 0.3, -0.1, h, BLUE, skip=("-y",), k=0.9)
    g.grime = None


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
    # the bank's lip over the water: 3 to 8 cm over it, a little up and down (the water lies at -0.35)
    BANK_TOP = 0.012
    bank_y = [-0.32 + 0.05 * (0.5 + 0.5 * math.sin(j * 0.9) * math.cos(j * 0.37 + 1.3)) for j in range(npd)]
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
        # the park pass (2026-09-26): a natural bank of trodden earth and grass sloping from the lawn (the
        # rim's outer edge, a hair over the ground) down to a muddy lip over the water, as Keilig gave the old
        # moat a soft, winding edge; stones and reeds on it here and there (the stones below, the reeds in the game)
        ya, yb = bank_y[j], bank_y[j2]
        g.face([(a.x, ya, a.y), (b.x, yb, b.y), (c.x, BANK_TOP, c.y)], BANK, out=(0, 1, 0), k=1.3)
        g.face([(a.x, ya, a.y), (c.x, BANK_TOP, c.y), (d.x, BANK_TOP, d.y)], BANK, out=(0, 1, 0), k=1.3)
        g.face([(a.x, -1.0, a.y), (b.x, -1.0, b.y), (b.x, yb, b.y), (a.x, ya, a.y)], BANK, out=(-n_.x, 0, -n_.y), shade=0.4)
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

    solids = {"railing": [], "piers": [], "benches": [], "lanterns": [], "bridge_rails": [], "rocks": []}

    def rock(c, r, h, y0, seed, sides=7):
        """A lump of rough stone (rocaille, or a stone on the bank): jittered rings narrowing to a crown."""
        rr = random.Random(seed)
        sq = rr.uniform(0.75, 1.0)
        ca, sa_ = math.cos(rr.uniform(0, math.pi)), math.sin(rr.uniform(0, math.pi))
        rings = [(1.0, 0.0), (1.08, 0.3), (0.9, 0.62), (0.55, 0.9)]
        h = min(h, 1.35 * r)
        R_ = []
        for fr, fy in rings:
            ring_ = []
            for k_ in range(sides):
                a_ = 2 * math.pi * (k_ + rr.uniform(-0.25, 0.25)) / sides
                rad = r * fr * rr.uniform(0.82, 1.18)
                dx, dz = math.cos(a_) * rad, math.sin(a_) * rad
                u_, v_ = (dx * ca + dz * sa_) * sq, -dx * sa_ + dz * ca  # squashed along a random direction
                dx, dz = u_ * ca - v_ * sa_, u_ * sa_ + v_ * ca
                ring_.append(Vector((c[0] + dx, y0 + h * fy + rr.uniform(-0.06, 0.06) * h, c[1] + dz)))
            R_.append(ring_)
        apex = Vector((c[0] + rr.uniform(-0.15, 0.15) * r, y0 + h, c[1] + rr.uniform(-0.15, 0.15) * r))
        ctr = Vector((c[0], y0 + h * 0.45, c[1]))
        tris_ = []
        for ra, rb in zip(R_, R_[1:]):
            for k_ in range(sides):
                a_, b_, c_, d_ = ra[k_], ra[(k_ + 1) % sides], rb[(k_ + 1) % sides], rb[k_]
                tris_ += [(a_, b_, c_), (a_, c_, d_)]
        for k_ in range(sides):
            tris_.append((R_[-1][k_], R_[-1][(k_ + 1) % sides], apex))
        for tri in tris_:
            fc = sum(tri, Vector()) / 3
            g.face([tuple(v) for v in tri], ROCK, out=tuple(fc - ctr), k=1.15)

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

        # the park pass (2026-09-26): Keilig's footbridge of 1869 is an iron suspension bridge, painted white,
        # its ends set in masses of artificial rock (rocaille). The planks and the walk over them stay as they
        # were (park.json deck: rijnkaai.ts walks on it); iron stringers, pylons, the chains, the hangers and a
        # light iron railing replace the timber posts and rails; nothing stands in the water.
        for sa, sb in zip(st, st[1:]):
            ya, yb = ytop(sa), ytop(sb)
            g.face([pt(sa, -HW, ya), pt(sb, -HW, yb), pt(sb, HW, yb), pt(sa, HW, ya)], WOOD, out=(0, 1, 0))
            g.face([pt(sa, -HW, ya - 0.14), pt(sb, -HW, yb - 0.14), pt(sb, HW, yb - 0.14), pt(sa, HW, ya - 0.14)], WOOD, out=(0, -1, 0), k=0.5)
            for sg in (-1, 1):
                g.face([pt(sa, sg * HW, ya - 0.16), pt(sb, sg * HW, yb - 0.16), pt(sb, sg * HW, yb + 0.02), pt(sa, sg * HW, ya + 0.02)], WIRON,
                       out=(nn.x * sg, 0, nn.y * sg), shade=0.8)
        for sv, sg in ((0.0, -1), (span, 1)):
            y = ytop(sv)
            g.face([pt(sv, -HW, y - 0.14), pt(sv, HW, y - 0.14), pt(sv, HW, y), pt(sv, -HW, y)], WOOD, out=(bdir.x * sg, 0, bdir.y * sg))
        ROFF = HW + 0.07  # the railing, the hangers and the chains: just outside the deck's edge
        pA, pB = wA - 0.2, wB + 0.2  # the pylons, on the bank at each end
        PT = ytop(wA) + 2.3  # the pylons' tops
        smid = (pA + pB) / 2
        ymid = ytop(smid) + 1.06

        def chain_y(sv):
            if sv <= pA:
                return 0.6 + (PT - 0.6) * (sv + 0.7) / (pA + 0.7)
            if sv >= pB:
                return 0.6 + (PT - 0.6) * (span + 0.7 - sv) / (span + 0.7 - pB)
            u = (sv - smid) / (pB - smid)
            return ymid + (PT - ymid) * u * u

        def rail_y(sv):
            x = min(max(sv, 0.0), span)
            for k_ in range(len(st) - 1):
                if st[k_] <= x <= st[k_ + 1]:
                    f_ = (x - st[k_]) / (st[k_ + 1] - st[k_])
                    return ytop(st[k_]) + (ytop(st[k_ + 1]) - ytop(st[k_])) * f_
            return ytop(x)

        # rocaille: a mass of artificial rock on each side of each end, where the chains are anchored
        anchor = {}
        for e_, sgn in ((e0, 1), (e1, -1)):
            for sg in (-1, 1):
                # beside the straight approach to the bridge (tools/city/park.py APPROACH: 2.2 m of gravel), 1.2 m back
                # from the ramp's foot, clear of the gravel (the park check) and of the water
                cc = e_ - bdir * sgn * 1.2 + nn * sg * (1.1 + 0.3 + 0.85)
                for _ in range(30):  # back from the water (the waist's banks curve away beside the bridge)
                    if not inside((cc.x, cc.y), pond) and poly_dist((cc.x, cc.y), pond) >= 1.05:
                        break
                    cc = cc - bdir * sgn * 0.12
                anchor[(sgn, sg)] = cc
                seed = int(abs(cc.x * 13.1 + cc.y * 7.7))
                rock((cc.x, cc.y), 0.85, 1.2, -0.1, seed)
                for off_, r_, h_, k_ in (((0.6, -0.55), 0.6, 0.7, 1), ((-0.05, -0.8), 0.5, 0.45, 2)):
                    q = cc + nn * sg * off_[0] + bdir * sgn * off_[1]
                    if not inside((q.x, q.y), pond) and poly_dist((q.x, q.y), pond) >= r_ + 0.2:
                        rock((q.x, q.y), r_, h_, -0.1, seed + k_)
                rc = cc + nn * sg * 0.3 - bdir * sgn * 0.35
                solids["rocks"].append(orect((rc.x, rc.y), bdir, 1.3, 1.2))
        for sg in (-1, 1):
            # the pylons: a square iron post with a cap and a ball
            for sv in (pA, pB):
                base = pt(sv, sg * (ROFF + 0.04), 0)
                bar(g, (base[0], -0.1, base[2]), (base[0], PT, base[2]), 0.13, WIRON, shade=0.9)
                q = 0.1
                pyramid(g, [(base[0] - q, PT, base[2] - q), (base[0] + q, PT, base[2] - q), (base[0] + q, PT, base[2] + q),
                            (base[0] - q, PT, base[2] + q)], (base[0], PT + 0.12, base[2]), WIRON, shade=0.9)
                lathe(g, (base[0], PT + 0.1, base[2]), [(0.0, 0.0), (0.06, 0.03), (0.075, 0.09), (0.05, 0.15), (0.0, 0.17)], 6, WIRON, shade=0.9)
            # the chain: from its anchor in the rock over the pylon, down in a curve to the middle and up again
            ss = [pA + (pB - pA) * k_ / 14 for k_ in range(0, 15)]
            for sa, sb in zip(ss, ss[1:]):
                bar(g, pt(sa, sg * ROFF, chain_y(sa)), pt(sb, sg * ROFF, chain_y(sb)), 0.05, WIRON, h=0.075, shade=0.85)
            for sv, key in ((pA, (1, sg)), (pB, (-1, sg))):
                a_ = anchor[key]
                bar(g, pt(sv, sg * ROFF, PT - 0.05), (a_.x, 0.85, a_.y), 0.05, WIRON, h=0.075, shade=0.85)
            # the hangers: from the chain down to the deck's edge
            k_n = int((pB - pA) / 0.48)
            for k_ in range(1, k_n):
                sv = pA + (pB - pA) * k_ / k_n
                top = chain_y(sv) - 0.03
                bot = ytop(sv) - 0.12
                if top - bot > 0.15:
                    b_ = pt(sv, sg * ROFF, 0)
                    bar(g, (b_[0], bot, b_[2]), (b_[0], top, b_[2]), 0.022, WIRON, shade=0.85)
            # the railing: a handrail and a middle rail along the deck, a newel at each end
            rs = [0.18] + [x for x in st if 0.18 < x < span - 0.18] + [span - 0.18]
            for sa, sb in zip(rs, rs[1:]):
                for dy, w_ in ((0.93, 0.045), (0.48, 0.03)):
                    bar(g, pt(sa, sg * ROFF, rail_y(sa) + dy), pt(sb, sg * ROFF, rail_y(sb) + dy), w_, WIRON, shade=0.85)
            for sv in (0.18, span - 0.18):
                b_ = pt(sv, sg * ROFF, 0)
                y_ = rail_y(sv)
                bar(g, (b_[0], y_ - 0.2, b_[2]), (b_[0], y_ + 1.0, b_[2]), 0.075, WIRON, skip_ends=True, shade=0.9)
                lathe(g, (b_[0], y_ + 1.0, b_[2]), [(0.0, 0.0), (0.05, 0.02), (0.06, 0.07), (0.0, 0.12)], 6, WIRON, shade=0.9)
            c = e0 + bdir * (span / 2) + nn * sg * (HW + 0.06)
            solids["bridge_rails"].append(orect((c.x, c.y), bdir, span / 2, 0.08))
        # an arch of iron over the walk between the pylons at each end, a bar under it
        for sv in (pA, pB):
            Lf, Rt = Vector(pt(sv, -(ROFF + 0.04), 0)), Vector(pt(sv, ROFF + 0.04, 0))
            prev = None
            for k_ in range(9):
                f_ = k_ / 8
                q = Lf.lerp(Rt, f_)
                cur_ = (q.x, PT - 0.12 + 0.28 * math.sin(math.pi * f_), q.z)
                if prev:
                    bar(g, prev, cur_, 0.05, WIRON, h=0.07, shade=0.88)
                prev = cur_
            bar(g, (Lf.x, PT - 0.42, Lf.z), (Rt.x, PT - 0.42, Rt.z), 0.035, WIRON, shade=0.85)
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

    # ---- the park pass (2026-09-26): benches and lanterns along the gravel paths (decor.park.lines and rounds,
    # tools/city/park.py), stones on the bank, the little island in the west pond
    PK_ = city["decor"]["park"]
    plines = [([Vector(q) for q in L_["pts"]], L_["w"]) for L_ in PK_.get("lines", [])]
    rounds = [(Vector(r_[:2]), r_[2]) for r_ in PK_.get("rounds", [])]

    def path_edge(p):
        """How far p is from the nearest gravel (negative on it)."""
        d = 1e9
        for pts_, w_ in plines:
            for a_, b_ in zip(pts_, pts_[1:]):
                d = min(d, seg_dist((p.x, p.y), (a_.x, a_.y), (b_.x, b_.y)) - w_ / 2)
        for c_, r_ in rounds:
            d = min(d, (p - c_).length - r_)
        return d

    def spot_ok(p, clear_edge=1.2):
        q = (p.x, p.y)
        if not inside(q, ring) or poly_dist(q, ring) < clear_edge or not off_stairs(q, 2.0):
            return False
        if inside(q, pond_outer) or poly_dist(q, pond_outer) < 0.9:
            return False
        if bridge and seg_dist(q, bridge["from"], bridge["to"]) < 2.6:
            return False
        return all(not inside(q, r_) and poly_dist(q, r_) >= 0.8 for r_ in solids["rocks"])

    def along(pts_, step):
        """Points every `step` metres along a polyline, with the unit tangent there: (s, point, tangent)."""
        out_, acc_, nxt_ = [], 0.0, 0.0
        for a_, b_ in zip(pts_, pts_[1:]):
            L_ = (b_ - a_).length
            if L_ < 1e-6:
                continue
            t_ = (b_ - a_) / L_
            while nxt_ <= acc_ + L_:
                out_.append((nxt_, a_ + t_ * (nxt_ - acc_), t_))
                nxt_ += step
            acc_ += L_
        return out_, acc_

    placed = []
    lamp_at = []
    # a lantern inside each gate
    for i, s, w in openings:
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        t = (b - a).normalized()
        inw = Vector((-t.y, t.x)) if ccw else Vector((t.y, -t.x))
        for sg in (1, -1):
            c = a + t * (s + sg * (w / 2 + 0.2)) + inw * 1.3
            if inside((c.x, c.y), ring) and poly_dist((c.x, c.y), pond_outer) > 2 and off_stairs((c.x, c.y), 1.5) and path_edge(c) >= 0.25:
                lamp_at.append(Vector((c.x, c.y)))
                break
    # benches: beside a path, facing across it, where the pond lies beyond (the view is what a bench is for)
    cands = []
    for li, (pts_, w_) in enumerate(plines):
        pts_s, L_ = along(pts_, 1.0)
        for s_, q, t_ in pts_s:
            if s_ < 2.5 or s_ > L_ - 2.5:
                continue
            for sg in (-1, 1):
                nv = Vector((-t_.y, t_.x)) * sg
                c = q + nv * (w_ / 2 + 0.62)
                if not spot_ok(c) or path_edge(c) < 0.5 or min(path_edge(c + t_ * 1.05), path_edge(c - t_ * 1.05)) < 0.3:
                    continue
                hit = ray_hit(c, -nv, pond_outer)
                view = 2.0 if hit is not None and hit < 16 else 0.0
                cands.append((view + 0.2 * math.sin(li * 3.1 + s_ * 0.7), c, -nv))
    cands.sort(key=lambda x: -x[0])
    chosen = []
    for sc, c, f in cands:
        if len(chosen) >= 9:
            break
        if any((c - o).length < 12.0 for o, _ in chosen) or any((c - o).length < 3.0 for o in lamp_at):
            continue
        chosen.append((c, f))
    # and one at the round place by the wall, looking across it over the west pond
    for c_, r_ in rounds:
        u_ = (Vector((cA.x, cA.y)) - c_).normalized()
        chosen.append((c_ - u_ * (r_ + 0.75), u_))  # (on the grass behind the round's rim: nothing on the gravel)
    for c, f in chosen:
        bench((c.x, c.y), (f.x, f.y))
        placed.append(c)
    # lanterns: along the paths about every 15 m, now on one side, now on the other
    for li, (pts_, w_) in enumerate(plines):
        pts_s, L_ = along(pts_, 1.0)
        sg = 1 if li % 2 else -1
        last = -1e9
        for s_, q, t_ in pts_s:
            if s_ - last < 15.0 or s_ < 4.0 or s_ > L_ - 2.0:
                continue
            for side in (sg, -sg):
                c = q + Vector((-t_.y, t_.x)) * side * (w_ / 2 + 0.4)
                if not spot_ok(c, 1.0) or path_edge(c) < 0.25:
                    continue
                if any((c - o).length < 9.0 for o in lamp_at) or any((c - o).length < 3.0 for o in placed):
                    continue
                lamp_at.append(c)
                last = s_
                sg = -side
                break
    for c in lamp_at:
        lantern((c.x, c.y))
        placed.append(c)
    # stones on the bank, in stretches (not where the water runs up to the wall, not under the bridge)
    srng = random.Random(1869)
    nstones = 0
    for j in range(npd):
        if at_wall[j] or at_wall[j - 1]:
            continue
        stretch = 0.5 + 0.5 * math.sin(j * 0.41 + 0.3) * math.cos(j * 0.23 + 0.7)
        if stretch < 0.5 or srng.random() > 0.65:
            continue
        q = PV[j] + off[j] * srng.uniform(0.0, 0.3)
        if bridge and seg_dist((q.x, q.y), bridge["from"], bridge["to"]) < 1.6:
            continue
        rock((q.x, q.y), srng.uniform(0.16, 0.34), srng.uniform(0.22, 0.42), bank_y[j] - 0.16, 500 + j)
        nstones += 1
    # the island (Keilig's pond had one): a low mound of earth and grass where the west pond is widest,
    # a few stones round it; the game plants a young willow and reeds on it
    best = None
    xs_, zs_ = [p[0] for p in pond], [p[1] for p in pond]
    for x_ in np.arange(min(xs_), max(xs_), 0.5):
        for z_ in np.arange(min(zs_), max(zs_), 0.5):
            if not inside((x_, z_), pond):
                continue
            if bridge and seg_dist((x_, z_), bridge["from"], bridge["to"]) < 7.0:
                continue
            d_ = poly_dist((x_, z_), pond)
            if best is None or d_ > best[0]:
                best = (d_, Vector((x_, z_)))
    island = None
    if best and best[0] > 5.0:
        ic = best[1]
        IR = min(2.6, best[0] * 0.32)
        irng = random.Random(1870)
        iax = Vector((cB.x - cA.x, cB.y - cA.y)).normalized()
        iny = Vector((-iax.y, iax.x))
        prof = [(1.45, -0.8), (1.12, -0.36), (1.0, -0.28), (0.82, 0.02), (0.55, 0.16), (0.25, 0.24)]
        NS = 12
        jit = [irng.uniform(0.85, 1.15) for _ in range(NS)]
        R_ = []
        for fr, y_ in prof:
            R_.append([ic + (iax * math.cos(2 * math.pi * k_ / NS) * 1.35 + iny * math.sin(2 * math.pi * k_ / NS)) * IR * fr * jit[k_]
                       for k_ in range(NS)])
        for ri in range(len(prof) - 1):
            for k_ in range(NS):
                a_, b_ = R_[ri][k_], R_[ri][(k_ + 1) % NS]
                c_, d_ = R_[ri + 1][(k_ + 1) % NS], R_[ri + 1][k_]
                ya_, yb_ = prof[ri][1], prof[ri + 1][1]
                g.face([(a_.x, ya_, a_.y), (b_.x, ya_, b_.y), (c_.x, yb_, c_.y)], BANK, out=(a_.x - ic.x, 0.6, a_.y - ic.y), k=1.3)
                g.face([(a_.x, ya_, a_.y), (c_.x, yb_, c_.y), (d_.x, yb_, d_.y)], BANK, out=(a_.x - ic.x, 0.6, a_.y - ic.y), k=1.3)
        top = R_[-1]
        for k_ in range(NS):
            a_, b_ = top[k_], top[(k_ + 1) % NS]
            g.face([(a_.x, 0.24, a_.y), (b_.x, 0.24, b_.y), (ic.x, 0.27, ic.y)], BANK, out=(0, 1, 0), k=1.3)
        for k_ in range(0, NS, 2):
            q = R_[2][k_]
            rock((q.x, q.y), irng.uniform(0.18, 0.3), irng.uniform(0.25, 0.4), -0.45, 900 + k_)
        island = {"c": [round(ic.x, 3), round(ic.y, 3)], "r": round(IR, 3), "ax": [round(iax.x, 4), round(iax.y, 4)], "k": 1.35,
                  "top": 0.27, "land": [[round(q.x, 3), round(q.y, 3)] for q in R_[3]]}
    info = {
        "about": "Stadspark furniture (tools/blender/build_churches.py -> churches.glb, object 'park'). World x, z. "
                 "Rects are 4 corners. Solid for the walk map: railing (the stone kerb under the iron railing), piers, "
                 "benches, lanterns, bridge_rails, and the pond (its rim's outer edge) except the bridge deck, which "
                 "is walked on: deck = [distance from 'from', y of the planks]. The grass is drawn by the game; cut "
                 "the pond out of it (the water lies at water_y; the rim is a bank of earth sloping from rim_y at its outer edge down to the water). water = the water's own edge. rocks = the rocaille at the bridge's ends. island = the mound in the west pond (c, r, its axis ax stretched k, top y, land = its edge at the ground's height). water_wall = the two "
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
        "rim_y": BANK_TOP,
        "bridge": bridge,
        "island": island,
        **solids,
        "solids": [r for k in ("railing", "piers", "benches", "lanterns", "bridge_rails", "rocks") for r in solids[k]],
    }
    # nothing of the park may stand in or over the water but the footbridge (its planks, posts, rails)
    wet = []
    for pts_, _, _, mat_ in g.groups.get("park", []):
        if mat_ in (WATER, WOOD, WIRON) or max(p_.y for p_ in pts_) < 0.3:
            continue
        cx_ = sum(p_.x for p_ in pts_) / len(pts_)
        cz_ = sum(p_.z for p_ in pts_) / len(pts_)
        if inside((cx_, cz_), pond):
            wet.append((MATS[mat_], round(cx_, 2), round(cz_, 2)))
    wet_solids = [k_ for k_ in ("railing", "piers", "benches", "lanterns") for r_ in solids[k_]
                  if any(inside(tuple(q_), pond) for q_ in r_) or inside((sum(q_[0] for q_ in r_) / 4, sum(q_[1] for q_ in r_) / 4), pond)]
    print(f"[build_churches] park parts over the water: {len(wet)} faces {wet[:5]}, solids {wet_solids}")
    stats = {"water_wall": touch, "rail_m": round(rail_len, 1), "benches": len(solids["benches"]), "lanterns": len(solids["lanterns"]),
             "openings": len(openings), "bridge": bridge is not None, "rocks": len(solids["rocks"]), "bank_stones": nstones,
             "island": island and island["c"]}
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
                              export_draco_position_quantization=20, export_draco_texcoord_quantization=16,
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
                    item = (round(ov, 3), round(gap, 4), (round(c.x, 2), round(c.y, 2), round(c.z, 2)), T[i][3], T[i][4], T[j][3], T[j][4],
                            tuple(round(v, 2) for v in T[i][6]), [tuple(round(c_, 2) for c_ in v) for v in p], [tuple(round(c_, 2) for c_ in v) for v in q])
                    (fights if gap < 0.005 else close).append(item)
    flat0 = [t for t in T if abs(t[1].y) > 0.999 and abs(t[0][0].y) < 0.03]
    print(f"[build_churches] plane check: {len(T)} triangles, {len(fights)} pairs in one plane, {len(close)} pairs within 5 cm, "
          f"{len(flat0)} flat faces near y 0")
    from collections import Counter
    for lab, lst in (("one plane", fights), ("within 5 cm", close)):
        cnt = Counter((it[3], it[4], it[5], it[6]) for it in lst)
        for k_, v_ in cnt.most_common(12):
            print(f"   {lab} by part: {v_} x {k_}")
            ys_ = Counter(round(x[2][1], 1) for x in lst if (x[3], x[4], x[5], x[6]) == k_)
            print(f"        at y: {ys_.most_common(8)}")
            for yv, _ in ys_.most_common(10):
                it = next(x for x in lst if (x[3], x[4], x[5], x[6]) == k_ and round(x[2][1], 1) == yv)
                print(f"          y {yv}: at {it[2]} gap {it[1]} n {it[7] if len(it) > 7 else ''} A {it[8] if len(it) > 8 else ''} B {it[9] if len(it) > 9 else ''}")
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
    print(f"[build_churches] {clock_markers()} clock faces for live hands")
    print(f"[build_churches] real openings (issue #10): {opening_markers()} -> {SHELL_TS}")
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

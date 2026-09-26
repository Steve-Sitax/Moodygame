"""The town wall of Antwerp, 1873, modelled and painted by this script: the curtain walls along
the bent line, the bastions, the small guard towers with their guard houses, the four gates with
their stone bridges over the moat, the stairs up to the walk, and the tower mill on the middle
bastion.

    blender -b --factory-startup -P tools/blender/build_wall.py
    blender -b --factory-startup -P tools/blender/build_wall.py -- --preview [name,name]

Reads decor.rampart and decor.rampart_solids of shared/city.json (tools/city/rampart.py makes them;
its docstring says what each field means) and writes client/public/models/wall.glb (Draco). No
layout number lives here: the trace, the segments and their frames, the tops, bastions, towers,
huts, gates, bridges, stairs and the mill all come from the JSON. The numbers below are the look
(heights of parapets, the plinth, the gate towers, the mill's shape).

Frame: a game point (x, y, z) sits at Blender (x, -z, y). The glTF export turns Blender Z-up into
Y-up, so the glb loads in game coordinates. Every object but the sails has its origin at the world
origin; the game adds the scene as it is.

Objects:
  wall_chunk_<n>   the static wall cut into 100 m cells (walls, walk, parapets, towers, huts,
                   bastions, turrets, stairs, the mill's tower and cap), so the game can cull them
  gate_<id>        one gate house with its bridge over the moat
  mill_sails       the mill's four sails, the hub and the windshaft. Its origin is the hub, with
                   no rotation: the game turns it about the axle (MILL_AXLE, printed by the build)
                   with rotateOnAxis(axle, angle); a positive angle turns the sails anticlockwise
                   seen from the front, the way the mills here turn.
Materials (a small texture each, painted below, nearest filter; vertex colour "Col" carries the
shade, darker at the foot, under water and inside the arch):
  wall_brick, wall_quoin (brick with the pale corner stones), wall_plinth (grey stone), wall_stone
  (pale dressed stone: coping, voussoirs, treads), wall_cobble (the walk), wall_slate, wall_wood,
  wall_iron, wall_window, wall_grass, wall_arms (the lion shield), wall_lamp_glow (lantern glass:
  the game draws it bright), wall_canvas (the sail cloths).

Along the wall every part is placed in its segment's frame (o, t, n of decor.rampart.segments):
a = metres along t, o = metres out from the town face (o = T is the field face). The ring of the
walk (decor.rampart.tops) is swept edge by edge with mitred corners, whatever their angle.

What the game walks on and bumps into: the walk top is at h, the stair treads follow the line from
a (y 0) to b (y h), the landings are at h, the gate passage floor and the bridge decks are 2 cm over
the street (y 0.02), so they never fight the game's own ground. Every parapet, railing, guard house
and gate tower stands inside decor.rampart_solids.

--preview renders data/shots/wall_preview_*.png (a gate from the field, the walk, a stair, a
bastion from above, the whole ring) and close-ups of the joins (wall_close_*.png).
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402  (preview: aim, render)
import build_props as bp  # noqa: E402  (ROOT, speckle)

ROOT = bp.ROOT
CITY = os.path.join(ROOT, "shared", "city.json")
OUT = os.path.join(ROOT, "client", "public", "models", "wall.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

MATS = ["wall_brick", "wall_quoin", "wall_plinth", "wall_stone", "wall_cobble", "wall_slate", "wall_wood",
        "wall_iron", "wall_window", "wall_grass", "wall_arms", "wall_lamp_glow", "wall_canvas", "wall_moss_decal",
        "wall_room_glow", "wall_coping", "wall_lawn_decal", "wall_props"]
BRICK, QUOIN, PLINTH, STONE, COBBLE, SLATE, WOOD, IRON, WINDOW, GRASS, ARMS, GLOW, CANVAS, DECAL, ROOM, COPING, LAWN, PROPS = range(len(MATS))
# metres per texture repeat (u, v). Brick and quoin share one pixel size (about 122 px to the metre), so
# the courses run on from the brick into the corner stones. The brick (the look pass, 2026-09-26): Boom brick of
# 1873, 22 x 10.5 x 5.5 cm with 1 cm joints, in cross bond: 8 stretchers of 23 cm, 24 courses of 6.5 cm a repeat
TILE = {BRICK: (1.84, 1.56), QUOIN: (1.2, 1.56), PLINTH: (2.4, 2.4), STONE: (1.2, 1.2), COBBLE: (1.6, 1.6),
        SLATE: (1.2, 1.2), WOOD: (1.2, 1.2), IRON: (1.0, 1.0), WINDOW: (1.0, 1.0), GRASS: (3.0, 3.0),
        ARMS: (1.0, 1.0), GLOW: (1.0, 1.0), CANVAS: (1.8, 1.8), DECAL: (1.0, 1.0), ROOM: (3.3, 2.5),
        COPING: (1.0, 1.0), LAWN: (1.0, 1.0), PROPS: (1.0, 1.0)}
QW = 1.2  # the quoin strip at a corner (the width of its texture)
COURSE = 1.8 / 24  # the mill's course grid (7.5 cm; its bands and door snap to it, as built before the look pass)
PARK = os.path.join(ROOT, "client", "public", "models", "park.json")  # the Stadspark's pond, where it meets the wall
MOSS_TOUCH, MOSS_NEAR, MOSS_PAD = 0.3, 4.0, 2.0  # the pond touches the face within this (or, not yet built, comes this near); moss runs on this far
MOSS_OFF, MOSS_Y0, MOSS_Y1 = 0.02, -0.45, 1.8  # the moss decal: off the town face, from under the water to the plinth's top
MOSS_PX = 0.02  # metres per texel of the decal
QUOIN_TURN = math.radians(25.0)  # quoins only where the line turns more than this (not at the small bends)

# ---- the look (not the layout)
BATTER = 0.15  # the field face leans back this much from the foot to the walk
PL = 1.8  # the grey stone plinth
FOOT_LAND, FOOT_RIVER = -0.6, -4.0  # the foot of the wall under the ground, under the river bed
SEG = 4.0  # longest face along the wall (the game's textures swim on big faces)
GRID = 4.0  # the walk is cut on this grid
LIFT = 0.02  # passage floor and bridge deck over the game's ground
CHUNK = 100.0
TOWN_H, TOWN_T = 1.0, 0.42  # the parapet on the town side (height, thickness)
BW_O, BW_T = BATTER, 0.5  # the breastwork on the field side: its outer face, thickness
BW_H, EMB_Y0, EMB_Y1 = 1.3, 0.72, 1.12  # its height, the embrasures' sill and head
EMB_W, EMB_STEP = 0.5, 4.0
HIN = 0.12  # a guard house stands this far inside its rect
HUT_WALL, HUT_RISE, HUT_WT = 2.7, 2.1, 0.28
SPR = 3.3  # the gate arch springs here
TOWER_UP, ROOF_RISE = 6.0, 4.6  # gate towers rise this far over the walk; their roofs
MID_UP, FR_UP = 1.0, 1.9  # the middle over the passage (town side); the frontispiece's cornice
STEP_RISE = 0.18  # about: the stairs have round(h / 0.18) steps (36)
# the tower mill on the middle bastion (its foot is decor.rampart.mill r; heights over the walk)
MILL_SIDES = 20
MILL_PL = 0.75  # the stone plinth
MILL_BODY = 10.6  # the brick tower's top
MILL_TOP_R = 2.42  # its radius there
MILL_STAGE = 5.25  # a stone string course half way up
MILL_DOOR = 2.475  # the door case's top (a course line)
CAP_X = [-2.9, -2.5, -1.6, -0.4, 0.8, 1.8, 2.5, 2.8]  # the boat-shaped cap: stations along the axle
CAP_B = [0.55, 1.6, 2.35, 2.6, 2.55, 2.1, 1.3, 0.6]  # half widths
CAP_H = [1.1, 1.9, 2.45, 2.65, 2.6, 2.3, 1.8, 1.3]  # heights over the cap's foot
CAP_SEC = [(1.0, 0.0), (0.97, 0.28), (0.86, 0.55), (0.66, 0.78), (0.38, 0.93), (0.0, 1.0)]
HUB_OUT, HUB_UP = 3.55, 0.95  # the hub: out from the tower's axis, up from the cap's foot
TILT = math.radians(8.0)  # the windshaft rises this much toward the sails
SAIL_R, SAIL_IN = 9.3, 1.9  # the sails reach from SAIL_IN to SAIL_R off the hub
SAIL_W, SAIL_LEAD = 1.9, 0.35  # the lattice's width on the trailing side, the leading board
SAIL_STEP = 0.55  # between the sail bars


# ------------------------------------------------------------------ small helpers


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def B(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def tint(x, z):
    return 0.94 + 0.06 * math.sin(x * 0.11 + 1.3 * math.cos(z * 0.07)) * math.cos(z * 0.13 - x * 0.03)


def amb(p, floor):
    """Darker at the foot of a thing (its floor), dark and wet under the ground or the water."""
    dy = p[1] - floor
    s = 0.52 if dy < 0 else 0.62 + 0.38 * sm(dy / 1.8)
    return s * tint(p[0], p[2])


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def complement(cuts, L):
    cuts = sorted((max(0.0, a), min(L, b)) for a, b in cuts if b > 0 and a < L)
    out, cur = [], 0.0
    for a, b in cuts:
        if a > cur + 1e-6:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < L - 1e-6:
        out.append((cur, L))
    return out


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
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-12)))
    return (a + ab * t - p).length


def splits(a, b, step):
    n = max(1, math.ceil((b - a) / step - 1e-9))
    return [a + (b - a) * k / n for k in range(n + 1)]


# ------------------------------------------------------------------ textures


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


def C(*rgb):
    return np.array(rgb, dtype=np.float64)


# rows of the arrays run from the bottom of the picture (v = 0) up


def paint_brick(rng, w=128, h=96, px=4, blen=16):
    """Red brick in stretcher bond: 4 px courses (7.5 cm), 16 px bricks, grey lime mortar. (Before the look pass;
    still painted and thrown away, so the pictures painted after it keep their dice.)"""
    img = np.empty((h, w, 3))
    img[:] = C(0.50, 0.47, 0.42)
    for c in range(h // px):
        off = (c % 2) * (blen // 2)
        for b in range(w // blen + 1):
            u0 = b * blen + off
            r = rng.random()
            if r < 0.09:
                col = C(0.33, 0.16, 0.14) * rng.uniform(0.9, 1.1)  # an over-burnt brick
            elif r < 0.15:
                col = C(0.62, 0.35, 0.23)  # a pale one
            else:
                col = C(0.53, 0.25, 0.18) * rng.uniform(0.84, 1.1)
            for u in range(u0 + 1, u0 + blen):
                img[c * px + 1:(c + 1) * px, u % w] = col
    img *= (0.91 + 0.14 * noise2(rng, h, w, 6, 8))[..., None]
    return bp.speckle(img, rng, 0.06, 0.85, 0.95)


def paint_quoin(rng):
    """The brick at a corner with its quoins: a long stone (0.8 m) over a short one (0.45 m), each
    six courses high; u = 0 is the corner."""
    img = paint_brick(rng, 64, 96)
    stone = C(0.71, 0.67, 0.58)
    for k in range(4):
        v0 = k * 24
        wl = 43 if k % 2 == 0 else 24
        tone = rng.uniform(0.92, 1.05)
        blk = np.broadcast_to(stone * tone, (24, wl, 3)).copy()
        blk *= (0.9 + 0.16 * rng.random((24, wl, 1)))
        blk[0, :] = stone * 0.6
        blk[:, wl - 1] = stone * 0.6
        blk[1, :wl - 1] *= 0.9
        img[v0:v0 + 24, 0:wl] = blk
    return img


BR_CH, BR_SL = 8, 28  # the look pass: a brick course (6.5 cm) and a stretcher with its joint (23 cm), in pixels


def paint_brick_1873(rng, w=224, h=192):
    """Boom brick of 1873 in cross bond (the look pass, 2026-09-26; Steve: "the bricks look too big"): courses of
    stretchers and of headers by turns, every other stretcher course shifted half a brick, 1 cm lime joints. Each
    brick its own tone (the headers burnt darker more often), a lit upper arris and a shaded lower one, spalled faces,
    eroded joints, a faint haze of salts. Rows run from the bottom of the picture (v = 0) up."""
    img = np.empty((h, w, 3))
    mortar = C(0.50, 0.48, 0.43)
    img[:] = mortar
    img *= (0.9 + 0.16 * noise2(rng, h, w, 12, 14))[..., None]
    HL = BR_SL // 2
    for c in range(h // BR_CH):
        header = c % 2 == 1
        blen = HL if header else BR_SL
        off = HL // 2 if header else (0 if c % 4 == 0 else HL)
        y0 = c * BR_CH
        for b in range(w // blen + 2):
            u0 = b * blen + off
            r = rng.random()
            if r < (0.2 if header else 0.08):
                col = C(0.30, 0.15, 0.13) * rng.uniform(0.85, 1.12)  # over-burnt, purple-brown
            elif r < (0.26 if header else 0.15):
                col = C(0.64, 0.38, 0.26) * rng.uniform(0.92, 1.05)  # a pale, soft one
            elif r < 0.3:
                col = C(0.43, 0.26, 0.19) * rng.uniform(0.9, 1.08)  # brown
            else:
                col = C(0.52, 0.25, 0.17) * rng.uniform(0.84, 1.1)
            cols = [(u0 + k) % w for k in range(1, blen)]
            face = np.broadcast_to(col, (BR_CH - 1, blen - 1, 3)).copy()
            face *= (0.9 + 0.14 * rng.random((BR_CH - 1, blen - 1, 1)))
            face[0] *= 0.8  # the lower arris in its own shade
            face[-1] *= 1.1  # the upper arris catching the sky
            face[:, 0] *= 0.93
            if rng.random() < 0.07:  # a spalled face: the fired skin gone, rough and darker
                k0 = int(rng.integers(0, max(1, blen - 12)))
                k1 = min(blen - 1, k0 + int(rng.integers(6, 14)))
                face[1:-1, k0:k1] = col * 0.72 * (0.8 + 0.3 * rng.random((BR_CH - 3, k1 - k0, 1)))
            img[y0 + 1:y0 + BR_CH, cols] = face
            if rng.random() < 0.12:  # an eroded joint under this brick: sunk and dark
                img[y0, cols] = C(0.30, 0.28, 0.25) * rng.uniform(0.9, 1.1)
    img *= (0.88 + 0.18 * noise2(rng, h, w, 5, 6))[..., None]
    salt = np.clip(noise2(rng, h, w, 6, 5) - 0.72, 0, 1)[..., None] * 0.55  # a faint white haze of salts
    img = img * (1 - salt) + C(0.78, 0.76, 0.72) * salt
    return bp.speckle(img, rng, 0.05, 0.82, 0.97)


def paint_quoin_1873(rng):
    """The quoins over the new brick: a long stone (0.8 m) over a short one (0.45 m), each six courses (39 cm);
    u = 0 is the corner. 146 px for the strip's 1.2 m."""
    w, h = 146, 24 * BR_CH
    img = paint_brick_1873(rng, w, h)
    stone = C(0.71, 0.67, 0.58)
    sh = 6 * BR_CH
    for k in range(4):
        v0 = k * sh
        wl = 98 if k % 2 == 0 else 55
        tone = rng.uniform(0.92, 1.05)
        blk = np.broadcast_to(stone * tone, (sh, wl, 3)).copy()
        blk *= (0.9 + 0.14 * rng.random((sh, wl, 1)))
        blk *= (0.94 + 0.08 * noise2(rng, sh, wl, 3, 6))[..., None]
        blk[0, :] = stone * 0.6
        blk[:, wl - 1] = stone * 0.6
        blk[1, :wl - 1] *= 0.88
        blk[-1, :wl - 1] *= 1.05
        img[v0:v0 + sh, 0:wl] = blk
    return img


COPING_CELLS, COPING_W, COPING_H = 4, 128, 64  # the coping's picture: four slabs side by side, u along, v across


def paint_coping(rng):
    """Worn Belgian bluestone coping slabs (the look pass): four slabs side by side, each drawn with u along its
    length and v across its top. Blue-grey, weathered pale on top; tooled in fine strokes across the slab with a
    smooth drafted margin round the edge; cracks, chipped corners, grey-green lichen rosettes and a few orange ones,
    moss at the ends where the joints hold water."""
    W, H = COPING_W, COPING_H
    out = np.empty((H, W * COPING_CELLS, 3))
    yy, xx = np.mgrid[0:H, 0:W]
    for k in range(COPING_CELLS):
        base = C(0.46, 0.49, 0.52) * rng.uniform(0.86, 1.08)
        img = np.broadcast_to(base, (H, W, 3)).copy()
        img *= (0.86 + 0.2 * noise2(rng, H, W, 4, 6))[..., None]
        # the tooling: fine strokes across the slab (constant u), not on the drafted margin
        strokes = 0.965 + 0.07 * rng.random(W)
        edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy))
        margin = edge < 4
        img[~margin] *= strokes[None, :, None].repeat(H, 0)[~margin]
        img[margin] *= 1.05
        img[edge == 0] *= 0.78  # the arris
        # dirt toward the ends and one long side
        img *= (1.0 - 0.14 * np.clip(1 - np.minimum(xx, W - 1 - xx) / 18.0, 0, 1) - 0.06 * (yy / H))[..., None]
        # lichen: grey-green rosettes, a few orange
        for _ in range(int(rng.integers(6, 13))):
            cx, cy, r = rng.uniform(4, W - 4), rng.uniform(4, H - 4), rng.uniform(1.4, 3.8)
            d = np.hypot(xx - cx, yy - cy)
            img[d < r] = C(0.60, 0.64, 0.54) * rng.uniform(0.9, 1.08)
            img[(d >= r - 0.7) & (d < r)] = C(0.70, 0.73, 0.64)
        for _ in range(int(rng.integers(0, 3))):
            cx, cy, r = rng.uniform(4, W - 4), rng.uniform(4, H - 4), rng.uniform(0.8, 1.6)
            img[np.hypot(xx - cx, yy - cy) < r] = C(0.72, 0.50, 0.20)
        # moss at the ends, thick in the corners
        for u_end in (0, W - 1):
            d_end = np.abs(xx - u_end)
            corner = np.minimum(yy, H - 1 - yy)
            p = np.clip(1 - d_end / 7.0, 0, 1) * (0.35 + 0.65 * np.clip(1 - corner / 14.0, 0, 1))
            m = rng.random((H, W)) < p * (0.4 + 0.8 * noise2(rng, H, W, 6, 8))
            img[m] = C(0.20, 0.28, 0.09) * rng.uniform(0.75, 1.25, (int(m.sum()), 1))
        # cracks: a walk across the slab from a long edge
        for _ in range(int(rng.integers(0, 3))):
            x, y = rng.uniform(10, W - 10), (0.0 if rng.random() < 0.5 else H - 1.0)
            dy = 1.0 if y == 0 else -1.0
            dx = rng.uniform(-0.7, 0.7)
            for _s in range(int(rng.integers(18, 70))):
                xi, yi = int(x), int(y)
                if not (0 <= xi < W and 0 <= yi < H):
                    break
                img[yi, xi] = C(0.15, 0.16, 0.17)
                x += dx + rng.uniform(-0.6, 0.6)
                y += dy * rng.uniform(0.5, 1.0)
        # chipped corners: a small triangle of rough, darker stone
        for _ in range(int(rng.integers(1, 3))):
            cu = 0 if rng.random() < 0.5 else W - 1
            cv = 0 if rng.random() < 0.5 else H - 1
            s = rng.uniform(4, 9)
            m = (np.abs(xx - cu) + np.abs(yy - cv)) < s
            img[m] = base * 0.62 * (0.8 + 0.4 * rng.random((int(m.sum()), 1)))
        out[:, k * W:(k + 1) * W] = bp.speckle(img, rng, 0.06, 0.8, 0.96)
    return out


def paint_lawn_decal(rng, n=128):
    """The lawn's soft edges and worn paths (the look pass), RGBA with alpha 0 or 1 per texel. The top half: the
    edge band, u along the lawn's edge (it repeats), v from the lawn (v = 1) out over the setts (v = 0.5): blades,
    tussocks, straw and leaves, thick at the lawn and thinning out to a few tufts in the joints (a dither). The bottom
    half: a worn path, u along it, v across (0 .. 0.5): bare trodden earth and grit, ragged at both sides."""
    img = np.empty((n, n, 3))
    alpha = np.zeros((n, n), bool)
    hh = n // 2
    thr = np.tile(bayer4(), (n // 4, n // 4))
    # the edge band (rows hh .. n-1, from its outer side up to the lawn)
    v = (np.arange(hh) + 0.5) / hh  # 0 out on the setts .. 1 at the lawn
    blob = noise2(rng, hh, n, 4, 10)
    dens = np.clip(v[:, None] ** 1.6 * 1.25 + (blob - 0.5) * 0.55, 0, 1)
    a = dens > 0.5 * thr[:hh] + 0.5 * rng.random((hh, n))
    g = np.empty((hh, n, 3))
    g[:] = C(0.24, 0.30, 0.12)
    g *= (0.7 + 0.5 * rng.random((hh, n, 1)))
    g *= (0.8 + 0.3 * noise2(rng, hh, n, 3, 12))[..., None]
    straw = rng.random((hh, n)) < 0.08
    g[straw] = C(0.52, 0.46, 0.24) * rng.uniform(0.8, 1.1, (int(straw.sum()), 1))
    leaf = rng.random((hh, n)) < 0.05
    g[leaf] = C(0.55, 0.30, 0.10) * rng.uniform(0.7, 1.2, (int(leaf.sum()), 1))
    img[hh:] = g
    alpha[hh:] = a
    # the worn path (rows 0 .. hh-1): bare earth, grit, a few blades at the ragged sides
    across = (np.arange(hh) + 0.5) / hh
    side = np.minimum(across, 1 - across)[:, None]
    rag = noise2(rng, hh, n, 3, 14)
    a = side * 2.0 + (rag - 0.5) * 0.5 > 0.22 + 0.12 * thr[:hh]
    e = np.empty((hh, n, 3))
    e[:] = C(0.37, 0.31, 0.22)
    e *= (0.75 + 0.35 * noise2(rng, hh, n, 5, 16))[..., None]
    e *= (0.88 + 0.2 * rng.random((hh, n, 1)))
    grit = rng.random((hh, n)) < 0.06
    e[grit] = C(0.52, 0.50, 0.46) * rng.uniform(0.8, 1.1, (int(grit.sum()), 1))
    tuft = (side < 0.16) & (rng.random((hh, n)) < 0.35)
    e[tuft] = C(0.25, 0.31, 0.12) * rng.uniform(0.7, 1.2, (int(tuft.sum()), 1))
    img[:hh] = e
    alpha[:hh] = a
    return np.concatenate([np.clip(img, 0, 1), alpha[..., None].astype(np.float64)], axis=2)


def paint_props(rng):
    """The wall's props (the look pass): four cells of 64 px side by side. 0 the town's notice on its board
    (printed lines, too small to read, the arms in red), 1 washed linen (white shirts, grey), 2 coloured cloth
    (a faded blue smock, a red kerchief), 3 cleaned bricks stacked for sale: their ends and sides in rows with dark
    gaps between (not a wall's mortar), mortar crumbs still on some."""
    n = 64
    out = np.empty((n, 4 * n, 3))
    # 0 the notice: yellowed paper, a heading, lines of print, the arms at the top
    p = np.ones((n, n, 3)) * C(0.80, 0.76, 0.62)
    p *= (0.9 + 0.12 * noise2(rng, n, n, 4, 4))[..., None]
    for r in range(8, 44, 3):
        x0, x1 = 6 + int(rng.integers(0, 3)), n - 6 - int(rng.integers(0, 10))
        dots = rng.random(x1 - x0) < 0.7
        p[r, x0:x1][dots] = C(0.16, 0.14, 0.12)
    p[48:51, 12:52] = C(0.12, 0.10, 0.09)  # the heading (drawn bottom up: v rises to the top)
    p[53:60, 27:37] = C(0.62, 0.14, 0.12)  # the red shield of the town
    p[:2] = p[-2:] = C(0.35, 0.30, 0.22)
    p[:, :2] = p[:, -2:] = C(0.35, 0.30, 0.22)
    out[:, 0:n] = p
    # 1 washed linen
    l = np.ones((n, n, 3)) * C(0.86, 0.85, 0.80)
    l *= (0.86 + 0.16 * noise2(rng, n, n, 3, 8))[..., None]
    for u in range(0, n, 8):
        l[:, u] *= 0.86  # folds
    out[:, n:2 * n] = l
    # 2 coloured cloth: faded blue above, red below
    c = np.ones((n, n, 3))
    c[n // 2:] = C(0.26, 0.33, 0.46)
    c[:n // 2] = C(0.55, 0.16, 0.13)
    c *= (0.84 + 0.2 * noise2(rng, n, n, 3, 8))[..., None]
    out[:, 2 * n:3 * n] = c
    # 3 stacked bricks: rows of 6 px (a brick's edge and its gap), bricks of 10 or 20 px, dark gaps
    t = np.ones((n, n, 3)) * C(0.08, 0.06, 0.05)
    for r in range(n // 6 + 1):
        u = int(rng.integers(0, 8))
        while u < n + 20:
            w = 10 if rng.random() < 0.5 else 20
            col = C(0.52, 0.26, 0.17) * rng.uniform(0.75, 1.15)
            if rng.random() < 0.12:
                col = C(0.32, 0.16, 0.13) * rng.uniform(0.9, 1.1)
            y0, y1 = r * 6, min(n, r * 6 + 5)
            x0, x1 = u, min(n, u + w - 1)
            if y0 < n and x0 < n:
                t[y0:y1, x0:x1] = col
                t[y0:y1, x0:x1] *= (0.88 + 0.2 * rng.random((y1 - y0, x1 - x0, 1)))
                t[y1 - 1, x0:x1] *= 1.12  # the upper edge in the light
                crumbs = rng.random((y1 - y0, x1 - x0)) < 0.08
                t[y0:y1, x0:x1][crumbs] = C(0.62, 0.60, 0.55)
            u += w
    out[:, 3 * n:4 * n] = t
    return bp.speckle(out, rng, 0.04, 0.85, 0.97)


def paint_ashlar(rng, n, base, joint, course, lo=18, hi=34):
    """Stone blocks in courses; each course cut at random lengths, all wrapping round."""
    img = np.empty((n, n, 3))
    for r in range(n // course):
        cuts, u = [], int(rng.integers(0, n))
        start = u
        while True:
            cuts.append(u)
            u += int(rng.integers(lo, hi))
            if u >= start + n - lo // 2:
                break
        for i, c0 in enumerate(cuts):
            c1 = cuts[i + 1] if i + 1 < len(cuts) else start + n
            col = base * rng.uniform(0.86, 1.1)
            for uu in range(c0, c1):
                img[r * course:(r + 1) * course, uu % n] = col
            img[r * course:(r + 1) * course, c0 % n] = joint
        img[r * course] = joint
    img *= (0.92 + 0.12 * noise2(rng, n, n, 8, 8))[..., None]
    return bp.speckle(img, rng, 0.08, 0.85, 1.08)


def paint_cobble(rng, n=64):
    """Grey and brown setts in rows, dark gaps (the walk and the decks)."""
    img = np.empty((n, n, 3))
    img[:] = C(0.24, 0.23, 0.21)
    pal = [C(0.42, 0.40, 0.37), C(0.37, 0.36, 0.35), C(0.44, 0.40, 0.34), C(0.36, 0.37, 0.39), C(0.46, 0.44, 0.40)]
    for r in range(n // 8):
        u = int(rng.integers(0, 8))
        start = u
        while u < start + n:
            wd = int(rng.integers(6, 10))
            col = pal[int(rng.integers(0, len(pal)))] * rng.uniform(0.85, 1.1)
            for uu in range(u + 1, u + wd):
                for vv in range(r * 8 + 1, r * 8 + 7):
                    corner = (uu == u + 1 or uu == u + wd - 1) and (vv == r * 8 + 1 or vv == r * 8 + 6)
                    if not corner:
                        img[vv % n, uu % n] = col * (1.08 if vv > r * 8 + 4 else 1.0)
            u += wd
    img *= (0.88 + 0.2 * noise2(rng, n, n, 4, 4))[..., None]
    return img


def paint_slate(rng, n=64):
    img = np.empty((n, n, 3))
    for r in range(n // 8):
        off = (r % 2) * 4
        for c in range(n // 8 + 1):
            col = C(0.20, 0.22, 0.27) * rng.uniform(0.82, 1.15)
            if rng.random() < 0.1:
                col = C(0.29, 0.31, 0.35)
            for u in range(c * 8 + off, c * 8 + off + 8):
                img[r * 8:(r + 1) * 8, u % n] = col
            img[r * 8:(r + 1) * 8, (c * 8 + off) % n] = col * 0.6
        img[r * 8] *= 0.5  # the shadow of the course above
    img *= (0.9 + 0.16 * noise2(rng, n, n, 8, 8))[..., None]
    return img


def paint_wood(rng, n=64):
    """Upright planks with two iron straps and nails (doors, benches, the sentry box)."""
    img = np.empty((n, n, 3))
    grain = noise2(rng, n, n, 16, 3)
    for p in range(n // 8):
        col = C(0.30, 0.20, 0.12) * rng.uniform(0.8, 1.12)
        img[:, p * 8:(p + 1) * 8] = col
        img[:, p * 8] = col * 0.45
    img *= (0.8 + 0.35 * grain)[..., None]
    for v0 in (10, 50):
        img[v0:v0 + 4] = C(0.10, 0.10, 0.11)
        img[v0 + 1:v0 + 3, 4::8] = C(0.3, 0.29, 0.27)
    return img


def paint_iron(rng, n=16):
    img = np.ones((n, n, 3)) * C(0.10, 0.10, 0.11)
    return img * (0.85 + 0.3 * rng.random((n, n, 1)))


def paint_window(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.68, 0.64, 0.55)
    img *= (0.9 + 0.15 * rng.random((n, n, 1)))
    g = np.ones((n - 8, n - 8, 3)) * C(0.06, 0.07, 0.09)
    g[rng.random((n - 8, n - 8)) < 0.05] = C(0.2, 0.22, 0.25)
    img[4:n - 4, 4:n - 4] = g
    img[4:n - 4, n // 2] = C(0.12, 0.11, 0.1)
    img[n // 2, 4:n - 4] = C(0.12, 0.11, 0.1)
    img[1:4, 2:n - 2] = C(0.75, 0.71, 0.62)  # the sill
    return img


def paint_grass(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.25, 0.29, 0.13)
    img *= (0.75 + 0.45 * noise2(rng, n, n, 4, 4))[..., None]
    img *= (0.85 + 0.25 * noise2(rng, n, n, 16, 16))[..., None]
    m = rng.random((n, n))
    img[m < 0.03] = C(0.55, 0.50, 0.22)
    img[(m > 0.03) & (m < 0.08)] *= 0.6
    return img


LION = [  # a lion rampant, facing left, drawn top down (the arms of Brabant)
    "......XX........",
    ".....XXXX.......",
    "....XXXXXX.X....",
    "...X.XXXXXXX....",
    ".....XXXXXX.....",
    "......XXXX......",
    ".....XXXXXX..X..",
    "....XX.XXXXX.X..",
    "...XX..XXXXXXX..",
    ".......XXXXXX...",
    "......XXXXXX....",
    ".....XXX..XX....",
    "....XX.....XX...",
    "...XX.......XX..",
]


def paint_arms(rng, n=64):
    """The frontispiece's panel: a stone frame round a shield with the lion."""
    img = np.ones((n, n, 3)) * C(0.66, 0.62, 0.54)
    img *= (0.9 + 0.14 * rng.random((n, n, 1)))
    img[2:4, 2:n - 2] = img[n - 4:n - 2, 2:n - 2] = C(0.45, 0.42, 0.37)
    img[2:n - 2, 2:4] = img[2:n - 2, n - 4:n - 2] = C(0.45, 0.42, 0.37)
    top = np.zeros((n, n), bool)  # drawn top down, flipped at the end
    yy, xx = np.mgrid[0:n, 0:n]
    shield = ((np.abs(xx - 31.5) < 17) & (yy > 9) & (yy < 38)) | ((yy >= 38) & (np.abs(xx - 31.5) < 17 - (yy - 38) * 0.85))
    top |= shield
    pic = np.zeros((n, n, 3))
    pic[shield] = C(0.58, 0.55, 0.48)
    edge = shield & ~(np.roll(shield, 2, 0) & np.roll(shield, -2, 0) & np.roll(shield, 2, 1) & np.roll(shield, -2, 1))
    pic[edge] = C(0.78, 0.74, 0.65)
    for r, row in enumerate(LION):
        for c, ch in enumerate(row):
            if ch == "X":
                pic[14 + 2 * r:16 + 2 * r, 16 + 2 * c:18 + 2 * c] = C(0.36, 0.34, 0.30)
    pic = np.flipud(pic)
    top = np.flipud(top)
    img[top] = pic[top]
    return img


def paint_glow(rng, n=16):
    img = np.ones((n, n, 3)) * C(1.0, 0.84, 0.5)
    yy, xx = np.mgrid[0:n, 0:n]
    img *= (1.0 - 0.25 * (np.hypot(xx - 7.5, yy - 7.5) / 8))[..., None]
    img[0, :] = img[-1, :] = img[:, 0] = img[:, -1] = C(0.12, 0.11, 0.1)
    img[:, n // 2] = C(0.2, 0.18, 0.14)
    return img


def paint_canvas(rng, w=32, h=64):
    """Sail cloth: pale linen in cloths sewn along the sail (u across, v along), weathered to cream
    and grey in patches, with the reef points in rows (pass 2: paler, as in Steve's picture 7)."""
    img = np.ones((h, w, 3)) * C(0.90, 0.86, 0.76)
    img *= (0.88 + 0.16 * noise2(rng, h, w, 8, 4))[..., None]
    img *= (0.95 + 0.06 * rng.random((h, w, 1)))
    stain = noise2(rng, h, w, 4, 2)
    img = img * (1.0 - 0.18 * np.clip(stain - 0.55, 0, 1)[..., None] * 2)  # weather stains
    for u in (0, 8, 16, 24):
        img[:, u] *= 0.84  # the seams between the cloths
    for v in range(4, h, 16):
        img[v, 2::4] = C(0.46, 0.41, 0.33)  # reef points
    img[:, -1] *= 0.78
    return img


def paint_room(rng, n=16):
    """The inside of a guard house lit by its oil lamp: warm plaster, brighter high and in the middle
    (drawn unlit and bright at night, dark by day: world/rampart.ts)."""
    yy, xx = np.mgrid[0:n, 0:n]
    k = np.clip(1.05 - 0.55 * np.hypot((xx - 7.5) / 8.0, (yy - 11.0) / 12.0), 0.35, 1.0)
    img = np.ones((n, n, 3)) * C(0.95, 0.66, 0.34)
    img *= (k * (0.92 + 0.08 * rng.random((n, n))))[..., None]
    return img


def bayer4():
    m = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float64)
    return (m + 0.5) / 16.0


def paint_moss_decal(rng, stretch):
    """The moss over the town face where the park's pond lies against it, as one picture over the
    whole decal: u across the stretch (c0 - MOSS_PAD .. c1 + MOSS_PAD), v up from MOSS_Y0 to MOSS_Y1.
    RGBA with alpha 0 or 1 per texel: thick moss low down along the pond, thinning out toward both
    ends and toward the top in ever sparser patches (a dither), dark algae streaks running down."""
    c0, c1 = stretch
    s0, s1 = c0 - MOSS_PAD, c1 + MOSS_PAD
    W = int(min(2048, max(64, round((s1 - s0) / MOSS_PX / 4) * 4)))
    H = int(round((MOSS_Y1 - MOSS_Y0) / MOSS_PX / 4) * 4)
    sx = s0 + (np.arange(W) + 0.5) / W * (s1 - s0)
    y = MOSS_Y0 + (np.arange(H) + 0.5) / H * (MOSS_Y1 - MOSS_Y0)
    end = np.clip(np.minimum(sx - s0, s1 - sx) / MOSS_PAD, 0, 1)[None, :]  # 0 at the decal's ends, 1 along the pond
    wander = 1.0 + 0.8 * noise2(rng, 1, W, 1, max(2, W // 40))  # the moss's top: 1.0 .. 1.8 m
    top = 0.35 + (wander - 0.35) * end
    ht = np.clip(1.0 - (y[:, None] - 0.25) / np.maximum(0.15, top - 0.25), 0, 1) ** 1.3
    val = (end ** 0.8) * ht * 1.25
    blob = noise2(rng, H, W, max(2, H // 10), max(2, W // 10))
    fine = rng.random((H, W))
    thr = 0.2 + 0.6 * (0.5 * np.tile(bayer4(), (H // 4 + 1, W // 4 + 1))[:H, :W] + 0.5 * rng.random((H, W)))
    alpha = (val * (0.3 + 0.9 * blob) - 0.12 * fine) > thr
    img = np.empty((H, W, 3))
    img[:] = C(0.19, 0.27, 0.08)
    img *= rng.uniform(0.75, 1.25, (H, W, 1))
    img[fine < 0.1] = C(0.33, 0.42, 0.14)  # a few bright tips
    img *= (0.72 + 0.35 * np.clip((y[:, None] + 0.3) / 1.8, 0, 1))[..., None]
    for _ in range(int(W / 70)):  # dark algae streaks running down, inside the thick moss only
        u = int(rng.integers(0, W))
        if end[0, u] < 0.9:
            continue
        ys = rng.uniform(0.4, 1.1)
        rows = (y < ys) & (y > ys - rng.uniform(0.3, 0.7))
        keep = rows & (rng.random(H) < 0.6)
        img[keep, u] = C(0.10, 0.13, 0.06) * rng.uniform(0.8, 1.2)
        alpha[keep, u] = True
    return np.concatenate([np.clip(img, 0, 1), alpha[..., None].astype(np.float64)], axis=2)


def make_materials(ctx=None):
    rng = np.random.default_rng(1873)
    # (the look pass: the brick and quoins of 1873 have dice of their own; the old ones are still painted and thrown
    # away, so every picture after them keeps its dice, its bytes and the height map made from it)
    paint = {
        "wall_brick": lambda: (paint_brick(rng), paint_brick_1873(np.random.default_rng(18731)))[1],
        "wall_quoin": lambda: (paint_quoin(rng), paint_quoin_1873(np.random.default_rng(18732)))[1],
        "wall_plinth": lambda: paint_ashlar(rng, 64, C(0.40, 0.41, 0.43), C(0.22, 0.22, 0.23), 16, 18, 34),
        "wall_stone": lambda: paint_ashlar(rng, 64, C(0.70, 0.66, 0.57), C(0.50, 0.47, 0.41), 16, 24, 40),
        "wall_cobble": lambda: paint_cobble(rng),
        "wall_slate": lambda: paint_slate(rng),
        "wall_wood": lambda: paint_wood(rng),
        "wall_iron": lambda: paint_iron(rng),
        "wall_window": lambda: paint_window(rng),
        "wall_grass": lambda: paint_grass(rng),
        "wall_arms": lambda: paint_arms(rng),
        "wall_lamp_glow": lambda: paint_glow(rng),
        "wall_canvas": lambda: paint_canvas(rng),
        "wall_room_glow": lambda: paint_room(rng),
    }
    arrs = {name: np.clip(paint[name](), 0, 1) for name in MATS if name in paint}
    moss = getattr(ctx, "moss", None)
    arrs["wall_moss_decal"] = paint_moss_decal(np.random.default_rng(1874), (moss[2], moss[3]) if moss else (0.0, 4.0))
    arrs["wall_coping"] = np.clip(paint_coping(np.random.default_rng(18733)), 0, 1)
    arrs["wall_lawn_decal"] = paint_lawn_decal(np.random.default_rng(18734))
    arrs["wall_props"] = np.clip(paint_props(np.random.default_rng(18735)), 0, 1)
    for name in MATS:
        arr = arrs[name]
        h, w, nch = arr.shape
        img = bpy.data.images.new(name + "_tex", w, h, alpha=nch == 4)
        rgba = np.ones((h, w, 4), dtype=np.float32)
        rgba[..., :nch] = arr
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
        m.use_backface_culling = name not in ("wall_canvas", "wall_moss_decal", "wall_lawn_decal", "wall_props")  # a sail cloth is seen from both sides
        if name.endswith("_decal"):
            # alpha 0 or 1 per texel: exported as a mask (cutoff 0.5); the game draws "*_decal" with
            # alphaTest 0.5, polygon offset toward the eye, no depth write
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
            for attr, val in (("blend_method", "CLIP"), ("surface_render_method", "DITHERED")):
                try:
                    setattr(m, attr, val)
                except (AttributeError, TypeError):
                    pass


# ------------------------------------------------------------------ geometry store


class Geo:
    """Faces in game coordinates, grouped into objects (100 m cells, or a gate)."""

    def __init__(self):
        self.groups = {}
        self.grp = None

    def face(self, pts, mat, out=None, uvs=None, shade=None, floor=0.0, k=1.0):
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        if n.length < 1e-9:
            return
        if out is not None and n.dot(Vector(out)) < 0:
            pts.reverse()
            n = -n
            if uvs:
                uvs = list(reversed(uvs))
        n.normalize()
        if uvs is None:
            uvs = planar(pts, n, mat)
        if shade is None:
            cols = [amb(p, floor) * k for p in pts]
        elif callable(shade):
            cols = [shade(p) * k for p in pts]
        else:
            cols = [shade * k * tint(p.x, p.z) for p in pts]
        grp = self.grp
        if grp is None or grp == "props":
            # (the look pass: the props on the walk are objects of their own, "wall_props_<n>", so the game keeps
            # them apart from the wall itself: the prop check tests them against it)
            c = sum(pts, Vector()) / len(pts)
            grp = ("chunk" if grp is None else "props", math.floor(c.x / CHUNK), math.floor(c.z / CHUNK))
        self.groups.setdefault(grp, []).append((pts, uvs, cols, mat))

    def to_objects(self, gate_ids):
        objs = {}
        chunks = sorted(k for k in self.groups if k[0] == "chunk")
        names = {k: f"wall_chunk_{i}" for i, k in enumerate(chunks)}
        names.update({k: f"wall_props_{i}" for i, k in enumerate(sorted(k for k in self.groups if k[0] == "props"))})
        for k in self.groups:
            if k[0] == "gate":
                names[k] = f"gate_{k[1]}"
            elif k[0] == "sails":
                names[k] = k[2]
        for k, faces in self.groups.items():
            name = names[k]
            origin = Vector(k[1]) if k[0] == "sails" else Vector((0.0, 0.0, 0.0))  # the sails turn about their hub
            bm = bmesh.new()
            uvl = bm.loops.layers.uv.new("UVMap")
            col = bm.loops.layers.float_color.new("Col")
            for pts, uvs, cols, mat in faces:
                vs = [bm.verts.new(B(p - origin)) for p in pts]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = mat
                f.smooth = False
                for loop, uv, c in zip(f.loops, uvs, cols):
                    loop[uvl].uv = uv
                    c = min(1.0, max(0.0, c))
                    loop[col] = (c, c, c, 1.0)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for mt in MATS:
                me.materials.append(bpy.data.materials[mt])
            try:
                me.color_attributes.active_color = me.color_attributes["Col"]
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            except (KeyError, AttributeError):
                pass
            ob = bpy.data.objects.new(name, me)
            ob.location = B(origin)
            bpy.context.scene.collection.objects.link(ob)
            objs[name] = ob
        return objs


def planar(pts, n, mat):
    tu, tv = TILE[mat]
    if abs(n.y) > 0.75:
        return [(p.x / tu, p.z / tv) for p in pts]
    hd = Vector((n.z, 0.0, -n.x)).normalized()
    w = n.cross(hd)
    return [(p.dot(hd) / tu, p.dot(w) / tv) for p in pts]


def fit_uvs(n):
    return [(0, 0), (1, 0), (1, 1), (0, 1)][:n]


# ------------------------------------------------------------------ solids in world space

HEX_FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}


def solid8(g, P, mat, skip=(), **kw):
    """Six faces over 8 corners P[i] (bit 0, 1, 2 = the three axes), each looking away from the middle."""
    P = [Vector(p) for p in P]
    c = sum(P, Vector()) / 8
    for key, idx in HEX_FACES.items():
        if key in skip:
            continue
        pts = [P[i] for i in idx]
        fc = sum(pts, Vector()) / 4
        g.face(pts, mat, out=fc - c, **kw)


def bar(g, a, b, w, mat, h=None, **kw):
    """A square bar (iron, a beam) from a to b."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    s = t.cross(Vector((0, 1, 0)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    k = s.cross(t)
    h = w if h is None else h
    P = []
    for i in range(8):
        base = b if i & 2 else a
        P.append(base + s * (w / 2 if i & 1 else -w / 2) + k * (h / 2 if i & 4 else -h / 2))
    solid8(g, P, mat, **kw)


def lathe(g, c, prof, sides, mat, rot=0.0, **kw):
    """A turned shape about the vertical through c; prof = (r, dy) from the bottom up."""
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
            out = (math.cos(am) * nr, ny, math.sin(am) * nr)
            g.face(p, mat, out=out, **kw)


def pyramid(g, base, apex, mat, bottom=True, **kw):
    """A roof: triangles from each edge of the base (world points at one height) to the apex."""
    base = [Vector(p) for p in base]
    apex = Vector(apex)
    c = sum(base, Vector()) / len(base)
    inner = c + (apex - c) * 0.25
    for i in range(len(base)):
        tri = [base[i], base[(i + 1) % len(base)], apex]
        fc = sum(tri, Vector()) / 3
        g.face(tri, mat, out=fc - inner, **kw)
    if bottom:
        g.face(base, mat, out=(0, -1, 0), **kw)


def finial(g, x, y, z, s=1.0, mat=IRON):
    prof = [(0.10, 0), (0.10, 0.06), (0.04, 0.10), (0.04, 0.22), (0.11, 0.30), (0.11, 0.42), (0.03, 0.50), (0.0, 0.85)]
    lathe(g, (x, y, z), [(r * s, dy * s) for r, dy in prof], 6, mat, shade=0.9)


LAMPS = []  # every lantern's glass (x, y, z), for the game's gas-lamp lights (pass 2: world/rampart.ts)


def lantern(g, x, ytop, z, w=0.24, hh=0.36, record=True):
    """A square lantern hanging from (x, ytop, z): iron cap, glowing glass, iron base."""
    y1 = ytop - 0.1
    y0 = y1 - hh
    if record:
        LAMPS.append((x, (y0 + y1) / 2, z))
    q = w / 2 + 0.04
    pyramid(g, [(x - q, y1, z - q), (x + q, y1, z - q), (x + q, y1, z + q), (x - q, y1, z + q)], (x, ytop + 0.06, z), IRON,
            shade=0.8)
    q = w / 2
    solid8(g, [(x + (q if i & 1 else -q), y0 if not i & 4 else y1, z + (q if i & 2 else -q)) for i in range(8)], GLOW,
           skip=("+z", "-z"), shade=1.0, uvs=None)
    q = w / 2 + 0.03
    solid8(g, [(x + (q if i & 1 else -q), y0 - 0.06 if not i & 4 else y0, z + (q if i & 2 else -q)) for i in range(8)], IRON,
           shade=0.8)


def wall_lantern(g, p, out, arm=0.5):
    """A lantern on an iron bracket from a wall point p (world), `out` the wall's normal (x, z)."""
    p = Vector(p)
    o = Vector((out[0], 0.0, out[1]))
    tip = p + o * arm
    bar(g, p, tip, 0.05, IRON, shade=0.8)
    bar(g, p - Vector((0, 0.35, 0)), p + o * (arm * 0.6), 0.03, IRON, shade=0.8)  # the strut, thinner than the arm
    bar(g, tip, tip - Vector((0, 0.1, 0)), 0.03, IRON, shade=0.8)
    lantern(g, tip.x, p.y - 0.1, tip.z)


# ------------------------------------------------------------------ local frames


class Frame:
    """Local (a along, o out, y up) -> world; origin (x, z), ua and uo unit vectors in (x, z)."""

    def __init__(self, ox, oz, ua, uo):
        self.ox, self.oz = ox, oz
        self.ua, self.uo = ua, uo

    def p(self, a, o, y):
        return (self.ox + self.ua[0] * a + self.uo[0] * o, y, self.oz + self.ua[1] * a + self.uo[1] * o)

    def v(self, da, do, dy=0.0):
        return (self.ua[0] * da + self.uo[0] * do, dy, self.ua[1] * da + self.uo[1] * do)

    def loc(self, x, z):
        dx, dz = x - self.ox, z - self.oz
        return dx * self.ua[0] + dz * self.ua[1], dx * self.uo[0] + dz * self.uo[1]

    def box(self, g, a0, a1, o0, o1, y0, y1, mat, skip=(), **kw):
        a0, a1 = sorted((a0, a1))
        o0, o1 = sorted((o0, o1))
        P = [self.p(a1 if i & 1 else a0, o1 if i & 2 else o0, y1 if i & 4 else y0) for i in range(8)]
        # skip keys in local terms: -a +a -o +o -y +y
        m = {"-a": "-x", "+a": "+x", "-o": "-y", "+o": "+y", "-y": "-z", "+y": "+z"}
        solid8(g, P, mat, skip=tuple(m[s] for s in skip), **kw)

    def quad(self, g, pts, mat, out, **kw):
        g.face([self.p(*q) for q in pts], mat, out=self.v(*out), **kw)


class Panel:
    """A flat upright wall in a frame, from local (a, o) point A to B, looking along local `out`."""

    def __init__(self, g, F, A, B, out, uoff=0.0):
        self.g, self.F = g, F
        self.A, self.B = Vector(A), Vector(B)
        d = self.B - self.A
        self.L = d.length
        self.t = d / self.L
        self.n = Vector(out)
        self.uoff = uoff

    def pt(self, u, y, dep=0.0):
        q = self.A + self.t * u - self.n * dep
        return self.F.p(q.x, q.y, y)

    def outv(self, sgn=1.0):
        return self.F.v(self.n.x * sgn, self.n.y * sgn)

    def along(self, sgn=1.0):
        return self.F.v(self.t.x * sgn, self.t.y * sgn)

    def wall(self, y0, y1, mat, holes=(), quoin=(False, False), plinth=None, bands=(), floor=0.0, k=1.0, shade=None,
             seg=SEG, dep=0.0):
        L = self.L
        us, ys = {0.0, L}, {y0, y1}
        qz = []
        if quoin[0]:
            qz.append((0.0, min(QW, L / 2), 0))
        if quoin[1]:
            qz.append((max(L - QW, L / 2), L, 1))
        for a, b, _ in qz:
            us |= {a, b}
        for u0, u1, v0, v1 in holes:
            us |= {u0, u1}
            ys |= {v0, v1}
        if plinth is not None:
            ys.add(plinth)
        for b0, b1 in bands:
            ys |= {b0, b1}
        us = sorted(u for u in us if -1e-9 <= u <= L + 1e-9)
        ys = sorted(y for y in ys if y0 - 1e-9 <= y <= y1 + 1e-9)
        uu = []
        for a, b in zip(us, us[1:]):
            uu += splits(a, b, seg)[:-1]
        uu.append(us[-1])
        for ua, ub in zip(uu, uu[1:]):
            if ub - ua < 1e-5:
                continue
            mu = (ua + ub) / 2
            for va, vb in zip(ys, ys[1:]):
                if vb - va < 1e-5:
                    continue
                mv = (va + vb) / 2
                if any(h[0] <= mu <= h[1] and h[2] <= mv <= h[3] for h in holes):
                    continue
                m = mat
                if plinth is not None and mv < plinth:
                    m = PLINTH
                elif any(b0 <= mv <= b1 for b0, b1 in bands):
                    m = STONE
                zone = next((z for z in qz if z[0] - 1e-6 <= mu <= z[1] + 1e-6), None)
                if zone is not None and m == BRICK:
                    m = QUOIN
                    sh = 0.0 if zone[2] == 0 else 0.25
                    du = (lambda u: u / QW) if zone[2] == 0 else (lambda u: (L - u) / QW)
                    qv = TILE[QUOIN][1]
                    uvs = [(du(ua), va / qv + sh), (du(ub), va / qv + sh), (du(ub), vb / qv + sh), (du(ua), vb / qv + sh)]
                else:
                    tu, tv = TILE[m]
                    uvs = [((self.uoff + ua) / tu, va / tv), ((self.uoff + ub) / tu, va / tv),
                           ((self.uoff + ub) / tu, vb / tv), ((self.uoff + ua) / tu, vb / tv)]
                pts = [self.pt(ua, va, dep), self.pt(ub, va, dep), self.pt(ub, vb, dep), self.pt(ua, vb, dep)]
                self.g.face(pts, m, out=self.outv(), uvs=uvs, floor=floor, k=k, shade=shade)

    def reveal(self, u0, u1, y0, y1, depth, mat, back=None, sill=True, head=True, floor=0.0, k=1.0, shade=None, back_k=1.0):
        """The sides of a hole cut into the wall `depth` deep, and its back (a door, the dark) if given."""
        g, P = self.g, self.pt
        g.face([P(u0, y0), P(u0, y0, depth), P(u0, y1, depth), P(u0, y1)], mat, out=self.along(1), floor=floor, k=k, shade=shade)
        g.face([P(u1, y0), P(u1, y0, depth), P(u1, y1, depth), P(u1, y1)], mat, out=self.along(-1), floor=floor, k=k, shade=shade)
        if head:
            g.face([P(u0, y1), P(u1, y1), P(u1, y1, depth), P(u0, y1, depth)], mat, out=(0, -1, 0), floor=floor, k=k * 0.8,
                   shade=shade)
        if sill:
            g.face([P(u0, y0), P(u1, y0), P(u1, y0, depth), P(u0, y0, depth)], mat, out=(0, 1, 0), floor=floor, k=k, shade=shade)
        if back is not None:
            uvs = fit_uvs(4) if back in (WOOD, WINDOW, ARMS) else None
            g.face([P(u0, y0, depth), P(u1, y0, depth), P(u1, y1, depth), P(u0, y1, depth)], back, out=self.outv(), uvs=uvs,
                   floor=floor, k=back_k, shade=shade)

    def sheet(self, u0, u1, y0, y1, mat, dep=-0.03, **kw):
        """A picture on the wall (a window, a panel), `dep` in front of it (negative = proud)."""
        P = self.pt
        self.g.face([P(u0, y0, dep), P(u1, y0, dep), P(u1, y1, dep), P(u0, y1, dep)], mat, out=self.outv(), uvs=fit_uvs(4), **kw)


# ------------------------------------------------------------------ the layout


def V2(p):
    return Vector((float(p[0]), float(p[1])))


def centroid(P):
    return sum((V2(p) for p in P), Vector((0.0, 0.0))) / len(P)


def on_line(A, B, P, Q, e=0.03):
    """Whether the segment A-B lies on the segment P-Q (within e)."""
    d = Q - P
    L = d.length
    if L < 1e-9:
        return False
    t = d / L
    n = Vector((-t.y, t.x))
    for X in (A, B):
        r = X - P
        if abs(r.dot(n)) > e or not (-e <= r.dot(t) <= L + e):
            return False
    return True


def cross2(a, b):
    return a.x * b.y - a.y * b.x


class Hut:
    """A guard house's footprint (4 corners in any turn): its middle, its two axes, half sizes."""

    def __init__(self, corners):
        P = [V2(p) for p in corners]
        self.c = centroid(P)
        e1, e2 = P[1] - P[0], P[3] - P[0]
        self.axes = [(e1.normalized(), e1.length / 2), (e2.normalized(), e2.length / 2)]

    def facing(self, d):
        """The frame whose `o` looks along the hut's axis nearest the direction d: (ua, uo, W2, D2),
        W2 and D2 the half sizes along ua and uo."""
        best = None
        for k, (ax, half) in enumerate(self.axes):
            for sg in (1.0, -1.0):
                v = ax * sg
                if best is None or v.dot(d) > best[0]:
                    best = (v.dot(d), v, half, self.axes[1 - k][1])
        _, uo, D2, W2 = best
        ua = Vector((-uo.y, uo.x))
        return ua, uo, W2, D2

    def poly(self, inset=0.0):
        (a1, h1), (a2, h2) = self.axes
        return [self.c + a1 * (s1 * (h1 - inset)) + a2 * (s2 * (h2 - inset)) for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


class Ctx:
    def __init__(self, D, solids):
        self.D = D
        self.h = D["h"]
        self.t = D["t"]
        self.band = D["parapet"]
        self.rail = D.get("rail", D["parapet"])
        self.solids = [[(float(x), float(z)) for x, z in s] for s in solids]
        self.trace = [V2(p) for p in D["trace"]]
        self.inner = [V2(p) for p in D["inner_line"]]
        self.segs = D["segments"]
        il = self.inner
        # the town face: the inner line, and on down the river half-bastions' town sides
        self.town_lines = [(Vector((il[0].x, -60.0)), il[0])] + list(zip(il, il[1:])) + [(il[-1], Vector((il[-1].x, -60.0)))]
        self.gate_polys = [[V2(p) for p in g["house"]] for g in D["gates"]]
        self.huts = [Hut(h) for h in D["huts"]]
        self.land_bastions, self.river_bastions = [], []
        for k, poly in D["bastions"].items():
            P = [V2(p) for p in poly]
            (self.land_bastions if min(p.y for p in P) >= -1e-6 else self.river_bastions).append((k, P))
        self.blist = {b["name"]: b for b in D["bastion_list"]}
        self.town_poly = [Vector((il[0].x, 0.0))] + il + [Vector((il[-1].x, 0.0))]
        self.centre = centroid(self.town_poly)
        m = D["mill"]
        self.mill = (Vector((m["x"], m["z"])), m["r"])
        # pass 2: every mill (the second on the north-east bastion), what the game places and bumps into
        self.mill_axles = {}
        self.dress = {"mills": [], "benches": [], "lamps": [], "lanterns": []}
        self.mills = mill_spots(self)
        self.moss = pond_stretch(self)
        self.prop_set = None  # (the look pass: props of one site, which may touch: the dressing's "set")
        # the walk's paving follows its piece of the wall: the lines where one piece meets the next
        self.region_cuts = []
        for i in range(1, len(self.trace) - 1):
            a, b = self.trace[i], self.inner[i]
            d = (b - a).normalized()
            self.region_cuts.append((a - d * 1.0, b + d * 1.0))
        for _, P in self.land_bastions + self.river_bastions:
            self.region_cuts += [(P[j], P[(j + 1) % len(P)]) for j in range(len(P))]

    def sframe(self, fr, s):
        """The frame of a part at s along its segment: origin on the town face, a along t, o out along n."""
        o, t, n = fr["o"], fr["t"], fr["n"]
        return Frame(o[0] + t[0] * s - n[0] * self.t, o[1] + t[1] * s - n[1] * self.t, (t[0], t[1]), (n[0], n[1]))

    def kind(self, A, B):
        for poly in self.gate_polys:
            for j in range(len(poly)):
                if on_line(A, B, poly[j], poly[(j + 1) % len(poly)]):
                    return "gate"
        for P, Q in self.town_lines:
            if on_line(A, B, P, Q):
                return "town"
        return "field"

    def walk_axes(self, c):
        """The paving's (along, across) at a point of the walk: its segment's frame, a bastion's own."""
        if c.y < 0.0:
            return Vector((1.0, 0.0)), Vector((0.0, 1.0))
        for name, P in self.land_bastions:
            if inside((c.x, c.y), [(p.x, p.y) for p in P]):
                b = self.blist[name]
                u = (V2(b["salient"]) - V2(b["vertex"])).normalized()
                return Vector((-u.y, u.x)), u
        best = None
        for i, sg in enumerate(self.segs):
            t = V2(sg["t"])
            ok = True
            for k, ref in ((i, self.trace[i] + t), (i + 1, self.trace[i + 1] - t)):
                if 0 < k < len(self.trace) - 1:
                    a, b = self.trace[k], self.inner[k]
                    if (cross2(b - a, c - a) > 0) != (cross2(b - a, ref - a) > 0):
                        ok = False
            r = c - V2(sg["o"])
            dist = abs(r.dot(V2(sg["n"])) + self.t / 2)
            if ok and (best is None or dist < best[0]):
                best = (dist, t, V2(sg["n"]))
        if best is None:
            return Vector((1.0, 0.0)), Vector((0.0, 1.0))
        return best[1], best[2]

    def in_solid(self, p):
        return any(inside(p, s) for s in self.solids)


class Edge:
    pass


def line_x(A1, t1, A2, t2):
    den = t1.x * t2.y - t1.y * t2.x
    if abs(den) < 1e-9:
        return None
    w = A2 - A1
    s = (w.x * t2.y - w.y * t2.x) / den
    return A1 + t1 * s


class Ring:
    """One outline of the walk (decor.rampart.tops): its edges, which side they face, their corners.
    Offsets d are measured inward from an edge (into the wall), so the field face is d = 0 at the
    foot and d = BATTER at the walk."""

    def __init__(self, ring, ctx):
        Q = []
        for x, z in ring:
            p = Vector((float(x), float(z)))
            if not Q or (p - Q[-1]).length > 1e-6:
                Q.append(p)
        if (Q[0] - Q[-1]).length < 1e-6:
            Q.pop()
        n = len(Q)
        area = sum(Q[i].x * Q[(i + 1) % n].y - Q[(i + 1) % n].x * Q[i].y for i in range(n)) / 2
        self.ccw = area > 0
        self.P = Q
        self.E = []
        u = 0.0
        for i in range(n):
            A, Bp = Q[i], Q[(i + 1) % n]
            e = Edge()
            e.A, e.B = A, Bp
            d = Bp - A
            e.L = d.length
            e.t = d / e.L
            e.n = Vector((-e.t.y, e.t.x)) if self.ccw else Vector((e.t.y, -e.t.x))
            e.kind = ctx.kind(A, Bp)
            e.river = max(A.y, Bp.y) <= 0.01
            e.u0 = u
            u += e.L
            self.E.append(e)
        for i in range(n):
            e0, e1 = self.E[i - 1], self.E[i]
            turn = math.atan2(e0.t.x * e1.t.y - e0.t.y * e1.t.x, e0.t.dot(e1.t))
            cvx = turn > QUOIN_TURN if self.ccw else turn < -QUOIN_TURN  # a salient corner, not a small bend
            cvx = cvx and e0.kind == "field" and e1.kind == "field"  # no quoins where the wall meets a gate tower
            e1.cvx_a = cvx
            e0.cvx_b = cvx
        self.cache = {}

    def nd(self, f, d):
        return -0.05 if f.kind == "gate" else d

    def meet(self, i, j, di, dj):
        e, f = self.E[i % len(self.E)], self.E[j % len(self.E)]
        p = line_x(e.A + e.n * di, e.t, f.A + f.n * dj, f.t)
        return p if p is not None else e.B + e.n * di

    def ends(self, i, d):
        key = (i, round(d, 5))
        if key not in self.cache:
            n = len(self.E)
            e, pe, ne = self.E[i], self.E[i - 1], self.E[(i + 1) % n]
            self.cache[key] = (self.meet(i - 1, i, self.nd(pe, d), d), self.meet(i, i + 1, d, self.nd(ne, d)))
        return self.cache[key]

    def P3(self, i, s, d, y):
        """The point at s along edge i, d inside it, at height y: on the offset line, and at the
        mitred corner at either end (s = 0 or L)."""
        e = self.E[i]
        S, T = self.ends(i, d)
        if s <= 1e-6:
            q = S
        elif s >= e.L - 1e-6:
            q = T
        else:
            ss = min(max(s, (S - e.A).dot(e.t)), (T - e.A).dot(e.t))
            q = e.A + e.n * d + e.t * ss
        return (q.x, y, q.y)

    def sweep(self, g, i, prof, mats, ranges=None, floor=0.0, k=1.0, quoin=False, shade=None):
        """Faces along edge i between profile points (d, y); mats per profile segment (None = none)."""
        e = self.E[i]
        L = e.L
        ranges = ranges if ranges is not None else [(0.0, L)]
        if not ranges:
            return
        br = {0.0, L}
        zs = []
        if quoin and e.kind == "field":
            if e.cvx_a:
                zs.append((0.0, min(QW, L / 2), 0))
            if e.cvx_b:
                zs.append((max(L - QW, L / 2), L, 1))
        for z0, z1, _ in zs:
            br |= {z0, z1}
        for r0, r1 in ranges:
            br |= {max(0.0, r0), min(L, r1)}
        br = sorted(b for b in br if -1e-9 <= b <= L + 1e-9)
        ss = []
        for a, b in zip(br, br[1:]):
            ss += splits(a, b, SEG)[:-1]
        ss.append(br[-1])
        for sa, sb in zip(ss, ss[1:]):
            if sb - sa < 1e-4:
                continue
            m = (sa + sb) / 2
            if not any(r0 - 1e-6 <= m <= r1 + 1e-6 for r0, r1 in ranges):
                continue
            zone = next((z for z in zs if z[0] - 1e-6 <= m <= z[1] + 1e-6), None)
            for kk in range(len(prof) - 1):
                mat = mats[kk]
                if mat is None:
                    continue
                (d0, y0), (d1, y1) = prof[kk], prof[kk + 1]
                q = [self.P3(i, sa, d0, y0), self.P3(i, sb, d0, y0), self.P3(i, sb, d1, y1), self.P3(i, sa, d1, y1)]
                nx, ny = (y1 - y0), (d1 - d0)
                ln = math.hypot(nx, ny)
                nx, ny = nx / ln, ny / ln
                out = (-e.n.x * nx, ny, -e.n.y * nx)
                mm = mat
                if zone is not None and mat == BRICK and nx > 0.5:
                    mm = QUOIN
                    sh = 0.0 if zone[2] == 0 else 0.25
                    du = (lambda s: s / QW) if zone[2] == 0 else (lambda s: (L - s) / QW)
                    qv = TILE[QUOIN][1]
                    uvs = [(du(sa), y0 / qv + sh), (du(sb), y0 / qv + sh), (du(sb), y1 / qv + sh), (du(sa), y1 / qv + sh)]
                else:
                    tu, tv = TILE[mat]
                    if abs(ny) > 0.7:
                        v0, v1 = d0 / tv, d1 / tv
                    else:
                        v0, v1 = y0 / tv, y1 / tv
                    uvs = [((e.u0 + sa) / tu, v0), ((e.u0 + sb) / tu, v0), ((e.u0 + sb) / tu, v1), ((e.u0 + sa) / tu, v1)]
                g.face(q, mm, out=out, uvs=uvs, floor=floor, k=k, shade=shade)

    def cap(self, g, i, s, poly, sgn, mat, floor=0.0):
        """The cut end of a sweep at s: its cross-section, looking along the edge (sgn +1) or back."""
        e = self.E[i]
        g.face([self.P3(i, s, d, y) for d, y in poly], mat, out=(e.t.x * sgn, 0, e.t.y * sgn), floor=floor)

    def solid_runs(self, i, d, ctx, pad=0.3):
        """Where along edge i the line d inside it lies in decor.rampart_solids."""
        e = self.E[i]
        A = e.A + e.n * d
        s_lo, s_hi = -pad, e.L + pad
        cuts = {s_lo, s_hi}
        for ring in ctx.solids:
            m = len(ring)
            for j in range(m):
                p1, p2 = Vector(ring[j]), Vector(ring[(j + 1) % m])
                w = p2 - p1
                den = e.t.x * w.y - e.t.y * w.x
                if abs(den) < 1e-12:
                    continue
                r = p1 - A
                s = (r.x * w.y - r.y * w.x) / den
                u = (r.x * e.t.y - r.y * e.t.x) / den
                if -1e-9 <= u <= 1 + 1e-9 and s_lo < s < s_hi:
                    cuts.add(s)
        cuts = sorted(cuts)
        runs = []
        for a, b in zip(cuts, cuts[1:]):
            if b - a < 1e-4:
                continue
            m = A + e.t * ((a + b) / 2)
            if ctx.in_solid((m.x, m.y)):
                if runs and abs(runs[-1][1] - a) < 1e-4:
                    runs[-1] = (runs[-1][0], b)
                else:
                    runs.append((a, b))
        return [(max(0.0, a), min(e.L, b)) for a, b in runs if b > 0 and a < e.L]


def bat(y, h):
    return BATTER * min(1.0, max(0.0, y / h))


SLAB_GAP, SLAB_CH = 0.01, 0.028


def slab_rng(e, i):
    return np.random.default_rng((int(abs(e.A.x) * 1000) * 31 + int(abs(e.A.y) * 1000) + i) % (2 ** 31))  # the look pass: the coping's joints, the chamfer along its top edges


def coping_slabs(g, R, i, runs, d0, d1, y0, y1, over0, over1, rng, floor, bed=None):
    """Bluestone coping slabs along edge i of a ring (the look pass, 2026-09-26; Steve: "the coping is flat grey
    slabs"): the runs cut into slabs 1 to 1.5 m long with 1 cm joints (a dark mortar bed under them), each its own
    picture of four and its own few millimetres higher or lower, a chamfer along both top edges, a drip hanging over
    both faces (over0 on the d0 side, over1 on the d1 side). At a run's end on a corner the slab is mitred."""
    e = R.E[i]
    a0, a1 = d0 - over0, d1 + over1
    wd = a1 - a0
    # the mortar bed, seen down the joints (not over an embrasure: its head is drawn there)
    R.sweep(g, i, [(d1, y0 + 0.001), (d0, y0 + 0.001)], [PLINTH], runs if bed is None else bed, floor=floor, k=0.5)
    for r0, r1 in runs:
        L = r1 - r0
        n = max(1, round(L / 1.25))
        cuts = [r0]
        for j in range(1, n):
            cuts.append(r0 + L * j / n + rng.uniform(-0.18, 0.18) * L / n)
        cuts.append(r1)
        for j in range(n):
            sa = cuts[j] + (SLAB_GAP / 2 if j > 0 else 0.0)
            sb = cuts[j + 1] - (SLAB_GAP / 2 if j < n - 1 else 0.0)
            if sb - sa < 0.05:
                continue
            k = int(rng.integers(0, COPING_CELLS))
            ya, yb = y1 + rng.uniform(-0.007, 0.007), y1 + rng.uniform(-0.007, 0.007)  # a slab set a little high or low
            flip = rng.random() < 0.5  # its picture turned end for end
            ch = SLAB_CH

            def U(s):
                f = (s - sa) / (sb - sa)
                return (k + (1.0 - f if flip else f)) / COPING_CELLS

            def top(s):
                return ya + (yb - ya) * (s - sa) / (sb - sa)

            prof = [(a0, y0), (a0, None, -ch), (a0 + ch, None, 0.0), (a1 - ch, None, 0.0), (a1, None, -ch), (a1, y0)]

            def pt(s, q):
                return R.P3(i, s, q[0], q[1] if q[1] is not None else top(s) + q[2])

            vs = [0.0, 0.12, 0.2, 0.8, 0.88, 1.0]  # the side faces and chamfers on the picture's margin, the top between
            nx_, nz_ = e.n.x, e.n.y  # (into the wall: d grows along it)
            outs = [(-nx_, 0.0, -nz_), (-nx_, 1.0, -nz_), (0.0, 1.0, 0.0), (nx_, 1.0, nz_), (nx_, 0.0, nz_)]
            for kk in range(5):
                qa, qb = prof[kk], prof[kk + 1]
                P = [pt(sa, qa), pt(sb, qa), pt(sb, qb), pt(sa, qb)]
                uv = [(U(sa), vs[kk]), (U(sb), vs[kk]), (U(sb), vs[kk + 1]), (U(sa), vs[kk + 1])]
                g.face(P, COPING, out=outs[kk], uvs=uv, floor=floor, k=0.84 if kk in (0, 4) else 1.0)
            # the drips' undersides and the slab's two ends
            for qa, qb in (((a0, y0), (d0, y0)), ((d1, y0), (a1, y0))):
                if abs(qb[0] - qa[0]) > 1e-4:
                    P = [R.P3(i, sa, qa[0], y0), R.P3(i, sb, qa[0], y0), R.P3(i, sb, qb[0], y0), R.P3(i, sa, qb[0], y0)]
                    g.face(P, COPING, out=(0.0, -1.0, 0.0), uvs=[(U(sa), 0.0), (U(sb), 0.0), (U(sb), 0.08), (U(sa), 0.08)],
                           floor=floor, k=0.45)
            for s_, sg in ((sa, -1.0), (sb, 1.0)):
                sec = [pt(s_, q) for q in prof]
                u0 = U(s_)
                uvs = [(u0, (q[0] - a0) / wd) for q in prof]
                g.face(sec, COPING, out=(e.t.x * sg, 0.0, e.t.y * sg), uvs=uvs, floor=floor, k=0.8)


# ------------------------------------------------------------------ the wall: body, walk, parapets


def build_ring(g, R, ctx):
    h = ctx.h
    n = len(R.E)
    for i, e in enumerate(R.E):
        if e.kind == "gate":
            continue
        foot = FOOT_RIVER if e.river else FOOT_LAND
        if e.kind == "field":
            yc = h - 0.3
            prof = [(0.0, foot), (0.0, 0.0), (bat(PL, h), PL), (bat(PL, h) + 0.05, PL + 0.06), (bat(yc, h) + 0.05, yc),
                    (bat(yc, h) - 0.08, yc), (bat(yc, h) - 0.08, h), (BATTER, h)]
        else:
            spans = stair_spans(R, i, ctx)
            moss = moss_spans(R, i, ctx)
            if moss:
                foot = MOSS_FOOT  # down past the pond's bed
            prof = [(0.0, foot), (0.0, 0.0), (0.0, PL), (0.04, PL + 0.05), (0.04, h - 0.25), (-0.05, h - 0.25), (-0.05, h),
                    (0.0, h)]
            if spans or moss:
                # along a stair the coping steps back flush with the face, so nothing hangs over the flight;
                # where the park's pond lies against the face the plinth is mossy and damp
                flush = prof[:5] + [(0.0, h - 0.25), (0.0, h)]
                cuts = sorted({0.0, e.L} | {v for a, b in spans for v in (a, b)} | {v for a, b, _ in moss for v in (a, b)})
                for a, b in zip(cuts, cuts[1:]):
                    if b - a < 1e-4:
                        continue
                    m = (a + b) / 2
                    st = any(s0 <= m <= s1 for s0, s1 in spans)
                    mats = [PLINTH, PLINTH, STONE, BRICK, STONE, STONE] + ([] if st else [STONE])
                    R.sweep(g, i, flush if st else prof, mats, [(a, b)], floor=0.0, shade=(lambda p: wet(p, ctx)) if moss else None)
                lip = [(-0.05, h - 0.25), (-0.05, h), (0.0, h), (0.0, h - 0.25)]
                for s0, s1, sf in stair_spans(R, i, ctx, feet=True):
                    if 1e-3 < sf < e.L - 1e-3:  # the lip's end over the stair's foot (at its head the top riser covers it)
                        R.cap(g, i, sf, lip, 1 if abs(sf - s0) < 1e-6 else -1, STONE, floor=0.0)
                continue
        # (the look pass: under each drain spout the face is cut into a strip of its own, darker at the top: the wet
        # streak down the brick is the face's own shade, no layer laid over it)
        spots = spout_spots(R, i, ctx) if e.kind == "field" else []
        wet_runs = [(sp - SPOUT_W, sp + SPOUT_W) for sp in spots]
        R.sweep(g, i, prof, [PLINTH, PLINTH, STONE, BRICK, STONE, STONE, STONE], complement(wet_runs, e.L), floor=0.0, quoin=True)
        if wet_runs:
            R.sweep(g, i, prof, [PLINTH, PLINTH, STONE, BRICK, STONE, STONE, STONE], wet_runs, floor=0.0, quoin=True, shade=streak)
        for sp in spots:
            spout(g, e, sp, h)

    # the walk: the outline, pulled in by the batter on the field side, cut on a grid
    def dw(e):
        return BATTER if e.kind == "field" else 0.0

    ring = [R.meet(i - 1, i, dw(R.E[i - 1]), dw(R.E[i])) for i in range(n)]
    for tri in fill_poly(ring, ctx.grass_cuts + ctx.region_cuts):
        c = sum(tri, Vector((0.0, 0.0))) / len(tri)
        mat = GRASS if grass_at(c, ctx) else COBBLE
        uvs = None
        if mat == COBBLE:
            ua, uo = ctx.walk_axes(c)
            tu, tv = TILE[COBBLE]
            uvs = [(p.dot(ua) / tu, p.dot(uo) / tv) for p in tri]
        g.face([(p.x, h, p.y) for p in tri], mat, out=(0, 1, 0), uvs=uvs, floor=h - 1.0, k=0.95 if mat == COBBLE else 1.0)

    # the parapets: low on the town side, the breastwork with embrasures on the field side
    for i, e in enumerate(R.E):
        if e.kind == "gate":
            continue
        prv, nxt = R.E[i - 1], R.E[(i + 1) % n]
        if e.kind == "town":
            runs = R.solid_runs(i, TOWN_T / 2, ctx)
            keep = []
            for s0, s1 in runs:
                # a stone post where the parapet stops at a stair's head (not at a corner)
                a0 = s0 + (0.4 if s0 > 1e-3 else 0.0)
                b0 = s1 - (0.4 if s1 < e.L - 1e-3 else 0.0)
                for pa, pb in ((s0, a0), (b0, s1)):
                    if pb - pa > 0.1:
                        post(g, R, i, pa, pb, h)
                if b0 - a0 > 0.05:
                    keep.append((a0, b0))
            pb_ = h + TOWN_H - 0.15
            R.sweep(g, i, [(0.0, h), (0.0, pb_), (TOWN_T, pb_), (TOWN_T, h)], [BRICK, None, BRICK], keep, floor=h)
            # (the look pass: bluestone slabs, a drip over both faces)
            coping_slabs(g, R, i, keep, 0.0, TOWN_T, pb_, h + TOWN_H, 0.045, 0.045, slab_rng(e, i), h - 1.0)
            sec = [(0.0, h), (0.0, pb_), (TOWN_T, pb_), (TOWN_T, h)]
            # (where a run stops inside the edge a post stands against its end: no cap there)
            if keep and keep[0][0] < 1e-3 and prv.kind == "field":
                R.cap(g, i, 0.0, sec, -1, BRICK, floor=h)
            if keep and keep[-1][1] > e.L - 1e-3 and nxt.kind == "field":
                R.cap(g, i, e.L, sec, 1, BRICK, floor=h)
        else:
            d_in = BW_O + BW_T
            runs = R.solid_runs(i, (BW_O + d_in) / 2, ctx)
            huts = hut_spans(R, i, ctx)
            keep = intersect(complement(huts, e.L), runs)
            breach = works_span(e, ctx)
            if breach:
                keep = intersect(keep, complement([breach], e.L))
            embs = []
            if e.L >= 7.0:
                nemb = int((e.L - 3.0) / EMB_STEP)
                for kk in range(nemb):
                    s = e.L * (kk + 1) / (nemb + 1)
                    sp = (s - EMB_W / 2, s + EMB_W / 2)
                    if any(sp[0] < b + 0.6 and sp[1] > a - 0.6 for a, b in huts):
                        continue
                    if any(r0 + 0.8 <= sp[0] and sp[1] <= r1 - 0.8 for r0, r1 in keep):
                        embs.append(sp)
            y0, y1, yt = h + EMB_Y0, h + EMB_Y1, h + BW_H
            keep_up = intersect(keep, complement(embs, e.L))
            R.sweep(g, i, [(BW_O, h), (BW_O, y0), (d_in, y0), (d_in, h)], [BRICK, None, BRICK], keep, floor=h, quoin=True)
            R.sweep(g, i, [(BW_O, y0), (d_in, y0)], [STONE], embs, floor=h)
            R.sweep(g, i, [(BW_O, y0), (BW_O, y1), (d_in, y1), (d_in, y0)], [BRICK, None, BRICK], keep_up, floor=h, quoin=True)
            coping_slabs(g, R, i, keep, BW_O, d_in, y1, yt, 0.05, 0.045, slab_rng(e, i), h - 1.0, bed=keep_up)
            R.sweep(g, i, [(d_in, y1), (BW_O, y1)], [STONE], embs, floor=h, k=0.7)
            jamb = [(BW_O, y0), (BW_O, y1), (d_in, y1), (d_in, y0)]
            for a, b in embs:
                R.cap(g, i, a, jamb, 1, STONE, floor=h)
                R.cap(g, i, b, jamb, -1, STONE, floor=h)
            sec = [(BW_O, h), (BW_O, y1), (d_in, y1), (d_in, h)]
            if keep and keep[0][0] < 1e-3 and prv.kind == "town":
                R.cap(g, i, 0.0, sec, -1, BRICK, floor=h)
            if keep and keep[-1][1] > e.L - 1e-3 and nxt.kind == "town":
                R.cap(g, i, e.L, sec, 1, BRICK, floor=h)
            if breach:
                # the breastwork pulled down: its broken ends, bricks torn out stepping down to the walk
                for sb_, sg_ in ((breach[0], 1), (breach[1], -1)):
                    R.cap(g, i, sb_, [(BW_O, h), (BW_O, y1), (d_in, y1), (d_in, h)], sg_, BRICK, floor=h)
                    for dy1, e0, e1, ins in ((0.62, 0.0, 0.55, 0.03), (0.3, 0.55, 1.1, 0.05)):
                        a_, b_ = (sb_ + e0, sb_ + e1) if sg_ > 0 else (sb_ - e1, sb_ - e0)
                        step = [(BW_O + ins, h), (BW_O + ins, h + dy1), (d_in - ins, h + dy1), (d_in - ins, h)]
                        R.sweep(g, i, step, [BRICK, BRICK, BRICK], [(a_, b_)], floor=h, k=0.9)
                        R.cap(g, i, b_ if sg_ > 0 else a_, step, sg_, BRICK, floor=h)
            # (the look pass) drain spouts under the cordon with a wet streak down the brick; the old guns' iron
            # breeching rings by some embrasures
            for kk, (a, b) in enumerate(embs):
                if kk % 3 == 1:
                    iron_ring(g, e, a - 0.32, d_in, h + 0.52)


WORKS = ("seg7", 70.0, 80.0)  # the look pass: the stretch of breastwork the town's gang is pulling down (server/src/town/wallfolk.ts)


def works_span(e, ctx):
    """Where the demolition works' breach lies along field edge e: (s0, s1), or None."""
    sg = next((q for q in ctx.segs if q["name"] == WORKS[0]), None)
    if sg is None:
        return None
    t, o = V2(sg["t"]), V2(sg["o"])
    if abs(e.t.dot(t)) < 0.999 or abs(cross2(t, e.A - o)) > 0.3:
        return None
    a, b = sorted(((o + t * WORKS[1] - e.A).dot(e.t), (o + t * WORKS[2] - e.A).dot(e.t)))
    a, b = max(0.0, a), min(e.L, b)
    return (a, b) if b - a > 1.0 else None


SPOUT_W = 0.09  # half the width of the wet streak under a spout


def spout_spots(R, i, ctx):
    """Where the drain spouts come out of field edge i (s along it): every 13 to 19 m where the breastwork stands
    over them, clear of the guard houses, the corners' quoins and the works' breach."""
    e = R.E[i]
    d_in = BW_O + BW_T
    huts = hut_spans(R, i, ctx)
    keep = intersect(complement(huts, e.L), R.solid_runs(i, (BW_O + d_in) / 2, ctx))
    breach = works_span(e, ctx)
    if breach:
        keep = intersect(keep, complement([breach], e.L))
    rng = slab_rng(e, i + 101)
    out = []
    s = rng.uniform(5.0, 11.0)
    while s < e.L - QW - 0.6:
        if s > QW + 0.6 and not any(a - 1.2 < s < b + 1.2 for a, b in huts) and any(r0 + 0.5 < s < r1 - 0.5 for r0, r1 in keep):
            out.append(s)
        s += rng.uniform(13.0, 19.0)
    return out


def streak(p):
    """The field face's shade in a spout's wet streak: dark under the spout, fading out toward the plinth."""
    return amb(p, 0.0) * (0.52 + 0.48 * sm((6.0 - p[1]) / 4.2))


def spout(g, e, s, h):
    """A bluestone drain spout out of the field face just under the cordon, at s along edge e (the look pass; the
    wet streak under it is the face's own strip, build_ring)."""
    F = Frame(e.A.x, e.A.y, (e.t.x, e.t.y), (-e.n.x, -e.n.y))  # o out toward the field (o = -d)
    ys = h - 0.3 - 0.26
    df = bat(ys, h) + 0.05
    F.box(g, s - 0.085, s + 0.085, -df - 0.06, -df + 0.4, ys, ys + 0.15, COPING, skip=("-o",), floor=ys - 2.0, k=0.9)


def iron_ring(g, e, s, d_face, y):
    """An iron ring on a staple in the breastwork's inner face (the guns' breeching rings), at s along edge e."""
    F = Frame(e.A.x, e.A.y, (e.t.x, e.t.y), (e.n.x, e.n.y))  # o into the wall from the field edge: the walk is past d_face
    o = d_face + 0.03
    bar(g, F.p(s, d_face - 0.02, y), F.p(s, o + 0.005, y), 0.022, IRON, shade=0.7)
    r, cy = 0.07, y - 0.075
    pts = [F.p(s + r * math.sin(2 * math.pi * k / 6), o, cy + r * math.cos(2 * math.pi * k / 6)) for k in range(6)]
    for k in range(6):
        bar(g, pts[k], pts[(k + 1) % 6], 0.018, IRON, shade=0.6)


LAWN_OUT, LAWN_IN, LAWN_Y, PATH_Y = 0.5, 0.25, 0.012, 0.016


def build_lawns(g, ctx):
    """The lawns on the land bastions (the look pass, 2026-09-26; Steve: "a flat green rectangle with a hard edge"):
    a band of grass, tussocks, straw and leaves over every edge of a lawn, thick on the lawn and thinning out into the
    setts' joints, and a path trodden across each from where the walk comes in (both cut-out decals, wall_lawn_decal).
    Their outlines go to the game for the tussocks and leaves on them (dressing "lawns": world/rampartNature.ts)."""
    h = ctx.h
    ctx.dress["lawns"] = []
    for (name, _P), (ring, paved) in zip(ctx.land_bastions, ctx.grass):
        P = [V2(p) for p in ring]
        edges = [(P[j], P[(j + 1) % len(P)]) for j in range(len(P))]
        for q in paved:
            Q = [V2(p) for p in q]
            edges += [(Q[j], Q[(j + 1) % 4]) for j in range(4)]
        u = 0.0
        for A, Bp in edges:
            d = Bp - A
            L = d.length
            if L < 1e-3:
                continue
            t = d / L
            nn = Vector((-t.y, t.x))
            ss = splits(0.0, L, 1.0)
            for sa, sb in zip(ss, ss[1:]):
                m = A + t * ((sa + sb) / 2)
                l1, l2 = grass_at(m + nn * 0.3, ctx), grass_at(m - nn * 0.3, ctx)
                if l1 == l2:
                    continue
                side = nn if l1 else -nn
                pa, pb = A + t * sa, A + t * sb
                q = [pa + side * LAWN_IN, pb + side * LAWN_IN, pb - side * LAWN_OUT, pa - side * LAWN_OUT]
                g.face([(p.x, h + LAWN_Y, p.y) for p in q], LAWN, out=(0, 1, 0),
                       uvs=[(u + sa, 1.0), (u + sb, 1.0), (u + sb, 0.5), (u + sa, 0.5)], shade=0.95)
            u += L
        # the worn path: from the lawn's edge nearest the walk's way in, across by the middle, a gentle wander
        V = V2(ctx.blist[name]["vertex"])
        c = centroid(P)
        a = min(P, key=lambda p: (p - V).length)
        a = a + (c - a) * 0.02
        ax_ = (c - a).normalized()
        far = max(P, key=lambda p: abs(cross2(ax_, p - a)) + 0.3 * (p - a).length)  # a corner well off the paved way in
        mid = a + (far - a) * 0.45 + (far - a).orthogonal().normalized() * 1.5
        pts = [a, mid, far + (c - far) * 0.03]
        rng = np.random.default_rng(int(abs(V.x * 13 + V.y * 7)) % (2 ** 31))
        dist = 0.0
        for (p0, p1) in zip(pts, pts[1:]):
            d = p1 - p0
            L = d.length
            t = d / L
            nn = Vector((-t.y, t.x))
            ss = splits(0.0, L, 0.8)
            for sa, sb in zip(ss, ss[1:]):
                m = p0 + t * ((sa + sb) / 2)
                if not grass_at(m, ctx):
                    continue
                wa = 0.42 + 0.08 * math.sin((dist + sa) * 1.3)
                wb = 0.42 + 0.08 * math.sin((dist + sb) * 1.3)
                pa, pb = p0 + t * sa, p0 + t * sb
                q = [pa - nn * wa, pb - nn * wb, pb + nn * wb, pa + nn * wa]
                g.face([(p.x, h + PATH_Y, p.y) for p in q], LAWN, out=(0, 1, 0),
                       uvs=[(dist + sa, 0.0), (dist + sb, 0.0), (dist + sb, 0.5), (dist + sa, 0.5)], shade=0.92)
            dist += L
        ctx.dress["lawns"].append({"ring": [[round(p.x, 2), round(p.y, 2)] for p in P],
                                   "paved": [[[round(x, 2), round(z, 2)] for x, z in q] for q in paved],
                                   "path": [[round(p.x, 2), round(p.y, 2)] for p in pts]})


def stair_spans(R, i, ctx, feet=False):
    """Where stair flights run along edge i of a ring (a town face): (s0, s1) from each foot to its
    head; with feet, (s0, s1, s of the foot)."""
    e = R.E[i]
    out = []
    for st in ctx.D["stairs"]:
        F, RUN, LAND, W = stair_frame(st, ctx)
        foot = Vector((F.ox, F.oz))
        ua = Vector(F.ua)
        if abs(ua.dot(e.t)) < 0.999 or abs((foot - e.A).dot(e.n)) > 0.05:
            continue
        sf = (foot - e.A).dot(e.t)
        a, b = sorted((sf, (foot + ua * RUN - e.A).dot(e.t)))
        a, b = max(0.0, a), min(e.L, b)
        if b - a > 1e-3:
            out.append((a, b, sf) if feet else (a, b))
    return sorted(out)


MOSS_FOOT = -1.6  # the town face goes this deep where the pond lies against it


def pond_stretch(ctx):
    """Where the Stadspark's pond (park.json "pond") lies against the town face: (P, t, c0, c1, out),
    the stretch c0..c1 along the inner line's piece from P along t, out toward the town. The ring's
    points within MOSS_TOUCH of the face; if the pond does not reach it yet, within MOSS_NEAR."""
    try:
        with open(PARK) as f:
            pond = [V2(p) for p in json.load(f)["pond"]]
    except (OSError, KeyError, ValueError, TypeError):
        return None
    for lim in (MOSS_TOUCH, MOSS_NEAR):
        for P, Q in ctx.town_lines[1:-1]:
            d = Q - P
            L = d.length
            t = d / L
            nn = Vector((-t.y, t.x))
            ss = [(p - P).dot(t) for p in pond if abs((p - P).dot(nn)) < lim and -0.5 <= (p - P).dot(t) <= L + 0.5]
            if ss:
                out = nn if (ctx.centre - P).dot(nn) > 0 else -nn
                print(f"[build_wall] the pond lies against the town face for {max(ss) - min(ss):.1f} m (within {lim} m)")
                return P, t, min(ss), max(ss), out
    return None


def moss_spans(R, i, ctx):
    """The stretch of edge i of a ring that the moss decal covers: [(s0, s1, None)] or []."""
    if ctx.moss is None:
        return []
    P, t, c0, c1, _ = ctx.moss
    e = R.E[i]
    if abs(t.dot(e.t)) < 0.999 or abs((e.A - P).dot(Vector((-t.y, t.x)))) > 0.05:
        return []
    sa, sb = sorted(((P + t * (c0 - MOSS_PAD) - e.A).dot(e.t), (P + t * (c1 + MOSS_PAD) - e.A).dot(e.t)))
    sa, sb = max(0.0, sa), min(e.L, sb)
    return [(sa, sb, None)] if sb - sa > 1e-3 else []


def build_moss(g, ctx):
    """The moss decal: its own faces MOSS_OFF off the town face (toward the town, over the pond),
    one picture (wall_moss_decal) over the whole stretch, cut into pieces at most 3 m long."""
    if ctx.moss is None:
        return
    P, t, c0, c1, out = ctx.moss
    s0, s1 = c0 - MOSS_PAD, c1 + MOSS_PAD
    ys = splits(MOSS_Y0, MOSS_Y1, 1.2)
    ss = splits(s0, s1, 3.0)
    o = out * MOSS_OFF
    for sa, sb in zip(ss, ss[1:]):
        for ya, yb in zip(ys, ys[1:]):
            q = [(P.x + t.x * sv + o.x, yv, P.y + t.y * sv + o.y) for sv, yv in ((sa, ya), (sb, ya), (sb, yb), (sa, yb))]
            uvs = [((sv - s0) / (s1 - s0), (yv - MOSS_Y0) / (MOSS_Y1 - MOSS_Y0)) for sv, yv in ((sa, ya), (sb, ya), (sb, yb), (sa, yb))]
            g.face(q, DECAL, out=(out.x, 0.0, out.y), uvs=uvs, shade=lambda p: wet(p, ctx))


def wet(p, ctx):
    """The vertex shade by the pond: amb, and darker low down, fading out along MOSS_PAD past the pond."""
    base = amb(p, 0.0)
    if ctx.moss is None:
        return base
    P, t, c0, c1, _ = ctx.moss
    s = (Vector((p[0], p[2])) - P).dot(t)
    f = 1.0 if c0 <= s <= c1 else max(0.0, 1.0 - min(abs(s - c0), abs(s - c1)) / MOSS_PAD)
    return base * (1.0 - 0.3 * f * (1.0 - sm((p[1] + 0.35) / 2.0)))


def build_ferns(g, ctx):
    """A few ferns in the plinth's joints over the pond, fronds fanning out of the wall."""
    if ctx.moss is None:
        return
    P, t, c0, c1, out = ctx.moss
    rng = np.random.default_rng(1875)
    up = Vector((0.0, 1.0, 0.0))
    o3, t3 = Vector((out.x, 0.0, out.y)), Vector((t.x, 0.0, t.y))
    s = c0 + 0.8
    while s < c1 - 0.8:
        y = float(rng.choice([0.0, 0.0, 0.6, 0.6, 1.2]))
        root = Vector((P.x + t.x * s, y, P.y + t.y * s)) - o3 * 0.02
        for _ in range(int(rng.integers(5, 8))):
            ph = math.radians(rng.uniform(-65, 65))
            th = math.radians(rng.uniform(-25, 40))
            d = (o3 * math.cos(ph) + t3 * math.sin(ph)) * math.cos(th) + up * math.sin(th)
            L = rng.uniform(0.35, 0.55)
            side = d.cross(up).normalized() * 0.065
            mid = root + d * (L * 0.45)
            tip = root + d * L - up * (0.12 * L)
            for tri in ((root, mid + side, tip), (root, tip, mid - side)):
                g.face(list(tri), GRASS, out=(d.cross(side)).normalized() if d.cross(side).y >= 0 else -(d.cross(side)).normalized(),
                       shade=0.9)
        s += float(rng.uniform(1.8, 3.2))


def intersect(A, Bs):
    out = []
    for a0, a1 in A:
        for b0, b1 in Bs:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi - lo > 1e-4:
                out.append((lo, hi))
    return sorted(out)


def hut_spans(R, i, ctx):
    """Where a guard house stands on the breastwork's line along edge i: the breastwork stops 2 cm
    inside the house's walls."""
    e = R.E[i]
    out = []
    for hut in ctx.huts:
        ss, dd = [], []
        for p in hut.poly(HIN):
            r = p - e.A
            ss.append(r.dot(e.t))
            dd.append(r.dot(e.n))
        if min(dd) < ctx.band + 0.05 and max(dd) > 0.0 and min(ss) < e.L and max(ss) > 0:
            out.append((min(ss) + 0.02, max(ss) - 0.02))
    return out


def post(g, R, i, s0, s1, h):
    """A stone post on the town parapet's line where it stops for a stair."""
    e = R.E[i]
    F = Frame(e.A.x, e.A.y, (e.t.x, e.t.y), (-e.n.x, -e.n.y))
    F.box(g, s0, s1, -0.5, 0.0, h, h + 1.2, STONE, skip=("-y", "+y"), floor=h)
    c = (s0 + s1) / 2
    pyramid(g, [F.p(s0, 0.0, h + 1.2), F.p(s1, 0.0, h + 1.2), F.p(s1, -0.5, h + 1.2),
                F.p(s0, -0.5, h + 1.2)], F.p(c, -0.25, h + 1.42), STONE, bottom=False, floor=h)


def fill_poly(ring, cuts=()):
    """Triangles over a (concave) outline, cut on the GRID so no triangle is large, and along the
    given segments (a, b) near them (the edges of the grass)."""
    bm = bmesh.new()
    vs = [bm.verts.new((p.x, p.y, 0.0)) for p in ring]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    xs = [p.x for p in ring]
    zs = [p.y for p in ring]
    for axis, lo, hi in ((0, min(xs), max(xs)), (1, min(zs), max(zs))):
        for k in range(math.ceil(lo / GRID), math.floor(hi / GRID) + 1):
            co = [0.0, 0.0, 0.0]
            no = [0.0, 0.0, 0.0]
            co[axis] = k * GRID
            no[axis] = 1.0
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    for a, b in cuts:
        lo_x, hi_x = min(a.x, b.x) - 6, max(a.x, b.x) + 6
        lo_z, hi_z = min(a.y, b.y) - 6, max(a.y, b.y) + 6
        fs = [f for f in bm.faces if lo_x <= f.calc_center_median().x <= hi_x and lo_z <= f.calc_center_median().y <= hi_z]
        if not fs:
            continue
        es = list({e for f in fs for e in f.edges})
        vs_ = list({v for f in fs for v in f.verts})
        d = b - a
        bmesh.ops.bisect_plane(bm, geom=vs_ + es + fs, dist=1e-5, plane_co=(a.x, a.y, 0.0), plane_no=(-d.y, d.x, 0.0))
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    tris = [[Vector((v.co.x, v.co.y)) for v in f.verts] for f in bm.faces]
    bm.free()
    return tris


GRASS_IN = 3.2  # the paved walk round a land bastion's top, inside its edges


def inset(P, d):
    """A polygon pulled in by d (mitred corners)."""
    n = len(P)
    area = sum(P[i].x * P[(i + 1) % n].y - P[(i + 1) % n].x * P[i].y for i in range(n))
    E = []
    for i in range(n):
        t = (P[(i + 1) % n] - P[i]).normalized()
        nn = Vector((-t.y, t.x)) if area > 0 else Vector((t.y, -t.x))
        E.append((P[i] + nn * d, t))
    return [line_x(E[i - 1][0], E[i - 1][1], E[i][0], E[i][1]) or E[i][0] for i in range(n)]


def rect_poly(c, ua, uo, a0, a1, o0, o1):
    return [c + ua * a + uo * o for a, o in ((a0, o0), (a1, o0), (a1, o1), (a0, o1))]


def bastion_outer(ctx, P, V):
    """A land bastion's own part, out from the curtain's field face: its ring less the corners on
    the town face, with the line's corner V put back in their place."""
    out, put = [], False
    n = len(P)
    on_town = [any(on_line(p, p, a, b) for a, b in ctx.town_lines) for p in P]
    # start just after a town-face run, so the run stays in one piece
    k0 = next((j for j in range(n) if on_town[j - 1] and not on_town[j]), 0)
    for j in range(n):
        p = P[(k0 + j) % n]
        if on_town[(k0 + j) % n]:
            if not put:
                out.append(V)
                put = True
        else:
            out.append(p)
    return out


def grass_areas(ctx):
    """The grass on each land bastion's own top (an inset outline), the paved squares round its
    guard house or its mill and a path from their doors to the walk; the cut lines that make their
    edges clean."""
    areas, cuts = [], []
    for name, P in ctx.land_bastions:
        b = ctx.blist[name]
        V = V2(b["vertex"])
        Pi = inset(bastion_outer(ctx, P, V), GRASS_IN)
        paved = []
        ring = [(p.x, p.y) for p in P]
        spots = []
        for hut in ctx.huts:
            if inside((hut.c.x, hut.c.y), ring):
                ua, uo, W2, D2 = hut.facing(V - hut.c)
                spots.append((hut.c, ua, uo, W2 + 1.5, D2 + 1.5, 1.0))
        for mc, mr, _, M in ctx.mills:
            if inside((mc.x, mc.y), ring):
                uo = (V - mc).normalized()
                ext = 1.5 if M["stage"] is None else 1.8  # (a stage mill: the paving reaches past its gallery)
                spots.append((mc, Vector((-uo.y, uo.x)), uo, mr + ext, mr + ext, 1.2))
        for c, ua, uo, W, Dd, pw in spots:
            reach = (V - c).dot(uo)
            for q in (rect_poly(c, ua, uo, -W, W, -Dd, Dd), rect_poly(c, ua, uo, -pw, pw, 0.0, reach)):
                paved.append([(p.x, p.y) for p in q])
                cuts += [(q[j], q[(j + 1) % 4]) for j in range(4)]
        cuts += [(Pi[j], Pi[(j + 1) % len(Pi)]) for j in range(len(Pi))]
        areas.append(([(p.x, p.y) for p in Pi], paved))
    return areas, cuts


def grass_at(c, ctx):
    for ring, paved in ctx.grass:
        if inside((c.x, c.y), ring) and not any(inside((c.x, c.y), q) for q in paved):
            return True
    return False


# ------------------------------------------------------------------ guard houses and turrets


def build_hut(g, hut, d, dc, h):
    """A 4 x 4 m guard house on the walk, turned with its footprint, the door on the side facing
    d: brick on a stone base, quoins, a slate pyramid roof, an open door (a room inside, the leaf
    swung in, a bench), a window, a lantern by the door."""
    ua, uo, W2, D2 = hut.facing(d)
    W2, D2 = W2 - HIN, D2 - HIN
    cx, cz = hut.c.x, hut.c.y
    F = Frame(cx, cz, (ua.x, ua.y), (uo.x, uo.y))
    yw = h + HUT_WALL
    dc = max(-W2 + 0.9, min(W2 - 0.9, dc))
    y_d = h + 2.1
    base, band = (h, h + 0.3), (yw - 0.2, yw)
    c = [(-W2, D2), (W2, D2), (W2, -D2), (-W2, -D2)]
    outs = [(0, 1), (1, 0), (0, -1), (-1, 0)]
    for k in range(4):
        pn = Panel(g, F, c[k], c[(k + 1) % 4], outs[k])
        holes = [(dc + W2 - 0.5, dc + W2 + 0.5, h, y_d)] if k == 0 else []
        pn.wall(h, yw, BRICK, holes, (True, True), bands=(band,), floor=h)
        if k == 0:
            u0, u1 = dc + W2 - 0.5, dc + W2 + 0.5
            pn.reveal(u0, u1, h, y_d, HUT_WT, STONE, sill=False, floor=h)
            # the stone surround, a hand proud of the wall
            F.box(g, dc - 0.72, dc - 0.5, D2, D2 + 0.05, h, y_d, STONE, skip=("-o", "-y", "+y"), floor=h)
            F.box(g, dc + 0.5, dc + 0.72, D2, D2 + 0.05, h, y_d, STONE, skip=("-o", "-y", "+y"), floor=h)
            F.box(g, dc - 0.72, dc + 0.72, D2, D2 + 0.05, y_d, y_d + 0.3, STONE, skip=("-o",), floor=h)
            # the threshold, above the walk (the room's floor)
            F.box(g, dc - 0.5, dc + 0.5, D2 - HUT_WT, D2 + 0.04, h, h + 0.12, STONE, skip=("-y", "-a", "+a", "-o"), floor=h)
        if k == 1:
            pn.sheet(D2 - 0.3, D2 + 0.3, h + 1.1, h + 1.75, WINDOW, floor=h)
    # a stone base course, proud of the brick
    for k in range(4):
        pn = Panel(g, F, c[k], c[(k + 1) % 4], outs[k])
        if k == 0:
            u0, u1 = dc + W2 - 0.5 - 0.22, dc + W2 + 0.5 + 0.22
            for a, b in ((-0.04, u0), (u1, pn.L)):
                seg_base(g, pn, a, b, h)
        else:
            seg_base(g, pn, -0.04, pn.L, h)
    # the room inside
    iw, idp, yf, yc = W2 - HUT_WT, D2 - HUT_WT, h + 0.12, h + 2.45
    dk = 0.55
    F.quad(g, [(-iw, -idp, yf), (iw, -idp, yf), (iw, idp, yf), (-iw, idp, yf)], WOOD, (0, 0, 1), floor=h, k=0.7)
    F.quad(g, [(-iw, -idp, yc), (iw, -idp, yc), (iw, idp, yc), (-iw, idp, yc)], WOOD, (0, 0, -1), floor=h, k=0.45)
    # (pass 2: the room is lit by its oil lamp: warm walls, bright at night, dark by day: world/rampart.ts)
    for pa, pb, o in (((iw, idp), (iw, -idp), (-1, 0)), ((iw, -idp), (-iw, -idp), (0, 1)), ((-iw, -idp), (-iw, idp), (1, 0))):
        Panel(g, F, pa, pb, o).wall(yf, yc, ROOM, floor=yf, k=dk, seg=8.0)
    fr = Panel(g, F, (iw, idp), (-iw, idp), (0, -1))
    fr.wall(yf, yc, ROOM, [(iw - dc - 0.5, iw - dc + 0.5, yf, y_d)], floor=yf, k=dk, seg=8.0)
    lx, _, lz = F.p(-iw + 0.45, -idp + 0.45, yc)
    lantern(g, lx, yc, lz, w=0.18, hh=0.26, record=False)  # the oil lamp hanging in the far corner
    # the leaf, swung in against its jamb; a bench along the far wall
    F.box(g, dc + 0.44, dc + 0.5, idp - 1.0, idp - 0.02, yf + 0.02, y_d - 0.04, WOOD, floor=yf, k=0.8)
    F.box(g, -iw, -iw + 0.38, -idp + 0.15, idp - 1.1, yf, yf + 0.42, WOOD, skip=("-y", "-a"), floor=yf, k=0.8)
    # the lantern by the door, the roof and its finial
    la = dc + 0.95 if dc + 1.25 < W2 else dc - 0.95
    wall_lantern(g, F.p(la, D2, h + 2.6), F.v(0, 1)[::2], 0.35)  # its foot 1.98 m over the walk
    ov = 0.25
    roof = [F.p(-W2 - ov, D2 + ov, yw), F.p(W2 + ov, D2 + ov, yw), F.p(W2 + ov, -D2 - ov, yw), F.p(-W2 - ov, -D2 - ov, yw)]
    pyramid(g, roof, F.p(0, 0, yw + HUT_RISE), SLATE, floor=h)
    finial(g, cx, yw + HUT_RISE - 0.05, cz, 0.9)


def seg_base(g, pn, u0, u1, h):
    """A stone base course along a panel's foot, 4 cm proud."""
    P = pn.pt
    ht = h + 0.3
    g.face([P(u0, h, -0.04), P(u1, h, -0.04), P(u1, ht, -0.04), P(u0, ht, -0.04)], PLINTH, out=pn.outv(), floor=h)
    g.face([P(u0, ht, -0.04), P(u1, ht, -0.04), P(u1, ht, 0.0), P(u0, ht, 0.0)], PLINTH, out=(0, 1, 0), floor=h)


def build_turret(g, S, u, h):
    """The sentry box hung out at a land bastion's salient: a hexagonal pepper pot on a corbel."""
    Cc = S + u * 0.25
    x, z = Cc.x, Cc.y
    R = 0.85
    rot = math.atan2(u.y, u.x) - math.pi / 6  # a face looks along u
    lathe(g, (x, h - 2.4, z), [(0.0, 0.0), (0.35, 0.5), (R, 1.35), (R + 0.06, 1.35), (R + 0.06, 1.55)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, -0.85), (R, 1.3)], 6, BRICK, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 1.3), (R + 0.05, 1.3), (R + 0.05, 1.42), (R, 1.42)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 1.42), (R, 2.15)], 6, BRICK, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 2.15), (R + 0.16, 2.15), (R + 0.16, 2.3)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R + 0.16, 2.3), (0.0, 3.75)], 6, SLATE, rot=rot, floor=h - 3)
    finial(g, x, h + 3.7, z, 0.8)
    # a slit toward the field and one to each side
    for ang in (0.0, math.pi / 3, -math.pi / 3):
        a = math.atan2(u.y, u.x) + ang
        nx, nz = math.cos(a), math.sin(a)
        rr = R * math.cos(math.pi / 6) + 0.035
        cxs, czs = x + nx * rr, z + nz * rr
        tx, tz = -nz, nx
        q = [(cxs - tx * 0.08, h + 0.3, czs - tz * 0.08), (cxs + tx * 0.08, h + 0.3, czs + tz * 0.08),
             (cxs + tx * 0.08, h + 1.05, czs + tz * 0.08), (cxs - tx * 0.08, h + 1.05, czs - tz * 0.08)]
        g.face(q, IRON, out=(nx, 0, nz), shade=0.35)


# ------------------------------------------------------------------ gates and bridges


def build_gate(g, gt, ctx):
    h, T = ctx.h, ctx.t
    F = ctx.sframe(gt["frame"], gt["s"])

    def rect_loc(r):
        pts = [F.loc(x, z) for x, z in r]
        a = [min(p[0] for p in pts), max(p[0] for p in pts)]
        o = [min(p[1] for p in pts), max(p[1] for p in pts)]
        return a, o

    (ha0, ha1), (o_in, o_out) = rect_loc(gt["house"])
    HA = max(-ha0, ha1)
    (pa0, pa1), _ = rect_loc(gt["passage"])
    PW = max(-pa0, pa1)
    posts = [F.loc(x, z) for x, z in gt["posts"]]
    post_a = max(abs(p[0]) for p in posts)
    TOP = h + TOWER_UP
    MID = h + MID_UP
    FR = h + FR_UP  # the frontispiece's cornice
    FRW = PW + 1.2  # the frontispiece's half width
    o_f = o_out - 0.25  # the towers' field faces
    o_fr = o_out - 0.1  # the frontispiece's face (its cornice reaches o_out)
    crown = SPR + PW
    oc = (o_in + o_fr) / 2

    def dark(p):
        a, o = F.loc(p[0], p[2])
        e = min(o - o_in, o_fr - o)
        return (0.82 - 0.4 * sm(e / 4.5)) * (0.8 + 0.2 * sm(p[1] / 2.0)) * tint(p[0], p[2])

    for s in (-1, 1):
        ai, ao = s * PW, s * HA
        # the town face: the arch's ring takes the strip by the passage; the sentry box's recess
        town = Panel(g, F, (ao, o_in), (ai, o_in), (0, -1))
        holes = [(HA - PW - 0.7, HA - PW, SPR, MID)]
        rec = None
        if s == 1:
            ra0, ra1 = post_a + 0.8, post_a + 2.3
            rec = (HA - ra1, HA - ra0, 0.0, 2.9)
            holes.append(rec)
        town.wall(FOOT_LAND, TOP - 0.35, BRICK, holes, (True, False), plinth=PL, bands=((h - 0.3, h),))
        if rec:
            sentry_box(g, F, town, rec, o_in)
        # the field face, behind the frontispiece by the arch
        field = Panel(g, F, (ai, o_f), (ao, o_f), (0, 1))
        field.wall(FOOT_LAND, TOP - 0.35, BRICK, [(0.0, FRW - PW, FOOT_LAND, FR), (0.0, FRW - PW + 0.2, FR, FR + 0.35)],
                   (False, True), plinth=PL, bands=((h - 0.3, h),))
        # the outer side: in the wall body up to the walk, then a door onto the walk
        side = Panel(g, F, (ao, o_f), (ao, o_in), (s, 0))
        uc = o_f - T / 2
        side.wall(FOOT_LAND, TOP - 0.35, BRICK, [(o_f - (T - 0.3), o_f - 0.1, FOOT_LAND, h - 0.02), (uc - 0.5, uc + 0.5, h, h + 2.1)],
                  (True, True), plinth=PL, bands=((h - 0.3, h),))
        side.reveal(uc - 0.5, uc + 0.5, h, h + 2.1, 0.18, STONE, back=WOOD, sill=False, floor=h, back_k=0.8)
        side.sheet(uc - 0.3, uc + 0.3, h + 3.0, h + 3.8, WINDOW, floor=h)
        # the passage wall (the leaves are shut across the passage, see gate_leaves)
        pw = Panel(g, F, (ai, o_in), (ai, o_f), (-s, 0))
        pw.wall(0.0, SPR, BRICK, plinth=1.0, shade=dark)
        # above the middle: the tower's face toward the other tower
        up = Panel(g, F, (ai, o_in), (ai, o_f), (-s, 0))
        up.wall(MID, TOP - 0.35, BRICK, quoin=(True, False), floor=MID)
        # windows and slits
        wa = (FRW + HA) / 2
        field.sheet(wa - PW - 0.4, wa - PW + 0.4, h + 2.3, h + 3.5, WINDOW)
        field.sheet(wa - PW - 0.11, wa - PW + 0.11, 3.0, 4.2, WINDOW)
        town.sheet(HA - wa - 0.4, HA - wa + 0.4, h + 2.3, h + 3.5, WINDOW)
        # the cornice, the roof, the finial
        a0, a1 = sorted((ai, ao))
        F.box(g, a0 - 0.15, a1 + 0.15, o_in - 0.15, o_f + 0.15, TOP - 0.35, TOP, STONE, skip=("+y",), floor=TOP - 2)
        rc = [F.p(a0 - 0.25, o_in - 0.25, TOP), F.p(a1 + 0.25, o_in - 0.25, TOP), F.p(a1 + 0.25, o_f + 0.25, TOP),
              F.p(a0 - 0.25, o_f + 0.25, TOP)]
        am, om = (a0 + a1) / 2, (o_in + o_f) / 2
        pyramid(g, rc, F.p(am, om, TOP + ROOF_RISE), SLATE, floor=TOP - 2)
        fx, _, fz = F.p(am, om, 0)
        finial(g, fx, TOP + ROOF_RISE - 0.08, fz, 1.3)
        # lanterns either side of the arch, on the frontispiece
        wall_lantern(g, F.p(s * (PW + 0.6), o_fr, 4.4), F.v(0, 1)[::2], 0.5)

    # the vault and the floor of the passage
    angs = [math.pi * k / 9 for k in range(10)]
    os_ = splits(o_in, o_fr, 3.2)
    for t0, t1 in zip(angs, angs[1:]):
        tm = (t0 + t1) / 2
        for oa, ob in zip(os_, os_[1:]):
            q = [F.p(PW * math.cos(t0), oa, SPR + PW * math.sin(t0)), F.p(PW * math.cos(t1), oa, SPR + PW * math.sin(t1)),
                 F.p(PW * math.cos(t1), ob, SPR + PW * math.sin(t1)), F.p(PW * math.cos(t0), ob, SPR + PW * math.sin(t0))]
            g.face(q, BRICK, out=F.v(-math.cos(tm), 0, -math.sin(tm)), shade=dark, k=0.9)
    for oa, ob in zip(splits(o_in, o_out, 2.5), splits(o_in, o_out, 2.5)[1:]):
        for aa, ab in ((-PW, 0.0), (0.0, PW)):
            F.quad(g, [(aa, oa, LIFT), (ab, oa, LIFT), (ab, ob, LIFT), (aa, ob, LIFT)], COBBLE, (0, 0, 1), shade=dark)
    # the lantern hanging in the passage
    lx, _, lz = F.p(0, oc, 0)
    bar(g, (lx, crown, lz), (lx, crown - 0.7, lz), 0.03, IRON, shade=0.5)
    lantern(g, lx, crown - 0.7, lz, 0.26, 0.4)
    gate_leaves(g, F, gt, PW, SPR, o_out, dark)

    # the middle over the passage, town side: the arch in brick with a stone ring, a coping
    arch_face(g, F, o_in, -1, PW + 0.7, PW, PW + 0.55, SPR, MID, BRICK, STONE)
    F.quad(g, [(-PW, o_in, MID), (PW, o_in, MID), (PW, o_f, MID), (-PW, o_f, MID)], STONE, (0, 0, 1), floor=MID - 1)
    # a parapet over the arch between the towers, as on the walk
    F.box(g, -PW, PW, o_in, o_in + TOWN_T, MID, MID + TOWN_H - 0.15, BRICK, skip=("-a", "+a", "-y", "+y"), floor=MID)
    F.box(g, -PW, PW, o_in - 0.04, o_in + TOWN_T + 0.04, MID + TOWN_H - 0.15, MID + TOWN_H, STONE, skip=("-a", "+a"), floor=MID)
    kb = SPR + PW * math.sin(math.pi * 4 / 9) - 0.05  # under the soffit's top chord
    F.box(g, -0.28, 0.28, o_in - 0.06, o_in, kb, crown + 0.6, STONE, skip=("+o",), k=1.08)  # keystone

    # the frontispiece on the field side: pilasters, the arch with its voussoirs, a cornice, the
    # attic with the lion shield, a small pediment with a ball, two obelisks
    for s in (-1, 1):
        a0, a1 = sorted((s * PW, s * FRW))
        F.quad(g, [(a0, o_fr, FOOT_LAND), (a1, o_fr, FOOT_LAND), (a1, o_fr, SPR), (a0, o_fr, SPR)], STONE, (0, 1, 0))
        F.quad(g, [(s * FRW, o_f, FOOT_LAND), (s * FRW, o_fr, FOOT_LAND), (s * FRW, o_fr, FR), (s * FRW, o_f, FR)], STONE, (s, 0, 0))
        F.box(g, a0 - (0.05 if s < 0 else 0), a1 + (0.05 if s > 0 else 0), o_fr, o_fr + 0.05, SPR - 0.25, SPR, STONE,
              skip=("-o",))  # the impost
        F.quad(g, [(s * PW, o_f, 0.0), (s * PW, o_fr, 0.0), (s * PW, o_fr, SPR), (s * PW, o_f, SPR)], STONE, (-s, 0, 0), shade=dark)
    arch_face(g, F, o_fr, 1, FRW, PW, PW + 0.65, SPR, FR, STONE, STONE, ring_k=(1.1, 0.8), proud=0.06)
    F.box(g, -0.3, 0.3, o_fr, o_out, kb, crown + 0.75, STONE, skip=("-o",), k=1.1)  # keystone
    F.box(g, -FRW - 0.2, FRW + 0.2, o_f, o_out, FR, FR + 0.35, STONE, floor=FR - 2)
    back = Panel(g, F, (PW, o_f), (-PW, o_f), (0, -1))
    back.wall(MID, FR, STONE, floor=MID)
    F.box(g, -2.1, 2.1, o_f, o_fr, FR + 0.35, FR + 2.2, STONE, skip=("-y", "+o"), floor=FR)
    F.quad(g, [(-2.1, o_fr, FR + 0.35), (2.1, o_fr, FR + 0.35), (2.1, o_fr, FR + 2.2), (-2.1, o_fr, FR + 2.2)], ARMS, (0, 1, 0),
           uvs=fit_uvs(4), floor=FR)
    pe = [(-2.35, FR + 2.28), (2.35, FR + 2.28), (0.0, FR + 2.95)]
    for oo, sg in ((o_f, -1), (o_fr + 0.05, 1)):
        F.quad(g, [(a, oo, y) for a, y in pe], STONE, (0, sg, 0), floor=FR)
    for s in (-1, 1):
        F.quad(g, [(s * 2.35, o_f, FR + 2.28), (s * 2.35, o_fr + 0.05, FR + 2.28), (0.0, o_fr + 0.05, FR + 2.95), (0.0, o_f, FR + 2.95)],
               STONE, (s * 0.3, 0, 1), floor=FR)
    F.box(g, -2.35, 2.35, o_f, o_fr + 0.05, FR + 2.2, FR + 2.28, STONE, skip=("+y", "-y"), floor=FR)
    bx, _, bz = F.p(0, (o_f + o_fr) / 2, 0)
    lathe(g, (bx, FR + 2.9, bz), [(0.1, 0), (0.1, 0.1), (0.22, 0.2), (0.25, 0.35), (0.2, 0.5), (0.0, 0.62)], 6, STONE,
          rot=math.pi / 12, floor=FR)
    for s in (-1, 1):
        oa = s * (FRW - 0.35)
        om = (o_f + o_out) / 2
        F.box(g, oa - 0.22, oa + 0.22, om - 0.1, om + 0.1, FR + 0.35, FR + 0.7, STONE, skip=("-y",), floor=FR)
        pyramid(g, [F.p(oa - 0.16, om - 0.08, FR + 0.7), F.p(oa + 0.16, om - 0.08, FR + 0.7), F.p(oa + 0.16, om + 0.08, FR + 0.7),
                    F.p(oa - 0.16, om + 0.08, FR + 0.7)], F.p(oa, om, FR + 1.7), STONE, bottom=False, floor=FR)
    return F


def gate_leaves(g, F, gt, PW, SPR, o_out, dark):
    """The gate's two timber leaves, shut across the passage at its field end (decor.rampart gates
    "doors": the band they stand in), a wicket door in the right one, shut. Planked and strapped
    on the field side, framed with rails and a brace on the town side; their heads follow the
    vault's chords."""
    if gt.get("doors"):
        os_ = [F.loc(x, z)[1] for x, z in gt["doors"]]
        d0, d1 = min(os_), max(os_)
    else:
        d0, d1 = o_out - 1.0, o_out - 0.5
    of, ob = d1 - 0.1, d1 - 0.26  # the planked field face, the town face
    orl = ob - 0.1  # the rails' town face
    gap, cl = 0.006, 0.015  # between the leaves, round the edge
    kk = (PW - cl) / PW
    nseg = 9
    chords = [(PW * kk * math.cos(math.pi * k / nseg), SPR + PW * kk * math.sin(math.pi * k / nseg)) for k in range(nseg // 2 + 1)]

    def outline(s):
        """One leaf's outline (a, y): along the floor from the middle, up the side, over the chords
        (the last one level, as the vault's 80 to 100 degree chord), back to the middle."""
        pts = [(s * gap, LIFT + cl), (s * (PW - cl), LIFT + cl)] + [(s * a, y) for a, y in chords]
        pts.append((s * gap, chords[-1][1]))
        return pts

    def uv(a, y):
        return abs(a) / TILE[WOOD][0], y / TILE[WOOD][1]

    for s in (-1, 1):
        P = outline(s)
        wick = (0.55, 1.45, 0.2, 1.95) if s > 0 else None  # (a0, a1, y0, y1) of the wicket
        for o, sg, k in ((of, 1, 0.95), (ob, -1, 0.8)):
            pn = Panel(g, F, (s * gap, o), (s * (PW - cl), o), (0, sg), uoff=gap)
            holes = [(wick[0] - gap, wick[1] - gap, wick[2], wick[3])] if wick else []
            pn.wall(LIFT + cl, SPR, WOOD, holes, k=k, shade=dark, seg=1.3)
            if wick:
                pn.reveal(wick[0] - gap, wick[1] - gap, wick[2], wick[3], 0.03, WOOD, shade=dark, k=0.55)
                w0, w1, y0, y1 = s * wick[0], s * wick[1], wick[2], wick[3]
                ow = o - sg * 0.03
                F.quad(g, [(w0, ow, y0), (w1, ow, y0), (w1, ow, y1), (w0, ow, y1)], WOOD, (0, sg, 0),
                       uvs=[uv(w0, y0), uv(w1, y0), uv(w1, y1), uv(w0, y1)], shade=dark, k=k * 0.8)
            head = P[2:]
            for (a0, y0), (a1, y1) in zip(head, head[1:]):
                if abs(a1 - a0) < 1e-6:
                    continue
                q = [(a0, SPR), (a1, SPR), (a1, y1), (a0, y0)]
                if abs(y0 - SPR) < 1e-6:
                    q = q[1:]
                F.quad(g, [(a, o, y) for a, y in q], WOOD, (0, sg, 0), uvs=[uv(a, y) for a, y in q], shade=dark, k=k)
        # the edges round the leaf
        ca = sum(p[0] for p in P) / len(P)
        cy = sum(p[1] for p in P) / len(P)
        for (a0, y0), (a1, y1) in zip(P, P[1:] + P[:1]):
            na, ny = y1 - y0, -(a1 - a0)
            if na * ((a0 + a1) / 2 - ca) + ny * ((y0 + y1) / 2 - cy) < 0:
                na, ny = -na, -ny
            F.quad(g, [(a0, ob, y0), (a1, ob, y1), (a1, of, y1), (a0, of, y0)], WOOD, (na, 0, ny), shade=dark, k=0.6)
        # the town side: two rails across the leaf and a brace between them
        a_in, a_out = s * (gap + 0.05), s * (PW - cl - 0.05)
        for y in (2.15, 3.05):
            F.box(g, a_in, a_out, orl, ob, y, y + 0.2, WOOD, skip=("+o",), shade=dark, k=1.15)
        om = ob - 0.04  # the brace: 1 cm into the leaf, its face 1 cm behind the rails'
        bar(g, F.p(s * (PW - 0.35), om, 2.35), F.p(s * 0.3, om, 3.05), 0.1, WOOD, h=0.16, shade=0.8)
        if wick:
            w0, w1, y0, y1 = wick
            # the wicket's frame on the town side
            for a0, a1, b0, b1 in ((w0 - 0.1, w0, y0, y1 + 0.1), (w1, w1 + 0.1, y0, y1 + 0.1), (w0, w1, y1, y1 + 0.1)):
                F.box(g, s * a0, s * a1, orl + 0.04, ob, b0, b1, WOOD, skip=("+o",), shade=dark, k=1.15)
                # and a batten frame round it on the field side, so the little door reads from the bridge
                F.box(g, s * a0, s * a1, of, of + 0.03, b0, b1, WOOD, skip=("-o",), shade=dark, k=1.2)
            # its hinges and its ring on the field side (on the wicket's face, 3 cm in)
            for y in (y0 + 0.3, y1 - 0.3):
                bar(g, F.p(s * (w0 + 0.03), of - 0.015, y), F.p(s * (w0 + 0.45), of - 0.015, y), 0.05, IRON, h=0.06, shade=0.7)
            bar(g, F.p(s * (w1 - 0.12), of - 0.015, 1.0), F.p(s * (w1 - 0.12), of - 0.015, 1.14), 0.05, IRON, h=0.05, shade=0.7)
        # the leaf's big hinge straps on the field side
        for y in (0.6, 2.9):
            bar(g, F.p(s * (PW - cl - 0.02), of + 0.02, y), F.p(s * (PW - 1.0), of + 0.02, y), 0.06, IRON, h=0.09, shade=0.7)
    # the stop in the floor where the leaves meet
    F.box(g, -0.08, 0.08, ob - 0.05, of + 0.05, LIFT - 0.01, LIFT + 0.03, IRON, skip=("-y",), shade=dark)


def sentry_box(g, F, town, rec, o_in):
    """The sentry box built into the tower's town face beside the arch: planked inside, posts and a
    little gabled roof in front."""
    u0, u1, y0, y1 = rec
    town.reveal(u0, u1, y0, y1, 1.25, WOOD, back=WOOD, sill=False, k=0.7, back_k=0.6)
    a_of = lambda u: town.A.x + town.t.x * u  # noqa: E731
    a0, a1 = sorted((a_of(u0), a_of(u1)))
    F.box(g, a0, a1, o_in + 0.1, o_in + 1.25, 0.0, 0.12, WOOD, skip=("-y", "-a", "+a", "+o"), k=0.7)
    for aa in (a0, a1 - 0.12):
        F.box(g, aa, aa + 0.12, o_in, o_in + 0.12, 0.0, 2.45, WOOD, skip=("-y", "+y"))
    F.box(g, a0, a1, o_in - 0.02, o_in + 0.1, 2.45, 2.75, WOOD, skip=("-y",))
    ac = (a0 + a1) / 2
    ye, yr = 2.78, 3.45
    of, ob = o_in - 0.3, o_in + 0.35
    ea, eb = a0 - 0.22, a1 + 0.22
    for sa in (ea, eb):
        F.quad(g, [(sa, of, ye), (ac, of, yr), (ac, ob, yr), (sa, ob, ye)], SLATE, (sa - ac, 0, 0.6))
    F.quad(g, [(ea, of, ye), (eb, of, ye), (ac, of, yr)], WOOD, (0, -1, 0), k=0.8)
    F.quad(g, [(ea, of, ye), (eb, of, ye), (eb, ob, ye), (ea, ob, ye)], WOOD, (0, 0, -1), k=0.5)
    x, _, z = F.p(ac, of + 0.08, 0)
    finial(g, x, yr - 0.03, z, 0.45)


def arch_face(g, F, o, osgn, A, r, r2, ys, yt, fill, ring, nseg=9, ring_k=(1.05, 0.9), proud=0.0):
    """A wall face at o with a round arch (radius r, springing at ys) cut in it: the ring of
    voussoirs out to r2 (`proud` in front of the face), and the fill out to the rectangle |a| <= A,
    ys <= y <= yt. The ring's inner edge runs on the same chords as the vault behind it."""
    out = F.v(0, osgn)
    ca = math.atan2(yt - ys, A)
    base = [math.pi * k / nseg for k in range(nseg + 1)]
    angs = sorted(set(base + [ca, math.pi - ca]))

    def arc(rad, t):
        return rad * math.cos(t), ys + rad * math.sin(t)

    def chord(t):
        k = min(nseg - 1, int(t / (math.pi / nseg)))
        t0, t1 = base[k], base[k + 1]
        f = (t - t0) / (t1 - t0)
        a0, a1 = arc(r, t0), arc(r, t1)
        return a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f

    def bound(t):
        c, s = math.cos(t), math.sin(t)
        cand = []
        if abs(c) > 1e-9:
            cand.append(A / abs(c))
        if s > 1e-9:
            cand.append((yt - ys) / s)
        tt = min(cand)
        return tt * c, ys + tt * s

    o2 = o + osgn * proud
    for t0, t1 in zip(angs, angs[1:]):
        if t1 - t0 < 1e-6:
            continue
        v = int(((t0 + t1) / 2) / (math.pi / nseg))
        p0, p1, q0, q1 = chord(t0), chord(t1), arc(r2, t0), arc(r2, t1)
        w0 = (t0 - base[v]) / (math.pi / nseg) * 0.25 + 0.25 * (v % 4)
        w1 = (t1 - base[v]) / (math.pi / nseg) * 0.25 + 0.25 * (v % 4)
        ru = (r2 - r) / TILE[ring][0]
        g.face([F.p(p0[0], o2, p0[1]), F.p(p1[0], o2, p1[1]), F.p(q1[0], o2, q1[1]), F.p(q0[0], o2, q0[1])], ring, out=out,
               uvs=[(0.0, w0), (0.0, w1), (ru, w1), (ru, w0)], k=ring_k[v % 2])
        if proud > 0:
            tm = (t0 + t1) / 2
            g.face([F.p(q0[0], o, q0[1]), F.p(q1[0], o, q1[1]), F.p(q1[0], o2, q1[1]), F.p(q0[0], o2, q0[1])], ring,
                   out=F.v(math.cos(tm), 0, math.sin(tm)), k=0.9)
            g.face([F.p(p0[0], o, p0[1]), F.p(p1[0], o, p1[1]), F.p(p1[0], o2, p1[1]), F.p(p0[0], o2, p0[1])], ring,
                   out=F.v(-math.cos(tm), 0, -math.sin(tm)), k=0.75)
        b0, b1 = bound(t0), bound(t1)
        g.face([F.p(q0[0], o, q0[1]), F.p(q1[0], o, q1[1]), F.p(b1[0], o, b1[1]), F.p(b0[0], o, b0[1])], fill, out=out)
    if proud > 0:
        for t in (0.0, math.pi):
            p, q = arc(r, t), arc(r2, t)
            g.face([F.p(p[0], o, p[1]), F.p(q[0], o, q[1]), F.p(q[0], o2, q[1]), F.p(p[0], o2, p[1])], ring, out=(0, -1, 0))


def build_bridge(g, gt, F, ctx):
    """The stone bridge over the moat: a cobbled deck at LIFT on three brick arches, brick parapets
    with a stone coping, stone posts at the ends, a lamp post at the field end."""
    pts = [F.loc(x, z) for x, z in gt["bridge"]]
    a0, a1 = min(p[0] for p in pts), max(p[0] for p in pts)
    o0, o1 = min(p[1] for p in pts), max(p[1] for p in pts)
    road_end = max(F.loc(x, z)[1] for x, z in gt["road"])
    bank0 = (road_end + o0) / 2  # the road and the bridge overlap on the berm's edge
    bank1 = o1 - (bank0 - o0)
    BA = (a1 - a0) / 2
    PT = 0.5  # the parapets fill the solids' strips along the deck
    TOPP = 1.0
    BOT = -6.0
    f0, f1 = bank0 + 1.0, bank1 - 1.0  # the abutments' faces in the water
    pier = 1.2
    span = (f1 - f0 - 2 * pier) / 3
    r = span / 2
    cs = [f0 + r + k * (span + pier) for k in range(3)]
    sp = -0.55 - r
    rr = r + 0.45
    post_l = 0.6
    for s in (-1, 1):
        # the solid parts: abutments, piers (below the springing), the fill between the arches
        cols = [(o0, cs[0] - r)] + [(cs[k] + r, cs[k + 1] - r) for k in range(2)] + [(cs[2] + r, o1)]
        for c0, c1 in cols:
            Panel(g, F, (s * BA, c0), (s * BA, c1), (s, 0), uoff=c0 - o0).wall(BOT, sp, PLINTH, floor=0.0)
        spans = [(o0, cs[0] - rr)] + [(cs[k] + rr, cs[k + 1] - rr) for k in range(2)] + [(cs[2] + rr, o1)]
        for c0, c1 in spans:
            pn = Panel(g, F, (s * BA, c0), (s * BA, c1), (s, 0), uoff=c0 - o0)
            holes = []
            if c0 <= o0 + 1e-6:
                holes.append((0.0, post_l, -0.3, TOPP + 1))
            if c1 >= o1 - 1e-6:
                holes.append((c1 - c0 - post_l, c1 - c0, -0.3, TOPP + 1))
            pn.wall(sp, TOPP, BRICK, holes)
        for c in cs:
            arch_side(g, F, s, BA, c, r, rr, sp, TOPP)
        # cutwaters on the piers
        for k in range(2):
            p0, p1 = cs[k] + r, cs[k + 1] - r
            pm = (p0 + p1) / 2
            tri = [(s * BA, p0), (s * (BA + 0.7), pm), (s * BA, p1)]
            for (aa, oa), (ab, ob) in zip(tri, tri[1:]):
                ca = s * (BA + 0.7 / 3)
                F.quad(g, [(aa, oa, BOT), (ab, ob, BOT), (ab, ob, sp - 0.2), (aa, oa, sp - 0.2)], PLINTH,
                       ((aa + ab) / 2 - ca, (oa + ob) / 2 - pm, 0), floor=-2.0)
            F.quad(g, [(a, o, sp - 0.2) for a, o in tri[:2]] + [(s * BA, pm, sp + 0.35)], STONE, (s * 0.3, -0.3, 1), floor=-2.0)
            F.quad(g, [(a, o, sp - 0.2) for a, o in tri[1:]] + [(s * BA, pm, sp + 0.35)], STONE, (s * 0.3, 0.3, 1), floor=-2.0)
        # the parapet's inner face and coping, the string course at the deck, the posts
        ai = s * (BA - PT)
        inner = Panel(g, F, (ai, o0 + post_l), (ai, o1 - post_l), (-s, 0))
        inner.wall(LIFT, TOPP, BRICK, floor=LIFT)
        amin, amax = sorted((ai, s * BA))
        F.box(g, amin, amax, o0 + post_l, o1 - post_l, TOPP, TOPP + 0.15, STONE, skip=("-y", "-o", "+o"), floor=LIFT)
        F.box(g, s * BA, s * (BA + 0.08), o0 + post_l, o1 - post_l, -0.3, -0.06, STONE, skip=("-a" if s > 0 else "+a",), floor=-1)
        for oa, ob, lamp in ((o0, o0 + post_l, False), (o1 - post_l, o1, s > 0)):
            ph = 1.35
            F.box(g, amin, amax, oa, ob, -0.3, ph, STONE, skip=("-y",), floor=LIFT)
            am, om = (amin + amax) / 2, (oa + ob) / 2
            if lamp:
                x, _, z = F.p(am, om, 0)
                lathe(g, (x, ph, z), [(0.13, 0.0), (0.13, 0.18), (0.07, 0.28), (0.05, 2.35), (0.1, 2.45), (0.03, 2.5)], 6, IRON, shade=0.8)
                lantern(g, x, ph + 3.0, z, 0.3, 0.44)
            else:
                pyramid(g, [F.p(amin - 0.02, oa - 0.02, ph), F.p(amax + 0.02, oa - 0.02, ph), F.p(amax + 0.02, ob + 0.02, ph),
                            F.p(amin - 0.02, ob + 0.02, ph)], F.p(am, om, ph + 0.28), STONE, floor=LIFT)
    # the arches' undersides and the piers' faces in the openings
    for c in cs:
        angs = [math.pi * k / 8 for k in range(9)]
        for t0, t1 in zip(angs, angs[1:]):
            tm = (t0 + t1) / 2
            q = [F.p(-BA, c + r * math.cos(t0), sp + r * math.sin(t0)), F.p(BA, c + r * math.cos(t0), sp + r * math.sin(t0)),
                 F.p(BA, c + r * math.cos(t1), sp + r * math.sin(t1)), F.p(-BA, c + r * math.cos(t1), sp + r * math.sin(t1))]
            g.face(q, BRICK, out=F.v(0, -math.cos(tm), -math.sin(tm)), k=0.6, floor=-2.0)
        F.quad(g, [(-BA, c - r, BOT), (BA, c - r, BOT), (BA, c - r, sp), (-BA, c - r, sp)], PLINTH, (0, 1, 0), floor=-2.0, k=0.8)
        F.quad(g, [(-BA, c + r, BOT), (BA, c + r, BOT), (BA, c + r, sp), (-BA, c + r, sp)], PLINTH, (0, -1, 0), floor=-2.0, k=0.8)
    # the deck and its ends
    ds = splits(o0, o1, 3.0)
    for oa, ob in zip(ds, ds[1:]):
        for aa, ab in ((-(BA - PT), 0.0), (0.0, BA - PT)):
            F.quad(g, [(aa, oa, LIFT), (ab, oa, LIFT), (ab, ob, LIFT), (aa, ob, LIFT)], COBBLE, (0, 0, 1), floor=-1.0)
    for oo, sg in ((o0, -1), (o1, 1)):
        F.quad(g, [(-BA, oo, BOT), (BA, oo, BOT), (BA, oo, -0.3), (-BA, oo, -0.3)], PLINTH, (0, sg, 0), floor=0.0)
        F.quad(g, [(-BA + PT, oo, -0.3), (BA - PT, oo, -0.3), (BA - PT, oo, LIFT), (-BA + PT, oo, LIFT)], PLINTH, (0, sg, 0), floor=0.0)


def arch_side(g, F, s, BA, c, r, rr, sp, top):
    """One arch on the bridge's side face: the stone ring and the brick above it."""
    angs = [math.pi * k / 8 for k in range(9)]
    out = F.v(s, 0)
    for k, (t0, t1) in enumerate(zip(angs, angs[1:])):
        p0 = (c + r * math.cos(t0), sp + r * math.sin(t0))
        p1 = (c + r * math.cos(t1), sp + r * math.sin(t1))
        q0 = (c + rr * math.cos(t0), sp + rr * math.sin(t0))
        q1 = (c + rr * math.cos(t1), sp + rr * math.sin(t1))
        w0, w1 = 0.25 * (k % 4), 0.25 * (k % 4) + 0.25
        g.face([F.p(s * BA, *p0), F.p(s * BA, *p1), F.p(s * BA, *q1), F.p(s * BA, *q0)], STONE, out=out, k=1.05 if k % 2 else 0.88,
               uvs=[(0.0, w0), (0.0, w1), (0.4, w1), (0.4, w0)], floor=-2.0)
        g.face([F.p(s * BA, q0[0], q0[1]), F.p(s * BA, q1[0], q1[1]), F.p(s * BA, q1[0], top), F.p(s * BA, q0[0], top)], BRICK,
               out=out, floor=-2.0)


# ------------------------------------------------------------------ stairs


def stair_frame(st, ctx):
    """A stair's frame: a = up the flight from its foot, o = outward from the town face (the flight
    is at o < 0, in the street). Returns the frame, the run, the landing's length, the width."""
    fr = st["frame"]
    t, n = V2(fr["t"]), V2(fr["n"])
    d = 1.0 if st["dir"] > 0 else -1.0
    foot = V2(fr["o"]) + t * st["s"] - n * ctx.t
    F = Frame(foot.x, foot.y, (t.x * d, t.y * d), (n.x, n.y))
    RUN = (V2(st["b"]) - V2(st["a"])).length
    ld = [V2(p) for p in st["landing"]]
    LAND = (ld[1] - ld[0]).length
    W = 2.0 * st["half"]
    return F, RUN, LAND, W


def build_stair(g, st, ctx):
    """A flight of stone steps up the inner face, solid brick under it, a string wall with a stone
    coping and an iron railing on the street side, a landing at the walk's height, a small door."""
    h = ctx.h
    F, RUN, LAND, W = stair_frame(st, ctx)
    RW = ctx.rail
    N = max(1, round(h / STEP_RISE))
    rise, run = h / N, RUN / N
    END = RUN + LAND
    # (the look pass) each tread worn hollow where the feet go, a little off the middle toward the rail: the tread and
    # the nosing sink up to 1.6 cm there, polished darker
    wear = [(-W, 0.0), (-0.8 * W, 0.004), (-0.58 * W, 0.016), (-0.36 * W, 0.006), (-0.15 * W, 0.0), (0.06, 0.0)]
    for i in range(N):
        y = (i + 0.5) * rise
        yb = 0.0 if i == 0 else (i - 0.5) * rise
        for (oa, wa), (ob, wb) in zip(wear, wear[1:]):
            kk = 1.0 - 6.0 * max(wa, wb)
            F.quad(g, [(i * run, oa, y - wa), ((i + 1) * run, oa, y - wa * 0.3), ((i + 1) * run, ob, y - wb * 0.3), (i * run, ob, y - wb)],
                   STONE, (0, 0, 1), floor=y - 1, k=kk)
            ba, bb = (yb, yb) if i == 0 else (yb - wa * 0.3, yb - wb * 0.3)  # (down to the step below's worn back)
            F.quad(g, [(i * run, oa, ba), (i * run, ob, bb), (i * run, ob, y - wb), (i * run, oa, y - wa)], STONE, (-1, 0, 0), floor=0.0, k=0.8)
    F.quad(g, [(RUN, -W, (N - 0.5) * rise), (RUN, 0.06, (N - 0.5) * rise), (RUN, 0.06, h), (RUN, -W, h)], STONE, (-1, 0, 0), k=0.8)
    for aa, ab in zip(splits(RUN, END, 2.0), splits(RUN, END, 2.0)[1:]):
        F.quad(g, [(aa, -W, h), (ab, -W, h), (ab, -0.06, h), (aa, -0.06, h)], STONE, (0, 0, 1), floor=h - 1)  # a joint short of the coping
    UP = 0.3  # the string wall's top over the step line

    def yt(a):
        return (min(a, RUN) / RUN) * h + UP if a < RUN else h + UP

    o_out, o_in = -W - RW, -W
    brk = sorted(set(splits(0.0, RUN, 2.5) + splits(RUN, END + RW, 2.0)))
    # where the coping's foot passes the plinth
    a_pl = (PL + 0.15 - UP) / h * RUN
    if 0 < a_pl < RUN:
        brk = sorted(set(brk + [a_pl]))
    brk = sorted(set(brk + [0.45]))
    for aa, ab in zip(brk, brk[1:]):
        ta, tb = yt(aa), yt(ab)
        for o, sg in ((o_out, -1), (o_in, 1)):
            if ab <= 0.45 + 1e-6:
                continue  # inside the newel
            lo_a = -0.3 if sg < 0 else max(0.0, ta - 0.9)
            lo_b = -0.3 if sg < 0 else max(0.0, tb - 0.9)
            if sg < 0 and ta - 0.15 >= PL - 1e-6 and tb - 0.15 >= PL - 1e-6:
                F.quad(g, [(aa, o, lo_a), (ab, o, lo_b), (ab, o, PL), (aa, o, PL)], PLINTH, (0, sg, 0))
                F.quad(g, [(aa, o, PL), (ab, o, PL), (ab, o, tb - 0.15), (aa, o, ta - 0.15)], BRICK, (0, sg, 0))
            else:
                F.quad(g, [(aa, o, lo_a), (ab, o, lo_b), (ab, o, tb - 0.15), (aa, o, ta - 0.15)], PLINTH if sg < 0 else BRICK,
                       (0, sg, 0))
            F.quad(g, [(aa, o, ta - 0.15), (ab, o, tb - 0.15), (ab, o, tb), (aa, o, ta)], STONE, (0, sg, 0))
        if ab > 0.45 + 1e-6:
            F.quad(g, [(aa, o_out, ta), (ab, o_out, tb), (ab, o_in, tb), (aa, o_in, ta)], STONE, (0, 0, 1), floor=h)
    # the end: a strip under the railing across the landing's end, the landing block's end face
    # with a small door
    F.box(g, END, END + RW, o_in, 0.0, h - 0.3, h + UP, STONE, skip=("+o", "-o", "-y", "+a"), floor=h)
    end = Panel(g, F, (END + RW, o_out), (END + RW, 0.0), (1, 0))
    dc = (o_out) / 2
    u0, u1 = dc - o_out - 0.45, dc - o_out + 0.45
    end.wall(-0.3, h + UP - 0.15, BRICK, [(u0, u1, 0.0, 1.95)], (True, False), plinth=PL)
    end.wall(h + UP - 0.15, h + UP, STONE)
    end.reveal(u0, u1, 0.0, 1.95, 0.2, STONE, back=WOOD, sill=False, back_k=0.85)
    # the newel at the foot
    F.box(g, 0.0, 0.45, o_out, o_in, -0.1, yt(0.45) + 0.4, STONE, skip=("-y",))
    # the railing
    om = (o_out + o_in) / 2
    ps = splits(0.25, RUN, 1.3) + splits(RUN, END + RW / 2, 1.2)[1:]
    for a in ps:
        y = yt(a)
        bar(g, F.p(a, om, y - 0.02), F.p(a, om, y + 1.0), 0.055, IRON, shade=0.7)
    for dy in (0.95, 0.45):
        bar(g, F.p(0.25, om, yt(0.25) + dy), F.p(RUN, om, yt(RUN) + dy), 0.035, IRON, shade=0.7)
        bar(g, F.p(RUN, om, h + UP + dy), F.p(END + RW / 2, om, h + UP + dy), 0.035, IRON, shade=0.7)
        bar(g, F.p(END + RW / 2, om, h + UP + dy - 0.012), F.p(END + RW / 2, -0.15, h + UP + dy - 0.012), 0.035, IRON, shade=0.7)
    for o in (-W / 2, -0.15):
        bar(g, F.p(END + RW / 2, o, h + UP - 0.02), F.p(END + RW / 2, o, h + UP + 1.0), 0.055, IRON, shade=0.7)


# ------------------------------------------------------------------ the tower mill


def snap(y):
    """To the nearest brick course, so the mill's bands break on a joint."""
    return round(y / COURSE) * COURSE


def beam(g, p0, p1, sdir, w, d, mat, **kw):
    """A square timber from p0 to p1, w wide along sdir (made square to the timber), d deep."""
    p0, p1 = Vector(p0), Vector(p1)
    t = (p1 - p0).normalized()
    s = Vector(sdir)
    s = (s - t * s.dot(t)).normalized()
    k = t.cross(s)
    P = [(p1 if i & 2 else p0) + s * (w / 2 if i & 1 else -w / 2) + k * (d / 2 if i & 4 else -d / 2) for i in range(8)]
    solid8(g, P, mat, **kw)


def mill_band(g, c, N, rot, r0, y0, r1, y1, mat, skip=(), floor=0.0, k=1.0):
    """One band of a round tower, N sides, from radius r0 at y0 to r1 at y1. Upright bands get
    their texture wrapped round a whole number of times (no seam) with the courses level."""
    cx, cz = c
    tu, tv = TILE[mat]
    reps = max(1, round(2 * math.pi * (r0 + r1) / 2 / tu))
    upright = abs(y1 - y0) > abs(r1 - r0)
    nr, ny = (y1 - y0), -(r1 - r0)
    ln = math.hypot(nr, ny) or 1.0
    nr, ny = nr / ln, ny / ln
    for i in range(N):
        if i in skip:
            continue
        a0 = rot + 2 * math.pi * i / N
        a1 = rot + 2 * math.pi * (i + 1) / N
        am = (a0 + a1) / 2
        p = [(cx + r0 * math.cos(a0), y0, cz + r0 * math.sin(a0)), (cx + r0 * math.cos(a1), y0, cz + r0 * math.sin(a1)),
             (cx + r1 * math.cos(a1), y1, cz + r1 * math.sin(a1)), (cx + r1 * math.cos(a0), y1, cz + r1 * math.sin(a0))]
        uvs = None
        if upright:
            u0, u1 = reps * i / N, reps * (i + 1) / N
            uvs = [(u0, y0 / tv), (u1, y0 / tv), (u1, y1 / tv), (u0, y1 / tv)]
        g.face(p, mat, out=(math.cos(am) * nr, ny, math.sin(am) * nr), uvs=uvs, floor=floor, k=k)


# the two mills (pass 2, 2026-09-25): the look of each; the first stands on decor.rampart.mill (the walk map has
# its disc), the second on the north-east bastion (rampart.ts gives Jef its colliders: the crowd never goes there)
MILLS = [
    {"name": "mill_sails", "body": MILL_BODY, "top_r": MILL_TOP_R, "stage": None, "course": MILL_STAGE, "sail_r": SAIL_R,
     "hub_out": HUB_OUT, "tail": 8.2, "reef": (1.0, 0.55, 1.0, 0.55),
     "windows": ((5, 3.9), (15, 3.9), (10, 7.3), (3, 8.4), (17, 6.2))},
    {"name": "mill2_sails", "bastion": "ne", "k": 0.55, "r": 3.0, "body": 11.4, "top_r": 2.15, "stage": 2.9, "course": 2.9,
     "sail_r": 8.2, "hub_out": 3.9, "tail": None, "reef": (0.7, 1.0, 0.7, 1.0),
     "windows": ((6, 4.6), (14, 4.6), (9, 7.9), (2, 9.3), (17, 6.6))},
]


def mill_spots(ctx):
    """Where each mill stands: (centre, radius, home bastion, look)."""
    out = []
    for M in MILLS:
        if "bastion" in M:
            b = ctx.blist.get(M["bastion"])
            if b is None:
                continue
            V, S = V2(b["vertex"]), V2(b["salient"])
            out.append((V + (S - V) * M["k"], M["r"], M["bastion"], M))
        else:
            mc, mr = ctx.mill
            home = next((nm for nm, P in ctx.land_bastions if inside((mc.x, mc.y), [(p.x, p.y) for p in P])), None)
            if home is None:
                print("[build_wall] the mill stands on no bastion: left out")
                continue
            out.append((mc, mr, home, M))
    return out


def build_mill(g, ctx, mc, mr, home, M):
    """A tower mill on a land bastion: a round brick tower on a stone plinth, tapering, with a stone
    string course, small windows, a door case toward the walk, a stone cornice, a boat-shaped cap in
    slate facing the field, the four sails on their own object (M["name"]); a tail pole down to a
    capstan on the grass, or a timber stage round the tower (a stage mill) with the tail pole to it."""
    h = ctx.h
    b = ctx.blist[home]
    u = (V2(b["salient"]) - V2(b["vertex"])).normalized()  # toward the field: the sails' side
    w = Vector((-u.y, u.x))
    du = -u  # the door looks back to the walk
    N = MILL_SIDES
    rot = math.atan2(du.y, du.x) - math.pi / N  # face 0 is centred on the door
    rin = mr * math.cos(math.pi / 32)  # the walk map's disc is a 32-gon: stay inside it
    R0 = mr * 0.97  # the plinth
    Rb = R0 - 0.08  # the brick at the plinth's top
    top_r = M["top_r"]
    y0, ypl, ydoor = h - 0.3, snap(h + MILL_PL), snap(h + MILL_DOOR)
    ys, ytop = snap(h + M["course"]), snap(h + M["body"])
    ys1 = ys + 2 * COURSE

    def r(y):
        return Rb + (top_r - Rb) * (y - ypl) / (ytop - ypl)

    c = (mc.x, mc.y)
    door = (0,)
    mill_band(g, c, N, rot, R0, y0, R0, ypl - 0.06, PLINTH, skip=door, floor=h)
    mill_band(g, c, N, rot, R0, ypl - 0.06, Rb, ypl, STONE, skip=door, floor=h)
    cuts = sorted({ypl, ydoor, ys, ys1, ytop})
    for ya, yb in zip(cuts, cuts[1:]):
        if abs(ya - ys) < 1e-6:
            continue  # the string course
        for yy0, yy1 in zip(splits(ya, yb, 1.8), splits(ya, yb, 1.8)[1:]):
            mill_band(g, c, N, rot, r(yy0), yy0, r(yy1), yy1, BRICK, skip=door if yy1 <= ydoor + 1e-6 else (), floor=h)
    # the string course, 6 cm proud
    mill_band(g, c, N, rot, r(ys), ys, r(ys) + 0.06, ys, STONE, floor=h)
    mill_band(g, c, N, rot, r(ys) + 0.06, ys, r(ys1) + 0.06, ys1, STONE, floor=h)
    mill_band(g, c, N, rot, r(ys1) + 0.06, ys1, r(ys1), ys1, STONE, floor=h)
    # the cornice, the curb the cap turns on
    yc1, ycap = ytop + 0.22, ytop + 0.4
    rc = top_r + 0.14
    mill_band(g, c, N, rot, top_r, ytop, rc, ytop, STONE, floor=h)
    mill_band(g, c, N, rot, rc, ytop, rc, yc1, STONE, floor=h)
    mill_band(g, c, N, rot, rc, yc1, top_r + 0.08, yc1, STONE, floor=h)
    mill_band(g, c, N, rot, top_r + 0.08, yc1, top_r + 0.08, ycap, WOOD, floor=h, k=0.6)

    # the door case: a stone block proud of the plinth, the door set in it
    Fd = Frame(mc.x, mc.y, (-du.y, du.x), (du.x, du.y))
    hw = 0.62
    A_out = math.sqrt((rin - 0.01) ** 2 - hw * hw)
    Fd.box(g, -hw, hw, R0 * math.cos(math.pi / N) - 0.5, A_out, y0, ydoor, STONE, skip=("-o", "+o", "-y"), floor=h)
    front = Panel(g, Fd, (-hw, A_out), (hw, A_out), (0, 1))
    hole = (hw - 0.44, hw + 0.44, h, h + 2.0)
    front.wall(y0, ydoor, STONE, [hole], floor=h)
    front.reveal(*hole, 0.22, STONE, back=WOOD, sill=False, floor=h, back_k=0.8)
    Fd.box(g, -0.44, 0.44, A_out - 0.22, A_out - 0.02, h, h + 0.1, STONE, skip=("-y", "-o", "-a", "+a"), floor=h)

    # windows: (face, height over the walk)
    for wi, (i, yw) in enumerate(M["windows"]):
        yw0, yw1 = h + yw, h + yw + 0.75
        th = rot + 2 * math.pi * (i + 0.5) / N
        dr = Vector((math.cos(th), math.sin(th)))
        Fw = Frame(mc.x, mc.y, (-dr.y, dr.x), (dr.x, dr.y))
        ap0, ap1 = r(yw0) * math.cos(math.pi / N), r(yw1) * math.cos(math.pi / N)
        q = [Fw.p(-0.25, ap0 + 0.025, yw0), Fw.p(0.25, ap0 + 0.025, yw0), Fw.p(0.25, ap1 + 0.025, yw1), Fw.p(-0.25, ap1 + 0.025, yw1)]
        # (the miller's lamp behind two of them: lit at night, world/rampart.ts)
        g.face(q, ROOM if wi in (1, 3) else WINDOW, out=Fw.v(0, 1, 0.08), uvs=fit_uvs(4), floor=h)
        Fw.box(g, -0.34, 0.34, ap0 - 0.1, ap0 + 0.08, yw0 - 0.08, yw0, STONE, skip=("-o",), floor=h)

    # the cap: a boat, its keel along the axle, slate over a timber frame (a little smaller on a slimmer tower)
    ks = top_r / MILL_TOP_R

    def cp(x, ww, yy):
        p = mc + u * (x * ks) + w * (ww * ks)
        return (p.x, ycap + yy * ks, p.y)

    for kx in range(len(CAP_X) - 1):
        for sg in (-1.0, 1.0):
            for j in range(len(CAP_SEC) - 1):
                (w0, v0), (w1, v1) = CAP_SEC[j], CAP_SEC[j + 1]
                q = [cp(CAP_X[kx], sg * w0 * CAP_B[kx], v0 * CAP_H[kx]), cp(CAP_X[kx + 1], sg * w0 * CAP_B[kx + 1], v0 * CAP_H[kx + 1]),
                     cp(CAP_X[kx + 1], sg * w1 * CAP_B[kx + 1], v1 * CAP_H[kx + 1]), cp(CAP_X[kx], sg * w1 * CAP_B[kx], v1 * CAP_H[kx])]
                xm = (CAP_X[kx] + CAP_X[kx + 1]) / 2
                inner = Vector(cp(xm, 0.0, (CAP_H[kx] + CAP_H[kx + 1]) * 0.17))
                fc = sum((Vector(p) for p in q), Vector()) / 4
                g.face(q, SLATE, out=fc - inner, floor=ycap - 3.0)
            # the underside, dark boards
            q = [cp(CAP_X[kx], 0.0, 0.0), cp(CAP_X[kx + 1], 0.0, 0.0), cp(CAP_X[kx + 1], sg * CAP_B[kx + 1], 0.0), cp(CAP_X[kx], sg * CAP_B[kx], 0.0)]
            g.face(q, WOOD, out=(0, -1, 0), shade=0.45)
    for kx, sg in ((0, -1.0), (len(CAP_X) - 1, 1.0)):
        sec = [(wv * sgn, v) for sgn in (1.0, -1.0) for wv, v in (CAP_SEC if sgn < 0 else CAP_SEC[::-1])]
        pts = [cp(CAP_X[kx], wv * CAP_B[kx], v * CAP_H[kx]) for wv, v in sec]
        uniq = []
        for p in pts:
            if not uniq or (Vector(p) - Vector(uniq[-1])).length > 1e-6:
                uniq.append(p)
        if (Vector(uniq[0]) - Vector(uniq[-1])).length < 1e-6:
            uniq.pop()
        g.face(uniq, WOOD, out=(u.x * sg, 0.0, u.y * sg), shade=0.55)
    kt = max(range(len(CAP_X)), key=lambda j: CAP_H[j])
    tx, ty, tz = cp(CAP_X[kt], 0.0, CAP_H[kt])
    finial(g, tx, ty - 0.05, tz, 1.0)
    back = Vector(cp(CAP_X[0] + 0.15, 0.0, 0.5))  # where the tail pole leaves the cap's back

    info = {"x": round(mc.x, 3), "z": round(mc.y, 3), "r": round(R0 + 0.05, 3)}

    # the stage: a timber gallery round the tower on its string course, railing, struts to the tower
    if M["stage"] is not None:
        yst = ys
        ri = r(yst) + 0.065  # (clear of the string course, 6 cm proud: no two faces in one plane)
        ro = ri + 1.45
        yt = yst + 0.12
        mill_band(g, c, N, rot, ro, yt, ri, yt, WOOD, floor=h, k=0.85)  # the deck, up
        mill_band(g, c, N, rot, ri, yst, ro, yst, WOOD, floor=h, k=0.4)  # its underside
        mill_band(g, c, N, rot, ro, yst, ro, yt, WOOD, floor=h, k=0.7)  # its edge
        posts = []
        for i in range(N):
            th = rot + 2 * math.pi * i / N
            d2 = Vector((math.cos(th), math.sin(th)))
            p = mc + d2 * (ro - 0.07)
            posts.append(p)
            bar(g, (p.x, yt, p.y), (p.x, yt + 1.0, p.y), 0.07, WOOD, shade=0.7)
            if i % 2 == 0:  # a strut down to the tower
                q = mc + d2 * (r(yst - 0.9) + 0.02)
                s0 = mc + d2 * (ro - 0.2)
                bar(g, (s0.x, yst, s0.y), (q.x, yst - 0.9, q.y), 0.09, WOOD, shade=0.55)
        for i in range(N):
            p, q = posts[i], posts[(i + 1) % N]
            for yy in (yt + 1.0, yt + 0.5):
                bar(g, (p.x, yy, p.y), (q.x, yy, q.y), 0.06, WOOD, shade=0.7)
        foot = mc - u * (ro + 0.25)
        tail_foot = Vector((foot.x, yt + 1.05, foot.y))
        info["stage"] = round(ro, 3)
    elif M["tail"]:
        foot = mc - u * M["tail"]
        tail_foot = Vector((foot.x, h + 0.95, foot.y))
        # the capstan: a post in the grass and a spoked wheel square to the pole, to turn the cap to the wind
        bar(g, (foot.x, h - 0.1, foot.y), (foot.x, h + 0.85, foot.y), 0.2, WOOD, shade=0.65)
        wc = Vector((foot.x, h + 0.95, foot.y)) - Vector((u.x, 0.0, u.y)) * 0.28
        e_w, e_y = Vector((w.x, 0.0, w.y)), Vector((0.0, 1.0, 0.0))
        rim = [wc + (e_w * math.cos(2 * math.pi * j / 8) + e_y * math.sin(2 * math.pi * j / 8)) * 0.62 for j in range(8)]
        for j in range(8):
            bar(g, rim[j], rim[(j + 1) % 8], 0.07, WOOD, shade=0.7)
        for j in range(0, 8, 2):
            bar(g, wc, rim[j], 0.05, WOOD, shade=0.7)
        bar(g, wc - Vector((u.x, 0.0, u.y)) * 0.12, wc + Vector((u.x, 0.0, u.y)) * 0.3, 0.1, IRON, shade=0.7)
        info["tail"] = [round(foot.x, 3), round(foot.y, 3)]
    else:
        tail_foot = None
    if tail_foot is not None:
        beam(g, back, tail_foot, Vector((w.x, 0.0, w.y)), 0.26, 0.26, WOOD, shade=0.6)  # the tail pole
        mid = back + (tail_foot - back) * 0.3
        for sg in (-1.0, 1.0):  # the two braces from the cap's sides
            side = Vector(cp(-1.2, sg * 2.0, 0.3))
            bar(g, side, mid, 0.12, WOOD, shade=0.55)

    # the sails, the hub and the windshaft: their own object, turning about the axle
    sail_r, hub_out = M["sail_r"], M["hub_out"]
    hub2 = mc + u * hub_out
    hub = Vector((hub2.x, ycap + HUB_UP * ks, hub2.y))
    a = Vector((u.x * math.cos(TILT), math.sin(TILT), u.y * math.cos(TILT)))
    ctx.mill_axles[M["name"]] = a
    if M["name"] == "mill_sails":
        ctx.mill_hub, ctx.mill_axle = hub, a
    g.grp = ("sails", (round(hub.x, 4), round(hub.y, 4), round(hub.z, 4)), M["name"])
    hub = Vector(g.grp[1])
    up = Vector((0.0, 1.0, 0.0))
    e1 = (up - a * a.dot(up)).normalized()
    e2 = a.cross(e1)
    beam(g, hub - a * (hub_out - 1.65), hub - a * 0.1, e1, 0.4, 0.4, WOOD, shade=0.6)  # the windshaft, into the canister
    beam(g, hub - a * 0.3, hub + a * 0.42, e1, 0.72, 0.72, IRON, shade=0.75)  # the canister the stocks pass through
    n_bars = int((sail_r - 0.1 - SAIL_IN) / SAIL_STEP) + 1
    r_last = SAIL_IN + (n_bars - 1) * SAIL_STEP
    for k in range(4):
        ph = math.pi / 4 + k * math.pi / 2
        rr = e1 * math.cos(ph) + e2 * math.sin(ph)
        m = rr.cross(a)  # the trailing side: the lattice and the cloth
        beam(g, hub + a * 0.1 + rr * 0.3, hub + a * 0.1 + rr * (r_last + 0.3), m, 0.26, 0.24, WOOD, shade=0.7)  # the stock
        for j in range(n_bars):
            rj = SAIL_IN + j * SAIL_STEP
            beam(g, hub + rr * rj - m * SAIL_LEAD, hub + rr * rj + m * SAIL_W, rr, 0.085, 0.08, WOOD, shade=0.75)
        for off in (SAIL_W, SAIL_W * 0.5, -SAIL_LEAD):
            beam(g, hub + rr * (SAIL_IN - 0.08) + m * off, hub + rr * (r_last + 0.08) + m * off, m, 0.085, 0.09, WOOD, shade=0.75)
        # the cloth, spread on the trailing side (reefed short on some sails: the lattice shows), and the
        # leading board, just behind the lattice
        back_ = hub - a * 0.06
        r_cloth = SAIL_IN + (r_last - SAIL_IN) * M["reef"][k]
        rs = splits(SAIL_IN + 0.05, r_cloth - 0.05, 3.0)
        for ra, rb in zip(rs, rs[1:]):
            q = [back_ + rr * ra + m * 0.12, back_ + rr * rb + m * 0.12, back_ + rr * rb + m * (SAIL_W - 0.06), back_ + rr * ra + m * (SAIL_W - 0.06)]
            uvs = [(0.12 / 1.8, ra / 1.8), (0.12 / 1.8, rb / 1.8), ((SAIL_W - 0.06) / 1.8, rb / 1.8), ((SAIL_W - 0.06) / 1.8, ra / 1.8)]
            g.face(q, CANVAS, out=a, uvs=uvs, shade=1.0)
        if M["reef"][k] < 0.99:
            # the rest of the cloth furled along the lattice's inner edge: a thin roll
            p0 = back_ + rr * (r_cloth + 0.05) + m * 0.25
            p1 = back_ + rr * (r_last - 0.1) + m * 0.25
            beam(g, p0, p1, m, 0.2, 0.16, CANVAS, shade=0.85)
        rs = splits(SAIL_IN + 0.05, r_last - 0.05, 3.0)
        for ra, rb in zip(rs, rs[1:]):
            q = [back_ + rr * ra - m * 0.15, back_ + rr * rb - m * 0.15, back_ + rr * rb - m * (SAIL_LEAD - 0.04), back_ + rr * ra - m * (SAIL_LEAD - 0.04)]
            g.face(q, WOOD, out=a, shade=0.7)
    g.grp = None
    info["sails"] = M["name"]
    info["axle"] = [round(a.x, 5), round(a.y, 5), round(a.z, 5)]
    ctx.dress["mills"].append(info)


# ------------------------------------------------------------------ the walk's furniture (pass 2)
# Steve's picture 7 (2026-09-25): benches along the walk, gas lamps, the mills. The benches are modelled here
# in three kinds (seeded), the gas lamps are the town's own (props.glb gas_lamp, lit by world/gaslamps.ts):
# this only picks their spots. Both go to the game in the node "wall_dressing" (world/rampart.ts).

LAMP_STEP, BENCH_STEP = 27.0, 40.0
LAMP_O = 0.7  # a lamp's post this far in from the town face (the town parapet is TOWN_T thick)


def bench_iron(g, F, L):
    """A park bench: three slats on cast-iron ends with arms, a back of two slats, leaning back."""
    for sa in (-1.0, 1.0):
        a = sa * (L / 2 - 0.1)
        bar(g, F.p(a, 0.2, 0.0), F.p(a, 0.18, 0.43), 0.05, IRON, shade=0.7)  # the front leg
        bar(g, F.p(a, -0.2, 0.0), F.p(a, -0.26, 0.86), 0.05, IRON, shade=0.7)  # the back leg, up into the back
        bar(g, F.p(a, -0.22, 0.4), F.p(a, 0.22, 0.4), 0.045, IRON, shade=0.7)  # under the seat
        bar(g, F.p(a, 0.18, 0.43), F.p(a, 0.18, 0.64), 0.04, IRON, shade=0.7)  # the arm's post
        bar(g, F.p(a, -0.24, 0.64), F.p(a, 0.21, 0.64), 0.05, IRON, shade=0.7)  # the arm
    for o0, o1 in ((-0.2, -0.07), (-0.05, 0.08), (0.1, 0.22)):
        F.box(g, -L / 2, L / 2, o0, o1, 0.42, 0.46, WOOD, floor=0.0, k=0.9)
    for y0, y1 in ((0.56, 0.66), (0.72, 0.82)):
        oo = -0.21 - (y0 - 0.5) * 0.12
        F.box(g, -L / 2 + 0.04, L / 2 - 0.04, oo - 0.03, oo, y0, y1, WOOD, floor=0.0, k=0.85)


def bench_plank(g, F, L):
    """A plain bench: one thick plank on two timber trestles, a stretcher between them."""
    for sa in (-1.0, 1.0):
        a = sa * (L / 2 - 0.2)
        F.box(g, a - 0.05, a + 0.05, -0.16, 0.16, 0.0, 0.4, WOOD, skip=("-y",), floor=0.0, k=0.7)
    F.box(g, -L / 2 + 0.25, L / 2 - 0.25, -0.03, 0.03, 0.12, 0.2, WOOD, skip=("-y",), floor=0.0, k=0.6)
    F.box(g, -L / 2, L / 2, -0.17, 0.17, 0.4, 0.46, WOOD, floor=0.0, k=0.95)


def bench_stone(g, F, L):
    """A stone bench: a slab on two blocks."""
    for sa in (-1.0, 1.0):
        a = sa * (L / 2 - 0.22)
        F.box(g, a - 0.13, a + 0.13, -0.16, 0.16, -0.02, 0.36, PLINTH, skip=("-y",), floor=0.0, k=0.85)
    F.box(g, -L / 2, L / 2, -0.21, 0.21, 0.36, 0.45, STONE, floor=0.0, k=0.95)


BENCHES = [(bench_iron, 1.8, 0.5, 3.0), (bench_plank, 1.7, 0.36, 1.5), (bench_stone, 1.5, 0.44, 1.2)]  # (make, length, depth, weight)


def place_bench(g, ctx, rng, c, ua, uo, y, kind=None):
    """A bench centred on c (x, z) at height y, its length along ua, its front looking along uo."""
    if kind is None:
        wts = np.array([b[3] for b in BENCHES])
        kind = int(rng.choice(len(BENCHES), p=wts / wts.sum()))
    make, L, dep, _ = BENCHES[kind]
    F = Frame(c.x, c.y, (ua.x, ua.y), (uo.x, uo.y))

    class Lift:  # the bench's own frame, lifted to y
        def p(self, a, o, yy):
            return F.p(a, o, yy + y)

        def v(self, *q):
            return F.v(*q)

        def box(self, g_, a0, a1, o0, o1, y0, y1, mat, skip=(), floor=0.0, **kw):
            F.box(g_, a0, a1, o0, o1, y0 + y, y1 + y, mat, skip=skip, floor=floor + y, **kw)

    make(g, Lift(), L)
    ctx.dress["benches"].append({"x": round(c.x, 3), "z": round(c.y, 3), "y": round(y, 3), "a": [round(ua.x, 5), round(ua.y, 5)],
                                 "len": L, "dep": dep, "kind": kind})
    return L, dep


# ------------------------------------------------------------------ the look pass: props on the walk
# (2026-09-26; Steve: "take pictures, make it better, also props, people, guards"). In 1873 the old Spanish ramparts
# were being pulled down piece by piece: Brialmont's new ring (1859-64) had made them useless, and the town was
# laying out its boulevards on their line. So the walk is half abandoned: a stretch of breastwork pulled down by the
# town's gang (rubble, bricks cleaned and stacked for sale, planks, shear legs lowering baskets of rubble to the
# carts below, the town's notice), the old guns lying dismounted on sleepers waiting for the scrap man, and the
# garrison still keeping its sentries and a round. Every solid prop goes to the game in the dressing ("props": the
# game's colliders and the prop check, world/rampart.ts).


def prop_rec(ctx, name, F, a0, a1, o0, o1, top, y):
    """Record a solid prop as a box in its frame: middle, along (a unit), length, depth, top over y."""
    c = F.p((a0 + a1) / 2, (o0 + o1) / 2, y)
    ctx.dress.setdefault("props", []).append({"name": name, "x": round(c[0], 3), "z": round(c[2], 3), "y": round(y, 3), "set": ctx.prop_set,
                                              "a": [round(F.ua[0], 5), round(F.ua[1], 5)], "len": round(abs(a1 - a0), 3),
                                              "dep": round(abs(o1 - o0), 3), "top": round(top, 3)})


def heap(g, F, a0, a1, o0, o1, y, ht, rng, mats=(BRICK, PLINTH)):
    """A heap of rubble: a low mound on a 6 x 4 grid, each quad brick or stone, the rim at the walk."""
    na, no = 6, 4
    H = np.full((na + 1, no + 1), -0.04)  # (the rim a little under the walk: no face lies in its plane)
    for i in range(1, na):
        for j in range(1, no):
            fa = 1 - abs(2 * i / na - 1)
            fo = 1 - abs(2 * j / no - 1)
            H[i, j] = ht * (fa * fo) ** 0.6 * rng.uniform(0.7, 1.15)
    P = [[F.p(a0 + (a1 - a0) * i / na, o0 + (o1 - o0) * j / no, y + H[i, j]) for j in range(no + 1)] for i in range(na + 1)]
    for i in range(na):
        for j in range(no):
            q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]
            m = mats[int(rng.integers(0, len(mats)))]
            g.face(q, m, out=(0, 1, 0), floor=y - 0.3, k=rng.uniform(0.85, 1.15))
    # broken bricks lying on it
    laid = []
    for _ in range(int((a1 - a0) * (o1 - o0) * 7)):
        a, o = rng.uniform(a0 + 0.2, a1 - 0.2), rng.uniform(o0 + 0.15, o1 - 0.15)
        if any(math.hypot(a - pa, o - po) < 0.3 for pa, po in laid):
            continue
        laid.append((a, o))
        i, j = int((a - a0) / (a1 - a0) * na), int((o - o0) / (o1 - o0) * no)
        yy = y + H[min(i, na), min(j, no)] * 0.8
        rot = rng.uniform(0, math.pi)
        Fb = Frame(*F.p(a, o, 0)[::2], (math.cos(rot) * F.ua[0] - math.sin(rot) * F.uo[0], math.cos(rot) * F.ua[1] - math.sin(rot) * F.uo[1]),
                   (math.sin(rot) * F.ua[0] + math.cos(rot) * F.uo[0], math.sin(rot) * F.ua[1] + math.cos(rot) * F.uo[1]))
        Fb.box(g, -0.11, 0.11, -0.05, 0.05, yy, yy + 0.055, BRICK, skip=("-y",), floor=y, k=rng.uniform(0.75, 1.0))


def brick_stack(g, F, a, o, y, rng, n_h=12):
    """Cleaned bricks stacked for sale in a block (they were sold on, the town's gang's pay), a few loose on top.
    Its sides the stacked bricks of wall_props (cell 3: dark gaps between the bricks, not a wall's mortar)."""
    L, D = 1.1, 0.46
    ht = n_h * 0.065
    kk = rng.uniform(0.85, 1.0)
    vt = ht / (64 * 0.065 / 6)  # (six texels a course of 6.5 cm, as painted)
    for (oa, aa0, aa1, oo0, oo1) in ((-1, a - L / 2, a + L / 2, o - D / 2, o - D / 2), (1, a + L / 2, a - L / 2, o + D / 2, o + D / 2),
                                     (0, a - L / 2, a - L / 2, o + D / 2, o - D / 2), (2, a + L / 2, a + L / 2, o - D / 2, o + D / 2)):
        q = [F.p(aa0, oo0, y), F.p(aa1, oo1, y), F.p(aa1, oo1, y + ht), F.p(aa0, oo0, y + ht)]
        w = L if oa in (-1, 1) else D
        uw = min(0.25, 0.25 * w / 0.9)
        out = F.v(0, -1) if oa == -1 else F.v(0, 1) if oa == 1 else F.v(-1, 0) if oa == 0 else F.v(1, 0)
        g.face(q, PROPS, out=out, uvs=[(0.75, 0.0), (0.75 + uw, 0.0), (0.75 + uw, min(1.0, vt)), (0.75, min(1.0, vt))], floor=y - 0.5, k=kk)
    top = [F.p(a - L / 2, o - D / 2, y + ht), F.p(a + L / 2, o - D / 2, y + ht), F.p(a + L / 2, o + D / 2, y + ht), F.p(a - L / 2, o + D / 2, y + ht)]
    g.face(top, PROPS, out=(0, 1, 0), uvs=[(0.75, 0.0), (1.0, 0.0), (1.0, 0.45), (0.75, 0.45)], floor=y - 0.5, k=kk)
    for k in range(int(rng.integers(2, 6))):
        aa = a + rng.uniform(-L / 2 + 0.12, L / 2 - 0.12)
        F.box(g, aa - 0.11, aa + 0.11, o - 0.2 + k * 0.125, o - 0.1 + k * 0.125, y + ht + 0.003 * k, y + ht + 0.055 + 0.003 * k, BRICK, skip=("-y",), floor=y, k=0.9)
    return L, D, ht + 0.06


def plank_stack(g, F, a, o, y, rng, n=5):
    L, W = 2.6, 0.24
    for k in range(n):
        da = rng.uniform(-0.12, 0.12)
        ow = o + rng.uniform(-0.05, 0.05)
        F.box(g, a - L / 2 + da, a + L / 2 + da, ow - W / 2, ow + W / 2, y + 0.1 + k * 0.035, y + 0.135 + k * 0.035, WOOD, floor=y, k=rng.uniform(0.8, 1.0))
    for aa in (a - L / 2 + 0.3, a + L / 2 - 0.3):  # the two bearers under the stack
        F.box(g, aa - 0.06, aa + 0.06, o - 0.3, o + 0.3, y, y + 0.1, WOOD, skip=("-y",), floor=y, k=0.7)
    return L + 0.25, 0.6, 0.12 + n * 0.035


def barrow(g, F, a, o, y, rot):
    """A navvy's wheelbarrow of planks, its wheel in front, its legs and handles behind."""
    ca, sa = math.cos(rot), math.sin(rot)
    Fr = Frame(*F.p(a, o, 0)[::2], (ca * F.ua[0] - sa * F.uo[0], ca * F.ua[1] - sa * F.uo[1]),
               (sa * F.ua[0] + ca * F.uo[0], sa * F.ua[1] + ca * F.uo[1]))
    Fr.box(g, -0.35, 0.35, -0.3, 0.3, y + 0.3, y + 0.34, WOOD, floor=y)  # the bed
    for sg in (-1, 1):
        Fr.box(g, -0.37, 0.37, sg * 0.3 - 0.02, sg * 0.3 + 0.02, y + 0.34, y + 0.58, WOOD, floor=y, k=0.85)  # the sides
        bar(g, Fr.p(-0.95, sg * 0.24, y + 0.5), Fr.p(0.55, sg * 0.18, y + 0.24), 0.045, WOOD, shade=0.8)  # the handles
        bar(g, Fr.p(-0.35, sg * 0.24, y + 0.3), Fr.p(-0.4, sg * 0.26, y), 0.04, WOOD, shade=0.7)  # the legs
    Fr.box(g, 0.37, 0.4, -0.3, 0.3, y + 0.34, y + 0.58, WOOD, floor=y, k=0.85)
    wc = Fr.p(0.72, 0.0, y + 0.22)
    for k in range(8):
        a0, a1 = 2 * math.pi * k / 8, 2 * math.pi * (k + 1) / 8
        p0 = Fr.p(0.72 + 0.22 * math.cos(a0), 0.0, y + 0.22 + 0.22 * math.sin(a0))
        p1 = Fr.p(0.72 + 0.22 * math.cos(a1), 0.0, y + 0.22 + 0.22 * math.sin(a1))
        bar(g, p0, p1, 0.05, WOOD, h=0.06, shade=0.7)
    bar(g, Fr.p(0.72, -0.05, y + 0.22), wc, 0.03, IRON, shade=0.6)
    return Fr


def shear_legs(g, F, a, o_foot, o_top, y, top_h, drop):
    """Shear legs over the field face: two spars from the walk leaning out to a lashed head with a block, a stay back
    to a stake, the fall down to a basket of rubble hanging over the berm, a crab winch at the legs' feet."""
    head = Vector(F.p(a, o_top, y + top_h))
    for sg in (-1, 1):
        foot = Vector(F.p(a + sg * 1.1, o_foot, y))
        bar(g, foot, head + Vector(F.v(sg * 0.08, 0)), 0.14, WOOD, shade=0.8)
        F.box(g, a + sg * 1.1 - 0.2, a + sg * 1.1 + 0.2, o_foot - 0.2, o_foot + 0.2, y, y + 0.06, WOOD, skip=("-y",), floor=y, k=0.6)
    bar(g, head + Vector((0, -0.05, 0)), head + Vector((0, 0.12, 0)), 0.2, IRON, shade=0.6)  # the lashing
    stake = Vector(F.p(a, 2.1, y))
    bar(g, head, stake + Vector((0, 0.35, 0)), 0.03, IRON, shade=0.5)  # the stay
    bar(g, stake - Vector((0, 0.05, 0)), stake + Vector((0, 0.45, 0)), 0.08, WOOD, shade=0.7)
    blk = head - Vector((0, 0.35, 0))
    F.box(g, a - 0.09, a + 0.09, o_top - 0.06, o_top + 0.06, blk.y - 0.14, blk.y + 0.14, WOOD, floor=blk.y - 1, k=0.7)
    bar(g, head, blk, 0.03, IRON, shade=0.5)
    bot = Vector(F.p(a, o_top, y - drop))
    bar(g, blk, bot + Vector((0, 0.55, 0)), 0.022, IRON, shade=0.45)  # the fall
    for sg in (-1, 1):  # the basket's sling
        bar(g, bot + Vector((0, 0.55, 0)), bot + Vector(F.v(sg * 0.28, 0, 0.1)), 0.02, IRON, shade=0.45)
    lathe(g, (bot.x, bot.y - 0.3, bot.z), [(0.2, 0.0), (0.32, 0.4), (0.3, 0.42)], 8, WOOD, shade=0.75)  # the basket
    lathe(g, (bot.x, bot.y - 0.3, bot.z), [(0.3, 0.38), (0.0, 0.5)], 8, BRICK, shade=0.8)  # its load of rubble
    # the crab winch at the feet: two cheeks, a drum, the handles
    wa, wo = a, o_foot - 1.0
    for sg in (-1, 1):
        F.box(g, wa + sg * 0.45 - 0.04, wa + sg * 0.45 + 0.04, wo - 0.35, wo + 0.35, y, y + 0.8, WOOD, skip=("-y",), floor=y, k=0.8)
    bar(g, F.p(wa - 0.45, wo, y + 0.55), F.p(wa + 0.45, wo, y + 0.55), 0.2, WOOD, shade=0.7)
    bar(g, F.p(wa - 0.5, wo, y + 0.55), F.p(wa + 0.62, wo, y + 0.55), 0.035, IRON, shade=0.6)
    bar(g, F.p(wa + 0.62, wo, y + 0.55), F.p(wa + 0.62, wo + 0.28, y + 0.7), 0.035, IRON, shade=0.6)
    bar(g, F.p(wa, wo, y + 0.64), blk, 0.022, IRON, shade=0.45)  # the fall's other end, back to the drum


def notice(g, F, a, o, y, facing=1.0):
    """The town's notice on a board on two posts, its face toward the walk."""
    front = -facing  # (the side the notice is read from, along o)
    for sg in (-1, 1):  # the posts behind the board
        F.box(g, a + sg * 0.42 - 0.04, a + sg * 0.42 + 0.04, o - front * 0.1, o - front * 0.025, y, y + 1.75, WOOD, skip=("-y",), floor=y, k=0.75)
    F.box(g, a - 0.5, a + 0.5, o - 0.02, o + 0.02, y + 1.0, y + 1.7, WOOD, skip=("+o" if front > 0 else "-o",), floor=y, k=0.8)
    F.box(g, a - 0.52, a + 0.52, o - 0.08, o + 0.06, y + 1.7, y + 1.74, WOOD, skip=("-y",), floor=y, k=0.7)  # a drip board
    # the board's face is the paper (the town's notice, pasted edge to edge)
    of = o + front * 0.02
    q = [F.p(a - 0.5, of, y + 1.0), F.p(a + 0.5, of, y + 1.0), F.p(a + 0.5, of, y + 1.7), F.p(a - 0.5, of, y + 1.7)]
    g.face(q, PROPS, out=F.v(0, front), uvs=[(0.0, 0.0), (0.25, 0.0), (0.25, 1.0), (0.0, 1.0)] if front < 0 else
           [(0.25, 0.0), (0.0, 0.0), (0.0, 1.0), (0.25, 1.0)], shade=0.95)


def rope_line(g, F, a0, a1, o, y, posts=True):
    """A rope along a on low posts, sagging between them (keeps the walkers off the breach)."""
    ss = splits(a0, a1, 3.0)
    for s in ss:
        if posts:
            F.box(g, s - 0.05, s + 0.05, o - 0.05, o + 0.05, y, y + 0.95, WOOD, skip=("-y",), floor=y, k=0.75)
    for sa, sb in zip(ss, ss[1:]):
        m = (sa + sb) / 2
        bar(g, F.p(sa, o, y + 0.88), F.p(m, o, y + 0.72), 0.02, IRON, shade=0.55)
        bar(g, F.p(m, o, y + 0.72), F.p(sb, o, y + 0.88), 0.02, IRON, shade=0.55)


def sentry_walk(g, F, a, o, y):
    """A garrison sentry box on the walk: planks painted dark, a pitched roof, open to the walk (its front along -o)."""
    W, D, H = 1.0, 0.9, 2.15
    wt = 0.05
    F.box(g, a - W / 2, a + W / 2, o + D / 2 - wt, o + D / 2, y + 0.06, y + H, WOOD, skip=("-y",), floor=y, k=0.62)  # the back
    for sg in (-1, 1):
        F.box(g, a + sg * (W / 2 - wt / 2) - wt / 2, a + sg * (W / 2 - wt / 2) + wt / 2, o - D / 2, o + D / 2 - wt, y + 0.06, y + H, WOOD,
              skip=("-y", "+o"), floor=y, k=0.62)
    F.box(g, a - W / 2, a + W / 2, o - D / 2, o + D / 2, y, y + 0.06, WOOD, skip=("-y",), floor=y, k=0.55)  # the floor board
    ov = 0.12
    ridge_y = y + H + 0.42
    for sg in (-1, 1):
        q = [F.p(a + sg * (W / 2 + ov), o - D / 2 - ov, y + H), F.p(a + sg * (W / 2 + ov), o + D / 2 + ov, y + H),
             F.p(a, o + D / 2 + ov, ridge_y), F.p(a, o - D / 2 - ov, ridge_y)]
        g.face(q, SLATE, out=F.v(sg, 0, 0.6), floor=y, k=0.9)
    for oo in (o - D / 2, o + D / 2):  # the gables
        g.face([F.p(a - W / 2, oo, y + H), F.p(a + W / 2, oo, y + H), F.p(a, oo, ridge_y - 0.05)], WOOD, out=F.v(0, -1 if oo < o else 1), floor=y, k=0.6)
    return W, D, H + 0.42


def old_gun(g, F, a, o, y, rot=0.0):
    """An old iron gun lying dismounted on two sleepers (the walls were disarmed; they wait for the scrap man)."""
    ca, sa = math.cos(rot), math.sin(rot)
    ua = (ca * F.ua[0] - sa * F.uo[0], ca * F.ua[1] - sa * F.uo[1])
    uo = (sa * F.ua[0] + ca * F.uo[0], sa * F.ua[1] + ca * F.uo[1])
    Fg = Frame(*F.p(a, o, 0)[::2], ua, uo)
    for aa in (-0.7, 0.75):
        Fg.box(g, aa - 0.1, aa + 0.1, -0.45, 0.45, y, y + 0.16, WOOD, skip=("-y",), floor=y, k=0.65)
    # the barrel along a, a lathe about its own axis: rings at (x along, radius)
    prof = [(-1.45, 0.0), (-1.45, 0.08), (-1.38, 0.1), (-1.32, 0.05), (-1.28, 0.25), (-1.2, 0.27), (-1.15, 0.25), (-0.4, 0.22),
            (-0.36, 0.24), (-0.3, 0.21), (0.9, 0.17), (1.0, 0.19), (1.08, 0.15), (1.1, 0.0)]
    cy = y + 0.16 + 0.24
    n = 8
    for (x0, r0), (x1, r1) in zip(prof, prof[1:]):
        for k in range(n):
            t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            q = [Fg.p(x0, r0 * math.cos(t0), cy + r0 * math.sin(t0)), Fg.p(x1, r1 * math.cos(t0), cy + r1 * math.sin(t0)),
                 Fg.p(x1, r1 * math.cos(t1), cy + r1 * math.sin(t1)), Fg.p(x0, r0 * math.cos(t1), cy + r0 * math.sin(t1))]
            tm = (t0 + t1) / 2
            out = Vector(Fg.v(0, math.cos(tm), math.sin(tm))) + Vector(Fg.v(-(r1 - r0), 0, 0)) * 0.5
            if r0 < 1e-6:
                q = [q[0], q[1], q[2]]
            elif r1 < 1e-6:
                q = [q[0], q[1], q[3]]
            g.face(q, IRON, out=tuple(out), shade=1.7)  # (old iron gone rusty brown-grey: lighter than the new iron)
    # the trunnions
    for sg in (-1, 1):
        bar(g, Fg.p(-0.35, sg * 0.2, cy), Fg.p(-0.35, sg * 0.36, cy), 0.12, IRON, shade=0.65)
    return Fg


def washing(g, p0, p1, y0, y1, rng, h):
    """A line from the guard house to a pole with the washing on it: shirts and linen, a smock, a kerchief."""
    a, b = Vector((p0.x, y0, p0.y)), Vector((p1.x, y1, p1.y))
    d = b - a
    L = d.length
    t = d / L
    sag = lambda f: -0.22 * 4 * f * (1 - f)
    pts = [a + d * (k / 8) + Vector((0, sag(k / 8), 0)) for k in range(9)]
    for q0, q1 in zip(pts, pts[1:]):
        bar(g, q0, q1, 0.012, IRON, shade=0.7)
    side = Vector((-t.z, 0, t.x)).normalized()
    f = 0.1
    while f < 0.9:
        w = rng.uniform(0.35, 0.7)
        f1 = min(0.95, f + w / L)
        cell = 1 if rng.random() < 0.65 else 2
        top0 = a + d * f + Vector((0, sag(f), 0))
        top1 = a + d * f1 + Vector((0, sag(f1), 0))
        hang = rng.uniform(0.45, 0.8)
        sw = side * rng.uniform(-0.04, 0.04)
        q = [top0 - Vector((0, hang, 0)) + sw, top1 - Vector((0, hang * rng.uniform(0.85, 1.1), 0)) + sw, top1, top0]
        u0 = cell * 0.25 + rng.uniform(0, 0.08)
        g.face(q, PROPS, out=tuple(side), uvs=[(u0, 0.0), (u0 + 0.15, 0.0), (u0 + 0.15, 1.0), (u0, 1.0)], shade=0.9)
        f = f1 + rng.uniform(0.03, 0.08)
    # the pole with its fork
    bar(g, Vector((p1.x, h, p1.y)), Vector((p1.x, y1 + 0.1, p1.y)), 0.07, WOOD, shade=0.75)


def build_props(g, ctx):
    """The props of the look pass (see above), in segment frames: s along the segment, o out from the town face."""
    h, T = ctx.h, ctx.t
    segs = {q["name"]: q for q in ctx.D["segments"]}
    rng = np.random.default_rng(18736)
    g.grp = "props"
    in_d = T - (BW_O + BW_T)  # the breastwork's inner face (o)
    # ---- the demolition works on seg7: the breach, rubble, bricks, planks, shear legs, a barrow, the notice, a rope
    sg = segs[WORKS[0]]
    s0, s1 = WORKS[1], WORKS[2]
    ctx.prop_set = "works"  # (one site: its heaps, shear legs, barrow and stacks may touch)
    F = ctx.sframe(sg, 0.0)
    for a0, a1 in ((s0 + 1.25, s0 + 3.7), (s1 - 3.7, s1 - 1.25)):
        heap(g, F, a0, a1, in_d - 0.9, T - BW_O - 0.05, h, 0.62, rng)
        prop_rec(ctx, "rubble", F, a0, a1, in_d - 0.9, T - BW_O - 0.05, 0.62, h)
    shear_legs(g, F, (s0 + s1) / 2, in_d + 0.15, T + 0.9, h, 4.6, 3.2)
    prop_rec(ctx, "shear legs", F, (s0 + s1) / 2 - 1.35, (s0 + s1) / 2 + 1.35, in_d - 1.4, in_d + 0.4, 0.8, h)
    rope_line(g, F, s0 - 0.5, s1 + 0.5, in_d - 1.7, h)
    for k, a in enumerate((s0 - 3.0, s0 - 1.6, s1 + 2.2)):
        L, D, top = brick_stack(g, F, a, 1.05, h, rng, 12 + k * 2)
        prop_rec(ctx, "brick stack", F, a - L / 2, a + L / 2, 1.05 - D / 2, 1.05 + D / 2, top, h)
    L, D, top = plank_stack(g, F, s1 + 4.6, 1.1, h, rng)
    prop_rec(ctx, "planks", F, s1 + 4.6 - L / 2, s1 + 4.6 + L / 2, 1.1 - D / 2, 1.1 + D / 2, top, h)
    barrow(g, F, s0 + 2.0, in_d - 2.6, h, 0.5)
    prop_rec(ctx, "barrow", F, s0 + 1.1, s0 + 2.9, in_d - 3.1, in_d - 2.1, 0.6, h)
    notice(g, F, s0 - 6.5, 0.75, h, facing=-1.0)
    prop_rec(ctx, "notice", F, s0 - 7.0, s0 - 6.0, 0.7, 0.8, 1.75, h)
    ctx.dress["works"] = {"seg": WORKS[0], "s0": s0, "s1": s1}
    ctx.prop_set = None
    # ---- sentry boxes on the walk, against the breastwork, open to the walk: by the Kipdorppoort's stair head and on seg1
    for name, s in (("seg5", 112.0), ("seg1", 70.0), ("seg8", 34.0)):
        Fs = ctx.sframe(segs[name], 0.0)
        o = in_d - 0.5
        W, D, top = sentry_walk(g, Fs, s, o, h)
        prop_rec(ctx, "sentry box", Fs, s - W / 2, s + W / 2, o - D / 2, o + D / 2, top, h)
        ctx.dress.setdefault("sentry_boxes", []).append({"x": round(Fs.p(s, o - 0.85, h)[0], 3), "z": round(Fs.p(s, o - 0.85, h)[2], 3),
                                                         "face": [round(-Fs.uo[0], 5), round(-Fs.uo[1], 5)]})
    # ---- the old guns, dismounted, on sleepers against the breastwork (seg8, by the Sint-Jorispoort; seg2)
    for name, s in (("seg8", 40.0), ("seg2", 75.0)):
        Fs = ctx.sframe(segs[name], 0.0)
        for k in range(2):
            a = s + k * 3.1
            old_gun(g, Fs, a, in_d - 0.75, h, rot=(math.pi if k else 0.0) + rng.uniform(-0.08, 0.08))
            prop_rec(ctx, "old gun", Fs, a - 1.5, a + 1.5, in_d - 1.25, in_d - 0.2, 0.65, h)
    # ---- a washing line from the guard house on the north-west bastion to a pole on its lawn
    for (name, _P), (ring, paved) in zip(ctx.land_bastions, ctx.grass):
        if name != "nw":
            continue
        hut = next((hh for hh in ctx.huts if inside((hh.c.x, hh.c.y), [(p.x, p.y) for p in _P])), None)
        if hut is None:
            continue
        V = V2(ctx.blist[name]["vertex"])
        ua, uo, W2, D2 = hut.facing(V - hut.c)  # uo: out of its door, toward the walk; the line runs off its side
        best = None
        for sgn in (1.0, -1.0):
            p0 = hut.c + ua * sgn * (W2 - HIN + 0.02) - uo * 0.6
            p1 = p0 + ua * sgn * 5.2 - uo * 1.2
            if grass_at(p1, ctx) and grass_at((p0 + p1) / 2, ctx):
                best = (p0, p1)
                break
        if best is None:
            continue
        p0, p1 = best
        washing(g, p0, p1, h + 2.05, h + 2.0, rng, h)
        ctx.dress.setdefault("props", []).append({"name": "washing pole", "x": round(p1.x, 3), "z": round(p1.y, 3), "y": h,
                                                  "a": [1.0, 0.0], "len": 0.12, "dep": 0.12, "top": 2.1})
    # ---- a bench on each lawn, looking back at the town (M7 sleep reads every bench: world/rampart.ts, server rest.ts)
    for (name, _P), (ring, paved) in zip(ctx.land_bastions, ctx.grass):
        V = V2(ctx.blist[name]["vertex"])
        P = [V2(p) for p in ring]
        c = centroid(P)
        u = (V - c).normalized()
        spot = c + u * 3.0 + u.orthogonal().normalized() * 2.5
        if grass_at(spot, ctx) and all(grass_at(spot + u.orthogonal().normalized() * k, ctx) for k in (-1.0, 1.0)):
            place_bench(g, ctx, rng, spot, Vector((-u.y, u.x)), u, h, 1)
    g.grp = None


def build_dressing(g, ctx):
    """The gas lamps' spots on the town side of the walk, benches against the breastwork (a few on the
    town side by a lamp), two benches by each mill; the lanterns of the huts and gates as lights."""
    D, h, T = ctx.D, ctx.h, ctx.t
    n_seg = len(D["segments"])
    in_d = T - (BW_O + BW_T)  # the breastwork's inner face, from the town face
    for i, sg in enumerate(D["segments"]):
        L = sg["len"]
        rng = np.random.default_rng(18730 + i)
        # the walk's ends: at the river keep off the half-bastions, at a bend off the corner
        s0 = 16.0 if i == 0 else 7.0
        s1 = L - (16.0 if i == n_seg - 1 else 7.0)
        gates = [gt["s"] for gt in D["gates"] if gt["seg"] == sg["name"]]
        towers = [t["s"] for t in D["towers"] if t["seg"] == sg["name"]]
        stairs = []
        for st in D["stairs"]:
            if st["seg"] != sg["name"]:
                continue
            end = st["s"] + st["dir"] * (11.7 + 2.4)
            stairs.append((min(st["s"], end), max(st["s"], end)))

        def free(s, town):
            if any(abs(s - q) < 13.5 for q in gates):
                return False
            if not town and sg["name"] == WORKS[0] and WORKS[1] - 4.0 < s < WORKS[2] + 4.0:
                return False  # (the look pass: the breach of the works)
            if town and any(a - 2.5 < s < b + 2.5 for a, b in stairs):
                return False
            if not town and any(abs(s - q) < 7.0 for q in towers):
                return False
            return s0 <= s <= s1

        # the lamps, every 27 m or so on the town side
        s = s0 + rng.uniform(3.0, 10.0)
        lamps_here = []
        while s <= s1:
            ok = next((s + d for d in (0.0, 3.0, -3.0, 6.0) if free(s + d, True)), None)
            if ok is not None:
                F = ctx.sframe(sg, ok)
                x, _, z = F.p(0.0, LAMP_O, h)
                ctx.dress["lamps"].append([round(x, 3), round(z, 3), round(h, 3)])
                lamps_here.append(ok)
            s += LAMP_STEP + rng.uniform(-3.0, 4.0)
        # the benches against the breastwork, looking into the town; now and then one by a lamp on the town side
        s = s0 + rng.uniform(8.0, 22.0)
        t2, n2 = V2(sg["t"]), V2(sg["n"])
        while s <= s1:
            if free(s, False):
                kind = int(rng.choice(3, p=np.array([b[3] for b in BENCHES]) / sum(b[3] for b in BENCHES)))
                dep = BENCHES[kind][2]
                F = ctx.sframe(sg, s)
                x, _, z = F.p(0.0, in_d - dep / 2 - 0.03, h)
                place_bench(g, ctx, rng, Vector((x, z)), t2, -n2, h, kind)
            s += BENCH_STEP + rng.uniform(-8.0, 14.0)
        for ls in lamps_here:
            if rng.random() < 0.3:
                sb = ls + (2.4 if rng.random() < 0.5 else -2.4)
                if free(sb - 1.0, True) and free(sb + 1.0, True):
                    kind = int(rng.choice(3, p=np.array([b[3] for b in BENCHES]) / sum(b[3] for b in BENCHES)))
                    dep = BENCHES[kind][2]
                    F = ctx.sframe(sg, sb)
                    x, _, z = F.p(0.0, TOWN_T + dep / 2 + 0.03, h)
                    place_bench(g, ctx, rng, Vector((x, z)), -t2, n2, h, kind)
    # by each mill, on its paved square: two benches looking away from the tower to either side
    rng = np.random.default_rng(1881)
    for mc, mr, home, M in ctx.mills:
        b = ctx.blist[home]
        u = (V2(b["salient"]) - V2(b["vertex"])).normalized()
        w = Vector((-u.y, u.x))
        for sg_ in (-1.0, 1.0):
            c = mc + w * (sg_ * (mr + 1.1)) - u * 1.2
            place_bench(g, ctx, rng, c, u * sg_, w * sg_, h)


# ------------------------------------------------------------------ build


def build(ctx):
    D = ctx.D
    g = Geo()
    h = ctx.h
    rings = [Ring(r, ctx) for r in D["tops"]]
    for R in rings:
        build_ring(g, R, ctx)
    build_lawns(g, ctx)
    # guard houses: on the towers (door toward the walk, at decor's door), on the land bastions
    # (door toward the line's corner, where the walk is), on the river bastions (toward the town)
    towers = [(centroid(t["hut"]), t) for t in D["towers"]]
    bastions = [(centroid(b["hut"]), b) for b in D["bastion_list"] if b.get("hut")]
    for hut in ctx.huts:
        t = next((t for c, t in towers if (c - hut.c).length < 0.05), None)
        b = next((b for c, b in bastions if (c - hut.c).length < 0.05), None)
        dc = 0.0
        if t:
            d = V2(t["door"]) - hut.c
            ua, uo, _, _ = hut.facing(d)
            dc = d.dot(ua)
        elif b:
            d = V2(b["vertex"]) - hut.c
        else:
            d = ctx.centre - hut.c
        build_hut(g, hut, d, dc, h)
    # the sentry turrets at the land bastions' salients
    for name, P in ctx.land_bastions:
        S = V2(ctx.blist[name]["salient"])
        k = min(range(len(P)), key=lambda j: (P[j] - S).length)
        a, b, c = P[k - 1], P[k], P[(k + 1) % len(P)]
        u = ((b - a).normalized() - (c - b).normalized()).normalized()
        if u.dot(S - V2(ctx.blist[name]["vertex"])) < 0:
            u = -u
        build_turret(g, b, u, h)
    for mc, mr, home, M in ctx.mills:
        build_mill(g, ctx, mc, mr, home, M)
    build_dressing(g, ctx)
    build_props(g, ctx)
    build_moss(g, ctx)
    build_ferns(g, ctx)
    for st in D["stairs"]:
        build_stair(g, st, ctx)
    for gt in D["gates"]:
        g.grp = ("gate", gt["id"])
        F = build_gate(g, gt, ctx)
        build_bridge(g, gt, F, ctx)
        g.grp = None
    return g


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


def preview_ground(ctx):
    """Preview only: the town's ground, the berm, the moat, the far bank, the river."""
    D = ctx.D
    polys = [[(x, z) for x, z in r] for r in D["tops"]]
    polys += [[(x, z) for x, z in g["house"]] for g in D["gates"]]
    town = [(p.x, p.y) for p in ctx.town_poly]
    polys.append(town)
    segs = []
    for p in polys:
        for j in range(len(p)):
            segs.append((p[j], p[(j + 1) % len(p)]))
    S = np.array([[a[0], a[1], b[0], b[1]] for a, b in segs])
    cell = 1.5
    xs = np.arange(-480, 340, cell)
    zs = np.arange(-60, 500, cell)
    X, Z = np.meshgrid(xs + cell / 2, zs + cell / 2)
    P = np.stack([X.ravel(), Z.ravel()], 1)
    ax, az, bx, bz = S[:, 0], S[:, 1], S[:, 2], S[:, 3]
    dx, dz = bx - ax, bz - az
    L2 = np.maximum(dx * dx + dz * dz, 1e-9)
    t = np.clip(((P[:, 0:1] - ax) * dx + (P[:, 1:2] - az) * dz) / L2, 0, 1)
    dist = np.hypot(ax + t * dx - P[:, 0:1], az + t * dz - P[:, 1:2]).min(1)
    inn = np.zeros(len(P), bool)
    for p in polys:
        q = np.array(p)
        c = np.zeros(len(P), bool)
        for j in range(len(q)):
            x1, z1 = q[j]
            x2, z2 = q[(j + 1) % len(q)]
            m = ((z1 > P[:, 1]) != (z2 > P[:, 1])) & (P[:, 0] < x1 + (P[:, 1] - z1) * (x2 - x1) / ((z2 - z1) if z2 != z1 else 1e-9))
            c ^= m
        inn |= c
    q = np.array(town)
    intown = np.zeros(len(P), bool)
    for j in range(len(q)):
        x1, z1 = q[j]
        x2, z2 = q[(j + 1) % len(q)]
        intown ^= ((z1 > P[:, 1]) != (z2 > P[:, 1])) & (P[:, 0] < x1 + (P[:, 1] - z1) * (x2 - x1) / ((z2 - z1) if z2 != z1 else 1e-9))
    kinds = np.full(len(P), -1)
    land = P[:, 1] > 0
    kinds[land & intown] = 0
    kinds[land & ~intown & (inn | (dist < 14))] = 1
    kinds[land & ~intown & inn] = 0  # under the wall: the street's colour where a cell peeps out on the town side
    kinds[land & ~inn & ~intown & (dist >= 14) & (dist < 34)] = -1
    kinds[land & ~inn & ~intown & (dist >= 34)] = 2
    mats = [flat_mat("prev_street", (0.30, 0.29, 0.27)), flat_mat("prev_grass", (0.20, 0.25, 0.10)),
            flat_mat("prev_field", (0.24, 0.27, 0.12))]
    bm = bmesh.new()
    pond = []
    try:
        with open(PARK) as f:
            pond = [tuple(p) for p in json.load(f)["pond"]]
    except (OSError, KeyError, ValueError, TypeError):
        pass
    near_pond = np.zeros(len(P), bool)
    if pond:
        pa = np.array(pond)
        for k0 in range(0, len(P), 20000):
            q = P[k0:k0 + 20000]
            near_pond[k0:k0 + 20000] = (np.hypot(q[:, 0:1] - pa[None, :, 0], q[:, 1:2] - pa[None, :, 1]).min(1) < 3.0)
    for (px, pz), kd, inw, npd in zip(P, kinds, inn, near_pond):
        if kd < 0 or (pond and inside((px, pz), pond)) or (inw and npd):
            continue
        x0, x1, z0, z1 = px - cell / 2, px + cell / 2, pz - cell / 2, pz + cell / 2
        vs = [bm.verts.new(B((x, 0.0, z))) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        f.material_index = int(kd)
    me = bpy.data.meshes.new("prev_ground")
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new("prev_ground", me)
    bpy.context.scene.collection.objects.link(ob)
    if pond:
        me = bpy.data.meshes.new("prev_pond")
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(B((x, -0.35, z))) for x, z in pond])
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(flat_mat("prev_pond_m", (0.09, 0.12, 0.10)))
        o = bpy.data.objects.new("prev_pond", me)
        bpy.context.scene.collection.objects.link(o)
    for name, y, rgb in (("prev_water", -2.2, (0.10, 0.14, 0.15)), ("prev_bed", -4.5, (0.12, 0.11, 0.09))):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new(B((x, y, z))) for x, z in ((-700, -600), (600, -600), (600, 800), (-700, 800))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(flat_mat(name + "_m", rgb))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)


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
    bb.aim(cam, B(eye), B(look), lens=lens)
    bb.render(os.path.join(SHOTS, name), res)


def preview(ctx, only=None):
    preview_materials()
    preview_ground(ctx)
    cam = stage()
    D = ctx.D
    h, T = ctx.h, ctx.t
    segs = {s["name"]: s for s in D["segments"]}
    gates = {g["id"]: g for g in D["gates"]}
    views = []

    def at(p2, y):
        return (p2.x, y, p2.y)

    # a gate from the field, from the town, its shut leaves from the bridge and from the passage
    gt = gates["rode_poort"]
    F = ctx.sframe(gt["frame"], gt["s"])
    views.append(("wall_preview_gate.png", F.p(-9.0, 50.0, 5.0), F.p(0.0, 12.0, 5.5), 30))
    views.append(("wall_preview_gate_town.png", F.p(14.0, -24.0, 8.0), F.p(0.0, 2.0, 4.0), 30))
    views.append(("wall_close_leaves_field.png", F.p(2.2, 18.0, 2.0), F.p(0.0, 10.4, 2.8), 32))
    views.append(("wall_close_leaves_town.png", F.p(1.0, 1.0, 1.7), F.p(0.0, 10.2, 2.6), 30))
    views.append(("wall_close_gatejoin.png", F.p(-16.0, 16.0, 7.0), F.p(-9.0, 7.0, 5.0), 35))
    views.append(("wall_close_gatewalk.png", F.p(-22.0, 3.5, h + 1.7), F.p(-9.0, 3.5, h + 1.5), 35))
    views.append(("wall_close_bridgeend.png", F.p(7.0, 47.0, 2.2), F.p(2.0, 40.0, 1.2), 32))
    views.append(("wall_close_arch.png", F.p(3.0, 20.0, 2.5), F.p(0.0, 10.0, 4.2), 30))
    # the walk along the most slanted segment, a tower's guard house on its side
    tw = max(D["towers"], key=lambda t: abs(t["frame"]["t"][0] * t["frame"]["t"][1]))
    Ft = ctx.sframe(tw["frame"], tw["s"])
    views.append(("wall_preview_walk.png", Ft.p(-16.0, 2.5, h + 1.7), Ft.p(10.0, 4.5, h + 1.2), 28))
    views.append(("wall_close_tower.png", Ft.p(-9.0, 13.0, 4.0), Ft.p(0.0, 8.0, h), 32))
    views.append(("wall_close_hutdoor.png", Ft.p(2.5, 2.2, h + 1.6), Ft.p(0.0, T + 1.0, h + 1.2), 32))
    # a corner between two segments (the sharpest plain bend), from the walk and from the field
    plain = [i for i in range(1, len(ctx.trace) - 1) if not any(b["vertex"] == D["trace"][i] for b in D["bastion_list"])]
    turn = {i: math.acos(max(-1.0, min(1.0, V2(D["segments"][i - 1]["t"]).dot(V2(D["segments"][i]["t"]))))) for i in plain}
    ic = max(plain, key=lambda i: turn[i])
    sa, sb = D["segments"][ic - 1], D["segments"][ic]
    Fa, Fb = ctx.sframe(sa, sa["len"]), ctx.sframe(sb, 0.0)
    views.append(("wall_preview_corner_walk.png", Fa.p(-24.0, 3.2, h + 1.7), Fb.p(14.0, 3.6, h + 0.5), 30))
    Vc = ctx.trace[ic]
    bis = (V2(sa["n"]) + V2(sb["n"])).normalized()
    views.append(("wall_preview_corner_field.png", at(Vc + bis * 30.0 + V2(sa["t"]) * 4.0, 4.0), at(Vc, 3.2), 30))
    views.append(("wall_close_corner_top.png", at(Vc - bis * 2.0 + V2(sa["t"]) * -6.0, h + 1.7), at(Vc - bis * 0.4, h + 0.9), 30))
    # a stair on a slanted segment
    st = max(D["stairs"], key=lambda s: abs(s["frame"]["t"][0] * s["frame"]["t"][1]))
    Fs, RUN, LAND, W = stair_frame(st, ctx)
    views.append(("wall_preview_stair.png", Fs.p(-7.0, -16.0, 9.0), Fs.p(RUN * 0.55, -1.0, 3.0), 30))
    views.append(("wall_close_stairhead.png", Fs.p(RUN + LAND + 5.0, 2.2, h + 1.7), Fs.p(RUN - 3.0, -0.9, h - 1.2), 32))
    views.append(("wall_close_stairfoot.png", Fs.p(-4.0, -6.0, 2.2), Fs.p(2.0, -1.2, 1.0), 32))
    # the middle bastion with its mill: from the walk, from the field, from above, the door, the cap
    mc = ctx.mill[0]
    home = next((nm for nm, P in ctx.land_bastions if inside((mc.x, mc.y), [(p.x, p.y) for p in P])), None)
    if home:
        b = ctx.blist[home]
        Vb, Sb = V2(b["vertex"]), V2(b["salient"])
        ub = (Sb - Vb).normalized()
        wb = Vector((-ub.y, ub.x))
        hub = ctx.mill_hub
        views.append(("wall_preview_mill_walk.png", at(Vb - ub * 3.5 + wb * 14.0, h + 1.7), at(mc, h + 6.5), 30))
        views.append(("wall_preview_mill_field.png", at(Sb + ub * 34.0 + wb * 16.0, 5.0), at(mc, h + 5.0), 30))
        views.append(("wall_preview_mill_above.png", at(mc + ub * 38.0 - wb * 30.0, 42.0), at(mc - ub * 4.0, h), 30))
        views.append(("wall_close_mill_door.png", at(mc - ub * 9.0 + wb * 2.5, h + 1.7), at(mc - ub * 3.0, h + 1.4), 32))
        views.append(("wall_close_mill_cap.png", at(mc + ub * 13.0 + wb * 9.0, h + 13.0), (hub.x - ub.x * 1.5, hub.y - 0.5, hub.z - ub.y * 1.5), 32))
        views.append(("wall_close_mill_side.png", at(mc + wb * 16.0 + ub * 2.0, h + 6.0), at(mc, h + 8.0), 30))
    # a land bastion's salient and its turret, the flank's root, a river half-bastion
    name, P = max(ctx.land_bastions, key=lambda nb: (V2(ctx.blist[nb[0]]["salient"]) - V2(ctx.blist[nb[0]]["vertex"])).length)
    b = ctx.blist[name]
    Sb, Vb = V2(b["salient"]), V2(b["vertex"])
    u = (Sb - Vb).normalized()
    pu = Vector((-u.y, u.x))
    views.append(("wall_preview_bastion.png", at(Sb + u * 50.0 + pu * 40.0, 55.0), at((Sb + Vb) / 2, 3.0), 32))
    views.append(("wall_close_salient.png", at(Sb + u * 14.0 + pu * 5.0, 5.0), at(Sb, 4.0), 35))
    views.append(("wall_close_turret.png", at(Sb - u * 9.0 + pu * 2.0, h + 1.8), at(Sb, h + 1.4), 35))
    sh = P[0]  # the flank's root on the curtain (rampart.py lists it first)
    iv = next(i for i, p in enumerate(ctx.trace) if (p - Vb).length < 0.01)
    sg = D["segments"][iv - 1]
    views.append(("wall_close_flank.png", at(sh - V2(sg["t"]) * 22.0 + V2(sg["n"]) * 11.0, 3.0), at(sh + V2(sg["n"]) * 3.0, 3.5), 35))
    Rb = ctx.river_bastions[0][1]
    rc = centroid(Rb)
    views.append(("wall_close_river.png", (rc.x - 30, 9.0, rc.y - 40), (rc.x, 0.0, rc.y), 32))
    q = min(Rb, key=lambda p: abs(p.y + 10.0) + min(abs(p.x - ctx.inner[0].x), abs(p.x - ctx.inner[-1].x)))
    views.append(("wall_close_parapetjoin.png", (q.x + (3.5 if q.x > 0 else -3.5), h + 1.7, q.y + 6.0), (q.x, h + 0.7, q.y), 35))
    # the mossy town face where the park's pond lies against it
    if ctx.moss:
        P, t, c0, c1, out = ctx.moss
        cm = P + t * ((c0 + c1) / 2)
        views.append(("wall_close_moss.png", at(cm + out * 7.0 - t * 3.0, 1.7), at(cm + out * 0.2 + t * 1.0, 0.6), 30))
        views.append(("wall_close_moss_end.png", at(P + t * (c1 + 4.0) + out * 4.5, 1.5), at(P + t * (c1 - 0.5), 0.5), 32))
        views.append(("wall_preview_moss.png", at(cm + out * 22.0 + t * 6.0, 4.0), at(cm, 2.5), 30))
    # the whole ring from high up
    views.append(("wall_preview_ring.png", (-70, 620, -330), (-70, 0, 190), 30))
    for gid, gg in gates.items():
        Fg = ctx.sframe(gg["frame"], gg["s"])
        views.append((f"wall_check_{gid}_field.png", Fg.p(-14.0, 48.0, 16.0), Fg.p(0.0, 8.0, 4.0), 30))
        views.append((f"wall_check_{gid}_town.png", Fg.p(12.0, -30.0, 14.0), Fg.p(0.0, 0.0, 4.0), 30))
    for name, eye, look, lens in views:
        if only and not any(o in name for o in only):
            continue
        shot(cam, name, eye, look, lens)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(CITY) as f:
        city = json.load(f)
    D = city["decor"]["rampart"]
    ctx = Ctx(D, city["decor"].get("rampart_solids", []))
    ctx.grass, ctx.grass_cuts = grass_areas(ctx)
    make_materials(ctx)
    g = build(ctx)
    objs = g.to_objects([gt["id"] for gt in D["gates"]])
    # pass 2: each mill's axle on its sails, and what the game places and bumps into (world/rampart.ts)
    for nm, a in ctx.mill_axles.items():
        if nm in objs:
            objs[nm]["axle"] = [round(a.x, 5), round(a.y, 5), round(a.z, 5)]
    ctx.dress["lanterns"] = [[round(x, 3), round(y, 3), round(z, 3)] for x, y, z in LAMPS]
    dress = bpy.data.objects.new("wall_dressing", None)
    dress["dressing"] = json.dumps(ctx.dress, separators=(",", ":"))
    bpy.context.scene.collection.objects.link(dress)
    export()
    print(f"[build_wall] dressing: {len(ctx.dress['mills'])} mills, {len(ctx.dress['benches'])} benches, "
          f"{len(ctx.dress['lamps'])} lamps, {len(ctx.dress['lanterns'])} lanterns")
    total = 0
    for n in sorted(objs):
        c = tris(objs[n])
        total += c
        print(f"[build_wall] {n:22s} {c:6d} tris")
    print(f"[build_wall] {len(objs)} objects, {total} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if getattr(ctx, "mill_hub", None) is not None:
        hb, ax = ctx.mill_hub, ctx.mill_axle
        print(f"[build_wall] MILL_HUB ({hb.x:.3f}, {hb.y:.3f}, {hb.z:.3f})  MILL_AXLE ({ax.x:.5f}, {ax.y:.5f}, {ax.z:.5f})")
    if "--preview" in argv:
        i = argv.index("--preview")
        only = argv[i + 1].split(",") if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        preview(ctx, only)


if __name__ == "__main__":
    main()

"""The horse's parts, built from the shapes of build_props.py's draught horse (one source for the anatomy: BODY, NECK and
HEAD tables, the harness's measures) at a higher density, each with its origin at its pivot.

body      the trunk, the back pad, back band, belly band and shaft tugs, the crupper and the breeching, the reins'
          back halves (hame terret, pad terret, crupper)
neck      the neck and the mane, the collar with its hames, tugs, terrets, chains and kidney link (pivot: the base of
          the neck, deep inside the collar, so the nod moves the collar by millimetres)
head      the head (eyes, nostrils, lips, the blaze), the forelock, the bridle with its blinkers, browband, noseband, bit
          and the headpiece (pivot: the poll)
ear_l/_r  each ear on its base
tail      the tail from the dock (pivot: inside the crupper's dock loop)
leg_*     the four leg parts as the game has always moved them (pivot: the shoulder or hip pivot, the knee or hock)
rein      a strap a metre long along +f with a little sag, stretched by the game from the bit ring to the hame terret
trace     a leather trace a metre long along +f with its chain end, stretched from the tug's buckle to the hook

Every face carries its region (the old team cell: coat, mane, points, white, muzzle, eye, hoof, iron, brass, leather,
collar, hame, cloth) for the painter, and the vertices are split where two regions meet.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import build_props as BP
from build_props import (body_half_width, body_angle_at, COLLAR_A, COLLAR_B, HAME_A, HAME_B, HEAD0, HORSE_RIG, KIDNEY, SHAFT_TUG, TRACE_END, HP, Mesh,
                         band, body_out, body_pt, collar_pt, disc, head_out, head_pt, head_sec, move, neck_out, neck_pt,
                         sagged, sheet, torus)

H_COAT, H_MANE, H_POINTS, H_MARK = BP.H_COAT, BP.H_MANE, BP.H_POINTS, BP.H_MARK
H_MUZZLE, H_EYE, H_HOOF, H_IRON, H_BRASS, H_LEATHER, H_CLOTH = BP.H_MUZZLE, BP.H_EYE, BP.H_HOOF, BP.H_IRON, BP.H_BRASS, BP.H_LEATHER, BP.H_CLOTH

# region names by team cell (build_props.TEAM_CELLS order); the coat's own cells name what they are on the bay
REGION = {"bay": "coat", "chestnut": "coat", "black": "points", "roan": "coat", "hair_black": "hair", "hair_flaxen": "hair",
          "hoof": "hoof", "iron": "iron", "brass": "brass", "leather": "leather", "collar": "collar", "hame": "hame",
          "eye": "eye", "muzzle": "muzzle", "white": "white", "cloth": "cloth"}
REGIONS = ["coat", "points", "white", "muzzle", "eye", "hair", "hoof", "iron", "brass", "leather", "collar", "hame", "cloth"]

# pivots (f, h) in the horse's frame
NECK_PIVOT = (0.575, 1.375)
HEAD_PIVOT = HEAD0
EAR_BASE = (0.07, 1.175, 2.225)  # x, f, h
TAIL_PIVOT = (-1.0, 1.575)


def G(v):
    """Blender (x, y, z) to the game's (x, y up, z forward)."""
    return (round(v[0], 5), round(v[2], 5), round(-v[1], 5))


# ---------------------------------------------------------------- the hide

# the breast, rounded off to a point in front (build_props ends the trunk at f 1.035 in a flat cap, which read as two
# round lobes from low in front): the last rows narrow to nothing
BREAST = [(0.97, 1.43, 1.10, 0.215, 2.2), (1.01, 1.385, 1.15, 0.165, 2.15), (1.04, 1.34, 1.2, 0.1, 2.05), (1.06, 1.3, 1.24, 0.04, 2.0),
          (1.068, 1.275, 1.26, 0.006, 2.0)]


def breast_rows():
    rows = [r for r in BP.BODY if r[0] < 0.96] + BREAST
    BP.BODY[:] = rows


def hide_body(m):
    breast_rows()
    fs = [-1.035, -1.025, -1.0, -0.97, -0.93, -0.87, -0.8, -0.72, -0.62, -0.5, -0.38, -0.25, -0.12, 0.0, 0.12, 0.24, 0.35,
          0.45, 0.54, 0.62, 0.7, 0.77, 0.84, 0.9, 0.95, 0.99, 1.02, 1.04, 1.055, 1.064]
    sides = 24
    rings = []
    for f in fs:
        ring = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            p = body_pt(f, a)
            # the pectorals: a faint groove down the middle of the breast between the forelegs
            if f > 0.8 and math.sin(a) < 0:
                p = p + Vector((0, -0.012 * max(0.0, 1 - abs(math.cos(a)) / 0.18) * min(1.0, (f - 0.8) / 0.15), 0))
            ring.append(p)
        rings.append(ring)
    m.grid(rings, H_COAT, cap0=True, cap1=True, urep=4, vscale=1.6)


def hide_neck(m):
    us = [0.0, 0.08, 0.17, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.83, 0.91, 1.0]
    rings = [[neck_pt(u, 2 * math.pi * i / 16) for i in range(16)] for u in us]
    m.grid(rings, H_COAT, cap1=True, urep=3, vscale=1.6)


def hide_head(m):
    """The head meshed from its distance field (horse/head.py); the blaze, the nostrils and the lips are painted. The
    face (from the nostrils down, t > 0.74) is the muzzle's skin."""
    from . import head as HD
    co, tris, tt, nrm = HD.mesh()
    vs = [m.vert(tuple(p)) for p in co]
    for a_, b_, c_ in tris:
        t = (tt[a_] + tt[b_] + tt[c_]) / 3
        m.face([vs[a_], vs[b_], vs[c_]], [(0, 0), (1, 0), (0, 1)], H_MUZZLE if t > 0.74 else H_COAT, smooth=True)
    # the eyes, set in the head's skin
    for sx in (1, -1):
        a = math.radians(28) if sx > 0 else math.radians(152)
        c = head_pt(0.235, a, -0.006)
        q = head_out(0.235, a).to_track_quat("Z", "Y").to_matrix().to_4x4()
        with m.at(Matrix.Translation(c) @ q):
            m.lathe([(0.034, -0.006), (0.031, 0.008), (0.02, 0.017), (0.0, 0.021)], 14, H_EYE, smooth=True, cap0=True)


def ear(m, sx):
    """An ear: a shell of skin and hair cupped round its hollow, open to the front and a little out, rounded at the base,
    pointed at the tip, its rim thick (the cartilage); the hollow's inside is the pale fine hair."""
    base = HP(sx * 0.07, 1.175, 2.215)
    tip = HP(sx * 0.105, 1.2, 2.41)
    ax = (tip - base).normalized()
    fwd = HP(sx * 0.35, 1.0, 0.0) - HP(0, 0, 0)
    fwd = (fwd - ax * fwd.dot(ax)).normalized()
    side = ax.cross(fwd).normalized()
    n = 9
    rings_out, rings_in = [], []
    for k in range(n):
        u = k / (n - 1)
        # width and depth along the ear: full at a third, a point at the tip
        w = 0.042 * (1 - u ** 1.6) * (0.85 + 0.45 * math.sin(math.pi * min(u * 1.6, 1.0)) ** 0.5) + 0.002
        d = 0.03 * (1 - u ** 1.4) + 0.002
        c = base + ax * (0.19 * u) + fwd * (0.004 * math.sin(math.pi * u))
        th = 0.007 * (1 - u) + 0.002
        out_, in_ = [], []
        for j in range(13):
            a_ = math.radians(-140 + 280 * j / 12)  # 0 at the back, the open side at the front
            p = c + side * w * math.sin(a_) - fwd * d * math.cos(a_)
            out_.append(p)
            q = c + side * (w - th) * math.sin(a_) * 0.92 - fwd * (d - th) * math.cos(a_) + fwd * th * 0.6
            in_.append(q)
        rings_out.append(out_)
        rings_in.append(in_)
    # the outer skin, the rim (outer to inner at the open edges) and the hollow
    m.grid(rings_out, H_COAT, closed=False, urep=2, vscale=2)
    m.grid([r[::-1] for r in rings_in], H_MANE, closed=False, urep=2, vscale=2)
    for j in (0, 12):
        for k in range(n - 1):
            q = [rings_out[k][j], rings_out[k + 1][j], rings_in[k + 1][j], rings_in[k][j]]
            if j == 12:
                q = q[::-1]
            m.poly(q, H_COAT, shade=0.8)
    # the base closed (it sits in the poll's hair)
    m.poly(rings_out[0] + rings_in[0][::-1], H_COAT, out=-ax, shade=0.6)


# ---------------------------------------------------------------- the hair

def mane(m):
    us = [0.1 + 0.04 * k for k in range(21)]
    rings = []
    for k, u in enumerate(us):
        jag = 0.16 * math.sin(k * 2.3) * math.cos(k * 0.7 + 1.0)
        end = math.radians(150 + 18 * jag)
        top = [neck_pt(u, math.radians(a), o) for a, o in ((72, 0.02), (90, 0.05), (112, 0.055), (135, 0.045))]
        tip = neck_pt(u, end, 0.035) + Vector((0, 0, -0.05 - 0.05 * max(0.0, jag)))
        inner = [neck_pt(u, math.radians(a), -0.01) for a in (140, 105, 72)]
        rings.append(top + [tip] + inner)
    sheet(m, rings, H_MANE, uscale=3.0, shade=0.9)


def forelock(m):
    ts = [-0.06, 0.0, 0.05, 0.1, 0.15, 0.2]
    band(m, [head_pt(t, math.pi / 2 + 0.05, 0.012 if t > 0 else 0.03) for t in ts],
         [head_out(max(t, 0.0), math.pi / 2) for t in ts], [0.1, 0.095, 0.085, 0.07, 0.05, 0.025], 0.02, H_MANE, vscale=3)


def tail(m):
    path = [HP(0, -0.95, 1.6), HP(0, -1.0, 1.585), HP(0, -1.035, 1.55), HP(0, -1.065, 1.49), HP(0, -1.09, 1.42), HP(0, -1.105, 1.31),
            HP(0, -1.115, 1.2), HP(0, -1.118, 1.08), HP(0, -1.115, 0.96), HP(0, -1.108, 0.86), HP(0, -1.1, 0.76), HP(0, -1.09, 0.68)]
    radii = [(0.05, 0.055), (0.055, 0.06), (0.058, 0.065), (0.066, 0.072), (0.075, 0.08), (0.083, 0.086), (0.09, 0.09), (0.096, 0.092),
             (0.1, 0.092), (0.097, 0.086), (0.09, 0.075), (0.05, 0.04)]
    m.tube(path, radii, 12, H_MANE, side=(1, 0, 0), cap1=True, vscale=1.4, urep=2)


# ---------------------------------------------------------------- the collar (build_props.horse_collar, rounder)

def collar(m):
    from build_props import collar_frame
    C, t, s_, b = collar_frame()
    n = 26
    th = [2 * math.pi * k / n for k in range(n)]

    def A(a):
        return COLLAR_A * (1 - 0.12 * max(0.0, math.sin(a)))
    body = [collar_pt(a, A(a), COLLAR_B) for a in th]
    m.tube(body, [BP.COLLAR_R] * n, 10, BP.H_COLLAR, side=tuple(t), closed_path=True, vscale=3, urep=1)
    rim = [collar_pt(a, A(a) + 0.05, COLLAR_B + 0.05, 0.03) for a in th]
    m.tube(rim, [(0.03, 0.036)] * n, 7, BP.H_COLLAR, side=tuple(t), closed_path=True, vscale=3, urep=1, shade=0.8)
    lin = [collar_pt(a, A(a) - 0.045, COLLAR_B - 0.045, -0.03) for a in th]
    m.tube(lin, [(0.028, 0.02)] * n, 6, H_CLOTH, side=tuple(t), closed_path=True, vscale=3, urep=1, shade=0.7)
    for sx in (1, -1):
        a0, a1 = math.radians(-68), math.radians(70)
        path = []
        for k in range(17):
            a = a0 + (a1 - a0) * k / 16
            p = collar_pt(a, HAME_A, HAME_B, -0.005)
            path.append(Vector((sx * p.x, p.y, p.z)))
        top = path[-1]
        up = (collar_pt(math.radians(78), HAME_A, HAME_B) - collar_pt(math.radians(62), HAME_A, HAME_B)).normalized()
        up = Vector((sx * up.x, up.y, up.z))
        path += [top + up * 0.07 + Vector((sx * 0.004, 0, 0.02)), top + up * 0.12 + Vector((sx * 0.012, 0.015, 0.06))]
        m.tube(path, [(0.02, 0.026)] * (len(path) - 1) + [(0.016, 0.02)], 7, BP.H_HAME, side=tuple(t), rot=math.pi / 8,
               cap0=True, cap1=True, vscale=2.5, urep=1, smooth=True)
        knob = path[-1] + (path[-1] - path[-2]).normalized() * 0.02
        with m.at(Matrix.Translation(knob)):
            m.lathe([(0.012, -0.03), (0.03, -0.005), (0.022, 0.022), (0.008, 0.032), (0.0, 0.034)], 12, H_BRASS, smooth=True, cap0=True)
        for a in (math.radians(-34), math.radians(48)):
            p = collar_pt(a, HAME_A + 0.024, HAME_B + 0.024, -0.005)
            disc(m, Vector((sx * p.x, p.y, p.z)), Vector((sx, 0, 0)) + (b * math.sin(a)) * 0.5, 0.024, 0.008, H_BRASS, sides=10)
        p = collar_pt(math.radians(48), HAME_A + 0.05, HAME_B + 0.05, -0.005)
        torus(m, Vector((sx * p.x, p.y, p.z)), (0, 1, 0), 0.026, 0.006, H_BRASS, seg=12, sides=6)
        p = collar_pt(math.radians(-34), HAME_A + 0.01, HAME_B + 0.01, -0.005)
        a_ = Vector((sx * p.x, p.y, p.z))
        e = HP(sx * TRACE_END[0], TRACE_END[1], TRACE_END[2])
        mid = (a_ + e) / 2 + Vector((sx * 0.012, 0, 0))
        band(m, [a_, (a_ + mid) / 2, mid, (mid + e) / 2, e], [Vector((sx, 0, 0))] * 5, 0.05, 0.012, H_LEATHER, vscale=3)
        torus(m, e + Vector((sx * 0.006, 0.02, 0)), (1, 0, 0), 0.03, 0.007, H_BRASS, seg=10, sides=5)
        foot = path[0]
        k = HP(*KIDNEY)
        for i in range(4):
            p0 = foot + (k - foot) * (i / 4)
            p1 = foot + (k - foot) * ((i + 1) / 4)
            m.beam(tuple(p0), tuple(p1), 0.016 if i % 2 else 0.006, 0.006 if i % 2 else 0.016, H_IRON, caps=True)
    pa = collar_pt(math.radians(66), HAME_A + 0.01, HAME_B + 0.01, -0.005)
    pb = Vector((-pa.x, pa.y, pa.z))
    top = collar_pt(math.pi / 2, 0, HAME_B + 0.035, -0.005)
    band(m, [pa, (pa + top) / 2 + b * 0.012, top, (pb + top) / 2 + b * 0.012, pb], [b] * 5, 0.035, 0.01, H_LEATHER, vscale=3)
    torus(m, HP(*KIDNEY), (1, 0, 0), 0.04, 0.009, H_IRON, seg=14, sides=6)


# ---------------------------------------------------------------- the harness, split by the part it rides on

def pad(m):
    """build_props.horse_pad at more sides (the rings and tugs round, not hexagons)."""
    L = H_LEATHER
    # the back pad (the cart saddle): leather over a felted pad, a brass crest and two terrets
    fs = [0.17, 0.22, 0.38, 0.43]
    rings = []
    for f in fs:
        e = 0.55 if f in (0.17, 0.43) else 1.0
        outer = [body_pt(f, math.radians(a), 0.012 + e * 0.042 * math.sin(math.pi * (a - 28) / 124))
                 for a in range(28, 153, 20)]
        inner = [body_pt(f, math.radians(a), -0.02) for a in (148, 90, 32)]
        rings.append(outer + inner)
    m.grid(rings, L, cap0=True, cap1=True, smooth=False, urep=2, vscale=3)
    rings = [[body_pt(f, math.radians(a), o) for a, o in ((24, 0.008), (60, 0.016), (90, 0.018), (120, 0.016), (156, 0.008),
                                                          (150, -0.01), (90, -0.01), (30, -0.01))] for f in (0.15, 0.45)]
    m.grid(rings, H_CLOTH, cap0=True, cap1=True, smooth=False, urep=2, vscale=3)
    band(m, [body_pt(f, math.pi / 2, 0.056) for f in (0.2, 0.3, 0.4)], [Vector((0, 0, 1))] * 3, 0.03, 0.006, H_BRASS)
    for a in (72, 108):
        p = body_pt(0.30, math.radians(a), 0.06)
        disc(m, p, body_out(0.3, math.radians(a)), 0.016, 0.01, H_BRASS, sides=10)
        torus(m, p + body_out(0.3, math.radians(a)) * 0.034, (0, 1, 0), 0.026, 0.006, H_BRASS, seg=12, sides=5)
    for sx in (1, -1):
        # the back band down to the tug, the tug the shaft rests in, the belly band under to the other tug
        angs = [math.radians(a if sx > 0 else 180 - a) for a in (30, 15, 0, -12)]
        pts = [body_pt(0.30, a, 0.012) for a in angs]
        tug = HP(sx * SHAFT_TUG[0], SHAFT_TUG[1], SHAFT_TUG[2])
        pts.append(tug + Vector((sx * -0.025, 0, 0.055)))
        band(m, pts, [body_out(0.3, a) for a in angs] + [Vector((sx, 0, 0))], 0.06, 0.01, L, vscale=3)
        torus(m, tug, (0, 1, 0), 0.05, 0.012, L, seg=14, sides=6)
        disc(m, pts[-1] + Vector((sx * 0.012, 0, 0)), Vector((sx, 0, 0)), 0.02, 0.008, H_BRASS, sides=10)
    angs = [math.radians(a) for a in range(-22, -159, -17)]
    under = [body_pt(0.34, a, 0.012) for a in angs]
    band(m, under, [body_out(0.34, a) for a in angs], 0.07, 0.01, L, vscale=3)
    # the crupper down the spine to the dock, a brass ring where the hip straps meet it
    fs = [0.17, 0.0, -0.2, -0.4, -0.6, -0.78, -0.9, -0.97]
    band(m, [body_pt(f, math.pi / 2, 0.01) for f in fs], [body_out(f, math.pi / 2) for f in fs], 0.04, 0.008, L, vscale=3)
    dock = HP(0, -1.035, 1.55)
    ax = (HP(0, -1.09, 1.42) - HP(0, -0.95, 1.6)).normalized()
    torus(m, dock, ax, 0.074, 0.012, L, seg=16, sides=6)
    band(m, [body_pt(-0.97, math.pi / 2, 0.01), dock + Vector((0, -0.01, 0.075))], [Vector((0, 0.3, 1))] * 2, 0.04, 0.008, L)
    torus(m, body_pt(-0.45, math.pi / 2, 0.02), (0, 0, 1), 0.035, 0.008, H_BRASS, seg=12, sides=5)
    # the breeching round the quarters, the hip straps holding it up
    hb = 1.19
    side = [(-0.4, 0), (-0.6, 0), (-0.8, 0), (-0.93, 0), (-0.99, 0)]
    pts = []
    for f, _ in side:
        pts.append(HP(body_half_width(f, hb) + 0.016, f, hb))
    wr = body_half_width(-1.0, hb) + 0.016
    back = [HP(wr * 0.6, -1.02, hb), HP(0.0, -1.035, hb)]
    right = pts + back
    ring = right + [Vector((-p.x, p.y, p.z)) for p in reversed(right[:-1])]
    ctr = HP(0, -0.55, hb)
    outs = [Vector((p.x - ctr.x, p.y - ctr.y, 0)).normalized() for p in ring]
    band(m, ring, outs, 0.085, 0.012, L, vscale=3)
    for f in (-0.5, -0.8):
        for sx in (1, -1):
            a1 = body_angle_at(f, hb + 0.03, sx)
            angs = [math.pi / 2 + (a1 - math.pi / 2) * k / 3 for k in range(4)]
            band(m, [body_pt(f, a, 0.012) for a in angs], [body_out(f, a) for a in angs], 0.035, 0.008, L, vscale=3)
    for sx in (1, -1):
        p = ring[0] if sx > 0 else ring[-1]
        torus(m, p + Vector((sx * 0.015, 0, 0)), (1, 0, 0), 0.03, 0.007, H_BRASS, seg=12, sides=5)



def bridle(m):
    """build_props.horse_bridle without the reins (they are the rein straps and the body's back halves)."""
    L = H_LEATHER
    angs = [2 * math.pi * k / 14 for k in range(14)]
    band(m, [neck_pt(0.965, a, 0.012) for a in angs], [neck_out(0.965, a) for a in angs], 0.03, 0.008, L, closed=True)
    angs = [math.radians(a) for a in range(18, 163, 16)]
    band(m, [head_pt(0.07, a, 0.012) for a in angs], [head_out(0.07, a) for a in angs], 0.026, 0.008, L)
    for a in (math.radians(14), math.radians(166)):
        disc(m, head_pt(0.07, a, 0.018), head_out(0.07, a), 0.022, 0.012, H_BRASS, sides=10)
    disc(m, head_pt(0.16, math.pi / 2, 0.016), head_out(0.16, math.pi / 2), 0.03, 0.01, H_BRASS, sides=12)
    band(m, [head_pt(0.07, math.pi / 2, 0.02), head_pt(0.13, math.pi / 2, 0.018)], [head_out(0.1, math.pi / 2)] * 2, 0.018, 0.006, L)
    angs = [2 * math.pi * k / 14 for k in range(14)]
    band(m, [head_pt(0.69, a, 0.012) for a in angs], [head_out(0.69, a) for a in angs], 0.03, 0.008, L, closed=True)
    for sx in (1, -1):
        def A(deg):
            return math.radians(deg if sx > 0 else 180 - deg)

        ts = [0.02, 0.12, 0.3, 0.45, 0.6, 0.69, 0.8, 0.9, 0.93]
        angs = [A(d) for d in (8, 6, 2, -4, -10, -12, -18, -24, -28)]
        band(m, [head_pt(t, a, 0.012) for t, a in zip(ts, angs)], [head_out(t, a) for t, a in zip(ts, angs)], 0.028, 0.008, L)
        c = head_pt(0.235, A(22), 0.0)
        o = head_out(0.235, A(22))
        ax = head_sec(0.235)[1]
        up = o.cross(ax).normalized() * sx
        quad = []
        for da, du in ((-0.07, -0.05), (0.055, -0.05), (0.055, 0.05), (-0.07, 0.05)):
            lift = 0.035 + (0.035 if da < 0 else 0.0)
            quad.append(c + ax * da + up * du + o * lift)
        m.slab(quad, 0.012, L, out=o, mode="fit")
        disc(m, (quad[0] + quad[2]) / 2, o, 0.022, 0.01, H_BRASS, sides=10)
        C, ax, W, T, B = head_sec(0.935)
        mouth = head_pt(0.935, A(-35), 0.0)
        torus(m, Vector((sx * (W + 0.045), mouth.y, mouth.z)), (1, 0, 0), 0.036, 0.007, H_IRON, seg=12, sides=5)
    C, ax, W, T, B = head_sec(0.935)
    mouth = head_pt(0.935, math.radians(-35), 0.0)
    m.beam((-(W + 0.045), mouth.y, mouth.z), ((W + 0.045), mouth.y, mouth.z), 0.014, 0.014, H_IRON, side=(0, 1, 0))


def bit_ring(sx):
    C, ax, W, T, B = head_sec(0.935)
    mouth = head_pt(0.935, math.radians(-35), 0.0)
    return Vector((sx * (W + 0.045), mouth.y, mouth.z)) + Vector((0, 0.03, -0.02))


def hame_terret(sx):
    hp = collar_pt(math.radians(48), HAME_A + 0.05, HAME_B + 0.05, -0.005)
    return Vector((sx * hp.x, hp.y, hp.z))


def reins_back(m):
    """The reins from the hame terret through the pad's terret back to the crupper (the bit's half is the rein strap)."""
    L = H_LEATHER
    for sx in (1, -1):
        def A(deg):
            return math.radians(deg if sx > 0 else 180 - deg)
        hame = hame_terret(sx)
        pad = body_pt(0.30, A(72), 0.085)
        pts = sagged([hame, pad], 0.03) + sagged([pad, body_pt(0.0, A(55), 0.03), body_pt(-0.45, A(62), 0.02)], 0.04)[1:]
        band(m, pts, [Vector((0, 0, 1))] * len(pts), 0.022, 0.006, L, vscale=3, faces="full")


def strap(m, kind):
    """The unit straps the game stretches: along +f from 0 to 1 m."""
    if kind == "rein":
        n = 9
        pts = [HP(0, k / (n - 1), -0.035 * math.sin(math.pi * k / (n - 1))) for k in range(n)]
        band(m, pts, [Vector((0, 0, 1))] * n, 0.022, 0.006, H_LEATHER, vscale=3, faces="full")
        return
    # the trace: a leather strap doubled and stitched, its last tenth a short chain to the hook
    n = 8
    pts = [HP(0, 0.9 * k / (n - 1), -0.02 * math.sin(math.pi * k / (n - 1))) for k in range(n)]
    band(m, pts, [Vector((0, 0, 1))] * n, 0.045, 0.011, H_LEATHER, vscale=3, faces="full")
    for i in range(4):
        a, b = 0.9 + 0.025 * i, 0.925 + 0.025 * i
        if i % 2:
            m.beam(tuple(HP(0, a, 0)), tuple(HP(0, b + 0.004, 0)), 0.024, 0.008, H_IRON, caps=True)
        else:
            m.beam(tuple(HP(0, a, 0)), tuple(HP(0, b + 0.004, 0)), 0.008, 0.024, H_IRON, caps=True)


# ---------------------------------------------------------------- legs (the shapes of build_props, rounder)

def _leg(m, pts, cells, cap0=True, cap1=True):
    m.tube([HP(0, f, h) for f, h, _, _ in pts], [(w, d) for *_, w, d in pts], 14, cells[0], side=(1, 0, 0), mats=cells,
           cap0=cap0, cap1=cap1, vscale=1.6, urep=2)


def _dense(pts, k=2):
    """Each span of a leg's profile split in k (smoothly, Catmull-Rom), so the tube's rings follow the muscles."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for j in range(k):
            t = j / k
            out.append(tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(pts[-1])
    return out


def _cells(n_in, cells_in, k=2):
    out = []
    for c in cells_in:
        out += [c] * k
    return out[:n_in - 1] if len(out) >= n_in - 1 else out + [cells_in[-1]] * (n_in - 1 - len(out))


def leg_front_upper(m):
    pts = [(0.62, 1.40, 0.05, 0.06), (0.622, 1.2, 0.066, 0.08), (0.612, 1.06, 0.102, 0.126), (0.622, 0.9, 0.098, 0.112),
           (0.632, 0.75, 0.082, 0.09), (0.64, 0.635, 0.071, 0.073), (0.644, 0.57, 0.081, 0.079), (0.645, 0.5, 0.076, 0.075),
           (0.645, 0.455, 0.05, 0.05)]
    d = _dense(pts)
    _leg(m, d, _cells(len(d), [H_COAT] * 5 + [H_POINTS] * 3))


def leg_front_lower(m):
    pts = [(0.645, 0.565, 0.045, 0.045), (0.645, 0.535, 0.068, 0.066), (0.645, 0.5, 0.076, 0.075), (0.645, 0.445, 0.074, 0.072), (0.638, 0.4, 0.063, 0.071),
           (0.634, 0.3, 0.061, 0.071), (0.638, 0.235, 0.073, 0.085), (0.652, 0.18, 0.066, 0.071), (0.668, 0.135, 0.064, 0.065),
           (0.674, 0.108, 0.073, 0.07)]
    d = _dense(pts)
    _leg(m, d, _cells(len(d), [H_POINTS] * 9), cap1=False)
    hoof(m, 0.67)
    feather(m, 0.67, 0.26, -0.02, 1)


def leg_hind_upper(m):
    pts = [(-0.62, 1.38, 0.10, 0.16), (-0.63, 1.2, 0.13, 0.2), (-0.66, 1.03, 0.12, 0.19), (-0.70, 0.88, 0.1, 0.14),
           (-0.725, 0.75, 0.083, 0.106), (-0.745, 0.65, 0.082, 0.09), (-0.76, 0.58, 0.078, 0.082), (-0.765, 0.535, 0.05, 0.05)]
    d = _dense(pts)
    _leg(m, d, _cells(len(d), [H_COAT] * 5 + [H_POINTS] * 2))
    m.tube([HP(0, -0.79, 0.71), HP(0, -0.83, 0.645), HP(0, -0.835, 0.6)], [(0.03, 0.03), (0.034, 0.034), (0.018, 0.018)], 10,
           H_POINTS, side=(1, 0, 0), cap0=True, cap1=True, vscale=2)


def leg_hind_lower(m):
    pts = [(-0.762, 0.64, 0.045, 0.045), (-0.761, 0.61, 0.07, 0.074), (-0.76, 0.58, 0.078, 0.082), (-0.752, 0.51, 0.072, 0.082), (-0.735, 0.44, 0.062, 0.075),
           (-0.715, 0.32, 0.061, 0.073), (-0.703, 0.25, 0.073, 0.085), (-0.69, 0.185, 0.066, 0.071), (-0.678, 0.135, 0.064, 0.065),
           (-0.674, 0.108, 0.073, 0.07)]
    d = _dense(pts)
    _leg(m, d, _cells(len(d), [H_POINTS] * 9), cap1=False)
    hoof(m, -0.67)
    feather(m, -0.67, 0.27, -0.03, 2)


def hoof(m, f0):
    """build_props._hoof at more sides: horn sloping to the toe, the coronet high in front and low at the heels, the sole,
    the iron shoe open at the heels."""
    sides = 18

    def ring(h_front, h_back, hw, fr, bk, df):
        pts = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            c, s_ = math.cos(a), math.sin(a)
            y = -(f0 + df) + (bk if s_ > 0 else fr) * s_
            pts.append(Vector((hw * c, y, h_back + (h_front - h_back) * (0.5 - 0.5 * s_))))
        return pts

    bottom = ring(0.014, 0.014, 0.1, 0.112, 0.082, 0.004)
    rings = [bottom, ring(0.04, 0.026, 0.097, 0.103, 0.079, 0.001), ring(0.065, 0.038, 0.093, 0.092, 0.074, -0.002),
             ring(0.095, 0.05, 0.087, 0.08, 0.07, -0.005), ring(0.118, 0.058, 0.08, 0.07, 0.066, -0.008)]
    m.grid(rings, H_HOOF, urep=2, vscale=5)
    m.poly([p + Vector((0, 0, -0.002)) for p in bottom], H_HOOF, out=(0, 0, -1), shade=0.35)
    outer = ring(0.0, 0.0, 0.103, 0.116, 0.084, 0.004)
    inner = ring(0.0, 0.0, 0.07, 0.082, 0.054, 0.004)
    up = Vector((0, 0, 0.015))
    for i in range(sides):
        i1 = (i + 1) % sides
        am = 2 * math.pi * (i + 0.5) / sides
        if math.sin(am) > 0.8:
            continue
        o0, o1, n0, n1 = outer[i], outer[i1], inner[i], inner[i1]
        m.face([m.vert(o0), m.vert(n0), m.vert(n1), m.vert(o1)], [(0, 0), (0, 1), (1, 1), (1, 0)], H_IRON, 0.7)
        m.face([m.vert(o0 + up), m.vert(o1 + up), m.vert(n1 + up), m.vert(n0 + up)], [(0, 0), (0, 1), (1, 1), (1, 0)], H_IRON, 0.7)
        m.face([m.vert(o0), m.vert(o1), m.vert(o1 + up), m.vert(o0 + up)], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], H_IRON, 0.9)
        m.face([m.vert(n1), m.vert(n0), m.vert(n0 + up), m.vert(n1 + up)], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], H_IRON, 0.6)
        if math.sin(2 * math.pi * (i + 1) / sides) > 0.8 or math.sin(2 * math.pi * i / sides) > 0.8:
            # the open heel's ends
            e = n1 if math.sin(2 * math.pi * (i + 1.5) / sides) > 0.8 else n0
            o = o1 if e is n1 else o0
            m.face([m.vert(o), m.vert(e), m.vert(e + up), m.vert(o + up)], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], H_IRON, 0.6)


def feather(m, f0, top_h, fa, seed):
    """The feather: long hair from the fetlock falling over the pastern and the hoof's heel, fullest behind, its lower
    edge ragged in locks."""
    sides = 24

    def ring(h, hw, fr, bk, df, jag=0.0):
        pts = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            c, s_ = math.cos(a), math.sin(a)
            y = -(f0 + df) + (bk if s_ > 0 else fr) * s_
            lock = jag * (0.5 + 0.5 * math.sin(i * 2.4 + seed * 1.7) * math.cos(i * 0.9 + seed))
            hh = h + lock + (0.02 if s_ < -0.5 else 0.0) - 0.015 * max(0.0, s_)
            pts.append(Vector((hw * c, y, hh)))
        return pts

    rings = [ring(0.04, 0.086, 0.072, 0.124, fa - 0.032, 0.035), ring(0.075, 0.087, 0.073, 0.118, fa - 0.03, 0.015),
             ring(0.15, 0.08, 0.07, 0.1, fa - 0.02), ring(0.21, 0.075, 0.068, 0.088, fa - 0.012), ring(top_h, 0.07, 0.066, 0.08, fa - 0.008)]
    m.grid(rings, H_MANE, urep=3, vscale=4)
    # the inside of the feather's hem (it is hair all through, not a paper skirt)
    inner = [[p + (Vector((0, -(f0 + fa), p.z)) - p) * 0.12 for p in r] for r in rings[:2]]
    m.grid([rings[0], inner[0]], H_MANE, urep=3, vscale=4)


LEGS = {"leg_front": ("front", False, leg_front_upper), "leg_front_lo": ("front", True, leg_front_lower),
        "leg_hind": ("hind", False, leg_hind_upper), "leg_hind_lo": ("hind", True, leg_hind_lower)}


# ---------------------------------------------------------------- the parts

def pivots():
    """Each part's pivot (Blender, the horse's frame)."""
    out = {"body": Vector((0, 0, 0)), "neck": HP(0, *NECK_PIVOT), "head": HP(0, *HEAD_PIVOT), "ear_l": HP(*EAR_BASE),
           "ear_r": HP(-EAR_BASE[0], EAR_BASE[1], EAR_BASE[2]), "tail": HP(0, *TAIL_PIVOT), "rein": Vector((0, 0, 0)), "trace": Vector((0, 0, 0))}
    for name, (key, lower, _fn) in LEGS.items():
        f0, h0 = HORSE_RIG[key]["joint" if lower else "pivot"]
        out[name] = HP(0, f0, h0)
    return out


def build_part(name):
    """The part's Mesh (build_props.Mesh with the team cells), built where it sits on the standing horse."""
    m = Mesh(ao=0.0, atlas=True)
    if name == "body":
        hide_body(m)
        pad(m)
        reins_back(m)
    elif name == "neck":
        hide_neck(m)
        mane(m)
        collar(m)
    elif name == "head":
        hide_head(m)
        forelock(m)
        bridle(m)
    elif name in ("ear_l", "ear_r"):
        ear(m, 1 if name == "ear_l" else -1)
    elif name == "tail":
        tail(m)
    elif name in ("rein", "trace"):
        strap(m, name)
    elif name in LEGS:
        key, lower, fn = LEGS[name]
        fn(m)
    return m


PARTS = ["body", "neck", "head", "ear_l", "ear_r", "tail", "leg_front", "leg_front_lo", "leg_hind", "leg_hind_lo", "rein", "trace"]


def to_object(m, name, pivot):
    """The Mesh as a Blender object: a face attribute "region" (an index into REGIONS) from its team cell, vertices
    split where two regions meet, the origin moved to the pivot."""
    bm = m.bm
    cell = bm.loops.layers.uv.get("Cell")
    reg = []
    for f in bm.faces:
        c = f.loops[0][cell].uv
        k = int(round(c[0])) + 4 * int(round(c[1]))
        reg.append(REGIONS.index(REGION[BP.TEAM_CELLS[k]]))
    bm.faces.ensure_lookup_table()
    split = [e for e in bm.edges if len(e.link_faces) == 2 and reg[e.link_faces[0].index] != reg[e.link_faces[1].index]]
    layer = bm.faces.layers.int.new("region")
    for f, r in zip(bm.faces, reg):
        f[layer] = r
    if split:
        bmesh.ops.split_edges(bm, edges=split)
    for v in bm.verts:
        v.co -= pivot
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = pivot
    # the team cells' uv sets go: the picture has its own unwrap
    for uv in list(me.uv_layers):
        if uv.name == "Cell":
            me.uv_layers.remove(uv)
    return ob


def regions_of(ob):
    at = ob.data.attributes["region"]
    return [REGIONS[d.value] for d in at.data]


def points():
    """Where the game hangs things on the horse, in each part's own frame (game axes, metres)."""
    pv = pivots()

    def on(part, p):
        return G(Vector(p) - pv[part])
    out = {"breath": on("head", head_pt(1.0, -math.pi / 2, 0.0) + HP(0, 0.03, 0.0))}
    for sx, s in ((1, "L"), (-1, "R")):
        out["bit" + s] = on("head", bit_ring(sx))
        out["terret" + s] = on("neck", hame_terret(sx))
        out["trace" + s] = on("neck", HP(sx * TRACE_END[0], TRACE_END[1], TRACE_END[2]) + Vector((sx * 0.006, -0.02, 0)))
        out["tug" + s] = on("body", HP(sx * SHAFT_TUG[0], SHAFT_TUG[1], SHAFT_TUG[2]))
    out["kidney"] = on("neck", HP(*KIDNEY))
    return out

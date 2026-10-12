"""The lock of the Petit Bassin (Bonapartedok), 1873: its mitre gates and the lock's works, by script.

    blender -b --factory-startup -P tools/blender/build_lock.py
    blender -b --factory-startup -P tools/blender/build_lock.py -- --preview
    blender -b --factory-startup -P tools/blender/build_lock.py -- --closeups data/shots/lock

Writes client/public/models/lock.glb (Draco). The lock of 1811 had wooden mitre gates
("puntdeuren") hinged at the quay walls, closing at an obtuse angle of about 150 degrees,
opened and shut with capstans and chains, and a bridge over the lock turned by hand
(Inventaris Onroerend Erfgoed, Bonapartesluis). The bridge is now a lifting bridge
(build_bridges.py). Our own models, built from code; the materials are the boat atlas's
(tools/blender/boats/common.py, B0): the game draws every part of this file from that atlas.

D6, 2026-10-11 (Steve: "make docks look way better"): every part in high detail. A gate leaf is
framed as the oak gates of the period were: a round heel post turning in a hollow quoin, a mitre
post, horizontal rails on the low-water face, planking on the high-water face, an iron tie from
the heel's head to the mitre's foot, two paddles low in the leaf with their racks and winches on
the walkway, a planked walkway with an iron hand rail, and the balance beam strapped with iron.

Objects (origin on the quay top, y = 0 in the game; +X in Blender is +x in the game):
  gate_leaf       one leaf of a mitre gate: origin on the heel post axis, the leaf along +X
                  (6.0 m), walkway top at +0.43, the balance beam back along -X over the quay
                  (5.6 m, its top at 1.18: world/lock.ts BEAM_LEN and the colliders' top 1.25).
                  Its high-water face (planked, the paddles) is Blender -Y: the west leaves.
  gate_leaf_east  the same leaf mirrored (its high-water face +Y): the east leaves. The game names
                  both "gate_leaf" (godot/src/Movers/Lock.cs finds the leaves by that name).
  gate_capstan    the cast-iron capstan that works a leaf by its chain, on a bluestone base
  lock_quoin      the hollow quoin at a heel post: wall face at x = 0 (the chamber +X), the heel
                  axis at (0.3, 0), the pier downstream (-Y; on the east wall, turned 180 degrees,
                  that is toward the river); bluestone quoins, the anchor strap that holds the heel
                  post's head, and the chain sheave in the coping
  lock_quoin_w    the same mirrored (its pier at +Y), for the west wall
  lock_gear       the gear of a culvert sluice on the quay: a cast-iron standard, rack and wheel
  lock_hut        the lock-keeper's hut: boarded, a window on the lock (+X), its door at -Y,
                  a real room inside (desk, stool, stove, shelf), seen through its windows
  lock_gauge      a tide gauge on a wall face (x = 0, out +X): painted board, black marks every
                  decimetre, red figures each metre over the sill (-6.2)
  lock_fender     an oak rubbing post on a wall face, strapped and bolted
  lock_chain      a grab chain hung in a festoon between two wall eyes (3 m along +Y)
  lock_dolphin    a cluster of three piles bound with chain, at a mouth of the lock (origin on
                  the quay level over its centre)
  lock_buoy       a riveted iron mooring buoy (origin on its waterline) with its chain

--preview renders data/shots/lock_preview.png; --closeups <dir> one close picture of each part.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402
from build_boats import (BOARDS, DARK, DECK, GLASS, IRON, IRONHULL, REDLEAD, RIG, STONE, TAR, TARWEED, WHITE,  # noqa: E402
                         WINDOW, WOOD, Mesh, V, rig, to_object)

OUT = os.path.join(bb.ROOT, "client", "public", "models", "lock.glb")
SHOT = os.path.join(bb.ROOT, "data", "shots", "lock_preview.png")

GATE_LEN = 6.0
RAIL_GAUGE, RAIL_W, RAIL_H = 1.435, 0.075, 0.035  # as client/src/world/tracks.ts (build_bridges.py reads these)
SILL = -6.2  # the gauge's zero: the lock's sill

# ------------------------------------------------------------------ small parts


def rot(a, axis="Z"):
    return Matrix.Rotation(a, 4, axis)


FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}


def box_up(m, c, size, mat, tile=1.0, shade=1.0, u_up=True, along_tile=None):
    """A box whose side faces are mapped in metres with u up the face (upright boards: the picture's boards run
    along u) or across it; top and bottom as box() maps them. box() maps u along a face's longest edge, so a wall
    cut round a window would turn its boards from piece to piece."""
    cx, cy, cz = c
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    P = [Vector((cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz))) for i in range(8)]
    vs = [m.vert(p) for p in P]
    for key, idx in FACES.items():
        pts = [P[i] for i in idx]
        if key in ("-z", "+z"):
            uvs = [(p.x / tile, p.y / tile) for p in pts]
        else:
            along = (lambda p: p.y) if key[1] == "x" else (lambda p: p.x)
            ut = along_tile or tile  # (metres a picture along the boards: long, so no butt joint falls on a short wall)
            uvs = [((p.z / ut, along(p) / tile) if u_up else (along(p) / ut, p.z / tile)) for p in pts]
        m.face([vs[i] for i in idx], uvs, mat, shade, local=pts)


def bolt(m, p, n, r=0.032, h=0.025):
    """A square bolt head with its washer, on a face looking along n (an axis: +-X, +-Y, +-Z)."""
    n = Vector(n)
    s = [abs(n.x), abs(n.y), abs(n.z)]
    w = [2 * r if k < 0.5 else h for k in s]
    m.box(tuple(Vector(p) + n * (h / 2)), tuple(w), IRON, shade=0.8)


def weed_tint(top=-0.9, deep=-5.0):
    """Green-black slime and weed below `top` (the water's range), wet and darker toward the foot."""
    def f(p):
        if p.z > top + 0.25:
            return (1.0, 1.0, 1.0)
        t = bb.sm((top + 0.25 - p.z) / 0.5)
        d = bb.cl((top - p.z) / max(0.1, top - deep))
        k = 1.0 - 0.35 * d
        return ((1 - 0.25 * t) * k, (1 - 0.08 * t) * k, (1 - 0.35 * t) * k)
    return f


def iron_link(m, c, along, flat, pitch=0.1):
    """One chain link: an oval ring of round bar, `along` its long axis, `flat` the axis it lies across."""
    a, f = Vector(along).normalized(), Vector(flat).normalized()
    pts = []
    for k in range(6):
        t = 2 * math.pi * k / 6
        pts.append(Vector(c) + a * (0.62 * pitch * math.cos(t)) + f * (0.34 * pitch * math.sin(t)))
    m.tube(pts, [0.016] * 6, 3, IRON, side=tuple(a.cross(f)), closed_path=True, smooth=False)


def chain(m, pts, pitch=0.1):
    """A chain along a polyline: links every pitch, turned 90 degrees one to the next."""
    pts = [Vector(p) for p in pts]
    seg = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum((b - a).length for a, b in seg)
    n = max(2, int(total / pitch))
    k = 0
    for i in range(n):
        s = (i + 0.5) / n * total
        for a, b in seg:
            L = (b - a).length
            if s <= L or (a, b) == seg[-1]:
                d = (b - a).normalized()
                c = a + d * min(s, L)
                side = d.cross(Vector((0, 0, 1)))
                if side.length < 1e-3:
                    side = Vector((1, 0, 0))
                side.normalize()
                up = side.cross(d)
                iron_link(m, c, d, side if k % 2 else up, pitch)
                k += 1
                break
            s -= L


def sag(a, b, drop, n=12):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, drop * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


def eye(m, p, out):
    """A wall eye: a round plate let into the stone, a staple and a ring hanging from it."""
    o = Vector(out).normalized()
    up = Vector((0, 0, 1))
    side = up.cross(o)
    m.box(tuple(Vector(p) + o * 0.01), (0.02 + 0.14 * abs(side.x), 0.02 + 0.14 * abs(side.y), 0.14), IRON, shade=0.7)
    pts = [Vector(p) + o * (0.03 + 0.05 * math.cos(t)) + side * (0.0) + up * (-0.07 + 0.07 * math.sin(t))
           for t in [2 * math.pi * k / 8 for k in range(8)]]
    m.tube(pts, [0.014] * 8, 3, IRON, side=tuple(side), closed_path=True, smooth=False)


# ------------------------------------------------------------------ the gate leaf


def gate_leaf(east=False):
    """One leaf: built with its high-water face to -Y (the west leaves), mirrored for the east ones."""
    m = Mesh(ao=0.0)
    L, T = GATE_LEN, 0.45
    TOP, FOOT = 0.35, -6.05
    hi, lo = -1, 1  # the high-water face (planked) at -Y, the low-water face (framed) at +Y
    m.tintfn = weed_tint(-0.9, -5.2)
    m.shadefn = lambda p: 0.62 + 0.38 * bb.sm((p.z + 3.5) / 3.7)
    # the leaf's body: the planking on the high-water face, the backing between the rails on the other
    for z0, z1, mat in ((-1.1, TOP, TAR), (FOOT, -1.1, TARWEED)):
        m.box((L / 2, 0, (z0 + z1) / 2), (L - 0.5, T, z1 - z0), mat, tile=2.0, skip=("-z",) if z0 > FOOT else ())
    # the planks' edges stand a hair proud on the high-water face (the tar picture has the seams)
    # rails (horizontal oak waling pieces) on the low-water face: closer toward the foot, where the head is greatest
    rails = [0.12, -0.78, -1.6, -2.38, -3.1, -3.78, -4.42, -5.02, -5.6]
    for z in rails:
        mat = DARK if z > -1.0 else TARWEED
        m.box((L / 2, lo * (T / 2 + 0.07), z), (L - 0.42, 0.14, 0.24), mat, tile=1.2)
        for x in (0.42, 0.75, L - 0.75, L - 0.42):
            bolt(m, (x, lo * (T / 2 + 0.14), z), (0, lo, 0))
    # two stiles between the rails
    for x in (L / 3, 2 * L / 3):
        for z0, z1 in zip(rails[1:], rails):
            mat = DARK if z0 > -1.0 else TARWEED
            m.box((x, lo * (T / 2 + 0.05), (z0 + z1) / 2), (0.16, 0.1, z1 - z0 - 0.24), mat, tile=1.2)
    # the iron tie from the heel's head to the mitre's foot (keeps the toe from dropping), on both faces
    for sy in (lo, hi):
        y = sy * (T / 2 + (0.155 if sy == lo else 0.012))
        m.beam((0.35, y, 0.05), (L - 0.35, y, -5.55), 0.13, 0.018, IRON, side=(0, 1, 0), shade=0.75)
        for t in (0.08, 0.5, 0.92):
            p = Vector((0.35, y, 0.05)).lerp(Vector((L - 0.35, y, -5.55)), t)
            bolt(m, p, (0, sy, 0), r=0.04)
    # heel post: round oak, turning in the hollow quoin; iron hoops; its head a journal for the anchor strap
    m.lathe([(0.27, FOOT - 0.05), (0.27, 0.34), (0.2, 0.36), (0.17, 0.38), (0.17, 0.66), (0.13, 0.7)], 16, DARK,
            cap0=True, cap1=True, urep=2)
    for z in (-5.7, -3.0, -0.4, 0.22):
        m.lathe([(0.278, z - 0.05), (0.282, z - 0.04), (0.282, z + 0.04), (0.278, z + 0.05)], 16, IRON, smooth=False, urep=2)
    # mitre post: squared, its meeting face bevelled; its top slopes 4 cm so the two leaves' posts meeting in the
    # middle do not lay their tops in one plane (z-fight check)
    m.hexa([(L + (0.25 if i & 1 else -0.25), 0.275 if i & 2 else -0.275, (0.7 + (0.02 if i & 1 else -0.02)) if i & 4 else FOOT + 0.45)
            for i in range(8)], DARK)
    for z in (-5.3, -3.0, -0.6, 0.45):
        m.box((L, 0, z), (0.52, 0.565, 0.09), IRON, shade=0.7)
    # the oak clapping piece on the mitre face, where the leaves meet
    m.box((L + 0.27, 0, -2.6), (0.05, 0.3, 6.2), DARK, shade=0.8)
    # paddles: two openings low in the leaf, shut by iron doors that slide in guides on the high-water face,
    # each lifted by a rack to a winch on the walkway
    yh = hi * (T / 2)
    for px in (1.75, 4.2):
        m.box((px, yh + hi * 0.03, -4.55), (1.0, 0.06, 0.9), IRON, shade=0.55)  # the frame
        m.box((px, yh + hi * 0.07, -4.4), (0.8, 0.05, 0.8), IRONHULL, shade=0.6)  # the door (raised a little)
        for sx in (-1, 1):
            m.box((px + sx * 0.47, yh + hi * 0.07, -3.0), (0.06, 0.08, 3.9), IRON, shade=0.6)  # guides
        for k in range(4):
            bolt(m, (px - 0.3 + 0.2 * k, yh + hi * 0.1, -4.12), (0, hi, 0), r=0.025)
        # the rack rod up to the walkway, its teeth as a strip on its side
        m.box((px, yh + hi * 0.1, -1.6), (0.06, 0.05, 5.6), IRON, shade=0.7)
        m.box((px + 0.04, yh + hi * 0.1, -0.2), (0.025, 0.04, 2.6), IRON, shade=0.5)
        # the winch: two cast cheeks on the walkway, the pinion's shaft, a crank and a pawl
        wy = hi * 0.24
        for sx in (-1, 1):
            m.hexa([(px + sx * 0.09 + (0.012 if i & 1 else -0.012), wy + (0.11 if i & 2 else -0.11), 0.43 if not i & 4 else 0.86)
                    for i in range(8)], IRON, shade=0.8)
        with m.at(bb.move(px, wy, 0.8) @ rot(math.pi / 2, "Y")):
            m.lathe([(0.1, -0.06), (0.1, 0.06)], 12, IRON, cap0=True, cap1=True, smooth=False)  # the pinion
            m.lathe([(0.025, -0.2), (0.025, 0.2)], 6, IRON, cap0=True, cap1=True, smooth=False)  # the shaft
        m.beam((px + 0.2, wy, 0.8), (px + 0.2, wy + hi * 0.3, 0.98), 0.04, 0.03, IRON, shade=0.7)  # crank arm
        m.beam((px + 0.2, wy + hi * 0.3, 0.98), (px + 0.36, wy + hi * 0.3, 0.98), 0.035, 0.035, WOOD)  # its handle
        m.box((px - 0.13, wy, 0.9), (0.04, 0.03, 0.18), IRON, shade=0.6)  # the pawl
    # walkway: planks on bearers that stand out past both faces, an iron hand rail on the low-water side
    for k in range(4):
        y = -0.27 + 0.18 * k
        m.box((L / 2, y, 0.405), (L + 0.3, 0.165, 0.05), DECK, tile=1.6)
    for x in [0.2 + i * (L - 0.4) / 6 for i in range(7)]:
        m.box((x, 0, 0.36), (0.12, 0.78, 0.06), DARK, shade=0.7)
    ry = lo * 0.33
    posts = [0.35 + i * (L - 0.6) / 4 for i in range(5)]
    for x in posts:
        m.box((x, ry, 0.44), (0.12, 0.08, 0.02), IRON, shade=0.7)  # its foot plate
        with m.at(bb.move(x, ry, 0)):
            m.lathe([(0.03, 0.43), (0.022, 0.5), (0.02, 1.38), (0.035, 1.42), (0.025, 1.46)], 8, IRON, smooth=True)
    m.tube([V(posts[0], ry, 1.42), V(posts[-1], ry, 1.42)], [0.024, 0.024], 6, IRON, side=(0, 0, 1), cap0=True, cap1=True)
    m.tube([V(posts[0], ry, 0.92), V(posts[-1], ry, 0.92)], [0.016, 0.016], 6, IRON, side=(0, 0, 1), cap0=True, cap1=True)
    # balance beam back over the quay: a heavy oak baulk on a block beside the heel post (the post's head stays free
    # for the anchor strap), iron straps round it, an iron shoe and a hand hold at its end
    m.box((0.55, 0, 0.62), (0.5, 0.42, 0.4), DARK)
    m.beam((0.75, 0, 1.0), (-5.6, 0, 0.92), 0.4, 0.35, DARK, w2=0.3, h2=0.28, side=(0, 1, 0))
    for x, w, h in ((0.45, 0.42, 0.37), (-1.2, 0.39, 0.345), (-3.0, 0.355, 0.32), (-4.8, 0.32, 0.295)):
        z = 1.0 + (x - 0.75) / (-6.35) * -0.08
        m.box((x, 0, z), (0.07, w + 0.02, h + 0.02), IRON, shade=0.75)
    m.box((-5.35, 0, 0.92), (0.5, 0.33, 0.31), IRON, shade=0.65)  # the shoe
    for sy in (1, -1):
        m.beam((-4.4, sy * 0.18, 0.92), (-4.4, sy * 0.26, 0.92), 0.035, 0.035, IRON)
        m.beam((-4.9, sy * 0.18, 0.92), (-4.9, sy * 0.26, 0.92), 0.035, 0.035, IRON)
        m.beam((-4.4, sy * 0.26, 0.92), (-4.9, sy * 0.26, 0.92), 0.035, 0.035, IRON)
    # the knee: an iron strap from the beam down the heel block to the top rail, bolted
    for sy in (1, -1):
        m.beam((0.2, sy * 0.21, 1.02), (0.95, sy * 0.24, 0.2), 0.08, 0.015, IRON, side=(0, 1, 0), shade=0.7)
    # the leaf's chain to the wall sheave (the capstan's chain, world/lock.ts draws it as a line)
    rig(m, (L * 0.45, lo * 0.3, 0.2), (L * 0.12, lo * 1.5, -0.05), r=0.03)
    if east:
        mirror_y(m)
    return m


def mirrored(m):
    mirror_y(m)
    return m


def mirror_y(m):
    """Mirror a finished mesh across its XZ plane (y -> -y), the faces turned back outward."""
    bmesh.ops.transform(m.bm, matrix=Matrix.Diagonal((1, -1, 1, 1)), verts=m.bm.verts)
    bmesh.ops.reverse_faces(m.bm, faces=m.bm.faces)
    m.lines = [(Vector((a.x, -a.y, a.z)), Vector((b.x, -b.y, b.z))) for a, b in m.lines]


# ------------------------------------------------------------------ the quay's works


def gate_capstan():
    """A cast-iron capstan on a bluestone base: a pawl ring at its foot, a waisted barrel, a head with four
    sockets and its oak bars shipped, the chain wound three times round the barrel."""
    m = Mesh(ao=0.0)
    m.box((0, 0, -0.06), (1.1, 1.1, 0.16), STONE, tile=1.0, shade=0.85)
    for sx in (-1, 1):
        for sy in (-1, 1):
            bolt(m, (sx * 0.42, sy * 0.42, 0.02), (0, 0, 1), r=0.035)
    m.lathe([(0.44, 0.02), (0.44, 0.1), (0.4, 0.12), (0.4, 0.16), (0.3, 0.18)], 24, IRON, cap1=False, smooth=True, urep=3)
    for k in range(12):  # the pawl ring's teeth
        a = 2 * math.pi * k / 12
        with m.at(bb.move(0.4 * math.cos(a), 0.4 * math.sin(a), 0.14) @ rot(a)):
            m.box((0.02, 0, 0), (0.06, 0.07, 0.05), IRON, shade=0.7)
    for k in range(3):  # three pawls on their pins
        a = 2 * math.pi * k / 3 + 0.3
        m.beam((0.5 * math.cos(a), 0.5 * math.sin(a), 0.16), (0.43 * math.cos(a + 0.35), 0.43 * math.sin(a + 0.35), 0.16), 0.05, 0.04, IRON)
    prof = [(0.3, 0.18), (0.24, 0.24), (0.2, 0.34), (0.18, 0.5), (0.2, 0.62), (0.24, 0.7), (0.32, 0.74), (0.32, 0.9),
            (0.26, 0.93), (0.12, 0.98), (0.06, 1.0)]
    m.lathe(prof, 24, IRON, cap1=True, smooth=True, urep=3)
    for k in range(8):  # the whelps of the barrel
        a = 2 * math.pi * k / 8
        with m.at(rot(a)):
            m.hexa([(0.18 + (0.03 if i & 1 else 0.0) + (0.02 if i & 4 and i & 1 else 0.0), 0.022 if i & 2 else -0.022,
                     0.34 if not i & 4 else 0.64) for i in range(8)], IRON, shade=0.85)
    # the bars, shipped in four of the head's sockets
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = V(math.cos(a), math.sin(a), 0)
        m.box(tuple(d * 0.3 + V(0, 0, 0.82)), (0.1 + 0.02, 0.1 + 0.02, 0.12), IRON, shade=0.6)
        m.beam(d * 0.3 + V(0, 0, 0.82), d * 1.55 + V(0, 0, 0.86), 0.075, 0.075, WOOD, side=(0, 0, 1), w2=0.06, h2=0.06)
    # the chain wound on the barrel, then off toward the wall (+X)
    pts = []
    for i in range(37):
        a = 2 * math.pi * 3 * i / 36
        pts.append(V(0.205 * math.cos(a), 0.205 * math.sin(a), 0.42 + 0.06 * i / 12))
    pts.append(V(0.5, 0.2, 0.3))
    pts.append(V(0.9, 0.24, 0.04))
    pts.append(V(1.6, 0.26, 0.03))
    chain(m, pts, pitch=0.085)
    return m


def lock_quoin():
    """The hollow quoin at a heel post (wall face x = 0, the chamber +X, upstream +Y, the heel axis at (0.3, 0)):
    a pier of bluestone quoins on the downstream side, its hollow round the post; the anchor strap that holds the
    post's head; the chain's sheave let into the coping. Upstream the leaf lies against the plain wall."""
    m = Mesh(ao=0.0)
    weed = weed_tint(-0.9, -5.6)
    m.tintfn = lambda p: tuple(a * b for a, b in zip(weed(p), (0.84, 0.9, 0.98)))  # bluestone: grey with blue in it
    R, AX = 0.31, 0.3
    beds = [-0.3, -0.72, -1.14, -1.54, -1.96, -2.36, -2.8, -3.2, -3.62, -4.02, -4.44, -4.84, -5.26, -5.66, -6.06, -6.45]

    W = 1.3  # the pier's length along the wall, downstream of the post

    def outline(y0, y1, nose):
        """A stone of a course between y0 > y1 (downstream): with `nose`, the one round the post's hollow."""
        if nose:
            pts = [V(0, 0.0, 0)]
            for k in range(1, 7):
                a = math.pi + (math.pi / 2) * k / 6
                pts.append(V(AX + R * math.cos(a), R * math.sin(a), 0))
            pts += [V(0.34, -R, 0), V(0.34, y1 + 0.006, 0), V(0, y1 + 0.006, 0)]
            return pts
        end = y1 <= -W + 1e-6
        pts = [V(0, y0 - 0.006, 0), V(0.34, y0 - 0.006, 0)]
        pts += [V(0.34, y1 + 0.05, 0), V(0.29, y1, 0)] if end else [V(0.34, y1 + 0.006, 0)]
        pts.append(V(0, y1 + (0.0 if end else 0.006), 0))
        return pts

    for k, (z1, z0) in enumerate(zip(beds, beds[1:])):
        joint = -0.62 if k % 2 == 0 else -0.92
        tone = 0.92 - 0.05 * (k % 3)
        with m.at(bb.move(0, 0, z0 + 0.008)):
            m.prism(outline(0.0, joint, True), (0, 0, z1 - z0 - 0.016), STONE, tile=1.4, shade=tone)
            m.prism(outline(joint, -W, False), (0, 0, z1 - z0 - 0.016), STONE, tile=1.4, shade=tone + 0.03 * ((k + 1) % 2))
        # the lime joint behind the stones, a hair back
        with m.at(bb.move(-0.012, 0, z0 - 0.008)):
            m.prism([V(0, -0.05, 0), V(0.33, -0.33, 0), V(0.33, -W + 0.05, 0), V(0, -W + 0.05, 0)], (0, 0, 0.016), STONE, shade=0.5)
        for jy in (joint,):
            m.box((0.33, jy, (z0 + z1) / 2), (0.02, 0.012, z1 - z0 - 0.02), STONE, shade=0.45)
    # the anchor strap: a collar round the post's head, two arms back into the quay to a plate with its bolts
    with m.at(bb.move(AX, 0, 0.45)):
        m.lathe([(0.19, 0.0), (0.24, 0.0), (0.24, 0.1), (0.19, 0.1)], 16, IRON, closed_v=True, smooth=False)
    for sy in (1, -1):
        a = V(AX - 0.2, sy * 0.13, 0.5)
        b = V(-1.25, sy * 0.55, 0.03)
        m.beam(a, b, 0.12, 0.035, IRON, side=(0, 0, 1), shade=0.75)
        m.beam(b, b + V(-0.25, 0, -0.005), 0.12, 0.03, IRON, side=(0, 0, 1), shade=0.7)
    m.box((-1.4, 0, 0.012), (0.42, 1.4, 0.03), IRON, shade=0.6)
    for sx in (-1.55, -1.25):
        for sy in (-0.55, 0.0, 0.55):
            bolt(m, (sx, sy, 0.03), (0, 0, 1), r=0.035)
    # the chain's sheave in a cast box let into the coping, downstream of the heel
    m.box((0.05, -1.25, 0.015), (0.5, 0.42, 0.03), IRON, shade=0.55)
    with m.at(bb.move(0.12, -1.25, 0.06) @ rot(math.pi / 2, "X")):
        m.lathe([(0.12, -0.03), (0.12, 0.03)], 12, IRON, cap0=True, cap1=True, smooth=False)
    return m


def lock_gear():
    """The gear of a culvert sluice: a cast-iron standard on a stone slab over the culvert, the rack rod rising
    through it (the sluice half open), a pinion turned by a spoked hand wheel, a pawl, a cast plate."""
    m = Mesh(ao=0.0)
    m.box((0, 0, 0.02), (0.9, 0.7, 0.06), STONE, tile=1.0, shade=0.8)
    m.box((0, 0, 0.055), (0.62, 0.46, 0.03), IRON, shade=0.55)
    for sx in (-1, 1):
        for sy in (-1, 1):
            bolt(m, (sx * 0.26, sy * 0.18, 0.07), (0, 0, 1), r=0.03)
    # the standard: a fluted column with a base and a capital carrying the bearing cheeks
    m.lathe([(0.2, 0.07), (0.2, 0.12), (0.15, 0.16), (0.11, 0.24), (0.095, 0.8), (0.12, 0.84), (0.16, 0.9), (0.16, 0.94)],
            16, IRON, cap1=True, smooth=True, urep=2)
    for k in range(8):
        a = 2 * math.pi * k / 8
        with m.at(rot(a)):
            m.box((0.1, 0, 0.52), (0.02, 0.025, 0.54), IRON, shade=0.7)
    for sy in (-1, 1):
        m.hexa([(0.18 if i & 1 else -0.18, sy * 0.1 + (0.02 if i & 2 else -0.02), 0.94 if not i & 4 else 1.12) for i in range(8)], IRON, shade=0.8)
    # the rack rod and its teeth, the sluice half up
    m.box((0, 0, 1.15), (0.07, 0.06, 1.0), IRON, shade=0.7)
    m.box((0.045, 0, 1.2), (0.025, 0.05, 0.85), IRON, shade=0.5)
    m.box((0, 0, 1.67), (0.11, 0.1, 0.05), IRON, shade=0.6)
    # the pinion's shaft through the cheeks, the hand wheel on it (out along -X)
    with m.at(bb.move(0, 0, 1.05) @ rot(math.pi / 2, "Y")):
        m.lathe([(0.03, -0.42), (0.03, 0.2)], 8, IRON, cap0=True, cap1=True, smooth=False)
        m.lathe([(0.08, -0.04), (0.08, 0.04)], 12, IRON, cap0=True, cap1=True, smooth=False)
    with m.at(bb.move(-0.36, 0, 1.05) @ rot(math.pi / 2, "Y")):
        ring = [V(0.34 * math.cos(2 * math.pi * k / 20), 0.34 * math.sin(2 * math.pi * k / 20), 0) for k in range(20)]
        m.tube(ring, [0.022] * 20, 6, IRON, side=(0, 0, 1), closed_path=True)
        m.lathe([(0.06, -0.05), (0.06, 0.05)], 10, IRON, cap0=True, cap1=True, smooth=False)
        for k in range(6):
            a = 2 * math.pi * k / 6
            m.beam(V(0.05 * math.cos(a), 0.05 * math.sin(a), 0), V(0.33 * math.cos(a), 0.33 * math.sin(a), 0), 0.03, 0.02, IRON, shade=0.8)
        m.beam(V(0.0, 0.34, 0.0), V(0.0, 0.34, -0.12), 0.03, 0.03, WOOD)  # a turning handle on the rim
    m.beam((0.12, 0.13, 1.08), (0.03, 0.13, 1.02), 0.03, 0.025, IRON, shade=0.6)  # the pawl
    # the maker's plate on the column
    m.box((0.0, -0.105, 0.62), (0.14, 0.012, 0.1), IRON, shade=0.95)
    return m


def lock_hut():
    """The lock-keeper's hut: 2.6 m (X) by 2.3 m, upright boards on a stone plinth, a roof of tarred boards with
    battens and white barge boards; the front (+X) looks on the lock through a wide window, the door at -Y, a small
    window at +Y. Inside a real room, darker than the street: the keeper's desk under the window with his ledger and
    the tide table, a stool, a stove and its pipe through the roof, a shelf, a coat on its peg. A bell on a bracket
    by the door. The windows are open sashes with their bars (no glass in the atlas lets the room show)."""
    m = Mesh(ao=0.0)
    HX, HY, Z0, Z1, RIDGE, Tw = 1.3, 1.15, 0.22, 2.45, 3.25, 0.06
    inner = lambda p: abs(p.x) < HX - Tw + 0.005 and abs(p.y) < HY - Tw + 0.005 and Z0 - 0.01 < p.z < Z1 + 0.6
    m.shadefn = lambda p: 0.5 if inner(p) else 1.0
    # plinth and floor
    m.box((0, 0, Z0 / 2), (2 * HX + 0.1, 2 * HY + 0.1, Z0), STONE, tile=1.0, shade=0.8)
    m.box((0, 0, Z0 + 0.02), (2 * HX - 2 * Tw, 2 * HY - 2 * Tw, 0.04), DECK, tile=1.2)

    def wall(axis, sign, holes):
        """One wall (normal along `axis` = "x" or "y", on side `sign`), boards round its openings: holes are
        (a0, a1, z0, z1) along the wall."""
        span = HY if axis == "x" else HX
        cuts_a = sorted({-span, span, *[h[0] for h in holes], *[h[1] for h in holes]})
        for a0, a1 in zip(cuts_a, cuts_a[1:]):
            zs = [(Z0, Z1)]
            for h in holes:
                if h[0] <= a0 + 1e-6 and a1 <= h[1] + 1e-6:
                    zs = [(Z0, h[2]), (h[3], Z1)]
            for z0, z1 in zs:
                if z1 - z0 < 1e-3:
                    continue
                c = (a0 + a1) / 2
                if axis == "x":
                    box_up(m, (sign * (HX - Tw / 2), c, (z0 + z1) / 2), (Tw, a1 - a0, z1 - z0), BOARDS, tile=0.8, along_tile=5.0)
                else:
                    box_up(m, (c, sign * (HY - Tw / 2), (z0 + z1) / 2), (a1 - a0, Tw, z1 - z0), BOARDS, tile=0.8, along_tile=5.0)

    def sash(axis, sign, a0, a1, z0, z1, bars=(2, 2)):
        """A window in a wall: white frame, sill, the sash's glazing bars, its reveal."""
        n = 1 if axis == "x" else 0
        def P(a, z, d):
            return V(sign * (HX + d), a, z) if axis == "x" else V(a, sign * (HY + d), z)
        def box(a, z, d, sa, sz, sd, mat=WHITE, shade=1.0):
            c = P(a, z, d)
            size = (sd, sa, sz) if n == 1 else (sa, sd, sz)
            m.box(tuple(c), size, mat, shade=shade)
        fw = 0.06
        box((a0 + a1) / 2, z1 + fw / 2, 0.0, a1 - a0 + 2 * fw, fw, 0.05)
        box((a0 + a1) / 2, z0 - 0.03, 0.03, a1 - a0 + 2 * fw + 0.06, 0.05, 0.1)  # the sill
        for a in (a0 - fw / 2, a1 + fw / 2):
            box(a, (z0 + z1) / 2, 0.0, fw, z1 - z0, 0.05)
        nu, nz = bars
        for i in range(1, nu):
            box(a0 + (a1 - a0) * i / nu, (z0 + z1) / 2, -Tw / 2, 0.03, z1 - z0, 0.03)
        for i in range(1, nz):
            box((a0 + a1) / 2, z0 + (z1 - z0) * i / nz, -Tw / 2, a1 - a0, 0.035, 0.03)
        # the meeting rail of the two sashes, a little heavier
        box((a0 + a1) / 2, (z0 + z1) / 2, -Tw / 2 + 0.01, a1 - a0, 0.05, 0.045)

    front = (-0.7, 0.7, 1.05, 1.95)
    side_w = (-0.35, 0.35, 1.2, 1.85)
    door = (-0.95, -0.15, Z0, 2.12)
    wall("x", 1, [front])
    wall("x", -1, [])
    wall("y", 1, [side_w])
    wall("y", -1, [door])
    sash("x", 1, *front, bars=(3, 2))
    sash("y", 1, *side_w, bars=(2, 2))
    # corner boards and a skirting board, white
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box((sx * (HX + 0.01), sy * (HY + 0.01), (Z0 + Z1) / 2), (0.1, 0.1, Z1 - Z0), WHITE, shade=0.95)
    # the door: ledged boards, a latch, its frame; shut
    d0, d1, dz1 = door[0], door[1], door[3]
    box_up(m, ((d0 + d1) / 2, -HY - 0.01, (Z0 + dz1) / 2), (d1 - d0, 0.05, dz1 - Z0), BOARDS, tile=1.2, shade=0.9)
    for z in (Z0 + 0.25, (Z0 + dz1) / 2, dz1 - 0.25):
        box_up(m, ((d0 + d1) / 2, -HY - 0.045, z), (d1 - d0 - 0.08, 0.025, 0.11), BOARDS, tile=1.2, shade=0.8, u_up=False)
    for a in (d0 - 0.03, d1 + 0.03):
        m.box((a, -HY - 0.01, (Z0 + dz1) / 2 + 0.03), (0.06, 0.06, dz1 - Z0 + 0.06), WHITE)
    m.box(((d0 + d1) / 2, -HY - 0.01, dz1 + 0.04), (d1 - d0 + 0.12, 0.06, 0.06), WHITE)
    m.box((d1 - 0.12, -HY - 0.065, 1.08), (0.12, 0.02, 0.03), IRON, shade=0.6)
    m.box((d1 - 0.07, -HY - 0.07, 1.02), (0.03, 0.03, 0.08), IRON, shade=0.6)
    m.box(((d0 + d1) / 2, -HY - 0.12, 0.2), (0.95, 0.3, 0.04), STONE, shade=0.75)  # the step
    # the roof: two slopes of tarred boards over the gables at +-X, battens down the slopes, white barge boards
    over = 0.18
    rz0 = Z1 - 0.02
    for sy in (1, -1):
        eave = V(0, sy * (HY + over), rz0 - over * (RIDGE - Z1) / HY)
        ridge = V(0, 0, RIDGE)
        n = Vector((0, sy * (RIDGE - Z1), HY)).normalized()
        quad = [eave + V(-HX - over, 0, 0), eave + V(HX + over, 0, 0), ridge + V(HX + over, 0, 0), ridge + V(-HX - over, 0, 0)]
        m.slab([p + n * 0.05 for p in quad], 0.05, TAR, n, tile=2.0, shade=0.85)
        for k in range(9):
            x = -HX - over + 0.1 + k * (2 * HX + 2 * over - 0.2) / 8
            m.beam(eave + V(x, 0, 0) + n * 0.07, ridge + V(x, 0, 0) + n * 0.07, 0.04, 0.03, TAR, side=(1, 0, 0), shade=0.7)
    m.beam((-HX - over, 0, RIDGE + 0.06), (HX + over, 0, RIDGE + 0.06), 0.14, 0.08, TAR, shade=0.75)
    # the gables: boards in the triangle, white barge boards along the slopes
    for sx in (1, -1):
        tri = [V(sx * (HX - Tw / 2), -HY, Z1), V(sx * (HX - Tw / 2), HY, Z1), V(sx * (HX - Tw / 2), 0, RIDGE - 0.02)]
        m.prism(tri, (sx * -Tw, 0, 0), BOARDS, tile=1.6)
        for sy in (1, -1):
            a = V(sx * (HX + over - 0.02), sy * (HY + over), rz0 - over * (RIDGE - Z1) / HY + 0.02)
            b = V(sx * (HX + over - 0.02), 0, RIDGE + 0.12)
            m.beam(a, b, 0.03, 0.17, WHITE, side=(1, 0, 0), shade=0.95)
    # the stovepipe through the roof at the back, a cowl
    with m.at(bb.move(-0.85, 0.7, 0)):
        m.lathe([(0.075, 1.6), (0.075, 3.75), (0.11, 3.78), (0.11, 3.86), (0.05, 3.95)], 10, IRON, cap1=True, smooth=True)
    # inside: the desk under the front window, the ledger open on it, the tide table on the wall, a stool, the
    # stove in the back corner, a shelf with books, a coat on its peg
    m.box((HX - Tw - 0.28, 0, 0.97), (0.55, 1.3, 0.05), WOOD, shade=0.8)
    for sy in (-1, 1):
        m.box((HX - Tw - 0.28, sy * 0.6, 0.6), (0.5, 0.05, 0.72), WOOD, shade=0.7)
    m.box((HX - Tw - 0.3, 0.1, 1.005), (0.3, 0.42, 0.02), WHITE, shade=0.9)  # the ledger
    m.box((HX - Tw - 0.3, 0.1, 1.012), (0.3, 0.012, 0.025), DARK)
    with m.at(bb.move(HX - Tw - 0.2, -0.35, 0)):
        m.lathe([(0.03, 0.995), (0.03, 1.04), (0.012, 1.055)], 8, GLASS, cap1=True, smooth=False)  # the inkpot
    m.box((HX - Tw - 0.005, -0.85, 1.55), (0.01, 0.38, 0.5), WHITE, shade=0.85)  # the tide table
    for k in range(7):
        m.box((HX - Tw - 0.012, -0.85, 1.75 - 0.065 * k), (0.004, 0.3, 0.015), DARK, shade=0.6)
    with m.at(bb.move(0.3, -0.1, 0)):
        m.lathe([(0.17, 0.62), (0.17, 0.66), (0.0, 0.66)], 10, WOOD, smooth=False)
        for k in range(3):
            a = 2 * math.pi * k / 3
            m.beam(V(0.13 * math.cos(a), 0.13 * math.sin(a), 0.62), V(0.2 * math.cos(a), 0.2 * math.sin(a), Z0 + 0.04), 0.03, 0.03, WOOD)
    with m.at(bb.move(-0.85, 0.7, 0)):
        m.lathe([(0.2, Z0 + 0.04), (0.2, Z0 + 0.12), (0.17, Z0 + 0.14), (0.17, 0.95), (0.21, 0.98), (0.21, 1.02), (0.075, 1.04)],
                12, IRON, cap1=True, smooth=True)
        m.box((0.18, 0, 0.55), (0.06, 0.16, 0.2), IRON, shade=0.5)  # its door
    m.box((-HX + Tw + 0.12, -0.4, 1.7), (0.24, 1.1, 0.03), WOOD, shade=0.75)  # the shelf
    for k in range(8):
        m.box((-HX + Tw + 0.12, -0.85 + 0.11 * k, 1.83), (0.18, 0.06 + 0.02 * (k % 3), 0.22 - 0.03 * (k % 2)),
              (REDLEAD, DARK, BOARDS, TAR)[k % 4], shade=0.7)
    m.box((-0.2, HY - Tw - 0.03, 1.7), (0.03, 0.06, 0.03), DARK)  # the peg and the keeper's coat
    m.box((-0.2, HY - Tw - 0.07, 1.25), (0.42, 0.05, 0.9), bb.TAN, shade=0.55)
    # outside: the keeper's bell on a bracket by the door, its pull hanging; a lantern bracket (unlit)
    with m.at(bb.move(-HX + 0.25, -HY - 0.02, 2.1)):
        m.beam(V(0, 0, 0), V(0, -0.35, 0), 0.03, 0.03, IRON)
        m.beam(V(0, 0, -0.25), V(0, -0.25, 0), 0.02, 0.02, IRON)
        m.lathe([(0.0, -0.3), (0.13, -0.3), (0.12, -0.24), (0.09, -0.12), (0.06, -0.06), (0.0, -0.04)], 12, bb.COPPER, smooth=True)
    rig(m, (-HX + 0.25, -HY - 0.37, 1.8), (-HX + 0.25, -HY - 0.37, 1.2), r=0.01)
    # a cork lifebuoy on its peg on the side toward the lock's mouth (+Y), painted in white and red quarters,
    # its grab line round it; a boat hook leaning by the front corner
    with m.at(bb.move(0.62, HY + 0.08, 1.45) @ rot(math.pi / 2, "X")):
        for k in range(8):
            arc = [V(0.25 * math.cos(2 * math.pi * (k + i / 4) / 8), 0.25 * math.sin(2 * math.pi * (k + i / 4) / 8), 0) for i in range(5)]
            m.tube(arc, [0.075] * 5, 8, WHITE if k % 2 == 0 else REDLEAD, side=(0, 0, 1))
        ring = [V(0.33 * math.cos(2 * math.pi * i / 16), 0.33 * math.sin(2 * math.pi * i / 16), 0.0) for i in range(16)]
        rig_ring = ring + ring[:1]
        for a_, b_ in zip(rig_ring, rig_ring[1:]):
            m.line(a_, b_)
    m.box((0.62, HY + 0.03, 1.72), (0.04, 0.06, 0.04), DARK)
    m.beam((HX - 0.05, HY + 0.12, Z0 + 0.02), (HX + 0.02, HY + 0.2, 2.6), 0.045, 0.045, WOOD)
    with m.at(bb.move(HX + 0.02, HY + 0.2, 2.6)):
        m.beam(V(0, 0, 0), V(0.0, 0.0, 0.14), 0.03, 0.03, IRON)
        m.beam(V(0, 0, 0.1), V(0.0, 0.12, 0.02), 0.025, 0.025, IRON)
    return m


def lock_gauge():
    """A tide gauge on a wall face (x = 0, out +X), from under the coping to the sill: a board painted white,
    a black spine, black marks every decimetre (long ones every half metre), the metres over the sill in red."""
    m = Mesh(ao=0.0)
    # kept clean enough to read: a little slime below half tide, no more
    m.tintfn = lambda p: (1.0, 1.0, 1.0) if p.z > -1.2 else (0.93, 0.97, 0.88)
    top, foot = -0.36, SILL
    W, D = 0.34, 0.035
    m.box((D / 2 + 0.02, 0, (top + foot) / 2), (D, W, top - foot), WHITE, tile=1.6, shade=1.0)
    for z in (top - 0.15, -2.4, -4.4, foot + 0.2):
        m.box((0.01, 0, z), (0.02, W + 0.08, 0.06), IRON, shade=0.6)
        for sy in (-1, 1):
            bolt(m, (D + 0.02, sy * (W / 2 + 0.025), z), (1, 0, 0), r=0.018)
    x = D + 0.022
    m.box((x, -W / 2 + 0.03, (top + foot) / 2), (0.004, 0.035, top - foot - 0.02), TAR, shade=0.35)
    n = int(round((top - foot) / 0.1))
    for k in range(n + 1):
        z = foot + 0.1 * k
        if z > top - 0.02:
            break
        ln = 0.2 if k % 5 == 0 else 0.11
        m.box((x, -W / 2 + 0.04 + ln / 2, z), (0.004, ln, 0.035 if k % 5 else 0.05), TAR, shade=0.35)
    # the figures: 7-segment strokes, red, at each metre over the sill
    SEG = {1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc"}
    for metre in range(1, 7):
        z = foot + metre
        if z > top - 0.15:
            break
        cy, cz, w, h, t = W / 2 - 0.075, z + 0.04, 0.075, 0.17, 0.026
        seg = {"a": (cy, cz + h, w, t), "g": (cy, cz + h / 2, w, t), "d": (cy, cz, w, t),
               "f": (cy - w / 2, cz + 3 * h / 4, t, h / 2), "b": (cy + w / 2, cz + 3 * h / 4, t, h / 2),
               "e": (cy - w / 2, cz + h / 4, t, h / 2), "c": (cy + w / 2, cz + h / 4, t, h / 2)}
        for s in SEG[metre]:
            yy, zz, ww, hh = seg[s]
            m.box((x, yy, zz), (0.004, ww, hh), REDLEAD, shade=0.9)
    return m


def lock_fender():
    """An oak rubbing post on the wall face (x = 0, out +X): from under the coping to the foot, iron straps let
    into the stone every 1.4 m, bolts; worn pale where the hulls rub, weed below half tide."""
    m = Mesh(ao=0.0)
    m.tintfn = weed_tint(-1.2, -5.8)
    top, foot = -0.32, -5.9
    m.box((0.13, 0, (top + -1.1) / 2), (0.26, 0.26, top + 1.1), DARK, tile=1.2)
    m.box((0.13, 0, (-1.1 + foot) / 2), (0.26, 0.26, -1.1 - foot), TARWEED, tile=1.6)
    # the top cut on a slope (the rain runs off)
    m.hexa([(0.0 if not i & 1 else 0.26, -0.13 if not i & 2 else 0.13, top if not i & 4 else top + (0.0 if i & 1 else 0.08)) for i in range(8)], DARK)
    for z in (-0.7, -2.1, -3.5, -4.9):
        m.box((0.14, 0, z), (0.285, 0.3, 0.06), IRON, shade=0.6)
        for sy in (-1, 1):
            m.box((0.01, sy * 0.2, z), (0.02, 0.14, 0.07), IRON, shade=0.55)
        bolt(m, (0.265, 0, z + 0.12), (1, 0, 0), r=0.03)
    return m


def lock_chain():
    """A grab chain on a wall face (x = 0, out +X), 3 m along +Y between two wall eyes, hanging in a festoon."""
    m = Mesh(ao=0.0)
    for y in (0.0, 3.0):
        eye(m, (0, y, 0), (1, 0, 0))
    chain(m, sag((0.06, 0.0, -0.13), (0.06, 3.0, -0.13), 0.42), pitch=0.11)
    return m


def lock_dolphin():
    """A fender dolphin at a mouth of the lock: three piles driven in a triangle and bound at the head with a
    chain, a timber cap, a waling; weathered grey over the water, black and weedy below, worn on the fair side."""
    m = Mesh(ao=0.0)
    m.tintfn = weed_tint(-0.8, -5.2)
    piles = [(0.0, 0.32), (-0.29, -0.17), (0.29, -0.17)]
    for k, (px, py) in enumerate(piles):
        top = 1.15 - 0.08 * k
        with m.at(bb.move(px, py, 0)):
            m.lathe([(0.21, -6.6), (0.22, -1.0)], 12, TARWEED, smooth=True, urep=1)
            m.lathe([(0.22, -1.0), (0.22, top - 0.05), (0.18, top)], 12, DARK, smooth=True, cap1=True, urep=1)
    # the chain wrapped round the heads twice
    for z in (0.78, 0.88):
        pts = [V(0.62 * math.cos(2 * math.pi * k / 24), 0.62 * math.sin(2 * math.pi * k / 24), z) for k in range(25)]
        chain(m, pts, pitch=0.13)
    # a waling round the three a metre down, bolted
    for (ax, ay), (bx, by) in zip(piles, piles[1:] + piles[:1]):
        a, b = V(ax, ay, -0.3), V(bx, by, -0.3)
        d = (b - a).normalized()
        out = V(-d.y, d.x, 0)
        if out.dot((a + b) / 2) < 0:
            out = -out
        m.beam(a + out * 0.24 - d * 0.2, b + out * 0.24 + d * 0.2, 0.16, 0.24, DARK, side=tuple(out))
    return m


def lock_buoy():
    """A mooring buoy: a riveted iron drum on a cone, painted black with a red band, a heavy ring on its crown
    for the ships' lines, its mooring chain down to the sinker. Origin on its waterline."""
    m = Mesh(ao=0.0)
    m.tintfn = weed_tint(0.0, -0.8)
    prof = [(0.06, -1.05), (0.4, -0.85), (0.78, -0.42), (0.8, -0.38), (0.8, 0.3), (0.78, 0.34), (0.6, 0.42), (0.18, 0.46), (0.0, 0.47)]
    m.lathe(prof, 24, IRONHULL, smooth=True, urep=4, cap0=True)
    m.lathe([(0.805, 0.0), (0.805, 0.16)], 24, REDLEAD, smooth=True, urep=4)
    # the seams' rivet rows
    for z in (-0.38, 0.3):
        m.lathe([(0.812, z - 0.02), (0.812, z + 0.02)], 24, IRON, smooth=True, urep=4)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        with m.at(rot(a)):
            m.box((0.805, 0, -0.04), (0.02, 0.04, 0.68), IRON, shade=0.7)
    # the crown's ring, standing in its eye
    m.box((0, 0, 0.5), (0.18, 0.08, 0.08), IRON, shade=0.6)
    ring = [V(0, 0.16 * math.cos(2 * math.pi * k / 14), 0.66 + 0.16 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
    m.tube(ring, [0.035] * 14, 6, IRON, side=(1, 0, 0), closed_path=True, smooth=True)
    # the mooring chain from the foot, down into the dark
    chain(m, [V(0, 0, -1.05), V(0.15, 0.1, -1.6), V(0.45, 0.25, -2.6), V(0.8, 0.4, -3.8)], pitch=0.14)
    return m


BUILDERS = [("gate_leaf", lambda: gate_leaf(False)),
            ("gate_leaf_east", lambda: gate_leaf(True)),
            ("gate_capstan", gate_capstan),
            ("lock_quoin", lock_quoin),
            ("lock_quoin_w", lambda: mirrored(lock_quoin())),
            ("lock_gear", lock_gear),
            ("lock_hut", lock_hut),
            ("lock_gauge", lock_gauge),
            ("lock_fender", lock_fender),
            ("lock_chain", lock_chain),
            ("lock_dolphin", lock_dolphin),
            ("lock_buoy", lock_buoy)]


def export():
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def preview(objs):
    """The lock as it stands in the game (channel x 104..116), the river pair shut, the dock pair open."""
    bb.preview_materials()
    bb.preview_lines(objs)
    cam = bb.stage()
    bb.quay(80, 104.0, -60, 0, top=0.0)
    bb.quay(116.0, 140, -60, 0, top=0.0)
    for o in bpy.context.scene.objects:
        if o.name.startswith("water"):
            o.location.z = -1.8

    def at(o, x, z, yaw, y=0.0):
        o.location = (x, -z, y)
        o.rotation_euler = (0, 0, yaw)
    for zg, n in ((7.0, 0), (42.0, 1)):
        for side, (hx, closed) in enumerate(((104.3, -15.0), (115.7, 195.0))):
            src = objs["gate_leaf" if side == 0 else "gate_leaf_east"]
            o = src if n == 0 else bb.dup(src, (0, 0, 0), 0)
            ang = closed if n == 0 else (-90.0 if side == 0 else 270.0)
            at(o, hx, zg, math.radians(ang), 0)
            o.scale = (5.75 / math.cos(math.radians(15)) / GATE_LEN, 1, 1)
    at(objs["gate_capstan"], 101.5, 10.5, 0)
    at(objs["lock_quoin"], 104.0, 7.0, 0)
    at(objs["lock_gear"], 103.2, 8.3, 0)
    at(objs["lock_hut"], 101.0, 27.5, 0)
    at(objs["lock_gauge"], 104.0, 11.5, 0)
    at(objs["lock_fender"], 104.0, 25.0, 0)
    at(objs["lock_chain"], 104.0, 30.0, 0)
    at(objs["lock_dolphin"], 102.0, -1.6, 0)
    at(objs["lock_buoy"], 110.0, -14.0, 0, -1.8)
    bpy.context.view_layer.update()
    bb.aim(cam, (88, 12, 10), (108, -18, -1), lens=30)
    bb.render(SHOT, (1600, 1000))


def closeups(objs, outdir, only=None):
    """Each part alone, no water (most of a gate stands under it), from two sides."""
    bb.preview_materials()
    bb.preview_lines(objs)
    cam = bb.stage(water=False)
    for n, _ in BUILDERS:
        if only and n not in only:
            continue
        ob = objs[n]
        for o in bpy.context.scene.objects:
            if o.type == "MESH":
                o.hide_render = bb.root_of(o).name != ob.name
        ob.location = (0, 0, 0)
        bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        c = (lo + hi) / 2
        r = (hi - lo).length / 2
        print(f"[build_lock] closeup {n}: centre {tuple(round(v, 2) for v in c)}, radius {r:.2f}, "
              f"{sum(1 for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render)} meshes shown")
        for i, (az, el) in enumerate(((-35.0, 0.3), (145.0, 0.25), (-80.0, 0.05))):
            a = math.radians(az)
            d = r * 2.0
            bb.aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), c.z + d * el), c, lens=35)
            # (not bb.render: it hides every "_cap" object, the gate_capstan with them)
            sc = bpy.context.scene
            sc.render.resolution_x, sc.render.resolution_y = 1200, 750
            sc.render.image_settings.file_format = "PNG"
            sc.render.filepath = os.path.join(outdir, f"{n}_{i}.png")
            os.makedirs(outdir, exist_ok=True)
            bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if "--closeups" in argv:
        bb.IMG_PX[0] = bb.CELL  # the pictures at full size for the close looks (the glb is not written)
    bb.make_materials()
    objs = {}
    for name, fn in BUILDERS:
        objs[name] = to_object(fn(), name)
    total = 0
    for n, o in objs.items():
        t = bb.tris(o)
        total += t
        print(f"[build_lock] {n:14s} {t:6d} tris")
    if "--closeups" in argv:
        only = argv[argv.index("--closeups") + 2].split(",") if len(argv) > argv.index("--closeups") + 2 else None
        closeups(objs, os.path.abspath(argv[argv.index("--closeups") + 1]), only)
        return
    export()
    print(f"[build_lock] -> {OUT} ({os.path.getsize(OUT) // 1024} KB, {total} tris)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()

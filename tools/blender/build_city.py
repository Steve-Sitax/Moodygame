"""Build the 1873 city houses in Blender and export them for the game.

    blender -b -P tools/blender/build_city.py

Reads shared/city_build.json (tools/city/plan.py) and writes
client/public/models/city.glb, one mesh per 100 m chunk, three materials:
  facade  - walls; UV0 in bays (3 m) and storeys, UV1 = atlas cell (style, part)
  roof    - roofs and flat tops; UV0 in metres / 3, UV1 = atlas cell (tile, slate)
  stone   - copings, gable steps, cornices, chimneys
The game swaps these materials for its own PS1 materials by name; the atlas
cells are drawn in client/src/world/cityTextures.ts. Vertex colour = tint and
grime (darker near the ground), a cheap stand-in for baked shadow.

Blender is Z-up; glTF export turns it to Y-up. A world point (x, y, z) of the
game is placed at Blender (x, -z, y).

M7 back alleys (2026-09-25): a house with h["poort"] gets a covered passage through its ground storey
(poort_*: the mouths under an arch or a stone or timber lintel, a tunnel with a beamed ceiling, a lantern at
the street end); the alley cottages (h["alley"]) get cottage_wall: small windows, a low door, a cornice that
runs on along the row, no kerb. An empty node "city_openings" carries (extras, JSON) the openings the plan
does not say: the passages, the ground bays built as plain wall beside them, each cottage's windows.

    blender -b --factory-startup -P tools/blender/build_city.py -- --preview [name,name*]   pictures too
    ... -- --no-export --preview "poort*"                                              pictures only

--preview renders close views (passages from the street, the mouth, inside, the back; the gangs; the
courts; rows of cottages) to data/shots/city_<view>.png with the game's own atlases, saved once from its
canvases to data/shots/city_atlas_*.jpg (cityTextures.ts).
"""

import fnmatch
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "shared", "city_build.json")
OUT = os.path.join(ROOT, "client", "public", "models", "city.glb")
CHUNK = 100.0
BAY = 3.0

# atlas cells: facade atlas is 8 x 8 (cityTextures.ts facadeAtlas). Rows 0-3, one per style, columns
# ground (shop window) / upper / blind / plain ground wall (the bay a door is cut into).
# Columns 4-7 hold the door parts, one cell each, uv 0..1 over the part.
STYLE_ROW = {"brick": 0, "plaster": 1, "plaster_grey": 2, "brick_dark": 3, "public": 1}
PART_COL = {"ground": 0, "upper": 1, "blind": 2, "door": 3}
DOOR_LEAF = [(4, 4), (5, 4), (6, 4), (7, 4)]  # panelled front door: dark green, oxblood, brown, deep blue
TRANSOM, FANLIGHT, LOADING = (4, 5), (5, 5), (6, 5)  # glazed transom, round fanlight, planked loading door
GATE_LEAF = [(4, 6), (5, 6), (6, 6)]  # carriage gate with wicket and strap hinges: brown, green, grey-blue
REVEAL = 0.2  # a door sits this far back in the wall
# M7 taverns and homes in the world (shared/inworld_build.json, tools/city/inworld.mts): in these houses the
# door has no leaf (the game hangs one) and the painted glass of some windows is cut out (the game's panes)
INWORLD_SRC = os.path.join(ROOT, "shared", "inworld_build.json")
INWORLD = {}
if os.path.exists(INWORLD_SRC):
    for _e in json.load(open(INWORLD_SRC))["houses"]:
        INWORLD[_e["house"]] = _e
ROOF_CELL = {"tile": (0, 0), "slate": (1, 0), "flat": (0, 1), "lead": (1, 1)}

MAT_FACADE, MAT_ROOF, MAT_STONE, MAT_WOOD, MAT_LEAF = 0, 1, 2, 3, 4


def B(x, y, z):
    """Game world (x, y up, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


class Builder:
    def __init__(self, ground_h, storey_h):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.cell = self.bm.loops.layers.uv.new("Cell")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.gh = ground_h
        self.sh = storey_h
        self.tint = (1, 1, 1)
        self.holes = []
        self.rec = None  # a list to note the plain ground bays in (poort houses), or None
        self.rec_wall = 0
        self.rec_win = None  # a list to note a cottage's windows in, or None

    def face(self, pts, mat, uvs, cell, outward, shade=None, vshade=None):
        """pts: world points (x, y, z); outward: world vector the face must look along.
        vshade: a shade per point (overrides shade), for the dark inside of a passage."""
        verts = [self.bm.verts.new(B(*p)) for p in pts]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = mat
        f.normal_update()
        want = B(*outward)
        if f.normal.dot(want) < 0:
            f.normal_flip()
            # flipping reverses the loop order; keep uv and points paired
            order = list(reversed(range(len(pts))))
        else:
            order = list(range(len(pts)))
        for loop in f.loops:
            i = verts.index(loop.vert)
            loop[self.uv].uv = uvs[i]
            loop[self.cell].uv = cell
            y = pts[i][1]
            g = vshade[i] if vshade is not None else shade if shade is not None else 0.66 + 0.34 * min(1.0, y / 9.0)
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, 1.0)
        return f

    # ---------------------------------------------------------------- walls

    def wall(self, a, b, y0, y1, style, street, facing, door=None, holes=None, kerb=True):
        """A vertical wall from world (ax, az) to (bx, bz), y0..y1. Street walls get windows.
        door: openings in the ground storey (door_spec / gate_spec), s in metres from a.
        holes: M7, window openings cut through (s0, s1, y0, y1; s from a), with a stone reveal."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05 or y1 - y0 < 0.05:
            return
        holes = [hl for hl in (holes or []) if hl["y1"] > y0 and hl["y0"] < y1]
        self.holes = holes
        if holes:
            self.hole_reveals(a, b, L, facing, holes)
        if y0 == 0:
            GROUND_WALLS.append((a, b))
        row = STYLE_ROW[style]
        bays = max(1, round(L / BAY))
        if not street:
            cell = (PART_COL["blind"], row)
            self.face([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], MAT_FACADE,
                      [(0, y0 / self.sh), (L / BAY, y0 / self.sh), (L / BAY, y1 / self.sh), (0, y1 / self.sh)], cell, facing)
            return
        # a kerb of stone slabs along the street wall, and the gutter outside it
        if y0 == 0 and kerb:  # (no kerb on a back wall in a yard or a gang: kerb=False)
            ox, oz = facing[0], facing[2]
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            # built later, all at once (build_kerbs): the kerbs of neighbours meet without two faces in one plane
            KERBS.append({"a": a, "b": b, "f": (ox, oz), "tint": self.tint, "bld": self})
        # ground storey: the bays with a door are plain wall with the doorway cut in, the others have windows
        gy = min(y1, self.gh)
        if gy > y0:
            vt = (gy - y0) / self.gh
            bw = L / bays
            ops = sorted(door or [], key=lambda o: o["s"]) if y0 == 0 else []
            covered = [False] * bays
            for o in ops:
                lo, hi = o["s"] - o["w"] / 2 - o["J"] - 0.05, o["s"] + o["w"] / 2 + o["J"] + 0.05
                for k in range(bays):
                    if k * bw < hi and (k + 1) * bw > lo:
                        covered[k] = True
            k0 = 0
            while k0 < bays:
                k1 = k0
                while k1 < bays and covered[k1] == covered[k0]:
                    k1 += 1
                if covered[k0]:
                    if self.rec is not None:
                        self.rec.append([self.rec_wall, round(k0 * bw, 2), round(k1 * bw, 2)])
                    self.door_run(a, b, L, facing, k0 * bw, k1 * bw, gy, [o for o in ops if k0 * bw <= o["s"] < k1 * bw], row, bw)
                else:
                    pa = (a[0] + (b[0] - a[0]) * k0 / bays, a[1] + (b[1] - a[1]) * k0 / bays)
                    pb = (a[0] + (b[0] - a[0]) * k1 / bays, a[1] + (b[1] - a[1]) * k1 / bays)
                    if holes:
                        self.holed(a, b, L, k0 * bw, k1 * bw, y0, gy, lambda s, y, s0=k0 * bw: ((s - s0) / bw, (y - y0) / self.gh),
                                   (PART_COL["ground"], row), facing, holes)
                    else:
                        self.face([(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pb[0], gy, pb[1]), (pa[0], gy, pa[1])], MAT_FACADE,
                                  [(0, 0), (k1 - k0, 0), (k1 - k0, vt), (0, vt)], (PART_COL["ground"], row), facing)
                k0 = k1
        if y1 > self.gh:
            ya = max(y0, self.gh)
            v0, v1 = (ya - self.gh) / self.sh, (y1 - self.gh) / self.sh
            if holes:
                bwu = L / bays
                self.holed(a, b, L, 0, L, ya, y1, lambda s, y: (s / bwu, (y - self.gh) / self.sh), (PART_COL["upper"], row), facing, holes)
            else:
                self.face([(a[0], ya, a[1]), (b[0], ya, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], MAT_FACADE,
                          [(0, v0), (bays, v0), (bays, v1), (0, v1)], (PART_COL["upper"], row), facing)
        self.holes = []

    def box(self, cx, cy, cz, sx, sy, sz, ux, uz, mat=MAT_STONE, cell=(0, 0), shade=0.9, skip=None, bottom=False, uv01=False):
        """An oriented box: centre, size along u (sx), up (sy), along n (sz); u = (ux, uz) on the ground.
        skip: leave out the side facing this way (it lies against a wall). bottom: with a bottom face
        (a thing seen from below). uv01: each face's uv 0..1 (an atlas cell over each face)."""
        nx, nz = -uz, ux
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        def P(i, j, k):
            return (cx + ux * hx * i + nx * hz * k, cy + hy * j, cz + uz * hx * i + nz * hz * k)
        faces = [
            ([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], (-nx, 0, -nz)),
            ([P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1)], (nx, 0, nz)),
            ([P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1)], (-ux, 0, -uz)),
            ([P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], (ux, 0, uz)),
            ([P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], (0, 1, 0)),
        ]
        if bottom:
            faces.append(([P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], (0, -1, 0)))
        uv = [(0, 0), (1, 0), (1, 1), (0, 1)] if uv01 else [(0, 0), (sx / BAY, 0), (sx / BAY, sy / BAY), (0, sy / BAY)]
        for pts, out in faces:
            if skip is not None and out[0] * skip[0] + out[1] * skip[1] + out[2] * skip[2] > 0.9:
                continue
            self.face(pts, mat, uv, cell, out, shade)

    def holed(self, a, b, L, sa, sb, ya, yb, uvf, cell, f, holes):
        """M7: the wall face sa..sb (s from a) x ya..yb with the holes left out, in a grid of rectangles
        split at the holes' edges; uvf(s, y) keeps the texture where it was on the whole face."""
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        xs = sorted({sa, sb, *[v for hl in holes for v in (hl["s0"], hl["s1"]) if sa < v < sb]})
        ys = sorted({ya, yb, *[v for hl in holes for v in (hl["y0"], hl["y1"]) if ya < v < yb]})
        for s0, s1 in zip(xs, xs[1:]):
            for y0, y1 in zip(ys, ys[1:]):
                sm, ym = (s0 + s1) / 2, (y0 + y1) / 2
                if any(hl["s0"] < sm < hl["s1"] and hl["y0"] < ym < hl["y1"] for hl in holes):
                    continue
                pts = [(a[0] + ux * s0, y0, a[1] + uz * s0), (a[0] + ux * s1, y0, a[1] + uz * s1),
                       (a[0] + ux * s1, y1, a[1] + uz * s1), (a[0] + ux * s0, y1, a[1] + uz * s0)]
                self.face(pts, MAT_FACADE, [uvf(s0, y0), uvf(s1, y0), uvf(s1, y1), uvf(s0, y1)], cell, f)

    def hole_reveals(self, a, b, L, f, holes):
        """M7: the reveal of each window hole, stone in shadow, REVEAL deep into the house (the game's room
        wall stands there, its pane just inside the face)."""
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        R = REVEAL
        dd = R / BAY
        for hl in holes:
            s0, s1, y0, y1 = hl["s0"], hl["s1"], hl["y0"], hl["y1"]
            hy, hs = (y1 - y0) / BAY, (s1 - s0) / BAY
            self.face([W(s0, y0, 0), W(s0, y0, -R), W(s0, y1, -R), W(s0, y1, 0)], MAT_STONE, [(0, 0), (dd, 0), (dd, hy), (0, hy)], (0, 0), (ux, 0, uz), 0.5)
            self.face([W(s1, y0, 0), W(s1, y0, -R), W(s1, y1, -R), W(s1, y1, 0)], MAT_STONE, [(0, 0), (dd, 0), (dd, hy), (0, hy)], (0, 0), (-ux, 0, -uz), 0.5)
            self.face([W(s0, y1, 0), W(s1, y1, 0), W(s1, y1, -R), W(s0, y1, -R)], MAT_STONE, [(0, 0), (hs, 0), (hs, dd), (0, dd)], (0, 0), (0, -1, 0), 0.42)
            self.face([W(s0, y0, 0), W(s1, y0, 0), W(s1, y0, -R), W(s0, y0, -R)], MAT_STONE, [(0, 0), (hs, 0), (hs, dd), (0, dd)], (0, 0), (0, 1, 0), 0.62)

    # ---------------------------------------------------------------- doors
    # Antwerp around 1873: a panelled front door, painted, under a glazed transom and a stone lintel
    # or under a round fanlight in a stone arch; a stone sill. Wide fronts: a double door. A house with
    # a carriage way and the storehouses: a gate (poortdeur) of two panelled leaves with strap hinges
    # and a wicket, under a segmental stone arch. The door stands in a reveal 20 cm deep; the surround
    # (jambs, lintel or arch ring) lies flat on the wall, its blocks flush with each other.

    @staticmethod
    def door_spec(s, L, bw, drng):
        """An ordinary front door centred s metres along a wall of length L, in a bay bw wide."""
        J = 0.2
        double = L >= 7.5 and drng.random() < 0.4
        w = 1.5 if double else (drng.choice([1.05, 1.1, 1.15]) if L >= 5 else 0.95)
        room = min(bw, 2 * min(s, L - s)) - 0.3
        if w + 2 * J > room:
            J = 0.14
            w = max(0.8, min(w, room - 2 * J))
        top = "round" if drng.random() < 0.45 else "flat"
        hs = 0.18
        yd = hs + drng.choice([2.1, 2.15, 2.2])
        return {"kind": "house", "s": s, "w": w, "J": J, "top": top, "double": double and w >= 1.3, "hs": hs,
                "yd": yd, "ys": yd, "yt": yd + 0.5, "cell": drng.choice(DOOR_LEAF), "shade": drng.uniform(0.85, 1.0),
                "hood": drng.random() < 0.5, "key": drng.random() < 0.6}

    @staticmethod
    def inworld_door(d):
        """M7: the door of a house whose inside stands in the world (shared/inworld_build.json): a plain front
        door under a transom, its leaf and transom left open (the game hangs them)."""
        return {"kind": "house", "s": d["s"], "w": d["w"], "J": d["J"], "top": "flat", "double": False, "hs": d["hs"],
                "yd": d["yd"], "ys": d["yd"], "yt": d["yt"], "cell": DOOR_LEAF[0], "shade": 0.95, "hood": True, "key": False, "open": True}

    @classmethod
    def gate_spec(cls, s, L, bw, drng, store=False):
        """A carriage gate centred s metres along a wall of length L; a double door if it will not fit."""
        J = 0.3
        w = min(2.7 if store else 2.5, 2 * min(s, L - s) - 2 * J - 0.4)
        if w < 1.9:
            o = cls.door_spec(s, L, max(bw, 2.4), drng)
            return o
        ys, hr = (2.8, 0.5) if store else (2.65, 0.55)
        return {"kind": "gate", "s": s, "w": w, "J": J, "top": "segment", "double": True, "hs": 0.0,
                "yd": ys, "ys": ys, "yt": ys, "hr": hr, "cell": drng.choice(GATE_LEAF), "shade": drng.uniform(0.85, 1.0),
                "hood": False, "key": True}

    @staticmethod
    def arc_pts(o, grow=0.0, n=6):
        """The top edge of an opening, left to right, as (s, y); grow > 0: the outer edge of a ring that wide."""
        w = o["w"] + 2 * grow
        sc = o["s"]
        if o["top"] == "flat":
            return [(sc - w / 2, o["yt"] + grow), (sc + w / 2, o["yt"] + grow)]
        if o["top"] == "round":
            r = w / 2
            return [(sc - r * math.cos(math.pi * i / n), o["ys"] + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
        hr = o["hr"] + grow
        rc = (w * w / 4 + hr * hr) / (2 * hr)
        cy = o["ys"] + hr - rc
        al = math.asin(min(1.0, (w / 2) / rc))
        return [(sc - rc * math.sin(al * (1 - 2 * i / n)), cy + rc * math.cos(al * (1 - 2 * i / n))) for i in range(n + 1)]

    @staticmethod
    def fit(o, gy):
        """Lower a doorway that would reach into the storey above."""
        if o["top"] == "flat":
            top = o["yt"] + 0.38
        elif o["top"] == "round":
            top = o["ys"] + o["w"] / 2 + o["J"] + 0.04
        else:
            top = o["ys"] + o["hr"] + o["J"] + 0.04
        over = top - (gy - 0.08)
        if over > 0:
            for k in ("yd", "ys", "yt"):
                o[k] -= over

    def door_run(self, a, b, L, f, sa, sb, gy, ops, row, bw):
        """Ground-storey bays sa..sb (metres from a) of plain wall with doorways cut in."""
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)

        cell = (PART_COL["door"], row)
        stone = 0.95 if row in (1, 2) else 0.8  # pale stone on plaster, blue-grey stone on brick

        def piece(pts):
            ss = [s for s, _ in pts]
            yy = [y for _, y in pts]
            hs = getattr(self, "holes", None)
            if hs and len(pts) == 4 and any(hl["s0"] < max(ss) and hl["s1"] > min(ss) and hl["y0"] < max(yy) and hl["y1"] > min(yy) for hl in hs):
                self.holed(a, b, L, min(ss), max(ss), min(yy), max(yy), lambda s, y: (s / bw, y / self.gh), cell, f, hs)
                return
            self.face([W(s, y) for s, y in pts], MAT_FACADE, [(s / bw, y / self.gh) for s, y in pts], cell, f)

        cur = sa
        for o in ops:
            self.fit(o, gy)
            left, right = o["s"] - o["w"] / 2, o["s"] + o["w"] / 2
            if left - cur > 0.01:
                piece([(cur, 0), (left, 0), (left, gy), (cur, gy)])
            arc = self.arc_pts(o)
            for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
                piece([(s1, y1), (s2, y2), (s2, gy), (s1, gy)])
            if o["kind"] == "poort":
                self.poort_mouth(W, o, arc, ux, uz, f, stone)
            else:
                self.doorway(W, o, arc, ux, uz, f, stone)
            cur = right
        if sb - cur > 0.01:
            piece([(cur, 0), (sb, 0), (sb, gy), (cur, gy)])

    def doorway(self, W, o, arc, ux, uz, f, stone):
        R, J = REVEAL, o["J"]
        P = 0.07 if o["kind"] == "house" else 0.09  # how far the surround stands proud of the wall
        w, sc = o["w"], o["s"]
        left, right = sc - w / 2, sc + w / 2
        ys = arc[0][1]  # the sides stop here: under the lintel, or where the arch springs
        apex = max(y for _, y in arc)
        rs = stone * 0.6
        # the reveal: sides and soffit, stone in shadow
        side_uv = [(0, 0), (R / BAY, 0), (R / BAY, ys / BAY), (0, ys / BAY)]
        self.face([W(left, 0, 0), W(left, 0, -R), W(left, ys, -R), W(left, ys, 0)], MAT_STONE, side_uv, (0, 0), (ux, 0, uz), rs)
        self.face([W(right, 0, 0), W(right, 0, -R), W(right, ys, -R), W(right, ys, 0)], MAT_STONE, side_uv, (0, 0), (-ux, 0, -uz), rs)
        for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
            sm, ym = (s1 + s2) / 2, (y1 + y2) / 2
            self.face([W(s1, y1, 0), W(s2, y2, 0), W(s2, y2, -R), W(s1, y1, -R)], MAT_STONE,
                      [(s1 / BAY, 0), (s2 / BAY, 0), (s2 / BAY, R / BAY), (s1 / BAY, R / BAY)], (0, 0),
                      (ux * (sc - sm), (ys - 1.0) - ym, uz * (sc - sm)), rs * 0.85)
        # the door itself, at the back of the reveal
        sh, hs, d = o["shade"], o["hs"], -R
        if o["kind"] == "gate":
            self.face([W(left, 0, d), W(right, 0, d), W(right, ys, d), W(left, ys, d)], MAT_FACADE,
                      [(0, 0), (1, 0), (1, ys / apex), (0, ys / apex)], o["cell"], f, sh)
            for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
                self.face([W(s1, ys, d), W(s2, ys, d), W(s2, y2, d), W(s1, y1, d)], MAT_FACADE,
                          [((s1 - left) / w, ys / apex), ((s2 - left) / w, ys / apex), ((s2 - left) / w, y2 / apex), ((s1 - left) / w, y1 / apex)],
                          o["cell"], f, sh)
        else:
            # the sill: one stone across the doorway, a little proud of the wall
            self.slab(W, ux, uz, f, left - 0.02, right + 0.02, 0, hs, -R, 0.1, stone * 0.85)
            yd = o["ys"] if o["top"] == "round" else o["yd"]
            leaves = [(left, sc, 0.0, 1.0), (sc, right, 1.0, 0.0)] if o["double"] else [(left, right, 0.0, 1.0)]
            if o.get("open"):
                leaves = []  # M7: an open doorway; the game hangs the leaf and the transom
            for l0, l1, u0, u1 in leaves:
                self.face([W(l0, hs, d), W(l1, hs, d), W(l1, yd, d), W(l0, yd, d)], MAT_FACADE,
                          [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], o["cell"], f, sh)
            if o.get("open"):
                pass
            elif o["top"] == "flat":
                self.face([W(left, yd, d), W(right, yd, d), W(right, ys, d), W(left, ys, d)], MAT_FACADE,
                          [(0, 0), (1, 0), (1, 1), (0, 1)], TRANSOM, f, 0.95)
            else:
                r = w / 2
                for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
                    self.face([W(sc, ys, d), W(s1, y1, d), W(s2, y2, d)], MAT_FACADE,
                              [(0.5, 0), ((s1 - left) / w, (y1 - ys) / r), ((s2 - left) / w, (y2 - ys) / r)], FANLIGHT, f, 0.95)
        # the surround: jambs of two or three dressed stones on each side
        nb = 3 if ys > 2.4 else 2
        for j0, j1 in ((left - J, left), (right, right + J)):
            self.slab(W, ux, uz, f, j0, j1, 0, ys, 0, P, stone, nb)
        if o["top"] == "flat":
            lw = w + 2 * J + 0.08
            self.slab(W, ux, uz, f, sc - lw / 2, sc + lw / 2, ys, ys + 0.3, 0, P + 0.01, stone)
            if o["hood"]:  # a drip moulding along the top of the lintel
                self.slab(W, ux, uz, f, sc - lw / 2 - 0.06, sc + lw / 2 + 0.06, ys + 0.3, ys + 0.38, 0, P + 0.1, stone * 1.05)
            return
        # the arch ring: one flush band of voussoirs from jamb to jamb
        outer = self.arc_pts(o, J)
        for i, ((s1, y1), (s2, y2)) in enumerate(zip(arc, arc[1:])):
            (t1, z1), (t2, z2) = outer[i], outer[i + 1]
            g = stone * (1.0 if i % 2 == 0 else 0.9)
            self.face([W(s1, y1, P), W(s2, y2, P), W(t2, z2, P), W(t1, z1, P)], MAT_STONE,
                      [(s1 / BAY, y1 / BAY), (s2 / BAY, y2 / BAY), (t2 / BAY, z2 / BAY), (t1 / BAY, z1 / BAY)], (0, 0), f, g)
            om, oy = (t1 + t2) / 2 - sc, (z1 + z2) / 2 - ys
            self.face([W(t1, z1, 0), W(t2, z2, 0), W(t2, z2, P), W(t1, z1, P)], MAT_STONE,
                      [(0, 0), (0.1, 0), (0.1, P / BAY), (0, P / BAY)], (0, 0), (ux * om, oy, uz * om), g * 0.9)
            self.face([W(s1, y1, 0), W(s2, y2, 0), W(s2, y2, P), W(s1, y1, P)], MAT_STONE,
                      [(0, 0), (0.1, 0), (0.1, P / BAY), (0, P / BAY)], (0, 0), (-ux * om, -oy, -uz * om), g * 0.75)
        if o["key"]:
            kw = 0.17 if o["kind"] == "gate" else 0.12
            # 8 cm proud of the ring: at 3 cm its face lay over the ring's and the wobble made them fight (z-fight check)
            self.slab(W, ux, uz, f, sc - kw, sc + kw, apex - 0.02, apex + J + 0.04, 0, P + 0.08, stone * 1.05)

    def slab(self, W, ux, uz, f, s0, s1, y0, y1, d0, d1, shade, blocks=1, mat=MAT_STONE, under=False):
        """A block of stone lying on the wall, s0..s1 along it, y0..y1 up, d0..d1 out. No back and no
        bottom (they lie on the wall and the ground); the front split into `blocks` stones of alternate shade.
        under: with a bottom face too (a lintel over an opening, seen from below)."""
        for i in range(blocks):
            ya, yb = y0 + (y1 - y0) * i / blocks, y0 + (y1 - y0) * (i + 1) / blocks
            self.face([W(s0, ya, d1), W(s1, ya, d1), W(s1, yb, d1), W(s0, yb, d1)], mat,
                      [(s0 / BAY, ya / BAY), (s1 / BAY, ya / BAY), (s1 / BAY, yb / BAY), (s0 / BAY, yb / BAY)], (0, 0), f,
                      shade * (1.0 if i % 2 == 0 else 0.9))
        dd = (d1 - d0) / BAY
        self.face([W(s0, y1, d0), W(s1, y1, d0), W(s1, y1, d1), W(s0, y1, d1)], mat,
                  [(s0 / BAY, 0), (s1 / BAY, 0), (s1 / BAY, dd), (s0 / BAY, dd)], (0, 0), (0, 1, 0), shade * 1.05)
        if under:
            self.face([W(s0, y0, d0), W(s1, y0, d0), W(s1, y0, d1), W(s0, y0, d1)], mat,
                      [(s0 / BAY, 0), (s1 / BAY, 0), (s1 / BAY, dd), (s0 / BAY, dd)], (0, 0), (0, -1, 0), shade * 0.6)
        for se, sgn in ((s0, -1), (s1, 1)):
            self.face([W(se, y0, d0), W(se, y0, d1), W(se, y1, d1), W(se, y1, d0)], mat,
                      [(0, y0 / BAY), (dd, y0 / BAY), (dd, y1 / BAY), (0, y1 / BAY)], (0, 0), (ux * sgn, 0, uz * sgn), shade * 0.8)

    # ---------------------------------------------------------------- covered passages (poort)
    # alleys.py gives some front houses a passage 1.8 m wide straight through the ground storey into the
    # gang behind (h["poort"] = {"s": [s0, s1], "h": clear height}), like the Vlaeykensgang: a low opening
    # in an ordinary front under a segmental arch or a stone or timber lintel, the same opening in the back
    # wall, a tunnel of plain wall under a planked and beamed ceiling, a lantern on an iron arm at the street.

    @staticmethod
    def poort_spec(s, w, hgt, kind, J):
        """One mouth of a passage centred s metres along its wall, w wide, the ceiling hgt high."""
        if kind == "arch":
            hr = 0.42
            return {"kind": "poort", "s": s, "w": w, "J": J, "top": "segment", "hr": hr, "ys": hgt - hr, "yd": hgt - hr,
                    "yt": hgt, "h": hgt, "lintel": None}
        return {"kind": "poort", "s": s, "w": w, "J": J, "top": "flat", "ys": hgt, "yd": hgt, "yt": hgt, "h": hgt, "lintel": kind}

    def poort_mouth(self, W, o, arc, ux, uz, f, stone):
        """The surround and the reveal of a passage mouth; W(s, y, d) on its wall, d out of the house."""
        R, J = REVEAL, o["J"]
        P = 0.08
        w, sc = o["w"], o["s"]
        left, right = sc - w / 2, sc + w / 2
        ys, hgt = o["ys"], o["h"]
        fx, fz = f[0], f[2]
        timber = o["lintel"] == "timber"
        if o["top"] == "segment":
            # the arch's soffit through the wall, then the wall's inside face between the arch and the ceiling
            for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
                sm, ym = (s1 + s2) / 2, (y1 + y2) / 2
                self.face([W(s1, y1, 0), W(s2, y2, 0), W(s2, y2, -R), W(s1, y1, -R)], MAT_STONE,
                          [(s1 / BAY, 0), (s2 / BAY, 0), (s2 / BAY, R / BAY), (s1 / BAY, R / BAY)], (0, 0),
                          (ux * (sc - sm), (ys - 1.0) - ym, uz * (sc - sm)), stone * 0.5)
                if hgt - max(y1, y2) > 0.005 or hgt - min(y1, y2) > 0.005:
                    self.face([W(s1, y1, -R), W(s2, y2, -R), W(s2, hgt, -R), W(s1, hgt, -R)], MAT_STONE,
                              [(s1 / BAY, y1 / BAY), (s2 / BAY, y2 / BAY), (s2 / BAY, hgt / BAY), (s1 / BAY, hgt / BAY)], (0, 0),
                              (-fx, 0, -fz), stone * 0.4)
        # the jambs: dressed stones, or two timber posts under a timber lintel
        for j0, j1 in ((left - J, left), (right, right + J)):
            if timber:
                self.slab(W, ux, uz, f, j0, j1, 0, ys, 0, P, 0.5, 1, MAT_WOOD)
            else:
                self.slab(W, ux, uz, f, j0, j1, 0, ys, 0, P, stone, 3)
        # guard stones at the foot of the jambs, against the cart wheels
        for jm in (left - J / 2, right + J / 2):
            cx, cy, cz = W(jm, 0.3, P + 0.12)
            self.box(cx, cy, cz, J - 0.06, 0.6, 0.24, ux, uz, MAT_STONE, (0, 0), stone * 0.75, skip=(-fx, 0, -fz))
        if o["top"] == "flat":
            lw = w + 2 * J + (0.3 if timber else 0.08)
            if timber:
                self.slab(W, ux, uz, f, sc - lw / 2, sc + lw / 2, ys, ys + 0.28, 0, P + 0.04, 0.5, 1, MAT_WOOD, under=True)
            else:
                self.slab(W, ux, uz, f, sc - lw / 2, sc + lw / 2, ys, ys + 0.32, 0, P + 0.01, stone, 3, under=True)
            return
        outer = self.arc_pts(o, J)
        for i, ((s1, y1), (s2, y2)) in enumerate(zip(arc, arc[1:])):
            (t1, z1), (t2, z2) = outer[i], outer[i + 1]
            g = stone * (1.0 if i % 2 == 0 else 0.9)
            self.face([W(s1, y1, P), W(s2, y2, P), W(t2, z2, P), W(t1, z1, P)], MAT_STONE,
                      [(s1 / BAY, y1 / BAY), (s2 / BAY, y2 / BAY), (t2 / BAY, z2 / BAY), (t1 / BAY, z1 / BAY)], (0, 0), f, g)
            om, oy = (t1 + t2) / 2 - sc, (z1 + z2) / 2 - ys
            self.face([W(t1, z1, 0), W(t2, z2, 0), W(t2, z2, P), W(t1, z1, P)], MAT_STONE,
                      [(0, 0), (0.1, 0), (0.1, P / BAY), (0, P / BAY)], (0, 0), (ux * om, oy, uz * om), g * 0.9)
            self.face([W(s1, y1, 0), W(s2, y2, 0), W(s2, y2, P), W(s1, y1, P)], MAT_STONE,
                      [(0, 0), (0.1, 0), (0.1, P / BAY), (0, P / BAY)], (0, 0), (-ux * om, -oy, -uz * om), g * 0.75)
        apex = max(y for _, y in arc)
        self.slab(W, ux, uz, f, sc - 0.15, sc + 0.15, apex - 0.02, apex + J + 0.04, 0, P + 0.08, stone * 1.05, under=True)

    def poort_tunnel(self, P, pt, t0, t1, o, style, back_open):
        """The passage through the house: two side walls and a planked, beamed ceiling, darker away from
        the mouths. P(s, t) -> (x, z) in the house's frame."""
        p0, p1 = pt["s"]
        hgt, ys = o["h"], o["ys"]
        R = REVEAL
        arch = o["top"] == "segment"
        ta, tb = (t0 + R, t1 - R) if arch else (t0, t1)
        n = max(1, round((tb - ta) / 1.3))
        cuts = sorted({t0, t1, ta, tb, *[ta + (tb - ta) * k / n for k in range(1, n)]})
        cell = (PART_COL["door"], STYLE_ROW[style])

        def light(t, y):
            d = min(t - t0, (t1 - t) if back_open else 99.0)
            return (0.3 + 0.42 * math.exp(-d / 1.4)) * (0.8 + 0.2 * min(1.0, y / 2.5))

        for se, out in ((p0, (1, 0)), (p1, (-1, 0))):
            ox_, oz_ = P(out[0], 0)[0] - P(0, 0)[0], P(out[0], 0)[1] - P(0, 0)[1]
            for ta_, tb_ in zip(cuts, cuts[1:]):
                bands = [(0.0, ys)] + ([(ys, hgt)] if hgt - ys > 0.01 and ta - 1e-6 <= ta_ and tb_ <= tb + 1e-6 else [])
                for y0, y1 in bands:
                    pts = [(se, ta_, y0), (se, tb_, y0), (se, tb_, y1), (se, ta_, y1)]
                    world = [(P(s, t)[0], y, P(s, t)[1]) for s, t, y in pts]
                    self.face(world, MAT_FACADE, [((t - t0) / BAY, y / self.gh) for _, t, y in pts], cell, (ox_, 0, oz_),
                              vshade=[light(t, y) for _, t, y in pts])
        wx, wz = P(0, 1)[0] - P(0, 0)[0], P(0, 1)[1] - P(0, 0)[1]
        for ta_, tb_ in zip(cuts, cuts[1:]):
            if ta_ < ta - 1e-6 or tb_ > tb + 1e-6:
                continue
            pts = [(p0, ta_), (p1, ta_), (p1, tb_), (p0, tb_)]
            world = [(P(s, t)[0], hgt, P(s, t)[1]) for s, t in pts]
            self.face(world, MAT_WOOD, [((s - p0) / 1.2, (t - t0) / 1.2) for s, t in pts], (0, 0), (0, -1, 0),
                      vshade=[light(t, hgt) * 0.95 for _, t in pts])
        # beams across, every 1.2 m: a bottom and two sides (their ends lie on the walls, their tops on the
        # planks), the grain along the beam
        bw, bh = 0.2, 0.18
        k = ta + 0.6
        while k < tb - 0.4:
            g = light(k, hgt) * 0.8
            ya = hgt - bh
            L_ = (p1 - p0) / 1.2
            for pts, out, dv in (([(p0, k - bw / 2, ya), (p1, k - bw / 2, ya), (p1, k + bw / 2, ya), (p0, k + bw / 2, ya)], (0, -1, 0), bw),
                                 ([(p0, k - bw / 2, ya), (p1, k - bw / 2, ya), (p1, k - bw / 2, hgt), (p0, k - bw / 2, hgt)], (-wx, 0, -wz), bh),
                                 ([(p0, k + bw / 2, ya), (p1, k + bw / 2, ya), (p1, k + bw / 2, hgt), (p0, k + bw / 2, hgt)], (wx, 0, wz), bh)):
                world = [(P(s, t)[0], y, P(s, t)[1]) for s, t, y in pts]
                self.face(world, MAT_WOOD, [(0.1, 0), (0.1, L_), (0.1 + dv, L_), (0.1 + dv, 0)], (0, 0), out, g)
            k += 1.2

    def poort_lantern(self, W, sc, y, ux, uz, f):
        """An iron arm over the street end of a passage with a lantern hanging from it."""
        fx, fz = f[0], f[2]
        iron = 0.2
        self.slab(W, ux, uz, f, sc - 0.07, sc + 0.07, y, y + 0.36, 0, 0.07, iron)  # (7 cm: a thinner plate fights the wall)
        ay = y + 0.24
        cx, cy, cz = W(sc, ay, 0.07 + 0.3)
        self.box(cx, cy, cz, 0.04, 0.04, 0.6, ux, uz, MAT_STONE, (0, 0), iron, skip=(-fx, 0, -fz), bottom=True)
        # (the stay's two sides stand 2.4 cm apart, the arm is 4 cm wide: no face of one in the other's plane)
        # a stay from the plate's foot up to the arm
        for dsg in (-1, 1):
            q = [W(sc + dsg * 0.012, y + 0.02, 0.07), W(sc + dsg * 0.012, ay - 0.02, 0.42), W(sc + dsg * 0.012, ay - 0.05, 0.42), W(sc + dsg * 0.012, y - 0.01, 0.07)]
            self.face(q, MAT_STONE, [(0, 0), (0.1, 0), (0.1, 0.02), (0, 0.02)], (0, 0), (ux * dsg, 0, uz * dsg), iron)
        lx, lz = W(sc, 0, 0.56)[0], W(sc, 0, 0.56)[2]
        self.box(lx, ay - 0.06, lz, 0.02, 0.1, 0.02, ux, uz, MAT_STONE, (0, 0), iron)  # the hook
        self.box(lx, ay - 0.14, lz, 0.28, 0.07, 0.28, ux, uz, MAT_STONE, (0, 0), iron, bottom=True)  # the cap
        keep = self.tint
        self.tint = (1.0, 0.86, 0.6)
        self.box(lx, ay - 0.34, lz, 0.2, 0.33, 0.2, ux, uz, MAT_FACADE, TRANSOM, 0.95, uv01=True, skip=(0, 1, 0))  # the glass (its top is the cap's)
        self.tint = keep
        self.box(lx, ay - 0.535, lz, 0.16, 0.06, 0.16, ux, uz, MAT_STONE, (0, 0), iron, bottom=True)  # the foot

    def blind_way(self, a, b, H, style, f, op):
        """A blind back wall with a passage mouth in it."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        GROUND_WALLS.append((a, b))
        cell = (PART_COL["blind"], STYLE_ROW[style])
        gy = min(H, self.gh)
        self.fit(op, gy)
        left, right = op["s"] - op["w"] / 2, op["s"] + op["w"] / 2
        arc = self.arc_pts(op)

        def piece(pts):
            self.face([W(s, y) for s, y in pts], MAT_FACADE, [(s / BAY, y / self.sh) for s, y in pts], cell, f)
        xs = [0.0, left] + [s for s, _ in arc[1:-1]] + [right, L]
        piece([(0, 0), (left, 0), (left, gy), (0, gy)])
        for (s1, y1), (s2, y2) in zip(arc, arc[1:]):
            piece([(s1, y1), (s2, y2), (s2, gy), (s1, gy)])
        piece([(right, 0), (L, 0), (L, gy), (right, gy)])
        if H > gy:
            for s1, s2 in zip(xs, xs[1:]):
                piece([(s1, gy), (s2, gy), (s2, H), (s1, H)])
        self.poort_mouth(W, op, arc, ux, uz, f, 0.95 if STYLE_ROW[style] in (1, 2) else 0.8)

    def loading_door(self, W, s, y, ux, uz, out):
        """A loading door in an upper storey of a storehouse: planked leaves in a stone frame on the wall."""
        w, hgt, J, y0 = 1.5, 2.1, 0.16, y + 0.35
        # the leaves stand 7 cm off the wall, just behind the jambs' faces (8 cm): at 3 cm they lay over the
        # wall so near that the wobble made them fight (z-fight check)
        dl = 0.07
        self.face([W(s - w / 2, y0, dl), W(s + w / 2, y0, dl), W(s + w / 2, y0 + hgt, dl), W(s - w / 2, y0 + hgt, dl)],
                  MAT_FACADE, [(0, 0), (1, 0), (1, 1), (0, 1)], LOADING, out, 0.9)
        for j0, j1 in ((s - w / 2 - J, s - w / 2), (s + w / 2, s + w / 2 + J)):
            self.slab(W, ux, uz, out, j0, j1, y0, y0 + hgt, 0, 0.08, 0.8)
        lw = w + 2 * J + 0.06
        self.slab(W, ux, uz, out, s - lw / 2, s + lw / 2, y0 + hgt, y0 + hgt + 0.22, 0, 0.09, 0.85)
        self.slab(W, ux, uz, out, s - lw / 2 - 0.02, s + lw / 2 + 0.02, y0 - 0.14, y0, 0, 0.16, 0.75)

    # ---------------------------------------------------------------- houses

    def side_wall(self, ring, street, outs, i, y0, y1, style, H):
        """Wall i of a house's ring (a -> b) that is not a street front. Where it meets the house's
        own front at a seam with a neighbour's front, it stops SEAM_SET metres behind the front up to
        the lower of the two houses: standing right on the seam, its edge lay in the fronts' plane
        and the PS1 wobble showed it through, a dotted line of lit party wall along the seam (Steve,
        2026-09-25, the Hessenatie corner). Above the neighbour it is seen, so it runs to the corner."""
        n = len(ring)
        a, b = ring[i], ring[(i + 1) % n]
        ha = seam_cover(self.hid, a, outs[(i - 1) % n], H) if street[(i - 1) % n] else 0.0
        hb = seam_cover(self.hid, b, outs[(i + 1) % n], H) if street[(i + 1) % n] else 0.0
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if (ha <= y0 and hb <= y0) or L < 3 * SEAM_SET:
            self.wall(a, b, y0, y1, style, False, outs[i])
            return
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        a2 = (a[0] + ux * SEAM_SET, a[1] + uz * SEAM_SET)
        b2 = (b[0] - ux * SEAM_SET, b[1] - uz * SEAM_SET)
        if y0 == 0:
            GROUND_WALLS.append((a, b))  # the kerbs' ends see the whole wall
        cuts = sorted({y0, y1, *[h for h in (ha, hb) if y0 < h < y1]})
        for lo, hi in zip(cuts, cuts[1:]):
            self.wall(a2 if hi <= ha else a, b2 if hi <= hb else b, lo, hi, style, False, outs[i])

    def house(self, h, rng):
        self.hid = id(h)
        t = h["tint"]
        self.tint = (t, t * rng.uniform(0.97, 1.02), t * rng.uniform(0.95, 1.02))
        if h["rect"]:
            self.rect_house(h, rng)
        else:
            self.poly_house(h, rng)

    def rect_house(self, h, rng):
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = h["s"]
        t0, t1 = h["t"]
        H = h["h"]
        style = h["style"]
        W, D = s1 - s0, t1 - t0

        def P(s, t):
            return (ox + ux * s + nx * t, oz + uz * s + nz * t)

        c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)]
        outs = [(-nx, 0, -nz), (ux, 0, uz), (nx, 0, nz), (-ux, 0, -uz)]
        street = h["street"]
        store = h.get("store")
        # the same draw as before the door redesign, so the rest of the house keeps its random choices
        gate = (not store) and street[0] and W >= 6.5 and rng.random() < 0.22
        ops = None
        iw = INWORLD.get(h.get("_i"))
        if iw and street[0]:
            ops = [self.inworld_door(iw["door"])]
        elif street[0]:
            drng = random.Random(h["seed"] * 31 + 1873)  # the doors' own dice
            bays = max(1, round(W / BAY))
            bw = W / bays
            sc = (bays // 2 + 0.5) * bw  # the door bay (props and street life expect the middle bay)
            if store:
                # a storehouse: a loading gate every 9 m, a front door in the middle if it is free
                ops = []
                k = 4.5
                while k < W - 3:
                    ops.append(self.gate_spec(k, W, bw, drng, store=True))
                    k += 9.0
                if all(abs(o["s"] - sc) > 3.4 for o in ops):
                    ops.append(self.door_spec(sc, W, bw, drng))
            elif gate:
                ops = [self.gate_spec(sc, W, bw, drng)]
            else:
                ops = [self.door_spec(sc, W, bw, drng)]
        yard = h.get("yard") or [0, 0, 0, 0]
        # the small houses of the back alleys (alleys.py): workers' cottages, their own walls (cottage_wall)
        cottage = bool(h.get("alley")) and h["roof"] == "side" and not iw
        pt = h.get("poort") if street[0] else None
        if pt:
            # a covered passage through the ground storey (alleys.py): its own dice, the house's stay as they were
            prng = random.Random(h["seed"] * 7 + 1566)
            kind = prng.choice(["arch", "arch", "stone", "timber"])
            p0, p1 = pt["s"]
            pw, pm = p1 - p0, (p0 + p1) / 2
            front_op = self.poort_spec(pm - s0, pw, pt["h"], kind, 0.25)
            back_op = self.poort_spec(s1 - pm, pw, pt["h"], kind, 0.25)
            for o in ops or []:
                # the door keeps clear of the passage's surround: a narrower door, narrower jambs
                gap = abs(o["s"] - front_op["s"]) - pw / 2 - front_op["J"] - 0.12
                if o["w"] / 2 + o["J"] + 0.1 > gap:
                    o["J"] = 0.14
                    o["w"] = max(0.8, min(o["w"], 2 * (gap - o["J"] - 0.1)))
                    o["double"] = o["double"] and o["w"] >= 1.3
                if o["w"] / 2 + o["J"] + 0.1 > gap:
                    front_op["J"] = back_op["J"] = 0.16
                    print(f"[build_city] house {h.get('_i')}: a narrow door beside the passage")
            ops = (ops or []) + [front_op]
        if cottage:
            # the plan's rows meet a centimetre apart or over each other (rounding): each end of a cottage's
            # front and back meets its neighbour's at one point, so walls, cornices and roofs neither
            # overlap in one plane (z-fight check) nor leave a crack
            adj = {}
            for e, se in ((0, s0), (1, s1)):
                for ln, tl, f in (("f", t0, outs[0]), ("b", t1, outs[2])):
                    adj[(e, ln)] = row_meet(self.hid, P(se, tl), f, (ux, uz))
                # a back on no lane has no corner to meet (only street walls are indexed): as its front
                if adj[(e, "b")] is None:
                    adj[(e, "b")] = adj[(e, "f")]
                if adj[(e, "f")] is None:
                    adj[(e, "f")] = adj[(e, "b")]
                adj[(e, "f")], adj[(e, "b")] = adj[(e, "f")] or 0.0, adj[(e, "b")] or 0.0
            cc = [P(s0 + adj[(0, "f")], t0), P(s1 + adj[(1, "f")], t0), P(s1 + adj[(1, "b")], t1), P(s0 + adj[(0, "b")], t1)]
        for i in range(4):
            if cottage and (street[i] or yard[i]):
                door = None
                if i == 0 and ops:
                    door = {"kind": "house", "s": ops[0]["s"], "w": 0.9, "J": 0.12, "top": "flat", "double": False, "hs": 0.12,
                            "yd": 2.07, "ys": 2.37, "yt": 2.37, "cell": ops[0]["cell"], "shade": ops[0]["shade"], "hood": False, "key": False}
                self.rec_win = OPENINGS["cottages"].setdefault(str(h.get("_i")), [])
                self.rec_wall = i
                self.cottage_wall(cc[i], cc[(i + 1) % 4], H, style, outs[i], door)
                self.rec_win = None
                continue
            if street[i]:
                hl = [q for q in iw["holes"] if q["wall"] == i] if iw else None
                dops = ops if i == 0 else ([back_op] if pt and i == 2 else None)
                if pt and i in (0, 2):
                    self.rec, self.rec_wall = OPENINGS["plain_ground"].setdefault(str(h.get("_i")), []), i
                self.wall(c[i], c[(i + 1) % 4], 0, H, style, True, outs[i], door=dops, holes=hl)
                self.rec = None
            elif yard[i]:
                # the back alleys (tools/city/alleys.py): a back wall on a yard has windows, no door
                if pt and i == 2:
                    self.rec, self.rec_wall = OPENINGS["plain_ground"].setdefault(str(h.get("_i")), []), i
                self.wall(c[i], c[(i + 1) % 4], 0, H, style, True, outs[i], door=([back_op] if pt and i == 2 else None), kerb=False)
                self.rec = None
            elif pt and i == 2:
                self.blind_way(c[2], c[3], H, style, outs[2], back_op)
            else:
                self.side_wall(c, street, outs, i, 0, H, style, H)
        if pt:
            back_open = True
            self.poort_tunnel(P, pt, t0, t1, front_op, style, back_open)
            # the kerb's back, across each mouth where a kerb runs along the wall (it has no back face)
            for t, sgn, on in ((t0, 1, True), (t1, -1, bool(street[2] or yard[2]))):
                if not on:
                    continue
                a, b = P(p0, t), P(p1, t)
                self.face([(a[0], 0, a[1]), (b[0], 0, b[1]), (b[0], KERB_H, b[1]), (a[0], KERB_H, a[1])], MAT_STONE,
                          [(0, 0), (pw / BAY, 0), (pw / BAY, KERB_H / BAY), (0, KERB_H / BAY)], (0, 0), (nx * sgn, 0, nz * sgn), 0.35)

            def Wp(s, y, d=0.0):
                x, z = P(s0 + s, t0 - d)
                return (x, y, z)
            self.poort_lantern(Wp, front_op["s"], 3.32, ux, uz, outs[0])
            OPENINGS["poorts"][str(h.get("_i"))] = {"s": [round(p0 - s0, 3), round(p1 - s0, 3)], "h": pt["h"], "kind": kind}
            PASSAGES.append([P(p0 - 0.15, t0 + 0.02), P(p1 + 0.15, t0 + 0.02), P(p1 + 0.15, t1 - 0.02), P(p0 - 0.15, t1 - 0.02)])  # (and 15 cm into its walls: a kerb just behind one shows through)
        if store and street[0]:
            # above each loading gate a column of loading doors, one a storey, under a hoist beam at the eaves
            def Wf(s, y, d=0.0):
                x, z = P(s0 + s, t0 - d)
                return (x, y, z)
            k = 4.5
            while k < W - 3:
                y = self.gh
                while y + 2.6 < H - 0.3:
                    self.loading_door(Wf, k, y, ux, uz, outs[0])
                    y += self.sh
                bx, bz = P(s0 + k, t0 - 0.7)
                self.box(bx, H + 0.35, bz, 0.3, 0.3, 1.6, ux, uz, MAT_WOOD, (0, 0), 0.6)
                k += 9.0
        roof_cell = ROOF_CELL[h["roofMat"]]
        # a row of cottages under one roof line: one pitch for all of them (their plan draws each its own)
        pitch = math.radians(45.0 if cottage else h["pitch"])
        if h["roof"] == "front":
            # ridge runs into the block; gable on the street front (and a plain one at the back)
            rise = min(W / 2 * math.tan(pitch), 9.0)
            sm = (s0 + s1) / 2
            over = 0.35
            for side in (-1, 1):
                se = s0 if side < 0 else s1
                a, b = P(se, t0 - 0.05), P(se, t1 + over)
                r0, r1 = P(sm, t0 - 0.05), P(sm, t1 + over)
                self.face([(a[0], H, a[1]), (b[0], H, b[1]), (r1[0], H + rise, r1[1]), (r0[0], H + rise, r0[1])], MAT_ROOF,
                          [(0, 0), (D / BAY, 0), (D / BAY, (W / 2) / math.cos(pitch) / BAY), (0, (W / 2) / math.cos(pitch) / BAY)],
                          roof_cell, (ux * side, 1.2, uz * side), shade=1.0)
            self.gable(h, P, s0, s1, t0, H, rise, front=True, street=street[0], style=style, rng=rng)
            self.gable(h, P, s0, s1, t1, H, rise, front=False, street=street[2] or yard[2], style=style, rng=rng)
            if rng.random() < 0.6:
                cs, ct = rng.uniform(s0 + 0.8, s1 - 0.8), rng.uniform(t0 + D * 0.5, t1 - 0.6)
                cx, cz = P(cs, ct)
                top = H + rise * (1 - abs(cs - sm) / (W / 2)) + 1.1
                self.box(cx, (H + top) / 2, cz, 0.6, top - H, 0.9, ux, uz, MAT_STONE, (1, 0))
        elif h["roof"] == "side":
            # ridge along the street; plain side gables are party walls
            rise = min(D / 2 * math.tan(pitch), 6.5)
            tm = (t0 + t1) / 2
            over = 0.25 if cottage else 0.4  # (a cottage's eaves over a lane 1.8 m wide: less)
            for side in (-1, 1):
                te = t0 - over if side < 0 else t1 + over
                a, b = P(s0, te), P(s1, te)
                r0, r1 = P(s0, tm), P(s1, tm)
                if cottage:
                    ln = "f" if side < 0 else "b"
                    a, b = P(s0 + adj[(0, ln)], te), P(s1 + adj[(1, ln)], te)
                    r0 = P(s0 + (adj[(0, "f")] + adj[(0, "b")]) / 2, tm)
                    r1 = P(s1 + (adj[(1, "f")] + adj[(1, "b")]) / 2, tm)
                run = abs(te - tm)
                drop = over * math.tan(pitch)
                self.face([(a[0], H - drop, a[1]), (b[0], H - drop, b[1]), (r1[0], H + rise, r1[1]), (r0[0], H + rise, r0[1])], MAT_ROOF,
                          [(0, 0), (W / BAY, 0), (W / BAY, run / math.cos(pitch) / BAY), (0, run / math.cos(pitch) / BAY)],
                          roof_cell, (nx * side, 1.2, nz * side), shade=1.0)
            for e, se, out, flag in ((0, s0, (-ux, 0, -uz), street[3]), (1, s1, (ux, 0, uz), street[1])):
                a, b, r = P(se, t0), P(se, t1), P(se, tm)
                if cottage:
                    a, b = P(se + adj[(e, "f")], t0), P(se + adj[(e, "b")], t1)
                    r = P(se + (adj[(e, "f")] + adj[(e, "b")]) / 2, tm)
                self.face([(a[0], H, a[1]), (b[0], H, b[1]), (r[0], H + rise, r[1])], MAT_FACADE,
                          [(0, 0), (D / BAY, 0), (D / 2 / BAY, rise / self.sh)], (PART_COL["blind"], STYLE_ROW[style]), out)
            # cornice along the street front, and dormers now and then
            if cottage:
                for i in (0, 2):
                    if street[i] or yard[i]:
                        self.cottage_cornice(cc[i], cc[(i + 1) % 4], H, outs[i])
            if street[0]:
                if not cottage:
                    cx, cz = P((s0 + s1) / 2, t0 - 0.15)
                    self.box(cx, H - 0.2, cz, W, 0.35, 0.35, ux, uz, MAT_STONE, (0, 0), 0.85)
                if W > 5 and rng.random() < 0.55:
                    ds = rng.uniform(s0 + 1.4, s1 - 1.4)
                    dx_, dz_ = P(ds, t0 + 1.2)
                    self.dormer(dx_, H + 0.9, dz_, ux, uz, nx, nz, style)
            built = set()
            for _ in range(rng.choice([1, 2])):
                cs = rng.choice([s0 + 0.5, s1 - 0.5])
                if cs in built:
                    continue  # the same end twice: one chimney, not two in one place (z-fight check)
                built.add(cs)
                cx, cz = P(cs, tm)
                self.box(cx, H + rise * 0.5 + 0.6, cz, 0.7, rise + 1.2, 0.7, ux, uz, MAT_STONE, (1, 0))
        else:
            self.flat_top([c[0], c[1], c[2], c[3]], H, street, outs, style)

    def dormer(self, x, y, z, ux, uz, nx, nz, style):
        """A small roof window facing the street."""
        w, hgt, d = 1.3, 1.6, 1.6
        fx, fz = x - nx * d / 2, z - nz * d / 2
        a = (fx - ux * w / 2, fz - uz * w / 2)
        b = (fx + ux * w / 2, fz + uz * w / 2)
        self.face([(a[0], y - 0.6, a[1]), (b[0], y - 0.6, b[1]), (b[0], y + hgt, b[1]), (a[0], y + hgt, a[1])], MAT_FACADE,
                  [(0.33, 0.1), (0.67, 0.1), (0.67, 0.9), (0.33, 0.9)], (PART_COL["upper"], STYLE_ROW[style]), (-nx, 0, -nz))
        self.box(x, y + hgt + 0.15, z, w + 0.3, 0.3, d, ux, uz, MAT_ROOF, ROOF_CELL["slate"], 0.9)

    def gable(self, h, P, s0, s1, t, H, rise, front, street, style, rng):
        """The wall triangle above the eaves, with its outline: stepped, bell (spout) or plain."""
        W = s1 - s0
        sm = (s0 + s1) / 2
        kind = h["gable"] if front else "plain"
        tt = t - 0.02 if front else t + 0.02
        if kind == "step":
            k = max(3, min(6, int(W / 1.3)))
            dw = (W / 2) / (k + 0.4)
            pts = [(s0, 0.0)]
            for i in range(k):
                x_in = s0 + (i + 1) * dw
                y_top = (x_in - s0) * rise / (W / 2) + 0.45
                pts += [(s0 + i * dw, y_top), (x_in, y_top)]
            top = rise + 1.0
            pts += [(sm - dw * 0.4, top), (sm + dw * 0.4, top)]
            right = [(s1 - (x - s0), y) for x, y in reversed(pts[1:-2])]
            pts += right + [(s1, 0.0)]
        elif kind == "spout":
            n = 7
            neck = W * 0.2
            pts = [(s0, 0.0)]
            for i in range(1, n + 1):
                f = i / n
                x = s0 + (sm - neck / 2 - s0) * (1 - (1 - f) ** 2)
                pts.append((x, rise * 0.78 * f + 0.25))
            pts += [(sm - neck / 2, rise * 1.02), (sm, rise * 1.18), (sm + neck / 2, rise * 1.02)]
            for i in range(n, 0, -1):
                f = i / n
                x = s1 - (s1 - (sm + neck / 2)) * (1 - (1 - f) ** 2)
                pts.append((x, rise * 0.78 * f + 0.25))
            pts.append((s1, 0.0))
        else:
            pts = [(s0, 0.0), (sm, rise + 0.18), (s1, 0.0)]
        out = (-h["n"][0], 0, -h["n"][1]) if front else (h["n"][0], 0, h["n"][1])
        world = []
        uvs = []
        for s, y in pts:
            wx, wz = P(s, tt)
            world.append((wx, H + y, wz))
            uvs.append(((s - s0) / BAY, (H - self.gh) / self.sh + y / self.sh))
        part = "upper" if street else "blind"
        cell = (PART_COL[part], STYLE_ROW[style])
        self.ngon(world, uvs, cell, out)
        # the back of the gable, so the steps do not vanish when seen from the roof side
        back = [(p[0] + h["n"][0] * 0.25 * (1 if front else -1), p[1], p[2] + h["n"][1] * 0.25 * (1 if front else -1)) for p in world]
        self.ngon(back, uvs, (PART_COL["blind"], STYLE_ROW[style]), (-out[0], 0, -out[2]))
        if kind == "step":
            # coping stones on each step
            for i in range(1, len(pts) - 1, 2):
                (sa, ya), (sb, yb) = pts[i], pts[i + 1]
                if abs(ya - yb) < 1e-3 and abs(sb - sa) > 0.1:
                    # 5 cm over each side, but not past the house's own edge: there the neighbour's
                    # coping lay in the same planes (z-fight check)
                    ca, cb = max(s0, min(sa, sb) - 0.05), min(s1, max(sa, sb) + 0.05)
                    cx, cz = P((ca + cb) / 2, tt + (0.12 if front else -0.12))
                    self.box(cx, H + ya + 0.08, cz, cb - ca, 0.16, 0.45, h["u"][0], h["u"][1], MAT_STONE, (0, 0), 0.95)

    def ngon(self, world, uvs, cell, out):
        verts = [self.bm.verts.new(B(*p)) for p in world]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
        f.material_index = MAT_FACADE
        f.normal_update()
        if f.normal.dot(B(*out)) < 0:
            f.normal_flip()
        for loop in f.loops:
            i = verts.index(loop.vert)
            loop[self.uv].uv = uvs[i]
            loop[self.cell].uv = cell
            g = 0.66 + 0.34 * min(1.0, world[i][1] / 9.0)
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, 1.0)

    def flat_top(self, ring, H, street, outs, style):
        """Flat roof behind a low parapet: walls already built; a lip and a top."""
        top = [(x, H + 0.1, z) for x, z in ring]
        n = len(ring)
        uvs = [(x / BAY, z / BAY) for x, z in ring]
        self.face(top, MAT_ROOF, uvs, ROOF_CELL["flat"], (0, 1, 0), shade=0.9)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            if street[i]:
                self.wall(a, b, H, H + 0.6, style, False, outs[i] if i < len(outs) else (0, 0, 0))
            else:  # the parapet's sides stop short of a seam too (side_wall)
                self.side_wall(ring, street, outs, i, H, H + 0.6, style, H + 0.6)

    # ---------------------------------------------------------------- cottages (the back alleys)
    # The beluiken of the poor behind the street fronts: rows of one- and two-storey houses on lanes 1.8 to
    # 2.4 m wide. Plain whitewashed or brick walls, small sash windows (the painted glass of the facade atlas's
    # upper-storey cell, with its shutters on plaster), a low door under a small transom, a stone sill under
    # each window, a cornice under the eaves that runs on from house to house, no kerb.

    WIN_H = 1.3  # a cottage window with its painted lintel and sill
    WIN_PX = {True: (12, 52), False: (18, 46)}  # the window's columns in the upper cell: with shutters, without

    def cottage_wall(self, a, b, H, style, f, door):
        """A cottage wall a -> b (world x, z), 0..H, looking along f; door: a flat-topped door spec, or None."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05:
            return
        GROUND_WALLS.append((a, b))
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        row = STYLE_ROW[style]
        shut = row in (1, 2)

        def pxs(sh):
            return self.WIN_PX[sh] if sh or not shut else (19, 45)  # (a row with shutters, a window without: no shutter edge)

        def wwid(sh):
            px0, px1 = pxs(sh)
            return self.WIN_H * (px1 - px0) / 47.0
        gh = min(H, self.gh)
        st = max(1, round((H - self.gh) / self.sh) + 1)
        # the window columns: in the spans the door leaves free, evenly, at least 0.45 m of wall between
        spans = [(0.22, L - 0.22)]
        if door:
            dl, dr = door["s"] - door["w"] / 2 - door["J"] - 0.15, door["s"] + door["w"] / 2 + door["J"] + 0.15
            spans = [(0.22, dl), (dr, L - 0.22)]
        cols = []  # (s, with shutters)
        for sa, sb in spans:
            for sh in ((True, False) if shut else (False,)):
                ww = wwid(sh)
                n = int((sb - sa + 0.45) / (ww + 0.45)) if sb - sa >= ww else 0
                if n:
                    n = min(n, max(1, round((sb - sa) / 2.0)))
                    cols += [(sa + (sb - sa) * (k + 0.5) / n, sh) for k in range(n)]
                    break
        rows = [(1.0, 1.0 + self.WIN_H)]
        if st >= 2:
            top = H - 0.75 - self.WIN_H
            for k in range(1, st):
                y0 = 1.0 + self.WIN_H + 0.3 + (top - 1.3 - self.WIN_H) * k / (st - 1)
                rows.append((y0, y0 + self.WIN_H))
        wins = []
        for r, (y0, y1) in enumerate(rows):
            for cs, sh in cols + ([(door["s"], shut)] if door and r > 0 else []):
                ww = wwid(sh)
                wins.append({"s0": cs - ww / 2, "s1": cs + ww / 2, "y0": y0, "y1": y1, "sh": sh})
        holes = list(wins)
        if door:
            holes.append({"s0": door["s"] - door["w"] / 2, "s1": door["s"] + door["w"] / 2, "y0": 0.0, "y1": door["ys"]})
        # the wall: columns split at the holes' sides, each column split only at its own holes' tops and
        # bottoms; the plain ground wall with its plinth below the first floor, plain wall above
        xs = sorted({0.0, L, *[v for hl in holes for v in (hl["s0"], hl["s1"])]})
        for sa, sb in zip(xs, xs[1:]):
            here = [hl for hl in holes if hl["s0"] < (sa + sb) / 2 < hl["s1"]]
            ys = sorted({0.0, H, *([gh] if gh < H else []), *[v for hl in here for v in (hl["y0"], hl["y1"])]})
            for ya, yb in zip(ys, ys[1:]):
                sm, ym = (sa + sb) / 2, (ya + yb) / 2
                if any(hl["s0"] < sm < hl["s1"] and hl["y0"] < ym < hl["y1"] for hl in holes):
                    continue
                if ym < gh:
                    cell, uvs = (PART_COL["door"], row), [(s / BAY, y / self.gh) for s, y in ((sa, ya), (sb, ya), (sb, yb), (sa, yb))]
                else:
                    cell, uvs = (PART_COL["blind"], row), [(s / BAY, (y - self.gh) / self.sh) for s, y in ((sa, ya), (sb, ya), (sb, yb), (sa, yb))]
                self.face([W(sa, ya), W(sb, ya), W(sb, yb), W(sa, yb)], MAT_FACADE, uvs, cell, f)
        # the windows: the painted sash (and shutters) of the upper-storey cell, in the wall's plane
        v0, v1 = 1 - 55 / 64.0, 1 - 8 / 64.0
        stone = 0.95 if shut else 0.8
        if self.rec_win is not None:
            for wn in wins:
                self.rec_win.append([self.rec_wall, round((wn["s0"] + wn["s1"]) / 2, 3), round(wn["s1"] - wn["s0"], 3), round(wn["y0"], 3), round(wn["y1"], 3)])
        for wn in wins:
            px0, px1 = pxs(wn["sh"])
            u0, u1 = px0 / 64.0, px1 / 64.0
            glass = ((wn["s1"] - wn["s0"]) * 28 / (px1 - px0)) / 2  # half the window without its shutters
            self.face([W(wn["s0"], wn["y0"]), W(wn["s1"], wn["y0"]), W(wn["s1"], wn["y1"]), W(wn["s0"], wn["y1"])], MAT_FACADE,
                      [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], (PART_COL["upper"], row), f)
            sm = (wn["s0"] + wn["s1"]) / 2
            self.slab(W, ux, uz, f, sm - glass - 0.04, sm + glass + 0.04, wn["y0"] - 0.05, wn["y0"] + 0.03, 0, 0.07, stone * 0.9, under=wn["y0"] > 1.7)
        if door:
            self.doorway(W, door, self.arc_pts(door), ux, uz, f, stone)

    def cottage_cornice(self, a, b, H, f):
        """A cornice under the eaves: front, top, bottom; no end face where the next cottage's runs on."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05:
            return
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]
        y0, y1, d = H - 0.44, H - 0.22, 0.13

        def Wc(s, y, e):
            return (a[0] + ux * s + fx * e, y, a[1] + uz * s + fz * e)
        g = 0.8
        uv = [(0, 0), (L / BAY, 0), (L / BAY, 0.07), (0, 0.07)]
        self.face([Wc(0, y0, d), Wc(L, y0, d), Wc(L, y1, d), Wc(0, y1, d)], MAT_STONE, uv, (0, 0), f, g)
        self.face([Wc(0, y1, 0), Wc(L, y1, 0), Wc(L, y1, d), Wc(0, y1, d)], MAT_STONE, uv, (0, 0), (0, 1, 0), g * 1.05)
        self.face([Wc(0, y0, 0), Wc(L, y0, 0), Wc(L, y0, d), Wc(0, y0, d)], MAT_STONE, uv, (0, 0), (0, -1, 0), g * 0.6)
        for s, p, sgn in ((0.0, a, -1), (L, b, 1)):
            if cornice_runs_on(self.hid, p, f, H):
                continue
            self.face([Wc(s, y0, 0), Wc(s, y0, d), Wc(s, y1, d), Wc(s, y1, 0)], MAT_STONE, uv, (0, 0), (ux * sgn, 0, uz * sgn), g * 0.8)

    def poly_house(self, h, rng):
        fp = h["fp"]
        H = h["h"]
        n = len(fp)
        area = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n))
        outs = []
        lens = [math.hypot(fp[(i + 1) % n][0] - fp[i][0], fp[(i + 1) % n][1] - fp[i][1]) * h["street"][i] for i in range(n)]
        door_i = max(range(n), key=lambda i: lens[i])
        for i in range(n):
            a, b = fp[i], fp[(i + 1) % n]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            ox, oz = dz / L, -dx / L
            if area < 0:
                ox, oz = -ox, -oz
            outs.append((ox, 0, oz))
        yard = h.get("yard") or [0] * n
        for i in range(n):
            a, b = fp[i], fp[(i + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            if not h["street"][i]:
                if yard[i]:
                    self.wall(a, b, 0, H, h["style"], True, outs[i], kerb=False)  # on a back yard (alleys.py): windows, no door
                else:
                    self.side_wall(fp, h["street"], outs, i, 0, H, h["style"], H)
                continue
            ops = None
            iw = INWORLD.get(h.get("_i"))
            if i == door_i and lens[i] > 2:
                bays = max(1, round(L / BAY))
                ops = [self.inworld_door(iw["door"]) if iw else self.door_spec((bays // 2 + 0.5) * L / bays, L, L / bays, random.Random(h["seed"] * 31 + 1873))]
            self.wall(a, b, 0, H, h["style"], True, outs[i], door=ops, holes=([q for q in iw["holes"] if q["wall"] == 0] if iw and i == door_i else None))
        # a hipped roof: every eave edge slopes up to one point over the middle
        # (corner plots are odd shapes; old Antwerp had almost no flat roofs)
        cx = sum(p[0] for p in fp) / n
        cz = sum(p[1] for p in fp) / n
        rise = min(5.0, 0.45 * math.sqrt(abs(area) / 2))
        cell = ROOF_CELL[h["roofMat"]]
        for i in range(n):
            a, b = fp[i], fp[(i + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            d = abs((b[0] - a[0]) * (cz - a[1]) - (b[1] - a[1]) * (cx - a[0])) / (L or 1)
            slope = math.hypot(d, rise)
            self.face([(a[0], H, a[1]), (b[0], H, b[1]), (cx, H + rise, cz)], MAT_ROOF,
                      [(0, 0), (L / BAY, 0), (L / 2 / BAY, slope / BAY)], cell, (outs[i][0], 1.0, outs[i][2]), shade=1.0)
        # a cornice under the eaves on the street sides
        for i in range(n):
            if h["street"][i]:
                a, b = fp[i], fp[(i + 1) % n]
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L > 1:
                    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                    mx, mz = (a[0] + b[0]) / 2 + outs[i][0] * 0.15, (a[1] + b[1]) / 2 + outs[i][2] * 0.15
                    self.box(mx, H - 0.2, mz, L, 0.35, 0.35, ux, uz, MAT_STONE, (0, 0), 0.85)

    def back(self, b):
        fp = b["fp"]
        H = b["h"]
        self.tint = (0.8, 0.78, 0.76)
        n = len(fp)
        area = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n))
        for i in range(n):
            a, c = fp[i], fp[(i + 1) % n]
            dx, dz = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dz) or 1
            ox, oz = dz / L, -dx / L
            if area < 0:
                ox, oz = -ox, -oz
            self.wall(a, c, 0, H, "brick_dark", False, (ox, 0, oz))
        verts = [self.bm.verts.new(B(x, H, z)) for x, z in fp]
        try:
            f = self.bm.faces.new(verts)
            f.material_index = MAT_ROOF
            f.normal_update()
            if f.normal.dot(B(0, 1, 0)) < 0:
                f.normal_flip()
            for loop in f.loops:
                i = verts.index(loop.vert)
                loop[self.uv].uv = (fp[i][0] / BAY, fp[i][1] / BAY)
                loop[self.cell].uv = ROOF_CELL["tile"]
                loop[self.col] = (0.7, 0.66, 0.64, 1)
        except ValueError:
            pass

    # ------------------------------------------------------------ bridges

    def bridge(self, br):
        """A bridge over a canal or the lock: its long side spans the water.
        stone: an arch with parapets; swing: a timber deck with iron railings."""
        x0, z0, x1, z1 = br["rect"]
        along_x = (x1 - x0) >= (z1 - z0)
        # local frame: s spans the water, w across the deck
        if along_x:
            s0, s1, w0, w1 = x0, x1, z0, z1
            P = lambda s, y, w: (s, y, w)  # noqa: E731
            ux, uz = 1.0, 0.0
        else:
            s0, s1, w0, w1 = z0, z1, x0, x1
            P = lambda s, y, w: (w, y, s)  # noqa: E731
            ux, uz = 0.0, 1.0
        self.tint = (1, 1, 1)
        span = s1 - s0
        wm = (w0 + w1) / 2
        if br["kind"] == "stone":
            top = 0.05
            bottom = -3.4
            spring = -1.9
            a0, a1 = s0 + 2.2, s1 - 2.2
            apex = -0.55
            arch = []
            n = 10
            for i in range(n + 1):
                t = math.pi * i / n
                arch.append(((a0 + a1) / 2 - math.cos(t) * (a1 - a0) / 2, spring + math.sin(t) * (apex - spring)))
            for w, sign in ((w0, -1), (w1, 1)):
                outline = [(s0, bottom), (a0, bottom)] + arch + [(a1, bottom), (s1, bottom), (s1, top), (s0, top)]
                pts = [P(s, y, w) for s, y in outline]
                out = (0, 0, sign) if along_x else (sign, 0, 0)
                self.ngon_mat(pts, [(s / BAY, y / BAY) for s, y in outline], MAT_STONE, (0, 0), out, 0.85)
            # the underside of the arch
            for i in range(n):
                (sa, ya), (sb, yb) = arch[i], arch[i + 1]
                self.face([P(sa, ya, w0), P(sb, yb, w0), P(sb, yb, w1), P(sa, ya, w1)], MAT_STONE,
                          [(0, 0), (1, 0), (1, (w1 - w0) / BAY), (0, (w1 - w0) / BAY)], (0, 0), (0, -1, 0), 0.55)
            # the deck and the parapets with their coping
            self.face([P(s0, top, w0), P(s1, top, w0), P(s1, top, w1), P(s0, top, w1)], MAT_STONE,
                      [(0, 0), (span / 2, 0), (span / 2, (w1 - w0) / 2), (0, (w1 - w0) / 2)], (0, 0), (0, 1, 0), 0.8)
            for w in (w0 + 0.2, w1 - 0.2):
                c = P((s0 + s1) / 2, 0.5, w)
                self.box(c[0], c[1], c[2], span, 0.9, 0.4, ux, uz, MAT_STONE, (0, 0), 0.9)
                c = P((s0 + s1) / 2, 1.0, w)
                self.box(c[0], c[1], c[2], span + 0.2, 0.12, 0.55, ux, uz, MAT_STONE, (0, 0), 1.0)
        else:
            # timber swing bridge: deck on two iron girders, railings of posts and two rails
            self.box(*P((s0 + s1) / 2, -0.15, wm), span, 0.3, w1 - w0, ux, uz, MAT_WOOD, (0, 0), 0.8)
            for w in (w0 + 0.6, w1 - 0.6):
                self.box(*P((s0 + s1) / 2, -0.7, w), span, 0.8, 0.3, ux, uz, MAT_STONE, (0, 0), 0.3)
            for w in (w0 + 0.1, w1 - 0.1):
                k = 0
                s = s0 + 0.3
                while s < s1:
                    self.box(*P(s, 0.55, w), 0.1, 1.1, 0.1, ux, uz, MAT_STONE, (0, 0), 0.25)
                    s += 1.6
                    k += 1
                for y in (0.55, 1.05):
                    self.box(*P((s0 + s1) / 2, y, w), span, 0.07, 0.07, ux, uz, MAT_STONE, (0, 0), 0.25)

    def ngon_mat(self, world, uvs, mat, cell, out, shade):
        verts = [self.bm.verts.new(B(*p)) for p in world]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
        f.material_index = mat
        f.normal_update()
        if f.normal.dot(B(*out)) < 0:
            f.normal_flip()
        for loop in f.loops:
            i = verts.index(loop.vert)
            loop[self.uv].uv = uvs[i]
            loop[self.cell].uv = cell
            loop[self.col] = (shade, shade, shade, 1.0)

    # ------------------------------------------------------------ street furniture

    def tree(self, x, z, rng):
        """A young tree in autumn, like the rows on the Steenplein: a thin trunk and
        a crown of three low-poly clumps in yellow, rust and faded green."""
        h = rng.uniform(3.6, 4.6)
        self.box(x, h / 2, z, 0.22, h, 0.22, 1.0, 0.0, MAT_WOOD, (0, 0), 0.35)
        colours = [(1.0, 0.86, 0.72), (0.92, 0.72, 0.62), (0.78, 0.9, 0.7), (1.0, 0.96, 0.78)]  # tints over the leaf texture
        for i in range(5):
            cx = x + rng.uniform(-0.9, 0.9)
            cz = z + rng.uniform(-0.9, 0.9)
            cy = h * 0.72 + i * 0.55 + rng.uniform(0.0, 0.5)
            r = rng.uniform(1.0, 1.5) * (1.0 - i * 0.1)
            col = rng.choice(colours)
            ret = bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=r)
            for v in ret["verts"]:
                v.co = B(cx + v.co.x, cy + v.co.z * 1.1, cz - v.co.y)
            faces = {f for v in ret["verts"] for f in v.link_faces}
            for f in faces:
                f.material_index = MAT_LEAF
                f.normal_update()
                for loop in f.loops:
                    co = loop.vert.co
                    loop[self.uv].uv = (co.x / 1.5, co.z / 1.5)
                    loop[self.cell].uv = (0, 0)
                    g = 0.75 + 0.25 * (co.z - (cy - r)) / (2 * r)
                    loop[self.col] = (col[0] * g, col[1] * g, col[2] * g, 1.0)

    def track(self, x0, z0, x1, z1):
        """A railway track laid in the cobbles: two iron rails, standard gauge."""
        L = math.hypot(x1 - x0, z1 - z0)
        ux, uz = (x1 - x0) / L, (z1 - z0) / L
        nx, nz = -uz, ux
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        for off in (-0.72, 0.72):
            self.box(mx + nx * off, 0.018, mz + nz * off, L, 0.036, 0.07, ux, uz, MAT_STONE, (0, 0), 0.25)
        # the stone setts along the rails
        self.box(mx, 0.006, mz, L, 0.012, 2.1, ux, uz, MAT_STONE, (0, 0), 0.55)

    def rail(self, x0, z0, x1, z1):
        """An iron railing along the water: posts every 2 m, a top rail and a middle rail."""
        L = math.hypot(x1 - x0, z1 - z0)
        if L < 0.1:
            return
        ux, uz = (x1 - x0) / L, (z1 - z0) / L
        n = max(1, int(L / 2.0))
        for i in range(n + 1):
            t = i / n
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            key = (round(px, 1), round(pz, 1))
            if key in RAIL_POSTS:
                continue  # where two runs of railing meet: one post, not two in one place (z-fight check)
            RAIL_POSTS.add(key)
            self.box(px, 0.55, pz, 0.09, 1.1, 0.09, ux, uz, MAT_STONE, (0, 0), 0.22)
        for y in (0.6, 1.08):
            self.box((x0 + x1) / 2, y, (z0 + z1) / 2, L, 0.06, 0.06, ux, uz, MAT_STONE, (0, 0), 0.22)

    def to_object(self, name, mats):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


KERB_D, KERB_H = 0.7, 0.12
SEAM_SET = 0.15  # a party wall stops this far behind the fronts where two fronts meet (side_wall)
FRONT_ENDS = {}  # the ends of every house's street walls, by 0.5 m cell: (x, z, outward, h, house id)


def house_ring(h):
    """A house's footprint and each wall's outward normal (x, 0, z), as the builder makes them."""
    if h["rect"]:
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        (s0, s1), (t0, t1) = h["s"], h["t"]
        ring = [(ox + ux * s + nx * t, oz + uz * s + nz * t) for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
        return ring, [(-nx, 0, -nz), (ux, 0, uz), (nx, 0, nz), (-ux, 0, -uz)]
    ring = h["fp"]
    n = len(ring)
    area = sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))
    outs = []
    for i in range(n):
        (ax, az), (bx, bz) = ring[i], ring[(i + 1) % n]
        L = math.hypot(bx - ax, bz - az) or 1
        ox, oz = (bz - az) / L, -(bx - ax) / L
        outs.append((-ox, 0, -oz) if area < 0 else (ox, 0, oz))
    return ring, outs


def index_fronts(houses):
    for h in houses:
        ring, outs = house_ring(h)
        for i in range(len(ring)):
            if h["street"][i]:
                for x, z in (ring[i], ring[(i + 1) % len(ring)]):
                    FRONT_ENDS.setdefault((round(x * 2), round(z * 2)), []).append((x, z, outs[i], h["h"], id(h)))


def seam_cover(hid, p, f, H):
    """Up to what height a neighbour's front meets this house's front at the corner p (f: the
    front's outward normal): the neighbour's front ends there, on the same line, not set back.
    0: no seam, the house's side is open there."""
    best = 0.0
    kx, kz = round(p[0] * 2), round(p[1] * 2)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for x, z, g, hh, oid in FRONT_ENDS.get((kx + i, kz + j), ()):
                if oid == hid or g[0] * f[0] + g[2] * f[2] < 0.5:  # on one line, or a bend in the street
                    continue
                dx, dz = x - p[0], z - p[1]
                off = dx * f[0] + dz * f[2]  # > 0: the neighbour's front stands before this one
                along = abs(dx * f[2] - dz * f[0])
                if along < 0.03 and -0.01 < off < 0.3:
                    best = max(best, min(H, hh))
    return best


def cornice_runs_on(hid, p, f, H):
    """Does another cottage's front of the same height run on from the corner p, on the same line?"""
    kx, kz = round(p[0] * 2), round(p[1] * 2)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for x, z, g, hh, oid in FRONT_ENDS.get((kx + i, kz + j), ()):
                if oid == hid or g[0] * f[0] + g[2] * f[2] < 0.999 or abs(hh - H) > 0.01:
                    continue
                if math.hypot(x - p[0], z - p[1]) < 0.02 and ID_ALLEY.get(oid):
                    return True
    return False


def row_meet(hid, p, f, u):
    """How far (along u) the corner p of a cottage's front or back (outward f) moves to meet the next house's
    corner on the same line: halfway to a cottage's (it moves the other half), all the way to another house's."""
    kx, kz = round(p[0] * 2), round(p[1] * 2)
    best = None
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for x, z, g, hh, oid in FRONT_ENDS.get((kx + i, kz + j), ()):
                if oid == hid or g[0] * f[0] + g[2] * f[2] < 0.999:
                    continue
                dx, dz = x - p[0], z - p[1]
                along = dx * u[0] + dz * u[1]
                if abs(dx * f[0] + dz * f[2]) < 0.012 and abs(along) < 0.03 and (best is None or abs(along) < abs(best[0])):
                    best = (along, ID_ALLEY.get(oid))
    if best is None:
        return None
    return best[0] / 2 if best[1] else best[0]


ID_ALLEY = {}  # id(house) -> a cottage of the back alleys
# M7 back alleys: where this builder put openings the plan does not say, for the game's lit windows and street
# life (carried in city.glb, node "city_openings"): by house index; walls numbered as the rect ring (0 front,
# 1 right side, 2 back, 3 left side), s in metres from the wall's first corner
OPENINGS = {"poorts": {}, "plain_ground": {}, "cottages": {}}
PASSAGES = []  # the covered passages' insides, as world rectangles (4 corners): no kerb runs in there
KERBS = []  # the kerb along every street wall: {a, b, f (outward), tint, bld}
RAIL_POSTS = set()  # railing posts already standing
GROUND_WALLS = []  # every wall standing on the ground: (a, b), for the kerbs' ends


def build_kerbs(kerbs):
    """The stone kerb along the street walls. Built per house as a box, the kerbs of neighbours
    lay faces in one plane that flicker (z-fight check, `__scheldemist.zfight()`): the back on the
    wall, the ends where two kerbs meet, the tops where two overlap at a corner. So: no back face;
    a kerb that meets the next one on its line ends exactly there, without an end face; a kerb that
    runs into another at a corner stops at the other's front, again without an end face. The first
    kerb built keeps the corner."""
    ks = []
    for k in kerbs:
        (ax, az), (bx, bz), (fx, fz) = k["a"], k["b"], k["f"]
        L = math.hypot(bx - ax, bz - az)
        if L < 0.05:
            continue
        ux, uz = fz, -fx  # along the wall, the same way for every kerb facing f
        s_a = ax * ux + az * uz
        s_b = bx * ux + bz * uz
        ks.append(dict(k, ux=ux, uz=uz, d=ax * fx + az * fz, s0=min(s_a, s_b), s1=max(s_a, s_b), open0=True, open1=True))
    # 0. no kerb inside a covered passage (a house's kerb on a yard can run along the next house's side, inside
    # it, where that house now has its passage): cut out of it the stretch that runs through the passage
    def corners(k):
        (fx, fz), ux, uz = k["f"], k["ux"], k["uz"]
        return [(ux * s + fx * (k["d"] + e), uz * s + fz * (k["d"] + e)) for s, e in ((k["s0"], 0), (k["s1"], 0), (k["s1"], KERB_D), (k["s0"], KERB_D))]

    def apart(pa, pb):
        for poly in (pa, pb):
            for i in range(4):
                (x0, z0), (x1, z1) = poly[i], poly[(i + 1) % 4]
                nx, nz = z1 - z0, x0 - x1
                da = [x * nx + z * nz for x, z in pa]
                db = [x * nx + z * nz for x, z in pb]
                if max(da) <= min(db) + 1e-6 or max(db) <= min(da) + 1e-6:
                    return True
        return False
    for pa in PASSAGES:
        for k in list(ks):
            if k["s1"] - k["s0"] < 0.05 or apart(corners(k), pa):
                continue
            along = [x * k["ux"] + z * k["uz"] for x, z in pa]
            a, b = max(k["s0"], min(along)), min(k["s1"], max(along))
            if b > a:
                if b < k["s1"] - 0.05:
                    ks.append(dict(k, s0=b, open0=False))
                k["s1"], k["open1"] = a, False
    # 1. neighbours on one line: meet exactly, no end faces between them
    lines = {}
    for k in ks:
        ang = round(math.degrees(math.atan2(k["f"][1], k["f"][0])) * 2) / 2
        lines.setdefault(ang, []).append(k)
    for group in lines.values():
        group.sort(key=lambda k: (round(k["d"], 1), k["s0"]))
        for i, k1 in enumerate(group):
            for k2 in group[i + 1:]:
                if abs(k2["d"] - k1["d"]) > 0.15 or k2["s0"] > k1["s1"] + 0.03:
                    continue
                k2["d"] = k1["d"]  # fronts a few cm apart: one line of kerb
                if k2["s1"] <= k1["s1"] + 1e-3 and k2["s0"] >= k1["s0"] - 1e-3:
                    k2["s1"] = k2["s0"]  # inside the other: gone
                    continue
                if k2["s0"] < k1["s1"] + 0.03 and k2["s1"] > k1["s1"]:
                    k2["s0"] = k1["s1"]
                    k1["open1"] = k2["open0"] = False
    # 2. across: a kerb that runs into an earlier one stops at its front
    def rect(k):
        (fx, fz), ux, uz = k["f"], k["ux"], k["uz"]
        return [(ux * s + fx * (k["d"] + e), uz * s + fz * (k["d"] + e)) for s, e in ((k["s0"], 0), (k["s1"], 0), (k["s1"], KERB_D), (k["s0"], KERB_D))]
    for i, k in enumerate(ks):
        if k["s1"] - k["s0"] < 0.05:
            continue
        for j in range(i):
            o = ks[j]
            if o["s1"] - o["s0"] < 0.05 or abs(o["f"][0] * k["f"][0] + o["f"][1] * k["f"][1]) > 0.99:
                continue
            ro = rect(o)
            # o's rectangle in k's frame: along (s) and out (e)
            ss = [x * k["ux"] + z * k["uz"] for x, z in ro]
            es = [x * k["f"][0] + z * k["f"][1] - k["d"] for x, z in ro]
            if max(es) <= 1e-3 or min(es) >= KERB_D - 1e-3 or max(ss) <= k["s0"] + 1e-3 or min(ss) >= k["s1"] - 1e-3:
                continue
            if min(ss) <= k["s0"] + 0.05:
                k["s0"], k["open0"] = max(k["s0"], max(ss)), False
            elif max(ss) >= k["s1"] - 0.05:
                k["s1"], k["open1"] = min(k["s1"], min(ss)), False
            else:  # the other runs into its middle: two kerbs, one each side
                ks.append(dict(k, s0=max(ss), open0=False))
                k["s1"], k["open1"] = min(ss), False
    # 3. an end against a wall or inside another kerb: no end face (it would lie in the wall's plane)
    live = [k for k in ks if k["s1"] - k["s0"] >= 0.05]

    def inside(o, x, z):
        s_ = x * o["ux"] + z * o["uz"]
        e_ = x * o["f"][0] + z * o["f"][1] - o["d"]
        return o["s0"] - 1e-3 < s_ < o["s1"] + 1e-3 and -1e-3 < e_ < KERB_D + 1e-3

    for k in live:
        (fx, fz), ux, uz, d = k["f"], k["ux"], k["uz"], k["d"]
        for end, sgn, key in ((k["s0"], -1, "open0"), (k["s1"], 1, "open1")):
            if not k[key]:
                continue
            for e in (0.2, 0.5):
                cx, cz = ux * end + fx * (d + e), uz * end + fz * (d + e)
                px, pz = cx + ux * sgn * 0.01, cz + uz * sgn * 0.01
                if any(o is not k and inside(o, px, pz) for o in live):
                    k[key] = False
                for (ax, az), (bx, bz) in GROUND_WALLS:
                    wl = math.hypot(bx - ax, bz - az)
                    if wl < 0.05 or abs(((bx - ax) * ux + (bz - az) * uz) / wl) > 0.02:
                        continue
                    t = ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / (wl * wl)
                    dist = abs((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / wl
                    if -0.01 < t < 1.01 and dist < 0.015:
                        k[key] = False
    n = 0
    for k in ks:
        if k["s1"] - k["s0"] < 0.05:
            continue
        bld = k["bld"]
        bld.tint = k["tint"]
        (fx, fz), ux, uz, d = k["f"], k["ux"], k["uz"], k["d"]

        def P(s, y, e):
            return (ux * s + fx * (d + e), y, uz * s + fz * (d + e))
        sx = k["s1"] - k["s0"]
        uv = [(0, 0), (sx / BAY, 0), (sx / BAY, KERB_H / BAY), (0, KERB_H / BAY)]
        s0, s1, H = k["s0"], k["s1"], KERB_H
        bld.face([P(s0, 0, KERB_D), P(s1, 0, KERB_D), P(s1, H, KERB_D), P(s0, H, KERB_D)], MAT_STONE, uv, (0, 0), (fx, 0, fz), 0.42)
        bld.face([P(s0, H, 0), P(s1, H, 0), P(s1, H, KERB_D), P(s0, H, KERB_D)], MAT_STONE, uv, (0, 0), (0, 1, 0), 0.42)
        if k["open0"]:
            bld.face([P(s0, 0, 0), P(s0, 0, KERB_D), P(s0, H, KERB_D), P(s0, H, 0)], MAT_STONE, uv, (0, 0), (-ux, 0, -uz), 0.42)
        if k["open1"]:
            bld.face([P(s1, 0, 0), P(s1, 0, KERB_D), P(s1, H, KERB_D), P(s1, H, 0)], MAT_STONE, uv, (0, 0), (ux, 0, uz), 0.42)
        n += 1
    return n


def material(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 1.0
    return m


SHOTS = os.path.join(ROOT, "data", "shots")


def preview_materials():
    """Preview only: the game's own textures on the materials, as client/src/world/city.ts and
    retro/psx.ts draw them: an atlas cell per face (uv repeats inside it), times the vertex colour.
    The atlases are the game's canvases saved once to data/shots/city_atlas_*.jpg (cityTextures.ts)."""
    spec = {"facade": ("city_atlas_facade.jpg", 8), "roof": ("city_atlas_roof.jpg", 2), "stone": ("city_atlas_stone.jpg", 0),
            "wood": ("city_atlas_planks.jpg", 0), "leaves": ("city_atlas_stone.jpg", 0)}
    for name, (fn, n) in spec.items():
        m = bpy.data.materials.get(name)
        path = os.path.join(SHOTS, fn)
        if m is None or not os.path.exists(path):
            continue
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        fr = nt.nodes.new("ShaderNodeVectorMath")
        fr.operation = "FRACTION"
        nt.links.new(uv.outputs[0], fr.inputs[0])
        vec = fr.outputs[0]
        if n:
            cell = nt.nodes.new("ShaderNodeUVMap")
            cell.uv_map = "Cell"
            rd = nt.nodes.new("ShaderNodeVectorMath")
            rd.operation = "ROUND"
            nt.links.new(cell.outputs[0], rd.inputs[0])
            add = nt.nodes.new("ShaderNodeVectorMath")
            add.operation = "ADD"
            nt.links.new(fr.outputs[0], add.inputs[0])
            nt.links.new(rd.outputs[0], add.inputs[1])
            sc_ = nt.nodes.new("ShaderNodeVectorMath")
            sc_.operation = "SCALE"
            sc_.inputs["Scale"].default_value = 1.0 / n
            nt.links.new(add.outputs[0], sc_.inputs[0])
            vec = sc_.outputs[0]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path, check_existing=True)
        tex.interpolation = "Closest"
        nt.links.new(vec, tex.inputs[0])
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Color"])
        nt.links.new(bsdf.outputs[0], out.inputs[0])


def preview_stage():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("sky")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.62, 0.66, 0.7, 1)
    bg.inputs[1].default_value = 1.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.6
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(38), math.radians(8), math.radians(-35))
    sc.collection.objects.link(sun)
    # the ground: one cobble-grey plane (the game draws its own paving)
    me = bpy.data.meshes.new("prev_ground")
    bm = bmesh.new()
    vs = [bm.verts.new(B(x, -0.002, z)) for x, z in ((-700, -300), (600, -300), (600, 800), (-700, 800))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    gm = bpy.data.materials.new("prev_ground_m")
    gm.use_nodes = True
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.21, 0.2, 0.19, 1)
    me.materials.append(gm)
    sc.collection.objects.link(bpy.data.objects.new("prev_ground", me))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_start = 0.05
    cam.data.clip_end = 600
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def preview_views(data):
    """Close views of the passages, the gangs, the courts and the alley houses: (name, eye, look, lens)."""
    views = []
    city = json.load(open(os.path.join(ROOT, "shared", "city.json")))
    hs = data["houses"]
    wk = city["walk"]
    img = bpy.data.images.load(os.path.join(ROOT, "client", "public", wk["file"].lstrip("/")))
    px = [0.0] * (img.size[0] * img.size[1] * 4)
    img.pixels.foreach_get(px)
    iw, ih = img.size

    def open_at(x, z):
        """The walk map: open ground here (not a wall)? (Blender's pixel rows run from the bottom.)"""
        c, r = int((z - wk["z0"]) / wk["res"]), int((x - wk["x0"]) / wk["res"])
        if not (0 <= c < iw and 0 <= r < ih):
            return False
        return px[((ih - 1 - r) * iw + c) * 4] < 0.5
    poorts = [h for h in hs if h.get("poort") and h["rect"]]
    for k, h in enumerate(poorts):
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        pm = sum(h["poort"]["s"]) / 2
        t0, t1 = h["t"]

        def P(s, t, y):
            return (ox + ux * s + nx * t, y, oz + uz * s + nz * t)
        i = h["_i"]
        out = 1.0
        while out < 6.5 and open_at(*(lambda q: (q[0], q[2]))(P(pm - 0.3 * out, t0 - out - 0.6, 0))):
            out += 0.25
        views.append((f"poort{i}_street", P(pm - 0.3 * out, t0 - out, 1.65), P(pm, t0 + 1.0, 2.0), 26 if out > 5 else 18))
        views.append((f"poort{i}_mouth", P(pm - 0.3, t0 - 1.6, 1.6), P(pm + 0.1, t1, 1.7), 22))
        views.append((f"poort{i}_inside", P(pm + 0.3, (t0 + t1) / 2, 1.6), P(pm, t0 - 3, 1.5), 22))
        back = 1.0
        while back < 6.0 and all(open_at(*(lambda q: (q[0], q[2]))(P(pm + ds, t1 + back + 0.5, 0))) for ds in (-0.3, 0.3)):
            back += 0.5
        views.append((f"poort{i}_back", P(pm + 0.25, t1 + back, 1.65), P(pm, t1 - 1.0, 1.9), 18))
        views.append((f"poort{i}_high", P(pm - 4, t0 - 9, 5.0), P(pm, t0, 3.2), 30))
    def along(g, d):
        """The point d metres along the polyline g, and the direction there."""
        for a, b in zip(g, g[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
            if d <= L:
                return (a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L), ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
            d -= L
        a, b = g[-2], g[-1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
        return (b[0], b[1]), ((b[0] - a[0]) / L, (b[1] - a[1]) / L)

    for k, g in enumerate(city.get("alleys", {}).get("gangs", [])):
        total = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(g, g[1:]))
        for tag, d0 in (("", 3.0), ("_mid", total * 0.45)):
            d = d0
            while d < total - 4 and not all(open_at(*along(g, d + e)[0]) for e in (0.0, 1.0, 2.0)):
                d += 0.5
            (ex, ez), _ = along(g, d)
            (lx, lz), _ = along(g, d + 14)
            views.append((f"gang{k}{tag}", (ex, 1.6, ez), (lx, 1.9, lz), 20))
    for k, c in enumerate(city.get("alleys", {}).get("courts", [])):
        cx = sum(p[0] for p in c) / len(c)
        cz = sum(p[1] for p in c) / len(c)
        far = max(c, key=lambda p: math.hypot(p[0] - cx, p[1] - cz))
        views.append((f"court{k}", (cx - (far[0] - cx) * 0.4, 1.65, cz - (far[1] - cz) * 0.4), (far[0], 2.2, far[1]), 22))
    rows = [h for h in hs if h.get("alley")]
    for k, h in enumerate(rows[:: max(1, len(rows) // 6)]):
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s1 = h["s"][1]
        views.append((f"alley{h['_i']}", (ox - nx * 1.0 - ux * 3.0, 1.65, oz - nz * 1.0 - uz * 3.0),
                      (ox + ux * (s1 + 6) + nx * 0.5, 2.6, oz + uz * (s1 + 6) + nz * 0.5), 22))
        d = 0.5
        while d < 7.0 and open_at(ox - nx * (d + 0.4) + ux * s1 / 2, oz - nz * (d + 0.4) + uz * s1 / 2):
            d += 0.25
        views.append((f"alley{h['_i']}_front", (ox - nx * d + ux * s1 / 2, 1.5, oz - nz * d + uz * s1 / 2),
                      (ox + ux * s1 / 2, 2.4, oz + uz * s1 / 2), 14 if d < 2 else 20))
        views.append((f"alley{h['_i']}_above", (ox - nx * 1.0 - ux * 12, 26.0, oz - nz * 1.0 - uz * 12),
                      (ox + ux * (s1 + 2), 2.0, oz + uz * (s1 + 2)), 26))
    return views


def preview(data, only):
    preview_materials()
    cam = preview_stage()
    sc = bpy.context.scene
    os.makedirs(SHOTS, exist_ok=True)
    for name, eye, look, lens in preview_views(data):
        if only and not any(fnmatch.fnmatch(name, o) for o in only):
            continue
        cam.location = B(*eye)
        cam.rotation_euler = (B(*look) - B(*eye)).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        sc.render.resolution_x, sc.render.resolution_y = 1280, 800
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = os.path.join(SHOTS, f"city_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[build_city] preview -> data/shots/city_{name}.png")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    data = json.load(open(SRC))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = [material("facade", (0.55, 0.35, 0.28)), material("roof", (0.35, 0.22, 0.18)), material("stone", (0.6, 0.58, 0.52)),
            material("wood", (0.35, 0.28, 0.2)), material("leaves", (0.6, 0.45, 0.2))]
    chunks = {}

    def chunk_of(pts):
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        key = (math.floor(cx / CHUNK), math.floor(cz / CHUNK))
        if key not in chunks:
            chunks[key] = Builder(data["ground_h"], data["storey_h"])
        return chunks[key]

    index_fronts(data["houses"])
    for h in data["houses"]:
        ID_ALLEY[id(h)] = bool(h.get("alley"))
    for i, h in enumerate(data["houses"]):
        h["_i"] = i
    for h in data["houses"]:
        rng = random.Random(h["seed"])
        chunk_of(h["fp"]).house(h, rng)
    for b in data["backs"]:
        chunk_of(b["fp"]).back(b)
    build_kerbs(KERBS)
    decor = data.get("decor", {})
    # the decor trees are no longer part of the city mesh: tools/blender/build_trees.py makes
    # them, client/src/world/trees3d.ts plants them (Builder.tree() is kept, unused)
    for x0, z0, x1, z1 in decor.get("rails", []):
        chunk_of([(x0, z0), (x1, z1)]).rail(x0, z0, x1, z1)
    for br in data.get("bridges", {}).values():
        if br["kind"] == "stone":  # the swing bridge over the lock moves: client/src/world/lock.ts
            x0, z0, x1, z1 = br["rect"]
            chunk_of([(x0, z0), (x1, z1)]).bridge(br)
    count = 0
    for (i, j), bld in sorted(chunks.items()):
        bld.to_object(f"city_{i}_{j}", mats)
        count += 1
    node = bpy.data.objects.new("city_openings", None)
    node["openings"] = json.dumps(dict(OPENINGS, about="by house index: poorts {s: [s0, s1] along the front from its first corner, h, kind}; "
                                       "plain_ground [[wall, s0, s1]]: ground bays built as plain wall (no shop window); "
                                       "cottages [[wall, s_mid, width, y0, y1]]: the only windows of an alley cottage's walls "
                                       "(walls: 0 front, 1 right, 2 back, 3 left, s from the wall's first corner)"), separators=(",", ":"))
    bpy.context.scene.collection.objects.link(node)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    faces = sum(len(o.data.polygons) for o in meshes)
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    if "--no-export" not in argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        kwargs = dict(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                      export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                      export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                      export_draco_position_quantization=16, export_draco_texcoord_quantization=12,
                      export_draco_color_quantization=8, export_draco_normal_quantization=8)
        try:
            bpy.ops.export_scene.gltf(**kwargs, export_vertex_color="ACTIVE", export_all_vertex_colors=True)
        except TypeError:
            bpy.ops.export_scene.gltf(**kwargs, export_colors=True)
        print(f"[build_city] {len(data['houses'])} houses, {len(data['backs'])} backs, {count} chunks, {faces} faces, {tris} triangles -> {OUT} ({os.path.getsize(OUT)//1024} KB)")
    else:
        print(f"[build_city] {len(data['houses'])} houses, {count} chunks, {faces} faces, {tris} triangles (not exported)")
    if "--preview" in argv:
        i = argv.index("--preview")
        only = argv[i + 1].split(",") if i + 1 < len(argv) and not argv[i + 1].startswith("--") else None
        preview(data, only)


if __name__ == "__main__":
    main()

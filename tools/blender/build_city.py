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

M7 quays pass 2 (2026-09-25): the windows of the street fronts are cut into the walls (upper_front, shop_run),
their sashes set back, chimneys of brick with pots, moulded cornices, dormers with cheeks, hoist lofts on the
storehouses. The fronts that look onto a quay, a square or the water (prime_front) also get sills, window heads,
shutters, bands or anchors, a downpipe, a gutter: these small things go into a second mesh per chunk,
"city_<i>_<j>_d", which the game draws only near (city.ts).

    blender -b --factory-startup -P tools/blender/build_city.py -- --preview [name,name*]   pictures too
    ... -- --no-export --preview "quay*"                                                the quay fronts (M7 quays pass 2)
    ... -- --no-export --preview "poort*"                                              pictures only

--preview renders close views (passages from the street, the mouth, inside, the back; the gangs; the
courts; rows of cottages) to data/shots/city_<view>.png with the game's own atlases, saved once from its
canvases to data/shots/city_atlas_*.jpg (cityTextures.ts).
"""

import array
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
# M7 quays pass 2 (Builder.upper_front, shop_run): the windows cut into the fronts. Where the facade atlas
# painted them (cityTextures.ts facadeAtlas, and facadeOpenings / ambient.ts that follow it): the upper
# window with its frame 21..43 of a bay's 64 columns, 12..52 of a storey's 64 rows from the bottom; the shop
# window 12..52 across, 12..50 up the ground storey. Their sashes have cells of their own now (columns 4-7,
# rows 0-2), the whole cell over the opening.
WIN_R, SHOP_R = 0.16, 0.12  # how far back in the wall the sash stands (ambient.ts puts the lit pane there)
COT_R = 0.11  # the alley cottages' sash, as far back in its thinner wall (the houses' pass, 2026-09-26)
YARD_R = 0.12  # (yard windows, 2026-09-26) the sash of a back wall on a yard, as far back (ambient.ts puts the lit pane there)
SASH_PATCHED = (7, 2)  # (yard windows) a sash with a pane boarded and one pasted over with paper (cityTextures.ts)
UP_U, UP_V = (21 / 64, 43 / 64), (12 / 64, 52 / 64)
SHOP_U, SHOP_V = (12 / 64, 52 / 64), (12 / 64, 50 / 64)
SASH = [(4, 0), (5, 0), (6, 0), (7, 0)]
SASH_CRACKED = (6, 2)  # grime pass 2: a sash with a broken pane and a crack (cityTextures.ts)  # white frame with lace, cream with curtains, dark green, brown
SHOPWIN = [(4, 1), (5, 1), (6, 1)]  # cream, dark green, brown with wares on a shelf
DORMWIN = (7, 1)  # a small dormer window
SHUTTER = [(4, 2), (5, 2)]  # louvred, panelled: grey, the vertex colour paints them
FARPIER_ROW = 7  # facade atlas row 7, one cell per style (column = STYLE_ROW): the upper-storey wall with the painted
# lintel and sill of its window but no window and no shutters, round the windows cut in: seen far off, when the
# near-only 3D sills, heads and shutters are not drawn (cityTextures.ts farPier)
SHOP_PAINT = [(0.34, 0.52, 0.4), (0.62, 0.3, 0.26), (0.3, 0.3, 0.32), (0.66, 0.5, 0.36), (0.36, 0.44, 0.6)]  # shopfront paint (a tint on wood)
FLOWERS = [(1.0, 0.32, 0.26), (1.0, 0.55, 0.62), (0.72, 1.0, 0.55), (1.0, 0.85, 0.4)]  # geraniums, pinks, greens, marigolds: a tint on the leaves
SHUTTER_PAINT = [(0.92, 0.92, 0.88), (0.66, 0.66, 0.64), (0.3, 0.46, 0.34), (0.42, 0.62, 0.46), (0.34, 0.5, 0.38), (0.62, 0.42, 0.3), (0.4, 0.5, 0.62), (0.62, 0.62, 0.56), (0.55, 0.3, 0.26)]
# M7 taverns and homes in the world (shared/inworld_build.json, tools/city/inworld.mts): in these houses the
# door has no leaf (the game hangs one) and the painted glass of some windows is cut out (the game's panes)
INWORLD_SRC = os.path.join(ROOT, "shared", "inworld_build.json")
INWORLD = {}
if os.path.exists(INWORLD_SRC):
    for _e in json.load(open(INWORLD_SRC))["houses"]:
        INWORLD[_e["house"]] = _e
ROOF_CELL = {"tile": (0, 0), "slate": (1, 0), "flat": (0, 1), "lead": (1, 1)}

MAT_FACADE, MAT_ROOF, MAT_STONE, MAT_WOOD, MAT_LEAF, MAT_GRIME = 0, 1, 2, 3, 4, 5
# M7 grime pass 2 (Steve: "misty, darker, grimy ... rust, soot, clutter, dirt"): decals of the "grime" material, a
# see-through, depth-less layer 6 mm off the wall (city.ts: polygon offset), cells of cityTextures.ts grimeDecals
RUST, SOOT, DAMP, CORNER, BLOB = (0, 0), (1, 0), (2, 0), (3, 0), (0, 1)
# (the decal's colour, laid over the wall as much as the cell's alpha and the house's wear say; linear light)
GRIME_TINT = {RUST: (0.2, 0.065, 0.018), SOOT: (0.012, 0.011, 0.01), DAMP: (0.025, 0.03, 0.016), CORNER: (0.02, 0.018, 0.016), BLOB: (0.01, 0.009, 0.008)}
# the churches freed (2026-09-26): the ghost of a house pulled down on its neighbour's bared party wall (ghost_marks):
# the old rooms' plaster left on the brick (GHOST, tiling), the floor and joist lines (LINE), wallpaper scraps (SCRAP)
GHOST, LINE, SCRAP = (1, 1), (2, 1), (3, 1)
GRIME_TINT.update({GHOST: (0.21, 0.18, 0.145), LINE: (0.03, 0.027, 0.024), SCRAP: (0.3, 0.2, 0.17)})
WALLPAPER = [(0.32, 0.2, 0.18), (0.2, 0.26, 0.19), (0.19, 0.22, 0.28), (0.33, 0.3, 0.2), (0.28, 0.22, 0.25)]


def B(x, y, z):
    """Game world (x, y up, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


class Builder:
    def __init__(self, ground_h, storey_h):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.cell = self.bm.loops.layers.uv.new("Cell")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.mcol = self.bm.loops.layers.uv.new("Mat")
        self.gh = ground_h
        self.sh = storey_h
        self.tint = (1, 1, 1)
        self.holes = []
        self.rec = None  # a list to note the plain ground bays in (poort houses), or None
        self.rec_wall = 0
        self.rec_win = None  # a list to note a cottage's windows in, or None
        self.rec_yard = None  # (yard windows) a list to note a back wall's windows in, or None
        self.yd = None  # (yard windows) the house's dress while its back wall on a yard is built, or None
        # M7 quays pass 2: the small things on the fronts (sills, lintels, shutters, bands, anchors, pipes,
        # gutters) go into a second mesh per chunk, "<chunk>_d", that the game draws only near (city.ts)
        self.dbm = bmesh.new()
        self.duv = self.dbm.loops.layers.uv.new("UVMap")
        self.dcell = self.dbm.loops.layers.uv.new("Cell")
        self.dcol = self.dbm.loops.layers.float_color.new("Col")
        self.dmcol = self.dbm.loops.layers.uv.new("Mat")
        self.base = (self.bm, self.uv, self.cell, self.col, self.mcol)
        # the districts pass: the house's wall picture (a layer of houseGrime.ts's picture array) and its paint
        self.wallmat = (1, 0)
        self.ds = None  # the house's front dress (dress_of), None: as before (backs, cottages)
        # M7 the grime pass: how worn the house is, 0 kept well .. 1 black with dirt; in the vertex colour's alpha,
        # which the game's house materials read (world/houseGrime.ts)
        self.wear = 0.6
        self.cur_load = None  # a storehouse front: the loading doors' columns (s along the wall), or None
        self.pipe = None  # the wall that gets the downpipe: {"top": y of the hopper's top}, or None
        self.quoins = None  # the wall being built: (its start, its end) are outer corners of the house
        self.qends = (False, False)

    def matcol(self):
        """The "Mat" uv (TEXCOORD_2 in the glTF; a colour layer would upset the order of the exported colour sets):
        u the wall picture's layer, v its paint (an index of houseGrime.ts PAINT)."""
        layer, paint = self.wallmat
        return (float(layer), float(paint))

    def detail(self, on=True):
        """Build into the near-only detail mesh (on) or the chunk's own mesh (off)."""
        if on:
            self.bm, self.uv, self.cell, self.col, self.mcol = self.dbm, self.duv, self.dcell, self.dcol, self.dmcol
        else:
            self.bm, self.uv, self.cell, self.col, self.mcol = self.base

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
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, self.wear)
            loop[self.mcol].uv = self.matcol()
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
        # M7 quays pass 2: a front on a quay, a square or the water gets the whole dress; the others their
        # windows set in, the painted lintels, sills and shutters kept round them (prime_front)
        # (the second pass, 2026-09-25, Steve: "do all the houses here an example": every street front has it now;
        # prime_front, the quays, squares and water, is no longer asked)
        self.prime = street
        # (where two houses of the plan overlap, their walls lie in one plane: a front cut there only makes
        # more faces fight (z-fight check); it stays as it was)
        keep_ds = self.ds
        self.yd = None
        if self.ds is not None and not kerb:
            # (a back wall on a yard kept its painted windows: street life counted it blind and pasted bills on it)
            # (yard windows, 2026-09-26, Steve: the backs get real windows as the alley cottages did: yard_run.
            # Not where another house's wall lies in its plane, not on a house whose rooms stand in the world)
            if street and not holes and self.backing is not None and not overlapped(self.hid, a, b):
                self.yd = keep_ds
                YARD_N["walls"] = YARD_N.get("walls", 0) + 1
            else:
                YARD_N["painted"] = YARD_N.get("painted", 0) + 1
            self.ds = None
        elif self.ds is not None and street and overlapped(self.hid, a, b):
            self.ds = None
            PRIME_N["overlapped"] = PRIME_N.get("overlapped", 0) + (1 if y0 == 0 else 0)
        if street and y0 == 0:
            PRIME_N[self.prime] = PRIME_N.get(self.prime, 0) + 1
        # M7 quays pass 2 (second pass): quoins at the outer corners of a plastered front with the whole dress
        # (self.quoins: the caller's (start, end) corners that are outer corners), not by a doorway or passage
        qs = self.quoins or (False, False)
        self.qends = (False, False)
        # (not on a short front: a street's name plate, 2 m and more, must still find room by the corner)
        fine_ = self.ds is not None and self.ds.get("klass") in ("fine", "good")
        if self.ds is not None and self.prime and (self.ds["plaster"] or fine_) and not self.ds["store"] and y0 == 0 and y1 > 3 and L >= 4.0:
            near = [o["s"] + sg * (o["w"] / 2 + o.get("J", 0.2)) for o in (door or []) for sg in (-1, 1)]
            self.qends = (qs[0] and not any(e < 0.5 for e in near), qs[1] and not any(e > L - 0.5 for e in near))
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
                    elif self.ds is not None and y0 == 0 and gy > self.gh - 0.01:
                        self.shop_run(a, b, L, facing, k0, k1, bw, gy, row)  # M7 quays pass 2: the shop windows set in
                    elif self.yd is not None and y0 == 0:
                        self.yard_run(a, b, L, facing, k0, k1, bw, 0.0, gy, row)  # (yard windows) the back rooms' windows set in
                    else:
                        self.face([(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pb[0], gy, pb[1]), (pa[0], gy, pa[1])], MAT_FACADE,
                                  [(0, 0), (k1 - k0, 0), (k1 - k0, vt), (0, vt)], (PART_COL["ground"], row), facing)
                k0 = k1
        if y1 > self.gh:
            ya = max(y0, self.gh)
            v0, v1 = (ya - self.gh) / self.sh, (y1 - self.gh) / self.sh
            if self.ds is not None and not any(hl["y1"] > self.gh for hl in holes):
                self.upper_front(a, b, L, facing, ya, y1, bays, row)  # M7 quays pass 2: the windows set in
            elif holes:
                bwu = L / bays
                self.holed(a, b, L, 0, L, ya, y1, lambda s, y: (s / bwu, (y - self.gh) / self.sh), (PART_COL["upper"], row), facing, holes)
            elif self.yd is not None and abs(ya - self.gh) < 0.01:
                self.yard_run(a, b, L, facing, 0, bays, L / bays, ya, y1, row)  # (yard windows) the upper storeys
            else:
                self.face([(a[0], ya, a[1]), (b[0], ya, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], MAT_FACADE,
                          [(0, v0), (bays, v0), (bays, v1), (0, v1)], (PART_COL["upper"], row), facing)
        if self.ds is not None and self.prime and y0 == 0:
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            fx, fz = facing[0], facing[2]

            def Wq(s_, y, d=0.0):
                return (a[0] + ux * s_ + fx * d, y, a[1] + uz * s_ + fz * d)
            self.detail(True)
            for end, on in enumerate(self.qends):
                if on:
                    self.quoins_at(Wq, ux, uz, facing, L, end, y1)
            if self.ds["store"]:
                self.plinth(Wq, ux, uz, facing, L, door or [])
            elif self.ds.get("klass") in ("fine", "good") and y1 > 3:
                # the districts pass: a stone plinth under the fine fronts, on the piers between the openings
                bays_ = max(1, round(L / BAY))
                bw_ = L / bays_
                cuts = list(door or [])
                for k in range(bays_):
                    s_ = (k + 0.5) * bw_
                    if not any(abs(o["s"] - s_) < bw_ / 2 for o in cuts):
                        cuts.append({"s": s_, "w": bw_ * 40 / 64 + 0.4, "J": 0.0})
                self.plinth(Wq, ux, uz, facing, L, cuts, top=0.5)
            # a lantern by the front door of some houses (not by a door the game hangs: the taverns' signs are there)
            if self.ds["lantern"] and not holes:
                for o in door or []:
                    if o.get("kind") == "house" and not o.get("open"):
                        sd = 1 if self.ds["rng"].random() < 0.5 else -1
                        for sg in (sd, -sd):
                            s = o["s"] + sg * (o["w"] / 2 + o["J"] + 0.32)
                            if 0.6 < s < L - 0.6 and not any(abs(q["s"] - s) < q["w"] / 2 + q["J"] + 0.2 for q in door if q is not o):
                                self.lantern(Wq, ux, uz, facing, s)
                                break
                        break
            self.detail(False)
        if street and y0 == 0 and self.ds is not None and L > 1.5:
            # (grime pass 2) grime down the corners of every front; soot up the fronts of the ovens and forges
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            fx, fz = facing[0], facing[2]

            def Wc(s_, y, d=0.0):
                return (a[0] + ux * s_ + fx * d, y, a[1] + uz * s_ + fz * d)
            top = y1 - 0.42
            near = [o["s"] + sg * (o["w"] / 2 + o.get("J", 0.2)) for o in (door or []) for sg in (-1, 1)]
            if not any(e < 0.6 for e in near):
                self.decal(Wc, 0.0, 0.5, 0.0, top, CORNER, facing)
            if not any(e > L - 0.6 for e in near):
                self.decal(Wc, L - 0.5, L, 0.0, top, CORNER, facing, flip=True)
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            if y1 > 5 and any(math.hypot(mx - sx_, mz - sz_) < L / 2 + 2.5 and abs((sx_ - a[0]) * fx + (sz_ - a[1]) * fz) < 4 for sx_, sz_ in SOOTY):
                bays_ = max(1, round(L / BAY))
                bw_ = L / bays_
                for k in range(1, bays_):
                    self.decal(Wc, k * bw_ - 0.5, k * bw_ + 0.5, 3.3, y1 - 0.3, SOOT, facing)
                if bays_ == 1:
                    self.decal(Wc, 0.15, L - 0.15, 3.3, y1 - 0.3, SOOT, facing)
        if self.pipe and y0 == 0 and self.ds is not None and self.prime and not all(self.qends):
            # the downpipe near the wall's far end, where no doorway or passage is near (the other end if the
            # far one has quoins)
            s = L - 0.24 if not self.qends[1] else 0.24
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            px, pz = a[0] + ux * s, a[1] + uz * s
            # (nor by a named door: its sign runs along the front, city.json doors)
            if (not any(abs(o["s"] - s) < o["w"] / 2 + o.get("J", 0.2) + 0.45 for o in (door or []))
                    and not any(hl["s1"] > s - 0.45 for hl in holes) and self.pipe["top"] > 4.3 and L > 2.5
                    and not any(math.hypot(px - dd["x"], pz - dd["z"]) < dd.get("width", 2) / 2 + 1.0 for dd in PRIME["doors"])):
                fx, fz = facing[0], facing[2]
                self.downpipe(lambda s_, y, d=0.0: (a[0] + ux * s_ + fx * d, y, a[1] + uz * s_ + fz * d), ux, uz, facing, s,
                              self.pipe["top"], KERB_H if kerb else 0.0, L)
        self.holes = []
        self.ds = keep_ds
        self.yd = None

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
            self.face([W(s, y) for s, y in pts], MAT_FACADE, [(s / bw, min(y / self.gh, 0.98)) for s, y in pts], cell, f)

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
        fine_door = o["kind"] == "house" and not o.get("open") and self.ds is not None and self.ds.get("klass") == "fine"
        if o["kind"] == "house" and not o.get("open") and self.ds is not None and self.ds.get("klass") in ("fine", "good"):
            self.door_steps(W, ux, uz, f, o, stone)
        nb = 3 if ys > 2.4 else 2
        for j0, j1 in ((left - J, left), (right, right + J)):
            self.slab(W, ux, uz, f, j0, j1, 0, ys, 0, P, stone, nb)
        if o["top"] == "flat":
            lw = w + 2 * J + 0.08
            self.slab(W, ux, uz, f, sc - lw / 2, sc + lw / 2, ys, ys + 0.3, 0, P + 0.01, stone)
            if o["hood"] or fine_door:  # a drip moulding along the top of the lintel
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
        if o["key"] or fine_door:
            kw = 0.17 if o["kind"] == "gate" else 0.12
            # 8 cm proud of the ring: at 3 cm its face lay over the ring's and the wobble made them fight (z-fight check)
            self.slab(W, ux, uz, f, sc - kw, sc + kw, apex - 0.02, apex + J + 0.04, 0, P + 0.08, stone * 1.05)

    def slab(self, W, ux, uz, f, s0, s1, y0, y1, d0, d1, shade, blocks=1, mat=MAT_STONE, under=False, cell=(0, 0), ends=True, top=True):
        """A block of stone lying on the wall, s0..s1 along it, y0..y1 up, d0..d1 out. No back and no
        bottom (they lie on the wall and the ground); the front split into `blocks` stones of alternate shade.
        under: with a bottom face too (a lintel over an opening, seen from below)."""
        for i in range(blocks):
            ya, yb = y0 + (y1 - y0) * i / blocks, y0 + (y1 - y0) * (i + 1) / blocks
            self.face([W(s0, ya, d1), W(s1, ya, d1), W(s1, yb, d1), W(s0, yb, d1)], mat,
                      [(s0 / BAY, ya / BAY), (s1 / BAY, ya / BAY), (s1 / BAY, yb / BAY), (s0 / BAY, yb / BAY)], cell, f,
                      shade * (1.0 if i % 2 == 0 else 0.9))
        dd = (d1 - d0) / BAY
        if top:
            self.face([W(s0, y1, d0), W(s1, y1, d0), W(s1, y1, d1), W(s0, y1, d1)], mat,
                      [(s0 / BAY, 0), (s1 / BAY, 0), (s1 / BAY, dd), (s0 / BAY, dd)], cell, (0, 1, 0), shade * 1.05)
        if under:
            self.face([W(s0, y0, d0), W(s1, y0, d0), W(s1, y0, d1), W(s0, y0, d1)], mat,
                      [(s0 / BAY, 0), (s1 / BAY, 0), (s1 / BAY, dd), (s0 / BAY, dd)], cell, (0, -1, 0), shade * 0.6)
        for se, sgn in ((s0, -1), (s1, 1)) if ends else ():
            self.face([W(se, y0, d0), W(se, y0, d1), W(se, y1, d1), W(se, y1, d0)], mat,
                      [(0, y0 / BAY), (dd, y0 / BAY), (dd, y1 / BAY), (0, y1 / BAY)], cell, (ux * sgn, 0, uz * sgn), shade * 0.8)

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

    def loading_door(self, W, s, y, ux, uz, out, recessed=False, w=1.5, hgt=2.1):
        """A loading door in an upper storey of a storehouse: planked leaves in a stone frame on the wall.
        recessed (M7 quays pass 2): the leaves stand at the back of an opening cut in the wall (upper_front)."""
        J, y0 = 0.16, y + 0.35
        # the leaves stand 7 cm off the wall, just behind the jambs' faces (8 cm): at 3 cm they lay over the
        # wall so near that the wobble made them fight (z-fight check)
        dl = 0.07
        if not recessed:
            self.face([W(s - w / 2, y0, dl), W(s + w / 2, y0, dl), W(s + w / 2, y0 + hgt, dl), W(s - w / 2, y0 + hgt, dl)],
                      MAT_FACADE, [(0, 0), (1, 0), (1, 1), (0, 1)], LOADING, out, 0.9)
        for j0, j1 in ((s - w / 2 - J, s - w / 2), (s + w / 2, s + w / 2 + J)):
            self.slab(W, ux, uz, out, j0, j1, y0, y0 + hgt, 0, 0.08, 0.8)
        lw = w + 2 * J + 0.06
        self.slab(W, ux, uz, out, s - lw / 2, s + lw / 2, y0 + hgt, y0 + hgt + 0.22, 0, 0.09, 0.85)
        self.slab(W, ux, uz, out, s - lw / 2 - 0.02, s + lw / 2 + 0.02, y0 - 0.14, y0, 0, 0.16, 0.75)

    # ---------------------------------------------------------------- M7 quays pass 2: the fronts in depth
    # Steve, 2026-09-25, with game pictures made over into the look he wants: "more detail in models,
    # complexity of buildings". The windows were painted on flat walls. Now every window of a street front
    # (not in a gable, not the alley cottages) is cut into the wall: a reveal WIN_R deep, the sash at its
    # back (an atlas cell of its own), a stone sill and a head (a flat lintel, one with a keystone, a stone
    # arch, a hood) on the wall, shutters on most plastered houses; the shop windows the same, SHOP_R deep.
    # The piers between them are the blind wall cell (the painted lintels, sills and shutters are 3D now).
    # Bands at the floor lines or iron anchors, a moulded cornice, a gutter and a downpipe, brick chimneys
    # with a cap and pots, dormers with cheeks and a roof, the storehouses' loading doors set into the wall
    # and a hoist loft over each. The openings stay where the atlas painted them (cityTextures.ts
    # facadeOpenings, ambient.ts's lit panes, the signs): nothing new stands out of a front in the sign band
    # (3.47 to 4.19 m, streetlife.ts BOARD_BAND) or past a window's box of facadeOpenings.

    def dress_of(self, h):
        """The house's own dice for its front dress (the house's other dice stay as they were)."""
        r = random.Random(h["seed"] * 17 + 1877)
        row = STYLE_ROW[h["style"]]
        plaster = row in (1, 2)
        ds = {"row": row, "plaster": plaster, "rng": r, "sash": r.choice(SASH), "shop": r.choice(SHOPWIN),
              "shutters": r.random() < (0.8 if plaster else 0.12), "shutter": r.choice(SHUTTER), "paint": r.choice(SHUTTER_PAINT),
              "head": r.choice(["flat", "key", "hood", "hood"] if plaster else ["flat", "key", "arch", "arch"]),
              "bands": r.random() < (0.75 if plaster else 0.3), "store": bool(h.get("store")), "stone": 0.95 if plaster else 0.82}
        ds["anchors"] = not plaster and not ds["bands"]
        ds["shopcol"] = r.choice(SHOP_PAINT)
        # the second pass: the kit mixed per house (Steve: "try to use returning assets and mix up")
        ds["shutters"] = r.random() < (0.85 if plaster else 0.35)
        ds["shutmode"] = r.choice(["open", "open", "open", "open", "half", "closed"])
        ds["head1"] = ds["head"] if r.random() < 0.6 else r.choice(["flat", "key", "hood"] if plaster else ["flat", "key", "arch"])
        ds["boxes"] = r.random() < 0.35
        ds["flowers"] = r.choice(FLOWERS)
        ds["shopfront"] = r.random() < 0.6
        ds["lantern"] = r.random() < 0.35
        if ds["store"]:
            ds.update(shutters=False, bands=False, anchors=True, head="arch")
        return ds

    def cut(self, W, sa, sb, ya, yb, ops, uvf, cell, f, backing=None):
        """The wall sa..sb x ya..yb (W(s, y, d) on it) with the openings left out. Without `backing`: a grid
        split at every opening's edges (all columns at all heights: no T-junction the vertex snap could open
        into a crack). With it (a depth < 0): each column split only at its own openings (a pier is one
        face), and one face of the same wall `backing` metres behind the whole of it: where the snap opens a
        crack at a T-junction, the crack shows that wall, not the inside of the house."""
        xs = sorted({sa, sb, *[v for o in ops for v in (o["s0"], o["s1"]) if sa < v < sb]})
        ys_all = sorted({ya, yb, *[v for o in ops for v in (o["y0"], o["y1"]) if ya < v < yb]})
        if backing is not None:
            # (from 0.3 m under the part: the ground storey's own backing stands 2 cm further back)
            yl = ya - 0.3 if ya > 0.5 else ya
            self.face([W(sa, yl, backing), W(sb, yl, backing), W(sb, yb, backing), W(sa, yb, backing)], MAT_FACADE,
                      [uvf(sa, yl), uvf(sb, yl), uvf(sb, yb), uvf(sa, yb)], cell, f)
        for s0, s1 in zip(xs, xs[1:]):
            sm = (s0 + s1) / 2
            here = [o for o in ops if o["s0"] < sm < o["s1"]]
            ys = ys_all if backing is None else sorted({ya, yb, *[v for o in here for v in (o["y0"], o["y1"]) if ya < v < yb]})
            for y0, y1 in zip(ys, ys[1:]):
                ym = (y0 + y1) / 2
                if any(o["y0"] < ym < o["y1"] for o in here):
                    continue
                self.face([W(s0, y0), W(s1, y0), W(s1, y1), W(s0, y1)], MAT_FACADE,
                          [uvf(s0, y0), uvf(s1, y0), uvf(s1, y1), uvf(s0, y1)], cell, f)

    def dress_open(self, W, ux, uz, f, o, R, glass):
        """An opening cut through the wall: the reveal's sides and soffit in the wall's own material in
        shadow, the inner sill in stone, the sash (or a loading door's leaves) R back in the wall."""
        s0, s1, y0, y1 = o["s0"], o["s1"], o["y0"], o["y1"]
        rc = (PART_COL["blind"], self.ds["row"] if self.ds else 0)
        dd = R / BAY
        side = [(0, y0 / BAY), (dd, y0 / BAY), (dd, y1 / BAY), (0, y1 / BAY)]
        self.face([W(s0, y0, 0), W(s0, y0, -R), W(s0, y1, -R), W(s0, y1, 0)], MAT_FACADE, side, rc, (ux, 0, uz), 0.55)
        self.face([W(s1, y0, 0), W(s1, y0, -R), W(s1, y1, -R), W(s1, y1, 0)], MAT_FACADE, side, rc, (-ux, 0, -uz), 0.5)
        flat = [(s0 / BAY, 0), (s1 / BAY, 0), (s1 / BAY, dd), (s0 / BAY, dd)]
        self.face([W(s0, y1, 0), W(s1, y1, 0), W(s1, y1, -R), W(s0, y1, -R)], MAT_FACADE, flat, rc, (0, -1, 0), 0.4)
        if o.get("kind") != "win":  # (an upper window's inner sill is seen only from above: none)
            self.face([W(s0, y0, 0), W(s1, y0, 0), W(s1, y0, -R), W(s0, y0, -R)], MAT_STONE, flat, (0, 0), (0, 1, 0), 0.72)
        self.face([W(s0, y0, -R), W(s1, y0, -R), W(s1, y1, -R), W(s0, y1, -R)], MAT_FACADE,
                  [(0, 0), (1, 0), (1, 1), (0, 1)], glass, f, 0.92)

    def dress_detail(self, W, ux, uz, f, o, lim, bw):
        """The stone round a window on the wall (near-only mesh): the sill, the head, the shutters."""
        ds = self.ds
        st = ds["stone"]
        s0, s1, y0, y1 = o["s0"], o["s1"], o["y0"], o["y1"]
        self.detail(True)
        if o["kind"] == "shop" and not ds["store"] and ds["shopfront"]:
            self.shopfront(W, ux, uz, f, s0, s1, y0, y1, bw)
        elif o["kind"] == "shop":
            # (over the painted sill and lintel of the far-off wall: 2 and 3/64 of a bay past the glass)
            e2, e3 = bw * 2 / 64 + 0.01, bw * 3 / 64 + 0.01
            self.slab(W, ux, uz, f, s0 - e2, s1 + e2, y0 - 0.18, y0, 0, 0.1, st * 0.9, under=True)
            self.slab(W, ux, uz, f, s0 - e3, s1 + e3, y1, y1 + 0.235, 0, 0.075, st, under=True)
        else:
            # (no end faces on the sill and the flat lintel: 10 cm of stone seen edge on). Over the painted sill
            # of the far-off wall: 2/64 of a bay past the window, 0.14 m down
            ex = bw * 2 / 64 + 0.01
            if not o.get("balcony"):  # (a balcony's floor is its sill)
                self.slab(W, ux, uz, f, s0 - ex, s1 + ex, y0 - 0.145, y0, 0, 0.1, st * 0.9, under=True, ends=False)
            keep = ds["head"]
            if o.get("j") == 0:
                ds["head"] = ds["head1"]  # (the first floor's windows may wear another head)
            self.head(W, ux, uz, f, s0, s1, y1, lim, st, bw)
            ds["head"] = keep
            r = ds["rng"]
            if ds["shutters"] and not o.get("small"):
                mode = ds["shutmode"] if r.random() > 0.12 else "closed"
                if o.get("boards"):
                    mode = "open"
                self.shutters(W, ux, uz, f, s0, s1, y0, y1, bw, mode)
            if o.get("balcony"):
                self.balcony(W, ux, uz, f, s0, s1, y0)
            elif ds["boxes"] and o.get("j", 9) <= 1 and r.random() < 0.6:
                self.window_box(W, ux, uz, f, s0, s1, y0)
        self.detail(False)

    def head(self, W, ux, uz, f, s0, s1, y1, lim, st, bw=3.0):
        """What stands over a window: a flat lintel, one with a keystone, a stone arch, or a hood on a
        frieze; smaller where the storey above leaves no room (lim: nothing over this height)."""
        kind = self.ds["head"]
        room = lim - y1
        sc = (s0 + s1) / 2
        if room < 0.09:
            return
        if kind == "arch" and room >= 0.37:
            # a segmental arch of stone over the flat top: the front, its curved top, the ends, the soffit
            ex = bw * 3 / 64 + 0.01  # (over the painted lintel of the far-off wall)
            a0, a1, P = s0 - ex, s1 + ex, 0.075
            n = 4
            top = [(a0 + (a1 - a0) * i / n, y1 + 0.2 + 0.12 * math.sin(math.pi * i / n)) for i in range(n + 1)]
            pts = [(a0, y1)] + top + [(a1, y1)]
            self.face([W(s, y, P) for s, y in pts], MAT_STONE, [(s / BAY, y / BAY) for s, y in pts], (0, 0), f, st)
            for (sa, ya), (sb, yb) in zip(top, top[1:]):
                self.face([W(sa, ya, 0), W(sb, yb, 0), W(sb, yb, P), W(sa, ya, P)], MAT_STONE,
                          [(0, 0), (0.1, 0), (0.1, 0.03), (0, 0.03)], (0, 0), (-(yb - ya) * ux, sb - sa, -(yb - ya) * uz), st * 1.05)
            for se, sgn in ((a0, -1), (a1, 1)):
                self.face([W(se, y1, 0), W(se, y1, P), W(se, y1 + 0.2, P), W(se, y1 + 0.2, 0)], MAT_STONE,
                          [(0, 0), (0.03, 0), (0.03, 0.07), (0, 0.07)], (0, 0), (ux * sgn, 0, uz * sgn), st * 0.8)
            self.face([W(a0, y1, 0), W(a1, y1, 0), W(a1, y1, P), W(a0, y1, P)], MAT_STONE,
                      [(0, 0), (1, 0), (1, 0.03), (0, 0.03)], (0, 0), (0, -1, 0), st * 0.6)
            # the keystone
            self.slab(W, ux, uz, f, sc - 0.08, sc + 0.08, y1 + 0.02, y1 + 0.36, 0, 0.13, st * 1.05, top=False)
            return
        if kind == "hood" and room >= 0.26:
            # a frieze, and a hood over it that throws the rain off
            ex = bw * 3 / 64 + 0.01
            self.slab(W, ux, uz, f, s0 - ex, s1 + ex, y1, y1 + 0.14, 0, 0.075, st, under=True, top=False, ends=False)
            self.slab(W, ux, uz, f, s0 - ex - 0.04, s1 + ex + 0.04, y1 + 0.14, y1 + 0.24, 0, 0.15, st * 1.05, under=True)
            return
        h = min(0.2, room)
        ex = bw * 3 / 64 + 0.01
        self.slab(W, ux, uz, f, s0 - ex, s1 + ex, y1, y1 + h, 0, 0.075, st, under=True, ends=False)
        if kind == "key" and room >= 0.24:
            self.slab(W, ux, uz, f, sc - 0.08, sc + 0.08, y1 - 0.03, y1 + 0.24, 0, 0.13, st * 1.05, under=True, top=False)

    def shutters(self, W, ux, uz, f, s0, s1, y0, y1, bw, mode="open"):
        """Two shutters, painted (the cell is grey, the paint its tint): standing open against the wall, clear
        of the window's box of facadeOpenings (12/64 of a bay from its edge); or closed in the opening, in front
        of the sash (a lit pane behind them stays hidden); or half: the left closed, the right open."""
        ds = self.ds
        w = min(0.39, bw * 9 / 64 - 0.035)
        keep = self.tint
        self.tint = ds["paint"]
        d0, d1 = 0.055, 0.085
        ya, yb = y0 + 0.03, y1 - 0.03
        sm = (s0 + s1) / 2
        leaves = []
        if mode in ("closed", "half"):
            # (in the opening, 3.5 cm back: their faces in no other face's plane)
            for l0, l1, u0, u1 in ((s0 + 0.004, sm - 0.004, 0.0, 1.0), (sm + 0.004, s1 - 0.004, 1.0, 0.0))[: 2 if mode == "closed" else 1]:
                self.face([W(l0, y0 + 0.004, -0.035), W(l1, y0 + 0.004, -0.035), W(l1, y1 - 0.004, -0.035), W(l0, y1 - 0.004, -0.035)],
                          MAT_FACADE, [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], ds["shutter"], f, 0.9)
        if mode == "open":
            leaves = [(s0 - 0.03 - w, s0 - 0.03, 0.0, 1.0), (s1 + 0.03, s1 + 0.03 + w, 1.0, 0.0)]
        elif mode == "half":
            leaves = [(s1 + 0.03, s1 + 0.03 + w, 1.0, 0.0)]
        # (grime pass 2) on a worn house a leaf gone, or hanging from its top hinge, tipped out of true
        r = ds["rng"]
        tip = [0.0] * len(leaves)
        if self.wear > 0.7 and leaves and r.random() < 0.14:
            if r.random() < 0.5 and len(leaves) > 1:
                leaves = leaves[:1]
            else:
                tip[0] = r.choice([-1, 1]) * r.uniform(0.07, 0.14)
        for (l0, l1, u0, u1), a in zip(leaves, tip):
            # the hinge side (next to the window) stays; a tipped leaf turns round its top hinge in the wall's plane
            hs_ = l1 if u0 == 0.0 else l0
            def rot(s_, y_, a=a, hs_=hs_):
                ds_, dy = s_ - hs_, y_ - yb
                return hs_ + ds_ * math.cos(a) - dy * math.sin(a), yb + ds_ * math.sin(a) + dy * math.cos(a)
            c = [rot(l0, ya), rot(l1, ya), rot(l1, yb), rot(l0, yb)]
            self.face([W(sv, yv, d1) for sv, yv in c], MAT_FACADE,
                      [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], ds["shutter"], f, 0.95)
            for (pa, pb), sgn in (((c[0], c[3]), -1), ((c[1], c[2]), 1)):
                self.face([W(pa[0], pa[1], d0), W(pa[0], pa[1], d1), W(pb[0], pb[1], d1), W(pb[0], pb[1], d0)], MAT_FACADE,
                          [(0.02, 0.02), (0.04, 0.02), (0.04, 0.98), (0.02, 0.98)], ds["shutter"], (ux * sgn, 0, uz * sgn), 0.7)
            # rust runs from the two hinges (on the wall beside the window)
            if self.wear > 0.45:
                for hy in (ya + 0.25, yb - 0.12):
                    e0, e1 = (hs_ - 0.06, hs_ + 0.02) if u0 == 0.0 else (hs_ - 0.02, hs_ + 0.06)  # (off the window)
                    self.decal(W, e0, e1, hy - 0.4, hy + 0.02, RUST, f)
        self.tint = keep

    def boards(self, W, ux, uz, f, o):
        """Planks nailed over a window, in its opening: three across and one aslant."""
        s0, s1, y0, y1 = o["s0"], o["s1"], o["y0"], o["y1"]
        keep = self.tint
        self.tint = (0.55, 0.48, 0.4)
        h = y1 - y0
        for k, (a, b_) in enumerate(((0.12, 0.3), (0.42, 0.6), (0.72, 0.9))):
            ya, yb = y0 + h * a, y0 + h * b_
            # (the planks across 7.5 cm back, the one aslant 2 cm back: 5.5 cm apart, never in one plane)
            self.face([W(s0 + 0.004, ya, -0.075), W(s1 - 0.004, ya, -0.075), W(s1 - 0.004, yb, -0.075), W(s0 + 0.004, yb, -0.075)], MAT_WOOD,
                      [(0, 0), (1.2, 0), (1.2, 0.12), (0, 0.12)], (0, 0), f, 0.75 + 0.1 * k)
        dy = 0.1
        self.face([W(s0 + 0.004, y0 + 0.1, -0.02), W(s0 + 0.004, y0 + 0.1 + dy * 2, -0.02), W(s1 - 0.004, y1 - 0.1, -0.02), W(s1 - 0.004, y1 - 0.1 - dy * 2, -0.02)],
                  MAT_WOOD, [(0, 0), (0, 0.12), (1.5, 0.12), (1.5, 0)], (0, 0), f, 0.6)
        self.tint = keep

    def balcony(self, W, ux, uz, f, s0, s1, y0):
        """A stone balcony before a first-floor window: a stone slab, an iron railing. Its underside at 4.21 m, over
        the signs' band (no consoles under it: they would reach into the band where the shop boards go)."""
        st = self.ds["stone"]
        a, b_, d = s0 - 0.35, s1 + 0.35, 0.65
        ya, yb = max(4.21, y0 - 0.14), y0 - 0.01
        self.slab(W, ux, uz, f, a, b_, ya, yb, 0, d, st, under=True)
        iron = 0.16
        y2 = yb + 0.9
        self.rod(W(a + 0.04, y2, d - 0.05), W(b_ - 0.04, y2, d - 0.05), 0.04, iron)
        self.rod(W(a + 0.04, yb + 0.12, d - 0.05), W(b_ - 0.04, yb + 0.12, d - 0.05), 0.025, iron)
        for sd in (a + 0.04, b_ - 0.04):
            self.rod(W(sd, y2, 0.05), W(sd, y2, d - 0.05), 0.03, iron)
            self.rod(W(sd, yb + 0.12, 0.05), W(sd, yb + 0.12, d - 0.05), 0.02, iron)
        s = a + 0.04
        while s <= b_ - 0.04 + 1e-6:
            self.rod(W(s, yb, d - 0.05), W(s, y2, d - 0.05), 0.02, iron)
            s += 0.12
        for dd in (0.2, 0.4):
            for sd in (a + 0.04, b_ - 0.04):
                self.rod(W(sd, yb, dd), W(sd, y2, dd), 0.02, iron)

    def window_box(self, W, ux, uz, f, s0, s1, y0):
        """A flower box on a sill: a painted wooden box standing on it and out over its edge, flowers in it."""
        keep = self.tint
        self.tint = self.ds["paint"] if self.ds["shutters"] else (0.42, 0.3, 0.22)
        a, b_, d0, d1, h = s0 + 0.03, s1 - 0.03, 0.02, 0.2, 0.17
        self.face([W(a, y0, d1), W(b_, y0, d1), W(b_, y0 + h, d1), W(a, y0 + h, d1)], MAT_WOOD, [(0, 0), (1, 0), (1, 0.1), (0, 0.1)], (0, 0), f, 0.75)
        for se, sg in ((a, -1), (b_, 1)):
            self.face([W(se, y0, d0), W(se, y0, d1), W(se, y0 + h, d1), W(se, y0 + h, d0)], MAT_WOOD,
                      [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], (0, 0), (ux * sg, 0, uz * sg), 0.6)
        # (its underside only out past the sill, 0.1 m: over the sill it stands on the sill's top)
        self.face([W(a, y0, 0.1), W(b_, y0, 0.1), W(b_, y0, d1), W(a, y0, d1)], MAT_WOOD, [(0, 0), (1, 0), (1, 0.1), (0, 0.1)], (0, 0), (0, -1, 0), 0.45)
        self.face([W(a, y0 + h, d0), W(b_, y0 + h, d0), W(b_, y0 + h, d1), W(a, y0 + h, d1)], MAT_WOOD, [(0, 0), (1, 0), (1, 0.1), (0, 0.1)], (0, 0), (0, 1, 0), 0.3)
        # the flowers: a clump over the earth
        self.tint = self.ds["flowers"]
        fa, fb, e0, e1, y2 = a + 0.05, b_ - 0.05, d0 + 0.03, d1 - 0.02, y0 + h + 0.2
        self.face([W(fa, y0 + h, e1), W(fb, y0 + h, e1), W(fb, y2, e1 - 0.03), W(fa, y2, e1 - 0.03)], MAT_LEAF, [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], (0, 0), f, 0.95)
        self.face([W(fa, y2, e0 + 0.03), W(fb, y2, e0 + 0.03), W(fb, y2, e1 - 0.03), W(fa, y2, e1 - 0.03)], MAT_LEAF, [(0, 0), (1, 0), (1, 0.1), (0, 0.1)], (0, 0), (0, 1, 0), 1.0)
        for se, sg in ((fa, -1), (fb, 1)):
            self.face([W(se, y0 + h, e0), W(se, y0 + h, e1), W(se, y2, e1 - 0.03), W(se, y2, e0 + 0.03)], MAT_LEAF,
                      [(0, 0), (0.1, 0), (0.1, 0.2), (0, 0.2)], (0, 0), (ux * sg, 0, uz * sg), 0.8)
        self.tint = keep

    def lantern(self, W, ux, uz, f, s, dy=0.0):
        """An iron lantern on an arm by a door: a wall plate, the arm, the lamp with its glass; (x, y, z) of
        its glass for ambient.ts, which lights it at night. dy: that much higher (a church door)."""
        iron = 0.18
        self.slab(W, ux, uz, f, s - 0.06, s + 0.06, 2.55 + dy, 2.95 + dy, 0, 0.07, iron)
        fx, fz = f[0], f[2]
        self.rod(W(s, 2.85 + dy, 0.07), W(s, 2.85 + dy, 0.42), 0.035, iron)
        self.rod(W(s, 2.6 + dy, 0.07), W(s, 2.83 + dy, 0.4), 0.025, iron)
        cx, cy, cz = W(s, 2.66 + dy, 0.42)
        self.box(cx, cy + 0.13, cz, 0.24, 0.06, 0.24, ux, uz, MAT_STONE, (0, 0), iron, bottom=True)  # the cap
        keep = self.tint
        self.tint = (1.0, 0.86, 0.6)
        self.box(cx, cy - 0.04, cz, 0.17, 0.28, 0.17, ux, uz, MAT_FACADE, TRANSOM, 0.95, uv01=True, skip=(0, 1, 0))  # the glass
        self.tint = keep
        self.box(cx, cy - 0.2, cz, 0.13, 0.05, 0.13, ux, uz, MAT_STONE, (0, 0), iron, bottom=True)  # the foot
        LAMPS.append([round(cx, 2), round(cy - 0.04, 2), round(cz, 2), round(fx, 3), round(fz, 3)])

    def shopfront(self, W, ux, uz, f, s0, s1, y0, y1, bw):
        """M7 quays pass 2 (second pass): a painted timber shopfront round a shop window: pilasters either side,
        a stall riser under the glass with a sill, a fascia over it and a cornice on that; all under the sign
        band (streetlife.ts BOARD_BAND starts at 3.47 m: the painted boards go there, over the cornice) and
        inside the bay's shop window box of facadeOpenings but for the fascia and the cornice."""
        keep = self.tint
        self.tint = self.ds["shopcol"]
        wood = MAT_WOOD
        # (as wide as the window's box of facadeOpenings leaves beside the glass: 3/64 of the bay; a house
        # number beside the door keeps its place)
        p = min(0.14, bw * 3 / 64 - 0.005)
        # the pilasters, from the kerb to the fascia (their tops lie under it: none)
        for p0, p1 in ((s0 - p, s0), (s1, s1 + p)):
            self.slab(W, ux, uz, f, p0, p1, KERB_H, y1, 0, 0.1, 0.8, mat=wood, top=False)
        # the stall riser and the sill over it, between the pilasters (no ends: the pilasters' sides are there)
        self.slab(W, ux, uz, f, s0, s1, KERB_H, y0 - 0.06, 0, 0.07, 0.62, mat=wood, top=False, ends=False)
        self.slab(W, ux, uz, f, s0, s1, y0 - 0.06, y0, 0, 0.1, 0.85, mat=wood, under=True, ends=False)
        # the fascia (its top lies under the cornice) and the cornice, 3.44 m at the top
        self.slab(W, ux, uz, f, s0 - p, s1 + p, y1, 3.3, 0, 0.12, 0.72, mat=wood, under=True, top=False)
        self.slab(W, ux, uz, f, s0 - p - 0.04, s1 + p + 0.04, 3.3, 3.44, 0, 0.18, 0.9, mat=wood, under=True)
        self.tint = keep

    def quoins_at(self, W, ux, uz, f, L, end, top):
        """Quoins up one outer corner of a front (end 0: its start, 1: its end), 7 cm proud: long and short
        stones in turn; a long one runs on past the corner over the other face's short one."""
        st = self.ds["stone"]
        if self.ds.get("pilaster"):
            self.pilaster_at(W, ux, uz, f, L, end, top)
            return
        fine_ = self.ds.get("klass") in ("fine", "good")
        y, k = (0.52 if fine_ else 0.5), 0  # (over the fine fronts' plinth, 0.5 m)
        ytop = top - 0.42
        hk = 0.36 if fine_ else 0.28  # (the fine fronts: taller, rusticated stones, 9 cm proud)
        pr = 0.09 if fine_ else 0.07
        while y + hk <= ytop:
            long_ = (k + end) % 2 == 0
            ln = 0.3 if long_ else 0.2  # (0.3: a bracket sign's plate 0.5 m from the corner stays clear)
            ext = pr if long_ else 0.0
            sa, sb = (-ext, ln) if end == 0 else (L - ln, L + ext)
            self.slab(W, ux, uz, f, sa, sb, y, y + hk, 0, pr, st * (1.0 if long_ else 0.93), under=True)
            y += hk + 0.02
            k += 1

    def pilaster_at(self, W, ux, uz, f, L, end, top):
        """The districts pass: a flat stone pilaster up one outer corner of a fine front, a base and a capital. At
        a corner the start's pilaster runs on past it over the end of the other face's (like a long quoin)."""
        st = self.ds["stone"]
        y0, yt = 0.52, top - 0.42
        if yt - y0 < 2.0:
            return
        for (ya, yb, wd, pr, g) in ((y0, y0 + 0.4, 0.4, 0.13, 0.95), (y0 + 0.4, yt - 0.34, 0.34, 0.08, 1.0),
                                    (yt - 0.34, yt - 0.22, 0.4, 0.12, 1.05), (yt - 0.22, yt, 0.44, 0.16, 1.1)):
            ext = pr if end == 0 else 0.0
            sa, sb = (-ext, wd) if end == 0 else (L - wd, L)
            self.slab(W, ux, uz, f, sa, sb, ya, yb, 0, pr, st * g, under=True)

    def door_steps(self, W, ux, uz, f, o, stone):
        """The districts pass: a bluestone step before the door of a fine or a good house (from the pavement up to
        the door's sill), and on a fine front consoles under the lintel's hood."""
        lw = o["w"] + 2 * o["J"] + 0.12
        sc = o["s"]
        self.slab(W, ux, uz, f, sc - lw / 2, sc + lw / 2, KERB_H, o["hs"], 0.1, 0.42, 0.6)
        if self.ds.get("klass") == "fine" and o["top"] == "flat":
            ys = o["ys"]
            for sg in (-1, 1):
                c = sc + sg * (o["w"] / 2 + o["J"] / 2)
                self.slab(W, ux, uz, f, c - 0.07, c + 0.07, ys - 0.26, ys, 0, 0.16, stone * 1.08, under=True)

    def plinth(self, W, ux, uz, f, L, ops, top=0.55):
        """A plinth of blue stone at the foot of a storehouse front, broken at its gates and doors."""
        cuts = sorted((o["s"] - o["w"] / 2 - o.get("J", 0.2) - 0.02, o["s"] + o["w"] / 2 + o.get("J", 0.2) + 0.02) for o in ops)
        s, runs = 0.05, []
        for c0, c1 in cuts:
            if c0 > s + 0.2:
                runs.append((s, c0))
            s = max(s, c1)
        if L - 0.05 > s + 0.2:
            runs.append((s, L - 0.05))
        for r0, r1 in runs:
            self.slab(W, ux, uz, f, r0, r1, KERB_H, top, 0, 0.06, 0.62, blocks=1)

    def gable_front(self, h, P, s0, s1, tt, H, pts, style, out):
        """M7 quays pass 2 (second pass): the front of a stepped or spout gable with its windows cut in (a sash,
        a stone sill, a relieving arch), on a front with the whole dress. The outline pts [(s, y over H)]; the
        face as a grid clipped to it. Returns the windows [(s_mid from s0, y0, y1, width, small)] for ambient.ts."""
        W = s1 - s0
        bays = max(1, round(W / BAY))
        bw = W / bays
        sh = self.sh

        def f_at(s):
            best = None
            for (sa, ya), (sb, yb) in zip(pts, pts[1:]):
                if min(sa, sb) - 1e-7 <= s <= max(sa, sb) + 1e-7:
                    y = min(ya, yb) if abs(sb - sa) < 1e-7 else ya + (yb - ya) * (s - sa) / (sb - sa)
                    best = y if best is None else min(best, y)
            return best if best is not None else 0.0

        def f_min(a, b_):
            xs_ = [a + (b_ - a) * q / 16 for q in range(17)] + [s for s, _ in pts if a < s < b_]
            return min(f_at(x) for x in xs_)
        wins = []
        j = 0
        top = max(y for _, y in pts)
        while j * sh + 1.2 < top:
            base = j * sh
            y0, y1 = base + sh * UP_V[0], base + sh * UP_V[1]
            row = []
            for i in range(bays):
                a_, b_ = s0 + i * bw + bw * UP_U[0], s0 + i * bw + bw * UP_U[1]
                if a_ - s0 > 0.35 and s1 - b_ > 0.35 and f_min(a_ - 0.1, b_ + 0.1) >= y1 + 0.25:
                    row.append({"s0": a_, "s1": b_, "y0": H + y0, "y1": H + y1, "kind": "win", "small": False, "j": 9})
            if not row:
                # small windows: one on each bay's middle where they fit, else one in the middle of the gable
                y0s, y1s = base + 0.6, base + 1.6
                for sm in [s0 + (i + 0.5) * bw for i in range(bays)] if bays > 1 else []:
                    if sm - s0 > 0.6 and s1 - sm > 0.6 and f_min(sm - 0.46, sm + 0.46) >= y1s + 0.25:
                        row.append({"s0": sm - 0.36, "s1": sm + 0.36, "y0": H + y0s, "y1": H + y1s, "kind": "win", "small": True, "j": 9})
                sm = (s0 + s1) / 2
                if not row and f_min(sm - 0.46, sm + 0.46) >= y1s + 0.25:
                    row.append({"s0": sm - 0.36, "s1": sm + 0.36, "y0": H + y0s, "y1": H + y1s, "kind": "win", "small": True, "j": 9})
            wins += row
            j += 1

        u = (P(s0 + 1, tt)[0] - P(s0, tt)[0], P(s0 + 1, tt)[1] - P(s0, tt)[1])

        def Wg(s, y, d=0.0):
            x, z = P(s, tt)
            return (x + out[0] * d, y, z + out[2] * d)
        # the face: columns at the outline's corners and the windows' sides, rows at the windows' heights
        xs = sorted({s0, s1, *[s for s, _ in pts if s0 < s < s1], *[v for w_ in wins for v in (w_["s0"], w_["s1"])]})
        ys = sorted({0.0, *[v - H for w_ in wins for v in (w_["y0"], w_["y1"])]})
        cell = (PART_COL["blind"], STYLE_ROW[style])
        v0 = (H - self.gh) / sh
        for xa, xb in zip(xs, xs[1:]):
            if xb - xa < 1e-6:
                continue
            fa, fb = f_at(xa + 1e-6), f_at(xb - 1e-6)
            ftop = max(fa, fb)
            ycol = [y for y in ys if y < ftop - 1e-6] + [ftop]
            sm = (xa + xb) / 2
            here = [w_ for w_ in wins if w_["s0"] < sm < w_["s1"]]
            for ya, yb in zip(ycol, ycol[1:]):
                ym = (ya + yb) / 2
                if any(w_["y0"] - H < ym < w_["y1"] - H for w_ in here):
                    continue
                poly = [(xa, ya), (xb, ya), (xb, yb), (xa, yb)]
                # clip to under the outline (y <= fa .. fb, a line across the column)
                def g(p):
                    return p[1] - (fa + (fb - fa) * (p[0] - xa) / (xb - xa))
                clipped = []
                for p, q in zip(poly, poly[1:] + poly[:1]):
                    gp, gq = g(p), g(q)
                    if gp <= 1e-9:
                        clipped.append(p)
                    if (gp < -1e-9 < gq) or (gq < -1e-9 < gp):
                        tq = gp / (gp - gq)
                        clipped.append((p[0] + (q[0] - p[0]) * tq, p[1] + (q[1] - p[1]) * tq))
                pts2 = []
                for p in clipped:
                    if not pts2 or math.hypot(p[0] - pts2[-1][0], p[1] - pts2[-1][1]) > 1e-6:
                        pts2.append(p)
                if len(pts2) > 2 and math.hypot(pts2[0][0] - pts2[-1][0], pts2[0][1] - pts2[-1][1]) < 1e-6:
                    pts2.pop()
                if len(pts2) < 3:
                    continue
                self.face([Wg(s, H + y) for s, y in pts2], MAT_FACADE,
                          [((s - s0) / BAY, v0 + y / sh) for s, y in pts2], cell, out)
        keep = dict(self.ds)
        self.ds.update(head="arch", head1="arch", boxes=False, shutters=False, row=STYLE_ROW[style])
        rec = []
        for w_ in wins:
            self.dress_open(Wg, u[0], u[1], out, w_, WIN_R, DORMWIN if w_["small"] else self.ds["sash"])
            self.dress_detail(Wg, u[0], u[1], out, w_, H + f_min(w_["s0"] - 0.2, w_["s1"] + 0.2) - 0.05, bw)
            rec.append([round((w_["s0"] + w_["s1"]) / 2 - s0, 3), round(w_["y0"], 3), round(w_["y1"], 3), round(w_["s1"] - w_["s0"], 3), w_["small"]])
        self.ds.clear()
        self.ds.update(keep)
        return rec

    def upper_front(self, a, b, L, f, ya, yb, bays, row):
        """The upper storeys of a street wall with the windows cut in (a storehouse's loading doors too);
        a storey the windows do not fit in keeps the painted wall. Returns the openings."""
        bw = L / bays
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        sh, gh = self.sh, self.gh
        loads = self.cur_load or []
        ops = []
        ycut = ya
        j = 0
        while abs(ya - gh) < 0.01:
            base = gh + j * sh
            wy0, wy1 = base + sh * UP_V[0], base + sh * UP_V[1]
            if wy1 + 0.12 > yb:
                break
            # the loading doors: rect_house puts one a storey while y + 2.6 < H - 0.3
            lds = loads if base + 2.6 < yb - 0.3 else []
            for k in lds:
                ops.append({"s0": k - 0.75, "s1": k + 0.75, "y0": base + 0.35, "y1": base + 2.45, "kind": "load"})
            for i in range(bays):
                s0, s1 = i * bw + bw * UP_U[0], i * bw + bw * UP_U[1]
                if any(s0 < k + 1.05 and k - 1.05 < s1 for k in lds):
                    continue  # (ambient.ts lights no pane there either)
                ops.append({"s0": s0, "s1": s1, "y0": wy0, "y1": wy1, "kind": "win", "j": j,
                            # (the districts pass: a balcony before the first floor's middle window of some fine fronts)
                            "balcony": j == 0 and i == bays // 2 and bays >= 3 and self.ds.get("klass") == "fine"
                            and self.ds["rng"].random() < 0.5 and not self.ds["store"]})
            ycut = min(yb, base + sh)
            j += 1
        if ycut > ya + 0.01:
            # (the whole dress: the piers are plain wall, the rest is 3D; else the painted cell round the openings)
            pier = (row, FARPIER_ROW) if self.prime else (PART_COL["upper"], row)
            # (v a little up: at v = 0 the texel row sampled flips between the cell's bottom and its top row, a
            # mortar row, and the storey's foot showed as a light line)
            self.cut(W, 0, L, ya, ycut, ops, lambda s, y: (s / bw, (y - gh) / sh + 0.01), pier, f, self.backing)
        if yb - ycut > 0.01:  # (no window fits: the painted wall as before)
            v0, v1 = (ycut - gh) / sh, (yb - gh) / sh
            self.face([W(0, ycut), W(L, ycut), W(L, yb), W(0, yb)], MAT_FACADE,
                      [(0, v0), (bays, v0), (bays, v1), (0, v1)], (PART_COL["upper"], row), f)
        for o in ops:
            if o["kind"] == "load":
                self.dress_open(W, ux, uz, f, o, 0.14, LOADING)
            else:
                # (grime pass 2) the poorest houses: now and then a cracked pane, or boards over a window
                bad = None
                if self.wear > 0.86 and not self.ds["store"]:
                    x = self.ds["rng"].random()
                    bad = "boards" if x < 0.06 else "cracked" if x < 0.16 else None
                self.dress_open(W, ux, uz, f, o, WIN_R, SASH_CRACKED if bad == "cracked" else self.ds["sash"])
                if bad == "boards":
                    self.boards(W, ux, uz, f, o)
                    o["boards"] = True  # (its shutters stand open: shut, they would lie on the planks)
                # (the head stops under the next storey's band and sill)
                if self.prime:
                    self.dress_detail(W, ux, uz, f, o, min(self.lim, o["y0"] + sh - 0.52), bw)
        if self.prime:
            self.front_lines(W, ux, uz, f, L, yb, bw, bays, ops)
        return ops

    def shop_run(self, a, b, L, f, k0, k1, bw, gy, row):
        """Ground-storey bays k0..k1 with their shop windows cut in, SHOP_R deep."""
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        gh = self.gh
        ops = [{"s0": k * bw + bw * SHOP_U[0], "s1": k * bw + bw * SHOP_U[1], "y0": gh * SHOP_V[0], "y1": gh * SHOP_V[1], "kind": "shop"}
               for k in range(k0, k1)]
        pier = (PART_COL["ground"], row)
        # (v stops short of 1 at the storey's top: v = 1 is the cell's bottom row, the plinth, a light line)
        self.cut(W, k0 * bw, k1 * bw, 0, gy, ops, lambda s, y: (s / bw, min(y / gh, 0.98)), pier, f,
                 None if self.backing is None else self.backing - 0.02)
        for o in ops:
            self.dress_open(W, ux, uz, f, o, SHOP_R, self.ds["shop"])
            if self.prime:
                self.dress_detail(W, ux, uz, f, o, gy, bw)

    # ---------------------------------------------------------------- yard windows (2026-09-26)
    # Steve: the backs of the houses on the yards and courts (tools/city/alleys.py) had their windows painted
    # flat on the wall (the front's storey cells, shop windows and all); the alley cottages got real ones
    # (cottage_wall). Now the backs too: the wall is the house's plain picture (the ground storey on its
    # plinth), each bay's window cut in, its sash YARD_R back in a reveal of the wall's own picture, a sill and
    # a lintel on the wall (near-only mesh), the painted shutters flat beside the glass on a plastered house
    # that has shutters. By the house's class and wear: the better backs tall and clean; the poorer smaller, a
    # pane patched with a board or paper or cracked, now and then boarded up, a timber lintel, a bay left
    # blind. Every window (with its shutters, sill and lintel) stays inside the box shared/posterWalls.ts
    # wallOpenings gives a "front" wall's window, so the bills and the gutters keep clear of it; the windows
    # are listed in shared/city_yard_windows.json (world/yardWindows.ts: ambient.ts lights them, clutter.ts keeps its
    # downpipes off them).
    YARD_GRADE = {"fine": 2, "good": 2, "merchant": 2, "middle": 1, "store": 1, "poor": 0, "alley": 0}
    # by grade: the glass's width in 64ths of a bay; an upper window's foot and head over its storey's floor;
    # a ground-storey window's foot and head
    YARD_WIN = {2: (22, 0.6, 2.4, 0.95, 2.75), 1: (20, 0.7, 2.3, 1.0, 2.6), 0: (18, 0.8, 2.2, 1.05, 2.45)}

    def yard_run(self, a, b, L, f, k0, k1, bw, ya, yb, row):
        """Bays k0..k1 of a back wall on a yard, ya..yb (the ground storey, or all the upper storeys), with
        their windows cut in (the yard windows above)."""
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = f[0], f[2]

        def W(s, y, d=0.0):
            return (a[0] + ux * s + fx * d, y, a[1] + uz * s + fz * d)
        yd = self.yd
        gh, sh = self.gh, self.sh
        grade = self.YARD_GRADE.get(yd.get("klass"), 1)
        pw, u0, u1, gy0, gy1 = self.YARD_WIN[grade]
        gw = bw * pw / 64.0
        shut = yd["plaster"] and yd["shutters"] and not yd["store"]
        sw = gw * 6 / 28.0 if shut else 0.0  # (the painted leaf beside the glass, as on the cottages)
        ground = ya < 0.01
        # (the wall's own dice: the house's dress keeps its own draws)
        r = random.Random(int(yd.get("seed", 0)) * 53 + 1874 + int(round(abs(a[0]) * 10 + abs(a[1]) * 7 + ya * 3)))
        ops = []
        if ground:
            for k in range(k0, k1):
                if grade == 0 and r.random() < 0.15:
                    continue  # (a poor back: a bay left blind now and then)
                if gy1 + 0.4 > yb:
                    continue
                c = (k + 0.5) * bw
                ops.append({"s0": c - gw / 2, "s1": c + gw / 2, "y0": gy0, "y1": gy1, "kind": "win"})
            ycut = yb
        else:
            ycut = ya
            j = 0
            while True:
                base = gh + j * sh
                wy0, wy1 = base + u0, base + u1
                if wy1 + 0.35 > yb:  # (the lintel keeps clear of the eaves)
                    break
                for k in range(k0, k1):
                    if grade == 0 and r.random() < 0.08:
                        continue
                    c = (k + 0.5) * bw
                    ops.append({"s0": c - gw / 2, "s1": c + gw / 2, "y0": wy0, "y1": wy1, "kind": "win"})
                ycut = min(yb, base + sh)
                j += 1
        holes = [dict(o, s0=o["s0"] - sw, s1=o["s1"] + sw) for o in ops]
        if ground:
            cell = (PART_COL["door"], row)  # (the plain ground storey on its plinth)
            uvf = lambda s, y: (s / bw, min(y / gh, 0.98))  # noqa: E731
            self.cut(W, k0 * bw, k1 * bw, 0, yb, holes, uvf, cell, f, self.backing - 0.02)
        else:
            cell = (PART_COL["blind"], row)
            uvf = lambda s, y: (s / bw, (y - gh) / sh + 0.01)  # noqa: E731
            if ycut > ya + 0.01:
                self.cut(W, 0, L, ya, ycut, holes, uvf, cell, f, self.backing)
            if yb - ycut > 0.01:
                self.face([W(0, ycut), W(L, ycut), W(L, yb), W(0, yb)], MAT_FACADE, [uvf(0, ycut), uvf(L, ycut), uvf(L, yb), uvf(0, yb)], cell, f)
        stone = yd["stone"] * (0.92 if grade == 0 else 1.0)
        keep_ds, keep_tint = self.ds, self.tint
        self.ds = yd  # (dress_open: the reveal in the wall's own row)
        for o in ops:
            g0, g1, y0, y1 = o["s0"], o["s1"], o["y0"], o["y1"]
            # the pane: the house's sash; the poorer backs patched, cracked or boarded now and then
            x = r.random()
            bad = None
            if grade == 0:
                bad = "boards" if (x < 0.08 and self.wear > 0.8) else "patched" if x < 0.26 else "cracked" if x < 0.34 else None
            elif grade == 1:
                bad = "patched" if x < 0.05 else "cracked" if x < 0.09 else None
            glass = SASH_PATCHED if bad == "patched" else SASH_CRACKED if bad == "cracked" else yd["sash"]
            self.dress_open(W, ux, uz, f, o, YARD_R, glass)
            if bad == "boards":
                self.boards(W, ux, uz, f, o)
            if self.rec_yard is not None:
                self.rec_yard.append([self.rec_wall, round((g0 + g1) / 2, 2), round(g1 - g0, 2), round(y0, 2), round(y1, 2)] + ([1] if bad == "boards" else []))
            YARD_N["windows"] = YARD_N.get("windows", 0) + 1
            YARD_N[bad or "clean"] = YARD_N.get(bad or "clean", 0) + 1
            # the painted shutters (the upper cell's leaves) flat on the wall, left and right of the glass
            if sw > 0:
                for sa, sb, pa, pb in ((g0 - sw, g0, 12, 18), (g1, g1 + sw, 46, 52)):
                    self.face([W(sa, y0), W(sb, y0), W(sb, y1), W(sa, y1)], MAT_FACADE,
                              [(pa / 64.0, 12 / 64.0), (pb / 64.0, 12 / 64.0), (pb / 64.0, 52 / 64.0), (pa / 64.0, 52 / 64.0)], (PART_COL["upper"], row), f)
            # the sill and the lintel on the wall (near-only): stone; a timber lintel on the poor backs, a keystone on the fine
            self.detail(True)
            self.slab(W, ux, uz, f, g0 - 0.04, g1 + 0.04, y0 - 0.05, y0 + 0.03, 0, 0.07, stone * 0.9, under=y0 > 1.7)
            if grade == 0:
                self.tint = (0.42, 0.35, 0.28)
                # (6.5 cm proud: nearer the wall, the zfight check counts it a close layer that the wobble can make flicker)
                self.slab(W, ux, uz, f, g0 - 0.1, g1 + 0.1, y1, y1 + 0.14, 0, 0.065, 0.8, mat=MAT_WOOD, under=True)
                self.tint = keep_tint
            else:
                self.slab(W, ux, uz, f, g0 - 0.06, g1 + 0.06, y1, y1 + (0.16 if grade == 2 else 0.13), 0, 0.055, stone, under=True, ends=False)
                if yd.get("klass") == "fine":
                    sc = (g0 + g1) / 2
                    self.slab(W, ux, uz, f, sc - 0.07, sc + 0.07, y1 - 0.02, y1 + 0.22, 0, 0.1, stone * 1.05, under=True, top=False)
            self.detail(False)
        self.ds = keep_ds

    def front_lines(self, W, ux, uz, f, L, yb, bw, bays, ops):
        """At the floor lines over the first floor (the first, 3.8 m, is the signs' band): a stone band
        across the front, or iron anchors on the piers between the windows (near-only mesh)."""
        ds = self.ds
        self.detail(True)
        j = 1
        while True:
            y = self.gh + j * self.sh
            if y + 0.07 > yb - 0.42:
                break
            if ds["bands"]:
                qa, qb = getattr(self, "qends", (False, False))
                self.slab(W, ux, uz, f, 0.36 if qa else 0.06, L - (0.36 if qb else 0.06), y - 0.09, y + 0.07, 0, 0.07, ds["stone"] * 0.92, under=True)
            elif ds["anchors"] and (not ds["store"] or j >= 2):
                for k in range(1, bays):
                    s = k * bw
                    if any(o["kind"] == "load" and o["s0"] - 0.35 < s < o["s1"] + 0.35 for o in ops):
                        continue
                    self.anchor(W, ux, uz, f, s, y - 0.1, ds["store"])
            j += 1
        self.detail(False)

    def decal(self, W, s0, s1, y0, y1, cell, f, flip=False, d=0.006):
        """A grime decal on a wall (W(s, y, d)): cell's picture over s0..s1 x y0..y1, 6 mm out, tinted."""
        keep = self.tint
        self.tint = GRIME_TINT[cell]
        u0, u1 = (0.99, 0.01) if flip else (0.01, 0.99)
        self.face([W(s0, y0, d), W(s1, y0, d), W(s1, y1, d), W(s0, y1, d)], MAT_GRIME,
                  [(u0, 0.01), (u1, 0.01), (u1, 0.99), (u0, 0.99)], cell, f, 1.0)
        self.tint = keep

    def roof_soot(self, pts, out):
        """A soot blob on a roof round a chimney: four world points (x, y, z) on the roof, 1.2 cm over it."""
        keep = self.tint
        self.tint = GRIME_TINT[BLOB]
        self.face([(p[0], p[1] + 0.012, p[2]) for p in pts], MAT_GRIME, [(0.01, 0.01), (0.99, 0.01), (0.99, 0.99), (0.01, 0.99)], BLOB, out, 1.0)
        self.tint = keep

    def anchor(self, W, ux, uz, f, s, y, cross):
        """A wall anchor, the end of an iron tie to a floor beam: an upright bar, or a cross (storehouses)."""
        iron = 0.2
        if cross:
            for sg in (-1, 1):
                self.strip(W, ux, uz, f, (s - 0.2, y - 0.2 * sg), (s + 0.2, y + 0.2 * sg), 0.045, 0.045 + 0.005 * sg, iron)
        else:
            self.slab(W, ux, uz, f, s - 0.025, s + 0.025, y - 0.3, y + 0.3, 0, 0.045, iron, top=False)
        self.slab(W, ux, uz, f, s - 0.045, s + 0.045, y - 0.045, y + 0.045, 0, 0.075, iron * 1.3)
        # (grime pass 2) the rust run down from it
        self.decal(W, s - 0.09, s + 0.09, y - (1.0 if cross else 0.95), y + 0.02, RUST, f)

    def strip(self, W, ux, uz, f, p0, p1, w, t, shade, mat=MAT_STONE):
        """A bar lying on the wall from p0 to p1 ((s, y) on it), w wide, its face t out: the face and its long edges."""
        ds_, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(ds_, dy) or 1
        ns, ny = -dy / ln * w / 2, ds_ / ln * w / 2
        c = [(p0[0] + ns, p0[1] + ny), (p1[0] + ns, p1[1] + ny), (p1[0] - ns, p1[1] - ny), (p0[0] - ns, p0[1] - ny)]
        self.face([W(sv, yv, t) for sv, yv in c], mat, [(0, 0), (0.1, 0), (0.1, 0.02), (0, 0.02)], (0, 0), f, shade)
        for (qa, qb), sg in (((c[0], c[1]), 1), ((c[3], c[2]), -1)):
            self.face([W(qa[0], qa[1], 0), W(qb[0], qb[1], 0), W(qb[0], qb[1], t), W(qa[0], qa[1], t)], mat,
                      [(0, 0), (0.1, 0), (0.1, 0.02), (0, 0.02)], (0, 0), (ux * ns * sg, ny * sg, uz * ns * sg), shade * 0.8)

    def downpipe(self, W, ux, uz, f, s, top, bottom, L=99.0):
        """A rainwater pipe from the hopper under the cornice down to the kerb, on brackets (near-only)."""
        self.detail(True)
        zinc = 0.3
        self.slab(W, ux, uz, f, s - 0.05, s + 0.05, bottom + 0.2, top - 0.26, 0.08, 0.18, zinc, top=False)
        self.slab(W, ux, uz, f, s - 0.065, s + 0.065, bottom, bottom + 0.2, 0.07, 0.26, zinc * 0.9)  # the shoe
        self.slab(W, ux, uz, f, s - 0.13, s + 0.13, top - 0.26, top, 0.04, 0.28, zinc * 1.1, under=True)  # the hopper
        y = 1.1
        while y < top - 0.8:
            self.slab(W, ux, uz, f, s - 0.07, s + 0.07, y, y + 0.035, 0, 0.08, zinc * 0.8, under=True, top=False, ends=False)
            self.decal(W, s - 0.08, s + 0.08, y - 0.5, y + 0.02, RUST, f)  # (grime pass 2)
            y += 2.4
        # (grime pass 2) damp round its foot, where it overflows, and under the hopper
        self.decal(W, max(0.02, s - 0.25), min(L - 0.02, s + 0.25), bottom, bottom + 1.5, DAMP, f)
        self.decal(W, max(0.02, s - 0.3), min(L - 0.02, s + 0.3), top - 1.5, top - 0.2, DAMP, f)
        self.detail(False)

    def ledge(self, ring, outs, flags, layers, inner=0.0, shade=0.85, mat=MAT_STONE, back=False, under_from=None, cell=(0, 0)):
        """A moulding along the flagged walls of a ring (a cornice, a gutter, a parapet's coping): layers
        [(y0, y1, p)], each p out from the wall, stepping out as they go up; mitred where two flagged walls
        meet, an end face where it stops. inner: where it starts (< 0: over the wall's top, a coping); back:
        a face at inner too; under_from: the first layer's underside only from there out (it sits on another)."""
        n = len(ring)

        def line(i, p):
            (ax, az), (bx, bz) = ring[i], ring[(i + 1) % n]
            ox, oz = outs[i][0], outs[i][2]
            return (ax + ox * p, az + oz * p), (bx + ox * p, bz + oz * p)

        def meet(i, j, p, end):
            (a1, b1), (a2, b2) = line(i, p), line(j, p)
            d1 = (b1[0] - a1[0], b1[1] - a1[1])
            d2 = (b2[0] - a2[0], b2[1] - a2[1])
            den = d1[0] * d2[1] - d1[1] * d2[0]
            if abs(den) < 1e-6:
                return end
            t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den
            q = (a1[0] + d1[0] * t, a1[1] + d1[1] * t)
            return q if math.hypot(q[0] - end[0], q[1] - end[1]) < 3 * abs(p) + 0.05 else end

        pmax = max(abs(inner), *[abs(p) for _, _, p in layers])
        for i in range(n):
            if not flags[i]:
                continue
            a, b = ring[i], ring[(i + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 4 * pmax + 0.2:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            o = outs[i]
            pv, nv = bool(flags[(i - 1) % n]), bool(flags[(i + 1) % n])

            def ends(p, i=i, pv=pv, nv=nv):
                la, lb = line(i, p)
                return (meet((i - 1) % n, i, p, la) if pv else la), (meet(i, (i + 1) % n, p, lb) if nv else lb)

            def fc(pts, out, g, L=L):
                self.face(pts, mat, [(0, 0), (L / BAY, 0), (L / BAY, 0.05), (0, 0.05)], cell, out, g)
            last = inner
            for k, (y0, y1, p) in enumerate(layers):
                q0 = under_from if (k == 0 and under_from is not None) else last
                (a0, b0), (a1, b1) = ends(q0), ends(p)
                fc([(a0[0], y0, a0[1]), (b0[0], y0, b0[1]), (b1[0], y0, b1[1]), (a1[0], y0, a1[1])], (0, -1, 0), shade * 0.6)
                fc([(a1[0], y0, a1[1]), (b1[0], y0, b1[1]), (b1[0], y1, b1[1]), (a1[0], y1, a1[1])], o, shade * (1.0 if k % 2 == 0 else 0.92))
                for on, pe, sg in ((pv, a, -1), (nv, b, 1)):
                    if on:
                        continue
                    e0, e1 = (pe[0] + o[0] * inner, pe[1] + o[2] * inner), (pe[0] + o[0] * p, pe[1] + o[2] * p)
                    self.face([(e0[0], y0, e0[1]), (e1[0], y0, e1[1]), (e1[0], y1, e1[1]), (e0[0], y1, e0[1])], mat,
                              [(0, 0), (0.05, 0), (0.05, 0.05), (0, 0.05)], cell, (ux * sg, 0, uz * sg), shade * 0.8)
                last = p
            yt = layers[-1][1]
            (a0, b0), (a1, b1) = ends(inner), ends(layers[-1][2])
            fc([(a0[0], yt, a0[1]), (b0[0], yt, b0[1]), (b1[0], yt, b1[1]), (a1[0], yt, a1[1])], (0, 1, 0), shade * 1.05)
            if back:
                y0 = layers[0][0]
                fc([(a0[0], y0, a0[1]), (b0[0], y0, b0[1]), (b0[0], yt, b0[1]), (a0[0], yt, a0[1])], (-o[0], 0, -o[2]), shade * 0.7)

    def chimney(self, cx, cz, y0, top, sx, sz, ux, uz):
        """A brick chimney stack from y0 (inside the roof) to top, a stone cap (its top is how ambient.ts
        finds a chimney: stone, cell (1, 0), 0.8 to 1.3 m across), and pots on it."""
        r = self.ds["rng"] if self.ds else random.Random(round(cx * 977 + cz * 131))
        row = r.choice([0, 0, 3])
        # (grime pass 2: stack and cap black with soot, the pots too)
        self.box(cx, (y0 + top) / 2, cz, sx, top - y0, sz, ux, uz, MAT_FACADE, (PART_COL["blind"], row), 0.5, skip=(0, 1, 0))
        self.box(cx, top + 0.06, cz, sx + 0.12, 0.12, sz + 0.12, ux, uz, MAT_STONE, (1, 0), 0.32, bottom=True)
        n = r.choice([1, 2, 2, 3])
        nx, nz = -uz, ux
        long_u = sx >= sz
        span = (sx if long_u else sz) - 0.3
        keep = self.tint
        self.tint = r.choice([(0.55, 0.3, 0.2), (0.45, 0.26, 0.2), (0.35, 0.33, 0.31)])
        self.detail(True)  # (the pots are for near: far off the cap is the chimney's top)
        for i in range(n):
            off = 0 if n == 1 else -span / 2 + span * i / (n - 1)
            px, pz = (cx + ux * off, cz + uz * off) if long_u else (cx + nx * off, cz + nz * off)
            self.pot(px, top + 0.12, pz, r.uniform(0.085, 0.11), r.uniform(0.28, 0.45))
        self.detail(False)
        self.tint = keep

    def pot(self, x, y, z, rad, hgt, sides=6):
        """A chimney pot: a six-sided clay pipe, dark inside its top."""
        pts = [(x + rad * math.cos(2 * math.pi * i / sides), z + rad * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
        for i in range(sides):
            (ax, az), (bx, bz) = pts[i], pts[(i + 1) % sides]
            mx, mz = (ax + bx) / 2 - x, (az + bz) / 2 - z
            self.face([(ax, y, az), (bx, y, bz), (bx, y + hgt, bz), (ax, y + hgt, az)], MAT_STONE,
                      [(0, 0), (0.1, 0), (0.1, hgt / BAY), (0, hgt / BAY)], (0, 0), (mx, 0, mz), 0.85)

    def disc(self, c, axis, rad, t, shade, mat=MAT_WOOD, sides=8):
        """A wheel: an eight-sided prism round `axis` through c (game frame), t thick."""
        ax = Vector(axis).normalized()
        e1 = ax.cross(Vector((0, 1, 0)))
        if e1.length < 1e-3:
            e1 = ax.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = ax.cross(e1).normalized()
        cv = Vector(c)
        ring = [cv + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * rad for i in range(sides)]
        for sg in (-1, 1):
            self.face([tuple(p + ax * (t / 2 * sg)) for p in ring], mat, [(0, 0)] * sides, (0, 0), tuple(ax * sg), shade)
        for i in range(sides):
            p, q = ring[i], ring[(i + 1) % sides]
            m = (p + q) / 2 - cv
            self.face([tuple(p - ax * t / 2), tuple(q - ax * t / 2), tuple(q + ax * t / 2), tuple(p + ax * t / 2)], mat,
                      [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], (0, 0), tuple(m), shade * 0.8)

    def rod(self, p0, p1, w, shade, mat=MAT_STONE):
        """A thin square bar (a rope, a hanger) between two points of the game frame: its four sides."""
        a, b = Vector(p0), Vector(p1)
        ax = (b - a).normalized()
        e1 = ax.cross(Vector((0, 1, 0)))
        if e1.length < 1e-3:
            e1 = Vector((1, 0, 0))
        e1.normalize()
        e2 = ax.cross(e1).normalized()
        for u, v in ((e1, e2), (e2, -e1), (-e1, -e2), (-e2, e1)):
            c0, c1 = (u + v) * (w / 2), (u - v) * (w / 2)
            self.face([tuple(a + c0), tuple(a + c1), tuple(b + c1), tuple(b + c0)], mat,
                      [(0, 0), (0.02, 0), (0.02, 0.3), (0, 0.3)], (0, 0), tuple(u), shade)

    def dormer_new(self, P, ds_, t0, H, drop, over, k, D, style, kind):
        """A dormer in the front slope of a side roof, ds_ along the front: a front wall with a small window
        set in, cheeks of lead down to the roof, a pitched roof with its gable (or a flat lead top). The
        roof rises k metres a metre, from the eaves (H - drop, `over` metres before the wall).
        P(s, t) -> (x, z) in the house's frame. False: no room for it under the ridge."""
        row = STYLE_ROW[style]
        wcell = (PART_COL["blind"], row)
        w, qf = 1.2, 0.4
        yroof = lambda q: H - drop + (q + over) * k  # noqa: E731
        qof = lambda y: (y - (H - drop)) / k - over  # noqa: E731
        yb, ye = yroof(qf) - 0.06, yroof(qf) + 1.5
        yr = ye + 0.5
        if qof(yr + 0.05) > D / 2 - 0.3:
            return False
        u = (P(1, 0)[0] - P(0, 0)[0], P(1, 0)[1] - P(0, 0)[1])
        n = (P(0, 1)[0] - P(0, 0)[0], P(0, 1)[1] - P(0, 0)[1])

        def Wd(s, y, d=0.0):  # s across the dormer from its middle, d out of its front (towards the street)
            x, z = P(ds_ + s, t0 + qf - d)
            return (x, y, z)
        out = (-n[0], 0, -n[1])
        ww, wy0, wy1, R = 0.72, yb + 0.28, ye - 0.16, 0.07
        op = {"s0": -ww / 2, "s1": ww / 2, "y0": wy0, "y1": wy1}
        self.cut(Wd, -w / 2, w / 2, yb, ye, [op], lambda s, y: (s / BAY, y / BAY), wcell, out)
        keep = self.ds
        self.ds = dict(keep or {}, row=row)
        self.dress_open(Wd, u[0], u[1], out, op, R, DORMWIN)
        self.ds = keep
        lead = ROOF_CELL["lead"]
        qe = qof(ye)
        for sg in (-1, 1):  # the cheeks
            self.face([Wd(sg * w / 2, yb, 0), Wd(sg * w / 2, ye, 0), Wd(sg * w / 2, ye, -(qe - qf))], MAT_ROOF,
                      [(0, 0), (0, 0.5), (0.5, 0.5)], lead, (u[0] * sg, 0, u[1] * sg), 0.75)
        slate = ROOF_CELL["slate"]
        if kind == "flat":
            ext = w / 2 + 0.08
            pts = [Wd(-ext, ye, 0.1), Wd(ext, ye, 0.1), Wd(ext, ye, -(qe - qf) - 0.05), Wd(-ext, ye, -(qe - qf) - 0.05)]
            self.face([(p[0], p[1] + 0.12, p[2]) for p in pts], MAT_ROOF, [(0, 0), (0.4, 0), (0.4, 0.4), (0, 0.4)], lead, (0, 1, 0), 0.8)
            self.face(pts, MAT_ROOF, [(0, 0), (0.4, 0), (0.4, 0.4), (0, 0.4)], lead, (0, -1, 0), 0.5)
            a_, b_ = pts[0], pts[1]
            self.face([a_, b_, (b_[0], b_[1] + 0.12, b_[2]), (a_[0], a_[1] + 0.12, a_[2])], MAT_ROOF,
                      [(0, 0), (0.4, 0), (0.4, 0.04), (0, 0.04)], lead, out, 0.7)
            return True
        # pitched: its gable in the front's plane, two slopes back to the roof
        self.face([Wd(-w / 2, ye), Wd(w / 2, ye), Wd(0, yr)], MAT_FACADE, [(0, 0), (w / BAY, 0), (w / 2 / BAY, 0.17)], wcell, out)
        ext = w / 2 + 0.1
        qr, qe2 = qof(yr + 0.05), qof(ye - 0.03)
        for sg in (-1, 1):
            self.face([Wd(sg * ext, ye - 0.03, 0.12), Wd(0, yr + 0.05, 0.12), Wd(0, yr + 0.05, -(qr - qf)), Wd(sg * ext, ye - 0.03, -(qe2 - qf))],
                      MAT_ROOF, [(0, 0), (0, 0.3), (0.5, 0.3), (0.5, 0)], slate, (u[0] * sg * 0.8, 1.0, u[1] * sg * 0.8), 0.95)
        return True

    def hoist_loft(self, P, k, t0, H, drop, over, kslope, D):
        """Over a storehouse's column of loading doors: a loft in the wall's plane with a loading door set
        in, a gable roof back to the main roof, the hoist beam out of its gable with a pulley, a rope and a
        hook (Steve's pictures: the Entrepot). P(s, t) -> (x, z); k along the front from P's s = 0."""
        u = (P(1, 0)[0] - P(0, 0)[0], P(1, 0)[1] - P(0, 0)[1])
        n = (P(0, 1)[0] - P(0, 0)[0], P(0, 1)[1] - P(0, 0)[1])

        def Wl(s, y, d=0.0):  # s across from the loft's middle, d out of the wall
            x, z = P(k + s, t0 - d)
            return (x, y, z)
        out = (-n[0], 0, -n[1])
        row = self.ds["row"] if self.ds else STYLE_ROW["brick_dark"]
        wcell = (PART_COL["blind"], row)
        w, ye = 2.2, H + 2.3
        yr = ye + 1.0
        qof = lambda y: (y - (H - drop)) / kslope - over  # noqa: E731
        if qof(yr + 0.06) > D / 2 - 0.3:
            return False
        op = {"s0": -0.7, "s1": 0.7, "y0": H + 0.15, "y1": H + 2.0, "kind": "load"}
        self.cut(Wl, -w / 2, w / 2, H, ye, [op], lambda s, y: (s / BAY, y / BAY), wcell, out)
        self.dress_open(Wl, u[0], u[1], out, op, 0.14, LOADING)
        self.face([Wl(-w / 2, ye), Wl(w / 2, ye), Wl(0, yr)], MAT_FACADE, [(0, 0), (w / BAY, 0), (w / 2 / BAY, 0.33)], wcell, out)
        qe = qof(ye)
        for sg in (-1, 1):
            self.face([Wl(sg * w / 2, H, 0), Wl(sg * w / 2, ye, 0), Wl(sg * w / 2, ye, -qe)], MAT_FACADE,
                      [(0, 0), (0, (ye - H) / BAY), (qe / BAY, (ye - H) / BAY)], wcell, (u[0] * sg, 0, u[1] * sg), 0.8)
        ext = w / 2 + 0.15
        qr, qe2 = qof(yr + 0.06), qof(ye - 0.06)
        slate = ROOF_CELL["slate"]
        for sg in (-1, 1):
            self.face([Wl(sg * ext, ye - 0.06, 0.2), Wl(0, yr + 0.06, 0.2), Wl(0, yr + 0.06, -qr), Wl(sg * ext, ye - 0.06, -qe2)],
                      MAT_ROOF, [(0, 0), (0, 0.4), (0.7, 0.4), (0.7, 0)], slate, (u[0] * sg * 0.9, 1.0, u[1] * sg * 0.9), 0.95)
        # the jambs, lintel and sill of the loft's door, like the storeys' (loading_door)
        self.loading_door(Wl, 0, H - 0.2, u[0], u[1], out, recessed=True, w=1.4, hgt=1.85)
        # the hoist beam out of the gable, a pulley under its end, the rope and its hook
        by = ye + 0.42
        bx, _, bz = Wl(0, by, 0.55)
        self.box(bx, by, bz, 0.24, 0.24, 1.7, u[0], u[1], MAT_WOOD, (0, 0), 0.55, bottom=True)
        self.detail(True)
        self.disc(Wl(0, by - 0.42, 1.2), (u[0], 0, u[1]), 0.2, 0.07, 0.35)
        self.rod(Wl(0, by - 0.12, 1.2), Wl(0, by - 0.24, 1.2), 0.04, 0.3)
        self.rod(Wl(0, by - 0.42, 1.4), Wl(0, H - 1.6, 1.4), 0.035, 0.5, MAT_WOOD)
        hx, hy, hz = Wl(0, H - 1.7, 1.4)
        self.box(hx, hy, hz, 0.06, 0.2, 0.12, u[0], u[1], MAT_STONE, (0, 0), 0.22, bottom=True)
        self.detail(False)
        return True

    # ---------------------------------------------------------------- houses

    def ghost_marks(self, a, b, out, ghosts, top):
        """The churches freed (2026-09-26): on a party wall bared by a house pulled down, the ghost of that house:
        its rooms' old plaster left on the brick up to its eaves (and its gable, where its roof ran across the
        wall), dark lines where its roof, floors and joists sat, the soot of its fireplaces and flue, scraps of its
        wallpaper, and the iron anchors of its beams. Decals (no depth, pulled forward), as the grime."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        fx, fz = out[0], out[2]

        def W(s_, y, d=0.0):
            return (a[0] + ux * s_ + fx * d, y, a[1] + uz * s_ + fz * d)
        keep_t, keep_w = self.tint, self.wear
        cap = top - 0.35
        for s0, s1, g, rise in ghosts:
            r = random.Random(g["seed"] * 7 + 3)
            Hg = min(g["h"], cap)
            if Hg < 2.5:
                continue
            # the outline: up to its eaves, and its gable over them (cut off under this house's own top)
            pts = [(s0, 0.2), (s1, 0.2), (s1, Hg)]
            mid = (s0 + s1) / 2
            if rise > 0.3:
                apex = Hg + rise
                if apex <= cap:
                    pts.append((mid, apex))
                else:
                    k = (cap - Hg) / rise
                    pts += [(s1 - (s1 - mid) * k, cap), (s0 + (mid - s0) * k, cap)]
            pts.append((s0, Hg))
            self.wear = 0.8
            self.tint = GRIME_TINT[GHOST]
            self.face([W(s_, y, 0.006) for s_, y in pts], MAT_GRIME, [(s_ / 2.3, y / 2.3) for s_, y in pts], GHOST, out, 1.0)
            # the roof's line: a dark band along the outline's top (the old flashing and the rafters' ends)
            self.tint = GRIME_TINT[LINE]
            top_pts = pts[2:]
            for (p0, q0), (p1, q1) in zip(top_pts, top_pts[1:]):
                ln = max(0.1, math.hypot(p1 - p0, q1 - q0)) / 1.5
                self.face([W(p0, q0 - 0.18, 0.008), W(p1, q1 - 0.18, 0.008), W(p1, q1 + 0.06, 0.008), W(p0, q0 + 0.06, 0.008)], MAT_GRIME,
                          [(0, 0.01), (ln, 0.01), (ln, 0.99), (0, 0.99)], LINE, out, 1.0)
            # its floors: a dark line where each floor's joists sat in the wall
            floors = [self.gh + k * self.sh for k in range(max(1, g["st"]) - 1)]
            floors = [y for y in floors if y < Hg - 0.5]
            for y in floors:
                self.face([W(s0 + 0.1, y - 0.16, 0.008), W(s1 - 0.1, y - 0.16, 0.008), W(s1 - 0.1, y + 0.1, 0.008), W(s0 + 0.1, y + 0.1, 0.008)],
                          MAT_GRIME, [(0, 0.01), ((s1 - s0) / 1.5, 0.01), ((s1 - s0) / 1.5, 0.99), (0, 0.99)], LINE, out, 1.0)
            self.detail(True)
            # its chimney breast: the flue's soot up the wall, a fireplace's soot on every floor
            fs = s0 + (s1 - s0) * r.uniform(0.35, 0.65)
            fl_top = Hg
            if rise > 0.3:
                fl_top = min(cap, Hg + rise * max(0.0, 1 - abs(fs - mid) / max(0.1, (s1 - s0) / 2)))
            self.tint = GRIME_TINT[SOOT]
            self.face([W(fs - 0.28, 0.9, 0.009), W(fs + 0.28, 0.9, 0.009), W(fs + 0.28, fl_top, 0.009), W(fs - 0.28, fl_top, 0.009)], MAT_GRIME,
                      [(0.2, 0.3), (0.8, 0.3), (0.8, 0.7), (0.2, 0.7)], SOOT, out, 1.0)
            for y in [0.0] + floors:
                self.decal(W, fs - 0.6, fs + 0.6, y + 0.1, y + 1.5, SOOT, out, d=0.010)
            # a patch of wallpaper in most rooms, each room its own paper (the lead's review, 2026-09-26: one clean
            # patch reads as a room; three scraps a room read as noise)
            for y in [0.0] + floors:
                paper = r.choice(WALLPAPER)
                for _ in range(1 if r.random() < 0.7 else 0):
                    w_ = r.uniform(0.9, 1.8)
                    h_ = r.uniform(1.0, 1.7)
                    c = r.uniform(s0 + 0.4 + w_ / 2, max(s0 + 0.5 + w_ / 2, s1 - 0.4 - w_ / 2))
                    y_ = y + r.uniform(0.6, max(0.7, min(self.sh, Hg - y) - h_ - 0.3))
                    if y_ + h_ > Hg - 0.2 or abs(c - fs) < 0.3 + w_ / 2:
                        continue
                    self.tint = paper
                    self.face([W(c - w_ / 2, y_, 0.011), W(c + w_ / 2, y_, 0.011), W(c + w_ / 2, y_ + h_, 0.011), W(c - w_ / 2, y_ + h_, 0.011)],
                              MAT_GRIME, [(0.01, 0.01), (0.99, 0.01), (0.99, 0.99), (0.01, 0.99)], SCRAP, out, 1.0)
            # the iron anchors of its beams, left in the wall
            self.tint = keep_t
            self.wear = keep_w
            for y in floors:
                for s_ in (s0 + 0.7, s1 - 0.7):
                    self.anchor(W, ux, uz, out, s_, y, False)
            self.detail(False)
        self.tint, self.wear = keep_t, keep_w

    def side_wall(self, ring, street, outs, i, y0, y1, style, H):
        """Wall i of a house's ring (a -> b) that is not a street front. Where it meets the house's
        own front at a seam with a neighbour's front, it stops SEAM_SET metres behind the front up to
        the lower of the two houses: standing right on the seam, its edge lay in the fronts' plane
        and the PS1 wobble showed it through, a dotted line of lit party wall along the seam (Steve,
        2026-09-25, the Hessenatie corner). Above the neighbour it is seen, so it runs to the corner."""
        n = len(ring)
        a, b = ring[i], ring[(i + 1) % n]
        # (the churches freed) a party wall bared by a house pulled down: old brick, and the ghost of the house
        ghosts = gone_along(a, b)
        if ghosts:
            keep = self.wallmat
            self.wallmat = (1, 0)  # the old brick picture, unpainted (houseGrime.ts WALL_PICS)
            self.side_wall_(ring, street, outs, i, y0, y1, style, H)
            if y0 == 0:
                self.ghost_marks(a, b, outs[i], ghosts, y1)
            self.wallmat = keep
            return
        self.side_wall_(ring, street, outs, i, y0, y1, style, H)

    def side_wall_(self, ring, street, outs, i, y0, y1, style, H):
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
        self.ds = self.dress_of(h)  # M7 quays pass 2: its own dice
        self.klass = class_of(h)
        CLASS_N[self.klass] = CLASS_N.get(self.klass, 0) + 1
        if self.klass == "fine":
            ring_ = house_ring(h)[0]
            FINE_N.append((h.get("_i"), round(sum(p[0] for p in ring_) / len(ring_)), round(sum(p[1] for p in ring_) / len(ring_)),
                           h["seed"] % 5 < 2))
        self.wear = wear_of(h, self.klass)
        self.wallmat = wall_material(h, self.klass)
        self.ds["klass"] = self.klass
        self.ds["seed"] = h["seed"]  # (yard windows: their own dice from it)
        # (the districts pass) some fine fronts take corner pilasters in place of quoins; by the seed, the dice untouched
        self.ds["pilaster"] = self.klass == "fine" and h["seed"] % 5 < 2
        # (a house whose rooms stand in the world has no backing wall in them: its fronts get the full grid)
        self.backing = None if h.get("_i") in INWORLD else -0.4
        self.lim = h["h"] - 0.39  # no window head over this (the cornice; front gables: their eaves band, rect_house)
        self.pipe = None
        self.cur_load = None
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
        # M7 quays pass 2: the storehouse's loading doors are cut into the front (upper_front); a downpipe on
        # the front of a house with a cornice; no window head over a front gable's eaves band
        loads = []
        if store and street[0]:
            k = 4.5
            while k < W - 3:
                loads.append(k)
                k += 9.0
        if h["roof"] == "front":
            self.lim = H - 0.1
        for i in range(4):
            self.cur_load = loads if i == 0 else None
            self.pipe = {"top": H - 0.37} if (i == 0 and not cottage and h["roof"] in ("side", "flat")) else None
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
            self.quoins = (bool(street[(i - 1) % 4]), bool(street[(i + 1) % 4]))  # (a rect's corners are all outer)
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
                self.rec_yard, self.rec_wall = YARD_WINDOWS.setdefault(str(h.get("_i")), []), i  # (yard windows)
                self.wall(c[i], c[(i + 1) % 4], 0, H, style, True, outs[i], door=([back_op] if pt and i == 2 else None), kerb=False)
                self.rec = None
                self.rec_yard = None
            elif pt and i == 2:
                self.blind_way(c[2], c[3], H, style, outs[2], back_op)
            else:
                self.side_wall(c, street, outs, i, 0, H, style, H)
        self.cur_load = None
        self.pipe = None
        self.quoins = None
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
                    self.loading_door(Wf, k, y, ux, uz, outs[0], recessed=True)  # (the leaves at the back of the opening)
                    y += self.sh
                # M7 quays pass 2: a hoist loft over the column on a side roof; else the beam at the eaves
                pch = math.radians(h["pitch"])
                if not (h["roof"] == "side" and self.hoist_loft(P, s0 + k, t0, H, 0.4 * math.tan(pch), 0.4,
                                                                 (min(D / 2 * math.tan(pch), 6.5) + 0.4 * math.tan(pch)) / (D / 2 + 0.4), D)):
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
                self.chimney(cx, cz, H, top, 0.6, 0.9, ux, uz)  # (M7 quays pass 2: brick, a cap, pots)
                # (grime pass 2) soot on the slope round it
                ry = lambda s_: H + rise * (1 - abs(s_ - sm) / (W / 2))  # noqa: E731
                sa_, sb_ = max(s0 + 0.05, cs - 0.9), min(s1 - 0.05, cs + 0.9)
                if (sa_ - sm) * (sb_ - sm) > 0:
                    ta_, tb_ = ct - 0.9, min(ct + 0.9, t1 + 0.3)
                    pts = [(P(sa_, ta_)[0], ry(sa_), P(sa_, ta_)[1]), (P(sb_, ta_)[0], ry(sb_), P(sb_, ta_)[1]),
                           (P(sb_, tb_)[0], ry(sb_), P(sb_, tb_)[1]), (P(sa_, tb_)[0], ry(sa_), P(sa_, tb_)[1])]
                    self.roof_soot(pts, (0, 1, 0))
            if street[0] and not cottage and not overlapped(self.hid, c[0], c[1]):
                # M7 quays pass 2: a stone band across the front at the gable's foot
                def Wg(s, y, d=0.0):
                    x, z = P(s0 + s, t0 - d)
                    return (x, y, z)
                self.detail(True)
                self.slab(Wg, ux, uz, outs[0], 0.0, W, H - 0.08, H + 0.12, 0, 0.08, self.ds["stone"] * 0.92, under=True)
                self.detail(False)
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
            drop0 = over * math.tan(pitch)
            kslope = (rise + drop0) / (abs(tm - t0) + over)
            if street[0]:
                if not cottage:
                    # M7 quays pass 2: a moulding under the eaves (it fits under the roof's slope), and the gutter
                    # along the roof's edge (was a stone box through the eaves)
                    self.ledge(c, outs, [0 if overlapped(self.hid, c[0], c[1]) else 1, 0, 0, 0], [(H - 0.37, H - 0.25, 0.08), (H - 0.25, H - 0.17, 0.15)], shade=0.85)
                    gx, gz = P((s0 + s1) / 2, t0 - over - 0.03)
                    self.detail(True)
                    self.box(gx, H - drop0 - 0.05, gz, W, 0.12, 0.13, ux, uz, MAT_STONE, (0, 0), 0.28, bottom=True)
                    self.detail(False)
                dorm = []
                if W > 5 and rng.random() < 0.55:
                    ds = rng.uniform(s0 + 1.4, s1 - 1.4)
                    dx_, dz_ = P(ds, t0 + 1.2)
                    if not any(abs(ds - s0 - k) < 2.2 for k in loads):
                        kind = self.ds["rng"].choice(["pitched", "pitched", "flat"])
                        if self.dormer_new(P, ds, t0, H, drop0, over, kslope, D, style, kind):
                            dorm.append(ds)
                        else:
                            self.dormer(dx_, H + 0.9, dz_, ux, uz, nx, nz, style)
                # M7 quays pass 2: more dormers on a wide front, on the bays' middles
                if W >= 6 and not cottage and not store:
                    r2 = self.ds["rng"]
                    kind = r2.choice(["pitched", "pitched", "flat"])
                    nb = max(1, round(W / BAY))
                    for kb in range(nb):
                        dsb = s0 + (kb + 0.5) * W / nb
                        if len(dorm) >= 3 or r2.random() > 0.45 or any(abs(dsb - q) < 1.8 for q in dorm) or not (s0 + 1.0 < dsb < s1 - 1.0):
                            continue
                        if self.dormer_new(P, dsb, t0, H, drop0, over, kslope, D, style, kind):
                            dorm.append(dsb)
            built = set()
            for _ in range(rng.choice([1, 2])):
                cs = rng.choice([s0 + 0.5, s1 - 0.5])
                if cs in built:
                    continue  # the same end twice: one chimney, not two in one place (z-fight check)
                built.add(cs)
                cx, cz = P(cs, tm)
                self.chimney(cx, cz, H + rise * 0.5 + 0.6 - (rise + 1.2) / 2, H + rise + 1.2, 0.7, 0.7, ux, uz)
                # (grime pass 2) soot down both slopes from the ridge round it
                sa_, sb_ = max(s0 + 0.02, cs - 0.8), min(s1 - 0.02, cs + 0.8)
                for sg in (-1, 1):
                    te_ = tm + sg * min(1.6, abs(tm - t0) - 0.2)
                    yr_ = H + rise - (rise + over * math.tan(pitch)) * abs(te_ - tm) / (abs(tm - t0) + over)
                    self.roof_soot([(P(sa_, tm)[0], H + rise, P(sa_, tm)[1]), (P(sb_, tm)[0], H + rise, P(sb_, tm)[1]),
                                    (P(sb_, te_)[0], yr_, P(sb_, te_)[1]), (P(sa_, te_)[0], yr_, P(sa_, te_)[1])], (0, 1, 0))
        else:
            self.flat_top([c[0], c[1], c[2], c[3]], H, street, outs, style)
            self.cornice_top([c[0], c[1], c[2], c[3]], outs, street, H, parapet=True)

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
        a0, a1 = P(s0, t), P(s1, t)
        if (front and street and self.ds is not None and not h.get("alley") and not overlapped(self.hid, a0, a1)):
            # M7 quays pass 2 (second pass): its windows cut in (gable_front); ambient.ts lights those
            GABLE_WINDOWS[str(h["_i"])] = self.gable_front(h, P, s0, s1, tt, H, pts, style, out)
        else:
            self.ngon(world, uvs, cell, out)
        # the back of the gable, so the steps do not vanish when seen from the roof side
        back = [(p[0] + h["n"][0] * 0.25 * (1 if front else -1), p[1], p[2] + h["n"][1] * 0.25 * (1 if front else -1)) for p in world]
        self.ngon(back, uvs, (PART_COL["blind"], STYLE_ROW[style]), (-out[0], 0, -out[2]))
        if kind == "step" and front and self.ds is not None and self.ds.get("klass") == "fine":
            # (the districts pass) a gilded finial on the top step of a fine house's gable
            fx_, fz_ = P(sm, tt + 0.12)
            ytop = H + rise + 1.0 + 0.16
            keep = self.tint
            self.tint = (1.0, 0.72, 0.22)
            self.detail(True)
            self.box(fx_, ytop + 0.12, fz_, 0.16, 0.24, 0.16, h["u"][0], h["u"][1], MAT_STONE, (0, 0), 1.25, bottom=True)
            self.rod((fx_, ytop + 0.24, fz_), (fx_, ytop + 0.8, fz_), 0.035, 1.3)
            self.box(fx_, ytop + 0.56, fz_, 0.12, 0.12, 0.12, h["u"][0], h["u"][1], MAT_STONE, (0, 0), 1.3, bottom=True)
            self.detail(False)
            self.tint = keep
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
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, self.wear)
            loop[self.mcol].uv = self.matcol()

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
        # (the houses' pass, 2026-09-26, Steve: "not all houses are high quality": the cottages' windows were painted
        # flat on the wall. Now the glass is set in: the sash (an atlas cell of its own, the house's dice) COT_R back
        # in a reveal of the wall's own picture, a stone lintel over it, the sill under it; the painted shutters stay
        # flat on the wall beside it. The opening's box is the painted window's, as recorded above: the bills keep
        # clear of it, and no lit pane is drawn on the cottages (ambient.ts))
        sash = self.ds["sash"] if self.ds else SASH[0]
        for wn in wins:
            px0, px1 = pxs(wn["sh"])
            glass = ((wn["s1"] - wn["s0"]) * 28 / (px1 - px0)) / 2  # half the window without its shutters
            sm = (wn["s0"] + wn["s1"]) / 2
            g0, g1 = sm - glass, sm + glass
            # the painted shutters (or the painted frame's edge) on the wall, left and right of the glass
            for sa, sb, pa, pb in ((wn["s0"], g0, px0, 32 - 14), (g1, wn["s1"], 32 + 14, px1)):
                if sb - sa > 0.005:
                    self.face([W(sa, wn["y0"]), W(sb, wn["y0"]), W(sb, wn["y1"]), W(sa, wn["y1"])], MAT_FACADE,
                              [(pa / 64.0, v0), (pb / 64.0, v0), (pb / 64.0, v1), (pa / 64.0, v1)], (PART_COL["upper"], row), f)
            self.dress_open(W, ux, uz, f, {"s0": g0, "s1": g1, "y0": wn["y0"], "y1": wn["y1"], "kind": "win"}, COT_R, sash)
            self.slab(W, ux, uz, f, g0 - 0.04, g1 + 0.04, wn["y0"] - 0.05, wn["y0"] + 0.03, 0, 0.07, stone * 0.9, under=wn["y0"] > 1.7)
            # the lintel: a plain stone over the glass
            self.slab(W, ux, uz, f, g0 - 0.06, g1 + 0.06, wn["y1"], wn["y1"] + (0.13 if shut else 0.11), 0, 0.05, stone, under=True, ends=False)
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

    def cornice_top(self, ring, outs, street, H, parapet):
        """M7 quays pass 2: the cornice of a hipped or a flat roof along the street walls: three steps out
        (the top at the eaves, H), mitred at the corners; the gutter on its front edge (near-only); on a flat
        roof the parapet's coping too."""
        # (not along a wall another plan house overlaps: two cornices in one place fight)
        n = len(ring)
        flags = [1 if s and not overlapped(self.hid, ring[i], ring[(i + 1) % n]) else 0 for i, s in enumerate(street)]
        self.ledge(ring, outs, flags, [(H - 0.37, H - 0.25, 0.1), (H - 0.25, H - 0.12, 0.2), (H - 0.12, H, 0.32)], shade=0.85)
        self.detail(True)
        if parapet:
            self.ledge(ring, outs, flags, [(H + 0.6, H + 0.68, 0.06)], inner=-0.22, back=True, shade=0.9)
        else:
            self.ledge(ring, outs, flags, [(H, H + 0.1, 0.36)], inner=0.24, under_from=0.32, back=True, shade=0.28)
        self.detail(False)

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
            self.pipe = None
            if not h["street"][i]:
                if yard[i]:
                    self.rec_yard, self.rec_wall = YARD_WINDOWS.setdefault(str(h.get("_i")), []), i  # (yard windows)
                    self.wall(a, b, 0, H, h["style"], True, outs[i], kerb=False)  # on a back yard (alleys.py): windows, no door
                    self.rec_yard = None
                else:
                    self.side_wall(fp, h["street"], outs, i, 0, H, h["style"], H)
                continue
            ops = None
            iw = INWORLD.get(h.get("_i"))
            self.pipe = {"top": H - 0.37} if i == door_i else None

            def outer(k):  # is the ring's corner k (between walls k - 1 and k) an outer corner?
                p = fp[k]
                o1, o2 = outs[(k - 1) % n], outs[k]
                x, z = p[0] + (o1[0] + o2[0]) * 0.1, p[1] + (o1[2] + o2[2]) * 0.1
                inside = False
                for m in range(n):
                    (xi, zi), (xj, zj) = fp[m], fp[(m - 1) % n]
                    if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
                        inside = not inside
                return not inside
            self.quoins = (bool(h["street"][(i - 1) % n]) and outer(i), bool(h["street"][(i + 1) % n]) and outer((i + 1) % n))
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
        self.pipe = None
        self.quoins = None
        # a cornice under the eaves on the street sides (M7 quays pass 2: moulded, mitred at the corners, a gutter)
        self.cornice_top(fp, outs, h["street"], H, parapet=False)

    def back(self, b):
        fp = b["fp"]
        H = b["h"]
        self.tint = (0.8, 0.78, 0.76)
        self.wear = 0.7
        self.ds = None
        self.pipe = None
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
                loop[self.col] = (0.7, 0.66, 0.64, 0.6)
                loop[self.mcol].uv = (1.0, 0.0)
        except ValueError:
            pass

    # ------------------------------------------------------------ bridges

    def bridge(self, br):
        """A bridge over a canal or the lock: its long side spans the water.
        stone: an arch with parapets; swing: a timber deck with iron railings."""
        self.wear = 0.6
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
            loop[self.col] = (shade, shade, shade, 0.6)
            loop[self.mcol].uv = (1.0, 0.0)

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
        self.detail(False)
        out = None
        for nm, bm in ((name, self.bm), (name + "_d", self.dbm)):
            if not len(bm.faces):
                bm.free()
                continue
            me = bpy.data.meshes.new(nm)
            bm.to_mesh(me)
            bm.free()
            for m in mats:
                me.materials.append(m)
            ob = bpy.data.objects.new(nm, me)
            bpy.context.scene.collection.objects.link(ob)
            out = out or ob
        return out


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


WALLS = {}  # every house wall by 2 m cell: (a, b, house id), for overlapped()


def index_walls(houses):
    for h in houses:
        ring, _ = house_ring(h)
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            cells = {(math.floor((a[0] + (b[0] - a[0]) * q) / 2), math.floor((a[1] + (b[1] - a[1]) * q) / 2)) for q in (0, 0.25, 0.5, 0.75, 1)}
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            for k in range(int(L / 1.5) + 1):
                q = k * 1.5 / L if L else 0
                cells.add((math.floor((a[0] + (b[0] - a[0]) * q) / 2), math.floor((a[1] + (b[1] - a[1]) * q) / 2)))
            for c in cells:
                WALLS.setdefault(c, []).append((tuple(a), tuple(b), id(h)))


# the churches freed: where the lanterns by the church doors hang, on the wall's face: (x, z) of the plate, along the
# wall, out of it. St Paul's west door (face x 140.02, the door z 266) and north transept door (face z 247.14, x 94.97);
# St James' tower door (face x -56.27, z 305) and south transept door (face z 332.22, x -106.47)
CHURCH_LANTERNS = [((140.02, 268.3), (0.0, 1.0), (1.0, 0.0)), ((97.27, 247.14), (1.0, 0.0), (0.0, -1.0)),
                   ((-56.27, 307.5), (0.0, 1.0), (1.0, 0.0)), ((-104.0, 332.22), (1.0, 0.0), (0.0, 1.0))]
GONE_EDGES = []  # the churches freed: the walls of the houses pulled down, [(a, b, house, rise)]


def index_gone(houses):
    """The walls of the houses marked gone, each with the rise of its roof over its eaves where the roof runs
    across that wall (a gable end), else 0."""
    for h in houses:
        if not h.get("gone"):
            continue
        ring, _ = house_ring(h)
        ridge = None
        if h["rect"] and h.get("roof") in ("side", "front"):
            ridge = h["u"] if h["roof"] == "side" else h["n"]
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            rise = 0.0
            if ridge is not None and L > 0.5:
                ex, ez = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                if abs(ex * ridge[0] + ez * ridge[1]) < 0.3:  # the ridge crosses this wall: a gable end
                    rise = math.tan(math.radians(h.get("pitch", 45.0))) * L / 2
            GONE_EDGES.append((tuple(a), tuple(b), h, rise))


def gone_along(a, b):
    """Stretches of the wall a -> b that a house pulled down stood against: [(s0, s1, house, rise)], s along a -> b."""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 1.0 or not GONE_EDGES:
        return []
    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    out = []
    for p, q, h, rise in GONE_EDGES:
        dp = (p[0] - a[0]) * uz - (p[1] - a[1]) * ux
        dq = (q[0] - a[0]) * uz - (q[1] - a[1]) * ux
        if abs(dp) > 0.15 or abs(dq) > 0.15:
            continue
        sp = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz
        sq = (q[0] - a[0]) * ux + (q[1] - a[1]) * uz
        s0, s1 = max(0.0, min(sp, sq)), min(L, max(sp, sq))
        if s1 - s0 > 1.0:
            # (the gable's rise, scaled to the part of the wall they share)
            out.append((s0 + 0.05, s1 - 0.05, h, rise * (s1 - s0) / max(0.1, abs(sq - sp))))
    return out


def overlapped(hid, a, b):
    """M7 quays pass 2: does another house's wall lie along this one (the same line, 0.1 m or more of it)?"""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 0.1:
        return False
    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    seen = set()
    for k in range(int(L / 1.5) + 2):
        q = min(1.0, k * 1.5 / L)
        c = (math.floor((a[0] + (b[0] - a[0]) * q) / 2), math.floor((a[1] + (b[1] - a[1]) * q) / 2))
        for dc in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            for p, r, oid in WALLS.get((c[0] + dc[0], c[1] + dc[1]), ()):
                if oid == hid or (p, r) in seen:
                    continue
                seen.add((p, r))
                # (the other wall along this one where their lengths overlap, within 5 cm of its line)
                sp, sr = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz, (r[0] - a[0]) * ux + (r[1] - a[1]) * uz
                dp, dr = (p[0] - a[0]) * uz - (p[1] - a[1]) * ux, (r[0] - a[0]) * uz - (r[1] - a[1]) * ux
                lo, hi = max(min(sp, sr), 0.0), min(max(sp, sr), L)
                if hi - lo <= 0.3 or abs(sr - sp) < 1e-9:
                    continue
                if all(abs(dp + (dr - dp) * (s - sp) / (sr - sp)) <= 0.12 for s in (lo, hi)):
                    return True
    return False


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


# M7 quays pass 2: which fronts get the whole dress (sills, heads, shutters, bands, anchors, pipes): those that
# look onto a working quay, a paved square (the Vismarkt, the Grote Markt ...) or the water (the canals). Filled
# in main() from city.json (its ground zones "quay" and "flags", its water outlines).
PRIME = {"tris": [], "walk": None, "doors": []}
PRIME_N = {}  # street walls with the whole dress (True) and without


# The districts pass (Steve, 2026-09-26: "more varied textures and especially different in different parts. The
# higher class houses at Grote Markt are too grungy; they were nice in the time"; "not only one red brick
# texture but more kinds"). Each house a class, from where it stands (class_of), its wear and its wall picture
# from the class (wear_of, wall_material). The pictures, a layer each of houseGrime.ts's picture array:
CLASS_N = {}  # houses by class, printed
FINE_N = []  # the fine fronts (index in city_build.json, x, z, pilasters), printed
# (client/public/textures/wall_<name>.jpg; houseGrime.ts WALL_PICS in this order)
WALL_LAYERS = ["brick_fine", "brick", "brick_clinker", "speklagen", "brick_yellow", "brick_yellow_old", "brick_white",
               "plaster_smooth", "plaster_rough", "plaster", "render", "ashlar_sand", "ashlar_blue"]
PAINTED = {6, 7, 8}  # the pictures the house's paint colours (the others: a small tint only)
# the fine squares and their reach (city.json places): the Grote Markt with the town hall and the guild houses, the
# Handschoenmarkt and the cathedral's square, the Conscienceplein, the Stadspark's fronts
FINE_PLACES = [(-254, 94, 48), (-262, 132, 32), (-262, 175, 50), (-116, 160, 30), (-300, 318, 45)]
BY_CLASS = {
    # brick fronts / plastered fronts: the pictures to pick from (a few twice: more of them)
    "fine": ([0, 0, 3, 3, 11, 12, 4], [7, 7, 7, 11, 12, 8]),
    "good": ([0, 3, 4, 2, 0], [7, 7, 8, 11]),
    "merchant": ([0, 1, 3, 4, 2], [7, 8, 7]),
    "middle": ([1, 0, 2, 4, 5, 1], [7, 8, 9, 6]),
    "poor": ([1, 5, 6, 2, 1], [9, 10, 6, 8]),
    "alley": ([1, 5, 6], [9, 10, 6]),
    "store": ([1, 2, 0, 4], [10, 9]),
}
# the paints, by index (houseGrime.ts PAINT in the same order): 0 none; 1-6 fresh cream, ochre, pale grey, pale green,
# pale pink, white; 7-9 greys; 10-13 old paint; 14-19 a slight tint for the unpainted pictures, so no two match
PAINTS = {"fine": [1, 2, 3, 4, 5, 6], "grey": [7, 8, 9], "worn": [10, 11, 12, 13], "tint": [0, 14, 15, 16, 17, 18, 19]}
WEAR = {"fine": (0.05, 0.25), "good": (0.2, 0.4), "merchant": (0.3, 0.5), "middle": (0.45, 0.72), "poor": (0.75, 1.0),
        "alley": (0.9, 1.0), "store": (0.55, 0.8)}


def street_width(h):
    """How wide the street or square before the house's widest-looking front is: rays over the walk map from
    its street walls to the next house (40 m at most)."""
    wk = PRIME["walk"]
    if wk is None:
        return 10.0
    ring, outs = house_ring(h)
    n = len(ring)

    def walk(x, z):
        c, r = int((z - wk["z0"]) / wk["res"]), int((x - wk["x0"]) / wk["res"])
        if not (0 <= c < wk["iw"] and 0 <= r < wk["ih"]):
            return None
        return wk["px"][((wk["ih"] - 1 - r) * wk["iw"] + c) * 4] > 0.5
    best = 0.0
    for i in range(n):
        if not h["street"][i]:
            continue
        a, b = ring[i], ring[(i + 1) % n]
        ds = []
        for q in (0.3, 0.5, 0.7):
            mx, mz = a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q
            d, run = 1.0, 0.0
            while d < 40.0:
                w = walk(mx + outs[i][0] * d, mz + outs[i][2] * d)
                if w is None:
                    break
                run = run + 0.5 if w else 0.0
                if run > 1.6:
                    d -= run
                    break
                d += 0.5
            ds.append(d)
        best = max(best, sorted(ds)[1])
    return best


def class_of(h):
    """fine, good, merchant, middle, poor, alley or store: from where the house stands and what it looks onto."""
    if h.get("alley"):
        return "alley"
    if h.get("store"):
        return "store"
    ring, outs = house_ring(h)
    n = len(ring)
    cx, cz = sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
    wide = street_width(h)
    near_fine = any(math.hypot(cx - x, cz - z) < r for x, z, r in FINE_PLACES)
    on_open = any(h["street"][i] and prime_front(ring[i], ring[(i + 1) % n], outs[i]) for i in range(n))
    if near_fine and (on_open or wide >= 12):
        return "fine"
    if (near_fine and wide >= 8) or wide >= 22:
        return "good"
    if on_open:
        return "merchant"
    if wide < 6 and not near_fine:
        return "poor"
    return "middle"


def wall_material(h, klass):
    """The house's wall picture and paint, by its own dice from its class's set."""
    r = random.Random(h["seed"] * 41 + 7)
    row = STYLE_ROW[h["style"]]
    bricks, plasters = BY_CLASS[klass]
    if row in (1, 2):
        layer = r.choice(plasters)
    else:
        layer = r.choice(bricks)
        if row == 3 and layer in (0, 4) and r.random() < 0.6:
            layer = 2  # (the dark brick style: the dark clinker more often)
    if layer in PAINTED:
        pal = PAINTS["grey"] if row == 2 else PAINTS["fine"] if klass in ("fine", "good", "merchant") else PAINTS["worn"]
    else:
        pal = PAINTS["tint"]
    return layer, r.choice(pal)


def wear_of(h, klass=None):
    """M7 the grime pass (Steve: "make sure it is not too clean, more like it was back then"): how worn a house
    is, by its own dice: the alley cottages worst; a house on a back street more than one on a quay or square;
    one in eight kept well."""
    r = random.Random(h["seed"] * 29 + 11)
    # (the districts pass: by the house's class; grime pass 2's rule, one in fifteen decent, still inside a class)
    lo, hi = WEAR[klass or class_of(h)]
    w = lo + (hi - lo) * r.random()
    if r.random() < 1 / 15 and klass in ("middle", "poor"):
        w = max(0.3, w - 0.3)
    return w


def prime_front(a, b, f):
    """Does the street wall a -> b (outward f) look onto a quay, a square or the water? Rays out of it over
    the walk map (city.json "walk"): one reaches the water, or the quay or square paving, before a house."""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    wk = PRIME["walk"]
    if L < 0.05 or wk is None:
        return False
    fx, fz = f[0], f[2]

    def in_tri(x, z, tr):
        ax, az, bx, bz, cx, cz = tr
        d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz)
        d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz)
        d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

    def walk(x, z):
        c, r = int((z - wk["z0"]) / wk["res"]), int((x - wk["x0"]) / wk["res"])
        if not (0 <= c < wk["iw"] and 0 <= r < wk["ih"]):
            return None
        k = ((wk["ih"] - 1 - r) * wk["iw"] + c) * 4
        return wk["px"][k] > 0.5, wk["px"][k + 1] > 0.5  # (wall, water)
    for q in (0.25, 0.5, 0.75):
        mx, mz = a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q
        d, run = 1.0, 0.0
        while d <= 45.0:
            x, z = mx + fx * d, mz + fz * d
            w = walk(x, z)
            if w is None:
                break
            run = run + 0.5 if w[0] else 0.0
            if run > 1.6:  # (a house; a tree, a lamp or a bollard in the way does not count)
                break
            if not w[0] and (w[1] or any(in_tri(x, z, tr) for tr in PRIME["tris"])):
                return True
            d += 0.5
    return False


# grime pass 2: where soot goes up the fronts: the bakers, the smiths' and wheelwright's forges (server/src/town/places.ts),
# the taverns in the world (inworld_build.json, their doors)
SOOTY = [(10, 72), (-200, 40), (-160.8, 98.7), (-27.7, 66.1)]
LAMPS = []  # the lanterns by the doors: [x, y, z of the glass, outward x, z], for ambient.ts
GABLE_WINDOWS = {}  # M7 quays pass 2: by house index, the windows cut into its front gable (shared/city_gable_windows.json)
ID_ALLEY = {}  # id(house) -> a cottage of the back alleys
# M7 back alleys: where this builder put openings the plan does not say, for the game's lit windows and street
# life (carried in city.glb, node "city_openings"): by house index; walls numbered as the rect ring (0 front,
# 1 right side, 2 back, 3 left side), s in metres from the wall's first corner
OPENINGS = {"poorts": {}, "plain_ground": {}, "cottages": {}}
YARD_N = {}  # (yard windows) the back walls on the yards and their windows, printed
YARD_WINDOWS = {}  # (yard windows) by house index, the windows cut into its backs on the yards (shared/city_yard_windows.json)
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
    # M7 quays pass 2: the fronts on the quays, close and from across the quay (the game's shots b3_*)
    for name, eye, look, lens in (("quay_rijnkaai", (7, 1.7, 38.5), (12, 4.5, 44), 16), ("quay_rijnkaai_close", (14, 1.7, 42), (17, 4.5, 46.5), 16),
                                  ("quay_rijnkaai_wide", (-12, 2.2, 8), (28, 7, 44), 22), ("quay_entrepot", (128, 1.8, 46), (137, 7, 40), 14),
                                  ("quay_entrepot_top", (140, 3, 47), (142, 11, 40), 16), ("quay_vismarkt", (-110, 1.7, 38), (-116, 5, 50), 16),
                                  ("quay_werf", (-262, 1.7, 7), (-266, 5, 14), 16), ("quay_werf_gables", (-250, 2, -1), (-262, 10, 14), 18),
                                  ("quay_rijnkaai_gables", (-30, 2, 30), (-38, 11, 46), 18), ("quay_corner", (-64, 1.8, 72), (-60, 6, 75.3), 16)):
        views.append((name, eye, look, lens))
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
            material("wood", (0.35, 0.28, 0.2)), material("leaves", (0.6, 0.45, 0.2)), material("grime", (0.1, 0.09, 0.08))]
    chunks = {}

    def chunk_of(pts):
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        key = (math.floor(cx / CHUNK), math.floor(cz / CHUNK))
        if key not in chunks:
            chunks[key] = Builder(data["ground_h"], data["storey_h"])
        return chunks[key]

    city = json.load(open(os.path.join(ROOT, "shared", "city.json")))
    PRIME["tris"] = [tuple(tr) for k in ("quay", "flags") for tr in city["ground"].get(k, [])]
    PRIME["doors"] = list(city.get("doors", {}).values())
    wk = dict(city["walk"])
    img = bpy.data.images.load(os.path.join(ROOT, "client", "public", wk["file"].lstrip("/")))
    wk["iw"], wk["ih"] = img.size
    px = array.array("f", [0.0]) * (wk["iw"] * wk["ih"] * 4)
    img.pixels.foreach_get(px)
    wk["px"] = px
    PRIME["walk"] = wk
    # the churches freed (2026-09-26): a house marked "gone" in city_build.json is not built (its entry stays, so
    # every index in the other files still points at the same house)
    live = [h for h in data["houses"] if not h.get("gone")]
    index_fronts(live)
    index_walls(live)
    index_gone(data["houses"])
    for e in INWORLD.values():
        if e.get("kind") == "tavern":
            ring, _ = house_ring(data["houses"][e["house"]])
            SOOTY.append(((ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2))  # (the middle of its front)
    for h in data["houses"]:
        ID_ALLEY[id(h)] = bool(h.get("alley"))
    for i, h in enumerate(data["houses"]):
        h["_i"] = i
    for h in live:
        rng = random.Random(h["seed"])
        chunk_of(h["fp"]).house(h, rng)
    for b in data["backs"]:
        chunk_of(b["fp"]).back(b)
    # the churches freed (2026-09-26): a lantern on a bracket beside the doors of St Paul's and St James' on their
    # new squares (build_churches.py: the wall's face and the door's middle), lit from dusk as the door lanterns are
    for (px, pz), (ux, uz), (fx, fz) in CHURCH_LANTERNS:
        bld = chunk_of([(px, pz)])
        bld.tint, bld.wear, bld.wallmat = (1.0, 1.0, 1.0), 0.5, (1, 0)

        def Wc(s_, y, d=0.0, px=px, pz=pz, ux=ux, uz=uz, fx=fx, fz=fz):
            return (px + ux * s_ + fx * d, y, pz + uz * s_ + fz * d)
        bld.detail(True)
        bld.lantern(Wc, ux, uz, (fx, 0, fz), 0.0, dy=0.9)
        bld.detail(False)
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
    # the windows cut into the front gables, for the lit panes at night (client/src/world/ambient.ts)
    if "--no-export" not in argv:
        with open(os.path.join(ROOT, "shared", "city_gable_windows.json"), "w", encoding="utf-8") as fh:
            json.dump({"about": "tools/blender/build_city.py gable_front: by house index, the windows cut into its front gable: "
                                "[s_mid from the front's first corner, y0, y1, width, small]; lamps: the lanterns by the doors "
                                "[x, y, z of the glass, outward x, z]", "houses": GABLE_WINDOWS, "lamps": LAMPS}, fh, separators=(",", ":"))
        # (yard windows) the windows cut into the backs on the yards that can be lit (world/yardWindows.ts)
        with open(os.path.join(ROOT, "shared", "city_yard_windows.json"), "w", encoding="utf-8") as fh:
            json.dump({"about": "tools/blender/build_city.py yard_run: by house index, the glass of the windows cut into its back "
                                "walls on the yards and courts: [wall, s_mid, width, y0, y1], and a sixth 1 when it is boarded up; wall "
                                "the index in the house's ring (a rect house 0 front, 1 right, 2 back, 3 left; else the footprint's edge "
                                "from fp[wall]), s from that wall's first corner",
                       "houses": {k: v for k, v in YARD_WINDOWS.items() if v}}, fh, separators=(",", ":"))
    node = bpy.data.objects.new("city_openings", None)
    node["openings"] = json.dumps(dict(OPENINGS, about="by house index: poorts {s: [s0, s1] along the front from its first corner, h, kind}; "
                                       "plain_ground [[wall, s0, s1]]: ground bays built as plain wall (no shop window); "
                                       "cottages [[wall, s_mid, width, y0, y1]]: the only windows of an alley cottage's walls "
                                       "(walls: 0 front, 1 right, 2 back, 3 left, s from the wall's first corner)"), separators=(",", ":"))
    print(f"[build_city] yard windows: {dict(sorted(YARD_N.items()))}")
    bpy.context.scene.collection.objects.link(node)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    faces = sum(len(o.data.polygons) for o in meshes)
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    dtris = sum(len(p.vertices) - 2 for o in meshes if o.name.endswith("_d") for p in o.data.polygons)
    print(f"[build_city] houses by class: {dict(sorted(CLASS_N.items()))}")
    print(f"[build_city] fine fronts: {FINE_N}")
    print(f"[build_city] near-only detail: {dtris} triangles of {tris}; street walls with the whole dress: {PRIME_N.get(True, 0)} of {PRIME_N.get(True, 0) + PRIME_N.get(False, 0)}, left flat where plan houses overlap: {PRIME_N.get("overlapped", 0)}")
    if "--no-export" not in argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        kwargs = dict(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                      export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                      export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
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

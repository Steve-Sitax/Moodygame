"""Het Steen in detail (Steve, 2026-09-26: "do the steen again in higher quality", "do not forget bump mapping").

    blender -b --factory-startup -P tools/blender/build_steen.py

Writes client/public/models/steen.glb. The game loads it in client/src/world/steenModel.ts (started from
world/steenlife.ts) and hides the old Steen of landmarks.glb (build_landmarks.py steen5, object landmark_steen).

The layout is steen5's, number for number: the footprint (x -194..-160, z -39.5..-23), the Steenpoort's
passage and its landing, the museum door on the courtyard (a basket arch at x -183.5, the hall's leaves
hang in it: world/landmarkHalls.ts buildSteen), the prison range's and the gatehouse's windows where the hall
has its own (shared/steenPlan.ts SHELL.windows), the courtyard, the ramp (shared/city.json decor.steen_ramp,
walked by world/steenramp.ts) and the calvary. Where the hall stands inside the shell (the gatehouse and the
prison range) nothing reaches more than 0.18 m behind the lane face.

What is new is the fabric and the depth:
- The walls carry pictures (Codex, assets/ATTRIBUTION.md) in world metres: the rough blue-grey Tournai stone of
  the 13th century below, the yellow-brown sandstone of Charles V's rebuilding (about 1520) above, bluestone for
  every trim, slate on the roofs (the restorers' Steen, 1887-90), old brick for the chimneys. Each picture has a height map made
  from it (tools/textures/steen_maps.py); the game bumps the light with it.
- Openings are real: the wall is cut round them, the reveals go into the wall, the frames, mullions, transoms,
  sills and iron bars stand in them, the glass and the dark slits lie at their back.
- Machicolations on stepped corbels with slots between them, merlons with slits and copings, stepped gables
  with a coping slab on every step and kneelers, dormers with their own windows and roofs, chimneys with caps
  and pots, eaves with gutters and downpipes, iron wall anchors, the towers' bell-cast conical roofs with
  finials, and the base battered out into the ground all round.

The frame is steen5's: u = world x - cx (north along the river), v = world z - cz (inland), y up.
Materials (the game dresses them by name): steen_tournai, steen_sand, steen_blue, steen_slate, steen_brick (pictures in client/public/textures, tiled in world metres), steen_metal (lead, iron, zinc, the
gilt vane: its colour in the vertex colour), steen_glass (leaded quarries, painted here, packed), steen_atlas
(the door planks, the dark of the slits, the museum's painted name and board, packed), steen_carve (the Semini
relief and the oriel's carved panels, one Codex picture sheet, cells below).
"""

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
OUT = os.path.join(ROOT, "client", "public", "models", "steen.glb")
FEATURES = os.path.join(ROOT, "client", "public", "models", "steen_features.json")

MATS = ["steen_tournai", "steen_sand", "steen_blue", "steen_slate", "steen_brick", "steen_metal", "steen_glass", "steen_atlas", "steen_carve", "steen_glass_lit"]
TOUR, SAND, BLUE, SLATE, BRICK, METAL, GLASS, ATLAS, CARVE, GLASS_LIT = range(10)
# metres per repeat of each picture (the game's steenModel.ts loads the pictures; the uv here is world metres / tile)
TILE = {TOUR: 3.0, SAND: 3.0, BLUE: 1.5, SLATE: 1.5, BRICK: 1.0, METAL: 1.0, GLASS: 0.64, GLASS_LIT: 0.64}
FLAT = {METAL, ATLAS, CARVE, GLASS, GLASS_LIT}  # no per-face jitter, no height shading
# Issue #10 (interiors are real, docs/building-with-interior.md): the windows over the museum's rooms (the gatehouse's
# two small ones, the prison range's three on the courtyard) and its door are real openings: cut through, their bars
# and mullions here, their glass the room's (world/landmarkHalls.ts buildSteen). Each is written twice: an empty
# "opening_<id>" in the glb and a row of shared/steenShell.ts (world frame). Their old panes go to a mesh of their own
# ("steen_lit_glass", steen_glass_lit) that the game never draws: world/landmarkWindows.ts lights a copy at night.
SHELL_TS = os.path.join(ROOT, "shared", "steenShell.ts")
OPENINGS = []
LIT = [None]

# colours in the vertex colour for the metal
LEAD, IRON, ZINC, GILT, TERRA = (0.42, 0.44, 0.46), (0.16, 0.16, 0.17), (0.55, 0.57, 0.58), (1.6, 1.15, 0.45), (0.95, 0.55, 0.4)

# the atlas (256 px, packed): cells x, y, w, h in pixels from the top left
SAT = 256
ACELL = {
    "void": (0, 0, 32, 32),
    "lampglass": (0, 32, 32, 32),
    "door": (32, 0, 64, 96),
    "band": (96, 0, 128, 24),
    "board": (96, 24, 128, 64),
    "shutter": (0, 96, 64, 64),
}
# the carvings sheet (tools/textures/steen_maps.py composes it: 1024 x 1024), cells x, y, w, h from the top left
CAR = 1024
CCELL = {
    "semini": (0, 0, 384, 640),
    "arms": (384, 0, 640, 480),
    "saltire": (384, 480, 640, 480),
    "saltire_n": (0, 640, 272, 384),  # the same, narrower, for the oriel's side panels
}


# ------------------------------------------------------------------ 2D helpers (s along a wall, y up)

def clip(poly, axis, val, ge):
    """Sutherland-Hodgman: keep the part of a polygon with p[axis] >= val (ge) or <= val."""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ia = a[axis] >= val - 1e-9 if ge else a[axis] <= val + 1e-9
        ib = b[axis] >= val - 1e-9 if ge else b[axis] <= val + 1e-9
        if ia:
            out.append(a)
        if ia != ib:
            t = (val - a[axis]) / (b[axis] - a[axis])
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    clean = []
    for p in out:
        if not clean or abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    return clean


def area2(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def centre(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


def ngon(cu, cv, r, n, rot=0.0):
    return [(cu + r * math.cos(rot + 2 * math.pi * i / n), cv + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


# ------------------------------------------------------------------ the mesh

class SM:
    """One bmesh for the whole Steen; faces carry a material slot and a vertex colour; uv is set at the end in
    world metres (see finish) unless a face has its own (atlas cells, the carvings)."""

    def __init__(self, cx, cz):
        self.cx, self.cz = cx, cz
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.fixed = set()
        self.rng = random.Random(1520)
        self.jit = 0.05
        self.tint = (1.0, 1.0, 1.0)
        self.doors = []
        self.sec = ""  # the part being built (for the overlap check, STEEN_DUMP)
        self.secs = []
        # what must stand clear of everything else (steenModel.ts check()): doors, gates, windows, stairs, roof parts,
        # in world metres; a roof part keeps its own triangles
        self.features = []
        self.part = None

    def W(self, u, v, y):
        return [round(self.cx + u, 3), round(y, 3), round(self.cz + v, 3)]

    def feature(self, kind, name, pts, **kw):
        """A feature by the local points it spans (its box in world metres)."""
        ws = [self.W(*q) for q in pts]
        box = [min(q[i] for q in ws) for i in range(3)] + [max(q[i] for q in ws) for i in range(3)]
        f = {"k": kind, "n": name, "box": box}
        f.update(kw)
        self.features.append(f)
        return f

    def begin_part(self, name):
        self.part = {"k": "roof", "n": name, "tris": []}

    def end_part(self):
        f, self.part = self.part, None
        if f and f["tris"]:
            xs = [f["tris"][i] for i in range(0, len(f["tris"]), 3)]
            ys = [f["tris"][i] for i in range(1, len(f["tris"]), 3)]
            zs = [f["tris"][i] for i in range(2, len(f["tris"]), 3)]
            f["box"] = [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3), round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]
            self.features.append(f)

    def V(self, u, v, y):
        return Vector((self.cx + u, -(self.cz + v), y))

    def poly(self, pts, mat, shade=1.0, out=None, uvs=None, col=None):
        """pts in local (u, v, y); out a local direction (du, dv, dy) the face should look along."""
        if len(pts) < 3:
            return None
        vs = [self.bm.verts.new(self.V(*p)) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            for v_ in vs:
                self.bm.verts.remove(v_)
            return None
        f.material_index = mat
        self.secs.append((f, self.sec))
        if self.part is not None:  # a roof part: its triangles (a fan), world metres
            ws = [self.W(*q) for q in pts]
            for i in range(1, len(ws) - 1):
                for q in (ws[0], ws[i], ws[i + 1]):
                    self.part["tris"].extend(q)
        if col is not None:
            c = (col[0] * shade, col[1] * shade, col[2] * shade, 1.0)
        else:
            s = shade if mat in FLAT else shade * (1 + self.rng.uniform(-self.jit, self.jit))
            c = (s * self.tint[0], s * self.tint[1], s * self.tint[2], 1.0)
        for lp in f.loops:
            lp[self.col] = c
        if out is not None:
            du, dv, dy = out
            f.normal_update()
            if f.normal.dot(Vector((du, -dv, dy))) < 0:
                f.normal_flip()
        if uvs is not None:
            by = {v_: uv for v_, uv in zip(vs, uvs)}
            for lp in f.loops:
                lp[self.uvl].uv = by[lp.vert]
            self.fixed.add(f)
        return f

    def quad(self, a, b, c, d, mat, shade=1.0, out=None, col=None):
        return self.poly([a, b, c, d], mat, shade, out, col=col)

    def box(self, u0, u1, v0, v1, y0, y1, mat, shade=1.0, faces="nsewtb", col=None):
        """An axis box; faces: n (+u), s (-u), e (+v), w (-v), t (top), b (bottom)."""
        if "n" in faces:
            self.quad((u1, v0, y0), (u1, v1, y0), (u1, v1, y1), (u1, v0, y1), mat, shade, (1, 0, 0), col)
        if "s" in faces:
            self.quad((u0, v0, y0), (u0, v1, y0), (u0, v1, y1), (u0, v0, y1), mat, shade, (-1, 0, 0), col)
        if "e" in faces:
            self.quad((u0, v1, y0), (u1, v1, y0), (u1, v1, y1), (u0, v1, y1), mat, shade, (0, 1, 0), col)
        if "w" in faces:
            self.quad((u0, v0, y0), (u1, v0, y0), (u1, v0, y1), (u0, v0, y1), mat, shade, (0, -1, 0), col)
        if "t" in faces:
            self.quad((u0, v0, y1), (u1, v0, y1), (u1, v1, y1), (u0, v1, y1), mat, shade * 1.05, (0, 0, 1), col)
        if "b" in faces:
            self.quad((u0, v0, y0), (u1, v0, y0), (u1, v1, y0), (u0, v1, y0), mat, shade * 0.6, (0, 0, -1), col)

    def prism(self, ring, y0, y1, mat, shade=1.0, top=True, bottom=False, col=None, skip=None):
        cu, cv = centre(ring)
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            if skip and skip(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
                continue
            self.quad((a[0], a[1], y0), (b[0], b[1], y0), (b[0], b[1], y1), (a[0], a[1], y1), mat, shade,
                      ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0), col)
        if top:
            self.poly([(p[0], p[1], y1) for p in ring], mat, shade * 1.05, (0, 0, 1), col=col)
        if bottom:
            self.poly([(p[0], p[1], y0) for p in ring], mat, shade * 0.6, (0, 0, -1), col=col)

    def frustum(self, r0, y0, r1, y1, mat, shade=1.0, col=None, skip=None):
        cu, cv = centre(r0)
        n = len(r0)
        for i in range(n):
            a, b, c, d = r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]
            if skip and skip(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
                continue
            up = 1.0 if y1 > y0 else -1.0
            self.quad((a[0], a[1], y0), (b[0], b[1], y0), (c[0], c[1], y1), (d[0], d[1], y1), mat, shade,
                      ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.3 * up), col)

    def cone(self, ring, y0, apex_y, mat, shade=1.0, col=None, apex=None):
        cu, cv = apex if apex else centre(ring)
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (cu, cv, apex_y)], mat, shade,
                      ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.3), col=col)

    def door(self, name, u, v):
        self.doors.append((name, round(self.cx + u, 2), round(self.cz + v, 2)))


# ------------------------------------------------------------------ walls with real openings

class W:
    """A wall frame: p a point of the face (u, v), d along it, o out of it (unit, local u-v)."""

    def __init__(self, p, d, o):
        self.p, self.d, self.o = p, d, o

    def P(self, s, e, y):
        return (self.p[0] + self.d[0] * s + self.o[0] * e, self.p[1] + self.d[1] * s + self.o[1] * e, y)

    def dir(self, ds, de, dy):
        return (self.d[0] * ds + self.o[0] * de, self.d[1] * ds + self.o[1] * de, dy)

    def shifted(self, e):
        return W((self.p[0] + self.o[0] * e, self.p[1] + self.o[1] * e), self.d, self.o)

    def at(self, s):
        return W((self.p[0] + self.d[0] * s, self.p[1] + self.d[1] * s), self.d, self.o)


def four_pts(sc, hw, ysp, rise):
    """The basket (four-centred) head of the museum door: build_landmarks.py DOOR4 from the right springing."""
    prof = [(1, 0.76), (0.9, 0.9), (0.7, 0.98), (0.5, 1), (0.3, 0.98), (0.1, 0.9), (0, 0.76)]
    return [(sc + (2 * x - 1) * hw, ysp + (t - 0.76) / 0.24 * rise) for x, t in prof]


class Op:
    """An opening in a wall: s its middle, hw its half width, y0 its sill, y1 the top of its head.
    head: flat, round, seg (segmental), pointed, four (basket arch), circle (an oculus: y0..y1 its diameter).
    back: glass, void, door, shutter, band, a carve cell ("carve:semini"), or None (a real way through).
    frame: the width of the bluestone surround (0: none), proj how far it stands out; sill: a projecting
    sill; mull: mullions; transom: its height; bars: iron bars; splay: the face wider than the back (slits);
    rev: the reveal's material (else the frame's bluestone, else the wall's); blocks: the frame as voussoirs;
    frame_all: the frame goes round the foot too (panels, niches)."""

    def __init__(self, s, hw, y0, y1, head="flat", depth=0.3, back="glass", frame=0.13, proj=0.07, sill=None, mull=0,
                 transom=None, bars=0, splay=0.0, rev=None, blocks=False, frame_all=False, rise=None, n=8, hood=False, steps=0,
                 name=None, real=None):
        self.real = real  # a real opening's label (issue #10): its glass is the room's
        self.s, self.hw, self.y0, self.y1, self.head = s, hw, y0, y1, head
        self.steps, self.name = steps, name  # steps: that many stone steps up to a door's sill from the ground (y 0)
        self.depth, self.back, self.frame, self.proj = depth, back, frame, max(proj, 0.06) if frame > 0 else 0.0
        self.sill = (frame > 0 and head != "circle" and back not in (None, "door") and not frame_all) if sill is None else sill
        self.mull, self.transom, self.bars, self.splay, self.rev = mull, transom, bars, splay, rev
        self.blocks, self.frame_all, self.n, self.hood = blocks, frame_all, n, hood
        h = y1 - y0
        if head == "flat":
            self.ysp, self.rise = y1, 0.0
        elif head == "round":
            self.rise = min(hw, h * 0.9)
            self.ysp = y1 - self.rise
        elif head == "seg":
            self.rise = min(0.3 * hw, h * 0.5)
            self.ysp = y1 - self.rise
        elif head == "pointed":
            self.rise = rise if rise is not None else min(1.3 * hw, h * 0.9)
            self.ysp = y1 - self.rise
        elif head == "four":
            self.ysp, self.rise = y0 + 0.76 * h, 0.24 * h
        elif head == "circle":
            self.r = hw
            self.yc = (y0 + y1) / 2
            self.ysp, self.rise = self.yc, 0.0

    def head_pts(self, g=0.0, sp=0.0):
        """The head from the right springing to the left one (all shapes but the circle)."""
        s, hw = self.s, self.hw + g + sp
        if self.head == "flat":
            return [(s + hw, self.ysp + g + sp), (s - hw, self.ysp + g + sp)]
        rise = self.rise + g + sp
        if self.head == "four":
            return four_pts(s, hw, self.ysp, rise)
        n = self.n
        if self.head in ("round", "seg"):
            return [(s + hw * math.cos(math.pi * k / (2 * n)), self.ysp + rise * math.sin(math.pi * k / (2 * n))) for k in range(2 * n + 1)]
        # pointed: two arcs of radius R through the springings and the apex
        R = (hw * hw + rise * rise) / (2 * hw)
        c = hw - R
        tmax = math.asin(min(1.0, rise / R))
        right = [(s + c + R * math.cos(tmax * k / n), self.ysp + R * math.sin(tmax * k / n)) for k in range(n)]
        right.append((s, self.ysp + rise))
        left = [(2 * s - x, y) for x, y in reversed(right[:-1])]
        return right + left

    def loop(self, g=0.0, sp=0.0, foot=False):
        """The opening's outline, closed: from the right foot over the head to the left foot."""
        if self.head == "circle":
            r = self.r + g + sp
            n = 4 * self.n
            return [(self.s + r * math.cos(2 * math.pi * k / n), self.yc + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        hw = self.hw + g + sp
        yb = self.y0 - (g if foot else 0.0)
        return [(self.s + hw, yb)] + self.head_pts(g, sp) + [(self.s - hw, yb)]

    def span(self):
        """s0, s1, ybottom, ytop of the hole in the face."""
        hw = (self.r if self.head == "circle" else self.hw) + self.splay
        if self.head == "circle":
            return self.s - hw, self.s + hw, self.yc - hw, self.yc + hw
        top = self.ysp + (self.splay if self.head == "flat" else self.rise + self.splay)
        return self.s - hw, self.s + hw, self.y0, top

    def breaks(self):
        s0, s1, yb, yt = self.span()
        return [yb, yt] + ([self.yc] if self.head == "circle" else ([self.ysp] if self.head != "flat" else []))

    def spandrels(self):
        """The wall left round the head inside the hole's box (above the curve), as polygons."""
        s0, s1, yb, yt = self.span()
        if self.head == "flat":
            return []
        if self.head == "circle":
            lp = self.loop(sp=self.splay)
            n = len(lp)
            upper = lp[: n // 2 + 1]  # from (s+r, yc) over the top to (s-r, yc)
            lower = lp[n // 2:] + [lp[0]]
            return [upper + [(s0, yt), (s1, yt)], lower + [(s1, yb), (s0, yb)]]
        hp = self.head_pts(sp=self.splay)
        k = max(range(len(hp)), key=lambda i: hp[i][1])
        return [hp[: k + 1] + [(s1, yt)], hp[k:] + [(s0, yt)]]

    def inside(self, ya, yb):
        s0, s1, b, t = self.span()
        return ya >= b - 1e-6 and yb <= t + 1e-6


def mat_at(mats, y):
    for top, mt in mats:
        if y <= top:
            return mt
    return mats[-1][1]


WALLM = None  # set in build(): Tournai below the base course, sandstone above


def wall(m, w, outline, ops=(), mats=None, shade=1.0, face=True):
    """A wall face on frame w: outline a closed polygon in (s, y), y-monotone; ops the openings cut in it
    (they must lie inside it and not overlap). Then each opening's reveal, back, frame, sill, mullions, bars."""
    mats = mats or WALLM
    if face:
        ys = sorted({round(y, 5) for _, y in outline} | {round(y, 5) for op in ops for y in op.breaks()} | {round(t, 5) for t, _ in mats})
        ylo, yhi = min(y for _, y in outline), max(y for _, y in outline)
        ys = [y for y in ys if ylo - 1e-6 <= y <= yhi + 1e-6]
        for ya, yb in zip(ys, ys[1:]):
            if yb - ya < 1e-5:
                continue
            band = clip(clip(outline, 1, ya, True), 1, yb, False)
            if len(band) < 3 or abs(area2(band)) < 1e-6:
                continue
            smin, smax = min(p[0] for p in band), max(p[0] for p in band)
            mt = mat_at(mats, (ya + yb) / 2)
            cuts = sorted((op.span()[0], op.span()[1], op) for op in ops if op.inside(ya, yb))
            free, x = [], smin
            for c0, c1, _ in cuts:
                if c0 > x + 1e-6:
                    free.append((x, c0))
                x = max(x, c1)
            if smax > x + 1e-6:
                free.append((x, smax))
            for sa, sb in free:
                piece = clip(clip(band, 0, sa, True), 0, sb, False)
                if len(piece) >= 3 and abs(area2(piece)) > 1e-6:
                    m.poly([w.P(s, 0, y) for s, y in piece], mt, shade, w.dir(0, 1, 0))
            for _, _, op in cuts:
                for sp in op.spandrels():
                    piece = clip(clip(sp, 1, ya, True), 1, yb, False)
                    if len(piece) >= 3 and abs(area2(piece)) > 1e-6:
                        m.poly([w.P(s, 0, y) for s, y in piece], mt, shade, w.dir(0, 1, 0))
    for op in ops:
        opening(m, w, op, mat_at(mats, (op.y0 + op.y1) / 2), shade)


def cell_uvs(pts2, cell, sheet):
    """UVs that lay a whole cell over the bounding box of a 2D outline (s, y)."""
    xs = [p[0] for p in pts2]
    ys = [p[1] for p in pts2]
    s0, s1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx, cy, cw, ch = (ACELL if sheet == "atlas" else CCELL)[cell]
    N = SAT if sheet == "atlas" else CAR
    out = []
    for s, y in pts2:
        fx = (s - s0) / ((s1 - s0) or 1)
        fy = (y1 - y) / ((y1 - y0) or 1)  # from the top
        out.append(((cx + 0.5 + fx * (cw - 1)) / N, 1 - (cy + 0.5 + fy * (ch - 1)) / N))
    return out


def back_face(m, w, pts2, e, back, shade=1.0):
    if back is None:
        return
    pts = [w.P(s, e, y) for s, y in pts2]
    out = w.dir(0, 1, 0)
    if back == "glass":
        m.poly(pts, GLASS_LIT if m is LIT[0] else GLASS, shade, out)
    elif back.startswith("carve:"):
        m.poly(pts, CARVE, shade, out, uvs=cell_uvs(pts2, back[6:], "carve"))
    else:
        m.poly(pts, ATLAS, shade, out, uvs=cell_uvs(pts2, back, "atlas"))


def opening(m, w, op, wall_mat, shade=1.0):
    fw, pj, dep = op.frame, op.proj, op.depth
    record(m, w, op)
    rev = op.rev if op.rev is not None else (BLUE if fw > 0 else wall_mat)
    inner = op.loop()
    front = op.loop(sp=op.splay)
    n = len(inner)
    closed_foot = op.head == "circle"
    cs, cy = op.s, ((op.yc if op.head == "circle" else (op.y0 + op.ysp) / 2))
    # the reveal: from the face (or the frame's face) back to the glass
    if dep > 0:
        for i in range(n):
            j = (i + 1) % n
            foot_edge = (not closed_foot) and i == n - 1
            if foot_edge and op.back is None:
                continue  # a way through: its floor is the street's or the ramp's
            ef = 0.0 if foot_edge else pj
            a, b = front[i], front[j]
            ai, bi = inner[i], inner[j]
            ms, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            sh = 0.9 if foot_edge else (0.62 if my > op.ysp else 0.74)
            m.poly([w.P(a[0], ef, a[1]), w.P(b[0], ef, b[1]), w.P(bi[0], -dep, bi[1]), w.P(ai[0], -dep, ai[1])], rev, shade * sh,
                   w.dir(cs - ms, 0, (cy - my) if not foot_edge else 1.0))
    if op.real:
        real_opening(m, w, op)
    if op.real and op.back == "glass":
        back_face(LIT[0], w, inner, -dep, op.back, 0.85)
    else:
        back_face(m, w, inner, -dep, op.back, 0.85)
    # the frame (bluestone surround), as one ring or as voussoirs
    if fw > 0:
        outer = op.loop(g=fw, foot=op.frame_all)
        edges = range(n) if (closed_foot or op.frame_all) else range(n - 1)
        for i in edges:
            j = (i + 1) % n
            p_ = pj * (1.35 if (op.blocks and i % 2 == 0) else 1.0)
            a, b, c, d = inner[i], inner[j], outer[j], outer[i]
            m.poly([w.P(a[0], p_, a[1]), w.P(b[0], p_, b[1]), w.P(c[0], p_, c[1]), w.P(d[0], p_, d[1])], BLUE, shade * 1.04, w.dir(0, 1, 0))
            ms, my = (c[0] + d[0]) / 2, (c[1] + d[1]) / 2
            m.poly([w.P(d[0], 0, d[1]), w.P(c[0], 0, c[1]), w.P(c[0], p_, c[1]), w.P(d[0], p_, d[1])], BLUE, shade * 0.9,
                   w.dir(ms - cs, 0, my - cy))
            if op.blocks and i != edges[-1]:  # the joints between the voussoirs: the proud one's end
                pn = pj * (1.35 if (i + 1) % 2 == 0 else 1.0)
                if abs(pn - p_) > 1e-4:
                    sg = 1.0 if p_ > pn else -1.0
                    m.poly([w.P(b[0], min(p_, pn), b[1]), w.P(c[0], min(p_, pn), c[1]), w.P(c[0], max(p_, pn), c[1]), w.P(b[0], max(p_, pn), b[1])],
                           BLUE, shade * 0.8, w.dir(sg * (b[0] - a[0]), 0, sg * (b[1] - a[1])))
        if not (closed_foot or op.frame_all) and op.back is not None:
            for a, d in ((inner[0], outer[0]), (inner[-1], outer[-1])):  # the legs' feet (over the sill)
                m.poly([w.P(a[0], 0, a[1]), w.P(d[0], 0, d[1]), w.P(d[0], pj, d[1]), w.P(a[0], pj, a[1])], BLUE, shade * 0.6, w.dir(0, 0, -1))
    # the sill
    if op.sill:
        g = fw + 0.07
        wbox(m, w, op.s - op.hw - g, op.s + op.hw + g, 0.0, max(pj, 0.02) + 0.08, op.y0 - 0.14, op.y0, BLUE, shade, "olrtd")
    if op.hood and op.head == "flat":
        g = fw + 0.1
        wbox(m, w, op.s - op.hw - g, op.s + op.hw + g, 0.0, pj + 0.1, op.y1 + fw, op.y1 + fw + 0.13, BLUE, shade * 1.05, "olrtd")
    # mullions and a transom (bluestone), standing on the glass
    top = op.ysp
    if op.mull or op.transom:
        e0, e1 = -dep, -dep + min(0.14, dep * 0.5)
        ts = [op.transom] if op.transom and op.y0 + 0.2 < op.transom < op.ysp - 0.15 else []
        for k in range(op.mull):
            s = op.s - op.hw + 2 * op.hw * (k + 1) / (op.mull + 1)
            ys = [op.y0] + [t - 0.055 for t in ts] + [t + 0.055 for t in ts] + [top]
            for ya, yb in zip(ys[0::2], ys[1::2]):
                wbox(m, w, s - 0.055, s + 0.055, e0, e1, ya, yb, BLUE, shade * 0.95, "olr")
        for t in ts:
            xs = [op.s - op.hw] + sum(([op.s - op.hw + 2 * op.hw * (k + 1) / (op.mull + 1) - 0.055, op.s - op.hw + 2 * op.hw * (k + 1) / (op.mull + 1) + 0.055]
                                       for k in range(op.mull)), []) + [op.s + op.hw]
            for sa, sb in zip(xs[0::2], xs[1::2]):
                wbox(m, w, sa, sb, e0, e1, t - 0.055, t + 0.055, BLUE, shade * 0.95, "otd")
    # iron bars, a little inside the face
    if op.bars:
        eb = -min(0.07, dep * 0.3)
        k = max(2, int(round(2 * op.hw / 0.14)))
        for i in range(1, k):
            s = op.s - op.hw + 2 * op.hw * i / k
            wbox(m, w, s - 0.016, s + 0.016, eb - 0.016, eb + 0.016, op.y0, top, METAL, 1.0, "olri", col=IRON)
        hk = max(1, int((top - op.y0) / 0.55))
        for i in range(1, hk + 1):
            y = op.y0 + (top - op.y0) * i / (hk + 1)
            wbox(m, w, op.s - op.hw, op.s + op.hw, eb + 0.018, eb + 0.04, y - 0.02, y + 0.02, METAL, 1.0, "otd", col=IRON)


def real_opening(m, w, op):
    """Record a real opening (issue #10) in world metres: its outline where the reveal ends (a door's up to its
    springing: the head over its leaves is the room's wall, as it was)."""
    kind = "window" if op.back == "glass" else "door"
    if kind == "door":
        ol = [(op.s - op.hw, op.y0), (op.s + op.hw, op.y0), (op.s + op.hw, op.ysp), (op.s - op.hw, op.ysp)]
    else:
        ol = op.loop()
    x, _, z = m.W(*w.P(op.s, 0, 0))
    poly = [(s_ - op.s, y_) for s_, y_ in ol]
    OPENINGS.append(dict(kind=kind, part="steen", label=op.real, glaze="bars" if op.bars else "", shape="rect", x=x, z=z, tx=w.d[0], tz=w.d[1],
                         nx=w.o[0], nz=w.o[1], hw=max(abs(q[0]) for q in poly), yb=min(q[1] for q in poly), yt=max(q[1] for q in poly), arch=False,
                         depth=max(op.depth, 0.0), poly=poly))


def opening_markers():
    """Every real opening as an empty in the glb (dev/interiorcheck.ts reads them) and shared/steenShell.ts."""
    for i, o in enumerate(OPENINGS):
        o["id"] = f"st_{i:03d}"
        ob = bpy.data.objects.new("opening_" + o["id"], None)
        ob.empty_display_size = max(0.2, o["hw"])
        ob.location = Vector((o["x"], -o["z"], (o["yb"] + o["yt"]) / 2))
        for k in ("kind", "label", "glaze", "shape", "part"):
            ob[k] = str(o[k])
        for k in ("hw", "yb", "yt", "nx", "nz", "tx", "tz", "depth"):
            ob[k] = float(o[k])
        ob["arch"] = 0
        bpy.context.scene.collection.objects.link(ob)
    f3 = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")  # noqa: E731
    lines = [
        "// GENERATED by tools/blender/build_steen.py (issue #10, interiors are real): do not edit. Every real opening of the",
        "// Steen's shell (client/public/models/steen.glb, whose empties opening_<id> are the same), in the WORLD's frame",
        "// (world/landmarkHalls.ts moves them into the hall's: shellOpening.ts inFrame). x, z: its middle on the wall's outer",
        "// face; (tx, tz) along it, (nx, nz) out of it; poly its outline where the reveal ends (u along from the middle,",
        "// world y); depth the reveal's depth into the wall.",
        "",
        'import type { ShellOpening } from "./shellOpening.js";',
        "",
        "export const SHELL_OPENINGS: ShellOpening[] = [",
    ]
    for o in OPENINGS:
        parts_ = []
        for k in ("id", "kind", "part", "label", "glaze", "shape", "x", "z", "tx", "tz", "nx", "nz", "hw", "yb", "yt", "arch", "depth"):
            v = o[k]
            parts_.append(f"{k}: {json.dumps(v) if isinstance(v, (str, bool)) else f3(float(v))}")
        parts_.append("poly: [" + ", ".join(f"[{f3(u)}, {f3(y)}]" for u, y in o["poly"]) + "]")
        lines.append("  { " + ", ".join(parts_) + " },")
    lines += ["];", ""]
    with open(SHELL_TS, "w", newline="\n") as f:
        f.write("\n".join(lines))
    return len(OPENINGS)


def record(m, w, op):
    """The opening as a feature: a window's box (its frame, sill and reveal); a door's or a gate's clear space in
    front of it and its sill, and where one stands before it (past its steps)."""
    s0, s1, yb, yt = op.span()
    g = op.frame + (0.08 if op.sill else 0.0)
    role = "gate" if (op.back is None and op.hw > 2.0) else ("door" if op.back in (None, "door") else "window")
    x, _, z = m.W(*w.P(op.s, 0, 0))
    name = op.name or f"{role} at x {x:.1f}, z {z:.1f}, {op.y0:.1f} m up"
    if role == "window":
        pts = [w.P(s_, e_, y_) for s_ in (s0 - g, s1 + g) for e_ in (-op.depth, max(op.proj, 0.0) + (0.08 if op.sill else 0.0))
               for y_ in (yb - (0.14 if op.sill else 0.0), yt + op.frame)]
        m.feature("window", name, pts)
    else:
        run = op.steps * 0.32
        pts = [w.P(s_, e_, y_) for s_ in (s0, s1) for e_ in (0.02, run + 0.8) for y_ in (op.y0 + 0.05, yt)]
        front = m.W(*w.P(op.s, run + 1.2, op.y0))
        m.feature(role, name, pts, out=[round(w.o[0], 3), round(w.o[1], 3)], sill=round(op.y0, 3), front=front, base=0.0 if op.steps else round(op.y0, 3))
    if op.steps:
        n = op.steps
        hwst = op.hw + op.frame + 0.25
        for k in range(n):
            e1 = (n - k) * 0.32
            wbox(m, w, op.s - hwst + 0.02 * k, op.s + hwst - 0.02 * k, 0.0, e1, op.y0 * k / n, op.y0 * (k + 1) / n, BLUE, 0.9, "olrt")
        m.feature("stair", f"steps to the {name}", [w.P(s_, e_, y_) for s_ in (op.s - hwst, op.s + hwst) for e_ in (0.0, n * 0.32) for y_ in (0.0, op.y0)],
                  base=0.0)


def wbox(m, w, s0, s1, e0, e1, y0, y1, mat, shade=1.0, faces="olrtd", col=None):
    """A box against a wall frame: s0..s1 along, e0..e1 out, y0..y1 up; faces o (front), i (back),
    l (s0 end), r (s1 end), t (top), d (bottom)."""
    P = w.P
    if "o" in faces:
        m.quad(P(s0, e1, y0), P(s1, e1, y0), P(s1, e1, y1), P(s0, e1, y1), mat, shade, w.dir(0, 1, 0), col)
    if "i" in faces:
        m.quad(P(s0, e0, y0), P(s1, e0, y0), P(s1, e0, y1), P(s0, e0, y1), mat, shade * 0.8, w.dir(0, -1, 0), col)
    if "l" in faces:
        m.quad(P(s0, e0, y0), P(s0, e1, y0), P(s0, e1, y1), P(s0, e0, y1), mat, shade * 0.85, w.dir(-1, 0, 0), col)
    if "r" in faces:
        m.quad(P(s1, e0, y0), P(s1, e1, y0), P(s1, e1, y1), P(s1, e0, y1), mat, shade * 0.85, w.dir(1, 0, 0), col)
    if "t" in faces:
        m.quad(P(s0, e0, y1), P(s1, e0, y1), P(s1, e1, y1), P(s0, e1, y1), mat, shade * 1.08, (0, 0, 1), col)
    if "d" in faces:
        m.quad(P(s0, e0, y0), P(s1, e0, y0), P(s1, e1, y0), P(s0, e1, y0), mat, shade * 0.55, (0, 0, -1), col)


def rect(s0, s1, y0, y1):
    return [(s0, y0), (s1, y0), (s1, y1), (s0, y1)]


# ------------------------------------------------------------------ the details

def course(m, w, s0, s1, y, h=0.18, proj=0.1, mat=BLUE, ends="lr", ops=()):
    """A string course: a bluestone band along the wall, its top weathered (sloped); it stops at the openings
    of ops it would cross (their frames and a hand's breadth)."""
    cuts = []
    for op in ops:
        sa, sb, yb, yt = op.span()
        g = op.frame + 0.12
        if yb - 0.2 < y < yt + op.frame + 0.3:
            cuts.append((sa - g, sb + g))
    if cuts:
        x = s0
        for c0, c1 in sorted(cuts):
            if c0 > x + 0.05:
                course(m, w, x, min(c0, s1), y, h, proj, mat, "lr")
            x = max(x, c1)
        if s1 > x + 0.05:
            course(m, w, x, s1, y, h, proj, mat, "lr")
        return
    P = w.P
    m.quad(P(s0, proj, y - h), P(s1, proj, y - h), P(s1, proj, y - h * 0.35), P(s0, proj, y - h * 0.35), mat, 1.0, w.dir(0, 1, 0))
    m.quad(P(s0, proj, y - h * 0.35), P(s1, proj, y - h * 0.35), P(s1, 0.0, y), P(s0, 0.0, y), mat, 1.1, w.dir(0, 1, 1.6))
    m.quad(P(s0, 0.0, y - h), P(s1, 0.0, y - h), P(s1, proj, y - h), P(s0, proj, y - h), mat, 0.55, (0, 0, -1))
    for s, sg, k in ((s0, -1, "l"), (s1, 1, "r")):
        if k in ends:
            m.poly([P(s, 0, y - h), P(s, proj, y - h), P(s, proj, y - h * 0.35), P(s, 0, y)], mat, 0.85, w.dir(sg, 0, 0))


def batter(m, w, s0, s1, y_top=1.0, out=0.38, y_bot=-0.4, ends="lr", mat=TOUR):
    """The foot of a wall battered out into the ground, a bluestone chamfer on top."""
    P = w.P
    m.quad(P(s0, out, y_bot), P(s1, out, y_bot), P(s1, 0.0, y_top), P(s0, 0.0, y_top), mat, 0.82, w.dir(0, 1, out / (y_top - y_bot) * 3))
    for s, sg, k in ((s0, -1, "l"), (s1, 1, "r")):
        if k in ends:
            m.poly([P(s, 0, y_bot), P(s, out, y_bot), P(s, 0, y_top)], mat, 0.75, w.dir(sg, 0, 0))


def anchor(m, w, s, y, kind="X", size=0.7, e=0.0):
    """An iron wall anchor, the end of a floor beam's tie: a cross, an S or a plain bar, a plate in the middle."""
    angs = {"X": (0.8, -0.8), "I": (math.pi / 2,), "S": (math.pi / 2,), "Y": (math.pi / 2, 0.5)}[kind]
    for a in angs:
        c, sn = math.cos(a), math.sin(a)
        hl, hw = size / 2, 0.028
        corners = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
        pts2 = [(s + x * c - yy * sn, y + x * sn + yy * c) for x, yy in corners]
        front = [w.P(ps, e + 0.06, py) for ps, py in pts2]
        m.poly(front, METAL, 1.0, w.dir(0, 1, 0), col=IRON)
        for i in range(4):
            a2, b2 = pts2[i], pts2[(i + 1) % 4]
            mid = ((a2[0] + b2[0]) / 2 - s, (a2[1] + b2[1]) / 2 - y)
            m.poly([w.P(a2[0], e, a2[1]), w.P(b2[0], e, b2[1]), w.P(b2[0], e + 0.06, b2[1]), w.P(a2[0], e + 0.06, a2[1])], METAL, 0.8,
                   w.dir(mid[0], 0, mid[1]), col=IRON)
    if kind == "S":  # the S's curls, as two short bars
        for sg in (-1, 1):
            wbox(m, w, s - 0.12 if sg > 0 else s + 0.03, s - 0.03 if sg > 0 else s + 0.12, e, e + 0.06, y + sg * size / 2 - 0.028, y + sg * size / 2 + 0.028, METAL, 1.0, "olrtd", col=IRON)
    wbox(m, w, s - 0.07, s + 0.07, e, e + 0.08, y - 0.07, y + 0.07, METAL, 1.0, "olrtd", col=IRON)


def downpipe(m, w, s, y_top, y_bot=0.05, e=0.06):
    """A zinc downpipe: the hopper head under the gutter, brackets, the shoe at the foot."""
    wbox(m, w, s - 0.05, s + 0.05, e, e + 0.1, y_bot + 0.25, y_top - 0.35, METAL, 1.0, "olr", col=ZINC)
    wbox(m, w, s - 0.14, s + 0.14, e - 0.02, e + 0.2, y_top - 0.35, y_top, METAL, 1.0, "olrd", col=ZINC)
    y = y_bot + 1.5
    while y < y_top - 0.8:
        wbox(m, w, s - 0.08, s + 0.08, 0.0, e + 0.12, y, y + 0.05, METAL, 1.0, "olrtd", col=IRON)
        y += 2.0
    wbox(m, w, s - 0.06, s + 0.06, e, e + 0.3, y_bot, y_bot + 0.25, METAL, 1.0, "olrt", col=ZINC)


def gutter(m, w, s0, s1, y, e):
    """A zinc gutter along an eave, hung just under the roof's edge."""
    wbox(m, w, s0, s1, e, e + 0.15, y - 0.13, y, METAL, 1.0, "olrd", col=ZINC)
    m.quad(w.P(s0, e, y - 0.02), w.P(s1, e, y - 0.02), w.P(s1, e + 0.15, y - 0.02), w.P(s0, e + 0.15, y - 0.02), METAL, 0.3, (0, 0, 1), col=ZINC)


def machicolation(m, w, s0, s1, y, proj=0.55, h=1.0, merlon=0.85, step=1.4, thick=0.4, slits=True, ends="lr", ch=1.05):
    """A battlement on stepped corbels: between the corbels the slots (machicolations) open down; the
    parapet stands out `proj`, merlons with slits and bluestone copings on it, the crenels coped."""
    k = s0 + 0.35
    cs = []
    while k < s1 - 0.25:
        cs.append(k)
        k += 0.8
    for c in cs:
        for (e1, ya, yb) in ((proj * 0.4, y - ch, y - ch * 2 / 3), (proj * 0.7, y - ch * 2 / 3, y - ch / 3), (proj, y - ch / 3, y)):
            wbox(m, w, c - 0.16, c + 0.16, 0.0, e1, ya, yb, BLUE, 0.95, "olrd")
    # the underside between the corbels: the slot by the wall dark, the rest stone
    edges = [s0] + sum(([c - 0.16, c + 0.16] for c in cs), []) + [s1]
    for sa, sb in zip(edges[0::2], edges[1::2]):
        if sb - sa < 0.02:
            continue
        m.poly([w.P(sa, 0.02, y), w.P(sb, 0.02, y), w.P(sb, 0.26, y), w.P(sa, 0.26, y)], ATLAS, 1.0, (0, 0, -1),
               uvs=cell_uvs([(0, 0), (1, 0), (1, 1), (0, 1)], "void", "atlas"))
        m.quad(w.P(sa, 0.26, y), w.P(sb, 0.26, y), w.P(sb, proj, y), w.P(sa, proj, y), SAND, 0.55, (0, 0, -1))
    # the parapet: its face over the corbels, its inner face, the crenels' copings, the merlons
    pw = w.shifted(proj)
    wall(m, pw, rect(s0, s1, y, y + h), mats=((1e9, SAND),))
    m.quad(w.P(s0, proj - thick, y), w.P(s1, proj - thick, y), w.P(s1, proj - thick, y + h), w.P(s0, proj - thick, y + h), SAND, 0.75, w.dir(0, -1, 0))
    for s, sg, kk in ((s0, -1, "l"), (s1, 1, "r")):
        if kk in ends:
            m.quad(w.P(s, 0, y), w.P(s, proj, y), w.P(s, proj, y + h), w.P(s, 0, y + h), SAND, 0.85, w.dir(sg, 0, 0))
    wbox(m, w, s0 - 0.02, s1 + 0.02, proj - thick - 0.05, proj + 0.05, y + h, y + h + 0.1, BLUE, 1.0, "oltrdi")
    k = s0 + 0.1
    while k + merlon <= s1 + 0.01:
        a, b = k, min(s1, k + merlon)
        yb = y + h + 0.1
        yt = yb + merlon * 1.05
        wall(m, pw, rect(a, b, yb, yt), ops=[Op((a + b) / 2, 0.05, yb + 0.2, yt - 0.25, depth=0.2, back="void", frame=0, splay=0.05)] if slits and b - a > 0.5 else (), mats=((1e9, SAND),))
        m.quad(w.P(a, proj - thick, yb), w.P(b, proj - thick, yb), w.P(b, proj - thick, yt), w.P(a, proj - thick, yt), SAND, 0.75, w.dir(0, -1, 0))
        for s, sg in ((a, -1), (b, 1)):
            m.quad(w.P(s, proj - thick, yb), w.P(s, proj, yb), w.P(s, proj, yt), w.P(s, proj - thick, yt), SAND, 0.85, w.dir(sg, 0, 0))
        wbox(m, w, a - 0.04, b + 0.04, proj - thick - 0.05, proj + 0.05, yt, yt + 0.12, BLUE, 1.05, "oltrdi")
        k += step


def stepped_gable(m, w, s0, s1, y0, rise, steps=4, t=0.55, crown=0.9, ops=(), wall_from=None, mats=None, coping=True, kneel=(True, True)):
    """The end wall and its stepped gable as one face (so windows can sit anywhere in it), the gable's back
    face above the roof, the treads and risers with bluestone copings, kneelers at the foot, a crown.
    wall_from: the face's foot (else the gable alone, from y0)."""
    hw = (s1 - s0) / 2
    wd = 2 * hw / (2 * steps + 1)
    left = [(s0, y0)]
    for k in range(steps):
        y = y0 + rise * (k + 1) / (steps + 1)
        left += [(s0 + k * wd, y), (s0 + (k + 1) * wd, y)]
    ytop = y0 + rise + crown
    left += [(s0 + steps * wd, ytop)]
    right = [(s0 + s1 - s, y) for s, y in reversed(left)]
    top = left + right
    outline = top if wall_from is None else [(s0, wall_from)] + top + [(s1, wall_from)]
    wall(m, w, outline, ops=ops, mats=mats)
    # the back of the gable above the roof, and its edges
    m.poly([w.P(s, -t, y) for s, y in top], SAND, 0.78, w.dir(0, -1, 0))
    for i in range(len(top) - 1):
        (sa, ya), (sb, yb) = top[i], top[i + 1]
        ns, ny = -(yb - ya), (sb - sa)
        if abs(ny) > 1e-6 and coping:
            continue  # the treads are under the copings
        m.poly([w.P(sa, 0, ya), w.P(sb, 0, yb), w.P(sb, -t, yb), w.P(sa, -t, ya)], SAND, 0.9, w.dir(ns, 0, ny))
    if coping:
        for i in range(len(top) - 1):
            (sa, ya), (sb, yb) = top[i], top[i + 1]
            if abs(yb - ya) > 1e-6 or abs(ya - ytop) < 1e-6:
                continue
            a, b = min(sa, sb), max(sa, sb)
            outer_left = a < (s0 + s1) / 2
            a2 = a - 0.07 if outer_left else a
            b2 = b + 0.07 if not outer_left else b
            if abs(b - a) < 1e-4:
                continue
            wbox(m, w, a2, b2, -t - 0.06, 0.08, ya, ya + 0.13, BLUE, 1.05, "oitd" + ("l" if outer_left else "r"))
        # kneelers at the foot, the crown on top
        for s, sg, kn in ((s0, 1, kneel[0]), (s1, -1, kneel[1])):
            if not kn:
                continue
            a, b = (s - 0.12, s + 0.45) if sg > 0 else (s - 0.45, s + 0.12)
            wbox(m, w, a, b, -t - 0.08, 0.19, y0 - 0.34, y0 + 0.05, BLUE, 1.0, "oilrtd")
        sc = (s0 + s1) / 2
        wbox(m, w, sc - wd / 2 - 0.08, sc + wd / 2 + 0.08, -t - 0.08, 0.1, ytop, ytop + 0.16, BLUE, 1.05, "oilrtd")
        c = w.P(sc, -t / 2, 0)
        m.prism(ngon(c[0], c[1], 0.16, 8, math.pi / 8), ytop + 0.16, ytop + 0.55, BLUE, 1.0, top=False)
        m.cone(ngon(c[0], c[1], 0.2, 8, math.pi / 8), ytop + 0.55, ytop + 0.95, BLUE, 1.0)
    return top


def roof_gable(m, u0, u1, v0, v1, y, rise, along="u", over=0.4, end_over=(0.3, 0.3), mat=SLATE, gutters=True, ridge=True, skipside=()):
    """A saddle roof over a rectangle (ridge along u or v), eaves standing `over` out, the ends `end_over`
    past the gables (0 where a stepped gable closes it). The gable triangles are walls built by the caller."""
    m.begin_part(f"roof over {m.sec}")
    _roof_gable(m, u0, u1, v0, v1, y, rise, along, over, end_over, mat, gutters, ridge, skipside)
    m.end_part()


def _roof_gable(m, u0, u1, v0, v1, y, rise, along, over, end_over, mat, gutters, ridge, skipside):
    if along == "u":
        vm = (v0 + v1) / 2
        half = (v1 - v0) / 2
        drop = over * rise / half
        ua, ub = u0 - end_over[0], u1 + end_over[1]
        for vs, sg in ((v0 - over, -1), (v1 + over, 1)):
            if sg in skipside:
                continue
            m.quad((ua, vs, y - drop), (ub, vs, y - drop), (ub, vm, y + rise), (ua, vm, y + rise), mat, 1.0, (0, sg, half / rise))
            if gutters:
                gw = W((0, vs), (1, 0), (0, sg))
                gutter(m, gw, ua + (0.03 if end_over[0] == 0 else 0), ub - (0.03 if end_over[1] == 0 else 0), y - drop, -0.05)
        if ridge:
            m.box(ua + 0.02, ub - 0.02, vm - 0.1, vm + 0.1, y + rise - 0.06, y + rise + 0.1, METAL, 1.0,
                  "ewt" + ("s" if end_over[0] > 0 else "") + ("n" if end_over[1] > 0 else ""), col=LEAD)
    else:
        um = (u0 + u1) / 2
        half = (u1 - u0) / 2
        drop = over * rise / half
        va, vb = v0 - end_over[0], v1 + end_over[1]
        for us, sg in ((u0 - over, -1), (u1 + over, 1)):
            if sg in skipside:
                continue
            m.quad((us, va, y - drop), (us, vb, y - drop), (um, vb, y + rise), (um, va, y + rise), mat, 1.0, (sg, 0, half / rise))
            if gutters:
                gw = W((us, 0), (0, 1), (sg, 0))
                gutter(m, gw, va + (0.03 if end_over[0] == 0 else 0), vb - (0.03 if end_over[1] == 0 else 0), y - drop, -0.05)
        if ridge:
            m.box(um - 0.1, um + 0.1, va + 0.02, vb - 0.02, y + rise - 0.06, y + rise + 0.1, METAL, 1.0,
                  "nst" + ("w" if end_over[0] > 0 else "") + ("e" if end_over[1] > 0 else ""), col=LEAD)


def dormer(m, w, s, e_eave, y_eave, e_ridge, y_ridge, yb, wd=1.3, hf=1.8, stepped=False):
    """A dormer on a roof slope that climbs from (e_eave, y_eave) to (e_ridge, y_ridge) in frame w: its front
    (sandstone, with a real window and a bluestone frame) stands where the roof is yb high; slate cheeks and
    a small slate roof back into the slope, or a little stepped front."""
    m.begin_part(f"dormer on {m.sec}")
    _dormer(m, w, s, e_eave, y_eave, e_ridge, y_ridge, yb, wd, hf, stepped)
    m.end_part()


def _dormer(m, w, s, e_eave, y_eave, e_ridge, y_ridge, yb, wd, hf, stepped):
    def e_at(y):
        return e_eave + (y - y_eave) / (y_ridge - y_eave) * (e_ridge - e_eave)
    ef = e_at(yb)
    yk = yb + 0.62 * hf
    wf = w.shifted(ef)
    a, b = s - wd / 2, s + wd / 2
    win = Op(s, wd * 0.28, yb + 0.28, yk - 0.12, depth=0.16, frame=0.08, proj=0.05, mull=1 if wd > 1.2 else 0)
    if stepped:
        outline = [(a, yb - 0.3), (b, yb - 0.3), (b, yk), (b - wd * 0.2, yk), (b - wd * 0.2, yk + (hf - 0.62 * hf) * 0.55),
                   (a + wd * 0.2, yk + (hf - 0.62 * hf) * 0.55), (a + wd * 0.2, yk), (a, yk)]
    else:
        outline = [(a, yb - 0.3), (b, yb - 0.3), (b, yk), (s, yb + hf), (a, yk)]
    wall(m, wf, outline, ops=[win], mats=((1e9, SAND),))
    e1, e2 = e_at(yk), e_at(yb + hf)
    for sg, sx in ((-1, a), (1, b)):
        m.poly([w.P(sx, ef, yb - 0.3), w.P(sx, ef, yk), w.P(sx, e1, yk)], SLATE, 0.8, w.dir(sg, 0, 0))
    if stepped:
        wbox(m, w, a - 0.05, b + 0.05, ef - (ef - e1) - 0.02, ef + 0.08, yk, yk + 0.1, BLUE, 1.0, "oltrd")
        m.quad(w.P(a, ef - 0.05, yk + 0.1), w.P(b, ef - 0.05, yk + 0.1), w.P(b, e2, yb + hf), w.P(a, e2, yb + hf), SLATE, 0.95, w.dir(0, 1, 2))
    else:
        for sg, sx in ((-1, a - 0.12), (1, b + 0.12)):
            m.quad(w.P(sx, ef + 0.12, yk - 0.08), w.P(s, ef + 0.12, yb + hf + 0.04), w.P(s, e2, yb + hf + 0.04), w.P(sx, e1, yk - 0.08), SLATE, 0.95,
                   w.dir(sg, 0, 1.2))
        rp0, rp1 = w.P(s, ef + 0.12, yb + hf + 0.04), w.P(s, e2, yb + hf + 0.04)
        u0_, u1_ = sorted((rp0[0], rp1[0]))
        v0_, v1_ = sorted((rp0[1], rp1[1]))
        m.box(u0_ - 0.06, u1_ + 0.06, v0_ - 0.06, v1_ + 0.06, yb + hf, yb + hf + 0.1, METAL, 1.0, "nsewt", col=LEAD)


def chimney(m, u, v, y0, y1, wd=0.9, dd=0.6, pots=2):
    """An old brick stack: a bluestone band near the top, a cap slab, clay pots."""
    m.begin_part(f"chimney on {m.sec}")
    _chimney(m, u, v, y0, y1, wd, dd, pots)
    m.end_part()


def _chimney(m, u, v, y0, y1, wd, dd, pots):
    m.box(u - wd / 2, u + wd / 2, v - dd / 2, v + dd / 2, y0, y1, BRICK, 0.9, "nsew")
    m.box(u - wd / 2 - 0.06, u + wd / 2 + 0.06, v - dd / 2 - 0.06, v + dd / 2 + 0.06, y1 - 0.55, y1 - 0.4, BLUE, 1.0, "nsewtb")
    m.box(u - wd / 2 - 0.1, u + wd / 2 + 0.1, v - dd / 2 - 0.1, v + dd / 2 + 0.1, y1, y1 + 0.14, BLUE, 1.05, "nsewtb")
    for k in range(pots):
        pu = u + (k - (pots - 1) / 2) * wd / max(1, pots)
        m.prism(ngon(pu, v, 0.12, 8), y1 + 0.14, y1 + 0.62, METAL, 1.0, top=False, col=TERRA)
        m.prism(ngon(pu, v, 0.15, 8), y1 + 0.55, y1 + 0.66, METAL, 1.0, top=True, col=TERRA)


def finial(m, u, v, y, h=1.8, vane=False):
    _finial(m, u, v, y, h, vane)


def _finial(m, u, v, y, h, vane):
    m.box(u - 0.04, u + 0.04, v - 0.04, v + 0.04, y - 0.3, y + h, METAL, 1.0, "nsewt", col=LEAD)
    m.prism(ngon(u, v, 0.12, 8), y + 0.25, y + 0.45, METAL, 1.0, top=True, bottom=True, col=LEAD)
    m.prism(ngon(u, v, 0.07, 6), y + h * 0.55, y + h * 0.55 + 0.14, METAL, 1.0, top=True, bottom=True, col=GILT)
    if vane:
        m.box(u - 0.015, u + 0.015, v, v + 0.8, y + h - 0.55, y + h - 0.2, METAL, 1.0, "nsewtb", col=GILT)


def cone_roof(m, cu, cv, r_eave, y, apex, sides=24, kick=0.7, rot=0.0):
    """A bell-cast conical slate roof: the eave flares out, then the steep cone; the eave's underside."""
    m.begin_part(f"cone roof of {m.sec}")
    _cone_roof(m, cu, cv, r_eave, y, apex, sides, kick, rot)
    m.end_part()


def _cone_roof(m, cu, cv, r_eave, y, apex, sides, kick, rot):
    re = ngon(cu, cv, r_eave, sides, rot)
    rk = ngon(cu, cv, r_eave - kick * 0.55, sides, rot)
    yk = y + kick
    m.frustum(re, y, rk, yk, SLATE, 0.95)
    m.cone(rk, yk, apex, SLATE, 1.0)
    m.poly([(p[0], p[1], y) for p in reversed(re)], SAND, 0.45, (0, 0, -1))


# ------------------------------------------------------------------ towers

def tower(m, cu, cv, r, y1, sides=20, ops=(), skip=None, base_to=None, y0=0.9, batter_out=0.4, rim=True, rot=0.0, mats=None):
    """A round tower as flat facets, each a wall with real openings: ops are (angle, Op with s ignored).
    skip(point) is how high the block hides a facet whose middle is at point (None: not at all); the facet
    starts over it. The foot battered into the ground, a bluestone course where the Tournai stone ends."""
    ring = ngon(cu, cv, r, sides, rot)
    per = {}
    for ang, op in ops:
        k = int(math.floor((ang - rot) * sides / (2 * math.pi))) % sides
        per.setdefault(k, []).append(op)
    base = BASE if base_to is None else base_to
    for i in range(sides):
        a, b = ring[i], ring[(i + 1) % sides]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        hid = skip(mid) if skip else None
        if hid is not None and hid >= y1 - 0.05:
            continue
        fy0 = y0 if hid is None else max(y0, hid - 0.1)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        o = (mid[0] - cu, mid[1] - cv)
        lo = math.hypot(*o)
        o = (o[0] / lo, o[1] / lo)
        w = W(a, d, o)
        fops = []
        for op in per.get(i, []):
            op.s = L / 2
            if hid is None or op.span()[2] > fy0 + 0.2:
                fops.append(op)
        wall(m, w, rect(0, L, fy0, y1), ops=fops, mats=mats or ((base, TOUR), (1e9, SAND)))
    # the battered foot, the base course
    low = (lambda p: skip(p) is not None) if skip else None
    if batter_out > 0:
        ro = ngon(cu, cv, r + batter_out, sides, rot)
        m.frustum(ro, -0.4, ring, y0, TOUR, 0.82, skip=low)
    if base > y0:
        base_hide = (lambda p: skip(p) is not None and skip(p) > base) if skip else None
        rb = ngon(cu, cv, r + 0.1, sides, rot)
        m.frustum(rb, base - 0.18, ngon(cu, cv, r, sides, rot), base, BLUE, 1.05, skip=base_hide)
        m.prism(rb, base - 0.3, base - 0.18, BLUE, 1.0, top=False, skip=base_hide)


def tower_rim(m, cu, cv, r, y, sides=20, corbel=0.45, rot=0.0, skip=None):
    """A corbelled rim round a tower's top: stepped corbels, the band they carry."""
    for k in range(sides):
        a = rot + 2 * math.pi * (k + 0.5) / sides
        o = (math.cos(a), math.sin(a))
        pt = (cu + o[0] * r * math.cos(math.pi / sides), cv + o[1] * r * math.cos(math.pi / sides))
        if skip and skip(pt) is not None and skip(pt) >= y - 1.0:
            continue
        w = W(pt, (-o[1], o[0]), o)
        for (e1, ya, yb) in ((corbel * 0.45, y - 1.0, y - 0.66), (corbel * 0.75, y - 0.66, y - 0.33), (corbel, y - 0.33, y)):
            wbox(m, w, -0.15, 0.15, -0.02, e1, ya, yb, BLUE, 0.95, "olrd")
    ro = ngon(cu, cv, r + corbel, sides, rot)
    m.poly([(p[0], p[1], y) for p in reversed(ro)], SAND, 0.5, (0, 0, -1))


def round_parapet(m, cu, cv, r_out, y, h=1.0, merlon=0.85, sides=20, thick=0.4, rot=0.0):
    """Battlements round a tower's rim (the 1887-90 restorers'): a hollow parapet, every other facet a merlon."""
    ro = ngon(cu, cv, r_out, sides, rot)
    ri = ngon(cu, cv, r_out - thick, sides, rot)
    for i in range(sides):
        a, b = ro[i], ro[(i + 1) % sides]
        ai, bi = ri[i], ri[(i + 1) % sides]
        mid = ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv)
        yt = y + h + (merlon if i % 2 == 0 else 0.0)
        m.quad((a[0], a[1], y), (b[0], b[1], y), (b[0], b[1], yt), (a[0], a[1], yt), SAND, 1.0, (mid[0], mid[1], 0))
        m.quad((ai[0], ai[1], y), (bi[0], bi[1], y), (bi[0], bi[1], yt), (ai[0], ai[1], yt), SAND, 0.75, (-mid[0], -mid[1], 0))
        # the coping on top (bluestone, a little over both faces)
        ao = (cu + (a[0] - cu) * (r_out + 0.05) / r_out, cv + (a[1] - cv) * (r_out + 0.05) / r_out)
        bo = (cu + (b[0] - cu) * (r_out + 0.05) / r_out, cv + (b[1] - cv) * (r_out + 0.05) / r_out)
        rin = (r_out - thick - 0.05) / (r_out - thick)
        aii = (cu + (ai[0] - cu) * rin, cv + (ai[1] - cv) * rin)
        bii = (cu + (bi[0] - cu) * rin, cv + (bi[1] - cv) * rin)
        m.quad((ao[0], ao[1], yt + 0.12), (bo[0], bo[1], yt + 0.12), (bii[0], bii[1], yt + 0.12), (aii[0], aii[1], yt + 0.12), BLUE, 1.08, (0, 0, 1))
        m.quad((ao[0], ao[1], yt), (bo[0], bo[1], yt), (bo[0], bo[1], yt + 0.12), (ao[0], ao[1], yt + 0.12), BLUE, 1.0, (mid[0], mid[1], 0))
        m.quad((aii[0], aii[1], yt), (bii[0], bii[1], yt), (bii[0], bii[1], yt + 0.12), (aii[0], aii[1], yt + 0.12), BLUE, 0.8, (-mid[0], -mid[1], 0))
        m.quad((ao[0], ao[1], yt), (bo[0], bo[1], yt), (bii[0], bii[1], yt), (aii[0], aii[1], yt), BLUE, 0.5, (0, 0, -1))
        # the merlon's cheeks, where it stands over the crenels next to it
        if i % 2 == 0:
            for p_o, p_i, sg in ((a, ai, -1), (b, bi, 1)):
                tng = (-(p_o[1] - cv), p_o[0] - cu)
                m.quad((p_o[0], p_o[1], y + h + 0.12), (p_i[0], p_i[1], y + h + 0.12), (p_i[0], p_i[1], yt), (p_o[0], p_o[1], yt), SAND, 0.85,
                       (tng[0] * sg, tng[1] * sg, 0))
    # the walk inside, lead
    m.poly([(p[0], p[1], y + 0.02) for p in ri], METAL, 0.7, (0, 0, 1), col=LEAD)


# ------------------------------------------------------------------ the painted textures (packed in the glb)

FONT5 = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
    "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
    " ": ["00000"] * 7,
}


def paint_atlas():
    import numpy as np

    rng = np.random.default_rng(1520)
    A = np.zeros((SAT, SAT, 3), np.float32)
    C = {k: np.array(v, np.float32) for k, v in {
        "void": (0.035, 0.035, 0.04), "wood": (0.30, 0.20, 0.12), "wood2": (0.21, 0.135, 0.085), "iron": (0.09, 0.09, 0.1),
        "plaster": (0.78, 0.74, 0.64), "ink": (0.12, 0.11, 0.1), "board": (0.1, 0.15, 0.12), "chalk": (0.88, 0.86, 0.78),
        "gold": (0.8, 0.64, 0.28), "lamp": (0.2, 0.19, 0.15), "shutter": (0.2, 0.26, 0.2),
    }.items()}

    def cell(name):
        x, y, w, h = ACELL[name]
        return A[y:y + h, x:x + w]

    def noise(c, amt):
        c += (rng.random(c.shape[:2])[..., None] - 0.5) * amt

    def text(c, s, y0, col):
        w = len(s) * 6 - 1
        x0 = (c.shape[1] - w) // 2
        for i, ch in enumerate(s):
            for r, row in enumerate(FONT5[ch]):
                for k, b in enumerate(row):
                    if b == "1":
                        c[y0 + r, x0 + i * 6 + k] = col

    c = cell("void")
    yy = np.mgrid[0:32, 0:32][0]
    c[:] = C["void"] * (0.7 + 0.6 * (1 - yy / 32))[..., None]
    c = cell("lampglass")
    c[:] = C["lamp"]
    noise(c, 0.05)
    # the oak door: vertical planks, iron straps with nail heads, a wicket
    c = cell("door")
    h, w = c.shape[:2]
    c[:] = C["wood"]
    for x in range(0, w, 8):
        c[:, x] = C["wood2"] * 0.7
        c[:, x:x + 8] *= 0.9 + 0.2 * rng.random()
    c *= (0.88 + 0.24 * rng.random((h, w, 1))).astype(np.float32)
    for y in (14, 46, 78):
        c[y:y + 3] = C["iron"]
        for x in range(3, w, 7):
            c[y + 1, x] = C["iron"] * 3
    c[40:92, 34:36] = C["iron"]
    c[40:42, 34:58] = C["iron"]
    c[40:92, 56:58] = C["iron"]
    c[62:64, 38:40] = C["gold"] * 0.5
    noise(c, 0.03)
    # the painted name over the museum's ground floor (photo c. 1883): a name, so Dutch and French
    c = cell("band")
    c[:] = C["plaster"]
    noise(c, 0.06)
    text(c, "MUSEUM VAN OUDHEDEN", 3, C["ink"])
    text(c, "MUSEE D'ANTIQUITES", 13, C["ink"])
    c[rng.random(c.shape[:2]) < 0.05] *= 0.8
    # the board by the door, in plain English
    c = cell("board")
    c[:] = C["wood"]
    c[3:-3, 3:-3] = C["board"]
    noise(c, 0.04)
    text(c, "MUSEUM OF", 9, C["chalk"])
    text(c, "ANTIQUITIES", 21, C["chalk"])
    c[33, 34:94] = C["gold"]
    text(c, "OPEN 10 - 4", 42, C["gold"])
    # a closed shutter of boards (the dormers' lofts)
    c = cell("shutter")
    c[:] = C["shutter"]
    for y in range(0, 64, 9):
        c[y] = C["shutter"] * 0.5
    c *= (0.85 + 0.3 * rng.random((64, 64, 1))).astype(np.float32)
    return np.clip(A, 0, 1)


def paint_glass():
    """Leaded quarries (diamond panes 16 cm across) of old greenish glass, 0.64 m a repeat, 128 px."""
    import numpy as np

    n = 128
    rng = np.random.default_rng(1864)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    q = 32.0  # px per quarry
    a = (xx + yy) / q
    b = (xx - yy) / q
    ia, ib = np.floor(a), np.floor(b)
    tone = np.zeros((n, n), np.float32)
    for i in range(-8, 12):
        for j in range(-8, 12):
            tone[(ia == i) & (ib == j)] = rng.random()
    base = np.array((0.10, 0.13, 0.13), np.float32)
    img = base * (0.75 + 0.5 * tone)[..., None]
    # the sky in the old glass, a soft band across each pane
    fa, fb = a - ia, b - ib
    img += (np.exp(-((fa - 0.35) ** 2) / 0.02) * 0.06)[..., None] * np.array((0.8, 0.9, 1.0), np.float32)
    lead = (np.minimum(fa, 1 - fa) < 0.05) | (np.minimum(fb, 1 - fb) < 0.05)
    img[lead] = (0.2, 0.2, 0.19)
    img *= (0.94 + 0.12 * rng.random((n, n, 1))).astype(np.float32)
    return np.clip(img, 0, 1)


def packed_image(name, px):
    import numpy as np

    h, w = px.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.flipud(px)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def materials():
    cols = {"steen_tournai": (0.36, 0.38, 0.4), "steen_sand": (0.62, 0.54, 0.4), "steen_blue": (0.32, 0.34, 0.37), "steen_slate": (0.2, 0.22, 0.25),
"steen_brick": (0.45, 0.24, 0.18), "steen_metal": (1, 1, 1), "steen_glass": (0.1, 0.12, 0.12),
            "steen_atlas": (0.4, 0.35, 0.3), "steen_carve": (0.55, 0.5, 0.42)}
    images = {"steen_atlas": packed_image("steen_atlas", paint_atlas()), "steen_glass": packed_image("steen_glass", paint_glass())}
    images["steen_glass_lit"] = images["steen_glass"]
    cols["steen_glass_lit"] = cols["steen_glass"]
    for name in MATS:
        mt = bpy.data.materials.new(name)
        mt.diffuse_color = (*cols[name], 1)
        nt = mt.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*cols[name], 1)
        bsdf.inputs["Roughness"].default_value = 1.0
        if name in images:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = images[name]
            tex.interpolation = "Closest"
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])


def finish(m, name):
    """World-metre uv for every face without its own (along the face and up it, so the courses stay level and
    run on round a corner; roofs down their slope), a little shading with height, then the object."""
    for f in m.bm.faces:
        mt = f.material_index
        if mt not in FLAT:
            for lp in f.loops:
                c = lp[m.col]
                k = 0.86 + 0.14 * min(1.0, max(0.0, lp.vert.co.z / 16.0))
                lp[m.col] = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        if f in m.fixed:
            continue
        f.normal_update()
        nb = f.normal
        n = (nb.x, nb.z, -nb.y)  # game x, y, z
        T = TILE.get(mt, 1.0)
        if abs(n[1]) > 0.8:
            for lp in f.loops:
                co = lp.vert.co
                lp[m.uvl].uv = (co.x / T, co.y / T)
            continue
        tx, tz = n[2], -n[0]
        L = math.hypot(tx, tz) or 1.0
        t = (tx / L, 0.0, tz / L)
        # b = n x t: up the face (up the slope on a roof)
        b = (n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0])
        for lp in f.loops:
            co = lp.vert.co
            g = (co.x, co.z, -co.y)
            u = (g[0] * t[0] + g[2] * t[2]) / T
            v = (g[0] * b[0] + g[1] * b[1] + g[2] * b[2]) / T
            lp[m.uvl].uv = (u, -v)
    tris = sum(len(f.verts) - 2 for f in m.bm.faces)
    dump = os.environ.get("STEEN_DUMP")
    if dump:  # every face in world metres with its part and material, for tools/textures/../ overlap checks
        out = []
        for f, sec in m.secs:
            if not f.is_valid:
                continue
            f.normal_update()
            out.append({"s": sec, "m": MATS[f.material_index], "n": [f.normal.x, f.normal.z, -f.normal.y],
                        "p": [[v.co.x, v.co.z, -v.co.y] for v in f.verts]})
        json.dump(out, open(dump, "w"))
    me = bpy.data.meshes.new(name)
    m.bm.to_mesh(me)
    m.bm.free()
    for mn in MATS:
        me.materials.append(bpy.data.materials[mn])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ca = me.color_attributes
    ca.active_color = ca["Col"]
    ca.render_color_index = list(ca.keys()).index("Col")
    print(f"[build_steen] {name}: {tris} triangles, {len(m.features)} features to keep clear "
          f"({', '.join(f'{sum(1 for f in m.features if f[chr(107)] == k)} {k}s' for k in ('door', 'gate', 'window', 'stair', 'roof'))})")
    for dn, dx, dz in m.doors:
        print(f"[build_steen]   door {dn}: world x {dx}, z {dz}")
    return ob


BASE = 4.5  # the Tournai stone reaches this high (the 13th-century castle); sandstone of about 1520 above
WALLM = ((BASE, TOUR), (1e9, SAND))


def gable_rise(s0, s1, steps, roof, crown=0.9, margin=0.35):
    """The rise a stepped gable needs so every tread stands `margin` over the roof behind it; roof(s) is the
    roof's height over the gable's foot at s (0 or less off the roof)."""
    wd = (s1 - s0) / (2 * steps + 1)
    need = roof((s0 + s1) / 2) + margin - crown
    for k in range(steps):
        for s in (s0 + (k + 1) * wd, s1 - (k + 1) * wd):
            need = max(need, (roof(s) + margin) * (steps + 1) / (k + 1))
    return need


def saddle(sm, half, rise):
    return lambda s: rise * (1 - abs(s - sm) / half)


def _toward(a, b, dist):
    L = math.dist(a[:2], b[:2]) or 1.0
    t = min(1.0, dist / L)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def balustrade(m, a, b, out, h=1.0, pitch=0.3):
    """A bluestone balustrade from a to b ((u, v, y) each, y the floor): a plinth, turned balusters, a
    handrail; it may slope (the ramp)."""
    du, dv = b[0] - a[0], b[1] - a[1]
    L = math.hypot(du, dv)
    if L < 0.05:
        return
    d = (du / L, dv / L)
    lo = math.hypot(*out) or 1.0
    o = (out[0] / lo, out[1] / lo)

    def P(t, e, dy):
        return (a[0] + d[0] * t * L + o[0] * e, a[1] + d[1] * t * L + o[1] * e, a[2] + (b[2] - a[2]) * t + dy)

    for (e0, e1, y0, y1, sh) in ((-0.17, 0.17, 0.0, 0.22, 0.95), (-0.19, 0.19, h - 0.14, h, 1.05)):
        m.quad(P(0, e1, y0), P(1, e1, y0), P(1, e1, y1), P(0, e1, y1), BLUE, sh, (o[0], o[1], 0))
        m.quad(P(0, e0, y0), P(1, e0, y0), P(1, e0, y1), P(0, e0, y1), BLUE, sh * 0.85, (-o[0], -o[1], 0))
        m.quad(P(0, e0, y1), P(1, e0, y1), P(1, e1, y1), P(0, e1, y1), BLUE, sh * 1.08, (0, 0, 1))
        if y0 > 0:
            m.quad(P(0, e0, y0), P(1, e0, y0), P(1, e1, y0), P(0, e1, y0), BLUE, 0.5, (0, 0, -1))
    n = max(1, int(L / pitch))
    for k in range(n):
        t = (k + 0.5) / n
        c = P(t, 0, 0)
        yb = c[2] + 0.22
        yt = c[2] + h - 0.14
        hgt = yt - yb
        rings = [(0.055, yb), (0.085, yb + hgt * 0.35), (0.045, yb + hgt * 0.8), (0.06, yt)]
        for (r0, y0), (r1, y1) in zip(rings, rings[1:]):
            m.frustum(ngon(c[0], c[1], r0, 6), y0, ngon(c[0], c[1], r1, 6), y1, BLUE, 1.0)


def post(m, u, v, y, obelisk=True, w=0.36):
    m.box(u - w, u + w, v - w, v + w, y - 0.3, y + 1.3, BLUE, 1.0, "nsewt")
    m.box(u - w - 0.08, u + w + 0.08, v - w - 0.08, v + w + 0.08, y + 1.3, y + 1.44, BLUE, 1.08, "nsewtb")
    m.box(u - w - 0.06, u + w + 0.06, v - w - 0.06, v + w + 0.06, y - 0.3, y + 0.25, BLUE, 0.9, "nsewt")
    if obelisk:  # 1890: obelisks on the corner posts (the winged lions have gone)
        m.box(u - 0.22, u + 0.22, v - 0.22, v + 0.22, y + 1.44, y + 1.66, BLUE, 0.95, "nsewt")
        m.frustum(ngon(u, v, 0.2, 4, math.pi / 4), y + 1.66, ngon(u, v, 0.12, 4, math.pi / 4), y + 3.0, BLUE, 1.02)
        m.cone(ngon(u, v, 0.12, 4, math.pi / 4), y + 3.0, y + 3.3, BLUE, 1.02)


def slit(y0, y1, depth=0.55, splay=0.12):
    return Op(0, 0.07, y0, y1, depth=depth, back="void", frame=0, splay=splay)


# ------------------------------------------------------------------ the Steen

def build():
    city = json.load(open(CITY))
    fr = city["landmarks"]["steen"]["frame"]
    cx, cz = fr["c"]
    m = SM(cx, cz)
    LIT[0] = SM(cx, cz)
    L, Wd = fr["L"], fr["W"]
    U0, U1, V0, V1 = -L / 2, L / 2, -Wd / 2, Wd / 2  # -17, 17, -8.25, 8.25
    a0, a1, b0, b1 = U0 + 0.25, U1 - 0.25, V0 + 0.25, V1 - 0.25  # the wall faces
    RD = city["decor"]["steen_ramp"]
    TY = RD["h"]  # the courtyard and the gate passage stand this high
    NW0 = 8.0  # the north wing (1887-90) begins here
    FOOT = 0.9  # the walls stand on their battered foot from here

    hs0, hs1, hn0 = -10.6, 3.0, 3.0
    g0, g1, e0, e1 = -9.4, -3.6, -3.6, 8.0
    GY1, EY = 12.6 + TY, 10.4 + TY
    MY, BY = 13.5, 21.0
    bu0, bu1, bv0, bv1 = 10.4, 15.4, 3.2, b1
    t0x, t0z, t1x, t1z = RD["terrace"]
    tu1, tv1 = t1x - cx, t1z - cz  # 8.0, 14.25
    # the masses, for leaving out tower facets inside them
    MASSES = [(hs0, hs1, b0, -0.2, 12.5), (hn0, NW0, b0, -0.2, 11.0), (a0, -9.4, -3.0, 4.2, 12.0), (-14.4, -9.4, 4.2, b1, 10.6),
              (g0, g1, -0.2, b1, GY1), (e0, e1, -0.2, b1, EY), (NW0, a1, b0, 3.2, MY), (bu0, bu1, bv0, bv1, BY),
              (a0, -13.0, b1, V1 + 5.9, TY + 8.6), (NW0, a1, b1, tv1 + 0.4, TY + 4.8), (bu1, a1, bv0, b1, TY + 4.8)]

    def inside(pt, pad=0.05):
        """How high the block stands over a point (None: open ground)."""
        tops = [t for u0, u1, v0, v1, t in MASSES if u0 + pad < pt[0] < u1 - pad and v0 + pad < pt[1] < v1 - pad]
        return max(tops) if tops else None

    LNM = ((TY + 1.0, TOUR), (1e9, SAND))  # the courtyard front: the Tournai stone shows only a metre over the courtyard

    RW = W((0, b0), (1, 0), (0, -1))  # the river front
    LN = W((0, b1), (1, 0), (0, 1))  # the lane (courtyard) front

    # ================================================================ the river range, south part: the great hall
    m.sec = "the river range, south part"
    wall(m, RW, rect(hs0, hs1, FOOT, 12.5), ops=[
        *[Op(u, 0.07, 1.8, 3.4, depth=0.55, back="void", frame=0, splay=0.12) for u in (-8.0, -3.8, 0.6)],
        *[Op(u, 0.36, 5.0, 6.2, depth=0.35, frame=0.12, bars=1) for u in (-6.5, -2.3, 2.1)],
        *[Op(u, 0.46, 7.6, 8.6, head="circle", depth=0.4, frame=0.14, bars=1) for u in (-6.0, -1.4)],
        *[Op(u, 0.07, 9.4, 11.2, depth=0.55, back="void", frame=0, splay=0.12) for u in (-9.5, -3.9, 0.4)],
    ])
    batter(m, RW, hs0, hs1, ends="r")
    course(m, RW, hs0, hs1, BASE)
    for uu in (-8.6, -4.6, -0.6, 2.4):
        anchor(m, RW, uu, 10.3, "X")
        anchor(m, RW, uu + 0.3, 6.9, "I" if uu < 0 else "S", 0.6)
    machicolation(m, RW, hs0, hs1, 12.5)
    wall(m, W((hs0, 0), (0, 1), (-1, 0)), rect(b0, -5.9, FOOT, 12.5))
    rrise = 6.4
    rv0 = b0 + 0.6
    roof_gable(m, hs0, hs1, rv0, -0.2, 12.5, rrise, along="u", over=0.0, end_over=(0.0, 0.0))
    wall(m, W((hs0, 0), (0, 1), (-1, 0)), [(rv0, 12.5), (-0.2, 12.5), ((rv0 - 0.2) / 2, 12.5 + rrise)], mats=((1e9, SAND),))
    for uu in (-6.8, -0.8):
        dormer(m, RW, uu, -0.6, 12.5, -((rv0 - 0.2) / 2 - b0), 12.5 + rrise, 13.7, 1.2, 1.7, stepped=True)
    GW = W((hs1, 0), (0, 1), (1, 0))
    gr = gable_rise(b0, -0.2, 4, saddle((rv0 - 0.2) / 2, (-0.2 - rv0) / 2, rrise))
    stepped_gable(m, GW, b0, -0.2, 12.5, gr, steps=4, wall_from=10.2, kneel=(False, True), ops=[Op(-4.1, 0.3, 13.3, 14.3, frame=0.1, bars=1, depth=0.3)], mats=((1e9, SAND),))

    # ================================================================ the river range, north part: a cross window, the corbelled turret
    m.sec = "the river range, north part"
    wall(m, RW, rect(hn0, NW0, FOOT, 11.0), ops=[
        *[Op(u, 0.3, 1.9, 2.9, depth=0.35, frame=0.1, bars=1) for u in (4.2, 7.3)],
        Op(6.9, 0.78, 5.1, 8.3, depth=0.35, frame=0.14, mull=1, transom=7.1, bars=1, hood=True),
    ])
    batter(m, RW, hn0, NW0, ends="")
    course(m, RW, hn0, NW0, BASE)
    course(m, RW, hn0, NW0, 11.0, h=0.28, proj=0.16)
    anchor(m, RW, 5.9, 9.6, "X")
    anchor(m, RW, 7.9, 9.6, "X")
    trise = 6.2
    roof_gable(m, hn0, NW0, b0, -0.2, 11.0, trise, along="u", over=0.35, end_over=(0.0, 0.0))
    dormer(m, RW, 5.5, 0.35, 11.0 - 0.35 * trise / 3.9, -((b0 - 0.2) / 2 - b0), 11.0 + trise, 12.4, 1.4, 1.9)
    downpipe(m, RW, 3.35, 11.0 - 0.35 * trise / 3.9 - 0.1)
    # the corbelled turret: a conical corbel of stepped rings, slits, a slate cone
    tcu, tcv, tr = 4.4, b0 - 0.35, 1.05
    for r_, y_ in ((0.3, 4.6), (0.55, 5.0), (0.8, 5.4), (tr, 5.8)):
        m.frustum(ngon(tcu, tcv + 0.3, r_ * 0.55, 12), y_ - 0.4, ngon(tcu, tcv + 0.3 * (1 - r_ / tr), r_, 12), y_, BLUE, 0.9,
                  skip=lambda p: p[1] > b0 - 0.02)
    tower(m, tcu, tcv, tr, 9.8, sides=12, y0=5.8, base_to=0.0, batter_out=0.0, skip=lambda p: 1e9 if p[1] > b0 - 0.05 else None, mats=((1e9, SAND),),
          ops=[(-math.pi / 2, slit(6.6, 8.2, 0.35, 0.08)), (-math.pi / 2 - 1.0, slit(6.8, 8.0, 0.35, 0.08)), (-math.pi / 2 + 1.0, slit(6.8, 8.0, 0.35, 0.08))])
    m.prism(ngon(tcu, tcv, tr + 0.12, 12), 9.5, 9.8, BLUE, 1.0, top=False)
    cone_roof(m, tcu, tcv, tr + 0.3, 9.8, 13.4, sides=12, kick=0.4)
    finial(m, tcu, tcv, 13.4, 1.0)

    # ================================================================ the big three-quarter round tower by the river
    m.sec = "the big three-quarter round tower by the river"
    T1 = (-13.55, -4.8, 3.2)
    tower(m, *T1, 16.2, sides=20, skip=inside, ops=[
        (math.pi, Op(0, 0.4, 1.0, 3.2, head="round", depth=0.4, back="door", frame=0.1, steps=3, name="door of the big tower by the river")),
        (math.pi, slit(6.0, 7.6, 0.6)),
        (-math.pi / 2, slit(2.4, 4.0, 0.6)),
        (-math.pi * 0.75, Op(0, 0.3, 8.6, 9.8, depth=0.4, frame=0.1, bars=1)),
        (-math.pi / 2, Op(0, 0.3, 11.6, 12.8, depth=0.4, frame=0.1, bars=1)),
        (math.pi * 0.88, slit(12.0, 13.6, 0.6)),
        (-math.pi * 0.62, slit(5.4, 6.9, 0.6)),
    ])
    tower_rim(m, *T1, 16.2, sides=20, skip=lambda p: inside(p, 0.3))
    round_parapet(m, T1[0], T1[1], T1[2] + 0.45, 16.2, sides=20)
    cone_roof(m, T1[0], T1[1], T1[2] - 0.1, 17.1, 25.4, sides=20, kick=0.5)
    finial(m, T1[0], T1[1], 25.4, 2.0, vane=True)

    # ================================================================ the south range: a blind wall, the stepped gable over the little fish market
    m.sec = "the south range"
    SW = W((a0, 0), (0, 1), (-1, 0))
    sr_rise = 6.8
    gr = gable_rise(-3.0, 4.2, 4, saddle(0.6, 3.6, sr_rise))
    stepped_gable(m, SW, -3.0, 4.2, 12.0, gr, steps=4, wall_from=FOOT, ops=[
        *[Op(v, 0.07, 1.8, 3.4, depth=0.6, back="void", frame=0, splay=0.12) for v in (-1.0, 2.4)],
        Op(0.6, 0.3, 6.3, 7.3, depth=0.4, frame=0.1, bars=1),
        Op(0.6, 0.55, 9.0, 10.9, head="pointed", depth=0.4, frame=0.13, mull=1, bars=1),
        *[Op(v, 0.26, 13.3, 14.2, depth=0.35, frame=0.09, bars=1) for v in (-1.8, 0.6, 3.0)],
    ])
    batter(m, SW, -3.0, 4.2, ends="")
    course(m, SW, -3.0, 4.2, BASE)
    for vv in (-2.3, 3.5):
        anchor(m, SW, vv, 8.2, "S", 0.7)
        anchor(m, SW, vv, 11.4, "S", 0.7)
    roof_gable(m, a0 + 0.55, -9.4, -3.0, 4.2, 12.0, sr_rise, along="u", over=0.3, end_over=(0.0, 0.0))
    wall(m, W((-9.4, 0), (0, 1), (1, 0)), [(-3.0, 12.0), (4.2, 12.0), (0.6, 12.0 + sr_rise)], mats=((1e9, SAND),))
    for vv, sg in ((-3.0, -1), (4.2, 1)):
        course(m, W((0, vv), (1, 0), (0, sg)), a0 + 0.3, -9.4, 12.0, h=0.26, proj=0.14)
    wall(m, W((0, -3.0), (1, 0), (0, -1)), rect(a0, -16.05, FOOT, 12.0))
    wall(m, W((0, 4.2), (1, 0), (0, 1)), rect(-12.2, -9.4, 10.4, 12.0), mats=((1e9, SAND),))
    # the link to the gatehouse, lead-topped, a low parapet
    wall(m, LN, rect(-13.0, g0, TY - 0.1, 10.6), ops=[Op(-11.2, 0.3, TY + 2.0, TY + 3.2, depth=0.3, frame=0.1, bars=1)], mats=LNM)
    course(m, LN, -13.0, g0, TY + 1.0, ends="")
    m.box(-14.4, g0, 4.2, b1, 10.5, 10.6, METAL, 0.7, "t", col=LEAD)
    wbox(m, LN, -13.0, g0, -0.35, 0.0, 10.6, 11.3, SAND, 1.0, "oi")
    wbox(m, LN, -13.05, g0, -0.4, 0.05, 11.3, 11.42, BLUE, 1.05, "oitdl")

    # ================================================================ the round tower at the gate's west side
    m.sec = "the round tower at the gate's west side"
    T2 = (-14.15, 5.4, 2.6)
    tower(m, *T2, 14.0 + TY, sides=16, skip=inside, ops=[
        (math.pi, Op(0, 0.4, 1.0, 3.0, head="round", depth=0.4, back="door", frame=0.1, steps=3, name="door of the round tower by the gate")),
        (math.pi, slit(5.6, 7.0, 0.6, 0.1)),
        (math.pi * 0.8, Op(0, 0.3, 9.2, 10.4, depth=0.4, frame=0.1, bars=1)),
        (math.pi * 1.2, slit(3.0, 4.4, 0.6, 0.1)),
        (math.pi * 0.62, slit(12.0, 13.4, 0.6, 0.1)),
    ])
    tower_rim(m, *T2, 14.0 + TY, sides=16, skip=lambda p: inside(p, 0.3))
    round_parapet(m, T2[0], T2[1], T2[2] + 0.45, 14.0 + TY, sides=16)
    cone_roof(m, T2[0], T2[1], T2[2] - 0.1, 14.9 + TY, 21.4 + TY, sides=16, kick=0.45)
    finial(m, T2[0], T2[1], 21.4 + TY, 1.6)

    # ================================================================ Charles V's gatehouse on the courtyard
    m.sec = "Charles V's gatehouse on the courtyard"
    gc = -6.5
    DHW, DH = 1.25, 3.6
    door = Op(gc, DHW, TY, TY + DH, head="four", depth=0.0, back=None, frame=0.22, proj=0.09, sill=False, name="museum door (Charles V's gate, on the courtyard)",
              real="the gatehouse, the museum's door")
    m.door("Steen, museum door (Charles V's gate, on the courtyard)", gc, V1)
    gr = max(8.0, gable_rise(g0, g1, 5, saddle(gc, (g1 - g0) / 2, 5.6), crown=1.0))
    gh_ops = [
        door,
        *[Op(s, 0.35, TY + 1.4, TY + 2.6, depth=0.15, frame=0.1, bars=1, real=f"the gatehouse, the small window {side} of the door")
          for s, side in ((g0 + 0.8, "south"), (g1 - 0.8, "north"))],
        *[Op(s, 0.4, TY + 5.4, TY + 7.6, depth=0.15, frame=0.12, bars=1) for s in (g0 + 0.8, g1 - 0.8)],
        *[Op(s, 0.4, TY + 8.6, TY + 10.6, depth=0.3, frame=0.12, bars=1) for s in (g0 + 0.8, g1 - 0.8)],
        Op(gc, 0.5, GY1 + 1.8, GY1 + 4.0, head="pointed", depth=0.35, frame=0.13, mull=1, bars=1),
    ]
    stepped_gable(m, LN, g0, g1, GY1, gr, steps=5, crown=1.0, wall_from=TY - 0.1, ops=gh_ops, mats=LNM)
    course(m, LN, g0, g1, GY1, h=0.24, proj=0.14)
    wall(m, W((g0, 0), (0, 1), (-1, 0)), rect(-0.2, b1, 10.2, GY1), mats=((1e9, SAND),))
    wall(m, W((g1, 0), (0, 1), (1, 0)), rect(-0.2, b1, EY - 0.4, GY1), mats=((1e9, SAND),))
    roof_gable(m, g0, g1, -0.2, b1 - 0.55, GY1, 5.6, along="v", over=0.25, end_over=(0.3, 0.0))
    wall(m, W((0, -0.2), (1, 0), (0, -1)), [(g0, GY1), (g1, GY1), (gc, GY1 + 5.6)], mats=((1e9, SAND),))
    # the portal: short thick columns with tall capitals, the string course, the corbels carrying the oriel
    for sg in (-1, 1):
        cu = gc + sg * 1.6
        m.prism(ngon(cu, b1 + 0.3, 0.38, 8, math.pi / 8), TY - 0.2, TY + 0.35, BLUE, 0.9)
        m.prism(ngon(cu, b1 + 0.3, 0.28, 8, math.pi / 8), TY + 0.35, TY + 2.6, BLUE, 1.0, top=False)
        m.frustum(ngon(cu, b1 + 0.3, 0.3, 8, math.pi / 8), TY + 2.6, ngon(cu, b1 + 0.3, 0.44, 8, math.pi / 8), TY + 3.05, BLUE, 1.05)
        m.prism(ngon(cu, b1 + 0.3, 0.46, 8, math.pi / 8), TY + 3.05, TY + 3.3, BLUE, 1.08)
    wbox(m, LN, gc - 2.1, gc + 2.1, 0.0, 0.36, TY + 3.3, TY + 3.6, BLUE, 1.05)
    for s in (gc - 1.6, gc + 1.6):
        for (e1_, ya, yb) in ((0.3, TY + 3.6, TY + 3.8), (0.5, TY + 3.8, TY + 4.0), (0.7, TY + 4.0, TY + 4.2)):
            wbox(m, LN, s - 0.25, s + 0.25, 0.0, e1_, ya, yb, BLUE, 0.92)
    # the three-sided oriel: carved panels (Charles V's arms, the Burgundian saltire) under barred windows, a slate cap
    oy0, oy1, ob = TY + 4.2, TY + 10.6, b1
    op_ = [(gc - 1.75, ob), (gc - 0.95, ob + 0.85), (gc + 0.95, ob + 0.85), (gc + 1.75, ob)]
    m.poly([(q[0], q[1], oy0) for q in op_], SAND, 0.55, (0, 0, -1))
    for i in range(3):
        pa, pb = op_[i], op_[i + 1]
        du, dv = pb[0] - pa[0], pb[1] - pa[1]
        Ln = math.hypot(du, dv)
        d = (du / Ln, dv / Ln)
        o = (d[1], -d[0])
        if o[1] < 0:
            o = (-o[0], -o[1])
        ow = W(pa, d, o)
        wall(m, ow, rect(0, Ln, oy0, oy1), mats=((1e9, SAND),), ops=[
            Op(Ln / 2, Ln / 2 - 0.12, TY + 4.4, TY + 5.7, depth=0.07, back="carve:" + ("arms" if i == 1 else "saltire_n"), frame=0.06, proj=0.04, frame_all=True),
            Op(Ln / 2, Ln / 2 - 0.16, TY + 6.2, TY + 10.0, depth=0.14, frame=0.1, proj=0.05, mull=1 if i == 1 else 0, transom=TY + 7.6 if i == 1 else None, bars=1),
        ])
        wbox(m, ow, -0.04, Ln + 0.04, 0.0, 0.14, TY + 5.85, TY + 6.02, BLUE, 1.08, "otd")
        wbox(m, ow, -0.04, Ln + 0.04, 0.0, 0.2, TY + 10.4, TY + 10.6, BLUE, 1.08, "otd")
    m.cone(op_ + [(gc, ob - 0.3)], oy1, TY + 12.3, SLATE, 1.0, apex=(gc, ob + 0.35))
    finial(m, gc, ob + 0.35, TY + 12.3, 0.9)
    # quoins on the gatehouse's corners (long and short bluestone)
    boxes = [(op.span()[0] - op.frame - 0.03, op.span()[1] + op.frame + 0.03, op.y0 - 0.2, op.span()[3] + op.frame + 0.05) for op in gh_ops]
    for qs, sg in ((g0, 1), (g1, -1)):
        y, k = TY + 1.1, 0
        while y + 0.36 < GY1 - 0.3:
            ln = 0.6 if k % 2 == 0 else 0.34
            a_, b_ = (qs, qs + ln) if sg > 0 else (qs - ln, qs)
            if not any(a_ < bx1 and b_ > bx0 and y < by1 and y + 0.34 > by0 for bx0, bx1, by0, by1 in boxes):
                wbox(m, LN, a_, b_, 0.0, 0.07, y, y + 0.34, BLUE, 1.08, "o" + ("r" if sg > 0 else "l") + "td")
            y += 0.38
            k += 1
    for s in (g0 + 2.2, g1 - 2.2):
        anchor(m, LN, s, GY1 + 1.2, "X", 0.6)

    # ================================================================ the prison range on the courtyard: the museum's hall
    m.sec = "the prison range on the courtyard"
    pr_ops = [
        *[Op(u, 0.7, TY + 1.2, TY + 3.9, depth=0.15, frame=0.14, mull=1 if k == 2 else 0, transom=TY + 2.6 if k == 2 else None, bars=1,
             real=f"the prison range, the hall of antiquities, window {k + 1} on the courtyard")
          for k, u in enumerate((-1.9, 1.3, 4.5))],
        *[Op(u, 0.7, TY + 5.8, TY + 8.7, depth=0.15, frame=0.14, bars=1, hood=True) for u in (-1.9, 1.3, 4.5)],
        Op(1.8, 3.4, TY + 4.35, TY + 5.4, depth=0.03, back="band", frame=0, sill=False),
    ]
    wall(m, LN, rect(e0, e1, TY - 0.1, EY), ops=pr_ops, mats=LNM)
    course(m, LN, g0, e1, TY + 1.0, ops=gh_ops + pr_ops, ends="")
    course(m, LN, e0, e1, EY, h=0.26, proj=0.16)
    wall(m, W((e1, 0), (0, 1), (1, 0)), rect(bv0, b1, 6.9, EY), ops=[Op(5.6, 0.3, 8.2, 9.4, depth=0.3, frame=0.1, bars=1)], mats=((1e9, SAND),))
    roof_gable(m, e0, e1, -0.2, b1, EY, 6.0, along="u", over=0.3, end_over=(0.0, 0.0), skipside=(-1,))
    wall(m, W((e1, 0), (0, 1), (1, 0)), [(-0.2, EY), (b1, EY), ((b1 - 0.2) / 2, EY + 6.0)], mats=((1e9, SAND),))
    pe = EY - 0.3 * 6.0 / 4.1
    dormer(m, LN, 1.3, 0.3, pe, -(b1 - (b1 - 0.2) / 2), EY + 6.0, EY + 0.9, 1.4, 1.9)
    dormer(m, LN, 5.6, 0.3, pe, -(b1 - (b1 - 0.2) / 2), EY + 6.0, EY + 0.9, 1.1, 1.6)
    for uu in (-0.3, 2.9, 6.1):
        anchor(m, LN, uu, TY + 9.3, "X", 0.6)
    anchor(m, LN, 6.1, TY + 4.9, "I", 0.5)
    downpipe(m, LN, -3.1, pe - 0.1, TY)
    downpipe(m, LN, 7.6, pe - 0.1, TY)
    # the board by the door
    bs0, bs1 = -0.9, 0.3
    wbox(m, LN, bs0, bs1, 0.0, 0.07, TY + 1.5, TY + 2.1, METAL, 1.0, "lrtd", col=(0.3, 0.2, 0.12))
    m.poly([LN.P(bs0, 0.07, TY + 1.5), LN.P(bs1, 0.07, TY + 1.5), LN.P(bs1, 0.07, TY + 2.1), LN.P(bs0, 0.07, TY + 2.1)],
           ATLAS, 1.0, (0, 1, 0), uvs=cell_uvs([(0, 0), (1, 0), (1, 1), (0, 1)], "board", "atlas"))

    # ================================================================ chimneys
    m.sec = "chimneys"
    chimney(m, -14.2, 0.6, 16.0, 20.4)
    chimney(m, -6.5, 2.2, 18.0, 21.8)
    chimney(m, 2.2, 3.9, 16.0, 20.0)
    chimney(m, -4.0, -3.8, 17.0, 20.2, 0.7, 0.5, pots=1)
    chimney(m, 10.8, -2.4, MY + 4.0, MY + 8.6)

    # ================================================================ the Steenpoort: the gate block over the passage
    m.sec = "the Steenpoort"
    pu0, pu1 = a0, -13.0
    pv0, pv1 = b1, V1 + 5.9  # the block: v 8.0..14.15 (the passage v 8.45..12.95)
    pc, phw, ph = (V1 + V1 + 4.9) / 2, 2.25, 5.6
    PT = TY + 8.6
    OW = W((pu0, 0), (0, 1), (-1, 0))
    IW = W((pu1, 0), (0, 1), (1, 0))
    gate = dict(head="pointed", rise=2.8, back=None, frame=0.45, proj=0.08, blocks=True, rev=TOUR, sill=False, n=7)
    ow_ops = [
        Op(pc, phw, TY, TY + ph, depth=pu1 - pu0, name="Steenpoort, from the ramp's landing", **gate),
        Op(pc, 0.45, TY + 6.3, TY + 7.55, head="round", depth=0.24, back="carve:semini", frame=0.11, proj=0.06),
    ]
    wall(m, OW, rect(pv0, pv1, FOOT, PT), ops=ow_ops)
    iw_ops = [Op(pc, phw, TY, TY + ph, depth=0.0, name="Steenpoort, from the courtyard", **gate)]
    wall(m, IW, rect(pv0, pv1, TY - 0.1, PT), ops=iw_ops)
    batter(m, OW, pv0, pv1, ends="r")
    course(m, OW, pv0, pv1, BASE, ops=ow_ops)
    course(m, IW, pv0, pv1, BASE, ops=iw_ops)
    wall(m, W((0, pv1), (1, 0), (0, 1)), rect(pu0, pu1, FOOT, PT))
    m.box(pu0, pu1, pv0, pv1, PT - 0.1, PT, METAL, 0.7, "t", col=LEAD)
    # 1889: a false parapet on corbels instead of the saddle roof, on both faces
    machicolation(m, OW, pv0, pv1, PT, proj=0.45, h=0.9, merlon=0.7, step=1.2, ch=0.75)
    machicolation(m, IW, pv0, pv1, PT, proj=0.45, h=0.9, merlon=0.7, step=1.2, ch=0.75)
    # the lantern on its bracket on the outer face, east of the arch (steenlife.ts lights it at night)
    lv = V1 + 5.35
    m.box(a0 - 0.7, a0, lv - 0.03, lv + 0.03, TY + 4.95, TY + 5.02, METAL, 1.0, "nsewtb", col=IRON)
    m.box(a0 - 0.7, a0 - 0.64, lv - 0.03, lv + 0.03, TY + 4.6, TY + 4.95, METAL, 1.0, "nsew", col=IRON)
    m.box(a0 - 0.2, a0, lv - 0.1, lv + 0.1, TY + 4.8, TY + 5.1, METAL, 1.0, "nsewtb", col=IRON)
    for (u_, v_) in ((a0 - 0.84, lv - 0.17), (a0 - 0.5, lv - 0.17), (a0 - 0.84, lv + 0.17), (a0 - 0.5, lv + 0.17)):
        m.box(u_ - 0.015, u_ + 0.015, v_ - 0.015, v_ + 0.015, TY + 4.1, TY + 4.55, METAL, 1.0, "nsew", col=IRON)
    for u0_, u1_, v0_, v1_, out in ((a0 - 0.84, a0 - 0.5, lv - 0.16, lv - 0.16, (0, -1, 0)), (a0 - 0.84, a0 - 0.5, lv + 0.16, lv + 0.16, (0, 1, 0)),
                                    (a0 - 0.83, a0 - 0.83, lv - 0.17, lv + 0.17, (-1, 0, 0)), (a0 - 0.51, a0 - 0.51, lv - 0.17, lv + 0.17, (1, 0, 0))):
        m.poly([(u0_, v0_, TY + 4.1), (u1_, v1_, TY + 4.1), (u1_, v1_, TY + 4.55), (u0_, v0_, TY + 4.55)], ATLAS, 1.0, out,
               uvs=cell_uvs([(0, 0), (1, 0), (1, 1), (0, 1)], "lampglass", "atlas"))
    m.cone(ngon(a0 - 0.67, lv, 0.26, 4, math.pi / 4), TY + 4.55, TY + 4.8, METAL, 1.0, col=IRON)
    m.box(a0 - 0.8, a0 - 0.54, lv - 0.13, lv + 0.13, TY + 4.02, TY + 4.1, METAL, 1.0, "nsewtb", col=IRON)
    # the east tower of the gate: battlements, a flat lead top
    T3 = (-14.95, V1 + 4.9 + 1.95, 1.9)
    tower(m, *T3, 11.0 + TY, sides=12, skip=inside, ops=[
        (math.pi, slit(3.0, 4.4, 0.5, 0.1)),
        (math.pi / 2, slit(6.0, 7.4, 0.5, 0.1)),
        (math.pi * 0.75, Op(0, 0.28, 8.4, 9.4, depth=0.4, frame=0.09, bars=1)),
        (0.2, slit(5.0, 6.4, 0.5, 0.1)),
    ])
    tower_rim(m, *T3, 11.0 + TY, sides=12, corbel=0.4, skip=lambda p: inside(p, 0.3))
    round_parapet(m, T3[0], T3[1], T3[2] + 0.4, 11.0 + TY, sides=12, merlon=0.8)

    # ================================================================ the courtyard on its mound (1887-90)
    m.sec = "the courtyard on its mound"
    cu0 = -13.0
    CW = W((0, tv1 + 0.4), (1, 0), (0, 1))
    wall(m, CW, rect(cu0, tu1, -0.3, TY), mats=((1e9, TOUR),))
    batter(m, CW, cu0, tu1, y_top=0.7, out=0.25, ends="")
    m.box(cu0, tu1, V1, tv1 + 0.4, TY - 0.05, TY, BLUE, 1.0, "t")
    # the passage's floor under the Steenpoort, from where the ramp's floor ends (its first point) to the courtyard's
    # (Steve 2026-09-27: without it the passage was 3 m of open air over the ground)
    m.box(RD["line"][0][0] - cx, cu0, pc - phw, pc + phw, TY - 0.05, TY, BLUE, 1.0, "t")
    wbox(m, CW, cu0, tu1, 0.0, 0.08, TY - 0.2, TY + 0.03, BLUE, 1.05, "otd")
    balustrade(m, (cu0 + 0.8, tv1 + 0.2, TY), (tu1 - 0.9, tv1 + 0.2, TY), (0, 1))
    for u in (cu0 + 0.4, -5.0, 2.0, tu1 - 0.5):
        post(m, u, tv1 + 0.2, TY, obelisk=False, w=0.3)

    # ================================================================ the ramp: the landing outside the Steenpoort, the curve, the run down
    m.sec = "the ramp"
    line = [(x - cx, z - cz, y) for x, z, y in RD["line"]]
    half = RD["half"]

    def offs(i, dd):
        u, v, _ = line[i]
        un, vn, _ = line[min(i + 1, len(line) - 1)]
        up, vp, _ = line[max(i - 1, 0)]
        tu, tv = un - up, vn - vp
        ln = math.hypot(tu, tv) or 1.0
        return (u - tv / ln * dd, v + tu / ln * dd)

    Wr = half + 0.35
    for i in range(len(line) - 1):
        ya, yb = line[i][2], line[i + 1][2]
        la, lb = offs(i, Wr), offs(i + 1, Wr)
        ra, rb = offs(i, -Wr), offs(i + 1, -Wr)
        m.quad((la[0], la[1], ya), (ra[0], ra[1], ya), (rb[0], rb[1], yb), (lb[0], lb[1], yb), BLUE, 0.95, (0, 0, 1))
        if line[i][0] > a0 - 0.05:  # inside the gate: only the floor
            continue
        for p0, p1 in ((la, lb), (ra, rb)):
            if ya > 0.02 or yb > 0.02:
                c = ((p0[0] + p1[0]) / 2 - (line[i][0] + line[i + 1][0]) / 2, (p0[1] + p1[1]) / 2 - (line[i][1] + line[i + 1][1]) / 2)
                m.quad((p0[0], p0[1], -0.3), (p1[0], p1[1], -0.3), (p1[0], p1[1], yb), (p0[0], p0[1], ya), TOUR, 0.8, (c[0], c[1], 0))
    n_land = max(i for i, p in enumerate(line) if p[2] >= TY - 1e-6)
    i0 = next(i for i, p in enumerate(line) if p[0] <= a0 - 0.8)
    for sg in (1, -1):
        pts = [(offs(i, sg * (half + 0.2))[0], offs(i, sg * (half + 0.2))[1], line[i][2]) for i in range(len(line))]
        for s0_, s1_ in ((i0, n_land), (n_land, len(line) - 1)):
            for i in range(s0_, s1_):
                a_, b_ = pts[i], pts[i + 1]
                if i == s0_:
                    a_ = _toward(a_, b_, 0.45)
                if i == s1_ - 1:
                    b_ = _toward(b_, a_, 0.45)
                balustrade(m, a_, b_, (pts[i][0] - line[i][0], pts[i][1] - line[i][1]))
    for i in (n_land, len(line) - 1):
        for sg in (1, -1):
            u, v = offs(i, sg * (half + 0.2))
            post(m, u, v, line[i][2], obelisk=(i == len(line) - 1))
    for sg in (1, -1):
        u, v = offs(i0, sg * (half + 0.2))
        post(m, line[i0][0] + 0.35, v, TY, obelisk=False)

    # ================================================================ the north wing of 1887-90
    m.sec = "the north wing of 1887-90"
    NWW = RW
    wall(m, NWW, rect(NW0, 13.2, FOOT, MY), ops=[
        *[Op(u, 0.7, 5.2, 8.6, head="pointed", depth=0.35, frame=0.13, mull=1, transom=7.0) for u in (9.6, 11.9)],
        *[Op(u, 0.7, 9.6, 12.4, head="pointed", depth=0.35, frame=0.13, mull=1) for u in (9.6, 11.9)],
        *[Op(u, 0.3, 1.8, 3.0, depth=0.35, frame=0.1, bars=1) for u in (9.6, 11.9)],
    ])
    batter(m, NWW, NW0, 13.2, ends="")
    course(m, NWW, NW0, 13.2, BASE)
    course(m, NWW, NW0, 13.2, MY, h=0.3, proj=0.18)
    mr = 7.4
    roof_gable(m, NW0, a1, b0, 3.2, MY, mr, along="u", over=0.3, end_over=(0.0, 0.0))
    NN = W((a1, 0), (0, 1), (1, 0))
    gr = gable_rise(b0, 3.2, 5, saddle((b0 + 3.2) / 2, (3.2 - b0) / 2, mr), crown=1.0)
    stepped_gable(m, NN, b0, 3.2, MY, gr, steps=5, crown=1.0, wall_from=FOOT, ops=[
        *[Op(v, 0.7, 5.0, 8.6, head="pointed", depth=0.35, frame=0.13, mull=1, transom=6.9) for v in (-3.0, 1.2)],
        *[Op(v, 0.7, 9.6, 12.6, head="pointed", depth=0.35, frame=0.13, mull=1) for v in (-3.0, 1.2)],
        Op((b0 + 3.2) / 2, 0.75, MY + 1.4, MY + 4.4, head="pointed", depth=0.35, frame=0.14, mull=2),
    ])
    batter(m, NN, -3.8, 3.2, ends="r")
    course(m, NN, -3.8, 3.2, BASE)
    SNW = W((NW0, 0), (0, 1), (-1, 0))
    stepped_gable(m, SNW, b0, 3.2, MY, gr, steps=5, crown=1.0, wall_from=10.0,
                  ops=[Op((b0 + 3.2) / 2, 0.55, MY + 1.6, MY + 3.8, head="pointed", depth=0.35, frame=0.12, mull=1)])
    wall(m, W((0, 3.2), (1, 0), (0, 1)), rect(NW0, a1, 6.9, MY), ops=[Op(15.9, 0.28, 8.6, 10.0, depth=0.3, frame=0.09, bars=1)], mats=((1e9, SAND),))
    # the tall octagonal tower at the corner by the river: courses, windows, a machicolated gallery, the spire
    ou, ov, orr = a1 - 1.9, b0 + 1.9, 2.35
    rot8 = math.pi / 8
    tower(m, ou, ov, orr, 23.0, sides=8, rot=rot8, skip=lambda p: inside(p, 0.4), ops=[
        *[(ang, Op(0, 0.42, y0, y0 + 2.4, head="pointed", depth=0.35, frame=0.12, mull=1)) for ang in (0.2, -math.pi / 2 + 0.2, -math.pi / 4 + 0.2)
          for y0 in (6.0, 11.2, 16.4)],
        (-math.pi / 4 + 0.2, slit(2.0, 3.6, 0.5, 0.1)),
    ])
    for yc in (10.0, 15.5, 19.8):
        m.prism(ngon(ou, ov, orr + 0.1, 8, rot8), yc - 0.16, yc, BLUE, 1.05, top=True)
    tower_rim(m, ou, ov, orr, 23.0, sides=8, corbel=0.45, rot=rot8)
    ro = ngon(ou, ov, orr + 0.45, 8, rot8)
    for k in range(8):
        a_, b_ = ro[k], ro[(k + 1) % 8]
        L_ = math.hypot(b_[0] - a_[0], b_[1] - a_[1])
        d_ = ((b_[0] - a_[0]) / L_, (b_[1] - a_[1]) / L_)
        mid_ = ((a_[0] + b_[0]) / 2 - ou, (a_[1] + b_[1]) / 2 - ov)
        lm = math.hypot(*mid_)
        w_ = W(a_, d_, (mid_[0] / lm, mid_[1] / lm))
        wall(m, w_, rect(0, L_, 23.0, 24.2), mats=((1e9, SAND),))
        wbox(m, w_, 0.0, L_, -0.1, 0.04, 24.2, 24.34, BLUE, 1.05, "otd")
        wbox(m, w_, L_ / 2 - 0.35, L_ / 2 + 0.35, -0.3, 0.04, 24.34, 25.1, SAND, 1.0, "oilrt")
        wbox(m, w_, L_ / 2 - 0.4, L_ / 2 + 0.4, -0.34, 0.08, 25.1, 25.22, BLUE, 1.05, "oilrtd")
    m.cone(ngon(ou, ov, orr - 0.1, 8, rot8), 24.2, 41.0, SLATE, 1.0)
    for k in range(4):  # lucarnes low on the spire
        a_ = rot8 + math.pi / 8 + k * math.pi / 2
        o_ = (math.cos(a_), math.sin(a_))
        rr_ = (orr - 0.1) * math.cos(math.pi / 8) * (1 - (26.5 - 24.2) / (41.0 - 24.2)) + 0.05
        w_ = W((ou + o_[0] * rr_, ov + o_[1] * rr_), (-o_[1], o_[0]), o_)
        wall(m, w_, [(-0.35, 26.1), (0.35, 26.1), (0.35, 27.4), (0, 28.1), (-0.35, 27.4)],
             ops=[Op(0, 0.14, 26.6, 27.3, depth=0.2, back="void", frame=0.05, proj=0.03, sill=False)], mats=((1e9, SAND),))
        for sg in (-1, 1):
            m.quad(w_.P(sg * 0.42, 0.08, 27.35), w_.P(0, 0.08, 28.2), w_.P(0, -1.2, 28.2), w_.P(sg * 0.42, -1.2, 27.35), SLATE, 0.95, w_.dir(sg, 0, 1))
    finial(m, ou, ov, 41.0, 2.2, vane=True)
    # the square book tower: five storeys, a corbel frieze, stepped dormers breaking the cornice, a tent roof, the arms
    E_ = W((0, bv1), (1, 0), (0, 1))
    BN = W((bu1, 0), (0, 1), (1, 0))
    BS = W((bu0, 0), (0, 1), (-1, 0))
    wall(m, E_, rect(bu0, bu1, 6.9, BY), ops=[Op(bu0 + 2.5, 1.0, y0, y0 + 2.6, head="pointed", depth=0.35, frame=0.13, mull=1, transom=y0 + 0.95)
                                             for y0 in (9.7, 13.5, 17.3)], mats=((1e9, SAND),))
    wall(m, BN, rect(bv0, bv1, 6.9, BY), ops=[Op((bv0 + bv1) / 2, 1.0, y0, y0 + 2.6, head="pointed", depth=0.35, frame=0.13, mull=1, transom=y0 + 0.95)
                                             for y0 in (9.7, 13.5, 17.3)], mats=((1e9, SAND),))
    wall(m, BS, rect(bv0, bv1, 6.9, BY), ops=[Op((bv0 + bv1) / 2, 1.6, 13.25, 15.65, depth=0.1, back="carve:arms", frame=0.12, frame_all=True),
                                             Op((bv0 + bv1) / 2, 0.35, 9.0, 11.0, depth=0.3, frame=0.1, bars=1)], mats=((1e9, SAND),))
    for yc in (8.0, 12.9, 16.9):
        for ww, s0_, s1_ in ((E_, bu0, bu1), (BN, bv0, bv1), (BS, bv0, bv1)):
            course(m, ww, s0_, s1_, yc, h=0.16, proj=0.08, ends="")
    for ww, s0_, s1_ in ((E_, bu0, bu1), (BN, bv0, bv1), (BS, bv0, bv1)):
        k = s0_ + 0.3
        while k < s1_ - 0.2:
            for (e1_, ya, yb) in ((0.15, BY - 1.0, BY - 0.72), (0.28, BY - 0.72, BY - 0.35)):
                wbox(m, ww, k - 0.13, k + 0.13, 0.0, e1_, ya, yb, BLUE, 0.9, "olrd")
            k += 0.7
    m.box(bu0 - 0.3, bu1 + 0.3, bv0 - 0.3, bv1 + 0.3, BY - 0.35, BY, BLUE, 1.05, "nsewb")
    m.cone([(bu0 - 0.35, bv0 - 0.35), (bu1 + 0.35, bv0 - 0.35), (bu1 + 0.35, bv1 + 0.35), (bu0 - 0.35, bv1 + 0.35)], BY, BY + 7.0, SLATE, 1.0)
    finial(m, (bu0 + bu1) / 2, (bv0 + bv1) / 2, BY + 7.0, 1.8)
    for ww, sc in ((E_, bu0 + 2.5), (BN, (bv0 + bv1) / 2)):
        dw = ww.shifted(0.35)
        stepped_gable(m, dw, sc - 1.1, sc + 1.1, BY, 2.4, steps=3, t=0.4, crown=0.5, wall_from=BY - 0.35, kneel=(False, False),
                      ops=[Op(sc, 0.35, BY + 0.15, BY + 1.3, depth=0.25, frame=0.08, proj=0.05)], mats=((1e9, SAND),))
        for sg in (-1, 1):
            m.poly([dw.P(sc + sg * 1.1, -0.4, BY), dw.P(sc + sg * 1.1, -0.4, BY + 1.0), dw.P(sc + sg * 1.1, -2.2, BY + 2.9), dw.P(sc + sg * 1.1, -2.2, BY + 1.3)],
                   SLATE, 0.8, dw.dir(sg, 0, 0))
        m.quad(dw.P(sc - 1.15, -0.4, BY + 1.0), dw.P(sc + 1.15, -0.4, BY + 1.0), dw.P(sc + 1.15, -2.2, BY + 2.9), dw.P(sc - 1.15, -2.2, BY + 2.9), SLATE, 1.0, dw.dir(0, 1, 1))

    # ================================================================ the covered passage across the courtyard's end, its timber gallery
    m.sec = "the covered passage across the courtyard's end, its timber gallery"
    qu0, qu1, qv0, qv1 = NW0, a1, b1, tv1 + 0.4
    PY = TY + 4.8
    QS = W((qu0, 0), (0, 1), (-1, 0))
    wall(m, QS, rect(V1, qv1, TY - 0.1, PY), ops=[
        Op(11.25, 1.15, TY, TY + 3.2, head="round", depth=0.35, back="door", frame=0.16, sill=False, name="door of the covered passage, on the courtyard"),
        *[Op(9.9 + k * 1.35, 0.3, TY + 3.55, TY + 4.3, head="circle", depth=0.08, back="carve:arms", frame=0.06, proj=0.04) for k in range(3)],
    ], mats=((1e9, SAND),))
    QE = W((0, qv1), (1, 0), (0, 1))
    wall(m, QE, rect(qu0, qu1, -0.3, PY), ops=[Op(u, 0.4, TY + 1.4, TY + 3.4, depth=0.35, frame=0.12, bars=1) for u in (9.5, 12.0)])
    batter(m, QE, qu0, qu1, y_top=0.7, out=0.25, ends="")
    course(m, QE, qu0, qu1, TY, h=0.2, proj=0.1)
    QN = W((qu1, 0), (0, 1), (1, 0))  # (from the north wing on: the low block in the corner by the book tower too)
    wall(m, QN, rect(bv0, qv1, FOOT, PY), ops=[Op(5.6, 0.3, 3.4, 4.4, depth=0.3, frame=0.1, bars=1)])
    batter(m, QN, bv0, qv1, ends="")
    course(m, QN, bv0, qv1, BASE)
    m.box(bu1, qu1, bv0, qv0, PY - 0.1, PY, METAL, 0.7, "t", col=LEAD)
    wall(m, W((0, qv0), (1, 0), (0, -1)), rect(NW0, bu0, PY - 0.3, PY), mats=((1e9, SAND),))
    m.box(qu0, qu1, qv0, qv1, PY - 0.1, PY, METAL, 0.7, "t", col=LEAD)
    m.box(NW0, bu0, bv0, qv0, 6.8, 6.9, METAL, 0.7, "t", col=LEAD)  # the lead over the light well by the book tower
    wall(m, W((NW0, 0), (0, 1), (-1, 0)), rect(bv0, qv0, 6.9, 7.1), mats=((1e9, SAND),))
    WOOD = (0.36, 0.25, 0.16)
    gu0, gu1 = qu0 + 0.3, a1 - 3.0
    gv0, gv1 = qv0 + 0.3, qv1 - 0.3
    m.box(gu0, gu1, gv0, gv1, PY, PY + 0.8, METAL, 1.0, "nsew", col=WOOD)
    m.quad((gu0, gv1 - 0.04, PY + 0.8), (gu1, gv1 - 0.04, PY + 0.8), (gu1, gv1 - 0.04, PY + 2.05), (gu0, gv1 - 0.04, PY + 2.05), GLASS, 0.9, (0, 1, 0))
    m.quad((gu0 + 0.04, gv0, PY + 0.8), (gu0 + 0.04, gv1, PY + 0.8), (gu0 + 0.04, gv1, PY + 2.05), (gu0 + 0.04, gv0, PY + 2.05), GLASS, 0.9, (-1, 0, 0))
    m.quad((gu0, gv0, PY + 0.8), (gu1, gv0, PY + 0.8), (gu1, gv0, PY + 2.05), (gu0, gv0, PY + 2.05), METAL, 0.8, (0, -1, 0), col=WOOD)
    m.quad((gu1, gv0, PY + 0.8), (gu1, gv1, PY + 0.8), (gu1, gv1, PY + 2.05), (gu1, gv0, PY + 2.05), METAL, 0.8, (1, 0, 0), col=WOOD)
    for k in range(6):  # the posts of the five-part gallery's glazed bays
        s = gu0 + k * (gu1 - gu0) / 5
        m.box(max(gu0 - 0.02, s - 0.09), s + 0.09, gv1 - 0.1, gv1 + 0.02, PY + 0.8, PY + 2.05, METAL, 1.0, "nsew", col=WOOD)
    for s in (gv0 + 0.1, gv0 + (gv1 - gv0) / 3, gv0 + 2 * (gv1 - gv0) / 3):
        m.box(gu0 - 0.02, gu0 + 0.1, s - 0.08, s + 0.08, PY + 0.8, PY + 2.05, METAL, 1.0, "nsew", col=WOOD)
    m.box(gu0 - 0.05, gu1 + 0.05, gv0 - 0.05, gv1 + 0.05, PY + 2.05, PY + 2.2, METAL, 1.0, "nsewb", col=WOOD)
    roof_gable(m, gu0, gu1, gv0, gv1, PY + 2.2, 1.8, along="u", over=0.3, end_over=(0.3, 0.3))
    for ue, sg in ((gu0, -1), (gu1, 1)):
        m.poly([(ue, gv0, PY + 2.2), (ue, gv1, PY + 2.2), (ue, (gv0 + gv1) / 2, PY + 4.0)], METAL, 0.9, (sg, 0, 0), col=WOOD)
    # the round corner tower with its overhanging polygonal top and slate spire
    ru, rv, rr = a1 - 1.9, tv1 - 1.7, 1.8
    tower(m, ru, rv, rr, 14.0, sides=12, skip=lambda p: inside(p, 0.35), ops=[
        (math.pi / 2, slit(6.5, 8.1, 0.4, 0.1)),
        (math.pi / 2, slit(10.5, 12.1, 0.4, 0.1)),
        (0.3, Op(0, 0.28, 9.0, 10.2, depth=0.35, frame=0.08, bars=1)),
    ])
    tower_rim(m, ru, rv, rr, 14.0, sides=12, corbel=0.55, skip=lambda p: inside(p, 0.4))
    oct_ = ngon(ru, rv, rr + 0.55, 8, rot8)
    for k in range(8):
        a_, b_ = oct_[k], oct_[(k + 1) % 8]
        L_ = math.hypot(b_[0] - a_[0], b_[1] - a_[1])
        d_ = ((b_[0] - a_[0]) / L_, (b_[1] - a_[1]) / L_)
        mid_ = ((a_[0] + b_[0]) / 2 - ru, (a_[1] + b_[1]) / 2 - rv)
        lm = math.hypot(*mid_)
        ops_ = [Op(L_ / 2, 0.36, 14.5, 16.3, head="pointed", depth=0.3, frame=0.08, proj=0.05)] if k % 2 == 0 else []
        wall(m, W(a_, d_, (mid_[0] / lm, mid_[1] / lm)), rect(0, L_, 14.0, 16.8), ops=ops_, mats=((1e9, SAND),))
    m.prism(ngon(ru, rv, rr + 0.62, 8, rot8), 16.65, 16.85, BLUE, 1.05, top=False, bottom=True)
    m.cone(ngon(ru, rv, rr + 0.7, 8, rot8), 16.85, 26.5, SLATE, 1.0)
    finial(m, ru, rv, 26.5, 1.8)

    # ================================================================ the calvary at the ramp's foot, facing the quay (+v) (the 1880 photograph)
    m.sec = "the calvary at the ramp's foot, facing the quay"
    x0_, z0_, x1_, z1_ = RD["calvary"]
    cu, cv = (x0_ + x1_) / 2 - cx, z1_ - cz - 0.9
    m.box(cu - 0.6, cu + 0.6, cv - 0.45, cv + 0.45, 0.0, 0.9, BLUE, 0.85, "nsew")
    m.box(cu - 0.72, cu + 0.72, cv - 0.55, cv + 0.55, 0.9, 1.05, BLUE, 1.0, "nsewtb")
    m.box(cu - 0.76, cu + 0.76, cv - 0.6, cv + 0.6, 0.0, 0.2, BLUE, 0.9, "nsewt")
    for k in range(9):  # the iron railing in front
        uu = cu - 1.0 + k * 0.25
        m.box(uu - 0.02, uu + 0.02, cv + 0.87, cv + 0.91, 0.0, 1.05, METAL, 1.0, "nsew", col=IRON)
        m.cone(ngon(uu, cv + 0.89, 0.035, 4, math.pi / 4), 1.05, 1.16, METAL, 1.0, col=IRON)
    m.box(cu - 1.02, cu + 1.02, cv + 0.85, cv + 0.93, 0.95, 1.02, METAL, 1.0, "nsewtb", col=IRON)
    for sg in (-1, 1):
        m.box(cu + sg * 1.0 - 0.03, cu + sg * 1.0 + 0.03, cv - 0.6, cv + 0.85, 0.95, 1.02, METAL, 1.0, "nsewtb", col=IRON)
        m.box(cu + sg * 1.0 - 0.02, cu + sg * 1.0 + 0.02, cv - 0.6, cv + 0.85, 0.0, 0.95, METAL, 1.0, "nsew", col=IRON)
    TAR = (0.13, 0.12, 0.11)
    m.box(cu - 0.12, cu + 0.12, cv - 0.12, cv + 0.12, 1.05, 6.6, METAL, 1.0, "nsewt", col=TAR)  # the tarred cross
    m.box(cu - 1.1, cu - 0.12, cv - 0.11, cv + 0.11, 5.0, 5.28, METAL, 1.0, "sewtb", col=TAR)
    m.box(cu + 0.12, cu + 1.1, cv - 0.11, cv + 0.11, 5.0, 5.28, METAL, 1.0, "newtb", col=TAR)
    for sg in (-1, 1):
        m.quad((cu - 0.3, cv, 6.47), (cu + 0.3, cv, 6.47), (cu + 0.3, cv + sg * 0.42, 6.15), (cu - 0.3, cv + sg * 0.42, 6.15), METAL, 1.0, (0, sg, 1), col=LEAD)
    FLESH, CLOTH = (0.48, 0.39, 0.32), (0.46, 0.44, 0.4)  # painted, weathered
    m.box(cu - 0.14, cu + 0.14, cv + 0.13, cv + 0.27, 3.6, 4.85, METAL, 1.0, "nsetb", col=FLESH)
    m.box(cu - 0.08, cu + 0.08, cv + 0.13, cv + 0.25, 2.7, 3.25, METAL, 0.95, "nseb", col=FLESH)
    m.box(cu - 0.09, cu + 0.09, cv + 0.13, cv + 0.28, 4.85, 5.08, METAL, 1.0, "nset", col=FLESH)
    m.box(cu - 0.16, cu + 0.16, cv + 0.13, cv + 0.29, 3.25, 3.6, METAL, 1.05, "nsetb", col=CLOTH)
    for sg in (-1, 1):
        m.poly([(cu + sg * 0.12, cv + 0.2, 4.62), (cu + sg * 0.95, cv + 0.2, 4.98), (cu + sg * 0.95, cv + 0.2, 4.86), (cu + sg * 0.12, cv + 0.2, 4.45)], METAL, 1.0, (0, 1, 0), col=FLESH)
    m.box(cu - 0.02, cu + 0.02, cv + 0.1, cv + 0.55, 3.3, 3.36, METAL, 1.0, "nsewtb", col=IRON)
    for fu0, fu1, fv0, fv1, out in ((cu - 0.11, cu + 0.11, cv + 0.44, cv + 0.44, (0, -1, 0)), (cu - 0.11, cu + 0.11, cv + 0.66, cv + 0.66, (0, 1, 0)),
                                    (cu - 0.11, cu - 0.11, cv + 0.44, cv + 0.66, (-1, 0, 0)), (cu + 0.11, cu + 0.11, cv + 0.44, cv + 0.66, (1, 0, 0))):
        m.poly([(fu0, fv0, 2.95), (fu1, fv1, 2.95), (fu1, fv1, 3.25), (fu0, fv0, 3.25)], ATLAS, 1.0, out, uvs=cell_uvs([(0, 0), (1, 0), (1, 1), (0, 1)], "lampglass", "atlas"))
    m.cone(ngon(cu, cv + 0.55, 0.17, 4, math.pi / 4), 3.25, 3.42, METAL, 1.0, col=IRON)
    return m


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials()
    m = build()
    finish(m, "steen")
    finish(LIT[0], "steen_lit_glass")
    print(f"[build_steen] {opening_markers()} real openings -> {SHELL_TS}")
    # what must stay clear of everything else, for the game's dev check (world/steenModel.ts check(); not loaded in play)
    for f in m.features:
        if "tris" in f:
            f["tris"] = [round(c, 2) for c in f["tris"]]
    json.dump(m.features, open(FEATURES, "w", newline=chr(10)), separators=(",", ":"))
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_extras=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print(f"[build_steen] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()

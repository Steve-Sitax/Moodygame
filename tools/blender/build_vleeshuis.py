"""The Vleeshuis of 1873 in detail (the high-quality pass, 2026-09-26): its own model, written to
client/public/models/vleeshuis.glb and loaded by client/src/world/vleeshuisShell.ts, which hides the older
Vleeshuis in landmarks.glb (tools/blender/build_landmarks.py vleeshuis2).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_vleeshuis.py

The butchers' hall of 1501-04: red brick with regular bands of white sandstone ("bacon layers") on a profiled
sandstone plinth; seven bays between buttresses on each long side, the great pointed windows of the hall with
their tracery, cross windows above; stepped wall dormers at the eaves and four rows of dormers in each slope of
the steep slate roof; the stepped east and west gables (ten and nine steps) with their small windows, relieving
arches and copings; a hexagonal stair turret on each corner, corbelled out near the top under a kinked slate
spire and a wrought-iron vane (the south-east one the biggest, with the Madonna in her niche); the octagonal
stair tower out of the south side; the doors in bluestone frames (a round-arched and a wider basket-arched one
on the east front, one basket-arched door on each long side). In 1873 it was the wine merchant's warehouse (sold
by the butchers in 1841), sooty and worn; the city bought it in 1899 and restored it after 1900, so none of that.
Sources, for reference only: the heritage inventory (Onroerend Erfgoed 4678), the older model's notes
(docs/milestones/M6-vleeshuis.md: Linnig's etching of 1849 and drawing of 1855, Durand's photographs).

What must not move (the hall inside, shared/vleeshuisPlan.ts, the walk map and the townspeople's spots): the
outline (u -22.2..22.2, v -7.5..9.0 in the landmark's frame from shared/city.json), the two doors of the long
sides (basket arches 1.8 wide, 3.36 high, reveals 0.9 deep, open: no leaves; the game hangs its own), the bays'
middles and the upper windows the theatre lights at night (world/landmarkHalls.ts), the eaves at 16.8 and the
drip course at 9.6.

Materials (the game gives each its picture and height map, client/src/world/vleeshuisShell.ts; the pictures and
the height maps come from tools/textures/vleeshuis_maps.py):
  vh_bands  the brick with the white stone bands: v = height / 1.92 m, so the bands run level all round
            (a stone band at every 0.48 m from the ground, 0.12 m high)
  vh_sand   white sandstone: plinth, courses, copings, window frames, mullions, tracery, corbels
  vh_blue   bluestone: the door frames and steps
  vh_slate  slate: the roofs and spires
  vh_glass  leaded glass
  vh_oak    oak: doors, shutters, dormer fronts
  vh_lead   lead and iron (no picture): gutters, pipes, anchors, vanes, ridges
  vh_madonna the Madonna in her niche (a picture on one face)
UVs: metres over each material's tile (TILE), laid on each face: flat faces by x and z, the others along the
face and up it (on a vertical face "up" is the world height). Vertex colour "Col" carries the shade (reveals and
soffits darker, a little weathering per face).
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
OUT = os.path.join(ROOT, "client", "public", "models", "vleeshuis.glb")

MATS = ["vh_bands", "vh_sand", "vh_blue", "vh_slate", "vh_glass", "vh_oak", "vh_lead", "vh_madonna"]
BANDS, SAND, BLUE, SLATE, GLASS, OAK, LEAD, MADONNA = range(8)
MAT_RGB = [(0.5, 0.3, 0.24), (0.72, 0.7, 0.64), (0.36, 0.38, 0.42), (0.3, 0.32, 0.35), (0.1, 0.12, 0.13), (0.3, 0.22, 0.15), (0.25, 0.26, 0.27), (0.6, 0.55, 0.5)]
# metres per repeat of each picture (vh_bands: four bands, 1.92 m; must match vleeshuis_maps.py)
TILE = {BANDS: 1.92, SAND: 1.6, BLUE: 1.6, SLATE: 2.0, GLASS: 1.2, OAK: 1.2, LEAD: 1.0, MADONNA: 1.0}

# ---- the plan (the older model's, kept: the hall inside is fitted to it)
U0, U1, V0, V1 = -22.2, 22.2, -7.5, 9.0
H = 16.8  # the eaves: 35 bands
HALF, VM = (V1 - V0) / 2, (V0 + V1) / 2
SLOPE = 1.6  # the roof, 58 degrees
RISE = HALF * SLOPE
PL = 1.2  # the top of the plinth
SC = 9.6  # the drip course between the two storeys
VP = 0.48  # one band
BL = [-20.4, -15.3, -9.1, -2.8, 3.5, 9.7, 15.8, 20.4]  # buttress lines on the long sides (the ends: the turrets)
DOOR_S, DOOR_N = (BL[2] + BL[3]) / 2, (BL[3] + BL[4]) / 2
TWR = (3.4, -8.58, 1.88)  # the octagonal stair tower out of the south side
DOOR4 = [(0, 0), (1, 0), (1, 0.76), (0.9, 0.9), (0.7, 0.98), (0.5, 1), (0.3, 0.98), (0.1, 0.9), (0, 0.76)]  # the basket arch (shared/vleeshuisPlan.ts ARCH)
ARCH_R = 1.25


def B(x, y, z):
    return Vector((x, -z, y))


class Frame:
    """Local (u, v, y) of the landmark -> world (x, y, z) (shared/city.json landmarks.vleeshuis.frame)."""

    def __init__(self, f):
        self.c, self.ax, self.n = f["c"], f["ax"], f["n"]

    def w(self, u, v, y):
        return (self.c[0] + self.ax[0] * u + self.n[0] * v, y, self.c[1] + self.ax[1] * u + self.n[1] * v)


class VMesh:
    """One mesh in the landmark's frame: faces with a material and a shade; UVs laid at the end."""

    def __init__(self, frame):
        self.f = frame
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.fixed = {}
        self.rng = random.Random(1501)

    def poly(self, pts, mat, shade=1.0, out=None, uvs=None, jit=0.0):
        vs = [self.bm.verts.new(B(*self.f.w(*p))) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            for v in vs:
                self.bm.verts.remove(v)
            return None
        f.material_index = mat
        if jit:
            shade *= 1 + self.rng.uniform(-jit, jit)
        for loop in f.loops:
            loop[self.col] = (shade, shade, shade, 1.0)
        if out is not None:
            self.orient(f, out)
        if uvs is not None:
            self.fixed[f] = dict(zip(vs, uvs))
        return f

    def orient(self, f, out):
        if f is None:
            return
        du, dv, dy = out
        wx = self.f.ax[0] * du + self.f.n[0] * dv
        wz = self.f.ax[1] * du + self.f.n[1] * dv
        f.normal_update()
        if f.normal.dot(B(wx, dy, wz)) < 0:
            f.normal_flip()

    # ---- solids in (u, v)
    def prism(self, ring, y0, y1, mat, shade=1.0, top=True, bottom=False, jit=0.0, skip=None):
        n = len(ring)
        cu, cv = sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            if skip and skip(a, b):
                continue
            mu, mv = (a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv
            self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (b[0], b[1], y1), (a[0], a[1], y1)], mat, shade, (mu, mv, 0), jit=jit)
        if top:
            self.poly([(p[0], p[1], y1) for p in ring], mat, shade * 1.05, (0, 0, 1))
        if bottom:
            self.poly([(p[0], p[1], y0) for p in ring], mat, shade * 0.6, (0, 0, -1))

    def frustum(self, r0, y0, r1, y1, mat, shade=1.0, jit=0.0):
        n = len(r0)
        cu, cv = sum(p[0] for p in r0) / n, sum(p[1] for p in r0) / n
        for i in range(n):
            a, b, c, d = r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]
            up = 1 if y1 > y0 else -1
            self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (c[0], c[1], y1), (d[0], d[1], y1)], mat, shade,
                      ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.5 * up if abs(y1 - y0) > 1e-6 else up), jit=jit)

    def pyramid(self, ring, y0, apex, mat, shade=1.0):
        n = len(ring)
        cu, cv = sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (cu, cv, apex)], mat, shade, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.3))

    def box(self, u0, u1, v0, v1, y0, y1, mat, shade=1.0, top=True, bottom=False, jit=0.0):
        self.prism([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], y0, y1, mat, shade, top, bottom, jit)

    @staticmethod
    def ngon(cu, cv, r, sides, rot=0.0):
        return [(cu + r * math.cos(rot + 2 * math.pi * i / sides), cv + r * math.sin(rot + 2 * math.pi * i / sides)) for i in range(sides)]

    # ---- the end: UVs by material, the shade darker toward the ground, one object
    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        for f in self.bm.faces:
            for loop in f.loops:
                c = loop[self.col]
                k = 0.84 + 0.16 * min(1.0, max(0.0, loop.vert.co.z / 24.0))
                loop[self.col] = (c[0] * k, c[1] * k, c[2] * k, 1.0)
            if f in self.fixed:
                by = self.fixed[f]
                for loop in f.loops:
                    loop[self.uvl].uv = by[loop.vert]
                continue
            f.normal_update()
            n = f.normal
            t = TILE[f.material_index]
            if abs(n.z) > 0.9:
                for loop in f.loops:
                    co = loop.vert.co
                    loop[self.uvl].uv = (co.x / t, co.y / t)
                continue
            tx, ty = -n.y, n.x
            ln = math.hypot(tx, ty) or 1.0
            tx, ty = tx / ln, ty / ln
            # up the face: the world's up with the face's normal taken out (on a wall: the height itself)
            bx, by_, bz = -n.x * n.z, -n.y * n.z, 1 - n.z * n.z
            lb = math.sqrt(bx * bx + by_ * by_ + bz * bz) or 1.0
            bx, by_, bz = bx / lb, by_ / lb, bz / lb
            vertical = abs(n.z) < 0.02
            for loop in f.loops:
                co = loop.vert.co
                v = co.z if vertical else co.x * bx + co.y * by_ + co.z * bz
                loop[self.uvl].uv = ((co.x * tx + co.y * ty) / t, v / t)
        self.tris = sum(len(f.verts) - 2 for f in self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for mname in MATS:
            me.materials.append(bpy.data.materials[mname])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ca = ob.data.color_attributes
        if "Col" in ca:
            ca.active_color = ca["Col"]
            ca.render_color_index = list(ca.keys()).index("Col")
        print(f"[build_vleeshuis] {name}: {self.tris} triangles")
        return ob


# ------------------------------------------------------------------ outlines of openings (s along the wall, y up)


def arch_t(x, tsp):
    x = min(x, 1 - x)
    return tsp + (1 - tsp) * math.sqrt(max(0.0, ARCH_R * ARCH_R - (x - ARCH_R) ** 2))


def outline(kind, sc, hw, yb, h, tsp=0.62, seg=5, rise=0.3):
    """An opening's outline, closed: the bottom left, the bottom right, up the right side, over the top to the
    left springing. kind: rect, pointed (tsp: the springing as a part of h), basket (DOOR4), round, seg
    (segmental, `rise` over the springing at yb + h - rise), circle (yb its foot, h its diameter)."""
    if kind == "circle":
        r = h / 2
        yc = yb + r
        n = 4 * seg
        return [(sc + r * math.cos(-math.pi / 2 - 2 * math.pi * k / n), yc + r * math.sin(-math.pi / 2 - 2 * math.pi * k / n)) for k in range(n)][::-1]
    pts = [(sc - hw, yb), (sc + hw, yb)]
    if kind == "rect":
        pts += [(sc + hw, yb + h), (sc - hw, yb + h)]
    elif kind == "pointed":
        pts += [(sc + (x - 0.5) * 2 * hw, yb + h * arch_t(x, tsp)) for x in [1 - k / (2 * seg) for k in range(0, 2 * seg + 1)]]
    elif kind == "basket":
        pts += [(sc + (x - 0.5) * 2 * hw, yb + t * h) for x, t in DOOR4[2:]]
    elif kind == "round":
        ys = yb + h - hw
        pts += [(sc + hw * math.cos(math.pi * k / (2 * seg)), ys + hw * math.sin(math.pi * k / (2 * seg))) for k in range(0, 2 * seg + 1)]
    elif kind == "seg":
        ys = yb + h - rise
        R = (hw * hw + rise * rise) / (2 * rise)
        a0 = math.asin(hw / R)
        pts += [(sc + R * math.sin(a0 - 2 * a0 * k / (2 * seg)), ys - (R - rise) + R * math.cos(a0 - 2 * a0 * k / (2 * seg))) for k in range(0, 2 * seg + 1)]
    return pts


def hole_of(ol):
    """An outline as a hole for wall(): its top and bottom as functions of s (left to right)."""
    smin, smax = min(p[0] for p in ol), max(p[0] for p in ol)
    n = len(ol)
    il, ir = min(range(n), key=lambda i: (ol[i][0], ol[i][1])), max(range(n), key=lambda i: (ol[i][0], -ol[i][1]))
    # the two chains from the leftmost to the rightmost point
    a, b = [], []
    i = il
    while True:
        a.append(ol[i])
        if i == ir:
            break
        i = (i + 1) % n
    i = il
    while True:
        b.append(ol[i])
        if i == ir:
            break
        i = (i - 1) % n
    # vertical sides give two points at one s: keep the lower for the bottom chain, the higher for the top
    ya = sum(p[1] for p in a) / len(a)
    yb_ = sum(p[1] for p in b) / len(b)
    bot, top = (a, b) if ya < yb_ else (b, a)
    return {"sl": smin, "sr": smax, "bot": bot, "top": top}


def _at(chain, s, low):
    """The chain's height at s (a vertical step: the lower or the higher end)."""
    best = None
    for (s0, y0), (s1, y1) in zip(chain, chain[1:]):
        if s0 - 1e-6 <= s <= s1 + 1e-6 or s1 - 1e-6 <= s <= s0 + 1e-6:
            if abs(s1 - s0) < 1e-6:
                y = min(y0, y1) if low else max(y0, y1)
            else:
                y = y0 + (y1 - y0) * (s - s0) / (s1 - s0)
            best = y if best is None else (min(best, y) if low else max(best, y))
    return best


def inset(kind, sc, hw, yb, h, c, cb=None, tsp=0.62, seg=5, rise=0.3):
    """The outline of the same kind c inside (cb at the foot): the springing stays where it is."""
    cb = c if cb is None else cb
    if kind == "pointed":
        ys = yb + tsp * h
        h2 = h - cb - c
        return outline(kind, sc, hw - c, yb + cb, h2, (ys - yb - cb) / h2, seg)
    if kind == "circle":
        return outline(kind, sc, hw - c, yb + c, h - 2 * c, seg=seg)
    return outline(kind, sc, hw - c, yb + cb, h - cb - c, tsp, seg, rise)


# ------------------------------------------------------------------ building blocks on a wall frame


def WP(fr, s, e, y):
    p, d, o = fr
    return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)


def odir(fr, k=1.0, y=0.0):
    return (fr[2][0] * k, fr[2][1] * k, y)


class Kit:
    def __init__(self, m):
        self.m = m

    def quad(self, fr, pa, pb, pc, pd, e, mat, shade=1.0, out=None, jit=0.0):
        """A face on the wall plane at e: four (s, y) corners."""
        return self.m.poly([WP(fr, s, e, y) for s, y in (pa, pb, pc, pd)], mat, shade, out or odir(fr), jit=jit)

    def wall(self, fr, s0, s1, y0, y1, holes=(), e=0.0, mat=BANDS, shade=1.0):
        """A wall from s0 to s1, y0 to y1, with holes (outlines) cut out: cut into columns at every corner of the
        holes, each column from the foot to the first hole, between holes, and from the last to the top."""
        hs = [hole_of(h) for h in holes]
        cuts = {s0, s1}
        for h in hs:
            for s, _ in h["top"] + h["bot"]:
                if s0 < s < s1:
                    cuts.add(round(s, 6))
        cuts = sorted(cuts)
        for sa, sb in zip(cuts, cuts[1:]):
            if sb - sa < 1e-5:
                continue
            spans = []
            for h in hs:
                if h["sl"] <= sa + 1e-6 and sb <= h["sr"] + 1e-6:
                    sm = (sa + sb) / 2
                    # (at a vertical side of the hole the column's edge takes the value inside the hole: the lowest
                    # of its bottom, the highest of its top)
                    ba, bb = _at(h["bot"], sa, True), _at(h["bot"], sb, True)
                    ta, tb = _at(h["top"], sa, False), _at(h["top"], sb, False)
                    spans.append((_at(h["bot"], sm, True), ba, bb, ta, tb))
            spans.sort()
            ya = yb_ = y0
            for _, ba, bb, ta, tb in spans:
                self._piece(fr, sa, sb, ya, yb_, min(max(ba, y0), y1), min(max(bb, y0), y1), e, mat, shade)
                ya, yb_ = min(max(ta, y0), y1), min(max(tb, y0), y1)
            self._piece(fr, sa, sb, ya, yb_, y1, y1, e, mat, shade)

    def _piece(self, fr, sa, sb, ba, bb, ta, tb, e, mat, shade):
        if ta - ba < 1e-4 and tb - bb < 1e-4:
            return
        if ta - ba < 1e-4:
            self.m.poly([WP(fr, sa, e, ba), WP(fr, sb, e, bb), WP(fr, sb, e, tb)], mat, shade, odir(fr))
        elif tb - bb < 1e-4:
            self.m.poly([WP(fr, sa, e, ba), WP(fr, sb, e, bb), WP(fr, sa, e, ta)], mat, shade, odir(fr))
        else:
            self.quad(fr, (sa, ba), (sb, bb), (sb, tb), (sa, ta), e, mat, shade)

    def ring(self, fr, A, eA, B_, eB, mat, shade=1.0, skip_bottom=False, jit=0.0):
        """The faces between two outlines of one kind at two depths (a chamfer, a reveal)."""
        n = len(A)
        cs = sum(p[0] for p in A) / n
        cy = sum(p[1] for p in A) / n
        for i in range(n):
            j = (i + 1) % n
            if skip_bottom and i == 0:
                continue
            sm, ym = (A[i][0] + A[j][0]) / 2, (A[i][1] + A[j][1]) / 2
            p, d, o = fr
            k = 0.3 if abs(eA - eB) > 1e-6 else 1.0
            out = (d[0] * (cs - sm) + o[0] * k, d[1] * (cs - sm) + o[1] * k, (cy - ym))
            self.m.poly([WP(fr, A[i][0], eA, A[i][1]), WP(fr, A[j][0], eA, A[j][1]), WP(fr, B_[j][0], eB, B_[j][1]), WP(fr, B_[i][0], eB, B_[i][1])],
                        mat, shade * (0.8 if i == 0 else 1.0), out, jit=jit)

    def pane(self, fr, ol, e, mat, shade=1.0, uvs=None):
        return self.m.poly([WP(fr, s, e, y) for s, y in ol], mat, shade, odir(fr), uvs=uvs)

    def ribbon(self, fr, pts, w, e0, e1, mat=SAND, shade=1.0, closed=False, jit=0.03):
        """A bar of stone along a line in the wall plane (s, y): a mullion, a transom, tracery; its face at e1,
        its sides back to e0."""
        n = len(pts)
        if n < 2:
            return
        segs = n if closed else n - 1
        nrm = []
        for i in range(segs):
            a, b = pts[i], pts[(i + 1) % n]
            ds, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(ds, dy) or 1.0
            nrm.append((-dy / L, ds / L))
        off = []
        for i in range(n):
            if closed:
                na, nb = nrm[i - 1], nrm[i % segs]
            else:
                na, nb = nrm[max(0, i - 1)], nrm[min(i, segs - 1)]
            sx, sy = na[0] + nb[0], na[1] + nb[1]
            L = math.hypot(sx, sy) or 1.0
            mx, my = sx / L, sy / L
            k = 1.0 / max(0.35, mx * na[0] + my * na[1])
            off.append((mx * k * w / 2, my * k * w / 2))
        Lp = [(pts[i][0] + off[i][0], pts[i][1] + off[i][1]) for i in range(n)]
        Rp = [(pts[i][0] - off[i][0], pts[i][1] - off[i][1]) for i in range(n)]
        p, d, o = fr
        sh = shade * (1 + self.m.rng.uniform(-jit, jit))
        for i in range(segs):
            j = (i + 1) % n
            self.m.poly([WP(fr, *self._se(Lp[i], e1)), WP(fr, *self._se(Lp[j], e1)), WP(fr, *self._se(Rp[j], e1)), WP(fr, *self._se(Rp[i], e1))], mat, sh, odir(fr))
            for side, P_ in ((1, Lp), (-1, Rp)):
                nx, ny = nrm[i]
                self.m.poly([WP(fr, *self._se(P_[i], e0)), WP(fr, *self._se(P_[j], e0)), WP(fr, *self._se(P_[j], e1)), WP(fr, *self._se(P_[i], e1))], mat,
                            sh * (0.9 if side * ny > 0 else 0.7), (d[0] * nx * side, d[1] * nx * side, ny * side))

    @staticmethod
    def _se(p, e):
        return (p[0], e, p[1])

    def wbox(self, fr, s0, s1, e0, e1, y0, y1, mat, shade=1.0, top=True, bottom=False, jit=0.02):
        ring = [WP(fr, s0, e0, 0)[:2], WP(fr, s1, e0, 0)[:2], WP(fr, s1, e1, 0)[:2], WP(fr, s0, e1, 0)[:2]]
        self.m.prism(ring, y0, y1, mat, shade, top, bottom, jit)

    def sweep(self, path, prof, mat, shade=1.0, caps=True, jit=0.02):
        """A moulding along a path in plan (u, v; the outside to the right of the way along), its profile a list
        of (e out of the path, y) from the top at the wall out and down to the foot at the wall."""
        n = len(path)
        segN = []
        for i in range(n - 1):
            du, dv = path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]
            L = math.hypot(du, dv) or 1.0
            segN.append((dv / L, -du / L))
        mit = []
        for i in range(n):
            if i == 0:
                nn, k = segN[0], 1.0
            elif i == n - 1:
                nn, k = segN[-1], 1.0
            else:
                a, b = segN[i - 1], segN[i]
                sx, sy = a[0] + b[0], a[1] + b[1]
                L = math.hypot(sx, sy) or 1.0
                nn = (sx / L, sy / L)
                k = 1.0 / max(0.3, nn[0] * a[0] + nn[1] * a[1])
            mit.append((nn[0] * k, nn[1] * k))

        def pt(i, e, y):
            return (path[i][0] + mit[i][0] * e, path[i][1] + mit[i][1] * e, y)

        for i in range(n - 1):
            sh = shade * (1 + self.m.rng.uniform(-jit, jit))
            for j in range(len(prof) - 1):
                (ea, ya), (eb, yb) = prof[j], prof[j + 1]
                if abs(ea - eb) < 1e-6 and abs(ya - yb) < 1e-6:
                    continue
                oe, oy = -(yb - ya), (eb - ea)
                ln = math.hypot(oe, oy) or 1.0
                s2 = sh * (0.75 + 0.3 * max(0.0, oy / ln)) if oy < 0 else sh * (0.95 + 0.1 * oy / ln)
                self.m.poly([pt(i, ea, ya), pt(i + 1, ea, ya), pt(i + 1, eb, yb), pt(i, eb, yb)], mat, s2,
                            (segN[i][0] * oe, segN[i][1] * oe, oy))
        if caps:
            for i, sg in ((0, -1), (n - 1, 1)):
                du, dv = path[min(i + 1, n - 1)][0] - path[max(i - 1, 0)][0], path[min(i + 1, n - 1)][1] - path[max(i - 1, 0)][1]
                self.m.poly([pt(i, e, y) for e, y in prof], mat, shade * 0.85, (du * sg, dv * sg, 0))


# ------------------------------------------------------------------ the building


m = K = None  # the mesh and its kit, set in build()
S = ((0, V0), (1, 0), (0, -1))  # the south side
N = ((0, V1), (-1, 0), (0, 1))  # the north side (s = -u)
E = ((U0, 0), (0, -1), (-1, 0))  # the east front on the Vleeshouwersstraat (s = -v)
Wf = ((U1, 0), (0, 1), (1, 0))  # the west gable, to the Scheldt


def su(fr_, u_or_v):
    """A place along the building (u on the long sides, v on the gables) as s on that side's frame."""
    return u_or_v * (fr_[1][0] + fr_[1][1])


# ------------------------------------------------ windows, doors, small openings
def window_hall(fr_, c, yb, yt, hw, variant):
    """A great pointed window of the hall: a chamfered sandstone frame, the reveal, leaded glass, three lights
    under cusped heads, a transom, and the tracery in the head (a ring with a quatrefoil, or mouchettes)."""
    h = yt - yb
    tsp = (6.9 - yb) / h
    A = outline("pointed", c, hw, yb, h, tsp)
    Bo = inset("pointed", c, hw, yb, h, 0.16, 0.2, tsp)
    K.ring(fr_, A, 0.0, Bo, -0.16, SAND, 1.0, jit=0.03)
    K.ring(fr_, Bo, -0.16, Bo, -0.44, SAND, 0.62)
    K.pane(fr_, Bo, -0.44, GLASS, 1.0)
    hi = hw - 0.16
    yi = yb + 0.2
    ys = 6.9
    yti = yt - 0.16
    e0, e1 = -0.43, -0.27
    lw = 2 * hi / 3
    for k in (1, 2):
        K.ribbon(fr_, [(c - hi + k * lw, yi), (c - hi + k * lw, ys)], 0.11, e0, e1)
    ytr = yi + 0.46 * (ys - yi)
    K.ribbon(fr_, [(c - hi, ytr), (c + hi, ytr)], 0.1, e0, e1 + 0.02)
    heads = []
    for k in range(3):
        xl = c - hi + k * lw
        pts = [(xl + x * lw, ys + 0.62 * arch_t(x, 0.0)) for x in [i / 8 for i in range(9)]]
        K.ribbon(fr_, pts, 0.08, e0, e1)
        heads.append(pts[4])
        # the cusps: a small foil in each light's head
        K.ribbon(fr_, [(xl + lw / 2 + 0.11 * math.cos(2 * math.pi * i / 10), ys + 0.28 + 0.13 * math.sin(2 * math.pi * i / 10)) for i in range(10)],
                 0.045, e0, e1 - 0.02, closed=True)
    if variant == 0:
        cy, r = ys + 1.36, 0.56
        K.ribbon(fr_, [(c + r * math.cos(2 * math.pi * i / 20), cy + r * math.sin(2 * math.pi * i / 20)) for i in range(20)], 0.08, e0, e1, closed=True)
        for dx, dy in ((0.24, 0), (-0.24, 0), (0, 0.24), (0, -0.24)):
            K.ribbon(fr_, [(c + dx + 0.2 * math.cos(2 * math.pi * i / 12), cy + dy + 0.2 * math.sin(2 * math.pi * i / 12)) for i in range(12)], 0.05, e0, e1 - 0.02, closed=True)
        K.ribbon(fr_, [heads[1], (c, cy - r)], 0.08, e0, e1)
        for sg, hd in ((-1, heads[0]), (1, heads[2])):
            K.ribbon(fr_, [hd, (c + sg * 0.62, ys + 1.0), (c + sg * r * 0.95, cy + 0.2)], 0.08, e0, e1)
            # a dagger under the springing of the arch beside the ring
            dcx = c + sg * (hi - 0.26)
            K.ribbon(fr_, [(dcx + 0.13 * math.cos(2 * math.pi * i / 12), ys + 1.25 + 0.34 * math.sin(2 * math.pi * i / 12)) for i in range(12)], 0.05, e0, e1 - 0.02, closed=True)
        K.ribbon(fr_, [(c, cy + r), (c, yti - 0.05)], 0.08, e0, e1)
    else:
        for sg in (-1, 1):
            pts = [(c + sg * (lw / 2 * (1 - t) + 0.42 * math.sin(math.pi * t) * (1 - t) ** 0.7), ys + 0.3 + t * (yti - 0.05 - ys - 0.3)) for t in [i / 12 for i in range(13)]]
            K.ribbon(fr_, pts, 0.08, e0, e1)
            # the mouchette: a curved dagger between the curve and the frame
            mcx, mcy = c + sg * (hi - 0.34), ys + 1.05
            K.ribbon(fr_, [(mcx + sg * 0.16 * math.cos(2 * math.pi * i / 14) + sg * 0.08 * math.sin(2 * math.pi * i / 14), mcy + 0.42 * math.sin(2 * math.pi * i / 14)) for i in range(14)],
                     0.05, e0, e1 - 0.02, closed=True)
        K.ribbon(fr_, [heads[1], (c, ys + 1.3)], 0.08, e0, e1)
        K.ribbon(fr_, [(c + 0.16 * math.cos(2 * math.pi * i / 12), ys + 1.55 + 0.24 * math.sin(2 * math.pi * i / 12)) for i in range(12)], 0.05, e0, e1 - 0.02, closed=True)
    # the sill: a sloped sandstone ledge with a drip
    K.wbox(fr_, c - hw - 0.08, c + hw + 0.08, -0.02, 0.1, yb - 0.1, yb + 0.02, SAND, 0.95)
    return A

def window_cross(fr_, c, yb, yt, hw, shut):
    """A cross window of the upper floor: a chamfered frame, a stone mullion and transom, leaded lights, the
    lower lights shuttered where shut; a segmental relieving arch over it, proud of the wall."""
    h = yt - yb
    A = outline("rect", c, hw, yb, h)
    Bo = inset("rect", c, hw, yb, h, 0.13, 0.13)
    K.ring(fr_, A, 0.0, Bo, -0.13, SAND, 1.0, jit=0.03)
    K.ring(fr_, Bo, -0.13, Bo, -0.36, SAND, 0.62)
    K.pane(fr_, Bo, -0.36, GLASS, 1.0)
    hi, yi, yti = hw - 0.13, yb + 0.13, yt - 0.13
    ytr = yi + 0.6 * (yti - yi)
    K.ribbon(fr_, [(c, yi), (c, yti)], 0.14, -0.35, -0.2)
    K.ribbon(fr_, [(c - hi, ytr), (c + hi, ytr)], 0.13, -0.35, -0.19)
    if shut:
        for sg in (-1, 1):
            a, b = (c - hi, c - 0.07) if sg < 0 else (c + 0.07, c + hi)
            K.pane(fr_, [(a + 0.02, yi), (b - 0.02, yi), (b - 0.02, ytr - 0.07), (a + 0.02, ytr - 0.07)], -0.33, OAK, 0.8)
    # sill and the relieving arch (voussoirs of sandstone, alternately lighter and darker)
    K.wbox(fr_, c - hw - 0.08, c + hw + 0.08, -0.02, 0.1, yb - 0.1, yb + 0.02, SAND, 0.95)
    arch(fr_, c, hw + 0.12, yt + 0.02, 0.3, 0.26)
    return A

def arch(fr_, c, hw, ys, rise, th, e=0.035):
    R = (hw * hw + rise * rise) / (2 * rise)
    a0 = math.asin(hw / R)
    yc = ys + rise - R
    n = 9
    for k in range(n):
        a, b = a0 - 2 * a0 * k / n, a0 - 2 * a0 * (k + 1) / n
        pa = [(c + R * math.sin(a), yc + R * math.cos(a)), (c + R * math.sin(b), yc + R * math.cos(b))]
        pb = [(c + (R + th) * math.sin(b), yc + (R + th) * math.cos(b)), (c + (R + th) * math.sin(a), yc + (R + th) * math.cos(a))]
        K.quad(fr_, pa[0], pa[1], pb[0], pb[1], e, SAND, 1.05 if k % 2 == 0 else 0.82, jit=0.03)

def window_small(fr_, c, yb, h, hw, shut, arch_over=True, oak_frame=False):
    """A small window (the gables, the dormers, the turrets): a chamfered frame, a transom, glass, the lower
    light shuttered where shut."""
    A = outline("rect", c, hw, yb, h)
    Bo = inset("rect", c, hw, yb, h, 0.1, 0.1)
    K.ring(fr_, A, 0.0, Bo, -0.1, OAK if oak_frame else SAND, 0.95, jit=0.03)
    K.ring(fr_, Bo, -0.1, Bo, -0.26, OAK if oak_frame else SAND, 0.6)
    K.pane(fr_, Bo, -0.26, GLASS, 1.0)
    hi, yi, yti = hw - 0.1, yb + 0.1, yb + h - 0.1
    ytr = yi + 0.58 * (yti - yi)
    K.ribbon(fr_, [(c - hi, ytr), (c + hi, ytr)], 0.09, -0.25, -0.14, OAK if oak_frame else SAND)
    if shut:
        K.pane(fr_, [(c - hi, yi), (c + hi, yi), (c + hi, ytr - 0.05), (c - hi, ytr - 0.05)], -0.23, OAK, 0.8)
    if arch_over:
        arch(fr_, c, hw + 0.08, yb + h + 0.02, 0.18, 0.18, 0.03)
    return A

def slit(fr_, c, yb, h=1.44, hw=0.3):
    A = outline("rect", c, hw, yb, h)
    Bo = inset("rect", c, hw, yb, h, 0.1, 0.1)
    Ci = outline("rect", c, 0.09, yb + 0.12, h - 0.24)
    K.ring(fr_, A, 0.0, Bo, -0.08, SAND, 1.0, jit=0.03)
    K.wall(fr_, c - hw + 0.1, c + hw - 0.1, yb + 0.1, yb + h - 0.1, [Ci], e=-0.08, mat=SAND, shade=0.95)
    K.ring(fr_, Ci, -0.08, Ci, -0.3, SAND, 0.55)
    K.pane(fr_, Ci, -0.3, GLASS, 0.7)
    return A

def oculus(fr_, c, yb, d=0.8):
    A = outline("circle", c, d / 2, yb, d, seg=4)
    Bo = inset("circle", c, d / 2, yb, d, 0.12, seg=4)
    K.ring(fr_, A, 0.0, Bo, -0.12, SAND, 1.0)
    K.ring(fr_, Bo, -0.12, Bo, -0.3, SAND, 0.6)
    K.pane(fr_, Bo, -0.3, GLASS, 0.8)
    return A

def grille(fr_, c):
    """A barred cellar window in the plinth (the plinth's face at e 0.15)."""
    e = 0.15
    K.pane(fr_, outline("rect", c, 0.5, 0.22, 0.7), e + 0.012, GLASS, 0.25)
    for s0, s1, y0, y1 in ((c - 0.64, c - 0.5, 0.1, 1.04), (c + 0.5, c + 0.64, 0.1, 1.04), (c - 0.64, c + 0.64, 0.1, 0.22), (c - 0.64, c + 0.64, 0.92, 1.04)):
        K.wbox(fr_, s0, s1, e, e + 0.05, y0, y1, BLUE, 0.9)
    for k in range(5):
        s = c - 0.4 + k * 0.2
        K.wbox(fr_, s - 0.02, s + 0.02, e + 0.02, e + 0.05, 0.22, 0.92, LEAD, 0.5, top=False)

def door(fr_, c, hw, h, depth, kind="basket", open_=True):
    """A door in a bluestone frame: two chamfered orders round the opening, the reveal to the back (depth),
    oak doors there unless it is one of the open doors of the hall, a hood mould with its stops, a step."""
    A = outline(kind, c, hw + 0.34, 0.0, h + 0.3)
    Bo = outline(kind, c, hw + 0.2, 0.0, h + 0.18)
    C = outline(kind, c, hw + 0.2, 0.0, h + 0.18)
    D = outline(kind, c, hw, 0.0, h)
    K.ring(fr_, A, 0.0, Bo, -0.12, BLUE, 1.0, skip_bottom=True, jit=0.03)
    K.ring(fr_, Bo, -0.12, C, -0.2, BLUE, 0.75, skip_bottom=True)
    # the second order: from the outer frame's back into the door's own outline (a deep hollow chamfer)
    K.ring(fr_, C, -0.2, D, -0.32, BLUE, 0.85, skip_bottom=True)
    K.ring(fr_, D, -0.32, D, -depth, BLUE, 0.58, skip_bottom=True)
    if not open_:
        if kind == "basket":
            uvs = [(x, t) for x, t in DOOR4]
        else:
            uvs = [((p[0] - c + hw) / (2 * hw), p[1] / h) for p in D]
        K.pane(fr_, D, -depth, OAK, 0.9, uvs=uvs)
    # the hood mould over the arch, and its stops
    top = [p for p in outline(kind, c, hw + 0.44, 0.0, h + 0.42)[2:]]
    K.ribbon(fr_, top, 0.14, 0.0, 0.13, BLUE, 1.0)
    for s in (top[0][0], top[-1][0]):
        K.wbox(fr_, s - 0.12, s + 0.12, 0.0, 0.14, top[0][1] - 0.32, top[0][1] + 0.02, BLUE, 0.95)
    # the step
    K.wbox(fr_, c - hw - 0.34, c + hw + 0.34, -depth, 0.35, -0.1, 0.16, BLUE, 0.85)
    return A

# ------------------------------------------------ plinth, courses, buttresses
PLINTH = [(0.0, PL + 0.18), (0.15, PL), (0.15, -0.3), (0.0, -0.3)]

def course(y, proj, hh):
    """A moulded course: a weathered top, a flat face, a hollow under it."""
    return [(0.0, y + hh), (proj, y + hh * 0.62), (proj, y + hh * 0.3), (proj * 0.55, y + hh * 0.12), (0.0, y)]

def side_path(fr_, s0, s1, butts, lower):
    """The plan path along a side from s0 to s1, round the buttresses (lower: the lower stage), the outside to the
    right. Returns one path per run between the doors (openings cut it)."""
    pts = [WP(fr_, s0, 0, 0)[:2]]
    for s, w0, e0, w1, e1 in butts:
        w, e = (w0, e0) if lower else (w1, e1)
        pts += [WP(fr_, s - w, 0, 0)[:2], WP(fr_, s - w, e, 0)[:2], WP(fr_, s + w, e, 0)[:2], WP(fr_, s + w, 0, 0)[:2]]
    pts.append(WP(fr_, s1, 0, 0)[:2])
    return pts

def split_path(fr_, s0, s1, gaps, butts, lower):
    runs = []
    a = s0
    for g0, g1 in sorted(gaps) + [(s1, s1)]:
        if g0 - a > 0.05:
            runs.append(side_path(fr_, a, g0, [b for b in butts if a < b[0] < g0], lower))
        a = g1
    return runs

def buttress(fr_, s, w0, e0, w1, e1, ya, yb, yc, yd=None, pin=None):
    """A stepped buttress: a banded lower stage, a sandstone water table, the narrower upper stage, a weathered
    cap into the wall (yd) or a pinnacle (pin)."""
    for (y0, y1, w, e) in ((PL, ya, w0, e0), (yb, yc, w1, e1)):
        K.wbox(fr_, s - w, s + w, 0.0, e, y0, y1, BANDS, 1.0, top=False)
    for (y0, y1, wa, ea, wb, eb) in ((ya, yb, w0, e0, w1, e1),) + (((yc, yd, w1, e1, w1, 0.0),) if yd else ()):
        ww = wa + 0.05
        K.m.poly([WP(fr_, s - ww, ea + 0.06, y0), WP(fr_, s + ww, ea + 0.06, y0), WP(fr_, s + wb + 0.02, eb, y1), WP(fr_, s - wb - 0.02, eb, y1)], SAND, 1.05, odir(fr_, 1, 1), jit=0.03)
        K.m.poly([WP(fr_, s - ww, ea + 0.06, y0 - 0.1), WP(fr_, s + ww, ea + 0.06, y0 - 0.1), WP(fr_, s + ww, ea + 0.06, y0), WP(fr_, s - ww, ea + 0.06, y0)], SAND, 0.9, odir(fr_))
        for sg in (-1, 1):
            sw = s + sg * ww
            K.m.poly([WP(fr_, sw, ea + 0.06, y0 - 0.1), WP(fr_, sw, ea + 0.06, y0), WP(fr_, s + sg * (wb + 0.02), eb, y1), WP(fr_, s + sg * (wb + 0.02), eb, y0 - 0.1), WP(fr_, sw, 0, y0 - 0.1)][:4],
                     SAND, 0.85, (fr_[1][0] * sg, fr_[1][1] * sg, 0))
            if wa > wb + 0.03:  # the step's top between the wider and the narrower stage
                K.m.poly([WP(fr_, s + sg * ww, ea + 0.06, y0), WP(fr_, s + sg * (wb + 0.02), ea + 0.06, y0), WP(fr_, s + sg * (wb + 0.02), 0, y0), WP(fr_, s + sg * ww, 0, y0)], SAND, 1.0, (0, 0, 1))
    if pin:
        K.wbox(fr_, s - w1 - 0.1, s + w1 + 0.1, -0.1, e1 + 0.1, yc, yc + 0.25, SAND, 1.05, jit=0.03)
        pinnacle(WP(fr_, s, e1 / 2, 0)[:2], yc + 0.25, pin, w1 * 0.8)

def pinnacle(c, y0, h, r):
    """A square sandstone pinnacle: a shaft with little gablets, a crocketed spirelet, a finial."""
    ring = m.ngon(c[0], c[1], r * 1.41, 4, math.pi / 4)
    m.prism(ring, y0, y0 + h * 0.42, SAND, 1.0, top=False, jit=0.03)
    m.prism(m.ngon(c[0], c[1], r * 1.41 + 0.07, 4, math.pi / 4), y0 + h * 0.42, y0 + h * 0.47, SAND, 1.08, top=True)
    m.pyramid(m.ngon(c[0], c[1], r * 1.2, 4, math.pi / 4), y0 + h * 0.47, y0 + h * 0.93, SAND, 1.02)
    for k in range(3):  # crockets: small knobs up the edges
        yk = y0 + h * (0.55 + 0.12 * k)
        rk = r * 1.2 * (1 - (yk - y0 - h * 0.47) / (h * 0.46)) + 0.06
        for q in m.ngon(c[0], c[1], rk, 4, math.pi / 4):
            m.box(q[0] - 0.05, q[0] + 0.05, q[1] - 0.05, q[1] + 0.05, yk, yk + 0.1, SAND, 1.05)
    m.prism(m.ngon(c[0], c[1], 0.09, 6), y0 + h * 0.88, y0 + h, SAND, 1.05)
    m.box(c[0] - 0.02, c[0] + 0.02, c[1] - 0.02, c[1] + 0.02, y0 + h, y0 + h + 0.5, LEAD, 0.6)

def anchor(fr_, s, y, e=0.0, big=False):
    """A wrought-iron wall anchor: an upright bar with curled ends (the ends of the floor beams)."""
    hh = 0.42 if big else 0.32
    K.wbox(fr_, s - 0.025, s + 0.025, e, e + 0.04, y - hh, y + hh, LEAD, 0.5, top=True)
    for sg in (-1, 1):
        yy = y + sg * hh
        K.wbox(fr_, s - 0.02, s + 0.1, e, e + 0.04, yy - 0.02, yy + 0.02, LEAD, 0.5)
        K.wbox(fr_, s + 0.08, s + 0.12, e, e + 0.04, yy - (0.1 if sg > 0 else -0.02), yy + (0.02 if sg > 0 else 0.1), LEAD, 0.5)
    K.wbox(fr_, s - 0.05, s + 0.05, e, e + 0.05, y - 0.05, y + 0.05, LEAD, 0.45)


def vleeshuis():
    # ------------------------------------------------ the long sides
    def long_side(fr_, door_u, name_side):
        c_of = [(a + b) / 2 for a, b in zip(BL, BL[1:])]
        holes = []
        butts = []
        for s in BL[1:-1]:
            if fr_ is S and abs(s - TWR[0]) < 0.5:
                continue  # the stair tower stands here
            butts.append((su(fr_, s), 0.55, 1.25, 0.45, 0.8))
        butts.sort()
        for i, c in enumerate(c_of):
            cs = su(fr_, c)
            is_door = abs(c - door_u) < 0.1
            var = (i + (fr_ is N)) % 2
            if is_door:
                holes.append(door(fr_, cs, 0.9, 3.36, 0.9, "basket", open_=True))
                holes.append(window_hall(fr_, cs, 4.32, 9.36, 1.1, var))
            else:
                holes.append(window_hall(fr_, cs, 2.88, 9.36, 1.2, var))
                grille(fr_, cs)
            holes.append(window_cross(fr_, cs, 10.56, 14.4, 0.96, (i + (fr_ is N)) % 3 == 0))
            for dx in (-1.62, 1.62):
                anchor(fr_, cs + dx, 10.2)
                anchor(fr_, cs + dx, 15.7, big=True)
        s0, s1 = sorted((su(fr_, U0), su(fr_, U1)))
        K.wall(fr_, s0, s1, PL - 0.02, H, holes)
        dsc = su(fr_, door_u)
        gaps = [(dsc - 1.24, dsc + 1.24)]
        for run in split_path(fr_, s0, s1, gaps, butts, True):
            K.sweep(run, PLINTH, SAND, 0.72, jit=0.04)
        for sb, w0, e0, w1, e1 in butts:
            buttress(fr_, sb, w0, e0, w1, e1, 9.0, SC, 15.4, 16.5)
        for run in split_path(fr_, s0, s1, [], butts, False):
            K.sweep(run, course(SC, 0.16, 0.24), SAND, 1.0)
        # the eaves: a moulded cornice with a lead gutter on it
        cor = [(0.0, H + 0.06), (0.42, H + 0.06), (0.42, H - 0.1), (0.3, H - 0.18), (0.22, H - 0.3), (0.0, H - 0.38)]
        K.sweep([WP(fr_, s0 - 0.3, 0, 0)[:2], WP(fr_, s1 + 0.3, 0, 0)[:2]], cor, SAND, 1.0)
        K.wbox(fr_, s0 - 0.3, s1 + 0.3, 0.08, 0.4, H + 0.06, H + 0.24, LEAD, 0.6)
        # downpipes beside four buttresses, with hopper heads and brackets
        for k, (sb, w0, e0, _, _) in enumerate(butts):
            if k % 2:
                continue
            sp = sb + w0 + 0.3
            if abs(sp - dsc) < 1.7:
                sp = sb - w0 - 0.3
            K.wbox(fr_, sp - 0.07, sp + 0.07, 0.18, 0.32, PL + 0.2, H - 0.45, LEAD, 0.55)
            K.wbox(fr_, sp - 0.2, sp + 0.2, 0.12, 0.44, H - 0.72, H - 0.38, LEAD, 0.55)
            K.wbox(fr_, sp - 0.06, sp + 0.06, 0.2, 0.34, H - 0.38, H + 0.08, LEAD, 0.55)
            K.wbox(fr_, sp - 0.1, sp + 0.1, 0.18, 0.5, PL + 0.02, PL + 0.2, LEAD, 0.5)
            for y in (3.0, 6.0, 12.0, 14.8):
                K.wbox(fr_, sp - 0.1, sp + 0.1, 0.0, 0.2, y, y + 0.05, LEAD, 0.45)

    long_side(S, DOOR_S, "south")
    long_side(N, DOOR_N, "north")

    # ------------------------------------------------ the stepped wall dormers at the eaves (Linnig 1849 and 1855)
    for fr_ in (S, N):
        for a, b in zip(BL, BL[1:]):
            sc = su(fr_, (a + b) / 2)
            yd = H + 1.92
            hol = window_small(fr_, sc, H + 0.34, 1.34, 0.62, int(abs(sc)) % 2 == 1, arch_over=False)
            K.wall(fr_, sc - 1.2, sc + 1.2, H + 0.06, yd, [hol])
            stepped(fr_, sc - 1.2, sc + 1.2, yd, 2, 0.72, 0.72, 0.3, cope=0.12, finial=False)
            yr = yd + 1.2
            er, ee = -(yr - H) / SLOPE - 0.1, -(yd - H) / SLOPE - 0.05
            for sg in (-1, 1):
                se = sc + sg * 1.2
                K.m.poly([WP(fr_, se, 0, H + 0.06), WP(fr_, se, 0, yd), WP(fr_, se, ee, yd)], BANDS, 0.85, (fr_[1][0] * sg, fr_[1][1] * sg, 0))
                K.m.poly([WP(fr_, sc + sg * 1.28, -0.3, yd - 0.05), WP(fr_, sc, -0.3, yr), WP(fr_, sc, er, yr), WP(fr_, sc + sg * 1.28, ee - 0.05, yd - 0.05)], SLATE, 0.95,
                         (fr_[1][0] * sg, fr_[1][1] * sg, 1))
            K.wbox(fr_, sc - 0.06, sc + 0.06, er, -0.3, yr - 0.02, yr + 0.08, LEAD, 0.6)

    # ------------------------------------------------ the steep slate roof, four rows of dormers a slope, the ridge
    over = 0.1
    ye = H - over * SLOPE
    for side, vv in ((-1, V0 - over), (1, V1 + over)):
        m.poly([(U0 + 0.3, vv, ye), (U1 - 0.3, vv, ye), (U1 - 0.3, VM, H + RISE), (U0 + 0.3, VM, H + RISE)], SLATE, 1.0, (0, side, 1))
        fr_ = S if side < 0 else N
        rows = ((H + 5.2, 1.15, 1.55, (-15.0, -9.0, -3.0, 3.0, 9.0, 15.0)), (H + 7.8, 1.0, 1.35, (-12.0, -6.0, 0.0, 6.0, 12.0)),
                (H + 10.1, 0.85, 1.15, (-9.0, -3.0, 3.0, 9.0)), (H + 11.9, 0.7, 0.95, (-6.0, 0.0, 6.0)))
        for yb, w, hf, row in rows:
            for u in row:
                if side < 0 and abs(u - TWR[0]) < 2.4 and yb < H + 8:
                    continue
                roof_dormer(fr_, su(fr_, u), yb, w, hf)
    m.box(U0 + 0.3, U1 - 0.3, VM - 0.13, VM + 0.13, H + RISE - 0.06, H + RISE + 0.14, LEAD, 0.6)
    # two chimneys (the theatre's stove at the east end, the studio's at the west)
    for cu in (-16.8, 18.6):
        cv = VM + 2.3
        yr = H + RISE - (cv - VM) * SLOPE
        m.box(cu - 0.45, cu + 0.45, cv - 0.32, cv + 0.32, yr - 1.0, yr + 2.3, BANDS, 1.0, top=False)
        m.box(cu - 0.56, cu + 0.56, cv - 0.43, cv + 0.43, yr + 2.3, yr + 2.46, SAND, 1.05)
        m.box(cu - 0.4, cu + 0.4, cv - 0.27, cv + 0.27, yr + 2.46, yr + 2.7, BANDS, 1.0, top=False)
        m.poly([(cu - 0.4, cv - 0.27, yr + 2.62), (cu + 0.4, cv - 0.27, yr + 2.62), (cu + 0.4, cv + 0.27, yr + 2.62), (cu - 0.4, cv + 0.27, yr + 2.62)], LEAD, 0.15, (0, 0, 1))
        for dx in (-0.18, 0.18):
            m.prism(m.ngon(cu + dx, cv, 0.11, 8), yr + 2.46, yr + 2.95, LEAD, 0.4, top=False)

    # ------------------------------------------------ the gable ends
    for fr_, front in ((E, True), (Wf, False)):
        s0, s1 = sorted((su(fr_, V0), su(fr_, V1)))
        mid = su(fr_, 0.8)
        bays = [su(fr_, -2.7), su(fr_, 4.4)]
        holes = []
        for i, c in enumerate(bays):
            if front:
                # "a round-arched door in the first bay, a wider basket-arched one in the second" (the inventory)
                if i == 0:
                    holes.append(door(fr_, c, 0.75, 3.36, 0.6, "round", open_=False))
                else:
                    holes.append(door(fr_, c, 1.0, 3.36, 0.6, "basket", open_=False))
                holes.append(window_hall(fr_, c, 4.32, 9.36, 1.2, i))
            else:
                holes.append(window_hall(fr_, c, 2.64, 9.36, 1.3, 1 - i))
                grille(fr_, c)
            holes.append(window_cross(fr_, c, 10.56, 14.4, 0.96, False))
            holes.append(window_small(fr_, c, 14.88, 1.44, 0.64, i == 1, arch_over=False))
        K.wall(fr_, s0, s1, PL - 0.02, H, holes)
        butts = [(mid, 0.6, 1.1, 0.45, 0.75)]
        gaps = [(c - (1.09 if (front and i == 0) else 1.34), c + (1.09 if (front and i == 0) else 1.34)) for i, c in enumerate(bays)] if front else []
        for run in split_path(fr_, s0, s1, gaps, butts, True):
            K.sweep(run, PLINTH, SAND, 0.72, jit=0.04)
        buttress(fr_, mid, 0.6, 1.1, 0.45, 0.75, 9.0, SC, H + 0.96, pin=3.4)
        for run in split_path(fr_, s0, s1, [], butts, False):
            K.sweep(run, course(SC, 0.16, 0.24), SAND, 1.0)
        K.sweep([WP(fr_, s0, 0, 0)[:2], WP(fr_, s1, 0, 0)[:2]], course(H - 0.22, 0.14, 0.22), SAND, 1.0)
        steps = 10 if front else 9
        win = {1: (-3.65, -1.75, 3.45, 5.35), 3: (-2.7, 4.4), 5: (-1.9, 3.4), 7: (0.75,)}
        gw = {k: [su(fr_, v) for v in vs] for k, vs in win.items()}
        stepped(fr_, s0, s1, H, steps, 1.44, 1.44, 0.5, windows=gw, oculus_row=9 if front else 8, oculus_s=su(fr_, 0.75))
        for y in (10.2, 15.7):
            for v in (-5.6, 2.6, 7.3):
                anchor(fr_, su(fr_, v), y, big=y > 12)

    # ------------------------------------------------ the corner turrets and the stair tower
    rot = math.pi / 6
    tower(-21.4, -7.1, 1.9, 6, rot, H - 0.6, 22.08, 32.2,
          wins=((math.pi * 4 / 3, 4.8, "madonna"), (math.pi, 3.84, "slit"), (math.pi, 8.64, "slit"), (math.pi * 4 / 3, 12.0, "slit"), (math.pi, 13.92, "small")),
          top_wins=(math.pi, math.pi * 4 / 3, math.pi * 2 / 3))
    for cu, cv, r, sg_u, sg_v in ((-21.8, 8.6, 1.55, -1, 1), (21.6, 8.6, 1.55, 1, 1), (21.7, -7.0, 1.6, 1, -1)):
        out = math.atan2(sg_v, sg_u)
        tower(cu, cv, r, 6, rot, H - 0.6, 20.64, 27.9, wins=((out, 5.28, "slit"), (out + 0.5 * sg_u * sg_v, 10.08, "slit")), top_wins=(out, out + 1.0, out - 1.0))
    tu, tv, tr = TWR
    tower(tu, tv, tr, 8, math.pi / 8, 23.52, 26.4, 34.4,
          wins=((-math.pi / 2, 0.0, "door"),) + tuple((-math.pi / 2 + (k % 3 - 1) * math.pi / 4, 3.84 + k * 3.84, "slit") for k in range(5)),
          top_wins=(-math.pi / 2, -math.pi / 4, -3 * math.pi / 4, 0.0, math.pi), stair=True)
    return m



def stepped(fr, s0, s1, y0, steps, hs, crown, thick, cope=0.16, windows=None, oculus_row=None, oculus_s=None, finial=True):
    """A stepped gable with thickness on a wall top: banded rows (the small windows cut through them), plain banded
    step ends and back, a sandstone coping on every step with a drip, a finial on the crown."""
    w = (s1 - s0) / (2 * steps + 1)
    rows = []
    for k in range(steps + 1):
        ya = y0 + k * hs
        yb = ya + (hs if k < steps else crown)
        rows.append((s0 + k * w, s1 - k * w, ya, yb))
    windows = windows or {}
    p, d, o = fr
    for k, (a, b, ya, yb) in enumerate(rows):
        holes = []
        for c in windows.get(k, ()):
            holes.append(window_small(fr, c, ya + 0.06, hs - 0.12, 0.6, (k + int(c * 3)) % 3 == 0))
        if oculus_row is not None and k == oculus_row:
            holes.append(oculus(fr, oculus_s, ya + (yb - ya) / 2 - 0.4))
        K.wall(fr, a, b, ya, yb, holes)
        K.wall(((p[0] + o[0] * -thick, p[1] + o[1] * -thick), d, (-o[0], -o[1])), a, b, ya, yb, mat=BANDS, shade=0.85)
        for sx, sg in ((a, -1), (b, 1)):
            m.poly([WP(fr, sx, 0, ya), WP(fr, sx, -thick, ya), WP(fr, sx, -thick, yb), WP(fr, sx, 0, yb)], BANDS, 0.9, (d[0] * sg, d[1] * sg, 0))
    for k in range(steps):
        a0, b0, _, yk = rows[k]
        a1, b1 = rows[k + 1][0], rows[k + 1][1]
        for lo, hi in ((a0 - 0.07, a1 + 0.02), (b1 - 0.02, b0 + 0.07)):
            K.wbox(fr, lo, hi, -thick - 0.07, 0.09, yk, yk + cope, SAND, 1.06, jit=0.04)
            K.wbox(fr, lo + 0.03, hi - 0.03, 0.05, 0.1, yk - 0.05, yk, SAND, 0.8, top=False)
    a, b, _, yt = rows[-1]
    K.wbox(fr, a - 0.07, b + 0.07, -thick - 0.07, 0.09, yt, yt + cope, SAND, 1.06)
    if finial:
        c = WP(fr, (a + b) / 2, -thick / 2, 0)[:2]
        m.prism(m.ngon(c[0], c[1], 0.3, 4, math.pi / 4), yt + cope, yt + cope + 0.5, SAND, 1.0, jit=0.03)
        m.prism(m.ngon(c[0], c[1], 0.36, 4, math.pi / 4), yt + cope + 0.5, yt + cope + 0.6, SAND, 1.06)
        m.pyramid(m.ngon(c[0], c[1], 0.26, 4, math.pi / 4), yt + cope + 0.6, yt + cope + 1.4, SAND, 1.0)
        m.box(c[0] - 0.025, c[0] + 0.025, c[1] - 0.025, c[1] + 0.025, yt + cope + 1.3, yt + cope + 2.2, LEAD, 0.55)
        m.prism(m.ngon(c[0], c[1], 0.08, 6), yt + cope + 1.9, yt + cope + 2.02, LEAD, 0.6)
    return rows


def roof_dormer(fr, s, yb, w, hf):
    """A small dormer on a slope of the main roof (its front where the roof stands yb high): an oak front with a
    leaded window, slate cheeks, a small pitched slate roof with a lead ridge."""
    def e_at(y):
        return -(y - H) / SLOPE
    ef = e_at(yb) + 0.04
    yw = yb + 0.62 * hf
    yt = yb + hf
    e1, e2 = e_at(yw), e_at(yt)
    front = [(s - w / 2, yb), (s + w / 2, yb), (s + w / 2, yw), (s, yt), (s - w / 2, yw)]
    win = outline("rect", s, w / 2 - 0.12, yb + 0.1, 0.62 * hf - 0.18)
    K.wall(((WP(fr, 0, ef, 0)[0], WP(fr, 0, ef, 0)[1]), fr[1], fr[2]), s - w / 2, s + w / 2, yb, yw, [win], mat=OAK, shade=0.85)
    K.m.poly([WP(fr, s - w / 2, ef, yw), WP(fr, s + w / 2, ef, yw), WP(fr, s, ef, yt)], OAK, 0.85, odir(fr))
    K.ring(fr, win, ef, win, ef - 0.08, OAK, 0.6)
    K.pane(fr, win, ef - 0.08, GLASS, 1.0)
    K.ribbon(fr, [(s, yb + 0.1), (s, yb + 0.62 * hf - 0.08)], 0.05, ef - 0.08, ef - 0.03, OAK, 0.8)
    for sg in (-1, 1):
        x = s + sg * w / 2
        K.m.poly([WP(fr, x, ef, yb), WP(fr, x, ef, yw), WP(fr, x, e1, yw)], SLATE, 0.8, (fr[1][0] * sg, fr[1][1] * sg, 0))
        K.m.poly([WP(fr, x + sg * 0.08, ef + 0.1, yw - 0.05), WP(fr, s, ef + 0.1, yt + 0.03), WP(fr, s, e2, yt + 0.03), WP(fr, x + sg * 0.08, e1, yw - 0.05)], SLATE, 1.0,
                 (fr[1][0] * sg + fr[2][0] * 0.2, fr[1][1] * sg + fr[2][1] * 0.2, 1))
    K.wbox(fr, s - 0.04, s + 0.04, e2, ef + 0.1, yt + 0.01, yt + 0.09, LEAD, 0.6)


def tower(cu, cv, r, sides, rot, yb, yt, apex, wins=(), top_wins=(), stair=False):
    """A corbelled stair turret: the plinth, a banded shaft to yb (the faces inside the hall left out), three
    sandstone corbel courses out to the wider top stage (whole, over the roofs) with small windows and white
    quoins, a corbel table and cornice, a kinked slate spire, a wrought-iron vane."""
    def inside(a, b):
        mu, mv = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        return U0 + 0.05 < mu < U1 - 0.05 and V0 + 0.05 < mv < V1 - 0.05

    def faces(rad, y0, y1, holes_at=None, skip_inside=True, mat=BANDS, shade=1.0):
        ring = m.ngon(cu, cv, rad, sides, rot)
        for i in range(sides):
            a, b = ring[i], ring[(i + 1) % sides]
            if skip_inside and inside(a, b):
                continue
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            on = math.hypot(mid[0] - cu, mid[1] - cv)
            fr = (a, ((b[0] - a[0]) / L, (b[1] - a[1]) / L), ((mid[0] - cu) / on, (mid[1] - cv) / on))
            ang = math.atan2(mid[1] - cv, mid[0] - cu)
            holes = holes_at(fr, L, ang) if holes_at else []
            K.wall(fr, 0.0, L, y0, y1, holes, mat=mat, shade=shade)

    def near(ang, a):
        return abs((ang - a + math.pi) % (2 * math.pi) - math.pi) < math.pi / sides + 1e-3

    # the plinth (not across a door)
    doors = [a for a, _, kind in wins if kind == "door"]

    def at_door(a, b):
        ang = math.atan2((a[1] + b[1]) / 2 - cv, (a[0] + b[0]) / 2 - cu)
        return any(near(ang, d) for d in doors)

    ro, ri = m.ngon(cu, cv, r + 0.15, sides, rot), m.ngon(cu, cv, r, sides, rot)
    for i in range(sides):
        a, b = ro[i], ro[(i + 1) % sides]
        if inside(a, b) or at_door(a, b):
            continue
        m.poly([(a[0], a[1], -0.3), (b[0], b[1], -0.3), (b[0], b[1], PL), (a[0], a[1], PL)], SAND, 0.72, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0), jit=0.04)
        c, d = ri[(i + 1) % sides], ri[i]
        m.poly([(a[0], a[1], PL), (b[0], b[1], PL), (c[0], c[1], PL + 0.18), (d[0], d[1], PL + 0.18)], SAND, 0.8, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.5))

    def shaft_holes(fr, L, ang):
        hs = []
        for a, y0, kind in wins:
            if not near(ang, a):
                continue
            if kind == "slit":
                hs.append(slit(fr, L / 2, y0))
            elif kind == "small":
                hs.append(window_small(fr, L / 2, y0, 1.44, 0.6, False))
            elif kind == "madonna":
                hs.append(niche(fr, L / 2, y0))
            elif kind == "door":  # the stair's own small door, shut
                hs.append(door(fr, L / 2, 0.36, 2.1, 0.3, "round", open_=False))
        return hs

    y_shaft = min(yb, H)
    faces(r, PL - 0.02, y_shaft, shaft_holes)
    if yb > H:
        faces(r, H, yb, shaft_holes, skip_inside=False)
    # the corbelling: three courses stepping out
    R2 = r + 0.3
    rr, yy = r, yb
    for k in range(3):
        rn = r + 0.1 * (k + 1)
        m.frustum(m.ngon(cu, cv, rr, sides, rot), yy, m.ngon(cu, cv, rn, sides, rot), yy + 0.08, SAND, 0.85, jit=0.03)
        m.prism(m.ngon(cu, cv, rn, sides, rot), yy + 0.08, yy + 0.2, SAND, 1.02, top=False, jit=0.03)
        rr, yy = rn, yy + 0.2
    ys = yy
    yw = math.ceil((ys + 0.5) / VP) * VP  # the windows on a whole band

    def top_holes(fr, L, ang):
        return [window_small(fr, L / 2, yw, 1.44, 0.46, False, arch_over=False)] if any(near(ang, a) for a in top_wins) else []

    faces(R2, ys, yt, top_holes, skip_inside=False)
    for q in m.ngon(cu, cv, R2 + 0.02, sides, rot):  # white stone quoins on the corners, long and short
        y, k = ys, 0
        while y + 0.12 < yt - 0.05:
            hq = 0.36 if k % 2 == 0 else 0.12
            hq = min(hq, yt - y)
            e = 0.12 if k % 2 == 0 else 0.08
            m.box(q[0] - e, q[0] + e, q[1] - e, q[1] + e, y, y + hq, SAND, 1.05, top=False, jit=0.04)
            y += hq
            k += 1
    # a corbel table under the cornice: small corbels along each face
    ring = m.ngon(cu, cv, R2, sides, rot)
    for i in range(sides):
        a, b = ring[i], ring[(i + 1) % sides]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        on = math.hypot(mid[0] - cu, mid[1] - cv)
        fr = (a, ((b[0] - a[0]) / L, (b[1] - a[1]) / L), ((mid[0] - cu) / on, (mid[1] - cv) / on))
        n = max(2, int(L / 0.5))
        for k in range(n):
            s = L * (k + 0.5) / n
            K.wbox(fr, s - 0.07, s + 0.07, 0.0, 0.14, yt - 0.42, yt - 0.12, SAND, 0.95)
            K.m.poly([WP(fr, s - 0.07, 0.14, yt - 0.42), WP(fr, s + 0.07, 0.14, yt - 0.42), WP(fr, s + 0.07, 0.0, yt - 0.56), WP(fr, s - 0.07, 0.0, yt - 0.56)], SAND, 0.75, odir(fr, 1, -1))
    m.frustum(m.ngon(cu, cv, R2, sides, rot), yt - 0.12, m.ngon(cu, cv, R2 + 0.2, sides, rot), yt + 0.12, SAND, 0.85)
    m.prism(m.ngon(cu, cv, R2 + 0.2, sides, rot), yt + 0.12, yt + 0.34, SAND, 1.06, top=False, jit=0.03)
    # the kinked spire: a flared foot, then the steep spire
    yk = yt + 0.34 + 0.95
    m.frustum(m.ngon(cu, cv, R2 + 0.42, sides, rot), yt + 0.26, m.ngon(cu, cv, r * 0.66, sides, rot), yk, SLATE, 1.0)
    m.pyramid(m.ngon(cu, cv, r * 0.66, sides, rot), yk, apex, SLATE, 1.0)
    # the vane: a rod, a ball, a pennant and a cross
    m.box(cu - 0.035, cu + 0.035, cv - 0.035, cv + 0.035, apex - 0.3, apex + 1.9, LEAD, 0.55)
    m.prism(m.ngon(cu, cv, 0.13, 8), apex + 0.25, apex + 0.5, LEAD, 0.6, bottom=True)
    m.box(cu - 0.012, cu + 0.012, cv, cv + 0.7, apex + 1.1, apex + 1.45, LEAD, 0.5, top=True)
    m.box(cu - 0.3, cu + 0.3, cv - 0.015, cv + 0.015, apex + 0.8, apex + 0.84, LEAD, 0.5)
    m.box(cu - 0.015, cu + 0.015, cv - 0.3, cv + 0.3, apex + 0.8, apex + 0.84, LEAD, 0.5)


def niche(fr, c, yb):
    """The Madonna's niche on the south-east turret: a pointed recess with a sandstone frame, a small crocketed
    canopy over it, and the statue on her corbel (a picture) standing in it."""
    hw, h = 0.55, 2.6
    A = outline("pointed", c, hw, yb, h, 0.72)
    Bo = inset("pointed", c, hw, yb, h, 0.1, 0.1, 0.72)
    K.ring(fr, A, 0.0, Bo, -0.1, SAND, 1.0)
    K.ring(fr, Bo, -0.1, Bo, -0.34, SAND, 0.45)
    K.pane(fr, Bo, -0.34, SAND, 0.3)
    # the statue on her carved corbel (both in the picture), a little in front of the niche's back
    K.m.poly([WP(fr, c - 0.43, -0.2, yb + 0.1), WP(fr, c + 0.43, -0.2, yb + 0.1), WP(fr, c + 0.43, -0.2, yb + 2.45), WP(fr, c - 0.43, -0.2, yb + 2.45)], MADONNA, 1.0, odir(fr),
             uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # the canopy: a gablet with crockets and a finial
    yc = yb + h + 0.05
    for sg in (-1, 1):
        K.m.poly([WP(fr, c + sg * (hw + 0.1), 0.12, yc), WP(fr, c, 0.12, yc + 0.8), WP(fr, c, -0.05, yc + 0.8), WP(fr, c + sg * (hw + 0.1), -0.05, yc)], SAND, 1.0,
                 odir(fr, 0.3, 1))
        for k in range(3):
            t = (k + 0.5) / 3
            K.wbox(fr, c + sg * (hw + 0.1) * (1 - t) - 0.05, c + sg * (hw + 0.1) * (1 - t) + 0.05, 0.08, 0.18, yc + 0.8 * t, yc + 0.8 * t + 0.1, SAND, 1.05)
    K.m.poly([WP(fr, c - hw - 0.1, 0.12, yc), WP(fr, c + hw + 0.1, 0.12, yc), WP(fr, c, 0.12, yc + 0.8)], SAND, 1.0, odir(fr))
    K.wbox(fr, c - 0.05, c + 0.05, 0.0, 0.12, yc + 0.8, yc + 1.15, SAND, 1.05)
    return A


def build():
    global m, K
    city = json.load(open(CITY))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, rgb in zip(MATS, MAT_RGB):
        mt = bpy.data.materials.new(name)
        mt.diffuse_color = (*rgb, 1)
        bsdf = mt.node_tree.nodes.get("Principled BSDF") if mt.node_tree else None
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*rgb, 1)
            bsdf.inputs["Roughness"].default_value = 1.0
    fr = Frame(city["landmarks"]["vleeshuis"]["frame"])
    m = VMesh(fr)
    K = Kit(m)
    vleeshuis()
    ob = m.to_object("vleeshuis_shell")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=18, export_draco_texcoord_quantization=16)
    print(f"[build_vleeshuis] {ob.name}: {m.tris} triangles -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    build()

"""Build the landmarks of 1873 Antwerp in Blender and export them for the game.

    blender -b -P tools/blender/build_landmarks.py

Reads the landmark outlines and frames from shared/city.json (tools/city/plan.py,
outlines from OpenStreetMap) and writes client/public/models/landmarks.glb.
Each landmark is built in its own frame: u along the long axis (towards the
east for churches), v across it, y up. Sizes come from the real buildings where
known (cathedral north tower 123 m, nave about 118 m long) and are fitted to the
outline.

Materials (the game swaps them by name): stone, slate, glass, brickband, lead.
UVs are box-projected in metres / 3.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
OUT = os.path.join(ROOT, "client", "public", "models", "landmarks.glb")

MATS = ["stone", "slate", "glass", "brickband", "lead"]
STONE, SLATE, GLASS, BRICK, LEAD = range(5)


def B(x, y, z):
    return Vector((x, -z, y))


class Frame:
    """Local (u, v, y) of a landmark -> world (x, y, z)."""

    def __init__(self, f, flip_v=False):
        self.c = f["c"]
        self.ax = f["ax"]
        self.n = f["n"]
        if flip_v:
            self.n = [-self.n[0], -self.n[1]]
        self.L = f["L"]
        self.W = f["W"]

    def w(self, u, v, y):
        return (self.c[0] + self.ax[0] * u + self.n[0] * v, y, self.c[1] + self.ax[1] * u + self.n[1] * v)


class Mesh:
    def __init__(self, frame):
        self.f = frame
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")

    def poly(self, pts, mat, shade=1.0):
        """pts in local (u, v, y). Faces are wound later from their centre outward."""
        vs = [self.bm.verts.new(B(*self.f.w(*p))) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        for loop in f.loops:
            loop[self.col] = (shade, shade, shade, 1.0)
        return f

    def orient(self, f, out_local):
        """Flip face f so it looks along a local direction (du, dv, dy)."""
        if f is None:
            return
        du, dv, dy = out_local
        wx = self.f.ax[0] * du + self.f.n[0] * dv
        wz = self.f.ax[1] * du + self.f.n[1] * dv
        f.normal_update()
        if f.normal.dot(B(wx, dy, wz)) < 0:
            f.normal_flip()

    # -------------------------------------------------------------- solids

    def prism(self, ring, y0, y1, mat, top=True, top_mat=None, shade=1.0):
        """A vertical prism over a local (u, v) ring, walls outward, optional flat top."""
        n = len(ring)
        cu = sum(p[0] for p in ring) / n
        cv = sum(p[1] for p in ring) / n
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            f = self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (b[0], b[1], y1), (a[0], a[1], y1)], mat, shade)
            mu, mv = (a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv
            # outward normal of the edge, pointing away from the centre
            eu, ev = b[0] - a[0], b[1] - a[1]
            nu, nv = ev, -eu
            if nu * mu + nv * mv < 0:
                nu, nv = -nu, -nv
            self.orient(f, (nu, nv, 0))
        if top:
            f = self.poly([(p[0], p[1], y1) for p in ring], top_mat if top_mat is not None else mat, shade)
            self.orient(f, (0, 0, 1))

    def box(self, u0, u1, v0, v1, y0, y1, mat, top=True, top_mat=None, shade=1.0):
        self.prism([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], y0, y1, mat, top, top_mat, shade)

    def ngon(self, cu, cv, r, sides, rot=0.0):
        return [(cu + r * math.cos(rot + 2 * math.pi * i / sides), cv + r * math.sin(rot + 2 * math.pi * i / sides)) for i in range(sides)]

    def pyramid(self, ring, y0, apex_y, mat, shade=1.0):
        n = len(ring)
        cu = sum(p[0] for p in ring) / n
        cv = sum(p[1] for p in ring) / n
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            f = self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (cu, cv, apex_y)], mat, shade)
            mu, mv = (a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv
            self.orient(f, (mu, mv, 0.3))

    def gable_roof(self, u0, u1, v0, v1, y, rise, along="u", mat=SLATE, gable_mat=STONE, over=0.4):
        """Pitched roof over a rectangle, ridge along u or v, with the two gable walls."""
        if along == "u":
            vm = (v0 + v1) / 2
            for vs, vo in ((v0 - over, -1), (v1 + over, 1)):
                f = self.poly([(u0, vs, y - over * rise / ((v1 - v0) / 2)), (u1, vs, y - over * rise / ((v1 - v0) / 2)), (u1, vm, y + rise), (u0, vm, y + rise)], mat)
                self.orient(f, (0, vo, 1))
            for ue, uo in ((u0, -1), (u1, 1)):
                f = self.poly([(ue, v0, y), (ue, v1, y), (ue, vm, y + rise)], gable_mat)
                self.orient(f, (uo, 0, 0))
        else:
            um = (u0 + u1) / 2
            for us, uo in ((u0 - over, -1), (u1 + over, 1)):
                f = self.poly([(us, v0, y - over * rise / ((u1 - u0) / 2)), (us, v1, y - over * rise / ((u1 - u0) / 2)), (um, v1, y + rise), (um, v0, y + rise)], mat)
                self.orient(f, (uo, 0, 1))
            for ve, vo in ((v0, -1), (v1, 1)):
                f = self.poly([(u0, ve, y), (u1, ve, y), (um, ve, y + rise)], gable_mat)
                self.orient(f, (0, vo, 0))

    def hip_roof(self, u0, u1, v0, v1, y, rise, mat=SLATE):
        """Hipped roof: ridge along the long side, four sloped faces."""
        um, vm = (u0 + u1) / 2, (v0 + v1) / 2
        if (u1 - u0) >= (v1 - v0):
            h = (v1 - v0) / 2
            r0, r1 = (u0 + h, vm), (u1 - h, vm)
        else:
            h = (u1 - u0) / 2
            r0, r1 = (um, v0 + h), (um, v1 - h)
        top0, top1 = (r0[0], r0[1], y + rise), (r1[0], r1[1], y + rise)
        c = [(u0, v0, y), (u1, v0, y), (u1, v1, y), (u0, v1, y)]
        faces = [
            ([c[0], c[1], top1, top0] if (u1 - u0) >= (v1 - v0) else [c[0], c[1], top0], (0, -1, 1)),
            ([c[2], c[3], top0, top1] if (u1 - u0) >= (v1 - v0) else [c[2], c[3], top1], (0, 1, 1)),
            ([c[1], c[2], top1] if (u1 - u0) >= (v1 - v0) else [c[1], c[2], top1, top0], (1, 0, 1)),
            ([c[3], c[0], top0] if (u1 - u0) >= (v1 - v0) else [c[3], c[0], top0, top1], (-1, 0, 1)),
        ]
        for pts, out in faces:
            self.orient(self.poly(pts, mat), out)

    def window(self, plane, a0, a1, y0, y1, pointed=True, mat=GLASS):
        """A (pointed) window on a wall plane. plane = ('u', value, outward sign) or ('v', value, sign);
        a0..a1 runs along the wall."""
        axis, val, sign = plane
        off = 0.06 * sign
        wmid = (a0 + a1) / 2
        top = y1 + ((a1 - a0) * 0.6 if pointed else 0)

        def P(a, y):
            return (val + off, a, y) if axis == "u" else (a, val + off, y)

        pts = [P(a0, y0), P(a1, y0), P(a1, y1)]
        if pointed:
            pts += [P(wmid, top)]
        pts += [P(a0, y1)]
        f = self.poly(pts, mat, 0.9)
        self.orient(f, (sign, 0, 0) if axis == "u" else (0, sign, 0))

    def pinnacle(self, u, v, y0, h, r=0.5, mat=STONE):
        ring = self.ngon(u, v, r, 4, math.pi / 4)
        self.prism(ring, y0, y0 + h * 0.45, mat, top=False)
        self.pyramid(ring, y0 + h * 0.45, y0 + h, mat)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        # box-projected UVs in metres / 3 (Blender coords: x = world x, y = -world z, z = up)
        uv = self.bm.loops.layers.uv.new("UVMap")
        for f in self.bm.faces:
            f.normal_update()
            n = f.normal
            if abs(n.z) > 0.7:
                for loop in f.loops:
                    co = loop.vert.co
                    loop[uv].uv = (co.x / 3, co.y / 3)
            else:
                tx, ty = -n.y, n.x
                L = math.hypot(tx, ty) or 1
                tx, ty = tx / L, ty / L
                for loop in f.loops:
                    co = loop.vert.co
                    loop[uv].uv = ((co.x * tx + co.y * ty) / 3, co.z / 3)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MATS:
            me.materials.append(bpy.data.materials[m])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ------------------------------------------------------------------ the cathedral


def cathedral(fr, world_north):
    """Onze-Lieve-Vrouwekathedraal. u = 0 at the west front, v > 0 to the north."""
    # which frame side is north
    ns = 1 if fr.n[0] * world_north[0] + fr.n[1] * world_north[1] > 0 else -1
    L, W = fr.L, fr.W
    m = Mesh(fr)
    u0 = -L / 2  # west front
    U = lambda u: u0 + u  # noqa: E731
    V = lambda v: v * ns  # noqa: E731
    sx = L / 118.0  # stretch along the axis to fit the outline
    nave_h, aisle_h, chapel_h = 28.0, 20.0, 14.5
    half_nave = 6.8
    inner = 14.0
    outer = min(W / 2 - 2, 26.5)
    t0, t1 = 60 * sx, 75 * sx  # transept
    choir_end = 98 * sx
    apse_r = 12.0

    def band(v0, v1):
        return (min(V(v0), V(v1)), max(V(v0), V(v1)))

    # --- outer chapels (7 aisles in all): walls and a row of little gables, one per bay
    for side in (-1, 1):
        va, vb = band(side * inner, side * outer)
        m.box(U(16 * sx), U(t0), va, vb, 0, chapel_h, STONE, top=False)
        bay = (t0 - 16 * sx) / 6
        for k in range(6):
            ua, ub = U(16 * sx + k * bay), U(16 * sx + (k + 1) * bay)
            m.gable_roof(ua + 0.3, ub - 0.3, va, vb, chapel_h, (ub - ua) * 0.8, along="v", over=0.2)
            wall_v = V(side * outer)
            m.window(("v", wall_v, side * ns), ua + bay * 0.25, ub - bay * 0.25, 3.5, chapel_h - 3.5)
            # a buttress with a pinnacle between the chapels
            m.box(ua - 0.5, ua + 0.5, min(wall_v, wall_v + V(side) * 1.4), max(wall_v, wall_v + V(side) * 1.4), 0, chapel_h - 1, STONE)
            m.pinnacle(ua, wall_v + V(side) * 0.7, chapel_h - 1, 4.5, 0.45)
        # the inner aisle: taller, a lean-to roof against the nave
        va, vb = band(side * half_nave, side * inner)
        m.box(U(16 * sx), U(choir_end), va, vb, 0, aisle_h, STONE, top=False)
        lo = V(side * inner)
        hi = V(side * half_nave)
        for ua, ub in ((U(16 * sx), U(t0)), (U(t1), U(choir_end))):
            f = m.poly([(ua, lo, aisle_h), (ub, lo, aisle_h), (ub, hi, nave_h - 2), (ua, hi, nave_h - 2)], SLATE)
            m.orient(f, (0, side * ns, 1))
            for k in range(int((ub - ua) / 7)):
                a = ua + 7 * k + 2
                m.window(("v", hi, side * ns), a, a + 2.8, aisle_h + 1.5, nave_h - 4)

    # --- nave and choir: the high roof
    m.box(U(12 * sx), U(choir_end), -half_nave, half_nave, 0, nave_h, STONE, top=False)
    m.gable_roof(U(12 * sx), U(choir_end), -half_nave, half_nave, nave_h, 14.5, along="u")
    # --- transept, as high as the nave, gable ends with a great window
    m.box(U(t0), U(t1), -outer - 4, outer + 4, 0, nave_h, STONE, top=False)
    m.gable_roof(U(t0), U(t1), -outer - 4, outer + 4, nave_h, 14.5 * (t1 - t0) / (2 * half_nave) * 0.55, along="v")
    for side in (-1, 1):
        m.window(("v", side * (outer + 4), side), U(t0) + 3, U(t1) - 3, 6, nave_h - 2)
    # --- apse: a polygon of 5/8 with a lower ring of chapels
    ring = []
    for i in range(9):
        a = -math.pi / 2 + math.pi * i / 8
        ring.append((U(choir_end) + apse_r * 0.55 * math.cos(a) * 1.0, half_nave * math.sin(a) * 1.0 * 1.0))
    ring = [(U(choir_end), -half_nave)] + [(U(choir_end) + half_nave * 0.9 * math.cos(-math.pi / 2 + math.pi * i / 6), half_nave * math.sin(-math.pi / 2 + math.pi * i / 6)) for i in range(7)] + [(U(choir_end), half_nave)]
    m.prism(ring, 0, nave_h, STONE, top=False)
    m.pyramid(ring[1:-1] + [(U(choir_end), 0)], nave_h, nave_h + 11, SLATE)
    chapels = [(U(choir_end) + (half_nave + 9) * math.cos(-math.pi / 2 + math.pi * i / 8), (half_nave + 9) * math.sin(-math.pi / 2 + math.pi * i / 8)) for i in range(9)]
    m.prism([(U(t1), -half_nave - 9)] + chapels + [(U(t1), half_nave + 9)], 0, chapel_h, STONE, top=True, top_mat=LEAD)
    for i in range(1, 8):
        a = -math.pi / 2 + math.pi * i / 8
        m.pinnacle(U(choir_end) + (half_nave + 9.6) * math.cos(a), (half_nave + 9.6) * math.sin(a), chapel_h, 4.0, 0.4)
    # --- crossing lantern: a baroque cupola over the crossing
    cu = U((t0 + t1) / 2)
    base = m.ngon(cu, 0, 5.2, 8, math.pi / 8)
    m.prism(base, nave_h + 10, nave_h + 20, STONE, top=False)
    for i in range(8):
        a = math.pi / 8 + 2 * math.pi * i / 8 + math.pi / 8
        m.window(("u", cu + 5.3 * math.cos(a), 1 if math.cos(a) > 0 else -1), 5.3 * math.sin(a) - 0.6, 5.3 * math.sin(a) + 0.6, nave_h + 12, nave_h + 17) if abs(math.cos(a)) > 0.9 else None
    dome = [m.ngon(cu, 0, r, 8, math.pi / 8) for r in (5.4, 4.8, 3.4, 1.4)]
    ys = [nave_h + 20, nave_h + 23, nave_h + 26, nave_h + 28]
    for i in range(3):
        for k in range(8):
            a, b = dome[i][k], dome[i][(k + 1) % 8]
            c, d = dome[i + 1][(k + 1) % 8], dome[i + 1][k]
            f = m.poly([(a[0], a[1], ys[i]), (b[0], b[1], ys[i]), (c[0], c[1], ys[i + 1]), (d[0], d[1], ys[i + 1])], LEAD)
            m.orient(f, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2, 0.5))
    lan = m.ngon(cu, 0, 1.2, 8, math.pi / 8)
    m.prism(lan, nave_h + 28, nave_h + 32, STONE, top=False)
    m.pyramid(lan, nave_h + 32, nave_h + 38, LEAD)

    # --- west front between the towers, with the great window and the portal
    fw = 11.5
    m.box(U(0), U(12 * sx), -fw, fw, 0, 38, STONE, top=False)
    m.gable_roof(U(0), U(12 * sx), -fw, fw, 38, 9, along="u", over=0.0)
    m.window(("u", U(0), -1), -5.5, 5.5, 14, 30)
    m.window(("u", U(0), -1), -2.4, 2.4, 0.2, 7.5, mat=LEAD)
    for vv in (-fw, fw):
        m.pinnacle(U(0) - 0.4, vv, 38, 7, 0.6)

    # --- the north tower, 123 m: square stages, then open octagons and the spire
    tv = V(fw + 7.5)
    tu = U(7.5)
    stages = [(0, 30, 7.6), (30, 58, 7.0), (58, 72, 6.3)]
    for y0, y1, h in stages:
        m.box(tu - h, tu + h, tv - h, tv + h, y0, y1, STONE, top=False)
        # corner buttresses, stepped
        for su in (-1, 1):
            for sv in (-1, 1):
                m.box(tu + su * h - 0.9, tu + su * h + 0.9, tv + sv * h - 0.9, tv + sv * h + 0.9, y0, y1 - 1.5, STONE, top=True)
                m.pinnacle(tu + su * h, tv + sv * h, y1 - 1.5, 6 if y1 > 40 else 4, 0.7)
        for sign in (-1, 1):
            # two tall lancets per face, and pinnacles on the middle of each side
            for off in (-0.5, 0.5):
                m.window(("u", tu + sign * h, sign), tv + off * h - h * 0.3, tv + off * h + h * 0.3, y0 + 4, y1 - 6)
                m.window(("v", tv + sign * h, sign), tu + off * h - h * 0.3, tu + off * h + h * 0.3, y0 + 4, y1 - 6)
            m.pinnacle(tu + sign * h, tv, y1 - 0.5, 4.5, 0.35)
            m.pinnacle(tu, tv + sign * h, y1 - 0.5, 4.5, 0.35)
    # gallery at 72 m, with a balustrade of little posts
    for k in range(-6, 7, 2):
        for su in (-1, 1):
            m.box(tu + su * 6.6 - 0.12, tu + su * 6.6 + 0.12, tv + k - 0.12, tv + k + 0.12, 73, 74.2, STONE)
            m.box(tu + k - 0.12, tu + k + 0.12, tv + su * 6.6 - 0.12, tv + su * 6.6 + 0.12, 73, 74.2, STONE)
    m.box(tu - 6.8, tu + 6.8, tv - 6.8, tv + 6.8, 72, 73, STONE)
    # first octagon, open tracery (dark openings), eight slender pinnacles around it
    o1 = m.ngon(tu, tv, 5.0, 8, math.pi / 8)
    m.prism(o1, 73, 96, STONE, top=False)
    for k in range(8):
        a = math.pi / 8 + 2 * math.pi * k / 8 + math.pi / 8
        pu, pv = tu + 5.05 * math.cos(a), tv + 5.05 * math.sin(a)
        # a tall dark opening on each face of the octagon
        f = m.poly([(pu - 0.9 * math.sin(a), pv + 0.9 * math.cos(a), 76), (pu + 0.9 * math.sin(a), pv - 0.9 * math.cos(a), 76),
                    (pu + 0.9 * math.sin(a), pv - 0.9 * math.cos(a), 91), (pu, pv, 93), (pu - 0.9 * math.sin(a), pv + 0.9 * math.cos(a), 91)], GLASS, 0.8)
        m.orient(f, (math.cos(a), math.sin(a), 0))
        # a little gable (wimperg) over each opening
        g0 = (pu - 1.3 * math.sin(a), pv + 1.3 * math.cos(a), 92.5)
        g1 = (pu + 1.3 * math.sin(a), pv - 1.3 * math.cos(a), 92.5)
        f = m.poly([(g0[0] + 0.1 * math.cos(a), g0[1] + 0.1 * math.sin(a), 92.5), (g1[0] + 0.1 * math.cos(a), g1[1] + 0.1 * math.sin(a), 92.5),
                    (pu + 0.1 * math.cos(a), pv + 0.1 * math.sin(a), 96.5)], STONE)
        m.orient(f, (math.cos(a), math.sin(a), 0))
        ca = math.pi / 8 + 2 * math.pi * k / 8
        m.pinnacle(tu + 6.3 * math.cos(ca), tv + 6.3 * math.sin(ca), 73, 21, 0.45)
        # a thin flying buttress from the pinnacle to the octagon
        m.box(tu + 5.6 * math.cos(ca) - 0.15, tu + 5.6 * math.cos(ca) + 0.15, tv + 5.6 * math.sin(ca) - 0.15, tv + 5.6 * math.sin(ca) + 0.15, 84, 85, STONE)
    # second octagon and the crown
    o2 = m.ngon(tu, tv, 3.4, 8, math.pi / 8)
    m.prism(o2, 96, 108, STONE, top=False)
    for k in range(8):
        ca = math.pi / 8 + 2 * math.pi * k / 8
        m.pinnacle(tu + 4.2 * math.cos(ca), tv + 4.2 * math.sin(ca), 96, 12, 0.3)
    # spire, ball and cross
    m.pyramid(o2, 108, 119.5, STONE)
    ball = m.ngon(tu, tv, 0.6, 6)
    m.prism(ball, 119.5, 120.7, LEAD)
    m.box(tu - 0.12, tu + 0.12, tv - 0.12, tv + 0.12, 120.7, 123.0, LEAD)
    m.box(tu - 0.12, tu + 0.12, tv - 0.8, tv + 0.8, 121.8, 122.1, LEAD)

    # --- the south tower: never finished, about 65 m, a small cap
    sv_ = V(-(fw + 7.5))
    for y0, y1, h in stages[:2]:
        m.box(tu - h, tu + h, sv_ - h, sv_ + h, y0, y1, STONE, top=False)
        for su in (-1, 1):
            for sv in (-1, 1):
                m.box(tu + su * h - 0.9, tu + su * h + 0.9, sv_ + sv * h - 0.9, sv_ + sv * h + 0.9, y0, y1 - 1.5, STONE)
        for sign in (-1, 1):
            m.window(("u", tu + sign * h, sign), sv_ - h * 0.45, sv_ + h * 0.45, y0 + 4, y1 - 5)
            m.window(("v", sv_ + sign * h, sign), tu - h * 0.45, tu + h * 0.45, y0 + 4, y1 - 5)
    m.box(tu - 7.2, tu + 7.2, sv_ - 7.2, sv_ + 7.2, 58, 65, STONE, top=True, top_mat=LEAD)
    cap = m.ngon(tu, sv_, 3.2, 8, math.pi / 8)
    m.prism(cap, 65, 68, STONE, top=False)
    m.pyramid(cap, 68, 73, LEAD)
    return m


# ------------------------------------------------------------------ the town hall


def stadhuis(fr):
    """Stadhuis (Cornelis Floris, 1561-65): long front on the Grote Markt, a tall
    frontispiece in the middle, loggia under a great hipped roof."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1 = -L / 2, L / 2
    v0, v1 = -W / 2, W / 2  # v1 = the market side (frame "open" side)
    m.box(u0, u1, v0, v1, 0, 7.0, STONE, top=False, shade=0.85)  # rusticated ground floor
    m.box(u0, u1, v0, v1, 7.0, 20.0, STONE, top=False)
    m.box(u0 + 0.4, u1 - 0.4, v0 + 0.4, v1 - 0.4, 20.0, 24.5, LEAD, top=False, shade=0.6)  # the dark loggia
    for k in range(int(L / 3.6)):
        a = u0 + 1.2 + k * 3.6
        m.window(("v", v1, 1), a, a + 1.6, 1.0, 5.6, pointed=False, mat=LEAD)
        m.window(("v", v1, 1), a, a + 1.6, 8.5, 13.0, pointed=False)
        m.window(("v", v1, 1), a, a + 1.6, 14.5, 18.6, pointed=False)
        m.box(a - 1.0, a - 0.6, v1, v1 + 0.3, 7.0, 20.0, STONE)  # pilasters
    m.box(u0, u1, v0 - 0.3, v1 + 0.3, 24.5, 25.3, STONE)  # cornice
    m.hip_roof(u0, u1, v0, v1, 25.3, 9.0, SLATE)
    # frontispiece: three bays, four more stages, a stepped top with an obelisk
    fu0, fu1 = -6.5, 6.5
    m.box(fu0, fu1, v1 - 1.0, v1 + 1.2, 0, 31.0, STONE, top=False)
    for y0, y1 in ((25.5, 30), (31.5, 35.5)):
        m.window(("v", v1 + 1.2, 1), -3.0, 3.0, y0, y1, pointed=False)
    steps = [(fu0, 31.0), (fu0 + 1.8, 34.5), (fu0 + 3.4, 38.0), (0, 41.5)]
    pts = [(fu0, v1 + 1.2, 31.0)]
    for i in range(1, len(steps)):
        pts += [(steps[i - 1][0], v1 + 1.2, steps[i][1]), (steps[i][0], v1 + 1.2, steps[i][1])]
    pts = pts[:-1] + [(0, v1 + 1.2, 41.5)] + [(-p[0], p[1], p[2]) for p in reversed(pts[1:-1])] + [(fu1, v1 + 1.2, 31.0)]
    f = m.poly(pts, STONE)
    m.orient(f, (0, 1, 0))
    m.pinnacle(0, v1 + 0.9, 41.5, 4.5, 0.35, LEAD)
    for uu in (fu0, fu1, fu0 + 3.4, fu1 - 3.4):
        m.pinnacle(uu, v1 + 0.9, 31.0 if abs(uu) > 5 else 38.0, 3.0, 0.3)
    # dormers on the roof
    for k in range(-3, 4):
        if k == 0:
            continue
        a = k * 7.5
        m.box(a - 1.0, a + 1.0, v1 - 3.5, v1 - 2.0, 25.3, 28.3, STONE)
        m.gable_roof(a - 1.2, a + 1.2, v1 - 3.6, v1 - 1.8, 28.3, 1.2, along="v", over=0.1)
    return m


# ------------------------------------------------------------------ the butchers' hall


def vleeshuis(fr):
    """Vleeshuis (1501-04): striped red brick and white stone, steep roof, stepped
    gables at the ends, slender stair turrets."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1, v0, v1 = -L / 2, L / 2, -W / 2, W / 2
    H = 17.0
    m.box(u0, u1, v0, v1, 0, H, BRICK, top=False)
    rise = W / 2 * math.tan(math.radians(58))
    m.gable_roof(u0, u1, v0, v1, H, rise, along="u", gable_mat=BRICK)
    # stepped gables on both ends, proud of the roof
    for ue, s in ((u0, -1), (u1, 1)):
        pts = [(ue + s * 0.05, v0, H)]
        k = 6
        for i in range(k):
            vv = v0 + (i + 1) * (W / 2) / (k + 0.4)
            yy = H + (vv - v0) / (W / 2) * rise + 0.8
            pts += [(ue + s * 0.05, v0 + i * (W / 2) / (k + 0.4), yy), (ue + s * 0.05, vv, yy)]
        pts += [(ue + s * 0.05, 0, H + rise + 2.2)]
        mirror = [(p[0], -p[1], p[2]) for p in reversed(pts[1:])]
        f = m.poly(pts + mirror[1:] + [(ue + s * 0.05, v1, H)], BRICK)
        m.orient(f, (s, 0, 0))
        m.window(("u", ue, s), -2.5, 2.5, 5, 12)
    # windows in rows on the long sides
    for side in (-1, 1):
        vv = v1 if side > 0 else v0
        for k in range(int(L / 4.2)):
            a = u0 + 2 + k * 4.2
            m.window(("v", vv, side), a, a + 1.6, 2.5, 6.5)
            m.window(("v", vv, side), a, a + 1.6, 9.0, 13.5)
    # the stair turrets: octagonal, higher than the eaves, with slate spires
    for uu, vv in ((u0 + 3, v1 + 1.6), (u1 - 3, v1 + 1.6), (u0 + L * 0.35, v1 + 1.6), (u0 + 3, v0 - 1.6), (u1 - 3, v0 - 1.6)):
        ring = m.ngon(uu, vv, 1.8, 8, math.pi / 8)
        m.prism(ring, 0, H + 7, BRICK, top=False)
        m.pyramid(ring, H + 7, H + 13, SLATE)
    return m


# ------------------------------------------------------------------ the castle


def steen(fr):
    """Het Steen before the restoration of 1889: a low stone castle with round
    towers under conical caps, a gate tower and a taller keep."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1, v0, v1 = -L / 2, L / 2, -W / 2, W / 2
    m.box(u0 + 2, u1 - 2, v0 + 2, v1 - 2, 0, 9, STONE, top=True, top_mat=LEAD, shade=0.8)
    # crenellations
    for u in range(int(u0 + 3), int(u1 - 2), 2):
        for vv in (v0 + 2, v1 - 2):
            m.box(u, u + 1, vv - 0.4, vv + 0.4, 9, 10.1, STONE, shade=0.8)
    for uu, vv in ((u0 + 3, v0 + 3), (u1 - 3, v0 + 3), (u0 + 3, v1 - 3), (u1 - 3, v1 - 3)):
        ring = m.ngon(uu, vv, 3.2, 10)
        m.prism(ring, 0, 13, STONE, top=False, shade=0.85)
        m.pyramid(ring, 13, 19, SLATE)
    # the keep and the gate tower
    m.box(-6, 6, -5, 5, 0, 17, STONE, top=False, shade=0.85)
    m.gable_roof(-6, 6, -5, 5, 17, 6, along="u")
    m.box(u0 + L * 0.2 - 3, u0 + L * 0.2 + 3, v1 - 4, v1 + 1, 0, 14, STONE, top=False)
    m.gable_roof(u0 + L * 0.2 - 3, u0 + L * 0.2 + 3, v1 - 4, v1 + 1, 14, 4, along="v")
    m.window(("v", v1 + 1, 1), u0 + L * 0.2 - 1.3, u0 + L * 0.2 + 1.3, 0.1, 4.0, mat=LEAD)
    return m


# ------------------------------------------------------------------ other churches


def church(fr, tower_h, spire):
    """A Gothic or Baroque parish church: aisles, a high nave, a west tower."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1 = -L / 2, L / 2
    half = min(8.0, W * 0.18)
    aisle = W / 2 - 1
    m.box(u0 + 12, u1 - 4, -aisle, aisle, 0, 13, STONE, top=True, top_mat=LEAD)
    m.box(u0 + 10, u1 - 2, -half, half, 0, 24, STONE, top=False)
    m.gable_roof(u0 + 10, u1 - 2, -half, half, 24, half * 1.5, along="u")
    for side in (-1, 1):
        for k in range(int((L - 16) / 6)):
            a = u0 + 13 + k * 6
            m.window(("v", side * aisle, side), a, a + 2, 3, 10)
            m.window(("v", side * half, side), a, a + 2, 15, 21)
    t = 6.5
    m.box(u0, u0 + 2 * t, -t, t, 0, tower_h, STONE, top=False)
    for sign in (-1, 1):
        m.window(("v", sign * t, sign), u0 + t - 1.5, u0 + t + 1.5, tower_h - 12, tower_h - 4)
    ring = m.ngon(u0 + t, 0, t * 0.8, 8, math.pi / 8)
    if spire == "bulb":
        m.prism(ring, tower_h, tower_h + 4, STONE, top=False)
        m.pyramid(ring, tower_h + 4, tower_h + 14, LEAD)
    elif spire == "flat":
        m.box(u0, u0 + 2 * t, -t, t, tower_h, tower_h + 1, STONE, top=True, top_mat=LEAD)
    else:
        m.pyramid(m.ngon(u0 + t, 0, t, 4, math.pi / 4), tower_h, tower_h + 18, SLATE)
    return m


def material(name, rgb):
    mt = bpy.data.materials.new(name)
    mt.diffuse_color = (*rgb, 1)
    return mt


def steen2(fr):
    """Het Steen, the castle on the river, in more detail: curtain walls with
    battlements, three round towers under conical slate roofs, a tall gatehouse
    with a stepped gable facing the Steenplein, the main hall with dormers and a
    slender watch turret. v > 0 is the Steenplein side (the frame's open side)."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1, v0, v1 = -L / 2 + 1.5, L / 2 - 1.5, -W / 2 + 1.5, W / 2 - 1.5
    H = 11.0
    # rough stone base, slightly battered
    m.box(u0 - 0.6, u1 + 0.6, v0 - 0.6, v1 + 0.6, -1.0, 2.2, STONE, top=False, shade=0.7)
    m.box(u0, u1, v0, v1, 2.2, H, STONE, top=True, top_mat=LEAD, shade=0.82)
    # battlements: a walkway parapet with merlons all round
    for (a0, a1, fixed, axis) in ((u0, u1, v0, "v"), (u0, u1, v1, "v"), (v0, v1, u0, "u"), (v0, v1, u1, "u")):
        k = a0 + 0.5
        while k < a1 - 0.8:
            if axis == "v":
                m.box(k, k + 0.9, fixed - 0.35, fixed + 0.35, H, H + 1.2, STONE, shade=0.8)
            else:
                m.box(fixed - 0.35, fixed + 0.35, k, k + 0.9, H, H + 1.2, STONE, shade=0.8)
            k += 1.8
    # arrow slits and a few later windows on the long walls
    for side in (-1, 1):
        vv = v1 if side > 0 else v0
        for k in range(int((u1 - u0) / 5)):
            a = u0 + 2.5 + k * 5
            m.window(("v", vv, side), a, a + 0.5, 4.0, 6.5, pointed=False, mat=LEAD)
            if k % 2:
                m.window(("v", vv, side), a - 0.6, a + 1.1, 7.5, 9.5, pointed=True)
    # three round towers with conical slate roofs
    for uu, vv, r, h in ((u0, v0, 3.8, 16.0), (u1, v0, 3.4, 15.0), (u0, v1, 3.2, 14.0)):
        ring = m.ngon(uu, vv, r, 12)
        m.prism(ring, -1.0, h, STONE, top=False, shade=0.8)
        m.prism(m.ngon(uu, vv, r + 0.35, 12), h - 1.0, h, STONE, top=False, shade=0.9)  # corbelled rim
        m.pyramid(m.ngon(uu, vv, r + 0.4, 12), h, h + r * 2.1, SLATE)
    # the gatehouse on the Steenplein side: tall, stepped gable, the gate arch
    gu = u1 - L * 0.28
    g0, g1 = gu - 4.0, gu + 4.0
    m.box(g0, g1, v1 - 5.0, v1 + 1.5, -1.0, 19.0, STONE, top=False, shade=0.85)
    m.window(("v", v1 + 1.5, 1), gu - 1.6, gu + 1.6, 0.0, 4.2, pointed=True, mat=LEAD)  # the gate
    for y0 in (8.0, 12.5):
        m.window(("v", v1 + 1.5, 1), gu - 0.9, gu + 0.9, y0, y0 + 2.4, pointed=True)
    m.gable_roof(g0, g1, v1 - 5.0, v1 + 1.5, 19.0, 6.5, along="v", gable_mat=STONE, over=0.1)
    k = 5
    for i in range(k):
        du = (g1 - g0) / 2 * (1 - i / k)
        y = 19.0 + 6.5 * i / k + 0.9
        for s in (-1, 1):
            m.box(gu + s * du - 0.55, gu + s * du + 0.55, v1 + 1.2, v1 + 1.9, y - 0.9, y, STONE, shade=0.95)
    m.pinnacle(gu, v1 + 1.5, 25.5, 3.0, 0.35)
    for s in (-1, 1):  # two slim corner turrets on the gatehouse
        ring = m.ngon(gu + s * 4.0, v1 + 1.5, 0.9, 8)
        m.prism(ring, 12.0, 21.0, STONE, top=False)
        m.pyramid(ring, 21.0, 25.0, SLATE)
    # the main hall along the river side, with dormers and a watch turret
    hu0, hu1, hv0, hv1 = u0 + 5, u1 - 6, v0 + 1, v0 + 10
    m.box(hu0, hu1, hv0, hv1, H, 16.0, STONE, top=False, shade=0.85)
    m.gable_roof(hu0, hu1, hv0, hv1, 16.0, 7.5, along="u", gable_mat=STONE)
    for k in range(int((hu1 - hu0) / 5)):
        a = hu0 + 3 + k * 5
        m.box(a - 0.8, a + 0.8, hv1 - 1.8, hv1 + 0.1, 16.0, 18.4, STONE, shade=0.9)
        m.gable_roof(a - 1.0, a + 1.0, hv1 - 1.9, hv1 + 0.2, 18.4, 1.1, along="v", over=0.1)
        m.window(("v", hv1 + 0.1, 1), a - 0.5, a + 0.5, 16.3, 17.8, pointed=False)
        m.window(("v", hv1, 1), a - 0.7, a + 0.7, 12.2, 14.8, pointed=True)
    tu, tv = hu1 - 1.5, hv1 - 1.5
    ring = m.ngon(tu, tv, 1.5, 8, math.pi / 8)
    m.prism(ring, H, 27.0, STONE, top=False, shade=0.9)
    m.pyramid(m.ngon(tu, tv, 1.8, 8, math.pi / 8), 27.0, 33.0, SLATE)
    m.box(tu - 0.06, tu + 0.06, tv - 0.06, tv + 0.06, 33.0, 34.5, LEAD)
    for uu in (hu0 + 2, hu1 - 5):
        m.box(uu - 0.4, uu + 0.4, hv0 + 2, hv0 + 2.8, 20.0, 25.0, STONE, shade=0.7)  # chimneys
    return m


def hanzehuis(fr):
    """The Hanseatic House (Oostershuis, 1564-68, burned 1893): a great square
    Renaissance block round a courtyard, arcades below, rows of cross windows,
    hipped roofs with dormers, and a high tower on the dock side (-v)."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1, v0, v1 = -L / 2, L / 2, -W / 2, W / 2
    H = 16.0
    d = 10.0  # wing depth
    wings = [(u0, u1, v0, v0 + d), (u0, u1, v1 - d, v1), (u0, u0 + d, v0 + d, v1 - d), (u1 - d, u1, v0 + d, v1 - d)]
    for a0, a1, b0, b1 in wings:
        m.box(a0, a1, b0, b1, 0, H, BRICK, top=False)
        m.box(a0 - 0.2, a1 + 0.2, b0 - 0.2, b1 + 0.2, H, H + 0.6, STONE)
        m.hip_roof(a0, a1, b0, b1, H + 0.6, 6.0, SLATE)
    for side, vv in ((1, v1), (-1, v0)):
        for k in range(int(L / 4)):
            a = u0 + 1.2 + k * 4
            m.window(("v", vv, side), a, a + 2.2, 0.2, 4.4, pointed=False, mat=LEAD)
            for y0 in (6.0, 11.0):
                m.window(("v", vv, side), a + 0.4, a + 1.8, y0, y0 + 3.2, pointed=False)
    for side, uu in ((1, u1), (-1, u0)):
        for k in range(int(W / 4)):
            a = v0 + 1.2 + k * 4
            for y0 in (6.0, 11.0):
                m.window(("u", uu, side), a + 0.4, a + 1.8, y0, y0 + 3.2, pointed=False)
    tu = 0.0
    t0 = 4.5
    m.box(tu - t0, tu + t0, v0 - 2.0, v0 + 7.0, 0, 30.0, BRICK, top=False)
    for y0 in (18.0, 23.5):
        m.window(("v", v0 - 2.0, -1), tu - 1.4, tu + 1.4, y0, y0 + 3.5, pointed=True)
    m.box(tu - t0 - 0.3, tu + t0 + 0.3, v0 - 2.3, v0 + 7.3, 30.0, 31.0, STONE)
    lan = m.ngon(tu, v0 + 2.5, 3.2, 8, math.pi / 8)
    m.prism(lan, 31.0, 37.0, STONE, top=False)
    for k in range(8):
        a = math.pi / 8 + 2 * math.pi * k / 8 + math.pi / 8
        pu, pv = tu + 3.25 * math.cos(a), v0 + 2.5 + 3.25 * math.sin(a)
        f = m.poly([(pu - 0.7 * math.sin(a), pv + 0.7 * math.cos(a), 32.0), (pu + 0.7 * math.sin(a), pv - 0.7 * math.cos(a), 32.0),
                    (pu + 0.7 * math.sin(a), pv - 0.7 * math.cos(a), 35.5), (pu - 0.7 * math.sin(a), pv + 0.7 * math.cos(a), 35.5)], GLASS, 0.8)
        m.orient(f, (math.cos(a), math.sin(a), 0))
    m.pyramid(m.ngon(tu, v0 + 2.5, 3.5, 8, math.pi / 8), 37.0, 47.0, LEAD)
    m.box(tu - 0.08, tu + 0.08, v0 + 2.42, v0 + 2.58, 47.0, 49.0, LEAD)
    return m


def steen3(fr):
    """Het Steen as in Steve's reference photo from the Steenplein: a tall slim
    tower with a spire on the left, the main hall with two stepped gables and
    dormers under a big slate roof, two round towers with pointed roofs, a
    battlemented gallery and a squat round tower on the right. Rough dark stone
    below, lighter stone above. u runs left to right seen from the square (+v)."""
    m = Mesh(fr)
    L, W = fr.L, fr.W
    u0, u1 = -L / 2 + 1.0, L / 2 - 1.0
    v0, v1 = -W / 2 + 1.0, W / 2 - 1.0
    front = v1

    def stepgable(uc, width, v, y0, rise, steps=5):
        """A stepped gable standing up from a front wall at v, with its roof behind."""
        pts = [(uc - width / 2, v, y0)]
        for i in range(steps):
            du = width / 2 * (1 - i / steps)
            y = y0 + rise * (i + 1) / steps
            pts += [(uc - du, v, y), (uc - du + width / (2 * steps), v, y)]
        pts += [(uc, v, y0 + rise + 0.8)]
        right = [(2 * uc - p[0], p[1], p[2]) for p in reversed(pts[1:-1])]
        pts = pts + right + [(uc + width / 2, v, y0)]
        m.orient(m.poly(pts, STONE, 0.95), (0, 1, 0))
        m.gable_roof(uc - width / 2 + 0.3, uc + width / 2 - 0.3, v - 8, v - 0.1, y0, rise * 0.85, along="v", over=0.1)

    # ---- the main hall
    h0, h1 = u0 + 7, u0 + 24
    m.box(h0, h1, v0 + 2, front, -1.0, 4.0, STONE, top=False, shade=0.6)  # rough dark base
    m.box(h0, h1, v0 + 2, front, 4.0, 14.0, STONE, top=False, shade=0.92)
    m.gable_roof(h0, h1, v0 + 2, front, 14.0, 9.0, along="u", gable_mat=STONE)
    m.window(("v", front, 1), h0 + 7.0, h0 + 10.0, 0.0, 4.5, pointed=True, mat=LEAD)  # the gate
    for uu in (h0 + 2.5, h0 + 13.5):
        m.window(("v", front, 1), uu, uu + 1.4, 5.5, 8.5, pointed=False)
        m.window(("v", front, 1), uu, uu + 1.4, 9.8, 12.5, pointed=False)
    stepgable(h0 + 4.5, 6.0, front + 0.05, 14.0, 7.0)
    stepgable(h0 + 12.5, 6.0, front + 0.05, 14.0, 7.0)
    for uu in (h0 + 8.5, h1 - 1.5):  # dormers
        m.box(uu - 0.8, uu + 0.8, front - 3.2, front - 1.4, 16.0, 18.2, STONE, shade=0.9)
        m.gable_roof(uu - 1.0, uu + 1.0, front - 3.3, front - 1.3, 18.2, 1.0, along="v", over=0.1)
        m.window(("v", front - 1.4, 1), uu - 0.45, uu + 0.45, 16.3, 17.8, pointed=False)
    # ---- the tall tower on the left: square, then octagonal with a corbelled gallery, then the spire
    tu, tv, ts = u0 + 3.2, front - 3.0, 3.1
    m.box(tu - ts, tu + ts, tv - ts, tv + ts, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.box(tu - ts, tu + ts, tv - ts, tv + ts, 4.0, 21.0, STONE, top=False, shade=0.95)
    for y0 in (6.0, 10.5, 15.0):
        m.window(("v", tv + ts, 1), tu - 0.5, tu + 0.5, y0, y0 + 2.4, pointed=False)
    oc = m.ngon(tu, tv, ts * 0.95, 8, math.pi / 8)
    m.prism(oc, 21.0, 27.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(tu, tv, ts * 1.12, 8, math.pi / 8), 26.2, 27.4, STONE, top=False, shade=1.0)  # corbelled gallery
    for k in range(8):
        a = math.pi / 4 * k + math.pi / 8
        m.box(tu + math.cos(a) * ts * 1.1 - 0.2, tu + math.cos(a) * ts * 1.1 + 0.2, tv + math.sin(a) * ts * 1.1 - 0.2, tv + math.sin(a) * ts * 1.1 + 0.2, 27.4, 28.4, STONE)
        m.window(("u", tu + math.cos(a) * ts * 0.97, 1 if math.cos(a) > 0 else -1), tv + math.sin(a) * ts * 0.9 - 0.3, tv + math.sin(a) * ts * 0.9 + 0.3, 22.5, 25.0, pointed=True) if abs(math.cos(a)) > 0.9 else None
    m.pyramid(m.ngon(tu, tv, ts * 0.85, 8, math.pi / 8), 27.4, 40.0, SLATE)
    m.box(tu - 0.06, tu + 0.06, tv - 0.06, tv + 0.06, 40.0, 42.0, LEAD)  # the weathervane rod
    m.box(tu - 0.05, tu + 0.9, tv - 0.02, tv + 0.02, 41.2, 41.7, LEAD)
    # ---- round tower 1, tall with a pointed roof, between the hall and the east wing
    r1u = h1 + 1.5
    ring = m.ngon(r1u, front - 3.0, 3.1, 12)
    m.prism(ring, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.prism(ring, 4.0, 19.0, STONE, top=False, shade=0.95)
    m.window(("v", front + 0.1, 1), r1u - 0.4, r1u + 0.4, 9.0, 11.2, pointed=False)
    m.window(("v", front + 0.1, 1), r1u - 0.4, r1u + 0.4, 14.0, 16.2, pointed=False)
    m.pyramid(m.ngon(r1u, front - 3.0, 3.4, 12), 19.0, 28.0, SLATE)
    # ---- the east wing, lower, with a stepped gable and a dormer
    e0, e1 = h1 + 4.5, h1 + 15.0
    m.box(e0, e1, v0 + 2, front - 1.0, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.box(e0, e1, v0 + 2, front - 1.0, 4.0, 12.0, STONE, top=False, shade=0.9)
    m.gable_roof(e0, e1, v0 + 2, front - 1.0, 12.0, 7.0, along="u", gable_mat=STONE)
    stepgable((e0 + e1) / 2, 5.5, front - 0.95, 12.0, 6.0, 4)
    m.window(("v", front - 1.0, 1), e0 + 2.0, e0 + 3.4, 6.0, 9.0, pointed=False)
    m.window(("v", front - 1.0, 1), e1 - 3.4, e1 - 2.0, 6.0, 9.0, pointed=False)
    # ---- round tower 2 with a slender pointed roof and a spike
    r2u = e1 + 1.8
    ring = m.ngon(r2u, front - 3.2, 2.8, 12)
    m.prism(ring, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.prism(ring, 4.0, 17.0, STONE, top=False, shade=0.95)
    m.pyramid(m.ngon(r2u, front - 3.2, 3.1, 12), 17.0, 27.0, SLATE)
    m.box(r2u - 0.05, r2u + 0.05, front - 3.25, front - 3.15, 27.0, 28.6, LEAD)
    # ---- the battlemented gallery and the squat round tower on the right
    g0, g1 = r2u + 2.5, u1 - 4.0
    if g1 > g0 + 1:
        m.box(g0, g1, v0 + 2, front - 2.0, -1.0, 4.0, STONE, top=False, shade=0.6)
        m.box(g0, g1, v0 + 2, front - 2.0, 4.0, 10.0, STONE, top=True, top_mat=LEAD, shade=0.9)
        m.window(("v", front - 2.0, 1), (g0 + g1) / 2 - 1.6, (g0 + g1) / 2 + 1.6, 0.0, 4.0, pointed=True, mat=LEAD)
        k = g0 + 0.3
        while k < g1 - 0.6:
            m.box(k, k + 0.6, front - 2.35, front - 1.65, 10.0, 11.0, STONE, shade=0.95)
            k += 1.2
    r3u = u1 - 3.2
    ring = m.ngon(r3u, front - 3.4, 3.4, 12)
    m.prism(ring, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.prism(ring, 4.0, 13.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(r3u, front - 3.4, 3.7, 12), 12.2, 13.0, STONE, top=True, top_mat=LEAD, shade=1.0)
    for k in range(12):
        a = math.pi * 2 * k / 12
        if k % 2 == 0:
            cx, cz = r3u + math.cos(a) * 3.55, front - 3.4 + math.sin(a) * 3.55
            m.box(cx - 0.3, cx + 0.3, cz - 0.3, cz + 0.3, 13.0, 14.0, STONE)
    m.window(("v", front + 0.05, 1), r3u - 0.5, r3u + 0.5, 6.0, 8.5, pointed=True)
    # ---- the river side: plain curtain wall joining it all
    m.box(u0, u1, v0, v0 + 2.2, -1.0, 11.0, STONE, top=True, top_mat=LEAD, shade=0.75)
    return m


def main():
    city = json.load(open(CITY))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for n, rgb in zip(MATS, [(0.7, 0.68, 0.62), (0.25, 0.27, 0.3), (0.05, 0.06, 0.07), (0.55, 0.3, 0.22), (0.3, 0.31, 0.32)]):
        material(n, rgb)
    th = math.radians(city["frame"]["thetaDeg"])
    world_north = (math.cos(th), -math.sin(th))
    L = city["landmarks"]
    built = []

    def frame(name, open_side=False, away=False):
        f = dict(L[name]["frame"])
        # open_side: v > 0 looks to the open ground; away: v < 0 does
        if (open_side and f["open"] < 0) or (away and f["open"] > 0):
            f["n"] = [-f["n"][0], -f["n"][1]]
        return Frame(f)

    builders = {
        "cathedral": lambda: cathedral(frame("cathedral"), world_north),
        "stadhuis": lambda: stadhuis(frame("stadhuis", open_side=True)),
        "vleeshuis": lambda: vleeshuis(frame("vleeshuis")),
        "steen": lambda: steen3(frame("steen", open_side=True)),
        "hanzehuis": lambda: hanzehuis(frame("hanzehuis", away=True)),
        "stpaul": lambda: church(frame("stpaul"), 42, "bulb"),
        "carolus": lambda: church(frame("carolus"), 44, "bulb"),
        "stjacob": lambda: church(frame("stjacob"), 55, "flat"),
    }
    for name in L:
        if name in builders:
            builders[name]().to_object(f"landmark_{name}")
            built.append(name)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    faces = sum(len(o.data.polygons) for o in bpy.context.scene.objects)
    print(f"[build_landmarks] {', '.join(built)}: {faces} faces -> {OUT} ({os.path.getsize(OUT)//1024} KB)")


if __name__ == "__main__":
    main()

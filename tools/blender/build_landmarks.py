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


def use_shading(ob):
    """Make the vertex shading the mesh's active colour layer. Else the glTF exporter writes an
    all-white COLOR_0 and puts the shading in COLOR_1, which the game ignores (the dark stone
    at the foot of the walls, the tarred cross, the painted corpus would not show)."""
    ca = ob.data.color_attributes
    if "Col" in ca:
        ca.active_color = ca["Col"]
        ca.render_color_index = list(ca.keys()).index("Col")
    return ob


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
        return use_shading(ob)


# ------------------------------------------------------------------ the cathedral
#
# Onze-Lieve-Vrouwekathedraal as it stood in 1873, after period views (Hollar 1649,
# Simoneau c. 1843, the Belgique pittoresque stereo views c. 1870, photochroms c. 1890,
# a Nels postcard c. 1910) and today's photographs, reference only. The tracery, the
# clock, the portals and the house fronts are painted into one small atlas (cath_atlas)
# drawn below; the cross and ball are "gilt". Two extra material slots on this mesh only.

ATLAS, GILT = 5, 6  # material slots after MATS, cathedral mesh only
CATH_MATS = MATS + ["cath_atlas", "gilt"]
AT = 512  # atlas width in pixels
ATH = 1024  # atlas height: the cathedral's cells on top, the other landmarks' below

# atlas cells: x, y, w, h in pixels, y down from the top of the image
CELL = {
    "tower_lancets": (0, 0, 128, 256),
    "tower_blind": (128, 0, 128, 128),
    "great_window": (256, 0, 128, 256),
    "lancet": (384, 0, 64, 128),
    "openwork": (448, 0, 64, 128),
    "clock": (128, 128, 64, 64),
    "niche": (192, 128, 64, 64),
    "door": (192, 192, 64, 64),
    "buttress": (384, 128, 32, 128),
    "dormer": (416, 128, 32, 32),
    "plaster": (416, 160, 32, 32),
    "tier": (448, 128, 64, 64),
    "portal": (0, 256, 128, 128),
    "gable": (128, 256, 128, 64),
    "balustrade": (128, 320, 128, 16),
    "house_a": (256, 256, 64, 64),
    "house_b": (320, 256, 64, 64),
    "house_c": (384, 256, 64, 64),
    "tympanum": (0, 384, 128, 64),
    # the other landmarks (y 512 and down)
    "sh_bay": (0, 512, 64, 128),  # town hall: two storeys of one bay, pilasters and cross windows
    "sh_arcade": (64, 512, 64, 64),  # town hall: rusticated round arch of the ground floor
    "sh_loggia": (64, 576, 64, 64),  # town hall: the shaded back wall of the loggia
    "fanlight": (128, 512, 64, 32),  # a round fanlight over a door
    "arms": (128, 544, 64, 64),  # a cartouche with the arms of Antwerp
    "cross_window": (192, 512, 64, 64),  # a stone cross window
    "slit": (256, 512, 32, 64),  # an arrow slit
    "hz_bay": (288, 512, 64, 128),  # Hanseatic House: three storeys of one bay
    "hz_arch": (352, 512, 64, 64),  # Hanseatic House: arched warehouse door
    "vh_upper": (416, 512, 64, 128),  # Vleeshuis: three small windows over each other, stone frames
    "st_window": (352, 576, 64, 64),  # Steen: small Gothic window with a mullion, bars
}

ARCH_R = 1.25  # two-centred arch in a unit box: circles of radius 1.25 through the springing and the apex


def arch_t(x, tsp):
    """Top edge of a pointed arch in a unit box (x 0..1 across); t = tsp at the springing, 1 at the apex."""
    x = min(x, 1 - x)
    return tsp + (1 - tsp) * math.sqrt(max(0.0, ARCH_R * ARCH_R - (x - ARCH_R) ** 2))


def arch_shape(tsp, seg=3):
    """Outline of a pointed-arch opening in a unit box, for a face and its atlas cell alike."""
    pts = [(0, 0), (1, 0), (1, tsp)]
    for k in range(1, 2 * seg):
        x = 1 - k / (2 * seg)
        pts.append((x, arch_t(x, tsp)))
    pts.append((0, tsp))
    return pts


RECT = [(0, 0), (1, 0), (1, 1), (0, 1)]
GABLE = [(0, 0), (1, 0), (0.5, 1)]
DISC = [(0.5 + 0.5 * math.cos(2 * math.pi * k / 12), 0.5 + 0.5 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
PENT = [(0, 0), (1, 0), (1, 0.62), (0.5, 1), (0, 0.62)]


def cell_uv(name, x, t):
    cx, cy, w, h = CELL[name]
    return ((cx + 0.5 + x * (w - 1)) / AT, 1 - (cy + 0.5 + (1 - t) * (h - 1)) / ATH)


def paint_atlas():
    """The cathedral atlas, drawn pixel by pixel: rows top-down, sRGB 0..1."""
    import numpy as np

    rng = np.random.default_rng(1873)
    A = np.zeros((ATH, AT, 3), np.float32)
    C = {k: np.array(v, np.float32) for k, v in {
        "stone": (0.56, 0.51, 0.42), "hi": (0.67, 0.62, 0.52), "lo": (0.40, 0.36, 0.30),
        "glass": (0.07, 0.085, 0.11), "lead": (0.20, 0.20, 0.19), "glint": (0.25, 0.31, 0.37),
        "void": (0.08, 0.08, 0.09), "slat": (0.27, 0.26, 0.24), "gold": (0.82, 0.64, 0.26),
        "face": (0.09, 0.10, 0.14), "wood": (0.27, 0.17, 0.11), "plaster": (0.76, 0.73, 0.66),
        "plaster2": (0.60, 0.62, 0.62), "brick": (0.50, 0.27, 0.20), "leadg": (0.31, 0.32, 0.34),
        "white": (0.85, 0.84, 0.80), "shutter": (0.20, 0.31, 0.23), "dark": (0.13, 0.14, 0.16),
    }.items()}

    def cell(name):
        x, y, w, h = CELL[name]
        return A[y:y + h, x:x + w]

    def grid(h, w):
        yy, xx = np.mgrid[0:h, 0:w]
        return xx + 0.5, yy + 0.5

    def arch_mask(w, h, tsp):
        xx, yy = grid(h, w)
        x = xx / w
        t = 1 - yy / h
        xm = np.minimum(x, 1 - x)
        return t <= tsp + (1 - tsp) * np.sqrt(np.clip(ARCH_R ** 2 - (xm - ARCH_R) ** 2, 0, None))

    def erode(mk, n=1):
        for _ in range(n):
            e = mk.copy()
            e[1:, :] &= mk[:-1, :]
            e[:-1, :] &= mk[1:, :]
            e[:, 1:] &= mk[:, :-1]
            e[:, :-1] &= mk[:, 1:]
            e[0, :] = e[-1, :] = False
            e[:, 0] = e[:, -1] = False
            mk = e
        return mk

    def circle(h, w, cx, cy, r0, r1):
        xx, yy = grid(h, w)
        d = np.hypot(xx - cx, yy - cy)
        return (d >= r0) & (d <= r1)

    def line(c, x0, y0, x1, y1, col, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            x = int(round(x0 + (x1 - x0) * i / n))
            y = int(round(y0 + (y1 - y0) * i / n))
            c[max(0, y):max(0, y + w), max(0, x):max(0, x + w)] = col

    def noise(c, amt):
        c += (rng.random(c.shape[:2])[..., None] - 0.5) * amt

    def stone_bg(c, course=8, col="stone"):
        c[:] = C[col]
        h, w = c.shape[:2]
        for i, y in enumerate(range(0, h, course)):
            c[min(h - 1, y + course - 1), :] *= 0.86
            for x in range((i % 2) * 6, w, 12):
                c[y:y + course - 1, x] *= 0.9

    def statue(c, cx, y0, y1, col):
        h, w = c.shape[:2]
        r = max(1.5, (y1 - y0) / 9)
        xx, yy = grid(h, w)
        head = np.hypot(xx - cx, yy - (y0 + r)) <= r
        f = np.clip((yy - (y0 + 2 * r)) / max(1, (y1 - y0 - 2 * r)), 0, 1)
        body = (yy >= y0 + 2 * r) & (yy <= y1) & (np.abs(xx - cx) <= r * (1.2 + 0.6 * f))
        c[head | body] = col

    def panel(c, x, y, w, h, tsp, trefoil=True):
        mk = arch_mask(w, h, tsp)
        sub = c[y:y + h, x:x + w]
        inner = erode(mk)
        sub[inner] *= 0.84
        sub[mk & ~inner] = C["lo"]
        if trefoil and w >= 10:
            r = w * 0.28
            ring = circle(h, w, w / 2, h * (1 - (1 + tsp) / 2) + 1, r - 1, r) & inner
            sub[ring] = C["lo"]

    def window(c, x, y, w, h, tsp, lights, fill="glass", frame=2, transom=None, rings=1):
        mk = arch_mask(w, h, tsp)
        sub = c[y:y + h, x:x + w]
        sub[mk] = C["lo"]
        inner = erode(mk, frame)
        if fill == "glass":
            g = np.broadcast_to(C["glass"], sub.shape).copy()
            g[::4, :] = C["lead"]
            g[:, ::4] = C["lead"]
            g[rng.random(sub.shape[:2]) < 0.07] = C["glint"]
        else:
            g = np.broadcast_to(C["void"], sub.shape).copy()
            if fill == "louvre":
                g[::3, :] = C["slat"]
        sub[inner] = g[inner]
        spring = int(round(h * (1 - tsp)))
        iw = w - 2 * frame
        lw = iw / lights
        mw = 1 if w < 48 else 2
        for i in range(1, lights):
            mx = int(round(frame + i * lw))
            mm = np.zeros_like(inner)
            mm[spring - int(lw * 0.3):, mx - mw // 2 - (mw > 1): mx + 1] = True
            sub[mm & inner] = C["hi"]
        if lights > 1:  # the pointed heads of the lights
            lh = int(lw * 1.1) + 2
            for i in range(lights):
                lx = int(round(frame + i * lw))
                am = arch_mask(int(round(lw)), lh, 0.35)
                edge = am & ~erode(am)
                box = np.zeros_like(inner)
                y0 = max(0, spring - lh + 2)
                hh = min(lh, h - y0)
                ww = min(edge.shape[1], w - lx)
                box[y0:y0 + hh, lx:lx + ww] = edge[:hh, :ww]
                sub[box & inner] = C["hi"]
        if rings:
            r = min(iw * 0.26, spring * 0.42)
            cy = spring * 0.55
            sub[circle(h, w, w / 2, cy, r - 1.6, r) & inner] = C["hi"]
            if rings > 1:
                r2 = r * 0.55
                for cx in (w / 2 - iw * 0.26, w / 2 + iw * 0.26):
                    sub[circle(h, w, cx, spring * 0.88, r2 - 1.4, r2) & inner] = C["hi"]
        for tf in (transom if isinstance(transom, tuple) else (transom,) if transom else ()):
            tr = np.zeros_like(inner)
            ty = int(h * tf)
            tr[ty:ty + mw, :] = True
            sub[tr & inner] = C["hi"]

    def band(c, h=10):
        c[:h] = C["hi"] * 0.97
        c[h - 1] = C["lo"]
        w = c.shape[1]
        for x in range(0, w - 6, 8):
            am = arch_mask(7, h - 2, 0.3)
            sub = c[1:h - 1, x:x + 7]
            sub[am & ~erode(am)] = C["lo"]

    def small_window(c, x0, y0, x1, y1, shutters=False):
        c[y0:y1, x0:x1] = C["white"]
        c[y0 + 1:y1 - 1, x0 + 1:x1 - 1] = C["glass"]
        mx, my = (x0 + x1) // 2, (y0 + y1) // 2
        c[y0:y1, mx] = C["white"]
        c[my, x0:x1] = C["white"]
        if shutters:
            c[y0:y1, max(0, x0 - 3):x0] = C["shutter"]
            c[y0:y1, x1:x1 + 3] = C["shutter"]

    # -- the tower: two tall belfry lancets per face, blind panels beside them
    c = cell("tower_lancets")
    stone_bg(c)
    for x0 in (3, 115):
        panel(c, x0, 14, 10, 112, 0.9)
        panel(c, x0, 130, 10, 120, 0.9)
    for x0 in (17, 69):
        window(c, x0, 30, 42, 222, 0.8, 2, "louvre", frame=3, transom=(0.4, 0.66), rings=1)
        sp = 30 + int(222 * 0.2)
        line(c, x0 - 1, sp + 4, x0 + 21, 14, C["hi"], 2)
        line(c, x0 + 21, 14, x0 + 43, sp + 4, C["hi"], 2)
        for k in range(0, 22, 5):  # crockets on the gablet
            c[14 + int(k * (sp - 10) / 22) - 2, x0 + 21 - k] = C["hi"]
            c[14 + int(k * (sp - 10) / 22) - 2, x0 + 21 + k] = C["hi"]
    c[:, 61:67] = C["hi"] * 0.95
    c[:, 61] = C["lo"]
    band(c)
    c[250:] = C["lo"] * 1.1
    noise(c, 0.07)

    # -- the tower, blind stage: two tiers of four panels
    c = cell("tower_blind")
    stone_bg(c)
    for k in range(4):
        panel(c, 4 + k * 30, 14, 28, 52, 0.72)
        panel(c, 4 + k * 30, 70, 28, 54, 0.72)
    band(c)
    noise(c, 0.07)

    # -- the great windows (west front, transepts, aisles): six lights, three rings
    c = cell("great_window")
    stone_bg(c)
    window(c, 0, 0, 128, 256, 0.66, 6, "glass", frame=5, transom=0.62, rings=2)
    noise(c, 0.04)

    # -- two-light window (clerestory, choir, chapels)
    c = cell("lancet")
    stone_bg(c)
    window(c, 0, 0, 64, 128, 0.72, 2, "glass", frame=3, rings=1)
    noise(c, 0.04)

    # -- openwork face of the octagon: open lancet under a crocketed gablet
    c = cell("openwork")
    stone_bg(c)
    c[:, 0:5] = C["hi"]
    c[:, 59:64] = C["hi"]
    c[:, 5] = C["lo"]
    c[:, 58] = C["lo"]
    window(c, 9, 20, 46, 106, 0.76, 2, "void", frame=3, rings=1)
    line(c, 6, 50, 32, 4, C["hi"], 2)
    line(c, 32, 4, 57, 50, C["hi"], 2)
    for k in range(3, 26, 5):
        c[4 + int(k * 46 / 26) - 2, 32 - k] = C["hi"]
        c[4 + int(k * 46 / 26) - 2, 32 + k] = C["hi"]
    c[0:3] = C["hi"]
    noise(c, 0.06)

    # -- the clock: dark face, gilt ring, hour marks. No hands (Steve, 2026-09-26: every clock in the game shows the
    # game's time): the game hangs live hands on a marker at each dial's middle (clock_face_<n>, see clock_marker)
    c = cell("clock")
    stone_bg(c)
    c[circle(64, 64, 32, 32, 0, 31.5)] = C["gold"]
    c[circle(64, 64, 32, 32, 0, 28.5)] = C["face"]
    c[circle(64, 64, 32, 32, 20.5, 21.5)] = C["gold"] * 0.8
    for k in range(12):
        a = 2 * math.pi * k / 12
        line(c, 32 + 23 * math.sin(a), 32 - 23 * math.cos(a), 32 + 27 * math.sin(a), 32 - 27 * math.cos(a), C["gold"], 2)

    # -- a niche with a statue under a canopy
    c = cell("niche")
    stone_bg(c)
    mk = arch_mask(34, 54, 0.72)
    sub = c[8:62, 15:49]
    sub[mk] = C["lo"] * 0.55
    sub[mk & ~erode(mk)] = C["hi"]
    statue(c, 32, 20, 60, C["hi"])
    line(c, 11, 22, 32, 1, C["hi"], 2)
    line(c, 32, 1, 53, 22, C["hi"], 2)
    noise(c, 0.06)

    # -- a small side door: archivolts, tympanum, wooden leaves
    c = cell("door")
    stone_bg(c)
    mk = arch_mask(64, 64, 0.6)
    for k in range(4):
        c[mk] = C["hi"] if k % 2 == 0 else C["lo"]
        mk = erode(mk, 3)
    c[mk] = C["lo"] * 0.9
    noise(c, 0.05)
    leaf = mk.copy()
    leaf[:30] = False
    c[leaf] = C["wood"]
    c[30:, 31:33][leaf[30:, 31:33]] = C["void"]
    for y in range(36, 64, 8):
        c[y][leaf[y]] = C["wood"] * 0.6

    # -- the great portal: five archivolts with statuettes, tympanum, doors and trumeau
    c = cell("portal")
    stone_bg(c)
    mk = arch_mask(128, 128, 0.56)
    for k in range(5):
        c[mk] = C["hi"] if k % 2 == 0 else C["lo"]
        if k % 2 == 1:
            dots = mk & (rng.random(mk.shape) < 0.25)
            c[dots] = C["hi"] * 0.9
        mk = erode(mk, 5)
    tymp = mk.copy()
    tymp[int(128 * 0.62):] = False
    c[tymp] = C["stone"] * 0.8
    for k in range(7):
        statue(c, 36 + k * 9.3, 60, 76, C["hi"] * 0.95)
    c[tymp & (rng.random(tymp.shape) < 0.12)] = C["lo"]
    doors = mk.copy()
    doors[:int(128 * 0.62)] = False
    c[doors] = C["wood"]
    for y in range(84, 128, 9):
        c[y][doors[y]] = C["wood"] * 0.6
    c[int(128 * 0.62) - 2:int(128 * 0.62)][mk[int(128 * 0.62) - 2:int(128 * 0.62)]] = C["hi"]
    c[78:, 60:68] = C["hi"]
    statue(c, 64, 80, 108, C["hi"] * 1.05)
    noise(c, 0.05)

    # -- tympanum: the Last Judgement in two registers over a band of small figures
    c = cell("tympanum")
    stone_bg(c, course=16)
    c *= 0.92
    for row, (y0, y1, n) in enumerate(((6, 28, 5), (32, 54, 9))):
        for k in range(n):
            statue(c, 64 + (k - (n - 1) / 2) * (100 / n), y0, y1, C["hi"] * (1.05 if row == 0 and k == n // 2 else 0.95))
        c[y1 + 1:y1 + 3] = C["lo"]
    statue(c, 64, 2, 30, C["hi"] * 1.1)
    c[56:] = C["hi"] * 0.95
    for x in range(2, 128, 6):
        c[57:63, x:x + 3] = C["lo"]
    noise(c, 0.06)

    # -- a gable: blind tracery rising to the slopes, three statues in niches, crockets
    c = cell("gable")
    stone_bg(c)
    for x0 in range(2, 124, 12):
        xc = x0 + 5
        top = int(abs(xc - 64) + 6)
        if 52 <= xc <= 76 or 60 - top < 12:
            continue
        panel(c, x0, top, 10, 60 - top, 0.85, trefoil=False)
    for x0, y0, w, h in ((52, 14, 24, 46), (37, 30, 14, 30), (77, 30, 14, 30)):
        mk = arch_mask(w, h, 0.72)
        sub = c[y0:y0 + h, x0:x0 + w]
        sub[mk] = C["lo"] * 0.55
        statue(c, x0 + w / 2, y0 + 5, y0 + h - 1, C["hi"])
    line(c, 0, 62, 64, 0, C["hi"], 3)
    line(c, 64, 0, 127, 62, C["hi"], 3)
    for k in range(4, 60, 7):
        c[max(0, 62 - k - 3):max(0, 62 - k - 1), k:k + 2] = C["hi"]
        c[max(0, 62 - k - 3):max(0, 62 - k - 1), 126 - k:128 - k] = C["hi"]
    noise(c, 0.06)

    # -- balustrade: rails, posts and pierced quatrefoils
    c = cell("balustrade")
    c[:] = C["dark"]
    for x in range(0, 128, 16):
        c[:, x:x + 3] = C["stone"]
        q = circle(16, 16, 8.5, 8.5, 3.2, 4.8)
        sub = c[:, x:x + 16]
        sub[q[:, :sub.shape[1]]] = C["stone"]
    c[0:3] = C["hi"]
    c[13:16] = C["stone"]
    noise(c, 0.05)

    # -- house fronts against the church: whitewash, brick with a shop, grey plaster
    c = cell("house_a")
    c[:] = C["plaster"]
    noise(c, 0.05)
    c[0:3] = C["wood"] * 1.3
    c[58:] = C["lo"]
    for x0 in (5, 25, 45):
        small_window(c, x0, 9, x0 + 13, 27, shutters=True)
    c[35:58, 7:19] = C["wood"]
    c[35:38, 7:19] = C["glass"]
    small_window(c, 27, 38, 39, 54)
    small_window(c, 45, 38, 57, 54)

    c = cell("house_b")
    c[:] = C["brick"]
    for y in range(0, 64, 3):
        c[y] *= 0.8
        for x in range((y // 3 % 2) * 3, 64, 6):
            c[y:y + 2, x] *= 0.85
    noise(c, 0.06)
    c[0:3] = C["stone"]
    small_window(c, 8, 8, 24, 26)
    small_window(c, 38, 8, 54, 26)
    c[30:34, 3:61] = C["dark"]
    c[34:58, 4:40] = C["wood"]
    c[36:56, 6:38] = C["glass"]
    c[36:56, 21] = C["wood"]
    c[34:60, 44:56] = C["wood"] * 0.8
    c[58:] = C["lo"]

    c = cell("house_c")
    c[:] = C["plaster2"]
    noise(c, 0.05)
    c[0:3] = C["lo"]
    for x0 in (6, 26, 46):
        small_window(c, x0, 8, x0 + 12, 25)
    c[33:60, 26:38] = C["wood"]
    small_window(c, 6, 36, 18, 52)
    small_window(c, 46, 36, 58, 52)
    c[60:] = C["lo"]

    # -- buttress face: a statue niche over a blind panel, gablet on top
    c = cell("buttress")
    stone_bg(c, col="stone")
    c *= 1.04
    panel(c, 5, 62, 22, 62, 0.85)
    mk = arch_mask(18, 34, 0.7)
    sub = c[22:56, 7:25]
    sub[mk] = C["lo"] * 0.55
    statue(c, 16, 30, 55, C["hi"])
    line(c, 2, 24, 16, 6, C["hi"], 2)
    line(c, 16, 6, 30, 24, C["hi"], 2)
    noise(c, 0.06)

    # -- dormer front, plain plaster, a lead-grey tier of the crossing lantern
    c = cell("dormer")
    c[:] = C["leadg"]
    c[14:, 3:29] = C["wood"] * 1.3
    small_window(c, 8, 16, 24, 31)
    c = cell("plaster")
    c[:] = C["plaster"] * 0.92
    noise(c, 0.06)
    c = cell("tier")
    c[:] = C["leadg"]
    for x in range(0, 64, 6):
        c[:, x] *= 0.8
    c[0:4] = C["leadg"] * 1.45
    c[60:] = C["leadg"] * 1.3
    mk = arch_mask(20, 38, 0.7)
    sub = c[13:51, 22:42]
    sub[mk] = C["white"] * 0.8
    sub[erode(mk, 2)] = C["glass"]
    sub[:, 9:11][erode(mk, 2)[:, 9:11]] = C["white"] * 0.8
    noise(c, 0.04)

    # ================= the other landmarks
    def cross_win(c, x0, y0, x1, y1, frame=3, shutters=False, bars=False):
        c[y0:y1, x0:x1] = C["hi"] * 1.05
        c[y0 + frame:y1 - frame, x0 + frame:x1 - frame] = C["glass"]
        g = c[y0 + frame:y1 - frame, x0 + frame:x1 - frame]
        g[::4, :] = C["lead"]
        g[:, ::4] = C["lead"]
        mx = (x0 + x1) // 2
        ty = y0 + (y1 - y0) * 2 // 5
        c[y0:y1, mx - 1:mx + 1] = C["hi"] * 1.05
        c[ty - 1:ty + 1, x0:x1] = C["hi"] * 1.05
        if bars:
            for x in range(x0 + frame + 2, x1 - frame, 4):
                c[ty:y1 - frame, x] = C["dark"]
        if shutters:
            c[y0:y1, max(0, x0 - 5):x0] = C["shutter"]
            c[y0:y1, x1:x1 + 5] = C["shutter"]
            c[y0 + 3:y1 - 3:6, max(0, x0 - 5):x0] = C["shutter"] * 0.7
            c[y0 + 3:y1 - 3:6, x1:x1 + 5] = C["shutter"] * 0.7
        c[y1:y1 + 2, x0 - 1:x1 + 1] = C["hi"]

    def round_mask(w, h, spring):
        xx, yy = grid(h, w)
        r = w / 2
        return (yy >= spring) | (np.hypot(xx - r, yy - spring) <= r)

    # -- town hall bay: Doric pilasters below, Ionic above, cross windows with pediments
    c = cell("sh_bay")
    stone_bg(c, course=6)
    c *= 1.08
    for y0, y1 in ((4, 60), (68, 124)):
        c[y0:y1, 0:6] = C["hi"] * 1.1
        c[y0:y1, 58:64] = C["hi"] * 1.1
        c[y0:y1, 6] = C["lo"]
        c[y0:y1, 57] = C["lo"]
        c[y0:y0 + 3, 0:7] = C["hi"] * 1.2
        c[y0:y0 + 3, 57:64] = C["hi"] * 1.2
    c[0:4] = C["hi"] * 1.15
    c[60:68] = C["hi"] * 1.1
    c[63] = C["lo"]
    c[124:] = C["hi"] * 1.1
    for y0 in (14, 78):
        cross_win(c, 16, y0, 48, y0 + 38)
        line(c, 14, y0 - 2, 32, y0 - 9, C["hi"] * 1.15, 2)
        line(c, 32, y0 - 9, 50, y0 - 2, C["hi"] * 1.15, 2)
    noise(c, 0.05)

    # -- town hall ground floor: rusticated round arch, a dark shop behind
    c = cell("sh_arcade")
    c[:] = C["stone"] * 0.95
    for y in range(0, 64, 6):
        c[y] = C["lo"]
        for x in range((y // 6 % 2) * 8, 64, 16):
            c[y:y + 6, x] = C["lo"]
    mk = round_mask(40, 56, 20)
    sub = c[8:64, 12:52]
    sub[mk] = C["hi"]
    inner = erode(mk, 3)
    sub[inner] = C["dark"]
    sub[inner & (rng.random(inner.shape) < 0.05)] = C["glint"]
    sub[26:28][inner[26:28]] = C["wood"]
    c[4:10, 30:34] = C["hi"] * 1.1
    noise(c, 0.05)

    c = cell("sh_loggia")
    c[:] = C["dark"] * 1.4
    mk = round_mask(28, 54, 14)
    sub = c[10:64, 18:46]
    sub[mk] = C["glass"]
    sub[mk & ~erode(mk, 2)] = C["stone"] * 0.6
    noise(c, 0.04)

    c = cell("fanlight")
    stone_bg(c, course=8)
    mk = round_mask(64, 32, 32) & (grid(32, 64)[1] < 32)
    c[mk] = C["glass"]
    for k in range(1, 8):
        a = math.pi * k / 8
        line(c, 32, 31, 32 - 30 * math.cos(a), 31 - 30 * math.sin(a), C["white"] * 0.8, 1)
    c[mk & ~erode(mk, 2)] = C["hi"]
    c[29:32] = C["hi"]

    # -- the arms of Antwerp in a cartouche: a red shield, the white castle, two hands
    c = cell("arms")
    stone_bg(c)
    c[circle(64, 64, 32, 32, 0, 30)] = C["hi"] * 1.1
    c[circle(64, 64, 32, 32, 26, 30)] = C["lo"]
    xx, yy = grid(64, 64)
    shield = (np.abs(xx - 32) < 16) & (yy > 12) & (yy < 42) | (np.hypot(xx - 32, yy - 42) < 16) & (yy >= 42)
    c[shield] = np.array((0.62, 0.12, 0.10), np.float32)
    c[26:44, 22:42] = C["white"]
    c[20:26, 22:27] = C["white"]
    c[20:26, 29:35] = C["white"]
    c[20:26, 37:42] = C["white"]
    c[36:44, 29:35] = np.array((0.62, 0.12, 0.10), np.float32)
    c[14:20, 16:22] = C["white"]
    c[14:20, 42:48] = C["white"]
    c[4:10, 26:38] = C["gold"]

    c = cell("cross_window")
    stone_bg(c)
    cross_win(c, 10, 6, 54, 58, frame=4)

    c = cell("slit")
    stone_bg(c)
    c[6:58, 14:18] = C["void"]
    c[26:30, 8:24] = C["void"]
    c[4:6, 12:20] = C["hi"]
    c[58:60, 12:20] = C["hi"]

    # -- Hanseatic House bay: three storeys of cross windows with shutters, stone bands
    c = cell("hz_bay")
    stone_bg(c, course=6)
    c *= 1.06
    for y0 in (6, 48, 90):
        cross_win(c, 18, y0, 46, y0 + 30, frame=3, shutters=True)
        c[y0 + 36:y0 + 39] = C["hi"] * 1.1
    c[:, 0:3] = C["hi"] * 1.1
    c[:, 61:64] = C["hi"] * 1.1
    noise(c, 0.05)

    c = cell("hz_arch")
    stone_bg(c, course=6)
    mk = round_mask(40, 58, 20)
    sub = c[6:64, 12:52]
    sub[mk] = C["hi"] * 1.05
    inner = erode(mk, 4)
    sub[inner] = C["wood"]
    sub[:, 19:21][inner[:, 19:21]] = C["wood"] * 0.5
    for y in range(28, 58, 8):
        sub[y][inner[y]] = C["wood"] * 0.6
    c[2:8, 29:35] = C["hi"] * 1.15
    noise(c, 0.05)

    # -- Vleeshuis upper floors: three small windows with white stone frames on the stripes
    c = cell("vh_upper")
    c[:] = C["brick"]
    for y in range(0, 128, 13):  # the game's striped brick: a white band every 0.75 m
        c[y:y + 3] = C["plaster"] * 0.95
    for y0 in (6, 48, 90):
        cross_win(c, 16, y0, 48, y0 + 28, frame=4)
    noise(c, 0.05)

    c = cell("st_window")
    stone_bg(c)
    mk = arch_mask(36, 52, 0.7)
    sub = c[6:58, 14:50]
    sub[mk] = C["hi"]
    inner = erode(mk, 3)
    sub[inner] = C["glass"]
    sub[:, 17:19][inner[:, 17:19]] = C["hi"]
    for x in range(4, 36, 5):
        sub[:, x][inner[:, x]] = C["dark"]
    noise(c, 0.05)

    return np.clip(A, 0, 1)


def cath_materials():
    """The atlas image (packed, goes into the GLB) and the two extra materials."""
    if "cath_atlas" in bpy.data.materials:
        return
    import numpy as np

    px = paint_atlas()
    img = bpy.data.images.new("cath_atlas", AT, ATH, alpha=False)
    rgba = np.ones((ATH, AT, 4), np.float32)
    rgba[..., :3] = np.flipud(px)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    mt = bpy.data.materials.new("cath_atlas")
    nt = mt.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    mt.diffuse_color = (0.55, 0.5, 0.42, 1)
    g = bpy.data.materials.new("gilt")
    g.diffuse_color = (0.8, 0.55, 0.16, 1)
    gb = g.node_tree.nodes.get("Principled BSDF")
    gb.inputs["Base Color"].default_value = (0.8, 0.55, 0.16, 1)
    gb.inputs["Metallic"].default_value = 0.6


def _sq(cu, cv, h):
    return [(cu - h, cv - h), (cu + h, cv - h), (cu + h, cv + h), (cu - h, cv + h)]


def _lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _centre(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


class CMesh(Mesh):
    """The cathedral mesh: faces that show an atlas cell keep their own UVs; the
    rest get the box projection. Vertex colour darkens towards the ground."""

    def __init__(self, frame):
        super().__init__(frame)
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.fixed = set()
        self.doors = []
        self.clocks = []

    def door(self, name, pt):
        """Note a door (local u, v, y at the middle of its sill) for the report."""
        x, _, z = self.f.w(pt[0], pt[1], 0)
        self.doors.append((name, round(x, 1), round(z, 1)))

    def upoly(self, pts, uvs, mat=ATLAS, shade=1.0, out=None):
        f = self.poly(pts, mat, shade)
        if f is None:
            return None
        by_vert = {loop.vert: uv for loop, uv in zip(f.loops, uvs)}
        if out is not None:
            self.orient(f, out)
        for loop in f.loops:
            loop[self.uvl].uv = by_vert[loop.vert]
        self.fixed.add(f)
        return f

    def tex(self, pts, cell, shape=RECT, shade=1.0, out=None):
        return self.upoly(pts, [cell_uv(cell, x, t) for x, t in shape], ATLAS, shade, out)

    def decal(self, p, d, o, s0, s1, y0, y1, cell, shape=RECT, off=0.06, shade=1.0):
        """An atlas cell on a wall: p a point of the wall, d along it, o out of it (unit, local u-v)."""
        if cell == "clock":
            # the dial's middle, 5 mm in front of it, its radius (the gilt ring): for the live hands (clock_marker)
            sm = (s0 + s1) / 2
            self.clocks.append(((p[0] + d[0] * sm + o[0] * (off + 0.005), p[1] + d[1] * sm + o[1] * (off + 0.005), (y0 + y1) / 2),
                                (o[0], o[1]), (s1 - s0) / 2 * 31.5 / 32))
        pts = []
        for x, t in shape:
            s = s0 + (s1 - s0) * x
            pts.append((p[0] + d[0] * s + o[0] * off, p[1] + d[1] * s + o[1] * off, y0 + (y1 - y0) * t))
        return self.tex(pts, cell, shape, shade, (o[0], o[1], 0))

    def tex_prism(self, ring, y0, y1, cell, ring_top=None, shade=1.0, skip=(), rep=1):
        """Prism walls, each face showing the whole cell (rep times up the wall); ring_top tapers them."""
        if rep > 1:
            rt = ring_top or ring
            for k in range(rep):
                ra = [_lerp2(a, b, k / rep) for a, b in zip(ring, rt)]
                rb = [_lerp2(a, b, (k + 1) / rep) for a, b in zip(ring, rt)]
                self.tex_prism(ra, y0 + (y1 - y0) * k / rep, y0 + (y1 - y0) * (k + 1) / rep, cell, rb, shade, skip)
            return
        rt = ring_top or ring
        cu, cv = _centre(ring)
        n = len(ring)
        for i in range(n):
            if i in skip:
                continue
            a, b, a2, b2 = ring[i], ring[(i + 1) % n], rt[i], rt[(i + 1) % n]
            self.tex([(a[0], a[1], y0), (b[0], b[1], y0), (b2[0], b2[1], y1), (a2[0], a2[1], y1)], cell,
                     shade=shade, out=((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0))

    def frustum(self, r0, y0, r1, y1, mat, shade=1.0):
        cu, cv = _centre(r0)
        n = len(r0)
        for i in range(n):
            a, b, c, d = r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]
            f = self.poly([(a[0], a[1], y0), (b[0], b[1], y0), (c[0], c[1], y1), (d[0], d[1], y1)], mat, shade)
            self.orient(f, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv, 0.4))

    def flyer(self, a, b, w=0.45, t=0.8):
        """A flying buttress from a = (u, v, y) on the pier to b on the wall: a sloped
        coping on top, an arched underside."""
        du, dv = b[0] - a[0], b[1] - a[1]
        L = math.hypot(du, dv) or 1.0
        pu, pv = -dv / L * w / 2, du / L * w / 2
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        yt = (a[2] + b[2]) / 2
        bot = [(a[0], a[1], a[2] - t * 1.8), (mid[0], mid[1], yt - t * 0.9), (b[0], b[1], b[2] - t * 1.8)]
        for sg in (-1, 1):
            P = [(q[0] + sg * pu, q[1] + sg * pv, q[2]) for q in bot + [b, a]]
            self.orient(self.poly(P, STONE, 0.95), (sg * pu, sg * pv, 0))
        self.orient(self.poly([(a[0] - pu, a[1] - pv, a[2]), (a[0] + pu, a[1] + pv, a[2]), (b[0] + pu, b[1] + pv, b[2]),
                               (b[0] - pu, b[1] - pv, b[2])], STONE), (0, 0, 1))
        for q0, q1 in ((bot[0], bot[1]), (bot[1], bot[2])):
            self.orient(self.poly([(q0[0] - pu, q0[1] - pv, q0[2]), (q0[0] + pu, q0[1] + pv, q0[2]), (q1[0] + pu, q1[1] + pv, q1[2]),
                                   (q1[0] - pu, q1[1] - pv, q1[2])], STONE, 0.8), (0, 0, -1))

    def balustrade(self, a, b, y, out, h=1.2, piece=3.0):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / piece))
        for k in range(n):
            p0, p1 = _lerp2(a, b, k / n), _lerp2(a, b, (k + 1) / n)
            self.tex([(p0[0], p0[1], y), (p1[0], p1[1], y), (p1[0], p1[1], y + h), (p0[0], p0[1], y + h)], "balustrade",
                     out=(out[0], out[1], 0))

    def balustrade_ring(self, ring, y, h=1.2, piece=3.0):
        cu, cv = _centre(ring)
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            self.balustrade(a, b, y, ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv), h, piece)

    def spike(self, u, v, y0, y1, r, mat=GILT):
        self.prism(self.ngon(u, v, r, 4, math.pi / 4), y0, y1, mat, top=True)

    def cross(self, u, v, y0, h=2.6, arm=0.7, r=0.08, mat=GILT):
        """An upright cross, its arms north-south (seen whole from the west and east)."""
        self.box(u - r, u + r, v - r, v + r, y0, y0 + h, mat)
        ya = y0 + h * 0.62
        self.box(u - r, u + r, v - arm, v + arm, ya, ya + 2 * r + 0.06, mat)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        for f in self.bm.faces:
            for loop in f.loops:
                c = loop[self.col]
                k = 0.8 + 0.2 * min(1.0, max(0.0, loop.vert.co.z / 30.0))
                loop[self.col] = (c[0] * k, c[1] * k, c[2] * k, 1.0)
            if f in self.fixed:
                continue
            f.normal_update()
            n = f.normal
            if abs(n.z) > 0.7:
                for loop in f.loops:
                    loop[self.uvl].uv = (loop.vert.co.x / 3, loop.vert.co.y / 3)
            else:
                tx, ty = -n.y, n.x
                ln = math.hypot(tx, ty) or 1
                tx, ty = tx / ln, ty / ln
                for loop in f.loops:
                    co = loop.vert.co
                    loop[self.uvl].uv = ((co.x * tx + co.y * ty) / 3, co.z / 3)
        self.tris = sum(len(f.verts) - 2 for f in self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for mname in getattr(self, "mats", CATH_MATS):
            me.materials.append(bpy.data.materials[mname])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        use_shading(ob)
        print(f"[build_landmarks] {name}: {self.tris} triangles")
        for dn, dx, dz in self.doors:
            print(f"[build_landmarks]   door {dn}: world x {dx}, z {dz}")
        return ob


# ---- the plan, in metres, fitted to the outline in shared/city.json (u from the west
# front, v to the north): nave and aisles 53 m across (seven aisles), transept 76 m,
# towers 12 m square at u 1.8..13.8, crossing at u 74.6, apse centre at u 107.
HN, AE, NE, NR = 6.6, 16.5, 30.0, 46.0  # half nave, aisle eaves, nave eaves, ridge
VO = 26.0  # the outer aisle walls
T0, T1, TV = 67.3, 81.9, 36.0  # transept: its two sides and the facade plane
AU = 107.0  # centre of the apse
TU, TVN = 9.2, 12.2  # tower centres: u, and |v|


def _arch_outline(hw, h, tsp, seg=4, rnd=False):
    """A pointed arch from the right foot over the apex to the left foot: (s, y), s centred.
    rnd: a round (semicircular) arch of the same height instead."""
    if rnd:
        sp = max(0.0, h - hw)
        return [(hw, 0), (hw, sp)] + [(hw * math.cos(math.pi * k / (2 * seg)), sp + hw * math.sin(math.pi * k / (2 * seg)))
                                      for k in range(1, 2 * seg)] + [(-hw, sp), (-hw, 0)]
    pts = [(1, 0), (1, tsp)] + [(x, arch_t(x, tsp)) for x in (1 - k / (2 * seg) for k in range(1, 2 * seg))] + [(0, tsp), (0, 0)]
    return [((x - 0.5) * 2 * hw, t * h) for x, t in pts]


def _holed_wall(m, p, d, o, s0, s1, y0, y1, holes, cell=None, mat=STONE, shade=1.0):
    """A wall from s0 to s1 with arched openings standing on its foot: holes = [(sc, hw, h, tsp)].
    With a cell the wall shows it, mapped by position."""
    loop = [(s0, y0)]
    for hole in sorted(holes):
        sc, hw, h, tsp = hole[:4]
        loop += [(sc + s, y0 + y) for s, y in reversed(_arch_outline(hw, h, tsp, rnd=len(hole) > 4 and hole[4]))]
    loop += [(s1, y0), (s1, y1), (s0, y1)]
    pts = [(p[0] + d[0] * s, p[1] + d[1] * s, y) for s, y in loop]
    if cell:
        shape = [((s - s0) / (s1 - s0), (y - y0) / (y1 - y0)) for s, y in loop]
        return m.tex(pts, cell, shape, shade, (o[0], o[1], 0))
    f = m.poly(pts, mat, shade * 0.88)
    m.orient(f, (o[0], o[1], 0))
    return f


def _portal(m, p, d, o, sc, hw0, hw1, depth, h0, h1, tsp, lintel, bands=5, trumeau=False, steps=True, rnd=False, door=None, tymp="tympanum", leaves=True):
    """A splayed portal cut into a wall (see _holed_wall): stepped archivolt bands from the
    wall face (hw0, h0) to the doors `depth` inside (hw1, h1), a tympanum over a carved
    lintel, two dark door leaves with iron hinges, a trumeau with a statue, steps.
    leaves=False (M7, the cathedral's west door): no leaves, a real opening under the lintel;
    the game hangs its own leaves there and draws the nave behind (world/cathedralInWorld.ts)."""
    def W(s, y, dep):
        return (p[0] + d[0] * s - o[0] * dep, p[1] + d[1] * s - o[1] * dep, y)
    ysp = h0 - hw0 if rnd else h0 * tsp
    rings = []
    for k in range(bands + 1):
        f = k / bands
        rings.append((depth * f, _arch_outline(hw0 + (hw1 - hw0) * f, h0 + (h1 - h0) * f, tsp, rnd=rnd)))
    if door and hasattr(m, "door"):
        m.door(door, W(sc, 0, depth))
    for k in range(bands):
        (da, A), (db, Bn) = rings[k], rings[k + 1]
        # each band: a step parallel to the wall, then a short return into the depth
        dm = (da + db) / 2
        for i in range(len(A) - 1):
            sm = (A[i][0] + A[i + 1][0]) / 2
            ym = (A[i][1] + A[i + 1][1]) / 2
            out = (o[0] + d[0] * (-sm) * 0.3, o[1] + d[1] * (-sm) * 0.3, (ysp - ym) * 0.3 if ym > ysp else 0)
            f = m.poly([W(sc + A[i][0], A[i][1], da), W(sc + A[i + 1][0], A[i + 1][1], da),
                        W(sc + Bn[i + 1][0], Bn[i + 1][1], dm), W(sc + Bn[i][0], Bn[i][1], dm)], STONE, (0.78 if k % 2 == 0 else 0.6) * (1 - 0.55 * k / bands))
            m.orient(f, out)
            f = m.poly([W(sc + Bn[i][0], Bn[i][1], dm), W(sc + Bn[i + 1][0], Bn[i + 1][1], dm),
                        W(sc + Bn[i + 1][0], Bn[i + 1][1], db), W(sc + Bn[i][0], Bn[i][1], db)], STONE, (0.42 if k % 2 == 0 else 0.32) * (1 - 0.5 * k / bands))
            m.orient(f, (-d[0] * sm - o[0] * 0.1, -d[1] * sm - o[1] * 0.1, (ysp - ym) if ym > ysp else 0))
    dep, inner = rings[-1]
    # tympanum over the lintel, a carved band under it
    top = [pt for pt in inner if pt[1] > lintel + 0.05]
    tpts = [(hw1, lintel)] + top + [(-hw1, lintel)]
    ymax = max(y for _, y in tpts)
    m.tex([W(sc + s, y, dep) for s, y in tpts], tymp, [((s + hw1) / (2 * hw1), (y - lintel) / (ymax - lintel)) for s, y in tpts],
          0.72, (o[0], o[1], 0))
    for k, (y0, y1, fwd) in enumerate(((lintel - 0.5, lintel, 0.18), (lintel - 0.62, lintel - 0.5, 0.1))):
        f = m.poly([W(sc - hw1, y0, dep - fwd), W(sc + hw1, y0, dep - fwd), W(sc + hw1, y1, dep - fwd), W(sc - hw1, y1, dep - fwd)], STONE, 1.05)
        m.orient(f, (o[0], o[1], 0))
    # the door leaves: dark oak, iron hinges
    tw = 0.3 if trumeau else 0.03
    dh = lintel - 0.62
    for s0, s1, hinge_side in ((-hw1, -tw, -1), (tw, hw1, 1)) if leaves else ():
        f = m.poly([W(sc + s0, 0.3, dep), W(sc + s1, 0.3, dep), W(sc + s1, dh, dep), W(sc + s0, dh, dep)], LEAD, 0.14)
        m.orient(f, (o[0], o[1], 0))
        hs = s1 if hinge_side > 0 else s0
        he = hs - hinge_side * (s1 - s0) * 0.7
        for yh in (dh * 0.18, dh * 0.5, dh * 0.82):
            a, b = sorted((hs, he))
            f = m.poly([W(sc + a, yh, dep - 0.03), W(sc + b, yh, dep - 0.03), W(sc + b, yh + 0.16, dep - 0.03), W(sc + a, yh + 0.16, dep - 0.03)], LEAD, 0.45)
            m.orient(f, (o[0], o[1], 0))
    if trumeau:
        ring = [W(sc - 0.28, 0, dep - 0.55)[:2], W(sc + 0.28, 0, dep - 0.55)[:2], W(sc + 0.28, 0, dep)[:2], W(sc - 0.28, 0, dep)[:2]]
        m.prism(ring, 0, lintel - 0.62, STONE, top=False, shade=1.05)
        c = W(sc, 0, dep - 0.72)
        m.prism(m.ngon(c[0], c[1], 0.42, 6), 2.2, 2.6, STONE, top=True, shade=1.05)  # corbel
        m.prism(m.ngon(c[0], c[1], 0.3, 6), 2.6, 4.5, STONE, top=False, shade=1.15)  # the Virgin
        m.pyramid(m.ngon(c[0], c[1], 0.3, 6), 4.5, 5.0, STONE)
        m.pyramid(m.ngon(c[0], c[1], 0.45, 6), 5.2, 6.0, STONE)  # canopy
    if steps:
        for k, (e0, e1, y) in enumerate(((-0.9, 0.0, 0.15), (0.0, dep, 0.3))):
            hw =hw0 + 0.4 if k == 0 else hw1 + 0.05
            ring = [W(sc - hw, 0, e0)[:2], W(sc + hw, 0, e0)[:2], W(sc + hw, 0, e1)[:2], W(sc - hw, 0, e1)[:2]]
            m.prism(ring, 0, y, STONE, top=True, shade=0.85)


def _wimperg(m, p, d, o, sc, hw, y0, y1, off=0.35, w=0.45):
    """An open gable over a portal: two crocketed stone bars and a finial."""
    def W(s, y, e):
        return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)
    for sg in (-1, 1):
        a = sc + sg * hw
        f = m.poly([W(a, y0, off), W(a - sg * w, y0, off), W(sc, y1 - w * 1.2, off), W(sc, y1, off)], STONE, 1.05)
        m.orient(f, (o[0], o[1], 0))
        for k in range(1, 4):  # crockets
            s = a + (sc - a) * k / 4
            y = y0 + (y1 - y0) * k / 4
            c = W(s + sg * 0.1, y + 0.25, off + 0.05)
            m.pyramid(m.ngon(c[0], c[1], 0.16, 4, math.pi / 4), y, y + 0.45, STONE)
    c = W(sc, 0, off)
    m.pinnacle(c[0], c[1], y1 - 0.3, 2.2, 0.28)



def _wpt(p, d, o, s, e, y):
    """A point on a wall frame: s along the wall, e out of it, y up."""
    return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)


def _wbox(m, p, d, o, s0, s1, e0, e1, y0, y1, mat=STONE, shade=1.0, top=True, cell=None, rep=1):
    """A box standing against a wall: s0..s1 along it, e0..e1 out of it."""
    ring = [_wpt(p, d, o, s0, e0, 0)[:2], _wpt(p, d, o, s1, e0, 0)[:2], _wpt(p, d, o, s1, e1, 0)[:2], _wpt(p, d, o, s0, e1, 0)[:2]]
    if cell:
        m.tex_prism(ring, y0, y1, cell, rep=rep, shade=shade)
        if top:
            m.orient(m.poly([(q[0], q[1], y1) for q in ring], mat, shade), (0, 0, 1))
    else:
        m.prism(ring, y0, y1, mat, top=top, shade=shade)


def _bays(m, p, d, o, s0, s1, n, y0, y1, cell, shape=RECT, inset=0.0, off=0.06, shade=1.0, skip=()):
    """n equal bays of an atlas cell along a wall."""
    w = (s1 - s0) / n
    for k in range(n):
        if k in skip:
            continue
        m.decal(p, d, o, s0 + k * w + inset, s0 + (k + 1) * w - inset, y0, y1, cell, shape, off, shade)


def _roof_dormer(m, p, d, o, s, e_eave, y_eave, e_ridge, y_ridge, yb, w=1.3, hf=1.6, cell="dormer"):
    """A small dormer on a roof slope that climbs from (e_eave, y_eave) to (e_ridge, y_ridge)
    in a wall frame (e out of the wall); its front stands where the roof is yb high."""
    def e_at(y):
        return e_eave + (y - y_eave) / (y_ridge - y_eave) * (e_ridge - e_eave)
    ef, e1, e2 = e_at(yb), e_at(yb + 0.62 * hf), e_at(yb + hf)
    P = lambda ss, ee, yy: _wpt(p, d, o, ss, ee, yy)  # noqa: E731
    m.tex([P(s - w / 2, ef, yb), P(s + w / 2, ef, yb), P(s + w / 2, ef, yb + 0.62 * hf), P(s, ef, yb + hf), P(s - w / 2, ef, yb + 0.62 * hf)],
          cell, PENT, out=(o[0], o[1], 0))
    for sg in (-1, 1):
        f = m.poly([P(s + sg * w / 2, ef, yb), P(s + sg * w / 2, ef, yb + 0.62 * hf), P(s + sg * w / 2, e1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (d[0] * sg, d[1] * sg, 0))
        f = m.poly([P(s + sg * w / 2, ef, yb + 0.62 * hf), P(s, ef, yb + hf), P(s, e2, yb + hf), P(s + sg * w / 2, e1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (d[0] * sg + o[0] * 0.3, d[1] * sg + o[1] * 0.3, 1))


def _stepgable(m, p, d, o, s0, s1, y0, rise, steps=5, mat=BRICK, off=0.05, crown=0.9, shade=1.0):
    """A stepped gable standing on a wall top: s0..s1 at y0, rising `rise` to the middle."""
    sc, hw = (s0 + s1) / 2, (s1 - s0) / 2
    pts = [(s0, y0)]
    for i in range(steps):
        du = hw * (1 - i / steps)
        y = y0 + rise * (i + 1) / steps
        pts += [(sc - du, y), (sc - du + hw / steps, y)]
    pts += [(sc, y0 + rise + crown)]
    right = [(2 * sc - a, b) for a, b in reversed(pts[1:-1])]
    loop = pts + right + [(s1, y0)]
    f = m.poly([_wpt(p, d, o, a, off, b) for a, b in loop], mat, shade)
    m.orient(f, (o[0], o[1], 0))
    return loop


def _octurret(m, cu, cv, r, y0, y1, spire, mat=BRICK, roof=SLATE, slits=0, finial=True):
    """An octagonal turret with a corbelled rim and a spire."""
    ring = m.ngon(cu, cv, r, 8, math.pi / 8)
    m.prism(ring, y0, y1, mat, top=False)
    m.prism(m.ngon(cu, cv, r + 0.25, 8, math.pi / 8), y1 - 0.6, y1, STONE, top=False, shade=1.05)
    m.pyramid(m.ngon(cu, cv, r + 0.3, 8, math.pi / 8), y1, y1 + spire, roof)
    for k in range(slits):
        a = 2 * math.pi * k / slits
        o = (math.cos(a), math.sin(a))
        dd = (-o[1], o[0])
        pt = (cu + o[0] * r * 0.93, cv + o[1] * r * 0.93)
        y = y0 + (y1 - y0) * (0.3 + 0.4 * (k % 2))
        m.decal(pt, dd, o, -0.25, 0.25, y, y + 1.4, "slit", off=0.05)
    if finial:
        m.spike(cu, cv, y1 + spire - 0.2, y1 + spire + 1.2, 0.05, LEAD)


def _cath_tower(m, tu, tv, north):
    """A west tower. North: four square stages, the gallery, the octagon with the
    clocks and corner turrets, the open upper octagon, two crowns, spire, cross.
    South: three stages, a slate roof, a small lantern and a needle spire."""
    ys = [0.0, 18.0, 36.0, 55.5, 74.0]
    hs = [6.0, 6.0, 5.85, 5.7]
    cells = ["tower_blind", "tower_lancets", "tower_lancets", "tower_lancets"]
    bs = [0.95, 0.85, 0.75, 0.65]
    nst = 4 if north else 3
    # M7: the ground stage's face toward the nave and its east face are inside the church (the hall
    # of world/cathedralInWorld.ts stands there, under the aisle roofs): not built, nor its east
    # corner buttresses, which would stand in the nave and the aisle
    inner = 0 if north else 2
    for i in range(nst):
        y0, y1, h = ys[i], ys[i + 1], hs[i]
        m.tex_prism(_sq(tu, tv, h), y0, y1 - 0.7, cells[i], skip=(3, 1, inner) if i == 0 else ())
        m.prism(_sq(tu, tv, h + 0.25), y1 - 0.7, y1, STONE, top=(i == nst - 1), top_mat=LEAD, shade=1.05)
        for su in (-1, 1):
            for sv in (-1, 1):
                if su > 0 and (i == 0 or (i == 1 and sv * tv < 0)):
                    continue
                cu, cv = tu + su * (h + 0.15), tv + sv * (h + 0.15)
                b = bs[i]
                m.tex_prism(_sq(cu, cv, b), y0, y1 - 1.0, "buttress", rep=2)
                m.prism(_sq(cu, cv, b + 0.1), y1 - 1.0, y1 - 0.6, STONE, top=True)
                m.pinnacle(cu, cv, y1 - 0.6, 7.5 if i == nst - 1 else 4.5, b * 0.8)
        if i >= 1:
            for du, dv in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                m.pinnacle(tu + du * (h + 0.1), tv + dv * (h + 0.1), y1 - 0.2, 3.2, 0.3)
                if i == nst - 1:  # a row of pinnacles round the gallery
                    for q in (-0.5, 0.5):
                        m.pinnacle(tu + du * (h + 0.1) + dv * q * h, tv + dv * (h + 0.1) + du * q * h, y1 - 0.2, 3.8, 0.28)
    # two deep west buttresses per tower, stepping back, as on the outline
    for sv in (-1, 1):
        vb = tv + sv * 5.4
        for y0, y1, e in ((0.0, 18.0, 3.0), (18.0, 34.0, 1.8), (34.0, 50.0, 0.9)):
            m.tex_prism([(tu - hs[0] - e, vb - 1.0), (tu - hs[0], vb - 1.0), (tu - hs[0], vb + 1.0), (tu - hs[0] - e, vb + 1.0)],
                        y0, y1, "buttress", rep=2, skip=(1,))
            m.orient(m.poly([(tu - hs[0] - e, vb - 1.0, y1), (tu - hs[0], vb - 1.0, y1), (tu - hs[0], vb + 1.0, y1), (tu - hs[0] - e, vb + 1.0, y1)], LEAD), (0, 0, 1))
            m.pinnacle(tu - hs[0] - e * 0.55, vb, y1, 3.6, 0.32)
    # the west face of the base: a side portal, and in the north tower the small tower door
    Wt = ((tu - hs[0], 0), (0, 1), (-1, 0))
    holes = [(tv, 2.2, 8.4, 0.58)]
    if north:
        holes.append((tv + 3.3, 0.62, 3.0, 0.8))
    _holed_wall(m, *Wt, tv - hs[0], tv + hs[0], 0, 17.3, holes, "tower_blind", shade=0.88)
    if isinstance(m, CathMesh):
        # M7 the cathedral outside: the side portal carved (jamb statues, statuettes, the tympanum, oak leaves), a
        # statue in a niche each side of it, blind arcading over it, the plinth along the foot
        _cportal(m, *Wt, tv, 2.2, 1.25, 1.5, 8.4, 6.6, 0.58, 4.1, bands=3, jamb=2, virgin=False,
                 door=f"cathedral, {'north' if north else 'south'} side portal")
        _cwimperg(m, *Wt, tv, 2.5, 7.0, 11.6, off=0.3, w=0.35)
        for sg in (-1, 1):
            _niche3d(m, *Wt, tv + sg * 3.4, 3.8 if (north and sg > 0) else 3.0, 2.6, kind=("apostle", "bishop")[(sg > 0) ^ north], dep=0.45)
        for k in range(4):
            s0 = tv - 3.8 + k * 1.9
            _curve_band(m, *Wt, _arch_curve(s0 + 0.2, s0 + 1.6, 12.6, 16.6, 0.72, 4), 0.14, 0.0, 0.18, CARVED, 0.9, caps=False)
        _string(m, *Wt, tv - hs[0], tv + hs[0], 12.3, 0.24, 0.3)
        for a, b in ((tv - hs[0], tv - 2.65), ((tv + 3.95) if north else (tv + 2.65), tv + hs[0])):
            _plinth_run(m, *Wt, a, b)
        if north:
            _cportal(m, *Wt, tv + 3.3, 0.62, 0.52, 0.45, 3.0, 2.8, 0.8, 2.45, bands=1, steps=False, figures=False, jamb=0,
                     door="cathedral, north tower door")
    else:
        _portal(m, *Wt, tv, 2.2, 1.25, 1.5, 8.4, 6.6, 0.58, 4.1, bands=3, door=f"cathedral, {'north' if north else 'south'} side portal")
        _wimperg(m, *Wt, tv, 2.5, 7.0, 11.6, off=0.3, w=0.35)
    if north and not isinstance(m, CathMesh):
        _portal(m, *Wt, tv + 3.3, 0.62, 0.52, 0.45, 3.0, 2.8, 0.8, 2.45, bands=1, steps=False, door="cathedral, north tower door")
    top = ys[nst]
    if not north:
        m.balustrade_ring(_sq(tu, tv, 5.95), top, 1.2)
        # slate roof, a small open lantern, the needle spire (1475, never replaced)
        m.frustum(_sq(tu, tv, 5.7), top + 0.3, _sq(tu, tv, 1.7), top + 6.0, SLATE)
        m.tex_prism(_sq(tu, tv, 1.55), top + 6.0, top + 8.8, "openwork")
        m.prism(_sq(tu, tv, 1.8), top + 8.8, top + 9.2, LEAD, top=True)
        m.pyramid(m.ngon(tu, tv, 1.3, 8, math.pi / 8), top + 9.2, top + 19.5, SLATE)
        m.prism(m.ngon(tu, tv, 0.3, 6), top + 19.3, top + 19.9, GILT, top=True)
        m.cross(tu, tv, top + 19.9, 2.2, 0.6)
        return

    # ---- gallery on the square tower (74 m)
    m.balustrade_ring(_sq(tu, tv, 6.05), top, 1.2)
    # ---- octagon with the clocks (74-92): cardinal faces wide, diagonal faces narrow
    def cham(a, c):
        return [(tu + x, tv + y) for x, y in ((a, -(a - c)), (a, a - c), (a - c, a), (-(a - c), a), (-a, a - c),
                                               (-a, -(a - c)), (-(a - c), -a), (a - c, -a))]
    y0, y1, yc = 74.0, 93.5, 83.2
    r0, r1 = cham(5.0, 1.6), cham(4.8, 1.5)
    rm = [_lerp2(p, q, (yc - y0) / (y1 - y0)) for p, q in zip(r0, r1)]
    for i in range(8):
        j = (i + 1) % 8
        mu = (r0[i][0] + r0[j][0]) / 2 - tu
        mv = (r0[i][1] + r0[j][1]) / 2 - tv
        if i % 2 == 0:
            f = m.poly([(r0[i][0], r0[i][1], y0), (r0[j][0], r0[j][1], y0), (rm[j][0], rm[j][1], yc), (rm[i][0], rm[i][1], yc)], STONE)
            m.orient(f, (mu, mv, 0))
            m.tex([(rm[i][0], rm[i][1], yc), (rm[j][0], rm[j][1], yc), (r1[j][0], r1[j][1], y1), (r1[i][0], r1[i][1], y1)],
                  "openwork", out=(mu, mv, 0))
            # the clock, 6.4 m across
            L = math.hypot(r0[j][0] - r0[i][0], r0[j][1] - r0[i][1])
            d = ((r0[j][0] - r0[i][0]) / L, (r0[j][1] - r0[i][1]) / L)
            o = (mu / math.hypot(mu, mv), mv / math.hypot(mu, mv))
            m.decal(r0[i], d, o, L / 2 - 3.25, L / 2 + 3.25, 75.6, 82.1, "clock", DISC, off=0.14)
        else:
            m.tex([(r0[i][0], r0[i][1], y0), (r0[j][0], r0[j][1], y0), (r1[j][0], r1[j][1], y1), (r1[i][0], r1[i][1], y1)],
                  "openwork", out=(mu, mv, 0))
    m.prism(cham(4.95, 1.5), y1 - 0.6, y1, STONE, top=True, top_mat=LEAD, shade=1.05)
    # four corner turrets on the tower buttresses, tied to the octagon by flyers
    for su in (-1, 1):
        for sv in (-1, 1):
            cu, cv = tu + su * 5.9, tv + sv * 5.9
            m.tex_prism(_sq(cu, cv, 0.55), y0, 95.0, "buttress", rep=3)
            m.prism(_sq(cu, cv, 0.68), 95.0, 95.5, STONE, top=True)
            m.pinnacle(cu, cv, 95.5, 8.0, 0.62)
            for du, dv in ((su, 0), (0, sv)):
                m.pinnacle(cu + du * 0.75, cv + dv * 0.75, 86.0, 6.5, 0.28)
            for ya, yb in ((86.0, 87.2), (91.8, 92.8)):
                m.flyer((cu - su * 0.5, cv - sv * 0.5, ya), (tu + su * 4.2, tv + sv * 4.2, yb), 0.35, 0.5)
    m.balustrade_ring(cham(5.0, 1.55), y1, 1.1, piece=2.5)

    # ---- the open upper octagon (92-104): eight slender piers round a stair core
    R2 = 3.8
    o2 = m.ngon(tu, tv, R2, 8, math.pi / 8)
    m.prism(m.ngon(tu, tv, 1.5, 8, math.pi / 8), y1, 106.5, STONE, top=False, shade=0.55)
    for (pu, pv) in o2:
        m.tex_prism(_sq(pu, pv, 0.3), y1, 104.0, "buttress")
    m.tex_prism(o2, 104.0, 106.1, "tower_blind")
    for i in range(8):
        a, b = o2[i], o2[(i + 1) % 8]
        mu, mv = (a[0] + b[0]) / 2 - tu, (a[1] + b[1]) / 2 - tv
        ln = math.hypot(mu, mv)
        o = (mu / ln, mv / ln)
        d = ((b[0] - a[0]) / 2.908, (b[1] - a[1]) / 2.908)
        # a mullion in each opening, a gablet over it
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        f = m.poly([(mid[0] - d[0] * 0.09, mid[1] - d[1] * 0.09, y1 + 0.5), (mid[0] + d[0] * 0.09, mid[1] + d[1] * 0.09, y1 + 0.5),
                    (mid[0] + d[0] * 0.09, mid[1] + d[1] * 0.09, 104.0), (mid[0] - d[0] * 0.09, mid[1] - d[1] * 0.09, 104.0)], STONE)
        m.orient(f, (o[0], o[1], 0))
        m.decal(a, d, o, 0.1, 2.8, 103.7, 107.9, "gable", GABLE, off=0.25)
    m.prism(m.ngon(tu, tv, R2 + 0.35, 8, math.pi / 8), 106.1, 106.5, STONE, top=True, top_mat=LEAD)
    # eight pinnacles on the lower gallery, flyers to the piers
    for (pu, pv) in cham(4.95, 1.5):
        m.pinnacle(pu, pv, y1, 12.5, 0.34)
        nb = min(o2, key=lambda q: (q[0] - pu) ** 2 + (q[1] - pv) ** 2)
        m.flyer((pu, pv, 100.4), (nb[0] + (pu - nb[0]) * 0.1, nb[1] + (pv - nb[1]) * 0.1, 101.4), 0.25, 0.4)
    m.balustrade_ring(m.ngon(tu, tv, R2 + 0.3, 8, math.pi / 8), 106.5, 1.0, piece=3.0)

    # ---- the two crowns and the spire
    for ci, (yb, yt, R, core, pr, ph, pw) in enumerate(((106.5, 111.6, 3.0, 1.2, 3.6, 7.4, 0.26), (112.4, 116.2, 2.1, 0.85, 2.55, 5.8, 0.2))):
        ring = m.ngon(tu, tv, R, 8, math.pi / 8)
        m.prism(m.ngon(tu, tv, core, 8, math.pi / 8), yb, yt + 1.0, STONE, top=False, shade=0.6)
        for (pu, pv) in ring:
            m.prism(_sq(pu, pv, R * 0.085), yb, yt, STONE, top=False)
        m.prism(m.ngon(tu, tv, R + 0.2, 8, math.pi / 8), yt, yt + 0.8, STONE, top=True, top_mat=LEAD)
        for k, (pu, pv) in enumerate(m.ngon(tu, tv, pr, 8, ci * math.pi / 8)):
            m.pinnacle(pu, pv, yb, ph, pw)
            if k % 2 == 0:
                m.flyer((pu, pv, yb + ph * 0.55), (tu + (pu - tu) * R / pr * 0.95, tv + (pv - tv) * R / pr * 0.95, yb + ph * 0.62), 0.18, 0.3)
    m.pyramid(m.ngon(tu, tv, 1.15, 8, math.pi / 8), 117.0, 120.7, STONE)
    m.prism(m.ngon(tu, tv, 0.42, 8), 120.6, 121.2, GILT, top=True)
    m.cross(tu, tv, 121.2, 2.7, 0.75, 0.09)


def _house(m, p, d, o, s0, s1, depth, h, rise, cell, chimney=False):
    """A house built against the church: front wall at `depth` from the church wall,
    plastered ends, a slate roof with the ridge along the wall."""
    def W(s, off, y):
        return (p[0] + d[0] * s + o[0] * off, p[1] + d[1] * s + o[1] * off, y)
    om = depth / 2
    m.tex([W(s0, depth, 0), W(s1, depth, 0), W(s1, depth, h), W(s0, depth, h)], cell, out=(o[0], o[1], 0))
    end = [(0, 0), (1, 0), (1, 0.72), (0.5, 1), (0, 0.72)]
    for se, sg in ((s0, -1), (s1, 1)):
        m.tex([W(se, 0, 0), W(se, depth, 0), W(se, depth, h), W(se, om, h + rise), W(se, 0, h)], "plaster", end,
              shade=0.85, out=(d[0] * sg, d[1] * sg, 0))
    for e0, sg in ((depth + 0.35, 1), (0.0, -1)):
        f = m.poly([W(s0 - 0.15, e0, h - (0.25 if sg > 0 else 0)), W(s1 + 0.15, e0, h - (0.25 if sg > 0 else 0)),
                    W(s1 + 0.15, om, h + rise), W(s0 - 0.15, om, h + rise)], SLATE, 0.9)
        m.orient(f, (o[0] * sg, o[1] * sg, 1))
    if chimney:
        c = W((s0 + s1) / 2 + 0.8, om * 0.8, 0)
        m.box(c[0] - 0.35, c[0] + 0.35, c[1] - 0.35, c[1] + 0.35, h + rise * 0.6, h + rise + 1.1, BRICK)


def _dormer(m, u, side, yb, w=1.3, hf=1.5):
    """A small dormer in the great roof (ridge along u, slope from HN at NE to 0 at NR)."""
    def vr(y):
        return side * (HN - (y - NE) * HN / (NR - NE))
    vf, v1, v2 = vr(yb), vr(yb + 0.62 * hf), vr(yb + hf)
    m.tex([(u - w / 2, vf, yb), (u + w / 2, vf, yb), (u + w / 2, vf, yb + 0.62 * hf), (u, vf, yb + hf), (u - w / 2, vf, yb + 0.62 * hf)],
          "dormer", PENT, out=(0, side, 0))
    for sg in (-1, 1):
        f = m.poly([(u + sg * w / 2, vf, yb), (u + sg * w / 2, vf, yb + 0.62 * hf), (u + sg * w / 2, v1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (sg, 0, 0))
        f = m.poly([(u + sg * w / 2, vf, yb + 0.62 * hf), (u, vf, yb + hf), (u, v2, yb + hf), (u + sg * w / 2, v1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (sg, side * 0.3, 1))


def _aisle_bay(m, ua, ub, side, window=True, flyer=False, real=None, clip=None):
    """One bay of the outer aisle wall on one side: wall, window, balustrade, the
    buttress at ua with its pinnacle, and the transverse hipped roof over the aisles.
    real: the window's label if it is a real opening (issue #10: the hall stands behind it); clip: a house against the
    church hides it up to this height (only the part above it is real, the rest stays painted behind the house)."""
    vo = side * VO
    o = (0, side)
    if window and real:
        hole = _real_win(m, (0, vo), (1, 0), o, ua + 1.7, ub - 1.7, 3.6, 14.6, "great_window", arch_shape(0.66, 3), real, clip=clip)
        _cut_wall(m, (0, vo), (1, 0), o, ua, ub, 0, AE, [hole], shade=0.95)
    else:
        f = m.poly([(ua, vo, 0), (ub, vo, 0), (ub, vo, AE), (ua, vo, AE)], STONE, 0.95)
        m.orient(f, (0, side, 0))
    if window and not real:
        m.decal((0, vo), (1, 0), o, ua + 1.7, ub - 1.7, 3.6, 14.6, "great_window", arch_shape(0.66, 3))
    m.balustrade((ua, vo + side * 0.25), (ub, vo + side * 0.25), AE, o, 1.1)
    if isinstance(m, CathMesh):
        # M7 the cathedral outside: a cornice under the balustrade, a string course at the sills, the plinth
        _wb(m, (0, vo), (1, 0), o, ua, ub, 0.0, 0.3, AE - 0.55, AE, CARVED, 0.95)
        _string(m, (0, vo), (1, 0), o, ua, ub, 3.35)
        _plinth_run(m, (0, vo), (1, 0), o, ua, ub)
    hr = (ub - ua) / 2
    um = (ua + ub) / 2
    R = hr * 1.25
    vi = side * HN
    ve = side * (VO + 0.3)
    for ue, sg in ((ua, -1), (ub, 1)):
        f = m.poly([(ue, vi, AE), (ue, ve, AE), (um, ve - side * hr, AE + R), (um, vi, AE + R)], SLATE)
        m.orient(f, (sg, 0, 1))
    f = m.poly([(ua, ve, AE), (ub, ve, AE), (um, ve - side * hr, AE + R)], SLATE)
    m.orient(f, (0, side, 1))


def _buttress(m, u, side, top=AE - 0.4, pin=5.0, depth=1.4, w=0.6):
    vo = side * VO
    va, vb = sorted((vo, vo + side * depth))
    m.box(u - w, u + w, va, vb, 0, top, STONE, shade=0.95)
    m.pinnacle(u, vo + side * depth * 0.55, top, pin, 0.45)


# ------------------------------------------------------------------ the cathedral outside in detail (M7, 2026-09-26)
#
# Steve: "cathedral needs more detail, the other churches have 3d statues and cathedral not ... (entrances have a
# lot of detail)", and the houses against it were flat painted fronts. The cathedral now has its own model
# (client/public/models/cathedral.glb, drawn by client/src/world/cathedralOutside.ts) with its own materials:
# Codex pictures of weathered, sooted Brabant sandstone (walls, low courses, carved work), the oak of the doors and
# the portal's tympanum, and the town's own house wall pictures, each with a height map made from it (bump).
# The plan is unchanged (the footprint, the doors, the inside's walls: shared/cathedralPlan.ts). What was painted
# into the atlas as stone is now stone: the statues stand in 3D niches, on the portals' jambs, trumeaux and
# archivolts, on the buttresses and in the gables; the windows have moulded surrounds, mullions and tracery in
# front of their glass; pinnacles carry crockets and finials. The small things go into a second mesh per part of
# the church that the game draws near only (the "near" objects).
#
# In 1873 (reference only, nothing copied: Wikipedia, the Flemish heritage inventory, period photographs): the
# west portal's tympanum was not yet the Last Judgement of 1903 (it had been painted until the 18th century), so
# here it is carved blind tracery with the Virgin in a medallion; the transepts were not yet re-gothicised (after
# 1875); the houses of the church fabric stood between the buttresses (those on the Handschoenmarkt came down
# between 1865 and 1875: here they still stand).

CATH2_MATS = ["cath_ashlar", "cath_slate", "cath_glass", "brickband", "cath_lead", "cath_atlas", "gilt",
              "cath_plinth", "cath_carved", "cath_oak", "cath_iron", "cath_tymp",
              "hs_brick", "hs_plaster", "hs_render", "hs_brick_old", "hs_trim", "hs_shutter", "hs_slate", "hs_pantile", "hs_glass",
              "hs_door", "cath_atlas_lit"]
PLINTH, CARVED, OAK, IRON, TYMP, HBRICK, HPLASTER, HRENDER, HBRICKOLD, HTRIM, HSHUT, HSLATE, HPANTILE, HGLASS, HDOOR = range(7, 22)
# Issue #10 (interiors are real, docs/building-with-interior.md): the windows over the hall inside (the nave's and the
# choir's clerestory, the outer aisles, the transept, the apse, the west window, the crossing tower's lantern) are cut
# through the wall with a reveal; their stone (surround, hood, sill, the tracery set back in the reveal) stays here, their
# glass is the hall's (world/cathedralHall.ts). The old painted pane (its atlas cell) goes to a mesh of its own,
# "landmark_cathedral_lit_glass" in cath_atlas_lit: the game never draws it, the hall takes its glass from it and
# world/landmarkWindows.ts lights a copy of it at night. Each opening is written twice: an empty "opening_<id>" in
# cathedral.glb and a row of shared/cathedralShell.ts (the world's frame).
ATLAS_LIT = 22
CATH_SHELL_TS = os.path.join(ROOT, "shared", "cathedralShell.ts")
CATH_OPENINGS = []
# metres a texture repeat on the box-projected faces, per material slot (the pictures' own scale)
CATH_TILE = {STONE: 3.2, SLATE: 2.4, GLASS: 1.0, BRICK: 3.0, LEAD: 1.2, PLINTH: 3.0, CARVED: 1.6, IRON: 1.0,
             HBRICK: 1.9, HPLASTER: 3.0, HRENDER: 3.0, HBRICKOLD: 1.1, HTRIM: 1.5, HSHUT: 1.2, HSLATE: 2.0, HPANTILE: 2.0,
             HGLASS: 1.0, HDOOR: 1.4}
CATH_OUT = os.path.join(ROOT, "client", "public", "models", "cathedral.glb")
FIG = [(0.17, 0.0), (0.155, 0.1), (0.128, 0.56), (0.155, 0.77), (0.09, 0.82), (0.058, 0.845), (0.075, 0.91), (0.045, 0.985), (0.0, 1.0)]
FIG_S = [(0.16, 0.0), (0.13, 0.45), (0.145, 0.74), (0.09, 0.8), (0.07, 0.86), (0.072, 0.94), (0.0, 1.0)]
COUNT = {}
HEXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def _add(a, b, k=1.0):
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _len(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _unit(a):
    n = _len(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _mean(P):
    n = len(P)
    return (sum(p[0] for p in P) / n, sum(p[1] for p in P) / n, sum(p[2] for p in P) / n)


def _parc(s0, s1, ys, rise, n=6, grow=0.0):
    """A two-centred pointed arch from the left springing (s0, ys) over the apex to the right one (s1, ys), as
    (s, y); `grow` > 0 gives the concentric arch that far outside it (a moulding round it)."""
    hw = (s1 - s0) / 2
    sc = (s0 + s1) / 2
    rise = max(rise, hw * 0.35)
    R = (hw * hw + rise * rise) / (2 * hw)
    Rg = R + grow
    cl = s0 + R  # the left arc's centre
    a_top = math.acos(max(-1.0, min(1.0, (sc - cl) / Rg)))
    left = [(cl + Rg * math.cos(math.pi + (a_top - math.pi) * i / n), ys + Rg * math.sin(math.pi + (a_top - math.pi) * i / n)) for i in range(n + 1)]
    left[-1] = (sc, left[-1][1])
    return left + [(2 * sc - s, y) for s, y in reversed(left[:-1])]


class CathMesh(CMesh):
    """The cathedral's own mesh: the Codex stone on the walls, carved stone on everything cut, the houses against the
    church. `d` is a second mesh for the small things (statues, crockets, finials, glazing bars) that the game draws
    near only; tint is a colour multiplier on the vertex shade (the paint of a house)."""

    mats = CATH2_MATS

    def __init__(self, frame, detail=False):
        super().__init__(frame)
        self.d = CathMesh(frame) if detail else self
        self.tint = (1.0, 1.0, 1.0)
        self.furnish = True
        self._rep = 0
        # (the houses' check, 2026-09-26: every solid of stone as a box in the plan (u0, u1, v0, v1, y0, y1); the
        # parts of the houses as (house, kind, box); both meshes share them)
        self.solids = []
        self.parts = []
        self.house = None
        if detail:
            self.d.solids = self.solids
            self.d.parts = self.parts

    def reg(self, us, vs, y0, y1):
        """Note a solid of stone by its extent (not while a house is built)."""
        if self.house is None:
            self.solids.append((min(us), max(us), min(vs), max(vs), min(y0, y1), max(y0, y1)))

    def set_house(self, idx):
        self.house = idx
        self.d.house = idx

    def prism(self, ring, y0, y1, mat, top=True, top_mat=None, shade=1.0):
        self.reg([q[0] for q in ring], [q[1] for q in ring], y0, y1)
        return super().prism(ring, y0, y1, mat, top, top_mat, shade)

    def pyramid(self, ring, y0, apex_y, mat, shade=1.0):
        self.reg([q[0] for q in ring], [q[1] for q in ring], y0, apex_y)
        return super().pyramid(ring, y0, apex_y, mat, shade)

    # ---------------------------------------------------------------- basics
    def poly(self, pts, mat, shade=1.0):
        f = Mesh.poly(self, pts, mat, shade)
        if f is not None and self.tint != (1.0, 1.0, 1.0):
            for loop in f.loops:
                loop[self.col] = (shade * self.tint[0], shade * self.tint[1], shade * self.tint[2], 1.0)
        return f

    def set_tint(self, rgb):
        self.tint = rgb
        self.d.tint = rgb

    def face(self, pts, mat, shade=1.0, out=None, centre=None):
        f = self.poly(pts, mat, shade)
        if f is None:
            return None
        if out is None:
            out = _sub(_mean(pts), centre)
        self.orient(f, out)
        return f

    def hexa(self, P, mat, shade=1.0, skip=()):
        """A six-faced solid from 8 corners: 0-3 one ring, 4-7 the other in the same order."""
        c = _mean(P)
        self.reg([q[0] for q in P], [q[1] for q in P], min(q[2] for q in P), max(q[2] for q in P))
        for k, idx in enumerate(HEXF):
            if k not in skip:
                self.face([P[i] for i in idx], mat, shade, centre=c)

    def bar(self, a, b, w, h=None, mat=CARVED, shade=1.0, up=(0.0, 0.0, 1.0), skip=()):
        """A square bar from a to b (local u, v, y), w across and h the other way."""
        h = w if h is None else h
        t = _unit(_sub(b, a))
        s = _cross(t, up)
        if _len(s) < 1e-4:
            s = _cross(t, (1.0, 0.0, 0.0))
        s = _unit(s)
        n = _unit(_cross(s, t))
        P = []
        for base in (a, b):
            for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P.append(_add(_add(base, s, i * w / 2), n, j * h / 2))
        self.hexa(P, mat, shade, skip)

    def lathe(self, c, prof, sides, mat=CARVED, rot=0.0, shade=1.0, caps=True):
        """A turned solid about the vertical through c = (u, v, y): prof [(r, dy)] from the bottom up."""
        rings = [[(c[0] + r * math.cos(rot + 2 * math.pi * i / sides), c[1] + r * math.sin(rot + 2 * math.pi * i / sides), c[2] + y)
                  for i in range(sides)] for r, y in prof]
        rmax = max(r for r, _ in prof)
        self.reg([c[0] - rmax, c[0] + rmax], [c[1] - rmax, c[1] + rmax], c[2] + min(y for _, y in prof), c[2] + max(y for _, y in prof))
        for k in range(len(prof) - 1):
            (r0, y0), (r1, y1) = prof[k], prof[k + 1]
            if r0 < 1e-6 and r1 < 1e-6:
                continue
            A, Bq = rings[k], rings[k + 1]
            for i in range(sides):
                j = (i + 1) % sides
                am = rot + 2 * math.pi * (i + 0.5) / sides
                out = (math.cos(am) * (y1 - y0), math.sin(am) * (y1 - y0), -(r1 - r0))
                if abs(out[0]) + abs(out[1]) + abs(out[2]) < 1e-9:
                    out = (math.cos(am), math.sin(am), 0.0)
                if r0 < 1e-6:
                    pts = [A[i], Bq[j], Bq[i]]
                elif r1 < 1e-6:
                    pts = [A[i], A[j], Bq[i]]
                else:
                    pts = [A[i], A[j], Bq[j], Bq[i]]
                self.face(pts, mat, shade, out=out)
        if caps and prof[0][0] > 1e-6:
            self.face(rings[0], mat, shade * 0.8, out=(0, 0, -1))
        if caps and prof[-1][0] > 1e-6:
            self.face(rings[-1], mat, shade, out=(0, 0, 1))

    def finial(self, u, v, y, h, mat=CARVED):
        """A cross-shaped finial (a fleuron): four leaves round a knob, a point."""
        self.lathe((u, v, y), [(0.07 * h, 0), (0.24 * h, 0.4 * h), (0.06 * h, 0.6 * h), (0.0, h)], 4, mat, caps=False)

    def crockets(self, a, b, n, out, size, mat=CARVED):
        """n crockets along a to b (local 3D), curling out (a local direction) and up."""
        o = _unit(out)
        for k in range(1, n + 1):
            q = _add(a, _sub(b, a), k / (n + 1))
            tip = _add(_add(q, o, size * 0.6), (0, 0, 1), size * 0.7)
            self.leaf(q, tip, size * 0.26, mat)

    def leaf(self, a, tip, r, mat=CARVED, shade=1.0):
        """A three-sided point from a (its base's middle) to tip: a crocket's leaf."""
        t = _unit(_sub(tip, a))
        s = _cross(t, (0.0, 0.0, 1.0))
        if _len(s) < 1e-4:
            s = (1.0, 0.0, 0.0)
        s = _unit(s)
        n = _unit(_cross(s, t))
        base = [_add(_add(a, s, r * math.cos(2 * math.pi * k / 3)), n, r * math.sin(2 * math.pi * k / 3)) for k in range(3)]
        c = _mean(base + [tip])
        for k in range(3):
            self.face([base[k], base[(k + 1) % 3], tip], mat, shade, centre=c)
        self.face(base, mat, shade * 0.8, centre=c)

    def ring(self, p, d, o, cs, cy, rs, ry, e0, e1, bw, mat=CARVED, shade=1.0, seg=12):
        """A ring of tracery on a wall (an ellipse rs x ry round (cs, cy)), bw wide, from e0 to e1 out."""
        pts = [(math.cos(2 * math.pi * k / seg), math.sin(2 * math.pi * k / seg)) for k in range(seg)]
        inn = [_wpt(p, d, o, cs + c * (rs - bw / 2), e1, cy + sn * (ry - bw / 2)) for c, sn in pts]
        out = [_wpt(p, d, o, cs + c * (rs + bw / 2), e1, cy + sn * (ry + bw / 2)) for c, sn in pts]
        inn0 = [_wpt(p, d, o, cs + c * (rs - bw / 2), e0, cy + sn * (ry - bw / 2)) for c, sn in pts]
        out0 = [_wpt(p, d, o, cs + c * (rs + bw / 2), e0, cy + sn * (ry + bw / 2)) for c, sn in pts]
        for k in range(seg):
            j = (k + 1) % seg
            c, sn = math.cos(2 * math.pi * (k + 0.5) / seg), math.sin(2 * math.pi * (k + 0.5) / seg)
            rad = (d[0] * c, d[1] * c, sn)
            self.face([inn[k], inn[j], out[j], out[k]], mat, shade, out=(o[0], o[1], 0))
            self.face([inn0[k], inn0[j], inn[j], inn[k]], mat, shade * 0.75, out=(-rad[0], -rad[1], -rad[2]))
            self.face([out0[k], out0[j], out[j], out[k]], mat, shade * 0.9, out=rad)

    # ---------------------------------------------------------------- figures
    def figure(self, u, v, y, h, face, kind="saint", mat=CARVED, shade=1.0, arm=1, small=False):
        """A standing figure turned toward `face` (du, dv): a robe, the head, an arm bent to hold a book (a key, a
        staff); the Virgin crowned with the Child, a bishop with mitre and crozier, a king with a sceptre, an angel
        with wings."""
        m = self.d
        COUNT["figure" + ("_s" if small else "")] = COUNT.get("figure" + ("_s" if small else ""), 0) + 1
        if small:
            m.lathe((u, v, y), [(r * h, yy * h) for r, yy in FIG], 6, mat, rot=math.pi / 6, shade=shade)
            return
        m.lathe((u, v, y), [(r * h, yy * h) for r, yy in FIG], 6, mat, rot=math.pi / 6, shade=shade)
        fl = math.hypot(face[0], face[1]) or 1.0
        fu, fv = face[0] / fl, face[1] / fl
        su, sv = -fv * arm, fu * arm

        def P(a, b, c):
            return (u + su * a * h + fu * b * h, v + sv * a * h + fv * b * h, y + c * h)
        m.bar(P(0.13, 0.0, 0.76), P(0.12, 0.1, 0.6), 0.05 * h, mat=mat, shade=shade)
        m.bar(P(0.12, 0.1, 0.6), P(0.03, 0.17, 0.66), 0.045 * h, mat=mat, shade=shade)
        m.bar(P(-0.12, 0.02, 0.76), P(-0.1, 0.06, 0.45), 0.05 * h, mat=mat, shade=shade * 0.95)
        if kind in ("saint", "apostle"):
            m.bar(P(0.0, 0.19, 0.6), P(0.0, 0.19, 0.72), 0.1 * h, 0.035 * h, mat=mat, shade=shade * 1.05)
        if kind in ("apostle", "bishop"):
            top = 1.04 if kind == "apostle" else 1.12
            m.bar(P(-0.17, 0.08, 0.0), P(-0.17, 0.08, top), 0.024 * h, mat=mat, shade=shade)
            if kind == "bishop":
                m.bar(P(-0.17, 0.08, top), P(-0.1, 0.1, top + 0.06), 0.024 * h, mat=mat, shade=shade)
                m.lathe(P(0, 0, 0.955), [(0.05 * h, 0), (0.045 * h, 0.08 * h), (0.0, 0.15 * h)], 4, mat, rot=math.atan2(fv, fu), shade=shade)
        if kind in ("virgin", "king"):
            m.lathe(P(0, 0, 0.965), [(0.055 * h, 0), (0.065 * h, 0.07 * h), (0.045 * h, 0.07 * h)], 6, mat, shade=shade * 1.05, caps=False)
        if kind == "virgin":
            m.lathe(P(0.07, 0.14, 0.55), [(0.05 * h, 0), (0.06 * h, 0.14 * h), (0.035 * h, 0.2 * h), (0.0, 0.25 * h)], 6, mat, shade=shade * 1.05)
        if kind == "king":
            m.bar(P(0.03, 0.17, 0.62), P(0.03, 0.22, 0.95), 0.022 * h, mat=mat, shade=shade)
        if kind == "angel":
            for sg in (-1, 1):
                m.bar(P(sg * 0.06, -0.08, 0.8), P(sg * 0.26, -0.18, 0.42), 0.02 * h, 0.2 * h, mat=mat, shade=shade * 0.95)

    def canopy(self, u, v, y, w, mat=CARVED, rot=0.0):
        """A small hexagonal canopy over a statue, a spirelet on it."""
        m = self.d
        m.lathe((u, v, y), [(w * 0.5, 0.0), (w * 0.62, w * 0.28), (w * 0.55, w * 0.38)], 6, mat, rot=rot)
        m.lathe((u, v, y + w * 0.38), [(w * 0.45, 0.0), (w * 0.16, w * 0.42), (0.0, w * 0.62)], 6, mat, rot=rot)

    # ---------------------------------------------------------------- pinnacles and flyers, richer
    def gable_roof(self, u0, u1, v0, v1, y, rise, along="u", mat=SLATE, gable_mat=STONE, over=0.4, skip_gable=()):
        """As Mesh.gable_roof; skip_gable: the gable walls (0 the first end, 1 the other) left out where they stand
        inside another roof (they lay back to back with its own)."""
        if along != "u" or not skip_gable:
            return super().gable_roof(u0, u1, v0, v1, y, rise, along, mat, gable_mat, over)
        vm = (v0 + v1) / 2
        for vs, vo in ((v0 - over, -1), (v1 + over, 1)):
            f = self.poly([(u0, vs, y - over * rise / ((v1 - v0) / 2)), (u1, vs, y - over * rise / ((v1 - v0) / 2)), (u1, vm, y + rise), (u0, vm, y + rise)], mat)
            self.orient(f, (0, vo, 1))
        for k, (ue, uo) in enumerate(((u0, -1), (u1, 1))):
            if k not in skip_gable:
                f = self.poly([(ue, v0, y), (ue, v1, y), (ue, vm, y + rise)], gable_mat)
                self.orient(f, (uo, 0, 0))

    def pinnacle(self, u, v, y0, h, r=0.5, mat=STONE):
        COUNT["pinnacle"] = COUNT.get("pinnacle", 0) + 1
        """A pinnacle: a square shaft, gablets on its faces, a moulded cap, the spire with crockets, a finial."""
        ring = self.ngon(u, v, r, 4, math.pi / 4)
        ys = y0 + h * 0.4
        self.prism(ring, y0, ys, CARVED, top=False)
        self.prism(self.ngon(u, v, r * 1.16, 4, math.pi / 4), ys, ys + h * 0.045, CARVED, top=True)
        yb = ys + h * 0.045
        apex = y0 + h * 0.9
        self.pyramid(self.ngon(u, v, r * 0.98, 4, math.pi / 4), yb, apex, CARVED)
        if h >= 2.2:
            # gablets on the shaft's four faces
            for i in range(4):
                a, b = ring[i], ring[(i + 1) % 4]
                mu, mv = (a[0] + b[0]) / 2 - u, (a[1] + b[1]) / 2 - v
                ln = math.hypot(mu, mv) or 1
                ou, ov = mu / ln * r * 0.05, mv / ln * r * 0.05  # (inside the cap's faces, r * 1.16: never in their plane)
                self.face([(a[0] + ou, a[1] + ov, ys - h * 0.1), (b[0] + ou, b[1] + ov, ys - h * 0.1),
                           ((a[0] + b[0]) / 2 + ou, (a[1] + b[1]) / 2 + ov, ys + h * 0.16)], CARVED, 1.05, out=(mu, mv, 0))
            if h >= 3.0:
                n = max(2, min(3, int(h / 2.0)))
                for i in range(4):
                    cu_, cv_ = ring[i]
                    self.d.crockets((cu_, cv_, yb), (u, v, apex), n, (cu_ - u, cv_ - v, 0), min(0.45, h * 0.07))
        self.d.finial(u, v, apex - 0.05, max(0.4, h * 0.16))

    def flyer(self, a, b, w=0.45, t=0.8):
        super().flyer(a, b, w, t)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(2, int(L / 1.6))
        self.d.crockets((a[0], a[1], a[2] + 0.05), (b[0], b[1], b[2] + 0.05), n, (0, 0, 1), 0.36)

    def tex_prism(self, ring, y0, y1, cell, ring_top=None, shade=1.0, skip=(), rep=1):
        if rep > 1:
            rt = ring_top or ring
            for k in range(rep):
                ra = [_lerp2(a, b, k / rep) for a, b in zip(ring, rt)]
                rb = [_lerp2(a, b, (k + 1) / rep) for a, b in zip(ring, rt)]
                self._rep = k
                self.tex_prism(ra, y0 + (y1 - y0) * k / rep, y0 + (y1 - y0) * (k + 1) / rep, cell, rb, shade, skip)
            self._rep = 0
            return
        self.reg([q[0] for q in ring], [q[1] for q in ring], y0, y1)
        super().tex_prism(ring, y0, y1, cell, ring_top, shade, skip)

    # ---------------------------------------------------------------- the atlas' painted stone, now stone
    def tex(self, pts, cell, shape=RECT, shade=1.0, out=None):
        if self.furnish and cell in ("tower_lancets", "tower_blind", "buttress", "openwork", "gable"):
            f = self.poly(pts, STONE, shade)
            if f is None:
                return None
            if out is not None:
                self.orient(f, out)
            if cell == "gable" and len(pts) == 3:
                _gable_trim(self, pts, out)
            elif len(shape) == 4 and len(pts) == 4 and out is not None:
                _furnish(self, pts, cell, out, shade)
            return f
        if cell == "tympanum":
            return self.upoly(pts, [(x, t) for x, t in shape], TYMP, shade, out)
        return super().tex(pts, cell, shape, shade, out)

    def decal(self, p, d, o, s0, s1, y0, y1, cell, shape=RECT, off=0.06, shade=1.0):
        if self.furnish and cell == "niche":
            _niche3d(self, p, d, o, (s0 + s1) / 2, y0 + 0.3, (y1 - y0) * 0.95, kind="saint")
            return None
        f = super().decal(p, d, o, s0, s1, y0, y1, cell, shape, off, shade)
        if self.furnish and cell in WIN3D:
            _win3d(self, p, d, o, s0, s1, y0, y1, **WIN3D[cell])
        return f

    def subdecal(self, p, d, o, s0, s1, y0, y1, cell, box, shape=RECT, off=0.04, shade=1.0):
        """Part of an atlas cell (box: x, y, w, h in the cell's pixels, y down) on a wall."""
        cx, cy, _, _ = CELL[cell]
        bx, by, bw, bh = box
        pts, uvs = [], []
        for x, t in shape:
            s = s0 + (s1 - s0) * x
            pts.append((p[0] + d[0] * s + o[0] * off, p[1] + d[1] * s + o[1] * off, y0 + (y1 - y0) * t))
            uvs.append(((cx + bx + 0.5 + x * (bw - 1)) / AT, 1 - (cy + by + 0.5 + (1 - t) * (bh - 1)) / ATH))
        return self.upoly(pts, uvs, ATLAS, shade, (o[0], o[1], 0))

    # ---------------------------------------------------------------- out
    def to_object(self, name, split=0.0):
        """The mesh as one object, or with split > 0 as one object per split x split m square of the plan
        (`name`_near_<i>: the game draws each near only)."""
        c = self.f.w(0, 0, 0)
        ox, oy = round(c[0]), round(-c[2])
        for f in self.bm.faces:
            for loop in f.loops:
                col = loop[self.col]
                k = 0.8 + 0.2 * min(1.0, max(0.0, loop.vert.co.z / 30.0))
                loop[self.col] = (col[0] * k, col[1] * k, col[2] * k, 1.0)
            if f in self.fixed:
                continue
            tile = CATH_TILE.get(f.material_index, 3.0)
            f.normal_update()
            n = f.normal
            if abs(n.z) > 0.7:
                for loop in f.loops:
                    loop[self.uvl].uv = ((loop.vert.co.x - ox) / tile, (loop.vert.co.y - oy) / tile)
            else:
                tx, ty = -n.y, n.x
                ln = math.hypot(tx, ty) or 1
                tx, ty = tx / ln, ty / ln
                for loop in f.loops:
                    co = loop.vert.co
                    loop[self.uvl].uv = (((co.x - ox) * tx + (co.y - oy) * ty) / tile, co.z / tile)
        self.tris = sum(len(f.verts) - 2 for f in self.bm.faces)
        by = {}
        for f in self.bm.faces:
            by[self.mats[f.material_index]] = by.get(self.mats[f.material_index], 0) + len(f.verts) - 2
        print(f"[build_landmarks] {name} by material: {sorted(by.items(), key=lambda kv: -kv[1])}")
        groups = {}
        self.bm.faces.index_update()
        if split > 0:
            for f in self.bm.faces:
                cc = f.calc_center_median()
                groups.setdefault((math.floor(cc.x / split), math.floor(cc.y / split)), []).append(f.index)
        obs = []
        items = sorted(groups.items()) if split > 0 else [(None, None)]
        for gi, (key, idx) in enumerate(items):
            bm = self.bm
            if idx is not None:
                bm = self.bm.copy()
                bm.faces.ensure_lookup_table()
                keep = set(idx)
                bmesh.ops.delete(bm, geom=[f for i, f in enumerate(bm.faces) if i not in keep], context="FACES")
            me = bpy.data.meshes.new(name if idx is None else f"{name}_{gi}")
            bm.to_mesh(me)
            if idx is not None:
                bm.free()
            for mname in self.mats:
                me.materials.append(bpy.data.materials[mname])
            ob = bpy.data.objects.new(me.name, me)
            bpy.context.scene.collection.objects.link(ob)
            use_shading(ob)
            obs.append(ob)
        self.bm.free()
        print(f"[build_landmarks] {name}: {self.tris} triangles in {len(obs)} object(s)")
        for dn, dx, dz in self.doors:
            print(f"[build_landmarks]   door {dn}: world x {dx}, z {dz}")
        return obs


# the windows painted in the atlas, their stone in front of the glass (the numbers of paint_atlas's window())
WIN3D = {"great_window": dict(tsp=0.66, lights=6, frame=5, transom=0.62, rings=2, cw=128, ch=256),
         "lancet": dict(tsp=0.72, lights=2, frame=3, transom=None, rings=1, cw=64, ch=128)}


def _wb(m, p, d, o, s0, s1, e0, e1, y0, y1, mat=STONE, shade=1.0, top=True):
    """A box standing against a wall (as _wbox) without its face on the wall (it would lie back to back with it)."""
    Q = lambda s, e, y: _wpt(p, d, o, s, e, y)  # noqa: E731
    P = [Q(s0, e0, y0), Q(s1, e0, y0), Q(s1, e1, y0), Q(s0, e1, y0), Q(s0, e0, y1), Q(s1, e0, y1), Q(s1, e1, y1), Q(s0, e1, y1)]
    m.hexa(P, mat, shade, skip=(2,) if top else (1, 2))


def _curve_band(m, p, d, o, curve, bw, e0, e1, mat=CARVED, shade=1.0, inset=0.0, caps=True, outer=None):
    """A moulding along a line on a wall (curve: (s, y) points, walked so that the outside is on the left, as up a
    left jamb, over an arch and down the right one): bw wide, from e0 to e1 out of the wall, `inset` outside the line."""
    n = len(curve)
    nrm = []
    for i in range(n):
        a = curve[max(0, i - 1)]
        b = curve[min(n - 1, i + 1)]
        ts, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(ts, ty) or 1.0
        ns, ny = -ty / ln, ts / ln
        # a mitre at a corner: keep the band's width across both of its lines
        if 0 < i < n - 1:
            a2, b2 = curve[i - 1], curve[i]
            l1 = math.hypot(b2[0] - a2[0], b2[1] - a2[1]) or 1.0
            n1 = (-(b2[1] - a2[1]) / l1, (b2[0] - a2[0]) / l1)
            cosang = max(0.35, ns * n1[0] + ny * n1[1])
            ns, ny = ns / cosang, ny / cosang
        nrm.append((ns, ny))
    inner = [(q[0] + nn[0] * inset, q[1] + nn[1] * inset) for q, nn in zip(curve, nrm)]
    outer = [(q[0] + nn[0] * (inset + bw), q[1] + nn[1] * (inset + bw)) for q, nn in zip(curve, nrm)]

    def P(q, e):
        return _wpt(p, d, o, q[0], e, q[1])
    for i in range(n - 1):
        ns, ny = (nrm[i][0] + nrm[i + 1][0]) / 2, (nrm[i][1] + nrm[i + 1][1]) / 2
        side = (d[0] * ns, d[1] * ns, ny)
        m.face([P(inner[i], e1), P(inner[i + 1], e1), P(outer[i + 1], e1), P(outer[i], e1)], mat, shade, out=(o[0], o[1], 0))
        m.face([P(inner[i], e0), P(inner[i + 1], e0), P(inner[i + 1], e1), P(inner[i], e1)], mat, shade * 0.72, out=(-side[0], -side[1], -side[2]))
        if outer is None and bw > 0.17 or outer:
            m.face([P(outer[i], e0), P(outer[i + 1], e0), P(outer[i + 1], e1), P(outer[i], e1)], mat, shade * 0.9, out=side)
    if caps:
        for i, j in ((0, 1), (n - 1, n - 2)):
            ts, ty = curve[i][0] - curve[j][0], curve[i][1] - curve[j][1]
            m.face([P(inner[i], e0), P(outer[i], e0), P(outer[i], e1), P(inner[i], e1)], mat, shade * 0.8,
                   out=(d[0] * ts, d[1] * ts, ty))


def _arch_curve(s0, s1, y0, y1, tsp, n=5):
    """The outline of an atlas window (arch_shape in its box): up the left jamb, over the arch, down the right."""
    W, H = s1 - s0, y1 - y0
    ysp = y0 + tsp * H
    return [(s0, y0), (s0, ysp)] + [(s0 + W * x, y0 + H * arch_t(x, tsp)) for x in (k / (2 * n) for k in range(1, 2 * n))] + [(s1, ysp), (s1, y0)]


def _win3d(m, p, d, o, s0, s1, y0, y1, tsp, lights, frame, transom, rings, cw, ch, back=0.0, clip=None):
    COUNT["window"] = COUNT.get("window", 0) + 1
    """The stone of a painted window: a moulded surround, a hood with label stops, a sill; in front of the glass the
    mullions, the transom and the tracery's rings where the picture has them. back (issue #10, a real window): the
    mullions, the transom and the rings stand that much further in, in the reveal just before the glass; below `clip`
    (the part a house hides, still painted) they stay where they were."""
    def ee(e, y):
        return e - (back if clip is None or y > clip else 0.0)
    W, H = s1 - s0, y1 - y0
    D = m.d

    def X(px):
        return s0 + px / cw * W

    def Y(py):
        return y1 - py / ch * H
    ysp = y0 + tsp * H
    bw = max(0.16, min(0.42, W * 0.065))
    curve = _arch_curve(s0, s1, y0, y1, tsp)
    _curve_band(m, p, d, o, curve, bw, 0.0, bw * 0.85, CARVED, 0.95, caps=False)
    arch = [q for q in curve if q[1] >= ysp - 1e-6]
    _curve_band(m, p, d, o, arch, bw * 0.45, bw * 0.5, bw * 1.25, CARVED, 1.0, inset=bw * 1.05)
    for sg, q in ((-1, arch[0]), (1, arch[-1])):
        s = q[0] + sg * (bw * 1.3)
        _wb(m, p, d, o, s - bw * 0.35, s + bw * 0.35, 0.0, bw * 1.3, ysp - bw * 1.4, ysp, CARVED, 0.95)
    _wb(m, p, d, o, s0 - bw, s1 + bw, 0.0, bw * 1.2, y0 - 0.24, y0 + 0.02, CARVED, 0.9)
    iw = cw - 2 * frame
    lw = iw / lights
    spring_px = ch * (1 - tsp)
    ytop = Y(spring_px - lw * 0.3)
    mw = max(0.08, W / cw * 2.2)
    for i in range(1, lights):
        x = X(frame + i * lw)
        # (a real window hidden below `clip` by a house: the mullion in two, the painted part's and the real part's)
        cuts = [y0, ytop] if clip is None or not (y0 < clip < ytop) else [y0, clip, ytop]
        for ya, yb in zip(cuts, cuts[1:]):
            e = ee(0.12, (ya + yb) / 2)
            D.bar(_wpt(p, d, o, x, e, ya), _wpt(p, d, o, x, e, yb), mw, 0.18, CARVED, 0.95)
    if transom:
        yt = Y(ch * transom)
        D.bar(_wpt(p, d, o, X(frame), ee(0.13, yt), yt), _wpt(p, d, o, X(cw - frame), ee(0.13, yt), yt), 0.16, mw, CARVED, 0.95)
    if rings:
        r = min(iw * 0.26, spring_px * 0.42) - 0.8
        circ = [((cw / 2, spring_px * 0.55), r)]
        if rings > 1:
            r2 = r * 0.55 / 1.0
            circ += [((cw / 2 - iw * 0.26, spring_px * 0.88), r2), ((cw / 2 + iw * 0.26, spring_px * 0.88), r2)]
        for (cxp, cyp), rp in circ:
            b = 0.17 - ee(0.17, Y(cyp) - rp / ch * H)
            D.ring(p, d, o, X(cxp), Y(cyp), rp / cw * W, rp / ch * H, 0.03 - b, 0.17 - b, mw * 0.9, CARVED, 0.95, seg=12)


# ------------------------------------------------------------------ real windows (issue #10)

def _clip_poly(poly, y, above=True):
    """The part of a polygon of (s, y) above (or below) the level y (one Sutherland-Hodgman edge), from its bottom left."""
    out = []
    n = len(poly)
    inside = (lambda q: q[1] >= y - 1e-9) if above else (lambda q: q[1] <= y + 1e-9)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if inside(a):
            out.append(a)
        if inside(a) != inside(b):
            t = (y - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * t, y))
    ded = []
    for q in out:
        if not ded or abs(q[0] - ded[-1][0]) + abs(q[1] - ded[-1][1]) > 1e-6:
            ded.append(q)
    if len(ded) > 1 and abs(ded[0][0] - ded[-1][0]) + abs(ded[0][1] - ded[-1][1]) < 1e-6:
        ded.pop()
    k = min(range(len(ded)), key=lambda i: (round(ded[i][1], 4), ded[i][0])) if ded else 0
    return ded[k:] + ded[:k]


def _cut_wall(m, p, d, o, s0, s1, y0, y1, holes=(), foot=(), mat=STONE, shade=1.0, cell=None):
    """A wall face (s0..s1 along it, y0..y1) with openings cut through it: `holes` outlines of (s, y) inside the face,
    `foot` openings standing on its foot as _holed_wall's (sc, hw, h, tsp[, round]). Triangulated round the holes'
    exact outlines. With a cell the wall shows the atlas cell mapped by position (the lantern's faces)."""
    from mathutils import geometry as mg
    loop = [(s0, y0)]
    for hole in sorted(foot):
        sc, hw, h, tsp = hole[:4]
        loop += [(sc + s, y0 + y) for s, y in reversed(_arch_outline(hw, h, tsp, rnd=len(hole) > 4 and hole[4]))]
    loop += [(s1, y0), (s1, y1), (s0, y1)]
    rings = [loop] + [list(h) for h in holes]
    flat = [q for r in rings for q in r]
    tris = mg.tessellate_polygon([[Vector((q[0], q[1], 0.0)) for q in r] for r in rings])
    # (the check: the triangles cover the wall less its holes)
    area = lambda r: abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2  # noqa: E731
    want = area(loop) - sum(area(h) for h in holes)
    got = sum(area([flat[i] for i in t]) for t in tris)
    if abs(got - want) > 0.01 * max(1.0, want):
        print(f"[build_landmarks] cut wall at {m.f.w(*_wpt(p, d, o, (s0 + s1) / 2, 0, (y0 + y1) / 2))}: triangles {got:.2f} m2, want {want:.2f} m2")
    for tri in tris:
        q = [flat[i] for i in tri]
        pts = [_wpt(p, d, o, s, 0.0, y) for s, y in q]
        if cell:
            m.upoly(pts, [cell_uv(cell, (s - s0) / (s1 - s0), (y - y0) / (y1 - y0)) for s, y in q], ATLAS, shade, (o[0], o[1], 0))
        else:
            m.face(pts, mat, shade, out=(o[0], o[1], 0))


def _world_dir(fr, du, dv):
    """A direction of a landmark's frame (u, v) in the world (x, z)."""
    return (fr.ax[0] * du + fr.n[0] * dv, fr.ax[1] * du + fr.n[1] * dv)


def _record(m, p, d, o, sc, hole, depth, kind, label, glaze="lead", part="landmark_cathedral"):
    """A real opening of the cathedral's shell for cathedral_markers(): its middle on the wall's outer face, the way
    along the wall and out of it (world), its outline (u from its middle along the wall, world y), its reveal's depth."""
    x, _, z = m.f.w(*_wpt(p, d, o, sc, 0.0, 0.0))
    tx, tz = _world_dir(m.f, d[0], d[1])
    nx, nz = _world_dir(m.f, o[0], o[1])
    poly = [(s - sc, y) for s, y in hole]
    CATH_OPENINGS.append(dict(kind=kind, part=part, label=label, glaze=glaze, shape="rect", x=x, z=z, tx=tx, tz=tz, nx=nx, nz=nz,
                              hw=max(abs(q[0]) for q in poly), yb=min(q[1] for q in poly), yt=max(q[1] for q in poly), arch=False,
                              depth=depth, poly=poly))


def _win_reveal(m, p, d, o, hole, depth, shade=0.62):
    """The sides of a hole from the wall's face to `depth` in, each facing into the opening."""
    n = len(hole)
    cs = sum(q[0] for q in hole) / n
    cy = sum(q[1] for q in hole) / n
    for i in range(n):
        a, b = hole[i], hole[(i + 1) % n]
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) < 1e-5:
            continue
        ms, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        # (the edge's normal in the wall's plane, turned toward the opening's middle)
        ns, ny = -(b[1] - a[1]), b[0] - a[0]
        if ns * (cs - ms) + ny * (cy - my) < 0:
            ns, ny = -ns, -ny
        m.face([_wpt(p, d, o, a[0], 0.0, a[1]), _wpt(p, d, o, b[0], 0.0, b[1]), _wpt(p, d, o, b[0], -depth, b[1]), _wpt(p, d, o, a[0], -depth, a[1])],
               CARVED, shade, out=(d[0] * ns, d[1] * ns, ny))


def _real_win(m, p, d, o, s0, s1, y0, y1, cell, shape, label, depth=0.3, clip=None):
    """A window painted in the atlas made real (issue #10): its outline is cut through the wall (the caller cuts the
    wall with the returned outline) with a reveal `depth` deep; the old painted pane moves to the reveal's back in the lit
    mesh (the hall's glass and the night's glow come from it); the stone of _win3d stays, the tracery set back into the
    reveal. clip: a house against the church hides the window up to there; below it the window stays painted (the
    shell's pane as before), above it is real. Returns the hole's outline (s, y)."""
    W, H = s1 - s0, y1 - y0
    full = [(s0 + W * x, y0 + H * t) for x, t in shape]
    uv = lambda q: cell_uv(cell, (q[0] - s0) / W, (q[1] - y0) / H)  # noqa: E731
    hole = full if clip is None else _clip_poly(full, clip, above=True)
    if clip is not None:
        low = _clip_poly(full, clip, above=False)
        m.upoly([_wpt(p, d, o, s, 0.06, y) for s, y in low], [uv(q) for q in low], ATLAS, 1.0, (o[0], o[1], 0))
    m.lit.upoly([_wpt(p, d, o, s, -depth, y) for s, y in hole], [uv(q) for q in hole], ATLAS_LIT, 1.0, (o[0], o[1], 0))
    _win_reveal(m, p, d, o, hole, depth)
    if cell in WIN3D:
        _win3d(m, p, d, o, s0, s1, y0, y1, **WIN3D[cell], back=depth + 0.02, clip=clip)
    _record(m, p, d, o, (s0 + s1) / 2, hole, depth, "window", label)
    return hole


def _real_lantern(m, ring, y0, y1, names, depth=0.2):
    """The crossing tower's lantern (issue #10): each face of the octagon a "lancet" cell over the whole face, its glass
    (the cell's arch less its painted frame, 3 px of 64) cut through with a reveal, the painted frame round it kept."""
    cu, cv = _centre(ring)
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        mu, mv = (a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv
        o = (mu / math.hypot(mu, mv), mv / math.hypot(mu, mv))
        # the glass: the cell's pointed arch (tsp 0.72) shrunk by its frame (3 px of 64 across, of 128 up)
        sa, sb = L * 3 / 64, L * 61 / 64
        ya, yb = y0 + (y1 - y0) * 3 / 128, y1 - (y1 - y0) * 3 / 128
        hole = [(sa + (sb - sa) * x, ya + (yb - ya) * t) for x, t in arch_shape(0.73, 3)]
        m.lit.upoly([_wpt(a, d, o, s, -depth, y) for s, y in hole], [cell_uv("lancet", s / L, (y - y0) / (y1 - y0)) for s, y in hole],
                    ATLAS_LIT, 1.0, (o[0], o[1], 0))
        _win_reveal(m, a, d, o, hole, depth)
        _cut_wall(m, a, d, o, 0.0, L, y0, y1, [hole], cell="lancet")
        _record(m, a, d, o, (sa + sb) / 2, hole, depth, "window", f"the crossing tower's lantern, the {names[i]} face, window")


def cathedral_markers():
    """Every real opening of the cathedral (issue #10) as an empty in cathedral.glb (dev/interiorcheck.ts reads them) and
    as a row of shared/cathedralShell.ts. Returns the empties."""
    obs = []
    for i, o in enumerate(CATH_OPENINGS):
        o["id"] = f"ct_{i:03d}"
        ob = bpy.data.objects.new("opening_" + o["id"], None)
        ob.empty_display_size = max(0.2, o["hw"])
        ob.location = B(o["x"], (o["yb"] + o["yt"]) / 2, o["z"])
        for k in ("kind", "label", "glaze", "shape", "part"):
            ob[k] = str(o[k])
        for k in ("hw", "yb", "yt", "nx", "nz", "tx", "tz", "depth"):
            ob[k] = float(o[k])
        ob["arch"] = 0
        bpy.context.scene.collection.objects.link(ob)
        obs.append(ob)
    f3 = lambda v: f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) >= 5e-4 else "0"  # noqa: E731
    lines = [
        "// GENERATED by tools/blender/build_landmarks.py cathedral() (issue #10, interiors are real): do not edit. Every real",
        "// opening of the cathedral's shell (client/public/models/cathedral.glb, whose empties opening_<id> are the same), in",
        "// the WORLD's frame (world/cathedralHall.ts moves them into the hall's: shellOpening.ts inFrame). x, z: its middle on",
        "// the wall's outer face; (tx, tz) along it, (nx, nz) out of it; poly its outline where the reveal ends (u along from",
        "// the middle, world y); depth the reveal's depth into the wall.",
        "",
        'import type { ShellOpening } from "./shellOpening.js";',
        "",
        "export const SHELL_OPENINGS: ShellOpening[] = [",
    ]
    for o in CATH_OPENINGS:
        parts_ = []
        for k in ("id", "kind", "part", "label", "glaze", "shape", "x", "z", "tx", "tz", "nx", "nz", "hw", "yb", "yt", "arch", "depth"):
            v = o[k]
            parts_.append(f"{k}: {json.dumps(v) if isinstance(v, (str, bool)) else f3(float(v))}")
        parts_.append("poly: [" + ", ".join(f"[{f3(u)}, {f3(y)}]" for u, y in o["poly"]) + "]")
        lines.append("  { " + ", ".join(parts_) + " },")
    lines += ["];", ""]
    with open(CATH_SHELL_TS, "w", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"[build_landmarks] cathedral: {len(obs)} real openings -> {CATH_SHELL_TS}")
    return obs


def _niche3d(m, p, d, o, s, y0, h, kind="saint", statue=True, dep=None, arm=1):
    """A statue in a niche on a wall: the shadowed back, a pedestal on a corbel, two colonnettes, a gabled canopy
    with crockets, pinnacles and a finial; the statue (see figure)."""
    w = h * 0.4
    dep = dep if dep is not None else w * 0.85
    D = m.d
    yc = y0 + h * 0.74
    back = [(s - w / 2, y0 - 0.1 * h), (s - w / 2, yc)] + _parc(s - w / 2, s + w / 2, yc, h * 0.22, 3)[1:-1] + [(s + w / 2, yc), (s + w / 2, y0 - 0.1 * h)]
    m.face([_wpt(p, d, o, q[0], 0.03, q[1]) for q in back], CARVED, 0.34, out=(o[0], o[1], 0))
    _wb(m, p, d, o, s - w * 0.42, s + w * 0.42, 0.0, dep, y0 - 0.1 * h, y0, CARVED, 1.0)
    c = _wpt(p, d, o, s, dep * 0.5, y0 - 0.1 * h)
    rot = math.atan2(d[1], d[0]) + math.pi / 4
    m.lathe(c, [(0.0, -0.2 * h), (w * 0.42 * 1.41, 0.0)], 4, CARVED, rot=rot, shade=0.8, caps=False)
    for sg in (-1, 1):
        D.bar(_wpt(p, d, o, s + sg * w / 2, dep * 0.6, y0), _wpt(p, d, o, s + sg * w / 2, dep * 0.6, yc), 0.05 * h, mat=CARVED)
    # the canopy: a slab, the gablet on it, crockets, a finial, a pinnacle each side
    _wb(m, p, d, o, s - w / 2 - 0.03 * h, s + w / 2 + 0.03 * h, 0.0, dep, yc, yc + 0.06 * h, CARVED, 1.0)
    ga, gb, gt = s - w / 2 - 0.03 * h, s + w / 2 + 0.03 * h, yc + 0.06 * h
    apex = yc + 0.4 * h
    for e, sh in ((dep, 1.05),):
        m.face([_wpt(p, d, o, ga, e, gt), _wpt(p, d, o, gb, e, gt), _wpt(p, d, o, s, e, apex)], CARVED, sh, out=(o[0], o[1], 0))
    for sg, (sa, sb) in ((-1, (ga, s)), (1, (gb, s))):
        yy0 = gt
        m.face([_wpt(p, d, o, sa, 0.0, yy0), _wpt(p, d, o, sa, dep, yy0), _wpt(p, d, o, sb, dep, apex), _wpt(p, d, o, sb, 0.0, apex)],
               CARVED, 0.95, out=(d[0] * sg, d[1] * sg, 1.0))
        D.crockets(_wpt(p, d, o, sa, dep, yy0 + 0.02), _wpt(p, d, o, sb, dep, apex), 2, (d[0] * sg, d[1] * sg, 0), 0.07 * h)
        pu, pv, _ = _wpt(p, d, o, sa if sg < 0 else sb, dep * 0.5, 0)
        pc = _wpt(p, d, o, ga if sg < 0 else gb, dep * 0.5, 0)
        D.lathe((pc[0], pc[1], gt), [(0.035 * h, 0.0), (0.035 * h, 0.12 * h), (0.0, 0.3 * h)], 4, CARVED, rot=rot)
    ap = _wpt(p, d, o, s, dep * 0.9, apex - 0.02)
    D.finial(ap[0], ap[1], ap[2], 0.12 * h)
    if statue:
        c = _wpt(p, d, o, s, dep * 0.5, 0)
        m.figure(c[0], c[1], y0, h * 0.72, (o[0], o[1]), kind, arm=arm)


def _gable_trim(m, pts, out, t=0.3, statue=False):
    """The raking copings of a gable (pts: foot, foot, apex), crockets on them, a finial on the apex."""
    a, b, c = pts
    o = _unit((out[0], out[1], 0.0))
    off = (o[0] * t * 0.5, o[1] * t * 0.5, 0.0)
    for q in (a, b):
        m.bar(_add(q, off), _add(c, off), t, t * 0.9, CARVED, 1.0)
        L = _len(_sub(c, q))
        n = max(2, int(L / 1.1))
        sgv = _unit(_sub(q, c))
        m.d.crockets(_add(_add(q, off), (0, 0, t * 0.5)), _add(_add(c, off), (0, 0, t * 0.5)), n, (sgv[0], sgv[1], 0), max(0.25, t * 1.1))
    m.d.finial(c[0] + off[0], c[1] + off[1], c[2] + t * 0.3, max(0.8, t * 4))


def _furnish(m, pts, cell, out, shade):
    """The painted stone of a face of the atlas (a tower stage, a buttress, the octagon), built: the openings keep
    their painted louvres and glass; frames, gablets, colonnettes, niches with statues, string courses are 3D."""
    a0, b0, b1, a1 = pts
    L = math.hypot(b0[0] - a0[0], b0[1] - a0[1])
    if L < 0.3:
        return
    d = ((b0[0] - a0[0]) / L, (b0[1] - a0[1]) / L)
    ol = math.hypot(out[0], out[1]) or 1.0
    o = (out[0] / ol, out[1] / ol)
    p = (a0[0], a0[1])
    y0, y1 = a0[2], a1[2]
    H = y1 - y0
    _, _, cw, ch = CELL[cell]
    D = m.d

    def S(px):
        return px / cw * L

    def Y(py):
        return y1 - py / ch * H
    if cell == "tower_lancets":
        for x0 in (17, 69):
            s0, s1, yb, yt = S(x0), S(x0 + 42), Y(252), Y(30)
            m.subdecal(p, d, o, s0, s1, yb, yt, cell, (x0, 30, 42, 222), arch_shape(0.8, 3), off=0.03)
            _curve_band(m, p, d, o, _arch_curve(s0, s1, yb, yt, 0.8), 0.3, 0.0, 0.34, CARVED, shade * 0.95, caps=False)
            sc = (s0 + s1) / 2
            ysp = yb + 0.8 * (yt - yb)
            D.bar(_wpt(p, d, o, sc, 0.14, yb), _wpt(p, d, o, sc, 0.14, ysp + 0.3), 0.2, 0.22, CARVED)
            for tf in (0.4, 0.66):
                yy = yt - tf * (yt - yb)
                D.bar(_wpt(p, d, o, s0, 0.12, yy), _wpt(p, d, o, s1, 0.12, yy), 0.22, 0.2, CARVED)
            # the crocketed gablet over the lancet
            A = _wpt(p, d, o, S(x0 - 1), 0.4, Y(78))
            T = _wpt(p, d, o, S(x0 + 21), 0.4, Y(14))
            Bq = _wpt(p, d, o, S(x0 + 43), 0.4, Y(78))
            for q in (A, Bq):
                m.bar(q, T, 0.28, 0.3, CARVED, 1.02)
                sgv = _unit(_sub(q, T))
                D.crockets(_add(q, (0, 0, 0.15)), _add(T, (0, 0, 0.15)), 4, (sgv[0], sgv[1], 0), 0.42)
            D.finial(T[0], T[1], T[2] + 0.1, 1.3)
        # the shaft between the lancets, the blind panels at the sides
        D.bar(_wpt(p, d, o, S(64), 0.2, Y(252)), _wpt(p, d, o, S(64), 0.2, Y(12)), 0.3, 0.3, CARVED)
        for x0 in (3, 115):
            for yb_, yt_ in ((126, 14), (250, 130)):
                _curve_band(m, p, d, o, _arch_curve(S(x0), S(x0 + 10), Y(yb_), Y(yt_), 0.9, 4), 0.12, 0.0, 0.14, CARVED, shade * 0.9, caps=False)
        _wb(m, p, d, o, 0.0, L, 0.0, 0.32, Y(10), Y(5), CARVED, 1.0)
    elif cell == "tower_blind":
        if H < 5:
            return
        for k in range(4):
            for yb_, yt_ in ((66, 14), (124, 70)):
                s0, s1 = S(4 + k * 30), S(32 + k * 30)
                _curve_band(m, p, d, o, _arch_curve(s0, s1, Y(yb_), Y(yt_), 0.72, 5), 0.16, 0.0, 0.2, CARVED, shade * 0.92, caps=False)
                D.bar(_wpt(p, d, o, (s0 + s1) / 2, 0.08, Y(yb_)), _wpt(p, d, o, (s0 + s1) / 2, 0.08, Y(yt_) - (Y(yt_) - Y(yb_)) * 0.3), 0.1, 0.12, CARVED)
        _wb(m, p, d, o, 0.0, L, 0.0, 0.3, Y(10), Y(5), CARVED, 1.0)
    elif cell == "buttress":
        if H < 3.0 or L < 0.75:
            return
        # (a statue where the face looks away from the east and is wide enough; the lower of two repeats)
        big = L >= 0.95 and H >= 5.0
        # (the towers' buttresses: their faces to the square and to the streets, below the octagon, one of each two)
        facing = o[0] < -0.5 or (abs(o[1]) > 0.5 and o[1] * p[1] > 0 and (p[1] * o[1] > 16.0 or p[0] > 15.0))
        if big and facing and y0 < 60 and m._rep % 2 == 0:
            _niche3d(m, p, d, o, L / 2, Y(56) + 0.1, (Y(22) - Y(56)) * 1.05, kind=("apostle", "saint", "bishop", "king")[int(abs(p[0] * 7 + p[1] * 3)) % 4], dep=min(0.5, L * 0.35))
        else:
            _curve_band(m, p, d, o, _arch_curve(S(7), S(25), Y(56), Y(22), 0.7, 4), min(0.14, L * 0.08), 0.0, 0.12, CARVED, shade * 0.92, caps=False)
        _curve_band(m, p, d, o, _arch_curve(S(5), S(27), Y(124), Y(62), 0.85, 4), min(0.14, L * 0.08), 0.0, 0.12, CARVED, shade * 0.9, caps=False)
        _wb(m, p, d, o, 0.0, L, 0.0, 0.14, y0, y0 + 0.18, CARVED, 0.95)
    elif cell == "openwork":
        s0, s1, yb, yt = S(9), S(55), Y(126), Y(20)
        m.subdecal(p, d, o, s0, s1, yb, yt, cell, (9, 20, 46, 106), arch_shape(0.76, 3), off=0.03)
        if H < 5:
            return
        _curve_band(m, p, d, o, _arch_curve(s0, s1, yb, yt, 0.76), 0.22, 0.0, 0.26, CARVED, shade * 0.95, caps=False)
        D.bar(_wpt(p, d, o, (s0 + s1) / 2, 0.12, yb), _wpt(p, d, o, (s0 + s1) / 2, 0.12, yb + 0.76 * (yt - yb) + 0.2), 0.18, 0.2, CARVED)
        A, T, Bq = _wpt(p, d, o, S(6), 0.34, Y(50)), _wpt(p, d, o, S(32), 0.34, Y(4)), _wpt(p, d, o, S(57), 0.34, Y(50))
        for q in (A, Bq):
            m.bar(q, T, 0.24, 0.26, CARVED, 1.02)
            sgv = _unit(_sub(q, T))
            D.crockets(_add(q, (0, 0, 0.12)), _add(T, (0, 0, 0.12)), 3, (sgv[0], sgv[1], 0), 0.36)
        D.finial(T[0], T[1], T[2] + 0.1, 1.1)
        for x in (2.5, 61.5):
            m.bar(_wpt(p, d, o, S(x), 0.12, y0), _wpt(p, d, o, S(x), 0.12, y1), S(5), 0.24, CARVED, 0.95)


def _gable3d(m, p, d, o, s0, s1, y0, apex, statues=3, off=0.0):
    """A great gable's face: blind arcading of lancets rising with the slopes, niches with statues, the raking
    copings with crockets, a finial."""
    sc, hw = (s0 + s1) / 2, (s1 - s0) / 2
    rise = apex - y0

    def top_at(s):
        return y0 + rise * (1 - abs(s - sc) / hw)
    # the lancets of the arcade (clear of the niches in the middle)
    step = 1.25
    k = 0
    s = s0 + 0.9
    while s + 0.9 < s1:
        a, b = s, s + 0.9
        t = min(top_at(a), top_at(b)) - 0.7
        mid = (a + b) / 2
        if t - y0 > 2.2 and abs(mid - sc) > hw * 0.3 + 0.95:
            _curve_band(m, p, d, o, _arch_curve(a, b, y0 + 0.9, t, 0.8, 4), 0.12, off, off + 0.14, CARVED, 0.9, caps=False)
        s += step
        k += 1
    # the niches: a big one in the middle, two smaller beside it
    if statues:
        _niche3d(m, p, d, o, sc, y0 + 1.4, min(3.4, rise * 0.42), kind="virgin", dep=0.55)
        if statues > 1:
            for sg in (-1, 1):
                hh = min(2.6, rise * 0.3)
                _niche3d(m, p, d, o, sc + sg * hw * 0.3, y0 + 1.2, hh, kind="angel" if statues > 3 else "saint", dep=0.45, arm=sg)
    # the copings with crockets, and the finial
    o3 = (o[0], o[1], 0.0)
    _gable_trim(m, [_wpt(p, d, o, s0, off, y0), _wpt(p, d, o, s1, off, y0), _wpt(p, d, o, sc, off, apex)], o3, t=0.45)


def _cportal(m, p, d, o, sc, hw0, hw1, depth, h0, h1, tsp, lintel, bands=5, trumeau=False, steps=True, door=None, leaves=True,
             jamb=3, figures=True, virgin=True):
    """A splayed Gothic portal (as _portal: the same bands, the same opening), carved: statues on corbels under
    canopies on the jambs, statuettes on the archivolts, the carved tympanum (cath_tymp), a trumeau with the Virgin,
    oak leaves (the picture: iron straps, nails, rings; leaves=False: an opening, the game hangs its own leaves: world/cathedralInWorld.ts),
    bluestone steps."""
    def W(s, y, dep):
        return (p[0] + d[0] * s - o[0] * dep, p[1] + d[1] * s - o[1] * dep, y)
    D = m.d
    ysp = h0 * tsp
    rings = []
    for k in range(bands + 1):
        f = k / bands
        rings.append((depth * f, _arch_outline(hw0 + (hw1 - hw0) * f, h0 + (h1 - h0) * f, tsp)))
    if door and hasattr(m, "door"):
        m.door(door, W(sc, 0, depth))
    for k in range(bands):
        (da, A), (db, Bn) = rings[k], rings[k + 1]
        dm = (da + db) / 2
        for i in range(len(A) - 1):
            sm = (A[i][0] + A[i + 1][0]) / 2
            ym = (A[i][1] + A[i + 1][1]) / 2
            out = (o[0] + d[0] * (-sm) * 0.3, o[1] + d[1] * (-sm) * 0.3, (ysp - ym) * 0.3 if ym > ysp else 0)
            f = m.poly([W(sc + A[i][0], A[i][1], da), W(sc + A[i + 1][0], A[i + 1][1], da),
                        W(sc + Bn[i + 1][0], Bn[i + 1][1], dm), W(sc + Bn[i][0], Bn[i][1], dm)], CARVED, (0.95 if k % 2 == 0 else 0.72) * (1 - 0.45 * k / bands))
            m.orient(f, out)
            f = m.poly([W(sc + Bn[i][0], Bn[i][1], dm), W(sc + Bn[i + 1][0], Bn[i + 1][1], dm),
                        W(sc + Bn[i + 1][0], Bn[i + 1][1], db), W(sc + Bn[i][0], Bn[i][1], db)], CARVED, (0.55 if k % 2 == 0 else 0.42) * (1 - 0.45 * k / bands))
            m.orient(f, (-d[0] * sm - o[0] * 0.1, -d[1] * sm - o[1] * 0.1, (ysp - ym) if ym > ysp else 0))
        if not figures:
            continue
        # statuettes up the archivolt (on the arch, standing on little corbels, under little canopies)
        bw = (A[0][0] - Bn[0][0]) if A[0][0] > Bn[0][0] else 0.4
        hs = max(0.5, min(0.95, abs(bw) * 1.9))
        arch_idx = [i for i in range(1, len(A) - 1) if A[i][1] > (h0 + (h1 - h0) * da / max(depth, 1e-6)) * tsp + 0.3]
        for i in arch_idx:
            q = ((A[i][0] + Bn[i][0]) / 2, (A[i][1] + Bn[i][1]) / 2 - hs * 0.55)
            c = W(sc + q[0], q[1], (da + dm) / 2)
            D.figure(c[0], c[1], c[2], hs, (o[0], o[1]), small=True, shade=0.95 * (1 - 0.3 * k / bands))
            D.lathe((c[0], c[1], c[2] + hs * 1.02), [(hs * 0.2, 0.0), (hs * 0.26, hs * 0.1), (0.0, hs * 0.3)], 6, CARVED, shade=0.9)
        # a statue on each jamb of the outer bands, on a corbel above a man's head, under a canopy
        if k < jamb:
            hs = 1.85 if hw0 > 3.0 else 1.55
            for sg in (-1, 1):
                sj = sc + sg * abs((A[0][0] + Bn[0][0]) / 2) - sg * 0.3
                c = W(sj, 0, (da + dm) / 2 + 0.05)
                yb = 2.25 + (0.0 if hw0 > 3.0 else -0.15)
                D.lathe((c[0], c[1], yb - 0.4), [(0.0, 0.0), (0.26, 0.3), (0.3, 0.4)], 6, CARVED, shade=0.85)
                face = (o[0] - d[0] * sg * 0.6, o[1] - d[1] * sg * 0.6)
                m.figure(c[0], c[1], yb, hs, face, ("apostle", "saint", "bishop", "king", "saint")[(k + (sg > 0)) % 5], shade=0.95 - 0.08 * k, arm=-sg)
                D.canopy(c[0], c[1], yb + hs * 1.05, 0.62, rot=math.pi / 6)
    dep, inner = rings[-1]
    # the tympanum over the lintel: the carved picture
    top = [pt for pt in inner if pt[1] > lintel + 0.05]
    tpts = [(hw1, lintel)] + top + [(-hw1, lintel)]
    ymax = max(y for _, y in tpts)
    m.upoly([W(sc + s, y, dep) for s, y in tpts], [((s + hw1) / (2 * hw1), (y - lintel) / (ymax - lintel)) for s, y in tpts], TYMP, 0.9, (o[0], o[1], 0))
    # the lintel: a carved band on corbels
    for k, (y0, y1, fwd) in enumerate(((lintel - 0.5, lintel, 0.2), (lintel - 0.62, lintel - 0.5, 0.12))):
        ring = [W(sc - hw1, 0, dep - fwd)[:2], W(sc + hw1, 0, dep - fwd)[:2], W(sc + hw1, 0, dep)[:2], W(sc - hw1, 0, dep)[:2]]
        m.prism(ring, y0, y1, CARVED, top=True, shade=1.05 if k == 0 else 0.85)
    if figures:
        n = max(3, int(hw1 * 2 / 0.55))
        for i in range(n):
            s = sc - hw1 + (i + 0.5) * 2 * hw1 / n
            c = W(s, 0, dep - 0.28)
            D.figure(c[0], c[1], lintel + 0.02, 0.55, (o[0], o[1]), small=True, shade=0.8)
    # the leaves: oak (the picture), iron straps with scrolls, ring handles
    tw = 0.3 if trumeau else 0.03
    dh = lintel - 0.62
    if leaves:
        for s0, s1, hinge in ((-hw1, -tw, -1), (tw, hw1, 1)):
            u0 = (s0 + hw1) / (2 * hw1)
            u1 = (s1 + hw1) / (2 * hw1)
            m.upoly([W(sc + s0, 0.3, dep), W(sc + s1, 0.3, dep), W(sc + s1, dh, dep), W(sc + s0, dh, dep)],
                    [(u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0)], OAK, 0.9, (o[0], o[1], 0))
            # (the strap hinges, the scrolls, the nails and the rings are in the picture and its height map)
    if trumeau:
        ring = [W(sc - 0.28, 0, dep - 0.55)[:2], W(sc + 0.28, 0, dep - 0.55)[:2], W(sc + 0.28, 0, dep)[:2], W(sc - 0.28, 0, dep)[:2]]
        m.prism(ring, 0, lintel - 0.62, CARVED, top=False, shade=1.0)
        c = W(sc, 0, dep - 0.72)
        m.lathe((c[0], c[1], 1.9), [(0.08, 0.0), (0.46, 0.55), (0.46, 0.7)], 6, CARVED, shade=0.95)  # the corbel
        if virgin:
            m.figure(c[0], c[1], 2.6, 1.95, (o[0], o[1]), "virgin", shade=1.05)
        m.canopy(c[0], c[1], 4.75, 0.95)
    if steps:
        for k, (e0, e1, y) in enumerate(((-0.9, 0.0, 0.15), (0.0, dep, 0.3))):
            hw = hw0 + 0.4 if k == 0 else hw1 + 0.05
            ring = [W(sc - hw, 0, e0)[:2], W(sc + hw, 0, e0)[:2], W(sc + hw, 0, e1)[:2], W(sc - hw, 0, e1)[:2]]
            m.prism(ring, 0, y, PLINTH, top=True, shade=0.85)


def _cwimperg(m, p, d, o, sc, hw, y0, y1, off=0.35, w=0.45):
    """The open gable over a portal: crocketed copings, a trefoil of tracery in it, a finial on the apex."""
    def Wp(s, y, e):
        return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)
    for sg in (-1, 1):
        a = sc + sg * hw
        f = m.poly([Wp(a, y0, off), Wp(a - sg * w, y0, off), Wp(sc, y1 - w * 1.2, off), Wp(sc, y1, off)], CARVED, 1.05)
        m.orient(f, (o[0], o[1], 0))
        f = m.poly([Wp(a, y0, off - 0.3), Wp(a, y0, off), Wp(sc, y1, off), Wp(sc, y1, off - 0.3)], CARVED, 1.0)
        m.orient(f, (d[0] * sg, d[1] * sg, 1.0))
        m.d.crockets(Wp(a, y0 + 0.1, off + 0.05), Wp(sc, y1 + 0.1, off + 0.05), max(3, int((y1 - y0) / 1.1)), (d[0] * sg, d[1] * sg, 0), 0.5)
    # a trefoil ring in the gable
    cy = y0 + (y1 - y0) * 0.38
    r = min(hw * 0.45, (y1 - y0) * 0.2)
    m.ring(p, d, o, sc, cy, r, r, off - 0.25, off - 0.02, 0.18, CARVED, 0.95, seg=14)
    for k in range(3):
        # the three foils
        a = math.pi / 2 + 2 * math.pi * k / 3
        m.d.ring(p, d, o, sc + r * 0.44 * math.cos(a), cy + r * 0.44 * math.sin(a), r * 0.42, r * 0.42, off - 0.22, off - 0.04, 0.1, CARVED, 0.95, seg=8)
    c = Wp(sc, 0, off)
    m.pinnacle(c[0], c[1], y1 - 0.3, 2.4, 0.3)


def _cbuttress(m, u, side, top=AE - 0.4, pin=5.0, depth=1.4, w=0.6, statue=True):
    """An aisle buttress in two stages with weatherings, a niche with a statue high on its face, a gablet and the
    pinnacle on top."""
    vo = side * VO
    ya = top * 0.55
    va, vb = sorted((vo, vo + side * depth))
    m.box(u - w, u + w, va, vb, 0, ya, STONE, shade=0.95)
    # the weathering: a slope back to the upper stage
    d2 = depth * 0.68
    m.face([(u - w, vo + side * depth, ya), (u + w, vo + side * depth, ya), (u + w, vo + side * d2, ya + 0.7), (u - w, vo + side * d2, ya + 0.7)],
           CARVED, 1.0, out=(0, side, 1))
    for sg in (-1, 1):
        m.face([(u + sg * w, vo, ya), (u + sg * w, vo + side * depth, ya), (u + sg * w, vo + side * d2, ya + 0.7), (u + sg * w, vo, ya + 0.7)],
               STONE, 0.9, out=(sg, 0, 0))
    va, vb = sorted((vo, vo + side * d2))
    m.box(u - w * 0.9, u + w * 0.9, va, vb, ya + 0.7, top, STONE, shade=0.95)
    # plinth
    va, vb = sorted((vo, vo + side * (depth + 0.1)))
    m.box(u - w - 0.1, u + w + 0.1, va, vb, -0.3, 0.9, PLINTH, shade=0.9)
    if statue:
        _niche3d(m, (u - w * 0.9, vo + side * d2), (1, 0), (0, side), w * 0.9, ya + 1.6, min(2.6, (top - ya) * 0.55), kind="saint", dep=0.42)
    # a gablet on the face under the pinnacle
    Wf = ((u - w * 0.9, vo + side * d2), (1, 0), (0, side))
    _gable_trim(m, [_wpt(*Wf, 0.0, 0.02, top - 0.2), _wpt(*Wf, 1.8 * w, 0.02, top - 0.2), _wpt(*Wf, 0.9 * w, 0.02, top + 1.1)], (0, side, 0), t=0.2)
    m.face([_wpt(*Wf, 0.0, 0.01, top - 0.2), _wpt(*Wf, 1.8 * w, 0.01, top - 0.2), _wpt(*Wf, 0.9 * w, 0.01, top + 1.1)], STONE, 0.95, out=(0, side, 0))
    m.pinnacle(u, vo + side * d2 * 0.5, top, pin, 0.42)


def _plinth_run(m, p, d, o, s0, s1, h=1.0, e=0.12):
    """The low courses along a wall's foot: a projecting plinth with a sloped top (the damp, sooted stone)."""
    m.face([_wpt(p, d, o, s0, e, -0.3), _wpt(p, d, o, s1, e, -0.3), _wpt(p, d, o, s1, e, h), _wpt(p, d, o, s0, e, h)], PLINTH, 0.95, out=(o[0], o[1], 0))
    m.face([_wpt(p, d, o, s0, e, h), _wpt(p, d, o, s1, e, h), _wpt(p, d, o, s1, 0.0, h + e * 1.2), _wpt(p, d, o, s0, 0.0, h + e * 1.2)], PLINTH, 1.0,
           out=(o[0], o[1], 1.0))
    for s, sg in ((s0, -1), (s1, 1)):
        m.face([_wpt(p, d, o, s, 0.0, -0.3), _wpt(p, d, o, s, e, -0.3), _wpt(p, d, o, s, e, h), _wpt(p, d, o, s, 0.0, h + e * 1.2)], PLINTH, 0.85,
               out=(d[0] * sg, d[1] * sg, 0))


def _string(m, p, d, o, s0, s1, y, e=0.16, h=0.22):
    """A string course: a moulded band along a wall."""
    _wb(m, p, d, o, s0, s1, 0.0, e, y - h, y, CARVED, 0.95)


# ---- the houses against the church, as good as the town's (build_city.py): the town's wall pictures and their
# height maps (brick, plaster, render, the old brick), painted; windows with reveals, frames, glazing bars, sills,
# heads and shutters; panelled doors in a recess with a step and a fanlight; shop fronts; cornices, gutters and
# downpipes; slate or pantile roofs with dormers; chimneys with pots.
HOUSE_WALLS = [HBRICK, HPLASTER, HRENDER, HBRICKOLD, HPLASTER, HBRICK]
HOUSE_PAINT = {HPLASTER: [(0.98, 0.96, 0.9), (0.97, 0.88, 0.72), (0.86, 0.88, 0.88), (0.95, 0.8, 0.68), (0.88, 0.92, 0.84)],
               HRENDER: [(0.95, 0.94, 0.9), (0.98, 0.92, 0.8), (0.84, 0.82, 0.78)],
               HBRICK: [(1.0, 1.0, 1.0), (0.92, 0.9, 0.9)], HBRICKOLD: [(1.0, 1.0, 1.0)]}
SHUTTER_PAINT = [(0.42, 0.62, 0.45), (0.62, 0.3, 0.24), (0.36, 0.44, 0.58), (0.5, 0.44, 0.34), (0.3, 0.42, 0.34)]
DOOR_PAINT = [(0.55, 0.36, 0.24), (0.3, 0.42, 0.34), (0.42, 0.22, 0.18), (0.32, 0.3, 0.3), (0.62, 0.48, 0.3)]


def _wall_holes(m, p, d, o, e, s0, s1, y0, y1, holes, mat, shade=1.0):
    """A flat wall at e out of the frame with rectangular holes [(sa, sb, ya, yb, ...)]: cut into strips."""
    ss = sorted({s0, s1} | {q for h in holes for q in h[:2]})
    ys = sorted({y0, y1} | {q for h in holes for q in h[2:4]})
    for j in range(len(ys) - 1):
        ya, yb = ys[j], ys[j + 1]
        run = None
        for i in range(len(ss) - 1):
            sa, sb = ss[i], ss[i + 1]
            cs, cy = (sa + sb) / 2, (ya + yb) / 2
            hole = any(h[0] < cs < h[1] and h[2] < cy < h[3] for h in holes)
            if not hole:
                run = (run[0], sb) if run else (sa, sb)
            if (hole or i == len(ss) - 2) and run:
                m.face([_wpt(p, d, o, run[0], e, ya), _wpt(p, d, o, run[1], e, ya), _wpt(p, d, o, run[1], e, yb), _wpt(p, d, o, run[0], e, yb)],
                       mat, shade, out=(o[0], o[1], 0))
                run = None


def _reveal(m, p, d, o, e, sa, sb, ya, yb, rd, mat, shade=0.7, sill=True):
    """The four sides of a hole in a wall at e, rd deep."""
    Q = lambda s, ee, y: _wpt(p, d, o, s, ee, y)  # noqa: E731
    m.face([Q(sa, e, ya), Q(sa, e, yb), Q(sa, e - rd, yb), Q(sa, e - rd, ya)], mat, shade, out=(d[0], d[1], 0))
    m.face([Q(sb, e, ya), Q(sb, e, yb), Q(sb, e - rd, yb), Q(sb, e - rd, ya)], mat, shade, out=(-d[0], -d[1], 0))
    m.face([Q(sa, e, yb), Q(sb, e, yb), Q(sb, e - rd, yb), Q(sa, e - rd, yb)], mat, shade * 0.75, out=(0, 0, -1))
    if sill:
        m.face([Q(sa, e, ya), Q(sb, e, ya), Q(sb, e - rd, ya), Q(sa, e - rd, ya)], mat, shade * 1.1, out=(0, 0, 1))


def _frame(D, p, d, o, e, sa, sb, ya, yb, w, dep, mat, shade=1.0, bottom=True):
    """A frame of four bars inside a hole's edge (a window's or a door's)."""
    Q = lambda s, y: _wpt(p, d, o, s, e, y)  # noqa: E731
    D.bar(Q(sa + w / 2, ya), Q(sa + w / 2, yb), w, dep, mat, shade)
    D.bar(Q(sb - w / 2, ya), Q(sb - w / 2, yb), w, dep, mat, shade)
    D.bar(Q(sa + w, yb - w / 2), Q(sb - w, yb - w / 2), w, dep, mat, shade)
    if bottom:
        D.bar(Q(sa + w, ya + w / 2), Q(sb - w, ya + w / 2), w, dep, mat, shade)


# (CATH_OLD_HOUSES=1 builds the houses as before the check, 2026-09-26: to see what the check finds there)
OLD_HOUSES = os.environ.get("CATH_OLD_HOUSES") == "1"


def _fbox(p, d, o, sa, sb, ea, eb):
    """A box in a wall frame (s along d, e out along o) as its extent in the plan: (u0, u1, v0, v1)."""
    pts = [_wpt(p, d, o, s_, e_, 0) for s_ in (sa, sb) for e_ in (ea, eb)]
    return (min(q[0] for q in pts), max(q[0] for q in pts), min(q[1] for q in pts), max(q[1] for q in pts))


def _hits(boxes, box, y0, y1, pad=0.0):
    """The boxes (u0, u1, v0, v1, y0, y1, ...) that overlap box (u0, u1, v0, v1) between y0 and y1, pad apart."""
    return [q for q in boxes if q[0] < box[1] + pad and q[1] > box[0] - pad and q[2] < box[3] + pad and q[3] > box[2] - pad
            and q[4] < y1 + pad and q[5] > y0 - pad]


def _s_range(p, d, q):
    """A plan box's extent along a wall frame's d."""
    ss = [(u - p[0]) * d[0] + (v - p[1]) * d[1] for u in (q[0], q[1]) for v in (q[2], q[3])]
    return min(ss), max(ss)


def _runs(lo, hi, blocked):
    """What is left of lo..hi without the blocked intervals, longest first."""
    runs = [(lo, hi)]
    for a, b in blocked:
        nxt = []
        for r0, r1 in runs:
            if b <= r0 or a >= r1:
                nxt.append((r0, r1))
                continue
            if a > r0:
                nxt.append((r0, a))
            if b < r1:
                nxt.append((b, r1))
        runs = nxt
    return sorted([r for r in runs if r[1] > r[0]], key=lambda r: r[0] - r[1])


def _house_window(m, p, d, o, E, sa, sb, ya, yb, brick, paint, wall, shut=None, shut_w=0.0, rec=None):
    """A sash window in a wall at E out of the frame: its reveal, a bluestone sill, a stone lintel (brick) or a moulded
    surround (plaster), the glass, a white frame and bars, and open shutters shut_w wide when there is room."""
    D = m.d
    rd = 0.24
    m.set_tint(paint)
    _reveal(m, p, d, o, E, sa, sb, ya, yb, rd, wall, 0.62)
    m.set_tint((1.0, 1.0, 1.0))
    _wb(m, p, d, o, sa - 0.08, sb + 0.08, E, E + 0.08, ya - 0.1, ya, PLINTH, 0.95)
    if brick:
        _wb(m, p, d, o, sa - 0.12, sb + 0.12, E, E + 0.04, yb, yb + 0.24, PLINTH, 1.0)
        ext = 0.12
    else:
        m.set_tint(tuple(min(1.0, c * 1.04) for c in paint))
        for s_a, s_b, y_a, y_b in ((sa - 0.13, sa, ya, yb + 0.13), (sb, sb + 0.13, ya, yb + 0.13), (sa, sb, yb, yb + 0.13)):
            _wb(m, p, d, o, s_a, s_b, E, E + 0.05, y_a, y_b, wall, 1.05)
        _wb(m, p, d, o, sa - 0.2, sb + 0.2, E, E + 0.1, yb + 0.13, yb + 0.22, wall, 1.1)
        ext = 0.2
    if rec:
        rec("window", p, d, o, sa, sb, E - rd, E + 0.01, ya, yb)
        rec("sill", p, d, o, sa - 0.08, sb + 0.08, E, E + 0.08, ya - 0.1, ya)
        if brick:
            rec("lintel", p, d, o, sa - 0.12, sb + 0.12, E, E + 0.04, yb, yb + 0.24)
        else:
            rec("surround", p, d, o, sa - 0.13, sa, E, E + 0.05, ya, yb + 0.13)
            rec("surround", p, d, o, sb, sb + 0.13, E, E + 0.05, ya, yb + 0.13)
            rec("head", p, d, o, sa - 0.2, sb + 0.2, E, E + 0.1, yb + 0.13, yb + 0.22)
    m.set_tint((1.0, 1.0, 1.0))
    ge = E - rd + 0.06
    m.face([_wpt(p, d, o, sa, ge, ya), _wpt(p, d, o, sb, ge, ya), _wpt(p, d, o, sb, ge, yb), _wpt(p, d, o, sa, ge, yb)], HGLASS, 0.9,
           out=(o[0], o[1], 0))
    # (the frame and the bars stand clear of the glass: 1 cm, never back to back with it)
    # (1 cm clear of the reveal all round: never face to face with its sides, head and sill)
    _frame(D, p, d, o, ge + 0.05, sa + 0.01, sb - 0.01, ya + 0.01, yb - 0.01, 0.075, 0.08, HTRIM, 1.0)
    sc = (sa + sb) / 2
    D.bar(_wpt(p, d, o, sc, ge + 0.04, ya + 0.07), _wpt(p, d, o, sc, ge + 0.04, yb - 0.07), 0.05, 0.05, HTRIM, 1.0)
    for t in ((0.5,) if yb - ya < 1.4 else (0.36, 0.68)):
        y = ya + (yb - ya) * t
        D.bar(_wpt(p, d, o, sa + 0.07, ge + 0.04, y), _wpt(p, d, o, sb - 0.07, ge + 0.04, y), 0.045, 0.05, HTRIM, 1.0)
    if shut is not None and shut_w >= 0.28:
        # open shutters, clear of the surround (plaster) or of the reveal's edge (brick)
        gap = 0.15 if not brick and not OLD_HOUSES else 0.02
        D.set_tint(shut)
        for a_, b_ in ((sa - gap - shut_w, sa - gap), (sb + gap, sb + gap + shut_w)):
            _wb(D, p, d, o, a_, b_, E + 0.01, E + 0.05, ya + 0.02, yb - 0.02, HSHUT, 0.95)
            for t in (0.33, 0.66):
                y = ya + (yb - ya) * t
                _wb(D, p, d, o, a_ + 0.03, b_ - 0.03, E + 0.05, E + 0.07, y - 0.03, y + 0.03, HSHUT, 0.8)
            if rec:
                rec("shutter", p, d, o, a_, b_, E + 0.01, E + 0.07, ya + 0.02, yb - 0.02)
        D.set_tint((1.0, 1.0, 1.0))


def _house2(m, p, d, o, s0, s1, depth, h, rise, idx, chimney=False, row=(), ground=None):
    """A house built against the church: its front `depth` out from the church wall (p, d, o), s0..s1 along it,
    h to the eaves, the roof's ridge along the wall `rise` higher. `row`: the houses of its row (s0, s1, depth, h), for
    its neighbours; `ground(u, v)`: is there free walkable ground there (the walk map).
    (The houses' check, 2026-09-26, Steve: a door half inside a buttress. The house now looks at the stone round it,
    m.solids: where stone stands before its front at an end, the house stops at it; doors, windows, shutters, the shop
    front, the cornice, the dormer and the chimney go only where they are clear of it and of the neighbours; a door only
    where there is ground to walk in front of it; the ends that are seen get windows. Every part is noted in m.parts for
    check_houses().)"""
    import random
    rng = random.Random(idx * 7919 + int(s0 * 10))
    D = m.d
    m.set_house(idx)
    E = depth
    # the neighbours: how far off each end, how deep, how high
    nb_ = {-1: None, 1: None}
    for q in row:
        if q[0] >= s1 - 0.01 and (nb_[1] is None or q[0] < nb_[1][0]):
            nb_[1] = q
        if q[1] <= s0 + 0.01 and (nb_[-1] is None or q[1] > nb_[-1][1]):
            nb_[-1] = q
    gap = {-1: (s0 - nb_[-1][1]) if nb_[-1] else 9.0, 1: (nb_[1][0] - s1) if nb_[1] else 9.0}
    # stone standing in the front's way: the house stops at it (its end wall against the stone)
    front = _fbox(p, d, o, s0, s1, E - 0.35, E + 0.6)
    blocked = [_s_range(p, d, q) for q in _hits(m.solids, front, -0.3, h + 0.2)]
    runs = _runs(s0, s1, [(a - 0.06, b + 0.06) for a, b in blocked])
    fa, fb = runs[0] if runs else (s0, s0 + 1.0)
    if OLD_HOUSES:
        fa, fb = s0, s1
    if fa > s0 + 0.01:
        gap[-1] = 0.06
        s0 = fa
    if fb < s1 - 0.01:
        gap[1] = 0.06
        s1 = fb
    W = s1 - s0
    lim = (s0 - min(gap[-1], 0.3) / 2 + 0.005, s1 + min(gap[1], 0.3) / 2 - 0.005)  # no part past half the gap
    if OLD_HOUSES:
        lim = (s0 - 0.12, s1 + 0.12)

    def rec(kind, P_, D_, O_, sa, sb, ea, eb, ya, yb):
        m.parts.append((idx, kind, _fbox(P_, D_, O_, sa, sb, ea, eb) + (min(ya, yb), max(ya, yb))))

    wall = HOUSE_WALLS[idx % len(HOUSE_WALLS)]
    paint = rng.choice(HOUSE_PAINT[wall])
    shut = rng.choice(SHUTTER_PAINT)
    dpaint = rng.choice(DOOR_PAINT)
    brick = wall in (HBRICK, HBRICKOLD)
    roof = HPANTILE if rng.random() < 0.45 else HSLATE
    gh = 3.2 + rng.uniform(-0.1, 0.25)
    nup = max(1, int(round((h - gh - 0.5) / 2.75)))
    fh = (h - gh - 0.45) / nup
    # the bays, 0.3 m in from each end
    ia, ib = (s0 + 0.3, s1 - 0.3) if not OLD_HOUSES else (s0, s1)
    nb = int((ib - ia) / 1.75)
    if nb == 0 and ib - ia >= 1.25:
        nb = 1
    bw = (ib - ia) / nb if nb else 0.0
    # the door: in an end bay with ground to walk before it
    door_bay = None
    order = [0, nb - 1] if rng.random() < 0.5 else [nb - 1, 0]
    order += [k for k in range(nb) if k not in order]
    for k in order:
        if nb == 0:
            break
        c = ia + (k + 0.5) * bw
        if OLD_HOUSES or ground is None or all(ground(*_wpt(p, d, o, c + ds, E + de, 0)[:2]) for ds in (-0.3, 0.0, 0.3) for de in (1.4, 2.0)):
            door_bay = k
            break
    shop = nb >= 2 and W > 4.4 and rng.random() < 0.55 and door_bay in (0, nb - 1)
    shutters = rng.random() < 0.6
    ww = rng.choice([0.9, 1.0, 1.1])
    wh = min(fh - 0.95, rng.choice([1.5, 1.65, 1.8]))
    holes = []
    for k in range(nb):
        c = ia + (k + 0.5) * bw
        if k == door_bay:
            holes.append((c - 0.55, c + 0.55, 0.0, 2.45, "door"))
        elif not shop:
            holes.append((c - ww / 2, c + ww / 2, 0.95, 2.6, "win", 0))
    if shop:
        sa = ia + (bw if door_bay == 0 else 0.0) + 0.35
        sb = ib - (bw if door_bay == nb - 1 else 0.0) - 0.35
        holes.append((sa, sb, 0.62, 2.7, "shop"))
    for f in range(nup):
        yb = gh + f * fh + 0.75
        for k in range(nb):
            c = ia + (k + 0.5) * bw
            holes.append((c - ww / 2, c + ww / 2, yb, yb + wh * (0.92 if f == nup - 1 and nup > 1 else 1.0), "win", f + 1))
    # the shutters' width: what the neighbouring openings and the ends leave (each shares a gap with the next)
    ext = 0.12 if brick else 0.2
    sgap = 0.02 if brick else 0.15

    def room(hole):
        sa, sb = hole[0], hole[1]
        left = [x[1] + (0.2 if x[4] == "shop" else ext) for x in holes if x is not hole and x[1] <= sa + 0.01 and x[2] < hole[3] and x[3] > hole[2]]
        right = [x[0] - (0.2 if x[4] == "shop" else ext) for x in holes if x is not hole and x[0] >= sb - 0.01 and x[2] < hole[3] and x[3] > hole[2]]
        sp_l = (sa - max(left)) / 2 if left else sa - s0 - 0.08
        sp_r = (min(right) - sb) / 2 if right else s1 - sb - 0.08
        return min(sp_l, sp_r) - sgap - 0.03
    # (one width for a whole storey: the same shutters all along it)
    shut_w = {}
    for hole in holes:
        if hole[4] == "win":
            f = hole[5]
            shut_w[f] = min(shut_w.get(f, 9.0), room(hole), (hole[1] - hole[0]) / 2) if not OLD_HOUSES else (hole[1] - hole[0]) / 2
    # the front
    m.set_tint(paint)
    _wall_holes(m, p, d, o, E, s0, s1, -0.3, h, holes, wall)
    for hole in holes:
        sa, sb, ya, yb, kind = hole[:5]
        if kind == "win":
            _house_window(m, p, d, o, E, sa, sb, ya, yb, brick, paint, wall, shut if shutters and hole[5] <= 1 else None, shut_w.get(hole[5], 0.0), rec)
        elif kind == "door":
            rd = 0.24
            m.set_tint(paint)
            _reveal(m, p, d, o, E, sa, sb, ya, yb, rd, wall, 0.62, sill=False)
            m.set_tint((1.0, 1.0, 1.0))
            de = E - rd
            _wb(m, p, d, o, sa, sb, de, E, -0.3, 0.16, PLINTH, 0.9)
            D.set_tint(dpaint)
            m.set_tint(dpaint)
            m.face([_wpt(p, d, o, sa, de + 0.02, 0.16), _wpt(p, d, o, sb, de + 0.02, 0.16), _wpt(p, d, o, sb, de + 0.02, 2.08),
                    _wpt(p, d, o, sa, de + 0.02, 2.08)], HDOOR, 0.9, out=(o[0], o[1], 0))
            for (a_, b_) in ((sa + 0.12, (sa + sb) / 2 - 0.05), ((sa + sb) / 2 + 0.05, sb - 0.12)):
                for (y_a, y_b) in ((0.35, 1.05), (1.25, 1.95)):
                    _wb(D, p, d, o, a_, b_, de + 0.03, de + 0.06, y_a, y_b, HDOOR, 1.1)
            _frame(D, p, d, o, de + 0.08, sa + 0.01, sb - 0.01, 0.17, 2.44, 0.1, 0.1, HDOOR, 0.8, bottom=False)
            D.bar(_wpt(p, d, o, sa + 0.01, de + 0.08, 2.12), _wpt(p, d, o, sb - 0.01, de + 0.08, 2.12), 0.08, 0.1, HDOOR, 0.8)
            m.set_tint((1.0, 1.0, 1.0))
            D.set_tint((1.0, 1.0, 1.0))
            m.face([_wpt(p, d, o, sa, de + 0.01, 2.08), _wpt(p, d, o, sb, de + 0.01, 2.08), _wpt(p, d, o, sb, de + 0.01, 2.45),
                    _wpt(p, d, o, sa, de + 0.01, 2.45)], HGLASS, 0.9, out=(o[0], o[1], 0))
            k_ = _wpt(p, d, o, (sa + sb) / 2 + 0.2, de + 0.07, 1.05)
            D.lathe(k_, [(0.035, 0.0), (0.035, 0.07)], 6, IRON, shade=0.7)
            rec("door", p, d, o, sa, sb, de, E + 0.02, -0.3, 2.45)
        elif kind == "shop":
            rd = 0.24
            m.set_tint(paint)
            _reveal(m, p, d, o, E, sa, sb, ya, yb, rd, wall, 0.62)
            m.set_tint((1.0, 1.0, 1.0))
            ge = E - 0.14
            m.face([_wpt(p, d, o, sa, ge, ya), _wpt(p, d, o, sb, ge, ya), _wpt(p, d, o, sb, ge, yb), _wpt(p, d, o, sa, ge, yb)], HGLASS, 0.95,
                   out=(o[0], o[1], 0))
            D.set_tint(dpaint)
            m.set_tint(dpaint)
            n = max(2, int((sb - sa) / 0.55))
            for i in range(1, n):
                s = sa + (sb - sa) * i / n
                D.bar(_wpt(p, d, o, s, ge + 0.04, ya), _wpt(p, d, o, s, ge + 0.04, yb), 0.05, 0.06, HDOOR, 1.0)
            D.bar(_wpt(p, d, o, sa, ge + 0.04, ya + (yb - ya) * 0.72), _wpt(p, d, o, sb, ge + 0.04, ya + (yb - ya) * 0.72), 0.06, 0.06, HDOOR, 1.0)
            _frame(D, p, d, o, ge + 0.06, sa + 0.01, sb - 0.01, ya + 0.01, yb - 0.01, 0.1, 0.1, HDOOR, 0.95)
            # the shop front: pilasters, the fascia board and its cornice, the stall board
            for a_, b_ in ((sa - 0.2, sa), (sb, sb + 0.2)):
                _wb(m, p, d, o, a_, b_, E, E + 0.12, 0.0, 2.95, HDOOR, 0.9)
            _wb(m, p, d, o, sa - 0.25, sb + 0.25, E, E + 0.14, 2.75, 3.1, HDOOR, 1.0)
            _wb(m, p, d, o, sa - 0.3, sb + 0.3, E, E + 0.22, 3.1, 3.2, HDOOR, 1.1)
            _wb(m, p, d, o, sa, sb, E, E + 0.06, 0.05, ya, HDOOR, 0.85)
            m.set_tint((1.0, 1.0, 1.0))
            D.set_tint((1.0, 1.0, 1.0))
            rec("shopfront", p, d, o, sa - 0.3, sb + 0.3, E - rd, E + 0.22, 0.0, 3.2)
    # the ends: walls, and windows where an end is seen (no neighbour close by, no stone before it)
    for se, sg in ((s0, -1), (s1, 1)):
        pe = _wpt(p, d, o, se, 0, 0)[:2]
        de_, oe_ = o, (d[0] * sg, d[1] * sg)
        nq = nb_[sg] if gap[sg] <= 0.6 else None
        end_holes = []
        if nb and not OLD_HOUSES:
            floors = [(0.95, 2.6, 0)] + [(gh + f * fh + 0.75, gh + f * fh + 0.75 + wh, f + 1) for f in range(nup)]
            for ya, yb, f in floors:
                # (the neighbour covers the end up to its depth, as high as its ridge)
                cov = nq[2] if (nq and nq[3] + (nq[4] if len(nq) > 4 else 0.0) >= yb + 0.3) else 0.0
                box = _fbox(pe, de_, oe_, cov, E, -0.35, 0.7)
                stone = [_s_range(pe, de_, q) for q in _hits(m.solids, box, ya - 0.3, yb + 0.3)]
                er = _runs(cov + 0.5, E - 0.5, [(a - 0.12, b + 0.12) for a, b in stone])
                if not er or er[0][1] - er[0][0] < 0.85:
                    continue
                a_, b_ = er[0]
                n = max(1, int((b_ - a_ + 0.6) / 1.9))
                step = (b_ - a_) / n
                for k in range(n):
                    c = a_ + (k + 0.5) * step
                    w_ = min(ww if f else 0.9, step - 0.45)
                    if w_ >= 0.6:
                        end_holes.append((c - w_ / 2, c + w_ / 2, ya, yb, "win", f))
        m.set_tint(paint)
        _wall_holes(m, pe, de_, oe_, 0.0, 0.0, E, -0.3, h, end_holes, wall, 0.9)
        m.face([_wpt(pe, de_, oe_, 0, 0, h), _wpt(pe, de_, oe_, E, 0, h), _wpt(pe, de_, oe_, E / 2, 0, h + rise)], wall, 0.9, out=(oe_[0], oe_[1], 0))
        for hole in end_holes:
            _house_window(m, pe, de_, oe_, 0.0, hole[0], hole[1], hole[2], hole[3], brick, paint, wall, None, 0.0, rec)
        # (what of this end is seen, for the check: the end's ground to eaves beyond the neighbour, clear of stone)
        m.parts.append((idx, "end", _fbox(pe, de_, oe_, 0.0, E, 0.0, 0.02) + (-0.3, h), (sg, gap[sg], nq, len(end_holes), pe, de_, oe_, E)))
    # the cornice, the gutter, a downpipe
    m.set_tint((0.95, 0.94, 0.9) if brick else tuple(min(1.0, c * 1.05) for c in paint))
    _wb(m, p, d, o, s0, s1, E, E + 0.16, h - 0.5, h - 0.32, HTRIM if brick else wall, 0.95)
    _wb(m, p, d, o, s0, s1, E, E + 0.34, h - 0.32, h - 0.06, HTRIM if brick else wall, 1.05)
    rec("cornice", p, d, o, s0, s1, E, E + 0.34, h - 0.5, h - 0.06)
    m.set_tint((1.0, 1.0, 1.0))
    ga, gb = max(s0 - 0.04, lim[0]), min(s1 + 0.04, lim[1])
    _wb(m, p, d, o, ga, gb, E + 0.34, E + 0.48, h - 0.16, h + 0.02, LEAD, 0.8)
    rec("gutter", p, d, o, ga, gb, E + 0.34, E + 0.48, h - 0.16, h + 0.02)
    sp_ = s1 - 0.28 if idx % 2 else s0 + 0.28
    m.bar(_wpt(p, d, o, sp_, E + 0.1, h - 0.1), _wpt(p, d, o, sp_, E + 0.1, 0.05), 0.09, 0.09, LEAD, 0.75)
    m.bar(_wpt(p, d, o, sp_, E + 0.1, h - 0.1), _wpt(p, d, o, sp_, E + 0.42, h - 0.05), 0.09, 0.09, LEAD, 0.75)
    rec("downpipe", p, d, o, sp_ - 0.05, sp_ + 0.05, E + 0.05, E + 0.46, 0.05, h - 0.05)
    # the roof: the front slope to the ridge along the church wall, the back slope down to it; a ridge. Its overhang
    # at each end: at most half the gap to the neighbour
    om = E / 2
    eave = (E + 0.5, h - 0.12)
    ra, rb = max(s0 - 0.12, lim[0]), min(s1 + 0.12, lim[1])
    for sgv, (ea, ya) in ((1, eave), (-1, (0.0, h))):
        m.face([_wpt(p, d, o, ra, ea, ya), _wpt(p, d, o, rb, ea, ya), _wpt(p, d, o, rb, om, h + rise),
                _wpt(p, d, o, ra, om, h + rise)], roof, 0.92 if sgv > 0 else 0.8, out=(o[0] * sgv, o[1] * sgv, 1))
        m.face([_wpt(p, d, o, ra, ea, ya - 0.08), _wpt(p, d, o, rb, ea, ya - 0.08), _wpt(p, d, o, rb, ea, ya),
                _wpt(p, d, o, ra, ea, ya)], roof, 0.6, out=(o[0] * sgv, o[1] * sgv, 0))
    m.bar(_wpt(p, d, o, ra, om, h + rise + 0.04), _wpt(p, d, o, rb, om, h + rise + 0.04), 0.22, 0.12, roof, 0.75)
    rec("roof", p, d, o, ra, rb, 0.0, E + 0.5, h - 0.2, h + rise + 0.2)
    # a dormer on the front slope
    if E >= 5.5 and W >= 3.8:
        def e_at(y):
            return eave[0] + (y - eave[1]) / (h + rise - eave[1]) * (om - eave[0])
        sc = s0 + W * (0.5 if nb % 2 else 0.5 + 0.5 / max(nb, 1))
        yb = h + 0.25
        dw, dh = 1.2, 1.55
        ef = e_at(yb)
        m.set_tint(paint)
        m.face([_wpt(p, d, o, sc - dw / 2, ef, yb), _wpt(p, d, o, sc + dw / 2, ef, yb), _wpt(p, d, o, sc + dw / 2, ef, yb + dh),
                _wpt(p, d, o, sc, ef, yb + dh + 0.55), _wpt(p, d, o, sc - dw / 2, ef, yb + dh)], wall, 0.9, out=(o[0], o[1], 0))
        m.set_tint((1.0, 1.0, 1.0))
        m.face([_wpt(p, d, o, sc - 0.36, ef + 0.02, yb + 0.25), _wpt(p, d, o, sc + 0.36, ef + 0.02, yb + 0.25), _wpt(p, d, o, sc + 0.36, ef + 0.02, yb + 1.3),
                _wpt(p, d, o, sc - 0.36, ef + 0.02, yb + 1.3)], HGLASS, 0.9, out=(o[0], o[1], 0))
        _frame(D, p, d, o, ef + 0.06, sc - 0.36, sc + 0.36, yb + 0.25, yb + 1.3, 0.07, 0.06, HTRIM)
        D.bar(_wpt(p, d, o, sc, ef + 0.06, yb + 0.3), _wpt(p, d, o, sc, ef + 0.06, yb + 1.25), 0.045, 0.05, HTRIM)
        et = e_at(yb + dh + 0.55)
        for sg in (-1, 1):
            s = sc + sg * dw / 2
            m.face([_wpt(p, d, o, s, ef, yb), _wpt(p, d, o, s, ef, yb + dh), _wpt(p, d, o, s, e_at(yb + dh), yb + dh)], roof, 0.75,
                   out=(d[0] * sg, d[1] * sg, 0))
            m.face([_wpt(p, d, o, s + sg * 0.1, ef + 0.1, yb + dh - 0.05), _wpt(p, d, o, sc, ef + 0.1, yb + dh + 0.6), _wpt(p, d, o, sc, et, yb + dh + 0.6),
                    _wpt(p, d, o, s + sg * 0.1, e_at(yb + dh - 0.05), yb + dh - 0.05)], roof, 0.9, out=(d[0] * sg, d[1] * sg, 1.2))
        rec("dormer", p, d, o, sc - dw / 2 - 0.1, sc + dw / 2 + 0.1, et, ef + 0.1, yb, yb + dh + 0.6)
    if chimney:
        # (where it stands clear of the stone: a pinnacle or a buttress may rise through the roof)
        ce = om * 0.9
        yb = h + rise * 0.35
        yt = h + rise + 1.0
        cs = None
        for t in ((0.72, 0.28, 0.5) if idx % 2 else (0.28, 0.72, 0.5)):
            if OLD_HOUSES or not _hits(m.solids, _fbox(p, d, o, s0 + W * t - 0.5, s0 + W * t + 0.5, ce - 0.45, ce + 0.45), yb, yt + 0.6):
                cs = s0 + W * t
                break
        if cs is not None:
            m.set_tint((0.95, 0.9, 0.88))
            _wb(m, p, d, o, cs - 0.35, cs + 0.35, ce - 0.3, ce + 0.3, yb, yt, HBRICK, 0.9)
            m.set_tint((1.0, 1.0, 1.0))
            _wb(m, p, d, o, cs - 0.42, cs + 0.42, ce - 0.37, ce + 0.37, yt, yt + 0.1, PLINTH, 0.9)
            m.set_tint((0.85, 0.5, 0.36))
            for k in ((-0.15,) if idx % 3 else (-0.15, 0.15)):
                c = _wpt(p, d, o, cs + k, ce, yt + 0.1)
                m.lathe(c, [(0.09, 0.0), (0.08, 0.3), (0.1, 0.34), (0.09, 0.4)], 6, HPANTILE, shade=0.9, caps=False)
            rec("chimney", p, d, o, cs - 0.42, cs + 0.42, ce - 0.37, ce + 0.37, yb, yt + 0.5)
    m.set_tint((1.0, 1.0, 1.0))
    # the house itself, for the check
    m.parts.append((idx, "body", _fbox(p, d, o, s0, s1, 0.0, E) + (-0.3, h + rise), (p, d, o, s0, s1, E, h, gap[-1], gap[1], door_bay)))
    m.set_house(None)


WALK = os.path.join(ROOT, "client", "public", "city", "walk.png")
_WALK = []


def _ground(fr, m=None):
    """Is there free walkable ground at a local (u, v) of frame fr? (The walk map: no wall, no water; or with m, the
    strips round the cathedral that the game opens, less its stone and its houses: _open_ground.)"""
    import numpy as np
    if not _WALK:
        img = bpy.data.images.load(WALK)
        w, h = img.size
        arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        bpy.data.images.remove(img)
        _WALK.append((arr, w, h, json.load(open(CITY))["walk"]))
    arr, w, h, W0 = _WALK[0]

    def free(u, v):
        x, _, z = fr.w(u, v, 0)
        col = int((z - W0["z0"]) / W0["res"])
        row = int((x - W0["x0"]) / W0["res"])
        if not (0 <= col < w and 0 <= row < h):
            return False
        px = arr[h - 1 - row, col]
        if px[0] < 0.5 and px[1] < 0.5:
            return True
        if m is None or not any(q[0] <= u <= q[1] and q[2] <= v <= q[3] for q in m.strips):
            return False
        return not _hits(_blocks(m), (u, u, v, v), 0.0, 1.8, 0.45)
    return free


def _blocks(m):
    """What stands on the open ground by the cathedral (plan boxes): its stone down to a man's height, the houses and
    their parts low down (door steps, shop fronts, downpipes)."""
    out = [q for q in m.solids if q[4] < 1.9]
    out += [q[2] for q in m.parts if q[1] == "body" or (q[1] not in ("end",) and q[2][4] < 1.9)]
    return out


def _open_ground(m):
    """The strips and what stands in them, in world rectangles (minX, maxX, minZ, maxZ): for the game's walk area."""
    def world(q):
        xs, zs = [], []
        for u in (q[0], q[1]):
            for v in (q[2], q[3]):
                x, _, z = m.f.w(u, v, 0)
                xs.append(round(x, 3))
                zs.append(round(z, 3))
        return [min(xs), max(xs), min(zs), max(zs)]
    strips = [world(q) for q in m.strips]
    blocks = [world(q) for q in _blocks(m) if any(q[0] < s[1] and q[1] > s[0] and q[2] < s[3] and q[3] > s[2] for s in m.strips)]
    return {"about": "M7 the cathedral outside: ground round the cathedral opened for walking (the strips, world rects "
                     "minX, maxX, minZ, maxZ), less what stands on it (blocks): tools/blender/build_landmarks.py _open_ground",
            "strips": strips, "blocks": blocks}


def check_houses(m, ground=None, pad=0.03):
    """The houses against the church, checked (Steve, 2026-09-26: "quality checks?"): every door, window, shutter,
    shop front, cornice, gutter, downpipe, dormer and chimney clear of the stone by `pad`; no part past half the gap to
    the next house or in another house; the openings of a front clear of each other; each door with ground to walk in
    front of it; the back of each house against the church (not floating); no stone through a front; no end that is
    seen left blank. Returns the list of problems (empty: all good)."""
    bad = []
    parts = [q for q in m.parts]
    bodies = {q[0]: q for q in parts if q[1] == "body"}

    def where(box):
        x, _, z = m.f.w((box[0] + box[1]) / 2, (box[2] + box[3]) / 2, 0)
        return f"x {x:.1f}, z {z:.1f}, y {box[4]:.1f}..{box[5]:.1f}"
    for idx, kind, box, *info in parts:
        if kind in ("body", "end"):
            continue
        # in the stone
        if kind != "roof":
            for q in _hits(m.solids, box[:4], box[4] - pad, box[5] + pad, pad):
                bad.append((idx, f"{kind} in the stone", where(box)))
                break
        # in another house
        for j, b in bodies.items():
            if j != idx and _hits([b[2]], box[:4], box[4], box[5], -0.005):
                bad.append((idx, f"{kind} in house {j}", where(box)))
    for idx, b in bodies.items():
        p, d, o, s0, s1, E, h, g0, g1, door_bay = b[3]
        body = b[2]
        # the openings of the front and the ends: clear of each other
        items = [q for q in parts if q[0] == idx and q[1] in ("window", "sill", "lintel", "surround", "head", "shutter", "door", "shopfront")]
        for i in range(len(items)):
            for k in range(i + 1, len(items)):
                a_, c_ = items[i][2], items[k][2]
                if _hits([a_], c_[:4], c_[4], c_[5], -0.01):
                    bad.append((idx, f"{items[i][1]} through {items[k][1]}", where(a_)))
        if door_bay is None:
            bad.append((idx, "no door", where(body)))
        for q in parts:
            if q[0] == idx and q[1] == "door" and ground is not None:
                db = q[2]
                cu, cv = (db[0] + db[1]) / 2, (db[2] + db[3]) / 2
                su, sv = (cu - p[0]) * d[0] + (cv - p[1]) * d[1], 0
                if not all(ground(*_wpt(p, d, o, su + ds, E + de, 0)[:2]) for ds in (-0.3, 0.0, 0.3) for de in (1.4, 2.0)):
                    bad.append((idx, "door with no ground before it", where(db)))
        # the back against the church
        for t in (0.1, 0.5, 0.9):
            u, v, _ = _wpt(p, d, o, s0 + (s1 - s0) * t, -0.2, 0)
            if not _hits(m.solids, (u, u, v, v), 2.0, 2.0):
                bad.append((idx, "back not against the church", where((u, u, v, v, 2.0, 2.0))))
                break
        # stone through the front
        for q in _hits(m.solids, _fbox(p, d, o, s0 + 0.02, s1 - 0.02, E - 0.3, E + 0.02), 0.0, h - 0.05):
            bad.append((idx, "stone through the front", where(q)))
            break
    # ends that are seen and blank: sample the end 0.9 m out of it: seen where no other house and no stone stands there
    # (a slot narrower than that, between two houses or a house and the church, shows its walls only edge on)
    others = [q[2] for q in parts if q[1] == "body"]
    for idx, kind, box, *info in parts:
        if kind != "end":
            continue
        sg, gp, nq, nwin, pe, de_, oe_, E = info[0]
        h = bodies[idx][3][6]
        seen = 0
        for i in range(int(E / 0.5)):
            for j in range(int(h / 0.5)):
                u, v, _ = _wpt(pe, de_, oe_, 0.25 + i * 0.5, 0.9, 0)
                y = 0.25 + j * 0.5
                pt = (u, u, v, v)
                if not _hits([q for q in others if q is not bodies[idx][2]], pt, y, y) and not _hits(m.solids, pt, y, y):
                    seen += 1
        if seen * 0.25 >= 4.0 and nwin == 0:
            bad.append((idx, f"a seen end left blank ({seen * 0.25:.0f} m2)", where(box)))
    return bad


def cathedral(fr, world_north):
    """Onze-Lieve-Vrouwekathedraal, 1873. The west front faces the Handschoenmarkt
    (u = 0), the choir the east; the tall tower is the north one."""
    cath_materials()
    ns = 1 if fr.n[0] * world_north[0] + fr.n[1] * world_north[1] > 0 else -1
    L = fr.L
    k = L / 124.94  # the plan below was fitted to this length; stretch along u if the outline changes
    lf = Frame({"c": [fr.c[0] - fr.ax[0] * L / 2, fr.c[1] - fr.ax[1] * L / 2], "ax": [fr.ax[0] * k, fr.ax[1] * k],
                "n": [fr.n[0] * ns, fr.n[1] * ns], "L": L, "W": fr.W})
    for mname, rgb in zip(CATH2_MATS, [(0.52, 0.48, 0.4), (0.25, 0.27, 0.3), (0.05, 0.06, 0.07), (0.55, 0.3, 0.22), (0.3, 0.31, 0.32), (0.5, 0.5, 0.5),
                                       (0.8, 0.55, 0.16), (0.4, 0.38, 0.34), (0.58, 0.54, 0.46), (0.3, 0.2, 0.12), (0.1, 0.1, 0.1), (0.5, 0.46, 0.4),
                                       (0.5, 0.28, 0.2), (0.8, 0.78, 0.7), (0.75, 0.74, 0.7), (0.5, 0.4, 0.3), (0.9, 0.9, 0.88), (0.4, 0.5, 0.4),
                                       (0.3, 0.32, 0.36), (0.6, 0.3, 0.2), (0.1, 0.12, 0.14), (0.4, 0.28, 0.2)]):
        if mname not in bpy.data.materials:
            material(mname, rgb)
    # issue #10: the old panes of the real windows, never drawn by the game (the atlas's picture, for the hall and the night)
    if "cath_atlas_lit" not in bpy.data.materials:
        bpy.data.materials["cath_atlas"].copy().name = "cath_atlas_lit"
    m = CathMesh(lf, detail=True)
    m.lit = CathMesh(lf)
    CATH_OPENINGS.clear()
    nave_bays = [13.8 + i * (T0 - 13.8) / 6 for i in range(7)]
    choir_bays = [T1 + i * (AU - T1) / 3 for i in range(4)]
    sname = {1: "north", -1: "south"}

    # ---- the high walls of nave and choir, clerestory windows, balustrade, pinnacles
    for side in (-1, 1):
        v = side * HN
        # M7: from the aisle roofs up (below them it is inside the church), and not across the transept
        # (issue #10: the clerestory's windows are real, the nave's and the choir's hall behind them)
        for ua, ub, bays, part in ((13.8, T0, nave_bays, "nave"), (T1, AU, choir_bays, "choir")):
            holes = [_real_win(m, (0, v), (1, 0), (0, side), a + 1.8, b - 1.8, 22.6, 29.4, "great_window", arch_shape(0.66, 3),
                               f"the {part}'s {sname[side]} clerestory, bay {i + 1}, window") for i, (a, b) in enumerate(zip(bays, bays[1:]))]
            _cut_wall(m, (0, v), (1, 0), (0, side), ua, ub, AE, NE, holes)
            _wb(m, (0, v), (1, 0), (0, side), ua, ub, 0.0, 0.34, NE - 0.62, NE, CARVED, 0.95)
            _string(m, (0, v), (1, 0), (0, side), ua, ub, 22.3)
        for bays in (nave_bays, choir_bays):
            for ua, ub in zip(bays, bays[1:]):
                m.balustrade((ua, v + side * 0.3), (ub, v + side * 0.3), NE, (0, side), 1.2)
            for u in bays:
                m.pinnacle(u, v + side * 0.35, NE, 4.2, 0.35)
    # ---- the great roofs: nave and choir in one, the transept across, dormers, crestings
    m.gable_roof(13.8, AU, -HN, HN, NE, NR - NE, along="u", over=0.5, skip_gable=(0,))
    m.gable_roof(T0, T1, -TV, TV, NE, NR - NE, along="v", over=0.5)
    for u0, u1 in ((13.8, AU),):
        f = m.poly([(u0, 0, NR), (u1, 0, NR), (u1, 0, NR + 0.6), (u0, 0, NR + 0.6)], LEAD)
        m.orient(f, (0, 1, 0))
    f = m.poly([(74.6, -TV, NR), (74.6, TV, NR), (74.6, TV, NR + 0.6), (74.6, -TV, NR + 0.6)], LEAD)
    m.orient(f, (1, 0, 0))
    for side in (-1, 1):
        for ua, ub in list(zip(nave_bays, nave_bays[1:])) + list(zip(choir_bays, choir_bays[1:])):
            _dormer(m, (ua + ub) / 2, side, 33.2)
        for u in nave_bays[1:-1] + choir_bays[1:-1]:
            _dormer(m, u, side, 38.6, 1.1, 1.3)

    # ---- aisles: three on each side under a row of transverse hipped roofs
    # (the houses against the aisles' walls, built at the end: (s0, s1, depth, eaves); issue #10: an aisle window over the
    # hall is real above the house's roof where it meets the wall, painted below it, behind the house)
    north = [(9.3, 16.6, 5.0, 8.0), (16.8, 22.6, 8.0, 9.6), (22.7, 28.3, 8.1, 7.6), (28.4, 33.4, 8.2, 10.4), (33.5, 38.4, 8.4, 8.2),
             (38.5, 42.8, 8.6, 9.0), (42.9, 48.8, 9.2, 7.8), (48.9, 55.0, 9.2, 10.2), (55.1, 61.0, 9.2, 8.4), (61.1, 67.0, 9.2, 9.4),
             (82.2, 86.6, 5.3, 8.2), (86.7, 92.2, 5.3, 9.6), (92.3, 98.2, 5.3, 7.8)]
    south = [(41.5, 45.7, 4.3, 7.6), (45.8, 49.3, 4.3, 8.8), (49.4, 54.3, 7.6, 9.8), (54.4, 58.7, 7.6, 8.0), (58.8, 62.2, 7.6, 9.2),
             (62.3, 67.0, 7.6, 7.8)]

    def behind_houses(side, a, b):
        hs = [h for s0, s1, _, h in (north if side > 0 else south) if s0 < b - 0.05 and s1 > a + 0.05]
        return max(hs) + 0.15 if hs else None
    for side in (-1, 1):
        for i, (ua, ub) in enumerate(zip(nave_bays, nave_bays[1:])):
            _aisle_bay(m, ua, ub, side, real=f"the {sname[side]} outer aisle, bay {i + 1}, window",
                       clip=behind_houses(side, ua + 1.7, ub - 1.7))
        # (issue #26: the choir's third aisle is built inside now: its windows real too)
        for i, (ua, ub) in enumerate(zip(choir_bays, choir_bays[1:])):
            _aisle_bay(m, ua, ub, side, real=f"the choir's {sname[side]} outer aisle, bay {i + 1}, window",
                       clip=behind_houses(side, ua + 1.7, ub - 1.7))
        for u in nave_bays:
            _cbuttress(m, u, side)
        _cbuttress(m, choir_bays[0], side)
        _cbuttress(m, choir_bays[3], side)
        # east wall of the outer choir aisles
        va, vb = sorted((side * 13.0, side * VO))
        hole = _real_win(m, (AU, 0), (0, 1), (1, 0), min(side * 15.5, side * 23.5), max(side * 15.5, side * 23.5), 3.6, 13.6, "lancet",
                         arch_shape(0.72, 2), f"the choir's {sname[side]} outer aisle, its east wall, window")
        _cut_wall(m, (AU, 0), (0, 1), (1, 0), va, vb, 0, AE, [hole], shade=0.95)
        _plinth_run(m, (AU, 0), (0, 1), (1, 0), va, vb)
        _wb(m, (AU, 0), (0, 1), (1, 0), va, vb, 0.0, 0.3, AE - 0.55, AE, CARVED, 0.95)
        # the outer aisles beside the towers: their own west gable over the houses
        va, vb = sorted((side * 18.2, side * VO))
        # (issue #10: its window is real, the outer aisle's west bay behind it)
        hole = _real_win(m, (9.0, 0), (0, 1), (-1, 0), va + 1.8, vb - 1.8, 9.8, 15.6, "lancet", arch_shape(0.72, 2),
                         f"the {sname[side]} outer aisle's west gable, window")
        _cut_wall(m, (9.0, 0), (0, 1), (-1, 0), va, vb, 0, AE, [hole], shade=0.95)
        f = m.poly([(9.0, side * VO, 0), (13.8, side * VO, 0), (13.8, side * VO, AE), (9.0, side * VO, AE)], STONE, 0.95)
        m.orient(f, (0, side, 0))
        m.gable_roof(9.0, 13.8, va, vb, AE, (vb - va) / 2 * 1.25, along="u", over=0.3)
        m.pinnacle(9.0, side * 22.1, AE + (vb - va) / 2 * 1.25 - 0.3, 3.0, 0.3)
        # flying buttresses of the choir: outer pier, a pier in the aisle roof, the clerestory
        for u in choir_bays[1:3]:
            vo = side * VO
            va, vb = sorted((vo, vo + side * 1.4))
            m.box(u - 0.6, u + 0.6, va, vb, 0, 19.6, STONE, shade=0.95)
            m.pinnacle(u, vo + side * 0.7, 19.6, 5.6, 0.45)
            va, vb = sorted((side * 12.85, side * 13.75))
            m.box(u - 0.45, u + 0.45, va, vb, AE, 24.2, STONE)
            m.pinnacle(u, side * 13.3, 24.2, 4.4, 0.4)
            m.flyer((u, side * 26.0, 19.2), (u, side * 13.75, 22.6))
            m.flyer((u, side * 12.85, 24.0), (u, side * 6.7, 28.6))

    # ---- transept arms: side walls, facades with portal, great window and gable, stair turrets
    for side in (-1, 1):
        va, vb = sorted((side * HN, side * TV))
        for ue, sg in ((T0, -1), (T1, 1)):
            # M7: over the aisles only from their roofs up (below is inside the church)
            # (issue #10: the great window and the two high lancets are real, the transept's arm behind them)
            fs = "west" if sg < 0 else "east"
            s0, s1 = sorted((side * 27.0, side * 35.0))
            great = _real_win(m, (ue, 0), (0, 1), (sg, 0), s0, s1, 4.0, 27.8, "great_window", arch_shape(0.7, 3),
                              f"the {sname[side]} transept's {fs} wall, the great window")
            lancets = []
            for k, c0 in enumerate((9.0, 17.0)):
                s0, s1 = sorted((side * c0, side * (c0 + 4.2)))
                lancets.append(_real_win(m, (ue, 0), (0, 1), (sg, 0), s0, s1, 22.8, 29.2, "lancet", arch_shape(0.72, 2),
                                         f"the {sname[side]} transept's {fs} wall, over the aisles, lancet {k + 1}"))
            for a, b in (sorted((side * HN, side * VO)), sorted((side * VO, side * TV))):
                yb = AE if abs(a + b) / 2 < VO else 0
                _cut_wall(m, (ue, 0), (0, 1), (sg, 0), a, b, yb, NE, lancets if yb else [great])
                _wb(m, (ue, 0), (0, 1), (sg, 0), a, b, 0.0, 0.34, NE - 0.62, NE, CARVED, 0.95)
                if yb == 0:
                    _plinth_run(m, (ue, 0), (0, 1), (sg, 0), a, b)
                    _string(m, (ue, 0), (0, 1), (sg, 0), a, b, 3.6)
            m.balustrade((ue + sg * 0.3, va), (ue + sg * 0.3, vb), NE, (sg, 0), 1.2)
        tv_ = side * TV
        o = (0, side)
        Wt = ((0, tv_), (1, 0), o)
        # (issue #10: the great window over the portal is real, the transept's end behind it)
        great = _real_win(m, *Wt, 69.8, 79.4, 13.6, 28.8, "great_window", arch_shape(0.66, 3),
                          f"the {sname[side]} transept's front, the great window over the portal")
        _cut_wall(m, *Wt, T0, T1, 0, NE, [great], foot=[(74.6, 3.2, 12.0, 0.56)], shade=0.88)
        _cportal(m, *Wt, 74.6, 3.2, 1.75, 2.6, 12.0, 9.0, 0.56, 5.4, bands=4, trumeau=True, jamb=2,
                 door=f"cathedral, {'north' if side > 0 else 'south'} transept portal")
        _cwimperg(m, *Wt, 74.6, 3.5, 9.6, 16.6, off=0.35)
        for a, b in ((T0, 74.6 - 3.65), (74.6 + 3.65, T1)):
            _plinth_run(m, *Wt, a, b)
        _string(m, *Wt, T0, T1, 12.9, 0.22, 0.28)
        _wb(m, *Wt, T0, T1, 0.0, 0.34, NE - 0.62, NE, CARVED, 0.95)
        m.pinnacle(70.8, tv_ + side * 0.5, 9.5, 7.5, 0.35)
        m.pinnacle(78.4, tv_ + side * 0.5, 9.5, 7.5, 0.35)
        m.balustrade((T0, tv_ + side * 0.3), (T1, tv_ + side * 0.3), NE, o, 1.2)
        _gable3d(m, (0, tv_), (1, 0), o, T0, T1, NE, NR, statues=3, off=0.02)
        m.pinnacle(74.6, tv_, NR - 0.6, 4.6, 0.45)
        m.cross(74.6, tv_, NR + 3.9, 1.8, 0.5, 0.07, LEAD)
        for tu_ in (T0 + 1.5, T1 - 1.5):
            ring = m.ngon(tu_, tv_ + side * 0.8, 1.5, 8, math.pi / 8)
            m.tex_prism(ring, 0, NE + 3.0, "buttress", rep=4)
            m.prism(m.ngon(tu_, tv_ + side * 0.8, 1.65, 8, math.pi / 8), NE + 3.0, NE + 3.6, STONE, top=True)
            m.pyramid(m.ngon(tu_, tv_ + side * 0.8, 1.35, 8, math.pi / 8), NE + 3.6, NE + 12.0, STONE)
            m.balustrade_ring(m.ngon(tu_, tv_ + side * 0.8, 1.6, 8, math.pi / 8), NE + 3.6, 0.8, piece=2.0)

    # ---- crossing tower: a Gothic base, three lead tiers and the onion, cross on top
    cu = (T0 + T1) / 2

    def oc(r):
        return m.ngon(cu, 0, r, 8, math.pi / 8)
    m.prism(oc(6.2), 38.0, 44.0, STONE, top=False)
    # (issue #10: the lantern's eight windows are real, the hall's lantern and its painted dome behind them; the faces'
    # normals at 45 degrees from the east, turning north)
    _real_lantern(m, oc(6.2), 44.0, 50.5, ["north-east", "north", "north-west", "west", "south-west", "south", "south-east", "east"])
    m.prism(oc(6.45), 50.5, 51.0, STONE, top=True, top_mat=LEAD)
    m.balustrade_ring(oc(6.3), 51.0, 1.0, piece=2.5)
    for (pu, pv) in oc(6.4):
        m.pinnacle(pu, pv, 50.5, 4.2, 0.3)
    tiers = [(51.0, 54.8, 5.1), (55.8, 58.9, 4.2), (59.7, 62.3, 3.4)]
    for i, (y0, y1, r) in enumerate(tiers):
        m.tex_prism(oc(r), y0, y1, "tier")
        rn, yn = (tiers[i + 1][2], tiers[i + 1][0]) if i + 1 < len(tiers) else (2.75, y1 + 0.8)
        m.frustum(oc(r + 0.75), y1, oc(rn), yn, LEAD)
        f = m.poly([(p[0], p[1], y1) for p in oc(r + 0.75)], LEAD, 0.7)
        m.orient(f, (0, 0, -1))
    prof = [(2.75, 63.1), (3.35, 64.6), (3.45, 66.0), (3.0, 67.6), (2.0, 69.0), (1.0, 70.2), (0.4, 71.2)]
    for (ra, ya), (rb, yb) in zip(prof, prof[1:]):
        m.frustum(oc(ra), ya, oc(rb), yb, LEAD)
    m.pyramid(oc(0.4), 71.2, 72.6, LEAD)
    m.spike(cu, 0, 72.4, 73.8, 0.1, LEAD)
    m.prism(m.ngon(cu, 0, 0.28, 6), 73.8, 74.3, GILT, top=True)
    m.cross(cu, 0, 74.3, 1.9, 0.55, 0.07)

    # ---- the apse: five faces, windows, a half-cone roof, a cross at the east end of the ridge
    ap = [(AU + HN * math.cos(math.radians(-90 + 36 * i)), HN * math.sin(math.radians(-90 + 36 * i))) for i in range(6)]
    for i, (a, b) in enumerate(zip(ap, ap[1:])):
        mu, mv = (a[0] + b[0]) / 2 - AU, (a[1] + b[1]) / 2
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        d = ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)
        o = (mu / math.hypot(mu, mv), mv / math.hypot(mu, mv))
        # (issue #10: its window is real, the hall's apse behind it)
        hole = _real_win(m, a, d, o, 0.8, ln - 0.8, 21.0, 29.0, "lancet", arch_shape(0.75, 2),
                         f"the apse, the {('south', 'south-east', 'east', 'north-east', 'north')[i]} face, window")
        _cut_wall(m, a, d, o, 0.0, ln, 0, NE, [hole])
        _wb(m, a, d, o, 0.0, ln, 0.0, 0.34, NE - 0.62, NE, CARVED, 0.95)
        m.balustrade((a[0] + o[0] * 0.3, a[1] + o[1] * 0.3), (b[0] + o[0] * 0.3, b[1] + o[1] * 0.3), NE, o, 1.2, piece=4.0)
        f = m.poly([(a[0] + o[0] * 0.5, a[1] + o[1] * 0.5, NE - 0.2), (b[0] + o[0] * 0.5, b[1] + o[1] * 0.5, NE - 0.2), (AU, 0, NR)], SLATE)
        m.orient(f, (mu, mv, 1))
    for (pu, pv) in ap[1:-1]:
        m.pinnacle(pu + (pu - AU) * 0.06, pv * 1.06, NE, 4.2, 0.35)
    m.cross(AU, 0, NR - 0.3, 2.4, 0.6, 0.08)

    # ---- ambulatory: a lean-to ring round the apse
    RA = 13.0
    angs = [math.radians(-90 + 18 * i) for i in range(11)]
    CE = 12.0  # the chapels' walls' height
    for k, (a0, a1) in enumerate(zip(angs, angs[1:])):
        p0i, p1i = (AU + HN * math.cos(a0), HN * math.sin(a0)), (AU + HN * math.cos(a1), HN * math.sin(a1))
        p0o, p1o = (AU + RA * math.cos(a0), RA * math.sin(a0)), (AU + RA * math.cos(a1), RA * math.sin(a1))
        am = (a0 + a1) / 2
        # (issue #26: a chapel's mouth at each odd corner (-72, -36, 0, 36, 72): the wall open under the chapel's roof as far
        # as the chapel's side walls (s 3.1 from its axis), the hall's chapel behind it; the rest of the face whole)
        vo, ve = (p0o, p1o) if k % 2 else (p1o, p0o)
        t = 3.1 / (RA * math.sin(math.radians(18)))
        vc = (vo[0] + (ve[0] - vo[0]) * t, vo[1] + (ve[1] - vo[1]) * t)
        for pa, pb, y0 in ((vc, ve, 0.0), (vo, vc, CE)):
            f = m.poly([(pa[0], pa[1], y0), (pb[0], pb[1], y0), (pb[0], pb[1], AE), (pa[0], pa[1], AE)], STONE, 0.9)
            m.orient(f, (math.cos(am), math.sin(am), 0))
        f = m.poly([(p0o[0] + 0.3 * math.cos(a0), p0o[1] + 0.3 * math.sin(a0), AE - 0.1), (p1o[0] + 0.3 * math.cos(a1), p1o[1] + 0.3 * math.sin(a1), AE - 0.1),
                    (p1i[0], p1i[1], 21.2), (p0i[0], p0i[1], 21.2)], SLATE)
        m.orient(f, (math.cos(am), math.sin(am), 1))
    # five radiating chapels, each closed by five sides (issue #26: their windows real, the hall's chapels behind them)
    cname = {-72: "south", -36: "south-east", 0: "east", 36: "north-east", 72: "north"}
    for ad in (-72, -36, 0, 36, 72):
        a = math.radians(ad)
        e, q = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

        def P(r, s):
            return (AU + e[0] * r + q[0] * s, e[1] * r + q[1] * s)
        ring = [P(12.6, -3.1), P(15.0, -3.1), P(16.9, -2.2), P(17.6, 0), P(16.9, 2.2), P(15.0, 3.1), P(12.6, 3.1)]
        for i in range(len(ring) - 1):
            p0, p1 = ring[i], ring[i + 1]
            mu, mv = (p0[0] + p1[0]) / 2 - AU, (p0[1] + p1[1]) / 2
            if not 1 <= i <= 4:
                f = m.poly([(p0[0], p0[1], 0), (p1[0], p1[1], 0), (p1[0], p1[1], CE), (p0[0], p0[1], CE)], STONE, 0.95)
                m.orient(f, (mu, mv, 0))
            else:
                ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
                d = ((p1[0] - p0[0]) / ln, (p1[1] - p0[1]) / ln)
                o2 = (-d[1], d[0]) if (-d[1] * mu + d[0] * mv) > 0 else (d[1], -d[0])
                hole = _real_win(m, p0, d, o2, 0.35, ln - 0.35, 3.0, 10.4, "lancet", arch_shape(0.72, 2),
                                 f"the {cname[ad]} chapel off the ambulatory, window {i}")
                _cut_wall(m, p0, d, o2, 0.0, ln, 0, CE, [hole], shade=0.95)
                _plinth_run(m, p0, d, o2, 0.0, ln)
                _wb(m, p0, d, o2, 0.0, ln, 0.0, 0.3, CE - 0.5, CE, CARVED, 0.95)
        m.pyramid(ring, CE, CE + 5.2, SLATE)
        m.pinnacle(*P(15.4, 0), CE + 4.6, 2.6, 0.22)
    # the piers between the chapels and their two-flight flyers to the apse
    for ad in (-54, -18, 18, 54):
        a = math.radians(ad)
        e, q = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

        def P(r, s=0.0):
            return (AU + e[0] * r + q[0] * s, e[1] * r + q[1] * s)
        ring = [P(12.8, -0.55), P(17.4, -0.55), P(17.4, 0.55), P(12.8, 0.55)]
        m.prism(ring, 0, 18.8, STONE, top=True, shade=0.95)
        m.pinnacle(*P(16.6), 18.8, 5.4, 0.42)
        ring = [P(9.8, -0.42), P(10.6, -0.42), P(10.6, 0.42), P(9.8, 0.42)]
        m.prism(ring, 17.0, 23.8, STONE, top=True)
        m.pinnacle(*P(10.2), 23.8, 4.2, 0.36)
        m.flyer((*P(16.0), 18.6), (*P(10.6), 21.9))
        m.flyer((*P(9.8), 23.4), (*P(HN + 0.1), 28.2))

    # ---- west front between the towers: portal, great window, gallery, gable with statues
    fw = TVN - 6.0
    FU = 1.2  # the face of the portal bay, a little before the towers
    W_ = ((FU, 0), (0, 1), (-1, 0))
    # (issue #10: the great west window is real, the hall's tall west bay behind it; the doors of the central portal are
    # the hall's door: recorded at the doors' plane, 2.8 m in, up to the lintel over the leaves the game hangs there)
    great = _real_win(m, *W_, -5.0, 5.0, 23.8, 39.4, "great_window", arch_shape(0.64, 3), "the west front, the great west window")
    _cut_wall(m, *W_, -fw, fw, 0, 40.0, [great], foot=[(0.0, 4.9, 15.4, 0.56)], shade=0.88)
    _record(m, (FU + 2.8, 0), (0, 1), (-1, 0), 0.0, [(-2.55, 0.3), (2.55, 0.3), (2.55, 6.38), (-2.55, 6.38)], 0.1, "door",
            "the west front, the central portal's doors", glaze="")
    for sv in (-1, 1):  # the sides of the bay, back to the towers
        f = m.poly([(FU, sv * fw, 0), (TU - 6.0, sv * fw, 0), (TU - 6.0, sv * fw, 40.0), (FU, sv * fw, 40.0)], STONE, 0.9)
        m.orient(f, (0, sv, 0))
    _cportal(m, *W_, 0.0, 4.9, 2.55, 2.8, 15.4, 11.2, 0.56, 7.0, bands=5, trumeau=True, door="cathedral, central west portal", leaves=False,
             jamb=3)
    _cwimperg(m, *W_, 0.0, 5.2, 12.6, 21.6, off=0.4)
    for sv in (-1, 1):
        _plinth_run(m, *W_, min(sv * 5.35, sv * fw), max(sv * 5.35, sv * fw))
    _wb(m, *W_, -fw, fw, 0.0, 0.34, 21.7, 22.3, CARVED, 0.95)
    _wb(m, *W_, -fw, fw, 0.0, 0.34, 39.4, 40.0, CARVED, 0.95)
    for sv in (-1, 1):
        m.pinnacle(FU - 0.5, sv * 5.3, 12.8, 8.4, 0.38)
        m.decal(*W_, sv * 5.6 - 0.9, sv * 5.6 + 0.9, 23.5, 27.0, "niche", off=0.1)
    m.balustrade((FU - 0.3, -fw), (FU - 0.3, fw), 22.3, (-1, 0), 1.2)
    m.balustrade((FU - 0.3, -fw), (FU - 0.3, fw), 40.0, (-1, 0), 1.2)
    m.gable_roof(FU, 13.8, -fw, fw, 40.0, 11.5, along="u", over=0.0)
    _gable3d(m, *W_, -fw, fw, 40.0, 51.5, statues=3, off=0.02)
    m.pinnacle(FU, 0, 51.4, 4.2, 0.45)
    m.cross(FU, 0, 55.4, 1.6, 0.45, 0.07, LEAD)
    for sv in (-1, 1):
        m.pinnacle(FU - 0.2, sv * (fw - 0.2), 41.2, 4.6, 0.35)

    # ---- the towers
    _cath_tower(m, TU, TVN, north=True)
    _cath_tower(m, TU, -TVN, north=False)

    # ---- houses built against the church (the chapter let them between the buttresses)
    # (the houses' check, 2026-09-26: the church's own walls behind the houses as solids, for their backs and ends)
    for side in (-1, 1):
        m.reg([9.0, AU], [side * (VO - 1.0), side * VO], 0.0, AE)  # the outer aisle walls
        m.reg([9.0, 10.0], [side * 18.2, side * VO], 0.0, AE)  # the outer aisles' west walls, over the Handschoenmarkt
        m.reg([T0, T0 + 1.0], [side * VO, side * TV], 0.0, NE)  # the transept's west and east walls
        m.reg([T1 - 1.0, T1], [side * VO, side * TV], 0.0, NE)
    # the ground between the houses and the edge of the landmark's rectangle (the walk map counts the whole rectangle
    # as the church: nobody could walk up to these houses; world/cathedralOutside.ts opens these strips, less the
    # stone and the houses, with a walk area): north and south along the aisles and the choir, and the Handschoenmarkt
    # corners by the towers
    # (1.5 m past the rectangle's edge: the walk map's wall is the rectangle grown by its margin)
    HW = fr.W / 2 + 1.5
    m.strips = []
    for side in (-1, 1):
        for u0, u1 in ((9.0, T0), (T1, AU)):
            m.strips.append((u0, u1) + tuple(sorted((side * VO, side * HW))))
        m.strips.append((-1.5, 9.0) + tuple(sorted((side * 18.2, side * HW))))
    ground = _ground(lf, m)
    rows = []
    for side in (-1, 1):  # at the Handschoenmarkt, before the outer aisles
        s0, s1 = sorted((side * 18.5, side * 25.6))
        rows.append(((9.0, 0), (0, 1), (-1, 0), [(s0, s1, 5.6, 8.6, 3.6, 40 + side, True)]))
    # (the rows north and south: defined with the aisles above)
    rows.append(((0, VO), (1, 0), (0, 1), [(s0, s1, dp, h, 3.0 + (i % 3) * 0.5, i, i % 2 == 0) for i, (s0, s1, dp, h) in enumerate(north)]))
    rows.append(((0, -VO), (1, 0), (0, -1), [(s0, s1, dp, h, 3.2 + (i % 2) * 0.5, 20 + i, i % 2 == 1) for i, (s0, s1, dp, h) in enumerate(south)]))
    for p, d, o, row in rows:
        for s0, s1, dp, h, rise, idx, chim in row:
            others = [(q[0], q[1], q[2], q[3], q[4]) for q in row if q[5] != idx]
            _house2(m, p, d, o, s0, s1, dp, h, rise, idx, chimney=chim, row=others, ground=ground)
    m.check = check_houses(m, ground)
    m.walk = _open_ground(m)
    if os.environ.get("CATH_HOUSES_DUMP"):
        # (for the shots: each house's front middle, its ends and which way it looks, in world metres)
        out = []
        for q in m.parts:
            if q[1] != "body":
                continue
            p, d, o, s0, s1, E, h = q[3][:7]
            W_ = lambda s_, e_: [round(c, 2) for c in lf.w(*_wpt(p, d, o, s_, e_, 0))]  # noqa: E731
            f0, f1 = W_(s0, E), W_(s1, E)
            ox, _, oz = [a_ - b_ for a_, b_ in zip(W_(0, 1), W_(0, 0))]
            out.append({"idx": q[0], "s0": W_(s0, E), "s1": W_(s1, E), "mid": W_((s0 + s1) / 2, E), "out": [ox, oz], "h": h, "E": E,
                        "b0": W_(s0, 0), "b1": W_(s1, 0)})
        json.dump(out, open(os.environ["CATH_HOUSES_DUMP"], "w"), indent=0)
    print(f"[check houses] {len(m.check)} problem(s) with the houses against the cathedral")
    for idx, what, where in m.check:
        print(f"[check houses]   house {idx}: {what} at {where}")
    return m


# ------------------------------------------------------------------ the town hall


def stadhuis(fr):
    """Stadhuis (Cornelis Floris, 1561-65), as on the photographs of the 1870s-90s: a
    rusticated ground floor of round arches, two storeys of cross windows between Doric
    and Ionic pilasters, the open loggia under the eaves, a great hipped roof with dormers
    and tall chimneys, and the frontispiece in the middle: three arched doors, a balcony,
    niches and the arms, two stages above the roof with obelisks, the eagle on top.
    v > 0 is the Grote Markt."""
    cath_materials()
    m = CMesh(fr)
    L, W = fr.L, fr.W
    u0, u1 = -L / 2, L / 2
    vb, FV = -W / 2 + 2.0, W / 2  # back wall (the outline's notch aside), the frontispiece face
    vf = FV - 1.3  # the wings' face
    G, S2, LG, CO = 7.0, 20.8, 25.2, 26.0  # tops: ground floor, the two storeys, loggia, cornice
    FW = 6.4  # half width of the frontispiece
    IN = 1.6  # the loggia's back wall, set back from the face
    NB = 9  # bays in each wing
    bw = (u1 - FW - 0.0) / NB
    body = [(u0, vb), (u1, vb), (u1, vf), (u0, vf)]
    # M7 halls (the town hall in the world, docs/milestones/M7-halls-inworld.md): the body's walls one by one,
    # so that the front has a real doorway behind the main portal (the hall stands inside, client/src/world/
    # landmarkHalls.ts buildTownhall, shared/townhallPlan.ts) and the back is open into the stair block,
    # whose landing the hall's great stair comes up to (no face of the shell stands inside the hall)
    SB = 8.1  # the stair block's half width
    for pa, pb, out in (((u0, vb), (-SB, vb), (0, -1)), ((SB, vb), (u1, vb), (0, -1)), ((u1, vb), (u1, vf), (1, 0)), ((u0, vf), (u0, vb), (-1, 0))):
        f = m.poly([(pa[0], pa[1], 0), (pb[0], pb[1], 0), (pb[0], pb[1], S2), (pa[0], pa[1], S2)], STONE, 0.95)
        m.orient(f, (out[0], out[1], 0))
    _holed_wall(m, (0, vf), (1, 0), (0, 1), u0, u1, 0, S2, [(0.0, 1.4, 5.8, 0.6, True)], shade=0.95 / 0.88)
    f = m.poly([(p[0], p[1], S2) for p in body], LEAD, 0.95)
    m.orient(f, (0, 0, 1))
    # the stair block at the back, in the outline's notch (open to the body: its landing is the hall's)
    for pa, pb, out in (((-SB, -W / 2), (SB, -W / 2), (0, -1)), ((SB, -W / 2), (SB, vb), (1, 0)), ((-SB, vb), (-SB, -W / 2), (-1, 0))):
        f = m.poly([(pa[0], pa[1], 0), (pb[0], pb[1], 0), (pb[0], pb[1], S2 + 3.0), (pa[0], pa[1], S2 + 3.0)], STONE, 0.9)
        m.orient(f, (out[0], out[1], 0))
    m.hip_roof(-8.4, 8.4, -W / 2 - 0.3, vb + 0.3, S2 + 3.0, 3.5, SLATE)

    walls = [((0, vf), (1, 0), (0, 1), u0, u1), ((0, vb), (1, 0), (0, -1), u0, u1),
             ((u1, 0), (0, 1), (1, 0), vb, vf), ((u0, 0), (0, 1), (-1, 0), vb, vf)]
    for wi, (p, d, o, s0, s1) in enumerate(walls):
        n = max(1, round((s1 - s0) / bw))
        skip = set()
        if wi == 0:  # the frontispiece stands before the middle bays
            skip = {k for k in range(n) if abs(s0 + (k + 0.5) * (s1 - s0) / n) < FW + 0.2}
        _bays(m, p, d, o, s0, s1, n, 0.2, G - 0.3, "sh_arcade", inset=0.05, skip=skip)
        _bays(m, p, d, o, s0, s1, n, G + 0.2, S2 - 0.2, "sh_bay", inset=0.0, skip=skip)
        # string courses at the floors, projecting
        _wbox(m, p, d, o, s0 - 0.2, s1 + 0.2, 0, 0.35, G - 0.35, G, STONE, 1.05)
        _wbox(m, p, d, o, s0 - 0.2, s1 + 0.2, 0, 0.3, S2 - 0.3, S2, STONE, 1.05)
        if wi in (0, 2, 3):  # pilasters in relief on the three sides seen from the squares
            for k in range(n + 1):
                sk = s0 + k * (s1 - s0) / n
                if wi == 0 and abs(sk) < FW:
                    continue
                _wbox(m, p, d, o, sk - 0.28, sk + 0.28, 0, 0.22, G, S2 - 0.3, STONE, 1.08, top=False)
        # the loggia: its shaded back wall set back, columns and a balustrade at the face
        f = m.poly([_wpt(p, d, o, s0, -IN, S2), _wpt(p, d, o, s1, -IN, S2), _wpt(p, d, o, s1, -IN, LG), _wpt(p, d, o, s0, -IN, LG)], STONE, 0.6)
        m.orient(f, (o[0], o[1], 0))
        pl = _wpt(p, d, o, 0, -IN, 0)
        _bays(m, (pl[0], pl[1]), d, o, s0, s1, n, S2 + 0.1, LG - 0.3, "sh_loggia", inset=0.3, skip=skip)
        for k in range(n + 1):
            sk = s0 + k * (s1 - s0) / n
            if wi == 0 and abs(sk) < FW:
                continue
            _wbox(m, p, d, o, sk - 0.22, sk + 0.22, -0.45, 0.0, S2, LG, STONE, 1.05, top=False)
        for k in range(n):
            a, b = s0 + k * (s1 - s0) / n, s0 + (k + 1) * (s1 - s0) / n
            if k in skip:
                continue
            m.balustrade(_wpt(p, d, o, a + 0.22, 0.02, 0)[:2], _wpt(p, d, o, b - 0.22, 0.02, 0)[:2], S2, o, 1.0, piece=3.2)
    # the loggia's ceiling line and the cornice
    m.prism([(u0 - 0.45, vb - 0.45), (u1 + 0.45, vb - 0.45), (u1 + 0.45, vf + 0.45), (u0 - 0.45, vf + 0.45)], LG, CO, STONE, top=True,
            top_mat=LEAD, shade=1.05)
    # ---- the great hipped roof, dormers, chimneys
    RISE = 10.5
    m.hip_roof(u0 - 0.45, u1 + 0.45, vb - 0.45, vf + 0.45, CO, RISE, SLATE)
    vm = (vb + vf) / 2
    for side, (pv, ov) in ((1, (vf + 0.45, 1)), (-1, (vb - 0.45, -1))):
        P, D, O = (0, pv), (1, 0), (0, ov)
        run = abs(vm - pv)
        for k in range(10):
            s = u0 + 8.0 + k * (L - 16.0) / 9
            if side > 0 and abs(s) < FW + 1.5:
                continue
            _roof_dormer(m, P, D, O, s, 0.0, CO, -run, CO + RISE, CO + 2.2, 1.2, 1.7)
    hd = (vf - vb + 0.9) / 2
    for cu, cv in ((-25.0, vm + 2.5), (-13.0, vm - 2.5), (13.0, vm - 2.5), (25.0, vm + 2.5), (-19.0, vm - 3.0), (19.0, vm + 3.0)):
        ys = CO + RISE * min(vf + 0.45 - cv, cv - vb + 0.45, u1 + 0.45 - cu, cu - u0 + 0.45) / hd  # the roof there
        m.box(cu - 0.55, cu + 0.55, cv - 0.8, cv + 0.8, ys - 0.6, ys + 3.4, STONE, shade=0.95)
        m.box(cu - 0.7, cu + 0.7, cv - 0.95, cv + 0.95, ys + 3.4, ys + 3.8, STONE)

    # ---- the frontispiece
    Pf, Df, Of = (0, FV), (1, 0), (0, 1)
    # three round-arched doors in the ground floor; the middle one is the entrance
    _holed_wall(m, Pf, Df, Of, -FW, FW, 0, G, [(-3.6, 1.2, 5.2, 0.6, True), (0.0, 1.7, 6.2, 0.6, True), (3.6, 1.2, 5.2, 0.6, True)])
    # M7 halls: no leaves in the main portal: a real opening under the lintel; the game hangs its own (world/hallInWorld.ts)
    _portal(m, Pf, Df, Of, 0.0, 1.7, 1.4, 1.2, 6.2, 5.8, 0.6, 4.2, bands=3, rnd=True, door="town hall, main door", tymp="fanlight", leaves=False)
    for sc in (-3.6, 3.6):
        _portal(m, Pf, Df, Of, sc, 1.2, 1.0, 0.7, 5.2, 4.9, 0.6, 3.6, bands=2, rnd=True, steps=False,
                door=f"town hall, {'left' if sc < 0 else 'right'} side door (seen from the Grote Markt)", tymp="fanlight")
    for sg in (-1, 1):  # the returns of the frontispiece, back to the wings
        f = m.poly([(sg * FW, vf, 0), (sg * FW, FV, 0), (sg * FW, FV, LG), (sg * FW, vf, LG)], STONE, 0.9)
        m.orient(f, (sg, 0, 0))
    f = m.poly([(-FW, FV, G), (FW, FV, G), (FW, FV, LG), (-FW, FV, LG)], STONE)
    m.orient(f, (0, 1, 0))
    # the balcony on the first floor, three windows over it, niches and the arms under the cornice
    _wbox(m, Pf, Df, Of, -FW + 0.4, FW - 0.4, 0, 0.9, G - 0.4, G, STONE, 1.05)
    m.balustrade((-FW + 0.4, FV + 0.9), (FW - 0.4, FV + 0.9), G, Of, 1.0, piece=2.1)
    for k, sc in enumerate((-3.9, 0.0, 3.9)):
        m.decal(Pf, Df, Of, sc - 1.6, sc + 1.6, G + 0.2, S2 - 0.2, "sh_bay")
        m.decal(Pf, Df, Of, sc - 1.4, sc + 1.4, S2 + 0.2, LG - 0.2, "sh_loggia")
    for sc in (-FW + 0.3, -2.0, 2.0, FW - 0.3):  # engaged columns
        _wbox(m, Pf, Df, Of, sc - 0.3, sc + 0.3, 0, 0.45, G, LG, STONE, 1.1, top=False)
    # the stages over the roof: three bays with statues and the arms, then the Virgin's niche,
    # then a small aedicule under the eagle; obelisks at the corners of each stage
    stages = [(CO, CO + 6.5, FW), (CO + 6.5, CO + 12.0, 3.6), (CO + 12.0, CO + 16.0, 2.1)]
    for i, (y0, y1, hw) in enumerate(stages):
        dep = 3.2 - i * 0.6
        m.prism([(-hw, FV - dep), (hw, FV - dep), (hw, FV), (-hw, FV)], y0, y1, STONE, top=True, top_mat=LEAD, shade=1.0)
        _wbox(m, Pf, Df, Of, -hw - 0.25, hw + 0.25, -dep - 0.25, 0.3, y1 - 0.5, y1, STONE, 1.08, top=True)
        if i == 0:
            for sc, cell in ((-3.9, "niche"), (0.0, "arms"), (3.9, "niche")):
                m.decal(Pf, Df, Of, sc - 1.5, sc + 1.5, y0 + 0.8, y1 - 1.0, cell)
        elif i == 1:
            m.decal(Pf, Df, Of, -1.6, 1.6, y0 + 0.4, y1 - 0.8, "niche")
            for sg in (-1, 1):  # volutes stepping down to the stage below
                f = m.poly([(sg * hw, FV, y0), (sg * (hw + 2.4), FV, y0), (sg * hw, FV, y0 + 3.4)], STONE, 1.05)
                m.orient(f, (0, 1, 0))
        else:
            m.decal(Pf, Df, Of, -1.2, 1.2, y0 + 0.3, y1 - 0.4, "niche")
            f = m.poly([(-hw - 0.3, FV + 0.3, y1), (hw + 0.3, FV + 0.3, y1), (0, FV + 0.3, y1 + 1.8)], STONE, 1.05)
            m.orient(f, (0, 1, 0))
        for sg in (-1, 1):
            cu = sg * (stages[i - 1][2] - 0.6) if i > 0 else sg * (hw - 0.6)
            if i == 0:
                continue
            m.box(cu - 0.45, cu + 0.45, FV - 0.9, FV, y0, y0 + 1.0, STONE)
            m.pyramid(m.ngon(cu, FV - 0.45, 0.4, 4, math.pi / 4), y0 + 1.0, y0 + 6.5 - i, LEAD)
    # the gilt eagle on the top
    ye = stages[-1][1] + 1.8
    m.prism(m.ngon(0, FV - 0.5, 0.25, 6), ye, ye + 0.9, GILT, top=True)
    for sg in (-1, 1):
        f = m.poly([(sg * 0.2, FV - 0.5, ye + 0.5), (sg * 1.1, FV - 0.5, ye + 1.4), (sg * 0.9, FV - 0.5, ye + 0.6)], GILT)
        m.orient(f, (0, 1, 0))
    m.pyramid(m.ngon(0, FV - 0.5, 0.2, 4), ye + 0.9, ye + 1.3, GILT)
    return m


# ------------------------------------------------------------------ the butchers' hall


def vleeshuis(fr):
    """Vleeshuis (Herman de Waghemakere, 1501-04), after Schaefels' etching (1886) and the
    photographs: bands of red brick and white stone, tall pointed windows to the great hall,
    rows of small stone-framed windows above, buttresses, stepped gables between slender
    corner turrets, the big octagonal stair turret with its spire, a steep roof with dormers.
    Plan fitted to the outline: u along the hall, v < 0 the open side."""
    cath_materials()
    m = CMesh(fr)
    u0, u1, v0, v1 = -22.2, 22.2, -7.5, 9.0
    H = 17.0
    half = (v1 - v0) / 2
    vm = (v0 + v1) / 2
    RISE = half * math.tan(math.radians(58))
    bl = [-20.4, -15.3, -9.1, -2.8, 3.5, 9.7, 15.8, 20.4]  # buttress lines on the outline
    door_s = (bl[2] + bl[3]) / 2  # the main door, in the middle of the open side
    door_n = (bl[3] + bl[4]) / 2
    sides = [((0, v0), (1, 0), (0, -1), door_s, "Vleeshuis, main door"), ((0, v1), (1, 0), (0, 1), door_n, "Vleeshuis, north door")]
    for p, d, o, ds, dname in sides:
        _holed_wall(m, p, d, o, u0, u1, 0, H, [(ds, 1.5, 5.4, 0.62)], mat=BRICK, shade=1.1)
        _portal(m, p, d, o, ds, 1.5, 1.1, 0.9, 5.4, 4.8, 0.62, 3.4, bands=3, door=dname)
        for a, b in zip(bl, bl[1:]):
            c = (a + b) / 2
            if abs(c - ds) > 0.1:  # the hall windows
                m.decal(p, d, o, c - 1.3, c + 1.3, 1.6, 7.6, "lancet", arch_shape(0.72, 2))
            m.decal(p, d, o, c - 0.8, c + 0.8, 8.8, 16.2, "vh_upper")
        for s in bl[1:-1]:  # stepped buttresses
            _wbox(m, p, d, o, s - 0.5, s + 0.5, 0, 1.3, 0, 9.0, BRICK, 1.0)
            _wbox(m, p, d, o, s - 0.45, s + 0.45, 0, 0.8, 9.0, H - 0.6, BRICK, 1.0)
            _wbox(m, p, d, o, s - 0.5, s + 0.5, 0, 1.35, 8.6, 9.0, STONE, 1.1)
        _wbox(m, p, d, o, u0 - 0.2, u1 + 0.2, 0, 0.3, H - 0.4, H, STONE, 1.1)  # eaves cornice
    # the ends: pointed hall windows beside the middle pilaster, small windows, stepped gables
    for ue, sg in ((u0, -1), (u1, 1)):
        p, d, o = (ue, 0), (0, 1), (sg, 0)
        f = m.poly([(ue, v0, 0), (ue, v1, 0), (ue, v1, H), (ue, v0, H)], BRICK, 1.1)
        m.orient(f, (sg, 0, 0))
        for c in (vm - 4.0, vm + 4.0):
            m.decal(p, d, o, c - 1.4, c + 1.4, 1.6, 8.0, "lancet", arch_shape(0.72, 2))
            m.decal(p, d, o, c - 0.8, c + 0.8, 8.8, 16.2, "vh_upper")
        _wbox(m, p, d, o, 0.2, 1.3, 0, 1.1, 0, H + 3.0, BRICK)  # the middle pilaster of the outline
        loop = _stepgable(m, p, d, o, v0, v1, H, RISE + 0.6, steps=6, mat=BRICK, off=0.06, crown=1.6, shade=1.1)
        for k, (yy, n) in enumerate(((H + 2.2, 3), (H + 6.2, 2), (H + 10.2, 1))):
            for j in range(n):
                c = vm + (j - (n - 1) / 2) * 2.6
                m.decal(p, d, o, c - 0.55, c + 0.55, yy, yy + 2.2, "cross_window", off=0.1)
        for a, b in zip(loop[1:-2:2], loop[2:-1:2]):  # stone copings on the steps
            if abs(a[1] - b[1]) < 0.01:
                lo, hi = sorted((a[0], b[0]))
                _wbox(m, p, d, o, lo - 0.1, hi + 0.1, 0.0, 0.35, a[1] - 0.25, a[1], STONE, 1.1)
    # the steep roof, two rows of dormers each side, chimneys
    m.gable_roof(u0, u1, v0, v1, H, RISE, along="u", gable_mat=BRICK, over=0.35)
    for side, pv in ((-1, v0 - 0.35), (1, v1 + 0.35)):
        P, D, O = (0, pv), (1, 0), (0, side)
        for row, yb in enumerate((H + 2.0, H + 6.8)):
            for k in range(7 if row == 0 else 5):
                s = -18.0 + k * 6.0 if row == 0 else -15.0 + k * 7.5
                if row == 0 and side < 0 and abs(s - 3.5) < 3:
                    continue
                _roof_dormer(m, P, D, O, s, 0.0, H - 0.35 * RISE / half, -half - 0.35, H + RISE, yb, 1.1, 1.5)
    for cu in (-12.0, 12.0):
        m.box(cu - 0.5, cu + 0.5, vm + 1.5, vm + 2.5, H + 6, H + RISE - 1.5, BRICK)
    # corner turrets and the great stair turret on the open side
    for cu, cv in ((u0 - 0.1, v0 - 0.1), (u1 + 0.1, v0 - 0.1), (u0 - 0.1, v1 + 0.1), (u1 + 0.1, v1 + 0.1)):
        _octurret(m, cu, cv, 1.35, 0, H + 5.5, 7.5, BRICK, SLATE, slits=4)
    _octurret(m, 3.4, -8.9, 2.0, 0, H + 8.0, 10.0, BRICK, SLATE, slits=6)
    return m


# ------------------------------------------------------------------ the Vleeshuis as it stood in 1873 (M6)
#
# Sources (reference only; docs/milestones/M6-vleeshuis.md): J. Linnig's etching "Het Vleeschhuis" (1849,
# Rijksmuseum RP-P-1890-A-15650/1) and his drawing of 7 July 1855 (FelixArchief 12#2994), both CC0; J.-E.
# Durand's photographs "Vieilles-Boucheries" (Mediatheque de l'architecture et du patrimoine, before the
# restoration); the heritage inventory (Onroerend Erfgoed 4678) and today's photographs. In 1873 it was
# the wine merchant Peyrot's warehouse (the butchers sold it in 1841); the city bought it in 1899 and
# restored it in 1900-1922, so: no Weyns statues on the east buttress (1912), the older stepped wall
# dormers at the eaves, sooty bands, the Madonna with her gilt glory on the south-east tower.
#
# The frame: u along the hall (u0, world x -138, is the real east front on the Vleeshouwersstraat with
# its two doors; u1 the west gable to the Scheldt), v < 0 the south side with the octagonal stair tower.
# The walls are tiled with one atlas cell of the bands, cut at world heights, so the stripes run level
# round the whole building, its buttresses, towers and gables; the window cells paint the same bands
# round their frames and sit at whole bands (VP) so they line up.

VAT = 256
VATLAS = 7
VLEES_MATS = CATH_MATS + ["vleeshuis_atlas"]
VP = 0.48  # one band: 0.36 m of brick (three courses), 0.12 m of white Balegem sandstone; 25 px to the metre
VLEES_OPEN_DOORS = {"Vleeshuis, main door", "Vleeshuis, north door"}  # M7 halls: no leaves, walked through
VTW, VTH = 5.12, 3.84  # the wall cell in metres (128 x 96 px, eight bands): big, so the PS1 vertex snap bends the stripes seldom
VCELL = {
    "vh_wall": (128, 144, 128, 96),  # the bacon bands
    "vh_door": (64, 0, 64, 84),  # oak doors under a basket arch, iron straps, a wicket
    "vh_hall": (128, 0, 64, 144),  # a great pointed window of the hall: three lights, rings and daggers
    "vh_hall2": (192, 0, 64, 144),  # the same with flowing mouchettes
    "vh_cross": (0, 60, 48, 96),  # a cross window with a relieving arch, the bands round it
    "vh_cross2": (0, 156, 48, 96),  # the same, its lower lights shuttered (a warehouse in 1873)
    "vh_small": (48, 84, 32, 36),  # a small cross window of the gables and dormers
    "vh_small2": (80, 84, 32, 36),  # the same, shuttered
    "vh_slit": (112, 84, 16, 36),  # a narrow stair window of the towers
    "vh_madonna": (48, 120, 32, 64),  # the Madonna in her niche on the south-east tower, a gilt glory
    "vh_grille": (80, 120, 32, 24),  # a barred cellar window in the plinth
}
GABLET = [(0, 0), (1, 0), (1, 0.72), (0.5, 1), (0, 0.72)]
HALLARCH = arch_shape(0.62, 4)


def vuv(name, x, t):
    cx, cy, w, h = VCELL[name]
    e = 0.02
    return ((cx + e + x * (w - 2 * e)) / VAT, 1 - (cy + e + (1 - t) * (h - 2 * e)) / VAT)


def paint_vleeshuis_atlas():
    """The Vleeshuis atlas, drawn pixel by pixel (rows top-down, sRGB 0..1), 25 px to the metre."""
    import numpy as np

    rng = np.random.default_rng(1501)
    A = np.zeros((VAT, VAT, 3), np.float32)
    C = {k: np.array(v, np.float32) for k, v in {
        "brick": (0.50, 0.26, 0.19), "brick2": (0.43, 0.22, 0.17), "brick3": (0.56, 0.31, 0.22), "brick4": (0.37, 0.21, 0.20),
        "mortar": (0.47, 0.43, 0.38), "sand": (0.74, 0.70, 0.60), "hi": (0.80, 0.77, 0.67), "lo": (0.34, 0.31, 0.27),
        "glass": (0.07, 0.085, 0.11), "lead": (0.20, 0.20, 0.19), "glint": (0.25, 0.31, 0.37), "void": (0.06, 0.06, 0.07),
        "wood": (0.30, 0.20, 0.12), "wood2": (0.21, 0.14, 0.09), "iron": (0.10, 0.10, 0.11), "gold": (0.84, 0.66, 0.27),
        "white": (0.86, 0.84, 0.78), "shutter": (0.20, 0.24, 0.19), "blue": (0.34, 0.36, 0.40), "dstone": (0.40, 0.38, 0.35),
    }.items()}
    BR = [C["brick"], C["brick2"], C["brick3"], C["brick4"], C["brick"]]

    def cell(name):
        x, y, w, h = VCELL[name]
        return A[y:y + h, x:x + w]

    def grid(h, w):
        yy, xx = np.mgrid[0:h, 0:w]
        return xx + 0.5, yy + 0.5

    def noise(c, amt):
        c += (rng.random(c.shape[:2])[..., None] - 0.5) * amt

    def shape_mask(w, h, shape):
        xx, yy = grid(h, w)
        top = sorted({(round(p[0], 4), p[1]) for p in shape if p[1] > 0})
        return (1 - yy / h) <= np.interp(xx / w, np.array([p[0] for p in top]), np.array([p[1] for p in top]))

    def erode(mk, n=1):
        for _ in range(n):
            e = mk.copy()
            e[1:, :] &= mk[:-1, :]
            e[:-1, :] &= mk[1:, :]
            e[:, 1:] &= mk[:, :-1]
            e[:, :-1] &= mk[:, 1:]
            e[0, :] = e[-1, :] = False
            e[:, 0] = e[:, -1] = False
            mk = e
        return mk

    def line(c, x0, y0, x1, y1, col, mask=None, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(n + 1):
            x = int(round(x0 + (x1 - x0) * i / n))
            y = int(round(y0 + (y1 - y0) * i / n))
            for dx in range(w):
                if 0 <= y < c.shape[0] and 0 <= x + dx < c.shape[1] and (mask is None or mask[y, x + dx]):
                    c[y, x + dx] = col

    def stripes(c):
        """The bands, phased from the cell's foot: the bottom 3 px of every 12 are sandstone."""
        h, w = c.shape[:2]
        for r in range(h):
            k = (h - 1 - r) % 12
            band = (h - 1 - r) // 12
            if k < 3:
                c[r] = C["sand"] * (0.9 if k == 0 else 1.0)
                off = (band * 7) % 17
                for x in range(off, w, 17):
                    c[r, x] = C["mortar"] * 1.1
            else:
                j = k - 3
                course = j // 3
                if j % 3 == 2:
                    c[r] = C["mortar"]
                    continue
                off = (course * 3 + band * 2) % 5
                for x in range(w):
                    q = (x + off) // 5
                    if (x + off) % 5 == 4:
                        c[r, x] = C["mortar"]
                    else:
                        c[r, x] = BR[(q * 7 + course * 3 + band * 5) % 5] * (0.92 + 0.16 * ((q * 13 + band * 11 + course * 5) % 7) / 6)
        c *= (0.9 + 0.1 * rng.random((1, w, 1))).astype(np.float32)  # soot streaks run down the wall
        noise(c, 0.05)

    def leaded(g, dx=3, dy=4, diamond=False):
        h, w = g.shape[:2]
        g[:] = C["glass"]
        xx, yy = grid(h, w)
        if diamond:
            lead = (((xx + yy).astype(int) % 6) == 0) | (((xx - yy).astype(int) % 6) == 0)
        else:
            lead = ((xx.astype(int) % dx) == 0) | ((yy.astype(int) % dy) == 0)
        g[lead] = C["lead"]
        g[rng.random((h, w)) < 0.05] = C["glint"]

    # -- the wall: the bacon bands
    stripes(cell("vh_wall"))

    # -- the great hall windows: a sandstone frame, three lights, a transom, cusped heads, the tracery
    for name, variant in (("vh_hall", 0), ("vh_hall2", 1)):
        c = cell(name)
        h, w = c.shape[:2]
        mk = shape_mask(w, h, HALLARCH)
        c[:] = C["sand"]
        for y in range(0, h, 9):  # the jamb stones
            c[y, :] = C["sand"] * 0.86
        inner = erode(mk, 4)
        c[erode(mk, 3) & ~inner] = C["lo"]
        g = np.zeros_like(c)
        leaded(g, diamond=True)
        c[inner] = g[inner]
        spring = int(round(h * (1 - 0.62)))
        lw = (w - 8) / 3
        for k in (1, 2):
            mx = int(round(4 + k * lw))
            sub = c[spring - 4:h - 3, mx - 1:mx + 1]
            sub[inner[spring - 4:h - 3, mx - 1:mx + 1]] = C["sand"]
        ty = spring + int((h - 3 - spring) * 0.42)
        c[ty:ty + 2][inner[ty:ty + 2]] = C["sand"]
        am = shape_mask(int(lw), 12, arch_shape(0.3, 2))
        edge = am & ~erode(am)
        for k in range(3):  # the heads of the three lights
            lx = int(round(4 + k * lw))
            box = c[spring - 4:spring + 8, lx:lx + int(lw)]
            box[edge & inner[spring - 4:spring + 8, lx:lx + int(lw)]] = C["sand"]
        cx = w / 2
        if variant == 0:  # a great ring with a quatrefoil, two daggers over the lights
            xx, yy = grid(h, w)
            ring = (np.abs(np.hypot(xx - cx, yy - 27) - 10) < 1.1) & inner
            c[ring] = C["sand"]
            for qx, qy in ((cx - 4, 27), (cx + 4, 27), (cx, 23), (cx, 31)):
                c[(np.abs(np.hypot(xx - qx, yy - qy) - 3.4) < 0.8) & inner] = C["sand"]
            for sx in (-1, 1):
                c[(np.abs(np.hypot((xx - cx - sx * 15) / 0.7, yy - 44) - 6) < 1.0) & inner] = C["sand"]
                line(c, cx + sx * (w / 2 - 4 - lw), spring - 4, cx + sx * 9, 36, C["sand"], inner, 2)
        else:  # flowing mouchettes: two S curves from the mullions to the apex, a centre bar
            for sx in (-1, 1):
                pts = [(cx + sx * (lw / 2 + 12 * math.sin(math.pi * t) * (1 - t)), spring - 4 - t * (spring - 10)) for t in np.linspace(0, 1, 24)]
                for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                    line(c, x0, y0, x1, y1, C["sand"], inner, 2)
                xx, yy = grid(h, w)
                c[(np.abs(np.hypot((xx - cx - sx * 16) / 0.6, yy - 40) - 7) < 1.0) & inner] = C["sand"]
            line(c, cx - 1, spring - 4, cx - 1, 12, C["sand"], inner, 2)
        c[h - 3:] = C["sand"]
        c[h - 3] = C["lo"]
        noise(c, 0.04)

    # -- the doors: planked oak, two leaves, iron straps and studs, a wicket in the right leaf
    c = cell("vh_door")
    h, w = c.shape[:2]
    c[:] = C["wood"]
    c *= (0.9 + 0.2 * rng.random((1, w, 1))).astype(np.float32)
    c[:, ::5] = C["wood2"]
    c[:, 31:33] = C["void"]
    for y in (14, 38, 64):
        c[y:y + 2] = C["iron"]
        c[y + 5, 4:60:6] = C["iron"]
    c[40:80, 40] = C["iron"]
    c[40, 40:56] = C["iron"]
    c[40:80, 56] = C["iron"]
    c[58:60, 43:45] = C["gold"] * 0.6
    c[:3] = C["wood2"] * 0.6  # the shadow under the arch
    noise(c, 0.03)

    # -- cross windows with a profiled sandstone frame, a relieving arch, jamb stones
    for name, shut in (("vh_cross", False), ("vh_cross2", True)):
        c = cell(name)
        stripes(c)
        h, w = c.shape[:2]
        x0, x1, y0, y1 = 6, 42, 20, 90
        xc, hw = (x0 + x1) / 2, (x1 - x0) / 2 + 3
        for x in range(x0 - 3, x1 + 3):  # the relieving arch: a flat arch of sandstone and brick voussoirs
            ya = y0 - 1 - 4 * (1 - ((x + 0.5 - xc) / hw) ** 2)
            col = C["sand"] if (x // 4) % 2 == 0 else C["brick2"] * 1.1
            c[int(ya) - 2:int(ya), x] = col
            c[int(ya), x] = C["mortar"] * 0.8
        for k, y in enumerate(range(y0, y1, 6)):  # the jamb stones, long and short
            ln = 5 if k % 2 == 0 else 3
            c[y:y + 5, x0 - ln:x0] = C["sand"]
            c[y:y + 5, x1:x1 + ln] = C["sand"]
            c[y + 5, x0 - ln:x1 + ln] = C["mortar"]
        c[y0:y1, x0:x1] = C["sand"]
        c[y0 + 1:y1 - 1, x0 + 1] = C["lo"]
        ty = y0 + int((y1 - y0) * 0.38)
        g = c[y0 + 3:y1 - 3, x0 + 3:x1 - 3]
        leaded(g)
        if shut:  # the lower lights shuttered: planks in a frame
            s = c[ty + 2:y1 - 3, x0 + 3:x1 - 3]
            s[:] = C["shutter"]
            s[:, ::3] = C["shutter"] * 0.7
            s[:2] = C["shutter"] * 1.3
        c[y0:y1, int(xc) - 1:int(xc) + 1] = C["sand"]
        c[ty:ty + 2, x0:x1] = C["sand"]
        c[y1:y1 + 2, x0 - 3:x1 + 3] = C["hi"]
        c[y1 + 2, x0 - 3:x1 + 3] = C["lo"]
        noise(c, 0.03)

    for name, shut in (("vh_small", False), ("vh_small2", True)):
        c = cell(name)
        stripes(c)
        x0, x1, y0, y1 = 5, 27, 6, 32
        c[y0 - 2:y0, x0 - 2:x1 + 2] = C["sand"]
        c[y0:y1, x0:x1] = C["sand"]
        g = c[y0 + 2:y1 - 2, x0 + 2:x1 - 2]
        leaded(g)
        ty = y0 + 10
        if shut:
            c[ty:y1 - 2, x0 + 2:x1 - 2] = C["shutter"]
            c[ty:y1 - 2, x0 + 2:x1 - 2:3] = C["shutter"] * 0.7
        c[y0:y1, 15:17] = C["sand"]
        c[ty:ty + 2, x0:x1] = C["sand"]
        c[y1:y1 + 2, x0 - 2:x1 + 2] = C["hi"]
        noise(c, 0.03)

    c = cell("vh_slit")
    stripes(c)
    c[4:34, 3:13] = C["sand"]
    c[6:32, 5:11] = C["void"]
    c[6:32, 7:9] = C["glass"]
    c[6:32, 8] = C["iron"]
    c[18, 5:11] = C["iron"]
    noise(c, 0.03)

    # -- the Madonna: crowned, the Child on her arm, a gilt glory, in a niche under a gablet with crockets
    c = cell("vh_madonna")
    h, w = c.shape[:2]
    mk = shape_mask(w, h, GABLET)
    c[:] = C["sand"]
    inner = erode(mk, 3)
    c[inner] = C["lo"] * 0.55
    xx, yy = grid(h, w)
    ang = np.arctan2(yy - 30, xx - 16)
    rays = (np.hypot(xx - 16, yy - 30) < 14) & ((np.floor(ang * 16 / math.pi) % 2) == 0) & inner
    c[rays] = C["gold"]
    robe = (yy >= 19) & (yy <= 52) & (np.abs(xx - 16) <= 3 + (yy - 19) * 0.14) & inner
    c[robe] = C["white"] * 0.95
    c[robe & (xx > 17)] = C["white"] * 0.8
    c[np.hypot(xx - 16, yy - 16) <= 3.2] = C["white"]
    c[(yy >= 11) & (yy <= 13) & (np.abs(xx - 16) <= 3)] = C["gold"]
    c[np.hypot(xx - 20, yy - 25) <= 2.2] = C["white"]
    c[(np.abs(xx - 20) <= 2) & (yy > 26) & (yy < 32)] = C["white"] * 0.9
    c[52:57, 8:24] = C["hi"]
    c[57:60, 11:21] = C["hi"] * 0.9
    for k in range(5):  # crockets on the gablet
        y = int(h * 0.28 * (1 - k / 5)) + 1
        c[y, max(0, 16 - int(16 * (1 - k / 5)) - 1)] = C["hi"]
        c[y, min(w - 1, 16 + int(16 * (1 - k / 5)))] = C["hi"]
    noise(c, 0.03)

    c = cell("vh_grille")
    c[:] = C["dstone"]
    for y in range(0, 24, 8):
        c[y] = C["dstone"] * 0.8
        for x in range((y // 8 % 2) * 7, 32, 14):
            c[y:y + 8, x] = C["dstone"] * 0.8
    c[4:21, 5:27] = C["blue"] * 1.1
    c[6:19, 7:25] = C["void"]
    c[6:19, 8:25:4] = C["iron"] * 2
    noise(c, 0.04)
    return np.clip(A, 0, 1)


def vleeshuis_materials():
    if "vleeshuis_atlas" in bpy.data.materials:
        return
    import numpy as np

    px = paint_vleeshuis_atlas()
    img = bpy.data.images.new("vleeshuis_atlas", VAT, VAT, alpha=False)
    rgba = np.ones((VAT, VAT, 4), np.float32)
    rgba[..., :3] = np.flipud(px)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    mt = bpy.data.materials.new("vleeshuis_atlas")
    nt = mt.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    mt.diffuse_color = (0.55, 0.32, 0.25, 1)


class VMesh(CMesh):
    """The Vleeshuis: the cathedral mesh plus its own atlas, a stone tint and a little per-face weathering."""

    mats = VLEES_MATS

    def __init__(self, frame):
        super().__init__(frame)
        import random

        self.rng = random.Random(1501)
        self.tint = (1.0, 1.0, 1.0)
        self.jit = 0.0

    def poly(self, pts, mat, shade=1.0):
        if mat in (STONE, VATLAS, BRICK) and self.jit:
            shade *= 1 + self.rng.uniform(-self.jit, self.jit)
        f = Mesh.poly(self, pts, mat, shade)
        if f is not None and mat in (STONE, VATLAS) and self.tint != (1.0, 1.0, 1.0):
            for loop in f.loops:
                c = loop[self.col]
                loop[self.col] = (c[0] * self.tint[0], c[1] * self.tint[1], c[2] * self.tint[2], 1.0)
        return f

    def tex(self, pts, cell, shape=RECT, shade=1.0, out=None):
        if cell in VCELL:
            return self.upoly(pts, [vuv(cell, x, t) for x, t in shape], VATLAS, shade, out)
        return super().tex(pts, cell, shape, shade, out)


def vleeshuis2(fr):
    """The Vleeshuis in 1873 (M6, Steve 2026-09-24: "Give Vleeshuis an upgrade, more detail."): the hall of
    1501-04 by Herman de Waghemakere in bands of red brick and white sandstone on a dark stone plinth; seven
    bays of buttresses along each side, great pointed windows with tracery to the hall, cross windows above,
    stepped wall dormers at the eaves and small dormers in the steep slate roof; the stepped east and west
    gables with their coped steps and rows of small windows; a hexagonal corbelled stair turret at each
    corner (the south-east one the biggest, with the Madonna) and the tall octagonal stair tower out of the
    south side, all under kinked slate spires with iron vanes; two doors under basket arches in bluestone
    frames on the east front and one on each long side. The outline, the doors of the long sides and the
    buttress lines are those of the old model (the walk map's outline from OpenStreetMap)."""
    cath_materials()
    vleeshuis_materials()
    m = VMesh(fr)
    u0, u1, v0, v1 = -22.2, 22.2, -7.5, 9.0
    H = 16.8  # the eaves: 35 bands
    half, vm = (v1 - v0) / 2, (v0 + v1) / 2
    SLOPE = 1.6  # the roof, 58 degrees
    RISE = half * SLOPE
    PL = 1.2  # the top of the plinth
    SC = 9.6  # the drip course between the two storeys
    SAND, BLUE, DARK = (1.0, 0.97, 0.88), (0.64, 0.68, 0.76), (0.56, 0.54, 0.55)
    bl = [-20.4, -15.3, -9.1, -2.8, 3.5, 9.7, 15.8, 20.4]  # buttress lines on the outline (the ends are the towers)
    door_s, door_n = (bl[2] + bl[3]) / 2, (bl[3] + bl[4]) / 2
    TWR = (3.4, -8.58, 1.88)  # the octagonal stair tower out of the south side

    def st(t=(1.0, 1.0, 1.0), jit=0.04):
        m.tint, m.jit = t, jit

    def W(fr_, s, e, y):
        p, d, o = fr_
        return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)

    def wall_rect(fr_, s0, s1, y0, y1, e=0.0, shade=1.0):
        """Wall from s0 to s1, y0 to y1, tiled with the bands: cut where the world height crosses a whole
        wall cell, so the stripes stay level everywhere."""
        if s1 - s0 < 1e-3 or y1 - y0 < 1e-3:
            return
        o = fr_[2]
        n = max(1, math.ceil((s1 - s0) / VTW - 1e-6))
        cuts = [y0] + [k * VTH for k in range(math.floor(y0 / VTH) + 1, math.ceil(y1 / VTH)) if y0 + 1e-6 < k * VTH < y1 - 1e-6] + [y1]
        for i in range(n):
            a, b = s0 + (s1 - s0) * i / n, s0 + (s1 - s0) * (i + 1) / n
            fw = (b - a) / VTW
            xa = m.rng.uniform(0, 1 - fw) if fw < 0.98 else 0.0
            for ya, yb in zip(cuts, cuts[1:]):
                k = math.floor((ya + 1e-6) / VTH)
                ta, tb = ya / VTH - k, yb / VTH - k
                m.upoly([W(fr_, a, e, ya), W(fr_, b, e, ya), W(fr_, b, e, yb), W(fr_, a, e, yb)],
                        [vuv("vh_wall", xa, ta), vuv("vh_wall", xa + fw, ta), vuv("vh_wall", xa + fw, tb), vuv("vh_wall", xa, tb)],
                        VATLAS, shade, (o[0], o[1], 0))

    def wall_poly(fr_, pts, e=0.0, shade=1.0):
        """A wall polygon inside one wall cell (a spandrel, a cheek), UVs by position."""
        o = fr_[2]
        k = math.floor((min(y for _, y in pts) + 1e-6) / VTH)
        s0 = min(s for s, _ in pts)
        m.upoly([W(fr_, s, e, y) for s, y in pts], [vuv("vh_wall", (s - s0) / VTW, y / VTH - k) for s, y in pts], VATLAS, shade, (o[0], o[1], 0))

    def plinth(fr_, s0, s1, proj=0.12):
        """The dark stone plinth with its chamfered top."""
        o = fr_[2]
        st(DARK, 0.06)
        m.orient(m.poly([W(fr_, s0, proj, 0), W(fr_, s1, proj, 0), W(fr_, s1, proj, PL), W(fr_, s0, proj, PL)], STONE, 0.72), (o[0], o[1], 0))
        m.orient(m.poly([W(fr_, s0, proj, PL), W(fr_, s1, proj, PL), W(fr_, s1, 0, PL + 0.16), W(fr_, s0, 0, PL + 0.16)], STONE, 0.9), (o[0], o[1], 1))
        st()

    def box(fr_, s0, s1, e0, e1, y0, y1, tint, shade=1.05, top=True):
        st(tint, 0.03)
        p, d, o = fr_
        _wbox(m, p, d, o, s0, s1, e0, e1, y0, y1, STONE, shade, top=top)
        st()

    def side_frames(fr_, sa, sb):
        """The two side faces of something standing out of a wall between sa and sb."""
        p, d, o = fr_
        pa, pb = W(fr_, sa, 0, 0), W(fr_, sb, 0, 0)
        return ((pa[0], pa[1]), o, (-d[0], -d[1])), ((pb[0], pb[1]), o, d)

    def door(fr_, sc, hw, h, depth, name, y1):
        """A doorway under a basket arch: the wall over it up to y1, reveals, the oak doors, a bluestone
        frame and hood, a step. The door is noted at the back of the reveal, as the old model's portal did.
        The arch's springing must lie in the wall cell that holds its crown (h 3.36: 2.55 and 3.36)."""
        p, d, o = fr_
        top = [((x - 0.5) * 2 * hw, t * h) for x, t in DOOR4[2:]]  # right spring over the top to the left spring
        path = [(-hw, 0.0)] + list(reversed(top)) + [(hw, 0.0)]
        band = math.ceil(h / VTH) * VTH
        wall_rect(fr_, sc - hw, sc + hw, band, y1)
        wall_poly(fr_, [(sc + s, y) for s, y in reversed(top)] + [(sc + hw, band), (sc - hw, band)])
        st(BLUE, 0.03)
        for (sa, ya), (sb, yb) in zip(path, path[1:]):
            sm, ym = (sa + sb) / 2, (ya + yb) / 2
            f = m.poly([W(fr_, sc + sa, 0, ya), W(fr_, sc + sb, 0, yb), W(fr_, sc + sb, -depth, yb), W(fr_, sc + sa, -depth, ya)], STONE, 0.55)
            m.orient(f, (-d[0] * sm, -d[1] * sm, (0.4 * h - ym) * 0.5))
        outer = [((x - 0.5) * 2 * (hw + 0.22), t * (h + 0.22)) for x, t in DOOR4[2:]]
        opath = [(-hw - 0.22, 0.0)] + list(reversed(outer)) + [(hw + 0.22, 0.0)]
        for (sa, ya), (sb, yb), (sc_, yc), (sd, yd) in zip(path, path[1:], opath[1:], opath):
            f = m.poly([W(fr_, sc + sa, 0.05, ya), W(fr_, sc + sb, 0.05, yb), W(fr_, sc + sc_, 0.05, yc), W(fr_, sc + sd, 0.05, yd)], STONE, 0.95)
            m.orient(f, (o[0], o[1], 0))
        st()
        # M7 halls (the Vleeshuis in the world): the two doors of the long sides are real openings (the hall stands
        # inside, client/src/world/landmarkHalls.ts buildVleeshuis, shared/vleeshuisPlan.ts; the game hangs its own leaves)
        if name not in VLEES_OPEN_DOORS:
            m.tex([W(fr_, sc + (x - 0.5) * 2 * hw, -depth, t * h) for x, t in DOOR4], "vh_door", DOOR4, 0.85, (o[0], o[1], 0))
        box(fr_, sc - hw - 0.4, sc + hw + 0.4, 0.0, 0.2, h + 0.22, h + 0.4, BLUE, 1.0)  # the hood
        box(fr_, sc - hw - 0.3, sc + hw + 0.3, -depth, 0.35, 0.0, 0.16, BLUE, 0.8)  # the step
        m.door(name, W(fr_, sc, -depth, 0))

    def wall(fr_, s0, s1, y1, doors=()):
        """A stretch of wall from the plinth up to y1, with doorways (sc, hw, h, depth, name) cut in it."""
        x, px = s0, s0
        for sc, hw, h, depth, name in sorted(doors):
            wall_rect(fr_, x, sc - hw, PL, y1)
            plinth(fr_, px, sc - hw - 0.22)
            door(fr_, sc, hw, h, depth, name, y1)
            x, px = sc + hw, sc + hw + 0.22
        wall_rect(fr_, x, s1, PL, y1)
        plinth(fr_, px, s1)

    def buttress(fr_, s, w0, e0, w1, e1, ya, yb, yc, yd=None, pin=None):
        """A stepped buttress: the plinth, a striped lower stage, a sloped sandstone water table, a
        narrower upper stage, a sloped cap into the wall (yd) or a pinnacle (pin: height)."""
        box(fr_, s - w0 - 0.06, s + w0 + 0.06, 0.0, e0 + 0.06, 0.0, PL, DARK, 0.75, top=False)
        for (y0, y1, w, e) in ((PL, ya, w0, e0), (yb, yc, w1, e1)):
            wall_rect(fr_, s - w, s + w, y0, y1, e=e)
            for sf in side_frames(fr_, s - w, s + w):
                wall_rect(sf, 0.0, e, y0, y1)
        st(SAND, 0.03)
        for (y0, y1, wa, ea, wb, eb) in ((ya, yb, w0, e0, w1, e1),) + (((yc, yd, w1, e1, w1, 0.0),) if yd else ()):
            ww = wa + 0.05
            f = m.poly([W(fr_, s - ww, ea + 0.05, y0), W(fr_, s + ww, ea + 0.05, y0), W(fr_, s + ww, eb, y1), W(fr_, s - ww, eb, y1)], STONE, 1.05)
            m.orient(f, (fr_[2][0], fr_[2][1], 1))
            for sg in (-1, 1):
                f = m.poly([W(fr_, s + sg * ww, ea + 0.05, y0), W(fr_, s + sg * ww, eb, y1), W(fr_, s + sg * ww, eb, y0)], STONE, 0.9)
                m.orient(f, (fr_[1][0] * sg, fr_[1][1] * sg, 0))
        # the drip course wraps round the upper stage
        box(fr_, s - w1 - 0.14, s + w1 + 0.14, 0.0, e1 + 0.14, SC, SC + 0.22, SAND, 1.08)
        if pin:
            box(fr_, s - w1 - 0.1, s + w1 + 0.1, -0.1, e1 + 0.1, yc, yc + 0.25, SAND, 1.08)
            c = W(fr_, s, e1 / 2, 0)
            st(SAND, 0.03)
            m.pinnacle(c[0], c[1], yc + 0.25, pin, w1 * 0.85)
            st()
        st()

    def stepped(fr_, s0, s1, y0, steps, hs, crown, thick, cope=0.16):
        """A stepped gable with thickness standing on a wall top: striped rows, plain brick step ends and
        back, a sandstone coping on every step. Returns the rows (s from, s to, y from, y to)."""
        p, d, o = fr_
        w = (s1 - s0) / (2 * steps + 1)
        rows = []
        for k in range(steps + 1):
            ya = y0 + k * hs
            yb = y0 + (k + 1) * hs if k < steps else y0 + steps * hs + crown
            rows.append((s0 + k * w, s1 - k * w, ya, yb))
        st(jit=0.03)
        for a, b, ya, yb in rows:
            wall_rect(fr_, a, b, ya, yb)
            for sx, sg in ((a, -1), (b, 1)):
                f = m.poly([W(fr_, sx, 0, ya), W(fr_, sx, -thick, ya), W(fr_, sx, -thick, yb), W(fr_, sx, 0, yb)], BRICK, 0.9)
                m.orient(f, (d[0] * sg, d[1] * sg, 0))
        left = [(s0, y0), (s0, rows[0][3])]
        for a, b, ya, yb in rows[1:]:
            left += [(a, ya), (a, yb)]
        loop = left + [(s0 + s1 - s, y) for s, y in reversed(left)]
        m.orient(m.poly([W(fr_, s, -thick, y) for s, y in loop], BRICK, 0.8), (-o[0], -o[1], 0))
        st()
        for k in range(steps):
            a0, b0, _, yk = rows[k]
            a1, b1 = rows[k + 1][0], rows[k + 1][1]
            for lo, hi in ((a0, a1), (b1, b0)):
                box(fr_, lo - 0.05, hi + 0.05, -thick - 0.05, 0.08, yk, yk + cope, SAND, 1.08)
        a, b, _, yt = rows[-1]
        box(fr_, a - 0.05, b + 0.05, -thick - 0.05, 0.08, yt, yt + cope, SAND, 1.08)
        return rows

    def ngon_faces(cu, cv, r, sides, rot, y0, y1, skip_inside=True, plinth_=False):
        rg = m.ngon(cu, cv, r, sides, rot)
        for i in range(sides):
            a, b = rg[i], rg[(i + 1) % sides]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if skip_inside and u0 + 0.05 < mid[0] < u1 - 0.05 and v0 + 0.05 < mid[1] < v1 - 0.05:
                continue
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            on = math.hypot(mid[0] - cu, mid[1] - cv)
            fr_ = (a, ((b[0] - a[0]) / L, (b[1] - a[1]) / L), ((mid[0] - cu) / on, (mid[1] - cv) / on))
            if plinth_:
                st(DARK, 0.06)
                m.orient(m.poly([W(fr_, 0, 0, y0), W(fr_, L, 0, y0), W(fr_, L, 0, y1), W(fr_, 0, 0, y1)], STONE, 0.72), (fr_[2][0], fr_[2][1], 0))
                st()
            else:
                wall_rect(fr_, 0, L, y0, y1)

    def tface(cu, cv, r, sides, rot, ang):
        """The face of a tower nearest a direction: a point on it, along, out, its width."""
        k = round(((ang - rot) * sides / math.pi - 1) / 2) % sides
        a = rot + (2 * k + 1) * math.pi / sides
        o = (math.cos(a), math.sin(a))
        rr = r * math.cos(math.pi / sides)
        return (cu + o[0] * rr, cv + o[1] * rr), (-o[1], o[0]), o, 2 * r * math.sin(math.pi / sides)

    def tower(cu, cv, r, sides, rot, yb, yt, apex, wins=(), top_wins=()):
        """A corbelled stair turret: the plinth, a striped shaft to yb, a sandstone corbel ring, the wider
        top stage to yt (whole, above the roofs), a corbel table and cornice, a kinked slate spire, a vane."""
        ngon_faces(cu, cv, r + 0.1, sides, rot, 0.0, PL, plinth_=True)
        ngon_faces(cu, cv, r, sides, rot, PL, min(yb, H))
        if yb > H:  # above the eaves the shaft shows all round
            ngon_faces(cu, cv, r, sides, rot, H, yb, skip_inside=False)
        R2 = r + 0.22
        st(SAND, 0.03)
        m.frustum(m.ngon(cu, cv, r, sides, rot), yb, m.ngon(cu, cv, R2, sides, rot), yb + 0.45, STONE, 1.02)
        st()
        ngon_faces(cu, cv, R2, sides, rot, yb + 0.45, yt, skip_inside=False)
        st(SAND, 0.03)
        m.frustum(m.ngon(cu, cv, R2, sides, rot), yt, m.ngon(cu, cv, R2 + 0.2, sides, rot), yt + 0.35, STONE, 1.0)
        m.prism(m.ngon(cu, cv, R2 + 0.2, sides, rot), yt + 0.35, yt + 0.55, STONE, top=False, shade=1.08)
        for q in m.ngon(cu, cv, R2 + 0.02, sides, rot):  # white stone quoins on the corners of the top stage
            m.box(q[0] - 0.09, q[0] + 0.09, q[1] - 0.09, q[1] + 0.09, yb + 0.45, yt, STONE, top=False, shade=1.1)
        st()
        yk = yt + 0.55 + 0.9
        m.frustum(m.ngon(cu, cv, R2 + 0.5, sides, rot), yt + 0.45, m.ngon(cu, cv, r * 0.66, sides, rot), yk, SLATE)
        m.pyramid(m.ngon(cu, cv, r * 0.66, sides, rot), yk, apex, SLATE)
        m.box(cu - 0.04, cu + 0.04, cv - 0.04, cv + 0.04, apex - 0.3, apex + 1.6, LEAD)
        m.prism(m.ngon(cu, cv, 0.1, 6), apex + 0.3, apex + 0.5, LEAD, top=True)
        m.box(cu - 0.015, cu + 0.015, cv, cv + 0.62, apex + 1.0, apex + 1.36, LEAD)
        for ang, y0, cl, w, hh in wins:
            pt, d, o, fw = tface(cu, cv, r, sides, rot, ang)
            m.decal(pt, d, o, -w / 2, w / 2, y0, y0 + hh, cl, GABLET if cl == "vh_madonna" else RECT, off=0.05)
        yw = math.ceil((yb + 0.7) / VP) * VP  # on a whole band, so the cell's stripes meet the wall's
        for ang in top_wins:
            pt, d, o, fw = tface(cu, cv, R2, sides, rot, ang)
            m.decal(pt, d, o, -0.46, 0.46, yw, yw + 1.44, "vh_small", off=0.05)

    S = ((0, v0), (1, 0), (0, -1))  # the south side (the open side)
    N = ((0, v1), (1, 0), (0, 1))  # the north side
    E = ((u0, 0), (0, 1), (-1, 0))  # the east front, on the Vleeshouwersstraat
    Wf = ((u1, 0), (0, 1), (1, 0))  # the west gable, to the Scheldt

    # ---- the long sides: seven bays between buttresses
    segs = [u0] + bl[1:-1] + [u1]
    for fr_, side, dn in ((S, -1, (door_s, "Vleeshuis, main door")), (N, 1, (door_n, "Vleeshuis, north door"))):
        for a, b in zip(segs, segs[1:]):
            ds = [(dn[0], 0.9, 3.36, 0.9, dn[1])] if a < dn[0] < b else []
            wall(fr_, a, b, H, ds)
        for i, (a, b) in enumerate(zip(bl, bl[1:])):
            c = (a + b) / 2
            is_door = abs(c - dn[0]) < 0.1
            if is_door:
                m.decal(*fr_, c - 1.1, c + 1.1, 4.32, 9.36, "vh_hall2" if i % 2 else "vh_hall", HALLARCH)
            else:
                m.decal(*fr_, c - 1.2, c + 1.2, 2.88, 9.36, "vh_hall2" if i % 2 else "vh_hall", HALLARCH)
                m.decal(*fr_, c - 0.64, c + 0.64, 0.14, 1.1, "vh_grille", off=0.14)
            m.decal(*fr_, c - 0.96, c + 0.96, 10.56, 14.4, "vh_cross2" if (i + (side > 0)) % 3 == 0 else "vh_cross")
        for s in bl[1:-1]:
            if side < 0 and abs(s - TWR[0]) < 0.5:
                continue  # the stair tower stands here
            buttress(fr_, s, 0.55, 1.25, 0.45, 0.8, 9.0, SC, 15.4, 16.5)
        box(fr_, u0, u1, 0.0, 0.14, SC, SC + 0.22, SAND, 1.08)  # the drip course
        box(fr_, u0 - 0.2, u1 + 0.2, 0.0, 0.35, H - 0.3, H + 0.02, SAND, 1.05)  # the eaves cornice

    # ---- the stepped wall dormers at the eaves, one to a bay (Linnig 1849 and 1855)
    for fr_ in (S, N):
        p, d, o = fr_
        for a, b in zip(bl, bl[1:]):
            sc = (a + b) / 2
            wall_rect(fr_, sc - 1.2, sc + 1.2, H, H + 1.44)
            stepped(fr_, sc - 1.2, sc + 1.2, H + 1.44, 2, 0.96, 0.96, 0.3, cope=0.12)
            m.decal(*fr_, sc - 0.64, sc + 0.64, H + 0.48, H + 1.92, "vh_small2" if (int(sc) % 2) else "vh_small")
            yr = H + 1.44 + 2.0
            for sg in (-1, 1):
                se = sc + sg * 1.2
                f = m.poly([W(fr_, se, 0, H), W(fr_, se, 0, H + 1.44), W(fr_, se, -1.44 / SLOPE, H + 1.44)], BRICK, 0.85)
                m.orient(f, (d[0] * sg, d[1] * sg, 0))
                f = m.poly([W(fr_, sc + sg * 1.3, -0.3, H + 1.38), W(fr_, sc, -0.3, yr), W(fr_, sc, -(yr - H) / SLOPE, yr),
                            W(fr_, sc + sg * 1.3, -1.38 / SLOPE, H + 1.38)], SLATE)
                m.orient(f, (d[0] * sg, d[1] * sg, 1))

    # ---- the steep slate roof, two rows of small dormers, the lead on the ridge
    over = 0.35
    ye = H - over * SLOPE
    for side, vv in ((-1, v0 - over), (1, v1 + over)):
        f = m.poly([(u0 + 0.25, vv, ye), (u1 - 0.25, vv, ye), (u1 - 0.25, vm, H + RISE), (u0 + 0.25, vm, H + RISE)], SLATE)
        m.orient(f, (0, side, 1))
        P, D, O = (0, vv), (1, 0), (0, side)
        for yb, row in ((H + 5.4, (-15.0, -9.0, -3.0, 9.0, 15.0) if side < 0 else (-15.0, -9.0, -3.0, 3.0, 9.0, 15.0)), (H + 8.8, (-12.0, -4.0, 4.0, 12.0))):
            for s in row:
                _roof_dormer(m, P, D, O, s, 0.0, ye, -half - over, H + RISE, yb, 1.1, 1.5)
    m.box(u0 + 0.3, u1 - 0.3, vm - 0.12, vm + 0.12, H + RISE - 0.05, H + RISE + 0.12, LEAD)

    # ---- the gable ends: two bays beside a middle buttress, the stepped gables
    for fr_, front in ((E, True), (Wf, False)):
        p, d, o = fr_
        bays = (-2.7, 4.4)
        if front:  # the two doors under the great windows
            wall(fr_, v0, v1, H, [(bays[0], 0.8, 3.36, 0.6, "Vleeshuis, east front, left door"), (bays[1], 0.8, 3.36, 0.6, "Vleeshuis, east front, right door")])
        else:
            wall(fr_, v0, v1, H)
        for i, c in enumerate(bays):
            if front:
                m.decal(*fr_, c - 1.2, c + 1.2, 4.32, 9.36, "vh_hall" if i == 0 else "vh_hall2", HALLARCH)
            else:
                m.decal(*fr_, c - 1.3, c + 1.3, 2.64, 9.36, "vh_hall2" if i == 0 else "vh_hall", HALLARCH)
                m.decal(*fr_, c - 0.64, c + 0.64, 0.14, 1.1, "vh_grille", off=0.14)
            m.decal(*fr_, c - 0.96, c + 0.96, 10.56, 14.4, "vh_cross")
            m.decal(*fr_, c - 0.64, c + 0.64, 14.88, 16.32, "vh_small")
        box(fr_, v0, v1, 0.0, 0.14, SC, SC + 0.22, SAND, 1.08)
        box(fr_, v0, v1, 0.0, 0.12, H - 0.2, H, SAND, 1.08)
        buttress(fr_, 0.8, 0.6, 1.1, 0.45, 0.75, 9.0, SC, H + 0.96, pin=3.4)
        stepped(fr_, v0, v1, H, 9, 1.44, 1.44, 0.5)
        for y0, ss in ((18.24, (-3.65, -1.75, 3.45, 5.35)), (21.12, (-2.7, 4.4)), (24.0, (-1.9, 3.4)), (26.88, (0.75,))):
            for k, s in enumerate(ss):
                m.decal(*fr_, s - 0.64, s + 0.64, y0, y0 + 1.44, "vh_small2" if (k + int(y0)) % 3 == 0 else "vh_small")
        m.decal(*fr_, 0.43, 1.07, 28.32, 29.76, "vh_slit")

    # ---- the stair turrets on the corners, the south-east one the biggest (the Madonna on it)
    rot = math.pi / 6  # a face square to each gable
    tower(-21.4, -7.1, 1.9, 6, rot, H - 0.6, 22.08, 32.2,
          wins=((math.pi * 4 / 3, 4.8, "vh_madonna", 1.28, 2.56), (math.pi, 3.84, "vh_slit", 0.64, 1.44), (math.pi, 8.64, "vh_slit", 0.64, 1.44),
                (math.pi * 4 / 3, 12.0, "vh_slit", 0.64, 1.44), (math.pi, 13.92, "vh_small", 1.28, 1.44)),
          top_wins=(math.pi, math.pi * 4 / 3, math.pi * 2 / 3))
    for cu, cv, r, sg_u, sg_v in ((-21.8, 8.6, 1.55, -1, 1), (21.6, 8.6, 1.55, 1, 1), (21.7, -7.0, 1.6, 1, -1)):
        out = math.atan2(sg_v, sg_u)
        tower(cu, cv, r, 6, rot, H - 0.6, 20.64, 27.9,
              wins=((out, 5.28, "vh_slit", 0.64, 1.44), (out + 0.5 * sg_u * sg_v, 10.08, "vh_slit", 0.64, 1.44)),
              top_wins=(out, out + 1.0, out - 1.0))
    # the tall octagonal stair tower out of the middle of the south side
    tu, tv, tr = TWR
    tower(tu, tv, tr, 8, math.pi / 8, 23.52, 26.4, 34.4,
          wins=tuple((-math.pi / 2 + (k % 3 - 1) * math.pi / 4, 2.88 + k * 3.84, "vh_slit", 0.64, 1.44) for k in range(5)),
          top_wins=(-math.pi / 2, -math.pi / 4, -3 * math.pi / 4, 0.0, math.pi))
    st()
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
    """The Hanseatic House (Oostershuis, 1564-68, burned 1893), as a warehouse in the
    1870s: four wings round a court, four storeys of stone cross windows with shutters,
    arched doors below, the classical gate in the middle of the dock front under a clock,
    hipped roofs with dormers and chimneys, and the square tower over the gate: a gallery
    and a pyramid roof with a small lantern (the old octagonal crown was long gone).
    v < 0 is the dock side."""
    cath_materials()
    m = CMesh(fr)
    L, W = fr.L, fr.W
    u0, u1, v0, v1 = -L / 2, L / 2, -W / 2, W / 2
    H = 16.5
    d = 10.0  # wing depth
    RISE = 5.2
    wings = [(u0, u1, v0, v0 + d), (u0, u1, v1 - d, v1), (u0, u0 + d, v0 + d, v1 - d), (u1 - d, u1, v0 + d, v1 - d)]
    for wi, (a0, a1, b0, b1) in enumerate(wings):
        if wi == 0:
            # M7 halls (the Oostershuis in the world, docs/milestones/M7-halls-inworld.md): the dock wing's walls one
            # by one, its front with a real gateway behind the gate's portal (the warehouse stands inside,
            # client/src/world/landmarkHalls.ts buildOostershuis, shared/oostershuisPlan.ts)
            for pa, pb, out in (((a0, b1), (a1, b1), (0, 1)), ((a1, b0), (a1, b1), (1, 0)), ((a0, b0), (a0, b1), (-1, 0))):
                f = m.poly([(pa[0], pa[1], 0), (pb[0], pb[1], 0), (pb[0], pb[1], H), (pa[0], pa[1], H)], STONE, 0.95)
                m.orient(f, (out[0], out[1], 0))
            _holed_wall(m, (0, b0), (1, 0), (0, -1), a0, a1, 0, H, [(0.0, 1.3, 5.3, 0.6, True)], shade=0.95 / 0.88)
        else:
            m.box(a0, a1, b0, b1, 0, H, STONE, top=False, shade=0.95)
        m.hip_roof(a0 - 0.35, a1 + 0.35, b0 - 0.35, b1 + 0.35, H + 0.6, RISE, SLATE)
    m.prism([(u0 - 0.35, v0 - 0.35), (u1 + 0.35, v0 - 0.35), (u1 + 0.35, v1 + 0.35), (u0 - 0.35, v1 + 0.35)], H, H + 0.6, STONE, top=False, shade=1.05)
    GATE = 0.0
    walls = [((0, v0), (1, 0), (0, -1), u0, u1), ((0, v1), (1, 0), (0, 1), u0, u1),
             ((u0, 0), (0, 1), (-1, 0), v0, v1), ((u1, 0), (0, 1), (1, 0), v0, v1)]
    for wi, (p, d_, o, s0, s1) in enumerate(walls):
        n = round((s1 - s0) / 4.0)
        bw = (s1 - s0) / n
        skip = {k for k in range(n) if wi == 0 and abs(s0 + (k + 0.5) * bw - GATE) < 3.5}
        _bays(m, p, d_, o, s0, s1, n, 0.1, 4.3, "hz_arch", inset=0.6, skip=skip)
        _bays(m, p, d_, o, s0, s1, n, 4.9, H - 0.4, "hz_bay", inset=0.0, skip=skip if wi == 0 else ())
        _wbox(m, p, d_, o, s0 - 0.15, s1 + 0.15, 0, 0.3, 4.4, 4.8, STONE, 1.1)  # string course over the ground floor
        _wbox(m, p, d_, o, s0 - 0.15, s1 + 0.15, 0, 0.4, 0, 0.5, STONE, 0.75)  # plinth
        for sk in (s0, s1):  # quoins at the corners
            _wbox(m, p, d_, o, sk - 0.6 if sk == s1 else sk, sk if sk == s1 else sk + 0.6, 0, 0.12, 0, H, STONE, 1.12, top=False)
        # dormers on the outer slope
        pe = _wpt(p, d_, o, 0, 0.35, 0)[:2]
        for k in range(max(2, n // 2)):
            s = s0 + (k + 0.5) * (s1 - s0) / max(2, n // 2)
            if wi == 0 and abs(s - GATE) < 5:
                continue
            if abs(s - s0) < d + 1 or abs(s1 - s) < d + 1:
                continue
            _roof_dormer(m, pe, d_, o, s, 0.0, H + 0.6, -(d / 2 + 0.35), H + 0.6 + RISE, H + 1.6, 1.2, 1.5)
    for cu, cv in ((-22, v0 + 3), (-8, v0 + 3), (8, v0 + 3), (22, v0 + 3), (-22, v1 - 3), (22, v1 - 3), (u0 + 3, 0), (u1 - 3, 0)):
        m.box(cu - 0.45, cu + 0.45, cv - 0.7, cv + 0.7, H + 2.0, H + RISE + 1.8, BRICK, shade=0.9)
    # ---- the gate: a projecting classical frontispiece, round-arched door, columns, pediment, clock
    P, D, O = (0, v0), (1, 0), (0, -1)
    PF = (0, v0 - 1.2)
    _holed_wall(m, PF, D, O, GATE - 3.4, GATE + 3.4, 0, 9.2, [(GATE, 1.6, 5.6, 0.6, True)], cell=None, mat=STONE, shade=1.1)
    for sg in (-1, 1):
        f = m.poly([(GATE + sg * 3.4, v0 - 1.2, 0), (GATE + sg * 3.4, v0, 0), (GATE + sg * 3.4, v0, 9.2), (GATE + sg * 3.4, v0 - 1.2, 9.2)], STONE, 0.95)
        m.orient(f, (sg, 0, 0))
        for sc in (GATE + sg * 2.2, GATE + sg * 3.0):
            ring = m.ngon(sc, v0 - 1.55, 0.26, 8)
            m.prism(ring, 0.6, 6.4, STONE, top=False, shade=1.15)
            m.box(sc - 0.36, sc + 0.36, v0 - 1.9, v0 - 1.2, 0, 0.6, STONE, shade=1.05)
    # M7 halls: no leaves in the gate: a real opening under the lintel; the game hangs its own (world/hallInWorld.ts)
    _portal(m, PF, D, O, GATE, 1.6, 1.3, 1.1, 5.6, 5.3, 0.6, 3.9, bands=2, rnd=True, tymp="fanlight", door="Hanseatic House, gate", leaves=False)
    _wbox(m, PF, D, O, GATE - 3.6, GATE + 3.6, 0, 0.75, 6.4, 7.3, STONE, 1.1)  # entablature
    f = m.poly([(GATE - 3.7, v0 - 1.95, 7.3), (GATE + 3.7, v0 - 1.95, 7.3), (GATE, v0 - 1.95, 9.6)], STONE, 1.1)
    m.orient(f, (0, -1, 0))
    f = m.poly([(GATE - 3.7, v0 - 1.95, 7.3), (GATE, v0 - 1.95, 9.6), (GATE, v0, 9.6), (GATE - 3.7, v0, 7.3)], LEAD)
    m.orient(f, (-1, 0, 1))
    f = m.poly([(GATE + 3.7, v0 - 1.95, 7.3), (GATE, v0 - 1.95, 9.6), (GATE, v0, 9.6), (GATE + 3.7, v0, 7.3)], LEAD)
    m.orient(f, (1, 0, 1))
    m.decal(PF, D, O, GATE - 0.85, GATE + 0.85, 7.45, 9.15, "clock", DISC, off=0.8)
    m.decal(P, D, O, GATE - 0.8, GATE + 0.8, 10.0, 14.6, "cross_window", off=0.08)
    for sc in (-2.2, 2.2):
        m.decal(P, D, O, sc - 1.0, sc + 1.0, 10.0, 14.6, "cross_window", off=0.08)
    # ---- the tower over the gate: square, two stages over the roof, a gallery, pyramid, lantern
    tu, tv, th = GATE, v0 + 4.5, 3.7
    m.box(tu - th, tu + th, tv - th, tv + th, H, 31.0, STONE, top=False, shade=1.0)
    for y0, y1, cell in ((H + 5.5, 25.6, "cross_window"), (26.4, 30.2, "st_window")):
        for p2, d2, o2 in (((tu, tv - th), (1, 0), (0, -1)), ((tu, tv + th), (1, 0), (0, 1)), ((tu - th, tv), (0, 1), (-1, 0)),
                           ((tu + th, tv), (0, 1), (1, 0))):
            for sc in (-1.4, 1.4):
                m.decal(p2, d2, o2, sc - 0.75, sc + 0.75, y0, y1, cell, off=0.06)
    m.box(tu - th - 0.3, tu + th + 0.3, tv - th - 0.3, tv + th + 0.3, 25.6, 26.2, STONE, shade=1.05)
    m.box(tu - th - 0.7, tu + th + 0.7, tv - th - 0.7, tv + th + 0.7, 31.0, 31.5, STONE, shade=1.05)
    m.balustrade_ring(_sq(tu, tv, th + 0.6), 31.5, 1.0, piece=2.5)
    for su in (-1, 1):
        for sv in (-1, 1):
            m.prism(m.ngon(tu + su * (th + 0.4), tv + sv * (th + 0.4), 0.22, 6), 31.5, 32.8, STONE, top=True)
    m.frustum(_sq(tu, tv, th + 0.1), 31.5, _sq(tu, tv, 1.1), 37.5, SLATE)
    m.prism(_sq(tu, tv, 1.0), 37.5, 39.3, STONE, top=False)
    m.decal((tu, tv - 1.0), (1, 0), (0, -1), -0.5, 0.5, 37.8, 39.0, "slit", off=0.04)
    m.pyramid(m.ngon(tu, tv, 1.25, 8, math.pi / 8), 39.3, 42.5, LEAD)
    m.prism(m.ngon(tu, tv, 0.22, 6), 42.4, 42.8, GILT, top=True)
    m.spike(tu, tv, 42.8, 44.3, 0.05, GILT)
    # the courtyard walls, plain, with rows of windows
    for (a0, a1, b0, b1) in [(u0 + d, u1 - d, v0 + d, v0 + d), (u0 + d, u1 - d, v1 - d, v1 - d)]:
        o = (0, 1) if b0 < 0 else (0, -1)
        n = round((a1 - a0) / 4.0)
        _bays(m, (0, b0), (1, 0), o, a0, a1, n, 4.9, H - 0.4, "hz_bay")
    return m


def steen3(fr):
    """Het Steen before the restoration of 1889-90, as in Steve's reference photo from the
    Steenplein and the prints of the 1870s-80s: a tall slim tower with a spire on the left,
    the main hall with two stepped gables and dormers under a big slate roof, two round
    towers with pointed roofs, a battlemented gallery and a squat round tower on the right.
    Rough dark stone below, lighter stone above; arrow slits, small barred Gothic windows,
    corbel tables under the parapets, and real gates: the hall's gate in a stone porch and
    the gallery's gate. u runs left to right seen from the square (+v)."""
    cath_materials()
    m = CMesh(fr)
    L, W = fr.L, fr.W
    u0, u1 = -L / 2 + 1.0, L / 2 - 1.0
    v0, v1 = -W / 2 + 1.0, W / 2 - 1.0
    front = v1
    F = (0, front), (1, 0), (0, 1)  # the square front as a wall frame

    def stepgable(uc, width, v, y0, rise, steps=5):
        """A stepped gable standing up from a front wall at v, with its roof behind and a window."""
        _stepgable(m, (0, v), (1, 0), (0, 1), uc - width / 2, uc + width / 2, y0, rise, steps, STONE, off=0.0, crown=0.8, shade=0.95)
        m.gable_roof(uc - width / 2 + 0.3, uc + width / 2 - 0.3, v - 8, v - 0.1, y0, rise * 0.85, along="v", over=0.1)
        m.decal((0, v), (1, 0), (0, 1), uc - 0.6, uc + 0.6, y0 + 1.2, y0 + 3.6, "st_window", arch_shape(0.7, 2), off=0.06)

    def base(ring, top=4.0):
        m.prism(ring, -1.0, top, STONE, top=False, shade=0.6)

    def corbels(p, d, o, s0, s1, y, step=1.2):
        """A corbel table: small brackets under a parapet."""
        k = s0 + 0.3
        while k < s1 - 0.3:
            _wbox(m, p, d, o, k - 0.2, k + 0.2, 0, 0.35, y - 0.7, y, STONE, 0.9, top=False)
            k += step

    # ---- the main hall
    h0, h1 = u0 + 7, u0 + 24
    m.box(h0, h1, v0 + 2, front, -1.0, 4.0, STONE, top=False, shade=0.6)  # rough dark base
    m.box(h0, h1, v0 + 2, front, 4.0, 14.0, STONE, top=False, shade=0.92)
    m.gable_roof(h0, h1, v0 + 2, front, 14.0, 9.0, along="u", gable_mat=STONE)
    for uu in (h0 + 2.5, h0 + 13.5):
        m.decal(*F, uu - 0.2, uu + 1.6, 5.4, 8.4, "cross_window")
        m.decal(*F, uu - 0.1, uu + 1.5, 9.8, 12.6, "st_window", arch_shape(0.7, 2))
    for uu in (h0 + 1.0, h0 + 5.5, h0 + 11.0, h0 + 16.0):
        m.decal(*F, uu - 0.25, uu + 0.25, 0.8, 3.2, "slit")
    stepgable(h0 + 4.5, 6.0, front + 0.05, 14.0, 7.0)
    stepgable(h0 + 12.5, 6.0, front + 0.05, 14.0, 7.0)
    for uu in (h0 + 8.5, h1 - 1.5):  # dormers
        _roof_dormer(m, (0, front), (1, 0), (0, 1), uu, 0.0, 14.0, -(front - v0 - 2) / 2, 23.0, 16.2, 1.5, 2.1)
    # the gate of the hall in a stone porch with a small stepped top
    gc = h0 + 8.5
    PP = (0, front + 1.3)
    _holed_wall(m, PP, (1, 0), (0, 1), gc - 2.3, gc + 2.3, 0.0, 6.2, [(gc, 1.35, 5.9, 0.62)], mat=STONE, shade=0.95)
    m.box(gc - 2.3, gc + 2.3, front, front + 1.3, -1.0, 0.0, STONE, top=False, shade=0.6)
    for sg in (-1, 1):
        f = m.poly([(gc + sg * 2.3, front, -1.0), (gc + sg * 2.3, front + 1.3, -1.0), (gc + sg * 2.3, front + 1.3, 6.2), (gc + sg * 2.3, front, 6.2)], STONE, 0.85)
        m.orient(f, (sg, 0, 0))
    _stepgable(m, PP, (1, 0), (0, 1), gc - 2.3, gc + 2.3, 6.2, 1.8, 3, STONE, off=0.0, crown=0.4, shade=0.95)
    m.gable_roof(gc - 2.2, gc + 2.2, front, front + 1.3, 6.2, 1.5, along="v", over=0.05)
    _portal(m, PP, (1, 0), (0, 1), gc, 1.35, 1.0, 1.25, 5.9, 5.5, 0.62, 3.6, bands=3, door="Steen, gate of the hall")
    # ---- the tall tower on the left: square, then octagonal with a corbelled gallery, then the spire
    tu, tv, ts = u0 + 3.2, front - 3.0, 3.1
    m.box(tu - ts, tu + ts, tv - ts, tv + ts, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.box(tu - ts, tu + ts, tv - ts, tv + ts, 4.0, 21.0, STONE, top=False, shade=0.95)
    for y0 in (6.0, 10.5, 15.0):
        m.decal((0, tv + ts), (1, 0), (0, 1), tu - 0.55, tu + 0.55, y0, y0 + 2.4, "st_window", arch_shape(0.7, 2))
        m.decal((tu - ts, 0), (0, 1), (-1, 0), tv - 0.25, tv + 0.25, y0 + 0.4, y0 + 2.2, "slit")
    corbels((0, tv + ts), (1, 0), (0, 1), tu - ts, tu + ts, 21.0, 1.0)
    oc = m.ngon(tu, tv, ts * 0.95, 8, math.pi / 8)
    m.prism(oc, 21.0, 27.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(tu, tv, ts * 1.12, 8, math.pi / 8), 26.2, 27.4, STONE, top=False, shade=1.0)  # corbelled gallery
    for k in range(8):
        a = math.pi / 4 * k + math.pi / 8
        cu_, cv_ = tu + math.cos(a) * ts * 1.1, tv + math.sin(a) * ts * 1.1
        m.box(cu_ - 0.2, cu_ + 0.2, cv_ - 0.2, cv_ + 0.2, 27.4, 28.4, STONE)
        a2 = math.pi / 4 * k
        o = (math.cos(a2), math.sin(a2))
        pt = (tu + o[0] * ts * 0.95 * math.cos(math.pi / 8), tv + o[1] * ts * 0.95 * math.cos(math.pi / 8))
        if k % 2 == 0:
            m.decal(pt, (-o[1], o[0]), o, -0.4, 0.4, 22.4, 25.2, "st_window", arch_shape(0.7, 2), off=0.05)
    m.pyramid(m.ngon(tu, tv, ts * 0.85, 8, math.pi / 8), 27.4, 40.0, SLATE)
    m.box(tu - 0.06, tu + 0.06, tv - 0.06, tv + 0.06, 40.0, 42.0, LEAD)  # the weathervane rod
    m.box(tu - 0.05, tu + 0.9, tv - 0.02, tv + 0.02, 41.2, 41.7, GILT)
    # ---- round tower 1, tall with a pointed roof, between the hall and the east wing
    r1u = h1 + 1.5
    ring = m.ngon(r1u, front - 3.0, 3.1, 12)
    base(ring)
    m.prism(ring, 4.0, 19.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(r1u, front - 3.0, 3.4, 12), 18.2, 19.0, STONE, top=False, shade=1.0)
    for y0 in (9.0, 14.0):
        m.decal((r1u, front + 0.08), (1, 0), (0, 1), -0.5, 0.5, y0, y0 + 2.3, "st_window", arch_shape(0.7, 2))
    m.decal((r1u, front + 0.08), (1, 0), (0, 1), -0.25, 0.25, 4.8, 7.0, "slit")
    m.pyramid(m.ngon(r1u, front - 3.0, 3.5, 12), 19.0, 28.0, SLATE)
    m.spike(r1u, front - 3.0, 27.8, 29.2, 0.05, LEAD)
    # ---- the east wing, lower, with a stepped gable and small windows
    e0, e1 = h1 + 4.5, h1 + 15.0
    m.box(e0, e1, v0 + 2, front - 1.0, -1.0, 4.0, STONE, top=False, shade=0.6)
    m.box(e0, e1, v0 + 2, front - 1.0, 4.0, 12.0, STONE, top=False, shade=0.9)
    m.gable_roof(e0, e1, v0 + 2, front - 1.0, 12.0, 7.0, along="u", gable_mat=STONE)
    stepgable((e0 + e1) / 2, 5.5, front - 0.95, 12.0, 6.0, 4)
    Fe = (0, front - 1.0), (1, 0), (0, 1)
    for uu in (e0 + 2.7, e1 - 2.7):
        m.decal(*Fe, uu - 0.75, uu + 0.75, 6.0, 9.0, "cross_window")
        m.decal(*Fe, uu - 0.25, uu + 0.25, 1.0, 3.2, "slit")
    # ---- round tower 2 with a slender pointed roof and a spike
    r2u = e1 + 1.8
    ring = m.ngon(r2u, front - 3.2, 2.8, 12)
    base(ring)
    m.prism(ring, 4.0, 17.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(r2u, front - 3.2, 3.05, 12), 16.3, 17.0, STONE, top=False, shade=1.0)
    m.decal((r2u, front - 0.35), (1, 0), (0, 1), -0.45, 0.45, 10.0, 12.3, "st_window", arch_shape(0.7, 2))
    m.pyramid(m.ngon(r2u, front - 3.2, 3.1, 12), 17.0, 27.0, SLATE)
    m.box(r2u - 0.05, r2u + 0.05, front - 3.25, front - 3.15, 27.0, 28.6, LEAD)
    # ---- the battlemented gallery with its gate, and the squat round tower on the right
    g0, g1 = r2u + 2.5, u1 - 4.0
    if g1 > g0 + 1:
        Fg = (0, front - 2.0), (1, 0), (0, 1)
        gc2 = (g0 + g1) / 2
        m.box(g0, g1, v0 + 2, front - 2.0, -1.0, 10.0, STONE, top=True, top_mat=LEAD, shade=0.85)
        # the gate: cut into a shallow projecting frame so the wall behind stays whole
        PG = (0, front - 1.2)
        hw = min(1.4, (g1 - g0) / 2 - 0.6)
        _holed_wall(m, PG, (1, 0), (0, 1), gc2 - hw - 0.5, gc2 + hw + 0.5, 0.0, 5.6, [(gc2, hw, 4.8, 0.62)], mat=STONE, shade=0.9)
        _portal(m, PG, (1, 0), (0, 1), gc2, hw, hw * 0.8, 0.75, 4.8, 4.5, 0.62, 3.0, bands=2, door="Steen, gallery gate")
        corbels(*Fg, g0, g1, 10.0)
        k = g0 + 0.3
        while k < g1 - 0.6:
            m.box(k, k + 0.6, front - 2.35, front - 1.65, 10.0, 11.0, STONE, shade=0.95)
            k += 1.2
    r3u = u1 - 3.2
    ring = m.ngon(r3u, front - 3.4, 3.4, 12)
    base(ring)
    m.prism(ring, 4.0, 13.0, STONE, top=False, shade=0.95)
    m.prism(m.ngon(r3u, front - 3.4, 3.7, 12), 12.2, 13.0, STONE, top=True, top_mat=LEAD, shade=1.0)
    for k in range(12):
        a = math.pi * 2 * k / 12
        cx, cz = r3u + math.cos(a) * 3.55, front - 3.4 + math.sin(a) * 3.55
        if k % 2 == 0:
            m.box(cx - 0.3, cx + 0.3, cz - 0.3, cz + 0.3, 13.0, 14.0, STONE)
        m.box(cx - 0.15, cx + 0.15, cz - 0.15, cz + 0.15, 11.5, 12.2, STONE, shade=0.85)  # corbels
    m.decal((r3u, front), (1, 0), (0, 1), -0.5, 0.5, 6.0, 8.5, "st_window", arch_shape(0.7, 2))
    # ---- the river side: plain curtain wall joining it all, slits, a corbel table
    m.box(u0, u1, v0, v0 + 2.2, -1.0, 11.0, STONE, top=True, top_mat=LEAD, shade=0.75)
    R = (0, v0), (1, 0), (0, -1)
    for k in range(9):
        uu = u0 + 3 + k * (u1 - u0 - 6) / 8
        m.decal(*R, uu - 0.25, uu + 0.25, 4.0, 6.4, "slit")
    corbels(*R, u0, u1, 11.0, 1.5)
    return m


# ------------------------------------------------------------------ Het Steen as it stood in 1873 (M3i)
#
# Sources (reference only, all public domain / CC0; docs/milestones/M3i-steen.md): J. Linnig's etchings
# (before 1868) and his watercolour of 1886 (FelixArchief 12#2974), the lithographs of 1823, 1838 and
# 1844, the 1880 photograph "La rue du Steen" (MAS), E. Puttaert's engraving of 1880, the photographs of
# the cleared Steen (c. 1883-85), the heritage inventory (Onroerend Erfgoed 4602) and the 1873 Vuillaume
# map. Not the 1889-90 restoration: no ramp, no neo-Gothic north wing, no spire tower, no pseudo-parapet.
#
# The frame is world-aligned: u = world x (north, along the river), v = world z (inland). The fp is the
# walk-map wall; the Steenstraat lane runs along the inland side (v 8.25..14.25) through the Steenpoort,
# which stands over the lane at the south end, outside the fp (the game gives its east tower a collider).

SAT = 256
SATLAS = 7
STEEN_MATS = CATH_MATS + ["steen_atlas"]
SCELL = {
    "st_band": (0, 0, 128, 24),  # the painted name over the museum's ground floor (photo c. 1883)
    "st_board": (128, 0, 128, 64),  # the board by the door, in plain English
    "st_semini": (0, 24, 64, 64),  # the Semini relief in its round-headed niche over the Steenpoort
    "st_arms": (64, 24, 64, 48),  # the oriel: Charles V's arms, the double eagle under the crown
    "st_saltire": (0, 88, 64, 48),  # the oriel: the Burgundian saltire, fire steels, the pillars
    "st_bars": (64, 72, 32, 64),  # a tall barred prison window in a stone frame
    "st_smallbar": (96, 72, 32, 32),  # a small barred window
    "st_oculus": (96, 104, 32, 32),  # a round window (the west front has two)
    "st_twolight": (128, 64, 64, 64),  # a two-light late-Gothic window, barred
    "st_door": (192, 64, 64, 64),  # the oak door under a four-centred head, with its wicket
    "st_arched_door": (128, 128, 64, 64),  # a planked door in a round arch (the tower feet)
    "st_tiles": (192, 128, 64, 64),  # red pantiles
    "st_crossbar": (64, 136, 64, 64),  # a stone cross window with iron bars
    "st_house": (0, 192, 64, 64),  # a small brick house front of the 1870s, door and windows
    "st_housewin": (64, 200, 64, 56),  # the same house, upper floor
}
DOOR4 = [(0, 0), (1, 0), (1, 0.76), (0.9, 0.9), (0.7, 0.98), (0.5, 1), (0.3, 0.98), (0.1, 0.9), (0, 0.76)]
ROUNDTOP = [(0, 0), (1, 0), (1, 0.62)] + [(0.5 + 0.5 * math.cos(math.pi * k / 8), 0.62 + 0.38 * math.sin(math.pi * k / 8)) for k in range(1, 8)] + [(0, 0.62)]

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


def scell_uv(name, x, t):
    cx, cy, w, h = SCELL[name]
    return ((cx + 0.5 + x * (w - 1)) / SAT, 1 - (cy + 0.5 + (1 - t) * (h - 1)) / SAT)


def paint_steen_atlas():
    """The Steen's own atlas, drawn pixel by pixel (rows top-down, sRGB 0..1)."""
    import numpy as np

    rng = np.random.default_rng(1520)
    A = np.zeros((SAT, SAT, 3), np.float32)
    C = {k: np.array(v, np.float32) for k, v in {
        "stone": (0.56, 0.52, 0.44), "hi": (0.68, 0.64, 0.55), "lo": (0.36, 0.34, 0.30), "blue": (0.40, 0.42, 0.45),
        "glass": (0.07, 0.085, 0.11), "lead": (0.20, 0.20, 0.19), "iron": (0.10, 0.10, 0.11), "void": (0.07, 0.07, 0.08),
        "wood": (0.30, 0.20, 0.12), "wood2": (0.22, 0.14, 0.09), "plaster": (0.80, 0.76, 0.66), "ink": (0.13, 0.12, 0.11),
        "board": (0.10, 0.15, 0.12), "chalk": (0.88, 0.86, 0.78), "gold": (0.80, 0.64, 0.28), "brick": (0.52, 0.28, 0.21),
        "tile": (0.55, 0.26, 0.17), "white": (0.84, 0.82, 0.76), "shutter": (0.22, 0.32, 0.24),
    }.items()}

    def cell(name):
        x, y, w, h = SCELL[name]
        return A[y:y + h, x:x + w]

    def grid(h, w):
        yy, xx = np.mgrid[0:h, 0:w]
        return xx + 0.5, yy + 0.5

    def noise(c, amt):
        c += (rng.random(c.shape[:2])[..., None] - 0.5) * amt

    def stone_bg(c, course=6, col="stone"):
        c[:] = C[col]
        h, w = c.shape[:2]
        for i, y in enumerate(range(0, h, course)):
            c[min(h - 1, y + course - 1), :] *= 0.84
            for x in range((i % 2) * 5 + int(rng.integers(0, 3)), w, 10 + int(rng.integers(0, 4))):
                c[y:y + course - 1, x] *= 0.86
        c *= (0.93 + 0.14 * rng.random((h, w, 1))).astype(np.float32)

    def shape_mask(w, h, shape):
        """Pixels inside a unit outline: its top edge is the shape's points above t = 0."""
        xx, yy = grid(h, w)
        x = xx / w
        t = 1 - yy / h
        top = sorted({(round(p[0], 4), p[1]) for p in shape if p[1] > 0})
        xs = np.array([p[0] for p in top])
        ts = np.array([p[1] for p in top])
        return t <= np.interp(x, xs, ts)

    def erode(mk, n=1):
        for _ in range(n):
            e = mk.copy()
            e[1:, :] &= mk[:-1, :]
            e[:-1, :] &= mk[1:, :]
            e[:, 1:] &= mk[:, :-1]
            e[:, :-1] &= mk[:, 1:]
            e[0, :] = e[-1, :] = False
            e[:, 0] = e[:, -1] = False
            mk = e
        return mk

    def text(c, s, y0, col, x0=None):
        w = len(s) * 6 - 1
        x0 = (c.shape[1] - w) // 2 if x0 is None else x0
        for i, ch in enumerate(s):
            for r, row in enumerate(FONT5[ch]):
                for k, b in enumerate(row):
                    if b == "1":
                        c[y0 + r, x0 + i * 6 + k] = col

    def barred(c, x0, y0, x1, y1, frame=3, step=5, cross=True):
        c[y0:y1, x0:x1] = C["hi"]
        g = c[y0 + frame:y1 - frame, x0 + frame:x1 - frame]
        g[:] = C["glass"]
        g[rng.random(g.shape[:2]) < 0.06] = C["lead"] * 1.6
        g[:, ::step] = C["iron"]
        if cross:
            g[::step * 2, :] = C["iron"]
        c[y1 - 1:y1 + 1, x0 - 1:x1 + 1] = C["hi"] * 1.05  # the sill
        c[y0:y1, x0] = C["lo"]

    # -- the painted name (two lines, black on a limewashed band): a name, so Dutch and French
    c = cell("st_band")
    c[:] = C["plaster"]
    noise(c, 0.05)
    c[0] = C["lo"]
    c[-1] = C["lo"]
    text(c, "MUSEUM VAN OUDHEDEN", 3, C["ink"])
    text(c, "MUSEE D'ANTIQUITES", 13, C["ink"])

    # -- the board by the door (plain English)
    c = cell("st_board")
    c[:] = C["wood"]
    c[3:-3, 3:-3] = C["board"]
    noise(c, 0.04)
    text(c, "MUSEUM OF", 9, C["chalk"])
    text(c, "ANTIQUITIES", 21, C["chalk"])
    c[33, 34:94] = C["gold"]
    text(c, "OPEN 10 - 4", 42, C["gold"])

    # -- Semini: a small worn relief of a standing man in a round-headed niche, face and hands chipped away
    c = cell("st_semini")
    stone_bg(c, 6, "blue")
    mk = shape_mask(44, 58, ROUNDTOP)
    sub = c[4:62, 10:54]
    sub[mk] = C["hi"] * 0.95
    inner = erode(mk, 3)
    sub[inner] = C["lo"] * 0.8
    xx, yy = grid(58, 44)
    head = np.hypot(xx - 22, yy - 16) <= 4.5
    torso = (np.abs(xx - 22) <= 6 - (yy - 22) * 0.05) & (yy >= 21) & (yy <= 38)
    legs = ((np.abs(xx - 19) <= 2.2) | (np.abs(xx - 25) <= 2.2)) & (yy > 38) & (yy <= 54)
    arms = ((np.abs(xx - 13.5) <= 1.8) | (np.abs(xx - 30.5) <= 1.8)) & (yy >= 23) & (yy <= 36)
    fig = (head | torso | legs | arms) & inner
    sub[fig] = C["stone"] * 1.05
    sub[fig & (xx > 22)] *= 0.88  # the light from the left
    sub[head & (rng.random(head.shape) < 0.55)] = C["hi"] * 1.15  # the chipped face
    sub[np.hypot(xx - 22, yy - 37) < 2.5] = C["hi"] * 1.1  # chipped away in 1587
    noise(c, 0.05)

    # -- the oriel panels: stone relief, not gilded in 1873
    c = cell("st_arms")
    stone_bg(c, 6)
    c[2:46, 2:62] = C["lo"]
    c[4:44, 4:60] = C["stone"] * 1.02
    xx, yy = grid(48, 64)
    shield = ((np.abs(xx - 32) < 11) & (yy > 14) & (yy < 32)) | ((np.hypot(xx - 32, yy - 32) < 11) & (yy >= 32))
    c[shield] = C["hi"]
    body = (np.hypot((xx - 32) / 3.5, (yy - 26) / 7) < 1) & shield
    wings = (np.abs(yy - 24 - np.abs(xx - 32) * 0.35) < 2.6) & (np.abs(xx - 32) < 10) & shield
    heads = (np.hypot(xx - 28.5, yy - 17) < 2.2) | (np.hypot(xx - 35.5, yy - 17) < 2.2)
    c[body | wings | heads] = C["lo"] * 0.9
    crown = (yy > 6) & (yy < 12) & (np.abs(xx - 32) < 8) & ((yy > 9) | (np.abs(((xx - 24) % 5) - 2.5) < 1.2))
    c[crown] = C["lo"] * 0.9
    for x in (12, 52):  # the shield bearers, worn to shapes
        c[(np.abs(xx - x) < 3.5) & (yy > 16) & (yy < 42)] = C["stone"] * 0.8
        c[np.hypot(xx - x, yy - 13) < 3] = C["stone"] * 0.8
    noise(c, 0.05)

    c = cell("st_saltire")
    stone_bg(c, 6)
    c[2:46, 2:62] = C["lo"]
    c[4:44, 4:60] = C["stone"] * 1.02
    xx, yy = grid(48, 64)
    for sgn in (-1, 1):  # the ragged cross of Burgundy
        d = np.abs((yy - 24) - sgn * (xx - 32) * 0.75)
        rag = d < 2.4 + 0.9 * (np.sin(xx * 1.7) > 0.6)
        c[rag & (np.abs(xx - 32) < 18)] = C["lo"] * 0.9
    c[np.hypot(xx - 32, yy - 24) < 4] = C["hi"]  # the fire steel
    for x in (9, 55):  # the pillars of Hercules
        c[8:42, x - 2:x + 3] = C["hi"] * 1.05
        c[6:9, x - 4:x + 5] = C["hi"] * 1.1
        c[41:44, x - 4:x + 5] = C["hi"] * 1.1
    noise(c, 0.05)

    c = cell("st_bars")
    stone_bg(c, 6)
    barred(c, 5, 4, 27, 60, frame=3, step=4)
    noise(c, 0.04)
    c = cell("st_smallbar")
    stone_bg(c, 6)
    barred(c, 6, 6, 26, 26, frame=3, step=4)
    noise(c, 0.04)

    c = cell("st_oculus")
    stone_bg(c, 6)
    xx, yy = grid(32, 32)
    d = np.hypot(xx - 16, yy - 16)
    c[d < 13] = C["hi"]
    c[d < 10] = C["glass"]
    c[(d < 10) & ((np.abs(xx - 16) < 1) | (np.abs(yy - 16) < 1))] = C["iron"]
    noise(c, 0.04)

    c = cell("st_twolight")
    stone_bg(c, 6)
    mk = shape_mask(48, 60, arch_shape(0.72, 3))
    sub = c[2:62, 8:56]
    sub[mk] = C["hi"]
    inner = erode(mk, 3)
    g = np.broadcast_to(C["glass"], sub.shape).copy()
    g[:, ::4] = C["iron"]
    g[::8, :] = C["iron"]
    sub[inner] = g[inner]
    sub[:, 23:25][inner[:, 23:25]] = C["hi"]  # the mullion
    sub[20:22][inner[20:22]] = C["hi"]  # the transom
    am = shape_mask(20, 12, arch_shape(0.3, 2))
    e = am & ~erode(am)
    for cx in (12, 36):  # the little heads of the two lights
        box = sub[8:20, cx - 10:cx + 10]
        box[e] = C["hi"]
    noise(c, 0.04)

    c = cell("st_door")
    stone_bg(c, 6)
    mk = shape_mask(52, 60, DOOR4)
    sub = c[4:64, 6:58]
    sub[mk] = C["hi"] * 1.04
    ring = erode(mk, 2)
    sub[ring] = C["lo"]
    inner = erode(mk, 4)
    wood = np.broadcast_to(C["wood"], sub.shape).copy()
    wood[:, ::6] = C["wood2"]
    wood *= (0.9 + 0.2 * rng.random(sub.shape[:2])[..., None]).astype(np.float32)
    sub[inner] = wood[inner]
    for y in (14, 30, 46):  # the iron straps
        sub[y:y + 2][inner[y:y + 2]] = C["iron"]
    sub[26:58, 30:31] = C["iron"]  # the wicket in the right leaf
    sub[26:27, 30:44] = C["iron"]
    sub[26:58, 43:44] = C["iron"]
    sub[40:42, 32:34] = C["gold"] * 0.6  # its latch
    sub[:, 25:27][inner[:, 25:27]] = C["wood2"] * 0.7
    noise(c, 0.03)

    c = cell("st_arched_door")
    stone_bg(c, 6, "blue")
    mk = shape_mask(40, 60, ROUNDTOP)
    sub = c[4:64, 12:52]
    sub[mk] = C["hi"] * 0.9
    inner = erode(mk, 3)
    wood = np.broadcast_to(C["wood2"], sub.shape).copy()
    wood[:, ::5] = C["wood2"] * 0.7
    sub[inner] = wood[inner]
    for y in (18, 40):
        sub[y:y + 2][inner[y:y + 2]] = C["iron"]
    noise(c, 0.04)

    c = cell("st_tiles")
    c[:] = C["tile"]
    for row in range(0, 64, 8):
        c[row] = C["tile"] * 0.45
        for col in range(((row // 8) % 2) * 4, 64, 8):
            c[row + 1:row + 8, col:col + 3] *= 1.18
            c[row + 1:row + 8, min(63, col + 6)] *= 0.7
    c *= (0.85 + 0.3 * rng.random((64, 64, 1))).astype(np.float32)
    c[rng.random((64, 64)) < 0.03] = C["stone"] * 0.6  # lichen

    c = cell("st_crossbar")
    stone_bg(c, 6)
    barred(c, 10, 6, 54, 58, frame=4, step=5, cross=False)
    c[6:58, 30:34] = C["hi"]
    c[24:28, 10:54] = C["hi"]
    noise(c, 0.04)

    def house(c, door):
        c[:] = C["brick"]
        h, w = c.shape[:2]
        for y in range(0, h, 3):
            c[y] *= 0.8
        c *= (0.9 + 0.2 * rng.random((h, w, 1))).astype(np.float32)
        for x0 in ((6, 40) if door else (6, 23, 40)):
            if door and x0 == 40:
                c[20:62, 40:56] = C["white"]
                c[22:62, 42:54] = C["shutter"] * 0.8  # the door
                c[34, 50:52] = C["gold"]
                continue
            y0 = 18 if door else 8
            c[y0:y0 + 26, x0:x0 + 16] = C["white"]
            c[y0 + 2:y0 + 24, x0 + 2:x0 + 14] = C["glass"]
            c[y0:y0 + 26, x0 + 7:x0 + 9] = C["white"]
            c[y0 + 10:y0 + 12, x0:x0 + 16] = C["white"]
            c[y0:y0 + 26, max(0, x0 - 3):x0] = C["shutter"]
        noise(c, 0.03)

    house(cell("st_house"), True)
    house(cell("st_housewin"), False)
    return np.clip(A, 0, 1)


def steen_materials():
    if "steen_atlas" in bpy.data.materials:
        return
    import numpy as np

    px = paint_steen_atlas()
    img = bpy.data.images.new("steen_atlas", SAT, SAT, alpha=False)
    rgba = np.ones((SAT, SAT, 4), np.float32)
    rgba[..., :3] = np.flipud(px)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    mt = bpy.data.materials.new("steen_atlas")
    nt = mt.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    mt.diffuse_color = (0.55, 0.5, 0.42, 1)


class SMesh(CMesh):
    """The Steen: the cathedral mesh plus its own atlas, a stone tint (blue-grey Tournai stone below,
    the yellowish sandstone of the 1520s above) and a little per-face weathering."""

    mats = STEEN_MATS

    def __init__(self, frame):
        super().__init__(frame)
        import random

        self.rng = random.Random(1520)
        self.tint = (1.0, 1.0, 1.0)
        self.jit = 0.0

    def poly(self, pts, mat, shade=1.0):
        if mat in (STONE, SATLAS) and self.jit:
            shade *= 1 + self.rng.uniform(-self.jit, self.jit)
        f = Mesh.poly(self, pts, mat, shade)
        if f is not None and mat in (STONE, SATLAS) and self.tint != (1.0, 1.0, 1.0):
            for loop in f.loops:
                c = loop[self.col]
                loop[self.col] = (c[0] * self.tint[0], c[1] * self.tint[1], c[2] * self.tint[2], 1.0)
        return f

    def tex(self, pts, cell, shape=RECT, shade=1.0, out=None):
        if cell in SCELL:
            return self.upoly(pts, [scell_uv(cell, x, t) for x, t in shape], SATLAS, shade, out)
        return super().tex(pts, cell, shape, shade, out)


def steen4(fr):
    """Het Steen in 1873: the museum of antiquities (from 1862, open 1864) in the old castle gate and
    prison, still built in among the houses of the Burcht. Rough blue-grey Tournai stone below, the
    sandstone of Charles V's rebuilding (c. 1520) above; a big three-quarter round tower on the corner
    by the river and a smaller one at the gate, both with conical slate roofs; stepped gables; a
    corbelled battlement on the river side; a corbelled turret; small barred windows, slits, two oculi.
    The Steenpoort: a pointed arch in a plain stone gate block with a tiled roof, the Semini relief in
    its niche above, a round tower at its east side. Inside the gate, on the lane: Charles V's gatehouse
    front with its oriel and the museum door; the prison range with its barred windows and the painted
    museum name; a small brick house built against the north end. A calvary outside the gate."""
    cath_materials()
    steen_materials()
    f = Frame({"c": fr.c, "ax": [1.0, 0.0], "n": [0.0, 1.0], "L": fr.L, "W": fr.W})
    m = SMesh(f)
    U0, U1, V0, V1 = -f.L / 2, f.L / 2, -f.W / 2, f.W / 2  # -17, 17, -8.25, 8.25
    a0, a1, b0, b1 = U0 + 0.25, U1 - 0.25, V0 + 0.25, V1 - 0.25  # the wall faces; the plinth at the fp edge
    TOUR, SAND, BRK, DARK = (0.64, 0.68, 0.74), (1.0, 0.93, 0.8), (0.86, 0.56, 0.46), (0.5, 0.5, 0.52)
    BASE = 4.5  # the Tournai stone reaches this high

    def st(t, jit=0.07):
        m.tint, m.jit = t, jit

    def mass(u0, u1, v0, v1, y1, top=False, base=BASE):
        st(TOUR)
        m.box(u0, u1, v0, v1, -1.0, base, STONE, top=False, shade=0.8)
        st(SAND)
        m.box(u0, u1, v0, v1, base, y1, STONE, top=top, top_mat=LEAD, shade=0.95)

    def tiled(p00, p10, p11, p01, cell, nu, nv, out, shade=1.0):
        def q(a, b):
            return tuple(p00[k] * (1 - a) * (1 - b) + p10[k] * a * (1 - b) + p11[k] * a * b + p01[k] * (1 - a) * b for k in range(3))
        for i in range(nu):
            for j in range(nv):
                m.tex([q(i / nu, j / nv), q((i + 1) / nu, j / nv), q((i + 1) / nu, (j + 1) / nv), q(i / nu, (j + 1) / nv)], cell, shade=shade, out=out)

    def tile_roof(u0, u1, v0, v1, y, rise, along="u", over=0.3, n=2.0):
        """A pantiled saddle roof (the atlas cell repeated every n metres)."""
        if along == "u":
            vm = (v0 + v1) / 2
            yl = y - over * rise / ((v1 - v0) / 2)
            nu = max(1, round((u1 - u0) / n))
            nv = max(1, round(math.hypot((v1 - v0) / 2 + over, rise) / n))
            tiled((u0, v0 - over, yl), (u1, v0 - over, yl), (u1, vm, y + rise), (u0, vm, y + rise), "st_tiles", nu, nv, (0, -1, 1))
            tiled((u1, v1 + over, yl), (u0, v1 + over, yl), (u0, vm, y + rise), (u1, vm, y + rise), "st_tiles", nu, nv, (0, 1, 1))
            for ue, uo in ((u0, -1), (u1, 1)):
                m.orient(m.poly([(ue, v0, y), (ue, v1, y), (ue, vm, y + rise)], STONE, 0.9), (uo, 0, 0))
        else:
            um = (u0 + u1) / 2
            yl = y - over * rise / ((u1 - u0) / 2)
            nv = max(1, round((v1 - v0) / n))
            nu = max(1, round(math.hypot((u1 - u0) / 2 + over, rise) / n))
            tiled((u0 - over, v1, yl), (u0 - over, v0, yl), (um, v0, y + rise), (um, v1, y + rise), "st_tiles", nv, nu, (-1, 0, 1))
            tiled((u1 + over, v0, yl), (u1 + over, v1, yl), (um, v1, y + rise), (um, v0, y + rise), "st_tiles", nv, nu, (1, 0, 1))
            for ve, vo in ((v0, -1), (v1, 1)):
                m.orient(m.poly([(u0, ve, y), (u1, ve, y), (um, ve, y + rise)], STONE, 0.9), (0, vo, 0))

    def sgable(p, d, o, s0, s1, y0, rise, steps=4, crown=0.9, t=0.5, shade=0.95, wins=()):
        """A stepped gable with thickness, standing on a wall top (p a point of the wall face, d along
        it, o out of it); wins: (s, y0, y1, w, cell) decals on its face."""
        hw = (s1 - s0) / 2
        w = 2 * hw / (2 * steps + 1)
        left = [(s0, y0)]
        for k in range(steps):
            y = y0 + rise * (k + 1) / (steps + 1)
            left += [(s0 + k * w, y), (s0 + (k + 1) * w, y)]
        ytop = y0 + rise + crown
        left += [(s0 + steps * w, ytop)]
        loop = left + [(s0 + s1 - s, y) for s, y in reversed(left)]
        P = lambda s, y, e: (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)  # noqa: E731
        m.orient(m.poly([P(s, y, 0.02) for s, y in loop], STONE, shade), (o[0], o[1], 0))
        m.orient(m.poly([P(s, y, -t) for s, y in loop], STONE, shade * 0.9), (-o[0], -o[1], 0))
        for i in range(len(loop) - 1):
            (sa, ya), (sb, yb) = loop[i], loop[i + 1]
            ns, ny = -(yb - ya), (sb - sa)  # the loop runs clockwise: outward is to the left
            m.orient(m.poly([P(sa, ya, 0.02), P(sb, yb, 0.02), P(sb, yb, -t), P(sa, ya, -t)], STONE, 1.05 if ny > 0 else 0.9),
                     (d[0] * ns, d[1] * ns, ny))
        for s, wy0, wy1, ww, cl in wins:
            m.decal(p, d, o, s - ww / 2, s + ww / 2, wy0, wy1, cl, off=0.07)

    def tface(cu, cv, r, sides, ang):
        """The face of an ngon tower nearest a direction: its middle point, along, out, width."""
        k = round((ang * sides / math.pi - 1) / 2) % sides
        a = (2 * k + 1) * math.pi / sides
        o = (math.cos(a), math.sin(a))
        rr = r * math.cos(math.pi / sides)
        return (cu + o[0] * rr, cv + o[1] * rr), (-o[1], o[0]), o, 2 * r * math.sin(math.pi / sides)

    def tower(cu, cv, r, y1, roof_top, sides=14, over=0.35, deco=(), vane=False):
        """A round tower: Tournai plinth and base, sandstone above, a corbelled rim, a conical slate
        roof. deco: (angle, y0, y1, width, cell)."""
        st(TOUR, 0.05)
        m.prism(m.ngon(cu, cv, r + 0.25, sides), -1.0, 0.7, STONE, top=True, shade=0.7)
        m.prism(m.ngon(cu, cv, r, sides), -1.0, BASE, STONE, top=False, shade=0.8)
        st(SAND, 0.05)
        m.prism(m.ngon(cu, cv, r, sides), BASE, y1 - 1.0, STONE, top=False, shade=0.95)
        m.prism(m.ngon(cu, cv, r + 0.1, sides), BASE - 0.14, BASE + 0.06, STONE, top=False, shade=1.06)  # the string course
        m.prism(m.ngon(cu, cv, r + 0.3, sides), y1 - 1.0, y1, STONE, top=False, shade=1.02)  # the corbelled rim
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            pu, pv = cu + math.cos(a) * (r + 0.12), cv + math.sin(a) * (r + 0.12)
            m.box(pu - 0.14, pu + 0.14, pv - 0.14, pv + 0.14, y1 - 1.7, y1 - 1.0, STONE, top=False, shade=0.8)
        eave = m.ngon(cu, cv, r + 0.3 + over, sides)
        m.pyramid(eave, y1, roof_top, SLATE)
        m.orient(m.poly([(q[0], q[1], y1) for q in eave], SLATE, 0.5), (0, 0, -1))  # the eaves' underside
        m.box(cu - 0.05, cu + 0.05, cv - 0.05, cv + 0.05, roof_top - 0.3, roof_top + 1.6, LEAD)
        m.prism(m.ngon(cu, cv, 0.12, 6), roof_top + 0.2, roof_top + 0.45, LEAD, top=True)
        if vane:
            m.box(cu - 0.02, cu + 0.02, cv, cv + 0.75, roof_top + 1.05, roof_top + 1.45, GILT)
        for ang, y0, yy1, w, cl in deco:
            pt, d, o, fw = tface(cu, cv, r, sides, ang)
            ww = min(w, fw * 0.92)
            m.decal(pt, d, o, -ww / 2, ww / 2, y0, yy1, cl, ROUNDTOP if cl == "st_arched_door" else RECT, off=0.04)
        st(SAND)

    def corbel_parapet(p, d, o, s0, s1, y, proj=0.4, h=1.0, merlon=0.8, step=1.3):
        """Machicolations: a row of corbels carrying a projecting parapet, with merlons on top."""
        k = s0 + 0.35
        while k < s1 - 0.2:
            _wbox(m, p, d, o, k - 0.16, k + 0.16, 0.0, proj, y - 0.9, y, STONE, 0.8, top=False)
            k += 0.75
        _wbox(m, p, d, o, s0, s1, -0.3, proj, y, y + h, STONE, 0.98, top=True)
        k = s0 + 0.1
        while k + merlon <= s1:
            _wbox(m, p, d, o, k, k + merlon, proj - 0.45, proj, y + h, y + h + merlon * 1.1, STONE, 1.0, top=True)
            k += step

    def chimney(u, v, y0, y1, w=0.9, dd=0.6):
        st(BRK, 0.08)
        m.box(u - w / 2, u + w / 2, v - dd / 2, v + dd / 2, y0, y1, STONE, top=False, shade=0.8)
        m.box(u - w / 2 - 0.1, u + w / 2 + 0.1, v - dd / 2 - 0.1, v + dd / 2 + 0.1, y1, y1 + 0.2, STONE, top=True, top_mat=LEAD, shade=0.9)
        st(SAND)

    R = (0, b0), (1, 0), (0, -1)  # the river front
    LN = (0, b1), (1, 0), (0, 1)  # the lane front
    S = (a0, 0), (0, 1), (-1, 0)  # the south end

    # ---- the plinth round the whole block (Tournai stone, a little batter)
    st(TOUR, 0.05)
    m.prism([(U0, V0), (U1, V0), (U1, V1), (U0, V1)], -1.0, 0.55, STONE, top=False, shade=0.66)
    m.prism([(U0 + 0.12, V0 + 0.12), (U1 - 0.12, V0 + 0.12), (U1 - 0.12, V1 - 0.12), (U0 + 0.12, V1 - 0.12)], 0.55, 0.8, STONE, top=True, shade=0.75)

    # ---- the river range, south part: the great hall, a corbelled battlement along the river
    hs0, hs1 = -10.6, 3.0
    mass(hs0, hs1, b0, -0.2, 12.5)
    corbel_parapet(*R, hs0, hs1, 12.5)
    st(SAND)
    m.gable_roof(hs0, hs1, b0 + 0.6, -0.2, 12.5, 6.4, along="u", gable_mat=STONE, over=0.0)
    for uu in (-6.8, -0.8):  # dormers behind the battlement
        _roof_dormer(m, (0, b0 + 0.6), (1, 0), (0, -1), uu, 0.0, 12.5, -(-0.2 - b0 - 0.6) / 2, 18.9, 13.9, 1.2, 1.7)
    for uu in (-8.0, -3.8, 0.6):
        m.decal(*R, uu - 0.22, uu + 0.22, 1.2, 3.0, "slit")
        m.decal(*R, uu + 1.1, uu + 1.9, 5.0, 6.1, "st_smallbar")
    for uu in (-6.0, -1.4):
        m.decal(*R, uu - 0.5, uu + 0.5, 7.6, 8.6, "st_oculus")
    m.decal(*R, -9.8, -9.2, 9.4, 11.2, "slit")
    # its stepped gable over the lower north part
    sgable((hs1, 0), (0, 1), (1, 0), b0 + 0.6, -0.2, 12.5, 6.4, steps=4, wins=((-4.0, 13.4, 14.6, 0.7, "st_smallbar"),))

    # ---- the river range, north part: tiled roof, cross windows, a corbelled turret
    hn0, hn1 = 3.0, 12.6
    mass(hn0, a1, b0, -0.2, 11.0)
    tile_roof(hn0, a1, b0, -0.2, 11.0, 6.2, along="u", over=0.35)
    for uu in (4.8, 8.2):
        m.decal(*R, uu - 0.4, uu + 0.4, 1.4, 2.6, "st_smallbar")
    for uu in (5.6, 8.8):
        m.decal(*R, uu - 0.8, uu + 0.8, 5.2, 8.2, "st_crossbar")
    for uu in (7.4, 13.6):
        _roof_dormer(m, (0, b0), (1, 0), (0, -1), uu, 0.35, 11.0 - 0.35 * 6.2 / 3.9, -(-0.2 - b0) / 2, 17.2, 12.6, 1.4, 1.9)
    m.decal(*R, 14.4, 15.4, 1.3, 2.5, "st_smallbar")
    # the corbelled turret (on a squinch cone, loopholes, a conical cap) near the corner
    tcu, tcv, tr = 11.3, b0 - 0.35, 1.05
    ring = m.ngon(tcu, tcv, tr, 10)
    st(SAND, 0.05)
    m.prism(ring, 5.8, 9.8, STONE, top=False, shade=0.95)
    m.frustum(m.ngon(tcu, tcv + 0.9, 0.15, 10), 4.4, ring, 5.8, STONE, 0.8)
    m.prism(m.ngon(tcu, tcv, tr + 0.12, 10), 9.4, 9.8, STONE, top=False, shade=1.05)
    m.pyramid(m.ngon(tcu, tcv, tr + 0.3, 10), 9.8, 12.6, SLATE)
    m.box(tcu - 0.04, tcu + 0.04, tcv - 0.04, tcv + 0.04, 12.4, 13.3, LEAD)
    for ang in (-math.pi / 2, -math.pi / 2 - 0.9, -math.pi / 2 + 0.9):
        pt, d, o, fw = tface(tcu, tcv, tr, 10, ang)
        m.decal(pt, d, o, -0.12, 0.12, 6.6, 8.2, "slit", off=0.03)

    # its stepped gable on the square, a cross window under it
    N = (a1, 0), (0, 1), (1, 0)
    sgable(*N, b0, -0.2, 11.0, 6.2, steps=4, wins=((-4.1, 12.3, 13.9, 0.9, "st_twolight"),))
    m.decal(*N, -5.9, -4.3, 5.4, 8.4, "st_crossbar")
    m.decal(*N, -2.4, -1.6, 5.8, 7.4, "st_bars")
    m.decal(*N, -6.6, -6.0, 1.4, 2.8, "slit")
    m.decal(*N, -3.4, -2.6, 1.4, 2.6, "st_smallbar")

    # ---- the small brick house built against the north-east corner, on the square and the lane
    # (in 1873 the whole Steen was built in among houses)
    hv0 = 0.2
    st(BRK, 0.04)
    m.box(hn1, a1, hv0, b1, -1.0, 7.4, STONE, top=False, shade=0.85)
    st((1.0, 1.0, 1.0), 0.0)
    m.tex([(a1 + 0.03, hv0, 0), (a1 + 0.03, b1, 0), (a1 + 0.03, b1, 3.8), (a1 + 0.03, hv0, 3.8)], "st_house", out=(1, 0, 0))
    m.tex([(a1 + 0.03, hv0, 3.8), (a1 + 0.03, b1, 3.8), (a1 + 0.03, b1, 7.2), (a1 + 0.03, hv0, 7.2)], "st_housewin", out=(1, 0, 0))
    m.tex([(hn1, b1 + 0.03, 3.8), (a1, b1 + 0.03, 3.8), (a1, b1 + 0.03, 7.2), (hn1, b1 + 0.03, 7.2)], "st_housewin", out=(0, 1, 0))
    tile_roof(hn1, a1 + 0.3, hv0, b1, 7.4, 3.6, along="u", over=0.3)
    st(BRK, 0.04)
    sgable((a1, 0), (0, 1), (1, 0), hv0, b1, 7.4, 3.6, steps=3, crown=0.5, t=0.3, shade=0.9)
    chimney(14.6, 4.6, 9.4, 12.2, 0.7, 0.5)
    st(SAND)

    # ---- the big three-quarter round tower on the corner by the river
    tower(-13.55, -4.8, 3.2, 16.2, 25.4, sides=18, vane=True,
          deco=((math.pi, 0.2, 2.9, 1.3, "st_arched_door"), (math.pi, 6.0, 7.6, 0.4, "slit"), (-math.pi / 2, 3.0, 4.8, 0.4, "slit"),
                (-math.pi * 0.75, 8.6, 9.6, 0.7, "st_smallbar"), (-math.pi / 2, 11.6, 12.8, 0.7, "st_smallbar"), (math.pi * 0.9, 12.0, 13.6, 0.4, "slit")))

    # ---- the south range: a blind wall, the stepped gable with its three small windows over the little fish market
    mass(a0, -9.4, -3.0, 4.2, 12.0)
    mass(-12.2, -9.4, 4.2, b1, 10.6, top=True)  # the link to the gatehouse, lead-topped
    m.gable_roof(a0 + 0.3, -9.4, -3.0, 4.2, 12.0, 6.8, along="u", gable_mat=STONE, over=0.1)
    sgable((a0, 0), (0, 1), (-1, 0), -3.0, 4.2, 12.0, 7.0, steps=4,
           wins=((-1.8, 13.4, 14.2, 0.6, "st_smallbar"), (0.6, 13.4, 14.2, 0.6, "st_smallbar"), (3.0, 13.4, 14.2, 0.6, "st_smallbar")))
    for vv in (-1.0, 2.4):
        m.decal(*S, vv - 0.2, vv + 0.2, 2.0, 3.6, "slit")
    m.decal(*S, 0.3, 0.9, 6.4, 7.2, "st_smallbar")

    # ---- the round tower at the gate's west side
    tower(-14.15, 5.4, 2.6, 14.0, 21.4, sides=16,
          deco=((math.pi, 0.2, 2.6, 1.1, "st_arched_door"), (math.pi, 5.6, 7.0, 0.36, "slit"), (math.pi * 0.8, 9.2, 10.4, 0.6, "st_smallbar"),
                (math.pi / 2, 7.0, 8.4, 0.36, "slit")))

    # ---- Charles V's gatehouse on the lane: the oriel over the door, a tall stepped gable to the lane
    g0, g1 = -9.4, -3.6
    mass(g0, g1, -0.2, b1, 12.6)
    m.gable_roof(g0, g1, -0.2, b1 - 0.4, 12.6, 5.6, along="v", gable_mat=STONE, over=0.25)
    sgable((0, b1), (1, 0), (0, 1), g0, g1, 12.6, 8.0, steps=5, crown=1.0, wins=((-6.5, 14.4, 16.4, 0.9, "st_twolight"),))
    gc = -6.5
    # the portal: short thick columns with tall capitals, a four-centred door, corbels over it
    st(SAND, 0.03)
    for sg in (-1, 1):
        cu = gc + sg * 1.6
        m.prism(m.ngon(cu, b1 + 0.3, 0.3, 8), 0.0, 2.7, STONE, top=False, shade=1.0)
        m.prism(m.ngon(cu, b1 + 0.3, 0.42, 8), 2.7, 3.3, STONE, top=True, shade=1.08)
        m.prism(m.ngon(cu, b1 + 0.3, 0.38, 8), -0.2, 0.35, STONE, top=True, shade=0.9)
    m.decal(*LN, gc - 1.25, gc + 1.25, 0.0, 3.6, "st_door", DOOR4, off=0.05)
    m.door("Steen, museum door (Charles V's gate)", (gc, V1, 0))
    _wbox(m, *LN, gc - 2.0, gc + 2.0, 0.0, 0.32, 3.3, 3.6, STONE, 1.05, top=True)  # the string course over the capitals
    for s in (gc - 1.6, gc + 1.6):
        _wbox(m, *LN, s - 0.25, s + 0.25, 0.0, 0.6, 3.6, 4.2, STONE, 0.9, top=True)  # the corbels carrying the oriel
    _wbox(m, *LN, gc - 1.3, gc + 1.3, 0.0, 0.5, 3.9, 4.2, STONE, 0.85, top=False)
    # the three-sided oriel: carved panels under tall barred windows, a slate cap
    oy0, oy1, ob = 4.2, 10.6, b1
    op = [(gc - 1.75, ob), (gc - 0.95, ob + 0.85), (gc + 0.95, ob + 0.85), (gc + 1.75, ob)]
    m.orient(m.poly([(q[0], q[1], oy0) for q in op], STONE, 0.7), (0, 0, -1))
    for i in range(3):
        pa, pb = op[i], op[i + 1]
        du, dv = pb[0] - pa[0], pb[1] - pa[1]
        Ln = math.hypot(du, dv)
        d = (du / Ln, dv / Ln)
        o = (d[1], -d[0])
        if o[1] < 0:
            o = (-o[0], -o[1])
        m.orient(m.poly([(pa[0], pa[1], oy0), (pb[0], pb[1], oy0), (pb[0], pb[1], oy1), (pa[0], pa[1], oy1)], STONE, 1.0), (o[0], o[1], 0))
        m.decal(pa, d, o, 0.08, Ln - 0.08, 4.35, 5.75, "st_arms" if i == 1 else "st_saltire", off=0.04)
        m.decal(pa, d, o, 0.12, Ln - 0.12, 6.1, 10.1, "st_twolight" if i == 1 else "st_bars", off=0.04)
        _wbox(m, pa, d, o, -0.05, Ln + 0.05, 0.0, 0.14, 5.85, 6.0, STONE, 1.08, top=True)
        _wbox(m, pa, d, o, -0.05, Ln + 0.05, 0.0, 0.2, 10.4, 10.6, STONE, 1.08, top=True)
    m.pyramid(op + [(gc, ob - 0.6)], 10.6, 12.2, SLATE)
    # the barred windows of the gatehouse beside the oriel
    for s in (g0 + 0.8, g1 - 0.8):
        m.decal(*LN, s - 0.4, s + 0.4, 5.4, 7.6, "st_bars")
        m.decal(*LN, s - 0.4, s + 0.4, 8.6, 10.6, "st_bars")

    # ---- the prison range on the lane: two storeys of barred windows, the museum's painted name, dormers
    e0, e1 = -3.6, hn1
    mass(e0, e1, -0.2, b1, 10.4)
    m.gable_roof(e0, e1, -0.2, b1, 10.4, 6.0, along="u", gable_mat=STONE, over=0.3)
    sgable((e1, 0), (0, 1), (1, 0), -0.2, b1, 10.4, 6.0, steps=4, wins=((4.0, 11.2, 12.6, 0.8, "st_smallbar"),))
    for k, uu in enumerate((-1.9, 1.3, 4.5, 7.7, 10.9)):
        m.decal(*LN, uu - 0.7, uu + 0.7, 1.2, 3.9, "st_crossbar" if k == 4 else "st_bars")
        m.decal(*LN, uu - 0.7, uu + 0.7, 5.8, 8.7, "st_bars")
    m.decal(*LN, -0.4, 6.4, 4.35, 5.4, "st_band", off=0.05)
    for uu in (1.3, 7.7):
        _roof_dormer(m, (0, b1), (1, 0), (0, 1), uu, 0.3, 10.4 - 0.3 * 6.0 / 4.1, -(b1 + 0.2) / 2, 16.4, 11.3, 1.3, 1.8)
    # the board by the door
    m.decal(*LN, gc + 2.15, gc + 3.45, 1.35, 2.0, "st_board", off=0.09)

    # ---- chimneys on the ridges
    chimney(-14.2, 0.6, 16.0, 20.4)
    chimney(-6.5, 2.0, 16.4, 19.6)
    chimney(2.2, 4.4, 14.0, 17.2)
    chimney(9.0, -4.6, 15.6, 18.6)
    chimney(-4.0, -4.6, 16.6, 19.8, 0.7, 0.5)

    # ---- the Steenpoort over the lane: a pointed arch through a plain gate block, a tiled roof, the
    # Semini niche above the arch, a round tower on its east side (outside the fp: a collider in the game)
    pu0, pu1 = a0, -13.0
    pv0, pv1 = b1, V1 + 4.9  # the passage: v 8.25..13.15 (world z 27..31.9)
    pc, phw, ph = (V1 + pv1) / 2, 2.25, 5.6
    st(TOUR, 0.05)
    for uf, o in ((pu0, (-1, 0)), (pu1, (1, 0))):
        _holed_wall(m, (uf, 0), (0, 1), o, pv0, pv1 + 1.0, 0.0, 8.6, [(pc, phw, ph, 0.6)], mat=STONE, shade=0.95 if o[0] < 0 else 0.85)
    arch = _arch_outline(phw, ph, 0.6)
    for i in range(len(arch) - 1):  # the soffit of the passage
        (sa, ya), (sb, yb) = arch[i], arch[i + 1]
        fcc = m.poly([(pu0, pc + sa, ya), (pu0, pc + sb, yb), (pu1, pc + sb, yb), (pu1, pc + sa, ya)], STONE, 0.5)
        m.orient(fcc, (0, -(sa + sb) / 2, -1 if (ya + yb) / 2 > 3.4 else 0))
    m.orient(m.poly([(pu0, pv0, 8.6), (pu1, pv0, 8.6), (pu1, pv1 + 1.0, 8.6), (pu0, pv1 + 1.0, 8.6)], STONE, 0.8), (0, 0, 1))
    tile_roof(pu0, pu1, pv0 - 0.2, pv1 + 1.0, 8.6, 2.3, along="v", over=0.3, n=1.6)
    # the Semini relief in its niche, a small stone hood with a slate pent over it
    st(TOUR, 0.0)
    m.decal((pu0, 0), (0, 1), (-1, 0), pc - 0.5, pc + 0.5, 6.1, 7.6, "st_semini", ROUNDTOP, off=0.03)
    _wbox(m, (pu0, 0), (0, 1), (-1, 0), pc - 0.7, pc + 0.7, 0.0, 0.35, 7.7, 7.9, STONE, 1.0, top=True)
    for sg in (-1, 1):
        _wbox(m, (pu0, 0), (0, 1), (-1, 0), pc + sg * 0.66 - 0.06, pc + sg * 0.66 + 0.06, 0.0, 0.3, 5.9, 7.7, STONE, 0.9, top=False)
    m.orient(m.poly([(pu0 - 0.45, pc - 0.8, 7.95), (pu0 - 0.45, pc + 0.8, 7.95), (pu0, pc + 0.8, 8.5), (pu0, pc - 0.8, 8.5)], SLATE, 0.9), (-1, 0, 1))
    # the east tower of the gate
    tower(-14.95, pv1 + 1.95, 1.9, 11.0, 16.4, sides=12,
          deco=((math.pi, 3.0, 4.4, 0.34, "slit"), (math.pi / 2, 6.0, 7.4, 0.34, "slit"), (math.pi * 0.75, 8.4, 9.2, 0.5, "st_smallbar")))

    # ---- the finer things: string courses where the Tournai stone meets the sandstone, sill courses,
    # lead on the ridges, iron wall anchors, downpipes, a lantern on a bracket at the gate
    st(SAND, 0.03)
    for u0_, u1_, v0_, v1_ in ((hs0, hs1, b0, -0.2), (hn0, a1, b0, -0.2), (a0, -9.4, -3.0, 4.2), (g0, g1, -0.2, b1), (e0, e1, -0.2, b1)):
        m.box(u0_ - 0.1, u1_ + 0.1, v0_ - 0.1, v1_ + 0.1, BASE - 0.14, BASE + 0.06, STONE, top=True, shade=1.06)
    _wbox(m, *LN, e0, e1, 0.0, 0.12, 5.55, 5.7, STONE, 1.08, top=True)  # the sill course of the upper floor
    _wbox(m, *LN, e0, e1, 0.0, 0.25, 10.2, 10.4, STONE, 1.05, top=True)  # the eaves cornice
    _wbox(m, *R, hn0, a1, 0.0, 0.25, 10.8, 11.0, STONE, 1.05, top=True)
    for u0_, u1_, vm, yr in ((hs0, hs1, (b0 + 0.4) / 2, 18.9), (hn0, a1, (b0 - 0.2) / 2, 17.2), (e0, e1, (b1 - 0.2) / 2, 16.4), (a0 + 0.3, -9.4, 0.6, 18.8)):
        m.box(u0_, u1_, vm - 0.12, vm + 0.12, yr - 0.05, yr + 0.12, LEAD, top=True)
    m.box(g0 + 2.8, g0 + 3.0, -0.2, b1 - 0.4, 18.15, 18.32, LEAD, top=True)
    for uu in (-8.4, -5.4, -2.4, 0.6):  # iron anchors, the S-shaped ends of the floor beams
        m.box(uu - 0.04, uu + 0.04, b0 - 0.06, b0, 10.2, 10.8, LEAD, top=False, shade=0.6)
        m.box(uu - 0.04, uu + 0.04, b0 - 0.06, b0, 5.9, 6.5, LEAD, top=False, shade=0.6)
    for uu in (-0.3, 2.9, 6.1, 9.3):
        m.box(uu - 0.04, uu + 0.04, b1, b1 + 0.06, 9.3, 9.9, LEAD, top=False, shade=0.6)
        m.box(uu - 0.04, uu + 0.04, b1, b1 + 0.06, 4.9, 5.4, LEAD, top=False, shade=0.6)
    for vv in (-6.0, -3.0):
        m.box(a1, a1 + 0.06, vv - 0.04, vv + 0.04, 9.6, 10.2, LEAD, top=False, shade=0.6)
    for uu, yt in ((-3.4, 12.6), (12.3, 10.4)):  # downpipes on the lane front
        m.box(uu - 0.07, uu + 0.07, b1 + 0.02, b1 + 0.16, 0.0, yt, LEAD, top=True, shade=0.7)
        m.box(uu - 0.25, uu + 0.25, b1 + 0.02, b1 + 0.3, yt - 0.25, yt, LEAD, top=True, shade=0.7)
    for uu in (g0 + 0.8, g1 - 0.8):
        m.decal(*LN, uu - 0.35, uu + 0.35, 1.4, 2.6, "st_smallbar")
    # sandstone quoins, long and short, on the corners that show
    for (qu, qv, du, dv, yq) in ((a1, b0, -1, 1, 11.0), (g0, b1, 1, -1, 12.6), (g1, b1, -1, -1, 12.6)):
        k, y = 0, BASE + 0.1
        while y + 0.36 < yq:
            la, lb = (0.62, 0.34) if k % 2 == 0 else (0.34, 0.62)
            m.box(min(qu, qu + du * la), max(qu, qu + du * la), min(qv, qv - dv * 0.04), max(qv, qv - dv * 0.04) + 0.0, y, y + 0.34, STONE, top=True, shade=1.1)
            m.box(min(qu, qu - du * 0.04), max(qu, qu - du * 0.04), min(qv, qv + dv * lb), max(qv, qv + dv * lb), y, y + 0.34, STONE, top=True, shade=1.1)
            y += 0.38
            k += 1
    # the lantern on its bracket on the Steenpoort's outer face, east of the arch
    lv = V1 + 5.35
    m.box(a0 - 0.7, a0, lv - 0.03, lv + 0.03, 4.95, 5.02, LEAD, top=True)
    m.box(a0 - 0.7, a0 - 0.64, lv - 0.03, lv + 0.03, 4.6, 5.0, LEAD, top=False)
    m.box(a0 - 0.84, a0 - 0.5, lv - 0.17, lv + 0.17, 4.1, 4.55, GLASS, top=False)
    m.pyramid(m.ngon(a0 - 0.67, lv, 0.26, 4, math.pi / 4), 4.55, 4.8, LEAD)
    m.box(a0 - 0.8, a0 - 0.54, lv - 0.13, lv + 0.13, 4.02, 4.1, LEAD, top=True)

    # ---- the calvary outside the gate, against the Steen's south front over the little fish market
    # (the 1880 photograph: a big crucifix on a base with an iron railing, in the Steenstraat before the arch).
    # It faces -u; the game's walk map knows it (design.py DECOR solids).
    cu, cv = a0 - 0.7, 0.0  # world x -216.45 + ..., z 18.75
    st(TOUR, 0.03)
    m.box(cu - 0.45, cu + 0.45, cv - 0.6, cv + 0.6, 0.0, 0.9, STONE, top=True, shade=0.85)
    m.box(cu - 0.55, cu + 0.55, cv - 0.72, cv + 0.72, 0.9, 1.05, STONE, top=True, shade=1.0)
    st((1.0, 1.0, 1.0), 0.0)
    for k in range(9):  # the iron railing in front of it
        vv = cv - 1.0 + k * 0.25
        m.box(cu - 0.95, cu - 0.91, vv - 0.02, vv + 0.02, 0.0, 1.05, LEAD)
    m.box(cu - 0.97, cu - 0.89, cv - 1.02, cv + 1.02, 0.95, 1.05, LEAD)
    for sg in (-1, 1):
        m.box(cu - 0.95, a0, cv + sg * 1.0 - 0.02, cv + sg * 1.0 + 0.02, 0.0, 1.05, LEAD)
        m.box(cu - 0.95, a0, cv + sg * 1.0 - 0.03, cv + sg * 1.0 + 0.03, 0.95, 1.05, LEAD)
    st(DARK, 0.0)
    m.box(cu - 0.12, cu + 0.12, cv - 0.12, cv + 0.12, 1.05, 6.6, STONE, top=True, shade=0.5)  # the tarred cross
    m.box(cu - 0.12, cu + 0.12, cv - 1.1, cv + 1.1, 5.0, 5.28, STONE, top=True, shade=0.5)
    m.gable_roof(cu - 0.42, cu + 0.3, cv - 0.26, cv + 0.26, 6.45, 0.32, along="v", mat=LEAD, gable_mat=LEAD, over=0.05)
    st((0.95, 0.84, 0.72), 0.0)  # the corpus, painted in flesh colours
    m.box(cu - 0.27, cu - 0.12, cv - 0.14, cv + 0.14, 3.45, 4.85, STONE, top=True, shade=1.0)
    m.box(cu - 0.25, cu - 0.12, cv - 0.08, cv + 0.08, 2.7, 3.45, STONE, top=False, shade=0.95)
    m.box(cu - 0.28, cu - 0.12, cv - 0.09, cv + 0.09, 4.85, 5.08, STONE, top=True, shade=1.0)  # the head
    st((0.85, 0.83, 0.78), 0.0)
    m.box(cu - 0.29, cu - 0.12, cv - 0.16, cv + 0.16, 3.25, 3.6, STONE, top=True, shade=1.05)  # the loincloth
    st((0.95, 0.84, 0.72), 0.0)
    for sg in (-1, 1):
        m.orient(m.poly([(cu - 0.2, cv + sg * 0.12, 4.62), (cu - 0.2, cv + sg * 0.95, 4.98), (cu - 0.2, cv + sg * 0.95, 4.86),
                         (cu - 0.2, cv + sg * 0.12, 4.45)], STONE, 1.0), (-1, 0, 0))
    # its lamp on a bracket from the post
    m.box(cu - 0.55, cu - 0.1, cv - 0.02, cv + 0.02, 3.3, 3.36, LEAD, top=True)
    m.box(cu - 0.66, cu - 0.44, cv - 0.11, cv + 0.11, 2.95, 3.25, GLASS, top=False)
    m.pyramid(m.ngon(cu - 0.55, cv, 0.17, 4, math.pi / 4), 3.25, 3.42, LEAD)
    st(SAND)
    return m



def steen5_extras(m, RD, TY, NW0, st, mass, tower, sgable, corbel_parapet, chimney, tface, TOUR, SAND, DARK, BASE, a0, a1, b0, b1, U0, U1, V0, V1):
    """The restorers' Steen (1887-90), the parts steen4 does not have: the courtyard raised on its mound
    with a blue-stone balustrade, the curved ramp with balustrades and corner posts with obelisks, the
    neo-Gothic north wing, and the calvary at the ramp's foot. Local frame as steen4 (u = x, v = z)."""
    cx, cz = m.f.c
    BLUE = (0.72, 0.76, 0.82)  # blue stone (petit granit) for the balustrades and posts
    WOOD = (0.62, 0.46, 0.32)
    t0x, t0z, t1x, t1z = RD["terrace"]
    tu1, tv1 = t1x - cx, t1z - cz  # 8.0, 14.25
    cu0 = -13.0  # the courtyard begins behind the gate block

    def post(u, v, y, obelisk=True):
        st(BLUE, 0.02)
        m.box(u - 0.36, u + 0.36, v - 0.36, v + 0.36, y - 0.2, y + 1.3, STONE, top=True, shade=1.0)
        m.box(u - 0.44, u + 0.44, v - 0.44, v + 0.44, y + 1.3, y + 1.42, STONE, top=True, shade=1.08)
        if obelisk:  # 1890: obelisks on the corner posts (winged lions, gone since)
            m.box(u - 0.2, u + 0.2, v - 0.2, v + 0.2, y + 1.42, y + 1.62, STONE, top=True, shade=0.95)
            m.pyramid(m.ngon(u, v, 0.2, 4, math.pi / 4), y + 1.62, y + 3.3, STONE, 1.02)

    # ---- the courtyard on its mound: a retaining wall of Tournai stone, flagstones on top, a balustrade
    st(TOUR, 0.04)
    m.box(cu0, tu1, V1, tv1 + 0.4, -1.0, TY, STONE, top=True, shade=0.72)
    st(BLUE, 0.03)
    m.balustrade((cu0, tv1 + 0.2), (tu1, tv1 + 0.2), TY, (0, 1), h=1.0, piece=2.4)
    m.balustrade((tu1, tv1 + 0.2), (cu0, tv1 + 0.2), TY, (0, -1), h=1.0, piece=2.4)
    m.box(cu0, tu1, tv1 + 0.05, tv1 + 0.35, TY + 1.0, TY + 1.12, STONE, top=True, shade=1.05)  # the coping
    for u in (cu0 + 0.4, -5.0, 2.0, tu1 - 0.5):
        post(u, tv1 + 0.2, TY, obelisk=False)

    # ---- the ramp: the landing outside the Steenpoort, the curve, the straight run down to the ground
    line = [(x - cx, z - cz, y) for x, z, y in RD["line"]]
    half = RD["half"]

    def offs(i, d):
        u, v, _ = line[i]
        un, vn, _ = line[min(i + 1, len(line) - 1)]
        up, vp, _ = line[max(i - 1, 0)]
        tu, tv = un - up, vn - vp
        ln = math.hypot(tu, tv) or 1.0
        return (u - tv / ln * d, v + tu / ln * d)

    W = half + 0.35
    for i in range(len(line) - 1):
        ya, yb = line[i][2], line[i + 1][2]
        la, lb = offs(i, W), offs(i + 1, W)
        ra, rb = offs(i, -W), offs(i + 1, -W)
        st((0.9, 0.88, 0.84), 0.05)
        m.orient(m.poly([(la[0], la[1], ya), (ra[0], ra[1], ya), (rb[0], rb[1], yb), (lb[0], lb[1], yb)], STONE, 0.95), (0, 0, 1))
        if line[i][0] > a0 - 0.05:  # inside the gate: only the floor
            continue
        st(TOUR, 0.05)
        for p0, p1, sg in ((la, lb, 1), (ra, rb, -1)):
            if ya > 0.02 or yb > 0.02:
                f = m.poly([(p0[0], p0[1], -0.3), (p1[0], p1[1], -0.3), (p1[0], p1[1], yb), (p0[0], p0[1], ya)], STONE, 0.75)
                c = ((p0[0] + p1[0]) / 2 - (line[i][0] + line[i + 1][0]) / 2, (p0[1] + p1[1]) / 2 - (line[i][1] + line[i + 1][1]) / 2)
                m.orient(f, (c[0], c[1], 0))
        st(BLUE, 0.03)
        for sg in (1, -1):
            p0, p1 = offs(i, sg * (half + 0.2)), offs(i + 1, sg * (half + 0.2))
            m.tex([(p0[0], p0[1], ya), (p1[0], p1[1], yb), (p1[0], p1[1], yb + 1.0), (p0[0], p0[1], ya + 1.0)], "balustrade", out=(p0[0] - line[i][0], p0[1] - line[i][1], 0))
            q0, q1 = offs(i, sg * (half + 0.05)), offs(i + 1, sg * (half + 0.05))
            r0, r1 = offs(i, sg * (half + 0.35)), offs(i + 1, sg * (half + 0.35))
            m.orient(m.poly([(q0[0], q0[1], ya + 1.0), (r0[0], r0[1], ya + 1.0), (r1[0], r1[1], yb + 1.0), (q1[0], q1[1], yb + 1.0)], STONE, 1.08), (0, 0, 1))
    # the corner posts: at the landing's outer corners, where the curve begins, and at the foot
    n_land = max(i for i, p in enumerate(line) if p[2] >= TY - 1e-6)
    for i in (n_land, len(line) - 1):
        for sg in (1, -1):
            u, v = offs(i, sg * (half + 0.2))
            post(u, v, line[i][2], obelisk=(i == len(line) - 1))
    for sg in (1, -1):  # where the landing meets the gate
        u, v = offs(0, sg * (half + 0.2))
        post(a0 - 0.4, v, TY, obelisk=False)

    # ---- the north wing of 1887-90: the museum wing, the tall octagonal tower with its spire, the book
    # tower, the covered passage with its timber gallery, the round corner tower with an overhanging top
    R = (0, b0), (1, 0), (0, -1)
    N = (a1, 0), (0, 1), (1, 0)
    MY = 13.5
    mass(NW0, a1, b0, 3.2, MY)
    m.gable_roof(NW0 + 0.2, a1, b0, 3.2, MY, 7.4, along="u", gable_mat=STONE, over=0.3)
    sgable((NW0, 0), (0, 1), (-1, 0), b0, 3.2, MY, 7.4, steps=5, crown=1.0)
    sgable(*N, b0, 3.2, MY, 7.4, steps=5, crown=1.0, wins=((-2.4, MY + 1.2, MY + 4.0, 1.4, "st_twolight"),))
    for vv in (-4.6, -0.2):
        m.decal(*N, vv - 0.8, vv + 0.8, 5.0, 8.6, "st_twolight")
        m.decal(*N, vv - 0.8, vv + 0.8, 9.6, 12.6, "st_twolight")
    for uu in (9.6, 11.9):
        m.decal(*R, uu - 0.75, uu + 0.75, 5.2, 8.6, "st_twolight")
        m.decal(*R, uu - 0.75, uu + 0.75, 9.6, 12.4, "st_twolight")
        m.decal(*R, uu - 0.3, uu + 0.3, 1.6, 3.0, "st_smallbar")
    st(SAND, 0.03)
    m.box(NW0 - 0.1, a1 + 0.1, b0 - 0.1, 3.3, BASE - 0.14, BASE + 0.06, STONE, top=True, shade=1.06)
    _wbox(m, *R, NW0, a1, 0.0, 0.3, MY - 0.4, MY, STONE, 1.05, top=True)
    chimney(10.8, -2.4, MY + 4.0, MY + 8.2)
    # the tall octagonal tower at the corner by the river, its corbelled gallery with battlements, the spire
    ou, ov, orr = a1 - 1.9, b0 + 1.9, 2.35
    ring = m.ngon(ou, ov, orr, 8, math.pi / 8)
    st(TOUR, 0.04)
    m.prism(m.ngon(ou, ov, orr + 0.25, 8, math.pi / 8), -1.0, 0.7, STONE, top=True, shade=0.7)
    m.prism(ring, -1.0, BASE, STONE, top=False, shade=0.8)
    st(SAND, 0.04)
    m.prism(ring, BASE, 23.0, STONE, top=False, shade=0.97)
    for yc in (BASE, 10.0, 15.5, 19.8):
        m.prism(m.ngon(ou, ov, orr + 0.1, 8, math.pi / 8), yc - 0.14, yc + 0.06, STONE, top=False, shade=1.06)
    for ang in (math.pi * 0.0, -math.pi / 2, -math.pi / 4):
        for y0 in (6.0, 11.2, 16.4):
            pt, d, o, fw = tface(ou, ov, orr * 1.02, 8, ang + math.pi / 8)
            m.decal(pt, d, o, -0.42, 0.42, y0, y0 + 2.4, "st_twolight", off=0.04)
    for k in range(8):
        a_ = 2 * math.pi * (k + 0.5) / 8 + math.pi / 8
        pu, pv = ou + math.cos(a_) * (orr + 0.15), ov + math.sin(a_) * (orr + 0.15)
        m.box(pu - 0.18, pu + 0.18, pv - 0.18, pv + 0.18, 22.2, 23.0, STONE, top=False, shade=0.8)
    m.prism(m.ngon(ou, ov, orr + 0.45, 8, math.pi / 8), 23.0, 24.2, STONE, top=True, top_mat=LEAD, shade=1.02)
    for k in range(8):
        a_ = 2 * math.pi * k / 8 + math.pi / 8
        pu, pv = ou + math.cos(a_) * (orr + 0.3), ov + math.sin(a_) * (orr + 0.3)
        m.box(pu - 0.3, pu + 0.3, pv - 0.3, pv + 0.3, 24.2, 25.0, STONE, top=True, shade=1.02)
    m.pyramid(m.ngon(ou, ov, orr - 0.1, 8, math.pi / 8), 24.2, 41.0, SLATE)
    m.box(ou - 0.06, ou + 0.06, ov - 0.06, ov + 0.06, 40.6, 43.0, LEAD)
    m.prism(m.ngon(ou, ov, 0.16, 6), 41.2, 41.5, GILT, top=True)
    m.box(ou - 0.03, ou + 0.03, ov, ov + 0.9, 42.2, 42.7, GILT)
    # the square book tower: five storeys, a corbel frieze, stepped dormers breaking the cornice, a tent roof
    bu0, bu1, bv0, bv1, BY = 10.4, 15.4, 3.2, b1, 21.0
    mass(bu0, bu1, bv0, bv1, BY)
    st(SAND, 0.03)
    for yc in (8.0, 12.2, 16.4):
        m.box(bu0 - 0.1, bu1 + 0.1, bv0 - 0.1, bv1 + 0.1, yc - 0.12, yc + 0.06, STONE, top=True, shade=1.06)
    k = bu0 + 0.3
    while k < bu1 - 0.2:
        for vv, o in ((bv1, 1),):
            m.box(k - 0.14, k + 0.14, vv, vv + 0.35 * o, BY - 1.0, BY - 0.35, STONE, top=False, shade=0.8)
        k += 0.7
    m.box(bu0 - 0.3, bu1 + 0.3, bv0 - 0.3, bv1 + 0.3, BY - 0.35, BY, STONE, top=True, shade=1.05)
    m.pyramid([(bu0 - 0.35, bv0 - 0.35), (bu1 + 0.35, bv0 - 0.35), (bu1 + 0.35, bv1 + 0.35), (bu0 - 0.35, bv1 + 0.35)], BY, BY + 7.0, SLATE)
    m.box((bu0 + bu1) / 2 - 0.06, (bu0 + bu1) / 2 + 0.06, (bv0 + bv1) / 2 - 0.06, (bv0 + bv1) / 2 + 0.06, BY + 6.6, BY + 8.6, LEAD)
    E = (0, bv1), (1, 0), (0, 1)
    BN = (bu1, 0), (0, 1), (1, 0)
    BS = (bu0, 0), (0, 1), (-1, 0)
    for y0 in (9.0, 13.2, 17.2):
        m.decal(*E, bu0 + 1.4, bu0 + 3.6, y0, y0 + 2.6, "st_twolight")
        m.decal(*BN, bv0 + 1.2, bv1 - 1.2, y0, y0 + 2.6, "st_twolight")
    m.decal(*BS, bv0 + 1.1, bv1 - 1.1, 13.4, 15.8, "st_arms")  # the Burgraviate's arms (FORTUNATO ANTVERPIA)
    sgable(E[0], E[1], E[2], bu0 + 1.2, bu1 - 1.2, BY - 0.6, 2.8, steps=3, crown=0.5, t=0.4, wins=((bu0 + 2.5, BY - 0.2, BY + 1.3, 0.8, "st_smallbar"),))
    sgable(BN[0], BN[1], BN[2], bv0 + 1.0, bv1 - 1.0, BY - 0.6, 2.8, steps=3, crown=0.5, t=0.4)
    # the covered passage across the courtyard's end: a basket-arched doorway, heraldic shields, the timber gallery
    pu0, pu1, pv0, pv1 = NW0, a1, b1 + 0.25, tv1 + 0.4
    PY = TY + 4.8
    st(TOUR, 0.04)
    m.box(pu0, pu1, pv0, pv1, -1.0, TY, STONE, top=False, shade=0.75)
    st(SAND, 0.04)
    m.box(pu0, pu1, pv0, pv1, TY, PY, STONE, top=True, top_mat=LEAD, shade=0.95)
    S2 = (pu0, 0), (0, 1), (-1, 0)
    m.decal(*S2, pv0 + 1.0, pv1 - 1.6, TY, TY + 3.2, "st_arched_door", ROUNDTOP, off=0.04)
    for k in range(3):
        vv = pv0 + 1.2 + k * 1.3
        m.decal(*S2, vv - 0.4, vv + 0.4, TY + 3.5, TY + 4.4, "arms", DISC, off=0.05)
    Eo = (0, pv1), (1, 0), (0, 1)
    for uu in (9.5, 12.0):
        m.decal(*Eo, uu - 0.4, uu + 0.4, TY + 1.4, TY + 3.4, "st_bars")
    st(WOOD, 0.03)
    gu0, gu1 = pu0 + 0.3, a1 - 3.0
    m.box(gu0, gu1, pv0 + 0.3, pv1 - 0.3, PY, PY + 2.2, STONE, top=False, shade=0.8)
    for k in range(5):  # the five-part gallery: glazed bays between timber posts
        s0 = gu0 + 0.25 + k * (gu1 - gu0 - 0.5) / 5
        s1 = s0 + (gu1 - gu0 - 0.5) / 5 - 0.25
        f = m.poly([(s0, pv1 - 0.28, PY + 0.8), (s1, pv1 - 0.28, PY + 0.8), (s1, pv1 - 0.28, PY + 2.0), (s0, pv1 - 0.28, PY + 2.0)], GLASS, 0.9)
        m.orient(f, (0, 1, 0))
    for k in range(3):
        s0 = pv0 + 0.55 + k * (pv1 - pv0 - 1.1) / 3
        s1 = s0 + (pv1 - pv0 - 1.1) / 3 - 0.25
        f = m.poly([(gu0 - 0.02, s0, PY + 0.8), (gu0 - 0.02, s1, PY + 0.8), (gu0 - 0.02, s1, PY + 2.0), (gu0 - 0.02, s0, PY + 2.0)], GLASS, 0.9)
        m.orient(f, (-1, 0, 0))
    st(SAND)
    m.gable_roof(gu0, gu1, pv0 + 0.3, pv1 - 0.3, PY + 2.2, 1.8, along="u", gable_mat=STONE, over=0.25)
    # the round corner tower with its overhanging polygonal top and slate spire
    ru, rv, rr = a1 - 1.9, tv1 - 1.7, 1.8
    st(TOUR, 0.04)
    m.prism(m.ngon(ru, rv, rr + 0.25, 12), -1.0, 0.7, STONE, top=True, shade=0.7)
    m.prism(m.ngon(ru, rv, rr, 12), -1.0, BASE, STONE, top=False, shade=0.8)
    st(SAND, 0.04)
    m.prism(m.ngon(ru, rv, rr, 12), BASE, 14.0, STONE, top=False, shade=0.97)
    for k in range(8):
        a_ = 2 * math.pi * (k + 0.5) / 8
        pu, pv = ru + math.cos(a_) * (rr + 0.2), rv + math.sin(a_) * (rr + 0.2)
        m.box(pu - 0.16, pu + 0.16, pv - 0.16, pv + 0.16, 13.2, 14.0, STONE, top=False, shade=0.8)
    oct_ = m.ngon(ru, rv, rr + 0.55, 8, math.pi / 8)
    m.prism(oct_, 14.0, 16.8, STONE, top=False, shade=1.0)
    for ang in (math.pi / 2, 0.0, math.pi / 4):
        pt, d, o, fw = tface(ru, rv, (rr + 0.55) * 1.02, 8, ang + math.pi / 8)
        m.decal(pt, d, o, -0.4, 0.4, 14.5, 16.3, "st_twolight", off=0.04)
    for y0 in (6.5, 10.5):
        pt, d, o, fw = tface(ru, rv, rr * 1.02, 12, math.pi / 2)
        m.decal(pt, d, o, -0.3, 0.3, y0, y0 + 1.6, "slit", off=0.04)
    m.pyramid(m.ngon(ru, rv, rr + 0.7, 8, math.pi / 8), 16.8, 26.5, SLATE)
    m.box(ru - 0.05, ru + 0.05, rv - 0.05, rv + 0.05, 26.2, 28.0, LEAD)

    # ---- the calvary at the ramp's foot, facing the quay (+v) (DECOR calvary; the 1880 photograph)
    x0_, z0_, x1_, z1_ = RD["calvary"]
    cu, cv = (x0_ + x1_) / 2 - cx, z1_ - cz - 0.9
    st(TOUR, 0.03)
    m.box(cu - 0.6, cu + 0.6, cv - 0.45, cv + 0.45, 0.0, 0.9, STONE, top=True, shade=0.85)
    m.box(cu - 0.72, cu + 0.72, cv - 0.55, cv + 0.55, 0.9, 1.05, STONE, top=True, shade=1.0)
    st((1.0, 1.0, 1.0), 0.0)
    for k in range(9):  # the iron railing in front
        uu = cu - 1.0 + k * 0.25
        m.box(uu - 0.02, uu + 0.02, cv + 0.87, cv + 0.91, 0.0, 1.05, LEAD)
    m.box(cu - 1.02, cu + 1.02, cv + 0.85, cv + 0.93, 0.95, 1.05, LEAD)
    for sg in (-1, 1):
        m.box(cu + sg * 1.0 - 0.03, cu + sg * 1.0 + 0.03, cv - 0.6, cv + 0.9, 0.95, 1.05, LEAD)
        m.box(cu + sg * 1.0 - 0.02, cu + sg * 1.0 + 0.02, cv - 0.6, cv + 0.9, 0.0, 1.05, LEAD)
    st(DARK, 0.0)
    m.box(cu - 0.12, cu + 0.12, cv - 0.12, cv + 0.12, 1.05, 6.6, STONE, top=True, shade=0.5)  # the tarred cross
    m.box(cu - 1.1, cu + 1.1, cv - 0.12, cv + 0.12, 5.0, 5.28, STONE, top=True, shade=0.5)
    m.gable_roof(cu - 0.26, cu + 0.26, cv - 0.3, cv + 0.42, 6.45, 0.32, along="u", mat=LEAD, gable_mat=LEAD, over=0.05)
    st((0.95, 0.84, 0.72), 0.0)  # the corpus, painted in flesh colours
    m.box(cu - 0.14, cu + 0.14, cv + 0.12, cv + 0.27, 3.45, 4.85, STONE, top=True, shade=1.0)
    m.box(cu - 0.08, cu + 0.08, cv + 0.12, cv + 0.25, 2.7, 3.45, STONE, top=False, shade=0.95)
    m.box(cu - 0.09, cu + 0.09, cv + 0.12, cv + 0.28, 4.85, 5.08, STONE, top=True, shade=1.0)
    st((0.85, 0.83, 0.78), 0.0)
    m.box(cu - 0.16, cu + 0.16, cv + 0.12, cv + 0.29, 3.25, 3.6, STONE, top=True, shade=1.05)
    st((0.95, 0.84, 0.72), 0.0)
    for sg in (-1, 1):
        m.orient(m.poly([(cu + sg * 0.12, cv + 0.2, 4.62), (cu + sg * 0.95, cv + 0.2, 4.98), (cu + sg * 0.95, cv + 0.2, 4.86),
                         (cu + sg * 0.12, cv + 0.2, 4.45)], STONE, 1.0), (0, 1, 0))
    m.box(cu - 0.02, cu + 0.02, cv + 0.1, cv + 0.55, 3.3, 3.36, LEAD, top=True)
    m.box(cu - 0.11, cu + 0.11, cv + 0.44, cv + 0.66, 2.95, 3.25, GLASS, top=False)
    m.pyramid(m.ngon(cu, cv + 0.55, 0.17, 4, math.pi / 4), 3.25, 3.42, LEAD)
    st(SAND)


def steen5(fr):
    """Het Steen after the restoration of 1887-90 (Steve, 2026-09-24): free of the houses, on the
    promontory at the water; the old castle of steen4 with the restorers' changes: battlements on the
    towers, a false parapet on corbels over the Steenpoort instead of its saddle roof, the neo-Gothic
    north wing (the museum wing with its big stepped gable and tall octagonal tower with a spire, the
    square book tower with its tent roof, the covered passage with a timber gallery, a round corner
    tower with an overhanging top and a spire), the courtyard raised on its mound along the inland
    side, and the curved ramp with balustrades and corner posts with obelisks down from the Steenpoort
    (tools/city/design.py STEEN gives the numbers; the game walks them, world/steenramp.ts). The
    calvary stands at the ramp's foot."""
    cath_materials()
    steen_materials()
    f = Frame({"c": fr.c, "ax": [1.0, 0.0], "n": [0.0, 1.0], "L": fr.L, "W": fr.W})
    m = SMesh(f)
    U0, U1, V0, V1 = -f.L / 2, f.L / 2, -f.W / 2, f.W / 2  # -17, 17, -8.25, 8.25
    a0, a1, b0, b1 = U0 + 0.25, U1 - 0.25, V0 + 0.25, V1 - 0.25  # the wall faces; the plinth at the fp edge
    TOUR, SAND, BRK, DARK = (0.64, 0.68, 0.74), (1.0, 0.93, 0.8), (0.86, 0.56, 0.46), (0.5, 0.5, 0.52)
    BASE = 4.5  # the Tournai stone reaches this high
    RD = json.load(open(CITY))["decor"]["steen_ramp"]
    TY = RD["h"]  # the courtyard and the gate passage stand this high
    NW0 = 8.0  # the north wing (1887-90) begins here

    def st(t, jit=0.07):
        m.tint, m.jit = t, jit

    def mass(u0, u1, v0, v1, y1, top=False, base=BASE):
        st(TOUR)
        m.box(u0, u1, v0, v1, -1.0, base, STONE, top=False, shade=0.8)
        st(SAND)
        m.box(u0, u1, v0, v1, base, y1, STONE, top=top, top_mat=LEAD, shade=0.95)

    def tiled(p00, p10, p11, p01, cell, nu, nv, out, shade=1.0):
        def q(a, b):
            return tuple(p00[k] * (1 - a) * (1 - b) + p10[k] * a * (1 - b) + p11[k] * a * b + p01[k] * (1 - a) * b for k in range(3))
        for i in range(nu):
            for j in range(nv):
                m.tex([q(i / nu, j / nv), q((i + 1) / nu, j / nv), q((i + 1) / nu, (j + 1) / nv), q(i / nu, (j + 1) / nv)], cell, shade=shade, out=out)

    def tile_roof(u0, u1, v0, v1, y, rise, along="u", over=0.3, n=2.0):
        """A pantiled saddle roof (the atlas cell repeated every n metres)."""
        if along == "u":
            vm = (v0 + v1) / 2
            yl = y - over * rise / ((v1 - v0) / 2)
            nu = max(1, round((u1 - u0) / n))
            nv = max(1, round(math.hypot((v1 - v0) / 2 + over, rise) / n))
            tiled((u0, v0 - over, yl), (u1, v0 - over, yl), (u1, vm, y + rise), (u0, vm, y + rise), "st_tiles", nu, nv, (0, -1, 1))
            tiled((u1, v1 + over, yl), (u0, v1 + over, yl), (u0, vm, y + rise), (u1, vm, y + rise), "st_tiles", nu, nv, (0, 1, 1))
            for ue, uo in ((u0, -1), (u1, 1)):
                m.orient(m.poly([(ue, v0, y), (ue, v1, y), (ue, vm, y + rise)], STONE, 0.9), (uo, 0, 0))
        else:
            um = (u0 + u1) / 2
            yl = y - over * rise / ((u1 - u0) / 2)
            nv = max(1, round((v1 - v0) / n))
            nu = max(1, round(math.hypot((u1 - u0) / 2 + over, rise) / n))
            tiled((u0 - over, v1, yl), (u0 - over, v0, yl), (um, v0, y + rise), (um, v1, y + rise), "st_tiles", nv, nu, (-1, 0, 1))
            tiled((u1 + over, v0, yl), (u1 + over, v1, yl), (um, v1, y + rise), (um, v0, y + rise), "st_tiles", nv, nu, (1, 0, 1))
            for ve, vo in ((v0, -1), (v1, 1)):
                m.orient(m.poly([(u0, ve, y), (u1, ve, y), (um, ve, y + rise)], STONE, 0.9), (0, vo, 0))

    def sgable(p, d, o, s0, s1, y0, rise, steps=4, crown=0.9, t=0.5, shade=0.95, wins=()):
        """A stepped gable with thickness, standing on a wall top (p a point of the wall face, d along
        it, o out of it); wins: (s, y0, y1, w, cell) decals on its face."""
        hw = (s1 - s0) / 2
        w = 2 * hw / (2 * steps + 1)
        left = [(s0, y0)]
        for k in range(steps):
            y = y0 + rise * (k + 1) / (steps + 1)
            left += [(s0 + k * w, y), (s0 + (k + 1) * w, y)]
        ytop = y0 + rise + crown
        left += [(s0 + steps * w, ytop)]
        loop = left + [(s0 + s1 - s, y) for s, y in reversed(left)]
        P = lambda s, y, e: (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)  # noqa: E731
        m.orient(m.poly([P(s, y, 0.02) for s, y in loop], STONE, shade), (o[0], o[1], 0))
        m.orient(m.poly([P(s, y, -t) for s, y in loop], STONE, shade * 0.9), (-o[0], -o[1], 0))
        for i in range(len(loop) - 1):
            (sa, ya), (sb, yb) = loop[i], loop[i + 1]
            ns, ny = -(yb - ya), (sb - sa)  # the loop runs clockwise: outward is to the left
            m.orient(m.poly([P(sa, ya, 0.02), P(sb, yb, 0.02), P(sb, yb, -t), P(sa, ya, -t)], STONE, 1.05 if ny > 0 else 0.9),
                     (d[0] * ns, d[1] * ns, ny))
        for s, wy0, wy1, ww, cl in wins:
            m.decal(p, d, o, s - ww / 2, s + ww / 2, wy0, wy1, cl, off=0.07)

    def tface(cu, cv, r, sides, ang):
        """The face of an ngon tower nearest a direction: its middle point, along, out, width."""
        k = round((ang * sides / math.pi - 1) / 2) % sides
        a = (2 * k + 1) * math.pi / sides
        o = (math.cos(a), math.sin(a))
        rr = r * math.cos(math.pi / sides)
        return (cu + o[0] * rr, cv + o[1] * rr), (-o[1], o[0]), o, 2 * r * math.sin(math.pi / sides)

    def tower(cu, cv, r, y1, roof_top, sides=14, over=0.35, deco=(), vane=False, crenel=False):
        """A round tower: Tournai plinth and base, sandstone above, a corbelled rim, a conical slate
        roof. deco: (angle, y0, y1, width, cell)."""
        st(TOUR, 0.05)
        m.prism(m.ngon(cu, cv, r + 0.25, sides), -1.0, 0.7, STONE, top=True, shade=0.7)
        m.prism(m.ngon(cu, cv, r, sides), -1.0, BASE, STONE, top=False, shade=0.8)
        st(SAND, 0.05)
        m.prism(m.ngon(cu, cv, r, sides), BASE, y1 - 1.0, STONE, top=False, shade=0.95)
        m.prism(m.ngon(cu, cv, r + 0.1, sides), BASE - 0.14, BASE + 0.06, STONE, top=False, shade=1.06)  # the string course
        m.prism(m.ngon(cu, cv, r + 0.3, sides), y1 - 1.0, y1, STONE, top=False, shade=1.02)  # the corbelled rim
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            pu, pv = cu + math.cos(a) * (r + 0.12), cv + math.sin(a) * (r + 0.12)
            m.box(pu - 0.14, pu + 0.14, pv - 0.14, pv + 0.14, y1 - 1.7, y1 - 1.0, STONE, top=False, shade=0.8)
        if crenel:
            # the restorers' battlements: a parapet on the corbelled rim, merlons, the cap inside it
            m.prism(m.ngon(cu, cv, r + 0.3, sides), y1, y1 + 1.0, STONE, top=False, shade=1.0)
            m.prism(m.ngon(cu, cv, r - 0.1, sides), y1, y1 + 0.9, STONE, top=False, shade=0.8)
            m.orient(m.poly([(q[0], q[1], y1 + 0.02) for q in m.ngon(cu, cv, r + 0.3, sides)], LEAD, 0.7), (0, 0, 1))
            for k in range(0, sides, 2):
                a_ = 2 * math.pi * (k + 0.5) / sides
                mu, mv = cu + math.cos(a_) * (r + 0.1), cv + math.sin(a_) * (r + 0.1)
                m.box(mu - 0.28, mu + 0.28, mv - 0.28, mv + 0.28, y1 + 1.0, y1 + 1.8, STONE, top=True, shade=1.02)
            if roof_top is not None:
                m.pyramid(m.ngon(cu, cv, r - 0.2, sides), y1 + 0.9, roof_top, SLATE)
        elif roof_top is not None:
            eave = m.ngon(cu, cv, r + 0.3 + over, sides)
            m.pyramid(eave, y1, roof_top, SLATE)
            m.orient(m.poly([(q[0], q[1], y1) for q in eave], SLATE, 0.5), (0, 0, -1))  # the eaves' underside
        if roof_top is not None:
            m.box(cu - 0.05, cu + 0.05, cv - 0.05, cv + 0.05, roof_top - 0.3, roof_top + 1.6, LEAD)
            m.prism(m.ngon(cu, cv, 0.12, 6), roof_top + 0.2, roof_top + 0.45, LEAD, top=True)
        if vane and roof_top is not None:
            m.box(cu - 0.02, cu + 0.02, cv, cv + 0.75, roof_top + 1.05, roof_top + 1.45, GILT)
        for ang, y0, yy1, w, cl in deco:
            pt, d, o, fw = tface(cu, cv, r, sides, ang)
            ww = min(w, fw * 0.92)
            m.decal(pt, d, o, -ww / 2, ww / 2, y0, yy1, cl, ROUNDTOP if cl == "st_arched_door" else RECT, off=0.04)
        st(SAND)

    def corbel_parapet(p, d, o, s0, s1, y, proj=0.4, h=1.0, merlon=0.8, step=1.3):
        """Machicolations: a row of corbels carrying a projecting parapet, with merlons on top."""
        k = s0 + 0.35
        while k < s1 - 0.2:
            _wbox(m, p, d, o, k - 0.16, k + 0.16, 0.0, proj, y - 0.9, y, STONE, 0.8, top=False)
            k += 0.75
        _wbox(m, p, d, o, s0, s1, -0.3, proj, y, y + h, STONE, 0.98, top=True)
        k = s0 + 0.1
        while k + merlon <= s1:
            _wbox(m, p, d, o, k, k + merlon, proj - 0.45, proj, y + h, y + h + merlon * 1.1, STONE, 1.0, top=True)
            k += step

    def chimney(u, v, y0, y1, w=0.9, dd=0.6):
        st(BRK, 0.08)
        m.box(u - w / 2, u + w / 2, v - dd / 2, v + dd / 2, y0, y1, STONE, top=False, shade=0.8)
        m.box(u - w / 2 - 0.1, u + w / 2 + 0.1, v - dd / 2 - 0.1, v + dd / 2 + 0.1, y1, y1 + 0.2, STONE, top=True, top_mat=LEAD, shade=0.9)
        st(SAND)

    R = (0, b0), (1, 0), (0, -1)  # the river front
    LN = (0, b1), (1, 0), (0, 1)  # the lane front
    S = (a0, 0), (0, 1), (-1, 0)  # the south end

    # ---- the plinth round the whole block (Tournai stone, a little batter)
    st(TOUR, 0.05)
    m.prism([(U0, V0), (U1, V0), (U1, V1), (U0, V1)], -1.0, 0.55, STONE, top=False, shade=0.66)
    m.prism([(U0 + 0.12, V0 + 0.12), (U1 - 0.12, V0 + 0.12), (U1 - 0.12, V1 - 0.12), (U0 + 0.12, V1 - 0.12)], 0.55, 0.8, STONE, top=True, shade=0.75)

    # ---- the river range, south part: the great hall, a corbelled battlement along the river
    hs0, hs1 = -10.6, 3.0
    mass(hs0, hs1, b0, -0.2, 12.5)
    corbel_parapet(*R, hs0, hs1, 12.5)
    st(SAND)
    m.gable_roof(hs0, hs1, b0 + 0.6, -0.2, 12.5, 6.4, along="u", gable_mat=STONE, over=0.0)
    for uu in (-6.8, -0.8):  # dormers behind the battlement
        _roof_dormer(m, (0, b0 + 0.6), (1, 0), (0, -1), uu, 0.0, 12.5, -(-0.2 - b0 - 0.6) / 2, 18.9, 13.9, 1.2, 1.7)
    for uu in (-8.0, -3.8, 0.6):
        m.decal(*R, uu - 0.22, uu + 0.22, 1.2, 3.0, "slit")
        m.decal(*R, uu + 1.1, uu + 1.9, 5.0, 6.1, "st_smallbar")
    for uu in (-6.0, -1.4):
        m.decal(*R, uu - 0.5, uu + 0.5, 7.6, 8.6, "st_oculus")
    m.decal(*R, -9.8, -9.2, 9.4, 11.2, "slit")
    # its stepped gable over the lower north part
    sgable((hs1, 0), (0, 1), (1, 0), b0 + 0.6, -0.2, 12.5, 6.4, steps=4, wins=((-4.0, 13.4, 14.6, 0.7, "st_smallbar"),))

    # ---- the river range, north part: tiled roof, cross windows, a corbelled turret
    hn0, hn1 = 3.0, 12.6
    mass(hn0, NW0, b0, -0.2, 11.0)
    tile_roof(hn0, NW0, b0, -0.2, 11.0, 6.2, along="u", over=0.35)
    for uu in (4.2, 7.0):
        m.decal(*R, uu - 0.4, uu + 0.4, 1.4, 2.6, "st_smallbar")
    m.decal(*R, 6.1, 7.7, 5.2, 8.2, "st_crossbar")
    _roof_dormer(m, (0, b0), (1, 0), (0, -1), 5.5, 0.35, 11.0 - 0.35 * 6.2 / 3.9, -(-0.2 - b0) / 2, 17.2, 12.6, 1.4, 1.9)
    # the corbelled turret (on a squinch cone, loopholes, a conical cap) near the corner
    tcu, tcv, tr = 4.4, b0 - 0.35, 1.05
    ring = m.ngon(tcu, tcv, tr, 10)
    st(SAND, 0.05)
    m.prism(ring, 5.8, 9.8, STONE, top=False, shade=0.95)
    m.frustum(m.ngon(tcu, tcv + 0.9, 0.15, 10), 4.4, ring, 5.8, STONE, 0.8)
    m.prism(m.ngon(tcu, tcv, tr + 0.12, 10), 9.4, 9.8, STONE, top=False, shade=1.05)
    m.pyramid(m.ngon(tcu, tcv, tr + 0.3, 10), 9.8, 12.6, SLATE)
    m.box(tcu - 0.04, tcu + 0.04, tcv - 0.04, tcv + 0.04, 12.4, 13.3, LEAD)
    for ang in (-math.pi / 2, -math.pi / 2 - 0.9, -math.pi / 2 + 0.9):
        pt, d, o, fw = tface(tcu, tcv, tr, 10, ang)
        m.decal(pt, d, o, -0.12, 0.12, 6.6, 8.2, "slit", off=0.03)

    # ---- the big three-quarter round tower on the corner by the river
    tower(-13.55, -4.8, 3.2, 16.2, 25.4, sides=18, vane=True, crenel=True,
          deco=((math.pi, 0.2, 2.9, 1.3, "st_arched_door"), (math.pi, 6.0, 7.6, 0.4, "slit"), (-math.pi / 2, 3.0, 4.8, 0.4, "slit"),
                (-math.pi * 0.75, 8.6, 9.6, 0.7, "st_smallbar"), (-math.pi / 2, 11.6, 12.8, 0.7, "st_smallbar"), (math.pi * 0.9, 12.0, 13.6, 0.4, "slit")))

    # ---- the south range: a blind wall, the stepped gable with its three small windows over the little fish market
    mass(a0, -9.4, -3.0, 4.2, 12.0)
    mass(-12.2, -9.4, 4.2, b1, 10.6, top=True)  # the link to the gatehouse, lead-topped
    m.gable_roof(a0 + 0.3, -9.4, -3.0, 4.2, 12.0, 6.8, along="u", gable_mat=STONE, over=0.1)
    sgable((a0, 0), (0, 1), (-1, 0), -3.0, 4.2, 12.0, 7.0, steps=4,
           wins=((-1.8, 13.4, 14.2, 0.6, "st_smallbar"), (0.6, 13.4, 14.2, 0.6, "st_smallbar"), (3.0, 13.4, 14.2, 0.6, "st_smallbar")))
    for vv in (-1.0, 2.4):
        m.decal(*S, vv - 0.2, vv + 0.2, 2.0, 3.6, "slit")
    m.decal(*S, 0.3, 0.9, 6.4, 7.2, "st_smallbar")

    # ---- the round tower at the gate's west side
    tower(-14.15, 5.4, 2.6, 14.0 + TY, 21.4 + TY, sides=16, crenel=True,
          deco=((math.pi, 0.2, 2.6, 1.1, "st_arched_door"), (math.pi, 5.6, 7.0, 0.36, "slit"), (math.pi * 0.8, 9.2, 10.4, 0.6, "st_smallbar"),
                (math.pi / 2, 7.0, 8.4, 0.36, "slit")))

    # ---- Charles V's gatehouse on the lane: the oriel over the door, a tall stepped gable to the lane
    g0, g1 = -9.4, -3.6
    e0, e1 = -3.6, NW0
    EY = 10.4 + TY
    gc = -6.5
    # M7 halls (the Steen's museum in the world, docs/milestones/M7-halls-inworld.md): the gatehouse and the
    # prison range face by face. The museum door is a real opening in the gatehouse's lane face (a basket arch;
    # the game hangs its own leaves), and where the two meet their walls are left out (under the prison range's
    # eaves): the hall of antiquities opens from the gatehouse there (client/src/world/landmarkHalls.ts
    # buildSteen, shared/steenPlan.ts)
    def band_faces(u0, u1, v0, v1, ya, yb, shade, faces):
        for key, pa, pb, out in (("s", (u0, v0), (u1, v0), (0, -1)), ("e", (u1, v0), (u1, v1), (1, 0)),
                                 ("n", (u0, v1), (u1, v1), (0, 1)), ("w", (u0, v0), (u0, v1), (-1, 0))):
            if key in faces:
                f = m.poly([(pa[0], pa[1], ya), (pb[0], pb[1], ya), (pb[0], pb[1], yb), (pa[0], pa[1], yb)], STONE, shade)
                m.orient(f, (out[0], out[1], 0))
    DHW, DH = 1.25, 3.6
    dspring = TY + DOOR4[2][1] * DH
    arch = [(gc + (x - 0.5) * 2 * DHW, TY + t * DH) for x, t in reversed(DOOR4[2:])]  # the left springing over the crown to the right
    GY1 = 12.6 + TY
    st(TOUR)
    band_faces(g0, g1, -0.2, b1, -1.0, BASE, 0.8, "sw")
    for pts in ([(g0, -1.0), (gc - DHW, -1.0), (gc - DHW, BASE), (g0, BASE)], [(gc + DHW, -1.0), (g1, -1.0), (g1, BASE), (gc + DHW, BASE)],
                [(gc - DHW, -1.0), (gc + DHW, -1.0), (gc + DHW, TY), (gc - DHW, TY)]):
        m.orient(m.poly([(u, b1, y) for u, y in pts], STONE, 0.8), (0, 1, 0))
    st(SAND)
    band_faces(g0, g1, -0.2, b1, BASE, GY1, 0.95, "sw")
    band_faces(g0, g1, -0.2, b1, EY, GY1, 0.95, "e")  # over the prison range's eaves the gatehouse's side shows
    loop = [(g0, BASE), (gc - DHW, BASE)] + arch + [(gc + DHW, BASE), (g1, BASE), (g1, GY1), (g0, GY1)]
    m.orient(m.poly([(u, b1, y) for u, y in loop], STONE, 0.95), (0, 1, 0))
    m.gable_roof(g0, g1, -0.2, b1 - 0.4, 12.6 + TY, 5.6, along="v", gable_mat=STONE, over=0.25)
    sgable((0, b1), (1, 0), (0, 1), g0, g1, 12.6 + TY, 8.0, steps=5, crown=1.0, wins=((-6.5, 14.4 + TY, 16.4 + TY, 0.9, "st_twolight"),))
    gc = -6.5
    # the portal: short thick columns with tall capitals, a four-centred door, corbels over it
    st(SAND, 0.03)
    for sg in (-1, 1):
        cu = gc + sg * 1.6
        m.prism(m.ngon(cu, b1 + 0.3, 0.3, 8), TY, TY + 2.7, STONE, top=False, shade=1.0)
        m.prism(m.ngon(cu, b1 + 0.3, 0.42, 8), TY + 2.7, TY + 3.3, STONE, top=True, shade=1.08)
        m.prism(m.ngon(cu, b1 + 0.3, 0.38, 8), TY - 0.2, TY + 0.35, STONE, top=True, shade=0.9)
    # (M7 halls: no painted door: the opening is real, cut in the face above)
    m.door("Steen, museum door (Charles V's gate, on the courtyard)", (gc, V1, 0))
    _wbox(m, *LN, gc - 2.0, gc + 2.0, 0.0, 0.32, TY + 3.3, TY + 3.6, STONE, 1.05, top=True)  # the string course over the capitals
    for s in (gc - 1.6, gc + 1.6):
        _wbox(m, *LN, s - 0.25, s + 0.25, 0.0, 0.6, TY + 3.6, TY + 4.2, STONE, 0.9, top=True)  # the corbels carrying the oriel
    _wbox(m, *LN, gc - 1.3, gc + 1.3, 0.0, 0.5, TY + 3.9, TY + 4.2, STONE, 0.85, top=False)
    # the three-sided oriel: carved panels under tall barred windows, a slate cap
    oy0, oy1, ob = 4.2 + TY, 10.6 + TY, b1
    op = [(gc - 1.75, ob), (gc - 0.95, ob + 0.85), (gc + 0.95, ob + 0.85), (gc + 1.75, ob)]
    m.orient(m.poly([(q[0], q[1], oy0) for q in op], STONE, 0.7), (0, 0, -1))
    for i in range(3):
        pa, pb = op[i], op[i + 1]
        du, dv = pb[0] - pa[0], pb[1] - pa[1]
        Ln = math.hypot(du, dv)
        d = (du / Ln, dv / Ln)
        o = (d[1], -d[0])
        if o[1] < 0:
            o = (-o[0], -o[1])
        m.orient(m.poly([(pa[0], pa[1], oy0), (pb[0], pb[1], oy0), (pb[0], pb[1], oy1), (pa[0], pa[1], oy1)], STONE, 1.0), (o[0], o[1], 0))
        m.decal(pa, d, o, 0.08, Ln - 0.08, TY + 4.35, TY + 5.75, "st_arms" if i == 1 else "st_saltire", off=0.04)
        m.decal(pa, d, o, 0.12, Ln - 0.12, TY + 6.1, TY + 10.1, "st_twolight" if i == 1 else "st_bars", off=0.04)
        _wbox(m, pa, d, o, -0.05, Ln + 0.05, 0.0, 0.14, TY + 5.85, TY + 6.0, STONE, 1.08, top=True)
        _wbox(m, pa, d, o, -0.05, Ln + 0.05, 0.0, 0.2, TY + 10.4, TY + 10.6, STONE, 1.08, top=True)
    m.pyramid(op + [(gc, ob - 0.6)], TY + 10.6, TY + 12.2, SLATE)
    # the barred windows of the gatehouse beside the oriel
    for s in (g0 + 0.8, g1 - 0.8):
        m.decal(*LN, s - 0.4, s + 0.4, TY + 5.4, TY + 7.6, "st_bars")
        m.decal(*LN, s - 0.4, s + 0.4, TY + 8.6, TY + 10.6, "st_bars")

    # ---- the prison range on the lane: two storeys of barred windows, the museum's painted name, dormers
    # (M7 halls: face by face, without its west wall where it meets the gatehouse: the hall of antiquities opens there)
    st(TOUR)
    band_faces(e0, e1, -0.2, b1, -1.0, BASE, 0.8, "sne")
    st(SAND)
    band_faces(e0, e1, -0.2, b1, BASE, EY, 0.95, "sne")
    m.gable_roof(e0, e1, -0.2, b1, EY, 6.0, along="u", gable_mat=STONE, over=0.3)
    for k, uu in enumerate((-1.9, 1.3, 4.5)):
        m.decal(*LN, uu - 0.7, uu + 0.7, TY + 1.2, TY + 3.9, "st_crossbar" if k == 2 else "st_bars")
        m.decal(*LN, uu - 0.7, uu + 0.7, TY + 5.8, TY + 8.7, "st_bars")
    m.decal(*LN, -1.6, 5.2, TY + 4.35, TY + 5.4, "st_band", off=0.05)
    _roof_dormer(m, (0, b1), (1, 0), (0, 1), 1.3, 0.3, EY - 0.3 * 6.0 / 4.1, -(b1 + 0.2) / 2, EY + 6.0, EY + 0.9, 1.3, 1.8)
    # the board by the door
    m.decal(*LN, gc + 2.15, gc + 3.45, TY + 1.35, TY + 2.0, "st_board", off=0.09)

    # ---- chimneys on the ridges
    chimney(-14.2, 0.6, 16.0, 20.4)
    chimney(-6.5, 2.0, 16.4, 19.6)
    chimney(2.2, 4.4, 14.0 + TY, 17.2 + TY)
    chimney(-4.0, -4.6, 16.6, 19.8, 0.7, 0.5)

    # ---- the Steenpoort over the lane: a pointed arch through a plain gate block, a tiled roof, the
    # Semini niche above the arch, a round tower on its east side (outside the fp: a collider in the game)
    pu0, pu1 = a0, -13.0
    pv0, pv1 = b1, V1 + 4.9  # the passage: v 8.25..13.15 (world z 27..31.9)
    pc, phw, ph = (V1 + pv1) / 2, 2.25, 5.6
    st(TOUR, 0.05)
    for uf, o in ((pu0, (-1, 0)), (pu1, (1, 0))):
        _holed_wall(m, (uf, 0), (0, 1), o, pv0, pv1 + 1.0, TY, TY + 8.6, [(pc, phw, ph, 0.6)], mat=STONE, shade=0.95 if o[0] < 0 else 0.85)
    m.box(pu0, pu1, pv0, pv1 + 1.0, -1.0, TY, STONE, top=True, shade=0.7)  # the mound under the passage
    arch = _arch_outline(phw, ph, 0.6)
    for i in range(len(arch) - 1):  # the soffit of the passage
        (sa, ya), (sb, yb) = arch[i], arch[i + 1]
        fcc = m.poly([(pu0, pc + sa, TY + ya), (pu0, pc + sb, TY + yb), (pu1, pc + sb, TY + yb), (pu1, pc + sa, TY + ya)], STONE, 0.5)
        m.orient(fcc, (0, -(sa + sb) / 2, -1 if (ya + yb) / 2 > 3.4 else 0))
    m.orient(m.poly([(pu0, pv0, TY + 8.6), (pu1, pv0, TY + 8.6), (pu1, pv1 + 1.0, TY + 8.6), (pu0, pv1 + 1.0, TY + 8.6)], LEAD, 0.8), (0, 0, 1))
    # 1889: a false parapet on corbels instead of the saddle roof
    for pp, dd, oo in (((pu0, 0), (0, 1), (-1, 0)), ((pu1, 0), (0, 1), (1, 0))):
        corbel_parapet(pp, dd, oo, pv0, pv1 + 1.0, TY + 8.6, proj=0.45, h=0.9, merlon=0.7, step=1.2)
    # the Semini relief in its niche, a small stone hood with a slate pent over it
    st(TOUR, 0.0)
    m.decal((pu0, 0), (0, 1), (-1, 0), pc - 0.5, pc + 0.5, TY + 6.1, TY + 7.6, "st_semini", ROUNDTOP, off=0.03)
    _wbox(m, (pu0, 0), (0, 1), (-1, 0), pc - 0.7, pc + 0.7, 0.0, 0.35, TY + 7.7, TY + 7.9, STONE, 1.0, top=True)
    for sg in (-1, 1):
        _wbox(m, (pu0, 0), (0, 1), (-1, 0), pc + sg * 0.66 - 0.06, pc + sg * 0.66 + 0.06, 0.0, 0.3, TY + 5.9, TY + 7.7, STONE, 0.9, top=False)
    # the east tower of the gate: battlements and a flat lead top (the inventory: "the east tower is crenellated")
    tower(-14.95, pv1 + 1.95, 1.9, 11.0 + TY, None, sides=12, crenel=True,
          deco=((math.pi, 3.0, 4.4, 0.34, "slit"), (math.pi / 2, 6.0, 7.4, 0.34, "slit"), (math.pi * 0.75, 8.4, 9.2, 0.5, "st_smallbar")))

    # ---- the finer things: string courses where the Tournai stone meets the sandstone, sill courses,
    # lead on the ridges, iron wall anchors, downpipes, a lantern on a bracket at the gate
    st(SAND, 0.03)
    for u0_, u1_, v0_, v1_ in ((hs0, hs1, b0, -0.2), (hn0, NW0, b0, -0.2), (a0, -9.4, -3.0, 4.2)):
        m.box(u0_ - 0.1, u1_ + 0.1, v0_ - 0.1, v1_ + 0.1, BASE - 0.14, BASE + 0.06, STONE, top=True, shade=1.06)
    _wbox(m, *LN, e0, e1, 0.0, 0.12, TY + 5.55, TY + 5.7, STONE, 1.08, top=True)  # the sill course of the upper floor
    _wbox(m, *LN, e0, e1, 0.0, 0.25, EY - 0.2, EY, STONE, 1.05, top=True)  # the eaves cornice
    _wbox(m, *R, hn0, NW0, 0.0, 0.25, 10.8, 11.0, STONE, 1.05, top=True)
    for u0_, u1_, vm, yr in ((hs0, hs1, (b0 + 0.4) / 2, 18.9), (hn0, NW0, (b0 - 0.2) / 2, 17.2), (e0, e1, (b1 - 0.2) / 2, EY + 6.0), (a0 + 0.3, -9.4, 0.6, 18.8)):
        m.box(u0_, u1_, vm - 0.12, vm + 0.12, yr - 0.05, yr + 0.12, LEAD, top=True)
    m.box(g0 + 2.8, g0 + 3.0, -0.2, b1 - 0.4, TY + 18.15, TY + 18.32, LEAD, top=True)
    for uu in (-8.4, -5.4, -2.4, 0.6):  # iron anchors, the S-shaped ends of the floor beams
        m.box(uu - 0.04, uu + 0.04, b0 - 0.06, b0, 10.2, 10.8, LEAD, top=False, shade=0.6)
        m.box(uu - 0.04, uu + 0.04, b0 - 0.06, b0, 5.9, 6.5, LEAD, top=False, shade=0.6)
    for uu in (-0.3, 2.9, 6.1):
        m.box(uu - 0.04, uu + 0.04, b1, b1 + 0.06, TY + 9.3, TY + 9.9, LEAD, top=False, shade=0.6)
        m.box(uu - 0.04, uu + 0.04, b1, b1 + 0.06, TY + 4.9, TY + 5.4, LEAD, top=False, shade=0.6)
    for uu, yt in ((-3.4, 12.6 + TY), (7.6, EY)):  # downpipes on the courtyard front
        m.box(uu - 0.07, uu + 0.07, b1 + 0.02, b1 + 0.16, TY, yt, LEAD, top=True, shade=0.7)
        m.box(uu - 0.25, uu + 0.25, b1 + 0.02, b1 + 0.3, yt - 0.25, yt, LEAD, top=True, shade=0.7)
    for uu in (g0 + 0.8, g1 - 0.8):
        m.decal(*LN, uu - 0.35, uu + 0.35, TY + 1.4, TY + 2.6, "st_smallbar")
    # sandstone quoins, long and short, on the corners that show
    for (qu, qv, du, dv, yq) in ((g0, b1, 1, -1, 12.6 + TY), (g1, b1, -1, -1, 12.6 + TY)):
        k, y = 0, BASE + 0.1
        while y + 0.36 < yq:
            la, lb = (0.62, 0.34) if k % 2 == 0 else (0.34, 0.62)
            m.box(min(qu, qu + du * la), max(qu, qu + du * la), min(qv, qv - dv * 0.04), max(qv, qv - dv * 0.04) + 0.0, y, y + 0.34, STONE, top=True, shade=1.1)
            m.box(min(qu, qu - du * 0.04), max(qu, qu - du * 0.04), min(qv, qv + dv * lb), max(qv, qv + dv * lb), y, y + 0.34, STONE, top=True, shade=1.1)
            y += 0.38
            k += 1
    # the lantern on its bracket on the Steenpoort's outer face, east of the arch
    lv = V1 + 5.35
    m.box(a0 - 0.7, a0, lv - 0.03, lv + 0.03, TY + 4.95, TY + 5.02, LEAD, top=True)
    m.box(a0 - 0.7, a0 - 0.64, lv - 0.03, lv + 0.03, TY + 4.6, TY + 5.0, LEAD, top=False)
    m.box(a0 - 0.84, a0 - 0.5, lv - 0.17, lv + 0.17, TY + 4.1, TY + 4.55, GLASS, top=False)
    m.pyramid(m.ngon(a0 - 0.67, lv, 0.26, 4, math.pi / 4), TY + 4.55, TY + 4.8, LEAD)
    m.box(a0 - 0.8, a0 - 0.54, lv - 0.13, lv + 0.13, TY + 4.02, TY + 4.1, LEAD, top=True)

    steen5_extras(m, RD, TY, NW0, st, mass, tower, sgable, corbel_parapet, chimney, tface, TOUR, SAND, DARK, BASE, a0, a1, b0, b1, U0, U1, V0, V1)
    st(SAND)
    return m

def clock_marker(fr, pt, out, radius, name):
    """An empty at a clock dial's middle, a few mm in front of it (Steve, 2026-09-26: every clock shows the game's time;
    the game hangs live hands on every object named clock_face_*): in the glTF its local +Z looks out of the dial and
    its +Y is up (Blender: -Y out, +Z up); `radius` (custom property, in the glTF extras) is the dial's in metres."""
    from mathutils import Matrix
    x, y, z = fr.w(*pt)
    du, dv = out
    wx, wz = fr.ax[0] * du + fr.n[0] * dv, fr.ax[1] * du + fr.n[1] * dv
    nb = B(wx, 0, wz)
    nb.z = 0.0
    nb.normalize()
    Z = Vector((0.0, 0.0, 1.0))
    Y = -nb
    X = Y.cross(Z)
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = radius
    ob.location = B(x, y, z)
    ob.rotation_euler = Matrix(((X.x, Y.x, Z.x), (X.y, Y.y, Z.y), (X.z, Y.z, Z.z))).to_euler()
    ob["radius"] = float(radius)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    city = json.load(open(CITY))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for n, rgb in zip(MATS, [(0.7, 0.68, 0.62), (0.25, 0.27, 0.3), (0.05, 0.06, 0.07), (0.55, 0.3, 0.22), (0.3, 0.31, 0.32)]):
        material(n, rgb)
    th = math.radians(city["frame"]["thetaDeg"])
    world_north = (math.cos(th), -math.sin(th))
    L = city["landmarks"]
    built = []
    clocks, cath_clocks, cath_walk, cath_marks = [], [], [], []

    def frame(name, open_side=False, away=False):
        f = dict(L[name]["frame"])
        # open_side: v > 0 looks to the open ground; away: v < 0 does
        if (open_side and f["open"] < 0) or (away and f["open"] > 0):
            f["n"] = [-f["n"][0], -f["n"][1]]
        return Frame(f)

    builders = {
        "cathedral": lambda: cathedral(frame("cathedral"), world_north),
        "stadhuis": lambda: stadhuis(frame("stadhuis", open_side=True)),
        "vleeshuis": lambda: vleeshuis2(frame("vleeshuis")),  # M6: in detail, as in 1873 (vleeshuis: the first model)
        "steen": lambda: steen5(frame("steen")),  # M3i: restored, c. 1890 (steen4: 1873; steen3: the first simple 1890s model)
        "hanzehuis": lambda: hanzehuis(frame("hanzehuis", away=True)),
        "stpaul": lambda: church(frame("stpaul"), 42, "bulb"),
        "carolus": lambda: church(frame("carolus"), 44, "bulb"),
        "stjacob": lambda: church(frame("stjacob"), 55, "flat"),
    }
    for name in L:
        if name in builders:
            mm = builders[name]()
            mm.to_object(f"landmark_{name}")
            # M7 the cathedral outside: its small things in pieces drawn near only
            if isinstance(mm, CathMesh) and mm.d is not mm:
                mm.d.to_object(f"landmark_{name}_near", split=48.0)
            # issue #10: the real windows' old panes (never drawn: the hall's glass, the night's glow) and their markers
            if getattr(mm, "lit", None) is not None:
                mm.lit.to_object(f"landmark_{name}_lit_glass")
                cath_marks += cathedral_markers()
            for pt, out, r in getattr(mm, "clocks", []):
                ob = clock_marker(mm.f, pt, out, r, f"clock_face_{len(clocks)}")
                clocks.append(ob)
                if name == "cathedral":
                    cath_clocks.append(ob)
            if getattr(mm, "walk", None):
                cath_walk.append(mm.walk)
            built.append(name)
    if cath_walk:
        path = os.path.join(ROOT, "client", "public", "models", "cathedral_walk.json")
        json.dump(cath_walk[0], open(path, "w", newline=chr(10)))
        print(f"[build_landmarks] {path}: {len(cath_walk[0]['strips'])} strips, {len(cath_walk[0]['blocks'])} blocks")
    for ob in clocks:
        print(f"[build_landmarks] {ob.name}: at {tuple(round(c, 2) for c in ob.location)}, radius {ob['radius']:.2f} m")
    # the cathedral goes into its own file with its own materials (client/src/world/cathedralOutside.ts); the rest as before
    cath = [o for o in bpy.context.scene.objects if o.name.startswith("landmark_cathedral")] + cath_clocks + cath_marks
    rest = [o for o in bpy.context.scene.objects if o not in cath]
    for obs, path, q in ((rest, OUT, {}), (cath, CATH_OUT, {"export_draco_position_quantization": 16, "export_draco_texcoord_quantization": 16})):
        if not obs:
            continue
        for o in bpy.context.scene.objects:
            o.select_set(o in obs)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                                  export_materials="EXPORT", use_selection=True, export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_extras=True, **q)
        faces = sum(len(o.data.polygons) for o in obs if o.type == "MESH")
        print(f"[build_landmarks] {len(obs)} objects: {faces} faces -> {path} ({os.path.getsize(path)//1024} KB)")
    print(f"[build_landmarks] built {', '.join(built)}; cathedral parts {COUNT}")


if __name__ == "__main__":
    main()

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

    # -- the clock: dark face, gilt ring, hour marks and hands (ten past ten)
    c = cell("clock")
    stone_bg(c)
    c[circle(64, 64, 32, 32, 0, 31.5)] = C["gold"]
    c[circle(64, 64, 32, 32, 0, 28.5)] = C["face"]
    c[circle(64, 64, 32, 32, 20.5, 21.5)] = C["gold"] * 0.8
    for k in range(12):
        a = 2 * math.pi * k / 12
        line(c, 32 + 23 * math.sin(a), 32 - 23 * math.cos(a), 32 + 27 * math.sin(a), 32 - 27 * math.cos(a), C["gold"], 2)
    for a, r in ((math.radians(305), 14), (math.radians(60), 22)):
        line(c, 32, 32, 32 + r * math.sin(a), 32 - r * math.cos(a), C["gold"], 2)
    c[31:34, 31:34] = C["gold"]

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


def _portal(m, p, d, o, sc, hw0, hw1, depth, h0, h1, tsp, lintel, bands=5, trumeau=False, steps=True, rnd=False, door=None, tymp="tympanum"):
    """A splayed portal cut into a wall (see _holed_wall): stepped archivolt bands from the
    wall face (hw0, h0) to the doors `depth` inside (hw1, h1), a tympanum over a carved
    lintel, two dark door leaves with iron hinges, a trumeau with a statue, steps."""
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
    for s0, s1, hinge_side in ((-hw1, -tw, -1), (tw, hw1, 1)):
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
    for i in range(nst):
        y0, y1, h = ys[i], ys[i + 1], hs[i]
        m.tex_prism(_sq(tu, tv, h), y0, y1 - 0.7, cells[i], skip=(3,) if i == 0 else ())
        m.prism(_sq(tu, tv, h + 0.25), y1 - 0.7, y1, STONE, top=(i == nst - 1), top_mat=LEAD, shade=1.05)
        for su in (-1, 1):
            for sv in (-1, 1):
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
    _portal(m, *Wt, tv, 2.2, 1.25, 1.5, 8.4, 6.6, 0.58, 4.1, bands=3, door=f"cathedral, {'north' if north else 'south'} side portal")
    _wimperg(m, *Wt, tv, 2.5, 7.0, 11.6, off=0.3, w=0.35)
    if north:
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


def _aisle_bay(m, ua, ub, side, window=True, flyer=False):
    """One bay of the outer aisle wall on one side: wall, window, balustrade, the
    buttress at ua with its pinnacle, and the transverse hipped roof over the aisles."""
    vo = side * VO
    o = (0, side)
    f = m.poly([(ua, vo, 0), (ub, vo, 0), (ub, vo, AE), (ua, vo, AE)], STONE, 0.95)
    m.orient(f, (0, side, 0))
    if window:
        m.decal((0, vo), (1, 0), o, ua + 1.7, ub - 1.7, 3.6, 14.6, "great_window", arch_shape(0.66, 3))
    m.balustrade((ua, vo + side * 0.25), (ub, vo + side * 0.25), AE, o, 1.1)
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


def cathedral(fr, world_north):
    """Onze-Lieve-Vrouwekathedraal, 1873. The west front faces the Handschoenmarkt
    (u = 0), the choir the east; the tall tower is the north one."""
    cath_materials()
    ns = 1 if fr.n[0] * world_north[0] + fr.n[1] * world_north[1] > 0 else -1
    L = fr.L
    k = L / 124.94  # the plan below was fitted to this length; stretch along u if the outline changes
    lf = Frame({"c": [fr.c[0] - fr.ax[0] * L / 2, fr.c[1] - fr.ax[1] * L / 2], "ax": [fr.ax[0] * k, fr.ax[1] * k],
                "n": [fr.n[0] * ns, fr.n[1] * ns], "L": L, "W": fr.W})
    m = CMesh(lf)
    nave_bays = [13.8 + i * (T0 - 13.8) / 6 for i in range(7)]
    choir_bays = [T1 + i * (AU - T1) / 3 for i in range(4)]

    # ---- the high walls of nave and choir, clerestory windows, balustrade, pinnacles
    for side in (-1, 1):
        v = side * HN
        f = m.poly([(13.8, v, 0), (AU, v, 0), (AU, v, NE), (13.8, v, NE)], STONE)
        m.orient(f, (0, side, 0))
        for bays in (nave_bays, choir_bays):
            for ua, ub in zip(bays, bays[1:]):
                m.decal((0, v), (1, 0), (0, side), ua + 1.8, ub - 1.8, 22.6, 29.4, "great_window", arch_shape(0.66, 3))
                m.balustrade((ua, v + side * 0.3), (ub, v + side * 0.3), NE, (0, side), 1.2)
            for u in bays:
                m.pinnacle(u, v + side * 0.35, NE, 4.2, 0.35)
    # ---- the great roofs: nave and choir in one, the transept across, dormers, crestings
    m.gable_roof(13.8, AU, -HN, HN, NE, NR - NE, along="u", over=0.5)
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
    for side in (-1, 1):
        for ua, ub in zip(nave_bays, nave_bays[1:]):
            _aisle_bay(m, ua, ub, side)
        for ua, ub in zip(choir_bays, choir_bays[1:]):
            _aisle_bay(m, ua, ub, side)
        for u in nave_bays:
            _buttress(m, u, side)
        _buttress(m, choir_bays[0], side)
        _buttress(m, choir_bays[3], side)
        # east wall of the outer choir aisles
        va, vb = sorted((side * 13.0, side * VO))
        f = m.poly([(AU, va, 0), (AU, vb, 0), (AU, vb, AE), (AU, va, AE)], STONE, 0.95)
        m.orient(f, (1, 0, 0))
        m.decal((AU, 0), (0, 1), (1, 0), min(side * 15.5, side * 23.5), max(side * 15.5, side * 23.5), 3.6, 13.6, "lancet", arch_shape(0.72, 2))
        # the outer aisles beside the towers: their own west gable over the houses
        va, vb = sorted((side * 18.2, side * VO))
        f = m.poly([(9.0, va, 0), (9.0, vb, 0), (9.0, vb, AE), (9.0, va, AE)], STONE, 0.95)
        m.orient(f, (-1, 0, 0))
        m.decal((9.0, 0), (0, 1), (-1, 0), va + 1.8, vb - 1.8, 9.8, 15.6, "lancet", arch_shape(0.72, 2))
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
            f = m.poly([(ue, va, 0), (ue, vb, 0), (ue, vb, NE), (ue, va, NE)], STONE)
            m.orient(f, (sg, 0, 0))
            s0, s1 = sorted((side * 27.0, side * 35.0))
            m.decal((ue, 0), (0, 1), (sg, 0), s0, s1, 4.0, 27.8, "great_window", arch_shape(0.7, 3))
            for c0 in (9.0, 17.0):
                s0, s1 = sorted((side * c0, side * (c0 + 4.2)))
                m.decal((ue, 0), (0, 1), (sg, 0), s0, s1, 22.8, 29.2, "lancet", arch_shape(0.72, 2))
            m.balustrade((ue + sg * 0.3, va), (ue + sg * 0.3, vb), NE, (sg, 0), 1.2)
        tv_ = side * TV
        o = (0, side)
        Wt = ((0, tv_), (1, 0), o)
        _holed_wall(m, *Wt, T0, T1, 0, NE, [(74.6, 3.2, 12.0, 0.56)])
        _portal(m, *Wt, 74.6, 3.2, 1.75, 2.6, 12.0, 9.0, 0.56, 5.4, bands=4, trumeau=True, door=f"cathedral, {'north' if side > 0 else 'south'} transept portal")
        _wimperg(m, *Wt, 74.6, 3.5, 9.6, 16.6, off=0.35)
        m.pinnacle(70.8, tv_ + side * 0.5, 9.5, 7.5, 0.35)
        m.pinnacle(78.4, tv_ + side * 0.5, 9.5, 7.5, 0.35)
        m.decal((0, tv_), (1, 0), o, 69.8, 79.4, 13.6, 28.8, "great_window", arch_shape(0.66, 3))
        m.balustrade((T0, tv_ + side * 0.3), (T1, tv_ + side * 0.3), NE, o, 1.2)
        m.decal((0, tv_), (1, 0), o, T0, T1, NE, NR, "gable", GABLE, off=0.08)
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
    m.tex_prism(oc(6.2), 44.0, 50.5, "lancet")
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
    for a, b in zip(ap, ap[1:]):
        mu, mv = (a[0] + b[0]) / 2 - AU, (a[1] + b[1]) / 2
        f = m.poly([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], NE), (a[0], a[1], NE)], STONE)
        m.orient(f, (mu, mv, 0))
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        d = ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)
        o = (mu / math.hypot(mu, mv), mv / math.hypot(mu, mv))
        m.decal(a, d, o, 0.8, ln - 0.8, 21.0, 29.0, "lancet", arch_shape(0.75, 2))
        m.balustrade((a[0] + o[0] * 0.3, a[1] + o[1] * 0.3), (b[0] + o[0] * 0.3, b[1] + o[1] * 0.3), NE, o, 1.2, piece=4.0)
        f = m.poly([(a[0] + o[0] * 0.5, a[1] + o[1] * 0.5, NE - 0.2), (b[0] + o[0] * 0.5, b[1] + o[1] * 0.5, NE - 0.2), (AU, 0, NR)], SLATE)
        m.orient(f, (mu, mv, 1))
    for (pu, pv) in ap[1:-1]:
        m.pinnacle(pu + (pu - AU) * 0.06, pv * 1.06, NE, 4.2, 0.35)
    m.cross(AU, 0, NR - 0.3, 2.4, 0.6, 0.08)

    # ---- ambulatory: a lean-to ring round the apse
    RA = 13.0
    angs = [math.radians(-90 + 18 * i) for i in range(11)]
    for a0, a1 in zip(angs, angs[1:]):
        p0i, p1i = (AU + HN * math.cos(a0), HN * math.sin(a0)), (AU + HN * math.cos(a1), HN * math.sin(a1))
        p0o, p1o = (AU + RA * math.cos(a0), RA * math.sin(a0)), (AU + RA * math.cos(a1), RA * math.sin(a1))
        am = (a0 + a1) / 2
        f = m.poly([(p0o[0], p0o[1], 0), (p1o[0], p1o[1], 0), (p1o[0], p1o[1], AE), (p0o[0], p0o[1], AE)], STONE, 0.9)
        m.orient(f, (math.cos(am), math.sin(am), 0))
        f = m.poly([(p0o[0] + 0.3 * math.cos(a0), p0o[1] + 0.3 * math.sin(a0), AE - 0.1), (p1o[0] + 0.3 * math.cos(a1), p1o[1] + 0.3 * math.sin(a1), AE - 0.1),
                    (p1i[0], p1i[1], 21.2), (p0i[0], p0i[1], 21.2)], SLATE)
        m.orient(f, (math.cos(am), math.sin(am), 1))
    # five radiating chapels, each closed by five sides
    CE = 12.0
    for ad in (-72, -36, 0, 36, 72):
        a = math.radians(ad)
        e, q = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

        def P(r, s):
            return (AU + e[0] * r + q[0] * s, e[1] * r + q[1] * s)
        ring = [P(12.6, -3.1), P(15.0, -3.1), P(16.9, -2.2), P(17.6, 0), P(16.9, 2.2), P(15.0, 3.1), P(12.6, 3.1)]
        for i in range(len(ring) - 1):
            p0, p1 = ring[i], ring[i + 1]
            mu, mv = (p0[0] + p1[0]) / 2 - AU, (p0[1] + p1[1]) / 2
            f = m.poly([(p0[0], p0[1], 0), (p1[0], p1[1], 0), (p1[0], p1[1], CE), (p0[0], p0[1], CE)], STONE, 0.95)
            m.orient(f, (mu, mv, 0))
            if 1 <= i <= 4:
                ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
                d = ((p1[0] - p0[0]) / ln, (p1[1] - p0[1]) / ln)
                o = (mu / math.hypot(mu, mv), mv / math.hypot(mu, mv))
                o2 = (-d[1], d[0]) if (-d[1] * mu + d[0] * mv) > 0 else (d[1], -d[0])
                m.decal(p0, d, o2, 0.35, ln - 0.35, 3.0, 10.4, "lancet", arch_shape(0.72, 2))
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
    _holed_wall(m, *W_, -fw, fw, 0, 40.0, [(0.0, 4.9, 15.4, 0.56)])
    for sv in (-1, 1):  # the sides of the bay, back to the towers
        f = m.poly([(FU, sv * fw, 0), (TU - 6.0, sv * fw, 0), (TU - 6.0, sv * fw, 40.0), (FU, sv * fw, 40.0)], STONE, 0.9)
        m.orient(f, (0, sv, 0))
    _portal(m, *W_, 0.0, 4.9, 2.55, 2.8, 15.4, 11.2, 0.56, 7.0, bands=5, trumeau=True, door="cathedral, central west portal")
    _wimperg(m, *W_, 0.0, 5.2, 12.6, 21.6, off=0.4)
    for sv in (-1, 1):
        m.pinnacle(FU - 0.5, sv * 5.3, 12.8, 8.4, 0.38)
        m.decal(*W_, sv * 5.6 - 0.9, sv * 5.6 + 0.9, 23.5, 27.0, "niche", off=0.1)
    m.balustrade((FU - 0.3, -fw), (FU - 0.3, fw), 22.3, (-1, 0), 1.2)
    m.decal(*W_, -5.0, 5.0, 23.8, 39.4, "great_window", arch_shape(0.64, 3))
    m.balustrade((FU - 0.3, -fw), (FU - 0.3, fw), 40.0, (-1, 0), 1.2)
    m.gable_roof(FU, 13.8, -fw, fw, 40.0, 11.5, along="u", over=0.0)
    m.decal(*W_, -fw, fw, 41.2, 52.0, "gable", GABLE, off=0.08)
    m.pinnacle(FU, 0, 51.4, 4.2, 0.45)
    m.cross(FU, 0, 55.4, 1.6, 0.45, 0.07, LEAD)
    for sv in (-1, 1):
        m.pinnacle(FU - 0.2, sv * (fw - 0.2), 41.2, 4.6, 0.35)

    # ---- the towers
    _cath_tower(m, TU, TVN, north=True)
    _cath_tower(m, TU, -TVN, north=False)

    # ---- houses built against the church (the chapter let them between the buttresses)
    cells = ["house_a", "house_c", "house_b"]
    for side in (-1, 1):  # at the Handschoenmarkt, before the outer aisles
        s0, s1 = sorted((side * 18.5, side * 25.6))
        _house(m, (9.0, 0), (0, 1), (-1, 0), s0, s1, 5.6, 8.6, 3.6, "house_a" if side > 0 else "house_c", chimney=True)
    north = [(9.3, 16.6, 5.0, 8.0), (16.8, 22.6, 8.0, 9.6), (22.7, 28.3, 8.1, 7.6), (28.4, 33.4, 8.2, 10.4), (33.5, 38.4, 8.4, 8.2),
             (38.5, 42.4, 8.6, 9.0), (42.9, 48.8, 9.2, 7.8), (48.9, 55.0, 9.2, 10.2), (55.1, 61.0, 9.2, 8.4), (61.1, 67.0, 9.2, 9.4),
             (82.2, 86.6, 5.3, 8.2), (86.7, 92.2, 5.3, 9.6), (92.3, 98.2, 5.3, 7.8)]
    for i, (s0, s1, depth, h) in enumerate(north):
        _house(m, (0, VO), (1, 0), (0, 1), s0, s1, depth, h, 3.0 + (i % 3) * 0.5, cells[i % 3], chimney=i % 2 == 0)
    south = [(41.5, 45.7, 4.3, 7.6), (45.8, 49.3, 4.3, 8.8), (49.4, 54.3, 7.6, 9.8), (54.4, 58.7, 7.6, 8.0), (58.8, 62.2, 7.6, 9.2),
             (62.3, 67.0, 7.6, 7.8)]
    for i, (s0, s1, depth, h) in enumerate(south):
        _house(m, (0, -VO), (1, 0), (0, -1), s0, s1, depth, h, 3.2 + (i % 2) * 0.5, cells[(i + 1) % 3], chimney=i % 2 == 1)
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
    m.prism(body, 0, S2, STONE, top=True, top_mat=LEAD, shade=0.95)
    # the stair block at the back, in the outline's notch
    m.box(-8.1, 8.1, -W / 2, vb, 0, S2 + 3.0, STONE, top=False, shade=0.9)
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
    _portal(m, Pf, Df, Of, 0.0, 1.7, 1.4, 1.2, 6.2, 5.8, 0.6, 4.2, bands=3, rnd=True, door="town hall, main door", tymp="fanlight")
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
    for a0, a1, b0, b1 in wings:
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
    _portal(m, PF, D, O, GATE, 1.6, 1.3, 1.1, 5.6, 5.3, 0.6, 3.9, bands=2, rnd=True, tymp="fanlight", door="Hanseatic House, gate")
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
    m.decal(*S, -0.4, 1.4, 0.0, 2.3, "st_arched_door", ROUNDTOP, off=0.04)  # a low door

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

    # ---- the calvary outside the gate, against the back of the town hall (the 1880 photograph)
    cu, cv = -21.0, 14.9  # world x -226, z 33.65
    st(TOUR, 0.03)
    m.box(cu - 0.6, cu + 0.6, cv - 0.45, cv + 0.35, 0.0, 0.9, STONE, top=True, shade=0.85)
    m.box(cu - 0.72, cu + 0.72, cv - 0.55, cv + 0.45, 0.9, 1.05, STONE, top=True, shade=1.0)
    st((1.0, 1.0, 1.0), 0.0)
    for k in range(9):  # the iron railing round it
        x = cu - 1.0 + k * 0.25
        m.box(x - 0.02, x + 0.02, cv - 0.95, cv - 0.91, 0.0, 1.05, LEAD)
    m.box(cu - 1.02, cu + 1.02, cv - 0.97, cv - 0.89, 0.95, 1.05, LEAD)
    for sg in (-1, 1):
        m.box(cu + sg * 1.0 - 0.02, cu + sg * 1.0 + 0.02, cv - 0.95, cv + 0.35, 0.0, 1.05, LEAD)
        m.box(cu + sg * 1.0 - 0.03, cu + sg * 1.0 + 0.03, cv - 0.95, cv + 0.35, 0.95, 1.05, LEAD)
    st(DARK, 0.0)
    m.box(cu - 0.1, cu + 0.1, cv - 0.1, cv + 0.1, 1.05, 6.3, STONE, top=True, shade=0.45)  # the tarred cross
    m.box(cu - 0.95, cu + 0.95, cv - 0.09, cv + 0.09, 5.05, 5.25, STONE, top=True, shade=0.45)
    st((1.0, 0.97, 0.9), 0.0)
    m.box(cu - 0.13, cu + 0.13, cv - 0.24, cv - 0.1, 3.5, 4.9, STONE, top=True, shade=1.2)  # the corpus
    m.box(cu - 0.08, cu + 0.08, cv - 0.22, cv - 0.1, 2.75, 3.5, STONE, top=False, shade=1.15)
    m.box(cu - 0.08, cu + 0.08, cv - 0.25, cv - 0.1, 4.9, 5.12, STONE, top=True, shade=1.2)
    for sg in (-1, 1):
        m.orient(m.poly([(cu + sg * 0.1, cv - 0.2, 4.75), (cu + sg * 0.85, cv - 0.2, 5.15), (cu + sg * 0.85, cv - 0.2, 5.02),
                         (cu + sg * 0.1, cv - 0.2, 4.58)], STONE, 1.15), (0, -1, 0))
    st(SAND)
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
        "steen": lambda: steen4(frame("steen")),  # M3i: the Steen of 1873 (steen3: the post-1890 look)
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

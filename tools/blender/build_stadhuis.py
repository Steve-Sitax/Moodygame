"""Build the town hall of Antwerp (Stadhuis, Cornelis Floris, 1561-65) as it stood in 1873, in detail, for the game.

    blender -b --factory-startup -P tools/blender/build_stadhuis.py

Writes client/public/models/stadhuis.glb (loaded by client/src/world/stadhuisShell.ts, which hides the old
town hall of landmarks.glb). The front was re-cut stone by stone in 1853-69, so in 1873 it is fresh: pale
limestone over a rusticated bluestone ground floor, the Virgin back in her niche since 1831.

After the photographs of the 1860s-90s: a low rusticated arcade of round arches (once little shops); two
storeys of cross windows between Doric pilasters below and Ionic above, each with its entablature; the open
gallery (loggia) under the eaves, small columns and a balustrade; the great hipped slate roof with two rows of
dormers and tall chimneys; and the frontispiece in the middle: three arched doors, the balcony on consoles,
coupled columns storey over storey, the arms of Brabant, of Philip II and of the Margraviate, then over the
roof the stages with Justice and Prudence in their niches, the Virgin above, the bell and the eagle on top,
obelisks on every step and volutes between.

The frame (shared/city.json landmarks.stadhuis): u along the front (east +), v out of it (v > 0 is the
Grote Markt), y up. It keeps the old shell's footprint, doors and hall openings (shared/townhallPlan.ts):
the wings' face at v = W/2 - 1.3, the frontispiece's at W/2, the back at -W/2 + 2 with the stair block, the
main door behind Floris's portal (open, the game hangs its leaves), 22 bays over the front. Everything built
here stands outward of those faces, so the hall inside still fits.

Two objects: stadhuis_body (walls, orders, roof, what makes the shape) and stadhuis_detail (balusters,
capitals, consoles, statues: small things the game leaves out from far off). Materials (the game gives them
their pictures and height maps by name, stadhuisShell.ts): sh_white (ashlar), sh_carved (dressed stone
without joints), sh_blue (bluestone), sh_slate, sh_glass (leaded lights), sh_oak, sh_lead, sh_gilt,
sh_arms (the painted arms, tools/textures/stadhuis_maps.py), sh_cloth (the flags, vertex colour).
UVs: metres over each material's tile, by the face's facing (slate along its fall line); glass and the arms
have their own.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
OUT = os.path.join(ROOT, "client", "public", "models", "stadhuis.glb")
PREVIEW = os.environ.get("STADHUIS_PREVIEW")  # a folder: render a few views there (the build's own check)

MATS = ["sh_white", "sh_carved", "sh_blue", "sh_slate", "sh_glass", "sh_oak", "sh_lead", "sh_gilt", "sh_arms", "sh_cloth", "sh_glass_lit"]
WHITE, CARVED, BLUE, SLATE, GLASS, OAK, LEAD, GILT, ARMS, CLOTH, GLASS_LIT = range(len(MATS))
# metres per repeat of each material's picture (u, v); must match stadhuisShell.ts (it only sets the pictures)
TILE = {WHITE: (1.8, 1.8), CARVED: (1.2, 1.2), BLUE: (1.2, 1.2), SLATE: (2.0, 2.0), GLASS: (1.0, 1.0), OAK: (1.2, 1.2),
        LEAD: (1.0, 1.0), GILT: (1.0, 1.0), ARMS: (1.0, 1.0), CLOTH: (1.0, 1.0), GLASS_LIT: (1.0, 1.0)}
# the colours Blender shows (the game uses the pictures)
PREVIEW_RGB = {WHITE: (0.78, 0.74, 0.66), CARVED: (0.82, 0.78, 0.7), BLUE: (0.25, 0.27, 0.29), SLATE: (0.2, 0.22, 0.25),
               GLASS: (0.1, 0.12, 0.13), OAK: (0.18, 0.12, 0.08), LEAD: (0.3, 0.31, 0.32), GILT: (0.8, 0.58, 0.18),
               ARMS: (0.6, 0.3, 0.2), CLOTH: (1, 1, 1), GLASS_LIT: (0.1, 0.12, 0.13)}
# Issue #10 (interiors are real, docs/building-with-interior.md): every window of the wings, the frontispiece and the
# stair block is cut through: the arcade's shop fronts, the cross windows of the Doric and the Ionic storeys, the
# frontispiece's windows and the portals' fanlights. Their stone crosses, oak frames and lead bars stay here; their
# glass is the room's (world/landmarkHalls.ts buildTownhall: the town hall's rooms, and simple locked offices behind
# every other window). Each is written twice: an empty "opening_<id>" in the glb and a row of shared/stadhuisShell.ts
# (world frame). Their old panes go to a mesh of their own ("stadhuis_lit_glass", sh_glass_lit) that the game never
# draws: world/landmarkWindows.ts lights a copy of it at night, as before. The main door is written too (a door).
# Left as they were: the dormers' glass (the attic) and the loggia under the eaves (an open gallery, no glass).
SHELL_TS = os.path.join(ROOT, "shared", "stadhuisShell.ts")

# ---- the plan (metres, the frame of shared/city.json)
U = 33.88  # half the front
W = 27.78
FV = W / 2  # the frontispiece's face (the footprint's front line)
VF = FV - 1.3  # the wings' face
VB = -W / 2 + 2.0  # the back
SB, SBK = 8.1, -W / 2  # the stair block: half width, its back
FW = 6.4  # half the frontispiece
NB, BW = 22, 2 * U / 22  # bays over the front and the back
NS = 8  # bays over each side
GF = 0.5  # the wings' ground floor stands out of their face (the front only: the sides stand on the street)
# heights
PL = 0.55  # plinth
G = 7.0  # the ground storey (the first floor's string course, the hall's first floor)
S1 = 13.9  # the Doric storey's top
S2 = 20.8  # the Ionic storey's top, the loggia's floor
LC = 24.3  # the loggia's ceiling
CO = 26.0  # the main cornice's top
RISE = 10.5
IN = 1.6  # the loggia's depth


def B(x, y, z):
    return Vector((x, -z, y))


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


class Frame:
    def __init__(self, f):
        self.c, self.ax, self.n = f["c"], f["ax"], f["n"]

    def w(self, p):
        u, v, y = p
        return (self.c[0] + self.ax[0] * u + self.n[0] * v, y, self.c[1] + self.ax[1] * u + self.n[1] * v)


class Mesh:
    """Faces in the landmark's local (u, v, y). Each face gets its own vertices (flat, PS1) unless smooth."""

    def __init__(self, frame, name):
        self.f = frame
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.fixed = set()
        self.doors = []

    def vert(self, p):
        return self.bm.verts.new(B(*self.f.w(p)))

    def face(self, pts, mat, shade=1.0, out=None, uvs=None):
        """A face over local points; out: the local direction it must look to (else as wound)."""
        if len(pts) < 3:
            return None
        vs = [self.vert(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        for lp in f.loops:
            lp[self.col] = (shade, shade, shade, 1.0)
        if uvs is not None:
            for lp, uv in zip(f.loops, uvs):
                lp[self.uv].uv = uv
            self.fixed.add(f)
        if out is not None:
            self.orient(f, out)
        return f

    def orient(self, f, out):
        if f is None:
            return
        wx = self.f.ax[0] * out[0] + self.f.n[0] * out[1]
        wz = self.f.ax[1] * out[0] + self.f.n[1] * out[1]
        f.normal_update()
        if f.normal.dot(B(wx, out[2], wz)) < 0:
            f.normal_flip()

    def tint(self, f, rgb):
        for lp in f.loops:
            lp[self.col] = (rgb[0], rgb[1], rgb[2], 1.0)

    # ---- solids in local space
    def prism(self, ring, y0, y1, mat, shade=1.0, top=True, bottom=False, skip=()):
        """Upright prism over a (u, v) ring."""
        n = len(ring)
        area = sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))
        sg = 1 if area > 0 else -1
        for i in range(n):
            if i in skip:
                continue
            a, b = ring[i], ring[(i + 1) % n]
            nu, nv = (b[1] - a[1]) * sg, -(b[0] - a[0]) * sg
            self.face([(a[0], a[1], y0), (b[0], b[1], y0), (b[0], b[1], y1), (a[0], a[1], y1)], mat, shade, (nu, nv, 0))
        if top:
            self.face([(p[0], p[1], y1) for p in ring], mat, shade, (0, 0, 1))
        if bottom:
            self.face([(p[0], p[1], y0) for p in ring], mat, shade * 0.8, (0, 0, -1))

    def box(self, u0, u1, v0, v1, y0, y1, mat, shade=1.0, top=True, bottom=False):
        self.prism([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], y0, y1, mat, shade, top, bottom)

    def lathe(self, cu, cv, prof, sides, mat, shade=1.0, rot=0.0, cap_top=True, cap_bottom=False, smooth=True):
        """A turned solid: prof = [(r, y)] bottom to top, around (cu, cv). Shared vertices, smooth shaded."""
        rings = []
        for r, y in prof:
            ring = []
            for k in range(sides):
                a = rot + 2 * math.pi * k / sides
                ring.append(self.vert((cu + r * math.cos(a), cv + r * math.sin(a), y)))
            rings.append(ring)
        faces = []
        for j in range(len(prof) - 1):
            ra, rb = rings[j], rings[j + 1]
            ym = (prof[j][1] + prof[j + 1][1]) / 2
            for k in range(sides):
                k2 = (k + 1) % sides
                if prof[j][0] < 1e-4 and prof[j + 1][0] < 1e-4:
                    continue
                if prof[j][0] < 1e-4:
                    vs = [ra[k], rb[k], rb[k2]]
                elif prof[j + 1][0] < 1e-4:
                    vs = [ra[k], ra[k2], rb[k]]
                else:
                    vs = [ra[k], ra[k2], rb[k2], rb[k]]
                try:
                    f = self.bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = mat
                f.smooth = smooth
                a = rot + 2 * math.pi * (k + 0.5) / sides
                dr = prof[j + 1][0] - prof[j][0]
                dy = prof[j + 1][1] - prof[j][1]
                self.orient(f, (math.cos(a) * dy, math.sin(a) * dy, -dr))
                for lp in f.loops:
                    lp[self.col] = (shade, shade, shade, 1.0)
                faces.append(f)
        if cap_top and prof[-1][0] > 1e-4:
            try:
                f = self.bm.faces.new(rings[-1])
                f.material_index = mat
                self.orient(f, (0, 0, 1))
                for lp in f.loops:
                    lp[self.col] = (shade, shade, shade, 1.0)
            except ValueError:
                pass
        if cap_bottom and prof[0][0] > 1e-4:
            try:
                f = self.bm.faces.new(rings[0])
                f.material_index = mat
                self.orient(f, (0, 0, -1))
            except ValueError:
                pass
        return faces

    def sweep(self, path, O, X, Y, Z, prof, mat, shade=1.0, closed=False, caps=True, shades=None):
        """A moulding: the profile [(a, b)] (a out of the path in its plane, b along Z; drawn from its foot on
        the wall round its outside to its top back on the wall) swept along a path of 2D points in the plane
        O + X x + Y y, mitred at the corners. The path runs so that its outside is on the right (a counter-
        clockwise ring seen from +Z)."""
        n = len(path)
        segs = n if closed else n - 1
        nrm = []
        for i in range(segs):
            a, b = path[i], path[(i + 1) % n]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy) or 1.0
            nrm.append((dy / ln, -dx / ln))
        offs = []
        for i in range(n):
            if closed:
                n1, n2 = nrm[(i - 1) % segs], nrm[i % segs]
            else:
                n1 = nrm[max(0, i - 1)]
                n2 = nrm[min(segs - 1, i)]
            bx, by = n1[0] + n2[0], n1[1] + n2[1]
            bl = math.hypot(bx, by) or 1.0
            bx, by = bx / bl, by / bl
            k = bx * n1[0] + by * n1[1]
            k = max(k, 0.3)
            offs.append((bx / k, by / k))

        def P(i, a, b):
            x = path[i][0] + offs[i][0] * a
            y = path[i][1] + offs[i][1] * a
            return add(add(add(O, mul(X, x)), mul(Y, y)), mul(Z, b))

        m = len(prof)
        for i in range(segs):
            j = (i + 1) % n
            nx, ny = nrm[i]
            nd = add(mul(X, nx), mul(Y, ny))
            for k in range(m - 1):
                (a0, b0), (a1, b1) = prof[k], prof[k + 1]
                da, db = a1 - a0, b1 - b0
                if abs(da) < 1e-6 and abs(db) < 1e-6:
                    continue
                out = add(mul(nd, db), mul(Z, -da))
                sh = shade if shades is None else shades[k]
                self.face([P(i, a0, b0), P(j, a0, b0), P(j, a1, b1), P(i, a1, b1)], mat, sh, out)
        if caps and not closed:
            for i, sgn in ((0, -1), (n - 1, 1)):
                a, b = path[max(0, i - 1)] if i else path[0], path[i] if i else path[1]
                t = norm(add(mul(X, b[0] - a[0]), mul(Y, b[1] - a[1])))
                self.face([P(i, pa, pb) for pa, pb in prof], mat, shade, mul(t, sgn))

    def extrude(self, outline, O, X, Y, Z, e0, e1, mat, shade=1.0, back=False, side_shade=0.85):
        """A flat 2D outline [(x, y)] in the plane O + X x + Y y, extruded along Z from e0 to e1 (front at e1)."""
        n = len(outline)
        area = sum(outline[i][0] * outline[(i + 1) % n][1] - outline[(i + 1) % n][0] * outline[i][1] for i in range(n))
        sg = 1 if area > 0 else -1

        def P(p, e):
            return add(add(add(O, mul(X, p[0])), mul(Y, p[1])), mul(Z, e))

        self.face([P(p, e1) for p in outline], mat, shade, Z)
        if back:
            self.face([P(p, e0) for p in outline], mat, shade * 0.8, mul(Z, -1))
        for i in range(n):
            a, b = outline[i], outline[(i + 1) % n]
            nx, ny = (b[1] - a[1]) * sg, -(b[0] - a[0]) * sg
            self.face([P(a, e0), P(b, e0), P(b, e1), P(a, e1)], mat, shade * side_shade, add(mul(X, nx), mul(Y, ny)))

    def door(self, name, p):
        x, _, z = self.f.w(p)
        self.doors.append((name, round(x, 2), round(z, 2)))

    def finish(self):
        """UVs by facing (slate along its fall line), then the Blender object."""
        for f in self.bm.faces:
            if f in self.fixed:
                continue
            tu, tv = TILE[f.material_index]
            f.normal_update()
            n = f.normal
            if f.material_index == SLATE and 0.15 < abs(n.z) < 0.97:
                h = Vector((n.x, n.y, 0)).normalized()
                al = Vector((-h.y, h.x, 0))
                s = math.sqrt(n.x * n.x + n.y * n.y)
                for lp in f.loops:
                    co = lp.vert.co
                    # down the slope in true length: the height over the sine of the slope's angle
                    lp[self.uv].uv = (co.dot(al) / tu, (co.z / s) / tv)
            elif abs(n.z) > 0.7:
                for lp in f.loops:
                    lp[self.uv].uv = (lp.vert.co.x / tu, lp.vert.co.y / tv)
            else:
                tx, ty = -n.y, n.x
                ln = math.hypot(tx, ty) or 1.0
                tx, ty = tx / ln, ty / ln
                for lp in f.loops:
                    co = lp.vert.co
                    lp[self.uv].uv = ((co.x * tx + co.y * ty) / tu, co.z / tv)
        tris = sum(len(f.verts) - 2 for f in self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for mname in MATS:
            me.materials.append(bpy.data.materials[mname])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ca = me.color_attributes
        if "Col" in ca:
            ca.active_color = ca["Col"]
            ca.render_color_index = list(ca.keys()).index("Col")
        print(f"[build_stadhuis] {self.name}: {tris} triangles")
        for dn, dx, dz in self.doors:
            print(f"[build_stadhuis]   door {dn}: world x {dx}, z {dz}")
        return ob


class Wall:
    """A wall's frame: p a point of its face (u, v), d along it, o out of it (unit, local u-v). s along, e out.
    d must point to the right as seen from outside (the frame's u-v-y is left-handed: d = (o_v, -o_u)), so
    that a counter-clockwise path in (s, y) runs with its outside on the right (frame_sweep)."""

    def __init__(self, p, d, o):
        self.p, self.d, self.o = p, d, o
        self.X = (d[0], d[1], 0.0)
        self.Y = (0.0, 0.0, 1.0)
        self.Z = (o[0], o[1], 0.0)
        self.O = (p[0], p[1], 0.0)

    def pt(self, s, e, y):
        return (self.p[0] + self.d[0] * s + self.o[0] * e, self.p[1] + self.d[1] * s + self.o[1] * e, y)

    def at(self, e):
        """The same wall, e further out."""
        return Wall((self.p[0] + self.o[0] * e, self.p[1] + self.o[1] * e), self.d, self.o)

    def out(self, k=1.0):
        return (self.o[0] * k, self.o[1] * k, 0)

    def along(self, k=1.0):
        return (self.d[0] * k, self.d[1] * k, 0)

    def quad(self, m, s0, s1, y0, y1, e, mat, shade=1.0, facing=1):
        return m.face([self.pt(s0, e, y0), self.pt(s1, e, y0), self.pt(s1, e, y1), self.pt(s0, e, y1)], mat, shade, self.out(facing))

    def box(self, m, s0, s1, e0, e1, y0, y1, mat, shade=1.0, top=True, bottom=False, back=False):
        """A block against the wall (its back face left out unless asked)."""
        ring = [self.pt(s0, e0, 0)[:2], self.pt(s1, e0, 0)[:2], self.pt(s1, e1, 0)[:2], self.pt(s0, e1, 0)[:2]]
        m.prism(ring, y0, y1, mat, shade, top, bottom, skip=() if back else (0,))

    def hsweep(self, m, s0, s1, prof, mat, shade=1.0, caps=True, shades=None):
        """A horizontal moulding along the wall from s0 to s1: prof = [(e, y)] (out, up)."""
        # (in the plane of `along` and `out` the path runs from s1 to s0, so its right hand side is out)
        m.sweep([(s1, 0.0), (s0, 0.0)], (self.p[0], self.p[1], 0.0), self.X, self.Z, self.Y, prof, mat, shade, caps=caps, shades=shades)

    def frame_sweep(self, m, pts, prof, mat, shade=1.0, closed=True, caps=True, e=0.0):
        """A moulding round an opening in the wall's plane: pts [(s, y)] counter-clockwise (seen from outside);
        prof = [(a, e)]: a out of the opening in the plane, e out of the wall."""
        m.sweep(pts, (self.p[0] + self.o[0] * e, self.p[1] + self.o[1] * e, 0.0), self.X, self.Y, self.Z, prof, mat, shade, closed=closed, caps=caps)


# ---------------------------------------------------------------- real openings (issue #10)

OPENINGS = []
LIT = [None]  # the real windows' old glass (a Mesh of its own, never drawn: the night's light is made from it)
FR = [None]   # the frame (shared/city.json), for the world's coordinates


def arch_poly(hw, yb, yt, seg=8):
    """An arched opening's outline (u from its middle, y): the bottom, the right side, the half circle over to the
    left springing (the same 8 segments as the shell's hole and reveal)."""
    ys = yt - hw
    return [(-hw, yb), (hw, yb)] + [(hw * math.cos(math.pi * k / seg), ys + hw * math.sin(math.pi * k / seg)) for k in range(seg + 1)]


def real_opening(w, sc, hw, yb, yt, arch, depth, kind, label, glaze="lead"):
    """Record a real opening of the shell in the wall w: its middle sc along it on the wall's outer face (e = 0), its
    outline (hw, yb, yt: yt the crown of an arched one) where the reveal ends, `depth` into the wall."""
    u, v, _ = w.pt(sc, 0.0, 0.0)
    f = FR[0]
    x, _, z = f.w((u, v, 0.0))
    ax, nn = f.ax, f.n
    tx, tz = ax[0] * w.d[0] + nn[0] * w.d[1], ax[1] * w.d[0] + nn[1] * w.d[1]
    nx, nz = ax[0] * w.o[0] + nn[0] * w.o[1], ax[1] * w.o[0] + nn[1] * w.o[1]
    poly = arch_poly(hw, yb, yt) if arch else [(-hw, yb), (hw, yb), (hw, yt), (-hw, yt)]
    OPENINGS.append(dict(kind=kind, part="stadhuis_body", label=label, glaze=glaze, shape="rect", x=x, z=z, tx=tx, tz=tz, nx=nx, nz=nz,
                         hw=hw, yb=yb, yt=yt, arch=bool(arch), depth=depth, poly=poly))


def opening_markers():
    """Every real opening as an empty in the glb (dev/interiorcheck.ts reads them) and shared/stadhuisShell.ts."""
    for i, o in enumerate(OPENINGS):
        o["id"] = f"sh_{i:03d}"
        ob = bpy.data.objects.new("opening_" + o["id"], None)
        ob.empty_display_size = max(0.2, o["hw"])
        ob.location = B(o["x"], (o["yb"] + o["yt"]) / 2, o["z"])
        for k in ("kind", "label", "glaze", "shape", "part"):
            ob[k] = str(o[k])
        for k in ("hw", "yb", "yt", "nx", "nz", "tx", "tz", "depth"):
            ob[k] = float(o[k])
        ob["arch"] = 1 if o["arch"] else 0
        bpy.context.scene.collection.objects.link(ob)
    f3 = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")  # noqa: E731
    lines = [
        "// GENERATED by tools/blender/build_stadhuis.py (issue #10, interiors are real): do not edit. Every real opening of",
        "// the town hall's shell (client/public/models/stadhuis.glb, whose empties opening_<id> are the same), in the WORLD's",
        "// frame (world/landmarkHalls.ts moves them into the hall's: shellOpening.ts inFrame). x, z: its middle on the wall's",
        "// outer face; (tx, tz) along it, (nx, nz) out of it; poly its outline where the reveal ends (u along from the middle,",
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
    with open(SHELL_TS, "w", newline="\n") as fh:
        fh.write("\n".join(lines))
    return len(OPENINGS)


# ---------------------------------------------------------------- profiles (e out, y up), from the wall's face

def cornice_prof(y0, h, proj):
    """A classical cornice: a bed moulding, the corona (the drip) and the cyma on top; h tall, proj out."""
    return [(0, y0), (proj * 0.18, y0 + h * 0.08), (proj * 0.3, y0 + h * 0.22), (proj * 0.62, y0 + h * 0.3), (proj * 0.66, y0 + h * 0.36),
            (proj * 0.66, y0 + h * 0.62), (proj * 0.74, y0 + h * 0.64), (proj * 0.95, y0 + h * 0.8), (proj, y0 + h * 0.96), (proj, y0 + h), (0, y0 + h)]


def band_prof(y0, h, proj, lip=0.3):
    """A string course: a flat band with a small drip on top."""
    return [(0, y0), (proj * 0.8, y0), (proj * 0.8, y0 + h * (1 - lip)), (proj, y0 + h * (1 - lip * 0.6)), (proj, y0 + h), (0, y0 + h)]


def arch_pts(sc, hw, ys, seg=8, y0=None):
    """A round arch from the right foot (or springing) over to the left: [(s, y)]."""
    pts = []
    if y0 is not None:
        pts.append((sc + hw, y0))
    for k in range(seg + 1):
        a = math.pi * k / seg
        pts.append((sc + hw * math.cos(a), ys + hw * math.sin(a)))
    if y0 is not None:
        pts.append((sc - hw, y0))
    return pts


# ---------------------------------------------------------------- walls with openings


def holed_face(m, w, s0, s1, y0, y1, holes, mat, shade=1.0, e=0.0, rnd_seg=8):
    """A wall face from s0 to s1, y0 to y1, e out, with openings: holes = [(sc, hw, yb, yt, round)] (round:
    a semicircle on top of yt). Built as vertical strips so no face has a hole."""
    cuts = sorted(holes)
    xs = [s0]
    for sc, hw, yb, yt, rnd in cuts:
        xs += [sc - hw, sc + hw]
    xs.append(s1)
    # the solid strips between the holes
    for i in range(0, len(xs), 2):
        a, b = xs[i], xs[i + 1]
        if b - a > 1e-4:
            w.quad(m, a, b, y0, y1, e, mat, shade)
    # over and under each hole
    for sc, hw, yb, yt, rnd in cuts:
        if yb > y0 + 1e-4:
            w.quad(m, sc - hw, sc + hw, y0, yb, e, mat, shade)
        if rnd:
            top = y1
            # the spandrels: a fan from each upper corner
            arc = [(sc + hw * math.cos(math.pi * k / rnd_seg), yt + hw * math.sin(math.pi * k / rnd_seg)) for k in range(rnd_seg + 1)]
            half = rnd_seg // 2
            right = [(sc, top), (sc + hw, top)] + arc[:half + 1]
            left = [(sc - hw, top), (sc, top)] + arc[half:]
            if yt + hw < top - 1e-4:
                m.face([w.pt(s, e, y) for s, y in right], mat, shade, w.out())
                m.face([w.pt(s, e, y) for s, y in left], mat, shade, w.out())
        elif yt < y1 - 1e-4:
            w.quad(m, sc - hw, sc + hw, yt, y1, e, mat, shade)


def reveal(m, w, sc, hw, yb, yt, e0, e1, mat, shade=0.7, rnd=False, sill=True, seg=8):
    """The reveal of an opening from e1 (the face) back to e0: jambs, head (or soffit), sill."""
    for sg in (-1, 1):
        s = sc + sg * hw
        m.face([w.pt(s, e0, yb), w.pt(s, e1, yb), w.pt(s, e1, yt), w.pt(s, e0, yt)], mat, shade, w.along(-sg))
    if rnd:
        arc = [(sc + hw * math.cos(math.pi * k / seg), yt + hw * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
        for (sa, ya), (sb, yb2) in zip(arc, arc[1:]):
            mid = ((sa + sb) / 2 - sc, (ya + yb2) / 2 - yt)
            m.face([w.pt(sa, e0, ya), w.pt(sb, e0, yb2), w.pt(sb, e1, yb2), w.pt(sa, e1, ya)], mat, shade * 0.85,
                   (-w.d[0] * mid[0], -w.d[1] * mid[0], -mid[1]))
    else:
        m.face([w.pt(sc - hw, e0, yt), w.pt(sc + hw, e0, yt), w.pt(sc + hw, e1, yt), w.pt(sc - hw, e1, yt)], mat, shade * 0.75, (0, 0, -1))
    if sill:
        m.face([w.pt(sc - hw, e0, yb), w.pt(sc + hw, e0, yb), w.pt(sc + hw, e1, yb), w.pt(sc - hw, e1, yb)], mat, shade * 1.1, (0, 0, 1))


def glass(m, w, s0, s1, y0, y1, e, pane=(0.25, 0.25), shade=1.0, arch_top=None, lit=False):
    """A leaded light: its own uv, the lead grid starting at its corner (the picture: 4 x 5 panes a tile). `lit`: a
    real window's (issue #10): its pane goes to the lit glass, never drawn (the glass is the room's)."""
    tw, th = pane[0] * 4, pane[1] * 5
    if arch_top is None:
        pts = [(s0, y0), (s1, y0), (s1, y1), (s0, y1)]
    else:
        sc, hw = (s0 + s1) / 2, (s1 - s0) / 2
        arc = [(sc + hw * math.cos(math.pi * k / 8), y1 + hw * math.sin(math.pi * k / 8)) for k in range(9)]
        pts = arc if y1 - y0 < 1e-3 else [(s0, y0), (s1, y0)] + arc
    uvs = [((s - s0) / tw, (y - y0) / th) for s, y in pts]
    if lit:
        return LIT[0].face([w.pt(s, e, y) for s, y in pts], GLASS_LIT, shade, w.out(), uvs)
    return m.face([w.pt(s, e, y) for s, y in pts], GLASS, shade, w.out(), uvs)


def cross_window(m, dm, w, sc, hw, yb, yt, depth=0.12, transom=None, frame=0.15, arch=False, mull=True, shade=1.0, label=None):
    """A stone cross window in a wall face (the hole is made by holed_face): the glass `depth` in, the mullion
    and transom standing in it, a moulded frame (architrave) round it on the face. `label`: a real window (issue
    #10): recorded, its glass the room's."""
    tr = transom if transom is not None else yb + (yt - yb) * 0.68
    lit = label is not None
    if lit:
        real_opening(w, sc, hw, yb, yt + (hw if arch else 0.0), arch, depth, "window", label)
    # the reveal from the glass to the face
    reveal(m, w, sc, hw, yb, yt, -depth, 0.0, CARVED, 0.72, rnd=arch)
    # the lights
    mw = 0.07 if mull else 0.0
    tt = 0.08
    for s0, s1 in (((sc - hw, sc - mw), (sc + mw, sc + hw)) if mull else ((sc - hw, sc + hw),)):
        glass(m, w, s0, s1, yb, tr - tt, -depth, shade=0.95, lit=lit)
        if not arch:
            glass(m, w, s0, s1, tr + tt, yt, -depth, shade=0.95, lit=lit)
    if arch:
        glass(m, w, sc - hw, sc + hw, tr + tt, yt, -depth, shade=0.95, arch_top=True, lit=lit)
    # the stone cross (mullion and transom), a little proud of the glass
    if mull:
        w.box(m, sc - mw, sc + mw, -depth, -0.02, yb, yt + (hw if arch else 0), CARVED, 1.0, top=False)
    w.box(m, sc - hw, sc + hw, -depth, -0.01, tr - tt, tr + tt, CARVED, 1.0)
    # the frame on the face: an architrave with a small step
    if arch:
        pts = [(sc - hw, yb), (sc + hw, yb)] + [(sc + hw * math.cos(math.pi * k / 8), yt + hw * math.sin(math.pi * k / 8)) for k in range(9)]
    else:
        pts = [(sc - hw, yb), (sc + hw, yb), (sc + hw, yt), (sc - hw, yt)]
    prof = [(0.0, 0.0), (0.0, 0.07), (frame * 0.45, 0.07), (frame * 0.5, 0.1), (frame, 0.1), (frame, 0.0)]
    w.frame_sweep(dm if dm is not None else m, pts, prof, CARVED, 1.02)
    # the sill: a projecting stone
    w.box(m, sc - hw - frame - 0.05, sc + hw + frame + 0.05, 0.0, 0.16, yb - 0.14, yb, CARVED, 1.05, bottom=True)


def pediment(m, w, sc, hw, y0, rise, proj=0.22, e0=0.0, shade=1.0, seg=False):
    """A pediment over a window: a cornice across, raking cornices up to the apex (or a segment), the tympanum."""
    # the base cornice
    w.box(m, sc - hw, sc + hw, e0, e0 + proj, y0, y0 + 0.1, CARVED, 1.05, bottom=True)
    if seg:
        n = 6
        pts = []
        R = (hw * hw + rise * rise) / (2 * rise)
        yc = y0 + 0.1 + rise - R
        for k in range(n + 1):
            s = sc - hw + 2 * hw * k / n
            pts.append((s, yc + math.sqrt(max(0.0, R * R - (s - sc) ** 2))))
    else:
        pts = [(sc - hw, y0 + 0.1), (sc, y0 + 0.1 + rise), (sc + hw, y0 + 0.1)]
    # tympanum
    m.face([w.pt(s, e0 + 0.02, y) for s, y in [(sc + hw, y0 + 0.1)] + list(reversed(pts[1:-1])) + [(sc - hw, y0 + 0.1)]], CARVED, 0.92, w.out())
    # the raking cornice: a thick band along the top (front, top, underside)
    dy = 0.13
    for (sa, ya), (sb, yb) in zip(pts, pts[1:]):
        m.face([w.pt(sa, e0 + proj, ya), w.pt(sb, e0 + proj, yb), w.pt(sb, e0 + proj, yb + dy), w.pt(sa, e0 + proj, ya + dy)], CARVED, 1.05, w.out())
        m.face([w.pt(sa, e0, ya + dy), w.pt(sb, e0, yb + dy), w.pt(sb, e0 + proj, yb + dy), w.pt(sa, e0 + proj, ya + dy)], CARVED, 1.1,
               add(w.along(-(yb - ya)), (0, 0, sb - sa)))
        m.face([w.pt(sa, e0, ya), w.pt(sb, e0, yb), w.pt(sb, e0 + proj, yb), w.pt(sa, e0 + proj, ya)], CARVED, 0.7, add(w.along(yb - ya), (0, 0, -(sb - sa))))
    for (s, y), sg in ((pts[0], -1), (pts[-1], 1)):  # the ends
        m.face([w.pt(s, e0, y), w.pt(s, e0 + proj, y), w.pt(s, e0 + proj, y + dy), w.pt(s, e0, y + dy)], CARVED, 0.9, w.along(sg))


# ---------------------------------------------------------------- orders


def pilaster(m, dm, w, sc, hw, y0, y1, proj, order="doric", shade=1.0):
    """A pilaster: base (plinth, torus), shaft, capital; `proj` out of the wall."""
    yb, yc = y0 + 0.3, y1 - 0.35
    # the base: a plinth block and a torus (a chamfered band)
    w.box(m, sc - hw - 0.07, sc + hw + 0.07, 0, proj + 0.07, y0, y0 + 0.16, CARVED, 1.0)
    w.box(m, sc - hw - 0.04, sc + hw + 0.04, 0, proj + 0.04, y0 + 0.16, yb, CARVED, 1.02)
    # the shaft (fluting is too fine for the PS1 look: a sunk panel instead on the Ionic)
    w.box(m, sc - hw, sc + hw, 0, proj, yb, yc, CARVED, shade, top=False)
    if order == "ionic" and dm is not None:
        w.box(dm, sc - hw * 0.62, sc + hw * 0.62, proj, proj + 0.012, yb + 0.25, yc - 0.25, CARVED, 0.9, top=False)
    # the capital
    if order == "doric":
        w.box(m, sc - hw - 0.02, sc + hw + 0.02, 0, proj + 0.02, yc, yc + 0.12, CARVED, 1.0)  # necking
        w.box(m, sc - hw - 0.06, sc + hw + 0.06, 0, proj + 0.06, yc + 0.12, yc + 0.22, CARVED, 1.05)  # echinus
        w.box(m, sc - hw - 0.1, sc + hw + 0.1, 0, proj + 0.1, yc + 0.22, y1, CARVED, 1.08, bottom=True)  # abacus
    else:
        w.box(m, sc - hw - 0.02, sc + hw + 0.02, 0, proj + 0.03, yc, yc + 0.14, CARVED, 1.0)
        w.box(m, sc - hw - 0.08, sc + hw + 0.08, 0, proj + 0.08, yc + 0.2, y1, CARVED, 1.08, bottom=True)
        tgt = dm if dm is not None else m
        for sg in (-1, 1):  # the volutes: small scrolls at the capital's corners
            su = sc + sg * (hw + 0.02)
            c = w.pt(su, proj + 0.04, yc + 0.14)
            ring =[(0.1 * math.cos(2 * math.pi * k / 7), 0.1 * math.sin(2 * math.pi * k / 7)) for k in range(7)]
            tgt.extrude(ring, (c[0], c[1], c[2]), w.along(1), (0, 0, 1), w.out(), -proj - 0.04, 0.03, CARVED, 1.05)


def column(m, dm, cu, cv, y0, y1, r, order="doric", sides=10, shade=1.0, pedestal=None, mat=CARVED):
    """A free or engaged column at (cu, cv): Attic base, a shaft with entasis, capital, square abacus."""
    tgt = dm if dm is not None else m
    if pedestal:
        ph = pedestal
        m.box(cu - r * 1.5, cu + r * 1.5, cv - r * 1.5, cv + r * 1.5, y0, y0 + ph, mat, 1.0)
        m.box(cu - r * 1.65, cu + r * 1.65, cv - r * 1.65, cv + r * 1.65, y0 + ph - 0.08, y0 + ph, mat, 1.06)
        y0 += ph
    hb = max(0.18, r * 0.9)
    m.box(cu - r * 1.35, cu + r * 1.35, cv - r * 1.35, cv + r * 1.35, y0, y0 + hb * 0.35, mat, 1.0)
    tgt.lathe(cu, cv, [(r * 1.28, y0 + hb * 0.35), (r * 1.3, y0 + hb * 0.55), (r * 1.12, y0 + hb * 0.72), (r * 1.1, y0 + hb * 0.85), (r * 1.2, y0 + hb),
                       (r * 1.02, y0 + hb * 1.08)], sides, mat, 1.0, cap_top=False)
    ya, ycap = y0 + hb * 1.08, y1 - max(0.2, r * 1.1)
    prof = []
    for k in range(5):
        t = k / 4
        ent = 1 - 0.14 * max(0.0, t - 0.33) / 0.67
        prof.append((r * ent, ya + (ycap - ya) * t))
    m.lathe(cu, cv, prof, sides, mat, shade, cap_top=False)
    rt = r * 0.86
    hc = y1 - ycap
    if order == "doric":
        tgt.lathe(cu, cv, [(rt, ycap), (rt * 1.06, ycap + hc * 0.2), (rt * 1.02, ycap + hc * 0.3), (rt * 1.3, ycap + hc * 0.65)], sides, mat, 1.05, cap_top=True)
        m.box(cu - r * 1.35, cu + r * 1.35, cv - r * 1.35, cv + r * 1.35, ycap + hc * 0.65, y1, mat, 1.08, bottom=True)
    elif order == "ionic":
        tgt.lathe(cu, cv, [(rt, ycap), (rt * 1.1, ycap + hc * 0.3), (rt * 1.15, ycap + hc * 0.6)], sides, mat, 1.05)
        m.box(cu - r * 1.25, cu + r * 1.25, cv - r * 1.25, cv + r * 1.25, ycap + hc * 0.72, y1, mat, 1.08, bottom=True)
        for sg in (-1, 1):  # the volutes, rolls seen end on from the front (v) either side
            c = (cu + sg * r * 1.1, cv, ycap + hc * 0.5)
            ring = [(0.13 * r / 0.2 * math.cos(2 * math.pi * k / 8), 0.13 * r / 0.2 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
            tgt.extrude(ring, c, (1, 0, 0), (0, 0, 1), (0, 1, 0), -r * 0.9, r * 0.9, mat, 1.05, back=True)
    else:  # corinthian: a bell of leaves (two rings of flared facets) under a concave abacus
        tgt.lathe(cu, cv, [(rt, ycap), (rt * 1.25, ycap + hc * 0.35), (rt * 1.05, ycap + hc * 0.4), (rt * 1.4, ycap + hc * 0.75)], sides, mat, 1.05)
        m.box(cu - r * 1.4, cu + r * 1.4, cv - r * 1.4, cv + r * 1.4, ycap + hc * 0.75, y1, mat, 1.08, bottom=True)


def baluster(m, cu, cv, y0, y1, r=0.1, sides=6):
    h = y1 - y0
    prof = [(r * 0.9, y0), (r * 0.9, y0 + h * 0.08), (r * 0.55, y0 + h * 0.14), (r * 1.25, y0 + h * 0.42), (r * 0.5, y0 + h * 0.78),
            (r * 0.85, y0 + h * 0.86), (r * 0.9, y0 + h)]
    m.lathe(cu, cv, prof, sides, CARVED, 1.0, cap_top=False, smooth=True)


def balustrade(m, dm, w, s0, s1, y0, e, h=1.1, step=0.3, depth=0.36, shade=1.0, rail_mat=CARVED):
    """A balustrade along a wall: a plinth, turned balusters, the rail; e: its middle out of the wall."""
    ph, rh = 0.18, 0.18
    w.box(m, s0, s1, e - depth / 2, e + depth / 2, y0, y0 + ph, rail_mat, shade)
    w.box(m, s0 - 0.02, s1 + 0.02, e - depth / 2 - 0.03, e + depth / 2 + 0.03, y0 + h - rh, y0 + h, rail_mat, shade * 1.05, bottom=True)
    n = max(1, int((s1 - s0) / step))
    for k in range(n):
        s = s0 + (k + 0.5) * (s1 - s0) / n
        c = w.pt(s, e, 0)
        baluster(dm, c[0], c[1], y0 + ph, y0 + h - rh, r=0.1)


def console(m, w, s, y_top, h, proj, width=0.3, shade=1.0):
    """A scrolled console (bracket) under a slab: side outline a quarter curve with a roll at the foot."""
    pts = [(0.0, y_top), (proj, y_top), (proj, y_top - 0.12)]
    for k in range(1, 6):
        a = math.pi / 2 * k / 5
        pts.append((proj * (1 - math.sin(a)) * 0.75 + 0.12, y_top - 0.12 - (h - 0.25) * (1 - math.cos(a))))
    pts += [(0.12, y_top - h + 0.08), (0.18, y_top - h), (0.0, y_top - h)]
    # outline in (e, y), extruded along the wall
    O = w.pt(s, 0, 0)
    m.extrude([(p[0], p[1]) for p in pts], (O[0], O[1], 0.0), w.out(), (0, 0, 1), w.along(), -width / 2, width / 2, CARVED, shade, back=True)


def obelisk(m, cu, cv, y0, h, base=0.7, mat=CARVED, ball=True):
    m.box(cu - base / 2, cu + base / 2, cv - base / 2, cv + base / 2, y0, y0 + base * 0.9, mat, 1.0)
    m.box(cu - base / 2 - 0.06, cu + base / 2 + 0.06, cv - base / 2 - 0.06, cv + base / 2 + 0.06, y0 + base * 0.9, y0 + base, mat, 1.06)
    b0 = base * 0.34
    yb = y0 + base
    # four balls under the needle
    for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        m.lathe(cu + du * b0 * 0.9, cv + dv * b0 * 0.9, [(0.0, yb), (0.07, yb + 0.02), (0.09, yb + 0.08), (0.07, yb + 0.14), (0.0, yb + 0.16)], 6, mat, 1.0, cap_top=False)
    yb += 0.16
    ring0 = [(cu - b0, cv - b0), (cu + b0, cv - b0), (cu + b0, cv + b0), (cu - b0, cv + b0)]
    t = 0.28
    ring1 = [(cu + (p[0] - cu) * t, cv + (p[1] - cv) * t) for p in ring0]
    yt = yb + h
    for i in range(4):
        a, b, c, d = ring0[i], ring0[(i + 1) % 4], ring1[(i + 1) % 4], ring1[i]
        mid = ((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cv)
        m.face([(a[0], a[1], yb), (b[0], b[1], yb), (c[0], c[1], yt), (d[0], d[1], yt)], mat, 1.0, (mid[0], mid[1], 0.1))
    m.face([(p[0], p[1], yt) for p in ring1], mat, 1.0, (0, 0, 1))
    if ball:
        r = b0 * t * 1.4
        m.lathe(cu, cv, [(0.0, yt), (r * 0.7, yt + r * 0.3), (r, yt + r), (r * 0.7, yt + r * 1.7), (0.0, yt + r * 2)], 8, GILT, 1.0, cap_top=False)


# ---------------------------------------------------------------- statues


def figure(m, cu, cv, face_dir, y0, h, kind):
    """A standing figure in stone, h tall, facing face_dir (unit u-v): a robe (a flared turned body), the
    head, arms and what she holds. kind: justice (sword up, scales), prudence (a mirror, a snake), virgin (the
    Child on her left arm, a gilt crown)."""
    fu, fv = face_dir
    ru, rv = -fv, fu  # P(a) goes to her left for a > 0 (facing +v, her left is +u: the viewer's right)

    def P(a, f, y):  # a to her left (+) / right (-), f forward
        return (cu - ru * a + fu * f, cv - rv * a + fv * f, y)

    s = h / 2.2
    # plinth
    m.lathe(cu, cv, [(0.34 * s, y0), (0.36 * s, y0 + 0.12 * s), (0.3 * s, y0 + 0.16 * s)], 8, CARVED, 1.0)
    yb = y0 + 0.16 * s
    # the robe from the hem to the shoulders, a little forward at the knee
    prof = [(0.34 * s, yb), (0.3 * s, yb + 0.25 * s), (0.25 * s, yb + 0.8 * s), (0.2 * s, yb + 1.15 * s), (0.2 * s, yb + 1.35 * s),
            (0.23 * s, yb + 1.55 * s), (0.2 * s, yb + 1.7 * s), (0.08 * s, yb + 1.78 * s)]
    m.lathe(cu + fu * 0.03 * s, cv + fv * 0.03 * s, prof, 9, CARVED, 1.0, cap_top=True)
    # the neck and the head (a little forward)
    yh = yb + 1.78 * s
    hc = P(0, 0.03 * s, 0)
    m.lathe(hc[0], hc[1], [(0.05 * s, yh), (0.06 * s, yh + 0.08 * s), (0.1 * s, yh + 0.12 * s), (0.11 * s, yh + 0.22 * s), (0.09 * s, yh + 0.3 * s),
                           (0.0, yh + 0.34 * s)], 8, CARVED, 1.02, cap_top=False)
    # hair gathered behind
    bc = P(0, -0.08 * s, 0)
    m.lathe(bc[0], bc[1], [(0.0, yh + 0.12 * s), (0.07 * s, yh + 0.16 * s), (0.06 * s, yh + 0.26 * s), (0.0, yh + 0.3 * s)], 6, CARVED, 0.95, cap_top=False)
    ys = yb + 1.6 * s  # shoulders

    def limb(a0, f0, y0_, a1, f1, y1_, r):
        p0, p1 = P(a0, f0, y0_), P(a1, f1, y1_)
        d = norm(sub(p1, p0))
        up = (0, 0, 1) if abs(d[2]) < 0.9 else (1, 0, 0)
        x = norm(cross(d, up))
        yv = cross(x, d)
        ring = [(r * math.cos(2 * math.pi * k / 5), r * math.sin(2 * math.pi * k / 5)) for k in range(5)]
        ln = math.sqrt(dot(sub(p1, p0), sub(p1, p0)))
        m.extrude(ring, p0, x, yv, d, 0.0, ln, CARVED, 1.0, back=True)
        return p1

    if kind == "justice":
        hand = limb(-0.22 * s, 0.0, ys, -0.3 * s, 0.1 * s, ys + 0.45 * s, 0.055 * s)  # right arm raised
        # the sword, point up
        m.box(hand[0] - 0.02, hand[0] + 0.02, hand[1] - 0.02, hand[1] + 0.02, hand[2] - 0.1 * s, hand[2] + 0.75 * s, CARVED, 1.1)
        m.box(hand[0] - 0.12 * s * abs(ru) - 0.02, hand[0] + 0.12 * s * abs(ru) + 0.02, hand[1] - 0.12 * s * abs(rv) - 0.02,
              hand[1] + 0.12 * s * abs(rv) + 0.02, hand[2] + 0.05 * s, hand[2] + 0.09 * s, CARVED, 1.1)
        hand = limb(0.22 * s, 0.0, ys, 0.36 * s, 0.22 * s, ys - 0.35 * s, 0.055 * s)  # left arm out, the scales
        m.box(hand[0] - 0.015, hand[0] + 0.015, hand[1] - 0.015, hand[1] + 0.015, hand[2] - 0.25 * s, hand[2] + 0.02, CARVED, 1.05)
        bar = 0.2 * s
        m.box(hand[0] - bar * abs(ru) - 0.015, hand[0] + bar * abs(ru) + 0.015, hand[1] - bar * abs(rv) - 0.015, hand[1] + bar * abs(rv) + 0.015,
              hand[2] - 0.25 * s, hand[2] - 0.22 * s, CARVED, 1.05)
        for sg in (-1, 1):
            pc = (hand[0] + sg * bar * ru, hand[1] + sg * bar * rv)
            m.lathe(pc[0], pc[1], [(0.0, hand[2] - 0.5 * s), (0.09 * s, hand[2] - 0.47 * s), (0.1 * s, hand[2] - 0.44 * s)], 6, CARVED, 1.05)
            m.box(pc[0] - 0.01, pc[0] + 0.01, pc[1] - 0.01, pc[1] + 0.01, hand[2] - 0.44 * s, hand[2] - 0.24 * s, CARVED, 1.0)
    elif kind == "prudence":
        hand = limb(-0.22 * s, 0.0, ys, -0.28 * s, 0.24 * s, ys + 0.2 * s, 0.055 * s)  # right hand holds the mirror up to her face
        c = P(-0.22 * s, 0.3 * s, hand[2] + 0.12 * s)
        ring = [(0.13 * s * math.cos(2 * math.pi * k / 8), 0.13 * s * math.sin(2 * math.pi * k / 8)) for k in range(8)]
        m.extrude(ring, c, (ru, rv, 0), (0, 0, 1), (fu, fv, 0), -0.02, 0.02, CARVED, 1.1, back=True)
        hand = limb(0.22 * s, 0.0, ys, 0.3 * s, 0.1 * s, ys - 0.6 * s, 0.055 * s)  # left arm down, the snake round it
        for k in range(6):
            a = k * 1.1
            q = P(0.3 * s + 0.07 * s * math.cos(a), 0.1 * s + 0.07 * s * math.sin(a), ys - 0.1 * s - k * 0.09 * s)
            m.lathe(q[0], q[1], [(0.0, q[2]), (0.035 * s, q[2] + 0.02 * s), (0.0, q[2] + 0.06 * s)], 5, CARVED, 0.95, cap_top=False)
    else:  # the Virgin with the Child on her left arm, crowned
        limb(-0.22 * s, 0.0, ys, -0.12 * s, 0.24 * s, ys - 0.4 * s, 0.055 * s)
        limb(0.22 * s, 0.0, ys, 0.2 * s, 0.22 * s, ys - 0.35 * s, 0.055 * s)
        ch = P(0.16 * s, 0.25 * s, 0)
        m.lathe(ch[0], ch[1], [(0.1 * s, ys - 0.45 * s), (0.11 * s, ys - 0.25 * s), (0.08 * s, ys - 0.05 * s), (0.02 * s, ys)], 7, CARVED, 1.05, cap_top=False)
        m.lathe(ch[0], ch[1], [(0.03 * s, ys), (0.07 * s, ys + 0.04 * s), (0.07 * s, ys + 0.12 * s), (0.0, ys + 0.16 * s)], 7, CARVED, 1.05, cap_top=False)
        # the crown and a ring of gilt stars
        m.lathe(hc[0], hc[1], [(0.1 * s, yh + 0.27 * s), (0.12 * s, yh + 0.4 * s), (0.13 * s, yh + 0.42 * s)], 8, GILT, 1.1, cap_top=False)
        for k in range(9):
            a = math.pi * (0.1 + 0.8 * k / 8)
            q = P(0.32 * s * math.cos(a), -0.03, yh + 0.2 * s + 0.32 * s * math.sin(a))
            m.box(q[0] - 0.03, q[0] + 0.03, q[1] - 0.03, q[1] + 0.03, q[2] - 0.03, q[2] + 0.03, GILT, 1.1)


def eagle(m, cu, cv, y0, face_dir, span=2.2):
    """The gilt eagle on the top: a body on a ball, wings raised."""
    fu, fv = face_dir
    ru, rv = -fv, fu
    m.lathe(cu, cv, [(0.0, y0), (0.2, y0 + 0.05), (0.26, y0 + 0.25), (0.2, y0 + 0.45), (0.0, y0 + 0.5)], 8, GILT, 1.0, cap_top=False)
    yb = y0 + 0.5
    m.lathe(cu, cv, [(0.12, yb), (0.2, yb + 0.25), (0.18, yb + 0.6), (0.1, yb + 0.8), (0.0, yb + 0.85)], 7, GILT, 1.0, cap_top=False)
    # the head and beak, looking to its right
    m.lathe(cu - ru * 0.05, cv - rv * 0.05, [(0.0, yb + 0.8), (0.08, yb + 0.85), (0.08, yb + 0.98), (0.0, yb + 1.05)], 6, GILT, 1.0, cap_top=False)
    for sg in (-1, 1):
        pts = [(0.1, 0.45), (span / 2 * 0.55, 0.9), (span / 2, 1.35), (span / 2 * 0.92, 1.0), (span / 2 * 0.85, 0.85), (span / 2 * 0.75, 0.72),
               (span / 2 * 0.62, 0.6), (span / 2 * 0.45, 0.48), (0.12, 0.2)]
        pts = [(sg * a, y) for a, y in pts]
        if sg < 0:
            pts.reverse()
        m.extrude(pts, (cu, cv, yb), (ru, rv, 0), (0, 0, 1), (fu, fv, 0), -0.04, 0.04, GILT, 1.0, back=True)
    # tail
    m.extrude([(-0.12, 0.1), (0.12, 0.1), (0.2, -0.25), (-0.2, -0.25)], (cu - fu * 0.12, cv - fv * 0.12, yb), (ru, rv, 0), (0, 0, 1), (fu, fv, 0), -0.03, 0.03, GILT, 1.0, back=True)


# ---------------------------------------------------------------- the building

FRONT_GRID = [-U + k * BW for k in range(NB + 1)]
SIDE_GRID = [VB + k * (VF - VB) / NS for k in range(NS + 1)]


def bay_label(name, w, sc):
    """Human words for a bay of a wing's wall (issue #10): which face, which side seen from the Grote Markt, which bay."""
    u, v, _ = w.pt(sc, 0.0, 0.0)
    side = "left" if u < 0 else "right"
    if name == "front":
        return f"the Grote Markt front, the {side} wing, bay {int((abs(u) - (FW - 0.24)) / BW) + 1} from the frontispiece"
    if name == "back":
        return f"the back, the {side} half (seen from the Grote Markt), bay {int((abs(u) - (SB + 1.14)) / BW) + 1} from the stair block"
    return f"the {side} side (seen from the Grote Markt), bay {int((VF - v) / ((VF - VB) / NS)) + 1} from the front"


STOREY_WORDS = {"ground": "the arcade's arch (a glazed shop front)", "doric": "the first floor's cross window (the Doric storey)",
                "ionic": "the second floor's cross window (the Ionic storey)"}


def walls():
    """The wings' walls as runs: (name, wall, s0, s1, grid lines in s, corner at s0, corner at s1, part).
    part: 'low' (ground floor and storeys), 'top' (loggia and cornice), or 'both'. Each wall's d points to
    the right seen from outside: front +u, back -u, east -v, west +v."""
    front = Wall((0, VF), (1, 0), (0, 1))
    back = Wall((0, VB), (-1, 0), (0, -1))
    east = Wall((U, 0), (0, -1), (1, 0))
    west = Wall((-U, 0), (0, 1), (-1, 0))
    fg = FRONT_GRID
    bg = sorted(-x for x in fg)
    eg = sorted(-x for x in SIDE_GRID)
    wg = SIDE_GRID
    return [
        ("front", front, -U, -FW, fg, True, False, "both"),
        ("front", front, FW, U, fg, False, True, "both"),
        ("back", back, -U, -SB, bg, True, False, "low"),
        ("back", back, SB, U, bg, False, True, "low"),
        ("back", back, -U, U, bg, True, True, "top"),
        ("east", east, -VF, -VB, eg, True, True, "both"),
        ("west", west, VB, VF, wg, True, True, "both"),
    ]


# the chains of the horizontal mouldings, counter-clockwise round the wings (outside on the right): below the
# loggia they stop at the frontispiece and at the stair block; the loggia's and the main cornice run round the back
LOW_CHAINS = [[(SB, VB), (U, VB), (U, VF), (FW, VF)], [(-FW, VF), (-U, VF), (-U, VB), (-SB, VB)]]
GROUND_CHAINS = [[(SB, VB), (U, VB), (U, VF + GF), (FW, VF + GF)], [(-FW, VF + GF), (-U, VF + GF), (-U, VB), (-SB, VB)]]
TOP_CHAIN = [(-FW, VF), (-U, VF), (-U, VB), (U, VB), (U, VF), (FW, VF)]


def chain_sweep(m, chains, prof, mat, shade=1.0):
    for ch in chains:
        m.sweep(ch, (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), prof, mat, shade)


def ent_prof(ye, y1, proj_c=0.42):
    """An entablature from ye to y1: architrave in two fascias, frieze, cornice."""
    return ([(0, ye), (0.2, ye), (0.2, ye + 0.14), (0.24, ye + 0.16), (0.24, ye + 0.3), (0.16, ye + 0.32), (0.16, ye + 0.64)] +
            [(0.16 + p[0], p[1]) for p in cornice_prof(ye + 0.64, y1 - ye - 0.64, proj_c)[1:-1]] + [(0, y1)])


TOP_PROF = ([(0, LC - 0.02), (0.46, LC - 0.02), (0.46, LC + 0.14), (0.5, LC + 0.16), (0.5, LC + 0.3), (0.42, LC + 0.32), (0.42, 25.2)] +
            [(0.42 + p[0], p[1]) for p in cornice_prof(25.2, 0.8, 0.78)[1:-1]] + [(0, CO)])
STOREYS = ((G, S1, "doric", 8.1, 12.2, 7.75), (S1, S2, "ionic", 14.8, 18.9, 14.6))
AH, AYS = 0.95, 3.7  # the ground floor's arches: half width, springing


def build(fr):
    body = Mesh(fr, "stadhuis_body")
    det = Mesh(fr, "stadhuis_detail")
    m, dm = body, det
    for name, w, s0, s1, grid, c0, c1, part in walls():
        if part in ("low", "both"):
            ground(m, dm, name, w, s0, s1, grid, c0, c1)
            storeys(m, dm, name, w, s0, s1, grid, c0, c1)
        if part in ("top", "both"):
            loggia(m, dm, name, w, s0, s1, grid, c0, c1)
    # the horizontal mouldings, continuous round the corners
    chain_sweep(m, GROUND_CHAINS, [(0, 0.0), (0.2, 0.0), (0.2, PL - 0.06), (0.15, PL), (0, PL)], BLUE, 0.95)
    chain_sweep(m, GROUND_CHAINS, [(0, 6.1), (0.18, 6.1), (0.18, 6.45)] + [(0.18 + p[0], p[1]) for p in cornice_prof(6.45, 0.55, 0.3)[1:-1]] + [(0, 7.0)], BLUE, 1.0)
    for y0, y1, order, wy0, wy1, ped in STOREYS:
        # (the band stands on the ledge or the ground floor's cornice: no bottom face)
        chain_sweep(m, LOW_CHAINS, band_prof(y0, 0.12, 0.12)[1:], CARVED, 1.0)
        chain_sweep(m, LOW_CHAINS, [(0, ped - 0.1), (0.12, ped - 0.1), (0.16, ped - 0.03), (0.16, ped), (0, ped)], CARVED, 1.04)
        chain_sweep(m, LOW_CHAINS, ent_prof(y1 - 1.0, y1), CARVED, 1.02)
    chain_sweep(m, [TOP_CHAIN], TOP_PROF, CARVED, 1.02)
    # the ledge over the front's ground floor, back to the wings' face
    for a, b in ((-U, -FW), (FW, U)):
        m.face([(a, VF, 7.0), (b, VF, 7.0), (b, VF + GF, 7.0), (a, VF + GF, 7.0)], BLUE, 1.0, (0, 0, 1))
    corners(m, dm)
    frontispiece(m, dm, Wall((0, FV), (1, 0), (0, 1)))
    stair_block(m, dm)
    roof(m, dm)
    return body, det


def bays_in(grid, s0, s1):
    """The bays of the grid whose middle is in s0..s1: (a, b, middle)."""
    return [(a, b, (a + b) / 2) for a, b in zip(grid, grid[1:]) if s0 < (a + b) / 2 < s1]


def lines_in(grid, s0, s1, c0, c1, inset=0.3):
    """The pilaster lines in a run: a corner's line moved in by `inset` (the corner itself is filled apart);
    lines too near a run's end that is not a corner are left out."""
    out = []
    for x in grid:
        if abs(x - s0) < 1e-3:
            if c0:
                out.append(s0 + inset)
        elif abs(x - s1) < 1e-3:
            if c1:
                out.append(s1 - inset)
        elif s0 + 0.45 < x < s1 - 0.45:
            out.append(x)
    return out


def ground(m, dm, name, w, s0, s1, grid, c0, c1):
    """The ground floor of a run: a rusticated bluestone face with round arches, voussoirs and keystones, the
    shop fronts inside (the front's ground floor stands GF out of the wings' face; the sides' reach round it)."""
    gf = GF if name == "front" else 0.0
    rproj = 0.16 if name == "front" else 0.12
    a0, a1 = s0, s1
    # the sides' ground floor reaches round the front's (their front end runs on GF)
    if name == "east" and c0:
        a0 = s0 - GF
    if name == "west" and c1:
        a1 = s1 + GF
    # (no arch in a bay at a corner: the corner stays a solid rusticated pier, the two sides' arches never meet)
    holes = [(sc, AH, PL, AYS, True) for a, b, sc in bays_in(grid, s0, s1)
             if not ((c0 and sc - s0 < BW * 0.75) or (c1 and s1 - sc < BW * 0.75))]
    wg = w.at(gf)
    holed_face(m, wg, a0, a1, 0.0, 6.1, holes, BLUE, 0.92)
    # the rusticated courses: chamfered bands, one per block (joints staggered), cut round the arches
    R = AH + 0.62
    y, k = PL, 0
    blk = 1.25
    while y < 6.05:
        y1 = min(y + 0.5, 6.1)
        ym = (y + y1) / 2
        cuts = []
        for sc, hw, *_ in holes:
            if ym < AYS:
                cuts.append((sc - hw, sc + hw))
            elif ym - AYS < R:
                dx = math.sqrt(max(0.0, R * R - (ym - AYS) ** 2))
                cuts.append((sc - dx, sc + dx))
        ch = 0.05
        prof = [(0, y + 0.015), (rproj - ch, y + 0.015), (rproj, y + 0.015 + ch), (rproj, y1 - 0.015 - ch), (rproj - ch, y1 - 0.015), (0, y1 - 0.015)]
        # at a corner the band reaches past the wall's end by its own relief (the other side's band meets it)
        e0 = a0 - (rproj if (c0 and name in ("front", "back")) else 0.0)
        e1 = a1 + (rproj if (c1 and name in ("front", "back")) else 0.0)
        for a, b in solid_runs(e0, e1, cuts):
            if b - a < 0.05:
                continue
            off = (k % 2) * blk / 2
            xs = [a] + [x for x in (e0 + off + j * blk for j in range(int((e1 - e0) / blk) + 2)) if a + 0.25 < x < b - 0.25] + [b]
            for xa, xb in zip(xs, xs[1:]):
                wg.hsweep(m, xa + 0.012, xb - 0.012, prof, BLUE, 1.0 - 0.05 * (k % 2))
        y = y1
        k += 1
    # the arches: nine voussoirs, the keystone standing out; the soffit back to the shop front
    shop_e = 0.05 if name == "front" else (-0.1 if name == "back" else -0.35)
    for sc, hw, yb, yt, _ in holes:
        nv = 9
        for j in range(nv):
            b0, b1 = math.pi * j / nv + 0.012, math.pi * (j + 1) / nv - 0.012
            key = j == nv // 2
            r0, r1 = hw, hw + (0.8 if key else 0.6)
            pr = rproj + (0.1 if key else 0.03)
            pts = [(sc + r0 * math.cos(b0), AYS + r0 * math.sin(b0)), (sc + r1 * math.cos(b0), AYS + r1 * math.sin(b0)),
                   (sc + r1 * math.cos(b1), AYS + r1 * math.sin(b1)), (sc + r0 * math.cos(b1), AYS + r0 * math.sin(b1))]
            m.extrude(pts, (wg.p[0], wg.p[1], 0.0), wg.X, wg.Y, wg.Z, 0.0, pr, BLUE, 1.02 if key else 0.97)
        # impost blocks at the springing
        for sg in (-1, 1):
            i0, i1 = (sc + hw - 0.06, sc + hw + 0.3) if sg > 0 else (sc - hw - 0.3, sc - hw + 0.06)
            wg.box(m, i0, i1, 0, rproj + 0.04, AYS - 0.2, AYS, BLUE, 1.02)
        reveal(m, wg, sc, hw, PL, AYS, shop_e - gf, 0.0, BLUE, 0.62, rnd=True, sill=False)
        shop(m, dm, w, sc, hw, AYS, shop_e)
        # issue #10: the arch is a real window of the room behind (its shop front's oak stays, its glass is the room's)
        real_opening(wg, sc, hw, PL, AYS + hw, True, gf - shop_e, "window", f"{bay_label(name, w, sc)}, {STOREY_WORDS['ground']}", glaze="sash")
        # the sill of the arch: a bluestone step
        m.face([wg.pt(sc - hw, shop_e - gf, PL), wg.pt(sc + hw, shop_e - gf, PL), wg.pt(sc + hw, 0, PL), wg.pt(sc - hw, 0, PL)], BLUE, 0.9, (0, 0, 1))


def storeys(m, dm, name, w, s0, s1, grid, c0, c1):
    """The Doric and the Ionic storey of a run: ashlar with cross windows, pilasters, triglyphs and dentils."""
    bays = bays_in(grid, s0, s1)
    lines = lines_in(grid, s0, s1, c0, c1)
    plain = name == "back"
    for y0, y1, order, wy0, wy1, ped in STOREYS:
        wholes = [(sc, 0.78, wy0, wy1, False) for a, b, sc in bays]
        holed_face(m, w, s0, s1, y0, y1, wholes, WHITE, 1.0)
        for sc, hw, yb, yt, _ in wholes:
            cross_window(m, dm, w, sc, hw, yb, yt, depth=0.12, transom=yb + (yt - yb) * 0.66, label=f"{bay_label(name, w, sc)}, {STOREY_WORDS[order]}")
            if order == "doric":
                if not plain:
                    pediment(m, w, sc, hw + 0.28, yt + 0.12, 0.42, proj=0.24, seg=(int(round((abs(sc) + U) / BW)) % 2 == 1))
                else:
                    w.box(m, sc - hw - 0.25, sc + hw + 0.25, 0, 0.2, yt + 0.12, yt + 0.28, CARVED, 1.05, bottom=True)
            else:
                w.box(m, sc - hw - 0.15, sc + hw + 0.15, 0, 0.1, yt + 0.12, yt + 0.36, CARVED, 0.98)
                w.box(m, sc - hw - 0.28, sc + hw + 0.28, 0, 0.24, yt + 0.36, yt + 0.5, CARVED, 1.06, bottom=True)
            # the apron under the window: a raised panel in the pedestal zone
            w.box(m, sc - hw, sc + hw, 0, 0.05, y0 + 0.16, ped - 0.12, CARVED, 0.96)
        for x in lines:
            pilaster(m, dm, w, x, 0.3, ped, y1 - 1.0, 0.2, order, 1.0)
        ye = y1 - 1.0
        if order == "doric":  # triglyphs over the pilasters and the bays' middles
            for x in lines + [sc for a, b, sc in bays]:
                w.box(dm, x - 0.16, x + 0.16, 0.16, 0.22, ye + 0.32, ye + 0.64, CARVED, 1.06, bottom=True)
                for g in (-0.08, 0.0, 0.08):
                    w.box(dm, x + g - 0.018, x + g + 0.018, 0.22, 0.235, ye + 0.36, ye + 0.62, CARVED, 0.78, top=False)
        else:  # dentils under the Ionic cornice
            n = int((s1 - s0) / 0.24)
            for j in range(n):
                x = s0 + (j + 0.5) * (s1 - s0) / n
                w.box(dm, x - 0.07, x + 0.07, 0.16, 0.26, ye + 0.66, ye + 0.78, CARVED, 0.95, bottom=True)


def loggia(m, dm, name, w, s0, s1, grid, c0, c1):
    """The gallery under the eaves: small Corinthian columns on pedestals, a balustrade between them, the dark
    gallery behind with doors to the attics; solid piers at the corners. Blind on the back (the stair block)."""
    open_ = name != "back"
    bays = bays_in(grid, s0, s1)
    p0 = s0 + (IN if c0 else 0.0)
    p1 = s1 - (IN if c1 else 0.0)
    if open_:
        wb = w.at(-IN)
        wb.quad(m, p0, p1, S2, LC, 0, WHITE, 0.42)
        for a, b, sc in bays:
            if p0 + 0.6 < sc < p1 - 0.6:
                wb.box(m, sc - 0.45, sc + 0.45, 0, 0.04, S2, S2 + 2.3, OAK, 0.4, top=False)
                wb.box(m, sc - 0.55, sc + 0.55, 0, 0.08, S2 + 2.3, S2 + 2.45, CARVED, 0.5)
        m.face([w.pt(p0, -IN, LC), w.pt(p1, -IN, LC), w.pt(p1, 0, LC), w.pt(p0, 0, LC)], CARVED, 0.48, (0, 0, -1))
        m.face([w.pt(p0, -IN, S2), w.pt(p1, -IN, S2), w.pt(p1, 0, S2), w.pt(p0, 0, S2)], BLUE, 0.6, (0, 0, 1))
        for s, sg, c in ((p0, 1, c0), (p1, -1, c1)):
            if c:  # the corner pier: its face on the wall, its side into the gallery
                a, b = (s0, p0) if sg > 0 else (p1, s1)
                w.quad(m, a, b, S2, LC, 0, WHITE, 0.95)
                m.face([w.pt(s, -IN, S2), w.pt(s, 0, S2), w.pt(s, 0, LC), w.pt(s, -IN, LC)], WHITE, 0.55, w.along(sg))
    else:
        w.quad(m, s0, s1, S2, LC, 0, WHITE, 0.9)
    cols = set()
    for a, b, sc in bays:
        for x in (a, sc, b):
            if p0 + 0.25 < x < p1 - 0.25:
                cols.add(round(x, 4))
    if not open_:
        cols = {c for c in cols if abs(c) > SB + 0.8}
    for c in sorted(cols):
        p = w.pt(c, 0.28, 0)
        column(m, dm, p[0], p[1], S2, LC, 0.16, "corinthian", 8, 1.0, pedestal=1.15)
    edges = sorted(cols | {p0, p1})
    for a, b in zip(edges, edges[1:]):
        if not open_ and abs((a + b) / 2) < SB + 1.0:
            continue
        ia = a + (0.27 if a in cols else 0.05)
        ib = b - (0.27 if b in cols else 0.05)
        if ib - ia > 0.3:
            balustrade(m, dm, w, ia, ib, S2, 0.28, h=1.15, step=0.26, depth=0.32)
    for x in (p0, p1):  # a pilaster on each corner pier
        if (x == p0 and c0) or (x == p1 and c1):
            xc = (s0 + 0.3) if x == p0 else (s1 - 0.3)
            w.box(m, xc - 0.3, xc + 0.3, 0, 0.2, S2, LC, CARVED, 1.0, top=False)
    # modillions under the main cornice's corona
    n = int((s1 - s0) / 0.62)
    for j in range(n):
        x = s0 + (j + 0.5) * (s1 - s0) / n
        console(dm, w.at(0.42), x, 25.45, 0.3, 0.5, 0.14, 0.95)


def solid_runs(s0, s1, cuts):
    cuts = sorted(cuts)
    out, x = [], s0
    for a, b in cuts:
        if a > x:
            out.append((x, a))
        x = max(x, b)
    if x < s1:
        out.append((x, s1))
    return out


def shop(m, dm, w, sc, hw, ys, e):
    """The shop front inside a ground-floor arch: a panelled oak stall board, a glazed front in oak frames, an
    iron-barred fanlight in the arch."""
    wi = w.at(e)
    wi.quad(m, sc - hw, sc + hw, PL, PL + 0.9, 0, OAK, 0.55)
    wi.box(m, sc - hw, sc + hw, 0, 0.1, PL + 0.9, PL + 1.0, OAK, 0.6)
    glass(m, wi, sc - hw + 0.08, sc + hw - 0.08, PL + 1.0, ys - 0.12, -0.02, shade=0.8, lit=True)
    for x in (sc - hw, sc - 0.035, sc + hw - 0.07):
        wi.box(m, x, x + 0.07, -0.02, 0.06, PL + 1.0, ys, OAK, 0.5, top=False)
    wi.box(m, sc - hw, sc + hw, -0.02, 0.08, ys - 0.12, ys, OAK, 0.55)
    glass(m, wi, sc - hw, sc + hw, ys, ys, -0.03, shade=0.75, arch_top=True, lit=True)
    for k in range(1, 6):
        a = math.pi * k / 6
        ax = norm(add(wi.along(math.cos(a)), (0, 0, math.sin(a))))
        dm.extrude([(0, -0.02), (hw, -0.02), (hw, 0.02), (0, 0.02)], wi.pt(sc, 0, ys), ax, norm(cross(wi.out(), ax)), wi.out(), -0.03, 0.01, LEAD, 0.6)


def corners(m, dm):
    """The corners of the wings: the pilasters of the two sides meet round a small corner block."""
    for cu, cv in ((U, VF), (-U, VF), (U, VB), (-U, VB)):
        su, sv = (1 if cu > 0 else -1), (1 if cv > 0 else -1)
        for y0, y1 in ((7.75, S1 - 1.0), (14.6, S2 - 1.0), (S2, LC)):
            m.box(min(cu, cu + su * 0.2), max(cu, cu + su * 0.2), min(cv, cv + sv * 0.2), max(cv, cv + sv * 0.2), y0, y1, CARVED, 1.0, top=False)


def frontispiece(m, dm, w):
    """The frontispiece: three bays between coupled columns, storey over storey, and its stages over the roof.
    w: its face (v = FV)."""
    # the returns back to the wings' face, up to the cornice
    for sg in (-1, 1):
        m.face([(sg * FW, VF + GF, 0), (sg * FW, FV, 0), (sg * FW, FV, 7.0), (sg * FW, VF + GF, 7.0)], BLUE, 0.85, (sg, 0, 0))
        m.face([(sg * FW, VF, 7.0), (sg * FW, FV, 7.0), (sg * FW, FV, CO), (sg * FW, VF, CO)], WHITE, 0.85, (sg, 0, 0))
        # the end of the wing's gallery
        m.face([(sg * FW, VF - IN, S2), (sg * FW, VF, S2), (sg * FW, VF, LC), (sg * FW, VF - IN, LC)], WHITE, 0.5, (sg, 0, 0))
    # ---- the ground storey: rusticated, three round-arched doors (the middle one the entrance)
    doors = [(-3.6, 1.2, 5.2), (0.0, 1.7, 6.2), (3.6, 1.2, 5.2)]
    holed_face(m, w, -FW, FW, 0.0, 6.6, [(sc, hw, 0.0, h - hw, True) for sc, hw, h in doors], BLUE, 0.92)
    # (no body's front wall behind the portals, issue #10: the portals' reveals end at the door plane, their leaves close
    # the side doors, and behind them the vestibule's own wall (the room's lining) stands, cut for the main door and
    # the three fanlights)
    course = 0.5
    y, k = PL, 0
    while y < 6.05:
        y1 = min(y + course, 6.6)
        ym = (y + y1) / 2
        cuts = []
        for sc, hw, h in doors:
            ys = h - hw
            R = hw + 0.42
            if ym < ys:
                cuts.append((sc - hw, sc + hw))
            elif ym - ys < R:
                dx = math.sqrt(max(0.0, R * R - (ym - ys) ** 2))
                cuts.append((sc - dx, sc + dx))
        for a, b in solid_runs(-FW, FW, cuts):
            if b - a > 0.05:
                prof = [(0, y + 0.015), (0.1, y + 0.015), (0.14, y + 0.055), (0.14, y1 - 0.055), (0.1, y1 - 0.015), (0, y1 - 0.015)]
                w.hsweep(m, a + 0.012, b - 0.012, prof, BLUE, 1.0 - 0.04 * (k % 2))
        y = y1
        k += 1
    for sc, hw, h in doors:
        ys = h - hw
        nv = 11
        for j in range(nv):
            a0, a1 = math.pi * j / nv + 0.01, math.pi * (j + 1) / nv - 0.01
            key = j == nv // 2
            r0, r1 = hw, hw + (0.5 if key else 0.4)
            pts = [(sc + r0 * math.cos(a0), ys + r0 * math.sin(a0)), (sc + r1 * math.cos(a0), ys + r1 * math.sin(a0)),
                   (sc + r1 * math.cos(a1), ys + r1 * math.sin(a1)), (sc + r0 * math.cos(a1), ys + r0 * math.sin(a1))]
            m.extrude(pts, (w.p[0], w.p[1], 0.0), w.X, w.Y, w.Z, 0.0, 0.2 if key else 0.16, BLUE, 1.02)
    # the portals: splayed round-arched reveals to the doors; the main one open (the game hangs its leaves)
    portal(m, dm, w, 0.0, 1.7, 1.4, 1.2, 6.2, 5.8, 4.2, "town hall, main door", leaves=False)
    for sc in (-3.6, 3.6):
        portal(m, dm, w, sc, 1.2, 1.0, 1.2, 5.2, 4.9, 3.6, f"town hall, {'left' if sc < 0 else 'right'} side door (seen from the Grote Markt)", leaves=True, steps=False)
    # the plinth and the quoin columns at the corners
    for a, b in solid_runs(-FW, FW, [(sc - hw, sc + hw) for sc, hw, _ in doors]):
        w.hsweep(m, a, b, [(0, 0.0), (0.2, 0.0), (0.2, PL - 0.08), (0.14, PL), (0, PL)], BLUE, 0.95)
    for sg in (-1, 1):
        column(m, dm, sg * 5.75, FV - 0.15, 0.0, 6.2, 0.26, "doric", 12, 1.0, pedestal=1.1, mat=BLUE)

    # ---- the balcony on consoles
    for x in (-5.0, -2.6, 2.6, 5.0):
        console(m, w, x, 6.6, 1.1, 0.9, 0.32, 1.0)
    w.hsweep(m, -FW + 0.2, FW - 0.2, [(0, 6.2), (0.35, 6.2), (0.8, 6.45), (0.95, 6.5), (0.95, 7.0), (0, 7.0)], CARVED, 1.05)
    balustrade(m, dm, w, -FW + 0.35, FW - 0.35, 7.0, 0.78, h=1.0, step=0.26, depth=0.3)
    for sg in (-1, 1):  # its return ends
        balustrade(m, dm, Wall((sg * (FW - 0.37), FV), (0, 1), (sg, 0)), 0.1, 0.6, 7.0, 0.0, h=1.0, step=0.26, depth=0.3)

    # ---- the storeys: coupled columns, arched windows (the middle one the balcony's door), then pedimented ones
    pairs = [-6.1, -5.5, -2.35, -1.75, 1.75, 2.35, 5.5, 6.1]
    wins = [(-3.925, 0.8), (0.0, 0.95), (3.925, 0.8)]
    for (y0, y1, order, r) in ((G, S1, "doric", 0.21), (S1, S2, "ionic", 0.19), (S2, CO - 0.8, "corinthian", 0.18)):
        if y0 == G:
            holes = [(sc, hw, 7.0 if sc == 0 else 7.9, 11.2, True) for sc, hw in wins]
        elif y0 == S1:
            holes = [(sc, hw, 14.8, 18.8, False) for sc, hw in wins]
        else:  # the loggia's storey: Justice and Prudence in niches either side of an arched window
            holes = [(0.0, 0.8, 21.2, 23.0, True), (-3.925, 0.72, 21.0, 21.0 + 3.1 - 0.72, True), (3.925, 0.72, 21.0, 21.0 + 3.1 - 0.72, True)]
        holed_face(m, w, -FW, FW, y0, y1 if y1 < CO - 1 else CO - 0.8, holes, WHITE, 1.0)
        if y0 == S2:
            for sc, kind in ((-3.925, "justice"), (3.925, "prudence")):
                niche(m, w, sc, 21.0, 0.72, 3.1, depth=0.5)
                c = w.pt(sc, -0.2, 0)
                figure(m, c[0], c[1], (0, 1), 21.0, 2.45, kind)
            holes = holes[:1]
        for sc, hw, yb, yt, rnd in holes:
            where = "the middle" if sc == 0 else ("the left" if sc < 0 else "the right")
            what = {G: "the first floor's window" if sc else "the first floor's balcony door (glazed)", S1: "the second floor's window", S2: "the window under the cornice"}[y0]
            cross_window(m, dm, w, sc, hw, yb, yt, depth=0.35, transom=(yb + 2.8 if sc == 0 and y0 == G else None), arch=rnd, mull=True,
                         label=f"the frontispiece, {where}, {what}")
            if y0 == S1:
                pediment(m, w, sc, hw + 0.3, yt + 0.14, 0.5, proj=0.26, seg=(sc != 0))
        for x in pairs:
            ped = 0.75 if y0 < S2 else 1.15
            yt = y1 - 1.0 if y0 < S2 else LC
            column(m, dm, x, FV + 0.08, y0, yt, r, order, 10, 1.0, pedestal=ped)
        # the entablature breaks forward over the columns (the wings' own runs to the returns)
        if y0 < S2:
            ye = y1 - 1.0
            w.hsweep(m, -FW, FW, [(0, ye), (0.34, ye), (0.34, ye + 0.3), (0.3, ye + 0.32), (0.3, ye + 0.64)] +
                     [(0.3 + p[0], p[1]) for p in cornice_prof(ye + 0.64, 0.36, 0.45)[1:-1]] + [(0, y1)], CARVED, 1.04)
    # the loggia storey's entablature and the main cornice across the frontispiece
    w.hsweep(m, -FW, FW, [(0, LC - 0.02), (0.36, LC - 0.02), (0.36, 25.2)] + [(0.36 + p[0], p[1]) for p in cornice_prof(25.2, 0.8, 0.8)[1:-1]] + [(0, CO)],
             CARVED, 1.04)
    # the cornice's returns at the frontispiece's sides (over the wings' cornice)
    for sg in (-1, 1):
        rw = Wall((sg * FW, FV), (0, -1), (sg, 0))
        rw.hsweep(m, 0.0, FV - VF, [(0, LC - 0.02), (0.36, LC - 0.02), (0.36, 25.2)] + [(0.36 + p[0], p[1]) for p in cornice_prof(25.2, 0.8, 0.8)[1:-1]] + [(0, CO)],
                  CARVED, 1.0)

    stages(m, dm, w)


def portal(m, dm, w, sc, hw0, hw1, depth, h0, h1, lintel, name, leaves=True, steps=True):
    """A round-arched portal: splayed jambs and soffit from the face (hw0, h0) to the door (hw1, h1) `depth`
    in; a carved lintel band, a glazed fanlight with radiating bars; oak leaves (or none: the game's)."""
    def W(s, y, dep):
        return w.pt(s, -dep, y)
    ys0, ys1 = h0 - hw0, h1 - hw1
    seg = 10
    A = [(hw0, 0.0), (hw0, ys0)] + [(hw0 * math.cos(math.pi * k / seg), ys0 + hw0 * math.sin(math.pi * k / seg)) for k in range(1, seg)] + [(-hw0, ys0), (-hw0, 0.0)]
    Bb = [(hw1, 0.0), (hw1, ys1)] + [(hw1 * math.cos(math.pi * k / seg), ys1 + hw1 * math.sin(math.pi * k / seg)) for k in range(1, seg)] + [(-hw1, ys1), (-hw1, 0.0)]
    for i in range(len(A) - 1):
        pa, pb, qa, qb = A[i], A[i + 1], Bb[i], Bb[i + 1]
        mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
        out = (-w.d[0] * mid[0], -w.d[1] * mid[0], -(mid[1] - ys0) if mid[1] > ys0 else 0)
        # the reveal: two bands, a step between them (a moulding round the opening)
        mdep = depth * 0.4
        pm = lambda p, q: (p[0] + (q[0] - p[0]) * 0.35, p[1] + (q[1] - p[1]) * 0.35)  # noqa: E731
        f = m.face([W(sc + pa[0], pa[1], 0), W(sc + pb[0], pb[1], 0), W(sc + pm(pb, qb)[0], pm(pb, qb)[1], mdep), W(sc + pm(pa, qa)[0], pm(pa, qa)[1], mdep)],
                   BLUE, 0.72, (out[0] + w.o[0] * 0.5, out[1] + w.o[1] * 0.5, out[2]))
        f = m.face([W(sc + pm(pa, qa)[0], pm(pa, qa)[1], mdep), W(sc + pm(pb, qb)[0], pm(pb, qb)[1], mdep), W(sc + qb[0], qb[1], depth), W(sc + qa[0], qa[1], depth)],
                   BLUE, 0.55, out)
    if name and hasattr(m, "door"):
        m.door(name, W(sc, 0, depth))
    # the lintel over the door and the fanlight above it (glass with radiating bars), at the door's plane
    wd = w.at(-depth)
    wd.box(m, sc - hw1, sc + hw1, 0.0, 0.2, lintel - 0.62, lintel, CARVED, 1.02, bottom=True)
    pts = [(sc - hw1, lintel), (sc + hw1, lintel), (sc + hw1, ys1)] + [(sc + hw1 * math.cos(math.pi * k / 10), ys1 + hw1 * math.sin(math.pi * k / 10)) for k in range(1, 10)] + [(sc - hw1, ys1)]
    uvs = [((s - sc + hw1) / 1.0, (y - lintel) / 1.25) for s, y in pts]
    # issue #10: the fanlight is a real window of the vestibule behind (its lead bars stay, its glass is the room's)
    LIT[0].face([wd.pt(s, 0.01, y) for s, y in pts], GLASS_LIT, 0.7, wd.out(), uvs)
    real_opening(w, sc, hw1, lintel, h1, True, depth, "window", f"{name}, its fanlight")
    if not leaves:
        # the open door (the game hangs its leaves): its doorway under the lintel
        real_opening(w, sc, hw1, 0.0, lintel - 0.62, False, depth, "door", name, glaze="")
    for k in range(1, 8):
        a = math.pi * k / 8
        p1 = (sc + hw1 * math.cos(a), ys1 + hw1 * math.sin(a))
        dd = (p1[0] - sc, p1[1] - lintel)
        ln = math.hypot(*dd)
        ax = norm(add(wd.along(dd[0] / ln), (0, 0, dd[1] / ln)))
        dm.extrude([(0, -0.025), (ln, -0.025), (ln, 0.025), (0, 0.025)], wd.pt(sc, 0.0, lintel), ax, norm(cross(wd.out(), ax)), wd.out(), 0.0, 0.05, LEAD, 0.55)
    if leaves:
        dh = lintel - 0.62
        for s0, s1 in ((-hw1, -0.02), (0.02, hw1)):
            wd.box(m, sc + s0, sc + s1, -0.02, 0.05, 0.0, dh, OAK, 0.7)
            # panels and studs
            for y0p, y1p in ((0.3, dh * 0.45), (dh * 0.52, dh - 0.25)):
                wd.box(dm, sc + s0 + 0.12, sc + s1 - 0.12, 0.05, 0.08, y0p, y1p, OAK, 0.6)
        wd.box(dm, sc - 0.04, sc + 0.04, 0.05, 0.11, dh * 0.4, dh * 0.5, LEAD, 0.8)
    if steps:
        for e0, e1, y in ((-0.9, 0.0, 0.15), (0.0, depth, 0.3)):
            hw = hw0 + 0.4 if e0 < 0 else hw1 + 0.05
            ring = [w.pt(sc - hw, -e0, 0)[:2], w.pt(sc + hw, -e0, 0)[:2], w.pt(sc + hw, -e1, 0)[:2], w.pt(sc - hw, -e1, 0)[:2]]
            m.prism(ring, 0.0, y, BLUE, 0.9)


ARMS_CELL = {"brabant": (0, 0, 1 / 3, 1), "spain": (1 / 3, 0, 1 / 3, 1), "antwerp": (2 / 3, 0, 1 / 3, 1)}


def arms(m, dm, w, sc, yb, hw, hh, which, crown=False):
    """A coat of arms: a painted shield (sh_arms) in a carved cartouche with scrolls, on the wall."""
    x0, y0c, cw, chh = ARMS_CELL[which]
    # the shield: a flat top, the sides down to a round point
    curve = [(math.cos(a), 0.1 - 1.1 * math.sin(a)) for a in (math.pi / 2 * k / 6 for k in range(1, 6))]
    shape = [(-1.0, 1.0), (1.0, 1.0), (1.0, 0.1)] + curve + [(0.0, -1.0)] + [(-x, y) for x, y in reversed(curve)] + [(-1.0, 0.1)]
    pts = [(sc + x * hw, yb + hh + y * hh) for x, y in shape]
    # the cartouche behind: a larger slab, scrolls at its sides and foot
    cart = [(sc + x * (hw + 0.35), yb + hh + y * (hh + 0.3) - 0.05) for x, y in shape]
    m.extrude(cart, (w.p[0], w.p[1], 0.0), w.X, w.Y, w.Z, 0.0, 0.2, CARVED, 1.0)
    # two scrolls at the cartouche's shoulders: rolls lying along the wall, their ends curled
    ring = [(0.17 * math.cos(2 * math.pi * k / 8), 0.17 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
    for sg in (-1, 1):
        c = w.pt(sc + sg * (hw + 0.2), 0.2, yb + 2 * hh + 0.1)
        m.extrude(ring, c, w.out(), (0, 0, 1), w.along(sg), -0.25, 0.25, CARVED, 1.05, back=True)
    # the painted face, a little proud
    uvs = [(x0 + cw * (0.5 + x * 0.5), y0c + chh * (0.5 + y * 0.5)) for x, y in shape]
    m.face([w.pt(p[0], 0.28, p[1]) for p in pts], ARMS, 1.0, w.out(), uvs)
    # its rim
    for (a, b) in zip(pts, pts[1:] + pts[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        m.face([w.pt(a[0], 0.2, a[1]), w.pt(b[0], 0.2, b[1]), w.pt(b[0], 0.28, b[1]), w.pt(a[0], 0.28, a[1])], CARVED, 0.9,
               add(w.along(dy), (0, 0, -dx)))
    if crown:
        c = w.pt(sc, 0.3, yb + 2 * hh + 0.1)
        m.lathe(c[0], c[1], [(0.35, yb + 2 * hh + 0.05), (0.42, yb + 2 * hh + 0.3), (0.5, yb + 2 * hh + 0.5)], 8, GILT, 1.0, cap_top=False)
        m.lathe(c[0], c[1], [(0.12, yb + 2 * hh + 0.45), (0.2, yb + 2 * hh + 0.65), (0.0, yb + 2 * hh + 0.85)], 6, GILT, 1.0, cap_top=False)


def niche(m, w, sc, yb, hw, h, depth=0.55):
    """A round-headed niche: a half-round recess with a shell head, a sill (the statue's plinth stands on it)."""
    ys = yb + h - hw
    seg = 8
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        # the niche's back: a half cylinder (plan: s = sc + hw cos, e = -depth sin)
        s0, e0 = sc - hw * math.cos(a0), -depth * math.sin(a0)
        s1, e1 = sc - hw * math.cos(a1), -depth * math.sin(a1)
        mid = (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2))
        m.face([w.pt(s0, e0, yb), w.pt(s1, e1, yb), w.pt(s1, e1, ys), w.pt(s0, e0, ys)], WHITE, 0.62, add(w.along(mid[0]), w.out(mid[1])))
        # the quarter-dome head, in two rings
        for j in range(3):
            b0, b1 = math.pi / 2 * j / 3, math.pi / 2 * (j + 1) / 3
            p = lambda a, b: w.pt(sc - hw * math.cos(a) * math.cos(b), -depth * math.sin(a) * math.cos(b), ys + hw * math.sin(b))  # noqa: E731
            m.face([p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1)], CARVED, 0.6 + 0.1 * j, add(w.along(mid[0]), add(w.out(mid[1]), (0, 0, j * 0.5))))
    # the sill, the archivolt round the head, the imposts
    w.box(m, sc - hw - 0.12, sc + hw + 0.12, -depth, 0.16, yb - 0.14, yb, CARVED, 1.05, bottom=True)
    pts = [(sc + hw * math.cos(math.pi * k / 10), ys + hw * math.sin(math.pi * k / 10)) for k in range(11)]
    w.frame_sweep(m, [(sc + hw, ys - 0.001)] + pts[1:] + [(sc - hw, ys - 0.001)], [(0.0, 0.0), (0.0, 0.08), (0.14, 0.08), (0.16, 0.0)], CARVED, 1.02,
                  closed=False, caps=True)
    for sg in (-1, 1):
        w.box(m, sc + sg * hw - 0.1, sc + sg * hw + 0.1, 0, 0.1, ys - 0.15, ys, CARVED, 1.05)


def stages(m, dm, w):
    """Over the roof: stage 1 with Justice and Prudence and a tall window between; stage 2 with the Virgin
    in her niche between volutes; stage 3 the bell's aedicule, the pediment, the gilt eagle. Obelisks on the
    steps."""
    # ---- stage 1: 26.0 to 32.6, full width
    y0, y1, hw, dep = CO, 32.6, FW, 3.2
    ring = [(-hw, FV - dep), (hw, FV - dep), (hw, FV), (-hw, FV)]
    m.prism(ring, y0, y1 - 0.9, WHITE, 1.0, top=False, skip=(2,))
    holed_face(m, w, -hw, hw, y0, y1 - 0.9, [], WHITE, 1.0)
    # the arms: Brabant, Philip II (crowned), the Margraviate; under the Virgin
    arms(m, dm, w, -3.925, 27.5, 0.9, 1.15, "brabant")
    arms(m, dm, w, 0.0, 27.2, 1.15, 1.45, "spain", crown=True)
    arms(m, dm, w, 3.925, 27.5, 0.9, 1.15, "antwerp")
    for x in (-6.1, -5.5, -2.35, -1.75, 1.75, 2.35, 5.5, 6.1):
        column(m, dm, x, FV + 0.06, y0, y1 - 0.9, 0.17, "corinthian", 10, 1.0, pedestal=0.8)
    ent = [(0, y1 - 0.9), (0.3, y1 - 0.9), (0.3, y1 - 0.6), (0.26, y1 - 0.58), (0.26, y1 - 0.4)] + [(0.26 + p[0], p[1]) for p in cornice_prof(y1 - 0.4, 0.4, 0.4)[1:-1]] + [(0, y1)]
    m.sweep([(hw, FV - dep), (hw, FV), (-hw, FV), (-hw, FV - dep)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), ent, CARVED, 1.04)
    m.face([(-hw, FV - dep, y1), (hw, FV - dep, y1), (hw, FV, y1), (-hw, FV, y1)], LEAD, 0.9, (0, 0, 1))
    m.face([(-hw, FV - dep, y1 - 0.9), (hw, FV - dep, y1 - 0.9), (hw, FV - dep, y1), (-hw, FV - dep, y1)], WHITE, 0.9, (0, -1, 0))
    for x in (-FW - 1.0, FW + 1.0):  # tall obelisks on the cornice beside stage 1
        obelisk(m, x, FV - 0.6, CO, 7.0, 0.95)
    # ---- stage 2: 32.6 to 37.8, the Virgin
    y0, y1, hw2, dep2 = 32.6, 37.8, 3.6, 2.6
    m.prism([(-hw2, FV - dep2), (hw2, FV - dep2), (hw2, FV - 0.2), (-hw2, FV - 0.2)], y0, y1 - 0.8, WHITE, 1.0, top=False, skip=(2,))
    w2 = w.at(-0.2)
    # the face with the niche (the niche is cut into it: the face in pieces round the niche's mouth)
    nh, nb, nt = 0.95, 33.0, 36.6
    holed_face(m, w2, -hw2, hw2, y0, y1 - 0.8, [(0.0, nh, nb, nt - nh, True)], WHITE, 1.0)
    niche(m, w2, 0.0, nb, nh, nt - nb, depth=0.7)
    c = w2.pt(0.0, -0.3, 0)
    figure(m, c[0], c[1], (0, 1), nb, 3.0, "virgin")
    for x in (-3.3, -2.7, 2.7, 3.3):
        column(m, dm, x, FV - 0.2 + 0.06, y0, y1 - 0.8, 0.15, "ionic", 10, 1.0, pedestal=0.7)
    ent2 = [(0, y1 - 0.8), (0.28, y1 - 0.8), (0.28, y1 - 0.4)] + [(0.28 + p[0], p[1]) for p in cornice_prof(y1 - 0.4, 0.4, 0.36)[1:-1]] + [(0, y1)]
    m.sweep([(hw2, FV - dep2), (hw2, FV - 0.2), (-hw2, FV - 0.2), (-hw2, FV - dep2)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), ent2, CARVED, 1.04)
    m.face([(-hw2, FV - dep2, y1), (hw2, FV - dep2, y1), (hw2, FV - 0.2, y1), (-hw2, FV - 0.2, y1)], LEAD, 0.9, (0, 0, 1))
    m.face([(-hw2, FV - dep2, y1 - 0.8), (hw2, FV - dep2, y1 - 0.8), (hw2, FV - dep2, y1), (-hw2, FV - dep2, y1)], WHITE, 0.9, (0, -1, 0))
    # the volutes down to stage 1 (sea creatures in the stone: a scroll with a curl at its foot)
    for sg in (-1, 1):
        # a solid scroll: its top a concave curve from the stage's side down to a curl, filled to stage 1's top
        out = []
        for k in range(9):
            t = k / 8
            out.append((hw2 + (FW - 1.3 - hw2) * t, y0 + 3.4 * (1 - t) ** 1.7 + 0.55))
        shape = [(hw2, y0)] + out + [(FW - 1.3, y0)]
        shape = [(sg * x, y) for x, y in shape]
        m.extrude(shape, (0, FV - 0.45, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), -0.28, 0.28, CARVED, 1.02, back=True)
        ring = [(0.5 * math.cos(2 * math.pi * k / 10), 0.5 * math.sin(2 * math.pi * k / 10)) for k in range(10)]
        cc = (sg * (FW - 1.3), FV - 0.45, y0 + 0.55)
        m.extrude(ring, cc, (1, 0, 0), (0, 0, 1), (0, 1, 0), -0.32, 0.32, CARVED, 1.05, back=True)
        ring2 = [(0.22 * math.cos(2 * math.pi * k / 8), 0.22 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
        m.extrude(ring2, cc, (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.3, 0.4, CARVED, 0.9)
        obelisk(m, sg * 5.75, FV - 0.6, 32.6, 4.2, 0.65)
    # ---- stage 3: the bell's aedicule, pediment, eagle
    y0, y1, hw3, dep3 = 37.8, 41.2, 2.1, 2.0
    w3 = w.at(-0.45)
    m.prism([(-hw3, FV - 0.45 - dep3), (hw3, FV - 0.45 - dep3), (hw3, FV - 0.45), (-hw3, FV - 0.45)], y0, y1 - 0.6, WHITE, 1.0, top=False, skip=(2,))
    bh = 0.8
    holed_face(m, w3, -hw3, hw3, y0, y1 - 0.6, [(0.0, bh, y0 + 0.4, y0 + 2.0, True)], WHITE, 1.0)
    reveal(m, w3, 0.0, bh, y0 + 0.4, y0 + 2.0, -1.2, 0.0, WHITE, 0.5, rnd=True)
    w3.quad(m, -bh, bh, y0 + 0.4, y0 + 2.0 + bh, -1.2, WHITE, 0.3)
    c = w3.pt(0.0, -0.6, 0)
    m.lathe(c[0], c[1], [(0.0, y0 + 1.1), (0.42, y0 + 1.15), (0.36, y0 + 1.35), (0.26, y0 + 1.8), (0.2, y0 + 2.05), (0.0, y0 + 2.1)], 10, LEAD, 0.9)
    for sg in (-1, 1):
        column(m, dm, sg * 1.75, FV - 0.45 + 0.05, y0, y1 - 0.6, 0.14, "doric", 8, 1.0, pedestal=0.5)
        obelisk(m, sg * 3.05, FV - 0.5, y0, 2.8, 0.5)
        out = [(hw3 + 0.9 * k / 6, y0 + 2.2 * (1 - k / 6) ** 1.5 + 0.2) for k in range(7)]
        shape = out + [(x, y - 0.35) for x, y in reversed(out)]
        shape = [(sg * x, y) for x, y in shape]
        if sg < 0:
            shape.reverse()
        m.extrude(shape, (0, FV - 0.8, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), -0.2, 0.2, CARVED, 1.0, back=True)
    ent3 = [(0, y1 - 0.6), (0.24, y1 - 0.6), (0.24, y1 - 0.3)] + [(0.24 + p[0], p[1]) for p in cornice_prof(y1 - 0.3, 0.3, 0.3)[1:-1]] + [(0, y1)]
    m.sweep([(hw3, FV - 0.45 - dep3), (hw3, FV - 0.45), (-hw3, FV - 0.45), (-hw3, FV - 0.45 - dep3)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), ent3, CARVED, 1.04)
    m.face([(-hw3, FV - 0.45 - dep3, y1 - 0.6), (hw3, FV - 0.45 - dep3, y1 - 0.6), (hw3, FV - 0.45 - dep3, y1), (-hw3, FV - 0.45 - dep3, y1)], WHITE, 0.9, (0, -1, 0))
    # the pediment: a gable over the aedicule, slated behind
    ap = y1 + 1.5
    vb3, vf3 = FV - 0.45 - dep3, FV - 0.45 + 0.3
    for vv, sgn in ((vf3, 1), (vb3, -1)):
        m.face([(-hw3 - 0.3, vv, y1), (hw3 + 0.3, vv, y1), (0, vv, ap)], CARVED, 1.0, (0, sgn, 0))
    for sg in (-1, 1):
        m.face([(sg * (hw3 + 0.3), vb3, y1), (sg * (hw3 + 0.3), vf3, y1), (0, vf3, ap), (0, vb3, ap)], SLATE, 1.0, (sg, 0, 1.4))
        # the raking cornice at the front
        m.face([(sg * (hw3 + 0.4), vf3 + 0.2, y1 - 0.05), (0, vf3 + 0.2, ap + 0.12), (0, vf3 + 0.2, ap + 0.3), (sg * (hw3 + 0.45), vf3 + 0.2, y1 + 0.12)],
               CARVED, 1.05, (0, 1, 0))
        m.face([(sg * (hw3 + 0.45), vf3, y1 + 0.12), (0, vf3, ap + 0.3), (0, vf3 + 0.2, ap + 0.3), (sg * (hw3 + 0.45), vf3 + 0.2, y1 + 0.12)],
               CARVED, 1.1, (sg, 0, 1.4))
    eagle(m, 0.0, FV - 0.2, ap + 0.2, (0, 1))
    # the flags: two tricolours on iron poles from the balcony
    for sg in (-1, 1):
        flag(m, sg * 4.6, FV + 0.9, 8.0, sg)


def flag(m, cu, cv, y0, sg):
    """A flagstaff leaning out from the balcony, a Belgian tricolour hanging from it."""
    L = 4.2
    a = math.radians(40)
    d = (sg * 0.25, math.sin(a), math.cos(a))
    d = norm(d)
    tip = (cu + d[0] * L, cv + d[1] * L, y0 + d[2] * L)
    ring = [(0.04 * math.cos(2 * math.pi * k / 5), 0.04 * math.sin(2 * math.pi * k / 5)) for k in range(5)]
    x = norm(cross(d, (1, 0, 0)))
    m.extrude(ring, (cu, cv, y0), x, cross(x, d), d, 0.0, L, LEAD, 0.8, back=True)
    m.lathe(tip[0], tip[1], [(0.0, tip[2]), (0.09, tip[2] + 0.06), (0.0, tip[2] + 0.16)], 6, GILT, 1.0, cap_top=False)
    # the cloth: three vertical bands (black, yellow, red: the hoist black), hanging from the upper part of the staff
    cols = [(0.05, 0.05, 0.05), (0.95, 0.75, 0.1), (0.8, 0.1, 0.08)]
    hang = 1.9
    for k in range(3):
        t0, t1 = 0.52 + 0.15 * k, 0.52 + 0.15 * (k + 1)
        p0 = (cu + d[0] * L * t0, cv + d[1] * L * t0, y0 + d[2] * L * t0)
        p1 = (cu + d[0] * L * t1, cv + d[1] * L * t1, y0 + d[2] * L * t1)
        sway = 0.12 * (k - 1)
        f = m.face([(p0[0], p0[1], p0[2] - hang), (p1[0] + sway, p1[1], p1[2] - hang), p1, p0], CLOTH, 1.0, (1, 0, 0))
        if f:
            m.tint(f, cols[k])


def stair_block(m, dm):
    """The stair block at the back (the hall's landing is in it): ashlar over a rusticated base, two tall
    windows each storey either side, its own cornice and a lean-to roof under the main cornice."""
    top = 22.4
    bw_ = Wall((0, SBK), (-1, 0), (0, -1))
    ew = Wall((SB, 0), (0, 1), (1, 0))
    ww = Wall((-SB, 0), (0, -1), (-1, 0))
    wins = [(sc, 0.7, 8.6, 12.4, True) for sc in (-4.0, 4.0)]
    wins2 = [(sc, 0.7, 14.8, 18.4, False) for sc in (-4.0, 4.0)]
    holed_face(m, bw_, -SB, SB, 0.0, 6.1, [], BLUE, 0.92)
    holed_face(m, bw_, -SB, SB, 6.1, S1 - 0.4, wins, WHITE, 1.0)
    holed_face(m, bw_, -SB, SB, S1 - 0.4, top, wins2, WHITE, 1.0)
    for k in range(11):  # the ground floor rusticated as the wings'
        y = PL + k * 0.5
        prof = [(0, y + 0.015), (0.08, y + 0.015), (0.12, y + 0.055), (0.12, y + 0.445), (0.08, y + 0.485), (0, y + 0.485)]
        off = (k % 2) * 0.62
        xs = [-SB] + [x for x in (-SB + off + j * 1.25 for j in range(15)) if -SB + 0.2 < x < SB - 0.2] + [SB]
        for xa, xb in zip(xs, xs[1:]):
            bw_.hsweep(m, xa + 0.012, xb - 0.012, prof, BLUE, 1.0 - 0.05 * (k % 2))
    for sc, hw, yb, yt, rnd in wins + wins2:
        u = bw_.pt(sc, 0, 0)[0]
        cross_window(m, dm, bw_, sc, hw, yb, yt, depth=0.12, arch=rnd,
                     label=f"the stair block at the back, the {'left' if u < 0 else 'right'} window, {'the first floor (the landing)' if rnd else 'the second floor'}")
    for w, a, b in ((ew, SBK, VB), (ww, -VB, -SBK)):
        w.quad(m, a, b, 0.0, 6.1, 0, BLUE, 0.9)
        w.quad(m, a, b, 6.1, top, 0, WHITE, 0.95)
    ring = [(-SB, VB), (-SB, SBK), (SB, SBK), (SB, VB)]
    m.sweep(ring, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), [(0, 0.0), (0.2, 0.0), (0.2, PL - 0.06), (0.15, PL), (0, PL)], BLUE, 0.95)
    for yy in (6.1, G, S1 - 0.4):
        m.sweep(ring, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), band_prof(yy, 0.3, 0.14), CARVED if yy > 6.5 else BLUE, 1.0)
    m.sweep(ring, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), cornice_prof(top - 0.5, 0.5, 0.45), CARVED, 1.02)
    # the lean-to roof (slate) against the back wall, under the main cornice's shadow
    yhi = LC + 0.4
    m.face([(-SB - 0.4, SBK - 0.45, top), (SB + 0.4, SBK - 0.45, top), (SB + 0.4, VB, yhi), (-SB - 0.4, VB, yhi)], SLATE, 0.95, (0, -1, 1.3))
    for sg in (-1, 1):
        m.face([(sg * SB, SBK, top), (sg * SB, VB, top), (sg * SB, VB, yhi)], WHITE, 0.9, (sg, 0, 0))


def roof(m, dm):
    """The great hipped roof: slate, lead ridge and hips, gutters, two rows of dormers, tall chimneys."""
    o = 0.3
    u0, u1, v0, v1 = -U - o, U + o, VB - o, VF + o
    y = CO
    h = (v1 - v0) / 2
    top = y + RISE
    vm = (v0 + v1) / 2
    r0, r1 = (u0 + h, vm), (u1 - h, vm)
    c = [(u0, v0, y), (u1, v0, y), (u1, v1, y), (u0, v1, y)]
    t0, t1 = (r0[0], r0[1], top), (r1[0], r1[1], top)
    m.face([c[0], c[1], t1, t0], SLATE, 0.95, (0, -1, 1))
    m.face([c[2], c[3], t0, t1], SLATE, 1.0, (0, 1, 1))
    m.face([c[1], c[2], t1], SLATE, 0.97, (1, 0, 1))
    m.face([c[3], c[0], t0], SLATE, 0.97, (-1, 0, 1))
    # the lead: ridge and hips (rolls), the gutter (a box on the cornice's top), downpipes at the back corners
    def roll(a, b, r=0.09):
        d = norm(sub(b, a))
        x = norm(cross(d, (0, 0, 1))) if abs(d[2]) < 0.95 else (1, 0, 0)
        yv = cross(x, d)
        ring = [(r * math.cos(math.pi * k / 4), r * math.sin(math.pi * k / 4)) for k in range(5)]
        ln = math.sqrt(dot(sub(b, a), sub(b, a)))
        m.extrude(ring, a, x, yv, d, 0.0, ln, LEAD, 0.9)
    roll(t0, t1, 0.12)
    for cc, tt in ((c[0], t0), (c[3], t0), (c[1], t1), (c[2], t1)):
        roll(cc, tt)
    # (it stands on the cornice's top: no bottom face of its own there, and 2 cm up, so the two never fight)
    gut = [(0.18, CO + 0.02), (0.22, CO + 0.28), (0.08, CO + 0.28), (0.06, CO + 0.12), (0, CO + 0.12), (0, CO + 0.02)]
    m.sweep([(-U - 0.3, VB - 0.3), (U + 0.3, VB - 0.3), (U + 0.3, VF + 0.3), (-U - 0.3, VF + 0.3)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1),
            [(0.4 + a, b) for a, b in gut], LEAD, 0.85, closed=True)
    for pu, pv in ((U + 0.25, VB + 0.6), (-U - 0.25, VB + 0.6), (SB + 1.0, VB - 0.25), (-SB - 1.0, VB - 0.25), (U + 0.25, VF - 0.6), (-U - 0.25, VF - 0.6)):
        m.lathe(pu, pv, [(0.08, 0.3), (0.08, CO - 0.2), (0.14, CO - 0.1), (0.14, CO + 0.1)], 6, LEAD, 0.8)
        m.lathe(pu, pv, [(0.11, 0.1), (0.11, 0.3), (0.08, 0.32)], 6, LEAD, 0.75)
    # ---- dormers
    slope = RISE / h

    def ry(dist):  # the roof's height `dist` in from the eave
        return y + dist * slope

    def dormer(wall, s, yb, wd, hf, big):
        """A dormer on a slope whose eave is wall's line at e = 0 (e out), rising inward."""
        ef = -(yb - y) / slope  # where the roof is yb high
        ytop = yb + hf
        eb = -(ytop + 0.9 - y) / slope  # its back, where its ridge meets the roof
        cheek = 0.12
        ww = wd / 2
        # the front: stone aedicule (big) or a slate-hung face (small), a cross window in it
        if big:
            wall.box(m, s - ww - 0.18, s + ww + 0.18, ef - 0.2, ef + 0.08, yb - 0.3, ytop, CARVED, 1.0, back=True)
            fw = wall.at(ef + 0.08)
            glass(m, fw, s - ww + 0.12, s + ww - 0.12, yb, ytop - 0.35, 0.01, shade=0.85)
            fw.box(m, s - 0.05, s + 0.05, 0.0, 0.05, yb, ytop - 0.35, CARVED, 1.0, top=False)
            fw.box(m, s - ww + 0.12, s + ww - 0.12, 0.0, 0.05, yb + (ytop - yb) * 0.6, yb + (ytop - yb) * 0.6 + 0.08, CARVED, 1.0)
            for sg in (-1, 1):
                fw.box(m, s + sg * (ww + 0.05) - 0.12, s + sg * (ww + 0.05) + 0.12, 0.0, 0.1, yb - 0.3, ytop, CARVED, 1.05)
                # scrolls beside the aedicule (issue #10: at the dormer's foot; they stood on the ground inside the
                # building, seen now through the real windows)
                c = wall.pt(s + sg * (ww + 0.4), ef + 0.0, yb + 0.1)
                m.extrude([(0, 0), (sg * 0.35, 0), (sg * 0.05, 0.9)], (c[0], c[1], c[2]), wall.along(), (0, 0, 1), wall.out(), -0.1, 0.1, CARVED, 1.0, back=True)
            pediment(m, wall.at(ef - 0.2), s, ww + 0.3, ytop, 0.55, proj=0.36, seg=False)
            yr = ytop + 0.6
        else:
            wall.box(m, s - ww - 0.08, s + ww + 0.08, ef - 0.1, ef + 0.02, yb - 0.1, ytop, SLATE, 0.9, back=True)
            glass(m, wall.at(ef + 0.03), s - ww + 0.08, s + ww - 0.08, yb, ytop - 0.1, 0.0, shade=0.85)
            yr = ytop + 0.45
        # cheeks (slate) and the little gable roof back into the slope
        for sg in (-1, 1):
            sx = s + sg * (ww + 0.18 if big else ww + 0.08)
            m.face([wall.pt(sx, ef - 0.1, yb - 0.3), wall.pt(sx, ef - 0.1, ytop), wall.pt(sx, eb, ytop)], SLATE, 0.8, wall.along(sg))
            m.face([wall.pt(sx + sg * 0.15, ef + 0.1, ytop), wall.pt(s, ef + 0.1, yr), wall.pt(s, eb - 0.4, yr), wall.pt(sx + sg * 0.15, eb - 0.4, ytop)],
                   SLATE, 1.0, add(wall.along(sg), (0, 0, 1.2)))
        m.face([wall.pt(s - ww - 0.33, ef + 0.1, ytop), wall.pt(s + ww + 0.33, ef + 0.1, ytop), wall.pt(s, ef + 0.1, yr)], CARVED if big else SLATE, 0.9, wall.out())

    fw_ = Wall((0, VF + o), (1, 0), (0, 1))
    bw_ = Wall((0, VB - o), (-1, 0), (0, -1))
    ew = Wall((U + o, 0), (0, 1), (1, 0))
    ww = Wall((-U - o, 0), (0, -1), (-1, 0))
    for wall, exclude in ((fw_, FW + 2.0), (bw_, 0.0)):
        for k in range(NB):
            sc = -U + (k + 0.5) * BW
            if abs(sc) < exclude + 1.2 or abs(sc) > 30.5:
                continue
            dormer(wall, sc, CO + 1.5, 1.2, 1.9, True)
        for sc in (-24.6, -18.5, -12.3, 12.3, 18.5, 24.6):
            if abs(sc) < exclude + 1.0:
                continue
            dormer(wall, sc, CO + 5.6, 0.7, 1.0, False)
    for wall in (ew, ww):
        for sc in (-4.0, 0.0, 4.0):
            dormer(wall, sc, CO + 1.5, 1.2, 1.9, True)
        dormer(wall, 0.0, CO + 5.6, 0.7, 1.0, False)
    # ---- chimneys: tall stone stacks with moulded caps and pots
    for cu, cv in ((-26.0, vm + 3.0), (-15.0, vm - 3.0), (15.0, vm - 3.0), (26.0, vm + 3.0), (-20.5, vm - 3.5), (20.5, vm + 3.5)):
        dist = min(v1 - cv, cv - v0, u1 - cu, cu - u0)
        ys = ry(dist)
        m.box(cu - 0.6, cu + 0.6, cv - 0.85, cv + 0.85, ys - 0.8, ys + 3.8, WHITE, 0.95)
        m.box(cu - 0.7, cu + 0.7, cv - 0.95, cv + 0.95, ys + 2.2, ys + 2.35, CARVED, 1.0, bottom=True)
        m.sweep([(cu - 0.6, cv - 0.85), (cu + 0.6, cv - 0.85), (cu + 0.6, cv + 0.85), (cu - 0.6, cv + 0.85)], (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1),
                cornice_prof(ys + 3.8, 0.4, 0.18), CARVED, 1.02, closed=True)
        m.face([(cu - 0.6, cv - 0.85, ys + 4.2), (cu + 0.6, cv - 0.85, ys + 4.2), (cu + 0.6, cv + 0.85, ys + 4.2), (cu - 0.6, cv + 0.85, ys + 4.2)], LEAD, 0.6, (0, 0, 1))
        for dv in (-0.45, 0.0, 0.45):
            m.lathe(cu, cv + dv, [(0.14, ys + 4.2), (0.12, ys + 4.6), (0.15, ys + 4.7)], 6, BLUE, 0.9, cap_top=False)


# ---------------------------------------------------------------- materials, export, preview


def materials():
    for i, n in enumerate(MATS):
        mt = bpy.data.materials.new(n)
        rgb = PREVIEW_RGB[i]
        mt.diffuse_color = (*rgb, 1)
        bsdf = mt.node_tree.nodes.get("Principled BSDF") if mt.node_tree else None
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*rgb, 1)
            bsdf.inputs["Roughness"].default_value = 0.9


def preview(folder):
    """Render views with Workbench (the build's own look before the game): the front, close-ups, a side."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1400, 900
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    city = json.load(open(CITY))
    f = city["landmarks"]["stadhuis"]["frame"]
    fr = Frame(f)
    views = {
        "front": ((0, 80, 10), (0, 0, 20), 62),
        "front2": ((0, 45, 8), (0, FV, 24), 58),
        "fronti": ((0, 30, 20), (0, FV, 28), 50),
        "arcade": ((-15, 20, 3), (-15, VF, 4), 55),
        "corner": ((45, 45, 10), (20, 0, 16), 50),
        "back": ((-20, -45, 12), (0, 0, 16), 55),
        "top": ((-8, 26, 34), (0, FV - 1, 34), 50),
        "portal": ((3, FV + 7, 1.7), (0, FV, 3.0), 60),
        "side": ((-U - 10, 5, 2), (-U, 0, 8), 70),
    }
    for name, (eye, at, fov) in views.items():
        e = fr.w(eye)
        a = fr.w(at)
        cam.location = B(*e)
        d = B(*a) - B(*e)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.angle = math.radians(fov)
        sc.render.filepath = os.path.join(folder, f"blend_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    city = json.load(open(CITY))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials()
    fr = Frame(city["landmarks"]["stadhuis"]["frame"])
    if city["landmarks"]["stadhuis"]["frame"].get("open", 1) < 0:
        raise SystemExit("the town hall's frame looks away from the Grote Markt: fix the frame")
    FR[0] = fr
    LIT[0] = Mesh(fr, "stadhuis_lit_glass")
    body, det = build(fr)
    body.finish()
    det.finish()
    LIT[0].finish()
    n_open = opening_markers()
    print(f"[build_stadhuis] {n_open} real openings -> {SHELL_TS}")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_vertex_color="ACTIVE", export_all_vertex_colors=True, export_extras=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print(f"[build_stadhuis] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if PREVIEW:
        preview(PREVIEW)


if __name__ == "__main__":
    main()

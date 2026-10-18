"""The building kit of the work goods: the texture atlas and its cells, a mesh builder with per-corner atlas UVs,
the primitives (chamfered boxes, lathes, sweeps, prisms, gears, free grids), smooth/sharp edges by angle, and the
baked occlusion in vertex colour.

Blender axes while building: Z up, a model's front toward -Y. The glTF export turns this into the game's axes
(+Y up, front toward +Z). G() converts a point written in game axes into Blender axes.
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SIZE = 2048  # the atlas, square
PAD = 8  # pixels of edge colour round every cell (the mips)


def G(x, y, z):
    """A point in game axes (Y up, front +Z) as Blender axes (Z up, front -Y)."""
    return (x, -z, y)


ROT_Z_TO_X = Matrix.Rotation(math.radians(90), 4, "Y")  # a lathe's local Z axis along +X
ROT_Z_TO_Y = Matrix.Rotation(math.radians(-90), 4, "X")  # local Z along +Y


def T(x, y, z):
    return Matrix.Translation((x, y, z))


# ------------------------------------------------------------------ atlas


class Cell:
    """A painted rectangle of the atlas: its top left (x, y) in pixels, its size, its pixels per metre."""

    def __init__(self, x, y, w, h, ppm, name=""):
        self.x, self.y, self.w, self.h, self.ppm, self.name = x, y, w, h, ppm, name

    @property
    def wm(self):
        return self.w / self.ppm

    @property
    def hm(self):
        return self.h / self.ppm

    def px(self, s, t):
        return (self.x + s * self.ppm, self.y + t * self.ppm)


class Atlas:
    """Regions per model; cells packed in shelves inside their model's region, painted at once."""

    def __init__(self, size=SIZE):
        self.size = size
        self.img = np.full((size, size, 3), 0.45, np.float32)
        self.regions = {}
        self.cells = []

    def region(self, name, x, y, w, h):
        self.regions[name] = {"x": x, "y": y, "w": w, "h": h, "cx": x, "cy": y, "shelf": 0}

    def cell(self, region, w_m, h_m, ppm, painter, name=""):
        w = int(math.ceil(w_m * ppm))
        h = int(math.ceil(h_m * ppm))
        R = self.regions[region]
        W, H = w + 2 * PAD, h + 2 * PAD
        if R["cx"] + W > R["x"] + R["w"]:
            R["cx"] = R["x"]
            R["cy"] += R["shelf"]
            R["shelf"] = 0
        if R["cx"] + W > R["x"] + R["w"] or R["cy"] + H > R["y"] + R["h"]:
            raise RuntimeError("atlas region %s full: cell %s %dx%d px" % (region, name, w, h))
        x0, y0 = R["cx"], R["cy"]
        arr = np.asarray(painter(w, h, ppm), np.float32)[..., :3]
        assert arr.shape == (h, w, 3), (name, arr.shape, (h, w))
        self.img[y0:y0 + H, x0:x0 + W] = np.pad(np.clip(arr, 0, 1), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
        R["cx"] += W
        R["shelf"] = max(R["shelf"], H)
        c = Cell(x0 + PAD, y0 + PAD, w, h, ppm, name)
        self.cells.append((region, c))
        return c

    def to_image(self, name, path):
        img = bpy.data.images.new(name, self.size, self.size, alpha=False)
        rgba = np.ones((self.size, self.size, 4), np.float32)
        rgba[..., :3] = self.img[::-1]  # Blender's rows run bottom up
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.pack()
        return img


# ------------------------------------------------------------------ skins: how a face finds its pixels


OVER = {}


def _chk(cell, uvs):
    """Count corners that fall outside their cell (more than 2 px): a too small cell shows its neighbour."""
    for u, v in uvs:
        if u < cell.x - 2 or u > cell.x + cell.w + 2 or v < cell.y - 2 or v > cell.y + cell.h + 2:
            OVER[cell.name] = OVER.get(cell.name, 0) + 1


class Param:
    """UV from the primitive's own surface coordinates (s, t in metres): s along u, t along v of the cell.
    wrap: s repeats every `wrap` metres (per face, so a face never straddles the seam); mirror: s folds back at
    mirror (a closed loop painted as one half, mirrored)."""

    def __init__(self, cell, off=(0.0, 0.0), wrap=None, mirror=None, wrap_t=None, k=(1.0, 1.0), swap=False):
        self.cell, self.off, self.wrap, self.mirror, self.wrap_t, self.k, self.swap = cell, off, wrap, mirror, wrap_t, k, swap

    def uv(self, pts, st, n):
        s = [a[1] if self.swap else a[0] for a in st]
        t = [a[0] if self.swap else a[1] for a in st]
        s = [v * self.k[0] for v in s]
        t = [v * self.k[1] for v in t]
        if self.mirror is not None:
            M = self.mirror
            s = [(v % (2 * M)) for v in s]
            s = [v if v <= M else 2 * M - v for v in s]
        if self.wrap is not None:
            k0 = math.floor(min(s) / self.wrap)
            s = [v - k0 * self.wrap for v in s]
        if self.wrap_t is not None:
            k0 = math.floor(min(t) / self.wrap_t)
            t = [v - k0 * self.wrap_t for v in t]
        out = [self.cell.px(self.off[0] + a, self.off[1] + b) for a, b in zip(s, t)]
        _chk(self.cell, out)
        return out


class Planar:
    """UV by projection along one fixed local axis (0, 1, 2) whatever the face's normal: u, v are the other two
    axes in order, measured from lo; flip_v turns the picture upside down."""

    def __init__(self, cell, axis, lo, off=(0.0, 0.0), flip_v=False, hi=None):
        self.cell, self.axis, self.lo, self.off, self.flip_v, self.hi = cell, axis, np.asarray(lo, float), off, flip_v, hi

    def uv(self, pts, st, n):
        u, v = [i for i in (0, 1, 2) if i != self.axis]
        out = []
        for p in pts:
            s = p[u] - self.lo[u]
            t = (self.hi[v] - p[v]) if self.flip_v else (p[v] - self.lo[v])
            out.append(self.cell.px(self.off[0] + s, self.off[1] + t))
        _chk(self.cell, out)
        return out


class Box:
    """UV by projection of the local position along the face's main axis. grain: the axis that runs along u when it
    lies in the face (wood grain); ends: a cell for the faces across the grain. lo, hi: the projected box (the
    primitive fills these in when None). rng: a random offset inside the cell, so parts sharing a cell differ."""

    def __init__(self, cell, grain=None, ends=None, lo=None, hi=None, rng=None, cells=None, off=(0.0, 0.0)):
        self.cell, self.grain, self.ends, self.lo, self.hi, self.rng, self.cells, self.off = cell, grain, ends, lo, hi, rng, cells, off
        self._off = {}

    def bind(self, lo, hi):
        b = Box(self.cell, self.grain, self.ends, self.lo if self.lo is not None else np.array(lo, float),
                self.hi if self.hi is not None else np.array(hi, float), self.rng, self.cells, self.off)
        b.rng = self.rng
        return b

    def axes(self, n):
        a = int(np.argmax(np.abs(n)))
        o = [i for i in (0, 1, 2) if i != a]
        if self.grain is not None and self.grain in o:
            u = self.grain
            v = o[0] if o[1] == u else o[1]
        elif a == 2:
            u, v = 0, 1
        else:
            u, v = o[0], 2 if 2 in o else o[1]
        return a, u, v

    def uv(self, pts, st, n):
        a, u, v = self.axes(n)
        cell = self.cell
        if self.cells is not None and a in self.cells:
            cell = self.cells[a]
        elif self.ends is not None and self.grain is not None and a == self.grain:
            cell = self.ends
        lo, hi = self.lo, self.hi
        key = (id(cell), u, v)
        if key not in self._off:
            eu, ev = hi[u] - lo[u], hi[v] - lo[v]
            ou, ov = self.off
            if self.rng is not None:
                ou += self.rng.uniform(0, max(0.0, cell.wm - eu))
                ov += self.rng.uniform(0, max(0.0, cell.hm - ev))
            self._off[key] = (ou, ov)
        ou, ov = self._off[key]
        out = []
        for p in pts:
            s = p[u] - lo[u]
            t = (hi[v] - p[v]) if v == 2 else (p[v] - lo[v])
            out.append(cell.px(ou + s, ov + t))
        _chk(cell, out)
        return out


class Flat:
    """Every face onto one spot of a cell (a plain colour, e.g. the dark inside)."""

    def __init__(self, cell, s=0.5, t=0.5):
        self.cell, self.s, self.t = cell, s, t

    def uv(self, pts, st, n):
        x, y = self.cell.x + self.cell.w * self.s, self.cell.y + self.cell.h * self.t
        return [(x, y)] * len(pts)


# ------------------------------------------------------------------ the mesh builder


def newell(pts):
    n = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n += np.array(((a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])))
    return n


class Mesh:
    """Vertices and faces in a model's frame; parts are written in their own frames under `at(M)`."""

    def __init__(self, name):
        self.name = name
        self.V = []
        self.F = []
        self.xf = Matrix.Identity(4)
        self.overflow = 0

    def at(self, M):
        m = self

        class Ctx:
            def __enter__(s):
                s.old = m.xf
                m.xf = m.xf @ M

            def __exit__(s, *a):
                m.xf = s.old

        return Ctx()

    def vid(self, p):
        self.V.append(self.xf @ Vector((float(p[0]), float(p[1]), float(p[2]))))
        return len(self.V) - 1

    def face(self, ids, pts, skin, st=None, out=None, shade=1.0, thr=30.0):
        """A face from vertex ids with their local points; uv from the skin; wound so its normal follows `out`."""
        # drop repeated vertices (a pole): a quad becomes a triangle
        keep = []
        for k, i in enumerate(ids):
            if i not in [ids[j] for j in keep]:
                keep.append(k)
        if len(keep) < 3:
            return
        ids = [ids[k] for k in keep]
        pts = [np.asarray(pts[k], float) for k in keep]
        st = [st[k] for k in keep] if st is not None else [(0.0, 0.0)] * len(ids)
        n = newell(pts)
        if np.linalg.norm(n) < 1e-14:
            return
        if out is not None and np.dot(n, out) < 0:
            ids, pts, st = ids[::-1], pts[::-1], st[::-1]
            n = -n
        if self.xf.determinant() < 0:
            ids, pts, st = ids[::-1], pts[::-1], st[::-1]
        uvs = skin.uv(pts, st, n / np.linalg.norm(n))
        self.F.append((ids, uvs, shade, thr))

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.F)

    def build(self, mat=None, check_cells=()):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in self.V]
        uvl = bm.loops.layers.uv.new("UVMap")
        shades, thrs = [], []
        dup = 0
        for ids, uvs, sh, thr in self.F:
            try:
                f = bm.faces.new([vs[i] for i in ids])
            except ValueError:
                dup += 1
                continue
            for lp, (u, v) in zip(f.loops, uvs):
                lp[uvl].uv = (u / SIZE, 1.0 - v / SIZE)
            f.smooth = True
            shades.append(sh)
            thrs.append(thr)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.normal_update()
        bm.faces.ensure_lookup_table()
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) != 2:
                e.smooth = False
                continue
            a, b = lf
            ang = math.degrees(a.normal.angle(b.normal, 0.0))
            e.smooth = ang <= min(thrs[a.index], thrs[b.index])
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        if mat is not None:
            me.materials.append(mat)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob["_shade"] = shades
        if dup:
            print("[workgoods] %s: %d duplicate faces skipped" % (self.name, dup))
        return ob


# ------------------------------------------------------------------ primitives (local frames)


def grid(m, P, ST, skin, closed=False, closed_rows=False, outfn=None, shade=1.0, thr=35.0):
    """A quad grid: P (rows, cols, 3) local points; ST (rows [+1 when closed_rows], cols [+1 when closed], 2) surface
    metres (the extra column/row is the seam's far side). Rows run along the profile or path, columns round it. A
    row whose points coincide becomes one vertex (a pole). outfn(i, j, centroid) gives the outward direction of the
    face between rows i, i+1 and columns j, j+1."""
    P = np.asarray(P, float)
    ST = np.asarray(ST, float)
    nr, nc = P.shape[:2]
    assert ST.shape[0] == nr + (1 if closed_rows else 0) and ST.shape[1] == nc + (1 if closed else 0), (P.shape, ST.shape)
    flat = P.reshape(-1, 3)
    if isinstance(skin, Box) and skin.lo is None:
        skin = skin.bind(flat.min(0), flat.max(0))
    pick = skin if (callable(skin) and not hasattr(skin, "uv")) else (lambda i, j: skin)
    ids = np.zeros((nr, nc), int)
    for i in range(nr):
        if np.ptp(P[i], axis=0).max() < 1e-7:
            v = m.vid(P[i, 0])
            ids[i, :] = v
        else:
            for j in range(nc):
                ids[i, j] = m.vid(P[i, j])
    rows = nr if closed_rows else nr - 1
    cols = nc if closed else nc - 1
    for i in range(rows):
        i1 = (i + 1) % nr
        for j in range(cols):
            j1 = (j + 1) % nc
            q = [ids[i, j], ids[i, j1], ids[i1, j1], ids[i1, j]]
            pts = [P[i, j], P[i, j1], P[i1, j1], P[i1, j]]
            st = [ST[i, j], ST[i, j + 1], ST[i + 1, j + 1], ST[i + 1, j]]
            c = np.mean(pts, axis=0)
            o = outfn(i, j, c) if outfn is not None else None
            sk = pick(i, j)
            if isinstance(sk, Box) and sk.lo is None:
                sk = sk.bind(flat.min(0), flat.max(0))
            m.face(q, pts, sk, st=[tuple(x) for x in st], out=o, shade=shade, thr=thr)
    return ids


def cap(m, ids_row, pts_row, skin, out, shade=1.0, thr=30.0):
    """An ngon over a ring of existing vertices; a Param skin gets plane coordinates (metres) across the cap."""
    pts = [np.asarray(p, float) for p in pts_row]
    o = np.asarray(out, float)
    o = o / np.linalg.norm(o)
    e1 = np.cross(o, (0, 0, 1.0)) if abs(o[2]) < 0.9 else np.cross(o, (0, 1.0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(o, e1)
    a = [float(p @ e1) for p in pts]
    b = [float(p @ e2) for p in pts]
    st = [(x - min(a), y - min(b)) for x, y in zip(a, b)]
    if isinstance(skin, Box) and skin.lo is None:
        P = np.array(pts)
        skin = skin.bind(P.min(0), P.max(0))
    m.face(list(ids_row), pts, skin, st=st, out=o, shade=shade, thr=thr)


def cbox(m, lo, hi, skin, c=0.003, shade=1.0, thr=30.0, skip=(), shades=None, face_skins=None):
    """A box with every edge chamfered by c: 6 faces, 12 chamfer strips, 8 corner triangles (44 triangles).
    skip: faces left out, as (axis, sign) pairs (hidden against another part or the ground)."""
    lo = np.array(lo, float)
    hi = np.array(hi, float)
    c = min(c, 0.3 * float(np.min(hi - lo)))
    a, b = lo + c, hi - c
    if isinstance(skin, Box):
        skin = skin.bind(lo, hi)
    ctr = (lo + hi) / 2
    ids = {}
    pts = {}
    signs = [(sx, sy, sz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    for k in range(3):
        for sg in signs:
            p = [a[i] if sg[i] < 0 else b[i] for i in range(3)]
            p[k] = lo[k] if sg[k] < 0 else hi[k]
            pts[(k, sg)] = p
            ids[(k, sg)] = m.vid(p)

    def emit(keys, sh=shade, sk=None):
        P = [pts[q] for q in keys]
        cc = np.mean(P, axis=0)
        m.face([ids[q] for q in keys], P, sk or skin, out=cc - ctr, shade=sh, thr=thr)

    for k in range(3):
        i, j = [x for x in range(3) if x != k]
        for s in (-1, 1):
            if (k, s) in skip:
                continue
            ring = []
            for si, sj in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                sg = [0, 0, 0]
                sg[k], sg[i], sg[j] = s, si, sj
                ring.append((k, tuple(sg)))
            fs = face_skins.get((k, s)) if face_skins else None
            if isinstance(fs, Box):
                fs = fs.bind(lo, hi)
            emit(ring, shades.get((k, s), shade) if shades else shade, fs)
    if c <= 1e-6:
        return
    for k in range(3):
        i, j = [x for x in range(3) if x != k]
        for si in (-1, 1):
            for sj in (-1, 1):
                if (i, si) in skip and (j, sj) in skip:
                    continue
                q = []
                for sk, ax in ((-1, i), (-1, j), (1, j), (1, i)):
                    sg = [0, 0, 0]
                    sg[k], sg[i], sg[j] = sk, si, sj
                    q.append((ax, tuple(sg)))
                emit(q)
    for sg in signs:
        if sum(1 for k in range(3) if (k, sg[k]) in skip) >= 2:
            continue
        emit([(0, sg), (1, sg), (2, sg)])


def lathe(m, prof, sides, skin, cref=None, a0=0.0, shade=1.0, thr=40.0, caps=(False, False), inward=False, ellipse=(1.0, 1.0),
          radial=None, cap_skin=None):
    """A surface of revolution about local Z: prof [(r, z)], written along the outside going up (its normal
    (dz, -dr) points out). Columns round, rows along the profile. s = the arc round at radius cref, t = the
    profile's length. radial(a, r, z) -> r may reshape a ring (bulges, staves)."""
    prof = [(float(r), float(z)) for r, z in prof]
    n = len(prof)
    cref = cref if cref is not None else max(r for r, _ in prof)
    ang = [a0 + 2 * math.pi * j / sides for j in range(sides)]
    P = np.zeros((n, sides, 3))
    for i, (r, z) in enumerate(prof):
        for j, a in enumerate(ang):
            rr = radial(a, r, z) if radial is not None else r
            P[i, j] = (rr * math.cos(a) * ellipse[0], rr * math.sin(a) * ellipse[1], z)
    tlen = [0.0]
    for i in range(1, n):
        tlen.append(tlen[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    ST = np.zeros((n, sides + 1, 2))
    for i in range(n):
        for j in range(sides + 1):
            ST[i, j] = (cref * 2 * math.pi * j / sides, tlen[i])
    sgn = -1.0 if inward else 1.0

    def outfn(i, j, c):
        dr = prof[i + 1][0] - prof[i][0]
        dz = prof[i + 1][1] - prof[i][1]
        rad = np.array((c[0], c[1], 0.0))
        L = np.linalg.norm(rad)
        rad = rad / L if L > 1e-9 else rad
        return sgn * (dz * rad + np.array((0.0, 0.0, -dr)))

    ids = grid(m, P, ST, skin, closed=True, outfn=outfn, shade=shade, thr=thr)
    for end, k in ((0, 0), (1, n - 1)):
        if caps[end] and prof[k][0] > 1e-6:
            cap(m, ids[k], P[k], cap_skin or skin, out=np.array((0.0, 0.0, -1.0 if end == 0 else 1.0)) * sgn, shade=shade)
    return ids, P


def frames(path, up=None, closed=False):
    """Parallel transport frames along a path: tangents, normals, binormals."""
    path = np.asarray(path, float)
    n = len(path)
    Tn = np.zeros_like(path)
    for i in range(n):
        if closed:
            d = path[(i + 1) % n] - path[i - 1]
        else:
            d = path[min(i + 1, n - 1)] - path[max(i - 1, 0)]
        Tn[i] = d / (np.linalg.norm(d) or 1.0)
    u = np.array(up if up is not None else ((0, 0, 1) if abs(Tn[0][2]) < 0.9 else (1, 0, 0)), float)
    N = np.zeros_like(path)
    for i in range(n):
        u = u - Tn[i] * (u @ Tn[i])
        if np.linalg.norm(u) < 1e-9:
            u = np.cross(Tn[i], (1, 0, 0)) if abs(Tn[i][0]) < 0.9 else np.cross(Tn[i], (0, 1, 0))
        u /= np.linalg.norm(u)
        N[i] = u
    B = np.cross(Tn, N)
    return Tn, N, B


def sweep(m, path, r, sides, skin, ry=None, closed=False, up=None, shade=1.0, thr=50.0, caps=(False, False), a0=0.0,
          bumps=None, cap_skin=None):
    """A tube along a path: rings of `sides`; r (and ry) per point or one number; s along the path, t round it.
    bumps(s, a) -> a radius factor (twisted withies, rope strands)."""
    path = np.asarray(path, float)
    n = len(path)
    rx = np.broadcast_to(np.asarray(r, float), (n,))
    rz = np.broadcast_to(np.asarray(ry if ry is not None else r, float), (n,))
    Tn, N, B = frames(path, up, closed)
    if closed:
        # spread the frame's mismatch at the joint over the loop
        tw = math.atan2(np.dot(np.cross(N[-1], N[0]), Tn[0]), np.dot(N[-1], N[0]))
    else:
        tw = 0.0
    slen = [0.0]
    for i in range(1, n):
        slen.append(slen[-1] + float(np.linalg.norm(path[i] - path[i - 1])))
    total = slen[-1] + (float(np.linalg.norm(path[0] - path[-1])) if closed else 0.0)
    P = np.zeros((n, sides, 3))
    circ = 2 * math.pi * float(np.mean(np.maximum(rx, rz)))
    for i in range(n):
        tw_i = tw * (slen[i] / total if total > 0 else 0) if closed else 0.0
        for j in range(sides):
            a = a0 + 2 * math.pi * j / sides + tw_i
            k = bumps(slen[i], a) if bumps is not None else 1.0
            P[i, j] = path[i] + (math.cos(a) * rx[i] * N[i] + math.sin(a) * rz[i] * B[i]) * k
    nrow = n + 1 if closed else n
    ST = np.zeros((nrow, sides + 1, 2))
    for i in range(nrow):
        si = slen[i] if i < n else total
        for j in range(sides + 1):
            ST[i, j] = (si, circ * j / sides)

    def outfn(i, j, c):
        i1 = (i + 1) % n
        return c - (path[i] + path[i1]) / 2

    ids = grid(m, P, ST, skin, closed=True, closed_rows=closed, outfn=outfn, shade=shade, thr=thr)
    if not closed:
        for end, k in ((0, 0), (1, n - 1)):
            if caps[end]:
                cap(m, ids[k], P[k], cap_skin or skin, out=(-Tn[0] if end == 0 else Tn[-1]), shade=shade)
    return ids, P


def offset_convex(poly, d):
    """A convex ccw polygon moved inward by d (each edge shifted along its normal, corners re-cut)."""
    poly = np.asarray(poly, float)
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        e1 = (p1 - p0) / np.linalg.norm(p1 - p0)
        e2 = (p2 - p1) / np.linalg.norm(p2 - p1)
        n1 = np.array((-e1[1], e1[0]))
        n2 = np.array((-e2[1], e2[0]))
        # lines p0+n1 d + t e1 and p1 + n2 d + s e2
        a = p0 + n1 * d
        b = p1 + n2 * d
        A = np.array((e1, -e2)).T
        try:
            t, _ = np.linalg.solve(A, b - a)
            out.append(a + e1 * t)
        except np.linalg.LinAlgError:
            out.append(p1 + n1 * d)
    return np.array(out)


def offset_radial(poly, d, center=(0.0, 0.0)):
    c = np.asarray(center, float)
    poly = np.asarray(poly, float)
    v = poly - c
    L = np.linalg.norm(v, axis=1, keepdims=True)
    return c + v * np.maximum(L - d, 1e-4) / L


def prism(m, poly, z0, z1, skin, c=0.0, mode="convex", center=None, shade=1.0, thr=30.0, caps=(True, True),
          side_skin=None, cap_shade=None):
    """A ccw outline (local x, y) extruded from z0 to z1, its rims chamfered by c (convex: true inset; radial:
    toward `center`, for gear teeth)."""
    poly = np.asarray(poly, float)
    ctr = np.asarray(center if center is not None else poly.mean(0), float)
    if c > 0:
        ins = offset_convex(poly, c) if mode == "convex" else offset_radial(poly, c, ctr)
        rings = [(ins, z0), (poly, z0 + c), (poly, z1 - c), (ins, z1)]
    else:
        rings = [(poly, z0), (poly, z1)]
    n = len(poly)
    P = np.array([[(p[0], p[1], z) for p in ring] for ring, z in rings])
    per = [0.0]
    for i in range(1, n + 1):
        per.append(per[-1] + float(np.linalg.norm(poly[i % n] - poly[i - 1])))
    ST = np.zeros((len(rings), n + 1, 2))
    for i, (_, z) in enumerate(rings):
        for j in range(n + 1):
            ST[i, j] = (per[j], z1 - z)
    lo = np.array((poly[:, 0].min(), poly[:, 1].min(), z0))
    hi = np.array((poly[:, 0].max(), poly[:, 1].max(), z1))
    sk = skin.bind(lo, hi) if isinstance(skin, Box) else skin
    ssk = side_skin if side_skin is not None else sk
    if isinstance(ssk, Box) and ssk is not sk:
        ssk = ssk.bind(lo, hi)
    zm = (z0 + z1) / 2
    area = sum(poly[k][0] * poly[(k + 1) % n][1] - poly[(k + 1) % n][0] * poly[k][1] for k in range(n))
    sgn = 1.0 if area > 0 else -1.0

    def outfn(i, j, cc):
        # the outline edge's own outward normal (right for concave outlines too), tilted on the chamfers
        e = poly[(j + 1) % n] - poly[j]
        return np.array((e[1] * sgn, -e[0] * sgn, 0.0)) / (np.linalg.norm(e) or 1.0) + np.array((0, 0, (cc[2] - zm) * 0.2 / max(1e-6, z1 - z0)))

    ids = grid(m, P, ST, ssk, closed=True, outfn=outfn, shade=shade, thr=thr)
    cs = cap_shade if cap_shade is not None else shade
    if caps[0]:
        cap(m, ids[0], P[0], sk, out=np.array((0, 0, -1.0)), shade=cs)
    if caps[1]:
        cap(m, ids[-1], P[-1], sk, out=np.array((0, 0, 1.0)), shade=cs)
    return ids, P


def holed_plate(m, outer, hole, z0, z1, skin, c=0.0, shade=1.0, thr=35.0, skip_edges=()):
    """A plate in local x, y from z0 to z1: a ccw outer outline and a hole (same number of points, ccw), the faces
    bridged between them, the hole's wall, the rim with chamfers c. skip_edges: outline segments left open
    (hidden in another part)."""
    outer = np.asarray(outer, float)
    hole = np.asarray(hole, float)
    n = len(outer)
    assert len(hole) == n
    ctr = hole.mean(0)
    if isinstance(skin, Box):
        skin = skin.bind((outer[:, 0].min(), outer[:, 1].min(), z0), (outer[:, 0].max(), outer[:, 1].max(), z1))
    ins = offset_convex(outer, c) if c > 0 else outer
    oc = ctr if True else None
    rings = [(ins, z0), (outer, z0 + c), (outer, z1 - c), (ins, z1)] if c > 0 else [(outer, z0), (outer, z1)]
    P = np.array([[(p[0], p[1], z) for p in r] for r, z in rings])
    ids = np.zeros(P.shape[:2], int)
    for i in range(P.shape[0]):
        for j in range(n):
            ids[i, j] = m.vid(P[i, j])
    zm = (z0 + z1) / 2
    for i in range(P.shape[0] - 1):
        for j in range(n):
            if j in skip_edges:
                continue
            j1 = (j + 1) % n
            pts = [P[i, j], P[i, j1], P[i + 1, j1], P[i + 1, j]]
            cc = np.mean(pts, 0)
            m.face([ids[i, j], ids[i, j1], ids[i + 1, j1], ids[i + 1, j]], pts, skin,
                   out=np.array((cc[0] - outer[:, 0].mean(), cc[1] - outer[:, 1].mean(), (cc[2] - zm) * 0.3)), shade=shade, thr=thr)
    hz = [(hole, z0), (hole, z1)]
    H = np.array([[(p[0], p[1], z) for p in r] for r, z in hz])
    hid = np.zeros(H.shape[:2], int)
    for i in range(2):
        for j in range(n):
            hid[i, j] = m.vid(H[i, j])
    for j in range(n):
        j1 = (j + 1) % n
        pts = [H[0, j], H[0, j1], H[1, j1], H[1, j]]
        cc = np.mean(pts, 0)
        m.face([hid[0, j], hid[0, j1], hid[1, j1], hid[1, j]], pts, skin,
               out=np.array((ctr[0] - cc[0], ctr[1] - cc[1], 0.0)), shade=shade * 0.7, thr=thr)
    for side, ri, hi_, zz in ((0, 0, 0, z0), (1, P.shape[0] - 1, 1, z1)):
        for j in range(n):
            j1 = (j + 1) % n
            pts = [P[ri, j], P[ri, j1], H[hi_, j1], H[hi_, j]]
            m.face([ids[ri, j], ids[ri, j1], hid[hi_, j1], hid[hi_, j]], pts, skin,
                   out=np.array((0, 0, -1.0 if side == 0 else 1.0)), shade=shade, thr=thr)


def gear_outline(z, r_pitch, module, phase=0.0, pts_per_tooth=4):
    """A spur gear's outline (ccw): z teeth, tips at r_pitch + module, roots at r_pitch - 1.25 module, flanks
    straight-ish (cast teeth of the period). A tooth is centred at phase + k * 2pi / z."""
    ra = r_pitch + module
    rf = r_pitch - 1.25 * module
    out = []
    step = 2 * math.pi / z
    for k in range(z):
        c = phase + k * step
        # angular half widths: at the root the tooth is wider than at the tip
        hw_root = step * 0.27
        hw_tip = step * 0.17
        out += [(rf * math.cos(c - hw_root * 1.0 - step * 0.0), rf * math.sin(c - hw_root)),
                (ra * math.cos(c - hw_tip), ra * math.sin(c - hw_tip)),
                (ra * math.cos(c + hw_tip), ra * math.sin(c + hw_tip)),
                (rf * math.cos(c + hw_root), rf * math.sin(c + hw_root))]
    return np.array(out)


def gear(m, z, r_pitch, module, x0, x1, skin, r_in, phase=0.0, c=0.002, shade=1.0, wall=True):
    """A gear rim in local XY (axis local Z, faces at z x0 and x1): the toothed outline with chamfered rims, its
    two faces as rings down to r_in, the rim's inner wall. Returns the outline."""
    ol = gear_outline(z, r_pitch, module, phase)
    ins = offset_radial(ol, c)
    n = len(ol)
    rings = [(ins, x0), (ol, x0 + c), (ol, x1 - c), (ins, x1)]
    P = np.array([[(p[0], p[1], zz) for p in ring] for ring, zz in rings])
    per = [0.0]
    for i in range(1, n + 1):
        per.append(per[-1] + float(np.linalg.norm(ol[i % n] - ol[i - 1])))
    ST = np.array([[(per[j], x1 - zz) for j in range(n + 1)] for _, zz in rings])
    zm = (x0 + x1) / 2
    sk = skin.bind((-r_pitch - module, -r_pitch - module, x0), (r_pitch + module, r_pitch + module, x1)) if isinstance(skin, Box) else skin
    def gout(i, j, cc):
        e = ol[(j + 1) % n] - ol[j]
        return np.array((e[1], -e[0], 0.0)) / (np.linalg.norm(e) or 1.0) + np.array((0, 0, (cc[2] - zm) * 0.2 / (x1 - x0)))

    ids = grid(m, P, ST, sk, closed=True, outfn=gout, shade=shade, thr=30.0)
    # the faces: each tooth with its piece of the rim down to r_in in one polygon
    ppt = n // z
    angs = [math.atan2(ins[k * ppt, 1], ins[k * ppt, 0]) for k in range(z)]
    for side, row, zz in ((0, 0, x0), (1, 3, x1)):
        ipts = [(r_in * math.cos(a), r_in * math.sin(a), zz) for a in angs]
        inner = [m.vid(p) for p in ipts]
        for k in range(z):
            k1 = (k + 1) % z
            js = [(k * ppt + q) % n for q in range(ppt + 1)]
            q = [ids[row, j] for j in js] + [inner[k1], inner[k]]
            pts = [P[row, j] for j in js] + [ipts[k1], ipts[k]]
            m.face(q, pts, sk, out=np.array((0, 0, -1.0 if side == 0 else 1.0)), shade=shade, thr=30.0)
    if wall:
        lathe(m, [(r_in, x1), (r_in, x0)], z, sk, shade=shade * 0.8, thr=40.0, a0=angs[0])
    return ol


def blob_grid(nu, nv):
    """(u, v) parameters of a closed sphere-like grid: u round (0..1), v from the bottom pole (0) to the top (1)."""
    return np.linspace(0, 1, nu, endpoint=False), np.linspace(0, 1, nv)


# ------------------------------------------------------------------ occlusion and shade in vertex colour

_DIRS = None


def _hemi(nrays=40):
    """Cosine-weighted directions on the hemisphere round +Z (a Fibonacci spiral)."""
    global _DIRS
    if _DIRS is not None and len(_DIRS) == nrays:
        return _DIRS
    ga = math.pi * (3 - math.sqrt(5))
    d = []
    for i in range(nrays):
        u = (i + 0.5) / nrays
        r = math.sqrt(u)
        a = i * ga
        d.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u))))
    _DIRS = np.array(d)
    return _DIRS


def bake_shade(objs, ground=True, reach=0.15, nrays=40, strength=0.75, floor=0.30, ground_z=0.0):
    """Ambient occlusion per vertex by ray casts against the model itself (and the ground), times each face's
    shade factor, into the corner colour "Col"."""
    verts, polys = [], []
    for ob in objs:
        mw = ob.matrix_world
        me = ob.data
        me.calc_loop_triangles()
        base = len(verts)
        verts += [mw @ v.co for v in me.vertices]
        polys += [tuple(base + i for i in t.vertices) for t in me.loop_triangles]
    if ground:
        b = len(verts)
        S = 20.0
        verts += [Vector((-S, -S, ground_z)), Vector((S, -S, ground_z)), Vector((S, S, ground_z)), Vector((-S, S, ground_z))]
        polys += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=True)
    D = _hemi(nrays)
    for ob in objs:
        me = ob.data
        mw = ob.matrix_world
        n3 = mw.to_3x3()
        ao = np.ones(len(me.vertices))
        for vi, v in enumerate(me.vertices):
            p = mw @ v.co
            nrm = (n3 @ v.normal).normalized()
            t = nrm.orthogonal().normalized()
            bvec = nrm.cross(t)
            org = p + nrm * 0.0012
            occ = 0.0
            for dx, dy, dz in D:
                d = t * dx + bvec * dy + nrm * dz
                hit = tree.ray_cast(org, d, reach)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / reach) ** 0.7
            ao[vi] = 1.0 - occ / len(D)
        shades = list(ob.get("_shade", []))
        if len(shades) != len(me.polygons):
            shades = [1.0] * len(me.polygons)
        nl = len(me.loops)
        lv = np.zeros(nl, int)
        me.loops.foreach_get("vertex_index", lv)
        lp = np.zeros(nl, int)
        for p in me.polygons:
            lp[p.loop_start:p.loop_start + p.loop_total] = p.index
        sh = np.asarray(shades)[lp]
        a = ao[lv]
        k = sh * (floor + (1 - floor) * (1 - strength * (1 - a)) ** 1.0)
        k = np.clip(k, 0.0, 1.0)
        col = np.ones((nl, 4), np.float32)
        col[:, 0] = col[:, 1] = col[:, 2] = k
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        ca.data.foreach_set("color", col.ravel())
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = me.color_attributes.find("Col")
        if "_shade" in ob:
            del ob["_shade"]


def flipped_edges(ob):
    """Edges between two faces wound the same way along them (one of the two is inside out)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bad = 0
    for e in bm.edges:
        if len(e.link_loops) == 2:
            a, b = e.link_loops
            if a.vert == b.vert:
                bad += 1
    bm.free()
    return bad


def tris_of(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)

"""The base bodies from MakeHuman's CC0 base mesh (docs/people.md "Bodies from MakeHuman", docs/makehuman.md).

A body: MakeHuman's base mesh with the macro setting of its base and build (mh.macro: gender, age, weight, muscle;
MPFB gives the target mix), posed into our rest pose (mh.Pose), scaled to the kit's table height (body.HEIGHT), the
old stooped (body.stoop_fn). Its near and far copies are one reduced topology each, made once from the base mesh
(the face keeps MakeHuman's density, the body is reduced: REGIONS) and bound to it (mh.Binding), so every body and every
slider (sliders.py) is the same topology moved. The eyes are MakeHuman's own (low-poly eyes on their helper), the
weights MakeHuman's default rig weights summed onto our 64 bones with the kit's rules on top (the shoulder helpers),
the skeleton our own (rig.py) with its joints measured on the posed body.

make_body() returns the same dict as the old cage bodies (name, P, C, ao, lod0, lod1, J, counts, vparts, cparts), so
the clothes (dress.py, clothes_kit.py) work on it: C is A's cage made with this body's measured landmarks and fitted
onto its surface (fit_cage).
"""

import math

import numpy as np

from . import B, G
from . import body as bd
from . import mh
from . import rig

# ---------------------------------------------------------------- the macro settings of the ten bodies

# years, weight, muscle (MakeHuman's 0..1, 0.5 average); gender 1 man, 0 woman. Children are a little boyish (boys
# and girls share the bodies; the girls wear skirts). The heights are the kit's (body.HEIGHT), not MakeHuman's.
SPECS = {
    ("man", "middling"): dict(gender=1.0, years=35, weight=0.50, muscle=0.58),
    ("man", "slight"): dict(gender=1.0, years=30, weight=0.22, muscle=0.45),
    ("man", "stout"): dict(gender=1.0, years=45, weight=0.92, muscle=0.55),
    ("woman", "middling"): dict(gender=0.0, years=33, weight=0.52, muscle=0.45, cupsize=0.5),
    ("woman", "slight"): dict(gender=0.0, years=28, weight=0.25, muscle=0.40, cupsize=0.4),
    ("woman", "stout"): dict(gender=0.0, years=45, weight=0.92, muscle=0.45, cupsize=0.7),
    ("child", "middling"): dict(gender=0.65, years=10, weight=0.50, muscle=0.50),
    ("child", "slight"): dict(gender=0.65, years=10, weight=0.28, muscle=0.45),
    ("old_man", "stooped"): dict(gender=1.0, years=70, weight=0.42, muscle=0.40),
    ("old_woman", "stooped"): dict(gender=0.0, years=70, weight=0.45, muscle=0.35),
}

# triangle budgets of the two copies per region (mh.regions), both sides together
# the hands keep enough to read as hands at a metre (knuckles, nails, a closed fist): the trunk, arms and legs give
# up a little (mostly under clothes, cut away in the kinds)
# (#138) the scalp shows on a bald crown at 0.6 m: 560 (was 260); (#82) bare feet: 950 (was 700), so each toe is
# round and has its nail (the kinds' feet are cut away under shoes). The trunk gives them (960, was 1350: mostly under
# clothes, cut away in the kinds); the legs keep 1100 (fewer folded the bent knee: 41% of its section at 120 degrees)
LOD0 = {"face": 2700, "scalp": 560, "ear": 260, "neck": 240, "torso": 960, "arm": 1050, "hand": 1150, "leg": 1100,
        "foot": 950}
LOD1 = {"face": 330, "scalp": 110, "ear": 40, "neck": 50, "torso": 420, "arm": 220, "hand": 170, "leg": 340,
        "foot": 110}
REGION_ORDER = ["torso", "leg", "arm", "neck", "foot", "hand", "scalp", "ear", "face"]


def spec_macro(base, build):
    s = SPECS[(base, build)]
    return mh.macro(s["gender"], s["years"], s["weight"], s["muscle"], cupsize=s.get("cupsize", 0.5))


# ---------------------------------------------------------------- one body: the shape, its pose, its place

class Body:
    """A body's base-mesh positions in our rest pose and space, and the same transform for any slider's move."""

    def __init__(self, base, build, extra=None):
        self.base, self.build = base, build
        b = self.b = mh.base()
        self.W = mh.weights()
        self.mac = spec_macro(base, build)
        V = b.V + mh.macro_move(self.mac)
        if extra is not None:
            V = V + extra
        self.V = V
        self.pose = mh.Pose(V, self.W, b)
        Pp = self.pose.pos(V)
        bodyv = Pp[b.body]
        self.lo = float(bodyv[:, 1].min())
        self.k = bd.HEIGHT[base] / float(bodyv[:, 1].max() - self.lo)
        self.P0 = self.k * (Pp - np.array((0.0, self.lo, 0.0)))  # before any stoop
        self.parts = mh.parts(b).astype(str)
        self.params = self._params()
        self.stoop = bd.stoop_fn(self.params) if self.params["f"]["stoop"] > 0 else None
        self.Pf = self._stoop(self.P0)
        if self.stoop is not None:
            self._jac = self._stoop_jacobian(self.P0)

    # -- measures for the kit's params: landmark fractions, shoulder and hip x
    def _params(self):
        b, P0 = self.b, self.P0
        P = bd.params(self.base, self.build)
        H = P["H"]
        crown = float(P0[b.body][:, 1].max())
        c = lambda n: b.cube(P0, n)
        chin_y = self.chin_y(P0)
        waist = self.waist_y(P0)
        keys = [0.0, c("l-ankle")[1] / H, c("l-knee")[1] / H, c("l-upper-leg")[1] / H, waist / H,
                c("l-shoulder")[1] / H, chin_y / H, crown / H]
        for i in range(1, len(keys)):
            keys[i] = max(keys[i], keys[i - 1] + 1e-3)
        P["keys"] = keys
        P["mh"] = {"shoulder_x": float(c("l-shoulder")[0]), "hip_x": float(c("l-upper-leg")[0]),
                   "macro": self.mac, "scale": self.k}
        P["head_h"] = crown - chin_y
        P["hs"] = P["head_h"] / 0.214
        return P

    def chin_y(self, P):
        b = self.b
        hv = b.vsets["body"][(self.parts[b.vsets["body"]] == "head")]
        Q = P[hv]
        front = Q[(np.abs(Q[:, 0]) < 0.01) & (Q[:, 2] > b.cube(P, "head")[2] + 0.04)]
        return float(front[:, 1].min())

    def waist_y(self, P):
        """The narrowest girth of the trunk between the hip joint and the lower ribs."""
        b = self.b
        tv = b.vsets["body"][self.parts[b.vsets["body"]] == "torso"]
        Q = P[tv]
        y0, y1 = b.cube(P, "l-upper-leg")[1] + 0.06, b.cube(P, "l-shoulder")[1] - 0.22
        best, by = 1e9, (y0 + y1) / 2
        for y in np.linspace(y0, y1, 40):
            s = Q[np.abs(Q[:, 1] - y) < 0.006]
            if len(s) < 8:
                continue
            w = s[:, 0].max() - s[:, 0].min() + 0.6 * (s[:, 2].max() - s[:, 2].min())
            if w < best:
                best, by = w, y
        return float(by)

    # -- the stoop of the old (body.stoop_fn), on points and on moves
    def _stoop(self, P):
        if self.stoop is None:
            return P.copy()
        out = np.empty_like(P)
        for i in range(len(P)):
            out[i] = self.stoop(tuple(P[i]), self.parts[i])
        return out

    def _stoop_jacobian(self, P, h=1e-4):
        J = np.zeros((len(P), 3, 3))
        f0 = self._stoop(P)
        for k in range(3):
            d = np.zeros(3)
            d[k] = h
            J[:, :, k] = (self._stoop(P + d) - f0) / h
        return J

    def place(self, V):
        """Base positions in MakeHuman's pose and units (metres) -> this body's rest space (posed, scaled, stooped)."""
        P = self.k * (self.pose.pos(V) - np.array((0.0, self.lo, 0.0)))
        return self._stoop(P)

    def move(self, D):
        """A move of the base mesh (a slider) -> the same move in this body's rest space (linear, posed with the body)."""
        M = self.k * self.pose.vec(D)
        if self.stoop is not None:
            M = np.einsum("nij,nj->ni", self._jac, M)
        return M

    def joints(self):
        """Our 64 bones' heads and tails in this body's rest space (rig.py's directions, MakeHuman's joints)."""
        b, P0 = self.b, self.P0
        c = lambda n: b.cube(P0, n)
        P = self.params
        H = P["H"]
        up, down, fwd = np.array((0, 1.0, 0)), np.array((0, -1.0, 0)), np.array((0, 0, 1.0))
        J = {}

        def put(name, head, tail=None, d=None, length=None, part="torso"):
            h = np.array(head, float)
            t = np.array(tail, float) if tail is not None else h + d * length
            J[name] = (h, t, part)

        mid = lambda p: np.array((0.0, p[1], p[2]))
        pel, s4, s3, s2, s1 = c("pelvis"), c("spine-4"), c("spine-3"), c("spine-2"), c("spine-1")
        nk, hd = c("neck"), c("head")
        crown = float(P0[b.body][:, 1].max())
        put("hips", mid(pel), mid(pel) + up * (s4[1] - pel[1]))
        put("spine", mid(s4), mid(s4) + up * (s2[1] - s4[1]))
        put("chest", mid(s2), mid(s2) + up * (s1[1] - s2[1]))
        put("upperChest", mid(s1), mid(s1) + up * (nk[1] - s1[1]))
        put("neck", mid(nk), mid(nk) + up * (hd[1] - nk[1]), part="neck")
        put("head", mid(hd), np.array((0.0, crown, hd[2])), part="head")
        jw = c("mouth")
        put("jaw", mid(jw), d=fwd, length=0.08 * H / 1.67, part="head")
        for S, s, sg in (("L", "l", 1), ("R", "r", -1)):
            cl, sh, el, wr = c(s + "-clavicle"), c(s + "-shoulder"), c(s + "-elbow"), c(s + "-hand")
            put("clavicle" + S, cl, d=up, length=0.05 * H / 1.67)
            ez = -0.008 * H / 1.67
            put("armUp" + S, sh, np.array((sh[0], el[1], sh[2])), part="arm")
            put("shoulder" + S, sh, sh + down * 0.09 * H / 1.67, part="arm")
            elb = np.array((sh[0], el[1], sh[2] + ez))
            put("armLow" + S, elb, np.array((elb[0], wr[1], elb[2])), part="arm")
            put("armTwist" + S, elb + down * 0.55 * (el[1] - wr[1]), np.array((elb[0], wr[1], elb[2])), part="arm")
            knuck = c(s + "-finger-3-1")
            put("hand" + S, np.array((sh[0], wr[1], sh[2])), np.array((sh[0], knuck[1], sh[2])), part="arm")
            for k_, fname in (("1", "thumb"), ("2", "index"), ("3", "middle"), ("4", "ring")):
                pts = [c("%s-finger-%s-%d" % (s, k_, j)) for j in (1, 2, 3, 4)]
                for j in range(3):
                    put("%s%d%s" % (fname, j + 1, S), pts[j], pts[j + 1], part="arm")
            # the grip: where a handle passes through the closed fist, 2.2 cm past the knuckles on the palm side
            hs_ = H / 1.67
            put("grip" + S, (sh[0] - sg * 0.021 * hs_, knuck[1] - 0.022 * hs_, sh[2] - 0.004 * hs_), d=fwd,
                length=0.06 * hs_, part="arm")
        for S, s, sg in (("L", "l", 1), ("R", "r", -1)):
            hp, kn, an = c(s + "-upper-leg"), c(s + "-knee"), c(s + "-ankle")
            kz = 0.008 * H / 1.67
            put("legUp" + S, hp, np.array((hp[0], kn[1], hp[2])), part="leg" + S)
            put("legLow" + S, np.array((hp[0], kn[1], hp[2] + kz)), np.array((hp[0], an[1], hp[2] + kz)),
                part="leg" + S)
            toes = np.mean([c("%s-toe-%d-1" % (s, j)) for j in (1, 2, 3, 4, 5)], 0)
            ank = np.array((hp[0], an[1], hp[2]))
            put("foot" + S, ank, np.array((hp[0], an[1], toes[2])), part="leg" + S)
            put("toe" + S, np.array((toes[0], toes[1], toes[2])), d=fwd, length=0.06 * H / 1.67, part="leg" + S)
        w = H / 1.67
        k_ = P["f"]["hip"] * w
        sy = bd.Y(P, 0.600)
        L = bd.Y(P, 0.6) - bd.Y(P, 0.30)
        put("skirtF", (0, sy, 0.10 * k_), d=down, length=L)
        put("skirtB", (0, sy, -0.11 * k_), d=down, length=L)
        put("skirtL", (0.15 * k_, sy, 0), d=down, length=L)
        put("skirtR", (-0.15 * k_, sy, 0), d=down, length=L)
        put("coatTailL", (0.07 * k_, sy, -0.115 * k_), d=down, length=bd.Y(P, 0.6) - bd.Y(P, 0.40))
        put("coatTailR", (-0.07 * k_, sy, -0.115 * k_), d=down, length=bd.Y(P, 0.6) - bd.Y(P, 0.40))
        put("hipL", self.surface_point(np.array((1, 0, 0.1)), bd.Y(P, 0.598), "torso", 0.0), d=down,
            length=0.12 * w)
        back = self.surface_point(np.array((0, 0, -1.0)), bd.Y(P, 0.760), "torso", 0.0)
        put("back", back, d=up, length=0.12 * w)
        put("headTop", (0.0, crown, hd[2] + 0.002), d=up, length=0.08 * w, part="head")
        for S, s in (("L", "l"), ("R", "r")):
            e = c(s + "-eye")
            J["eye" + S] = (e, e + fwd * 0.02 * w, "head")
        out = {}
        for n in rig.NAMES:
            h, t, part = J[n]
            if self.stoop is not None:
                nh = np.array(self.stoop(tuple(h), part))
            else:
                nh = np.array(h)
            out[n] = (nh, nh + (np.array(t) - np.array(h)))
        return out

    def surface_point(self, direction, y, part, out=0.0):
        """The body's surface (rest, before the stoop) at height y seen from the trunk's axis along `direction`."""
        b = self.b
        vv = b.vsets["body"][self.parts[b.vsets["body"]] == part]
        Q = self.P0[vv]
        s = Q[np.abs(Q[:, 1] - y) < 0.012]
        d = direction / np.linalg.norm(direction)
        i = np.argmax(s @ d)
        p = s[i].copy()
        p[1] = y
        return p + d * out


# ---------------------------------------------------------------- the UV layout: MakeHuman's islands, our two pictures

# MakeHuman's UV islands of the body (found by island_ids): the head (with the ears), the inside of the mouth and the
# two eye sockets go to the face picture (the whole square); the body, hands and feet to the body picture.
FACE_ISLANDS = ("head", "mouth", "socketL", "socketR")
EYE_RECT = (0.80, 0.80, 0.98, 0.98)  # where the eyeball's picture sits in the face square (u0, v0, u1, v1)


_ISL = None


def island_ids():
    """Per body face of the base mesh its UV island's name: the islands are the faces joined by shared UV corners,
    named by where they are on the body (the head with the ears, the inside of the mouth, the eye sockets, the
    hands, the feet, the rest of the body)."""
    global _ISL
    if _ISL is not None:
        return _ISL
    b = mh.base()
    faces = list(b.body_faces)
    parent = {f: f for f in faces}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    owner = {}
    for f in faces:
        for t in b.FT[f]:
            if t in owner:
                ra, rb = find(owner[t]), find(f)
                if ra != rb:
                    parent[rb] = ra
            else:
                owner[t] = f
    comps = {}
    for f in faces:
        comps.setdefault(find(f), []).append(f)
    name = {}
    V = b.V
    hy = b.cube(V, "neck")[1]
    big = max(comps.values(), key=len)
    for root, fs in comps.items():
        vs = np.unique([v for f in fs for v in b.F[f]])
        c = V[vs].mean(0)
        if fs is big:
            n = "body"
        elif c[1] < b.cube(V, "l-knee")[1]:
            n = "foot"
        elif c[1] < hy and abs(c[0]) > 0.2:
            n = "handL" if c[0] > 0 else "handR"
        elif c[1] > hy and len(fs) > 1000:
            n = "head"
        elif c[1] > hy and abs(c[0]) < 0.01:
            n = "mouth"
        elif c[1] > hy:
            n = "socketL" if c[0] > 0 else "socketR"
        else:
            raise ValueError("unexpected UV island at %s (%d faces)" % (c, len(fs)))
        for f in fs:
            name[f] = n
    _ISL = np.array([name[f] for f in faces])
    return _ISL


def face_uv(uv, island):
    """MakeHuman UV -> the face square: the head island fills the height, the rest beside it."""
    uv = np.asarray(uv, float)
    if island == "head":
        s = 1.0 / 0.672
        return (uv - (0.640, 0.148)) * s + (0.004, 0.0)
    if island == "mouth":
        s = 1.35
        return (uv - (0.757, 0.011)) * s + (0.56, 0.02)
    if island in ("socketL", "socketR"):
        s = 1.35
        x0 = 0.012 if island == "socketR" else 0.086
        return (uv - (x0, 0.546)) * s + (0.56 + (0.0 if island == "socketR" else 0.11), 0.24)
    raise KeyError(island)


# ---------------------------------------------------------------- the reduced topologies (made once, bound to hm08)

class Topo:
    """One reduced copy: faces (tuples of its vertices), per-loop MakeHuman UVs and islands, per vertex its part and
    region, and its binding to the base mesh."""


_TOPO = {}


def _uv_flips(T):
    """Triangles (fans of the copy's faces) whose UV winding is the opposite of MakeHuman's (all of its are
    counter-clockwise)."""
    n = 0
    for fi, f in enumerate(T.faces):
        ls = T.loop_start[fi]
        uv = T.loop_uv[ls:ls + len(f)]
        for k in range(1, len(f) - 1):
            a, b_, c = uv[0], uv[k], uv[k + 1]
            if (b_[0] - a[0]) * (c[1] - a[1]) - (b_[1] - a[1]) * (c[0] - a[0]) < 0:
                n += 1
    return n


def reproject_uv(T, b, P0, isl_of_base):
    """A reduced copy's UVs read again from MakeHuman's own: every corner of a face takes the UV its point has on
    the base mesh triangle of the face's own island nearest to a point a little inside the face (so a corner on a UV
    cut takes its own side's UV), by that triangle's affine UV map. The decimator's interpolated UVs flipped a few
    hundred small triangles (fingers, toes) and mixed the sides of cuts."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    btris, bsrc = b.tris()
    k_of = {int(fi): k for k, fi in enumerate(b.body_faces)}
    tisl = np.array([isl_of_base[k_of[int(fi)]] for fi in bsrc])
    # each base triangle's corner UVs (the fan of its face, as b.tris makes it)
    tuv = []
    for fi in b.body_faces:
        ft = b.FT[fi]
        for k in range(1, len(ft) - 1):
            tuv.append((b.VT[ft[0]], b.VT[ft[k]], b.VT[ft[k + 1]]))
    tuv = np.array(tuv, np.float64)
    trees = {}
    for name in sorted(set(tisl)):
        idx = np.nonzero(tisl == name)[0]
        trees[name] = (idx, BVHTree.FromPolygons([tuple(p) for p in P0], [tuple(t) for t in btris[idx]],
                                                 all_triangles=True))
    out = T.loop_uv.copy()

    def flips(uv):
        n = 0
        for k in range(1, len(uv) - 1):
            a, b_, c = uv[0], uv[k], uv[k + 1]
            n += (b_[0] - a[0]) * (c[1] - a[1]) - (b_[1] - a[1]) * (c[0] - a[0]) < 0
        return n
    for fi, f in enumerate(T.faces):
        name = T.face_island[fi]
        if name not in trees:
            continue
        ls = T.loop_start[fi]
        before = T.loop_uv[ls:ls + len(f)]
        if not flips(before):
            continue  # only a face the decimator turned over is read again
        idx, tree = trees[name]
        c = T.co[list(f)].mean(0)
        for j, v in enumerate(f):
            p = T.co[v]
            q = p * 0.8 + c * 0.2
            loc, nrm, ti, d = tree.find_nearest(Vector(q))
            if loc is None:
                continue
            t = btris[idx[ti]]
            A, B_, C = P0[t[0]], P0[t[1]], P0[t[2]]
            v0, v1, v2 = B_ - A, C - A, p - A
            d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
            d20, d21 = v2 @ v0, v2 @ v1
            den = d00 * d11 - d01 * d01
            if abs(den) < 1e-20:
                continue
            wb = (d11 * d20 - d01 * d21) / den
            wc = (d00 * d21 - d01 * d20) / den
            wa = 1.0 - wb - wc
            uvs = tuv[idx[ti]]
            out[ls + j] = wa * uvs[0] + wb * uvs[1] + wc * uvs[2]
        if flips(out[ls:ls + len(f)]) >= flips(before):
            out[ls:ls + len(f)] = before  # no better: keep the decimator's
    return out


def topology(lod):
    if lod in _TOPO:
        return _TOPO[lod]
    import bpy
    budget = LOD0 if lod == 0 else LOD1
    ref = Body("man", "middling")
    b, P0, W = ref.b, ref.P0, ref.W
    reg = mh.regions(b, W).astype(str)
    parts = ref.parts
    jaw = W[:, rig.NAMES.index("jaw")] > 0.5
    group = np.where((parts == "head") & jaw, "jaw", parts)
    used = b.body
    remap = -np.ones(mh.NV, np.int64)
    remap[used] = np.arange(len(used))
    isl = island_ids()
    # the far copy has no inside of the mouth and no eye sockets (closed lips, the eyeballs fill the lids' opening)
    keepf = [k for k in range(len(b.body_faces)) if lod == 0 or isl[k] not in ("mouth", "socketL", "socketR")]
    bfaces = [b.body_faces[k] for k in keepf]
    isl = isl[keepf]
    faces = [tuple(remap[list(b.F[fi])]) for fi in bfaces]
    me = bpy.data.meshes.new("mh_topo%d" % lod)
    me.from_pydata([tuple(B(*p)) for p in P0[used]], [], [list(f) for f in faces])
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    luv = np.array([b.VT[t] for fi in bfaces for t in b.FT[fi]])
    uvl.data.foreach_set("uv", luv.ravel())
    ob = bpy.data.objects.new("mh_topo%d" % lod, me)
    bpy.context.scene.collection.objects.link(ob)
    # labels that survive the decimation: region, binding group and island (an island per face via a face attribute)
    labels = {}
    for kind, arr in (("reg", reg[used]), ("grp", group[used])):
        for name in sorted(set(arr)):
            vg = ob.vertex_groups.new(name="%s_%s" % (kind, name))
            vg.add([int(i) for i in np.nonzero(arr == name)[0]], 1.0, "REPLACE")
            labels.setdefault(kind, []).append(name)
    # the UV islands' edges (the neck's seam, the wrists, the ankles, the lids, the lips) and a ring round them are
    # never reduced: a face across a seam would mix two islands' UVs
    vis = {}
    for f, name in zip(faces, isl):
        for v in f:
            vis.setdefault(v, set()).add(name)
    band = {v for v, s in vis.items() if len(s) > 1}
    if lod == 1:  # the far copy keeps only the neck's seam (between the head's and the body's pictures) whole
        band = {v for v, s in vis.items() if "head" in s and len(s) > 1}
    # and the cuts inside an island (down the back, inside the arms and legs): a vertex with two UVs. A collapse
    # across such a cut gave a face one corner from each side of the picture: a shard of stretched texture
    # (the near copy's trunk, limbs and head; the hands and feet are cut everywhere and stay reducible, and the far
    # copy is seen too small for a shard to show)
    if lod == 0:
        vuv = {}
        for fi, f, name in zip(bfaces, faces, isl):
            if name not in ("body", "head"):
                continue
            for v, t in zip(f, b.FT[fi]):
                vuv.setdefault(v, set()).add((round(float(b.VT[t][0]), 5), round(float(b.VT[t][1]), 5)))
        band |= {v for v, s in vuv.items() if len(s) > 1 and vis.get(v, set()) <= {"body", "head"}}
    for _ in range(2 if lod == 0 else 1):
        ring = set()
        for f in faces:
            if any(v in band for v in f):
                ring.update(f)
        band |= ring
    for name in sorted(set(reg[used])):
        idx = [int(i) for i in np.nonzero(reg[used] == name)[0] if int(i) not in band]
        ob.vertex_groups.new(name="dec_" + name).add(idx, 1.0, "REPLACE")
    names = sorted(set(isl))
    fa = me.attributes.new("island", "INT", "FACE")
    fa.data.foreach_set("value", np.array([names.index(n) for n in isl], np.int32))
    bpy.context.view_layer.objects.active = ob
    ntri = lambda: sum(len(p.vertices) - 2 for p in me.polygons)

    def region_tris():
        idx = {g.index: g.name[4:] for g in ob.vertex_groups if g.name.startswith("reg_")}
        vr = [""] * len(me.vertices)
        for v in me.vertices:
            best = -1.0
            for g in v.groups:
                if g.group in idx and g.weight > best:
                    best, vr[v.index] = g.weight, idx[g.group]
        cnt = {}
        for p in me.polygons:
            r = vr[p.vertices[0]]
            cnt[r] = cnt.get(r, 0) + len(p.vertices) - 2
        return cnt
    # the trunk, the limbs, the hands and the feet: MakeHuman's quads halved both ways where the grid allows (every
    # other loop kept: clean rings at the joints and round each finger), then the rest by collapse within each
    # region's budget
    if lod == 0:
        import bmesh
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(me)
        dl = bm.verts.layers.deform.verify()
        keep = {g.index for g in ob.vertex_groups if g.name in ("dec_torso", "dec_arm", "dec_leg", "dec_neck",
                                                                "dec_hand", "dec_foot")}
        for f in bm.faces:
            f.select = all(any(k in keep for k in v[dl].keys()) for v in f.verts)
        bmesh.update_edit_mesh(me)
        bpy.ops.mesh.unsubdivide(iterations=1)
        bpy.ops.object.mode_set(mode="OBJECT")
        me = ob.data
        print("[people2] after halving the trunk and limbs:", region_tris())
    for r in REGION_ORDER:
        for _ in range(3):
            have = region_tris().get(r, 0)
            want = budget[r]
            if have <= want * 1.03:
                break
            total = ntri()
            m = ob.modifiers.new("dec", "DECIMATE")
            m.decimate_type = "COLLAPSE"
            m.ratio = max(0.01, (total - (have - want)) / total)
            m.use_symmetry = True
            m.symmetry_axis = "X"
            m.vertex_group = "dec_" + r
            m.vertex_group_factor = 1.0
            m.use_collapse_triangulate = False
            bpy.ops.object.modifier_apply(modifier=m.name)
            me = ob.data
    me = ob.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    T = Topo()
    T.lod = lod
    T.co = np.array([G(v.co) for v in me.vertices])
    T.faces = [tuple(p.vertices) for p in me.polygons]
    T.loop_uv = np.array([l.uv[:] for l in me.uv_layers["UVMap"].data])
    fi = np.zeros(len(me.polygons), np.int32)
    me.attributes["island"].data.foreach_get("value", fi)
    T.face_island = np.array([names[i] for i in fi])
    T.loop_start = np.array([p.loop_start for p in me.polygons])

    def vlabel(kind):
        idx = {g.index: g.name[len(kind) + 1:] for g in ob.vertex_groups if g.name.startswith(kind + "_")}
        out = []
        for v in me.vertices:
            best, bn = -1.0, ""
            for g in v.groups:
                if g.group in idx and g.weight > best:
                    best, bn = g.weight, idx[g.group]
            out.append(bn)
        return np.array(out)
    T.region = vlabel("reg")
    T.group = vlabel("grp")
    T.part = np.where(T.group == "jaw", "head", T.group)
    # bind every vertex to the base mesh's triangles of its own group (lips to their own lip, a finger to its own)
    btris, bsrc = b.tris()
    tgroup = np.array([group[t] for t in btris[:, 0]])
    tg2 = np.array([[group[v] for v in t] for t in btris])
    pairs = []
    for gname in sorted(set(T.group)):
        pm = T.group == gname
        tm = (tg2 == gname).sum(1) >= 2
        if not tm.any():
            tm = tgroup == gname
        pairs.append((pm, tm))
    T.binding = mh.Binding.fit(T.co, P0, btris, pairs)
    err = np.linalg.norm(T.binding.eval(P0) - T.co, axis=1).max()
    flips0 = _uv_flips(T)
    T.loop_uv = reproject_uv(T, b, P0, isl_of_base=island_ids())
    print("[people2] LOD%d UVs read again from MakeHuman's: %d flipped triangles before, %d after" % (
        lod, flips0, _uv_flips(T)))
    T.tris = sum(len(f) - 2 for f in T.faces)
    print("[people2] MakeHuman topology LOD%d: %d triangles, %d vertices, binding error %.2e m, regions %s" % (
        lod, T.tris, len(T.co), err, region_tris()))
    bpy.data.objects.remove(ob)
    _TOPO[lod] = T
    return T


# ---------------------------------------------------------------- weights: MakeHuman's, then the kit's rules

def finger_rule(Wv, co, J, body):
    """Sharper finger weights (as weights.finger_rule did for the cage bodies): MakeHuman's own blend runs over a
    whole finger segment, and a fist (90 to 100 degrees at each joint) then collapses each knuckle's inside into a
    spike. A finger vertex takes its weights from where it sits along its finger: one bone along each segment, a
    3.5 mm blend at each joint (9 mm at the thumb's root, which leaves the palm's side). The little finger has no
    bones of its own: its points follow the ring finger's bones but blend at its own joints (MakeHuman's
    joint-*-finger-5-* cubes)."""
    ix = {n: i for i, n in enumerate(rig.NAMES)}
    W = Wv.copy()
    half = 0.0035

    def sm(a, b, x):
        t = min(1.0, max(0.0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    for S, s in (("L", "l"), ("R", "r")):
        chains = {}
        for f in ("thumb", "index", "middle", "ring"):
            chains[f] = (f, [np.asarray(J[f + "1" + S][0]), np.asarray(J[f + "2" + S][0]),
                             np.asarray(J[f + "3" + S][0]), np.asarray(J[f + "3" + S][1])])
        chains["little"] = ("ring", [body.b.cube(body.Pf, "%s-finger-5-%d" % (s, k)) for k in range(1, 5)])
        bones = {f: [ix["hand" + S]] + [ix["%s%d%s" % (f, k, S)] for k in (1, 2, 3)]
                 for f in ("thumb", "index", "middle", "ring")}
        fing = [i for f in bones for i in bones[f][1:]]
        on = W[:, fing].sum(1) > 0.5
        for i in np.nonzero(on)[0]:
            p = co[i]
            # which finger: the nearest chain (the ring finger's weights cover the little finger too)
            best = None
            for name, (bf, pts) in chains.items():
                for k in range(3):
                    a, c = pts[k], pts[k + 1]
                    d = c - a
                    t = float(np.clip(np.dot(p - a, d) / np.dot(d, d), -0.6 if k == 0 else 0.0,
                                      1.0 if k < 2 else 1.6))
                    dist = float(np.linalg.norm(a + d * t - p))
                    if best is None or dist < best[0]:
                        best = (dist, name, bf, k, t, float(np.linalg.norm(d)))
            dist, name, bf, k, t, L = best
            names = bones[bf]
            hb = 0.009 if name == "thumb" else half
            s_ = t * L
            if k == 0 and s_ < 0:
                u = sm(-hb, hb, s_)
                w = {names[0]: 1 - u, names[1]: u}
            else:
                u = sm(-(hb if k <= 1 else half), hb if k <= 1 else half, s_)
                w = {names[k]: 1 - u, names[k + 1]: u}
                if k < 2:
                    v = sm(-half, half, s_ - L)
                    if v > 0:
                        w = {names[k + 1]: 1 - v, names[k + 2]: v}
            W[i] = 0.0
            for b_, wv in w.items():
                W[i, b_] += wv
    return W


def knee_rule(Wv, co, J):
    """The knee's blend from the thigh to the shin (#82: MakeHuman's blend kept 42% of the knee's section at a 120
    degree bend, preview.bend_measure; the target is 45-60%): a smooth blend 5.5 cm either way along the leg's axis,
    its middle 2.5 cm below the joint on the kneecap's side (the kneecap's skin rides with the thigh and keeps the
    knee's round when it bends) and 2.5 cm above it in the hollow behind (where the skin folds). At 120 degrees:
    man_middling 46%, woman_middling 55% (a shorter blend kept more but folded a fin at the woman's knee).
    Only the thigh's and the shin's shares are moved; their sum and every other bone's weight stay."""
    ix = {n: i for i, n in enumerate(rig.NAMES)}
    W = Wv.copy()
    hw, shift = 0.055, 0.025
    for S in "LR":
        up, low = ix["legUp" + S], ix["legLow" + S]
        knee = np.asarray(J["legLow" + S][0], float)
        axis = np.asarray(J["legLow" + S][1], float) - knee
        axis /= np.linalg.norm(axis)
        tot = W[:, up] + W[:, low]
        d = co - knee
        s = d @ axis
        perp = d - np.outer(s, axis)
        pl = np.linalg.norm(perp, axis=1)
        front = np.where(pl > 1e-6, perp[:, 2] / np.maximum(pl, 1e-6), 0.0)  # game z: forward
        m = (tot > 0.5) & (np.abs(s) < 0.12) & (pl < 0.12)
        t = np.clip((s - shift * front + hw) / (2 * hw), 0, 1)
        t = t * t * (3 - 2 * t)
        W[m, up] = (tot * (1 - t))[m]
        W[m, low] = (tot * t)[m]
    return W


def shoulder_rule(Wv, co, J):
    """The kit's shoulder helpers (docs/people.md "Shoulder helpers"): the skin round the arm hole, the armpit and the
    deltoid's round hang on shoulderL/R, which turn by half of the arm's swing. MakeHuman's blend from the chest
    (clavicle, upperChest) to the upper arm is split in two halves: chest to helper, helper to arm; the deltoid's
    round near the joint keeps a share on the helper."""
    ix = {n: i for i, n in enumerate(rig.NAMES)}
    W = Wv.copy()
    for S in "LR":
        a = W[:, ix["armUp" + S]]
        c = W[:, ix["clavicle" + S]] + W[:, ix["upperChest"]] + W[:, ix["chest"]]
        sh = J["armUp" + S][0]
        d = np.linalg.norm(co - sh, axis=1)
        near = d < 0.16 * (J["head"][1][1] / 1.67)
        tot = a + c
        m = near & (tot > 1e-6) & (a > 1e-4)
        t = np.where(m, a / np.maximum(tot, 1e-9), 0)
        # (#82) smooth shares (the straight ramps met in kinks at the middle and the ends of the blend, which folded
        # the skin along a line at the front of the armpit with the arm raised far forward)
        def ss(e0, e1, x):
            u = np.clip((x - e0) / (e1 - e0), 0, 1)
            return u * u * (3 - 2 * u)
        chest_new = ss(0.5, 0.0, t) * tot
        arm_new = ss(0.5, 1.0, t) * tot
        helper = tot - chest_new - arm_new
        # the deltoid's round: vertices fully on the arm within 7 cm of the joint keep a share on the helper
        full = near & (t >= 0.5) & (d < 0.07)
        extra = np.where(full, 0.5 * (1 - d / 0.07), 0.0) * arm_new
        helper = helper + extra
        arm_new = arm_new - extra
        scale = np.where(c > 1e-9, chest_new / np.maximum(c, 1e-9), 0.0)
        for n in ("clavicle" + S, "upperChest", "chest"):
            W[m, ix[n]] = W[m, ix[n]] * scale[m]
        W[m, ix["armUp" + S]] = arm_new[m]
        W[m, ix["shoulder" + S]] += helper[m]
    s = W.sum(1, keepdims=True)
    s[s == 0] = 1
    return W / s


# ---------------------------------------------------------------- the meshes

def _uv_and_flags(T):
    """Per loop of the reduced copy: its UV (face islands in the face square, the rest MakeHuman's layout) and the
    face flag (1: the face picture)."""
    uv = T.loop_uv.copy()
    flag = np.zeros(len(uv), np.float32)
    island = np.empty(len(uv), dtype=object)
    for f, face in enumerate(T.faces):
        ls = slice(T.loop_start[f], T.loop_start[f] + len(face))
        isl = T.face_island[f]
        island[ls] = isl
        if isl in FACE_ISLANDS:
            uv[ls] = face_uv(uv[ls], isl)
            flag[ls] = 1.0
    return uv, flag, island


def eyes_asset():
    return mh.MhAsset("system/eyes/low-poly")


def eye_mesh(body, Pf):
    """MakeHuman's low-poly eyes on their helpers: positions, faces (per eye), UVs into EYE_RECT, side per vertex."""
    a = eyes_asset()
    co = a.fit(Pf)
    o = a.obj
    faces, uvs, side = [], [], np.where(co[:, 0] > 0, "L", "R")
    u0, v0, u1, v1 = EYE_RECT
    for f, ft in zip(o["F"], o["FT"]):
        faces.append(tuple(f))
        uvs.append([(u0 + (u1 - u0) * o["VT"][t][0], v0 + (v1 - v0) * o["VT"][t][1]) for t in ft])
    return co, faces, uvs, side


def build_mesh(name, lod, body, J, with_eyes=True):
    """One copy (lod 0 or 1) of a body as a Blender object: positions from the binding, MakeHuman's UVs (face islands
    in the face square), the face flag, part groups, our bones' weights. Returns (object, per-vertex parts)."""
    import bpy
    T = topology(lod)
    Pf = body.Pf
    co = T.binding.eval(Pf)
    faces = list(T.faces)
    uv, flag, island = _uv_and_flags(T)
    loop_uv = [uv[T.loop_start[f]:T.loop_start[f] + len(face)] for f, face in enumerate(faces)]
    loop_flag = [flag[T.loop_start[f]:T.loop_start[f] + len(face)] for f, face in enumerate(faces)]
    loop_isl = [island[T.loop_start[f]] for f in range(len(faces))]
    W = finger_rule(knee_rule(shoulder_rule(T.binding.interp(body.W), co, J), co, J), co, J, body)
    parts = list(T.part)
    n0 = len(co)
    if with_eyes:
        eco, efaces, euvs, eside = eye_mesh(body, Pf)
        co = np.concatenate((co, eco))
        Weye = np.zeros((len(eco), len(rig.NAMES)))
        for i, s in enumerate(eside):
            Weye[i, rig.NAMES.index("eye" + s)] = 1.0
        W = np.concatenate((W, Weye))
        parts += ["eye"] * len(eco)
        for f, u in zip(efaces, euvs):
            faces.append(tuple(v + n0 for v in f))
            loop_uv.append(np.array(u))
            loop_flag.append(np.ones(len(f), np.float32))
            loop_isl.append("eye")
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(B(*p)) for p in co], [], [list(f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.concatenate(loop_uv).ravel())
    fl = np.concatenate(loop_flag)
    attr = me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
    rgba = np.zeros((len(fl), 4), np.float32)
    rgba[:, 1] = fl
    rgba[:, 3] = 1
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    isl_names = ["body", "handL", "handR", "foot", "head", "mouth", "socketL", "socketR", "eye"]
    fa = me.attributes.new("mh_island", "INT", "FACE")
    fa.data.foreach_set("value", np.array([isl_names.index(i) for i in loop_isl], np.int32))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    from . import weights as wt
    for pn in sorted(set(parts)):
        ob.vertex_groups.new(name="part_" + pn).add([i for i, p in enumerate(parts) if p == pn], 1.0, "REPLACE")
    wt.apply(ob, W, limit=4)
    return ob, parts


ISLAND_NAMES = ["body", "handL", "handR", "foot", "head", "mouth", "socketL", "socketR", "eye"]


def body_uv(uv, island, rect, size=1024):
    """MakeHuman's body islands into a picture rectangle (x, y, w, h pixels, v up) of the clothes layer. The whole
    square: MakeHuman's own layout. A dressed kind's half: the trunk and limbs turned on their side, the hands and the
    feet bigger beside them (bare hands are what people see of a dressed body)."""
    uv = np.asarray(uv, float)
    x, y, w, h = rect
    if (w, h) == (size, size) and (x, y) == (0, 0):
        return uv.copy()
    g = 3
    sb = (h - 2 * g) / 0.745
    if island == "body":
        q = np.stack((uv[:, 1] - 0.136, 0.754 - uv[:, 0]), 1) * sb + (x + g, y + g)
        return q / size
    left = x + g + 0.838 * sb + 2 * g
    s2 = min((w - (left - x) - g) / 0.40, (h - 3 * g) / (0.192 + 0.166))
    if island in ("handL", "handR"):
        u0 = 0.355 if island == "handR" else 0.563
        col = 0.0 if island == "handR" else 0.200 * s2 + g
        q = (uv - (u0, 0.008)) * s2 + (left + col, y + g + 0.166 * s2 + g)
        return q / size
    if island == "foot":
        q = (uv - (0.020, 0.008)) * s2 + (left, y + g)
        return q / size
    raise KeyError(island)


# ---------------------------------------------------------------- A's cage, fitted onto the MakeHuman body (for C)

CAGE_GROUPS = {"torso": ("torso",), "neck": ("neck", "torso"), "armL": ("armL",), "armR": ("armR",),
               "legL": ("legL",), "legR": ("legR",)}


def fit_cage(C, body, iters=8):
    """Move A's cage (built from this body's measured landmarks) so its limit surface lies on the MakeHuman body:
    the clothes made from the cage (clothes_kit.from_cage, trousers, upper) then fit this body. The head and the
    fingers are left (hats fit the real head; nothing is made from the cage's fingers)."""
    import bmesh
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    # Nearest-surface iteration collapses this slender cage's arm rings and folds its
    # shoulders inside out. Keep the measured cage; garment fitting still uses the
    # actual skin surface, including the old woman's round sleeve reconstruction.
    if body.base == "old_woman":
        iters = 0
    b, P0 = body.b, body.P0
    btris, _ = b.tris()
    tpart = body.parts[btris[:, 0]]
    bvh = {}
    for g, src in CAGE_GROUPS.items():
        sub = btris[np.isin(tpart, src)]
        used = np.unique(sub)
        remap = -np.ones(mh.NV, np.int64)
        remap[used] = np.arange(len(used))
        bvh[g] = BVHTree.FromPolygons([tuple(p) for p in P0[used]], [tuple(t) for t in remap[sub]],
                                      all_triangles=True)
    rest = np.array(C.rest, np.float64)
    n = len(rest)
    # the limit stencil of every cage vertex (lod.to_limit), and its edge neighbours
    bm = bmesh.new()
    vs = [bm.verts.new(tuple(p)) for p in rest]
    bm.verts.ensure_lookup_table()
    for fv in C.faces:
        try:
            bm.faces.new([vs[i] for i in fv])
        except ValueError:
            pass
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    stencil, nbr = [], []
    for v in bm.verts:
        es = [e.other_vert(v).index for e in v.link_edges]
        nbr.append(es)
        ok = len(es) >= 3 and all(len(e.link_faces) == 2 for e in v.link_edges) and \
            all(len(f.verts) == 4 for f in v.link_faces)
        if not ok:
            stencil.append(None)
            continue
        fs = []
        for f in v.link_faces:
            ids = [x.index for x in f.verts]
            k = ids.index(v.index)
            fs.append(ids[(k + 2) % 4])
        stencil.append((es, fs))
    bm.free()

    def limit(X):
        L = X.copy()
        for i, st in enumerate(stencil):
            if st is None:
                continue
            es, fs = st
            k = len(es)
            L[i] = (k * k * X[i] + 4 * X[es].sum(0) + X[fs].sum(0)) / (k * (k + 5))
        return L
    move = np.array([p in CAGE_GROUPS for p in C.part])
    for _ in range(iters):
        L = limit(rest)
        D = np.zeros_like(rest)
        for i in np.nonzero(move)[0]:
            loc, nrm, fi, dist = bvh[C.part[i]].find_nearest(Vector(L[i]))
            if loc is not None:
                D[i] = np.array(loc) - L[i]
        for _s in range(2):
            Dn = D.copy()
            for i in np.nonzero(move)[0]:
                nb = [j for j in nbr[i] if move[j]]
                if nb:
                    Dn[i] = 0.5 * D[i] + 0.5 * D[nb].mean(0)
            D = Dn
        rest[move] += D[move]
    L = limit(rest)
    err = []
    for i in np.nonzero(move)[0]:
        loc, nrm, fi, dist = bvh[C.part[i]].find_nearest(Vector(L[i]))
        err.append(dist)
    C.rest = [tuple(p) for p in rest]
    fn = body.stoop or (lambda p, part: p)
    C.co = [tuple(fn(tuple(p), part)) for p, part in zip(C.rest, C.part)]
    return float(np.mean(err)), float(np.max(err))


# ---------------------------------------------------------------- the docker's hands (a shape key)

def hard_offsets(co, parts, J, amount=1.0):
    """hands_hard: fingers a fifth thicker, bigger knuckles, a broader thicker palm (docs/people.md "Hands")."""
    out = np.zeros_like(co)
    for S in "LR":
        for fname in ("thumb", "index", "middle", "ring", "little"):
            m = np.array([p == "finger_" + fname + S for p in parts])
            if not m.any():
                continue
            bones = [(fname if fname != "little" else "ring") + str(k) + S for k in (1, 2, 3)]
            segs = [J[bn] for bn in bones]
            P = co[m]
            best = np.full(len(P), 1e9)
            foot = np.zeros_like(P)
            for a, bb in segs:
                ab = bb - a
                t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
                q = a + t[:, None] * ab
                d = np.linalg.norm(P - q, axis=1)
                upd = d < best
                best[upd] = d[upd]
                foot[upd] = q[upd]
            if fname == "little":  # the little finger has no bones: its own axis from its points
                c = P.mean(0)
                foot = c + ((P - c) @ np.array((0, 1.0, 0)))[:, None] * np.array((0, 1.0, 0))
            out[m] = (P - foot) * 0.20 * amount
        hand = np.array([p == "arm" + S for p in parts]) & (co[:, 1] < J["hand" + S][0][1])
        if hand.any():
            c = J["hand" + S][0] + (J["hand" + S][1] - J["hand" + S][0]) * 0.5
            d = co[hand] - c
            d[:, 1] = 0
            out[hand] = d * 0.12 * amount
    return out


# ---------------------------------------------------------------- one body, as the kit wants it

_BODY_CACHE = {}


def get_body(base, build):
    key = (base, build)
    if key not in _BODY_CACHE:
        _BODY_CACHE[key] = Body(base, build)
    return _BODY_CACHE[key]


def slider_keys(body):
    """{key: move in the body's rest space} of every slider (cached per body)."""
    if not hasattr(body, "_keys"):
        from . import sliders
        body._keys = sliders.keys(body)
        body._body_keys = set(sliders.keys_of_group("body"))
    return body._keys


def add_keys(ob, lod, body, keys, with_eyes=True):
    """Shape keys on a copy: every key's move carried by the copy's binding (and the eyes' MakeHuman fitting)."""
    T = topology(lod)
    base_pos = T.binding.eval(body.Pf)
    eyes = eyes_asset() if with_eyes else None
    eye0 = eyes.fit(body.Pf) if eyes else None
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    n = len(ob.data.vertices)
    co0 = np.array([v.co[:] for v in ob.data.vertices])
    for kn, Dm in keys.items():
        d = T.binding.eval(body.Pf + Dm) - base_pos
        if eyes is not None:
            d = np.concatenate((d, eyes.fit(body.Pf + Dm) - eye0))
        assert len(d) == n, (len(d), n)
        sk = ob.shape_key_add(name=kn, from_mix=False)
        sk.value = 0.0  # (Blender 5 starts a new key at full)
        sk.data.foreach_set("co", (co0 + np.stack((d[:, 0], -d[:, 2], d[:, 1]), 1)).ravel())


def make_body(name, base, build, ref_uv=None, style=None, pieces=False):
    """One body (near and far copies, eyes, weights, armature, the sliders as shape keys) under `name`: a base body,
    or a kind's own copy of one. pieces: also every hair, beard and moustache piece the base can wear (base bodies:
    the game puts a person's own pieces on). Returns (dict, ref_uv) like the old cage bodies."""
    import bpy
    from . import lod as lodm
    from . import mhhair
    from . import weights as wt
    body = get_body(base, build)
    P = body.params
    J = body.joints()
    P["joints"] = J
    P["marks"] = marks(body, J)
    lod0, parts0 = build_mesh(name + "_lod0", 0, body, J)
    lod1, parts1 = build_mesh(name + "_lod1", 1, body, J)
    keys = slider_keys(body)
    add_keys(lod0, 0, body, keys)
    add_keys(lod1, 1, body, {k: v for k, v in keys.items() if k in body._body_keys})
    co0 = np.array([G(v.co) for v in lod0.data.vertices])
    off = hard_offsets(co0, parts0, J)
    sk = lod0.shape_key_add(name="hands_hard", from_mix=False)
    sk.value = 0.0
    sk.data.foreach_set("co", np.array([v.co[:] for v in lod0.data.vertices]).ravel() +
                        np.array([B(*d)[:] for d in off]).ravel())
    ao = rig.build_armature(name, J)
    obs = [lod0, lod1]
    made = []
    if pieces:
        hairs, beards, mous = mhhair.styles_for(base)
        for kind, styles in (("hair", hairs), ("beard", beards), ("mous", mous)):
            for st in styles:
                for lod in (0, 1):
                    ks = keys if lod == 0 else {k: v for k, v in keys.items() if k in body._body_keys}
                    ob = hair_mesh("%s_%s_%s_lod%d" % (name, kind, st, lod), body, kind, st, lod, ks)
                    obs.append(ob)
                    made.append(ob)
    for ob in obs:
        ob.parent = ao
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = ao
    ao["people2"] = {"base": base, "build": build, "height": round(P["H"], 3), "female": P["female"],
                     "scaleToOld": round(float(J["hips"][0][1]) / 0.95, 4), "source": "MakeHuman CC0 base mesh"}
    C = bd.build(P)
    fit_err = fit_cage(C, body)
    zs = [v.co.z for v in lod0.data.vertices]
    counts = {"lod0": lodm.tris(lod0), "lod1": lodm.tris(lod1), "bones": len(ao.data.bones),
              "top": round(max(zs), 3), "bottom": round(min(zs), 3), "cageFitMm": [round(e * 1000, 1) for e in fit_err]}
    bpy.context.view_layer.update()
    vparts = wt.parts(lod0)
    try:
        counts["girths"] = {k: round(v, 3) for k, v in bd.girths(lod0, P, vparts).items()}
    except Exception as e:  # noqa: BLE001 (a measure, never a reason to stop the build)
        counts["girths"] = {"error": str(e)}
    counts["pieces"] = {ob.name[len(name) + 1:]: lodm.tris(ob) for ob in made}
    return dict(name=name, P=P, C=C, ao=ao, lod0=lod0, lod1=lod1, J=J, counts=counts, vparts=vparts,
                cparts=wt.parts(lod1), mhbody=body, hair_pieces=made), ref_uv


# ---------------------------------------------------------------- hair pieces (mhhair), bound like the skin

_HEADS = {}


def hair_mesh(name, body, kind, style, lod, keys=None):
    """A hair, beard or moustache piece as a Blender object in the body's rest space: UVs in the face picture's hair
    swatches (face flag set, occlusion in blue, the fade in alpha), weights from the skin under it (a girl's plaits
    hanging below the head: the neck's and chest's), the sliders as shape keys (keys: {name: move}, LOD0)."""
    import bpy
    from . import mhhair
    from . import weights as wt
    key = (body.base, body.build, lod)
    if key not in _HEADS:
        _HEADS[key] = mhhair.Head(body, lod)
    head = _HEADS[key]
    co, faces, uv, col = mhhair.piece(head, kind, style, lod, "f" if body.params["female"] else "m")
    b = body.b
    btris, _ = b.tris()
    hd = np.isin(body.parts[btris], ("head",)).all(1)
    bind = mh.Binding.fit(co, body.Pf, btris[hd])
    W = mhhair.hang_weights(co, bind.interp(body.W), body)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(B(*p)) for p in co], [], [list(int(i) for i in f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    loops = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", loops)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.asarray(uv, np.float32)[loops].ravel())
    # picture_flags: green the face picture, blue the piece's occlusion, alpha its fade (docs/people.md "Hair")
    attr = me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
    rgba = np.asarray(col, np.float32)[loops]
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.vertex_groups.new(name="part_hair").add(list(range(len(co))), 1.0, "REPLACE")
    wt.apply(ob, W, limit=4)
    if keys:
        ob.shape_key_add(name="Basis", from_mix=False)
        base_pos = bind.eval(body.Pf)
        for kn, Dm in keys.items():
            d = bind.eval(body.Pf + Dm) - base_pos
            if np.abs(d).max() < 2e-5:  # a slider that does not move this piece: no key (the game adds nothing)
                continue
            sk = ob.shape_key_add(name=kn, from_mix=False)
            sk.value = 0.0
            sk.data.foreach_set("co", np.array([tuple(B(*p)) for p in (co + d)]).ravel())
    return ob


# ---------------------------------------------------------------- grab marks, measured on the body

MARK_SPOTS = {  # mark: (bone, part, direction from the trunk's axis, height as a body fraction)
    "nape": ("neck", "neck", (0, 0, -1.0), 0.875),
    "collarBack": ("upperChest", "torso", (0, 0, -1.0), 0.835),
    "collarFront": ("upperChest", "torso", (0, 0, 1.0), 0.79),
    "throat": ("neck", "neck", (0, 0, 1.0), 0.855),
    "chest": ("chest", "torso", (0, 0, 1.0), 0.73),
    "belly": ("spine", "torso", (0, 0, 1.0), 0.615),
    "kidneyL": ("spine", "torso", (0.6, 0, -1.0), 0.64),
    "kidneyR": ("spine", "torso", (-0.6, 0, -1.0), 0.64),
    "beltBack": ("hips", "torso", (0, 0, -1.0), 0.60),
}


def marks(body, J):
    """Grab and hit marks (rig.MARKS) on this body's skin at rest (measured before the stoop, then stooped)."""
    from . import body as bd_
    P = body.params
    out = {}
    for n, (bone, part, d, frac) in MARK_SPOTS.items():
        out[n] = (body.surface_point(np.array(d), bd_.Y(P, frac), part), bone, part)
    b = body.b
    mouth = b.cube(body.P0, "mouth")
    bodyv = body.P0[b.body]
    front = bodyv[(np.abs(bodyv[:, 0]) < 0.004)]
    lips = front[np.abs(front[:, 1] - mouth[1]) < 0.012]
    out["mouth"] = (lips[np.argmax(lips[:, 2])], "head", "head")
    crown = bodyv[np.argmax(bodyv[:, 1])]
    out["hair"] = (crown + np.array((0, -0.03, -0.06)), "head", "head")
    up = lambda S: J  # noqa: E731
    for S, s in (("L", "l"), ("R", "r")):
        sh, el, wr = b.cube(body.P0, s + "-shoulder"), b.cube(body.P0, s + "-elbow"), b.cube(body.P0, s + "-hand")
        out["wrist" + S] = (wr + (el - wr) * 0.08, "armLow" + S, "arm")
        out["upperArm" + S] = (sh + (el - sh) * 0.6, "armUp" + S, "arm")
        out["armpit" + S] = (sh + np.array((-0.045 if S == "L" else 0.045, -0.055, 0.0)), "armUp" + S, "arm")
        an = b.cube(body.P0, s + "-ankle")
        out["ankle" + S] = (an + np.array((0, 0.03, 0)), "legLow" + S, "leg" + S)
    res = {}
    for n, (p, bone, part) in out.items():
        if body.stoop is not None:
            p = np.array(body.stoop(tuple(p), part))
        res[n] = (np.array(p), bone)
    return res

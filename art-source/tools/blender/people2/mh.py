"""MakeHuman's CC0 core assets for people2 (docs/makehuman.md, docs/people.md "Bodies from MakeHuman").

The bodies, faces and their sliders start from MakeHuman's base mesh (hm08) and its targets, released CC0 by the
MakeHuman project in 2020. Our copies of the files we use are in art-source/third_party/makehuman/ (with the licence
and SOURCES.json: where each came from and its SHA-256). MPFB 2 (the MakeHuman Blender add-on, GPL code, CC0 data) is a
required authoring tool: the build asks it for the macro target stack (how gender, age, weight, muscle, height and
proportions mix MakeHuman's macro targets) and checks that its copies of the files equal ours. The game never needs
MakeHuman or MPFB: it gets our glb.

Coordinates: MakeHuman's files are in decimetres with y up, z forward and x the person's left, so a MakeHuman point
times 0.1 is a game point (docs/people.md "Axes and units").

What this module does:
- base(): the base mesh (positions, quads, UVs, face groups, the joint cubes and helper groups);
- target(name): a target as a sparse move (indices, moves in metres);
- macro_stack(macro): MPFB's macro target stack for a macro setting; shape(spec): a body's positions;
- weights(): MakeHuman's own CC0 skin weights (MPFB's default rig), summed onto our 64 bones;
- Pose: MakeHuman's A pose turned into our rest pose (arms hanging, palms to the thighs, legs straight, feet
  forward), as one affine per vertex, so every slider's move is turned the same way (pose.vec);
- joints(): our skeleton's joints measured on the posed body (directions stay the kit's: rig.py);
- Binding: the MakeClothes way of fitting a mesh to the body: each vertex on a base-mesh triangle (three vertices,
  three weights) plus an offset, so any body shape and every slider carries it (proxies, our reduced near copy,
  eyes, hair, clothes).
"""

import gzip
import hashlib
import json
import math
import os

import numpy as np

from . import ROOT

THIRD = os.path.join(ROOT, "third_party", "makehuman")
MPFB_MODULE = "bl_ext.user_default.mpfb"
MPFB_VERSION = "2.0.18"
SCALE = 0.1  # MakeHuman decimetres to metres
NV = 19158  # hm08 vertices (body 13,380, helpers, joint cubes)


# ---------------------------------------------------------------- MPFB (required authoring tool)

def ensure_mpfb():
    """Enable MPFB in this Blender (installed the isolated way: docs/makehuman.md). Returns its package."""
    import importlib

    import addon_utils
    import bpy
    if bpy.app.version < (4, 2, 0):
        raise RuntimeError("MPFB needs Blender 4.2 or newer")
    if not addon_utils.check(MPFB_MODULE)[1]:
        if MPFB_MODULE not in {m.__name__ for m in addon_utils.modules()}:
            raise RuntimeError(
                "MPFB %s is a required authoring tool for people2 and is not installed in this Blender. Install it the "
                "isolated way (docs/makehuman.md): set BLENDER_USER_RESOURCES to .scratch/blender-user and run "
                "blender -b --command extension install-file -r user_default --enable add-on-mpfb-v%s.zip"
                % (MPFB_VERSION, MPFB_VERSION))
        # default_set: MPFB reads its own preferences while it registers (a factory start has none)
        addon_utils.enable(MPFB_MODULE, default_set=True, handle_error=None)
    return importlib.import_module(MPFB_MODULE)


def mpfb_service(name):
    import importlib
    ensure_mpfb()
    return importlib.import_module(MPFB_MODULE + ".services." + name.lower())


def mpfb_data(rel=""):
    svc = mpfb_service("locationservice").LocationService
    return svc.get_mpfb_data(rel) if rel else svc.get_mpfb_data()


# ---------------------------------------------------------------- files

_USED = set()


def write_used(out):
    """The MakeHuman files this build read (relative to THIRD), sorted: what third_party/makehuman must keep."""
    with open(out, "w", encoding="utf-8") as f:
        json.dump(sorted(_USED), f, indent=1)


def check_mpfb_copies():
    """Our copies of MakeHuman's base files (base/...) against MPFB's own data (the same CC0 files): (how many were
    compared, the ones that differ or MPFB lacks). The system/ files come from MakeHuman's asset pack, not MPFB."""
    data = mpfb_data()
    remap = {"base/rigs/rig.default.json": "rigs/standard/rig.default.json",
             "base/rigs/weights.default.json": "rigs/standard/weights.default.json"}
    checked, differ = 0, []
    for rel in sorted(_USED):
        if not rel.startswith("base/"):
            continue
        theirs = os.path.join(data, remap.get(rel, rel[len("base/"):]))
        if not os.path.exists(theirs):
            differ.append(rel + " (not in MPFB)")
            continue
        checked += 1
        if sha256(os.path.join(THIRD, rel)) != sha256(theirs):
            differ.append(rel)
    return checked, differ


def path(rel):
    _USED.add(rel.replace("\\", "/"))
    p = os.path.join(THIRD, rel)
    if not os.path.exists(p):
        raise FileNotFoundError("MakeHuman asset missing from art-source/third_party/makehuman: %s" % rel)
    return p


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_obj(p):
    """A Wavefront file as it is (no MakeHuman code): v, vt, faces with their vt and their group."""
    V, VT, F, FT, G, groups = [], [], [], [], [], []
    group = None
    op = gzip.open if p.endswith(".gz") else open
    with op(p, "rt", encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            if ln.startswith("v "):
                V.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith("vt "):
                VT.append([float(x) for x in ln.split()[1:3]])
            elif ln.startswith("g "):
                group = ln.split(None, 1)[1].strip()
                if group not in groups:
                    groups.append(group)
            elif ln.startswith("f "):
                vs, ts = [], []
                for tok in ln.split()[1:]:
                    a = tok.split("/")
                    vs.append(int(a[0]) - 1)
                    ts.append(int(a[1]) - 1 if len(a) > 1 and a[1] else -1)
                F.append(tuple(vs))
                FT.append(tuple(ts))
                G.append(groups.index(group) if group in groups else -1)
    return dict(V=np.array(V, np.float64), VT=np.array(VT, np.float64), F=F, FT=FT, G=np.array(G), groups=groups)


class Base:
    """hm08: positions (metres, game axes), the quads, the UVs, the face groups and the vertex sets."""

    def __init__(self, p):
        o = read_obj(p)
        self.V = o["V"] * SCALE
        self.VT = o["VT"]
        self.F = o["F"]
        self.FT = o["FT"]
        self.groups = o["groups"]
        self.fgroup = np.array([o["groups"][g] for g in o["G"]])
        self.vsets = {}
        for f, g in zip(self.F, self.fgroup):
            self.vsets.setdefault(g, set()).update(f)
        self.vsets = {k: np.array(sorted(v)) for k, v in self.vsets.items()}
        self.body_faces = np.nonzero(self.fgroup == "body")[0]
        self.body = self.vsets["body"]
        assert len(self.V) == NV, len(self.V)

    def cube(self, V, name):
        """A joint cube's centre (game axes) in positions V."""
        return V[self.vsets["joint-" + name]].mean(0)

    def tris(self, faces=None):
        """Triangles (fan) of the given faces (default: the body), with the face each came from."""
        faces = self.body_faces if faces is None else faces
        T, src = [], []
        for fi in faces:
            f = self.F[fi]
            for k in range(1, len(f) - 1):
                T.append((f[0], f[k], f[k + 1]))
                src.append(fi)
        return np.array(T, np.int64), np.array(src, np.int64)


_BASE = None


def base():
    global _BASE
    if _BASE is None:
        _BASE = Base(path("base/3dobjs/base.obj"))
    return _BASE


_TARGETS = {}


def target(name):
    """A target (e.g. 'nose/nose-scale-horiz-incr' or 'macrodetails/universal-male-young-averagemuscle-averageweight')
    as (indices, moves in metres, game axes)."""
    if name not in _TARGETS:
        p = path("base/targets/" + name + ".target.gz")
        idx, d = [], []
        with gzip.open(p, "rt", encoding="utf-8", errors="replace") as fh:
            for ln in fh:
                ln = ln.strip()
                if not ln or ln.startswith("#"):
                    continue
                a = ln.split()
                idx.append(int(a[0]))
                d.append((float(a[1]), float(a[2]), float(a[3])))
        _TARGETS[name] = (np.array(idx, np.int64), np.array(d, np.float64).reshape(-1, 3) * SCALE)
    return _TARGETS[name]


def dense(name, w=1.0):
    i, d = target(name)
    out = np.zeros((NV, 3))
    out[i] = d * w
    return out


# ---------------------------------------------------------------- the macro settings (MakeHuman's own mix, via MPFB)

def mh_age(years):
    """MakeHuman's age slider for an age in years (1 year 0, 11 years 0.1875, 25 years 0.5, 90 years 1)."""
    if years < 11:
        return max(0.0, (years - 1) / 10.0 * 0.1875)
    if years < 25:
        return 0.1875 + (years - 11) / 14.0 * 0.3125
    return min(1.0, 0.5 + (years - 25) / 65.0 * 0.5)


def macro(gender, years, weight=0.5, muscle=0.5, height=0.5, proportions=0.5, cupsize=0.5, firmness=0.5,
          race=None):
    r = race or {"caucasian": 1.0, "african": 0.0, "asian": 0.0}
    return {"gender": gender, "age": mh_age(years), "muscle": muscle, "weight": weight, "proportions": proportions,
            "height": height, "cupsize": cupsize, "firmness": firmness,
            "race": {"asian": r.get("asian", 0.0), "caucasian": r.get("caucasian", 0.0),
                     "african": r.get("african", 0.0)}}


def macro_stack(mac):
    """[(target name, weight)] MakeHuman's macro targets for a macro setting, as MPFB computes them."""
    ts = mpfb_service("targetservice").TargetService
    return [(str(n), float(w)) for n, w in ts.calculate_target_stack_from_macro_info_dict(mac)]


def macro_move(mac):
    D = np.zeros((NV, 3))
    for n, w in macro_stack(mac):
        i, d = target(n)
        D[i] += d * w
    return D


# ---------------------------------------------------------------- weights (MakeHuman's CC0 default rig weights)

def _default_rig():
    with open(path("base/rigs/rig.default.json"), encoding="utf-8") as f:
        return json.load(f)


def mh_to_ours(bone, parents):
    """Our bone for one of MakeHuman's default rig bones."""
    def under(b, anc):
        while b:
            if b == anc:
                return True
            b = parents.get(b)
        return False
    S = "L" if bone.endswith(".L") else "R" if bone.endswith(".R") else ""
    b = bone[:-2] if S else bone
    if b in ("root", "pelvis", "spine05"):
        return "hips"
    if b in ("spine04", "spine03"):
        return "spine"
    if b in ("spine02", "breast"):
        return "chest"
    if b == "spine01":
        return "upperChest"
    if b.startswith("neck"):
        return "neck"
    if b == "eye":
        return "eye" + S
    if under(bone, "jaw"):
        return "jaw"
    if b == "clavicle" or b == "shoulder01":
        return "clavicle" + S
    if b.startswith("upperarm"):
        return "armUp" + S
    if b == "lowerarm01":
        return "armLow" + S
    if b == "lowerarm02":
        return "armTwist" + S
    if b in ("wrist",) or b.startswith("metacarpal"):
        return "hand" + S
    if b.startswith("finger"):
        n, k = b[6:].split("-")
        f = {"1": "thumb", "2": "index", "3": "middle", "4": "ring", "5": "ring"}[n]
        return "%s%s%s" % (f, k, S)
    if b.startswith("upperleg"):
        return "legUp" + S
    if b.startswith("lowerleg"):
        return "legLow" + S
    if b == "foot":
        return "foot" + S
    if b.startswith("toe"):
        return "toe" + S
    if under(bone, "head") or b == "head":
        return "head"
    raise KeyError(bone)


_W = None


def weights():
    """(NV, 64) skin weights of every base-mesh vertex on our bones: MakeHuman's default rig weights (CC0) summed
    per our bone (rig.NAMES order), normalised. The forearm's second half is armTwist's (the kit's twist rule then
    shares it: weights.py)."""
    global _W
    if _W is None:
        from .rig import NAMES
        idx = {n: i for i, n in enumerate(NAMES)}
        rig = _default_rig()
        parents = {k: v.get("parent") for k, v in rig.items()}
        with open(path("base/rigs/weights.default.json"), encoding="utf-8") as f:
            wj = json.load(f)["weights"]
        W = np.zeros((NV, len(NAMES)))
        for bone, pairs in wj.items():
            ours = mh_to_ours(bone, parents)
            if not pairs:
                continue
            a = np.array(pairs, np.float64).reshape(-1, 2)
            np.add.at(W[:, idx[ours]], a[:, 0].astype(int), a[:, 1])
        s = W.sum(1, keepdims=True)
        s[s == 0] = 1
        _W = W / s
    return _W


# ---------------------------------------------------------------- posing MakeHuman's A pose into our rest pose

def rot_between(a, b):
    """The smallest turn taking direction a to direction b (3x3)."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    s = np.linalg.norm(v)
    if s < 1e-12:
        if c > 0:
            return np.eye(3)
        p = np.array((1.0, 0, 0)) if abs(a[0]) < 0.9 else np.array((0, 0, 1.0))
        v = np.cross(a, p)
        v /= np.linalg.norm(v)
        return axis_angle(v, math.pi)
    k = v / s
    return axis_angle(k, math.atan2(s, c))


def axis_angle(k, ang):
    k = np.asarray(k, float)
    k = k / np.linalg.norm(k)
    K = np.array(((0, -k[2], k[1]), (k[2], 0, -k[0]), (-k[1], k[0], 0)))
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * (K @ K)


class Pose:
    """MakeHuman's A pose to our rest pose: per bone a rigid move (R, t: x -> R x + t), blended per vertex by the
    weights (linear blend), the forearm's turn shared from the elbow to the wrist. Fixed for one body: every slider's
    move turns by the same per-vertex matrix (vec), so the posed sliders stay linear."""

    def __init__(self, V, W, b=None):
        from .rig import NAMES
        self.b = b = b or base()
        self.names = NAMES
        self.ix = {n: i for i, n in enumerate(NAMES)}
        J = {k[6:]: b.cube(V, k[6:]) for k in b.vsets if k.startswith("joint-")}
        self.J0 = J
        M = {n: (np.eye(3), np.zeros(3)) for n in NAMES}
        down = np.array((0, -1.0, 0))
        fwd = np.array((0, 0, 1.0))

        def chain(names, R, pivot):
            for n in names:
                M[n] = (R, pivot - R @ pivot)

        def compose(A, Bm):
            # x -> A(B(x))
            return (A[0] @ Bm[0], A[0] @ Bm[1] + A[1])
        self.twist = {}
        for S, s in (("L", "l"), ("R", "r")):
            sh, el, wr = J[s + "-shoulder"], J[s + "-elbow"], J[s + "-hand"]
            mid = J[s + "-finger-3-1"]
            R1 = rot_between(el - sh, down)
            T1 = (R1, sh - R1 @ sh)
            el1, wr1, mid1 = R1 @ el + T1[1], R1 @ wr + T1[1], R1 @ mid + T1[1]
            R2 = rot_between(wr1 - el1, down)
            T2 = compose((R2, el1 - R2 @ el1), T1)
            wr2 = T2[0] @ wr + T2[1]
            mid2 = T2[0] @ mid + T2[1]
            R3 = rot_between(mid2 - wr2, down)
            T3 = compose((R3, wr2 - R3 @ wr2), T2)
            # the palm to the thigh: the hand's plane (index and little knuckles, the wrist) faces the body's middle
            ix, lt = T3[0] @ J[s + "-finger-2-1"] + T3[1], T3[0] @ J[s + "-finger-5-1"] + T3[1]
            across = ix - lt  # little finger to index: wants to point forward (+z)
            across[1] = 0
            ang = math.atan2(across[0], across[2])  # turn about the vertical taking it to +z
            self.twist[S] = (ang, wr2.copy(), el1.copy())
            T4 = T3  # the turn about the vertical (the palm to the thigh) is shared down the forearm: per_vertex
            for n in ("armUp", "shoulder"):
                M[n + S] = T1
            M["armLow" + S] = T2
            M["armTwist" + S] = T2
            hand = ["hand" + S] + [f + str(k) + S for f in ("thumb", "index", "middle", "ring") for k in (1, 2, 3)]
            for n in hand:
                M[n] = T4
            M["grip" + S] = T4
            # legs: thigh and shin straight down, the foot flat and pointing forward
            hp, kn, an = J[s + "-upper-leg"], J[s + "-knee"], J[s + "-ankle"]
            L1 = rot_between(kn - hp, down)
            U1 = (L1, hp - L1 @ hp)
            kn1, an1 = L1 @ kn + U1[1], L1 @ an + U1[1]
            L2 = rot_between(an1 - kn1, down)
            U2 = compose((L2, kn1 - L2 @ kn1), U1)
            an2 = U2[0] @ an + U2[1]
            # the foot keeps its own orientation (undo the leg's turns), then turns about the vertical to point ahead
            toes = np.mean([J["%s-toe-%d-1" % (s, k)] for k in range(1, 6)], 0)
            Rf = U2[0].T
            U3 = compose((Rf, an2 - Rf @ an2), U2)
            t3 = U3[0] @ toes + U3[1]
            d = t3 - an2
            d[1] = 0
            Ry = rot_between(d, fwd)
            U4 = compose((Ry, an2 - Ry @ an2), U3)
            M["legUp" + S] = U1
            M["legLow" + S] = U2
            M["foot" + S] = U4
            M["toe" + S] = U4
        self.M = M
        self.W = W
        # the forearm's turn about its own axis is shared along it (no wrung wrist): vertices of armLow/armTwist/hand
        # get the hand's twist in proportion to how far down the forearm they are
        self.per_vertex(V)

    def per_vertex(self, V):
        W = self.W
        R = np.zeros((len(V), 3, 3))
        t = np.zeros((len(V), 3))
        for n, (Rb, tb) in self.M.items():
            w = W[:, self.ix[n]]
            m = w > 0
            if not m.any():
                continue
            R[m] += w[m, None, None] * Rb
            t[m] += w[m, None] * tb
        # the twist: the hand gets all of the turn about the (now vertical) forearm, the forearm a share growing
        # from the elbow to the wrist (no wrung wrist)
        for S in "LR":
            ang, wr2, el1 = self.twist[S]
            ia = [self.ix[n] for n in ("armLow" + S, "armTwist" + S)]
            ih = [self.ix[n] for n in ["hand" + S] + [f + str(k) + S for f in ("thumb", "index", "middle", "ring")
                                                       for k in (1, 2, 3)]]
            fw = W[:, ia].sum(1)
            hw = W[:, ih].sum(1)
            m = (fw + hw) > 0
            if not m.any():
                continue
            P = np.einsum("nij,nj->ni", R[m], V[m]) + t[m]
            s = np.clip((el1[1] - P[:, 1]) / max(el1[1] - wr2[1], 1e-6), 0, 1)
            a = -ang * (hw[m] + fw[m] * s)
            c, sn = np.cos(a), np.sin(a)
            Ry = np.zeros((m.sum(), 3, 3))
            Ry[:, 0, 0] = c
            Ry[:, 0, 2] = sn
            Ry[:, 1, 1] = 1
            Ry[:, 2, 0] = -sn
            Ry[:, 2, 2] = c
            piv = np.array((wr2[0], 0, wr2[2]))  # about the vertical line through the wrist
            R[m] = np.einsum("nij,njk->nik", Ry, R[m])
            t[m] = np.einsum("nij,nj->ni", Ry, t[m] - piv) + piv
        self.R, self.t = R, t

    def pos(self, V):
        return np.einsum("nij,nj->ni", self.R, V) + self.t

    def vec(self, D):
        return np.einsum("nij,nj->ni", self.R, D)


# ---------------------------------------------------------------- the parts of the body (kit names: docs/people.md)

FINGER = {"1": "thumb", "2": "index", "3": "middle", "4": "ring", "5": "little"}
_PARTS = None


def parts(b=None):
    """Per base-mesh vertex the kit's part name (torso, neck, head, armL, legR, finger_indexL, ...), from MakeHuman's
    own default rig weights: the part of the heaviest MakeHuman bone (hands' palms are arms, as in the kit)."""
    global _PARTS
    if _PARTS is not None:
        return _PARTS
    rig = _default_rig()
    parents = {k: v.get("parent") for k, v in rig.items()}
    with open(path("base/rigs/weights.default.json"), encoding="utf-8") as f:
        wj = json.load(f)["weights"]
    best = np.zeros(NV)
    out = np.array(["torso"] * NV, dtype=object)
    for bone, pairs in wj.items():
        if not pairs:
            continue
        ours = mh_to_ours(bone, parents)
        S = "L" if bone.endswith(".L") else "R" if bone.endswith(".R") else ""
        bb = bone[:-2] if S else bone
        if bb.startswith("finger"):
            name = "finger_" + FINGER[bb[6]] + S
        elif ours.startswith("clavicle"):
            name = "torso"
        elif ours.startswith(("armUp", "armLow", "armTwist", "hand")):
            name = "arm" + S
        elif ours.startswith(("legUp", "legLow", "foot", "toe")):
            name = "leg" + S
        elif ours in ("hips", "spine", "chest", "upperChest"):
            name = "torso"
        elif ours == "neck":
            name = "neck"
        elif ours.startswith("eye"):
            name = "eye"
        else:
            name = "head"
        a = np.array(pairs, np.float64).reshape(-1, 2)
        idx = a[:, 0].astype(int)
        m = a[:, 1] > best[idx]
        best[idx[m]] = a[m, 1]
        out[idx[m]] = name
    _PARTS = out
    return out


def regions(b=None, W=None):
    """Finer regions for the near and far copies' triangle budgets: face, scalp, ear, neck, torso, arm, hand, leg,
    foot. Measured on the neutral base mesh (vertex sets, the same for every body)."""
    b = b or base()
    W = weights() if W is None else W
    from .rig import NAMES
    ix = {n: i for i, n in enumerate(NAMES)}
    V = b.V
    pt = parts(b).astype(str)
    reg = np.array(["torso"] * NV, dtype=object)
    hands = [ix[n + s] for s in "LR" for n in ["hand"] + [f + str(k) for f in ("thumb", "index", "middle", "ring")
                                                         for k in (1, 2, 3)]]
    feet = [ix[n + s] for s in "LR" for n in ("foot", "toe")]
    hand = W[:, hands].sum(1)
    foot = W[:, feet].sum(1)
    reg[np.char.startswith(pt, "arm")] = "arm"
    reg[np.char.startswith(pt, "leg")] = "leg"
    reg[hand > 0.5] = "hand"
    reg[np.char.startswith(pt, "finger")] = "hand"
    reg[foot > 0.5] = "foot"
    reg[pt == "neck"] = "neck"
    head = (pt == "head") | (pt == "eye")
    eye = b.cube(V, "l-eye")
    hy = b.cube(V, "head")[1]
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ear = head & (np.abs(x) > 0.058) & (z < eye[2] - 0.055) & (z > eye[2] - 0.135) & (y > hy - 0.035) & \
        (y < hy + 0.055)
    face = head & ~ear & (z > eye[2] - 0.05)
    reg[head] = "scalp"
    reg[face] = "face"
    reg[ear] = "ear"
    return reg


# ---------------------------------------------------------------- binding a mesh to the base mesh (the MakeClothes way)

def frames(V, T):
    """Per triangle: an orthonormal frame (e1, e2, n) and a size (the square root of twice its area)."""
    a, bb, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    e1 = bb - a
    n = np.cross(e1, c - a)
    area2 = np.linalg.norm(n, axis=1)
    n = n / np.maximum(area2, 1e-18)[:, None]
    e1 = e1 / np.maximum(np.linalg.norm(e1, axis=1), 1e-18)[:, None]
    e2 = np.cross(n, e1)
    return e1, e2, n, np.sqrt(np.maximum(area2, 1e-18))


def barycentric(q, a, b, c):
    v0, v1, v2 = b - a, c - a, q - a
    d00, d01, d11 = (v0 * v0).sum(-1), (v0 * v1).sum(-1), (v1 * v1).sum(-1)
    d20, d21 = (v2 * v0).sum(-1), (v2 * v1).sum(-1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-24, 1e-24, den)
    vv = (d11 * d20 - d01 * d21) / den
    ww = (d00 * d21 - d01 * d20) / den
    return np.stack((1 - vv - ww, vv, ww), -1)


class Binding:
    """Each bound vertex sits on a base-mesh triangle (three vertex indices, barycentric weights) plus an offset in
    the triangle's own frame, in units of the triangle's size: it follows any body shape, any slider and any pose of
    the base mesh, as MakeHuman's .mhclo clothes do (theirs keep the offset in scaled world axes)."""

    def __init__(self, T, w, off):
        self.T = np.asarray(T, np.int64)
        self.w = np.asarray(w, np.float64)
        self.off = np.asarray(off, np.float64)

    def __len__(self):
        return len(self.T)

    @staticmethod
    def fit(points, V, tris, groups=None):
        """Bind points (n, 3) to the nearest of the triangles `tris` (m, 3) of positions V. groups: optional list of
        (point mask, triangle mask): each point group binds only to its triangles (an ear to the ear, a finger to
        its finger)."""
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        points = np.asarray(points, np.float64)
        tris = np.asarray(tris, np.int64)
        groups = groups or [(np.ones(len(points), bool), np.ones(len(tris), bool))]
        T = np.zeros((len(points), 3), np.int64)
        Q = np.zeros((len(points), 3))
        done = np.zeros(len(points), bool)
        for pm, tm in groups:
            pm = pm & ~done
            if not pm.any():
                continue
            sub = tris[tm]
            used = np.unique(sub)
            remap = -np.ones(len(V), np.int64)
            remap[used] = np.arange(len(used))
            bvh = BVHTree.FromPolygons([tuple(p) for p in V[used]], [tuple(t) for t in remap[sub]], all_triangles=True)
            for i in np.nonzero(pm)[0]:
                loc, nrm, fi, dist = bvh.find_nearest(Vector(points[i]))
                T[i] = sub[fi]
                Q[i] = loc
            done |= pm
        w = barycentric(Q, V[T[:, 0]], V[T[:, 1]], V[T[:, 2]])
        e1, e2, n, size = frames(V, T)
        d = points - Q
        off = np.stack(((d * e1).sum(1), (d * e2).sum(1), (d * n).sum(1)), 1) / size[:, None]
        return Binding(T, w, off)

    def eval(self, V):
        e1, e2, n, size = frames(V, self.T)
        p = self.w[:, :1] * V[self.T[:, 0]] + self.w[:, 1:2] * V[self.T[:, 1]] + self.w[:, 2:] * V[self.T[:, 2]]
        o = self.off * size[:, None]
        return p + o[:, :1] * e1 + o[:, 1:2] * e2 + o[:, 2:] * n

    def interp(self, X):
        """Values X (NV, ...) of the base mesh's vertices carried to the bound points (weights, flags)."""
        X = np.asarray(X)
        sh = (-1,) + (1,) * (X.ndim - 1)
        return (self.w[:, 0].reshape(sh) * X[self.T[:, 0]] + self.w[:, 1].reshape(sh) * X[self.T[:, 1]] +
                self.w[:, 2].reshape(sh) * X[self.T[:, 2]])

    def nearest_vertex(self):
        return self.T[np.arange(len(self.T)), np.argmax(self.w, 1)]


# ---------------------------------------------------------------- MakeHuman's own fitted assets (.mhclo, .proxy)

def read_mhclo(p):
    """An .mhclo or .proxy file: its settings and per vertex either one base vertex or three with weights and an
    offset (MakeHuman's units and axes, scaled by the x/y/z_scale reference distances)."""
    info, refs = {}, []
    in_verts = False
    with open(p, encoding="utf-8", errors="replace") as f:
        for ln in f:
            s = ln.strip()
            if not s or s.startswith("#"):
                continue
            a = s.split()
            if in_verts:
                try:
                    if len(a) == 1:
                        refs.append((int(a[0]),))
                        continue
                    if len(a) >= 9:
                        refs.append((int(a[0]), int(a[1]), int(a[2]), float(a[3]), float(a[4]), float(a[5]),
                                     float(a[6]), float(a[7]), float(a[8])))
                        continue
                except ValueError:
                    pass
                in_verts = False
            if a[0] == "verts":
                in_verts = True
                continue
            info.setdefault(a[0], []).append(s[len(a[0]):].strip())
    return info, refs


class MhAsset:
    """A MakeHuman proxy, eyes, eyebrow, lashes, teeth or tongue asset, fitted the MakeHuman way to base positions."""

    def __init__(self, rel):
        folder = path(rel)
        name = os.path.basename(folder.rstrip("/\\"))
        p = None
        for ext in (".mhclo", ".proxy"):
            c = os.path.join(folder, name + ext)
            if os.path.exists(c):
                p = c
        self.info, self.refs = read_mhclo(p)
        self.obj = read_obj(os.path.join(folder, self.info["obj_file"][0]))
        self.scales = {}
        for ax in "xyz":
            if ax + "_scale" in self.info:
                i, j, d = self.info[ax + "_scale"][0].split()
                self.scales[ax] = (int(i), int(j), float(d))

    def fit(self, V):
        """The asset's vertex positions (metres, game axes) for base positions V (NV, 3) in MakeHuman's own pose."""
        Vd = V / SCALE
        sc = np.ones(3)
        for k, ax in enumerate("xyz"):
            if ax in self.scales:
                i, j, d = self.scales[ax]
                sc[k] = abs(Vd[i, k] - Vd[j, k]) / d
        out = np.zeros((len(self.refs), 3))
        for n, r in enumerate(self.refs):
            if len(r) == 1:
                out[n] = Vd[r[0]]
            else:
                out[n] = r[3] * Vd[r[0]] + r[4] * Vd[r[1]] + r[5] * Vd[r[2]] + np.array(r[6:9]) * sc
        return out * SCALE

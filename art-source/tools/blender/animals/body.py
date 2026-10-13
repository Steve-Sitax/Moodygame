"""The bodies as signed distance fields: bones and muscles as ellipsoids and tapered tubes, joined by smooth unions
(the way flesh runs from one into the next), with the parts that need a crisp edge (ears, eyes, claws) made apart in
mesh.py.

Each part (Prim) knows the bones it moves with (bind: a point -> weights), the region it is ("torso", "leg", "paw",
"head", "muzzle", "nose", ...: painting and the picture's layout use it) and the way its hair lies (flow). A point of
the meshed surface takes the weights of the parts it is nearest, softly (mesh.py weights()), so the skin bends where
the parts meet, never across a gap.

All sizes come from the rig's joints (anatomy.py) and its shoulder height H, so a breed is a change of numbers.
"""

import math

import numpy as np

from people2 import sdf as S

from .anatomy import HELPER_AT, INDEX, NAMES


def V(*a):
    return np.array(a, np.float64)


def unit(v):
    v = np.asarray(v, np.float64)
    return v / max(np.linalg.norm(v), 1e-12)


def frame(axis, side=(1.0, 0.0, 0.0)):
    """Columns: side (x), up (y), along the axis (z)."""
    z = unit(axis)
    x = np.asarray(side, np.float64) - z * np.dot(side, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.array((0.0, 1.0, 0.0)) - z * z[1]
    x = unit(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


# ---------------------------------------------------------------- shapes

def ell(c, r, R=None):
    c = np.asarray(c, np.float64)
    r = np.asarray(r, np.float64)

    def f(p):
        q = p - c
        if R is not None:
            q = q @ R
        return S.ellipsoid(q, (0, 0, 0), r)
    return f


def ell_along(a, b, rx, ry, ext=1.0, t=0.5, off=(0, 0, 0), side=(1, 0, 0)):
    """An ellipsoid with its long axis from a to b: centre at t along, half-length ext * |ab| / 2."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    R = frame(b - a, side)
    c = a + (b - a) * t + R @ np.asarray(off, float)
    return ell(c, (rx, ry, np.linalg.norm(b - a) * 0.5 * ext), R)


def tube(pts, radii, scale=None, R=None):
    pts = np.asarray(pts, np.float64)
    if R is None:
        return lambda p: S.tube(p, pts, radii, scale)
    o = pts[0]
    local = (pts - o) @ R
    return lambda p: S.tube((p - o) @ R, local, radii, scale)


def obox(c, half, R, rnd=0.0):
    """A box (rounded by rnd) centred at c with its axes the columns of R."""
    c = np.asarray(c, np.float64)
    return lambda p: S.box((p - c) @ R, (0.0, 0.0, 0.0), half, rnd)


def sphere(c, r):
    return lambda p: S.sphere(p, c, r)


# ---------------------------------------------------------------- binds (a point -> bone weights)

NB = len(NAMES)


def bone(name):
    i = INDEX[name]

    def f(p):
        w = np.zeros((len(p), NB))
        w[:, i] = 1.0
        return w
    return f


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def chain(joints, bones, blend):
    """Along a chain of joints (bones[i] runs from joints[i] to joints[i + 1]): each point takes the bone of the
    segment it is beside, blended over `blend` metres either side of each inner joint."""
    J = [np.asarray(j, float) for j in joints]

    def f(p):
        n = len(p)
        w = np.zeros((n, NB))
        # the arc length of each point's projection on the chain
        best = np.full(n, 1e9)
        s = np.zeros(n)
        acc = 0.0
        cuts = []
        for a, b in zip(J, J[1:]):
            ab = b - a
            L = float(np.linalg.norm(ab))
            h = np.clip(((p - a) @ ab) / max(L * L, 1e-12), 0.0, 1.0)
            d = np.linalg.norm(p - a - h[:, None] * ab, axis=1)
            m = d < best
            best[m] = d[m]
            s[m] = acc + h[m] * L
            acc += L
            cuts.append(acc)
        prev = np.ones(n)  # the share of each point past the start of bone i's stretch
        for i, bn in enumerate(bones):
            if i < len(bones) - 1:
                hb = HELPER_AT.get((bn, bones[i + 1]))
                if hb:
                    # A -> helper -> B: the helper takes the joint itself
                    a = smooth(cuts[i] - blend * 1.4, cuts[i], s)
                    up = smooth(cuts[i], cuts[i] + blend * 1.4, s)
                    w[:, INDEX[bn]] += prev - a
                    w[:, INDEX[hb]] += a - up
                    prev = up
                    continue
                up = smooth(cuts[i] - blend, cuts[i] + blend, s)
            else:
                up = np.zeros(n)
            w[:, INDEX[bn]] += prev - up
            prev = up
        return w
    return f


def mix(*pairs):
    """mix((bind, share), ...): fixed shares of several binds."""
    def f(p):
        w = np.zeros((len(p), NB))
        for b, k in pairs:
            w += b(p) * k
        return w
    return f


def by_z(zs, bones, blend):
    """Along z (the body's length): bones[i] between zs[i] and zs[i + 1], blended at the cuts."""
    def f(p):
        n = len(p)
        w = np.zeros((n, NB))
        prev = np.ones(n)
        for i, bn in enumerate(bones):
            up = smooth(zs[i + 1] - blend, zs[i + 1] + blend, p[:, 2]) if i < len(bones) - 1 else np.zeros(n)
            w[:, INDEX[bn]] += prev - up
            prev = up
        return w
    return f


# ---------------------------------------------------------------- hair flow (a point -> direction)

def flow_along(a, b):
    d = unit(np.asarray(b, float) - np.asarray(a, float))
    return lambda p: np.tile(d, (len(p), 1))


def flow_chain(joints):
    """Down a chain (towards its last joint), following the segment each point is beside."""
    J = [np.asarray(j, float) for j in joints]

    def f(p):
        best = np.full(len(p), 1e9)
        out = np.zeros((len(p), 3))
        for a, b in zip(J, J[1:]):
            ab = b - a
            L2 = float(ab @ ab)
            h = np.clip(((p - a) @ ab) / max(L2, 1e-12), 0.0, 1.0)
            d = np.linalg.norm(p - a - h[:, None] * ab, axis=1)
            m = d < best
            best[m] = d[m]
            out[m] = ab / math.sqrt(L2)
        return out
    return f


def flow_back(tilt=0.0):
    """Hair on the trunk lies back towards the tail and a little down the sides."""
    def f(p):
        d = np.zeros((len(p), 3))
        d[:, 2] = -1.0
        d[:, 1] = -tilt
        return d
    return f


class Prim:
    def __init__(self, f, bind, part, k=0.0, flow=None, sub=False, fur=1.0):
        self.f, self.bind, self.part, self.k, self.flow, self.sub, self.fur = f, bind, part, k, flow, sub, fur


class Body:
    """The prims of one rig, their union and the rest of what painting and weighting need."""

    def __init__(self, rig):
        self.rig = rig
        self.J = {n: np.asarray(p, float) for n, p in rig["J"].items()}
        self.H = rig["H"]
        self.prims = []
        self.extras = {}  # eyes, ears, claws for mesh.py
        self.marks = {}   # named points for painting (eye centres, nose tip, ...)

    def add(self, f, bind, part, k=0.0, flow=None, fur=1.0):
        self.prims.append(Prim(f, bind, part, k, flow, False, fur))

    def cut(self, f, k=0.0):
        self.prims.append(Prim(f, None, None, k, None, True))

    def sdf(self, p):
        d = None
        for pr in self.prims:
            v = pr.f(p)
            if d is None:
                d = v
            elif pr.sub:
                d = S.smax(d, -v, pr.k)
            else:
                d = S.smin(d, v, pr.k)
        return d

    def soft(self, p, tau):
        """Soft membership of each additive prim at points p: (n, prims)."""
        ds = np.stack([pr.f(p) if not pr.sub else np.full(len(p), 1e9) for pr in self.prims], 1)
        dmin = ds.min(1, keepdims=True)
        a = np.exp(-np.clip(ds - dmin, 0, None) / tau)
        a[ds - dmin > 6 * tau] = 0.0
        a /= a.sum(1, keepdims=True)
        return a

    def weights(self, p, tau):
        a = self.soft(p, tau)
        w = np.zeros((len(p), NB))
        for i, pr in enumerate(self.prims):
            if pr.sub:
                continue
            m = a[:, i] > 1e-4
            if m.any():
                w[m] += pr.bind(p[m]) * a[m, i:i + 1]
        return w

    def parts(self, p, tau):
        a = self.soft(p, tau)
        names = [pr.part for pr in self.prims]
        best = a.argmax(1)
        return [names[i] for i in best]

    def flow(self, p, tau):
        a = self.soft(p, tau)
        d = np.zeros((len(p), 3))
        for i, pr in enumerate(self.prims):
            if pr.sub or pr.flow is None:
                continue
            m = a[:, i] > 1e-4
            if m.any():
                d[m] += pr.flow(p[m]) * a[m, i:i + 1]
        return d

    def fur(self, p, tau):
        a = self.soft(p, tau)
        k = np.array([pr.fur if not pr.sub else 0.0 for pr in self.prims])
        return a @ k


# ---------------------------------------------------------------- shared pieces

def paw(B, S_, mcp, toe, width, bone_paw, bone_up, hoof=False, part="paw"):
    """A paw: the knuckle, the palm pad and four toes in an arc (dogs, cats); hoof=True: two toes and two dewclaws
    (the pig)."""
    J = B.J
    mcp, toe = np.asarray(mcp, float), np.asarray(toe, float)
    fwd = toe - mcp
    fwd[1] = 0.0
    L = float(np.linalg.norm(fwd))
    f = fwd / L
    x = np.array((1.0, 0.0, 0.0)) if S_ == "L" else np.array((-1.0, 0.0, 0.0))
    side = unit(np.cross((0, 1, 0), f))  # the animal's left of the paw's forward
    hm = mcp[1]
    bind = chain([mcp + f * -0.4 * L + V(0, 0.6 * hm, 0), mcp, toe], [bone_up, bone_paw], 0.35 * hm)
    k = 0.32 * hm
    fl = lambda p: np.tile(f, (len(p), 1))
    if hoof:
        # the pig's foot: a short pastern into two hard toes, the dewclaws high behind
        for s in (-1, 1):
            c = mcp + f * 0.55 * L + side * s * 0.24 * width + V(0, -0.35 * hm, 0)
            R = frame(f + V(0, -0.35, 0), side)
            B.add(ell(c, (0.24 * width, 0.30 * width, 0.62 * L), R), bind, "hoof", k * 0.5, fl, fur=0.0)
            dc = mcp + f * -0.25 * L + side * s * 0.42 * width + V(0, 0.05 * hm, 0)
            B.add(ell(dc, (0.09 * width, 0.12 * width, 0.16 * width)), bone(bone_up), "hoof", k * 0.4, fl, fur=0.0)
        B.add(sphere(mcp + V(0, 0.05 * hm, 0), 0.55 * width), bind, part, k)
        return
    k = 0.5 * hm
    B.add(sphere(mcp + V(0, 0.02 * hm, 0) - f * 0.06 * L, 0.40 * width), bind, part, k, fl)
    # the palm pad under the knuckle
    B.add(ell(mcp + V(0, -0.52 * hm, 0) + f * 0.06 * L, (0.40 * width, 0.46 * hm, 0.30 * L)), bone(bone_paw), "pad", k * 0.7, fl, 0.2)
    toes = []
    for s, ahead, ry in ((-1.0, 0.36, 0.95), (-0.34, 0.50, 1.0), (0.34, 0.50, 1.0), (1.0, 0.36, 0.95)):
        c = mcp + f * ahead * L + side * s * 0.33 * width
        c[1] = 0.47 * hm * ry
        B.add(ell(c, (0.215 * width, 0.47 * hm * ry, 0.29 * L), frame(f + V(0, -0.2, 0), side)), bone(bone_paw), part, k * 0.55, fl, 0.6)
        toes.append(c + f * 0.22 * L + V(0, 0.42 * hm * ry, 0))
    B.marks.setdefault("toes", []).append(toes)
    B.marks.setdefault("toe_dirs", []).append(f)
    B.marks.setdefault("toe_bones", []).append(bone_paw)


def leg_front(B, S_, r, bone_k=1.0, girth=1.0, cat=False, pig=False):
    """The front leg from the shoulder blade down: r = dict of radii in metres."""
    J = B.J
    sc, sh, el, ca, mc, to = (J[n + S_] for n in ("scapula", "shoulder", "elbow", "carpus", "fmcp", "ftoe"))
    sg = 1.0 if S_ == "L" else -1.0
    out = V(sg, 0, 0)
    bl = r["blend"]
    k = r["k"]
    # the shoulder blade and its muscles, flat on the ribs
    B.add(ell_along(sc, sh, r["scap_x"], r["scap_y"], 1.15, 0.45, off=(sg * r["scap_out"], 0, 0)),
          chain([sc, sh], ["scapula" + S_], bl), "shoulder", k, flow_chain([sc, sh, el]))
    # upper arm: triceps behind, the point of the shoulder in front
    B.add(ell_along(sh, el, r["arm_x"], r["arm_y"], 1.25, 0.48, off=(sg * r["arm_out"], 0, -r["arm_back"])),
          chain([sc, sh, el, ca], ["scapula" + S_, "humerus" + S_, "forearm" + S_], bl), "arm", k, flow_chain([sh, el, ca]))
    B.add(sphere(sh + out * r["arm_out"] * 0.5, r["point"]), mix((bone("humerus" + S_), 0.6), (bone("scapula" + S_), 0.4)), "arm", k)
    # elbow point and forearm
    olec = el + V(0, r["fore0"] * 0.15, 0) - unit(sh - el) * 0 + V(0, 0, -r["fore0"] * 0.75)
    B.add(sphere(olec, r["fore0"] * 0.75), chain([el, ca], ["forearm" + S_], bl), "leg", k * 0.8, flow_chain([el, ca]))
    B.add(tube([el, ca], [r["fore0"], r["fore1"]]), chain([sh, el, ca, mc], ["humerus" + S_, "forearm" + S_, "pastern" + S_], bl),
          "leg", k * 0.8, flow_chain([el, ca, mc]))
    B.add(ell_along(el, ca, r["fore0"] * 0.85, r["fore0"] * 1.05, 0.62, 0.28, off=(0, 0, 0) if cat else (0, -r["fore0"] * 0.15, 0)),
          chain([el, ca], ["forearm" + S_], bl), "leg", k, flow_chain([el, ca]))
    # the wrist and its pad behind
    B.add(sphere(ca, r["carpus"]), chain([el, ca, mc], ["forearm" + S_, "pastern" + S_], r["carpus"] * 0.8), "leg", k * 0.6,
          flow_chain([ca, mc]))
    if not pig:
        back = unit(np.cross(V(1, 0, 0), unit(ca - el))) * -1  # behind the leg
        B.add(ell(ca + V(0, -r["carpus"] * 0.35, 0) + V(0, 0, -r["carpus"] * 1.05), (r["carpus"] * 0.55, r["carpus"] * 0.75, r["carpus"] * 0.45)),
              bone("pastern" + S_), "pad", k * 0.4, flow_chain([ca, mc]), 0.2)
    B.add(tube([ca, mc], [r["past0"], r["past1"]]), chain([ca, mc, to], ["pastern" + S_, "fpaw" + S_], r["past1"] * 0.8), "leg",
          k * 0.6, flow_chain([ca, mc]))
    paw(B, S_, mc, to, r["paw"], "fpaw" + S_, "pastern" + S_, hoof=pig)


def leg_hind(B, S_, r, cat=False, pig=False):
    J = B.J
    hp, st, ho, mc, to = (J[n + S_] for n in ("hip", "stifle", "hock", "hmcp", "htoe"))
    sg = 1.0 if S_ == "L" else -1.0
    bl = r["blend"]
    k = r["k"]
    # the thigh: the big muscles behind and outside the femur
    B.add(ell_along(hp, st, r["thigh_x"], r["thigh_y"], 1.35, 0.45, off=(sg * r["thigh_out"], 0, -r["thigh_back"])),
          chain([J["hips"], hp, st, ho], ["hips", "thigh" + S_, "shin" + S_], bl), "thigh", k, flow_chain([hp, st, ho]))
    B.add(ell(hp + V(sg * r["thigh_out"] * 0.6, -r["thigh_y"] * 0.3, -r["thigh_y"] * 0.42), (r["thigh_x"] * 0.75, r["thigh_y"] * 0.55, r["thigh_y"] * 0.42)),
          bone("hips"), "thigh", k, flow_chain([hp, st]))
    # the shin with the calf muscle behind, the hock and its point, the tendon
    B.add(tube([st, ho], [r["shin0"], r["shin1"]]), chain([hp, st, ho, mc], ["thigh" + S_, "shin" + S_, "meta" + S_], bl), "leg", k * 0.8,
          flow_chain([st, ho, mc]))
    B.add(ell_along(st, ho, r["shin0"] * 0.8, r["shin0"] * 1.05, 0.7, 0.32, off=(0, r["calf_back"], 0)),
          chain([st, ho], ["shin" + S_], bl), "leg", k, flow_chain([st, ho]))
    calc = ho + unit(ho - st) * r["hockpt"] * 0.3 + V(0, r["hockpt"] * 0.4, -r["hockpt"] * 1.0)
    B.add(sphere(calc, r["hockpt"]), chain([st, ho, mc], ["shin" + S_, "meta" + S_], r["hockpt"]), "leg", k * 0.5, flow_chain([ho, mc]))
    mid = (st + ho) / 2 + V(0, 0, -r["shin0"] * 0.7)
    B.add(tube([calc, mid], [r["hockpt"] * 0.62, r["shin1"] * 0.9]), chain([st, ho], ["shin" + S_], bl), "leg", k * 0.6,
          flow_chain([st, ho]))
    B.add(tube([ho, mc], [r["meta0"], r["meta1"]]), chain([ho, mc, to], ["meta" + S_, "hpaw" + S_], r["meta1"] * 0.8), "leg", k * 0.6,
          flow_chain([ho, mc]))
    paw(B, S_, mc, to, r["paw"] * (0.94 if not pig else 1.0), "hpaw" + S_, "meta" + S_, hoof=pig)


def torso_bind(J, blend):
    return by_z([-9, (J["hips"][2] + J["spine"][2]) / 2 + 0.0, (J["spine"][2] + J["chest"][2]) / 2, 9], ["hips", "spine", "chest"], blend)


def tail(B, radii, part="tail", fur=1.0, k=0.0):
    J = B.J
    pts = [J["tail%d" % i] for i in range(6)]
    from .anatomy import TAIL
    B.add(tube(pts, radii), chain(pts, TAIL, 0.35 * float(np.linalg.norm(pts[1] - pts[0]))), part, k, flow_chain(pts), fur)


def eye(Bd, c, look, er, R, sink, k, lids=(1.14, 0.80)):
    """An eye: find the skin along the look from inside the head, sink the ball so a cap of it shows, and cut an
    almond opening round it (wider than tall)."""
    t = np.linspace(-0.5 * er, 6 * er, 200)
    pts = c[None, :] + t[:, None] * look[None, :]
    d = Bd.sdf(pts)
    out = np.nonzero(d > 0)[0]
    skin = pts[out[0]] if len(out) else c
    centre = skin - look * er * sink
    # no socket is cut: the ball (wider than tall, mesh.py) sinks into the skin, and where it comes through is the
    # lids' line: an almond, the skin round it unbroken
    Bd.marks.setdefault("eyes", []).append((centre, look, er, lids))


def head_frame(J):
    """Origin at the atlas, z along the head to the nose, y up the face, x to the left; and the head's length."""
    h, n = J["head"], J["nose"]
    R = frame(n - h)
    return h, R, float(np.linalg.norm(n - h))


def hp(J, x, y, z):
    """A point in head units (the head's length) in the head frame."""
    o, R, L = head_frame(J)
    return o + R @ (np.array((x, y, z)) * L)


# ---------------------------------------------------------------- the dog

def dog(rig):
    Bd = Body(rig)
    J, H, P = Bd.J, rig["H"], rig["P"]
    g, d, bk = P["girth"], P["deep"], P["bone"]
    tb = torso_bind(J, 0.09 * H)
    back = flow_back(0.25)
    k = 0.07 * H
    ch, sp, hi = J["chest"], J["spine"], J["hips"]
    # ribcage, deeper in front, and the forechest between the shoulders
    Rr = frame(V(0, -0.10, 1))
    Bd.add(ell(V(0, ch[1] - 0.175 * H * d, ch[2] + 0.05 * H), (0.185 * H * g, 0.235 * H * d, 0.31 * H), Rr), tb, "torso", 0, back)
    sh = J["shoulderL"]
    Bd.add(ell(V(0, sh[1] - 0.05 * H * d, sh[2] - 0.035 * H), (0.13 * H * g, 0.155 * H * d, 0.10 * H)),
           mix((bone("chest"), 0.8), (bone("neck"), 0.2)), "chest", k * 0.8, flow_back(0.6))
    # abdomen tucked up into the loin, the loin, the croup
    Bd.add(ell(V(0, sp[1] - 0.225 * H * d, sp[2] + 0.07 * H), (0.165 * H * g, 0.145 * H * d, 0.25 * H)), tb, "belly", k, back)
    Bd.add(ell(V(0, sp[1] - 0.10 * H, sp[2] - 0.06 * H), (0.145 * H * g, 0.12 * H, 0.24 * H)), tb, "torso", k, back)
    Bd.add(ell(V(0, hi[1] - 0.075 * H, hi[2] - 0.09 * H), (0.152 * H * g, 0.14 * H, 0.20 * H), frame(V(0, -0.12, 1))), tb, "torso", k, back)
    # the withers: the tops of the shoulder blades and the spine between them
    Bd.add(ell(V(0, ch[1] + 0.035 * H, ch[2] + 0.14 * H), (0.09 * H * g, 0.06 * H, 0.17 * H)), mix((bone("chest"), 1.0),), "torso", k, back)
    rf = dict(blend=0.05 * H, k=0.085 * H, scap_x=0.042 * H * g, scap_y=0.11 * H, scap_out=0.008 * H,
              arm_x=0.052 * H * bk, arm_y=0.09 * H * bk, arm_out=0.0, arm_back=0.012 * H, point=0.055 * H * bk,
              fore0=0.05 * H * bk, fore1=0.032 * H * bk, carpus=0.036 * H * bk, past0=0.033 * H * bk, past1=0.031 * H * bk,
              paw=0.105 * H * bk)
    rh = dict(blend=0.05 * H, k=0.085 * H, thigh_x=0.068 * H * g, thigh_y=0.155 * H, thigh_out=0.0, thigh_back=0.025 * H,
              shin0=0.062 * H * bk, shin1=0.03 * H * bk, calf_back=-0.03 * H, hockpt=0.028 * H * bk, meta0=0.032 * H * bk,
              meta1=0.03 * H * bk, paw=0.10 * H * bk)
    for S_ in "LR":
        leg_front(Bd, S_, rf)
        leg_hind(Bd, S_, rh)
    # the neck: a deep oval, the throat under it
    nb, n2, hd = J["neck"], J["neck2"], J["head"]
    nk = mix  # noqa
    Bd.add(tube([nb + V(0, -0.03 * H, -0.08 * H), n2, hd + V(0, -0.03 * H, 0.02 * H)], [0.20 * H * g, 0.15 * H * g, 0.115 * H], scale=(0.8, 1, 1)),
           chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.06 * H), "neck", k * 1.3, flow_chain([hd, n2, nb, ch]))
    Bd.add(ell_along(nb + V(0, -0.06 * H, 0.02 * H), hd + V(0, -0.11 * H, 0.04 * H), 0.075 * H * g, 0.06 * H, 1.0, 0.5),
           chain([nb, n2, hd], ["neck", "neck2"], 0.06 * H), "throat", k, flow_chain([hd, nb]))
    dog_head(Bd, P)
    # the tail
    if P["tail"] == "bob":
        Bd.add(ell(J["tail0"] + V(0, -0.03 * H, 0.03 * H), (0.1 * H, 0.08 * H, 0.06 * H)), mix((bone("hips"), 0.7), (bone("tail1"), 0.3)), "torso", k, back)
    else:
        r0 = {"long": 0.048, "docked": 0.05}[P["tail"]] * H * (1.15 if rig["name"] == "draught" else 1.0)
        tail(Bd, [r0, r0 * 0.9, r0 * 0.78, r0 * 0.64, r0 * 0.5, r0 * 0.28 if P["tail"] == "long" else r0 * 0.55], k=0.04 * H)
    # coats that change the outline: the Schipperke's ruff and culottes, the terrier's beard and brows
    if P["coat"] == "ruff":
        Bd.add(ell_along(nb + V(0, 0.0, -0.06 * H), hd + V(0, -0.02 * H, -0.06 * H), 0.23 * H, 0.23 * H, 1.3, 0.45),
               chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.06 * H), "ruff", 0.08 * H, flow_chain([hd, n2, nb, ch]), 1.7)
        for S_ in "LR":
            sg = 1 if S_ == "L" else -1
            Bd.add(ell(J["hip" + S_] + V(sg * 0.01 * H, -0.12 * H, -0.1 * H), (0.06 * H, 0.13 * H, 0.08 * H)),
                   mix((bone("thigh" + S_), 0.8), (bone("hips"), 0.2)), "thigh", 0.05 * H, flow_back(1.0), 1.5)
    if P["coat"] == "wire":
        Bd.add(ell(hp(J, 0, -0.16, 0.86), (0.125, 0.12, 0.15) * np.array([1, 1, 1]) * float(np.linalg.norm(J["nose"] - J["head"]))),
               bone("jaw"), "beard", 0.03 * H, flow_along(V(0, 0, 1), V(0, -1, 0.5)), 1.4)
    return Bd


def dog_head(Bd, P):
    J, H = Bd.J, Bd.H
    o, R, L = head_frame(J)
    sk = P["skull"]
    Rh = R
    # the head's length is the skull's plus the muzzle's: a shorter muzzle leaves the skull a larger share of it
    u = 1.0 / (0.42 + 0.58 * P["muzzle"])
    zs = 0.47 * u  # the stop

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    def r(*a):
        return np.array(a) * L

    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))  # hair from the nose back over the head
    k = 0.035 * H
    flews = bool(P.get("flews"))
    # cranium, brow and cheeks (the cheek arches under the eyes)
    wide = 1.0 + 0.9 * (sk - 1.0)  # the mastiff's broad skull, flat on top
    flat = 1.0 + 0.6 * (sk - 1.0)
    Bd.add(ell(at(0, 0.19 * u / flat ** 0.5, 0.22 * u), r(0.235 * wide * u, 0.225 * u / flat, 0.31 * u), Rh), hb, "head", 0.03 * H, fl_back)
    Bd.add(ell(at(0, 0.27 * u, 0.12 * u), r(0.10 * u, 0.10 * u, 0.16 * u), Rh), hb, "head", k, fl_back)  # the occipital crest
    for s in (-1, 1):
        Bd.add(ell(at(s * 0.16 * wide * u, 0.02 * u, 0.36 * u), r(0.105 * wide * u, 0.12 * u, 0.17 * u), Rh), hb, "head", k, fl_back)
        # the brow over each eye: the forehead rises from the muzzle in a step (the stop), not a dip
        Bd.add(ell(at(s * 0.085 * u, 0.215 * u, zs - 0.04), r(0.085 * u, 0.06 * u, 0.09 * u), Rh), hb, "head", 0.012 * H, fl_back)
    # the muzzle from the stop to the nose: deep and broad at the stop, a little narrower at the front, its front
    # nearly flat (the nose leather above, the upper lip below), not a rounded snout
    w = 0.135 * (1.18 if flews else 1.0)
    zf = 0.965  # the front of the upper lip, under the nose
    Bd.add(tube([at(0, 0.075 * u, zs - 0.03), at(0, 0.03, zs + 0.55 * (zf - zs)), at(0, 0.01, zf - 0.07)],
                [r(w)[0] * 1.15, r(w)[0] * 0.98, r(w)[0] * 0.9], scale=(1.0, 0.86, 1.0), R=Rh), hb, "muzzle", 0.05 * H, fl_back)
    fw = 0.092 if flews else 0.07
    for s in (-1, 1):
        # the upper lips (flews) hanging at the sides of the muzzle over the lower jaw
        Bd.add(ell(at(s * 0.085 * (1.1 if flews else 1.0), -0.075 - (0.02 if flews else 0.0), zs + 0.6 * (zf - zs)),
                   r(fw, fw * (1.25 if flews else 1.35), 0.55 * (zf - zs)), Rh), hb, "muzzle", 0.025 * H,
               lambda p: np.tile(unit(-R[:, 2] - R[:, 1] * 0.5), (len(p), 1)), 0.7)
    # the lower jaw: from under the ear to the chin, its front behind the lip
    Bd.add(tube([at(0, -0.12, 0.16 * u), at(0, -0.15, zs + 0.15), at(0, -0.13, zf - 0.09)], [r(0.13)[0], r(0.09)[0], r(0.06)[0]],
                scale=(1.0, 0.8, 1.0), R=Rh), chain([J["jaw"], J["chin"]], ["jaw"], 0.01), "jaw", 0.03 * H, fl_back, 0.8)
    # the front cut flat (the round of its edges left by the blend)
    Bd.cut(obox(at(0, -0.05, zf + 0.3), r(0.4, 0.4, 0.3), Rh), 0.035 * L)
    # the nose leather: proud of the front, its top on the line of the bridge; nostrils open to the front and sides
    # and the groove down its middle into the lip
    Bd.add(ell(at(0, 0.05, zf - 0.005), r(0.105, 0.078, 0.055), Rh), hb, "nose", 0.008 * L, fl_back, 0.0)
    for s in (-1, 1):
        Bn = frame(R @ np.array((s * 0.45, 0.0, 1.0)))
        Bd.cut(ell(at(s * 0.042, 0.035, zf + 0.047), r(0.019, 0.012, 0.02), Bn), 0.004 * L)
    Bd.cut(ell(at(0, 0.0, zf + 0.045), r(0.006, 0.045, 0.02), Rh), 0.004 * L)
    # the mouth: a cavity between the jaws, open at the lips along the sides, closed under the nose
    mz_c, mz_r = zs + 0.5 * (zf - zs) - 0.02, 0.45 * (zf - zs)
    Bd.cut(ell(at(0, -0.088, mz_c), r(0.07, 0.02, mz_r), Rh), 0.012 * H)
    # the eyes: at the stop, looking forward and a little out; the balls are made in mesh.py
    er = 0.047 * L / sk  # a bigger head has relatively smaller eyes
    for s in (-1, 1):
        eye(Bd, at(s * 0.12 * u, 0.16 * u, zs - 0.03), unit(R @ np.array((s * 0.36, 0.1, 1.0))), er, R, 0.64, 0.004 * H, lids=(1.22, 0.8))
    Bd.marks["nose"] = at(0, 0.045, zf + 0.045)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.088, mz_c), r(0.07, 0.02, mz_r), R)


# ---------------------------------------------------------------- the cat

def cat(rig):
    Bd = Body(rig)
    J, H = Bd.J, rig["H"]
    tb = torso_bind(J, 0.08 * H)
    back = flow_back(0.2)
    k = 0.022
    ch, sp, hi = J["chest"], J["spine"], J["hips"]
    # a supple body: the ribcage deep in front, a loose belly (the primordial pouch low behind), strong haunches
    Bd.add(ell(V(0, ch[1] - 0.044, ch[2] - 0.012), (0.047, 0.064, 0.088), frame(V(0, -0.1, 1))), tb, "torso", 0, back)
    sh = J["shoulderL"]
    Bd.add(ell(V(0, sh[1] - 0.03, sh[2] - 0.016), (0.034, 0.045, 0.034)), mix((bone("chest"), 0.8), (bone("neck"), 0.2)), "chest", k * 0.8, flow_back(0.6))
    Bd.add(ell(V(0, sp[1] - 0.056, sp[2] - 0.012), (0.049, 0.058, 0.092)), tb, "belly", k, back)
    Bd.add(ell(V(0, sp[1] - 0.084, sp[2] - 0.052), (0.038, 0.03, 0.055)), tb, "belly", k, flow_back(0.8))
    Bd.add(ell(V(0, sp[1] - 0.02, sp[2] - 0.035), (0.043, 0.038, 0.085)), tb, "torso", k, back)
    Bd.add(ell(V(0, hi[1] - 0.025, hi[2] - 0.012), (0.048, 0.046, 0.062), frame(V(0, -0.12, 1))), tb, "torso", k, back)
    Bd.add(ell(V(0, ch[1] + 0.002, ch[2] + 0.012), (0.026, 0.018, 0.055)), bone("chest"), "torso", k, back)
    rf = dict(blend=0.012, k=0.02, scap_x=0.013, scap_y=0.026, scap_out=0.0, arm_x=0.016, arm_y=0.024, arm_out=0.0,
              arm_back=0.004, point=0.015, fore0=0.0135, fore1=0.0095, carpus=0.0098, past0=0.009, past1=0.009, paw=0.032)
    rh = dict(blend=0.014, k=0.022, thigh_x=0.026, thigh_y=0.05, thigh_out=0.0, thigh_back=0.008, shin0=0.018, shin1=0.009,
              calf_back=-0.008, hockpt=0.0075, meta0=0.009, meta1=0.0085, paw=0.031)
    for S_ in "LR":
        leg_front(Bd, S_, rf, cat=True)
        leg_hind(Bd, S_, rh, cat=True)
    nb, n2, hd = J["neck"], J["neck2"], J["head"]
    Bd.add(tube([nb + V(0, -0.008, -0.02), n2, hd + V(0, -0.012, 0.004)], [0.04, 0.034, 0.03], scale=(0.86, 1, 1)),
           chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.014), "neck", 0.025, flow_chain([hd, n2, nb, ch]))
    cat_head(Bd)
    tail(Bd, [0.0128, 0.0118, 0.011, 0.0104, 0.0098, 0.0078], k=0.012)
    return Bd


def cat_head(Bd):
    J, H = Bd.J, Bd.H
    o, R, L = head_frame(J)

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    def r(*a):
        return np.array(a) * L
    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))
    # a round skull, wide cheeks, a short muzzle with full whisker pads, a small nose, a neat chin
    Bd.add(ell(at(0, 0.13, 0.33), r(0.43, 0.38, 0.47), R), hb, "head", 0.006, fl_back)
    # the lower face small: the cheeks wide but high, a short muzzle of two whisker pads, a neat chin
    for s in (-1, 1):
        Bd.add(ell(at(s * 0.27, -0.0, 0.46), r(0.19, 0.2, 0.24), R), hb, "head", 0.006, fl_back)
        Bd.add(ell(at(s * 0.085, -0.05, 0.85), r(0.1, 0.085, 0.1), R), hb, "muzzle", 0.008, lambda p: np.tile(unit(-R[:, 2] + R[:, 0] * 0.0), (len(p), 1)), 0.5)
    Bd.add(ell(at(0, 0.03, 0.76), r(0.17, 0.15, 0.2), R), hb, "muzzle", 0.014, fl_back)
    Bd.add(ell(at(0, 0.05, 0.95), r(0.055, 0.04, 0.035), R), hb, "nose", 0.003, fl_back, 0.0)
    Bd.add(tube([at(0, -0.12, 0.38), at(0, -0.125, 0.82)], [r(0.13)[0], r(0.065)[0]], scale=(1.0, 0.8, 1.0), R=R),
           chain([J["jaw"], J["chin"]], ["jaw"], 0.005), "jaw", 0.006, fl_back, 0.8)
    Bd.cut(ell(at(0, -0.1, 0.78), r(0.07, 0.012, 0.11), R), 0.002)
    er = 0.112 * L
    for s in (-1, 1):
        eye(Bd, at(s * 0.2, 0.17, 0.62), unit(R @ np.array((s * 0.28, 0.06, 1.0))), er, R, 0.62, 0.0016, lids=(1.18, 0.68))
    Bd.marks["nose"] = at(0, 0.05, 0.99)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.1, 0.78), r(0.07, 0.012, 0.11), R)


# ---------------------------------------------------------------- the pig

def pig(rig):
    Bd = Body(rig)
    J, H = Bd.J, rig["H"]
    tb = torso_bind(J, 0.07 * H)
    back = flow_back(0.3)
    k = 0.06 * H
    ch, sp, hi = J["chest"], J["spine"], J["hips"]
    # a long barrel, deep and narrow (the old landrace), a slight arch of the back, full hams
    # deep at the chest, the belly hanging a little, the flank drawn up before the ham; the back slightly arched
    Bd.add(ell(V(0, ch[1] - 0.20, ch[2] - 0.03), (0.16, 0.22, 0.32), frame(V(0, -0.05, 1))), tb, "torso", 0, back)
    Bd.add(ell(V(0, sp[1] - 0.24, sp[2] + 0.02), (0.165, 0.2, 0.32)), tb, "belly", k, back)
    Bd.add(ell(V(0, hi[1] - 0.13, hi[2] - 0.03), (0.155, 0.19, 0.24), frame(V(0, -0.18, 1))), tb, "torso", k, back)
    Bd.add(ell(V(0, sp[1] - 0.03, sp[2] - 0.04), (0.12, 0.09, 0.36)), tb, "torso", k, back)
    sh = J["shoulderL"]
    Bd.add(ell(V(0, sh[1] - 0.04, sh[2] - 0.05), (0.13, 0.16, 0.12)), mix((bone("chest"), 0.8), (bone("neck"), 0.2)), "chest", k, flow_back(0.6))
    rf = dict(blend=0.03, k=0.06, scap_x=0.045, scap_y=0.09, scap_out=0.0, arm_x=0.07, arm_y=0.09, arm_out=0.0,
              arm_back=0.01, point=0.06, fore0=0.05, fore1=0.034, carpus=0.036, past0=0.032, past1=0.03, paw=0.078)
    rh = dict(blend=0.03, k=0.06, thigh_x=0.08, thigh_y=0.16, thigh_out=0.0, thigh_back=0.04, shin0=0.06, shin1=0.032,
              calf_back=-0.02, hockpt=0.026, meta0=0.032, meta1=0.03, paw=0.078)
    for S_ in "LR":
        leg_front(Bd, S_, rf, pig=True)
        leg_hind(Bd, S_, rh, pig=True)
        sg = 1 if S_ == "L" else -1
        # the ham, round and heavy
        Bd.add(ell(J["hip" + S_] + V(-sg * 0.01, -0.08, -0.05), (0.1, 0.16, 0.14)), mix((bone("thigh" + S_), 0.5), (bone("hips"), 0.5)), "thigh", k * 1.4, back)
    nb, n2, hd = J["neck"], J["neck2"], J["head"]
    Bd.add(tube([nb + V(0, -0.02, -0.08), n2, hd + V(0, -0.04, 0.02)], [0.20, 0.17, 0.14], scale=(0.85, 1, 1)),
           chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.05), "neck", k, flow_chain([hd, n2, nb, ch]))
    # jowls under the neck
    Bd.add(ell(hd + V(0, -0.14, -0.02), (0.11, 0.09, 0.12)), mix((bone("neck2"), 0.5), (bone("head"), 0.3), (bone("jaw"), 0.2)), "throat", k, flow_back(0.8))
    pig_head(Bd)
    tail(Bd, [0.016, 0.012, 0.010, 0.009, 0.0085, 0.0065], k=0.008, fur=0.4)
    return Bd


def pig_head(Bd):
    J = Bd.J
    o, R, L = head_frame(J)

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    def r(*a):
        return np.array(a) * L
    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))
    # the poll and the broad forehead, the cheeks and jowls, the face tapering straight to the disc
    Bd.add(ell(at(0, 0.07, 0.24), r(0.37, 0.37, 0.4), R), hb, "head", 0.03, fl_back)
    for s in (-1, 1):
        Bd.add(ell(at(s * 0.23, -0.14, 0.3), r(0.2, 0.3, 0.3), R), hb, "head", 0.04, fl_back)
    Bd.add(ell(at(0, -0.26, 0.26), r(0.26, 0.2, 0.3), R), mix((bone("head"), 0.6), (bone("jaw"), 0.4)), "jaw", 0.05, fl_back, 0.6)
    Bd.add(tube([at(0, 0.0, 0.26), at(0, -0.02, 0.62), at(0, -0.02, 0.93)], [r(0.38)[0], r(0.28)[0], r(0.2)[0]], scale=(0.9, 0.92, 1.0), R=R),
           hb, "muzzle", 0.06, fl_back)
    # the snout disc: a flat oval end, slightly proud of the face
    # the disc stands a little proud of the face, a firm rim round a flat front
    Bd.add(tube([at(0, -0.02, 0.9), at(0, -0.02, 0.99)], [r(0.215)[0], r(0.215)[0]], scale=(1.0, 0.8, 1.0), R=R), hb, "nose", 0.006, fl_back, 0.0)
    Bd.add(tube([at(0, -0.17, 0.22), at(0, -0.17, 0.55), at(0, -0.13, 0.84)], [r(0.2)[0], r(0.13)[0], r(0.085)[0]], scale=(1.0, 0.75, 1.0), R=R),
           chain([J["jaw"], J["chin"]], ["jaw"], 0.01), "jaw", 0.03, fl_back, 0.5)
    Bd.cut(ell(at(0, -0.10, 0.70), r(0.11, 0.022, 0.22), R), 0.005)
    er = 0.03 * L
    for s in (-1, 1):
        eye(Bd, at(s * 0.17, 0.17, 0.40), unit(R @ np.array((s * 0.75, 0.15, 1.0))), er, R, 0.62, 0.004, lids=(1.25, 0.75))
    Bd.marks["nose"] = at(0, -0.005, 1.02)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.10, 0.70), r(0.11, 0.022, 0.22), R)


def build(rig):
    return {"dog": dog, "cat": cat, "pig": pig}[rig["species"]](rig)

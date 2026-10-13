"""The bodies as signed distance fields, drawn the way an animal painter builds one: the trunk, the neck and the
skull as lofts (cross-sections along a spine, so the top line, the under line and the widths are given directly:
withers, back, loin, croup, brisket, tuck-up), the muscles and bony points that show through the skin laid on as
ellipsoids and lofts with tight blends (the shoulder blade, the point of the shoulder, the triceps, the elbow, the
forearm's extensors, the thigh, the hamstrings, the stifle, the gaskin, the hock and its tendon), the parts that
need a crisp edge (ears, eyes, claws) made apart in mesh.py.

Each part (Prim) knows the bones it moves with (bind: a point -> weights), the region it is ("torso", "leg", "paw",
"head", "muzzle", "nose", ...: painting and the picture's layout use it), the way its hair lies (flow) and how long
the hair is there (fur). A point of the meshed surface takes the weights of the parts it is nearest, softly (mesh.py
weights()), so the skin bends where the parts meet, never across a gap. Every shape carries its bounds, so the field
is only worked out where a shape can matter.

All sizes come from the rig's joints (anatomy.py) and its shoulder height H, so a breed is a change of numbers.
"""

import math

import numpy as np

from people2 import sdf as S

from .anatomy import HELPER_AT, INDEX, NAMES
from .loft import Loft

FAR = 1.0  # what a shape says beyond its bounds (metres: far from everything)


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


# ---------------------------------------------------------------- shapes (with bounds)

class Shp:
    def __init__(self, f, lo, hi):
        self.f = f
        self.lo = np.asarray(lo, np.float64)
        self.hi = np.asarray(hi, np.float64)

    def __call__(self, p):
        return self.f(p)


def ell(c, r, R=None):
    c = np.asarray(c, np.float64)
    r = np.asarray(r, np.float64)

    def f(p):
        q = p - c
        if R is not None:
            q = q @ R
        return S.ellipsoid(q, (0, 0, 0), r)
    m = float(r.max())
    return Shp(f, c - m, c + m)


def ell_along(a, b, rx, ry, ext=1.0, t=0.5, off=(0, 0, 0), side=(1, 0, 0)):
    """An ellipsoid with its long axis from a to b: centre at t along, half-length ext * |ab| / 2."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    R = frame(b - a, side)
    c = a + (b - a) * t + R @ np.asarray(off, float)
    return ell(c, (rx, ry, np.linalg.norm(b - a) * 0.5 * ext), R)


def tube(pts, radii, scale=None, R=None):
    pts = np.asarray(pts, np.float64)
    m = float(np.max(radii)) * (float(np.max(scale)) if scale is not None else 1.0)
    if R is None:
        f = lambda p: S.tube(p, pts, radii, scale)
        return Shp(f, pts.min(0) - m, pts.max(0) + m)
    o = pts[0]
    local = (pts - o) @ R
    world = o + local @ R.T
    return Shp(lambda p: S.tube((p - o) @ R, local, radii, scale), world.min(0) - m, world.max(0) + m)


def obox(c, half, R, rnd=0.0):
    """A box (rounded by rnd) centred at c with its axes the columns of R."""
    c = np.asarray(c, np.float64)
    m = float(np.linalg.norm(half))
    return Shp(lambda p: S.box((p - c) @ R, (0.0, 0.0, 0.0), half, rnd), c - m, c + m)


def sphere(c, r):
    c = np.asarray(c, np.float64)
    return Shp(lambda p: S.sphere(p, c, r), c - r, c + r)


def lofted(stations, side=(1.0, 0.0, 0.0), per=14):
    L = Loft(stations, side, per)
    m = float(max(L.W.max(), L.A.max(), L.D.max()))
    return Shp(L, L.P.min(0) - m, L.P.max(0) + m)


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
        prev = np.ones(n)
        for i, bn in enumerate(bones):
            if i < len(bones) - 1:
                hb = HELPER_AT.get((bn, bones[i + 1]))
                if hb:
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
    def f(p):
        w = np.zeros((len(p), NB))
        for b, k in pairs:
            w += b(p) * k
        return w
    return f


def by_z(zs, bones, blend):
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


def flow_trunk(top_y, tilt=0.55):
    """The trunk's hair: back along the spine, turning down the sides (the lower, the more), the way it is combed."""
    def f(p):
        d = np.zeros((len(p), 3))
        d[:, 2] = -1.0
        down = np.clip((top_y - p[:, 1]) / 0.25, 0.0, 1.0) * tilt
        d[:, 1] = -down
        return d
    return f


def _vnoise(p, freq, seed):
    q = p * freq
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        wx = f[:, 0] if dx else 1 - f[:, 0]
        for dy in (0, 1):
            wy = f[:, 1] if dy else 1 - f[:, 1]
            for dz in (0, 1):
                wz = f[:, 2] if dz else 1 - f[:, 2]
                h = ((i[:, 0] + dx) * 73856093) ^ ((i[:, 1] + dy) * 19349663) ^ ((i[:, 2] + dz) * 83492791) ^ (seed * 2654435761)
                h = (h ^ (h >> 13)) * 1274126177
                h = h ^ (h >> 16)
                out = out + wx * wy * wz * ((h & 0xFFFFFF) / float(0x1000000))
    return out


def tufts(region, flow, size, amp, seed=7):
    """Long hair standing out of the outline in tufts: noise drawn out along the hair's way (clumps `size` across,
    three times as long), raised by up to `amp`, only where `region` (a point -> 0..1) says the coat is long."""
    def f(p):
        w = region(p)
        out = np.zeros(len(p))
        m = w > 1e-3
        if not m.any():
            return out
        q = p[m]
        d = flow(q)
        d = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        # stretch space along the flow: the clumps are long along the hair, narrow across it
        along = (q * d).sum(1, keepdims=True)
        qs = q + d * along * (1.0 / 3.0 - 1.0)
        n1 = _vnoise(qs, 1.0 / size, seed)
        n2 = _vnoise(qs, 2.3 / size, seed + 1)
        t = np.clip((0.65 * n1 + 0.35 * n2 - 0.35) / 0.5, 0.0, 1.0)
        out[m] = amp * w[m] * t * t
        return out
    return f


class Prim:
    def __init__(self, f, bind, part, k=0.0, flow=None, sub=False, fur=1.0):
        self.f, self.bind, self.part, self.k, self.flow, self.sub, self.fur = f, bind, part, k, flow, sub, fur
        lo = getattr(f, "lo", None)
        self.lo = None if lo is None else f.lo - (2.0 * k + 0.004)
        self.hi = None if lo is None else f.hi + (2.0 * k + 0.004)

    def eval(self, p):
        if self.lo is None:
            return self.f(p)
        m = np.all((p >= self.lo) & (p <= self.hi), axis=1)
        out = np.full(len(p), FAR)
        if m.any():
            out[m] = self.f(p[m])
        return out


class Body:
    """The prims of one rig, their union and the rest of what painting and weighting need."""

    def __init__(self, rig):
        self.rig = rig
        self.J = {n: np.asarray(p, float) for n, p in rig["J"].items()}
        self.H = rig["H"]
        self.prims = []
        self.extras = {}
        self.marks = {}
        self.relief = None  # a point -> outward displacement (metres): skin folds, the fur's clumps in the outline

    def add(self, f, bind, part, k=0.0, flow=None, fur=1.0):
        self.prims.append(Prim(f, bind, part, k, flow, False, fur))

    def cut(self, f, k=0.0):
        self.prims.append(Prim(f, None, None, k, None, True))

    def base(self, p):
        d = None
        for pr in self.prims:
            v = pr.eval(p)
            if d is None:
                d = v
            elif pr.sub:
                d = S.smax(d, -v, pr.k)
            else:
                d = S.smin(d, v, pr.k)
        return d

    def sdf(self, p):
        d = self.base(p)
        if self.relief is not None:
            near = np.abs(d) < 0.03 * self.H
            if near.any():
                d = d.copy()
                d[near] -= self.relief(p[near])
        return d

    def soft(self, p, tau):
        ds = np.stack([pr.eval(p) if not pr.sub else np.full(len(p), 1e9) for pr in self.prims], 1)
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

def paw(B, S_, mcp, toe, width, bone_paw, bone_up, hoof=False, part="paw", knuckle=1.0):
    """A paw: the knuckles (the toes' first joints arched up), four toes in an arc and the pads under them (dogs,
    cats); hoof=True: the pig's foot, two hard toes and two dewclaws high behind."""
    J = B.J
    mcp, toe = np.asarray(mcp, float), np.asarray(toe, float)
    fwd = toe - mcp
    fwd[1] = 0.0
    L = float(np.linalg.norm(fwd))
    f = fwd / L
    side = unit(np.cross((0, 1, 0), f))
    hm = mcp[1]
    bind = chain([mcp + f * -0.4 * L + V(0, 0.6 * hm, 0), mcp, toe], [bone_up, bone_paw], 0.35 * hm)
    fl = lambda p: np.tile(f, (len(p), 1))
    if hoof:
        k = 0.32 * hm
        for s in (-1, 1):
            # the two main toes: hard, pointed in front, their inner faces flat against each other (the cleft)
            c = mcp + f * 0.62 * L + side * s * 0.25 * width + V(0, -0.42 * hm, 0)
            R = frame(f + V(0, -0.42, 0), side)
            B.add(ell(c, (0.235 * width, 0.30 * width, 0.66 * L), R), bind, "hoof", k * 0.25, fl, fur=0.0)
            dc = mcp + f * -0.30 * L + side * s * 0.40 * width + V(0, 0.02 * hm, 0)
            B.add(ell(dc, (0.085 * width, 0.11 * width, 0.15 * width), frame(V(0, -1, -0.6), side)), bone(bone_up), "hoof", k * 0.25, fl, fur=0.0)
        B.cut(obox(mcp + f * 0.85 * L + V(0, -0.2 * hm, 0), (0.012 * width, 0.5 * hm, 0.55 * L), frame(f, side)), 0.004)
        B.add(sphere(mcp + V(0, 0.08 * hm, 0) + f * 0.05 * L, 0.48 * width), bind, part, k)
        return
    k = 0.45 * hm
    # the knuckle mass over the toes, arched (higher in the middle toes)
    B.add(ell(mcp + V(0, 0.05 * hm, 0) + f * 0.10 * L, (0.44 * width, 0.62 * hm * knuckle, 0.42 * L)), bind, part, k * 0.7, fl)
    # the metacarpal (palm) pad under the knuckles, heart-shaped
    B.add(ell(mcp + V(0, -0.55 * hm, 0) + f * 0.05 * L, (0.36 * width, 0.40 * hm, 0.30 * L)), bone(bone_paw), "pad", k * 0.45, fl, 0.2)
    toes = []
    for s, ahead, ry in ((-1.0, 0.40, 0.92), (-0.36, 0.56, 1.0), (0.36, 0.56, 1.0), (1.0, 0.40, 0.92)):
        c = mcp + f * ahead * L + side * s * 0.34 * width
        c[1] = 0.48 * hm * ry
        # each toe a knuckled bulb, a groove between it and the next (tight blend), its pad under it
        B.add(ell(c, (0.19 * width, 0.50 * hm * ry, 0.27 * L), frame(f + V(0, -0.25, 0), side)), bone(bone_paw), part, k * 0.22, fl, 0.55)
        B.add(ell(c + V(0, -0.36 * hm, 0) + f * 0.02 * L, (0.15 * width, 0.22 * hm, 0.19 * L)), bone(bone_paw), "pad", k * 0.2, fl, 0.1)
        toes.append(c + f * 0.20 * L + V(0, 0.40 * hm * ry, 0))
    B.marks.setdefault("toes", []).append(toes)
    B.marks.setdefault("toe_dirs", []).append(f)
    B.marks.setdefault("toe_bones", []).append(bone_paw)


def leg_front(B, S_, r, pig=False):
    """The front leg from the shoulder blade down, in lofts and muscles at true size (r: sizes in metres)."""
    J = B.J
    sc, sh, el, ca, mc, to = (J[n + S_] for n in ("scapula", "shoulder", "elbow", "carpus", "fmcp", "ftoe"))
    sg = 1.0 if S_ == "L" else -1.0
    X = V(sg, 0, 0)
    bl = r["blend"]
    k = r["k"]
    bS = "scapula" + S_
    upper = chain([sc, sh, el, ca], [bS, "humerus" + S_, "forearm" + S_], bl)
    lower = chain([sh, el, ca, mc], ["humerus" + S_, "forearm" + S_, "pastern" + S_], bl)
    # the shoulder blade, flat on the ribs, its spine a ridge down the middle; the muscles over it
    mid_sc = sc + (sh - sc) * 0.52 + X * r["scap_out"]
    Rs = frame(sh - sc, side=(sg, 0, 0))
    B.add(ell(mid_sc, (r["scap_t"], r["scap_w"], np.linalg.norm(sh - sc) * 0.5), Rs), chain([sc, sh], [bS], bl), "shoulder", r["k_sc"],
          flow_chain([sc, sh, el]))
    B.add(ell(mid_sc + X * r["scap_t"] * 0.55, (r["scap_t"] * 0.55, r["scap_w"] * 0.22, np.linalg.norm(sh - sc) * 0.42), Rs),
          chain([sc, sh], [bS], bl), "shoulder", r["k_sc"] * 0.6, flow_chain([sc, sh, el]))
    # the upper arm: the point of the shoulder in front, the triceps filling the angle behind down to the elbow
    d_ua = el - sh
    B.add(lofted([(sh + V(0, r["ua_top"], 0) + X * r["ua_out"], r["ua_w"] * 0.9, r["ua_f"], r["ua_b"] * 0.75, 2.0),
                  (sh + d_ua * 0.4 + X * r["ua_out"], r["ua_w"], r["ua_f"] * 0.9, r["ua_b"], 2.0),
                  (sh + d_ua * 0.78 + X * r["ua_out"] * 0.6, r["ua_w"] * 0.92, r["ua_f"] * 0.8, r["ua_b"] * 0.8, 2.0),
                  (el + V(0, -0.012 * B.H, 0), r["fa_w"] * 1.02, r["ua_f"] * 0.7, r["fa_b"], 2.0)], side=(sg, 0, 0)),
          upper, "arm", k, flow_chain([sh, el, ca]))
    B.add(ell(sh + V(0, 0.002, 0.006) + X * r["ua_out"] * 0.8, (r["point"] * 0.95, r["point"], r["point"] * 0.9)),
          mix((bone("humerus" + S_), 0.6), (bone(bS), 0.4)), "arm", r["k_pt"], flow_chain([sh, el]))
    # the elbow point (olecranon) behind the joint
    olec = el + V(0, 0.004 * B.H, -r["olec"] * 0.8)
    B.add(ell(olec, (r["olec"] * 0.75, r["olec"] * 1.15, r["olec"])), chain([el, ca], ["forearm" + S_], bl), "leg", r["k_pt"],
          flow_chain([el, ca]))
    # the forearm: the extensors bulging in front below the elbow, a slender lower half; the carpus and its pad
    d_fa = ca - el
    B.add(lofted([(el + V(0, 0.02 * B.H, 0), r["fa_w"], r["fa_f"], r["fa_b"], 2.0),
                  (el + d_fa * 0.25, r["fa_w"] * 0.96, r["fa_f"] * 0.98, r["fa_b"] * 0.8, 2.0),
                  (el + d_fa * 0.62, r["fa_w"] * 0.72, r["fa_f"] * 0.66, r["fa_b"] * 0.62, 2.1),
                  (ca + V(0, 0.01 * B.H, 0), r["carpus"] * 0.92, r["carpus"] * 0.82, r["carpus"] * 0.82, 2.2)], side=(sg, 0, 0)),
          lower, "leg", r["k_leg"], flow_chain([el, ca, mc]))
    B.add(ell(ca, (r["carpus"], r["carpus"] * 0.95, r["carpus"] * 0.92)), chain([el, ca, mc], ["forearm" + S_, "pastern" + S_], r["carpus"] * 0.8),
          "leg", r["k_leg"] * 0.6, flow_chain([ca, mc]))
    if not pig:
        B.add(ell(ca + V(0, -r["carpus"] * 0.45, -r["carpus"] * 1.0), (r["carpus"] * 0.5, r["carpus"] * 0.6, r["carpus"] * 0.42)),
              bone("pastern" + S_), "pad", r["k_leg"] * 0.3, flow_chain([ca, mc]), 0.2)
        # the dewclaw on the inside of the pastern
        dw = ca + (mc - ca) * 0.55 - X * r["past"] * 0.9 + V(0, 0, -r["past"] * 0.3)
        B.add(ell(dw, (r["past"] * 0.32, r["past"] * 0.5, r["past"] * 0.35)), bone("pastern" + S_), "paw", r["k_leg"] * 0.25,
              flow_chain([ca, mc]), 0.4)
    d_p = mc - ca
    B.add(lofted([(ca + d_p * 0.1, r["past"], r["past"] * 0.82, r["past"] * 0.9, 2.1),
                  (ca + d_p * 0.6, r["past"] * 0.95, r["past"] * 0.8, r["past"] * 0.85, 2.1),
                  (mc + V(0, 0.01 * B.H, 0), r["past"] * 1.05, r["past"] * 0.85, r["past"] * 0.9, 2.1)], side=(sg, 0, 0)),
          chain([ca, mc, to], ["pastern" + S_, "fpaw" + S_], r["past"] * 0.8), "leg", r["k_leg"] * 0.5, flow_chain([ca, mc]))
    paw(B, S_, mc, to, r["paw"], "fpaw" + S_, "pastern" + S_, hoof=pig)


def leg_hind(B, S_, r, pig=False):
    J = B.J
    hp, st, ho, mc, to = (J[n + S_] for n in ("hip", "stifle", "hock", "hmcp", "htoe"))
    sg = 1.0 if S_ == "L" else -1.0
    X = V(sg, 0, 0)
    bl = r["blend"]
    k = r["k"]
    H = B.H
    thigh_b = chain([J["hips"], hp, st, ho], ["hips", "thigh" + S_, "shin" + S_], bl)
    # the thigh: the quadriceps in front of the femur, the big hamstrings behind it from the seat bone down
    d_t = st - hp
    B.add(lofted([(hp + V(0, r["th_top"], -r["th_back"] * 0.3) + X * r["th_out"] * 1.4, r["th_w"] * 0.7, r["th_f"] * 0.75, r["th_b"] * 0.8, 2.0),
                  (hp + d_t * 0.35 + X * r["th_out"], r["th_w"], r["th_f"], r["th_b"], 2.0),
                  (hp + d_t * 0.72 + X * r["th_out"] * 0.7, r["th_w"] * 0.86, r["th_f"] * 0.82, r["th_b"] * 0.85, 2.0),
                  (st + V(0, 0.0, -0.005 * H), r["ga_w"] * 1.15, r["ga_f"] * 1.5, r["ga_b"] * 1.3, 2.0),
                  (st + (ho - st) * 0.12, r["ga_w"] * 1.0, r["ga_f"] * 1.1, r["ga_b"] * 1.1, 2.0)], side=(sg, 0, 0)),
          thigh_b, "thigh", k, flow_chain([hp, st, ho]))
    seat = r["seat"]
    B.add(lofted([(seat + X * 0.0, r["hm_w"] * 0.9, r["hm_r"] * 0.8, r["hm_r"] * 0.8, 2.0),
                  (seat + (st - seat) * 0.42 + V(0, 0, -r["hm_r"] * 0.7) - X * r["hm_w"] * 0.2, r["hm_w"] * 1.15, r["hm_r"], r["hm_r"] * 1.1, 2.0),
                  (st + (ho - st) * 0.25 + V(0, 0, -r["ga_b"] * 0.7), r["ga_w"] * 0.9, r["ga_b"] * 0.8, r["ga_b"] * 0.8, 2.0)], side=(sg, 0, 0)),
          mix((thigh_b, 0.8), (bone("hips"), 0.2)), "thigh", k * 0.8, flow_chain([seat, st, ho]))
    # the kneecap in front of the stifle
    B.add(ell(st + unit(st - hp) * 0.006 * H + V(0, 0.004 * H, r["ga_f"] * 0.9), (r["ga_w"] * 0.55, r["ga_f"] * 0.9, r["ga_f"] * 0.55)),
          chain([hp, st, ho], ["thigh" + S_, "shin" + S_], bl), "leg", r["k_pt"], flow_chain([st, ho]))
    # the gaskin: the calf muscle bulging behind the upper shin, the shin bony in front; the hock tendon behind
    d_g = ho - st
    B.add(lofted([(st + V(0, -0.006 * H, 0), r["ga_w"], r["ga_f"], r["ga_b"], 2.0),
                  (st + d_g * 0.3, r["ga_w"] * 0.96, r["ga_f"] * 0.9, r["ga_b"] * 1.08, 2.0),
                  (st + d_g * 0.66, r["ga_w"] * 0.66, r["ga_f"] * 0.7, r["ga_b"] * 0.55, 2.1),
                  (ho + V(0, 0.01 * H, 0), r["hock"] * 0.9, r["hock"] * 0.75, r["hock"] * 0.8, 2.1)], side=(sg, 0, 0)),
          chain([hp, st, ho, mc], ["thigh" + S_, "shin" + S_, "meta" + S_], bl), "leg", r["k_leg"], flow_chain([st, ho, mc]))
    tg = unit(ho - st)
    back_g = unit(V(0, 0, -1) - tg * float(tg @ V(0, 0, -1)))  # behind the shin, square to it, in the leg's plane
    calc = ho + back_g * r["hock"] * 1.25 + V(0, r["hock"] * 0.5, 0)
    B.add(ell(calc, (r["hock"] * 0.55, r["hock"] * 0.8, r["hock"] * 0.6)), chain([st, ho, mc], ["shin" + S_, "meta" + S_], r["hock"]),
          "leg", r["k_pt"] * 0.7, flow_chain([ho, mc]))
    calf = st + d_g * 0.42 + back_g * r["ga_b"] * 0.75
    B.add(tube([calc + V(0, r["hock"] * 0.3, 0), calf], [r["hock"] * 0.42, r["ga_b"] * 0.45]), chain([st, ho], ["shin" + S_], bl), "leg",
          r["k_leg"] * 0.5, flow_chain([st, ho]))
    B.add(ell(ho, (r["hock"] * 0.95, r["hock"] * 0.9, r["hock"] * 0.9)), chain([st, ho, mc], ["shin" + S_, "meta" + S_], r["hock"]), "leg",
          r["k_leg"] * 0.5, flow_chain([ho, mc]))
    d_m = mc - ho
    B.add(lofted([(ho + d_m * 0.12, r["meta"], r["meta"] * 0.8, r["meta"] * 0.95, 2.1),
                  (ho + d_m * 0.6, r["meta"] * 0.92, r["meta"] * 0.78, r["meta"] * 0.88, 2.1),
                  (mc + V(0, 0.01 * H, 0), r["meta"] * 1.02, r["meta"] * 0.85, r["meta"] * 0.85, 2.1)], side=(sg, 0, 0)),
          chain([ho, mc, to], ["meta" + S_, "hpaw" + S_], r["meta"] * 0.8), "leg", r["k_leg"] * 0.5, flow_chain([ho, mc]))
    paw(B, S_, mc, to, r["paw"], "hpaw" + S_, "meta" + S_, hoof=pig)


def torso_bind(J, blend):
    return by_z([-9, (J["hips"][2] + J["spine"][2]) / 2 + 0.0, (J["spine"][2] + J["chest"][2]) / 2, 9], ["hips", "spine", "chest"], blend)


def tail(B, radii, part="tail", fur=1.0, k=0.0, flat=1.0):
    J = B.J
    pts = [J["tail%d" % i] for i in range(6)]
    from .anatomy import TAIL
    st = [(pts[i], radii[i], radii[i] * flat, radii[i] * flat, 2.0) for i in range(6)]
    B.add(lofted(st, side=(1, 0, 0), per=6), chain(pts, TAIL, 0.35 * float(np.linalg.norm(pts[1] - pts[0]))), part, k * 1.6, flow_chain(pts), fur)


def eye(Bd, c, look, er, R, sink, k, lids=(1.14, 0.80)):
    """An eye: find the skin along the look from inside the head, sink the ball so a cap of it shows."""
    t = np.linspace(-0.5 * er, 14 * er, 400)
    pts = c[None, :] + t[:, None] * look[None, :]
    d = Bd.base(pts)
    # the last way out along the look (a crease between two shapes is not the skin)
    inside = np.nonzero(d <= 0)[0]
    skin = pts[min(inside[-1] + 1, len(pts) - 1)] if len(inside) else c
    centre = skin - look * er * sink
    Bd.marks.setdefault("eyes", []).append((centre, look, er, lids))


def seat_ears(Bd, y, z, sink=0.012):
    """Put the ear bases on the skull: at height y and z (head units), where the skin is going out sideways."""
    o, R, L = Bd.marks["head"]
    xs = np.linspace(0.0, 0.6, 300)
    for S_, sg in (("L", 1.0), ("R", -1.0)):
        pts = np.array([o + R @ (np.array((sg * x, y, z)) * L) for x in xs])
        inside = np.nonzero(Bd.base(pts) <= 0)[0]
        x = xs[inside[-1]] if len(inside) else 0.2
        Bd.J["ear" + S_] = o + R @ (np.array((sg * max(x - sink, 0.0), y, z)) * L)


def head_frame(J):
    h, n = J["head"], J["nose"]
    R = frame(n - h)
    return h, R, float(np.linalg.norm(n - h))


def hp(J, x, y, z):
    o, R, L = head_frame(J)
    return o + R @ (np.array((x, y, z)) * L)


# ---------------------------------------------------------------- the dog

# Trunk profile of the street dog in shoulder heights (z unmapped: before the breed's body length), from the point of
# the buttock to the forechest: z, top line, under line, the height of the widest line, half-width.
DOG_TRUNK = [
    (-0.625, 0.868, 0.776, 0.830, 0.060),
    (-0.555, 0.918, 0.680, 0.805, 0.112),
    (-0.440, 0.946, 0.640, 0.800, 0.132),
    (-0.300, 0.952, 0.655, 0.815, 0.124),
    (-0.160, 0.954, 0.592, 0.800, 0.140),
    (-0.020, 0.956, 0.520, 0.775, 0.156),
    (0.130, 0.966, 0.482, 0.758, 0.160),
    (0.280, 0.990, 0.478, 0.748, 0.150),
    (0.400, 0.962, 0.508, 0.742, 0.134),
    (0.500, 0.890, 0.572, 0.732, 0.108),
    (0.575, 0.800, 0.648, 0.722, 0.062),
]


def dog(rig):
    Bd = Body(rig)
    J, H, P = Bd.J, rig["H"], rig["P"]
    g, dp, bk = P["girth"], P["deep"], P["bone"]
    L_, leg = P["L"], P["leg"]
    tuck, slope, nk = P.get("tuck", 0.0), P.get("slope", 0.0), P.get("neck", 1.0)
    elbow_y = 0.52

    def zz(z):  # body length behind the shoulders
        return (0.40 + (z - 0.40) * L_) * H if z < 0.40 else z * H

    def yy(y):  # longer legs lift the body
        return (y + elbow_y * (leg - 1)) * H

    tb = torso_bind(J, 0.09 * H)
    back = flow_trunk(yy(0.95), 0.6)
    k = 0.06 * H
    st = []
    for z, T, U, yc, W in DOG_TRUNK:
        T = T + slope * (z - 0.1)
        depth = T - U
        if z > -0.25:
            U = T - depth * dp
        else:
            U = U + tuck * smooth(-0.45, -0.3, z) * smooth(-0.1, -0.24, z) * 1.0
        yc = T - (T - yc) * (dp if z > -0.25 else 1.0)
        sq = 2.15 if z > -0.1 else 2.3
        st.append((V(0, yy(yc), zz(z)), W * g * H, (T - yc) * H, (yc - U) * H, sq))
    Bd.add(lofted(st, side=(1, 0, 0), per=6), tb, "torso", 0.0, back)
    # the forechest: the point of the breastbone between the shoulders
    Bd.add(ell(V(0, yy(0.70), zz(0.52)), (0.065 * H * g, 0.06 * H * dp, 0.05 * H)), mix((bone("chest"), 0.85), (bone("neck"), 0.15)),
           "chest", 0.07 * H, flow_back(0.8))
    # the withers: the tops of the shoulder blades either side of the spine
    Bd.add(ell(V(0, yy(0.975), zz(0.29)), (0.085 * H * g, 0.035 * H, 0.12 * H)), bone("chest"), "torso", 0.04 * H, back)
    # the loin's muscles either side of the spine, and the hip bones (the points of the hip) under the skin
    for s in (-1, 1):
        Bd.add(ell(V(s * 0.05 * H * g, yy(0.935), zz(-0.20)), (0.045 * H * g, 0.03 * H, 0.2 * H)), tb, "torso", 0.03 * H, back)
        Bd.add(ell(V(s * 0.085 * H * g, yy(0.915), zz(-0.40)), (0.03 * H, 0.025 * H, 0.04 * H)), bone("hips"), "torso", 0.04 * H, back)
    # the belly floor under the last ribs
    Bd.add(ell(V(0, yy(0.60), zz(-0.08)), (0.09 * H * g, 0.06 * H, 0.18 * H)), tb, "belly", 0.05 * H, flow_back(0.9))
    rf = dict(blend=0.05 * H, k=0.075 * H, k_sc=0.07 * H, k_pt=0.03 * H, k_leg=0.03 * H,
              scap_t=0.02 * H * g, scap_w=0.08 * H, scap_out=-0.012 * H,
              ua_top=0.03 * H, ua_out=-0.03 * H, ua_w=0.047 * H * bk, ua_f=0.046 * H * bk, ua_b=0.095 * H * bk, point=0.04 * H * bk,
              olec=0.03 * H * bk, fa_w=0.046 * H * bk, fa_f=0.046 * H * bk, fa_b=0.046 * H * bk, carpus=0.033 * H * bk,
              past=0.03 * H * bk, paw=0.10 * H * bk)
    rh = dict(blend=0.05 * H, k=0.08 * H, k_pt=0.025 * H, k_leg=0.035 * H,
              th_top=0.0 * H, th_back=0.02 * H, th_out=-0.035 * H, th_w=0.066 * H * g, th_f=0.088 * H, th_b=0.12 * H,
              hm_w=0.068 * H * g, hm_r=0.062 * H, ga_w=0.048 * H * bk, ga_f=0.034 * H * bk, ga_b=0.06 * H * bk,
              hock=0.03 * H * bk, meta=0.029 * H * bk, paw=0.094 * H * bk)
    for S_ in "LR":
        sg = 1 if S_ == "L" else -1
        leg_front(Bd, S_, rf)
        rh["seat"] = V(sg * 0.07 * H * g, yy(0.80), zz(-0.60))
        leg_hind(Bd, S_, rh)
    # the neck: from the shoulders up to the skull; the crest on top, the throat under it
    nb, n2, hd, ch = J["neck"], J["neck2"], J["head"], J["chest"]
    neck_b = chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.06 * H)
    p0 = V(0, yy(0.80), zz(0.32))
    p1 = V(0, yy(0.875), 0.48 * H)
    p2 = (n2 + hd) / 2 + V(0, -0.02 * H, -0.03 * H)
    p3 = hd + V(0, -0.06 * H, 0.03 * H)
    Bd.add(lofted([(p0, 0.155 * H * g * nk, 0.15 * H * nk, 0.18 * H * nk, 2.0), (p1, 0.138 * H * g * nk, 0.13 * H * nk, 0.16 * H * nk, 2.0),
                   (p2, 0.112 * H * nk, 0.1 * H * nk, 0.12 * H * nk, 2.0), (p3, 0.092 * H * nk, 0.08 * H * nk, 0.1 * H * nk, 2.0)], side=(1, 0, 0)),
           neck_b, "neck", 0.08 * H, flow_chain([hd, n2, nb, ch]))
    # the throat's skin and the windpipe under the neck
    Bd.add(ell_along(nb + V(0, -0.08 * H, 0.04 * H), hd + V(0, -0.12 * H, 0.03 * H), 0.05 * H * g * nk, 0.05 * H * nk, 1.0, 0.5),
           chain([nb, n2, hd], ["neck", "neck2"], 0.06 * H), "throat", 0.04 * H, flow_chain([hd, nb]))
    dog_head(Bd, P)
    # the tail
    if P["tail"] == "bob":
        Bd.add(ell(J["tail0"] + V(0, -0.02 * H, 0.025 * H), (0.075 * H, 0.06 * H, 0.05 * H)), mix((bone("hips"), 0.7), (bone("tail1"), 0.3)), "torso", 0.03 * H, back)
    else:
        r0 = {"long": 0.044, "docked": 0.046}[P["tail"]] * H * (1.2 if rig["name"] == "draught" else 1.0)
        tail(Bd, [r0, r0 * 0.88, r0 * 0.74, r0 * 0.6, r0 * 0.46, r0 * 0.26 if P["tail"] == "long" else r0 * 0.52], k=0.03 * H)
    # coats that change the outline: the Schipperke's ruff, cape and culottes, the terrier's beard, brows and furnishings
    reliefs = []
    if P["coat"] == "ruff":
        ruff_prims = len(Bd.prims)
        Bd.add(lofted([(p0 + V(0, 0.02 * H, -0.02 * H), 0.2 * H, 0.2 * H, 0.21 * H, 2.0), (p1 + V(0, 0.01 * H, 0), 0.19 * H, 0.18 * H, 0.2 * H, 2.0),
                       (p2 + V(0, 0.0, -0.02 * H), 0.165 * H, 0.15 * H, 0.17 * H, 2.0), (p3 + V(0, 0.0, -0.035 * H), 0.12 * H, 0.1 * H, 0.12 * H, 2.0)], side=(1, 0, 0)),
               neck_b, "ruff", 0.06 * H, flow_chain([hd, n2, nb, ch]), 1.7)
        # the cape over the shoulders
        Bd.add(ell(V(0, yy(0.93), zz(0.22)), (0.15 * H, 0.08 * H, 0.16 * H)), mix((bone("chest"), 0.8), (bone("neck"), 0.2)), "ruff", 0.06 * H,
               back, 1.5)
        for S_ in "LR":
            sg = 1 if S_ == "L" else -1
            Bd.add(ell(J["hip" + S_] + V(-sg * 0.01 * H, -0.15 * H, -0.13 * H), (0.045 * H, 0.12 * H, 0.05 * H)),
                   mix((bone("thigh" + S_), 0.8), (bone("hips"), 0.2)), "culotte", 0.05 * H, flow_back(1.4), 1.6)
        long_prims = Bd.prims[ruff_prims:]

        def long_coat(p, prs=long_prims):
            d = np.min(np.stack([pr.eval(p) for pr in prs], 1), axis=1)
            return smooth(0.03 * H, -0.01 * H, d)
        reliefs.append(tufts(long_coat, lambda p: np.tile(V(0, -0.6, -1.0), (len(p), 1)), 0.022 * H / 0.32 * 0.32, 0.012 * H / 0.32 * 0.32))
    if P["coat"] == "wire":
        Ln = float(np.linalg.norm(J["nose"] - J["head"]))
        beard_at = len(Bd.prims)
        Bd.add(ell(hp(J, 0, -0.2, 0.86), np.array((0.075, 0.07, 0.11)) * Ln), bone("jaw"), "beard", 0.03 * H,
               flow_along(V(0, 0, 0), V(0, -1, 0.4)), 1.4)
        for s in (-1, 1):
            # the brows' long wiry hair over each eye
            Bd.add(ell(hp(J, s * 0.11, 0.15, Bd.marks["stop"] - 0.06), np.array((0.06, 0.035, 0.06)) * Ln), bone("head"), "beard", 0.02 * H,
                   flow_along(V(0, 0, 0), V(0, 0.3, 1)), 1.3)
        wire_prims = Bd.prims[beard_at:]

        def wiry(p, prs=wire_prims):
            d = np.min(np.stack([pr.eval(p) for pr in prs], 1), axis=1)
            return smooth(0.02 * H, -0.005 * H, d)
        reliefs.append(tufts(wiry, lambda p: np.tile(V(0, -1.0, 0.3), (len(p), 1)), 0.012 * H, 0.008 * H, seed=11))
    if reliefs:
        Bd.relief = lambda p, rs=reliefs: sum(r(p) for r in rs)
    return Bd


def dog_head(Bd, P):
    """The dog's head as one wedge from the occiput to the nose (its cross-sections give the skull's dome, the stop,
    the straight bridge of the muzzle, the jaw line and the breadth at the cheekbones), with what shows through the
    skin laid on: the brows over the eyes (they make the stop), the cheekbones, the chewing muscles, the lips hanging
    at the sides, the nose leather with its nostrils, the mouth's line."""
    J, H = Bd.J, Bd.H
    o, R, L = head_frame(J)
    sk = P["skull"]
    u = 1.0 / (0.42 + 0.58 * P["muzzle"])
    zs = min(0.62, 0.43 * u)  # the stop, from the atlas
    sw = P.get("skull_w", 1.0)
    mw, md = P.get("muzzle_w", 1.0), P.get("muzzle_d", 1.0)
    flews = bool(P.get("flews"))
    stop = P.get("stop", 1.0)
    dome = P.get("dome", 1.0)

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))
    side = R[:, 0]
    # the wedge: z (from the atlas), top line, under line, half-width (head lengths); squareness. The skull domes
    # behind the brows, the stop drops to the bridge, the bridge runs straight to the nose; the jaw line rises gently
    # to the chin; the breadth is greatest at the cheekbones
    m0 = zs + 0.12
    fl = 0.03 if flews else 0.0
    zf = 0.975
    prof = [(-0.085, 0.15 * dome, -0.01, 0.085 * sw, 2.0),
            (0.0, 0.205 * dome, -0.15, 0.17 * sw, 2.0),
            (0.15 * u, 0.232 * dome, -0.24, 0.235 * sw, 2.0),
            (0.3 * u, 0.222 * dome, -0.245, 0.252 * sw, 2.05),
            (zs - 0.08, 0.185 * dome, -0.24, 0.236 * (sw + mw) / 2, 2.1),
            (zs - 0.02, 0.14 + 0.03 * (dome - 1) + 0.01 * (stop - 1), -0.236 - fl * 0.5, 0.21 * mw, 2.2),
            (zs + 0.05, 0.1, -0.232 * md - fl, 0.188 * mw, 2.3),
            (m0, 0.086, -0.225 * md - fl, 0.17 * mw, 2.35),
            (zs + 0.6 * (zf - zs), 0.072, -0.21 * md - fl, 0.148 * mw, 2.4),
            (0.93, 0.058, -0.19 * md - fl * 0.6, 0.124 * mw, 2.4),
            (0.99, 0.04, -0.155 * md, 0.09 * mw, 2.3)]
    wedge = [(z, (t + b) / 2, w, (t - b) / 2, (t - b) / 2, e) for z, t, b, w, e in prof]
    Bd.add(lofted([(at(0, y, z), w * L, a * L, b * L, e) for z, y, w, a, b, e in wedge], side=side, per=6), hb, "head", 0.0, fl_back)
    # the occipital crest down the middle of the skull, faint
    Bd.add(tube([at(0, 0.165 * dome, -0.06), at(0, 0.215 * dome, 0.08 * u), at(0, 0.21 * dome, 0.2 * u)], [0.03 * L, 0.035 * L, 0.025 * L]), hb, "head",
           0.02 * L, fl_back)
    for s in (-1, 1):
        # the brow over each eye: the forehead steps down from it to the bridge (the stop)
        Bd.add(ell(at(s * 0.1 * sw, 0.15 + 0.02 * stop, zs - 0.075), np.array((0.075 * sw, 0.035 + 0.01 * stop, 0.07)) * L, R), hb, "head",
               0.035 * L, fl_back)
        # the cheekbone under and behind the eye, the widest line of the skull
        Bd.add(tube([at(s * 0.2 * sw, -0.03, 0.12 * u), at(s * 0.245 * sw, -0.025, 0.27 * u), at(s * 0.2 * (sw + mw) / 2, -0.02, zs - 0.04),
                     at(s * 0.16 * mw, -0.04, zs + 0.08)], [0.04 * L, 0.048 * L, 0.04 * L, 0.03 * L]), hb, "head", 0.04 * L, fl_back)
        # the chewing muscle over the jaw's angle
        Bd.add(ell(at(s * 0.17 * sw, -0.12, 0.17 * u), np.array((0.075 * sw, 0.12, 0.13)) * L, R), mix((hb, 0.6), (bone("jaw"), 0.4)), "head",
               0.04 * L, fl_back)
        # the upper lips hanging at the sides over the lower jaw, deepest at the mouth's corner (the flews of the
        # mastiff kind hang well below the jaw line)
        lw = 0.045 * mw * (1.25 if flews else 1.0)
        Bd.add(lofted([(at(s * (0.162 * mw - 0.035), -0.13, m0 - 0.08), lw * L, 0.04 * L, (0.05 + 2 * fl) * L, 2.0),
                       (at(s * (0.148 * mw - 0.035), -0.14 - fl, m0 + 0.15), lw * L, 0.05 * L, (0.06 + 2 * fl) * L, 2.0),
                       (at(s * (0.125 * mw - 0.035), -0.12 - fl * 0.6, 0.9), lw * 0.9 * L, 0.04 * L, (0.05 + 1.5 * fl) * L, 2.0)], side=side),
               hb, "muzzle", 0.02 * L, lambda p: np.tile(unit(-R[:, 2] - R[:, 1] * 0.6), (len(p), 1)), 0.7)
    # the lower jaw from under the ear to the chin, its rami showing under the cheeks
    jb = chain([J["jaw"], J["chin"]], ["jaw"], 0.01)
    Bd.add(lofted([(at(0, -0.2, 0.1 * u), 0.16 * sw * L, 0.05 * L, 0.06 * L, 2.0), (at(0, -0.2 - fl, zs + 0.1), 0.11 * mw * L, 0.04 * L, 0.045 * L, 2.0),
                   (at(0, -0.175 - fl * 0.5, 0.88), 0.08 * mw * L, 0.035 * L, 0.035 * L, 2.0), (at(0, -0.16, 0.95), 0.055 * mw * L, 0.03 * L, 0.028 * L, 2.0)],
                  side=side), jb, "jaw", 0.025 * L, fl_back, 0.8)
    # the mouth: its line along the sides between lip and jaw, and the corner
    mz_c, mz_r = zs + 0.55 * (zf - zs), 0.42 * (zf - zs)
    # (the lip line is where the hanging lips meet the jaw: a crease of the blend, darkened in the picture)
    # the nose leather: its top on the line of the bridge, standing a little proud of the front; nostrils open to the
    # front and the sides; the groove down its middle into the lip
    nz = 0.99
    Bd.add(lofted([(at(0, 0.0, nz - 0.07), 0.085 * mw * L, 0.05 * L, 0.055 * L, 2.1), (at(0, 0.008, nz - 0.005), 0.098 * mw * L, 0.06 * L, 0.058 * L, 2.1),
                   (at(0, 0.004, nz + 0.022), 0.085 * mw * L, 0.05 * L, 0.048 * L, 2.0), (at(0, 0.0, nz + 0.038), 0.05 * mw * L, 0.03 * L, 0.03 * L, 2.0)],
                  side=side), hb, "nose", 0.02 * L, fl_back, 0.0)
    for s in (-1, 1):
        # the nostrils: commas on the front, opening out to the sides
        Bn = frame(R @ np.array((s * 0.55, -0.05, 1.0)), side=R @ np.array((1.0, -s * 0.6, 0.0)))
        Bd.cut(ell(at(s * 0.038 * mw, -0.006, nz + 0.03), np.array((0.024, 0.009, 0.016)) * L, Bn), 0.004 * L)
    Bd.cut(ell(at(0, -0.04, nz + 0.03), np.array((0.006, 0.04, 0.02)) * L, R), 0.004 * L)
    # the eyes: at the stop under the brows, looking forward and a little out, each in a shallow socket so the lids
    # lie round it (no goggle)
    er = 0.046 * L / max(sk, 0.9) ** 0.5
    for s in (-1, 1):
        eye(Bd, at(s * 0.135 * sw, 0.1, zs - 0.07), unit(R @ np.array((s * 0.42, 0.06, 1.0))), er, R, 0.86, 0.004 * H, lids=(1.22, 0.8))
    for c_, look_, er_, lids_ in Bd.marks["eyes"]:
        Bd.cut(ell(c_ + look_ * er_ * 0.55, (er_ * 1.12, er_ * 1.12, er_ * 0.6), frame(look_)), er_ * 0.35)
    Bd.marks["nose"] = at(0, 0.0, 1.03)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.135 - fl, mz_c), np.array((0.2 * mw, 0.008, mz_r)) * L, R)
    Bd.marks["stop"] = zs
    ey, ez = {"drop": (0.13, 0.1), "drop_small": (0.15, 0.1), "semi": (0.15, 0.1), "button": (0.17, 0.08), "prick": (0.17, 0.13)}[P["ears"]]
    seat_ears(Bd, ey * dome, ez * u)


# ---------------------------------------------------------------- the cat

CAT_TRUNK = [  # z, top, under, widest, half-width (metres; the alley cat, 0.25 m at the shoulder)
    (-0.205, 0.207, 0.170, 0.190, 0.016),
    (-0.180, 0.222, 0.128, 0.180, 0.040),
    (-0.135, 0.230, 0.118, 0.178, 0.047),
    (-0.085, 0.231, 0.125, 0.183, 0.045),
    (-0.030, 0.228, 0.122, 0.180, 0.050),
    (0.020, 0.226, 0.122, 0.180, 0.052),
    (0.065, 0.234, 0.128, 0.183, 0.049),
    (0.100, 0.232, 0.140, 0.188, 0.043),
    (0.128, 0.205, 0.160, 0.185, 0.028),
]


def cat(rig):
    Bd = Body(rig)
    J, H = Bd.J, rig["H"]
    tb = torso_bind(J, 0.08 * H)
    back = flow_trunk(0.23, 0.6)
    st = [(V(0, yc, z), w, T - yc, yc - U, 2.15) for z, T, U, yc, w in CAT_TRUNK]
    Bd.add(lofted(st, per=6), tb, "torso", 0.0, back)
    # the loose belly skin low behind (the primordial pouch)
    Bd.add(ell(V(0, 0.128, -0.10), (0.032, 0.022, 0.05)), tb, "belly", 0.012, flow_back(0.9))
    Bd.add(ell(V(0, 0.235, 0.068), (0.026, 0.012, 0.04)), bone("chest"), "torso", 0.01, back)
    rf = dict(blend=0.012, k=0.018, k_sc=0.014, k_pt=0.006, k_leg=0.008, scap_t=0.007, scap_w=0.022, scap_out=-0.002,
              ua_top=0.006, ua_out=-0.006, ua_w=0.015, ua_f=0.012, ua_b=0.022, point=0.011, olec=0.007, fa_w=0.0125, fa_f=0.012,
              fa_b=0.012, carpus=0.0095, past=0.0088, paw=0.031)
    rh = dict(blend=0.014, k=0.02, k_pt=0.005, k_leg=0.008, th_top=0.0, th_back=0.006, th_out=-0.006, th_w=0.024, th_f=0.026,
              th_b=0.036, hm_w=0.019, hm_r=0.018, ga_w=0.016, ga_f=0.011, ga_b=0.02, hock=0.0075, meta=0.0085, paw=0.029)
    for S_ in "LR":
        sg = 1 if S_ == "L" else -1
        leg_front(Bd, S_, rf)
        rh["seat"] = V(sg * 0.018, 0.19, -0.2)
        leg_hind(Bd, S_, rh)
    nb, n2, hd, ch = J["neck"], J["neck2"], J["head"], J["chest"]
    Bd.add(lofted([(V(0, 0.19, 0.085), 0.038, 0.034, 0.04, 2.0), (V(0, 0.2, 0.125), 0.034, 0.03, 0.034, 2.0),
                   ((n2 + hd) / 2 + V(0, -0.006, -0.006), 0.03, 0.026, 0.03, 2.0), (hd + V(0, -0.01, 0.0), 0.027, 0.022, 0.026, 2.0)]),
           chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.014), "neck", 0.014, flow_chain([hd, n2, nb, ch]))
    cat_head(Bd)
    tail(Bd, [0.0125, 0.0115, 0.0108, 0.0102, 0.0095, 0.0078], k=0.008)
    return Bd


def cat_head(Bd):
    """The cat's head: a round skull widest at the cheekbones, a short face, big eyes set forward, two full whisker
    pads over a small chin, a small nose; its ears big and upright on the top corners."""
    J, H = Bd.J, Bd.H
    o, R, L = head_frame(J)

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))
    side = R[:, 0]
    prof = [(-0.06, 0.22, -0.02, 0.17), (0.05, 0.3, -0.13, 0.3), (0.2, 0.335, -0.19, 0.36), (0.35, 0.33, -0.21, 0.39),
            (0.5, 0.31, -0.2, 0.37), (0.62, 0.27, -0.185, 0.32), (0.72, 0.2, -0.17, 0.24), (0.83, 0.13, -0.155, 0.17),
            (0.93, 0.08, -0.13, 0.11), (0.99, 0.05, -0.09, 0.05)]
    Bd.add(lofted([(at(0, (t + b) / 2, z), w * L, (t - b) / 2 * L, (t - b) / 2 * L, 2.0) for z, t, b, w in prof], side=side), hb, "head", 0.0, fl_back)
    for s in (-1, 1):
        # the whisker pads, full and round, either side of the groove under the nose
        Bd.add(ell(at(s * 0.072, -0.06, 0.86), np.array((0.08, 0.075, 0.085)) * L, R), hb, "muzzle", 0.025 * L,
               lambda p: np.tile(unit(-R[:, 2]), (len(p), 1)), 0.5)
        # the brow over each eye
        Bd.add(ell(at(s * 0.17, 0.28, 0.52), np.array((0.1, 0.045, 0.09)) * L, R), hb, "head", 0.05 * L, fl_back)
    # the small chin and the lower jaw under the pads
    Bd.add(lofted([(at(0, -0.13, 0.3), 0.16 * L, 0.05 * L, 0.06 * L, 2.0), (at(0, -0.15, 0.6), 0.11 * L, 0.04 * L, 0.05 * L, 2.0),
                   (at(0, -0.155, 0.83), 0.06 * L, 0.035 * L, 0.04 * L, 2.0)], side=side), chain([J["jaw"], J["chin"]], ["jaw"], 0.005), "jaw",
           0.03 * L, fl_back, 0.8)
    # the nose leather: a small rounded triangle at the tip of the bridge
    Bd.add(ell(at(0, 0.045, 0.985), np.array((0.05, 0.034, 0.03)) * L, R), hb, "nose", 0.012 * L, fl_back, 0.0)
    er = 0.11 * L
    for s in (-1, 1):
        eye(Bd, at(s * 0.17, 0.165, 0.5), unit(R @ np.array((s * 0.3, 0.06, 1.0))), er, R, 0.74, 0.0016, lids=(1.16, 0.9))
    for c_, look_, er_, lids_ in Bd.marks["eyes"]:
        Bd.cut(ell(c_ + look_ * er_ * 0.5, (er_ * 1.08, er_ * 1.0, er_ * 0.55), frame(look_)), er_ * 0.3)
    Bd.marks["nose"] = at(0, 0.05, 1.0)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.11, 0.78), np.array((0.07, 0.012, 0.11)) * L, R)
    Bd.marks["stop"] = 0.62
    seat_ears(Bd, 0.27, 0.27)


# ---------------------------------------------------------------- the pig

PIG_TRUNK = [  # z, top, under, widest, half-width (metres; the Kempen pig, 0.72 m at the back)
    (-0.715, 0.655, 0.545, 0.600, 0.050),
    (-0.660, 0.700, 0.420, 0.575, 0.118),
    (-0.540, 0.728, 0.375, 0.560, 0.145),
    (-0.400, 0.738, 0.360, 0.555, 0.150),
    (-0.240, 0.744, 0.340, 0.548, 0.158),
    (-0.060, 0.746, 0.330, 0.545, 0.160),
    (0.110, 0.742, 0.340, 0.548, 0.158),
    (0.260, 0.732, 0.360, 0.552, 0.152),
    (0.390, 0.705, 0.400, 0.560, 0.135),
    (0.470, 0.672, 0.440, 0.565, 0.110),
]


def pig(rig):
    Bd = Body(rig)
    J, H = Bd.J, rig["H"]
    tb = torso_bind(J, 0.07 * H)
    back = flow_trunk(0.74, 0.5)
    st = [(V(0, yc, z), w, T - yc, yc - U, 2.45) for z, T, U, yc, w in PIG_TRUNK]
    Bd.add(lofted(st, per=6), tb, "torso", 0.0, back)
    rf = dict(blend=0.03, k=0.06, k_sc=0.05, k_pt=0.02, k_leg=0.025, scap_t=0.025, scap_w=0.08, scap_out=-0.01,
              ua_top=0.02, ua_out=-0.02, ua_w=0.065, ua_f=0.06, ua_b=0.09, point=0.045, olec=0.032, fa_w=0.052, fa_f=0.047, fa_b=0.047,
              carpus=0.038, past=0.034, paw=0.078)
    rh = dict(blend=0.03, k=0.07, k_pt=0.02, k_leg=0.025, th_top=0.0, th_back=0.03, th_out=-0.025, th_w=0.085, th_f=0.09, th_b=0.13,
              hm_w=0.08, hm_r=0.075, ga_w=0.056, ga_f=0.038, ga_b=0.06, hock=0.032, meta=0.034, paw=0.078)
    for S_ in "LR":
        sg = 1 if S_ == "L" else -1
        leg_front(Bd, S_, rf, pig=True)
        rh["seat"] = V(sg * 0.07, 0.58, -0.69)
        leg_hind(Bd, S_, rh, pig=True)
    nb, n2, hd, ch = J["neck"], J["neck2"], J["head"], J["chest"]
    neck_b = chain([ch, nb, n2, hd], ["chest", "neck", "neck2"], 0.05)
    Bd.add(lofted([(V(0, 0.56, 0.36), 0.14, 0.15, 0.17, 2.3), (V(0, 0.575, 0.46), 0.125, 0.12, 0.16, 2.3), ((n2 + hd) / 2 + V(0, -0.02, 0), 0.115, 0.1, 0.15, 2.2),
                   (hd + V(0, -0.03, 0.02), 0.1, 0.08, 0.13, 2.1)]), neck_b, "neck", 0.05, flow_chain([hd, n2, nb, ch]))
    # the jowls under the jaw, heavy, in two soft folds
    for i, (dz, dy, r_) in enumerate(((-0.02, -0.15, 0.085), (0.05, -0.15, 0.07))):
        Bd.add(ell(hd + V(0, dy, dz), (0.1 - 0.015 * i, r_, 0.08)), mix((bone("neck2"), 0.5), (bone("head"), 0.3), (bone("jaw"), 0.2)), "throat", 0.025,
               flow_back(0.8))
    pig_head(Bd)
    tail(Bd, [0.015, 0.011, 0.0095, 0.0085, 0.008, 0.012], k=0.006, fur=0.4)
    return Bd


def pig_head(Bd):
    """The Kempen pig's head: long and straight in the face (the old landrace, not the dished modern one), a broad
    forehead, heavy jowls, small eyes under the lop ears, the snout ending in its disc with a firm rim."""
    J = Bd.J
    o, R, L = head_frame(J)

    def at(x, y, z):
        return o + R @ (np.array((x, y, z)) * L)

    hb = bone("head")
    fl_back = lambda p: np.tile(-R[:, 2], (len(p), 1))
    side = R[:, 0]
    prof = [(-0.06, 0.12, -0.14, 0.22), (0.05, 0.2, -0.28, 0.3), (0.2, 0.205, -0.33, 0.32), (0.35, 0.165, -0.3, 0.28),
            (0.5, 0.115, -0.25, 0.22), (0.7, 0.075, -0.18, 0.17), (0.88, 0.06, -0.135, 0.15), (0.95, 0.07, -0.13, 0.158)]
    Bd.add(lofted([(at(0, (t + b) / 2, z), w * L, (t - b) / 2 * L, (t - b) / 2 * L, 2.3) for z, t, b, w in prof], side=side), hb, "head", 0.0, fl_back)
    for s in (-1, 1):
        # the bony ridges over the eyes, and the cheek's fold below them
        Bd.add(ell(at(s * 0.15, 0.16, 0.36), np.array((0.08, 0.035, 0.1)) * L, R), hb, "head", 0.06 * L, fl_back)
        Bd.add(ell(at(s * 0.22, -0.12, 0.26), np.array((0.12, 0.17, 0.2)) * L, R), mix((hb, 0.7), (bone("jaw"), 0.3)), "head", 0.06 * L, fl_back)
    # the snout disc: a flat oval end standing a little proud, its rim firm
    Bd.add(lofted([(at(0, -0.035, 0.93), 0.16 * L, 0.115 * L, 0.115 * L, 2.3), (at(0, -0.03, 0.985), 0.178 * L, 0.13 * L, 0.13 * L, 2.4),
                   (at(0, -0.03, 1.005), 0.172 * L, 0.125 * L, 0.125 * L, 2.4)], side=side), hb, "nose", 0.006, fl_back, 0.0)
    for s in (-1, 1):
        Bd.cut(ell(at(s * 0.062, -0.035, 1.01), np.array((0.032, 0.048, 0.035)) * L, R), 0.003)
    # the lower jaw and the chin under the disc
    Bd.add(lofted([(at(0, -0.24, 0.18), 0.2 * L, 0.06 * L, 0.09 * L, 2.0), (at(0, -0.22, 0.55), 0.13 * L, 0.05 * L, 0.06 * L, 2.0),
                   (at(0, -0.17, 0.86), 0.085 * L, 0.04 * L, 0.045 * L, 2.0)], side=side), chain([J["jaw"], J["chin"]], ["jaw"], 0.01), "jaw", 0.04 * L,
           fl_back, 0.5)
    er = 0.032 * L
    for s in (-1, 1):
        eye(Bd, at(s * 0.18, 0.12, 0.36), unit(R @ np.array((s * 0.7, 0.12, 1.0))), er, R, 0.7, 0.004, lids=(1.3, 0.75))
    for c_, look_, er_, lids_ in Bd.marks["eyes"]:
        Bd.cut(ell(c_ + look_ * er_ * 0.5, (er_ * 1.3, er_ * 0.95, er_ * 0.6), frame(look_)), er_ * 0.4)
    Bd.marks["nose"] = at(0, -0.03, 1.02)
    Bd.marks["head"] = (o, R, L)
    Bd.marks["mouth"] = (at(0, -0.13, 0.70), np.array((0.11, 0.02, 0.22)) * L, R)
    Bd.marks["stop"] = 0.45
    seat_ears(Bd, 0.17, 0.1)


def build(rig):
    return {"dog": dog, "cat": cat, "pig": pig}[rig["species"]](rig)

"""Posing: forward kinematics for the body, inverse kinematics for the legs, in game space.

A pose holds for every bone its posed rotation relative to rest in the armature's frame (A: 3 x 3, posed frame = A @
rest frame) and its posed head. Body bones are turned by local angles (pitch about the parent's x, yaw about its y,
roll about its z), so a clip reads like a description of the animal. A leg is placed from the ground up: the toe
where it stands, the paw's pitch (the heel lifting off it), the pastern's or metatarsus's tilt, and a two-bone solve
for the upper leg to reach that wrist or hock, bending at the elbow (back) or the stifle (forward). Bones are then
turned to point along the solved joints with their side axis kept to the body's side, so the leg never twists.

The skinning check (skin()) poses the mesh's vertices with the same weights the game uses (linear blend), for the
ground contact of sit and lie and for the foot-slide measure.
"""

import math

import numpy as np

from .anatomy import BONES, HELPERS, INDEX, LEGS, NAMES, PARENT, TAIL


def Rx(d):
    a = math.radians(d)
    c, s = math.cos(a), math.sin(a)
    return np.array(((1, 0, 0), (0, c, -s), (0, s, c)))


def Ry(d):
    a = math.radians(d)
    c, s = math.cos(a), math.sin(a)
    return np.array(((c, 0, s), (0, 1, 0), (-s, 0, c)))


def Rz(d):
    a = math.radians(d)
    c, s = math.cos(a), math.sin(a)
    return np.array(((c, -s, 0), (s, c, 0), (0, 0, 1)))


def eul(p=0.0, y=0.0, r=0.0):
    """Yaw, then pitch, then roll (degrees) in the parent's frame."""
    return Ry(y) @ Rx(p) @ Rz(r)


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def frame(d, x):
    """Columns x (side), y (along d), z."""
    d = unit(d)
    x = np.asarray(x, float) - d * np.dot(x, d)
    x = unit(x)
    return np.stack([x, d, np.cross(x, d)], 1)


def smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def bump(u, peak=0.5):
    """0 at u = 0 and 1, 1 at u = peak, smooth."""
    u = min(max(u, 0.0), 1.0)
    if u < peak:
        return smooth(u / peak)
    return smooth((1 - u) / (1 - peak))


def rest_ends(J):
    """Rest heads and tails of every bone (helpers: a stub along the bone below the joint)."""
    head0 = {b: np.asarray(J[h], float) for b, _, h, t in BONES}
    tail0 = {}
    for b, _, h, t in BONES:
        if t.startswith("~"):
            nb = t[1:]
            d = None
            for b2, _, h2, t2 in BONES:
                if b2 == nb:
                    d = np.asarray(J[t2], float) - np.asarray(J[h2], float)
            tail0[b] = head0[b] + d / np.linalg.norm(d) * min(0.02, 0.3 * np.linalg.norm(d))
        else:
            tail0[b] = np.asarray(J[t], float)
    return head0, tail0


class Rig:
    """Rest data of one rig in game space."""

    def __init__(self, rig):
        self.rig = rig
        self.name = rig["name"]
        self.sp = rig["species"]
        self.H = rig["H"]
        J = {n: np.asarray(p, float) for n, p in rig["J"].items()}
        self.J = J
        self.head0, self.tail0 = rest_ends(J)
        self.len = {b: float(np.linalg.norm(self.tail0[b] - self.head0[b])) for b in NAMES}

    def toe_rest(self, leg):
        return self.J[LEGS[leg][1][-1]].copy()


class Pose:
    def __init__(self, R):
        self.R = R
        self.A = {b: np.eye(3) for b in NAMES}
        self.h = {b: R.head0[b].copy() for b in NAMES}
        self.local = {}
        self.root = np.zeros(3)
        self.miss = 0.0
        self.misses = {}
        self.strain = {}
        self.placed = False

    # ---- body

    def body(self, root=(0, 0, 0), hips=(0, 0, 0), **local):
        """root: offset of the hips (x, y, z); hips: (pitch, yaw, roll) of the hips; local: bone=(p, y, r)."""
        self.root = np.asarray(root, float)
        self.local = {"hips": hips}
        self.local.update(local)
        self.placed = False
        self.fk()

    def set(self, **local):
        if self.placed:
            raise RuntimeError("set() after a leg was placed would undo it: turn the body first, then place the legs")
        self.local.update(local)
        self.fk()

    def fk(self):
        R = self.R
        for b, par, _, _ in BONES:
            p, y, r = self.local.get(b, (0, 0, 0))
            L = eul(p, y, r)
            if par is None:
                self.A[b] = L
                self.h[b] = R.head0[b] + self.root
            else:
                self.A[b] = self.A[par] @ L
                self.h[b] = self.h[par] + self.A[par] @ (R.head0[b] - R.head0[par])

    def point(self, bone, p):
        """Where the rest point p (rigidly on `bone`) is now."""
        return self.h[bone] + self.A[bone] @ (np.asarray(p, float) - self.R.head0[bone])

    def side(self):
        """The body's side axis, from the chest (front legs) or hips (hind legs)."""
        return self.A["hips"] @ np.array((1.0, 0, 0))

    # ---- legs

    def leg(self, key, toe, paw=0.0, low=0.0, girdle=0.0, out=0.0, side=None, pole_out=0.0, reach=1.0):
        """Place leg `key` (FL, FR, HL, HR): toe = where the toe's contact point goes (game space), paw = the paw's
        pitch from rest (+ lifts the heel / curls the toes down), low = the pastern's or metatarsus's tilt from rest
        (+ turns its top forward), girdle = the shoulder blade's pitch (front legs), out = abduction (degrees, the
        leg's plane turned out from the body), side = the side axis to keep (default the body's)."""
        R = self.R
        bones, joints = LEGS[key]
        front = key[0] == "F"
        S_ = key[1]
        sg = 1.0 if S_ == "L" else -1.0
        J = R.J
        xs = side if side is not None else (self.A["chest" if front else "hips"] @ np.array((1.0, 0, 0)))
        xs = unit(np.array((xs[0], 0.0, xs[2])))  # level: the paws stay flat when the body rolls
        # the heading: the body's forward with the side axis kept, level
        fwd = unit(np.cross(xs, np.array((0, 1.0, 0))))
        fwd = unit(fwd)
        # rest frame of the leg plane: x side, y up, z forward
        P = np.stack([xs, unit(np.cross(fwd, xs)), fwd], 1)
        if out:
            P = P @ Rz(sg * out)
        rest_frame_side = np.array((1.0, 0, 0))
        toe = np.asarray(toe, float)
        # paw: from the toe back to the knuckle
        mc0, to0 = J[joints[-2]], J[joints[-1]]
        lw0, mc0_ = J[joints[-3]], mc0
        v_paw = P @ Rx(paw) @ (to0 - mc0)
        mcp = toe - v_paw
        v_low = P @ Rx(low) @ (lw0 - mc0)
        wrist = mcp + v_low  # the carpus or the hock
        if front:
            sc = bones[0]
            self.local[sc] = (girdle, 0, 0)
            self.A[sc] = self.A["chest"] @ eul(girdle, 0, 0)
            self.h[sc] = self.h["chest"] + self.A["chest"] @ (R.head0[sc] - R.head0["chest"])
            top = self.h[sc] + self.A[sc] @ (J[joints[1]] - J[joints[0]])
            up_bones = bones[1:3]
            pole = -fwd  # the elbow points back
        else:
            top = self.h["hips"] + self.A["hips"] @ (J[joints[0]] - R.head0["hips"])
            up_bones = bones[0:2]
            pole = fwd  # the stifle points forward
        if pole_out:
            pole = unit(pole + xs * pole_out * sg)
        L1, L2 = R.len[up_bones[0]], R.len[up_bones[1]]
        mid, miss = two_bone(top, wrist, L1, L2, pole)
        self.misses[key] = miss
        # how far past `reach` of its full length the upper leg had to stretch (a locked-straight leg swings its
        # joints fast between keys; gaits keep a margin)
        self.strain[key] = max(0.0, float(np.linalg.norm(wrist - top)) - reach * (L1 + L2))
        self.miss = max(self.miss, miss)
        end = top + unit(wrist - top) * min(np.linalg.norm(wrist - top), L1 + L2) if miss > 0 else wrist
        if miss > 0:
            # the wrist could not be reached: keep the lower leg's shape hanging from where it got to
            shift = end - wrist
            mcp = mcp + shift
            toe = toe + shift
            wrist = end
        self.orient(up_bones + bones[-2:], [top, mid, wrist, mcp, toe], P[:, 0])
        return toe

    def girdle_top(self, key, girdle=0.0):
        """The shoulder joint (after the blade's pitch) or the hip joint, where the upper leg hangs from."""
        R = self.R
        bones, joints = LEGS[key]
        J = R.J
        if key[0] == "F":
            sc = bones[0]
            self.local[sc] = (girdle, 0, 0)
            self.A[sc] = self.A["chest"] @ eul(girdle, 0, 0)
            self.h[sc] = self.h["chest"] + self.A["chest"] @ (R.head0[sc] - R.head0["chest"])
            return self.h[sc] + self.A[sc] @ (J[joints[1]] - J[joints[0]])
        return self.h["hips"] + self.A["hips"] @ (J[joints[0]] - R.head0["hips"])

    def orient(self, chain, pts, side_ref):
        """Turn the bones of a chain to run through the given joints, their side axis kept to side_ref."""
        R = self.R
        for b, a, c in zip(chain, pts, pts[1:]):
            d0 = R.tail0[b] - R.head0[b]
            F0 = frame(d0, np.array((1.0, 0, 0)))
            F1 = frame(c - a, side_ref)
            self.A[b] = F1 @ F0.T
            self.h[b] = a
        self.placed = True

    def front_flat(self, key, ahead=0.0, elbow_y=0.0, paw=0.0):
        """A foreleg lying on the ground: the elbow down, the forearm, pastern and paw stretched forward along it."""
        R = self.R
        bones, joints = LEGS[key]
        top = self.girdle_top(key)
        xs = self.A["chest"] @ np.array((1.0, 0, 0))
        xs = unit(np.array((xs[0], 0.0, xs[2])))
        fwd = unit(np.cross(xs, np.array((0, 1.0, 0))))
        L1, L2 = R.len[bones[1]], R.len[bones[2]]
        Lp, Lw = R.len[bones[3]], R.len[bones[4]]
        dy = top[1] - elbow_y
        back = math.sqrt(max(L1 * L1 - dy * dy, 0.0)) if dy < L1 else 0.0
        elbow = top - fwd * back * (1 - ahead) + fwd * ahead * L1 * 0.0
        elbow[1] = max(elbow_y, top[1] - L1)
        # keep the humerus its length
        elbow = top + unit(elbow - top) * L1
        carpus = elbow + fwd * L2
        carpus[1] = elbow[1] * 0.85
        carpus = elbow + unit(carpus - elbow) * L2
        mcp = carpus + unit(fwd + np.array((0, -0.25, 0))) * Lp
        toe = mcp + (Rx_axis(xs, -paw) @ unit(fwd + np.array((0, -0.45, 0)))) * Lw
        self.orient(bones[1:], [top, elbow, carpus, mcp, toe], xs)

    # ---- export helpers

    def helpers(self):
        for h, a, b, _ in HELPERS:
            rel = self.A[a].T @ self.A[b]
            self.A[h] = self.A[a] @ half(rel)
            self.h[h] = self.h[b]

    def relative(self):
        """Per bone, the rotation relative to its parent (game space)."""
        self.helpers()
        out = {}
        for b in NAMES:
            par = PARENT[b]
            out[b] = self.A[b] if par is None else self.A[par].T @ self.A[b]
        return out

    def skin_mats(self):
        """Per bone (A, t) such that a rest point v goes to A @ v + t."""
        self.helpers()
        Ms = np.zeros((len(NAMES), 3, 4))
        for i, b in enumerate(NAMES):
            A = self.A[b]
            Ms[i, :, :3] = A
            Ms[i, :, 3] = self.h[b] - A @ self.R.head0[b]
        return Ms


def Rx_axis(axis, deg):
    """Rotation by deg about a unit axis."""
    a = unit(axis)
    t = math.radians(deg)
    K = np.array(((0, -a[2], a[1]), (a[2], 0, -a[0]), (-a[1], a[0], 0)))
    return np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * K @ K


def half(M):
    """The rotation half way to M (same axis, half the angle)."""
    tr = np.clip((np.trace(M) - 1) / 2, -1.0, 1.0)
    ang = math.acos(tr)
    if ang < 1e-6:
        return np.eye(3)
    ax = np.array((M[2, 1] - M[1, 2], M[0, 2] - M[2, 0], M[1, 0] - M[0, 1]))
    if np.linalg.norm(ax) < 1e-9:
        w, v = np.linalg.eigh((M + M.T) / 2)
        ax = v[:, np.argmax(w)]
    return Rx_axis(ax, math.degrees(ang) / 2)


def two_bone(a, c, L1, L2, pole):
    """The middle joint between a and c (bone lengths L1, L2), bending toward pole. Returns (mid, miss)."""
    d = c - a
    D = float(np.linalg.norm(d))
    miss = 0.0
    lo, hi = abs(L1 - L2) + 1e-5, L1 + L2 - 1e-6
    if D > hi:
        miss = D - hi
        Dc = hi
    elif D < lo:
        miss = lo - D
        Dc = lo
    else:
        Dc = D
    u = d / max(D, 1e-9)
    ca = (L1 * L1 + Dc * Dc - L2 * L2) / (2 * L1 * Dc)
    ca = min(max(ca, -1.0), 1.0)
    sa = math.sqrt(1 - ca * ca)
    w = pole - u * np.dot(pole, u)
    w = unit(w) if np.linalg.norm(w) > 1e-9 else unit(np.cross(u, (1, 0, 0)))
    return a + u * L1 * ca + w * L1 * sa, miss


def skin(pose, rest_verts, W):
    """Linear blend skinning of rest vertices (game space) with weights W (n x bones)."""
    Ms = pose.skin_mats()
    v4 = np.concatenate([rest_verts, np.ones((len(rest_verts), 1))], 1)
    per = np.einsum("bij,nj->nbi", Ms, v4)
    return np.einsum("nb,nbi->ni", W, per)

"""Motion tools for people2 clips (docs/people.md "Motion tools"). Package D1; also used by D2, D3 and the fight
clips (J).

Everything works in the pose convention of the kit (docs/people.md "The pose convention"): a pose is a dict
bone -> quaternion in armature axes (Blender: X the person's left, -Y forward, Z up), each a turn relative to the
parent's turned frame, plus one vector, the hips translation in armature axes (metres, from the rest position).
Global turns compose down the chain: D[bone] = D[parent] @ pose[bone]; a bone's head is
P[bone] = P[parent] + D[parent] @ (rest[bone] - rest[parent]).

What is here:
- rotations with names that say what they do: yaw, bow, lean, swing (and RX, RY, RZ);
- V(left, fwd, up): a point or a direction in the person's own words, in armature axes;
- curves: ease shapes, Curve (keys and a smooth cubic through them, looped or not), overshoot, lag, follow
  (a spring that trails a signal: follow-through), share (a turn spread over a chain of bones), overlap (a chain
  where each bone trails the one before: offset of chained bones);
- Skel: one body's skeleton for posing in code: forward kinematics (fk), two-bone IK for legs and arms with a pole
  (leg, arm), hold (a hand on a point of a bone or of the world, e.g. a cart handle), look (a level head over a
  moving trunk), the foot's contact points from the mesh (heel, ball, tip), the foot rockers (roll);
- keying: key a list of poses as an action on the export armature (one NLA track per clip, as the old kit);
- checks: seam (how cleanly a loop closes), slide (how far a foot on the ground moves, replayed as the games
  interpolate the keys), clearance (how high the toes pass over the ground), joins (how far one clip's end is from
  another's start), and fk_check (this module's FK against Blender's own).

IK is solved in closed form, not with Blender constraints: it is exact (a planted foot does not move at all at the
keys), the same on every run, and fast; the result is plain FK rotation keys.
"""

import math

from mathutils import Matrix, Quaternion, Vector

from . import B, FPS
from .rig import KEYED, NAMES, PARENT

# ---------------------------------------------------------------- rotations


def Q(axis, deg):
    return Quaternion(Vector(axis), math.radians(deg))


def RX(d):
    return Q((1, 0, 0), d)


def RY(d):
    return Q((0, 1, 0), d)


def RZ(d):
    return Q((0, 0, 1), d)


def yaw(d):
    """Turn about the vertical: + turns the person (or a bone) to the person's left."""
    return RZ(d)


def bow(d):
    """Turn about the person's left-right axis: + tips an upright bone forward (a bow) and swings a hanging bone
    back (a knee bend); - swings a hanging arm or leg forward."""
    return RX(d)


def lean(d):
    """Turn about the forward axis: + tips an upright bone to the person's left; on the hips, + drops the left
    side of the pelvis."""
    return RY(d)


def turn(y=0.0, b=0.0, l=0.0):
    """yaw, then bow, then lean (each in the frame the previous one left)."""
    return RZ(y) @ RX(b) @ RY(l)


def swing(side, fwd=0.0, out=0.0, twist=0.0):
    """A hanging arm or leg: fwd swings its far end forward, out away from the body, twist turns it about its own
    axis (+ inward). The old kit's limb()."""
    sg = 1 if side == "L" else -1
    return RX(-fwd) @ RY(-sg * out) @ RZ(-sg * twist)


def V(left=0.0, fwd=0.0, up=0.0):
    """A point or direction in the person's words (metres): to the left, forward, up -> armature axes."""
    return Vector((left, -fwd, up))


def words(v):
    """Back from armature axes to (left, fwd, up)."""
    return (v[0], -v[1], v[2])


def angle(qa, qb):
    """Degrees between two turns (atan2, so small angles are exact, not rounded by acos)."""
    d = qa.inverted() @ qb
    return math.degrees(2 * math.atan2(Vector((d.x, d.y, d.z)).length, abs(d.w)))


def slerp(qa, qb, t):
    return qa.slerp(qb, t)


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def swing_twist(q, axis):
    """Split q into swing @ twist, twist about `axis` (a unit vector in the frame q acts in)."""
    ax = Vector(axis).normalized()
    p = Vector((q.x, q.y, q.z)).dot(ax)
    tw = Quaternion((q.w, ax.x * p, ax.y * p, ax.z * p))
    if tw.magnitude < 1e-9:
        tw = Quaternion()
    else:
        tw.normalize()
    return q @ tw.inverted(), tw


# ---------------------------------------------------------------- curves


def smoothstep(u):
    u = clamp(u)
    return u * u * (3 - 2 * u)


def smootherstep(u):
    u = clamp(u)
    return u * u * u * (u * (6 * u - 15) + 10)


def ease_in(u, p=2.0):
    return clamp(u) ** p


def ease_out(u, p=2.0):
    return 1 - (1 - clamp(u)) ** p


def ease(u, p=2.0):
    """Ease in and out with power p (2: a soft start and stop; higher: a longer hold at the ends)."""
    u = clamp(u)
    return 0.5 * (2 * u) ** p if u < 0.5 else 1 - 0.5 * (2 * (1 - u)) ** p


_OVER = {}


def overshoot(u, amount=0.12):
    """A move from 0 to 1 over u in [0, 1] that passes the end by `amount` (a share of the move) late in the move
    and settles back onto it: smootherstep(u) + A u^3 (1 - u)^2, A chosen so the peak is 1 + amount. Still at both
    ends (no jolt where it starts or stops)."""
    u = clamp(u)
    if amount <= 0:
        return smootherstep(u)
    A = _OVER.get(amount)
    if A is None:
        lo, hi = 0.0, 400.0
        for _ in range(60):
            A = (lo + hi) / 2
            peak = max(smootherstep(x / 200) + A * (x / 200) ** 3 * (1 - x / 200) ** 2 for x in range(201))
            if peak > 1 + amount:
                hi = A
            else:
                lo = A
        _OVER[amount] = A
    return smootherstep(u) + A * u ** 3 * (1 - u) ** 2


class Curve:
    """A smooth curve through keys (t, value) or (t, value, slope). Cubic Hermite; slopes left out are made from
    the neighbours (Catmull-Rom), so the curve passes every key with no corner. period=T makes it loop: keys are
    taken mod T and the slopes at the seam see the keys on the other side. Values may be floats or Vectors."""

    def __init__(self, keys, period=None):
        ks = sorted(keys, key=lambda k: k[0])
        self.period = period
        self.t = [k[0] for k in ks]
        self.v = [k[1] for k in ks]
        self.s = [k[2] if len(k) > 2 else None for k in ks]
        n = len(ks)
        for i in range(n):
            if self.s[i] is not None:
                continue
            if period:
                ip, inx = (i - 1) % n, (i + 1) % n
                tp = self.t[ip] - (period if i == 0 else 0)
                tn = self.t[inx] + (period if i == n - 1 else 0)
                if n == 1:
                    self.s[i] = self.v[i] * 0
                    continue
                self.s[i] = (self.v[inx] - self.v[ip]) / (tn - tp)
            else:
                if n == 1:
                    self.s[i] = self.v[i] * 0
                elif i == 0:
                    self.s[i] = (self.v[1] - self.v[0]) / (self.t[1] - self.t[0])
                elif i == n - 1:
                    self.s[i] = (self.v[-1] - self.v[-2]) / (self.t[-1] - self.t[-2])
                else:
                    self.s[i] = (self.v[i + 1] - self.v[i - 1]) / (self.t[i + 1] - self.t[i - 1])

    def __call__(self, t):
        n = len(self.t)
        if n == 1:
            return self.v[0]
        if self.period:
            T = self.period
            t = (t - self.t[0]) % T + self.t[0]
            # find the segment, the last one wraps to the first key + T
            i = n - 1
            for k in range(n - 1):
                if self.t[k] <= t < self.t[k + 1]:
                    i = k
                    break
            t0, v0, s0 = self.t[i], self.v[i], self.s[i]
            if i == n - 1:
                t1, v1, s1 = self.t[0] + T, self.v[0], self.s[0]
            else:
                t1, v1, s1 = self.t[i + 1], self.v[i + 1], self.s[i + 1]
        else:
            if t <= self.t[0]:
                return self.v[0] + self.s[0] * 0
            if t >= self.t[-1]:
                return self.v[-1] + self.s[-1] * 0
            i = 0
            while self.t[i + 1] < t:
                i += 1
            t0, v0, s0 = self.t[i], self.v[i], self.s[i]
            t1, v1, s1 = self.t[i + 1], self.v[i + 1], self.s[i + 1]
        h = t1 - t0
        u = (t - t0) / h
        u2, u3 = u * u, u * u * u
        return ((2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * s0 + (-2 * u3 + 3 * u2) * v1
                + (u3 - u2) * h * s1)

    def slope(self, t, dt=1e-4):
        return (self(t + dt) - self(t - dt)) / (2 * dt)


def lag(fn, delay, period=None):
    """fn delayed by `delay` (seconds or phase): a bone that trails the one that drives it."""
    if period:
        return lambda t: fn((t - delay) % period)
    return lambda t: fn(t - delay)


def follow(values, dt, freq=3.0, zeta=0.5, periodic=False):
    """A spring that trails a sampled signal: follow-through and settle. values: a list of floats (or Vectors),
    one per frame; freq: the spring's own frequency in Hz (lower = looser); zeta: damping (1 = no overshoot,
    0.3 = a soft wobble). periodic=True treats the list as a loop whose last frame is its first: the spring runs
    round it until it has settled, so the result closes on itself."""
    w = 2 * math.pi * freq
    n = len(values)
    vals = values[:-1] if periodic and n > 1 else values
    m = len(vals)
    rounds = max(3, int(math.ceil(3.0 / max(1e-3, zeta * freq * m * dt)))) if periodic else 1
    x = vals[0] * 1.0
    v = vals[0] * 0.0
    out = [None] * m
    sub = 4
    h = dt / sub
    for r in range(rounds):
        for i in range(m):
            target = vals[i]
            for _ in range(sub):
                a = w * w * (target - x) - 2 * zeta * w * v
                v = v + a * h
                x = x + v * h
            if r == rounds - 1:
                out[i] = x
    if periodic and n > 1:
        out.append(out[0])
    return out


def share(total, bones, shares):
    """Spread one turn `total` over a chain of bones: each but the last gets slerp(I, total, share); the last
    takes what is left, so the chain together turns by exactly `total`. Returns {bone: turn}."""
    out = {}
    acc = Quaternion()
    for i, (bn, s) in enumerate(zip(bones, shares)):
        q = acc.inverted() @ total if i == len(bones) - 1 else Quaternion().slerp(total, s)
        out[bn] = q
        acc = acc @ q
    return out


def overlap(fn, bones, delay, falloff=1.0, period=None):
    """Offset of chained bones: fn(t) -> a turn; each bone down the chain gets the same motion `delay` later and
    scaled by falloff**k, so a move ripples down (a whip, a head that follows the shoulders, fingers that trail
    a wrist). Returns t -> {bone: turn}."""

    def at(t):
        out = {}
        for k, bn in enumerate(bones):
            tt = t - k * delay
            if period:
                tt %= period
            q = fn(tt)
            if falloff != 1.0:
                q = Quaternion().slerp(q, falloff ** k)
            out[bn] = q
        return out

    return at


# ---------------------------------------------------------------- the skeleton


class Posed:
    """A posed skeleton: P[bone] heads and D[bone] global turns (armature axes)."""

    def __init__(self, P, D, skel):
        self.P, self.D, self.skel = P, D, skel

    def point(self, bone, rest_point):
        """Where a point that sits at rest_point (armature axes, rest pose) on `bone` is now."""
        return self.P[bone] + self.D[bone] @ (Vector(rest_point) - self.skel.rest[bone])

    def frame(self, bone):
        """The bone's posed matrix (4x4): rest axes turned by D, at its head."""
        m = (self.D[bone] @ self.skel.restq[bone]).to_matrix().to_4x4()
        m.translation = self.P[bone]
        return m


class Skel:
    """One body's skeleton for posing in code. J: rig.joints(P) (game axes). mesh: the body's lod0 (for the
    foot's contact points; optional)."""

    def __init__(self, J, mesh=None, name=""):
        self.name = name
        self.J = J
        self.rest = {n: B(*J[n][0]) for n in NAMES}
        self.tail = {n: B(*J[n][1]) for n in NAMES}
        self.restq = {}
        for n in NAMES:
            d = (self.tail[n] - self.rest[n]).normalized()
            # Blender's rest frame for roll 0: y along the bone
            self.restq[n] = _bone_quat(d)
        self.L = {}
        for S in "LR":
            self.L["thigh" + S] = (self.rest["legLow" + S] - self.rest["legUp" + S]).length
            self.L["shin" + S] = (self.rest["foot" + S] - self.rest["legLow" + S]).length
            self.L["upper" + S] = (self.rest["armLow" + S] - self.rest["armUp" + S]).length
            self.L["fore" + S] = (self.rest["hand" + S] - self.rest["armLow" + S]).length
        self.feet = foot_points(self, mesh) if mesh is not None else None

    # forward kinematics
    def fk(self, pose, t=None):
        P, D = {}, {}
        t = Vector(t) if t is not None else Vector()
        for n in NAMES:
            q = pose.get(n, Quaternion())
            p = PARENT[n]
            if p is None:
                D[n] = q.copy()
                P[n] = self.rest[n] + t
            else:
                D[n] = D[p] @ q
                P[n] = P[p] + D[p] @ (self.rest[n] - self.rest[p])
        return Posed(P, D, self)

    # two-bone IK
    def _two_bone(self, A, T, A0, B0, C0, pole, k0):
        """Global turns for a two-bone chain with rest joints A0, B0, C0 (heads of upper, lower, end), its root
        now at A, its end to reach T, the middle joint toward `pole` (a direction). k0: the rest direction the
        middle joint bends toward. Returns (D_upper, D_lower, reached)."""
        L1 = (B0 - A0).length
        L2 = (C0 - B0).length
        dvec = T - A
        d = dvec.length
        dmax = L1 + L2 - 1e-4
        dmin = abs(L1 - L2) + 1e-3
        reached = d <= dmax + 1e-6
        d = min(max(d, dmin), dmax)
        dh = dvec.normalized() if dvec.length > 1e-9 else (C0 - A0).normalized()
        k = Vector(pole) - dh * Vector(pole).dot(dh)
        if k.length < 1e-6:
            k = k0 - dh * k0.dot(dh)
        k.normalize()
        n = dh.cross(k)
        dh0 = (C0 - A0).normalized()
        kk0 = k0 - dh0 * k0.dot(dh0)
        kk0.normalize()
        n0 = dh0.cross(kk0)
        M0 = Matrix((dh0, kk0, n0)).transposed()
        M = Matrix((dh, k, n)).transposed()
        Rt = (M @ M0.transposed()).to_quaternion()
        t0 = M0.transposed() @ (B0 - A0)
        s0 = M0.transposed() @ (C0 - B0)
        a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
        h = math.sqrt(max(0.0, L1 * L1 - a * a))
        th1 = math.atan2(h, a) - math.atan2(t0[1], t0[0])
        th2 = math.atan2(-h, d - a) - math.atan2(s0[1], s0[0])
        Du = Quaternion(n, th1) @ Rt
        Dl = Quaternion(n, th2) @ Rt
        return Du, Dl, reached

    def leg(self, pose, S, ankle, foot_rot, pole, toe=None, t=None, posed=None):
        """Put the ankle (the foot bone's head) of leg S at `ankle` (armature axes) with the foot turned to the
        global turn foot_rot; the knee toward `pole` (a direction, e.g. V(fwd=1)). toe: the toe's turn relative
        to the foot (default: kept). Writes legUp, legLow, foot (and toe) into pose; returns whether it reached."""
        ps = posed or self.fk(pose, t)
        A = ps.P["legUp" + S]
        Du, Dl, ok = self._two_bone(A, Vector(ankle), self.rest["legUp" + S], self.rest["legLow" + S],
                                    self.rest["foot" + S], Vector(pole), V(fwd=1))
        Dp = ps.D["hips"]
        pose["legUp" + S] = Dp.inverted() @ Du
        pose["legLow" + S] = Du.inverted() @ Dl
        pose["foot" + S] = Dl.inverted() @ foot_rot
        if toe is not None:
            pose["toe" + S] = toe
        return ok

    def arm(self, pose, S, wrist, hand_rot, pole, t=None, posed=None):
        """Put the wrist (the hand bone's head) of arm S at `wrist` with the hand turned to the global turn
        hand_rot; the elbow toward `pole` (a direction, e.g. V(fwd=-1, left=sg)). Sets armTwist by the kit's
        rule (0.6 of the hand's turn about the forearm). Returns whether it reached."""
        ps = posed or self.fk(pose, t)
        A = ps.P["armUp" + S]
        Du, Dl, ok = self._two_bone(A, Vector(wrist), self.rest["armUp" + S], self.rest["armLow" + S],
                                    self.rest["hand" + S], Vector(pole), V(fwd=-1))
        Dp = ps.D["clavicle" + S]
        pose["armUp" + S] = Dp.inverted() @ Du
        pose["armLow" + S] = Du.inverted() @ Dl
        qh = Dl.inverted() @ hand_rot
        pose["hand" + S] = qh
        twist_rule(pose, S)
        return ok

    def hold(self, pose, S, grip, hand_rot, pole, t=None, clav=None):
        """Put the fist's grip (the gripS socket: where a handle runs through the closed hand) on `grip`
        (armature axes) with the hand turned to hand_rot. clav: the clavicle's turn (default: a lift and reach
        from where the hand goes, the kit's rule)."""
        g0 = self.rest["grip" + S] - self.rest["hand" + S]
        wrist = Vector(grip) - hand_rot @ g0
        if clav is None:
            pose["clavicle" + S] = Quaternion()
            ps = self.fk(pose, t)
            pose["clavicle" + S] = clavicle_for(ps, S, wrist)
        else:
            pose["clavicle" + S] = clav
        return self.arm(pose, S, wrist, hand_rot, pole, t)

    def look(self, pose, target, shares=(0.4, 0.6), t=None, keep=0.0):
        """A steady head: turn neck and head so the head's global turn is `target` (e.g. yaw(facing) for a level
        head looking ahead), spread over neck and head by `shares`. keep (0-1): how much of the trunk's own motion
        the head still shows (0: fully steady)."""
        ps = self.fk(pose, t)
        Duc = ps.D["upperChest"]
        tgt = target if keep <= 0 else target.slerp(Duc, keep)
        C = Duc.inverted() @ tgt
        qn = Quaternion().slerp(C, shares[0])
        pose["neck"] = qn
        pose["head"] = qn.inverted() @ C
        return pose


def _bone_quat(d):
    """Blender's rest turn for a bone pointing along d with roll 0."""
    y = Vector((0, 1, 0))
    d = Vector(d).normalized()
    c = y.dot(d)
    if c > 1 - 1e-9:
        return Quaternion()
    if c < -1 + 1e-9:
        return Quaternion((0, 0, 0, 1))  # 180 about z
    ax = y.cross(d).normalized()
    return Quaternion(ax, math.acos(c))


def twist_rule(pose, S):
    """armTwist takes 0.6 of the hand's turn about the forearm (no wrung wrists; docs/people.md)."""
    qh = pose.get("hand" + S, Quaternion())
    _, tw = swing_twist(qh, (0, 0, 1))
    pose["armTwist" + S] = Quaternion().slerp(tw, 0.6)


def fit_grip_surface(fam, side, radius, palm_offset, up, shape):
    """Fit against the actual reduced MakeHuman skin, rather than cylindrical finger estimates.

    One offline fit per body/side/radius. Keep the greatest safe curl toward the supplied shape;
    the runtime only receives plain finger keys. Pad vertices must stay outside the handle.
    """
    import numpy as np
    from . import clips_legacy as cl
    sk = fam.sk
    mesh = fam.b["lod0"]
    cache = getattr(fam, "_grip_skin", None)
    if cache is None:
        names = {g.index: g.name for g in mesh.vertex_groups}
        co = np.array([v.co[:] for v in mesh.data.vertices])
        skin = {}
        for s in "LR":
            idx = []
            for v in mesh.data.vertices:
                if any(names[g.group].endswith(s) and names[g.group].startswith(("hand", "index", "middle", "ring", "thumb")) and g.weight > 0.1 for g in v.groups):
                    idx.append(v.index)
            W = np.zeros((len(idx), len(NAMES)))
            for i, v in enumerate(idx):
                for g in mesh.data.vertices[v].groups:
                    if names[g.group] in NAMES:
                        W[i, NAMES.index(names[g.group])] = g.weight
            skin[s] = (co[idx], W)
        fam._grip_skin = cache = skin
    co, W = cache[side]
    sg = 1 if side == "L" else -1
    centre = Vector(B(*fam.J["grip" + side][0])) + B(sg * palm_offset, up, 0)
    h = {f: tuple(v) for f, v in shape.items()}

    for f in ("index", "middle", "ring"):
        bones = [f + str(k) + side for k in (1, 2, 3)]
        indices = [NAMES.index(b) for b in bones]
        used = W[:, indices].sum(1) > 0.25
        points, weights = co[used], W[used][:, indices]
        base = points * (1 - weights.sum(1))[:, None]
        distal = weights[:, 2] > 0.3
        rest = fam.ax["fingerRest"][side][f]
        wanted = cl.HANDS["grip"][f]

        def cost(angles):
            if sum(angles) > 174:
                return 1e9
            D, P = Quaternion(), sk.rest[bones[0]]
            posed = base.copy()
            for k, bone in enumerate(bones):
                if k:
                    P = P + D @ (sk.rest[bone] - sk.rest[bones[k - 1]])
                D = D @ RY(sg * (angles[k] - rest[k]))
                R = np.array(D.to_matrix())
                posed += weights[:, k, None] * ((points - np.array(sk.rest[bone])) @ R.T + np.array(P))
            radial = np.linalg.norm((posed - np.array(centre))[:, (0, 2)], axis=1)
            if radial.min() < radius + 0.0006:
                return 1e9
            gap = max(0, (radial[distal].min() if distal.any() else radial.min()) - radius - 0.0006)
            return sum(((a - b) / 90) ** 2 for a, b in zip(angles, wanted)) + (gap / 0.012) ** 2

        candidates = ((a, b, c) for a in range(0, 71, 10) for b in range(0, 91, 10) for c in range(0, 51, 10))
        best = min(candidates, key=cost)
        candidates = ((a, b, c) for a in range(max(0, best[0] - 8), min(70, best[0] + 8) + 1, 2)
                      for b in range(max(0, best[1] - 8), min(90, best[1] + 8) + 1, 2)
                      for c in range(max(0, best[2] - 8), min(50, best[2] + 8) + 1, 2))
        best = min(candidates, key=cost)
        if cost(best) >= 1e9:
            raise ValueError("Cannot fit %s %s around %.1f mm handle" % (fam.body, f, radius * 2000))
        h[f] = best
    return h


SHOULDER_SHARE = 0.5  # the shoulder helpers take this share of armUp's swing


def shoulder_helpers(pose):
    """The shoulder helpers (rig kind "helper"): shoulderS takes half of the upper arm's swing as seen from the chest
    (clavicle and armUp together, without the twist about the upper arm's own axis; the arm hangs along -Z at rest),
    put back under the clavicle: q_shoulder = q_clav^-1 @ slerp(1, swing(q_clav @ q_armUp), 0.5). The skin round the
    shoulder and the armpit is weighted to them, so a raised arm turns that skin in two halves and it does not fold;
    measured from the chest, the half way turn follows the arm's own path (forward for a forward raise, out for a
    side raise) whatever the clavicle does. Every clip keys them by this rule (key_clip, clips_legacy); the games
    apply the same rule to any turn their own code gives armUp or the clavicle (docs/people.md "Shoulder helpers").
    Changes pose in place and returns it."""
    for S in "LR":
        qc = pose.get("clavicle" + S, Quaternion())
        sw, _ = swing_twist(qc @ pose.get("armUp" + S, Quaternion()), (0, 0, 1))
        pose["shoulder" + S] = qc.inverted() @ Quaternion().slerp(sw, SHOULDER_SHARE)
    return pose


def clavicle_for(ps, S, wrist):
    """The kit's shoulder rule for a hand going to `wrist`, the same as the old clips' (clips_legacy.shoulder_rule):
    the clavicle lifts by CLAV_RATE of the reach's rise past CLAV_FROM degrees, at most CLAV_MAX (30), not for the part
    of the reach that goes back, and comes forward with a forward reach."""
    from .clips_legacy import CLAV_FROM, CLAV_MAX, CLAV_RATE
    sg = 1 if S == "L" else -1
    sh = ps.P["armUp" + S]
    d = (Vector(wrist) - sh)
    if d.length < 1e-6:
        return Quaternion()
    d.normalize()
    # in the chest's frame
    dl = ps.D["upperChest"].inverted() @ d
    elev = math.degrees(math.acos(clamp(-dl.z, -1.0, 1.0)))
    e = min(CLAV_MAX, CLAV_RATE * max(0.0, elev - CLAV_FROM)) * (1.0 - clamp(dl.y / 0.6))
    fwd = max(0.0, -dl.y) * clamp((elev - 35.0) / 40.0)
    return RZ(-sg * 10.0 * fwd) @ RY(-sg * e)


# ---------------------------------------------------------------- feet


HEEL_R = 0.03  # the heel's roundness (m): the back of the sole rolls on a circle of this radius


def foot_points(skel, mesh):
    """The contact points of each foot at rest (armature axes), from the body's mesh (vertices taken by their foot
    and toe weights): the heel (where the flat sole touches at the back), the heel's circle (the back of the heel
    is round: it rolls on a circle of HEEL_R, centre `heelC`, at heel strike), the ball (the sole under the toe
    joint), the tip (the front of the sole), the sole's height, the ankle and the toe joint (mtp)."""
    out = {}
    gi = {g.name: g.index for g in mesh.vertex_groups}
    for S in "LR":
        pts = []
        tpts = []
        for v in mesh.data.vertices:
            wf = wt = 0.0
            for g in v.groups:
                if g.group == gi.get("foot" + S):
                    wf = g.weight
                elif g.group == gi.get("toe" + S):
                    wt = g.weight
            if wf + wt > 0.5:
                pts.append(Vector(v.co))
                if wt > 0.5:
                    tpts.append(Vector(v.co))
        sole = min(p.z for p in pts)
        rim = [p for p in pts if p.z < sole + 0.035]
        back = max(p.y for p in rim)  # the back of the heel (forward is -y)
        near = [p for p in rim if p.y > back - 0.02]
        heel_x = sum(p.x for p in near) / len(near)
        lowt = [p for p in tpts if p.z < sole + 0.012] or tpts
        front = min(p.y for p in lowt)
        tipn = [p for p in lowt if p.y < front + 0.015]
        tip_x = sum(p.x for p in tipn) / len(tipn)
        ball = skel.rest["toe" + S]
        hc = Vector((heel_x, back - HEEL_R - 0.004, sole + HEEL_R))
        out[S] = {
            "sole": sole,
            "heelC": hc,
            "heel": Vector((hc.x, hc.y, sole)),
            "ball": Vector((ball.x, ball.y, sole)),
            "tip": Vector((tip_x, front + 0.008, sole)),
            "ankle": skel.rest["foot" + S].copy(),
            "mtp": ball.copy(),
            "length": back - front,
        }
    return out


def roll(skel, S, flat_pos, flat_yaw, r, ground_pitch=0.0):
    """A foot on the ground, rolled. flat_pos: where the ankle is when the foot lies flat (armature axes);
    flat_yaw: the foot's turn about the vertical (degrees, + to the left); r: the roll in degrees: < 0 on the
    heel with the toes up (heel strike: the round heel rolls on the ground without slipping), 0 flat, > 0 up on
    the ball with the heel raised (heel off, toe off: the foot turns about the toe joint and the toes stay flat on
    the ground). ground_pitch: the slope under the foot (degrees, + rising ahead).
    Returns (ankle, foot_rot, toe_rel): the ankle position, the foot's global turn, the toe's turn relative to
    the foot."""
    f = skel.feet[S]
    base = RZ(flat_yaw) @ RX(-ground_pitch)
    ankle0 = f["ankle"]
    axis = base @ Vector((1, 0, 0))
    q = Quaternion(axis, math.radians(r))
    if r < 0:
        # the heel's circle rolls back along the ground by HEEL_R * angle
        c_flat = flat_pos + base @ (f["heelC"] - ankle0)
        c = c_flat + (base @ Vector((0, -1, 0))) * (HEEL_R * math.radians(r))
        ankle = c + q @ (flat_pos - c_flat)
        toe = Quaternion()
    else:
        piv = flat_pos + base @ (f["mtp"] - ankle0)
        ankle = piv + q @ (flat_pos - piv)
        toe = RX(-r)
    return ankle, q @ base, toe


def contacts(ps, skel, S):
    """The posed heel, ball and tip of foot S (armature axes)."""
    f = skel.feet[S]
    return {"heel": ps.point("foot" + S, f["heel"]), "ball": ps.point("toe" + S, f["ball"]),
            "tip": ps.point("toe" + S, f["tip"])}


# ---------------------------------------------------------------- a clip as data


class Clip:
    """A clip as frames: poses (dicts) and hips translations (Vectors), one per frame at FPS, the last frame of a
    loop equal to its first. meta: what the games need to know (speed, travel, phase, ...). root(t): where the
    person's node is at time t (in-place loops move it; travel clips keep it still and move the hips), as
    (Vector position in armature axes, yaw degrees); used by the checks."""

    def __init__(self, name, poses, trans, loop=True, meta=None, root=None, ground=None, skel=None):
        self.name = name
        self.poses = poses
        self.trans = trans
        self.loop = loop
        self.meta = meta or {}
        self.root = root or (lambda t: (Vector(), 0.0))
        self.ground = ground or (lambda p: 0.0)
        self.skel = skel

    @property
    def frames(self):
        return len(self.poses)

    @property
    def seconds(self):
        return (len(self.poses) - 1) / FPS

    def sample(self, t):
        """The pose at time t, as the games play it: keys at whole frames, slerp between them."""
        x = t * FPS
        i = int(math.floor(x))
        n = len(self.poses) - 1
        if i >= n:
            return self.poses[n], self.trans[n]
        if i < 0:
            return self.poses[0], self.trans[0]
        u = x - i
        a, b = self.poses[i], self.poses[i + 1]
        pose = {}
        for bn in KEYED:
            qa, qb = a.get(bn, Quaternion()), b.get(bn, Quaternion())
            if qa.dot(qb) < 0:
                qb = -qb
            pose[bn] = qa.slerp(qb, u)
        return pose, self.trans[i].lerp(self.trans[i + 1], u)


def mirror_pose(pose, t=None):
    """The same pose for the other side: L and R swapped and everything reflected through the middle plane."""
    out = {}
    for bn, q in pose.items():
        m = bn[:-1] + ("R" if bn[-1] == "L" else "L") if bn[-1] in "LR" and bn[:-1] else bn
        out[m] = Quaternion((q.w, q.x, -q.y, -q.z))
    if t is None:
        return out
    return out, Vector((-t.x, t.y, t.z))


# ---------------------------------------------------------------- joining clips


def _mix(pa, pb, w):
    out = {}
    for bn in set(pa) | set(pb):
        qa, qb = pa.get(bn, Quaternion()), pb.get(bn, Quaternion())
        if qa.dot(qb) < 0:
            qb = -qb
        out[bn] = qa.slerp(qb, w)
    return out


def ease_into(clip, target, at, n, travel=None, offset=None):
    """Make the last n frames of `clip` turn smoothly into `target`'s frames ending at frame `at` (counted back
    from there, wrapping if target loops), so the clip's last frame IS target's frame `at`: a start that hands over
    to a loop, a move that ends in a guard. travel: what the clip's hips have travelled (armature axes), added to
    target's translation; offset(i) instead gives it per frame counted back from the end (target's frames are
    relative to its own node, which an in-place loop moves). Where both clips plant a foot in the same place it
    stays planted."""
    tv = Vector(travel) if travel is not None else Vector()
    m = len(target.poses) - 1 if target.loop else len(target.poses)
    N = len(clip.poses)
    for i in range(min(n, N)):
        f = N - 1 - i
        j = (at - i) % m if target.loop else max(0, at - i)
        w = smootherstep(1.0 - i / n)
        clip.poses[f] = _mix(clip.poses[f], target.poses[j], w)
        off = Vector(offset(i)) if offset else tv
        clip.trans[f] = clip.trans[f].lerp(target.trans[j] + off, w)


def ease_from(clip, source, at, n, offset=None):
    """Make the first n frames of `clip` come smoothly out of `source`'s frames from `at` on, so its first frame IS
    source's frame `at`: a stop that leaves a loop, a recovery that leaves a hit. offset(i): where source's node is,
    in clip's frame, at frame i."""
    m = len(source.poses) - 1 if source.loop else len(source.poses)
    for i in range(min(n, len(clip.poses))):
        j = (at + i) % m if source.loop else min(len(source.poses) - 1, at + i)
        w = smootherstep(1.0 - i / n)
        clip.poses[i] = _mix(clip.poses[i], source.poses[j], w)
        off = Vector(offset(i)) if offset else Vector()
        clip.trans[i] = clip.trans[i].lerp(source.trans[j] + off, w)


def lock_feet(clip, stance=None, eps=0.012, fade=4):
    """Foot locking: pin each foot where it touched down for as long as it stands, by moving its ankle with the leg
    IK, and let go smoothly (over `fade` frames) when it lifts. stance(S, t) -> True while foot S stands (default:
    the clip's meta "_swing"). For anything that mixes poses (a speed blend, a gait switch, footwork where the body
    slides a few centimetres over planted feet, a hit reaction): the pose may change, the foot on the ground may
    not. Works on the clip's frames in place; uses the clip's root (what the games move the node by)."""
    sk = clip.skel
    if stance is None:
        sw = clip.meta["_swing"]
        stance = lambda S, t: not sw[S](t)
    n = len(clip.poses)
    for S in "LR":
        anchors = None
        last_d = Vector()
        since = fade
        for f in range(n):
            t = f / FPS
            pose, tr = clip.poses[f], clip.trans[f]
            rp, ry = clip.root(t)
            rq = RZ(ry)
            ps = sk.fk(pose, tr)
            c = contacts(ps, sk, S)
            if stance(S, t):
                world = {k: rp + rq @ p for k, p in c.items()}
                down = [k for k, p in world.items() if p.z - clip.ground(p) < eps]
                if anchors is None:
                    anchors = {}
                for k in down:
                    anchors.setdefault(k, world[k].copy())
                ds = [anchors[k] - world[k] for k in down]
                d = Vector()
                for dv in ds:
                    d += Vector((dv.x, dv.y, 0.0))
                if ds:
                    d /= len(ds)
                last_d = d
                since = 0
            else:
                anchors = None
                since += 1
                d = last_d * (1.0 - smoothstep(since / fade)) if since <= fade else Vector()
            if d.length < 1e-7:
                continue
            dl = rq.inverted() @ d
            ankle = ps.P["foot" + S] + dl
            sg = 1 if S == "L" else -1
            fwd = ps.D["foot" + S] @ Vector((0, -1, 0))
            pole = Vector((fwd.x, fwd.y, 0.0)).normalized() + Vector((0.12 * sg, 0, 0))
            sk.leg(pose, S, ankle, ps.D["foot" + S], pole, toe=pose.get("toe" + S), t=tr)


# ---------------------------------------------------------------- keying


def match_lod_weights(near, far):
    """Carry near-surface skinning onto the reduced far surface, without moving vertices/UVs.

    Independent reduction can retain a different arm/torso weight mix at sleeve seams.
    Transfer from the closest near triangle and retain four normalized bone influences.
    """
    from mathutils.bvhtree import BVHTree
    near.data.calc_loop_triangles()
    triangles = [tuple(t.vertices) for t in near.data.loop_triangles]
    points = [v.co.copy() for v in near.data.vertices]
    tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)
    names = {g.index: g.name for g in near.vertex_groups}
    weights = [{names[g.group]: g.weight for g in v.groups if names[g.group] in NAMES} for v in near.data.vertices]
    groups = {n: far.vertex_groups.get(n) or far.vertex_groups.new(name=n) for n in NAMES}
    changed, largest = 0, 0.0
    for v in far.data.vertices:
        p, _, face, distance = tree.find_nearest(v.co)
        if p is None or distance > 0.065:
            continue
        ids = triangles[face]
        a, b, c = (points[i] for i in ids)
        u, w, q = b - a, c - a, p - a
        uu, uw, ww = u.dot(u), u.dot(w), w.dot(w)
        den = uu * ww - uw * uw
        if abs(den) < 1e-12:
            continue
        y = (ww * q.dot(u) - uw * q.dot(w)) / den
        z = (uu * q.dot(w) - uw * q.dot(u)) / den
        shares = (max(0, 1 - y - z), max(0, y), max(0, z))
        mix = {}
        for i, share in zip(ids, shares):
            for name, weight in weights[i].items():
                mix[name] = mix.get(name, 0) + weight * share
        top = sorted(mix.items(), key=lambda pair: pair[1], reverse=True)[:4]
        total = sum(weight for _, weight in top)
        if total <= 0:
            continue
        old = {far.vertex_groups[g.group].name: g.weight for g in v.groups if far.vertex_groups[g.group].name in NAMES}
        new = {name: weight / total for name, weight in top}
        difference = sum(abs(old.get(n, 0) - new.get(n, 0)) for n in set(old) | set(new))
        largest = max(largest, difference)
        if difference < 0.001:
            continue
        for name in old:
            groups[name].remove([v.index])
        for name, weight in new.items():
            groups[name].add([v.index], weight, "REPLACE")
        changed += 1
    return changed, largest


def key_clip(ao, clip):
    """Key a Clip on the armature ao as an action named clip.name (every body bone's rotation and the hips'
    translation at every frame), on its own muted NLA track, as the kit's other clips."""
    import bpy

    ad = ao.animation_data_create()
    bones = ao.data.bones
    rest = {bn: bones[bn].matrix_local.to_quaternion() for bn in KEYED}
    hrest = bones["hips"].matrix_local.to_3x3()
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    ad.action = act
    for f, (pose, t) in enumerate(zip(clip.poses, clip.trans)):
        prev = None
        pose = shoulder_helpers(dict(pose))  # the helpers always follow armUp by the rule
        for bn in KEYED:
            q = pose.get(bn, Quaternion())
            local = rest[bn].inverted() @ q @ rest[bn]
            pb = ao.pose.bones[bn]
            # keep neighbouring keys on the same side of the quaternion double cover (no flips when slerped)
            if f > 0:
                prev = pb.rotation_quaternion.copy()
                if prev.dot(local) < 0:
                    local = -local
            pb.rotation_quaternion = local
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
        pb = ao.pose.bones["hips"]
        pb.location = hrest.inverted() @ Vector(t)
        pb.keyframe_insert("location", frame=f + 1)
    tr = ad.nla_tracks.new()
    tr.name = clip.name
    st = tr.strips.new(clip.name, 1, act)
    st.name = clip.name
    tr.mute = True
    ad.action = None
    for pb in ao.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return act


# ---------------------------------------------------------------- checks


def pose_step(a, b):
    """The largest turn of any body bone between two poses (degrees)."""
    return max(angle(a.get(bn, Quaternion()), b.get(bn, Quaternion())) for bn in KEYED)


def seam(clip):
    """How cleanly a loop closes: (gap, jerk, typical). gap: the largest bone turn between the last and the first
    frame (0 for a loop made from a looping function); jerk: the largest change of a bone's turning speed across
    the seam, in degrees per frame, against `typical`, the largest such change anywhere inside the clip."""
    P = clip.poses
    n = len(P)
    gap = pose_step(P[-1], P[0])
    trans_gap = (clip.trans[-1] - clip.trans[0]).length

    def accel(a, b, c):
        # change of turning speed at b, per bone, by angles of the two steps (with their direction)
        worst = 0.0
        for bn in KEYED:
            qa, qb, qc = a.get(bn, Quaternion()), b.get(bn, Quaternion()), c.get(bn, Quaternion())
            d1 = qb @ qa.inverted()
            d2 = qc @ qb.inverted()
            if d1.dot(d2) < 0:
                d2 = -d2
            v1 = Vector(d1.to_exponential_map())
            v2 = Vector(d2.to_exponential_map())
            worst = max(worst, math.degrees((v2 - v1).length))
        return worst

    jerk = accel(P[-2], P[0], P[1]) if n > 2 else 0.0
    typical = max(accel(P[i - 1], P[i], P[i + 1]) for i in range(1, n - 1)) if n > 2 else 0.0
    return {"gap": gap, "trans_gap": trans_gap, "jerk": jerk, "typical": typical}


def slide(clip, sub=4, eps=0.004):
    """The foot-slide measure. Replays the clip as the games do (keys slerped between frames, `sub` steps a frame),
    moves it by its root, and follows each foot's heel, ball and tip. While the foot is in a stance (the clip's
    meta "_swing" says when it swings) every contact point that is on the ground (within eps) must stay where it
    touched down: 'keys' is the largest drift at the keys, 'played' between them too. While the foot swings, a
    point that touches the ground is a scuff: 'scuff' is how far it travels touching (0: the foot clears)."""
    sk = clip.skel
    n = len(clip.poses)
    swing_of = clip.meta.get("_swing")
    res = {}
    samples = []
    steps = (n - 1) * sub + 1
    for i in range(steps):
        t = i / (sub * FPS)
        pose, tr = clip.sample(t)
        rp, ry = clip.root(t)
        ps = sk.fk(pose, tr)
        rq = RZ(ry)
        pts = {}
        for S in "LR":
            for k, p in contacts(ps, sk, S).items():
                pts[(S, k)] = rp + rq @ p
        sw = {S: bool(swing_of and swing_of[S](t)) for S in "LR"}
        samples.append((i % sub == 0, pts, sw))
    for S in "LR":
        worst_keys = worst_played = scuff = 0.0
        stance_frames = 0
        for k in ("heel", "ball", "tip"):
            anchor = anchor_k = None
            prev = None
            for is_key, pts, sw in samples:
                p = pts[(S, k)]
                on = p.z - clip.ground(p) < eps
                if sw[S]:
                    if on and prev is not None:
                        scuff = max(scuff, math.hypot(p.x - prev.x, p.y - prev.y))
                    prev = p.copy() if on else None
                    anchor = anchor_k = None
                    continue
                prev = None
                if on:
                    if anchor is None:
                        anchor = p.copy()
                    worst_played = max(worst_played, math.hypot(p.x - anchor.x, p.y - anchor.y))
                    if is_key:
                        if anchor_k is None:
                            anchor_k = p.copy()
                        worst_keys = max(worst_keys, math.hypot(p.x - anchor_k.x, p.y - anchor_k.y))
                        if k == "ball":
                            stance_frames += 1
                else:
                    anchor = anchor_k = None
        res[S] = {"keys": worst_keys, "played": worst_played, "scuff": scuff, "frames": stance_frames}
    return res


def clearance(clip, sub=2):
    """The lowest the toe tip passes over the ground while that foot swings (m): a stub check."""
    sk = clip.skel
    n = len(clip.poses)
    worst = {}
    swing_of = clip.meta.get("_swing")  # per foot: a function t -> True while swinging
    if not swing_of:
        return {}
    for S in "LR":
        lo = 9.0
        for i in range((n - 1) * sub + 1):
            t = i / (sub * FPS)
            if not swing_of[S](t):
                continue
            pose, tr = clip.sample(t)
            rp, ry = clip.root(t)
            ps = sk.fk(pose, tr)
            c = contacts(ps, sk, S)
            for k in ("tip", "ball", "heel"):
                p = rp + RZ(ry) @ c[k]
                lo = min(lo, p.z - clip.ground(p))
        worst[S] = lo
    return worst


def joins(a, b, at_a=-1, at_b=0):
    """How far clip a's frame at_a is from clip b's frame at_b: the largest bone turn (degrees) and the hips'
    gap (m, after taking off a's travel). For a start that hands over to a loop, or a loop to a stop."""
    pa, pb = a.poses[at_a], b.poses[at_b]
    ta, tb = a.trans[at_a], b.trans[at_b]
    trav = Vector(a.meta.get("_travel_vec", (0, 0, 0)))
    return {"turn": pose_step(pa, pb), "hips": (ta - trav - tb).length}


def fk_check(ao, skel, pose, t=None):
    """This module's FK against Blender's: set the pose on ao, let Blender evaluate it, compare every bone head
    (m) and turn (degrees). Both near 0 means the clips play as authored."""
    import bpy

    bones = ao.data.bones
    for pb in ao.pose.bones:
        q = pose.get(pb.name, Quaternion())
        r = bones[pb.name].matrix_local.to_quaternion()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = r.inverted() @ q @ r
        pb.location = Vector()
    if t is not None:
        ao.pose.bones["hips"].location = bones["hips"].matrix_local.to_3x3().inverted() @ Vector(t)
    bpy.context.view_layer.update()
    ps = skel.fk(pose, t)
    dp = dq = 0.0
    for pb in ao.pose.bones:
        dp = max(dp, (pb.head - ps.P[pb.name]).length)
        g = pb.matrix.to_quaternion() @ bones[pb.name].matrix_local.to_quaternion().inverted()
        dq = max(dq, angle(g, ps.D[pb.name]))
    for pb in ao.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return dp, dq

"""Idles, talk and sitting for the people2 kit (package D2; docs/people.md "Idles, talk and sitting").

Every clip here is made on its own body (FAMILIES) from a Spec: where the feet stand (and the few short steps of a
shift of the feet), how the weight goes from foot to foot, what the trunk, the head, the arms, the hands and the jaw
do. Each frame:
- the hips come from the weight: over the loaded foot, the free side of the pelvis dropped, the height from the
  loaded leg's knee (a straight standing leg, a relaxed free one);
- the legs are solved by IK onto the planted feet (a planted foot does not move: 0 mm at the keys); the free foot
  rises on its ball as far as its relaxed knee needs, the toes staying down;
- the trunk counters the pelvis (the shoulders stay level) and breathes; the head leads every look and the chest
  follows it a moment later;
- each arm either hangs (breathing, and trailing the body's sway like a pendulum) or puts its hand on a point of the
  body or of the space before it (IK, the elbow toward a pole); between two arm poses the joints turn one after the
  other from the shoulder out (the hand and the fingers last);
- the hands take shapes, the jaw speaks.
Sitting is the same with the pelvis on the seat (the seat's height and the body's own thighs and buttocks).

The mechanics of docs/plans/people.md section 3 D: weight, opposition, planted feet, the head leads, breathing in
every clip, calm (no fidgeting), loops that close exactly (every signal is periodic in the loop; `motion.seam`
measures it), and no two people the same: several variants a family, the runtime picks one from the person's id,
changes it now and then at a seam and plays each person at its own rate and phase (docs/godot-people2.md).

Every loop of a family starts (and ends) in that family's neutral stance: the weight in the middle, the feet at
their base. So the runtime can hand one idle (or talk) over to another at a seam without a foot moving.
"""

import math
import random

from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

from . import FPS
from . import clips_legacy as cl
from . import clips_move as cm
from . import motion as mo
from .motion import RX, RY, RZ, V, bow, clamp, lean, lerp, smootherstep, smoothstep, swing, turn, yaw
from .rig import KEYED

TAU = 2 * math.pi

# ---------------------------------------------------------------- signals


class Held:
    """A periodic signal that rests on values and moves between them. moves: [(t, dur, value[, overshoot])] in
    time order; it starts at `start`, and a loop's last move comes back to it. A move eases with smootherstep (no
    jolt where it starts or stops), or passes its end a little and settles (overshoot, a share of the move)."""

    def __init__(self, T, start, moves=(), over=0.0, loop=True):
        self.T, self.start, self.over, self.loop = T, start, over, loop
        self.moves = sorted(moves, key=lambda m: m[0])
        if loop and self.moves:
            last = self.moves[-1][2]
            assert abs(_num(last) - _num(start)) < 1e-9, "a loop must end where it starts"
            assert self.moves[-1][0] + self.moves[-1][1] <= T + 1e-9, "the last move must end inside the loop"

    def __call__(self, t):
        if self.loop:
            t %= self.T
        v = self.start
        for m in self.moves:
            tm, d, val = m[0], m[1], m[2]
            ov = m[3] if len(m) > 3 else self.over
            if t >= tm + d:
                v = val
                continue
            if t <= tm:
                break
            u = (t - tm) / d
            e = mo.overshoot(u, ov) if ov > 0 else smootherstep(u)
            return v + (val - v) * e
        return v


def _num(v):
    return v if isinstance(v, (int, float)) else Vector(v).length


def drift(T, seed, amp, harmonics=(1, 2, 3, 5)):
    """A slow, smooth, periodic wander of size `amp` (sums of sines on whole harmonics of the loop): the small
    unrest of a living body. Different seeds give different wanders."""
    r = random.Random(seed)
    terms = [(h, r.uniform(0, TAU), r.uniform(0.5, 1.0) * 0.7 ** i) for i, h in enumerate(harmonics)]
    norm = sum(a for _, _, a in terms)
    return lambda t: amp * sum(a * math.sin(TAU * h * t / T + p) for h, p, a in terms) / norm


def pulse(t, a, b, rise=0.25, fall=0.35):
    """0 outside [a, b], 1 inside, smooth ramps of `rise` and `fall` seconds."""
    if t <= a or t >= b:
        return 0.0
    return smootherstep((t - a) / rise) * smootherstep((b - t) / fall)


def nods(t, at, n=2, amp=6.0, rate=2.2):
    """n small nods starting at `at`: the head drops and comes back, each a little smaller."""
    out = 0.0
    for k in range(n):
        t0 = at + k / rate
        u = (t - t0) * rate
        if 0 < u < 1:
            out += amp * (0.8 ** k) * math.sin(math.pi * u) ** 2
    return out


def periodic(fn, T):
    """fn made periodic in T (for one-off events placed inside a loop near its ends)."""
    return lambda t: fn(t % T) + fn(t % T + T) + fn(t % T - T)


# ---------------------------------------------------------------- hands

HANDS = dict(cl.HANDS)
HANDS.update({
    # resting on the hips or a thigh: nearly flat, a little curl
    "rest": dict(index=(10, 16, 8), middle=(13, 20, 10), ring=(18, 26, 12), thumb=(14, 8, 8)),
    # folded round the other hand
    "clasp": dict(index=(40, 50, 26), middle=(44, 54, 28), ring=(48, 58, 30), thumb=(26, 18, 14)),
    # the finger tips at work
    "scratch": dict(index=(36, 62, 44), middle=(40, 66, 46), ring=(48, 70, 46), thumb=(22, 18, 14)),
    # a speaker's loose hand
    "beat": dict(index=(8, 12, 7), middle=(11, 16, 9), ring=(16, 22, 11), thumb=(8, 6, 6)),
    # a palm turned up, offering
    "palm": dict(index=(4, 7, 4), middle=(5, 8, 5), ring=(8, 11, 6), thumb=(-4, 6, 4)),
    # tucked under the other arm
    "tuck": dict(index=(24, 32, 16), middle=(28, 36, 18), ring=(32, 42, 20), thumb=(16, 10, 10)),
    # in a pocket
    "pocket": dict(index=(28, 40, 22), middle=(32, 44, 24), ring=(36, 48, 26), thumb=(14, 12, 8)),
    # a loose fist on the hip
    "knuckle": dict(cl.HANDS["fist"]),
})
_FINGERS = ("index", "middle", "ring", "thumb")


def shape_of(name):
    h = HANDS[name]
    return {f: tuple(h[f]) for f in _FINGERS}


def mix_shape(a, b, w):
    return {f: tuple(lerp(x, y, w) for x, y in zip(a[f], b[f])) for f in _FINGERS}


def set_hand(pose, S, h, axes):
    """The finger turns for shape values h (as clips_legacy.hand_pose, from numbers instead of a name)."""
    sg = 1 if S == "L" else -1
    cl.finger_turns(pose, S, h, axes)
    flex, across = axes[S]
    a, m, i = h["thumb"]
    pose["thumb1" + S] = Quaternion(across, math.radians(a * 0.6)) @ Quaternion(flex, math.radians(a * 0.4))
    pose["thumb2" + S] = Quaternion(flex, math.radians(m))
    pose["thumb3" + S] = Quaternion(flex, math.radians(i))


def arm_bones(S):
    return ["clavicle" + S, "armUp" + S, "armLow" + S, "armTwist" + S, "hand" + S]


# ---------------------------------------------------------------- a family's body


class Fam:
    """A family of clips made on one body: its skeleton, its stance, the surface of its body (for a hand resting on
    it, from the near copy at rest)."""

    def __init__(self, name, b, stance):
        self.name, self.b, self.body = name, b, b["name"]
        self.P, self.J = b["P"], b["J"]
        self.sk = mo.Skel(b["J"], b["lod0"], b["name"])
        self.ax = cl.thumb_axes(b["J"])
        self.st = dict(stance)
        self.k = self.P["H"] / 1.67
        me = b["lod0"].data
        self.bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
        sk = self.sk
        # the palm's middle, from the wrist, at rest (armature axes); the palm faces the body's middle at rest
        self.palm = {}
        for S in "LR":
            sg = 1 if S == "L" else -1
            w = sk.rest["hand" + S]
            kn = sk.rest["middle1" + S]
            self.palm[S] = (kn - w) * 0.45 + Vector((-sg * 0.016 * self.k, 0.0, 0.0))

    def skin(self, origin, d, clear=0.0):
        """The body's surface along d from a point inside it (the first hit), pushed out by `clear`."""
        d = Vector(d).normalized()
        o = Vector(origin)
        loc, _n, _i, _dist = self.bvh.ray_cast(o, d)
        if loc is None:
            return o + d * 0.1
        return loc + d * clear

    def base_flat(self, S, off=(0.0, 0.0, 0.0)):
        """Where foot S stands in the family's stance (its ankle, flat), moved by off (left, fwd, yaw)."""
        sg = 1 if S == "L" else -1
        st = self.st
        x = sg * st["width"] / 2 + off[0]
        f = st.get("fwd" + S, 0.0) + off[1]
        yw = sg * st["toe"] + off[2]
        return cm.stance_flat(self.sk, S, f, x, lambda p: 0.0, 0.0, yw), yw


# ---------------------------------------------------------------- arms


class Hang:
    """An arm hanging: swung a little forward and out, the elbow soft, breathing; it trails the body's sway."""

    def __init__(self, fwd=3.0, out=7.0, elbow=12.0, twist=6.0, hand=5.0, shape="relaxed", clav=0.0):
        self.fwd, self.out, self.elbow, self.twist, self.hand, self.shape, self.clav = fwd, out, elbow, twist, hand, shape, clav

    def apply(self, fam, pose, S, ctx):
        sg = 1 if S == "L" else -1
        br = ctx["breath"]
        lag = ctx.get("armLag", (0.0, 0.0))
        out = self.out + 0.35 * br + sg * lag[0]
        fwd = self.fwd + lag[1]
        pose["clavicle" + S] = RY(-sg * (self.clav + 0.5 * br))
        pose["armUp" + S] = swing(S, fwd=fwd, out=out, twist=self.twist)
        pose["armLow" + S] = RX(-(self.elbow + 0.5 * br + 0.4 * abs(lag[1])))
        pose["hand" + S] = RX(-self.hand)
        mo.twist_rule(pose, S)
        return shape_of(self.shape)


class Place:
    """A hand put on a point: at(fam, S) gives the palm's middle at rest (armature axes), carried by `bone`;
    fingers and palm: where the fingers point and the palm faces, in that bone's rest frame (the person's words via
    V); pole: where the elbow goes (same frame). wob(t) -> a small offset (the person's words, metres) in the
    bone's frame. clav: the clavicle's turn (None: the kit's rule from where the hand goes)."""

    def __init__(self, at, fingers, palm, pole, shape="rest", bone="chest", clav=None, wob=None, hand_extra=None,
                 wrist=False, hand=None):
        self.at, self.fingers, self.palm, self.pole, self.shape = at, fingers, palm, pole, shape
        self.bone, self.clav, self.wob, self.hand_extra = bone, clav, wob, hand_extra
        self.wrist = wrist  # `at` is the wrist, not the palm's middle
        self.hand = hand  # (supination, flexion, radial deviation) of the hand against its forearm, degrees

    def _get(self, v, fam, S, ctx):
        return v(fam, S, ctx) if callable(v) else v

    def apply(self, fam, pose, S, ctx):
        sk = fam.sk
        ps = sk.fk(pose, ctx["trans"])
        at = self._get(self.at, fam, S, ctx)
        bone = self.bone(S) if callable(self.bone) else self.bone
        if bone is None:  # the place is given in the armature's axes as it stands now
            Db = Quaternion()
            p = Vector(at)
        else:
            Db = ps.D[bone]
            p = ps.point(bone, at)
        if self.wob is not None:
            p = p + Db @ self.wob(ctx["t"], S)
        fingers = self._get(self.fingers, fam, S, ctx)
        palm = self._get(self.palm, fam, S, ctx)
        rot = Db @ cm.hand_aim(S, fingers, palm)
        if self.hand_extra is not None:
            rot = rot @ self.hand_extra(ctx["t"], S)
        wrist = p if self.wrist else p - rot @ fam.palm[S]
        if self.clav is None:
            pose["clavicle" + S] = Quaternion()
            ps = sk.fk(pose, ctx["trans"])
            pose["clavicle" + S] = mo.clavicle_for(ps, S, wrist)
        else:
            c = self._get(self.clav, fam, S, ctx)
            pose["clavicle" + S] = c
        pole = Db @ self._get(self.pole, fam, S, ctx)
        sk.arm(pose, S, wrist, rot, pole, t=ctx["trans"])
        if self.hand is not None:
            hq = hand_turn(S, *self._get(self.hand, fam, S, ctx))
            pose["hand" + S] = hq
            if not self.wrist:
                # the palm (not the wrist) goes to the place: move the wrist by what the hand's own turn moved it
                for _ in range(2):
                    ps2 = sk.fk(pose, ctx["trans"])
                    palm_now = ps2.P["hand" + S] + ps2.D["hand" + S] @ fam.palm[S]
                    wrist = wrist + (p - palm_now)
                    sk.arm(pose, S, wrist, ps2.D["hand" + S], pole, t=ctx["trans"])
                    pose["hand" + S] = hq
        limit_twist(pose, S)
        sh = self._get(self.shape, fam, S, ctx)
        return shape_of(sh) if isinstance(sh, str) else sh


class Mix:
    """Two arm poses mixed by w(t) (joint by joint), for a pose that leans between two."""

    def __init__(self, a, b, w):
        self.a, self.b, self.w = a, b, w

    def apply(self, fam, pose, S, ctx):
        pa, pb = dict(pose), dict(pose)
        ha = self.a.apply(fam, pa, S, ctx)
        hb = self.b.apply(fam, pb, S, ctx)
        w = self.w(ctx["t"])
        for bn in arm_bones(S):
            qa, qb = pa.get(bn, Quaternion()), pb.get(bn, Quaternion())
            if qa.dot(qb) < 0:
                qb = -qb
            pose[bn] = qa.slerp(qb, w)
        return mix_shape(ha, hb, w)


class ArmTrack:
    """One arm through a clip: keys [(t, spec, dur[, over])]: at t the arm starts to move to `spec` and gets there
    in `dur` seconds. The joints move one after the other from the shoulder out (the hand and the fingers last),
    with an ease, or passing the end a little (over). In a loop the arm before the first key is in the last key's
    pose."""

    LAG = {"clavicle": 0.0, "armUp": 0.0, "armLow": 0.05, "armTwist": 0.07, "hand": 0.09}

    def __init__(self, keys, T, loop=True):
        self.keys = sorted(keys, key=lambda k: k[0])
        self.T, self.loop = T, loop

    def at(self, t):
        """(previous spec, spec, seconds since the move began, dur, over)."""
        ks = self.keys
        if self.loop:
            t %= self.T
        cur = None
        for i, k in enumerate(ks):
            if k[0] <= t:
                cur = i
        if cur is None:
            if self.loop:
                k = ks[-1]
                prev = ks[-2] if len(ks) > 1 else ks[-1]
                return prev[1], k[1], t + self.T - k[0], k[2], (k[3] if len(k) > 3 else 0.0)
            return ks[0][1], ks[0][1], 1e9, 1.0, 0.0
        k = ks[cur]
        prev = ks[cur - 1] if cur > 0 else (ks[-1] if self.loop else k)
        return prev[1], k[1], t - k[0], k[2], (k[3] if len(k) > 3 else 0.0)

    def apply(self, fam, pose, S, ctx):
        a, b, since, dur, over = self.at(ctx["t"])
        if since >= dur + 0.12 or a is b:
            return b.apply(fam, pose, S, ctx)
        pa, pb = dict(pose), dict(pose)
        ha = a.apply(fam, pa, S, ctx)
        hb = b.apply(fam, pb, S, ctx)

        def w_of(lag):
            u = (since - lag) / max(1e-3, dur - lag * 0.5)
            u = clamp(u)
            return mo.overshoot(u, over) if over > 0 else smootherstep(u)

        for bn in arm_bones(S):
            lag = self.LAG[bn[:-1]]
            qa, qb = pa.get(bn, Quaternion()), pb.get(bn, Quaternion())
            if qa.dot(qb) < 0:
                qb = -qb
            w = w_of(lag)
            pose[bn] = qa.slerp(qb, w) if 0 <= w <= 1 else _slerp_x(qa, qb, w)
        return mix_shape(ha, hb, clamp(w_of(0.11)))


def hand_turn(S, sup=0.0, flex=0.0, dev=0.0):
    """The hand against its forearm (pose convention): supination (+ turns the palm up from the thumb-up
    neutral of a forearm held forward), flexion (+ toward the palm), radial deviation (+ toward the thumb)."""
    sg = sgn(S)
    return RZ(sg * sup) @ RY(sg * flex) @ RX(-dev)


TWIST_MAX = 100.0  # the most a hand turns about its forearm (pronation, supination) from the arm's own frame


def limit_twist(pose, S, most=TWIST_MAX):
    """Keep the hand's turn about the forearm inside what a wrist does (and away from the half turn where the
    twist bone's share would flip); armTwist follows by the kit's rule."""
    qh = pose.get("hand" + S, Quaternion())
    sw, tw = mo.swing_twist(qh, (0, 0, 1))
    ang = 2 * math.degrees(math.atan2(math.copysign(Vector((tw.x, tw.y, tw.z)).length, tw.z), tw.w))
    if ang > 180:
        ang -= 360
    if ang < -180:
        ang += 360
    if abs(ang) > most:
        pose["hand" + S] = sw @ RZ(math.copysign(most, ang))
    mo.twist_rule(pose, S)


def _slerp_x(qa, qb, w):
    """slerp past its ends (an overshoot)."""
    d = qa.inverted() @ qb
    ax, ang = d.to_axis_angle()
    return qa @ Quaternion(ax, ang * w)


# ---------------------------------------------------------------- the clip spec


class Spec:
    """What a clip does (the module note). Every attribute is a function of t (seconds) unless said."""

    def __init__(self, fam, T, loop=True):
        self.fam, self.T, self.loop = fam, T, loop
        st = fam.st
        self.weight = lambda t: 0.5  # the share of the weight on the left foot
        self.steps = {"L": [], "R": []}  # [(t_lift, t_land, (left, fwd, yaw) after the step)]
        self.side = lambda t: 0.0  # the hips sideways (m), beyond the weight's own shift
        self.fwd = lambda t: 0.0  # the hips forward (m)
        self.dz = lambda t: 0.0  # the hips lower (m, negative)
        self.hips = lambda t: (0.0, 0.0, 0.0)  # extra (yaw, bow, lean) of the pelvis, degrees
        self.trunk = lambda t: (0.0, 0.0, 0.0)  # extra (bow, side, twist) of the spine chain, degrees
        self.look = lambda t: (0.0, 0.0, 0.0)  # the head's (yaw, pitch down, tilt left), degrees
        self.keep = st.get("keep", 0.35)  # how much of the trunk's motion the head keeps
        self.lead = 0.2  # the chest's share of a look (it follows the head)
        self.lead_lag = 0.35  # and how much later (s)
        self.breath_T = st.get("breathT", 4.0)
        self.breath_amp = st.get("breath", 1.0)
        self.arms = {}  # S -> ArmTrack or a single spec
        self.jaw = lambda t: 0.6
        self.knees = None  # (load, free) degrees: st's by default
        self.roll_max = st.get("roll", 10.0)
        self.seat = None  # sitting: dict(h=seat height, feet={S: (left, fwd, yaw)}, pole={S: V}, hips=(x, f))
        self.hips_at = None  # t -> (Vector hips position (armature), Quaternion): the hips given outright
        self.feet_at = None  # t -> {S: dict(flat=, yaw=, roll=, lift=)} given outright (transitions)
        self.toe_curl = lambda t, S: 0.0
        self.meta = {}

    # the feet
    def foot(self, S, t):
        """Foot S at t: dict(flat (ankle when flat), yaw, roll_min, swing (bool), ankle/rot/toe while it swings)."""
        fam = self.fam
        if self.feet_at is not None:
            return self.feet_at(t)[S]
        steps = self.steps[S]
        T = self.T
        tt = t % T if self.loop else t
        off0 = steps[-1][2] if (steps and self.loop) else (0.0, 0.0, 0.0)
        cur = off0
        for lift, land, off in steps:
            if tt < lift - 0.2:
                break
            if tt < lift:
                # the heel rises before the foot lifts (the ball stays down)
                flat, yw = fam.base_flat(S, cur)
                return dict(flat=flat, yaw=yw, roll_min=12.0 * smoothstep((tt - (lift - 0.2)) / 0.2), swing=False)
            if tt <= land:
                u = (tt - lift) / (land - lift)
                f0, y0 = fam.base_flat(S, cur)
                f1, y1 = fam.base_flat(S, off)
                a0, _, _ = mo.roll(fam.sk, S, f0, y0, 12.0)
                e = smootherstep(u)
                ank = a0.lerp(f1, e) + Vector((0, 0, 0.028 * fam.k * math.sin(math.pi * u) ** 1.2))
                yw = lerp(y0, y1, e)
                r = 12.0 * (1 - smootherstep(min(1.0, u / 0.7))) - 4.0 * math.sin(math.pi * u)
                rot = cm.foot_rot(yw, 0.0, r)
                toe = RX(-max(0.0, 12.0 * (1 - smoothstep(u / 0.5))))
                return dict(flat=f1, yaw=yw, roll_min=0.0, swing=True, ankle=ank, rot=rot, toe=toe)
            cur = off
        flat, yw = fam.base_flat(S, cur)
        return dict(flat=flat, yaw=yw, roll_min=0.0, swing=False)

    def swinging(self, S):
        if self.feet_at is not None:
            return lambda t: bool(self.feet_at(t)[S].get("swing"))
        steps = self.steps[S]
        T, loop = self.T, self.loop

        def fn(t):
            tt = t % T if loop else t
            return any(lift < tt < land for lift, land, _ in steps)

        return fn


# ---------------------------------------------------------------- one frame


def _hip_joint(sk, S, hpos, qh):
    return hpos + qh @ (sk.rest["legUp" + S] - sk.rest["hips"])


def _height_for(sk, S, xy, qh, ankle, d):
    """The hips' height that puts leg S's hip joint at distance d from its ankle."""
    hj = _hip_joint(sk, S, Vector((xy.x, xy.y, 0.0)), qh)
    hor = math.hypot(hj.x - ankle.x, hj.y - ankle.y)
    return ankle.z + math.sqrt(max(0.0, d * d - hor * hor)) - hj.z


def frame(spec, t, lag=(0.0, 0.0), arms=True):
    """The pose and the hips translation of a Spec at t. lag: the hanging arms' trail (degrees out, forward)."""
    fam = spec.fam
    sk = fam.sk
    st = fam.st
    T = spec.T
    ctx = {"t": t, "T": T, "armLag": lag}
    br = spec.breath_amp * math.sin(TAU * t / spec.breath_T)
    ctx["breath"] = br
    feet = {S: spec.foot(S, t) for S in "LR"}
    pose = {}
    sitting = spec.seat is not None
    if spec.hips_at is not None:
        hpos, qh = spec.hips_at(t)
        w = spec.weight(t)
        loads = {"L": 1.0, "R": 1.0}
    elif sitting:
        se = spec.seat
        w = spec.weight(t)
        hy, hb, hl = spec.hips(t)
        x = se["hips"][0] + spec.side(t)
        f = se["hips"][1] + spec.fwd(t)
        qh = yaw(hy) @ bow(hb) @ lean(hl)
        hpos = Vector((x, -f, se["H"] + spec.dz(t)))
        loads = {"L": 0.0, "R": 0.0}
    else:
        w = spec.weight(t)
        aL, aR = feet["L"]["flat"], feet["R"]["flat"]
        mid = (aL + aR) / 2
        x = mid.x + (2 * w - 1) * st["shift"] + spec.side(t)
        f = -mid.y + st.get("hipsFwd", 0.0) + spec.fwd(t)
        hy, hb, hl = spec.hips(t)
        qh = yaw((2 * w - 1) * st["yaw"] + hy) @ bow(st.get("tilt", 0.0) + hb) @ lean(-(2 * w - 1) * st["list"] + hl)
        xy = Vector((x, -f, 0.0))
        loads = {"L": smoothstep((w - 0.2) / 0.6), "R": smoothstep((0.8 - w) / 0.6)}
        kl, kf = spec.knees or (st["kLoad"], st["kFree"])
        Hs, Hm, ws = 0.0, 1e9, 0.0
        for S in "LR":
            ft = feet[S]
            if ft["swing"]:
                continue
            a = ft["flat"]
            k = lerp(kf, kl, loads[S])
            Hs += (loads[S] + 0.05) * _height_for(sk, S, xy, qh, a, cm.knee_dist(sk, k))
            ws += loads[S] + 0.05
            Hm = min(Hm, _height_for(sk, S, xy, qh, a, cm.knee_dist(sk, 1.5)))
        H = min(Hs / ws, Hm) + spec.dz(t)
        hpos = Vector((x, -f, H))
    tr = hpos - sk.rest["hips"]
    ctx["trans"] = tr
    ctx["w"] = w
    pose["hips"] = qh
    ps = sk.fk(pose, tr)
    # the legs
    for S in "LR":
        ft = feet[S]
        sg = 1 if S == "L" else -1
        if ft["swing"]:
            ank, rot, toe = ft["ankle"], ft["rot"], ft["toe"]
        else:
            r = ft.get("roll", ft["roll_min"])
            if not sitting and spec.hips_at is None:
                # the free foot rises on its ball as far as its relaxed knee needs
                kl, kf = spec.knees or (st["kLoad"], st["kFree"])
                kw = lerp(kf, kl, loads[S])
                dmax = cm.knee_dist(sk, kw)
                hj = ps.P["legUp" + S]

                def far(rr):
                    a_, _, _ = mo.roll(sk, S, ft["flat"], ft["yaw"], rr)
                    return (a_ - hj).length - dmax

                if far(r) > 0 and spec.roll_max > r:
                    lo, hi = r, spec.roll_max
                    if far(hi) > 0:
                        r = hi
                    else:
                        for _ in range(24):
                            mid_ = (lo + hi) / 2
                            if far(mid_) > 0:
                                lo = mid_
                            else:
                                hi = mid_
                        r = hi
            ank, rot, toe = mo.roll(sk, S, ft["flat"], ft["yaw"], r)
            toe = RX(-r) if r > 0 else Quaternion()
        if sitting and spec.seat.get("pole"):
            pole = spec.seat["pole"][S]
        else:
            pole = RZ(ft["yaw"]) @ V(0.10 * sg, 1.0, 0.0)
        sk.leg(pose, S, ank, rot, pole, toe=toe, posed=ps)
    # the trunk: the shoulders against the pelvis, breathing, the chest after the head
    hy_, hb_, hl_ = (0.0, 0.0, 0.0)
    pl = 0.0
    if not sitting and spec.hips_at is None:
        pl = -(2 * w - 1) * st["list"] + spec.hips(t)[2]
        hy_ = (2 * w - 1) * st["yaw"] + spec.hips(t)[0]
    tb, ts, tw = spec.trunk(t)
    ly = spec.look(t - spec.lead_lag)[0]
    twist = tw - 0.5 * hy_ + spec.lead * ly
    side = -0.8 * pl + ts
    lean_f = st.get("lean", 0.0) + tb
    pose["spine"] = turn(0.3 * twist, 0.40 * lean_f + 0.2 * br, 0.45 * side)
    pose["chest"] = turn(0.35 * twist, 0.32 * lean_f - 0.6 * br, 0.35 * side)
    pose["upperChest"] = turn(0.35 * twist, 0.28 * lean_f - 0.6 * br, 0.2 * side)
    # the head (before the arms: a hand on the head follows it)
    hyaw, hpit, htil = spec.look(t)
    tgt = RZ(hyaw) @ RX(hpit + st.get("lookDown", 0.0)) @ RY(htil)
    sk.look(pose, tgt, t=tr, keep=spec.keep)
    pose["jaw"] = RX(spec.jaw(t))
    # the arms and the hands
    if arms:
        ctx["posed"] = sk.fk(pose, tr)
        shapes = {}
        for S in "LR":
            sp = spec.arms.get(S)
            if sp is None:
                sp = Hang()
            shapes[S] = sp.apply(fam, pose, S, ctx)
        for S in "LR":
            set_hand(pose, S, shapes[S], fam.ax)
    return pose, tr


LAG_GAIN = 260.0  # degrees of arm swing per metre the body runs ahead of its hanging arms


def evaluate(spec, name, meta=None):
    """The Clip of a Spec: frames at FPS over the loop (the last frame is the first again)."""
    n = int(round(spec.T * FPS))
    T = n / FPS
    spec.T = T
    fam = spec.fam
    if spec.loop:
        # a whole number of breaths a loop (the seam stays clean)
        spec.breath_T = T / max(1, round(T / spec.breath_T))
    # first pass: the hips' path, for the hanging arms' lag (a pendulum on the body's sway)
    path = []
    for i in range(n + 1):
        _, tr = frame(spec, i / FPS, arms=False)
        path.append(Vector(tr))
    px = [p.x for p in path]
    py = [p.y for p in path]
    fx = mo.follow(px, 1.0 / FPS, freq=0.9, zeta=0.45, periodic=spec.loop)
    fy = mo.follow(py, 1.0 / FPS, freq=0.9, zeta=0.45, periodic=spec.loop)
    lag = [(LAG_GAIN * (fx[i] - px[i]), -LAG_GAIN * (fy[i] - py[i])) for i in range(n + 1)]
    poses, trans = [], []
    for i in range(n + 1):
        pose, tr = frame(spec, i / FPS, lag=lag[i])
        mo.shoulder_helpers(pose)
        poses.append(pose)
        trans.append(tr)
    if spec.loop:
        poses[-1] = dict(poses[0])
        trans[-1] = trans[0].copy()
    m = dict(meta or {})
    m.setdefault("body", fam.body)
    m["seconds"] = round(T, 4)
    m["_swing"] = {S: spec.swinging(S) for S in "LR"}
    return mo.Clip(name, poses, trans, loop=spec.loop, meta=m, skel=fam.sk)


# ---------------------------------------------------------------- the families and their stances

# width: between the ankles' middles; toe: each foot turned out (degrees); fwdL/fwdR: a foot ahead (m); shift: the
# hips over the loaded foot (m); list: the free side of the pelvis drops (degrees); yaw: the pelvis turns the free
# hip forward; kLoad/kFree: the loaded and the relaxed knee (degrees); roll: the most a relaxed foot rises on its
# ball; lean: the trunk forward (- back); breathT/breath: a breath's length (s) and depth (degrees at the chest)
STANCES = {
    "man": dict(width=0.215, toe=9.0, fwdR=0.025, shift=0.034, list=3.2, yaw=2.4, kLoad=2.5, kFree=15.0, roll=11.0,
                lean=1.0, breathT=4.2, breath=1.0, keep=0.35, hipsFwd=0.004),
    "woman": dict(width=0.135, toe=13.0, fwdR=0.05, shift=0.030, list=3.8, yaw=3.2, kLoad=2.0, kFree=16.0, roll=13.0,
                  lean=-1.0, breathT=3.9, breath=1.0, keep=0.32, hipsFwd=0.010),
    "stout": dict(width=0.27, toe=14.0, fwdR=0.02, shift=0.028, list=2.2, yaw=1.8, kLoad=3.0, kFree=12.0, roll=8.0,
                  lean=-3.0, breathT=4.0, breath=1.2, keep=0.4, hipsFwd=-0.004),
    "wstout": dict(width=0.17, toe=14.0, fwdR=0.045, shift=0.028, list=3.0, yaw=2.6, kLoad=2.5, kFree=14.0,
                   roll=10.0, lean=-2.0, breathT=3.9, breath=1.1, keep=0.35, hipsFwd=0.006),
    "old": dict(width=0.235, toe=13.0, fwdR=0.02, shift=0.022, list=2.0, yaw=1.6, kLoad=9.0, kFree=14.0, roll=6.0,
                lean=2.0, breathT=4.6, breath=0.8, keep=0.5, lookDown=3.0, hipsFwd=-0.01),
    "oldw": dict(width=0.17, toe=12.0, fwdR=0.03, shift=0.022, list=2.4, yaw=2.0, kLoad=8.0, kFree=13.0, roll=7.0,
                 lean=1.0, breathT=4.4, breath=0.8, keep=0.45, lookDown=3.0, hipsFwd=-0.005),
    "child": dict(width=0.17, toe=6.0, fwdR=0.015, shift=0.03, list=3.0, yaw=2.6, kLoad=2.0, kFree=14.0, roll=11.0,
                  lean=0.0, breathT=3.0, breath=1.1, keep=0.3, hipsFwd=0.004),
}
# family -> (the body it is made on, the family it falls back on for a clip it does not have)
FAMILIES = {
    "man": ("man_middling", None),
    "woman": ("woman_middling", None),
    "stout": ("man_stout", "man"),
    "wstout": ("woman_stout", "woman"),
    "old": ("old_man", None),
    "oldw": ("old_woman", "old"),
    "child": ("child_middling", None),
}
# which family a body plays (the runtime does the same: People2Moves)
BODY_FAMILY = {"man_middling": "man", "man_slight": "man", "man_stout": "stout", "woman_middling": "woman",
               "woman_slight": "woman", "woman_stout": "wstout", "old_man": "old", "old_woman": "oldw",
               "child_middling": "child", "child_slight": "child"}
CLOTH = 0.03  # room for the clothes between a resting hand and the skin (the kinds' smocks, shawls, aprons)


def Yh(fam, frac):
    from . import body as bd
    return bd.Y(fam.P, frac)


def sgn(S):
    return 1 if S == "L" else -1


# ---------------------------------------------------------------- places on the body (rest, armature axes)


def spot_hip(fam, S, clear=CLOTH, frac=0.607):
    """The side of the waist over the hip bone (hands on the hips)."""
    o = Vector((0.0, 0.01, Yh(fam, frac)))
    return fam.skin(o, (sgn(S), 0.18, 0.0), clear)


def spot_front(fam, frac, x=0.0, clear=CLOTH, up=0.0):
    """The front of the trunk at a height (a share of the height), `x` to the side: cast from near the middle (a ray
    from the side of the chest would meet the hanging arm of the rest pose) and moved sideways after."""
    xc = max(-0.07 * fam.k, min(0.07 * fam.k, x))
    o = Vector((xc, 0.0, Yh(fam, frac)))
    return fam.skin(o, (0.0, -1.0, up), clear) + Vector((x - xc, 0.0, 0.0))


def spot_back(fam, frac, x=0.0, clear=CLOTH):
    o = Vector((x, 0.0, Yh(fam, frac)))
    return fam.skin(o, (0.0, 1.0, 0.0), clear)


def spot_pocket(fam, S, clear=-0.038):
    """The mouth of a trouser (or smock) pocket at the front of the hip: the hand goes in to the knuckles."""
    o = Vector((sgn(S) * 0.1 * fam.k, 0.0, Yh(fam, 0.515)))
    return fam.skin(o, (sgn(S) * 1.0, -1.0, 0.0), clear)


def spot_head(fam, where, S="R", clear=0.0):
    """On the head: 'nape' (the back of the head, low), 'crown', 'temple', 'chin', 'jaw' (the side of the jaw)."""
    sk = fam.sk
    sg = sgn(S)
    h = sk.rest["head"]
    top = Yh(fam, 0.94)
    if where == "nape":
        return fam.skin(Vector((sg * 0.02, h.y, top - 0.045 * fam.k)), (sg * 0.35, 1.0, -0.15), clear)
    if where == "crown":
        return fam.skin(Vector((sg * 0.01, h.y + 0.01, top)), (sg * 0.2, 0.55, 1.0), clear)
    if where == "temple":
        return fam.skin(Vector((0.0, h.y - 0.01, top)), (sg * 1.0, -0.25, 0.25), clear)
    if where == "chin":
        return fam.skin(Vector((0.0, h.y - 0.02, Yh(fam, 0.885))), (0.0, -1.0, -0.4), clear)
    if where == "jaw":
        return fam.skin(Vector((0.0, h.y, Yh(fam, 0.895))), (sg * 1.0, -0.6, -0.2), clear)
    raise KeyError(where)


# ---------------------------------------------------------------- arm poses used by many clips


def on_hips(knuckles=False):
    """A hand on the hip: the palm on the side of the waist, the fingers forward and down, the elbow out (or a
    loose fist with the knuckles on the hip)."""
    if knuckles:
        return Place(lambda fam, S, ctx=None: spot_hip(fam, S, clear=CLOTH + 0.012),
                     lambda fam, S, ctx=None: V(-sgn(S) * 0.85, 0.15, -0.5),
                     lambda fam, S, ctx=None: V(0.0, -1.0, 0.25),
                     lambda fam, S, ctx=None: V(sgn(S) * 1.0, -0.55, -0.1), shape="knuckle", bone="hips")
    return Place(lambda fam, S, ctx=None: spot_hip(fam, S),
                 lambda fam, S, ctx=None: V(-sgn(S) * 0.12, 1.0, -0.42),
                 lambda fam, S, ctx=None: V(-sgn(S), 0.0, -0.15),
                 lambda fam, S, ctx=None: V(sgn(S) * 1.0, -0.3, 0.05), shape="rest", bone="hips")


def in_pocket(hunch=3.0):
    """A hand deep in the trouser pocket, the shoulders up a little."""
    return Place(lambda fam, S, ctx=None: spot_pocket(fam, S),
                 lambda fam, S, ctx=None: V(-sgn(S) * 0.2, 0.3, -1.0),
                 lambda fam, S, ctx=None: V(-sgn(S) * 0.8, -0.55, 0.0),
                 lambda fam, S, ctx=None: V(sgn(S) * 1.0, -0.55, -0.1), shape="pocket", bone="hips",
                 clav=lambda fam, S, ctx=None: RY(-sgn(S) * hunch) @ RZ(-sgn(S) * 1.5))


def behind_back(holder="R"):
    """Hands behind the back at the small of it: one hand holds the other's wrist."""

    def at(fam, S, ctx=None):
        b = spot_back(fam, 0.565, 0.0, clear=CLOTH + 0.012)
        if S == holder:
            return b + Vector((sgn(S) * 0.035, 0.02, 0.01 * fam.k))
        return b + Vector((sgn(S) * 0.05, 0.0, -0.035 * fam.k))

    def fingers(fam, S, ctx=None):
        return V(-sgn(S) * 0.9, -0.15, -0.4) if S == holder else V(-sgn(S) * 0.45, -0.2, -1.0)

    def palm(fam, S, ctx=None):
        return V(0.0, 1.0, 0.0) if S == holder else V(0.0, -1.0, 0.0)

    def pole(fam, S, ctx=None):
        return V(sgn(S) * 1.0, -0.35, -0.3)

    return {S: Place(at, fingers, palm, pole, shape=("clasp" if S == holder else "relaxed"), bone="hips") for S in "LR"}


def folded(top="R"):
    """Arms folded over the chest: the lower forearm against the body, the upper one over it, each hand at the
    other arm (the lower hand tucked under the upper arm, the upper hand on the other's sleeve)."""

    def at(fam, S, ctx=None):
        # the wrists: the lower forearm against the body over the pit of the stomach, the upper one in front of it
        # (the elbows come forward of the body, so the forearms cross over the pit of the stomach, the upper one
        # stacked over the lower, and each hand reaches the other arm above its elbow)
        k = fam.k
        if S != top:
            return spot_front(fam, 0.645, 0.0, clear=CLOTH + 0.012 * k) + Vector((-sgn(S) * 0.08 * k, 0.0, 0.0))
        return spot_front(fam, 0.68, 0.0, clear=CLOTH + 0.065 * k) + Vector((-sgn(S) * 0.09 * k, 0.0, 0.0))

    def fingers(fam, S, ctx=None):
        # the lower hand tucks back under the other arm, the upper one lies over the other sleeve
        return V(-sgn(S) * 0.55, -0.78, 0.1) if S != top else V(-sgn(S) * 0.5, -0.8, -0.2)

    def palm(fam, S, ctx=None):
        return V(-sgn(S) * 0.3, -1.0, 0.0) if S != top else V(-sgn(S) * 0.5, -0.8, 0.2)

    def pole(fam, S, ctx=None):
        return V(sgn(S) * 0.5, 0.6, -1.0)

    return {S: Place(at, fingers, palm, pole, shape=("tuck" if S != top else "rest"), bone="chest", wrist=True)
            for S in "LR"}


def hands_front(low=False):
    """A woman's hands folded before her at the waist (the right over the left)."""

    def at(fam, S, ctx=None):
        p = spot_front(fam, 0.555 if low else 0.585, 0.0, clear=CLOTH + 0.03)
        return p + Vector((sgn(S) * 0.012, -0.012 if S == "R" else 0.0, (0.01 if S == "R" else -0.008)))

    def fingers(fam, S, ctx=None):
        return V(-sgn(S) * 0.85, 0.2, -0.5)

    def palm(fam, S, ctx=None):
        return V(0.0, -1.0, -0.15) if S == "L" else V(0.0, -1.0, 0.1)

    def pole(fam, S, ctx=None):
        return V(sgn(S) * 1.0, -0.2, -0.6)

    return {S: Place(at, fingers, palm, pole, shape="clasp" if S == "R" else "relaxed", bone="spine") for S in "LR"}


# ---------------------------------------------------------------- helpers for the recipes


def look(T, moves, seed=0, drift_deg=1.6, over=0.05):
    """The head's (yaw, pitch, tilt) over a loop: moves [(t, dur, yaw, pitch, tilt)] (each a place the head goes to
    and stays at), from and back to straight ahead, plus a small drift."""
    ys = Held(T, 0.0, [(t, d, y) for t, d, y, p, l in moves], over=over)
    ps = Held(T, 0.0, [(t, d, p) for t, d, y, p, l in moves])
    ls = Held(T, 0.0, [(t, d, l) for t, d, y, p, l in moves])
    dy, dp, dl = drift(T, seed, drift_deg), drift(T, seed + 1, drift_deg * 0.6), drift(T, seed + 2, drift_deg * 0.5)
    return lambda t: (ys(t) + dy(t), ps(t) + dp(t), ls(t) + dl(t))


def weights(T, moves):
    """The weight's share on the left foot over a loop, from and back to the middle."""
    return Held(T, 0.5, moves)


def still(**k):
    return {"L": Hang(**k), "R": Hang(**k)}


def track(T, keys, loop=True):
    return ArmTrack(keys, T, loop)


# ---------------------------------------------------------------- idles


def sc(moves, u):
    """Moves (t, dur, ...) for a loop u times as long as the one they were written for."""
    return [(m[0] * u, m[1] * min(1.0, u ** 0.5)) + tuple(m[2:]) for m in moves]


def idle_shift(fam, T=12.6, seed=1, arms=None, side_first="L", amp=1.0):
    """Weight shifts from foot to foot and a look round: the plainest idle."""
    sp = Spec(fam, T)
    u = T / 12.6
    a, b = (0.88, 0.12) if side_first == "L" else (0.12, 0.88)
    sp.weight = weights(T, sc([(0.8, 1.5, a), (5.4, 1.9, b), (10.4, 1.6, 0.5)], u))
    sp.look = look(T, sc([(2.2, 0.75, 26 * amp, 1.0, -2.0), (4.3, 0.85, 0.0, 0.0, 0.0), (7.6, 0.65, -17 * amp, 3.0, 1.5),
                          (9.3, 0.9, 0.0, 0.0, 0.0)], u), seed=seed)
    sp.fwd = drift(T, seed + 7, 0.006)
    sp.trunk = (lambda d: lambda t: (d(t), 0.0, 0.0))(drift(T, seed + 9, 0.8))
    sp.arms = arms or still()
    return sp


def idle_feet(fam, T=14.7, seed=2, scratch="nape", foot="L", arms=None):
    """The weight onto one foot, the other shifts out a little and turns, then back; a scratch at the head with
    the other hand while standing so."""
    sp = Spec(fam, T)
    u = T / 14.7
    S = foot
    O = "R" if S == "L" else "L"
    w_off = 0.1 if S == "L" else 0.9  # the weight off the stepping foot
    w_on = 0.62 if S == "L" else 0.38
    sp.weight = weights(T, sc([(0.6, 1.2, w_off), (3.2, 1.3, w_on), (9.0, 1.1, w_off), (11.8, 1.4, 0.5)], u))
    sp.steps[S] = [(2.15 * u, 2.15 * u + 0.6, (sgn(S) * 0.045 * fam.k, 0.03 * fam.k, sgn(S) * 7.0)),
                   (10.4 * u, 10.4 * u + 0.6, (0.0, 0.0, 0.0))]
    sp.look = look(T, sc([(1.6, 0.6, 4.0, 16.0, 0.0), (3.4, 0.8, 0.0, 2.0, 0.0), (5.0, 0.5, -6.0, 7.0, -5.0),
                          (7.6, 0.8, 9.0, 0.0, 2.0), (9.8, 0.5, 2.0, 14.0, 0.0), (11.4, 0.9, 0.0, 0.0, 0.0)], u), seed=seed)
    sp.trunk = lambda t: (2.0 * pulse(t, 5.0 * u, 7.6 * u, 0.6, 0.8), 0.0, 0.0)
    # the scratch: the free hand goes up to the head, the fingers work, it comes down
    hd = scratch_hand(fam, O, scratch, 5.05 * u, 7.55 * u)
    sp.arms = {S: Hang(), O: hd}
    return sp


def scratch_hand(fam, S, where, t0, t1, T=None):
    """An arm that goes from hanging up to `where` on the head at t0, scratches, and hangs again by t1."""
    up = Place(lambda f, S_, ctx=None: spot_head(f, where, S_, clear=0.012),
               lambda f, S_, ctx=None: V(-sgn(S_) * 0.35, 0.05 if where == "nape" else 0.3, 1.0),
               lambda f, S_, ctx=None: V(-sgn(S_) * 0.6, 0.8 if where == "nape" else -0.2, 0.0),
               lambda f, S_, ctx=None: V(sgn(S_) * 1.0, 0.9, 0.1), bone="head",
               shape=lambda f, S_, ctx: mix_shape(shape_of("scratch"), shape_of("rest"),
                                                  0.5 + 0.5 * math.sin(TAU * 4.2 * ctx["t"])),
               wob=lambda t, S_: V(0.0, 0.004 * math.sin(TAU * 4.2 * t), 0.006 * math.sin(TAU * 4.2 * t + 1.0)))
    return ArmTrack([(0.0, Hang(), 0.5), (t0, up, 0.75), (t1 - 0.95, Hang(), 0.95)], 1e9, loop=False)


def idle_hold(fam, arms, T=12.6, seed=3, lean_=0.0, shrug=0.0, look_amp=1.0, weight_hold=0.78):
    """A held arm pose (hips, fold, pockets, behind), the weight mostly on one leg, a look round."""
    sp = Spec(fam, T)
    u = T / 12.6
    sp.weight = weights(T, sc([(0.6, 1.4, weight_hold), (6.2, 1.8, 1 - weight_hold), (10.6, 1.5, 0.5)], u))
    sp.look = look(T, sc([(1.9, 0.7, -22 * look_amp, 2.0, 1.5), (3.9, 0.8, 0.0, 0.0, 0.0),
                          (7.9, 0.75, 30 * look_amp, -1.0, -2.0), (9.6, 0.9, 0.0, 0.0, 0.0)], u), seed=seed)
    sp.trunk = (lambda d: lambda t: (lean_ + d(t), 0.0, 0.0))(drift(T, seed + 9, 0.7))
    sp.fwd = drift(T, seed + 4, 0.005)
    sp.arms = arms
    return sp


def rub_back(fam, T=14.7, seed=63, S="R"):
    """The old rub the small of the back: a hand goes to it, rubs, the back straightens with a stretch, the hand
    comes back."""
    sp = idle_shift(fam, T=T, seed=seed, amp=0.6)
    t0, t1 = 3.2, 8.4

    def at(f, S_, ctx=None):
        return spot_back(f, 0.59, sgn(S_) * 0.055 * f.k, clear=CLOTH)

    rub = Place(at, lambda f, S_, ctx=None: V(-sgn(S_) * 0.7, -0.15, 0.5), lambda f, S_, ctx=None: V(0.0, 1.0, 0.0),
                lambda f, S_, ctx=None: V(sgn(S_) * 1.0, -0.5, -0.4), shape="rest", bone="spine",
                wob=lambda t, S_: V(0.012 * math.sin(TAU * 1.6 * t), 0.0, 0.016 * math.sin(TAU * 1.6 * t + 0.8)) *
                pulse(t, t0 + 0.6, t1 - 1.0, 0.3, 0.3))
    sp.arms = {S: ArmTrack([(0.0, Hang(), 0.3), (t0, rub, 0.8), (t1, Hang(), 1.0)], T),
               ("L" if S == "R" else "R"): Hang()}
    base = sp.trunk
    sp.trunk = lambda t: (base(t)[0] - 6.0 * pulse(t, t0 + 2.2, t0 + 3.8, 0.7, 0.9), base(t)[1], base(t)[2])
    return sp


def idle_rock(fam, arms, T=12.6, seed=4):
    """Hands behind the back, rocking a little from the heels to the balls and back, looking out."""
    sp = idle_hold(fam, arms, T, seed, lean_=-2.0, weight_hold=0.62)
    sp.fwd = lambda t: 0.012 * math.sin(TAU * 2 * t / T) * (0.5 + 0.5 * math.cos(TAU * t / T))
    sp.look = look(T, sc([(2.4, 1.0, 18.0, -3.0, 0.0), (5.2, 1.1, -12.0, -2.0, 1.0), (8.6, 1.2, 0.0, 0.0, 0.0)],
                         T / 12.6), seed=seed)
    return sp


# ---------------------------------------------------------------- talk


def G(side, fwd, up, sup=0.0, flex=0.0, dev=0.0, pole=(0.55, -0.15, -1.0), shape="beat", bone="upperChest"):
    """A hand put in the space before the body (gestures): the wrist `side` out from the shoulder (in toward the
    middle if negative), `fwd` ahead of it, `up` above it (metres for a 1.67 m body), carried by the upper chest;
    the hand turned against its forearm (hand_turn: supination, flexion, deviation), so a palm turns up or down as
    a wrist can; the elbow toward `pole` (the person's words, + side = out)."""

    def at(fam, S, ctx=None):
        k = fam.k
        return fam.sk.rest["armUp" + S] + V(sgn(S) * side * k, fwd * k, up * k)

    return Place(at, lambda fam, S, ctx=None: V(0.0, 1.0, 0.0), lambda fam, S, ctx=None: V(-sgn(S), 0.0, 0.0),
                 lambda fam, S, ctx=None: V(sgn(S) * pole[0], pole[1], pole[2]), shape=shape, bone=bone,
                 wrist=True, hand=(sup, flex, dev))


# the gestures' places (the right hand's words; mirrored for the left)
GP = {
    "offer": G(0.00, 0.28, -0.30, sup=72, flex=-12, shape="palm"),
    "offer_lo": G(0.02, 0.27, -0.36, sup=66, flex=-6, shape="palm"),
    "offer_out": G(0.13, 0.25, -0.31, sup=80, flex=-16, pole=(0.8, -0.2, -1.0), shape="palm"),
    "beat_hi": G(-0.03, 0.28, -0.24, sup=8, flex=8, shape="beat"),
    "beat_lo": G(-0.02, 0.29, -0.32, sup=0, flex=22, shape="beat"),
    "point_out": G(-0.05, 0.36, -0.18, sup=-25, flex=-4, shape="point"),
    "point_jab": G(-0.06, 0.43, -0.17, sup=-25, flex=6, shape="point"),
    "chop_hi": G(-0.03, 0.26, -0.10, sup=0, flex=0, dev=12, shape="open"),
    "chop_lo": G(-0.02, 0.32, -0.30, sup=0, flex=0, dev=-14, shape="open"),
    "open_out": G(0.19, 0.20, -0.34, sup=85, flex=-22, pole=(0.9, -0.3, -1.0), shape="palm"),
    "stop": G(0.02, 0.26, -0.03, sup=-85, flex=-50, shape="open"),
    "wave_in": G(-0.06, 0.22, -0.21, sup=-55, flex=28, shape="beat"),
    "wave_out": G(0.16, 0.29, -0.32, sup=-70, flex=-32, pole=(0.8, -0.2, -1.0), shape="open"),
    "fist_lo": G(-0.02, 0.30, -0.32, sup=0, flex=12, shape="fist"),
    "fist_hi": G(-0.03, 0.28, -0.23, sup=8, flex=4, shape="fist"),
    "count": G(-0.08, 0.27, -0.22, sup=30, flex=0, shape="point"),
}


def on_chest():
    """The palm on one's own chest ("I", "me"): the forearm comes up across the body from a low elbow, so the hand
    in its own forearm's line (no turn) lies with its palm on the chest."""
    return Place(lambda fam, S, ctx=None: spot_front(fam, 0.765, -sgn(S) * 0.03 * fam.k, clear=0.022),
                 lambda fam, S, ctx=None: V(-sgn(S) * 0.8, 0.0, 0.55),
                 lambda fam, S, ctx=None: V(0.0, -1.0, 0.0),
                 lambda fam, S, ctx=None: V(sgn(S) * 0.7, 0.1, -1.0), shape="rest", bone="upperChest",
                 hand=(40.0, -15.0, 5.0))


# a gesture: keys (seconds from its start, place, move time, overshoot); "_" is the arm's own rest for the talk
GESTURES = {
    "offer": [(0.0, "offer", 0.5, 0.06), (0.75, "offer_lo", 0.35, 0.0), (1.2, "offer", 0.4, 0.0)],
    "offer_out": [(0.0, "offer", 0.45, 0.05), (0.5, "offer_out", 0.45, 0.06)],
    "beat": [(0.0, "beat_hi", 0.4, 0.0), (0.5, "beat_lo", 0.2, 0.12), (0.85, "beat_hi", 0.3, 0.0),
             (1.25, "beat_lo", 0.2, 0.12)],
    "beat2": [(0.0, "beat_hi", 0.35, 0.0), (0.42, "beat_lo", 0.17, 0.14), (0.7, "beat_hi", 0.22, 0.0),
              (0.95, "beat_lo", 0.17, 0.14), (1.25, "beat_hi", 0.22, 0.0), (1.5, "beat_lo", 0.17, 0.14)],
    "point": [(0.0, "point_out", 0.4, 0.08), (0.62, "point_jab", 0.14, 0.18), (0.85, "point_out", 0.2, 0.0),
              (1.1, "point_jab", 0.14, 0.18), (1.32, "point_out", 0.2, 0.0)],
    "chop": [(0.0, "chop_hi", 0.38, 0.0), (0.48, "chop_lo", 0.15, 0.16), (0.85, "chop_hi", 0.3, 0.0),
             (1.25, "chop_lo", 0.15, 0.16)],
    "chest": [(0.0, "chest", 0.55, 0.04)],
    "open": [(0.0, "offer", 0.35, 0.0), (0.35, "open_out", 0.45, 0.07)],
    "stop": [(0.0, "stop", 0.45, 0.06)],
    "wave": [(0.0, "wave_in", 0.3, 0.0), (0.38, "wave_out", 0.32, 0.1)],
    "fist": [(0.0, "fist_hi", 0.35, 0.0), (0.45, "fist_lo", 0.16, 0.18), (0.8, "fist_hi", 0.3, 0.0),
             (1.2, "fist_lo", 0.16, 0.18)],
    "count": [(0.0, "count", 0.45, 0.04)],
}


def gesture_spec(name):
    return on_chest() if name == "chest" else GP[name]


def speech(phrases, seed, amp=6.0, rate=(0.13, 0.25)):
    """The jaw while speaking: syllables (open and close, each its own size) inside each phrase (t0, t1)."""
    r = random.Random(seed)
    syl = []
    for a, b in phrases:
        t = a + 0.04
        while t < b - 0.1:
            d = r.uniform(*rate)
            syl.append((t + d / 2, amp * r.uniform(0.35, 1.0) * (1.25 if r.random() < 0.2 else 1.0), d))
            t += d + (r.uniform(0.05, 0.16) if r.random() < 0.15 else 0.0)

    def jaw(t):
        v = 0.6
        for c, A, d in syl:
            u = (t - c) / (0.6 * d)
            if -1.0 < u < 1.0:
                v = max(v, 0.6 + A * (1 - u * u) ** 2)
        return v

    return jaw


class Talk:
    """A speaking clip: phrases [(t0, t1, gesture, side)] (side "R", "L" or "LR"; gesture None for a phrase without
    one); the arms rest at `rest` ({S: spec}) between gestures; the jaw speaks each phrase; the head leads each
    gesture's stroke (a small nod and tilt just before it) and glances aside now and then."""

    def __init__(self, fam, T, phrases, rest, seed, lean_=0.0, head_amp=1.0, glances=(), weight_moves=None,
                 jaw_amp=6.0, back_dur=0.6):
        self.fam, self.T, self.phrases, self.rest, self.seed = fam, T, phrases, rest, seed
        self.lean, self.head_amp, self.glances, self.jaw_amp, self.back_dur = lean_, head_amp, glances, jaw_amp, back_dur
        self.weight_moves = weight_moves

    def spec(self):
        fam, T = self.fam, self.T
        sp = Spec(fam, T)
        sp.weight = weights(T, self.weight_moves or [(1.2, 1.6, 0.7), (6.0, 1.8, 0.35), (T - 1.9, 1.5, 0.5)])
        tracks = {S: [(0.0, self.rest[S], 0.3)] for S in "LR"}
        strokes = []
        # every arm is back at rest (the hand and fingers too) a little before the loop closes
        self.phrases = [(t0, min(t1, T - self.back_dur - 0.25), g, side) for t0, t1, g, side in self.phrases]
        for t0, t1, g, side in self.phrases:
            if not g:
                continue
            for S in ("L", "R") if side == "LR" else (side,):
                for dt, place, dur, over in GESTURES[g]:
                    tracks[S].append((t0 + dt, gesture_spec(place), dur, over))
                    if over > 0.05:
                        strokes.append((t0 + dt + dur * 0.6, S))
                tracks[S].append((t1, self.rest[S], self.back_dur))
            strokes.append((t0 + GESTURES[g][0][2] * 0.6, side[0]))
        sp.arms = {S: ArmTrack(tracks[S], T) for S in "LR"}
        sp.jaw = speech([(a, b) for a, b, _, _ in self.phrases], self.seed, self.jaw_amp)
        r = random.Random(self.seed + 5)
        A = self.head_amp
        nod = [(ts - 0.13, r.uniform(2.5, 4.5) * A, sgn(S) * r.uniform(-1.0, 3.0) * A) for ts, S in strokes]
        base = look(T, list(self.glances), seed=self.seed, drift_deg=2.0 * A)

        def head(t):
            y, p, l = base(t)
            for tn, a, tilt in nod:
                u = (t - tn) / 0.42
                if 0 < u < 1:
                    e = math.sin(math.pi * u) ** 2
                    p += a * e
                    l += tilt * e
                for tn2 in (tn + T, tn - T):
                    u = (t - tn2) / 0.42
                    if 0 < u < 1:
                        e = math.sin(math.pi * u) ** 2
                        p += a * e
                        l += tilt * e
            return y, p, l

        sp.look = head
        lean_ = self.lean
        dr = drift(T, self.seed + 8, 1.0)
        sp.trunk = lambda t: (lean_ + dr(t), 0.0, 0.0)
        sp.fwd = drift(T, self.seed + 3, 0.006)
        return sp


def listen(fam, T, seed, rest, nod_at=(2.0, 6.4, 10.2), lean_=0.0, tilt=4.0, glances=None):
    """Listening: the weight shifts now and then, small nods, the head tilted a little, the arms at rest."""
    sp = Spec(fam, T)
    u = T / 12.6
    sp.weight = weights(T, sc([(1.5, 1.8, 0.72), (6.8, 2.0, 0.3), (10.4, 1.8, 0.5)], u))
    gl = glances if glances is not None else sc([(3.6, 0.7, -9.0, 2.0, tilt), (5.6, 0.8, 0.0, 0.0, tilt * 0.6),
                                                (8.4, 0.6, 6.0, -1.0, -tilt * 0.5), (11.0, 0.9, 0.0, 0.0, 0.0)], u)
    base = look(T, gl, seed=seed, drift_deg=1.4)
    r = random.Random(seed)
    nod_list = [(t, r.choice((2, 2, 3)), r.uniform(4.5, 7.0)) for t in nod_at]
    sp.look = lambda t: (base(t)[0], base(t)[1] + sum(nods(t, a, n, amp) for a, n, amp in nod_list), base(t)[2])
    dr = drift(T, seed + 2, 0.8)
    sp.trunk = lambda t: (lean_ + dr(t), 0.0, 0.0)
    sp.arms = rest
    sp.fwd = drift(T, seed + 3, 0.005)
    return sp


def laugh(fam, T, seed, rest, at=0.8, dur=2.4, hand=None):
    """A laugh: the head goes back, the shoulders shake with it, then the body bends forward a little and settles
    (a hand to the belly or the chest for the merry ones)."""
    sp = Spec(fam, T)
    sp.weight = weights(T, [(0.4, 1.2, 0.62), (T - 1.6, 1.4, 0.5)])

    def env(t):
        return pulse(t, at, at + dur, 0.3, 0.9)

    def shake(t):
        return env(t) * (0.5 + 0.5 * math.sin(TAU * 4.6 * (t - at)))

    def head(t):
        e = env(t)
        back = -10.0 * pulse(t, at, at + dur * 0.55, 0.25, 0.6) + 7.0 * pulse(t, at + dur * 0.5, at + dur + 0.6, 0.5, 0.8)
        return (3.0 * e, back + 2.0 * shake(t), 3.0 * e)

    sp.look = head
    sp.keep = 0.6
    sp.trunk = lambda t: (-3.0 * pulse(t, at, at + dur * 0.5, 0.25, 0.5) + 6.0 * pulse(t, at + dur * 0.45, at + dur + 0.7,
                                                                                          0.5, 0.8) + 1.0 * shake(t),
                          0.0, 0.0)
    sp.jaw = lambda t: 0.6 + 9.0 * env(t) * (0.55 + 0.45 * math.sin(TAU * 4.6 * (t - at) + 0.4))
    sp.dz = lambda t: -0.006 * pulse(t, at + dur * 0.4, at + dur + 0.5, 0.4, 0.7)
    arms = dict(rest)
    if hand:
        S = hand
        arms[S] = ArmTrack([(0.0, rest[S], 0.3), (at + 0.35, Place(
            lambda fam, S_, ctx=None: spot_front(fam, 0.6, -sgn(S_) * 0.03 * fam.k, clear=CLOTH + 0.015),
            lambda fam, S_, ctx=None: V(-sgn(S_) * 0.9, 0.0, 0.2), lambda fam, S_, ctx=None: V(0.0, -1.0, 0.0),
            lambda fam, S_, ctx=None: V(sgn(S_) * 1.0, -0.2, -1.0), shape="rest", bone="spine",
            hand=(-10.0, -8.0, 4.0)), 0.55),
            (at + dur + 0.2, rest[S], 0.8)], T)
    sp.arms = arms
    return sp


def shrug(fam, T, seed, rest, at=0.6):
    """A shrug: the shoulders come up, the hands turn out palms up, the head tilts and the brows (the head) go
    up; then everything comes down again."""
    sp = Spec(fam, T)
    sp.weight = weights(T, [(0.3, 0.9, 0.58), (T - 1.1, 0.9, 0.5)])
    up_t, down_t = at + 0.45, at + 1.55

    def e(t):
        return pulse(t, at, down_t + 0.5, 0.45, 0.6)

    sp.look = lambda t: (0.0, -4.0 * e(t), 7.0 * e(t))
    sp.trunk = lambda t: (-1.5 * e(t), 0.0, 0.0)
    palms = {S: G(0.16, 0.18, -0.50, sup=88, flex=-25, pole=(0.7, -0.4, -1.0), shape="palm") for S in "LR"}
    lift = 11.0

    arms = {}
    for S in "LR":
        p = Place(palms[S].at, palms[S].fingers, palms[S].palm, palms[S].pole, shape="palm", bone="upperChest",
                  clav=(lambda S_: (lambda fam, S2, ctx=None: RY(-sgn(S2) * lift * e(ctx["t"]))))(S), wrist=True,
                  hand=palms[S].hand)
        arms[S] = ArmTrack([(0.0, rest[S], 0.3), (at, p, 0.5, 0.08), (down_t, rest[S], 0.7)], T)
    sp.arms = arms
    sp.jaw = lambda t: 0.6 + 2.0 * pulse(t, up_t, down_t, 0.2, 0.3)
    return sp


def point_way(fam, T, seed, rest, S="R", yaw_deg=-58.0):
    """Pointing the way: the head turns first, the chest follows, the arm comes up and points along the street,
    holds, a second smaller point ("then left there"), explains with a hand, and all comes back."""
    sp = Spec(fam, T)
    sg = sgn(S)
    sp.weight = weights(T, [(0.6, 1.0, 0.5 + 0.18 * sg), (T - 1.5, 1.2, 0.5)])
    t_look, t_arm, t_two, t_back = 0.6, 0.95, 3.3, 5.0
    sp.look = look(T, [(t_look, 0.55, yaw_deg, -2.0, 0.0), (t_two - 0.2, 0.45, yaw_deg - 14 * sg, 1.0, 0.0),
                       (t_back - 0.6, 0.6, -8.0 * sg, 1.0, 0.0), (t_back + 1.0, 0.8, 0.0, 0.0, 0.0)], seed=seed)
    sp.lead = 0.32
    sp.lead_lag = 0.25

    def target(yaw_, up):
        a = math.radians(yaw_)
        fwd, side = math.cos(a), math.sin(a)  # yaw + to the person's left

        def at(fam, S_, ctx=None):
            k = fam.k
            return fam.sk.rest["armUp" + S_] + V(side * 0.5 * k, fwd * 0.5 * k, up * k)

        return Place(at, lambda fam, S_, ctx=None: V(side, fwd, 0.12), lambda fam, S_, ctx=None: V(0.0, 0.0, -1.0),
                     lambda fam, S_, ctx=None: V(sg * 0.6, -0.4, -1.0), shape="point", bone="upperChest")

    p1 = target(yaw_deg * 0.62, -0.02)
    p1b = target(yaw_deg * 0.62, 0.02)
    p2 = target(yaw_deg * 0.62 - 12.0 * sg, -0.06)
    O = "L" if S == "R" else "R"
    sp.arms = {S: ArmTrack([(0.0, rest[S], 0.3), (t_arm, p1, 0.6, 0.06), (t_arm + 0.9, p1b, 0.5), (t_two, p2, 0.45, 0.08),
                            (t_back, GP["offer"] if S == "R" else GP["offer"], 0.6), (t_back + 1.1, rest[S], 0.7)], T),
               O: ArmTrack([(0.0, rest[O], 0.3), (t_back + 0.2, GP["offer"], 0.55), (t_back + 1.3, rest[O], 0.7)], T)}
    sp.jaw = speech([(t_arm + 0.2, t_arm + 1.6), (t_two, t_two + 1.2), (t_back, t_back + 1.3)], seed)
    return sp


# ---------------------------------------------------------------- sitting

# the seats (the game passes a seat's height; the runtime picks a variant by it and by the person)
SEATS = {"bench": 0.45, "chair": 0.46, "crate": 0.40, "step": 0.20}


def thigh_back(fam, S="L"):
    """How far the back of the thigh lies behind the bone at mid-thigh (the near copy at rest)."""
    sk = fam.sk
    a, b = sk.rest["legUp" + S], sk.rest["legLow" + S]
    mid = a.lerp(b, 0.42)
    hit = fam.skin(mid, (0.0, 1.0, 0.0), 0.0)
    return (hit - mid).length


def sit_height(fam, seat, cloth=0.012):
    """The hips bone's height when the body sits on a seat `seat` high: the thighs' backs on it (with the cloth)."""
    sk = fam.sk
    return seat + (sk.rest["hips"].z - sk.rest["legUpL"].z) + thigh_back(fam) + cloth


def _thigh_top(ps, S, along, k, clear):
    a, b = ps.P["legUp" + S], ps.P["legLow" + S]
    return a.lerp(b, along) + Vector((0.0, 0.0, 0.085 * k + clear))


def on_thigh(along=0.55, clear=0.02):
    """A hand resting on the top of its own thigh, `along` from the hip to the knee, the fingers toward the knee."""
    return Place(lambda fam, S, ctx: _thigh_top(ctx["posed"], S, along, fam.k, clear),
                 lambda fam, S, ctx=None: V(-sgn(S) * 0.12, 1.0, -0.25), lambda fam, S, ctx=None: V(0.0, 0.1, -1.0),
                 lambda fam, S, ctx=None: V(sgn(S) * 1.0, -0.6, 0.0), shape="rest", bone=None)


def lap(along=0.42, clear=0.02):
    """Hands folded in the lap (the right over the left), on the thighs near the hips."""

    def at(fam, S, ctx):
        ps = ctx["posed"]
        m = (_thigh_top(ps, "L", along, fam.k, CLOTH + clear) + _thigh_top(ps, "R", along, fam.k, CLOTH + clear)) / 2
        return m + Vector((sgn(S) * 0.03 * fam.k, -0.01 if S == "R" else 0.0, 0.012 if S == "R" else 0.0))

    # the left hand palm up, the right one laid over it (each turned against its own forearm, as a wrist can)
    return {S: Place(at, lambda fam, S_, ctx=None: V(-sgn(S_) * 0.9, 0.35, -0.15),
                     lambda fam, S_, ctx=None: V(0.0, 0.25, -1.0),
                     lambda fam, S_, ctx=None: V(sgn(S_) * 1.0, -0.5, 0.0),
                     shape="clasp" if S == "R" else "cup", bone=None,
                     hand=(55.0, 8.0, -10.0) if S == "L" else (-70.0, 14.0, 12.0)) for S in "LR"}


def between_knees(drop=0.05, fwd=0.0):
    """Forearms on the thighs, the hands hanging loosely clasped between the knees."""

    def at(fam, S, ctx):
        ps = ctx["posed"]
        m = (ps.P["legLowL"] + ps.P["legLowR"]) / 2
        return m + Vector((sgn(S) * 0.03 * fam.k, -fwd * fam.k, -drop * fam.k))

    return {S: Place(at, lambda fam, S_, ctx=None: V(-sgn(S_) * 0.35, 0.45, -1.0),
                     lambda fam, S_, ctx=None: V(-sgn(S_) * 1.0, 0.0, 0.0),
                     lambda fam, S_, ctx=None: V(sgn(S_) * 1.0, -0.4, -0.3),
                     shape="clasp" if S == "R" else "relaxed", bone=None) for S in "LR"}


def on_knees(over=0.06):
    """The forearms over the knees, the hands hanging in front of the shins."""

    def at(fam, S, ctx):
        ps = ctx["posed"]
        return ps.P["legLow" + S] + Vector((-sgn(S) * 0.02 * fam.k, -over * fam.k, 0.03 * fam.k))

    return {S: Place(at, lambda fam, S_, ctx=None: V(-sgn(S_) * 0.25, 0.5, -1.0),
                     lambda fam, S_, ctx=None: V(-sgn(S_) * 0.6, -1.0, 0.0),
                     lambda fam, S_, ctx=None: V(sgn(S_) * 0.8, -0.2, -0.6), shape="relaxed", bone=None)
            for S in "LR"}


def sit(fam, kind, T=12.6, seed=101, arms=None, lean_=0.0, tilt=-10.0, feet=None, knees_out=0.35, look_amp=1.0,
        dangle=False, feet_swing=0.0):
    """Sitting on a seat (SEATS[kind]): the pelvis on it (tilted back), the feet planted (or, for a child on a
    bench, hanging and swinging a little), the trunk leaning by `lean_`, breathing, the weight shifting from one
    buttock to the other, a look round."""
    sp = Spec(fam, T)
    k = fam.k
    h = SEATS[kind]
    H = sit_height(fam, h)
    sp.seat = dict(H=H, hips=(0.0, 0.0), pole={S: V(sgn(S) * knees_out, 1.0, 0.25) for S in "LR"})
    fp = feet or {"L": (0.15, 0.40, 8.0), "R": (-0.15, 0.40, -8.0)}
    sk = fam.sk

    def feet_at(t):
        out = {}
        for S in "LR":
            x, f, yw = fp[S]
            flat = cm.stance_flat(sk, S, f * k, x * k, lambda p: 0.0, 0.0, yw)
            d = {"flat": flat, "yaw": yw, "roll_min": 0.0, "swing": False}
            if dangle:
                # the feet do not reach the floor: the shins hang from the knees and swing a little (no stance)
                sw = feet_swing * math.sin(TAU * t / T * 3 + (0.0 if S == "L" else 1.7))
                L1, L2 = sk.L["thigh" + S], sk.L["shin" + S]
                hz = H - (sk.rest["hips"].z - sk.rest["legUp" + S].z)
                a = math.radians(14.0 * sw)
                ank = Vector((x * k, -(0.96 * L1 + L2 * math.sin(a)), hz - L2 * math.cos(a) + 0.01))
                d = {"flat": flat, "yaw": yw, "roll_min": 0.0, "swing": True,
                     "ankle": ank, "rot": cm.foot_rot(yw, 0.0, 22.0 + 14.0 * sw), "toe": Quaternion()}
            out[S] = d
        return out

    sp.feet_at = feet_at
    sp.weight = weights(T, sc([(1.2, 2.0, 0.62), (6.6, 2.2, 0.4), (10.6, 1.6, 0.5)], T / 12.6))
    w = sp.weight
    sp.hips = lambda t: (0.0, tilt, 2.0 * (w(t) - 0.5) * 2.0)
    dr = drift(T, seed + 2, 1.0)
    sp.trunk = lambda t: (lean_ + dr(t), -1.5 * (w(t) - 0.5) * 2.0, 0.0)
    sp.look = look(T, sc([(2.0, 0.7, 24 * look_amp, 1.0, -2.0), (4.2, 0.8, 0.0, 0.0, 0.0),
                          (7.4, 0.65, -18 * look_amp, 3.0, 1.5), (9.2, 0.9, 0.0, 0.0, 0.0)], T / 12.6), seed=seed)
    sp.keep = 0.3
    sp.arms = arms or {S: on_thigh() for S in "LR"}
    sp.meta = {"seat": h, "seatKind": kind, "seatEdge": round(0.26 * k, 3), "sitHips": round(H, 4)}
    if dangle:
        sp.meta["dangle"] = True
    return sp


def sit_change(fam, stand, seated, name, down=True, T=1.75):
    """Sitting down from the family's stance (stand: a standing Clip, its frame 0) onto the seat of `seated` (its
    frame 0), or getting up (down=False). The feet step to (or from) where they stand when seated, the hips come
    down (or up) with the trunk leaning forward over the feet to keep the balance, the arms go over by turns."""
    sk = fam.sk
    A, B = (stand, seated) if down else (seated, stand)
    pa, ta = A.poses[0], A.trans[0]
    pb, tb = B.poses[0], B.trans[0]
    psa, psb = sk.fk(pa, ta), sk.fk(pb, tb)
    n = int(round(T * FPS))
    T = n / FPS
    order = ("R", "L")
    if down:
        steps = {order[0]: (0.12, 0.42), order[1]: (0.36, 0.66)}
    else:
        steps = {order[0]: (0.10, 0.36), order[1]: (0.28, 0.52)}
    upper = [b for b in KEYED if not b.startswith(("legUp", "legLow", "foot", "toe", "hips"))]
    poses, trans = [], []
    poleA = {S: V(sgn(S) * 0.1, 1.0, 0.0) for S in "LR"}
    poleB = {S: V(sgn(S) * 0.35, 1.0, 0.25) for S in "LR"}
    if not down:
        poleA, poleB = poleB, poleA
    for i in range(n + 1):
        u = i / n
        t = u * T
        # the hips: down late and soft (sitting) or forward and up after the lean (getting up)
        if down:
            e = smootherstep((u - 0.18) / 0.72)
        else:
            e = smootherstep((u - 0.28) / 0.6)
        tr = ta.lerp(tb, e)
        lean_bump = 26.0 * math.sin(math.pi * clamp((u - 0.05) / 0.85)) ** 1.5
        fwd_bump = 0.05 * fam.k * math.sin(math.pi * clamp((u - 0.15) / 0.75))
        tr = tr + Vector((0.0, -fwd_bump, 0.0))
        qh = pa["hips"].slerp(pb["hips"], e) if pa["hips"].dot(pb["hips"]) >= 0 else pa["hips"].slerp(-pb["hips"], e)
        pose = {"hips": bow(0.35 * lean_bump) @ qh}
        ps = sk.fk(pose, tr)
        for S in "LR":
            s0, s1 = steps[S]
            a0, r0 = psa.P["foot" + S], psa.D["foot" + S]
            a1, r1 = psb.P["foot" + S], psb.D["foot" + S]
            v = clamp((u - s0) / (s1 - s0))
            ev = smootherstep(v)
            ank = a0.lerp(a1, ev) + Vector((0.0, 0.0, 0.045 * fam.k * math.sin(math.pi * v) ** 2))
            rot = r0.slerp(r1, ev) if r0.dot(r1) >= 0 else r0.slerp(-r1, ev)
            if 0 < v < 1:
                rot = Quaternion(rot @ Vector((1, 0, 0)), math.radians(-6.0 * math.sin(math.pi * v) ** 2)) @ rot
            pole = poleA[S].lerp(poleB[S], smootherstep(u))
            sk.leg(pose, S, ank, rot, pole, toe=Quaternion(), posed=ps)
        # the upper body goes over by turns (the chest first, the arms after), leaning forward over the feet
        wu = smootherstep((u - 0.1) / 0.75)
        wa = smootherstep((u - 0.2) / 0.7)
        for bn in upper:
            qa, qb = pa.get(bn, Quaternion()), pb.get(bn, Quaternion())
            if qa.dot(qb) < 0:
                qb = -qb
            w = wa if bn[:-1] in ("clavicle", "armUp", "armLow", "armTwist", "hand") or bn[:-2] in (
                "index", "middle", "ring", "thumb") else wu
            pose[bn] = qa.slerp(qb, w)
        pose["spine"] = bow(0.45 * lean_bump) @ pose["spine"]
        pose["chest"] = bow(0.25 * lean_bump) @ pose["chest"]
        pose["neck"] = bow(-0.35 * lean_bump) @ pose["neck"]
        pose["head"] = bow(-0.25 * lean_bump) @ pose["head"]
        mo.shoulder_helpers(pose)
        poses.append(pose)
        trans.append(tr)

    def sw(S):
        s0, s1 = steps[S]
        return lambda t: s0 < t / T < s1

    m = {"body": fam.body, "seconds": round(T, 4), "_swing": {S: sw(S) for S in "LR"},
         "seat": seated.meta.get("seat"), "seatKind": seated.meta.get("seatKind"), "seatEdge": seated.meta.get("seatEdge")}
    c = mo.Clip(name, poses, trans, loop=False, meta=m, skel=sk)
    # exact hand-overs at both ends
    mo.ease_into(c, B, 0, 4)
    mo.ease_from(c, A, 0, 3)
    return c


# ---------------------------------------------------------------- the set


def both(spec):
    return {"L": spec, "R": spec}


def recipes():
    """Every D2 clip: (name, family, maker(fam) -> Spec, meta). meta role: what motion it serves (idle, fold,
    behind, pockets, talk_calm, talk_eager, talk_cross, listen, laugh, shrug, point, sit_*)."""
    R = []

    def add(name, fam, fn, **meta):
        R.append((name, fam, fn, meta))

    hangs = still
    front = hands_front

    def hips_m():
        return both(on_hips())

    def hips_k():
        return both(on_hips(knuckles=True))

    def pockets():
        return both(in_pocket())

    # ---- men
    add("man_idle_shift", "man", lambda f: idle_shift(f, seed=11), role="idle")
    add("man_idle_feet", "man", lambda f: idle_feet(f, seed=12), role="idle", focus="head")
    add("man_idle_hips", "man", lambda f: idle_hold(f, hips_m(), seed=13), role="idle")
    add("man_idle_loose", "man", lambda f: idle_hold(f, hangs(), seed=15, look_amp=0.7), role="idle")
    add("man_idle_fold", "man", lambda f: idle_hold(f, folded(), seed=16), role="idle")
    add("man_idle_back", "man", lambda f: idle_rock(f, behind_back(), seed=17), role="idle")
    add("man_idle_pocket", "man", lambda f: idle_hold(f, {"L": pockets()["L"], "R": Hang(out=10)}, seed=18), role="idle")
    add("man_idle_onehip", "man", lambda f: idle_hold(f, {"L": Hang(out=10), "R": hips_m()["R"]}, seed=19), role="idle")
    add("man_idle_behind", "man", lambda f: idle_rock(f, behind_back(), seed=14), role="behind")
    add("man_fold", "man", lambda f: idle_hold(f, folded(), seed=15), role="fold")
    add("man_pockets", "man", lambda f: idle_hold(f, pockets(), seed=16, lean_=1.0), role="pockets")
    add("man_talk_calm", "man", lambda f: Talk(
        f, 12.6, [(0.5, 2.6, "offer", "R"), (3.1, 4.9, "beat", "R"), (5.4, 6.4, None, "R"),
                  (7.0, 9.2, "offer_out", "R"), (9.8, 11.6, "chest", "R")], hangs(), 21,
        glances=[(5.4, 0.5, 13.0, -3.0, 0.0), (6.5, 0.6, 0.0, 0.0, 0.0)]).spec(), role="talk_calm")
    add("man_talk_eager", "man", lambda f: Talk(
        f, 10.5, [(0.3, 1.9, "open", "LR"), (2.3, 3.9, "beat2", "R"), (4.3, 5.8, "offer", "L"),
                  (6.2, 8.0, "chest", "R"), (8.3, 9.9, "offer_out", "R")], hangs(), 22, lean_=3.0, head_amp=1.5,
        weight_moves=[(0.8, 1.2, 0.68), (4.2, 1.3, 0.34), (8.6, 1.3, 0.5)]).spec(), role="talk_eager")
    add("man_talk_cross", "man", lambda f: Talk(
        f, 10.5, [(0.3, 1.8, "point", "R"), (2.3, 4.0, "chop", "R"), (4.5, 5.6, None, "R"), (6.0, 7.6, "wave", "R"),
                  (8.0, 9.9, "fist", "R")], {"L": on_hips(), "R": Hang()}, 23, lean_=2.5, head_amp=1.3,
        glances=[(4.5, 0.22, -9.0, 1.0, 0.0), (4.74, 0.24, 8.0, 1.0, 0.0), (5.0, 0.24, -6.0, 1.0, 0.0),
                 (5.26, 0.3, 0.0, 0.0, 0.0)], jaw_amp=7.0).spec(), role="talk_cross")
    add("man_listen", "man", lambda f: listen(f, 12.6, 24, hangs()), role="listen")
    add("man_listen_fold", "man", lambda f: listen(f, 12.6, 28, folded(), lean_=-1.0), role="listen")
    add("man_laugh", "man", lambda f: laugh(f, 4.8, 25, hangs(), hand="R"), role="laugh")
    add("man_shrug", "man", lambda f: shrug(f, 3.6, 26, hangs()), role="shrug")
    add("man_point", "man", lambda f: point_way(f, 7.2, 27, hangs()), role="point")
    # ---- women: the hands folded before her, a narrower stance, smaller gestures
    add("woman_idle_shift", "woman", lambda f: idle_shift(f, seed=31, arms=front(), amp=0.8), role="idle")
    add("woman_idle_feet", "woman", lambda f: idle_feet(f, seed=32, scratch="nape", foot="L"), role="idle",
        focus="head")
    add("woman_idle_hips", "woman", lambda f: idle_hold(f, hips_k(), seed=33, weight_hold=0.8), role="idle")
    add("woman_idle_loose", "woman", lambda f: idle_hold(f, hangs(), seed=37, look_amp=0.7), role="idle")
    add("woman_idle_fold", "woman", lambda f: idle_hold(f, folded(), seed=38), role="idle")
    add("woman_idle_back", "woman", lambda f: idle_rock(f, behind_back(), seed=39), role="idle")
    add("woman_idle_low", "woman", lambda f: idle_hold(f, front(low=True), seed=40), role="idle")
    add("woman_idle_onehip", "woman", lambda f: idle_hold(f, {"L": Hang(out=10), "R": hips_k()["R"]}, seed=49), role="idle")
    add("woman_fold", "woman", lambda f: idle_hold(f, folded(), seed=34, lean_=-1.0), role="fold")
    add("woman_behind", "woman", lambda f: idle_rock(f, behind_back(), seed=35), role="behind")
    add("woman_pockets", "woman", lambda f: idle_hold(f, front(low=True), seed=36, look_amp=0.7), role="pockets")
    add("woman_talk_calm", "woman", lambda f: Talk(
        f, 12.6, [(0.5, 2.4, "offer", "R"), (3.0, 4.6, None, "R"), (5.2, 7.2, "offer_out", "R"),
                  (7.8, 9.6, "chest", "R"), (10.2, 11.6, None, "R")], front(), 41, head_amp=1.1,
        glances=[(3.2, 0.5, -11.0, -2.0, 3.0), (4.4, 0.6, 0.0, 0.0, 0.0)]).spec(), role="talk_calm")
    add("woman_talk_eager", "woman", lambda f: Talk(
        f, 10.5, [(0.3, 1.9, "open", "LR"), (2.4, 3.8, "beat", "R"), (4.3, 5.9, "chest", "R"), (6.3, 7.9, "offer", "L"),
                  (8.3, 9.9, "beat2", "R")], front(), 42, lean_=2.5, head_amp=1.6).spec(), role="talk_eager")
    add("woman_talk_cross", "woman", lambda f: Talk(
        f, 10.5, [(0.4, 2.0, "point", "R"), (2.6, 4.2, "beat2", "R"), (4.8, 5.8, None, "R"), (6.2, 7.8, "wave", "R"),
                  (8.2, 9.9, "point", "R")], hips_k(), 43, lean_=2.0, head_amp=1.4,
        glances=[(4.8, 0.22, 9.0, 1.0, 0.0), (5.04, 0.24, -8.0, 1.0, 0.0), (5.3, 0.24, 6.0, 1.0, 0.0),
                 (5.56, 0.3, 0.0, 0.0, 0.0)], jaw_amp=7.0).spec(), role="talk_cross")
    add("woman_listen", "woman", lambda f: listen(f, 12.6, 44, front(), tilt=6.0), role="listen")
    add("woman_listen_fold", "woman", lambda f: listen(f, 12.6, 48, folded(), tilt=5.0, lean_=-1.0), role="listen")
    add("woman_laugh", "woman", lambda f: laugh(f, 4.8, 45, front(), hand="R"), role="laugh")
    add("woman_shrug", "woman", lambda f: shrug(f, 3.6, 46, front()), role="shrug")
    add("woman_point", "woman", lambda f: point_way(f, 7.2, 47, front()), role="point")
    # ---- the stout bodies: their own versions where a hand rests on the body (the belly is bigger)
    add("stout_idle_hips", "stout", lambda f: idle_hold(f, hips_m(), seed=51), role="idle")
    add("stout_idle_shift", "stout", lambda f: idle_shift(f, seed=57), role="idle")
    add("stout_idle_loose", "stout", lambda f: idle_hold(f, hangs(), seed=58), role="idle")
    add("stout_idle_back", "stout", lambda f: idle_rock(f, behind_back(), seed=59), role="idle")
    add("stout_idle_fold", "stout", lambda f: idle_hold(f, folded(), seed=60), role="idle")
    add("stout_fold", "stout", lambda f: idle_hold(f, folded(), seed=52, lean_=-1.0), role="fold")
    add("stout_pockets", "stout", lambda f: idle_hold(f, pockets(), seed=53), role="pockets")
    add("wstout_idle_hips", "wstout", lambda f: idle_hold(f, hips_k(), seed=54, weight_hold=0.8), role="idle")
    add("wstout_fold", "wstout", lambda f: idle_hold(f, folded(), seed=55, lean_=-1.0), role="fold")
    add("wstout_idle_shift", "wstout", lambda f: idle_shift(f, seed=56, arms=front(), amp=0.8), role="idle")
    add("wstout_idle_loose", "wstout", lambda f: idle_hold(f, hangs(), seed=91), role="idle")
    add("wstout_idle_back", "wstout", lambda f: idle_rock(f, behind_back(), seed=92), role="idle")
    add("wstout_idle_fold", "wstout", lambda f: idle_hold(f, folded(), seed=93), role="idle")
    # ---- the old: slower, smaller, on bent knees, the eyes lower
    add("old_idle_behind", "old", lambda f: idle_hold(f, behind_back(), seed=61, weight_hold=0.7, look_amp=0.7),
        role="idle")
    add("old_idle_front", "old", lambda f: idle_shift(f, seed=62, arms=front(), amp=0.6), role="idle")
    add("old_idle_back", "old", lambda f: rub_back(f, seed=63), role="idle")
    add("old_idle_feet", "old", lambda f: idle_feet(f, seed=64, scratch="nape", T=16.1), role="idle", focus="head")
    add("old_talk_calm", "old", lambda f: Talk(
        f, 13.8, [(0.6, 2.8, "offer", "R"), (3.6, 5.4, "count", "R"), (6.2, 7.4, None, "R"), (8.0, 10.4, "beat", "R"),
                  (11.0, 12.6, None, "R")], hangs(), 65, head_amp=0.8, jaw_amp=5.0).spec(), role="talk_calm")
    add("old_talk_cross", "old", lambda f: Talk(
        f, 11.5, [(0.4, 2.2, "point", "R"), (2.8, 4.6, "beat2", "R"), (5.2, 6.4, None, "R"), (7.0, 8.8, "point", "R"),
                  (9.4, 10.8, "chop", "R")], {"L": behind_back()["L"], "R": Hang()}, 66, lean_=3.0, head_amp=1.1,
        jaw_amp=6.0).spec(), role="talk_cross")
    add("old_listen", "old", lambda f: listen(f, 13.8, 67, behind_back(), nod_at=(2.4, 7.0, 11.0)), role="listen")
    add("old_laugh", "old", lambda f: laugh(f, 5.0, 68, hangs(), hand="R"), role="laugh")
    add("old_point", "old", lambda f: point_way(f, 7.6, 69, hangs()), role="point")
    add("oldw_idle_front", "oldw", lambda f: idle_shift(f, seed=71, arms=front(), amp=0.6), role="idle")
    add("oldw_idle_fold", "oldw", lambda f: idle_hold(f, folded(), seed=72, weight_hold=0.7, look_amp=0.7),
        role="fold")
    add("oldw_talk_calm", "oldw", lambda f: Talk(
        f, 13.8, [(0.6, 2.8, "offer", "R"), (3.6, 5.2, None, "R"), (5.8, 8.0, "chest", "R"), (8.8, 10.8, "offer", "R"),
                  (11.4, 12.8, None, "R")], front(), 73, head_amp=0.9, jaw_amp=5.0).spec(), role="talk_calm")
    add("oldw_listen", "oldw", lambda f: listen(f, 13.8, 74, front(), nod_at=(2.4, 7.0, 11.0), tilt=5.0),
        role="listen")
    # ---- children: quicker, but calm
    add("child_idle_shift", "child", lambda f: idle_shift(f, T=9.0, seed=81, amp=1.2), role="idle")
    add("child_idle_rock", "child", lambda f: idle_rock(f, behind_back(), T=9.0, seed=82), role="behind")
    add("child_idle_feet", "child", lambda f: idle_feet(f, T=12.0, seed=83, scratch="nape"), role="idle",
        focus="head")
    add("child_pockets", "child", lambda f: idle_hold(f, pockets(), T=9.0, seed=84), role="pockets")
    add("child_talk", "child", lambda f: Talk(
        f, 9.0, [(0.3, 1.7, "open", "LR"), (2.1, 3.5, "beat2", "R"), (4.0, 5.4, "point", "R"), (5.9, 7.4, "offer", "L")],
        hangs(), 85, head_amp=1.5, lean_=2.0, weight_moves=[(0.6, 1.0, 0.66), (3.6, 1.1, 0.36), (7.4, 1.1, 0.5)]).spec(),
        role="talk_eager")
    add("child_listen", "child", lambda f: listen(f, 9.0, 86, behind_back(), nod_at=(1.6, 5.2)), role="listen")
    add("child_laugh", "child", lambda f: laugh(f, 4.0, 87, hangs(), hand="R", dur=2.0), role="laugh")
    # ---- sitting: a bench, a chair, a crate, a step (the runtime picks one by the seat's height and the person)
    def feet(xl, fl, yl, xr, fr, yr):
        return {"L": (xl, fl, yl), "R": (xr, fr, yr)}

    thighs = lambda: both_each(on_thigh)
    add("man_sit_bench", "man", lambda f: sit(f, "bench", seed=111, arms=between_knees(), lean_=24.0, tilt=-12.0,
                                               feet=feet(0.16, 0.42, 10, -0.16, 0.40, -10), knees_out=0.45),
        role="sit_bench")
    add("man_sit_chair", "man", lambda f: sit(f, "chair", seed=112, arms=thighs(), lean_=-3.0, tilt=-6.0,
                                               feet=feet(0.13, 0.46, 8, -0.12, 0.37, -6), knees_out=0.3),
        role="sit_chair")
    add("man_sit_crate", "man", lambda f: sit(f, "crate", seed=113, arms=between_knees(0.06, 0.02), lean_=32.0,
                                               tilt=-14.0, feet=feet(0.2, 0.37, 12, -0.2, 0.37, -12), knees_out=0.6),
        role="sit_crate")
    add("man_sit_step", "man", lambda f: sit(f, "step", seed=114, arms=on_knees(), lean_=14.0, tilt=-16.0,
                                              feet=feet(0.15, 0.36, 8, -0.15, 0.34, -8), knees_out=0.35),
        role="sit_step")
    add("woman_sit_bench", "woman", lambda f: sit(f, "bench", seed=121, arms=lap(), lean_=3.0, tilt=-4.0,
                                                   feet=feet(0.05, 0.40, 4, -0.05, 0.36, -4), knees_out=-0.05),
        role="sit_bench")
    add("woman_sit_chair", "woman", lambda f: sit(f, "chair", seed=122, arms=lap(0.5), lean_=-1.0, tilt=-3.0,
                                                   feet=feet(0.04, 0.37, 2, -0.06, 0.43, -8), knees_out=0.0),
        role="sit_chair")
    add("woman_sit_crate", "woman", lambda f: sit(f, "crate", seed=123, arms=lap(0.62), lean_=14.0, tilt=-8.0,
                                                   feet=feet(0.06, 0.36, 6, -0.06, 0.36, -6), knees_out=0.0),
        role="sit_crate")
    add("woman_sit_step", "woman", lambda f: sit(f, "step", seed=124, arms=lap(0.72, clear=0.10), lean_=12.0, tilt=-12.0,
                                                  feet=feet(0.05, 0.33, 4, -0.05, 0.31, -4), knees_out=-0.02),
        role="sit_step")
    add("stout_sit_bench", "stout", lambda f: sit(f, "bench", seed=131, arms=thighs(), lean_=4.0, tilt=-8.0,
                                                   feet=feet(0.2, 0.42, 14, -0.2, 0.42, -14), knees_out=0.7),
        role="sit_bench")
    add("wstout_sit_bench", "wstout", lambda f: sit(f, "bench", seed=132, arms=lap(), lean_=2.0, tilt=-4.0,
                                                     feet=feet(0.07, 0.40, 6, -0.07, 0.38, -6), knees_out=0.1),
        role="sit_bench")
    add("old_sit_bench", "old", lambda f: sit(f, "bench", seed=141, arms=thighs(), lean_=12.0, tilt=-10.0,
                                               feet=feet(0.15, 0.40, 10, -0.15, 0.38, -10), knees_out=0.35,
                                               look_amp=0.7), role="sit_bench")
    add("old_sit_step", "old", lambda f: sit(f, "step", seed=142, arms=on_knees(), lean_=14.0, tilt=-14.0,
                                              feet=feet(0.15, 0.36, 8, -0.15, 0.34, -8), knees_out=0.35,
                                              look_amp=0.7), role="sit_step")
    add("oldw_sit_bench", "oldw", lambda f: sit(f, "bench", seed=143, arms=lap(), lean_=6.0, tilt=-6.0,
                                                 feet=feet(0.06, 0.38, 4, -0.06, 0.36, -4), knees_out=0.0,
                                                 look_amp=0.7), role="sit_bench")
    add("child_sit_bench", "child", lambda f: sit(f, "bench", T=9.0, seed=151, arms=thighs(), lean_=4.0, tilt=-6.0,
                                                   feet=feet(0.09, 0.3, 4, -0.09, 0.3, -4), knees_out=0.2,
                                                   dangle=True, feet_swing=1.0), role="sit_bench")
    add("child_sit_step", "child", lambda f: sit(f, "step", T=9.0, seed=152, arms=on_knees(), lean_=12.0, tilt=-12.0,
                                                  feet=feet(0.11, 0.30, 6, -0.11, 0.28, -6), knees_out=0.3),
        role="sit_step")
    return R


def both_each(fn, *a, **k):
    return {S: fn(*a, **k) for S in "LR"}


# sitting down and getting up: (seated clip, the standing clip it starts from or ends in)
CHANGES = [("man_sit_bench", "man_idle_shift"), ("man_sit_chair", "man_idle_shift"),
           ("man_sit_crate", "man_idle_shift"), ("man_sit_step", "man_idle_shift"),
           ("woman_sit_bench", "woman_idle_shift"), ("woman_sit_chair", "woman_idle_shift"),
           ("woman_sit_crate", "woman_idle_shift"), ("woman_sit_step", "woman_idle_shift"),
           ("stout_sit_bench", "stout_idle_hips"), ("wstout_sit_bench", "wstout_idle_shift"),
           ("old_sit_bench", "old_idle_front"), ("old_sit_step", "old_idle_front"),
           ("oldw_sit_bench", "oldw_idle_front"), ("child_sit_step", "child_idle_shift")]


_FAMS = {}


def family(name, bodies):
    """The Fam of a family, made once per build on its body (None when that body is not built)."""
    body = FAMILIES[name][0]
    key = (name, id(bodies.get(body)))
    if key not in _FAMS:
        if body not in bodies:
            return None
        _FAMS[key] = Fam(name, bodies[body], STANCES[name])
    return _FAMS[key]


def make_one(name, fam_name, fn, meta, bodies):
    fam = family(fam_name, bodies)
    if fam is None:
        return None
    spec = fn(fam)
    m = dict(meta)
    m.update(family=fam_name, female=fam.P["female"], kind="idle")
    m.update(spec.meta)
    c = evaluate(spec, name, m)
    return c, fam.b


def make_some(bodies, names=None):
    """The clips named (all when names is None), and the sitting down and getting up for the seats made."""
    out = []
    want = set(names) if names else None
    if want:
        for sit_name, stand_name in CHANGES:
            if sit_name + "_down" in want or sit_name + "_up" in want:
                want |= {sit_name, stand_name}
    made = {}
    for name, fam_name, fn, meta in recipes():
        if want and name not in want:
            continue
        r = make_one(name, fam_name, fn, meta, bodies)
        if r:
            made[name] = r
            if not names or name in names:
                out.append(r)
    for sit_name, stand_name in CHANGES:
        if sit_name not in made or stand_name not in made:
            continue
        seated, b = made[sit_name]
        stand, _ = made[stand_name]
        fam = family(seated.meta["family"], bodies)
        for down in (True, False):
            nm = sit_name + ("_down" if down else "_up")
            if names and nm not in names and sit_name not in names:
                continue
            c = sit_change(fam, stand, seated, nm, down=down)
            c.meta.update(family=seated.meta["family"], female=seated.meta["female"], kind="idle",
                          role=("sit_down" if down else "stand_up"), sit=sit_name, stand=stand_name)
            out.append((c, b))
    return out


def checks(clip):
    """The foot slide in stance (mm, at the keys and as played), the swing scuffs, the loop seam."""
    sl = mo.slide(clip)
    chk = {"slideKeysMm": round(1000 * max(v["keys"] for v in sl.values()), 3),
           "slidePlayedMm": round(1000 * max(v["played"] for v in sl.values()), 3),
           "scuffMm": round(1000 * max(v["scuff"] for v in sl.values()), 2)}
    if clip.loop:
        se = mo.seam(clip)
        chk["seamDeg"] = round(se["gap"], 5)
        chk["seamJerk"] = round(se["jerk"], 3)
        chk["jerkInside"] = round(se["typical"], 3)
    return chk


# ---------------------------------------------------------------- the build


def public_meta(clip, chk):
    m = {k: v for k, v in clip.meta.items() if not k.startswith("_") and k != "focus"}
    m["frames"] = clip.frames
    m["loop"] = clip.loop
    m["checks"] = chk
    return m


def make_all(bodies, target_ao, log=print):
    """Make every D2 clip on its own body, check it, key it on target_ao (the export armature). Returns (actions,
    meta for peopleRig.json, the (clip, body) pairs)."""
    by = {b["name"]: b for b in bodies}
    _FAMS.clear()
    made = make_some(by)
    actions, meta = [], {}
    for c, b in made:
        chk = checks(c)
        meta[c.name] = public_meta(c, chk)
        log("[people2] idle %-22s %3d frames  slide %s mm (played %s), scuff %s mm%s" % (
            c.name, c.frames, chk["slideKeysMm"], chk["slidePlayedMm"], chk["scuffMm"],
            ", seam %.4f deg, jerk %.2f deg/frame^2" % (chk["seamDeg"], chk["seamJerk"]) if "seamDeg" in chk else ""))
        actions.append(mo.key_clip(target_ao, c))
    return actions, meta, made


def sets(meta):
    """Per family: which clip serves which motion (the runtime's table, docs/godot-people2.md)."""
    out = {}
    for fam, (body, fallback) in FAMILIES.items():
        f = {"body": body, "fallback": fallback, "idle": [], "talk": {"calm": [], "eager": [], "cross": []},
             "listen": [], "laugh": [], "shrug": [], "point": [], "fold": [], "behind": [], "pockets": [], "sit": {},
             "sitDown": {}, "standUp": {}}
        for name, m in meta.items():
            if m.get("family") != fam:
                continue
            role = m.get("role", "")
            if role in ("idle", "listen", "laugh", "shrug", "point", "fold", "behind", "pockets"):
                f[role].append(name)
                # an idle that holds the arms so also serves that motion (the old's hands behind, folded, before)
                for word, motion in (("behind", "behind"), ("fold", "fold"), ("front", "pockets")):
                    if role == "idle" and word in name and name not in f[motion]:
                        f[motion].append(name)
            elif role.startswith("talk_"):
                f["talk"][role[5:]].append(name)
            elif role.startswith("sit_") and role not in ("sit_down",):
                f["sit"][m["seatKind"]] = {"clip": name, "seat": m["seat"], "hips": m["sitHips"],
                                           "dangle": bool(m.get("dangle"))}
            elif role == "sit_down":
                f["sitDown"][meta[m["sit"]]["seatKind"]] = name
            elif role == "stand_up":
                f["standUp"][meta[m["sit"]]["seatKind"]] = name
        out[fam] = f
    return out


def rig_json(meta):
    """peopleRig.json "idles" (package D2)."""
    return {
        "about": "package D2 clips (art-source/tools/blender/people2/clips_idle.py, docs/people.md 'Idles, talk and "
                 "sitting'). Each is made on its family's body and keyed like the D1 clips (hips translation on "
                 "trackBase). Every loop of a family starts and ends in the family's neutral stance (weight in the "
                 "middle, feet at their base): hand one over to another at a seam and no foot moves.",
        "bodyFamily": BODY_FAMILY,
        "families": sets(meta),
        "seats": SEATS,
        "rules": {
            "variant": "pick a family's clip for a motion from the person's stable id (FNV-1a), the same on every PC; "
                       "let a standing idle change now and then (20-50 s) to another of the family's idles, only at "
                       "the end of a loop, with a 1 s crossfade",
            "talk": "a talker alternates speaking (the talk set) and listening at the end of each loop; a partner "
                    "within 3 m who also talks takes the other turn; the set comes from the mood if known (angry, "
                    "cold: cross; warm, amused: eager; else calm), else from the id",
            "sit": "the seat's height picks the variant: under 0.32 m a step, under 0.43 a crate, else a bench or a "
                   "chair by the id; the hips are lowered by the clip; move the node by seat - seat(clip) * scale "
                   "and put the feet back on the floor with leg IK near the camera",
            "fallback": "a family without a clip for a motion uses its fallback family's",
        },
        "clips": meta,
    }

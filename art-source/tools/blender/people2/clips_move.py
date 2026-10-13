"""Locomotion clips for the people2 kit (package D1; docs/people.md "Locomotion").

Every clip here is made the same way, by `evaluate(plan)`:
1. a plan says where the body goes (body(t): a point on the ground and a facing), where each foot stands and
   when (stances: a fixed place on the ground, from the moment the foot lands to the moment it lifts, with the
   foot's roll over that time: heel strike, flat, heel off, toe off), how each foot swings from one stance to the
   next (keys for its path, pitch and toes), and what the body does on top (layers(t): the pelvis, the trunk, the
   arms, the head, the hands);
2. the hips' height comes from the legs: while a foot carries the weight its knee follows a bend profile (the
   pelvis drops at contact and rises over the foot), it never asks a leg to be longer than it is, and with no foot
   on the ground (a run's flight) the hips fly on a parabola under gravity; then the height is smoothed;
3. every frame the legs are solved by IK onto the feet (a planted foot does not move), the arms swing or hold, the
   head stays level, and the pose is keyed.

Loops are two strides long (left heel strikes at 0 and at 0.5 of the clip; the right at 0.25 and 0.75), in place:
the games move the person at the clip's speed. Clips that travel (start, stop, turns) move and turn the hips.
The numbers per speed and per kind of walker are in GAIT and STYLES below; what each clip is for, its speed, its
stride and its travel go to peopleRig.json ("locomotion").
"""

import math

from mathutils import Quaternion, Vector

from . import FPS
from . import clips_legacy as cl
from . import motion as mo
from .rig import KEYED
from .motion import RX, RY, RZ, V, Curve, bow, clamp, lean, lerp, smoothstep, swing, turn, yaw

GRAV = 9.81
SPEEDS = {"stroll": 0.9, "walk": 1.35, "hurry": 1.9, "run": 3.5, "sprint": 5.5}
ORDER = ["stroll", "walk", "hurry", "run", "sprint"]

# The man's gait at the five speeds (a man of 1.67 m). Lengths in m, angles in degrees, times as shares.
GAIT = {
    "step": [0.60, 0.72, 0.85, 1.25, 1.72],  # one step (half a stride)
    "duty": [0.65, 0.62, 0.59, 0.37, 0.32],  # the share of a stride a foot is on the ground
    "land": [0.36, 0.36, 0.36, 0.42, 0.36],  # where the foot lands ahead of the body, as a share of its stance
    "width": [0.11, 0.10, 0.09, 0.06, 0.05],  # between the feet's middles
    "toeOut": [7, 7, 6, 4, 3],
    "heel": [-11, -15, -19, -3, 12],  # the foot's pitch as it lands (- toes up: heel first; + on the ball)
    "flat": [0.17, 0.15, 0.14, 0.12, 0.30],  # when the foot is flat (or, on the ball, lowest), share of stance
    "heelOff": [0.56, 0.52, 0.48, 0.38, 0.30],
    "toeOff": [30, 40, 48, 46, 50],  # the foot's pitch as it leaves the ground
    "load": [8, 12, 16, 40, 44],  # the stance knee's most bend (walk: at loading; run: at mid stance)
    "contactKnee": [3, 3, 4, 18, 22],
    "offKnee": [4, 4, 5, 16, 14],
    "lift": [0.21, 0.24, 0.27, 0.42, 0.58],  # the swing ankle's height early in the swing (heel kick in a run)
    "mid": [0.12, 0.125, 0.135, 0.33, 0.46],  # the ankle's height as the foot passes forward
    "late": [0.10, 0.105, 0.11, 0.0, 0.0],
    "kickBack": [0, 0, 0, -0.30, -0.27],  # runs: where the foot is (body-relative) at the heel kick
    "drive": [0, 0, 0, 0.16, 0.24],  # runs: where it is as the knee drives forward
    "pelvisYaw": [4, 5, 6, 8, 10],
    "pelvisList": [3, 4, 4.5, 3, 2],
    "pelvisTilt": [1, 1.5, 2, 4, 5],
    "tiltWave": [0.8, 1.0, 1.2, 2.0, 2.0],
    "sway": [0.024, 0.021, 0.017, 0.012, 0.008],
    "surge": [0.006, 0.008, 0.010, 0.008, 0.006],
    "lean": [1, 2, 4, 8, 13],  # the trunk forward
    "counter": [6, 8, 10, 14, 18],  # the chest against the pelvis
    "nod": [0.5, 0.8, 1.2, 2.0, 2.5],
    "armMean": [2, 2, 3, -4, -8],
    "armSwing": [9, 16, 25, 32, 52],
    "armOut": [6, 6, 7, 9, 9],
    "elbow": [10, 12, 18, 82, 78],
    "elbowSwing": [6, 14, 22, 16, 26],
    "across": [4, 6, 10, 22, 26],
    "shoulder": [1.5, 2.5, 4, 5, 7],
    "breath": [0.8, 1.0, 1.3, 2.4, 3.0],
    "keep": [0.15, 0.15, 0.18, 0.25, 0.35],  # how much of the trunk's motion the head keeps
}
RUN_FROM = 3  # index of the first running speed

# How each kind of walker differs from the man: body, speeds, scale on the step, and changes (+ add, * multiply)
STYLES = {
    "man": dict(body="man_middling", speeds=ORDER, step=1.0, mods={}),
    "woman": dict(body="woman_middling", speeds=ORDER, step=0.95, mods={
        "width": ("*", 0.65), "toeOut": ("*", 0.6), "pelvisList": ("*", 1.4), "pelvisYaw": ("*", 1.1),
        "sway": ("*", 1.15), "armSwing": ("*", 0.7), "armOut": ("+", -1), "elbow": ("+", 10), "lean": ("+", -1),
        "counter": ("*", 0.8), "lift": ("*", 0.9), "keep": ("*", 0.7)}),
    "old": dict(body="old_man", speeds=ORDER[:3], step=0.80, mods={
        "width": ("*", 1.35), "heel": ("*", 0.45), "toeOff": ("*", 0.6), "load": ("+", 7), "contactKnee": ("+", 8),
        "offKnee": ("+", 7), "lift": ("*", 0.8), "mid": ("*", 0.95), "late": ("*", 0.95), "sway": ("*", 1.35),
        "pelvisYaw": ("*", 0.7), "armSwing": ("*", 0.45), "elbow": ("+", 12), "lean": ("+", 4), "counter": ("*", 0.6),
        "duty": ("+", 0.03), "keep": ("*", 0.6)}),
    "child": dict(body="child_middling", speeds=ORDER, step=1.0, mods={
        "load": ("*", 1.2), "armSwing": ("*", 1.25), "sway": ("*", 0.8), "lean": ("+", 1), "nod": ("*", 1.6),
        "keep": ("*", 1.6), "lift": ("*", 0.78), "mid": ("*", 0.78), "late": ("*", 0.78),
        "kickBack": ("*", 0.76), "drive": ("*", 0.76)}),
    "stout": dict(body="man_stout", speeds=ORDER, step=0.97, mods={
        "width": ("+", 0.05), "toeOut": ("+", 5), "sway": ("*", 1.6), "pelvisList": ("*", 0.7), "load": ("+", 3),
        "armOut": ("+", 9), "lean": ("+", -4), "counter": ("*", 0.8), "armSwing": ("*", 0.9), "nod": ("*", 1.3)}),
    "laden": dict(body="man_middling", speeds=ORDER[:3], step=0.86, mods={
        "load": ("+", 8), "contactKnee": ("+", 5), "offKnee": ("+", 4), "lean": ("+", 13), "sway": ("*", 1.2),
        "pelvisYaw": ("*", 0.8), "counter": ("*", 0.5), "heel": ("*", 0.75), "lift": ("*", 0.9), "nod": ("*", 1.4),
        "keep": ("*", 0.6)}),
}

STAIR = {"rise": 0.17, "going": 0.28}  # the stairs the stair clips are made for
# stairs: one tread a step; the foot lands flat going up (on the ball going down); the knees do the lifting
STAIR_GAIT = {
    "up": dict(stairT=1.20, duty=0.64, heel=-2.0, flat=0.08, heelOff=0.55, toeOff=22.0, contactKnee=56.0, load=46.0,
               offKnee=10.0, behind=0.30, lean=7.0),
    "down": dict(stairT=1.04, duty=0.62, heel=14.0, flat=0.22, low=0.0, heelOff=0.6, toeOff=16.0, contactKnee=8.0,
                 load=14.0, offKnee=46.0, behind=0.22, lean=1.0),
}
SLOPE = 8.0  # degrees, the slope clips


def leg_len(sk):
    return sk.L["thighL"] + sk.L["shinL"]


def gait(style, v, sk):
    """The gait numbers for a walker at speed v (m/s): the man's table at that speed, the style's changes, and the
    step scaled to the body's legs."""
    xs = [SPEEDS[s] for s in ORDER]
    if v <= xs[0]:
        i, u = 0, 0.0
    elif v >= xs[-1]:
        i, u = len(xs) - 2, 1.0
    else:
        i = max(k for k in range(len(xs) - 1) if xs[k] <= v)
        u = (v - xs[i]) / (xs[i + 1] - xs[i])
    g = {k: lerp(t[i], t[i + 1], u) for k, t in GAIT.items()}
    st = STYLES[style]
    for k, (op, x) in st["mods"].items():
        g[k] = g[k] * x if op == "*" else g[k] + x
    k = (leg_len(sk) / 0.787) ** 0.8
    g["step"] *= k * st["step"]
    if style == "child":
        for kk in ("width", "sway", "surge"):
            g[kk] *= 0.75
    g["v"] = v
    g["T"] = 2 * g["step"] / v
    g["run"] = v > 2.5
    return g


# ---------------------------------------------------------------- the plan


class Stance:
    """A foot on the ground from `land` to `lift`, the ankle at `flat` (armature axes, world) when flat, turned
    `yaw`, on ground sloping `gpitch` (degrees, + rising ahead). roll(t) -> degrees; knee(t) -> the knee's bend
    while this foot carries the weight (None: it only must reach)."""

    def __init__(self, land, lift, flat, yaw_, roll, knee=None, release=None, gpitch=0.0):
        self.land, self.lift, self.flat, self.yaw, self.roll = land, lift, Vector(flat), yaw_, roll
        self.knee = knee
        self.release = release if release is not None else lift
        self.gpitch = gpitch


def roll_curve(land, lift, g, gp=None):
    """The foot's roll over a stance (degrees as a function of time): heel strike, flat, heel off, toe off
    (walks); on the ball, down, up (sprints)."""
    gp = gp or g
    T = lift - land
    hs, fl, ho, to = gp["heel"], gp["flat"], gp["heelOff"], gp["toeOff"]
    if hs > 0:
        # a forefoot landing: on the ball all through, lowest at `flat`
        low = gp.get("low", max(2.0, hs * 0.3))
        c = Curve([(land, hs, 0.0), (land + fl * T, low, 0.0), (lift, to, 2.2 * (to - low) / ((1 - fl) * T))])
    else:
        c = Curve([(land, hs, 0.0), (land + fl * T, 0.0, 0.0), (land + ho * T, 0.0, 0.0),
                   (lift, to, 1.25 * to / ((1 - ho) * T))])
    return lambda t: c(clamp(t, land, lift))


def knee_curve(land, lift, g, run):
    """The stance knee's bend while the foot carries the weight, and when it lets go (the release). A walk: nearly
    straight at the strike, bent at loading, straight over the foot, then bending again as the heel rises; a run:
    bent at contact, most at mid stance, extending to toe off."""
    T = lift - land
    if run:
        c = Curve([(land, g["contactKnee"]), (land + 0.45 * T, g["load"]), (lift, g["offKnee"])])
        return (lambda t: c(t)), lift
    rel = g.get("release", 0.80)
    c = Curve([(land, g["contactKnee"]), (land + 0.17 * T, g["load"]), (land + 0.45 * T, 0.5 * (g["contactKnee"] + g["offKnee"]) + 2),
               (land + 0.64 * T, g["offKnee"] + 1), (land + rel * T, g["offKnee"] + 11, 60.0 / T)])
    return (lambda t: c(t)), land + rel * T


class Plan:
    def __init__(self, sk, t0, t1, body, anchor=None, loop=False):
        self.sk = sk
        self.t0, self.t1 = t0, t1
        self.body = body  # t -> (Vector on the ground, facing degrees)
        self.anchor = anchor or (lambda t: (Vector(), 0.0))  # t -> the node (what the clip is relative to)
        self.loop = loop
        self.stances = {"L": [], "R": []}
        self.swings = {"L": {}, "R": {}}  # index of the stance it leaves -> keys
        self.layers = None  # (t, ctx) -> dict for the hips; upper(pose, ctx) does the rest
        self.upper = None
        self.ground = lambda p: 0.0
        self.smooth = 0.035  # s, the hips' height smoothing
        self.hips_extra = lambda t: 0.0
        self.pad = 0.9
        self.preswing = None  # the knee's bend at toe off (None: 34 degrees)
        self.roll_cap = 70.0  # the most a foot rises on its toes before toe off

    def stance_at(self, S, t):
        st = self.stances[S]
        for i, s in enumerate(st):
            if s.land <= t <= s.lift:
                return i, s
        return None, None

    def swing_at(self, S, t):
        st = self.stances[S]
        for i in range(len(st) - 1):
            if st[i].lift < t < st[i + 1].land:
                return i
        return None


def foot_rot(yaw_, gpitch, r):
    base = RZ(yaw_) @ RX(-gpitch)
    return Quaternion(base @ Vector((1, 0, 0)), math.radians(r)) @ base


def stance_state(sk, S, s, t):
    r = s.roll(t)
    a, rot, toe = mo.roll(sk, S, s.flat, s.yaw, r, s.gpitch)
    return a, rot, r, toe


def rel(plan, p, t):
    bp, by = plan.body(t)
    return RZ(-by) @ (Vector(p) - bp)


def swing_state(plan, S, i, t):
    """The swinging foot between stance i and i+1: Hermite curves (in the body's frame, so the foot moves with the
    body) through the two stances' ends and the swing's keys."""
    sk = plan.sk
    a, b = plan.stances[S][i], plan.stances[S][i + 1]
    key = plan.swings[S].get(i, {})
    t0, t1 = a.lift, b.land
    dt = 1e-3
    A0, _, r0, _ = stance_state(sk, S, a, t0)
    A0m, _, r0m, _ = stance_state(sk, S, a, t0 - dt)
    A1, _, r1, _ = stance_state(sk, S, b, t1)
    A1p, _, r1p, _ = stance_state(sk, S, b, t1 + dt)
    q0, q0m = rel(plan, A0, t0), rel(plan, A0m, t0 - dt)
    q1, q1p = rel(plan, A1, t1), rel(plan, A1p, t1 + dt)
    v0, v1 = (q0 - q0m) / dt, (q1p - q1) / dt
    D = t1 - t0
    curves = []
    for ax in range(3):
        ks = [(t0, q0[ax], v0[ax])]
        for u, w in key.get("pts", []):
            # w: a world point (Vector) or None for this axis
            if w is None:
                continue
            tt = t0 + u * D
            rp = rel(plan, w, tt)
            if ax in key.get("axes", (0, 1, 2)):
                ks.append((tt, rp[ax]))
        ks.append((t1, q1[ax], v1[ax]))
        curves.append(Curve(ks))
    # up: heights over the ground (or world heights) at keys
    ups = [(t0, q0[2], v0[2])]
    for u, h in key.get("up", []):
        tt = t0 + u * D
        x = Vector((curves[0](tt), curves[1](tt), 0))
        bp, by = plan.body(tt)
        w = bp + RZ(by) @ x
        gz = plan.ground(w) if not key.get("upWorld") else 0.0
        ups.append((tt, gz + h - bp.z))
    ups.append((t1, q1[2], v1[2]))
    cu = Curve(ups)
    ql = Vector((curves[0](t), curves[1](t), cu(t)))
    # a small bow toward the middle as the foot passes the other
    sg = 1 if S == "L" else -1
    u = (t - t0) / D
    ql.x -= sg * key.get("bow", 0.008) * math.sin(math.pi * u)
    bp, by = plan.body(t)
    ankle = bp + RZ(by) @ ql
    # pitch and toes
    pr = Curve([(t0, r0, (r0 - r0m) / dt)] + [(t0 + uu * D, p) for uu, p in key.get("pitch", [])] + [(t1, r1, (r1p - r1) / dt)])
    tr = Curve([(t0, max(0.0, r0), 0.0)] + [(t0 + uu * D, p) for uu, p in key.get("toe", [(0.3, 4.0)])] + [(t1, 0.0, 0.0)])
    yw = lerp(a.yaw, b.yaw, smoothstep(u))
    gpv = lerp(a.gpitch, b.gpitch, smoothstep(u))
    r = pr(t)
    # early in the swing the toes stay level (they leave the ground last), then follow their own curve
    w = 1.0 - smoothstep(u / 0.4)
    toe = w * max(0.0, r) + (1 - w) * tr(t)
    return ankle, foot_rot(yw, gpv, r), r, RX(-toe), yw


def knee_dist(sk, deg):
    L1, L2 = sk.L["thighL"], sk.L["shinL"]
    return math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * math.cos(math.radians(deg)))


def _feet(plan, t):
    sk = plan.sk
    feet = {}
    for S in "LR":
        i, s = plan.stance_at(S, t)
        if s is not None:
            a, rot, r, toe = stance_state(sk, S, s, t)
            k = s.knee(t) if (s.knee and t <= s.release) else None
            feet[S] = dict(ankle=a, rot=rot, r=r, toe=toe, stance=True, knee=k, yaw=s.yaw, s=s)
        else:
            j = plan.swing_at(S, t)
            a, rot, r, toe, yw = swing_state(plan, S, j, t)
            st = plan.stances[S]
            u = (t - st[j].lift) / (st[j + 1].land - st[j].lift)
            feet[S] = dict(ankle=a, rot=rot, r=r, toe=toe, stance=False, knee=None, yaw=yw, s=None, u=u)
    return feet


def _hip_joint(sk, S, xy, H, qh):
    ho = qh @ (sk.rest["legUp" + S] - sk.rest["hips"])
    return Vector((xy.x + ho.x, xy.y + ho.y, H + ho.z))


def _heights(plan, rows):
    """The hips' height per row: from the legs that carry the weight (their knee profiles), a parabola in flight,
    smoothed, and never more than a weight-bearing leg reaches."""
    sk = plan.sk
    m = len(rows)
    for r in rows:
        eq, mx = [], []
        qh = r["ctx"]["hips"]
        for S in "LR":
            f = r["feet"][S]
            if not f["stance"] and f.get("u", 0) > 0.7:
                # a leg about to land must reach its foot: the pelvis comes down to meet it
                hj = _hip_joint(sk, S, r["xy"], 0.0, qh)
                hor = math.hypot(hj.x - f["ankle"].x, hj.y - f["ankle"].y)
                dmax = knee_dist(sk, 2.5 * (1.0 - f["u"]) / 0.3 + 2.0)
                mx.append(f["ankle"].z + math.sqrt(max(0.0, dmax * dmax - hor * hor)) - hj.z)
                continue
            if f["stance"] and f["knee"] is None:
                # late in a stance: the foot may rise on its toes up to ROLL_CAP, no further
                st = f["s"]
                base_r = st.base_roll(r["t"]) if hasattr(st, "base_roll") else f["r"]
                a_, _, _ = mo.roll(sk, S, st.flat, st.yaw, max(base_r, plan.roll_cap), st.gpitch)
                hj = _hip_joint(sk, S, r["xy"], 0.0, qh)
                hor = math.hypot(hj.x - a_.x, hj.y - a_.y)
                dmax = knee_dist(sk, st.late_knee(r["t"]) if hasattr(st, "late_knee") else 3.0)
                mx.append(a_.z + math.sqrt(max(0.0, dmax * dmax - hor * hor)) - hj.z)
                continue
            if not f["stance"] or f["knee"] is None:
                continue
            hj = _hip_joint(sk, S, r["xy"], 0.0, qh)
            hor = math.hypot(hj.x - f["ankle"].x, hj.y - f["ankle"].y)
            dmax = sk.L["thigh" + S] + sk.L["shin" + S] - 0.003
            mx.append(f["ankle"].z + math.sqrt(max(0.0, dmax * dmax - hor * hor)) - hj.z)
            d = knee_dist(sk, f["knee"])
            eq.append(f["ankle"].z + math.sqrt(max(0.0, d * d - hor * hor)) - hj.z)
        # heights are kept over the body's own ground point (so a climb's loop is periodic)
        z0 = r["ctx"]["body"].z
        r["eq"] = min(eq) - z0 if eq else None
        r["mx"] = min(mx) - z0 if mx else None
    known = [i for i, r in enumerate(rows) if r["eq"] is not None]
    H = [rows[i]["eq"] for i in range(m)]
    period = m - 1 if plan.loop else None
    for i in range(m):
        if H[i] is not None:
            continue
        if period:
            a = max((k for k in known if k < i), default=max(known) - period)
            b = min((k for k in known if k > i), default=min(known) + period)
            ha, hb = rows[a % period]["eq"], rows[b % period]["eq"]
        else:
            a = max((k for k in known if k < i), default=None)
            b = min((k for k in known if k > i), default=None)
            if a is None or b is None:
                H[i] = rows[b if a is None else a]["eq"]
                continue
            ha, hb = rows[a]["eq"], rows[b]["eq"]
        ta, tb, t = a / FPS, b / FPS, i / FPS
        H[i] = ha + (hb - ha) * (t - ta) / (tb - ta) + 0.5 * GRAV * (t - ta) * (tb - t)
    sig = plan.smooth * FPS
    if sig > 0.3:
        rad = int(math.ceil(3 * sig))
        wts = [math.exp(-0.5 * (k / sig) ** 2) for k in range(-rad, rad + 1)]
        out = []
        for i in range(m):
            acc = ws = 0.0
            for k, w in zip(range(-rad, rad + 1), wts):
                j = i + k
                if period:
                    j %= period
                elif j < 0 or j >= m:
                    continue
                acc += w * H[j]
                ws += w
            out.append(acc / ws)
        H = out
    for _ in range(3):
        for i in range(m):
            if rows[i]["mx"] is not None and H[i] > rows[i]["mx"]:
                H[i] = rows[i]["mx"]
        H2 = list(H)
        for i in range(m):
            a, b = (i - 1, i + 1)
            if period:
                a, b = a % period, b % period
            elif a < 0 or b >= m:
                continue
            H2[i] = min(H[i], 0.25 * H[a] + 0.5 * H[i] + 0.25 * H[b])
        H = H2
    if period:
        H[-1] = H[0]
    return [h + r["ctx"]["body"].z for h, r in zip(H, rows)]


def _knee_of(sk, S, d):
    """The knee's bend (degrees) for a hip-to-ankle distance d."""
    L1, L2 = sk.L["thigh" + S], sk.L["shin" + S]
    c = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)
    return math.degrees(math.acos(clamp(c, -1.0, 1.0)))


def _adapt_rolls(plan, rows, H):
    """A foot late in its stance (the weight gone to the other foot) rises on its toes as far as its leg needs:
    the knee goes from the bend it has when the other foot takes the weight to `plan.preswing` at toe off, and the
    heel rises to match (never below the authored roll, never past plan.roll_cap; the toes stay planted). The
    extra roll and the knee's target are stored on the stance."""
    sk = plan.sk
    late = {}
    for i, r in enumerate(rows):
        for S in "LR":
            f = r["feet"][S]
            if f["stance"] and f["knee"] is None:
                late.setdefault(id(f["s"]), (f["s"], S, []))[2].append((r["t"], i))
    pre = plan.preswing if plan.preswing is not None else 28.0
    for s, S, pts in late.values():
        if not hasattr(s, "base_roll"):
            s.base_roll = s.roll
        base = s.base_roll
        pts.sort()
        t_a = pts[0][0]

        def hipj(i):
            return _hip_joint(sk, S, rows[i]["xy"], H[i], rows[i]["ctx"]["hips"])

        a0, _, _ = mo.roll(sk, S, s.flat, s.yaw, base(t_a), s.gpitch)
        k0 = _knee_of(sk, S, (a0 - hipj(pts[0][1])).length)
        t_b = s.lift

        def target(t, k0=k0, t_a=t_a, t_b=t_b):
            return lerp(k0, max(k0, pre), smoothstep((t - t_a) / max(1e-3, t_b - t_a)))

        out = []
        for t, i in pts:
            hj = hipj(i)
            dmax = knee_dist(sk, target(t))
            r0 = base(t)

            def far(rr):
                a, _, _ = mo.roll(sk, S, s.flat, s.yaw, rr, s.gpitch)
                return (a - hj).length - dmax

            rr = r0
            if far(r0) > 0:
                lo, hi = r0, max(r0, plan.roll_cap)
                if far(hi) > 0:
                    rr = hi
                else:
                    for _ in range(30):
                        mid = (lo + hi) / 2
                        if far(mid) > 0:
                            lo = mid
                        else:
                            hi = mid
                    rr = hi
            out.append((t, rr - r0))
        # rising only, carried on to the lift
        mono = []
        top = 0.0
        for t, e in out:
            top = max(top, e)
            mono.append((t, top))
        if mono[-1][0] < t_b - 1e-6 and len(mono) > 1:
            (ta, ea), (tb, eb) = mono[-2], mono[-1]
            mono.append((t_b, eb + (eb - ea) / (tb - ta) * (t_b - tb)))
        if mono[0][0] > t_a - 1e-6:
            mono.insert(0, (t_a - 1.0 / FPS, 0.0))
        c = Curve(mono)
        s.roll = (lambda base, c, t_a: (lambda t: base(t) + (min(plan.roll_cap - base(t), max(0.0, c(t))) if t >= t_a else 0.0)))(base, c, t_a)
        s.late_knee = target


def evaluate(plan, name, meta=None):
    """Make the Clip for a plan (see the module note)."""
    sk = plan.sk
    n = int(round((plan.t1 - plan.t0) * FPS))
    pad = int(round(plan.pad * FPS))
    ts = [plan.t0 + i / FPS for i in range(-pad, n + 1 + pad)]
    rest_h = sk.rest["hips"]

    def make_rows():
        rows = []
        for t in ts:
            bp, by = plan.body(t)
            ctx = {"t": t, "body": bp, "yaw": by}
            lay = plan.layers(t, ctx)
            ctx.update(lay)
            off = RZ(by) @ V(lay.get("sway", 0.0), lay.get("surge", 0.0), 0.0)
            rows.append(dict(t=t, ctx=ctx, feet=_feet(plan, t), xy=bp + off))
        return rows

    def heights(rows):
        if plan.loop:
            core = rows[pad:pad + n + 1]
            Hc = _heights(plan, core)
            rel_ = [h - r["ctx"]["body"].z for h, r in zip(Hc, core)]
            return [rel_[(i - pad) % n] + rows[i]["ctx"]["body"].z for i in range(len(rows))]
        return _heights(plan, rows)

    # 1: heights from the weight-bearing legs; 2: the trailing feet rise on their toes, the hips meet the toe off;
    # 3: the rise again for the final heights
    rows = make_rows()
    H = heights(rows)
    _adapt_rolls(plan, rows, H)
    rows = make_rows()
    H = heights(rows)
    _adapt_rolls(plan, rows, H)
    rows = make_rows()
    poses, trans = [], []
    knees = {"L": [], "R": []}
    for i in range(pad, pad + n + 1):
        r = rows[i]
        t, ctx, feet = r["t"], r["ctx"], r["feet"]
        ap, ay = plan.anchor(t)
        aq = RZ(-ay)
        hw = Vector((r["xy"].x, r["xy"].y, H[i] + plan.hips_extra(t)))
        tr = aq @ (hw - ap) - rest_h
        pose = {"hips": aq @ ctx["hips"]}
        ps = sk.fk(pose, tr)
        for S in "LR":
            f = feet[S]
            sg = 1 if S == "L" else -1
            ank = aq @ (f["ankle"] - ap)
            rot = aq @ f["rot"]
            if not f["stance"]:
                # a swinging foot is never further than its leg reaches with the knee bent as a swing needs
                u = f["u"]
                pre = plan.preswing if plan.preswing is not None else 28.0
                kmin = lerp(pre, pre + 18.0, smoothstep(u / 0.22)) if u < 0.3 else 2.0
                hj = ps.P["legUp" + S]
                dv = ank - hj
                dm = knee_dist(sk, kmin)
                if dv.length > dm:
                    ank = hj + dv.normalized() * dm
            pole = RZ(f["yaw"] - ay) @ V(0.12 * sg, 1.0, 0.0)
            sk.leg(pose, S, ank, rot, pole, toe=f["toe"], posed=ps)
        ctx["anchorYaw"] = ay
        ctx["anchor"] = ap
        ctx["trans"] = tr
        plan.upper(pose, ctx)
        poses.append(pose)
        trans.append(tr)
        for S in "LR":
            knees[S].append(mo.angle(pose["legLow" + S], Quaternion()))
    t0 = plan.t0

    def root(t):
        return plan.anchor(t0 + t)

    def swinging(S):
        return lambda t: plan.stance_at(S, t0 + t)[1] is None

    meta = dict(meta or {})
    meta["_swing"] = {S: swinging(S) for S in "LR"}
    meta["_knees"] = {S: (min(knees[S]), max(knees[S])) for S in "LR"}
    core = H[pad:pad + n + 1]
    meta["_heights"] = (min(core), max(core))
    return mo.Clip(name, poses, trans, loop=plan.loop, meta=meta, root=root, ground=plan.ground, skel=sk)


# ---------------------------------------------------------------- the body on top


def breath(t, period, amp):
    return amp * math.sin(2 * math.pi * t / period)


def hand_shapes(pose, axes, L="relaxed", R="relaxed"):
    cl.hand_pose(pose, "L", L, axes)
    cl.hand_pose(pose, "R", R, axes)


def trunk(pose, sk, ctx):
    """Spine, chest and upper chest: the forward lean, the chest against the pelvis, the side lean that keeps the
    shoulders level, a nod at each heel strike, breathing."""
    a = ctx.get("amp", 1.0)
    phi = ctx.get("phase", 0.0)
    g = ctx["g"]
    c = math.cos(2 * math.pi * (phi - 0.03))
    rel_yaw = a * g["counter"] * c
    nod = a * g["nod"] * math.cos(4 * math.pi * (phi - 0.09))
    lean_f = ctx.get("lean", g["lean"]) - ctx.get("hipsLean", 0.0) + nod
    side = -0.8 * ctx.get("list", 0.0) + ctx.get("side", 0.0)
    br = ctx.get("breath", 0.0)
    pose["spine"] = turn(0.3 * rel_yaw, 0.40 * lean_f + 0.2 * br, 0.45 * side)
    pose["chest"] = turn(0.35 * rel_yaw, 0.32 * lean_f - 0.6 * br, 0.35 * side)
    pose["upperChest"] = turn(0.35 * rel_yaw, 0.28 * lean_f - 0.6 * br, 0.2 * side)


def arms_swing(pose, sk, ctx, which="LR"):
    a = ctx.get("amp", 1.0)
    phi = ctx.get("phase", 0.0)
    g = ctx["g"]
    lag_a, lag_e = 0.04, 0.07
    A = g["armSwing"] * a
    for S in which:
        sg = 1 if S == "L" else -1
        side = -sg  # the right arm comes forward with the left leg (phase 0)
        k = math.cos(2 * math.pi * (phi - lag_a)) * side
        sw = A * k
        mean = lerp(0.0, g["armMean"], a)
        fwd = mean + sw + ctx.get("armFwd", {}).get(S, 0.0)
        out = lerp(5.0, g["armOut"], a) - 0.08 * max(0.0, sw) + ctx.get("armOutAdd", 0.0)
        tw = g["across"] * a * max(0.0, k) + 4.0
        pose["armUp" + S] = swing(S, fwd=fwd, out=out, twist=tw)
        ke = math.cos(2 * math.pi * (phi - lag_a - lag_e)) * side
        e = lerp(8.0, g["elbow"], a) + g["elbowSwing"] * a * (0.5 + 0.5 * ke) * (1.0 if not g["run"] else 1.0)
        pose["armLow" + S] = RX(-e)
        kh = math.cos(2 * math.pi * (phi - lag_a - 2 * lag_e)) * side
        pose["hand" + S] = RX(-(4 + 5 * a * (0.5 + 0.5 * kh)))
        pr = g["shoulder"] * a * k
        lift = 0.6 * ctx.get("breath", 0.0) + (2.0 * a if g["run"] else 0.0)
        pose["clavicle" + S] = RZ(-sg * pr) @ RY(-sg * lift)
        mo.twist_rule(pose, S)


def head(pose, sk, ctx):
    g = ctx["g"]
    look = ctx.get("look", 0.0)
    tgt = RZ(ctx["yaw"] - ctx["anchorYaw"] + look) @ RX(ctx.get("lookDown", 0.0)) @ RY(ctx.get("headTilt", 0.0))
    sk.look(pose, tgt, keep=ctx.get("keep", g["keep"]))


def hips_share(lean_deg, k=0.35):
    """How much of a forward lean the pelvis takes: none of a small one, a share k of the rest."""
    return k * max(0.0, lean_deg - 3.0)


def hips_layers(ctx, g, a, phi):
    py = -a * g["pelvisYaw"] * math.cos(2 * math.pi * phi)
    pl = -a * g["pelvisList"] * math.cos(2 * math.pi * (phi - 0.15))
    pt = lerp(0.0, g["pelvisTilt"], a) + a * g["tiltWave"] * math.cos(4 * math.pi * (phi - 0.05))
    sway = a * g["sway"] * math.cos(2 * math.pi * (phi - 0.3))
    surge = -a * g["surge"] * math.sin(4 * math.pi * phi)
    return py, pl, pt, sway, surge


# ---------------------------------------------------------------- holds (hand targets)


def hand_aim(S, fingers, palm):
    """The hand's global turn that points its fingers along `fingers` and its palm toward `palm` (armature axes).
    At rest the fingers point down and the palm faces the body's middle."""
    sg = 1 if S == "L" else -1
    f0, p0 = Vector((0, 0, -1)), Vector((-sg, 0, 0))
    f1 = Vector(fingers).normalized()
    p1 = Vector(palm)
    p1 = (p1 - f1 * p1.dot(f1)).normalized()
    M0 = mo.Matrix((f0, p0, f0.cross(p0))).transposed()
    M1 = mo.Matrix((f1, p1, f1.cross(p1))).transposed()
    return (M1 @ M0.transposed()).to_quaternion()


def hold_on_bone(pose, sk, ctx, S, bone, rest_point, fingers, palm, pole, shape="grip", wobble=None, clav=None,
                 use_grip=True):
    """Put hand S on a point carried by `bone` (rest_point in rest armature axes), turned (relative to the bone's
    turn) to point its fingers and palm as given; the elbow toward `pole` (in the anchor's frame)."""
    ps = sk.fk(pose, ctx["trans"])
    p = ps.point(bone, rest_point)
    if wobble is not None:
        p = p + wobble
    rot = ps.D[bone] @ hand_aim(S, fingers, palm)
    if use_grip:
        sk.hold(pose, S, p, rot, pole, t=ctx["trans"], clav=clav)
    else:
        if clav is not None:
            pose["clavicle" + S] = clav
        sk.arm(pose, S, p, rot, pole, t=ctx["trans"])
    ctx.setdefault("shapes", {})[S] = shape


def hold_in_world(pose, sk, ctx, S, point, fingers, palm, pole, shape="grip"):
    """Hand S on a point fixed to the person's node (a cart's handle): point in the anchor's frame."""
    rot = hand_aim(S, fingers, palm)
    sk.hold(pose, S, point, rot, pole, t=ctx["trans"])
    ctx.setdefault("shapes", {})[S] = shape


# ---------------------------------------------------------------- the walkers' upper bodies


def make_upper(style, sk, axes, extra=None):
    """The upper body for a style: trunk, arms (swing or hold), head, hands."""

    def upper(pose, ctx):
        g = ctx["g"]
        trunk(pose, sk, ctx)
        ctx["shapes"] = {}
        held = ""
        if extra:
            held = extra(pose, sk, ctx) or ""
        arms_swing(pose, sk, ctx, which="".join(S for S in "LR" if S not in held))
        head(pose, sk, ctx)
        shp = ctx["shapes"]
        dflt = "cup" if g["run"] and ctx.get("amp", 1) > 0.5 else "relaxed"
        hand_shapes(pose, axes, shp.get("L", dflt), shp.get("R", dflt))

    return upper


def woman_skirt(pose, sk, ctx):
    """A woman running holds her skirt up at the front with both hands."""
    g = ctx["g"]
    if not g["run"]:
        return ""
    a = ctx.get("amp", 1.0)
    phi = ctx.get("phase", 0.0)
    for S in "LR":
        sg = 1 if S == "L" else -1
        bob = V(0, 0.015 * math.cos(2 * math.pi * phi) * -sg, 0.01 * math.cos(4 * math.pi * phi))
        p = sk.rest["legUp" + S] + V(0.035 * sg, 0.13, -0.10)
        hold_on_bone(pose, sk, ctx, S, "hips", p, V(0, 0.35, -1), V(-sg * 0.6, -1, 0), V(0.6 * sg, -1, -0.2),
                     shape="fist", wobble=RZ(ctx["yaw"] - ctx["anchorYaw"]) @ bob * a)
    return "LR"


def laden_straps(pose, sk, ctx):
    """A load on the back: both hands on the shoulder straps at the chest."""
    for S in "LR":
        sg = 1 if S == "L" else -1
        p = sk.rest["upperChest"] + V(0.095 * sg, 0.115, 0.05)
        hold_on_bone(pose, sk, ctx, S, "upperChest", p, V(-0.15 * sg, 0.25, 1), V(0, -1, 0), V(0.7 * sg, -0.5, -1),
                     shape="fist", use_grip=False)
    return "LR"


EXTRAS = {"woman": woman_skirt, "laden": laden_straps}


# ---------------------------------------------------------------- loops


def stance_flat(sk, S, f, x, ground=lambda p: 0.0, gpitch=0.0, yaw_=0.0):
    """Where the ankle is when foot S lies flat with its ankle over (x, f) (left, fwd) on the ground."""
    ah = sk.feet[S]["ankle"].z - sk.feet[S]["sole"]
    gp = Vector((x, -f, 0.0))
    gp.z = ground(gp)
    return gp + RZ(yaw_) @ RX(-gpitch) @ Vector((0, 0, ah))


def loop_gait(style, v, sk, ground="flat", g_override=None):
    """The gait numbers a loop is made with (gait() plus the changes, stairs timing, and the cycle and toe off
    rounded to whole frames). Clips that hand over to a loop (start, stop) use the same numbers."""
    g = gait(style, v, sk)
    if g_override:
        g.update(g_override(g) or {})
    stairs = ground in ("stairsUp", "stairsDown")
    if stairs:
        up_ = ground == "stairsUp"
        g.update(STAIR_GAIT["up" if up_ else "down"])
        sl = STAIR["rise"] / STAIR["going"]
        g["T"] = g["stairT"] * (leg_len(sk) / 0.787) ** 0.5
        g["v"] = 2 * STAIR["going"] / g["T"] * math.sqrt(1 + sl * sl)
    # each step a whole number of frames, so both feet are sampled alike
    nstep = max(2, int(round(g["T"] * FPS / 2)))
    g["T"] = 2 * nstep / FPS
    if stairs:
        # stairs: two treads a stride, whatever the rounding did to the cycle
        sl = STAIR["rise"] / STAIR["going"]
        g["v"] = 2 * STAIR["going"] / g["T"] * math.sqrt(1 + sl * sl)
    g["step"] = g["v"] * g["T"] / 2
    T = g["T"]
    v = g["v"]
    # toe off on a whole frame too (a lift between two keys blends a planted and a lifted foot)
    beta = round(g["duty"] * T * FPS) / (T * FPS)
    g["duty"] = beta
    return g


def walk_loop(style, speed, sk, axes, name=None, ground="flat", extra=None, g_override=None):
    """A two-stride loop at `speed` (a name in SPEEDS or m/s) for `style`, in place. ground: "flat", "up", "down"
    (the slope clips) or "stairsUp", "stairsDown"."""
    v = SPEEDS.get(speed, speed) if isinstance(speed, str) else speed
    g = loop_gait(style, v, sk, ground, g_override)
    stairs = ground in ("stairsUp", "stairsDown")
    T, v, beta = g["T"], g["v"], g["duty"]
    D2 = 2 * T
    plan = Plan(sk, 0.0, D2, None, loop=True)
    gpitch = 0.0
    slope = 0.0
    if ground in ("up", "down"):
        gpitch = SLOPE if ground == "up" else -SLOPE
        slope = math.tan(math.radians(gpitch))
        plan.ground = lambda p: -p.y * slope
    if stairs:
        rise, going = STAIR["rise"], STAIR["going"]
        sgn = 1 if ground == "stairsUp" else -1
        slope = sgn * rise / going
        plan.ground = lambda p: sgn * rise * math.floor(-p.y / going + 1e-6)
    vh = v * math.cos(math.atan(slope))

    back = (g["behind"] - 0.06) if stairs else 0.0

    def body(t):
        f = vh * t - back
        return Vector((0.0, -f, f * slope)), 0.0

    plan.body = body
    plan.anchor = body
    dl = g["land"] * vh * beta * T
    hw = g["width"] / 2
    for S, ph in (("L", 0.0), ("R", 0.5)):
        sg = 1 if S == "L" else -1
        for k in range(-3, 5):
            land = (k + ph) * T
            lift = land + beta * T
            if stairs:
                # every step is one tread: the left on even treads, the right on odd ones
                idx = 2 * k + (1 if S == "R" else 0)
                f = (idx * going + 0.06) if sgn > 0 else (idx * going + 0.10)
            else:
                f = vh * land + dl
            yaw_ = sg * g["toeOut"]
            flat = stance_flat(sk, S, f, sg * hw, plan.ground, gpitch, yaw_)
            if stairs:
                flat.z = plan.ground(Vector((0, -f - 0.01, 0))) + sk.feet[S]["ankle"].z - sk.feet[S]["sole"]
            kc, rel_ = knee_curve(land, lift, g, g["run"])
            plan.stances[S].append(Stance(land, lift, flat, yaw_, roll_curve(land, lift, g), kc, rel_, gpitch))
        for i in range(len(plan.stances[S]) - 1):
            a, b = plan.stances[S][i], plan.stances[S][i + 1]
            plan.swings[S][i] = swing_keys(g, plan, S, a, b, stairs and (sgn, rise, going))
    if stairs or ground in ("up", "down"):
        plan.smooth = 0.05

    def layers(t, ctx):
        phi = (t / T) % 1.0
        py, pl, pt, sway, surge = hips_layers(ctx, g, 1.0, phi)
        ctx.update(g=g, phase=phi, amp=1.0, list=pl)
        ctx["breath"] = breath(t, T if g["run"] else D2, g["breath"])
        if ground == "up":
            ctx["lean"] = g["lean"] + 0.6 * SLOPE  # into the slope
        elif ground == "down":
            ctx["lean"] = g["lean"] - 0.3 * SLOPE  # holding back
        if stairs:
            ctx["lookDown"] = 8.0 if sgn > 0 else 14.0  # eyes on the steps
        if style == "old":
            ctx["lookDown"] = 6.0
        # a strong lean tips the pelvis too (the whole trunk leans, not just the back bends)
        hl = hips_share(ctx.get("lean", g["lean"]), g.get("hipsShare", 0.35))
        ctx["hipsLean"] = hl
        return {"hips": yaw(py) @ bow(pt + hl) @ lean(pl), "sway": sway, "surge": surge}

    plan.layers = layers
    plan.upper = make_upper(style, sk, axes, extra or EXTRAS.get(style))
    nm = name or "%s_%s" % (style, speed if isinstance(speed, str) else ("%.2f" % v))
    meta = {"kind": "loop", "style": style, "speed": round(v, 3), "cycle": round(T, 4), "stride": round(vh * T, 4),
            "duty": round(beta, 3), "seconds": round(D2, 4), "strides": 2, "body": STYLES[style]["body"],
            "phase": "left heel strikes at 0 and 0.5, right at 0.25 and 0.75"}
    if ground in ("up", "down"):
        meta["slope"] = gpitch
    if stairs:
        meta["stairs"] = {"rise": STAIR["rise"], "going": STAIR["going"], "up": sgn > 0, "steps": 4,
                          "climb": round(4 * sgn * STAIR["rise"], 3)}
        meta["speed"] = round(vh, 3)
        meta["note"] = "speed is along the ground; the node also climbs rise/going per metre"
    return evaluate(plan, nm, meta), g


def swing_keys(g, plan, S, a, b, stairs=None):
    """The keys of a swing from stance a to stance b."""
    k = {"bow": 0.008 if not g["run"] else 0.004}
    if stairs:
        sgn, rise, going = stairs
        za = a.flat.z
        zb = b.flat.z
        # the foot goes from tread k to tread k+2 over tread k+1 (one rise up or down): it lifts before it reaches
        # forward (the toes clear the next nosing), passes over the middle tread and comes down onto the next
        mid_tread = za + sgn * rise
        fa = -a.flat.y

        def at(f):
            return Vector((0.0, -f, 0.0))

        if sgn > 0:
            k["pts"] = [(0.22, at(fa + 0.03)), (0.5, at(fa + going)), (0.8, at(-b.flat.y - 0.03))]
            k["up"] = [(0.22, za + rise + 0.03), (0.5, mid_tread + 0.13), (0.8, zb + 0.06)]
            k["pitch"] = [(0.22, -4.0), (0.5, -8.0), (0.8, -4.0)]
        else:
            # past the middle tread's nosing before it comes down (the heel would catch it)
            nose = (math.floor(fa / going + 1e-6) + 2) * going
            k["pts"] = [(0.2, at(fa + 0.06)), (0.45, at(fa + going)), (0.68, at(nose + 0.05)), (0.88, at(-b.flat.y - 0.01))]
            k["up"] = [(0.2, za + 0.075), (0.45, mid_tread + 0.12), (0.68, mid_tread + 0.07), (0.88, zb + 0.055)]
            k["pitch"] = [(0.2, -3.0), (0.45, 3.0), (0.68, 8.0), (0.88, 10.0)]
        k["axes"] = (1,)
        k["upWorld"] = True
        k["toe"] = [(0.3, 6.0)]
        return k
    if g["run"]:
        D = b.land - a.lift

        def at_rel(u, f):
            bp, by = plan.body(a.lift + u * D)
            return bp + RZ(by) @ V(0, f, 0)

        k["pts"] = [(0.33, at_rel(0.33, g["kickBack"])), (0.68, at_rel(0.68, g["drive"]))]
        k["axes"] = (1,)
        k["up"] = [(0.33, g["lift"]), (0.68, g["mid"])]
        k["pitch"] = [(0.33, 35.0 if g["heel"] < 0 else 45.0), (0.75, 0.0 if g["heel"] < 0 else 12.0)]
        k["toe"] = [(0.3, 5.0), (0.8, 8.0 if g["heel"] < 0 else 2.0)]
        return k
    k["up"] = [(0.22, g["lift"]), (0.55, g["mid"]), (0.85, g["late"])]
    k["pitch"] = [(0.38, 2.0), (0.72, -6.0)]
    k["toe"] = [(0.25, 4.0), (0.8, 7.0)]
    return k


# ---------------------------------------------------------------- carrying, pushing, pulling

# Where the things are, for the man (man_middling, 1.67 m). Points in the person's words (left, fwd, up) in metres:
# the sack and the crate ride on a bone (they move with the upper body), cart and truck handles are fixed to the
# person's node (the thing rolls along with him). These go to peopleRig.json "locomotion.loads": whoever places the
# sack, crate, handcart or sack truck model puts its handles there.
LOADS = {
    "sack": dict(bone="upperChest", centre=(0.07, -0.01, 0.075), axis="fwd", size=(0.30, 0.86, 0.21), tilt=6.0,
                 grip=(-0.01, 0.40, -0.02), fingers=(0.15, -0.25, 1.0), palm=(0.0, -1.0, 0.1), pole=(0.8, 0.5, -1.0),
                 note="a sack across the left shoulder, its length along the person's forward, the front end 6 degrees "
                      "down; centre given from the left shoulder joint (armUpL head) at rest; size: across, length, "
                      "thickness (the one sack model draped over the shoulder); the left hand's fist holds the bunched "
                      "front end at `grip` from the centre (clips_work's lift and hold end in the same hold)"),
    "crate": dict(bone="chest", centre=(0.0, 0.26, -0.12), size=(0.55, 0.34, 0.42),
                  note="a crate held in front against the belly, both hands under its sides; centre from the chest "
                       "bone's head at rest"),
    "cart_push": dict(handles=[(0.34, 0.36, 0.76), (-0.34, 0.36, 0.76)], axis="fwd",
                      note="the handcart's grips (props.glb handcart: HANDCART_GRIP 0.34 either side, 0.75 m up), the "
                           "cart ahead; grips run forward along the shafts"),
    "cart_pull": dict(handles=[(0.34, -0.06, 0.74), (-0.34, -0.06, 0.74)], axis="fwd",
                      note="the same cart turned round: he walks between the shafts and draws it behind him"),
    "truck_push": dict(handles=[(0.22, 0.44, 0.97), (-0.22, 0.44, 0.97)], axis="back-up",
                       note="a sack truck tipped back toward him (about 45 degrees), wheels ahead, the two handle tips"),
    "truck_pull": dict(handles=[(0.20, -0.24, 0.74), (-0.20, -0.24, 0.74)], axis="fwd-up",
                       note="the sack truck drawn behind him, tipped forward onto its wheels"),
}

CARRIES = {
    # name: speed, gait changes, the upper body's own changes
    "sack": dict(v=1.2, g=dict(step=0.92, lean=6.0, load=4.0, sway=1.15, counter=0.7, armOut=6.0, armSwing=1.25,
                               keep=0.5)),
    "carry": dict(v=1.1, g=dict(step=0.86, lean=-4.0, load=4.0, sway=1.2, counter=0.5, pelvisYaw=0.8)),
    "cart_push": dict(v=1.15, g=dict(hipsShare=0.6, step=0.88, lean=17.0, load=6.0, contactKnee=4.0, counter=0.3, sway=0.8)),
    "cart_pull": dict(v=1.05, g=dict(hipsShare=0.65, step=0.82, lean=23.0, load=7.0, contactKnee=5.0, counter=0.3, sway=0.9)),
    "truck_push": dict(v=1.15, g=dict(step=0.9, lean=7.0, load=4.0, counter=0.4, sway=0.9)),
    "truck_pull": dict(v=1.2, g=dict(step=0.92, lean=8.0, load=4.0, counter=0.4, sway=1.0)),
}


def _g_mods(spec):
    def mod(g):
        out = {}
        for k, x in spec.items():
            if k == "hipsShare":
                out[k] = x
            elif k in ("step", "sway", "counter", "pelvisYaw", "armSwing", "keep"):
                out[k] = g[k] * x
            else:
                out[k] = g[k] + x
        out["T"] = 2 * out.get("step", g["step"]) / g["v"]
        return out
    return mod


def carry_hold(kind, sk):
    """The upper body's holds for a carry kind: returns extra(pose, sk, ctx) -> the sides held."""
    L = LOADS.get(kind)

    def sack(pose, sk_, ctx):
        c = sk.rest["armUpL"] + V(*LOADS["sack"]["centre"])
        ctx["side"] = -4.0  # leaning away from the load
        ctx["look"] = -4.0
        ctx["headTilt"] = -11.0  # the head pressed away from the sack
        S_ = LOADS["sack"]
        grip = c + V(*S_["grip"])
        hold_on_bone(pose, sk, ctx, "L", "upperChest", grip, V(*S_["fingers"]), V(*S_["palm"]), V(*S_["pole"]),
                     shape="grip", use_grip=True)
        # the free arm swings wider, for balance
        ctx["armOutAdd"] = 4.0
        return "L"

    def crate(pose, sk_, ctx):
        c = sk.rest["chest"] + V(*LOADS["crate"]["centre"])
        phi = ctx.get("phase", 0.0)
        bob = V(0, 0, 0.006 * math.cos(4 * math.pi * (phi - 0.1)))
        for S in "LR":
            sg = 1 if S == "L" else -1
            w = c + V(0.29 * sg, -0.03, -0.17)
            hold_on_bone(pose, sk, ctx, S, "chest", w, V(-0.25 * sg, 1.0, -0.15), V(-0.7 * sg, 0.0, 0.7),
                         V(0.9 * sg, -0.6, -0.4), shape="cup", use_grip=False, wobble=bob)
        return "LR"

    def handles(pose, sk_, ctx):
        hs = L["handles"]
        phi = ctx.get("phase", 0.0)
        # the cart rolls on cobbles: the handles tremble a few millimetres at the step's beat
        jig = V(0, 0, 0.004 * math.sin(4 * math.pi * phi + 0.7))
        for (x, f, u), S in zip(hs, "LR"):
            sg = 1 if S == "L" else -1
            p = V(x, f, u) + jig
            if kind == "cart_push":
                fing, palm, pole = V(0, 0.45, -1), V(-sg, 0, 0), V(0.7 * sg, -1, -0.3)
            elif kind == "cart_pull":
                fing, palm, pole = V(0, -0.1, -1), V(-sg, 0, 0), V(0.5 * sg, -1, 0.0)
            elif kind == "truck_push":
                fing, palm, pole = V(-0.25 * sg, 1.0, -0.55), V(-0.4 * sg, 0, -1), V(0.9 * sg, -0.6, -0.6)
            else:
                fing, palm, pole = V(0, -0.3, -1), V(-sg, 0.3, 0), V(0.35 * sg, -1, -0.3)
            hold_in_world(pose, sk, ctx, S, p, fing, palm, pole, shape="grip")
        return "LR"

    return {"sack": sack, "carry": crate}.get(kind, handles)


def carry_loop(kind, sk, axes, name=None):
    spec = CARRIES[kind]
    clip, g = walk_loop("man", spec["v"], sk, axes, name=name or kind, extra=carry_hold(kind, sk),
                        g_override=_g_mods(spec["g"]))
    clip.meta["kind"] = "loop"
    clip.meta["carry"] = kind
    return clip, g


def stand_plan(sk, t1, extra=None, axes=None, lean_=0.0, shift=0.012):
    """Standing with both feet at rest under the body: a slow weight shift (once per loop), breathing."""
    plan = Plan(sk, 0.0, t1, lambda t: (Vector(), 0.0), loop=True)
    for S in "LR":
        flat = sk.feet[S]["ankle"].copy()
        plan.stances[S].append(Stance(-10.0, t1 + 10.0, flat, 0.0, lambda t: 0.0, lambda t: 2.0, t1 + 10.0))
    g = gait("man", 0.9, sk)

    def layers(t, ctx):
        u = t / t1
        ctx.update(g=g, phase=0.0, amp=0.0, list=0.0, lean=lean_ + 1.0)
        ctx["breath"] = breath(t, t1 / 2, 1.2)
        sw = shift * math.sin(2 * math.pi * u)
        hl = hips_share(lean_ + 1.0)
        ctx["hipsLean"] = hl
        return {"hips": bow(hl) @ lean(-1.5 * math.sin(2 * math.pi * u)) @ yaw(0.8 * math.sin(2 * math.pi * u + 0.6)),
                "sway": sw, "surge": 0.0}

    plan.layers = layers
    plan.upper = make_upper("man", sk, axes, extra)
    plan.pad = 0.0
    return plan


def hold_idle(kind, sk, axes, name=None, secs=4.0):
    lean_ = {"sack": 4.0, "carry": -3.0, "cart_push": 10.0, "cart_pull": 8.0, "truck_push": 5.0,
             "truck_pull": 5.0}[kind]
    plan = stand_plan(sk, secs, carry_hold(kind, sk), axes, lean_)
    nm = name or kind + "_idle"
    return evaluate(plan, nm, {"kind": "loop", "carry": kind, "speed": 0.0, "seconds": secs, "body": "man_middling"})


# ---------------------------------------------------------------- start, stop, turn on the spot


def _rest_flat(sk, S, centre=Vector(), yaw_=0.0):
    """Where foot S stands at rest (the bodies' own stance), turned about the body's centre."""
    a = sk.feet[S]["ankle"]
    p = RZ(yaw_) @ Vector((a.x, a.y, 0.0)) + Vector((centre.x, centre.y, 0.0))
    p.z = a.z
    return p


def _from_rest_roll(lift, g, T_stance):
    """A foot that has stood still: flat until its heel rises for the lift (the loop's heel off and toe off)."""
    land = lift - T_stance
    base = roll_curve(land, lift, g)
    t_flat = land + g["flat"] * T_stance
    return lambda t: 0.0 if t < t_flat else base(t)


def _ramp(t, a, b):
    return smoothstep((t - a) / max(1e-6, b - a))


def _bump(t, a, b):
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** 2


def _travel_layers(g, style, amp, phase, psi, t_ref, extra=None):
    D2 = 2 * g["T"]

    def layers(t, ctx):
        a = amp(t)
        phi = phase(t)
        py, pl, pt, sway, surge = hips_layers(ctx, g, a, phi)
        ctx.update(g=g, phase=phi, amp=a, list=pl)
        ctx["breath"] = breath(t - t_ref, D2, g["breath"])
        ctx["lean"] = lerp(1.0, g["lean"], a)
        out = {"sway": sway, "surge": surge}
        if extra:
            extra(t, ctx, out)
        hl = hips_share(ctx["lean"], g.get("hipsShare", 0.35))
        ctx["hipsLean"] = hl
        out["hips"] = yaw(psi(t)) @ yaw(py) @ bow(pt + hl) @ lean(pl)
        return out

    return layers


def _steady(plan, g, sk, S, first_land, t_until, body_at, dl, hw, toe):
    """The loop's own stances for foot S from first_land on (every T), planted where the loop plants them."""
    T, beta = g["T"], g["duty"]
    sg = 1 if S == "L" else -1
    k = 0
    while first_land + k * T < t_until:
        land = first_land + k * T
        lift = land + beta * T
        f = -body_at(land).y + dl
        flat = stance_flat(sk, S, f, sg * hw, plan.ground, 0.0, sg * toe)
        kc, rel_ = knee_curve(land, lift, g, g["run"])
        plan.stances[S].append(Stance(land, lift, flat, sg * toe, roll_curve(land, lift, g), kc, rel_))
        k += 1


def _link_swings(plan, g, sk):
    for S in "LR":
        st = plan.stances[S]
        st.sort(key=lambda s: s.land)
        for i in range(len(st) - 1):
            plan.swings[S][i] = swing_keys(g, plan, S, st[i], st[i + 1])


def _speed_up(v, t_go, t_end):
    """The body's forward position for a smooth start from rest to v between t_go and t_end, then steady."""
    N = 400
    ts = [t_end * i / N for i in range(N + 1)]
    vs = [v * mo.smootherstep(clamp((t - t_go) / (t_end - t_go))) for t in ts]
    xs = [0.0]
    for i in range(1, N + 1):
        xs.append(xs[-1] + 0.5 * (vs[i] + vs[i - 1]) * (ts[i] - ts[i - 1]))
    Dt = xs[-1]

    def fwd(t):
        if t <= 0:
            return 0.0
        if t >= t_end:
            return Dt + v * (t - t_end)
        i = min(N - 1, int(t / t_end * N))
        u = (t - ts[i]) / (ts[i + 1] - ts[i])
        return lerp(xs[i], xs[i + 1], u)

    return fwd, Dt


def start_clip(style, speed, sk, axes, name):
    """From standing (feet at rest) into the loop at `speed`: the weight goes onto the left foot, a short first step
    with the right, a full one with the left; it ends as the left heel strikes, the loop's frame 0, at the loop's
    speed (play the loop from 0 after it, the node moved on by the clip's travel)."""
    v = SPEEDS[speed]
    g = loop_gait(style, v, sk)
    T, beta, v = g["T"], g["duty"], g["v"]
    hw, toe = g["width"] / 2, g["toeOut"]
    dl = g["land"] * v * beta * T
    t_rl = round((0.40 if not g["run"] else 0.36) * FPS) / FPS  # the right foot leaves
    t_r = t_rl + (1 - beta) * T  # and strikes
    t_end = t_r + 0.5 * T  # the left strikes: the loop's frame 0
    fwd, Dt = _speed_up(v, 0.12, t_end)
    body = lambda t: (Vector((0.0, -fwd(t), 0.0)), 0.0)
    plan = Plan(sk, 0.0, t_end, body, loop=False)
    plan.pad = 0.9
    Ts = beta * T
    for S in "LR":
        lift = t_rl if S == "R" else t_end - (1 - beta) * T
        rel_ = 0.22 if S == "R" else (t_r - 0.5 * T + 0.80 * Ts)
        plan.stances[S].append(Stance(-5.0, lift, _rest_flat(sk, S), 0.0, _from_rest_roll(lift, g, Ts),
                                      lambda t: 3.0, rel_))
    # from the first right strike on the feet go where the loop puts them: on its steady line
    line = lambda t: Vector((0.0, -(Dt + v * (t - t_end)), 0.0))
    _steady(plan, g, sk, "R", t_r, t_end + 2.0, line, dl, hw, toe)
    _steady(plan, g, sk, "L", t_end, t_end + 2.0, line, dl, hw, toe)
    _link_swings(plan, g, sk)

    def extra(t, ctx, out):
        # the weight goes over the left foot before the right one leaves; the body tips forward to set off
        out["sway"] = out["sway"] + 0.03 * _bump(t, 0.0, t_rl + 0.3) * (1 - ctx["amp"])
        ctx["lean"] += (3.0 if not g["run"] else 7.0) * _bump(t, 0.1, t_r + 0.25)

    amp = lambda t: _ramp(t, 0.15, t_end)
    phase = lambda t: ((t - t_end) / T) % 1.0
    plan.layers = _travel_layers(g, style, amp, phase, lambda t: 0.0, t_end, extra)
    plan.upper = make_upper(style, sk, axes, EXTRAS.get(style))
    meta = {"kind": "start", "style": style, "speed": round(v, 3), "body": STYLES[style]["body"],
            "seconds": round(plan.t1, 4), "travel": {"fwd": round(Dt, 4), "left": 0.0, "yaw": 0.0},
            "then": "%s_%s" % (style, speed), "note": "ends on the loop's frame 0 (left heel strike)"}
    clip = evaluate(plan, name, meta)
    clip.meta["_travel_vec"] = tuple(V(0, Dt, 0))
    # the last third of a step eases onto the loop itself, so the hand-over is exact
    loop, _ = walk_loop(style, speed, sk, axes, name="_tmp")
    mo.ease_into(clip, loop, len(loop.poses) - 1, max(3, int(0.33 * T * FPS)),
                 offset=lambda i: V(0, Dt - v * i / FPS, 0))
    return clip


def stop_clip(style, speed, sk, axes, name):
    """From the loop at `speed` (its frame 0, left heel strike) to standing: the right foot comes beside the left,
    the body runs on a little past the feet and settles back (overshoot), the arms swing out and still, a last
    small step of the left foot squares the stance (feet at rest)."""
    v = SPEEDS[speed]
    g = loop_gait(style, v, sk)
    T, beta, v = g["T"], g["duty"], g["v"]
    hw, toe = g["width"] / 2, g["toeOut"]
    dl = g["land"] * v * beta * T
    run = g["run"]
    t_rl = (beta - 0.5) * T  # the right foot leaves (as in the loop)
    t_r = round((t_rl + (1 - beta) * T * (1.15 if not run else 1.6)) * FPS) / FPS  # lands beside the left
    t_ll = t_r + 0.18
    t_l = t_ll + 0.34
    t1 = round((t_l + 0.55) * FPS) / FPS
    over = 0.02 if not run else 0.07
    stopf = dl + (0.0 if not run else 0.25)  # where the body comes to rest
    tau = min(2.9 * (stopf + over) / v, t_r + 0.2)
    cf = Curve([(0.0, 0.0, v), (tau, stopf + over, 0.0), (tau + 0.5, stopf, 0.0)])

    def fwd(t):
        if t <= 0:
            return v * t
        if t >= tau + 0.5:
            return stopf
        return cf(t)

    body = lambda t: (Vector((0.0, -fwd(t), 0.0)), 0.0)
    plan = Plan(sk, 0.0, t1, body, loop=False)
    plan.pad = 0.9
    _steady(plan, g, sk, "L", -2 * T, -1e-6, lambda t: body(t)[0], dl, hw, toe)
    _steady(plan, g, sk, "R", -1.5 * T, -1e-6, lambda t: body(t)[0], dl, hw, toe)
    # the left lands at 0 as in the loop, and stays
    lf = stance_flat(sk, "L", dl, hw, plan.ground, 0.0, toe)
    base = roll_curve(0.0, beta * T, g)
    kc, _ = knee_curve(0.0, beta * T, g, run)
    tk = 0.45 * beta * T
    plan.stances["L"].append(Stance(0.0, t_ll, lf, toe,
                                    lambda t: base(t) if t < g["flat"] * beta * T else 0.0,
                                    lambda t: kc(t) if t < tk else lerp(kc(tk), 4.0, _ramp(t, tk, t_r + 0.3)), t_ll))
    rf = _rest_flat(sk, "R", Vector((0.0, -stopf, 0.0)))
    plan.stances["R"].append(Stance(t_r, t1 + 5, rf, 0.0, lambda t: -6.0 * (1 - smoothstep((t - t_r) / 0.12)),
                                    lambda t: lerp(12.0 if not run else 25.0, 3.0, _ramp(t, t_r, t_r + 0.4)), t1 + 5))
    lf2 = _rest_flat(sk, "L", Vector((0.0, -stopf, 0.0)))
    plan.stances["L"].append(Stance(t_l, t1 + 5, lf2, 0.0, lambda t: -3.0 * (1 - smoothstep((t - t_l) / 0.1)),
                                    lambda t: 3.0, t1 + 5))
    _link_swings(plan, g, sk)
    # the squaring step is a shuffle: low and short; the step beside is a walk's, not a run's
    sL = plan.stances["L"]
    iL = next(i for i, s in enumerate(sL) if abs(s.land - t_l) < 1e-6) - 1
    plan.swings["L"][iL] = {"up": [(0.5, 0.115)], "pitch": [(0.5, -2.0)], "toe": [(0.4, 3.0)], "bow": 0.0}
    sR = plan.stances["R"]
    iR = next(i for i, s in enumerate(sR) if abs(s.land - t_r) < 1e-6) - 1
    if run:
        gw = dict(g)
        gw.update(lift=0.30, mid=0.16, late=0.12, run=False)
        plan.swings["R"][iR] = swing_keys(gw, plan, "R", sR[iR], sR[iR + 1])

    def extra(t, ctx, out):
        # the trunk runs on and settles back (overshoot)
        ctx["lean"] += (5.0 if not run else 10.0) * _bump(t, 0.05, tau + 0.4) - 1.5 * _bump(t, tau + 0.2, t1)

    amp = lambda t: 1.0 - _ramp(t, 0.0, t_r + 0.3)
    phase = lambda t: (t / T) % 1.0
    plan.layers = _travel_layers(g, style, amp, phase, lambda t: 0.0, 0.0, extra)
    plan.upper = make_upper(style, sk, axes, EXTRAS.get(style))
    meta = {"kind": "stop", "style": style, "speed": round(v, 3), "body": STYLES[style]["body"],
            "seconds": round(t1, 4), "travel": {"fwd": round(stopf, 4), "left": 0.0, "yaw": 0.0},
            "from": "%s_%s" % (style, speed), "note": "starts on the loop's frame 0 (left heel strike)"}
    clip = evaluate(plan, name, meta)
    clip.meta["_travel_vec"] = tuple(V(0, stopf, 0))
    loop, _ = walk_loop(style, speed, sk, axes, name="_tmp")
    mo.ease_from(clip, loop, 0, max(3, int((0.25 if not run else 0.45) * T * FPS)),
                 offset=lambda i: V(0, v * i / FPS, 0))
    return clip


def turn_clip(style, angle, sk, axes, name):
    """A turn on the spot by `angle` degrees (+ to the left), standing to standing, with stepping feet: the head
    leads (a little past, then back), the chest follows, the pelvis last; the foot on the turning side opens first,
    the other steps round, the first squares up (for 180 degrees a fourth step closes); the arms trail the turn
    and settle."""
    g = gait(style, 0.9, sk)
    g.update(heel=-4.0, flat=0.18, heelOff=0.62, toeOff=14.0, lift=0.12, mid=0.115, late=0.10)
    A = angle
    first = "L" if A > 0 else "R"
    other = "R" if first == "L" else "L"
    if abs(A) > 120:
        steps = [(first, 0.12, 0.46, 0.38), (other, 0.42, 0.79, 0.72), (first, 0.75, 1.12, 1.0), (other, 1.08, 1.42, 1.0)]
        ta, tb, t1 = 0.10, 1.38, 1.83
    else:
        steps = [(first, 0.12, 0.46, 0.6), (other, 0.42, 0.79, 1.0), (first, 0.75, 1.04, 1.0)]
        ta, tb, t1 = 0.10, 0.95, 1.42

    def psi(t):
        return A * smoothstep((t - ta) / (tb - ta))

    body = lambda t: (Vector(), psi(t))
    plan = Plan(sk, 0.0, t1, body, loop=False)
    plan.pad = 0.6
    last = {"L": (-5.0, _rest_flat(sk, "L"), 0.0), "R": (-5.0, _rest_flat(sk, "R"), 0.0)}
    for S, lift, land, share_ in steps:
        l0, flat0, y0 = last[S]
        rl = (lambda lift: (lambda t: 0.0 if t < lift - 0.16 else g["toeOff"] * smoothstep((t - lift + 0.16) / 0.16)))(lift)
        plan.stances[S].append(Stance(l0, lift, flat0, y0, rl, lambda t: 7.0, lift - 0.12))
        yw = A * share_
        last[S] = (land, _rest_flat(sk, S, Vector(), yw), yw)
    for S in "LR":
        l0, flat0, y0 = last[S]
        rl = (lambda l0: (lambda t: -4.0 * (1 - smoothstep((t - l0) / 0.1))))(l0)
        plan.stances[S].append(Stance(l0, t1 + 5, flat0, y0, rl, lambda t: 5.0, t1 + 5))
    for S in "LR":
        plan.stances[S].sort(key=lambda s: s.land)
        for i in range(len(plan.stances[S]) - 1):
            plan.swings[S][i] = {"up": [(0.3, 0.125), (0.7, 0.11)], "pitch": [(0.5, -3.0)], "toe": [(0.4, 3.0)],
                                 "bow": 0.0}
    # the arms trail the turn and settle: a spring on the turning speed
    n = int((t1 + 1.4) * FPS) + 1
    tt = [-0.7 + i / FPS for i in range(n)]
    om = [(psi(t + 0.01) - psi(t - 0.01)) / 0.02 for t in tt]
    omf = mo.follow(om, 1.0 / FPS, freq=1.4, zeta=0.45)
    lagc = Curve(list(zip(tt, omf)))

    def swing_side(t):
        out = 0.0
        for S, lift, land, _ in steps:
            out += (1 if S == "R" else -1) * _bump(t, lift - 0.08, land + 0.05)
        return out

    def extra(t, ctx, out):
        # the weight goes over the standing foot
        out["sway"] = 0.022 * swing_side(t)
        w = lagc(t)
        ctx["armFwd"] = {"L": -0.05 * w, "R": 0.05 * w}
        # the head leads: it looks where the turn goes, a little ahead and a little past
        ctx["look"] = A * mo.overshoot(clamp((t - ta + 0.18) / (tb - ta)), 0.05) - psi(t)
        ctx["chestLead"] = psi(t + 0.1) - psi(t)

    plan.layers = _travel_layers(g, style, lambda t: 0.0, lambda t: 0.0, psi, 0.0, extra)
    up = make_upper(style, sk, axes, EXTRAS.get(style))

    def upper(pose, ctx):
        up(pose, ctx)
        lead_ = ctx.get("chestLead", 0.0)
        for bn, k in (("spine", 0.25), ("chest", 0.35), ("upperChest", 0.4)):
            pose[bn] = yaw(k * lead_) @ pose[bn]
        head(pose, sk, ctx)

    plan.upper = upper
    meta = {"kind": "turn", "style": style, "body": STYLES[style]["body"], "seconds": round(t1, 4),
            "travel": {"fwd": 0.0, "left": 0.0, "yaw": A}, "note": "standing to standing; turn the node by yaw at the end"}
    return evaluate(plan, name, meta)


MOVES = {}
for _st in ("man", "woman"):
    for _sp in ("walk", "run"):
        MOVES["%s_start_%s" % (_st, _sp)] = (lambda st, sp: (lambda sk, axes, nm: start_clip(st, sp, sk, axes, nm)))(_st, _sp)
        MOVES["%s_stop_%s" % (_st, _sp)] = (lambda st, sp: (lambda sk, axes, nm: stop_clip(st, sp, sk, axes, nm)))(_st, _sp)
    for _a, _n in ((90, "turn_l90"), (-90, "turn_r90"), (180, "turn_l180"), (-180, "turn_r180")):
        MOVES["%s_%s" % (_st, _n)] = (lambda st, a: (lambda sk, axes, nm: turn_clip(st, a, sk, axes, nm)))(_st, _a)


# ---------------------------------------------------------------- the speed blend (how the games should mix the loops)


def blend_weight(v, a, b):
    """The weight w of loop b against loop a (neighbours by speed) for a person going at v: the stride and the cycle
    are mixed with the same w, so the feet keep pace with the ground: v = lerp(Sa, Sb, w) / lerp(Ta, Tb, w), S the
    stride (m), T the cycle (s)."""
    Ta, Tb = a.meta["cycle"], b.meta["cycle"]
    Sa, Sb = a.meta["stride"], b.meta["stride"]
    den = v * (Tb - Ta) - (Sb - Sa)
    if abs(den) < 1e-9:
        return 0.0
    return clamp((Sa - v * Ta) / den)


SWITCH = (2.0, 2.4)  # m/s: a walker breaks into a run (and back) as the speed passes the middle of this


def switch_windows(walk, run):
    """Where in a two-stride loop (as a share of it) a walk and a run agree on the feet: the foot that struck at 0
    (or 0.5) is on the ground in both and the other is in the air in both. A gait switch crossfades inside such a
    window: a planted foot moves with the ground in either clip, so the mix cannot slip."""
    bw, br = walk.meta["duty"], run.meta["duty"]
    a = max(0.0, bw - 0.5) / 2 + 0.005  # the walk's other foot has left the ground
    b = br / 2  # the run's foot is still down
    if b <= a:
        return []
    return [(a, b), (0.5 + a, 0.5 + b)]


def _family_pose(fam, v, phase):
    """The pose of one family of loops (walks or runs) at speed v and shared phase: the two neighbours mixed by
    blend_weight; below the slowest or above the fastest the end loop alone (its rate set by the caller).
    Returns (pose, trans, cycle, owner)."""
    if v <= fam[0].meta["speed"] or len(fam) == 1:
        c = fam[0]
        p, t = c.sample(phase * c.seconds)
        return p, t, c.meta["stride"] / max(0.2, v), c
    if v >= fam[-1].meta["speed"]:
        c = fam[-1]
        p, t = c.sample(phase * c.seconds)
        return p, t, c.meta["stride"] / v, c
    k = 0
    while v > fam[k + 1].meta["speed"]:
        k += 1
    a, b = fam[k], fam[k + 1]
    w = blend_weight(v, a, b)
    pa, ta = a.sample(phase * a.seconds)
    pb, tb = b.sample(phase * b.seconds)
    return mo._mix(pa, pb, w), ta.lerp(tb, w), lerp(a.meta["cycle"], b.meta["cycle"], w), (a if w < 0.5 else b)


def blend_by_speed(loops, vfn, seconds, name="blend"):
    """A walker whose speed follows vfn(t) for `seconds`, made by mixing the loops as the games should
    (docs/people.md "Speed blend"): the walks (stroll, walk, hurry) mix among themselves and the runs (run,
    sprint) among themselves, two neighbours by speed with the weight from blend_weight; one shared phase (every
    loop is two strides, left heel at 0) advanced by the mixed cycle; past the end of a family its end loop plays
    faster or slower so its stride keeps pace; between SWITCH[0] and SWITCH[1] the walk crossfades into the run
    (and back). Rotations slerped, hips translations mixed, the node moved at v. Returns a Clip with its root."""
    loops = sorted(loops, key=lambda c: c.meta["speed"])
    walks = [c for c in loops if c.meta["speed"] < 2.5]
    runs = [c for c in loops if c.meta["speed"] >= 2.5]
    sk = loops[0].skel
    n = int(round(seconds * FPS))
    phase = 0.0
    x = 0.0
    poses, trans, roots, owners = [], [], [], []
    wins = switch_windows(walks[-1], runs[0]) if walks and runs else []
    fam = "walk" if walks and vfn(0.0) < sum(SWITCH) / 2 else "run"
    fade = None  # (window start, window end, from family) while switching
    for i in range(n + 1):
        t = i / FPS
        v = vfn(t)
        want = "walk" if (walks and (not runs or v < sum(SWITCH) / 2)) else "run"
        if fade is None and want != fam:
            for a_, b_ in wins:
                if a_ <= phase < b_ - 0.02:
                    fade = (phase, b_, fam)
                    fam = want
                    break
        if fade is not None:
            m = smoothstep((phase - fade[0]) / (fade[1] - fade[0]))
            if phase >= fade[1] or phase < fade[0]:
                fade, m = None, 1.0
        p_new = _family_pose(walks if fam == "walk" else runs, v, phase)
        if fade is not None:
            p_old = _family_pose(walks if fade[2] == "walk" else runs, v, phase)
            p = mo._mix(p_old[0], p_new[0], m)
            tr = p_old[1].lerp(p_new[1], m)
            Tc = lerp(p_old[2], p_new[2], m)
            own = p_old[3] if m < 0.5 else p_new[3]
        else:
            p, tr, Tc, own = p_new
        poses.append(p)
        trans.append(tr)
        roots.append(x)
        owners.append((own, phase))
        phase = (phase + (1.0 / FPS) / (2 * Tc)) % 1.0
        x += v / FPS

    def root(t):
        f = t * FPS
        i = min(n - 1, int(f))
        return Vector((0.0, -lerp(roots[i], roots[i + 1], f - i), 0.0)), 0.0

    def swinging(S):
        def fn(t):
            i = min(n, int(round(t * FPS)))
            c, ph = owners[i]
            return c.meta["_swing"][S](ph * c.seconds)
        return fn

    meta = {"_swing": {S: swinging(S) for S in "LR"}, "_speeds": [vfn(i / FPS) for i in range(n + 1)]}
    return mo.Clip(name, poses, trans, loop=False, meta=meta, root=root, skel=sk)


def hitches(clip):
    """The largest change of turning speed of any bone from one frame to the next (degrees per frame per frame):
    a hitch in a blend shows as a spike above the loops' own."""
    P = clip.poses
    worst, at = 0.0, 0
    for i in range(1, len(P) - 1):
        for bn in KEYED:
            qa, qb, qc = P[i - 1].get(bn, Quaternion()), P[i].get(bn, Quaternion()), P[i + 1].get(bn, Quaternion())
            d1, d2 = qb @ qa.inverted(), qc @ qb.inverted()
            if d1.dot(d2) < 0:
                d2 = -d2
            a_ = math.degrees((Vector(d2.to_exponential_map()) - Vector(d1.to_exponential_map())).length)
            if a_ > worst:
                worst, at = a_, i
    return worst, at


# ---------------------------------------------------------------- the whole set

HOLD_NAMES = {"sack": "sack", "carry": "crate", "cart_push": "cart_push", "cart_pull": "cart_pull",
              "truck_push": "truck_push", "truck_pull": "truck_pull"}


def clip_list(have):
    """Every D1 clip: (name, maker) where maker(sk_for, axes_for) -> Clip. have: the body names built."""
    out = []
    for style, st in STYLES.items():
        if st["body"] not in have:
            continue
        for sp in st["speeds"]:
            out.append(("%s_%s" % (style, sp), st["body"], (lambda style, sp: lambda sk, ax: walk_loop(style, sp, sk, ax, name="%s_%s" % (style, sp))[0])(style, sp)))
    for style in ("man", "woman"):
        body = STYLES[style]["body"]
        if body not in have:
            continue
        for gname, nm in (("up", "slope_up"), ("down", "slope_down"), ("stairsUp", "stairs_up"), ("stairsDown", "stairs_down")):
            out.append(("%s_%s" % (style, nm), body, (lambda style, gname, nm: lambda sk, ax: walk_loop(style, "walk", sk, ax, name="%s_%s" % (style, nm), ground=gname)[0])(style, gname, nm)))
    if "man_middling" in have:
        for kind, nm in HOLD_NAMES.items():
            walk_name = nm + ("_walk" if kind in ("sack", "carry") else "")
            out.append((walk_name, "man_middling", (lambda kind, walk_name: lambda sk, ax: carry_loop(kind, sk, ax, name=walk_name)[0])(kind, walk_name)))
            out.append((nm + "_hold", "man_middling", (lambda kind, nm: lambda sk, ax: hold_idle(kind, sk, ax, name=nm + "_hold"))(kind, nm)))
    for nm, fn in MOVES.items():
        body = STYLES[nm.split("_")[0]]["body"]
        if body in have:
            out.append((nm, body, (lambda fn, nm: lambda sk, ax: fn(sk, ax, nm))(fn, nm)))
    return out


def public_meta(clip):
    m = {k: v for k, v in clip.meta.items() if not k.startswith("_")}
    m["frames"] = clip.frames
    m["loop"] = clip.loop
    return m


def make_all(bodies, target_ao, log=print):
    """Make every D1 clip on its own body, check it, key it on target_ao (the export armature). Returns (actions,
    meta for peopleRig.json, the clips)."""
    from . import clips_legacy as cl_

    by = {b["name"]: b for b in bodies}
    skels = {}

    def skel(name):
        if name not in skels:
            b = by[name]
            skels[name] = (mo.Skel(b["J"], b["lod0"], name), cl_.thumb_axes(b["J"]))
        return skels[name]

    actions, meta, clips = [], {}, []
    loops = {}
    for nm, body, make in clip_list(set(by)):
        sk, ax = skel(body)
        c = make(sk, ax)
        c.name = nm
        sl = mo.slide(c)
        chk = {"slideKeysMm": round(1000 * max(v["keys"] for v in sl.values()), 2),
               "slidePlayedMm": round(1000 * max(v["played"] for v in sl.values()), 2),
               "scuffMm": round(1000 * max(v["scuff"] for v in sl.values()), 2)}
        if c.loop:
            se = mo.seam(c)
            chk["seamDeg"] = round(se["gap"], 4)
            chk["seamJerk"] = round(se["jerk"], 2)
        cle = mo.clearance(c)
        if cle:
            chk["toeClearMm"] = round(1000 * min(cle.values()), 1)
        if c.meta.get("kind") in ("start", "stop"):
            ref = c.meta.get("then") or c.meta.get("from")
            if ref in loops:
                j = mo.joins(c, loops[ref]) if c.meta["kind"] == "start" else mo.joins(loops[ref], c, at_a=0, at_b=0)
                chk["joinDeg"] = round(j["turn"], 4)
                chk["joinMm"] = round(1000 * j["hips"], 2)
        if c.meta.get("kind") == "loop" and "carry" not in c.meta and "slope" not in c.meta and "stairs" not in c.meta:
            loops[nm] = c
        m = public_meta(c)
        m["checks"] = chk
        meta[nm] = m
        log("[people2] move %-18s %3d frames  slide %s mm (played %s), scuff %s mm%s%s" % (
            nm, c.frames, chk["slideKeysMm"], chk["slidePlayedMm"], chk["scuffMm"],
            ", seam %.4f deg" % chk["seamDeg"] if "seamDeg" in chk else "",
            ", joins %.3f deg %.2f mm" % (chk["joinDeg"], chk["joinMm"]) if "joinDeg" in chk else ""))
        actions.append(mo.key_clip(target_ao, c))
        clips.append((c, by[body]))
    return actions, meta, clips


BLEND_RULE = {
    "families": {"walks": ["stroll", "walk", "hurry"], "runs": ["run", "sprint"]},
    "weight": "neighbours by speed a < v < b: w = (Sa - v Ta) / (v (Tb - Ta) - (Sb - Sa)), S = stride, T = cycle "
              "(clip meta); mix rotations by slerp(w) and hips translations by lerp(w)",
    "phase": "one shared phase for all loops (each is two strides, left heel at 0 and 0.5), advanced by dt / (2 T), "
             "T = lerp(Ta, Tb, w)",
    "ends": "below the slowest or above the fastest loop of a family play its end loop at cycle = stride / v",
    "switch": "walk to run (and back) as v passes %.1f m/s: crossfade inside a window where both gaits agree "
              "(clips_move.switch_windows: one foot down in both, the other in the air in both), never held as a mix"
              % (sum(SWITCH) / 2),
    "feet": "lock the planted feet with leg IK every frame (motion.lock_feet does it here): blends move the pose, "
            "not the feet; measured with the lock: under 2 mm",
    "otherBodies": "a clip made on one body plays on another of the same base unchanged; on a smaller or bigger "
                   "body scale its speed and stride by the ratio of the hips heights (peopleRig bodies.<b>.hipsBone)",
}

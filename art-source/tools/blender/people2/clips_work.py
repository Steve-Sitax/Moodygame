"""Work motions for the people2 kit (package D3; docs/people.md "Work").

The old kit's work clips (scrub, lace, rope, grind, wash, row, ride, the rifle, write, beg, call, smoke, wall, cross,
point, crouch, hop, lean, pull, the loads and the handcart) re-authored on the new rig, and the work the players
watch most: a sack lifted from a pile onto the shoulder and set down again, two men passing a sack, a cask rolled, a
rope hauled hand over hand, a fishwife gutting at her table, sweeping, a crane's winch cranked.

Every clip is made on the body of the family that does the work (clips_idle's families) with D2's solver: the
weight puts the hips over the loaded foot, the legs are solved by IK onto planted feet (0 mm at the keys), the trunk
counters the pelvis and breathes, the head leads every look. On top of D2:
- WSpec: a work stance (the feet set wider or staggered for the job), kneeling legs (a knee on the ground), and the
  things the work moves (a sack, a broom, a cask, a rope: `things(t, ctx)`, a matrix each in the node's frame,
  computed from the pose so a sack on the shoulder rides on the shoulder);
- Grip: a fist round a handle, solved so the grip socket (gripL/gripR) holds the handle at its fitted axis
  (peopleRig.json grips: the hand closes round a handle of that radius) and the thumb points along it: the same
  sockets the games hang the tools on;
- the load is felt: the knees and the back give under it, a heavy lift has its pause, its dip and its drive, a
  sack landing on the shoulder sinks the body before it settles.
Loops start and end in the family's own stance where the work allows it (so the runtime's stand lock holds the
feet across fades); the things' tracks go to peopleRig.json "work" (docs/godot-people2.md "Work").
"""

import math
import random

from mathutils import Matrix, Quaternion, Vector

from . import FPS
from . import clips_idle as ci
from . import clips_move as cm
from . import hands as hn
from . import motion as mo
from .motion import RX, RY, RZ, V, bow, clamp, lean, lerp, smootherstep, smoothstep, swing, turn, yaw
from .rig import KEYED

TAU = 2 * math.pi
sgn = ci.sgn

# ---------------------------------------------------------------- the stance of a job


class Stanced:
    """A family with its feet set for a job: base[S] = (left, fwd, yaw) added to the family stance (metres for a
    1.67 m body, degrees). Everything else is the family's."""

    def __init__(self, fam, base):
        self._f = fam
        self._base = base

    def __getattr__(self, k):
        return getattr(self._f, k)

    def base_flat(self, S, off=(0.0, 0.0, 0.0)):
        b = self._base.get(S, (0.0, 0.0, 0.0))
        k = self._f.k
        return self._f.base_flat(S, (off[0] + b[0] * k, off[1] + b[1] * k, off[2] + b[2]))


class WSpec(ci.Spec):
    """A D2 Spec with a work stance and the things the work moves. things(t, ctx) -> {name: Matrix (node frame,
    armature axes)}; ctx["posed"] is the pose of the trunk and the head (the arms come after the things, so the
    hands can be put on them)."""

    def __init__(self, fam, T, loop=True, base=None):
        super().__init__(Stanced(fam, base) if base else fam, T, loop)
        self.things = None
        self.thing_meta = {}


def H(T, start, moves, loop=False, over=0.0):
    """A held signal (ci.Held) that is not a loop by default."""
    return ci.Held(T, start, moves, over=over, loop=loop)


# ---------------------------------------------------------------- one frame (D2's, with things)


def wframe(spec, t, lag=(0.0, 0.0), arms=True):
    """clips_idle.frame with the things: the pose and hips translation at t, and the things' matrices."""
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
            Hs += (loads[S] + 0.05) * ci._height_for(sk, S, xy, qh, a, cm.knee_dist(sk, k))
            ws += loads[S] + 0.05
            Hm = min(Hm, ci._height_for(sk, S, xy, qh, a, cm.knee_dist(sk, 1.5)))
        Hh = min(Hs / ws, Hm) + spec.dz(t)
        hpos = Vector((x, -f, Hh))
    tr = hpos - sk.rest["hips"]
    ctx["trans"] = tr
    ctx["w"] = w
    pose["hips"] = qh
    ps = sk.fk(pose, tr)
    for S in "LR":
        ft = feet[S]
        sg = 1 if S == "L" else -1
        if ft["swing"]:
            ank, rot, toe = ft["ankle"], ft["rot"], ft["toe"]
        else:
            r = ft.get("roll", ft["roll_min"])
            if not sitting and spec.hips_at is None:
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
        if ft.get("pole") is not None:
            pole = ft["pole"]
        elif sitting and spec.seat.get("pole"):
            pole = spec.seat["pole"][S]
        else:
            pole = RZ(ft["yaw"]) @ V(0.10 * sg, 1.0, 0.0)
        sk.leg(pose, S, ank, rot, pole, toe=toe, posed=ps)
    hy_ = 0.0
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
    hyaw, hpit, htil = spec.look(t)
    tgt = RZ(hyaw) @ RX(hpit + st.get("lookDown", 0.0)) @ RY(htil)
    sk.look(pose, tgt, t=tr, keep=spec.keep)
    pose["jaw"] = RX(spec.jaw(t))
    ctx["posed"] = sk.fk(pose, tr)
    things = getattr(spec, "things", None)
    ctx["things"] = things(t, ctx) if things else {}
    for nm, v in list(ctx["things"].items()):
        if not isinstance(v, tuple):
            ctx["things"][nm] = (v, None)
    if arms:
        shapes = {}
        for S in "LR":
            sp = spec.arms.get(S)
            if sp is None:
                sp = ci.Hang()
            shapes[S] = sp.apply(fam, pose, S, ctx)
        for S in "LR":
            ci.set_hand(pose, S, shapes[S], fam.ax)
        late = getattr(spec, "things_late", None)
        if late:
            for nm, v in late(t, ctx, sk.fk(pose, tr)).items():
                ctx["things"][nm] = v if isinstance(v, tuple) else (v, None)
        # the hands on their handles: measured where a grip has settled (not while an arm goes from one to another)
        psf = sk.fk(pose, tr)
        for S in "LR":
            g = settled(spec.arms.get(S), t)
            tg = ctx.get("targets", {}).get((id(g), S)) if g is not None else None
            if tg is not None:
                e = (grip_point(psf, S, tg[1]) - tg[0]).length
                if e > ctx.get("gripErr", 0.0):
                    ctx["gripErr"], ctx["gripAt"] = e, (S, round(t, 2))
            elif isinstance(g, ci.Place):
                e = place_error(g, fam, psf, S, ctx)
                if e > ctx.get("reachErr", 0.0):
                    ctx["reachErr"], ctx["reachAt"] = e, (S, round(t, 2))
    return pose, tr, ctx


def place_error(g, fam, ps, S, ctx):
    """How far a settled palm (or wrist) place is from its target (an arm that cannot reach)."""
    at = g._get(g.at, fam, S, ctx)
    bone = g.bone(S) if callable(g.bone) else g.bone
    p = Vector(at) if bone is None else ps.point(bone, at)
    if g.wob is not None:
        Db = Quaternion() if bone is None else ps.D[bone]
        p = p + Db @ g.wob(ctx["t"], S)
    now = ps.P["hand" + S] if g.wrist else ps.P["hand" + S] + ps.D["hand" + S] @ fam.palm[S]
    return (now - p).length


def settled(sp, t):
    """The arm spec in full charge at t (None while an ArmTrack goes from one pose to the next)."""
    if isinstance(sp, ci.ArmTrack):
        a, b, since, dur, over = sp.at(t)
        return b if (since >= dur + 0.12 or a is b) else None
    return sp


def wevaluate(spec, name, meta=None):
    """The Clip of a WSpec (ci.evaluate with the things): meta["_things"] holds every frame's things."""
    n = int(round(spec.T * FPS))
    T = n / FPS
    spec.T = T
    fam = spec.fam
    if spec.loop:
        spec.breath_T = T / max(1, round(T / spec.breath_T))
    path = []
    for i in range(n + 1):
        _, tr, _ = wframe(spec, i / FPS, arms=False)
        path.append(Vector(tr))
    px = [p.x for p in path]
    py = [p.y for p in path]
    fx = mo.follow(px, 1.0 / FPS, freq=0.9, zeta=0.45, periodic=spec.loop)
    fy = mo.follow(py, 1.0 / FPS, freq=0.9, zeta=0.45, periodic=spec.loop)
    lag = [(ci.LAG_GAIN * (fx[i] - px[i]), -ci.LAG_GAIN * (fy[i] - py[i])) for i in range(n + 1)]
    poses, trans, things, grips, reach = [], [], [], [], []
    for i in range(n + 1):
        pose, tr, ctx = wframe(spec, i / FPS, lag=lag[i])
        mo.shoulder_helpers(pose)
        poses.append(pose)
        trans.append(tr)
        things.append(ctx["things"])
        grips.append((ctx.get("gripErr", 0.0), ctx.get("gripAt")))
        reach.append((ctx.get("reachErr", 0.0), ctx.get("reachAt")))
    if spec.loop:
        poses[-1] = dict(poses[0])
        trans[-1] = trans[0].copy()
        things[-1] = dict(things[0])
    m = dict(meta or {})
    m.setdefault("body", fam.body)
    m["seconds"] = round(T, 4)
    m["_swing"] = {S: spec.swinging(S) for S in "LR"}
    m["_things"] = things
    m["_thingMeta"] = dict(getattr(spec, "thing_meta", {}) or {})
    g_ = max(grips, key=lambda x: x[0]) if grips else (0.0, None)
    r_ = max(reach, key=lambda x: x[0]) if reach else (0.0, None)
    m["_gripErr"], m["_gripAt"] = g_
    m["_reachErr"], m["_reachAt"] = r_
    m["_kneel"] = getattr(spec, "kneel_points", None)
    return mo.Clip(name, poses, trans, loop=spec.loop, meta=m, skel=fam.sk)


# ---------------------------------------------------------------- grips: a fist round a handle

GRIP_PALM, GRIP_UP = -0.003, -0.010  # the handle sits below MakeHuman's knuckles, clear of the palm pads
_SHAPES = {}


def grip_shape(fam, S, r):
    """The hand closed round a handle of radius r (the fitted curls of hands.grip_fit, the thumb over the fingers
    as far as it closes without entering the handle: peopleRig.json grips)."""
    key = (fam.body, S, round(r, 4))
    if key not in _SHAPES:
        fit = hn.grip_fit(fam.J, fam.P, S, r, GRIP_PALM - r, up=GRIP_UP,
                          fingers=("index", "middle", "ring"), max_deg=(62.0, 80.0, 32.0))
        k = 1.0 if r <= 0.016 else max(-0.6, lerp(1.0, -0.3, (r - 0.016) / 0.004))
        a = (30 + 300 * (0.02 - r)) * k
        m = (28 + 400 * (0.02 - r)) * k
        i = (24 + 300 * (0.02 - r)) * k
        shape = {"index": tuple(fit["index"][0]), "middle": tuple(fit["middle"][0]),
                 "ring": tuple(fit["ring"][0]), "thumb": (a, m, i)}
        _SHAPES[key] = mo.fit_grip_surface(fam, S, r, GRIP_PALM - r, GRIP_UP, shape)
    return dict(_SHAPES[key])


def axis_at(S, r):
    """Where a handle of radius r runs through the fist, in the grip socket's own frame (peopleRig grips axisAt)."""
    return Vector(((r - GRIP_PALM) if S == "L" else -(r - GRIP_PALM), 0.0, GRIP_UP))


def grip_rot(sk, S, axis, wrist):
    """The hand's global turn (pose convention) that lays the grip socket's +y (the thumb's way along the handle)
    on `axis` and its +z (toward the wrist) toward `wrist`."""
    a = Vector(axis).normalized()
    w = Vector(wrist)
    w = (w - a * w.dot(a))
    if w.length < 1e-6:
        w = Vector((0, 0, 1)) - a * a.z
    w.normalize()
    Mt = Matrix((a.cross(w), a, w)).transposed()
    G = sk.restq["grip" + S].to_matrix()
    return (Mt @ G.inverted()).to_quaternion()


def grip_point(ps, S, r):
    """Where the handle's axis runs through the posed fist (armature axes)."""
    sk = ps.skel
    return ps.P["grip" + S] + ps.D["grip" + S] @ (sk.restq["grip" + S] @ axis_at(S, r))


class Grip:
    """Hand S closed round a handle: handle(fam, S, ctx) -> (a point on the handle's axis, the axis (the thumb's
    way), the wrist's side) in armature axes; pole: where the elbow goes; r: the handle's radius."""

    def __init__(self, handle, pole, r=0.016, clav=None, shape=None):
        self.handle, self.pole, self.r, self.clav, self.shape = handle, pole, r, clav, shape

    def _get(self, v, fam, S, ctx):
        return v(fam, S, ctx) if callable(v) else v

    def apply(self, fam, pose, S, ctx):
        sk = fam.sk
        P, a, w = self.handle(fam, S, ctx)
        rot = grip_rot(sk, S, a, w)
        off = rot @ (sk.restq["grip" + S] @ axis_at(S, self.r))
        target = Vector(P) - off
        pole = self._get(self.pole, fam, S, ctx)
        clav = self._get(self.clav, fam, S, ctx)
        sk.hold(pose, S, target, rot, pole, t=ctx["trans"], clav=clav)
        ci.limit_twist(pose, S)
        # Limiting wrist twist changes the grasp point by several centimetres. Keep that
        # comfortable wrist orientation, then solve its position again onto the handle.
        actual = sk.fk(pose, ctx["trans"]).D["hand" + S]
        wrist = Vector(P) - actual @ (sk.rest["grip" + S] - sk.rest["hand" + S] +
                                      sk.restq["grip" + S] @ axis_at(S, self.r))
        if clav is None:
            pose["clavicle" + S] = Quaternion()
            pose["clavicle" + S] = mo.clavicle_for(sk.fk(pose, ctx["trans"]), S, wrist)
        sk.arm(pose, S, wrist, actual, pole, t=ctx["trans"])
        ctx.setdefault("targets", {})[(id(self), S)] = (Vector(P), self.r)
        sh = self._get(self.shape, fam, S, ctx) if self.shape is not None else None
        if isinstance(sh, str):
            return ci.shape_of(sh)
        return sh or grip_shape(fam, S, self.r)


class Palm(ci.Place):
    """A palm on a point given in the node's frame (bone None): pushing, pressing, propping."""

    def __init__(self, at, fingers, palm, pole, shape="open", hand=None, clav=None):
        super().__init__(at, fingers, palm, pole, shape=shape, bone=None, clav=clav, hand=hand)


# ---------------------------------------------------------------- matrices of things

C_GAME = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))  # Blender armature axes -> game axes


def M(pos, rot=None):
    m = (rot or Quaternion()).to_matrix().to_4x4()
    m.translation = Vector(pos)
    return m


def mix(a, b, w):
    """Two matrices mixed: positions by lerp, turns by slerp."""
    pa, pb = a.to_translation(), b.to_translation()
    qa, qb = a.to_quaternion(), b.to_quaternion()
    if qa.dot(qb) < 0:
        qb = -qb
    return M(pa.lerp(pb, w), qa.slerp(qb, w))


def on_bone(ps, bone, rest_pos, rest_rot):
    """A thing carried by a bone: its rest place and turn (armature axes) as the bone now has them."""
    return M(ps.point(bone, rest_pos), ps.D[bone] @ rest_rot)


def to_game(m):
    """A thing's matrix (armature axes; its own frame x length, y across, z up) to game axes on both sides: the
    node's frame in game axes and the thing's own frame as a game model has it (x length, y up, z across).
    Returns (position, quaternion x, y, z, w)."""
    p = C_GAME @ m.to_translation()
    R = C_GAME @ m.to_3x3() @ C_GAME.transposed()
    q = R.to_quaternion()
    return [round(p.x, 4), round(p.y, 4), round(p.z, 4)], [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)]


def local_game(m):
    """A thing's matrix relative to a bone (the bone's own frame is the same in Blender and in the game) with the
    thing's own frame turned to a game model's (x length, y up, z across)."""
    p = m.to_translation()
    R = m.to_3x3() @ C_GAME.transposed()
    q = R.to_quaternion()
    return [round(p.x, 4), round(p.y, 4), round(p.z, 4)], [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)]


# ---------------------------------------------------------------- the sack (one model everywhere: docs/sacks.md)

# The sack's own frame: x along its length, y across it, z up through it, the middle at the origin. A full sack of
# coffee or grain (60-70 kg) lying on a pile, and the same sack draped over a shoulder (narrower and flatter: it
# folds over the shoulder). The game's one sack model is scaled to these per frame (docs/godot-people2.md "Work").
SACK = {"length": 0.86, "width": 0.44, "thick": 0.26}
SACK_LYING = (0.86, 0.44, 0.26)
SACK_EAR = 0.40  # the ears (the bunched corners) along x


def sack_on_shoulder_size():
    s = cm.LOADS["sack"]["size"]  # across, length, thickness
    return (s[1], s[0], s[2])


def sack_ear(S_end, near=True):
    """The near top corner of a sack lying across: S_end "L" the end at +x (+y is the near side)."""
    return Vector(((1 if S_end == "L" else -1) * SACK_EAR, 0.17 if near else -0.17, 0.07))


def shoulder_sack(fam):
    """Where the sack rides on the left shoulder (rest armature axes, carried by upperChest): its middle and its
    turn (x, its length, from the front to the back: the end that was at +x on the pile goes behind; the front end
    a little down). D1's carry clips (locomotion.loads.sack) use the same place and the same hold of the front
    end, so a lift hands over to the hold and the walk with the sack where it is."""
    L_ = cm.LOADS["sack"]
    c = fam.sk.rest["armUpL"] + V(*L_["centre"]) * fam.k
    return c, RX(L_["tilt"]) @ yaw(90.0)


def sack_shoulder_m(fam, ps):
    c, q = shoulder_sack(fam)
    return on_bone(ps, "upperChest", c, q)


class SackFront:
    """The left fist round the bunched front end of the sack on the left shoulder (the hold of D1's carry clips)."""

    def apply(self, fam, pose, S, ctx):
        L_ = cm.LOADS["sack"]
        sk, k = fam.sk, fam.k
        ps = sk.fk(pose, ctx["trans"])
        c = sk.rest["armUpL"] + V(*L_["centre"]) * k
        p = ps.point("upperChest", c + V(*L_["grip"]) * k)
        rot = ps.D["upperChest"] @ cm.hand_aim(S, V(*L_["fingers"]), V(*L_["palm"]))
        sk.hold(pose, S, p, rot, V(*L_["pole"]), t=ctx["trans"])
        ci.limit_twist(pose, S)
        contact = p + rot @ (sk.restq["grip" + S] @ axis_at(S, 0.022))
        actual = sk.fk(pose, ctx["trans"]).D["hand" + S]
        wrist = contact - actual @ (sk.rest["grip" + S] - sk.rest["hand" + S] +
                                    sk.restq["grip" + S] @ axis_at(S, 0.022))
        sk.arm(pose, S, wrist, actual, V(*L_["pole"]), t=ctx["trans"])
        ctx.setdefault("targets", {})[(id(self), S)] = (contact, 0.022)
        return grip_shape(fam, S, 0.022)


def sized(m, size):
    return (m, tuple(size))


def lerp3(a, b, w):
    return tuple(x + (y - x) * w for x, y in zip(a, b))


def ear_grip(S_end, pole, near=True, r=0.024):
    """A fist on a sack's ear (thing "sack"): the thumbs point inward along the sack's edge, the wrist above it and
    toward the body."""

    def handle(fam_, S, ctx):
        m = ctx["things"]["sack"][0]
        R = m.to_3x3()
        sg = 1 if S_end == "L" else -1
        p = m @ sack_ear(S_end, near)
        return p, R @ Vector((-sg, 0.0, 0.0)), ctx["posed"].P["armUp" + S] - p

    return Grip(handle, pole, r=r)


def heading_of(ps):
    """The pelvis's heading (a turn about the vertical) and its forward on the ground."""
    fy = ps.D["hips"] @ V(0, 1, 0)
    fy = Vector((fy.x, fy.y, 0.0)).normalized()
    return Quaternion(Vector((0, 0, 1)), math.atan2(fy.x, -fy.y)), fy


# ---------------------------------------------------------------- the sack: off the pile onto the shoulder

LIFT = {
    # the sack's middle on the pile: fwd, up (m, 1.67 m body); the bend; the times (bend, set, rise, dip, drive, land,
    # step); draw: how far the sack is drawn toward him over the pile's edge before it comes into his arms
    "low": dict(fwd=0.47, up=0.34, dz=-0.48, back=-0.10, hb=18.0, tb=14.0, look=34.0, draw=0.0, u0=0.0,
                times=(0.2, 1.05, 1.65, 2.35, 2.65, 3.08, 3.70), T=4.6),
    "high": dict(fwd=0.52, up=0.86, dz=-0.06, back=0.0, hb=8.0, tb=16.0, look=26.0, draw=0.17, u0=0.55,
                 times=(0.15, 0.62, 1.15, 1.72, 1.96, 2.32, 2.9), T=3.7),
}


def _sack_props(fwd, up, k, depth=0.62, width=1.0, near=0.2):
    top = (up - SACK["thick"] / 2) * k
    return [("box", M(V(0.0, fwd * k + depth / 2 - near, top / 2)), (width, depth, top), "pile")], top


def sack_lift(fam, kind="low", seed=301):
    """A docker takes a sack off a pile onto his left shoulder. He stands at the pile, the right foot back; for a low
    pile he squats with a flat back (the hips back and down, the knees over the toes), for a pile at his waist he
    leans in; he takes the near ears and takes the strain (the body sinks a little more, the shoulders draw
    down); from the waist-high pile he draws the sack toward him until it tips off the edge into his arms. He rises
    with it hanging from straight arms and rolls it up against his belly, dips at the knees and drives up, swinging
    it up and over onto the left shoulder (it turns a quarter: the end that was at his left goes behind), the head
    ducking away to the right, the left hand riding up with its ear; the body gives under the sack as it lands and
    settles; the left hand takes the front end, the right steadies it and lets go; he steps up into his stance with
    the load (hands over to sack_hold and to D1's sack_walk)."""
    L = LIFT[kind]
    k = fam.k
    T = L["T"]
    base = {"L": (0.06, 0.02, 6.0), "R": (-0.05, -0.15, -10.0)}
    sp = WSpec(fam, T, loop=False, base=base)
    tb0, ts0, tr0, td0, tv0, tl0, tq0 = L["times"]
    tr1, td1, tv1, tq1 = td0, tv0, tl0, tq0 + 0.4
    tdr0 = ts0 + 0.12  # (waist-high) the draw over the edge
    dz0 = L["dz"] * k
    sp.dz = H(T, 0.0, [(tb0, ts0 - tb0, dz0), (ts0, 0.32, dz0 - 0.025 * k), (tr0, tr1 - tr0, -0.035 * k),
                       (td0, td1 - td0, -0.12 * k), (tv0, 0.26, 0.004 * k), (tl0, 0.16, -0.08 * k),
                       (tl0 + 0.16, 0.5, -0.03 * k), (tq0, tq1 - tq0, -0.02 * k)])
    sp.fwd = H(T, 0.0, [(tb0, ts0 - tb0, L["back"] * k), (tr0, tr1 - tr0, -0.01 * k), (tv0, 0.3, 0.02 * k),
                        (tl0, 0.5, 0.0)])
    hb = H(T, 0.0, [(tb0, ts0 - tb0, L["hb"]), (ts0, 0.32, L["hb"] + 2.0), (tr0, tr1 - tr0, 4.0),
                    (td0, td1 - td0, 9.0), (tv0, 0.3, -4.0), (tl0, 0.4, 4.0)])
    sp.hips = lambda t: (0.0, hb(t), 0.0)
    tb = H(T, 0.0, [(tb0, ts0 - tb0, L["tb"]), (ts0, 0.32, L["tb"] + 4.0), (tr0, tr1 - tr0, -7.0),
                    (td0, td1 - td0, -2.0), (tv0, 0.3, -9.0), (tl0, 0.35, 8.0), (tl0 + 0.5, 0.6, 5.0)])
    tsd = H(T, 0.0, [(tv0 - 0.05, 0.3, -9.0), (tl0, 0.4, -5.0), (tq0, 0.5, -4.0)])
    tw = H(T, 0.0, [(td0, 0.3, 6.0), (tv0, 0.3, 14.0), (tl0, 0.45, 0.0)])
    sp.trunk = lambda t: (tb(t), tsd(t), tw(t))
    sp.knees = (4.0, 15.0)
    sp.weight = H(T, 0.5, [(tb0, 0.6, 0.47), (tv0, 0.3, 0.62), (tl0, 0.3, 0.6), (tq0 - 0.1, 0.25, 0.72),
                           (tq1, 0.3, 0.55)])
    yw = H(T, 0.0, [(tv0 - 0.05, 0.25, -12.0), (tl0 + 0.1, 0.5, -4.0)])
    pt = H(T, 6.0, [(0.0, 0.4, L["look"]), (tb0 + 0.5, 0.5, L["look"] - 14.0), (tr0, 0.6, 4.0), (tv0, 0.25, -5.0),
                    (tl0, 0.4, 3.0)])
    tl = H(T, 0.0, [(tv0 - 0.05, 0.25, -16.0), (tl0 + 0.15, 0.4, -11.0)])
    sp.look = lambda t: (yw(t), pt(t), tl(t))
    sp.keep = 0.45
    sp.lead = 0.1
    sp.breath_amp = 1.4
    sp.breath_T = 3.3
    sp.jaw = lambda t: 0.6 + 4.0 * ci.pulse(t, tv0 - 0.1, tv1 + 0.05, 0.08, 0.2)
    sp.steps["R"] = [(tq0, tq1, (0.05 * k, 0.15 * k, 10.0))]
    sp.steps["L"] = [(tq1 + 0.02, tq1 + 0.32, (-0.06 * k, -0.02 * k, -6.0))]
    pile = M(V(0.0, L["fwd"] * k, L["up"] * k))
    lying, draped = SACK_LYING, sack_on_shoulder_size()

    def drawn(t):
        if L["draw"] <= 0:
            return pile
        u = smootherstep((t - tdr0) / (tr0 - tdr0))
        return M(V(0.0, (L["fwd"] - L["draw"] * u) * k, L["up"] * k), RX(-8.0 * u))

    def held(ctx, t):
        # the ears' middle hangs from the shoulders on straight arms, then comes up to the belly; the sack level
        # with the pelvis's heading, rolled toward the body as it hangs from the ears
        ps = ctx["posed"]
        mid = (ps.P["armUpL"] + ps.P["armUpR"]) / 2
        heading, fy = heading_of(ps)
        u = lerp(L["u0"], 1.0, smootherstep((t - tr0) / (tr1 - tr0)))
        down = lerp(0.57, 0.43, u) * k
        out = lerp(0.24, 0.20, u) * k
        R = heading @ RX(lerp(14.0, 55.0, u))
        ears = mid - Vector((0, 0, down)) + fy * out
        return M(ears - R @ Vector((0.0, 0.17, 0.07)), R)

    def things(t, ctx):
        ps = ctx["posed"]
        if t <= tr0:
            return {"sack": sized(drawn(t), lying)}
        if t <= tv0:
            w = smootherstep((t - tr0) / 0.45)
            return {"sack": sized(mix(drawn(tr0), held(ctx, t), w), lying)}
        u = clamp((t - tv0) / (tl0 + 0.06 - tv0))
        w = smootherstep(u)
        m = mix(held(ctx, t), sack_shoulder_m(fam, ps), w)
        if 0 < u < 1:
            m.translation = m.translation + Vector((0.03 * k, 0.0, 0.12 * k)) * math.sin(math.pi * u)
        return {"sack": sized(m, lerp3(lying, draped, smoothstep((u - 0.3) / 0.7)))}

    sp.things = things
    sp.thing_meta = {"sack": {"model": "sack", "then": "upperChest"}}
    gL = ear_grip("L", lambda f, S, c: V(1.0, -0.6, -0.2))
    gR = ear_grip("R", lambda f, S, c: V(-1.0, -0.6, -0.2))

    def front_under(fam_, S, ctx):
        # under the front end on the shoulder (the right hand steadies it before it lets go)
        return ctx["things"]["sack"][0] @ Vector((-0.26, 0.04, -0.11))

    steady = Palm(front_under, lambda f, S, c: V(0.7, 0.5, 0.2), lambda f, S, c: V(0.0, 0.0, 1.0),
                  lambda f, S, c: V(-1.0, -0.5, -0.6), shape="cup")
    # the left hand rides up with its ear and lets go as the sack lands: out and round, under the front end
    out = ci.Hang(fwd=30.0, out=38.0, elbow=70.0, twist=-10.0, hand=10.0)
    sp.arms = {
        "L": ci.ArmTrack([(0.0, ci.Hang(), 0.3), (tb0 + 0.18, gL, ts0 - tb0 - 0.05),
                          (tl0 + 0.08, SackFront(), 0.36)], 1e9, loop=False),
        "R": ci.ArmTrack([(0.0, ci.Hang(), 0.3), (tb0 + 0.22, gR, ts0 - tb0 - 0.07), (tl0 + 0.12, steady, 0.3),
                          (tl0 + 0.62, ci.Hang(out=9.0, elbow=10.0), 0.6)], 1e9, loop=False),
    }
    props, top = _sack_props(L["fwd"], L["up"], k, near=0.2 if kind == "low" else 0.17)
    sp.meta = {"work": "sack_lift", "pile": kind, "pileTop": round(top, 3), "pileFwd": round(L["fwd"] * k, 3),
               "view": "low" if kind == "low" else "stand", "_props": props, "seq": True}
    return sp


def sack_hold(fam, T=6.0, seed=311):
    """Standing with the sack on the left shoulder in the family's stance: the left hand on its front end, the
    right arm hanging, the head held away from it, the weight shifting under it, breathing deeper."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    sp.things = lambda t, ctx: {"sack": sized(sack_shoulder_m(fam, ctx["posed"]), sack_on_shoulder_size())}
    sp.thing_meta = {"sack": {"model": "sack", "attach": "upperChest", "size": list(sack_on_shoulder_size())}}
    sp.weight = ci.weights(T, [(0.6, 1.4, 0.64), (3.4, 1.6, 0.44), (5.2, 0.7, 0.5)])
    dr = ci.drift(T, seed, 0.8)
    sp.trunk = lambda t: (5.0 + dr(t), -4.0, 0.0)
    sp.dz = lambda t: -0.02 * k
    base_look = ci.look(T, [(1.6, 0.8, -10.0, 2.0, 0.0), (3.6, 0.9, 4.0, 1.0, 1.0), (5.0, 0.6, 0.0, 0.0, 0.0)],
                        seed=seed, drift_deg=1.0)
    sp.look = lambda t: (base_look(t)[0], base_look(t)[1], base_look(t)[2] - 11.0)
    sp.breath_amp = 1.4
    sp.breath_T = 3.0
    sp.arms = {"L": SackFront(), "R": ci.Hang(out=9.0, elbow=10.0)}
    sp.meta = {"work": "sack_hold"}
    return sp


def sack_down(fam, T=3.7, seed=321, top=0.30):
    """Setting the sack down from the left shoulder onto a pile or the ground before him: the right hand comes up
    under its front end, he steps the right foot back, dips and tips the sack forward off the shoulder into both
    hands (the ears), lowers it with a squat (a flat back, the hips back) onto the pile, lets go and straightens
    up, stepping back into his stance."""
    k = fam.k
    sp = WSpec(fam, T, loop=False)
    # starts in the family stance: the stagger is stepped into first, and stepped out of at the end
    sp.steps["R"] = [(0.1, 0.45, (-0.05 * k, -0.15 * k, -10.0)), (3.0, 3.35, (0.0, 0.0, 0.0))]
    sp.steps["L"] = [(0.45, 0.7, (0.06 * k, 0.02 * k, 6.0)), (3.36, 3.62, (0.0, 0.0, 0.0))]
    tt0, tt1 = 0.6, 1.2      # tip it forward off the shoulder into the hands
    tlo0, tlo1 = 1.2, 2.1    # lower it
    tr0 = 2.2                # let go
    tu0, tu1 = 2.35, 3.0     # up
    fwd, up = 0.48, top + 0.13
    sp.dz = H(T, -0.02 * k, [(0.5, 0.35, -0.08 * k), (tt0 + 0.3, 0.35, -0.05 * k), (tlo0, tlo1 - tlo0, -0.40 * k),
                             (tu0, tu1 - tu0, 0.0)])
    sp.fwd = H(T, 0.0, [(tlo0, tlo1 - tlo0, -0.14 * k), (tu0, tu1 - tu0, 0.0)])
    hb = H(T, 0.0, [(tt0, 0.5, 4.0), (tlo0, tlo1 - tlo0, 25.0), (tu0, tu1 - tu0, 0.0)])
    sp.hips = lambda t: (0.0, hb(t), 0.0)
    tb = H(T, 5.0, [(tt0, 0.5, 10.0), (tlo0, tlo1 - tlo0, 20.0), (tu0, tu1 - tu0, 0.0)])
    tsd = H(T, -4.0, [(tt0, 0.45, 6.0), (tlo0, 0.5, 0.0)])
    tw = H(T, 0.0, [(0.3, 0.4, 10.0), (tt0, 0.5, -6.0), (tlo0, 0.5, 0.0)])
    sp.trunk = lambda t: (tb(t), tsd(t), tw(t))
    sp.weight = H(T, 0.5, [(0.0, 0.1, 0.5), (0.2, 0.3, 0.68), (0.5, 0.3, 0.5), (tlo0, 0.8, 0.48), (3.0, 0.3, 0.5)])
    pt = H(T, 0.0, [(0.3, 0.4, 12.0), (tt0, 0.5, 30.0), (tu0, 0.6, 4.0), (3.0, 0.4, 0.0)])
    tl = H(T, -11.0, [(tt0, 0.5, 0.0)])
    sp.look = lambda t: (0.0, pt(t), tl(t))
    sp.keep = 0.45
    sp.knees = (4.0, 15.0)
    target = M(V(0.0, fwd * k, up * k))
    lying, draped = SACK_LYING, sack_on_shoulder_size()

    def in_hands(ctx, t):
        ps = ctx["posed"]
        mid = (ps.P["armUpL"] + ps.P["armUpR"]) / 2
        heading, fy = heading_of(ps)
        R = heading @ RX(40.0)
        ears = mid - Vector((0, 0, 0.45 * k)) + fy * 0.22 * k
        return M(ears - R @ Vector((0.0, 0.17, 0.07)), R)

    def things(t, ctx):
        ps = ctx["posed"]
        if t <= tt0:
            return {"sack": sized(sack_shoulder_m(fam, ps), draped)}
        if t <= tt1:
            u = (t - tt0) / (tt1 - tt0)
            w = smootherstep(u)
            m = mix(sack_shoulder_m(fam, ps), in_hands(ctx, t), w)
            m.translation = m.translation + Vector((0.0, 0.0, 0.07 * k)) * math.sin(math.pi * u)
            return {"sack": sized(m, lerp3(draped, lying, smoothstep(u / 0.7)))}
        if t <= tr0:
            u = smootherstep((t - tlo0) / (tlo1 - tlo0)) if t > tlo0 else 0.0
            return {"sack": sized(mix(in_hands(ctx, t), target, u), lying)}
        return {"sack": sized(target, lying)}

    sp.things = things
    sp.thing_meta = {"sack": {"model": "sack", "from": "upperChest", "then": "left"}}
    gL = ear_grip("L", lambda f, S, c: V(1.0, -0.6, -0.2))
    gR = ear_grip("R", lambda f, S, c: V(-1.0, -0.6, -0.2))

    def under_front(fam_, S, ctx):
        return ctx["things"]["sack"][0] @ Vector((-0.20, 0.0, -0.11))

    lift = Palm(under_front, lambda f, S, c: V(0.6, 0.6, 0.3), lambda f, S, c: V(0.0, 0.0, 1.0),
                lambda f, S, c: V(-1.0, -0.4, -0.6), shape="cup")
    sp.arms = {
        "L": ci.ArmTrack([(0.0, SackFront(), 0.3), (tt0 + 0.25, gL, 0.4), (tr0, ci.Hang(), 0.6)], 1e9, loop=False),
        "R": ci.ArmTrack([(0.0, ci.Hang(out=9.0, elbow=10.0), 0.3), (0.3, lift, 0.4), (tt0 + 0.3, gR, 0.4),
                          (tr0 + 0.05, ci.Hang(), 0.6)], 1e9, loop=False),
    }
    props, tp = _sack_props(fwd, up, k)
    sp.meta = {"work": "sack_down", "pileTop": round(tp, 3), "view": "low", "_props": props}
    return sp


# ---------------------------------------------------------------- two men passing a sack

PASS = {"taker": (-0.50, 0.24, 0.0), "T": 4.2, "land": 3.02}  # the taker's node in the giver's frame (left, fwd, yaw)


def pass_take(fam, seed=331):
    """The carrier at the pile: he stands beside the man who lifts (to that man's right, facing the same way),
    watches him take up the sack, turns his head away and sets his knees as it comes up, takes it on the left
    shoulder (the body sinks under it and settles, the weight onto the left foot), his left hand up to steady its
    front end, then the hold of sack_hold."""
    k = fam.k
    T, tl0 = PASS["T"], PASS["land"]
    sp = WSpec(fam, T, loop=False)
    sp.dz = H(T, 0.0, [(2.2, 0.5, -0.07 * k), (tl0 - 0.02, 0.14, -0.13 * k), (tl0 + 0.14, 0.55, -0.035 * k),
                       (3.8, 0.3, -0.02 * k)])
    tb = H(T, 1.0, [(2.3, 0.5, 6.0), (tl0, 0.16, 11.0), (tl0 + 0.2, 0.6, 5.0)])
    tsd = H(T, 0.0, [(2.3, 0.5, -7.0), (tl0 + 0.2, 0.5, -4.0)])
    sp.trunk = lambda t: (tb(t), tsd(t), 0.0)
    sp.weight = H(T, 0.5, [(0.4, 1.0, 0.42), (2.2, 0.5, 0.5), (tl0, 0.3, 0.64), (3.7, 0.4, 0.52)])
    yw = H(T, 0.0, [(0.3, 0.6, 42.0), (2.45, 0.35, -14.0), (tl0 + 0.4, 0.5, -4.0)])
    pt = H(T, 0.0, [(0.3, 0.6, 22.0), (1.8, 0.5, 10.0), (2.45, 0.3, 2.0)])
    tl = H(T, 0.0, [(2.45, 0.35, -15.0), (tl0 + 0.3, 0.4, -11.0)])
    sp.look = lambda t: (yw(t), pt(t), tl(t))
    sp.lead = 0.25
    receive = ci.Hang(fwd=24.0, out=40.0, elbow=95.0, twist=-20.0, hand=15.0)
    sp.arms = {"L": ci.ArmTrack([(0.0, ci.Hang(), 0.3), (2.35, receive, 0.45), (tl0 + 0.02, SackFront(), 0.4)],
                                1e9, loop=False),
               "R": ci.Hang(out=8.0, elbow=10.0)}
    sp.things = lambda t, ctx: {"sack": sized(sack_shoulder_m(fam, ctx["posed"]), sack_on_shoulder_size())}
    sp.thing_meta = {"sack": {"model": "sack", "then": "upperChest", "from": "partner"}}
    sp.meta = {"work": "sack_pass", "pair": "taker", "partner": "sack_pass_give",
               "partnerAt": [-PASS["taker"][0], -PASS["taker"][1], -PASS["taker"][2]]}
    return sp


def pass_give(fam, taker, seed=332):
    """The man at the pile lifts a sack as in the low lift (the squat, the ears, the strain, the rise to the belly)
    and heaves it up and over onto the left shoulder of the carrier beside him: the trunk turns to the right into
    the heave, the arms follow through up as he lets go, the sack drops onto the carrier; he comes back down into
    his stance, the hands falling to his sides."""
    L = LIFT["low"]
    k = fam.k
    T, tl0 = PASS["T"], PASS["land"]
    base = {"L": (0.06, 0.02, 6.0), "R": (-0.05, -0.15, -10.0)}
    sp = WSpec(fam, T, loop=False, base=base)
    tb0, ts0, tr0, td0, tv0 = 0.2, 1.05, 1.40, 2.3, 2.55
    tr1, td1 = td0, tv0
    trel = tv0 + 0.15
    tq0, tq1 = 3.55, 3.9
    sp.dz = H(T, 0.0, [(tb0, ts0 - tb0, -0.43 * k), (ts0, 0.32, -0.455 * k), (tr0, tr1 - tr0, -0.04 * k),
                       (td0, td1 - td0, -0.13 * k), (tv0, 0.3, 0.006 * k), (trel + 0.1, 0.5, -0.03 * k),
                       (tq0, 0.4, -0.01 * k)])
    sp.fwd = H(T, 0.0, [(tb0, ts0 - tb0, -0.15 * k), (tr0, tr1 - tr0, -0.01 * k), (tv0, 0.3, 0.02 * k),
                        (trel, 0.6, 0.0)])
    hb = H(T, 0.0, [(tb0, ts0 - tb0, 26.0), (ts0, 0.32, 28.0), (tr0, tr1 - tr0, 4.0), (td0, td1 - td0, 9.0),
                    (tv0, 0.3, -5.0), (trel, 0.5, 2.0)])
    hy = H(T, 0.0, [(td0, 0.4, -12.0), (trel + 0.2, 0.6, 0.0)])
    sp.hips = lambda t: (hy(t), hb(t), 0.0)
    tb = H(T, 0.0, [(tb0, ts0 - tb0, 20.0), (ts0, 0.32, 24.0), (tr0, tr1 - tr0, -7.0), (td0, td1 - td0, -2.0),
                    (tv0, 0.35, -10.0), (trel + 0.1, 0.6, 2.0)])
    tsd = H(T, 0.0, [(tv0, 0.35, 8.0), (trel + 0.1, 0.5, 0.0)])
    tw = H(T, 0.0, [(td0, 0.3, -10.0), (tv0, 0.35, -24.0), (trel + 0.15, 0.6, 0.0)])
    sp.trunk = lambda t: (tb(t), tsd(t), tw(t))
    sp.knees = (4.0, 15.0)
    sp.weight = H(T, 0.5, [(tb0, 0.6, 0.47), (td0, 0.3, 0.6), (tv0, 0.3, 0.38), (trel + 0.2, 0.5, 0.5),
                           (tq0 - 0.1, 0.25, 0.66), (tq1, 0.3, 0.5)])
    yw = H(T, 0.0, [(td0, 0.4, -24.0), (trel + 0.2, 0.6, -14.0)])
    pt = H(T, 6.0, [(0.0, 0.4, 34.0), (tb0 + 0.5, 0.5, 18.0), (tr0, 0.6, 4.0), (tv0, 0.3, -8.0), (trel, 0.5, 4.0)])
    sp.look = lambda t: (yw(t), pt(t), 0.0)
    sp.keep = 0.45
    sp.jaw = lambda t: 0.6 + 4.0 * ci.pulse(t, tv0 - 0.1, trel + 0.05, 0.08, 0.2)
    sp.steps["R"] = [(tq0, tq1, (0.05 * k, 0.15 * k, 10.0))]
    sp.steps["L"] = [(tq1 + 0.02, tq1 + 0.28, (-0.06 * k, -0.02 * k, -6.0))]
    pile = M(V(0.0, L["fwd"] * k, L["up"] * k))
    lying, draped = SACK_LYING, sack_on_shoulder_size()
    lx, lf, lyaw = PASS["taker"]
    Tt = M(V(lx * k, lf * k, 0.0), yaw(lyaw))
    tsk = taker.skel

    def on_taker(t):
        pose, tr = taker.sample(t)
        return Tt @ sack_shoulder_m(taker.meta["_fam"], tsk.fk(pose, tr))

    def held(ctx, t):
        ps = ctx["posed"]
        mid = (ps.P["armUpL"] + ps.P["armUpR"]) / 2
        heading, fy = heading_of(ps)
        u = smootherstep((t - tr0) / (tr1 - tr0))
        R = heading @ RX(lerp(14.0, 55.0, u))
        ears = mid - Vector((0, 0, lerp(0.57, 0.43, u) * k)) + fy * lerp(0.24, 0.20, u) * k
        return M(ears - R @ Vector((0.0, 0.17, 0.07)), R)

    def things(t, ctx):
        if t <= tr0:
            return {"sack": sized(pile, lying)}
        if t <= tv0:
            return {"sack": sized(mix(pile, held(ctx, t), smootherstep((t - tr0) / 0.45)), lying)}
        u = clamp((t - tv0) / (tl0 - tv0))
        m = mix(held(ctx, t), on_taker(t), smootherstep(u))
        if 0 < u < 1:
            m.translation = m.translation + Vector((0.0, 0.0, 0.16 * k)) * math.sin(math.pi * u)
        return {"sack": sized(m, lerp3(lying, draped, smoothstep((u - 0.3) / 0.7)))}

    sp.things = things
    sp.thing_meta = {"sack": {"model": "sack", "then": "partner"}}
    gL = ear_grip("L", lambda f, S, c: V(1.0, -0.6, -0.2))
    gR = ear_grip("R", lambda f, S, c: V(-1.0, -0.6, -0.2))
    follow = {S: ci.Hang(fwd=75.0, out=14.0, elbow=35.0, twist=10.0, hand=-10.0) for S in "LR"}
    sp.arms = {S: ci.ArmTrack([(0.0, ci.Hang(), 0.3), (tb0 + (0.18 if S == "L" else 0.22), gL if S == "L" else gR,
                                                       ts0 - tb0 - 0.05),
                               (trel, follow[S], 0.22), (trel + 0.35, ci.Hang(), 0.7)], 1e9, loop=False) for S in "LR"}
    props, top = _sack_props(L["fwd"], L["up"], k)
    sp.meta = {"work": "sack_pass", "pair": "giver", "partner": "sack_pass_take",
               "partnerAt": list(PASS["taker"]), "pileTop": round(top, 3), "view": "low", "_props": props,
               "seq": True, "viewAt": (lx * 0.5, 0.25, 0.0)}
    return sp


def make_pass(bodies):
    """The pair: the taker first (his pose carries the sack at the end), then the giver, whose sack lands on the
    taker; the taker's track is the giver's seen from the taker's node."""
    fam = family("man", bodies)
    if fam is None:
        return []
    sp_t = pass_take(fam)
    m = {"role": "sack_pass_take", "motion": "idle", "context": "haul_pass", "family": "man",
         "female": fam.P["female"], "kind": "work"}
    m.update(sp_t.meta)
    taker = wevaluate(sp_t, "sack_pass_take", m)
    taker.meta["_fam"] = fam
    sp_g = pass_give(fam, taker)
    mg = {"role": "sack_pass_give", "motion": "crouch", "context": "haul_pass", "family": "man",
          "female": fam.P["female"], "kind": "work"}
    mg.update(sp_g.meta)
    giver = wevaluate(sp_g, "sack_pass_give", mg)
    lx, lf, lyaw = PASS["taker"]
    inv = M(V(lx * fam.k, lf * fam.k, 0.0), yaw(lyaw)).inverted()
    taker.meta["_things"] = [{"sack": (inv @ fr["sack"][0], fr["sack"][1])} for fr in giver.meta["_things"]]
    # the giver's figure in the taker's pictures and the taker's in the giver's
    giver.meta["_partner"] = (taker, (lx, lf, lyaw))
    taker.meta["_partner"] = (giver, (-lx, -lf, -lyaw))
    del taker.meta["_fam"]
    return [(taker, fam.b), (giver, fam.b)]


# ---------------------------------------------------------------- helpers for the work recipes


def kneel_hips(fam, knees, hip_back_deg, qh, lift=0.0):
    """The hips bone's place for a pelvis turned qh whose hip joints stand a thigh's length over the knees (given
    in the node's frame), the thighs leaning back by hip_back_deg (sitting back toward the heels)."""
    sk = fam.sk
    a = math.radians(hip_back_deg)
    js = []
    for S in "LR":
        L1 = sk.L["thigh" + S]
        js.append(knees[S] + Vector((0.0, L1 * math.sin(a), L1 * math.cos(a) + lift)))
    jmid = (js[0] + js[1]) / 2
    rmid = (sk.rest["legUpL"] + sk.rest["legUpR"]) / 2
    return jmid - qh @ (rmid - sk.rest["hips"])


def kneel_leg(fam, S, knee, toes="flat"):
    """A leg kneeling: the knee on the ground at `knee` (the joint's centre), the shin back along the ground, the
    instep flat on it (toes pointing back) or the toes tucked under (heel up). Returns a feet_at entry."""
    sk = fam.sk
    L2 = sk.L["shin" + S]
    if toes == "flat":
        az = 0.075 * fam.k
        rot = RX(168.0)
    else:
        az = 0.12 * fam.k
        rot = RX(105.0)
    dz = az - knee.z
    back = math.sqrt(max(0.0, L2 * L2 - dz * dz))
    ank = knee + Vector((0.0, back, dz))
    toe = RX(-55.0) if toes != "flat" else Quaternion()
    return {"flat": ank, "yaw": 0.0, "roll_min": 0.0, "swing": True, "ankle": ank, "rot": rot, "toe": toe,
            "pole": V(0.0, 1.0, -0.4)}


def planted(fam, S, left, fwd, yaw_deg):
    """A foot standing flat at (left, fwd) turned yaw (a feet_at entry)."""
    flat = cm.stance_flat(fam.sk, S, fwd * fam.k, left * fam.k, lambda p: 0.0, 0.0, yaw_deg)
    return {"flat": flat, "yaw": yaw_deg, "roll_min": 0.0, "swing": False}


class Along(Grip):
    """A fist that moves along a handle by a path: at(t) -> (point, axis, wrist) in the node's frame, its hand
    shape opening while it travels (shape(t) -> 0 closed .. 1 open)."""

    def __init__(self, at, pole, r=0.012, opened=None, clav=None):
        super().__init__(lambda fam, S, ctx: at(ctx["t"], fam, S, ctx), pole, r=r, clav=clav)
        self.opened = opened

    def apply(self, fam, pose, S, ctx):
        sh = super().apply(fam, pose, S, ctx)
        if self.opened:
            w = clamp(self.opened(ctx["t"]))
            if w > 0:
                sh = ci.mix_shape(sh, ci.shape_of("beat"), w)
        return sh


def loopsig(T, keys):
    """A looping signal through (t, value) keys (a smooth periodic Curve)."""
    return mo.Curve(keys, period=T)


def phase(t, T):
    return (t % T) / T


def fwd_heading(ps):
    return heading_of(ps)[1]


# ---------------------------------------------------------------- rolling a cask


CASK = {"radius": 0.33, "length": 0.88, "fwd": 0.60}


def cask_roll(sk, axes, fam, name="cask_roll"):
    """Rolling a cask along the quay: bent over it, both palms on its upper back, walking it along at 0.8 m/s;
    the hands press in turn with the steps (each one when the opposite foot pushes off) and slide on the turning
    staves. A two-stride loop in place: the game moves the node and turns the cask by the distance (its radius in
    things.cask)."""
    v = 0.8
    r = CASK["radius"] * fam.k
    c = V(0.0, CASK["fwd"] * fam.k, r)
    g_mods = cm._g_mods(dict(hipsShare=0.6, step=0.78, lean=34.0, load=6.0, contactKnee=6.0, counter=0.35, sway=0.8,
                             armSwing=0.0, keep=1.3))

    def extra(pose, sk_, ctx):
        phi = ctx.get("phase", 0.0)
        ps = sk.fk(pose, ctx["trans"])
        for S in "LR":
            sg = 1 if S == "L" else -1
            # press when the other foot pushes off: the left hand with the right foot's push (0.25 and 0.75)
            off = 0.0 if S == "L" else 0.5
            press = 0.5 + 0.5 * math.cos(4 * math.pi * (phi - 0.18 - off / 2))
            th = math.radians(42.0 - 6.0 * press)
            p = c + V(0.17 * sg, -r * math.sin(th) - 0.012 * press, r * math.cos(th) + 0.012)
            # the palm on the staves (its normal back and up toward the body), the fingers forward over the top
            rot = cm.hand_aim(S, V(-0.15 * sg, 0.6, 0.75), V(0.0, math.sin(th), -math.cos(th)))
            palm = fam.palm[S]
            wrist = p - rot @ palm
            pose["clavicle" + S] = Quaternion()
            ps = sk.fk(pose, ctx["trans"])
            pose["clavicle" + S] = mo.clavicle_for(ps, S, wrist)
            sk.arm(pose, S, wrist, rot, V(0.8 * sg, -0.4, -0.6), t=ctx["trans"])
            ci.limit_twist(pose, S)
            ctx.setdefault("shapes", {})[S] = "open"
        ctx["lookDown"] = 18.0
        return "LR"

    clip, g = cm.walk_loop("man", v, sk, axes, name=name, extra=extra, g_override=g_mods)
    T = clip.seconds
    spin = []
    for i in range(clip.frames):
        a = (v * i / FPS) / r
        spin.append({"cask": (M(c, RX(math.degrees(a))), None)})
    clip.meta["_things"] = spin
    clip.meta["_thingMeta"] = {"cask": {"model": "cask", "radius": CASK["radius"], "length": CASK["length"],
                                        "roll": True, "hidden": False}}
    clip.meta["work"] = "cask_roll"
    clip.meta["cask"] = {"at": [0.0, round(r, 3), round(CASK["fwd"] * fam.k, 3)], "radius": CASK["radius"],
                         "length": CASK["length"], "axis": "x",
                         "note": "a cask lying across before him (its length along his left-right), centre at `at` "
                                 "(game axes, node frame); turn it about x by the distance walked over the radius"}
    return clip


# ---------------------------------------------------------------- hauling a rope hand over hand

ROPE = {"P0": (0.0, 0.30, 1.08), "anchor": (0.0, 2.5, 4.7), "top": 0.42, "low": -0.20}


def rope_haul(fam, T=2.8, seed=341):
    """Hauling on a rope that comes down from a block overhead (a fall from shear legs or a gin), hand over hand:
    one hand reaches up and takes the rope, the body sinks and pulls it down to the chest as the knees bend and the
    trunk curls over it, the other hand lets go below and reaches up past it; the head looks up at each new grip.
    Each pull half the loop."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.05, 0.08, 6.0), "R": (-0.05, -0.08, -8.0)})
    P0 = V(*ROPE["P0"]) * k
    A = V(*ROPE["anchor"]) * k
    d = (A - P0).normalized()
    top, low = ROPE["top"] * k, ROPE["low"] * k
    half = T / 2

    def s_of(t, S):
        u = ((t / T) + (0.0 if S == "R" else 0.5)) % 1.0
        if u < 0.5:  # pulling down with the rope
            e = smootherstep(u / 0.5)
            return lerp(top, low, e), 0.0
        e = smootherstep((u - 0.5) / 0.5)  # reaching up past the other hand
        return lerp(low, top, e), math.sin(math.pi * e)

    def at(t, fam_, S, ctx):
        s, off = s_of(t, S)
        sg = 1 if S == "L" else -1
        p = P0 + d * s + Vector((sg * (0.025 + 0.08 * off) * k, -0.05 * off * k, 0.0))
        # the thumbs up the rope toward the block, the wrists below it and toward the body
        w = ctx["posed"].P["armUp" + S] - p
        return p, d, w

    def opened(S):
        return lambda t: (lambda so: clamp(so[1] * 2.0))(s_of(t, S))

    sp.arms = {S: Along(at, (lambda S_: lambda f, S2, c: V(1.0 * sgn(S_), -0.3, -0.7))(S), r=0.012,
                        opened=opened(S)) for S in "LR"}
    pull = lambda t: 0.5 - 0.5 * math.cos(2 * TAU * t / T)  # 0 at the reach, 1 at the end of each pull
    sp.dz = lambda t: -(0.03 + 0.07 * pull(t)) * k
    sp.fwd = lambda t: -0.03 * pull(t) * k
    sp.hips = lambda t: (0.0, 4.0 + 6.0 * pull(t), 0.0)
    sp.trunk = lambda t: (2.0 + 9.0 * pull(t), 0.0, 4.0 * math.sin(TAU * t / T))
    sp.weight = lambda t: 0.5 + 0.08 * math.sin(TAU * t / T)
    sp.look = lambda t: (6.0 * math.sin(TAU * t / T), -30.0 + 22.0 * pull(t), 0.0)
    sp.keep = 0.4
    sp.breath_T = T / 2
    sp.breath_amp = 1.4

    def things(t, ctx):
        return {}

    sp.things = things

    def ropes(i, clip=None):
        return []

    sp.meta = {"work": "rope_haul", "rope": {"anchor": [round(A.x, 3), round(A.z, 3), round(-A.y, 3)],
                                             "radius": 0.012, "tail": [-0.16, 0.0, 0.18],
                                             "note": "a rope from the anchor (game axes, node frame) through the "
                                                     "upper fist and the lower one (gripL/gripR) down to the tail "
                                                     "on the ground"},
               "_rope": {"anchor": A, "tail": V(-0.16, 0.18, 0.0) * k, "r": 0.012}}
    return sp


# ---------------------------------------------------------------- cranking a winch


WINCH = {"axle": (0.04, 0.42, 1.02), "radius": 0.24, "handle": 0.36}


def winch(fam, T=3.4, seed=351):
    """Cranking a crane's winch: both hands on the crank's handle, two turns a loop; the body rocks with the crank,
    leaning in and pushing as the handle goes away over the top, sitting back and pulling as it comes round below;
    the legs in a stagger take the weight from foot to foot, the head steady on the work."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.06, 0.12, 4.0), "R": (-0.06, -0.12, -10.0)})
    C = V(*WINCH["axle"]) * k
    r = WINCH["radius"] * k

    def ang(t):
        return 2 * TAU * t / T  # two turns a loop; 0: the handle nearest him at the axle's height

    def crank_m(t):
        a = ang(t)
        radial = Vector((0.0, math.cos(a), math.sin(a)))  # +Y (back toward him) at 0, up at a quarter
        along = Vector((-1.0, 0.0, 0.0))
        return M(C, Matrix((radial, along, radial.cross(along))).transposed().to_quaternion())

    def at(S):
        def fn(t, fam_, S_, ctx):
            m = crank_m(t)
            x = 0.07 if S == "L" else 0.20
            p = m @ Vector((r, x * k, 0.0))
            sg = 1 if S == "L" else -1
            axis = Vector((-sg, 0.0, 0.0))  # thumbs toward each other
            sh = ctx["posed"].P["armUp" + S]
            w = sh - p
            return p, axis, w
        return fn

    sp.arms = {S: Along(at(S), (lambda S_: lambda f, S2, c: V(1.2 * sgn(S_), -0.4, -0.6))(S), r=0.018) for S in "LR"}
    push = lambda t: math.cos(ang(t))  # 1 when the handle is near (pulling), -1 far (pushing)
    sp.fwd = lambda t: (0.04 - 0.07 * push(t)) * k
    sp.dz = lambda t: (-0.07 + 0.05 * math.sin(ang(t))) * k
    sp.hips = lambda t: (0.0, 6.0 - 4.0 * push(t), 0.0)
    sp.trunk = lambda t: (16.0 - 12.0 * push(t) - 8.0 * math.sin(ang(t)), 0.0, 5.0 * math.sin(ang(t)))
    sp.weight = lambda t: 0.5 + 0.12 * (-push(t))
    sp.look = lambda t: (0.0, 22.0 + 3.0 * math.sin(ang(t)), 0.0)
    sp.keep = 0.5
    sp.breath_T = T / 2
    sp.breath_amp = 1.3
    sp.things = lambda t, ctx: {"crank": (crank_m(t), None)}
    sp.thing_meta = {"crank": {"model": "crank", "radius": WINCH["radius"], "handle": WINCH["handle"]}}
    sp.meta = {"work": "winch", "winch": {"axle": [round(C.x, 3), round(C.z, 3), round(-C.y, 3)],
                                          "radius": WINCH["radius"], "turnsPerLoop": 2,
                                          "note": "the crank's axle across before him (game axes, node frame); the "
                                                  "handle along the axle toward his right, at the crank's end"},
               "rows": ("rside", "back"),
               "_props": [("box", M(C + Vector((0.07 * k, -0.05, -0.44 * k))), (0.05, 0.32, 1.0 * k), "wood"),
                          ("box", M(C + Vector((0.67 * k, -0.05, -0.44 * k))), (0.05, 0.32, 1.0 * k), "wood"),
                          ("cyl", M(C + Vector((0.37 * k, 0.0, 0.0))), (0.13, 0.56), "wood")]}
    return sp


# ---------------------------------------------------------------- gutting fish at the table

TABLE = {"top": 0.85, "near": 0.30, "board": 0.46}


def gut(fam, T=10.2, seed=361):
    """A fishwife gutting at her table: she takes a fish from the heap at her left, lays it on the board, holds it
    down by the head with her left hand, slits the belly with two strokes of the knife toward her, turns the knife
    and scrapes the guts over the edge into the bucket at her right, lays the fish in the basket at her left and
    takes the next; between two fish a glance up at the market. The head bent over the work, the weight shifting
    slowly, the elbows working close to the body."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.03, 0.0, 2.0), "R": (-0.03, -0.03, -4.0)})
    top = (TABLE["top"] + 0.03) * k
    B_ = V(0.0, TABLE["board"], 0.0) * k + Vector((0, 0, top))
    heap = V(0.34, 0.54, 0.0) * k + Vector((0, 0, top + 0.03))
    basket = V(0.30, 0.34, 0.0) * k + Vector((0, 0, top + 0.02))
    bucket = V(-0.32, 0.22, 0.0) * k + Vector((0, 0, 0.45 * k))
    # one fish's work (from t0): take (0.0-0.7), lay (0.7-1.2), slit (1.4-2.6), scrape (2.7-3.7), into the basket
    # (3.8-4.5); two fish a loop, a glance up between
    fish_t = (0.2, 5.0)

    def fish_m(t):
        for t0 in fish_t:
            u = t - t0
            if u < 0 or u > 4.8:
                continue
            on_board = M(B_ + V(0.03, 0.0, 0.035) * k, yaw(-90.0))
            if u < 0.7:
                return M(heap.lerp(heap + V(-0.05, -0.06, 0.12) * k, smootherstep(u / 0.7)), yaw(15.0))
            if u < 1.2:
                w = smootherstep((u - 0.7) / 0.5)
                return mix(M(heap + V(-0.05, -0.06, 0.12) * k, yaw(15.0)), on_board, w)
            if u < 3.8:
                return on_board
            if u < 4.5:
                w = smootherstep((u - 3.8) / 0.7)
                m = mix(on_board, M(basket, yaw(-20.0)), w)
                m.translation = m.translation + Vector((0, 0, 0.1 * k * math.sin(math.pi * w)))
                return m
            return M(basket, yaw(-20.0))
        return None

    def lhand(fam_, S, ctx):
        m = ctx["things"].get("fish", (None,))[0]
        if m is None:
            m = M(heap, yaw(15.0))
        return m @ Vector((0.11, 0.0, 0.03))

    # left hand: on the fish's head (the fish's local +x is its head end, at her left)
    hold = Palm(lhand, lambda f, S, c: V(-0.4, 0.7, -0.4), lambda f, S, c: V(0.0, 0.0, -1.0),
                lambda f, S, c: V(1.0, -0.5, -0.4), shape="cup")
    rest = Palm(lambda f, S, c: B_ + V(0.22, -0.08, 0.02) * k, lambda f, S, c: V(-0.5, 0.8, 0.0),
                lambda f, S, c: V(0.0, 0.0, -1.0), lambda f, S, c: V(1.0, -0.5, -0.4), shape="rest")

    # the knife's path through one fish (seconds from the fish's start): rest, the slit (two strokes toward her
    # along the belly), the knife turned flat and the guts scraped over the edge and flicked into the bucket, back
    # to rest; between the keys an eased move. Each key: (t, point, the tip's way, the wrist's side)
    rest_k = (B_ + V(-0.04, -0.10, 0.12) * k, V(0.05, 0.85, -0.5), V(0.0, -0.4, 1.0))
    slit_a = (B_ + V(0.0, 0.10, 0.08) * k, V(0.1, 0.9, -0.45), V(-0.2, -0.3, 1.0))
    slit_b = (B_ + V(0.0, -0.07, 0.065) * k, V(0.1, 0.9, -0.45), V(-0.2, -0.3, 1.0))
    lift_k = (B_ + V(0.0, 0.08, 0.10) * k, V(0.1, 0.9, -0.45), V(-0.2, -0.3, 1.0))
    flat_k = (B_ + V(0.0, -0.02, 0.07) * k, V(-0.3, 0.9, -0.6), V(0.3, -0.2, 1.0))
    edge_k = (B_ + V(-0.10, -0.16, 0.08) * k, V(-0.3, 0.9, -0.6), V(0.3, -0.2, 1.0))
    flick_k = (bucket + V(0.04, 0.04, 0.32) * k, V(-0.3, 0.8, -0.8), V(0.3, -0.2, 1.0))
    keys = [(0.0, rest_k), (1.15, rest_k), (1.4, slit_a), (1.9, slit_b), (2.0, lift_k), (2.15, slit_a),
            (2.65, slit_b), (2.85, flat_k), (3.2, edge_k), (3.55, flick_k), (3.75, flick_k), (4.2, rest_k)]

    def knife_at(t, fam_, S, ctx):
        tt = t % (T / 2)
        u0 = tt - fish_t[0] if t < T / 2 else tt - (fish_t[1] - T / 2)
        if u0 <= keys[0][0] or u0 >= keys[-1][0]:
            p_, a_, w_ = rest_k
            return p_, a_, w_
        for (ta, ka), (tb, kb) in zip(keys, keys[1:]):
            if ta <= u0 <= tb:
                e = smootherstep((u0 - ta) / max(1e-6, tb - ta))
                return (ka[0].lerp(kb[0], e), ka[1].lerp(kb[1], e).normalized(), ka[2].lerp(kb[2], e).normalized())
        return rest_k

    knife = Along(knife_at, lambda f, S, c: V(-1.0, -0.6, -0.5), r=0.013)

    def lt(t):
        tt = t % (T / 2)
        u0 = tt - fish_t[0] if t < T / 2 else tt - (fish_t[1] - T / 2)
        return u0

    # the left hand takes each fish, lays it, holds it and carries it to the basket, then rests on the board
    sp.arms = {"L": ci.ArmTrack([(fish_t[0], hold, 0.35), (fish_t[0] + 4.55, rest, 0.45),
                                 (fish_t[1], hold, 0.35), (fish_t[1] + 4.55, rest, 0.45)], T), "R": knife}
    sp.things = lambda t, ctx: {k_: (v, None) for k_, v in (("fish", fish_m(t)),) if v is not None}
    sp.thing_meta = {"fish": {"model": "fish"}}
    sp.weight = ci.weights(T, [(1.0, 1.5, 0.6), (5.4, 1.6, 0.42), (8.8, 1.0, 0.5)])
    sp.trunk = lambda t: (18.0 + 2.0 * math.sin(TAU * 2 * t / T), 0.0, 0.0)
    sp.hips = lambda t: (0.0, 6.0, 0.0)
    sp.fwd = lambda t: 0.02 * k
    base = ci.look(T, [(4.6, 0.5, 18.0, -14.0, 3.0), (5.4, 0.6, 0.0, 0.0, 0.0)], seed=seed, drift_deg=1.5)
    sp.look = lambda t: (base(t)[0], base(t)[1] + 30.0, base(t)[2])
    sp.keep = 0.3
    sp.held = [{"model": "knife", "socket": "gripR"}]
    sp.meta = {"work": "gut", "table": {"top": TABLE["top"], "near": TABLE["near"]}, "held": sp.held,
               "_props": [("box", M(V(0.0, TABLE["near"] + 0.42, TABLE["top"] / 2) * k), (1.3, 0.84, TABLE["top"] * k),
                           "wood"),
                          ("cyl", M(bucket - Vector((0, 0, 0.2 * k))) @ Matrix.Rotation(math.pi / 2, 4, "Y"),
                           (0.15, 0.4), "wood")],
               "view": "stand"}
    return sp


# ---------------------------------------------------------------- sweeping


def sweep(fam, T=6.0, seed=371):
    """Sweeping with a birch broom: the right hand low on the handle, the left at its top by the left hip; strokes
    from the right across to the left, the broom's head dragged over the stones and lifted back; the trunk turns
    with each stroke and the weight goes from the right foot to the left; after two strokes the left foot shifts
    out and back. Three strokes a loop and a half one."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.06, 0.06, 10.0), "R": (-0.06, -0.06, -14.0)})
    # five strokes (the drag 0.55 s, the head lifted back 0.45 s), then the broom rests while the foot shifts
    xs = (-0.30, 0.22)

    def head(t):
        tt = t % T
        n = int(tt // 1.0)
        u = tt - n
        if n >= 5:
            return xs[0] * k, 0.0, 0.0
        if u < 0.55:
            e = smootherstep(u / 0.55)
            return lerp(xs[0], xs[1], e) * k, 0.0, 0.05 * math.sin(math.pi * e) * k
        e = smootherstep((u - 0.55) / 0.45)
        return lerp(xs[1], xs[0], e) * k, 0.05 * math.sin(math.pi * e) * k, 0.0

    def broom_m(t):
        x, lift, f = head(t)
        h = V(x, 0.50 + f, lift)
        # Keep the entire handle ahead of the apron and abdomen, including its upper end.
        topp = V(0.18, 0.34, 1.20) * k + V(0.04 * math.sin(TAU * t / T), 0.0, 0.0)
        ax = (topp - h).normalized()
        side = Vector((0.0, 0.0, 1.0)).cross(ax).normalized()
        R = Matrix((ax, side, ax.cross(side))).transposed().to_quaternion()
        return M(h, R)

    def grip_at(S):
        def fn(t, fam_, S_, ctx):
            m = ctx["things"]["broom"][0]
            R = m.to_3x3()
            ax = R @ Vector((1, 0, 0))
            if S == "R":
                p = m @ Vector((0.96 * k, 0.0, 0.0))
                return p, ax, ctx["posed"].P["armUp" + S_] - p
            p = m @ Vector((1.17 * k, 0.0, 0.0))
            return p, ax, ctx["posed"].P["armUp" + S_] - p
        return fn

    sp.arms = {"R": Along(grip_at("R"), lambda f, S, c: V(-1.0, -0.6, -0.5), r=0.018),
               "L": Along(grip_at("L"), lambda f, S, c: V(1.0, -0.3, -0.7), r=0.018)}
    sp.things = lambda t, ctx: {"broom": (broom_m(t), None)}
    sp.thing_meta = {"broom": {"model": "broom"}}

    def stroke_w(t):
        x, _, _ = head(t)
        return (x / k - xs[0]) / (xs[1] - xs[0])

    sp.weight = lambda t: 0.35 + 0.3 * stroke_w(t)
    sp.trunk = lambda t: (16.0, 0.0, -14.0 + 24.0 * stroke_w(t))
    sp.hips = lambda t: (-5.0 + 8.0 * stroke_w(t), 10.0, 0.0)
    sp.dz = lambda t: -0.05 * k
    sp.look = lambda t: (8.0 - 14.0 * stroke_w(t), 34.0, 0.0)
    sp.keep = 0.4
    sp.steps["L"] = [(5.05, 5.4, (0.07 * k, 0.05 * k, 4.0)), (5.55, 5.92, (0.0, 0.0, 0.0))]
    sp.meta = {"work": "sweep"}
    return sp


# ---------------------------------------------------------------- scrubbing the doorstep on the knees


def scrub(fam, T=6.4, seed=381):
    """On her knees on the step, scrubbing the stone: the left hand propped on the ground takes some of her weight,
    the right hand drives the brush in long strokes forward and back with a turn at each end, the whole body
    rocking with it from the knees; once a loop she leans over to the bucket at her left and wets the brush."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    knees = {"L": V(0.12, 0.02, 0.055) * k, "R": V(-0.12, 0.05, 0.055) * k}
    strokes_end = 4.4

    def rock(t):
        tt = t % T
        if tt < strokes_end:
            return math.sin(TAU * tt / 1.1) * ci.pulse(tt, -1e-4, strokes_end, 0.3, 0.45)
        return 0.0

    def to_bucket(t):
        tt = t % T
        return ci.pulse(tt, strokes_end + 0.05, T - 0.25, 0.55, 0.6)

    def hips_at(t):
        r = rock(t)
        b = to_bucket(t)
        qh = yaw(10.0 * b) @ bow(59.0 + 1.5 * r - 30.0 * b)
        return kneel_hips(fam, knees, -3.0 - 2.0 * r + 22.0 * b, qh), qh

    sp.hips_at = hips_at
    sp.feet_at = lambda t: {S: kneel_leg(fam, S, knees[S]) for S in "LR"}
    sp.trunk = lambda t: (18.0 + 4.0 * rock(t) - 6.0 * to_bucket(t), 0.0, 12.0 * to_bucket(t))
    sp.look = lambda t: (6.0 * math.sin(TAU * t / T) + 30.0 * to_bucket(t), 40.0, 0.0)
    sp.keep = 0.35
    bucket = V(0.30, 0.30, 0.30) * k

    def brush_m(t):
        tt = t % T
        if tt < strokes_end:
            u = tt / 1.1
            s = math.sin(TAU * u)
            env = ci.pulse(tt, -1e-4, strokes_end, 0.3, 0.45)
            p = V(-0.10 + 0.03 * math.sin(TAU * u * 2) * env, 0.50 + 0.10 * s * env, 0.025) * k
            return M(p, yaw(-90.0 + 8.0 * s * env))
        w = to_bucket(t)
        p = V(-0.10, 0.50, 0.025) * k
        dip = bucket + Vector((0.0, 0.0, 0.05 * k))
        m = mix(M(p, yaw(-90.0)), M(dip, yaw(-90.0) @ RY(15.0)), w)
        return m

    def on_brush(fam_, S, ctx):
        return ctx["things"]["brush"][0] @ Vector((0.0, 0.0, 0.045))

    hand = Palm(on_brush, lambda f, S, c: c["things"]["brush"][0].to_3x3() @ Vector((1.0, 0.0, -0.1)),
                lambda f, S, c: V(0.0, 0.0, -1.0), lambda f, S, c: V(-1.0, -0.3, 0.6), shape="cup")
    prop = Palm(lambda f, S, c: V(0.15, 0.44, 0.04) * k, lambda f, S, c: V(-0.5, 1.0, 0.0),
                lambda f, S, c: V(0.0, 0.0, -1.0), lambda f, S, c: V(1.0, -0.4, 0.0), shape="open",
                hand=(0.0, -60.0, 0.0))
    prop2 = ci.on_thigh(0.62)
    sp.arms = {"R": hand, "L": ci.ArmTrack([(0.0, prop, 0.3), (strokes_end + 0.05, prop2, 0.45),
                                           (T - 0.65, prop, 0.5)], T)}
    sp.things = lambda t, ctx: {"brush": (brush_m(t), None)}
    sp.thing_meta = {"brush": {"model": "brush"}}
    sp.kneel_points = knees
    sp.meta = {"work": "scrub", "view": "kneel", "kneel": True, "bucket": [0.30, 0.0, 0.30],
               "_props": [("cyl", M(V(0.30, 0.30, 0.14) * k) @ Matrix.Rotation(math.pi / 2, 4, "Y"), (0.15, 0.28), "wood")]}
    return sp


# ---------------------------------------------------------------- one knee down: marbles, sorting, cards


def crouch(fam, T=4.0, seed=391, what="pick"):
    """Down on one knee (the left), the right foot planted before it, the left forearm across the right knee; the
    right hand works at the ground before the knee (flicks a marble, picks up and sorts stones, lays a card), the
    head on the work, the body rocking a little toward it."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    kneeL = V(0.13, -0.02, 0.055) * k
    footR = planted(fam, "R", -0.13, 0.30, -10.0)

    def hips_at(t):
        r = 0.5 + 0.5 * math.sin(TAU * t / T)
        qh = yaw(-6.0) @ bow(24.0 + 6.0 * r) @ lean(-3.0)
        knees = {"L": kneeL, "R": kneeL + V(-0.26, 0.0, 0.0) * k}
        return kneel_hips(fam, knees, 34.0 - 4.0 * r, qh, lift=-0.01 * k), qh

    sp.hips_at = hips_at
    sp.feet_at = lambda t: {"L": kneel_leg(fam, "L", kneelL_(), toes="tucked"), "R": footR}

    def kneelL_():
        return kneeL

    sp.trunk = lambda t: (40.0 + 4.0 * math.sin(TAU * t / T), 0.0, -8.0)
    sp.look = lambda t: (-8.0, 26.0 + 4.0 * math.sin(TAU * t / T), 0.0)
    sp.keep = 0.4

    def work_at(fam_, S, ctx):
        t = ctx["t"]
        u = (t % T) / T
        flick = ci.pulse(u, 0.55, 0.7, 0.04, 0.08)
        reach = 0.5 + 0.5 * math.sin(TAU * u)
        return V(-0.24 - 0.03 * reach, 0.20 + 0.06 * reach + 0.03 * flick, 0.08 + 0.04 * (1 - reach)) * k

    hand = Palm(work_at, lambda f, S, c: V(0.3, 1.0, -0.8), lambda f, S, c: V(0.0, -0.3, -1.0),
                lambda f, S, c: V(-0.6, -1.0, 0.0), shape="pinch")

    def on_knee(fam_, S, ctx):
        ps = ctx["posed"]
        return ps.P["legLowR"] + V(0.03, 0.0, 0.06) * k

    rest = Palm(on_knee, lambda f, S, c: V(-1.0, 0.2, -0.3), lambda f, S, c: V(0.0, 0.0, -1.0),
                lambda f, S, c: V(1.0, -0.4, 0.0), shape="relaxed")
    sp.arms = {"R": hand, "L": rest}
    sp.kneel_points = {"L": kneeL}
    sp.meta = {"work": "crouch", "view": "kneel", "kneel": True}
    return sp


# ---------------------------------------------------------------- washing at the bucket


def wash(fam, T=6.0, seed=401):
    """Washing linen in a bucket on the ground before her: bent deep at the hips with the knees bent, the hands in
    the water rubbing the cloth between them; once a loop she lifts it out, wrings it (the fists turning against
    each other) and plunges it back."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.07, 0.0, 10.0), "R": (-0.07, -0.02, -10.0)})
    c = V(0.0, 0.34, 0.27) * k
    wring = lambda t: ci.pulse(t % T, 3.6, 5.6, 0.45, 0.5)
    rub = lambda t: math.sin(TAU * t / 0.6)
    sp.dz = lambda t: (-0.31 + 0.12 * wring(t)) * k
    sp.fwd = lambda t: -0.08 * k
    sp.hips = lambda t: (0.0, 30.0 - 10.0 * wring(t), 0.0)
    sp.trunk = lambda t: (40.0 - 22.0 * wring(t) + 1.5 * rub(t), 0.0, 0.0)
    sp.weight = ci.weights(T, [(0.5, 1.0, 0.56), (2.0, 1.0, 0.44), (3.4, 0.3, 0.5)])
    sp.look = lambda t: (0.0, 34.0 - 10.0 * wring(t), 0.0)
    sp.keep = 0.4

    def at(S):
        sg = 1 if S == "L" else -1

        def fn(fam_, S_, ctx):
            t = ctx["t"]
            w = wring(t)
            low = c + V(sg * 0.035, 0.04 * sg * rub(t), 0.02 * sg * rub(t)) * k
            high = V(sg * 0.05, 0.40, 0.62) * k
            return low.lerp(high, w)
        return fn

    sp.arms = {S: Palm(at(S), (lambda S_: lambda f, S2, c_: V(-sgn(S_) * 0.3, 0.6, -0.8).lerp(V(-sgn(S_), 0.0, -0.1),
                                                                                         wring(c_["t"])))(S),
                       (lambda S_: lambda f, S2, c_: V(-sgn(S_), 0.0, 0.0))(S),
                       (lambda S_: lambda f, S2, c_: V(sgn(S_) * 1.0, -0.3, -0.4))(S),
                       shape=(lambda S_: lambda f, S2, c_: ci.mix_shape(ci.shape_of("cup"), ci.shape_of("fist"),
                                                                       wring(c_["t"])))(S)) for S in "LR"}
    sp.meta = {"work": "wash", "bucket": [0.0, 0.0, 0.34],
               "_props": [("cyl", M(V(0.0, 0.34, 0.14) * k) @ Matrix.Rotation(math.pi / 2, 4, "Y"), (0.15, 0.28), "wood")]}
    return sp


# ---------------------------------------------------------------- the soldier's rifle

def rifle_on_hand(fam):
    """The rifle upright in the right hand at the shoulder ("portez armes"): the butt in the palm, the barrel up
    against the front of the shoulder; carried by the hand (a thing on handR)."""
    sk = fam.sk

    def late(t, ctx, ps):
        p = ps.point("handR", sk.rest["handR"] + fam.palm["R"] + V(0.0, 0.0, 0.02))
        return {"rifle": (M(p, ps.D["handR"] @ RY(-90.0) @ RX(-4.0)), None)}

    return late


def rifle_arm(fam):
    return ci.Hang(fwd=3.0, out=5.0, elbow=7.0, twist=24.0, hand=-6.0, shape="cup")


def rifle_idle(fam, T=12.6, seed=411):
    """A sentry at his post: upright, the heels close, the rifle at the shoulder in the right hand; the weight
    shifts now and then, the head turns slowly to look along the street and back, breathing."""
    sp = ci.idle_hold(fam, {"L": ci.Hang(fwd=1.0, out=5.0, elbow=6.0), "R": rifle_arm(fam)}, T=T, seed=seed,
                      lean_=-1.0, look_amp=1.3, weight_hold=0.62)
    sp.things_late = rifle_on_hand(fam)
    sp.thing_meta = {"rifle": {"model": "rifle", "attach": "handR"}}
    sp.meta = {"work": "rifle"}
    return sp


def rifle_talk(fam, T=10.5, seed=412):
    """A word with the relief: the left hand talks (calm offers and beats), the rifle stays at the shoulder."""
    sp = ci.Talk(fam, T, [(0.4, 2.4, "offer", "L"), (3.0, 4.8, "beat", "L"), (5.4, 6.4, None, "L"),
                          (7.0, 9.2, "offer_out", "L")],
                 {"L": ci.Hang(fwd=1.0, out=5.0, elbow=6.0), "R": rifle_arm(fam)}, seed, head_amp=1.0).spec()
    sp.things_late = rifle_on_hand(fam)
    sp.thing_meta = {"rifle": {"model": "rifle", "attach": "handR"}}
    sp.meta = {"work": "rifle"}
    return sp


def rifle_walk(sk, axes, fam, name="rifle_walk"):
    """Marching with the rifle at the shoulder: D1's walk, the right arm held still at the side with the rifle,
    the left arm swinging."""
    arm = rifle_arm(fam)

    def extra(pose, sk_, ctx):
        c = {"breath": ctx.get("breath", 0.0), "armLag": (0.0, 0.0), "trans": ctx["trans"], "t": 0.0}
        arm.apply(fam, pose, "R", c)
        ctx.setdefault("shapes", {})["R"] = "cup"
        return "R"

    clip, g = cm.walk_loop("man", "walk", sk, axes, name=name, extra=extra)
    late = rifle_on_hand(fam)
    clip.meta["_things"] = [late(i / FPS, None, sk.fk(clip.poses[i], clip.trans[i])) for i in range(clip.frames)]
    clip.meta["_thingMeta"] = {"rifle": {"model": "rifle", "attach": "handR"}}
    clip.meta["work"] = "rifle"
    return clip


# ---------------------------------------------------------------- writing in a book on the forearm

def write(fam, T=8.4, seed=421):
    """The customs officer writes in his book: the book open on his left hand and forearm before his chest,
    tilted toward him; the pencil in his right hand runs along a line, comes back for the next; he looks down at
    the page and now and then up at the goods, the book coming down a little while he looks."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    up = lambda t: ci.pulse(t % T, 5.6, 7.4, 0.45, 0.6)

    def book_place(fam_, S, ctx):
        return V(0.07, 0.30 + 0.02 * up(ctx["t"]), 1.02 - 0.05 * up(ctx["t"])) * k

    lhand = Palm(book_place, lambda f, S, c: V(-0.8, 0.5, 0.15), lambda f, S, c: V(0.0, -0.25, 1.0),
                 lambda f, S, c: V(1.0, -0.6, -0.5), shape="cup", hand=(70.0, -10.0, 0.0))

    def book_m(ps):
        hp = ps.point("handL", fam.sk.rest["handL"] + fam.palm["L"]) + ps.D["handL"] @ Vector((0.0, 0.0, 0.0))
        heading, fy = heading_of(ps)
        R = heading @ RX(-32.0)
        return M(hp + R @ Vector((-0.05, 0.0, 0.035 * k)), R)

    class Pencil:
        def apply(self, fam_, pose, S, ctx):
            ps = fam_.sk.fk(pose, ctx["trans"])
            m = book_m(ps)
            t = ctx["t"] % T
            line = int((t % 5.6) / 1.4) if t < 5.6 else 3
            u = ((t % 5.6) % 1.4) / 1.4 if t < 5.6 else 0.0
            x = lerp(0.08, -0.10, smootherstep(u / 0.85)) if u < 0.85 else lerp(-0.10, 0.08, smootherstep((u - 0.85) / 0.15))
            wig = 0.004 * math.sin(TAU * 10.0 * t)
            lift = 0.0 if u < 0.85 and t < 5.6 else 0.02
            p = m @ Vector((x * k, (0.05 - 0.035 * line) * k + wig, 0.012 + lift + 0.01 * up(ctx["t"])))
            pl = Palm(lambda f, S_, c: p, lambda f, S_, c: m.to_3x3() @ Vector((0.3, 0.6, -0.8)),
                      lambda f, S_, c: m.to_3x3() @ Vector((0.4, 0.0, -1.0)), lambda f, S_, c: V(-1.0, -0.5, -0.6),
                      shape="pinch")
            return pl.apply(fam_, pose, S, ctx)

    sp.arms = {"L": lhand, "R": Pencil()}
    sp.things_late = lambda t, ctx, ps: {"book": (book_m(ps), None)}
    sp.thing_meta = {"book": {"model": "book"}}
    sp.weight = ci.weights(T, [(0.6, 1.4, 0.64), (4.6, 1.6, 0.42), (7.6, 0.7, 0.5)])
    base = ci.look(T, [(5.7, 0.5, 14.0, -36.0, 0.0), (7.3, 0.6, 0.0, 0.0, 0.0)], seed=seed, drift_deg=1.0)
    sp.look = lambda t: (base(t)[0], base(t)[1] + 34.0, base(t)[2])
    sp.trunk = lambda t: (4.0, 0.0, 0.0)
    sp.meta = {"work": "write", "view": "stand"}
    return sp


# ---------------------------------------------------------------- begging, calling, smoking


def beg(fam, T=8.0, seed=431):
    """Stooped by the church door, the right hand held out cupped for alms and lifted a little toward each passer
    (a nod with it), the head bowed and turning up now and then, the left hand on the chest."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    ask = lambda t: ci.pulse(t % T, 1.0, 2.6, 0.35, 0.6) + ci.pulse(t % T, 5.0, 6.6, 0.35, 0.6)
    hand = Palm(lambda f, S, c: V(-0.10, 0.36 + 0.06 * ask(c["t"]), 0.92 + 0.04 * ask(c["t"])) * k,
                lambda f, S, c: V(0.2, 1.0, 0.1), lambda f, S, c: V(0.0, 0.0, 1.0), lambda f, S, c: V(-1.0, -0.6, -0.6),
                shape="cup")
    sp.arms = {"R": hand, "L": ci.on_chest()}
    sp.trunk = lambda t: (20.0 + 4.0 * ask(t), 0.0, 0.0)
    sp.hips = lambda t: (0.0, 6.0, 0.0)
    sp.dz = lambda t: -0.03 * k
    base = ci.look(T, [(1.1, 0.4, -6.0, -12.0, 4.0), (2.4, 0.6, 0.0, 0.0, 0.0), (5.1, 0.4, 10.0, -10.0, -3.0),
                       (6.4, 0.6, 0.0, 0.0, 0.0)], seed=seed)
    sp.look = lambda t: (base(t)[0], base(t)[1] + 16.0 + ci.nods(t % T, 1.6, 2, 5.0) + ci.nods(t % T, 5.6, 2, 5.0),
                         base(t)[2])
    sp.jaw = ci.speech([(1.2, 2.2), (5.2, 6.2)], seed, amp=4.0)
    sp.weight = ci.weights(T, [(0.5, 1.5, 0.6), (4.0, 1.5, 0.42), (7.0, 0.8, 0.5)])
    sp.meta = {"work": "beg"}
    return sp


def call(fam, T=6.4, seed=441):
    """A street cry: a breath (the chest lifts), the right hand goes up to the side of the mouth, the head comes
    up and the cry goes out for a second and a half (the jaw wide, the trunk leaning into it at the end), the hand
    comes down; then a look round for buyers."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    cry = lambda t: ci.pulse(t % T, 0.9, 2.6, 0.25, 0.4)
    breath_in = lambda t: ci.pulse(t % T, 0.2, 1.2, 0.5, 0.3)

    def at(fam_, S, ctx):
        return ci.spot_head(fam_, "jaw", S, clear=0.035) + V(0.0, 0.035, 0.0) * fam_.k

    cup = ci.Place(at, lambda f, S, c: V(-0.15 * sgn(S), 0.35, 1.0), lambda f, S, c: V(-sgn(S) * 0.9, 0.4, 0.0),
                   lambda f, S, c: V(sgn(S) * 1.0, -0.2, -0.6), shape="cup", bone="head")
    rest = ci.hands_front()["R"] if fam.P["female"] else ci.Hang()
    sp.arms = {"R": ci.ArmTrack([(0.0, rest, 0.3), (0.55, cup, 0.45), (2.75, rest, 0.6)], T),
               "L": ci.hands_front()["L"] if fam.P["female"] else ci.Hang()}
    sp.trunk = lambda t: (-3.0 * breath_in(t) - 4.0 * cry(t) + 5.0 * ci.pulse(t % T, 2.0, 2.9, 0.3, 0.4), 0.0, 0.0)
    base = ci.look(T, [(3.2, 0.6, 26.0, 0.0, 0.0), (4.4, 0.7, -18.0, 2.0, 0.0), (5.7, 0.6, 0.0, 0.0, 0.0)],
                   seed=seed)
    sp.look = lambda t: (base(t)[0], base(t)[1] - 14.0 * cry(t), base(t)[2] + 3.0 * cry(t))
    sp.jaw = lambda t: 0.6 + cry(t) * (11.0 + 3.0 * math.sin(TAU * 2.2 * (t % T)))
    sp.breath_amp = 1.2
    sp.weight = ci.weights(T, [(0.4, 0.8, 0.58), (3.0, 1.0, 0.44), (5.4, 0.8, 0.5)])
    sp.meta = {"work": "call"}
    return sp


def smoke(fam, T=8.0, seed=451):
    """A man on his step with his pipe: the left hand deep in the pocket, the pipe in the right hand at the
    chest; up to the mouth for a pull (the head steady, the cheeks working), down again, the smoke let out with
    the head tipped back a little; a look along the street."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    pull = lambda t: ci.pulse(t % T, 0.8, 2.6, 0.5, 0.55)

    def mouth(fam_, S, ctx):
        return ci.spot_head(fam_, "chin", S, clear=0.05) + V(-0.03, 0.04, 0.025) * fam_.k

    at_mouth = ci.Place(mouth, lambda f, S, c: V(0.6, 0.2, 0.8), lambda f, S, c: V(0.8, -0.2, 0.0),
                        lambda f, S, c: V(-1.0, -0.3, -0.7), shape="pinch", bone="head")
    low = ci.Place(lambda f, S, c: ci.spot_front(f, 0.66, -0.06 * f.k, clear=0.09),
                   lambda f, S, c: V(0.7, 0.4, 0.4), lambda f, S, c: V(0.6, -0.2, 0.6),
                   lambda f, S, c: V(-1.0, -0.4, -0.6), shape="pinch", bone="chest")
    sp.arms = {"L": ci.in_pocket(), "R": ci.ArmTrack([(0.0, low, 0.3), (0.8, at_mouth, 0.55), (2.5, low, 0.7)], T)}

    def pipe(t, ctx, ps):
        p = ps.point("handR", fam.sk.rest["handR"] + fam.palm["R"] * 1.6 + V(0.0, 0.0, 0.0))
        return {"pipe": (M(p, ps.D["handR"] @ RY(90.0) @ RZ(-20.0)), None)}

    sp.things_late = pipe
    sp.thing_meta = {"pipe": {"model": "pipe", "attach": "handR"}}
    base = ci.look(T, [(3.6, 0.6, -22.0, -2.0, 0.0), (5.4, 0.7, 12.0, 0.0, 0.0), (7.0, 0.6, 0.0, 0.0, 0.0)],
                   seed=seed)
    exhale = lambda t: ci.pulse(t % T, 2.6, 3.6, 0.3, 0.5)
    sp.look = lambda t: (base(t)[0], base(t)[1] - 8.0 * exhale(t), base(t)[2])
    sp.jaw = lambda t: 0.6 + 1.5 * pull(t) + 3.0 * exhale(t)
    sp.weight = ci.weights(T, [(0.6, 1.4, 0.68), (4.4, 1.6, 0.4), (7.2, 0.7, 0.5)])
    sp.trunk = lambda t: (-1.0 - 2.0 * exhale(t), 0.0, 0.0)
    sp.meta = {"work": "smoke"}
    return sp


# ---------------------------------------------------------------- against a wall, at a rail


def wall(fam, T=10.0, seed=461):
    """A lad leaning back against a house wall: the shoulders and the backside against it, arms folded, the left
    foot planted out before him, the right foot up flat against the wall behind (the knee forward); he looks along
    the street, the weight easing now and then."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    footL = planted(fam, "L", 0.08, 0.20, 8.0)
    sl = lambda t: 0.5 + 0.5 * math.sin(TAU * t / T)

    def hips_at(t):
        qh = bow(-6.0) @ lean(2.0 * (sl(t) - 0.5))
        return fam.sk.rest["hips"] + Vector((0.01, 0.10 * k, -0.07 * k - 0.01 * sl(t) * k)), qh

    sp.hips_at = hips_at
    sp.feet_at = lambda t: {"L": footL, "R": {"flat": V(-0.10, -0.17, 0.40) * k, "yaw": -8.0, "roll_min": 0.0,
                                              "swing": True, "ankle": V(-0.10, -0.17, 0.40) * k,
                                              "rot": RZ(-8.0) @ RX(88.0), "toe": Quaternion(), "pole": V(-0.2, 1.0, 0.3)}}
    sp.trunk = lambda t: (-9.0, 0.0, 0.0)
    sp.arms = ci.folded()
    sp.look = ci.look(T, [(1.5, 1.0, 34.0, -2.0, 0.0), (4.2, 1.0, 0.0, 0.0, 0.0), (6.5, 0.9, -20.0, 2.0, 2.0),
                          (8.6, 1.0, 0.0, 0.0, 0.0)], seed=seed)
    sp.keep = 0.3
    sp.meta = {"work": "wall", "wall": -0.26,
               "_props": [("box", M(V(0.0, -0.38, 1.2) * k), (2.0, 0.2, 2.4), "stone")]}
    return sp


def lean_rail(fam, T=9.6, seed=471):
    """Leaning on a rail (a quay's railing, about 1.05 m high and half a metre out): bent over it, the forearms on
    it, the hands hanging loosely over the far side, the weight on the left leg, the right knee easy; looking out
    over the water and along it."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"R": (-0.02, -0.06, -6.0)})
    sp.weight = ci.weights(T, [(0.6, 1.6, 0.76), (5.0, 1.8, 0.62), (8.4, 1.0, 0.5)])
    sp.fwd = lambda t: -0.12 * k
    sp.dz = lambda t: -0.03 * k
    sp.hips = lambda t: (0.0, 18.0, 0.0)
    sp.trunk = lambda t: (34.0, 0.0, 0.0)
    sp.look = ci.look(T, [(1.2, 1.2, 30.0, -20.0, 0.0), (4.4, 1.2, 0.0, -14.0, 0.0), (6.2, 1.0, -24.0, -16.0, 2.0),
                          (8.6, 0.9, 0.0, 0.0, 0.0)], seed=seed)
    sp.keep = 0.3
    rail = (0.52, 1.05)

    def over(fam_, S, ctx):
        return V(sgn(S) * 0.09, rail[0] + 0.12, rail[1] + 0.035) * k

    sp.arms = {S: ci.Place(over, lambda f, S_, c: V(-sgn(S_) * 0.3, 0.5, -0.8), lambda f, S_, c: V(-sgn(S_), 0.0, -0.4),
                           lambda f, S_, c: V(sgn(S_) * 0.5, -0.2, -1.0), shape="relaxed", bone=None, wrist=True,
                           hand=(-10.0, 35.0, 0.0)) for S in "LR"}
    sp.meta = {"work": "lean", "rail": list(rail),
               "_props": [("cyl", M(V(0.0, rail[0], rail[1] - 0.03) * k), (0.03, 2.0), "iron")]}
    return sp


# ---------------------------------------------------------------- the sign of the cross; pointing up


def spot_forehead(fam):
    from . import body as bd
    h = fam.sk.rest["head"]
    return fam.skin(Vector((0.0, h.y, bd.Y(fam.P, 0.955))), (0.0, -1.0, 0.25), 0.012)


def cross(fam, T=10.0, seed=481):
    """The sign of the cross before a Madonna on a house front: the right hand touches the forehead, the breast,
    the left shoulder and the right one, then the hands come together in prayer before the chest and the head
    bows a while; the hands come down again."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    female = fam.P["female"]
    rest = ci.hands_front() if female else ci.still()

    def touch(where):
        def at(fam_, S, ctx):
            if where == "head":
                return spot_forehead(fam_)
            if where == "chest":
                return ci.spot_front(fam_, 0.73, 0.0, clear=0.03)
            return ci.spot_front(fam_, 0.79, (0.11 if where == "left" else -0.11) * fam_.k, clear=0.035)
        return ci.Place(at, lambda f, S, c: V(0.2, 0.3, 1.0), lambda f, S, c: V(0.0, -1.0, 0.1),
                        lambda f, S, c: V(-1.0, -0.4, -0.8), shape="beat", bone="chest" if where != "head" else "head")

    def pray(S):
        def at(fam_, S_, ctx):
            return ci.spot_front(fam_, 0.73, sgn(S_) * 0.012, clear=0.13)
        return ci.Place(at, lambda f, S_, c: V(0.0, 0.55, 0.8), lambda f, S_, c: V(-sgn(S_), 0.0, 0.0),
                        lambda f, S_, c: V(sgn(S_) * 1.0, -0.3, -0.8), shape="open", bone="chest")

    keys = [(0.0, rest["R"], 0.3), (0.6, touch("head"), 0.55, 0.04), (1.35, touch("chest"), 0.45),
            (2.0, touch("left"), 0.4), (2.6, touch("right"), 0.35), (3.2, pray("R"), 0.5), (7.6, rest["R"], 0.8)]
    sp.arms = {"R": ci.ArmTrack(keys, T), "L": ci.ArmTrack([(0.0, rest["L"], 0.3), (3.15, pray("L"), 0.55),
                                                         (7.6, rest["L"], 0.8)], T)}
    bowh = lambda t: ci.pulse(t % T, 3.5, 7.4, 0.7, 0.8)
    sp.look = lambda t: (0.0, -10.0 + 26.0 * bowh(t) + 6.0 * ci.pulse(t % T, 0.5, 3.2, 0.4, 0.5), 0.0)
    sp.trunk = lambda t: (5.0 * bowh(t), 0.0, 0.0)
    sp.jaw = ci.speech([(3.8, 6.8)], seed, amp=2.0, rate=(0.18, 0.3))
    sp.meta = {"work": "cross"}
    return sp


def point_up(fam, T=8.0, seed=491):
    """A traveller looks up at the spire and points it out, the guidebook open in his right hand at his chest:
    the head goes up first, then the arm; he looks down at the book and up again."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)

    def up_at(fam_, S, ctx):
        return fam_.sk.rest["armUpL"] + V(0.12, 0.38, 0.42) * fam_.k

    pointing = ci.Place(up_at, lambda f, S, c: V(0.15, 0.6, 0.8), lambda f, S, c: V(0.0, 0.0, -1.0),
                        lambda f, S, c: V(0.6, -0.4, -1.0), shape="point", bone="upperChest")
    book = ci.Place(lambda f, S, c: ci.spot_front(f, 0.66, -0.03 * f.k, clear=0.2),
                    lambda f, S, c: V(0.8, 0.5, 0.2), lambda f, S, c: V(0.0, -0.3, 1.0),
                    lambda f, S, c: V(-1.0, -0.6, -0.5), shape="cup", bone="chest", hand=(70.0, -5.0, 0.0))
    sp.arms = {"L": ci.ArmTrack([(0.0, ci.Hang(), 0.3), (1.0, pointing, 0.7, 0.06), (4.4, ci.Hang(), 0.8)], T),
               "R": book}
    up = lambda t: ci.pulse(t % T, 0.6, 4.6, 0.6, 0.7)
    sp.look = lambda t: (-8.0 * up(t), 28.0 - 62.0 * up(t), 0.0)
    sp.lead = 0.3
    sp.trunk = lambda t: (-5.0 * up(t), 0.0, 0.0)
    sp.jaw = ci.speech([(1.6, 3.4)], seed, amp=4.0)
    sp.weight = ci.weights(T, [(0.6, 1.0, 0.62), (5.0, 1.2, 0.5)])

    def book_m(t, ctx, ps):
        p = ps.point("handR", fam.sk.rest["handR"] + fam.palm["R"])
        heading, fy = heading_of(ps)
        R = heading @ RX(-40.0)
        return {"book": (M(p + R @ Vector((0.0, 0.0, 0.03)), R), None)}

    sp.things_late = book_m
    sp.thing_meta = {"book": {"model": "book"}}
    sp.meta = {"work": "point_up"}
    return sp


# ---------------------------------------------------------------- lace, the grinder, the oars, the velocipede


def lace(fam, T=8.25, seed=501):
    """At the door on her chair, the lace pillow on its stand before her knees: the bobbins crossed and passed
    from hand to hand at the pillow's face, small quick movements of the fingers, now and then a pin set into the
    pillow higher up; the head bent over the work."""
    k = fam.k
    sp = ci.sit(fam, "chair", T=T, seed=seed, lean_=20.0, tilt=-6.0,
                feet={"L": (0.07, 0.36, 4.0), "R": (-0.07, 0.34, -4.0)}, knees_out=0.05)

    def at(S):
        def fn(fam_, S_, ctx):
            t = ctx["t"]
            ph = 0.0 if S == "L" else math.pi
            pin = ci.pulse(t % T, 3.4, 4.4, 0.25, 0.3) if S == "R" else 0.0
            x = sgn(S) * 0.055 + 0.025 * math.sin(TAU * t / 0.75 + ph)
            y = 0.42 + 0.012 * math.cos(TAU * t / 0.75 + ph)
            z = 0.64 + 0.015 * math.sin(TAU * t / 0.375 + ph)
            p = V(x, y, z) * k
            return p.lerp(V(0.02, 0.44, 0.72) * k, pin)
        return fn

    sp.arms = {S: ci.Place(at(S), lambda f, S_, c: V(-sgn(S_) * 0.3, 1.0, -0.3), lambda f, S_, c: V(-sgn(S_) * 0.3, 0.0, -1.0),
                           lambda f, S_, c: V(sgn(S_) * 1.0, -0.4, -0.5), shape="pinch", bone=None) for S in "LR"}
    base = sp.look
    sp.look = lambda t: (0.6 * base(t)[0], 30.0 + 0.3 * base(t)[1], base(t)[2])
    sp.meta = dict(sp.meta)
    sp.meta.update({"work": "lace", "view": "sit",
                    "_props": [("box", M(V(0.0, 0.0, 0.225) * k), (0.42, 0.40, 0.45), "wood"),
                               ("cyl", M(V(0.0, 0.59, 0.68) * k), (0.13, 0.44), "cloth")]})
    return sp


def grind(fam, T=4.8, seed=511):
    """The knife grinder at his wheel: the right foot works the treadle (six strokes a loop), the weight on the
    left leg; both hands hold the blade to the stone, drawing it along in short strokes; the head bent over it."""
    k = fam.k
    sp = WSpec(fam, T, loop=True, base={"L": (0.04, 0.0, 6.0)})
    pump = lambda t: 0.5 + 0.5 * math.cos(TAU * t / 0.8)

    def feet_at(t):
        L_ = planted(fam, "L", 0.13, 0.0, 6.0)
        L_["flat"] = sp.fam.base_flat("L")[0]
        a = V(-0.12, 0.26, 0.07 + 0.065 * pump(t)) * k
        rot = cm.foot_rot(-6.0, 0.0, 12.0 * pump(t) - 4.0)
        return {"L": L_, "R": {"flat": a, "yaw": -6.0, "roll_min": 0.0, "swing": True, "ankle": a, "rot": rot,
                               "toe": Quaternion(), "pole": V(-0.1, 1.0, 0.2)}}

    sp.feet_at = feet_at
    sp.weight = lambda t: 0.85
    sp.trunk = lambda t: (20.0 + 1.5 * pump(t), 0.0, 0.0)
    sp.hips = lambda t: (0.0, 8.0, 0.0)
    sp.look = lambda t: (0.0, 30.0, 0.0)
    sp.keep = 0.3
    stroke = lambda t: math.sin(TAU * t / 1.6)
    stone = V(0.0, 0.50, 0.98) * k

    def knife_at(t, fam_, S, ctx):
        return stone + V(-0.08 + 0.03 * stroke(t), -0.04, -0.01) * k, V(1.0, 0.1, -0.1), V(-0.3, 0.6, 1.0)

    blade = Palm(lambda f, S, c: stone + V(0.05 + 0.03 * stroke(c["t"]), -0.02, 0.02) * k, lambda f, S, c: V(0.6, 0.6, -0.4),
                 lambda f, S, c: V(0.0, 0.2, -1.0), lambda f, S, c: V(1.0, -0.5, -0.4), shape="pinch")
    sp.arms = {"R": Along(knife_at, lambda f, S, c: V(-1.0, -0.6, -0.5), r=0.013), "L": blade}
    sp.held = [{"model": "knife", "socket": "gripR"}]
    sp.meta = {"work": "grind", "held": sp.held, "stone": [0.0, 0.98, 0.5],
               "_props": [("cyl", M(stone + V(0.0, 0.05, -0.22) * k), (0.22, 0.07), "stone")]}
    return sp


ROW = {"seat": 0.45, "rowlock": (0.77, 0.68, 0.24), "stretcher": (0.55, 0.12)}


def row(fam, T=2.0, seed=521):
    """Rowing, seated on a thwart, the feet braced on the stretcher: the catch (leaning forward, the arms long, the
    blades going in), the drive (the legs and the back, the handles drawn to the lower ribs, leaning back), the
    recovery (the hands away first, the body after). The game sets the phase: the drive from 0 to 0.42 (as its
    oars)."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    H_ = ci.sit_height(fam, ROW["seat"])
    sp.seat = dict(H=H_, hips=(0.0, 0.0), pole={S: V(sgn(S) * 0.3, 1.0, 0.3) for S in "LR"})
    sf, sz = ROW["stretcher"]
    sp.feet_at = lambda t: {S: {"flat": cm.stance_flat(fam.sk, S, sf * k, sgn(S) * 0.12 * k, lambda p: sz * k, 0.0, sgn(S) * 6.0),
                                "yaw": sgn(S) * 6.0, "roll_min": 0.0, "swing": False} for S in "LR"}

    def drive(t):
        u = (t % T) / T
        if u < 0.42:
            return smootherstep(u / 0.42)
        return 1.0 - smootherstep((u - 0.42) / 0.58)

    sp.hips = lambda t: (0.0, -4.0 - 10.0 * drive(t) + 14.0 * (1 - drive(t)), 0.0)
    sp.trunk = lambda t: (24.0 - 40.0 * drive(t), 0.0, 0.0)
    sp.look = lambda t: (0.0, -6.0 + 8.0 * drive(t), 0.0)
    sp.keep = 0.25
    hand_x = 0.15

    def handle(S):
        def fn(t, fam_, S_, ctx):
            d = drive(t)
            u = (t % T) / T
            low = 0.0 if u < 0.42 else math.sin(math.pi * (u - 0.42) / 0.58) * 0.03
            p = V(sgn(S) * hand_x, lerp(0.62, 0.20, d), ROW["seat"] + lerp(0.20, 0.31, d) - low) * k
            lock = V(sgn(S) * ROW["rowlock"][0], ROW["rowlock"][1], ROW["seat"] + ROW["rowlock"][2]) * k
            ax = (lock - p).normalized()
            return p, ax, Vector((0.0, 1.0, -0.4))
        return fn

    sp.arms = {S: Along(handle(S), (lambda S_: lambda f, S2, c: V(sgn(S_) * 1.0, -0.2, -0.8))(S), r=0.018) for S in "LR"}

    def oars(t, ctx, ps):
        out = {}
        for S in "LR":
            p, ax, _ = handle(S)(t, fam, S, ctx)
            R = Matrix((ax, Vector((0, 0, 1)).cross(ax).normalized(), ax.cross(Vector((0, 0, 1)).cross(ax).normalized()))).transposed()
            out["oar" + S] = (M(p - ax * 0.08, R.to_quaternion()), None)
        return out

    sp.things_late = oars
    sp.thing_meta = {"oarL": {"model": "oar"}, "oarR": {"model": "oar"}}
    sp.meta = {"work": "row", "view": "sit", "seat": ROW["seat"], "phase": "drive 0 .. 0.42 (as the game's oars)",
               "_props": [("box", M(V(0.0, -0.02, ROW["seat"] - 0.02) * k), (1.2, 0.22, 0.04), "wood"),
                          ("box", M(V(0.0, sf + 0.06, sz) * k), (0.6, 0.05, 0.12), "wood")]}
    return sp


RIDE = {"hub": (0.61, 0.287), "crank": 0.13, "pedal": 0.135, "grip": (0.36, 0.50, 0.917)}


def ride(fam, T=1.0, seed=531):
    """Pedalling a boneshaker: seated, a little forward over the bar, the hands on the grips, the feet on the
    pedals of the front hub. One loop is one turn of the wheel (the game sets the phase from the wheel; the right
    pedal down at 0). The body as the old clip had it: the game raises the node to the saddle."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    hf, hu = RIDE["hub"]
    r = RIDE["crank"]

    def pedal(S, t):
        th = TAU * t / T
        sg = -1.0 if S == "R" else 1.0
        return V(sgn(S) * RIDE["pedal"], hf + sg * r * math.sin(th), hu + sg * r * math.cos(th)) * k

    def hips_at(t):
        th = TAU * t / T
        qh = bow(12.0) @ lean(1.5 * math.sin(th))
        return fam.sk.rest["hips"] + Vector((0.0, 0.05 * k, -0.01 * k + 0.004 * k * math.cos(2 * th))), qh

    def feet_at(t):
        out = {}
        th = TAU * t / T
        for S in "LR":
            p = pedal(S, t)
            sg = -1.0 if S == "R" else 1.0
            down = 0.5 - 0.5 * sg * math.cos(th)
            a = p + V(0.0, -0.10, 0.075) * k
            out[S] = {"flat": a, "yaw": 0.0, "roll_min": 0.0, "swing": True, "ankle": a,
                      "rot": cm.foot_rot(0.0, 0.0, 6.0 + 14.0 * down), "toe": Quaternion(), "pole": V(sgn(S) * 0.15, 1.0, 0.3)}
        return out

    sp.hips_at = hips_at
    sp.feet_at = feet_at
    sp.trunk = lambda t: (16.0, 0.0, 2.0 * math.sin(TAU * t / T))
    sp.look = lambda t: (0.0, -4.0, 0.0)
    sp.keep = 0.2
    gx, gf, gu = RIDE["grip"]

    def grip(S):
        def fn(t, fam_, S_, ctx):
            return V(sgn(S) * gx, gf, gu) * k, V(-sgn(S), 0.15, 0.0), Vector((0.0, 0.8, 0.6))
        return fn

    sp.arms = {S: Along(grip(S), (lambda S_: lambda f, S2, c: V(sgn(S_) * 1.0, -0.4, -0.6))(S), r=0.018) for S in "LR"}
    sp.meta = {"work": "ride", "phase": "one loop a turn of the front wheel; the right pedal down at 0",
               "_props": [("box", M(V(0.0, 0.03, 0.78) * k), (0.14, 0.26, 0.04), "wood"),
                          ("cyl", M(V(0.0, gf, gu) * k), (0.012, 0.84), "iron"),
                          ("cyl", M(V(0.0, hf, hu) * k) @ Matrix.Rotation(0.0, 4, "Z"), (0.46, 0.04), "iron")]}
    return sp


# ---------------------------------------------------------------- the children's games


def hop(fam, T=0.6, seed=541):
    """A hop (hopscotch, skipping): from the ground at 0 (the knees bent from the last landing), pushing off, the
    feet drawn up in the air, landing on the balls at 0.75 and giving at the knees. In place: the game moves the
    node between the squares (phase from the hop's progress)."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    base = {S: sp.fam.base_flat(S) for S in "LR"}

    def air(t):
        u = (t % T) / T
        return math.sin(math.pi * (u - 0.25) / 0.5) if 0.25 < u < 0.75 else 0.0

    def crouch_(t):
        u = (t % T) / T
        return 0.5 + 0.5 * math.cos(TAU * (u - 0.0)) if (u < 0.25 or u > 0.75) else 0.0

    def hips_at(t):
        qh = bow(6.0 + 6.0 * crouch_(t))
        return fam.sk.rest["hips"] + Vector((0.0, 0.0, (-0.03 - 0.06 * crouch_(t) + 0.13 * air(t)) * k)), qh

    def feet_at(t):
        out = {}
        a = air(t)
        u = (t % T) / T
        for S in "LR":
            flat, yw = base[S]
            if a > 0:
                ank = flat + Vector((0.0, 0.10 * a * k, (0.19 * a + 0.03) * k))
                out[S] = {"flat": flat, "yaw": yw, "roll_min": 0.0, "swing": True, "ankle": ank,
                          "rot": cm.foot_rot(yw, 0.0, 20.0 + 20.0 * a), "toe": RX(-10.0)}
            else:
                r = 20.0 * (1.0 - smoothstep(abs(u - (0.75 if u > 0.5 else 0.25)) / 0.12))
                out[S] = {"flat": flat, "yaw": yw, "roll_min": r, "swing": False}
        return out

    sp.hips_at = hips_at
    sp.feet_at = feet_at
    sp.arms = {S: ci.Hang(fwd=10.0, out=22.0, elbow=40.0) for S in "LR"}
    sp.trunk = lambda t: (6.0 + 4.0 * crouch_(t) - 4.0 * air(t), 0.0, 0.0)
    sp.look = lambda t: (0.0, 10.0, 0.0)
    sp.meta = {"work": "hop", "phase": "the ground at 0, up from 0.25, down at 0.75"}
    return sp


def rope_turn(fam, T=0.8, seed=551):
    """Turning one end of a skipping rope: the right hand swings it round in a circle at the side (one loop a
    turn), the forearm and the wrist doing most of it, the body bobbing a little with each turn, the left hand on
    the hip. The game draws the rope from this hand to the other turner's (phase: role 0 as is, role 1 reversed)."""
    k = fam.k
    sp = WSpec(fam, T, loop=True)
    c = V(-0.26, 0.20, 0.95) * k
    rr = 0.13 * k

    def hand(fam_, S, ctx):
        th = TAU * ctx["t"] / T
        return c + V(-0.02 * math.cos(th), rr * math.sin(th), -rr * math.cos(th))

    sp.arms = {"R": ci.Place(hand, lambda f, S, c_: V(0.3, 0.7, -0.4), lambda f, S, c_: V(0.6, 0.0, -0.5),
                             lambda f, S, c_: V(-1.0, -0.3, -0.5), shape="fist", bone=None, wrist=True),
               "L": ci.on_hips(knuckles=True)}
    sp.dz = lambda t: -0.008 * k * (0.5 + 0.5 * math.cos(2 * TAU * t / T))
    sp.trunk = lambda t: (2.0, 0.0, 3.0 * math.sin(TAU * t / T))
    sp.look = lambda t: (-20.0, 6.0, 0.0)
    sp.meta = {"work": "rope", "phase": "the hand at the bottom of its circle at 0"}
    return sp


# ---------------------------------------------------------------- the set

def recipes():
    """Every D3 clip: (name, family, maker(fam) -> Spec, meta)."""
    R = []

    def add(name, fam, fn, **meta):
        R.append((name, fam, fn, meta))

    add("sack_lift", "man", lambda f: sack_lift(f, "low"), role="sack_lift", motion="crouch", context="haul_sack")
    add("sack_lift_high", "man", lambda f: sack_lift(f, "high"), role="sack_lift", motion="crouch", context="haul_sack")
    add("sack_hold", "man", lambda f: sack_hold(f), role="sack_hold", motion="idle_sack", context="sack")
    add("sack_down", "man", lambda f: sack_down(f), role="sack_down", motion="crouch", context="sack")
    add("cask_roll", "man", lambda f: cask_roll(f.sk, f.ax, f), role="cask_roll", motion="push", context="cask")
    add("rope_haul", "man", lambda f: rope_haul(f), role="pull", motion="pull")
    add("winch", "man", lambda f: winch(f), role="winch", motion="pull", context="winch")
    add("gut", "wstout", lambda f: gut(f), role="gut", motion="idle", context="fish_stall")
    add("sweep", "woman", lambda f: sweep(f), role="scrub", motion="scrub", variant="sweep")
    add("man_sweep", "man", lambda f: sweep(f, seed=372), role="scrub", motion="scrub", variant="sweep")
    add("scrub", "woman", lambda f: scrub(f), role="scrub", motion="scrub")
    add("wash", "woman", lambda f: wash(f), role="wash", motion="wash")
    add("lace", "woman", lambda f: lace(f), role="lace", motion="lace")
    add("cross", "woman", lambda f: cross(f), role="cross", motion="cross")
    add("man_cross", "man", lambda f: cross(f, seed=482), role="cross", motion="cross")
    add("call", "man", lambda f: call(f), role="call", motion="call")
    add("woman_call", "woman", lambda f: call(f, seed=442), role="call", motion="call")
    add("smoke", "man", lambda f: smoke(f), role="smoke", motion="smoke")
    add("beg", "old", lambda f: beg(f), role="beg", motion="beg")
    add("man_beg", "man", lambda f: beg(f, seed=432), role="beg", motion="beg")
    add("wall", "man", lambda f: wall(f), role="wall", motion="wall")
    add("lean_rail", "man", lambda f: lean_rail(f), role="lean", motion="lean")
    add("point_up", "man", lambda f: point_up(f), role="point", motion="point")
    add("write", "man", lambda f: write(f), role="write", motion="write")
    add("rifle_idle", "man", lambda f: rifle_idle(f), role="rifle_idle", motion="idle", kind_="sentry")
    add("rifle_talk", "man", lambda f: rifle_talk(f), role="rifle_talk", motion="talk", kind_="sentry")
    add("rifle_walk", "man", lambda f: rifle_walk(f.sk, f.ax, f), role="rifle_walk", motion="walk", kind_="sentry",
        speed=1.35)
    add("grind", "man", lambda f: grind(f), role="grind", motion="grind")
    add("row", "man", lambda f: row(f), role="row", motion="row")
    add("ride", "man", lambda f: ride(f), role="ride", motion="ride")
    add("crouch", "man", lambda f: crouch(f), role="crouch", motion="crouch")
    add("child_crouch", "child", lambda f: crouch(f, T=3.2, seed=392), role="crouch", motion="crouch")
    add("hop", "child", lambda f: hop(f), role="hop", motion="hop")
    add("rope_turn", "child", lambda f: rope_turn(f), role="rope", motion="rope")
    return R


_FAMS = {}


def family(name, bodies):
    return ci.family(name, bodies)


def make_one(name, fam_name, fn, meta, bodies):
    fam = family(fam_name, bodies)
    if fam is None:
        return None
    spec = fn(fam)
    m = dict(meta)
    m.update(family=fam_name, female=fam.P["female"], kind="work")
    if isinstance(spec, mo.Clip):
        c = spec
        c.name = name
        for k_, v in m.items():
            c.meta.setdefault(k_, v)
        c.meta.setdefault("_gripErr", 0.0)
        return c, fam.b
    m.update(spec.meta)
    c = wevaluate(spec, name, m)
    return c, fam.b


def make_some(bodies, names=None):
    out = []
    want = set(names) if names else None
    if not want or want & {"sack_pass_give", "sack_pass_take"}:
        out += make_pass(bodies)
    for name, fam_name, fn, meta in recipes():
        if want and name not in want:
            continue
        r = make_one(name, fam_name, fn, meta, bodies)
        if r:
            out.append(r)
    return out


def worst_jerk(clip):
    """The bone and frame of the sharpest change of turning speed inside a clip (a flip shows here)."""
    P = clip.poses
    best = (0.0, None, 0)
    for i in range(1, len(P) - 1):
        for bn in KEYED:
            qa, qb, qc = P[i - 1].get(bn, Quaternion()), P[i].get(bn, Quaternion()), P[i + 1].get(bn, Quaternion())
            d1, d2 = qb @ qa.inverted(), qc @ qb.inverted()
            if d1.dot(d2) < 0:
                d2 = -d2
            a = math.degrees((Vector(d2.to_exponential_map()) - Vector(d1.to_exponential_map())).length)
            if a > best[0]:
                best = (a, bn, i)
    return best


def checks(clip):
    """D2's checks (the foot slide at the keys and as played, scuffs, the loop seam) and the hands on their grips
    (the largest distance of a handle's axis from where the fist holds it)."""
    chk = ci.checks(clip)
    chk["gripMm"] = round(1000 * clip.meta.get("_gripErr", 0.0), 2)
    chk["reachMm"] = round(1000 * clip.meta.get("_reachErr", 0.0), 2)
    if chk.get("jerkInside", 0.0) > 40.0:
        a, bn, i = worst_jerk(clip)
        print("[people2] work %s: a sharp turn of %s at frame %d (%.1f deg/frame^2)" % (clip.name, bn, i, a))
    return chk


def things_json(clip):
    """The things a clip moves, for the runtimes: attached to a bone (a constant offset, checked) or a track in the
    node's frame (game axes, every frame)."""
    out = {}
    frames = clip.meta.get("_things") or []
    if not frames or not frames[0]:
        return out
    tm = clip.meta.get("_thingMeta", {})
    for name in frames[0]:
        info = dict(tm.get(name, {}))
        bone = info.pop("attach", None)
        if bone:
            offs = []
            for i, fr in enumerate(frames):
                ps = clip.skel.fk(clip.poses[i], clip.trans[i])
                Mb = M(ps.P[bone], ps.D[bone] @ clip.skel.restq[bone])
                offs.append(Mb.inverted() @ fr[name][0])
            o = offs[0]
            drift = max((x.to_translation() - o.to_translation()).length for x in offs)
            turn_drift = max(mo.angle(x.to_quaternion(), o.to_quaternion()) for x in offs)
            p, q = local_game(o)
            info.update(bone=bone, offset=p, turn=q, driftMm=round(1000 * drift, 3), driftDeg=round(turn_drift, 3))
        else:
            keys = []
            for i, fr in enumerate(frames):
                m, size = fr[name]
                p, q = to_game(m)
                key = [round(i / FPS, 4)] + p + q
                if size:
                    # the size as the game model has it: length, thickness (up), width
                    key += [round(size[0], 3), round(size[2], 3), round(size[1], 3)]
                keys.append(key)
            info["keys"] = keys
        out[name] = info
    return out


def public_meta(clip, chk):
    m = {k: v for k, v in clip.meta.items() if not k.startswith("_")}
    m["frames"] = clip.frames
    m["loop"] = clip.loop
    m["checks"] = chk
    th = things_json(clip)
    if th:
        m["things"] = th
    if clip.meta.get("work") in ("sack_lift", "sack_hold", "sack_down", "sack_pass", "cask_roll", "rope_haul", "winch", "sweep"):
        # Wrist frames relative to the held object's frame. Runtime re-solves both arms after
        # attention/foot layers; bone-attached sacks therefore remain in contact during blending.
        model = next(iter(th), "")
        if model and th[model].get("from") == "partner":
            model = ""
        contacts = {"model": model, "keys": []}
        for i, pose in enumerate(clip.poses):
            ps = clip.skel.fk(pose, clip.trans[i])
            obj = clip.meta["_things"][i].get(model, (Matrix.Identity(4), None))[0] if model else Matrix.Identity(4)
            # Palms slide on rolling staves: use the unspun frame, not the rotating surface.
            if model == "cask":
                obj = M(obj.to_translation())
            row = []
            for S in "LR":
                wrist = obj.inverted() @ ps.frame("hand" + S)
                p, _ = to_game(wrist)
                # A hand frame's axes are bone axes, so only the object's axes convert on the left.
                R = C_GAME @ wrist.to_3x3()
                qh = R.to_quaternion()
                row.extend(p + [round(qh.x, 6), round(qh.y, 6), round(qh.z, 6), round(qh.w, 6)])
            contacts["keys"].append(row)
        m["handContacts"] = contacts
    return m


def make_all(bodies, target_ao, log=print, names=None):
    """Make every D3 clip on its own body, check it, key it on target_ao. Returns (actions, meta, made)."""
    by = {b["name"]: b for b in bodies}
    ci._FAMS.clear()
    made = make_some(by, names)
    LOADS_JSON.clear()
    LOADS_JSON.update(loads_json(by))
    actions, meta = [], {}
    for c, b in made:
        chk = checks(c)
        meta[c.name] = public_meta(c, chk)
        log("[people2] work %-20s %3d frames  slide %s mm (played %s), scuff %s mm, grips %s mm, reach %s mm%s" % (
            c.name, c.frames, chk["slideKeysMm"], chk["slidePlayedMm"], chk["scuffMm"],
            "%s%s" % (chk["gripMm"], " %s" % (c.meta.get("_gripAt"),) if chk["gripMm"] > 5 else ""),
            "%s%s" % (chk["reachMm"], " %s" % (c.meta.get("_reachAt"),) if chk["reachMm"] > 5 else ""),
            ", seam %.4f deg, jerk %.2f (inside %.2f)" % (chk["seamDeg"], chk["seamJerk"], chk["jerkInside"])
            if "seamDeg" in chk else ""))
        actions.append(mo.key_clip(target_ao, c))
    return actions, meta, made


# family -> the family it falls back on for a work motion it has no clip for
WORK_FALLBACK = {"man": None, "stout": "man", "woman": "man", "wstout": "woman", "old": "man", "oldw": "woman",
                 "child": "man"}
# kinds whose load decides their clips (Humans.OwnClips): the game's motion -> the clip
KIND_CLIPS = {"sentry": {"walk": "rifle_walk", "idle": "rifle_idle", "talk": "rifle_talk", "write": "rifle_idle"},
              "docker_sack": {"walk": "sack_walk", "carry": "sack_walk", "idle": "sack_hold"},
              "porter": {"walk": "truck_push", "carry": "truck_push", "push": "truck_push", "idle": "truck_push_hold"},
              "carter": {"walk": "cart_push", "carry": "cart_push", "push": "cart_push", "idle": "cart_push_hold"}}
LOADS_JSON = {}


def loads_json(bodies):
    """Where a carried load rides (the D1 carry clips and the lifts): its bone, the offset and turn in the bone's
    own frame (a game model's axes: x along, y up, z across) and its size; the walk and the hold."""
    b = bodies.get("man_middling")
    if b is None:
        return {}
    fam = ci.family("man", bodies)
    sk = fam.sk
    out = {}
    c, q = shoulder_sack(fam)
    rest = M(sk.rest["upperChest"], sk.restq["upperChest"])
    p_, q_ = local_game(rest.inverted() @ M(c, q))
    out["sack"] = {"bone": "upperChest", "offset": p_, "turn": q_, "size": list(sack_on_shoulder_size()),
                   "walk": "sack_walk", "hold": "sack_hold", "lift": ["sack_lift", "sack_lift_high"], "down": "sack_down",
                   "note": "the one sack model on the left shoulder; size: length, width, thickness (the game model "
                           "scaled to length, thickness (up), width)"}
    L_ = cm.LOADS["crate"]
    cc = sk.rest["chest"] + V(*L_["centre"])
    rest = M(sk.rest["chest"], sk.restq["chest"])
    p_, q_ = local_game(rest.inverted() @ M(cc))
    out["crate"] = {"bone": "chest", "offset": p_, "turn": q_, "size": list(L_["size"]), "walk": "crate_walk",
                    "hold": "crate_hold", "note": "a crate (or a box of fish) held against the belly, its middle at "
                                                  "offset; size: across, deep, high"}
    return out


def families_json(meta):
    """Per family: the work clips that serve a game motion (variants, picked by the person's id) and those that
    serve a context the game knows (a docker at a sack pile, a fishwife at her fish table, a winch)."""
    fams = {}
    for name, m in meta.items():
        f = fams.setdefault(m.get("family", "man"), {"fallback": WORK_FALLBACK.get(m.get("family")), "motions": {},
                                                     "contexts": {}})
        if m.get("kind_"):
            continue
        ctx = m.get("context")
        if ctx and ctx != "sack":
            f["contexts"].setdefault(ctx, []).append(name)
        elif not ctx:
            f["motions"].setdefault(m.get("motion", ""), []).append(name)
    for fam, fb in WORK_FALLBACK.items():
        fams.setdefault(fam, {"fallback": fb, "motions": {}, "contexts": {}})
    return fams


def rig_json(meta):
    """peopleRig.json "work" (package D3)."""
    return {
        "about": "package D3 clips (art-source/tools/blender/people2/clips_work.py, docs/people.md 'Work'). Keyed like "
                 "D1 and D2 (hips translation on trackBase). things: what a clip moves, either on a bone (offset and "
                 "turn in the bone's frame, game axes) or a track in the node's frame (t, x, y, z, qx, qy, qz, qw[, "
                 "length, thickness, width]; scale positions by the body's hips over the clip body's). families: the "
                 "clips that serve a game motion (motions) or a context the game knows (contexts), picked by the "
                 "person's stable id; fallback: the family whose clips it borrows. kinds: kinds whose load decides "
                 "their clips. loads: where a carried load rides.",
        "sack": dict(SACK),
        "families": families_json(meta),
        "kinds": KIND_CLIPS,
        "loads": LOADS_JSON,
        "clips": meta,
    }

"""The 36 old clips on the new rig (docs/people.md "Clips").

The pose functions are the old kit's own (tools/blender/build_people.py, imported, not copied): the 16 old bones
get exactly the rotations they had, so a clip looks the same on the new body as on the old one. On top, from the
same pose, the new bones get what the old ones imply:
- armTwist: 0.6 of the hand's turn about the forearm, so a turned hand does not wring the wrist;
- clavicle: lifts (and goes forward) when the arm is raised past 30 degrees, and the upper arm is turned back by as
  much, so the arm points where it did and only the shoulder rises (a quarter of the excess, at most 30 degrees,
  about 7 cm at the shoulder with the arm straight up: the shoulder girdle's share of a raised arm);
- shoulderL/R (the helpers): half of armUp's swing (motion.shoulder_helpers), so a raised arm does not fold the
  shoulder and the armpit;
- fingers: a hand shape per clip and hand (relaxed, a grip round a handle, a pinch, open, pointing);
- jaw: moves while talking and calling.
chest, upperChest, toes, the skirt and coat bones stay at rest (D1-D3 author them). Every clip keys the same 51
bones (the 49 body bones and the 2 helpers; rotations only), so blends never meet a missing track.

Pose convention (as in the old kit, see docs/people.md): a pose is a dict bone -> quaternion in armature axes
(Blender: X the person's left, -Y forward, Z up), each a turn relative to the parent's turned frame; it becomes the
bone's local key by rest^-1 q rest.
"""

import math
import os
import sys

from mathutils import Quaternion, Vector

from . import FPS, B
from .motion import shoulder_helpers
from .rig import KEYED

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import build_people as old  # noqa: E402  (the old kit: pose functions and the clip list)

CLIPS = old.CLIPS
RX, RY, RZ = old.RX, old.RY, old.RZ

# finger shapes: (MCP, PIP, DIP) curls in degrees for index, middle, ring (the little finger rides on the ring
# chain); thumb: (across the palm, MCP, IP)
HANDS = {
    # a hand at rest curls more toward the little finger, the thumb lying in along the index
    "relaxed": dict(index=(16, 24, 11), middle=(21, 31, 14), ring=(27, 38, 17), thumb=(20, 10, 12)),
    # MakeHuman's longer proximal phalanges: keep the terminal segment below 180 degrees total,
    # so its pad approaches the palm instead of coming back through the metacarpals.
    "grip": dict(index=(45, 65, 28), middle=(48, 68, 30), ring=(50, 70, 30), thumb=(24, 22, 18)),
    "fist": dict(index=(58, 78, 32), middle=(60, 80, 32), ring=(62, 80, 32), thumb=(28, 26, 20)),
    "pinch": dict(index=(32, 42, 18), middle=(40, 50, 24), ring=(46, 58, 26), thumb=(24, 20, 16)),
    "open": dict(index=(3, 5, 3), middle=(4, 6, 3), ring=(6, 8, 4), thumb=(-4, 4, 4)),
    "point": dict(index=(2, 3, 2), middle=(60, 80, 32), ring=(62, 80, 32), thumb=(28, 26, 20)),
    "cup": dict(index=(16, 22, 14), middle=(18, 24, 14), ring=(22, 26, 16), thumb=(12, 10, 8)),
}
# (left, right) per clip; anything not named is relaxed
CLIP_HANDS = {
    "talk": ("relaxed", "open"), "talk_f": ("relaxed", "open"), "carry": ("grip", "grip"),
    "walk_sack": ("grip", "relaxed"), "idle_sack": ("grip", "relaxed"), "push": ("grip", "grip"),
    "push_idle": ("grip", "grip"), "rifle_idle": ("relaxed", "grip"), "rifle_walk": ("relaxed", "grip"),
    "rifle_talk": ("open", "grip"), "write": ("open", "pinch"), "ride": ("grip", "grip"), "row": ("grip", "grip"),
    "scrub": ("grip", "grip"), "lace": ("pinch", "pinch"), "cross": ("open", "open"), "point": ("point", "open"),
    "beg": ("relaxed", "cup"), "call": ("relaxed", "open"), "crouch": ("relaxed", "pinch"), "rope": ("relaxed", "grip"),
    "grind": ("grip", "grip"), "pull": ("grip", "grip"), "wash": ("grip", "grip"), "smoke": ("relaxed", "pinch"),
    "fold": ("cup", "cup"),
}
TALKING = {"talk": 1.0, "talk_f": 1.0, "rifle_talk": 1.0}
# the old stand with their knees a little bent: the standing clips they use most get a variant `<name>_old` for the
# stooped bodies (old_man, old_woman), the thighs forward, the knees bent and the feet flat, the hips lowered by as
# much as the legs shortened (docs/people.md "The old"); other standing clips: the games add the same turns
OLD_CLIPS = ("idle", "idle_f", "talk", "talk_f")
OLD_STANCE = {"thigh": 7.0, "knee": 14.0, "drop": 0.006}  # (#82: the first 5/10 degrees read too mild)


def thumb_axes(J):
    """The thumb's two turning axes (armature axes, per side): flex (toward the palm) and across the palm."""
    out = {}
    for S, sg in (("L", 1), ("R", -1)):
        h, t = J["thumb2" + S]
        d = Vector(B(*t)) - Vector(B(*h))
        d.normalize()
        u = Vector(B(0.55 * sg, 0.0, 0.85))
        u.normalize()
        flex = d.cross(-u)
        flex.normalize()
        across = d.cross(Vector(B(0, 0, -1)))  # swings the thumb back across the palm
        if across.length < 1e-6:
            across = Vector((0, 0, 1))
        across.normalize()
        out[S] = (flex, across)
    # MakeHuman's rest fingers are already flexed (17–40 degrees toward the palm).
    # HANDS describes anatomical curls from a straight chain, not additional rest-pose turns.
    out["fingerRest"] = {}
    for S, sg in (("L", 1), ("R", -1)):
        out["fingerRest"][S] = {}
        for f in ("index", "middle", "ring"):
            previous, angles = 0.0, []
            for k in (1, 2, 3):
                h, t = J[f + str(k) + S]
                d = Vector(t) - Vector(h)
                angle = math.degrees(math.atan2(-sg * d.x, -d.y))
                angles.append(angle - previous)
                previous = angle
            out["fingerRest"][S][f] = angles
    return out


def finger_turns(pose, S, h, axes):
    sg = 1 if S == "L" else -1
    for f in ("index", "middle", "ring"):
        rest = axes.get("fingerRest", {}).get(S, {}).get(f, (0, 0, 0))
        for k, deg in enumerate(h[f]):
            pose["%s%d%s" % (f, k + 1, S)] = RY(sg * (deg - rest[k]))


def hand_pose(pose, S, shape, axes):
    sg = 1 if S == "L" else -1
    h = HANDS[shape]
    finger_turns(pose, S, h, axes)
    flex, across = axes[S]
    a, m, i = h["thumb"]
    pose["thumb1" + S] = Quaternion(across, math.radians(a * 0.6)) @ Quaternion(flex, math.radians(a * 0.4))
    pose["thumb2" + S] = Quaternion(flex, math.radians(m))
    pose["thumb3" + S] = Quaternion(flex, math.radians(i))


# the shoulder girdle's share of a raised arm: the clavicle lifts by CLAV_RATE of the arm's rise past CLAV_FROM
# degrees, at most CLAV_MAX (the scapula and clavicle take about a third of a full raise in a real shoulder)
CLAV_FROM, CLAV_RATE, CLAV_MAX = 30.0, 0.25, 30.0


def shoulder_rule(pose):
    """An old-style arm pose (armUp turned as if the clavicle stayed at rest) to the new shoulder: the clavicle lifts
    and comes forward with a raised arm, armUp is turned back by as much (the arm points where it did), and the
    helpers follow armUp. Changes pose in place and returns it."""
    for S, sg in (("L", 1), ("R", -1)):
        qa = pose.get("armUp" + S, Quaternion())
        d = qa @ Vector((0, 0, -1))
        elev = math.degrees(math.acos(max(-1.0, min(1.0, -d.z))))
        # an arm swung back does not lift the shoulder (it draws it back and down): no lift for the backward part
        e = min(CLAV_MAX, CLAV_RATE * max(0.0, elev - CLAV_FROM)) * (1.0 - min(1.0, max(0.0, d.y / 0.6)))
        fwd = max(0.0, -d.y) * min(1.0, max(0.0, (elev - 35.0) / 40.0))
        qc = RZ(-sg * 10.0 * fwd) @ RY(-sg * e)
        pose["clavicle" + S] = qc
        pose["armUp" + S] = qc.inverted() @ qa
    return shoulder_helpers(pose)


def derive(pose, name, t, axes):
    """Add the new bones' turns to an old pose (see the module note)."""
    shoulder_rule(pose)
    for S, sg in (("L", 1), ("R", -1)):
        qh = pose.get("hand" + S, Quaternion())
        tw = Quaternion((qh.w, 0.0, 0.0, qh.z))
        if tw.magnitude > 1e-9:
            tw.normalize()
            pose["armTwist" + S] = Quaternion().slerp(tw, 0.6)
        L, R = CLIP_HANDS.get(name, ("relaxed", "relaxed"))
        hand_pose(pose, S, L if S == "L" else R, axes)
    p = 2 * math.pi * t
    if name in TALKING:
        pose["jaw"] = RX(1.5 + 4.5 * abs(math.sin(p * 7.0)) * (0.5 + 0.5 * math.sin(p * 2.0 + 1.0)))
    elif name == "call":
        cry = max(0.0, math.sin(p)) ** 1.5
        pose["jaw"] = RX(2 + 12 * cry)
    return pose


def old_stance(pose):
    """The old's knees (OLD_STANCE): each thigh swung forward, the knee bent, the foot turned back to stay flat.
    Changes pose in place and returns it."""
    th, kn = OLD_STANCE["thigh"], OLD_STANCE["knee"]
    for S in "LR":
        pose["legUp" + S] = RX(-th) @ pose.get("legUp" + S, Quaternion())
        pose["legLow" + S] = RX(kn) @ pose.get("legLow" + S, Quaternion())
        pose["foot" + S] = RX(th - kn) @ pose.get("foot" + S, Quaternion())
    return pose


def make_actions(ao, J):
    """Key every old clip on the armature ao (one NLA track each, muted, as the old kit), then the old's variants
    of the standing clips (OLD_CLIPS, named <clip>_old), which also key the hips lowered."""
    import bpy

    ad = ao.animation_data_create()
    bones = ao.data.bones
    rest = {bn: bones[bn].matrix_local.to_quaternion() for bn in KEYED}
    hrest = bones["hips"].matrix_local.to_3x3()
    axes = thumb_axes(J)
    actions = []
    todo = [(n, fn, secs, kw, False) for n, fn, secs, kw in CLIPS]
    todo += [(n + "_old", fn, secs, kw, True) for n, fn, secs, kw in CLIPS if n in OLD_CLIPS]
    for name, fn, secs, kw, old in todo:
        base = name[:-4] if old else name
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        frames = int(round(secs * FPS))
        step = 1 if name == "ride" else 2 if secs <= 1.0 or name == "cross" else 4
        for f in list(range(0, frames, step)) + [frames]:
            t = (f % frames) / frames
            pose = derive(fn(t, **kw), base, t, axes)
            if old:
                old_stance(pose)
                pb = ao.pose.bones["hips"]
                pb.location = hrest.inverted() @ Vector((0.0, 0.0, -OLD_STANCE["drop"]))
                pb.keyframe_insert("location", frame=f + 1)
            for bn in KEYED:
                q = pose.get(bn, Quaternion())
                local = rest[bn].inverted() @ q @ rest[bn]
                pb = ao.pose.bones[bn]
                pb.rotation_quaternion = local
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
        actions.append(act)
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        st.name = name
        tr.mute = True
        ad.action = None
    for pb in ao.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return actions


def pose_now(ao, name, t, J):
    """Set the armature to a clip's pose at loop fraction t (for the check pictures, without actions); a name
    ending in _old is that clip's variant for the old."""
    old = name.endswith("_old")
    base = name[:-4] if old else name
    fn, kw = None, None
    for n, f, secs, k in CLIPS:
        if n == base:
            fn, kw = f, k
    pose = derive(fn(t, **kw), base, t, thumb_axes(J))
    if old:
        old_stance(pose)
    set_pose(ao, pose)
    ao.pose.bones["hips"].location = ao.data.bones["hips"].matrix_local.to_3x3().inverted() @ Vector(
        (0.0, 0.0, -OLD_STANCE["drop"] if old else 0.0))


def set_pose(ao, pose):
    """Pose the armature (bones not in pose at rest); the shoulder helpers follow armUp if pose leaves them out."""
    if "shoulderL" not in pose:
        pose = shoulder_helpers(dict(pose))
    bones = ao.data.bones
    for pb in ao.pose.bones:
        q = pose.get(pb.name, Quaternion())
        r = bones[pb.name].matrix_local.to_quaternion()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = r.inverted() @ q @ r

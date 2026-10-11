"""The 36 old clips on the new rig (docs/people.md "Clips").

The pose functions are the old kit's own (tools/blender/build_people.py, imported, not copied): the 16 old bones
get exactly the rotations they had, so a clip looks the same on the new body as on the old one. On top, from the
same pose, the new bones get what the old ones imply:
- armTwist: 0.6 of the hand's turn about the forearm, so a turned hand does not wring the wrist;
- clavicle: lifts (and goes forward) when the arm is raised past 35 degrees, and the upper arm is turned back by as
  much, so the arm points where it did and only the shoulder rises (at most 13 degrees, about 3 cm);
- fingers: a hand shape per clip and hand (relaxed, a grip round a handle, a pinch, open, pointing);
- jaw: moves while talking and calling.
chest, upperChest, toes, the skirt and coat bones stay at rest (D1-D3 author them). Every clip keys the same 47 body
bones (rotations only), so blends never meet a missing track.

Pose convention (as in the old kit, see docs/people.md): a pose is a dict bone -> quaternion in armature axes
(Blender: X the person's left, -Y forward, Z up), each a turn relative to the parent's turned frame; it becomes the
bone's local key by rest^-1 q rest.
"""

import math
import os
import sys

from mathutils import Quaternion, Vector

from . import FPS, B
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
    "relaxed": dict(index=(9, 14, 8), middle=(12, 18, 10), ring=(17, 24, 13), thumb=(6, 8, 8)),
    "grip": dict(index=(62, 84, 40), middle=(68, 90, 44), ring=(74, 94, 46), thumb=(34, 30, 26)),
    "fist": dict(index=(84, 102, 62), middle=(88, 104, 64), ring=(90, 104, 64), thumb=(40, 40, 32)),
    "pinch": dict(index=(38, 46, 22), middle=(48, 58, 30), ring=(60, 70, 36), thumb=(26, 22, 20)),
    "open": dict(index=(3, 5, 3), middle=(4, 6, 3), ring=(6, 8, 4), thumb=(-4, 4, 4)),
    "point": dict(index=(2, 3, 2), middle=(84, 100, 60), ring=(88, 102, 62), thumb=(36, 36, 28)),
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
    return out


def hand_pose(pose, S, shape, axes):
    sg = 1 if S == "L" else -1
    h = HANDS[shape]
    for f in ("index", "middle", "ring"):
        for k, deg in enumerate(h[f]):
            pose["%s%d%s" % (f, k + 1, S)] = RY(sg * deg)
    flex, across = axes[S]
    a, m, i = h["thumb"]
    pose["thumb1" + S] = Quaternion(across, math.radians(a * 0.6)) @ Quaternion(flex, math.radians(a * 0.4))
    pose["thumb2" + S] = Quaternion(flex, math.radians(m))
    pose["thumb3" + S] = Quaternion(flex, math.radians(i))


def derive(pose, name, t, axes):
    """Add the new bones' turns to an old pose (see the module note)."""
    for S, sg in (("L", 1), ("R", -1)):
        qa = pose.get("armUp" + S, Quaternion())
        d = qa @ Vector((0, 0, -1))
        elev = math.degrees(math.acos(max(-1.0, min(1.0, -d.z))))
        e = min(13.0, 0.13 * max(0.0, elev - 35.0))
        fwd = max(0.0, -d.y) * min(1.0, max(0.0, (elev - 35.0) / 40.0))
        qc = RZ(-sg * 10.0 * fwd) @ RY(-sg * e)
        pose["clavicle" + S] = qc
        pose["armUp" + S] = qc.inverted() @ qa
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


def make_actions(ao, J):
    """Key every old clip on the armature ao (one NLA track each, muted, as the old kit)."""
    import bpy

    ad = ao.animation_data_create()
    bones = ao.data.bones
    rest = {bn: bones[bn].matrix_local.to_quaternion() for bn in KEYED}
    axes = thumb_axes(J)
    actions = []
    for name, fn, secs, kw in CLIPS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        frames = int(round(secs * FPS))
        step = 1 if name == "ride" else 2 if secs <= 1.0 or name == "cross" else 4
        for f in list(range(0, frames, step)) + [frames]:
            t = (f % frames) / frames
            pose = derive(fn(t, **kw), name, t, axes)
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
    return actions


def pose_now(ao, name, t, J):
    """Set the armature to a clip's pose at loop fraction t (for the check pictures, without actions)."""
    fn, kw = None, None
    for n, f, secs, k in CLIPS:
        if n == name:
            fn, kw = f, k
    pose = derive(fn(t, **kw), name, t, thumb_axes(J))
    set_pose(ao, pose)


def set_pose(ao, pose):
    bones = ao.data.bones
    for pb in ao.pose.bones:
        q = pose.get(pb.name, Quaternion())
        r = bones[pb.name].matrix_local.to_quaternion()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = r.inverted() @ q @ r

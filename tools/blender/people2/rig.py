"""The people2 skeleton: 60 bones, one layout for every body (docs/people.md "The skeleton").

The 16 bones of the old kit keep their names, their parents' chain and their rest directions (straight up, straight
down or straight forward, roll 0), so the 36 old clips play on the new bodies as they are. Every new bone that sits
between two old ones (chest, upperChest between spine and neck; clavicleL/R between the chest and the arms) also
points straight up with roll 0, so the rest turn from a parent to an old child stays the identity, as it was.

Kinds of bone:
- body: deform, keyed by the clips (47 of them);
- spring: skirt and coat-tail bones, deform but only weighted on clothes that have them; moved by springs in the games;
- socket: never deform, never keyed; things are hung on them (a weapon in the hand, a sabre on the hip, a load on
  the back, a hat on the head).
"""

import math

import numpy as np

from . import B
from . import body as bd

# name, parent, kind
BONES = [
    ("hips", None, "body"),
    ("spine", "hips", "body"),
    ("chest", "spine", "body"),
    ("upperChest", "chest", "body"),
    ("neck", "upperChest", "body"),
    ("head", "neck", "body"),
    ("jaw", "head", "body"),
]
for _S in "LR":
    BONES += [
        ("clavicle" + _S, "upperChest", "body"),
        ("armUp" + _S, "clavicle" + _S, "body"),
        ("armLow" + _S, "armUp" + _S, "body"),
        ("armTwist" + _S, "armLow" + _S, "body"),
        ("hand" + _S, "armLow" + _S, "body"),
        ("thumb1" + _S, "hand" + _S, "body"),
        ("thumb2" + _S, "thumb1" + _S, "body"),
        ("thumb3" + _S, "thumb2" + _S, "body"),
    ]
    for _f in ("index", "middle", "ring"):
        BONES += [(_f + "1" + _S, "hand" + _S, "body"), (_f + "2" + _S, _f + "1" + _S, "body"),
                  (_f + "3" + _S, _f + "2" + _S, "body")]
for _S in "LR":
    BONES += [
        ("legUp" + _S, "hips", "body"),
        ("legLow" + _S, "legUp" + _S, "body"),
        ("foot" + _S, "legLow" + _S, "body"),
        ("toe" + _S, "foot" + _S, "body"),
    ]
BONES += [
    ("skirtF", "hips", "spring"),
    ("skirtB", "hips", "spring"),
    ("skirtL", "hips", "spring"),
    ("skirtR", "hips", "spring"),
    ("coatTailL", "hips", "spring"),
    ("coatTailR", "hips", "spring"),
    ("gripR", "handR", "socket"),
    ("gripL", "handL", "socket"),
    ("hipL", "hips", "socket"),
    ("back", "upperChest", "socket"),
    ("headTop", "head", "socket"),
]
NAMES = [b[0] for b in BONES]
PARENT = {b[0]: b[1] for b in BONES}
KIND = {b[0]: b[2] for b in BONES}
LEGACY = ["hips", "spine", "neck", "head", "armUpL", "armLowL", "handL", "armUpR", "armLowR", "handR",
          "legUpL", "legLowL", "footL", "legUpR", "legLowR", "footR"]
KEYED = [n for n in NAMES if KIND[n] == "body"]
assert len(NAMES) == 60, len(NAMES)

# Godot 4.7's SkeletonProfileHumanoid names for the BoneMap (the little finger follows the ring chain in our rig)
GODOT = {
    "hips": "Hips", "spine": "Spine", "chest": "Chest", "upperChest": "UpperChest", "neck": "Neck", "head": "Head",
    "jaw": "Jaw",
}
for _S, _side in (("L", "Left"), ("R", "Right")):
    GODOT.update({
        "clavicle" + _S: _side + "Shoulder", "armUp" + _S: _side + "UpperArm", "armLow" + _S: _side + "LowerArm",
        "hand" + _S: _side + "Hand", "thumb1" + _S: _side + "ThumbMetacarpal", "thumb2" + _S: _side + "ThumbProximal",
        "thumb3" + _S: _side + "ThumbDistal", "legUp" + _S: _side + "UpperLeg", "legLow" + _S: _side + "LowerLeg",
        "foot" + _S: _side + "Foot", "toe" + _S: _side + "Toes",
    })
    for _f, _g in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring")):
        GODOT.update({_f + "1" + _S: _side + _g + "Proximal", _f + "2" + _S: _side + _g + "Intermediate",
                      _f + "3" + _S: _side + _g + "Distal"})

# where people take hold of each other (fights, a held victim, a body dragged): offsets in a bone's own rest frame
# are made per body in marks(); listed here by name, bone and what they are for
MARKS = [
    ("nape", "neck", "the back of the neck: a grab from behind"),
    ("collarBack", "upperChest", "the back of the collar: a grab or a drag by the coat"),
    ("collarFront", "upperChest", "the lapels: a grab from the front, a shove"),
    ("mouth", "head", "a hand over the mouth from behind (a silent attack)"),
    ("throat", "neck", "a blade or an arm at the throat"),
    ("chest", "chest", "a blow or a stab to the chest"),
    ("belly", "spine", "a blow or a stab to the belly"),
    ("kidneyL", "spine", "a stab from behind, left"),
    ("kidneyR", "spine", "a stab from behind, right"),
    ("beltBack", "hips", "the belt at the back: a lift or a drag"),
    ("wristL", "armLowL", "a grip on the wrist: held, twisted, dragged by the arms"),
    ("wristR", "armLowR", "the same, right"),
    ("upperArmL", "armUpL", "a grip on the arm above the elbow: held, led away"),
    ("upperArmR", "armUpR", "the same, right"),
    ("armpitL", "armUpL", "lifting or dragging a body under the arms"),
    ("armpitR", "armUpR", "the same, right"),
    ("ankleL", "legLowL", "dragging a body by the feet"),
    ("ankleR", "legLowR", "the same, right"),
    ("hair", "head", "a grab by the hair"),
]


def joints(P):
    """Head and tail of every bone for this body, in game space, after the stoop. Every bone keeps its rest
    direction (see the module note); the stoop moves the heads only."""
    H, w = P["H"], P["w"]
    L = bd.landmarks(P)
    sh = bd.shoulder_x(P)
    lx = bd.hip_x(P)
    Y = lambda f: bd.Y(P, f)
    up, down, fwd = np.array((0, 1, 0.0)), np.array((0, -1, 0.0)), np.array((0, 0, 1.0))
    J = {}

    def put(name, head, tail=None, d=None, length=None, part="torso"):
        h = np.array(head, float)
        t = np.array(tail, float) if tail is not None else h + d * length
        J[name] = (h, t, part)

    put("hips", (0, Y(0.546), 0), (0, Y(0.586), 0))
    put("spine", (0, Y(0.586), 0), (0, Y(0.660), 0))
    put("chest", (0, Y(0.660), 0), (0, Y(0.742), 0))
    put("upperChest", (0, Y(0.742), 0), (0, Y(0.835), 0))
    put("neck", (0, Y(0.835), -0.012 * w), (0, Y(0.895), -0.012 * w), part="neck")
    hs, hw = P["hs"], P["hw"]
    chin = Y(0.870)
    put("head", (0, Y(0.895), -0.010 * w), (0, H, -0.010 * w), part="head")
    put("jaw", (0, chin + 0.098 * hs, 0.004 * hw), d=fwd, length=0.085 * hw, part="head")
    for S, sg in (("L", 1), ("R", -1)):
        put("clavicle" + S, (sg * 0.018 * w, Y(0.816), 0.034 * w), d=up, length=0.05 * w)
        ez = -0.008 * w  # the elbow's pivot sits toward the back of the joint (its round side)
        put("armUp" + S, (sg * sh, Y(0.818), 0), (sg * sh, Y(0.630), 0), part="arm")
        put("armLow" + S, (sg * sh, Y(0.630), ez), (sg * sh, Y(0.486), ez), part="arm")
        put("armTwist" + S, (sg * sh, Y(0.548), ez), (sg * sh, Y(0.486), ez), part="arm")
        put("hand" + S, (sg * sh, Y(0.486), 0), (sg * sh, Y(0.429), 0), part="arm")
        hf = bd.hand_frame(P, S)
        th = hf["thumb"]
        for k in range(3):
            put("thumb%d%s" % (k + 1, S), th[k], th[k + 1], part="arm")
        for f in ("index", "middle", "ring"):
            pts = hf[f]
            for k in range(3):
                put("%s%d%s" % (f, k + 1, S), pts[k], pts[k + 1], part="arm")
        s = w * P["f"]["hand"]
        # the grip: where a handle passes through the closed fist, across the hand (forward when the arm hangs)
        gy = Y(0.429) - 0.022 * s
        put("grip" + S, (sg * (sh - 0.021 * s), gy, -0.004 * s), d=fwd, length=0.06 * w, part="arm")
    for S, sg in (("L", 1), ("R", -1)):
        ff = P["f"]["foot"]
        kz = 0.008 * w  # the knee's pivot sits toward the front of the joint (its round side)
        put("legUp" + S, (sg * lx, Y(0.52), 0), (sg * lx, Y(0.285), 0))
        put("legLow" + S, (sg * lx, Y(0.285), kz), (sg * lx, Y(0.049), kz))
        put("foot" + S, (sg * lx, Y(0.049), 0), (sg * lx, Y(0.049), 0.130 * w * ff))
        put("toe" + S, (sg * (lx - 0.006 * w), 0.013 * w, 0.130 * w * ff), d=fwd, length=0.06 * w * ff)
    sy = Y(0.600)
    k = P["f"]["hip"] * P["w"]
    put("skirtF", (0, sy, 0.10 * k), d=down, length=Y(0.6) - Y(0.30))
    put("skirtB", (0, sy, -0.11 * k), d=down, length=Y(0.6) - Y(0.30))
    put("skirtL", (0.15 * k, sy, 0), d=down, length=Y(0.6) - Y(0.30))
    put("skirtR", (-0.15 * k, sy, 0), d=down, length=Y(0.6) - Y(0.30))
    put("coatTailL", (0.07 * k, sy, -0.115 * k), d=down, length=Y(0.6) - Y(0.40))
    put("coatTailR", (-0.07 * k, sy, -0.115 * k), d=down, length=Y(0.6) - Y(0.40))
    put("hipL", (0.168 * k, Y(0.598), 0.01 * w), d=down, length=0.12 * w)
    put("back", (0, Y(0.760), -0.124 * w * P["f"]["chest"]), d=up, length=0.12 * w)
    put("headTop", (0, H, -0.008 * w), d=up, length=0.08 * w, part="head")

    # the stoop moves the heads; directions and lengths stay
    fn = bd.stoop_fn(P)
    out = {}
    for n in NAMES:
        h, t, part = J[n]
        nh = np.array(fn(tuple(h), part if part != "arm" else "arm"))
        out[n] = (nh, nh + (t - h))
    return out


def build_armature(name, J):
    """A Blender armature object with the 60 bones, roll 0."""
    import bpy

    arm = bpy.data.armatures.new(name + "_rig")
    ao = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    ao.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for n in NAMES:
        h, t = J[n]
        eb = arm.edit_bones.new(n)
        eb.head = B(*h)
        eb.tail = B(*t)
        eb.roll = 0.0
        eb.use_deform = KIND[n] != "socket"
    for n in NAMES:
        if PARENT[n]:
            arm.edit_bones[n].parent = arm.edit_bones[PARENT[n]]
            arm.edit_bones[n].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ao.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ao


def marks(P, J):
    """Grab and hit marks: a point in game space at rest for each MARKS entry, and its bone."""
    w = P["w"]
    hs, hw = P["hs"], P["hw"]
    chin = bd.Y(P, 0.870)
    fn = bd.stoop_fn(P)
    pts = {
        "nape": ((0, bd.Y(P, 0.875), -0.075 * w), "neck"),
        "collarBack": ((0, bd.Y(P, 0.835), -0.09 * w), "torso"),
        "collarFront": ((0, bd.Y(P, 0.79), 0.12 * w), "torso"),
        "mouth": ((0, chin + 0.057 * hs, 0.108 * hw), "head"),
        "throat": ((0, bd.Y(P, 0.855), 0.05 * w), "neck"),
        "chest": ((0, bd.Y(P, 0.73), 0.125 * w), "torso"),
        "belly": ((0, bd.Y(P, 0.615), 0.11 * w), "torso"),
        "kidneyL": ((0.07 * w, bd.Y(P, 0.64), -0.095 * w), "torso"),
        "kidneyR": ((-0.07 * w, bd.Y(P, 0.64), -0.095 * w), "torso"),
        "beltBack": ((0, bd.Y(P, 0.60), -0.105 * w), "torso"),
        "hair": ((0, chin + 0.2 * hs, -0.07 * hw), "head"),
    }
    sh = bd.shoulder_x(P)
    for S, sg in (("L", 1), ("R", -1)):
        pts["wrist" + S] = ((sg * sh, bd.Y(P, 0.50), 0), "arm")
        pts["upperArm" + S] = ((sg * sh, bd.Y(P, 0.70), 0), "arm")
        pts["armpit" + S] = ((sg * (sh - 0.045 * w), bd.Y(P, 0.765), 0), "arm")
        pts["ankle" + S] = ((sg * bd.hip_x(P), bd.Y(P, 0.07), 0), "leg")
    out = {}
    for n, bone, _ in MARKS:
        p, part = pts[n]
        out[n] = (np.array(fn(p, part)), bone)
    return out

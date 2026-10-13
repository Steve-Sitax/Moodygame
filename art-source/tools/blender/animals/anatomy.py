"""The skeletons: joints at true size, the bones between them, and the animals that wear them.

Every rig has the same bone names (34 bones: a spine of hips, spine, chest; neck, neck2, head, jaw; two bones per
ear; five tail bones; per front leg the shoulder blade, upper arm, forearm, pastern and paw; per hind leg the thigh,
shin, metatarsus and paw). The legs stand on their toes (digitigrade dogs and cats, the pig on its two main toes):
the carpus is the dog's wrist, the hock its heel, both well off the ground.

Sizes (shoulder height, the top of the withers):
- the street mongrel 0.50 m; the draught dog (Belgian matin, the cart dog) 0.64 m, heavy in bone and chest; the
  Schipperke ("little skipper", the barge dog) 0.32 m, black, tailless, a ruff on the neck; the ratting terrier
  0.38 m, square, wire-coated, a docked tail carried up;
- the alley cat 0.25 m at the shoulder, 0.46 m nose to tail root, a 0.28 m tail;
- the Kempen pig (the old Campine landrace: long, narrow, high on the leg, lop-eared) 0.72 m at the back, 1.45 m
  snout to tail root.
"""

import math

import numpy as np

# ---------------------------------------------------------------- bones

TAIL = ["tail1", "tail2", "tail3", "tail4", "tail5"]


def bone_list():
    """(name, parent, head joint, tail joint) for every bone; joint names refer to the rig's joints."""
    out = [("hips", None, "hips", "spine"), ("spine", "hips", "spine", "chest"), ("chest", "spine", "chest", "neck"),
           ("neck", "chest", "neck", "neck2"), ("neck2", "neck", "neck2", "head"), ("head", "neck2", "head", "nose"),
           ("jaw", "head", "jaw", "chin")]
    for S in "LR":
        out += [("ear" + S, "head", "ear" + S, "earMid" + S), ("ear2" + S, "ear" + S, "earMid" + S, "earTip" + S)]
    par = "hips"
    for i, t in enumerate(TAIL):
        out.append((t, par, "tail%d" % i, "tail%d" % (i + 1)))
        par = t
    for S in "LR":
        out += [("scapula" + S, "chest", "scapula" + S, "shoulder" + S),
                ("humerus" + S, "scapula" + S, "shoulder" + S, "elbow" + S),
                ("forearm" + S, "humerus" + S, "elbow" + S, "carpus" + S),
                ("pastern" + S, "forearm" + S, "carpus" + S, "fmcp" + S),
                ("fpaw" + S, "pastern" + S, "fmcp" + S, "ftoe" + S),
                ("thigh" + S, "hips", "hip" + S, "stifle" + S),
                ("shin" + S, "thigh" + S, "stifle" + S, "hock" + S),
                ("meta" + S, "shin" + S, "hock" + S, "hmcp" + S),
                ("hpaw" + S, "meta" + S, "hmcp" + S, "htoe" + S)]
    return out


# Helpers: a bone at a joint that turns half as far as the bone below it (baked into the clips). The skin round the
# joint follows it, so a fold of 90 degrees bends the skin twice by 45 and the joint keeps its volume.
HELPERS = []
for _S in "LR":
    HELPERS += [("hipHelp" + _S, "hips", "thigh" + _S, "hip" + _S), ("kneeHelp" + _S, "thigh" + _S, "shin" + _S, "stifle" + _S),
                ("hockHelp" + _S, "shin" + _S, "meta" + _S, "hock" + _S),
                ("shoulderHelp" + _S, "scapula" + _S, "humerus" + _S, "shoulder" + _S),
                ("elbowHelp" + _S, "humerus" + _S, "forearm" + _S, "elbow" + _S),
                ("carpusHelp" + _S, "forearm" + _S, "pastern" + _S, "carpus" + _S)]
HELPERS += [("neckHelp", "chest", "neck", "neck")]
HELPER_AT = {(a, b): h for h, a, b, _ in HELPERS}

BONES = bone_list() + [(h, a, j, "~" + b) for h, a, b, j in HELPERS]  # tail "~bone": a short stub along that bone
NAMES = [b[0] for b in BONES]
INDEX = {n: i for i, n in enumerate(NAMES)}
PARENT = {b[0]: b[1] for b in BONES}

LEGS = {  # leg key: (chain of bones, the joints from the girdle to the toe)
    "FL": (["scapulaL", "humerusL", "forearmL", "pasternL", "fpawL"], ["scapulaL", "shoulderL", "elbowL", "carpusL", "fmcpL", "ftoeL"]),
    "FR": (["scapulaR", "humerusR", "forearmR", "pasternR", "fpawR"], ["scapulaR", "shoulderR", "elbowR", "carpusR", "fmcpR", "ftoeR"]),
    "HL": (["thighL", "shinL", "metaL", "hpawL"], ["hipL", "stifleL", "hockL", "hmcpL", "htoeL"]),
    "HR": (["thighR", "shinR", "metaR", "hpawR"], ["hipR", "stifleR", "hockR", "hmcpR", "htoeR"]),
}


def mirror(j):
    out = dict(j)
    for n, p in j.items():
        if n.endswith("L"):
            out[n[:-1] + "R"] = (-p[0], p[1], p[2])
    return out


def tail_chain(base, pitches, length, yaws=None):
    """Joints tail0..tail5 from the root along a curve: pitches = direction of each segment in degrees above the
    horizontal (pointing back), length = the whole tail."""
    seg = length / len(pitches)
    pts = [np.array(base, float)]
    yaws = yaws or [0.0] * len(pitches)
    for a, yw in zip(pitches, yaws):
        r, s = math.radians(a), math.radians(yw)
        d = np.array((math.sin(s) * math.cos(r), math.sin(r), -math.cos(r) * math.cos(s)))
        pts.append(pts[-1] + d * seg)
    return {"tail%d" % i: tuple(p) for i, p in enumerate(pts)}


# ---------------------------------------------------------------- dogs

# The street mongrel at H = 1 (shoulder height units). x is the animal's left.
DOG_REF = {
    "hips": (0, 0.90, -0.40), "spine": (0, 0.925, -0.14), "chest": (0, 0.90, 0.12), "neck": (0, 0.83, 0.44),
    "neck2": (0, 0.97, 0.575), "head": (0, 1.10, 0.665), "nose": (0, 1.01, 1.10), "jaw": (0, 1.005, 0.735),
    "chin": (0, 0.935, 1.05),
    "scapulaL": (0.11, 0.975, 0.29), "shoulderL": (0.155, 0.74, 0.50), "elbowL": (0.165, 0.52, 0.36),
    "carpusL": (0.14, 0.15, 0.385), "fmcpL": (0.135, 0.05, 0.415), "ftoeL": (0.135, 0.0, 0.515),
    "hipL": (0.14, 0.80, -0.43), "stifleL": (0.165, 0.52, -0.305), "hockL": (0.145, 0.235, -0.53),
    "hmcpL": (0.14, 0.05, -0.48), "htoeL": (0.14, 0.0, -0.38),
}
DOG_EAR = (0.085, 1.175, 0.74)  # ear base on the skull, H units

BREEDS = {
    # H: shoulder height (m); L: body length factor; leg: leg length factor; girth: barrel width; bone: limb
    # thickness; skull: head size; muzzle: muzzle length; ears, tail: kinds; tailp: segment pitches; taill: length
    "mongrel": dict(H=0.50, L=1.0, leg=1.0, girth=1.0, bone=1.0, skull=1.0, muzzle=0.9, deep=1.0, ears="drop_small",
                    tail="long", tailp=[-28, -48, -60, -58, -46], taill=0.56, coat="short", tuck=0.02),
    # the Belgian matin: big boned, broad skull and deep square muzzle with hanging lips, a heavy neck, little tuck-up
    "draught": dict(H=0.64, L=1.02, leg=0.97, girth=1.2, bone=1.25, skull=1.2, muzzle=0.72, deep=1.08, ears="drop",
                    tail="long", tailp=[-40, -62, -74, -76, -70], taill=0.52, coat="smooth", flews=True,
                    skull_w=1.24, muzzle_w=1.32, muzzle_d=1.3, stop=1.5, dome=1.1, neck=1.25, tuck=-0.03),
    # the Schipperke: cobby, the line falling from high withers to the croup, a fox's wedge of a head, small pricked ears
    "schipperke": dict(H=0.32, L=0.93, leg=0.95, girth=1.08, bone=1.0, skull=1.0, muzzle=0.76, deep=1.05,
                       ears="prick", tail="bob", tailp=[-20, -40, -50, -60, -60], taill=0.06, coat="ruff",
                       skull_w=1.06, muzzle_w=0.82, muzzle_d=0.86, stop=0.9, neck=1.1, slope=0.08),
    # the ratting terrier: square, a flat narrow skull and a long muzzle with little stop, button ears, a docked tail up
    "terrier": dict(H=0.38, L=0.92, leg=1.04, girth=0.94, bone=1.05, skull=0.98, muzzle=1.1, deep=1.04, ears="button",
                    tail="docked", tailp=[58, 72, 80, 82, 82], taill=0.30, coat="wire",
                    skull_w=0.86, muzzle_w=0.9, muzzle_d=0.95, stop=0.6, dome=0.86, neck=0.92, tuck=0.05),
}


def dog_joints(b):
    """The joints of a dog breed in metres."""
    H, L, leg = b["H"], b["L"], b["leg"]
    j = {}
    elbow_y = DOG_REF["elbowL"][1]
    for n, (x, y, z) in DOG_REF.items():
        # the body is longer or shorter behind the shoulders
        if z < 0.40:
            z = 0.40 + (z - 0.40) * L
        # longer legs lift everything above the elbow
        if y < elbow_y and n.endswith("L") and n[:-1] not in ("scapula", "shoulder"):
            y = y * leg
        else:
            y = y + elbow_y * (leg - 1)
        if n.endswith("L") and n[:-1] not in ("scapula",):
            x = x * (0.85 + 0.15 * b["girth"])
        j[n] = (x * H, y * H, z * H)
    # the head: skull and muzzle
    hx, hy, hz = j["head"]
    for n in ("nose", "jaw", "chin"):
        x, y, z = j[n]
        dz, dy = z - hz, y - hy
        k = b["skull"] if n == "jaw" else b["skull"] * (0.42 + 0.58 * b["muzzle"])
        j[n] = (x, hy + dy * k, hz + dz * k)
    ex, ey, ez = DOG_EAR
    ey += elbow_y * (leg - 1)
    j["earL"] = (hx + ex * H * b["skull"], hy + (ey - DOG_REF["head"][1]) * H * b["skull"],
                 hz + (ez - DOG_REF["head"][2]) * H * b["skull"])
    j = mirror(j)
    hipz = j["hips"][2]
    tail0 = (0, j["hips"][1] - 0.04 * H, hipz - 0.22 * H * L)
    j.update(tail_chain(tail0, b["tailp"], b["taill"] * H))
    return j


# ---------------------------------------------------------------- cat and pig

CAT = dict(H=0.25, ears="cat", tail="cat", coat="cat")
CAT_J = {
    "hips": (0, 0.215, -0.135), "spine": (0, 0.219, -0.04), "chest": (0, 0.212, 0.05), "neck": (0, 0.188, 0.112),
    "neck2": (0, 0.212, 0.143), "head": (0, 0.232, 0.163), "nose": (0, 0.221, 0.243), "jaw": (0, 0.214, 0.176),
    "chin": (0, 0.199, 0.234),
    "scapulaL": (0.022, 0.236, 0.063), "shoulderL": (0.036, 0.188, 0.124), "elbowL": (0.04, 0.113, 0.088),
    "carpusL": (0.036, 0.027, 0.096), "fmcpL": (0.034, 0.010, 0.106), "ftoeL": (0.034, 0.0, 0.127),
    "hipL": (0.034, 0.196, -0.155), "stifleL": (0.042, 0.104, -0.096), "hockL": (0.038, 0.062, -0.207),
    "hmcpL": (0.036, 0.010, -0.181), "htoeL": (0.036, 0.0, -0.157),
}
CAT_EAR = (0.024, 0.262, 0.178)

PIG = dict(H=0.72, ears="lop", tail="pig", coat="pig")
PIG_J = {
    "hips": (0, 0.665, -0.43), "spine": (0, 0.70, -0.13), "chest": (0, 0.685, 0.17), "neck": (0, 0.60, 0.40),
    "neck2": (0, 0.61, 0.50), "head": (0, 0.62, 0.56), "nose": (0, 0.455, 0.815), "jaw": (0, 0.515, 0.615),
    "chin": (0, 0.43, 0.775),
    "scapulaL": (0.10, 0.635, 0.27), "shoulderL": (0.135, 0.49, 0.405), "elbowL": (0.15, 0.325, 0.33),
    "carpusL": (0.13, 0.155, 0.36), "fmcpL": (0.12, 0.062, 0.385), "ftoeL": (0.12, 0.0, 0.44),
    "hipL": (0.12, 0.585, -0.50), "stifleL": (0.14, 0.38, -0.395), "hockL": (0.13, 0.175, -0.555),
    "hmcpL": (0.12, 0.062, -0.525), "htoeL": (0.12, 0.0, -0.475),
}
PIG_EAR = (0.08, 0.68, 0.62)


def cat_joints():
    j = mirror(dict(CAT_J))
    j["earL"], j["earR"] = CAT_EAR, (-CAT_EAR[0], CAT_EAR[1], CAT_EAR[2])
    # the tail: up from the rump, then a long sweep down and back with the tip lifting
    j.update(tail_chain((0, 0.207, -0.198), [-6, -32, -58, -62, -42], 0.28))
    return j


def pig_joints():
    j = mirror(dict(PIG_J))
    j["earL"], j["earR"] = PIG_EAR, (-PIG_EAR[0], PIG_EAR[1], PIG_EAR[2])
    # the thin tail hangs from the rump with a curl
    j.update(tail_chain((0, 0.64, -0.705), [-50, -72, -82, -70, -40], 0.24))
    return j


# ---------------------------------------------------------------- rigs and the animals that wear them

def rigs():
    out = {}
    for name, b in BREEDS.items():
        out[name] = dict(name=name, species="dog", P=b, J=dog_joints(b), H=b["H"])
    out["cat"] = dict(name="cat", species="cat", P=CAT, J=cat_joints(), H=CAT["H"])
    out["pig"] = dict(name="pig", species="pig", P=PIG, J=pig_joints(), H=PIG["H"])
    return out


# The kinds the game knows (Animals.cs, StreetTrades.cs): the old names keep their meaning.
VARIANTS = [
    dict(name="dog_brown", rig="mongrel", coat="mongrel_brown"),
    dict(name="dog_black", rig="mongrel", coat="mongrel_black"),
    dict(name="dog_spotted", rig="mongrel", coat="mongrel_spotted"),
    dict(name="dog_grey", rig="mongrel", coat="mongrel_grey"),
    dict(name="dog_draught", rig="draught", coat="draught_fawn"),
    dict(name="dog_draught_brindle", rig="draught", coat="draught_brindle"),
    dict(name="dog_schipperke", rig="schipperke", coat="schipperke_black"),
    dict(name="dog_terrier", rig="terrier", coat="terrier_white"),
    dict(name="dog_terrier_wheaten", rig="terrier", coat="terrier_wheaten"),
    dict(name="cat_tabby", rig="cat", coat="cat_tabby"),
    dict(name="cat_black", rig="cat", coat="cat_black"),
    dict(name="cat_ginger", rig="cat", coat="cat_ginger"),
    dict(name="cat_white", rig="cat", coat="cat_white"),
    dict(name="cat_tuxedo", rig="cat", coat="cat_tuxedo"),
    dict(name="cat_tortie", rig="cat", coat="cat_tortie"),
    dict(name="pig_pink", rig="pig", coat="pig_pink"),
    dict(name="pig_spotted", rig="pig", coat="pig_spotted"),
]

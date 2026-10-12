"""The base bodies as a quad cage, made in code (docs/people.md "The bodies").

One topology for every body: a trunk tube of 16 columns from the crotch to the crown (torso, shoulders, neck, head,
a 4 x 4 grid over the crown), two arms of 8 columns that grow out of a 2 x 2 hole on each side of the chest and end in
B's hands (hands.py: a 10-column palm with four fingers and a thumb grown out of it), and two legs of 10 columns that
grow out of the crotch and bend forward into the feet. Every joint has three edge loops. The head is replaced after
the subdivision by B's (head.py).
The cage is the far copy (LOD1, about 2,100 triangles); subdivided once it is the near copy (LOD0, about 8,500).

The shapes come from tables written for one reference man of 1.67 m (H_REF) and are bent to the other bodies by
landmark heights (KEYS), width factors and a few features (bust, belly, buttocks, stoop). The figures:
- height: Quetelet's tables (Belgium, the 1830s-1860s, as summed up in Dickens's All the Year Round, vol. XII p. 490):
  "at ten years old, four feet two [1.27 m] ... at twenty, five feet six inches [1.68 m] for young men, and five feet
  two inches [1.57 m] for young women"; height holds to fifty and falls a little after.
- the rest are textbook proportions of the time (head a 7.5th of an adult, a 6.3rd of a child of ten; the hip joint
  at 0.52 of the height, the knee at 0.285, the shoulder at 0.818, the elbow at 0.63, the wrist at 0.485) and girths
  of working people: a middling man 0.90 m round the chest, 0.79 m at the waist.
"""

import math

import numpy as np

H_REF = 1.67

# the bodies the kit exports: (name, base, build)
BODIES = [
    ("man_middling", "man", "middling"),
    ("man_slight", "man", "slight"),
    ("man_stout", "man", "stout"),
    ("woman_middling", "woman", "middling"),
    ("woman_slight", "woman", "slight"),
    ("woman_stout", "woman", "stout"),
    ("child_middling", "child", "middling"),
    ("child_slight", "child", "slight"),
    ("old_man", "old_man", "stooped"),
    ("old_woman", "old_woman", "stooped"),
]

# landmark heights as fractions of the height: ground, ankle, knee, hip joint, waist, shoulder joint, chin, crown
REF_KEYS = [0.0, 0.047, 0.285, 0.52, 0.625, 0.818, 0.870, 1.0]
KEYS = {
    "man": REF_KEYS,
    "old_man": [0.0, 0.047, 0.287, 0.522, 0.628, 0.818, 0.869, 1.0],
    "woman": [0.0, 0.046, 0.283, 0.515, 0.622, 0.814, 0.866, 1.0],
    "old_woman": [0.0, 0.046, 0.285, 0.518, 0.625, 0.814, 0.865, 1.0],
    "child": [0.0, 0.050, 0.276, 0.494, 0.592, 0.778, 0.834, 1.0],
}
HEIGHT = {"man": 1.67, "woman": 1.57, "child": 1.27, "old_man": 1.64, "old_woman": 1.54}


def smooth(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def params(base, build):
    """Everything that makes one body: heights, widths, features."""
    female = base in ("woman", "old_woman")
    child = base == "child"
    old = base.startswith("old")
    H = HEIGHT[base]
    P = dict(base=base, build=build, female=female, child=child, old=old, H=H, keys=KEYS[base])
    w = H / H_REF
    # soft-tissue girth and frame
    g = {"slight": 0.9, "middling": 1.0, "stout": 1.13, "stooped": 0.95}[build]
    belly = {"slight": 0.0, "middling": 0.006, "stout": 0.055, "stooped": 0.018}[build]
    f = dict(
        shoulder=1.0, chest=g, waist=g, hip=g, neck=lerp(1.0, g, 0.6), arm=lerp(1.0, g, 0.8), thigh=lerp(1.0, g, 0.8),
        calf=lerp(1.0, g, 0.6), hand=1.0, foot=1.0, buttock=1.0, breast=0.0, belly=belly, pecs=1.0, adam=1.0,
        brow=1.0, jaw=1.0, stoop=0.0, chin2=max(0.0, g - 1.04) * 6.0,
    )
    if build == "stout":
        f["shoulder"] = 1.04
    if build == "slight":
        f["shoulder"] = 0.97
        f["pecs"] = 0.5
    if female:
        f.update(shoulder=0.90 * f["shoulder"], chest=0.93 * g, waist=0.86 * g, hip=1.08 * g, neck=0.86 * f["neck"],
                 arm=0.86 * f["arm"], thigh=1.04 * f["thigh"], calf=0.93 * f["calf"], hand=0.9, foot=0.9, buttock=1.35,
                 breast={"slight": 0.75, "middling": 1.0, "stout": 1.35, "stooped": 0.9}[build], pecs=0.0, adam=0.0,
                 brow=0.4, jaw=0.9)
    if child:
        w = H / H_REF
        f.update(shoulder=0.92, chest=0.99 * g, waist=1.07 * g, hip=0.92 * g, neck=0.9, arm=0.93 * g, thigh=0.94 * g,
                 calf=0.95 * g, hand=0.92, foot=0.95, buttock=0.6, pecs=0.0, adam=0.0, brow=0.2, jaw=0.82, belly=0.01)
    if old:
        f.update(stoop=17.0 if not female else 15.0, buttock=0.7 * f["buttock"], arm=0.9 * f["arm"],
                 thigh=0.9 * f["thigh"], calf=0.88 * f["calf"], pecs=0.2 * f["pecs"], shoulder=0.96 * f["shoulder"])
        if female:
            f["breast"] = 0.85
    P["w"] = w
    P["f"] = f
    # head: chin to crown
    P["head_h"] = H * (1.0 - P["keys"][6])
    P["hs"] = P["head_h"] / 0.214
    P["hw"] = P["hs"] * 1.03  # the head's width and depth
    if child:
        P["hw"] = 1.0
    return P


def Y(P, frac):
    """A reference-man height fraction to this body's height in metres."""
    return P["H"] * float(np.interp(frac, REF_KEYS, P["keys"]))


# ---------------------------------------------------------------- shape tables (the reference man, 1.67 m)

# trunk rows: y (fraction, sides), dy front, dy back (fractions), half-width, front depth, back depth, centre z, power,
# width group (the factor that scales the row)
TORSO = [
    # r0 the crotch loop (the legs grow from here)
    (0.522, -0.034, -0.031, 0.156, 0.085, 0.098, -0.004, 2.3, "hip"),
    # r1 the buttocks and the greater trochanters
    (0.556, -0.004, -0.010, 0.159, 0.095, 0.110, -0.006, 2.4, "hip"),
    # r2 the top of the pelvis
    (0.592, 0.0, 0.0, 0.149, 0.099, 0.097, -0.002, 2.3, "waist"),
    # r3 the waist
    (0.626, 0.0, 0.0, 0.131, 0.098, 0.089, 0.006, 2.2, "waist"),
    # r4 the lower ribs
    (0.662, 0.0, 0.0, 0.137, 0.103, 0.095, 0.005, 2.3, "chest"),
    # r5 under the chest
    (0.697, 0.0, 0.0, 0.141, 0.109, 0.102, 0.0, 2.4, "chest"),
    # r6 the chest (nipples)
    (0.730, 0.0, 0.0, 0.143, 0.113, 0.107, 0.0, 2.5, "chest"),
    # r7 the armpits: the bottom of the arm hole
    (0.762, 0.0, 0.0, 0.140, 0.108, 0.108, -0.006, 2.6, "chest"),
    # r8 the middle of the arm hole (the folds of the armpit)
    (0.793, 0.0, 0.0, 0.146, 0.097, 0.102, -0.011, 2.6, "shoulder"),
    # r9 the top of the shoulders, the collar bones
    (0.827, -0.010, 0.003, 0.176, 0.071, 0.079, -0.013, 2.7, "shoulder"),
]
ARM_ROWS = (7, 8, 9)  # the hole: bottom, middle, top rows
ARM_COLS = (3, 4, 5)  # left side columns (the right side mirrors: 13, 12, 11)

# the neck base (trapezius) and the neck: y sides, dy front, dy back, half-width, front, back, centre z
NECK = [
    (0.846, -0.016, 0.012, 0.104, 0.064, 0.077, -0.020),
    (0.866, -0.022, 0.007, 0.063, 0.059, 0.061, -0.012),
]

# The head, chin to crown, for a reference head of 0.22 m: rings of 9 points (x, t, z) for the columns at
# 0, 22.5, ... 180 degrees from the front round the left side (mirrored for the right); t is the height over the
# chin, z forward of the ear.
HEAD = [
    # h0 under the jaw
    [(0.0, 0.002, 0.056), (0.024, 0.004, 0.052), (0.043, 0.012, 0.037), (0.055, 0.028, 0.010), (0.057, 0.042, -0.022),
     (0.053, 0.044, -0.047), (0.041, 0.044, -0.061), (0.021, 0.044, -0.068), (0.0, 0.044, -0.070)],
    # h1 the jaw line and the chin
    [(0.0, 0.006, 0.090), (0.022, 0.009, 0.084), (0.044, 0.021, 0.062), (0.059, 0.041, 0.026), (0.063, 0.060, -0.011),
     (0.060, 0.062, -0.054), (0.048, 0.064, -0.078), (0.026, 0.064, -0.088), (0.0, 0.064, -0.090)],
    # h2 the chin below the lip
    [(0.0, 0.033, 0.094), (0.022, 0.034, 0.089), (0.046, 0.040, 0.068), (0.063, 0.056, 0.036), (0.068, 0.076, -0.004),
     (0.067, 0.082, -0.060), (0.056, 0.086, -0.088), (0.030, 0.087, -0.100), (0.0, 0.087, -0.102)],
    # h3 the mouth
    [(0.0, 0.056, 0.105), (0.021, 0.056, 0.095), (0.044, 0.059, 0.074), (0.063, 0.069, 0.042), (0.071, 0.089, 0.000),
     (0.072, 0.100, -0.060), (0.062, 0.106, -0.093), (0.034, 0.107, -0.105), (0.0, 0.107, -0.107)],
    # h4 the nose tip and the wings of the nose
    [(0.0, 0.078, 0.133), (0.017, 0.074, 0.105), (0.042, 0.079, 0.082), (0.065, 0.086, 0.050), (0.073, 0.106, 0.002),
     (0.075, 0.120, -0.062), (0.065, 0.126, -0.097), (0.036, 0.127, -0.109), (0.0, 0.127, -0.111)],
    # h5 the bridge of the nose and the cheek bones
    [(0.0, 0.097, 0.119), (0.013, 0.095, 0.094), (0.040, 0.096, 0.083), (0.066, 0.101, 0.055), (0.075, 0.121, 0.004),
     (0.077, 0.137, -0.062), (0.066, 0.144, -0.098), (0.037, 0.146, -0.109), (0.0, 0.146, -0.111)],
    # h6 the eyes
    [(0.0, 0.113, 0.101), (0.017, 0.113, 0.079), (0.034, 0.112, 0.069), (0.058, 0.116, 0.058), (0.075, 0.131, 0.010),
     (0.078, 0.151, -0.060), (0.067, 0.159, -0.095), (0.037, 0.163, -0.106), (0.0, 0.163, -0.108)],
    # h7 the brows
    [(0.0, 0.132, 0.102), (0.018, 0.132, 0.100), (0.038, 0.134, 0.096), (0.060, 0.135, 0.074), (0.076, 0.148, 0.015),
     (0.077, 0.166, -0.057), (0.065, 0.173, -0.090), (0.036, 0.177, -0.100), (0.0, 0.177, -0.102)],
    # h8 the forehead
    [(0.0, 0.162, 0.096), (0.020, 0.162, 0.093), (0.040, 0.163, 0.085), (0.060, 0.164, 0.062), (0.073, 0.172, 0.012),
     (0.072, 0.185, -0.050), (0.058, 0.190, -0.080), (0.032, 0.193, -0.090), (0.0, 0.194, -0.092)],
    # h9 the top of the forehead
    [(0.0, 0.190, 0.081), (0.020, 0.190, 0.078), (0.038, 0.191, 0.069), (0.054, 0.193, 0.047), (0.062, 0.198, 0.007),
     (0.058, 0.205, -0.042), (0.045, 0.208, -0.066), (0.025, 0.209, -0.074), (0.0, 0.210, -0.076)],
]
CROWN_T = 0.214
# the subdivision pulls a cage in; the tables are the finished body, so the cage is blown up by these
INFLATE = {"torso": 1.085, "arm": 1.11, "forearm": 1.19, "thigh": 1.12, "calf": 1.15, "neck": 0.93}
HEAD_Z = -0.004  # the ear sits this far behind the neck's line

# arms (left; the right mirrors): y fraction, half-width out (x), front depth, back depth, centre x offset
ARM = [
    ("a2", 0.776, 0.044, 0.048, 0.048, 0.003),
    ("a3", 0.722, 0.040, 0.047, 0.046, 0.002),
    ("a4", 0.668, 0.037, 0.041, 0.041, 0.0),
    ("e1", 0.644, 0.035, 0.037, 0.039, 0.0),
    ("e2", 0.630, 0.036, 0.035, 0.041, 0.0),
    ("e3", 0.616, 0.038, 0.039, 0.039, 0.0),
    ("f1", 0.586, 0.034, 0.043, 0.040, 0.0),
    ("f2", 0.537, 0.027, 0.035, 0.032, 0.0),
    ("w1", 0.499, 0.021, 0.030, 0.028, 0.0),
    ("w2", 0.486, 0.019, 0.029, 0.027, 0.0),
    ("p0", 0.473, 0.0195, 0.039, 0.035, -0.002),
    ("p1", 0.452, 0.0175, 0.044, 0.041, -0.001),
    ("p2", 0.431, 0.0170, 0.043, 0.041, 0.0),
]
ARM_ANGLES = [math.radians(45 * j) for j in range(8)]  # from the front round the outside

# legs (left): y fraction, half-width, front depth, back depth, centre x offset (inwards is negative), centre z
LEG = [
    ("l1", 0.455, 0.078, 0.081, 0.086, -0.003, 0.0),
    ("l2", 0.398, 0.068, 0.073, 0.074, -0.003, 0.002),
    ("l3", 0.345, 0.056, 0.060, 0.058, -0.002, 0.003),
    ("k1", 0.305, 0.050, 0.053, 0.052, -0.002, 0.003),
    ("k2", 0.285, 0.049, 0.056, 0.050, -0.002, 0.003),
    ("k3", 0.265, 0.046, 0.048, 0.052, -0.002, 0.0),
    ("c1", 0.236, 0.048, 0.044, 0.064, -0.001, -0.004),
    ("c2", 0.196, 0.049, 0.043, 0.070, 0.0, -0.007),
    ("c3", 0.130, 0.039, 0.037, 0.050, 0.0, -0.004),
    ("t1", 0.077, 0.033, 0.032, 0.033, 0.0, -0.006),
    ("t2", 0.052, 0.038, 0.036, 0.033, 0.0, -0.008),
]
# the foot: rings across the foot (vertical planes); z of the ring, centre height, half-width, top, bottom, centre x
FOOT = [
    ("f1", 0.058, 0.035, 0.041, 0.040, 0.035, -0.002),
    ("f2", 0.130, 0.024, 0.046, 0.024, 0.024, -0.006),
    ("f3", 0.172, 0.015, 0.043, 0.014, 0.015, -0.008),
]
TOE_Z = 0.196

# fingers (left): name, z across the hand (+ = the thumb side), knuckle drop (m), lengths of the three bones, half
# thickness
FINGERS = [
    ("index", 0.0265, 0.003, (0.036, 0.021, 0.018), 0.0104),
    ("middle", 0.0085, 0.0, (0.039, 0.024, 0.019), 0.0107),
    ("ring", -0.0095, 0.002, (0.037, 0.022, 0.018), 0.0101),
    ("little", -0.0265, 0.008, (0.028, 0.017, 0.016), 0.0090),
]


# ---------------------------------------------------------------- landmarks (shared with rig.py)

def hand_frame(P, side):
    """The joints of one hand (pre-stoop, game space), from the same figures as the mesh."""
    sg = 1 if side == "L" else -1
    w, fh = P["w"], P["f"]["hand"]
    sh = shoulder_x(P)
    s = w * fh
    wrist = Y(P, 0.486)
    knuck = Y(P, 0.429)
    J = {}
    for name, z, drop, lens, _ in FINGERS:
        x = sg * (sh - 0.002 * s)
        y = knuck - drop * s
        pts = [(x, y, z * s)]
        for k, L in enumerate(lens):
            spread = (z / 0.0265) * math.radians(1.2)  # the fingers fan out a little
            y -= L * s * math.cos(spread)
            zz = pts[-1][2] + L * s * math.sin(spread)
            pts.append((x, y, zz))
        J[name] = pts
    # the thumb: from the base of the palm, down and forward along the front of the hand, a little across the palm
    th = [(sg * (sh - 0.006 * s), wrist - 0.010 * s, 0.020 * s),
          (sg * (sh - 0.012 * s), wrist - 0.042 * s, 0.040 * s),
          (sg * (sh - 0.015 * s), wrist - 0.071 * s, 0.049 * s),
          (sg * (sh - 0.017 * s), wrist - 0.095 * s, 0.054 * s)]
    J["thumb"] = th
    return J


def shoulder_x(P):
    """The shoulder joint's x: far enough out that the hanging arm clears the chest."""
    f, w = P["f"], P["w"]
    chest = 0.141 * w * f["chest"]
    arm = 0.040 * w * f["arm"]
    return max(0.183 * w * f["shoulder"], chest + arm + 0.004 * w)


def hip_x(P):
    return (0.053 if not P["female"] else 0.057) * P["H"] * (0.98 if P["child"] else 1.0) * (P["f"]["hip"] ** 0.3)


def landmarks(P):
    """Joint positions before the stoop (game space)."""
    H, w = P["H"], P["w"]
    sh = shoulder_x(P)
    lx = hip_x(P)
    L = {
        "hips": (0.0, Y(P, 0.546)),
        "spine": (0.0, Y(P, 0.586)),
        "chest": (0.0, Y(P, 0.660)),
        "upperChest": (0.0, Y(P, 0.742)),
        "neck": (0.0, Y(P, 0.835)),
        "head": (0.0, Y(P, 0.895)),
        "crown": (0.0, H),
        "shoulder": (sh, Y(P, 0.818)),
        "elbow": (sh, Y(P, 0.630)),
        "wrist": (sh, Y(P, 0.486)),
        "knuckle": (sh, Y(P, 0.429)),
        "hip": (lx, Y(P, 0.52)),
        "knee": (lx, Y(P, 0.285)),
        "ankle": (lx, Y(P, 0.049)),
        "ball": (lx, 0.0),
    }
    return L


# ---------------------------------------------------------------- the stoop of the old

def stoop_fn(P):
    """A function (point, part) -> point bending the upper body forward (the old). The arms move with the shoulder
    and still hang straight; the head moves with the neck and still looks ahead."""
    deg = P["f"]["stoop"]
    if deg <= 0:
        return lambda p, part: p
    H = P["H"]
    y0 = Y(P, 0.64)
    y1 = Y(P, 0.84)
    pz = -0.09 * P["w"]

    def bend(p):
        x, y, z = p
        a = math.radians(deg) * smooth(y0, y1, y) * (1.0 if y < y1 else 1.0)
        # rotate about the x axis through (y0, pz): forward is +z, so the top goes forward and down
        dy, dz = y - y0, z - pz
        ca, sa = math.cos(a), math.sin(a)
        return (x, y0 + dy * ca - dz * sa, pz + dy * sa + dz * ca)

    sh = landmarks(P)["shoulder"]
    sh3 = (sh[0], sh[1], 0.0)
    sh_d = np.subtract(bend(sh3), sh3)
    nb = (0.0, Y(P, 0.84), -0.01 * P["w"])
    nb_d = np.subtract(bend(nb), nb)
    head_d = nb_d + np.array((0.0, -0.004 * H, 0.022 * H))  # the head pokes forward a little more

    def fn(p, part):
        if part.startswith(("arm", "hand", "finger", "thumb")):
            return tuple(np.add(p, sh_d))
        if part == "head":
            return tuple(np.add(p, head_d))
        if part == "neck":
            # from the bent neck base to the head's move
            t = smooth(Y(P, 0.84), Y(P, 0.875), p[1])
            a = np.array(bend((p[0], min(p[1], y1), p[2]))) + np.array((0.0, max(0.0, p[1] - y1), 0.0))
            b = np.add(p, head_d)
            return tuple(a * (1 - t) + b * t)
        return bend(p)

    return fn


# ---------------------------------------------------------------- the cage

class Cage:
    def __init__(self):
        self.co = []  # positions after the stoop
        self.rest = []  # positions before the stoop (the weights are made on these)
        self.part = []
        self.tag = []
        self.faces = []
        self.fpart = []
        self.seams = set()

    def v(self, p, part, **tag):
        self.rest.append(tuple(float(c) for c in p))
        self.part.append(part)
        self.tag.append(tag)
        return len(self.rest) - 1

    def q(self, vs, part):
        self.faces.append(tuple(vs))
        self.fpart.append(part)

    def seam(self, a, b):
        self.seams.add((min(a, b), max(a, b)))

    def loft(self, rings, part, closed=True, seam_col=None):
        for r in range(len(rings) - 1):
            n = len(rings[r])
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                self.q((rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]), part)
            if seam_col is not None:
                self.seam(rings[r][seam_col], rings[r + 1][seam_col])


def sp(t, p):
    """Superellipse factors (side, front) at angle t from the front."""
    s, c = math.sin(t), math.cos(t)
    return math.copysign(abs(s) ** (2 / p), s), math.copysign(abs(c) ** (2 / p), c)


def coons_cap(cage, ring, part, lift, centre_y, grid=4):
    """Close a 16-vertex ring with a 4 x 4 grid of quads. The ring's vertex i sits on the boundary of the grid; the
    inside points are a Coons patch of the boundary, lifted into a dome by lift(u, v)."""
    n = grid
    # boundary positions in grid coordinates, counter-clockwise, starting at the middle of the front edge
    bnd = []
    for k in range(4 * n):
        side, o = divmod((k + n // 2) % (4 * n), n)
        if side == 0:
            bnd.append((o, 0))
        elif side == 1:
            bnd.append((n, o))
        elif side == 2:
            bnd.append((n - o, n))
        else:
            bnd.append((0, n - o))
    # ring column 0 is the front centre: grid (n/2, 0) is the front edge's middle
    gid = {}
    for k, g in enumerate(bnd):
        gid[g] = ring[k]
    P = {g: np.array(cage.rest[i]) for g, i in gid.items()}
    for gx in range(1, n):
        for gz in range(1, n):
            u, v = gx / n, gz / n
            c0 = P[(gx, 0)] * (1 - v) + P[(gx, n)] * v
            c1 = P[(0, gz)] * (1 - u) + P[(n, gz)] * u
            b = (P[(0, 0)] * (1 - u) * (1 - v) + P[(n, 0)] * u * (1 - v) + P[(0, n)] * (1 - u) * v + P[(n, n)] * u * v)
            p = c0 + c1 - b
            p[1] = centre_y + lift(u, v) + (p[1] - centre_y)
            gid[(gx, gz)] = cage.v(tuple(p), part, cap=(u, v))
    for gx in range(n):
        for gz in range(n):
            cage.q((gid[(gx, gz)], gid[(gx + 1, gz)], gid[(gx + 1, gz + 1)], gid[(gx, gz + 1)]), part)
    return gid


def build(P):
    """The cage of one body. Returns the Cage with co (after the stoop) filled in."""
    C = Cage()
    H, w, f = P["H"], P["w"], P["f"]
    N = 16
    th16 = [2 * math.pi * i / N for i in range(N)]

    # ---- the trunk
    group = {"hip": f["hip"], "waist": f["waist"], "chest": f["chest"], "shoulder": f["shoulder"]}
    rows = []
    hole_skip = {(8, 4), (8, 12)}
    for ri, (yf, dyf, dyb, ra, rf, rb, zc, pw, grp) in enumerate(TORSO):
        k = group[grp]
        kz = k ** 0.8  # depth grows a little less than width
        if grp == "shoulder":
            kz = 1.0
        ring = []
        for i, t in enumerate(th16):
            sx, cz = sp(t, pw)
            c = math.cos(t)
            y = Y(P, yf + dyf * max(0.0, c) ** 2 + dyb * max(0.0, -c) ** 2)
            front = rf * kz * w * INFLATE["torso"]
            back = rb * kz * w * INFLATE["torso"]
            x = ra * k * w * sx * INFLATE["torso"]
            z = zc * w + (front if c >= 0 else back) * cz
            # features
            deg = math.degrees(t) % 360
            side = min(deg, 360 - deg)  # 0 front .. 180 back
            dz = 0.0
            dy = 0.0
            if ri in (5, 6, 7, 8) and 12 < side < 64:  # the chest muscles
                dz += {5: 0.002, 6: 0.010, 7: 0.010, 8: 0.004}[ri] * f["pecs"] * w * math.sin(math.radians((side - 12) / 52 * 180))
            if f["breast"] > 0 and 10 < side < 70:  # the bust
                b = f["breast"] * w
                bump = math.exp(-((side - 32) / 20.0) ** 2)
                dz += {4: 0.004, 5: 0.034, 6: 0.046, 7: 0.024, 8: 0.006}.get(ri, 0.0) * b * bump
                dy += {5: -0.012, 6: -0.006}.get(ri, 0.0) * b * bump
            if ri in (2, 3, 4) and side < 50 and f["belly"] > 0:  # the belly
                dz += f["belly"] * {2: 0.85, 3: 1.0, 4: 0.6}[ri] * math.cos(math.radians(side)) ** 2 * w
            if ri in (0, 1, 2) and 120 < side < 175:  # the buttocks
                dz -= {0: 0.014, 1: 0.026, 2: 0.008}[ri] * f["buttock"] * math.sin(math.radians((side - 120) / 55 * 180)) * w
            if ri in (1, 2, 3, 4, 5, 6, 7, 8) and side > 170:  # the groove of the spine
                dz += 0.006 * w
            if ri in (6, 7, 8) and 130 < side < 165:  # the shoulder blades
                dz -= 0.005 * w
            if ri == 9 and side < 30:  # the hollow above the breast bone
                dz -= 0.008 * w
            z += dz
            y += dy
            if (ri, i) in hole_skip:
                ring.append(-1)
                continue
            ring.append(C.v((x, y, z), "torso", row=ri, col=i))
        rows.append(ring)
    # trunk faces, without the arm holes
    holes = set()
    for r0 in (7, 8):
        for c0 in (3, 4, 11, 12):
            holes.add((r0, c0))
    for r in range(len(rows) - 1):
        for i in range(N):
            if (r, i) in holes:
                continue
            j = (i + 1) % N
            C.q((rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]), "torso")
        C.seam(rows[r][8], rows[r + 1][8])

    # ---- the neck
    neck = []
    for ni, (yf, dyf, dyb, ra, rf, rb, zc) in enumerate(NECK):
        ring = []
        kn = f["neck"]
        for i, t in enumerate(th16):
            sx, cz = sp(t, 2.0)
            c = math.cos(t)
            y = Y(P, yf + dyf * max(0.0, c) ** 2 + dyb * max(0.0, -c) ** 2)
            x = ra * kn * w * sx * INFLATE["neck"]
            z = zc * w + (rf if c >= 0 else rb) * kn * w * cz * INFLATE["neck"]
            if ni == 1 and i == 0:
                z += 0.006 * f["adam"] * w
            if ni == 0 and f["chin2"] > 0 and abs(math.degrees(t) % 360 - 180) > 120:
                z += 0.004 * f["chin2"] * w
            ring.append(C.v((x, y, z), "neck", ring=ni, col=i))
        neck.append(ring)
    C.loft([rows[-1]] + neck, "neck", seam_col=8)

    # ---- the head
    hs, hw = P["hs"], P["hw"]
    chin = Y(P, 0.870)
    head = []
    for hi, pts in enumerate(HEAD):
        ring = []
        full = list(pts) + [(-x, t, z) for (x, t, z) in reversed(pts[1:-1])]
        for i, (x, t, z) in enumerate(full):
            xx, tt, zz = x, t, z
            if hi in (0, 1, 2) and abs(x) > 0.01:  # the jaw: narrower for women and children
                xx *= f["jaw"] ** (1.0 if hi < 2 else 0.5)
            if hi in (6, 7) and i in (1, 2, 3, 13, 14, 15):  # the brow ridge
                zz += (f["brow"] - 1.0) * (0.004 if hi == 7 else 0.002)
            if P["child"] and hi in (3, 4, 5) and i in (0, 1, 15):  # a smaller nose and mouth
                zz -= 0.006 if hi == 4 else 0.003
            if f["chin2"] > 0 and hi == 0 and abs(x) < 0.045:
                zz += 0.012 * f["chin2"]
                tt -= 0.006 * f["chin2"]
            ring.append(C.v((xx * hw, chin + tt * hs, (zz + HEAD_Z) * hw), "head", ring=hi, col=i))
        head.append(ring)
    C.loft([neck[-1]] + head, "head", seam_col=8)
    for i in range(N):  # the seam round the neck: the head is an island of its own
        C.seam(neck[-1][i], neck[-1][(i + 1) % N])

    def dome(u, v):
        r2 = ((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.5
        return (CROWN_T - HEAD[-1][0][1]) * hs * max(0.0, 1.0 - r2) ** 0.5

    cap = coons_cap(C, head[-1], "head", dome, chin + HEAD[-1][4][1] * hs)
    # the seam from the back of the top ring to the middle of the crown
    n = 4
    C.seam(cap[(n // 2, n)], cap[(n // 2, n - 1)])
    C.seam(cap[(n // 2, n - 1)], cap[(n // 2, n - 2)])

    # ---- the arms
    sh = shoulder_x(P)
    sj = Y(P, 0.818)
    for side in ("L", "R"):
        sg = 1 if side == "L" else -1
        cols = ARM_COLS if side == "L" else (13, 12, 11)
        r7, r8, r9 = ARM_ROWS
        hole = [rows[r8][cols[0]], rows[r9][cols[0]], rows[r9][cols[1]], rows[r9][cols[2]], rows[r8][cols[2]],
                rows[r7][cols[2]], rows[r7][cols[1]], rows[r7][cols[0]]]
        ka = f["arm"]
        rings = [hole]

        def arm_ring(name, yf, ra, rf, rb, cx, kw=1.0):
            ring = []
            y = Y(P, yf)
            for j, t in enumerate(ARM_ANGLES):
                sx, cz = sp(t, 2.2 if not name.startswith("p") else 3.0)
                c = math.cos(t)
                kk = kw * INFLATE["arm" if name[0] in "ade" else "forearm"]
                x = sg * (sh + cx * w + ra * w * kk * sx)
                z = (rf if c >= 0 else rb) * w * kk * cz
                ring.append((x, y, z))
            return ring

        geo = []
        for name, yf, ra, rf, rb, cx in ARM:
            kw = ka if not name.startswith(("w", "p")) else f["hand"] * (ka ** 0.3)
            if name.startswith("p"):
                kw = f["hand"]
            geo.append((name, arm_ring(name, yf, ra, rf, rb, cx, kw)))
        # the deltoid: two rings between the hole and the upper arm, pushed round the shoulder joint
        a2 = np.array(geo[0][1])
        hp = np.array([C.rest[i] for i in hole])
        jc = np.array((sg * (sh - 0.006 * w), Y(P, 0.800), 0.0))  # the middle of the deltoid's round
        for t, nm in ((0.36, "d1"), (0.7, "d2")):
            ring = []
            for j in range(8):
                p = hp[j] * (1 - t) + a2[j] * t
                d = p - jc
                ln = np.linalg.norm(d)
                ang = ARM_ANGLES[j]
                outer = (1 + math.sin(ang)) / 2  # 1 at the outside, 0 at the armpit
                r = (0.044 + 0.008 * outer) * w * ka * INFLATE["arm"]
                if outer > 0.3:
                    p = jc + d / ln * lerp(ln, r, 0.9 * smooth(0.3, 0.7, outer))
                ring.append(tuple(p))
            geo.insert(0 if nm == "d1" else 1, (nm, ring))
        for name, ring in geo:
            if name in ("p1", "p2"):  # B: the hand from p0 on is hands.py's
                continue
            rings.append([C.v(p, "arm" + side, ring=name, col=j, side=side) for j, p in enumerate(ring)])
        C.loft(rings, "arm" + side, seam_col=6)
        for k in range(8):  # the arm is an island of its own
            C.seam(hole[k], hole[(k + 1) % 8])
        from . import hands
        hands.build_hand(C, P, side, rings[-1])

    # ---- the legs
    lx = hip_x(P)
    crotch = C.v((0.0, Y(P, 0.468), -0.006 * w), "torso", row=-1, col=-1, crotch=True)
    for side in ("L", "R"):
        sg = 1 if side == "L" else -1
        order = list(range(0, 9)) if side == "L" else [0, 15, 14, 13, 12, 11, 10, 9, 8]
        loop = [rows[0][c] for c in order] + [crotch]
        # the loop's angles about the thigh's centre
        cz0 = 0.0
        ang = []
        for i in loop:
            x, y, z = C.rest[i]
            ang.append(math.atan2(sg * x - lx, z - cz0))
        a = [ang[0]]
        for t in ang[1:]:
            while t < a[-1]:
                t += 2 * math.pi
            a.append(t)
        uni = [math.radians(90 + (j - 4) * 36) for j in range(10)]
        off = (a[4] - uni[4])
        uni = [u + off for u in uni]
        rings = [loop]
        kt, kc = f["thigh"], f["calf"]
        for li, (name, yf, ra, rf, rb, cx, cz) in enumerate(LEG):
            relax = min(1.0, (li + 1) / 3.0)
            k = kt if yf > 0.29 else kc if yf > 0.1 else lerp(1.0, kc, 0.4)
            k *= INFLATE["thigh" if yf > 0.29 else "calf"]
            y = Y(P, yf)
            ring = []
            for j in range(10):
                t = lerp(a[j], uni[j], relax)
                sx, czz = sp(t, 2.1)
                c = math.cos(t)
                x = sg * (lx + cx * w + ra * w * k * sx)
                z = cz * w + (rf if c >= 0 else rb) * w * k * czz
                ring.append(C.v((x, y, z), "leg" + side, ring=name, col=j, side=side))
            rings.append(ring)
        # the heel ring, half way round the bend from the ankle to the foot
        ff = f["foot"]
        heel = []
        for j in range(10):
            t = uni[j]
            s_, c_ = math.sin(t), math.cos(t)
            # in the bend the ring's front (the shin) turns up into the instep, its back (the Achilles) down into
            # the heel
            x = sg * (lx - 0.002 * w + 0.037 * w * ff * math.copysign(abs(s_) ** (2 / 2.4), s_))
            if c_ >= 0:
                y = Y(P, 0.028) + 0.036 * w * c_
                z = 0.020 * w * ff + 0.034 * w * ff * c_
            else:
                y = Y(P, 0.028) + 0.020 * w * c_
                z = -0.012 * w * ff + 0.046 * w * ff * c_
            heel.append(C.v((x, max(0.0, y), z), "leg" + side, ring="heel", col=j, side=side))
        rings.append(heel)
        for name, zf, cy, hw, top, bot, cx in FOOT:
            ring = []
            for j in range(10):
                t = uni[j]
                sx, czz = sp(t, 2.6)
                c = math.cos(t)
                x = sg * (lx + cx * w * ff + hw * w * ff * sx)
                y = cy * w + (top if c >= 0 else bot) * w * czz
                z = zf * w * ff
                if name == "f2" and math.sin(t) < 0:  # the ball of the big toe
                    z += 0.006 * w * ff
                ring.append(C.v((x, max(0.0, y), z), "leg" + side, ring=name, col=j, side=side))
            rings.append(ring)
        C.loft(rings, "leg" + side, seam_col=9)
        for k in range(10):  # the leg is an island of its own
            C.seam(loop[k], loop[(k + 1) % 10])
        last = rings[-1]
        # the toes: a front pushed out, the big toe longest
        tipc = []
        for j, i in enumerate(last):
            x, y, z = C.rest[i]
            t = uni[j]
            inner = max(0.0, -math.sin(t))
            tipc.append(C.v((x * 0.92 + sg * lx * 0.08, y * 0.85, TOE_Z * w * ff + (0.008 * inner - 0.006) * w * ff),
                            "leg" + side, ring="toe", col=j, side=side))
        C.loft([last, tipc], "leg" + side, seam_col=9)
        for a_, b_, c_, d_ in ((0, 1, 8, 9), (1, 2, 7, 8), (2, 3, 6, 7), (3, 4, 5, 6)):
            C.q((tipc[a_], tipc[b_], tipc[c_], tipc[d_]), "leg" + side)
        C.seam(tipc[9], tipc[8])
        C.seam(tipc[9], tipc[0])

    # ---- the stoop
    fn = stoop_fn(P)
    C.co = [fn(p, part) for p, part in zip(C.rest, C.part)]
    return C


# ---------------------------------------------------------------- into Blender

def to_mesh(C, name, use_rest=False):
    """A Blender mesh object from the cage: quads, smooth shading, UV seams marked, one vertex group per part
    (part_<name>, used to find the parts again after the subdivision)."""
    import bmesh
    import bpy

    from . import B

    bm = bmesh.new()
    pts = C.rest if use_rest else C.co
    vs = [bm.verts.new(B(*p)) for p in pts]
    bm.verts.ensure_lookup_table()
    used = set()
    for fv in C.faces:
        used.update(fv)
        try:
            bm.faces.new([vs[i] for i in fv])
        except ValueError as e:
            print("[people2] face failed", fv, e)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for e in me.edges:
        a, b = e.vertices
        if (min(a, b), max(a, b)) in C.seams:
            e.use_seam = True
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {}
    for i, part in enumerate(C.part):
        groups.setdefault(part, []).append(i)
    for part, idx in groups.items():
        vg = ob.vertex_groups.new(name="part_" + part)
        vg.add(idx, 1.0, "REPLACE")
    return ob


def girths(ob, P, vparts):
    """Tape-measure girths of a body (the convex hull of a horizontal cut through one part), in metres, for the
    check of the figures. vparts: the part of every vertex (weights.parts)."""
    import bmesh
    import bpy

    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    ev.to_mesh_clear()
    co = np.array([v.co[:] for v in bm.verts])
    edges = np.array([(e.verts[0].index, e.verts[1].index) for e in bm.edges])
    bm.free()
    vp = np.array([p or "" for p in vparts])

    def cut(y, part):
        ed = edges[(vp[edges[:, 0]] == part) & (vp[edges[:, 1]] == part)]
        a, b = co[ed[:, 0]], co[ed[:, 1]]
        za, zb = a[:, 2] - y, b[:, 2] - y
        m = (za * zb) < 0
        t = (za[m] / (za[m] - zb[m]))[:, None]
        p = (a[m] + (b[m] - a[m]) * t)[:, :2]
        if len(p) < 3:
            return 0.0
        pts = sorted(map(tuple, p))

        def cross(o, a_, b_):
            return (a_[0] - o[0]) * (b_[1] - o[1]) - (a_[1] - o[1]) * (b_[0] - o[0])
        lo, hi = [], []
        for q in pts:
            while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
                lo.pop()
            lo.append(q)
        for q in reversed(pts):
            while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
                hi.pop()
            hi.append(q)
        h = lo[:-1] + hi[:-1]
        return sum(math.dist(h[i], h[(i + 1) % len(h)]) for i in range(len(h)))

    sj = stoop_fn(P)((shoulder_x(P), 0.0, 0.0), "arm")[1]  # the arms' rise with the stoop (none: it moves them)
    return {
        "neck": cut(Y(P, 0.862), "neck"),
        "chest": cut(Y(P, 0.728), "torso"),
        "waist": cut(Y(P, 0.626), "torso"),
        "hips": cut(Y(P, 0.556), "torso"),
        "thigh": cut(Y(P, 0.45), "legL"),
        "calf": cut(Y(P, 0.196), "legL"),
        "upperarm": cut(Y(P, 0.72) + sj, "armL"),
        "forearm": cut(Y(P, 0.586) + sj, "armL"),
        "wrist": cut(Y(P, 0.49) + sj, "armL"),
        "height": float(co[:, 2].max() - co[:, 2].min()),
    }

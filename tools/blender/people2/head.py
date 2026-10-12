"""The heads (docs/people.md "Faces"): a modelled head for every body, eyes that can look, 14 face shapes.

The head is drawn as a signed distance field (sdf.py) in a head frame of its own, for a reference head 0.214 m from
chin to crown: x the person's left, t the height over the bottom of the chin, z forward of the ear canal (metres).
A body's head is this frame scaled by the body's head size (P["hs"] up, P["hw"] across and deep), as A's
placeholder head was, so it sits on A's neck ring.

The anatomy, from the textbook landmarks of an adult head (eyes at half the height, the nose from the brows to a
third of the way up, the mouth a third of the rest; the ear from the brow line to the nose's base): a cranium, the
face's mass, cheek bones and their arches, a jaw from the angle to the chin, the muzzle, two lips with a real mouth
slit (so the jaw opens a dark mouth), a nose with its tip, wings and nostrils, a brow ridge, sockets cut round
separate eyeballs and modelled lids with an almond opening, ears with a rim, a bowl and a lobe, and the neck.

One mesh is made once per build, for the reference man (mesh_reference()): surface nets on a 0.8 mm grid, cut down
to the triangle budget by Blender's decimation (detail where the surface bends), pulled back onto the surface. Every
other body and every face shape is that same mesh moved: landmarks move it (warp()) and it is pulled onto that
head's own surface (project), so all heads have one vertex order, and the face shapes become shape keys (morph
targets) of the near copy.
"""

import math

import numpy as np

from . import sdf

# the reference frame: the reference head is 0.214 m tall (A's CROWN_T); a body's head = this * (hw, hs, hw)
CROWN_T = 0.214
HEAD_Z = -0.004  # A's: the head frame's z = 0 sits this far behind the neck's line (in head units)

# where the UVs of the head go in a body's picture: the top right eighth... a 512 px square of a 2048 picture
HEAD_RECT = (0.75, 0.75, 1.0, 1.0)


# ---------------------------------------------------------------- parameters

def neutral(P=None):
    """The head of a body: landmarks and sizes in the head frame. Without P the reference man."""
    q = dict(
        # cranium (main, the occiput behind)
        cran_c=(0.0, 0.130, -0.004), cran_r=(0.0745, 0.085, 0.099),
        occ_c=(0.0, 0.110, -0.040), occ_r=(0.066, 0.072, 0.067),
        temple=0.6,
        # the face's mass (maxilla), the cheek pads, the cheek bones
        face_c=(0.0, 0.086, 0.026), face_r=(0.064, 0.094, 0.076), face_taper=0.32, face_n=2.6,
        malar_c=(0.034, 0.082, 0.072), malar_r=(0.022, 0.020, 0.016), malar=1.0,
        cheek_c=(0.049, 0.098, 0.052), cheek_r=(0.021, 0.013, 0.024), cheekbone=1.0,
        zyg=((0.056, 0.099, 0.040), (0.066, 0.100, 0.004)), zyg_r=0.0075,
        hollow=0.0,
        # the jaw: angle (gonion), joint, the body of the jaw toward the chin, the chin
        gonion=(0.051, 0.030, -0.008), tmj=(0.057, 0.090, -0.004), mental=(0.021, 0.011, 0.074),
        jaw_r=0.013, ramus_r=0.011,
        chin_c=(0.0, 0.016, 0.083), chin_r=(0.021, 0.017, 0.0135),
        chin2=0.0,
        muzzle_c=(0.0, 0.052, 0.074), muzzle_r=(0.034, 0.030, 0.029),
        # the mouth: the slit's height, half width, the front of the arch, the arch's bend; lip fullness
        mouth_t=0.0535, mouth_w=0.0245, mouth_z=0.1065, arch_k=24.0, lip_up=1.0, lip_lo=1.0,
        # the nose
        nasion=(0.0, 0.122, 0.099), tip=(0.0, 0.079, 0.121), tip_r=(0.0103, 0.0093, 0.0090),
        ala=(0.0145, 0.0725, 0.1060), ala_r=(0.0066, 0.0060, 0.0076), bridge_r=(0.0060, 0.0066, 0.0074),
        hump=0.0, nose_side=1.0, crook=0.0,
        # the brow ridge
        brow=1.0, brow_t=0.0,
        # the eyes: centre, eyeball radius; lid opening (degrees): the upper lid's height, the lower's depth,
        # the corners' azimuths (in toward the nose is negative), the lateral tilt; lid fullness
        eye=(0.0315, 0.110, 0.075), eye_r=0.0118,
        lid_up=20.0, lid_lo=20.0, az_in=-70.0, az_out=86.0, tilt=3.0, lid_full=1.0, socket=1.0,
        # ears: the middle of the ear, half length, half width, tilt back, flare out
        ear=(0.071, 0.099, -0.010), ear_len=0.031, ear_w=0.0165, ear_tilt=15.0, ear_flare=28.0,
        # the neck at A's ring: centre z, half width, front and back depth (head frame), the lean
        neck_z=-0.0075, neck_x=0.056, neck_f=0.0525, neck_b=0.054, neck_lean=0.15, adam=1.0,
    )
    if P is None:
        return q
    f = P["f"]
    hw = P["hw"]
    w = P["w"]
    kn = f["neck"]
    # the neck must meet A's ring (body.NECK[1], cage inflate 0.93, in head units)
    q["neck_x"] = 0.063 * kn * w * 0.93 / hw
    q["neck_f"] = 0.059 * kn * w * 0.93 / hw
    q["neck_b"] = 0.061 * kn * w * 0.93 / hw
    q["neck_z"] = -0.012 * w / hw - HEAD_Z
    q["adam"] = f["adam"]
    q["chin2"] = f["chin2"]
    if P["female"]:
        apply(q, FEMALE)
    if P["child"]:
        apply(q, CHILD)
    if P["old"]:
        apply(q, OLD_F if P["female"] else OLD_M)
    return q


# a change of the head is a dict: name -> value (set) or ("+", delta) (added) or ("*", factor) (scaled)
FEMALE = {
    # a softer, smaller face under the same cranium: no brow ridge, a shorter nose turned up a little, a shorter
    # lower face with a narrow jaw and a small round chin, fuller lips and cheeks, a rounder forehead, open eyes
    "brow": ("*", 0.1), "brow_t": ("+", 0.003), "jaw_r": ("*", 0.80), "ramus_r": ("*", 0.82),
    "gonion": ("+", (-0.010, 0.013, 0.004)), "mental": ("+", (-0.004, 0.008, -0.004)),
    "chin_c": ("+", (0.0, 0.010, -0.008)), "chin_r": ("*", (0.78, 0.82, 0.82)), "face_taper": ("*", 1.25),
    "face_c": ("+", (0, 0.006, -0.002)), "face_r": ("*", (0.94, 0.90, 0.95)), "muzzle_c": ("+", (0, 0.006, -0.004)),
    "mouth_t": ("+", 0.006), "mouth_z": ("+", -0.003),
    "tip_r": ("*", 0.80), "ala_r": ("*", 0.84), "ala": ("+", (-0.002, 0.006, -0.005)), "tip": ("+", (0, 0.008, -0.010)),
    "bridge_r": ("*", 0.8), "nasion": ("+", (0, 0, -0.004)),
    "lip_up": ("*", 1.2), "lip_lo": ("*", 1.18), "mouth_w": ("*", 0.92),
    "cheekbone": ("*", 1.05), "cheek_c": ("+", (0, 0.003, 0.001)), "malar": ("*", 1.45),
    "cran_r": ("*", (0.98, 0.98, 0.97)), "cran_c": ("+", (0, 0, 0.003)),
    "ear_len": ("*", 0.9), "lid_full": ("*", 0.92), "lid_up": ("+", 3.0), "eye_r": ("*", 0.98), "adam": ("*", 0.0),
}
CHILD = {
    # a child's face is small under a big cranium: the features gather lower and closer, a short nose turned up, a
    # small chin, full cheeks, no brow ridge
    "cran_r": ("*", (1.04, 1.03, 1.0)), "cran_c": ("+", (0, 0.004, -0.004)),
    "face_r": ("*", (0.9, 0.84, 0.9)), "face_c": ("+", (0, -0.002, -0.004)), "face_taper": ("*", 1.15),
    "eye": ("+", (-0.0015, -0.006, -0.002)), "nasion": ("+", (0, -0.009, -0.007)),
    "tip": ("+", (0, -0.004, -0.016)), "tip_r": ("*", 0.78), "ala": ("+", (-0.003, -0.003, -0.012)), "ala_r": ("*", 0.8),
    "bridge_r": ("*", 0.75), "mouth_t": ("+", -0.002), "mouth_z": ("+", -0.009), "mouth_w": ("*", 0.84),
    "chin_c": ("+", (0, 0.008, -0.012)), "chin_r": ("*", 0.76), "mental": ("+", (-0.004, 0.007, -0.010)),
    "gonion": ("+", (-0.008, 0.012, 0.002)), "muzzle_c": ("+", (0, 0.0, -0.010)), "muzzle_r": ("*", 0.88),
    "malar": ("*", 1.6), "malar_c": ("+", (0, -0.004, -0.004)), "cheekbone": ("*", 0.6), "brow": ("*", 0.1),
    "ear_len": ("*", 0.9), "lid_full": ("*", 1.0), "lid_up": ("+", 2.0), "jaw_r": ("*", 0.8), "adam": ("*", 0.0),
    "lip_up": ("*", 1.1), "lip_lo": ("*", 1.1),
}
OLD_M = {
    "hollow": ("+", 0.45), "temple": ("+", 0.5), "malar": ("*", 0.7), "tip_r": ("*", 1.1), "ala_r": ("*", 1.08),
    "tip": ("+", (0, -0.003, 0.002)), "ear_len": ("*", 1.12), "ear_w": ("*", 1.08), "lip_up": ("*", 0.7),
    "lip_lo": ("*", 0.8), "lid_full": ("*", 1.18), "lid_up": ("+", -3.0), "socket": ("*", 1.25),
    "chin2": ("+", 0.08), "brow": ("*", 1.05),
}
OLD_F = dict(OLD_M)
OLD_F.update({"tip_r": ("*", 1.04), "ear_len": ("*", 1.06), "brow": ("*", 1.0)})

# the face shapes (shape keys of the near copy): mixed per person by seed (face_mix()), each a change of the head
SHAPES = [
    ("long", {"face_r": ("*", (0.95, 1.07, 1.0)), "chin_c": ("+", (0, -0.006, 0.002)), "mental": ("+", (-0.002, -0.004, 0)),
              "gonion": ("+", (-0.004, -0.004, 0)), "mouth_t": ("+", -0.002), "cheek_c": ("+", (-0.003, 0, 0)),
              "zyg": ("+", (-0.003, 0, 0))}),
    ("broad", {"face_r": ("*", (1.08, 0.97, 1.0)), "cheek_c": ("+", (0.005, 0, 0)), "zyg": ("+", (0.005, 0, 0)),
               "gonion": ("+", (0.006, 0, 0)), "tip_r": ("*", (1.12, 1.0, 0.9)), "ala": ("+", (0.003, 0, -0.002)),
               "nasion": ("+", (0, 0, -0.004)), "mouth_w": ("*", 1.08)}),
    ("aquiline", {"hump": ("+", 1.0), "tip": ("+", (0, -0.004, 0.006)), "tip_r": ("*", (0.92, 1.05, 1.0)),
                  "nasion": ("+", (0, 0.001, 0.002)), "ala": ("+", (-0.001, 0.001, 0))}),
    ("snub", {"tip": ("+", (0, 0.003, -0.007)), "tip_r": ("*", (1.12, 1.05, 1.0)), "nasion": ("+", (0, 0, -0.004)),
              "bridge_r": ("*", 0.9), "ala": ("+", (0.001, 0.0015, -0.003))}),
    ("bulbous", {"tip_r": ("*", (1.35, 1.3, 1.3)), "ala_r": ("*", 1.25), "ala": ("+", (0.003, 0, 0.001)),
                 "tip": ("+", (0, -0.002, 0.003))}),
    ("square", {"gonion": ("+", (0.008, -0.004, -0.002)), "jaw_r": ("*", 1.15), "chin_r": ("*", (1.3, 1.05, 1.05)),
                "chin_c": ("+", (0, 0, 0.002)), "mental": ("+", (0.004, 0, 0))}),
    ("weakchin", {"chin_c": ("+", (0, 0.003, -0.009)), "chin_r": ("*", 0.85), "mental": ("+", (-0.002, 0.003, -0.007)),
                  "muzzle_c": ("+", (0, 0, -0.002)), "mouth_z": ("+", -0.002)}),
    ("chin", {"chin_c": ("+", (0, -0.004, 0.007)), "chin_r": ("*", (1.1, 1.2, 1.15)), "mental": ("+", (0, -0.002, 0.004))}),
    ("gaunt", {"hollow": ("+", 0.6), "malar": ("*", 0.45), "cheekbone": ("*", 1.35), "temple": ("+", 0.8),
               "socket": ("*", 1.25), "face_r": ("*", (0.96, 1.0, 1.0))}),
    ("round", {"malar": ("*", 1.6), "malar_r": ("*", (1.15, 1.1, 1.1)), "cheekbone": ("*", 0.7), "chin2": ("+", 0.3),
               "face_r": ("*", (1.05, 0.98, 1.0)), "gonion": ("+", (0.004, 0.003, 0))}),
    ("heavybrow", {"brow": ("*", 1.6), "socket": ("*", 1.3), "lid_full": ("*", 1.12),
                   "nasion": ("+", (0, -0.001, -0.002)), "lid_up": ("+", -2.0)}),
    ("thinlips", {"lip_up": ("*", 0.55), "lip_lo": ("*", 0.65), "mouth_w": ("*", 1.1)}),
    ("fulllips", {"lip_up": ("*", 1.35), "lip_lo": ("*", 1.35), "mouth_w": ("*", 0.9), "mouth_z": ("+", 0.002)}),
    ("ears", {"ear_len": ("*", 1.14), "ear_w": ("*", 1.15), "ear_flare": ("+", 14.0)}),
]
SHAPE_NAMES = [n for n, _ in SHAPES]


def apply(q, change, amount=1.0):
    """Change the head q in place by a change dict (see FEMALE), scaled by amount."""
    for k, v in change.items():
        op, val = v
        cur = q[k]
        if op == "+":
            if isinstance(cur, tuple) and cur and isinstance(cur[0], tuple):
                q[k] = tuple(tuple(c + d * amount for c, d in zip(pt, val)) for pt in cur)
            elif isinstance(cur, tuple):
                q[k] = tuple(c + d * amount for c, d in zip(cur, val))
            else:
                q[k] = cur + val * amount
        elif op == "*":
            if isinstance(cur, tuple):
                fv = val if isinstance(val, tuple) else (val,) * len(cur)
                q[k] = tuple(c * (1 + (fk - 1) * amount) for c, fk in zip(cur, fv))
            else:
                q[k] = cur * (1 + (val - 1) * amount)
    return q


def shaped(q, name, amount=1.0):
    out = dict(q)
    return apply(out, dict(SHAPES)[name], amount)


def face_mix(seed):
    """Shape-key weights for a person: two or three face shapes, the first strongest, by seed."""
    rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
    n = len(SHAPES)
    k = rng.choice([2, 3, 3])
    idx = rng.choice(n, size=k, replace=False)
    w = np.zeros(n)
    amp = rng.uniform(0.55, 1.0)
    for j, i in enumerate(idx):
        w[i] = amp * (1.0 if j == 0 else rng.uniform(0.3, 0.75))
    # the same mix with opposite pairs is pointless: never long+broad, snub+aquiline, thin+full lips, weak+big chin
    for a, b in (("long", "broad"), ("snub", "aquiline"), ("thinlips", "fulllips"), ("weakchin", "chin"),
                 ("gaunt", "round")):
        ia, ib = SHAPE_NAMES.index(a), SHAPE_NAMES.index(b)
        if w[ia] > 0 and w[ib] > 0:
            w[ib] = 0.0
    return {SHAPE_NAMES[i]: round(float(w[i]), 3) for i in range(n) if w[i] > 0}


# ---------------------------------------------------------------- the field

def _mirror(c):
    return [(c[0], c[1], c[2]), (-c[0], c[1], c[2])]


def eye_angles(p, e, side):
    """Azimuth (outward positive) and elevation of points about an eye centre, radians, and the distance."""
    d = p - np.asarray(e)
    r = np.sqrt((d * d).sum(-1))
    az = np.arctan2(side * d[:, 0], d[:, 2])
    el = np.arctan2(d[:, 1], np.sqrt(d[:, 0] ** 2 + d[:, 2] ** 2))
    return az, el, r


def lid_curves(q, s):
    """The upper and lower lid margins (elevation, radians) at s = -1 (inner corner) .. 1 (outer corner)."""
    s = np.clip(s, -1.0, 1.0)
    one = np.maximum(1.0 - s * s, 0.0)
    tilt = math.radians(q["tilt"]) * (s + 1) / 2
    up = math.radians(q["lid_up"]) * one ** 0.55 * (1.0 - 0.12 * s) + tilt
    lo = -math.radians(q["lid_lo"]) * one ** 0.8 * (1.0 + 0.12 * s) + tilt
    return up, lo


def opening(p, q, e, side):
    """Signed angular distance (times the radius: metres) to the eye's opening; negative inside it."""
    az, el, r = eye_angles(p, e, side)
    a0, a1 = math.radians(q["az_in"]), math.radians(q["az_out"])
    ac, half = (a0 + a1) / 2, (a1 - a0) / 2
    s = (az - ac) / half
    up, lo = lid_curves(q, s)
    d = np.maximum(np.maximum(el - up, lo - el), (np.abs(s) - 1.0) * half)
    return d * np.maximum(r, 0.004)


def ear_frame(q, side):
    o = np.array(q["ear"], np.float64) * np.array((side, 1, 1))
    tilt, flare = q["ear_tilt"], q["ear_flare"]
    a = np.array((0.0, math.cos(math.radians(tilt)), -math.sin(math.radians(tilt))))
    b = np.array((0.0, math.sin(math.radians(tilt)), math.cos(math.radians(tilt))))
    x = np.array((float(side), 0.0, 0.0))
    fr = math.radians(flare)
    b2 = math.cos(fr) * b - math.sin(fr) * x
    n = np.cross(a, b2) * (-side)
    if n @ x < 0:
        n = -n
    return o, a, b2, n


def ear_outline(q, n=28):
    """The rim of the ear in its own plane (ua along the ear, ub toward the face), from the front top over the top,
    down the back to the lobe."""
    L, W = q["ear_len"], q["ear_w"]
    pts = []
    for k in range(n):
        th = math.radians(80 + k * (255 - 80) / (n - 1))  # 80 deg: front top; 255: under the lobe
        ua = L * math.sin(th)
        wb = W * (1.0 if ua > 0 else 0.72 + 0.28 * (1 + ua / L))
        ub = -0.004 + wb * math.cos(th)
        pts.append((ua, ub))
    return pts


def ear_sdf(p, q, side, lod=0):
    o, a, b, n = ear_frame(q, side)
    d = p - o
    ua, ub, un = d @ a, d @ b, d @ n
    L, W = q["ear_len"], q["ear_w"]
    if lod:
        return sdf.ellipsoid(np.stack([ua, ub, un], -1), (0.0, -0.004, 0.002), (L * 0.95, W * 0.9, 0.009))
    wb = W * np.where(ua > 0, 1.0, 0.72 + 0.28 * np.clip(1 + ua / L, 0, 1))
    e2 = (np.sqrt((ua / L) ** 2 + ((ub + 0.004) / wb) ** 2) - 1.0) * min(L, W)
    # a cupped plate standing off the head more at the back
    un0 = 0.0035 + 0.16 * np.maximum(0.0, -(ub + 0.002)) + 0.05 * np.maximum(0.0, ua) ** 2 / L
    plate = sdf.smax(e2, np.abs(un - un0) - 0.0023, 0.0015)
    loc = np.stack([ua, ub, un], -1)
    # the rolled rim (helix)
    out = ear_outline(q)
    rim = []
    for (pa, pb) in out[:-3]:
        cn = math.hypot(pa / L, (pb + 0.004) / W) or 1.0
        pa2 = pa - 0.0022 * (pa / L) / cn
        pb2 = pb - 0.0022 * ((pb + 0.004) / W) / cn
        rim.append((pa2, pb2, 0.0035 + 0.16 * max(0.0, -(pb2 + 0.002)) + 0.0012))
    helix = sdf.tube(loc, rim, [0.0019 + 0.0009 * math.sin(math.pi * i / (len(rim) - 1)) for i in range(len(rim))])
    ear = sdf.smin(plate, helix, 0.0012)
    # the lobe: soft and thick
    lobe = sdf.ellipsoid(loc, (-L * 0.76, -0.0045, 0.0035 + 0.0012), (0.0085, 0.0085, 0.0042))
    ear = sdf.smin(ear, lobe, 0.002)
    # the scapha (the groove inside the rim) and the bowl (concha) near the canal
    sc = [(pa * 0.80, -0.004 + (pb + 0.004) * 0.78, 0.0035 + 0.16 * max(0.0, -(pb * 0.78 + 0.002)) + 0.0032)
          for (pa, pb) in out[2:-7]]
    ear = sdf.cut(ear, sdf.tube(loc, sc, [0.0015] * len(sc)), 0.001)
    concha = sdf.ellipsoid(loc, (-0.003, 0.0015, 0.0072), (0.0105, 0.0080, 0.0058))
    ear = sdf.cut(ear, concha, 0.0016)
    trag = sdf.ellipsoid(loc, (-0.004, 0.0105, 0.0035), (0.0042, 0.0032, 0.0034))
    ear = sdf.smin(ear, trag, 0.0015)
    return ear


def head_sdf(p, q, lod=0, parts=None, ears=True):
    """The head's field at points p (N, 3) in the head frame. lod=1: the far copy (closed eyes, no mouth slit,
    plain ears). parts: a dict filled with the named sub-fields (for the painter and the weights)."""
    p = np.asarray(p, np.float64)
    x, t, z = p[:, 0], p[:, 1], p[:, 2]
    # ---- cranium
    d = sdf.ellipsoid(p, q["cran_c"], q["cran_r"])
    d = sdf.smin(d, sdf.ellipsoid(p, q["occ_c"], q["occ_r"]), 0.02)
    # flat temples
    for c in _mirror((0.081, 0.125, 0.052)):
        d = sdf.cut(d, sdf.ellipsoid(p, c, (0.010 + 0.004 * q["temple"], 0.020, 0.020)), 0.010)
    # ---- the face: one egg from the brows to the chin, narrower toward the chin, flat across the front
    fc, fr = q["face_c"], q["face_r"]
    tq = np.clip((fc[1] - t) / fr[1], 0.0, 1.0)
    taper = 1.0 - q["face_taper"] * tq ** 1.4
    qx = np.abs(x / (fr[0] * taper))
    qz = np.abs((z - fc[2]) / fr[2])
    qy = (t - fc[1]) / fr[1]
    n = q["face_n"]
    rxz = (qx ** n + qz ** n) ** (1.0 / n)
    face = (np.sqrt(rxz ** 2 + qy ** 2) - 1.0) * (fr[0] * taper * 0.5 + fr[2] * 0.5) * 0.85
    for c in _mirror(q["malar_c"]):
        r = np.array(q["malar_r"]) * (0.7 + 0.3 * q["malar"])
        face = sdf.smin(face, sdf.ellipsoid(p, c, r), 0.016)
    cb = q["cheekbone"]
    for c in _mirror(q["cheek_c"]):
        face = sdf.smin(face, sdf.ellipsoid(p, c, np.array(q["cheek_r"]) * (0.8 + 0.2 * cb)), 0.010 + 0.004 * cb)
    for s in (1, -1):
        za = [(s * a[0], a[1], a[2]) for a in q["zyg"]]
        face = sdf.smin(face, sdf.tube(p, za, [q["zyg_r"] * (0.85 + 0.15 * cb)] * 2), 0.010)
    # hollow cheeks (under the cheek bone, in front of the jaw muscle)
    if q["hollow"] > 0:
        for c in _mirror((0.047, 0.066, 0.060)):
            face = sdf.cut(face, sdf.ellipsoid(p, c, (0.011, 0.015, 0.016)), 0.008 * q["hollow"])
    # ---- the jaw
    jaw = None
    for s in (1, -1):
        g = (s * q["gonion"][0], q["gonion"][1], q["gonion"][2])
        m = (s * q["mental"][0], q["mental"][1], q["mental"][2])
        tm = (s * q["tmj"][0], q["tmj"][1], q["tmj"][2])
        body = sdf.tube(p, [g, m], [q["jaw_r"], q["jaw_r"] * 0.85])
        ramus = sdf.tube(p, [tm, g], [q["ramus_r"] * 0.8, q["ramus_r"]])
        j = sdf.smin(body, ramus, 0.012)
        jaw = j if jaw is None else sdf.smin(jaw, j, 0.02)
    jaw = sdf.smin(jaw, sdf.ellipsoid(p, q["chin_c"], q["chin_r"]), 0.016)
    jaw = sdf.smin(jaw, sdf.ellipsoid(p, q["muzzle_c"], q["muzzle_r"]), 0.012)
    if q["chin2"] > 0:
        jaw = sdf.smin(jaw, sdf.ellipsoid(p, (0, 0.004, 0.045), (0.042, 0.010 + 0.008 * q["chin2"], 0.034)),
                       0.012 * q["chin2"])
    face = sdf.smin(face, jaw, 0.014)
    # ---- the lips
    mt, mw, mz, ak = q["mouth_t"], q["mouth_w"], q["mouth_z"], q["arch_k"]
    xs = np.array([-1.0, -0.82, -0.53, -0.22, 0.0, 0.22, 0.53, 0.82, 1.0])
    up_t = np.array([0.0006, 0.0024, 0.0041, 0.0050, 0.0043, 0.0050, 0.0041, 0.0024, 0.0006])
    up_r = np.array([0.0016, 0.0029, 0.0040, 0.0045, 0.0042, 0.0045, 0.0040, 0.0029, 0.0016]) * q["lip_up"]
    lo_t = -np.array([0.0007, 0.0030, 0.0047, 0.0055, 0.0057, 0.0055, 0.0047, 0.0030, 0.0007])
    lo_r = np.array([0.0016, 0.0031, 0.0046, 0.0055, 0.0058, 0.0055, 0.0046, 0.0031, 0.0016]) * q["lip_lo"]
    X = xs * mw
    upper = [(X[i], mt + up_t[i] * (0.6 + 0.4 * q["lip_up"]), mz - ak * X[i] ** 2 + 0.0010 * (1 - xs[i] ** 2))
             for i in range(len(xs))]
    lower = [(X[i], mt + lo_t[i] * (0.6 + 0.4 * q["lip_lo"]), mz - ak * X[i] ** 2 - 0.0008 * (1 - xs[i] ** 2) - 0.0008)
             for i in range(len(xs))]
    lips = sdf.smin(sdf.tube(p, upper, up_r, scale=(1, 0.9, 1)), sdf.tube(p, lower, lo_r, scale=(1, 0.9, 1)), 0.0015)
    face = sdf.smin(face, lips, 0.0028)
    # ---- the nose
    hump = q["hump"]
    na, tp = np.array(q["nasion"]), np.array(q["tip"])
    br = q["bridge_r"]
    mid = na + (tp - na) * 0.45 + np.array((0, 0, 0.0035 * hump))
    if q["crook"]:
        mid = mid + np.array((0.003 * q["crook"], 0, 0))
    bridge = sdf.tube(p, [tuple(na), tuple(mid), tuple(tp + np.array((0, 0.004, -0.004)))], [br[0], br[1], br[2]])
    nose = sdf.smin(bridge, sdf.ellipsoid(p, q["tip"], q["tip_r"]), 0.004)
    side = sdf.ellipsoid(p, (0, (na[1] + tp[1]) / 2 - 0.004, (na[2] + tp[2]) / 2 - 0.008),
                         (0.0125 * q["nose_side"], 0.024, 0.012))
    nose = sdf.smin(nose, side, 0.006)
    for c in _mirror(q["ala"]):
        nose = sdf.smin(nose, sdf.ellipsoid(p, c, q["ala_r"]), 0.0028)
    colum = sdf.tube(p, [tuple(tp + np.array((0, -0.006, -0.004))), (0, mt + 0.016, mz - 0.003)], [0.0035, 0.004])
    nose = sdf.smin(nose, colum, 0.003)
    face = sdf.smin(face, nose, 0.006)
    if not lod:
        for s in (1, -1):
            al = q["ala"]
            c = (s * (al[0] * 0.52), al[1] - 0.0052, al[2] + 0.0030)
            face = sdf.cut(face, sdf.ellipsoid(p, c, (0.0034, 0.0019, 0.0050)), 0.0010)
    # ---- the brow ridge
    bw = q["brow"]
    bt = q["brow_t"]
    bpts = [(-0.054, 0.122, 0.070), (-0.046, 0.127, 0.084), (-0.032, 0.130, 0.094), (-0.016, 0.127, 0.099),
            (0.0, 0.124, 0.101), (0.016, 0.127, 0.099), (0.032, 0.130, 0.094), (0.046, 0.127, 0.084),
            (0.054, 0.122, 0.070)]
    bpts = [(bx, by + bt, bz - 0.004 + 0.004 * bw) for bx, by, bz in bpts]
    brr = np.array([0.0050, 0.0062, 0.0072, 0.0075, 0.0072, 0.0075, 0.0072, 0.0062, 0.0050]) * (0.75 + 0.25 * bw)
    face = sdf.smin(face, sdf.tube(p, bpts, brr), 0.009)
    d = sdf.smin(d, face, 0.016)
    # ---- the eyes: the socket, the lids, the cavity
    R1 = q["eye_r"] + 0.0006
    eyes_open = not lod
    for s in (1, -1):
        e = (s * q["eye"][0], q["eye"][1], q["eye"][2])
        sock = sdf.ellipsoid(p, (e[0] + s * 0.0015, e[1] + 0.0015, e[2] + 0.0035 + 0.0015 * q["socket"]),
                             (0.0175, 0.0128, 0.0135))
        d = sdf.cut(d, sock, 0.007)
        r = np.sqrt(((p - np.array(e)) ** 2).sum(-1))
        az, el, _ = eye_angles(p, e, s)
        R2 = R1 + np.where(el > 0, 0.0027, 0.0021) * q["lid_full"]
        shell = np.maximum(r - R2, R1 - r)
        if eyes_open:
            shell = sdf.smax(shell, -opening(p, q, e, s), 0.0010)
        d = sdf.smin(d, shell, 0.0045)
        if eyes_open:
            d = sdf.cut(d, r - R1, 0.0004)
    # ---- the mouth slit and the inside of the mouth
    if not lod:
        za = mz - ak * x ** 2
        slab = np.maximum.reduce([np.abs(t - mt) - 0.0010, np.abs(x) - mw * 0.985, (za - 0.013) - z, z - (za + 0.02)])
        d = sdf.cut(d, slab, 0.0006)
    # ---- the ears
    if ears:
        for s in (1, -1):
            d = sdf.smin(d, ear_sdf(p, q, s, lod), 0.0035)
    # ---- the neck (up into the skull), the Adam's apple
    zc = q["neck_z"] + q["neck_lean"] * (t + 0.0066)
    nx = x / q["neck_x"]
    nz = (z - zc) / np.where(z > zc, q["neck_f"], q["neck_b"])
    neck = (np.sqrt(nx * nx + nz * nz) - 1.0) * min(q["neck_x"], q["neck_f"])
    neck = np.maximum(neck, t - 0.07)
    d = sdf.smin(d, neck, 0.016)
    if q["adam"] > 0:
        d = sdf.smin(d, sdf.ellipsoid(p, (0, -0.022, q["neck_z"] + q["neck_f"] - 0.004),
                                      (0.008, 0.012, 0.007 * q["adam"])), 0.006)
    if parts is not None:
        parts["lips"] = lips
        parts["nose"] = nose
    return d


def head_bounds():
    return (-0.112, -0.075, -0.13), (0.112, 0.232, 0.145)


# ---------------------------------------------------------------- the reference mesh

EDGE_KEEP = 0.78  # how strongly the decimation spares the face (its weights, see mesh_field)
SPARSE = 0.00025  # metres: smaller shape-key moves are dropped (file size)
NECK_GAP = 0.006  # the head mesh stops this far (head units) above A's neck ring; a strip of faces joins them


def ring_t(q, x, z, hs=1.0145, H=1.67, keys_scale=1.0):
    """Height (head frame) of A's neck ring (body.NECK[1] with its front and back drops) above the points' angle."""
    c = np.cos(np.arctan2(x, z - q["neck_z"]))
    yf = 0.866 - 0.022 * np.maximum(0, c) ** 2 + 0.007 * np.maximum(0, -c) ** 2
    return H * (yf - 0.870) / hs


def _B(a):
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], -1)


def _G(a):
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], -1)


def mesh_field(f, q, target, h=0.0008, lod=0, name="head_ref"):
    """Mesh a head field: surface nets, the neck cut and the eye cavities taken out, decimated to `target`
    triangles, pulled onto the surface. Returns (verts (head frame), triangles)."""
    import bmesh
    import bpy

    lo, hi = head_bounds()
    d, lo, hh = sdf.grid_eval(f, lo, hi, h)
    v, fc = sdf.surface_nets(d, lo, hh)
    # cut: below the neck ring (+ gap), and the hidden cavity behind each eyeball
    cen = v[fc].mean(1)
    keep = cen[:, 1] > ring_t(q, cen[:, 0], cen[:, 2]) + NECK_GAP
    if not lod:
        R1 = q["eye_r"] + 0.0006
        for s in (1, -1):
            e = np.array((s * q["eye"][0], q["eye"][1], q["eye"][2]))
            keep &= np.sqrt(((cen - e) ** 2).sum(-1)) > R1 + 0.0006
    fc = fc[keep]
    used = np.unique(fc)
    remap = -np.ones(len(v), np.int64)
    remap[used] = np.arange(len(used))
    v, fc = v[used], remap[fc]
    ob = sdf.to_blender(name, _B(v), fc)
    # keep only the largest connected piece (stray bits from the cut)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    best = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack, comp = [f0], []
        seen.add(f0.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for g2 in e.link_faces:
                    if g2.index not in seen:
                        seen.add(g2.index)
                        stack.append(g2)
        if len(comp) > len(best):
            best = comp
    keepset = {g.index for g in best}
    bmesh.ops.delete(bm, geom=[g for g in bm.faces if g.index not in keepset], context="FACES")
    # the open edges (neck, eye holes) must not wander in the decimation: weight them
    bm.to_mesh(ob.data)
    bm.free()
    # the face and the ears get the triangles; the scalp, the back and the neck (hair, hats, collars) fewer
    vg = ob.vertex_groups.new(name="edge")
    co = _G(np.array([vv.co[:] for vv in ob.data.vertices]))
    wk = np.clip((co[:, 2] - 0.035) / 0.035, 0, 1) * np.clip((0.150 - co[:, 1]) / 0.02, 0, 1) *         np.clip((co[:, 1] + 0.005) / 0.02, 0, 1)
    for s_ in (1, -1):
        o = np.array(q["ear"]) * np.array((s_, 1, 1))
        wk = np.maximum(wk, np.clip(1.4 * (1 - np.sqrt(((co - o) ** 2).sum(-1)) / 0.045), 0, 1))
    # the hairline's band (where hair shells end) a little finer than the scalp
    wk = np.maximum(wk, 0.45 * np.clip(1 - np.abs(co[:, 1] - 0.165) / 0.03, 0, 1) * (co[:, 2] > -0.03))
    for i in range(len(wk)):
        vg.add([int(i)], float(1.0 - EDGE_KEEP * wk[i]), "REPLACE")
    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = min(1.0, target / max(ntri, 1))
    m.use_collapse_triangulate = True
    m.vertex_group = "edge"
    m.invert_vertex_group = False
    m.vertex_group_factor = 1.0
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=m.name)
    # cut along the back's middle line, where the UV chart has its seam: no triangle may cross it
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    back = [f for f in bm.faces if f.calc_center_median().y > 0.0]
    geom = list({e for f in back for e in f.edges}) + back + list({v for f in back for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(1, 0, 0), dist=1e-7)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    V, T = sdf.mesh_arrays(ob)
    bpy.data.objects.remove(ob)
    V = _G(V)
    # pull onto the surface, but leave the open edges where they are (they are on it already, near enough)
    inner = np.ones(len(V), bool)
    E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    Es = np.sort(E, 1)
    u, cnt = np.unique(Es, axis=0, return_counts=True)
    inner[np.unique(u[cnt == 1])] = False
    V[inner] = sdf.project(f, V[inner])
    if not lod:
        for s_ in (1, -1):
            snap_margin(V, T, q, s_)
    return V, T


def margin_point(q, e, side, u, r):
    """A point on an eye's lid margin: u in [0, 1) round the opening (0 the inner corner, 0.5 the outer, the upper
    lid first), on a sphere of radius r about the eye centre e."""
    s = -np.cos(2 * np.pi * u)
    up, lo = lid_curves(q, s)
    el = np.where(u < 0.5, up, lo)
    a0, a1 = math.radians(q["az_in"]), math.radians(q["az_out"])
    az = (a0 + a1) / 2 + s * (a1 - a0) / 2
    d = np.stack([side * np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)], -1)
    return np.asarray(e) + d * r


def snap_margin(V, T, q, side):
    """Put the eye opening's open edge evenly back on the lid margin (the decimation leaves it ragged)."""
    e = np.array((side * q["eye"][0], q["eye"][1], q["eye"][2]))
    loops = boundary_loops(T)
    best = None
    for lp in loops:
        c = V[lp].mean(0)
        if np.linalg.norm(c - e) < 0.02 and (best is None or len(lp) > len(best)):
            best = lp
    if best is None:
        return
    lp = np.array(best)
    az, el, r = eye_angles(V[lp], e, side)
    a0, a1 = math.radians(q["az_in"]), math.radians(q["az_out"])
    sv = np.clip((az - (a0 + a1) / 2) / ((a1 - a0) / 2), -1, 1)
    u = np.where(el > 0, np.arccos(-sv) / (2 * np.pi), 1 - np.arccos(-sv) / (2 * np.pi))
    k0 = int(np.argmin(np.minimum(u, 1 - u)))
    lp = np.roll(lp, -k0)
    u = np.roll(u, -k0)
    n = len(lp)
    if ((u[1:] - u[:-1] + 0.5) % 1.0 - 0.5).sum() < 0:  # the loop runs the other way round
        lp = np.concatenate([lp[:1], lp[1:][::-1]])
    un = np.arange(n) / n
    rr = q["eye_r"] + 0.0011
    V[lp] = margin_point(q, e, side, un, rr)


def boundary_loops(T):
    """The open edge loops of a triangle mesh, each an ordered list of vertex ids."""
    E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    key = {}
    for a, b in E:
        key[(a, b)] = key.get((a, b), 0) + 1
    nxt = {}
    for (a, b) in key:
        if (b, a) not in key:
            nxt[a] = b
    loops = []
    seen = set()
    for s in list(nxt):
        if s in seen:
            continue
        loop = [s]
        seen.add(s)
        c = nxt[s]
        while c != s and c not in seen:
            loop.append(c)
            seen.add(c)
            c = nxt.get(c, s)
        loops.append(loop)
    return loops


# ---------------------------------------------------------------- moving the reference to a body or a face shape

def anchors(q):
    """Landmarks that carry the mesh when a head changes: (name, point, reach)."""
    out = [("cran", q["cran_c"], 0.07), ("face", q["face_c"], 0.05), ("nasion", q["nasion"], 0.014),
           ("tip", q["tip"], 0.014), ("chin", q["chin_c"], 0.022), ("mouth", (0.0, q["mouth_t"], q["mouth_z"]), 0.014),
           ("brow", (0.0, 0.127 + q["brow_t"], 0.098), 0.02), ("muzzle", q["muzzle_c"], 0.025)]
    for s, S in ((1, "L"), (-1, "R")):
        mw = q["mouth_w"]

        def m(c):
            return (s * c[0], c[1], c[2])
        out += [("eye" + S, m(q["eye"]), 0.016), ("ala" + S, m(q["ala"]), 0.008), ("gonion" + S, m(q["gonion"]), 0.022),
                ("mental" + S, m(q["mental"]), 0.016), ("cheek" + S, m(q["cheek_c"]), 0.02),
                ("corner" + S, (s * mw, q["mouth_t"], q["mouth_z"] - q["arch_k"] * mw * mw), 0.008)]
    return out


def warp(V, qa, qb):
    """Move points of head qa so that qa's landmarks land on qb's (a smooth blend of the landmark moves); the ears
    move with their own frames."""
    A, Bn = anchors(qa), anchors(qb)
    acc = np.zeros_like(V)
    wsum = np.full(len(V), 0.35)
    for (n, a, r), (_, b, _) in zip(A, Bn):
        d = np.array(b) - np.array(a)
        w = np.exp(-((V - np.array(a)) ** 2).sum(-1) / (r * r))
        acc += w[:, None] * d
        wsum += w
    out = V + acc / wsum[:, None]
    # the ears: as a piece, in their own frame
    for s in (1, -1):
        oa, aa, ba, na = ear_frame(qa, s)
        ob_, ab, bb, nb = ear_frame(qb, s)
        loc = np.stack([(V - oa) @ aa, (V - oa) @ ba, (V - oa) @ na], -1)
        kl = np.array((qb["ear_len"] / qa["ear_len"], qb["ear_w"] / qa["ear_w"], 1.0))
        moved = ob_ + (loc * kl) @ np.stack([ab, bb, nb])
        e2 = np.sqrt((loc[:, 0] / qa["ear_len"]) ** 2 + ((loc[:, 1] + 0.004) / qa["ear_w"]) ** 2)
        w = np.clip((1.35 - e2) / 0.35, 0, 1) * np.clip((loc[:, 2] + 0.006) / 0.006, 0, 1)
        out = out * (1 - w[:, None]) + moved * w[:, None]
    return out


def edge_verts(T):
    E = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1)
    u, cnt = np.unique(E, axis=0, return_counts=True)
    return np.unique(u[cnt == 1])


def move_to(V, T, qa, qb, lod=0):
    """The reference mesh V of head qa, moved onto head qb (same vertices)."""
    W = warp(V, qa, qb)
    f = lambda p: head_sdf(p, qb, lod)  # noqa: E731
    inner = np.ones(len(W), bool)
    inner[edge_verts(T)] = False
    W[inner] = sdf.project(f, W[inner], steps=5)
    if not lod:
        for s in (1, -1):
            snap_margin(W, T, qb, s)
    return W


# ---------------------------------------------------------------- UVs (the head's square in a body's picture)

SPH_C = np.array((0.0, 0.095, -0.005))
TH_DEG = np.array([-88.0, -45.0, -20.0, 0.0, 20.0, 40.0, 65.0, 90.0])
TH_B = np.array([0.0, 0.13, 0.31, 0.47, 0.63, 0.77, 0.92, 1.0])
K_U = 0.5
SPH_B0 = 0.2  # the sphere chart's bottom in the square; below it: the ears, the eye, the dark mouth
EAR_A = ((0.02, 0.27), (0.29, 0.54))  # front, back
EYE_A = (0.58, 0.76)
DARK = (0.83, 0.05)


def rect_to_uv(a, b):
    u0, v0, u1, v1 = HEAD_RECT
    return np.stack([u0 + (u1 - u0) * np.asarray(a, np.float64), v0 + (v1 - v0) * np.asarray(b, np.float64)], -1)


A_IN = 0.012  # the chart stays this far inside the square's sides and top (the picture's own edges wrap round)


def sphere_ab(P):
    d = P - SPH_C
    phi = np.arctan2(d[:, 0], d[:, 2])
    th = np.degrees(np.arctan2(d[:, 1], np.sqrt(d[:, 0] ** 2 + d[:, 2] ** 2)))
    sv = phi / np.pi
    a = 0.5 + 0.5 * (sv * (1 + K_U) - K_U * sv * np.abs(sv))
    b = SPH_B0 + (1 - SPH_B0 - A_IN) * np.interp(th, TH_DEG, TH_B)
    return A_IN + (1 - 2 * A_IN) * a, b


def ab_to_dir(a, b):
    """The inverse of sphere_ab: a direction from SPH_C for chart coordinates (the painter's rays)."""
    a = np.clip((np.asarray(a) - A_IN) / (1 - 2 * A_IN), 0, 1)
    y = 2 * (a - 0.5)
    k = K_U
    sgn = np.sign(y)
    ay = np.abs(y)
    sv = sgn * ((1 + k) - np.sqrt(np.maximum((1 + k) ** 2 - 4 * k * ay, 0))) / (2 * k)
    phi = sv * np.pi
    th = np.radians(np.interp((np.asarray(b) - SPH_B0) / (1 - SPH_B0 - A_IN), TH_B, TH_DEG))
    return np.stack([np.sin(phi) * np.cos(th), np.sin(th), np.cos(phi) * np.cos(th)], -1)


def ear_ab(P, q, s, back):
    o, a, b, n = ear_frame(q, s)
    ua, ub = (P - o) @ a, (P - o) @ b
    a0, a1 = EAR_A[1 if back else 0]
    uu = (ub + 0.026) / 0.052
    if s < 0:
        uu = 1 - uu
    if back:
        uu = 1 - uu
    return a0 + (a1 - a0) * np.clip(uu, 0, 1), 0.012 + 0.176 * np.clip((ua + 0.037) / 0.074, 0, 1)


def ear_ab_inverse(a, b, q, s, back):
    """Chart coordinates of an ear chart back to a point on the ear's plane (ua, ub) for the painter."""
    a0, a1 = EAR_A[1 if back else 0]
    uu = (np.asarray(a) - a0) / (a1 - a0)
    if back:
        uu = 1 - uu
    if s < 0:
        uu = 1 - uu
    ub = uu * 0.052 - 0.026
    ua = (np.asarray(b) - 0.012) / 0.176 * 0.074 - 0.037
    return ua, ub


def corner_ab(Pc):
    """Sphere-chart coordinates per triangle corner (Pc: (n, 3, 3)); corners on the back's middle line (the seam)
    take the side of their triangle."""
    Pc = np.array(Pc, float)
    side = np.sign(Pc[:, :, 0].sum(1))
    side[side == 0] = 1.0
    on = (np.abs(Pc[:, :, 0]) < 1e-6) & (Pc[:, :, 2] < SPH_C[2])
    Pc[:, :, 0] = np.where(on, side[:, None] * 1e-5, Pc[:, :, 0])
    a, b = sphere_ab(Pc.reshape(-1, 3))
    return a.reshape(-1, 3), b.reshape(-1, 3)


def classify(V, T, q):
    """Per triangle: 0 the head (sphere chart), 1/2 the left ear front/back, 3/4 the right ear front/back, 5 dark
    (the inside of the mouth, the nostrils)."""
    cls = np.zeros(len(T), np.int64)
    noear = head_sdf(V, q, ears=False)
    isear = np.zeros(len(V), bool)
    side_of = np.zeros(len(V))
    for s in (1, -1):
        o, a, b, n = ear_frame(q, s)
        loc = np.stack([(V - o) @ a, (V - o) @ b, (V - o) @ n], -1)
        e2 = np.sqrt((loc[:, 0] / q["ear_len"]) ** 2 + ((loc[:, 1] + 0.004) / q["ear_w"]) ** 2)
        m = (e2 < 1.15) & (noear > 0.0022) & (s * V[:, 0] > 0)
        isear |= m
        side_of[m] = s
    c = V[T].mean(1)
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    for i, tri in enumerate(T):
        if isear[tri].all():
            s = side_of[tri[0]]
            n = ear_frame(q, s)[3]
            back = fn[i] @ n < 0
            cls[i] = (1 if s > 0 else 3) + (1 if back else 0)
    mt, mw, mz, ak = q["mouth_t"], q["mouth_w"], q["mouth_z"], q["arch_k"]
    za = mz - ak * c[:, 0] ** 2
    pocket = (np.abs(c[:, 1] - mt) < 0.0017) & (np.abs(c[:, 0]) < mw + 0.0015) & (c[:, 2] < za - 0.0008)
    cls[pocket & (cls == 0)] = 5
    return cls


def loop_uvs(V, T, q):
    """UVs per triangle corner (len(T), 3, 2) for the reference mesh, and each triangle's chart."""
    cls = classify(V, T, q)
    A, Bb = corner_ab(V[T])
    for k, (s, back) in {1: (1, False), 2: (1, True), 3: (-1, False), 4: (-1, True)}.items():
        m = cls == k
        if m.any():
            ea, eb = ear_ab(V[T[m]].reshape(-1, 3), q, s, back)
            A[m] = ea.reshape(-1, 3)
            Bb[m] = eb.reshape(-1, 3)
    m = cls == 5
    A[m] = DARK[0]
    Bb[m] = DARK[1]
    return rect_to_uv(A, Bb), cls


# ---------------------------------------------------------------- eyes

EYE_RINGS = [0.0, 9.0, 20.0, 30.0, 42.0, 62.0, 88.0, 116.0]


def eyeball(r, segs=10):
    """An eyeball about the origin looking along +z (head frame) with a low cornea bulge over the iris. Returns
    verts, triangles and chart coordinates (-1..1 across the front)."""
    V = [(0.0, 0.0, r * 1.035)]
    uv = [(0.0, 0.0)]
    for ang in EYE_RINGS[1:]:
        a = math.radians(ang)
        bulge = 1.0 + 0.035 * math.cos(a / math.radians(30.0) * math.pi / 2) if ang < 30 else 1.0
        for k in range(segs):
            ph = 2 * math.pi * k / segs
            x, y, z = math.sin(a) * math.cos(ph), math.sin(a) * math.sin(ph), math.cos(a)
            V.append((x * r * bulge, y * r * bulge, z * r * bulge))
            rr = min(1.0, math.sin(a)) if ang <= 90 else 1.0
            uv.append((rr * math.cos(ph), rr * math.sin(ph)))
    V.append((0.0, 0.0, -r * 0.6))
    uv.append((1.0, 0.0))
    T = []
    for k in range(segs):
        T.append((0, 1 + k, 1 + (k + 1) % segs))
    nr = len(EYE_RINGS) - 1
    for ri in range(nr - 1):
        b0, b1 = 1 + ri * segs, 1 + (ri + 1) * segs
        for k in range(segs):
            k2 = (k + 1) % segs
            T += [(b0 + k, b1 + k, b1 + k2), (b0 + k, b1 + k2, b0 + k2)]
    last = 1 + (nr - 1) * segs
    back = len(V) - 1
    for k in range(segs):
        T.append((last + k, back, last + (k + 1) % segs))
    return np.array(V), np.array(T), np.array(uv)


def eye_uv(c):
    a0, a1 = EYE_A
    h = (a1 - a0) / 2
    return rect_to_uv((a0 + a1) / 2 + c[..., 0] * h * 0.98, 0.1 + c[..., 1] * 0.088)


# ---------------------------------------------------------------- the reference, once per build

_REF = {}


def reference(target0=2200, target1=330):
    """The reference meshes (near and far) of the reference man, made once per build (about a minute)."""
    if _REF:
        return _REF
    q = neutral()
    V0, T0 = mesh_field(lambda p: head_sdf(p, q), q, target0, h=0.0008)
    V1, T1 = mesh_field(lambda p: head_sdf(p, q, lod=1), q, target1, h=0.0016, lod=1, name="head_ref1")
    uv0, cls0 = loop_uvs(V0, T0, q)
    uv1, _ = loop_uvs(V1, T1, q)
    _REF.update(q=q, V0=V0, T0=T0, V1=V1, T1=T1, uv0=uv0, uv1=uv1, cls0=cls0, eye=eyeball(q["eye_r"]))
    return _REF


# ---------------------------------------------------------------- a body's head

def to_world(Vh, P):
    """Head frame to the body's rest (before the stoop) game space."""
    from . import body as bd
    chin = bd.Y(P, 0.870)
    return np.stack([Vh[:, 0] * P["hw"], chin + Vh[:, 1] * P["hs"], (Vh[:, 2] + HEAD_Z) * P["hw"]], -1)


def to_head(W, P):
    from . import body as bd
    chin = bd.Y(P, 0.870)
    return np.stack([W[:, 0] / P["hw"], (W[:, 1] - chin) / P["hs"], W[:, 2] / P["hw"] - HEAD_Z], -1)


def stooped(W, P):
    from . import body as bd
    fn = bd.stoop_fn(P)
    return np.array([fn(tuple(p), "neck") for p in W])


def eye_world(P, side):
    """An eye's centre in game space after the stoop (the eye bones' heads)."""
    q = neutral(P)
    e = np.array([[side * q["eye"][0], q["eye"][1], q["eye"][2]]])
    return stooped(to_world(e, P), P)[0]


def jaw_share(Vh, q):
    """How much of each head vertex goes with the jaw: the lower lip, the chin, the jaw line; the slit splits the
    lips sharply, the cheeks and the under-chin share."""
    x, t, z = Vh[:, 0], Vh[:, 1], Vh[:, 2]
    mt, mw, mz, ak = q["mouth_t"], q["mouth_w"], q["mouth_z"], q["arch_k"]
    # below a line from the mouth slit rising back toward the jaw joint
    line = mt + np.maximum(0.0, (mz - ak * np.minimum(np.abs(x), mw) ** 2) - z) * 0.38 + np.maximum(0, np.abs(x) - mw) * 0.6
    jw = np.clip((line - t) / 0.010 + 0.5, 0, 1)
    lipzone = (np.abs(x) < mw * 0.96) & (z > mz - ak * x * x - 0.016) & (np.abs(t - mt) < 0.012)
    jw = np.where(lipzone, (t < mt).astype(np.float64), jw)
    # behind the jaw's back edge nothing moves with it
    jw *= np.clip((z - (q["gonion"][2] - 0.012)) / 0.016, 0, 1)
    # under the chin: shared with the neck, less toward the throat
    under = np.clip((t + 0.004) / 0.018, 0, 1)
    jw *= 0.45 + 0.55 * under
    jw *= np.clip((t + 0.030) / 0.025, 0, 1)
    return jw


def vertex_weights(P, y_rest, jaw):
    """A head vertex's bone weights: the neck and head by height (A's spine chain), shared with the jaw."""
    from . import weights as wt
    w = wt.spine_chain(P, y_rest)
    w = {n: x * (1 - jaw) for n, x in w.items()}
    w["jaw"] = w.get("jaw", 0.0) + jaw
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    tt = sum(x for _, x in top) or 1.0
    return {n: x / tt for n, x in top if x > 1e-4}


def blink_offsets(Vh, q):
    """The blink shape: the upper lids close down over the eyes, the lower lids rise a little to meet them."""
    out = np.zeros_like(Vh)
    R1 = q["eye_r"] + 0.0006
    a0, a1 = math.radians(q["az_in"]), math.radians(q["az_out"])
    ac, half = (a0 + a1) / 2, (a1 - a0) / 2
    for s in (1, -1):
        e = np.array((s * q["eye"][0], q["eye"][1], q["eye"][2]))
        az, el, r = eye_angles(Vh, e, s)
        sv = (az - ac) / half
        up, lo = lid_curves(q, sv)
        meet = lo + 0.28 * (up - lo)
        near = (r < R1 + 0.011) & (np.abs(sv) < 1.25) & (Vh[:, 2] > e[2] - 0.004)
        side_fade = np.clip((1.25 - np.abs(sv)) / 0.35, 0, 1)
        fu = np.clip(1 - (el - up) / math.radians(38), 0, 1) ** 1.3 * (el >= up - 0.02)
        fl = np.clip(1 - (lo - el) / math.radians(30), 0, 1) ** 1.3 * (el <= lo + 0.02)
        de = np.where(el > (up + lo) / 2, -(up - meet) * fu, (meet - lo) * fl) * side_fade * near
        el2 = el + de
        d = np.stack([s * np.sin(az) * np.cos(el2), np.sin(el2), np.cos(az) * np.cos(el2)], -1)
        new = e + d * r[:, None]
        out += np.where((near & (de != 0))[:, None], new - Vh, 0.0)
    return out


_HEADS = {}


def head_for(P, lod):
    """The head of body P: dict(V rest, Vs stooped, T, uv per corner, jaw share, shapes {name: offsets in game
    space}, eyes). Made once per body and copy."""
    key = (P["base"], P["build"], lod)
    if key not in _HEADS:
        _HEADS[key] = _head_for(P, lod)
    return _HEADS[key]


def _head_for(P, lod):
    R = reference()
    q0 = R["q"]
    qb = neutral(P)
    V = R["V0"] if lod == 0 else R["V1"]
    T = R["T0"] if lod == 0 else R["T1"]
    Vh = move_to(V, T, q0, qb, lod)
    W = to_world(Vh, P)
    out = dict(Vh=Vh, V=W, Vs=stooped(W, P), T=T, uv=R["uv0"] if lod == 0 else R["uv1"], jaw=jaw_share(Vh, qb), q=qb)
    if lod == 0:
        hs = np.array((P["hw"], P["hs"], P["hw"]))
        shapes = {}
        for name in SHAPE_NAMES:
            Vs_ = move_to(Vh, T, qb, shaped(qb, name), lod)
            shapes[name] = (Vs_ - Vh) * hs
        shapes["blink"] = blink_offsets(Vh, qb) * hs
        for k in shapes:  # keep the morph targets sparse: moves under a quarter millimetre are noise
            o = shapes[k]
            o[np.linalg.norm(o, axis=1) < SPARSE] = 0.0
        out["shapes"] = shapes
        eV, eT, eC = R["eye"]
        eyes = []
        for s in (1, -1):
            e = np.array((s * qb["eye"][0], qb["eye"][1], qb["eye"][2]))
            r = qb["eye_r"] / q0["eye_r"]
            Ew = to_world(e + eV * r, P)
            eyes.append(dict(V=Ew, Vs=stooped(Ew, P), T=eT, uv=eye_uv(eC), side=s))
        out["eyes"] = eyes
    return out


# ---------------------------------------------------------------- onto a body mesh

def _loop_from(lp, co, zc):
    """Start a loop at its front-most vertex and run it anticlockwise seen from above (x toward z)."""
    lp = list(lp)
    ang = np.arctan2(co[lp, 0], co[lp, 2] - zc)
    k = int(np.argmin(np.abs(ang)))
    lp = lp[k:] + lp[:k]
    a = np.unwrap(np.arctan2(co[lp, 0], co[lp, 2] - zc))
    if a[min(3, len(a) - 1)] < a[0]:
        lp = [lp[0]] + lp[1:][::-1]
    return lp


def zip_loops(A, Bl, co, pattern=None):
    """Triangles joining two closed loops (A the head's, Bl the body's ring), greedy by the shorter diagonal, or by a
    pattern from an earlier body (the same topology joins the same way). Returns (triangles, pattern)."""
    n, m = len(A), len(Bl)
    i = j = 0
    tris, pat = [], []
    k = 0
    while i < n or j < m:
        if pattern is not None:
            adv_a = pattern[k]
        elif i >= n:
            adv_a = False
        elif j >= m:
            adv_a = True
        else:
            da = np.linalg.norm(co[A[(i + 1) % n]] - co[Bl[j % m]])
            db = np.linalg.norm(co[A[i % n]] - co[Bl[(j + 1) % m]])
            adv_a = da < db
        if adv_a:
            tris.append((A[i % n], Bl[j % m], A[(i + 1) % n]))
            i += 1
        else:
            tris.append((A[i % n], Bl[j % m], Bl[(j + 1) % m]))
            j += 1
        pat.append(adv_a)
        k += 1
    return tris, pat


_ZIP = {}


def attach(ob, P, lod, vparts_name="part_head"):
    """Replace A's placeholder head of body mesh `ob` (its faces have material index 1) with this head: the faces go,
    the head's mesh is added and joined to A's neck ring, UVs, weights and (near copy) eyes and shape keys set."""
    import bmesh

    from . import B, G
    from . import weights as wt

    H = head_for(P, lod)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    dl = bm.verts.layers.deform.verify()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == 1], context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    nbody = len(bm.verts)
    # BMesh reuses the slots of deleted vertices: new vertices are kept by reference, never by index
    allv = list(bm.verts)
    # the ring: the open loop left by the head
    ring_edges = [e for e in bm.edges if e.is_boundary]
    nxt = {}
    for e in ring_edges:
        f = e.link_faces[0]
        for lo in f.loops:
            if lo.edge == e:
                nxt[lo.vert.index] = lo.link_loop_next.vert.index
    start = next(iter(nxt))
    ring = [start]
    c = nxt[start]
    while c != start:
        ring.append(c)
        c = nxt[c]
    for gname in ("part_eye", "eyeL", "eyeR", vparts_name):
        if gname not in ob.vertex_groups:
            ob.vertex_groups.new(name=gname)
    gi = {g.name: g.index for g in ob.vertex_groups}
    # the head's vertices
    hv = []
    for p in H["Vs"]:
        hv.append(bm.verts.new(B(*p)))
    allv += hv
    local = {v: k for k, v in enumerate(hv)}
    from . import body as bd
    for k, v in enumerate(hv):
        for n, x in vertex_weights(P, H["V"][k][1], H["jaw"][k]).items():
            v[dl][gi[n]] = x
        v[dl][gi[vparts_name]] = 1.0
    for ti, tri in enumerate(H["T"]):
        try:
            f = bm.faces.new([hv[a] for a in tri])
        except ValueError:
            continue
        f.smooth = True
        for ci, lo in enumerate(f.loops):
            lo[uvl].uv = tuple(H["uv"][ti, ci])
    # the zip strip
    co = np.array([G(v.co) for v in allv])
    loops = boundary_loops(np.array(H["T"]))
    zc = (H["q"]["neck_z"] + HEAD_Z) * P["hw"]
    neck_loop = None
    for lp in loops:
        c_ = H["Vh"][lp].mean(0)
        if c_[1] < 0.05 and (neck_loop is None or len(lp) > len(neck_loop)):
            neck_loop = lp
    A = _loop_from([nbody + i for i in neck_loop], co, zc)
    Bl = _loop_from(ring, co, zc)
    key = (lod, len(A), len(Bl))
    tris, pat = zip_loops(A, Bl, co, _ZIP.get(key))
    _ZIP.setdefault(key, pat)
    # one winding for the whole strip, from the head's own edge A0 -> A1: the strip must run it backwards
    la, lb = A[0] - nbody, A[1] - nbody
    flip = True
    for tri in H["T"]:
        tl = list(tri)
        if la in tl and lb in tl:
            k = tl.index(la)
            flip = tl[(k + 1) % 3] != lb
            break
    for tri in tris:
        vs = [allv[i] for i in (tri[::-1] if flip else tri)]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        f.smooth = True
        # corner UVs on the head's sphere chart (from the corners' rest positions)
        pts = []
        for v in f.verts:
            if v in local:
                pts.append(H["Vh"][local[v]])
            else:
                pts.append(to_head(np.array([G(v.co)]), P)[0])
        a, b = corner_ab(np.array([pts]))
        uv = rect_to_uv(a[0], b[0])
        for lo, u in zip(f.loops, uv):
            lo[uvl].uv = tuple(u)
    # eyes (near copy)
    if lod == 0:
        for E in H["eyes"]:
            ev = [bm.verts.new(B(*p)) for p in E["Vs"]]
            bone = "eyeL" if E["side"] > 0 else "eyeR"
            for v in ev:
                v[dl][gi[bone]] = 1.0
                v[dl][gi["part_eye"]] = 1.0
            for tri in E["T"]:
                f = bm.faces.new([ev[a] for a in tri])
                f.smooth = True
                for lo, vi in zip(f.loops, tri):
                    lo[uvl].uv = tuple(E["uv"][vi])
    bm.verts.index_update()
    head_idx = np.array([v.index for v in hv])
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.material_index = 0
    # the face shapes and the blink: shape keys (morph targets) of the near copy
    if lod == 0:
        n = len(me.vertices)
        if not me.shape_keys:
            ob.shape_key_add(name="Basis", from_mix=False)
        basis = np.zeros(n * 3)
        me.vertices.foreach_get("co", basis)
        basis = basis.reshape(-1, 3)
        for name, off in H["shapes"].items():
            sk = ob.shape_key_add(name=name, from_mix=False)
            co2 = basis.copy()
            o = np.array([B(*d) for d in off])
            co2[head_idx] += o
            sk.data.foreach_set("co", co2.ravel())
            sk.value = 0.0
    return dict(nbody=nbody, nhead=len(H["Vs"]), ring=len(ring))


# ---------------------------------------------------------------- the picture's layout

def reserve_head_rect(ob, margin=0.006):
    """Lay the body's UV islands (all but A's placeholder head, material index 1) out again so that HEAD_RECT stays
    free for the head. Islands keep their relative sizes; shelves from the bottom, rows reaching into the head's
    square stop short of it."""
    me = ob.data
    uvd = me.uv_layers.active.data
    uv = np.zeros(len(uvd) * 2)
    uvd.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    seam = {tuple(sorted(e.vertices)) for e in me.edges if e.use_seam}
    polys = [p for p in me.polygons if p.material_index != 1]
    parent = {p.index: p.index for p in polys}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    edge_faces = {}
    for p in polys:
        vs = list(p.vertices)
        for i in range(len(vs)):
            k = tuple(sorted((vs[i], vs[(i + 1) % len(vs)])))
            if k not in seam:
                edge_faces.setdefault(k, []).append(p.index)
    for fs in edge_faces.values():
        for f in fs[1:]:
            ra, rb = find(fs[0]), find(f)
            if ra != rb:
                parent[rb] = ra
    isl = {}
    for p in polys:
        isl.setdefault(find(p.index), []).extend(p.loop_indices)
    boxes = []
    for loops in isl.values():
        loops = np.array(loops)
        q = uv[loops]
        lo = q.min(0)
        boxes.append((loops, q - lo))
    boxes.sort(key=lambda b: -b[1][:, 1].max())
    u0, v0 = HEAD_RECT[0], HEAD_RECT[1]

    def place(scale):
        pad = margin * 2
        x = y = row_h = 0.0
        out = []
        for loops, q in boxes:
            w_, h_ = q.max(0) * scale
            limit = 1.0 if y + h_ <= v0 - pad else u0 - pad
            if x + w_ > limit:
                x, y, row_h = 0.0, y + row_h + pad, 0.0
                limit = 1.0 if y + h_ <= v0 - pad else u0 - pad
                if w_ > limit:
                    return None
            out.append((loops, q * scale + (x + pad / 2, y + pad / 2)))
            x += w_ + pad
            row_h = max(row_h, h_)
        if y + row_h + pad > 1.0:
            return None
        return out
    lo_s, hi_s = 0.1, 4.0
    best = None
    for _ in range(30):
        mid = (lo_s + hi_s) / 2
        r = place(mid)
        if r is None:
            hi_s = mid
        else:
            lo_s, best = mid, r
    for loops, q in best:
        uv[loops] = q
    uvd.foreach_set("uv", uv.ravel())
    me.update()
    return lo_s

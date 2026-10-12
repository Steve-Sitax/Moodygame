"""The face painter (docs/people.md "Faces"): the head's square of a body's picture, 512 px (1024 for the named cast).

Every texel of the square is traced back to the point of the reference head it shows (head.sphere_ab and its
inverse: a ray from head.SPH_C; the ears and the eyeball have charts of their own), once per size. Then a look (a
dict, look_for()) is painted by position on the head, as A's paint.py paints the body: skin tone and its mottling,
the flush of cheeks, nose and ears, the lips, the lid margins and lashes, brows, the scalp's hair and the hairline of
the hair style, stubble and painted beards, wrinkles by age, a drinker's nose and cheeks, pox scars, freckles, soot.
A height field is painted with it (pores, wrinkles, scars, stubble, the lip lines) and turned into a tangent-space
normal map (OpenGL convention, as glTF wants).

Plain and weathered, never glossy: the colours are matte, contrast stays low, eye whites are dimmed (they glow in the
fog otherwise).
"""

import math

import numpy as np

from . import hair as hr
from . import head as hd
from . import sdf
from .paint import _noise3

# skin tones (sRGB): fair Flemish, middling, weathered outdoor, olive, a dark-skinned sailor
TONES = [(0.87, 0.71, 0.61), (0.81, 0.63, 0.52), (0.72, 0.53, 0.41), (0.73, 0.58, 0.44), (0.45, 0.31, 0.23)]
HAIR = {"black": (0.07, 0.06, 0.055), "dark": (0.16, 0.11, 0.08), "brown": (0.30, 0.20, 0.13),
        "light": (0.50, 0.38, 0.24), "fair": (0.66, 0.54, 0.36), "red": (0.46, 0.22, 0.11), "grey": (0.52, 0.50, 0.48),
        "white": (0.78, 0.77, 0.74)}
IRIS = {"brown": (0.19, 0.12, 0.07), "hazel": (0.28, 0.23, 0.12), "grey": (0.30, 0.32, 0.33),
        "blue": (0.23, 0.30, 0.37), "green": (0.23, 0.28, 0.20)}
IRIS_P = {"brown": 0.38, "hazel": 0.2, "grey": 0.17, "blue": 0.15, "green": 0.10}


def look_for(seed, sex="m", age=35, **over):
    """A seeded look. sex m/f; age in years; anything can be given instead of drawn."""
    rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
    female = sex == "f"
    tone = float(rng.choice([0.0, 0.5, 1.0, 1.0, 1.5, 2.0, 2.0, 2.5, 3.0], p=None))
    if rng.random() < 0.03:
        tone = 4.0
    hair = str(rng.choice(["black", "dark", "dark", "brown", "brown", "brown", "light", "fair", "red"]))
    if age > 62:
        hair = "white" if rng.random() < 0.5 else "grey"
    elif age > 48 and rng.random() < 0.6:
        hair = "grey"
    lk = dict(
        seed=int(seed), sex=sex, age=float(age), tone=tone,
        ruddy=float(rng.uniform(0.0, 0.6)), weather=float(rng.uniform(0.2, 1.0)),
        stubble=0.0 if female or age < 15 else float(rng.choice([0.15, 0.4, 0.6, 0.8, 1.0])),
        beard=None, moustache=None,
        hair=hair, hair_rgb=HAIR[hair], hairline="parted" if female else str(rng.choice(["crop", "crop", "side", "recede"])),
        iris=str(rng.choice(list(IRIS_P), p=list(IRIS_P.values()))), drinker=float(rng.choice([0, 0, 0, 0, 0.5, 1.0])) if not female else 0.0,
        pox=float(rng.choice([0, 0, 0, 0, 0, 0.6, 1.0])), freckles=float(rng.choice([0, 0, 0, 0.6]) if tone < 1.2 else 0.0),
        soot=0.0, brow=float(rng.uniform(0.7, 1.3)), lip=float(rng.uniform(0.8, 1.2)), skin_rgb=None,
    )
    if age > 55 and not female and rng.random() < 0.5:
        lk["hairline"] = "bald"
    if age < 15:
        lk["hairline"] = "crop" if not female else "parted"
    lk.update(over)
    return lk


# the base bodies' own looks (people2.glb): A's skin colours, plain, a little stubble on the men
BASE_LOOKS = {
    "m": dict(seed=11, sex="m", age=32.0, tone=1.0, ruddy=0.3, weather=0.5, stubble=0.45, beard=None, moustache=None,
              hair="dark", hair_rgb=(0.20, 0.15, 0.11), hairline="crop", iris="brown", drinker=0.0, pox=0.0,
              freckles=0.0, soot=0.0, brow=1.0, lip=1.0, skin_rgb=(0.80, 0.63, 0.53)),
    "f": dict(seed=12, sex="f", age=30.0, tone=0.5, ruddy=0.25, weather=0.3, stubble=0.0, beard=None, moustache=None,
              hair="brown", hair_rgb=(0.30, 0.20, 0.13), hairline="parted", iris="grey", drinker=0.0, pox=0.0,
              freckles=0.0, soot=0.0, brow=0.9, lip=1.05, skin_rgb=(0.83, 0.67, 0.58)),
}
BASE_LOOKS["boy"] = dict(BASE_LOOKS["m"], seed=13, age=10.0, stubble=0.0, weather=0.3, ruddy=0.4, hair="brown",
                         hair_rgb=(0.30, 0.20, 0.13), brow=0.8)
BASE_LOOKS["old_m"] = dict(BASE_LOOKS["m"], seed=14, age=68.0, stubble=0.35, weather=0.8, hair="grey",
                           hair_rgb=(0.62, 0.60, 0.57), hairline="bald", ruddy=0.45)
BASE_LOOKS["old_f"] = dict(BASE_LOOKS["f"], seed=15, age=66.0, weather=0.5, hair="grey", hair_rgb=(0.66, 0.63, 0.60))


def skin_rgb(lk):
    if lk.get("skin_rgb") is not None:
        return np.array(lk["skin_rgb"], np.float32)
    t = lk["tone"]
    i = min(int(t), len(TONES) - 2)
    f = t - i
    c = np.array(TONES[i]) * (1 - f) + np.array(TONES[i + 1]) * f
    return c.astype(np.float32)


# ---------------------------------------------------------------- where every texel is

_GEO = {}


def _trace(f, origin, dirs, start=0.26, iters=90):
    """Sphere-trace from outside along -dirs toward origin: the outermost surface point on each ray."""
    p = origin + dirs * start
    todo = np.ones(len(p), bool)
    for _ in range(iters):
        if not todo.any():
            break
        idx = np.nonzero(todo)[0]
        d = f(p[idx])
        p[idx] -= dirs[idx] * (d * 0.85)[:, None]
        todo[idx[np.abs(d) < 2e-5]] = False
    return p


def geometry(size):
    """Per texel of the head's square: the point on the reference head (head frame), its normal, which chart, the
    soft shade of folds (ambient occlusion) and a few distances the painter needs."""
    if size in _GEO:
        return _GEO[size]
    q = hd.neutral()
    f = lambda p: hd.head_sdf(p, q)  # noqa: E731
    f_head = lambda p: hd.head_sdf(p, q, ears=False)  # noqa: E731  (the head's chart: the skin under the ears)
    a = (np.arange(size) + 0.5) / size
    A, Bm = np.meshgrid(a, a)  # rows run up the picture (v), columns across (u)
    region = np.full((size, size), -1, np.int64)
    P = np.zeros((size, size, 3))
    # the sphere chart
    m = Bm >= hd.SPH_B0
    dirs = hd.ab_to_dir(A[m], Bm[m])
    P[m] = _trace(f_head, hd.SPH_C, dirs)
    region[m] = 0
    # the ear charts (front: traced in from outside along the ear's normal; back: on the ear's back plane)
    for s, k0 in ((1, 1), (-1, 3)):
        o, ea, eb, en = hd.ear_frame(q, s)
        for back in (False, True):
            a0, a1 = hd.EAR_A[1 if back else 0]
            mm = (Bm < hd.SPH_B0) & (A >= a0) & (A < a1) & (Bm < 0.19)
            if s < 0:
                # both ears share one chart pair; the right ear's points are painted from the left ear's (mirrored)
                continue
            ua, ub = hd.ear_ab_inverse(A[mm], Bm[mm], q, s, back)
            base = o + ua[:, None] * ea + ub[:, None] * eb
            if not back:
                P[mm] = _trace(f, base, np.tile(en, (len(base), 1)), start=0.03, iters=60)
            else:
                P[mm] = base + en * 0.001
            region[mm] = 1 if not back else 2
    # the eyeball chart and the dark patch
    a0, a1 = hd.EYE_A
    me = (Bm < 0.19) & (A >= a0) & (A < a1)
    region[me] = 6
    for k, (s0, s1, t0, t1) in ((7, hr.SWATCH), (8, hr.SWATCH_BRAID)):
        region[(A >= s0 - 0.004) & (A < s1 + 0.004) & (Bm >= t0 - 0.004) & (Bm < t1 + 0.004)] = k
    md = (Bm < 0.12) & (A >= 0.80) & (A < 0.88)
    region[md] = 5
    N = np.zeros_like(P)
    sel = (region >= 0) & (region <= 4)
    N[sel] = sdf.normals(f, P[sel])
    m0 = region == 0
    N[m0] = sdf.normals(f_head, P[m0])
    # ambient occlusion from the field: how close other surface is along the normal, at three reaches
    ao = np.ones((size, size))
    for reach, wgt in ((0.003, 0.35), (0.008, 0.4), (0.018, 0.25)):
        dd = f(P[sel] + N[sel] * reach)
        ao[sel] -= wgt * (1 - np.clip(dd / reach, 0, 1))
    parts = {}
    hd.head_sdf(P[sel], q, parts=parts)
    lips = np.full((size, size), 1.0)
    nose = np.full((size, size), 1.0)
    lips[sel] = parts["lips"]
    nose[sel] = parts["nose"]
    # metres per texel across and up (for the normal map's slopes)
    du = np.linalg.norm(np.gradient(P, axis=1), axis=-1)
    dv = np.linalg.norm(np.gradient(P, axis=0), axis=-1)
    g = dict(q=q, A=A, B=Bm, P=P, N=N, region=region, ao=ao, lips=lips, nose=nose, du=np.maximum(du, 1e-5),
             dv=np.maximum(dv, 1e-5), size=size)
    _GEO[size] = g
    return g


# ---------------------------------------------------------------- painting

def _sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _groove(dist, width):
    return np.exp(-(dist / width) ** 2)


def _seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    h = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
    return np.hypot(px - ax - h * dx, py - ay - h * dy), h


def hairline_t(lk, phi_deg):
    """The hairline's height round the head (hair.hairline_t)."""
    return hr.hairline_t(lk["sex"], lk.get("hairline", "crop"), phi_deg)


def paint(lk, size=512):
    """Paint a look into the head's square. Returns rgb (size, size, 3, sRGB 0..1), height (metres) and the normal
    map (size, size, 3, 0..1)."""
    g = geometry(size)
    q = g["q"]
    P, N, region, ao = g["P"], g["N"], g["region"], g["ao"]
    x, t, z = P[..., 0], P[..., 1], P[..., 2]
    ax = np.abs(x)
    seed = lk["seed"]
    rng = np.random.default_rng(seed + 7)
    age = lk["age"]
    agef = float(np.clip((age - 25) / 45, 0, 1))
    female = lk["sex"] == "f"
    child = age < 15
    base = skin_rgb(lk)
    img = np.ones((size, size, 3), np.float32) * base
    h = np.zeros((size, size))
    on = region >= 0
    # mottling at three scales; the weathered get a coarser, browner skin
    n1 = _noise3(P, 18.0, seed)
    n2 = _noise3(P, 70.0, seed + 1)
    n3 = _noise3(P, 260.0, seed + 2)
    img *= (1 + 0.045 * n1 + 0.025 * n2 + (0.018 + 0.012 * lk["weather"]) * n3)[..., None]
    h += 0.00004 * n3 + 0.00002 * _noise3(P, 900.0, seed + 3)

    def mix(wv, col):
        nonlocal img
        wv = np.clip(wv, 0, 1)[..., None]
        img = img * (1 - wv) + np.asarray(col, np.float32) * wv

    def mul(wv, col):
        nonlocal img
        wv = np.clip(wv, 0, 1)[..., None]
        img = img * (1 - wv) + img * np.asarray(col, np.float32) * wv

    face = on & (z > 0.02)
    # weathering: forehead, nose and cheekbones browner and redder for outdoor people
    wz = face * lk["weather"] * (np.exp(-((t - 0.15) / 0.03) ** 2) + np.exp(-((ax - 0.04) / 0.02) ** 2 - ((t - 0.098) / 0.02) ** 2))
    mul(wz * 0.25, (0.92, 0.82, 0.74))
    # the flush: cheeks, nose, ears, chin
    flush = np.array((0.80, 0.42, 0.38), np.float32)
    rud = 0.4 + lk["ruddy"]
    cheek = face * np.exp(-(((ax - 0.040) / 0.017) ** 2 + ((t - 0.086) / 0.017) ** 2))
    mul(cheek * 0.22 * rud, flush / np.maximum(base, 0.2))
    nose = face * np.clip(1 - g["nose"] / 0.004, 0, 1) * np.exp(-((t - 0.082) / 0.016) ** 2)
    mul(nose * 0.18 * rud, flush / np.maximum(base, 0.2))
    chin = face * np.exp(-((ax / 0.016) ** 2 + ((t - 0.017) / 0.012) ** 2))
    mul(chin * 0.12 * rud, flush / np.maximum(base, 0.2))
    ears = (region == 1) | (region == 2)
    mul(ears * 0.25 * rud, flush / np.maximum(base, 0.2))
    # the drinker: a red, veined nose and blotched cheeks
    if lk["drinker"] > 0:
        dk = lk["drinker"]
        veins = np.clip(np.abs(_noise3(P * np.array((1, 1, 1)), 420.0, seed + 9)) < 0.06, 0, 1)
        mul(nose * (0.55 + 0.25 * veins) * dk, (0.95, 0.55, 0.55))
        mul(cheek * (0.3 + 0.35 * veins) * dk, (0.95, 0.62, 0.60))
    # under the eyes a little blue-grey, more with age
    for s in (1, -1):
        e = np.array((s * q["eye"][0], q["eye"][1], q["eye"][2]))
        az, el, r = hd.eye_angles(P.reshape(-1, 3), e, s)
        az, el, r = az.reshape(x.shape), el.reshape(x.shape), r.reshape(x.shape)
        a0, a1 = math.radians(q["az_in"]), math.radians(q["az_out"])
        sv = (az - (a0 + a1) / 2) / ((a1 - a0) / 2)
        up, lo = hd.lid_curves(q, sv)
        near = face & (r < q["eye_r"] + 0.012) & (np.abs(sv) < 1.3)
        under = near * np.clip(1 - np.abs(el - (lo - 0.45)) / 0.35, 0, 1) * (el < lo)
        mul(under * (0.10 + 0.18 * agef), (0.82, 0.78, 0.84))
        # the lids: a little pinker and darker; the upper lid's margin dark with the lashes, the lower lighter
        lid = near * (np.abs(sv) < 1.1) * ((el > up) & (el < up + 0.55) | (el < lo) & (el > lo - 0.25))
        mul(lid * 0.18, (0.90, 0.78, 0.76))
        lash = near * np.clip(1 - (el - up) / 0.13, 0, 1) * (el >= up - 0.05) * np.clip((1.05 - np.abs(sv)) / 0.15, 0, 1)
        lash_out = lash * np.clip((sv + 0.3) / 0.8, 0.5, 1.0)  # heavier toward the outer corner
        mix(lash_out * (0.85 if female else 0.7), np.array(lk["hair_rgb"]) * 0.45 + 0.03)
        lowl = near * np.clip(1 - (lo - el) / 0.07, 0, 1) * (el <= lo + 0.03) * (np.abs(sv) < 0.95)
        mix(lowl * 0.35, (0.36, 0.25, 0.22))
        crease = near * _groove(el - (up + 0.42 + 0.06 * agef), 0.06) * (np.abs(sv) < 0.9)
        mul(crease * 0.25, (0.80, 0.68, 0.64))
        h -= crease * 0.00025
        caru = near * np.exp(-(((sv + 1.0) / 0.12) ** 2 + ((el - 0.0) / 0.12) ** 2))
        mix(caru * 0.6, (0.78, 0.48, 0.46))
        # what shows through the opening (the far copy has closed lids there): a dark eye
        inside = on & (r < q["eye_r"] + 0.0009)
        mix(inside * 1.0, (0.32, 0.27, 0.24))
        mix(inside * (np.abs(sv) < 0.35), np.array(IRIS[lk["iris"]]) * 0.7)
        # crow's feet (age)
        if agef > 0:
            oc = hd.margin_point(q, e, s, np.array([0.5]), q["eye_r"] + 0.002)[0]
            dxy = P - oc
            dd = np.sqrt((dxy ** 2).sum(-1))
            ang = np.arctan2(dxy[..., 1], s * dxy[..., 0] + 0.6 * dxy[..., 2])
            rays = np.cos(ang * 9 + _noise3(P, 90.0, seed + 11) * 2) ** 8
            cf = face * rays * _sm(0.003, 0.006, dd) * (1 - _sm(0.010, 0.019, dd)) * (s * x > ax * 0.5)
            h -= cf * 0.00022 * agef
            mul(cf * 0.18 * agef, (0.85, 0.75, 0.72))
    # brows: hair strokes along the brow line
    bt = 0.1295 + 0.0045 * np.exp(-((ax - 0.030) / 0.013) ** 2) - 0.007 * _sm(0.034, 0.056, ax)
    if female:
        bt = bt + 0.002 * np.exp(-((ax - 0.032) / 0.01) ** 2)
    thick = (0.0042 - 0.0026 * _sm(0.012, 0.052, ax)) * lk["brow"] * (0.85 if female else 1.0) * (0.75 if child else 1.0)
    bmask = face & (ax > 0.008) & (ax < 0.055) & (z > 0.06)
    bm = bmask * np.clip(1 - np.abs(t - bt) / np.maximum(thick, 1e-4), 0, 1) ** 0.7
    strokes = 0.78 + 0.22 * _noise3(np.stack([x * 30, t * 400, z * 30], -1), 6.0, seed + 12)
    bm = bm * _sm(0.0, 0.25, bm)
    brow_rgb = np.array(lk["hair_rgb"]) * 0.75
    if lk["hair"] in ("grey", "white"):
        brow_rgb = np.array(HAIR["grey"]) * 0.8
    mix(bm * np.clip(strokes, 0, 1) * 0.92, brow_rgb)
    h += bm * 0.00012
    # the lips: the red of the lips and the line between them
    lipm = face * np.clip(1 - g["lips"] / 0.0011, 0, 1) * (z > q["mouth_z"] - q["arch_k"] * x * x - 0.006)
    lip_rgb = (np.array((0.66, 0.38, 0.35)) if not female else np.array((0.72, 0.40, 0.38))) * (0.9 + 0.1 * lk["lip"])
    lip_rgb = lip_rgb * (1 - 0.25 * agef) + base * 0.25 * agef
    mix(lipm * (0.55 + 0.15 * lk["lip"]) * (0.75 if not female else 0.9), lip_rgb)
    lipl = lipm * np.cos(x * 1400 + _noise3(P, 200.0, seed) * 3) ** 6
    h -= lipl * 0.00006
    slit = face * (np.abs(t - q["mouth_t"]) < 0.0011) * (ax < q["mouth_w"])
    mix(slit * 0.8, (0.22, 0.10, 0.09))
    # wrinkles by age
    if agef > 0:
        for k, tl in enumerate((0.146, 0.154, 0.162, 0.170)):
            wav = tl + 0.0015 * _noise3(P, 30.0, seed + 20 + k)
            fl = face * _groove(t - wav, 0.0007) * (ax < 0.045 - 0.004 * k) * (z > 0.06)
            h -= fl * 0.00030 * agef * (1 - 0.15 * k)
            mul(fl * 0.20 * agef, (0.86, 0.78, 0.74))
        gl = face * _groove(ax - 0.0065, 0.0008) * (t > 0.122) * (t < 0.137)
        h -= gl * 0.0003 * agef
    for s in (1, -1):
        # the fold from the wing of the nose to the corner of the mouth (everyone a little, the old deeply)
        al = q["ala"]
        dd, hh = _seg_dist(s * x, t, al[0] + 0.006, al[1] + 0.002, q["mouth_w"] + 0.007, q["mouth_t"] - 0.008)
        nl = face * _groove(dd, 0.0011 + 0.0008 * agef) * (z > 0.07)
        h -= nl * (0.00012 + 0.0005 * agef)
        mul(nl * (0.12 + 0.2 * agef), (0.82, 0.70, 0.66))
        if agef > 0.3:
            dd, _ = _seg_dist(s * x, t, q["mouth_w"] + 0.003, q["mouth_t"] - 0.004, q["mouth_w"] + 0.008, q["mouth_t"] - 0.030)
            ml = face * _groove(dd, 0.0012) * (z > 0.06)
            h -= ml * 0.0003 * (agef - 0.3)
    if agef > 0.2:
        neck = on & (t < 0.0) & (t > -0.06)
        nk = neck * (np.cos(t * 900 + _noise3(P, 40.0, seed + 30) * 2) ** 12)
        h -= nk * 0.0002 * agef
    # pox scars: shallow pits on the cheeks, nose and forehead
    if lk["pox"] > 0:
        npits = int(140 * lk["pox"])
        pts = []
        while len(pts) < npits:
            c = np.array((rng.uniform(-0.06, 0.06), rng.uniform(0.06, 0.17), rng.uniform(0.06, 0.13)))
            pts.append(c)
        sel = face
        for c in pts:
            r0 = rng.uniform(0.0008, 0.0022)
            dd = np.sqrt(((P - c) ** 2).sum(-1))
            # only pits that land on the surface (the point's depth is free: test the distance in x, t)
            dxy = np.hypot(x - c[0], t - c[1])
            pit = sel & (dxy < r0) & (z > 0.06)
            hh = np.clip(1 - (dxy / r0) ** 2, 0, 1) * pit
            h -= hh * 0.00025
            mul(hh * 0.12, (1.06, 1.0, 0.98))
    if lk["freckles"] > 0:
        fr = face * (np.clip(_noise3(P, 520.0, seed + 40), 0, 1) > 0.55) * np.exp(-((t - 0.09) / 0.03) ** 2)
        mul(fr * 0.25 * lk["freckles"], (0.85, 0.72, 0.62))
    # stubble and painted beards (the beard meshes in hair.py show these colours)
    hair_rgb = np.array(lk["hair_rgb"], np.float32)
    phi = np.degrees(np.arctan2(x, z - hd.SPH_C[2]))
    # the beard's zone, soft-edged: below a line from the sideburn to beside the nose, the upper lip, under the jaw
    cheek_top = 0.090 - 0.018 * _sm(0.050, 0.024, ax)
    zone = on * ~ears * _sm(0.006, -0.006, t - cheek_top) * _sm(84, 72, np.abs(phi)) * _sm(-0.03, -0.005, z)
    above = 0.6 * on * _sm(0.003, 0.0, np.abs(t - (q["mouth_t"] + 0.010)) - 0.005) * _sm(0.004, 0.0, ax - q["mouth_w"] - 0.002)
    stub_soft = np.maximum(zone, above * (z > 0.08)) * (1 - np.clip(lipm * 2, 0, 1)) * _sm(-0.045, -0.015, t)
    stub_soft *= 0.75 + 0.25 * _noise3(P, 60.0, seed + 51)
    if lk["stubble"] > 0:
        dots = np.clip((_noise3(P, 1400.0, seed + 50) - 0.15) / 0.3, 0, 1)
        sc = (hair_rgb * 0.6 + np.array((0.25, 0.25, 0.28)) * 0.4)
        mix(stub_soft * lk["stubble"] * (0.08 + 0.16 * dots), sc)
        h += stub_soft * dots * 0.00003 * lk["stubble"]
    fh = facial_hair_mask(lk, P, q, region, lipm)
    if fh is not None:
        strands = 0.72 + 0.28 * _noise3(np.stack([x * 900, t * 120, z * 900], -1), 1.0, seed + 60)
        mix(fh * 0.95, hair_rgb * strands[..., None])
        h += fh * 0.00015 * strands
    # the scalp: hair of the hair style, combed back, the hairline soft
    th = hairline_t(lk, phi)
    hairm = on & ~ears & ((t - th) > 0)
    soft = np.clip((t - th) / 0.005, 0, 1) * on * ~ears
    if lk.get("hairline") == "bald":
        crown = np.exp(-((x / 0.05) ** 2 + ((z - 0.0) / 0.075) ** 2)) * (t > 0.16)
        soft = soft * np.clip(1 - crown * 1.3, 0, 1)
    if lk["sex"] == "m" and not child:
        # short sideburns in front of the ears
        sb = on * ~ears * _sm(8.0, 2.0, np.abs(np.abs(phi) - 79)) * _sm(0.100, 0.130, t)
        sb *= np.clip(0.5 + 0.5 * _noise3(P, 220.0, seed + 71), 0, 1)
        soft = np.maximum(soft, sb * 0.5)
    # strands: noise stretched along the way the hair is combed (back over the top, down at the sides and back)
    top = _sm(0.12, 0.18, t)[..., None]
    cdir = top * np.array((0.0, -0.25, -1.0)) + (1 - top) * np.array((0.0, -1.0, -0.35))
    cdir /= np.linalg.norm(cdir, axis=-1, keepdims=True)
    along = (P * cdir).sum(-1, keepdims=True)
    comb = (P - along * cdir) * 900.0 + along * cdir * 40.0
    strands = 0.74 + 0.26 * _noise3(comb, 1.0, seed + 70)
    if lk["hairline"] == "parted" or lk["sex"] == "f":
        part_ = np.exp(-(x / 0.0018) ** 2) * (z > -0.03) * (t > 0.17)
        soft = soft * (1 - 0.7 * part_)
    if lk["hairline"] == "side":
        part_ = np.exp(-((x - 0.028) / 0.0016) ** 2) * (z > -0.04) * (t > 0.17)
        soft = soft * (1 - 0.75 * part_)
    mix(soft * 0.97, hair_rgb[None, None, :] * strands[..., None])
    h += soft * 0.00008 * strands
    # soot and grime (coalmen, stokers, dockers)
    if lk["soot"] > 0:
        sm = on * np.clip(0.3 + 0.7 * (1 - ao) + 0.4 * _noise3(P, 25.0, seed + 80), 0, 1)
        mul(sm * 0.45 * lk["soot"], (0.55, 0.52, 0.50))
    # the shade of the folds (sockets, nostrils, ears, under the jaw)
    img *= (0.68 + 0.32 * np.clip(ao, 0, 1))[..., None] ** 0.8
    # the ear backs, the eyeball, the dark of the mouth
    back_ear = region == 2
    img[back_ear] = (base * 0.88)[None, :]
    img = _paint_eye(img, g, lk)
    img[region == 5] = (0.16, 0.07, 0.07)
    img, h = _paint_swatches(img, h, g, lk)
    # the right ear shares the left ear's charts: nothing to do. Gaps between the charts: skin.
    img[region < 0] = base
    img = np.clip(img, 0, 1)
    nrm = normal_map(h, g)
    return img, h, nrm


def facial_hair_mask(lk, P, q, region, lipm):
    """Where a beard or moustache style is painted (matches hair.py's beard meshes)."""
    beard, mous = lk.get("beard"), lk.get("moustache")
    if not beard and not mous:
        return None
    x, t, z = P[..., 0], P[..., 1], P[..., 2]
    ax = np.abs(x)
    on = (region == 0) & (z > -0.02)
    phi = np.degrees(np.arctan2(x, z - hd.SPH_C[2]))
    m = np.zeros(x.shape)
    if beard in ("full", "short", "chops", "sideburns", "chin"):
        th, _ = hr.beard_thickness(beard, P.reshape(-1, 3), q)
        # dense where the beard is thick, thinning out with the grain of the hair toward its edge
        edge = np.clip(th.reshape(x.shape) / 0.0035, 0, 1)
        grain = 0.5 + 0.5 * _noise3(np.stack([x * 300, t * 60, z * 300], -1), 1.0, 77)
        m = np.maximum(m, np.clip(edge * 1.6 - 0.6 * (1 - edge) * grain, 0, 1) * on)
    elif beard == "imperial":
        side = on & (np.abs(np.abs(phi) - 76) < 7) & (t < 0.142) & (t > 0.05)
        jaw = on & (t < 0.098 - 0.25 * np.clip(0.045 - ax, 0, 0.045)) & (np.abs(phi) < 82) & (t > -0.03)
        chinr = on & (ax < 0.022) & (t < q["mouth_t"] - 0.006) & (t > -0.025)
        if beard in ("full", "short"):
            m = np.maximum(m, (side | jaw).astype(float))
        elif beard == "chops":
            m = np.maximum(m, (side | (jaw & (ax > 0.024))).astype(float))
        elif beard == "sideburns":
            m = np.maximum(m, (side & (t > 0.08)).astype(float))
        elif beard == "chin":
            m = np.maximum(m, (chinr | (jaw & (t < 0.03))).astype(float))
        elif beard == "imperial":
            m = np.maximum(m, (on & (ax < 0.009) & (t < q["mouth_t"] - 0.005) & (t > 0.012)).astype(float))
    if mous or beard in ("full", "short", "chops"):
        mm = on & (t > q["mouth_t"] + 0.002) & (t < q["mouth_t"] + 0.017) & (ax < q["mouth_w"] + 0.006) & (z > 0.08)
        m = np.maximum(m, mm.astype(float))
    m = m * (lipm < 0.4)
    return m


def _paint_swatches(img, h, g, lk):
    """The hair swatch (strands along the picture's height) and the plait swatch (a weave of three strands) that
    hair.py's buns, plaits and moustaches use."""
    A, Bm, region = g["A"], g["B"], g["region"]
    hair_rgb = np.array(lk["hair_rgb"], np.float32)
    seed = lk["seed"]
    pts = np.stack([A * 40.0, Bm * 2.0, np.zeros_like(A)], -1)
    st = 0.68 + 0.32 * _noise3(pts, 9.0, seed + 90)
    m = region == 7
    img[m] = (hair_rgb[None, :] * st[m][:, None])
    h[m] = 0.00012 * st[m]
    s0, s1, t0, t1 = hr.SWATCH_BRAID
    u = (A - s0) / (s1 - s0)
    v = (Bm - t0) / (t1 - t0)
    weave = np.abs(((v * 6 + np.abs(u - 0.5) * 2.2) % 1.0) - 0.5) * 2
    m = region == 8
    shade = 0.55 + 0.45 * (1 - weave) * (0.8 + 0.2 * st)
    img[m] = hair_rgb[None, :] * shade[m][:, None]
    h[m] = 0.0004 * (1 - weave[m])
    return img, h


def _paint_eye(img, g, lk):
    """The eyeball's chart: a dim white, the iris with its darker ring and rays, the pupil, a darker top (the lid's
    shade)."""
    A, Bm, region = g["A"], g["B"], g["region"]
    a0, a1 = hd.EYE_A
    hx = (a1 - a0) / 2 * 0.98
    cx = (A - (a0 + a1) / 2) / hx
    cy = (Bm - 0.1) / 0.088
    r = np.sqrt(cx * cx + cy * cy)
    m = region == 6
    sclera = np.array((0.58, 0.55, 0.51), np.float32)
    col = np.ones(img.shape, np.float32) * sclera
    col *= (1 - 0.22 * np.clip((r - 0.55) / 0.45, 0, 1))[..., None]
    col *= (1 - 0.35 * np.clip((cy - 0.15) / 0.6, 0, 1))[..., None]  # the upper lid's shade
    iris = np.array(IRIS[lk["iris"]], np.float32)
    ang = np.arctan2(cy, cx)
    rays = 0.85 + 0.15 * np.cos(ang * 23 + 3 * np.sin(ang * 5 + lk["seed"]))
    ir = (r < 0.5)[..., None]
    icol = iris * rays[..., None] * (0.85 + 0.3 * np.clip((r - 0.2) / 0.3, 0, 1))[..., None]
    icol = np.where((r > 0.43)[..., None], icol * 0.55, icol)
    col = np.where(ir, icol, col)
    col = np.where((r < 0.2)[..., None], np.array((0.04, 0.035, 0.035), np.float32), col)
    img[m] = col[m]
    return img


def normal_map(h, g, strength=1.0):
    """Tangent-space normals from a height field (metres), slopes measured on the head (OpenGL: green up)."""
    dhu = np.gradient(h, axis=1) / g["du"]
    dhv = np.gradient(h, axis=0) / g["dv"]
    n = np.stack([-dhu * strength, -dhv * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def insert(pic, rect, size_total):
    """Put a head square (rows up, as the painter makes it) into a body picture (rows up, A's paint layout)."""
    u0, v0, u1, v1 = hd.HEAD_RECT
    x0, y0 = int(round(u0 * size_total)), int(round(v0 * size_total))
    x1, y1 = int(round(u1 * size_total)), int(round(v1 * size_total))
    s = rect
    if s.shape[0] != y1 - y0:
        k = (y1 - y0) / s.shape[0]
        idx = (np.arange(y1 - y0) / k).astype(int)
        s = s[idx][:, idx]
    pic[y0:y1, x0:x1] = s
    return pic

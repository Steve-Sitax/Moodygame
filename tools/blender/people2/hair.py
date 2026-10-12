"""Hair, beards and moustaches as shaped meshes (docs/people.md "Hair").

Two kinds of piece, both in the head frame of head.py and carried to every body and every face shape:
- shells: the head's own triangles under the hair (the scalp for a hair style, the jaw and cheeks for a beard),
  pushed out along the head's normals by a thickness that grows from the hairline; their rims are sunk a millimetre
  into the skin (no z-fighting). They take the scalp's and the beard zone's paint (face_paint paints hair there), so
  shell and skin meet without a line. A shell vertex moves with its head vertex: bodies, face shapes and the jaw.
- tubes: buns, plaits pinned up, a coronet of plaits, moustaches, an imperial tuft; swept along paths made from the
  head's landmarks, bound to the nearest head vertices; their UVs run over the strand swatch (or the plait swatch)
  in a corner of the head's square.

Styles of 1873: men short-cropped, a side parting, bald with a fringe, long to the collar; women's hair parted in the
middle and drawn back to a bun, plaits pinned up behind, a coronet of plaits, flat under a cap. Beards: full, short,
mutton chops (whiskers joined to the moustache, the chin shaved), sideburns, a chin curtain, Napoleon III's imperial;
moustaches: walrus, handlebar (waxed tips), chevron.

cards(): alpha-tested hair cards over a shell, for the named cast's near copy only (a second material).
"""

import math

import numpy as np

from . import head as hd
from . import sdf

MEN = ["crop", "side", "bald", "long"]
WOMEN = ["bun", "plaits", "coronet", "undercap"]
BEARDS = ["full", "short", "chops", "sideburns", "chin", "imperial"]
MOUSTACHES = ["walrus", "handlebar", "chevron"]
SWATCH = (0.89, 0.995, 0.012, 0.093)  # a0, a1, b0, b1 in the head's square: strands along b
SWATCH_BRAID = (0.89, 0.995, 0.107, 0.188)  # a plait's weave along b


# ---------------------------------------------------------------- choosing

def style_for(seed, lk, P):
    """A hair style (and the paint that goes with it) for a person: seeded, by sex and age."""
    rng = np.random.default_rng((int(seed) * 7919) & 0xFFFFFFFF)
    female = lk["sex"] == "f"
    age = lk["age"]
    st = dict(hair=None, beard=None, moustache=None)
    if female:
        st["hair"] = str(rng.choice(WOMEN, p=[0.4, 0.25, 0.15, 0.2])) if age >= 14 else "plaits"
        # the curled fringe young women took up in the 1870s
        st["fringe"] = bool(age < 40 and st["hair"] != "undercap" and rng.random() < 0.35)
    else:
        if age < 15:
            st["hair"] = "crop"
        else:
            st["hair"] = "bald" if lk.get("hairline") == "bald" else str(rng.choice(["crop", "crop", "side", "side", "long"]))
            r = rng.random()
            if age > 18 and r < 0.62:
                b = rng.choice([None, "full", "short", "chops", "sideburns", "chin", "imperial"],
                               p=[0.22, 0.18, 0.16, 0.16, 0.1, 0.08, 0.1])
                st["beard"] = None if b is None else str(b)
                if st["beard"] in ("full", "short", "chops", "imperial") or (st["beard"] is None and rng.random() < 0.8):
                    st["moustache"] = str(rng.choice(MOUSTACHES, p=[0.35, 0.25, 0.4]))
    hl = {"crop": "crop", "side": "side", "bald": "bald", "long": "crop"}.get(st["hair"], "parted")
    if st.get("fringe"):
        hl = "fringe"
    st["paint"] = dict(hairline=hl, beard=st["beard"], moustache=st["moustache"])
    return st


def base_style(P):
    """The base bodies' own hair (people2.glb)."""
    if P["female"]:
        return dict(hair="bun", beard=None, moustache=None)
    if P["old"]:
        return dict(hair="bald", beard=None, moustache=None)
    return dict(hair="crop", beard=None, moustache=None)


# ---------------------------------------------------------------- where hair grows

def hairline_t(sex, style, phi_deg):
    """The hairline's height (head frame t) round the head, by azimuth from head.SPH_C (0 the front)."""
    ph = np.abs(phi_deg)
    if sex == "f":
        ht = np.interp(ph, [0, 30, 55, 75, 95, 120, 150, 180], [0.171, 0.168, 0.148, 0.124, 0.112, 0.090, 0.070, 0.060])
        if style == "fringe":
            ht = ht - 0.020 * np.clip(1 - ph / 38, 0, 1) ** 0.7
        return ht
    pts = [0, 25, 40, 58, 72, 80, 100, 130, 180]
    hts = [0.177, 0.175, 0.167, 0.150, 0.142, 0.137, 0.120, 0.085, 0.056]
    if style == "recede":
        hts = [0.186, 0.190, 0.192, 0.160, 0.145, 0.138, 0.120, 0.085, 0.056]
    if style == "bald":
        hts = [0.30, 0.30, 0.30, 0.165, 0.150, 0.140, 0.122, 0.088, 0.058]
    return np.interp(ph, pts, hts)


def _sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _phi(V):
    return np.degrees(np.arctan2(V[:, 0], V[:, 2] - hd.SPH_C[2]))


def scalp_thickness(style, V, sex, fringe=False):
    """How thick a hair style stands off the scalp at head points V (head frame)."""
    x, t, z = V[:, 0], V[:, 1], V[:, 2]
    phi = _phi(V)
    hl = hairline_t("f" if style in WOMEN else "m", "bald" if style == "bald" else ("fringe" if fringe else "crop"), phi)
    if style == "long":
        hl = np.where(np.abs(phi) > 95, hl - 0.05 * _sm(95, 150, np.abs(phi)), hl)
    grow = _sm(0.0, 0.012, t - hl)
    top = _sm(0.13, 0.20, t)
    if style == "crop":
        th = 0.0035 + 0.0035 * top
    elif style == "side":
        th = 0.0045 + 0.0085 * top + 0.003 * top * _sm(0.02, -0.04, x)
        th *= 1 - 0.65 * np.exp(-((x - 0.028) / 0.0045) ** 2) * _sm(0.16, 0.18, t) * (z > -0.05)
    elif style == "long":
        th = 0.005 + 0.006 * top + 0.010 * _sm(0.09, 0.0, t) * _sm(100, 150, np.abs(phi))
    elif style == "bald":
        th = 0.003 * _sm(0.170, 0.155, t) + 0.0 * x
    elif style in ("bun", "plaits", "coronet"):
        # parted in the middle, smooth on top, full over the temples and the tops of the ears
        sides = np.exp(-((np.abs(phi) - 80) / 28) ** 2) * _sm(0.09, 0.12, t) * _sm(0.19, 0.16, t)
        th = 0.004 + 0.003 * top + 0.012 * sides
        th *= 1 - 0.5 * np.exp(-(x / 0.0035) ** 2) * _sm(0.17, 0.19, t) * (z > -0.04)
    elif style == "undercap":
        th = 0.0025 + 0.0015 * top
    if fringe and style in WOMEN:
        th = th + 0.0025 * np.clip(1 - np.abs(phi) / 40, 0, 1) * _sm(0.20, 0.17, t) * (z > 0.04)
    else:
        th = np.zeros_like(t)
    return th * grow


def beard_thickness(beard, V, q):
    """How thick a beard stands off the face at head points V (head frame); and how far it hangs down."""
    x, t, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    phi = np.abs(_phi(V))
    n = len(V)
    th, hang = np.zeros(n), np.zeros(n)
    if not beard:
        return th, hang
    mt, mw = q["mouth_t"], q["mouth_w"]
    cheek_top = 0.090 - 0.018 * _sm(0.050, 0.024, ax)
    face = _sm(86, 76, phi) * _sm(-0.025, -0.005, z)
    jaw = face * _sm(0.004, -0.006, t - cheek_top) * _sm(-0.045, -0.02, t)
    lips = np.exp(-((ax / (mw + 0.004)) ** 8) - ((t - mt) / 0.0085) ** 8)
    chinr = _sm(0.03, 0.018, ax) * _sm(mt - 0.004, mt - 0.012, t) * _sm(-0.04, -0.015, t)
    side = _sm(18, 6, np.abs(phi - 74)) * _sm(0.06, 0.08, t) * _sm(0.15, 0.128, t)
    if beard == "full":
        th = 0.004 + 0.010 * _sm(0.06, 0.0, t)
        th = th * np.maximum(jaw, side) * (1 - lips)
        hang = 0.018 * chinr + 0.006 * jaw * _sm(0.03, -0.01, t)
    elif beard == "short":
        th = 0.004 * np.maximum(jaw, side) * (1 - lips)
    elif beard == "chops":
        th = (0.005 + 0.004 * _sm(0.10, 0.04, t)) * np.maximum(jaw * _sm(0.020, 0.032, ax), side)
    elif beard == "sideburns":
        th = 0.0035 * side * _sm(0.075, 0.09, t)
    elif beard == "chin":
        th = 0.007 * jaw * _sm(0.035, 0.012, t) * (1 - lips)
        hang = 0.010 * chinr
    elif beard == "imperial":
        th = np.zeros(n)
    return th, hang


# ---------------------------------------------------------------- meshes

def _tube(path, radii, segs=8, lobes=0, lobe_k=0.0):
    """A tube along a path (closed at both ends): verts, triangles, and per-vertex (u along, v around)."""
    path = np.asarray(path, float)
    n = len(path)
    tang = np.gradient(path, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    ref = np.array((0.0, 1.0, 0.0)) if abs(tang[0][1]) < 0.9 else np.array((1.0, 0.0, 0.0))
    nrm = np.cross(tang[0], ref)
    nrm /= np.linalg.norm(nrm)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    V, UV = [], []
    for i in range(n):
        if i > 0:
            nrm = nrm - tang[i] * (nrm @ tang[i])
            nrm /= np.linalg.norm(nrm)
        bi = np.cross(tang[i], nrm)
        for k in range(segs):
            a = 2 * math.pi * k / segs
            r = radii[i]
            if lobes:
                r *= 1.0 + 0.17 * math.cos(lobes * a + lobe_k * L[i])
            V.append(path[i] + (nrm * math.cos(a) + bi * math.sin(a)) * r)
            UV.append((L[i] / max(L[-1], 1e-6), k / segs))
    T = []
    for i in range(n - 1):
        for k in range(segs):
            a, b = i * segs + k, i * segs + (k + 1) % segs
            c, d = a + segs, b + segs
            T += [(a, c, d), (a, d, b)]
    s0 = len(V)
    V.append(path[0] - tang[0] * radii[0] * 0.5)
    UV.append((0.0, 0.0))
    s1 = len(V)
    V.append(path[-1] + tang[-1] * radii[-1] * 0.5)
    UV.append((1.0, 0.0))
    for k in range(segs):
        T.append((s0, (k + 1) % segs, k))
        T.append((s1, (n - 1) * segs + k, (n - 1) * segs + (k + 1) % segs))
    return np.array(V), np.array(T), np.array(UV), L[-1]


def _surface(q, P, steps=6):
    """Points pulled onto the head's surface."""
    return sdf.project(lambda p: hd.head_sdf(p, q), np.asarray(P, float), steps=steps)


def _out(q, P):
    return sdf.normals(lambda p: hd.head_sdf(p, q), np.asarray(P, float))


def tubes(style, q, lod=0):
    """The swept pieces of a style in the reference head frame: list of (verts, tris, uv per vertex (a, b) in the
    head's square)."""
    out = []
    segs = 8 if lod == 0 else 5
    hair, beard, mous = style.get("hair"), style.get("beard"), style.get("moustache")

    def swatch(UV, Lm, braid=False, rep=0.03):
        a0, a1, b0, b1 = SWATCH_BRAID if braid else SWATCH
        u = UV[:, 0] * Lm / rep
        tri = np.abs((u % 2.0) - 1.0)
        return np.stack([a0 + (a1 - a0) * np.abs((UV[:, 1] * 2) % 2 - 1), b0 + (b1 - b0) * tri], -1)

    if hair in ("bun", "undercap"):
        big = hair == "bun"
        o = _surface(q, [(0.0, 0.118 if big else 0.080, -0.105)])[0]
        n = _out(q, [o])[0]
        o = o + n * (0.010 if big else 0.006)
        e1 = np.cross(n, (1.0, 0.0, 0.0))
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(n, e1)
        steps = 20 if lod == 0 else 9
        R0 = 0.021 if big else 0.012
        path, rad = [], []
        for i in range(steps):
            tt = i / (steps - 1)
            ang = 2 * math.pi * 1.6 * tt
            rr = R0 * (1 - 0.62 * tt)
            path.append(o + rr * (math.cos(ang) * e1 + math.sin(ang) * e2) + n * 0.004 * tt)
            rad.append((0.0105 if big else 0.0065) * (1 - 0.35 * tt))
        V, T, UV, Lm = _tube(path, rad, 7 if lod == 0 else 5)
        out.append((V, T, swatch(UV, Lm)))
    if hair == "plaits":
        for s in (1, -1):
            pts = [(s * 0.058, 0.108, -0.048), (s * 0.055, 0.080, -0.070), (s * 0.035, 0.062, -0.088),
                   (s * 0.012, 0.070, -0.098), (s * 0.020, 0.100, -0.100), (s * 0.040, 0.122, -0.088)]
            base = _surface(q, pts)
            nn = _out(q, base)
            path = base + nn * 0.008
            path = _resample(path, 22 if lod == 0 else 8)
            V, T, UV, Lm = _tube(path, [0.0075] * len(path), segs, lobes=3 if lod == 0 else 0, lobe_k=420.0)
            out.append((V, T, swatch(UV, Lm, braid=True)))
    if hair == "coronet":
        n_ = 34 if lod == 0 else 12
        pts = []
        for i in range(n_ + 1):
            ph = 2 * math.pi * i / n_
            pts.append((0.058 * math.sin(ph), 0.205 - 0.006 * math.cos(ph), -0.018 + 0.062 * math.cos(ph)))
        base = _surface(q, pts)
        nn = _out(q, base)
        path = base + nn * 0.0105
        V, T, UV, Lm = _tube(path, [0.0085] * len(path), segs, lobes=3 if lod == 0 else 0, lobe_k=420.0)
        out.append((V, T, swatch(UV, Lm, braid=True)))
    if mous:
        mt, mw = q["mouth_t"], q["mouth_w"]
        if mous == "chevron":
            xs = np.linspace(-1.05, 1.05, 11)
            pts = [(x * mw, mt + 0.0085 - 0.003 * x * x, 0) for x in xs]
            rad = [0.0042 * (1 - 0.35 * x * x) for x in xs]
        elif mous == "walrus":
            xs = np.linspace(-1.25, 1.25, 13)
            pts = [(x * mw, mt + 0.0075 - 0.009 * max(0.0, abs(x) - 0.6) ** 1.2, 0) for x in xs]
            rad = [0.0060 * (1 - 0.30 * x * x / 1.56) for x in xs]
        else:  # handlebar: thin, the waxed tips turning up
            xs = np.linspace(-1.55, 1.55, 15)
            pts = [(x * mw, mt + 0.0085 + 0.010 * max(0.0, abs(x) - 1.05) ** 1.5 * 3, 0) for x in xs]
            rad = [0.0034 * (1 - 0.75 * (abs(x) / 1.55) ** 2) + 0.0006 for x in xs]
        base = np.array([(p[0], p[1], 0.16) for p in pts])
        surf = _trace_front(q, base)
        nn = _out(q, surf)
        path = surf + nn * np.array(rad)[:, None] * 0.55
        V, T, UV, Lm = _tube(path, rad, segs)
        out.append((V, T, swatch(UV, Lm, rep=0.02)))
    if beard == "imperial":
        mt = q["mouth_t"]
        pts = [(0.0, mt - 0.009, 0.16), (0.0, mt - 0.020, 0.16), (0.0, mt - 0.030, 0.16)]
        surf = _trace_front(q, np.array(pts))
        nn = _out(q, surf)
        path = surf + nn * np.array([[0.002], [0.004], [0.006]]) + np.array((0, -0.006, 0.002)) * np.array([[0], [0.5], [1]])
        path = _resample(path, 8)
        V, T, UV, Lm = _tube(path, np.linspace(0.0045, 0.0015, len(path)), segs)
        out.append((V, T, swatch(UV, Lm, rep=0.02)))
    return out


def _resample(path, n):
    path = np.asarray(path, float)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    s = np.linspace(0, L[-1], n)
    return np.stack([np.interp(s, L, path[:, i]) for i in range(3)], -1)


def _trace_front(q, P):
    """Points straight in front of the face (z large) brought back along -z onto the face."""
    p = np.asarray(P, float).copy()
    for _ in range(60):
        d = hd.head_sdf(p, q)
        p[:, 2] -= d * 0.8
    return p


def vertex_normals(V, T):
    """The mesh's own smooth normals (area weighted): the field's gradient turns sharply in creases."""
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def _smooth_on(f, T, n):
    """Average a per-vertex field over its mesh neighbours n times (no jumps between neighbours: no spikes)."""
    f = f.copy()
    E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    for _ in range(n):
        acc = np.zeros_like(f)
        cnt = np.zeros_like(f)
        np.add.at(acc, E[:, 0], f[E[:, 1]])
        np.add.at(cnt, E[:, 0], 1.0)
        f = 0.5 * f + 0.5 * acc / np.maximum(cnt, 1)
    return f


def shells(style, q, V, T, N):
    """The shell pieces of a style over a head mesh (V, T; N its normals): list of (head vertex ids, offsets
    (head frame, at the reference), triangles over those ids)."""
    out = []
    hair, beard = style.get("hair"), style.get("beard")
    sex = "f" if hair in WOMEN else "m"
    th = scalp_thickness(hair, V, sex, style.get("fringe", False)) if hair else np.zeros(len(V))
    bt, hang = beard_thickness(beard, V, q)
    for thick, hg, whole in ((th, None, False), (bt, hang, False)):
        if thick.max() <= 1e-4:
            continue
        thick = _smooth_on(thick, T, 3)
        if hg is not None:
            hg = _smooth_on(hg, T, 3)
        # the triangles under the hair; the rim's vertices lie just on the skin (0.3 mm), so the shell slopes gently
        # onto it (a rim dipping into the skin shades like a flap of skin). Beards (on the face's fine triangles)
        # keep only whole triangles, inside their painted zone
        sel = (thick[T] > 2e-4).all(1) if whole else (thick[T] > (2e-4 if hg is None else 1.2e-3)).any(1)
        tris = T[sel]
        if not len(tris):
            continue
        used = np.unique(tris)
        remap = -np.ones(len(V), np.int64)
        remap[used] = np.arange(len(used))
        tk = thick[used]
        off = N[used] * (tk + 0.0003)[:, None]
        if hg is not None:
            off = off + np.stack([np.zeros(len(used)), -hg[used], 0.35 * hg[used]], -1)
        out.append((used, off, remap[tris]))
    return out


# ---------------------------------------------------------------- onto a body

def build(style, P, lod):
    """A style's hair on body P: dict(V rest game space, Vs stooped, T, uv per corner, weights per vertex, shapes
    {name: offsets} (near copy)). Empty if the style has no hair pieces."""
    R = hd.reference()
    q0 = R["q"]
    V_ref = R["V0"] if lod == 0 else R["V1"]
    T_ref = R["T0"] if lod == 0 else R["T1"]
    H = hd.head_for(P, lod)
    qb = H["q"]
    N_ref = vertex_normals(V_ref, T_ref)
    Vs, Ts, UVs, binds = [], [], [], []
    base = 0
    for used, off, tris in shells(style, q0, V_ref, T_ref, N_ref):
        pr = V_ref[used] + off
        pb = H["Vh"][used] + off  # on the body: its own head vertex, the same offset (head units)
        A, Bb = hd.corner_ab(pr[tris])
        Vs.append(pb)
        Ts.append(tris + base)
        UVs.append(hd.rect_to_uv(A, Bb))
        binds.append(("shell", used))
        base += len(pb)
    for V, T, uvv in tubes(style, q0, lod):
        # bound to the nearest head vertices, moved as they move
        d2 = ((V[:, None, :] - V_ref[None, :, :]) ** 2).sum(-1)
        nn = np.argsort(d2, axis=1)[:, :6]
        w = 1.0 / (np.take_along_axis(d2, nn, 1) + 1e-6)
        w /= w.sum(1, keepdims=True)
        pb = V + (w[..., None] * (H["Vh"][nn] - V_ref[nn])).sum(1)
        Vs.append(pb)
        Ts.append(T + base)
        UVs.append(hd.rect_to_uv(uvv[T][..., 0], uvv[T][..., 1]))
        binds.append(("near", (nn, w)))
        base += len(pb)
    if not Vs:
        return None
    Vh = np.concatenate(Vs)
    W = hd.to_world(Vh, P)
    out = dict(V=W, Vs=hd.stooped(W, P), T=np.concatenate(Ts), uv=np.concatenate(UVs))
    jaw = []
    for kind, bd_ in binds:
        if kind == "shell":
            jaw.append(H["jaw"][bd_])
        else:
            nn, w = bd_
            jaw.append((w * H["jaw"][nn]).sum(1))
    jaw = np.concatenate(jaw)
    out["weights"] = [hd.vertex_weights(P, W[i][1], jaw[i]) for i in range(len(W))]
    if lod == 0:
        shapes = {}
        for name, d in H["shapes"].items():
            parts = []
            for kind, bd_ in binds:
                if kind == "shell":
                    parts.append(d[bd_])
                else:
                    nn, w = bd_
                    parts.append((w[..., None] * d[nn]).sum(1))
            shapes[name] = np.concatenate(parts)
        out["shapes"] = shapes
    return out


def attach(ob, P, lod, style):
    """Join a style's hair into body mesh `ob` (after head.attach): vertices, UVs, weights, shape keys."""
    import bmesh

    from . import B

    Hh = build(style, P, lod)
    if Hh is None:
        return 0
    me = ob.data
    for gname in ("part_hair",):
        if gname not in ob.vertex_groups:
            ob.vertex_groups.new(name=gname)
    gi = {g.name: g.index for g in ob.vertex_groups}
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    dl = bm.verts.layers.deform.verify()
    sk = {lay.name: lay for lay in bm.verts.layers.shape}
    vs = []
    for i, p in enumerate(Hh["Vs"]):
        v = bm.verts.new(B(*p))
        for n, x in Hh["weights"][i].items():
            v[dl][gi[n]] = x
        v[dl][gi["part_hair"]] = 1.0
        for name, lay in sk.items():
            d = Hh.get("shapes", {}).get(name)
            v[lay] = B(*(p + (d[i] if d is not None else 0.0)))
        vs.append(v)
    for ti, tri in enumerate(Hh["T"]):
        try:
            f = bm.faces.new([vs[k] for k in tri])
        except ValueError:
            continue
        f.smooth = True
        for lo, u in zip(f.loops, Hh["uv"][ti]):
            lo[uvl].uv = tuple(u)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return len(Hh["Vs"])


def add_to_clone(b, ao, mo, style, mat):
    """For the check pictures: a style's hair as its own object on a posed copy (the copy's own hair masked off)."""
    import bpy

    from . import B

    if "part_hair" in mo.vertex_groups and "nohair" not in mo.modifiers:
        m = mo.modifiers.new("nohair", "MASK")
        m.vertex_group = "part_hair"
        m.invert_vertex_group = True
        bpy.context.view_layer.objects.active = mo
        while mo.modifiers[0].name != "nohair":
            bpy.ops.object.modifier_move_up(modifier="nohair")
    Hh = build(style, b["P"], 0)
    if Hh is None:
        return []
    me = bpy.data.meshes.new("hair_clone")
    V = np.array([B(*p)[:] for p in Hh["Vs"]])
    me.from_pydata(V.tolist(), [], Hh["T"].tolist())
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    uv = Hh["uv"].reshape(-1, 2)
    uvl.data.foreach_set("uv", uv.ravel())
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("hair_clone", me)
    ob["p2_stage"] = 1
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    groups = {}
    for i, wd in enumerate(Hh["weights"]):
        for n, x in wd.items():
            if n not in groups:
                groups[n] = ob.vertex_groups.new(name=n)
            groups[n].add([i], x, "REPLACE")
    ob.shape_key_add(name="Basis", from_mix=False)
    for name, d in Hh["shapes"].items():
        k = ob.shape_key_add(name=name, from_mix=False)
        k.data.foreach_set("co", (V + np.array([B(*x)[:] for x in d])).ravel())
    ob.parent = ao
    m = ob.modifiers.new("rig", "ARMATURE")
    m.object = ao
    return [ob]


# ---------------------------------------------------------------- hair cards (the named cast's near copy only)

CARD_TEX = 256


def card_picture(rgb, seed=5):
    """The cards' picture: strands with alpha, tapering to the tips (RGBA, rows up)."""
    from .paint import _noise3

    n = CARD_TEX
    u, v = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n)
    st = _noise3(np.stack([u * 60, v * 3, np.zeros_like(u)], -1), 1.0, seed)
    a = np.clip((st + 0.25) * 2.2, 0, 1) * np.clip((1 - v) / 0.25, 0, 1) * np.clip(np.minimum(u, 1 - u) / 0.12, 0, 1)
    img = np.ones((n, n, 4), np.float32)
    img[..., :3] = np.array(rgb, np.float32) * (0.7 + 0.3 * (st[..., None] * 0.5 + 0.5))
    img[..., 3] = a
    return img


def cards(style, P, n=140, seed=3):
    """Hair cards over a style's scalp shell: strips 1.2 cm wide combed back and down, lifted off the shell, each
    three quads long. Returns dict(V rest game space, Vs stooped, T, uv per corner, weights) or None."""
    R = hd.reference()
    q0 = R["q"]
    V_ref, T_ref = R["V0"], R["T0"]
    N_ref = vertex_normals(V_ref, T_ref)
    sh = [s for s in shells(dict(hair=style.get("hair")), q0, V_ref, T_ref, N_ref)]
    if not sh:
        return None
    used, off, _ = sh[0]
    roots_all = V_ref[used] + off
    th = np.linalg.norm(off, axis=1)
    cand = np.nonzero(th > 0.002)[0]
    if len(cand) == 0:
        return None
    rng = np.random.default_rng(seed)
    pick = rng.choice(cand, size=min(n, len(cand)), replace=False)
    H = hd.head_for(P, 0)
    Vs, T, UV = [], [], []
    for k, i in enumerate(pick):
        p = roots_all[i] + N_ref[used[i]] * 0.0015
        nrm = N_ref[used[i]]
        comb = np.array((0.5 * np.sign(p[0]) * (abs(p[0]) > 0.02), -0.35, -1.0))
        d = comb - nrm * (comb @ nrm)
        d /= np.linalg.norm(d)
        side = np.cross(nrm, d)
        L = rng.uniform(0.022, 0.036)
        wdt = 0.0055
        base = len(Vs)
        lift = th[i] + 0.0012
        for j in range(4):
            c = p + d * L * j / 3
            c = _surface(q0, [c])[0]
            c = c + _out(q0, [c])[0] * (lift + 0.003 * j / 3)  # the tips stand off: a soft, broken outline
            for sgn in (-1, 1):
                Vs.append(c + side * wdt * sgn)
                UV.append((0.5 + 0.5 * sgn, j / 3))
        for j in range(3):
            a, b, c_, e = base + 2 * j, base + 2 * j + 1, base + 2 * j + 2, base + 2 * j + 3
            T += [(a, b, e), (a, e, c_)]
    Vs = np.array(Vs)
    d2 = ((Vs[:, None, :] - V_ref[None, :, :]) ** 2).sum(-1)
    nn = np.argsort(d2, axis=1)[:, :4]
    w = 1.0 / (np.take_along_axis(d2, nn, 1) + 1e-6)
    w /= w.sum(1, keepdims=True)
    Vb = Vs + (w[..., None] * (H["Vh"][nn] - V_ref[nn])).sum(1)
    W = hd.to_world(Vb, P)
    T = np.array(T)
    uv = np.array(UV)[T]
    return dict(V=W, Vs=hd.stooped(W, P), T=T, uv=uv, weights=[hd.vertex_weights(P, W[i][1], 0.0) for i in range(len(W))])


def card_material(name, rgb):
    import bpy

    img = bpy.data.images.new(name, CARD_TEX, CARD_TEX, alpha=True)
    img.pixels.foreach_set(card_picture(rgb).ravel())
    img.pack()
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.7
    try:
        mt.surface_render_method = "DITHERED"
    except AttributeError:
        pass
    mt.use_backface_culling = False
    return mt

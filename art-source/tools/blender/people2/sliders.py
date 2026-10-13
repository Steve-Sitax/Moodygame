"""The sliders: MakeHuman's way of making every person different from one base body (docs/people.md "Sliders").

A slider is one of MakeHuman's CC0 targets (or a pair: an increase and a decrease, or a macro change such as more
weight) turned into shape keys of the near copy (face and body sliders) and of the far copy (body sliders only):
the same target moved through each body's pose, scale and stoop (mhbody.Body.move) and carried by the copies'
bindings, so every body has the same sliders. A slider's value runs from -1 to 1 (one-way sliders 0 to 1); a
two-way slider whose two targets mirror each other is one signed key (`s_<name>`, weights -1..1), otherwise two keys
(`s_<name>` for the plus side, `s_<name>_neg` for the minus side, each 0..1).

The face types (face_types.py) and the builds are presets over these sliders (a mean and a spread per slider); the
game gives each person their values from their id at spawn (the same on every PC). A future character creator can
offer the `player` sliders within `playerRange` (period-plausible faces and bodies; never a monster).
shared/peopleSliders.json carries the list (build_people2 writes it).
"""

import numpy as np

from . import mh


class Slider:
    def __init__(self, name, group, plus, minus=None, desc="", player=True, player_range=(-1.0, 1.0), one_way=False,
                 macro=None):
        self.name, self.group, self.desc = name, group, desc
        self.plus, self.minus = plus, minus
        self.player, self.player_range, self.one_way = player, player_range, one_way
        self.macro = macro  # (macro field, step) for body sliders made from MakeHuman's macro mix


def _lr(t):
    """A sided target on both sides: 'eyes/{s}-eye-scale-incr' -> both."""
    return {t.format(s=s): 1.0 for s in ("l", "r")}


F, BODY = "face", "body"
SLIDERS = [
    # the head and the face's outline (what reads at 5 m)
    Slider("head_tall", F, {"head/head-scale-vert-incr": 1}, {"head/head-scale-vert-decr": 1}, "a taller or shorter head"),
    Slider("head_wide", F, {"head/head-scale-horiz-incr": 1}, {"head/head-scale-horiz-decr": 1}, "a broader or narrower head"),
    Slider("skull_long", F, {"head/head-scale-depth-incr": 1}, {"head/head-scale-depth-decr": 1},
           "a long skull from brow to back, or a short round one"),
    Slider("face_round", F, {"head/head-round": 1}, None, "a round face", one_way=True),
    Slider("face_square", F, {"head/head-square": 1}, None, "a square face, a wide jaw", one_way=True),
    Slider("face_oval", F, {"head/head-oval": 1}, None, "a long oval face", one_way=True),
    Slider("face_fat", F, {"head/head-fat-incr": 1}, {"head/head-fat-decr": 1}, "a fleshy or a lean face"),
    Slider("face_age", F, {"head/head-age-incr": 1}, {"head/head-age-decr": 1}, "an older or a younger face", player=False),
    Slider("forehead_back", F, {"forehead/forehead-trans-backward": 1}, {"forehead/forehead-trans-forward": 1},
           "a sloping or an upright forehead"),
    Slider("brow_ridge", F, {"eyebrows/eyebrows-trans-forward": 1}, {"eyebrows/eyebrows-trans-backward": 1},
           "a heavy or a flat brow"),
    Slider("brow_high", F, {"eyebrows/eyebrows-trans-up": 1}, {"eyebrows/eyebrows-trans-down": 1}, "brows high or low"),
    # the eyes
    Slider("eyes_big", F, _lr("eyes/{s}-eye-scale-incr"), _lr("eyes/{s}-eye-scale-decr"), "big or small eyes",
           player_range=(-0.8, 0.8)),
    Slider("eyes_apart", F, _lr("eyes/{s}-eye-trans-out"), _lr("eyes/{s}-eye-trans-in"), "wide-set or close-set eyes",
           player_range=(-0.8, 0.8)),
    Slider("eyes_high", F, _lr("eyes/{s}-eye-trans-up"), _lr("eyes/{s}-eye-trans-down"), "eyes set high or low"),
    Slider("eyes_open", F, _lr("eyes/{s}-eye-height2-incr"), _lr("eyes/{s}-eye-height2-decr"),
           "eyes wide open or narrow", player_range=(-0.8, 0.8)),
    Slider("eyes_hooded", F, _lr("eyes/{s}-eye-eyefold-down"), _lr("eyes/{s}-eye-eyefold-up"), "heavy hooded lids"),
    Slider("eyes_slant", F, _lr("eyes/{s}-eye-corner2-up"), _lr("eyes/{s}-eye-corner2-down"),
           "the outer corners up or down"),
    Slider("eye_bags", F, _lr("eyes/{s}-eye-bag-incr"), _lr("eyes/{s}-eye-bag-decr"), "bags under the eyes"),
    Slider("eye_fold", F, _lr("eyes/{s}-eye-epicanthus-in"), _lr("eyes/{s}-eye-epicanthus-out"),
           "the inner lid fold of East Asian eyes"),
    # the nose
    Slider("nose_long", F, {"nose/nose-scale-vert-incr": 1}, {"nose/nose-scale-vert-decr": 1}, "a long or short nose"),
    Slider("nose_wide", F, {"nose/nose-scale-horiz-incr": 1}, {"nose/nose-scale-horiz-decr": 1},
           "a broad or narrow nose"),
    Slider("nose_out", F, {"nose/nose-scale-depth-incr": 1}, {"nose/nose-scale-depth-decr": 1},
           "a nose that stands out, or a flat one"),
    Slider("nose_hump", F, {"nose/nose-hump-incr": 1}, {"nose/nose-hump-decr": 1}, "a hump on the bridge"),
    Slider("nose_hook", F, {"nose/nose-curve-convex": 1}, {"nose/nose-curve-concave": 1},
           "a hooked (convex) or a turned-up (concave) nose"),
    Slider("nose_tip_down", F, {"nose/nose-point-down": 1}, {"nose/nose-point-up": 1}, "a drooping or an upturned tip"),
    Slider("nose_bulb", F, {"nose/nose-point-width-incr": 1}, {"nose/nose-point-width-decr": 1},
           "a round bulbous tip or a fine one"),
    Slider("nostrils_wide", F, {"nose/nose-nostrils-width-incr": 1}, {"nose/nose-nostrils-width-decr": 1},
           "wide or narrow nostrils"),
    # the mouth
    Slider("mouth_wide", F, {"mouth/mouth-scale-horiz-incr": 1}, {"mouth/mouth-scale-horiz-decr": 1},
           "a wide or small mouth"),
    Slider("lips_full", F, {"mouth/mouth-upperlip-volume-incr": 1, "mouth/mouth-lowerlip-volume-incr": 1},
           {"mouth/mouth-upperlip-volume-decr": 1, "mouth/mouth-lowerlip-volume-decr": 1}, "full or thin lips"),
    Slider("mouth_out", F, {"mouth/mouth-trans-forward": 1}, {"mouth/mouth-trans-backward": 1},
           "a mouth that juts or sits back"),
    Slider("mouth_corners", F, {"mouth/mouth-angles-up": 1}, {"mouth/mouth-angles-down": 1},
           "the corners of the mouth up or down"),
    # cheeks, chin, jaw, ears, neck
    Slider("cheekbones", F, _lr("cheek/{s}-cheek-bones-incr"), _lr("cheek/{s}-cheek-bones-decr"),
           "high cheekbones or flat ones"),
    Slider("cheeks_full", F, _lr("cheek/{s}-cheek-volume-incr"), _lr("cheek/{s}-cheek-volume-decr"),
           "full or hollow cheeks"),
    Slider("chin_out", F, {"chin/chin-prominent-incr": 1}, {"chin/chin-prominent-decr": 1},
           "a strong chin or a receding one"),
    Slider("chin_wide", F, {"chin/chin-width-incr": 1}, {"chin/chin-width-decr": 1}, "a broad or a pointed chin"),
    Slider("chin_tall", F, {"chin/chin-height-incr": 1}, {"chin/chin-height-decr": 1}, "a long or a short chin"),
    Slider("jaw_wide", F, {"chin/chin-bones-incr": 1}, {"chin/chin-bones-decr": 1}, "a wide, angular jaw or a light one"),
    Slider("jaw_low", F, {"chin/chin-jaw-drop-incr": 1}, {"chin/chin-jaw-drop-decr": 1}, "the jaw's angle low or high"),
    Slider("ears_big", F, _lr("ears/{s}-ear-scale-incr"), _lr("ears/{s}-ear-scale-decr"), "big or small ears"),
    Slider("ears_out", F, _lr("ears/{s}-ear-flap-incr"), _lr("ears/{s}-ear-flap-decr"), "ears that stand out"),
    Slider("neck_thick", F, {"neck/neck-scale-horiz-incr": 1, "neck/neck-scale-depth-incr": 1},
           {"neck/neck-scale-horiz-decr": 1, "neck/neck-scale-depth-decr": 1}, "a thick or a thin neck"),
    Slider("double_chin", F, {"neck/neck-double-incr": 1}, None, "a double chin", one_way=True),
    # where people came from: MakeHuman's own race targets at the body's sex and age (face and body, one way)
    Slider("origin_african", F, None, None, "the African build of face and body (MakeHuman's macro mix)", one_way=True,
           macro=("race", "african")),
    Slider("origin_asian", F, None, None, "the East Asian build of face and body (MakeHuman's macro mix)", one_way=True,
           macro=("race", "asian")),
    # the body (both copies)
    Slider("weight", BODY, None, None, "heavier or lighter all over (MakeHuman's weight, +-0.3)", macro=("weight", 0.3)),
    Slider("muscle", BODY, None, None, "more or less muscle (MakeHuman's muscle, +-0.3)", macro=("muscle", 0.3)),
    Slider("belly", BODY, {"stomach/stomach-pregnant-incr": 1}, {"stomach/stomach-pregnant-decr": 1},
           "a belly, or a flat stomach", player_range=(-0.6, 0.8)),
    Slider("shoulders", BODY, {"torso/torso-scale-horiz-incr": 1}, {"torso/torso-scale-horiz-decr": 1},
           "broad or narrow shoulders and chest", player_range=(-0.6, 0.6)),
    Slider("hips_wide", BODY, {"hip/hip-scale-horiz-incr": 1}, {"hip/hip-scale-horiz-decr": 1}, "wide or narrow hips",
           player_range=(-0.6, 0.6)),
    Slider("buttocks", BODY, {"buttocks/buttocks-volume-incr": 1}, {"buttocks/buttocks-volume-decr": 1},
           "full or flat buttocks", player_range=(-0.6, 0.6)),
    Slider("bust", BODY, None, None, "a fuller or a smaller bust (women; MakeHuman's cup size, +-0.3)",
           macro=("cupsize", 0.3)),
]
BY_NAME = {s.name: s for s in SLIDERS}
SYMMETRY = 0.22  # a two-way slider is one signed key when its two sides mirror each other this closely


def _targets(d):
    D = np.zeros((mh.NV, 3))
    for name, w in (d or {}).items():
        i, dd = mh.target(name)
        D[i] += dd * w
    return D


def side_moves(s, body):
    """The base-mesh moves (MakeHuman's pose and units, metres) of a slider's plus and minus side for a body."""
    if s.macro is not None:
        field, step = s.macro
        mac = body.mac
        base = mh.macro_move(mac)
        if field == "race":
            m2 = dict(mac)
            m2["race"] = {k: (1.0 if k == step else 0.0) for k in mac["race"]}
            return head_only(body, mh.macro_move(m2) - base), None
        def at(v):
            m2 = dict(mac)
            m2[field] = float(np.clip(v, 0.0, 1.0))
            return mh.macro_move(m2) - base
        if field == "cupsize" and not body.params["female"]:
            return np.zeros((mh.NV, 3)), np.zeros((mh.NV, 3))
        return at(mac[field] + step), at(mac[field] - step)
    plus = _targets(s.plus)
    minus = _targets(s.minus) if s.minus else None
    return plus, minus


def head_only(body, D):
    """A whole-body move kept to the head and neck (fading out down the neck), without moving the head as a whole:
    the race macros change the whole build (a body's proportions belong to the skeleton), the sliders only the face."""
    b = body.b
    pt = body.parts
    head = np.isin(pt, ("head", "eye"))
    t = D[head & np.isin(np.arange(mh.NV), b.body)].mean(0)
    V = b.V  # the neutral base mesh: heights relative to its own joints
    y0, y1 = b.cube(V, "neck")[1], b.cube(V, "head")[1]
    m = np.where(head, 1.0, 0.0)
    neck = pt == "neck"
    s = np.clip((V[:, 1] - y0) / max(y1 - y0, 1e-6), 0, 1)
    m[neck] = (s * s * (3 - 2 * s))[neck]
    return (D - t) * m[:, None]


_SIGNED = {}


def signed(s, body):
    """Whether a two-way slider is one signed key (its sides mirror each other), decided once on the first body."""
    if s.one_way:
        return False
    if s.name not in _SIGNED:
        p, m = side_moves(s, body)
        if m is None:
            _SIGNED[s.name] = False
        else:
            num = np.linalg.norm(p + m, axis=1).sum()
            den = np.linalg.norm(p, axis=1).sum() + np.linalg.norm(m, axis=1).sum()
            _SIGNED[s.name] = bool(den > 0 and num / den < SYMMETRY)
    return _SIGNED[s.name]


def keys(body, groups=(F, BODY)):
    """{key name: move in the body's rest space (NV, 3)} for every slider of the groups."""
    out = {}
    for s in SLIDERS:
        if s.group not in groups:
            continue
        p, m = side_moves(s, body)
        if m is None or s.one_way:
            out["s_" + s.name] = body.move(p)
        elif signed(s, body):
            out["s_" + s.name] = body.move(0.5 * (p - m))
        else:
            out["s_" + s.name] = body.move(p)
            out["s_" + s.name + "_neg"] = body.move(m)
    return out


def keys_of_group(group):
    """The key names of a group's sliders (after signed() has been decided)."""
    out = []
    for s in SLIDERS:
        if s.group != group:
            continue
        out.append("s_" + s.name)
        if not (s.one_way or _SIGNED.get(s.name, False) or (s.macro is not None and s.macro[0] == "race")):
            out.append("s_" + s.name + "_neg")
    return out


def key_values(values):
    """Slider values {name: -1..1} -> shape key weights {key: weight} (the runtime does the same)."""
    out = {}
    for name, v in values.items():
        s = BY_NAME.get(name)
        if s is None or v == 0:
            continue
        if s.one_way:
            out["s_" + name] = max(0.0, float(v))
        elif _SIGNED.get(name, False) or v >= 0:
            out["s_" + name] = float(v)
        else:
            out["s_" + name + "_neg"] = float(-v)
    return out


def to_json():
    return {
        "about": "people2 sliders (art-source/tools/blender/people2/sliders.py, docs/people.md 'Sliders'): MakeHuman's "
                 "CC0 targets as shape keys of <body>_lod0 (face and body) and <body>_lod1 (body). A slider's value "
                 "v runs -1..1 (oneWay: 0..1). signed: one key s_<name> with weight v. Otherwise v >= 0 sets s_<name> "
                 "= v and v < 0 sets s_<name>_neg = -v. Keys missing from a mesh are not on it (the far copy has the "
                 "body group only).",
        "sliders": [{"name": s.name, "group": s.group, "oneWay": s.one_way, "signed": _SIGNED.get(s.name, False),
                     "keys": ["s_" + s.name] + ([] if (s.one_way or _SIGNED.get(s.name, False)) else
                                                ["s_" + s.name + "_neg"]),
                     "range": [0.0 if s.one_way else -1.0, 1.0], "default": 0.0, "player": s.player,
                     "playerRange": [0.0 if s.one_way else s.player_range[0], s.player_range[1]],
                     "makehuman": {"plus": s.plus, "minus": s.minus, "macro": list(s.macro) if s.macro else None},
                     "desc": s.desc} for s in SLIDERS],
    }

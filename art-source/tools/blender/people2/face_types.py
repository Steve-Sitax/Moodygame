"""Face types of Antwerp in 1873 (docs/people.md "Faces in the game"): who looks like what, and the one function that
gives a person a face from their id, the same on every PC.

A face is: a type (one of the 22 below), the values of the sliders (sliders.py: MakeHuman's CC0 targets as shape keys,
-1..1), a face picture (one of CELLS: skin, hair colour, stubble, weathering; mhface paints them), a hair style, a
beard and a moustache (mhhair's pieces). A type gives each slider a mean and a spread; a person is drawn round them.
The builds (the body sliders) are presets of the same kind (BUILDS). The game does the same from
shared/faceTypes.json (face_for below is the reference; the json carries the tables, the random number recipe and
test vectors), so a person looks the same on every PC and in every session.

The types follow the people of a port in 1873: Flemish dockers and their wives, Walloon soldiers and smiths, Dutch
skippers, Scandinavian, British, German, southern European, Levantine, African and Chinese sailors and cooks,
emigrants for the Red Star Line, clerks, gentlemen, widows and beguines, children, the old.
"""

import json
import math

from . import sliders as sl

# ---------------------------------------------------------------- the face pictures (mhface.paint looks)


def _cell(group, age, skin, hair, tone=(1.0, 1.0, 1.0), **kw):
    lk = dict(group=group, age=age, skin=skin, hair=hair, tone=tone, stubble=0.0, weather=0.3, ruddy=0.3,
              drinker=0.0, pox=0.0, freckles=0.0, soot=0.0, iris="brown", brow="eyebrow001", brow_k=1.0,
              lash="eyelashes01", scalp="hair", recede=0.0)
    lk.update(kw)
    return lk


LIGHT_W = (0.93, 0.86, 0.80)  # weathered outdoor skin
OLIVE = (0.86, 0.76, 0.64)
CELLS = [
    ("m_young_fair", _cell("m", "young", "light", "light", (0.98, 0.94, 0.90), stubble=0.15, iris="blue",
                           ruddy=0.45, weather=0.25, brow="eyebrow002")),
    ("m_fair_fair", _cell("m", "young", "light", "fair", (0.96, 0.92, 0.88), stubble=0.35, iris="blue", ruddy=0.55,
                          weather=0.4, brow="eyebrow002")),
    ("m_fair_brown", _cell("m", "middle", "light", "light", (0.97, 0.93, 0.89), stubble=0.5, iris="grey",
                           brow="eyebrow001")),
    ("m_fair_red", _cell("m", "young", "light", "red", (0.98, 0.93, 0.90), freckles=0.8, ruddy=0.5, stubble=0.3,
                         iris="green", brow="eyebrow002")),
    ("m_mid_brown", _cell("m", "middle", "light", "brown", (0.94, 0.88, 0.82), stubble=0.6, iris="brownlight",
                          brow="eyebrow003")),
    ("m_mid_dark", _cell("m", "middle", "light", "dark", (0.91, 0.84, 0.77), stubble=0.9, brow="eyebrow003",
                         brow_k=1.2)),
    ("m_weather_brown", _cell("m", "middle", "light", "brown", LIGHT_W, weather=1.0, ruddy=0.55, stubble=0.7,
                              iris="grey", brow="eyebrow001")),
    ("m_weather_dark_drink", _cell("m", "middle", "light", "dark", (0.92, 0.84, 0.78), drinker=1.0, ruddy=0.7,
                                   stubble=0.8, weather=0.9, brow="eyebrow003", brow_k=1.1)),
    ("m_pox_brown", _cell("m", "young", "light", "brown", (0.94, 0.87, 0.81), pox=1.0, stubble=0.6, brow="eyebrow001")),
    ("m_sooty", _cell("m", "middle", "light", "dark", (0.92, 0.85, 0.79), soot=1.0, stubble=0.8, weather=0.8,
                      brow="eyebrow003")),
    ("m_olive_black", _cell("m", "middle", "light", "black", OLIVE, stubble=0.9, brow="eyebrow003", brow_k=1.3,
                            weather=0.6, iris="brown")),
    ("m_dark_black", _cell("m", "middle", "dark", "black", (1.0, 1.0, 1.0), stubble=0.3, ruddy=0.0, brow="eyebrow002",
                           brow_k=0.9, weather=0.2)),
    ("m_asian_black", _cell("m", "middle", "asian", "black", (1.0, 0.98, 0.95), stubble=0.1, brow="eyebrow010",
                            brow_k=0.9, ruddy=0.1, weather=0.3)),
    ("om_grey", _cell("om", "old", "light", "grey", (0.96, 0.91, 0.86), weather=0.6, stubble=0.4, iris="grey",
                      recede=0.6, brow="eyebrow005")),
    ("om_white_weather", _cell("om", "old", "light", "white", LIGHT_W, weather=1.0, ruddy=0.6, stubble=0.5,
                               iris="lightblue", recede=0.8, brow="eyebrow005")),
    ("om_bald_drink", _cell("om", "old", "light", "grey", (0.95, 0.89, 0.84), scalp="bald", recede=1.0, drinker=1.0,
                            ruddy=0.6, stubble=0.35, brow="eyebrow005")),
    ("om_bald_grey", _cell("om", "old", "light", "greydark", (0.93, 0.87, 0.82), scalp="bald", recede=1.0,
                           stubble=0.6, weather=0.7, brow="eyebrow003")),
    ("f_fair_fair", _cell("f", "young", "light", "fair", (0.99, 0.95, 0.92), iris="blue", ruddy=0.35, weather=0.2,
                          brow="eyebrow010")),
    ("f_fair_brown", _cell("f", "young", "light", "brown", (0.97, 0.93, 0.89), iris="grey", ruddy=0.3, weather=0.3,
                           brow="eyebrow008")),
    ("f_mid_dark", _cell("f", "middle", "light", "dark", (0.94, 0.88, 0.83), iris="brownlight", weather=0.4,
                         brow="eyebrow008")),
    ("f_weather_ruddy", _cell("f", "middle", "light", "brown", LIGHT_W, ruddy=0.8, weather=0.9, brow="eyebrow001")),
    ("f_red_freckled", _cell("f", "young", "light", "red", (0.99, 0.95, 0.92), freckles=0.9, iris="green", ruddy=0.4,
                             brow="eyebrow010")),
    ("f_olive_black", _cell("f", "middle", "light", "black", OLIVE, brow="eyebrow008", brow_k=1.15, weather=0.5)),
    ("f_dark_black", _cell("f", "middle", "dark", "black", (1.0, 1.0, 1.0), ruddy=0.0, brow="eyebrow010")),
    ("of_grey", _cell("of", "old", "light", "grey", (0.96, 0.91, 0.87), weather=0.5, iris="grey", brow="eyebrow005")),
    ("of_white_weather", _cell("of", "old", "light", "white", LIGHT_W, weather=0.9, ruddy=0.5, brow="eyebrow005")),
    ("c_boy_fair", _cell("c", "young", "light", "fair", (0.99, 0.95, 0.92), ruddy=0.45, weather=0.3, iris="blue",
                         brow="eyebrow010", brow_k=0.8, lash="eyelashes02")),
    ("c_boy_brown", _cell("c", "young", "light", "brown", (0.96, 0.91, 0.86), ruddy=0.35, weather=0.5,
                          brow="eyebrow010", brow_k=0.8, lash="eyelashes02")),
    ("c_sooty", _cell("c", "young", "light", "dark", (0.95, 0.89, 0.84), soot=0.9, weather=0.6, brow="eyebrow010",
                      brow_k=0.8, lash="eyelashes02")),
    ("c_girl_fair", _cell("cf", "young", "light", "light", (0.99, 0.95, 0.92), ruddy=0.45, iris="blue",
                          brow="eyebrow010", brow_k=0.75, lash="eyelashes02")),
]
CELL_NAMES = [n for n, _ in CELLS]
CELL = dict(CELLS)
for _k, (_n, _lk) in enumerate(CELLS):
    _lk["seed"] = 500 + _k
    if _lk["group"] == "cf":  # a girl: the child's head, a woman's skin and no stubble
        _lk["group"] = "c"
        _lk["sex"] = "f"

# ---------------------------------------------------------------- the old face axes, as slider presets

# Each axis of the earlier face package (a person's look in words) is a mix of sliders.
AXIS_MIX = {
    "skull_long": {"skull_long": 0.85, "head_wide": -0.3},
    "crown_high": {"head_tall": 0.55, "forehead_back": -0.25},
    "face_long": {"face_oval": 0.6, "chin_tall": 0.5, "head_wide": -0.2},
    "face_short": {"face_round": 0.6, "chin_tall": -0.3},
    "jaw_wide": {"jaw_wide": 0.8, "chin_wide": 0.45, "face_square": 0.5},
    "fat": {"face_fat": 0.8, "cheeks_full": 0.5, "neck_thick": 0.4},
    "nose_big": {"nose_long": 0.6, "nose_out": 0.6},
    "nose_hook": {"nose_hook": 0.8, "nose_hump": 0.5, "nose_tip_down": 0.3},
    "nose_wide": {"nose_wide": 0.8, "nostrils_wide": 0.6, "nose_bulb": 0.35},
    "eyes_wide": {"eyes_apart": 0.8},
    "eyes_big": {"eyes_big": 0.7, "eyes_open": 0.5, "eyes_hooded": -0.5},
    "brow_heavy": {"brow_ridge": 0.9, "brow_high": -0.4},
    "cheekbones": {"cheekbones": 0.9},
    "mid_long": {"nose_long": 0.35, "eyes_high": 0.35},
    "lips_full": {"lips_full": 0.9, "mouth_wide": 0.25},
    "chin_out": {"chin_out": 0.9},
    "ears_out": {"ears_out": 0.8, "ears_big": 0.4},
}
TYPE_GAIN = 1.35  # the types' means, stronger: at 5 m a type's face reads apart from the others (2026-10-13 sheets)
DEFAULT_SPREAD = 0.28  # a slider a type does not name: every face still differs a little everywhere


def _type(sex, desc, origin, axes, cells, hair, beard=None, moustache=None, extras=None, ages=(18, 70), extra=None,
          body=None):
    """axes: {old axis: (mean, spread)} (AXIS_MIX turns them into sliders); extra: {slider: (mean, spread)} on top."""
    sl_mean, sl_var = {}, {}
    for a, (m, sd) in axes.items():
        if a == "face_long" and m < 0:
            a, m = "face_short", -m
        for s, c in AXIS_MIX[a].items():
            sl_mean[s] = sl_mean.get(s, 0.0) + m * c
            sl_var[s] = sl_var.get(s, 0.0) + (sd * c) ** 2
    for s, (m, sd) in (extra or {}).items():
        sl_mean[s] = sl_mean.get(s, 0.0) + m
        sl_var[s] = sl_var.get(s, 0.0) + sd * sd
    presets = {s: (round(max(-0.95, min(0.95, TYPE_GAIN * sl_mean.get(s, 0.0))), 3),
                   round(math.sqrt(sl_var.get(s, 0.0) + 0.12 ** 2), 3)) for s in set(sl_mean) | set(sl_var)}
    return dict(sex=sex, desc=desc, origin=origin, sliders=presets, cells=cells, hair=hair,
                beard=beard or {None: 1}, moustache=moustache or {None: 1}, extras=extras or {}, ages=ages,
                body=body or {})


MEN_HAIR = {"crop": 5, "side": 3, "long": 1}
WORK_BEARD = {None: 6, "short": 2, "chops": 2, "sideburns": 2, "full": 1}
WORK_MOUS = {None: 4, "walrus": 4, "chevron": 3, "handlebar": 1}

TYPES = {
    "flemish_docker": _type("m", "short wide skull, wide low face, square jaw, blunt chin, short broad nose with a "
                            "round tip, small deep-set eyes, thick neck", "flemish",
                            {"skull_long": (-0.6, 0.3), "crown_high": (-0.3, 0.3), "face_long": (-0.5, 0.3),
                             "jaw_wide": (0.8, 0.25), "fat": (0.1, 0.4), "nose_big": (-0.2, 0.35),
                             "nose_wide": (0.5, 0.3), "eyes_big": (-0.5, 0.3), "brow_heavy": (0.5, 0.3),
                             "cheekbones": (0.2, 0.3)},
                            ["m_fair_fair", "m_fair_brown", "m_mid_brown", "m_mid_dark", "m_weather_brown",
                             "m_weather_dark_drink", "m_pox_brown", "m_sooty", "om_grey", "om_white_weather"],
                            MEN_HAIR, WORK_BEARD, WORK_MOUS, {"pox": 0.12, "crook": 0.15},
                            body={"muscle": (0.3, 0.3), "shoulders": (0.2, 0.25)}),
    "fat_publican": _type("m", "round skull, jowls that hide the jaw, a double chin, a small bulbous nose, puffy lids, "
                          "a full lower lip", "flemish",
                          {"skull_long": (-0.5, 0.3), "fat": (0.9, 0.15), "jaw_wide": (0.3, 0.3),
                           "nose_big": (-0.1, 0.3), "nose_wide": (0.5, 0.3), "eyes_big": (-0.6, 0.25),
                           "lips_full": (0.5, 0.3), "chin_out": (-0.3, 0.3), "cheekbones": (-0.5, 0.3),
                           "face_long": (-0.3, 0.3)},
                          ["m_fair_fair", "m_mid_brown", "m_weather_dark_drink", "m_fair_brown", "om_grey",
                           "om_bald_drink"],
                          {"crop": 3, "side": 3, "bald": 2}, {None: 4, "chops": 3, "sideburns": 2, "full": 1},
                          {None: 2, "walrus": 4, "chevron": 2}, {"drinker": 0.5},
                          extra={"double_chin": (0.6, 0.25), "eye_bags": (0.5, 0.25)},
                          body={"weight": (0.6, 0.25), "belly": (0.5, 0.2)}),
    "walloon": _type("m", "oval face, narrow jaw, strong chin, high cheekbones, a heavy straight brow, a high bridge, "
                     "thin lips", "walloon",
                     {"skull_long": (0.2, 0.3), "face_long": (0.3, 0.3), "jaw_wide": (-0.4, 0.3),
                      "chin_out": (0.6, 0.3), "cheekbones": (0.6, 0.3), "brow_heavy": (0.6, 0.3),
                      "nose_big": (0.4, 0.3), "nose_hook": (0.2, 0.4), "lips_full": (-0.5, 0.3), "fat": (-0.4, 0.3),
                      "nose_wide": (-0.3, 0.3)},
                     ["m_mid_brown", "m_mid_dark", "m_olive_black", "m_weather_brown", "m_fair_brown", "m_young_fair",
                      "om_grey"],
                     {"crop": 4, "side": 4}, {None: 5, "imperial": 3, "short": 1},
                     {None: 2, "handlebar": 3, "chevron": 3}),
    "dutch_skipper": _type("m", "long high skull, a long face and upper lip, a long narrow nose, flat cheeks, hooded "
                           "eyes, big ears", "dutch",
                           {"skull_long": (0.6, 0.3), "crown_high": (0.5, 0.3), "face_long": (0.7, 0.2),
                            "mid_long": (0.7, 0.25), "nose_big": (0.5, 0.3), "nose_wide": (-0.5, 0.3),
                            "cheekbones": (-0.5, 0.3), "eyes_big": (-0.4, 0.3), "brow_heavy": (0.3, 0.3),
                            "ears_out": (0.6, 0.3), "fat": (-0.2, 0.3)},
                           ["m_fair_fair", "m_fair_brown", "m_weather_brown", "m_fair_red", "om_white_weather"],
                           {"crop": 3, "side": 2, "long": 2}, {None: 3, "chin": 5, "short": 1},
                           {None: 6, "chevron": 1}),
    "scandinavian": _type("m", "long narrow skull, a tall face, a high straight nose, the chin forward, deep-set eyes, "
                          "ears that stand out", "scandinavian",
                          {"skull_long": (0.7, 0.25), "face_long": (0.6, 0.25), "nose_big": (0.5, 0.3),
                           "nose_hook": (-0.2, 0.3), "nose_wide": (-0.5, 0.3), "chin_out": (0.6, 0.3),
                           "brow_heavy": (0.5, 0.3), "eyes_big": (-0.3, 0.3), "ears_out": (0.6, 0.3),
                           "cheekbones": (0.4, 0.3), "jaw_wide": (0.2, 0.3)},
                          ["m_fair_fair", "m_fair_red", "m_fair_brown", "m_weather_brown", "m_young_fair"],
                          {"crop": 3, "side": 2, "long": 2}, {None: 3, "chin": 3, "full": 2, "short": 2},
                          {None: 4, "walrus": 2, "chevron": 2}),
    "german_emigrant": _type("m", "a very round skull with a flat back, a broad face, a short nose with a low root, "
                             "wide-set eyes, a small chin", "german",
                             {"skull_long": (-0.9, 0.1), "crown_high": (0.3, 0.3), "face_long": (-0.3, 0.3),
                              "jaw_wide": (0.3, 0.3), "nose_big": (-0.5, 0.3), "nose_wide": (0.2, 0.3),
                              "eyes_wide": (0.6, 0.3), "chin_out": (-0.5, 0.3), "cheekbones": (0.3, 0.3),
                              "fat": (0.2, 0.4)},
                             ["m_fair_fair", "m_fair_brown", "m_mid_brown", "m_fair_red", "om_grey"],
                             {"crop": 4, "side": 3}, {None: 3, "full": 3, "short": 2, "chops": 1},
                             {None: 3, "walrus": 3, "chevron": 2}),
    "british_stoker": _type("m", "a square face, a cleft chin, a snub nose, a wide mouth, big ears, ruddy and freckled",
                            "british",
                            {"jaw_wide": (0.7, 0.25), "face_long": (-0.2, 0.3), "nose_big": (-0.5, 0.3),
                             "nose_hook": (-0.6, 0.3), "lips_full": (0.2, 0.3), "ears_out": (0.7, 0.25),
                             "chin_out": (0.3, 0.3), "skull_long": (0.1, 0.3), "eyes_big": (-0.2, 0.3)},
                            ["m_fair_red", "m_fair_fair", "m_mid_brown", "m_sooty", "m_weather_brown"],
                            {"crop": 6, "side": 1}, {None: 4, "sideburns": 3, "chops": 2}, {None: 5, "walrus": 2},
                            {"crook": 0.25}, extra={"mouth_wide": (0.5, 0.25)}, body={"muscle": (0.4, 0.3)}),
    "southern_sailor": _type("m", "an oval face, a hooked nose with a high bridge, a heavy brow, large eyes, full lips, "
                             "olive skin", "southern",
                             {"face_long": (0.2, 0.3), "nose_big": (0.6, 0.25), "nose_hook": (0.7, 0.25),
                              "brow_heavy": (0.6, 0.3), "eyes_big": (0.6, 0.3), "lips_full": (0.6, 0.3),
                              "nose_wide": (0.0, 0.3), "cheekbones": (0.2, 0.3), "skull_long": (0.2, 0.3)},
                             ["m_olive_black", "m_mid_dark"],
                             {"crop": 3, "side": 2, "long": 2}, {None: 4, "full": 2, "short": 3},
                             {None: 3, "handlebar": 2, "walrus": 1, "chevron": 2}),
    "levantine": _type("m", "a long narrow face, a long high nose, prominent cheekbones, deep-set eyes, brown skin",
                       "levantine",
                       {"face_long": (0.7, 0.25), "jaw_wide": (-0.4, 0.3), "nose_big": (0.7, 0.25),
                        "nose_hook": (0.5, 0.3), "nose_wide": (-0.3, 0.3), "cheekbones": (0.7, 0.25),
                        "brow_heavy": (0.5, 0.3), "eyes_big": (0.1, 0.3), "fat": (-0.5, 0.3), "skull_long": (0.4, 0.3)},
                       ["m_olive_black"],
                       {"crop": 4, "side": 1}, {None: 2, "full": 4, "short": 4}, {None: 2, "walrus": 2, "chevron": 3}),
    "african_sailor": _type("m", "a rounded forehead, a broad nose with a low bridge, wide full lips, a strong jaw, "
                            "dark skin", "african",
                            {"nose_wide": (0.6, 0.2), "lips_full": (0.5, 0.2), "jaw_wide": (0.4, 0.3),
                             "brow_heavy": (-0.2, 0.3), "crown_high": (0.3, 0.3), "chin_out": (0.2, 0.3),
                             "eyes_big": (0.3, 0.3), "cheekbones": (0.3, 0.3)},
                            ["m_dark_black"], {"crop": 1}, {None: 6, "short": 2, "chin": 1}, {None: 5, "chevron": 1},
                            extra={"origin_african": (0.85, 0.12)}),
    "chinese_cook": _type("m", "a round skull, a flat broad midface, a low nose root, a lid fold over a narrow opening, "
                          "a shallow brow", "chinese",
                          {"skull_long": (-0.6, 0.3), "cheekbones": (0.5, 0.25), "nose_big": (-0.5, 0.2),
                           "brow_heavy": (-0.6, 0.2), "eyes_big": (-0.5, 0.2), "face_long": (-0.2, 0.3)},
                          ["m_asian_black"], {"crop": 2, "long": 1}, {None: 8, "chin": 1}, {None: 6, "chevron": 1},
                          extra={"origin_asian": (0.85, 0.12), "eye_fold": (0.6, 0.2)}),
    "pale_clerk": _type("m", "a narrow face, a light jaw, a receding chin, a thin nose, large open eyes, a small "
                        "mouth, flat ears", "flemish",
                        {"jaw_wide": (-0.7, 0.25), "fat": (-0.3, 0.3), "chin_out": (-0.7, 0.25),
                         "nose_wide": (-0.6, 0.3), "nose_big": (0.1, 0.3), "eyes_big": (0.6, 0.3),
                         "lips_full": (-0.4, 0.3), "ears_out": (-0.6, 0.3), "face_long": (0.3, 0.3),
                         "brow_heavy": (-0.4, 0.3), "crown_high": (0.3, 0.3)},
                        ["m_fair_brown", "m_fair_fair", "m_mid_brown", "m_mid_dark", "m_young_fair"],
                        {"side": 6, "crop": 2}, {None: 8, "sideburns": 2, "chops": 1}, {None: 7, "chevron": 2},
                        ages=(16, 60), extra={"mouth_wide": (-0.4, 0.2)}, body={"weight": (-0.3, 0.25),
                                                                                  "muscle": (-0.4, 0.25)}),
    "gentleman": _type("m", "a long oval face, a high hooked nose, a firm chin, fleshy cheeks, heavy lids", "flemish",
                       {"face_long": (0.5, 0.25), "nose_big": (0.6, 0.25), "nose_hook": (0.6, 0.3),
                        "chin_out": (0.5, 0.3), "fat": (0.3, 0.3), "eyes_big": (-0.4, 0.3), "brow_heavy": (0.2, 0.3),
                        "nose_wide": (-0.2, 0.3), "skull_long": (0.3, 0.3)},
                       ["m_fair_fair", "m_fair_brown", "m_mid_brown", "om_grey", "om_white_weather"],
                       {"side": 6, "bald": 1}, {None: 3, "chops": 4, "full": 2, "imperial": 1},
                       {None: 3, "walrus": 2, "handlebar": 2, "chevron": 2}, body={"belly": (0.2, 0.25)}),
    "gaunt_porter": _type("m", "hollow cheeks, jutting jaw angles, deep sockets, a crooked nose, ears out, a big "
                          "Adam's apple", "flemish",
                          {"fat": (-0.9, 0.1), "jaw_wide": (0.4, 0.3), "brow_heavy": (0.7, 0.25),
                           "cheekbones": (0.7, 0.25), "ears_out": (0.6, 0.3), "nose_big": (0.3, 0.3),
                           "eyes_big": (-0.3, 0.3), "face_long": (0.4, 0.3)},
                          ["m_weather_brown", "m_weather_dark_drink", "m_pox_brown", "m_sooty", "m_mid_dark",
                           "om_white_weather", "om_bald_drink"],
                          {"crop": 5, "long": 2, "bald": 1}, {None: 6, "short": 2, "full": 1}, {None: 5, "walrus": 2},
                          {"pox": 0.2, "crook": 0.45}, body={"weight": (-0.6, 0.2)}),
    "round_flemish_woman": _type("f", "a broad face with full cheeks, a soft jaw (nine tenths of a man's), a short "
                                 "upturned nose, full lips", "flemish",
                                 {"skull_long": (-0.4, 0.3), "face_long": (-0.4, 0.3), "fat": (0.6, 0.3),
                                  "jaw_wide": (0.1, 0.3), "nose_big": (-0.5, 0.3), "nose_hook": (-0.5, 0.3),
                                  "nose_wide": (0.3, 0.3), "lips_full": (0.5, 0.3), "cheekbones": (-0.2, 0.3)},
                                 ["f_fair_fair", "f_fair_brown", "f_mid_dark", "f_weather_ruddy", "f_red_freckled",
                                  "of_grey", "of_white_weather"],
                                 {"bun": 4, "plaits": 2, "undercap": 3, "coronet": 1},
                                 body={"weight": (0.3, 0.3), "hips_wide": (0.2, 0.25), "bust": (0.2, 0.3)}),
    "lean_widow": _type("f", "a long face, a long thin nose, flat cheeks, a pointed chin, large eyes, thin lips",
                        "flemish",
                        {"face_long": (0.6, 0.25), "fat": (-0.6, 0.3), "nose_big": (0.5, 0.3), "nose_wide": (-0.6, 0.3),
                         "cheekbones": (-0.2, 0.3), "chin_out": (0.3, 0.3), "jaw_wide": (-0.6, 0.25),
                         "eyes_big": (0.4, 0.3), "lips_full": (-0.7, 0.25)},
                        ["f_fair_brown", "f_mid_dark", "of_grey", "of_white_weather"],
                        {"bun": 4, "undercap": 4}, ages=(25, 80), body={"weight": (-0.4, 0.25)}),
    "young_woman": _type("f", "a small oval face, high cheekbones, a small upturned nose, big wide-set eyes, a slim "
                         "neck", "flemish",
                         {"face_long": (-0.1, 0.3), "cheekbones": (0.5, 0.3), "nose_big": (-0.6, 0.25),
                          "nose_hook": (-0.4, 0.3), "eyes_big": (0.7, 0.25), "eyes_wide": (0.4, 0.3),
                          "jaw_wide": (-0.4, 0.3), "fat": (-0.1, 0.3), "lips_full": (0.2, 0.3), "chin_out": (0.1, 0.3)},
                         ["f_fair_fair", "f_fair_brown", "f_mid_dark", "f_red_freckled"],
                         {"bun": 3, "plaits": 2, "coronet": 2, "undercap": 2}, ages=(15, 32)),
    "southern_woman": _type("f", "a strong straight nose, heavy brows, big dark eyes, full lips", "southern",
                            {"nose_big": (0.5, 0.3), "nose_hook": (0.2, 0.3), "brow_heavy": (0.3, 0.3),
                             "eyes_big": (0.6, 0.3), "lips_full": (0.6, 0.3), "face_long": (0.2, 0.3),
                             "cheekbones": (0.3, 0.3)},
                            ["f_olive_black", "f_mid_dark"], {"bun": 4, "plaits": 2, "coronet": 1}),
    "small_child": _type("c", "a big skull, the face three quarters of an adult's height, a button nose, lean working-class cheeks, "
                         "a tiny chin, big ears", "flemish",
                         {"fat": (-0.15, 0.25), "nose_big": (-0.6, 0.25), "nose_hook": (-0.5, 0.3),
                          "chin_out": (-0.3, 0.3), "ears_out": (0.4, 0.3), "eyes_big": (0.3, 0.3),
                          "face_long": (-0.15, 0.25), "crown_high": (0.4, 0.3), "jaw_wide": (-0.3, 0.3)},
                         ["c_boy_fair", "c_boy_brown", "c_sooty", "c_girl_fair"], {"crop": 1}, ages=(5, 11)),
    "lanky_child": _type("c", "ten to fourteen: the face lengthening, ears out, a thin neck, hollow cheeks if poor",
                         "flemish",
                         {"face_long": (0.3, 0.3), "ears_out": (0.6, 0.3), "fat": (-0.4, 0.4), "nose_big": (0.0, 0.3),
                          "jaw_wide": (-0.3, 0.3), "cheekbones": (0.2, 0.3)},
                         ["c_boy_fair", "c_boy_brown", "c_sooty", "c_girl_fair"], {"crop": 1}, ages=(10, 15)),
    "shrunken_old": _type("b", "no teeth: the chin nearer the nose, the lips rolled in; a drooping nose tip, long ears, "
                          "hollow temples", "flemish",
                          {"fat": (-0.6, 0.3), "mid_long": (-0.6, 0.25), "lips_full": (-0.8, 0.2),
                           "chin_out": (0.3, 0.3), "ears_out": (0.5, 0.3), "nose_big": (0.4, 0.3),
                           "nose_hook": (0.3, 0.3), "cheekbones": (0.4, 0.3), "brow_heavy": (0.3, 0.3)},
                          ["om_grey", "om_white_weather", "om_bald_drink", "om_bald_grey", "of_grey",
                           "of_white_weather"],
                          {"bald": 3, "crop": 2, "bun": 3, "undercap": 3}, {None: 5, "short": 1, "chops": 1, "full": 1},
                          {None: 4, "walrus": 2}, ages=(62, 85), extra={"chin_tall": (-0.5, 0.2),
                                                                         "mouth_corners": (-0.5, 0.2),
                                                                         "nose_tip_down": (0.4, 0.2)},
                          body={"weight": (-0.3, 0.25)}),
    "heavy_old_man": _type("m", "jowls, a bulbous veined nose, bags under the eyes, long ears, folds in the neck",
                           "flemish",
                           {"fat": (0.7, 0.25), "nose_big": (0.5, 0.3), "nose_wide": (0.5, 0.3),
                            "eyes_big": (-0.5, 0.3), "ears_out": (0.5, 0.3), "jaw_wide": (0.4, 0.3),
                            "chin_out": (-0.2, 0.3), "skull_long": (-0.2, 0.3)},
                           ["om_grey", "om_white_weather", "om_bald_drink", "om_bald_grey"],
                           {"bald": 4, "crop": 3, "side": 2}, {None: 3, "chops": 3, "full": 3, "short": 1},
                           {None: 2, "walrus": 4, "chevron": 1}, {"drinker": 0.6}, ages=(58, 85),
                           extra={"eye_bags": (0.7, 0.2), "double_chin": (0.5, 0.25), "nose_bulb": (0.5, 0.2)},
                           body={"weight": (0.4, 0.25), "belly": (0.5, 0.25)}),
}

# ---------------------------------------------------------------- who is which type (the kinds of build_people.py)
DOCKERS = {"flemish_docker": 6, "gaunt_porter": 2, "german_emigrant": 1, "british_stoker": 1, "walloon": 1,
           "scandinavian": 1, "fat_publican": 0.5}
SAILORS = {"dutch_skipper": 2, "scandinavian": 2, "southern_sailor": 2, "british_stoker": 2, "levantine": 1,
           "african_sailor": 1, "flemish_docker": 2, "chinese_cook": 0.5, "german_emigrant": 0.5}
TOWNSMEN = {"flemish_docker": 2, "fat_publican": 2, "walloon": 1, "pale_clerk": 1, "gentleman": 1, "gaunt_porter": 1}
WIVES = {"round_flemish_woman": 5, "lean_widow": 1.5, "young_woman": 1.5, "southern_woman": 0.4}
CHILDREN = {"small_child": 2, "lanky_child": 2}
OLD = {"shrunken_old": 2, "heavy_old_man": 2, "gaunt_porter": 0.5}
UNIFORM = {"walloon": 4, "flemish_docker": 2, "pale_clerk": 2, "scandinavian": 0.5, "german_emigrant": 0.5}

KIND_TYPES = {
    "sooi": DOCKERS, "peeters": {"lean_widow": 3, "round_flemish_woman": 1}, "tuur": DOCKERS,
    "fientje": {"young_woman": 2, "round_flemish_woman": 2}, "sailor": SAILORS,
    "stranger": {"gentleman": 2, "walloon": 1, "southern_sailor": 0.5},
    "thief": {"gaunt_porter": 2, "pale_clerk": 1, "flemish_docker": 1},
    "foreman": {"flemish_docker": 3, "fat_publican": 1, "walloon": 1}, "recipient": TOWNSMEN,
    "docker_a": DOCKERS, "docker_b": DOCKERS, "docker_c": DOCKERS, "docker_sack": DOCKERS, "porter": DOCKERS,
    "fishwife_a": WIVES, "fishwife_b": {"round_flemish_woman": 3, "lean_widow": 2},
    "maid": {"young_woman": 4, "round_flemish_woman": 1},
    "boy": CHILDREN, "girl": CHILDREN, "gentleman": {"gentleman": 4, "fat_publican": 1, "walloon": 1},
    "priest": {"pale_clerk": 2, "fat_publican": 1, "gentleman": 1, "walloon": 1}, "police": UNIFORM,
    "carter": DOCKERS, "sailor_b": SAILORS, "baker": {"fat_publican": 3, "flemish_docker": 2},
    "shopkeeper": {"fat_publican": 2, "pale_clerk": 1, "flemish_docker": 1, "gentleman": 0.5},
    "publican": {"fat_publican": 4, "flemish_docker": 1}, "clerk": {"pale_clerk": 4, "walloon": 1},
    "old_man": OLD, "beggar": {"gaunt_porter": 2, "shrunken_old": 2}, "wife_a": WIVES, "wife_b": WIVES,
    "shopwife": WIVES, "old_woman": {"shrunken_old": 3, "lean_widow": 1}, "urchin": CHILDREN, "girl_b": CHILDREN,
    "soldier": UNIFORM, "soldier_b": UNIFORM, "sentry": UNIFORM, "customs": UNIFORM, "milk_woman": WIVES,
    "baker_boy": CHILDREN, "grinder": {"gaunt_porter": 1, "southern_sailor": 1, "heavy_old_man": 1, "shrunken_old": 1},
    "ragman": {"gaunt_porter": 2, "shrunken_old": 1, "heavy_old_man": 1}, "coalman": DOCKERS, "sweep": DOCKERS,
    "sweep_boy": CHILDREN, "nun": {"young_woman": 2, "lean_widow": 2, "round_flemish_woman": 1},
    "beguine": {"lean_widow": 3, "round_flemish_woman": 1}, "tourist": {"gentleman": 3, "british_stoker": 1},
    "tourist_lady": {"young_woman": 2, "lean_widow": 1},
}
# kinds whose paint is set by their trade (soot, grime): the cell named here wins
KIND_CELLS = {"coalman": ["m_sooty"], "sweep": ["m_sooty"], "sweep_boy": ["c_sooty"]}
# kinds that wear a hat or a cap over their hair: the hair styles that fit under it (mhhair: "capped" is a crop
# pressed flat under a cap's or kepi's band and gone above it; "undercap" a woman's hair under the linen cap)
KIND_HAIR = {"docker_a": {"capped": 3, "bald": 1}, "police": {"capped": 1}, "sooi": {"capped": 1},
             "fishwife_a": {"undercap": 1}, "fishwife_b": {"undercap": 1}, "nun": {"undercap": 1},
             "beguine": {"undercap": 1}, "maid": {"undercap": 1}, "milk_woman": {"undercap": 1},
             "old_woman": {"undercap": 1}, "old_woman_dressed": {"undercap": 1}, "shopwife": {"undercap": 1},
             "tourist_lady": {"bun": 1}, "wife_a": {"undercap": 1}, "wife_b": {"undercap": 1}}
KIND_TYPES["old_woman_dressed"] = dict(KIND_TYPES["old_woman"])
KIND_TYPES["old_man_dressed"] = dict(KIND_TYPES["old_man"])

# ---------------------------------------------------------------- the named cast: fixed faces (sliders by name)
CAST = {
    "sooi": dict(type="flemish_docker", sliders={"jaw_wide": 0.8, "face_square": 0.5, "skull_long": -0.5,
                                                   "nose_wide": 0.5, "nostrils_wide": 0.4, "face_fat": 0.2,
                                                   "brow_ridge": 0.6, "eyes_big": -0.4, "eyes_hooded": 0.3,
                                                   "ears_out": 0.3, "neck_thick": 0.4, "chin_wide": 0.4},
                 cell="m_weather_brown", hair="capped", beard=None, moustache="walrus", age=52),
    "peeters": dict(type="lean_widow", sliders={"face_oval": 0.6, "face_fat": -0.5, "nose_long": 0.4, "nose_out": 0.3,
                                                "nose_wide": -0.5, "lips_full": -0.6, "jaw_wide": -0.5,
                                                "eyes_big": 0.3, "chin_out": 0.4},
                    cell="of_grey", hair="undercap", beard=None, moustache=None, age=62),
    "tuur": dict(type="flemish_docker", sliders={"jaw_wide": 0.5, "skull_long": -0.3, "chin_tall": 0.2,
                                                 "nose_hook": 0.4, "nose_hump": 0.3, "brow_ridge": 0.4,
                                                 "cheekbones": 0.5, "face_fat": -0.3},
                 cell="m_mid_dark", hair="crop", beard=None, moustache=None, age=38),
    "fientje": dict(type="young_woman", sliders={"eyes_big": 0.5, "cheekbones": 0.5, "nose_long": -0.4,
                                                 "nose_out": -0.3, "lips_full": 0.3, "jaw_wide": -0.3,
                                                 "face_round": 0.2},
                    cell="f_fair_brown", hair="bun", beard=None, moustache=None, age=30),
    "sailor": dict(type="scandinavian", sliders={"skull_long": 0.6, "face_oval": 0.4, "nose_long": 0.4,
                                                 "nose_out": 0.3, "chin_out": 0.6, "ears_out": 0.5, "brow_ridge": 0.5,
                                                 "cheekbones": 0.4},
                   cell="m_fair_red", hair="long", beard="chops", moustache="walrus", age=40),
    "stranger": dict(type="gentleman", sliders={"face_oval": 0.5, "nose_long": 0.5, "nose_out": 0.4, "nose_hook": 0.7,
                                                "nose_hump": 0.4, "chin_out": 0.5, "eyes_hooded": 0.4,
                                                "skull_long": 0.4},
                     cell="m_olive_black", hair="side", beard="imperial", moustache="handlebar", age=40),
    "thief": dict(type="gaunt_porter", sliders={"face_fat": -0.8, "cheeks_full": -0.6, "jaw_wide": 0.3,
                                                "brow_ridge": 0.5, "ears_out": 0.7, "nose_hook": 0.4,
                                                "eyes_big": -0.2, "chin_tall": 0.2},
                  cell="m_pox_brown", hair="crop", beard=None, moustache=None, age=24, crook=0.6),
    "foreman": dict(type="flemish_docker", sliders={"jaw_wide": 0.7, "face_fat": 0.5, "skull_long": -0.5,
                                                    "nose_wide": 0.4, "brow_ridge": 0.4, "eyes_big": -0.4,
                                                    "double_chin": 0.3},
                    cell="m_mid_brown", hair="side", beard=None, moustache="walrus", age=48),
    "recipient": dict(type="pale_clerk", sliders={"jaw_wide": -0.5, "chin_out": -0.4, "eyes_big": 0.5,
                                                  "nose_wide": -0.4, "lips_full": -0.3, "face_oval": 0.3},
                      cell="m_fair_brown", hair="side", beard=None, moustache=None, age=28),
}

ORIGINS = sorted({t["origin"] for t in TYPES.values()})
ORIGIN_CELLS = {("african", "f"): ["f_dark_black"], ("african", "m"): ["m_dark_black"],
                ("chinese", "m"): ["m_asian_black"], ("levantine", "m"): ["m_olive_black"]}
BODY_SPREAD = {"weight": 0.35, "muscle": 0.3, "belly": 0.22, "shoulders": 0.25, "hips_wide": 0.25, "buttocks": 0.25,
               "bust": 0.3}


# ---------------------------------------------------------------- the random numbers (the runtime copies this)

def fnv1a32(text):
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


class Rng:
    """mulberry32: a 32-bit generator the C# runtime repeats exactly (uint arithmetic)."""

    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF

    def u32(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return (t ^ (t >> 14)) & 0xFFFFFFFF

    def uniform(self):
        """[0, 1)"""
        return self.u32() / 4294967296.0

    def gauss(self):
        """About normal: the sum of four uniforms, centred and scaled (Irwin-Hall), in -2.45..2.45."""
        return (self.uniform() + self.uniform() + self.uniform() + self.uniform() - 2.0) * 1.7320508

    def pick(self, weights):
        """A key of a {key: weight} dict, in the dict's sorted-key order (None sorts first, as "")."""
        items = sorted(weights.items(), key=lambda kv: "" if kv[0] is None else str(kv[0]))
        total = sum(w for _, w in items)
        r = self.uniform() * total
        for k, w in items:
            r -= w
            if r < 0:
                return k
        return items[-1][0]


def _cells_for(t, sex, age, kind, hair):
    cells = KIND_CELLS.get(kind) or t["cells"]
    if age < 15:
        cells = [c for c in cells if c.startswith("c_")] or cells
        cells = [c for c in cells if (c.startswith("c_girl") == (sex == "f"))] or cells
    elif age >= 58:
        cells = [c for c in cells if c.startswith("om_" if sex == "m" else "of_")] or cells
    else:
        cells = [c for c in cells if c.startswith(sex + "_")] or cells
    bald = [c for c in cells if "bald" in c]
    if hair == "bald":
        cells = bald or cells  # Keep the age/sex group when it has no bald portrait.
    else:
        cells = [c for c in cells if "bald" not in c] or cells
    return cells


def register_hats(kinds):
    """Every authored hat uses fitted hair, preserving explicit hair recipes."""
    for kind in kinds:
        if not kind.hats:
            continue
        style = "undercap" if kind.face.get("sex") == "f" else "capped"
        KIND_HAIR.setdefault(kind.name, {style: 1})
        if kind.name in CAST and style == "capped":
            CAST[kind.name]["hair"] = style


def face_for(seed, kind, sex="m", age=35, origin=None):
    """A person's face from their id (seed, an integer) and kind (build_people.py's name), sex (m/f) and age (years);
    origin narrows the types. Returns dict(type, sliders {slider: value}, age, cell, hair, beard, moustache, crook).
    Order of the draws (the runtime follows it): type, every slider in sliders.SLIDERS order (face, then body), the
    hair, the cell, the beard, the moustache, the crook."""
    if kind in CAST:  # the named cast: one person, one fixed face
        c = CAST[kind]
        s = {x.name: 0.0 for x in sl.SLIDERS}
        s.update(c["sliders"])
        s["face_age"] = round(max(-0.6, min(1.0, (c["age"] - 40) / 35.0)), 3)
        return dict(type=c["type"], sliders=s, age=c["age"], cell=c["cell"], hair=c["hair"], beard=c["beard"],
                    moustache=c["moustache"], crook=c.get("crook", 0.0), kind=kind, seed=0)
    rng = Rng(fnv1a32("%s:%d" % (kind, int(seed))))
    kt = KIND_TYPES.get(kind) or (WIVES if sex == "f" else TOWNSMEN)
    sx = "c" if age < 15 else sex
    cand = {n: w for n, w in kt.items() if TYPES[n]["sex"] in (sx, "b")}
    if origin:
        o = {n: w for n, w in cand.items() if TYPES[n]["origin"] == origin}
        if not o:
            o = {n: 1.0 for n, t in TYPES.items() if t["origin"] == origin and t["sex"] in (sx, "b")}
        cand = o or cand
    if not cand:
        cand = {n: 1.0 for n, t in TYPES.items() if t["sex"] in (sx, "b")}
    tname = rng.pick(cand)
    t = TYPES[tname]
    vals = {}
    for s in sl.SLIDERS:
        if s.group == "face":
            m, sd = t["sliders"].get(s.name, (0.0, DEFAULT_SPREAD))
        else:
            m, sd = t["body"].get(s.name, (0.0, BODY_SPREAD.get(s.name, 0.25)))
        if s.name in ("origin_african", "origin_asian") and s.name not in t["sliders"]:
            m, sd = 0.0, 0.0  # MakeHuman's own origins only where the type is that origin
        if s.name == "eye_fold" and s.name not in t["sliders"]:
            m, sd = 0.0, 0.0
        if s.name == "bust" and sex != "f":
            m, sd = 0.0, 0.0
        g = rng.gauss()
        v = m + sd * g
        lo = 0.0 if s.one_way else -1.0
        vals[s.name] = round(max(lo, min(1.0, v)), 3)
    vals["face_age"] = round(max(-0.6, min(1.0, (age - 40) / 35.0)), 3) if age >= 15 else -0.3
    if age < 15:
        hair = "plaits" if sex == "f" else "crop"
        hair = rng.pick(KIND_HAIR.get(kind) or {hair: 1})
    else:
        hw = KIND_HAIR.get(kind) or {k: v for k, v in t["hair"].items()
                                     if (k in ("bun", "plaits", "coronet", "undercap")) == (sex == "f")}
        hair = rng.pick(hw or ({"bun": 1} if sex == "f" else {"crop": 1}))
    cells = _cells_for(t, sex, age, kind, hair)
    if origin and (origin, sex) in ORIGIN_CELLS and age >= 15:
        cells = ORIGIN_CELLS[(origin, sex)]
    cell = cells[int(rng.uniform() * len(cells)) % len(cells)]
    beard = rng.pick(t["beard"]) if sex == "m" and age >= 18 else None
    mous = rng.pick(t["moustache"]) if sex == "m" and age >= 17 else None
    if beard == "full" and mous is None:
        mous = "walrus"
    crook = round(rng.uniform(), 3) if rng.uniform() < t["extras"].get("crook", 0.0) else 0.0
    return dict(type=tname, sliders=vals, age=age, cell=cell, hair=hair, beard=beard, moustache=mous, crook=crook,
                kind=kind, seed=int(seed))


def distance(a, b):
    """How different two faces look (for re-rolling neighbours): slider distance plus paint and hair."""
    d = sum((a["sliders"].get(k.name, 0) - b["sliders"].get(k.name, 0)) ** 2 for k in sl.SLIDERS
            if k.group == "face") ** 0.5
    d += 1.0 * (a["cell"] != b["cell"]) + 0.6 * (a["hair"] != b["hair"]) + 0.6 * (a["beard"] != b["beard"])
    d += 0.4 * (a["moustache"] != b["moustache"]) + 0.5 * (a["type"] != b["type"])
    return d


def to_json(path, cells_meta):
    """shared/faceTypes.json: everything the runtime needs to give a person the same face as face_for."""
    tests = []
    for kind, seed, sex, age in (("docker_a", 1, "m", 35), ("docker_a", 2, "m", 44), ("fishwife_a", 7, "f", 40),
                                 ("sailor", 12, "m", 30), ("boy", 3, "m", 10), ("old_woman", 5, "f", 70),
                                 ("sweep_boy", 19, "m", 11), ("clerk", 99, "m", 25), ("police", 123456, "m", 38), ("sooi", 0, "m", 52)):
        tests.append(dict(args=dict(seed=seed, kind=kind, sex=sex, age=age), face=face_for(seed, kind, sex, age)))
    out = {
        "about": "Face types for people2 (art-source/tools/blender/people2/face_types.py, docs/people.md 'Faces in the "
                 "game'). A person's face = type + slider values (shared/peopleSliders.json: shape keys of "
                 "<body>_lod0 and <body>_lod1) + a face picture (cells: a layer of the face array) + hair, beard and "
                 "moustache pieces (<body>_hair_<style>, <body>_beard_<style>, <body>_mous_<style>). "
                 "face_for(seed, kind, sex, age) is the reference; 'rng' says how to repeat it; 'tests' are its "
                 "outputs.",
        "sliderOrder": [s.name for s in sl.SLIDERS],
        "rng": {"hash": "FNV-1a 32 of the UTF-8 text '<kind>:<seed>'", "generator": "mulberry32 (face_types.Rng)",
                "uniform": "u32 / 2^32", "gauss": "(4 uniforms summed - 2) * 1.7320508",
                "pick": "weights in key order (none as ''); r = uniform * total; first key where r - w < 0",
                "order": "type (pick over the kind's types allowed for the sex: 'c' under 15, 'b' both); every slider "
                         "in sliderOrder (face sliders: the type's sliders[name] else (0, defaultSpread); body "
                         "sliders: the type's body[name] else (0, bodySpread[name]); origin_* and eye_fold 0 unless "
                         "the type names them; bust 0 for men; value = mean + spread * gauss, clamped to -1..1 (0..1 "
                         "one-way)); face_age set from the age (not drawn: (age-40)/35 clamped -0.6..1, -0.3 under "
                         "15); hair (kindHair[kind], else children: plaits/crop, still one pick; else the type's styles "
                         "for the sex); the cell (floor(uniform * n) over the allowed cells: cellsFor); beard (men "
                         "18+), moustache (men 17+; a full beard forces walrus); the crook (uniform < chance, then "
                         "its size uniform)"},
        "defaultSpread": DEFAULT_SPREAD, "bodySpread": BODY_SPREAD,
        "types": TYPES, "kinds": KIND_TYPES, "kindCells": KIND_CELLS, "kindHair": KIND_HAIR, "cast": CAST,
        "origins": ORIGINS, "originCells": {"%s/%s" % k: v for k, v in ORIGIN_CELLS.items()},
        "cells": cells_meta, "cellOrder": CELL_NAMES, "tests": tests,
    }

    def clean(o):
        if isinstance(o, dict):
            return {("none" if k is None else k): clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        return o
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(out), f, indent=1)

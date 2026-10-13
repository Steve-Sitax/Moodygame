"""C4 wide: named cast and children, Antwerp 1873. Fixed faces remain in face_types.CAST.

Descriptions: services/data/native-rules.json (employers), native-seed.json (roles), shared/faceTypes.json (fixed
cast), build_people.py PEOPLE (authored clothes), PostedPeople.cs (home positions).
Period references and intentional edge exceptions: docs/people.md, C4 wide.
"""
import numpy as np

from . import body as bd, clothes_kit as ck
from .dress import Kind
from . import garments_cast as gc


def make_kind(name, body, age, spec, female=False, held=(), hero=True):
    base, build = {n: (b, v) for n, b, v in bd.BODIES}[body]
    P = bd.params(base, build)

    def dress(fit):
        return gc.women(fit, spec) if female else gc.tailored(fit, spec)

    def covers(p, part):
        x, y, z = p
        if part == "torso":
            return True
        if part == "neck":
            return y < bd.Y(P, 0.81)
        if part.startswith("arm"):
            return y > bd.Y(P, 0.59 if spec.get("rolled") or female else 0.535) + 0.015
        if part.startswith("leg"):
            return y > bd.Y(P, 0.25) if female else y > bd.Y(P, 0.25) if spec.get("breeches") else y > 0.065
        return False

    def skin(ctx):
        if female:
            legs = np.char.startswith(ctx.part, "leg")
            ctx.rgb[legs] = (0.12, 0.11, 0.10)
            if hasattr(ctx, "detail_zone"):
                ctx.detail_zone[legs] = 1
        exposed = ck.starts(ctx.part, ("finger", "arm", "leg"))
        ctx.mul(exposed, (0.94, 0.92, 0.88))
        ck.undershirt(ctx, gc.hexrgb(spec.get("dress", spec.get("coat", spec.get("jersey", spec.get("shirt", 0x4a4034))))),
                      0, covers=covers, skip=("leg",))

    hat = spec.get("hat", "flatcap")
    hats = ("cap", "bonnet_ties") if spec.get("mourning") else ("cap", "cap_frill") if female else (
        "cap", "cap_peak") if hat == "flatcap" else ("cap",) if hat == "knitcap" else ("cap", "cap_brim")
    return Kind(name, "cast", body, face=dict(seed=1873400 + age, sex="f" if female else "m", age=age),
                dress=dress, covers=covers, skin=skin, hats=hats, held=held, hero=hero,
                hands_hard=0.5 if not female else 0.25,
                avoid={"rifle_idle": "no rifle", "rifle_walk": "no rifle", "rifle_talk": "no rifle"},
                note=spec["note"])


PEETERS = make_kind("peeters", "old_woman", 62,
    dict(dress=0x1a1a1c, skirt=0x1c1c1e, collar=0xb8b4a8, shawl=0x222224,
         boots=0x141210, hat_col=0x141416, mourning=True,
         note="Widow Peeters, ship chandler: sober black wool, plain shawl, tied black bonnet, cream collar, account ledger"),
    female=True, held=[("held_ledger", "gripL", "bound chandlery accounts, grip at the spine")])
TUUR = make_kind("tuur", "man_slight", 38,
    dict(jersey=0x28323e, trousers=0x3a362e, boots=0x2a2018, hat="knitcap", hat_col=0x5a2e26,
         note="Tuur, ferryman and night lighter: navy knitted jersey, russet ribbed cap, worn brown trousers, cold pipe"),
    held=[("held_pipe", "gripR", "cold wooden pipe held by the stem")])
FIENTJE = make_kind("fientje", "woman_middling", 30,
    dict(dress=0x6a3428, skirt=0x5a2e26, collar=0xc8c0b0, shawl=0x6a6a5c,
         apron=0x7a8a90, boots=0x2a1e16, hat_col=0xd0cabc,
         note="Fientje, fishwife: russet dress, checked grey shawl, blue-grey apron, linen cap, the shared herring basket"),
    female=True, held=[("held_basket", "hipL", "shared wicker herring basket at the left hip")])
SAILOR = make_kind("sailor", "man_middling", 40,
    dict(coat=0x1e2634, vest=0x242a36, shirt=0xa8a498, trousers=0x242a36, boots=0x1a1612,
         hat="knitcap", hat_col=0x262c38, pea=True, note="Anna Maria sailor: double-breasted navy pea jacket and knitted cap, pale shirt; fixed red hair and chops"))

KINDS = [PEETERS, TUUR, FIENTJE, SAILOR]

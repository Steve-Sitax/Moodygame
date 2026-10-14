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
            return True if female else y > bd.Y(P, 0.25) if spec.get("breeches") else True
        return False

    def skin(ctx):
        if female:
            legs = np.char.startswith(ctx.part, "leg")
            ctx.rgb[legs] = (0.12, 0.11, 0.10)
            if hasattr(ctx, "detail_zone"):
                ctx.detail_zone[legs] = 1
        exposed = ck.starts(ctx.part, ("finger", "arm", "leg"))
        ctx.mul(exposed, (0.94, 0.92, 0.88))
        if spec.get("barefoot"):
            dirt = gc.sm(0.13, 0.025, ctx.y) * exposed
            speckle = 0.6 + 0.4 * np.sin(ctx.x * 240 + ctx.z * 310) ** 2
            ctx.mix(dirt * speckle * 0.45, (0.28, 0.21, 0.14))
        if spec.get("gloves"):
            hands = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
            ctx.rgb[hands] = gc.hexrgb(spec["gloves"])
            if hasattr(ctx, "detail_zone"):
                ctx.detail_zone[hands] = 4
        ck.undershirt(ctx, gc.hexrgb(spec.get("dress", spec.get("coat", spec.get("jersey", spec.get("shirt", 0x4a4034))))),
                      0, covers=covers, skip=("leg", "neck"))

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

SAILOR_B = make_kind("sailor_b", "man_middling", 44,
    dict(coat=0x6a5a2e, shirt=0xa8a498, trousers=0x2a2e36, boots=0x1a1612,
         hat="souwester", hat_col=0x6a5a2e, oilskin=True, long=0.36,
         note="Working quay sailor: ochre oiled-canvas coat, sou'wester with long neck brim, dark trousers, sea boots"), hero=False)
STRANGER = make_kind("stranger", "man_slight", 40,
    dict(coat=0x1a1a1e, shirt=0xd4d0c4, vest=0x4a4a4e, trousers=0x2a2a2e, boots=0x0e0e10,
         hat="tophat", hat_col=0x121214, kerchief=0x121214, long=0.31, chain=True, gloves=0x3a3a3c,
         wear=0.15, dust=0.03,
         note="The stranger: black knee-length frock coat, silk top hat, grey waistcoat, black cravat, gloves, watch chain"))
THIEF = make_kind("thief", "man_slight", 23,
    dict(coat=0x26241f, shirt=0x6a6458, vest=0x2e2a24, trousers=0x2e2a24, boots=0x1e1814,
         hat_col=0x1a1a18, kerchief=0x3a3a36, wear=0.9, dust=0.4, patched=True,
         note="Young quay thief: dark worn short jacket, grey neckerchief, black flat cap, mismatched repairs and muddy hems"))
FOREMAN = make_kind("foreman", "man_stout", 49,
    dict(coat=0x4e4234, shirt=0xc0baa8, vest=0x3a3026, trousers=0x36322c, boots=0x1c1612,
         hat="bowler", hat_col=0x161412, long=0.36, chain=True, wear=0.4,
         note="Natie foreman: brown long coat, brown waistcoat and watch chain, black bowler; fixed moustached face"))

RECIPIENT = make_kind("recipient", "man_middling", 28,
    dict(coat=0x343a46, shirt=0xbab4a4, vest=0x3a3e44, trousers=0x3a3a3c, boots=0x221a14,
         hat_col=0x3a3a36, wear=0.3,
         note="Delivery recipient: blue-grey open sack coat, dark waistcoat, cream shirt and grey flat cap; fixed young clean face"))
BOY = make_kind("boy", "child_middling", 11,
    dict(coat=0x4a4034, shirt=0x8a8274, vest=0x3a3630, trousers=0x3a3630,
         hat_col=0x3a3a36, barefoot=True, breeches=True, patched=True, wear=0.8,
         note="Street boy: short repaired brown jacket, grey shirt, knee breeches, flat cap, bare dirty feet"), hero=False)
URCHIN = make_kind("urchin", "child_slight", 9,
    dict(shirt=0x8a7e66, shirt_only=True, rolled=True, trousers=0x4a4032,
         hat_col=0x5a4a36, barefoot=True, breeches=True, wear=0.9,
         note="Small street urchin: worn linen shirt with rolled sleeves, brown knee breeches, oversized brown flat cap, bare feet"), hero=False)
OLD_MAN = make_kind("old_man", "old_man", 72,
    dict(coat=0x6a4632, shirt=0xa8a090, vest=0x3a342a, trousers=0x3e3a32, boots=0x221a12,
         hat_col=0x4a463e, kerchief=0x3a3634, long=0.32, wear=0.8, patched=True,
         note="Old town man: stooped body, worn long rust-brown coat, grey scarf and flat cap, blackthorn walking stick"),
    hero=False, held=[("held_cane", "gripR", "blackthorn stick with rounded knob and metal ferrule")])

KINDS = [PEETERS, TUUR, FIENTJE, SAILOR, SAILOR_B, STRANGER, THIEF, FOREMAN,
         RECIPIENT, BOY, URCHIN, OLD_MAN]

"""C-wide uniforms and gentry, Antwerp autumn 1873. Sources: docs/people.md.

The customs green palette and infantry rank/facing details remain reconstructions;
no unverified Belgian regulation is presented as evidence.
"""
from functools import partial
import numpy as np
from . import body as bd, clothes_kit as ck
from .dress import Kind
from . import garments_uniform as g, held_uniform

held_uniform.register()


def covers(p, part, build="middling", rolled=False):
    P = bd.params("man", build)
    if part == "torso" or part.startswith("leg"):
        return True
    if part == "neck":
        return p[1] < bd.Y(P, .847)
    if part.startswith("arm"):
        return p[1] > bd.Y(P, .60 if rolled else .499) + .022
    return False


def skin(ctx, colour, cover):
    ck.undershirt(ctx, colour, 0, zone=1, covers=cover)


def checked_dress(dress, fit):
    pieces = dress(fit)
    names = [pc.name for pc in pieces]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate garment name would alias painted UV groups")
    for pc in pieces:
        if not np.isfinite(np.asarray(pc.V)).all():
            raise ValueError("Non-finite garment geometry: " + pc.name)
        if any(not w or not all(np.isfinite(v) and v >= 0 for v in w.values()) for w in pc.W):
            raise ValueError("Invalid garment bone weights: " + pc.name)
    return pieces


def make(name, age, dress, build="middling", rolled=False, hats=(), held=(), note=""):
    cover = partial(covers, build=build, rolled=rolled)
    k = Kind(name, "uniform", "man_" + build, face=dict(seed=1873300 + len(KINDS), sex="m", age=age),
             dress=partial(checked_dress, dress), covers=cover,
             skin=partial(skin, colour=g.LINEN if rolled else g.BLACK if name == "priest" else g.NAVY, cover=cover),
             hats=hats, held=held, note=note,
             avoid={"walk_f": "male civilian or infantryman", "talk_f": "male voice gestures"})
    k.near_budget, k.far_budget = 14000, 2500
    KINDS.append(k)
    return k


KINDS = []
SHAKO = ("shako", "peak", "pompom", "shako_plate")
BAYONET = [("held_bayonet_scabbard", "hipL", "sheathed bayonet hanging from the left belt")]
make("soldier", 23, g.dress_soldier, hats=SHAKO, held=BAYONET,
     note="Belgian line infantry private walking out; blue tunic, red facings, blue-grey trousers, shako and pompom")
make("soldier_b", 30, partial(g.dress_soldier, corporal=True), hats=SHAKO, held=BAYONET,
     note="line infantry corporal; two red forearm chevrons, otherwise the private's kit; rank detail reconstructed")
make("sentry", 24, partial(g.dress_soldier, sentry=True), hats=SHAKO,
     held=[("held_rifle", "handR", "Albini-Braendlin M1853/1867; hand socket fitted to D3 palm frame, fixed bayonet")],
     note="garrison sentry; cartridge pouches and one separate rifle on handR; remains visible in rifle work clips")
make("customs", 49, g.dress_customs, hats=("kepi", "peak"),
     held=[("held_sabre", "hipL", "sabre in scabbard"), ("held_scabbard", "hipL", "belt frog"),
           ("held_book", "gripL", "port ledger; one book model also used as the priest's breviary")],
     note="port douanier; green tunic and kepi retained from original design; Belgian 1873 colour unconfirmed")
make("priest", 54, g.dress_priest, hats=("hat", "hat_brim"),
     held=[("held_book", "gripL", "leather breviary")], note="Catholic priest: ankle cassock, sash, broad low round hat")
make("gentleman", 55, partial(g.dress_civilian, role="gentleman"), hats=("hat", "hat_brim"),
     held=[("held_cane", "gripR", "rounded dark hardwood walking cane with ferrule")],
     note="black frock coat with lapels, top hat, checked trousers and cane")
make("clerk", 24, partial(g.dress_civilian, role="clerk"), build="slight", hats=("hat", "hat_brim"),
     note="young pale clerk; dark grey coat, linen collar, black tie and bowler")
make("tourist", 46, partial(g.dress_civilian, role="tourist"), hats=("hat", "hat_brim"),
     held=[("held_cane", "gripR", "the same walking cane as the gentleman")],
     note="visitor in a brown travelling coat and felt bowler")
make("shopkeeper", 48, partial(g.dress_civilian, role="shopkeeper"), rolled=True, hats=("cap", "cap_peak"),
     note="grey waistcoat, rolled linen sleeves, low cloth cap, brown working apron with seated lap weights")
make("publican", 47, partial(g.dress_civilian, role="publican"), build="stout", rolled=True,
     note="stout publican; red waistcoat, rolled sleeves, stained linen apron; no hat")
make("baker", 38, partial(g.dress_civilian, role="baker"), rolled=True, hats=("cap", "cap_peak"),
     note="baker; flour-marked linen, soft white cap, rolled sleeves and long apron with seated lap weights")

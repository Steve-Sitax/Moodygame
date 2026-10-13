"""The remaining twelve working people of the quays, markets and streets, 1873.

Old-kind colours are preserved; occupations determine cut, material and grime.
Faces stay selected by KIND_TYPES and stable resident ids in the common face kit.
"""
from . import body as bd, clothes_kit as ck
from .dress import Kind
from . import garments_workers as gw
from . import held_workers

PROFILES = {
 "docker_b": dict(body="man_stout",age=48,kiel=True,shirt=0x3a4a62,trousers=0x3e3a30,kerchief=0x2e2c2a,hat_col=0x222220),
 "docker_c": dict(body="man_middling",age=28,shirt=0xa8a090,vest=0x3a3228,rolled=True,pad=True,trousers=0x4a4236,hat="knit",hat_col=0x4a4640),
 "docker_sack": dict(body="man_middling",age=37,kiel=True,shirt=0x35465c,trousers=0x3a342c,hat_col=0x2e2a26),
 "porter": dict(body="man_middling",age=57,coat="short",coat_col=0x3a3a34,shirt=0xb0a898,vest=0x5a4a3a,trousers=0x36322c,badge=True,hat_col=0x2a2a28),
 "carter": dict(body="man_middling",age=42,shirt=0x3a3a30,rolled=True,trousers=0x44403a,kerchief=0x6a5a3a,hat_col=0x4a4238),
 "coalman": dict(body="man_stout",age=38,kiel=True,shirt=0x2a2a2a,trousers=0x222222,hat="hood",soot=.72,kerchief=0x2a2622,boots=0x141210),
 "grinder": dict(body="man_middling",age=54,coat="short",coat_col=0x5a4632,shirt=0x9a9282,trousers=0x4a4236,hat="bowler",hat_col=0x3a3026,apron="leather",kerchief=0x6a2a22),
}


def make_kind(name,p,seed):
    base={n:(bb,bl) for n,bb,bl in bd.BODIES}[p["body"]]
    P=bd.params(*base)
    profile=dict(p)
    def dress(fit):
        return gw.clothing(fit,profile)
    def covers(q,part):
        x,y,z=q
        if part=="torso":
            return True
        if part=="neck":
            return y<bd.Y(P,.838)
        if part.startswith("arm"):
            return y>bd.Y(P,.60 if p.get("rolled") else .54)
        if part.startswith("leg"):
            return y>.10 if p.get("barefoot") else True
        return False
    def skin(ctx):
        hand=ck.starts(ctx.part,("finger","arm")) & (ctx.y<bd.Y(ctx.P,.58))
        if p.get("soot"):
            ctx.mix(hand*.6,(.15,.13,.11))
        else:
            ctx.mul(hand,(.91,.88,.84))
        if p.get("flour"):
            ctx.mix(hand*.28,(.78,.74,.65))
        if p.get("barefoot"):
            foot=ck.starts(ctx.part,("leg",)) & (ctx.y<.13)
            ctx.mul(foot,(.72,.69,.64))
        ck.undershirt(ctx,ck.hexrgb(p["shirt"]),bd.Y(ctx.P,.815))
    held=[]
    if name in ("sweep","sweep_boy"):
        held=[("held_chimney_brush","back","shared chimney rods, radial brush and rope coil over the left shoulder")]
    note="; ".join([name.replace("_"," "),"fitted period workwear, closed hems, occupational wear"])
    if name in held_workers.SHARED:
        note += "; " + held_workers.SHARED[name][2]
    k=Kind(name,"workers",p["body"],face=dict(seed=seed,sex="m",age=p["age"]),
           dress=dress,covers=covers,skin=skin,hats=("sack_hood",) if p.get("hat")=="hood" else ("cap","cap_peak"),
           held=held,hands_hard=.8 if not P["child"] else .35,note=note)
    k.build=gw.build_kind
    k.barefoot=p.get("barefoot",False)
    return k


KINDS=[make_kind(n,p,1873100+i) for i,(n,p) in enumerate(PROFILES.items())]

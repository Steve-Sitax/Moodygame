"""Adapt C4's reducer to batch 1's reduce-before-unwrap clothing pipeline.

The original garment and prop modules remain unchanged. Only the cast uses its
authored reducer and clearance exception; all painting, UVs, relief and normals
still pass through the merged shared pipeline.
"""
from . import clothes_build as cb, clothes_kit as ck, dress, garments_cast as gc


def build(kind, make_body, ref_uv, layout, atl, tex, base_body):
    face = dress.face_of(kind, base_body["P"])
    parts = base_body["counts"]["pieces"]
    reserve = [0, 0]
    for level in (0, 1):
        for prefix, style in (("hair", face.get("hair")), ("beard", face.get("beard")),
                              ("mous", face.get("moustache"))):
            if kind.hero:
                reserve[level] += parts.get(f"{prefix}_{style}_lod{level}", 0) if style else 0
            else:
                reserve[level] += max((v for k, v in parts.items()
                                       if k.startswith(prefix + "_") and k.endswith(f"_lod{level}")), default=0)
    old = dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR, cb.reduce, ck.clear_layers, cb.tuck
    try:
        dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR = 16000-reserve[0], 14000-reserve[0], 2500-reserve[1]
        cb.reduce = lambda ob, budget, **kwargs: gc.reduce_cast(ob, budget)
        # These disconnected fitted seams already carry C4's authored ease.
        ck.clear_layers = lambda *args, **kwargs: 0
        cb.tuck = lambda *args, **kwargs: 0
        return dress.build(kind, make_body, ref_uv, layout, atl, tex=tex)
    finally:
        dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR, cb.reduce, ck.clear_layers, cb.tuck = old

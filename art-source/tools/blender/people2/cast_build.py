"""Adapt C4's reducer to batch 1's reduce-before-unwrap clothing pipeline.

The original garment and prop modules remain unchanged. Only the cast uses its
authored reducer and clearance exception; all painting, UVs, relief and normals
still pass through the merged shared pipeline.
"""
from . import clothes_build as cb, clothes_kit as ck, dress, garments_cast as gc


def build(kind, make_body, ref_uv, layout, atl, tex, base_body):
    # Use the shared body-and-clothes budget. Hair is a separate reusable mesh,
    # as for the worker and women families; reserving every worst-case hair piece
    # here reduced a complete coat to a few hundred triangles.
    old = cb.reduce, ck.clear_layers, cb.tuck
    shared_reduce = cb.reduce
    try:
        cb.reduce = lambda ob, budget, **kwargs: (gc.reduce_cast(ob, budget)
            if ob.name.endswith('_lod1') else shared_reduce(ob, budget, **kwargs))
        # These disconnected fitted seams already carry C4's authored ease.
        ck.clear_layers = lambda *args, **kwargs: 0
        cb.tuck = lambda *args, **kwargs: 0
        return dress.build(kind, make_body, ref_uv, layout, atl, tex=tex)
    finally:
        cb.reduce, ck.clear_layers, cb.tuck = old

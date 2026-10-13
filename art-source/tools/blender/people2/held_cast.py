"""Cast socket props, one mesh per object. Closed rounded wood/leather/paper geometry.

Grip origins use the kit's +y handle frame. The thin page lips intentionally keep
their sheet edges; all leather covers and wooden bowls are rounded by subdivision.
"""
import numpy as np

from . import clothes_kit as ck
from .clothes_kit import Cloth
from .held import sweep


def pages(ctx):
    line = 0.5 + 0.5 * np.cos(ctx.y * 3500)
    ctx.mul(line, 0.88)
    ctx.bump(line, 0.00008)


def ledger():
    cover = ck.Piece("ledger_cover", Cloth((0.16, 0.11, 0.07), "leather", wear=0.65, folds=0), scale=1.4)
    paper = ck.Piece("ledger_pages", Cloth((0.64, 0.58, 0.44), "linen", wear=0.1, folds=0, extra=pages))
    # Rounded rectangular tubes, closed ends, covers with their own thickness.
    for z in (-0.016, 0.016):
        ck.loft_z(cover, [(z - 0.002, 0.09, -0.03, 0.23, 0), (z, 0.09, -0.03, 0.23, 0),
                         (z + 0.002, 0.09, -0.03, 0.23, 0)],
                  16, lambda p: {}, power=8)
    ck.loft_z(paper, [(-0.012, 0.084, -0.023, 0.223, 0), (0, 0.084, -0.023, 0.223, 0),
                     (0.012, 0.084, -0.023, 0.223, 0)],
              16, lambda p: {}, power=8)
    sweep(cover, [(-0.089, -0.025, -0.014), (-0.089, 0.10, -0.014), (-0.089, 0.225, -0.014)],
          0.005, 0.017, 8)
    cover.orient(lambda q: q - np.array((0, 0.10, 0)))
    paper.orient(lambda q: q - np.array((0, 0.10, 0)))
    return [cover, paper]


def pipe():
    wood = ck.Piece("pipe_bowl", Cloth((0.28, 0.12, 0.045), "wood", wear=0.65, folds=0), scale=1.4)
    stem = ck.Piece("pipe_stem", Cloth((0.065, 0.045, 0.025), "wood", wear=0.5, folds=0), scale=1.4)
    sweep(stem, [(0, -0.015, 0), (0, 0.025, 0), (0, 0.08, -0.005), (0, 0.13, -0.018)], 0.005, 0.004, 8)
    outer = sweep(wood, [(0, 0.14, -0.018), (0, 0.14, -0.045), (0, 0.14, -0.065)],
          [0.012, 0.020, 0.018], [0.012, 0.020, 0.018], 12, caps=(True, False))
    # Bowl inner wall and floor, rather than a solid top disc.
    start = len(wood.F)
    inner = sweep(wood, [(0, 0.14, -0.065), (0, 0.14, -0.058), (0, 0.14, -0.046)],
          [0.014, 0.013, 0.007], [0.014, 0.013, 0.007], 12, caps=(False, True))
    for i in range(start, len(wood.F)):
        wood.F[i] = tuple(reversed(wood.F[i]))
    start = len(wood.F)
    for j in range(12):
        wood.face((outer[-1, j], outer[-1, (j + 1) % 12], inner[0, (j + 1) % 12], inner[0, j]))
    wood.orient((0, 0, -1), start=start)
    return [wood, stem]


def cane():
    pc = ck.Piece("cane_wood", Cloth((0.22, 0.13, 0.06), "wood", wear=0.65, mud=0.4, folds=0), scale=1.2)
    tip = ck.Piece("cane_ferrule", Cloth((0.22, 0.23, 0.24), "metal", wear=0.6, folds=0))
    sweep(pc, [(0, -0.025, 0), (0, 0.08, 0), (0, 0.35, 0.008), (0, 0.70, 0.015)],
          [0.018, 0.013, 0.011, 0.009], [0.017, 0.012, 0.010, 0.009], 12)
    sweep(tip, [(0, 0.695, 0.015), (0, 0.72, 0.015)], 0.010, 0.010, 12)
    return [pc, tip]


MODELS = {"held_ledger": ledger, "held_pipe": pipe, "held_cane": cane}


def register():
    from . import held
    held.MODELS.update(MODELS)


def json_all(kinds):
    from . import held
    metadata = held.json_all(kinds)
    metadata["grips"].update({"held_ledger": "leather spine 3.2 cm", "held_pipe": "wood stem 1 cm",
                              "held_cane": "wood knob 3.5 cm"})
    return metadata

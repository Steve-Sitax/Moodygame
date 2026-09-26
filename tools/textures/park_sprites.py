"""Leaf and reed cards for the Stadspark's plants from a Codex sprite sheet (the park pass, 2026-09-26).

Codex draws the clusters on a flat magenta ground in a grid (assets/ATTRIBUTION.md). This keys the magenta out,
takes the pink fringe off the edges, cuts the grid into its cells, fits each one into a 64 x 64 card (its foot on
the card's bottom, as the painted cells of tools/blender/build_trees.py stand) and writes them side by side into
one RGBA strip that tools/blender/build_park_plants.py pastes into its leaf atlas. Alpha is 0 or 1 (the game tests
it at 0.5).

    python tools/textures/park_sprites.py <sheet.png> <out.png> <cols> <rows> [fit]

fit = "foot" (default: the content's bottom on the card's bottom, centred) or "fill" (the whole cell, squashed).

    tools/blender/art/park_foliage.png   from the foliage sheet: 4 2 (foot)
    tools/blender/art/park_reeds.png     from the reed sheet: 4 1 (foot)
    tools/blender/art/park_lilies.png    from the lily pads: 2 2 fill, only the first card kept (a 64 px crop)
"""
import sys

import numpy as np
from PIL import Image

CELL = 64


def key(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mag = np.minimum(r, b) - g  # how magenta a pixel is
    bg = (mag > 90) & (r > 140) & (b > 140)
    return ~bg, mag


def main(src, out, cols, rows, fit="foot"):
    cols, rows = int(cols), int(rows)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W = im.shape[:2]
    fg, mag = key(im)
    # the fringe: pixels on the edge that still carry some pink lose it
    fringe = fg & (mag > 25)
    lim = im[..., 1] + 25
    im[..., 0] = np.where(fringe, np.minimum(im[..., 0], lim), im[..., 0])
    im[..., 2] = np.where(fringe, np.minimum(im[..., 2], lim), im[..., 2])
    cells = []
    for rw in range(rows):
        for cl in range(cols):
            x0, x1 = W * cl // cols, W * (cl + 1) // cols
            y0, y1 = H * rw // rows, H * (rw + 1) // rows
            c = im[y0:y1, x0:x1]
            a = fg[y0:y1, x0:x1].astype(np.float32)
            ys, xs = np.nonzero(a > 0)
            if len(xs) == 0:
                cells.append(np.zeros((CELL, CELL, 4), np.uint8))
                continue
            if fit == "foot":
                # a square round the content, its foot on the bottom
                bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
                side = max(bx1 - bx0, by1 - by0) + 4
                cx = (bx0 + bx1) // 2
                sx0 = cx - side // 2
                sy0 = by1 + 2 - side
                pad = np.zeros((side, side, 4), np.float32)
                for yy in range(side):
                    y = sy0 + yy
                    if not 0 <= y < c.shape[0]:
                        continue
                    xa, xb = max(sx0, 0), min(sx0 + side, c.shape[1])
                    pad[yy, xa - sx0:xb - sx0, :3] = c[y, xa:xb]
                    pad[yy, xa - sx0:xb - sx0, 3] = a[y, xa:xb]
            else:
                pad = np.dstack([c, a])
            # premultiplied area resize, then alpha cut at a half
            pm = pad.copy()
            pm[..., :3] *= pm[..., 3:4]
            small = np.asarray(Image.fromarray(pm[..., :3].clip(0, 255).astype(np.uint8)).resize((CELL, CELL), Image.BOX)).astype(np.float32)
            al = np.asarray(Image.fromarray((pm[..., 3] * 255).astype(np.uint8)).resize((CELL, CELL), Image.BOX)).astype(np.float32) / 255
            col = small / np.maximum(al[..., None], 1e-3)
            cut = (al >= 0.5).astype(np.float32)
            cell = np.dstack([col.clip(0, 255) * cut[..., None], cut * 255]).astype(np.uint8)
            # (the card's outer pixel row stays empty: nearest sampling at the edge must not wrap into the next cell)
            cell[0, :, 3] = cell[-1, :, 3] = cell[:, 0, 3] = cell[:, -1, 3] = 0
            cells.append(cell)
    strip = np.concatenate(cells, axis=1)
    Image.fromarray(strip, "RGBA").save(out)
    print(f"[park_sprites] {src}: {len(cells)} cards -> {out} ({strip.shape[1]} x {strip.shape[0]})")


if __name__ == "__main__":
    main(*sys.argv[1:])

"""The Stadspark's ground pictures and their height maps (the park pass, 2026-09-26).

The lawn with fallen leaves, the gravel of the paths and the trodden mud at their edges are pictures made with
Codex image generation (assets/ATTRIBUTION.md). The ground shader (client/src/retro/psx.ts, relief) wants a height
map that lines up with each picture; here it comes from the picture's own light and dark (a leaf or a pebble is
lighter than the grass or the mud round it and lies on top; a footprint or a puddle is darker and lies low), with
the large soft shading taken out first so a lighter patch does not become a hill. All filtering wraps round, so
the maps tile as the pictures do. The picture's edges are blended over a narrow band so any seam Codex left is
gone (the same blend in the colour and in the height).

    python tools/textures/park_maps.py <picture.png> <out folder> <name> [size]

writes <name>.jpg (the colour, `size` px, default 1024) and <name>_h.png (512 px) into the out folder.
"""
import sys

import cv2
import numpy as np


def seamless(im, band):
    """No seam: the picture over a copy of itself shifted by half, the copy showing only in a band along the edges
    (where it is whole: its own seam lies in the middle, under the picture)."""
    h, w = im.shape[:2]
    rolled = np.roll(np.roll(im, h // 2, axis=0), w // 2, axis=1)

    def ramp(n):
        x = np.arange(n, dtype=np.float32)
        d = np.minimum(x, n - 1 - x) / band
        d = np.clip(d, 0, 1)
        return d * d * (3 - 2 * d)

    wgt = (ramp(h)[:, None] * ramp(w)[None, :])[..., None]
    return im * wgt + rolled * (1 - wgt)


def wrap_blur(g, sigma):
    """A Gaussian blur that wraps round the edges (the picture tiles)."""
    pad = int(sigma * 3) + 1
    big = np.pad(g, pad, mode="wrap")
    return cv2.GaussianBlur(big, (0, 0), sigma)[pad:-pad, pad:-pad]


def main(src, out, name, size="1024"):
    size = int(size)
    im = cv2.imread(src, cv2.IMREAD_COLOR).astype(np.float32)
    h0, w0 = im.shape[:2]
    s = min(h0, w0)
    im = im[(h0 - s) // 2:(h0 - s) // 2 + s, (w0 - s) // 2:(w0 - s) // 2 + s]
    im = cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA)
    im = seamless(im, max(8, size // 48))
    cv2.imwrite(f"{out}/{name}.jpg", np.clip(im, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    # height: the picture's light, the soft shading taken out, a little softened, stretched to 0..1
    N = 512
    g = cv2.resize(cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32), (N, N), interpolation=cv2.INTER_AREA)
    big = wrap_blur(g, 24)
    hp = g - big
    hp = wrap_blur(hp, 1.0)
    lo, hi = np.percentile(hp, 2), np.percentile(hp, 98)
    hmap = np.clip((hp - lo) / max(hi - lo, 1e-3), 0, 1)
    cv2.imwrite(f"{out}/{name}_h.png", (hmap * 255).astype(np.uint8))
    print(f"[park_maps] {name}: {src} -> {out}/{name}.jpg ({size} px), {name}_h.png ({N} px)")


if __name__ == "__main__":
    main(*sys.argv[1:])

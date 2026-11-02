"""The churchyard walks' own compacted gravel (#228: the park's gravel relief, halved, still drew parallel ridges at low
angles). One tile is 1.3 m of walk (the walks' uv: world metres / 1.3), 1024 pixels: 1.27 mm a pixel.
    python churchyard_gravel.py <out folder>        (churchyard.py calls it)
Writes gravel.png (colour) and gravel-height.png (relief): Scheldt and Meuse river gravel and crushed blue stone, 5 to 20 mm
(a few 25 mm), rolled into a matrix of grit and lime-sand dust: rounded and flat-sided stones lying every way, packed edge to
edge, each its own colour (blue-grey limestone, ochre and brown flint, a dark stone, now and then white quartz), the matrix
showing between them; the tops of the stones a little paler (rubbed by feet), the hollows darker with dust. No direction
anywhere: the stones are placed by a jittered grid and turned at random, and the picture tiles without a seam.
"""
import sys, pathlib
import numpy as np
from PIL import Image

N = 1024
PX = 1.3 / N                       # metres a pixel


def tile_noise(rng, n, cells):
    """Smooth value noise that tiles: a random grid of cells x cells, bicubic up to n (wrapped)."""
    g = rng.random((cells, cells))
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int); f = x - i0
    w = f * f * (3 - 2 * f)
    a = g[np.ix_(i0 % cells, i0 % cells)]; b = g[np.ix_((i0 + 1) % cells, i0 % cells)]
    c = g[np.ix_(i0 % cells, (i0 + 1) % cells)]; d = g[np.ix_((i0 + 1) % cells, (i0 + 1) % cells)]
    wx = w[:, None]; wy = w[None, :]
    return (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy


def make(out):
    out = pathlib.Path(out)
    rng = np.random.default_rng(1786)
    # (colours as the picture stores them, sRGB)
    # the matrix: grit and lime-sand dust, a fine speckle over a slow drift
    drift = tile_noise(rng, N, 8) * 0.6 + tile_noise(rng, N, 32) * 0.4
    grit = rng.random((N, N))
    col = np.empty((N, N, 3))
    base = np.array([0.33, 0.30, 0.255])
    col[:] = base
    col *= (0.82 + 0.3 * drift)[..., None] * (0.9 + 0.2 * grit)[..., None]
    height = 0.18 + 0.08 * drift + 0.05 * grit
    top = height.copy()
    # the stones: a jittered grid (no rows: each cell's stone anywhere in it, sizes mixed), drawn smallest last so they
    # sit in the gaps between the big ones
    palette = np.array([
        (0.42, 0.42, 0.43), (0.36, 0.37, 0.39), (0.30, 0.31, 0.33),      # blue-grey limestone
        (0.52, 0.42, 0.29), (0.47, 0.36, 0.25), (0.40, 0.30, 0.22),      # ochre and brown flint
        (0.24, 0.22, 0.21),                                              # a dark stone
        (0.60, 0.58, 0.53),                                              # white quartz (rare)
    ])
    weights = np.array([0.18, 0.18, 0.12, 0.14, 0.14, 0.12, 0.08, 0.04]); weights /= weights.sum()
    stones = []
    for cell in (14, 9, 6):                              # pixels a cell: big, middle and small stones
        k = N // cell
        for i in range(k):
            for j in range(k):
                if rng.random() < 0.12: continue        # (the matrix shows through here and there)
                cx, cy = (i + rng.random()) * cell, (j + rng.random()) * cell
                r = {14: rng.uniform(5.5, 9.5), 9: rng.uniform(3.6, 5.8), 6: rng.uniform(2.2, 3.8)}[cell]
                if rng.random() < 0.015 and cell == 14: r *= 1.35          # a few 25 mm stones
                stones.append((cx, cy, r, cell))
    order = sorted(range(len(stones)), key=lambda s: -stones[s][2])
    yy, xx = np.mgrid[-14:15, -14:15].astype(float)
    for s in order:
        cx, cy, r, cell = stones[s]
        ang = rng.uniform(0, np.pi); flat = rng.uniform(0.55, 0.95); lump = rng.uniform(0.5, 1.0)
        c = palette[rng.choice(len(palette), p=weights)] * rng.uniform(0.85, 1.12)
        x0, y0 = int(np.floor(cx)), int(np.floor(cy))
        dx, dy = xx - (cx - x0), yy - (cy - y0)
        ca, sa = np.cos(ang), np.sin(ang)
        u = (ca * dx + sa * dy) / r; v = (-sa * dx + ca * dy) / (r * flat)
        # (a pebble's outline: an ellipse with its rim pushed in and out a little)
        th = np.arctan2(v, u)
        rim = 1 + 0.08 * np.sin(3 * th + rng.uniform(0, 6.3)) + 0.05 * np.sin(5 * th + rng.uniform(0, 6.3))
        d2 = (u * u + v * v) / (rim * rim)
        inside = d2 < 1
        if not inside.any(): continue
        dome = np.sqrt(np.clip(1 - d2, 0, 1))
        h = 0.32 + 0.55 * lump * dome ** 0.8 * min(1.0, r / 7.0) ** 0.4
        ys = (y0 + yy.astype(int)) % N; xs = (x0 + xx.astype(int)) % N
        cur = top[ys, xs]
        win = inside & (h > cur)
        if not win.any(): continue
        top[ys[win], xs[win]] = h[win]
        # each stone's own colour: its top a little paler, rubbed; a dark rim where the dust lies against it
        shade = (0.86 + 0.22 * dome) * (1 - 0.35 * np.clip((d2 - 0.75) / 0.25, 0, 1))
        cc = c[None, None, :] * shade[..., None]
        col[ys[win], xs[win]] = cc[win]
    height = top
    # dust in the hollows between the stones: a little darker and browner where the height is low
    low = np.clip((0.3 - height) / 0.15, 0, 1)
    col = col * (1 - 0.25 * low)[..., None] + np.array([0.2, 0.17, 0.13]) * (0.25 * low)[..., None]
    # a walk trodden for a century: a film of its own dust over every stone, the colours quieter
    lum = col.mean(-1, keepdims=True)
    col = col * 0.6 + lum * 0.4
    col = col * 0.78 + np.array([0.34, 0.31, 0.27]) * 0.22
    # (the overall tone near the park gravel's, 0.39 0.34 0.27: the walks keep their place in the yard's light)
    col *= (np.array([0.39, 0.34, 0.275]) / col.reshape(-1, 3).mean(0))[None, None, :]
    h = (height - height.min()) / (height.max() - height.min())
    Image.fromarray((np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out / 'gravel.png')
    Image.fromarray((h * 255 + 0.5).astype(np.uint8)).save(out / 'gravel-height.png')
    return len(stones)


if __name__ == '__main__':
    print(make(sys.argv[1]), 'stones')

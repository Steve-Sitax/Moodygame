"""Tileable cloth, rope and stone pictures for the washing lines, the horse trough and the cellar hatch (#149 #160 #164).
numpy only; each painter returns an (h, w, 3) sRGB array, row 0 at the top. Our own work."""

import math

import numpy as np


def rng_(seed):
    return np.random.default_rng(seed)


def tnoise(h, w, nx, ny, rng):
    """Smooth value noise that tiles: nx by ny cells across the picture (periodic in both directions)."""
    g = rng.random((ny, nx)).astype(np.float32)
    x = np.arange(w, dtype=np.float32) * nx / w
    y = np.arange(h, dtype=np.float32) * ny / h
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % nx
    y1 = (y0 + 1) % ny
    x0 %= nx
    y0 %= ny
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def tfbm(h, w, nx, ny, seed, octaves=4, gain=0.5):
    rng = rng_(seed)
    out = np.zeros((h, w), np.float32)
    amp = tot = 0.0
    amp = 1.0
    for o in range(octaves):
        out += amp * tnoise(h, w, nx * 2 ** o, ny * 2 ** o, rng)
        tot += amp
        amp *= gain
    return out / tot


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def weave(h, w, threads_x, threads_y, seed, twill=0):
    """A woven surface's light and shade (about 1): threads across and along, each over-and-under (plain weave), or
    a diagonal twill (twill = 2 or 3); slubs: some threads thicker or lighter along their length."""
    rng = rng_(seed)
    X = (np.arange(w, dtype=np.float32) + 0.5) * threads_x / w
    Y = (np.arange(h, dtype=np.float32) + 0.5) * threads_y / h
    XX, YY = np.meshgrid(X, Y)
    ix = np.floor(XX).astype(int)
    iy = np.floor(YY).astype(int)
    fx = XX - ix
    fy = YY - iy
    if twill:
        over = ((ix + iy) % twill) == 0
    else:
        over = ((ix + iy) % 2) == 0
    # each thread rounded across its width
    warp = 0.55 + 0.45 * np.sin(fx * math.pi)
    weft = 0.55 + 0.45 * np.sin(fy * math.pi)
    k = np.where(over, warp, weft)
    # slubs: a thread's thickness and tone along it
    sx = rng.normal(0, 1, threads_x).astype(np.float32)
    sy = rng.normal(0, 1, threads_y).astype(np.float32)
    along = tnoise(h, w, max(1, threads_x // 40), 6, rng)
    slub = np.where(over, sx[ix % threads_x], sy[iy % threads_y]) * (0.6 + 0.8 * along)
    return k * (1.0 + 0.035 * slub)


def linen(w, h, seed, tile_m=0.5, bg=(0.93, 0.92, 0.88), threads_per_m=900):
    """Plain-woven linen, near white (each copy is tinted): the weave, slubs, a little mottling and soap marks."""
    t = int(threads_per_m * tile_m)
    k = weave(h, w, t, t, seed)
    mott = tfbm(h, w, 6, 6, seed + 1, 4)
    stain = sm(0.62, 0.85, tfbm(h, w, 3, 3, seed + 2, 4))
    img = np.asarray(bg, np.float32)[None, None, :] * (0.86 + 0.14 * k)[..., None]
    img *= (0.94 + 0.08 * mott)[..., None]
    img = img * (1 - 0.10 * stain[..., None]) + np.asarray((0.80, 0.74, 0.58), np.float32) * 0.10 * stain[..., None]
    return np.clip(img, 0, 1)


def twill(w, h, seed, tile_m=0.5, bg=(0.92, 0.91, 0.89), threads_per_m=700, fuzz=0.4):
    """Twilled cotton or woollen cloth, near white (tinted per copy): the diagonal rib, a fuzzy nap, felted patches."""
    t = int(threads_per_m * tile_m)
    k = weave(h, w, t, t, seed, twill=3)
    nap = tfbm(h, w, 64, 64, seed + 1, 3)
    felt = tfbm(h, w, 8, 8, seed + 2, 4)
    img = np.asarray(bg, np.float32)[None, None, :] * (0.84 + 0.16 * ((1 - fuzz) * k + fuzz * (0.7 + 0.6 * nap)))[..., None]
    img *= (0.92 + 0.12 * felt)[..., None]
    return np.clip(img, 0, 1)


def ticking(w, h, seed, tile_m=0.5, bg=(0.88, 0.86, 0.80), ink=(0.16, 0.24, 0.46)):
    """Bed ticking (and striped aprons): a close twill, indigo stripes along v (a broad one between two thin ones)."""
    period = 0.05  # metres; tile_m must be a whole number of periods
    X = (np.arange(w, dtype=np.float32) + 0.5) / w * tile_m
    p = (X / period) % 1.0
    stripe = (((p > 0.08) & (p < 0.32)) | ((p > 0.42) & (p < 0.46)) | ((p > 0.54) & (p < 0.58))).astype(np.float32)
    s = np.tile(stripe[None, :], (h, 1))
    img = np.asarray(bg, np.float32) * (1 - s[..., None]) + np.asarray(ink, np.float32) * s[..., None]
    k = weave(h, w, int(1000 * tile_m), int(1000 * tile_m), seed, twill=2)
    img *= (0.88 + 0.12 * k)[..., None]
    soil = tfbm(h, w, 5, 5, seed + 1, 4)
    img *= (0.90 + 0.12 * soil)[..., None]
    return np.clip(img, 0, 1)


def towel(w, h, seed, border=(0.62, 0.12, 0.10)):
    """A linen hand towel (one copy of the picture over the whole towel, its length down v): huckaback weave, a hem at
    each end and three red stripes woven in near each end."""
    k = weave(h, w, 420, 820, seed)
    img = np.asarray((0.92, 0.90, 0.85), np.float32)[None, None, :] * (0.84 + 0.16 * k)[..., None]
    v = (np.arange(h, dtype=np.float32) + 0.5) / h  # 0 top, 1 bottom: the towel's length (0.95 m)
    L = 0.95
    m = v * L
    d = np.minimum(m, L - m)  # metres from the nearer end
    band = np.zeros_like(d)
    for a, b in ((0.055, 0.068), (0.074, 0.098), (0.104, 0.117)):
        band = np.maximum(band, ((d > a) & (d < b)).astype(np.float32))
    band = band[:, None] * np.ones((1, w), np.float32)
    img = img * (1 - 0.85 * band[..., None]) + np.asarray(border, np.float32) * 0.85 * band[..., None] * (0.85 + 0.15 * k[..., None])
    hem = ((d > 0.0) & (d < 0.018)).astype(np.float32)[:, None] * np.ones((1, w), np.float32)
    img *= (1 - 0.08 * hem)[..., None]
    stain = sm(0.6, 0.85, tfbm(h, w, 3, 6, seed + 3, 4))
    img = img * (1 - 0.08 * stain[..., None]) + np.asarray((0.78, 0.72, 0.58), np.float32) * 0.08 * stain[..., None]
    return np.clip(img, 0, 1)


def rope(w, h, seed, rgb=(0.50, 0.44, 0.33), lay_px=None):
    """Laid hemp line along u, round it down v (tiles both ways): three strands spiralling, fibres, weathered grey."""
    lay = lay_px or w // 8
    X, Y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    ph = (X / lay + 3 * Y / h) % 1.0
    sh = 0.42 + 0.58 * np.sin(ph * math.pi) ** 0.7
    fib = tfbm(h, w, 96, 6, seed, 3)
    grey = tfbm(h, w, 4, 1, seed + 1, 3)
    img = np.asarray(rgb, np.float32)[None, None, :] * (sh * (0.84 + 0.3 * fib))[..., None]
    g = np.asarray((0.52, 0.50, 0.46), np.float32)
    img = img * (1 - 0.35 * grey[..., None]) + g * 0.35 * grey[..., None] * sh[..., None]
    return np.clip(img, 0, 1)


def bluestone(w, h, ppm, seed, rgb=(0.36, 0.38, 0.40), tooled=True):
    """Belgian blue stone (petit granit): blue-grey with white crinoid flecks and fine calcite veins; a dressed face
    with fine parallel tooling, a little green-black damp near the bottom (row h)."""
    rng = rng_(seed)
    base = tfbm(h, w, max(2, w // 96), max(2, h // 96), seed, 5)
    img = np.asarray(rgb, np.float32)[None, None, :] * (0.82 + 0.3 * base)[..., None]
    # crinoid flecks: small soft light discs (stems' sections), 1-4 mm
    n = int(w * h / ppm / ppm * 700)
    ys = rng.uniform(0, h, n)
    xs = rng.uniform(0, w, n)
    rad = rng.uniform(0.5, 2.0, n) * ppm / 1000.0
    fl = np.zeros((h, w), np.float32)
    for x, y, r in zip(xs, ys, rad):
        r = max(0.8, float(r))
        x0, x1, y0, y1 = int(max(0, x - r - 1)), int(min(w, x + r + 2)), int(max(0, y - r - 1)), int(min(h, y + r + 2))
        if x1 <= x0 or y1 <= y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5 - x, np.arange(y0, y1) + 0.5 - y)
        d = np.sqrt(gx * gx + gy * gy) / r
        fl[y0:y1, x0:x1] = np.maximum(fl[y0:y1, x0:x1], np.clip(1.2 - d, 0, 1) * rng.uniform(0.3, 0.7))
    # veins
    v = np.abs(tfbm(h, w, 3, 2, seed + 4, 5) - 0.5)
    vein = sm(0.008, 0.0, v) * 0.18
    img = img * (1 - vein[..., None]) + np.asarray((0.62, 0.63, 0.63), np.float32) * vein[..., None]
    if tooled:
        X = np.arange(w, dtype=np.float32)
        Y = np.arange(h, dtype=np.float32)
        XX, YY = np.meshgrid(X, Y)
        pitch = 0.009 * ppm
        tool = 0.5 + 0.5 * np.sin((XX * 0.97 + YY * 0.24) / pitch * 2 * math.pi + tfbm(h, w, 12, 12, seed + 5, 2) * 4)
        tool *= tfbm(h, w, 20, 20, seed + 7, 2)
        img *= (0.96 + 0.05 * tool)[..., None]
    damp = sm(0.55, 1.0, (np.arange(h, dtype=np.float32) / h))[:, None] * (0.6 + 0.4 * tfbm(h, w, 6, 2, seed + 6, 3))
    img = img * (1 - 0.35 * damp[..., None]) + np.asarray((0.12, 0.15, 0.12), np.float32) * 0.35 * damp[..., None]
    return np.clip(img, 0, 1)


def water(w, h, seed):
    """Still dark water in a trough: near black green, a faint sky sheen in soft ripples."""
    r = tfbm(h, w, 6, 6, seed, 4)
    img = np.asarray((0.05, 0.07, 0.07), np.float32)[None, None, :] * (0.8 + 0.5 * r)[..., None]
    return np.clip(img, 0, 1)


def beech(w, h, ppm, seed, rgb=(0.62, 0.53, 0.40)):
    """Turned beech (clothes pegs): pale, fine straight grain along v, small pores, a grey weathered skin."""
    g = tfbm(h, w, 40, 2, seed, 3)
    img = np.asarray(rgb, np.float32)[None, None, :] * (0.86 + 0.24 * g)[..., None]
    grey = tfbm(h, w, 3, 3, seed + 1, 3)
    img = img * (1 - (0.35 + 0.3 * grey[..., None])) + np.asarray((0.55, 0.53, 0.50), np.float32) * (0.35 + 0.3 * grey[..., None])
    return np.clip(img, 0, 1)


def oak_planks(w, h, ppm, seed, rgb=(0.50, 0.42, 0.32), along_v=True):
    """Weathered oak boards (the hatch leaves): straight grain along the board (v, or u when along_v is False) with
    irregularly spaced dark latewood lines, open pores, silvered grey on top with darker damp grain."""
    if not along_v:
        return np.ascontiguousarray(oak_planks(h, w, ppm, seed, rgb, True).transpose(1, 0, 2))
    rng = rng_(seed)
    across_n = max(2, int(w / ppm * 60))
    a = (np.arange(w, dtype=np.float32) + 0.5) / ppm
    A = np.tile(a[None, :], (h, 1))
    n1 = tnoise(h, w, across_n, 1, rng)  # varies across the board only
    n2 = tfbm(h, w, max(2, int(w / ppm * 4)), max(2, int(h / ppm * 3)), seed + 5, 3)  # a slow drift along it
    phase = A / 0.007 + 2.5 * n1 + 1.2 * n2
    ring = (0.5 + 0.5 * np.sin(2 * math.pi * phase)) ** 6
    streak = tfbm(h, w, max(2, int(w / ppm * 80)), max(2, int(h / ppm * 3)), seed + 1, 3)
    img = np.asarray(rgb, np.float32)[None, None, :] * (0.92 - 0.16 * ring + 0.16 * (streak - 0.5))[..., None]
    pores = (rng.random((h, w)) < 0.015) & (ring > 0.2)
    img[pores] *= 0.6
    silver = 0.40 + 0.3 * tfbm(h, w, 4, 4, seed + 2, 3)
    img = img * (1 - silver[..., None]) + np.asarray((0.58, 0.57, 0.54), np.float32) * silver[..., None] * (0.9 - 0.2 * ring[..., None])
    dirt = sm(0.5, 0.9, tfbm(h, w, 5, 5, seed + 3, 4)) * 0.3
    img *= (1 - dirt)[..., None]
    return np.clip(img, 0, 1)


def iron(w, h, ppm, seed, rgb=(0.085, 0.082, 0.078), rust=0.35):
    """Cast or wrought iron, black gone brown: mottled scale, rust in patches and specks, pits."""
    rng = rng_(seed)
    mott = tfbm(h, w, max(2, int(w / ppm * 40)), max(2, int(h / ppm * 40)), seed, 4)
    img = np.asarray(rgb, np.float32)[None, None, :] * (0.75 + 0.5 * mott)[..., None]
    r = tfbm(h, w, max(2, int(w / ppm * 25)), max(2, int(h / ppm * 25)), seed + 1, 4)
    m = sm(1 - rust * 0.9, 1 - rust * 0.55, r) * 0.85
    rc = np.asarray((0.24, 0.12, 0.055), np.float32)[None, None, :] * (0.75 + 0.5 * tfbm(h, w, 64, 64, seed + 2, 2))[..., None]
    img = img * (1 - m[..., None]) + rc * m[..., None]
    sp = rng.random((h, w)) < 0.012
    img[sp] *= 0.55
    return np.clip(img, 0, 1)

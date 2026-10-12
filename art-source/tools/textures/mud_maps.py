"""The canal and vliet beds' mud: a picture and its height map, our own (D1, 2026-10-11).

Scheldt silt as the ebb leaves it in a town canal: dark grey-brown, wet, with current ripples whose crests run
across the flow (the canal and the vliet run along the world's z, the picture's rows), patches of smooth mud between
them, worm casts and pits, a few shell flecks, small stones and bits of straw. Water stands in the ripples' troughs:
darker there. Everything comes from periodic noise (filtered in the frequency domain), so both maps tile; the height
is the same field the colour is shaded from, so the bump fits the picture (docs/rendering.md, the bumps).

    python tools/textures/mud_maps.py [out folder] [size]

writes mud_bed.jpg (colour, `size` px, default 1024) and mud_bed_h.png (height, the same size) into the out folder
(default client/public/textures). One tile is 4 m (client/src/world/tidemud.ts MUD_TILE).
"""
import os
import sys

import cv2
import numpy as np

TILE_M = 4.0


def noise(n, scale_px, rng, power=2.0):
    """Periodic smooth noise, -1..1-ish: white noise with its spectrum cut off near 1 / scale_px."""
    w = rng.standard_normal((n, n))
    f = np.fft.fft2(w)
    ky = np.fft.fftfreq(n)[:, None]
    kx = np.fft.fftfreq(n)[None, :]
    k = np.sqrt(kx * kx + ky * ky) * scale_px
    f *= 1.0 / (1.0 + k ** (2 * power))
    out = np.real(np.fft.ifft2(f))
    return out / (np.std(out) + 1e-9)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def main(out="client/public/textures", size="1024"):
    n = int(size)
    px_m = n / TILE_M  # pixels a metre
    rng = np.random.default_rng(1873)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    u = xx / n  # 0..1 across the tile (world x)
    v = yy / n  # 0..1 along the tile (world z, the flow)

    # --- the ripples: crests across the flow, 12-16 cm apart, sinuous, asymmetric (gentle up-current, steep lee)
    warp = noise(n, 0.8 * px_m, rng) * 0.012 + noise(n, 0.3 * px_m, rng) * 0.0025
    cycles = 28  # along one 4 m tile: 14 cm
    ph = (v + warp + 0.004 * np.sin(2 * np.pi * 3 * u)) * cycles
    f = ph - np.floor(ph)
    # asymmetric profile: rises over 70 % of the wave, falls over 30 %
    rip = np.where(f < 0.7, f / 0.7, (1 - f) / 0.3)
    rip = rip * rip * (3 - 2 * rip)
    # crests come and go: broken, linguoid in places
    breakup = smooth(-0.6, 0.7, noise(n, 0.22 * px_m, rng))
    rip = rip * (0.55 + 0.45 * breakup)
    # ripple fields in patches (smooth mud between), soft edges
    field = smooth(-0.3, 0.5, noise(n, 1.0 * px_m, rng) + 0.2)

    # --- the mud's own lumps: soft swells and a fine grain
    lumps = noise(n, 0.35 * px_m, rng) * 0.5 + noise(n, 0.08 * px_m, rng) * 0.25
    grain = noise(n, 0.012 * px_m, rng, power=1.0)

    h = 0.5 + 0.36 * (rip - 0.5) * field + 0.10 * lumps + 0.025 * grain

    # --- worm casts and pits: small round bumps and holes, sharp
    def dots(count, r_cm_lo, r_cm_hi, amp):
        nonlocal h
        acc = np.zeros((n, n))
        for _ in range(count):
            cx, cy = rng.uniform(0, n), rng.uniform(0, n)
            r = rng.uniform(r_cm_lo, r_cm_hi) / 100 * px_m
            dx = (xx - cx + n / 2) % n - n / 2
            dy = (yy - cy + n / 2) % n - n / 2
            d2 = (dx * dx + dy * dy) / (r * r)
            m = d2 < 9
            acc[m] += np.exp(-d2[m] * 1.6) * rng.uniform(0.6, 1.0)
        return acc * amp

    casts = dots(140, 0.6, 1.6, 0.10)
    pits = dots(220, 0.3, 0.9, 0.12)
    h = h + casts - pits

    # --- small stones and shell flecks (proud, lighter)
    stones = np.zeros((n, n))
    shell = np.zeros((n, n))
    for _ in range(90):
        cx, cy = rng.uniform(0, n), rng.uniform(0, n)
        rx = rng.uniform(0.6, 2.2) / 100 * px_m
        ry = rx * rng.uniform(0.5, 1.0)
        a = rng.uniform(0, np.pi)
        dx = (xx - cx + n / 2) % n - n / 2
        dy = (yy - cy + n / 2) % n - n / 2
        p = (dx * np.cos(a) + dy * np.sin(a)) / rx
        q = (-dx * np.sin(a) + dy * np.cos(a)) / ry
        d = p * p + q * q
        m = d < 1.3
        target = shell if rng.uniform() < 0.45 else stones
        target[m] = np.maximum(target[m], np.clip(1 - d[m], 0, 1) ** 0.5)
    h = h + 0.10 * stones + 0.04 * shell

    # --- straw and twigs: thin strokes lying on the mud
    straw = np.zeros((n, n), np.float32)
    for _ in range(26):
        cx, cy = rng.uniform(0, n), rng.uniform(0, n)
        a = rng.uniform(0, np.pi)
        L = rng.uniform(4, 16) / 100 * px_m
        for sx in (-n, 0, n):
            for sy in (-n, 0, n):
                p0 = (int(cx + sx - np.cos(a) * L / 2), int(cy + sy - np.sin(a) * L / 2))
                p1 = (int(cx + sx + np.cos(a) * L / 2), int(cy + sy + np.sin(a) * L / 2))
                cv2.line(straw, p0, p1, float(rng.uniform(0.6, 1.0)), max(1, int(0.35 / 100 * px_m)), cv2.LINE_AA)
    h = h + 0.03 * straw

    h = np.clip(h, 0, 1)

    # --- the colour: dark wet silt, darker where water stands (the troughs, the pits), the stones and shells lighter
    low = smooth(0.62, 0.30, h)  # 1 in the hollows
    tone = noise(n, 0.5 * px_m, rng) * 0.5 + noise(n, 0.15 * px_m, rng) * 0.3
    # sRGB 0..255; Scheldt silt is grey-brown with a little olive, about a tenth of the light back
    base = np.stack([np.full((n, n), 150.0), np.full((n, n), 135.0), np.full((n, n), 112.0)], -1)  # (RGB; BGR at the write)
    col = base * (1 + 0.10 * tone[..., None])
    # olive and rust in big soft patches
    olive = smooth(0.2, 1.2, noise(n, 0.6 * px_m, rng))[..., None]
    col = col * (1 - 0.12 * olive) + np.array([64.0, 66.0, 42.0])[None, None, :] * 0.12 * olive
    # the hollows: wet, darker, a hint of blue-grey water film
    col = col * (1 - 0.30 * low[..., None]) + np.array([36.0, 40.0, 46.0])[None, None, :] * 0.10 * low[..., None]
    # the crests a little lighter (they dry first)
    crest = smooth(0.55, 0.8, h)[..., None]
    col = col * (1 + 0.10 * crest)
    # shading from the height (soft light from the upper left: the relief light adds its own in the game)
    gy, gx = np.gradient(cv2.GaussianBlur(h.astype(np.float32), (0, 0), 1.0))
    shade = 1 + np.clip((-gx - gy) * px_m * 0.020, -0.18, 0.18)
    col = col * shade[..., None]
    # stones: grey-blue flint and brick bits; shells: pale grey
    st = stones[..., None]
    col = col * (1 - st) + st * np.array([84.0, 86.0, 92.0])[None, None, :] * (0.85 + 0.3 * tone[..., None] * 0.5)
    sh = shell[..., None]
    col = col * (1 - 0.8 * sh) + 0.8 * sh * np.array([138.0, 134.0, 128.0])[None, None, :]
    stv = straw[..., None]
    col = col * (1 - 0.7 * stv) + 0.7 * stv * np.array([108.0, 92.0, 58.0])[None, None, :]
    col = col * (1 + 0.04 * grain[..., None])

    os.makedirs(out, exist_ok=True)
    cv2.imwrite(os.path.join(out, "mud_bed.jpg"), np.clip(col[..., ::-1], 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    cv2.imwrite(os.path.join(out, "mud_bed_h.png"), np.clip(h * 255, 0, 255).astype(np.uint8))
    print("mud maps:", os.path.join(out, "mud_bed.jpg"), "mean colour", np.round(col.reshape(-1, 3).mean(0), 1))


if __name__ == "__main__":
    main(*sys.argv[1:])

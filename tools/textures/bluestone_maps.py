"""The bluestone flags and kerbs at the quay wall's detail (2026-10-12, Steve: "make the textures of the flat stones
and borders with that kind of detail and make them fit in the era").

The stone itself is a Codex picture of a bluestone face (tools/textures/src/bluestone_*_codex.jpg, assets/ATTRIBUTION.md):
Belgian bluestone (petit granit) with its crinoid flecks, calcite veins, the 19th-century tooling and the soot. This
lays it out as paving, so the colour, the height and the stone map are made from one layout and always line up:

- flags (the squares, the pavements, the door steps): 1024 px for the 4 m tile (2.56 px a cm, as the quay wall), in
  courses of 40-56 cm, stones of 47-81 cm, each course on its own offset (bond); each stone is its own piece of the
  picture (turned end for end or not), its own tone and tilt, its arrises worn round over 2 cm, chips out of the edges
  and corners, a crack in a few; joints of 5-12 mm filled with sand and dirt, a little below the stones; soot and grime
  in big soft patches that tile.
- kerbs (the edge stones along the streets and the Rond): 512 x 128 for 2 m along and the band across (2.56 px a cm
  along), stones of 40-85 cm with their own piece of the second picture (point-dressed, weathered paler), a rounded top,
  the dirt beside them dark, as world/paving.ts edgeStoneTextures lays them.

Writes into <out>: bluestone_flags.jpg, bluestone_flags_h.png, bluestone_flags_id.png (r the stone's number, g 255 on
a stone, b 255 where a stone runs on from the tile before: world/paving.ts), bluestone_kerb.jpg, bluestone_kerb_h.png.

    python tools/textures/bluestone_maps.py <flag picture> <kerb picture> <out folder>
"""
import sys

import cv2
import numpy as np

RNG = np.random.default_rng(1873)


def load(path):
    im = cv2.imread(path, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255.0
    return im


def periodic_noise(h, w, cells, seed):
    """Smooth value noise that tiles: a random field low-passed in the frequency domain (0..1)."""
    rr = np.random.default_rng(seed)
    f = np.fft.fft2(rr.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w
    k = np.exp(-(fx ** 2 + fy ** 2) / (2 * cells ** 2))
    n = np.real(np.fft.ifft2(f * k))
    n = (n - n.min()) / (n.max() - n.min() + 1e-9)
    return n.astype(np.float32)


def highpass(lum, sigma):
    return lum - cv2.GaussianBlur(lum, (0, 0), sigma)


def stone_piece(src, w, h, flip):
    """A w x h piece of the stone picture at a random place (never across its edge), turned end for end or not."""
    H, W = src.shape[:2]
    x0 = RNG.integers(0, max(1, W - w))
    y0 = RNG.integers(0, max(1, H - h))
    p = src[y0 : y0 + h, x0 : x0 + w]
    if p.shape[0] < h or p.shape[1] < w:
        p = cv2.resize(src, (w, h), interpolation=cv2.INTER_AREA)
    if flip:
        p = p[::-1, ::-1]
    return p


def layout_courses(n, rows_px, widths_px):
    """Courses that close the tile exactly: [(y0, y1, [(x0_unwrapped, x1_unwrapped)...]), ...]."""
    courses = []
    hs = []
    while True:
        hs = []
        while sum(hs) < n - rows_px[1]:
            hs.append(int(RNG.integers(rows_px[0], rows_px[1] + 1)))
        rest = n - sum(hs)
        if rows_px[0] <= rest <= rows_px[1]:
            hs.append(rest)
            break
    y = 0
    for ch in hs:
        off = int(RNG.integers(0, n))
        # so many stones that the course closes exactly at the wrap: the last one never runs over the first
        kmin, kmax = -(-n // widths_px[1]), n // widths_px[0]
        left = int(RNG.integers(kmin, kmax + 1))
        xs = [off]
        while left > 0:
            remaining = off + n - xs[-1]
            lo = max(widths_px[0], remaining - widths_px[1] * (left - 1))
            hi = min(widths_px[1], remaining - widths_px[0] * (left - 1))
            wdt = remaining if left == 1 else int(RNG.integers(lo, hi + 1))
            xs.append(xs[-1] + wdt)
            left -= 1
        courses.append((y, y + ch, list(zip(xs[:-1], xs[1:]))))
        y += ch
    return courses


def at_scale(src, k):
    """The picture at its true scale (Codex draws the stone's grain about twice as coarse as it is, and its own
    pixels are soft and crinkly at full size), twice over each way: it tiles, so a stone's piece may run over it."""
    s = cv2.resize(src, (int(src.shape[1] * k), int(src.shape[0] * k)), interpolation=cv2.INTER_AREA)
    return np.tile(s, (2, 2, 1))


def flags(src, n=1024):
    px_cm = n / 400.0  # pixels per cm on the 4 m tile
    src = at_scale(src, 0.5)
    # the picture's light: one even grey (a slab never shows the picture's own big light and dark)
    lum = src.mean(axis=2)
    big = cv2.GaussianBlur(lum, (0, 0), 60)
    src = np.clip(src * (lum.mean() / (big[:, :, None] + 1e-4)), 0, 1)
    # tooling, pits and flecks for the height, cut with the colour from the same place
    src = np.concatenate([src, highpass(src.mean(axis=2), 3.0)[:, :, None]], axis=2)
    col = np.zeros((n, n, 3), np.float32)
    hgt = np.zeros((n, n), np.float32)
    sid = np.zeros((n, n, 3), np.uint8)
    on = np.zeros((n, n), bool)
    ragged = periodic_noise(n, n, 90, 33)
    ragged2 = periodic_noise(n, n, 200, 34)
    courses = layout_courses(n, (int(40 * px_cm), int(56 * px_cm)), (int(47 * px_cm), int(81 * px_cm)))
    num = 0
    for y0, y1, stones in courses:
        for xa, xb in stones:
            num += 1
            w, h = xb - xa, y1 - y0
            p4 = stone_piece(src, w, h, RNG.random() < 0.5)
            piece, dpiece = p4[:, :, :3], p4[:, :, 3]
            tone = 0.93 + 0.12 * RNG.random()
            warm = RNG.random() < 0.3
            tint = np.array([1.03, 1.0, 0.95] if warm else [0.99, 1.0, 1.02], np.float32)
            top = 0.86 + 0.14 * RNG.random()
            tx, ty = (RNG.random() - 0.5) * 0.1, (RNG.random() - 0.5) * 0.1
            jw = (0.3 + 0.2 * RNG.random()) * px_cm  # half the joint: 6-10 mm joints in all
            arris = 2.0 * px_cm
            chips = []
            for _ in range(int(RNG.integers(0, 5))):
                side = int(RNG.integers(0, 4))
                t = RNG.random()
                cx = t * w if side < 2 else (0 if side == 2 else w - 1)
                cy = (0 if side == 0 else h - 1) if side < 2 else t * h
                chips.append((cx, cy, (0.8 + 2.2 * RNG.random()) * px_cm))
            if RNG.random() < 0.3:  # a broken corner
                cx, cy = (0 if RNG.random() < 0.5 else w - 1), (0 if RNG.random() < 0.5 else h - 1)
                chips.append((cx, cy, (2 + 4 * RNG.random()) * px_cm))
            crack = None
            if RNG.random() < 0.12:
                crack = (RNG.random() * w, RNG.random() * w, RNG.random() * 6.28)
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            gx = (xa + xx).astype(int) % n
            gy = (y0 + yy).astype(int) % n
            eat = (ragged[gy, gx] * 0.6 + ragged2[gy, gx] * 0.3) * 0.5 * px_cm
            # hand-dressed, not sawn: no edge quite straight or square (each edge off by up to 1.5 px, end to end)
            sk = (RNG.random(8) - 0.5) * 3.0
            u1, v1 = xx / max(1, w - 1), yy / max(1, h - 1)
            d = np.minimum.reduce([
                xx + 0.5 - (sk[0] + sk[1] * v1), w - xx - 0.5 - (sk[2] + sk[3] * v1),
                yy + 0.5 - (sk[4] + sk[5] * u1), h - yy - 0.5 - (sk[6] + sk[7] * u1)]) - jw - eat
            chip = np.zeros_like(d)
            for cx, cy, cr in chips:
                q = np.hypot(xx - cx, yy - cy)
                chip = np.maximum(chip, np.clip(1 - q / cr, 0, 1))
            stone = (d > 0) & (chip < 0.6)
            a = np.clip(d / arris, 0, 1)
            round_ = np.sqrt(1 - (1 - a) ** 2)
            u, v = xx / w - 0.5, yy / h - 0.5
            hh = top * (1 + tx * u + ty * v) * (0.55 + 0.45 * round_) * (1 - 0.45 * np.clip(chip / 0.6, 0, 1))
            hh += dpiece * 0.9 * (0.4 + 0.6 * a)
            k = tone * (0.86 + 0.14 * a) * (1 - 0.2 * np.clip(chip / 0.6, 0, 1))
            # the worn arris a little lighter where feet polished it (not all round)
            k += 0.05 * np.exp(-((d - 0.6 * px_cm) ** 2) / (0.5 * px_cm) ** 2) * (ragged2[gy, gx] > 0.45)
            if crack:
                ca, cb, wob = crack
                cxat = ca + (cb - ca) * (yy / h) + np.sin(yy * 0.12 + wob) * 0.6 * px_cm
                off = np.abs(xx - cxat)
                cr = off < 0.35 * px_cm
                k = np.where(cr, k * 0.55, k)
                hh = np.where(cr, hh * 0.78, hh)
            c = piece * tint * k[:, :, None]
            sel = stone
            col[gy[sel], gx[sel]] = c[sel]
            hgt[gy[sel], gx[sel]] = np.clip(hh[sel], 0, 1)
            on[gy[sel], gx[sel]] = True
            sid[gy[sel], gx[sel], 0] = 1 + (num * 97) % 254
            sid[gy[sel], gx[sel], 1] = 255
            sid[gy[sel], gx[sel], 2] = np.where((xa + xx)[sel] >= n, 255, 0)
    # the joints: sand, grit and dirt, a little below the stones, darkest in the middle
    grit = RNG.random((n, n)).astype(np.float32)
    dist = cv2.distanceTransform((~on).astype(np.uint8) * 255, cv2.DIST_L2, 3)  # 0 on a stone
    jn = periodic_noise(n, n, 120, 41)
    sand = np.stack([0.40, 0.37, 0.31]) * (0.7 + 0.4 * jn[:, :, None]) * (0.8 + 0.4 * grit[:, :, None])
    sand *= (1 - 0.3 * np.clip(dist / (1.0 * px_cm), 0, 1))[:, :, None]
    col = np.where(on[:, :, None], col, sand)
    hgt = np.where(on, hgt, 0.12 + 0.06 * jn + 0.03 * grit)
    # soot and grime: big soft patches that tile, heavier by the joints
    soot = periodic_noise(n, n, 6, 51) * 0.6 + periodic_noise(n, n, 18, 52) * 0.4
    near = np.exp(-cv2.distanceTransform(on.astype(np.uint8) * 255, cv2.DIST_L2, 3) / (2.5 * px_cm))
    col *= (0.84 + 0.22 * soot)[:, :, None] * (1 - 0.12 * near)[:, :, None]
    # (the picture's tooling and pits read in the height; the colour keeps the detail it has)
    return col, hgt, sid


def kerb(src, w=512, h=128):
    px_cm = w / 200.0  # 2 m along
    src = at_scale(src, 0.45)
    lum = src.mean(axis=2)
    big = cv2.GaussianBlur(lum, (0, 0), 60)
    src = np.clip(src * (lum.mean() / (big[:, :, None] + 1e-4)), 0, 1)
    src = np.concatenate([src, highpass(src.mean(axis=2), 2.5)[:, :, None]], axis=2)
    col = np.zeros((h, w, 3), np.float32)
    hgt = np.full((h, w), 18 / 255.0, np.float32)
    m = int(round(h * 6 / 64))  # the dirt beside the kerb (v), as the painted one
    # the dirt: darkest against the stone (its shadow on the lower ground)
    for yy in range(m):
        k = (34 - 3 * yy * 6 / m) / 255.0
        col[yy] = col[h - 1 - yy] = np.array([k, k - 3 / 255, k - 7 / 255]) * (0.9 + 0.2 * RNG.random((w, 1)))
    x = 0
    ragged = periodic_noise(h, w, 40, 61)
    while x < w:
        L = int(RNG.integers(int(40 * px_cm), int(85 * px_cm) + 1))
        if w - (x + L) < int(40 * px_cm):
            L = w - x
        sw, sh = L, h - 2 * m
        p4 = stone_piece(src, sw, sh, RNG.random() < 0.5)
        piece, dp = p4[:, :, :3], p4[:, :, 3]
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        eat = ragged[(m + yy).astype(int), (x + xx).astype(int) % w] * 0.8 * px_cm
        d_end = np.minimum(xx + 0.5, sw - xx - 0.5) - 0.45 * px_cm - eat  # the joints between kerb stones
        d_side = np.minimum(yy + 0.5, sh - yy - 0.5)
        stone = d_end > 0
        rise = np.sqrt(1 - (1 - np.clip(d_side / (3 * px_cm), 0, 1)) ** 2) * np.sqrt(np.clip(d_end / (1.5 * px_cm), 0, 1))
        top = 0.85 + 0.15 * RNG.random()
        hh = 0.12 + 0.88 * top * rise + dp * 0.5 * rise
        tone = 0.94 + 0.12 * RNG.random()
        # worn, rounded top: a lighter middle where the wheels and the boots go, the edge by the street darker
        v = yy / sh
        k = tone * (0.9 + 0.1 * rise) * (1 + 0.06 * np.exp(-((v - 0.4) ** 2) / 0.05)) * (1 - 0.12 * np.clip((v - 0.8) / 0.2, 0, 1))
        c = piece * k[:, :, None]
        gx = (x + xx).astype(int) % w
        gy = (m + yy).astype(int)
        col[gy[stone], gx[stone]] = c[stone]
        hgt[gy[stone], gx[stone]] = np.clip(hh[stone], 0, 1)
        jsel = ~stone
        col[gy[jsel], gx[jsel]] = np.array([0.2, 0.18, 0.15])
        x += L
    soot = periodic_noise(h, w, 4, 71)
    col[m : h - m] *= (0.88 + 0.18 * soot[m : h - m])[:, :, None]
    return col, hgt


def save_rgb(path, im, q=92):
    a = np.clip(im * 255 + 0.5, 0, 255).astype(np.uint8)[:, :, ::-1]
    if path.endswith(".jpg"):
        cv2.imwrite(path, a, [cv2.IMWRITE_JPEG_QUALITY, q])
    else:
        cv2.imwrite(path, a)


def main(flag_src, kerb_src, out):
    fs = load(flag_src)
    # the flags: the picture's mean brought to the painted flags' grey (sRGB ~0.40), so the shader's tones fit
    fs = np.clip(fs * (0.40 / fs.mean()), 0, 1)
    c, h, s = flags(fs)
    save_rgb(f"{out}/bluestone_flags.jpg", c)
    cv2.imwrite(f"{out}/bluestone_flags_h.png", np.clip(h * 255 + 0.5, 0, 255).astype(np.uint8))
    cv2.imwrite(f"{out}/bluestone_flags_id.png", s[:, :, ::-1])
    ks = load(kerb_src)
    ks = np.clip(ks * (0.43 / ks.mean()), 0, 1)
    c, h = kerb(ks)
    save_rgb(f"{out}/bluestone_kerb.jpg", c)
    cv2.imwrite(f"{out}/bluestone_kerb_h.png", np.clip(h * 255 + 0.5, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    main(*sys.argv[1:4])

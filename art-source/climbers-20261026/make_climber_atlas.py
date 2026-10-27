"""The town wall's climbers (Steve, 2026-10-26: the vines on the city walls looked very fake; make them realistic, high
detail; 2026-10-27: natural, stretching long distances up the wall): a leaf atlas drawn here, no outside picture.
    python make_climber_atlas.py <out folder>
2048 x 2304 RGBA (cut out by alpha), its height (grey) and its mipmaps with the leaves' cover kept (atlas-mips.bin).
Four rows of four cells (512 each), each cell drawn at true size (the climbers.py card is the cell's width):
  row 0: common ivy (Hedera helix), dark green #243B2A / #293D2D, 0.36 m cells: three climbing shoots (alternate
         three-to-five-lobed leaves 4 to 8 cm wide on petioles, tips hanging down and out, pale veins #788164)
         and a mat (0.6 m: a knot of shoots, leaves overlapping)
  row 1: ivy mid green #40543A: two shoots, a mat, a thin runner with small leaves (the airy tips)
  row 2: Virginia creeper (Parthenocissus), 0.45 m cells: burgundy #6B2531, crimson #8F3032, red #A64032 compound
         leaves of five separate serrated leaflets 5 to 10 cm long on a wiry runner; cell 3 a sparse young tip
  row 3: creeper turning: cell 0 red and orange #BC6938, cell 1 orange, brown #70503A and dull green, cell 2 brown and
         crimson; cell 3 four quarters: two branched tendrils ending in adhesive pads, moss in a joint, fallen leaflets
  y 2048-2176: the woody stems' bark (grey-brown, fibrous, along x), opaque
  y 2176-2304: the ivy's aerial rootlets: a fringe of fine hairs either side of the stem's line
A shoot cell's foot (its bottom middle) is where it joins the stem; a mat and a quarter are centred.
Fixed seed: the same picture every run.
"""
import sys, math, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # drawn at twice the size
CELL = 512 * S
IVY_M, CREEPER_M, MAT_M = 0.36, 0.45, 0.6     # a cell's width in metres (a mat's 0.6 m)
rng = np.random.default_rng(1874)

IVY_DARK = [(36, 59, 42), (41, 61, 45), (33, 54, 38), (46, 68, 47)]
IVY_MID = [(64, 84, 58), (58, 80, 52), (70, 90, 60), (52, 74, 48)]
VEIN = (120, 129, 100)
BURGUNDY, CRIMSON, RED, ORANGE, BROWN, DULL = (107, 37, 49), (143, 48, 50), (166, 64, 50), (188, 105, 56), (112, 80, 58), (98, 102, 56)


def shade(c, k):
    return tuple(int(np.clip(v * k, 0, 255)) for v in c)


def ivy_outline(cx, cy, size, ang, lobes, rr):
    """An ivy leaf from its base (cx, cy) toward ang: pointed lobes (five or three) with shallow sinuses and a notch at
    the petiole; size the middle lobe's reach. Each lobe a little uneven."""
    if lobes == 5: half = [(0, 1.0), (24, .5), (50, .74), (76, .42), (104, .56), (140, .34), (180, .16)]
    else: half = [(0, 1.0), (28, .52), (60, .72), (105, .48), (150, .3), (180, .16)]
    j = [r * rr.uniform(0.9, 1.08) if k % 2 == 0 else r for k, (_, r) in enumerate(half)]
    half = [(d, r) for (d, _), r in zip(half, j)]
    prof = [(-d, r * rr.uniform(0.92, 1.06) if k % 2 == 0 and d else r) for k, (d, r) in reversed(list(enumerate(half[1:], 1)))] + half
    pts = []
    for (d0, r0), (d1, r1) in zip(prof[:-1], prof[1:]):
        for k in range(7):
            t = k / 7; dd = d0 + (d1 - d0) * t
            rr_ = r0 + (r1 - r0) * t - 0.05 * math.sin(math.pi * t) * (r0 > r1)
            a = ang + math.radians(dd)
            pts.append((cx + rr_ * size * math.cos(a), cy + rr_ * size * math.sin(a)))
    return pts


def ivy_leaf(d, cx, cy, size, ang, cols, rr):
    lobes = 5 if rr.random() < 0.65 else 3
    c = cols[int(rr.integers(len(cols)))]; base = shade(c, rr.uniform(0.86, 1.12))
    pts = ivy_outline(cx, cy, size, ang, lobes, rr)
    d.polygon(pts, fill=shade(base, 0.78) + (255,))                       # the rim, a little darker
    inner = [(cx + (x - cx) * 0.93 + math.cos(ang) * size * 0.04, cy + (y - cy) * 0.93 + math.sin(ang) * size * 0.04) for x, y in pts]
    d.polygon(inner, fill=base + (255,))
    # one half catches the light (the blade folds a little along its midrib)
    m = len(inner) // 2
    d.polygon([(cx, cy)] + inner[m:] , fill=shade(base, 1.1) + (255,))
    for vd, vr in ((0, .8), (50, .62), (-50, .62), (104, .45), (-104, .45))[:lobes]:
        va = ang + math.radians(vd)
        vc = tuple(int(b + (v - b) * 0.55) for b, v in zip(base, VEIN))
        d.line([(cx, cy), (cx + math.cos(va) * size * vr, cy + math.sin(va) * size * vr)], fill=vc + (255,), width=max(1, S))


def creeper_leaflet(d, cx, cy, L, a, col):
    """One leaflet from its stalklet's end: obovate, its widest beyond the middle, a drawn-out tip, coarse teeth along
    its outer two thirds."""
    left, right = [], []
    n = 44
    for j in range(n + 1):
        t = j / n
        w = L * 0.2 * (math.sin(math.pi * min(t * 1.08, 1.0)) ** 0.9) * (0.55 + 0.6 * t) * (1 - t ** 4)
        tooth = (0.06 * L * (0.5 + 0.5 * math.cos(j * math.pi / 2.2)) - 0.02 * L) * (0.32 < t < 0.94)
        px = cx + math.cos(a) * L * t; py = cy + math.sin(a) * L * t
        left.append((px - math.sin(a) * (w + tooth), py + math.cos(a) * (w + tooth)))
        right.append((px + math.sin(a) * (w + tooth * 0.8), py - math.cos(a) * (w + tooth * 0.8)))
    pts = left + right[::-1]
    d.polygon(pts, fill=shade(col, 0.76) + (255,))
    inner = [(cx + (x - cx) * 0.94 + math.cos(a) * L * 0.03, cy + (y - cy) * 0.94 + math.sin(a) * L * 0.03) for x, y in pts]
    d.polygon(inner, fill=col + (255,))
    d.polygon([(cx, cy)] + inner[:n + 1], fill=shade(col, 1.08) + (255,))
    vc = shade(col, 0.7) + (255,)
    d.line([(cx, cy), (cx + math.cos(a) * L * 0.92, cy + math.sin(a) * L * 0.92)], fill=vc, width=max(1, S))
    for k in range(1, 6):
        t = k / 7; px = cx + math.cos(a) * L * t; py = cy + math.sin(a) * L * t
        for side in (-1, 1):
            b = a + side * 0.8
            d.line([(px, py), (px + math.cos(b) * L * 0.14, py + math.sin(b) * L * 0.14)], fill=vc, width=1)


def creeper_leaf(d, cx, cy, size, ang, cols, rr):
    """A compound leaf: five separate leaflets fanned from the petiole's end (cx, cy) toward ang, the middle the
    longest, each on a short stalklet, each its own shade."""
    order = [0, 4, 1, 3, 2]                                      # the outer ones under, the middle on top
    spread = rr.uniform(0.58, 0.72)
    for k in order:
        a = ang + (k - 2) * spread + rr.normal(0, 0.06)
        L = size * (1.0 - 0.17 * abs(k - 2)) * rr.uniform(0.92, 1.06)
        sx, sy = cx + math.cos(a) * size * 0.06, cy + math.sin(a) * size * 0.06
        d.line([(cx, cy), (sx, sy)], fill=(96, 52, 40, 255), width=max(1, S))
        c = cols[int(rr.integers(len(cols)))]
        creeper_leaflet(d, sx, sy, L, a, shade(c, rr.uniform(0.86, 1.1)))


def shoot_line(rr, foot, length, bend, step=0.1):
    """A shoot's line up from foot (pixels), bending a little."""
    pts = [foot]; a = -math.pi / 2 + rr.uniform(-0.2, 0.2)
    n = int(1 / step)
    for _ in range(n):
        a += rr.uniform(-bend, bend); a = min(max(a, -math.pi / 2 - 0.5), -math.pi / 2 + 0.5)
        p = pts[-1]; pts.append((p[0] + math.cos(a) * length * step, p[1] + math.sin(a) * length * step))
    return pts


def ivy_shoot(img, x0, y0, cols, seed, mat=False, tip=False):
    rr = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    px_m = CELL / (MAT_M if mat else IVY_M)
    shoots = []
    if mat:      # a knot of shoots filling the cell, its edge ragged
        for k in range(11):
            f = (x0 + CELL * rr.uniform(0.2, 0.8), y0 + CELL * rr.uniform(0.7, 0.97))
            shoots.append(shoot_line(rr, f, CELL * rr.uniform(0.45, 0.72), 0.4))
    else:
        shoots.append(shoot_line(rr, (x0 + CELL / 2, y0 + CELL * 0.985), CELL * (0.8 if tip else 0.9), 0.25))
        if not tip and rr.random() < 0.7:
            q = shoots[0][int(rr.integers(3, 6))]
            shoots.append(shoot_line(rr, q, CELL * rr.uniform(0.35, 0.5), 0.35))
    leaves = []
    for si, pts in enumerate(shoots):
        d.line(pts, fill=(82, 66, 48, 255), width=(3 if tip else 4) * S)
        # rootlets: short pale hairs on the shoot's wall side
        for k in range(len(pts) - 1):
            for _ in range(3):
                t = rr.random(); p = (pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t)
                b = rr.uniform(0, 2 * math.pi); L = rr.uniform(4, 10) * S
                d.line([p, (p[0] + math.cos(b) * L, p[1] + math.sin(b) * L)], fill=(120, 100, 76, 255), width=1)
        # alternate leaves along it, tips hanging down and out; larger low on the shoot
        side = 1 if rr.random() < 0.5 else -1
        nodes = np.linspace(0.08, 0.96, 7 if tip else (8 if mat else 9))
        for k, t in enumerate(nodes):
            i = t * (len(pts) - 1); i0 = int(i); f = i - i0
            p = (pts[i0][0] + (pts[min(i0 + 1, len(pts) - 1)][0] - pts[i0][0]) * f, pts[i0][1] + (pts[min(i0 + 1, len(pts) - 1)][1] - pts[i0][1]) * f)
            side = -side
            w_m = (rr.uniform(0.03, 0.045) if tip else rr.uniform(0.045, 0.08) * (1.05 - 0.3 * t))
            size = w_m * px_m / 1.4
            pa = -math.pi / 2 + side * rr.uniform(0.9, 1.6)          # the petiole out to the side, up a little
            pl = size * rr.uniform(0.5, 0.9)
            q = (p[0] + math.cos(pa) * pl, p[1] + math.sin(pa) * pl)
            la = math.pi / 2 + side * rr.uniform(-0.2, 1.0)            # the blade's tip down and out
            leaves.append((rr.random(), p, q, size, la))
    for _, p, q, size, la in sorted(leaves, key=lambda l: l[0]):
        d.line([p, q], fill=(70, 78, 46, 255), width=2 * S)
        ivy_leaf(d, q[0], q[1], size, la, cols, rr)


def creeper_shoot(img, x0, y0, cols, seed, tip=False):
    rr = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    px_m = CELL / CREEPER_M
    pts = shoot_line(rr, (x0 + CELL / 2, y0 + CELL * 0.985), CELL * 0.92, 0.3)
    d.line(pts, fill=(92, 70, 52, 255), width=(2 if tip else 3) * S)
    if not tip:      # a side runner from low on the shoot
        q = pts[int(rr.integers(2, 4))]
        side_pts = shoot_line(rr, q, CELL * rr.uniform(0.4, 0.55), 0.45)
        d.line(side_pts, fill=(92, 70, 52, 255), width=2 * S)
    nn = 4 if tip else 4
    nodes = np.linspace(0.12, 0.9, nn) + rr.uniform(-0.04, 0.04, nn)
    side = 1 if rr.random() < 0.5 else -1
    spots = [(t, pts) for t in nodes] + ([(t, side_pts) for t in (0.5, 0.95)] if not tip else [])
    for t, line in spots:
        i = t * (len(line) - 1); i0 = int(i)
        p = line[i0]; side = -side
        # a tendril from the node, its branches ending in pads, on the far side of the leaf
        tendril(d, p, -math.pi / 2 - side * rr.uniform(0.4, 0.9), 0.05 * px_m * rr.uniform(0.7, 1.1), rr)
        size = (rr.uniform(0.04, 0.06) if tip else rr.uniform(0.065, 0.1)) * px_m
        pa = -math.pi / 2 + side * rr.uniform(0.5, 1.1)
        pl = size * rr.uniform(0.6, 1.0)
        q = (p[0] + math.cos(pa) * pl, p[1] + math.sin(pa) * pl)
        d.line([p, q], fill=(110, 46, 40, 255), width=2 * S)
        creeper_leaf(d, q[0], q[1], size, math.pi / 2 + side * rr.uniform(0.0, 0.9), cols, rr)


def tendril(d, p, a, L, rr, pads=True):
    """A branched tendril: three to five fine arms, each ending in a small round adhesive pad."""
    q = (p[0] + math.cos(a) * L * 0.4, p[1] + math.sin(a) * L * 0.4)
    d.line([p, q], fill=(104, 78, 50, 255), width=max(1, S))
    for k in range(int(rr.integers(3, 6))):
        b = a + rr.uniform(-0.9, 0.9)
        e = (q[0] + math.cos(b) * L * rr.uniform(0.35, 0.65), q[1] + math.sin(b) * L * rr.uniform(0.35, 0.65))
        mid = ((q[0] + e[0]) / 2 + rr.normal(0, L * 0.05), (q[1] + e[1]) / 2 + rr.normal(0, L * 0.05))
        d.line([q, mid, e], fill=(104, 78, 50, 255), width=max(1, S))
        if pads:
            r = rr.uniform(2.0, 3.2) * S
            d.ellipse([e[0] - r, e[1] - r, e[0] + r, e[1] + r], fill=(150, 120, 86, 255))


def quarters(img, x0, y0, seed):
    rr = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    Q = CELL // 2
    px_m = CELL / CREEPER_M
    for qx in (0, 1):            # two tendril knots on a bit of runner
        cx, cy = x0 + qx * Q + Q / 2, y0 + Q * 0.9
        d.line([(cx - Q * 0.3, cy), (cx + Q * 0.3, cy - Q * 0.1)], fill=(92, 70, 52, 255), width=2 * S)
        for k in range(3):
            tendril(d, (cx - Q * 0.2 + k * Q * 0.2, cy - k * Q * 0.033), -math.pi / 2 + rr.uniform(-0.6, 0.6), 0.06 * px_m, rr)
    # moss in a joint: a cushion of tiny tufts, olive to dark green, a little brown soil at its foot
    mx, my = x0 + Q / 2, y0 + Q * 1.5
    for k in range(900):
        r = Q * 0.42 * math.sqrt(rr.random()); a = rr.uniform(0, 2 * math.pi)
        x, y = mx + r * math.cos(a), my + r * math.sin(a) * 0.55
        c = [(74, 88, 44), (60, 76, 40), (92, 100, 50), (50, 62, 36), (82, 70, 46)][int(rr.integers(5))]
        rad = rr.uniform(2, 6) * S * (1 - 0.5 * r / (Q * 0.42))
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=shade(c, rr.uniform(0.8, 1.15)) + (255,))
    # fallen creeper leaflets and an ivy leaf or two
    for k in range(16):
        x, y = x0 + Q * 1.5 + rr.normal(0, Q * 0.17), y0 + Q * 1.5 + rr.normal(0, Q * 0.17)
        c = [CRIMSON, RED, ORANGE, BROWN, BURGUNDY][int(rr.integers(5))]
        creeper_leaflet(d, x, y, rr.uniform(0.04, 0.08) * px_m, rr.uniform(0, 2 * math.pi), shade(c, rr.uniform(0.75, 1.0)))


def coverage_mips(rgba):
    """Mipmaps whose cut-out (alpha over 0.5) covers as much as the full picture does (as the trees' atlas): far
    climbers stay mats and tracery instead of thinning to nothing."""
    a0 = rgba.astype(np.float32) / 255
    levels = [a0]
    cur = a0
    # the cover kept per row band (a shoot's cover is not a mat's)
    while cur.shape[0] > 1 and cur.shape[1] > 1:
        h, w = cur.shape[0] // 2, cur.shape[1] // 2
        pm = cur.copy(); pm[..., :3] *= pm[..., 3:4]
        nxt = pm[:h * 2, :w * 2].reshape(h, 2, w, 2, 4).mean((1, 3))
        al = nxt[..., 3:4]
        rgb = np.where(al > 1e-4, nxt[..., :3] / np.maximum(al, 1e-4), cur[:h * 2:2, :w * 2:2, :3])
        a_raw = al[..., 0]
        sc = (a0.shape[0] // h)
        out_a = a_raw.copy()
        band = max(1, 256 // sc)
        for y in range(0, h, band):
            ref = (a0[y * sc:(y + band) * sc, :, 3] > 0.5).mean()
            seg = a_raw[y:y + band]
            lo, hi = 0.5, 8.0
            for _ in range(22):
                mid = (lo + hi) / 2
                if (np.clip(seg * mid, 0, 1) > 0.5).mean() < ref: lo = mid
                else: hi = mid
            out_a[y:y + band] = np.clip(seg * hi, 0, 1)
        levels.append(np.concatenate([rgb, out_a[..., None]], -1))
        cur = np.concatenate([rgb, a_raw[..., None]], -1)
    return levels


def bleed(rgba):
    a = rgba[..., 3]
    rgb = Image.fromarray(rgba[..., :3]).filter(ImageFilter.MaxFilter(5))
    for _ in range(3): rgb = rgb.filter(ImageFilter.BoxBlur(3))
    out = rgba.copy()
    out[..., :3] = np.where((a > 8)[..., None], rgba[..., :3], np.asarray(rgb))
    return out


def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    img = Image.new('RGBA', (CELL * 4, CELL * 4 + 256 * S), (0, 0, 0, 0))
    ivy_shoot(img, 0 * CELL, 0, IVY_DARK, 11); ivy_shoot(img, 1 * CELL, 0, IVY_DARK, 12)
    ivy_shoot(img, 2 * CELL, 0, IVY_DARK, 13); ivy_shoot(img, 3 * CELL, 0, IVY_DARK, 14, mat=True)
    ivy_shoot(img, 0 * CELL, CELL, IVY_MID, 21); ivy_shoot(img, 1 * CELL, CELL, IVY_MID, 22)
    ivy_shoot(img, 2 * CELL, CELL, IVY_MID, 23, mat=True); ivy_shoot(img, 3 * CELL, CELL, IVY_MID + IVY_DARK, 24, tip=True)
    deep = [BURGUNDY, CRIMSON, CRIMSON, RED]
    creeper_shoot(img, 0 * CELL, 2 * CELL, deep, 31); creeper_shoot(img, 1 * CELL, 2 * CELL, [CRIMSON, RED, RED, BURGUNDY], 32)
    creeper_shoot(img, 2 * CELL, 2 * CELL, deep, 33); creeper_shoot(img, 3 * CELL, 2 * CELL, [RED, CRIMSON, ORANGE], 34, tip=True)
    creeper_shoot(img, 0 * CELL, 3 * CELL, [RED, ORANGE, ORANGE, CRIMSON], 41)
    creeper_shoot(img, 1 * CELL, 3 * CELL, [ORANGE, BROWN, DULL, ORANGE, RED], 42)
    creeper_shoot(img, 2 * CELL, 3 * CELL, [BROWN, CRIMSON, BURGUNDY, ORANGE], 43)
    quarters(img, 3 * CELL, 3 * CELL, 44)
    # the bark: fibres along x, a few darker cracks
    bw, bh = CELL * 4, 128 * S
    g = rng.random((bh // 8 + 2, bw // 64 + 2))
    fib = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((bw, bh), Image.BICUBIC), float) / 255
    fine = np.asarray(Image.fromarray((rng.random((bh // 2, bw // 24)) * 255).astype(np.uint8)).resize((bw, bh), Image.BICUBIC), float) / 255
    k = 0.55 + 0.35 * fib + 0.25 * (fine - 0.5)
    bark = np.dstack([104 * k, 84 * k, 64 * k, np.full(k.shape, 255.0)])
    img.paste(Image.fromarray(np.clip(bark, 0, 255).astype(np.uint8), 'RGBA'), (0, CELL * 4))
    # the rootlets: fine hairs either side of the strip's middle line, brown-grey, clear between
    roots = Image.new('RGBA', (bw, bh), (0, 0, 0, 0)); dr = ImageDraw.Draw(roots)
    for k in range(5200):
        x = rng.uniform(0, bw); side = 1 if rng.random() < 0.5 else -1
        L = rng.uniform(0.15, 0.48) * bh; a = math.pi / 2 * side + rng.normal(0, 0.45)
        y = bh / 2 + side * rng.uniform(0, 0.08) * bh
        mid = (x + math.cos(a) * L * 0.5 + rng.normal(0, 3), y + math.sin(a) * L * 0.5)
        c = shade((122, 102, 80), rng.uniform(0.75, 1.15))
        dr.line([(x, y), mid, (x + math.cos(a) * L, y + math.sin(a) * L)], fill=c + (255,), width=max(1, S - 1 + int(rng.random() < 0.3)))
    img.alpha_composite(roots, (0, CELL * 4 + bh))
    img = img.resize((2048, 2304), Image.LANCZOS)
    a = np.asarray(img).copy()
    rr = np.random.default_rng(1873)
    fine = np.asarray(Image.fromarray((rr.random((576, 512)) * 255).astype(np.uint8)).resize((2048, 2304), Image.BICUBIC), float) / 255
    k = 0.92 + 0.12 * fine
    a[..., :3] = np.clip(a[..., :3] * k[..., None], 0, 255).astype(np.uint8)
    a = bleed(a)
    img = Image.fromarray(a, 'RGBA')
    img.save(out / 'climbers.png')
    lum = np.asarray(img.convert('L'), float); blur = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(5)), float)
    Image.fromarray(np.clip(128 + (lum - blur) * 1.8, 0, 255).astype(np.uint8), 'L').save(out / 'climbers-height.png')
    levels = coverage_mips(a)
    with open(out / 'atlas-mips.bin', 'wb') as f:
        for lvl in levels: f.write(np.clip(lvl * 255 + 0.5, 0, 255).astype(np.uint8).tobytes())
    print('atlas', img.size, 'levels', len(levels))


if __name__ == '__main__':
    main()

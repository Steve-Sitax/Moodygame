"""The town wall's climbers (Steve, 2026-10-26: the vines on the city walls looked very fake; make them realistic, high
detail): a leaf atlas drawn here, no outside picture.
    python make_climber_atlas.py <out folder>
2048 x 2304 RGBA (cut out by alpha) and its height (grey), four rows of four cells (512 each), then a bark strip:
  row 0: common ivy (Hedera helix), dark green: four sprays, each a few three-to-five-lobed leaves on a short stalk
  row 1: ivy, lighter and sunlit
  row 2: Virginia creeper (Parthenocissus), autumn red: palmate leaves of five leaflets
  row 3: Virginia creeper turning: orange and yellow, some still green at the heart
  y 2048-2304: the woody stems' bark (grey-brown, fibrous, along x), opaque
A cell's foot (the bottom middle) is where its spray joins the stem. Fixed seed: the same picture every run.
"""
import sys, math, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # drawn at twice the size
CELL = 512 * S
rng = np.random.default_rng(1874)

def ivy_outline(cx, cy, size, ang, lobes):
    """An ivy leaf: pointed lobes (five or three) with shallow sinuses, a notch at the stalk; its base at (cx, cy),
    pointing at ang, size its tip's reach."""
    if lobes == 5: half = [(0, 1.0), (27, .52), (55, .8), (82, .45), (110, .62), (145, .38), (180, .2)]
    else: half = [(0, 1.0), (30, .55), (62, .78), (110, .55), (150, .36), (180, .2)]
    prof = [(-d, r) for d, r in reversed(half[1:])] + half
    pts = []
    for (d0, r0), (d1, r1) in zip(prof[:-1], prof[1:]):
        for k in range(6):
            t = k / 6; dd = d0 + (d1 - d0) * t; rr = r0 + (r1 - r0) * t - 0.06 * math.sin(math.pi * t) * (r0 > r1)
            a = ang + math.radians(dd)
            pts.append((cx + rr * size * math.cos(a), cy + rr * size * math.sin(a)))
    return pts

def creeper_leaf(d, cx, cy, size, ang, cols, rr):
    """Five leaflets fanned from one point (cx, cy) toward ang, each toothed, its own shade."""
    for k in range(5):
        a = ang + (k - 2) * 0.55
        L = size * (1.0 - 0.18 * abs(k - 2))
        pts = []
        for j in range(40):
            t = j / 39
            w = L * 0.32 * math.sin(math.pi * t) ** 0.8 * (1 + 0.12 * math.sin(t * 40))
            px = cx + math.cos(a) * L * t; py = cy + math.sin(a) * L * t
            pts.append((px - math.sin(a) * w, py + math.cos(a) * w))
        for j in range(39, -1, -1):
            t = j / 39
            w = L * 0.32 * math.sin(math.pi * t) ** 0.8 * (1 + 0.12 * math.sin(t * 40 + 1))
            px = cx + math.cos(a) * L * t; py = cy + math.sin(a) * L * t
            pts.append((px + math.sin(a) * w, py - math.cos(a) * w))
        c = cols[int(rr.integers(len(cols)))]; k2 = rr.uniform(0.82, 1.1)
        d.polygon(pts, fill=tuple(int(np.clip(v * k2, 0, 255)) for v in c) + (255,))
        d.line([(cx, cy), (cx + math.cos(a) * L * 0.9, cy + math.sin(a) * L * 0.9)], fill=tuple(int(v * 0.7) for v in c) + (255,), width=2 * S)

def spray(img, x0, y0, kind, cols, seed):
    rr = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    foot = (x0 + CELL / 2, y0 + CELL * 0.97)
    # the spray's stem: from the foot up, bending
    stem = [foot]
    a = -math.pi / 2 + rr.uniform(-0.3, 0.3)
    for k in range(6):
        a += rr.uniform(-0.35, 0.35)
        p = stem[-1]; stem.append((p[0] + math.cos(a) * CELL * 0.13, p[1] + math.sin(a) * CELL * 0.13))
    d.line(stem, fill=(88, 66, 44, 255), width=5 * S)
    leaves = []
    for k, p in enumerate(stem[1:]):
        for side in (-1, 1):
            if rr.random() < 0.15: continue
            la = -math.pi / 2 + side * rr.uniform(0.5, 1.3) + rr.uniform(-0.2, 0.2)
            size = CELL * rr.uniform(0.17, 0.24) * (1.1 - 0.06 * k)
            q = (p[0] + math.cos(la) * size * 0.35, p[1] + math.sin(la) * size * 0.35)
            d.line([p, q], fill=(90, 80, 50, 255), width=3 * S)
            leaves.append((q, la, size))
    leaves.append((stem[-1], -math.pi / 2, CELL * 0.12))
    for (q, la, size) in leaves:
        if kind == 'ivy':
            lobes = 5 if rr.random() < 0.6 else 3
            pts = ivy_outline(q[0] + math.cos(la) * size * 0.08, q[1] + math.sin(la) * size * 0.08, size * 0.5, la, lobes)
            c = cols[int(rr.integers(len(cols)))]; k2 = rr.uniform(0.85, 1.12)
            base = tuple(int(np.clip(v * k2, 0, 255)) for v in c)
            d.polygon(pts, fill=base + (255,))
            # pale veins from the base, the leaf's darker rim
            cx, cy = q[0] + size * 0.08 * math.cos(la), q[1] + size * 0.08 * math.sin(la)
            for vd, vr in ((0, .45), (55, .36), (-55, .36), (110, .27), (-110, .27))[:lobes]:
                va = la + math.radians(vd)
                d.line([(cx, cy), (cx + math.cos(va) * size * vr, cy + math.sin(va) * size * vr)], fill=tuple(min(255, int(x * 1.5 + 25)) for x in base) + (255,), width=max(1, S))
        else:
            creeper_leaf(d, q[0], q[1], size * 0.8, la, cols, rr)

def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    img = Image.new('RGBA', (CELL * 4, CELL * 4 + 256 * S), (0, 0, 0, 0))
    rows = [('ivy', [(38, 66, 30), (44, 74, 34), (32, 58, 28)]),
            ('ivy', [(62, 96, 44), (74, 108, 50), (54, 88, 40)]),
            ('creeper', [(150, 30, 26), (172, 40, 30), (128, 24, 30), (186, 58, 36)]),
            ('creeper', [(204, 104, 30), (220, 150, 40), (190, 80, 26), (120, 120, 40)])]
    for r, (kind, cols) in enumerate(rows):
        for c in range(4):
            spray(img, c * CELL, r * CELL, kind, cols, 100 * r + c)
    # the bark: fibres along x, a few darker cracks
    bw, bh = CELL * 4, 256 * S
    g = rng.random((bh // 8 + 2, bw // 64 + 2))
    fib = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((bw, bh), Image.BICUBIC), float) / 255
    fine = np.asarray(Image.fromarray((rng.random((bh // 2, bw // 24)) * 255).astype(np.uint8)).resize((bw, bh), Image.BICUBIC), float) / 255
    k = 0.55 + 0.35 * fib + 0.25 * (fine - 0.5)
    bark = np.dstack([96 * k, 78 * k, 60 * k, np.full(k.shape, 255.0)])
    img.paste(Image.fromarray(np.clip(bark, 0, 255).astype(np.uint8), 'RGBA'), (0, CELL * 4))
    img = img.resize((2048, 2304), Image.LANCZOS)
    a = np.asarray(img)
    bled = np.asarray(Image.fromarray(a[..., :3]).filter(ImageFilter.MaxFilter(5)))
    rgb = np.where((a[..., 3] > 8)[..., None], a[..., :3], bled)
    img = Image.fromarray(np.dstack([rgb, a[..., 3]]).astype(np.uint8), 'RGBA')
    img.save(out / 'climbers.png')
    lum = np.asarray(img.convert('L'), float); blur = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(5)), float)
    Image.fromarray(np.clip(128 + (lum - blur) * 1.8, 0, 255).astype(np.uint8), 'L').save(out / 'climbers-height.png')
    print('atlas', img.size)

if __name__ == '__main__':
    main()

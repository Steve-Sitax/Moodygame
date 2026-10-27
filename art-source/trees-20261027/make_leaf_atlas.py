"""The town's trees in late October (Steve, 2026-10-27: make the trees look better, some are still ugly): a leaf
atlas drawn here, no outside picture. It replaces the bake's 256 x 128 pixel-art leaf clumps.
    python make_leaf_atlas.py <out folder>
2048 x 2048 RGBA (cut out by alpha) in four rows of four cells (512 each), and its height (grey):
  row 0: common lime (Tilia x europaea): sprigs of heart-shaped, finely toothed leaves; yellow-green turning butter yellow
  row 1: London plane (Platanus x hispanica): big five-lobed leaves on long stalks; ochre, tan and a little green
  row 2: elm (Ulmus minor): oval, double-toothed leaves with a lopsided base, alternate along the twig; clear yellow
  row 3: bare twigs: fine dark twig fans (cells 0, 1 with a last few brown leaves; 2, 3 none)
A cell's foot (its bottom middle) is where the sprig joins the branch; the sprig reaches up the cell. Fixed seed.
Also writes the mipmaps with the leaves' cover kept (cut-out leaves otherwise thin to nothing far off): atlas-mips.bin
(RGBA8, level 0 first) for make-tree-material.gd.
"""
import sys, math, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # drawn at twice the size
CELL = 512 * S


def shade(c, k):
    return tuple(int(np.clip(v * k, 0, 255)) for v in c)


def blade(cx, cy, ang, L, W, kind):
    """A leaf's outline from its base (cx, cy) toward ang: length L, half width W."""
    pts_l, pts_r = [], []
    n = 48
    for j in range(n + 1):
        t = j / n
        if kind == 'lime':      # heart: broad near the base, a lobe each side of the stalk, drawn-out tip
            w = W * (math.sin(math.pi * min(1, t * 1.15)) ** 0.7) * (1 - 0.55 * t ** 2.5)
            w += W * 0.25 * math.exp(-((t - 0.08) / 0.07) ** 2)
            tooth = 0.035 * W * (1 if j % 2 else -1) * (0.08 < t < 0.95)
        else:                   # elm: oval, double toothed, one side longer at the base (lopsided)
            w = W * math.sin(math.pi * t) ** 0.85 * (1 - 0.15 * t)
            tooth = 0.05 * W * (1 if j % 2 else -1) * (1.0 if j % 4 < 2 else 0.5) * (0.06 < t < 0.96)
        wl = w + tooth; wr = w - tooth
        if kind == 'elm' and t < 0.2: wr *= 0.6 + 2 * t
        px = cx + math.cos(ang) * L * t; py = cy + math.sin(ang) * L * t
        pts_l.append((px - math.sin(ang) * wl, py + math.cos(ang) * wl))
        pts_r.append((px + math.sin(ang) * wr, py - math.cos(ang) * wr))
    return pts_l + pts_r[::-1]


def plane_leaf(cx, cy, ang, size):
    """A plane leaf: five pointed lobes, the middle three big, with shallow sinuses."""
    prof = [(0, 1.0), (22, .5), (42, .86), (62, .45), (88, .62), (118, .35), (150, .28), (180, .16)]
    prof = [(-d, r) for d, r in reversed(prof[1:])] + prof
    pts = []
    for (d0, r0), (d1, r1) in zip(prof[:-1], prof[1:]):
        for k in range(8):
            t = k / 8; dd = d0 + (d1 - d0) * t
            r = r0 + (r1 - r0) * t + 0.03 * math.sin(t * math.pi * 3)
            a = ang + math.radians(dd)
            pts.append((cx + r * size * math.cos(a), cy + r * size * math.sin(a)))
    return pts


def veins(d, cx, cy, ang, L, base, kind):
    vc = shade(base, 1.18) + (255,)
    d.line([(cx, cy), (cx + math.cos(ang) * L * 0.9, cy + math.sin(ang) * L * 0.9)], fill=vc, width=max(1, S))
    if kind == 'plane':
        for vd in (42, -42, 88, -88):
            a = ang + math.radians(vd)
            d.line([(cx, cy), (cx + math.cos(a) * L * 0.6, cy + math.sin(a) * L * 0.6)], fill=vc, width=max(1, S))
        return
    for k in range(1, 7 if kind == 'elm' else 5):
        t = k / (8 if kind == 'elm' else 6)
        px = cx + math.cos(ang) * L * t; py = cy + math.sin(ang) * L * t
        for side in (-1, 1):
            a = ang + side * (0.75 if kind == 'elm' else 0.95)
            d.line([(px, py), (px + math.cos(a) * L * 0.2, py + math.sin(a) * L * 0.2)], fill=vc, width=1)


def twig_line(d, pts, w0, w1, col):
    for i in range(len(pts) - 1):
        t = i / max(1, len(pts) - 2)
        d.line([pts[i], pts[i + 1]], fill=col, width=max(1, int(round(w0 + (w1 - w0) * t))))


def sprig(img, x0, y0, kind, cols, seed, leafy=True):
    """One sprig drawn on its own sheet, then scaled down if it must be to fit its cell, its foot at the cell's foot."""
    rr = np.random.default_rng(seed)
    sheet = Image.new('RGBA', (CELL * 2, CELL * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    foot = (CELL, CELL * 1.9)
    bark = (58, 48, 40) if kind != 'plane' else (92, 80, 62)
    leaves = []

    def grow(p, a, length, width, depth):
        pts = [p]
        steps = 7
        for k in range(steps):
            a += rr.uniform(-0.18, 0.18)
            q = pts[-1]; pts.append((q[0] + math.cos(a) * length / steps, q[1] + math.sin(a) * length / steps))
        twig_line(d, pts, width, max(1, width * 0.35), bark + (255,))
        # side shoots, alternate (lime, elm) or few (plane); the bare fans branch more
        for k in range(1, steps):
            q = pts[k]; side = 1 if k % 2 else -1
            if depth < (3 if kind == 'bare' else 2) and rr.random() < {'lime': 0.55, 'elm': 0.55, 'plane': 0.4}.get(kind, 0.8):
                grow(q, a + side * rr.uniform(0.35, 0.8), length * rr.uniform(0.38, 0.6), width * 0.6, depth + 1)
            if kind != 'bare' and rr.random() < (0.85 if kind == 'elm' else 0.6):
                leaves.append((q, a + side * rr.uniform(0.5, 1.2)))
            elif kind == 'bare' and leafy and rr.random() < 0.025:
                leaves.append((q, a + side * rr.uniform(0.5, 1.2)))
        if kind != 'bare' or (leafy and rr.random() < 0.25):
            leaves.append((pts[-1], a + rr.uniform(-0.3, 0.3)))

    base_a = -math.pi / 2 + rr.uniform(-0.2, 0.2)
    grow(foot, base_a, CELL * (0.62 if kind != 'bare' else 0.88), (7 if kind != 'bare' else 6) * S, 0)
    rr.shuffle(leaves)
    for (q, la) in leaves:
        c = cols[int(rr.integers(len(cols)))]; base = shade(c, rr.uniform(0.84, 1.12))
        if kind == 'lime':
            L = CELL * rr.uniform(0.13, 0.19); W = L * 0.48; stalk = L * 0.35
        elif kind == 'elm':
            L = CELL * rr.uniform(0.11, 0.15); W = L * 0.32; stalk = L * 0.08
        elif kind == 'plane':
            L = CELL * rr.uniform(0.2, 0.27); W = 0; stalk = L * 0.5
        else:
            L = CELL * rr.uniform(0.09, 0.13); W = L * 0.4; stalk = L * 0.3
        # leaves hang from their stalks a little
        la = la + 0.35 * math.cos(la) * (1.5 if kind == 'plane' else 1)
        s = (q[0] + math.cos(la) * stalk, q[1] + math.sin(la) * stalk)
        d.line([q, s], fill=shade(bark, 1.25) + (255,), width=max(1, S))
        if kind == 'plane':
            d.polygon(plane_leaf(s[0], s[1], la, L * 0.55), fill=base + (255,))
            veins(d, s[0], s[1], la, L * 0.5, base, 'plane')
        else:
            d.polygon(blade(s[0], s[1], la, L, W, 'elm' if kind == 'elm' else 'lime'), fill=base + (255,))
        # the leaf folds along its midrib: one half a little darker
        if kind != 'plane':
            half = blade(s[0], s[1], la, L, W, 'elm' if kind == 'elm' else 'lime')
            n = len(half) // 2
            d.polygon(half[:n] + [s], fill=shade(base, rr.uniform(0.8, 0.9)) + (255,))
            veins(d, s[0], s[1], la, L, base, kind)
        # a dried edge or a small brown blotch now and then (October), off the middle
        if rr.random() < 0.08:
            r = L * rr.uniform(0.04, 0.07); t = rr.uniform(0.5, 0.8); off = rr.uniform(-0.2, 0.2)
            px = s[0] + math.cos(la) * L * t * 0.6 - math.sin(la) * L * off; py = s[1] + math.sin(la) * L * t * 0.6 + math.cos(la) * L * off
            d.ellipse([px - r, py - r * 0.7, px + r, py + r * 0.7], fill=shade(base, 0.75) + (255,))
    # fit the cell: scale about the foot until the sprig's outline lies inside it
    box = sheet.getchannel('A').getbbox()
    if box is None: return
    halfw = max(foot[0] - box[0], box[2] - foot[0]); height = foot[1] - box[1]
    k = min(1.0, (CELL / 2 - 4) / halfw, (CELL * 0.97) / height)
    if k < 1.0:
        sheet = sheet.resize((int(CELL * 2 * k), int(CELL * 2 * k)), Image.LANCZOS)
    fx, fy = foot[0] * k, foot[1] * k
    px0, py0 = int(round(x0 + CELL / 2 - fx)), int(round(y0 + CELL * 0.985 - fy))
    cell = Image.new('RGBA', img.size, (0, 0, 0, 0)); cell.paste(sheet, (px0, py0))
    cell = cell.crop((x0, y0, x0 + CELL, y0 + CELL))
    img.alpha_composite(cell, (x0, y0))


def coverage_mips(rgba):
    """Mipmaps whose cut-out (alpha over 0.5) covers as much as the full picture does: each level's alpha is scaled
    until its cover matches level 0's (alpha-test coverage kept), so far crowns stay full instead of thinning out."""
    a0 = rgba.astype(np.float32) / 255
    target = (a0[..., 3] > 0.5).mean()
    levels = [a0]
    cur = a0
    while cur.shape[0] > 1 and cur.shape[1] > 1:
        h, w = cur.shape[0] // 2, cur.shape[1] // 2
        # premultiplied box filter, so the cut edge keeps the leaves' colour
        pm = cur.copy(); pm[..., :3] *= pm[..., 3:4]
        nxt = pm[:h * 2, :w * 2].reshape(h, 2, w, 2, 4).mean((1, 3))
        al = nxt[..., 3:4]
        rgb = np.where(al > 1e-4, nxt[..., :3] / np.maximum(al, 1e-4), cur[:h * 2:2, :w * 2:2, :3])
        a_raw = al[..., 0]
        lo, hi = 0.5, 8.0
        for _ in range(24):
            mid = (lo + hi) / 2
            if (np.clip(a_raw * mid, 0, 1) > 0.5).mean() < target: lo = mid
            else: hi = mid
        levels.append(np.concatenate([rgb, np.clip(a_raw * hi, 0, 1)[..., None]], -1))
        cur = np.concatenate([rgb, a_raw[..., None]], -1)
    return levels


def bleed(rgba):
    """The colour under the clear parts: the nearest leaves', so no dark fringe where the cut falls between texels."""
    a = rgba[..., 3]
    rgb = Image.fromarray(rgba[..., :3]).filter(ImageFilter.MaxFilter(5))
    for _ in range(3): rgb = rgb.filter(ImageFilter.BoxBlur(3))
    out = rgba.copy()
    out[..., :3] = np.where((a > 8)[..., None], rgba[..., :3], np.asarray(rgb))
    return out


def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    img = Image.new('RGBA', (CELL * 4, CELL * 4), (0, 0, 0, 0))
    lime = [(176, 166, 52), (196, 178, 58), (150, 150, 48), (214, 186, 70), (128, 132, 44)]
    lime_y = [(214, 182, 60), (226, 196, 78), (196, 168, 50), (176, 158, 52)]
    plane = [(170, 128, 56), (188, 146, 66), (146, 112, 52), (128, 120, 56), (196, 160, 82)]
    plane_b = [(150, 100, 50), (168, 118, 58), (132, 92, 46), (182, 136, 70)]
    elm = [(206, 176, 52), (220, 192, 70), (186, 160, 48), (164, 150, 52)]
    elm_g = [(170, 164, 58), (190, 172, 60), (146, 146, 52), (210, 184, 66)]
    dry = [(124, 84, 46), (140, 98, 52), (110, 74, 42)]
    rows = [('lime', [lime, lime, lime_y, lime_y]), ('plane', [plane, plane, plane_b, plane]),
            ('elm', [elm, elm_g, elm, elm_g]), ('bare', [dry, dry, dry, dry])]
    for r, (kind, cols) in enumerate(rows):
        for c in range(4):
            sprig(img, c * CELL, r * CELL, kind, cols[c], 1000 * r + c * 7 + 3, leafy=(c < 2))
    img = img.resize((2048, 2048), Image.LANCZOS)
    a = np.asarray(img).copy()
    # fine mottling (the leaves' own grain and tone), so no flat painted fills
    rr = np.random.default_rng(1873)
    fine = np.asarray(Image.fromarray((rr.random((512, 512)) * 255).astype(np.uint8)).resize((2048, 2048), Image.BICUBIC), float) / 255
    coarse = np.asarray(Image.fromarray((rr.random((64, 64)) * 255).astype(np.uint8)).resize((2048, 2048), Image.BICUBIC), float) / 255
    k = 0.9 + 0.12 * fine + 0.1 * (coarse - 0.5)
    a[..., :3] = np.clip(a[..., :3] * k[..., None], 0, 255).astype(np.uint8)
    a = bleed(a)
    img = Image.fromarray(a, 'RGBA')
    img.save(out / 'tree-leaves.png')
    lum = np.asarray(img.convert('L'), float); blur = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(4)), float)
    Image.fromarray(np.clip(128 + (lum - blur) * 1.6, 0, 255).astype(np.uint8), 'L').save(out / 'tree-leaves-height.png')
    levels = coverage_mips(a)
    with open(out / 'atlas-mips.bin', 'wb') as f:
        for lvl in levels:
            f.write(np.clip(lvl * 255 + 0.5, 0, 255).astype(np.uint8).tobytes())
    print('atlas', img.size, 'levels', len(levels), 'cover', round(float((a[..., 3] > 127).mean()), 3))


if __name__ == '__main__':
    main()

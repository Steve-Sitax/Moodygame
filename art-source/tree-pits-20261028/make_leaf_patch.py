"""The fallen leaves round a tree pit (#222, Codex: the leaves read as confetti, broad smooth blobs in an even ring).
    python make_leaf_patch.py <out png>
The picture lies flat over the pit and the paving round it (the bake's leaf patch, vegetation/INST168: one quad 4.2 m
across, its middle the tree): 1024 px, 4.1 mm a pixel, the pit's earth the middle 1.52 m, its blue-stone frame out to 1.8 m.
- Leaves the town's square trees drop (NativeTreePits): lime, heart-shaped with a lopsided base, a drawn-out point and a
  toothed edge, 5-10 cm, on a 1-3 cm stalk; plane, five-lobed, 10-18 cm; broken pieces 1-4 cm. Each has its midrib and
  side veins, a lit and a shaded half where it curls, a darker rim where its edge lifts.
- Late October colours (Codex's): ochre #A17A32, brown #765035, damp brown #49372A, a little fresh yellow #B49842,
  each leaf 0.78-0.98 of its colour (the game lights the picture again).
- Where they lie: in the earth about 20 % cover, thicker against two sides of the frame (the sheltered ones; the pit is
  turned a quarter at a time from tree to tree, so the drifts lie another way at each); outside, two narrow drifts along
  the frame's foot tapering out over 0.5-1.5 m, a few leaves blown farther, the swept paving round it almost bare.
Fixed seed. The alpha is cut at 0.5 in the game: a leaf is whole or nothing.
#240 (Codex: the pit's leaves flat and oversized on smooth earth): smaller leaves (lime 4-7.5 cm, plane 7-11 cm) and more
broken pieces (8 mm-3 cm); in the earth a litter about four times as thick, pressed into the soil: each leaf there damper and darker,
and the soil over parts of it (a ragged 2-3 cm noise cuts the leaf away where the earth covers it).
"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw

N = 1024
M = 4.2 / N                      # metres a pixel
SS = 4                           # supersampling of each leaf
rng = np.random.default_rng(1873)
COLOURS = [((0xA1, 0x7A, 0x32), 0.3), ((0x76, 0x50, 0x35), 0.32), ((0x49, 0x37, 0x2A), 0.3), ((0xB4, 0x98, 0x42), 0.08)]


def pick_colour():
    r = rng.random(); acc = 0
    for c, p in COLOURS:
        acc += p
        if r <= acc: break
    k = rng.uniform(0.78, 0.98)                                 # (the picture is lit again in the game: kept a little low)
    return np.clip(np.array(c, float) * k + rng.normal(0, 6, 3), 0, 255)


def smooth_path(ctrl, per=8):
    """Catmull-Rom through the control points (open)."""
    P = [ctrl[0]] + ctrl + [ctrl[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = map(np.array, (P[i - 1], P[i], P[i + 1], P[i + 2]))
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(ctrl[-1]))
    return out


def lime_outline():
    """A heart: base at (0, 0), tip at (0, 1); the base's two lobes unequal, the point drawn out, the edge toothed."""
    def half(lobe, wide):
        ctrl = [(0, 0), (0.1 * wide, -lobe), (0.3 * wide, -lobe * 0.8), (0.45 * wide, 0.08), (0.5 * wide, 0.28), (0.45 * wide, 0.5),
                (0.33 * wide, 0.68), (0.18 * wide, 0.83), (0.06 * wide, 0.94), (0, 1.0)]
        pts = smooth_path(ctrl, 7)
        # the teeth: every other point a little in, along the outer edge only
        return [(x * (0.94 if (k % 2 and 6 < k < len(pts) - 4) else 1), y) for k, (x, y) in enumerate(pts)]
    wide = rng.uniform(0.9, 1.1)
    right = half(rng.uniform(0.07, 0.12), wide)
    left = [(-x, y) for x, y in half(rng.uniform(0.02, 0.07), wide)]
    return right + left[::-1]


def plane_outline(n=150):
    """Five pointed lobes round the stalk's end, the middle one longest, the sinuses cut deep, a tooth or two a lobe."""
    pts = []
    for k in range(n):
        a = -math.pi * 0.9 + 1.8 * math.pi * k / (n - 1)
        f = (a / (1.8 * math.pi) + 0.5) * 5                          # 0..5 across the lobes
        tri = 1 - abs((f % 1) * 2 - 1)                              # 0 at a sinus, 1 at a lobe's point
        lobe = int(min(f, 4.999))
        reach = (0.8, 0.95, 1.0, 0.95, 0.8)[lobe]
        r = 0.24 + 0.28 * reach * tri ** 0.75 + (0.02 if k % 5 == 0 and tri > 0.3 else 0)
        pts.append((r * math.sin(a), 0.42 + r * math.cos(a)))
    return pts


def draw_leaf(canvas, cx, cy, size_m, angle, kind):
    """One leaf onto the canvas (RGBA float array), its base at the middle of its box."""
    L = size_m / M * SS                                           # length in supersampled pixels
    box = int(L * 1.5) + 8
    tile = Image.new('RGBA', (box, box), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    o = box / 2
    ca, sa = math.cos(angle), math.sin(angle)
    curl = rng.uniform(-1, 1)
    def tp(x, y):  # leaf space (x across, y along, base 0, tip 1) to tile pixels
        x *= L; y = (y - 0.45) * L
        return (o + x * ca - y * sa, o + x * sa + y * ca)
    outline = lime_outline() if kind == 'lime' else plane_outline() if kind == 'plane' else None
    col = pick_colour()
    if outline is None:                                           # a broken piece: a ragged scrap of a leaf
        k = int(rng.integers(5, 9))
        outline = [(0.35 * math.cos(2 * math.pi * i / k) * rng.uniform(0.5, 1.1), 0.45 + 0.35 * math.sin(2 * math.pi * i / k) * rng.uniform(0.5, 1.1)) for i in range(k)]
    d.polygon([tp(x, y) for x, y in outline], fill=(255, 255, 255, 255))
    a = np.asarray(tile).astype(float)
    mask = a[:, :, 3] / 255
    # the curl: across the leaf one half lit, the other in its own shade; darker toward a lifted rim
    yy, xx = np.mgrid[0:box, 0:box]
    lx = ((xx - o) * ca + (yy - o) * sa) / L                      # across
    shade = 1 + 0.16 * curl * np.tanh(lx * 6)
    rim = mask.copy()
    from PIL import ImageFilter
    inner = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(max(3, int(L * 0.06) | 1)))).astype(float) / 255
    shade *= 1 - 0.18 * (mask - inner)
    rgb = col[None, None, :] * shade[:, :, None]
    veins = Image.new('L', (box, box), 0)
    dv = ImageDraw.Draw(veins)
    wv = max(1, int(L * 0.018))
    if kind == 'lime':
        dv.line([tp(0, 0), tp(0.02 * curl, 0.5), tp(0, 0.95)], fill=255, width=wv)
        for i in range(5):
            y = 0.12 + 0.15 * i
            for side in (1, -1):
                dv.line([tp(0, y), tp(side * 0.3 * (1 - y * 0.5), y + 0.16)], fill=170, width=max(1, wv - 1))
    elif kind == 'plane':
        for k in range(5):
            aa = -1.0 + 0.5 * k
            dv.line([tp(0, 0.42), tp(0.5 * math.sin(aa), 0.42 + 0.5 * math.cos(aa))], fill=255, width=wv)
    vn = np.asarray(veins).astype(float) / 255 * mask
    # veins a shade paler on the upper side of a dry leaf, darker on a damp one
    vk = 1.12 if col.mean() > 100 else 0.82
    rgb = rgb * (1 + (vk - 1) * vn[:, :, None])
    out = np.dstack([np.clip(rgb, 0, 255), mask * 255])
    # the stalk, 1-3 cm, from the base
    stalk = rng.uniform(0.012, 0.03) / size_m
    small = Image.fromarray(out.astype(np.uint8), 'RGBA')
    ds = ImageDraw.Draw(small)
    ds.line([tp(0, 0.02), tp(0.03 * curl, -stalk)], fill=tuple(int(c * 0.8) for c in col) + (255,), width=max(1, int(L * 0.025)))
    small = small.resize((box // SS, box // SS), Image.LANCZOS)
    s = np.asarray(small).astype(float)
    x0, y0 = int(cx - s.shape[1] / 2), int(cy - s.shape[0] / 2)
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(N, x0 + s.shape[1]), min(N, y0 + s.shape[0])
    if xa >= xb or ya >= yb: return
    sub = s[ya - y0:yb - y0, xa - x0:xb - x0]
    al = sub[:, :, 3:4] / 255
    canvas[ya:yb, xa:xb, :3] = canvas[ya:yb, xa:xb, :3] * (1 - al) + sub[:, :, :3] * al
    canvas[ya:yb, xa:xb, 3:4] = np.maximum(canvas[ya:yb, xa:xb, 3:4], sub[:, :, 3:4])


def main():
    out = sys.argv[1]
    canvas = np.zeros((N, N, 4))
    canvas[:, :, :3] = np.array(COLOURS[1][0], float)            # (the colour under the cut-out edges, for the filtering)
    c = N / 2
    earth, frame = 0.76, 0.9                                      # half widths, m
    # where leaves lie: a density over the picture, in m from the middle
    ys, xs = np.mgrid[0:N, 0:N]
    X, Z = (xs + 0.5 - c) * M, (ys + 0.5 - c) * M
    ax, az = np.abs(X), np.abs(Z)
    inside = (ax < earth) & (az < earth)
    dens = np.where(inside, 0.55 + 0.45 * np.clip(1 - (earth - X) / 0.4, 0, 1) ** 1.5 + 0.3 * np.clip(1 - (earth - Z) / 0.3, 0, 1) ** 1.5, 0.0)
    # outside: the frame's foot on its two sheltered sides (+x, +z), drifting out 0.5-1.5 m, raggedly
    dx = X - frame; dz = Z - frame
    reach = 0.5 + 1.0 * (0.5 + 0.5 * np.sin(Z * 2.3 + 1.1) * np.sin(Z * 0.9))
    drift_x = np.where((dx > 0) & (az < frame + 0.3), np.exp(-dx / (reach * 0.4)) * 0.6, 0)
    reach_z = 0.5 + 1.0 * (0.5 + 0.5 * np.sin(X * 1.9 + 2.3) * np.sin(X * 1.1 + 0.4))
    drift_z = np.where((dz > 0) & (ax < frame + 0.5), np.exp(-dz / (reach_z * 0.4)) * 0.45, 0)
    stray = np.where(~inside & ((ax > frame) | (az > frame)), 0.025 * np.exp(-np.hypot(X, Z) / 1.4), 0)
    dens = np.maximum(dens, np.maximum(drift_x, drift_z)) + stray
    dens *= np.clip((2.05 - np.hypot(X, Z)) / 0.25, 0, 1)        # nothing at the quad's edge
    dens[(ax >= earth) & (ax < frame) & (az < frame)] = 0           # (the frame's top: leaves under it would not show)
    dens[(az >= earth) & (az < frame) & (ax < frame)] = 0
    # a leaf a try, in order of density: area of a leaf ~ 0.5 * size^2
    placed = 0
    cover_goal = (dens * M * M).sum()
    area = 0.0
    tries = 0
    while area < cover_goal and tries < 200000:
        tries += 1
        px, py = rng.uniform(0, N), rng.uniform(0, N)
        if rng.random() > dens[int(py), int(px)] * 2.2: continue
        r = rng.random()
        kind, size = ('piece', rng.uniform(0.008, 0.03)) if r < 0.35 else ('plane', rng.uniform(0.07, 0.11)) if r < 0.42 else ('lime', rng.uniform(0.04, 0.075))
        draw_leaf(canvas, px, py, size, rng.uniform(0, 2 * math.pi), kind)
        area += size * size * (0.42 if kind == 'lime' else 0.4 if kind == 'plane' else 0.3)
        placed += 1
    # pressed into the soil (#240): in the earth each leaf damper and darker, and the earth over parts of it
    def value_noise(cell):
        g = rng.random((int(N * M / cell) + 3,) * 2)
        u = (xs + 0.5) * M / cell; v = (ys + 0.5) * M / cell
        i, j = u.astype(int), v.astype(int); fu, fv = u - i, v - j
        fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
        return (g[j, i] * (1 - fu) + g[j, i + 1] * fu) * (1 - fv) + (g[j + 1, i] * (1 - fu) + g[j + 1, i + 1] * fu) * fv
    soil = value_noise(0.028) * 0.65 + value_noise(0.011) * 0.35
    soft = np.clip(1 - (np.maximum(ax, az) - (earth - 0.05)) / 0.05, 0, 1) * inside
    canvas[:, :, :3] *= (1 - 0.12 * soft)[:, :, None]
    canvas[:, :, 3] *= np.where((soft > 0) & (soil > 0.66 - 0.04 * soft), 0, 1)
    img = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), 'RGBA')
    img.save(out)
    a = np.asarray(img)[:, :, 3] > 127
    inside_cov = a[inside].mean(); foot = a[(dx > 0) & (dx < 0.4) & (az < frame)].mean(); far = a[np.hypot(X, Z) > 1.6].mean()
    print(f'{placed} leaves; cover in the earth {inside_cov:.0%}, at the frame foot (+x, 0.4 m) {foot:.0%}, past 1.6 m {far:.1%}')


if __name__ == '__main__':
    main()

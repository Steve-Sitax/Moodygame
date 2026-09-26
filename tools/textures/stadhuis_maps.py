"""The town hall's pictures and their height maps (the Stadhuis in detail, 2026-09-26).

    python tools/textures/stadhuis_maps.py <folder with the Codex PNGs>      all of them
    python tools/textures/stadhuis_maps.py <folder> --only slate glass       some
    python tools/textures/stadhuis_maps.py --arms                            the painted arms only

Reads the original Codex pictures (<name>.png: limestone, carved, bluestone, slate, glass, oak), prints each one's
SHA-256 (assets/ATTRIBUTION.md), checks that it tiles (and blends the seam when it does not), resizes it and writes
client/public/textures/stadhuis_<name>.jpg. From that very jpg it works out the height map
stadhuis_<name>_h.png, so the bumps lie exactly under what the picture shows: the ashlar's joints sunk and the
blocks' arrises rounded; the slates as courses, each slate highest at its lower edge with a drop to the next;
the lead cames of the glass standing proud of the panes; the oak's grooves sunk and its nail heads raised; the
dressed stone and the bluestone only their fine tooling. Also paints the three coats of arms (stadhuis_arms.png)
with their height map (the charges and the rim raised). The game (client/src/world/stadhuisShell.ts) loads each
picture with its height map as a bump map on the same uv.

Previews (the picture, its height, and the picture lit by a raking light from the height alone) go to --preview.
"""
import argparse
import hashlib
import os

import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TEX = os.path.join(ROOT, "client", "public", "textures")

# name: (kind, size in px)
PICS = {
    "limestone": ("ashlar", 1024),
    "carved": ("fine", 1024),
    "bluestone": ("fine", 1024),
    "slate": ("slate", 1024),
    "glass": ("glass", 512),
    "oak": ("oak", 512),
}


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def tile3(a):
    return np.tile(a, (3, 3) + (1,) * (a.ndim - 2))


def mid(a, n):
    return a[n:2 * n, n:2 * n]


def seam_error(img):
    """How much the picture jumps at its wrap, against how much it changes between neighbour columns anyway."""
    f = img.astype(np.float32)
    inner = np.mean(np.abs(f[:, 1:] - f[:, :-1])) + np.mean(np.abs(f[1:] - f[:-1]))
    wrap = np.mean(np.abs(f[:, 0] - f[:, -1])) + np.mean(np.abs(f[0] - f[-1]))
    return wrap / max(inner, 1e-6)


def make_seamless(img, band=0.12):
    """Blend the picture with itself rolled by half, the rolled copy showing only near the old edges."""
    h, w = img.shape[:2]
    rolled = np.roll(np.roll(img, h // 2, 0), w // 2, 1).astype(np.float32)
    y = np.minimum(np.arange(h), h - 1 - np.arange(h)) / (h * band)
    x = np.minimum(np.arange(w), w - 1 - np.arange(w)) / (w * band)
    wy = np.clip(1 - y, 0, 1)[:, None]
    wx = np.clip(1 - x, 0, 1)[None, :]
    k = np.maximum(wy, wx)[..., None]
    k = k * k * (3 - 2 * k)
    return np.clip(img.astype(np.float32) * (1 - k) + rolled * k, 0, 255).astype(np.uint8)


def lum(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0


def norm01(a, lo=1, hi=99):
    a0, a1 = np.percentile(a, lo), np.percentile(a, hi)
    return np.clip((a - a0) / max(a1 - a0, 1e-6), 0, 1)


def blur(a, s):
    if s <= 0:
        return a
    n, m = a.shape[:2]  # (wrapped: the pictures tile)
    return cv2.GaussianBlur(np.tile(a, (3, 3) + (1,) * (a.ndim - 2)), (0, 0), s)[n:2 * n, m:2 * m]


def lines_mask(dark, n, along, length, width):
    """Long straight dark lines (joints, cames): the darkness opened with a line kernel, on a 3 x 3 tiling."""
    t = tile3(dark)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (length, width) if along == "h" else (width, length))
    return mid(cv2.morphologyEx(t, cv2.MORPH_OPEN, k), n)


def blackhat(l, n, size):
    t = tile3(l)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    return mid(cv2.morphologyEx(t, cv2.MORPH_BLACKHAT, k), n)


def fine(l, s1=1.0, s2=6.0):
    """The fine grain of a surface: its light, high-passed (lighter a little higher), smoothed a touch."""
    return blur(l, s1) - blur(l, s2)


def h_fine(img):
    n = img.shape[0]
    l = lum(img)
    g = fine(l, 0.8, n / 96)
    pits = blackhat(l, n, max(5, n // 110))  # pores and chisel strokes: small dark pits sink
    h = 0.5 + 2.2 * g - 1.4 * pits
    return norm01(blur(h, 0.6), 0.5, 99.5)


def h_ashlar(img):
    n = img.shape[0]
    l = lum(img)
    bh = blackhat(l, n, max(9, n // 40))
    bh = norm01(bh, 50, 99.7)
    hor = lines_mask(bh, n, "h", n // 6, 1)
    ver = lines_mask(bh, n, "v", n // 20, 1)
    joint = np.clip(np.maximum(hor, ver) * 1.6, 0, 1)
    joint = cv2.dilate(joint, np.ones((2, 2), np.uint8))
    # the blocks: high, their arrises rounded into the joints; the face its own tooling and pits
    block = 1.0 - blur(joint, n / 400)
    arris = 1.0 - blur(joint, n / 130)
    h = 0.62 * block + 0.2 * arris + 0.9 * fine(l, 0.8, n / 96) - 0.5 * blackhat(l, n, max(5, n // 150))
    return norm01(h, 0.5, 99.8), joint


def h_slate(img):
    n = img.shape[0]
    l = lum(img)
    bh = norm01(blackhat(l, n, max(9, n // 36)), 50, 99.7)
    hor = lines_mask(bh, n, "h", n // 14, 1)
    ver = lines_mask(bh, n, "v", n // 12, 1)  # (a joint runs most of a course: the lichen's specks never do)
    hor = np.clip(hor * 1.8, 0, 1)
    # the course lines: rows where the shadow under a slate's lower edge runs; per column the next line below
    # (a course line runs on: smoothed along the row, so a lichen spot never starts a false one)
    line = mid(cv2.blur(tile3(hor), (max(15, n // 30), 1)), n) > 0.4
    t = np.vstack([line, line, line])
    rows = np.arange(t.shape[0])[:, None].astype(np.float32)
    big = 1e9
    below = np.where(t, rows, big)
    below = np.minimum.accumulate(below[::-1], axis=0)[::-1]
    above = np.where(t, rows, -big)
    above = np.maximum.accumulate(above, axis=0)
    d_below = (below - rows)[n:2 * n]
    d_above = (rows - above)[n:2 * n]
    span = np.clip(d_below + d_above, 1, n)
    ramp = np.clip(d_above / span, 0, 1)  # 0 just under the slate above, 1 at its own lower edge
    ramp = np.where(span > n / 4, 0.5, ramp)  # (no course lines found in this column: flat)
    h = 0.25 + 0.6 * ramp - 0.35 * np.clip(ver * 1.8, 0, 1) - 0.3 * hor + 0.8 * fine(l, 0.8, n / 80)
    return norm01(blur(h, 0.7), 0.5, 99.5)


def came_lines(l, count, axis, seg=8, search=None):
    """Where the lead cames of a regular grid run: `count` lines across `axis` (0: rows, horizontal cames).
    A came is a narrow band with an edge on each side, so the edge energy summed over its width peaks on it; the
    grid's phase comes from the whole picture, then each line is found again in `seg` strips along it (the cames
    are drawn by hand: they wander a little). Returns for each strip the line positions, in px."""
    n = l.shape[0]
    a = l if axis == 0 else l.T
    e = np.abs(np.diff(blur(a, 1.0), axis=0, append=a[:1]))
    band = max(3, n // 64)
    t = np.vstack([e, e, e])
    energy = cv2.blur(t, (1, 2 * band + 1))[n:2 * n]
    prof = energy.mean(1)
    per = n / count
    phase = max(range(int(per)), key=lambda y0: sum(prof[int(y0 + k * per) % n] for k in range(count)))
    search = search or int(per * 0.18)
    out = []
    for j in range(seg):
        x0, x1 = j * n // seg, (j + 1) * n // seg
        pj = energy[:, x0:x1].mean(1)
        ys = []
        for k in range(count):
            y = int(phase + k * per)
            cand = [(pj[(y + d) % n], (y + d) % n) for d in range(-search, search + 1)]
            ys.append(max(cand)[1])
        out.append(ys)
    return out, band


def h_glass(img):
    n = img.shape[0]
    l = lum(img)
    came = np.zeros_like(l)
    yy = np.arange(n, dtype=np.float32)
    for axis, count in ((0, 5), (1, 4)):
        lines, band = came_lines(l, count, axis)
        seg = len(lines)
        # a smooth line through the strips' positions (by column), then a rounded came across it
        centres = (np.arange(seg) + 0.5) * n / seg
        mask = np.zeros_like(l)
        for k in range(count):
            pos = np.array([ln[k] for ln in lines], np.float32)
            pos = pos[0] + ((pos - pos[0] + n / 2) % n - n / 2)  # (unwrapped near the edge)
            along = np.interp(np.arange(n), np.concatenate([centres - n, centres, centres + n]), np.concatenate([pos, pos, pos]))
            d = np.abs(((yy[:, None] - along[None, :]) + n / 2) % n - n / 2)
            mask = np.maximum(mask, np.clip(1.0 - (d / (band * 1.25)) ** 2, 0, 1))
        came = np.maximum(came, mask if axis == 0 else mask.T)
    # the glass a little bulged and rippled, the lead standing proud and rounded over it
    pane = 0.2 + 0.25 * norm01(fine(l, 1.5, n / 30))
    h = np.maximum(pane, 0.25 + 0.75 * np.sqrt(came))
    return norm01(h, 0.5, 99.8)


def h_oak(img):
    n = img.shape[0]
    l = lum(img)
    bh = norm01(blackhat(l, n, max(9, n // 30)), 50, 99.7)
    groove = np.clip(lines_mask(bh, n, "v", n // 5, 1) * 1.8, 0, 1)
    # the battens: the rows the planks' grooves do not cross; they stand on the boards
    cover = mid(cv2.blur(tile3(groove), (1, 9)), n).mean(1)
    batten = (cover < 0.25 * np.median(cover)).astype(np.float32)
    batten = cv2.morphologyEx(batten[:, None], cv2.MORPH_OPEN, np.ones((5, 1), np.uint8))[:, 0]
    bat = np.repeat(batten[:, None], n, 1).astype(np.float32)
    # the nail heads: the darkest small blobs on the battens, raised
    dark = (l < np.percentile(l[bat > 0.5], 8)) & (bat > 0.5) if bat.max() > 0 else np.zeros_like(l, bool)
    nails = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(np.float32)
    grain = fine(l, 0.7, n / 60)
    h = 0.45 - 0.35 * blur(groove * (1 - bat), 1.0) + 0.25 * blur(bat, 1.2) + 0.25 * blur(nails, 1.0) + 0.9 * grain
    return norm01(h, 0.5, 99.5)


def relit(h, img, strength=6.0, light=(0.85, 0.25, 0.47)):
    """The picture lit by a raking light from the height alone (a check that the bumps follow the picture)."""
    hx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    hy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nrm = np.dstack([-hx, hy, np.ones_like(h)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    L = np.array(light, np.float32)
    L /= np.linalg.norm(L)
    d = np.clip(nrm @ L, 0, 1)
    d = d / max(float(np.percentile(d, 99)), 1e-3)
    return np.clip(img.astype(np.float32) * (0.35 + 0.9 * d[..., None]), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- the arms (painted, with their heights)

AW, AH = 512, 256  # three cells of a third each


def shield_poly(cx, w, h, pad=0.0):
    """The shield of build_stadhuis.py arms(): flat top, round point; in the cell (x right, y down)."""
    import math
    curve = [(math.cos(a), 0.1 - 1.1 * math.sin(a)) for a in (math.pi / 2 * k / 6 for k in range(1, 6))]
    shape = [(-1.0, 1.0), (1.0, 1.0), (1.0, 0.1)] + curve + [(0.0, -1.0)] + [(-x, y) for x, y in reversed(curve)] + [(-1.0, 0.1)]
    return np.array([[cx + x * (w / 2 - pad), h / 2 - y * (h / 2 - pad)] for x, y in shape], np.float32)


def lion(c, h, x0, y0, s, col, hv=0.9):
    """A lion rampant, facing left (heraldic dexter), painted in colour and raised in the height map."""
    pts = [(0.5, 0.95), (0.42, 0.78), (0.3, 0.72), (0.22, 0.6), (0.3, 0.55), (0.26, 0.42), (0.18, 0.36), (0.22, 0.3), (0.3, 0.33), (0.33, 0.24),
           (0.28, 0.14), (0.36, 0.08), (0.46, 0.12), (0.5, 0.2), (0.58, 0.22), (0.62, 0.35), (0.7, 0.45), (0.8, 0.3), (0.86, 0.12), (0.92, 0.18),
           (0.86, 0.38), (0.74, 0.58), (0.68, 0.72), (0.74, 0.86), (0.66, 0.95), (0.6, 0.82)]
    p = np.array([[x0 + x * s, y0 + y * s] for x, y in pts], np.int32)
    cv2.fillPoly(c, [p], col)
    cv2.fillPoly(h, [p], hv)


def eagle2(c, h, cx, cy, s, col, hv=0.9):
    """A double-headed eagle displayed: body, spread wings with their feathers, two necks and heads, the tail."""
    body = [(0, -0.12), (0.1, -0.02), (0.12, 0.25), (0.06, 0.42), (-0.06, 0.42), (-0.12, 0.25), (-0.1, -0.02)]
    wing = [(0.08, -0.02), (0.28, -0.34), (0.52, -0.3), (0.47, -0.17), (0.55, -0.1), (0.46, -0.02), (0.52, 0.07), (0.4, 0.12), (0.44, 0.22),
            (0.3, 0.22), (0.1, 0.16)]
    neck = [(0.02, -0.08), (0.12, -0.3), (0.19, -0.27), (0.08, -0.04)]
    head = [(0.1, -0.33), (0.16, -0.42), (0.24, -0.4), (0.3, -0.36), (0.22, -0.34), (0.2, -0.29)]
    tail = [(-0.08, 0.38), (0.08, 0.38), (0.18, 0.6), (0.06, 0.55), (0, 0.62), (-0.06, 0.55), (-0.18, 0.6)]
    legs = [(0.06, 0.3), (0.18, 0.44), (0.24, 0.42), (0.1, 0.28)]
    polys = [body, tail]
    for q in (wing, neck, head, legs):
        polys += [q, [(-x, y) for x, y in q]]
    for q in polys:
        p = np.array([[cx + x * s, cy + y * s] for x, y in q], np.int32)
        cv2.fillPoly(c, [p], col)
        cv2.fillPoly(h, [p], hv)
    for sg in (-1, 1):  # red tongues and a gold eye
        cv2.circle(c, (int(cx + sg * 0.19 * s), int(cy - 0.37 * s)), max(1, int(0.015 * s)), (40, 160, 205), -1)


def castle(c, h, cx, cy, s, col, hv=0.85):
    for x0, x1, y0, y1 in ((-0.4, 0.4, -0.05, 0.4), (-0.45, -0.2, -0.35, 0.4), (0.2, 0.45, -0.35, 0.4), (-0.12, 0.12, -0.45, 0.0)):
        p = np.array([[cx + x0 * s, cy + y0 * s], [cx + x1 * s, cy + y0 * s], [cx + x1 * s, cy + y1 * s], [cx + x0 * s, cy + y1 * s]], np.int32)
        cv2.fillPoly(c, [p], col)
        cv2.fillPoly(h, [p], hv)
    p = np.array([[cx - 0.1 * s, cy + 0.4 * s], [cx + 0.1 * s, cy + 0.4 * s], [cx + 0.1 * s, cy + 0.15 * s], [cx - 0.1 * s, cy + 0.15 * s]], np.int32)
    cv2.fillPoly(c, [p], (40, 30, 30))
    cv2.fillPoly(h, [p], 0.4)


def paint_arms():
    S = 3  # paint at three times the size, then shrink
    W, H = AW * S, AH * S
    col = np.zeros((H, W, 3), np.uint8)
    hgt = np.zeros((H, W), np.float32)
    stone = (178, 190, 198)  # BGR: pale limestone round the shields
    col[:] = stone
    hgt[:] = 0.3
    cw = W // 3
    gold, black, red, white, blue, purple = (40, 160, 205), (32, 30, 30), (38, 40, 165), (220, 222, 222), (140, 70, 30), (120, 40, 110)
    for k, which in enumerate(("brabant", "spain", "antwerp")):
        x0 = k * cw
        poly = shield_poly(x0 + cw / 2, cw, H, pad=2 * S)
        mask = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mask, [poly.astype(np.int32)], 1)
        cell = np.zeros_like(col)
        ch = np.zeros_like(hgt)
        if which == "brabant":
            cell[:] = black
            ch[:] = 0.5
            lion(cell, ch, x0 + cw * 0.12, H * 0.14, cw * 0.78, gold)
        elif which == "antwerp":
            cell[:] = gold
            ch[:] = 0.5
            eagle2(cell, ch, x0 + cw / 2, H * 0.44, cw * 0.95, black)
        else:  # Philip II, in short: Castile and Leon, Aragon, Austria and Burgundy, Brabant; Portugal over all
            q = [(x0, 0, x0 + cw // 2, H // 2), (x0 + cw // 2, 0, x0 + cw, H // 2), (x0, H // 2, x0 + cw // 2, H), (x0 + cw // 2, H // 2, x0 + cw, H)]
            ch[:] = 0.5
            # 1: Castile (red, a gold castle) and Leon (white, a purple lion) quartered
            a, b, c2, d = q[0]
            mx, my = (a + c2) // 2, (b + d) // 2
            cell[b:my, a:mx] = red
            cell[my:d, mx:c2] = red
            cell[b:my, mx:c2] = white
            cell[my:d, a:mx] = white
            castle(cell, ch, (a + mx) / 2, (b + my) / 2, (mx - a) * 0.8, gold)
            castle(cell, ch, (mx + c2) / 2, (my + d) / 2, (mx - a) * 0.8, gold)
            lion(cell, ch, mx + 6 * S, b + 8 * S, (c2 - mx) * 0.8, purple)
            lion(cell, ch, a + 6 * S, my + 8 * S, (mx - a) * 0.8, purple)
            # 2: Aragon, gold with red pales
            a, b, c2, d = q[1]
            cell[b:d, a:c2] = gold
            for j in range(4):
                xa = a + int((j * 2 + 1) * (c2 - a) / 8)
                cell[b:d, xa:xa + (c2 - a) // 8] = red
                ch[b:d, xa:xa + (c2 - a) // 8] = 0.62
            # 3: Austria (red, a white fess) over Burgundy ancient (bendy gold and blue)
            a, b, c2, d = q[2]
            my = (b + d) // 2
            cell[b:my, a:c2] = red
            cell[b + (my - b) // 3:b + 2 * (my - b) // 3, a:c2] = white
            ch[b + (my - b) // 3:b + 2 * (my - b) // 3, a:c2] = 0.62
            yy, xx = np.mgrid[my:d, a:c2]
            bend = ((xx - yy) // (8 * S)) % 2 == 0
            cell[my:d, a:c2][bend] = gold
            cell[my:d, a:c2][~bend] = blue
            ch[my:d, a:c2][bend] = 0.6
            # 4: Burgundy modern (blue, gold lilies, a border) beside Brabant (black, a gold lion)
            a, b, c2, d = q[3]
            mx = (a + c2) // 2
            cell[b:d, a:mx] = blue
            for (fx, fy) in ((0.3, 0.3), (0.7, 0.3), (0.5, 0.65)):
                cv2.circle(cell, (int(a + (mx - a) * fx), int(b + (d - b) * fy)), 5 * S, gold, -1)
                cv2.circle(ch, (int(a + (mx - a) * fx), int(b + (d - b) * fy)), 5 * S, 0.8, -1)
            cell[b:d, mx:c2] = black
            lion(cell, ch, mx + 2 * S, b + 10 * S, (c2 - mx) * 0.95, gold)
            # the partition lines, and Portugal's small shield over all
            cell[H // 2 - 2 * S:H // 2 + 2 * S, x0:x0 + cw] = (60, 60, 60)
            cell[0:H, x0 + cw // 2 - 2 * S:x0 + cw // 2 + 2 * S] = (60, 60, 60)
            ep = shield_poly(x0 + cw / 2, cw * 0.3, H * 0.28, 0) + np.array([0, H * 0.36], np.float32)
            cv2.fillPoly(cell, [ep.astype(np.int32)], white)
            cv2.fillPoly(ch, [ep.astype(np.int32)], 0.75)
            for (fx, fy) in ((0.5, 0.42), (0.5, 0.5), (0.5, 0.58), (0.44, 0.5), (0.56, 0.5)):
                cv2.circle(cell, (int(x0 + cw * fx), int(H * fy)), 3 * S, blue, -1)
        m3 = mask[..., None].astype(bool)
        col = np.where(m3, cell, col)
        hgt = np.where(mask > 0, ch, hgt)
        # the rim: a raised stone band along the outline
        cv2.polylines(col, [poly.astype(np.int32)], True, (150, 165, 175), 6 * S)
        cv2.polylines(hgt, [poly.astype(np.int32)], True, 1.0, 6 * S)
    # weathering: the paint a little faded and grimy, the stone's grain
    rng = np.random.default_rng(1873)
    noise = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2.0 * S)
    col = np.clip(col.astype(np.float32) * (0.9 + 0.06 * noise[..., None]) * 0.92 + 8, 0, 255).astype(np.uint8)
    col = cv2.resize(col, (AW, AH), interpolation=cv2.INTER_AREA)
    hgt = cv2.resize(cv2.GaussianBlur(hgt, (0, 0), 1.2 * S), (AW, AH), interpolation=cv2.INTER_AREA)
    hgt = np.clip(hgt + 0.02 * cv2.resize(noise, (AW, AH)), 0, 1)
    return col, hgt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--arms", action="store_true")
    ap.add_argument("--preview")
    a = ap.parse_args()
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
    if a.src and not a.arms:
        for name, (kind, size) in PICS.items():
            if a.only and name not in a.only:
                continue
            src = os.path.join(a.src, f"{name}.png")
            img = cv2.imread(src)
            if img is None:
                print(f"{name}: no {src}")
                continue
            e = seam_error(img)
            if e > 4.0:  # (a grid of joints or cames at the edges reads high here and tiles well: looked at, 2 x 2)
                img = make_seamless(img)
            img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
            out = os.path.join(TEX, f"stadhuis_{name}.jpg")
            cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            pic = cv2.imread(out)  # the heights from the very jpg the game shows
            if kind == "ashlar":
                h, _ = h_ashlar(pic)
            elif kind == "slate":
                h = h_slate(pic)
            elif kind == "glass":
                h = h_glass(pic)
            elif kind == "oak":
                h = h_oak(pic)
            else:
                h = h_fine(pic)
            cv2.imwrite(os.path.join(TEX, f"stadhuis_{name}_h.png"), (h * 255).astype(np.uint8))
            print(f"{name}: sha256 {sha256(src)}, seam {e:.2f}{' (blended)' if e > 4.0 else ''} -> {size} px")
            if a.preview:
                cv2.imwrite(os.path.join(a.preview, f"maps_{name}.jpg"), np.hstack([pic, cv2.cvtColor((h * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR), relit(h, pic)]))
    if a.arms or not a.only or "arms" in (a.only or []):
        col, h = paint_arms()
        cv2.imwrite(os.path.join(TEX, "stadhuis_arms.png"), col)
        cv2.imwrite(os.path.join(TEX, "stadhuis_arms_h.png"), (h * 255).astype(np.uint8))
        print("arms: painted, 512 x 256")
        if a.preview:
            cv2.imwrite(os.path.join(a.preview, "maps_arms.jpg"), np.vstack([col, cv2.cvtColor((h * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR), relit(h, col, 4.0)]))


if __name__ == "__main__":
    main()

"""The quay walls' and copings' pictures and height maps (D2, 2026-10-11; Steve: "make docks look way better").

Our own work, made here from numbers (no photo, no generated picture): replaces the Codex pictures quay_wall.jpg and
quay_coping.jpg of 2026-09-25.

    python tools/textures/quay_maps.py [out folder]     (default client/public/textures)

writes
    quay_wall_c.jpg, quay_wall_h.png     2048 x 2048: 8 m along the wall (u) by the wall's whole height (v), from
                                         Y_LO (-6.4, the wall's foot) to Y_HI (+1.2, the tops of the stair piers)
    quay_coping_c.jpg, quay_coping_h.png 2048 x 512: 4 m along the quay (u) by the coping's section unrolled (v):
                                         its top from the land side, the rounded nose, the face over the water, the
                                         underside back to the wall (COPE_SECTION in world/quayStone.ts)

The wall is coursed bluestone ashlar (Belgian arduin, "petit granit"): level courses (QUAY_COURSES in
world/quayStone.ts, read from there so the two never differ), each stone with a drafted margin round a tooled face,
crinoid specks, lime joints. The tide's marks are in the picture at their true heights (world/tide.ts), with ragged
edges that run along the wall: white salt bloom above the high-water line, the dark tide mark at high water, a brown
film with barnacles down to half tide, green weed from half tide to low water, black mussels and brown wrack at the
foot. Rust runs under old iron, lime runs from the joints. The Petit Bassin's level (-0.70) lies at the river's mean
high water, so its walls take the same picture (their weed sits at their water line).

The height maps are made with the pictures, from the same stones: the faces stand proud, the margins flat, the
joints sunk, the mussels and the weed's strands raised.
"""
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
STONE_TS = os.path.join(ROOT, "client", "src", "world", "quayStone.ts")


def ts_numbers(name):
    """A `export const NAME = [ ... ]` list of numbers from world/quayStone.ts."""
    src = open(STONE_TS, encoding="utf-8").read()
    m = re.search(r"export const " + name + r"\s*(?::[^=]*)?=\s*\[([^\]]*)\]", src)
    if not m:
        raise SystemExit(f"{name} not found in {STONE_TS}")
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", m.group(1))]


def ts_number(name):
    src = open(STONE_TS, encoding="utf-8").read()
    m = re.search(r"export const " + name + r"\s*=\s*(-?\d+(?:\.\d+)?)", src)
    if not m:
        raise SystemExit(f"{name} not found in {STONE_TS}")
    return float(m.group(1))


# the tide (world/tide.ts)
MID_Y = -2.8
HALF = 2.155
SPRING = 0.115
HW_MAX = MID_Y + HALF * (1 + SPRING)  # -0.40
LW_MIN = MID_Y - HALF * (1 + SPRING)  # -5.20
MHW = MID_Y + HALF  # -0.645
MLW = MID_Y - HALF  # -4.955

rng = np.random.default_rng(1873)
# how much lighter than the stone's own shade the wall picture is drawn (see wall_maps' end)
LIFT = 1.15


# ---------------------------------------------------------------- noise that tiles

def tile_noise(h, w, cells_y, cells_x, octaves=4, seed=0, wrap_y=True):
    """Value noise 0..1 that tiles across x (and y when wrap_y), smooth (cubic), with octaves."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    tot = 0.0
    cy, cx = cells_y, cells_x
    for _ in range(octaves):
        g = r.random((cy + 1, cx + 1)).astype(np.float32)
        g[:, cx] = g[:, 0]
        if wrap_y:
            g[cy, :] = g[0, :]
        ys = np.linspace(0, cy, h, endpoint=False, dtype=np.float32)
        xs = np.linspace(0, cx, w, endpoint=False, dtype=np.float32)
        y0 = np.floor(ys).astype(int)
        x0 = np.floor(xs).astype(int)
        fy = ys - y0
        fx = xs - x0
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]
        b = g[y0][:, x0 + 1]
        c = g[y0 + 1][:, x0]
        d = g[y0 + 1][:, x0 + 1]
        top = a + (b - a) * fx[None, :]
        bot = c + (d - c) * fx[None, :]
        out += amp * (top + (bot - top) * fy[:, None])
        tot += amp
        amp *= 0.5
        cy *= 2
        cx *= 2
    return out / tot


def blur_x_wrap(a, r):
    """A box blur along x that wraps (the picture tiles along the wall)."""
    if r <= 0:
        return a
    c = np.cumsum(np.concatenate([a[:, -r - 1:], a, a[:, :r]], axis=1), axis=1)
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def blur_y(a, r):
    if r <= 0:
        return a
    p = np.concatenate([np.repeat(a[:1], r + 1, 0), a, np.repeat(a[-1:], r, 0)], axis=0)
    c = np.cumsum(p, axis=0)
    return (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)


def blur(a, r):
    return blur_y(blur_x_wrap(a, r), r)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a + (b - a) * t


# ---------------------------------------------------------------- the wall

def stones_in_courses(W, rows_of, course_px, along_m, lengths, seed, top_course=None):
    """Lay stones in level courses: a stone number per pixel, and each pixel's place on its stone.

    course_px: [(row0, row1)] for each course (row0 the top row in the picture). Returns id (h, w), and for each pixel
    the distance in px to its stone's nearest edge (dx along, dy up), plus each stone's box.
    """
    r = np.random.default_rng(seed)
    H = rows_of
    sid = -np.ones((H, W), np.int32)
    ex = np.zeros((H, W), np.float32)  # px to the nearest end of the stone
    ey = np.zeros((H, W), np.float32)  # px to the nearest bed joint
    fx = np.zeros((H, W), np.float32)  # 0..1 across the stone (along)
    fy = np.zeros((H, W), np.float32)  # 0..1 up the stone
    boxes = []
    px_m = W / along_m
    n = 0
    for (r0, r1) in course_px:
        x = int(r.integers(0, W))
        end = x + W
        while x < end:
            L = int(r.uniform(*lengths) * px_m)
            if end - x - L < lengths[0] * px_m * 0.7:
                L = end - x
            xs = (np.arange(x, x + L) % W)
            cols = np.arange(L)
            rows = np.arange(r0, r1)
            sid[r0:r1, xs] = n
            ex[r0:r1, xs] = np.minimum(cols, L - 1 - cols)[None, :]
            ey[r0:r1, xs] = np.minimum(rows - r0, r1 - 1 - rows)[:, None]
            fx[r0:r1, xs] = (cols / max(1, L - 1))[None, :]
            fy[r0:r1, xs] = (1 - (rows - r0) / max(1, r1 - r0 - 1))[:, None]
            boxes.append((x, L, r0, r1))
            n += 1
            x += L
    return sid, ex, ey, fx, fy, boxes


def per_stone(field, sid, offs):
    """Sample a tiling field at an offset of each stone's own, so no pattern runs on from one stone to the next."""
    H, W = field.shape
    R = np.arange(H)[:, None]
    C = np.arange(W)[None, :]
    return field[(R + offs[sid, 0]) % H, (C + offs[sid, 1]) % W]


def wall_maps(out):
    W = H = 2048
    Y_LO = ts_number("QUAY_Y_LO")
    Y_HI = ts_number("QUAY_Y_HI")
    ALONG = ts_number("QUAY_WALL_ALONG")
    courses = ts_numbers("QUAY_COURSES")  # course heights (m) from Y_LO up
    px_up = H / (Y_HI - Y_LO)
    px_al = W / ALONG
    # each row's height in the world (row 0 = Y_HI)
    yrow = Y_HI - (np.arange(H, dtype=np.float32) + 0.5) / px_up
    Y = np.repeat(yrow[:, None], W, 1)
    bounds = [Y_LO]
    for c in courses:
        bounds.append(bounds[-1] + c)
    if bounds[-1] < Y_HI - 1e-6:
        raise SystemExit("QUAY_COURSES do not reach QUAY_Y_HI")
    course_px = []
    for b0, b1 in zip(bounds[:-1], bounds[1:]):
        r1 = int(round((Y_HI - b0) * px_up))
        r0 = int(round((Y_HI - b1) * px_up))
        r0, r1 = max(0, r0), min(H, r1)
        if r1 > r0:
            course_px.append((r0, r1))
    sid, ex, ey, fx, fy, boxes = stones_in_courses(W, H, course_px, ALONG, (0.6, 1.5), 1873)
    nst = len(boxes)
    sr = np.random.default_rng(7)
    offs = np.stack([sr.integers(0, H, nst), sr.integers(0, W, nst)], 1)

    # ---- the stones' faces: Belgian bluestone, dark blue-grey, weathered grey in soft patches, each stone its own
    mid = tile_noise(H, W, 16, 16, 5, seed=11)  # the weathering, sampled per stone
    grain = blur(rng.random((H, W)).astype(np.float32), 1)
    grain2 = rng.random((H, W)).astype(np.float32)
    mott = per_stone(mid, sid, offs)
    tone = per_stone(tile_noise(H, W, 64, 64, 3, seed=12), sid, offs)
    base_v = sr.uniform(0.84, 1.12, nst).astype(np.float32)
    kind = sr.random(nst)  # most bluestone; some lighter grey (weathered), a few browner repairs
    dark_blue = np.array([70, 75, 82], np.float32) / 255
    weathered = np.array([122, 123, 120], np.float32) / 255
    brown = np.array([104, 96, 84], np.float32) / 255
    wk = np.clip(mott * 1.5 - 0.35 + np.where(kind < 0.25, 0.35, 0.0)[sid], 0, 1)
    col = mix(dark_blue, weathered, wk)
    col = np.where((kind > 0.9)[sid][..., None], mix(col, brown, np.full((H, W), 0.75, np.float32)), col)
    col = col * (base_v[sid] * (0.9 + 0.2 * tone))[..., None]

    # the chipped arrises: the stone's edge wanders by a few px; joints 1.5 to 2.5 cm
    chip = tile_noise(H, W, 128, 128, 3, seed=13)
    jx = (0.009 + 0.006 * chip) * px_al
    jy = (0.009 + 0.006 * chip) * px_up
    in_x = ex - jx
    in_y = ey - jy
    stone = (in_x > 0) & (in_y > 0)
    edge_d = np.minimum(in_x / px_al, in_y / px_up)  # m from the stone's edge
    arris = np.clip(edge_d / 0.025, 0, 1)
    # the drafted margin (4 cm, smoother) round a field dressed with the point and the bush hammer
    margin = stone & (edge_d < 0.04)
    field = stone & ~margin
    pits = blur(grain2, 1)
    pits = np.clip((0.36 - pits) * 8, 0, 1) * field  # the bush hammer's pocks
    strokes = 0.5 + 0.5 * np.sin(Y * px_up * 1.3 + per_stone(tile_noise(H, W, 32, 128, 2, seed=14), sid, offs) * 7)
    bul = np.clip(np.sin(np.clip(fx, 0, 1) * np.pi), 0, 1) ** 0.5 * np.clip(np.sin(np.clip(fy, 0, 1) * np.pi), 0, 1) ** 0.5
    # the rock's own roughness at the scale of a few cm, and darker spots in it
    rough = per_stone(tile_noise(H, W, 160, 160, 4, seed=16), sid, offs)
    spots = np.clip((per_stone(tile_noise(H, W, 90, 90, 3, seed=17), sid, offs) - 0.66) * 5, 0, 1)
    lit = (0.86 + 0.18 * grain + 0.06 * (strokes - 0.5) * field) * (0.78 + 0.44 * rough) * (1 - 0.3 * spots)
    lit = np.where(margin, lit * 1.05, lit)
    lit *= 1 - 0.35 * pits
    lit *= 0.8 + 0.2 * arris
    lit *= 0.97 + 0.06 * fy  # light from above: the stone's top a shade lighter
    col = col * lit[..., None]
    # crinoid specks (the fossils in the stone: small pale flecks), and now and then a white calcite vein
    specks = (grain2 > 0.993) & stone
    specks = blur(specks.astype(np.float32), 1) > 0.25
    col = np.where(specks[..., None], col * 0.45 + 0.55 * np.array([0.72, 0.72, 0.68]), col)
    vr = np.random.default_rng(15)
    veins = np.zeros((H, W), np.float32)
    for b in boxes:
        if vr.random() > 0.1:
            continue
        x0, L, r0, r1 = b
        a = vr.uniform(-0.7, 0.7)
        x = np.arange(L)
        yy = (r0 + r1) / 2 + np.tan(a) * (x - L / 2) + np.sin(x * 0.05 + vr.uniform(0, 6)) * 4
        ok = (yy > r0 + 3) & (yy < r1 - 3)
        veins[yy[ok].astype(int), (x0 + x[ok]) % W] = 1
    veins = blur(veins, 1) * stone
    col = mix(col, np.array([0.66, 0.66, 0.62], np.float32), np.clip(veins * 0.8, 0, 0.35))

    # the joints: lime mortar, a warm light grey, recessed and worn back, darker where it is damp
    mort_n = tile_noise(H, W, 64, 64, 3, seed=5)
    mortar = mix(np.array([118, 113, 102], np.float32) / 255, np.array([62, 60, 56], np.float32) / 255, np.clip(mort_n * 1.3 - 0.1, 0, 1))
    mortar = mortar * (0.85 + 0.25 * grain)[..., None]
    col = np.where(stone[..., None], col, mortar)

    # ---- height
    h = np.where(stone, 0.5 + 0.18 * arris ** 0.6 + 0.1 * bul * field + 0.05 * (grain - 0.5) - 0.12 * pits - 0.03 * (strokes - 0.5) * field, 0.12 + 0.1 * mort_n)
    h = np.where(margin, 0.5 + 0.17 * arris ** 0.6 + 0.02 * (grain - 0.5), h)
    h = h + veins * 0.02

    # ---- runs down the face
    def runs(count, ymin, ymax, colour, strength, wide, length, seed, hgt=0.0, at=None):
        r = np.random.default_rng(seed)
        for i in range(count):
            x = int(r.integers(0, W)) if at is None else at[i][0]
            y = float(r.uniform(ymin, ymax)) if at is None else at[i][1]
            row0 = int((Y_HI - y) * px_up)
            ln = int(r.uniform(*length) * px_up)
            w = max(2, int(r.uniform(*wide) * px_al))
            rows = np.arange(max(0, row0), min(H, row0 + ln))
            if len(rows) == 0:
                continue
            t = (rows - row0) / max(1, ln)
            wob = np.sin(t * r.uniform(3, 9) + r.uniform(0, 6)) * w * 0.5
            for j, rr in enumerate(rows):
                ww = max(1, int(w * (1 - 0.5 * t[j])))
                xc = int(x + wob[j])
                xs = np.arange(xc - ww, xc + ww + 1) % W
                k = strength * (1 - t[j]) ** 1.2 * (1 - (np.abs(np.arange(-ww, ww + 1)) / (ww + 1)) ** 2)
                col[rr, xs] = col[rr, xs] * (1 - k[:, None]) + np.array(colour, np.float32) * k[:, None]
                if hgt:
                    h[rr, xs] += hgt * k

    # rust under old iron: the stub of a staple or a cramp hole, its run down the stone
    rr_ = np.random.default_rng(31)
    stubs = []
    for _ in range(7):
        x = int(rr_.integers(0, W))
        y = float(rr_.uniform(-2.2, 0.8))
        row0 = int((Y_HI - y) * px_up)
        s = int(0.022 * px_al)
        ys = slice(max(0, row0 - s), min(H, row0 + s))
        xs = np.arange(x - s, x + s) % W
        col[ys, xs] = np.array([0.16, 0.10, 0.07])
        h[ys, xs] = 0.8
        stubs.append((x, y - 0.025))
    runs(len(stubs), 0, 0, (0.40, 0.19, 0.07), 0.7, (0.012, 0.03), (0.5, 1.8), 33, at=stubs)
    runs(30, -0.35, 1.0, (0.80, 0.80, 0.75), 0.32, (0.005, 0.016), (0.12, 0.6), 41, 0.02)  # lime leached from the joints
    runs(12, -2.6, 1.0, (0.06, 0.07, 0.06), 0.2, (0.01, 0.04), (0.4, 1.4), 43)  # seepage, dark

    # ---- the tide's marks, by height, with edges that wander along the wall
    edge = lambda seed, amp, cells=24: (tile_noise(1, W, 1, cells, 4, seed=seed)[0] - 0.5) * 2 * amp
    joint = (~stone).astype(np.float32)
    jsoft = blur(joint, 3)
    low_lip = np.clip(1 - in_y / (0.05 * px_up), 0, 1) * (fy < 0.5) * stone  # the foot of each stone, where water hangs

    # salt bloom: white efflorescence over the high-water line, in the joints and patches on the stones' faces
    s_top = HW_MAX + 0.6 + edge(51, 0.25)[None, :]
    s_bot = HW_MAX + 0.02 + edge(52, 0.04)[None, :]
    salt_n = tile_noise(H, W, 48, 48, 5, seed=53)
    salt_z = smooth(s_bot, s_bot + 0.12, Y) * (1 - smooth(s_top - 0.4, s_top, Y))
    salt = salt_z * np.clip((salt_n - 0.5) * 2.6 + jsoft * 0.9 + (grain - 0.5) * 0.8, 0, 1) ** 1.5
    col = mix(col, np.array([0.80, 0.80, 0.76], np.float32), salt * 0.7)
    h += salt * 0.04

    # the high-water mark: the stone below it stained darker, the line ragged
    hw = HW_MAX + edge(61, 0.04)[None, :]
    below_hw = 1 - smooth(hw - 0.03, hw + 0.02, Y)
    col = col * (1 - 0.18 * below_hw)[..., None]

    # a thin brown-olive film down from high water, patchy, with barnacles growing denser toward half tide
    film_n = tile_noise(H, W, 32, 32, 5, seed=63)
    film = below_hw * np.clip(0.35 + film_n * 0.7, 0, 1)
    col = mix(col, np.array([0.30, 0.28, 0.20], np.float32), film * 0.45)
    bar_d = smooth(MHW + 0.2, MID_Y - 0.8, Y) * below_hw * (1 - smooth(MLW + 0.3, MLW - 0.2, Y))
    bar_c = np.clip(tile_noise(H, W, 40, 40, 3, seed=64) * 2 - 0.5, 0, 1)
    bar = (grain2 < 0.02 * bar_d * (0.3 + bar_c)) & stone
    bar = blur(bar.astype(np.float32), 1) > 0.12
    col = np.where(bar[..., None], col * 0.45 + np.array([0.56, 0.54, 0.48]) * 0.55, col)
    h = np.where(bar, h + 0.1, h)

    # green weed from half tide down to low water: thick in the joints and on the stones' feet, patchy on their
    # faces, darker and browner lower down, in strands hanging from its upper edge
    w_top = MID_Y + 0.3 + edge(71, 0.3)[None, :]
    w_zone = 1 - smooth(w_top - 0.35, w_top + 0.05, Y)
    weed_n = tile_noise(H, W, 40, 40, 5, seed=74)
    strand_x = tile_noise(1, W, 1, 700, 2, seed=73)[0][None, :]
    strand_l = tile_noise(1, W, 1, 90, 2, seed=75)[0][None, :] * 0.7 + 0.1  # how far down each strand hangs (m)
    strands = np.clip((strand_x - 0.52) * 6, 0, 1) * (Y < w_top) * (Y > w_top - strand_l - 0.3)
    patch = np.clip(weed_n * 2.2 - 0.6, 0, 1)
    lower = smooth(w_top - 0.3, MLW, Y)  # 0 at the top of the weed .. 1 at low water
    cover = np.clip((weed_n - 0.45) * 2.4 + lower * 0.45 + (jsoft * 1.4 + low_lip * 0.6) * patch, 0, 1)
    weed = np.clip(w_zone * cover + strands * 0.8, 0, 1)
    weed = blur(weed, 1)
    gA = np.array([0.24, 0.33, 0.12], np.float32)  # fresh green at the top of the zone
    gB = np.array([0.16, 0.20, 0.09], np.float32)  # dark olive lower down
    green = mix(gA, gB, lower)
    green = green * (0.8 + 0.4 * grain)[..., None]
    col = mix(col, green, weed * 0.85)
    h += weed * 0.06

    # black mussels and brown wrack at the foot (below mean low water), packed in clumps
    m_top = MLW + 0.15 + edge(81, 0.25)[None, :]
    mus_zone = 1 - smooth(m_top - 0.3, m_top + 0.05, Y)
    clump = tile_noise(H, W, 48, 48, 4, seed=82)
    mus = np.zeros((H, W), np.float32)
    mr = np.random.default_rng(83)
    rows_ok = np.where(yrow < m_top.max() + 0.05)[0]
    if len(rows_ok):
        nm = int(len(rows_ok) * W * 0.03)
        cy = mr.choice(rows_ok, nm)
        cx = mr.integers(0, W, nm)
        p = mus_zone[cy, cx] * np.clip((clump[cy, cx] - 0.35) * 3.5, 0, 1)
        keep = p > mr.random(nm)
        cy, cx = cy[keep], cx[keep]
        print("mussels", len(cy))
        L = int(0.036 * px_up)
        Wd = int(0.018 * px_al)
        R = max(L, Wd) + 1
        oy, ox = np.mgrid[-R:R + 1, -R:R + 1]
        for (yy, xx) in zip(cy, cx):
            a = mr.normal(0, 0.5)  # mostly hanging
            sc = mr.uniform(0.7, 1.15)
            ca, sa = np.cos(a), np.sin(a)
            u = (ox * ca - oy * sa) / (Wd * sc)
            v = (ox * sa + oy * ca) / (L * sc)
            v = v + 0.25 * u * u  # a shell is narrower at its hinge
            d = u * u + v * v
            m = d < 1
            rows = np.clip(yy + oy[m], 0, H - 1)
            cols = (xx + ox[m]) % W
            val = (1 - d[m]) ** 0.5 * (0.85 + 0.15 * v[m])
            mus[rows, cols] = np.maximum(mus[rows, cols], val)
    mcover = np.clip(mus * 4, 0, 1)
    shell = np.array([0.05, 0.055, 0.07], np.float32)
    sheen = np.array([0.22, 0.25, 0.32], np.float32)
    mc = mix(shell, sheen, np.clip(mus * 1.3 - 0.55, 0, 1) ** 1.5)
    # between the mussels the stone is black-brown with wet silt
    under = mus_zone * np.clip((clump - 0.3) * 3, 0, 1)
    col = mix(col, np.array([0.08, 0.07, 0.055], np.float32), np.clip(under * 0.9 + mus_zone * 0.3, 0, 0.9))
    col = mix(col, mc, mcover)
    h += mcover * (0.15 + 0.3 * mus) + under * 0.03
    # the wrack: brown strands hanging over the mussels
    wr_x = np.clip((tile_noise(1, W, 1, 400, 2, seed=84)[0] - 0.55) * 6, 0, 1)[None, :]
    wrack = (1 - smooth(m_top - 0.1, m_top + 0.15, Y)) * wr_x * np.clip(tile_noise(H, W, 10, 400, 3, seed=85) * 2.2 - 0.7, 0, 1)
    col = mix(col, np.array([0.19, 0.15, 0.07], np.float32) * (0.8 + 0.4 * grain)[..., None], wrack * 0.85)
    h += wrack * 0.08
    # silt at the very foot (the canal and vliet beds lie at -5.05)
    mud = 1 - smooth(LW_MIN - 0.45, LW_MIN + 0.05, Y)
    mud *= 0.6 + 0.4 * tile_noise(H, W, 8, 40, 3, seed=86)
    col = mix(col, np.array([0.14, 0.12, 0.10], np.float32), mud * 0.65)

    # soot and the weather over the whole wall in big soft patches (the dry part above all)
    soot = tile_noise(H, W, 6, 12, 3, seed=91)
    col = col * (0.88 + 0.22 * soot)[..., None]
    # (the river walls face north, away from the sun: the picture a little lighter than the stone's true shade, and
    # city.ts gives them the light off the water, a fill that follows the sky's)
    col = col * LIFT
    write(out, "quay_wall", col, h)
    return nst


# ---------------------------------------------------------------- the coping

def coping_maps(out):
    W, H = 2048, 512
    ALONG = ts_number("QUAY_COPE_ALONG")
    sec = ts_numbers("COPE_SECTION")  # metres round the section where each part starts: land face, top, nose, face, underside, end
    total = sec[-1]
    s = (np.arange(H, dtype=np.float32) + 0.5) / H * total  # row 0 = the land side (v = 1)
    S = np.repeat(s[:, None], W, 1)
    px_al = W / ALONG
    px_s = H / total
    # the stones: 0.8 to 1.5 m long, joints 1.2 to 2 cm, their ends a little out of square
    r = np.random.default_rng(1881)
    joints = []
    x = int(r.integers(0, W))
    end = x + W
    while x < end:
        L = int(r.uniform(0.8, 1.5) * px_al)
        if end - x - L < 0.6 * px_al:
            L = end - x
        joints.append(x % W)
        x += L
    joints.sort()
    n = len(joints)
    xs = np.arange(W)
    chip = tile_noise(H, W, 32, 256, 3, seed=29, wrap_y=False)
    dist = np.full((H, W), 1e9, np.float32)
    sid = np.zeros((H, W), np.int32)
    for j in joints:
        d = ((xs - j) % W)[None, :]
        dist = np.minimum(dist, np.minimum(d, W - d).astype(np.float32))
    # each pixel's stone: the last joint at or before it
    ja = np.array(joints)
    sid1 = np.zeros(W, np.int32)
    for i, j in enumerate(joints):
        sid1 = np.where(((xs - j) % W) < ((xs - ja[sid1]) % W), i, sid1)
    sid = np.repeat(sid1[None, :], H, 0)
    jw = (0.006 + 0.004 * chip) * px_al
    in_x = dist - jw
    stone = in_x > 0
    edge_d = in_x / px_al
    arris = np.clip(edge_d / 0.02, 0, 1)
    land = S < sec[1]
    top = (S >= sec[1]) & (S < sec[2])
    nose = (S >= sec[2]) & (S < sec[3])
    face = (S >= sec[3]) & (S < sec[4])
    under = S >= sec[4]
    sr = np.random.default_rng(5)
    offs = np.stack([sr.integers(0, H, n), sr.integers(0, W, n)], 1)
    grain = blur(rng.random((H, W)).astype(np.float32), 1)
    grain2 = rng.random((H, W)).astype(np.float32)
    rough = per_stone(tile_noise(H, W, 40, 160, 4, seed=16), sid, offs)
    mott = per_stone(tile_noise(H, W, 4, 16, 5, seed=21), sid, offs)
    spots = np.clip((per_stone(tile_noise(H, W, 24, 96, 3, seed=17), sid, offs) - 0.66) * 5, 0, 1)
    base_v = sr.uniform(0.9, 1.08, n).astype(np.float32)[sid]
    blue = np.array([82, 87, 94], np.float32) / 255
    grey = np.array([136, 137, 134], np.float32) / 255
    col = mix(blue, grey, np.clip(mott * 1.3 - 0.1, 0, 1))
    across = np.clip((S - sec[1]) / (sec[2] - sec[1]), 0, 1)
    # the top: worn smooth and lighter where the feet and the ropes go (toward the edge), grimy on the land side
    wear = np.where(top | nose, smooth(0.25, 0.95, across) + nose * 0.3, 0)
    pits = np.clip((0.36 - blur(grain2, 1)) * 8, 0, 1) * (1 - 0.8 * np.clip(wear, 0, 1))
    lit = (0.86 + 0.18 * grain) * (0.8 + 0.4 * rough) * (1 - 0.28 * spots) * (1 - 0.3 * pits) * (1 + 0.1 * wear)
    lit *= 0.8 + 0.2 * arris
    col = col * (base_v * lit)[..., None]
    specks = (grain2 > 0.993) & stone
    specks = blur(specks.astype(np.float32), 1) > 0.25
    col = np.where(specks[..., None], col * 0.45 + 0.55 * np.array([0.72, 0.72, 0.68]), col)
    grime = np.where(top, 1 - smooth(0.0, 0.35, across), 0) * (0.5 + 0.5 * mott)
    col = mix(col, np.array([0.20, 0.19, 0.17], np.float32), grime * 0.4)
    # the face: dressed in fine level lines with the claw, darker and damp from the spray; the land face grimy
    strokes = 0.5 + 0.5 * np.sin(S * px_s * 1.1 + per_stone(tile_noise(H, W, 16, 128, 2, seed=23, wrap_y=False), sid, offs) * 6)
    col = np.where(face[..., None], col * (0.86 + 0.06 * strokes)[..., None], col)
    col = np.where(land[..., None], col * 0.7, col)
    chips = (grain2 < 0.003) & (nose | (top & (across > 0.9)) | (face & (S < sec[3] + 0.04)))
    chips = blur(chips.astype(np.float32), 2) > 0.1
    col = np.where(chips[..., None], col * 0.72, col)
    # the underside: in shade, damp and green-black
    col = np.where(under[..., None], col * 0.5 + np.array([0.03, 0.05, 0.02]), col)
    # the joints: lime, worn out and dark
    mort = np.array([0.30, 0.29, 0.26], np.float32) * (0.8 + 0.4 * grain)[..., None]
    col = np.where(stone[..., None], col, mort)
    h = np.where(stone, 0.6 + 0.12 * arris ** 0.6 + 0.06 * (grain - 0.5) + 0.06 * (rough - 0.5) * (1 - np.clip(wear, 0, 1)) - 0.1 * pits, 0.2)
    h = np.where(face, h - 0.025 * (strokes - 0.5), h)
    h = np.where(chips, h - 0.15, h)

    # iron cramps across each joint on the top, leaded in: a dark dovetailed bar, its lead round it, a rust stain
    for i, j in enumerate(joints):
        row = int((sec[1] + (sec[2] - sec[1]) * 0.42) * px_s)
        half_l = int(0.1 * px_al)
        bw = max(3, int(0.018 * px_s))
        lead = max(2, int(0.008 * px_s))
        for dx in range(-half_l - lead, half_l + lead):
            cx_ = (j + dx) % W
            tail = abs(dx) > half_l - int(0.025 * px_al)  # the dovetails at the ends, wider
            w = bw + (int(0.012 * px_s) if tail else 0)
            rows = slice(row - w - lead, row + w + lead)
            col[rows, cx_] = np.array([0.34, 0.35, 0.36]) * (0.9 + 0.2 * grain[rows, cx_])[:, None]
            h[rows, cx_] = 0.55
            if abs(dx) < half_l:
                rows = slice(row - w, row + w)
                col[rows, cx_] = np.array([0.16, 0.10, 0.07]) * (0.8 + 0.4 * grain[rows, cx_])[:, None]
                h[rows, cx_] = 0.58
        ry, rx = np.mgrid[-70:70, -int(0.22 * px_al):int(0.22 * px_al)]
        d = (rx / (0.22 * px_al)) ** 2 + (np.maximum(ry, 0) / 70.0) ** 2 * 0.6 + (np.minimum(ry, 0) / 30.0) ** 2
        k = np.clip(1 - d, 0, 1) ** 2 * 0.35
        rows = np.clip(row + ry, 0, H - 1)
        cols = (j + rx) % W
        sel = (top | nose)[rows, 0]
        rust = np.array([0.40, 0.21, 0.09], np.float32)
        col[rows[sel], cols[sel]] = col[rows[sel], cols[sel]] * (1 - k[sel][:, None]) + rust * k[sel][:, None]
    write(out, "quay_coping", col, h)
    return n


def write(out, name, col, h):
    c = np.clip(col, 0, 1) ** (1 / 1.0)
    Image.fromarray((c * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(out, f"{name}_c.jpg"), quality=90, optimize=True)
    hh = h - h.min()
    hh = hh / max(1e-6, hh.max())
    Image.fromarray((hh * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(out, f"{name}_h.png"), optimize=True)
    print("wrote", name, col.shape)


def main(out=None):
    out = out or os.path.join(ROOT, "client", "public", "textures")
    os.makedirs(out, exist_ok=True)
    n = wall_maps(out)
    m = coping_maps(out)
    print("wall stones", n, "coping stones", m)


if __name__ == "__main__":
    main(*sys.argv[1:])

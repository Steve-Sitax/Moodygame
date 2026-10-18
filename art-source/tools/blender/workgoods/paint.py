"""Texture painting for the work goods: numpy pictures of wood, iron, steel, brass, leather, painted canvas, checked
linen, ticking, wicker, hide, brown paper, hemp, fish skin, and stencilled letters. Each painter takes the cell's
size in pixels and its pixels per metre and returns an (h, w, 3) array (sRGB values, row 0 at the top), so every
feature is painted at its real size. Our own work.
"""

import math

import numpy as np

RUST = np.array((0.24, 0.12, 0.055))
IRON = np.array((0.085, 0.082, 0.078))


def rng_(seed):
    return np.random.default_rng(seed)


def value_noise(h, w, sx, sy, rng):
    """Smooth value noise in [0, 1] with features about sx by sy pixels."""
    sx = max(1.0, float(sx))
    sy = max(1.0, float(sy))
    gw = int(w / sx) + 3
    gh = int(h / sy) + 3
    g = rng.random((gh, gw)).astype(np.float32)
    x = np.arange(w) / sx + rng.uniform(0, 1)
    y = np.arange(h) / sy + rng.uniform(0, 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]
    d = g[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, sx, sy, seed, octaves=4, gain=0.5):
    rng = rng_(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, sx / 2 ** o, sy / 2 ** o, rng)
        tot += amp
        amp *= gain
    return out / tot


def blur(a, r):
    """A box blur of radius r pixels, twice (near Gaussian), on 2D or 3D arrays."""
    r = int(r)
    if r < 1:
        return a
    out = a.astype(np.float32)
    for _ in range(2):
        for ax in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r + 1, r)
            p = np.pad(out, pad, mode="edge")
            c = np.cumsum(p, axis=ax)
            sl_hi = [slice(None)] * out.ndim
            sl_lo = [slice(None)] * out.ndim
            sl_hi[ax] = slice(2 * r + 1, None)
            sl_lo[ax] = slice(0, -(2 * r + 1))
            out = (c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)
    return out


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(img, mask, rgb):
    m = np.asarray(mask, np.float32)[..., None]
    img[...] = img * (1 - m) + np.asarray(rgb, np.float32) * m


def coords(w, h, ppm):
    """Metres across (x, columns) and down (y, rows) of a cell."""
    x = (np.arange(w, dtype=np.float32) + 0.5) / ppm
    y = (np.arange(h, dtype=np.float32) + 0.5) / ppm
    return np.meshgrid(x, y)


def solid(w, h, rgb):
    return np.ones((h, w, 3), np.float32) * np.asarray(rgb, np.float32)


# ------------------------------------------------------------------ wood


def wood(w, h, ppm, rgb, seed, oak=False, knots=1, weather=0.0, ring_mm=5.0, along="u", dirt=0.0, figure=1.0):
    """Sawn wood, grain along u (columns) or v: long streaks, growth rings bent by a warp, pores, knots; oak has
    medullary ray flecks. weather: grey silvering; dirt: darker toward the bottom rows."""
    if along == "v":
        return np.ascontiguousarray(wood(h, w, ppm, rgb, seed, oak, knots, weather, ring_mm, "u", 0.0, figure).transpose(1, 0, 2))
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    warp = fbm(h, w, 0.35 * ppm, 0.06 * ppm, seed + 1, 3) - 0.5
    bend = fbm(h, w, 0.9 * ppm, 0.2 * ppm, seed + 2, 2) - 0.5
    ring = (Y + warp * 0.035 + bend * 0.06 + 0.02 * np.sin(X * 3.1 + seed)) / (ring_mm / 1000.0)
    late = np.abs(np.sin(ring * math.pi)) ** 6  # the dark late-wood lines
    streak = fbm(h, w, 0.5 * ppm, 0.004 * ppm, seed + 3, 4)
    pores = fbm(h, w, 0.04 * ppm, 1.0, seed + 4, 2)
    tone = 0.84 + 0.22 * (streak - 0.5) + 0.10 * (pores - 0.5) - 0.16 * late * figure
    img = np.asarray(rgb, np.float32) * tone[..., None]
    if oak:
        # medullary rays: short pale flecks across the grain
        n = int(w * h / (ppm * ppm) * 900)
        fl = np.zeros((h, w), np.float32)
        for _ in range(n):
            cx, cy = rng.uniform(0, w), rng.uniform(0, h)
            L = rng.uniform(0.004, 0.014) * ppm
            x0, x1 = int(max(0, cx - L)), int(min(w, cx + L))
            yy = int(cy)
            if 0 <= yy < h and x1 > x0:
                fl[yy, x0:x1] = np.maximum(fl[yy, x0:x1], rng.uniform(0.4, 1.0))
        fl = blur(fl, max(1, int(ppm * 0.0006)))
        img *= (1 + 0.16 * fl)[..., None]
    for _ in range(knots):
        kx, ky = rng.uniform(0.1, 0.9) * w, rng.uniform(0.15, 0.85) * h
        r = rng.uniform(0.006, 0.012) * ppm
        d = np.hypot((X * ppm - kx) / 2.2, Y * ppm - ky) / r
        img *= (1 - 0.45 * sm(1.2, 0.3, d) - 0.12 * sm(2.6, 1.4, d) * (1 - sm(1.2, 0.3, d)))[..., None]
    if weather > 0:
        n2 = fbm(h, w, 0.12 * ppm, 0.03 * ppm, seed + 5, 3)
        grey = img.mean(axis=2, keepdims=True) * np.array((1.05, 1.03, 1.0)) + 0.04
        t = np.clip((n2 - 0.35) * 2.2, 0, 1)[..., None] * weather
        img = img * (1 - t) + grey * t
    if dirt > 0:
        img *= (1 - dirt * sm(0.4, 1.0, Y / Y.max()))[..., None]
    return img


def end_grain(w, h, ppm, rgb, seed, cx=0.5, cy=1.4):
    """End grain: rings round a pith off the board (flat-sawn), cracks."""
    X, Y = coords(w, h, ppm)
    warp = fbm(h, w, 0.03 * ppm, 0.03 * ppm, seed, 3) - 0.5
    d = np.hypot(X - cx * X.max(), Y - cy * Y.max()) + warp * 0.004
    late = np.abs(np.sin(d / 0.0045 * math.pi)) ** 4
    img = np.asarray(rgb, np.float32) * (0.80 - 0.18 * late + 0.1 * (fbm(h, w, 3, 3, seed + 1, 2) - 0.5))[..., None]
    return img * 0.86


# ------------------------------------------------------------------ metals


def iron(w, h, ppm, seed, rgb=IRON, rust=0.3, pits=1.0, scale=1.0):
    """Wrought or cast iron, black gone brown: mottled scale, rust in patches and specks, pits."""
    rng = rng_(seed)
    mott = fbm(h, w, 0.025 * ppm * scale, 0.025 * ppm * scale, seed, 4)
    img = np.asarray(rgb, np.float32) * (0.75 + 0.5 * mott)[..., None]
    r = fbm(h, w, 0.04 * ppm * scale, 0.04 * ppm * scale, seed + 1, 4)
    m = sm(1 - rust * 0.9, 1 - rust * 0.6, r) * 0.85
    rc = RUST * (0.75 + 0.5 * fbm(h, w, 0.006 * ppm, 0.006 * ppm, seed + 2, 2))[..., None]
    img = img * (1 - m[..., None]) + rc * m[..., None]
    if pits > 0:
        sp = rng.random((h, w)) < 0.012 * pits
        img[sp] *= 0.55
        sp2 = rng.random((h, w)) < 0.006 * rust
        img[sp2] = img[sp2] * 0.5 + RUST * 0.45
    return img


def steel(w, h, ppm, seed, rgb=(0.40, 0.41, 0.42)):
    """Carbon steel: long brushing along u, a grey patina in clouds, small dark spots."""
    rng = rng_(seed)
    brush = fbm(h, w, 0.08 * ppm, 0.0006 * ppm, seed, 3)
    cloud = fbm(h, w, 0.02 * ppm, 0.012 * ppm, seed + 1, 3)
    img = np.asarray(rgb, np.float32) * (0.86 + 0.18 * brush - 0.16 * (cloud - 0.5))[..., None]
    spots = rng.random((h, w)) < 0.004
    img[spots] *= 0.6
    return img


def brass(w, h, ppm, seed, rgb=(0.66, 0.50, 0.22)):
    n = fbm(h, w, 0.01 * ppm, 0.01 * ppm, seed, 3)
    img = np.asarray(rgb, np.float32) * (0.8 + 0.35 * n)[..., None]
    # a little dark tarnish in the low spots
    t = sm(0.55, 0.8, fbm(h, w, 0.015 * ppm, 0.015 * ppm, seed + 1, 3))
    mix(img, t * 0.5, (0.30, 0.26, 0.14))
    return img


# ------------------------------------------------------------------ leather, canvas, cloth


def leather(w, h, ppm, seed, rgb=(0.30, 0.17, 0.08), stitch=True, edge_mm=4.0, holes=None, worn=0.3):
    """A strap along u: pebbled grain, darker burnished edges, a row of saddle stitches near each edge, wear."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    peb = fbm(h, w, 0.0015 * ppm, 0.0015 * ppm, seed, 2)
    big = fbm(h, w, 0.06 * ppm, 0.02 * ppm, seed + 1, 3)
    img = np.asarray(rgb, np.float32) * (0.82 + 0.16 * peb + 0.22 * (big - 0.5))[..., None]
    ev = np.minimum(Y, Y.max() - Y)
    img *= (0.72 + 0.28 * sm(0.0, 0.003, ev))[..., None]
    if worn > 0:
        wear = sm(0.6, 0.85, fbm(h, w, 0.03 * ppm, 0.01 * ppm, seed + 2, 3)) * worn
        mix(img, wear, np.asarray(rgb) * 1.5 + 0.03)
    if stitch:
        e = edge_mm / 1000.0
        period = 0.0045
        on = ((X / period) % 1.0) < 0.62
        for yy in (e, Y.max() - e):
            line = (np.abs(Y - yy) < max(0.6 / ppm, 0.0007)) & on
            img[line] = (0.62, 0.52, 0.36)
            hole = (np.abs(Y - yy) < 0.0009) & (((X / period) % 1.0) > 0.66) & (((X / period) % 1.0) < 0.8)
            img[hole] *= 0.5
    if holes is not None:
        for hx in holes:
            d = np.hypot(X - hx, Y - Y.max() / 2)
            img[d < 0.0028] = (0.05, 0.035, 0.02)
            img[(d >= 0.0028) & (d < 0.0042)] *= 0.7
    return img


def paint_canvas(w, h, ppm, seed, rgb=(0.11, 0.19, 0.13), wear=0.35, edge=True):
    """Canvas over boards, painted (dark green): brush strokes, the weave faintly through the paint, scuffs worn to
    the tan canvas, darker edges where hands and dirt go."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    stroke = fbm(h, w, 0.12 * ppm, 0.008 * ppm, seed, 4)
    weave = ((np.floor(X / 0.0016) + np.floor(Y / 0.0016)) % 2).astype(np.float32)
    mott = fbm(h, w, 0.08 * ppm, 0.08 * ppm, seed + 1, 3)
    img = np.asarray(rgb, np.float32) * (0.84 + 0.16 * stroke + 0.05 * weave + 0.2 * (mott - 0.5))[..., None]
    sc = fbm(h, w, 0.025 * ppm, 0.006 * ppm, seed + 2, 4)
    border = 0.0
    if edge:
        ex = np.minimum(X, X.max() - X)
        ey = np.minimum(Y, Y.max() - Y)
        border = 1 - sm(0.0, 0.05, np.minimum(ex, ey))
    m = sm(0.72 - 0.25 * border * wear, 0.80 - 0.2 * border * wear, sc) * wear
    canvas = np.array((0.42, 0.36, 0.25)) * (0.85 + 0.3 * weave[..., None] * 0.5)
    img = img * (1 - m[..., None]) + canvas * m[..., None]
    # scratches
    for _ in range(int(w * h / (ppm * ppm) * 60)):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(0.01, 0.05) * ppm
        a = rng.uniform(-0.4, 0.4)
        for t in np.linspace(0, 1, max(2, int(L))):
            xx, yy = int(x0 + math.cos(a) * L * t), int(y0 + math.sin(a) * L * t)
            if 0 <= xx < w and 0 <= yy < h:
                img[yy, xx] = img[yy, xx] * 0.6 + np.array((0.36, 0.33, 0.25)) * 0.4
    if edge:
        img *= (1 - 0.25 * border)[..., None]
    return img


def check_linen(w, h, ppm, seed, bg=(0.80, 0.77, 0.68), ink=(0.16, 0.24, 0.45), size=0.028, line=None):
    """Woven check: warp and weft stripes of the coloured yarn; where both cross the colour is full, where one, half;
    a plain weave texture, slubs, a little fading and grime."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    wob = (fbm(h, w, 0.2 * ppm, 0.2 * ppm, seed, 2) - 0.5) * 0.006
    a = ((X + wob) / size) % 2.0 < 1.0
    b = ((Y - wob) / size) % 2.0 < 1.0
    k = a.astype(np.float32) * 0.55 + b.astype(np.float32) * 0.55
    k = np.minimum(k, 1.0)
    if line is not None:
        # a thin stripe of a second colour in the middle of the light squares
        thin_a = np.abs(((X + wob) / size) % 2.0 - 1.5) < 0.08
        thin_b = np.abs(((Y - wob) / size) % 2.0 - 1.5) < 0.08
        lk = (thin_a | thin_b).astype(np.float32) * 0.7
    img = np.asarray(bg, np.float32) * (1 - k[..., None]) + np.asarray(ink, np.float32) * k[..., None]
    if line is not None:
        mix(img, lk, line)
    weave = ((np.floor(X * ppm) + np.floor(Y * ppm)) % 2).astype(np.float32)
    slub = fbm(h, w, 0.03 * ppm, 0.0015 * ppm, seed + 1, 2)
    img *= (0.93 + 0.05 * weave + 0.08 * (slub - 0.5))[..., None]
    fade = fbm(h, w, 0.15 * ppm, 0.15 * ppm, seed + 2, 3)
    img *= (0.88 + 0.2 * fade)[..., None]
    return img


def ticking(w, h, ppm, seed, along="u", bg=(0.86, 0.85, 0.80), ink=(0.14, 0.22, 0.44)):
    """Bed ticking: a dense twill, blue stripes (a broad one between two thin ones) running along u."""
    if along == "v":
        return np.ascontiguousarray(ticking(h, w, ppm, seed, "u", bg, ink).transpose(1, 0, 2))
    X, Y = coords(w, h, ppm)
    period = 0.042
    p = (Y / period) % 1.0
    stripe = ((p > 0.05) & (p < 0.30)) | ((p > 0.40) & (p < 0.44)) | ((p > 0.52) & (p < 0.56))
    s = blur(stripe.astype(np.float32), 1) if ppm > 600 else stripe.astype(np.float32)
    img = np.asarray(bg, np.float32) * (1 - s[..., None]) + np.asarray(ink, np.float32) * s[..., None]
    tw = (((np.floor(X * ppm) + np.floor(Y * ppm)) % 3) == 0).astype(np.float32)
    img *= (0.95 + 0.05 * tw)[..., None]
    soil = fbm(h, w, 0.2 * ppm, 0.2 * ppm, seed, 3)
    img *= (0.86 + 0.18 * soil)[..., None]
    mix(img, sm(0.7, 0.95, fbm(h, w, 0.05 * ppm, 0.05 * ppm, seed + 3, 3)) * 0.25, (0.45, 0.38, 0.28))
    return img


def ticking_end(w, h, ppm, seed, turns=4.5):
    """The end of a rolled featherbed: the ticking's edge spiralling in, darker between the layers."""
    X, Y = coords(w, h, ppm)
    cx, cy = X.max() / 2, Y.max() / 2
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy) / min(cx, cy)
    a = np.arctan2(dy, dx)
    spr = r * turns - a / (2 * math.pi)
    sp = spr % 1.0
    # each wound layer: the ticking's edge seen end-on, a pale band with the stripes as short blue dashes along
    # it, the feathers' shadow between the layers
    gap = sm(0.10, 0.0, sp) + sm(0.88, 1.0, sp)
    arc = (a / (2 * math.pi) + np.floor(spr) * 0.37) * (2 * math.pi * np.maximum(r, 0.05) * min(cx, cy))
    p = (arc / 0.042) % 1.0
    dash = (((p > 0.05) & (p < 0.30)) | ((p > 0.40) & (p < 0.44)) | ((p > 0.52) & (p < 0.56))) & (sp > 0.3) & (sp < 0.62)
    img = np.ones((h, w, 3), np.float32) * np.array((0.84, 0.83, 0.78))
    dm = blur(dash.astype(np.float32), 1)
    img = img * (1 - dm[..., None]) + np.array((0.16, 0.24, 0.45)) * dm[..., None]
    img *= (1 - 0.6 * np.clip(gap, 0, 1))[..., None]
    img *= (0.88 + 0.14 * fbm(h, w, 0.03 * ppm, 0.03 * ppm, seed + 1, 3))[..., None]
    img *= (0.72 + 0.28 * sm(1.0, 0.7, r))[..., None]
    return img


def wicker(w, h, ppm, seed, rgb=(0.62, 0.50, 0.31), stake_m=0.026, weaver_m=0.0065):
    """Woven withies: upright stakes every stake_m, weavers stake_m apart rows of weaver_m height going over one
    stake and under the next (alternating per row); each strand shaded round, its own tone."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    col = np.floor(X / stake_m).astype(int)
    row = np.floor(Y / weaver_m).astype(int)
    fx = (X / stake_m) % 1.0
    fy = (Y / weaver_m) % 1.0
    front = ((col + row) % 2 == 0)
    # where the weaver passes behind, the stake shows in a band round its centre
    stake_vis = (~front) & (np.abs(fx - 0.5) < 0.32)
    tone_r = rng.uniform(0.82, 1.12, row.max() + 2)[row]
    tone_c = rng.uniform(0.85, 1.1, col.max() + 2)[col]
    weaver = np.sin(np.clip(fy, 0, 1) * math.pi) ** 0.6
    # the weaver bends round the stake: darker where it dives
    dive = 0.75 + 0.25 * np.sin(np.clip(fx, 0, 1) * math.pi) ** 0.5
    sh_w = (0.45 + 0.55 * weaver) * dive * tone_r
    sh_s = (0.40 + 0.6 * np.cos((fx - 0.5) / 0.32 * math.pi / 2).clip(0, 1) ** 0.7) * tone_c * 0.92
    sh = np.where(stake_vis, sh_s, sh_w)
    gap = (~stake_vis) & ((fy < 0.07) | (fy > 0.93))
    sh = np.where(gap, sh * 0.35, sh)
    fib = fbm(h, w, 0.02 * ppm, 0.0012 * ppm, seed + 1, 2)
    img = np.asarray(rgb, np.float32) * (sh * (0.9 + 0.2 * fib))[..., None]
    # buff withies with a few darker brown (unpeeled) ones
    brown = (rng.random(row.max() + 2) < 0.15)[row] & ~stake_vis
    img[brown] *= np.array((0.78, 0.66, 0.55))
    grime = fbm(h, w, 0.1 * ppm, 0.1 * ppm, seed + 2, 3)
    img *= (0.85 + 0.2 * grime)[..., None]
    return img


def withy_twist(w, h, ppm, seed, rgb=(0.60, 0.48, 0.30), pitch=0.03, strands=3):
    """A rolled rim or a handle: withies twisted round each other, along u, round v (the cell's height is the
    circumference)."""
    X, Y = coords(w, h, ppm)
    circ = Y.max() + 0.5 / ppm
    ph = (X / pitch + Y / circ * strands) % 1.0
    k = (ph * strands) % 1.0
    sh = 0.42 + 0.58 * np.sin(k * math.pi) ** 0.6
    fib = fbm(h, w, 0.03 * ppm, 0.0015 * ppm, seed, 2)
    img = np.asarray(rgb, np.float32) * (sh * (0.9 + 0.2 * fib))[..., None]
    return img


def hide_hair(w, h, ppm, seed, dark=False):
    """The hair side of a dried cattle hide: red-brown with black and white patches, the hair lying one way in
    streaks, matted tufts, dust."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    patch = fbm(h, w, 0.18 * ppm, 0.14 * ppm, seed, 4)
    patch2 = fbm(h, w, 0.12 * ppm, 0.12 * ppm, seed + 9, 4)
    brown = np.array((0.36, 0.21, 0.11)) if not dark else np.array((0.20, 0.13, 0.08))
    img = np.ones((h, w, 3), np.float32) * brown
    mix(img, sm(0.66, 0.72, patch) * 0.9, (0.09, 0.07, 0.055))
    mix(img, sm(0.72, 0.78, patch2) * (1 - sm(0.66, 0.72, patch)) * 0.75, (0.62, 0.56, 0.46))
    # the hair: fine streaks along a slowly turning direction
    ang = (fbm(h, w, 0.3 * ppm, 0.3 * ppm, seed + 2, 2) - 0.5) * 2.0
    s1 = fbm(h, w, 0.012 * ppm, 0.0012 * ppm, seed + 3, 3)
    s2 = fbm(h, w, 0.0012 * ppm, 0.012 * ppm, seed + 4, 3)
    hair = s1 * np.cos(ang) ** 2 + s2 * np.sin(ang) ** 2
    img *= (0.68 + 0.6 * (hair - 0.5) + 0.3)[..., None]
    tuft = sm(0.7, 0.85, fbm(h, w, 0.02 * ppm, 0.02 * ppm, seed + 5, 3))
    img *= (1 - 0.25 * tuft)[..., None]
    dust = fbm(h, w, 0.08 * ppm, 0.08 * ppm, seed + 6, 3)
    mix(img, sm(0.55, 0.8, dust) * 0.35, (0.46, 0.40, 0.32))
    return img


def hide_edge(w, h, ppm, seed):
    """The side of a stack of folded hides along u, the stack's height down v: layers of hair (the folded edges)
    with dark gaps between them and pale flesh-side edges showing here and there."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    img = hide_hair(w, h, ppm, seed + 50)
    fiber = fbm(h, w, 0.004 * ppm, 0.03 * ppm, seed + 1, 3)
    img *= (0.75 + 0.5 * (fiber - 0.5))[..., None]
    flesh = sm(0.62, 0.7, fbm(h, w, 0.12 * ppm, 0.02 * ppm, seed + 2, 3))
    mix(img, flesh * 0.8, (0.62, 0.52, 0.38))
    return img


def kraft(w, h, ppm, seed, rgb=(0.58, 0.43, 0.27), creases=40, border=False):
    """Brown wrapping paper: fibre mottle, creases (a light ridge beside a dark fold line), smudges."""
    rng = rng_(seed)
    X, Y = coords(w, h, ppm)
    fib = fbm(h, w, 0.004 * ppm, 0.004 * ppm, seed, 3)
    cl = fbm(h, w, 0.06 * ppm, 0.06 * ppm, seed + 1, 3)
    img = np.asarray(rgb, np.float32) * (0.9 + 0.1 * fib + 0.14 * (cl - 0.5))[..., None]
    n = int(creases * X.max() * Y.max() / 0.04)
    cr = np.zeros((h, w), np.float32)
    for _ in range(n):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(0.02, 0.09) * ppm
        a = rng.uniform(0, math.pi)
        dx, dy = math.cos(a), math.sin(a)
        for t in np.linspace(-0.5, 0.5, max(3, int(L))):
            xx, yy = int(x0 + dx * L * t), int(y0 + dy * L * t)
            if 0 <= xx < w and 0 <= yy < h:
                cr[yy, xx] -= 1.0
                x2, y2 = int(xx - dy * 1.5), int(yy + dx * 1.5)
                if 0 <= x2 < w and 0 <= y2 < h:
                    cr[y2, x2] += 0.7
    cr = blur(cr, 1)
    img *= np.clip(1 + 0.35 * cr, 0.6, 1.25)[..., None]
    sm_ = sm(0.65, 0.9, fbm(h, w, 0.04 * ppm, 0.04 * ppm, seed + 3, 3))
    img *= (1 - 0.18 * sm_)[..., None]
    return img


def hemp(w, h, ppm, seed, rgb=(0.56, 0.47, 0.32), lay=0.022, strands=3):
    """Laid rope along u, its circumference down v: three strands spiralling, each shaded round, fibres."""
    X, Y = coords(w, h, ppm)
    circ = Y.max() + 0.5 / ppm
    ph = (X / lay + Y / circ) * strands % 1.0
    sh = 0.38 + 0.62 * np.sin(ph * math.pi) ** 0.7
    fib = fbm(h, w, 0.006 * ppm, 0.001 * ppm, seed, 2)
    img = np.asarray(rgb, np.float32) * (sh * (0.86 + 0.28 * fib))[..., None]
    dirt = fbm(h, w, 0.1 * ppm, 0.1 * ppm, seed + 1, 3)
    img *= (0.8 + 0.25 * dirt)[..., None]
    return img


def string(w, h, ppm, seed, rgb=(0.74, 0.66, 0.50)):
    return hemp(w, h, ppm, seed, rgb, lay=0.006, strands=2)


# ------------------------------------------------------------------ letters (the town's own 5x7 letters)

GLYPHS = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    ".": [".", ".", ".", ".", ".", ".", "#"],
    "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
    "-": ["...", "...", "...", "###", "...", "...", "..."],
    " ": ["...", "...", "...", "...", "...", "...", "..."],
}


def text_mask(text, unit_px):
    """Letters as a soft mask: the 5x7 cells blown up, blurred and cut again (rounded stencil letters), with the
    stencil's bridges (a gap across the middle of closed letters)."""
    cols = sum(len(GLYPHS[c][0]) + 1 for c in text) - 1
    u = max(1, int(round(unit_px)))
    m = np.zeros((7 * u + 2 * u, cols * u + 2 * u), np.float32)
    x = u
    for c in text:
        g = GLYPHS[c]
        for r, row in enumerate(g):
            for k, ch in enumerate(row):
                if ch == "#":
                    m[u + r * u:u + (r + 1) * u, x + k * u:x + (k + 1) * u] = 1.0
        if c in "ABDOPR08":
            # stencil bridges
            m[u + 3 * u + u // 3:u + 4 * u - u // 3, x:x + max(1, u // 3)] = 0.0
        x += (len(g[0]) + 1) * u
    if u >= 3:
        m = blur(m, max(1, u // 3))
        m = sm(0.35, 0.65, m)
    return m


def stencil(img, text, cx, cy, unit_px, ink=(0.06, 0.05, 0.045), alpha=0.9, seed=0, drop=0.18):
    """Stencilled letters centred at pixel (cx, cy): paint thinner at the edges of the stencil, some dabs missing."""
    m = text_mask(text, unit_px)
    h, w = m.shape
    rng = rng_(seed)
    holes = fbm(h, w, max(2, unit_px * 1.5), max(2, unit_px * 1.5), seed, 3)
    a = m * alpha * (1 - drop * sm(0.55, 0.75, holes)) * (0.8 + 0.2 * rng.random((h, w)))
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    H, W = img.shape[:2]
    xs, ys = max(0, x0), max(0, y0)
    xe, ye = min(W, x0 + w), min(H, y0 + h)
    if xe <= xs or ye <= ys:
        return
    aa = a[ys - y0:ye - y0, xs - x0:xe - x0][..., None]
    img[ys:ye, xs:xe] = img[ys:ye, xs:xe] * (1 - aa) + np.asarray(ink, np.float32) * aa


def scribble(img, x0, y0, x1, y1, lines, ink=(0.10, 0.09, 0.12), seed=0, px=1.0):
    """Handwriting too small to read: wavy ink lines with loops."""
    rng = rng_(seed)
    H, W = img.shape[:2]
    for k in range(lines):
        yb = y0 + (y1 - y0) * (k + 0.5) / lines
        xe = x0 + (x1 - x0) * rng.uniform(0.6, 1.0)
        for x in np.arange(x0, xe, 0.35):
            yy = yb + math.sin(x * 1.3 + k) * 1.6 * px + math.sin(x * 0.37 + k * 3) * 0.8 * px
            xi, yi = int(x), int(yy)
            if 0 <= xi < W and 0 <= yi < H and (int(x / (6 * px)) % 5) != 4:
                img[yi, xi] = img[yi, xi] * 0.3 + np.asarray(ink) * 0.7

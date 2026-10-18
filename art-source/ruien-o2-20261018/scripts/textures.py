# Texture pipeline for the Ruien O2 piece.
# Run:  python -I scripts/textures.py   (from the ruien-o2-20261018 folder)
# Input:  textures/codex/t0*.png  (Codex albedo, not seamless)
# Output: textures/*.png  (seamless albedo, height, normal, roughness for each Codex texture)
#         textures/gen/*  (the brick tile built from the Codex bricks, sandstone, bluestone, oak atlas, door stains)
import os, sys, json, hashlib, time
import numpy as np
import cv2
from scipy.signal import find_peaks
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from texlib import *
import spec

ROOT = os.path.dirname(HERE)
CODEX = os.path.join(ROOT, 'textures', 'codex')
OUT = os.path.join(ROOT, 'textures')
GEN = os.path.join(ROOT, 'textures', 'gen')
os.makedirs(GEN, exist_ok=True)

def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

# ---------------------------------------------------------------- generic derived maps
def derive_maps(name, a, tile_m, rough_base, rough_var, h_scale_m):
    """Height (0..1, 16 bit), normal (OpenGL) and roughness from a seamless albedo."""
    L = lum(to_lin(a))
    L = np.log(L + 0.02)
    hp = blur_wrap(L, 1.0) - blur_wrap(L, max(a.shape[:2]) / 18.0)
    mid = blur_wrap(L, 4.0) - blur_wrap(L, max(a.shape[:2]) / 6.0)
    h = 0.65 * hp + 0.35 * mid
    lo, hi = np.percentile(h, [0.5, 99.5])
    h = np.clip((h - lo) / (hi - lo), 0, 1)
    save_gray16(os.path.join(OUT, name + '_height.png'), h)
    px = tile_m / a.shape[1]
    nrm = normal_from_height(h, h_scale_m / px)
    save_srgb(os.path.join(OUT, name + '_normal.png'), nrm)
    r = rough_base + rough_var * (0.5 - (lum(a) - lum(a).mean()) / (lum(a).std() * 4 + 1e-6))
    save_gray8(os.path.join(OUT, name + '_rough.png'), np.clip(r, 0.02, 1))
    return h

# ---------------------------------------------------------------- brick source analysis
def brick_score(img):
    lab = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    L, aa = lab[..., 0], lab[..., 1] - 128
    s = -aa + (L - L.mean()) * 0.35
    return (s - s.mean()) / s.std()

def analyse_bricks(img):
    """Find course bands and brick crops in a brick photo texture."""
    s = brick_score(img)
    row = cv2.GaussianBlur(s.mean(1)[:, None], (0, 0), 2).ravel()
    pk, _ = find_peaks(row, distance=40, prominence=0.15)
    pitch = float(np.median(np.diff(pk)))
    crops = []
    mortar_px = []
    for y in pk:
        y = int(y)
        mortar_px.append(img[max(0, y - 2):y + 3].reshape(-1, 3))
    for y0, y1 in zip(pk[:-1], pk[1:]):
        band = s[y0 + int(0.15 * pitch):y1 - int(0.15 * pitch)]
        if band.shape[0] < 8:
            continue
        col = cv2.GaussianBlur(band.mean(0)[:, None], (0, 0), 2).ravel()
        cp, _ = find_peaks(col, distance=int(0.8 * pitch), prominence=0.4)
        cp = list(cp)
        for xa, xb in zip(cp[:-1], cp[1:]):
            inset = int(0.12 * pitch)
            cy0, cy1 = y0 + int(0.2 * pitch), y1 - int(0.2 * pitch)
            cx0, cx1 = xa + inset, xb - inset
            if cx1 - cx0 < 0.9 * pitch:
                continue
            c = img[cy0:cy1, cx0:cx1]
            # reject crops that still hold a lot of mortar
            if (s[cy0:cy1, cx0:cx1] > 1.0).mean() > 0.2:
                continue
            crops.append(c)
    mortar = np.concatenate(mortar_px, 0)
    return crops, pitch, mortar

# ---------------------------------------------------------------- the brick tile
def build_brick_tile(bond='flemish', seed=1873):
    prefix = 'brick_' + bond
    t0 = time.time()
    rng = np.random.default_rng(seed)
    PX = spec.BRICK_PX
    TWm, THm = spec.BRICK_TILE
    TW, TH = int(round(TWm / PX)), int(round(THm / PX))
    hmin, hmax = spec.BRICK_HMIN, spec.BRICK_HMAX

    srcs = {}
    for key, fn in (('dry', 't01-brick-old'), ('slime', 't02-brick-wet-slime'), ('lime', 't08-brick-lime-crust')):
        img = load_srgb(os.path.join(CODEX, fn + '.png'))
        crops, pitch, mortar = analyse_bricks(img)
        tones = np.array([lum(c).mean() for c in crops])
        order = np.argsort(tones)
        srcs[key] = dict(crops=[crops[i] for i in order], pitch=pitch,
                         mortar=np.median(mortar, 0), mortar_sd=mortar.std(0))
        print('  source %s: %d brick crops, course pitch %.0f px' % (key, len(crops), pitch))

    # global periodic noise fields
    n_edge = fbm_wrap(TH, TW, rng, octaves=4, base=160, persistence=0.6)
    n_face = fbm_wrap(TH, TW, rng, octaves=5, base=60, persistence=0.55)
    n_pit = fbm_wrap(TH, TW, rng, octaves=3, base=700, persistence=0.6)
    n_chip = fbm_wrap(TH, TW, rng, octaves=4, base=220, persistence=0.6)
    n_mort = fbm_wrap(TH, TW, rng, octaves=5, base=300, persistence=0.6)
    n_big = fbm_wrap(TH, TW, rng, octaves=4, base=3, persistence=0.6)
    n_eros = fbm_wrap(TH, TW, rng, octaves=4, base=10, persistence=0.55)

    height = np.full((TH, TW), np.nan, np.float32)
    inside = np.zeros((TH, TW), np.float32)
    fresh = np.zeros((TH, TW), np.float32)
    missing = np.zeros((TH, TW), np.float32)
    bid = np.zeros((TH, TW), np.float32)
    btone = np.zeros((TH, TW), np.float32)
    alb = {k: np.zeros((TH, TW, 3), np.float32) for k in srcs}

    # mortar: height and colour for each variant
    n_wash = fbm_wrap(TH, TW, rng, octaves=4, base=5, persistence=0.6)
    wash = np.clip((n_wash - 0.1) * 1.6, 0, 1)            # washed-out joints
    full = np.clip((-n_wash - 0.45) * 2.5, 0, 1)          # joints still full, almost flush
    h_mort = -0.008 + n_mort * 0.0035 - wash * (0.008 + 0.012 * np.clip(n_eros + 0.5, 0, 1.5)) - (np.abs(n_pit) ** 2) * 0.004
    h_mort = h_mort * (1 - full) + full * (-0.0025 + n_mort * 0.0015)
    grit = (fbm_wrap(TH, TW, rng, octaves=2, base=900, persistence=0.5) > 0.9).astype(np.float32)
    for k, s in srcs.items():
        mcol = s['mortar']
        var = 0.9 + 0.3 * n_mort[..., None] + 0.2 * n_big[..., None] - 0.18 * grit[..., None] - 0.25 * np.clip(n_eros, 0, None)[..., None]
        alb[k][:] = np.clip(mcol[None, None, :] * var, 0, 1)

    # course layout
    nC = 40
    ch = rng.uniform(0.052, 0.068, nC)
    ch *= THm / ch.sum()
    cy = np.r_[0, np.cumsum(ch)]
    jb = rng.uniform(0.006, 0.018, nC + 1)
    jb[-1] = jb[0]
    drift = 0.0
    bricks = []
    for k in range(nC):
        if bond == 'flemish':
            units = (['S', 'H'] if k % 2 == 0 else ['H', 'S']) * 16
            # a few bats and closers break the rhythm
            units = [('B' if (u == 'S' and rng.random() < 0.07) else u) for u in units]
        elif bond == 'stretcher':
            units = ['S'] * 24
        else:
            units = ['H'] * 48
        def ln(u):
            return {'S': rng.normal(0.19, 0.006), 'H': rng.normal(0.09, 0.004), 'B': rng.uniform(0.12, 0.15)}[u]
        L = np.array([ln(u) for u in units])
        J = rng.uniform(0.006, 0.02, len(units))
        tot = L.sum() + J.sum()
        L *= TWm / tot
        J *= TWm / tot
        drift += rng.normal(0, 0.01)
        if bond == 'flemish':
            x = (0.0 if k % 2 == 0 else 0.05) + drift
        elif bond == 'stretcher':
            x = (0.0 if k % 2 == 0 else 0.1) + rng.normal(0, 0.025) + drift * 0.5
        else:
            x = (k % 2) * 0.05 + rng.normal(0, 0.012) + drift * 0.3
        y0 = cy[k] + jb[k] / 2
        y1 = cy[k + 1] - jb[k + 1] / 2
        for u, l, j in zip(units, L, J):
            bricks.append(('S' if u == 'B' else u, x, x + l, y0, y1))
            x += l + j
    print('  %d bricks in tile' % len(bricks))

    m = 14  # margin px
    for bi, (u, x0, x1, y0, y1) in enumerate(bricks):
        jy = rng.normal(0, 0.0012)
        px0, px1 = x0 / PX, x1 / PX
        py0, py1 = (y0 + jy) / PX, (y1 + jy) / PX
        ix0, iy0 = int(np.floor(px0)) - m, int(np.floor(py0)) - m
        w = int(np.ceil(px1)) + m - ix0
        hgt = int(np.ceil(py1)) + m - iy0
        xs = (np.arange(w) + ix0) % TW
        ys = (np.arange(hgt) + iy0) % TH
        gx = np.arange(w)[None, :] + ix0 + 0.5
        gy = np.arange(hgt)[:, None] + iy0 + 0.5
        cxp, cyp = (px0 + px1) / 2, (py0 + py1) / 2
        hw, hh = (px1 - px0) / 2, (py1 - py0) / 2
        rc = rng.uniform(2, 6) / 1000 / PX
        qx = np.abs(gx - cxp) - (hw - rc)
        qy = np.abs(gy - cyp) - (hh - rc)
        sdf = (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rc) * PX
        ne = n_edge[np.ix_(ys, xs)]
        sdf = sdf + ne * 0.0016
        d = -sdf
        ins = d > 0
        r = rng.uniform(0.006, 0.017)
        t = np.clip(1 - d / r, 0, 1)
        h = -r * (1 - np.sqrt(np.clip(1 - t * t, 0, 1)))
        # face: offset, tilt, bulge, grain
        lx = (gx - cxp) / hw
        ly = (gy - cyp) / hh
        h = h + rng.normal(0, 0.0018) + rng.normal(0, 0.0012) * lx + rng.normal(0, 0.0008) * ly
        h = h + rng.normal(0.0004, 0.0008) * (1 - lx * lx) + n_face[np.ix_(ys, xs)] * 0.0009
        h = h - (np.clip(n_pit[np.ix_(ys, xs)], 0.5, None) - 0.5) * 0.0016
        fr = np.zeros_like(h)
        # chipped arrises
        nc = n_chip[np.ix_(ys, xs)]
        thr = rng.uniform(0.35, 0.9)
        chip = (nc > thr) & (d < rng.uniform(0.008, 0.02))
        if chip.any():
            depth = rng.uniform(0.002, 0.007)
            cm = cv2.GaussianBlur(chip.astype(np.float32), (0, 0), 1.2)
            h = h - cm * depth * (0.7 + 0.3 * nc)
            fr = np.maximum(fr, cm * 0.8)
        roll = rng.random()
        if roll < 0.08:  # spalled face
            ex, ey = rng.uniform(-0.5, 0.5), rng.uniform(-0.3, 0.3)
            rx, ry = rng.uniform(0.3, 0.8), rng.uniform(0.5, 1.2)
            e = ((lx - ex) / rx) ** 2 + ((ly - ey) / ry) ** 2 + ne * 0.5
            sp = cv2.GaussianBlur((e < 1).astype(np.float32), (0, 0), 1.5)
            h = h - sp * (rng.uniform(0.002, 0.007) + np.abs(n_pit[np.ix_(ys, xs)]) * 0.0015)
            fr = np.maximum(fr, sp)
        elif roll < 0.11:  # broken end
            side = 1 if rng.random() < 0.5 else -1
            cut = rng.uniform(0.2, 0.6)
            edge = side * lx - (1 - 2 * cut) + ne * 0.35 + (ly * rng.normal(0, 0.3))
            bk = cv2.GaussianBlur((edge > 0).astype(np.float32), (0, 0), 1.5)
            h = h - bk * (rng.uniform(0.005, 0.016) + n_face[np.ix_(ys, xs)] * 0.003)
            fr = np.maximum(fr, bk)
        miss = 0.0
        if roll > 0.997:  # missing brick: a hole with a rough back
            miss = 1.0
            nfh = n_face[np.ix_(ys, xs)]
            hole = -rng.uniform(0.035, 0.05) + nfh * 0.008 + n_pit[np.ix_(ys, xs)] * 0.003
            hole = hole + np.clip(nfh * 2 - 0.2, 0, 1) * 0.035   # broken stumps of the old brick
            grow = d > (-0.004 + ne * 0.006)
            h = np.where(grow, hole, h)
            ins = grow
        # paste
        sub = np.ix_(ys, xs)
        cur = height[sub]
        newh = np.where(ins, h, cur)
        height[sub] = newh
        insf = cv2.GaussianBlur(ins.astype(np.float32), (0, 0), 0.6)
        inside[sub] = np.maximum(inside[sub], insf)
        fresh[sub] = np.where(ins, fr, fresh[sub])
        missing[sub] = np.where(ins, miss, missing[sub])
        idv = rng.random()
        bid[sub] = np.where(ins, idv, bid[sub])
        tone = np.clip(rng.beta(2.2, 2.2), 0, 1)
        btone[sub] = np.where(ins, tone, btone[sub])
        # colour from each source, tone matched
        bw, bh = int(round(px1 - px0)) + 8, int(round(py1 - py0)) + 8
        flip = rng.random() < 0.5
        rot = rng.random() < 0.3
        for k, s in srcs.items():
            cr = s['crops']
            i = int(np.clip(tone * len(cr) + rng.normal(0, len(cr) * 0.06), 0, len(cr) - 1))
            c = cr[i]
            ch_, cw_ = c.shape[:2]
            if u == 'H':
                want = ch_ * bw / bh
                if want < cw_:
                    off = rng.integers(0, int(cw_ - want) + 1)
                    c = c[:, off:off + int(want)]
            if flip:
                c = c[:, ::-1]
            if rot:
                c = c[::-1, ::-1]
            c = cv2.resize(np.ascontiguousarray(c), (bw, bh), interpolation=cv2.INTER_AREA)
            canvas = np.zeros((hgt, w, 3), np.float32)
            oy = int(round(py0 - iy0)) - 4
            ox = int(round(px0 - ix0)) - 4
            yy0, xx0 = max(oy, 0), max(ox, 0)
            yy1, xx1 = min(oy + bh, hgt), min(ox + bw, w)
            canvas[yy0:yy1, xx0:xx1] = c[yy0 - oy:yy1 - oy, xx0 - ox:xx1 - ox]
            # edges and chips: rounded arris collects dirt, fresh breaks are lighter and redder
            dk = 1 - 0.35 * t[..., None]
            core = np.array([0.55, 0.27, 0.16], np.float32) if k != 'slime' else np.array([0.30, 0.17, 0.10], np.float32)
            col = canvas * dk
            col = col * (1 - fr[..., None] * 0.6) + core * fr[..., None] * 0.6
            if miss:
                nf = n_face[np.ix_(ys, xs)][..., None]
                stump = np.clip(nf * 2 - 0.2, 0, 1)
                col = np.array([0.085, 0.062, 0.048], np.float32) * (0.8 + 0.6 * np.abs(nf)) * (1 - stump) + canvas * 0.55 * stump
            a_old = alb[k][sub]
            alb[k][sub] = np.where(ins[..., None], col * insf[..., None] + a_old * (1 - insf[..., None]), a_old)

    mort = np.isnan(height)
    height = np.where(mort, h_mort, height)
    # mortar next to a missing brick is eroded too
    mm = blur_wrap(missing, 6) > 0.15
    height = np.where(mort & mm, np.minimum(height, -0.03), height)
    height = np.clip(height, hmin, hmax)
    print('  layout done %.0fs' % (time.time() - t0))

    # grade: darker, dirtier dry brick (Codex t01 is too clean and bright)
    cav = np.clip((blur_wrap(height, 6) - height) / 0.008, 0, 1)
    grime = 0.86 + 0.14 * np.clip(0.5 + 0.5 * n_big, 0, 1)
    g = alb['dry']
    gl = lum(g)[..., None]
    g = (g * 1.12 - gl * 0.12) * 1.22 * grime[..., None]
    g = g * np.array([1.06, 0.97, 0.9], np.float32)
    g = g * (1 - 0.3 * cav[..., None])
    alb['dry'] = g
    alb['slime'] = alb['slime'] * (1 - 0.3 * cav[..., None]) * 1.12
    alb['lime'] = alb['lime'] * (1 - 0.2 * cav[..., None])

    # lime streaks below joints, in both directions along v
    mortar_m = 1 - inside
    seep = mortar_m * (blur_wrap(fbm_wrap(TH, TW, rng, octaves=3, base=24, persistence=0.6), 2) > 0.55)
    def streak(src, down=True):
        Lpx = 0.06 / PX
        ky = np.arange(TH)
        kx = np.minimum(np.arange(TW), TW - np.arange(TW))
        kern = np.exp(-ky / Lpx)[:, None] * np.exp(-0.5 * (kx[None, :] / 1.6) ** 2)
        kern[int(TH * 0.3):, :] = 0
        if not down:
            kern = np.roll(kern[::-1, :], 1, 0)
        out = np.real(np.fft.ifft2(np.fft.fft2(src) * np.fft.fft2(kern)))
        out = out / (np.percentile(out, 99.5) + 1e-6)
        mod = 0.5 + 0.5 * fbm_wrap(TH, TW, rng, octaves=3, base=40, persistence=0.6, aniso=(0.15, 1.0))
        return np.clip(out * (0.4 + mod), 0, 1).astype(np.float32)
    s_down = streak(seep, True)
    s_up = streak(seep, False)

    # save
    hn = (height - hmin) / (hmax - hmin)
    save_gray16(os.path.join(GEN, prefix + '_height.png'), hn)
    for k in alb:
        save_srgb(os.path.join(GEN, prefix + '_%s.png' % k), np.clip(alb[k], 0, 1))
    masks = np.stack([mortar_m, bid, s_down, s_up], -1)
    from PIL import Image
    Image.fromarray((np.clip(masks, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(GEN, prefix + '_masks.png'))
    masks2 = np.stack([cav, fresh, missing, btone], -1)
    Image.fromarray((np.clip(masks2, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(GEN, prefix + '_masks2.png'))
    save_srgb(os.path.join(GEN, prefix + '_normal.png'), normal_from_height(hn, (hmax - hmin) / PX))
    print('  brick tile %dx%d written %.0fs' % (TW, TH, time.time() - t0))

# ---------------------------------------------------------------- bluestone without joints
def build_bluestone(img, out_px=2048, seed=7):
    """Jointless bluestone: random patches from block interiors, found from the joint grid."""
    rng = np.random.default_rng(seed)
    L = lum(img)
    dark = (blur_wrap(L, 20) - L)
    row = cv2.GaussianBlur(dark.mean(1)[:, None], (0, 0), 2).ravel()
    pk, _ = find_peaks(row, distance=120, prominence=0.004)
    patch = 150
    Hs, Ws = L.shape
    cand = np.zeros((Hs, Ws), bool)
    inset = 22
    for y0, y1 in zip(pk[:-1], pk[1:]):
        band = dark[y0 + inset:y1 - inset]
        col = cv2.GaussianBlur(band.mean(0)[:, None], (0, 0), 2).ravel()
        cp, _ = find_peaks(col, distance=120, prominence=0.01)
        xs = [0] + list(cp) + [Ws]
        for xa, xb in zip(xs[:-1], xs[1:]):
            ya0, ya1 = y0 + inset, y1 - inset - patch
            xa0, xa1 = xa + inset, xb - inset - patch
            if ya1 > ya0 and xa1 > xa0:
                cand[ya0:ya1, xa0:xa1] = True
    print('  bluestone: %d courses, candidates %d' % (len(pk) - 1, int(cand.sum())))
    return rand_patch_quilt(img, cand, (out_px, out_px), patch, rng, sharp=1.5)

# ---------------------------------------------------------------- oak plank atlas
def build_oak_atlas(img, seed=11):
    rng = np.random.default_rng(seed)
    L = lum(img)
    rows = cv2.GaussianBlur(L.mean(1)[:, None], (0, 0), 3).ravel()
    strap = rows < (np.median(rows) - 0.6 * rows.std())
    strap = cv2.dilate(strap.astype(np.uint8)[:, None], np.ones((31, 1), np.uint8)).ravel() > 0
    # vertical plank gaps from free rows
    free = ~strap
    cols = cv2.GaussianBlur(L[free].mean(0)[:, None], (0, 0), 2).ravel()
    gp, _ = find_peaks(-cols, distance=170, prominence=0.01)
    edges = [0] + list(gp) + [img.shape[1]]
    strips = []
    runs = []
    y = 0
    while y < len(free):
        if free[y]:
            y1 = y
            while y1 < len(free) and free[y1]:
                y1 += 1
            if y1 - y > 200:
                runs.append((y, y1))
            y = y1
        else:
            y += 1
    planks = []
    for a, b in zip(edges[:-1], edges[1:]):
        if b - a < 150:
            continue
        planks.append([img[r0:r1, a + 8:b - 8] for (r0, r1) in runs])
        strips += planks[-1]
    print('  oak: %d plank columns, %d strap-free runs, %d strips' % (len(edges) - 1, len(runs), len(strips)))
    cw = 256
    pxm = cw / spec.OAK_PLANK_W
    H = int(spec.OAK_ATLAS_H_M * pxm)
    atlas = np.zeros((H, cw * spec.OAK_ATLAS_COLS, 3), np.float32)
    for c in range(spec.OAK_ATLAS_COLS):
        col = np.zeros((H, cw, 3), np.float32)
        wsum = np.zeros((H, 1, 1), np.float32)
        y = 0
        fade = 90
        while y < H:
            pl = planks[c % len(planks)]
            s = pl[rng.integers(len(pl))]
            if rng.random() < 0.5:
                s = s[::-1]
            if c >= len(planks):
                s = s[:, ::-1]
            s = cv2.resize(np.ascontiguousarray(s), (cw, int(s.shape[0] * cw / s.shape[1])), interpolation=cv2.INTER_AREA)
            n = s.shape[0]
            wv = np.ones(n, np.float32)
            wv[:fade] = np.linspace(0.02, 1, fade)
            wv[-fade:] = np.linspace(1, 0.02, fade)
            y1 = min(H, y + n)
            col[y:y1] += s[:y1 - y] * wv[:y1 - y, None, None]
            wsum[y:y1] += wv[:y1 - y, None, None]
            y += n - fade
        atlas[:, c * cw:(c + 1) * cw] = col / np.maximum(wsum, 1e-3)
    return atlas

# ---------------------------------------------------------------- door stain mask (u across leaf, v up)
def build_door_stains(seed=5):
    rng = np.random.default_rng(seed)
    W, H = 512, 1024   # covers 3.0 m x 4.6 m (sill to above springing)
    y0, y1 = spec.GATE_SILL_Y, spec.GATE_SILL_Y + 4.6
    m = np.zeros((H, W), np.float32)
    nz = 0.5 + 0.5 * fbm_wrap(H, W, rng, octaves=4, base=6, persistence=0.6, aniso=(0.2, 1.0))
    for sy in spec.DOOR_STRAPS_Y:
        r = int((y1 - sy) / (y1 - y0) * H)
        for yy in range(r, min(H, r + 160)):
            m[yy] += np.exp(-(yy - r) / 55.0) * nz[yy]
    m = np.clip(m * 1.4, 0, 1)
    # tide band and slime, low down: river water reaches the outer face up to high water
    yy = np.linspace(y1, y0, H)[:, None]
    wet = np.clip((-0.4 - yy) / 1.0, 0, 1) * (0.6 + 0.4 * nz)
    slime = np.clip((-3.6 - yy) / 0.6, 0, 1) * (0.5 + 0.5 * nz)
    out = np.stack([m, np.broadcast_to(wet, (H, W)), np.broadcast_to(slime, (H, W))], -1)
    save_srgb(os.path.join(GEN, 'door_stains.png'), out)

# ---------------------------------------------------------------- main
def main():
    t0 = time.time()
    record = {}
    table = [
        # name, physical tile metres, roughness base/var, height scale (m)
        ('t01-brick-old', 1.25, 0.82, 0.10, 0.012),
        ('t02-brick-wet-slime', 1.25, 0.40, 0.20, 0.012),
        ('t03-bluestone', spec.BLUE_TILE, 0.62, 0.15, 0.004),
        ('t04-silt-mud', spec.SILT_TILE, 0.30, 0.35, 0.03),
        ('t05-oak-iron', 1.5, 0.70, 0.15, 0.008),
        ('t06-rust-iron', spec.RUST_TILE, 0.75, 0.15, 0.002),
        ('t07-sandstone', spec.SAND_TILE, 0.80, 0.10, 0.02),
        ('t08-brick-lime-crust', 1.25, 0.55, 0.20, 0.012),
        ('t09-flowstone', 0.9, 0.35, 0.25, 0.03),
        ('t10-moss', 1.2, 0.7, 0.2, 0.01),
    ]
    for name, tile, rb, rv, hs in table:
        p = os.path.join(CODEX, name + '.png')
        record[name] = dict(sha256=sha(p))
        img = load_srgb(p)
        a = make_tileable(img, 130)
        save_srgb(os.path.join(OUT, name + '_seamless.png'), a)
        derive_maps(name, a, tile, rb, rv, hs)
        print(name, 'seamless', a.shape[:2])
    blue = build_bluestone(load_srgb(os.path.join(CODEX, 't03-bluestone.png')))
    save_srgb(os.path.join(GEN, 'bluestone_plain.png'), blue)
    derive_maps('gen/bluestone_plain', blue, spec.BLUE_TILE, 0.6, 0.15, 0.004)
    oak = build_oak_atlas(load_srgb(os.path.join(CODEX, 't05-oak-iron.png')))
    save_srgb(os.path.join(GEN, 'oak_atlas.png'), oak)
    derive_maps('gen/oak_atlas', oak, spec.OAK_PLANK_W * spec.OAK_ATLAS_COLS, 0.65, 0.2, 0.006)
    build_door_stains()
    for i, b in enumerate(('flemish', 'stretcher', 'header')):
        build_brick_tile(b, seed=1873 + i * 101)
    json.dump(record, open(os.path.join(OUT, 'codex_sha256.json'), 'w'), indent=1)
    print('all textures done in %.0fs' % (time.time() - t0))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'brick':
        for i, b in enumerate(('flemish', 'stretcher', 'header')):
            build_brick_tile(b, seed=1873 + i * 101)
    else:
        main()

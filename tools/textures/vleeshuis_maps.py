"""The Vleeshuis's pictures and their height maps (the high-quality pass, 2026-09-26).

Takes the Codex pictures (assets/ATTRIBUTION.md, the Vleeshuis rows) from a folder, makes the tiling ones seamless,
lays the bacon bands of the wall exactly where the model expects them, and works out a height map from each
picture's own light and dark, so the bumps follow the picture exactly: bricks and stones high with rounded arrises,
the mortar joints sunk; the slates' lower edges and gaps low; the lead cames of the glass standing proud of the
panes; the door's planks with their grooves low and the iron straps proud; the statue by its light.

    python tools/textures/vleeshuis_maps.py <folder of the Codex PNGs> [name ...]

writes client/public/textures/vleeshuis_<name>.jpg and vleeshuis_<name>_h.png (the model's materials, see
tools/blender/build_vleeshuis.py and client/src/world/vleeshuisShell.ts), prints each original's SHA-256, and puts
proofs in data/shots/vhmap_<name>.jpg: the picture, the height map, and the height map lit from a low side light
(raking light), with the bands' rows marked for the wall.

The wall (vh_bands): one picture is 1.92 x 1.92 m, four bands of 0.48 m: 0.36 m of brick over 0.12 m of white stone,
the stone at the foot of each quarter (the model's v is the height / 1.92, and a band of stone starts at every
0.48 m from the ground). The stone rows are found in the picture (pale and grey against the red brick) and the
picture is stretched up and down, piece by piece, so each lies exactly there.
"""
import hashlib
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TEX = os.path.join(ROOT, "client", "public", "textures")
SHOTS = os.path.join(ROOT, "data", "shots")

# name: (source picture, size of the output (w, h), tiling, kind of height map, saturation, brightness)
KINDS = {
    "bands": ("bands.png", (1024, 1024), True, "bands", 1.08, 1.0),
    "sand": ("sand.png", (1024, 1024), True, "ashlar", 0.8, 1.0),
    "blue": ("blue.png", (1024, 1024), True, "ashlar", 0.8, 1.0),
    "slate": ("slate.png", (1024, 1024), True, "slate", 0.85, 1.0),
    "glass": ("glass.png", (512, 512), True, "glass", 0.9, 1.0),
    "oak": ("door.png", (512, 768), False, "oak", 0.85, 1.0),
    "madonna": ("madonna.png", (384, 1024), False, "statue", 0.9, 1.0),
}
# the part of a picture to keep (left, top, right, bottom, as parts of it): the Madonna without the painted niche
# round her (the model has its own)
CROP = {"madonna": (0.245, 0.1, 0.755, 0.98)}
BANDS_N = 4  # bands in one picture
STONE_PART = 0.25  # the stone's share of a band (0.12 of 0.48 m)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def cover(im, w, h):
    """Crop to the aspect w:h round the middle and resize (Lanczos)."""
    H, W = im.shape[:2]
    if W / H > w / h:
        nw = int(round(H * w / h))
        x0 = (W - nw) // 2
        im = im[:, x0:x0 + nw]
    else:
        nh = int(round(W * h / w))
        y0 = (H - nh) // 2
        im = im[y0:y0 + nh]
    return cv2.resize(im, (w, h), interpolation=cv2.INTER_LANCZOS4)


def seam_err(im):
    a = im.astype(np.float32)
    return float(np.abs(a[:, 0] - a[:, -1]).mean()), float(np.abs(a[0] - a[-1]).mean())


def heal_seams(im, axis_x=True, axis_y=True, band=48):
    """Where a tiling picture does not quite meet itself across an edge, blend the last `band` px on each side into
    the other side's so the edges carry on into each other (only where they are off)."""
    out = im.astype(np.float32)
    h, w = out.shape[:2]
    if axis_x:
        for i in range(band):
            t = 0.5 * (1 - i / band)
            l, r = out[:, i].copy(), out[:, w - 1 - i].copy()
            out[:, i] = l * (1 - t) + r * t
            out[:, w - 1 - i] = r * (1 - t) + l * t
    if axis_y:
        for i in range(band):
            t = 0.5 * (1 - i / band)
            a, b = out[i].copy(), out[h - 1 - i].copy()
            out[i] = a * (1 - t) + b * t
            out[h - 1 - i] = b * (1 - t) + a * t
    return np.clip(out, 0, 255).astype(np.uint8)


def tone(im, sat, bright):
    hsv = cv2.cvtColor(im, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] *= sat
    hsv[..., 2] *= bright
    return cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2RGB)


def stoneness(im):
    """Per pixel: how much this looks like the pale stone (light, not red) rather than the brick."""
    lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32)
    return lab[..., 0] - 2.2 * (lab[..., 1] - 128) - 0.8 * (lab[..., 2] - 128)


def lay_bands(im):
    """Find the four stone bands (rows) and stretch the picture up and down so they lie exactly at the foot of each
    quarter. Returns the picture and the bands found (rows, top down)."""
    h, w = im.shape[:2]
    prof = stoneness(im).mean(axis=1)
    prof = ndi.uniform_filter1d(prof, 5, mode="wrap")
    thr = (np.percentile(prof, 90) + np.percentile(prof, 30)) / 2
    on = prof > thr
    # runs of stone rows, cyclic
    runs = []
    start = None
    k0 = int(np.argmin(on)) if on.any() and not on.all() else 0  # start the scan on a brick row
    for j in range(h + 1):
        r = (k0 + j) % h
        v = on[r] and j < h
        if v and start is None:
            start = k0 + j
        if not v and start is not None:
            runs.append((start, k0 + j))
            start = None
    runs = [(a, b) for a, b in runs if b - a >= h * 0.02]
    runs.sort(key=lambda ab: ab[1] - ab[0], reverse=True)
    runs = sorted(runs[:BANDS_N])
    if len(runs) != BANDS_N:
        raise SystemExit(f"bands: found {len(runs)} stone bands, want {BANDS_N}: {runs}")
    q = h / BANDS_N
    st = q * STONE_PART
    # control points (source row -> target row), cyclic: each band's top and bottom edge
    src, tgt = [], []
    # the band whose middle is lowest in the picture goes to the lowest quarter
    mids = sorted(((a + b) / 2 % h, a, b) for a, b in runs)
    for k, (_, a, b) in enumerate(mids):
        base = (k + 1) * q  # this quarter's foot (rows count down)
        # unwrap a and b near their middle
        m = (a + b) / 2
        a2, b2 = a - (m - m % h), b - (m - m % h)
        src += [a2, b2]
        tgt += [base - st, base]
    src, tgt = np.array(src), np.array(tgt)
    order = np.argsort(tgt)
    src, tgt = src[order], tgt[order]
    # extend cyclically for interpolation
    src_e = np.concatenate([src - h, src, src + h])
    tgt_e = np.concatenate([tgt - h, tgt, tgt + h])
    rows = np.interp(np.arange(h) + 0.5, tgt_e, src_e) - 0.5
    map_y = np.repeat((rows % h)[:, None], w, axis=1).astype(np.float32)
    map_x = np.repeat(np.arange(w, dtype=np.float32)[None, :], h, axis=0)
    out = cv2.remap(im, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
    return out, runs


def tile3(a):
    return np.tile(a, (3, 3) + (1,) * (a.ndim - 2))


def mid(a, h, w):
    return a[h:2 * h, w:2 * w]


def highpass(lum, sigma, tiling=True):
    h, w = lum.shape
    big = tile3(lum) if tiling else cv2.copyMakeBorder(lum, h, h, w, w, cv2.BORDER_REFLECT)
    hp = mid(cv2.GaussianBlur(big, (0, 0), 0.8) - cv2.GaussianBlur(big, (0, 0), sigma), h, w)
    return np.clip(hp / (np.percentile(np.abs(hp), 98) + 1e-6), -1, 1)


def joints(im, med, hor, ver, pct, tiling=True, darker=False, smooth=3):
    """Bricks or stones in mortar (as tools/textures/wall_heights.py): the joints are where the colour leaves the
    stone's own (in Lab, against a median about a stone big), kept only as lines, so a spall is no joint."""
    h, w = im.shape[:2]
    lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32)
    big = tile3(lab) if tiling else cv2.copyMakeBorder(lab, h, h, w, w, cv2.BORDER_REFLECT)
    mm = np.stack([cv2.medianBlur(np.clip(big[:, :, k], 0, 255).astype(np.uint8), med).astype(np.float32) for k in range(3)], 2)
    d = big - mm
    # (darker: a joint is darker than the stone round it, lighter spots are no joints)
    dist = cv2.GaussianBlur(np.sqrt(d[:, :, 0] ** 2 * 0.5 + d[:, :, 1] ** 2 + d[:, :, 2] ** 2) * ((d[:, :, 0] < 4) if darker else 1.0), (0, 0), 1.0)
    line = np.maximum(
        cv2.morphologyEx(dist, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (hor, 1))),
        cv2.morphologyEx(dist, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, ver))),
    )
    joint = line > np.percentile(mid(line, h, w), pct)
    # (the joints' ragged fringes smoothed: a median over the mask, so the arrises run straight)
    joint = cv2.medianBlur(joint.astype(np.uint8) * 255, smooth) > 127
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (smooth, smooth))
    face = cv2.morphologyEx((~joint).astype(np.uint8), cv2.MORPH_OPEN, k, iterations=1)
    face = ndi.binary_fill_holes(face).astype(np.uint8)
    return face, h, w


def domed(face, h, w, r=3.0, floor=0.14):
    e = np.clip(mid(ndi.distance_transform_edt(face), h, w) / r, 0, 1)
    return (0.84 - floor) * np.sqrt(1 - (1 - e) ** 2) + floor, mid(face, h, w) > 0


def height_bands(im):
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32)
    h, w = lum.shape
    face, _, _ = joints(im, 21, 17, 9, 73, smooth=5)
    hgt, on = domed(face, h, w, 3.0)
    # the stone bands: their own joints are few and far (blocks of about 0.5 m); their faces a little rougher
    q = h / BANDS_N
    st = int(round(q * STONE_PART))
    stone_rows = np.zeros(h, bool)
    for k in range(BANDS_N):
        b = int(round((k + 1) * q))
        stone_rows[b - st:b] = True
    detail = highpass(lum, 4.0)
    hgt = np.where(on, hgt + 0.08 * detail, 0.14 + 0.04 * detail)
    # the bed joints above and under each stone band: always a joint there, 3 px, where the picture's own is
    for k in range(BANDS_N):
        b = int(round((k + 1) * q))
        for r0 in (b - st, b):
            # the darkest row within 4 px of the edge is the joint
            rows = [(r0 + d) % h for d in range(-4, 5)]
            jr = rows[int(np.argmin([lum[r].mean() for r in rows]))]
            for d in (-1, 0, 1):
                hgt[(jr + d) % h] = np.minimum(hgt[(jr + d) % h], 0.16 + 0.03 * detail[(jr + d) % h])
    return np.clip(hgt, 0, 1), stone_rows


def height_ashlar(im):
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32)
    h, w = lum.shape
    face, _, _ = joints(im, 51, 45, 41, 90, smooth=5)
    hgt, on = domed(face, h, w, 5.0, 0.16)
    detail = highpass(lum, 6.0)
    return np.clip(np.where(on, hgt + 0.12 * detail, 0.16 + 0.05 * detail), 0, 1)


def blackhat(lum, k, tiling=True):
    h, w = lum.shape
    big = tile3(lum) if tiling else cv2.copyMakeBorder(lum, h, h, w, w, cv2.BORDER_REFLECT)
    bh = mid(cv2.morphologyEx(cv2.GaussianBlur(big, (0, 0), 0.8), cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))), h, w)
    return np.clip(bh / (np.percentile(bh, 99.3) + 1e-6), 0, 1)


def height_slate(im):
    """Slates: each lies on the one below, so its face rises from its top (under the next) to its lower edge, which
    casts the dark line in the picture; the gaps between slates are low."""
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32)
    h, w = lum.shape
    edge = blackhat(lum, 9)
    big = tile3(edge)
    # the lower edges: dark lines that run across (a long flat opening keeps them), the gaps: short uprights
    hor = mid(cv2.morphologyEx(big, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))), h, w)
    ver = mid(cv2.morphologyEx(big, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9))), h, w)
    line = hor > max(0.2, np.percentile(hor, 85))
    # the rise: how far up from the nearest lower edge below (three times round, so the top rows see the lines below)
    dist = np.zeros_like(lum)
    last = np.full(w, -1.0)
    for y in range(3 * h):
        r = (3 * h - 1 - y) % h
        last = np.where(line[r], 0.0, np.where(last < 0, -1.0, last + 1))
        if y >= 2 * h:
            dist[r] = last
    dist[dist < 0] = np.percentile(dist[dist >= 0], 90) if (dist >= 0).any() else 30.0
    # (a line that breaks off for a few px would streak the rise: take the rise's median along the row)
    dist = ndi.median_filter(dist, size=(1, 31), mode="wrap")
    per = max(np.percentile(dist, 95), 1.0)
    rise = 1 - np.clip(dist / per, 0, 1)
    gaps = np.clip(np.maximum(hor, ver), 0, 1)
    hgt = 0.3 + 0.45 * rise + 0.08 * highpass(lum, 3.0) - 0.4 * gaps
    return np.clip(hgt, 0, 1)


def height_glass(im):
    """Leaded lights: the dark lead cames stand proud of the glass; the panes nearly flat."""
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32)
    came = blackhat(lum, 11)
    came = cv2.GaussianBlur(came, (0, 0), 0.8)
    return np.clip(0.3 + 0.6 * came + 0.04 * highpass(lum, 3.0), 0, 1)


def height_oak(im):
    """The oak doors: the planks' faces with their grain, the grooves between them low, the iron straps and nails
    (dark, wider than a groove) proud."""
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32)
    h, w = lum.shape
    # the iron is black and grey, the oak brown: the iron is where the colour has almost no hue
    lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma = cv2.GaussianBlur(np.hypot(lab[..., 1] - 128, lab[..., 2] - 128), (0, 0), 1.5)
    iron = cv2.morphologyEx((chroma < 2.8).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    iron = cv2.GaussianBlur(iron.astype(np.float32), (0, 0), 1.0)
    groove = blackhat(lum, 7, tiling=False) * (1 - iron)
    return np.clip(0.55 + 0.12 * highpass(lum, 3.0, False) - 0.4 * groove + 0.3 * iron, 0, 1)


def height_statue(im):
    """The statue in its niche: the light stone stands out of the dark niche; its folds by their light."""
    lum = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    body = cv2.GaussianBlur(lum, (0, 0), 6.0)
    body = (body - body.min()) / (np.ptp(body) + 1e-6)
    return np.clip(0.15 + 0.6 * body + 0.15 * highpass(lum * 255, 3.0, False), 0, 1)


def raking(hgt, depth_px=6.0, az=200.0, alt=20.0, tiling=True):
    """The height map lit from a low side light (a proof that it reads)."""
    big = np.pad(hgt, 1, mode="wrap" if tiling else "edge")
    gy, gx = np.gradient(big * depth_px)
    gx, gy = gx[1:-1, 1:-1], gy[1:-1, 1:-1]
    a, e = np.radians(az), np.radians(alt)
    L = np.array([np.cos(a) * np.cos(e), np.sin(a) * np.cos(e), np.sin(e)])
    n = np.dstack([-gx, gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip(n @ L, 0, 1)


def main():
    src = sys.argv[1]
    names = sys.argv[2:] or list(KINDS)
    os.makedirs(SHOTS, exist_ok=True)
    for name in names:
        fn, (w, h), tiling, kind, sat, bright = KINDS[name]
        path = os.path.join(src, fn)
        if not os.path.exists(path):
            print(f"{name}: no {fn} yet")
            continue
        im = cv2.cvtColor(cv2.imread(path, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        if name in CROP:
            l, t, r, b = CROP[name]
            H0, W0 = im.shape[:2]
            im = im[int(t * H0):int(b * H0), int(l * W0):int(r * W0)]
        im = cover(im, w, h)
        rows = None
        if kind == "bands":
            im, runs = lay_bands(im)
            print(f"{name}: stone bands found at rows {runs}")
        if tiling:
            ex, ey = seam_err(im)
            if ex > 10 or ey > 10:
                im = heal_seams(im, ex > 10, ey > 10 and kind != "bands")
            print(f"{name}: seams {ex:.1f} {ey:.1f} -> {seam_err(im)[0]:.1f} {seam_err(im)[1]:.1f}")
        im = tone(im, sat, bright)
        if kind == "bands":
            hgt, rows = height_bands(im)
        elif kind == "ashlar":
            hgt = height_ashlar(im)
        elif kind == "slate":
            hgt = height_slate(im)
        elif kind == "glass":
            hgt = height_glass(im)
        elif kind == "oak":
            hgt = height_oak(im)
        else:
            hgt = height_statue(im)
        out = os.path.join(TEX, f"vleeshuis_{name}.jpg")
        cv2.imwrite(out, cv2.cvtColor(im, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
        cv2.imwrite(os.path.join(TEX, f"vleeshuis_{name}_h.png"), np.round(hgt * 255).astype(np.uint8))
        # the proof: picture | height | raking light on the height | raking light times the picture
        rk = raking(hgt, tiling=tiling)
        g = np.round(hgt * 255).astype(np.uint8)
        r8 = np.round(rk * 255).astype(np.uint8)
        lit = np.clip(im.astype(np.float32) * (0.35 + 0.9 * rk[..., None]), 0, 255).astype(np.uint8)
        panel = np.hstack([im, np.dstack([g] * 3), np.dstack([r8] * 3), lit])
        if rows is not None:
            for x0 in (0, 3 * w):
                for r in np.flatnonzero(np.diff(rows.astype(int)) != 0):
                    panel[r, x0:x0 + 24] = (255, 255, 0)
        cv2.imwrite(os.path.join(SHOTS, f"vhmap_{name}.jpg"), cv2.cvtColor(panel, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
        print(f"{name}: {out} ({w} x {h}), original sha256 {sha(path)}")


if __name__ == "__main__":
    main()

"""The cathedral's pictures and their height maps (M7 the cathedral outside, 2026-09-26).

The Codex pictures of the cathedral's stone (tools/codexImage.mjs; assets/ATTRIBUTION.md has their prompts and the
SHA-256 of each original PNG) are resized, made to tile where they must (the seams blended across the middle), toned,
and written as client/public/textures/cathx_<name>.jpg. Each gets a height map made from the written picture itself,
so the bump in the game always follows what the picture shows (tools/textures/wall_heights.py's methods: stone in
courses as "brick" with big blocks, the carved stone as fine lumps, the door's planks and iron and the tympanum's
carving from their own light and dark): client/public/textures/cathx_<name>_h.png (512 px).

    python tools/textures/cathedral_maps.py <name> <original.png> [<name> <original.png> ...]

names: ashlar, plinth, carved (tile), door, tympanum (whole pictures). Previews go to data/shots/cathh_<name>.jpg.
"""
import hashlib
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
import wall_heights as wh  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TEX = os.path.join(ROOT, "client", "public", "textures")
SHOTS = os.path.join(ROOT, "data", "shots")

# name: (tiles, size, saturation, brightness, height kind, its parameters)
KINDS = {
    "ashlar": (True, 1024, 0.95, 0.86, "ashlar", {}),
    "plinth": (True, 1024, 0.9, 0.85, "ashlar", {"mortar": "both", "course": 80}),
    "carved": (True, 512, 0.95, 0.9, "rough", {}),
    "door": (False, 512, 0.85, 1.0, "door", {}),
    "tympanum": (False, 512, 0.6, 1.0, "relief", {"sigma": 10.0}),
}


def courses(im):
    """Stone in courses: crop from one bed joint (a light mortar row) to the last, so the picture's top and bottom meet
    at a joint; then join the left and right edges by a narrow blend down the middle of a half-turned copy (the bed
    joints lie level through it, only the stones' own grain is blended)."""
    lum = im.mean(axis=2)
    row = np.convolve(lum.mean(axis=1), np.ones(5) / 5, "same")
    base = np.convolve(row, np.ones(61) / 61, "same")
    peak = [i for i in range(3, len(row) - 3) if row[i] == row[i - 3:i + 4].max() and row[i] - base[i] > 6]
    if len(peak) >= 3:
        r0, r1 = peak[0], peak[-1]
        im = im[r0:r1]
    h, w = im.shape[:2]
    sh = np.roll(im, w // 2, 1)
    xx = np.arange(w)
    k = np.clip(1 - np.abs(xx - w / 2) / (w * 0.07), 0, 1)[None, :, None]
    return sh * (1 - k) + im * k


def _peaks(prof, gap, k=1.2):
    """Local maxima of a profile, at least `gap` apart, over its mean by k deviations (wrapping: the picture tiles)."""
    n = len(prof)
    thr = prof.mean() + k * prof.std()
    cand = [i for i in range(n) if prof[i] >= thr and prof[i] == max(prof[(i + d) % n] for d in range(-gap // 2, gap // 2 + 1))]
    out = []
    for i in sorted(cand, key=lambda i: -prof[i]):
        if all(min(abs(i - j), n - abs(i - j)) >= gap for j in out):
            out.append(i)
    return sorted(out)


def ashlar_height(im, lum, mortar="light", course=64, **_):
    """Dressed stone in courses: the bed joints are the rows where the mortar shows all along (light lime joints, or
    for old dirty ones light or dark), the head joints the columns where it shows all down one course; the faces domed
    at their arrises with their own grain. Soot and streaks are colour, not relief."""
    n = lum.shape[0]
    med = cv2.medianBlur(np.clip(wh.tile3(lum), 0, 255).astype(np.uint8), 31).astype(np.float32)
    diff = wh.mid(cv2.GaussianBlur(wh.tile3(lum), (0, 0), 0.8) - med)
    resp = np.clip(diff, 0, None) if mortar == "light" else np.abs(diff)
    rows = _peaks(np.convolve(np.tile(resp.mean(axis=1), 3), np.ones(3) / 3, "same")[n:2 * n], int(course * 0.6), 1.0)
    joint = np.zeros_like(lum, bool)
    for r in rows:
        for d in (-1, 0, 1):
            joint[(r + d) % n, :] = True
    bands = list(zip(rows, rows[1:] + [rows[0] + n])) if rows else [(0, n)]
    for r0, r1 in bands:
        idx = [(r % n) for r in range(r0 + 3, r1 - 2)]
        if len(idx) < 8:
            continue
        prof = resp[idx].mean(axis=0)
        prof = np.convolve(np.tile(prof, 3), np.ones(3) / 3, "same")[n:2 * n]
        for c in _peaks(prof, int(course * 0.9), 1.6):
            for r in idx:
                for d in (-1, 0, 1):
                    joint[r, (c + d) % n] = True
    face = (~joint).astype(np.uint8)
    e = np.clip(wh.mid(ndi.distance_transform_edt(wh.tile3(face))) / 3.0, 0, 1)
    dome = np.sqrt(1 - (1 - e) ** 2)
    detail = wh.highpass(lum, 3.0)
    on = face > 0
    h = np.where(on, 0.72 * dome + 0.12 + 0.08 * detail, 0.12 + 0.03 * detail)
    return h, on


def seamless(im, band=0.18):
    """Blend the picture with itself shifted by half, across a soft cross in the middle: the edges then meet."""
    h, w = im.shape[:2]
    sh = np.roll(np.roll(im, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    # 1 near the shifted copy's seams (the middle lines), 0 far from them
    dx = np.abs(xx - w / 2) / (w * band)
    dy = np.abs(yy - h / 2) / (h * band)
    k = np.clip(1 - np.minimum(dx, dy), 0, 1) ** 1.5
    # the shifted copy has its seams in the middle: there take the original instead
    k = k[..., None]
    return sh * (1 - k) + im * k


def tone(im, sat, bright):
    hsv = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] *= sat
    hsv[..., 2] = np.clip(hsv[..., 2] * bright, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB).astype(np.float32)


def relief(im, lum, sigma=6.0, **_):
    """A carved or built surface: its light and dark at the carving's size are its height, the fine grain less."""
    big = lum
    low = cv2.GaussianBlur(big, (0, 0), sigma * 4)
    hp = cv2.GaussianBlur(big, (0, 0), 1.0) - low
    hp = np.clip(hp / (np.percentile(np.abs(hp), 98) + 1e-6), -1, 1)
    return 0.5 + 0.42 * hp, np.ones_like(lum, bool)


def door_height(im, lum, **_):
    """Oak leaves with iron: the boards at one level with their grain, the joints between them sunk, the iron (black,
    grey, in blobs and bands: straps, scrolls, nail heads, the rings) standing proud of the wood."""
    hsv = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    # iron is grey and dark, the oak brown: little colour and no light
    lab = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma = cv2.GaussianBlur(np.hypot(lab[..., 1] - 128, lab[..., 2] - 128), (0, 0), 1.2)
    L = cv2.GaussianBlur(lab[..., 0], (0, 0), 1.0)
    dark = (chroma < np.percentile(chroma, 25)) & (L < np.percentile(L, 40))
    iron = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, lbl, st, _ = cv2.connectedComponentsWithStats(iron, 8)
    # (a long thin upright dark line is the gap between the leaves or two boards: a groove, not iron)
    slit = [i for i in range(1, n) if st[i, cv2.CC_STAT_WIDTH] <= 8 and st[i, cv2.CC_STAT_HEIGHT] >= 60]
    iron = np.isin(lbl, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 18 and i not in slit]).astype(np.uint8)
    iron = cv2.dilate(iron, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))) > 0
    groove = ((lum < np.percentile(lum, 8)) | np.isin(lbl, slit)) & ~iron
    low = cv2.GaussianBlur(lum, (0, 0), 12)
    grain = np.clip((cv2.GaussianBlur(lum, (0, 0), 1.0) - low) / (np.percentile(np.abs(lum - low), 98) + 1e-6), -1, 1)
    h = 0.45 + 0.08 * grain
    h[groove] = 0.25
    ir = cv2.GaussianBlur(iron.astype(np.float32), (0, 0), 1.2)
    h = h * (1 - ir) + 0.92 * ir
    return h, iron


def make(name, src):
    tiles, size, sat, bright, kind, params = KINDS[name]
    raw = open(src, "rb").read()
    im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
    if tiles:
        s = min(im.shape[:2])
        im = im[:s, :s]
        # (only if its edges do not meet already: the blend doubles the joints where it works)
        inner = np.mean(np.abs(im[:, 1:] - im[:, :-1]))
        seam = max(np.mean(np.abs(im[:, 0] - im[:, -1])), np.mean(np.abs(im[0] - im[-1])))
        print(f"{name}: seam {seam:.1f} against {inner:.1f} inside")
        if kind == "ashlar":
            im = courses(im)
        elif seam > inner * 1.6:
            im = seamless(im)
        im = cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA)
    else:
        im = cv2.resize(im, (size, int(round(size * im.shape[0] / im.shape[1]))), interpolation=cv2.INTER_AREA)
    im = tone(im, sat, bright)
    out = os.path.join(TEX, f"cathx_{name}.jpg")
    cv2.imwrite(out, np.clip(im, 0, 255).astype(np.uint8)[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
    # the height map from the picture as written (read back: the jpeg's own pixels)
    pic = cv2.imread(out, cv2.IMREAD_COLOR)[:, :, ::-1]
    hN = wh.N
    if tiles:
        small = cv2.resize(pic, (hN, hN), interpolation=cv2.INTER_AREA).astype(np.float32)
        lum = small.mean(axis=2)
        h, _ = {"brick": wh.brick, "plaster": wh.plaster, "rough": wh.rough, "ashlar": ashlar_height}[kind](small, lum, **params)
        h = wh.mid(cv2.GaussianBlur(wh.tile3(np.clip(h, 0, 1).astype(np.float32)), (0, 0), 0.6))
    else:
        hh = int(round(hN * pic.shape[0] / pic.shape[1]))
        small = cv2.resize(pic, (hN, hh), interpolation=cv2.INTER_AREA).astype(np.float32)
        lum = small.mean(axis=2)
        h, _ = (door_height if kind == "door" else relief)(small, lum, **params)
        h = cv2.GaussianBlur(np.clip(h, 0, 1).astype(np.float32), (0, 0), 0.6)
    cv2.imwrite(os.path.join(TEX, f"cathx_{name}_h.png"), np.clip(h * 255, 0, 255).astype(np.uint8))
    os.makedirs(SHOTS, exist_ok=True)
    hv = cv2.cvtColor(np.clip(h * 255, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2RGB)
    cv2.imwrite(os.path.join(SHOTS, f"cathh_{name}.jpg"), np.hstack([small.astype(np.uint8), hv])[:, :, ::-1])
    sha = hashlib.sha256(raw).hexdigest()
    print(f"cathx_{name}.jpg ({pic.shape[1]} x {pic.shape[0]}) and cathx_{name}_h.png from {os.path.basename(src)}, sha256 {sha}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or len(a) % 2:
        sys.exit(__doc__)
    for i in range(0, len(a), 2):
        make(a[i], a[i + 1])

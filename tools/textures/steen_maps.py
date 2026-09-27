"""The Steen's pictures and their height maps (Het Steen in detail, 2026-09-26; tools/blender/build_steen.py).

    python tools/textures/steen_maps.py --import <folder>   take the Codex originals (<name>.png) from a folder: make
                                                          the tiled ones seamless, size them, compose the carvings
                                                          sheet; print each original's SHA-256 (assets/ATTRIBUTION.md)
    python tools/textures/steen_maps.py [name ...]          the height maps, from the pictures in client/public/textures

The game (client/src/world/steenModel.ts) draws the Steen's stone, slate and brick from
client/public/textures/steen_<name>.jpg, laid in world metres (build_steen.py TILE), and bumps the light with
steen_<name>_h.png. A height map is worked out from its own picture, so the bumps are where the picture shows
stones, joints, slates and carving: masonry faces high with rounded arrises and the joints sunk (after
wall_heights.py), slate rows stepping down the roof, the carving's relief from its light.
steen_maps.json records the picture's SHA-256 and how strong the bump is drawn; the game uses a height map only
with the picture it was made from. Previews go to data/shots/steenh_<name>.jpg.
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import wall_heights as wh  # noqa: E402  (its highpass, tile3 and mid, at 512 px)
from scipy import ndimage as ndi  # noqa: E402

N = wh.N
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TEX = os.path.join(ROOT, "client", "public", "textures")
SHOTS = os.path.join(ROOT, "data", "shots")

# name: (tiled?, size in px of the game's picture, kind of relief, its parameters, bump strength in the game: three.js's
# bumpScale, which tilts the normal by the height's change from one screen pixel to the next; up close retro/psx.ts
# psxBumpGain draws it up to 2.5 times as strong, so these are about half the first ones: Steve, 2026-09-27, the stone
# was too heavily bumped, the foot of the walls most)
KINDS = {
    "tournai": (True, 1024, "masonry", {"size": 35, "pct": 71, "floor": 0.12, "rough": 0.16, "arris": 4.0}, 0.7),
    "sand": (True, 1024, "courses", {"course": 40, "head": 40, "floor": 0.15, "rough": 0.14}, 0.8),
    "blue": (True, 1024, "courses", {"course": 60, "head": 60, "floor": 0.3, "rough": 0.1, "arris": 2.0, "head_k": 2.6}, 0.5),
    "slate": (True, 1024, "slates", {"course": 30, "head": 22, "head_k": 1.0, "amp": 0.55}, 0.6),
    "brick": (True, 1024, "masonry", {"size": 25, "pct": 72, "floor": 0.12, "rough": 0.12, "arris": 2.5, "min_joint": 30}, 0.6),
    "carve": (False, 1024, "relief", {}, 0.9),
}
# the carvings sheet (build_steen.py CCELL): x, y, w, h from the top left of a 1024 px sheet
SHEET = {"semini": (0, 0, 384, 640), "arms": (384, 0, 640, 480), "saltire": (384, 480, 640, 480), "saltire_n": (0, 640, 272, 384)}
# the part of an original a cell shows (x0, y0, x1, y1 in its pixels): the Semini's niche inside its frame (the model
# has its own frame and round head round it)
CROP = {"semini": (160, 20, 870, 1203)}


def seamless(im, band=0.12):
    """Make a picture tile: its own middle over the tile's edges, blended in over a narrow band, so the joins
    that were at the edges move into the middle and fade there."""
    h, w = im.shape[:2]
    rolled = np.roll(np.roll(im, h // 2, 0), w // 2, 1)
    def ramp(n):
        x = np.minimum(np.arange(n), n - 1 - np.arange(n)) / (n * band)
        return np.clip(x, 0, 1)
    wgt = np.minimum.outer(ramp(h), ramp(w))[..., None]
    wgt = wgt * wgt * (3 - 2 * wgt)
    return (im * wgt + rolled * (1 - wgt)).astype(np.float32)


def seam_error(im):
    im = im.astype(np.float32)
    return float(np.abs(im[0] - im[-1]).mean() + np.abs(im[:, 0] - im[:, -1]).mean()) / 2


def import_originals(folder):
    shas = {}
    for name, (tiled, size, *_rest) in KINDS.items():
        if name == "carve":
            continue
        src = os.path.join(folder, f"{name}.png")
        if not os.path.exists(src):
            print("missing", src)
            continue
        raw = open(src, "rb").read()
        shas[name] = hashlib.sha256(raw).hexdigest()
        im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR).astype(np.float32)
        h, w = im.shape[:2]
        k = min(h, w)
        im = im[(h - k) // 2:(h - k) // 2 + k, (w - k) // 2:(w - k) // 2 + k]
        before = seam_error(im)
        if tiled:
            im = seamless(im)
        im = cv2.resize(im, (size, size), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(TEX, f"steen_{name}.jpg"), np.clip(im, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(f"{name:8s} {w}x{h} seam {before:.1f} -> {seam_error(im):.1f}  sha256 {shas[name]}")
    # the carvings sheet
    sheet = np.full((1024, 1024, 3), 90, np.float32)
    for cell, (x, y, cw, ch) in SHEET.items():
        src = os.path.join(folder, f"{cell.split('_')[0]}.png")
        if not os.path.exists(src):
            print("missing", src)
            continue
        raw = open(src, "rb").read()
        shas[cell] = hashlib.sha256(raw).hexdigest()
        im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR).astype(np.float32)
        if cell in CROP:
            x0_, y0_, x1_, y1_ = CROP[cell]
            im = im[y0_:y1_, x0_:x1_]
        h, w = im.shape[:2]
        # fill the cell, cropping the picture to the cell's shape round its middle
        a = cw / ch
        if w / h > a:
            nw = int(h * a)
            im = im[:, (w - nw) // 2:(w - nw) // 2 + nw]
        else:
            nh = int(w / a)
            im = im[(h - nh) // 2:(h - nh) // 2 + nh]
        sheet[y:y + ch, x:x + cw] = cv2.resize(im, (cw, ch), interpolation=cv2.INTER_AREA)
        print(f"{cell:8s} {w}x{h} -> cell {cw}x{ch}  sha256 {shas[cell]}")
    cv2.imwrite(os.path.join(TEX, "steen_carve.jpg"), np.clip(sheet, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    json.dump(shas, open(os.path.join(folder, "originals_sha256.json"), "w"), indent=1)


def masonry(im, lum, size=41, pct=78, floor=0.1, rough=0.16, arris=3.0, light_joints=True, min_joint=40):
    """Stones in mortar where the mortar shows as its own tone (lighter and warmer here, or darker): against a
    median as big as a stone, the pixels that leave the stone's tone that way; cleaned of specks and small
    pits (a pit in a stone is no joint). The stones' faces high with rounded arrises and their own roughness,
    the joints sunk."""
    lab = cv2.cvtColor(im.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    big = wh.tile3(lab)
    med = np.stack([cv2.medianBlur(np.clip(big[:, :, k], 0, 255).astype(np.uint8), size).astype(np.float32) for k in (0, 2)], 2)
    dL = cv2.GaussianBlur(big[:, :, 0] - med[:, :, 0], (0, 0), 1.0)
    db = cv2.GaussianBlur(big[:, :, 2] - med[:, :, 1], (0, 0), 1.0)
    score = dL / (dL.std() + 1e-6) + 0.6 * db / (db.std() + 1e-6)
    if not light_joints:
        score = -dL / (dL.std() + 1e-6)
    joint = score > np.percentile(wh.mid(score), pct)
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    joint = cv2.morphologyEx(joint.astype(np.uint8), cv2.MORPH_OPEN, k3)
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(joint, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_joint
    joint = keep[lab_]
    joint = cv2.morphologyEx(joint.astype(np.uint8), cv2.MORPH_CLOSE, k3) > 0
    face = ~joint
    e = np.clip(wh.mid(ndi.distance_transform_edt(face)) / arris, 0, 1)
    dome = np.sqrt(1 - (1 - e) ** 2)
    detail = wh.highpass(lum, 3.0)
    on = wh.mid(face)
    h = np.where(on, floor + (0.82 - floor) * dome + rough * detail, floor + 0.04 * detail)
    return h, on




def _peaks(prof, min_gap, k=0.4):
    """Local maxima of a wrapping profile, at least min_gap apart, over its mean + k std."""
    n = len(prof)
    thr = prof.mean() + k * prof.std()
    cand = [i for i in range(n) if prof[i] >= thr and prof[i] == max(prof[(i + d) % n] for d in range(-min_gap // 2, min_gap // 2 + 1))]
    out = []
    for i in sorted(cand, key=lambda i: -prof[i]):
        if all(min(abs(i - j), n - abs(i - j)) >= min_gap for j in out):
            out.append(i)
    return sorted(out)


def courses(im, lum, course=40, head=30, floor=0.15, rough=0.14, arris=2.5, thin=5, k=0.4, head_k=1.0):
    """Blocks laid in level courses (the sandstone ashlar; the slates' rows): the bed joints are the rows where
    thin lines run across the whole picture, followed column by column within a few pixels; the head joints
    are the columns where thin upright lines run through each course's height. So soot streaks and pitting
    in a block never read as joints. Faces high with rounded arrises and their own grain, the joints sunk."""
    L = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 0.7)
    big = wh.tile3(L)
    kk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (thin, thin))
    R = wh.mid(cv2.morphologyEx(big, cv2.MORPH_TOPHAT, kk) + cv2.morphologyEx(big, cv2.MORPH_BLACKHAT, kk))
    n = R.shape[0]
    rows = _peaks(cv2.GaussianBlur(R.mean(axis=1)[:, None], (0, 0), 1.0)[:, 0], course, k)
    joint = np.zeros_like(R, bool)
    # the bed joints, following the line column by column within 3 px
    for r in rows:
        for x in range(n):
            ys = [(r + d) % n for d in range(-3, 4)]
            y = max(ys, key=lambda yy: R[yy, x])
            joint[y, x] = True
    joint = cv2.dilate(joint.astype(np.uint8), np.ones((2, 1), np.uint8)) > 0
    # the head joints of each course
    heads = 0
    for i, r0 in enumerate(rows):
        r1 = rows[(i + 1) % len(rows)] if len(rows) > 1 else r0 + n
        if r1 <= r0:
            r1 += n
        band = [(y % n) for y in range(r0 + 4, r1 - 3)]
        if len(band) < 6:
            continue
        prof = R[band].mean(axis=0)
        for c in _peaks(cv2.GaussianBlur(prof[:, None], (0, 0), 1.0)[:, 0], head, head_k):
            for y in range(r0 + 1, r1):
                joint[y % n, c] = True
                joint[y % n, (c + 1) % n] = True
            heads += 1
    face = ~joint
    e = np.clip(wh.mid(ndi.distance_transform_edt(wh.tile3(face))) / arris, 0, 1)
    dome = np.sqrt(1 - (1 - e) ** 2)
    detail = wh.highpass(lum, 3.0)
    print(f"  {len(rows)} courses, {heads} head joints")
    return np.where(face, floor + (0.82 - floor) * dome + rough * detail, floor + 0.04 * detail), face


def slates(im, lum, course=40, head=24, head_k=1.0, amp=0.55, rough=0.08, k=0.4, thin=5):
    """Slates hung in rows: the rows' lower edges are the rows where thin lines (their shadow) run
    across the picture; each slate lies tilted on the row under it, so its height climbs from its top (under the
    row above) to its thick lower edge; the gaps between the slates of a row sunk; the picture's own grain on it."""
    L = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 0.7)
    big = wh.tile3(L)
    kk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (thin, thin))
    R = wh.mid(cv2.morphologyEx(big, cv2.MORPH_TOPHAT, kk) + cv2.morphologyEx(big, cv2.MORPH_BLACKHAT, kk))
    n = R.shape[0]
    rows = _peaks(cv2.GaussianBlur(R.mean(axis=1)[:, None], (0, 0), 1.0)[:, 0], course, k)
    h = np.zeros_like(R)
    gap = np.zeros_like(R, bool)
    heads = 0
    for i, r0 in enumerate(rows):
        r1 = rows[(i + 1) % len(rows)] if len(rows) > 1 else r0 + n
        if r1 <= r0:
            r1 += n
        for y in range(r0, r1):
            h[y % n, :] = 0.2 + amp * (y - r0) / max(1, r1 - r0)  # (image rows run down the roof: the lower edge at r1)
        band = [(y % n) for y in range(r0 + 3, r1 - 2)]
        if len(band) < 6:
            continue
        prof = R[band].mean(axis=0)
        for c in _peaks(cv2.GaussianBlur(prof[:, None], (0, 0), 1.0)[:, 0], head, head_k):
            for y in range(r0 + 1, r1):
                gap[y % n, c] = True
            heads += 1
    h = np.where(gap, 0.15, h) + rough * wh.highpass(lum, 2.5)
    print(f"  {len(rows)} rows, {heads} slates")
    return h, ~gap






def relief(im, lum, **_):
    """Carving: the relief's own light (lit from above in the picture) as its height, big forms and fine."""
    big = cv2.GaussianBlur(lum, (0, 0), 1.0) - cv2.GaussianBlur(lum, (0, 0), 24.0)
    big = np.clip(big / (np.percentile(np.abs(big), 98) + 1e-6), -1, 1)
    fine = cv2.GaussianBlur(lum, (0, 0), 0.8) - cv2.GaussianBlur(lum, (0, 0), 4.0)
    fine = np.clip(fine / (np.percentile(np.abs(fine), 98) + 1e-6), -1, 1)
    return 0.5 + 0.35 * big + 0.12 * fine, np.ones_like(lum, bool)


def make(name):
    tiled, size, kind, params, bump = KINDS[name]
    src = os.path.join(TEX, f"steen_{name}.jpg")
    raw = open(src, "rb").read()
    im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)[:, :, ::-1]
    im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = im.mean(axis=2)
    fn = {"masonry": masonry, "courses": courses, "slates": slates, "relief": relief}[kind]
    h, top = fn(im, lum, **params)
    h = np.clip(h, 0, 1)
    if tiled:
        h = wh.mid(cv2.GaussianBlur(wh.tile3(h.astype(np.float32)), (0, 0), 0.6))
    else:
        h = cv2.GaussianBlur(h.astype(np.float32), (0, 0), 0.6)
    cv2.imwrite(os.path.join(TEX, f"steen_{name}_h.png"), np.clip(h * 255, 0, 255).astype(np.uint8))
    os.makedirs(SHOTS, exist_ok=True)
    hv = cv2.cvtColor(np.clip(h * 255, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2RGB)
    # a raking light from the left over the height, to see it follows the picture
    gx = cv2.Sobel(h.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(h.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    rake = np.clip(0.55 - 4.0 * gx * 0.7 + 4.0 * gy * 0.3, 0, 1)
    rv = (np.clip(im * rake[..., None] * 1.2, 0, 255)).astype(np.uint8)
    cv2.imwrite(os.path.join(SHOTS, f"steenh_{name}.jpg"), np.hstack([im.astype(np.uint8), hv, rv])[:, :, ::-1])
    return {"sha256": hashlib.sha256(raw).hexdigest(), "kind": kind, "bump": bump}


def main(args):
    if args[:1] == ["--import"]:
        import_originals(args[1])
        return
    path = os.path.join(TEX, "steen_maps.json")
    have = json.load(open(path)) if os.path.exists(path) else {}
    for name in args or list(KINDS):
        if name not in KINDS:
            sys.exit(f"unknown Steen picture: {name}")
        have[name] = make(name)
        print("height map", name, have[name]["kind"])
    json.dump(dict(sorted(have.items())), open(path, "w", newline="\n"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])

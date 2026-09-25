"""Height and stone maps for a picture of setts (quays pass 2, 2026-09-25).

The quay setts are a picture made with Codex image generation (client/public/textures/quay_setts.jpg,
assets/ATTRIBUTION.md). The ground shader (client/src/retro/psx.ts, relief) wants two more maps that line
up with it: a height map (each stone a low dome, the joints low) and a stone map (r = the stone's number,
g = 255 on a stone, b = 255 where a stone runs on from the tile to the left: world/paving.ts). This finds
the stones in the picture: the joints are the thin dark lines (a black-hat filter) and the brown mud; each
stone is its convex hull unless two ran together. The picture tiles, so the work is done on 3 x 3 copies.

    python tools/textures/setts_maps.py <picture.png> <out folder>

writes quay_setts_h.png and quay_setts_id.png (512 px) and setts_seg.jpg (the stones in green, to look at).
"""
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

N = 512


def main(src, out):
    im = cv2.imread(src)[:, :, ::-1]
    im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = im.mean(axis=2)
    big = np.tile(lum, (3, 3))
    sm = cv2.GaussianBlur(big, (0, 0), 1.6)
    bh = cv2.morphologyEx(sm, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))[N:2 * N, N:2 * N]
    redness = im[:, :, 0] - im[:, :, 2]
    joint = (bh > np.percentile(bh, 62)) | (redness > np.percentile(redness, 90)) & (lum < np.percentile(lum, 40))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mb = np.tile((~joint).astype(np.uint8), (3, 3))
    mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, k, iterations=2)
    mb = cv2.morphologyEx(mb, cv2.MORPH_CLOSE, k, iterations=1)
    mb = ndi.binary_fill_holes(mb).astype(np.uint8)
    mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
    mb = cv2.erode(mb, k, iterations=1)
    lab, _ = ndi.label(mb)
    stones = np.zeros_like(lab, dtype=np.int32)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None:
            continue
        ys, xs = np.nonzero(lab[sl] == i)
        if len(xs) < 60:
            continue
        pts = np.stack([xs + sl[1].start, ys + sl[0].start], 1).astype(np.int32)
        tmp = np.zeros(lab.shape, np.uint8)
        cv2.fillConvexPoly(tmp, cv2.convexHull(pts), 1)
        if tmp.sum() > 1.45 * len(xs):
            # two stones run together: keep the shape as found, only its holes closed
            tmp[:] = 0
            tmp[sl] = ndi.binary_fill_holes(cv2.morphologyEx((lab[sl] == i).astype(np.uint8), cv2.MORPH_CLOSE, k, iterations=2))
        stones[(tmp == 1) & (stones == 0)] = i
    stones[cv2.erode((stones > 0).astype(np.uint8), k, iterations=1) == 0] = 0
    dist = ndi.distance_transform_edt(stones > 0)[N:2 * N, N:2 * N]
    center = stones[N:2 * N, N:2 * N]
    on = center > 0
    e = np.clip(dist / 4.0, 0, 1)
    h = np.where(on, np.sqrt(1 - (1 - e) ** 2), 0.08).astype(np.float32)
    h = cv2.GaussianBlur(np.tile(h, (3, 3)), (0, 0), 0.8)[N:2 * N, N:2 * N]
    cv2.imwrite(f"{out}/quay_setts_h.png", np.clip(h * 255, 0, 255).astype(np.uint8))
    ids = np.zeros((N, N, 3), np.uint8)
    for i in np.unique(center[on]):
        ys, xs = np.nonzero(stones == i)
        # numbered by where the stone starts, folded into the tile: both halves of a cut stone agree
        ids[center == i, 0] = ((xs.min() % N) * 7919 + (ys.min() % N) * 104729) % 254 + 1
        ids[center == i, 1] = 255
        if xs.min() < N:
            ids[center == i, 2] = 255  # it started in the tile to the left
        if ys.min() < N or ys.max() >= 2 * N:
            ids[center == i, 1] = 0  # cut by the top or bottom edge: no dice of its own
    cv2.imwrite(f"{out}/quay_setts_id.png", ids[:, :, ::-1])
    vis = (im * 0.5).astype(np.uint8)
    vis[on] = (vis[on] * 0.5 + np.array([0, 120, 0])).astype(np.uint8)
    cv2.imwrite(f"{out}/setts_seg.jpg", vis[:, :, ::-1])
    print("stones", len(np.unique(center[on])))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

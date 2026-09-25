"""Height and stone maps for a picture of setts (quays pass 2, 2026-09-25; bump maps checked, 2026-09-26).

The quay setts are a picture made with Codex image generation (client/public/textures/quay_setts.jpg,
assets/ATTRIBUTION.md). The ground shader (client/src/retro/psx.ts, relief) wants two more maps that line
up with it: a height map (each stone a low dome, the joints low) and a stone map (r = the stone's number,
g = 255 on a stone, b = 255 where a stone runs on from the tile to the left: world/paving.ts). This finds
the stones in the picture: the joints are the dark lines between them (a black-hat filter as wide as a joint,
and for muddy joints the mud's colour); each stone is its convex hull, and two stones that ran together are cut
apart where the shape is narrowest. The picture tiles, so the work is done on 3 x 3 copies.

    python tools/textures/setts_maps.py <picture> <out folder> [name] [joint percentile] [mud] [light]

writes <name>_h.png and <name>_id.png (512 px; name defaults to quay_setts) and <name>_seg.jpg (the stones
in green, to look at). mud (0..1) weighs the mud's colour (saturation) into the joints; light (0..1) lays
the picture's own light and dark under the stones found (for joints too muddy to find every stone).

    quay_setts.jpg      joint percentile 60, mud 0, light 0
    street_cobble.jpg   joint percentile 50, mud 0.6, light 0.5 (its stone map is not used: street_cobble_id.png
                        is not written into the game; city.ts blanks the stone map for the streets)

2026-09-26: the first maps took brown stones for mud (a redness test) and cut stones with mud smeared on them into
rags: about 20 of the quay's stones lay sunk as joints under the picture. The black-hat is now 19 px (a joint's
width), specks inside a stone are no joint, and the redness test is gone.
"""
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

N = 512
# a dark patch in the joint mask smaller than this (px, over the 3 x 3 copies) lies inside a stone: no joint
SPECK = 900


def main(src, out, name="quay_setts", joint_pct="60", mud="0", light="0"):
    joint_pct = float(joint_pct)
    SAT = float(mud)
    BRIGHT = float(light)
    im = cv2.imread(src)[:, :, ::-1]
    im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = im.mean(axis=2)
    big = np.tile(lum, (3, 3))
    sm = cv2.GaussianBlur(big, (0, 0), 1.6)
    bh = cv2.morphologyEx(sm, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))[N:2 * N, N:2 * N]
    # muddy joints (the street cobbles): the mud is brown, the stones grey; saturation finds the joints the dark lines miss
    score = bh / (np.percentile(bh, 99) + 1e-6)
    if SAT:
        hsv = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
        sat = cv2.GaussianBlur(np.tile(hsv[:, :, 1], (3, 3)), (0, 0), 1.5)[N:2 * N, N:2 * N]
        score = score * (1 - SAT) + SAT * sat / (np.percentile(sat, 99) + 1e-6)
    joint = score > np.percentile(score, joint_pct)
    # specks inside a stone (a dark pit, a wet spot) are no joints: only the joined net of lines is
    jl, _ = ndi.label(np.tile(joint, (3, 3)))
    sizes = np.bincount(jl.ravel())
    keep = sizes > SPECK
    keep[0] = False
    joint = keep[jl][N:2 * N, N:2 * N]
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mb = np.tile((~joint).astype(np.uint8), (3, 3))
    mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, k, iterations=2)
    mb = cv2.morphologyEx(mb, cv2.MORPH_CLOSE, k, iterations=1)
    mb = ndi.binary_fill_holes(mb).astype(np.uint8)
    mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
    mb = cv2.erode(mb, k, iterations=1)
    lab, _ = ndi.label(mb)
    stones = np.zeros_like(lab, dtype=np.int32)
    # a stone with mud smeared over it is found ragged: its hull is the stone if the hull is no bigger than a big
    # stone and takes nothing of another; else two stones ran together and the shape stays as found
    areas = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is not None:
            areas.append(cv2.contourArea(cv2.convexHull(np.stack(np.nonzero(lab[sl] == i)[::-1], 1).astype(np.int32))))
    big_stone = 1.6 * float(np.median([a for a in areas if a > 60]))
    next_id = [lab.max() + 1]
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None:
            continue
        ys, xs = np.nonzero(lab[sl] == i)
        if len(xs) < 60:
            continue
        pts = np.stack([xs + sl[1].start, ys + sl[0].start], 1).astype(np.int32)
        tmp = np.zeros(lab.shape, np.uint8)
        cv2.fillConvexPoly(tmp, cv2.convexHull(pts), 1)
        other = ((tmp == 1) & (lab != i) & (lab > 0)).sum()
        ragged_ok = tmp.sum() <= big_stone and other < 0.04 * tmp.sum()
        if tmp.sum() > 1.45 * len(xs) and not ragged_ok:
            # two stones run together: cut them apart where the shape is narrowest (a watershed over the distance
            # to its edge), each part its own hull; if it will not cut, keep the shape as found, its holes closed
            part = ndi.binary_fill_holes(cv2.morphologyEx((lab[sl] == i).astype(np.uint8), cv2.MORPH_CLOSE, k, iterations=2)).astype(np.uint8)
            part = cv2.copyMakeBorder(part, 2, 2, 2, 2, cv2.BORDER_CONSTANT, value=0)
            d = cv2.distanceTransform(part, cv2.DIST_L2, 5)
            seeds, ns = ndi.label(d > 0.6 * d.max())
            tmp[:] = 0
            if ns >= 2:
                mk = seeds.astype(np.int32)
                mk[part == 0] = ns + 1
                ws = cv2.watershed(cv2.cvtColor((255 - np.clip(d * 20, 0, 255)).astype(np.uint8), cv2.COLOR_GRAY2BGR), mk)
                for s in range(1, ns + 1):
                    py, px = np.nonzero(ws == s)
                    if len(px) < 60:
                        continue
                    q = np.zeros(lab.shape, np.uint8)
                    cv2.fillConvexPoly(q, cv2.convexHull(np.stack([px - 2 + sl[1].start, py - 2 + sl[0].start], 1).astype(np.int32)), 1)
                    # a gap between the parts: they are two stones
                    q = cv2.erode(q, k, iterations=1)
                    nid = next_id[0]
                    next_id[0] += 1
                    stones[(q == 1) & (stones == 0)] = nid
                continue
            tmp[sl] = part[2:-2, 2:-2]
        stones[(tmp == 1) & (stones == 0)] = i
    stones[cv2.erode((stones > 0).astype(np.uint8), k, iterations=1) == 0] = 0
    dist = ndi.distance_transform_edt(stones > 0)[N:2 * N, N:2 * N]
    center = stones[N:2 * N, N:2 * N]
    on = center > 0
    e = np.clip(dist / 4.0, 0, 1)
    h = np.where(on, np.sqrt(1 - (1 - e) ** 2), 0.08).astype(np.float32)
    h = cv2.GaussianBlur(np.tile(h, (3, 3)), (0, 0), 0.8)[N:2 * N, N:2 * N]
    if BRIGHT:
        # muddy joints the finder only half finds: the picture's own light and dark (the stones lighter than the mud),
        # smoothed so a wet speck on a stone is no pit, laid under the stones found
        b = cv2.medianBlur(np.clip(lum, 0, 255).astype(np.uint8), 5).astype(np.float32)
        b = cv2.GaussianBlur(np.tile(b, (3, 3)), (0, 0), 1.5)[N:2 * N, N:2 * N]
        b = np.clip((b - np.percentile(b, 3)) / (np.percentile(b, 97) - np.percentile(b, 3)), 0, 1)
        h = np.clip((1 - BRIGHT) * h + BRIGHT * b, 0, 1)
    cv2.imwrite(f"{out}/{name}_h.png", np.clip(h * 255, 0, 255).astype(np.uint8))
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
    cv2.imwrite(f"{out}/{name}_id.png", ids[:, :, ::-1])
    vis = (im * 0.5).astype(np.uint8)
    vis[on] = (vis[on] * 0.5 + np.array([0, 120, 0])).astype(np.uint8)
    cv2.imwrite(f"{out}/{name}_seg.jpg", vis[:, :, ::-1])
    print("stones", len(np.unique(center[on])))


if __name__ == "__main__":
    main(*sys.argv[1:7])

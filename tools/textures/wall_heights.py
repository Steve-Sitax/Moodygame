"""Height maps for the house wall pictures (bump maps on the buildings, 2026-09-26).

The house walls (client/src/world/houseGrime.ts) draw the plain wall from pictures in a texture array, one layer
each (WALL_PICS there, wall_<name>.jpg). The relief light on the walls (client/src/retro/psx.ts wallRelief) wants a
height map per picture that lines up with it: brick and stone faces high with rounded arrises, the mortar joints
sunk; plaster and render nearly flat with their own lumps and cracks, plaster flaked off to the brick lower still;
roughcast a field of small lumps. The pictures tile, so the work is done on 3 x 3 copies.

    python tools/textures/wall_heights.py [name ...]        every picture in KINDS, or the names given
    python tools/textures/wall_heights.py --check           which height maps are missing or older than their picture

writes client/public/textures/wall_<name>_h.png (512 px, the size of the game's array layers) and records the
picture's sha256 and the kind of wall in client/public/textures/wall_heights.json. The game loads a height map only where the json
names it with the hash of the picture it was made from (retro/psx.ts wallHeights): a picture replaced
without running this again has a flat wall, never the old picture's bricks. Previews go to data/shots/wallh_<name>.jpg.
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

N = 512
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TEX = os.path.join(ROOT, "client", "public", "textures")
SHOTS = os.path.join(ROOT, "data", "shots")

# the kind of wall each picture shows (the names of houseGrime.ts WALL_PICS), and for brick and stone how the joints
# are found: the median's size (about a brick), the shortest line kept (horizontal, vertical) and how much of the
# picture is joint (percentile). Ashlar has big blocks and thin joints; the old yellow brick is sooty, so its joints
# take a wider look. The limewashed brick is a skin flaked off the brick: plaster.
BRICK = {"med": 21, "hor": 17, "ver": 9, "pct": 72}
# The third value is how strong the game draws it (retro/psx.ts wallRelief), from the pictures (the lead's review,
# 2026-09-26): the fine bricks a touch less pillowy, the yellow brick's small courses much less (they striped like
# corrugated sheet at 6 m), the smooth plaster almost flat, the roughcast only lumps of its grain.
KINDS = {
    "brick": ("brick", {**BRICK, "floor": 0.12}, 1.0),  # (its worn mortar is recessed: deep, as reviewed)
    "brick_fine": ("brick", BRICK, 0.8),
    "brick_clinker": ("brick", BRICK, 1.0),
    "brick_yellow": ("brick", BRICK, 0.4),
    "brick_yellow_old": ("brick", {"med": 31, "hor": 25, "ver": 11, "pct": 58}, 1.0),
    "brick_white": ("plaster", {}, 0.4),
    "speklagen": ("brick", BRICK, 1.0),
    "ashlar_sand": ("brick", {"med": 51, "hor": 45, "ver": 25, "pct": 90}, 1.0),
    "ashlar_blue": ("brick", {"med": 51, "hor": 45, "ver": 25, "pct": 90, "floor": 0.12}, 1.0),  # (as reviewed)
    "plaster": ("plaster", {}, 0.12),
    "plaster_smooth": ("plaster", {}, 0.04),
    "render": ("plaster", {}, 0.12),
    "plaster_rough": ("rough", {}, 0.1),
}


def tile3(a):
    return np.tile(a, (3, 3) + (1,) * (a.ndim - 2))


def mid(a):
    return a[N:2 * N, N:2 * N]


def highpass(lum, sigma):
    """The picture's own light and dark at one size, -1..1: lumps and pits the colour shows."""
    big = tile3(lum)
    hp = mid(cv2.GaussianBlur(big, (0, 0), 0.8) - cv2.GaussianBlur(big, (0, 0), sigma))
    return np.clip(hp / (np.percentile(np.abs(hp), 98) + 1e-6), -1, 1)


def brick(im, lum, med=21, hor=17, ver=9, pct=72, floor=None):
    """Bricks or stones in mortar: the joints are where the colour leaves the brick's own (in Lab, against a median as
    big as a brick), kept only as lines (a horizontal and a vertical opening), so a spall is no joint."""
    lab = cv2.cvtColor(im.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    big = tile3(lab)
    m = np.stack([cv2.medianBlur(np.clip(big[:, :, k], 0, 255).astype(np.uint8), med).astype(np.float32) for k in range(3)], 2)
    d = big - m
    dist = cv2.GaussianBlur(np.sqrt(d[:, :, 0] ** 2 * 0.5 + d[:, :, 1] ** 2 + d[:, :, 2] ** 2), (0, 0), 1.0)
    line = np.maximum(
        cv2.morphologyEx(dist, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (hor, 1))),
        cv2.morphologyEx(dist, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, ver))),
    )
    joint = line > np.percentile(mid(line), pct)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    face = cv2.morphologyEx((~joint).astype(np.uint8), cv2.MORPH_OPEN, k, iterations=1)
    face = ndi.binary_fill_holes(face).astype(np.uint8)
    # rounded arrises, about 3 px (a centimetre on a 1.9 m tile)
    e = np.clip(mid(ndi.distance_transform_edt(face)) / 3.0, 0, 1)
    dome = np.sqrt(1 - (1 - e) ** 2)
    detail = highpass(lum, 4.0)
    on = mid(face) > 0
    # light mortar (the speklagen, the yellow brick) is pointed nearly flush: shallow joints, so the game's shade in
    # them stays a little darker than the mortar's own tone, never dark lines
    if floor is None:
        floor = 0.5 if lum[~on].mean() > lum[on].mean() else 0.12
    h = np.where(on, (0.84 - floor) * dome + floor + 0.1 * detail, floor + 0.05 * detail)
    return h, on


def plaster(im, lum, **_):
    """Lime plaster and render: a skin with lumps and cracks, and where it has come off the brick lies lower (the
    warm red of the brick against the plaster's own colour)."""
    # the brick is red (Lab a*), the ochre plaster yellow and the render grey: a* over 139 (neutral is 128)
    red = mid(cv2.GaussianBlur(tile3(cv2.cvtColor(im.astype(np.uint8), cv2.COLOR_RGB2LAB)[:, :, 1].astype(np.float32)), (0, 0), 1.5))
    off = (red > max(139.0, float(np.percentile(red, 90)))).astype(np.uint8)
    off = cv2.morphologyEx(off, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    off = cv2.morphologyEx(off, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
    # cracks: thin dark lines
    sm = cv2.GaussianBlur(tile3(lum), (0, 0), 1.0)
    crack = mid(cv2.morphologyEx(sm, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))))
    crack = np.clip(crack / (np.percentile(crack, 99.5) + 1e-6), 0, 1)
    # (only the fine lumps: houseGrime.ts flattens the plaster's big patches in the colour, so big waves here would
    # be dents the colour does not show)
    h = 0.62 + 0.14 * highpass(lum, 4.0) - 0.3 * crack
    # the plaster's broken edge stands a little proud of the hole
    step = cv2.GaussianBlur(off.astype(np.float32), (0, 0), 1.2)
    h = h * (1 - step) + (0.22 + 0.08 * highpass(lum, 4.0)) * step
    return h, ~off


def rough(im, lum, **_):
    """Roughcast: small lumps of pebble and lime, lit on top; the picture's light is their height."""
    # (only the grain's own size: bigger lumps read as hammered metal)
    h = 0.5 + 0.45 * highpass(lum, 1.5)
    return h, np.ones_like(lum, bool)


def make(name):
    src = os.path.join(TEX, f"wall_{name}.jpg")
    raw = open(src, "rb").read()
    im = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)[:, :, ::-1]
    im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = im.mean(axis=2)
    kind, params, _ = KINDS[name]
    h, top = {"brick": brick, "plaster": plaster, "rough": rough}[kind](im, lum, **params)
    h = np.clip(h, 0, 1)
    h = mid(cv2.GaussianBlur(tile3(h.astype(np.float32)), (0, 0), 0.6))
    cv2.imwrite(os.path.join(TEX, f"wall_{name}_h.png"), np.clip(h * 255, 0, 255).astype(np.uint8))
    os.makedirs(SHOTS, exist_ok=True)
    vis = (im * 0.55).astype(np.uint8)
    vis[~top] = (vis[~top] * 0.4 + np.array([150, 0, 0])).astype(np.uint8)
    hv = cv2.cvtColor(np.clip(h * 255, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2RGB)
    cv2.imwrite(os.path.join(SHOTS, f"wallh_{name}.jpg"), np.hstack([im.astype(np.uint8), vis, hv])[:, :, ::-1])
    return hashlib.sha256(raw).hexdigest()


def manifest():
    p = os.path.join(TEX, "wall_heights.json")
    return (json.load(open(p)) if os.path.exists(p) else {}), p


def main(args):
    have, path = manifest()
    if args[:1] == ["--check"]:
        for name in KINDS:
            src = os.path.join(TEX, f"wall_{name}.jpg")
            if not os.path.exists(src):
                continue
            sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
            state = "ok" if have.get(name, {}).get("sha256") == sha and os.path.exists(os.path.join(TEX, f"wall_{name}_h.png")) else ("stale" if name in have else "missing")
            print(f"{name:18s} {state}")
        return
    for name in args or list(KINDS):
        if name not in KINDS:
            sys.exit(f"unknown wall picture: {name} (KINDS in {__file__})")
        have[name] = {"sha256": make(name), "kind": KINDS[name][0], "bump": KINDS[name][2]}
        print("height map", name, KINDS[name][0])
    json.dump(dict(sorted(have.items())), open(path, "w", newline="\n"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])

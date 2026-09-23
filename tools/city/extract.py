"""Trace the 1873 city from the Vuillaume map into shared/city.json.

Source: "1853/1873: Vuillaume (1/5000)", FelixArchief 12#487, via Wikimedia Commons,
CC0 1.0. Full-res file SHA-256 55f3c7c0...b096 (see assets/ATTRIBUTION.md).
The map is not stored in git. Put it at data/refs/vuillaume_1873.jpg, then run:

    python tools/city/extract.py

Steps: resample the map to a 0.5 m grid in local metres (georef.json, fitted on
six landmarks that stand today: Bonapartedok, Willemdok, cathedral, town hall,
Carolus Borromeus, Sint-Jacob; rms 6 m), split colours into built blocks (red),
public buildings (orange) and water (blue), clean, and vectorise.

World frame (the game): x along the Rijnkaai quay edge (19 deg east of north),
z inland (19 deg south of east), y up. Water lies west, at -z. Origin is on the
river edge of the Rijnkaai, between the Canal des Brasseurs and the lock.
"""

import json
import math
import os
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REFS = os.path.join(ROOT, "data", "refs")
OUT = os.path.join(ROOT, "shared", "city.json")

RES = 0.5  # metres per raster cell
# the area we trace, in local metres (east, north) around lat 51.2235, lon 4.4000
E0, E1, N0, N1 = -320.0, 520.0, -560.0, 800.0
# world origin: on the river edge of the Rijnkaai (Quai Tavernier / Quai Sud de l'Ecluse).
# The world is turned by THETA so that this quay edge runs along +x (fitted on the Quai Sud, 23.5 deg east of north).
ORIGIN_E, ORIGIN_N = 20.7, 480.0
THETA = math.radians(23.5)

GEOREF = {
    "about": "Vuillaume full-res pixel -> local metres: m = a*(px - i*py) + b (complex numbers)",
    "lat0": 51.2235,
    "lon0": 4.4000,
    "a": [0.42140556, 0.00323217],
    "b": [0.0, 0.0],
}


def load_georef():
    p = os.path.join(REFS, "georef.json")
    if os.path.exists(p):
        g = json.load(open(p))
        GEOREF.update({k: g[k] for k in ("a", "b", "lat0", "lon0")})
        GEOREF["rms_m"] = g.get("rms_m")
    return complex(*GEOREF["a"]), complex(*GEOREF["b"])


def resample(a, b):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    im = np.asarray(Image.open(os.path.join(REFS, "vuillaume_1873.jpg")).convert("RGB"))[:, :, ::-1]
    W = int((E1 - E0) / RES)
    H = int((N1 - N0) / RES)
    cols, rows = np.meshgrid(np.arange(W), np.arange(H))
    m = (E0 + (cols + 0.5) * RES) + 1j * (N1 - (rows + 0.5) * RES)
    q = (m - b) / a
    mapx = q.real.astype(np.float32)
    mapy = (-q.imag).astype(np.float32)
    return cv2.remap(np.ascontiguousarray(im), mapx, mapy, cv2.INTER_LINEAR, borderValue=(255, 255, 255))


def classify(met):
    im = met.astype(np.int16)
    B, G, R = im[..., 0], im[..., 1], im[..., 2]
    red = (R - G > 90) & (G < 80)
    orange = (R - G > 45) & (R - G <= 90) & (R - B > 95)
    water = (R - B < 45) & (R < 215) & (G > 120)
    return red.astype(np.uint8), orange.astype(np.uint8), water.astype(np.uint8)


def drop_small(mask, min_cells):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, np.uint8)
    keep[1:] = st[1:, 4] >= min_cells
    return keep[lab]


def fill_holes(mask, max_hole_cells):
    """Fill enclosed holes (courtyards, lettering) up to a size."""
    inv = (1 - mask).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = mask.shape
    out = mask.copy()
    for i in range(1, n):
        x, y, bw, bh, area = st[i]
        touches = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if not touches and area <= max_hole_cells:
            out[lab == i] = 1
    return out


def clean(red, orange, water):
    k3 = np.ones((3, 3), np.uint8)
    built = ((red | orange) > 0).astype(np.uint8)
    built = cv2.morphologyEx(built, cv2.MORPH_CLOSE, k3, iterations=2)
    built = drop_small(built, int(12 / RES**2))  # red elevation numbers, specks
    built = fill_holes(built, int(4000 / RES**2))  # courtyards and gardens inside blocks
    public = cv2.morphologyEx(orange, cv2.MORPH_CLOSE, k3, iterations=2)
    public = drop_small(public, int(60 / RES**2)) & built
    wat = cv2.morphologyEx(water, cv2.MORPH_OPEN, k3)
    wat = cv2.morphologyEx(wat, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))  # lettering in the river
    wat = drop_small(wat, int(150 / RES**2)) & (1 - built)
    wat = fill_holes(wat, int(600 / RES**2)) & (1 - built)
    return built, public, wat


def cell_to_world(c, r):
    e = E0 + (c + 0.5) * RES
    n = N1 - (r + 0.5) * RES
    return en_to_world(e, n)


def en_to_world(e, n):
    """Local metres (east, north) -> world [x, z]. x runs along the Rijnkaai (about north), z inland (about east)."""
    de, dn = e - ORIGIN_E, n - ORIGIN_N
    x = de * math.sin(THETA) + dn * math.cos(THETA)
    z = de * math.cos(THETA) - dn * math.sin(THETA)
    return [round(x, 2), round(z, 2)]


def polygons(mask, eps_m, min_area_m2):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1:
            continue  # holes are attached to their parent below
        if cv2.contourArea(c) * RES * RES < min_area_m2:
            continue
        ring = cv2.approxPolyDP(c, eps_m / RES, True)[:, 0, :]
        holes = []
        j = hier[i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) * RES * RES >= min_area_m2:
                hr = cv2.approxPolyDP(cs[j], eps_m / RES, True)[:, 0, :]
                holes.append([cell_to_world(int(x), int(y)) for x, y in hr])
            j = hier[j][0]
        out.append({"outer": [cell_to_world(int(x), int(y)) for x, y in ring], "holes": holes})
    return out


def main():
    a, b = load_georef()
    met = resample(a, b)
    red, orange, water = classify(met)
    built, public, wat = clean(red, orange, water)
    cv2.imwrite(os.path.join(REFS, "city_classes.png"), np.dstack([wat * 255, built * 160 + public * 95, built * 200]).astype(np.uint8))
    np.savez_compressed(os.path.join(REFS, "city_masks.npz"), built=built, public=public, water=wat)
    city = {
        "_about": "1873 Antwerp traced from the Vuillaume map (CC0). World metres: x along the Rijnkaai (19 deg east of north), z inland, origin on the Rijnkaai river edge. Built by tools/city/extract.py.",
        "source": "Vuillaume 1/5000, FelixArchief 12#487, Wikimedia Commons, CC0 1.0",
        "frame": {"originE": ORIGIN_E, "originN": ORIGIN_N, "thetaDeg": math.degrees(THETA), "lat0": GEOREF["lat0"], "lon0": GEOREF["lon0"], "georefRms": GEOREF.get("rms_m")},
        "area": [en_to_world(E0, N0), en_to_world(E1, N0), en_to_world(E1, N1), en_to_world(E0, N1)],
        "blocks": polygons(built, 0.6, 8),
        "public": polygons(public, 0.6, 40),
        "water": polygons(wat, 0.8, 100),
    }
    json.dump(city, open(OUT, "w"), separators=(",", ":"))
    print(f"blocks {len(city['blocks'])}, public {len(city['public'])}, water {len(city['water'])}, {os.path.getsize(OUT)//1024} KB")


if __name__ == "__main__":
    sys.exit(main())

"""The hiring board on the Rijnkaai (#153): oak posts on bluestone collars, a backboard of tongued boards in a moulded
frame, a painted header with the Hessenatie's name, a small pent roof of tarred boards on brackets, nail heads. All
of it painted dark green long ago and worn back to grey wood at the edges, scraps of old bills pasted over, rust
run from the nails. Our own work: the pictures are painted here. Game axes (y up, the board's face toward +z), metres,
the origin on the ground under the middle of the board. The notes (one per open job) are added by the game.
"""

import math

import numpy as np
from mathutils import Matrix

from workgoods import kit
from workgoods import paint as pt
from workgoods.kit import Box

from .models import GM, T, frame

PPM = 420
GREEN = (0.10, 0.20, 0.14)
FACE_Z = 0.087  # the backboard's front face: where the notes are pinned
SLOTS = [(x, y) for y in (1.80, 1.32) for x in (-0.64, -0.215, 0.215, 0.64)]


def painted(w, h, ppm, seed, rgb=GREEN, wear=0.35, bills=0.0, nails=0, along="u"):
    """Old oil paint over oak gone grey: brush marks, paint worn back where hands and weather go, old bills' paper scraps
    pasted over it, rust run down from nail holes."""
    if along == "v":
        return np.ascontiguousarray(painted(h, w, ppm, seed, rgb, wear, bills, nails, "u").transpose(1, 0, 2))
    rng = pt.rng_(seed)
    wood = pt.wood(w, h, ppm, (0.50, 0.45, 0.38), seed, knots=1, ring_mm=5.0, weather=0.9)
    X, Y = pt.coords(w, h, ppm)
    brush = pt.fbm(h, w, 0.10 * ppm, 0.006 * ppm, seed + 1, 3)
    mott = pt.fbm(h, w, 0.08 * ppm, 0.08 * ppm, seed + 2, 3)
    paint = np.asarray(rgb, np.float32) * (0.82 + 0.16 * brush + 0.2 * (mott - 0.5))[..., None]
    lo = 0.74 - 0.25 * wear
    bare = pt.sm(lo, lo + 0.05, pt.fbm(h, w, 0.02 * ppm, 0.007 * ppm, seed + 3, 4))
    img = paint * (1 - bare[..., None]) + wood * bare[..., None]
    if bills > 0:
        # torn corners of old bills, pale paper with lines of faded print, their edges ragged
        for _ in range(max(1, int(w * h / (ppm * ppm) * 5 * bills))):
            cx, cy = rng.uniform(0, w), rng.uniform(0, h)
            bw, bh = rng.uniform(0.08, 0.26) * ppm, rng.uniform(0.06, 0.20) * ppm
            ragged = pt.fbm(h, w, 0.02 * ppm, 0.02 * ppm, int(rng.integers(1 << 20)), 3)
            inside = (np.abs(X * ppm - cx) < bw / 2 + (ragged - 0.5) * 0.09 * ppm) & (np.abs(Y * ppm - cy) < bh / 2 + (ragged - 0.5) * 0.07 * ppm)
            tone = np.array((0.70, 0.66, 0.55)) * rng.uniform(0.75, 1.0)
            img[inside] = img[inside] * 0.25 + tone * 0.75
            lines = inside & ((((Y * ppm - cy) / max(2.0, 0.006 * ppm)) % 1.0) < 0.35) & (pt.fbm(h, w, 0.02 * ppm, 1, int(rng.integers(1 << 20)), 2) > 0.45)
            img[lines] *= 0.62
    for _ in range(nails):
        nx, ny = rng.uniform(0.02, w / ppm - 0.02), rng.uniform(0.02, h / ppm - 0.08)
        d = np.hypot(X - nx, Y - ny)
        img[d < 0.0025] = (0.08, 0.06, 0.05)
        run = (np.abs(X - nx) < 0.004 * (1 + (Y - ny) * 3)) & (Y > ny) & (Y < ny + rng.uniform(0.03, 0.12))
        pt.mix(img, run * pt.sm(ny + 0.15, ny, Y) * 0.55, pt.RUST * 1.2)
    img *= (0.86 + 0.2 * pt.fbm(h, w, 0.2 * ppm, 0.2 * ppm, seed + 4, 3))[..., None]
    return img


def header(w, h, ppm, seed):
    img = painted(w, h, ppm, seed, wear=0.25)
    unit = max(2, int(h * 0.075))
    mask = pt.text_mask("HESSENATIE", unit)[::-1]  # (the face's picture runs bottom up: letters drawn upside down read upright)
    mh, mw = mask.shape
    y0, x0 = (h - mh) // 2, (w - mw) // 2
    if x0 > 0 and y0 > 0:
        fade = pt.sm(0.3, 0.7, pt.fbm(mh, mw, 0.02 * ppm, 0.02 * ppm, seed + 5, 3))
        sub = img[y0:y0 + mh, x0:x0 + mw]
        m = (mask * (0.65 + 0.35 * fade))[..., None]
        img[y0:y0 + mh, x0:x0 + mw] = sub * (1 - m) + np.array((0.80, 0.74, 0.58)) * m
    return img


def cells(A, region):
    s = 900
    return {
        "post": A.cell(region, 2.50, 0.30, PPM // 2, lambda w, h, p: painted(w, h, p, s, wear=0.30, nails=3), "board post"),
        "plank": A.cell(region, 1.20, 0.45, PPM, lambda w, h, p: painted(w, h, p, s + 1, wear=0.12, bills=1.0, nails=6), "board planks"),
        "frame": A.cell(region, 2.40, 0.20, PPM, lambda w, h, p: painted(w, h, p, s + 2, wear=0.28, nails=4), "board frame"),
        "header": A.cell(region, 2.20, 0.26, PPM, lambda w, h, p: header(w, h, p, s + 3), "board header"),
        "roof": A.cell(region, 2.40, 0.50, PPM // 2, lambda w, h, p: pt.wood(w, h, p, (0.17, 0.15, 0.13), s + 4, ring_mm=6, weather=0.4) * 0.8, "board roof"),
        "stone": A.cell(region, 0.30, 0.30, PPM, lambda w, h, p: pt.iron(w, h, p, s + 5, rgb=(0.20, 0.21, 0.22), rust=0.03, pits=2.0) * 1.25, "board stone"),
        "nail": A.cell(region, 0.05, 0.05, PPM, lambda w, h, p: pt.iron(w, h, p, s + 6, rust=0.6), "board nails"),
        "end": A.cell(region, 0.50, 0.30, PPM, lambda w, h, p: pt.end_grain(w, h, p, (0.45, 0.40, 0.33), s + 7) * 0.8, "board end grain"),
    }


def nail(m, C, x, y, z, r=0.006):
    prof = [(r, 0.0), (r * 0.9, 0.0018), (r * 0.5, 0.0028), (0.0, 0.003)]
    with m.at(T(x, y, z)):
        kit.lathe(m, prof, 6, Box(C["nail"]), thr=60.0)


def build(A, region):
    C = cells(A, region)
    rng = np.random.default_rng(153)
    m = kit.Mesh("hiring_board")
    up = Box(C["post"], grain=1, ends=C["end"])
    with m.at(GM):
        for x in (-0.97, 0.97):
            kit.cbox(m, (x - 0.055, 0.0, -0.055), (x + 0.055, 2.42, 0.055), up, c=0.004, skip=((1, -1),), thr=32.0)
            kit.cbox(m, (x - 0.12, 0.0, -0.12), (x + 0.12, 0.07, 0.12), Box(C["stone"]), c=0.008, skip=((1, -1),), thr=32.0)
            # brackets under the roof
            kit.cbox(m, (x - 0.035, 2.20, 0.055), (x + 0.035, 2.40, 0.26), Box(C["post"], grain=2, ends=C["end"]), c=0.004, thr=32.0)
        # the backboard: tongued boards standing on end, a hair apart
        n = 9
        bw = 1.80 / n
        for i in range(n):
            x0 = -0.90 + i * bw
            kit.cbox(m, (x0 + 0.0008, 0.95, 0.055), (x0 + bw - 0.0008, 2.08, FACE_Z), Box(C["plank"], grain=1, rng=rng), c=0.0025, thr=32.0)
        # the tongues: a dark strip behind the joints
        kit.cbox(m, (-0.90, 0.95, 0.060), (0.90, 2.08, 0.066), Box(C["frame"], grain=0, ends=C["end"]), c=0.0, shade=0.35, thr=32.0)
        # battens behind
        for y in (1.12, 1.90):
            kit.cbox(m, (-0.92, y - 0.04, 0.025), (0.92, y + 0.04, 0.055), Box(C["frame"], grain=0, ends=C["end"]), c=0.003, thr=32.0)
        # the moulded frame round the face
        fz0, fz1 = FACE_Z, FACE_Z + 0.032
        kit.cbox(m, (-0.97, 2.04, fz0), (0.97, 2.12, fz1), Box(C["frame"], grain=0, ends=C["end"]), c=0.006, thr=32.0)
        kit.cbox(m, (-0.97, 0.90, fz0), (0.97, 0.98, fz1), Box(C["frame"], grain=0, ends=C["end"]), c=0.006, thr=32.0)
        for x in (-0.935, 0.935):
            kit.cbox(m, (x - 0.035, 0.98, fz0), (x + 0.035, 2.04, fz1), Box(C["frame"], grain=1, ends=C["end"]), c=0.006, thr=32.0)
        # the header with the name
        kit.cbox(m, (-1.03, 2.112, 0.055), (1.03, 2.35, 0.09), Box(C["header"], grain=0, ends=C["end"]), c=0.005, thr=32.0,
                 face_skins={(2, -1): Box(C["frame"], grain=0, ends=C["end"])})  # the name on the face only
        # the pent roof: boards falling toward the front, a drip board along its edge
        tilt = math.radians(9.0)
        d = (math.cos(tilt), -math.sin(tilt))  # (z, y) toward the front, falling
        o = (-0.14, 2.43)
        nrm = (math.sin(tilt), math.cos(tilt))
        M = frame((0.0, o[1], o[0]), (d[1], d[0]), (nrm[1], nrm[0]))  # local y along the fall, local z up out of it
        with m.at(M):
            for k in range(5):
                x0 = -1.16 + k * 0.464
                kit.cbox(m, (x0 + 0.002, 0.0, 0.0), (x0 + 0.462, 0.50, 0.022), Box(C["roof"], grain=1, rng=rng), c=0.003, thr=32.0)
            kit.cbox(m, (-1.17, 0.47, -0.06), (1.17, 0.50, 0.024), Box(C["frame"], grain=0, ends=C["end"]), c=0.003, thr=32.0)
        # nail heads along the frame and the battens
        for x in np.linspace(-0.86, 0.86, 7):
            for y in (0.94, 2.08):
                nail(m, C, float(x) + rng.uniform(-0.01, 0.01), y, fz1)
        for y in (1.10, 1.50, 1.92):
            for x in (-0.935, 0.935):
                nail(m, C, x, y, fz1)
    return m


EXTRAS = {"face_z": FACE_Z, "slots": [[x, y, FACE_Z] for x, y in SLOTS], "width": 2.34, "height": 2.5}

"""Setts laid again from their own picture, so colour, height and stones match (2026-09-27).

Steve: "big strokes of stone that seem higher while it should be cobble", "they repeat like texture mapping repeats;
it should just be cobble and have randomisation in texture". The street cobbles and the quay setts are Codex pictures
(tools/textures/src/*_codex.jpg, assets/ATTRIBUTION.md) whose height and stone maps setts_maps.py worked out from the
picture: where it could not find a joint (mud, a smear, a straw) two to five stones ran together into one long bump,
and a stone map had stones where the picture has none, the same in every tile. So the stones are laid here instead, and
the picture only lends its stone and its mud:

  - the layout: rows of setts in bond across the tile (it tiles), each stone its own width, a little turn and an
    uneven, rounded outline; the joints 7 to 15 px of the 1024;
  - the colour of each stone: a whole stone cut from the picture (only the stones found clean), turned or mirrored,
    fitted to the new stone, its rim a little darker; the mud between: the picture with its stones filled in by their
    surroundings, its own grain laid back on; mud smeared over some stones, the picture's straw and leaves on top;
  - the height (512 px): each stone a dome with a flat worn top and steep sides, a little of its own grain on it, the
    joints low; made from the same layout, so every bump is a stone of the picture and nothing else;
  - the stone map (512 px, world/paving.ts Paving.id): r = the stone's number, g = 255 on a stone, b = 255 on the part
    of a stone that runs on from the tile to the left, so the shader rolls each stone's own dice in each tile (its tone,
    sunk, gone): the tile no longer repeats stone for stone.

    python tools/textures/setts_synth.py street|quay [seed]

writes client/public/textures/<name>.jpg (1024 px), <name>_h.png and <name>_id.png (512 px).
"""
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "client", "public", "textures")
N = 1024  # colour
NH = 512  # height and stone map
# per paving: the picture, how its stones are found (joint percentile, how much the mud's colour counts), the rows
# across the tile, the stone widths (px of the 1024), the joints, the mud's tint, how much mud is smeared on
PROFILES = {
    # the street cobbles: 3 m a tile, small setts, muddy joints
    "street": dict(name="street_cobble", rows=13, w=(66, 134), gx=(7, 15), gy=(8, 14), jpct=50, sat=0.6, tint=(0.8, 0.86, 0.94), smear=0.58),
    # the quay setts: 2.5 m a tile, bigger granite setts, clean dark joints
    "quay": dict(name="quay_setts", rows=12, w=(84, 150), gx=(8, 14), gy=(9, 14), jpct=60, sat=0.0, tint=(0.85, 0.88, 0.92), smear=0.66),
}


def wrap_paste(dst, src, mask, x0, y0):
    """Blend src into dst at (x0, y0) by mask (0..1), wrapping round the tile's edges."""
    h, w = mask.shape
    ys = (np.arange(h) + y0) % dst.shape[0]
    xs = (np.arange(w) + x0) % dst.shape[1]
    sub = dst[np.ix_(ys, xs)]
    m = mask[..., None] if dst.ndim == 3 else mask
    if callable(src):
        src = src(sub)
    dst[np.ix_(ys, xs)] = sub * (1 - m) + src * m


def stone_shape(w, h, r, turn, rng):
    """An uneven rounded stone of w x h px (anti-aliased mask 0..1), in a canvas with a margin for its turn."""
    pad = 8
    W, H = w + 2 * pad, h + 2 * pad
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W / 2, H / 2
    # rounded box distance, the half sizes wobbling along the outline (no two stones alike)
    ang = np.arctan2(yy - cy, xx - cx)
    wob = 1 + sum(rng.uniform(-0.035, 0.035) * np.cos(k * ang + rng.uniform(0, 6.3)) for k in (2, 3, 5))
    hx, hy = w / 2 * wob, h / 2 * wob
    qx = np.abs(xx - cx) - (hx - r)
    qy = np.abs(yy - cy) - (hy - r)
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    mask = np.clip(0.5 - d, 0, 1)
    M = cv2.getRotationMatrix2D((cx, cy), turn, 1.0)
    mask = cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_LINEAR)
    return mask, pad, M


def main(which="street", seed="7"):
    P = PROFILES[which]
    SRC = os.path.join(ROOT, "tools", "textures", "src", P["name"] + "_codex.jpg")
    ROWS = P["rows"]
    rng = np.random.default_rng(int(seed))
    im = cv2.imread(SRC).astype(np.float32)
    im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA)

    # ---- the picture's stones: found as setts_maps.py finds them, kept only where the find is clean
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    lum = im.mean(axis=2)
    big = np.tile(lum, (3, 3))
    sm = cv2.GaussianBlur(big, (0, 0), 3.2)
    bh = cv2.morphologyEx(sm, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (37, 37)))[N:2 * N, N:2 * N]
    hsv = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (0, 0), 3)
    score = (1 - P["sat"]) * bh / (np.percentile(bh, 99) + 1e-6) + P["sat"] * sat / (np.percentile(sat, 99) + 1e-6)
    joint = score > np.percentile(score, P["jpct"])
    stone = (~joint).astype(np.uint8)
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    stone = cv2.morphologyEx(stone, cv2.MORPH_OPEN, k3, iterations=2)
    stone = ndi.binary_fill_holes(stone).astype(np.uint8)
    lab, n = ndi.label(stone)
    swatches = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None:
            continue
        m = (lab[sl] == i).astype(np.uint8)
        area = m.sum()
        hh, ww = m.shape
        if area < 2200 or ww < 55 or hh < 38 or hh > 100 or ww > 170:
            continue
        if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == N or sl[1].stop == N:
            continue
        hull = cv2.convexHull(np.stack(np.nonzero(m)[::-1], 1).astype(np.int32))
        solid = area / max(1.0, cv2.contourArea(hull))
        if solid < 0.86 or area / (ww * hh) < 0.62:
            continue
        # the middle of the stone only (its own edge is laid anew), as a colour patch
        y0, x0 = sl[0].start, sl[1].start
        e = 5
        patch = im[y0 + e:y0 + hh - e, x0 + e:x0 + ww - e].copy()
        swatches.append(patch)
    if len(swatches) < 20:
        raise SystemExit(f"only {len(swatches)} clean stones in the picture")

    # ---- the mud: the picture with every stone found filled in from its surroundings (twice: small and large)
    fill = cv2.dilate((stone > 0).astype(np.uint8), k3, iterations=2)
    big_im = np.tile(np.clip(im, 0, 255).astype(np.uint8), (3, 3, 1))
    big_mask = np.tile(fill * 255, (3, 3))
    mud = cv2.inpaint(big_im, big_mask, 9, cv2.INPAINT_TELEA)[N:2 * N, N:2 * N].astype(np.float32)
    # the filling is smooth: the picture's own grain (pebbles, crumbs) laid back on it
    hp = im - cv2.GaussianBlur(im, (0, 0), 3.0)
    mud = mud + np.clip(hp, -35, 35) * 0.9
    # a little darker and browner than the picture's: wet mud and dung between the stones
    mud *= np.array(P["tint"], np.float32)

    # ---- the layout
    col = mud.copy()
    height = np.zeros((N, N), np.float32)
    ids = np.zeros((N, N, 3), np.uint8)
    sid = 0
    ch = N / ROWS
    for row in range(ROWS):
        y_top = row * ch
        # widths along the row, then stretched a little to close the tile exactly
        ws = []
        while sum(ws) < N:
            ws.append(rng.uniform(*P["w"]))
        scale = N / sum(ws)
        if scale < 0.9:
            ws[-1] -= sum(ws) - N
            if ws[-1] < P["w"][0] * 0.85:
                ws.pop()
            scale = N / sum(ws)
        ws = [w * scale for w in ws]
        x = rng.uniform(0, N)
        for w in ws:
            gap_x = rng.uniform(*P["gx"])
            gap_y = rng.uniform(*P["gy"])
            sw = int(round(w - gap_x))
            sh = int(round(ch - gap_y - rng.uniform(0, 5)))
            r = rng.uniform(9, 17)
            turn = rng.uniform(-3.5, 3.5)
            jit = rng.uniform(-2.0, 2.0)
            # no stone crosses the tile's top or bottom edge (the stone map carries a stone on only across x)
            sh = min(sh, int(2 * (ch / 2 - 1.5 - abs(jit) - sw / 2 * abs(np.sin(np.radians(turn))))))
            mask, pad, M = stone_shape(sw, sh, r, turn, rng)
            H, W = mask.shape
            cx = x + w / 2
            cy = y_top + ch / 2 + jit
            px0 = int(round(cx - W / 2))
            py0 = int(round(cy - H / 2))
            # the stone's face: a swatch, turned or mirrored, fitted to the stone and turned with it
            s = swatches[rng.integers(len(swatches))]
            if rng.random() < 0.5:
                s = s[:, ::-1]
            if rng.random() < 0.5:
                s = s[::-1, :]
            face = cv2.resize(s, (W, H), interpolation=cv2.INTER_LINEAR)
            face = cv2.warpAffine(face, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            # worn edge: the rim a little darker (it rounds off into the joint), the top a hair lighter
            dist = ndi.distance_transform_edt(mask > 0.5)
            rim = np.clip(dist / 6.0, 0, 1)
            face = face * (0.72 + 0.28 * rim)[..., None] * rng.uniform(0.9, 1.1)
            # a soft shadow of the stone in the mud round it
            shadow = cv2.GaussianBlur(mask, (0, 0), 3.0)
            wrap_paste(col, lambda sub: sub * 0.62, np.clip(shadow * 0.8, 0, 1), px0, py0)
            wrap_paste(col, face, mask, px0, py0)
            # height: a dome with a flat top (worn), steep sides, a little of the face's own grain
            e = np.clip(dist / 10.0, 0, 1)
            dome = np.sqrt(1 - (1 - e) ** 2)
            grain = cv2.GaussianBlur(face.mean(axis=2), (0, 0), 1.5)
            grain = (grain - grain[mask > 0.5].mean()) / (grain[mask > 0.5].std() + 1e-6)
            top = rng.uniform(0.82, 1.0)
            hgt = np.clip(dome * top + 0.05 * grain * e, 0, 1)
            ys = (np.arange(H) + py0) % N
            xs = (np.arange(W) + px0) % N
            cur = height[np.ix_(ys, xs)]
            height[np.ix_(ys, xs)] = np.maximum(cur, hgt * (mask > 0.5))
            # the stone map: its number, on a stone, and which part ran on from the tile to the left
            sid += 1
            on = mask > 0.5
            sub = ids[np.ix_(ys, xs)]
            sub[on, 0] = (sid * 97) % 254 + 1
            sub[on, 1] = 255
            wrapped = (np.arange(W) + px0) >= N  # the columns that ran past the right edge: the next tile
            runs = np.zeros_like(on)
            runs[:, wrapped] = True
            if px0 < 0:
                runs[:, (np.arange(W) + px0) >= 0] = True  # it started in the tile to the left
            sub[on & runs, 2] = 255
            sub[on & ~runs, 2] = 0
            ids[np.ix_(ys, xs)] = sub
            x += w

    # the joints: low, with a little of the mud's own lumps
    mud_l = cv2.GaussianBlur(mud.mean(axis=2), (0, 0), 2.0)
    mud_l = (mud_l - mud_l.mean()) / (mud_l.std() + 1e-6)
    height = np.where(height > 0, height, np.clip(0.07 + 0.03 * mud_l, 0.0, 0.14))

    # mud smeared over the stones here and there (a slow noise), and the picture's own straw, leaves and dung laid
    # back on top (not too clean, as it was then: Steve, 2026-09-25); neither changes the height
    def noise(cells, sd):
        g = np.random.default_rng(sd).random((cells, cells)).astype(np.float32)
        return cv2.resize(np.tile(g, (3, 3)), (3 * N, 3 * N), interpolation=cv2.INTER_CUBIC)[N:2 * N, N:2 * N]
    smear = np.clip((0.55 * noise(9, int(seed) + 1) + 0.45 * noise(31, int(seed) + 2) - P["smear"]) * 5.0, 0, 0.85)
    smear *= np.clip(noise(64, int(seed) + 3) * 1.6 - 0.2, 0, 1)
    col = col * (1 - smear[..., None]) + mud * smear[..., None]
    # as dark and as brown as the picture on the whole
    col *= (im.reshape(-1, 3).mean(0) / col.reshape(-1, 3).mean(0))[None, None, :]
    hs_ = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV)
    straw = ((hs_[:, :, 0] >= 8) & (hs_[:, :, 0] <= 28) & (hs_[:, :, 1] > 95) & (hs_[:, :, 2] > 95)).astype(np.uint8)
    straw = cv2.morphologyEx(straw, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    straw = cv2.GaussianBlur(cv2.dilate(straw, np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 0.8)
    straw = np.clip(straw * 1.2, 0, 1)
    col = col * (1 - straw[..., None]) + im * straw[..., None]

    cv2.imwrite(os.path.join(OUT, P["name"] + ".jpg"), np.clip(col, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    hs = cv2.resize(height, (NH, NH), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, P["name"] + "_h.png"), np.clip(hs * 255, 0, 255).astype(np.uint8))
    idn = ids[::2, ::2]  # nearest: a stone's number never blends with its neighbour's
    cv2.imwrite(os.path.join(OUT, P["name"] + "_id.png"), idn[:, :, ::-1])
    print(f"swatches {len(swatches)}, stones {sid}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

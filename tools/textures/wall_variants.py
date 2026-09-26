"""The house wall pictures that are not straight from Codex (the districts pass, 2026-09-26): variants worked out
from the Codex pictures by this script, and two stone ashlars drawn from scratch. All tileable, 512 px.

    python tools/textures/wall_variants.py

Reads client/public/textures/wall_brick.jpg (Codex, the grime pass) and plaster_rough (the Codex picture, 1024 px
at client/public/textures/wall_plaster_rough.jpg), writes client/public/textures/wall_*.jpg:
  brick_fine        the old brick made cleaner and brighter: machine brick, the soot gone
  brick_yellow      the old brick coloured buff by its brightness
  brick_yellow_old  the buff brick darker and duller
  brick_white       the old brick under limewash, flaking where the noise says
  plaster_smooth    the roughcast smoothed: painted plaster
  ashlar_sand       sandstone blocks in courses, drawn: per-block tone, grain, fine joints
  ashlar_blue       bluestone blocks, drawn the same way, with tooling marks
Codex was not reachable for the rest of this pass (401 from its service), so these stand in for pictures of
their own. Numpy and Pillow only.
"""
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "client", "public", "textures")
N = 512
rng = np.random.default_rng(1873)


def load(name):
    im = Image.open(os.path.join(TEX, name)).convert("RGB").resize((N, N), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def save(a, name):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, name), quality=88)
    print("->", name)


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def tile_blur(a, r):
    """A blur that wraps round the edges (the picture stays tileable)."""
    big = np.tile(a, (3, 3, 1)) if a.ndim == 3 else np.tile(a, (3, 3))
    img = Image.fromarray((np.clip(big, 0, 1) * 255).astype(np.uint8))
    out = np.asarray(img.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0
    return out[N:2 * N, N:2 * N]


def noise(scale, octaves=4):
    """Fractal noise 0..1, tileable."""
    acc = np.zeros((N, N), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        r = max(0.5, scale / (2 ** o))
        acc += amp * tile_blur(rng.random((N, N)).astype(np.float32), r)
        tot += amp
        amp *= 0.5
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-6)


def main():
    old = load("wall_brick.jpg")
    L = lum(old)
    mortar = (L > np.percentile(L, 80)).astype(np.float32)  # the light joints of the old brick

    # machine brick: brighter and redder, the dark soot pulled up, the joints a clean light grey
    fine = np.power(np.clip(old * 1.25, 0, 1), 0.8)
    fine = fine * np.array([1.08, 0.95, 0.9])
    fine = fine * (1 - mortar[..., None] * 0.6) + mortar[..., None] * 0.6 * np.array([0.78, 0.76, 0.72])
    save(fine, "wall_brick_fine.jpg")

    # buff brick: the old brick's brightness mapped from a brown-ochre to a pale buff
    t = np.clip((L - L.min()) / (L.max() - L.min()), 0, 1)[..., None]
    dark, light = np.array([0.42, 0.33, 0.18]), np.array([0.92, 0.82, 0.6])
    yellow = dark * (1 - t) + light * t
    save(yellow, "wall_brick_yellow.jpg")
    grime = noise(40)[..., None]
    save(yellow * (0.6 + 0.2 * grime) * np.array([0.95, 0.93, 0.9]), "wall_brick_yellow_old.jpg")

    # limewash over the brick, gone only in a few small places (the shader, houseGrime.ts, knocks off the big
    # patches on a worn house: hard-edged, low on the wall; not round spots all over)
    n = noise(24)
    wash = (0.82 + 0.1 * t) * np.array([0.97, 0.96, 0.92])
    keep = np.clip((n - 0.1) * 12, 0, 1)[..., None]
    save(old * (1 - keep) + wash * keep, "wall_brick_white.jpg")

    # smooth painted plaster: the roughcast blurred, a faint unevenness
    rough = load("wall_plaster_rough.jpg")
    smooth = tile_blur(rough, 3) * (0.97 + 0.06 * noise(60)[..., None])
    save(smooth, "wall_plaster_smooth.jpg")

    # ashlar: courses 0.4 m (of 2.4 m a tile), blocks 0.8 to 1.2 m, laid on the tile's torus
    def ashlar(base, grain_amp, blue):
        a = np.zeros((N, N, 3), np.float32)
        rows = 6
        rh = N // rows
        grain = noise(3, 3)
        cloud = noise(50)
        for r in range(rows):
            x = int(rng.integers(0, N))
            left = N
            while left > 0:
                w = int(min(left, rng.integers(int(N * 0.33), int(N * 0.5)))) if left > N * 0.5 else left
                tone = 1 + rng.normal(0, 0.05)
                ys = slice(r * rh, (r + 1) * rh)
                cols = np.arange(x, x + w) % N
                a[ys][:, cols] = base * tone
                # the joints: 2 px, a little darker
                a[r * rh:r * rh + 2][:, cols] = base * 0.72
                a[ys][:, cols[:2]] = base * 0.72
                x += w
                left -= w
        a *= (1 - grain_amp / 2 + grain_amp * grain)[..., None]
        a *= (0.94 + 0.12 * cloud)[..., None]
        if blue:
            # tooled: fine vertical chisel lines; a few white fossil flecks
            lines = (np.sin(np.arange(N) * 1.7)[None, :] * 0.5 + 0.5) * 0.06
            a *= (1 - lines)[..., None]
            flecks = rng.random((N, N)) > 0.9985
            a[flecks] = np.array([0.75, 0.77, 0.76])
        return a
    save(ashlar(np.array([0.78, 0.69, 0.52]), 0.22, False), "wall_ashlar_sand.jpg")
    save(ashlar(np.array([0.42, 0.45, 0.47]), 0.3, True), "wall_ashlar_blue.jpg")


if __name__ == "__main__":
    main()

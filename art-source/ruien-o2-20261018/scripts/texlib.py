# Shared image helpers for the Ruien O2 texture pipeline.
# Plain numpy/scipy/opencv. All blurs wrap around, so tiles stay seamless.
import numpy as np
from PIL import Image
import cv2

def load_srgb(path):
    im = Image.open(path).convert('RGB')
    return np.asarray(im).astype(np.float32) / 255.0

def save_srgb(path, a):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path, optimize=False, compress_level=6)

def save_gray16(path, a):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 65535 + 0.5).astype(np.uint16)).save(path)

def save_gray8(path, a):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path)

def to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)

def to_srgb(a):
    a = np.clip(a, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)

def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722

def blur_wrap(a, sigma):
    """Gaussian blur with periodic edges (FFT). Works on 2D or 3D arrays."""
    if sigma <= 0:
        return a.copy()
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)
    out = np.empty_like(a)
    for c in range(a.shape[2]):
        out[..., c] = np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g))
    return out

def blur_aniso_wrap(a, sx, sy):
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * ((sx * fx) ** 2 + (sy * fy) ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)

def fbm_wrap(h, w, rng, octaves=6, base=4, persistence=0.55, aniso=(1.0, 1.0)):
    """Periodic fractal noise, roughly in -1..1, built from blurred white noise."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = rng.standard_normal((h, w)).astype(np.float32)
        s = max(h, w) / (base * (2 ** o)) / 2.5
        n = blur_aniso_wrap(n, s * aniso[0], s * aniso[1])
        n /= (n.std() + 1e-8)
        out += amp * n
        tot += amp
        amp *= persistence
    return out / tot

def normal_from_height(hgt, strength):
    """Tangent-space normal map (OpenGL, +Y up) from a height map in 0..1, periodic."""
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5 * strength
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5 * strength
    # image rows go down, so +v is -row
    nx, ny, nz = -dx, dy, np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5

def mincut_path(err):
    """Vertical min-cost path through err (h x w). Returns column per row."""
    h, w = err.shape
    cost = err.copy()
    back = np.zeros((h, w), np.int32)
    for y in range(1, h):
        prev = cost[y - 1]
        l = np.r_[np.inf, prev[:-1]]
        r = np.r_[prev[1:], np.inf]
        stack = np.stack([l, prev, r])
        idx = np.argmin(stack, 0)
        cost[y] += stack[idx, np.arange(w)]
        back[y] = idx - 1
    path = np.zeros(h, np.int32)
    path[-1] = int(np.argmin(cost[-1]))
    for y in range(h - 1, 0, -1):
        path[y - 1] = np.clip(path[y] + back[y, path[y]], 0, w - 1)
    return path

def make_tileable_x(img, ov):
    """Make an image wrap in x: overlap its right edge onto its left edge along a min-error seam."""
    h, w = img.shape[:2]
    A = img[:, w - ov:]           # right edge content
    B = img[:, :ov]               # left edge content
    e = ((A - B) ** 2)
    if e.ndim == 3:
        e = e.sum(-1)
    e = cv2.GaussianBlur(e, (0, 0), 1.5)
    path = mincut_path(e)
    cols = np.arange(ov)[None, :]
    m = (cols < path[:, None]).astype(np.float32)
    m = cv2.GaussianBlur(m, (0, 0), 1.2)
    if img.ndim == 3:
        m = m[..., None]
    out = img[:, :w - ov].copy()
    out[:, :ov] = A * m + B * (1 - m)
    return out

def make_tileable(img, ov=120):
    a = make_tileable_x(img, ov)
    a = np.swapaxes(make_tileable_x(np.swapaxes(a, 0, 1), ov), 0, 1)
    return np.ascontiguousarray(a)

def rand_patch_quilt(src, cand_mask, out_hw, patch, rng, sharp=2.0, flips=True):
    """Seamless, layout-free texture from random patches of src (variance preserving blend).
    cand_mask: bool array of allowed patch top-left positions."""
    H, W = out_hw
    acc = np.zeros((H, W, 3), np.float64)
    wsum = np.zeros((H, W), np.float64)
    w2sum = np.zeros((H, W), np.float64)
    ys, xs = np.nonzero(cand_mask)
    mean = src.reshape(-1, 3).mean(0)
    win1 = np.sin(np.linspace(0, np.pi, patch)) ** sharp
    win = np.outer(win1, win1) + 1e-4
    step = patch // 2
    for gy in range(0, H, step):
        for gx in range(0, W, step):
            i = rng.integers(len(ys))
            p = src[ys[i]:ys[i] + patch, xs[i]:xs[i] + patch] - mean
            if flips and rng.random() < 0.5:
                p = p[:, ::-1]
            oy = (gy + rng.integers(-step // 3, step // 3 + 1)) % H
            ox = (gx + rng.integers(-step // 3, step // 3 + 1)) % W
            yy = (np.arange(patch) + oy) % H
            xx = (np.arange(patch) + ox) % W
            acc[np.ix_(yy, xx)] += p * win[..., None]
            wsum[np.ix_(yy, xx)] += win
            w2sum[np.ix_(yy, xx)] += win ** 2
    out = mean + acc / np.sqrt(w2sum)[..., None]
    return np.clip(out, 0, 1).astype(np.float32)

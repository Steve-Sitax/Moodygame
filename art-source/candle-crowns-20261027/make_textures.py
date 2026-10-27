"""Pictures for the churches' candle crowns (Steve, 2026-10-27): aged church brass and yellowed candle wax.
    python make_textures.py <out dir>
Writes brass.png / brass-height.png (0.4 m of cast, polished-and-tarnished brass: mottled tarnish, polishing scratches
running round the ring, casting pits, a few verdigris specks) and wax.png / wax-height.png (0.2 m of tallow-yellowed
wax: runs down the candle, faint mottling, dust). Every picture tiles (built from periodic noise).
"""
import sys, pathlib
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(1873)

def noise(fx, fy=None, octave_falloff=0.0):
    """Periodic band-limited noise, 0..1: fx, fy = cycles across the picture (a smooth fall above them)."""
    fy = fx if fy is None else fy
    w = rng.standard_normal((N, N))
    kx = np.fft.fftfreq(N) * N; ky = np.fft.fftfreq(N) * N
    KX, KY = np.meshgrid(kx, ky)
    r = np.sqrt((KX / fx) ** 2 + (KY / fy) ** 2)
    f = np.exp(-r ** 2) * (1 + r) ** (-octave_falloff)
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * f))
    n -= n.min(); n /= n.max()
    return n

def fbm(base, octaves=5, gain=0.55, fy_ratio=1.0):
    t = np.zeros((N, N)); a = 1.0; s = 0.0
    for o in range(octaves):
        f = base * 2 ** o
        t += a * noise(f, f * fy_ratio); s += a; a *= gain
    return t / s

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def lines(count, lmin, lmax, slope, width=1):
    """Thin scratches along the picture's x (the ring's way round), wrapping at the edges: depth map 0..1."""
    m = np.zeros((N, N))
    for _ in range(count):
        x0, y0 = rng.uniform(0, N, 2); L = rng.uniform(lmin, lmax); a = rng.normal(0, slope)
        depth = rng.uniform(0.3, 1.0)
        for t in np.arange(0, L, 0.5):
            x = int(x0 + t) % N; y = int(y0 + t * a) % N
            fade = np.sin(np.pi * t / L)
            for w in range(width):
                m[(y + w) % N, x] = max(m[(y + w) % N, x], depth * fade)
    return m

def dots(count, rmin, rmax):
    m = np.zeros((N, N)); Y, X = np.mgrid[0:N, 0:N]
    for _ in range(count):
        cx, cy = rng.uniform(0, N, 2); r = rng.uniform(rmin, rmax)
        dx = (X - cx + N / 2) % N - N / 2; dy = (Y - cy + N / 2) % N - N / 2
        m = np.maximum(m, np.clip(1 - np.sqrt(dx * dx + dy * dy) / r, 0, 1))
    return m

def save(a, path, mode):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), mode).save(path)

def brass(out):
    # (second pass, Codex 2026-10-27: the 30 to 100 mm tarnish islands repeated as a camouflage of brown blots) a muted
    # body #9B824F with only a gentle broad ageing (a third of the old patches' contrast) toward tarnish #756344 and,
    # rarely, rubbed #B69A62; the life is in fine casting grain (one to two pixels: 0.8 to 1.5 mm), sparse 3 to 15 mm
    # marks and short scratches. The dark accumulation sits in the recesses, in the vertex colour, not in the picture.
    body = np.array([155, 130, 79]) / 255; tarn = np.array([117, 99, 68]) / 255; wear = np.array([182, 154, 98]) / 255
    broad = fbm(2, 4, gain=0.5)
    tn = smooth(np.quantile(broad, 0.35), np.quantile(broad, 0.98), broad) * 0.35
    wr = smooth(np.quantile(broad, 0.10), np.quantile(broad, 0.0), broad) * 0.30
    grain = noise(220)
    fine = noise(120)
    c = body * (1 - tn[..., None]) + tarn * tn[..., None]
    c = c * (1 - wr[..., None]) + wear * wr[..., None]
    c *= (0.975 + 0.045 * (grain - 0.5) + 0.03 * (fine - 0.5))[..., None]
    marks = dots(26, 2.0, 9.0)
    c *= (1 - 0.06 * smooth(0.0, 1.0, marks))[..., None]
    scr = lines(90, 4, 16, 0.25)          # short fine scratches, any way
    c += scr[..., None] * np.array([0.022, 0.018, 0.009])
    pits = dots(220, 0.5, 1.1)
    c *= (1 - 0.28 * pits)[..., None]
    verd = dots(8, 0.6, 1.2) * smooth(0.5, 1.0, tn / 0.35)
    c = c * (1 - verd[..., None] * 0.5) + np.array([0.33, 0.42, 0.31]) * verd[..., None] * 0.5
    h = 0.5 + 0.10 * (grain - 0.5) + 0.06 * (fine - 0.5) - 0.04 * marks - 0.10 * scr - 0.35 * pits
    save(c, out / 'brass.png', 'RGB'); save(h, out / 'brass-height.png', 'L')

def wax(out):
    # warm ivory #E5D8B5, older wax toward #D8C79D in faint runs (Codex 2026-10-27: not white)
    runs = fbm(26, 4, fy_ratio=0.12)       # runs down the candle (picture y = up the candle)
    mott = fbm(4, 4)
    fine = noise(90)
    base = np.array([229, 216, 181]) / 255; older = np.array([216, 199, 157]) / 255
    k = smooth(0.35, 0.85, mott * 0.6 + runs * 0.4)
    c = base * (1 - k[..., None] * 0.6) + older * (k[..., None] * 0.6)
    c *= (0.96 + 0.06 * runs + 0.025 * fine)[..., None]
    dust = dots(50, 0.5, 1.2)
    c *= (1 - 0.25 * dust)[..., None]
    h = 0.5 + 0.5 * (runs - 0.5) + 0.06 * (fine - 0.5) - 0.2 * dust
    save(c, out / 'wax.png', 'RGB'); save(h, out / 'wax-height.png', 'L')

if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    brass(out); wax(out); print('pictures in', out)

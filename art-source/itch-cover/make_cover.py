"""Compose the itch.io cover: the art plus the title in the game's own fonts. Renders with headless Edge,
because the fonts are woff2.

python art-source/itch-cover/make_cover.py --out <folder outside the repo>/cover.png
Paths are relative to this folder or absolute. The defaults give the cover published on 2026-11-12
(docs/media/itch-cover.jpg is its JPEG copy, quality 93). Sizes are in percent of the cover's height (vh) or
width (vw). Output: 1260x1000, with 630x500 and 315x250 copies to judge the small view.
Other layouts: --place bottom --ink light (cream title on a dark foot), --stack (two lines), --align center.
"""
import argparse
import subprocess
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
FONTS = (HERE.parent.parent / 'native-godot' / 'fonts').as_uri()
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

p = argparse.ArgumentParser()
p.add_argument('--art', default='quay-etching-seedream.png')
p.add_argument('--out', required=True)
p.add_argument('--focus-x', type=float, default=0.5)
p.add_argument('--focus-y', type=float, default=0.5)
p.add_argument('--zoom', type=float, default=1.0)
p.add_argument('--tx', type=float, default=5.0)
p.add_argument('--ty', type=float, default=5.5)
p.add_argument('--size', type=float, default=12.6)
p.add_argument('--veil', type=float, default=0.4)
p.add_argument('--align', default='left')
p.add_argument('--kicker', default='ANTWERP · AUTUMN 1873')
p.add_argument('--sub', default='')
p.add_argument('--place', default='top')
p.add_argument('--ink', default='dark')
p.add_argument('--stack', action='store_true')
p.add_argument('--fog-x', default='')
p.add_argument('--width', type=float, default=0)
a = p.parse_args()

art = (HERE / a.art).resolve()
out = (HERE / a.out).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
centre = a.align == 'center'
light = a.ink == 'light'
INK = '#f1e7d0' if light else '#221b15'
SOFT = '#e2d6bb' if light else '#3d3128'
GLOW = '18,12,7' if light else '236,227,207'
RULE = '241,231,208' if light else '34,27,21'
vpos = f'bottom: {a.ty}vh' if a.place == 'bottom' else f'top: {a.ty}vh'
fogx = a.fog_x or ('50%' if centre else '26%')
fog = (f'linear-gradient(to top, rgba(18,12,7,{a.veil}), rgba(18,12,7,0) 42%)' if a.place == 'bottom' else f'radial-gradient(ellipse 75% 46% at {fogx} 15%, rgba(236,227,207,{a.veil}), rgba(236,227,207,0) 100%)')
title = 'SCHELDE<br>MIST' if a.stack else 'SCHELDEMIST'
width = f'width: {a.width}vw;' if a.width else f'right: {a.tx}vw;'
html = f"""<!doctype html><meta charset="utf-8">
<style>
@font-face {{ font-family: Slab; src: url('{FONTS}/alfa-slab-one-latin-400-normal.woff2') format('woff2'); }}
@font-face {{ font-family: Print; src: url('{FONTS}/old-standard-tt-latin-400-normal.woff2') format('woff2'); }}
@font-face {{ font-family: Print; font-style: italic; src: url('{FONTS}/old-standard-tt-latin-400-italic.woff2') format('woff2'); }}
html, body {{ margin: 0; width: 1260px; height: 1000px; overflow: hidden; background: #cfc3a8; }}
.art {{ position: absolute; inset: 0; background: url('{art.as_uri()}') {a.focus_x * 100}% {a.focus_y * 100}% / cover no-repeat;
        transform: scale({a.zoom}); transform-origin: {a.focus_x * 100}% {a.focus_y * 100}%; }}
/* the loading screen's veils: lighter fog where the words sit, the edges burnt like an old print */
.fog {{ position: absolute; inset: 0; background: {fog}; }}
.burn {{ position: absolute; inset: 0; background: radial-gradient(ellipse 85% 85% at 55% 46%, rgba(22,15,8,0) 62%, rgba(22,15,8,.42) 100%); }}
.words {{ position: absolute; left: {a.tx}vw; {width} {vpos}; text-align: {'center' if centre else 'left'}; color: {INK}; }}
.kicker {{ font: 3.05vh Print; letter-spacing: .34em; color: {SOFT}; margin-left: .2em; }}
.title {{ font: {a.size}vh/0.98 Slab; letter-spacing: .035em; margin-top: 1.1vh;
          text-shadow: 0 0 1.6vh rgba({GLOW},.75), 0 0 .5vh rgba({GLOW},.6); }}
.rule {{ height: 1.3vh; margin-top: 1.5vh; display: flex; align-items: center; gap: 1.2vh; justify-content: {'center' if centre else 'flex-start'}; }}
.rule i {{ display: block; height: .32vh; background: rgba({RULE},.75); width: 24vh; }}
.rule b {{ display: block; width: 1.15vh; height: 1.15vh; background: rgba({RULE},.8); transform: rotate(45deg); }}
.sub {{ font: italic 3.5vh Print; color: {SOFT}; margin-top: 1.4vh; }}
</style>
<div class="art"></div><div class="fog"></div><div class="burn"></div>
<div class="words">
  <div class="kicker">{a.kicker}</div>
  <div class="title">{title}</div>
  <div class="rule"><i></i><b></b><i></i></div>
  {f'<div class="sub">{a.sub}</div>' if a.sub else ''}
</div>
"""
page = out.with_suffix('.html')
page.write_text(html, encoding='utf-8')
import os, shutil, tempfile
prof = tempfile.mkdtemp(prefix='edge-', dir=HERE)
out.unlink(missing_ok=True)
subprocess.run([EDGE, '--headless=new', f'--user-data-dir={prof}', '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                '--window-size=1260,1000', '--virtual-time-budget=4000', f'--screenshot={out}', page.as_uri()],
               check=True, timeout=120, capture_output=True)
import time
for _ in range(120):
    if out.exists() and out.stat().st_size > 0: break
    time.sleep(0.5)
time.sleep(1.0)
shutil.rmtree(prof, ignore_errors=True)
im = Image.open(out).convert('RGB')
assert im.size == (1260, 1000), im.size
im.save(out)
im.resize((630, 500), Image.LANCZOS).save(out.with_name(out.stem + '-630.png'))
im.resize((315, 250), Image.LANCZOS).save(out.with_name(out.stem + '-315.png'))
print('wrote', out, im.size)

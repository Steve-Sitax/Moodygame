"""Offline picture-only handoff for issue 84. Never loads Godot or writes a scene.

PhotoCraft performs photograph resampling. NumPy assembles co-registered material
layers and periodic geometric relief. Pillow writes the maps and QA contact sheets.
Run from any directory: python art-source/plan-84/build_maps.py --proof <directory>
Retained originals are immutable; outputs are confined to assets/textures/plan-84.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import zipfile

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_erosion

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DEST = ROOT / 'native-godot/assets/textures/plan-84'
CRAFT = Path.home() / 'AppData/Local/Programs/PhotoCraft/photocraft-cli.exe'
GENERATED = HERE / 'generated'
REUSED = HERE / 'reused'
ENV = ROOT / 'art-source/environment-20261013'
SURFACES = {}
ENTRIES = []
PROOF = None


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def load(path, size=None, crop=None):
    """Use the installed image editor; never resample the source in place."""
    path = Path(path)
    if size or crop:
        key = hashlib.sha256((str(path) + str(size) + str(crop)).encode()).hexdigest()[:16]
        target = PROOF / 'resampled' / (key + '.png')
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            cmd = [str(CRAFT), 'run', str(path)]
            if crop:
                x, y, w, h = crop
                cmd += ['--cmd', 'image.crop', '--params', json.dumps(dict(x=x, y=y, width=w, height=h))]
            if size:
                cmd += ['--cmd', 'image.imageSize', '--params', json.dumps(dict(width=size[0], height=size[1], resample='lanczos'))]
            cmd += ['--out', str(target)]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            if p.returncode:
                raise RuntimeError(p.stdout + p.stderr)
        path = target
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32) / 255


def resize_data(a, size):
    """Linear numeric field sampling; not a colour-space conversion."""
    if a.shape[1::-1] == tuple(size):
        return a.copy()
    if a.ndim == 3:
        return np.stack([resize_data(a[..., k], size) for k in range(a.shape[-1])], -1)
    return np.asarray(Image.fromarray(a.astype('float32')).resize(size, Image.Resampling.BILINEAR))


def load_field(path, size):
    """Read numeric PNG depth without converting 16-bit displacement to RGB8."""
    raw=np.asarray(Image.open(path))
    maximum=65535 if raw.dtype==np.uint16 else 255
    if raw.ndim==3:raw=raw[...,0]
    return resize_data(raw.astype(np.float32)/maximum,size)


def close_edges(a):
    a = a.copy()
    a[0] = a[-1] = (a[0] + a[-1]) * .5
    a[:, 0] = a[:, -1] = (a[:, 0] + a[:, -1]) * .5
    return a


def periodic(a):
    """Periodic-plus-smooth decomposition removes the boundary lighting step.

    No mirrored texture quadrants or blurred seam strips; grain orientation stays
    intact. Endpoint equality is a final one-pixel guard, not the visual QA gate.
    """
    if a.ndim == 3:
        return np.stack([periodic(a[..., k]) for k in range(a.shape[-1])], -1)
    h, w = a.shape
    v = np.zeros_like(a)
    v[0] = a[-1] - a[0]
    v[-1] = -v[0]
    v[:, 0] += a[:, -1] - a[:, 0]
    v[:, -1] -= a[:, -1] - a[:, 0]
    yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing='ij')
    den = 2 * np.cos(2 * np.pi * xx / w) + 2 * np.cos(2 * np.pi * yy / h) - 4
    den[0, 0] = 1
    smooth_fft = np.fft.fft2(v) / den
    smooth_fft[0, 0] = 0
    return close_edges(a - np.fft.ifft2(smooth_fft).real)


def grain(c):
    # Only submillimetre texture; pigment/stain variation never becomes macro relief.
    lum = c[..., :3].mean(-1)
    return np.clip((lum - gaussian_filter(lum, 2.5, mode='wrap')) * .12, -.025, .025)


def normals(h, metres, amplitude):
    # OpenGL tangent normal: +X right, +Y texture up; image row increases downward.
    sy, sx = metres[1] / h.shape[0], metres[0] / h.shape[1]
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * amplitude / (2 * sx)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * amplitude / (2 * sy)
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n + 1) * .5


def png(a, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.uint8(np.rint(np.clip(a, 0, 1) * 255))).save(path, optimize=True)


def tile_preview(arrays, path, name):
    # All four maps, each genuinely repeated 3x3. Full-size maps remain lossless PNG.
    sheet = Image.new('RGB', (1540, 820), '#626262')
    draw = ImageDraw.Draw(sheet)
    labels = ['colour (sRGB)', 'height (linear)', 'normal GL (linear)', 'roughness R (linear)']
    for k, (a, label) in enumerate(zip(arrays, labels)):
        if a.ndim == 2:
            a = np.repeat(a[..., None], 3, -1)
        x = 15 + (k % 2) * 770
        y = 26 + (k // 2) * 410
        # Use a second, aspect-preserving 3x3 presentation at a 365px panel height.
        thumb = Image.fromarray(np.uint8(np.rint(np.clip(a, 0, 1) * 255)))
        thumb.thumbnail((244, 119), Image.Resampling.LANCZOS)
        panel = Image.new('RGB', (750, 365), '#626262')
        for yy in range(3):
            for xx in range(3):
                panel.paste(thumb, (xx * thumb.width, yy * thumb.height), thumb if thumb.mode == 'RGBA' else None)
        sheet.paste(panel, (x, y))
        draw.text((x, y - 17), name + ' / ' + label, fill='white')
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, quality=94)


def emit(row, name, c, h, r, metres, materials, sources, amplitude=.01, kind='tile', notes='', normal=None):
    c = c.copy()
    if c.shape[-1] == 3:
        c = np.dstack([c, np.ones(c.shape[:2])])
    if kind == 'tile':
        c[..., :3] = np.clip(periodic(c[..., :3]), 0, 1)
        h = close_edges(h)
        r = close_edges(r)
    n = normals(h, metres, amplitude) if normal is None else normal
    v = n * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)
    n = (v + 1) * .5
    if kind == 'tile':
        n = close_edges(n)
        v = n * 2 - 1
        v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)
        n = (v + 1) * .5
    if kind == 'cutout':
        # Flat cards get no false relief rim against transparent air.
        h = np.where(c[..., 3] > .05, h, .5)
        n[c[..., 3] < .05] = [.5, .5, 1]
        r = np.where(c[..., 3] > .05, r, 1)
        # Bleed pigment into transparent pixels, retaining alpha, for clean mips.
        visible = c[..., 3] > .02
        if visible.any() and not visible.all():
            indices = distance_transform_edt(~visible, return_distances=False, return_indices=True)
            c[..., :3] = c[tuple(indices)][..., :3]
    arrays = [c, h, n, r]
    folder = DEST / str(row)
    suffixes = ['colour', 'height', 'normal', 'roughness']
    files = {}
    for suffix, a in zip(suffixes, arrays):
        p = folder / f'{name}_{suffix}.png'
        # Opaque colour saves as RGB; alpha preserved for genuine cutouts/atlases.
        if suffix == 'colour' and np.all(a[..., 3] >= 1):
            a = a[..., :3]
        png(a, p)
        files[suffix] = dict(path=relative(p), sha256=sha(p), channels='RGB' if suffix == 'normal' else ('RGBA' if suffix == 'colour' and a.shape[-1] == 4 else 'RGB' if suffix == 'colour' else 'R'))
    proof = PROOF / 'tiles' / str(row) / f'{name}_3x3.jpg'
    tile_preview(arrays, proof, name)
    entry = dict(row=row, name=name, size=[c.shape[1], c.shape[0]], metres_per_tile=metres, relief_range_metres=amplitude, kind=kind,
                 materials=materials, sources=sources, maps=files, preview=f'tiles/{row}/{name}_3x3.jpg', notes=notes)
    ENTRIES.append(entry)
    SURFACES[name] = arrays
    return entry


def photo(row, name, path, size, metres, materials, height=None, rough=.8, amplitude=.004, notes=''):
    c = load(path, size)
    h = np.full(c.shape[:2], .5, np.float32) + grain(c) if height is None else resize_data(height, size)
    r = np.clip(rough + grain(c) * .4, .05, .98)
    return emit(row, name, c, h, r, metres, materials, [relative(path)], amplitude, notes=notes)


def masonry(name, source, base_rgb, rows=4, columns=4):
    c = load(source, (1024, 1024))
    rgb = c[..., :3]
    rgb *= np.asarray(base_rgb) / np.maximum(rgb.mean((0, 1)), .01)
    yy, xx = np.meshgrid(np.arange(1024), np.arange(1024), indexing='ij')
    fy = (yy / 1024 * rows) % 1
    fx = (xx / 1024 * columns + (yy // (1024 / rows) % 2) * .5) % 1
    edge = np.minimum(np.minimum(fx, 1 - fx) / columns, np.minimum(fy, 1 - fy) / rows) * 2
    face = np.clip((edge - .003) / .005, 0, 1)
    c[..., :3] = rgb * face[..., None] + np.array([.36, .345, .31]) * (1 - face[..., None])
    h = .25 + .50 * face + grain(c)
    r = .77 * face + .93 * (1 - face)
    return c, h, r


def english_brick():
    """Lay photographic brick faces, not the nonperiodic generated mortar border.

    24 courses, alternating 8 stretchers/16 headers, 6 mm lime joints. Joint
    coverage drives every structural map, so dark fired clay cannot become a dent.
    """
    source=load(ENV/'wall-brick-v2.png')
    H,W=878,1024;rows=24
    c=np.ones((H,W,4),np.float32);c[...,:3]=[.43,.415,.37]
    h=np.full((H,W),.2,np.float32);rough=np.full((H,W),.94,np.float32)
    sh,sw=source.shape[:2]
    for row in range(rows):
        count=8 if row%2==0 else 16
        bw=W/count;rh=H/rows;shift=0 if row%2==0 else .5
        ya=round(row*rh);yb=round((row+1)*rh)
        for k in range(-1,count):
            xa=round((k+shift)*bw);xb=round((k+1+shift)*bw)
            left=max(0,xa);right=min(W,xb)
            if left>=right:continue
            # A different face per brick, cropped well inside the original joint.
            sy=(row+.5)*sh/rows;sx=((k%count)+.5)*sw/count
            ch=max(4,round(sh/rows*.45));cw=max(8,round(sw/count*.55))
            crop=source[max(0,round(sy-ch/2)):min(sh,round(sy+ch/2)),max(0,round(sx-cw/2)):min(sw,round(sx+cw/2))].copy()
            sat=(crop[...,:3].max(-1)-crop[...,:3].min(-1))/np.maximum(crop[...,:3].max(-1),.01)
            good=sat>.25
            colour=np.median(crop[...,:3][good],axis=0) if good.any() else np.array([.38,.19,.12])
            crop[...,:3]=np.where(good[...,None],crop[...,:3],colour)
            face=resize_data(crop,(xb-xa,yb-ya))[:,left-xa:right-xa]
            yy,xx=np.meshgrid(np.arange(ya,yb),np.arange(left,right),indexing='ij')
            dist=np.minimum(np.minimum(xx-xa,xb-1-xx)*1.84/W,np.minimum(yy-ya,yb-1-yy)*1.56/H)
            f=np.clip((dist-.003)/.0025,0,1)
            c[ya:yb,left:right,:3]=face[...,:3]*f[...,None]+np.array([.43,.415,.37])*(1-f[...,None])
            h[ya:yb,left:right]=.2+.55*f+grain(face)*f
            rough[ya:yb,left:right]=.85*f+.94*(1-f)
    return c,h,rough


def make_surfaces():
    brick = ENV / 'wall-brick-v2.png'
    c,h,r=english_brick()
    emit(3,'brick_english',c,h,r,[1.84,1.56],['wall::wall_brick'],[relative(brick)],.012,
         notes='Photographic faces reassembled in 24-course English bond, 8 stretchers/16 headers, 6 mm lime joints. Colour/height share the same layout. Check quoin junctions in town.')
    for row, name, source, rgb, mats, scale in [
        (3, 'bluestone_ashlar', ENV/'stone.png', [.30,.32,.335], ['wall::wall_quoin','wall::wall_plinth','wall::wall_stone'], [2,2]),
        (8, 'sandstone_ashlar', GENERATED/'sandstone.png', [.65,.62,.55], ['churches::church_stone','churches::carolus_sand','churches::pj_white','churches::pj_brabant'], [2,2]),
        (8, 'prison_bluestone', ENV/'stone.png', [.30,.32,.335], ['prison::pr_blue'], [2,2]),
    ]:
        c, hh, rr = masonry(name, source, rgb)
        emit(row, name, c, hh, rr, scale, mats, [relative(source)], .012,
             notes='50 cm courses, alternating half-block joints, 6 mm mortar. Arrises are relief only; exposed silhouette bevels require geometry at integration.')
    c = load(ENV/'stone.png', (1024,256))
    x = np.arange(1024)/1024*3
    dist = np.minimum(x%(.75), .75-x%(.75))
    fac = np.clip((dist-.002)/.006,0,1)
    hh = np.repeat((.25+.5*fac)[None,:],256,0)+grain(c)
    c[...,:3] *= fac[None,:,None]*.85+.15
    emit(3,'coping_bluestone',c,hh,np.full((256,1024),.78),[3,.75],['wall::wall_coping'],[relative(ENV/'stone.png')],.012,
         notes='Four 0.75 m caps across. Top edge and lower lip must be modelled; no painted bevel highlight. A 3 m by 0.75 m front-face strip, not a ground stain.')
    c = load(ENV/'slate-v3.png',(1024,1024))
    yy,xx=np.meshgrid(np.arange(1024),np.arange(1024),indexing='ij')
    fy=yy/1024*8%1;fx=(xx/1024*6+(yy//128%2)*.5)%1
    hh=.28+.40*fy-.12*np.exp(-np.minimum(fx,1-fx)*100)+grain(c)
    emit(3,'slate_ardennes',c,hh,np.full((1024,1024),.79)+grain(c),[2,2],['wall::wall_slate'],[relative(ENV/'slate-v3.png')],.006,
         notes='Six slates across, eight 25 cm exposures; image top is ridgeward. 4-6 mm split slate; near-visible roof laps need actual geometry.')
    c,h,n,r=SURFACES['slate_ardennes']
    emit(8,'slate_ardennes',c,h,r,[2,2],['churches::church_slate','prison::pr_slate'],[relative(ENV/'slate-v3.png')],.006)
    c,h,n,r=SURFACES['brick_english']
    emit(8,'brick_brabant',c,h,r,[1.84,1.56],['churches::church_brick','churches::pj_brick','prison::pr_brick'],[relative(brick)],.012,
         notes='Same local brick sizes as row 3; remap UV scale rather than stretch 128x96 legacy cells.')
    c=load(GENERATED/'lead.png',(1024,1024));xx=np.arange(1024)/1024
    d=np.minimum(xx%.5,.5-xx%.5);hh=np.repeat((.45+.3*np.exp(-(d/.009)**2))[None,:],1024,0)+grain(c)
    emit(8,'lead_roof',c,hh,np.full((1024,1024),.68)+grain(c),[1,1],['churches::church_lead','prison::pr_lead'],[relative(GENERATED/'lead.png')],.009,
         notes='Rolled seams each 0.5 m. Metallic 1 for exposed lead; no orange iron rust. Build exposed sheet edges and prominent rolls in geometry.')
    photo(8,'sandstone_plain',GENERATED/'sandstone.png',(1024,1024),[1,1],['churches::carolus_pale','row 13 carved pale-stone cells'],
          rough=.83,amplitude=.002,notes='Continuous mineral surface for carved stone and plaster; never paint masonry joints across a statue or moulding.')
    photo(10,'bronze_cast',GENERATED/'bronze.png',(512,512),[.5,.5],['places::pl_bronze'],rough=.73,amplitude=.0015,
          notes='Fine casting texture only. Brown metal/green oxidation must share the mounting base; hand-contact polishing belongs to localized wear, not every tile.')
    c,h,n,r=SURFACES['bronze_cast'];verd=np.clip((c[...,1]-c[...,0]+.06)*5,0,1)
    # Patina changes roughness, never height.
    emit(10,'bronze_cast',c,h,np.clip(.58+.25*verd,.55,.9),[.5,.5],['places::pl_bronze'],[relative(GENERATED/'bronze.png')],.0015,
         notes='Patina changes roughness only. Use metalness mask for oxide when wiring; no raised ground plate.')
    # Replace the first bronze entry, whose intermediate files were intentionally superseded.
    ENTRIES.pop(-2)
    photo(10,'stone_petit_granit',ENV/'stone.png',(1024,1024),[1,1],['places::pl_stone'],rough=.78,amplitude=.002)
    photo(10,'wood_oak',REUSED/'prop_wood_dark_c.png',(512,512),[1,1],['places::pl_wood'],
          load(REUSED/'prop_wood_dark_h.png',(512,512))[...,0],.82,.006,notes='Five boards; grain runs horizontally. Rotate every map together for vertical members.')
    photo(10,'iron_painted',REUSED/'wrought_iron_c.png',(512,512),[.5,.5],['places::pl_iron','churches::park_iron','prison::pr_iron'],
          load(REUSED/'wrought_iron_h.png',(512,512))[...,0],.79,.002)
    # Zinc is dense dull grey, with fine rolled texture; no geometric seam on a small fitting.
    c=load(GENERATED/'lead.png',(512,512),crop=(80,0,470,1254));lum=c[...,:3].mean(-1)
    c[...,:3]=np.stack([lum*.90,lum*.94,lum],-1)
    emit(10,'zinc_sheet',c,.5+grain(c),np.full((512,512),.64)+grain(c),[.5,.5],['places::pl_zinc'],[relative(GENERATED/'lead.png')],.0005,
         notes='Period dull zinc sheet, no modern galvanized spangle. Lead seam excluded from this cut.')
    # A contiguous soil crop avoids the circular prop-mud silhouette.
    photo(10,'earth_bare',REUSED/'prop_market_mud_c.png',(512,512),[1,1],['places::pl_earth'],
          rough=.96,amplitude=.006,notes='A fresh contiguous central crop is used below; no circular black boundary.')
    c=load(REUSED/'prop_market_mud_c.png',(512,512),crop=(140,140,230,230))
    emit(10,'earth_bare',c,.5+grain(c),np.full((512,512),.96),[1,1],['places::pl_earth'],[relative(REUSED/'prop_market_mud_c.png')],.006,
         notes='Central continuous soil crop; no baked circular decal silhouette.')
    ENTRIES.pop(-2)
    c=np.ones((512,512,4),np.float32);c[...,:3]=[.095,.125,.11]
    emit(10,'water_base',c,np.full((512,512),.5),np.full((512,512),.12),[1,1],['places::pl_water'],['Original constant physical base colour'],0,
         notes='Neutral absorption base only; existing native water animation/reflection must supply waves and light. Height deliberately flat; never bake ripples into water colour.')
    for name,metres in [('wood_dark',[1,1]),('barrel',[1,1]),('leather',[.5,.5]),('sackcloth',[.5,.5]),('awning_blue',[1,1]),('awning_red',[1,1]),('tarpaulin',[1,1]),('canvas_patched',[1,1])]:
        mats=[f'stalls::{name}']+([f'props::{name}'] if name in {'wood_dark','barrel','leather','sackcloth'} else [])
        photo(6,name,REUSED/f'prop_{name}_c.png',(512,512),metres,mats,
              load(REUSED/f'prop_{name}_h.png',(512,512))[...,0],.84 if 'leather' not in name else .7,.004,
              notes='Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.')
    c=load(REUSED/'prop_wood_dark_c.png',(512,128),crop=(0,8,512,86))
    h=load(REUSED/'prop_wood_dark_h.png',(512,128),crop=(0,8,512,86))[...,0]
    emit(6,'wood_single',c,h,np.full((128,512),.82),[1,.17],['props::wood','stalls::wood','row 13 solid-timber cells'],
         [relative(REUSED/'prop_wood_dark_c.png'),relative(REUSED/'prop_wood_dark_h.png')],.003,
         notes='Single continuous board cut between the inherited plank joints. Use on beams, spokes and solid painted panels so plank gaps are not painted across solid timber. Grain runs horizontally.')
    c,h,n,r=SURFACES['iron_painted']
    emit(2,'wrought_iron',c,h,r,[.5,.5],['props::iron','stalls::iron','wall::wall_iron'],[relative(REUSED/'wrought_iron_c.png'),relative(REUSED/'wrought_iron_h.png')],.002,
         notes='Photographic original from 042db687, matching height retained. Surface rust has no ground collision.')


def make_bark_and_cards():
    oakdir=PROOF/'oak';oakdir.mkdir(exist_ok=True)
    z=zipfile.ZipFile(ROOT/'art-source/third_party/ambientcg-bark012/Bark012_1K-PNG.zip')
    for name in ['Color','Displacement','Roughness']:
        f=f'Bark012_1K-PNG_{name}.png';(oakdir/f).write_bytes(z.read(f))
    oak=load(oakdir/'Bark012_1K-PNG_Color.png',(512,1024))
    oak[...,:3]*=np.array([.31,.28,.235])/np.maximum(oak[...,:3].mean((0,1)),.01)
    oh=load_field(oakdir/'Bark012_1K-PNG_Displacement.png',(512,1024))
    rr=load_field(oakdir/'Bark012_1K-PNG_Roughness.png',(512,1024))
    plane=load(GENERATED/'bark.png',(512,1024));ph=.5+grain(plane)
    emit(9,'bark_fissured',oak,oh,rr,[.5,1],['trees::tree_bark (left half)','park_plants::tree_bark (left half)'],
         ['art-source/third_party/ambientcg-bark012/Bark012_1K-PNG.zip'],.018,notes='CC0 oak fissures, also a generic fissured-bark donor for elm/lime/willow; species-specific form remains model geometry.')
    emit(9,'bark_plane',plane,ph,np.full(ph.shape,.88),[.5,1],['trees::tree_bark (right half)','park_plants::tree_bark (right half)'],
         [relative(GENERATED/'bark.png')],.006,notes='Exfoliating plane pigmentation stays flat; only fine flake grain enters relief.')
    a=SURFACES['bark_fissured'];b=SURFACES['bark_plane']
    # Preserve native two-half layout: each half covers 0.5 m across x 1 m along branch.
    c=np.concatenate([a[0],b[0]],axis=1)
    h=np.concatenate([a[1],.5+(b[1]-.5)*(.006/.018)],axis=1)
    r=np.concatenate([a[3],b[3]],axis=1)
    e=emit(9,'bark_atlas',c,h,r,[1,1],['trees::tree_bark','park_plants::tree_bark'],
           ['9/bark_fissured','9/bark_plane'],.018,kind='atlas',normal=np.concatenate([a[2],b[2]],axis=1),
           notes='Do not repeat across the half-atlas boundary. Use existing native half-cell UVs; each half tiles independently. Plane normal strength already baked at 6 mm, fissured at 18 mm.')
    e['cells']={'fissured':[0,0,512,1024],'plane':[512,0,512,1024]}
    # Native leaf indices: lime 0/1, plane 2, sparse plane 3, elm 4/5, willow 6, bare twigs 7.
    src=GENERATED/'leaves.png';w,h=Image.open(src).size;leaves=[]
    for i in range(8):
        leaves.append(load(src,(256,256),crop=(round(i%4*w/4),round(i//4*h/2),round(w/4),round(h/2))))
    park=GENERATED/'park.png';pw,ph=Image.open(park).size;cards=[]
    for i in range(20):
        cards.append(load(park,(256,256),crop=(round(i%4*pw/4),round(i//4*ph/5),round(pw/4),round(ph/5))))
    ordered=[leaves[0],leaves[4],leaves[2],leaves[6],leaves[1],leaves[5],cards[10],leaves[3]]
    for name,arrs,rows,mats,sources in [
        ('tree_leaves',ordered,2,['trees::tree_leaves'],[relative(src),relative(park)]),
        ('park_leaves',cards,5,['park_plants::tree_leaves'],[relative(park)])]:
        c=np.zeros((rows*256,1024,4),np.float32)
        for i,a in enumerate(arrs):
            # A four-pixel clear safety margin on each card prevents mip bleed.
            a[:4,:,3]=0;a[-4:,:,3]=0;a[:,:4,3]=0;a[:,-4:,3]=0
            c[i//4*256:(i//4+1)*256,i%4*256:(i%4+1)*256]=a
        hh=np.full(c.shape[:2],.5);rr=np.full(c.shape[:2],.84)
        e=emit(9,name,c,hh,rr,[2,rows*.5],mats,sources,.0002,kind='cutout',
               notes='Each 256 px cell is a 0.5 m square card. Preserve species indices and native cell UVs. Leaf veins remain pigment; no invented raised outline. Flat normal appropriate to thin two-sided leaves; real branch thickness is geometry.')
        e['cell_metres']=[.5,.5];e['grid']=[4,rows]


def scatter_material(sample, metres, patch_metres, count, seed, drift=False):
    """Compose scan cutouts at physical size, rather than enlarging one kernel/leaf.

    Coverage controls relief later. Alpha compositing adds no contact shadow.
    """
    rng=np.random.default_rng(seed);out=np.zeros((512,512,4),np.float32)
    for i in range(count):
        physical=patch_metres*rng.uniform(.78,1.18)
        w=max(4,min(490,round(512*physical/metres[0])))
        h=max(4,min(490,round(512*physical/metres[1])))
        a=resize_data(np.rot90(sample,int(rng.integers(4))),(w,h))
        fx=rng.uniform(.03,.97)
        fy=1-rng.random()**2.3 if drift else rng.uniform(.03,.97)
        x=6+round(fx*(500-w));y=6+round(fy*(500-h))
        a=a.copy();a[...,:3]*=rng.uniform(.85,1.03)
        dst=out[y:y+h,x:x+w];sa=a[...,3:4];da=dst[...,3:4]
        alpha=sa+da*(1-sa)
        dst[...,:3]=(a[...,:3]*sa+dst[...,:3]*da*(1-sa))/np.maximum(alpha,1e-6)
        dst[...,3:4]=alpha
    return out


def make_litter():
    src=GENERATED/'litter-v2.png';w,h=Image.open(src).size
    categories=['dung','muck','straw','coaldust','ash','slop','tar','oil','leaves','cabbage','grain','shells','soot','glass','fish','paper']
    samples={}
    for i,name in enumerate(categories):
        samples[name]=load(src,(512,512),crop=(round(i%4*w/4),round(i//4*h/4),round(w/4),round(h/4)))
    meta=json.loads(json.loads((ROOT/'native-godot/assets/game-models/litter.extras.json').read_text())['litter_meta']['meta'])
    for name,spec in meta['decals'].items():
        key=name.split('_')[0]
        if key=='dungflat':key='dung'
        if key in ['scales','guts']:key='fish'
        if key in ['leafmush','leafdrift','leafpatch','leafscatter']:key='leaves'
        if key=='urine':key='slop'
        if key in samples:
            c=samples[key].copy()
            if name.endswith('_1'):
                c=np.rot90(c,2).copy()
            if name.endswith('_2'):
                c=np.rot90(c).copy()
            if name.startswith('urine'):
                # A transparent dark amber damp film, not a painted yellow puddle.
                c[...,:3]=[.20,.16,.07];c[...,3]*=.32
            if name.startswith('leafmush'):
                c[...,:3]*=[.52,.48,.40]
            if name.startswith('leafscatter'):
                c[...,3]*=.72
        elif name=='drain':
            c=load(REUSED/'wrought_iron_c.png',(512,512));yy,xx=np.indices((512,512))
            gap=(xx%64>25)&(yy>38)&(yy<474)
            c[...,3]=(~gap).astype(float)
            c[:20,:,3]=0;c[-20:,:,3]=0;c[:,:20,3]=0;c[:,-20:,3]=0
        else:  # Gutter: no opaque rectangular plate; the channel is town geometry.
            c=np.zeros((512,512,4));yy,xx=np.indices((512,512));edge=np.sin(np.pi*xx/511)**2
            c[...,:3]=[.055,.066,.047];c[...,3]=edge*.30
            c[:12,:,3]=0;c[-12:,:,3]=0
        metres=[spec['w'],spec['d']]
        if name.startswith('leaf'):
            count={'leafmush_0':18,'leafdrift_0':140,'leafdrift_1':107,'leafpatch_0':85,'leafpatch_1':55,'leafscatter_0':20,'leafscatter_1':14}[name]
            c=scatter_material(samples['leaves'],metres,.29,count,601+list(meta['decals']).index(name),drift=name.startswith('leafdrift'))
            if name.startswith('leafmush'):c[...,:3]*=[.52,.48,.40]
        elif key in {'grain','shells','ash','coaldust'}:
            patch,count={'grain':(.10,32),'shells':(.22,12),'ash':(.13,36),'coaldust':(.15,120 if spec['w']>2 else 42)}[key]
            c=scatter_material(samples[key],metres,patch,count,720+list(meta['decals']).index(name))
        elif name=='scales_0':
            # The combined source also has guts; this lower-left cut is scales.
            c=scatter_material(samples['fish'][260:490,8:195],metres,.09,28,743)
        c[:6,:,3]=0;c[-6:,:,3]=0;c[:,:6,3]=0;c[:,-6:,3]=0
        film=key in {'oil','tar','soot','slop'} or name.startswith('urine') or name=='gutter'
        if key in {'oil','tar','soot','slop'} and not name.startswith('urine'):
            # Discard photographed wet glints. A ground film carries absorption
            # and coverage; native light/roughness supplies every reflection.
            base={'oil':[.065,.052,.035],'tar':[.035,.032,.026],'soot':[.045,.041,.036],'slop':[.11,.078,.044]}[key]
            c[...,:3]=np.asarray(base)+grain(c)[...,None]*.12
        if key=='glass':
            # Keep shard silhouettes/etching, remove photographed sky glints.
            pigment=np.clip(c[...,:3].mean(-1),.04,.20)
            c[...,:3]=np.stack([pigment*.55,pigment,pigment*.60],-1)
        hh=np.full((512,512),.5)
        amp=0 if film else .012 if key in {'dung','muck'} else .003
        if amp:
            # Shape relief follows object coverage, independent of pigment darkness.
            mask=c[...,3]>.4
            d=distance_transform_edt(mask)
            hh+=np.clip(d/18,0,1)*.15
            hh+=grain(c)*mask
        rough=.24 if key=='glass' else .32 if key in {'oil','slop','fish'} else .48 if key=='tar' else .87
        rr=np.full((512,512),rough)
        e=emit(7,name,c,hh,rr,[spec['w'],spec['d']],['litter::lt_decal'],[relative(src)] if key in samples else ['Original analytic mask',relative(REUSED/'wrought_iron_c.png')],amp,kind='cutout',
               notes='Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.')
        e['native_cell']=spec['cell'];e['native_atlas_size']=meta['decalSize']
        e['category']=key
    (DEST/'7/native-cells.json').write_text(json.dumps(meta,indent=2)+'\n',newline='\n')


def atlas_class(name):
    """Only material cells; lettering, ornament and goods silhouettes stay authored."""
    if name in {'iron','iron_light','iron_rust','iron_green','iron_black','bright','rust','hoop','strap','red'}:return 'iron_painted'
    if name in {'wood','wood_dark','wood_grey','wood_light','oak','new_wood','desk','varnish','wheel','paint','paint_dark','sole'}:return 'wood_single'
    if name=='stripes_0':return 'awning_red'
    if name in {'stripes_1','stripes_2'}:return 'awning_blue'
    if name in {'wood','wood_dark','wood_grey','wood_light','oak','new_wood','desk','plank','planks','planks_v','planks_old','planks_green','planks_tar','planks_grey','tarred','crate','hull_side','hull_in','hull_tar','hull_bottom','shed_planks','hut_planks','fender_oak','varnish','bare','sole','wheel','ceiling','paint','paint_dark','red','roof_planks'}:return 'wood_dark'
    if name in {'leather','shoes'}:return 'leather'
    if name in {'jute','sack','sack_dark'}:return 'sackcloth'
    if name in {'linen_white','linen_cream','cloth_blue','cloth_red','cloth_grey','cloth_brown','cloth_green','canvas','canvas_seams','ticking','velvet','roof','stripes_0','stripes_1','stripes_2'}:return 'tarpaulin'
    if name in {'bluestone','stone','slate'}:return 'stone_petit_granit' if name!='slate' else 'slate_ardennes'
    if name in {'whitestone','plaster','mortar'}:return 'sandstone_plain'
    if name in {'brick','brick_dark'}:return 'brick_english'
    if name in {'zinc','pewter'}:return 'zinc_sheet'
    return None


def make_atlases():
    layouts=json.loads((HERE/'recovered-cells.json').read_text())
    for owner,mat in [('omnibus','omnibus'),('wagons','wagons')]:
        import ast
        tree=ast.parse((ROOT/f'art-source/tools/blender/build_{owner}.py').read_text(encoding='utf-8'))
        cells=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CELLS' for t in n.targets))
        # Painter arrays are Blender bottom-up; the PNG/native Image is top-down.
        layouts[owner]={'size':[256,256],'cells':{n:[(i%4)*64,(i//4)*64,64,64] for i,n in enumerate(cells)}}
    mats={'clutter':'cl_solid','lively':'lv_solid','trades':'tr_solid','quayfurniture':'qf_solid','streetlife':'sl_solid','omnibus':'omnibus','wagons':'wagons'}
    # Retain the exact native pictures as source references. These are decoded data,
    # not a scene export; extract_native.py is a read-only Godot binary reader.
    native=json.loads((HERE/'native-images.json').read_text())
    for owner,layout in layouts.items():
        rec=next(x for x in native if x['owner']==owner and (x['name']==mats[owner]+'_tex' or x['name']=='version'))
        original=HERE/'native-originals'/f'{owner}.png'
        nw,nh=layout['size'];assert list(Image.open(original).size)==[nw,nh]
        factor=min(8,2048//max(nw,nh));W,H=nw*factor,nh*factor
        c=load(original,(W,H));hh=np.full((H,W),.5);rr=np.full((H,W),.82);nn=np.zeros((H,W,3));nn[:]=[.5,.5,1]
        changed=[];preserved=[];cell_previews=[]
        for name,box in layout['cells'].items():
            source=atlas_class(name)
            if not source:
                preserved.append(name);continue
            x,y,w,h=box;x*=factor;y*=factor;w*=factor;h*=factor
            a,sh,sn,sr=SURFACES[source]
            definition=next(e for e in ENTRIES if e['name']==source)
            scale=definition['metres_per_tile']
            if name in {'planks_v','shed_planks','hut_planks','fender_oak'}:
                a=np.rot90(a);sh=np.rot90(sh);sr=np.rot90(sr);scale=scale[::-1]
            # Repaint only this cell; normalized atlas coordinates never move.
            ac=resize_data(a,(w,h));ah=resize_data(sh,(w,h));ar=resize_data(sr,(w,h))
            # Every cell shares one atlas displacement range, while its encoded
            # height/normal retain the donor's physical depth and declared scale.
            ah=.5+(ah-.5)*(definition['relief_range_metres']/.018)
            an=normals(ah,scale,.018)
            # Match authored paint colours without pushing stains into height.
            target=np.maximum(c[y:y+h,x:x+w,:3].mean((0,1)),.015)
            mean=np.maximum(ac[...,:3].mean((0,1)),.015)
            if source not in {'brick_english','sandstone_ashlar','slate_ardennes'}:
                ac[...,:3]*=np.clip(target/mean,.25,3.0)
            c[y:y+h,x:x+w]=ac;hh[y:y+h,x:x+w]=ah;rr[y:y+h,x:x+w]=ar;nn[y:y+h,x:x+w]=an
            changed.append(dict(name=name,native_cell=box,output_cell=[x,y,w,h],source_set=source,metres_per_tile=scale,relief_range_metres=.018))
            p=PROOF/'cells/13'/owner/(name+'_3x3.jpg');tile_preview([ac,ah,an,ar],p,owner+'/'+name)
            cell_previews.append(p.relative_to(PROOF).as_posix())
        e=emit(13,owner,c,hh,rr,[W/256,H/256],[owner+'::'+mats[owner]],[relative(original),'art-source/plan-84/recovered-cells.json'],
               .018,kind='atlas',normal=nn,notes='Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.')
        e['cells']=changed;e['preserved_cells']=preserved;e['cell_previews']=cell_previews
        # Atlas has no single real-world scale: the per-cell scales are authoritative.
        e['metres_per_tile']=None
        (DEST/'13'/f'{owner}_cells.json').write_text(json.dumps(dict(native_size=[nw,nh],output_size=[W,H],cells=changed,preserved_cells=preserved),indent=2)+'\n',newline='\n')


def write_readmes():
    for row in sorted({e['row'] for e in ENTRIES}):
        lines=[f'# Issue 84, row {row}: picture handoff','',
               'Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.',
               'Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.','',
               '`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).',
               '`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.',
               'Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.',
               'Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.','',
               '| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |',
               '|---|---|---|---|---|']
        for e in ENTRIES:
            if e['row']!=row:continue
            scale='per-cell manifest' if e['metres_per_tile'] is None else ' x '.join(map(str,e.get('cell_metres',e['metres_per_tile'])))
            lines.append(f"| `{e['name']}_*` | {' x '.join(map(str,e['size']))} | {scale} | {', '.join('`'+x+'`' for x in e['materials'])} | `{e['preview']}` |")
        lines+=['','Sources and integration notes:']
        for e in ENTRIES:
            if e['row']==row:
                lines.append(f"- `{e['name']}`: {'; '.join(e['sources'])}. Licence: {e.get('licence','Original project artwork')}. {e['notes']}")
                if e.get('town_materials'):
                    lines.append('  Native town: '+', '.join(f"`{t['name']}` (`{t['path']}`)" for t in e['town_materials'])+'.')
        if row==7:
            lines+=['','Separate high-resolution marks are deliberate: the original 1024 px atlas gives many marks only 16–32 pixels.',
                    '`native-cells.json` records every native name, cell and physical size. The installer must bind the separate maps or repack/update the metadata atomically; do not replace the old atlas with one mark.',
                    'The geometric `lt_solid` models remain unchanged; torn rags, food and other solid litter need their own contextual review.']
        if row==13:
            lines+=['','`*_cells.json` records every changed rectangle and its metre scale. Normalized UV rectangles remain at their original positions.',
                    'Each changed cell also has a four-map 3x3 test under `cells/13/<atlas>/<cell>_3x3.jpg`.',
                    'Retained cells are explicitly listed. Food/animal/lettering/decal content was not repainted; row 13 remains partial until those pictures are reviewed and the native installation is accepted.',
                    'Do not treat atlas outside borders as a seamless material; repeat each cell independently using the existing atlas sampler.']
        lines+=['','Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.',
                'Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.','']
        (DEST/str(row)/'README.md').write_text('\n'.join(lines),encoding='utf-8',newline='\n')
    (DEST/'README.md').write_text('# Plan 84 picture bundle\n\nRows 3, 7, 8, 9, 10, 13; reusable rows 2 and 6. See each row README and manifest.json.\n\nAll maps are standalone PNGs; no runtime resources were edited. Native integration and geometric/contextual acceptance remain outstanding. Row 13 retains enumerated non-surface cells.\n\n1024 px material photographs and 512 px props match the established native photographic texture families, rather than preserving the retired 16–128 px procedural cells. Brick aspect ratio follows its authored 224:192 bond. Maps within a set have identical resolution. Native card/atlas normalized cell locations are preserved except litter, which is supplied as separate high-resolution named marks with its original cell metadata.\n\nRebuild: python art-source/plan-84/build_maps.py --proof <external-folder>. Requires the installed PhotoCraft CLI and existing Python Pillow/NumPy/SciPy. No game, browser bake, editor import, scene conversion or Godot process is involved.\n\nQA receipts: D:/Code/_tmp_verify/K-textures/validation.json and tiles/ under the same folder.\n',encoding='utf-8',newline='\n')


def validate():
    checks=[];failures=[]
    for e in ENTRIES:
        arrays=[]
        for kind,info in e['maps'].items():
            p=ROOT/info['path'];im=Image.open(p);a=np.asarray(im);arrays.append(a)
            ok=list(im.size)==e['size'] and sha(p)==info['sha256']
            checks.append(dict(set=e['name'],row=e['row'],check=kind+' dimensions/hash',ok=ok))
            if not ok:failures.append(e['name']+'/'+kind)
            if e['kind']=='tile':
                dx=float(np.abs(a[:,0].astype(float)-a[:,-1]).max());dy=float(np.abs(a[0].astype(float)-a[-1]).max())
                checks.append(dict(set=e['name'],row=e['row'],check=kind+' opposite-edge delta',delta_8bit=max(dx,dy),ok=max(dx,dy)<=1))
                if max(dx,dy)>1:failures.append(e['name']+'/'+kind+'/edge')
        n=np.asarray(Image.open(ROOT/e['maps']['normal']['path']),dtype=float)/255*2-1
        err=float(np.abs(np.linalg.norm(n,axis=-1)-1).max())
        checks.append(dict(set=e['name'],row=e['row'],check='normal unit length',max_error=err,ok=err<.015))
        if err>=.015:failures.append(e['name']+'/normal length')
        if e['name'] in {'bark_fissured','brick_english','sandstone_ashlar'}:
            height=np.asarray(Image.open(ROOT/e['maps']['height']['path']))
            span=int(height.max())-int(height.min())
            clipped=float(np.mean((height==0)|(height==255)))
            ok=span>8 and clipped<.1
            checks.append(dict(set=e['name'],row=e['row'],check='structural height retains dynamic range',range_8bit=span,clipped_fraction=clipped,ok=ok))
            if not ok:failures.append(e['name']+'/height data clipped')
        if e['kind']=='cutout':
            a=np.asarray(Image.open(ROOT/e['maps']['colour']['path']))[...,3]
            edge=int(max(a[0].max(),a[-1].max(),a[:,0].max(),a[:,-1].max()))
            checks.append(dict(set=e['name'],row=e['row'],check='transparent outer border',max_alpha=edge,ok=edge==0))
            if edge:failures.append(e['name']+'/alpha border')
    result=dict(sets=len(ENTRIES),maps=len(ENTRIES)*4,checks=len(checks),passed=sum(c['ok'] for c in checks),failed=len(failures),failures=failures,
                limitations=['Numerical image checks are not contextual native acceptance.','No game or Godot editor run was permitted.','Row 13 retained cells remain individually enumerated.'],results=checks)
    (PROOF/'validation.json').write_text(json.dumps(result,indent=2)+'\n',newline='\n')
    print(json.dumps({k:v for k,v in result.items() if k!='results'}))
    if failures:raise RuntimeError('Image validation failed')


def source_record():
    return {relative(p):dict(sha256=sha(p),licence='Project original generated artwork',date='2026-10-18')
            for p in GENERATED.glob('*.png')}


def attach_town_targets():
    targets=json.loads((HERE/'town-material-targets.json').read_text())
    for e in ENTRIES:
        e['licence']='Original project artwork (generated/derived; project LICENSE)'
        if e['name']=='bark_fissured':e['licence']='CC0-1.0, ambientCG Bark012; original adaptation'
        if e['name']=='bark_atlas':e['licence']='CC0-1.0 fissured-bark donor plus original generated plane bark'
        names=set()
        for logical in e['materials']:
            logical=logical.split(' (')[0]
            names.add(targets['aliases'].get(logical,logical.split('::')[-1]))
        e['town_materials']=[t for t in targets['targets'] if t['name'] in names]


def main():
    global PROOF
    parser=argparse.ArgumentParser();parser.add_argument('--proof',type=Path,required=True);args=parser.parse_args()
    PROOF=args.proof.resolve();PROOF.mkdir(parents=True,exist_ok=True)
    make_surfaces();make_bark_and_cards();make_litter();make_atlases();attach_town_targets()
    manifest=dict(version=1,issue=84,scope='Picture-only handoff; native installation and contextual geometry acceptance outstanding',
                  colour_space='sRGB colour; linear R height/roughness; linear RGB OpenGL normal, +Y; no ORM packing',
                  sources=source_record(),sets=ENTRIES)
    (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n')
    write_readmes();validate()
    print(f'Wrote {len(ENTRIES)} map sets; no native scene or material written.')


if __name__ == '__main__':
    main()

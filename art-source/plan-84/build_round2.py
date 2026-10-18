"""Picture-only round 2 for #84. No Godot process or resource writes.

Uses installed PhotoCraft for photographic resampling, existing NumPy/SciPy for
linear map arithmetic, and Pillow for lossless output and offline QA pictures.
The downloaded assets are data: only explicitly named image files are decoded.
Run after the immutable source intake, with --proof <external directory>.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_erosion, label
import build_maps as b

ROOT=b.ROOT
DEST=b.DEST
HERE=Path(__file__).resolve().parent
THIRD=ROOT/'art-source/third_party/plan84-round2'
KEYS=['colour','height','normal','roughness']
ITEMS=['Bricks085','Rock041','Metal063','roof_slates_03','white_sandstone_blocks_02',
       'japanese_sycamore','jolcham_oak_bark_01','dark_wooden_planks','wooden_barrel',
       'brown_leather','hessian_230','rough_linen','brown_mud','dry_decay_leaves']
P=None
OLD=None
ENTRIES=[]
SURF={}
SOURCES={}

def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')

def intake(downloads):
    """Keep original bytes, own-page licence evidence and exact per-file receipts."""
    for key in ITEMS:
        src=downloads/key;dst=THIRD/key;dst.mkdir(parents=True,exist_ok=True)
        assert 'CC0' in (src/'item-page.html').read_text(encoding='utf-8')
        if key[0].isupper():
            files=list(src.glob('*_1K-PNG.zip'))
            for suffix in ['Color','Displacement','NormalGL','Roughness']:
                files.append(src/f'{key}_1K-PNG_{suffix}.png')
            authors={'Lennart Demes / ambientCG':'Asset'}
            url='https://ambientcg.com/view?id='+key
            technique='Surface photogrammetry' if key!='Metal063' else 'Height field photogrammetry'
            scale=None
        else:
            meta=json.loads((src/'SOURCES.json').read_text())
            files=[src/f['path'] for f in meta['files']]
            authors=meta['author'];url=meta['url'];scale=meta['dimensions_mm']
            technique='Photographed PBR surface'
            files += [src/'info.json',src/'files.json']
        files.append(src/'item-page.html')
        record=dict(item=key,url=url,licence='CC0-1.0',authors=authors,download_date='2026-10-18',
                    technique=technique,source_dimensions_mm=scale,files=[])
        for f in files:
            assert f.is_file(),f
            target=dst/f.name
            if target.exists():assert b.sha(target)==b.sha(f),target
            else:shutil.copy2(f,target)
            record['files'].append(dict(path=b.relative(target),sha256=b.sha(target),bytes=target.stat().st_size,
                                       download_url=('https://ambientcg.com/get?file='+f.name) if f.suffix=='.zip' else
                                       next((a['url'] for a in meta['files'] if a['path']==f.name),url) if not key[0].isupper() else url))
        if key=='Bricks085':record['source_dimensions_mm']=[2400,1200]
        write_json(dst/'SOURCES.json',record)
        SOURCES[key]=record
    write_json(HERE/'ROUND2-SOURCES.json',SOURCES)

def original(e):
    out=[]
    for k in KEYS:
        f=P/'round1'/str(e['row'])/Path(e['maps'][k]['path']).name
        f.parent.mkdir(parents=True,exist_ok=True)
        if not f.exists():
            # Read the committed round 1, including on repeat rebuilds.
            data=subprocess.run(['git','show','90be884c:'+e['maps'][k]['path']],cwd=ROOT,capture_output=True,check=True).stdout
            f.write_bytes(data)
        im=Image.open(f)
        out.append(np.asarray(im.convert('RGBA') if k=='colour' else im.convert('RGB') if k=='normal' else im.convert('L'),dtype=np.float32)/255)
    return out

def read_field(path,size,crop=None):
    a=np.asarray(Image.open(path))
    maxval=65535 if a.dtype==np.uint16 or (a.dtype==np.int32 and a.max()>255) else 255
    if a.ndim==3:a=a[...,0]
    a=a.astype(np.float32)/maxval
    if crop:
        x,y,w,h=crop;a=a[y:y+h,x:x+w]
    return b.resize_data(a,size)

def donor(key,size,crop=None):
    src=THIRD/key
    if key[0].isupper():
        names={k:src/f'{key}_1K-PNG_{v}.png' for k,v in [('c','Color'),('h','Displacement'),('r','Roughness')]}
    else:
        names={'c':next(p for p in src.glob('*.png') if 'diff' in p.name or 'albedo' in p.name),'h':next(src.glob('*disp*.png')),'r':next(src.glob('*rough*.png'))}
    c=b.load(names['c'],size,crop)
    h=read_field(names['h'],size,crop);r=read_field(names['r'],size,crop)
    # Source height fields remain geometry. Colour darkness never supplies depth.
    lo,hi=np.quantile(h,[.001,.999])
    h=np.clip((h-lo)/max(float(hi-lo),.001),0,1)
    return c,h,np.clip(r,.04,.99)

def tone(c,target,power=1):
    c=c.copy();m=np.maximum(c[...,:3].mean((0,1)),.001)
    c[...,:3]=np.clip((c[...,:3]/m)**power*np.asarray(target),0,1)
    return c

def material(row,name,donor_id,metres,amp,target=None,crop=None,notes=''):
    e=next(x for x in OLD['sets'] if x['row']==row and x['name']==name)
    c,h,r=donor(donor_id,e['size'],crop)
    if target is not None:c=tone(c,target)
    return emit(e,c,h,r,metres,amp,[donor_id],notes)

def emit(old,c,h,r,metres,amp,donors,notes='',normal=None,decision='replaced'):
    e=copy.deepcopy(old)
    c=np.clip(c,0,1)
    if e['kind']=='tile':
        # Full scan tiles already have authored periodic structures. Never mirror
        # quadrants or repeat a short row of bricks to manufacture a larger tile.
        c[...,:3]=b.close_edges(c[...,:3]);h=b.close_edges(h);r=b.close_edges(r)
    n=b.normals(h,metres,amp) if normal is None else normal
    if e['kind']=='tile':n=b.close_edges(n)
    if e['kind']=='cutout':
        alpha=c[...,3];visible=alpha>.01
        h=np.where(visible,h,.5);r=np.where(visible,r,1)
        n[~visible]=[.5,.5,1]
        if visible.any() and not visible.all():
            nearest=distance_transform_edt(~visible,return_distances=False,return_indices=True)
            c[...,:3]=c[tuple(nearest)][...,:3]
    arrays=[c,h,n,r]
    e.update(metres_per_tile=metres,relief_range_metres=amp,round2_decision=decision,
             notes=notes or old['notes'],sources=donors,
             licence='CC0-1.0 donors with original adaptation' if any(x in SOURCES for x in donors) else old.get('licence','Original project artwork'))
    for key,a in zip(KEYS,arrays):
        if key=='colour' and np.all(a[...,3]>=1):a=a[...,:3]
        path=ROOT/e['maps'][key]['path'];b.png(a,path)
        e['maps'][key].update(sha256=b.sha(path),channels='RGB' if a.ndim==3 and a.shape[-1]==3 else 'RGBA' if a.ndim==3 else 'R')
    e['comparison']=f"comparisons/{e['row']}/{e['name']}.jpg"
    e['preview']=f"tiles/{e['row']}/{e['name']}_3x3.jpg"
    ENTRIES.append(e);SURF[(e['row'],e['name'])]=arrays
    return e

def keep(row,name,reason):
    old=next(e for e in OLD['sets'] if e['row']==row and e['name']==name)
    c,h,n,r=original(old)
    return emit(old,c,h,r,old['metres_per_tile'] or [1,1],old['relief_range_metres'],old['sources'],reason,normal=n,decision='retained')

def make_surfaces():
    old=next(e for e in OLD['sets'] if e['name']=='brick_english')
    c,h,r=donor('Bricks085',tuple(old['size']))
    emit(old,c,h,r,[2.4,1.2],.018,['Bricks085'],'Complete photographic scan of true alternating English-bond stretcher/header courses, not a procedural reconstruction. Source coverage is 2.4x1.2 m. Original face chips, lime mortar and measured relief remain co-registered. Native pixel dimensions retained; installer must use the new physical scale.')
    old=next(e for e in OLD['sets'] if e['name']=='brick_brabant');c=c.copy()
    brick=(c[...,0]>c[...,1]*1.10);c[brick,:3]*=[.95,.91,.87]
    emit(old,c,h,r,[2.4,1.2],.018,['Bricks085'],'Photographed red/brown brick, true alternating English bond and co-registered scanned chips/mortar. Lime joint pigment is preserved separately from the restrained warm brick tint. Entire 2.4x1.2 m source scan retained; no short multi-course block repeated.')
    material(8,'sandstone_ashlar','white_sandstone_blocks_02',[2,2],.025,notes='Scanned limestone/sandstone-coloured ashlar, 2 m coverage, recessed joints and chipped arrises from the same height field. Geometry must round exposed block silhouettes.')
    for row,name in [(3,'bluestone_ashlar'),(8,'prison_bluestone')]:
        material(row,name,'white_sandstone_blocks_02',[2,2],.021,target=[.345,.352,.36],notes='Photographed dressed ashlar geometry and grain, adapted to dark grey-blue local stone. Donor is pale sandstone, not an authenticated Belgian quarry scan; fossil identity is not claimed. Mortar and each block retain unique scan detail. Requires geological/art-direction review before acceptance.')
    material(10,'stone_petit_granit','Rock041',[1,1],.0025,target=[.32,.345,.36],notes='Fine photographed dark mineral skin, desaturated to weathered Belgian bluestone colour. Source is a natural rock scan, not a certified petit-granit/fossil specimen. Scanned pits supply real depth. No painted joints across a solid fountain or plinth. Fossil-specific accuracy remains unverified.')
    old=next(e for e in OLD['sets'] if e['name']=='coping_bluestone')
    c,h,r=donor('Rock041',old['size']);c=tone(c,[.33,.35,.365]);hh=.57+(h-.5)*.12
    # Three physical coping blocks, not a square field texture stretched across a
    # strip. Each is an independent phase of the same scan at the declared scale.
    H,W=h.shape;x=np.arange(W)/W;d=np.minimum((x*3)%1,1-(x*3)%1)
    joint=np.clip((.014-d)/.014,0,1)
    hh-=joint[None,:]*.48;c[...,:3]*=(1-joint[None,:,None]*.42)
    emit(old,c,hh,r,[3,.75],.015,['Rock041'],'Three 1 m coping blocks, mineral scan with 10-14 mm recessed lime joints. Physical bevelled top and underside remain geometry. No fossil/quarry provenance claimed.')
    for row in [3,8]:
        material(row,'slate_ardennes','roof_slates_03',[3,3],.011,target=[.32,.345,.37],notes='Photographed overlapping roof slates, 3 m coverage; chipped ends, split grain and laps share measured displacement. Slate colour adapted to grey-blue Ardennes material. Image top is ridgeward; near-visible lips still require geometry.')
    keep(8,'lead_roof','Retained photographic original lead panels and co-registered structural rolled-seam height. Even grey oxide, no orange rust. Large seam rolls and sheet silhouettes remain geometry.')
    # Stone grain without carving/masonry joints; select the entire rock scan.
    material(8,'sandstone_plain','Rock041',[1,1],.0014,target=[.64,.61,.54],notes='Continuous mineral photograph adapted to pale carved sandstone; no block seams on mouldings. Fine measured rock texture only; not a quarry-identification claim.')
    old=next(e for e in OLD['sets'] if e['name']=='bronze_cast')
    c=b.load(HERE/'round2-generated/bronze-patina.png',tuple(old['size']))
    _,scan,r=donor('Metal063',old['size'])
    # Photographed cast-skin microrelief and explicitly reconstructed isolated
    # pores. Neither verdigris pigment nor broad albedo brightness becomes height.
    hh=.62+(scan-gaussian_filter(scan,5,mode='wrap'))*.20
    lum=c[...,:3].mean(-1);green=c[...,1]>c[...,0]*1.06
    pores=(lum<gaussian_filter(lum,3,mode='wrap')-.09)&(~green)
    labels,count=label(pores);accepted=np.zeros_like(pores)
    for i in range(1,count+1):
        y,x=np.where(labels==i)
        if 1<=len(x)<=38 and max(x.max()-x.min(),y.max()-y.min())<=10:accepted|=labels==i
    hh-=gaussian_filter(accepted.astype(float),.7,mode='wrap')*.34
    verd=np.clip((c[...,1]-c[...,0]+.02)*10,0,1)
    rr=np.clip(.46+.20*r+.22*verd,.42,.92)
    emit(old,c,b.periodic(hh),rr,[.5,.5],.003,['Metal063','art-source/plan-84/round2-generated/bronze-patina.png'],
         'Photographic original generated bronze pigment; casting micro-pits use scanned metal displacement, with isolated generated pores explicitly reconstructed. Verdigris changes pigment/roughness only. Height is an authored reconstruction, not measured bronze photogrammetry. Base and casting need the same finish; hand-wear and runoff remain localized native work.')
    keep(10,'iron_painted','Retained art2 photographic black-painted iron, granular corrosion, matching authored pits/roughness. No uniform edge-polish mask. Also reused in row 2 and atlas iron cells.')
    material(10,'zinc_sheet','Metal063',[.5,.5],.0007,target=[.45,.47,.49],notes='Photographed fine rolled/pitted metal skin adapted to dull zinc; 0.7 mm total microrelief. Warm steel oxides removed from colour, not turned into zinc rust. No galvanized spangle or oversized painted seams.')
    material(10,'earth_bare','brown_mud',[1.3,1.3],.022,notes='Continuous photographed soil with real clods, pressed debris and measured displacement. No enlarged circular mud decal. Full donor covers 1.3 m, shared with colour/height/roughness.')
    keep(10,'water_base','Intentional flat absorption colour and flat normal; native animated water supplies reflection and waves. A photographic sky or ripple painted into the base would be incorrect.')
    for row,name in [(10,'wood_oak'),(6,'wood_dark')]:
        material(row,name,'dark_wooden_planks',[2,2],.008,notes='Photographed weathered boards, fine saw/grain detail, pores and measured joints; full 2 m scan. Grain follows board length. Rotate all maps together on the object; board seams must not cross solid beams.')
    material(6,'barrel','wooden_barrel',[1.29,1.29],.009,notes='Photographed cask staves and hoops with co-registered measured height; 1.29 m source coverage. Native geometry still owns real hoop/stave thickness and curved silhouette.')
    material(6,'leather','brown_leather',[.4,.4],.0015,notes='Photographed brown saddle/upholstery leather, 40 cm scan; creases and fine pore relief kept together. Use model geometry for folds and cut edges.')
    material(6,'sackcloth','hessian_230',[.269,.267],.0014,notes='Photographed coarse jute, 269x267 mm source coverage. Thread spacing retained in metre metadata; do not stretch one weave across a full metre.')
    for name in ['awning_blue','awning_red','tarpaulin','canvas_patched']:
        old=next(e for e in OLD['sets'] if e['row']==6 and e['name']==name)
        base=original(old)[0]
        c,h,r=donor('rough_linen',old['size'])
        # Tile the photographed 27 cm weave about four times over a metre; broad
        # authored stripes, stains and patch layout stay in colour, not in height.
        c=np.tile(c,(4,4,1));h=np.tile(h,(4,4));r=np.tile(r,(4,4))
        c=b.resize_data(c,tuple(old['size']));h=b.resize_data(h,tuple(old['size']));r=b.resize_data(r,tuple(old['size']))
        pigment=gaussian_filter(base[...,:3],(3,3,0),mode='wrap')
        detail=c[...,:3]/np.maximum(gaussian_filter(c[...,:3],(5,5,0),mode='wrap'),.02)
        c[...,:3]=np.clip(pigment*detail,0,1)
        emit(old,c,h,r,[1,1],.0012,['rough_linen']+old['sources'],
             'Photographed linen thread relief at about 27 cm per weave tile; original awning pigment, stain and patch layout retained. Four fine-weave repeats per metre are intentional textile structure; no tiled broad stain. Cloth silhouettes and stitched patch edges remain model work.')
    old=next(e for e in OLD['sets'] if e['name']=='wood_single')
    c,h,r=donor('dark_wooden_planks',old['size'],crop=(0,300,1024,60))
    c[...,:3]=np.clip(b.periodic(c[...,:3]),0,1);h=b.periodic(h);r=b.periodic(r)
    emit(old,c,np.clip(h,0,1),np.clip(r,.1,1),[2,.1171875],.003,['dark_wooden_planks'],
         'One photographed continuous board, cropped between scan joints; 2 m along grain, 117 mm across. Periodic correction of this crop avoids a visible cut seam. Never apply a multi-board gap across a spoke, beam or solid painted panel.')
    keep(2,'wrought_iron','Retained art2 photographic iron (042db687), with corrosion and aligned authored height. This donor remains suitable; its four maps are compared in the round 2 proof.')

def make_bark():
    material(9,'bark_fissured','jolcham_oak_bark_01',[1,2],.024,target=[.35,.30,.24],notes='Photographed deeply fissured oak plates, full 1x2 m scan, with measured crevices and coarse scales. Generic fissured trunk proxy for lime/elm/willow in existing half-atlas; not a botanical lime scan. Do not stretch to former 0.5x1 m metadata. Species-specific lime accuracy remains a review item.')
    material(9,'bark_plane','japanese_sycamore',[1.1,2.2],.006,target=[.57,.55,.47],notes='Photographed exfoliating Platanus-family bark, 1.1x2.2 m scan; cream/olive/grey adaptation for Antwerp plane trees. Scanned flake relief stays aligned, broad pigment patches do not create false fissures. Japanese sycamore is the source, not a claim of a London-plane field scan.')
    old=next(e for e in OLD['sets'] if e['name']=='bark_atlas')
    a=SURF[(9,'bark_fissured')];z=SURF[(9,'bark_plane')]
    e=emit(old,np.concatenate([a[0],z[0]],1),np.concatenate([a[1],.5+(z[1]-.5)*.25],1),np.concatenate([a[3],z[3]],1),[2,2],.024,['jolcham_oak_bark_01','japanese_sycamore'],
           'Original left/right half rectangles retained. Each half repeats independently. Fissured scan covers 1x2 m; plane scan 1.1x2.2 m. Installer must use per-half metre scales; repeating the entire atlas is invalid.',normal=np.concatenate([a[2],z[2]],1))
    e['cell_metres']={'fissured':[1,2],'plane':[1.1,2.2]}
    for name in ['tree_leaves','park_leaves']:
        keep(9,name,'Retained photographic original leaf/plant cutout cards: species indices, silhouettes, transparent gutters and pigment veins remain intact. Thin two-sided cards intentionally keep flat height/normal; branch thickness and curling silhouettes belong to geometry.')

def make_litter():
    for old in [x for x in OLD['sets'] if x['row']==7]:
        name=old['name'];c,h,n,r=original(old);amp=old['relief_range_metres'];src=old['sources']
        # Remove the rejected generated matte's red/yellow outline. Only edge
        # pixels are touched: keep actual yellow straw and autumn leaf interiors.
        alpha=c[...,3].copy();edge=~binary_erosion(alpha>.85,iterations=3)
        rgb=c[...,:3];spill=edge&(rgb[...,0]>.60)&((rgb[...,1]<rgb[...,0]*.55)|((rgb[...,1]>.57)&(rgb[...,2]<.20)))
        alpha[spill]=0
        alpha=np.minimum(alpha,gaussian_filter((alpha>.25).astype(float),.42))
        alpha[:6]=0;alpha[-6:]=0;alpha[:,:6]=0;alpha[:,-6:]=0;c[...,3]=alpha
        notes='Retained photographic original isolated mark; coloured matte spill removed at the silhouette, transparent RGB bled from the nearest visible pixel. Stains intentionally have zero raised relief; actual solid litter and drain bars remain geometry.'
        if name.startswith('muck'):
            scan,hh,rr=donor('brown_mud',old['size']);scan[...,:3]*=.78;c[...,:3]=scan[...,:3]
            coverage=np.clip(distance_transform_edt(alpha>.3)/18,0,1)
            h=.5+(hh-.4)*coverage*.35;r=rr;src=['brown_mud'];amp=.015
            notes='Photographed clotted soil replaces the weak flat mud picture within the isolated footprint. Same scan displacement/roughness, 15 mm range with soft coverage falloff; colour dirt is not separately raised.'
        elif name.startswith('leaf'):
            scan,hh,rr=donor('dry_decay_leaves',old['size']);c[...,:3]=scan[...,:3]
            if name.startswith('leafmush'):c[...,:3]*=[.68,.64,.58]
            coverage=np.clip(distance_transform_edt(alpha>.3)/12,0,1)
            h=.5+(hh-.4)*coverage*.22;r=rr;src=['dry_decay_leaves'];amp=.012
            notes='Full photographed autumn leaf-litter scan replaces the repeated three-leaf stamps inside the existing isolated footprint. Measured leaf overlap depth; source is mixed dry broadleaf litter, botanical plane/lime identity is not asserted. Original footprint scale retained; donor 2 m coverage resampled to the mark.'
        elif name in ['dungflat_0','dungflat_1','straw_0','straw_1','scales_0','guts_0','paper_0','grain_0','ash_0','glass_0','shells_0']:
            # Preserve recognisable photographic objects. Their authored macro
            # relief is coverage-driven, not a conversion of pigment to bumps.
            r=np.clip(r+(c[...,:3].mean(-1)-gaussian_filter(c[...,:3].mean(-1),2))*.12,.08,.98)
        emit(old,c,h,r,old['metres_per_tile'],amp,src,notes,normal=None,
             decision='replaced' if name.startswith(('muck','leaf')) else 'matte repaired / retained photograph')

def make_atlases():
    import atlas_round2 as extra
    sources_by_name={e['name']:e for e in ENTRIES}
    layouts=json.loads((HERE/'recovered-cells.json').read_text())
    for owner in ['omnibus','wagons']:
        cells=extra.data(owner,'CELLS')
        layouts[owner]=dict(size=[256,256],cells={name:[(i%4)*64,(i//4)*64,64,64] for i,name in enumerate(cells)})
    for old in [x for x in OLD['sets'] if x['row']==13]:
        c,h,n,r=original(old);records=[];used=set()
        for cell in old['cells']:
            source=sources_by_name[cell['source_set']];a,ah,an,ar=SURF[(source['row'],source['name'])]
            x,y,w,z=cell['output_cell'];metres=source['metres_per_tile']
            if cell['name'] in {'planks_v','shed_planks','hut_planks','fender_oak'}:
                a=np.rot90(a);ah=np.rot90(ah);ar=np.rot90(ar);metres=metres[::-1]
            ac=b.resize_data(a,(w,z));hh=b.resize_data(ah,(w,z));rr=b.resize_data(ar,(w,z))
            target=np.maximum(c[y:y+z,x:x+w,:3].mean((0,1)),.012)
            if source['name'] not in {'brick_english','slate_ardennes','sandstone_plain'}:ac=tone(ac,target)
            hh=.5+(hh-.5)*source['relief_range_metres']/.030
            nn=b.normals(hh,metres,.030)
            c[y:y+z,x:x+w]=ac;h[y:y+z,x:x+w]=hh;r[y:y+z,x:x+w]=rr;n[y:y+z,x:x+w]=nn
            record=copy.deepcopy(cell);record.update(metres_per_tile=metres,relief_range_metres=.030)
            records.append(record);used.update(source['sources'])
            test=P/'cells/13'/old['name']/(cell['name']+'_3x3.jpg')
            tile_at_scale([ac,hh,nn,rr],test,old['name']+'/'+cell['name'],metres)
        preserved=[]
        if old['name'] in layouts:
            layout=layouts[old['name']];factor=c.shape[1]/layout['size'][0]
            for name in old['preserved_cells']:
                x,y,w,z=[round(v*factor) for v in layout['cells'][name]]
                target=np.maximum(c[y:y+z,x:x+w,:3].mean((0,1)),.012)
                result=extra.extra(old['name'],name,(w,z),target,SURF,sources_by_name,c[y:y+z,x:x+w])
                if result is None:preserved.append(name);continue
                ac,ah,ar,metres,amp,donors,note=result
                ah=.5+(ah-.5)*amp/.030;an=b.normals(ah,metres,.030)
                c[y:y+z,x:x+w]=ac;h[y:y+z,x:x+w]=ah;r[y:y+z,x:x+w]=ar;n[y:y+z,x:x+w]=an
                records.append(dict(name=name,native_cell=layout['cells'][name],output_cell=[x,y,w,z],source_set='atlas-specific photograph',metres_per_tile=metres,relief_range_metres=.030,sources=donors,notes=note))
                used.update(donors)
                tile_at_scale([ac,ah,an,ar],P/'cells/13'/old['name']/(name+'_3x3.jpg'),old['name']+'/'+name,metres)
        else:preserved=list(old['preserved_cells'])
        e=emit(old,c,h,r,[1,1],.030,sorted(used),
               'Photographic material, goods/fibre and print cells rebuilt at exactly the existing pixel rectangles and native normalized UVs. Serif sign lettering is repainted at output resolution using the original authored words. Per-cell scale is authoritative. Remaining special-purpose cells are individually listed; this remains partial until those and native geometry are reviewed.',normal=n,decision='photographic cells and lettering rebuilt; special cells retained')
        e['metres_per_tile']=None;e['cells']=records;e['preserved_cells']=preserved
        path=DEST/'13'/f"{e['name']}_cells.json"
        data=json.loads(path.read_text());data['cells']=records;data['preserved_cells']=preserved;write_json(path,data)

def lit(arrays,metres,amp):
    """Deterministic neutral material swatch, not a native renderer acceptance."""
    c,h,n,r=arrays
    target=(min(650,c.shape[1]),max(1,round(c.shape[0]*min(650/c.shape[1],1))))
    c=b.resize_data(c,target);h=b.resize_data(h,target);n=b.resize_data(n,target);r=b.resize_data(r,target)
    v=n*2-1;v/=np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-8)
    L=np.array([-.82,.48,.30]);L/=np.linalg.norm(L);V=np.array([0,0,1]);half=L+V;half/=np.linalg.norm(half)
    diffuse=np.maximum((v*L).sum(-1),0)
    fresnel=np.maximum((v*half).sum(-1),0)**(6+(1-r)*85)
    # A horizon test on physical heights reveals joint/lap occlusion. It uses the
    # same neutral light for both rounds; no height contrast enhancement.
    shadow=np.ones_like(h);scale=metres or [1,1]
    for step in [2,5,9,16]:
        rise=np.roll(np.roll(h,step,0),step,1)-h
        reach=step*max(scale)/max(h.shape)
        shadow*=np.where(rise*amp>reach*.55,.91,1)
    linear=np.where(c[...,:3]<=.04045,c[...,:3]/12.92,((c[...,:3]+.055)/1.055)**2.4)
    val=linear*(.28+.85*diffuse[...,None])*shadow[...,None]+fresnel[...,None]*(1-r[...,None])*.15
    val=np.where(val<=.0031308,val*12.92,1.055*np.maximum(val,0)**(1/2.4)-.055)
    return np.dstack([np.clip(val,0,1),c[...,3]])

def tile_at_scale(arrays,path,name,metres):
    if metres:
        scale=max(metres);size=(max(16,round(700*metres[0]/scale)),max(16,round(700*metres[1]/scale)))
        arrays=[b.resize_data(a,size) for a in arrays]
    b.tile_preview(arrays,path,name)

def panel(sheet,a,box,metres=None):
    x,y,w,h=box;im=Image.fromarray(np.uint8(np.clip(a,0,1)*255)).convert('RGBA')
    if metres:
        im=im.resize((max(1,round(1000*metres[0]/max(metres))),max(1,round(1000*metres[1]/max(metres)))),Image.Resampling.LANCZOS)
    im.thumbnail((w,h),Image.Resampling.LANCZOS)
    # Checkerboard makes isolated marks and alpha edges inspectable.
    bg=Image.new('RGB',(w,h));d=ImageDraw.Draw(bg)
    for yy in range(0,h,20):
        for xx in range(0,w,20):d.rectangle((xx,yy,xx+19,yy+19),fill='#707070' if (xx//20+yy//20)%2 else '#858585')
    bg.paste(im,((w-im.width)//2,(h-im.height)//2),im);sheet.paste(bg,(x,y))

def proofs():
    checks=[]
    oldmap={(e['row'],e['name']):e for e in OLD['sets']}
    for e in ENTRIES:
        a=SURF[(e['row'],e['name'])];o=original(oldmap[(e['row'],e['name'])])
        sheet=Image.new('RGB',(1320,1000),'#24272a');d=ImageDraw.Draw(sheet)
        d.text((15,8),f"{e['row']}/{e['name']} | {e['round2_decision']}",fill='white')
        d.text((15,30),'ROUND 1 colour',fill='white');d.text((675,30),'ROUND 2 colour',fill='white')
        old=oldmap[(e['row'],e['name'])]
        panel(sheet,o[0],(15,50,630,425),old['metres_per_tile']);panel(sheet,a[0],(675,50,630,425),e['metres_per_tile'])
        d.text((15,485),'ROUND 1 neutral lit / normal + physical height',fill='white')
        d.text((675,485),'ROUND 2 neutral lit / same light and exposure',fill='white')
        old=oldmap[(e['row'],e['name'])]
        panel(sheet,lit(o,old['metres_per_tile'],old['relief_range_metres']),(15,505,630,425),old['metres_per_tile'])
        panel(sheet,lit(a,e['metres_per_tile'],e['relief_range_metres']),(675,505,630,425),e['metres_per_tile'])
        d.text((15,943),'Physical tile aspect shown. Offline swatches; no native scene, weather or geometry acceptance.',fill='white')
        if e.get('preserved_cells'):d.text((15,967),f"INCOMPLETE: {len(e['preserved_cells'])} retained artwork cells. See manifest.",fill='#ffc670')
        dest=P/e['comparison'];dest.parent.mkdir(parents=True,exist_ok=True);sheet.save(dest,quality=94)
        tile_at_scale(a,P/e['preview'],f"{e['row']}/{e['name']}",e['metres_per_tile'])
        for k,arr in zip(KEYS,a):
            path=ROOT/e['maps'][k]['path'];im=Image.open(path)
            checks.append(dict(set=f"{e['row']}/{e['name']}",check=k+' dimensions/hash',ok=list(im.size)==e['size'] and b.sha(path)==e['maps'][k]['sha256']))
            checks.append(dict(set=f"{e['row']}/{e['name']}",check=k+' finite/range',ok=bool(np.isfinite(arr).all() and arr.min()>=0 and arr.max()<=1)))
        if e['kind']=='tile':
            for k,arr in zip(KEYS,a):
                delta=float(max(np.max(np.abs(arr[0]-arr[-1])),np.max(np.abs(arr[:,0]-arr[:,-1]))))
                checks.append(dict(set=f"{e['row']}/{e['name']}",check=k+' periodic endpoint guard',error=delta,ok=delta<=1/255+.00001))
        if e['kind']=='cutout':
            alpha=a[0][...,3];edge=float(max(alpha[0].max(),alpha[-1].max(),alpha[:,0].max(),alpha[:,-1].max()))
            checks.append(dict(set=f"{e['row']}/{e['name']}",check='transparent outer boundary',ok=edge==0))
        if e['relief_range_metres']>0 and e['kind']=='tile':
            span=float(np.ptp(a[1]));sd=float(np.std(a[2][...,:2]))
            checks.append(dict(set=f"{e['row']}/{e['name']}",check='nonempty physical relief',height_span=span,normal_xy_std=sd,ok=span>.03 and sd>.002))
        if e['row']==13:
            dims=json.loads((DEST/'13'/f"{e['name']}_cells.json").read_text())['native_size']
            for cell in e['cells']:
                source=np.asarray(cell['native_cell'],dtype=float)/np.asarray(dims*2)
                output=np.asarray(cell['output_cell'],dtype=float)/np.asarray(e['size']*2)
                checks.append(dict(set=f"13/{e['name']}/{cell['name']}",check='native normalized cell rectangle preserved',ok=bool(np.allclose(source,output,atol=1e-8))))
            checks.append(dict(set=f"13/{e['name']}",check='all original atlas cell names accounted for',ok=len(e['cells'])+len(e['preserved_cells'])==len(old['cells'])+len(old['preserved_cells'])))
    for key,record in SOURCES.items():
        checks.append(dict(set=key,check='item page CC0 evidence',ok='CC0' in (THIRD/key/'item-page.html').read_text(encoding='utf-8')))
        for f in record['files']:checks.append(dict(set=key,check='original SHA256 '+Path(f['path']).name,ok=b.sha(ROOT/f['path'])==f['sha256']))
    result=dict(sets=len(ENTRIES),maps=len(ENTRIES)*4,comparisons=len(ENTRIES),checks=len(checks),passed=sum(x['ok'] for x in checks),failed=sum(not x['ok'] for x in checks),results=checks)
    write_json(P/'validation.json',result)
    print(json.dumps({k:v for k,v in result.items() if k!='results'}),flush=True)
    assert result['failed']==0,[x for x in checks if not x['ok']]

def documents():
    generated={b.relative(p):dict(sha256=b.sha(p),licence='Original generated project artwork; project LICENSE',date='2026-10-18',method='Built-in image_gen; albedo artwork, not a measured field scan') for p in (HERE/'round2-generated').glob('*.png')}
    manifest=copy.deepcopy(OLD);manifest.update(version=2,sources={**OLD['sources'],**SOURCES,**generated},sets=ENTRIES,
        scope='Round 2 picture-only photographic donor handoff; native installation, retained artwork and contextual acceptance outstanding')
    write_json(DEST/'manifest.json',manifest)
    for row in sorted({e['row'] for e in ENTRIES}):
        lines=[f'# Issue 84, row {row}: round 2 pictures','',
               'Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.',
               'Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.','',
               'Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.',
               'No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.','',
               'Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.','',
               '| Set | Pixels | Metres per tile/card | Target material | Decision |','|---|---|---|---|---|']
        for e in ENTRIES:
            if e['row']!=row:continue
            scale=e.get('cell_metres',e['metres_per_tile'])
            lines.append(f"| `{e['name']}` | {' x '.join(map(str,e['size']))} | {scale if scale is not None else 'per cell'} | {', '.join(e['materials'])} | {e['round2_decision']} |")
        lines+=['','Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.',
                'Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.',
                'Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.','',
                'Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.']
        if row==13:lines+=['','INCOMPLETE: retained lettering, goods, figurative/animal art and unsupported cells are listed individually in `*_cells.json`. They are not accepted by this texture pass. Per-cell repeat tests are under `cells/13/<atlas>/`.']
        if row==9:lines+=['','The two bark halves now have different measured scan scales. Use `bark_atlas.cell_metres`; never repeat across the half-atlas boundary. Botanical lime and London-plane accuracy remains a review item.']
        write=(DEST/str(row)/'README.md');write.write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')

def main():
    global P,OLD
    ap=argparse.ArgumentParser();ap.add_argument('--proof',type=Path,required=True);ap.add_argument('--downloads',type=Path);ap.add_argument('--proof-only',action='store_true')
    args=ap.parse_args();P=args.proof.resolve();P.mkdir(parents=True,exist_ok=True);b.PROOF=P
    OLD=json.loads(subprocess.run(['git','show','90be884c:native-godot/assets/textures/plan-84/manifest.json'],cwd=ROOT,capture_output=True,check=True).stdout)
    if args.downloads:intake(args.downloads)
    else:SOURCES.update(json.loads((HERE/'ROUND2-SOURCES.json').read_text(encoding='utf-8')))
    if args.proof_only:
        ENTRIES.extend(json.loads((DEST/'manifest.json').read_text(encoding='utf-8'))['sets'])
        for e in ENTRIES:
            SURF[(e['row'],e['name'])]=[np.asarray(Image.open(ROOT/e['maps'][k]['path']).convert('RGBA') if k=='colour' else Image.open(ROOT/e['maps'][k]['path']),dtype=np.float32)/255 for k in KEYS]
        proofs();return
    for e in OLD['sets']:original(e)
    make_surfaces();print('Surface families written',flush=True)
    make_bark();print('Bark and cards written',flush=True)
    make_litter();print('Litter marks written',flush=True)
    make_atlases();print('Atlas material cells written',flush=True)
    documents();proofs()
    print('All writes confined to picture/source manifests, documentation and external proof.',flush=True)

if __name__=='__main__':main()

from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
import json,struct
p=Path(__file__).parent
names=['dry_earth','pit_soil','wet_mud','grave_soil','yard_dirt']
stats=json.loads((p/'validation.json').read_text())
checks={}
for n in names:
    for suffix in ['albedo','height','normal','roughness','ao']+(['wet_albedo','wet_roughness'] if n in ['dry_earth','pit_soil','yard_dirt'] else []):
        f=p/(n+'_'+suffix+'.png'); im=Image.open(f); a=np.asarray(im)
        assert im.size==(2048,2048),f
        if suffix=='height':assert f.read_bytes()[24]==16,f
        if 'albedo' in suffix:assert a.min()>=30 and a.max()<=140,f
        wrap=(np.mean(abs(a[0].astype(float)-a[-1]))+np.mean(abs(a[:,0].astype(float)-a[:,-1])))/2
        inside=(np.mean(abs(np.diff(a.astype(float),axis=0)))+np.mean(abs(np.diff(a.astype(float),axis=1))))/2
        checks[f.name]={'size':list(im.size),'png_bit_depth':f.read_bytes()[24],'min':int(a.min()),'max':int(a.max()),'edge_gradient_ratio':round(wrap/inside,3)}
        assert .6<wrap/inside<1.5,(f,wrap/inside)
    if n in ['dry_earth','pit_soil','yard_dirt']:
        t=Image.open(p/(n+'_wet_albedo.png')).resize((512,512),Image.Resampling.LANCZOS)
        out=Image.new('RGB',(2048,2048))
        for y in range(4):
            for x in range(4):out.paste(t,(x*512,y*512))
        out.save(p/('tiling_4x4_'+n+'_wet.png'))
h=np.asarray(Image.open(p/'wet_mud_height.png'))
r=np.asarray(Image.open(p/'wet_mud_roughness.png'))
assert len(np.unique(h[r==14]))==1,'water not level'
checks['water']={'flat':True,'roughness':14/255,'coverage':float(np.mean(r==14))}
(p/'file_checks.json').write_text(json.dumps(checks,indent=2))
# Compact QA sheets, with the full-resolution per-set sheets retained.
for typ,files in [('tiling',['tiling_4x4_'+n+'.png' for n in names]),('relief',['preview_'+n+'.png' for n in names])]:
    s=Image.new('RGB',(1920,1320),(24,24,24));d=ImageDraw.Draw(s)
    for i,f in enumerate(files):
        x=(i%3)*640;y=(i//3)*660
        s.paste(Image.open(p/f).resize((640,640)),(x,y+20));d.text((x+8,y+3),f,fill='white')
    s.save(p/('review_'+typ+'.png'))
text='''SCHELDEMIST - PROCEDURAL DIRT MATERIALS
Created for Antwerp, 1873. All files generated locally from original procedural
geometry/noise. No photographs, external imagery, logos or text in material maps.

SCALE AND CONVENTIONS
Every base material spans 1 metre x 1 metre per UV repeat. All material maps are
2048 x 2048 pixels: 0.48828125 mm per texel. Repeat on both UV axes.
Albedo: 8-bit RGB, sRGB, colour only; no directional lighting or AO baked in.
Height: true 16-bit single-channel PNG, linear, black low / white high.
Normal: 8-bit RGB tangent-space OpenGL (+Y/up), linear, flat = (128,128,255).
Image rows point down; tangent +Y points up. Do not flip green on import.
Roughness: 8-bit greyscale, linear; black smooth / white rough.
AO: 8-bit greyscale, linear; white unoccluded. Local multiscale approximation.
All maps share the exact layout. No metallic response (metallic = 0).
Wet variants reuse base height, normal and AO; blend albedo in linear light.
Wet colour is darker with warmer saturation; roughness falls in hollows and
on protruding clods. Mud water is a level plane, roughness 14/255, with flat
interior normals. Water pockets cover 12% of the wet-mud tile.

HEIGHT CALIBRATION
Recover metres = minimum + normalized_height * range. Normal maps are computed
from these physical metre heights at 1 m UV scale, with no strength multiplier.
'''
for n,v in stats.items():text+=f"{n}: minimum {v['height_min_metres']:.8f} m; range {v['height_range_metres']:.8f} m ({v['height_peak_to_peak_mm']} mm).\n"
text+='''
MATERIAL CONTENT
dry_earth: compact grey-brown earth, ash, coal flecks, mineral grit, pebbles,
fine irregular cracks and sparse crushed straw.
pit_soil: dark loose soil, overlapping 1-4 cm clods, smaller aggregates,
grit, fine root threads and sparse pressed brown leaf fragments.
wet_mud: glossy smeared earth, shallow ruts, partial worn-sole impressions,
level water pockets. No modern boot tread.
grave_soil: richer dark loam with denser turned clods, stone and sandy grit.
yard_dirt: packed earth, irregular brick/stone chips, straw, restrained dung
discolouration and shallow wheel scuffs.

REVIEW AND LIMITATIONS
Inspected all five low-sun previews, all base 4x4 albedo views and contact sheet.
Reduced broad colour variation and dark yard-smear contrast after repetition
review; clipped brick outlines to avoid regular square chips. All generation,
filtering, derivatives and debris placement wrap across both axes. Boundary
gradient tests compare wrap neighbours to interior neighbours; see JSON reports.
Opposite border texels are adjacent samples, not duplicated identical rows.
No visible seam lines in the reviewed sheets. A finite 1 m tile still repeats
exactly: deliberate inspection can identify repeated stones or impressions.
For large exposed areas, stochastic material blending remains advisable.
Debris is procedural and restrained; leaf fragments do not contain botanical
vein detail. Mud soles are worn partial impressions rather than hero decals.
AO is approximate and the previews use a simple directional BRDF, not ray tracing.
These are texture assets, not a completed native environment review. No Godot
scene, collision, placements or original resource was modified. Native dry,
rain and night acceptance remains for the integrator. Use height displacement
or suitable ground geometry where clods affect visible silhouettes; normals
alone do not change the outline. Tree-pit edges must meet kerbs and roots.

DELIVERABLES
31 material maps; five low-sun previews; labelled 2x2 albedo contact sheet;
eight 4x4 albedo QA sheets; two compact QA sheets; generation and validation
scripts; calibration/validation JSON; this README and provenance record.
Previews are 2048 square. Contact sheet is 2048 x 1152 and is not a material.
Regenerate with Python + NumPy, SciPy and Pillow: generate.py, then finish.py.
Only the containing directory receives writes.

FILE LIST
'''
(p/'LICENCES.txt').write_text('Original procedural texture artwork generated for this task.\nNo external images or CC0 sources used. No source attribution required.\nReference images were inspected only; none were copied into the textures.\n')
files=sorted({f.name for f in p.iterdir() if f.is_file()}|{'README.txt'})
(p/'README.txt').write_text(text+'\n'.join(files)+'\n')
print('Validated',len(checks)-1,'material maps; water is flat; dimensions, bit depths, albedo ranges and edge gradients pass.')

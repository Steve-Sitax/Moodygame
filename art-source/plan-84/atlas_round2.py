"""Extra atlas picture cells. Reads archived constants as AST data, never runs builders."""
import ast
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import gaussian_filter
import build_maps as b

HERE=Path(__file__).resolve().parent
ROOT=b.ROOT

def data(owner,name):
    tree=ast.parse((ROOT/f'art-source/tools/blender/build_{owner}.py').read_text(encoding='utf-8'))
    node=next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets))
    # The only constructor allowed in archived literal tables is dict(...).
    def literal(n):
        if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='dict':
            return {k.arg:literal(k.value) for k in n.keywords}
        if isinstance(n,ast.List):return [literal(x) for x in n.elts]
        return ast.literal_eval(n)
    return literal(node)

GOODS={
    'bread':0,'crust':0,'meat':2,'fat':3,'ham':4,'apple':5,'potato':6,'cabbage':7,
    'carrot':8,'onion':9,'fish':10,'cheese':11,'cheese_rind':12,'paper':13,'ledger':13,
    'coal':14,'candle':15,'wax':15,'leaf':7,
}
FIBRES={
    'cat_grey':0,'cat_black':1,'cat_ginger':2,'cat_white':3,'horse':4,'goat':5,'goat_dark':6,
    'hen':7,'hen_red':7,'wicker':8,'wicker_dark':8,'birch':9,'twigs':9,'straw':10,
    'bristle':11,'mane':11,'horn':12,'endgrain':13,'beak':14,'hoof':14,'rope':15,
    'hawser':15,'hemp':15,'oakum':15,
}
SPECIAL={'delft':0,'delft_blue':1,'flower_red':2,'flower_white':3,'flower_yellow':4,
         'grain':5,'checker':7,'tar':8,'boxface':9,'coal_glow':12,'fire':13,'flame':13,'ash':15}
SURFACES={
    'copper':'bronze_cast','brass':'bronze_cast','gold':'bronze_cast','gilt':'bronze_cast','bronze':'bronze_cast',
    'green_paint':'wood_single','red_paint':'wood_single','blue_paint':'wood_single',
    'paint_green':'wood_single','paint_red':'wood_single','paint_white':'wood_single',
    'door_brown':'wood_single','door_green':'wood_single','door':'wood_single','polychrome':'wood_single',
    'robe_blue':'tarpaulin','robe_white':'tarpaulin','canopy_blue':'tarpaulin','sail':'tarpaulin',
    'sail_tan':'tarpaulin','cloth_white':'tarpaulin','linen':'tarpaulin','rag':'canvas_patched','yarn':'sackcloth',
    'coal_sack':'sackcloth','muck':'earth_bare','ash':'earth_bare','shavings':'wood_single',
    'terracotta':'sandstone_plain','clay':'sandstone_plain','stoneware':'sandstone_plain',
    'beads':'wood_single','skin':'leather','gull':'tarpaulin','gull_grey':'tarpaulin',
    'stripes_3':'awning_blue','valance_0':'awning_red','valance_1':'awning_blue',
    'valance_2':'awning_red','valance_3':'awning_blue','cream':'wood_single',
}

def sample(kind,index,size):
    path=HERE/'round2-generated'/f'{kind}.png';w,h=Image.open(path).size
    box=(round(index%4*w/4),round(index//4*h/4),round(w/4),round(h/4))
    # Remove 2% per-cell edge uncertainty from the generated sample sheet.
    x,y,cw,ch=box;dx=round(cw*.02);dy=round(ch*.02)
    return b.load(path,size,(x+dx,y+dy,cw-2*dx,ch-2*dy))

def sign_spec(owner,name):
    if owner in {'quayfurniture','trades'} and name.startswith('sign_'):
        return data(owner,'SIGNS')[name[5:]]
    if owner=='lively' and name.startswith('sign_'):
        return [data(owner,'STALL_SIGNS')[name[5:]]],[.12,.10,.075],[.86,.80,.60]
    if owner=='streetlife':
        if name.startswith('board_'):
            t=next(t for t in data(owner,'TRADES') if t['key']==name[6:]);return t['lines'],t['bg'],t['fg']
        if name.startswith('plate_'):
            names=data(owner,'STREET_NAMES')+data(owner,'SQUARE_NAMES')
            return [names[int(name[6:])]], [.86,.86,.80],[.075,.13,.22]
        if name.startswith('number_'):
            return [data(owner,'NUMBERS')[int(name[7:])]], [.10,.14,.24],[.9,.9,.86]
    return None

def lettering(size,spec,background):
    lines,bg,fg=spec;w,h=size
    base=background.copy()
    if bg is not None:
        mean=np.maximum(base[...,:3].mean((0,1)),.015)
        base[...,:3]=np.clip(base[...,:3]/mean*np.asarray(bg),0,1)
    # Draw at twice output resolution for clean ink edges. Only rendered pixels
    # are stored: no system font binary is redistributed.
    mask=Image.new('L',(w*2,h*2));d=ImageDraw.Draw(mask)
    font_path=Path('C:/Windows/Fonts/timesbd.ttf')
    font=None
    for px in range(max(12,round(h*1.45/len(lines))),5,-1):
        test=ImageFont.truetype(str(font_path),px)
        if max(d.textlength(s,font=test) for s in lines)<w*1.85:font=test;break
    assert font is not None
    step=h*2/len(lines)
    for i,text in enumerate(lines):
        d.text((w,(i+.5)*step),text,font=font,fill=255,anchor='mm')
    alpha=np.asarray(mask.resize((w,h),Image.Resampling.LANCZOS),dtype=float)/255
    # Pigment follows existing wear in the photographed wooden substrate.
    local=base[...,:3].mean(-1);wear=np.clip(.93+(local-gaussian_filter(local,2))*.15,.84,1)
    alpha*=wear
    base[...,:3]=base[...,:3]*(1-alpha[...,None])+np.asarray(fg)*alpha[...,None]
    return base

def extra(owner,name,size,target,surfaces,definitions,original):
    """Return colour, height, roughness, metres, amplitude, sources, note; or None."""
    if name=='window':
        c=sample('special',6,size);yy,xx=np.indices((size[1],size[0]))
        u=xx/max(size[0]-1,1);v=yy/max(size[1]-1,1)
        frame=(u<.06)|(u>.94)|(v<.06)|(v>.94)|(abs(u-.5)<.035)|(abs(v-.5)<.035)
        c[~frame,:3]=[.055,.065,.075];h=np.where(frame,.75,.25);r=np.where(frame,.80,.22)
        return c,h,r,[.6,.55],.006,['art-source/plan-84/round2-generated/special.png'],'Photographic cream-painted timber replaces the pixel window frame. Dark glass carries absorption only; native light/reflection must supply its environment. Reconstructed 6 mm inset is a map aid, not a substitute for real exposed frame geometry.'
    if name in SPECIAL:
        c=sample('special',SPECIAL[name],size);h=np.full((size[1],size[0]),.5);r=np.full_like(h,.78)
        if name=='boxface':
            yy,xx=np.indices(h.shape);radius=np.hypot((xx/(size[0]-1)-.5),(yy/(size[1]-1)-.5))
            h+=np.exp(-((radius-.34)/.018)**2)*.26+np.clip((.09-radius)/.025,0,1)*.30
        amp=.006 if name=='boxface' else 0
        return c,h,r,[.25,.25],amp,['art-source/plan-84/round2-generated/special.png'],'Original generated photographic surface. Ceramic/flower pigment and self-luminous flame/ember pictures stay flat; native shape/emission still owns the result. The axle-cover inset has explicitly reconstructed concentric relief; exposed edges remain geometry.'
    if name in GOODS or name in FIBRES:
        kind='goods' if name in GOODS else 'fibres';index=(GOODS if name in GOODS else FIBRES)[name]
        c=sample(kind,index,size)
        # Only submillimetre photo grain: broad coat markings, apple pigment,
        # veins, food volumes and printed ink never become macro displacement.
        lum=c[...,:3].mean(-1);micro=lum-gaussian_filter(lum,1.8)
        h=np.clip(.5+micro*.12,.44,.56);r=np.clip((.78 if kind=='fibres' else .65)+micro*.1,.1,.95)
        if name in {'wicker_dark','cat_black','goat_dark'}:
            c[...,:3]*=target/np.maximum(c[...,:3].mean((0,1)),.02)
        return c,h,r,[.25,.25],.0005,[f'art-source/plan-84/round2-generated/{kind}.png'], 'Original generated photographic sample with bounded submillimetre grain reconstruction. Broad pigment, hair/feather volume and food silhouettes remain geometry; measured PBR relief is not claimed.'
    source=SURFACES.get(name)
    spec=sign_spec(owner,name)
    if spec:source='wood_single'
    if name in {'l_open','l_flat','l_van'} and owner=='wagons':source='wood_dark'
    if source:
        definition=definitions[source];a,h,n,r=surfaces[(definition['row'],source)]
        c=b.resize_data(a,size);h=b.resize_data(h,size);r=b.resize_data(r,size)
        mean=np.maximum(c[...,:3].mean((0,1)),.015);c[...,:3]=np.clip(c[...,:3]*target/mean,0,1)
        if spec:c=lettering(size,spec,c)
        if name in {'l_open','l_flat','l_van'}:
            # Wagon bands are mapped separately. Keep the authored four-band
            # layout and actual wording while replacing the pixel font.
            words={'l_open':['ETAT BELGE','N 3127','','10000 K  T 4850'],
                   'l_flat':['ETAT BELGE 2214','10000 K T 4200','',''],
                   'l_van':['ETAT BELGE','N 812','','8000 K  T 5900']}[name]
            for i,text in enumerate(words):
                if not text:continue
                top=round(i*size[1]/4);bottom=round((i+1)*size[1]/4)
                c[top:bottom]=lettering((size[0],bottom-top),([text],None,[.87,.84,.72]),c[top:bottom])
        return c,h,r,definition['metres_per_tile'],definition['relief_range_metres'],definition['sources'], 'Photographic substrate; original pigment and lettering meaning retained. Crisp serif lettering is painted pigment, not raised geometry.'
    if name=='prints' and owner=='lively':
        c=b.load(HERE/'round2-generated/prints.png',size)
        h=np.full((size[1],size[0]),.5);r=np.full_like(h,.83)
        return c,h,r,[2.4,1.3],0,['art-source/plan-84/round2-generated/prints.png'],'Original photographed-style devotional lithograph board, eight columns/four rows. Printed artwork intentionally flat; no pixel icons retained.'
    return None

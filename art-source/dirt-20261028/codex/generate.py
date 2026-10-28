from pathlib import Path
import json
import numpy as np
from scipy.ndimage import gaussian_filter, zoom
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).parent
N=2048
Y,X=np.mgrid[:N,:N].astype(np.float32)
REPORT={}
def save(a,name):
    Image.fromarray(np.uint8(np.clip(a,0,255))).save(OUT/(name+'.png'))
def noise(r,s):
    a=gaussian_filter(r.standard_normal((N,N)).astype(np.float32),s,mode='wrap')
    return a/(a.std()+1e-8)
def stamp(h,c,r,amount,rad,kind='soil'):
    for _ in range(amount):
        cx,cy=r.integers(0,N,2); rx=r.uniform(*rad); ry=rx*r.uniform(.45,1.2)
        w=int(max(rx,ry)*1.5+3)
        yy,xx=np.mgrid[-w:w+1,-w:w+1].astype(np.float32)
        angle=r.uniform(0,6.28); u=(xx*np.cos(angle)+yy*np.sin(angle))/rx; v=(-xx*np.sin(angle)+yy*np.cos(angle))/ry
        th=np.arctan2(v,u); rho=np.sqrt(u*u+v*v)
        edge=1+.13*np.sin(th*3+r.uniform(0,6))+.1*np.sin(th*5+r.uniform(0,6))+.06*np.sin(th*8+r.uniform(0,6))
        q=rho/edge
        mask=np.clip((1-q)*5,0,1)
        iy=(yy.astype(int)+cy)%N; ix=(xx.astype(int)+cx)%N
        if kind=='soil':
            relief=np.maximum(0,1-q**1.7)**.65*rx/N*r.uniform(.24,.6)
            relief*=1+.18*r.standard_normal(q.shape)
            colour=np.array([77,63,49])+r.uniform(-13,13)
            blend=mask*.23
        elif kind=='stone':
            relief=mask*(.6+.4*np.maximum(0,1-q))*rx/N*r.uniform(.25,.7)
            colour=np.array([100,98,89])+r.uniform(-25,20); blend=mask*.8
        elif kind=='brick':
            mask=np.clip((1-np.maximum(abs(u),abs(v)))*8,0,1)*(q<1.25)*np.clip((.85-u*.6-v*.5)*8,0,1)
            relief=mask*rx/N*.38; colour=np.array([109,75,56])+r.uniform(-12,10); blend=mask*.8
        else:
            relief=mask*.0005; colour=np.array([75,62,41])+r.uniform(-10,15); blend=mask*.8
        h[iy,ix]+=relief
        c[iy,ix]=c[iy,ix]*(1-blend[...,None])+colour*blend[...,None]

def threads(h,c,r,count,kind):
    # Draw into a 3x3 canvas, fold copies back onto the torus.
    canvas=Image.new('L',(N*3,N*3)); d=ImageDraw.Draw(canvas)
    for _ in range(count):
        x,y=r.uniform(0,N,2); angle=r.uniform(0,6.28)
        length=r.uniform(15,90) if kind!='crack' else r.uniform(30,140)
        points=[(x,y)]
        for i in range(int(length/5)):
            angle+=r.normal(0,.28 if kind!='straw' else .035)
            x+=5*np.cos(angle); y+=5*np.sin(angle); points.append((x,y))
        width=int(r.integers(1,4))
        for ox in (0,N,2*N):
            for oy in (0,N,2*N): d.line([(px+ox,py+oy) for px,py in points],fill=int(r.integers(120,240)),width=width)
    mask=np.array(canvas.crop((N,N,N*2,N*2)),dtype=np.float32)/255
    mask=gaussian_filter(mask,.55,mode='wrap')
    colour={'crack':[43,39,33],'root':[94,77,53],'straw':[124,111,79]}[kind]
    h+=mask*(-.0014 if kind=='crack' else .00065)
    c[:]=c*(1-mask[...,None]*.8)+np.array(colour)*mask[...,None]*.8

def make(name,seed):
    print('Building',name,flush=True)
    r=np.random.default_rng(seed)
    fine=noise(r,.65); micro=noise(r,1.7); grain=noise(r,4); meso=noise(r,12); broad=noise(r,38); macro=noise(r,110)
    base={'dry_earth':[91,81,66],'pit_soil':[68,55,42],'wet_mud':[51,43,35],'grave_soil':[60,49,37],'yard_dirt':[83,73,59]}[name]
    tone=2.0*fine+2.5*micro+3*grain+3*meso+1.1*broad+.45*macro
    c=np.array(base,dtype=np.float32)+tone[...,None]*np.array([1,.95,.85])
    loose=name in ('pit_soil','grave_soil')
    h=.0001*fine+.0002*micro+.00045*grain+.0008*meso+.0012*broad+.001*macro
    if loose:
        # Mixed sizes, angular boundaries, partly buried overlapping aggregates.
        stamp(h,c,r,2800,(5,20),'soil')
        stamp(h,c,r,1250 if name=='pit_soil' else 1450,(11,40),'soil')
        h+=.0006*grain+.0007*meso
    else: stamp(h,c,r,1500,(3,12),'soil')
    stamp(h,c,r,180 if loose else 330,(3,12),'stone')
    stamp(h,c,r,8000,(.7,2.6),'stone')
    # Granular mineral/coal flecks are material colour, not baked shading.
    fleck=np.clip((fine-1.5)*.5,0,.7)
    c=c*(1-fleck[...,None])+np.array([112,105,88])*fleck[...,None]
    coal=np.clip((-micro-1.8)*.35,0,.65)
    c=c*(1-coal[...,None])+np.array([36,34,31])*coal[...,None]
    if name in ('dry_earth','yard_dirt'):
        threads(h,c,r,85 if name=='dry_earth' else 35,'crack')
        threads(h,c,r,55 if name=='dry_earth' else 140,'straw')
    if loose:
        threads(h,c,r,65,'root')
        stamp(h,c,r,45 if name=='pit_soil' else 20,(5,16),'leaf')
    water=np.zeros((N,N),bool)
    if name in ('wet_mud','yard_dirt'):
        # Broad trodden scuffs and irregular shallow wheel ruts, periodic across tile.
        scuff=np.zeros((N,N),np.float32)
        for i in range(6):
            cy=r.uniform(0,N); wav=12*np.sin(2*np.pi*X/N+r.uniform(0,6))
            dist=(Y-cy+wav+N/2)%N-N/2
            band=np.exp(-(dist/r.uniform(9,22))**2)
            modulation=.45+.55*(np.sin(2*np.pi*X/N+r.uniform(0,6))**2)
            scuff+=band*modulation
        h-=scuff*(.003 if name=='wet_mud' else .0015)
        c-=scuff[...,None]*2
    if name=='yard_dirt':
        stamp(h,c,r,100,(4,18),'brick'); stamp(h,c,r,65,(8,22),'stone')
        dung=np.clip((-broad-1.2)*.12,0,.20)
        c=c*(1-dung[...,None])+np.array([43,39,29])*dung[...,None]
    if name=='wet_mud':
        # Worn 19th-century soles: no modern lug pattern. Incomplete soft impressions.
        for i in range(5):
            cx,cy=r.uniform(0,N,2); a=r.uniform(0,6.28)
            dx=(X-cx+N/2)%N-N/2; dy=(Y-cy+N/2)%N-N/2
            u=dx*np.cos(a)+dy*np.sin(a); v=-dx*np.sin(a)+dy*np.cos(a)
            q=(u/(70+10*np.tanh(v/50)))**2+((v+30)/155)**2
            heel=(u/58)**2+((v-150)/52)**2
            impression=np.maximum(np.clip((1-q)*3,0,1),np.clip((1-heel)*3,0,1))
            h-=impression*.004; c-=impression[...,None]*1.5
        h=gaussian_filter(h,1.4,mode='wrap')
        level=float(np.percentile(h,12)); water=h<level
        h=np.maximum(h,level) # All water has one real, level surface.
        c[water]=c[water]*.65+np.array([39,35,30])*.35
    # Physical height in metres; save a documented scale, no arbitrary normal strength.
    h=gaussian_filter(h,.55,mode='wrap')
    if name=='wet_mud': h[water]=level
    gx=(np.roll(h,-1,1)-np.roll(h,1,1))*N/2
    gy=(np.roll(h,-1,0)-np.roll(h,1,0))*N/2
    norm=np.stack([-gx,gy,np.ones_like(h)],axis=-1)
    norm/=np.linalg.norm(norm,axis=-1)[...,None]
    ao=np.ones_like(h)
    for s,strength in [(3,55),(10,45),(30,23)]:
        ao-=np.maximum(gaussian_filter(h,s,mode='wrap')-h,0)*strength
    ao=np.clip(ao,.48,1); ao[water]=1
    rough=np.clip((.88 if loose else .81)+.025*grain+.025*meso,.65,.98)
    if name=='wet_mud': rough=np.clip(.26+.035*meso+.025*grain,.13,.38); rough[water]=.055
    c=np.clip(c,30,140)
    save(c,name+'_albedo'); save((norm*.5+.5)*255,name+'_normal'); save(rough*255,name+'_roughness');save(ao*255,name+'_ao')
    lo,hi=float(h.min()),float(h.max()); hn=(h-lo)/(hi-lo)
    Image.fromarray(np.uint16(hn*65535)).save(OUT/(name+'_height.png'))
    if name in ('dry_earth','pit_soil','yard_dirt'):
        wet=c*np.array([.64,.61,.57]); wet=np.clip(wet,30,140)
        hollows=np.clip((gaussian_filter(h,18,mode='wrap')-h)*150,0,1)
        tops=np.clip((h-gaussian_filter(h,12,mode='wrap'))*180,0,1)
        wr=np.clip(.34-.18*hollows-.15*tops+.016*grain,.09,.39)
        save(wet,name+'_wet_albedo');save(wr*255,name+'_wet_roughness')
    # Linear-light directional illumination, 18-degree sun and broad sky fill.
    L=np.array([-.72,.62,.325]);L/=np.linalg.norm(L)
    V=np.array([0,0,1]); halfway=(L+V)/np.linalg.norm(L+V)
    diffuse=np.maximum(norm@L,0)
    spec=np.maximum(norm@halfway,0)**(12+100*(1-rough))*(1-rough)*.3
    linear=(c/255)**2.2
    lit=linear*(.28*ao[...,None]+1.3*diffuse[...,None])+spec[...,None]
    save(np.clip(lit,0,1)**(1/2.2)*255,'preview_'+name)
    thumb=Image.open(OUT/(name+'_albedo.png')).resize((512,512),Image.Resampling.LANCZOS)
    tiled=Image.new('RGB',(2048,2048))
    for y in range(4):
        for x in range(4): tiled.paste(thumb,(x*512,y*512))
    tiled.save(OUT/('tiling_4x4_'+name+'.png'))
    # Wrap discontinuities compared with ordinary adjacent texels: must be same order.
    metrics={}
    for suffix in ['albedo','height','normal','roughness','ao']:
        a=np.asarray(Image.open(OUT/(name+'_'+suffix+'.png')),dtype=float)
        wrap=(np.mean(abs(a[0]-a[-1]))+np.mean(abs(a[:,0]-a[:,-1])))/2
        inside=(np.mean(abs(np.diff(a,axis=0)))+np.mean(abs(np.diff(a,axis=1))))/2
        metrics[suffix]=round(float(wrap/max(inside,1e-8)),3)
    REPORT[name]={'height_min_metres':lo,'height_range_metres':hi-lo,'height_peak_to_peak_mm':round((hi-lo)*1000,2),'water_coverage_percent':round(float(water.mean()*100),2),'seam_to_interior_gradient_ratio':metrics}
    (OUT/'validation.json').write_text(json.dumps(REPORT,indent=2))
    print(name,REPORT[name],flush=True)

if __name__=='__main__':
    names=['dry_earth','pit_soil','wet_mud','grave_soil','yard_dirt']
    for i,name in enumerate(names): make(name,1873+i*109)
    alb=[n+'_albedo' for n in names]+[n+'_wet_albedo' for n in ['dry_earth','pit_soil','yard_dirt']]
    sheet=Image.new('RGB',(2048,1152),(27,27,26)); draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',23)
    for i,name in enumerate(alb):
        tile=Image.open(OUT/(name+'.png')).resize((256,256),Image.Resampling.LANCZOS)
        x=(i%4)*512;y=(i//4)*576
        for dy in range(2):
            for dx in range(2):sheet.paste(tile,(x+dx*256,y+dy*256+48))
        draw.text((x+12,y+10),name,fill=(218,216,208),font=font)
    sheet.save(OUT/'contact_sheet.png')

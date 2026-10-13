"""Deterministic feather barbs, fur fibres, horn ridges and bare scales, aligned to the anatomical UV tiles."""
import math
from pathlib import Path
import numpy as np

_sources={}


def source_tiles(family):
    if family in _sources:return _sources[family]
    # Source photographs are original imagegen material sheets, retained with their prompts and hashes.
    import bpy
    path=Path(__file__).resolve().parents[3]/'smalllife/pictures'/ (family+'-source.png')
    image=bpy.data.images.load(str(path),check_existing=True)
    width,height=image.size;pixels=np.empty(width*height*4,np.float32)
    image.pixels.foreach_get(pixels);pixels=np.flipud(pixels.reshape(height,width,4))[...,:3]
    tiles=[]
    for row in range(2):
        for col in range(2):
            field=pixels[row*height//2:(row+1)*height//2,col*width//2:(col+1)*width//2]
            # Pixel-area reduction to the 256 px UV cell; do not alias the original hair/barb detail.
            yy=np.linspace(0,field.shape[0],257).astype(int);xx=np.linspace(0,field.shape[1],257).astype(int)
            out=np.empty((256,256,3),np.float32)
            for y in range(256):
                for x in range(256):out[y,x]=field[yy[y]:yy[y+1],xx[x]:xx[x+1]].mean(axis=(0,1))
            tiles.append(out)
    _sources[family]=tiles
    return tiles

COATS={'hen':(.46,.24,.105),'cockerel':(.36,.135,.046),'goat':(.60,.53,.43),
       'duck_mallard':(.43,.43,.39),'duck_female':(.43,.32,.20),'duck_young':(.57,.43,.18),
       'swan':(.84,.82,.77),'swan_young':(.49,.46,.42),'goose':(.56,.51,.44),
       'squirrel':(.44,.16,.053),'songbird':(.34,.25,.13),'pigeon':(.40,.43,.48),
       'sparrow':(.41,.28,.16),'jackdaw':(.11,.12,.13),'crow':(.067,.075,.083),'rat':(.26,.22,.18)}


def pictures(kind):
    size=1024;tile=256
    col=np.zeros((size,size,3),np.float32);height=np.zeros((size,size),np.float32)
    y,x=np.mgrid[:tile,:tile]/(tile-1)
    rng=np.random.default_rng(1873)
    bird=kind not in ('goat','squirrel','rat')
    for n in range(16):
        base=np.array(COATS[kind])
        if n in (6,8):base=np.array((.63,.39,.09) if bird else (.40,.28,.21))
        if n==6 and kind in ('crow','jackdaw'):base=np.array((.06,.065,.06))
        if n==6 and kind=='pigeon':base=np.array((.18,.16,.17))
        if n==6 and kind in ('sparrow','songbird'):base=np.array((.38,.28,.15))
        if n==8 and kind=='pigeon':base=np.array((.53,.21,.20))
        if n==8 and kind in ('crow','jackdaw'):base=np.array((.12,.12,.11))
        if n==8 and kind.startswith('swan'):base=np.array((.06,.06,.055))
        if n==8 and kind in ('sparrow','songbird'):base=np.array((.36,.28,.22))
        if n==7:base=np.array((.008,.006,.004))
        if n==9:base=np.array((.54,.035,.025) if kind in ('hen','cockerel') else (.39,.23,.20))
        if n==10:base=np.array((.40,.27,.20))
        if n==11:base=np.array((.31,.29,.25))
        if n==12:base=np.array((.095,.082,.064))
        if n==13:base=np.array((.65,.60,.48))
        if n==14:base=np.array((.58,.38,.10))
        if n==15:base=np.array((.79,.77,.70))
        if kind=='cockerel' and n==4:base=np.array((.035,.09,.061))
        if kind=='cockerel' and n==2:base=np.array((.13,.065,.035))
        if kind=='cockerel' and n==1:base=np.array((.53,.28,.055))
        if n==1 and kind=='duck_mallard':base=np.array((.035,.19,.105))
        if n==1 and kind=='jackdaw':base=np.array((.23,.23,.23))
        if n==0 and kind in ('pigeon','goose'):base*=1.16
        noise=rng.normal(0,.018,(tile,tile))
        h=noise*.18
        shade=np.ones_like(x)
        if n<6 and bird:
            # Rows of contour feathers on body/head; flight feathers have a single central rachis.
            if n in (2,4):
                centre=.5
                barb=np.sin((y*65+np.abs(x-centre)*28)*np.pi*2)
                rachis=np.exp(-((x-centre)*95)**2)
                h=.08*barb+.25*rachis
                shade=.94+.045*barb+.09*rachis-.09*np.abs(x-.5)
                shade*=1-.17*np.exp(-((y-.88)*25)**2)
                if kind in ('pigeon','duck_mallard') and n==2:
                    shade*=1-.65*(np.exp(-((y-.63)*23)**2)+np.exp(-((y-.76)*23)**2))
            else:
                rows=10 if n!=1 else 14
                cellY=np.mod(y*rows,1);cellX=np.mod(x*8+np.floor(y*rows)%2*.5,1)
                edge=np.abs(cellX-.5)*1.3+cellY*.65
                rim=np.exp(-((edge-.65)*22)**2)
                barbs=np.sin((cellY*12+np.abs(cellX-.5)*9)*np.pi*2)
                h=.09*rim+.025*barbs
                shade=.98-.065*rim+.035*barbs+.025*cellY
                if kind in ('hen','duck_female','sparrow','songbird'):
                    shade-=.18*np.exp(-((cellX-.5)*8)**2)*np.exp(-((cellY-.6)*6)**2)
        elif n<6 or n==10:
            # Thousands of overlapping short hairs with irregular pigment/clumping, avoiding corrugated stripes.
            h=np.zeros_like(x);shade=np.ones_like(x)*.98
            field=rng.normal(0,.035,(16,16));sx=np.linspace(0,15,tile)
            field=np.array([np.interp(sx,np.arange(16),r) for r in field])
            field=np.array([np.interp(sx,np.arange(16),r) for r in field.T]).T
            shade+=field
            for hair in range(2800):
                px=rng.uniform(0,tile);py=rng.integers(0,tile);length=rng.integers(5,26)
                pigment=rng.uniform(-.065,.04);rise=rng.uniform(.014,.048);bend=rng.uniform(-3,3)
                for j in range(length):
                    yy=(py+j)%tile;xx=int(px+bend*(j/length)**2)%tile
                    shade[yy,xx]+=pigment;h[yy,xx]+=rise*math.sin(math.pi*j/length)
            if kind=='rat' and n==4:
                h=.14*np.cos(y*70*np.pi*2);shade=.89+.10*np.cos(y*70*np.pi*2)
        elif n in (6,8,11,12):
            cells=np.cos(x*16*np.pi*2)*np.cos(y*22*np.pi*2)
            h=.05*cells;shade=.96+.08*cells
        if n<6 and not(kind=='rat' and n==4):
            family='feather' if bird else 'fur'
            index=(1 if n in (2,4) else 2 if n==1 else 3 if kind in ('swan','swan_young') else 0) if bird else \
                (1 if kind=='goat' else 0 if kind=='rat' else 2 if n==4 else 3)
            photo=source_tiles(family)[index]
            # Short coat and neck down must read at fibre scale, not as centimetre-wide clumps.
            repeat=4 if kind=='goat' else 2 if n in (0,1,3,5) else 1
            if repeat>1:
                small=photo.reshape(tile//repeat,repeat,tile//repeat,repeat,3).mean(axis=(1,3))
                photo=np.tile(small,(repeat,repeat,1))
            luma=photo.mean(axis=-1);mean=max(float(luma.mean()),.001)
            pigment=np.clip(luma/mean,.40,1.65)
            patch=base[None,None,:]*pigment[...,None]*(.85+.15*np.clip(shade[...,None],.5,1.5))
            h=.23*(luma-luma.mean())+.08*h
        else:patch=base[None,None,:]*np.clip(shade[...,None]+noise[...,None],.25,1.4)
        row,col_=divmod(n,4)
        col[row*tile:(row+1)*tile,col_*tile:(col_+1)*tile]=np.clip(patch,0,1)
        height[row*tile:(row+1)*tile,col_*tile:(col_+1)*tile]=h
    dy,dx=np.gradient(height)
    normal=np.stack([-dx*2.5,dy*2.5,np.ones_like(dx)],-1)
    normal/=np.linalg.norm(normal,axis=-1)[...,None]
    return col,(normal+1)*.5

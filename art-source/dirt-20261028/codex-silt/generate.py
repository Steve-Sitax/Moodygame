from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt
from scipy.spatial import cKDTree
import json
P=Path(__file__).parent
N=2048
rng=np.random.default_rng(1873)
y,x=np.mgrid[:N,:N].astype(np.float32)
def noise(s):
 a=gaussian_filter(rng.normal(size=(N,N)).astype(np.float32),s,mode='wrap'); return a/(a.std()+1e-9)
def smooth(a,s): return gaussian_filter(a,s,mode='wrap')
def ss(a): return np.clip(a,0,1)**2*(3-2*np.clip(a,0,1))
def save(name,a):
 Image.fromarray(np.round(np.clip(a,0,1)*255).astype('uint8')).save(P/name)
def line(canvas,pts,width):
 d=ImageDraw.Draw(canvas)
 for dx in [-N,0,N]:
  for dy in [-N,0,N]: d.line([(int(a+dx),int(b+dy)) for a,b in pts],fill=255,width=width,joint='curve')
def stamp(field,cx,cy,rx,ry,ang,amp,kind='bump'):
 r=int(max(rx,ry)*1.6+6); yy,xx=np.mgrid[-r:r+1,-r:r+1]; u=xx*np.cos(ang)+yy*np.sin(ang);v=-xx*np.sin(ang)+yy*np.cos(ang)
 q=(u/rx)**2+(v/ry)**2
 v=ss(1-q)*amp
 iy=(np.arange(-r,r+1)+int(cy))%N;ix=(np.arange(-r,r+1)+int(cx))%N
 field[np.ix_(iy,ix)]+=v
broad=noise(67); medium=noise(52); small=noise(12); fine=noise(1.3)
# Continuous toroidal drainage: curved trunks and merging tributaries, not sand waves.
can=Image.new('L',(N,N)); branches=Image.new('L',(N,N))
for j,base in enumerate([80,348,667,934,1260,1558,1850]):
 def center(t): return base+68*np.sin(2*np.pi*t/N+j*1.9)+38*np.sin(6*np.pi*t/N+j*.6)+19*np.sin(12*np.pi*t/N+j*2.7)
 t=np.linspace(-N,2*N,500)
 line(can,list(zip(center(t),t)),rng.integers(4,9).item())
 for k in range(9):
  end=rng.uniform(0,N); length=rng.uniform(90,300); side=(-1)**k
  t=np.linspace(0,1,120); yy=end-length*(1-t); xx=center(yy)+side*rng.uniform(60,160)*(1-t)**1.45+12*np.sin(t*np.pi*2)*(1-t)
  line(branches,list(zip(xx,yy)),int(rng.integers(3,7)))
tr=np.array(can,dtype=np.float32)/255; br=np.array(branches,dtype=np.float32)/255
channels=smooth(tr,18)*6+smooth(br,10)*2.8
h=.0011*broad+.00045*medium+.000065*small+.000012*fine-.0016*channels
# Soft sole impressions, no modern tread. A few unobtrusive partial impressions.
prints=np.zeros_like(h)
for cx,cy,a in [(515,430,.34),(672,821,.25),(1470,1390,-.5)]:
 stamp(prints,cx,cy,42,86,a,1)
 stamp(prints,cx-16*np.sin(a),cy+85*np.cos(a),30,25,a,.8)
h-=.00065*prints
# Three-toed shorebird tracks, shallow and softened by tidal slump.
can=Image.new('L',(N,N))
for cx,cy,a in [(1140,250,.4),(1195,355,.3),(1147,463,.5),(1255,576,.4),(180,1490,-.6)]:
 for off in [-.7,0,.7]:
  aa=a+off;line(can,[(cx,cy),(cx+np.sin(aa)*24,cy-np.cos(aa)*24)],2)
tracks=smooth(np.array(can,dtype=np.float32)/255,1.6);h-=tracks*.00055
# Tiny shell/coal flakes and embedded organic fragments, coherent across maps.
debris=np.zeros((N,N,3),np.float32);coverage=np.zeros_like(h); relief=np.zeros_like(h)
for i in range(390):
 cx,cy=rng.uniform(0,N,2); r=rng.uniform(.8,3.6);ang=rng.uniform(0,6.28)
 a=np.zeros((19,19),np.float32); yy,xx=np.mgrid[-9:10,-9:10];u=xx*np.cos(ang)+yy*np.sin(ang);v=-xx*np.sin(ang)+yy*np.cos(ang)
 q=(u/r)**2+(v/(r*rng.uniform(.35,.85)))**2;m=ss((1-q)*2)
 iy=(np.arange(-9,10)+int(cy))%N;ix=(np.arange(-9,10)+int(cx))%N;ind=np.ix_(iy,ix)
 col=np.array([99,95,81] if i%3 else [38,39,35]);debris[ind]+=m[:,:,None]*col;coverage[ind]+=m;relief[ind]+=m*.00025
for i in range(17):
 cx,cy=rng.uniform(0,N,2);a=rng.uniform(0,6.28);r=rng.uniform(10,30)
 c=Image.new('L',(N,N));line(c,[(cx,cy),(cx+r*np.cos(a),cy+r*np.sin(a))],int(rng.integers(1,4)))
 m=smooth(np.array(c,dtype=np.float32)/255,.7);debris+=m[:,:,None]*np.array([62,57,43]);coverage+=m;relief+=m*.0003
coverage=np.clip(coverage,0,1);h+=relief
# Exposed-crest hairline polygonal cracks; warp prevents straight Voronoi look.
pts=rng.uniform(0,N,(95,2));tree=cKDTree(pts,boxsize=N)
wx=(x+noise(35)*11)%N;wy=(y+noise(40)*11)%N
d,_=tree.query(np.stack([wx.ravel(),wy.ravel()],axis=1),k=2);gap=(d[:,1]-d[:,0]).reshape(N,N)
crest=ss((h-np.percentile(h,48))/.0015)*ss((noise(110)+.5)/1.5)
cracks=np.exp(-(gap/1.15)**2).astype(np.float32)*crest
level=float(np.percentile(h,26));drylevel=float(np.percentile(h,0.12))
results={};stats={}
for name,dry in [('tidal_silt',False),('tidal_silt_drier',True)]:
 ground=h-(cracks*.00035 if dry else 0); lev=drylevel if dry else level
 wm=ss((lev-ground)/.00030);surf=np.maximum(ground,lev)
 height=(surf+.025)/.05
 Image.fromarray(np.round(np.clip(height,0,1)*65535).astype('uint16')).save(P/f'{name}_height.png')
 # Derive normals from the actual quantized displacement, physical metres; +V points up image.
 surf=np.round(height*65535)/65535*.05-.025
 dx=(np.roll(surf,-1,1)-np.roll(surf,1,1))/(4/N);dy=(np.roll(surf,-1,0)-np.roll(surf,1,0))/(4/N)
 norm=np.stack([-dx,dy,np.ones_like(h)],axis=-1);norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
 norm[wm>.999]=[0,0,1]
 tone=68+3*np.tanh(broad*.5)+2*np.tanh(medium*.6)+1.4*small+.9*fine
 tone-=7*ss((level+.001-ground)/.002)
 if dry: tone+=12; tone-=cracks*12
 col=np.stack([tone+3,tone+1,tone-5],axis=-1)
 col=col*(1-coverage[:,:,None])+debris
 col=col*(1-wm[:,:,None]*.35)+np.array([38,40,35])*wm[:,:,None]*.35
 col=np.clip(col,35,120)/255
 r=(.43+.045*np.tanh(medium)+.02*small if dry else .33+.035*np.tanh((ground-level)/.003)+.012*small)
 r=np.clip(r,.34 if dry else .25,.53 if dry else .45);r=r*(1-wm)+.05*wm
 ao=np.clip(1-np.maximum(smooth(ground,10)-ground,0)*26-np.maximum(smooth(ground,40)-ground,0)*9,.82,1);ao=ao*(1-wm)+wm
 for suffix,a in [('albedo',col),('normal',norm*.5+.5),('roughness',r),('ao',ao),('water_mask',wm)]:save(f'{name}_{suffix}.png',a)
 results[name]=(col,norm,r,ao,wm)
 stats[name]={'standing_water_percent':float((wm>.5).mean()*100),'height_min_max_mm':[float(surf.min()*1000),float(surf.max()*1000)],'albedo_range':[int(col.min()*255),int(col.max()*255)],'roughness_range':[float(r.min()),float(r.max())],'flat_water_height_codes':int(len(np.unique(np.round(height[wm>.999]*65535))))}
 print(name,stats[name],flush=True)
# CPU physically based material preview, low sun reflected by the surface. No baked lighting in albedo.
def unit(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-8)
def render(name,overhead=False):
 col,norm,r,ao,wm=results[name];W,H=(1200,1200) if overhead else (1500,1050)
 yy,xx=np.mgrid[:H,:W].astype(np.float32);xx=(xx-W/2)/W;yy=(yy-H/2)/W
 if overhead:
  u=(xx+.5)*N;v=(yy+.5)*N;V=np.zeros((H,W,3),np.float32)+np.array([0,-.90,.436]);V=unit(V)
 else:
  cam=np.array([1,-1.05,1.23]);target=np.array([1,1.05,0]);fw=unit(target-cam);right=np.array([1,0,0]);up=np.cross(right,fw)
  ray=unit(fw+xx[:,:,None]*right*1.12-yy[:,:,None]*up*1.12)
  pos=cam+ray*(-cam[2]/ray[:,:,2])[:,:,None];u=pos[:,:,0]*N/2;v=pos[:,:,1]*N/2;V=-ray
 coords=np.array([v,u])
 def sample(a):
  if a.ndim==2:return map_coordinates(a,coords,order=1,mode='grid-wrap')
  return np.stack([sample(a[:,:,i]) for i in range(3)],axis=-1)
 al=sample(col);n=sample(norm);n[:,:,1]*=-1;n=unit(n);rough=sample(r);occ=sample(ao);water=sample(wm)
 L=unit(np.array([-.17,.92,.355]));half=unit(V+L)
 nl=np.maximum(np.sum(n*L,axis=-1),.001);nv=np.maximum(np.sum(n*V,axis=-1),.001);nh=np.maximum(np.sum(n*half,axis=-1),0);vh=np.maximum(np.sum(V*half,axis=-1),0)
 alpha=np.maximum(rough**2,.035);a2=alpha**2;D=a2/(np.pi*(nh**2*(a2-1)+1)**2)
 k=(rough+1)**2/8;G=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k));F=.035+.965*(1-vh)**5
 spec=D*G*F/(4*nv*nl+.00001)
 lin=np.where(al<=.04045,al/12.92,((al+.055)/1.055)**2.4)
 refl=2*np.sum(n*V,axis=-1)[:,:,None]*n-V
 sky=.35+.3*np.clip(refl[:,:,2],0,1)
 cloud=.8+.2*np.sin(refl[:,:,0]*9+refl[:,:,1]*5)*np.sin(refl[:,:,1]*13)
 fres=.025+.975*(1-nv)**5
 light=lin*(.8*occ[:,:,None]+nl[:,:,None]*1.7*np.array([1.08,1.01,.9]))
 light+=spec[:,:,None]*nl[:,:,None]*np.array([1.12,1.04,.9])*1.7
 light+=((fres*sky*cloud)*(1-rough*.75))[:,:,None]*np.array([.68,.78,.87])
 light=light/(1+light*.6);out=np.where(light<=.0031308,light*12.92,1.055*np.maximum(light,0)**(1/2.4)-.055)
 save(('top_' if overhead else 'preview_')+name+'.png',out)
for name in results:render(name);render(name,True)
# Unlabelled delivery sheets: README gives the row / column keys.
contact=Image.new('RGB',(6*400,2*400))
for row,name in enumerate(results):
 for j,suffix in enumerate(['albedo','height','normal','roughness','ao','water_mask']):
  im=Image.open(P/f'{name}_{suffix}.png')
  if suffix=='height': im=Image.fromarray((np.array(im)/257).astype('uint8'))
  contact.paste(im.convert('RGB').resize((400,400),Image.Resampling.LANCZOS),(j*400,row*400))
contact.save(P/'contact_sheet.png')
for name in results:
 im=Image.open(P/f'top_{name}.png').resize((512,512),Image.Resampling.LANCZOS);sheet=Image.new('RGB',(2048,2048))
 for j in range(4):
  for i in range(4):sheet.paste(im,(i*512,j*512))
 sheet.save(P/f'tiling_4x4_{name}.png')
# Check all map formats, toroidal boundary steps versus ordinary neighbouring pixels.
for name in results:
 stats[name]['maps']={}
 for suffix in ['albedo','height','normal','roughness','ao','water_mask']:
  im=Image.open(P/f'{name}_{suffix}.png');a=np.array(im).astype(float)
  edge=float((np.abs(a[0]-a[-1]).mean()+np.abs(a[:,0]-a[:,-1]).mean())/2)
  interior=float((np.abs(np.diff(a,axis=0)).mean()+np.abs(np.diff(a,axis=1)).mean())/2)
  stats[name]['maps'][suffix]={'size':list(im.size),'mode':im.mode,'boundary_step_mean':edge,'interior_step_mean':interior}
(P/'validation.json').write_text(json.dumps(stats,indent=2))
print('Complete',flush=True)

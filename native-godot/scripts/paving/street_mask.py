# H5: the visible street paving (5 cm): ground mesh area, not under a permanent structure, open ground on the walk map.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

g=json.load(open(W+'grid.json')); X0,Z0,R,NX,NZ=g['X0'],g['Z0'],g['R'],g['NX'],g['NZ']
occ=np.load(W+'occ.npy')>0
# small isolated bits (gully frames, posts): under 0.6 m2 and not touching a big structure
lab,n=ndi.label(occ); sizes=ndi.sum(occ,lab,range(1,n+1))*R*R
small=np.isin(lab,np.nonzero(sizes<0.6)[0]+1)
occ2=occ&~small
city=json.load(open(ROOT+'/native-godot/world/data/shared/city.json'))['walk']
wk=np.asarray(Image.open(ROOT+'/native-godot/world/data/public/city/walk.png').convert('RGB')).astype(int)
free=(wk[:,:,0]<128)&(wk[:,:,1]<128)&(wk[:,:,2]<128)   # rows x, cols z
# to this grid: cell (r=z, c=x) centre -> walk pixel
cx=X0+(np.arange(NX)+0.5)*R; cz=Z0+(np.arange(NZ)+0.5)*R
wi=np.clip(((cx-city['x0'])/city['res']).astype(int),0,wk.shape[0]-1); wj=np.clip(((cz-city['z0'])/city['res']).astype(int),0,wk.shape[1]-1)
fr=free[wi[None,:],wj[:,None]]
fr=ndi.binary_dilation(fr,iterations=8)  # 0.4 m
out={}
for name in ['ground_cobble','ground_flags','ground_quay']:
    m=np.load(W+name+'.npy')>0
    s=m&~occ2&fr
    lab,n=ndi.label(s); sizes=ndi.sum(s,lab,range(1,n+1))*R*R
    s=np.isin(lab,np.nonzero(sizes>=2.0)[0]+1)
    np.save(W+name+'-street.npy',s)
    out[name]=float(s.sum()*R*R)
    print(name,'street area',out[name],'components',int((sizes>=2).sum()))
np.save(W+'occ2.npy',occ2)
s=np.load(W+'ground_cobble-street.npy'); f=np.load(W+'ground_flags-street.npy'); q=np.load(W+'ground_quay-street.npy')
small=lambda a: a[::10,::10]
im=np.zeros(small(s).shape+(3,),np.uint8); im[small(occ2)]=(200,50,50); im[small(s)]=(150,150,150); im[small(f)]=(200,170,110); im[small(q)]=(90,120,170)
Image.fromarray(im).save(W+'street-mask.png')

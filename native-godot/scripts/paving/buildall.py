
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import sys, pickle, time, json, os, numpy as np
import layout as L, mesher as M
kind=sys.argv[1]; out=sys.argv[2]; os.makedirs(out,exist_ok=True)
names={'cobble':'ground_cobble','flags':'ground_flags','quay':'ground_quay'}
lay=pickle.load(open(L.W+f'lay-{kind}.pkl','rb'))
rows=np.fromfile(W+f'dump/{names[kind]}-0.f32',dtype=np.float32).reshape(-1,16)
T,Lb,uv,y0,G=M.build(lay,rows)
r=M.rows_of(T,uv,y0)
r.tofile(os.path.join(out,names[kind]+'.f32'))
np.save(os.path.join(out,names[kind]+'-labels.npy'),Lb)
print('rows',len(r),'triangles',len(T),'hidden',int((Lb==-1).sum()),'band',int((Lb>=1e6).sum()),'field',int(((Lb>=0)&(Lb<1e6)).sum()))

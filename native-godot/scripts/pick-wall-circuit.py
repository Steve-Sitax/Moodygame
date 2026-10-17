"""Ray-pick exported candidate triangles at a proof image pixel; geometry inspection only."""
import json,numpy as np,pathlib,sys
p=pathlib.Path('native-godot/proof/wall-circuit');m=json.loads((p/'mesh-manifest.json').read_text());v=next(v for v in json.loads((p/'coverage.json').read_text())['views'] if v['name']==sys.argv[1]);eye=np.array(v['eye']);f=np.array(v['target'])-eye;f/=np.linalg.norm(f);right=np.cross(f,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,f)
for rec in json.loads((p/'audit.json').read_text()):
 if rec['mesh'] not in m:m[rec['mesh']]=[dict(s,file='../source/'+s['file']) for s in rec['surfaces']]
x,y=map(float,sys.argv[2:4]);d=f+right*(2*(x+.5)/1440-1)*np.tan(np.radians(34))*1.6+up*(1-2*(y+.5)/900)*np.tan(np.radians(34));d/=np.linalg.norm(d);hits=[]
for resource,rec in m.items():
 for surf in rec:
  a=np.fromfile(p/'geometry'/surf['file'],np.float32).reshape(-1,3,16);pos=a[:,:,:3];e1=pos[:,1]-pos[:,0];e2=pos[:,2]-pos[:,0];h=np.cross(d,e2);det=(e1*h).sum(1);valid=np.abs(det)>1e-10;inv=np.zeros_like(det);inv[valid]=1/det[valid];s=eye-pos[:,0];u=inv*(s*h).sum(1);q=np.cross(s,e1);vv=inv*(q*d).sum(1);t=inv*(e2*q).sum(1);idx=np.where(valid&(u>=0)&(vv>=0)&(u+vv<=1)&(t>0))[0]
  for k in idx:hits.append((float(t[k]),surf['file'],int(k),surf['material'],(eye+t[k]*d).tolist(),a[k,0,3:6].tolist(),a[k,:,10:14].tolist()))
print(*sorted(hits)[:10],sep='\n')

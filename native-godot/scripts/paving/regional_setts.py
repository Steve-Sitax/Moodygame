"""#199 original gate, rail-strip and Sint-Jansplein layouts; geometry/height remain exact.
python regional_setts.py <landmark audit> <regional audit> <candidate>
"""
import json,pathlib,sys
import numpy as np
import shapely

def round_square(rows, road):
    """Courses follow the circular kerb. Integer repeats close the one angular seam."""
    r=rows.reshape(-1,3,16).copy();p=r[:,:,[0,2]]-np.array([20.,296.])
    radius=np.linalg.norm(p,axis=2);theta=np.arctan2(p[:,:,1],p[:,:,0])
    theta=np.unwrap(theta,axis=1)
    tile=2.5 if road else 4.
    repeats=max(1,round(2*np.pi*np.median(radius)/tile))
    across=(radius-radius.min())/tile;along=theta/(2*np.pi)*repeats
    r[:,:,6]=across if road else along;r[:,:,7]=along if road else across
    return r.reshape(-1,16)

def railway(rows):
    """Original UV chart gives each strip's direction; use metric width instead of stretching 2.2 m to 2.5 m."""
    r=rows.reshape(-1,3,16).copy()
    for tri in r:
        p=tri[:,[0,2]].copy();old=tri[:,6:8].copy()
        du=old[1:]-old[0]
        if abs(np.linalg.det(du))<1e-9:continue
        basis=np.linalg.solve(du,p[1:]-p[0])
        along=basis[0]/np.linalg.norm(basis[0]);across=basis[1]/np.linalg.norm(basis[1])
        tri[:,6]=old[:,1]*np.linalg.norm(basis[1])/2.5
        tri[:,7]=p@along/2.5
    return r.reshape(-1,16)

def gate(rows):
    r=rows.reshape(-1,3,16).copy()
    flat=r[:,:,4].mean(axis=1)>.9
    p=r[flat,:,:3][:,:,[0,2]].reshape(-1,2)
    box=shapely.minimum_rotated_rectangle(shapely.MultiPoint(p));corners=np.asarray(box.exterior.coords)
    delta=np.diff(corners,axis=0);i=np.argmax(np.linalg.norm(delta,axis=1))
    along=delta[i]/np.linalg.norm(delta[i]);across=np.array([-along[1],along[0]])
    if along[0]<0:along=-along;across=-across
    # Passage thresholds start a complete row, border joints start at its actual side.
    u=p@across;v=p@along
    uv=np.column_stack([(u-u.min())/2.4,(v-v.min())/2.4])
    r[flat,:,6:8]=uv.reshape(-1,3,2)
    return r.reshape(-1,16)

def main():
    audits=[pathlib.Path(x) for x in sys.argv[1:3]];out=pathlib.Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
    entries=[];report=[]
    for audit in audits:
        for rec in json.load(open(audit/'audit.json')):
            name=rec['nodePath'];fn=None
            if name.startswith('town_wall/gate_') and name.endswith('_5'):fn=gate
            if name=='tracks/track_setts':fn=railway
            if name=='townplaces/place_rond/rond_road':fn=lambda r:round_square(r,True)
            if name=='townplaces/place_rond/rond_pavement':fn=lambda r:round_square(r,False)
            if fn is None:continue
            surfaces=[]
            for s in rec['surfaces']:
                old=np.fromfile(audit/'source'/s['file'],dtype=np.float32).reshape(-1,16)
                new=fn(old)
                assert np.array_equal(old[:,:6],new[:,:6]) and np.isfinite(new).all()
                new.tofile(out/s['file'])
                surfaces.append({k:s[k] for k in ['index','file','material','custom0']})
                report.append({'node':name,'triangles':len(new)//3,'positionsNormalsUnchanged':True})
            entries.append({'mesh':rec['mesh'],'nodePath':name,'sourceHash':rec['meshHash'],'surfaces':surfaces})
    (out/'manifest.json').write_text(json.dumps({'surfaceRepairs':entries},indent=2))
    (out/'geometry-report.json').write_text(json.dumps(report,indent=2))
    print(report)

if __name__=='__main__':main()

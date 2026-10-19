"""#171 landmark arrises, preserving the original stone material and UVs.
Blender -b -P repair-stone-corners.py -- --landmarks <audit> <candidate>.
Input: audit-stone-corners.gd --out <audit> --materials <explicit resource list>.
Output: surfaceRepairs manifest for stone-corners-promote; no runtime or scene changes.
"""
import json, math, pathlib, sys
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

STONE = {'church_stone', 'carolus_blue', 'carolus_pale', 'carolus_sand',
         'pj_white', 'pj_brabant', 'pr_blue', 'pl_stone', 'calvary_stone', 'park_stone'}

def components(rows):
    """Connected stones by coincident corners; retain the source's triangle winding."""
    parent = list(range(len(rows)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    seen = {}
    for i, tri in enumerate(rows):
        for p in tri[:, :3]:
            key = tuple(np.round(p, 5))
            if key in seen: parent[root(i)] = root(seen[key])
            else: seen[key] = i
    groups = {}
    for i in range(len(rows)): groups.setdefault(root(i), []).append(i)
    return groups.values()

def repair(part, radius=None, segments=3):
    bm = bmesh.new(); verts = {}; source = []
    for tri in part:
        if np.linalg.norm(np.cross(tri[1,:3]-tri[0,:3],tri[2,:3]-tri[0,:3])) < 1e-9: continue
        vs = []
        for row in tri:
            key = tuple(float(x) for x in np.round(row[:3], 5))
            if key not in verts: verts[key] = bm.verts.new(key)
            vs.append(verts[key])
        if len(set(vs)) != 3: continue
        try: f = bm.faces.new(vs)
        except ValueError: continue
        source.append(tri)
    bm.normal_update()
    sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(38) and e.calc_length() > .025]
    if not sharp: bm.free(); return part.reshape(-1,16), 0, 0
    # No rounding of a seam's exposed boundary: an open sheet cannot safely be turned into a solid.
    # Closed stone arrises 8 mm; exposed low stair/cap tops 12 mm, constrained by the original stone's thickness.
    if radius is None: radius = .012 if part[:,:,1].max() < .8 else .008
    is_bevel = bm.faces.layers.int.new('arris')
    result = bmesh.ops.bevel(bm, geom=sharp, offset=radius, segments=segments, profile=.5,
                            affect='EDGES', clamp_overlap=True)
    for f in result['faces']: f[is_bevel] = 1
    bm.normal_update()
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    orig = np.asarray(source)
    bv = BVHTree.FromPolygons([Vector(p) for p in orig[:,:,:3].reshape(-1,3)],
                              [(3*i,3*i+1,3*i+2) for i in range(len(orig))], all_triangles=True)
    output = []; fixed = 0
    # Typical texel scale, used only for degenerate source UV charts on narrow returns.
    edge = orig[:,1,:3]-orig[:,0,:3]; uv_edge = orig[:,1,6:8]-orig[:,0,6:8]
    rates = np.linalg.norm(uv_edge,axis=1)/np.maximum(np.linalg.norm(edge,axis=1),1e-8)
    rates = rates[(rates>.1)&(rates<8)]
    scale = float(np.median(rates)) if len(rates) else 1/1.2
    for f in bm.faces:
        if f.calc_area() < 1e-10: continue
        p, _, j, _ = bv.find_nearest(f.calc_center_median())
        if j is None: raise RuntimeError('No original face')
        tri = orig[j]; a,b,c = [Vector(q) for q in tri[:,:3]]
        # Preserve source colour, secondary UVs and custom channels by barycentric interpolation.
        rr = []
        for v in f.verts:
            w = np.asarray(barycentric_transform(v.co, a,b,c, Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))))
            if not np.isfinite(w).all(): w = np.array([1.,0.,0.])
            r = w @ tri
            r[:3] = v.co
            if f[is_bevel]: r[3:6] = -f.normal  # Godot's clockwise winding.
            else:
                r[3:6] /= max(np.linalg.norm(r[3:6]), 1e-12)
                # Extrapolating a smooth normal past a very narrow original triangle can turn it inward.
                if np.dot(r[3:6],f.normal)>-.05:r[3:6]=-f.normal
            w_colour=np.clip(w,0,1);w_colour/=max(w_colour.sum(),1e-12)
            r[10:14]=w_colour@tri[:,10:14]
            rr.append(r)
        rr = np.asarray(rr)
        parea = np.linalg.norm(np.cross(rr[1,:3]-rr[0,:3],rr[2,:3]-rr[0,:3]))
        uv = rr[:,6:8]; uvarea = abs(np.linalg.det(np.stack([uv[1]-uv[0],uv[2]-uv[0]])))
        if parea > 1e-9 and uvarea / parea < scale*scale*.04:
            n = np.abs(f.normal); axis = int(np.argmax(n)); axes = [x for x in range(3) if x!=axis]
            rr[:,6:8] = rr[:,axes]*scale; fixed += 1
        output.extend(rr)
    bm.free()
    return np.asarray(output,dtype=np.float32), len(sharp), fixed

def main():
    args=sys.argv[sys.argv.index('--landmarks')+1:]; audit=pathlib.Path(args[0]); out=pathlib.Path(args[1]); out.mkdir(parents=True,exist_ok=True)
    pavements = '--pavements' in args
    repairs=[]; report=[]
    for rec in json.loads((audit/'audit.json').read_text()):
        entry={'mesh':rec['mesh'],'nodePath':rec['nodePath'],'sourceHash':rec['meshHash'],'surfaces':[]}
        for s in rec['surfaces']:
            if not (s['material'].endswith('/r000209.res') if pavements else s['name'] in STONE): continue
            rows=np.fromfile(audit/'source'/s['file'],dtype=np.float32).reshape(-1,3,16)
            new=[]; edges=uvfix=0; pieces=0
            for idx in components(rows):
                if pavements and rows[idx,:,1].max() >= .8:
                    new.append(rows[idx].reshape(-1,16)); continue
                rr,ee,uu=repair(rows[idx]); new.append(rr); edges+=ee; uvfix+=uu; pieces+=bool(ee)
            if not edges: continue
            arr=np.concatenate(new); assert np.isfinite(arr).all()
            tris=arr.reshape(-1,3,16)
            cross=np.cross(tris[:,1,:3]-tris[:,0,:3],tris[:,2,:3]-tris[:,0,:3])
            if not pavements and ((cross*tris[:,:,3:6].mean(1)).sum(1)>1e-7).any():
                raise RuntimeError('Inward normal in '+s['file'])
            filename=s['file']; arr.astype(np.float32).tofile(out/filename)
            entry['surfaces'].append({'index':s['index'],'file':filename,'material':s['material'],'custom0':s['custom0']})
            report.append({'node':rec['nodePath'],'material':s['name'],'stones':pieces,'edges':edges,'uvReturns':uvfix,'before':len(rows),'after':len(arr)//3})
            print(report[-1],flush=True)
        if entry['surfaces']: repairs.append(entry)
    (out/'manifest.json').write_text(json.dumps({'surfaceRepairs':repairs},indent=2))
    (out/'geometry-report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__': main()

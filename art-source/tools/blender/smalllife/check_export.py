"""Inspect the delivered GLBs, pictures and baked palette data, independent of Blender's in-memory report.
Run from the worktree: python art-source/tools/blender/smalllife/check_export.py
"""
import gzip
import hashlib
import json
import struct
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[4]


def glb(path):
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length]);base=28+length
    def accessor(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
        dtype={5126:'<f4',5123:'<u2',5125:'<u4',5121:'u1'}[a['componentType']]
        assert not v.get('byteStride') and 'sparse' not in a
        return np.frombuffer(raw,dtype=dtype,count=a['count']*sizes[a['type']],
                             offset=base+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,sizes[a['type']])
    return doc,accessor


def main():
    root=ROOT/'native-godot/assets/smalllife';kit=json.loads((root/'kit.json').read_text())
    source,read=glb(ROOT/'art-source/client/public/models/smalllife.glb')
    native,nread=glb(ROOT/'.scratch/smalllife-plain/smalllife.glb')
    assert len(source['skins'])==len(kit['kinds'])==16
    assert 'skins' not in native and 'animations' not in native
    animations={a['name'] for a in source['animations']};rows=[]
    for name,k in kit['kinds'].items():
        node=next(n for n in native['nodes'] if n.get('name')==name)
        primitive=native['meshes'][node['mesh']]['primitives'][0];attrs=primitive['attributes']
        v=nread(attrs['POSITION']);n=nread(attrs['NORMAL']);uv=nread(attrs['TEXCOORD_0']);skin=nread(attrs['TEXCOORD_1'])
        indices=nread(primitive['indices']).ravel().reshape(-1,3)
        assert np.isfinite(v).all() and np.isfinite(n).all() and np.isfinite(uv).all()
        assert np.max(abs(np.linalg.norm(n,axis=1)-1))<.001
        area=np.linalg.norm(np.cross(v[indices[:,1]]-v[indices[:,0]],v[indices[:,2]]-v[indices[:,0]]),axis=1)
        assert np.min(area)>0, name+' zero-area triangle'
        # A conservative 16-bit UV quantisation, including the exact integer-boundary regression.
        lo=skin.min(0);span=skin.max(0)-lo
        quant=np.round((skin-lo)/span*65535)/65535*span+lo
        assert np.array_equal(np.floor(skin),np.floor(quant)),name+' quantisation changed a bone'
        w=np.maximum((np.mod(quant,1)-.25)*2,0);w/=w.sum(1)[:,None]
        assert np.min(w)>=0 and np.max(w)<=1
        for clip in k['clips']:assert name+'_'+clip in animations,name+' missing source clip '+clip
        for suffix in ('colour','normal'):
            path=root/(name+'_'+suffix+'.png');data=path.read_bytes()
            assert struct.unpack_from('>II',data,16)==(1024,1024)
            assert hashlib.sha256(data).hexdigest()==kit['pictures'][path.name]
        packed=(root/(name+'_skin.bin')).read_bytes();raw=gzip.decompress(packed);width,height=struct.unpack_from('<II',raw)
        assert width==k['bones']*3 and height==sum(c['frames'] for c in k['clips'].values())
        palette=np.frombuffer(raw[8:],dtype='<f2');assert np.isfinite(palette).all()
        assert len(raw)==8+width*height*16
        assert hashlib.sha256(packed).hexdigest()==k['vatSha256']
        assert k['stanceErrorMm']<.01 and k['jointGapMm']<.01
        rows.append({'kind':name,'vertices':len(v),'triangles':len(indices),'bones':k['bones'],
                     'clips':len(k['clips']),'jointGapMm':k['jointGapMm'],'stanceErrorMm':k['stanceErrorMm']})
    report={'ok':True,'kinds':16,'sourceAnimations':len(animations),'sourceSkins':len(source['skins']),
            'nativeRuntimeHasNoSkeletonsOrClips':True,'rows':rows}
    target=ROOT/'.scratch/smalllife-geometry.json';target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()

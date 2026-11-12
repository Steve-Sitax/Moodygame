"""Repair gate export metadata without changing any geometry, attributes or transforms."""
import hashlib,json,struct
from pathlib import Path

def normalize(folder):
    path=folder/'manifest.json';data=json.loads(path.read_text())
    for m in data['movers'].values():
        if 'open_deg'in m:m['open_rotation_y_deg']=m.pop('open_deg')
    for name,info in data['files'].items():
        if 'collision'not in name:continue
        f=folder/name;raw=f.read_bytes();length,kind=struct.unpack_from('<II',raw,12)
        if kind!=0x4e4f534a:raise ValueError('Missing GLB JSON chunk')
        doc=json.loads(raw[20:20+length]);changed=False
        for node in doc['nodes']:
            for side in('n','s'):
                if node.get('name','').startswith('col_gate_door_'+side+'_') and not node['name'].endswith('_door_'+side):
                    node['name']+='_door_'+side;changed=True
        if changed:
            payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
            rest=raw[20+length:];new=struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),kind)+payload+rest
            # Binary vertex/index chunks are preserved byte-for-byte.
            assert new[20+len(payload):]==rest
            f.write_bytes(new)
        info.update(sha256=hashlib.sha256(f.read_bytes()).hexdigest(),bytes=f.stat().st_size)
    data['metadataSchema']='network-gate-v2'
    path.write_text(json.dumps(data,indent=2)+'\n')

if __name__=='__main__':
    import sys
    for folder in Path(sys.argv[1]).iterdir():
        if (folder/'manifest.json').exists():normalize(folder);print('GATE_METADATA',folder.name)

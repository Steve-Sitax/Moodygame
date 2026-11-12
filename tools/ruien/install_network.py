"""Promote a proven complete native network while retaining original area resources."""
import hashlib,json,re,shutil
from pathlib import Path
from construction import ROOT,load
from native_layout import STAGE

NATIVE=ROOT/'native-godot'
WORLD=NATIVE/'world/ruien'
def data_path(value):return NATIVE/value[6:]if value.startswith('res://')else Path(value)
def sha(path):
    with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def source_digest(areas):
    h=hashlib.sha256()
    for name,project in [('shared-geometry','godot'),('native-geometry','native-godot')]:
        source=ROOT/project/'.godot/mono/temp/obj/Debug/StartupGeometryRevision.g.cs'
        revision=re.search(r'"StartupGeometryCode", "([A-Fa-f0-9]+)"',source.read_text()).group(1)
        h.update((name+'\n'+revision+'\n').encode())
    files=[(STAGE/n).as_posix()for n in('native-conversion-areas.json','connected-entrances.json','network-gates.json','native-drainage.json')]
    files += [a['export']+'/intake-receipt.json'for a in areas['areas']]
    for name in files:
        path=data_path(name)
        if path.exists():h.update((name+'\n').encode());h.update(path.read_bytes())
    return h.hexdigest().upper()
def atomic(path,data):
    temporary=path.with_suffix('.install-tmp');temporary.write_text(json.dumps(data,indent=2)+'\n');temporary.replace(path)
def checked_copy(source,target,expected=None):
    digest=sha(source)
    if expected and digest!=expected.lower():raise ValueError('Changed native asset: '+str(source))
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists()or sha(target)!=digest:shutil.copy2(source,target)
    if sha(target)!=digest:raise IOError('Native copy mismatch: '+str(target))

def main():
    areas=load(STAGE/'native-conversion-areas.json');proof=load(STAGE/'native-network-physics.json')
    if not proof.get('pass')or proof.get('areas')!=167 or proof.get('connectedRooms')!=53:raise ValueError('Full native network physics has not passed')
    if proof.get('inputDigest')!=source_digest(areas):raise ValueError('Native physics proof is for different construction inputs')
    hydraulic=proof.get('drainage',{})
    if hydraulic.get('Entrances')!=26 or hydraulic.get('Heads')!=572 or hydraulic.get('Collectors')!=844 or hydraulic.get('Inlets')!=918 or hydraulic.get('Errors'):
        raise ValueError('Actual entrance foundations and hydraulic interiors have not passed together')
    entries=load(STAGE/'entrance-connections.json')
    if len(entries['connections'])!=24 or entries['failures']or entries.get('held'):raise ValueError('Every planned street entrance must be connected')
    connected=load(STAGE/'connected-entrances.json')['entrances']
    if any(e.get('closure')!='open'for e in connected if e['id']in {c['id']for c in entries['connections']}):raise ValueError('A planned entrance remains closed')
    for name in('path-proof.json','end-proof-actual.json','entrance-path-proof.json','drainage-path-proof.json'):
        if load(STAGE/name)['failures']:raise ValueError('Unresolved proof: '+name)
    if load(STAGE/'gate-network-proof.json')['failures']:raise ValueError('Unresolved gates')
    drain=load(STAGE/'drain-prepared-probe.json')
    if drain['badPoses']or drain['blocked']or drain['boreFits']or drain['inlets']!=918:raise ValueError('Unresolved native drainage')
    if load(STAGE/'drain-clearance-audit.json')['potentialClashes']or load(STAGE/'inlet-clearance-audit.json')['conflicts']:raise ValueError('Unresolved buried clearances')
    burial=load(STAGE/'drain-burial-proof.json')
    native_revision=re.search(r'"StartupGeometryCode", "([A-Fa-f0-9]+)"',(NATIVE/'.godot/mono/temp/obj/Debug/StartupGeometryRevision.g.cs').read_text()).group(1)
    if burial.get('errors')or burial.get('samples',0)<100000 or burial.get('networkSha256')!=sha(STAGE/'native-drainage.json').upper()or burial.get('areasSha256')!=sha(STAGE/'native-conversion-areas.json').upper()or burial.get('nativeGeometryCode')!=native_revision:
        raise ValueError('Native drainage burial proof is incomplete or stale')
    for row in burial['groundInputs']:
        if sha(data_path(row['path'])).upper()!=row['sha256']:raise ValueError('Native ground changed after burial proof: '+row['path'])
    visual=load(STAGE/'network-visual-review.json')
    if not visual.get('pass')or visual.get('inputDigest')!=proof['inputDigest']:raise ValueError('Native visual review is incomplete or stale')
    retained={a['id']:a for a in load(WORLD/'areas.json')['areas']if not a['id'].startswith('network_')}
    if set(retained)!={'o2','r1','r1_l65','r1_l100','r1_l114'}:raise ValueError('Unexpected retained area inventory')
    installed=[]
    for area in areas['areas']:
        if not area['id'].startswith('network_'):continue
        source=Path(area['export']);receipt=load(source/'intake-receipt.json');rid=area['id'][8:]
        target=WORLD/'complete'/rid
        for file,digest in receipt['files'].items():checked_copy(source/file,target/file,digest)
        checked_copy(source/'intake-receipt.json',target/'intake-receipt.json')
        area['export']='res://world/ruien/complete/'+rid
        installed.append(dict(id=area['id'],key=receipt['key']))
    if len(installed)!=162:raise ValueError('Incomplete area inventory')
    for kit in('gate-kit','drain-kit'):
        source=STAGE/'resources'/(kit+'-v2')
        for file in source.rglob('*'):
            if file.is_file()and file.suffix in('.json','.res')and not file.name.endswith('.previous.json'):
                checked_copy(file,WORLD/kit/file.relative_to(source))
    configs={
        'entrances.json':load(STAGE/'connected-entrances.json'),
        'network-gates.json':load(STAGE/'network-gates.json'),
        'drainage-network.json':load(STAGE/'native-drainage.json'),
        'surface-drainage.json':load(STAGE/'surface-drainage.json'),
        'areas.json':areas,
    }
    configs['surface-drainage.json']['about']='Native stair-house roof inlets connected to the complete Ruien drainage network. Metres; y street=0.'
    for inlet in configs['surface-drainage.json']['inlets']:
        inlet['status']='connected to the native Ruien drainage network'
        inlet['note']='Roof gutter, hollow downpipe, stone channel, grated gully and buried onward connection.'
    backup=STAGE/'pre-install-configs';backup.mkdir(exist_ok=True)
    originals={name:(WORLD/name).read_bytes()if(WORLD/name).exists()else None for name in configs}
    for name,value in originals.items():
        if value is not None and not(backup/name).exists():(backup/name).write_bytes(value)
    try:
        for name,value in configs.items():atomic(WORLD/name,value)
    except Exception:
        for name,value in originals.items():
            if value is not None:(WORLD/name).write_bytes(value)
        raise
    atomic(STAGE/'installation-receipt.json',dict(areas=installed,retained=list(retained),sourceProof=proof['inputDigest']))
    print('INSTALLED_COMPLETE_RUIEN',len(installed),'new areas;',len(retained),'retained; 918 connected inlets')

if __name__=='__main__':main()

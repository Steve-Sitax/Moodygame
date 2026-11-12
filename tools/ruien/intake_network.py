"""Resumable native intake of already exported full-network pieces, without activation."""
from __future__ import annotations
import argparse,concurrent.futures,hashlib,json,os,subprocess,threading,time
from pathlib import Path
from build_network import ROOT,ART,valid,digest,atomic_json
from native_layout import STAGE,area_id,make
from export_metadata import normalize

LOCK=threading.Lock()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--engine',type=Path,required=True);ap.add_argument('--jobs',type=int,default=2)
    ap.add_argument('--only',default='');ap.add_argument('--wait',action='store_true')
    args=ap.parse_args()
    if not 1<=args.jobs<=4:raise ValueError('Use one to four bounded conversion workers')
    layout=make();ids=[a['id'][8:].upper() for a in layout['areas'] if a['id'].startswith('network_')]
    if args.only:ids=[rid for rid in ids if rid in args.only.split(',')]
    inputs=[ROOT/'godot/src/World/Ruien'/name for name in ['RuienImport.cs','RuienGlb.cs','RuienData.cs','RuienUv.cs',
            'RuienPaving.cs','RuienPavingSearch.cs','RuienUnfold.cs','RuienMaterials.cs','RuienDepositRepair.cs',
            'RuienSurfaceRepair.cs']]
    inputs += [ROOT/'native-godot/world/town/resources/r000035.res']
    common=digest(inputs,{})
    room_ids=set(json.loads((STAGE/'layouts/layouts.json').read_text())['layouts'])
    route_ids=set(json.loads((STAGE/'layouts/routes.json').read_text())['jobs'])
    progress=dict(total=len(ids),jobs={});failed=threading.Event()
    def update(rid,status,**fields):
        with LOCK:
            progress['jobs'][rid]=dict(status=status,**fields);atomic_json(STAGE/'intake-progress.json',progress)
            print(rid,status,fields,flush=True)
    def run(rid):
        source=STAGE/'exports'/rid;out=STAGE/'resources'/rid
        while True:
            if failed.is_set():return False
            try:
                receipt=json.loads((source/'build-receipt.json').read_text())
                kind='route' if rid in route_ids else ('room' if rid in room_ids else 'hall')
                batch=json.loads((STAGE/(kind+'-build-progress.json')).read_text())
                state=batch['jobs'].get(rid,{})
                if state.get('status')=='failed':
                    failed.set();update(rid,'failed-export');return False
                if state.get('status') in ('cached','exported') and state.get('key')==receipt['key'] and valid(source,receipt['key']):break
            except (OSError,ValueError,KeyError):pass
            if not args.wait:update(rid,'pending-export');return False
            time.sleep(5)
        area=next(a for a in layout['areas'] if a['id']==area_id(rid))
        normalize(source)
        # The manifest contains each GLB's content hash. Build-receipt dependency
        # housekeeping cannot invalidate identical native geometry.
        key=digest([source/'manifest.json'],dict(common=common,zones=area['zones']))
        saved=out/'intake-receipt.json'
        if saved.exists():
            try:
                old=json.loads(saved.read_text())
                if old['key']==key and all(hashlib.sha256((out/f).read_bytes()).hexdigest()==h for f,h in old['files'].items()):
                    update(rid,'cached');return True
            except (OSError,KeyError,ValueError):pass
        out.mkdir(parents=True,exist_ok=True)
        previous=out/'area.json'
        if previous.exists():os.replace(previous,out/'area.previous.json')
        update(rid,'converting');start=time.monotonic()
        cmd=[str(args.engine),'--headless','--path',str(ROOT/'native-godot'),'res://world/ruien/convert.tscn','--',
             '--ruien-area',str(source),'--area',area_id(rid),'--out',str(out),'--lods','0,1','--ruien-areas',str(STAGE/'native-conversion-areas.json'),'--startup-profile']
        env=dict(os.environ,SCHELDEMIST_USER_DATA=str(STAGE/'intake-userdata'/rid))
        with (out/'intake.log').open('w',encoding='utf-8') as log:
            result=subprocess.run(cmd,env=env,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode or not (out/'area.json').exists() or not (out/'collision.res').exists():
            failed.set();update(rid,'failed',exit=result.returncode);return False
        files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.suffix in ('.json','.res') and p.name not in ('intake-receipt.json','area.previous.json')}
        atomic_json(saved,dict(key=key,files=files,seconds=time.monotonic()-start))
        update(rid,'converted',seconds=round(time.monotonic()-start,1));return True
    # Dispatch ready pieces first: queued room exports must not hold both native
    # workers idle while finished route exports are available for conversion.
    results=[];pending=list(ids);running={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        while pending or running:
            states={}
            for kind in ('room','hall','route'):
                file=STAGE/(kind+'-build-progress.json')
                if file.exists():states.update(json.loads(file.read_text())['jobs'])
            ready=[rid for rid in pending if states.get(rid,{}).get('status') in ('cached','exported')]
            for rid in ready[:max(0,args.jobs-len(running))]:
                pending.remove(rid);running[pool.submit(run,rid)]=rid
            if running:
                done,_=concurrent.futures.wait(running,timeout=5,return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:results.append(future.result());del running[future]
            elif pending:
                if not args.wait or failed.is_set() or any(s.get('status')=='failed' for s in states.values()):
                    for rid in pending:update(rid,'pending-export')
                    results.extend(False for _ in pending);pending.clear()
                else:time.sleep(5)
    print('NATIVE_INTAKE_COMPLETE',sum(results),'/',len(results),flush=True)
    raise SystemExit(0 if all(results) else 1)

if __name__=='__main__':main()

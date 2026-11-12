"""Resumable bounded-concurrency exports for the full Ruien construction inventory.

Only staging folders are written. A successful export is not installed or labelled accepted;
native conversion, joined-route proofs and scene review remain separate acceptance steps.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from export_metadata import normalize

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art-source/ruien-o2-20261018'
LOCK=threading.Lock()


def digest(paths, parameters, contents=None):
    h=hashlib.sha256(json.dumps(parameters,sort_keys=True).encode())
    for path in sorted(set(paths)):
        h.update(str(path.relative_to(ROOT)).encode() if path.is_relative_to(ROOT) else str(path).encode())
        h.update(b'\0');h.update(contents[path]if contents and path in contents else path.read_bytes());h.update(b'\0')
    return h.hexdigest()


def valid(folder, key):
    receipt=folder/'build-receipt.json'
    if not receipt.exists():return False
    try:
        saved=json.loads(receipt.read_text())
        if saved['key']!=key:return False
        manifest=json.loads((folder/'manifest.json').read_text())
        if manifest.get('markers',{}).get('stairs'):return False
        files=manifest['files']
        if {f.get('lod') for f in files.values() if 'lod' in f}!={0,1}:return False
        if not any('collision' in name for name in files):return False
        for name,info in files.items():
            file=folder/name
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=info['sha256']:return False
        return True
    except (OSError,KeyError,ValueError):return False


def atomic_json(path, data):
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data,indent=2)+'\n')
    os.replace(temporary,path)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--blender',type=Path,default=Path('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'))
    ap.add_argument('--stage',type=Path,default=ROOT/'.scratch/ruien-complete')
    ap.add_argument('--jobs',type=int,default=3)
    ap.add_argument('--only',default='')
    ap.add_argument('--kind',choices=['rooms','halls','routes'],default='rooms')
    ap.add_argument('--tag',default='',help='suffix for a second concurrent batch of the same kind: its own progress file')
    args=ap.parse_args()
    if not 1<=args.jobs<=4:raise ValueError('Use one to four bounded Blender workers')
    stage=args.stage.resolve();stage.mkdir(parents=True,exist_ok=True)
    if stage==ROOT or stage==ART or (ROOT/'native-godot/world').resolve() in stage.parents:
        raise ValueError('Exports require a staging folder outside installed world assets')
    layout_file={'rooms':'layouts/layouts.json','halls':'layouts/halls.json','routes':'layouts/routes.json'}[args.kind]
    layouts=json.loads((stage/layout_file).read_text())
    if layouts['failures'] or layouts.get('overlaps'):raise ValueError('Resolve junction planning failures before baking')
    if args.kind=='routes' and (not layouts.get('pathProof') or layouts['pathProof']['failures']):
        raise ValueError('All route sweeps must pass the width/radius proof before export')
    selection=set(args.only.split(',')) if args.only else None
    hall_records={r['room']['id']:r for r in layouts.get('halls',[])}
    ids=[rid for rid in (layouts.get('layouts') or layouts.get('jobs') or hall_records) if rid!='R1' and (selection is None or rid in selection)]
    if not ids:raise ValueError('No new rooms selected')
    source=list((ART/'scripts/rlib').glob('*.py'))
    source += [ART/'scripts/spec.py',ART/'scripts/export_game.py',ART/'scripts/build_junction.py']
    source += [ART/'scripts/kit'/name for name in ['junction_gen.py','arch_rim.py','fold_bridge.py','fitlib.py','fittings.json','sweep.py','meet.py','rail.py','drain_crossing.py']]
    if args.kind=='halls':
        source += [ART/'scripts/build_network_hall.py']
        source += [ART/'scripts/kit'/name for name in ['hall_gen.py','network_hall.py','sweep.py']]
    if args.kind=='routes':source += [ART/'scripts/build_stretch.py']
    source += list((ART/'export/textures').glob('*.png'))
    common_key=digest(source,{})
    previous_commons=[]
    # A baseline names the generator files as they were and the jobs its change can reach.
    # Every other job keeps its export: its key moves to the new sources without a rebuild.
    active=[]
    for filename in('lamp-repair-baseline.json','lamp-hook-baseline.json','generator-fix-baseline.json','generator-fix-baseline-2.json','generator-fix-baseline-3.json','plan-fix-baseline-4.json','generator-fix-baseline-5.json','generator-fix-baseline-6.json'):
        lamp_baseline=stage/filename
        if not lamp_baseline.exists():continue
        migration=json.loads(lamp_baseline.read_text())
        if migration.get('after')is not None and all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in migration['after'].items()):
            active.append(migration)
    # An export may predate one change or several: try every set of changes undone together.
    for mask in range(1,1<<len(active)):
        chosen=[m for i,m in enumerate(active)if mask>>i&1]
        contents={ROOT/p:Path(file).read_bytes()for m in chosen for p,file in m['files'].items()}
        if any(m.get('affected')is None for m in chosen):
            if len(chosen)==1:previous_commons.append((digest(source,{},contents),chosen[0].get('kinds',[]),None,None,None))
            continue
        affected={kind:('*'if any(m['affected'].get(kind)=='*'for m in chosen)else sorted(set().union(*[m['affected'].get(kind,[])for m in chosen])))for kind in('rooms','halls','routes')}
        # a baseline may also name the plan as it was: every key holds the plan's route lines
        before=next((json.loads(Path(m['planBefore']).read_text())for m in chosen if m.get('planBefore')),None)
        # ... or the compiled plan a route job reads its neighbours from (planOverride), as it was
        extra=next((Path(m['extraPlanBefore']).read_bytes()for m in chosen if m.get('extraPlanBefore')),None)
        previous_commons.append((digest(source,{},contents),[],affected,before,extra))
    plan_data=json.loads((stage/'layouts/plan.json').read_text())
    progress=dict(started=time.time(),kind=args.kind,total=len(ids),jobs={})
    failed=threading.Event()
    progress_file=stage/(dict(rooms='room',halls='hall',routes='route')[args.kind]+args.tag+'-build-progress.json')
    def update(rid, status, **fields):
        with LOCK:
            progress['jobs'][rid]=dict(status=status,**fields)
            atomic_json(progress_file,progress)
            print(rid,status,fields,flush=True)
    def run(rid):
        if failed.is_set():
            update(rid,'not-started',reason='Earlier construction failure; repair before resuming')
            return False
        folder=stage/'exports'/rid;folder.mkdir(parents=True,exist_ok=True)
        config=(stage/'layouts/routes'/f'{rid}.json') if args.kind=='routes' else stage/'layouts'/f'{rid}{"-hall" if args.kind=="halls" else ""}.json'
        plan=stage/'layouts/plan.json'
        record=layouts['layouts'][rid] if args.kind=='rooms' else (layouts['jobs'][rid] if args.kind=='routes' else hall_records[rid])
        joined=','.join(m['route'] for m in record.get('mouths',[]))
        parameters=dict(room=rid,joined=joined,lods=[0,1])
        room=next((r for r in plan_data['rooms'] if r['id']==rid),None) if args.kind!='routes' else None
        if args.kind=='routes':
            xy=record['pts'];room=dict(rect=[min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)])
        rect=room['rect']
        def nearby(point):return rect[0]-.6<=point[0]<=rect[2]+.6 and rect[1]-.6<=point[1]<=rect[3]+.6
        local_routes={k:v for k,v in plan_data['routes'].items() if nearby(v['pts'][0]) or nearby(v['pts'][-1])}
        inputs=dict(common=common_key,layoutRoom=room,routes=local_routes,**parameters)
        if args.kind=='routes' and record.get('planOverride'):
            plan=Path(record['planOverride']);inputs['extraPlan']=digest([plan],{})
        # A JOB owns its path, grates and lamps. The sweep only reads the other
        # route lines for tees/throats; unrelated room metadata is not geometry.
        if args.kind=='routes':inputs['plan']=dict(routes=plan_data['routes'])
        key=digest([config],inputs)
        for previous_common,unaffected_kinds,affected,plan_before,extra_before in previous_commons:
            if affected is not None:
                if affected.get(args.kind)=='*' or rid in affected.get(args.kind,[]):continue
            elif json.loads(config.read_text()).get('repairLamps')and args.kind not in unaffected_kinds:continue
            if valid(folder,key):break
            previous_inputs=dict(inputs,common=previous_common)
            if plan_before is not None:
                previous_inputs['routes']={k:v for k,v in plan_before['routes'].items() if nearby(v['pts'][0]) or nearby(v['pts'][-1])}
                if args.kind=='routes':previous_inputs['plan']=dict(routes=plan_before['routes'])
            if extra_before is not None and 'extraPlan' in inputs:previous_inputs['extraPlan']=digest([plan],{},{plan:extra_before})
            previous_key=digest([config],previous_inputs)
            if valid(folder,previous_key):
                saved=json.loads((folder/'build-receipt.json').read_text())
                saved.update(key=key,previousKey=previous_key,dependencyMigration='Verified changed generator branch is inactive for this job; geometry unchanged')
                atomic_json(folder/'build-receipt.json',saved)
        baseline=stage/'layouts/cache-plan-baseline.json'
        if args.kind=='routes' and not valid(folder,key) and baseline.exists():
            old_plan=json.loads(baseline.read_text())
            legacy=digest([config],dict(inputs,plan=old_plan))
            if old_plan['routes']==plan_data['routes'] and valid(folder,legacy):
                saved=json.loads((folder/'build-receipt.json').read_text())
                saved.update(key=key,previousKey=legacy,dependencyMigration='JOB geometry unchanged; exclude unused plan metadata')
                atomic_json(folder/'build-receipt.json',saved)
        if valid(folder,key):normalize(folder);update(rid,'cached',key=key);return True
        # Blender can return exit code zero after a Python exception. A manifest from an
        # earlier source revision must never make that failed rebuild look successful.
        old_manifest=folder/'manifest.json'
        if old_manifest.exists():os.replace(old_manifest,folder/'manifest.previous.json')
        update(rid,'building',key=key)
        command=[str(args.blender),'--background','--factory-startup','--threads','3','--python','scripts/build_junction.py','--',
                 '--room',rid,'--out',str(folder),'--plan',str(plan),'--over',str(config),'--joined',joined,'--lods','0,1','--no-render']
        if args.kind=='halls':
            command=[str(args.blender),'--background','--factory-startup','--threads','3','--python','scripts/build_network_hall.py','--',
                     '--layout',str(config),'--out',str(folder)]
        if args.kind=='routes':
            command=[str(args.blender),'--background','--factory-startup','--threads','3','--python','scripts/build_stretch.py','--',
                     '--route',rid,'--out',str(folder),'--plan',str(plan),'--job',str(config),'--walkways','L65=-1,L100=-1,L114=-1','--lods','0,1','--no-render']
        start=time.monotonic()
        with (folder/'build.log').open('w',encoding='utf-8') as log:
            result=subprocess.run(command,cwd=ART,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode or not (folder/'manifest.json').exists():
            failed.set()
            update(rid,'failed',exit=result.returncode,log=str(folder/'build.log'));return False
        # Cycles logs a failed GPU allocation and bakes on: the export completes with missing relief.
        if 'out of GPU memory' in (folder/'build.log').read_text(encoding='utf-8',errors='replace'):
            (folder/'build-receipt.json').unlink(missing_ok=True)
            update(rid,'failed',reason='Bake ran out of GPU memory; rebuild with fewer workers',log=str(folder/'build.log'));return False
        normalize(folder)
        atomic_json(folder/'build-receipt.json',dict(key=key,parameters=parameters,seconds=time.monotonic()-start))
        if not valid(folder,key):
            failed.set();update(rid,'failed',reason='Incomplete export or content hash mismatch');return False
        manifest=json.loads((folder/'manifest.json').read_text())
        if manifest['markers']['stairs']:
            update(rid,'failed',reason='Buried network room unexpectedly exports a street stair');return False
        update(rid,'exported',seconds=round(time.monotonic()-start,1),key=key)
        return True
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results=list(pool.map(run,ids))
    print('EXPORT_BATCH_COMPLETE',sum(results),'/',len(results),flush=True)
    raise SystemExit(0 if all(results) else 1)


if __name__=='__main__':main()

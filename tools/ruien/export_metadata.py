"""Schema completion for staged exports; never rebakes or changes geometry files."""
import json,os
from pathlib import Path

def normalize(folder):
    path=folder/'manifest.json'
    data=json.loads(path.read_text());changed=False
    retained=data.get('construction',{}).get('retained')
    if retained and data.get('surfaceLayout') and 'geometryPath' not in data['surfaceLayout']:
        areas=json.loads((Path(__file__).resolve().parents[2]/'native-godot/world/ruien/areas.json').read_text())['areas']
        old=next(a for a in areas if a['id']==retained['area'])['zones'][0]['path']
        layout=data['surfaceLayout'];tail=layout['path']
        layout.update(geometryPath=tail,path=old[:-1]+tail,pavingPrefixArea=retained['area'])
        changed=True
    if data.get('piece')=='network_hall':
        for lamp in data['markers']['lamps']:
            if 'kind' not in lamp:lamp['kind']='point';changed=True
        for mist in data['markers']['mist']:
            if 'density_peak' not in mist and 'density' in mist:
                mist['density_peak']=mist.pop('density');changed=True
        if data.get('metadataSchema')!='network-hall-v1':data['metadataSchema']='network-hall-v1';changed=True
    if changed:
        temp=path.with_suffix('.metadata.tmp');temp.write_text(json.dumps(data,indent=2)+'\n');os.replace(temp,path)
    return changed

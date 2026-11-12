"""Describe native body checks for every compiled main-network junction."""
import json
from construction import load
from native_layout import STAGE

def main():
    data=load(STAGE/'native-conversion-areas.json');paths=[]
    for area in data['areas']:
        for join in area.get('joinProof',[]):
            for i,(a,b)in enumerate(zip(join['points'],join['points'][1:])):
                paths.append(dict(name=area['id']+'/'+join['name']+'/'+str(i),**{'from':a,'to':b}))
    result=dict(areas=[a['id']for a in data['areas']],paths=paths)
    (STAGE/'main-join-fixture.json').write_text(json.dumps(result,indent=2)+'\n')
    print('NATIVE_JOIN_FIXTURE',len(paths),'joined path spans;',len(result['areas']),'areas')

if __name__=='__main__':main()

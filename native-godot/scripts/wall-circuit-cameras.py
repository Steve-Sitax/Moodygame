"""Complete reproducible wall coverage; no actor scene or asset is opened."""
import json,math,pathlib,numpy as np
p=pathlib.Path('native-godot/proof/wall-circuit');p.mkdir(exist_ok=True)
d=json.load(open('art-source/shared/city.json'))['decor']['rampart'];views=[]
def v(p,y):return [float(p[0]),float(y),float(p[1])]
def shot(name,eye,target,baseline=True,weather=False):views.append(dict(name=name,eye=eye,target=target,baseline=baseline,weather=weather))
stairs=[]
for i,st in enumerate(d['stairs']):
 f=st['frame'];t=np.array(f['t'])*st['dir'];n=np.array(f['n']);foot=np.array(f['o'])+np.array(f['t'])*st['s']-n*7
 run=np.linalg.norm(np.array(st['b'])-st['a']);stairs.append(dict(id=i,foot=foot.tolist(),t=t.tolist(),n=n.tolist(),run=float(run),direction=st['dir']))
 shot(f'stair-{i:02}-wide',v(foot-t*6-n*6,2),v(foot+t*5-n,2.7),True,True)
 shot(f'stair-{i:02}-foot',v(foot+t*.8-n*4.5,1.2),v(foot+t*.3-n*2.05,.75),False,True)
 shot(f'stair-{i:02}-back',v(foot+t*(run+3)-n*3,8.1),v(foot+t*8-n,5.5),False,True)
 start=.8 if i in [1,4,10] else -1.1
 shot(f'stair-{i:02}-treads',v(foot+t*start-n*.9,.55+max(0,start)*6.5/run),v(foot+t*2.7-n*.9,1.2+max(0,start)*6.5/run),False,True)
for i,s in enumerate(d['segments']):
 o=np.array(s['o']);t=np.array(s['t']);n=np.array(s['n']);count=math.ceil(s['len']/26)
 for j in range(count):
  c=o+t*((j+.5)*s['len']/count)
  for side,offset in [('town',-7),('field',7)]:shot(f'seg-{i:02}-{j:02}-{side}',v(c+n*(offset+(-3 if side=='town' else 15))-t*(6 if side=='town' else 0),2.2 if side=='town' else 4),v(c+n*offset+t*(3 if side=='town' else 0),2.0 if side=='town' else 3.4),j==count//2,j==count//2)
  shot(f'seg-{i:02}-{j:02}-walk',v(c-n*3.5-t*8,8.4),v(c-n*3.5+t*7,7),False,j==count//2)
huts=[]
for i,poly in enumerate(d['huts']):
 poly=np.array(poly);c=poly.mean(0);tower=next((x for x in d['towers'] if np.linalg.norm(np.array(x['hut']).mean(0)-c)<.05),None);bast=next((x for x in d['bastion_list'] if 'hut'in x and np.linalg.norm(np.array(x['hut']).mean(0)-c)<.05),None)
 direction=(np.array(tower['door'])-c) if tower else (np.array(bast['vertex'])-c) if bast else np.array([-70,180])-c
 axes=[poly[1]-poly[0],poly[3]-poly[0]];axes=[a/np.linalg.norm(a) for a in axes]
 front=max([a*sign for a in axes for sign in [1,-1]],key=lambda a:np.dot(a,direction));side=np.array([-front[1],front[0]])
 huts.append(dict(id=i,center=c.tolist(),front=front.tolist(),side=side.tolist(),corners=poly.tolist()))
 shot(f'hut-{i:02}-front',v(c+front*7-side*4,8.3),v(c,8.2),True,True)
 shot(f'hut-{i:02}-back',v(c-front*6+side*4,9.8),v(c,8.2),False,True)
for g in d['gates']:
 c=np.array(g['house']).mean(0);n=np.array(g['out']);t=np.array([-n[1],n[0]])
 for side,sign in [('town',-1),('field',1)]:shot('gate-'+g['id']+'-'+side,v(c+n*sign*(10 if sign<0 else 23)+t*(2 if sign<0 else 9),3),v(c,7),True,True)
 shot('gate-'+g['id']+'-passage',v(c-n*8,1),v(c+n*4,2.5),False,True)
 shot('gate-'+g['id']+'-roof',v(c+n*15+t*13,15),v(c+t*4,13),False,True)
 shot('gate-'+g['id']+'-threshold',v(c-n*9+t*2,1.5),v(c-n*5,1.3),False,True)
for name,poly in d['bastions'].items():
 c=np.array(poly).mean(0);out=c-np.array([-70,180]);out/=np.linalg.norm(out)
 shot('bastion-'+name+'-field',v(c+out*34,5),v(c,5),True,True)
 shot('bastion-'+name+'-top',v(c-out*7,13),v(c+out*7,7),False,True)
for view in views:
 fixes={'bastion-mid-field':([-59.951,6,425.0],[-59.98,4.5,390]),'bastion-ne-field':([273.718,6,360.593],[239.83,4.5,332.69]),'bastion-nw-field':([-411.255,6,361.151],[-383,4.5,336])}
 if view['name'] in fixes:view['eye'],view['target']=fixes[view['name']]
for i,s in enumerate(d['segments']):
 o=np.array(s['o']);t=np.array(s['t']);n=np.array(s['n']);c=o+t*s['len']*.55
 shot(f'seg-{i:02}-base-close',v(c-n*9.2-t*1.2,.65),v(c-n*7,.50),False,True)
for view in views:
 if view['name'] in ['seg-01-01-walk','seg-04-02-walk']:
  segment=d['segments'][int(view['name'][4:6])];delta=np.array(segment['t'])*19
  for key in ['eye','target']:view[key][0]+=float(delta[0]);view[key][2]+=float(delta[1])
 if view['name']=='seg-04-base-close':
  delta=np.array(d['segments'][4]['t'])*14
  for key in ['eye','target']:view[key][0]+=float(delta[0]);view[key][2]+=float(delta[1])
shot('guard-drain-return',[221.3,7.7,47.5],[222.5,6.8,47.22],False,True)
shot('guard-drain-return-low',[221.75,6.75,47.05],[222.8,7.5,47.20],False,True)
shot('kerb-seg04-end',[6.9,.65,347.784],[7.332,.019,349.43],False,True)
shot('river-return-small-face',[-362,3.1,21],[-356.6,3.1,20.9],False,True)
for i,c in enumerate([np.array([-59.98,380]),np.array([239.83,332.69])]):
 shot(f'mill-{i}-close',v(c+np.array([9,-12]),9),v(c,11),False,True)
for i in [0,9]:
 s=d['segments'][i];c=np.array(s['o'])+(np.array(s['t'])*s['len'] if i==9 else 0);n=np.array(s['n'])
 shot(f'river-end-{i}',v(c+n*14+np.array([0,-16]),3),v(c,4),False,True)
for view in views:
 if view['name']=='seg-09-04-town':view['weather']=True
json.dump(dict(layout=d,stairs=stairs,huts=huts,views=views),open(p/'coverage.json','w'),indent=2)
print(len(views),'views;',sum(x['baseline'] for x in views),'baseline;',sum(x['weather'] for x in views),'rain/night checks')

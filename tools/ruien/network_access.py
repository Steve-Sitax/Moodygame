"""Fit the existing street stairs to the built network without moving their doors."""
import math
from construction import ROOT,load,nearest_on_path
from plan_drains import frame


def repair_access(areas,stage):
    by_id={a['id']:a for a in areas}
    frames={f['id']:f for f in load(stage/'entrance-frames.json')}
    fixed={}
    retained=by_id['o2']
    retained['openEndCards']=['hall_side_sw','hall_side_ne','hall_side_e']
    retained['floorCollisionKeys']=['hall_side_sw','hall_side_ne','hall_side_e','hall_bay02','hall_bay20','hall_bay23']
    retained['collisionMouths']=[dict(at=p,axis=n,half=2.95,spring=-3.4,rise=2.5) for p,n in (
        ([-159.5,0,127.68],[-1,0,0]),([-140.5,0,113.75],[1,0,0]),([-143.1,0,138],[0,0,1]))]
    # Wall-side silt banks cross these visible arches. Scour continuous beds
    # through the mouths, retaining relief and feathering into the side banks.
    retained['bedClearances']=[dict(at=m['at'],axis=m['axis'],inside=-5.85,outside=-6.1)for m in retained['collisionMouths']]
    names={'retained_west_bed','retained_east_bed','retained_south_bed'}
    retained['bedJoinProof']=[p for p in retained.get('bedJoinProof',[])if p['name']not in names]
    retained.setdefault('bedJoinProof',[]).extend([
        dict(name='retained_west_bed',points=[[-168.65,-5.85,127.68],[-159.3,-5.85,127.68]]),
        dict(name='retained_east_bed',points=[[-140.7,-5.85,113.75],[-135.15,-5.85,113.75]]),
        dict(name='retained_south_bed',points=[[-143.1,-5.85,137.8],[-143.1,-5.85,147.15]])])

    def connect(identity,area,side,length,head=0):
        option=next(o for o in frames[identity]['options'] if o['side']==side)
        p=option['at'];n=option['dir'];q=[p[0]+n[0]*length,p[1],p[2]+n[1]*length]
        fixed[identity]=dict(closure='open',closureSide=side,connectArea=area,connectLength=length,connectHead=head)
        return p,q

    def walk(area,points,bed):
        for a,b in zip(points,points[1:]):
            area.setdefault('walkConnections',[]).append({'from':a,'to':b,'width':1.05,'bed':bed,'trimImported':True})
            area['walkProof'].append({'name':'stair_bypass','from':a,'to':b})

    # The original Hanseatic flight projects through the room's south wall.
    # Keep the west mouth free below the new return walkway.
    a=by_id['network_j064']
    a['walkProof']=[r for r in a['walkProof'] if not(r['name']=='z0' or(r['name']=='x1'and r['from'][2]<200))]
    a['walkProof'].append({'name':'z0','from':[66.6,-3.9,198.6],'to':[68.4,-3.9,198.6]})
    walk(a,[[68.4,-3.9,198.6],[69.1,-3.9,198.6],[69.1,-3.9,200.05],[72.4,-3.9,200.05],[72.4,-3.9,200.95]],-4.9)
    p,q=connect('re30_hanseatic',a['id'],'left',(200.05-198.9847)/.9950372)
    walk(a,[p,q],-4.9)

    # The Kanaalrui flight occupies the old corner route. The supported walk
    # joins its bottom landing and continues along the room side of the flight.
    a=by_id['network_j051_j059']
    a['walkProof']=[r for r in a['walkProof'] if not(r['name']=='z1'or(r['name']=='x0'and r['from'][2]>211))]
    walk(a,[[-80.27,-3.6,211.3839],[-78.55,-3.6,211.3839],[-78.55,-3.6,218.8639]],-6.1)
    a['walkProof'].append({'name':'z1','from':[-78.55,-3.6,218.8639],'to':[-60.03,-3.6,218.8639]})
    p,q=connect('re03_kanaalrui_poort',a['id'],'back',.96)
    walk(a,[p,q],-6.1)

    def cross(a,b):return a[0]*b[1]-a[1]*b[0]

    def rail_posts(area,centre,tangent,across,offset,cut_from,cut_to,width):
        """The cut rail bars terminate inside new posts, with matching iron bases."""
        delta=[cut_to[i]-cut_from[i]for i in(0,2)];length=math.hypot(*delta)
        normal=[-delta[1]/length,delta[0]/length]
        origin=[centre[i]+across[i]*offset for i in(0,1)]
        slope=sum(tangent[i]*normal[i]for i in(0,1))
        if abs(slope)<.1:raise ValueError('A bridge must cross its bank rail')
        base=(origin[0]-cut_from[0])*normal[0]+(origin[1]-cut_from[2])*normal[1]
        for side in(-1,1):
            u=(side*width/2-base)/slope
            area.setdefault('bridgeRailPosts',[]).append([origin[0]+tangent[0]*u,cut_from[1],origin[1]+tangent[1]*u])

    # A door on the bank without a maintenance ledge reaches a folding bridge.
    # Only the lining projects farther under the host vault; no fixed floor
    # spans the giant's channel.
    choices={'re04_sint_jansplein_poort':'end','re17_kipdorprui_cottage':'back',
             're21_entrepotrui_cottage':'street','re18_paulusrui_house':'street','re31_kipdorp':'back'}
    for identity,side in choices.items():
        f=frames[identity];a=by_id['network_'+f['line'].lower()];z=a['zones'][0]
        option=next(o for o in f['options']if o['side']==side);p=[option['at'][0],option['at'][2]];n=option['dir'];hits=[]
        for v,w in zip(z['path'],z['path'][1:]):
            ab=[w[i]-v[i]for i in(0,1)];den=cross(n,ab)
            if abs(den)<1e-8:continue
            d=[v[i]-p[i]for i in(0,1)];t=cross(d,ab)/den;u=cross(d,n)/den
            if t>.3 and 0<=u<=1:hits.append((t,ab))
        if not hits:raise ValueError(identity+': entrance does not face its built rui')
        t,ab=min(hits);length=math.hypot(*ab);tangent=[v/length for v in ab];across=[tangent[1],-tangent[0]]
        ws=z['walkwaySide'];normal=sum(n[i]*across[i]for i in(0,1))
        if normal*ws<=.3:raise ValueError(identity+': bridge approach is not on the opposite bank')
        da=t-ws*1.68/normal;db=t+ws*1.36/normal
        def at(d):return [p[0]+n[0]*d,-3.9,p[1]+n[1]*d]
        bridge=dict(id=identity+'_access',a=at(da),b=at(db),gear=[-n[1],n[0]])
        if identity=='re18_paulusrui_house':bridge['railStartB']=.8
        a.setdefault('bridges',[]).append(bridge)
        a.setdefault('openBridgeHeels',[]).extend([bridge['id']+'/a',bridge['id']+'/b'])
        cut={'from':at(db-1.25),'to':at(db+.30),'width':1.12}
        a.setdefault('bridgeRailCuts',[]).append(cut)
        rail_posts(a,[p[i]+n[i]*t for i in(0,1)],tangent,across,ws*.915,cut['from'],cut['to'],cut['width'])
        connect(identity,a['id'],side,da,.8)

    # Keep the Kipdorppoort passage in the earth west of the F1 flush tunnel.
    identity='re10_kipdorppoort';option=next(o for o in frames[identity]['options']if o['side']=='street')
    p=option['at'];n=option['dir']
    path=[p,[p[0]+n[0]*2.5,-3.85,p[2]+n[1]*2.5],[-152.5,-3.65,345.9],[-147.9,-3.6,345.9]]
    fixed[identity]=dict(closure='open',closureSide='street',connectArea='network_j028',
        connectLength=sum(math.dist(p,q)for p,q in zip(path,path[1:])),connectPath=path)

    # The Lijnwaadmarkt stair remains on the east ledge. Two folding crossings
    # route people along the opposite ledge; both rise clear of the bed.
    identity='re33_lijnwaadmarkt';connect(identity,'network_l42','end',1.35)
    a=by_id['network_l42'];path=a['zones'][0]['path'];stations=[]
    for z in(157.0,145.7):
        _,u,_,_=nearest_on_path([-214.2,z],path);p,t=frame(path,u);across=[t[1],-t[0]]
        def at(lat):return[p[0]+lat*across[0],-3.6,p[1]+lat*across[1]]
        bridge=dict(id=identity+'_bypass_'+str(len(stations)),a=at(-1.66),b=at(1.66),gear=t)
        a.setdefault('bridges',[]).append(bridge)
        a.setdefault('openBridgeHeels',[]).extend([bridge['id']+'/a',bridge['id']+'/b'])
        for sign in(-1,1):
            cut={'from':at(sign*1.04),'to':at(sign*2.0),'width':1.12}
            a.setdefault('bridgeRailCuts',[]).append(cut)
            # Only M routes have edge rails in this export kit. The G ledges
            # retain their original open stone coping at the bridge landings.
        stations.append((u,at(-1.87),at(1.87),bridge))
    lo,hi=stations
    if lo[0]>=hi[0]:raise ValueError('Lijnwaadmarkt bypass stations reversed')
    a['walkDetours']=[dict(name='lijnwaadmarkt_stair',side=-1,start=lo[0],end=hi[0],
        points=[lo[1],lo[3]['a'],lo[3]['b'],lo[2],hi[2],hi[3]['b'],hi[3]['a'],hi[1]])]
    # Match the retained R1 sample's ladder clearances to the completed routes.
    # Keep the authored ladders and grates; widen only the iron bank-rail gap.
    for identity in('r1_l65','r1_l100','r1_l114'):
        a=by_id[identity];zone=a['zones'][0];ws=zone['walkwaySide'];path=zone['path']
        if a.get('ladderGapRepair')==1:
            a.pop('bridgeRailCuts',None);a.pop('bridgeRailPosts',None)
            a['walkProof']=[r for r in a.get('walkProof',[])if not r['name'].startswith('ladder_')]
        a['ladderGapRepair']=1
        markers=load(ROOT/'native-godot/world/ruien'/identity/'markers.json')
        for ladder in markers['ladders']:
            foot=ladder['bottom'];_,u,_,_=nearest_on_path([foot[0],foot[2]],path);p,t=frame(path,u);across=[t[1],-t[0]]
            def at(lat,along=0):return[p[0]+across[0]*lat+t[0]*along,-3.9,p[1]+across[1]*lat+t[1]*along]
            cut={'from':at(ws*.65),'to':at(ws*1.17),'width':1.7}
            a.setdefault('bridgeRailCuts',[]).append(cut)
            rail_posts(a,p,t,across,ws*.915,cut['from'],cut['to'],cut['width'])
            a.setdefault('walkProof',[]).append({'name':'ladder_'+ladder['id'],'from':at(ws*1.16,-1.4),'to':at(ws*1.16,1.4)})
    return fixed

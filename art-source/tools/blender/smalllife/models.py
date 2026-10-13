"""Local anatomy for domestic fowl, waterfowl, town birds, a goat and the two rodents."""
import math
import numpy as np
from .geometry import Mesh

KINDS = ['hen','cockerel','goat','duck_mallard','duck_female','duck_young','swan','swan_young',
         'goose','squirrel','songbird','pigeon','sparrow','jackdaw','crow','rat']
SIZES={'hen':.43,'cockerel':.58,'duck_mallard':.38,'duck_female':.36,'duck_young':.16,
       'swan':1.02,'swan_young':.66,'goose':.76,'songbird':.15,'pigeon':.29,'sparrow':.145,
       'jackdaw':.34,'crow':.44}


def build(kind):
    if kind=='goat':return goat()
    if kind in ('rat','squirrel'):return rodent(kind)
    return bird(kind)


def bird(kind):
    m=Mesh();h=SIZES[kind];chicken=kind in ('hen','cockerel')
    longneck=kind in ('swan','swan_young','goose')
    duck=kind.startswith('duck');water=duck or longneck
    scale=h/.43
    # Dimensions deliberately differ by construction: swan's long body and swan neck, compact sparrow, deep hen breast.
    sy=.43/h
    bodyY=.21*h/.43 if chicken else h*(.30 if longneck else .43)
    halfW=h*(.28 if chicken else .19 if longneck else .24)
    halfL=h*(.45 if chicken else .52 if longneck else .55)
    b=(0,bodyY,0)
    neck=(0,bodyY+h*(.27 if longneck else .10),halfL*.5)
    head=(0,h*.86,halfL*.82)
    if not longneck:head=(0,h*.79,halfL*.90)
    J={'body':b,'neck':neck,'head':head,'tail':(0,bodyY,-halfL*.65),
       'wingL':(-halfW*.75,bodyY+h*.13,halfL*.30),'wingR':(halfW*.75,bodyY+h*.13,halfL*.30)}
    parents={'body':None,'neck':'body','head':'neck','tail':'body','wingL':'body','wingR':'body'}
    # Sculpted body profile: keel, deep breast, tapering tail coverts, no sphere primitive.
    profile=[(-1.05,.06,.07,.05),(-.90,.48,.47,.06),(-.65,.84,.76,.04),
             (-.25,1,1,0),(.16,1,.98,0),(.50,.82,.88,.025),(.77,.58,.63,.04),(.94,.18,.22,.07)]
    m.loft([((0,bodyY+dy*h,z*halfL),halfW*rx,h*.29*ry if chicken else h*.20*ry)
            for z,rx,ry,dy in profile],0,sides=32)
    # Long-neck waterfowl get an S-curve, not a straight rod; the neck root blends over three rings.
    points=[]
    for j in range(13):
        t=j/12
        y=bodyY+h*.10+(head[1]-bodyY-h*.10)*t
        z=halfL*.5+(head[2]-halfL*.5)*t+(math.sin(t*math.tau)*h*.09 if longneck else 0)
        tip=.042 if longneck else .063
        points.append(((0,y,z),h*(.12*(1-t)+tip*t),h*(.14*(1-t)+tip*t)))
    m.loft(points,1,weights=[{'body':1-t,'neck':t} if t<.5 else {'neck':1-(t-.5)*2,'head':(t-.5)*2}
                           for t in np.linspace(0,1,13)],sides=24)
    headscale=.64 if longneck else 1
    m.oval(head,(h*.115*headscale,h*.119*headscale,h*.137*headscale),1,{'head':1},32,20)
    billlen=h*(.18 if longneck else .24 if duck else .10 if chicken else .07 if kind in ('sparrow','songbird','pigeon') else .17)
    m.loft([((0,head[1]-.025*h*headscale,head[2]+h*.11*headscale+billlen*t),
             h*headscale*(.064+.017*math.sin(t*math.pi/2))*max(.005,min(1,(1-t)*12)) if water else h*.053*(1-t*.97),
             h*headscale*(.028 if water else .046)*(1-t*.88)) for t in np.linspace(0,1,16)],6,{'head':1},24)
    for s in (-1,1):
        m.oval((s*h*.107*headscale,head[1]+h*.026*headscale,head[2]+h*.035*headscale),
               (h*.009*headscale,h*.016*headscale,h*.016*headscale),7,{'head':1},16,12,1)
        # Nostrils on the bill, embedded and dark.
        m.oval((s*h*headscale*(.076 if water else .035),head[1]-.005*h*headscale,head[2]+h*.14*headscale),
               (h*.002*headscale,h*.004*headscale,h*.009*headscale),7,{'head':1},12,8,.4)
    if kind=='pigeon':m.oval((0,head[1]+.009*h,head[2]+.14*h),(h*.032,h*.018,h*.024),15,{'head':1},16,10)
    # Folded wing: overlapping rounded coverts and individually modelled secondary/primary vanes.
    for s,side in ((-1,'L'),(1,'R')):
        bone='wing'+side
        m.oval((s*halfW*.83,bodyY+h*.02,-halfL*.12),(halfW*.29,h*.155,halfL*.78),2,{bone:1})
        for i in range(12):
            t=i/11
            m.feather((s*halfW*(1.01+.10*t),bodyY+h*(.10-.10*t),halfL*(.22-.12*t)),
                      (s*halfW*(1.13+.06*t),bodyY-h*(.06+.13*t),-halfL*(.40+.61*t)),h*.031,2,bone,h*.018)
        for row in range(3):
            for i in range(8):
                m.feather((s*halfW*(1.12+.02*row),bodyY+h*(.14-.08*row),halfL*(.4-i*.10)),
                          (s*halfW*(1.19+.02*row),bodyY+h*(.045-.08*row),halfL*(.21-i*.10)),h*.036,3,bone,h*.008)
    for i in range(9):
        t=(i-4)/4
        m.feather((t*halfW*.28,bodyY+h*.04,-halfL*.60),
                  (t*halfW*.8,bodyY+h*(.39 if chicken else .04),-halfL*(1.62 if kind=='cockerel' else 1.32)),h*.032,4,'tail',h*.03)
    if chicken:
        # The comb is a fleshy scalloped ridge, wattles hang from the jaw.
        m.loft([((0,head[1]+h*.11,head[2]+h*(i*.039-.10)),h*.014,h*.035)
                for i in range(7)],9,{'head':1},16)
        for i in range(6):
            m.oval((0,head[1]+h*(.15+.045*math.sin((i+1)*math.pi/7)),head[2]+h*(i*.035-.07)),
                   (h*.014,h*(.045 if kind=='hen' else .070),h*.024),9,{'head':1},16,12)
        for s in (-1,1):m.oval((s*h*.025,head[1]-.11*h,head[2]+h*.064),
                (h*.018,h*(.036 if kind=='hen' else .07),h*.03),9,{'head':1},20,14)
        if kind=='cockerel':
            for i in range(6):
                m.feather((0,bodyY+.08*h,-halfL*.6),((i-2.5)*h*.036,bodyY+h*(.66-i*.05),-halfL*1.7),h*.026,4,'tail',h*.06)
    contacts=[]
    for s,side in ((-1,'L'),(1,'R')):
        hip=(s*halfW*.56,bodyY*.72,.015*h);knee=(s*halfW*.56,bodyY*.40,.07*h);foot=(s*halfW*.56,.014*h,.04*h)
        J['leg'+side]=hip;J['shin'+side]=knee;J['foot'+side]=foot
        parents['leg'+side]='body';parents['shin'+side]='leg'+side;parents['foot'+side]='shin'+side
        m.tube([hip,knee,foot],[h*.035,h*.023,h*.016],8,[{'leg'+side:1},{'leg'+side:.4,'shin'+side:.6},{'shin'+side:1}])
        for toe in range(3):
            start=np.array(foot);end=start+np.array([(toe-1)*h*.056,0,h*.125])
            m.tube([start,(start+end)*.5+np.array([0,h*.005,0]),end],[h*.013,h*.009,h*.0008],8,{'foot'+side:1},8)
            if water and toe<2:m.feather(foot,tuple(end+np.array([h*.02,0,-h*.015])),h*.043,8,'foot'+side,.001)
        m.tube([foot,(foot[0],foot[1],foot[2]-.07*h)],[h*.01,.0002],8,{'foot'+side:1},8)
        contacts.append(('leg'+side,'shin'+side,'foot'+side,hip,knee,foot))
    return m,J,parents,contacts,h


def goat():
    m=Mesh();h=.76
    J={'body':(0,.54,0),'neck':(0,.60,.35),'head':(0,.82,.53),'tail':(0,.64,-.44),'jaw':(0,.755,.59)}
    parents={'body':None,'neck':'body','head':'neck','tail':'body','jaw':'head'}
    m.loft([((0,y,z),rx,ry) for z,y,rx,ry in [(-.50,.57,.025,.035),(-.43,.57,.13,.15),(-.30,.53,.19,.21),
            (-.06,.53,.205,.24),(.18,.54,.18,.215),(.33,.59,.135,.16),(.43,.62,.05,.08)]],0,sides=40)
    for s in (-1,1):
        m.oval((s*.12,.56,.25),(.045,.115,.117),0,{'body':1},24,16)
        m.oval((s*.12,.54,-.32),(.055,.14,.125),0,{'body':1},24,16)
    m.loft([((0,.57+.24*t,.30+.21*t),.125-.047*t,.17-.08*t) for t in np.linspace(0,1,12)],1,
           [{'body':1-t,'neck':t} for t in np.linspace(0,1,12)],32)
    m.loft([((0,.84-.08*t,.43+.31*t),.095*(1-t*.50),.12*(1-t*.57)) for t in np.linspace(0,1,14)],1,{'head':1},32)
    m.loft([((0,.754,.57+.17*t),.048*math.sin(math.pi*t)**.35+.00002,.026*math.sin(math.pi*t)**.5+.00002)
            for t in np.linspace(0,1,16)],1,{'jaw':1},24)
    for s in (-1,1):
        m.oval((s*.082,.832,.570),(.010,.016,.022),14,{'head':1},24,16,.9)
        m.oval((s*.092,.832,.570),(.002,.0035,.017),7,{'head':1},16,12,1)
        # Flattened leaf ears emerge from the side of the skull.
        m.feather((s*.066,.868,.47),(s*.22,.82,.51),.045,10,'head',.016,.002)
        pts=[(s*(.063+.025*t),.918+.23*t-.04*t*t,.465-.18*t*t) for t in np.linspace(0,1,18)]
        m.tube(pts,[.027*(1-t)**.65+.0003 for t in np.linspace(0,1,18)],11,{'head':1},16)
        m.oval((s*.045,.767,.733),(.008,.006,.007),7,{'head':1},16,12,.45)
    for i in range(15):
        m.tube([(i*.003-.021,.748,.657),(i*.003-.021,.68,.64),(i*.002-.014,.61,.61)],[.004,.004,.0003],3,{'head':1},6)
    m.tube([(0,.64,-.44),(0,.75,-.48),(0,.80,-.47)],[.033,.025,.001],4,{'tail':1},16)
    contacts=[]
    for row,z in [('F',.29),('H',-.32)]:
        for s,side in [(-1,'L'),(1,'R')]:
            nm=row+side;hip=(s*.12,.57,z);knee=(s*.13,.29,z+(.035 if row=='F' else -.045));foot=(s*.135,.035,z+.04)
            J['leg'+nm]=hip;J['shin'+nm]=knee;J['foot'+nm]=foot
            parents['leg'+nm]='body';parents['shin'+nm]='leg'+nm;parents['foot'+nm]='shin'+nm
            m.tube([hip,(s*.135,.43,z),knee,foot],[.073,.051,.027,.024],0,
                   [{'leg'+nm:1},{'leg'+nm:1},{'leg'+nm:.4,'shin'+nm:.6},{'shin'+nm:1}],20)
            for split in (-1,1):m.oval((foot[0]+split*.016,.038,foot[2]+.02),(.014,.033,.051),12,{'foot'+nm:1},20,12)
            contacts.append(('leg'+nm,'shin'+nm,'foot'+nm,hip,knee,foot))
    return m,J,parents,contacts,h


def rodent(kind):
    squirrel=kind=='squirrel';m=Mesh();h=.24 if squirrel else .115;sc=1.10 if squirrel else 1.0
    J={'body':(0,.066*sc,0),'neck':(0,.09*sc,.077*sc),'head':(0,.093*sc,.115*sc),'tail':(0,.054*sc,-.115*sc)}
    parents={'body':None,'neck':'body','head':'neck','tail':'body'}
    m.loft([((0,y*sc,z*sc),rx*sc,ry*sc) for z,y,rx,ry in [(-.12,.060,.006,.008),(-.10,.062,.043,.049),
             (-.055,.063,.051,.055),(0,.061,.044,.049),(.055,.070,.034,.038),(.086,.080,.016,.024)]],0,sides=32)
    muzzle=.060 if squirrel else .075
    nose=.078+muzzle
    m.loft([((0,(.093-.019*t)*sc,(.078+muzzle*t)*sc),(.034*(1-t*.91))*sc,(.030*(1-t*.84))*sc)
            for t in np.linspace(0,1,14)],1,{'head':1},28)
    for s in (-1,1):
        m.oval((s*.023*sc,.101*sc,.113*sc),(.0035*sc,.005*sc,.005*sc),7,{'head':1},20,14,1)
        m.oval((s*.030*sc,.130*sc,.078*sc),(.012*sc,(.026 if squirrel else .017)*sc,.005*sc),10,{'head':1},24,16)
        for i in range(6):
            p=(s*.018*sc,(.075+i*.002)*sc,(nose-.031)*sc)
            m.tube([p,(s*(.057+i*.003)*sc,(.078+i*.003)*sc,(nose-.063+i*.011)*sc)],
                   [.00032*sc,.00007*sc],13,{'head':1},5)
    m.oval((0,.073*sc,nose*sc),(.007*sc,.006*sc,.003*sc),9,{'head':1},16,12,.45)
    tail=[]
    for i in range(24):
        t=i/23
        tail.append((math.sin(t*math.pi)*.017*sc,(.054+.27*math.sin(t*math.pi/2))*sc if squirrel else (.054-.04*t)*sc,
                     (-.115-.17*math.sin(t*math.pi*.8))*sc if squirrel else (-.115-.24*t)*sc))
    m.tube(tail,[((.022*(1-t)+.060*math.sin(t*math.pi)**.55) if squirrel else .006*(1-t)**.7)*sc+.0002
                 for t in np.linspace(0,1,24)],4,{'tail':1},20)
    if squirrel:
        for i in range(24):
            t=i/23;p=tail[i];m.feather(p,(p[0]+(.028 if i%2 else -.028)*sc,p[1]+.012*sc,p[2]-.033*sc),.012*sc,4,'tail',.004*sc)
    contacts=[]
    for row,z in [('F',.056),('H',-.068)]:
        for s,side in [(-1,'L'),(1,'R')]:
            nm=row+side;hip=(s*.030*sc,.068*sc,z*sc);knee=(s*.041*sc,.034*sc,(z-.011)*sc);foot=(s*.041*sc,.005*sc,(z+.009)*sc)
            for name,p,par in [('leg'+nm,hip,'body'),('shin'+nm,knee,'leg'+nm),('foot'+nm,foot,'shin'+nm)]:J[name]=p;parents[name]=par
            m.tube([hip,knee,foot],[.019*sc,.011*sc,.007*sc],0,[{'leg'+nm:1},{'leg'+nm:.5,'shin'+nm:.5},{'shin'+nm:1}],14)
            for toe in range(4):
                p=(foot[0]+(toe-1.5)*.004*sc,foot[1],foot[2]);m.tube([p,(p[0],p[1],p[2]+.022*sc)],[.0024*sc,.0001],8,{'foot'+nm:1},6)
            contacts.append(('leg'+nm,'shin'+nm,'foot'+nm,hip,knee,foot))
    return m,J,parents,contacts,h

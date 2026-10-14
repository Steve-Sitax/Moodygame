"""Workers' socket kit. Loads and vehicles refer to the existing shared models.

The chimney brush is a separate reusable model, in the back socket's +y frame.
Rounded hardwood ferrules and radial bristle bundles, never a solid black sphere.
"""
import math
import numpy as np
from . import clothes_kit as ck
from .clothes_kit import Cloth
from .held import sweep

SHARED = {
    "docker_sack": ("sack", "shoulderL", "Carried.Sack via work.loads.sack; one shared sack"),
    "porter": ("quaygoods:sack_truck_bare", "gripL,gripR", "shared quay sack truck; requires native two-grip vehicle attachment"),
    "carter": ("props:tr_handcart", "gripL,gripR", "PushCart; shared handcart on its wheels"),
}


def chimney_brush():
    wood=ck.Piece("chimney_handle",Cloth((.23,.17,.11),"wood",wear=.7,folds=0),scale=1.2)
    sweep(wood,[(0,-.30,0),(0,-.295,0),(0,.72,0),(0,.73,0)],.012,.012,10)
    sweep(wood,[(.028,-.30,0),(.028,-.295,0),(.028,.68,0),(.028,.69,0)],.011,.011,8)
    ferrule=ck.Piece("chimney_ferrule",Cloth((.10,.09,.07),"metal",wear=.7,folds=0),scale=1.2)
    sweep(ferrule,[(0,.68,0),(0,.685,0),(0,.74,0),(0,.745,0)],.023,.023,12)
    bristles=ck.Piece("chimney_bristles",Cloth((.09,.074,.055),"wood",wear=.8,dust=.5,folds=0),scale=1.2)
    for i in range(32):
        a=i*2*math.pi/32
        d=np.array((math.cos(a),0,math.sin(a)))
        path=[d*.015+np.array((0,.715,0)),d*.070+np.array((0,.72+.012*math.sin(i),0)),
              d*(.115+.008*math.sin(i*3))+np.array((0,.725,0))]
        sweep(bristles,path,[.008,.006,.002],[.006,.004,.0015],4)
    rope=ck.Piece("chimney_rope",Cloth((.27,.23,.15),"linen",wear=.65,dust=.4,folds=0),scale=1.2)
    for k in range(2):
        path=[(.075*math.cos(a),-.16+.095*math.sin(a),-.065+k*.008)
              for a in np.linspace(0,2*math.pi,25)]
        sweep(rope,path,.005,.005,4,caps=(False,False),up=(0,0,1))
    pieces=[wood,ferrule,bristles,rope]
    # Same shoulder-carried gear as the old sweep: rods run from behind the
    # shoulder to the brush in front; the rope coil hangs behind, clear of hands.
    angle=math.radians(32)
    for pc in pieces:
        for p in pc.V:
            x,y,z=p.copy()
            p[:]=(.14+x,y*math.cos(angle)-z*math.sin(angle),y*math.sin(angle)+z*math.cos(angle))
    return pieces


def register(held):
    """Called by the build entry, so held.py remains owned by the common cloth lane."""
    held.MODELS["held_chimney_brush"]=chimney_brush

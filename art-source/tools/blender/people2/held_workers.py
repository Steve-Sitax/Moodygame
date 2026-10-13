"""Workers' socket kit. Loads and vehicles refer to the existing shared models.

The chimney brush is a separate reusable model, in the grip socket's +y frame.
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
    ferrule=ck.Piece("chimney_ferrule",Cloth((.10,.09,.07),"metal",wear=.7,folds=0),scale=1.2)
    sweep(ferrule,[(0,.68,0),(0,.685,0),(0,.74,0),(0,.745,0)],.023,.023,12)
    bristles=ck.Piece("chimney_bristles",Cloth((.09,.074,.055),"wood",wear=.8,dust=.5,folds=0),scale=1.2)
    for i in range(32):
        a=i*2*math.pi/32
        d=np.array((math.cos(a),0,math.sin(a)))
        path=[d*.015+np.array((0,.715,0)),d*.070+np.array((0,.72+.012*math.sin(i),0)),
              d*(.115+.008*math.sin(i*3))+np.array((0,.725,0))]
        sweep(bristles,path,[.008,.006,.002],[.006,.004,.0015],4)
    return [wood,ferrule,bristles]


def register(held):
    """Called by the build entry, so held.py remains owned by the common cloth lane."""
    held.MODELS["held_chimney_brush"]=chimney_brush

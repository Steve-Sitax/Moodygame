
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import sys; import preview as P, layout as L, pickle
kind=sys.argv[1]
lay=P.build(kind)
pickle.dump(lay,open(L.W+f'lay-{kind}.pkl','wb'))

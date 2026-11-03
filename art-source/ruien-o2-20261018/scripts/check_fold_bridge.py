# Checks the folding footbridge markers of built exports (kit/fold_bridge.py, #286, #283): span 3.08 m over a 2.8 m
# channel, level pivots at walk level, the gear side square to the span. Plain Python (numpy), no Blender.
# python -I check_fold_bridge.py <export dir> [<export dir> ...]
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import fold_bridge as FB
bad = 0
for d in sys.argv[1:]:
    man = json.load(open(os.path.join(d, 'manifest.json')))
    for mk in man['markers'].get('bridges', []):
        ok, span = FB.check(mk)
        a, b, g = np.array(mk['a']), np.array(mk['b']), np.array(mk['gear'])
        u = (b - a)[[0, 2]] / span
        square = abs(float(u @ g)) < 1e-6 and abs(np.linalg.norm(g) - 1) < 1e-6
        walk = mk['a'][1] in (-3.6, -3.9)
        good = ok and square and walk
        bad += not good
        print('%s %s: span %.3f, walk %.2f, gear %s: %s' % (man['route'], mk['id'], span, mk['a'][1], mk['gear'], 'PASS' if good else 'FAIL'))
sys.exit(1 if bad else 0)

# Three-way merge of a town shader: the generator's old code (O), the stored code (S: O with earlier repairs' additions),
# the generator's new code (N). The repairs' edits are put onto N where they sit in O; any overlap with N's edits stops it.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import sys, difflib, pathlib
d = pathlib.Path(sys.argv[1])
for name in sys.argv[2:]:
    O = (d / f'{name}.gdshader.old').read_text().split('\n')
    S = (d / f'{name}.gdshader.stored').read_text().split('\n')
    N = (d / f'{name}.gdshader').read_text().split('\n')
    on = difflib.SequenceMatcher(None, O, N, autojunk=False)
    # O line -> N line where O's line is unchanged in N
    omap = {}
    changedO = set()
    for tag, i1, i2, j1, j2 in on.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1): omap[i1 + k] = j1 + k
        else:
            changedO.update(range(i1, i2))
            if i1 == i2: changedO.add(i1 - 1 if i1 > 0 else 0); changedO.add(i1)
    os_ = difflib.SequenceMatcher(None, O, S, autojunk=False)
    out = list(N); shift = 0; ok = True
    edits = []
    for tag, i1, i2, j1, j2 in os_.get_opcodes():
        if tag == 'equal': continue
        span = set(range(i1, i2)) if i2 > i1 else {i1 - 1, i1}
        if span & changedO: print(name, 'CONFLICT at old lines', i1, i2); ok = False; break
        if i2 > i1:
            a, b = omap[i1], omap[i2 - 1] + 1
        else:
            a = b = omap[i1 - 1] + 1
        edits.append((a, b, S[j1:j2]))
    if not ok: continue
    for a, b, lines in sorted(edits, reverse=True):
        out[a:b] = lines
    (d / f'{name}.gdshader.merged').write_text('\n'.join(out))
    print(name, 'merged', len(edits), 'edits;', len(N), '->', len(out), 'lines')

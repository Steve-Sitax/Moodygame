"""Issues #170 and #91: the town's street paving laid again, setts in rows across each street following its centre line.
    PAVE_WORK=<work folder outside the repository> python native-godot/scripts/paving/pave_town.py
The work folder must hold dump/ (dump-ground.gd: the ground meshes as rows and every triangle near the ground, from the
ORIGINAL meshes, never from installed ones) and slabdump/ (dump-slabs.gd: the town blocks' old stone). Writes candidate/
(ground_cobble.f32, ground_flags.f32, ground_quay.f32 world-space rows; slab-dirs.json) and the steps' maps and pictures.
Steps: obstacles.py (the permanent structures near the ground at 5 cm), street_mask.py (the visible paving of each ground
mesh), skeleton.py and chains.py (each paving's centre lines, cut at its junctions, straight-through pieces joined),
pvk.py (layout.py: each street's corridor, the edge course along its general line, squares), buildall.py (mesher.py:
the ground cut along every joint, each face's corners with its patch's uv), slabdirs.py (the pavements' way).
Needs numpy, scipy, scikit-image, shapely 2.1, opencv, networkx, Pillow."""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); work = os.environ['PAVE_WORK']
os.makedirs(os.path.join(work, 'work'), exist_ok=True)
def run(*a):
    print('>', *a, flush=True)
    subprocess.run([sys.executable, os.path.join(here, a[0]), *a[1:]], check=True, env=dict(os.environ, PAVE_WORK=work))
run('obstacles.py'); run('street_mask.py')
for k in ['cobble', 'quay', 'flags']: run('skeleton.py', k); run('chains.py', k); run('pvk.py', k)
for k in ['cobble', 'quay', 'flags']: run('buildall.py', k, os.path.join(work, 'candidate'))
run('slabdirs.py')

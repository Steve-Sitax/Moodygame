"""Headless contract checks for kit/meet.py (tee and throat) on synthetic routes; no textures or render.
Run: blender --background --factory-startup --python scripts/check_meet.py"""
import os
import sys
import bpy, bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from kit.sweep import Section, RoutePath
from kit import meet as KM

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new('fixture')
class Mats(dict):
    def __missing__(self, k):
        return mat
mats = Mats()
ANTIGOON = 3.85
routes = {
    'GA': dict(**{'class': 'G'}, pts=[[0, 0], [0, 15]]),
    'GB': dict(**{'class': 'G'}, pts=[[0, 15], [0, 30]]),
    'MT': dict(**{'class': 'M'}, pts=[[12, 15.2], [0, 15]]),            # ends in GA/GB's side (tee)
    'GC': dict(**{'class': 'G'}, pts=[[40, 0], [40, 20]]),
    'MR': dict(**{'class': 'M'}, pts=[[40, 20], [40.5, 34]]),          # starts where GC ends (throat, 2 degrees)
}
for side in (1, -1):
    sec = lambda rid: Section(routes[rid]['class'], side)
    path = lambda rid: RoutePath(routes[rid]['pts'], r=sec(rid).W * 1.2)
    coll = bpy.data.collections.new('meet_%d' % side); bpy.context.scene.collection.children.link(coll)
    tees = KM.find_tees(routes, 'MT', path, sec)
    assert len(tees) == 1 and tees[0].host_ids == ['GA', 'GB'] and tees[0].which == 'end', tees
    assert len(KM.find_tees(routes, 'GA', path, sec)) == 1 and not KM.find_tees(routes, 'GC', path, sec)
    throats = KM.find_throats(routes, 'MR', path, sec)
    assert len(throats) == 1 and throats[0].host_ids == ['GC'] and throats[0].which == 'start', throats
    for t in tees + throats:
        kind = type(t).__name__
        b, h = t.bsec, t.hsec
        obs = t.build('fx', mats, coll, np.random.default_rng(1))
        ring = obs[0]
        bm = bmesh.new(); bm.from_mesh(ring.data)
        assert all(e.is_manifold for e in bm.edges), kind + ': ring not closed'
        bm.free()
        tops = {o.name.split('_')[-1].split('.')[0]: max(v.co.z for v in o.data.vertices) for o in obs if '_step' in o.name or '_threshold' in o.name or 'giantstep' in o.name or '_sill' in o.name}
        # walk route: ledge -> threshold (1 cm proud) -> step -> rui walkway, no riser over 16 cm
        levels = [h.ledge_y, tops['threshold'], tops['step'], b.ledge_y]
        assert abs(tops['threshold'] - (h.ledge_y + 0.01)) < 0.02 and all(abs(a - c) <= 0.17 for a, c in zip(levels, levels[1:])), (kind, levels)
        # giant's route: gallery bed -> step -> sill at the rui bed, no step over 0.65 m (he is 3.85 m tall)
        g_levels = [h.bed, tops['giantstep'], tops['sill']]
        assert abs(tops['sill'] - b.bed) < 0.02 and all(c - a <= 0.65 for a, c in zip(g_levels, g_levels[1:])), (kind, g_levels)
        # the ring leaves the giant's head room where he stands upright on the rui bed, under the crown:
        # his 0.928 m capsule (radius 0.464) topped at bed + 3.85
        V = np.array([tuple(v.co) for v in ring.data.vertices]); Vg = np.stack([V[:, 0], V[:, 2], -V[:, 1]], -1)
        q, l, y = t.local(Vg)
        on_rui_bed = (q > float(np.max(t.q_chan(np.array(t.cl))))) if kind == 'Tee' else (q > 0)
        R_ = 0.464
        head = b.bed + ANTIGOON - R_ + np.sqrt(np.clip(R_ * R_ - l * l, 0, None))
        low = on_rui_bed & (np.abs(l) < R_) & (y < head)
        assert not low.any(), (kind, 'ring under the giant', y[low].min() if low.any() else None)
        # water: the rui water starts at its sill lip; the film reaches below the gallery water
        spill = [o for o in obs if '_spill' in o.name][0]
        sy = [v.co.z for v in spill.data.vertices]
        assert abs(max(sy) - b.water) < 0.01 and min(sy) < h.water, (kind, max(sy), min(sy))
        print('PASS', kind, 'walkway side', side, 'levels', [round(x, 3) for x in levels], 'giant', [round(x, 3) for x in g_levels])
print('PASS: tee and throat, both walkway sides')

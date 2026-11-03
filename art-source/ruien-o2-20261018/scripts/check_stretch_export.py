"""Headless Blender contract checks; no textures, saved world or render needed."""
import os
import sys
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import export_game as E
from kit.sweep import Section, RoutePath, grate_shaft
from rlib import util as U

bpy.ops.wm.read_factory_settings(use_empty=True)
E.sc = bpy.context.scene
for cls, side in [('G', 1), ('M', 1), ('M', -1)]:
    sec = Section(cls, side)
    assert E.prepare_movers(sec) == [] and not E.MOVERS and not E.PIVOTS
    path = RoutePath([(20, 30), (35, 30), (40, 40)], r=sec.W * 1.2)
    coll = U.coll('fixture_' + cls + str(side))
    mat = bpy.data.materials.new('fixture')
    s = sec.sides[0] * (sec.hw - (sec.ledge_w * .55 if cls == 'M' else .65))
    objects = grate_shaft(path, sec, 5., s, dict(brick_vault=mat, iron=mat), coll)
    # A misplaced height/lateral argument used to put the grate below the street.
    for obj in objects:
        if obj.name.startswith('grate_bar'):
            y = E.b2g(E.MD.from_object(obj).V)[:, 1]
            assert y.min() > -.11 and y.max() < .01, (cls, side, y.min(), y.max())
    flame = bpy.data.materials.new('Lamp_flame_fixture')
    lamp = U.mesh_from_faces('lamp', np.array([[21., -2., 30.], [21.1, -2., 30.], [21., -1.9, 30.]]), [[0, 1, 2]], coll_=coll, mat=flame)
    info = dict(route='fixture', placements=[dict(piece='grate_shaft_parametric', u=5.,
        pos=path.world(np.array(5.), np.array(s), np.array(sec.ledge_y)).tolist())])
    mk = E.markers(coll, [lamp], path, sec, info)
    assert len(mk['lamps']) == len(mk['flames']) == len(mk['ladders']) == len(mk['daylight_openings']) == 1
    assert 'outlet' not in mk and mk['stairs'] == []
    assert mk['water'][0]['height'] == sec.water
    assert abs(mk['water'][0]['width'] - (3. if cls == 'G' else 2.8)) < 1e-6
    assert mk['ladders'][0]['bottom'][1] == sec.ledge_y
    assert all(m['min'][1] == sec.water for m in mk['mist'])
    centres = path.world(np.array([1., 11., 21.]), np.zeros(3), np.zeros(3))
    assert list(E.area_keys(centres, path)) == ['s0', 's1', 's2']
    collision = E.collision(U.coll('collision_' + cls + str(side)), objects)
    assert len(collision) == len(objects)
    for src, dst in zip(objects, collision):
        assert np.allclose(E.MD.from_object(src).V, E.MD.from_object(dst).V)
print('PASS: G, M left and M right; grate height, lamp/flame, ladder, water, mist, route keys and collision')

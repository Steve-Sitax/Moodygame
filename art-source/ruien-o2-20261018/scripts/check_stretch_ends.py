"""Blender regression for #274: end fans must cover the channel below their centre."""
import os
import sys
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(__file__))
from kit.sweep import Section, RoutePath, end_piece
from rlib import util as U

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new('fixture')
mats = dict(brick_channel=mat, soot_black=mat, brick_loose=mat)
checks = 0
for cls, side in [('G', 1), ('M', 1), ('M', -1)]:
    sec = Section(cls, side)
    path = RoutePath([(20, 30), (35, 30), (40, 40)], r=sec.W * 1.2)
    for which, u in [('start', 0.), ('end', path.length)]:
        for kind in ['open', 'junction', 'cap']:
            objects = end_piece(path, sec, u, kind, which, mats, U.coll('ends'))
            mesh = objects[0].data
            tree = BVHTree.FromPolygons([v.co for v in mesh.vertices],
                                       [list(p.vertices) for p in mesh.polygons])
            _, _, tx, tz, _, _ = path.frame(np.array(u))
            direction = Vector(U.g2b([tx, 0., tz]))
            # Across the channel and below the old fan centre; also above it.
            for s in np.linspace(-sec.hw + .1, sec.hw - .1, 15):
                for y in [sec.bed - .1, sec.water + .1, sec.ledge_y + .3, sec.spring]:
                    target = Vector(U.g2b(path.world(np.array(u), np.array(s), np.array(y))))
                    hit = tree.ray_cast(target - direction, direction, 2.)[0]
                    assert hit is not None, (cls, side, which, kind, s, y)
                    checks += 1
print('PASS: %d end coverage rays; G and both M sides, both ends, open/junction/cap' % checks)

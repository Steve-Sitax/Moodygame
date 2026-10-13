"""CC0 hen and Street Rat, adapted as data to the small-life palette rig and 1024 px pictures.

Original downloads and licences are preserved in art-source/third_party. Libraries are read with
auto-execution disabled by the build wrapper; no donor scripts, rig drivers or actions are run.
"""
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

from .geometry import Mesh

ROOT = Path(__file__).resolve().parents[3] / 'third_party'
_pictures = {}


def image(path, normal=False):
    im = bpy.data.images.load(str(path), check_existing=False)
    if normal:
        im.colorspace_settings.name = 'Non-Color'
    im.scale(1024, 1024)
    pixels = np.empty(1024 * 1024 * 4, np.float32)
    im.pixels.foreach_get(pixels)
    out = np.flipud(pixels.reshape(1024, 1024, 4))[..., :3].copy()
    bpy.data.images.remove(im)
    return out


def adapt(kind, reference):
    if kind not in ('hen', 'rat'):
        return reference
    original, J, parents, contacts, h = reference
    hen = kind == 'hen'
    folder = ROOT / ('opengameart-chicken' if hen else 'polyhaven-street-rat')
    source = folder / ('original/chickenV2.blend' if hen else 'street_rat_2k.blend')
    with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
        loaded.objects = ['Chicken', 'Eyes', 'Armature'] if hen else ['street_rat']
    objects = [o for o in loaded.objects if o]
    for ob in objects:
        bpy.context.scene.collection.objects.link(ob)
        if ob.type == 'ARMATURE':
            ob.data.pose_position = 'REST'
            for bone in ob.pose.bones:
                for constraint in bone.constraints:
                    constraint.mute = True
        # Donor hair systems are not part of the portable geometry. The rat's control mesh
        # retains its authored loops; the hen gets one smooth subdivision for rounded edges.
        for modifier in list(ob.modifiers):
            if modifier.type != 'ARMATURE':
                ob.modifiers.remove(modifier)
        if hen and ob.type == 'MESH' and ob.name.startswith('Chicken'):
            modifier = ob.modifiers.new('rounded_hen', 'SUBSURF')
            modifier.levels = 1
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    evaluated = []
    points = []
    for ob in objects:
        if ob.type != 'MESH':
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh(preserve_all_data_layers=True, depsgraph=dg)
        me.calc_loop_triangles()
        v = np.array([tuple(ob.matrix_world @ p.co) for p in me.vertices])
        evaluated.append((ob, ev, me, v))
        points.extend(v)
    points = np.array(points)
    lo, hi = points.min(axis=0), points.max(axis=0)
    scale = .43 / (hi[2] - lo[2]) if hen else .51107347 / (hi[1] - lo[1])
    def game(p):
        # Both donors are Z-up, nose along -Y. Preserve proportions with uniform scaling.
        return np.array([p[0] * scale, (p[2] - lo[2]) * scale,
                         -p[1] * scale + (0 if hen else .153 + lo[1] * scale)])
    if hen:
        arm = next(o for o in objects if o.type == 'ARMATURE')
        names = {'body': 'Hip', 'neck': 'Bone.003', 'head': 'Head', 'tail': 'Bone.006',
                 'legL': 'Leg_R.001', 'shinL': 'Leg_R.002', 'footL': 'Finger3_R',
                 'legR': 'Leg_L.001', 'shinR': 'Leg_L.002', 'footR': 'Finger3_L'}
        for target, name in names.items():
            J[target] = game(arm.matrix_world @ arm.data.bones[name].head_local)
        contacts = [(up, low, foot, J[up], J[low], J[foot]) for up, low, foot, *_ in contacts]
    tree = KDTree(len(original.v))
    for i, p in enumerate(original.v):
        tree.insert(Vector(p), i)
    tree.balance()
    m = Mesh()
    m.normal = []
    for ob, ev, me, v in evaluated:
        groups = {g.index: g.name for g in ob.vertex_groups}
        corners = {}
        def weights(vertex, point):
            result = {}
            if hen:
                for group in vertex.groups:
                    n = groups.get(group.group, '')
                    if n.startswith('Finger'):
                        target = 'footR' if '_L' in n else 'footL'
                    elif n.startswith('Leg_'):
                        target = ('shin' if n.endswith('.002') else 'leg') + ('R' if '_L' in n else 'L')
                    else:
                        target = {'Head': 'head', 'Head_L': 'head', 'Head_R': 'head',
                                  'Bone.004': 'neck', 'Bone.003': 'neck', 'Bone.006': 'tail'}.get(n, 'body')
                    result[target] = result.get(target, 0) + group.weight
            else:
                _, i, _ = tree.find(Vector(point))
                result = original.weights[i].copy()
            best = sorted(result.items(), key=lambda item: -item[1])[:2]
            if hen and .12 < point[1] < .31 and point[2] < .06 and abs(point[0]) > .062:
                blend = min(1., (abs(point[0]) - .062) / .018)
                best = [('wingL' if point[0] < 0 else 'wingR', blend), ('body', 1 - blend)]
            total = sum(w for _, w in best)
            return {n: w / total for n, w in best} if total > 0 else {'body': 1}
        uv = me.uv_layers.active
        if uv is None:
            raise ValueError('CC0 donor has no UVs')
        for triangle in me.loop_triangles:
            face = []
            for loop in triangle.loops:
                i = me.loops[loop].vertex_index
                normal = ob.matrix_world.to_3x3().inverted().transposed() @ me.corner_normals[loop].vector
                normal.normalize()
                texture_uv = tuple(uv.data[loop].uv)
                key = (i, texture_uv, tuple(normal))
                if key in corners:
                    face.append(corners[key])
                    continue
                p = game(v[i])
                corners[key] = len(m.v)
                face.append(len(m.v))
                m.v.append(tuple(p)); m.uv.append(texture_uv)
                m.weights.append(weights(me.vertices[i], p))
                m.eye.append(1 if ob.name.startswith('Eyes') else .04)
                m.normal.append((normal.x, normal.z, -normal.y))
            m.f.append(tuple(face))
        ev.to_mesh_clear()
    for ob in objects:
        bpy.data.objects.remove(ob, do_unlink=True)
    texture = folder / ('original/textures/UV-Texture.png' if hen else 'textures/street_rat_diff_2k.jpg')
    normal = folder / ('original/textures/ChickenNorm.png' if hen else 'textures/street_rat_nor_gl_2k.jpg')
    _pictures[kind] = (image(texture), image(normal, True))
    print('CC0 ADAPTED', kind, len(m.f), 'triangles; uniform scale', scale)
    return m, J, parents, contacts, h


def pictures(kind):
    return _pictures[kind]

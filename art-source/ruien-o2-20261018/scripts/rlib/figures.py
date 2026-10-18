# Scale figures for renders only (never exported): a 1.8 m sewer worker with a lantern, a 4.4 m gaunt giant.
import numpy as np
import bpy
from . import util as U
from . import props as PR

def skin_body(name, joints, edges, radii, coll_, mat, subdiv=2):
    """joints: list of (x, y, z) local game axes. radii: list of (rx, ry)."""
    V = U.g2b(np.array(joints, float))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], edges, [])
    ob = bpy.data.objects.new(name, me)
    coll_.objects.link(ob)
    sk = ob.modifiers.new('Skin', 'SKIN')
    sk.use_smooth_shade = True
    for i, sv in enumerate(me.skin_vertices[0].data):
        sv.radius = radii[i]
    me.skin_vertices[0].data[0].use_root = True
    ss = ob.modifiers.new('Sub', 'SUBSURF')
    ss.levels = subdiv
    ss.render_levels = subdiv
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = bpy.data.meshes.new_from_object(ev)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bpy.data.objects.new(name, m2)
    coll_.objects.link(out)
    m2.materials.clear()
    m2.materials.append(mat)
    m2.polygons.foreach_set('use_smooth', np.ones(len(m2.polygons), bool))
    return out

def worker(mats, coll_, name='scale_man'):
    J = [(0, 0.97, 0), (0, 1.18, 0.0), (0, 1.38, 0.0), (0, 1.53, 0.01), (0, 1.66, 0.02), (0, 1.79, 0.02),   # 0-5 spine to head top
         (0.1, 0.94, 0), (0.115, 0.52, 0.03), (0.115, 0.09, 0.0), (0.115, 0.04, 0.15),                        # 6-9 left leg
         (-0.1, 0.94, 0), (-0.1, 0.52, -0.02), (-0.105, 0.09, -0.06), (-0.105, 0.04, 0.09),                    # 10-13 right leg
         (0.2, 1.45, 0), (0.25, 1.17, 0.03), (0.26, 0.93, 0.08), (0.26, 0.85, 0.1),                            # 14-17 left arm
         (-0.2, 1.45, 0), (-0.26, 1.2, 0.1), (-0.27, 1.04, 0.29), (-0.27, 1.0, 0.33)]                         # 18-21 right arm (lantern forward)
    E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (0, 6), (6, 7), (7, 8), (8, 9), (0, 10), (10, 11), (11, 12), (12, 13),
         (2, 14), (14, 15), (15, 16), (16, 17), (2, 18), (18, 19), (19, 20), (20, 21)]
    Rr = [(0.17, 0.13), (0.16, 0.12), (0.2, 0.14), (0.06, 0.06), (0.1, 0.11), (0.075, 0.085),
          (0.095, 0.095), (0.065, 0.065), (0.055, 0.06), (0.045, 0.04),
          (0.095, 0.095), (0.065, 0.065), (0.055, 0.06), (0.045, 0.04),
          (0.06, 0.06), (0.05, 0.05), (0.04, 0.04), (0.045, 0.03),
          (0.06, 0.06), (0.05, 0.05), (0.04, 0.04), (0.045, 0.03)]
    body = skin_body(name + '_body', J, E, Rr, coll_, mats['cloth'])
    # long oilcloth coat skirt and a flat cap
    skirt = U.lathe([(0.2, 0.42), (0.215, 0.6), (0.2, 0.8), (0.19, 1.0), (0.205, 1.25), (0.0, 1.25)], 20, name + '_coat', coll_, mats['coat'])
    me = skirt.data
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co[:, 1] *= 0.75   # flatten front-back (Blender Y = -game z)
    me.vertices.foreach_set('co', co.ravel()); me.update()
    cap = U.lathe([(0.0, 1.75), (0.11, 1.75), (0.115, 1.78), (0.1, 1.83), (0.0, 1.85)], 20, name + '_cap', coll_, mats['cloth'])
    cap.data.transform(__import__('mathutils').Matrix.Translation((0, -0.03, 0)))
    head = U.lathe([(0.0, 1.57), (0.06, 1.6), (0.085, 1.66), (0.085, 1.72), (0.06, 1.77), (0.0, 1.79)], 16, name + '_head', coll_, mats['skin'])
    hands = [U.lathe([(0, -0.04), (0.035, -0.02), (0.035, 0.03), (0, 0.05)], 10, name + '_hand', coll_, mats['skin']) for _ in range(2)]
    hands[0].data.transform(__import__('mathutils').Matrix.Translation(U.gv(0.26, 0.84, 0.1)))
    hands[1].data.transform(__import__('mathutils').Matrix.Translation(U.gv(-0.27, 0.99, 0.34)))
    fig = U.join([body, skirt, cap, head] + hands, name)
    lamp, light = PR.safety_lamp(name + '_lantern', mats, coll_, light_power=22.0)
    lamp.location = U.gv(-0.27, 0.97, 0.34)
    lamp.parent = fig
    U.set_hidden_from_export(fig)
    U.set_hidden_from_export(lamp)
    return fig, lamp, light

def giant(mats, coll_, name='scale_giant'):
    s = 4.4 / 1.8
    J = [(0, 0.95, 0), (0, 1.17, 0.02), (0, 1.37, 0.06), (0, 1.5, 0.1), (0, 1.62, 0.14), (0, 1.72, 0.15),
         (0.09, 0.92, 0), (0.1, 0.5, 0.04), (0.1, 0.07, 0.0), (0.1, 0.03, 0.13),
         (-0.09, 0.92, 0), (-0.1, 0.5, 0.02), (-0.1, 0.07, -0.03), (-0.1, 0.03, 0.1),
         (0.19, 1.42, 0.05), (0.27, 1.07, 0.06), (0.3, 0.72, 0.1), (0.31, 0.58, 0.13),
         (-0.19, 1.42, 0.05), (-0.26, 1.07, 0.1), (-0.29, 0.74, 0.16), (-0.3, 0.6, 0.2)]
    J = [(x * s, y * s, z * s) for (x, y, z) in J]
    E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (0, 6), (6, 7), (7, 8), (8, 9), (0, 10), (10, 11), (11, 12), (12, 13),
         (2, 14), (14, 15), (15, 16), (16, 17), (2, 18), (18, 19), (19, 20), (20, 21)]
    Rr = [(0.12, 0.09), (0.1, 0.075), (0.15, 0.1), (0.045, 0.045), (0.075, 0.085), (0.05, 0.06),
          (0.07, 0.07), (0.045, 0.045), (0.04, 0.045), (0.03, 0.03),
          (0.07, 0.07), (0.045, 0.045), (0.04, 0.045), (0.03, 0.03),
          (0.045, 0.045), (0.035, 0.035), (0.03, 0.03), (0.035, 0.022),
          (0.045, 0.045), (0.035, 0.035), (0.03, 0.03), (0.035, 0.022)]
    Rr = [(a * s, b * s) for (a, b) in Rr]
    body = skin_body(name, J, E, Rr, coll_, mats['giant'])
    U.set_hidden_from_export(body)
    return body

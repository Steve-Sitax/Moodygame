"""Blender technical mesh repair. No image generation or scene-placement changes."""
import bmesh, json, math, pathlib, sys
import numpy as np
from mathutils import Vector

folder = pathlib.Path(sys.argv[sys.argv.index('--') + 1])
rows = json.loads((folder / 'wood-input.json').read_text())
bm = bmesh.new()
uv = bm.loops.layers.uv.new('UVMap')
colour = bm.loops.layers.float_color.new('Col')
points = {}
for start in range(0, len(rows), 3):
    values = rows[start:start + 3][::-1]  # Godot clockwise -> Blender counterclockwise.
    verts = []
    for row in values:
        key = tuple(round(v, 4) for v in row[:3])
        if key not in points:
            points[key] = bm.verts.new(row[:3])
        verts.append(points[key])
    if len(set(verts)) != 3:
        continue
    try:
        face = bm.faces.new(verts)
    except ValueError:
        continue
    for loop, row in zip(face.loops, values):
        loop[uv].uv = row[3:5]
        loop[colour] = row[5:9]
bm.normal_update()
# Work per connected board, retaining its centre and long-grain direction.
visited = set()
boards = 0
contacts = []
for seed in list(bm.verts):
    if seed in visited:
        continue
    component, pending = [], [seed]
    while pending:
        vertex = pending.pop()
        if vertex in visited:
            continue
        visited.add(vertex); component.append(vertex)
        pending.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
    if len(component) < 8:
        continue
    coords = np.array([tuple(v.co) for v in component]); center = coords.mean(axis=0)
    values, axes = np.linalg.eigh(np.cov((coords-center).T))
    if values[-1] < values[-2]*8 or values[-1] < 0.004:
        continue
    axis = Vector(axes[:, -1]); along = [axis.dot(v.co-Vector(center)) for v in component]
    low, high = min(along), max(along)
    if coords[:,1].min() < 0.03 and coords[:,1].max() < 0.10 and abs(axis.y)<0.3:
        length_axis = Vector((axis.x,0,axis.z)).normalized()
        across = Vector((-length_axis.z,0,length_axis.x))
        half_l = (high-low)*0.5+0.018
        half_w = max(abs(across.dot(Vector(p-center))) for p in coords)+0.018
        center3 = Vector((center[0],0.002,center[2]))
        corners = [center3+length_axis*(half_l*x)+across*(half_w*y) for x,y in [(-1,-1),(1,-1),(1,1),(-1,-1),(1,1),(-1,1)]]
        contacts.extend([list(p) for p in corners])
    for vertex, distance in zip(component, along):
        if distance < low+0.002 or distance > high-0.002:
            p = vertex.co
            # Uneven snapped ends, below 12 mm; never add a regular saw-tooth motif.
            cut = 0.002 + 0.010*(0.5+0.5*math.sin(p.x*91.7+p.y*117.3+p.z*61.9))
            vertex.co += axis * (cut if distance < low+0.002 else -cut)
    for face in {face for v in component for face in v.link_faces}:
        if abs(face.normal.dot(axis)) > 0.8:
            for loop in face.loops:
                c = loop[colour]
                loop[colour] = (c[0]*0.72,c[1]*0.72,c[2]*0.72,c[3])
    boards += 1
bm.normal_update()
edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > math.radians(25)]
edge_count = len(edges)
bmesh.ops.bevel(bm, geom=edges, offset=0.0015, segments=2, affect='EDGES', clamp_overlap=True)
bm.normal_update()
# Quiet, irregular wear at newly rounded arrises; no large changes to placements.
for vertex in bm.verts:
    if len(vertex.link_faces) > 3:
        p = vertex.co
        wear = (math.sin(p.x * 157.1 + p.z * 219.3) * 0.5 + 0.5) * 0.0012
        vertex.co -= vertex.normal * wear
bm.normal_update()
bmesh.ops.triangulate(bm, faces=list(bm.faces))
output = []
for face in bm.faces:
    for loop in reversed(list(face.loops)):
        p, n, t, c = loop.vert.co, face.normal, loop[uv].uv, loop[colour]
        output.append([*p, *n, *t, *c])
(folder / 'wood-repaired.json').write_text(json.dumps(output, separators=(',', ':')))
(folder / 'wood-contact.json').write_text(json.dumps(contacts, separators=(',', ':')))
(folder / 'wood-repair-report.json').write_text(json.dumps({'inputTriangles':len(rows)//3,'outputTriangles':len(output)//3,'bevelEdges':edge_count,'bevelMetres':0.0015,'edgeWearMetres':0.0012,'endWearMaxMetres':0.012,'boards':boards},indent=2))
bm.free()
print('Repaired wood edges:', edge_count)


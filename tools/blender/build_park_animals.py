"""Original articulated low-poly waterfowl and red squirrel. Metres, faces game +X.
Each body/wing is one vertex-coloured mesh; the game instances each kind.
blender -b --factory-startup -P tools/blender/build_park_animals.py
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
mat=bpy.data.materials.new('park_animal_feathers_fur');mat.use_nodes=True
nodes=mat.node_tree.nodes; c=nodes.new('ShaderNodeVertexColor'); c.layer_name='Color'
mat.node_tree.links.new(c.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
nodes.get('Principled BSDF').inputs['Roughness'].default_value=1
parts=[]
def color(o,rgb):
    o.data.materials.append(mat)
    att=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for f in o.data.polygons:
        k=.93+.07*max(0,f.normal.z)
        for i in f.loop_indices:att.data[i].color=(*[v*k for v in rgb],1)
    parts.append(o)
def ell(p,s,col):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,location=p)
    o=bpy.context.object;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);color(o,col);return o
def tube(points,radii,col,sides=7):
    vs=[];fs=[]
    for i,p in enumerate(points):
        p=Vector(p);d=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        d.normalize();u=d.cross(Vector((0,1,0))).normalized();v=d.cross(u)
        for j in range(sides):vs.append(p+(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides))*radii[i])
    for i in range(len(points)-1):
        for j in range(sides):fs.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    fs.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    m=bpy.data.meshes.new('curve');m.from_pydata(vs,[],fs);m.update();o=bpy.data.objects.new('curve',m);bpy.context.collection.objects.link(o);color(o,col)
def finish(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');parts.clear();return o
white=(.83,.81,.73); brown=(.37,.27,.16); black=(.025,.025,.022)
for name in ['duck_mallard','duck_female','duck_young','swan','swan_young']:
    swan=name.startswith('swan'); young=name.endswith('young'); hen=name=='duck_female'
    base=white if swan and not young else (.46,.44,.39) if swan else (.48,.35,.18) if young else brown if hen else (.48,.45,.37)
    ell((0,0,.17),(.48 if swan else .28,.23 if swan else .15,.24 if swan else .155),base)
    ell((-.12,0,.28),(.33 if swan else .19,.205 if swan else .13,.14 if swan else .09),base)
    tube([(-.22,0,.19),(-.48 if swan else -.32,0,.27),(-.57 if swan else -.4,0,.29)],[.1,.065,.008],base)
    if swan:
        tube([(.28,0,.22),(.36,0,.4),(.27,0,.65),(.31,0,.86),(.43,0,.92)],[.09,.075,.055,.052,.06],base)
        ell((.46,0,.91),(.12,.075,.08),base);ell((.555,0,.89),(.04,.063,.045),black)
        ell((.62,0,.87),(.075,.043,.028),(.7,.31,.09)); eye=(.5,.069,.935)
    else:
        head=base if young or hen else (.06,.22,.12)
        tube([(.16,0,.18),(.19,0,.33),(.235,0,.4)],[.082,.065,.07],head)
        ell((.255,0,.4),(.105,.074,.082),head);ell((.365,0,.374),(.09,.045,.024),(.57,.43,.12));eye=(.29,.07,.428)
        if not young and not hen:ell((.18,0,.277),(.074,.074,.018),white)
    for sign in [-1,1]:
        ell((eye[0],sign*eye[1],eye[2]),(.012,.01,.012),black)
        ell((-.065,sign*(.2 if swan else .13),.23),(.29 if swan else .19,.035,.10),base)
        if not swan and not young:ell((-.10,sign*.155,.23),(.09,.012,.035),(.12,.17,.29))
        # Tucked feet become visible when a bird steps onto the shore.
        ell((.015,sign*.10,.018),(.075,.036,.018),(.49,.27,.095) if not swan else black)
    o=finish(name)
    if young:o.scale=(.66,.66,.66)
grey=(.43,.40,.34)
ell((0,0,.23),(.40,.20,.24),grey)
ell((-.12,0,.34),(.29,.175,.12),(.34,.32,.28))
tube([(-.22,0,.22),(-.48,0,.31)],[.12,.015],white)
tube([(.24,0,.24),(.29,0,.48),(.34,0,.69)],[.095,.071,.065],grey)
ell((.37,0,.71),(.105,.078,.09),grey)
ell((.49,0,.69),(.078,.043,.033),(.76,.37,.15))
for sign in [-1,1]:
    ell((.40,sign*.073,.742),(.012,.009,.012),black)
    ell((-.055,sign*.185,.28),(.30,.034,.13),(.31,.29,.26))
    for i in range(4):
        tube([(-.22+i*.08,sign*.212,.25),(-.17+i*.08,sign*.214,.33)],[.009,.006],(.62,.58,.49),sides=4)
    tube([(.015,sign*.10,.10),(.025,sign*.10,.035)],[.022,.018],(.67,.33,.16),sides=5)
    ell((.065,sign*.10,.022),(.084,.046,.02),(.67,.33,.16))
finish('goose')
for name,size,col in [('wing_duck',.62,(.41,.38,.29)),('wing_swan',1.12,white),('wing_goose',.88,grey),('wing_songbird',.25,(.16,.14,.10))]:
    # Wing root at origin, span along Blender +Y (game -Z); tapered overlapping primary feathers.
    ell((-.04,size*.32,0),(.17,size*.38,.035),col)
    for i in range(6):
        o=ell((-.12-i*.034,size*(.55+i*.064),-.01),(.18-i*.012,size*.22,.019),col);o.rotation_euler.z=-.45
    wing=finish(name)
    if name=='wing_songbird':wing.scale.x=.45
rust=(.48,.20,.075);cream=(.63,.47,.28)
ell((0,0,.17),(.19,.09,.13),rust);ell((.11,0,.27),(.105,.075,.10),rust)
ell((.185,0,.25),(.085,.051,.055),cream);ell((.255,0,.257),(.018,.027,.018),black)
for sign in [-1,1]:
    ell((.135,sign*.065,.3),(.012,.01,.014),black)
    tube([(.1,sign*.05,.33),(.095,sign*.05,.44)],[.031,.007],rust)
    ell((-.1,sign*.068,.07),(.085,.04,.07),rust)
    tube([(.09,sign*.07,.17),(.135,sign*.06,.035)],[.025,.016],rust)
    ell((.155,sign*.063,.023),(.047,.023,.015),cream)
tube([(-.15,0,.15),(-.28,0,.23),(-.30,0,.44),(-.21,0,.57),(-.12,0,.54)],[.055,.095,.105,.084,.012],rust,sides=9)
finish('squirrel')
feather=(.17,.14,.095)
ell((0,0,.105),(.105,.05,.062),feather)
ell((.06,0,.168),(.049,.04,.045),feather)
ell((.095,0,.162),(.018,.031,.021),(.34,.25,.09))
tube([(.10,0,.161),(.155,0,.153)],[.018,.001],(.65,.43,.12),sides=5)
tube([(-.07,0,.105),(-.20,0,.15)],[.039,.016],feather,sides=5)
for sign in [-1,1]:
    ell((.077,sign*.034,.184),(.008,.005,.008),black)
    ell((-.015,sign*.046,.119),(.078,.013,.031),(.23,.20,.13))
    tube([(.01,sign*.025,.073),(.024,sign*.029,.012)],[.006,.004],(.27,.20,.12),sides=4)
    ell((.04,sign*.03,.01),(.026,.012,.005),(.27,.20,.12))
finish('songbird')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'client/public/models/park_animals.glb'),export_format='GLB',export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_yup=True,export_animations=False)
print('Park wildlife: 12 shared body/wing meshes, original geometry')

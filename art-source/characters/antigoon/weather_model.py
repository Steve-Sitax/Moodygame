"""Add exportable, position-aware Ruien dirt to the approved colour draft.

Vertex colours carry the weathering into GLB/Godot without Blender-only shaders.
The head texture and all geometry remain intact. Values are scene-linear RGB.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector, noise

ROOT=Path(__file__).resolve().parent
TAG='v08-ruien-grime'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v07-blue-trousers-asset.blend'))
obj=bpy.data.objects['Antigoon']
mesh=obj.data

def clamp(v):return max(0.0,min(1.0,v))
def mix(a,b,t):return tuple(x*(1-t)+y*t for x,y in zip(a,b))
def n(p,scale,offset=0):
    return .5+.5*noise.noise_vector(Vector((p.x*scale+offset,p.y*scale,p.z*scale)))[0]
def ramp(a,b,v):
    t=clamp((v-a)/(b-a));return t*t*(3-2*t)

materials={}
for index,mat in enumerate(mesh.materials):
    name=mat.name
    if 'trousers' in name:kind='trousers'
    elif 'leather shoes' in name:kind='shoes'
    elif 'wool' in name.lower():kind='tunic'
    elif 'Hand skin' in name:kind='hands'
    else:continue
    materials[index]=kind
    shader=mat.node_tree.nodes.get('Principled BSDF')
    colour=mat.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Ruien grime'
    mat.node_tree.links.new(colour.outputs['Color'],shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value={'trousers':.93,'shoes':.70,'tunic':.96,'hands':.76}[kind]
    mat.name={'trousers':'Faded slate blue, damp and silt stained','shoes':'Brown leather with sewer mud','tunic':'Dark wool with lower edge grime','hands':'Grimy hands'}[kind]

def colour_at(p,kind):
    broad=n(p,7.3,12.4)
    patch=ramp(.33,.71,n(p,18.0,3.1))
    fleck=ramp(.57,.76,n(p,92.0,7.0))
    streak=n(Vector((p.x*3,p.y*3,p.z*.35)),12,6)
    front=1-ramp(-.1,.3,p.y)
    mud=(.055,.042,.026)
    if kind=='trousers':
        base=(.037,.054,.075)
        base=tuple(c*(.82+.34*broad) for c in base)
        waterline=.72+.19*(broad-.5)+.12*(streak-.5)
        wet=1-ramp(waterline-.25,waterline+.18,p.z)
        base=tuple(c*(1-.53*wet) for c in base)
        knee=math.exp(-((p.z-1.52)/.23)**2)*front
        lower=1-ramp(.48,1.3,p.z)
        grime=clamp(.09*patch+lower*(.23+.55*patch)+knee*(.13+.38*patch)+fleck*lower*.17)
        result=mix(base,mud,grime)
        return mix(result,(.076,.070,.055),knee*fleck*.20)
    if kind=='shoes':
        base=(.085,.042,.020)
        damp=1-ramp(.07,.34,p.z)
        base=tuple(c*(.82+.25*broad)*(1-.37*damp) for c in base)
        grime=clamp(.20+.45*patch+.20*damp+.12*fleck)
        return mix(base,mud,grime)
    if kind=='tunic':
        base=(.024,.021,.017)
        hem=1-ramp(2.75,3.16,p.z)
        cuff=(1-ramp(2.85,3.23,p.z))*ramp(.70,.90,abs(p.x))
        grime=clamp(.07*patch+max(hem,cuff)*(.22+.47*patch)+fleck*.05)
        base=tuple(c*(.82+.32*broad)*(1-.20*max(hem,cuff)) for c in base)
        return mix(base,mud,grime)
    base=(.40,.27,.20)
    fingertips=1-ramp(2.24,2.72,p.z)
    return mix(base,(.052,.041,.029),clamp(.12*patch+fingertips*(.12+.42*patch)))

attr=mesh.color_attributes.new(name='Ruien grime',type='FLOAT_COLOR',domain='CORNER')
mesh.color_attributes.active_color=attr
cache={}
for poly in mesh.polygons:
    kind=materials.get(poly.material_index)
    for loop_index in poly.loop_indices:
        if kind:
            index=mesh.loops[loop_index].vertex_index
            key=(index,kind)
            if key not in cache:cache[key]=(*colour_at(mesh.vertices[index].co,kind),1)
            attr.data[loop_index].color=cache[key]
        else:attr.data[loop_index].color=(1,1,1,1)

bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/('antigoon-'+TAG+'-asset.blend')))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'source'/('assembled-'+TAG+'.glb')),export_format='GLB',use_selection=True,export_yup=True)
print('RUIEN_WEATHERING_DONE',len(cache),'colours')

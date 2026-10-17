"""Restore source sculpt detail, author close-view materials and bake 4K PBR sets.

Blender background entry point. Keeps v08 intact. High resolution geometry is
projected onto the original detailed body/head, not simply subdivided in place.
"""
import bpy, bmesh, math, json, ast
from pathlib import Path
from mathutils import Vector, noise as ruien_noise

ROOT=Path(__file__).resolve().parent
TAG='v09-highres'
TEX=ROOT/'textures'/TAG
TEX.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v08-ruien-grime-asset.blend'))
giant=bpy.data.objects['Antigoon']

def activate(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

# Separate the existing head surface without altering its UVs or approved colour.
activate(giant)
head_indices={i for i,m in enumerate(giant.data.materials) if m and any(n.type=='TEX_IMAGE' and n.image for n in m.node_tree.nodes)}
head=giant.copy();head.data=giant.data.copy();bpy.context.collection.objects.link(head)
for part,want_head in [(giant,False),(head,True)]:
    bm=bmesh.new();bm.from_mesh(part.data)
    bmesh.ops.delete(bm,geom=[f for f in bm.faces if (f.material_index in head_indices)!=want_head],context='FACES')
    bm.to_mesh(part.data);bm.free()
head.name='Antigoon_head_high';giant.name='Antigoon_body_high'
objects=[giant,head]

# Weld duplicated UV-seam vertices; loop UVs remain separate. Refining unwelded
# vertices would split the skin open along the old texture charts.
for part in objects:
    bm=bmesh.new();bm.from_mesh(part.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bm.to_mesh(part.data);bm.free()

# Cut exact material boundaries rather than colouring whole intersected triangles.
palette_env={'math':math,'Vector':Vector,'noise':ruien_noise}
tree=ast.parse((ROOT/'weather_model.py').read_text())
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'weather palette','exec'),palette_env)
cloth_index=next(i for i,m in enumerate(giant.data.materials) if m.name.startswith('Dark wool'))
skin_index=next(i for i,m in enumerate(giant.data.materials) if m.name.startswith('Grimy hands'))
shoe_index=next(i for i,m in enumerate(giant.data.materials) if m.name.startswith('Brown leather'))
pants_index=next(i for i,m in enumerate(giant.data.materials) if m.name.startswith('Faded slate'))
bm=bmesh.new();bm.from_mesh(giant.data)
for side in [-1,1]:
    faces=[f for f in bm.faces if all(v.co.x*side>.76 for v in f.verts)]
    geom=set(faces)
    for f in faces:geom.update(f.edges);geom.update(f.verts)
    bmesh.ops.bisect_plane(bm,geom=list(geom),dist=.000001,plane_co=(side,0,2.74),plane_no=(side*.4,0,1))
faces=[f for f in bm.faces if all(v.co.z<.65 for v in f.verts)]
geom=set(faces)
for f in faces:geom.update(f.edges);geom.update(f.verts)
bmesh.ops.bisect_plane(bm,geom=list(geom),dist=.000001,plane_co=(0,0,.37),plane_no=(0,0,1))
colour_layer=bm.loops.layers.float_color.get('Ruien grime')
for f in bm.faces:
    p=f.calc_center_median();kind=None
    if abs(p.x)>.76:
        kind='tunic' if p.z+.4*(abs(p.x)-1)>2.74 else 'hands'
        f.material_index=cloth_index if kind=='tunic' else skin_index
    elif p.z<.65:
        kind='shoes' if p.z<.37 else 'trousers'
        f.material_index=shoe_index if kind=='shoes' else pants_index
    if kind and colour_layer:
        for loop in f.loops:loop[colour_layer]=(*palette_env['colour_at'](loop.vert.co,kind),1)
bm.to_mesh(giant.data);bm.free()

def source_mesh(filename,height,location):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'source'/filename))
    o=next(o for o in set(bpy.data.objects)-before if o.type=='MESH')
    activate(o);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    vs=o.data.vertices;lo=min(v.co.z for v in vs);hi=max(v.co.z for v in vs)
    cx=(min(v.co.x for v in vs)+max(v.co.x for v in vs))/2
    cy=(min(v.co.y for v in vs)+max(v.co.y for v in vs))/2
    f=height/(hi-lo)
    for v in vs:v.co=Vector(((v.co.x-cx)*f,(v.co.y-cy)*f,(v.co.z-lo)*f))
    o.location=location
    o.hide_render=True
    return o

body_ref=source_mesh('shape-v02-outward.glb',5.4,(0,0,0))
head_ref=source_mesh('head-blond-v02-outward.glb',.96,(-.0089587038383,.1913370192051,4.44))

for obj,ref,level in [(giant,body_ref,1),(head,head_ref,2)]:
    activate(obj)
    bpy.ops.object.material_slot_remove_unused()
    # Explicitly pin old image inputs to their source UVs before making a new atlas.
    old_uv=obj.data.uv_layers.active
    if old_uv:
        old_uv.name='SourceUV'
        for mat in obj.data.materials:
            if mat and mat.use_nodes:
                uv=mat.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='SourceUV'
                for node in list(mat.node_tree.nodes):
                    if node.type=='TEX_IMAGE':mat.node_tree.links.new(uv.outputs['UV'],node.inputs['Vector'])
    obj.data.uv_layers.new(name='PBR_UV')
    obj.data.uv_layers.active_index=len(obj.data.uv_layers)-1
    obj.data.uv_layers['PBR_UV'].active_render=True
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(72),island_margin=.006,area_weight=.3,correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    group=obj.vertex_groups.new(name='Restore sculpt detail')
    indices=[v.index for v in obj.data.vertices if obj==head or v.co.z<4.29]
    group.add(indices,1,'REPLACE')
    sub=obj.modifiers.new('Dense curved surface','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=level
    bpy.ops.object.modifier_apply(modifier=sub.name)
    restore=obj.modifiers.new('Original high detail sculpt','SHRINKWRAP');restore.target=ref
    restore.wrap_method='NEAREST_SURFACEPOINT';restore.vertex_group=group.name
    bpy.ops.object.modifier_apply(modifier=restore.name)
    smooth=obj.modifiers.new('Polish reconstruction noise','SMOOTH');smooth.factor=.20;smooth.iterations=2
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    for p in obj.data.polygons:p.use_smooth=True
    print('HIGHRES_GEOMETRY',obj.name,len(obj.data.polygons),flush=True)

bpy.data.objects.remove(body_ref,do_unlink=True);bpy.data.objects.remove(head_ref,do_unlink=True)

def ramp(nodes,lo,hi):
    r=nodes.new('ShaderNodeValToRGB')
    r.color_ramp.elements[0].position=.22;r.color_ramp.elements[0].color=(*lo,1)
    r.color_ramp.elements[1].position=.78;r.color_ramp.elements[1].color=(*hi,1)
    return r

for obj in objects:
    for mat in obj.data.materials:
        if not mat:continue
        mat.use_nodes=True;nodes=mat.node_tree.nodes;links=mat.node_tree.links
        bsdf=nodes.get('Principled BSDF')
        if not bsdf:continue
        name=mat.name.lower();skin=obj==head or 'hands' in name;leather='leather' in name
        coordinates=nodes.new('ShaderNodeTexCoord')
        if obj==head:
            # Restore frontal colour detail from the approved 1536 px reference,
            # blending into the multiview atlas toward the sides and back.
            geo=nodes.new('ShaderNodeNewGeometry');split=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Position'],split.inputs[0])
            combine=nodes.new('ShaderNodeCombineXYZ')
            for component,scale,offset in [('X',1.39,.515),('Z',.99,-4.379)]:
                mul=nodes.new('ShaderNodeMath');mul.operation='MULTIPLY_ADD';mul.inputs[1].default_value=scale;mul.inputs[2].default_value=offset
                links.new(split.outputs[component],mul.inputs[0]);links.new(mul.outputs[0],combine.inputs['X' if component=='X' else 'Y'])
            portrait=nodes.new('ShaderNodeTexImage');portrait.image=bpy.data.images.load(str(ROOT/'references/head-blond-v02.png'),check_existing=True)
            portrait.extension='CLIP';links.new(combine.outputs[0],portrait.inputs['Vector'])
            norm=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Normal'],norm.inputs[0])
            neg=nodes.new('ShaderNodeMath');neg.operation='MULTIPLY';neg.inputs[1].default_value=-1;neg.use_clamp=True;links.new(norm.outputs['Y'],neg.inputs[0])
            power=nodes.new('ShaderNodeMath');power.operation='POWER';power.inputs[1].default_value=6;links.new(neg.outputs[0],power.inputs[0])
            alpha=nodes.new('ShaderNodeMath');alpha.operation='MULTIPLY';links.new(power.outputs[0],alpha.inputs[0]);links.new(portrait.outputs['Alpha'],alpha.inputs[1])
            blend=nodes.new('ShaderNodeMixRGB');links.new(alpha.outputs[0],blend.inputs[0])
            links.new(bsdf.inputs['Base Color'].links[0].from_socket,blend.inputs[1]);links.new(portrait.outputs['Color'],blend.inputs[2]);links.new(blend.outputs[0],bsdf.inputs['Base Color'])
        noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1000 if skin else (160 if leather else 240)
        noise.inputs['Detail'].default_value=3;noise.inputs['Roughness'].default_value=.72
        links.new(coordinates.outputs['Object'],noise.inputs['Vector'])
        variation=ramp(nodes,(.94,.94,.94) if skin else (.76,.76,.76),(1.035,1.035,1.035) if skin else (1.12,1.12,1.12))
        links.new(noise.outputs['Fac'],variation.inputs['Fac'])
        multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
        if bsdf.inputs['Base Color'].is_linked:links.new(bsdf.inputs['Base Color'].links[0].from_socket,multiply.inputs[1])
        else:multiply.inputs[1].default_value=bsdf.inputs['Base Color'].default_value
        links.new(variation.outputs['Color'],multiply.inputs[2]);links.new(multiply.outputs[0],bsdf.inputs['Base Color'])
        rough=ramp(nodes,(.46,.46,.46) if skin else ((.51,.51,.51) if leather else (.80,.80,.80)),(.66,.66,.66) if skin else ((.82,.82,.82) if leather else (.97,.97,.97)))
        links.new(noise.outputs['Fac'],rough.inputs['Fac']);links.new(rough.outputs[0],bsdf.inputs['Roughness'])
        if not skin:
            geo=nodes.new('ShaderNodeNewGeometry');split=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Position'],split.inputs[0])
            damp=nodes.new('ShaderNodeMapRange');damp.inputs['From Min'].default_value=0;damp.inputs['From Max'].default_value=1.05
            damp.inputs['To Min'].default_value=.64;damp.inputs['To Max'].default_value=1
            links.new(split.outputs['Z'],damp.inputs['Value'])
            mult=nodes.new('ShaderNodeMath');mult.operation='MULTIPLY';links.new(damp.outputs[0],mult.inputs[0]);links.new(rough.outputs[0],mult.inputs[1]);links.new(mult.outputs[0],bsdf.inputs['Roughness'])
        height=noise.outputs['Fac']
        if not skin and not leather:
            # Crossing yarns, distorted slightly to keep the weave from looking machined.
            waves=[]
            for axis in ['X','Z']:
                wave=nodes.new('ShaderNodeTexWave');wave.bands_direction=axis
                wave.inputs['Scale'].default_value=18;wave.inputs['Distortion'].default_value=1.5
                wave.inputs['Detail Scale'].default_value=2
                links.new(coordinates.outputs['Object'],wave.inputs['Vector']);waves.append(wave)
            weave=nodes.new('ShaderNodeMath');weave.operation='MULTIPLY'
            links.new(waves[0].outputs['Fac'],weave.inputs[0]);links.new(waves[1].outputs['Fac'],weave.inputs[1]);height=weave.outputs[0]
        bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.32 if skin else .48
        bump.inputs['Distance'].default_value=.00045 if skin else (.001 if leather else .0006)
        links.new(height,bump.inputs['Height']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU';scene.render.bake.margin=24
scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
scene.render.bake.normal_space='TANGENT';scene.render.bake.use_selected_to_active=False
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-procedural.blend'))

report={'height_m':5.4,'texture_resolution':4096,'rigged':False,'objects':[]}
for obj in objects:
    activate(obj)
    for other in objects:other.hide_render=other!=obj
    images={}
    for label,bake_type in [('basecolor','DIFFUSE'),('roughness','ROUGHNESS'),('normal','NORMAL')]:
        image=bpy.data.images.new(obj.name+'_'+label,width=4096,height=4096,alpha=False)
        image.colorspace_settings.name='sRGB' if label=='basecolor' else 'Non-Color'
        for mat in obj.data.materials:
            target=mat.node_tree.nodes.new('ShaderNodeTexImage');target.image=image;mat.node_tree.nodes.active=target
        print('BAKE_START',obj.name,label,flush=True)
        bpy.ops.object.bake(type=bake_type)
        image.filepath_raw=str(TEX/(obj.name+'_'+label+'.png'));image.file_format='PNG';image.save();image.pack()
        images[label]=image
        print('BAKE_DONE',image.filepath_raw,flush=True)
    material=bpy.data.materials.new(obj.name+' 4K PBR');material.use_nodes=True
    nodes=material.node_tree.nodes;links=material.node_tree.links;shader=nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value=0
    for label,image in images.items():
        texture=nodes.new('ShaderNodeTexImage');texture.image=image
        if label=='normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='PBR_UV';links.new(texture.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],shader.inputs['Normal'])
        else:links.new(texture.outputs['Color'],shader.inputs['Base Color' if label=='basecolor' else 'Roughness'])
    obj.data.materials.clear();obj.data.materials.append(material)
    for p in obj.data.polygons:p.material_index=0
    for uv in list(obj.data.uv_layers):
        if uv.name!='PBR_UV':obj.data.uv_layers.remove(uv)
    for attr in list(obj.data.color_attributes):obj.data.color_attributes.remove(attr)
    tris=sum(len(p.vertices)-2 for p in obj.data.polygons)
    report['objects'].append({'name':obj.name,'triangles':tris,'vertices':len(obj.data.vertices),'maps':[i.filepath_raw for i in images.values()]})
    # Save a recovery copy after each completed texture set.
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-baking.blend'))

bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.hide_render=False;obj.select_set(True)
bpy.context.view_layer.objects.active=giant
report['triangles']=sum(o['triangles'] for o in report['objects'])
(ROOT/'source/mesh-v09-highres.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-asset.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'source/assembled-v09-highres.glb'),export_format='GLB',use_selection=True,export_yup=True)
print('HIGHRES_DONE',json.dumps(report),flush=True)

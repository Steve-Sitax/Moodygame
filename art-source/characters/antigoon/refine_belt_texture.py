"""v13: keeper shifted right and fitted around the actual belt cross-section."""
import bpy,math,json,shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
TAG='v13-highres-keeper-fit'
TEX=ROOT/'textures'/TAG;TEX.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-procedural.blend'))
body=bpy.data.objects['Antigoon_body_high'];head=bpy.data.objects['Antigoon_head_high']
def activate(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def material(name,col,rough=.65,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m
def ramp(n,lo,hi):
    r=n.new('ShaderNodeValToRGB');r.color_ramp.elements[0].position=.12;r.color_ramp.elements[0].color=(*lo,1)
    r.color_ramp.elements[1].position=.85;r.color_ramp.elements[1].color=(*hi,1)
    return r
# Make thread crossings visible in albedo as well as surface relief.
for mat in body.data.materials:
    if not mat or not mat.use_nodes:continue
    n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF')
    waves=[x for x in n if x.type=='TEX_WAVE']
    if not waves:continue
    for wave in waves:
        wave.inputs['Scale'].default_value=19 if wave.bands_direction=='X' else 26
        wave.inputs['Distortion'].default_value=2.8
    weave=next(x for x in n if x.type=='MATH' and x.operation=='MULTIPLY' and x.inputs[0].is_linked and x.inputs[0].links[0].from_node in waves)
    contrast=ramp(n,(.48,.46,.42),(1.29,1.25,1.20));l.new(weave.outputs[0],contrast.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.83
    l.new(p.inputs['Base Color'].links[0].from_socket,mix.inputs[1]);l.new(contrast.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],p.inputs['Base Color'])
    for bump in [x for x in n if x.type=='BUMP']:
        bump.inputs['Distance'].default_value=.0028;bump.inputs['Strength'].default_value=.78

leather=material('Raised worn brown leather',(.067,.025,.009),.69)
n=leather.node_tree.nodes;l=leather.node_tree.links;p=n.get('Principled BSDF')
coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=160;noise.inputs['Detail'].default_value=4
l.new(coord.outputs['Object'],noise.inputs['Vector'])
colour=ramp(n,(.025,.010,.004),(.125,.052,.018));l.new(noise.outputs['Fac'],colour.inputs[0]);l.new(colour.outputs[0],p.inputs['Base Color'])
rough=ramp(n,(.43,.43,.43),(.8,.8,.8));l.new(noise.outputs[0],rough.inputs[0]);l.new(rough.outputs[0],p.inputs['Roughness'])
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0018;bump.inputs['Strength'].default_value=.65;l.new(noise.outputs[0],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
thread=material('Dirty ochre belt stitching',(.19,.11,.046),.92)
metal=material('Tarnished brass buckle',(.24,.135,.045),.48,.78)

def mesh(name,verts,faces,mat):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    for f in me.polygons:f.use_smooth=True
    return o
def bevel(o,width):
    activate(o);mod=o.modifiers.new('Rounded exposed edges','BEVEL');mod.width=width;mod.segments=3
    bpy.ops.object.modifier_apply(modifier=mod.name)
def solid(o,thickness):
    activate(o);mod=o.modifiers.new('Leather thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=0
    bpy.ops.object.modifier_apply(modifier=mod.name);bevel(o,.003)
def radius(theta,z):
    d=Vector((math.sin(theta),-math.cos(theta),0));c=Vector((0,.025,z))
    ok,p,_,_=body.ray_cast(c+d*.62,-d)
    if not ok:raise RuntimeError(('Belt fit ray missed',theta,z))
    return (p-c).dot(d)
def belt_point(theta,z,extra=0):
    # Bridge narrow cloth creases instead of copying every wrinkle into leather.
    t=max(0,min(1,(z-3.295)/.19))
    low=max(radius(theta+dt,3.295) for dt in [-.065,0,.065])
    high=max(radius(theta+dt,3.485) for dt in [-.065,0,.065])
    r=max(low*(1-t)+high*t,radius(theta,z))+.017+extra
    return (math.sin(theta)*r,.025-math.cos(theta)*r,z)
N=192;rows=9;verts=[];faces=[]
for j in range(rows):
    z=3.295+j*.19/(rows-1)
    for i in range(N):verts.append(belt_point(i*2*math.pi/N,z))
for j in range(rows-1):
    for i in range(N):
        a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
belt=mesh('Antigoon_leather_belt',verts,faces,leather);solid(belt,.016)
# Loose strap end lies over the belt and then over the flared tunic skirt.
verts=[];faces=[]
for j in range(28):
    z=3.45-j*.58/27
    for i in range(5):
        x=.012+i*.205/4+.018*math.sin(j/27*2)
        hit,p,_,_=body.ray_cast(Vector((x,-.8,z)),Vector((0,1,0)))
        if not hit:raise RuntimeError('Tail fit missed')
        fade=max(0,min(1,(z-3.24)/.10));fade=fade*fade*(3-2*fade)
        y=p.y-(.032+.043*fade)
        verts.append((x,y,z))
for j in range(27):
    for i in range(4):
        a=j*5+i;faces.append((a,a+5,a+6,a+1))
tail=mesh('Loose leather strap end',verts,faces,leather);solid(tail,.014)

def tube(name,points,r,mat):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1;c.bevel_depth=r;c.bevel_resolution=2
    sp=c.splines.new('POLY');sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    activate(o);bpy.ops.object.convert(target='MESH');return bpy.context.object
stitches=[]
for z in [3.311,3.469]:
    for i in range(128):
        t=i*2*math.pi/128
        stitches.append(tube('Saddle stitch',[belt_point(t,z,.010),belt_point(t+.022,z,.010)],.0018,thread))
# Solid rounded rectangular frame with a real opening, front/back faces and bevels.
def frame(name,cx,cy,cz,w,h,bar,depth,mat):
    vs=[];fs=[];corners=8
    for y in [cy-depth/2,cy+depth/2]:
        for ww,hh,rr in [(w,h,min(.028,w*.25,h*.25)),(w-2*bar,h-2*bar,min(.014,(w-2*bar)*.25,(h-2*bar)*.25))]:
            for sx,sz,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)]:
                # Centre radius adapts to the inner loop's dimensions.
                xc=sx*(ww/2-rr);zc=sz*(hh/2-rr)
                for k in range(corners):
                    a=math.radians(start+k*90/(corners-1));vs.append((cx+xc+rr*math.cos(a),y,cz+zc+rr*math.sin(a)))
    M=corners*4
    for i in range(M):
        q=(i+1)%M
        fs.extend([(i,q,M+q,M+i),(2*M+i,3*M+i,3*M+q,2*M+q),(i,2*M+i,2*M+q,q),(M+i,M+q,3*M+q,3*M+i)])
    o=mesh(name,vs,fs,mat);bevel(o,.004);return o
buckle=frame('Antigoon_buckle',0,-.347,3.390,.230,.184,.025,.029,metal)
prong=tube('Buckle tongue',[(-.101,-.361,3.390),(0,-.375,3.390),(.103,-.363,3.390)],.007,metal)
# The keeper sits to the right of the hanging end. Fit both legs to the
# belt's actual outer/inner surfaces so the belt occupies its opening.
vs=[];fs=[];path=[]
cx=.260;cz=3.390;depth=.045;height=.216;rr=.008
for sy,sz,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)]:
    yc=sy*(depth/2-rr);zc=sz*(height/2-rr)
    for k in range(8):
        a=math.radians(start+k*90/7)
        path.append((yc+rr*math.cos(a),cz+zc+rr*math.sin(a)))
for local_y,z in path:
    t=(local_y+depth/2)/depth
    for x in [cx-.020,cx+.020]:
        fit_z=max(3.296,min(3.484,z))
        outer,op,_,_=belt.ray_cast(Vector((x,-.8,fit_z)),Vector((0,1,0)))
        inner,ip,_,_=belt.ray_cast(Vector((x,0,fit_z)),Vector((0,-1,0)))
        if not outer or not inner:raise RuntimeError('Keeper cross-section fit missed belt')
        front=op.y-.007;back=ip.y+.004
        vs.append((x,front*(1-t)+back*t,z))
for i in range(len(path)):
    j=(i+1)%len(path);fs.append((2*i,2*j,2*j+1,2*i+1))
keeper=mesh('Leather keeper wrapped over belt',vs,fs,leather);solid(keeper,.006)
# Join leather and stitches for one dedicated 2K atlas. Hardware stays separate metal.
activate(belt)
for o in [tail,keeper,*stitches]:o.select_set(True)
bpy.ops.object.join();belt=bpy.context.object
belt.data.uv_layers.new(name='PBR_UV');belt.data.uv_layers.active_index=len(belt.data.uv_layers)-1
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.004);bpy.ops.object.mode_set(mode='OBJECT')
activate(buckle);prong.select_set(True);bpy.ops.object.join();buckle=bpy.context.object
objects=[body,head,belt,buckle]
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU';scene.render.bake.margin=16
scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/('antigoon-'+TAG+'-procedural.blend')))

def apply_pbr(obj,images):
    mat=material(obj.name+' baked PBR',(.1,.1,.1));n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF')
    for label,im in images.items():
        im.colorspace_settings.name='sRGB' if label=='basecolor' else 'Non-Color'
        tex=n.new('ShaderNodeTexImage');tex.image=im
        if label=='normal':
            normal=n.new('ShaderNodeNormalMap');normal.uv_map='PBR_UV';l.new(tex.outputs[0],normal.inputs['Color']);l.new(normal.outputs[0],p.inputs['Normal'])
        else:l.new(tex.outputs[0],p.inputs['Base Color' if label=='basecolor' else 'Roughness'])
    obj.data.materials.clear();obj.data.materials.append(mat)
    for p in obj.data.polygons:p.material_index=0
    for uv in list(obj.data.uv_layers):
        if uv.name!='PBR_UV':obj.data.uv_layers.remove(uv)
    for attr in list(obj.data.color_attributes):obj.data.color_attributes.remove(attr)
    for im in images.values():im.pack()

for obj,res in [(belt,2048)]:
    activate(obj)
    for other in objects:other.hide_render=other!=obj
    images={}
    for label,kind in [('basecolor','DIFFUSE'),('roughness','ROUGHNESS'),('normal','NORMAL')]:
        im=bpy.data.images.new(obj.name+'_'+label,width=res,height=res,alpha=False);im.colorspace_settings.name='sRGB' if label=='basecolor' else 'Non-Color'
        for mat in obj.data.materials:
            node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;mat.node_tree.nodes.active=node
        print('BAKE',obj.name,label,flush=True);bpy.ops.object.bake(type=kind)
        im.filepath_raw=str(TEX/(obj.name+'_'+label+'.png'));im.file_format='PNG';im.save();images[label]=im
    apply_pbr(obj,images)
for obj in [body,head]:
    images={}
    for label in ['basecolor','roughness','normal']:
        filename=obj.name+'_'+label+'.png'
        shutil.copy2(ROOT/'textures/v11-highres-coarse'/filename,TEX/filename)
        images[label]=bpy.data.images.load(str(TEX/filename),check_existing=True)
    apply_pbr(obj,images)
for obj in objects:obj.hide_render=False
bpy.ops.object.select_all(action='SELECT')
report={'height_m':5.4,'rigged':False,'body_head_maps':4096,'belt_maps':2048,'objects':[{'name':o.name,'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)} for o in objects]}
report['triangles']=sum(o['triangles'] for o in report['objects'])
(ROOT/'source'/('master-'+TAG+'.json')).write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/('antigoon-'+TAG+'-asset.blend')))
for obj,ratio in [(body,.4),(head,.25)]:
    activate(obj);mod=obj.modifiers.new('Close-view density','DECIMATE');mod.ratio=ratio;bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/('antigoon-'+TAG+'-game.blend')))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'source'/('assembled-'+TAG+'.glb')),export_format='GLB',use_selection=True,export_yup=True)
print('ASSET_COMPLETE',TAG,flush=True)

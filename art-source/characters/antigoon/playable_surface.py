"""Anatomical seams and projected UVs, shared by sculpt and facial morphs.
Executed by build_playable.py after loading the approved appearance source.
"""
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
def surface_sampler(obj):
 me=obj.data;me.calc_loop_triangles();verts=[v.co.copy() for v in me.vertices]
 tris=[tuple(t.vertices) for t in me.loop_triangles]
 uv=me.uv_layers.active.data
 tri_uv=[[Vector((*uv[j].uv,0)) for j in t.loops] for t in me.loop_triangles]
 tree=BVHTree.FromPolygons(verts,tris,all_triangles=True)
 def sample(p,ray=False):
  loc,normal,index,distance=tree.ray_cast(Vector((p.x,-1,p.z)),Vector((0,1,0)),2) if ray else tree.find_nearest(p)
  if loc is None:return p,Vector((0,0))
  a,b,c=tris[index];u=barycentric_transform(loc,verts[a],verts[b],verts[c],*tri_uv[index])
  return loc,Vector((u.x,u.y))
 return sample
def colour_sampler(obj):
 image=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image and 'basecolor' in n.image.name)
 pixels=list(image.pixels);width,height=image.size
 def sample(uv):
  x=min(width-1,max(0,int(uv.x*width)));y=min(height-1,max(0,int(uv.y*height)));i=(y*width+x)*4
  def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
  return tuple(linear(c) for c in pixels[i:i+3])+(1,)
 return sample

def vertex_material(name,attribute,rough=.55):
 m=mat(name,(1,1,1),rough);n=m.node_tree.nodes;l=m.node_tree.links
 v=n.new('ShaderNodeVertexColor');v.layer_name=attribute;l.new(v.outputs['Color'],n.get('Principled BSDF').inputs['Base Color']);return m
body_sample=surface_sampler(body);body_colour=colour_sampler(body)
head_sample=surface_sampler(head);head_colour=colour_sampler(head)
print('SURFACE_COLOURS',body_colour(body_sample(Vector((1.0,-.1,3.1)))[1]),head_colour(head_sample(Vector((-.01,0,4.84)),True)[1]),flush=True)
surface_parts=[]
# Preserve the approved sleeve silhouette; replace only incorrectly assigned surface colour.
attribute=body.data.color_attributes.new(name='Correct cuff and wrist',type='FLOAT_COLOR',domain='CORNER')
for c in attribute.data:c.color=(1,1,1,1)
body.data.color_attributes.active_color=attribute
cloth_material=vertex_material('Cuff cloth surface','Correct cuff and wrist',.9)
nodes=cloth_material.node_tree.nodes;links=cloth_material.node_tree.links;bs=nodes.get('Principled BSDF')
coord=nodes.new('ShaderNodeTexCoord');waves=[]
for axis,scale in [('X',19),('Z',26)]:
 wave=nodes.new('ShaderNodeTexWave');wave.bands_direction=axis;wave.inputs['Scale'].default_value=scale;wave.inputs['Distortion'].default_value=2.8;links.new(coord.outputs['Object'],wave.inputs['Vector']);waves.append(wave)
weave=nodes.new('ShaderNodeMath');weave.operation='MULTIPLY';links.new(waves[0].outputs['Fac'],weave.inputs[0]);links.new(waves[1].outputs['Fac'],weave.inputs[1])
bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0028;bump.inputs['Strength'].default_value=.78;links.new(weave.outputs[0],bump.inputs['Height']);links.new(bump.outputs['Normal'],bs.inputs['Normal'])
skin_material=vertex_material('Wrist skin surface','Correct cuff and wrist',.60)
body.data.materials.append(cloth_material);body.data.materials.append(skin_material)
repaired=0
wrist_skin_faces=[]
for poly in body.data.polygons:
 x,y,z=poly.center;s=1 if x>0 else -1
 if not(abs(x)>.76 and 2.40<z<2.91):continue
 # The wrist is elliptical: a circular cutoff clips the broad back/front
 # of the hand and paints cloth onto otherwise exposed skin.
 radius=math.hypot((x-s*(1.01-(z-2.70)*.35))/.13,(y-(-.09+(z-2.70)*.50))/.19)
 cloth=z>2.85 or (z>2.71 and radius>1) or (z>2.72 and y>.065)
 poly.material_index=1 if cloth else 2
 if not cloth:wrist_skin_faces.append(poly.index)
 for li in poly.loop_indices:
  p=body.data.vertices[body.data.loops[li].vertex_index].co
  target=p+Vector((-s*.067,.025,.34)) if cloth else Vector((p.x,p.y,2.48+(p.z-2.70)*.10))
  _,uv=body_sample(target);attribute.data[li].color=body_colour(uv) if cloth else (.342,.233,.171,1)
 repaired+=1
print('CUFF_SURFACE_REPAIR',repaired,flush=True)
head_patch_material=vertex_material('Continuous facial skin and lips','Projected face colour',.52)
head.data.materials.append(head_patch_material)
MOUTH_X=-.013;MOUTH_W=.091
def mouth_z(x):
 u=(x-MOUTH_X)/MOUTH_W
 return 4.858+.018*u*u+.003*u
def mouth_inside(x,y,z):
 u=(x-MOUTH_X)/MOUTH_W
 return abs(u)<1 and abs(z-mouth_z(x))<.0030*math.sqrt(max(0,1-u*u)) and y<.025
def rebuild_mouth():
 bm=bmesh.new();bm.from_mesh(head.data);uv_layer=bm.loops.layers.uv.active
 colour_layer=bm.loops.layers.float_color.new('Projected face colour')
 for f in bm.faces:
  for loop in f.loops:loop[colour_layer]=(1,1,1,1)
 outer_w=.116;outer_h=.036
 cut=[f for f in bm.faces if ((f.calc_center_median().x-MOUTH_X)/outer_w)**2+((f.calc_center_median().z-mouth_z(f.calc_center_median().x))/outer_h)**2<1 and f.calc_center_median().y<.045]
 bmesh.ops.delete(bm,geom=cut,context='FACES')
 boundary=[]
 for v in bm.verts:
  x,y,z=v.co
  if any(e.is_boundary for e in v.link_edges) and abs(x-MOUTH_X)<.13 and abs(z-mouth_z(x))<.046 and y<.06:
   a=math.atan2((z-mouth_z(x))/outer_h,(x-MOUTH_X)/outer_w)%(2*math.pi);boundary.append((a,v))
 boundary.sort(key=lambda av:av[0]);N=len(boundary);rings=[];uvmap={}
 for j in range(13):
  t=j/12;ring=[]
  for a,existing in boundary:
   if j==12:
    v=existing;p,uv=head_sample(v.co,True)
   else:
    x=MOUTH_X+(MOUTH_W+(outer_w-MOUTH_W)*t)*math.cos(a)
    z=mouth_z(x)+(.003+(outer_h-.003)*t)*math.sin(a)
    p,uv=head_sample(Vector((x,0,z)),True)
    p.y-=.0013*math.sin(math.pi*t)
    v=bm.verts.new(p)
   ring.append(v);uvmap[v]=uv
  rings.append(ring)
 for j in range(12):
  for i in range(N):
   ni=(i+1)%N
   try:f=bm.faces.new((rings[j][i],rings[j+1][i],rings[j+1][ni],rings[j][ni]))
   except ValueError:continue
   f.smooth=True;f.material_index=1
   for loop in f.loops:
    loop[uv_layer].uv=uvmap[loop.vert];loop[colour_layer]=head_colour(uvmap[loop.vert])
 bm.to_mesh(head.data);bm.free();head.data.update();head.data.color_attributes.active_color=head.data.color_attributes['Projected face colour']
 print('CONTINUOUS_MOUTH_PATCH',N,flush=True)
def deform_face(p,name):
 q=p.copy();x,y,z=p;front=1-smooth((y-.025)/.15)
 if name=='jaw_open':
  transition=.003+.018*smooth((abs((x-MOUTH_X)/MOUTH_W)-.70)/.4)
  jaw=(1-smooth((z-mouth_z(x)+transition)/(transition*2)))*smooth((z-4.62)/.13)*math.exp(-1.6*((x-MOUTH_X)/.14)**4)*front
  q.z-=.062*jaw;q.y+=.010*jaw
 if name in ('smirk','laugh'):
  w=gaussian(x,z,.055,4.868,.055,.045)*front;q.z+=.012*w;q.x+=.004*w
 if name=='angry':
  for ex,ey,ez in eyes:
   w=gaussian(x,z,ex,5.079,.065,.037)*front;q.z-=.011*w;q.x+=(-.004 if ex>0 else .004)*w
 if name=='blink':
  for ex,ey,ez in eyes:
   w=math.exp(-2*((x-ex)/.045)**4)*front
   if ez<z<ez+.06:q.z-=.034*w*(1-smooth((z-ez-.018)/.035))
   elif ez-.035<z<=ez:q.z+=.007*w*(1-smooth((ez-z-.010)/.02))
 return q
def rim_mesh(name,kind,eye=None):
 verts=[];uvs=[];faces=[];N=128;RINGS=5
 for j in range(RINGS):
  t=j/(RINGS-1)
  for i in range(N):
   a=i*2*math.pi/N
   if kind=='lip':
    x=MOUTH_X+(MOUTH_W+.009*t)*math.cos(a)
    thickness=.003+( .010 if math.sin(a)>0 else .013)*t
    z=mouth_z(x)+thickness*math.sin(a)
   else:
    ex,ey,ez=eye;x=ex+(.033+.0045*t)*math.cos(a);z=ez+(.018+.004*t)*math.sin(a)
   p,uv=head_sample(Vector((x,0,z)),True)
   # Project the rounded edge slightly ahead of the skin, with no floating seam.
   p.y-=.0015*math.sin(math.pi*t)+.0004
   verts.append(p);uvs.append(uv)
 for j in range(RINGS-1):
  for i in range(N):
   ni=(i+1)%N;faces.append((j*N+i,j*N+ni,(j+1)*N+ni,(j+1)*N+i))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();uv=me.uv_layers.new(name='Projected face UV')
 for poly in me.polygons:
  poly.use_smooth=True
  for li in poly.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
 colour=me.color_attributes.new(name='Projected face colour',type='FLOAT_COLOR',domain='POINT')
 for i,u in enumerate(uvs):
  if kind=='eye':
   p=verts[i];_,u=head_sample(Vector((p.x,0,p.z+(.014 if p.z>=eye[2] else -.012))),True)
  colour.data[i].color=head_colour(u)
 me.color_attributes.active_color=colour
 ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);me.materials.append(head_patch_material);ob.shape_key_add(name='Basis',from_mix=False)
 for morph in ['jaw_open','smirk','angry','blink','laugh']:
  key=ob.shape_key_add(name=morph,from_mix=False)
  for i,p in enumerate(verts):key.data[i].co=deform_face(p,morph)
 return ob
def detailed_iris(side,x,y,z):
 verts=[];faces=[];colours=[];N=192;RINGS=18
 for j in range(RINGS):
  t=j/(RINGS-1);radius=.0058+(.0162-.0058)*t
  for i in range(N):
   a=i*2*math.pi/N
   fibre=.5+.27*math.sin(a*73+9*t)+.13*math.sin(a*127-6*t)+.10*math.sin(a*39+14*t)
   brightness=(.45+.55*fibre)*(1-.65*smooth((t-.85)/.15))
   colours.append((.24*brightness,.47*brightness,.60*brightness,1))
   dep=.041*math.sqrt(1-(radius/.035)**2)+.001
   verts.append((x+radius*math.cos(a),y-dep,z+radius*math.sin(a)))
 for j in range(RINGS-1):
  for i in range(N):
   ni=(i+1)%N;faces.append((j*N+i,(j+1)*N+i,(j+1)*N+ni,j*N+ni))
 me=bpy.data.meshes.new('Radial iris fibres');me.from_pydata(verts,[],faces);me.update()
 uv=me.uv_layers.new(name='Iris UV')
 for poly in me.polygons:
  for li in poly.loop_indices:
   p=me.vertices[me.loops[li].vertex_index].co
   uv.data[li].uv=((p.x-x)/.034+.5,(p.z-z)/.034+.5)
 colour=me.color_attributes.new(name='Iris fibres',type='FLOAT_COLOR',domain='POINT')
 for i,c in enumerate(colours):colour.data[i].color=c
 me.color_attributes.active_color=colour
 for poly in me.polygons:poly.use_smooth=True
 m=mat('Pale blue iris fibres.'+side,(1,1,1),.24);n=m.node_tree.nodes;l=m.node_tree.links;v=n.new('ShaderNodeVertexColor');v.layer_name='Iris fibres';bs=n.get('Principled BSDF');l.new(v.outputs['Color'],bs.inputs['Base Color']);bs.inputs['Coat Weight'].default_value=.65;bs.inputs['Coat Roughness'].default_value=.12
 ob=bpy.data.objects.new('Iris.'+side,me);bpy.context.collection.objects.link(ob);me.materials.append(m);return ob

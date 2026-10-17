"""Bake corrected cloth/skin/lip assignments into portable 4K PBR maps."""
def bake_playable_materials():
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=1;s.cycles.use_denoising=False
 p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.get_devices()
 for device in p.devices:device.use=device.type=='OPTIX'
 s.cycles.device='GPU';s.render.bake.margin=8;s.render.bake.use_selected_to_active=False
 target=R/'textures/playable';target.mkdir(parents=True,exist_ok=True)
 for ob in [body,head]:
  active(ob);images={};temporary=[]
  for kind in ['basecolor','roughness','normal']:
   im=bpy.data.images.new(ob.name+' playable '+kind,width=4096,height=4096,alpha=False)
   im.colorspace_settings.name='sRGB' if kind=='basecolor' else 'Non-Color'
   for material in ob.data.materials:
    n=material.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;material.node_tree.nodes.active=n;temporary.append((material,n))
   if kind=='basecolor':bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'})
   else:bpy.ops.object.bake(type='ROUGHNESS' if kind=='roughness' else 'NORMAL')
   im.filepath_raw=str(target/(ob.name+'_'+kind+'.png'));im.file_format='PNG';im.save();images[kind]=im
   for material,n in temporary:material.node_tree.nodes.remove(n)
   temporary=[]
  material=mat(ob.name+' corrected 4K PBR',(1,1,1));n=material.node_tree.nodes;l=material.node_tree.links;bs=n.get('Principled BSDF')
  for kind in images:
   tex=n.new('ShaderNodeTexImage');tex.image=images[kind]
   if kind=='normal':
    normal=n.new('ShaderNodeNormalMap');l.new(tex.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs['Normal'],bs.inputs['Normal'])
   else:l.new(tex.outputs['Color'],bs.inputs['Base Color' if kind=='basecolor' else 'Roughness'])
  ob.data.materials.clear();ob.data.materials.append(material)
  for poly in ob.data.polygons:poly.material_index=0
  for attr in list(ob.data.color_attributes):ob.data.color_attributes.remove(attr)
  print('CORRECTED_4K_TEXTURES',ob.name,flush=True)
 # Original generated body UVs have adjoining islands at the wrist. Keep the
 # skin boundary explicit so cloth bake dilation cannot stain exposed hands.
 wrist=mat('Exposed wrist skin',(.342,.233,.171),.60)
 body.data.materials.append(wrist)
 for i in wrist_skin_faces:body.data.polygons[i].material_index=1
 # Bake vertex colour details to images as well: runtime GLTF loading must
 # preserve blue irises and skin-coloured eyelid rims in every renderer.
 for ob,_ in facial:
  if not (ob.name.startswith('Iris.') or ob.name.startswith('Eyelid rim.')):continue
  active(ob);old=ob.data.materials[0];im=bpy.data.images.new(ob.name+' albedo',width=1024,height=1024,alpha=False)
  im.colorspace_settings.name='sRGB';node=old.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;old.node_tree.nodes.active=node
  bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'})
  im.filepath_raw=str(target/(ob.name.replace(' ','_')+'_basecolor.png'));im.file_format='PNG';im.save();old.node_tree.nodes.remove(node)
  m=mat(ob.name+' textured',(1,1,1),.32 if ob.name.startswith('Iris.') else .52)
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
  ob.data.materials.clear();ob.data.materials.append(m)
  for attr in list(ob.data.color_attributes):ob.data.color_attributes.remove(attr)

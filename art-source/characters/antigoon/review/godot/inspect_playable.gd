extends SceneTree
func _initialize():
 call_deferred("inspect")
func inspect():
 var document=GLTFDocument.new()
 var state=GLTFState.new()
 var path=OS.get_cmdline_user_args()[0]
 assert(document.append_from_file(path,state)==OK)
 var model=document.generate_scene(state)
 root.add_child(model)
 var animations=[]
 var bones=0
 var skin_meshes=0
 var blend_shapes=0
 for node in model.find_children("*","",true,false):
  if node is Skeleton3D:bones+=node.get_bone_count()
  if node is AnimationPlayer:
   for name in node.get_animation_list():
    animations.append({"name":name,"length":node.get_animation(name).length,"tracks":node.get_animation(name).get_track_count()})
  if node is MeshInstance3D:
   if node.skin!=null:skin_meshes+=1
   blend_shapes+=node.mesh.get_blend_shape_count()
 print("PLAYABLE_IMPORT ",JSON.stringify({"bones":bones,"skinned_meshes":skin_meshes,"blend_shapes":blend_shapes,"animations":animations}))
 assert(bones>=40 and skin_meshes>=4 and animations.size()>=11 and blend_shapes>=5)
 quit()

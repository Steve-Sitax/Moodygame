extends SceneTree
func _initialize():call_deferred("run")

func require(ok,what):
 if not ok:push_error(what);quit(1)
 return ok

func run():
 var folder="res://../.scratch/quay-paving/originals/"
 for file in ["r000039.res","r000553.res","r000556.res"]:
  var original=load(folder+file)
  var current=load("res://world/town/resources/"+file)
  for meta in original.get_meta_list():
   if meta==&"native_solid_skip":continue
   if not require(var_to_bytes(original.get_meta(meta))==var_to_bytes(current.get_meta(meta)),file+": changed original metadata "+str(meta)):return
  if file=="r000039.res":
   var a=original.surface_get_arrays(0);var b=current.surface_get_arrays(0)
   for channel in Mesh.ARRAY_MAX:
    if channel==Mesh.ARRAY_TEX_UV:continue
    if not require(var_to_bytes(a[channel])==var_to_bytes(b[channel]),"Quay non-UV attribute changed "+str(channel)):return
   if not require(original.get_aabb()==current.get_aabb(),"Quay bounds changed"):return
 for pair in [["r000038.res",.022],["r000024.res",.018]]:
  var material=load("res://world/town/resources/"+pair[0])
  if not require(is_equal_approx(material.get_shader_parameter("relief_depth"),pair[1]),"Wrong relief depth"):return
  if not require(material.shader.code.contains("smoothstep(0.04, 0.50, CAMERA_POSITION_WORLD.y - world.y)"),"Low-eye relief fade missing"):return
 var scene_text=FileAccess.get_file_as_string("res://world/town/scene.tscn")
 if not require(not scene_text.contains("cobble_relief"),"Per-stone prototype remains in scene"):return
 print("PAVING_FINAL_PASS: original ground arrays, bounds, collision/metadata, shared infill materials and low-eye texture relief; no per-stone runtime geometry")
 quit()

extends SceneTree
func _initialize(): call_deferred("run")
func run():
 var out=OS.get_cmdline_user_args()[0];DirAccess.make_dir_recursive_absolute(out)
 var scene=load("res://world/town/scene.tscn").instantiate()
 root.add_child(scene)
 var rec=[]
 for n in scene.find_children("*","MeshInstance3D",true,false):
  if n.mesh==null: continue
  var nm=str(n.name)
  if nm not in ["ground_quay","ground_cobble","ground_flags","ground_earth","track_setts","ruts"]: continue
  var ss=[]
  for s in n.mesh.get_surface_count():
   var mat=n.get_active_material(s)
   ss.append({"s":s,"material":mat.resource_path if mat else "", "name":mat.resource_name if mat else "", "vertices":n.mesh.surface_get_array_len(s)})
   var a=n.mesh.surface_get_arrays(s)
   var vs=a[0];var uv=a[4];var ix=a[12]
   if ix==null: ix=PackedInt32Array(range(vs.size()))
   var rows=PackedFloat32Array();rows.resize(ix.size()*5)
   for k in ix.size():
    var p=n.global_transform*vs[ix[k]]; var u=uv[ix[k]] if uv!=null else Vector2.ZERO
    rows[k*5]=p.x;rows[k*5+1]=p.y;rows[k*5+2]=p.z;rows[k*5+3]=u.x;rows[k*5+4]=u.y
   FileAccess.open(out+"/"+nm+"-"+str(s)+".f32",FileAccess.WRITE).store_buffer(rows.to_byte_array())
   if mat is ShaderMaterial:
    ResourceSaver.save(mat,out+"/"+nm+"-"+str(s)+".tres")
  rec.append({"node":nm,"mesh":n.mesh.resource_path,"sha256":FileAccess.get_sha256(n.mesh.resource_path),"transform":var_to_str(n.global_transform),"box":var_to_str(n.global_transform*n.get_aabb()),"surfaces":ss,"meta":n.mesh.get_meta_list()})
 FileAccess.open(out+"/scan.json",FileAccess.WRITE).store_string(JSON.stringify(rec,"  "))
 quit()


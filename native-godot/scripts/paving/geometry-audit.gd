extends SceneTree

# Read-only resource audit. Counts resources once, then counts their actual placed instances.
func _initialize():
 call_deferred("run")

func run():
 var args=OS.get_cmdline_user_args()
 var output=args[0]
 var scene=load("res://world/town/scene.tscn").instantiate()
 root.add_child(scene)
 var resources={}
 var placed=[]
 var total=0
 for node in scene.find_children("*","MeshInstance3D",true,false):
  if not node.mesh: continue
  var mesh=node.mesh
  var path=mesh.resource_path
  if not resources.has(path):
   var triangles=0
   var vertices=0
   for s in mesh.get_surface_count():
    vertices+=mesh.surface_get_array_len(s)
    var indices=mesh.surface_get_array_index_len(s)
    triangles+=(indices if indices>0 else mesh.surface_get_array_len(s))/3
   resources[path]={"path":path,"triangles":triangles,"vertices":vertices,"surfaces":mesh.get_surface_count(),"placements":0}
  resources[path].placements+=1
  total+=resources[path].triangles
  placed.append({"name":str(node.get_path()),"mesh":path,"triangles":resources[path].triangles,"visible":node.is_visible_in_tree()})
 var ordered=resources.values()
 ordered.sort_custom(func(a,b):return a.triangles*a.placements>b.triangles*b.placements)
 placed.sort_custom(func(a,b):return a.triangles>b.triangles)
 var collision=[]
 for file in DirAccess.get_directories_at("res://world/ruien/complete"):
  var colpath="res://world/ruien/complete/"+file+"/collision.res"
  if not ResourceLoader.exists(colpath):continue
  var shape=load(colpath)
  var data=shape.get_faces()
  collision.append({"area":file,"triangles":data.size()/3,"bounds_only":false})
  shape=null
 collision.sort_custom(func(a,b):return a.triangles>b.triangles)
 var result={"town_render_triangles_placed":total,"unique_meshes":resources.size(),"meshes":ordered,"largest_nodes":placed.slice(0,40),"ruien_export_collision":collision}
 var f=FileAccess.open(output,FileAccess.WRITE)
 f.store_string(JSON.stringify(result,"  "))
 print("GEOMETRY_AUDIT_PASS: ",total," placed town triangles, ",resources.size()," resources, ",collision.size()," underground collision resources")
 scene.free()
 quit()

extends SceneTree
# Read-only audit for tools/ground-junctions.py. Original resources are supplied explicitly;
# walls come from this checkout's native scene. No runtime game or player save is opened.
func _initialize():call_deferred("run")
func run():
 var args=OS.get_cmdline_user_args()
 if args.size()!=2:
  push_error("Usage: -- ORIGINAL_RESOURCE_DIR EXTERNAL_AUDIT_DIR")
  quit(1)
  return
 var originals=args[0];var output=args[1]
 DirAccess.make_dir_recursive_absolute(output)
 var meshes=[];var boundaries=[]
 for id in ["r000008","r000017","r000025","r000031","r000039"]:
  var mesh=load(originals.path_join(id+".res"))
  for surface in mesh.get_surface_count():
   var arrays=mesh.surface_get_arrays(surface)
   var vertices=arrays[Mesh.ARRAY_VERTEX];var indices=arrays[Mesh.ARRAY_INDEX]
   if indices==null:indices=PackedInt32Array(range(vertices.size()))
   var xyz=[]
   for v in vertices:xyz.append([v.x,v.y,v.z])
   meshes.append({"id":id,"surface":surface,"vertices":xyz,"indices":Array(indices)})
   var edges={}
   for t in range(0,indices.size(),3):
    for k in 3:
     var a=vertices[indices[t+k]];var b=vertices[indices[t+(k+1)%3]]
     var ka=str(Vector3i((a*10000).round()));var kb=str(Vector3i((b*10000).round()))
     if ka==kb:continue
     var key=ka+":"+kb if ka<kb else kb+":"+ka
     if edges.has(key):edges[key].count+=1
     else:edges[key]={"count":1,"a":[a.x,a.y,a.z],"b":[b.x,b.y,b.z]}
   var lines=[]
   for edge in edges.values():
    if edge.count==1:lines.append({"a":edge.a,"b":edge.b})
   boundaries.append({"node":id,"mesh":"res://world/town/resources/"+id+".res","surface":surface,"edges":lines.size(),"lines":lines})
 FileAccess.open(output.path_join("original-meshes.json"),FileAccess.WRITE).store_string(JSON.stringify(meshes))
 FileAccess.open(output.path_join("ground-boundaries.json"),FileAccess.WRITE).store_string(JSON.stringify(boundaries))
 var scene=load("res://world/town/scene.tscn").instantiate()
 root.add_child(scene)
 var rows=[]
 for node in scene.find_children("*","MeshInstance3D",true,false):
  if node.mesh==null or not node.is_visible_in_tree() or str(node.name).begins_with("ground_"):continue
  var xf=node.global_transform
  var box=xf*node.get_aabb()
  if box.position.y>0.02 or box.end.y<0.1:continue
  for s in node.mesh.get_surface_count():
   if node.mesh.surface_get_primitive_type(s)!=Mesh.PRIMITIVE_TRIANGLES:continue
   var a=node.mesh.surface_get_arrays(s)
   var v=a[Mesh.ARRAY_VERTEX]; var ix=a[Mesh.ARRAY_INDEX]
   if ix==null:ix=PackedInt32Array(range(v.size()))
   for k in range(0,ix.size(),3):
    var tri=[xf*v[ix[k]],xf*v[ix[k+1]],xf*v[ix[k+2]]]
    if minf(tri[0].y,minf(tri[1].y,tri[2].y))>0.0001 or maxf(tri[0].y,maxf(tri[1].y,tri[2].y))<0.001:continue
    var hits=[]
    for j in 3:
     var p=tri[j];var q=tri[(j+1)%3]
     if absf(p.y)<0.0001:hits.append(p)
     elif p.y*q.y<0:hits.append(p.lerp(q,-p.y/(q.y-p.y)))
    if hits.size()>=2 and hits[0].distance_to(hits[1])>0.001:
     rows.append({"node":str(node.name),"a":[hits[0].x,hits[0].z],"b":[hits[1].x,hits[1].z]})
 FileAccess.open(output.path_join("wall-feet.json"),FileAccess.WRITE).store_string(JSON.stringify(rows))
 print("wall foot segments ",rows.size())
 quit()

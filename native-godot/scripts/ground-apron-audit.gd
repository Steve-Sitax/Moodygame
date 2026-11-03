extends SceneTree
func _initialize():
 var args=OS.get_cmdline_user_args()
 if args.size()!=1:
  push_error('Usage: -- EXTERNAL_APRON_JSON')
  quit(1)
  return
 var result=[]
 for id in ["r000880","r000884"]:
  var mesh=load("res://world/town/resources/"+id+".res")
  for s in mesh.get_surface_count():
   var a=mesh.surface_get_arrays(s);var vs=a[Mesh.ARRAY_VERTEX];var ix=a[Mesh.ARRAY_INDEX]
   if ix==null:ix=PackedInt32Array(range(vs.size()))
   if mesh.surface_get_primitive_type(s)!=Mesh.PRIMITIVE_TRIANGLES:continue
   var triangles=[]
   for k in range(0,ix.size(),3):
    var p=vs[ix[k]];var q=vs[ix[k+1]];var r=vs[ix[k+2]]
    if minf(p.x,minf(q.x,r.x))>-352.5 or maxf(p.x,maxf(q.x,r.x))<-355 or minf(p.z,minf(q.z,r.z))>284 or maxf(p.z,maxf(q.z,r.z))<281 or minf(p.y,minf(q.y,r.y))>.10 or maxf(p.y,maxf(q.y,r.y))<-.3:continue
    triangles.append([[p.x,p.y,p.z],[q.x,q.y,q.z],[r.x,r.y,r.z]])
   if triangles.size():result.append({"id":id,"surface":s,"triangles":triangles})
 FileAccess.open(args[0],FileAccess.WRITE).store_string(JSON.stringify(result))
 quit()

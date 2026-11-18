extends SceneTree

func _initialize():call_deferred("run")

func hit(origin,direction,faces):
 var best=INF
 var normal=Vector3.ZERO
 for i in range(0,faces.size(),3):
  var point=Geometry3D.ray_intersects_triangle(origin,direction,faces[i],faces[i+1],faces[i+2])
  if point!=null:
   var distance=origin.distance_to(point)
   if distance<best:
    best=distance
    # Godot front faces use clockwise winding.
    normal=-(faces[i+1]-faces[i]).cross(faces[i+2]-faces[i]).normalized()
 return {"distance":best,"normal":normal}

func run():
 var mesh=load("res://world/town/resources/r000556.res")
 var faces=PackedVector3Array()
 for s in mesh.get_surface_count():
  var arrays=mesh.surface_get_arrays(s)
  var vertices=arrays[Mesh.ARRAY_VERTEX]
  var indices=arrays[Mesh.ARRAY_INDEX]
  if indices==null:faces.append_array(vertices)
  else:
   for i in indices:faces.append(vertices[i])
 var quads=mesh.get_meta("native_rail_top_quads")
 var tested=0
 for k in range(0,quads.size(),32):
  var centre=(quads[k]+quads[k+1]+quads[k+2]+quads[k+3])*.25
  # Avoid the deliberately open expansion-joint gap at a segment's exact midpoint.
  centre=centre.lerp((quads[k]+quads[k+3])*.5,.073)
  centre.y=0
  var top=hit(centre+Vector3.UP*.2,Vector3.DOWN,faces)
  var bottom=hit(centre+Vector3.DOWN*.2,Vector3.UP,faces)
  if not is_finite(top.distance) or not is_finite(bottom.distance) or top.normal.y<.5 or bottom.normal.y>-.5:
   push_error("Rail has a missing or inward top/bottom at "+str(centre)+": "+str(top)+" / "+str(bottom));quit(1);return
  tested+=1
 var endpoints={}
 for k in range(0,quads.size(),4):
  var a=(quads[k]+quads[k+3])*.5
  var b=(quads[k+1]+quads[k+2])*.5
  for pair in [[a,(a-b).normalized()],[b,(b-a).normalized()]]:
   var key=Vector2i(roundi(pair[0].x*1000),roundi(pair[0].z*1000))
   if not endpoints.has(key):endpoints[key]=[]
   endpoints[key].append(pair)
 var ends=0
 for group in endpoints.values():
  if group.size()!=1:continue
  var point=group[0][0];point.y=.024
  var outward=group[0][1]
  # Start 1 mm outside the end: a longer probe can hit a neighbouring crossing rail first.
  var cap=hit(point+outward*.001,-outward,faces)
  if not is_finite(cap.distance) or abs(cap.distance-.001)>.0005 or cap.normal.dot(outward)<.5:
   push_error("Rail exposed end is open at "+str(point)+": "+str(cap));quit(1);return
  ends+=1
 print("RAIL_UNDERSIDE_PASS: ",tested," top/bottom probes and ",ends," exposed ends; outward closed rail foot, head and caps")
 quit()

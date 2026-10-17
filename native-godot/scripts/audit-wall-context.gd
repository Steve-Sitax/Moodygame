extends SceneTree
func _initialize():call_deferred("run")
func run():
	var coverage=JSON.parse_string(FileAccess.get_file_as_string("res://proof/wall-circuit/coverage.json"))
	var view=coverage.views.filter(func(v):return v.name=="seg-09-04-town")[0]
	var eye=Vector3(view.eye[0],view.eye[1],view.eye[2]);var aim=Vector3(view.target[0],view.target[1],view.target[2])
	var forward=(aim-eye).normalized();var right=forward.cross(Vector3.UP).normalized();var up=right.cross(forward)
	var direction=(forward+right*(2.0*1000/1440-1)*tan(deg_to_rad(34))*1.6+up*(1-2.0*700/900)*tan(deg_to_rad(34))).normalized()
	var scene=load("res://world/town/roots/node-00004.scn").instantiate();root.add_child(scene)
	var records=[]
	for node in scene.find_children("*","MeshInstance3D",true,false):
		if not node.mesh:continue
		var inverse=node.global_transform.affine_inverse();var hit=node.mesh.get_aabb().intersects_ray(inverse*eye,inverse.basis*direction)
		if hit==null or eye.distance_to(node.global_transform*hit)>10:continue
		var materials=[]
		for s in node.mesh.get_surface_count():
			var m=node.get_active_material(s)
			if str(node.name).begins_with("city_"):
				var a=node.mesh.surface_get_arrays(s);var vertices=a[Mesh.ARRAY_VERTEX];var indices=a[Mesh.ARRAY_INDEX]
				if indices==null or indices.size()==0:indices=PackedInt32Array(range(vertices.size()))
				var closest=1000.0;var point=Vector3.ZERO;var colors=[]
				for i in range(0,indices.size(),3):
					var at=Geometry3D.ray_intersects_triangle(inverse*eye,inverse.basis*direction,vertices[indices[i]],vertices[indices[i+1]],vertices[indices[i+2]])
					if at!=null and eye.distance_to(node.global_transform*at)<closest:
						closest=eye.distance_to(node.global_transform*at);point=node.global_transform*at;colors=[str(a[Mesh.ARRAY_COLOR][indices[i]])] if a[Mesh.ARRAY_COLOR]!=null else []
				if closest<1000:print("TRIANGLE ",node.name," ",m.resource_path," distance=",closest," point=",point," color=",colors)
			materials.append({"path":m.resource_path,"name":m.resource_name,"foot":m.get_shader_parameter("foot") if m is ShaderMaterial else 0})
			if m is ShaderMaterial:FileAccess.open("res://proof/wall-circuit/context-"+m.resource_path.get_file()+".gdshader",FileAccess.WRITE).store_string(m.shader.code)
		records.append({"name":str(node.name),"mesh":node.mesh.resource_path,"hit":str(node.global_transform*hit),"materials":materials})
	FileAccess.open("res://proof/wall-circuit/context-hit.json",FileAccess.WRITE).store_string(JSON.stringify(records,"\t"));print(JSON.stringify(records));quit()

extends SceneTree
const OUT = "res://proof/city-junction"
var bounds = AABB(Vector3(200,-1,24),Vector3(31,17,33))
func _initialize(): call_deferred("run")
func run():
	DirAccess.make_dir_recursive_absolute(OUT)
	var records=[]
	for id in ["node-00383","node-00004"]:
		var scene=load("res://world/town/roots/"+id+".scn").instantiate()
		root.add_child(scene)
		for node in scene.find_children("*","MeshInstance3D",true,false):
			if not node.mesh: continue
			var box: AABB=node.global_transform*node.get_aabb()
			var extra=str(node.name) in ["city_1_0_1","city_1_0_2","city_1_0_3"]
			if not box.intersects(bounds) and not extra: continue
			var info={"node":str(node.name),"mesh":node.mesh.resource_path,"box":[box.position.x,box.position.y,box.position.z,box.size.x,box.size.y,box.size.z],"scale":[node.global_basis.get_scale().x,node.global_basis.get_scale().y,node.global_basis.get_scale().z],"surfaces":[]}
			for s in node.mesh.get_surface_count():
				var mat=node.get_active_material(s)
				var arrays=node.mesh.surface_get_arrays(s)
				var vertices=arrays[Mesh.ARRAY_VERTEX]
				var indices=arrays[Mesh.ARRAY_INDEX]
				if indices==null or indices.size()==0: indices=PackedInt32Array(range(vertices.size()))
				var near=[]
				for t in range(0,indices.size(),3):
					var center=(vertices[indices[t]]+vertices[indices[t+1]]+vertices[indices[t+2]])/3
					if bounds.has_point(node.global_transform*center): near.append(t/3)
				if near.is_empty() and not extra:continue
				var surface={"surface":s,"material":mat.resource_path,"name":mat.resource_name,"nearTriangles":near.size(),"totalTriangles":indices.size()/3}
				if mat is ShaderMaterial:
					FileAccess.open(OUT+"/"+mat.resource_path.get_file().get_basename()+".gdshader",FileAccess.WRITE).store_string(mat.shader.code)
				var selected=mat.resource_name in ["wall_stone","wall_iron","wall_plinth","wall_quoin","wall_room_glow","wall_cobble","wall_brick"] or str(node.name).begins_with("ground_") or str(node.name) in ["city_1_0_1","city_1_0_2","city_1_0_3"]
				var rows=[]
				if selected:
					for i in indices:
						var p=node.global_transform*vertices[i]
						var n=(node.global_basis.inverse().transposed()*arrays[Mesh.ARRAY_NORMAL][i]).normalized()
						var uv=arrays[Mesh.ARRAY_TEX_UV][i] if arrays[Mesh.ARRAY_TEX_UV]!=null else Vector2.ZERO
						var uv2=arrays[Mesh.ARRAY_TEX_UV2][i] if arrays[Mesh.ARRAY_TEX_UV2]!=null else Vector2.ZERO
						var c=arrays[Mesh.ARRAY_COLOR][i] if arrays[Mesh.ARRAY_COLOR]!=null else Color.WHITE
						var row=[p.x,p.y,p.z,n.x,n.y,n.z,uv.x,uv.y,uv2.x,uv2.y,c.r,c.g,c.b,c.a]
						if arrays[Mesh.ARRAY_CUSTOM0]!=null:
							row.append(arrays[Mesh.ARRAY_CUSTOM0][i*2]);row.append(arrays[Mesh.ARRAY_CUSTOM0][i*2+1])
						rows.append(row)
					surface["rowsFile"]=node.mesh.resource_path.get_file().get_basename()+"-"+str(s)+".json"
					FileAccess.open(OUT+"/"+surface.rowsFile,FileAccess.WRITE).store_string(JSON.stringify(rows))
				# Nearby small construction triangles identify drains/kerbs without inspecting actors.
				var samples=[]
				for triangle in near:
					var points=[]
					for k in 3:
						var p=node.global_transform*vertices[indices[triangle*3+k]]
						points.append([p.x,p.y,p.z])
					samples.append(points)
				FileAccess.open(OUT+"/near-"+node.mesh.resource_path.get_file().get_basename()+"-"+str(s)+".json",FileAccess.WRITE).store_string(JSON.stringify(samples))
				info.surfaces.append(surface)
			if info.surfaces.size():records.append(info)
		scene.queue_free()
	FileAccess.open(OUT+"/audit.json",FileAccess.WRITE).store_string(JSON.stringify(records,"\t"))
	print("Junction meshes: ",records.size())
	quit()

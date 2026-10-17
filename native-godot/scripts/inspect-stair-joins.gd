extends SceneTree
func _initialize():
	call_deferred("run")
func run():
	var wall = load("res://world/town/roots/node-00383.scn").instantiate()
	root.add_child(wall)
	var rows = []
	for node in wall.find_children("*", "MeshInstance3D", true, false):
		for s in node.mesh.get_surface_count():
			var mat = node.mesh.surface_get_material(s)
			if mat.resource_name != "wall_stone": continue
			var a = node.mesh.surface_get_arrays(s)
			var vs = []
			for i in a[Mesh.ARRAY_VERTEX].size():
				var p = node.global_transform * a[Mesh.ARRAY_VERTEX][i]
				if p.x > 207 and p.x < 219 and p.z > 29 and p.z < 45:
					var n = a[Mesh.ARRAY_NORMAL][i]
					var uv = a[Mesh.ARRAY_TEX_UV][i]
					vs.append([i,p.x,p.y,p.z,n.x,n.y,n.z,uv.x,uv.y])
			if vs.size(): rows.append({"node":str(node.name),"mesh":node.mesh.resource_path,"format":node.mesh.surface_get_format(s),"vertices":vs})
	FileAccess.open("res://proof/environment-textures/stair-joins.json",FileAccess.WRITE).store_string(JSON.stringify(rows))
	print("Stair join meshes: ",rows.size())
	quit()

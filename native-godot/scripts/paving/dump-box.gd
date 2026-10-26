extends SceneTree
# Every triangle of the town inside a box (world x0 z0 x1 z1, y under ymax): positions, normal, uv, node and material.
# Read-only. godot --headless --path native-godot --script res://scripts/paving/dump-box.gd -- <out folder> x0 z0 x1 z1 ymax
func _initialize(): call_deferred("run")

func run():
	var a := OS.get_cmdline_user_args()
	var out: String = a[0]; var x0 := float(a[1]); var z0 := float(a[2]); var x1 := float(a[3]); var z1 := float(a[4]); var ymax := float(a[5])
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := []; var rows := PackedFloat32Array()
	var region := AABB(Vector3(x0, -50, z0), Vector3(x1 - x0, ymax + 50, z1 - z0))
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		if node.mesh == null or not node.is_visible_in_tree(): continue
		var xf: Transform3D = node.global_transform
		if not (xf * node.get_aabb()).intersects(region): continue
		var m: Mesh = node.mesh
		for s in m.get_surface_count():
			if m.surface_get_primitive_type(s) != Mesh.PRIMITIVE_TRIANGLES: continue
			var arr = m.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]; var uv = arr[Mesh.ARRAY_TEX_UV]
			var idx = arr[Mesh.ARRAY_INDEX]
			if idx == null: idx = PackedInt32Array(range(vs.size()))
			var start := rows.size() / 8
			for k in range(0, idx.size(), 3):
				var p := [xf * vs[idx[k]], xf * vs[idx[k+1]], xf * vs[idx[k+2]]]
				var inside := false
				for q in p:
					if q.x >= x0 and q.x <= x1 and q.z >= z0 and q.z <= z1 and q.y <= ymax: inside = true
				if not inside: continue
				for j in 3:
					var t: Vector2 = uv[idx[k+j]] if uv != null else Vector2.ZERO
					rows.append_array([p[j].x, p[j].y, p[j].z, t.x, t.y, 0, 0, 0])
			var count := rows.size() / 8 - start
			if count == 0: continue
			var mat = node.get_active_material(s)
			info.append({"node": str(scene.get_path_to(node)), "mesh": m.resource_path, "surface": s, "material": mat.resource_path if mat else "", "first": start, "corners": count})
	FileAccess.open(out + "/box.f32", FileAccess.WRITE).store_buffer(rows.to_byte_array())
	FileAccess.open(out + "/box.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("surfaces ", info.size(), " corners ", rows.size() / 8)
	quit()

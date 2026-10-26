extends SceneTree
# Every triangle of the town's visible meshes within a radius of given points (world x, z): positions with the node, the
# mesh, the surface and the triangle's number in it. Read-only.
# godot --headless --path native-godot --script res://scripts/paving/dump-near.gd -- <out folder> <points json [[x,z],...]> <radius>
func _initialize(): call_deferred("run")

func run():
	var a := OS.get_cmdline_user_args()
	var out: String = a[0]; var pts: Array = JSON.parse_string(FileAccess.get_file_as_string(a[1])); var r := float(a[2])
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := []; var rows := PackedFloat32Array()
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		if node.mesh == null or not node.is_visible_in_tree(): continue
		var xf: Transform3D = node.global_transform
		var box: AABB = xf * node.get_aabb()
		var near := []
		for p in pts:
			if p[0] > box.position.x - r and p[0] < box.end.x + r and p[1] > box.position.z - r and p[1] < box.end.z + r: near.append(p)
		if near.is_empty(): continue
		var m: Mesh = node.mesh
		for s in m.get_surface_count():
			if m.surface_get_primitive_type(s) != Mesh.PRIMITIVE_TRIANGLES: continue
			var arr = m.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]; var idx = arr[Mesh.ARRAY_INDEX]
			if idx == null: idx = PackedInt32Array(range(vs.size()))
			for k in range(0, idx.size(), 3):
				var q := [xf * vs[idx[k]], xf * vs[idx[k+1]], xf * vs[idx[k+2]]]
				var c: Vector3 = (q[0] + q[1] + q[2]) / 3.0
				var hit := false
				for p in near:
					if absf(c.x - p[0]) < r and absf(c.z - p[1]) < r: hit = true; break
				if not hit: continue
				rows.append_array([q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z, q[2].x, q[2].y, q[2].z])
				info.append([str(scene.get_path_to(node)), m.resource_path, s, k / 3])
	FileAccess.open(out + "/near.f32", FileAccess.WRITE).store_buffer(rows.to_byte_array())
	FileAccess.open(out + "/near.json", FileAccess.WRITE).store_string(JSON.stringify(info))
	print("triangles ", info.size())
	quit()

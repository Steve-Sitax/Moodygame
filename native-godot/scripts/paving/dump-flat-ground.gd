extends SceneTree
# Street stretch audit: every upward-facing triangle under 1.2 m in the town (world x y z, uv, normal y) with
# its node, mesh and material, so the paving's uv stretch can be measured. Read-only.
# godot --headless --path native-godot --script res://scripts/paving/dump-flat-ground.gd -- <out folder>
func _initialize(): call_deferred("run")

func run():
	var out: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := []
	var rows := PackedFloat32Array()
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		if node.mesh == null: continue
		var xf: Transform3D = node.global_transform
		var box: AABB = xf * node.get_aabb()
		if box.position.y > 1.2: continue
		var m: Mesh = node.mesh
		var nb := xf.basis.inverse().transposed()
		for s in m.get_surface_count():
			if m.surface_get_primitive_type(s) != Mesh.PRIMITIVE_TRIANGLES: continue
			var arr = m.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var uv = arr[Mesh.ARRAY_TEX_UV]
			if uv == null: continue
			var idx = arr[Mesh.ARRAY_INDEX]
			if idx == null: idx = PackedInt32Array(range(vs.size()))
			var start := rows.size() / 6
			for k in range(0, idx.size(), 3):
				var a: Vector3 = xf * vs[idx[k]]; var b: Vector3 = xf * vs[idx[k+1]]; var c: Vector3 = xf * vs[idx[k+2]]
				if maxf(a.y, maxf(b.y, c.y)) > 1.2: continue
				var n := (b - a).cross(c - a)
				var l := n.length()
				if l < 1e-9 or absf(n.y) / l < 0.95: continue
				for i in [idx[k], idx[k+1], idx[k+2]]:
					var p: Vector3 = xf * vs[i]; var t: Vector2 = uv[i]
					rows.append_array([p.x, p.y, p.z, t.x, t.y, n.y / l])
			var count := rows.size() / 6 - start
			if count == 0: continue
			var mat = node.get_active_material(s)
			info.append({"node": str(scene.get_path_to(node)), "mesh": m.resource_path, "surface": s,
				"material": mat.resource_path if mat else "", "first": start, "corners": count})
	FileAccess.open(out + "/flat.f32", FileAccess.WRITE).store_buffer(rows.to_byte_array())
	FileAccess.open(out + "/flat.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("surfaces ", info.size(), " corners ", rows.size() / 6)
	quit()

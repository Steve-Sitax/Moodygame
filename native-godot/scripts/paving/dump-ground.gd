extends SceneTree
# H5 paving: dump the ground meshes (world-space rows, 16 floats a corner, as the town repairs write them) and every
# other triangle near the ground (obstacle faces, 9 floats a triangle). Read-only.
# godot --headless --path native-godot --script <this> -- <out folder>
const GROUNDS = ["ground_cobble", "ground_flags", "ground_quay"]
func _initialize(): call_deferred("run")

func run():
	var out: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := {}
	var obst := PackedFloat32Array()
	var names := {}
	var re := RegEx.new(); re.compile("^city_-?\\d+_-?\\d+_d_\\d+$")
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		if node.mesh == null: continue
		var nm := str(node.name)
		var xf: Transform3D = node.global_transform
		if nm in GROUNDS:
			var m: Mesh = node.mesh
			var rec := {"node": str(scene.get_path_to(node)), "mesh": m.resource_path, "xform": var_to_str(xf), "surfaces": []}
			for s in m.get_surface_count():
				var arr = m.surface_get_arrays(s)
				var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
				var ns = arr[Mesh.ARRAY_NORMAL]; var uv = arr[Mesh.ARRAY_TEX_UV]; var uv2 = arr[Mesh.ARRAY_TEX_UV2]; var col = arr[Mesh.ARRAY_COLOR]; var c0 = arr[Mesh.ARRAY_CUSTOM0]
				var idx = arr[Mesh.ARRAY_INDEX]
				if idx == null: idx = PackedInt32Array(range(vs.size()))
				var rows := PackedFloat32Array(); rows.resize(idx.size() * 16)
				var nb := xf.basis.inverse().transposed()
				for k in idx.size():
					var i: int = idx[k]
					var p: Vector3 = xf * vs[i]
					var n: Vector3 = (nb * ns[i]).normalized() if ns != null else Vector3.UP
					var t: Vector2 = uv[i] if uv != null else Vector2.ZERO
					var t2: Vector2 = uv2[i] if uv2 != null else Vector2.ZERO
					var c: Color = col[i] if col != null else Color.WHITE
					var o: int = k * 16
					rows[o]=p.x; rows[o+1]=p.y; rows[o+2]=p.z; rows[o+3]=n.x; rows[o+4]=n.y; rows[o+5]=n.z
					rows[o+6]=t.x; rows[o+7]=t.y; rows[o+8]=t2.x; rows[o+9]=t2.y; rows[o+10]=c.r; rows[o+11]=c.g; rows[o+12]=c.b; rows[o+13]=c.a
					if c0 != null and c0.size() >= (i+1)*2: rows[o+14]=c0[i*2]; rows[o+15]=c0[i*2+1]
				var file := nm + "-" + str(s) + ".f32"
				FileAccess.open(out + "/" + file, FileAccess.WRITE).store_buffer(rows.to_byte_array())
				var mat = node.get_active_material(s)
				rec.surfaces.append({"file": file, "corners": idx.size(), "verts": vs.size(), "format": m.surface_get_format(s),
					"material": mat.resource_path if mat else "", "aabb": var_to_str(m.surface_get_arrays(s)[0].size())})
			rec["meta"] = m.get_meta_list()
			rec["aabb"] = var_to_str(m.get_aabb())
			info[nm] = rec
			continue
		if nm.begins_with("ground_"): continue
		if not node.is_visible_in_tree() and not re.search(nm): continue
		var box: AABB = xf * node.get_aabb()
		if box.position.y > 1.2: continue
		var f: PackedVector3Array = node.mesh.get_faces()
		var kept := 0
		for t in range(0, f.size(), 3):
			var a: Vector3 = xf * f[t]; var b: Vector3 = xf * f[t+1]; var c: Vector3 = xf * f[t+2]
			if minf(a.y, minf(b.y, c.y)) > 1.2: continue
			obst.append_array([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z]); kept += 1
		if kept > 0: names[str(scene.get_path_to(node))] = kept
	FileAccess.open(out + "/obstacles.f32", FileAccess.WRITE).store_buffer(obst.to_byte_array())
	info["obstacleNodes"] = names
	FileAccess.open(out + "/ground.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("dumped; obstacle triangles ", obst.size() / 9)
	quit()

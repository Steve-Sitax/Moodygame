extends SceneTree
# The town blocks' pavements, kerbs and steps: every surface of the city meshes in the old stone (r000209) or the
# kerb flags (r000016), world space, 20 floats a corner (position, normal, uv, uv2, colour, custom0 xy, tangent xyzw).
# Read-only.
# godot --headless --path native-godot --script res://scripts/paving/dump-pavements.gd -- <out folder> [materials, comma]
const MATS = ["res://world/town/resources/r000209.res", "res://world/town/resources/r000016.res"]
func _initialize(): call_deferred("run")

func run():
	var out: String = OS.get_cmdline_user_args()[0]
	var mats: Array = MATS
	if OS.get_cmdline_user_args().size() > 1: mats = Array(OS.get_cmdline_user_args()[1].split(","))
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := []; var rows := PackedFloat32Array()
	for node in scene.find_children("city_*", "MeshInstance3D", true, false):
		if node.mesh == null: continue
		var xf: Transform3D = node.global_transform
		var nb := xf.basis.inverse().transposed()
		var m: Mesh = node.mesh
		for s in m.get_surface_count():
			var mat = node.get_active_material(s)
			if mat == null or not (mat.resource_path in mats): continue
			var arr = m.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]; var ns = arr[Mesh.ARRAY_NORMAL]; var uv = arr[Mesh.ARRAY_TEX_UV]
			var tg = arr[Mesh.ARRAY_TANGENT]; var idx = arr[Mesh.ARRAY_INDEX]
			var uv2 = arr[Mesh.ARRAY_TEX_UV2]; var col = arr[Mesh.ARRAY_COLOR]; var c0 = arr[Mesh.ARRAY_CUSTOM0]
			var c0n: int = c0.size() / vs.size() if c0 != null and vs.size() > 0 else 0
			if idx == null: idx = PackedInt32Array(range(vs.size()))
			var start := rows.size() / 20
			for k in idx.size():
				var i: int = idx[k]
				var p: Vector3 = xf * vs[i]
				var n: Vector3 = (nb * ns[i]).normalized() if ns != null else Vector3.UP
				var t: Vector2 = uv[i] if uv != null else Vector2.ZERO
				var g := Vector4.ZERO
				if tg != null and tg.size() >= (i + 1) * 4:
					var tw: Vector3 = xf.basis * Vector3(tg[i*4], tg[i*4+1], tg[i*4+2])
					g = Vector4(tw.x, tw.y, tw.z, tg[i*4+3])
				var t2: Vector2 = uv2[i] if uv2 != null else Vector2.ZERO
				var c: Color = col[i] if col != null else Color.WHITE
				var cx := 0.0; var cy := 0.0
				if c0n >= 2: cx = c0[i * c0n]; cy = c0[i * c0n + 1]
				rows.append_array([p.x, p.y, p.z, n.x, n.y, n.z, t.x, t.y, t2.x, t2.y, c.r, c.g, c.b, c.a, cx, cy, g.x, g.y, g.z, g.w])
			info.append({"node": str(scene.get_path_to(node)), "mesh": m.resource_path, "surface": s, "surfaces": m.get_surface_count(),
				"material": mat.resource_path, "format": m.surface_get_format(s), "first": start, "corners": idx.size(),
				"custom0Stride": c0n, "colour": col != null, "skip": m.get_meta("native_solid_skip") if m.has_meta("native_solid_skip") else []})
	FileAccess.open(out + "/pavements.f32", FileAccess.WRITE).store_buffer(rows.to_byte_array())
	FileAccess.open(out + "/pavements.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("surfaces ", info.size(), " corners ", rows.size() / 20)
	quit()

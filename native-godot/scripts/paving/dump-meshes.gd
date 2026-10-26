extends SceneTree
# Named meshes of the town as world-space rows (20 floats a corner: dump-ground.gd's 16 and the tangent xyzw), every
# surface, in index order.
# Read-only. godot --headless --path native-godot --script res://scripts/paving/dump-meshes.gd -- <out folder> <node paths json>
func _initialize(): call_deferred("run")

func run():
	var a := OS.get_cmdline_user_args()
	var out: String = a[0]; var want: Array = JSON.parse_string(FileAccess.get_file_as_string(a[1]))
	DirAccess.make_dir_recursive_absolute(out)
	var scene = load("res://world/town/scene.tscn").instantiate()
	root.add_child(scene)
	var info := {}
	for path in want:
		var node: MeshInstance3D = scene.get_node(path)
		var m: Mesh = node.mesh; var xf: Transform3D = node.global_transform
		var nb := xf.basis.inverse().transposed()
		var rec := {"node": path, "mesh": m.resource_path, "surfaces": []}
		for s in m.get_surface_count():
			var arr = m.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var ns = arr[Mesh.ARRAY_NORMAL]; var uv = arr[Mesh.ARRAY_TEX_UV]; var uv2 = arr[Mesh.ARRAY_TEX_UV2]; var col = arr[Mesh.ARRAY_COLOR]; var c0 = arr[Mesh.ARRAY_CUSTOM0]
			var idx = arr[Mesh.ARRAY_INDEX]
			if idx == null: idx = PackedInt32Array(range(vs.size()))
			var c0n: int = c0.size() / vs.size() if c0 != null and vs.size() > 0 else 0
			var tg = arr[Mesh.ARRAY_TANGENT]
			var rows := PackedFloat32Array(); rows.resize(idx.size() * 20)
			for k in idx.size():
				var i: int = idx[k]
				var p: Vector3 = xf * vs[i]
				var n: Vector3 = (nb * ns[i]).normalized() if ns != null else Vector3.UP
				var t: Vector2 = uv[i] if uv != null else Vector2.ZERO
				var t2: Vector2 = uv2[i] if uv2 != null else Vector2.ZERO
				var c: Color = col[i] if col != null else Color.WHITE
				var o: int = k * 20
				rows[o]=p.x; rows[o+1]=p.y; rows[o+2]=p.z; rows[o+3]=n.x; rows[o+4]=n.y; rows[o+5]=n.z
				rows[o+6]=t.x; rows[o+7]=t.y; rows[o+8]=t2.x; rows[o+9]=t2.y; rows[o+10]=c.r; rows[o+11]=c.g; rows[o+12]=c.b; rows[o+13]=c.a
				if c0n >= 2: rows[o+14]=c0[i*c0n]; rows[o+15]=c0[i*c0n+1]
				if tg != null:
					var tw: Vector3 = xf.basis * Vector3(tg[i*4], tg[i*4+1], tg[i*4+2])
					rows[o+16]=tw.x; rows[o+17]=tw.y; rows[o+18]=tw.z; rows[o+19]=tg[i*4+3]
			var file: String = str(node.name) + "-" + str(s) + ".f32"
			FileAccess.open(out + "/" + file, FileAccess.WRITE).store_buffer(rows.to_byte_array())
			var mat = node.get_active_material(s)
			rec.surfaces.append({"index": s, "file": file, "material": mat.resource_path if mat else "", "custom0": c0n >= 2,
				"tangent": arr[Mesh.ARRAY_TANGENT] != null, "format": m.surface_get_format(s)})
		info[path] = rec
	FileAccess.open(out + "/meshes.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("meshes ", info.size())
	quit()

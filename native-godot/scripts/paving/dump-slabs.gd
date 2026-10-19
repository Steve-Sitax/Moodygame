extends SceneTree
# H5: the town blocks' old-stone surfaces (r000209: pavements, kerbs, steps): world positions, normals, indices.
func _initialize(): call_deferred("run")
func run():
	var out: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(out)
	var city = load("res://world/town/roots/node-00004.scn").instantiate()
	root.add_child(city)
	var info := []
	for node in city.find_children("*", "MeshInstance3D", true, false):
		if node.mesh == null: continue
		for s in node.mesh.get_surface_count():
			var mat = node.mesh.surface_get_material(s)
			if mat == null or mat.resource_path != "res://world/town/resources/r000209.res": continue
			var arr = node.mesh.surface_get_arrays(s)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]; var ns: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
			var xf: Transform3D = node.global_transform
			var p := PackedFloat32Array(); p.resize(vs.size() * 6)
			for i in vs.size():
				var w: Vector3 = xf * vs[i]; var n: Vector3 = (xf.basis * ns[i]).normalized()
				p[i*6]=w.x; p[i*6+1]=w.y; p[i*6+2]=w.z; p[i*6+3]=n.x; p[i*6+4]=n.y; p[i*6+5]=n.z
			var nm := str(node.name)
			FileAccess.open(out + "/" + nm + "-v.f32", FileAccess.WRITE).store_buffer(p.to_byte_array())
			FileAccess.open(out + "/" + nm + "-i.i32", FileAccess.WRITE).store_buffer(idx.to_byte_array())
			info.append({"node": nm, "mesh": node.mesh.resource_path, "surface": s, "verts": vs.size(), "tris": idx.size() / 3,
				"surfaces": node.mesh.get_surface_count(), "format": node.mesh.surface_get_format(s)})
	FileAccess.open(out + "/slabs.json", FileAccess.WRITE).store_string(JSON.stringify(info, "\t"))
	print("slab surfaces ", info.size())
	quit()

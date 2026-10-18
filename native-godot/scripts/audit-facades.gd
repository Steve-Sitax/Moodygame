extends SceneTree
# Issues #176 #175: export the town's meshes for the shutter and sign repairs (repair-shutters.py, repair-signs.py). Usage:
#   godot --headless --path . -s scripts/audit-facades.gd -- <absolute output folder> [suffixes, default 1,3] [root, default city]
# Writes, in world space, for each city_X_Z_d_N mesh with N in the suffixes (with another root: each of its meshes whose
# name ends in ",N", e.g. streetlife_-2,0,0 for N = 0):
#   source/<mesh>-<surface>.bin  rows (16 floats per vertex: position, normal, uv, uv2, colour, custom0) of every surface
#   audit.json                   the meshes, their nodes, hashes, transforms, surfaces, materials and metadata
# Reads only; writes nothing inside the project.
func _initialize(): call_deferred("run")

func run():
	var args = OS.get_cmdline_user_args(); var out = args[0]
	var wanted = (args[1] if args.size() > 1 else "1,3").split(",")
	var root_name = args[2] if args.size() > 2 else "city"
	DirAccess.make_dir_recursive_absolute(out + "/source")
	var roots = JSON.parse_string(FileAccess.get_file_as_string("res://world/town/roots.json"))
	var town = Node3D.new(); root.add_child(town)
	for r in roots:
		if str(r.godotName) == root_name: town.add_child(load(r.path).instantiate())
	var records = []
	for node in town.find_children("*", "MeshInstance3D", true, false):
		var n = str(node.name)
		if root_name == "city" and (not n.begins_with("city_") or not n.contains("_d_") or not (n.get_slice("_d_", 1) in wanted)): continue
		if root_name != "city" and (not n.contains(",") or not (n.get_slice(",", n.get_slice_count(",") - 1) in wanted)): continue
		var nmat = node.global_basis.inverse().transposed()
		var record = {"node": n, "mesh": node.mesh.resource_path, "meshHash": FileAccess.get_sha256(node.mesh.resource_path), "transform": var_to_str(node.global_transform), "surfaces": [], "meta": node.mesh.get_meta_list()}
		for s in node.mesh.get_surface_count():
			var mat = node.get_active_material(s)
			var a = node.mesh.surface_get_arrays(s); var indices = a[Mesh.ARRAY_INDEX]
			if indices == null or indices.size() == 0: indices = PackedInt32Array(range(a[0].size()))
			var rows = PackedFloat32Array(); rows.resize(indices.size() * 16)
			for k in indices.size():
				var i = indices[k]; var p = node.global_transform * a[0][i]; var nn = (nmat * a[1][i]).normalized()
				var uv = a[Mesh.ARRAY_TEX_UV][i] if a[Mesh.ARRAY_TEX_UV] != null else Vector2.ZERO
				var uv2 = a[Mesh.ARRAY_TEX_UV2][i] if a[Mesh.ARRAY_TEX_UV2] != null else Vector2.ZERO
				var c = a[Mesh.ARRAY_COLOR][i] if a[Mesh.ARRAY_COLOR] != null else Color.WHITE
				var rr = [p.x, p.y, p.z, nn.x, nn.y, nn.z, uv.x, uv.y, uv2.x, uv2.y, c.r, c.g, c.b, c.a, 0, 0]
				if a[Mesh.ARRAY_CUSTOM0] != null: rr[14] = a[Mesh.ARRAY_CUSTOM0][i * 2]; rr[15] = a[Mesh.ARRAY_CUSTOM0][i * 2 + 1]
				for j in 16: rows[k * 16 + j] = rr[j]
			var file = node.mesh.resource_path.get_file().get_basename() + "-" + str(s) + ".bin"
			FileAccess.open(out + "/source/" + file, FileAccess.WRITE).store_buffer(rows.to_byte_array())
			record.surfaces.append({"index": s, "file": file, "material": mat.resource_path if mat else "", "name": mat.resource_name if mat else "", "vertices": indices.size(), "custom0": a[Mesh.ARRAY_CUSTOM0] != null, "format": node.mesh.surface_get_format(s)})
		records.append(record)
	FileAccess.open(out + "/audit.json", FileAccess.WRITE).store_string(JSON.stringify(records, "\t"))
	print("Facades audit: ", records.size(), " meshes")
	town.free()
	quit()

extends SceneTree
# Issue #163: export one city chunk for the Blender gutter repair (repair-gutters.py). Usage:
#   godot --headless --path . -s scripts/audit-gutters.gd -- <absolute output folder> <chunk, e.g. city_-1_0>
# Writes, in world space:
#   source/<mesh>-<surface>.bin  rows (16 floats per vertex, the wall-circuit format) of the chunk's near-detail stone
#                                mesh (role "old": it holds the old gutter boxes); the visible stone mesh ("stone") and
#                                grime decal mesh ("grime") the new drainage goes into are listed, their surfaces kept
#   source/<mesh>-standin.bin    that mesh's collision stand-in faces (native_solid_stand_in), if it has one
#   env.bin, env.json            every triangle near the chunk (3 floats per vertex) and which mesh it belongs to: the
#                                walls, roofs, stone, street dressing and lamps the pipes must keep clear of
#   stains.bin                   the baked broken-gutter stains (alive_gutter_stains), so the gutters break where they run
#   facade.bin                   the chunk's walls (x, y, z and colour alpha per vertex): each house's own alpha, which
#                                NativeRazedHouses reads to cut a pulled-down house out, goes on its new drainage too
#   audit.json                   the meshes, their hashes, surfaces and materials
# Reads only; writes nothing inside the project.
const ROOTS = ["city", "streetlife", "lively", "clutter", "posters", "litter", "wall_lamps", "omnibus_signs", "alive_gutter_stains", "townplaces"]
const PREFIXES = ["gas_lamp", "house_shop_", "shutters_shop_"]
const FACADE = "res://world/town/resources/r000195.res"
const STONE = "res://world/town/resources/r000209.res"
const DRESSED = "res://assets/materials/stone-corners-20261017/dressed-stone.tres"
const DECAL = "res://world/town/resources/r000221.res"

func _initialize(): call_deferred("run")

func run():
	var args = OS.get_cmdline_user_args(); var out = args[0]; var chunk = args[1]
	DirAccess.make_dir_recursive_absolute(out + "/source")
	var roots = JSON.parse_string(FileAccess.get_file_as_string("res://world/town/roots.json"))
	var town = Node3D.new(); root.add_child(town)
	for r in roots:
		var name = str(r.godotName)
		var take = name in ROOTS
		for p in PREFIXES: take = take or name.begins_with(p)
		if take: town.add_child(load(r.path).instantiate())
	var meshes = town.find_children("*", "MeshInstance3D", true, false)
	# the chunk's box: its own meshes, grown by 3 m
	var box = AABB(); var first = true
	for node in meshes:
		var n = str(node.name)
		if node.mesh and (n == chunk or n.begins_with(chunk + "_")):
			var b = node.global_transform * node.get_aabb()
			box = b if first else box.merge(b); first = false
	box = box.grow(3.0)
	var records = []
	var env = PackedFloat32Array(); var parts = []
	for node in meshes:
		if not node.mesh: continue
		var n = str(node.name)
		var own = n == chunk or n.begins_with(chunk + "_")
		var wb = node.global_transform * node.get_aabb()
		if not own and not wb.intersects(box): continue
		if n == "alive_gutter_stains" or str(node.get_parent().name) == "alive_gutter_stains":
			stains(node, out); continue
		var nmat = node.global_basis.inverse().transposed()
		var start = env.size() / 3
		var mats = []
		for s in node.mesh.get_surface_count():
			var m = node.get_active_material(s); mats.append(m.resource_path if m else "")
			var a = node.mesh.surface_get_arrays(s); var idx = a[Mesh.ARRAY_INDEX]
			if idx == null or idx.size() == 0: idx = PackedInt32Array(range(a[0].size()))
			for k in range(0, idx.size() - 2, 3):
				var p0 = node.global_transform * a[0][idx[k]]; var p1 = node.global_transform * a[0][idx[k + 1]]; var p2 = node.global_transform * a[0][idx[k + 2]]
				if not own and not box.intersects(AABB(p0, Vector3.ZERO).expand(p1).expand(p2)): continue
				env.append_array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z])
		parts.append({"node": n, "path": str(town.get_path_to(node)), "mesh": node.mesh.resource_path, "materials": mats, "start": start, "count": env.size() / 3 - start})
		if not own: continue
		# the chunk's meshes by what they hold (their numbering differs from chunk to chunk)
		var detail = n.begins_with(chunk + "_d_")
		var role = ""
		if not detail and mats.has(FACADE): tags(node, out)
		if detail and mats.has(DRESSED): role = "old"
		elif not detail and (mats.has(STONE) or mats.has(DRESSED)): role = "stone"
		elif not detail and mats.size() == 1 and mats[0] == DECAL: role = "grime"
		if role == "": continue
		var rows_wanted = role == "old"
		var record = {"node": n, "role": role, "mesh": node.mesh.resource_path, "meshHash": FileAccess.get_sha256(node.mesh.resource_path), "transform": var_to_str(node.global_transform), "surfaces": [], "meta": {}}
		for key in node.mesh.get_meta_list():
			var v = node.mesh.get_meta(key)
			if key == "native_solid_stand_in":
				var f = PackedFloat32Array()
				for p in v: var w = node.global_transform * p; f.append_array([w.x, w.y, w.z])
				var stand = node.mesh.resource_path.get_file().get_basename() + "-standin.bin"
				FileAccess.open(out + "/source/" + stand, FileAccess.WRITE).store_buffer(f.to_byte_array())
				record.meta[key] = stand
			else: record.meta[key] = var_to_str(v)
		for s in node.mesh.get_surface_count():
			var mat = node.get_active_material(s)
			if not rows_wanted:
				# kept as it is: the new surfaces are added after it
				record.surfaces.append({"index": s, "keep": true, "material": mat.resource_path if mat else "", "name": mat.resource_name if mat else "", "vertices": node.mesh.surface_get_array_index_len(s)})
				continue
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
			record.surfaces.append({"index": s, "file": file, "material": mat.resource_path if mat else "", "name": mat.resource_name if mat else "", "vertices": indices.size(), "custom0": a[Mesh.ARRAY_CUSTOM0] != null})
		records.append(record)
	FileAccess.open(out + "/env.bin", FileAccess.WRITE).store_buffer(env.to_byte_array())
	FileAccess.open(out + "/env.json", FileAccess.WRITE).store_string(JSON.stringify({"box": [box.position.x, box.position.y, box.position.z, box.end.x, box.end.y, box.end.z], "parts": parts}, "\t"))
	FileAccess.open(out + "/audit.json", FileAccess.WRITE).store_string(JSON.stringify(records, "\t"))
	print("Gutters audit: ", records.size(), " meshes, ", env.size() / 9, " nearby triangles in ", chunk)
	town.free()
	quit()

func stains(node, out):
	# every stain quad of the broken gutters, world space (3 floats per vertex, whole triangles)
	if FileAccess.file_exists(out + "/stains.bin"): return
	var f = PackedFloat32Array()
	for s in node.mesh.get_surface_count():
		var a = node.mesh.surface_get_arrays(s); var idx = a[Mesh.ARRAY_INDEX]
		if idx == null or idx.size() == 0: idx = PackedInt32Array(range(a[0].size()))
		for i in idx: var p = node.global_transform * a[0][i]; f.append_array([p.x, p.y, p.z])
	FileAccess.open(out + "/stains.bin", FileAccess.WRITE).store_buffer(f.to_byte_array())

func tags(node, out):
	var f = PackedFloat32Array()
	for s in node.mesh.get_surface_count():
		var a = node.mesh.surface_get_arrays(s); var idx = a[Mesh.ARRAY_INDEX]
		if idx == null or idx.size() == 0: idx = PackedInt32Array(range(a[0].size()))
		for i in idx:
			var p = node.global_transform * a[0][i]; var c = a[Mesh.ARRAY_COLOR][i] if a[Mesh.ARRAY_COLOR] != null else Color.WHITE
			f.append_array([p.x, p.y, p.z, c.a])
	FileAccess.open(out + "/facade.bin", FileAccess.WRITE).store_buffer(f.to_byte_array())

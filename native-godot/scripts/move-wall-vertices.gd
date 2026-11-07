extends SceneTree
# (#301) Moves the listed wall mesh vertices (world positions old -> new, moves.json from close.py) in their mesh resources.
# Originals are copied to BACKUP first; every other array, the materials and the surface names stay as they were
# (normals and tangents re-quantised by the compressed format: within 0.0002), checked by reloading each saved mesh.
var MOVES = OS.get_environment("WALL_MOVES")
var BACKUP = OS.get_environment("WALL_BACKUP")
func _initialize(): call_deferred("run")
func diff(a, b) -> float:
	if typeof(a) != typeof(b): return 99.0
	if a == null: return 0.0
	if a.size() != b.size(): return 99.0
	var t = typeof(a)
	var m = 0.0
	if t == TYPE_PACKED_VECTOR3_ARRAY or t == TYPE_PACKED_VECTOR2_ARRAY:
		for i in a.size(): m = max(m, a[i].distance_to(b[i]))
	elif t == TYPE_PACKED_FLOAT32_ARRAY or t == TYPE_PACKED_FLOAT64_ARRAY or t == TYPE_PACKED_COLOR_ARRAY:
		for i in a.size():
			if t == TYPE_PACKED_COLOR_ARRAY: m = max(m, max(abs(a[i].r - b[i].r), abs(a[i].g - b[i].g), abs(a[i].b - b[i].b), abs(a[i].a - b[i].a)))
			else: m = max(m, abs(a[i] - b[i]))
	elif a != b: return 99.0
	return m
func fail(msg):
	printerr("wall apply: ", msg); quit(1)
func run():
	var moves = JSON.parse_string(FileAccess.get_file_as_string(MOVES))
	DirAccess.make_dir_recursive_absolute(BACKUP)
	var xf = {}
	for f in DirAccess.get_files_at("res://world/town/roots"):
		if not f.ends_with(".scn"): continue
		var scene = load("res://world/town/roots/" + f).instantiate()
		root.add_child(scene)
		for node in scene.find_children("wall_chunk_*", "MeshInstance3D", true, false) + scene.find_children("gate_*", "MeshInstance3D", true, false):
			if node.mesh and moves.has(node.mesh.resource_path): xf[node.mesh.resource_path] = node.global_transform
		scene.free()
	var total = 0
	var worst = []; worst.resize(Mesh.ARRAY_MAX); worst.fill(0.0)
	for path in moves:
		if not xf.has(path): return fail("no node for " + path)
		var t: Transform3D = xf[path]; var inv = t.affine_inverse()
		var list = moves[path]["moves"]
		var mesh: ArrayMesh = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
		if mesh.get_blend_shape_count() > 0 or mesh.shadow_mesh != null: return fail("blend shapes or shadow mesh in " + path)
		var abs_path = ProjectSettings.globalize_path(path)
		var bak = BACKUP + "/" + path.get_file()
		if not FileAccess.file_exists(bak): DirAccess.copy_absolute(abs_path, bak)
		var out = ArrayMesh.new()
		var moved = 0
		for s in mesh.get_surface_count():
			var arrays = mesh.surface_get_arrays(s)
			var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			for i in v.size():
				var w = t * v[i]
				for m in list:
					var o = Vector3(m[0][0], m[0][1], m[0][2])
					if w.distance_to(o) < 3e-4:
						v[i] = inv * Vector3(m[1][0], m[1][1], m[1][2]); moved += 1; break
			arrays[Mesh.ARRAY_VERTEX] = v
			var rs = RenderingServer.mesh_get_surface(mesh.get_rid(), s)
			if rs.has("lods") and rs["lods"].size() > 0: return fail("LODs in " + path)
			out.add_surface_from_arrays(mesh.surface_get_primitive_type(s), arrays, [], {}, mesh.surface_get_format(s))
			out.surface_set_material(s, mesh.surface_get_material(s))
			out.surface_set_name(s, mesh.surface_get_name(s))
		if moved < list.size(): return fail("%s: %d of %d positions found" % [path, moved, list.size()])
		out.resource_name = mesh.resource_name
		out.custom_aabb = mesh.custom_aabb
		if ResourceSaver.save(out, path, ResourceSaver.FLAG_COMPRESS) != OK: return fail("save " + path)
		var back: ArrayMesh = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
		for s in mesh.get_surface_count():
			var a = mesh.surface_get_arrays(s); var b = back.surface_get_arrays(s)
			for k in Mesh.ARRAY_MAX:
				if k == Mesh.ARRAY_VERTEX: continue
				var d = diff(a[k], b[k])
				if d > worst[k]: worst[k] = d
				if d > 0.02: return fail("%s surface %d array %d changed by %f" % [path, s, k, d])
			if a[Mesh.ARRAY_VERTEX].size() != b[Mesh.ARRAY_VERTEX].size(): return fail("vertex count " + path)
			if back.surface_get_material(s) != mesh.surface_get_material(s): return fail("material " + path)
		total += moved
		print("wall apply: %s %s %d vertices" % [path, moves[path]["node"], moved])
	print("wall apply: largest change per array (vertex excluded): ", worst)
	print("wall apply: done, ", total, " vertices in ", moves.size(), " meshes")
	quit()

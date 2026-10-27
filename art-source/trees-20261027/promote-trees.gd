extends SceneTree
# The grown trees (native-godot/scripts/paving/trees.py) into the town's tree meshes, and their leaf material
# (make_leaf_atlas.py's atlas; the town's own tree-leaf shader kind, so no new kind). Run in Forward+ from native-godot:
#   godot --rendering-method forward_plus --path . --script <this> -- <trees out> <atlas out> <backup folder> <record json>
# Every copy of a kind (the town's groups and the squares' copies) draws these meshes: only the mesh resources and the
# new material are written; scene nodes, their transforms and permanent ids are untouched. Each bark mesh keeps its
# own bark material; its collision is the plain trunk (native_solid_stand_in, its tube surface skipped). The first
# run copies the bake's meshes to <backup folder>; promotion.json records every hash.
const MESHES := {
	"plane": [["r009470", "r009478"], ["r009530", "r009532"]],
	"lime": [["r009480", "r009482"], ["r009496", "r009503"], ["r009513", "r009520"]],
	"elm": [["r009484", "r009486"], ["r009522", "r009524"]],
	"bare": [["r009526", "r009528"]],
}
const DIR := "res://assets/materials/trees-20261027/"

func _initialize(): call_deferred("run")

func rows(path: String, floats: int) -> PackedFloat32Array:
	return FileAccess.get_file_as_bytes(path).to_float32_array()

func build(base: String, old: ArrayMesh, material: Material, solid: PackedVector3Array) -> ArrayMesh:
	var v := FileAccess.get_file_as_bytes(base + ".vtx").to_float32_array()
	var ix := FileAccess.get_file_as_bytes(base + ".idx").to_int32_array()
	var n := v.size() / 16
	var pos := PackedVector3Array(); pos.resize(n)
	var nrm := PackedVector3Array(); nrm.resize(n)
	var tan := PackedFloat32Array(); tan.resize(n * 4)
	var uv := PackedVector2Array(); uv.resize(n)
	var col := PackedColorArray(); col.resize(n)
	for i in n:
		var o := i * 16
		pos[i] = Vector3(v[o], v[o + 1], v[o + 2]); nrm[i] = Vector3(v[o + 3], v[o + 4], v[o + 5]).normalized()
		for k in 4: tan[i * 4 + k] = v[o + 6 + k]
		uv[i] = Vector2(v[o + 10], v[o + 11]); col[i] = Color(v[o + 12], v[o + 13], v[o + 14], v[o + 15])
	var arrays := []; arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos; arrays[Mesh.ARRAY_NORMAL] = nrm; arrays[Mesh.ARRAY_TANGENT] = tan
	arrays[Mesh.ARRAY_TEX_UV] = uv; arrays[Mesh.ARRAY_COLOR] = col; arrays[Mesh.ARRAY_INDEX] = ix
	var mesh := ArrayMesh.new(); mesh.resource_name = old.resource_name
	for key in old.get_meta_list(): mesh.set_meta(key, old.get_meta(key))
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Mesh.ARRAY_FLAG_COMPRESS_ATTRIBUTES)
	mesh.surface_set_material(0, material)
	if solid.size() > 0:
		mesh.set_meta("native_solid_stand_in", solid); mesh.set_meta("native_solid_skip", PackedInt32Array([0]))
	return mesh

func run():
	var a := OS.get_cmdline_user_args()
	var trees: String = a[0]; var atlas: String = a[1]; var backup: String = a[2]; var record: String = a[3]
	DirAccess.make_dir_recursive_absolute(backup); DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DIR))
	# the leaf atlas with its own mipmaps (the leaves' cover kept far off) and its height
	var col := Image.create_from_data(2048, 2048, true, Image.FORMAT_RGBA8, FileAccess.get_file_as_bytes(atlas + "/atlas-mips.bin"))
	var hm := Image.load_from_file(atlas + "/tree-leaves-height.png"); hm.convert(Image.FORMAT_L8); hm.generate_mipmaps()
	ResourceSaver.save(ImageTexture.create_from_image(col), DIR + "tree-leaves-texture.res", ResourceSaver.FLAG_COMPRESS)
	ResourceSaver.save(ImageTexture.create_from_image(hm), DIR + "tree-leaves-height-texture.res", ResourceSaver.FLAG_COMPRESS)
	var src: ShaderMaterial = load("res://world/town/resources/r009519.res")
	var m: ShaderMaterial = src.duplicate()
	m.set_shader_parameter("tex", load(DIR + "tree-leaves-texture.res"))
	m.set_shader_parameter("bump_map", load(DIR + "tree-leaves-height-texture.res"))
	m.set_shader_parameter("bump_scale", 0.5)
	m.resource_name = "tree_leaves"
	ResourceSaver.save(m, DIR + "tree-leaves.tres")
	var leaves_mat: Material = load(DIR + "tree-leaves.tres")
	var rec := {"material": DIR + "tree-leaves.tres", "meshes": {}}
	for kind in MESHES:
		for v in MESHES[kind].size():
			var pair: Array = MESHES[kind][v]
			var name: String = "%s-v%d" % [kind, v]
			var sf := FileAccess.get_file_as_bytes(trees + "/" + name + "-solid.f32").to_float32_array()
			var solid := PackedVector3Array()
			for i in range(0, sf.size(), 3): solid.append(Vector3(sf[i], sf[i + 1], sf[i + 2]))
			for j in 2:
				var path: String = "res://world/town/resources/%s.res" % pair[j]
				var abs := ProjectSettings.globalize_path(path)
				var kept: String = backup + "/" + pair[j] + ".res"
				if not FileAccess.file_exists(kept): DirAccess.copy_absolute(abs, kept)
				var old: ArrayMesh = load(path)
				var mat: Material = old.surface_get_material(0) if j == 0 else leaves_mat
				var mesh := build(trees + "/" + name + ("-bark" if j == 0 else "-leaves"), old, mat, solid if j == 0 else PackedVector3Array())
				if ResourceSaver.save(mesh, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("save " + path); quit(1); return
				var back: ArrayMesh = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
				if back.get_surface_count() != 1 or back.surface_get_array_index_len(0) != mesh.surface_get_array_index_len(0): push_error("reload " + path); quit(1); return
				rec.meshes[path] = {"kind": kind, "part": "bark" if j == 0 else "leaves", "originalHash": FileAccess.get_sha256(kept),
					"installedHash": FileAccess.get_sha256(abs), "triangles": mesh.surface_get_array_index_len(0) / 3}
	FileAccess.open(record, FileAccess.WRITE).store_string(JSON.stringify(rec, " "))
	print("trees promoted: ", rec.meshes.size(), " meshes")
	quit()

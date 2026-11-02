extends SceneTree
# The climbers on blank house walls (scripts/paving/wall_climbers.py, #219) into the game's resources. Usage:
#   godot --headless --path . -s scripts/build-wall-climbers.gd -- <folder>
# Reads <folder>/manifest.json and each site's rows (22 floats a corner: position, normal, uv, uv2, colour, custom0 the
# plant's foot, tangent; world positions, climbers.py's winding) and writes assets/models/wall-climbers-20261102/<id>.res:
# one surface in the town wall's climbers material (the park plants' shader kind: no new kind).
const OUT := "res://assets/models/wall-climbers-20261102"

func _initialize(): call_deferred("run")

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(src + "/manifest.json"))
	var material: Material = load(manifest["material"])
	for site in manifest["climbers"]:
		var f: PackedFloat32Array = FileAccess.get_file_as_bytes(src + "/" + site["file"]).to_float32_array()
		var n := f.size() / 22
		var pos := PackedVector3Array(); var nor := PackedVector3Array(); var uv := PackedVector2Array(); var uv2 := PackedVector2Array()
		var col := PackedColorArray(); var cus := PackedFloat32Array(); var tan := PackedFloat32Array()
		pos.resize(n); nor.resize(n); uv.resize(n); uv2.resize(n); col.resize(n); cus.resize(n * 4); tan.resize(n * 4)
		for i in n:
			var j := i * 22
			pos[i] = Vector3(f[j], f[j + 1], f[j + 2]); nor[i] = Vector3(f[j + 3], f[j + 4], f[j + 5]).normalized()
			uv[i] = Vector2(f[j + 6], f[j + 7]); uv2[i] = Vector2(f[j + 8], f[j + 9]); col[i] = Color(f[j + 10], f[j + 11], f[j + 12], f[j + 13])
			for q in 4: cus[i * 4 + q] = f[j + 14 + q]
			var t := Vector3(f[j + 18], f[j + 19], f[j + 20]).normalized()
			tan[i * 4] = t.x; tan[i * 4 + 1] = t.y; tan[i * 4 + 2] = t.z; tan[i * 4 + 3] = -1.0 if f[j + 21] < 0 else 1.0
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pos; arrays[Mesh.ARRAY_NORMAL] = nor; arrays[Mesh.ARRAY_TANGENT] = tan
		arrays[Mesh.ARRAY_TEX_UV] = uv; arrays[Mesh.ARRAY_TEX_UV2] = uv2; arrays[Mesh.ARRAY_COLOR] = col; arrays[Mesh.ARRAY_CUSTOM0] = cus
		var mesh := ArrayMesh.new()
		mesh.resource_name = "wall_climbers_" + str(site["id"]).replace("-", "_")
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT)
		mesh.surface_set_material(0, material)
		var path: String = OUT + "/" + str(site["id"]) + ".res"
		if ResourceSaver.save(mesh, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
		print("wall climbers ", site["id"], ": ", n / 3, " triangles")
	quit()

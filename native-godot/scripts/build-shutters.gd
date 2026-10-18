extends SceneTree
# Issue #176: turn the shutter models of scripts/build_shutters.py and the paint picture of scripts/shutter_paint.py
# into the game's resources. Usage:
#   python scripts/shutter_paint.py <folder>; python scripts/build_shutters.py <folder>/models
#   godot --headless --path . -s scripts/build-shutters.gd -- <folder>
# Writes assets/materials/town-facades-20261018/ (the paint and height pictures, the kept and worn paint materials: copies
# of the town's wood material city_wood, the same shader, so no new shader kind; the worn one reads the picture's right
# half) and assets/models/shutters/<model>.res (indexed meshes with the engine's own LODs). The iron is the town's wall
# iron (r000615), unchanged.
const MATS := "res://assets/materials/town-facades-20261018"
const MODELS := "res://assets/models/shutters"
const WOOD := "res://world/town/resources/r000216.res"
const IRON := "res://world/town/resources/r000615.res"

func _initialize(): call_deferred("run")

func texture(png: String, path: String) -> Texture2D:
	var img := Image.load_from_file(png)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	if ResourceSaver.save(t, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
	return load(path)

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MATS))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MODELS))
	var paint := texture(src + "/shutter-paint.png", MATS + "/shutter-paint-texture.res")
	var height := texture(src + "/shutter-paint-height.png", MATS + "/shutter-paint-height-texture.res")
	var mats := {}
	for wear in ["kept", "worn"]:
		var m: ShaderMaterial = load(WOOD).duplicate()
		m.resource_name = "shutter_paint_" + wear
		m.set_shader_parameter("tex", paint)
		m.set_shader_parameter("bump_map", height)
		m.set_shader_parameter("bump_scale", 0.6)
		m.set_shader_parameter("uv_xform", Vector4(1, 1, 0.0 if wear == "kept" else 0.5, 0))
		var path: String = MATS + "/shutter-paint-" + wear + ".tres"
		if ResourceSaver.save(m, path) != OK: push_error("could not save " + path)
		mats[wear] = load(path)
	var models = JSON.parse_string(FileAccess.get_file_as_string(src + "/models/models.json"))
	for name in models:
		var info = models[name]
		var im := ImporterMesh.new()
		for mat in ["wood", "iron"]:
			if not info.surfaces.has(mat): continue
			var raw := FileAccess.get_file_as_bytes(src + "/models/" + info.surfaces[mat].file)
			var f := raw.to_float32_array()
			var at := {}; var pos := PackedVector3Array(); var nor := PackedVector3Array(); var uv := PackedVector2Array(); var col := PackedColorArray(); var idx := PackedInt32Array()
			for i in f.size() / 16:
				var j := i * 16
				var key := raw.slice(j * 4, j * 4 + 64)
				var k = at.get(key, -1)
				if k < 0:
					k = pos.size(); at[key] = k
					pos.append(Vector3(f[j], f[j + 1], f[j + 2])); nor.append(Vector3(f[j + 3], f[j + 4], f[j + 5]))
					uv.append(Vector2(f[j + 6], f[j + 7])); col.append(Color(f[j + 10], f[j + 11], f[j + 12], f[j + 13]))
				idx.append(k)
			var a := []; a.resize(Mesh.ARRAY_MAX)
			a[Mesh.ARRAY_VERTEX] = pos; a[Mesh.ARRAY_NORMAL] = nor; a[Mesh.ARRAY_TEX_UV] = uv; a[Mesh.ARRAY_COLOR] = col; a[Mesh.ARRAY_INDEX] = idx
			im.add_surface(Mesh.PRIMITIVE_TRIANGLES, a, [], {}, mats.kept if mat == "wood" else load(IRON), mat, Mesh.ARRAY_FLAG_COMPRESS_ATTRIBUTES)
		im.generate_lods(25.0, 60.0, [])
		var mesh := im.get_mesh()
		mesh.resource_name = name
		# a leaf's size, for NativeShutters to fit each copy to the leaf it stands for
		if info.has("width"): mesh.set_meta("shutter_size", Vector3(info.width, info.height, info.thickness))
		var path: String = MODELS + "/" + name + ".res"
		if ResourceSaver.save(mesh, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
		print(name, ": ", info.triangles, " triangles, ", mesh.get_surface_count(), " surfaces")
	quit()

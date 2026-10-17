extends SceneTree

func _initialize():
	var directory = "res://assets/materials/environment-20261013/"
	var rows = JSON.parse_string(FileAccess.get_file_as_string(directory + "manifest.json"))
	var checks = 0
	var max_normal_delta = 0.0
	var max_weld = 0.0
	for row in rows:
		var material = load(row.material) as ShaderMaterial
		assert(material != null, row.material)
		var expected = Image.load_from_file(ProjectSettings.globalize_path(row.albedo))
		var texture = material.get_shader_parameter("tex") as Texture2D
		assert(texture.get_width() == expected.get_width() and texture.get_height() == expected.get_height(), row.material)
		assert(texture.resource_path.begins_with(directory), row.material)
		checks += 3
		if row.has("height"):
			assert(is_equal_approx(material.get_shader_parameter("bump_scale"), row.bumpScale), row.material)
			assert((material.get_shader_parameter("bump_map") as Texture2D).resource_path.begins_with(directory), row.material)
			checks += 2
		if row.has("uvScale"):
			var transform: Vector4 = material.get_shader_parameter("uv_xform")
			assert(transform.x == 1.0 and transform.y == -1.0, "Poster orientation")
			checks += 1
		if row.albedo.ends_with("house-roofs.png"):
			var layers = material.get_shader_parameter("environment_roof_colour") as Texture2DArray
			assert(layers.get_layers() == 4 and layers.get_width() == 512, "Roof mip isolation")
			assert(material.shader.code.contains("clamp(psx_wet"), "Roof wet response")
			checks += 2
	var meshes = JSON.parse_string(FileAccess.get_file_as_string("res://proof/environment-textures/uv-repairs.json"))
	for row in meshes:
		var mesh = load(row.original) as ArrayMesh
		var old = load("res://proof/environment-textures/original-resources/" + row.original.get_file()) as ArrayMesh
		assert(mesh != null and old != null)
		if row.original.ends_with("r005571.res"):
			assert(mesh.get_surface_count() == old.get_surface_count() + 1, "Only contact surface added")
			assert(is_equal_approx(mesh.get_meta("native_wood_bevel_metres"),0.0015))
			var oa = old.surface_get_arrays(0)
			var na = mesh.surface_get_arrays(0)
			var cursor = 0
			for triangle in range(0, oa[Mesh.ARRAY_INDEX].size(), 3):
				var wood = true
				for k in 3:
					var index = oa[Mesh.ARRAY_INDEX][triangle+k]
					var uv: Vector2 = oa[Mesh.ARRAY_TEX_UV][index]
					wood = wood and uv.x >= 0.125 and uv.x < 0.5 and uv.y >= 0.25 and uv.y < 0.376
				if wood: continue
				for k in 3:
					var index = oa[Mesh.ARRAY_INDEX][triangle+k]
					assert(na[Mesh.ARRAY_VERTEX][cursor] == oa[Mesh.ARRAY_VERTEX][index], "Non-wood position changed")
					assert(na[Mesh.ARRAY_TEX_UV][cursor] == oa[Mesh.ARRAY_TEX_UV][index], "Non-wood UV changed")
					cursor += 1
			checks += cursor*2+2
		else:
			assert(mesh.get_surface_count() == old.get_surface_count())
			for surface in old.get_surface_count():
				var oa = old.surface_get_arrays(surface)
				var na = mesh.surface_get_arrays(surface)
				assert(oa[Mesh.ARRAY_INDEX] == na[Mesh.ARRAY_INDEX], "Topology changed")
				for i in oa[Mesh.ARRAY_NORMAL].size():
					var delta = oa[Mesh.ARRAY_NORMAL][i].distance_to(na[Mesh.ARRAY_NORMAL][i])
					max_normal_delta = max(max_normal_delta,delta)
					assert(delta < 0.0003, "Normal direction changed beyond packed roundtrip tolerance: " + str(delta))
				assert(oa[Mesh.ARRAY_VERTEX].size() == na[Mesh.ARRAY_VERTEX].size())
				for i in oa[Mesh.ARRAY_VERTEX].size():
					var distance = oa[Mesh.ARRAY_VERTEX][i].distance_to(na[Mesh.ARRAY_VERTEX][i])
					max_weld=max(max_weld,distance)
					assert(distance < 0.0016, "Weld beyond tolerance")
				checks += 3 + oa[Mesh.ARRAY_VERTEX].size()
	var result = {"passed":true,"checks":checks,"materials":rows.size(),"meshes":meshes.size(),"maxNormalVectorDelta":max_normal_delta,"maxWeldMetres":max_weld,"scope":"Resource reload, material dimensions, shared external textures, poster V, roof layers/weather, retained topology/normals within packed tolerance, bounded welds and untouched non-wood triangles"}
	FileAccess.open("res://proof/environment-textures/validation.json",FileAccess.WRITE).store_string(JSON.stringify(result,"\t"))
	print(JSON.stringify(result))
	quit()


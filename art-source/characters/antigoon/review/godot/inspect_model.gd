extends SceneTree

func _initialize() -> void:
	call_deferred("inspect")

func inspect() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 1:
		push_error("Pass the absolute GLB path after --")
		quit(2)
		return
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var err := document.append_from_file(args[0], state)
	if err != OK:
		push_error("GLB import failed: %s" % err)
		quit(2)
		return
	var model := document.generate_scene(state)
	root.add_child(model)
	var bounds := AABB()
	var first := true
	var triangles := 0
	var surfaces := 0
	var coloured_surfaces := 0
	var material_maps: Array = []
	for child in model.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = child.mesh
		var box: AABB = child.global_transform * mesh.get_aabb()
		bounds = box if first else bounds.merge(box)
		first = false
		for surface in mesh.get_surface_count():
			surfaces += 1
			var arrays := mesh.surface_get_arrays(surface)
			var colours: PackedColorArray = arrays[Mesh.ARRAY_COLOR] if arrays[Mesh.ARRAY_COLOR] != null else PackedColorArray()
			var material := mesh.surface_get_material(surface) as StandardMaterial3D
			if not colours.is_empty() and material != null and material.vertex_color_use_as_albedo:
				coloured_surfaces += 1
			if material != null:
				var maps := {"name": material.resource_name, "normal_enabled": material.normal_enabled}
				for property in ["albedo_texture", "normal_texture", "roughness_texture"]:
					var texture := material.get(property) as Texture2D
					maps[property] = [texture.get_width(), texture.get_height()] if texture != null else []
				material_maps.append(maps)
			var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			triangles += indices.size() / 3 if not indices.is_empty() else arrays[Mesh.ARRAY_VERTEX].size() / 3
	var report := {"file":args[0], "height_m":bounds.size.y, "triangles":triangles, "surfaces":surfaces, "vertex_colour_surfaces":coloured_surfaces, "material_maps":material_maps, "aabb":str(bounds)}
	print("ANTIGOON_GODOT_IMPORT ", JSON.stringify(report))
	if absf(bounds.size.y - 5.4) > 0.02:
		push_error("Giant is not 5.4 metres tall")
		quit(3)
		return
	quit(0)

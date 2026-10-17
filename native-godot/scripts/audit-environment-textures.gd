extends SceneTree

var rows: Array = []
var seen: Dictionary = {}
var output := "res://proof/environment-textures"

func _initialize():
	DirAccess.make_dir_recursive_absolute(output)
	# Explicit scenery roots: city buildings, walls, litter and chandler room.
	# Never instantiate population roots or the gameplay scene for an art audit.
	for id in ["node-00004", "node-00383", "node-08213", "node-10185"]:
		var packed = load("res://world/town/roots/" + id + ".scn")
		var scenery = packed.instantiate()
		visit(scenery)
		scenery.free()
	var file = FileAccess.open(output + "/audit.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(rows, "\t"))
	print("Environment materials audited: ", rows.size())
	quit()

func visit(node: Node):
	if node.name.to_lower().contains("people") or node.name.to_lower().contains("character"):
		return
	if node is MeshInstance3D and node.mesh:
		for i in node.mesh.get_surface_count():
			var mat = node.get_active_material(i)
			if not mat: continue
			var key = mat.get_instance_id()
			if seen.has(key):
				seen[key]["uses"] += 1
				continue
			var row = {"path":mat.resource_path, "name":mat.resource_name, "node":str(node.name), "uses":1, "textures":[], "params":{}}
			seen[key] = row
			rows.append(row)
			if mat is ShaderMaterial:
				for param in mat.shader.get_shader_uniform_list():
					var value = mat.get_shader_parameter(param.name)
					if value is Texture2D:
						var image = value.get_image()
						var image_path = output + "/" + str(rows.size()) + "-" + param.name + ".png"
						if image and not image.is_empty():
							if image.is_compressed(): image.decompress()
							image.save_png(image_path)
						row.textures.append({"param":param.name, "path":value.resource_path,"width":value.get_width(),"height":value.get_height(),"image":image_path})
					elif value != null: row.params[param.name] = str(value)
			elif mat is BaseMaterial3D and mat.albedo_texture:
				var tex = mat.albedo_texture
				row.textures.append({"param":"albedo_texture","path":tex.resource_path,"width":tex.get_width(),"height":tex.get_height()})
	for child in node.get_children(): visit(child)

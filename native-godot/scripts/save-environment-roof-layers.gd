extends SceneTree

func _initialize():
	assert(DisplayServer.get_name() != "headless", "Texture2DArray serialization requires GPU readback")
	call_deferred("save_layers")

func save_layers():
	var directory = "res://assets/materials/environment-20261013/"
	for suffix in ["colour", "height"]:
		var source = "house-roofs.png" if suffix == "colour" else "house-roofs-height.png"
		var image = Image.load_from_file(ProjectSettings.globalize_path(directory + source))
		var layers: Array[Image] = []
		for y in 2:
			for x in 2:
				var layer = image.get_region(Rect2i(x*512,y*512,512,512))
				layer.generate_mipmaps()
				layers.append(layer)
		var texture = Texture2DArray.new()
		assert(texture.create_from_images(layers) == OK)
		await process_frame
		assert(texture.get_layer_data(0) != null, "GPU layer readback")
		assert(ResourceSaver.save(texture,directory + "environment_roof_" + suffix + ".res",ResourceSaver.FLAG_COMPRESS) == OK)
	print("Saved four isolated roof layers with GPU readback.")
	quit()

extends SceneTree
# Barrel textures: the town's weathered board picture (environment-20261013/wall-wood.png) with mipmaps, and its height
# (the picture's lightness, its broad shading taken out): grooves where the grain is dark.
func _initialize(): call_deferred("run")
func run():
	var src: Image = (load("res://assets/materials/environment-20261013/wall-wood.png") as Texture2D).get_image()
	src.decompress()
	var col := src.duplicate()
	col.convert(Image.FORMAT_RGBA8)
	col.generate_mipmaps()
	ResourceSaver.save(ImageTexture.create_from_image(col), "res://assets/materials/barrels-20261026/wood-texture.res", ResourceSaver.FLAG_COMPRESS)
	var w := src.get_width() / 2; var h := src.get_height() / 2
	var small := src.duplicate(); small.resize(w, h, Image.INTERPOLATE_LANCZOS)
	var blur := small.duplicate(); blur.resize(w / 16, h / 16, Image.INTERPOLATE_BILINEAR); blur.resize(w, h, Image.INTERPOLATE_BILINEAR)
	var hm := Image.create(w, h, false, Image.FORMAT_L8)
	for y in h:
		for x in w:
			var v: float = small.get_pixel(x, y).get_luminance() - blur.get_pixel(x, y).get_luminance()
			hm.set_pixel(x, y, Color(clampf(0.5 + v * 2.0, 0.0, 1.0), 0, 0))
	hm.generate_mipmaps()
	ResourceSaver.save(ImageTexture.create_from_image(hm), "res://assets/materials/barrels-20261026/wood-height-texture.res", ResourceSaver.FLAG_COMPRESS)
	print("textures ", col.get_width(), "x", col.get_height(), " height ", w, "x", h)
	quit()

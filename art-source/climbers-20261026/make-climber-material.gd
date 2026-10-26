extends SceneTree
# The climber atlas (make_climber_atlas.py) as mipmapped textures, and its material: the park plants' shader kind
# (r001171: cut out, both sides, wet, its relief), so no new kind.
func _initialize(): call_deferred("run")
func run():
	var a := OS.get_cmdline_user_args()
	var col := Image.load_from_file(a[0] + "/climbers.png"); col.convert(Image.FORMAT_RGBA8); col.generate_mipmaps()
	var hm := Image.load_from_file(a[0] + "/climbers-height.png"); hm.convert(Image.FORMAT_L8); hm.generate_mipmaps()
	var dir := "res://assets/materials/climbers-20261026/"
	ResourceSaver.save(ImageTexture.create_from_image(col), dir + "climbers-texture.res", ResourceSaver.FLAG_COMPRESS)
	ResourceSaver.save(ImageTexture.create_from_image(hm), dir + "climbers-height-texture.res", ResourceSaver.FLAG_COMPRESS)
	var m := ShaderMaterial.new()
	m.shader = load("res://world/town/resources/r001171.res")
	var src: ShaderMaterial = load("res://world/town/resources/r001176.res")
	for u in m.shader.get_shader_uniform_list():
		var v = src.get_shader_parameter(u.name)
		if v != null: m.set_shader_parameter(u.name, v)
	m.set_shader_parameter("tex", load(dir + "climbers-texture.res"))
	m.set_shader_parameter("bump_map", load(dir + "climbers-height-texture.res"))
	m.set_shader_parameter("bump_scale", 0.6)
	ResourceSaver.save(m, dir + "climbers.tres")
	print("made ", col.get_width(), "x", col.get_height())
	quit()

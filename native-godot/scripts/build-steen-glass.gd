extends SceneTree
# Issue #28: the Steen's see-through leaded glass (picture from scripts/repair-steen-windows.py). Usage:
#   godot --headless --path . -s scripts/build-steen-glass.gd -- <candidate folder>
# Writes assets/materials/town-facades-20261018/steen-glass.tres: a copy of the Steen's own glass material (r001698, the
# same shader: no new kind) with the new picture (mipmapped), and steen-atlas.tres (the museum boards drawn sharp).
const MATS := "res://assets/materials/town-facades-20261018"
func _initialize(): call_deferred("run")
func run():
	var src: String = OS.get_cmdline_user_args()[0]
	var img := Image.load_from_file(src + "/steen-glass.png"); img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	ResourceSaver.save(t, MATS + "/steen-glass-texture.res", ResourceSaver.FLAG_COMPRESS)
	var m: ShaderMaterial = load("res://world/town/resources/r001698.res").duplicate(); m.resource_name = "steen_glass_clean"
	m.set_shader_parameter("tex", load(MATS + "/steen-glass-texture.res"))
	if ResourceSaver.save(m, MATS + "/steen-glass.tres") != OK: push_error("could not save"); quit(1); return
	# the atlas with the museum boards drawn sharp (a copy of the Steen's atlas material, the same shader)
	var ai := Image.load_from_file(src + "/steen-atlas.png"); ai.generate_mipmaps(); ai.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_SRGB)
	ResourceSaver.save(ImageTexture.create_from_image(ai), MATS + "/steen-atlas-texture.res", ResourceSaver.FLAG_COMPRESS)
	var am: ShaderMaterial = load("res://world/town/resources/r001706.res").duplicate(); am.resource_name = "steen_atlas_sharp"
	am.set_shader_parameter("tex", load(MATS + "/steen-atlas-texture.res"))
	if ResourceSaver.save(am, MATS + "/steen-atlas.tres") != OK: push_error("could not save atlas"); quit(1); return
	print("steen glass built")
	quit()

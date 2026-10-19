extends SceneTree
# Issue #175: the sign pictures of scripts/sign_art.py into the game's resources. Usage:
#   godot --headless --path . -s scripts/build-signs.gd -- <art folder>
# (#193: sign_art.py with streets.json adds the plates of every named street after the cells of #175.)
# Writes assets/materials/town-facades-20261018/: the signs picture (mipmapped, compressed for the graphics card), its
# height, the letters picture, and two materials: signs.tres (a copy of the street-life material streetlife_solid, the same
# shader: no new kind) and letters.tres (a copy of streetlife_walldecal).
const MATS := "res://assets/materials/town-facades-20261018"

func _initialize(): call_deferred("run")

func texture(png: String, path: String, compress: bool) -> Texture2D:
	var img := Image.load_from_file(png)
	img.generate_mipmaps()
	if compress: img.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_SRGB)
	var t := ImageTexture.create_from_image(img)
	if ResourceSaver.save(t, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
	return load(path)

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MATS))
	var signs := texture(src + "/signs.png", MATS + "/signs-texture.res", true)
	var height := texture(src + "/signs-height.png", MATS + "/signs-height-texture.res", false)
	var letters := texture(src + "/letters.png", MATS + "/letters-texture.res", false)
	var m: ShaderMaterial = load("res://world/town/resources/r004924.res").duplicate()
	m.resource_name = "town_signs"
	m.set_shader_parameter("tex", signs); m.set_shader_parameter("bump_map", height)
	# (#193) painted boards darken in the rain (scripts/repair-wood-wet.gd); the glazed enamel plates share the picture
	m.set_shader_parameter("wet_paint", 0.8)
	if ResourceSaver.save(m, MATS + "/signs.tres") != OK: push_error("could not save signs.tres")
	var d: ShaderMaterial = load("res://world/town/resources/r004955.res").duplicate()
	d.resource_name = "town_letters"
	d.set_shader_parameter("tex", letters)
	if ResourceSaver.save(d, MATS + "/letters.tres") != OK: push_error("could not save letters.tres")
	print("signs built")
	quit()

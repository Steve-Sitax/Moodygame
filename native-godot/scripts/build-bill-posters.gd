extends SceneTree
# The bills pasted on the church squares' bared walls (scripts/bill_posters.py, #226) into the game's resources. Usage:
#   python scripts/bill_posters.py <folder>
#   godot --headless --path . -s scripts/build-bill-posters.gd -- <folder>
# Writes assets/materials/bill-posters-20261102/: bills-texture.res (mipmapped, compressed), bills.json (each bill's cell and
# size) and bills.tres: the town posters material (r005760) with the bills picture (the same shader: no new kind).
const OUT := "res://assets/materials/bill-posters-20261102"
const PAINT := "res://world/town/resources/r005760.res"

func _initialize(): call_deferred("run")

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	var img := Image.load_from_file(src + "/bills.png")
	img.generate_mipmaps()
	img.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_SRGB)
	var tex := ImageTexture.create_from_image(img)
	if ResourceSaver.save(tex, OUT + "/bills-texture.res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save the bills' picture")
	var m: ShaderMaterial = load(PAINT).duplicate()
	m.resource_name = "bill_posters"
	m.set_shader_parameter("tex", load(OUT + "/bills-texture.res"))
	if ResourceSaver.save(m, OUT + "/bills.tres") != OK: push_error("could not save the bills' material")
	var f := FileAccess.open(OUT + "/bills.json", FileAccess.WRITE)
	f.store_string(FileAccess.get_file_as_string(src + "/bills.json"))
	f.close()
	print("bill posters built")
	quit()

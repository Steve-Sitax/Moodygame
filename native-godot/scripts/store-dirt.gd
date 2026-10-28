extends SceneTree
# Issue #244: the dirt maps (art-source/dirt-20261028/maps, build_dirt.py) as compressed, mipmapped textures in
# assets/materials/dirt-20261028: <set>_dry.res and <set>_wet.res (BC7, sRGB colour, linear alpha: the shading and the
# gloss), <set>_height.res (S3TC of one channel: BC4). Usage:
#   godot --headless --path . -s scripts/store-dirt.gd -- <maps folder> <set> [<set> ...]
#   godot --headless --path . -s scripts/store-dirt.gd -- --materials
#   godot --headless --path . -s scripts/store-dirt.gd -- --silt <maps folder>   (#252: the river mud's silt_wet, silt_dry, silt_relief)
# --materials (re)writes the soil materials below: the park's relief ground shader (r000002) with its soil lines on
# (Psx.SoilLines, scripts/SoilWetRepair.cs), so no new shader kind. Metres and hollows: maps/maps.json.
const OUT := "res://assets/materials/dirt-20261028"

func store(path: String, out: String, colour: bool, srgb := true) -> void:
	var img := Image.load_from_file(path)
	if img == null: push_error("cannot read " + path); return
	if colour: img.convert(Image.FORMAT_RGBA8)
	else: img.convert(Image.FORMAT_R8)
	img.generate_mipmaps()
	var err := img.compress(Image.COMPRESS_BPTC, Image.COMPRESS_SOURCE_SRGB if srgb else Image.COMPRESS_SOURCE_GENERIC) if colour else img.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_GENERIC)
	if err != OK: push_error("cannot compress " + path); return
	var tex := ImageTexture.create_from_image(img)
	if ResourceSaver.save(tex, out, ResourceSaver.FLAG_COMPRESS) != OK: push_error("cannot save " + out); return
	print("dirt: ", out, " ", img.get_size(), " format ", img.get_format(), " mips ", img.has_mipmaps())

const SHADER := "res://world/town/resources/r000002.res"
# name: set, the parallax depth in metres (0: none), relief light, soil_pool (the height the water rises to)
const MATERIALS := {
	# (depth 0: no parallax; the tree pits' mesh takes the clods from the height map, NativeTreePits.SoilRelief)
	"pit-soil": {"set": "pit_soil", "depth": 0.0, "bump": 6.0, "dome": 1.5, "pool": 0.42},
}

func materials() -> void:
	for name in MATERIALS:
		var d: Dictionary = MATERIALS[name]
		var m := ShaderMaterial.new()
		m.resource_name = name
		m.shader = load(SHADER)
		m.set_shader_parameter("albedo", Color(1, 1, 1, 1))
		m.set_shader_parameter("tex", load(OUT + "/" + d.set + "_dry.res"))
		m.set_shader_parameter("soil_wet", load(OUT + "/" + d.set + "_wet.res"))
		m.set_shader_parameter("relief_h", load(OUT + "/" + d.set + "_height.res"))
		m.set_shader_parameter("relief_depth", d.depth)
		m.set_shader_parameter("relief_tile", 1.0)
		m.set_shader_parameter("relief_bump", d.bump)
		m.set_shader_parameter("relief_dome", d.dome)
		m.set_shader_parameter("relief_reach", 1.0)
		m.set_shader_parameter("relief_holes", 0.0)
		m.set_shader_parameter("affine", 0.0)
		m.set_shader_parameter("emission", Color(0, 0, 0, 1))
		m.set_shader_parameter("fill", 0.0)
		m.set_shader_parameter("fog_reach", 1.0)
		m.set_shader_parameter("alpha_cut", 0.5)
		m.set_shader_parameter("uv_xform", Vector4(1, 1, 0, 0))
		m.set_shader_parameter("depth_bias", 0.0)
		m.set_shader_parameter("vary", 0.0)
		# (the paving's own puddles all but off: the soil's water is in its hollows)
		m.set_shader_parameter("puddles", 0.01)
		m.set_shader_parameter("spec_color", Vector3(0.02, 0.02, 0.02))
		m.set_shader_parameter("shininess", 24.0)
		m.set_shader_parameter("soil", 1.0)
		m.set_shader_parameter("soil_pool", d.pool)
		var out: String = OUT + "/" + name + ".tres"
		if ResourceSaver.save(m, out) != OK: push_error("cannot save " + out); continue
		print("dirt: ", out)

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0 and args[0] == "--materials":
		materials(); quit(); return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	# --silt <maps folder>: the river mud's tidal silt (#252, build_silt.py): silt_wet and silt_dry BC7 sRGB colour with the
	# gloss in alpha, silt_relief BC7 linear (the normal's x and y, the height, nothing in alpha)
	if args.size() > 1 and args[0] == "--silt":
		store(args[1] + "/silt_wet.png", OUT + "/silt_wet.res", true)
		store(args[1] + "/silt_dry.png", OUT + "/silt_dry.res", true)
		store(args[1] + "/silt_relief.png", OUT + "/silt_relief.res", true, false)
		quit(); return
	for name in args.slice(1):
		store(args[0] + "/" + name + "_dry.png", OUT + "/" + name + "_dry.res", true)
		store(args[0] + "/" + name + "_wet.png", OUT + "/" + name + "_wet.res", true)
		store(args[0] + "/" + name + "_height.png", OUT + "/" + name + "_height.res", false)
	quit()

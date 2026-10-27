extends SceneTree
# St James's churchyard made larger (scripts/churchyard.py) into the game's resources. Usage:
#   python scripts/churchyard.py <folder>
#   godot --headless --path . -s scripts/build-churchyard.gd -- <folder>
# Writes assets/models/churchyard/<model>.res (indexed meshes with the engine's own LODs; meta "boxes": the collision boxes,
# [cx, cy, cz, sx, sy, sz, yaw] in the model's frame) and assets/materials/churchyard-20261027/: the carved inscriptions'
# picture and its height, churchyard-letters.tres and churchyard-ashlar.tres (copies of the guard stones' blue stone with the
# letters' and the town plinths' coursed pictures: the same shader, no new kind).
# Round 2: churchyard-stone.tres, churchyard-iron.tres and churchyard-bright.tres are the guard stone's and the barrels' iron
# materials with their albedo raised (linear x STONE_GAIN, IRON_GAIN, BRIGHT_GAIN, as churchyard_kit.py), letters and ashlar
# with them, so the baked vertex colour can lighten a worn arris or a lichen colony as well as darken a recess. The same
# pictures and shader: no new kind, no new texture. The grass and the gravel are the town's and the park's own.
const MATS := "res://assets/materials/churchyard-20261027"
const MODELS := "res://assets/models/churchyard"
const STONE := "res://assets/materials/guard-stones-20261026/guard-stone.tres"
const IRON := "res://assets/materials/barrels-20261026/barrel-iron.tres"
const GRASS := "res://world/town/resources/r000030.res"
const GRAVEL := "res://world/town/resources/r001150.res"
const PLINTH := "res://assets/materials/environment-20261013/plinth-texture.res"
const PLINTH_HEIGHT := "res://assets/materials/environment-20261013/plinth-height-texture.res"
const STONE_GAIN := 4.0
const IRON_GAIN := 8.0
const BRIGHT_GAIN := 10.0

# a copy of a material with its albedo brighter by `gain` in linear light
func raised(path: String, gain: float, name: String, out: String, overrides := {}) -> ShaderMaterial:
	var m: ShaderMaterial = load(path).duplicate()
	m.resource_name = name
	for k in overrides: m.set_shader_parameter(k, overrides[k])
	var a: Color = m.get_shader_parameter("albedo")
	var l := a.srgb_to_linear()
	var c := Color(l.r * gain, l.g * gain, l.b * gain, 1.0).linear_to_srgb()
	c.a = a.a
	m.set_shader_parameter("albedo", c)
	if ResourceSaver.save(m, out) != OK: push_error("could not save " + out)
	return load(out)

func _initialize(): call_deferred("run")

func texture(png: String, path: String, compress: bool) -> Texture2D:
	var img := Image.load_from_file(png)
	img.generate_mipmaps()
	if compress: img.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_SRGB)
	var t := ImageTexture.create_from_image(img)
	if ResourceSaver.save(t, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
	return load(path)

func mesh_of(folder: String, info: Dictionary, mats: Dictionary, lods: bool) -> ArrayMesh:
	var im := ImporterMesh.new()
	for mat in info.surfaces:
		var raw := FileAccess.get_file_as_bytes(folder + "/" + info.surfaces[mat].file)
		var f := raw.to_float32_array()
		var at := {}; var pos := PackedVector3Array(); var nor := PackedVector3Array(); var uv := PackedVector2Array(); var col := PackedColorArray(); var idx := PackedInt32Array()
		for i in f.size() / 16:
			var j := i * 16
			var key := raw.slice(j * 4, j * 4 + 64)
			var k = at.get(key, -1)
			if k < 0:
				k = pos.size(); at[key] = k
				pos.append(Vector3(f[j], f[j + 1], f[j + 2])); nor.append(Vector3(f[j + 3], f[j + 4], f[j + 5]))
				uv.append(Vector2(f[j + 6], f[j + 7])); col.append(Color(f[j + 10], f[j + 11], f[j + 12], f[j + 13]))
			idx.append(k)
		var a := []; a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = pos; a[Mesh.ARRAY_NORMAL] = nor; a[Mesh.ARRAY_TEX_UV] = uv; a[Mesh.ARRAY_COLOR] = col; a[Mesh.ARRAY_INDEX] = idx
		im.add_surface(Mesh.PRIMITIVE_TRIANGLES, a, [], {}, mats[mat], mat, Mesh.ARRAY_FLAG_COMPRESS_ATTRIBUTES)
	# (the yard's ground and its railing are many small separate pieces spread over 40 m: the engine's simplifier draws
	# long slivers between them, so they keep their full detail; every grave and vault has its levels)
	if lods: im.generate_lods(25.0, 60.0, [])
	return im.get_mesh()

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	for d in [MATS, MODELS]: DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(d))
	var tex := texture(src + "/letters.png", MATS + "/letters-texture.res", true)
	var height := texture(src + "/letters-height.png", MATS + "/letters-height-texture.res", false)
	raised(STONE, STONE_GAIN, "churchyard_letters", MATS + "/churchyard-letters.tres", {"tex": tex, "bump_map": height})
	# the vaults' coursed walls: the town plinths' blue-stone ashlar picture on the same shader
	raised(STONE, STONE_GAIN, "churchyard_ashlar", MATS + "/churchyard-ashlar.tres", {"tex": load(PLINTH), "bump_map": load(PLINTH_HEIGHT)})
	raised(STONE, STONE_GAIN, "churchyard_stone", MATS + "/churchyard-stone.tres")
	raised(IRON, IRON_GAIN, "churchyard_iron", MATS + "/churchyard-iron.tres")
	# the wreaths' dried flowers and straw: pale, in their own vertex colours (no bump: the heads are geometry)
	raised(STONE, BRIGHT_GAIN, "churchyard_bright", MATS + "/churchyard-bright.tres", {"bump_scale": 0.3})
	# the walks' gravel: the park's, its relief halved (compacted, 2 to 5 mm of stone showing, not ridges)
	var gravel: ShaderMaterial = load(GRAVEL).duplicate()
	gravel.resource_name = "churchyard_gravel"
	for p in ["relief_depth", "relief_bump"]:
		var v = gravel.get_shader_parameter(p)
		if v != null: gravel.set_shader_parameter(p, v * 0.5)
	if ResourceSaver.save(gravel, MATS + "/churchyard-gravel.tres") != OK: push_error("could not save the gravel material")
	var mats := {"stone": load(MATS + "/churchyard-stone.tres"), "letters": load(MATS + "/churchyard-letters.tres"), "ashlar": load(MATS + "/churchyard-ashlar.tres"),
		"carved": load(MATS + "/churchyard-stone.tres"), "carved_hi": load(MATS + "/churchyard-stone.tres"), "iron": load(MATS + "/churchyard-iron.tres"), "bright": load(MATS + "/churchyard-bright.tres"), "grass": load(GRASS), "gravel": load(MATS + "/churchyard-gravel.tres")}
	var kit = JSON.parse_string(FileAccess.get_file_as_string(src + "/models.json"))
	for name in kit:
		var m := mesh_of(src, kit[name], mats, not name in ["ground", "enclosure", "groundcover"])
		m.resource_name = name
		m.set_meta("boxes", kit[name].boxes)
		if ResourceSaver.save(m, MODELS + "/" + name + ".res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + name)
	print("churchyard built: ", kit.size(), " models")
	quit()

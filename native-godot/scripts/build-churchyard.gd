extends SceneTree
# St James's churchyard made larger (scripts/churchyard.py) into the game's resources. Usage:
#   python scripts/churchyard.py <folder>
#   godot --headless --path . -s scripts/build-churchyard.gd -- <folder>
# Writes assets/models/churchyard/<model>.res (indexed meshes with the engine's own LODs; meta "boxes": the collision boxes,
# [cx, cy, cz, sx, sy, sz, yaw] in the model's frame) and assets/materials/churchyard-20261027/: the carved inscriptions'
# picture and its height, churchyard-letters.tres and churchyard-ashlar.tres (copies of the guard stones' blue stone with the
# letters' and the town plinths' coursed pictures: the same shader, no new kind).
# The other surfaces use the town's own materials: the blue stone, the barrels' iron, the town grass and the park gravel.
const MATS := "res://assets/materials/churchyard-20261027"
const MODELS := "res://assets/models/churchyard"
const STONE := "res://assets/materials/guard-stones-20261026/guard-stone.tres"
const IRON := "res://assets/materials/barrels-20261026/barrel-iron.tres"
const GRASS := "res://world/town/resources/r000030.res"
const GRAVEL := "res://world/town/resources/r001150.res"
const PLINTH := "res://assets/materials/environment-20261013/plinth-texture.res"
const PLINTH_HEIGHT := "res://assets/materials/environment-20261013/plinth-height-texture.res"

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
	var letters: ShaderMaterial = load(STONE).duplicate()
	letters.resource_name = "churchyard_letters"
	letters.set_shader_parameter("tex", tex); letters.set_shader_parameter("bump_map", height)
	if ResourceSaver.save(letters, MATS + "/churchyard-letters.tres") != OK: push_error("could not save the letters material")
	# the vaults' coursed walls: the town plinths' blue-stone ashlar picture on the same shader
	var ashlar: ShaderMaterial = load(STONE).duplicate()
	ashlar.resource_name = "churchyard_ashlar"
	ashlar.set_shader_parameter("tex", load(PLINTH)); ashlar.set_shader_parameter("bump_map", load(PLINTH_HEIGHT))
	if ResourceSaver.save(ashlar, MATS + "/churchyard-ashlar.tres") != OK: push_error("could not save the ashlar material")
	var mats := {"stone": load(STONE), "letters": load(MATS + "/churchyard-letters.tres"), "ashlar": load(MATS + "/churchyard-ashlar.tres"), "iron": load(IRON), "grass": load(GRASS), "gravel": load(GRAVEL)}
	var kit = JSON.parse_string(FileAccess.get_file_as_string(src + "/models.json"))
	for name in kit:
		var m := mesh_of(src, kit[name], mats, not name in ["ground", "enclosure"])
		m.resource_name = name
		m.set_meta("boxes", kit[name].boxes)
		if ResourceSaver.save(m, MODELS + "/" + name + ".res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + name)
	print("churchyard built: ", kit.size(), " models")
	quit()

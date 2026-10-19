extends SceneTree
# Issue #174: the shop-front kit (scripts/build_shopfronts.py) and the shop goods (scripts/shop_goods.py) into the game's
# resources. Usage:
#   python scripts/shop_goods.py <folder>/goods; python scripts/build_shopfronts.py <folder>/models <folder>/goods/models.json
#   godot --headless --path . -s scripts/build-shopfronts.gd -- <folder>
# Writes assets/materials/town-shops-20261018/: the goods picture and its height, the cloth and shop-glass pictures, and
# materials: goods (a copy of the town's wood material city_wood: the same shader, no new kind), goods_glow (the same, for a
# lamp's glass: NativeShopFronts lights it in the evening), cloth (city_wood, the cloth picture) and shop_glass (a copy of
# the rooms' window glass, plain glass picture: the same shader). assets/models/shopfronts/<part>.res and
# assets/models/shopgoods/<good>.res: indexed meshes with the engine's own LODs. Painted parts read the shutters' kept paint
# (NativeShopFronts puts the worn one on a worn house's copies).
const MATS := "res://assets/materials/town-shops-20261018"
const KIT := "res://assets/models/shopfronts"
const GOODS := "res://assets/models/shopgoods"
const WOOD := "res://world/town/resources/r000216.res"
const ROOM_GLASS := "res://world/town/resources/r008835.res"
const PAINT := "res://assets/materials/town-facades-20261018/shutter-paint-kept.tres"
const CAROLUS_STONE := "res://world/town/resources/r001002.res"

func _initialize(): call_deferred("run")

func texture(png: String, path: String, compress: bool) -> Texture2D:
	var img := Image.load_from_file(png)
	img.generate_mipmaps()
	if compress: img.compress(Image.COMPRESS_S3TC, Image.COMPRESS_SOURCE_SRGB)
	var t := ImageTexture.create_from_image(img)
	if ResourceSaver.save(t, path, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + path)
	return load(path)

func material(base: String, name: String, params: Dictionary) -> Material:
	var m: ShaderMaterial = load(base).duplicate()
	m.resource_name = name
	for k in params: m.set_shader_parameter(k, params[k])
	var path := MATS + "/" + name.replace("_", "-") + ".tres"
	if ResourceSaver.save(m, path) != OK: push_error("could not save " + path)
	return load(path)

func mesh_of(folder: String, info: Dictionary, mats: Dictionary) -> ArrayMesh:
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
	im.generate_lods(25.0, 60.0, [])
	return im.get_mesh()

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	for d in [MATS, KIT, GOODS]: DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(d))
	var goods_tex := texture(src + "/goods/goods.png", MATS + "/goods-texture.res", true)
	var goods_height := texture(src + "/goods/goods-height.png", MATS + "/goods-height-texture.res", false)
	var cloth_tex := texture(src + "/goods/cloth.png", MATS + "/cloth-texture.res", true)
	var glass_tex := texture(src + "/goods/glass.png", MATS + "/shop-glass-texture.res", false)
	var goods := material(WOOD, "shop_goods", {"tex": goods_tex, "bump_map": goods_height, "bump_scale": 0.5, "wet_paint": 0.0})
	var glow := material(WOOD, "shop_goods_glow", {"tex": goods_tex, "bump_map": goods_height, "bump_scale": 0.0, "wet_paint": 0.0})
	var cloth := material(WOOD, "shop_cloth", {"tex": cloth_tex, "bump_map": cloth_tex, "bump_scale": 0.3, "wet_paint": 0.0})
	var glass := material(ROOM_GLASS, "shop_glass", {"tex": glass_tex, "albedo": Color(1, 1, 1, 1)})
	# (#28: the Carolus's parts: wrought iron and dark glass in the goods picture, the round window's ring in the church's own stone)
	var mats := {"paint": load(PAINT), "brass": goods, "glass": glass, "cloth": cloth, "goods": goods, "glow": glow, "iron": goods, "glass_dark": goods, "stone": load(CAROLUS_STONE)}
	var kit = JSON.parse_string(FileAccess.get_file_as_string(src + "/models/models.json"))
	for name in kit:
		var m := mesh_of(src + "/models", kit[name], mats)
		m.resource_name = name
		# a door leaf's size, for NativeShopFronts to fit each copy to the leaf it stands for
		if kit[name].has("height"): m.set_meta("part_size", Vector3(kit[name].width, kit[name].height, 0.05))
		elif kit[name].has("width"): m.set_meta("part_size", Vector3(kit[name].width, 2.256, 0.12))
		if ResourceSaver.save(m, KIT + "/" + name + ".res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + name)
	var gm = JSON.parse_string(FileAccess.get_file_as_string(src + "/goods/models.json")).models
	for name in gm:
		var m := mesh_of(src + "/goods", gm[name], mats)
		m.resource_name = name
		if ResourceSaver.save(m, GOODS + "/" + name + ".res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + name)
	print("shop fronts built: ", kit.size(), " parts, ", gm.size(), " goods")
	quit()

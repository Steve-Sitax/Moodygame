extends SceneTree
# The builder's scaffold (scripts/scaffold.py, #226) into the game's resources. Usage:
#   python scripts/scaffold.py <folder>
#   godot --headless --path . -s scripts/build-scaffold.gd -- <folder>
# Writes assets/models/scaffold-20261102/: scaffold-mesh.res (two surfaces: the town's board wood, the rope),
# scaffold.tscn (the mesh and its collision: cylinders and boxes) and assets/materials/scaffold-20261102/: the rope's
# picture and height (mipmapped) and scaffold-rope.tres, the barrels' wood material with the rope's pictures (the same
# shader: no new kind).
const MODELS := "res://assets/models/scaffold-20261102"
const MATS := "res://assets/materials/scaffold-20261102"
const WOOD := "res://assets/materials/barrels-20261026/barrel-wood.tres"

func _initialize(): call_deferred("run")

func picture(path: String, out: String, srgb: bool) -> Texture2D:
	var img := Image.load_from_file(path)
	if not srgb: img.convert(Image.FORMAT_L8)
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	if ResourceSaver.save(tex, out, ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save " + out)
	return load(out)

func run():
	var src: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MODELS))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MATS))
	var rope_tex := picture(src + "/rope.png", MATS + "/rope-texture.res", true)
	var rope_bump := picture(src + "/rope-height.png", MATS + "/rope-height-texture.res", false)
	var rope: ShaderMaterial = load(WOOD).duplicate()
	rope.resource_name = "scaffold_rope"
	rope.set_shader_parameter("tex", rope_tex)
	rope.set_shader_parameter("bump_map", rope_bump)
	rope.set_shader_parameter("albedo", Color(1, 1, 1, 1))
	if ResourceSaver.save(rope, MATS + "/scaffold-rope.tres") != OK: push_error("could not save the rope material")
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(src + "/scaffold.json"))
	var mesh := ArrayMesh.new()
	mesh.resource_name = "scaffold"
	var materials := {"wood": load(WOOD), "rope": load(MATS + "/scaffold-rope.tres")}
	for s in data["surfaces"]:
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var v: Array = s["v"]; var n: Array = s["n"]; var uv: Array = s["uv"]
		for i in v.size():
			st.set_normal(Vector3(n[i][0], n[i][1], n[i][2]))
			st.set_uv(Vector2(uv[i][0], uv[i][1]))
			st.add_vertex(Vector3(v[i][0], v[i][1], v[i][2]))
		st.index()
		st.generate_tangents()
		st.commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, materials[s["name"]])
		mesh.surface_set_name(mesh.get_surface_count() - 1, s["name"])
	if ResourceSaver.save(mesh, MODELS + "/scaffold-mesh.res", ResourceSaver.FLAG_COMPRESS) != OK: push_error("could not save the scaffold mesh")
	var root := Node3D.new(); root.name = "scaffold"
	var mi := MeshInstance3D.new(); mi.name = "Mesh"; mi.mesh = load(MODELS + "/scaffold-mesh.res")
	root.add_child(mi); mi.owner = root
	var body := StaticBody3D.new(); body.name = "Solid"; body.collision_layer = 1; body.collision_mask = 0
	root.add_child(body); body.owner = root
	var k := 0
	for sh in data["shapes"]:
		var cs := CollisionShape3D.new(); cs.name = "Shape%d" % k; k += 1
		if sh["kind"] == "cylinder":
			var a := Vector3(sh["from"][0], sh["from"][1], sh["from"][2]); var b := Vector3(sh["to"][0], sh["to"][1], sh["to"][2])
			var c := CylinderShape3D.new(); c.radius = sh["radius"]; c.height = a.distance_to(b)
			cs.shape = c
			var y := (b - a).normalized(); var x := y.cross(Vector3.FORWARD).normalized()
			if x.length() < 0.5: x = y.cross(Vector3.RIGHT).normalized()
			var z := x.cross(y)
			cs.transform = Transform3D(Basis(x, y, z), (a + b) / 2)
		else:
			var bx := BoxShape3D.new(); bx.size = Vector3(sh["size"][0], sh["size"][1], sh["size"][2])
			cs.shape = bx
			var B: Array = sh["basis"]
			cs.transform = Transform3D(Basis(Vector3(B[0][0], B[0][1], B[0][2]), Vector3(B[1][0], B[1][1], B[1][2]), Vector3(B[2][0], B[2][1], B[2][2])), Vector3(sh["centre"][0], sh["centre"][1], sh["centre"][2]))
		body.add_child(cs); cs.owner = root
	var packed := PackedScene.new(); packed.pack(root)
	if ResourceSaver.save(packed, MODELS + "/scaffold.tscn") != OK: push_error("could not save the scaffold scene")
	var tris := 0
	for s in mesh.get_surface_count(): tris += mesh.surface_get_array_index_len(s) / 3
	print("scaffold built: ", tris, " triangles, ", k, " shapes")
	quit()

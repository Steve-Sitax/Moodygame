extends SceneTree
# (#248) the root flare from Blender (root_flare.glb) into the game's mesh resource. Headless:
#   godot --headless --path native-godot --script <this file> -- <root_flare.glb> res://assets/models/root-flare-20261102/root_flare.res
# glTF is y up already; its v runs from the top, so the model's v (metres down from the join) is 1 - v. No material:
# NativeTreePits gives each copy its tree's bark.
func _initialize(): call_deferred("run")
func run():
	var a := OS.get_cmdline_user_args()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(a[0], state) != OK:
		push_error("cannot read " + a[0]); quit(1); return
	var scene := doc.generate_scene(state)
	var mi: MeshInstance3D = null
	var stack := [scene]
	while stack.size() > 0:
		var n = stack.pop_back()
		if n is MeshInstance3D: mi = n
		for c in n.get_children(): stack.append(c)
	var src: Mesh = mi.mesh
	var arr = src.surface_get_arrays(0)
	var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	for i in uv.size(): uv[i] = Vector2(uv[i].x, 1.0 - uv[i].y)
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_COLOR] = null
	arr[Mesh.ARRAY_TANGENT] = null
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.resource_name = "tree_root_flare"
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var lo := Vector2(9, 9); var hi := Vector2(-9, -9)
	for p in uv: lo = Vector2(min(lo.x, p.x), min(lo.y, p.y)); hi = Vector2(max(hi.x, p.x), max(hi.y, p.y))
	print("root flare: ", vs.size(), " corners, ", (arr[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3, " triangles, u ", lo.x, "-", hi.x, ", v ", lo.y, "-", hi.y, ", aabb ", m.get_aabb())
	if ResourceSaver.save(m, a[1], ResourceSaver.FLAG_COMPRESS) != OK: push_error("cannot save " + a[1]); quit(1); return
	print("root flare: saved ", a[1])
	scene.free()
	quit()

extends SceneTree
# Issue #149: stores the pavement cellar hatch (art-source/tools/blender/build_laundry.py's cellar_hatch.glb) as the
# street-props kit's hatch model: its mesh (the picture BC7 with mipmaps, in the mesh's material) and a convex collision
# box the size of its frame, flush with the paving. Usage (rendered, not headless: the picture is compressed on the card's
# formats):  godot --rendering-method forward_plus --path . -s scripts/store-cellar-hatch.gd -- <cellar_hatch.glb>
func _initialize(): call_deferred("run")

func run():
	var glb = OS.get_cmdline_user_args()[0]
	var doc = GLTFDocument.new(); var state = GLTFState.new()
	if doc.append_from_file(glb, state) != OK: push_error("read " + glb); quit(1); return
	var scene = doc.generate_scene(state)
	var mi = scene.find_children("*", "MeshInstance3D", true, false)[0]
	var mesh: ArrayMesh = mi.mesh
	var mat: StandardMaterial3D = mesh.surface_get_material(0)
	var img: Image = mat.albedo_texture.get_image()
	img.generate_mipmaps(); img.compress(Image.COMPRESS_BPTC, Image.COMPRESS_SOURCE_SRGB)
	var tex = ImageTexture.create_from_image(img); tex.resource_name = "cellar_hatch"
	mat.albedo_texture = tex
	mat.resource_name = "M_cellar_hatch_pavement"
	mesh.resource_name = "cellar_hatch_pavement"
	var out = "res://assets/models/street-furniture/cellar-hatch.res"
	if ResourceSaver.save(mesh, out, ResourceSaver.FLAG_COMPRESS) != OK: push_error("save " + out); quit(1); return
	# the frame's box: 1.10 m along the wall, 0.44 m out, from 5 cm under the paving to its top 3 mm over it
	var shape = ConvexPolygonShape3D.new()
	var pts = PackedVector3Array()
	for x in [-0.55, 0.55]:
		for y in [-0.05, 0.003]:
			for z in [0.0, 0.44]: pts.append(Vector3(x, y, z))
	shape.points = pts
	if ResourceSaver.save(shape, "res://assets/models/street-furniture/cellar-hatch-shape.res") != OK: push_error("save shape"); quit(1); return
	print("cellar hatch stored: ", mesh.get_surface_count(), " surface, ", mesh.surface_get_array_index_len(0) / 3, " triangles, aabb ", mesh.get_aabb())
	scene.free()
	quit()

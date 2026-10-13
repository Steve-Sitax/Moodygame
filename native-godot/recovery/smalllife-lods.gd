extends SceneTree

# Authoring only: simplify indices while retaining the rest vertices, UV bone selectors and weights.
# The game loads these stored LODs; no simplification runs in front of a player.
func _init() -> void:
	var scene := load("res://assets/game-models/smalllife.scn") as PackedScene
	var root := scene.instantiate()
	var rows: Array = []
	for node in root.get_children():
		if not node is MeshInstance3D:
			continue
		var mesh: ArrayMesh = node.mesh
		var path := mesh.resource_path
		if not path.begins_with("res://assets/game-models/smalllife-resources/"):
			push_error("Small-life LOD target escaped its owned resources: " + path)
			quit(1)
			return
		var importer := ImporterMesh.new()
		importer.add_surface(Mesh.PRIMITIVE_TRIANGLES, mesh.surface_get_arrays(0), [], {}, mesh.surface_get_material(0))
		importer.generate_lods(60, 0, [])
		var result := importer.get_mesh()
		var before := mesh.surface_get_arrays(0)
		var after := result.surface_get_arrays(0)
		if before[Mesh.ARRAY_VERTEX] != after[Mesh.ARRAY_VERTEX] or before[Mesh.ARRAY_TEX_UV2] != after[Mesh.ARRAY_TEX_UV2]:
			push_error("LOD changed the skin's vertices or weights: " + str(node.name))
			quit(1)
			return
		if ResourceSaver.save(result, path) != OK:
			push_error("Cannot save small-life LOD mesh")
			quit(1)
			return
		var counts: Array = []
		for i in range(importer.get_surface_lod_count(0)):
			counts.append(importer.get_surface_lod_indices(0, i).size() / 3)
		rows.append({"kind": str(node.name), "nearTriangles": before[Mesh.ARRAY_INDEX].size() / 3, "lodTriangles": counts})
	root.free()
	print("SMALLLIFE_LODS ", JSON.stringify(rows))
	quit()

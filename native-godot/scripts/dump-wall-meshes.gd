extends SceneTree
# (#301) WALL_DUMP=<folder> godot --headless --path . -s res://scripts/dump-wall-meshes.gd
# Writes every town-wall chunk and gate mesh: world-space triangles (x,y,z per vertex) per surface, and an index (json).
var OUT = OS.get_environment("WALL_DUMP")
func _initialize(): call_deferred("run")
func run():
	DirAccess.make_dir_recursive_absolute(OUT)
	var index = []
	for f in DirAccess.get_files_at("res://world/town/roots"):
		if not f.ends_with(".scn"): continue
		var ps = load("res://world/town/roots/" + f)
		var scene = ps.instantiate()
		root.add_child(scene)
		var found = scene.find_children("wall_chunk_*", "MeshInstance3D", true, false) + scene.find_children("gate_*", "MeshInstance3D", true, false)
		for node in found:
			if not node.mesh: continue
			var rec = {"root": f, "node": str(scene.get_path_to(node)), "name": str(node.name), "mesh": node.mesh.resource_path, "surfaces": []}
			for s in node.mesh.get_surface_count():
				var a = node.mesh.surface_get_arrays(s)
				var idx = a[Mesh.ARRAY_INDEX]
				if idx == null or idx.size() == 0: idx = PackedInt32Array(range(a[0].size()))
				var buf = PackedFloat32Array(); buf.resize(idx.size() * 3)
				var xf = node.global_transform
				for k in idx.size():
					var p = xf * a[0][idx[k]]
					buf[k*3] = p.x; buf[k*3+1] = p.y; buf[k*3+2] = p.z
				var file = "%s_%d.bin" % [str(node.name), s]
				var fa = FileAccess.open(OUT + "/" + file, FileAccess.WRITE); fa.store_buffer(buf.to_byte_array()); fa.close()
				var mat = node.get_active_material(s)
				rec["surfaces"].append({"file": file, "tris": idx.size() / 3, "material": mat.resource_path if mat else ""})
			index.append(rec)
		scene.queue_free()
	var fi = FileAccess.open(OUT + "/index.json", FileAccess.WRITE); fi.store_string(JSON.stringify(index, " ")); fi.close()
	print("wall dump: ", index.size(), " meshes")
	quit()

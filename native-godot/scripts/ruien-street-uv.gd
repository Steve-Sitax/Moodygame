extends SceneTree
# Offline promotion: -- --mesh <resource> --patch <json> --backup <new external path>.
# Only UV changes. Preserve every vertex, triangle, material, collision stand-in and scene ID.
func _initialize():
	var args=OS.get_cmdline_user_args()
	var path=args[args.find('--mesh')+1]
	var patch=args[args.find('--patch')+1]
	var backup=args[args.find('--backup')+1]
	assert(not FileAccess.file_exists(backup), 'Backup already exists')
	assert(DirAccess.copy_absolute(ProjectSettings.globalize_path(path),backup)==OK)
	var old=load(path)
	var mesh=ArrayMesh.new()
	for key in old.get_meta_list(): mesh.set_meta(key,old.get_meta(key))
	var edits=JSON.parse_string(FileAccess.get_file_as_string(patch))
	for s in range(old.get_surface_count()):
		var arrays=old.surface_get_arrays(s)
		if s==0:
			var uv=arrays[Mesh.ARRAY_TEX_UV]
			for row in edits.uv: uv[int(row[0])]=Vector2(row[1],row[2])
			arrays[Mesh.ARRAY_TEX_UV]=uv
		mesh.add_surface_from_arrays(old.surface_get_primitive_type(s),arrays,[],{},old.surface_get_format(s))
		mesh.surface_set_material(s,old.surface_get_material(s))
		mesh.surface_set_name(s,old.surface_get_name(s))
	assert(ResourceSaver.save(mesh,path,ResourceSaver.FLAG_COMPRESS)==OK)
	print('Street UV chart repaired: ',edits.triangles,' triangles, bounds ',edits.bounds)
	quit()

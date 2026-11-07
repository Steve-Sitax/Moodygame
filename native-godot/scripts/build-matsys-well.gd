extends SceneTree
# Replaces only the old well's triangles inside its existing native street mesh.
const TARGET = "res://world/town/resources/r004940.res"
const DIR = "res://assets/models/matsys-well"
func _initialize(): call_deferred("run")
func run():
	var src = OS.get_cmdline_user_args()[0]
	var info = JSON.parse_string(FileAccess.get_file_as_string(src + "/model.json"))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DIR))
	var mats = {"stone": load("res://assets/materials/churchyard-20261027/churchyard-stone.tres"), "iron": load("res://assets/materials/churchyard-20261027/churchyard-iron.tres"), "bronze": load("res://assets/materials/churchyard-20261027/churchyard-iron.tres"), "rope": load("res://assets/materials/churchyard-20261027/churchyard-bright.tres")}
	mats["mortar"] = mats["stone"]
	var mesh := ArrayMesh.new()
	for mat in info.surfaces:
		var f = FileAccess.get_file_as_bytes(src + "/" + info.surfaces[mat].file).to_float32_array()
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for i in f.size()/16:
			var j = i*16
			st.set_normal(Vector3(f[j+3],f[j+4],f[j+5]))
			st.set_uv(Vector2(f[j+6],f[j+7]))
			st.set_color(Color(f[j+10],f[j+11],f[j+12],f[j+13]))
			st.add_vertex(Vector3(f[j],f[j+1],f[j+2]))
		st.index(); st.generate_tangents(); st.set_material(mats[mat]); st.commit(mesh)
	mesh.resource_name = "Quinten Matsijs well, 1873"
	assert(ResourceSaver.save(mesh, DIR+"/well.res", ResourceSaver.FLAG_COMPRESS)==OK)
	# Always rebuild from the archived source: repeatable without accumulating surfaces.
	var old: ArrayMesh = load("res://../art-source/matsys-well-20261103/r004940-original.res")
	var merged := ArrayMesh.new()
	var removed := 0
	for s in old.get_surface_count():
		var a = old.surface_get_arrays(s)
		var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
		var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		if idx.is_empty(): idx = PackedInt32Array(range(v.size()))
		var keep := PackedInt32Array()
		for i in range(0,idx.size(),3):
			var c = (v[idx[i]]+v[idx[i+1]]+v[idx[i+2]])/3
			if c.x > -248.9 and c.x < -247.1 and c.z > 136.6 and c.z < 138.4:
				removed += 1
			else: keep.append_array(idx.slice(i,i+3))
		a[Mesh.ARRAY_INDEX]=keep
		merged.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,a)
		merged.surface_set_material(s,old.surface_get_material(s))
	assert(removed > 500 and removed < 10000, "unexpected original well footprint")
	for s in mesh.get_surface_count():
		var a=mesh.surface_get_arrays(s)
		var v: PackedVector3Array=a[Mesh.ARRAY_VERTEX]
		for i in v.size(): v[i]+=Vector3(-248,0,137.5)
		a[Mesh.ARRAY_VERTEX]=v
		merged.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,a)
		merged.surface_set_material(merged.get_surface_count()-1,mesh.surface_get_material(s))
	merged.resource_name=old.resource_name
	for key in old.get_meta_list(): merged.set_meta(key,old.get_meta(key))
	assert(ResourceSaver.save(merged,TARGET,ResourceSaver.FLAG_COMPRESS)==OK)
	print("Matsijs well: ",info.triangles," triangles; removed ",removed," old triangles; retained other street objects")
	quit()

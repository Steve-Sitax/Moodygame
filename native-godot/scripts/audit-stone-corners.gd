extends SceneTree
# Issue #157: export one city chunk's house meshes as world-space rows (16 floats per vertex, the wall-circuit
# format) for the Blender corner-stone repair. Usage: godot --headless --path . -s scripts/audit-stone-corners.gd
#   -- <absolute output folder> <node prefix: city_-2_0 for one chunk, city_ for the town> [material,material,...]
# Only meshes with one of the materials are written (default: house stone, brick/plaster fronts, grime decals).
# Reads only; writes nothing inside the project.
func _initialize(): call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	var named=args.has("--out")
	var out=args[args.find("--out")+1] if named else args[0]
	var prefix="" if named else args[1]
	var wanted=(args[args.find("--materials")+1] if named else (args[2] if args.size()>2 else "r000209.res,r000195.res,r000221.res")).split(",")
	var original=args[args.find("--original-dir")+1] if args.has("--original-dir") else ""
	DirAccess.make_dir_recursive_absolute(out+"/source")
	var records=[]
	var seen={}
	var scene=load("res://world/town/scene.tscn" if named else "res://world/town/roots/node-00004.scn").instantiate()
	root.add_child(scene)
	for node in scene.find_children("*","MeshInstance3D",true,false):
		if not node.mesh or (not named and not (str(node.name)==prefix or str(node.name).begins_with(prefix if prefix.ends_with("_") else prefix+"_"))):continue
		var installed_path=node.mesh.resource_path
		if seen.has(installed_path):continue
		var installed_hash=FileAccess.get_sha256(installed_path)
		if original!="" and FileAccess.file_exists(original+"/"+installed_path.get_file()):
			node.mesh=ResourceLoader.load(original+"/"+installed_path.get_file(),"",ResourceLoader.CACHE_MODE_IGNORE)
		var hit=false
		for s in node.mesh.get_surface_count():
			var m=node.get_active_material(s)
			if m and (m.resource_path.get_file() in wanted or m.resource_name in wanted):hit=true
		if not hit:continue
		seen[installed_path]=true
		var record={"node":str(node.name),"nodePath":str(scene.get_path_to(node)),"mesh":installed_path,"meshHash":installed_hash,"sourceHash":FileAccess.get_sha256(node.mesh.resource_path),"surfaceCount":node.mesh.get_surface_count(),"visibilityEnd":node.visibility_range_end,"surfaces":[]}
		for s in node.mesh.get_surface_count():
			var mat=node.get_active_material(s)
			if named and (not mat or not (mat.resource_path.get_file() in wanted or mat.resource_name in wanted)):continue
			var a=node.mesh.surface_get_arrays(s);var indices=a[Mesh.ARRAY_INDEX]
			if indices==null or indices.size()==0:indices=PackedInt32Array(range(a[0].size()))
			var rows=PackedFloat32Array();rows.resize(indices.size()*16)
			var nmat=node.global_basis.inverse().transposed()
			for k in indices.size():
				var i=indices[k];var p=node.global_transform*a[0][i];var n=(nmat*a[1][i]).normalized()
				var uv=a[Mesh.ARRAY_TEX_UV][i] if a[Mesh.ARRAY_TEX_UV]!=null else Vector2.ZERO
				var uv2=a[Mesh.ARRAY_TEX_UV2][i] if a[Mesh.ARRAY_TEX_UV2]!=null else Vector2.ZERO
				var c=a[Mesh.ARRAY_COLOR][i] if a[Mesh.ARRAY_COLOR]!=null else Color.WHITE
				var rr=[p.x,p.y,p.z,n.x,n.y,n.z,uv.x,uv.y,uv2.x,uv2.y,c.r,c.g,c.b,c.a,0,0]
				if a[Mesh.ARRAY_CUSTOM0]!=null:rr[14]=a[Mesh.ARRAY_CUSTOM0][i*2];rr[15]=a[Mesh.ARRAY_CUSTOM0][i*2+1]
				for j in 16:rows[k*16+j]=rr[j]
			var name=node.mesh.resource_path.get_file().get_basename()+"-"+str(s)
			FileAccess.open(out+"/source/"+name+".bin",FileAccess.WRITE).store_buffer(rows.to_byte_array())
			var surface={"index":s,"file":name+".bin","material":mat.resource_path if mat else "","name":mat.resource_name if mat else "","vertices":indices.size(),"custom0":a[Mesh.ARRAY_CUSTOM0]!=null,"textures":[]}
			if mat is ShaderMaterial:
				FileAccess.open(out+"/source/"+mat.resource_path.get_file().get_basename()+".gdshader",FileAccess.WRITE).store_string(mat.shader.code)
				for param in mat.shader.get_shader_uniform_list():
					var value=mat.get_shader_parameter(param.name)
					if value is Texture2D:surface.textures.append({"parameter":param.name,"path":value.resource_path,"width":value.get_width(),"height":value.get_height()})
					elif value!=null:surface[param.name]=str(value)
			record.surfaces.append(surface)
		records.append(record)
	scene.free()
	FileAccess.open(out+"/audit.json",FileAccess.WRITE).store_string(JSON.stringify(records,"\t"))
	print("Stone corners audit: ",records.size()," meshes in ",prefix)
	quit()

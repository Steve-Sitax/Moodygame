extends SceneTree
# Issue #157: export one city chunk's house meshes as world-space rows (16 floats per vertex, the wall-circuit
# format) for the Blender corner-stone repair. Usage: godot --headless --path . -s scripts/audit-stone-corners.gd
#   -- <absolute output folder> <chunk prefix, e.g. city_-2_0>. Reads only; writes nothing inside the project.
func _initialize(): call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var out=args[0];var prefix=args[1]
	DirAccess.make_dir_recursive_absolute(out+"/source")
	var records=[]
	var scene=load("res://world/town/roots/node-00004.scn").instantiate()
	root.add_child(scene)
	for node in scene.find_children("*","MeshInstance3D",true,false):
		if not node.mesh or not (str(node.name)==prefix or str(node.name).begins_with(prefix+"_")):continue
		var record={"node":str(node.name),"mesh":node.mesh.resource_path,"meshHash":FileAccess.get_sha256(node.mesh.resource_path),"visibilityEnd":node.visibility_range_end,"surfaces":[]}
		for s in node.mesh.get_surface_count():
			var mat=node.get_active_material(s)
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

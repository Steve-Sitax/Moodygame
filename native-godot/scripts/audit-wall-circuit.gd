extends SceneTree
const OUT="res://proof/wall-circuit"
func _initialize(): call_deferred("run")
func run():
	DirAccess.make_dir_recursive_absolute(OUT+"/source")
	var records=[]
	for id in ["node-00383","node-00004"]:
		var scene=load("res://world/town/roots/"+id+".scn").instantiate()
		root.add_child(scene)
		for node in scene.find_children("*","MeshInstance3D",true,false):
			if not node.mesh:continue
			if id=="node-00004" and not str(node.name).begins_with("ground_"):continue
			var record={"node":str(node.name),"mesh":node.mesh.resource_path,"surfaces":[]}
			for s in node.mesh.get_surface_count():
				var mat=node.get_active_material(s)
				var a=node.mesh.surface_get_arrays(s);var indices=a[Mesh.ARRAY_INDEX]
				if indices==null or indices.size()==0:indices=PackedInt32Array(range(a[0].size()))
				var rows=PackedFloat32Array();rows.resize(indices.size()*16)
				var bbox=AABB();var first=true;var nmat=node.global_basis.inverse().transposed()
				for k in indices.size():
					var i=indices[k];var p=node.global_transform*a[0][i];var n=(nmat*a[1][i]).normalized()
					var uv=a[Mesh.ARRAY_TEX_UV][i] if a[Mesh.ARRAY_TEX_UV]!=null else Vector2.ZERO
					var uv2=a[Mesh.ARRAY_TEX_UV2][i] if a[Mesh.ARRAY_TEX_UV2]!=null else Vector2.ZERO
					var c=a[Mesh.ARRAY_COLOR][i] if a[Mesh.ARRAY_COLOR]!=null else Color.WHITE
					var rr=[p.x,p.y,p.z,n.x,n.y,n.z,uv.x,uv.y,uv2.x,uv2.y,c.r,c.g,c.b,c.a,0,0]
					if a[Mesh.ARRAY_CUSTOM0]!=null:rr[14]=a[Mesh.ARRAY_CUSTOM0][i*2];rr[15]=a[Mesh.ARRAY_CUSTOM0][i*2+1]
					for j in 16:rows[k*16+j]=rr[j]
					if first:bbox=AABB(p,Vector3.ZERO);first=false
					else:bbox=bbox.expand(p)
				var name=node.mesh.resource_path.get_file().get_basename()+"-"+str(s)
				FileAccess.open(OUT+"/source/"+name+".bin",FileAccess.WRITE).store_buffer(rows.to_byte_array())
				var surface={"index":s,"file":name+".bin","material":mat.resource_path,"name":mat.resource_name,"triangles":indices.size()/3,"custom0":a[Mesh.ARRAY_CUSTOM0]!=null,"min":[bbox.position.x,bbox.position.y,bbox.position.z],"max":[bbox.end.x,bbox.end.y,bbox.end.z],"textures":[]}
				if mat is ShaderMaterial:
					FileAccess.open(OUT+"/source/"+mat.resource_path.get_file().get_basename()+".gdshader",FileAccess.WRITE).store_string(mat.shader.code)
					for param in mat.shader.get_shader_uniform_list():
						var value=mat.get_shader_parameter(param.name)
						if value is Texture2D:surface.textures.append({"parameter":param.name,"width":value.get_width(),"height":value.get_height()})
				record.surfaces.append(surface)
			records.append(record)
		scene.free()
	FileAccess.open(OUT+"/audit.json",FileAccess.WRITE).store_string(JSON.stringify(records,"\t"))
	print("Full wall audit: ",records.size()," scenery meshes")
	quit()

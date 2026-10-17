extends SceneTree
func _initialize():
	for id in ["r000630","r000642","r000648","r000615","r000016","r000024","r000007","r000045","r000195","r000209"]:
		var mat=load("res://world/town/resources/"+id+".res")
		FileAccess.open("res://proof/city-junction/"+id+".gdshader",FileAccess.WRITE).store_string(mat.shader.code)
		print(id," depth=",mat.get_shader_parameter("depth_bias")," bump=",mat.get_shader_parameter("bump_scale")," albedo=",mat.get_shader_parameter("albedo"))
		if id in ["r000195","r000209"]: mat.get_shader_parameter("tex").get_image().save_png("res://proof/city-junction/"+id+"-atlas.png")
	for id in ["r000264","r000265","r000878","r000879"]:
		var mesh=load("res://world/town/resources/"+id+".res")
		var a=mesh.surface_get_arrays(0)
		print(id," format=",mesh.surface_get_format(0)," custom0type=",typeof(a[Mesh.ARRAY_CUSTOM0])," vertexcount=",a[0].size())
		if a[Mesh.ARRAY_CUSTOM0]!=null: print("custom0size=",a[Mesh.ARRAY_CUSTOM0].size()," first=",a[Mesh.ARRAY_CUSTOM0].slice(0,16))
	quit()

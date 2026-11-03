extends SceneTree
# Verify exact original surfaces and collision metadata after a fitted repair.
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:
		push_error("Usage: -- ORIGINAL_RESOURCE_DIR EXTERNAL_RECEIPT_JSON")
		quit(1)
		return
	var receipts=[]
	for id in ["r000008","r000017","r000025","r000031","r000039"]:
		var before=load(args[0].path_join(id+".res"))
		var after=load("res://world/town/resources/"+id+".res")
		var row={"id":id,"channels":[],"pass":true}
		for s in before.get_surface_count():
			var a=before.surface_get_arrays(s)
			var b=after.surface_get_arrays(s)
			for channel in Mesh.ARRAY_MAX:
				var equal=a[channel]==b[channel]
				row.channels.append({"channel":channel,"identical":equal})
				if not equal:row.pass=false
			if before.surface_get_format(s)!=after.surface_get_format(s):row.pass=false
			if before.surface_get_primitive_type(s)!=after.surface_get_primitive_type(s):row.pass=false
			if before.surface_get_material(s)!=after.surface_get_material(s):row.pass=false
		for key in before.get_meta_list():
			if before.get_meta(key)!=after.get_meta(key):
				row.pass=false
				row["metadata_mismatch"]=str(key)
		var invalid=0
		var degenerate=0
		var wrong_winding=0
		for s in range(before.get_surface_count(),after.get_surface_count()):
			var arrays=after.surface_get_arrays(s)
			var vertices=arrays[Mesh.ARRAY_VERTEX]
			var indices=arrays[Mesh.ARRAY_INDEX]
			for v in vertices:
				if not v.is_finite():invalid+=1
			for n in arrays[Mesh.ARRAY_NORMAL]:
				if not n.is_finite():invalid+=1
			for t in arrays[Mesh.ARRAY_TANGENT]:
				if not is_finite(t):invalid+=1
			for k in range(0,indices.size(),3):
				var a=vertices[indices[k]];var b=vertices[indices[k+1]];var c=vertices[indices[k+2]]
				var cross=(b-a).cross(c-a)
				if cross.length_squared()==0:degenerate+=1
				if cross.y>0:wrong_winding+=1
		row["added_invalid_values"]=invalid
		row["added_degenerate_triangles"]=degenerate
		row["added_wrong_winding"]=wrong_winding
		if invalid or degenerate or wrong_winding:row.pass=false
		receipts.append(row)
	FileAccess.open(args[1],FileAccess.WRITE).store_string(JSON.stringify(receipts,"  "))
	print(JSON.stringify(receipts))
	quit(0 if receipts.all(func(x):return x.pass) else 1)

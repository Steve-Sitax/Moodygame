extends SceneTree
## Run with Godot --headless --path native-godot --script res://scripts/bake-ruien-landmarks.gd.
## The model is a shallow facing on surveyed, already solid masonry. Hidden backs mate to
## the existing walls. All exposed fired-brick edges carry a 2–4 mm worn arris.

const TARGET = "res://assets/models/ruien-junctions/landmarks.scn"
const FAMILY = "res://world/ruien/textures/brick_stretcher_"
const FACE = Vector3(59.9,-2.58,15.13)
const RIJN = "res://world/ruien/complete/j026/"
const INNER = 1.065
const OUTER = 1.285
const SPRING = Vector3(74.45,-3.12,202)

var height: Image
var along := Vector2.RIGHT
var cell := Vector2i.ZERO
var crop := Vector2i.ZERO
var crop_center := Vector2.ZERO
var tools := {}
var finishes := {}
var model_root := Node3D.new()
var rng := RandomNumberGenerator.new()
var key := ""

func _initialize() -> void:
	rng.seed = 640026
	model_root.name = "RuienJunctionLandmarks"
	make_materials()
	repair()
	seal()
	if not repair_clearance():
		model_root.free()
		quit(1)
		return
	var scene := PackedScene.new()
	var err := scene.pack(model_root)
	if err == OK:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TARGET.get_base_dir()))
		err = ResourceSaver.save(scene, TARGET, ResourceSaver.FLAG_COMPRESS)
	if err == OK:
		var saved: PackedScene = ResourceLoader.load(TARGET,"PackedScene",ResourceLoader.CACHE_MODE_IGNORE)
		var baked := saved.instantiate()
		for child: MeshInstance3D in baked.get_children():
			var mat: ShaderMaterial = child.mesh.surface_get_material(0)
			for slot in ["albedo_tex","normal_tex","hra_tex"]:
				var texture: Texture2D = mat.get_shader_parameter(slot)
				if not texture or texture.get_width() != 2048: err = ERR_FILE_CORRUPT
		baked.free()
	print("Junction landmarks: ", error_string(err))
	model_root.free()
	quit(0 if err == OK else 1)

func make_materials() -> void:
	# The repair uses the very atlas, normals, height, soot and lime of this gallery.
	# The arch charts each voussoir onto the interior of a selected real brick in it.
	var shader: Shader = load("res://shaders/ruien_masonry.gdshader")
	height = load(FAMILY+"hra.res").get_image()
	if height.is_compressed(): height.decompress()
	for label in ["renewed_lime","voussoir","bedding"]:
		var mat := ShaderMaterial.new()
		mat.resource_name = label
		mat.shader = shader
		for pair in [["albedo_tex","albedo"],["normal_tex","normal"],["hra_tex","hra"],["slime_tex","slime"],["lime_tex","lime"]]:
			mat.set_shader_parameter(pair[0],load(FAMILY+pair[1]+".res"))
		mat.set_shader_parameter("moss_albedo",load("res://world/ruien/textures/moss_albedo.res"))
		mat.set_shader_parameter("moss_normal",load("res://world/ruien/textures/moss_normal.res"))
		mat.set_shader_parameter("variants",1.)
		mat.set_shader_parameter("relief_m",.097 if label=="renewed_lime" else .013)
		mat.set_shader_parameter("pom",.32)
		mat.set_shader_parameter("rough_floor",.42)
		mat.set_shader_parameter("halo_k",.20 if label=="renewed_lime" else .48)
		mat.set_shader_parameter("bake_k",.85 if label=="renewed_lime" else 0.)
		finishes[label] = mat

# Locate a contiguous brick face in the unfurled native atlas. Its long axis runs
# radially along each voussoir. Never stretch a second mortar seam over a brick.
func choose_brick(centre: Vector2,axis: Vector2) -> void:
	along = axis
	crop_center = centre
	for attempt in 100:
		var px := rng.randi_range(42,2005)
		var row := rng.randi_range(1,38)
		var py := roundi((row+.5)*25.6)
		var usable := true
		for dy in [-6,0,6]:
			for dx in [-22,-12,0,12,22]:
				if height.get_pixel(px+dx,py+dy).r < .79: usable=false
		if usable or attempt==99:
			cell = Vector2i(px,py)
			crop = Vector2i(50,15)
			return

func tri(a: Vector3,b: Vector3,c: Vector3,normal: Vector3) -> void:
	if (b-a).cross(c-a).length_squared() < 1e-15:
		return
	var tool: SurfaceTool = tools[key]
	var points := [a,c,b] if (b-a).cross(c-a).dot(normal)>0 else [a,b,c]
	for p: Vector3 in points:
		# Damp rises from the channel through the lower courses. A narrow seep on the
		# left carries lime; the upper crown picks up the existing room's soot.
		var wet := clampf(.21-p.y*.39,0,.91)
		var seep := exp(-pow((p.x+.62)*6.2,2))
		var grime := clampf(-p.y*.36+.14,0,.64)
		var lime := .23+seep*.28+.12*cos(p.x*19.+p.y*7.)
		tool.set_color(Color(wet,lime if key=="voussoir" else .38,grime,.04*wet))
		tool.set_normal(normal)
		var delta := Vector2(p.x,p.y)-crop_center
		var grain_uv := Vector2(cell) + Vector2(delta.dot(along)/.22*crop.x,delta.dot(along.orthogonal())/.07*crop.y)
		tool.set_uv(grain_uv/Vector2(2048,1024))
		tool.add_vertex(p)

func face(outline: PackedVector2Array, z: float) -> void:
	var idx := Geometry2D.triangulate_polygon(outline)
	for i in range(0,idx.size(),3):
		tri(Vector3(outline[idx[i]].x,outline[idx[i]].y,z),Vector3(outline[idx[i+1]].x,outline[idx[i+1]].y,z),Vector3(outline[idx[i+2]].x,outline[idx[i+2]].y,z),Vector3.BACK)

func material(label: String) -> void:
	key = label
	if not tools.has(key):
		var tool := SurfaceTool.new()
		tool.begin(Mesh.PRIMITIVE_TRIANGLES)
		tool.set_material(finishes[key])
		tools[key] = tool

func rect(x0: float,y0: float,x1: float,y1: float) -> PackedVector2Array:
	return PackedVector2Array([Vector2(x0,y0),Vector2(x1,y0),Vector2(x1,y1),Vector2(x0,y1)])

func brick(outline: PackedVector2Array,label: String,z: float) -> void:
	if outline.size()<3: return
	if Geometry2D.is_polygon_clockwise(outline):
		outline.reverse()
	var inner := PackedVector2Array()
	var bevel := rng.randf_range(.0023,.0039)
	for i in outline.size():
		var p := outline[i]
		var incoming := (p-outline[posmod(i-1,outline.size())]).normalized()
		var outgoing := (outline[(i+1)%outline.size()]-p).normalized()
		var n := Vector2(-incoming.y,incoming.x)
		var bisector := (n+Vector2(-outgoing.y,outgoing.x)).normalized()
		inner.append(p+bisector*minf(bevel/maxf(.18,bisector.dot(n)),.009))
	material(label)
	face(inner,z)
	for i in outline.size():
		var j := (i+1)%outline.size()
		var p := Vector3(outline[i].x,outline[i].y,z-bevel)
		var q := Vector3(outline[j].x,outline[j].y,z-bevel)
		var u := Vector3(inner[i].x,inner[i].y,z)
		var v := Vector3(inner[j].x,inner[j].y,z)
		var wall := Vector3(q.y-p.y,p.x-q.x,0).normalized()
		var chamfer := (wall+Vector3.BACK).normalized()
		tri(p,q,v,chamfer)
		tri(p,v,u,chamfer)
		var base_p := Vector3(p.x,p.y,-.003)
		var base_q := Vector3(q.x,q.y,-.003)
		tri(base_p,base_q,q,wall)
		tri(base_p,q,p,wall)

func piece(x0: float,y0: float,x1: float,y1: float) -> PackedVector2Array:
	var nick := rng.randf_range(.002,.007)
	return PackedVector2Array([Vector2(x0+nick,y0),Vector2(x1-.003,y0),Vector2(x1,y0+.003),Vector2(x1,y1-nick),Vector2(x1-nick,y1),Vector2(x0+.004,y1),Vector2(x0,y1-.004),Vector2(x0,y0+nick)])

func finish(label: String, origin: Vector3) -> void:
	var asset := MeshInstance3D.new()
	asset.name = label
	var mesh := ArrayMesh.new()
	for name in tools:
		var tool: SurfaceTool = tools[name]
		tool.index()
		tool.commit(mesh)
		mesh.surface_set_name(mesh.get_surface_count()-1,name)
	asset.mesh = mesh
	asset.layers = 1 << 13
	asset.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	asset.visibility_range_end = 42
	asset.transform = Transform3D(Basis(Vector3.BACK,Vector3.UP,Vector3.LEFT),origin)
	model_root.add_child(asset)
	asset.owner = model_root
	tools.clear()

# Strength across staggered, locally re-pointed courses. A scattering of reclaimed
# red bricks survives inside the repair and old lime trails out along its left edge.
# The joints, face UVs, geometry and baked wear are those of the installed wall.
func repoint(p: Vector3,uv: Vector2) -> float:
	var x := p.z-FACE.z
	var course := floori((p.y+3.015)/.060)
	var spans := [
		Vector2(-.74,-.40),Vector2(-.92,-.31),Vector2(-.80,-.18),Vector2(-.83,.10),
		Vector2(-.94,.15),Vector2(-.76,.20),Vector2(-.58,.51),Vector2(-.66,.38),
		Vector2(-.44,.62),Vector2(-.58,.43),Vector2(-.29,.79),Vector2(-.12,.58),
		Vector2(.02,.43),Vector2(.04,.28)
	]
	if course < 0 or course >= spans.size(): return 0.
	var span: Vector2 = spans[course]
	var edge := minf(x-span.x,span.y-x)
	var clay := floori(uv.x*24.+(.5 if course%2 else 0.))
	var tooth := posmod(clay*29+course*73,17)
	var repaired := .81
	if tooth==2 or tooth==7: repaired=.34
	if tooth==11: repaired=.11
	return smoothstep(-.10,.14,edge)*repaired

func repair() -> void:
	material("renewed_lime")
	var tool: SurfaceTool = tools[key]
	tool.set_custom_format(0,SurfaceTool.CUSTOM_RGBA8_UNORM)
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(RIJN+"area.json"))
	for part in manifest.keys.room.lod0:
		var original: ArrayMesh = load(RIJN+part.file)
		for surface in original.get_surface_count():
			if original.surface_get_name(surface)!="ruien_brick_stretcher": continue
			var a := original.surface_get_arrays(surface)
			var vertices: PackedVector3Array=a[Mesh.ARRAY_VERTEX]
			var indices: PackedInt32Array=a[Mesh.ARRAY_INDEX]
			var normals: PackedVector3Array=a[Mesh.ARRAY_NORMAL]
			var uv: PackedVector2Array=a[Mesh.ARRAY_TEX_UV]
			var colours: PackedColorArray=a[Mesh.ARRAY_COLOR]
			var baked: PackedByteArray=a[Mesh.ARRAY_CUSTOM0]
			for i in range(0,indices.size(),3):
				var v := vertices[indices[i]]
				if absf(v.x-FACE.x)>.012 or absf(v.z-FACE.z)>1.09 or absf(v.y-FACE.y)>.53: continue
				var weights := PackedFloat32Array()
				var wall := true
				for k in 3:
					var idx := indices[i+k]
					var p := vertices[idx]
					if absf(p.x-FACE.x)>.012 or normals[idx].x>-.65: wall=false
					weights.append(repoint(p,uv[idx]))
				if not wall or maxf(weights[0],maxf(weights[1],weights[2]))<.009: continue
				for k in 3:
					var idx := indices[i+k]
					var n := normals[idx]
					var w := weights[k]
					var wx := colours[idx]
					wx.g=lerpf(wx.g,.70,w)
					wx.r=lerpf(wx.r,.15,w)
					var c := Color(baked[idx*4]/255.,baked[idx*4+1]/255.,baked[idx*4+2]/255.,baked[idx*4+3]/255.)
					var luma := c.r*c.r*.26+c.g*c.g*.63+c.b*c.b*.11
					# Old sandy lime keeps the actual brick's pore variation under its crust.
					c.r=lerpf(c.r,sqrt(luma*1.60+.088),w)
					c.g=lerpf(c.g,sqrt(luma*1.37+.069),w)
					c.b=lerpf(c.b,sqrt(luma*1.04+.045),w)
					var local := vertices[idx]-FACE
					tool.set_normal(Vector3(n.z,n.y,-n.x))
					tool.set_uv(uv[idx])
					tool.set_color(wx)
					tool.set_custom(0,c)
					tool.add_vertex(Vector3(local.z,local.y,-local.x+.0055))
	finish("RijnkaaiRepair",FACE)

# The far mesh is a separately simplified surface. Check the actual separation at
# every repair vertex and face centre against both meshes, including the LOD change.
func repair_clearance() -> bool:
	var repair_mesh: MeshInstance3D = model_root.get_node("RijnkaaiRepair")
	var arrays := repair_mesh.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var samples := PackedVector3Array()
	for v in verts: samples.append(repair_mesh.transform*v)
	for i in range(0,indices.size(),3):
		samples.append(repair_mesh.transform*((verts[indices[i]]+verts[indices[i+1]]+verts[indices[i+2]])/3.))
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(RIJN+"area.json"))
	for lod in ["lod0","lod1"]:
		var faces := PackedVector3Array()
		for part in manifest.keys.room[lod]:
			var host: ArrayMesh = load(RIJN+part.file)
			for s in host.get_surface_count():
				if host.surface_get_name(s)!="ruien_brick_stretcher": continue
				var a := host.surface_get_arrays(s)
				var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
				var ix: PackedInt32Array = a[Mesh.ARRAY_INDEX]
				for i in range(0,ix.size(),3):
					var d := v[ix[i]]-FACE
					if absf(d.x)>.08 or absf(d.y)>.75 or absf(d.z)>1.50: continue
					for k in 3: faces.append(v[ix[i+k]])
		var wall := TriangleMesh.new()
		wall.create_from_faces(faces)
		var separation := 1.
		for p in samples:
			var hit := wall.intersect_segment(p+Vector3.LEFT*.1,p+Vector3.RIGHT*.1)
			if hit.is_empty(): return false
			separation=minf(separation,hit.position.x-p.x)
		print("Rijnkaai ",lod,": ",samples.size()," surveyed points; minimum lime thickness ",separation*1000.," mm")
		if separation<.0015: return false
	return true

func seal() -> void:
	# Retain the actual original wall as the blocking and leave the barred opening
	# in it uncovered. Only the old radial arch and its bonded side piers are dressed.
	# The pier courses run down into the damp next to the drain, without a base seam.
	const COUNT = 53
	const FOOT = -1.50
	for i in COUNT:
		var a0 := PI*i/COUNT
		var a1 := PI*(i+1)/COUNT
		var axis := Vector2.from_angle((a0+a1)*.5)
		choose_brick(axis*((INNER+OUTER)*.5),axis)
		var outer := OUTER+rng.randf_range(-.004,.001)
		var bed := PackedVector2Array([Vector2.from_angle(a0)*INNER,Vector2.from_angle(a0)*outer,Vector2.from_angle(a1)*outer,Vector2.from_angle(a1)*INNER])
		material("bedding")
		face(bed,.0036)
		var left := a0+.0024
		var right := a1-.0024
		var band := PackedVector2Array([Vector2.from_angle(left)*INNER,Vector2.from_angle(left)*outer,Vector2.from_angle(right)*outer,Vector2.from_angle(right)*INNER])
		brick(band,"voussoir",rng.randf_range(.010,.018))
	for side in [-1,1]:
		var x0 := minf(INNER*side,OUTER*side)
		var x1 := maxf(INNER*side,OUTER*side)
		for i in 25:
			var y := FOOT+i*.06
			choose_brick(Vector2((x0+x1)*.5,y+.03),Vector2.RIGHT)
			material("bedding")
			face(rect(x0,y,x1,y+.06),.0036)
			brick(piece(x0+.002,y+.003,x1-.002,y+.057),"voussoir",rng.randf_range(.008,.015))
	finish("HanseaticBlindArch",SPRING)

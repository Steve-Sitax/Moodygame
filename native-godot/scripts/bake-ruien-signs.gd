extends SceneTree
## Authoring: suggest wall fits, then publish only candidates verified against the assembled town.
## Shallow pressed rims are eased 2 mm; backs bed into brick. Lettering and screw heads have no collision.
const DIR = "res://world/ruien/"
const OUT = "res://assets/models/ruien-wayfinding/"
const FONT = "res://fonts/old-standard-tt-latin-700-normal.woff2"
var scene = Node3D.new()
var signs = []
var plates = {}
var streets = {}
var openings = {} # Grid of opening footprints, including their dressed jambs.
var font: Font
var candidates = []
var destination: String

func coords(v: Vector3):
	return [v.x, v.y, v.z]

func vector(v):
	return Vector3(v[0], v[1], v[2])

func pose(t: Transform3D):
	return [coords(t.basis.x), coords(t.basis.y), coords(t.basis.z), coords(t.origin)]

func transform_from(row):
	return Transform3D(Basis(vector(row[0]), vector(row[1]), vector(row[2])), vector(row[3]))

func read(path):
	return JSON.parse_string(FileAccess.get_file_as_string(path))

func typeset(s, height):
	var mesh = TextMesh.new()
	mesh.font = font
	mesh.font_size = 72
	mesh.pixel_size = height / 72.0
	mesh.depth = 0.0
	mesh.curve_step = 0.8
	mesh.text = s
	return mesh

func plate(street):
	if plates.has(street): return plates[street]
	var title = typeset(street, .079)
	var header = typeset("B O V E N", .035)
	var hw = maxf(.27, title.get_aabb().size.x / 2 + .046)
	var hh = .098
	var mesh = ArrayMesh.new()
	var enamel = SurfaceTool.new()
	enamel.begin(Mesh.PRIMITIVE_TRIANGLES)
	# Rounded corners with a rolled edge, on a back flange let into the mortar.
	var rings = []
	for profile in [[-.006,-.041], [0.,.001], [-.002,.003]]:
		var ring = PackedVector3Array()
		for k in 4:
			var a = k*PI/2
			var cx = (hw-.016)*signf(cos(a+PI/4))
			var cy = (hh-.016)*signf(sin(a+PI/4))
			for j in 5:
				var ang = a+j*PI/8
				var r = .016+profile[0]
				ring.append(Vector3(cx+r*cos(ang),cy+r*sin(ang),profile[1]))
		rings.append(ring)
	for i in rings[0].size():
		var j = (i+1)%rings[0].size()
		for k in 2:
			for p in [rings[k][i],rings[k+1][i],rings[k+1][j],rings[k][i],rings[k+1][j],rings[k][j]]:
				enamel.add_vertex(p)
		for p in [Vector3(0,0,.003),rings[2][j],rings[2][i]]:
			enamel.add_vertex(p)
	enamel.generate_normals()
	enamel.commit(mesh)
	var letters = SurfaceTool.new()
	letters.begin(Mesh.PRIMITIVE_TRIANGLES)
	for item in [[title,-.023],[header,.048]]:
		var box = item[0].get_aabb()
		letters.append_from(item[0],0,Transform3D(Basis.IDENTITY, Vector3(0,item[1],.005)-box.get_center()))
	for x in [-hw+.016,hw-.016]:
		var screw = SphereMesh.new()
		screw.radius = .006
		screw.height = .009
		screw.radial_segments = 8
		screw.rings = 3
		letters.append_from(screw,0,Transform3D(Basis(Vector3.RIGHT,PI/2),Vector3(x,0,.004)))
	letters.commit(mesh)
	# The masonry shader reads blue as soot. A missing vertex-colour array means
	# solid white in Godot, which would blacken even the ivory letters.
	var finished = ArrayMesh.new()
	for i in mesh.get_surface_count():
		var arrays = mesh.surface_get_arrays(i)
		var weather = PackedColorArray()
		for p in arrays[Mesh.ARRAY_VERTEX]:
			weather.append(Color(0,0,.035+.065*smoothstep(.01,.10,absf(p.y)),0))
		arrays[Mesh.ARRAY_COLOR]=weather
		finished.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	plates[street]=finished
	return finished

func street_at(p):
	var nearest = ""
	var best = 36.0
	var cell = Vector2i((p/8).floor())
	for x in range(-1,2):
		for y in range(-1,2):
			for sample in streets.get(cell+Vector2i(x,y),[]):
				var d = p.distance_squared_to(sample[0])
				if d < best:
					best=d
					nearest=sample[1]
	return nearest

func plan(p: Array) -> Vector2:
	return Vector2(p[0], p[-1])

func reserve_opening(a: Vector2, b: Vector2, radius: float, bottom: float, top: float):
	var lo = Vector2i(((a.min(b) - Vector2.ONE * radius) / 8).floor())
	var hi = Vector2i(((a.max(b) + Vector2.ONE * radius) / 8).floor())
	# Keep the masonry directly above an opening clear to the gallery crown.
	# A gallery on a separate level can still use its own wall.
	var record = [a, b, radius, bottom, maxf(top + .35, -.65)]
	for x in range(lo.x, hi.x + 1):
		for z in range(lo.y, hi.y + 1):
			var cell = Vector2i(x, z)
			if not openings.has(cell): openings[cell] = []
			openings[cell].append(record)

func clear_of_openings(at: Vector3, half_width: float) -> bool:
	# The whole tilted plate plus a clear strip of mortar outside its rim.
	var reach = half_width + .25
	var point = Vector2(at.x, at.z)
	var lo = Vector2i(((point - Vector2.ONE * reach) / 8).floor())
	var hi = Vector2i(((point + Vector2.ONE * reach) / 8).floor())
	for x in range(lo.x, hi.x + 1):
		for z in range(lo.y, hi.y + 1):
			for o in openings.get(Vector2i(x, z), []):
				if at.y + .12 < o[3] or at.y - .12 > o[4]: continue
				var nearest: Vector2 = o[0]
				if nearest != o[1]:
					nearest = Geometry2D.get_closest_point_to_segment(point, o[0], o[1])
				if nearest.distance_to(point) <= o[2] + reach: return false
	return true

func reserve_stair(door: Dictionary, defaults: Dictionary):
	# World-plan equivalent of RuienEntrance.Frames and LinkFrame.
	var spec = defaults.duplicate()
	spec.merge(door, true)
	var outward = plan(spec.out).normalized()
	var right = Vector2(outward.y, -outward.x)
	var run = -outward
	var start = plan(spec.door) - outward * spec.wall
	if spec.layout == "L":
		run = -right if spec.flight == "left" else right
		start -= run * spec.topLanding * .5 + outward * spec.width * .5
	var street = float(spec.get("street", 0.0))
	var floor_y = float(spec.depth)
	var flight = (street - floor_y) / tan(deg_to_rad(spec.pitchDeg))
	var head = start + run * spec.topLanding
	var foot = head + run * flight
	var end = foot + run * spec.bottomLanding
	var half = float(spec.width) * .5 + spec.lining
	var height = float(spec.spring) + spec.vaultRise
	reserve_opening(start, head, half, street - .25, street + height)
	reserve_opening(head, foot, half, floor_y - .25, street + height)
	reserve_opening(foot, end, half, floor_y - .25, floor_y + height)
	var path = spec.get("connectPath", [])
	if path.size() > 1:
		for i in range(1, path.size()):
			reserve_opening(plan(path[i-1]), plan(path[i]), .86,
				minf(path[i-1][1], path[i][1]) - .25, maxf(path[i-1][1], path[i][1]) + 2.2)
	elif spec.get("connectLength", 0.0) > 0:
		var axis = run
		var mouth = end
		if spec.closureSide != "end":
			axis = Vector2(-run.y, run.x)
			# In layout I the run's +v is local +X, exactly transverse
			# to the street. RuienEntrance uses that side as its street side.
			var street_sign = 1.0 if spec.layout == "I" or axis.dot(outward) > 0 else -1.0
			match spec.closureSide:
				"street": axis *= street_sign
				"back": axis *= -street_sign
				"left": axis = -axis if axis.dot(right) > 0 else axis
				"right": axis = -axis if axis.dot(right) < 0 else axis
			mouth = foot + run * spec.bottomLanding * .5 + axis * spec.width * .5
		var reach = spec.connectLength + spec.get("connectHead", 0.0) + .06
		reserve_opening(mouth, mouth + axis * reach, .86, floor_y - .25, floor_y + 2.2)
	if spec.has("underpass"):
		var crossing = spec.underpass
		reserve_opening(plan(crossing.from), plan(crossing.to), crossing.width * .5,
			crossing.bed, crossing.from[1] + 2.2)

func reserve_gallery_openings(area: Dictionary, classes: Dictionary, drainage: Dictionary):
	# A surveyed gallery end meets a passage, chamber or headwall. Keep the
	# entire width and both jambs clear, including the short chamber throats.
	for zone in area.zones:
		var path = zone.get("path", [])
		if path.size() < 2: continue
		var section = classes[zone.cls]
		var half = float(zone.get("width", section.innerWidth)) * .5
		for i in [0, -1]:
			var centre = plan(path[i])
			var along = (centre - plan(path[1 if i == 0 else -2])).normalized()
			var across = Vector2(along.y, -along.x) * half
			reserve_opening(centre - across, centre + across, zone.wall, section.bed, section.crown)
	for seam in area.get("seamProfiles", []):
		if not seam.get("portal", false): continue
		var centre = plan(seam.at)
		var axis = plan(seam.direction).normalized()
		var across = Vector2(axis.y, -axis.x) * 1.8 # RuienSeams' 3.6 m portal.
		reserve_opening(centre - across, centre + across,
			maxf(seam.get("plateauBefore", 0.0), seam.get("plateauAfter", 0.0)) + .3, -6.4, -.9)
	for key in ["collisionMouths", "channelEnds", "retiredChannelEnds"]:
		for mouth in area.get(key, []):
			var axis = plan(mouth.axis).normalized()
			var across = Vector2(axis.y, -axis.x) * float(mouth.half)
			var centre = plan(mouth.at)
			reserve_opening(centre - across, centre + across, .65, mouth.get("bottom", -6.4), mouth.get("top", -.55))
	for gate in area.get("gates", []):
		var centre = plan(gate.origin)
		var axis = plan(gate.normal).normalized()
		var across = Vector2(axis.y, -axis.x)
		var bounds = Rect2(plan(gate.opening[0]), Vector2.ZERO)
		for p in gate.opening: bounds = bounds.expand(plan(p))
		centre -= axis * gate.depth * .5
		reserve_opening(centre + across * bounds.position.x, centre + across * bounds.end.x,
			gate.depth * .5 + .5, bounds.position.y, bounds.end.y)
	var markers = read(area.export + "/markers.json")
	var bridges = {}
	for bridge in area.get("bridges", []) + markers.get("bridges", []):
		if bridges.has(bridge.id): continue # Area edits override exported pivots.
		bridges[bridge.id] = true
		var a = plan(bridge.a)
		var b = plan(bridge.b)
		var axis = (b-a).normalized()
		reserve_opening(a-axis*1.15, b+axis*1.15, .55, bridge.a[1] - .1, bridge.a[1] + 2.2)
	for cut in area.get("bridgeRailCuts", []):
		reserve_opening(plan(cut.from), plan(cut.to), cut.width * .5, cut.from[1] - .12, cut.from[1] + 1.35)
	for access in markers.get("stairs", []) + markers.get("ladders", []):
		var width = access.get("grate", [.85,.85])[0]
		if access.has("hatch"): width = access.hatch[1] - access.hatch[0]
		reserve_opening(plan(access.bottom), plan(access.top), maxf(.55, width*.5),
			access.bottom[1] - .15, access.top[1] + .25)
	for grate in area.get("grates", []):
		var centre = plan(grate.at)
		var collar = grate.get("collar", {})
		reserve_opening(centre, centre, float(collar.get("outer", grate.get("size", .66)))*.5,
			collar.get("rim", -.92) - .2, grate.at[1] + .1)
	for stair in area.get("keeperStairs", []):
		var foot = plan(stair.bottom)
		var half = float(stair.hole[2])*.5
		reserve_opening(foot, plan(stair.top), half, stair.bottom[1] - .25, stair.top[1] + .2)
		for point in stair.get("landingPath", []):
			reserve_opening(foot, plan(point), half, stair.bottom[1] - .25, stair.bottom[1] + 2.2)
			foot = plan(point)
	for rungs in area.get("rungs", []):
		reserve_opening(plan(rungs.wall), plan(rungs.ledge), .35, rungs.bottom, rungs.top + 1.5)
	# The retained Vlietrui holes predate the network drain-kit heads.
	for drain in area.get("drains", []) + area.get("sealedDrains", []):
		var host = drainage.hosts[area.id + "/" + drain.zone]
		var remain = float(drain.u)
		for i in range(1, host.path.size()):
			var a = plan(host.path[i-1])
			var b = plan(host.path[i])
			var length = a.distance_to(b)
			if remain <= length:
				var tangent = (b-a).normalized()
				var section = classes[host.cls]
				var wall = a + tangent*remain + Vector2(tangent.y,-tangent.x)*drain.side*section.innerWidth*.5
				reserve_opening(wall, wall, 1.25, section.bed, section.crown)
				break
			remain -= length


func mount(zone, path, distance, section, walls, street_name):
	var p3 = path.sample_baked(distance)
	var d = (path.sample_baked(distance+.5)-path.sample_baked(distance-.5)).normalized()
	var side = int(zone.get("walkwaySide",section.walkwaySide))
	if side == 0: side=1
	var across = Vector3(d.z,0,-d.x)*side
	var inward = -across
	var right = Vector3.UP.cross(inward)
	var width = float(zone.get("width",section.innerWidth))
	var y = float(zone.get("walk",section.bed+section.ledgeAboveBed))+1.23
	var origin = Vector3(p3.x,y,p3.z)
	var wall_xz = origin+across*width*.5
	var street = street_at(Vector2(wall_xz.x,wall_xz.z))
	if street != street_name: return false
	var model = plate(street)
	var ext = model.get_aabb().size.x*.5
	# These openings are cut into the imported walls when the game assembles the town.
	# Leave the arched headers, jambs and the whole plaque clear of one another.
	if not clear_of_openings(wall_xz, ext): return false
	# Above the spring line the vault leans over the ledge. Fit the local plane first,
	# then check the entire footprint for a proud rib, pipe or broken joint.
	var bearings = []
	for offset in [-right*ext,right*ext,Vector3.DOWN*.10,Vector3.UP*.10]:
		var hit = walls.intersect_segment(origin+offset,origin+offset+across*(width*.5+.32))
		if hit.is_empty(): return false
		bearings.append(hit.position)
	var normal = (bearings[1]-bearings[0]).cross(bearings[3]-bearings[2]).normalized()
	if normal.dot(inward)<.76: return false
	right=Vector3.UP.cross(normal).normalized()
	var up=normal.cross(right)
	var seat = (bearings[0]+bearings[1]+bearings[2]+bearings[3])*.25
	if absf((seat-origin).dot(across)-width*.5)>.45: return false
	var near = INF
	var far = -INF
	for x in [-ext,0.,ext]:
		for h in [-.10,0.,.10]:
			var point = seat+right*x+up*h
			var hit = walls.intersect_segment(point+normal*.16,point-normal*.16)
			if hit.is_empty() or absf(hit.normal.dot(normal)) < .86: return false
			var span = (point-hit.position).dot(normal)
			near=minf(near,span)
			far=maxf(far,span)
	if far-near > .030: return false
	var at = seat+normal*(.006-near)
	if not clear_of_openings(at, ext): return false
	return Transform3D(Basis(right,up,normal),at)

func add_selected(row):
	var mount_at = transform_from(row.pose)
	var node = MeshInstance3D.new()
	node.name = row.id
	node.mesh = plate(row.street)
	node.transform = mount_at
	node.layers=1<<13
	node.visibility_range_end=26
	node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scene.add_child(node)
	node.owner=scene
	signs.append({"id":row.id,"area":row.area,"street":row.street,"route":row.route,
		"at":coords(mount_at.origin),"face":[mount_at.basis.z.x,mount_at.basis.z.z]})

func _initialize():
	font=load(FONT)
	var args = OS.get_cmdline_user_args()
	if args.size() != 2 or args[0] not in ["--candidates","--publish"]:
		push_error("Use -- --candidates <working directory> or -- --publish <working directory> after the native wall check.")
		quit(1)
		return
	destination = args[1].replace("\\","/")
	if args[0] == "--publish":
		publish()
		return
	var network = read(DIR+"network.json")
	var names = {"vlietrui":"Vlietrui"}
	for line in network.lines: names[line.id]=line.name
	var drainage = read(DIR+"drainage-network.json")
	for head in drainage.heads:
		var host = drainage.hosts[head.host]
		var half = host.get("width",network.classes[head.cls].innerWidth)*.5
		var wall = Vector2(head.at[0],head.at[1])+Vector2(head.normal[0],head.normal[1])*half
		reserve_opening(wall, wall, 1.25, head.invert - .35, head.invert + 2.0)
	var entrances = read(DIR+"entrances.json")
	for door in entrances.entrances:
		if door.get("enabled", true): reserve_stair(door, entrances.defaults)
	for street in read("res://world/town/facades/streets.json").streets:
		# Survey chains may jump between branches. Use only surveyed points.
		for coords in street.line:
			var p = Vector2(coords[0],coords[1])
			var key = Vector2i((p/8).floor())
			if not streets.has(key): streets[key]=[]
			streets[key].append([p,street.name])
	var areas = read(DIR+"areas.json").areas
	for area in areas:
		reserve_gallery_openings(area, network.classes, drainage)
	var installed = load(OUT+"street-plaques.scn").instantiate()
	var survey = read(OUT+"street-plaques.json")
	var by_zone = {}
	var spans = {}
	for area in areas:
		for zone in area.zones:
			if zone.has("path"):
				if not spans.has(zone.id): spans[zone.id] = []
				spans[zone.id].append([area.id, zone.path])
	for i in installed.get_child_count():
		var sign_node = installed.get_child(i)
		var id = str(sign_node.name)
		var zone_id = id.rsplit("_", true, 1)[0]
		var owner_area = survey[i].get("area", "")
		if owner_area.is_empty():
			# The original survey predates recorded hosts. Three line names span two separate exports.
			var here = Vector2(sign_node.position.x, sign_node.position.z)
			var best = INF
			for span in spans[zone_id]:
				for j in range(1,span[1].size()):
					var a = plan(span[1][j-1])
					var b = plan(span[1][j])
					var point = a if a==b else Geometry2D.get_closest_point_to_segment(here,a,b)
					var gap = here.distance_squared_to(point)
					if gap<best:
						best = gap
						owner_area = span[0]
		var key = owner_area + "/" + zone_id
		if not by_zone.has(key): by_zone[key] = []
		by_zone[key].append([sign_node, survey[i]])
	for area in areas:
		for zone in area.zones:
			if not names.has(zone.id) or not zone.has("path"): continue
			var key = area.id + "/" + zone.id
			if not by_zone.has(key): continue
			var path = Curve3D.new()
			for pair in zone.path: path.add_point(Vector3(pair[0],0,pair[1]))
			var length = path.get_baked_length()
			if length<3: continue
			var shape = load(area.export+"/collision.res") as ConcavePolygonShape3D
			var walls = TriangleMesh.new()
			walls.create_from_faces(shape.get_faces())
			for entry in by_zone[key]:
				var n: MeshInstance3D = entry[0]
				var old = entry[1]
				var start = path.get_closest_offset(Vector3(n.position.x,0,n.position.z))
				var alternatives = []
				for step in range(0,25):
					for direction in ([1] if step==0 else [1,-1]):
						var u = start + direction*step*.5
						if u<1.3 or u>length-1.3: continue
						var fit = mount(zone,path,u,network.classes[zone.cls],walls,old.street)
						if fit is Transform3D: alternatives.append(pose(fit))
				candidates.append({"id":str(n.name),"area":area.id,"street":old.street,"route":old.route,
					"original":pose(n.transform),"openingClear":clear_of_openings(n.position,n.mesh.get_aabb().size.x*.5),"alternatives":alternatives})
	if candidates.size() != installed.get_child_count():
		installed.free()
		scene.free()
		push_error("A plaque is missing its authored gallery")
		quit(1)
		return
	installed.free()
	DirAccess.make_dir_recursive_absolute(destination)
	var manifest = FileAccess.open(destination.path_join("candidates.json"),FileAccess.WRITE)
	manifest.store_string(JSON.stringify(candidates,"",true,true))
	print("Surveyed ",candidates.size()," plaque sites")
	scene.free()
	quit()

func publish():
	var checked = read(destination.path_join("accepted.json"))
	if not checked is Dictionary or not checked.has("signs") or checked.signs.is_empty() or checked.manifest != FileAccess.get_sha256(destination.path_join("candidates.json")):
		push_error("Missing or stale native wall check")
		quit(1)
		return
	for row in checked.signs: add_selected(row)
	var packed = PackedScene.new()
	var err = packed.pack(scene)
	if err == OK: err=ResourceSaver.save(packed,destination.path_join("street-plaques.scn"),ResourceSaver.FLAG_COMPRESS)
	if err != OK:
		quit(1)
		return
	var file = FileAccess.open(destination.path_join("street-plaques.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(signs,"",true,true)+"\n")
	print("Mounted ",signs.size()," plaques with ",plates.size()," street designs")
	scene.free()
	quit()

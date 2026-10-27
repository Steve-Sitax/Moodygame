extends SceneTree
## The churches' candle crowns (Steve, 2026-10-27), built and put in place.
##   godot --path native-godot --script <this> -- --preview <out dir> --textures <png dir>
##       (windowed) the three crowns on their own under a plain light, photographed from below, the side and above.
##   godot --headless --path native-godot --script <this> -- --install --textures <png dir> --record <dir> [--dry] [--textures-only]
##       textures, materials, the three crown models and their hoists; every old crown in St James's, St Paul's,
##       St Charles's and the cathedral taken out of its room piece and the new one hung where it hung.
##   godot --headless --path native-godot --script <this> -- --rebuild --textures <png dir>
##       (second pass, 2026-10-27) textures, materials, both variants of each crown model and scene, and every hoist
##       already in use, rebuilt in place; vary-crowns.py then gives each hung crown its variant and turn.
##   godot --headless --path native-godot --script <this> -- --cut-glows
##       (second pass) the old crowns' flat flame glows taken out of the room pieces (ChurchLight.cs draws the flames)
## make_textures.py writes the pictures; crown_mesh.gd builds the faces.

const Crown := preload("crown_mesh.gd")
const MAT_DIR := "res://assets/materials/candle-crowns-20261027"
const PROP_DIR := "res://assets/props/candle-crowns"
const SHADER := "res://world/town/resources/r000557.res"
const ROOMS := ["stjacob", "stpaul", "carolus", "cathedral"]
## The old crowns' materials: brass rings and bosses, white candles, dark chains (r005840/r005929/r005834: the cathedral's).
const OLD := ["res://world/town/resources/r006187.res", "res://world/town/resources/r006578.res", "res://world/town/resources/r006153.res",
	"res://world/town/resources/r005840.res", "res://world/town/resources/r005929.res", "res://world/town/resources/r005834.res"]
const CHAIN_OLD := ["res://world/town/resources/r006153.res", "res://world/town/resources/r005834.res"]
## Where each crown kind's body ends at the top: the suspension ring's eye (large) or the stem's top eye.
const HANG := {"large": 1.80, "small": 0.995, "tiered": 1.595}

var args := {}

func _initialize() -> void:
	var a := OS.get_cmdline_user_args()
	var i := 0
	while i < a.size():
		if a[i].begins_with("--"):
			var v := a[i + 1] if i + 1 < a.size() and not a[i + 1].begins_with("--") else "1"
			args[a[i].substr(2)] = v
			if v != "1": i += 1
		i += 1
	call_deferred("run")

func run() -> void:
	if args.has("preview"): await preview(args["preview"])
	elif args.has("install"): install()
	elif args.has("rebuild"): rebuild()
	elif args.has("cut-glows"): cut_glows()
	quit()

## ---- models --------------------------------------------------------------------------------------------------------

## The model's variants: a second burn-down of the same crown (its own candle heights, runs and pools), so neighbouring
## crowns differ (Codex 2026-10-27); variant 0 keeps the first pass's seed.
const VARIANTS := 2

func body(kind: String, mats: Array, variant := 0) -> Dictionary:
	var c := Crown.new(1873 + ["large", "small", "tiered"].find(kind) + 100 * variant)
	match kind:
		"large": c.large_body(HANG.large)
		"small": c.small(-1.0)
		"tiered": c.tiered(-1.0)
	return {"mesh": c.mesh(mats), "flames": c.flames, "tris": c.triangles()}

func hoist(kind: String, length: float, mats: Array) -> Dictionary:
	var c := Crown.new(7)
	c.hoist(HANG[kind], HANG[kind] + length, kind == "large")
	return {"mesh": c.mesh(mats), "tris": c.triangles()}

func load_png(path: String, mips := true) -> ImageTexture:
	var img := Image.load_from_file(path)
	if img.get_format() != Image.FORMAT_RGBA8 and img.get_format() != Image.FORMAT_L8: img.convert(Image.FORMAT_RGBA8)
	if mips: img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

## ---- preview -------------------------------------------------------------------------------------------------------

func preview(out: String) -> void:
	DirAccess.make_dir_recursive_absolute(out)
	var tex: String = args.get("textures", "")
	var mats := []
	for spec in [["brass", Color(1, 1, 1)], ["wax", Color(1, 1, 1)], ["iron", Color(0.85, 0.83, 0.8)]]:
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.albedo_color = spec[1]
		if spec[0] == "iron":
			m.albedo_texture = load("res://assets/materials/environment-20261013/iron-texture.res")
		else:
			m.albedo_texture = load_png(tex + "/" + spec[0] + ".png")
		m.roughness = 0.55 if spec[0] == "brass" else 0.8
		m.metallic = 0.6 if spec[0] == "brass" else 0.0
		mats.append(m)
	var world := Node3D.new()
	root.add_child(world)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.35, 0.33, 0.3)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.5, 0.48, 0.45)
	env.environment.ambient_light_energy = 0.6
	world.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	sun.light_energy = 1.2
	world.add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 50
	world.add_child(cam)
	var report := {}
	for kind in ["large", "small", "tiered"]:
		var b := body(kind, mats)
		var h := hoist(kind, 1.2, mats)
		var mi := MeshInstance3D.new(); mi.mesh = b.mesh; world.add_child(mi)
		var hi := MeshInstance3D.new(); hi.mesh = h.mesh; world.add_child(hi)
		report[kind] = {"body": b.tris, "hoist_1_2m": h.tris}
		var R: float = {"large": 1.2, "small": 0.8, "tiered": 1.05}[kind]
		var views := {"below": Vector3(R * 0.9, -R * 1.2, R * 0.8), "side": Vector3(R * 1.9, 0.25, R * 0.5), "above": Vector3(R * 1.2, R * 1.5, R * 0.9), "close": Vector3(R + 0.35, 0.45, 0.35), "under": Vector3(R + 0.25, -0.25, 0.3)}
		for v in views:
			var target := Vector3(0, 0.3, 0) if v != "close" and v != "under" else Vector3(R, 0.35, 0.0)
			cam.position = target + views[v]
			cam.look_at(target)
			for f in 4: await process_frame
			await RenderingServer.frame_post_draw
			root.get_viewport().get_texture().get_image().save_png("%s/%s_%s.png" % [out, kind, v])
		mi.queue_free(); hi.queue_free()
		await process_frame
	print(JSON.stringify(report))

## ---- install -------------------------------------------------------------------------------------------------------

func save(res: Resource, path: String) -> void:
	if args.has("dry"): return
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := ResourceSaver.save(res, path, ResourceSaver.FLAG_COMPRESS if path.ends_with(".res") else 0)
	if err != OK: push_error("could not save %s: %d" % [path, err])

func material(tex: Texture2D, bump: Texture2D, albedo: Color, bump_scale: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER)
	m.set_shader_parameter("albedo", albedo)
	m.set_shader_parameter("tex", tex)
	m.set_shader_parameter("emission", Color(0, 0, 0, 1))
	m.set_shader_parameter("fill", 0.0)
	m.set_shader_parameter("affine", 0.0)
	m.set_shader_parameter("fog_reach", 1.0)
	m.set_shader_parameter("alpha_cut", 0.5)
	m.set_shader_parameter("uv_xform", Vector4(1, 1, 0, 0))
	m.set_shader_parameter("depth_bias", 0.0)
	m.set_shader_parameter("bump_map", bump)
	m.set_shader_parameter("bump_scale", bump_scale)
	return m

## Connected faces (welded positions) of one surface, in the room's frame: [{tris: PackedInt32Array (face numbers), box}]
func clusters(arr: Array, xf: Transform3D) -> Array:
	var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
	if idx.is_empty():
		idx.resize(v.size())
		for i in v.size(): idx[i] = i
	var key := {}
	var parent := PackedInt32Array(); parent.resize(v.size())
	for i in v.size():
		var k := Vector3i((v[i] * 1000.0).round())
		if key.has(k): parent[i] = key[k]
		else: key[k] = i; parent[i] = i
	var find := func(x: int) -> int:
		while parent[x] != x:
			parent[x] = parent[parent[x]]; x = parent[x]
		return x
	for t in range(0, idx.size(), 3):
		var r0: int = find.call(idx[t])
		for j in [1, 2]:
			var r1: int = find.call(idx[t + j])
			if r1 != r0: parent[r1] = r0
	var groups := {}
	for t in range(0, idx.size(), 3):
		var r: int = find.call(idx[t])
		if not groups.has(r): groups[r] = {"tris": PackedInt32Array(), "box": AABB(xf * v[idx[t]], Vector3.ZERO)}
		var g: Dictionary = groups[r]
		g.tris.append(t / 3)
		for j in 3: g.box = g.box.expand(xf * v[idx[t + j]])
	return groups.values()

func meshes_of(n: Node, xf: Transform3D, out: Array) -> void:
	if n is Node3D: xf = xf * n.transform
	if n is MeshInstance3D and n.mesh: out.append([n, xf])
	for c in n.get_children(): meshes_of(c, xf, out)

func install() -> void:
	var tex: String = args.get("textures", "")
	var rec_dir: String = args.get("record", "")
	var record := {"crowns": [], "props": [], "models": {}}
	# textures and materials
	var t := {}
	for name in ["brass", "brass-height", "wax", "wax-height"]:
		t[name] = load_png(tex + "/" + name + ".png")
		save(t[name], "%s/%s-texture.res" % [MAT_DIR, name])
		if not args.has("dry"): t[name] = load("%s/%s-texture.res" % [MAT_DIR, name])
	var mats := [material(t["brass"], t["brass-height"], Color(1.0, 1.0, 1.0, 1), 0.6),
		material(t["wax"], t["wax-height"], Color(1, 1, 1, 1), 0.5),
		material(load("res://assets/materials/environment-20261013/iron-texture.res"), load("res://assets/materials/environment-20261013/iron-height-texture.res"), Color(0.85, 0.83, 0.8, 1), 0.8)]
	for i in 3:
		save(mats[i], "%s/crown-%s.tres" % [MAT_DIR, ["brass", "wax", "iron"][i]])
		if not args.has("dry"): mats[i] = load("%s/crown-%s.tres" % [MAT_DIR, ["brass", "wax", "iron"][i]])
	if args.has("textures-only"): return
	# the three crown bodies, each its own scene with a marker at every wick
	var scenes := {}
	for kind in ["large", "small", "tiered"]:
		var b := body(kind, mats)
		save(b.mesh, "%s/crown-%s.res" % [PROP_DIR, kind])
		var crown := Node3D.new()
		crown.name = "CandleCrown"
		crown.set_meta("candle_crown", kind)
		crown.set_meta("candle_flames", b.flames)
		var mi := MeshInstance3D.new()
		mi.name = "Body"
		mi.mesh = b.mesh if args.has("dry") else load("%s/crown-%s.res" % [PROP_DIR, kind])
		crown.add_child(mi); mi.owner = crown
		# the collision stand-in: FurnitureVisual's geometry collision takes this plain band, not every carved face
		var hm0 := Crown.hull(kind)
		save(hm0, "%s/crown-%s-hull.res" % [PROP_DIR, kind])
		var hull := MeshInstance3D.new()
		hull.name = "Hull"
		hull.mesh = hm0 if args.has("dry") else load("%s/crown-%s-hull.res" % [PROP_DIR, kind])
		hull.visible = false
		hull.set_meta("furniture_collision_hull", true)
		crown.add_child(hull); hull.owner = crown
		var fl := Node3D.new(); fl.name = "Flames"
		crown.add_child(fl); fl.owner = crown
		for i in b.flames.size():
			var m := Marker3D.new()
			m.name = "Flame%02d" % i
			m.position = b.flames[i]
			m.add_to_group("candle_flame", true)
			m.set_meta("candle_flame", true)
			fl.add_child(m); m.owner = crown
		var ps := PackedScene.new(); ps.pack(crown)
		save(ps, "%s/candle-crown-%s.tscn" % [PROP_DIR, kind])
		scenes[kind] = "%s/candle-crown-%s.tscn" % [PROP_DIR, kind]
		record.models[kind] = {"triangles": b.tris, "lights": b.flames.size()}
		crown.free()
	# the old crowns, room by room
	var hoists := {}
	for room in ROOMS:
		var objects: Node = load("res://world/interiors/room-%s.objects.tscn" % room).instantiate()
		var props := []   # [object id, prop path, object transform, instance, meshes]
		for o in objects.get_children():
			var asset = o.get("Asset")
			if asset == null or asset.get("Scene") == null: continue
			var inst: Node = asset.Scene.instantiate()
			var ms := []
			meshes_of(inst, o.transform, ms)
			props.append({"id": str(o.get("ObjectId")), "path": asset.Scene.resource_path, "xf": o.transform, "inst": inst, "meshes": ms, "groups": []})
		# every old-crown surface's connected parts
		var rings := []
		for p in props:
			for m in p.meshes:
				var mi: MeshInstance3D = m[0]
				for si in mi.mesh.get_surface_count():
					var mat := mi.mesh.surface_get_material(si)
					var mp := mat.resource_path if mat else ""
					if mi.get_surface_override_material(si): mp = mi.get_surface_override_material(si).resource_path
					if mp not in OLD: continue
					for g in clusters(mi.mesh.surface_get_arrays(si), m[1]):
						var b: AABB = g.box
						var entry := {"mesh": mi, "surface": si, "mat": mp, "tris": g.tris, "box": b}
						p.groups.append(entry)
						var sx := b.size.x
						if absf(sx - b.size.z) > 0.08: continue
						var kind := ""
						if mp.ends_with("r006187.res") and absf(sx - 2.4) < 0.06 and b.size.y > 0.2 and b.size.y < 0.4: kind = "large"
						elif mp.ends_with("r006187.res") and absf(sx - 1.6) < 0.06 and b.size.y < 0.08: kind = "small"
						elif mp.ends_with("r005840.res") and absf(sx - 2.1) < 0.06 and b.size.y < 0.08: kind = "tiered"
						if kind != "": rings.append({"kind": kind, "centre": b.get_center(), "y0": b.position.y, "prop": p})
		# the parts that belong to each crown: old materials, inside its column
		var remove := {}   # MeshInstance3D -> {surface: {face: true}}
		for r in rings:
			var c: Vector3 = r.centre
			var R: float = {"large": 1.25, "small": 0.8, "tiered": 1.05}[r.kind] + 0.15
			var top := -1e9
			var parts := []
			for p in props:
				for g in p.groups:
					var b: AABB = g.box
					var gc := b.get_center()
					if Vector2(gc.x - c.x, gc.z - c.z).length() > R: continue
					# (its own parts start at the ring, or just under it: the cathedral's pendant bowls hang 0.6 m below; the bells in
					# the towers above hang far higher)
					if b.position.y < r.y0 - 0.65 or b.position.y > r.y0 + 1.5 or b.end.y > r.y0 + 26.0: continue
					if maxf(b.size.x, b.size.z) > 2.6: continue
					if g.mat in CHAIN_OLD: top = maxf(top, b.end.y)
					if not remove.has(g.mesh): remove[g.mesh] = {}
					if not remove[g.mesh].has(g.surface): remove[g.mesh][g.surface] = {}
					for f in g.tris: remove[g.mesh][g.surface][f] = true
					parts.append({"object": p.id, "mat": g.mat.get_file(), "faces": g.tris.size(), "at": [snappedf(b.position.x, 0.01), snappedf(b.position.y, 0.01), snappedf(b.position.z, 0.01)], "size": [snappedf(b.size.x, 0.01), snappedf(b.size.y, 0.01), snappedf(b.size.z, 0.01)]})
			r["top"] = top
			r["parts"] = parts
		# the new crowns: into the piece that held the ring, where the ring hung
		for r in rings:
			var p: Dictionary = r.prop
			var len := snappedf(r.top - r.y0 - HANG[r.kind], 0.01)
			var hkey := "%s-%d" % [r.kind, roundi(len * 100)]
			if not hoists.has(hkey):
				var h := hoist(r.kind, len, mats)
				save(h.mesh, "%s/hoist-%s.res" % [PROP_DIR, hkey])
				hoists[hkey] = {"path": "%s/hoist-%s.res" % [PROP_DIR, hkey], "tris": h.tris, "mesh": h.mesh}
			var local: Vector3 = p.xf.affine_inverse() * Vector3(r.centre.x, r.y0, r.centre.z)
			var holder := Node3D.new()
			holder.name = "CandleCrown%d" % (p.inst.get_children().filter(func(n): return str(n.name).begins_with("CandleCrown")).size())
			holder.position = local
			holder.set_meta("candle_crown", r.kind)
			# (FurnitureVisual: a hulled part's faces are not collision; the crown's Hull is)
			holder.set_meta("furniture_hulled_part", true)
			var crown: Node3D = (load(scenes[r.kind]) as PackedScene).instantiate() if not args.has("dry") else Node3D.new()
			crown.name = "Crown"
			holder.add_child(crown)
			var hm := MeshInstance3D.new()
			hm.name = "Hoist"
			hm.mesh = hoists[hkey].mesh if args.has("dry") else load(hoists[hkey].path)
			holder.add_child(hm)
			p.inst.add_child(holder)
			holder.owner = p.inst; crown.owner = p.inst; hm.owner = p.inst
			record.crowns.append({"room": room, "object": p.id, "kind": r.kind, "at": [snappedf(r.centre.x, 0.01), snappedf(r.y0, 0.01), snappedf(r.centre.z, 0.01)], "top": snappedf(r.top, 0.01), "hoist": hkey, "removed": r.parts})
		# take the old crowns' faces out of their pieces
		var touched := {}
		for p in props:
			var before := 0
			var after := 0
			for m in p.meshes:
				var mi: MeshInstance3D = m[0]
				var tri_count := func(mesh: Mesh) -> int:
					var n := 0
					for si in mesh.get_surface_count():
						var a := mesh.surface_get_arrays(si)
						n += (a[Mesh.ARRAY_INDEX].size() if a[Mesh.ARRAY_INDEX] != null else a[Mesh.ARRAY_VERTEX].size()) / 3
					return n
				before += tri_count.call(mi.mesh)
				if remove.has(mi):
					var nm := ArrayMesh.new()
					for si in mi.mesh.get_surface_count():
						var arr := mi.mesh.surface_get_arrays(si)
						var mat := mi.mesh.surface_get_material(si)
						var nme: String = mi.mesh.surface_get_name(si)
						if remove[mi].has(si):
							var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
							if idx.is_empty():
								idx.resize(arr[Mesh.ARRAY_VERTEX].size())
								for i in idx.size(): idx[i] = i
							var keep := PackedInt32Array()
							for f in idx.size() / 3:
								if not remove[mi][si].has(f):
									keep.append(idx[f * 3]); keep.append(idx[f * 3 + 1]); keep.append(idx[f * 3 + 2])
							if keep.is_empty(): continue
							arr = compact(arr, keep)
						nm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
						nm.surface_set_material(nm.get_surface_count() - 1, mat)
						if nme != "": nm.surface_set_name(nm.get_surface_count() - 1, nme)
					nm.resource_name = mi.mesh.resource_name
					if nm.get_surface_count() == 0:
						mi.get_parent().remove_child(mi); mi.free()
					else:
						mi.mesh = nm
						after += tri_count.call(nm)
					touched[p.path] = true
				else:
					after += tri_count.call(mi.mesh)
			var holders: Array = p.inst.get_children().filter(func(n): return str(n.name).begins_with("CandleCrown"))
			if holders.size() > 0: touched[p.path] = true
			if touched.has(p.path):
				var ps := PackedScene.new()
				var err := ps.pack(p.inst)
				if err != OK: push_error("pack %s: %d" % [p.path, err])
				save(ps, p.path)
				record.props.append({"room": room, "object": p.id, "scene": p.path, "old_triangles_kept": after, "old_triangles_before": before, "crowns": holders.size()})
		for p in props: p.inst.free()
		objects.free()
	for k in hoists: record.models["hoist-" + k] = {"triangles": hoists[k].tris}
	print(JSON.stringify(record, "  "))
	if rec_dir != "":
		DirAccess.make_dir_recursive_absolute(rec_dir)
		var f := FileAccess.open(rec_dir + "/promotion.json", FileAccess.WRITE)
		f.store_string(JSON.stringify(record, "  ")); f.close()

## The second pass (2026-10-27): rebuild the pictures, materials, both variants of each model and the hoists in use,
## in place; the room pieces keep their crowns (vary-crowns.py turns them and picks their variant).
func materials(tex: String) -> Array:
	var t := {}
	for name in ["brass", "brass-height", "wax", "wax-height"]:
		t[name] = load_png(tex + "/" + name + ".png")
		save(t[name], "%s/%s-texture.res" % [MAT_DIR, name])
		if not args.has("dry"): t[name] = load("%s/%s-texture.res" % [MAT_DIR, name])
	var mats := [material(t["brass"], t["brass-height"], Color(1.0, 1.0, 1.0, 1), 0.6),
		material(t["wax"], t["wax-height"], Color(1, 1, 1, 1), 0.5),
		material(load("res://assets/materials/environment-20261013/iron-texture.res"), load("res://assets/materials/environment-20261013/iron-height-texture.res"), Color(0.85, 0.83, 0.8, 1), 0.8)]
	for i in 3:
		save(mats[i], "%s/crown-%s.tres" % [MAT_DIR, ["brass", "wax", "iron"][i]])
		if not args.has("dry"): mats[i] = load("%s/crown-%s.tres" % [MAT_DIR, ["brass", "wax", "iron"][i]])
	return mats

func scene_for(kind: String, variant: int, b: Dictionary) -> void:
	var suffix := "" if variant == 0 else "-" + "abcdefgh"[variant]
	save(b.mesh, "%s/crown-%s%s.res" % [PROP_DIR, kind, suffix])
	var crown := Node3D.new()
	crown.name = "CandleCrown"
	crown.set_meta("candle_crown", kind)
	crown.set_meta("candle_flames", b.flames)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = b.mesh if args.has("dry") else load("%s/crown-%s%s.res" % [PROP_DIR, kind, suffix])
	crown.add_child(mi); mi.owner = crown
	var hull := MeshInstance3D.new()
	hull.name = "Hull"
	hull.mesh = load("%s/crown-%s-hull.res" % [PROP_DIR, kind])
	hull.visible = false
	hull.set_meta("furniture_collision_hull", true)
	crown.add_child(hull); hull.owner = crown
	var fl := Node3D.new(); fl.name = "Flames"
	crown.add_child(fl); fl.owner = crown
	for i in b.flames.size():
		var m := Marker3D.new()
		m.name = "Flame%02d" % i
		m.position = b.flames[i]
		m.add_to_group("candle_flame", true)
		m.set_meta("candle_flame", true)
		fl.add_child(m); m.owner = crown
	var ps := PackedScene.new(); ps.pack(crown)
	save(ps, "%s/candle-crown-%s%s.tscn" % [PROP_DIR, kind, suffix])
	crown.free()

func rebuild() -> void:
	var mats := materials(args.get("textures", ""))
	var report := {}
	for kind in ["large", "small", "tiered"]:
		for v in VARIANTS:
			var b := body(kind, mats, v)
			scene_for(kind, v, b)
			report["%s-%d" % [kind, v]] = {"triangles": b.tris, "lights": b.flames.size()}
	for f in DirAccess.get_files_at(PROP_DIR):
		if not f.begins_with("hoist-") or not f.ends_with(".res"): continue
		var parts := f.get_basename().split("-")
		var kind := parts[1]
		var h := hoist(kind, int(parts[2]) / 100.0, mats)
		save(h.mesh, "%s/%s" % [PROP_DIR, f])
		report[f.get_basename()] = {"triangles": h.tris}
	print(JSON.stringify(report, "  "))

## The old crowns' flat flame glows (the bake's glow triangles r006515, r006873, r006992, r005876 at the old candles'
## tips) taken out of their room pieces: they floated under and beside the new candles (2026-10-27); ChurchLight.cs
## draws each new candle's flame on its wick. Only the glows within a crown's ring, from its foot to 1.8 m over it.
const GLOWS := ["res://world/town/resources/r006515.res", "res://world/town/resources/r006873.res", "res://world/town/resources/r006992.res", "res://world/town/resources/r005876.res"]

func cut_glows() -> void:
	var record := []
	for room in ROOMS:
		var objects: Node = load("res://world/interiors/room-%s.objects.tscn" % room).instantiate()
		var props := []
		var crowns := []   # [centre (room frame), ring radius]
		for o in objects.get_children():
			var asset = o.get("Asset")
			if asset == null or asset.get("Scene") == null: continue
			var inst: Node = asset.Scene.instantiate()
			var ms := []
			meshes_of(inst, o.transform, ms)
			props.append({"id": str(o.get("ObjectId")), "path": asset.Scene.resource_path, "inst": inst, "meshes": ms})
			for h in inst.get_children():
				if not str(h.name).begins_with("CandleCrown"): continue
				var R: float = {"large": 1.2, "small": 0.8, "tiered": 1.05}[str(h.get_meta("candle_crown"))]
				crowns.append([o.transform * (h as Node3D).position, R])
		for p in props:
			var changed := false
			var cut := 0
			for m in p.meshes:
				var mi: MeshInstance3D = m[0]
				var remove := {}
				for si in mi.mesh.get_surface_count():
					var mat := mi.mesh.surface_get_material(si)
					var mp := mat.resource_path if mat else ""
					if mi.get_surface_override_material(si): mp = mi.get_surface_override_material(si).resource_path
					if mp not in GLOWS: continue
					for g in clusters(mi.mesh.surface_get_arrays(si), m[1]):
						var c: Vector3 = (g.box as AABB).get_center()
						for cr in crowns:
							var at: Vector3 = cr[0]
							if Vector2(c.x - at.x, c.z - at.z).length() < cr[1] + 0.25 and c.y > at.y - 0.1 and c.y < at.y + 1.8:
								if not remove.has(si): remove[si] = {}
								for f in g.tris: remove[si][f] = true
								cut += g.tris.size()
								break
				if remove.is_empty(): continue
				var nm := ArrayMesh.new()
				for si in mi.mesh.get_surface_count():
					var arr := mi.mesh.surface_get_arrays(si)
					var mat := mi.mesh.surface_get_material(si)
					var nme: String = mi.mesh.surface_get_name(si)
					if remove.has(si):
						var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
						if idx.is_empty():
							idx.resize(arr[Mesh.ARRAY_VERTEX].size())
							for i in idx.size(): idx[i] = i
						var keep := PackedInt32Array()
						for f in idx.size() / 3:
							if not remove[si].has(f):
								keep.append(idx[f * 3]); keep.append(idx[f * 3 + 1]); keep.append(idx[f * 3 + 2])
						if keep.is_empty(): continue
						arr = compact(arr, keep)
					nm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
					nm.surface_set_material(nm.get_surface_count() - 1, mat)
					if nme != "": nm.surface_set_name(nm.get_surface_count() - 1, nme)
				nm.resource_name = mi.mesh.resource_name
				if nm.get_surface_count() == 0:
					mi.get_parent().remove_child(mi); mi.free()
				else:
					mi.mesh = nm
				changed = true
			if changed:
				var ps := PackedScene.new()
				var err := ps.pack(p.inst)
				if err != OK: push_error("pack %s: %d" % [p.path, err])
				save(ps, p.path)
				record.append({"room": room, "object": p.id, "scene": p.path, "glow_triangles_cut": cut})
		for p in props: p.inst.free()
		objects.free()
	print(JSON.stringify(record, "  "))

## A surface's arrays keeping only the corners `keep` uses (renumbered).
func compact(arr: Array, keep: PackedInt32Array) -> Array:
	var remap := {}
	var order := PackedInt32Array()
	for i in keep:
		if not remap.has(i): remap[i] = order.size(); order.append(i)
	var out := []
	out.resize(Mesh.ARRAY_MAX)
	for a in Mesh.ARRAY_MAX:
		var src = arr[a]
		if src == null or a == Mesh.ARRAY_INDEX: continue
		var per := 1
		if a == Mesh.ARRAY_TANGENT: per = 4
		var n_src: int = arr[Mesh.ARRAY_VERTEX].size()
		if src.size() != n_src * per:
			per = src.size() / n_src if n_src > 0 else 1
		var dst = src.duplicate()
		dst.resize(order.size() * per)
		for j in order.size():
			for q in per: dst[j * per + q] = src[order[j] * per + q]
		out[a] = dst
	var idx := PackedInt32Array()
	idx.resize(keep.size())
	for i in keep.size(): idx[i] = remap[keep[i]]
	out[Mesh.ARRAY_INDEX] = idx
	return out

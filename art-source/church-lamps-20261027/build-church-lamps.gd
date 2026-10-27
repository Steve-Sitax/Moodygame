extends SceneTree
## The churches' sanctuary lamps and gas brackets (issue #227, 2026-10-27), built face by face with the candle crowns'
## builder (crown_mesh.gd: turned parts, round wire, chains of real links), in the crowns' aged brass and the town's iron.
##   godot --headless --path native-godot --script <this> -- --install
##       materials, the lamp, the bracket and each church's lamp cord, under assets/props/church-lamps
##   godot --path native-godot --script <this> -- --preview <out dir>
##       (windowed) both models on their own under a plain light
## ChurchLight.cs hangs them (Fittings) and lights their glass.

const Crown := preload("res://../art-source/candle-crowns-20261027/crown_mesh.gd")
const SHADER := "res://world/town/resources/r000557.res"
const MAT_DIR := "res://assets/materials/church-lamps-20261027"
const PROP_DIR := "res://assets/props/church-lamps"
const BRASS := "res://assets/materials/candle-crowns-20261027/crown-brass.tres"
const IRON := "res://assets/materials/candle-crowns-20261027/crown-iron.tres"
## Each church's cord: from the lamp's top eye to the hook under the vault, metres (the vault over the lamp less the
## lamp's hanging height and its own 0.75 m; ChurchLight.Fittings).
const CORDS := {"stpaul": 15.43, "stjacob": 21.80, "carolus": 15.63, "cathedral": 24.71}

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
	quit()

## ---- the sanctuary lamp ------------------------------------------------------------------------------------------
## A turned brass hanging lamp (the bowl 236 mm across, a knop and finial under it) holding a ruby glass cup whose rim
## stands 32 mm over the bowl's; three brass chains from lugs on the rim to a turned canopy with an eye, 0.75 m over the rim.
## Its frame: y 0 = the bowl's rim, the lamp's axis. Surfaces: brass, ruby glass, iron (none).
func sanctuary_lamp(c) -> void:
	var I := Transform3D.IDENTITY
	# the bowl: a finial and knop under it, the outside flaring to a rolled rim, the inside back down (2 to 4 mm rounds)
	c.lathe(c.BRASS, [[0.0, -0.175], [0.006, -0.174], [0.011, -0.168], [0.013, -0.158], [0.010, -0.148], [0.008, -0.140],
		[0.013, -0.132], [0.019, -0.122], [0.019, -0.112], [0.014, -0.104], [0.016, -0.097], [0.030, -0.090], [0.050, -0.078],
		[0.072, -0.060], [0.092, -0.038], [0.104, -0.014], [0.110, 0.010], [0.113, 0.022], [0.118, 0.028], [0.1185, 0.035],
		[0.115, 0.040], [0.110, 0.0395], [0.106, 0.034], [0.100, 0.006], [0.088, -0.026], [0.066, -0.050], [0.040, -0.064],
		[0.0, -0.070]], 32, I, c.BRASS_TILE,
		[0.8, 0.85, 0.9, 1.0, 0.8, 0.7, 0.85, 1.0, 1.0, 0.75, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 1.0, 1.0, 1.0, 0.85, 0.7, 0.6, 0.55, 0.5, 0.45, 0.45], false)
	# a band of beads round the bowl's belly
	for k in 24:
		var th := TAU * k / 24.0
		c.lathe(c.BRASS, [[0.0, -0.006], [0.004, -0.005], [0.006, 0.0], [0.004, 0.005], [0.0, 0.006]], 8,
			Transform3D(Basis.IDENTITY, Vector3(0.1065 * cos(th), -0.004, 0.1065 * sin(th))), c.BRASS_TILE, 0.9, false)
	# a turned brass lid over the bowl, its edge rolled, a round opening for the glass
	c.lathe(c.BRASS, [[0.0505, 0.0275], [0.080, 0.030], [0.105, 0.033], [0.1125, 0.036], [0.112, 0.040], [0.107, 0.0425],
		[0.080, 0.045], [0.058, 0.047], [0.0515, 0.0455], [0.0505, 0.0275]], 32, I, c.BRASS_TILE, [0.6, 0.6, 0.6, 0.8, 1.0, 1.0, 1.0, 0.9, 0.8, 0.6], false)
	# the ruby glass standing in it, 60 mm of it clear over the lid so its red shows from the floor (Codex 2026-10-27:
	# brass and glass must read apart), its foot on a ring inside the bowl
	c.lathe(c.WAX, [[0.0, -0.030], [0.026, -0.030], [0.036, -0.022], [0.041, 0.000], [0.044, 0.040], [0.0475, 0.100],
		[0.0490, 0.106], [0.0478, 0.1085], [0.0450, 0.1072], [0.0425, 0.098], [0.039, 0.040], [0.035, 0.000], [0.028, -0.020],
		[0.0, -0.023]], 24, I, 0.2, [0.8, 0.85, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7], false)
	c.lathe(c.BRASS, [[0.0, -0.034], [0.034, -0.034], [0.040, -0.031], [0.038, -0.028], [0.0, -0.030]], 20, I, c.BRASS_TILE, 0.6, false)
	c.tube(c.BRASS, PackedVector3Array([Vector3(0, -0.068, 0), Vector3(0, -0.034, 0)]), false, 0.006, 8, c.BRASS_TILE, 0.6)
	# three lugs on the rim and the chains up to the canopy
	var top := 0.62
	for k in 3:
		var th := TAU * k / 3.0 + PI / 6.0
		var dir := Vector3(cos(th), 0, sin(th))
		var at := dir * 0.100 + Vector3(0, 0.043, 0)
		c.eye(at, -dir, 0.007, 0.005)
		var lug := dir * 0.022 + Vector3(0, top - 0.010, 0)
		c.eye_down(lug, dir, 0.007, 0.005)
		c.chain(c.BRASS, at + Vector3.UP * 0.010, lug + Vector3.DOWN * 0.004, 0.034, 0.021, 0.0042, 7, 6, c.BRASS_TILE)
	# the canopy: a turned bell with a knop and the top eye
	c.lathe(c.BRASS, [[0.0, top - 0.004], [0.020, top - 0.004], [0.034, top + 0.004], [0.040, top + 0.014], [0.036, top + 0.022],
		[0.024, top + 0.040], [0.014, top + 0.064], [0.017, top + 0.074], [0.017, top + 0.084], [0.011, top + 0.092], [0.0, top + 0.095]], 20, I, c.BRASS_TILE,
		[0.6, 0.7, 0.9, 1.0, 1.0, 0.95, 0.8, 1.0, 1.0, 0.85, 0.8], false)
	var path := PackedVector3Array()
	for k in 16:
		var th := TAU * k / 16
		path.append(Vector3(0.014 * cos(th), top + 0.108 + 0.014 * sin(th), 0))
	c.tube(c.BRASS, path, true, 0.0035, 8, c.BRASS_TILE, 0.9)

## The cord from the lamp's top eye (0.75 m over its rim) up `length` m to an iron hook under a plate in the vault:
## a tarred hemp line (it lowers the lamp to fill its oil), its end looped through the eye and the hook.
func cord(c, length: float) -> void:
	var y0 := 0.742
	var top := y0 + length
	var hb: Vector3 = c.hook(Vector3(0, top, 0), 0.10)
	var path := PackedVector3Array()
	var n := maxi(2, int(length / 0.5))
	for k in n + 1:
		path.append(Vector3(0, lerpf(y0 + 0.004, hb.y - 0.004, float(k) / n), 0))
	c.tube(c.IRON, path, false, 0.0045, 6, 0.5, 0.75)

## ---- the gas bracket ---------------------------------------------------------------------------------------------
## A cast-iron gas bracket on a pillar (Antwerp's churches had town gas by the 1870s): a round wall plate with a
## boss, the gas pipe out 0.38 m and up into a brass gallery holding an opal globe over a fishtail burner, a brass
## plug cock on the pipe, a scroll under it to the plate. Its frame: z 0 = the pillar's face, the arm out along +z,
## y 0 = the pipe. Surfaces: brass, opal glass, iron.
func gas_bracket(c) -> void:
	var toZ := Basis(Vector3(1, 0, 0), Vector3(0, 0, 1), Vector3(0, -1, 0))
	# the wall plate: a dished round with a rolled edge and a boss for the pipe (cast: 2 to 3 mm rounds)
	c.lathe(c.IRON, [[0.0, -0.002], [0.060, -0.002], [0.066, 0.002], [0.068, 0.007], [0.065, 0.012], [0.056, 0.014],
		[0.036, 0.016], [0.026, 0.020], [0.022, 0.027], [0.022, 0.036], [0.018, 0.040], [0.0, 0.041]], 28, Transform3D(toZ, Vector3(0, 0, 0)), c.IRON_TILE,
		[0.6, 0.7, 0.9, 1.0, 1.0, 0.9, 0.8, 0.85, 1.0, 1.0, 0.9, 0.8], false)
	# the pipe: out from the boss, a bend up into the gallery
	var p := PackedVector3Array()
	for k in 8: p.append(Vector3(0, 0, 0.034 + 0.29 * k / 7.0))
	var R := 0.06
	for k in range(1, 9):
		var a := PI * 0.5 * k / 8.0
		p.append(Vector3(0, R - R * cos(a), 0.324 + R * sin(a)))
	p.append(Vector3(0, R + 0.03, 0.324 + R))
	p.append(Vector3(0, R + 0.06, 0.324 + R))
	c.tube(c.IRON, p, false, 0.0095, 10, c.IRON_TILE, 0.9)
	var tip := Vector3(0, R + 0.06, 0.324 + R)
	# a cast collar where the pipe leaves the boss
	c.lathe(c.IRON, [[0.0095, 0.0], [0.014, 0.002], [0.015, 0.008], [0.012, 0.012], [0.0095, 0.013]], 12, Transform3D(toZ, Vector3(0, 0, 0.040)), c.IRON_TILE, 0.85, false)
	# the scroll under it: from the plate's foot out and up to the pipe's underside, then curling down and back
	var s := PackedVector3Array()
	for k in 13:
		var f := k / 12.0
		s.append(Vector3(0, -0.052 + 0.0383 * f * f, 0.010 + 0.205 * f))
	for k in range(1, 15):
		var a := PI * 0.5 - TAU * 0.85 * k / 14.0
		var rr := 0.022 * (1.0 - 0.55 * k / 14.0)
		s.append(Vector3(0, -0.036 + rr * sin(a), 0.215 + rr * cos(a)))
	c.tube(c.IRON, s, false, 0.0042, 8, c.IRON_TILE, 0.85)
	# its foot on the plate, a small round boss
	c.lathe(c.IRON, [[0.0, -0.001], [0.010, -0.001], [0.011, 0.004], [0.007, 0.008], [0.0, 0.009]], 12, Transform3D(toZ, Vector3(0, -0.052, 0.002)), c.IRON_TILE, 0.8, false)
	# the brass plug cock on the pipe, its lever
	c.lathe(c.BRASS, [[0.0, -0.020], [0.009, -0.020], [0.012, -0.016], [0.012, 0.014], [0.010, 0.018], [0.006, 0.020], [0.006, 0.026], [0.0, 0.027]], 12,
		Transform3D(Basis.IDENTITY, Vector3(0, 0, 0.17)), c.BRASS_TILE, [0.7, 0.8, 1.0, 1.0, 0.9, 0.8, 0.9, 0.9], false)
	c.tube(c.BRASS, PackedVector3Array([Vector3(0, 0.024, 0.17), Vector3(0.018, 0.026, 0.17), Vector3(0.040, 0.027, 0.17)]), false, 0.0028, 6, c.BRASS_TILE, 0.95)
	c.lathe(c.BRASS, [[0.0, -0.006], [0.005, -0.004], [0.006, 0.0], [0.005, 0.004], [0.0, 0.006]], 8, Transform3D(Basis(Vector3(0, 0, 1), PI * 0.5), Vector3(0.042, 0.027, 0.17)), c.BRASS_TILE, 1.0, false)
	# the gallery: a turned brass cup on the pipe's end, three screws for the globe, the burner in it
	var g := Transform3D(Basis.IDENTITY, tip)
	c.lathe(c.BRASS, [[0.0, -0.004], [0.012, -0.004], [0.014, 0.0], [0.024, 0.006], [0.038, 0.012], [0.042, 0.018], [0.0415, 0.026],
		[0.038, 0.029], [0.036, 0.024], [0.026, 0.016], [0.012, 0.012], [0.0, 0.012]], 24, g, c.BRASS_TILE, [0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.85, 0.7, 0.6, 0.6], false)
	for k in 3:
		var th := TAU * k / 3.0
		var d := Vector3(cos(th), 0, sin(th))
		c.lathe(c.BRASS, [[0.0, -0.003], [0.0035, -0.003], [0.004, 0.002], [0.0025, 0.004], [0.0, 0.0045]], 8,
			Transform3D(Basis(d.cross(Vector3.UP).normalized(), d, d.cross(d.cross(Vector3.UP).normalized())), tip + d * 0.042 + Vector3(0, 0.022, 0)), c.BRASS_TILE, 0.95, false)
	c.lathe(c.BRASS, [[0.0, 0.010], [0.006, 0.010], [0.006, 0.040], [0.008, 0.044], [0.004, 0.047], [0.0, 0.047]], 10, g, c.BRASS_TILE, [0.6, 0.7, 0.9, 1.0, 0.9, 0.8], false)
	# the opal globe: a ball 160 mm across on a neck in the gallery, open at the top, 2.5 mm thick, its lips rounded; its
	# picture runs once round its section (v 0 at the neck outside, 0.5 at the top lip, 1 back at the neck inside) so
	# the glow picture can be brightest by the flame (Codex 2026-10-27: a flat pale disc at night)
	var globe := [[0.034, 0.020], [0.036, 0.030], [0.052, 0.042], [0.070, 0.062], [0.079, 0.095], [0.076, 0.126],
		[0.062, 0.152], [0.042, 0.168], [0.032, 0.172], [0.031, 0.1745], [0.0295, 0.1745], [0.0295, 0.171], [0.040, 0.165],
		[0.0595, 0.150], [0.0735, 0.126], [0.0765, 0.095], [0.0675, 0.064], [0.050, 0.045], [0.0335, 0.033], [0.0315, 0.022], [0.034, 0.020]]
	var arc := 0.0
	for i in range(1, globe.size()): arc += Vector2(globe[i][0], globe[i][1]).distance_to(Vector2(globe[i - 1][0], globe[i - 1][1]))
	c.lathe(c.WAX, globe, 28, g, arc, 1.0, false)

## The globe's middle in the bracket's frame (ChurchLight.cs puts its glow there).
const GLOBE := Vector3(0, 0.06 + 0.06 + 0.095, 0.384)

## ---- materials, install, preview -----------------------------------------------------------------------------------

func material(albedo: Color, emission: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER)
	m.set_shader_parameter("albedo", albedo)
	m.set_shader_parameter("emission", emission)
	m.set_shader_parameter("fill", 0.0)
	m.set_shader_parameter("affine", 0.0)
	m.set_shader_parameter("fog_reach", 1.0)
	m.set_shader_parameter("alpha_cut", 0.5)
	m.set_shader_parameter("uv_xform", Vector4(1, 1, 0, 0))
	m.set_shader_parameter("depth_bias", 0.0)
	m.set_shader_parameter("bump_scale", 0.0)
	return m

func save(res: Resource, path: String) -> void:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := ResourceSaver.save(res, path, ResourceSaver.FLAG_COMPRESS if path.ends_with(".res") else 0)
	if err != OK: push_error("could not save %s: %d" % [path, err])

func mats() -> Array:
	# ruby glass: deep red, glowing a little of itself day and night (the lamp never goes out); opal glass: milk white,
	# its glow set by ChurchLight.cs after dark
	var ruby := material(Color(0.396, 0.059, 0.125, 1), Color(0.36, 0.03, 0.045))
	var opal := material(Color(0.86, 0.85, 0.82, 1), Color(0, 0, 0))
	# the opal glass's glow over its section: brightest on the lower belly round the burner, falling in one broad, soft
	# gradient to the neck and the top lip (Codex 2026-10-27: no band), the inside (seen through the top) bright
	var img := Image.create(4, 128, false, Image.FORMAT_RGB8)
	for y in 128:
		var v := (y + 0.5) / 128.0
		var t := v / 0.5 if v < 0.5 else (1.0 - v) / 0.5
		var b := 0.42 + 0.58 * exp(-pow((t - 0.30) / 0.42, 2.0))
		if v >= 0.5: b = maxf(b, 0.8)
		for x in 4: img.set_pixel(x, y, Color(b, b * 0.96, b * 0.9))
	img.generate_mipmaps()
	var glow := ImageTexture.create_from_image(img)
	save(glow, MAT_DIR + "/opal-glow-texture.res")
	opal.set_shader_parameter("emission_tex", load(MAT_DIR + "/opal-glow-texture.res"))
	save(ruby, MAT_DIR + "/ruby-glass.tres")
	save(opal, MAT_DIR + "/opal-glass.tres")
	return [load(BRASS), load(MAT_DIR + "/ruby-glass.tres"), load(MAT_DIR + "/opal-glass.tres"), load(IRON)]

func install() -> void:
	var m := mats()
	var report := {}
	var c = Crown.new(227)
	sanctuary_lamp(c)
	save(c.mesh([m[0], m[1], m[3]]), PROP_DIR + "/sanctuary-lamp.res")
	report["sanctuary-lamp"] = c.triangles()
	c = Crown.new(228)
	gas_bracket(c)
	save(c.mesh([m[0], m[2], m[3]]), PROP_DIR + "/gas-bracket.res")
	report["gas-bracket"] = c.triangles()
	for id in CORDS:
		c = Crown.new(229)
		cord(c, CORDS[id])
		save(c.mesh([m[0], m[1], m[3]]), PROP_DIR + "/sanctuary-cord-%s.res" % id)
		report["sanctuary-cord-" + id] = c.triangles()
	print(JSON.stringify(report, "  "))

func preview(out: String) -> void:
	DirAccess.make_dir_recursive_absolute(out)
	# (plain materials: the game's shader needs the town's globals)
	var m := []
	for spec in [["res://assets/materials/candle-crowns-20261027/brass-texture.res", Color(1, 1, 1), 0.6], ["", Color(0.42, 0.035, 0.04), 0.0], ["", Color(0.86, 0.85, 0.82), 0.0], ["res://assets/materials/environment-20261013/iron-texture.res", Color(0.85, 0.83, 0.8), 0.3]]:
		var sm := StandardMaterial3D.new()
		sm.vertex_color_use_as_albedo = true
		sm.albedo_color = spec[1]
		if spec[0] != "": sm.albedo_texture = load(spec[0])
		sm.metallic = spec[2]
		sm.roughness = 0.5
		m.append(sm)
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
	cam.fov = 40
	world.add_child(cam)
	var models := []
	var c = Crown.new(227)
	sanctuary_lamp(c)
	models.append(["lamp", c.mesh([m[0], m[1], m[3]]), Vector3(0, 0.25, 0), 0.9])
	c = Crown.new(228)
	gas_bracket(c)
	models.append(["bracket", c.mesh([m[0], m[2], m[3]]), Vector3(0, 0.08, 0.2), 0.75])
	for md in models:
		var mi := MeshInstance3D.new(); mi.mesh = md[1]; world.add_child(mi)
		var views := {"side": Vector3(1, 0.1, 0.25), "below": Vector3(0.6, -0.8, 0.5), "above": Vector3(0.6, 0.8, 0.6), "front": Vector3(0.15, 0.05, 1)}
		for v in views:
			var target: Vector3 = md[2]
			cam.position = target + (views[v] as Vector3).normalized() * md[3]
			cam.look_at(target)
			for f in 4: await process_frame
			await RenderingServer.frame_post_draw
			root.get_viewport().get_texture().get_image().save_png("%s/%s_%s.png" % [out, md[0], v])
		mi.queue_free()
		await process_frame

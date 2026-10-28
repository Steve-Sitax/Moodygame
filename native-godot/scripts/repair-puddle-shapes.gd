extends SceneTree
# Issue #231: the puddles had straight sides and square corners (value noise on its square grid, thresholded). Psx now
# warps the puddles' ground and turns each stretch of the noise its own way (Render/Psx.cs pud_turn, pud_warp; the
# footsteps' Audio/Puddles.cs keeps the same sums). The town's ground shaders are stored copies of that generated code;
# this writes the same change into each stored shader that holds the old puddle sums (changed in place: no new kind).
# Run in Forward+ (not headless):
#   godot --rendering-method forward_plus --path . --script res://scripts/repair-puddle-shapes.gd -- <backup folder> [--apply]
# Without --apply it only lists the shaders it would change. Originals are copied to the backup folder first and never
# overwritten.
const OLD_PN := "float pn = pud_val(pp / 17.0) * 0.55 + pud_val(pp / 7.3 + 31.7) * 0.3 + pud_val(pp / 2.9 - 12.1) * 0.15;"
const NEW_PN := "vec2 pw = pud_warp(pp);\n\t\tfloat pn = pud_val(pud_turn(pw, 0.814, 0.581) / 17.0) * 0.55 + pud_val(pud_turn(pw, -0.333, 0.943) / 7.3 + 31.7) * 0.3 + pud_val(pud_turn(pw, -0.951, 0.309) / 2.9 - 12.1) * 0.15;"
const OLD_BREAK := "water *= smoothstep(0.46, 0.56, pud_val(pp / 2.1 + 57.1)) * smoothstep(0.3, 0.42, pud_val(pp / 4.7 - 23.9));"
const NEW_BREAK := "water *= smoothstep(0.46, 0.56, pud_val(pud_turn(pw, 0.454, -0.891) / 2.1 + 57.1)) * smoothstep(0.3, 0.42, pud_val(pud_turn(pw, -0.6, -0.8) / 4.7 - 23.9));"
const OLD_HOL := "float hol = 1.0 - texture(psx_dirt, (pp - psx_dirt_box.xy) / psx_dirt_box.zw).a;"
const NEW_HOL := "// (read a little off its place, by the same warp: the mask's half-metre texels drew the hollows' edges straight)\n\t\tfloat hol = 1.0 - texture(psx_dirt, (pp + (pw - pp) * 0.25 - psx_dirt_box.xy) / psx_dirt_box.zw).a;"
const FUNCS := "// the puddles' ground (Audio/Puddles.cs keeps the same sums): warped by up to 1.2 m, each stretch of the noise turned its own\n// way. On the noise's square grid alone the puddles had straight sides and square corners (Codex on #231).\nvec2 pud_turn(vec2 p, float c, float s) { return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }\nvec2 pud_warp(vec2 p) { return p + (vec2(pud_val(p / 3.7 + 5.3), pud_val(p / 3.7 - 9.1)) - 0.5) * 2.4; }\n"

func _initialize(): call_deferred("run")

func repaired(code: String) -> String:
	var c := code.replace("\r\n", "\n")
	if not c.contains(OLD_PN) or c.contains("pud_warp"): return ""
	var at := c.find("float pud_val(vec2 p) {")
	if at < 0: return ""
	var close := c.find("\n}\n", at)
	if close < 0: return ""
	c = c.substr(0, close + 3) + FUNCS + c.substr(close + 3)
	c = c.replace(OLD_PN, NEW_PN).replace(OLD_BREAK, NEW_BREAK).replace(OLD_HOL, NEW_HOL)
	return c

func materials_of(node: Node, into: Dictionary) -> void:
	if node is GeometryInstance3D and node.material_override is ShaderMaterial: into[node.material_override] = true
	var mesh: Mesh = null
	if node is MeshInstance3D: mesh = node.mesh
	elif node is MultiMeshInstance3D and node.multimesh: mesh = node.multimesh.mesh
	if mesh:
		for s in mesh.get_surface_count():
			var m = mesh.surface_get_material(s)
			if m is ShaderMaterial: into[m] = true
			if node is MeshInstance3D and node.get_surface_override_material(s) is ShaderMaterial: into[node.get_surface_override_material(s)] = true

func run():
	var a := OS.get_cmdline_user_args()
	var backup: String = a[0]
	var apply := a.size() > 1 and a[1] == "--apply"
	DirAccess.make_dir_recursive_absolute(backup)
	var mats := {}
	for scene_path in ["res://world/town/scene.tscn"]:
		var scene = load(scene_path).instantiate()
		root.add_child(scene)
		for n in scene.find_children("*", "", true, false): materials_of(n, mats)
	# the shaders by their owning file (an embedded shader lives in its material's file)
	var done := {}
	var changed := 0
	for m in mats.keys():
		var sh: Shader = m.shader
		if sh == null or done.has(sh): continue
		done[sh] = true
		var code := repaired(sh.code)
		if code == "": continue
		var file: String = sh.resource_path.get_slice("::", 0)
		var owner: Resource = sh if not sh.resource_path.contains("::") else m
		if owner != sh and owner.resource_path != file:
			print("skip ", sh.resource_path, ": embedded in ", file, ", not in this material ", m.resource_path)
			continue
		print(("change " if apply else "would change "), sh.resource_path, " (file ", file, ")")
		changed += 1
		if not apply: continue
		var keep := backup.path_join(file.get_file())
		if FileAccess.file_exists(keep):
			push_error("backup exists: " + keep); quit(1); return
		DirAccess.copy_absolute(ProjectSettings.globalize_path(file), keep)
		sh.code = code
		var err := ResourceSaver.save(owner, file, ResourceSaver.FLAG_COMPRESS)
		if err != OK:
			push_error("save failed: " + file); quit(1); return
		var back = load(file)
		var back_code: String = (back.shader.code if back is ShaderMaterial else back.code)
		if not back_code.contains("pud_warp"):
			push_error("reload lacks the change: " + file); quit(1); return
	print("puddle shapes: ", changed, " shaders ", ("changed" if apply else "to change"), " of ", done.size())
	quit()

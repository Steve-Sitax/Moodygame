extends SceneTree
# Issue #188: the town's grime decals (rust runs, soot, damp, the drainage stains; shader r000218, material r000221) were
# unshaded: each stain was drawn in its own colour times the day's overall light, whatever light fell on the wall under it.
# On a wall in shade, or at night by a lamp, the stain came out lighter than the wall and seemed to glow.
# Now the stain is multiplied over the lit wall: it darkens (rust also reddens) the wall's own colour as the sun, the
# shade, the rain and the lamps have made it, so it follows the light everywhere. The same shader resource, code changed
# in place: no new shader kind.
# Usage: godot --headless --path . -s scripts/repair-decal-light.gd -- <record folder>
# The original is copied to <record>/original-resources first and never overwritten; a second run changes nothing.
const PATH := "res://world/town/resources/r000218.res"
const MARK := "// #188: the stain follows the wall's light"
const OLD_MODE := "render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;"
const NEW_MODE := "render_mode unshaded, blend_mul, depth_draw_never, cull_disabled, fog_disabled;"
const OLD := """	float light = clamp(dot(psx_fog_color.rgb, vec3(0.3, 0.59, 0.11)) / 0.125, 0.06, 1.0);
	ALBEDO = COLOR.rgb * light;
	ALPHA = a;"""
const NEW := """	// #188: the stain follows the wall's light: multiplied over the lit wall (sun, shade, rain, lamps), it darkens the
	// wall's own colour. The stain's colour is read against a light wall (0.55): soot and damp darken, rust darkens and reddens.
	ALBEDO = mix(vec3(1.0), clamp(COLOR.rgb / 0.55, vec3(0.0), vec3(1.6)), a);
	ALPHA = 1.0;"""

func _initialize(): call_deferred("run")
func run():
	var record: String = OS.get_cmdline_user_args()[0]
	var shader: Shader = load(PATH)
	if shader.code.contains(MARK): print("Decal light: already repaired"); quit(); return
	var eol := "\r\n" if shader.code.contains("\r\n") else "\n"
	var old := OLD.replace("\n", eol); var new := NEW.replace("\n", eol)
	if not shader.code.contains(old) or not shader.code.contains(OLD_MODE): push_error("Decal light: the shader changed; review the hook"); quit(1); return
	DirAccess.make_dir_recursive_absolute(record + "/original-resources")
	var backup := record + "/original-resources/" + PATH.get_file()
	if FileAccess.file_exists(backup): push_error("Decal light: a backup exists already: " + backup); quit(1); return
	DirAccess.copy_absolute(ProjectSettings.globalize_path(PATH), backup)
	shader.code = shader.code.replace(OLD_MODE, NEW_MODE).replace(old, new)
	if ResourceSaver.save(shader, PATH, ResourceSaver.FLAG_COMPRESS) != OK: push_error("Decal light: could not save"); quit(1); return
	var back: Shader = ResourceLoader.load(PATH, "", ResourceLoader.CACHE_MODE_IGNORE)
	if not back.code.contains(MARK) or not back.code.contains(NEW_MODE): push_error("Decal light: reload differs"); quit(1); return
	print("Decal light repaired: ", PATH, " (original in ", backup, ")")
	quit()

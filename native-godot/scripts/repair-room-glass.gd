extends SceneTree
# Issue #161: the rooms' window glass (one baked shader, 39 materials: the Vleeshuis, the Oostershuis, the prison, the
# shops' and taverns' rooms) was unshaded: its leaded panes kept their midday grey all night, a pale diamond pattern on a
# dark front. Now the glass takes the sky's light (psx_fill: 1 at the baked midday) and mirrors the sky and the ground at
# a glancing view (Fresnel), so it is dark at night and catches the sky by day. The same shader resource, no new kind.
# Usage: godot --headless --path . -s scripts/repair-room-glass.gd -- <record folder>
# The original is copied to <record>/original-resources first and never overwritten; a second run changes nothing.
const PATH := "res://world/town/resources/r006245.res"
const MARK := "// Room glass follows the light"
const OLD := "\tALPHA = c.a;\n\tALBEDO = c.rgb * k3 + ad + halo;"
const NEW := """	// Room glass follows the light (#161): lit by the sky it faces, as dark as the night, the sky and the ground
	// mirrored at a glancing view; the lead stays dark (its texels are the opaque ones).
	float glass_cos = clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0);
	float glass_fresnel = 0.04 + 0.96 * pow(1.0 - glass_cos, 5.0);
	vec3 glass_n = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 glass_sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, reflect(rd, glass_n).y * 0.5 + 0.5);
	float glass_pane = 1.0 - smoothstep(0.35, 0.75, c.a / max(albedo.a, 1e-3));
	c.rgb *= clamp(psx_fill.rgb, vec3(0.0), vec3(1.5));
	ad += glass_sky * glass_fresnel * glass_pane * 0.85;
	ALPHA = clamp(c.a + glass_fresnel * glass_pane * 0.55, 0.0, 1.0);
	ALBEDO = c.rgb * k3 + ad + halo;"""

func _initialize(): call_deferred("run")
func run():
	var record:String=OS.get_cmdline_user_args()[0]
	var shader:Shader=load(PATH)
	if shader.code.contains(MARK): print("Room glass: already repaired"); quit(); return
	if not shader.code.contains(OLD) or not shader.code.contains("global uniform vec4 psx_fill;"):
		push_error("Room glass: the shader changed; review the hook"); quit(1); return
	DirAccess.make_dir_recursive_absolute(record+"/original-resources")
	var backup:=record+"/original-resources/"+PATH.get_file()
	if FileAccess.file_exists(backup): push_error("Room glass: a backup exists already: "+backup); quit(1); return
	DirAccess.copy_absolute(ProjectSettings.globalize_path(PATH),backup)
	shader.code=shader.code.replace(OLD,NEW)
	if ResourceSaver.save(shader,PATH,ResourceSaver.FLAG_COMPRESS)!=OK: push_error("Room glass: could not save"); quit(1); return
	var back:Shader=ResourceLoader.load(PATH,"",ResourceLoader.CACHE_MODE_IGNORE)
	if not back.code.contains(MARK): push_error("Room glass: reload differs"); quit(1); return
	print("Room glass repaired: ",PATH," (original in ",backup,")")
	quit()

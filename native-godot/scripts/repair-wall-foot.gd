extends SceneTree
# Issue #171: the town houses' brick and plaster walls (material r000195, its shader embedded) drew one flat grime band
# at the foot of every house: its foot_wear was 0, so the band ignored the house's wear (the vertex colour's alpha), and
# it ran evenly along every wall. Beside the dressed stone, whose damp follows the house's wear, it read as a pasted band.
# Now the damp rises with the house's wear (low on a kept house, high on a poor one), comes and goes along the wall, is
# mottled inside and ragged at its top. The same material resource and shader, no new kind.
# Usage: godot --headless --path . -s scripts/repair-wall-foot.gd -- <record folder>
# The original is copied to <record>/original-resources first and never overwritten; a second run changes nothing.
const PATH := "res://world/town/resources/r000195.res"
const MARK := "// #171: no flat band"
const OLD := """	float top = mix(0.55, 1.4, clamp(a, 0.0, 1.0)) + 0.22 * (pud_val(vec2(s / 1.6, 3.1)) - 0.5) + 0.1 * (pud_val(vec2(s / 0.37, 7.7)) - 0.5);
	float damp = 1.0 - smoothstep(top - 0.2, top, y);"""
const NEW := """	// #171: no flat band: the damp rises higher on a worn house than on a kept one, comes and goes along the wall (a
	// sheltered stretch, a leaking downpipe), mottled inside and ragged at the top
	float top = mix(0.35, 1.25, clamp(a, 0.0, 1.0)) + 0.22 * (pud_val(vec2(s / 1.6, 3.1)) - 0.5) + 0.1 * (pud_val(vec2(s / 0.37, 7.7)) - 0.5) + 0.05 * (pud_val(vec2(s / 0.11, 1.9)) - 0.5);
	float stretch = mix(0.45, 1.0, smoothstep(0.25, 0.75, pud_val(vec2(s / 4.0, 9.1))));
	float damp = clamp((1.0 - smoothstep(top - 0.25, top, y)) * stretch * (0.7 + 0.6 * pud_val(vec2(s / 0.45, y / 0.32) + 2.3)), 0.0, 1.0);"""

func _initialize(): call_deferred("run")
func run():
	var record:String=OS.get_cmdline_user_args()[0]
	var material:ShaderMaterial=load(PATH)
	var shader:Shader=material.shader
	if shader.code.contains(MARK): print("Wall foot: already repaired"); quit(); return
	# (the baked shader keeps Windows line ends)
	var eol:="\r\n" if shader.code.contains("\r\n") else "\n"
	var old:=OLD.replace("\n",eol); var new:=NEW.replace("\n",eol)
	if not shader.code.contains(old): push_error("Wall foot: the shader changed; review the hook"); quit(1); return
	DirAccess.make_dir_recursive_absolute(record+"/original-resources")
	var backup:=record+"/original-resources/"+PATH.get_file()
	if FileAccess.file_exists(backup): push_error("Wall foot: a backup exists already: "+backup); quit(1); return
	DirAccess.copy_absolute(ProjectSettings.globalize_path(PATH),backup)
	shader.code=shader.code.replace(old,new)
	# the band follows the house's wear: 1.25 x (0.25 + 0.9 x wear), as the stone's does
	material.set_shader_parameter("foot_wear",1.0)
	if ResourceSaver.save(material,PATH,ResourceSaver.FLAG_COMPRESS)!=OK: push_error("Wall foot: could not save"); quit(1); return
	var back:ShaderMaterial=ResourceLoader.load(PATH,"",ResourceLoader.CACHE_MODE_IGNORE)
	if not back.shader.code.contains(MARK) or back.get_shader_parameter("foot_wear")!=1.0: push_error("Wall foot: reload differs"); quit(1); return
	print("Wall foot repaired: ",PATH," (original in ",backup,")")
	quit()

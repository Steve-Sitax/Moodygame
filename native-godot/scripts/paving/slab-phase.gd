extends SceneTree
# Gutters one course wide: the town blocks' old stone (r000209) reads each face's uv as the place of its courses
# (slab_turn 2, Psx slab block). Run once after gutter_courses.py's candidate is installed. Keeps a copy first.
# godot --headless --path native-godot --script res://scripts/paving/slab-phase.gd -- <backup folder>
const MAT := "res://world/town/resources/r000209.res"
func _initialize():
	var backup: String = OS.get_cmdline_user_args()[0]
	DirAccess.make_dir_recursive_absolute(backup)
	var copy := backup + "/" + MAT.get_file()
	if FileAccess.file_exists(copy): push_error("A backup exists already: " + copy); quit(1); return
	DirAccess.copy_absolute(ProjectSettings.globalize_path(MAT), copy)
	var m: ShaderMaterial = load(MAT)
	m.set_shader_parameter("slab_turn", 2.0)
	if ResourceSaver.save(m, MAT, ResourceSaver.FLAG_COMPRESS) != OK: push_error("save failed"); quit(1); return
	var back: ShaderMaterial = ResourceLoader.load(MAT, "", ResourceLoader.CACHE_MODE_IGNORE)
	print("slab_turn now ", back.get_shader_parameter("slab_turn"))
	quit()

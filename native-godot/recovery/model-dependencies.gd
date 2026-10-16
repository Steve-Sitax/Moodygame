extends SceneTree

# Authoring only (scripts/replace-ferry.ps1): which stored resources a model's scene reaches, so the ones a replaced
# model leaves behind can go. Writes a JSON list of the res:// files under assets/game-models/resources/.
#   godot --headless --path <project> --script res://recovery/model-dependencies.gd -- <scene.scn> <out.json>
#   godot --headless --path <project> --script res://recovery/model-dependencies.gd -- --except <scene.scn> <out.json>
# The second form is what every other stored scene reaches.
const SHARED := "res://assets/game-models/resources/"

func _target(dep: String) -> String:
	var parts := dep.split("::")
	for part in parts:
		if part.begins_with("res://"):
			return part
	for part in parts:
		if part.begins_with("uid://"):
			var id := ResourceUID.text_to_id(part)
			if ResourceUID.has_id(id):
				return ResourceUID.get_id_path(id)
	return ""

func _reach(path: String, seen: Dictionary) -> void:
	if seen.has(path):
		return
	seen[path] = true
	for dep in ResourceLoader.get_dependencies(path):
		var target := _target(dep)
		if target != "":
			_reach(target, seen)

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var except := args.size() > 0 and args[0] == "--except"
	if except:
		args.remove_at(0)
	if args.size() != 2:
		push_error("usage: model-dependencies.gd -- [--except] <scene.scn> <out.json>")
		quit(1)
		return
	var scene := args[0]
	var seen := {}
	if except:
		var dir := DirAccess.open("res://assets/game-models")
		for file in dir.get_files():
			if file.ends_with(".scn") and "res://assets/game-models/" + file != scene:
				_reach("res://assets/game-models/" + file, seen)
	else:
		_reach(scene, seen)
	var list: Array = []
	for path in seen.keys():
		if String(path).begins_with(SHARED):
			list.append(path)
	list.sort()
	var out := FileAccess.open(args[1], FileAccess.WRITE)
	out.store_string(JSON.stringify(list))
	out.close()
	quit(0)

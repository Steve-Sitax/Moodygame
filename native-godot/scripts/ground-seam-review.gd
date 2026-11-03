extends Node
# Review fixture only: expose any remaining ground gaps instead of hiding them behind the water backstop.
var elapsed := 0.0
func _process(delta):
	elapsed += delta
	if elapsed < 1.0: return
	elapsed = 0.0
	var nodes = get_tree().root.find_children("river_backstop", "MeshInstance3D", true, false)
	if nodes.is_empty(): return
	for node in nodes: node.visible = false
	print("ground-seam-review: water backstop hidden")
	set_process(false)

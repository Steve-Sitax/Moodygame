extends SceneTree

# Technical material assembly. Colour photographs remain in art-source; mortar masks
# are classified by material colour, never made by embossing stains or fossil flecks.
const DEST = "res://assets/materials/environment-20261013/"
const SOURCE = "res://../art-source/environment-20261013/"
var manifest: Array = []

func source(name: String) -> Image:
	return Image.load_from_file(ProjectSettings.globalize_path(SOURCE + name + ".png"))

func save_image(im: Image, name: String):
	assert(im.save_png(DEST + name + ".png") == OK)

func entry(id: String, name: String, height: String, strength: float):
	var row = {"material":"res://world/town/resources/" + id + ".res", "albedo":DEST + name + ".png"}
	if height != "":
		row["height"] = DEST + height + ".png"
		row["bumpScale"] = strength
	manifest.append(row)

func _initialize():
	DirAccess.make_dir_recursive_absolute(DEST)
	var brick = source("wall-brick-v2")
	save_image(brick, "wall-brick")
	var bh = Image.create_empty(brick.get_width(), brick.get_height(), false, Image.FORMAT_L8)
	for y in brick.get_height():
		for x in brick.get_width():
			var c = brick.get_pixel(x, y)
			# Neutral lime vs red clay: dark clay and soot remain on the brick plane.
			var clay = smoothstep(0.025, 0.075, c.r - c.g)
			bh.set_pixel(x, y, Color(clay, clay, clay))
	save_image(bh, "wall-brick-height")
	entry("r000630", "wall-brick", "wall-brick-height", 0.035)
	var iron = source("iron-v2")
	save_image(iron, "iron")
	# Broad oxidation is colour, not raised rust; retain only microscopic relief.
	var ih = Image.create_empty(512, 512, false, Image.FORMAT_L8)
	ih.fill(Color(0.5,0.5,0.5))
	save_image(ih, "iron-height")
	for id in ["r000615", "r000996", "r001215", "r001315", "r004606"]:
		entry(id, "iron", "iron-height", 0.0)
	var stone = source("stone")
	save_image(stone, "stair-stone")
	# Smooth worn stone: fossil colour is not surface displacement.
	save_image(ih, "stair-stone-height")
	entry("r000648", "stair-stone", "stair-stone-height", 0.0)
	entry("r009244", "stair-stone", "stair-stone-height", 0.0)
	# Preserve the existing 4x4 staggered block construction of the 2.4 m plinth.
	# Both maps use this one layout, with 5 mm recessed joints and 8 mm worn arrises.
	var size = 1536
	var plinth = Image.create_empty(size, size, false, Image.FORMAT_RGB8)
	var ph = Image.create_empty(size, size, false, Image.FORMAT_L8)
	for y in size:
		for x in size:
			var v = float(y) / size * 4.0
			var row = int(floor(v))
			var u = float(x) / size * 4.0 + 0.5 * (row % 2)
			var col = int(floor(u))
			var edge = min(min(fposmod(u,1.0),1.0-fposmod(u,1.0)), min(fposmod(v,1.0),1.0-fposmod(v,1.0)))
			var face = smoothstep(0.004, 0.018, edge)
			var sx = posmod(x + col * 211 + row * 83, stone.get_width())
			var sy = posmod(y + row * 277 + col * 97, stone.get_height())
			var c = stone.get_pixel(sx,sy) * (0.94 + 0.04 * sin(float(row*5+col*7)))
			c = c.lerp(Color(0.19,0.195,0.19), 1.0-face)
			plinth.set_pixel(x,y,c)
			ph.set_pixel(x,y,Color(face,face,face))
	save_image(plinth, "plinth")
	save_image(ph, "plinth-height")
	entry("r000642", "plinth", "plinth-height", 0.018)
	save_image(source("poster-source"), "chandler-poster")
	entry("r007346", "chandler-poster", "", 0)
	manifest[-1]["uvScale"] = [1.0,-1.0]
	var slate = source("slate-v3")
	save_image(slate, "slate")
	var sh = Image.create_empty(slate.get_width(), slate.get_height(), false, Image.FORMAT_L8)
	# Track the actual eight course boundaries. This is lap geometry, not an
	# emboss of the mineral colours. The top and bottom edges form one periodic lap.
	for x in slate.get_width():
		var boundaries: Array[int] = [0]
		for row in range(1,8):
			var expected = roundi(float(row) * slate.get_height() / 8.0)
			var best = expected
			var dark = 2.0
			for y in range(expected-10,expected+11):
				var c = slate.get_pixel(x,y)
				if c.get_luminance() < dark: dark=c.get_luminance(); best=y
			boundaries.append(best)
		boundaries.append(slate.get_height())
		for row in 8:
			for y in range(boundaries[row],boundaries[row+1]):
				var reveal = float(y-boundaries[row])/float(boundaries[row+1]-boundaries[row])
				var h = 0.25+0.65*reveal
				sh.set_pixel(x,y,Color(h,h,h))
	save_image(sh, "slate-height")
	for id in ["r000087","r000663","r000978","r001203","r001841"]:
		entry(id,"slate","slate-height",0.012)
	if FileAccess.file_exists(DEST+"house-roofs.png"):
		var rh = Image.create_empty(1024,1024,false,Image.FORMAT_L8)
		rh.fill(Color(0.5,0.5,0.5))
		var cell = sh.duplicate(); cell.resize(512,512,Image.INTERPOLATE_LANCZOS)
		rh.blit_rect(cell,Rect2i(0,0,512,512),Vector2i(512,0))
		save_image(rh,"house-roofs-height")
		entry("r000202","house-roofs","house-roofs-height",0.012)
	if FileAccess.file_exists(DEST+"debris.png"):
		# The relief from the former random pixel atlas is unrelated to the new
		# photographs. Solid debris already carries its shape in geometry.
		entry("r005570","debris","stair-stone-height",0.0)
	var file = FileAccess.open(DEST + "manifest.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(manifest, "\t"))
	print("Prepared ", manifest.size(), " material candidates; no live resource modified")
	quit()


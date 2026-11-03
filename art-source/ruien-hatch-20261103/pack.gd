extends SceneTree
# Pack the PhotoCraft-oriented existing owned wood into aligned runtime maps.
func _initialize():
 var col=Image.load_from_file("res://../art-source/ruien-hatch-20261103/oak.png")
 var w=col.get_width();var h=col.get_height()
 var blur=col.duplicate();blur.resize(32,96);blur.resize(w,h)
 var heights=PackedFloat32Array();heights.resize(w*h)
 for y in h:
  for x in w: heights[y*w+x]=clampf(.5+(col.get_pixel(x,y).get_luminance()-blur.get_pixel(x,y).get_luminance())*.7,0,1)
 var hra=Image.create(w,h,false,Image.FORMAT_RGB8)
 var normal=Image.create(w,h,false,Image.FORMAT_RGB8)
 for y in h:
  for x in w:
   var dx=(heights[y*w+(x+1)%w]-heights[y*w+(x+w-1)%w])*.002*w/4.0
   var dy=(heights[((y+1)%h)*w+x]-heights[((y+h-1)%h)*w+x])*.002*h/10.8
   var n=Vector3(-dx,-dy,1).normalized()
   normal.set_pixel(x,y,Color(n.x*.5+.5,n.y*.5+.5,n.z*.5+.5))
   hra.set_pixel(x,y,Color(heights[y*w+x],.82,1))
 for pair in [["albedo",col],["normal",normal],["hra",hra]]:
  pair[1].generate_mipmaps()
  ResourceSaver.save(ImageTexture.create_from_image(pair[1]),"res://world/ruien/textures/oak_hatch_"+pair[0]+".res",ResourceSaver.FLAG_COMPRESS)
 quit()

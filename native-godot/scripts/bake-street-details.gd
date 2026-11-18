extends SceneTree
## Author-time bake. Run with Godot --headless --path native-godot --script res://scripts/bake-street-details.gd.
## To re-typeset the paper, run kiosk-newspaper.py with a temporary PNG path and pass that path after --.
## The exposed timber edges have 2–4 mm bevels and stone sills 9 mm. Paper edges, folded petals,
## leaf tips and hidden mating backs stay thin. Window and door faces use the existing structural wall.
## All coordinates are local to the individual fitting. The surfaces and shapes are serialized before shipping.
const OUT = "res://assets/models/street-details/"
const TOWN = "res://world/town/resources/"
const NO_COLLISION = "native_near_detail_no_collision"
var detail = Node3D.new()
var rng = RandomNumberGenerator.new()
var surfaces = {}
var boxwood = []
var materials = {}
var bills = {}
var failed = false

func save_resource(res, path):
	var err = ResourceSaver.save(res, OUT + path, ResourceSaver.FLAG_COMPRESS)
	if err != OK:
		push_error("Cannot bake %s (%s)" % [path,err])
		failed = true

func part(n, label, p, parent = null):
	n.name = label
	(parent if parent else detail).add_child(n)
	n.owner = detail
	n.position = p
	return n

func surface(key):
	if not surfaces.has(key):
		var st = SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		st.set_material(materials[key])
		surfaces[key] = st
	return surfaces[key]

func tri(key, a, b, c, tint, uvs = []):
	var n = (b-a).cross(c-a).normalized()
	if n.length_squared() < 0.5: return
	var st = surface(key)
	var pts = [a,b,c]
	for i in [0,2,1]: # Godot draws clockwise front faces.
		var p = pts[i]
		st.set_normal(n)
		st.set_color(tint)
		st.set_uv(uvs[i] if uvs.size() else Vector2(p.x+p.z, -p.y))
		st.add_vertex(p)

func quad(key,a,b,c,d,tint,uvs = []):
	if uvs.size():
		tri(key,a,b,c,tint,[uvs[0],uvs[1],uvs[2]])
		tri(key,a,c,d,tint,[uvs[0],uvs[2],uvs[3]])
	else:
		tri(key,a,b,c,tint)
		tri(key,a,c,d,tint)

func take_mesh():
	var m = ArrayMesh.new()
	for key in surfaces:
		var st = surfaces[key]
		st.index()
		st.commit(m)
	surfaces.clear()
	return m

func finish(label, pos, angle = 0.0):
	var m=take_mesh()
	var node = part(MeshInstance3D.new(),label,pos)
	node.mesh = m
	node.rotation.y = angle
	node.set_meta(NO_COLLISION,true)
	return node

func v3(p, z):
	return Vector3(p.x,p.y,z)

# Clockwise or counterclockwise outline normalized to a face looking out along +Z.
# The offset intersection keeps even the long, thin rails from getting pointed bevels.
func prism(key, outline, back, front, bevel, tint):
	var o = PackedVector2Array(outline)
	if Geometry2D.is_polygon_clockwise(o): o.reverse()
	var inset = PackedVector2Array()
	for i in o.size():
		var a = (o[i]-o[(i+o.size()-1)%o.size()]).normalized()
		var b = (o[(i+1)%o.size()]-o[i]).normalized()
		var n0 = Vector2(-a.y,a.x)
		var n1 = Vector2(-b.y,b.x)
		inset.append(o[i]+(n0+n1)*bevel/maxf(.12,1+n0.dot(n1)))
	var ids = Geometry2D.triangulate_polygon(inset)
	if ids.is_empty():
		push_error("Unclosed %s face at %s" % [key, outline])
		failed = true
		return
	for i in range(0,ids.size(),3):
		var a=inset[ids[i]];var b=inset[ids[i+1]];var c=inset[ids[i+2]]
		tri(key,v3(a,front),v3(b,front),v3(c,front),tint)
		tri(key,v3(o[ids[i+2]],back),v3(o[ids[i+1]],back),v3(o[ids[i]],back),tint)
	for i in o.size():
		var j = (i+1)%o.size()
		quad(key,v3(o[i],back),v3(o[j],back),v3(o[j],front-bevel),v3(o[i],front-bevel),tint)
		quad(key,v3(o[i],front-bevel),v3(o[j],front-bevel),v3(inset[j],front),v3(inset[i],front),tint)

func rail(key,x0,y0,x1,y1,back,front,bevel,tint):
	prism(key,[Vector2(x0,y0),Vector2(x1,y0),Vector2(x1,y1),Vector2(x0,y1)],back,front,bevel,tint)

# Connected tube rings follow the centreline, including round-over at the ends.
func tube(key,points,radii,sides,tint):
	var loops = []
	var first = (points[1]-points[0]).normalized()
	var axis = Vector3.RIGHT if absf(first.x)<.8 else Vector3.BACK
	for i in points.size():
		var tangent = (points[mini(i+1,points.size()-1)]-points[maxi(i-1,0)]).normalized()
		var u = (axis-tangent*axis.dot(tangent)).normalized()
		var v = tangent.cross(u)
		var ring = []
		for j in sides:
			var a = TAU*j/sides
			ring.append(points[i]+radii[i]*(u*cos(a)+v*sin(a)))
		loops.append(ring)
	for i in loops.size()-1:
		for j in sides:
			var k = (j+1)%sides
			quad(key,loops[i][j],loops[i][k],loops[i+1][k],loops[i+1][j],tint)
	for j in range(1,sides-1):
		tri(key,loops[0][0],loops[0][j+1],loops[0][j],tint)
		tri(key,loops[-1][0],loops[-1][j],loops[-1][j+1],tint)

func profile(x,shape):
	x=absf(x)
	for i in range(1,shape.size()):
		if x<=shape[i].x: return remap(x,shape[i-1].x,shape[i].x,shape[i-1].y,shape[i].y)
	return shape[-1].y

func door(label, pos, angle, church, paint):
	var shape = [Vector2(0,5.85),Vector2(.788,5.331),Vector2(1.315,4.55),Vector2(1.5,3.625)] if church else [Vector2(0,3.3),Vector2(.486,3.242),Vector2(.944,3.072),Vector2(1.351,2.80)]
	var half = shape[-1].x
	var hinges = [.54,1.87,3.14] if church else [.38,1.36,2.52]
	# A rebated backing closes the V joints. A closed leaf cannot reveal plaster or daylight between its boards.
	var backing=[Vector2(-half,0.),Vector2(half,0.)]
	for k in range(shape.size()-1,-1,-1):backing.append(shape[k])
	for k in range(1,shape.size()):backing.append(Vector2(-shape[k].x,shape[k].y))
	prism("flat",backing,-.017,-.003,.001,Color("#362e26").srgb_to_linear())
	var metal = Color(.64,.58,.50) if church else Color(.24,.25,.23)
	var wood = "weathered_oak" if church else "paint"
	for sign_x in [-1,1]:
		for j in 8:
			var edge0=half*j/8+.002;var edge1=half*(j+1)/8-.002
			var lo=minf(sign_x*edge0,sign_x*edge1);var hi=maxf(sign_x*edge0,sign_x*edge1)
			var o=[Vector2(lo,.012),Vector2(hi,.012),Vector2(hi,profile(hi,shape))]
			var cuts=[]
			for k in shape:
				var x=sign_x*k.x
				if x>lo+.008 and x<hi-.008: cuts.append(x)
			cuts.sort();cuts.reverse()
			for x in cuts:o.append(Vector2(x,profile(x,shape)))
			o.append(Vector2(lo,profile(lo,shape)))
			prism(wood,o,-.01,.025+rng.randf_range(-.001,.001),.0035,paint*rng.randf_range(.84,1.08))
		if church:
			# Oak stiles and a foot rail carry each leaf. Their rounded edges catch daylight in the deep reveal.
			var left=0.031 if sign_x>0 else -half+.014
			var right=half-.014 if sign_x>0 else -.031
			var edge=right if sign_x>0 else left
			rail(wood,left,.045,right,.185,.026,.052,.004,paint*.93)
			var inner=edge-.066*sign_x
			prism(wood,[Vector2(edge,.18),Vector2(inner,.18),Vector2(inner,profile(inner,shape)-.045),Vector2(edge,profile(edge,shape)-.045)],.025,.042,.003,paint)
		else:
			# Framed fields set behind the rails. The original green, brown or blue paint stays with each bay.
			var lo = minf(sign_x*.085,sign_x*(half-.095))
			var hi = maxf(sign_x*.085,sign_x*(half-.095))
			for interval in [[.50,1.26],[1.48,2.41]]:
				var y0 = interval[0]
				var y1 = interval[1]
				var bead = .052
				var edge = paint*1.06
				rail("paint",lo,y0,lo+bead,y1,.025,.049,.004,edge)
				rail("paint",hi-bead,y0,hi,y1,.025,.049,.004,edge)
				rail("paint",lo+bead,y0,hi-bead,y0+bead,.025,.049,.004,edge)
				rail("paint",lo+bead,y1-bead,hi-bead,y1,.025,.049,.004,edge)
		for y in hinges:
			var h=half-.036
			var tip=.22 if church else .35
			var bar=[Vector2(h,y-.035),Vector2(tip+.08,y-.025),Vector2(tip+.045,y-.055),Vector2(tip-.016,y),Vector2(tip+.045,y+.055),Vector2(tip+.08,y+.025),Vector2(h,y+.035)]
			for i in bar.size():bar[i].x*=sign_x
			prism("iron",bar,.025,.043,.002,metal)
			var ax=sign_x*(half-.048)
			tube("iron",[Vector3(ax,y-.083,.051),Vector3(ax,y+.083,.051)],[.024,.024],10,metal)
			for j in 5:
				var x=sign_x*lerpf(tip+.12,h-.09,j/4.0)
				tube("iron",[Vector3(x,y,.041),Vector3(x,y,.052),Vector3(x,y,.055)],[.014,.012,.006],8,metal)
	rail(wood,-.025,.01,.027,shape[0].y-.045,.017,.043,.003,paint)
	for sign_x in [-1,1]:
		var x=sign_x*.145
		rail("iron",x-.041,1.02,x+.041,1.19,.029,.052,.003,metal)
		tube("iron",[Vector3(x,1.145,.05),Vector3(x,1.145,.104)],[.023,.020],10,metal)
		var loop=[];var radii=[]
		for i in 21:
			var t=TAU*i/20
			loop.append(Vector3(x+.049*sin(t),1.084+.062*cos(t),.096-.009*cos(t)));radii.append(.009)
		tube("iron",loop,radii,7,metal)
	finish(label,pos,angle)

func windows():
	var bay=(101.0384-94.38968)/2.
	for i in 2:
		var w=bay*40/64.+.045;var h=3.8*38/64.+.055
		var timber=Color("#bfb6a0").srgb_to_linear();var bottom=.688
		var glass=Color(.88,.95,1.)
		rail("flat",-w/2,0,w/2,h,-.004,.005,.002,Color(.039,.045,.043))
		# Two gathered lengths hang inside the glazing. The return at the tie and the hems cast their own shadows.
		for side in [-1,1]:
			var verts=[]
			for row in 7:
				var t=row/6.
				var width=(.20+.31*pow(absf(t-.42)*1.72,1.35))*(1. if side<0 else .84)
				var line=[]
				for j in 19:
					var u=j/18.
					var wave=cos(TAU*(u*4.5+.11*t+side*.09+i*.08))
					var x=side*(w*.5-.064-u*width)
					var y=lerpf(.16+.023*wave,h-.06,t)
					line.append(Vector3(x,y,.015+.0058*wave))
				verts.append(line)
			for row in 6:
				for j in 18:
					var points=[verts[row][j],verts[row][j+1],verts[row+1][j+1],verts[row+1][j]]
					if side>0:points.reverse()
					quad("linen",points[0],points[1],points[2],points[3],Color(.65,.62,.52))
		for col in 2:
			for row in 3:
				var x0=lerpf(-w*.5+.055,w*.5-.055,col/2.)
				var x1=lerpf(-w*.5+.055,w*.5-.055,(col+1)/2.)
				var y0=lerpf(.054,h-.054,row/3.);var y1=lerpf(.054,h-.054,(row+1)/3.)
				quad("glass",Vector3(x0,y0,.032),Vector3(x1,y0,.032),Vector3(x1,y1,.032),Vector3(x0,y1,.032),glass*rng.randf_range(.88,1),[Vector2(.10,.90),Vector2(.91,.90),Vector2(.91,.1),Vector2(.10,.1)])
		for x in [-w/2,w/2-.073]:rail("paint",x,0,x+.073,h,.005,.11,.003,timber)
		for y in [0,h-.073]:rail("paint",-w/2+.070,y,w/2-.070,y+.073,.032,.11,.003,timber)
		rail("paint",-.022,.072,.022,h-.072,.032,.081,.002,timber)
		for j in [1,2]:
			var y=h*j/3.
			rail("paint",-w/2+.072,y-.021,w/2-.072,y+.021,.032,.086,.002,timber)
		rail("stone",-w/2-.072,-.056,w/2+.072,.012,.004,.158,.009,Color(.74,.75,.72))
		finish("Laundry_sash_%d"%i,Vector3(-208.788,bottom,94.38968+bay*(i+.5)),PI/2)

func leaf(p, axis, wide, rise, tint):
	var side=Vector3(-axis.z,0,axis.x).normalized()*wide
	var tip=p+axis+Vector3.UP*rise
	var mid=p+axis*.53+Vector3.UP*(rise*.74)
	var ridge=mid+Vector3.UP*wide*.36
	var a=mid-side;var b=mid+side
	for f in [[p,b,ridge],[ridge,b,tip],[p,ridge,a],[a,ridge,tip]]:
		tri("flat",f[0],f[1],f[2],tint)
		tri("flat",f[2],f[1],f[0],tint*.87)

# Box leaves grow in opposite pairs. Their curved blades sit over the darker interior.
func box_leaf(p,dir,length,width,tone):
	var across=Vector3(-dir.z,0,dir.x).normalized()*width
	var end=p+dir*length
	var mid=p+dir*length*.49
	var tip=p+dir*length*.82
	var ridge=mid+Vector3.UP*width*.33
	var l=mid-across;var r=mid+across
	var l2=tip-across*.64;var r2=tip+across*.64
	for f in [[p,r,ridge],[p,ridge,l],[l,ridge,l2],[l2,ridge,end],[ridge,r,r2],[ridge,r2,end]]:
		tri("leaf",f[0],f[1],f[2],tone)

# Individual box plants fill the edging. Six irregular lobes per plant catch the side light;
# the smaller, separate leaves break up the outline from above and at ankle height.
func box_sprig(p,height,radius):
	var rings=[]
	var phase=rng.randf()*TAU
	var levels=[Vector2(.0,.29),Vector2(.30,.62),Vector2(.62,.68),Vector2(.77,.48),Vector2(.85,.13)]
	for level in levels:
		var points=[]
		for j in 9:
			var theta=phase+TAU*j/9
			var reach=radius*level.y*rng.randf_range(.85,1.06)
			points.append(p+Vector3(cos(theta)*reach,height*level.x+rng.randf_range(-.008,.008),sin(theta)*reach))
		rings.append(points)
	for i in range(1,rings.size()):
		for j in 9:
			var k=(j+1)%9
			var tone=Color("#424f30").srgb_to_linear()*rng.randf_range(.76,1.15)*(1.+i*.09)
			quad("flat",rings[i-1][j],rings[i][j],rings[i][k],rings[i-1][k],tone)
	for j in range(1,8):
		tri("flat",rings[-1][0],rings[-1][j+1],rings[-1][j],Color("#53633b").srgb_to_linear())

	for j in 23:
		var az=phase+j*2.39996
		var ny=rng.randf_range(-.29,1.)
		var direction=Vector3(cos(az)*sqrt(1.-ny*ny),ny,sin(az)*sqrt(1.-ny*ny))
		var start=p+Vector3.UP*height*.47+direction*Vector3(radius*.55,height*.30,radius*.55)
		for k in 3:
			var yaw=az+(k-1)*.77
			var aim=Vector3(cos(yaw),rng.randf_range(.12,.80),sin(yaw)).normalized()
			box_leaf(start+direction*k*.006,aim,rng.randf_range(.024,.042),rng.randf_range(.008,.013),
				Color("#58683e").srgb_to_linear()*rng.randf_range(.72,1.24))

func plant_edging(pos, radius, index):
	# Seven modelled plants are propagated around the six beds. Each bed keeps its own culling bounds.
	var batches=[]
	for model in boxwood:batches.append(PackedFloat32Array())
	for i in ceili(85*radius):
		var a=TAU*i/ceili(85*radius)+rng.randf_range(-.024,.024)
		var offset=Vector3(cos(a),0,sin(a))*radius*rng.randf_range(.87,.95)
		var size=rng.randf_range(.86,1.12)
		var b=Basis(Vector3.UP,rng.randf()*TAU).scaled(Vector3(size,rng.randf_range(.68,1.20),size))
		var k=i%boxwood.size()
		batches[k].append_array(PackedFloat32Array([
			b.x.x,b.y.x,b.z.x,offset.x, b.x.y,b.y.y,b.z.y,offset.y, b.x.z,b.y.z,b.z.z,offset.z]))
	for k in batches.size():
		var mm=MultiMesh.new()
		mm.transform_format=MultiMesh.TRANSFORM_3D
		mm.mesh=boxwood[k]
		mm.instance_count=batches[k].size()/12
		mm.buffer=batches[k]
		var node=part(MultiMeshInstance3D.new(),"Boxwood_%d_%d"%[index,k],pos)
		node.multimesh=mm
		node.set_meta(NO_COLLISION,true)

func bed(pos, r, index):
	var palette=[Color("#a85962"),Color("#b17b98"),Color("#dac8a5"),Color("#cc9353")]
	var green=Color("#687749").srgb_to_linear();var stem=Color("#68794b").srgb_to_linear()
	plant_edging(pos,r,index)
	# Plant in drifts. Stems fork from the same crown and the younger heads sit lower.
	for i in maxi(8,roundi(r*r*15)):
		var a=i*2.39996+rng.randf_range(-.23,.23)
		var d=.72*r*sqrt((i+.4)/maxf(8,round(r*r*15)))
		var crown=Vector3(cos(a)*d,.023,sin(a)*d)
		var colour=palette[(i/3+index)%palette.size()].srgb_to_linear()
		for j in rng.randi_range(4,7):
			var ph=rng.randf()*TAU;var dir=Vector3(cos(ph),0,sin(ph))
			var height=rng.randf_range(.24,.54)*(1.-.2*d/r)
			var head=crown+dir*rng.randf_range(.04,.17)+Vector3.UP*height
			var elbow=crown.lerp(head,.52)-dir*.014
			tube("flat",[crown,elbow,head],[.005,.0036,.0025],5,stem)
			for k in 5:
				var phi=ph+2.4*k
				var axis=Vector3(cos(phi),0,sin(phi))*rng.randf_range(.078,.137)
				leaf(crown.lerp(head,.16+.125*k),axis,.018,.027,green*rng.randf_range(.83,1.16))
			var rad=rng.randf_range(.032,.052)
			for k in 11:
				var phi=ph+k*TAU/11
				var axis=Vector3(cos(phi),0,sin(phi))*rad
				leaf(head,axis,rad*.24,rad*rng.randf_range(.10,.56),colour*rng.randf_range(.90,1.1))
			for k in 7:
				var phi=ph+(k+.3)*TAU/7
				leaf(head+Vector3.UP*.002,Vector3(cos(phi),0,sin(phi))*rad*.62,rad*.22,rad*.32,colour*1.13)
			tube("flat",[head,head+Vector3.UP*.006],[rad*.35,rad*.26],8,Color("#c29a4d"))
	finish("Flowerbed_%d"%index,pos)


func fountain():
	var water_shader=Shader.new()
	var insertion="""
	// Sky reflected by falling water and rings spreading from each landing.
	float d = length(abs(world.xz - vec2(20.0,296.0)) - vec2(.73));
	float rings = sin(d * 84.0 - psx_time * 8.5) * exp(-d*6.0);
	vec2 wind = vec2(sin(world.x*12. + world.z*7. + psx_time*1.2),
				sin(world.z*14. - world.x*5. - psx_time*.78));
	vec3 wn = normalize(nw + vec3(rings*.14+wind.x*.031,0.,rings*.11+wind.y*.026));
	float grazing = pow(1.0-clamp(dot(wn,-rd),0.,1.),2.5);
	float jet = step(.421,world.y)*(1.0-step(1.22,world.y));
	float glint = .5+.5*sin(world.y*66.+psx_time*8.0);
	ad += psx_hemi_sky.rgb * (.012 + .14*grazing + .034*abs(rings) + jet*(.069 + .15*glint));
	// At a steep angle the submerged stone shows through. The narrow jets catch the sky at their edges.
	ALPHA = mix(.51+.34*grazing,.79+.13*glint,jet);
"""
	water_shader.code=materials.flat.shader.code.replace("// the sky's light:",insertion+"\n\t// the sky's light:")
	var water=ShaderMaterial.new()
	water.shader=water_shader
	materials.water=water
	for settings in [[2.1,.4,PI/8],[.72,2.10,0.]]:
		var r=settings[0];var y=settings[1];var rot=settings[2]
		for i in 8:
			var a=i*TAU/8+rot;var b=(i+1)*TAU/8+rot
			tri("water",Vector3(0,y,0),Vector3(cos(b)*r,y,sin(b)*r),Vector3(cos(a)*r,y,sin(a)*r),Color("#394e4b").srgb_to_linear())
	for i in 4:
		var a=PI/4+i*PI/2
		var dir=Vector3(cos(a),0,sin(a))
		var pts=[];var radii=[]
		for k in 17:
			var t=k/16.
			pts.append(dir*(.616+.418*t)+Vector3.UP*(1.2-.03*t-.77*t*t))
			radii.append(lerpf(.021,.013,t))
		tube("water",pts,radii,10,Color("#839794").srgb_to_linear())
		for j in 8:
			var theta=rng.randf()*TAU
			var drop=dir*1.034+Vector3(cos(theta)*.052,.412+rng.randf()*.035,sin(theta)*.052)
			tube("water",[drop,drop+Vector3.UP*.009,drop+Vector3.UP*.017],[.002,.005,.002],6,Color("#9dafa6").srgb_to_linear())
	finish("Fountain_water",Vector3(20,0,296))

func paper(key,x,y,w,h,z,rect,fold=0.):
	# Top of the printed sheet maps to the top of the typeset page.
	for k in 2:
		var t0=k*.5;var t1=t0+.5
		var z0=z+fold*(1-abs(2*t0-1));var z1=z+fold*(1-abs(2*t1-1))
		var u0=lerpf(rect[0],rect[2],t0);var u1=lerpf(rect[0],rect[2],t1)
		quad(key,Vector3(x+w*t0,y,z0),Vector3(x+w*t1,y,z1),Vector3(x+w*t1,y+h,z1),Vector3(x+w*t0,y+h,z0),Color.WHITE,
			[Vector2(u0,rect[3]),Vector2(u1,rect[3]),Vector2(u1,rect[1]),Vector2(u0,rect[1])])

func kiosk():
	var backing=Color("#45534a")
	for i in 6:
		var angle= -PI/2+i*PI/3
		var n=Vector3(sin(angle),0,cos(angle))
		var top=2.10 if i==0 else 2.40
		rail("deal",-.55,1.,.55,top,-.009,.01,.002,backing)
		for x in [-.511,.484]:rail("iron",x,1.02,x+.027,top-.019,.008,.029,.002,Color("#676c5b"))
		if i==0:
			# Slanted reading rack under the shutter, with three overlapping folded editions.
			for y in [1.07,1.53]:
				rail("oak",-.48,y-.032,.48,y,.011,.088,.003,Color("#ae9270"))
			for k in 3:
				var x=-.428+k*.27;var y=1.09+(.045 if k==1 else 0.)
				rail("flat",x,y,x+.315,y+.40,.039+k*.009,.048+k*.009,.001,Color("#c7bfa7"))
				paper("news",x,y,.315,.40,.050+k*.009,[0.,0.,1.,1.],.004)
			paper("news",-.30,1.55,.405,.52,.018,[0.,0.,1.,1.],.003)
			paper("news",.11,1.56,.268,.34,.023,[0.,0.,1.,1.],.004)
		else:
			var layout=[["redstar","lost"],["theatre","notice"],["sale","wanted"],["ground","notice"],["notice","lost"]][i-1]
			var doc=bills[layout[0]]
			var w=minf(.71,.99*doc.w/doc.h);var h=w*doc.h/doc.w
			paper("bills",-.45,1.28,w,h,.013,[doc.u0,doc.v0,doc.u1,doc.v1],.002)
			var small=bills[layout[1]]
			paper("bills",.15,1.08,.30,.30*small.h/small.w,.019,[small.u0,small.v0,small.u1,small.v1],.002)
		finish("Kiosk_panel_%d"%i,Vector3(14.4,0,296)+n*.954,angle)

	# The original mid-height poster and counter faces closed the kiosk on all six sides.
	var hull=ConvexPolygonShape3D.new()
	var points=PackedVector3Array()
	for y in [1.,2.4]:
		for i in 6:
			var phi=TAU*i/6+PI/6
			points.append(Vector3(cos(phi)*1.1,y,sin(phi)*1.1))
	hull.points=points
	var body=part(StaticBody3D.new(),"Kiosk_body",Vector3(14.4,0,296))
	body.collision_layer=1;body.collision_mask=0
	var shape=part(CollisionShape3D.new(),"Panel_band",Vector3.ZERO,body)
	shape.shape=hull

func headstones():
	var index=0
	var body=part(StaticBody3D.new(),"Headstone_collision",Vector3.ZERO)
	body.collision_layer=1;body.collision_mask=0
	for centre in [-111.9,-97.8]:
		for k in 3:
			index+=1
			var model=load("res://assets/models/churchyard/headstone_%d.res"%index)
			var bounds=model.get_aabb()
			var sz=Vector3([.70,.62,.66][k],[1.69,1.44,1.19][k],.196)
			var where=Vector3(centre+[-.75,.05,.8][k],0,334.17+.02*k)
			var node=part(MeshInstance3D.new(),"Headstone_%d"%index,where)
			node.mesh=model;node.set_meta(NO_COLLISION,true)
			node.scale=Vector3(sz.x/bounds.size.x,sz.y/bounds.end.y,sz.z/bounds.size.z)
			var collider=part(CollisionShape3D.new(),"Stone_%d"%index,where+Vector3(0,sz.y*.48,0),body)
			var box=BoxShape3D.new();box.size=sz*Vector3(.98,.96,.92)
			collider.shape=box

func preserved_atlas():
	# The far side of the square also contains enamel on the urinal. Retain its exact original faces and material.
	var original=load(TOWN+"r001334.res")
	var arr=original.surface_get_arrays(0)
	var keep=PackedInt32Array()
	var ids=arr[Mesh.ARRAY_INDEX];var vs=arr[Mesh.ARRAY_VERTEX]
	for i in range(0,ids.size(),3):
		if vs[ids[i]].x>20.:keep.append_array(ids.slice(i,i+3))
	arr[Mesh.ARRAY_INDEX]=keep
	var mesh=ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arr)
	mesh.surface_set_material(0,original.surface_get_material(0))
	save_resource(mesh,"rond-enamel.res")

# This facade shader is embedded in the native material. Only replace its plaster mask;
# all other uniforms, inputs, geometry cache sources and material dependencies stay intact.
func bake_plaster():
	var path=TOWN+"r000195.res"
	var mat=load(path)
	var code=mat.shader.code
	var begin=code.find("vec2 g_warp =")
	if begin<0:begin=code.find("vec2 g_wp =")
	var end=code.find("vec3 g_brick =",begin)
	if begin<0 or end<=begin:
		push_error("Cannot locate the native facade plaster mask");failed=true;return
	var mask="""vec2 g_warp = vec2(g_val(g_w * 2.1), g_val(g_w * 2.1 + 7.3)) - 0.5;

					vec2 g_wp = g_w + g_warp * 0.18;

					vec2 g_patch = g_wp / vec2(1.25, 0.68) + 0.21;

					float g_m = g_fbm(g_patch) + 0.025 * (g_val(g_wp * 16.0) - 0.5);

					float g_mu = g_fbm(g_patch + vec2(0.0, 0.048));

					float g_low = 1.0 - smoothstep(0.35, 2.4, world.y);

					float g_thr = 0.80 - 0.035 * (g_wear - 0.55) / 0.45 - 0.12 * g_low;

					float g_edge = max(0.012, fwidth(g_m));

					float g_off = smoothstep(g_thr - g_edge, g_thr + g_edge, g_m);

					float g_rim = smoothstep(g_thr - 0.023 - g_edge, g_thr - 0.023 + g_edge, g_m) - g_off;
					"""
	var next=code.left(begin)+mask+code.substr(end)
	if next!=code:
		mat.shader.code=next
		if ResourceSaver.save(mat,path,ResourceSaver.FLAG_COMPRESS)!=OK:failed=true

func _init():
	bake_plaster()
	rng.seed=18731113
	detail.name="Street_fittings"
	var flat=ShaderMaterial.new()
	flat.shader=load(TOWN+"r004447.res")
	flat.set_shader_parameter("affine",0.)
	materials={"flat":flat,"oak":load("res://assets/market-joinery/market_joinery_oak.res"),
		"deal":load("res://assets/market-joinery/market_joinery_deal.res"),
		"iron":load("res://assets/materials/churchyard-20261027/churchyard-iron.tres"),
		"stone":load(TOWN+"r001008.res"),
		"bills":load("res://assets/materials/bill-posters-20261102/bills.tres")}
	# A pigmented wash over the timber leaves the original height map and broad wood pores visible.
	var paint=materials.deal.duplicate()
	var paint_shader=Shader.new()
	paint_shader.code=paint.shader.code.replace("c *= albedo;", "c.rgb = vec3(.64 + .36 * smoothstep(.035,.52,dot(c.rgb,vec3(.25,.56,.19))));")
	paint.shader=paint_shader
	materials.paint=paint
	var aged_oak=materials.oak.duplicate()
	var aged_shader=Shader.new()
	aged_shader.code=aged_oak.shader.code.replace("c *= albedo;", "c.rgb = 0.80*sqrt(c.rgb) + vec3(.038,.030,.022); c *= albedo;")
	aged_oak.shader=aged_shader
	materials.weathered_oak=aged_oak
	materials.linen=load("res://assets/materials/town-shops-20261018/shop-cloth.tres")
	var leaf_mat=flat.duplicate()
	var leaf_shader=Shader.new()
	leaf_shader.code=flat.shader.code.replace("render_mode specular_disabled", "render_mode cull_disabled, specular_disabled")
	leaf_mat.shader=leaf_shader
	materials.leaf=leaf_mat
	# Uneven cylinder glass reflects a sliver of sky across the six individual panes.
	# The opaque backing closes the room behind its curtains.
	var glass=flat.duplicate();var glass_shader=Shader.new()
	var glass_light="""
		float waves = .015*sin(uv.y*15.+uv.x*8.)+.010*sin(uv.y*29.-uv.x*3.);
		vec3 reflected = reflect(rd,normalize(nw+vec3(.0,waves,waves*.55)));
		float skyline = smoothstep(-.11,.24,reflected.y+waves);
		float fresnel = pow(1.-clamp(dot(nw,-rd),0.,1.),3.);
		ad += psx_hemi_sky.rgb*(.028 + .16*skyline + .12*fresnel);
		c.rgb *= vec3(.063,.083,.078);
		ALPHA = .39 + .24*fresnel;
	"""
	glass_shader.code=flat.shader.code.replace("// the sky's light:",glass_light+"\n\t// the sky's light:")
	glass.shader=glass_shader
	materials.glass=glass
	var args=OS.get_cmdline_user_args()
	if args.size():
		var img=Image.load_from_file(args[0])
		if img==null or img.is_empty():quit(1);return
		img.generate_mipmaps()
		save_resource(ImageTexture.create_from_image(img),"newspaper.res")
	var print_mat=flat.duplicate()
	print_mat.set_shader_parameter("tex",load(OUT+"newspaper.res"))
	materials.news=print_mat
	for row in JSON.parse_string(FileAccess.get_file_as_string("res://assets/materials/bill-posters-20261102/bills.json")):
		bills[row.id]=row
	door("Jacob_south_door",Vector3(-106.47,.15,331.814),0.,true,Color(.92,.85,.75))
	var colours=[Color("#6e6053").srgb_to_linear(),Color("#667567").srgb_to_linear(),Color("#76868c").srgb_to_linear()]
	var gates=[52.5,61.5,70.5,79.5,88.5,97.5,106.5]
	for i in gates.size():
		door("Entrepot_gate_%d"%i,Vector3(176.193,0,gates[i]),-PI/2,false,colours[[1,1,1,2,0,0,2][i]])
	windows()
	for k in 7:
		box_sprig(Vector3.ZERO,.165,.086)
		boxwood.append(take_mesh())
	var idx=0
	for green in JSON.parse_string(FileAccess.get_file_as_string("res://world/data/shared/townplaces.json")).greens:
		for b in green.beds:
			bed(Vector3(b.c[0],0,b.c[1]),b.r,idx);idx+=1
	headstones()
	fountain()
	kiosk()
	preserved_atlas()
	var scene=PackedScene.new()
	if scene.pack(detail)!=OK:failed=true
	else: save_resource(scene,"fittings.scn")
	detail.free()
	quit(1 if failed else 0)


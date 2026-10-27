extends RefCounted
## The churches' candle crowns (Steve, 2026-10-27): one design in three sizes, built face by face.
## A moulded brass ring (a beaded foot rail, a band pierced with quatrefoils, a cornice whose ledge carries the drip
## pans, a pointed cresting on its outer lip), a drip pan, turned socket and wax candle at every light (burnt down to
## different heights, runs of wax down their sides, a charred wick), and the hanging: chains of oval links to a
## suspension ring (the large crown) or a turned brass stem with a pendant ball (the small and the two-tier crown).
## Every part has its own UVs at true scale (metres / tile); vertex colour carries the cast recesses and the soot over
## the flames. Surfaces: 0 brass, 1 wax (the wicks too, black), 2 iron (hoist chains and hooks).

const BRASS := 0
const WAX := 1
const IRON := 2
const BRASS_TILE := 0.4
const WAX_TILE := 0.2
const IRON_TILE := 0.5

class Surf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var c := PackedColorArray()
	var idx := PackedInt32Array()
	func add(p: Vector3, nn: Vector3, t: Vector2, col: Color) -> int:
		v.append(p); n.append(nn.normalized()); uv.append(t); c.append(col)
		return v.size() - 1
	## One face, wound clockwise seen from the side its corners' normals face (the town's winding); none if degenerate.
	func tri(a: int, b: int, d: int) -> void:
		var cr := (v[b] - v[a]).cross(v[d] - v[a])
		if cr.length_squared() < 1e-14: return
		if cr.dot(n[a] + n[b] + n[d]) > 0.0:
			idx.append(a); idx.append(d); idx.append(b)
		else:
			idx.append(a); idx.append(b); idx.append(d)
	func quad(a: int, b: int, d: int, e: int) -> void:
		tri(a, b, d); tri(a, d, e)
	func tris() -> int: return idx.size() / 3

var s: Array[Surf] = [Surf.new(), Surf.new(), Surf.new()]
## Wick tips (crown space): where the flames sit.
var flames := PackedVector3Array()
var rng := RandomNumberGenerator.new()

func _init(seed_: int = 1873) -> void:
	rng.seed = seed_

## Soot from the flames: darkens brass that faces up or sits above a flame, near it.
func soot(p: Vector3, nn: Vector3) -> float:
	var k := 0.0
	for f in flames:
		var d := Vector2(p.x - f.x, p.z - f.z).length()
		var dy := p.y - (f.y - 0.04)
		if dy < -0.02: continue
		var up := clampf(nn.y * 0.7 + 0.3, 0.0, 1.0) if dy < 0.08 else 1.0
		k = maxf(k, up * exp(-pow(d / (0.05 + 0.25 * maxf(dy, 0.0)), 2.0)) * clampf(1.0 - dy / 1.2, 0.0, 1.0))
	return k

func shade(p: Vector3, nn: Vector3, ao: float) -> Color:
	var k := soot(p, nn)
	var a := 1.0 - (1.0 - ao) * 0.45
	var base := Color(a, a, a)
	return base.lerp(Color(0.16, 0.13, 0.10), k * 0.85)

## A turned part: profile points [r, y, hard] (counter-clockwise in the r/y plane: outward is to the right of the way
## the profile runs), revolved in `segs` steps about the y axis of `xf`. `ao` per profile point (or one value).
func lathe(surf: int, prof: Array, segs: int, xf: Transform3D, tile: float, ao = 1.0, use_soot := true, ang0 := 0.0) -> void:
	var S: Surf = s[surf]
	# expand hard corners into two points, each with its own segment's normal
	var pts: Array = []   # [r, y, nr, ny, vlen, ao]
	var vlen := 0.0
	var count := prof.size()
	for i in count:
		var p: Array = prof[i]
		if i > 0: vlen += Vector2(p[0], p[1]).distance_to(Vector2(prof[i - 1][0], prof[i - 1][1]))
		var a: float = ao[i] if ao is Array else ao
		var nprev := Vector2.ZERO
		var nnext := Vector2.ZERO
		if i > 0:
			var t := Vector2(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]).normalized()
			nprev = Vector2(t.y, -t.x)
		if i < count - 1:
			var t2 := Vector2(prof[i + 1][0] - p[0], prof[i + 1][1] - p[1]).normalized()
			nnext = Vector2(t2.y, -t2.x)
		var hard: bool = p.size() > 2 and p[2]
		if hard and i > 0 and i < count - 1:
			pts.append([p[0], p[1], nprev.x, nprev.y, vlen, a, true])
			pts.append([p[0], p[1], nnext.x, nnext.y, vlen, a, false])
		else:
			var nn := (nprev + nnext).normalized()
			pts.append([p[0], p[1], nn.x, nn.y, vlen, a, false])
	var rmean := 0.0
	for p in prof: rmean += p[0]
	rmean /= count
	var circ := TAU * rmean / tile
	var K := float(roundi(circ)) if circ >= 3.0 else circ
	var cols: Array = []
	for j in segs + 1:
		var th := ang0 + TAU * j / segs
		var cs := cos(th)
		var sn := sin(th)
		var col := PackedInt32Array()
		for p in pts:
			var lp := Vector3(p[0] * cs, p[1], p[0] * sn)
			var ln := Vector3(p[2] * cs, p[3], p[2] * sn)
			var wp := xf * lp
			var wn := (xf.basis * ln).normalized()
			var c := shade(wp, wn, p[5]) if use_soot else Color(p[5], p[5], p[5])
			col.append(S.add(wp, wn, Vector2(K * j / segs, p[4] / tile), c))
		cols.append(col)
	for j in segs:
		var a: PackedInt32Array = cols[j]
		var b: PackedInt32Array = cols[j + 1]
		for i in pts.size() - 1:
			if pts[i][6]: continue   # the gap between a hard corner's two copies
			S.quad(a[i], b[i], b[i + 1], a[i + 1])

## A round wire swept along a path (open or closed), `sides` faces, parallel-transported frames.
func tube(surf: int, path: PackedVector3Array, closed: bool, radius: float, sides: int, tile: float, ao := 1.0, rot := 0.0) -> void:
	var S: Surf = s[surf]
	var m := path.size()
	var tan := PackedVector3Array()
	for i in m:
		var a := path[(i - 1 + m) % m] if (closed or i > 0) else path[i]
		var b := path[(i + 1) % m] if (closed or i < m - 1) else path[i]
		tan.append((b - a).normalized())
	var up := Vector3.UP if absf(tan[0].y) < 0.9 else Vector3.RIGHT
	var nrm := (up - tan[0] * up.dot(tan[0])).normalized()
	var rings: Array = []
	var along := 0.0
	var count := m + 1 if closed else m
	for i in count:
		var k := i % m
		if i > 0:
			along += path[k].distance_to(path[(i - 1) % m])
			var t := tan[k]
			nrm = (nrm - t * nrm.dot(t)).normalized()
		var bin := tan[k].cross(nrm)
		var ring := PackedInt32Array()
		for j in sides + 1:
			var th := rot + TAU * j / sides
			var d := nrm * cos(th) + bin * sin(th)
			var p := path[k] + d * radius
			ring.append(S.add(p, d, Vector2(TAU * radius * j / sides / tile, along / tile), shade(p, d, ao) if surf == BRASS else Color(ao, ao, ao)))
		rings.append(ring)
	for i in count - 1:
		var a: PackedInt32Array = rings[i]
		var b: PackedInt32Array = rings[i + 1]
		for j in sides:
			S.quad(a[j], a[j + 1], b[j + 1], b[j])

## One oval chain link: outer length `L`, outer width `W`, wire `d`, centred on `c`, its long axis `ax`, its plane
## holding `side`.
func link(surf: int, c: Vector3, ax: Vector3, side: Vector3, L: float, W: float, d: float, per_end: int, sides: int, tile: float) -> void:
	var rr := (W - d) * 0.5
	var a := (L - W) * 0.5
	var path := PackedVector3Array()
	for e in 2:
		var sgn := 1.0 if e == 0 else -1.0
		for k in per_end:
			var th := -PI * 0.5 + PI * k / (per_end - 1)
			path.append(c + ax * sgn * (a + rr * cos(th)) + side * sgn * rr * sin(th))
	tube(surf, path, true, d * 0.5, sides, tile, 1.0, PI / sides)

## A chain hanging straight from `a` to `b` (links alternate a quarter turn); returns the link count.
func chain(surf: int, a: Vector3, b: Vector3, L: float, W: float, d: float, per_end: int, sides: int, tile: float) -> int:
	var ax := (b - a).normalized()
	var len := a.distance_to(b)
	var pitch := L - 2.0 * d
	var count := maxi(1, roundi((len - 2.0 * d) / pitch))
	pitch = (len - 2.0 * d) / count if count > 0 else pitch
	var side0 := ax.cross(Vector3.UP if absf(ax.y) < 0.9 else Vector3.RIGHT).normalized()
	var side1 := ax.cross(side0).normalized()
	for i in count:
		var centre := a + ax * (d + pitch * (i + 0.5))
		link(surf, centre, ax, side0 if i % 2 == 0 else side1, pitch + 2.0 * d, W, d, per_end, sides, tile)
	return count

## A ring's open face (a sheet): its front at radius r + t/2, back at r - t/2, pierced with quatrefoils, cell by cell.
## Cells are `w` metres of arc wide, `y0`..`y1` high; one quatrefoil (four circles through its centre) per cell.
func pierced_band(R: float, t: float, y0: float, y1: float, cells: int, ang0: float, a: float) -> void:
	var S: Surf = s[BRASS]
	var w := TAU * R / cells
	var h := y1 - y0
	# (24 points from 45 degrees: every lobe's tip and every cusp is a corner, so no lobe ends in a flat cap)
	var M := 24
	for ci in cells:
		var s0 := ci * w
		var sc := s0 + w * 0.5
		var yc := y0 + h * 0.5
		var hole: Array = []
		var rect: Array = []
		for k in M:
			var th := deg_to_rad(45.0 + 360.0 * k / M)
			var u := Vector2(cos(th), sin(th))
			# ray against four circles of radius a/2 centred a/2 out on the axes
			var best := 0.0
			for q in 4:
				var e := Vector2(cos(q * PI * 0.5), sin(q * PI * 0.5)) * a * 0.5
				var b := u.dot(e)
				var disc := b * b - (e.length_squared() - a * a * 0.25)
				if disc >= 0.0: best = maxf(best, b + sqrt(disc))
			hole.append(Vector2(sc, yc) + u * best)
			# the same ray against the cell's edge; the corner itself where the ray passes nearest to it
			var tx := (w * 0.5) / maxf(absf(u.x), 1e-6)
			var ty := (h * 0.5) / maxf(absf(u.y), 1e-6)
			rect.append(Vector2(sc, yc) + u * minf(tx, ty))
		for cx in [-1.0, 1.0]:
			for cy in [-1.0, 1.0]:
				var corner := Vector2(sc + cx * w * 0.5, yc + cy * h * 0.5)
				var ca := fposmod(rad_to_deg((corner - Vector2(sc, yc)).angle()), 360.0)
				var bestk := 0
				var bestd := 999.0
				for k in M:
					var kd := absf(angle_difference(deg_to_rad(ca), deg_to_rad(45.0 + 360.0 * k / M)))
					if kd < bestd: bestd = kd; bestk = k
				rect[bestk] = corner
		var P := func(q: Vector2, rr: float) -> Vector3:
			var th := ang0 + q.x / R
			return Vector3(rr * cos(th), q.y, rr * sin(th))
		for side: float in [1.0, -1.0]:
			var rr := R + side * t * 0.5
			var hi := PackedInt32Array()
			var ri := PackedInt32Array()
			for k in M:
				var hp: Vector3 = P.call(hole[k], rr)
				var rp: Vector3 = P.call(rect[k], rr)
				var nh := Vector3(hp.x, 0, hp.z).normalized() * side
				var nr := Vector3(rp.x, 0, rp.z).normalized() * side
				var ao := 1.0 if side > 0 else 0.82
				hi.append(S.add(hp, nh, hole[k] / BRASS_TILE, shade(hp, nh, ao)))
				ri.append(S.add(rp, nr, rect[k] / BRASS_TILE, shade(rp, nr, ao)))
			for k in M:
				var k2 := (k + 1) % M
				S.quad(hi[k], hi[k2], ri[k2], ri[k])
		# the pierced holes' walls (the sheet's thickness), facing into the hole
		var per := 0.0
		var wi: Array = []
		for k in M + 1:
			var q: Vector2 = hole[k % M]
			if k > 0: per += q.distance_to(hole[k - 1])
			var inward := (Vector2(sc, yc) - q).normalized()
			var fo: Vector3 = P.call(q, R + t * 0.5)
			var ba: Vector3 = P.call(q, R - t * 0.5)
			var tang := Vector3(-sin(ang0 + q.x / R), 0, cos(ang0 + q.x / R))
			var nn := (tang * inward.x + Vector3.UP * inward.y).normalized()
			wi.append([S.add(fo, nn, Vector2(per / BRASS_TILE, 0), shade(fo, nn, 0.8)), S.add(ba, nn, Vector2(per / BRASS_TILE, t / BRASS_TILE), shade(ba, nn, 0.8))])
		for k in M:
			S.quad(wi[k][0], wi[k + 1][0], wi[k + 1][1], wi[k][1])

## The cresting on the cornice's outer lip: a 3 mm sheet cut to pointed trefoil tips, `period` metres of arc each.
func cresting(R: float, y: float, period: float) -> void:
	var S: Surf = s[BRASS]
	var units := maxi(8, roundi(TAU * R / period))
	var outline := [Vector2(0.0, 0.008), Vector2(0.33, 0.010), Vector2(0.37, 0.024), Vector2(0.44, 0.029), Vector2(0.5, 0.042), Vector2(0.56, 0.029), Vector2(0.63, 0.024), Vector2(0.67, 0.010)]
	var t := 0.003
	var pts: Array = []
	for u in units:
		for o in outline:
			pts.append(Vector2((u + o.x) / units, o.y))
	pts.append(Vector2(1.0, outline[0].y))
	var tops: Array = []
	for side: float in [1.0, -1.0]:
		var rr := R + side * t * 0.5
		var prev := PackedInt32Array()
		for i in pts.size():
			var th: float = TAU * pts[i].x
			var nn := Vector3(cos(th), 0, sin(th)) * side
			var arc: float = pts[i].x * TAU * R
			var pb := Vector3(rr * cos(th), y, rr * sin(th))
			var pt := Vector3(rr * cos(th), y + pts[i].y, rr * sin(th))
			var cur := PackedInt32Array([S.add(pb, nn, Vector2(arc, 0) / BRASS_TILE, shade(pb, nn, 0.8)), S.add(pt, nn, Vector2(arc, pts[i].y) / BRASS_TILE, shade(pt, nn, 1.0))])
			if i > 0: S.quad(prev[0], cur[0], cur[1], prev[1])
			prev = cur
			if side > 0: tops.append(pt)
	# the cut edge along the top
	for i in pts.size() - 1:
		var a: Vector3 = tops[i]
		var b: Vector3 = tops[i + 1]
		var radial := Vector3(a.x, 0, a.z).normalized()
		var along := (b - a).normalized()
		var nn := along.cross(radial).normalized()
		if nn.y < 0: nn = -nn
		var arc := TAU * R * float(i) / pts.size()
		var i0 := S.add(a, nn, Vector2(arc, 0) / BRASS_TILE, shade(a, nn, 1.0))
		var i1 := S.add(b, nn, Vector2(arc + a.distance_to(b), 0) / BRASS_TILE, shade(b, nn, 1.0))
		var i2 := S.add(b - radial * t, nn, Vector2(arc + a.distance_to(b), t) / BRASS_TILE, shade(b, nn, 1.0))
		var i3 := S.add(a - radial * t, nn, Vector2(arc, t) / BRASS_TILE, shade(a, nn, 1.0))
		S.quad(i0, i1, i2, i3)

## How high a pan's stem lifts it off the ledge, and where a light's flame sits over the ledge.
const LIFT := 0.032
static func flame_y(ledge: float, h: float) -> float:
	return ledge + LIFT + 0.060 + h + 0.006

## One light: drip pan, turned socket, a candle burnt to `h` with runs of wax, its wick. `at` is the pan's foot.
func light(at: Vector3, h: float, rc: float) -> void:
	# a short turned stem with a knop lifts the pan off the ledge
	lathe(BRASS, [[0.017, 0.0], [0.018, 0.004], [0.011, 0.009], [0.008, 0.013], [0.013, 0.018], [0.013, 0.021], [0.008, 0.026], [0.010, LIFT - 0.003], [0.0, LIFT]], 10, Transform3D(Basis.IDENTITY, at), BRASS_TILE, [0.6, 0.8, 0.7, 0.75, 1.0, 1.0, 0.75, 0.8, 0.8])
	at += Vector3(0, LIFT, 0)
	var xf := Transform3D(Basis.IDENTITY, at)
	var socket_top := 0.008 + 0.064
	var base := socket_top - 0.012
	var tip := at + Vector3(0, base + h + 0.006, 0)
	flames.append(tip)
	# drip pan: a shallow dish with a rolled rim
	lathe(BRASS, [[0.0, -0.005], [0.030, -0.005], [0.047, 0.003], [0.051, 0.010], [0.047, 0.012], [0.036, 0.005], [0.0, 0.003]], 12, xf, BRASS_TILE, [0.85, 0.8, 0.9, 1.0, 0.95, 0.75, 0.7])
	# socket: a turned cup with a bead at its foot and a lip
	lathe(BRASS, [[0.018, 0.002], [0.021, 0.010], [0.016, 0.020], [0.0145, 0.058], [0.0185, 0.066], [0.017, socket_top], [rc + 0.0005, socket_top]], 10, xf, BRASS_TILE, [0.8, 1.0, 0.75, 0.85, 1.0, 0.9, 0.6])
	# the candle: tapering wax, the top melted into a shallow cup, runs of wax from the rim
	var runs: Array = []
	for r in rng.randi_range(1, 3):
		runs.append([rng.randf() * TAU, rng.randf_range(0.25, 0.85) * h, rng.randf_range(0.0018, 0.0028)])
	var sides := 10
	var rows := [0.0, 0.15, 0.35, 0.55, 0.72, 0.86, 0.95, 1.0]
	var S: Surf = s[WAX]
	var grid: Array = []
	for j in sides + 1:
		var th := TAU * j / sides
		var col := PackedInt32Array()
		for ri in rows.size():
			var y: float = rows[ri] * h
			var r: float = rc * (1.0 - 0.07 * rows[ri])
			var bump := 0.0
			for run in runs:
				var dth := absf(angle_difference(th, run[0]))
				var from_top := h - y
				if from_top <= run[1]:
					var end_blob := exp(-pow((from_top - run[1]) / 0.01, 2.0)) * 0.8
					bump = maxf(bump, run[2] * exp(-pow(dth / 0.32, 2.0)) * (0.7 + end_blob))
			# the rim swells a little where the wax overflowed
			if rows[ri] > 0.9: bump = maxf(bump, 0.0008)
			var p := Vector3(cos(th) * (r + bump), base + y, sin(th) * (r + bump))
			var nn := Vector3(cos(th), 0.07 * rc / h, sin(th))
			var tone := 1.0 + 0.06 * bump / 0.0025
			var c := Color(tone, tone, tone * 0.98)
			if rows[ri] >= 0.95: c = Color(0.93, 0.9, 0.84)
			col.append(S.add(xf * p, nn, Vector2(r * th / WAX_TILE, y / WAX_TILE), c))
		grid.append(col)
	for j in sides:
		for ri in rows.size() - 1:
			S.quad(grid[j][ri], grid[j + 1][ri], grid[j + 1][ri + 1], grid[j][ri + 1])
	# the melted top: rim, a shallow cup and the wick's foot
	var rtop: float = rc * 0.93
	lathe(WAX, [[rtop, base + h], [rtop * 0.8, base + h + 0.0015], [rtop * 0.55, base + h - 0.002], [0.0, base + h - 0.004]], sides, xf, WAX_TILE, [0.95, 0.92, 0.85, 0.85], false)
	# the wick: a charred twist, bent a little at the tip
	var wick := PackedVector3Array([xf * Vector3(0, base + h - 0.005, 0), xf * Vector3(0.0002, base + h + 0.002, 0), xf * Vector3(0.0008, base + h + 0.005, 0.0003), xf * Vector3(0.0016, base + h + 0.006, 0.0006)])
	var n0 := s[WAX].v.size()
	tube(WAX, wick, false, 0.0011, 4, WAX_TILE, 0.08)
	for i in range(n0, s[WAX].v.size()): s[WAX].c[i] = Color(0.13, 0.11, 0.09) if i - n0 < 10 else Color(0.06, 0.05, 0.04)

## The ring: foot rail, pierced band, cornice with its ledge and cresting; returns the ledge's height.
func ring(R: float, y0: float, band_h: float, cells: int, ang0: float, straps: int, hole: float, t: float) -> float:
	var xf := Transform3D(Basis.IDENTITY, Vector3(0, y0, 0))
	# foot rail: a bead under a fillet, closed (the band stands on its top)
	var foot := [[R - 0.009, 0.060, true], [R - 0.009, 0.027], [R - 0.0075, 0.0245], [R - 0.005, 0.023], [R - 0.0062, 0.016], [R - 0.0062, 0.010], [R - 0.0035, 0.0062], [R, 0.0055], [R + 0.0035, 0.0062], [R + 0.0062, 0.010], [R + 0.0062, 0.016], [R + 0.005, 0.023], [R + 0.0075, 0.0245], [R + 0.009, 0.027], [R + 0.009, 0.060, true], [R - 0.009, 0.060]]
	lathe(BRASS, foot, 56, xf, BRASS_TILE, [0.8, 0.95, 1.0, 0.7, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, 0.85, 0.7, 1.0, 0.95, 0.8, 0.6])
	var b0 := y0 + 0.058
	var b1 := b0 + band_h
	pierced_band(R, t, b0, b1, cells, ang0, hole)
	# the band's segments joined by cast straps outside and in, a rosette on each outer one
	for k in straps:
		var th := ang0 + TAU * k / straps
		var out := Vector3(cos(th), 0, sin(th))
		bar(out * (R + t * 0.5 + 0.002), out, 0.030, 0.004, y0 + 0.050, b1 + 0.006)
		bar(out * (R - t * 0.5 - 0.002), -out, 0.026, 0.004, y0 + 0.050, b1 + 0.006)
		rosette(out * (R + t * 0.5 + 0.004) + Vector3(0, (b0 + b1) * 0.5, 0), out, 0.019)
	# cornice: a cove flaring out from the band to a flat ledge with a rounded edge each side
	var ly := band_h + 0.058
	var cor := [[R + 0.003, ly - 0.004], [R + 0.010, ly + 0.004], [R + 0.020, ly + 0.016], [R + 0.032, ly + 0.024], [R + 0.038, ly + 0.029], [R + 0.040, ly + 0.034], [R + 0.037, ly + 0.040], [R + 0.032, ly + 0.042, true], [R - 0.032, ly + 0.042, true], [R - 0.037, ly + 0.040], [R - 0.040, ly + 0.034], [R - 0.038, ly + 0.029], [R - 0.032, ly + 0.024], [R - 0.020, ly + 0.016], [R - 0.010, ly + 0.004], [R - 0.003, ly - 0.004]]
	lathe(BRASS, cor, 56, xf, BRASS_TILE, [0.6, 0.55, 0.7, 0.85, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.85, 0.75, 0.65, 0.55, 0.6])
	cresting(R + 0.034, y0 + ly + 0.040, 0.14)
	return y0 + ly + 0.042

## A flat cast strap standing on a face: `w` wide, `d` proud of `at` toward `out`, from y0 to y1, its edges eased.
func bar(at: Vector3, out: Vector3, w: float, d: float, y0: float, y1: float) -> void:
	var S: Surf = s[BRASS]
	var side := Vector3.UP.cross(out).normalized()
	var e := 0.0012
	# the section, round from one back corner over the face to the other (the back lies on the band)
	var sec := [Vector2(-w * 0.5, -d * 0.5), Vector2(-w * 0.5, d * 0.5 - e), Vector2(-w * 0.5 + e, d * 0.5), Vector2(w * 0.5 - e, d * 0.5), Vector2(w * 0.5, d * 0.5 - e), Vector2(w * 0.5, -d * 0.5)]
	var nrm := [-side, (-side + out).normalized(), (out - side * 0.3).normalized(), (out + side * 0.3).normalized(), (side + out).normalized(), side]
	var cols: Array = []
	var along := 0.0
	for i in sec.size():
		if i > 0: along += sec[i].distance_to(sec[i - 1])
		var p: Vector3 = at + side * sec[i].x + out * sec[i].y
		var a := S.add(Vector3(p.x, y0, p.z), nrm[i], Vector2(along, 0) / BRASS_TILE, shade(Vector3(p.x, y0, p.z), nrm[i], 0.8))
		var b := S.add(Vector3(p.x, y1, p.z), nrm[i], Vector2(along, y1 - y0) / BRASS_TILE, shade(Vector3(p.x, y1, p.z), nrm[i], 0.95))
		cols.append([a, b])
	for i in sec.size() - 1:
		S.quad(cols[i][0], cols[i + 1][0], cols[i + 1][1], cols[i][1])

## A cast rosette (a low dome with a raised centre) on a face, its axis `out`.
func rosette(at: Vector3, out: Vector3, r: float) -> void:
	var y := out.normalized()
	var x := y.cross(Vector3.UP).normalized()
	var z := x.cross(y)
	lathe(BRASS, [[r, -0.001], [r * 0.96, 0.002], [r * 0.75, 0.0045], [r * 0.5, 0.004], [r * 0.32, 0.0065], [r * 0.12, 0.008], [0.0, 0.0082]], 10, Transform3D(Basis(x, y, z), at), BRASS_TILE, [0.6, 0.9, 1.0, 0.8, 1.0, 1.0, 1.0])

## A small eye standing on the ledge's inner edge (a chain's or spoke's anchor), facing the centre.
func eye(at: Vector3, toward: Vector3, r: float, d: float) -> void:
	var tdir := toward.normalized()
	var path := PackedVector3Array()
	for k in 12:
		var th := TAU * k / 12
		path.append(at + Vector3.UP * (r + r * sin(th)) + tdir * r * cos(th))
	tube(BRASS, path, true, d * 0.5, 6, BRASS_TILE, 0.9)

## An eye hanging under a ring's foot rail (the lower ring's chain hangs from it), in the plane of `out`.
func eye_down(at: Vector3, out: Vector3, r: float, d: float) -> void:
	var path := PackedVector3Array()
	for k in 12:
		var th := TAU * k / 12
		path.append(at + Vector3.UP * (r * sin(th) - 0.0) + out.normalized() * r * cos(th) + Vector3.DOWN * 0.0)
	tube(BRASS, path, true, d * 0.5, 6, BRASS_TILE, 0.85)

## A chain from the eye on the ledge at `at` up to an eye hung under the stem's collar at height `cy`, toward `dir`.
func collar_chain(at: Vector3, dir: Vector3, cy: float) -> void:
	var c := dir * 0.036 + Vector3(0, cy - 0.020, 0)
	eye_down(c, dir, 0.013, 0.008)
	spreader(at + Vector3.UP * 0.018, c + Vector3.DOWN * 0.005)

## The candle heights burnt down: one in four nearly new, the rest at stages.
func heights(count: int, tall: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var steps := [0.18, 0.23, 0.28, 0.31]
	for i in count:
		out.append(tall / 0.31 * steps[rng.randi_range(0, 3)] * rng.randf_range(0.95, 1.03))
	return out

## A turned stem from y0 to y1 (pendant ball at the foot, collars at `collars`, an eye at the top); returns the eye's top.
func stem(y0: float, y1: float, ball: float, collars: Array) -> float:
	var h := y1 - y0
	var prof := [[0.0, y0], [ball * 0.12, y0 + ball * 0.03], [ball * 0.22, y0 + ball * 0.12], [ball * 0.30, y0 + ball * 0.22], [ball * 0.52, y0 + ball * 0.40], [ball * 0.80, y0 + ball * 0.66], [ball * 0.97, y0 + ball * 0.98], [ball, y0 + ball * 1.18], [ball * 0.93, y0 + ball * 1.42], [ball * 0.72, y0 + ball * 1.70], [ball * 0.45, y0 + ball * 1.92], [ball * 0.32, y0 + ball * 2.02], [ball * 0.34, y0 + ball * 2.10], [ball * 0.24, y0 + ball * 2.18, true]]
	var y := y0 + ball * 2.18
	var aos := [0.9, 1.0, 0.85, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.95, 0.85, 0.75, 0.9, 0.8]
	for c in collars:
		var cy: float = c
		if cy <= y + 0.02 or cy >= y1 - 0.03: continue
		prof += [[0.012, y + 0.01], [0.012, cy - 0.022, true], [0.022, cy - 0.016], [0.028, cy - 0.006], [0.028, cy + 0.006], [0.022, cy + 0.016], [0.012, cy + 0.022, true]]
		aos += [0.75, 0.7, 0.85, 1.0, 1.0, 0.9, 0.7]
		y = cy + 0.022
	prof += [[0.012, y1 - 0.03], [0.020, y1 - 0.02], [0.018, y1 - 0.008], [0.0, y1 - 0.002]]
	aos += [0.75, 0.95, 0.9, 0.8]
	lathe(BRASS, prof, 18, Transform3D.IDENTITY, BRASS_TILE, aos)
	# the top eye
	var path := PackedVector3Array()
	for k in 12:
		var th := TAU * k / 12
		path.append(Vector3(0.022 * cos(th), y1 + 0.018 + 0.022 * sin(th), 0))
	tube(BRASS, path, true, 0.005, 6, BRASS_TILE, 0.9)
	return y1 + 0.045

## A spoke: a round brass rod from the stem to the ring's foot rail, a knop near its middle.
func spoke(a: Vector3, b: Vector3) -> void:
	tube(BRASS, PackedVector3Array([a, a.lerp(b, 0.45), a.lerp(b, 0.55), b]), false, 0.0075, 8, BRASS_TILE, 0.9)
	var mid := a.lerp(b, 0.5)
	var dir := (b - a).normalized()
	var basis := Basis(dir.cross(Vector3.UP).normalized(), dir, dir.cross(dir.cross(Vector3.UP).normalized()))
	lathe(BRASS, [[0.0, -0.018], [0.009, -0.016], [0.015, -0.006], [0.015, 0.006], [0.009, 0.016], [0.0, 0.018]], 10, Transform3D(basis, mid), BRASS_TILE, [0.8, 0.9, 1.0, 1.0, 0.9, 0.8])

## Spreader chain dimensions (brass) and hoist chain dimensions (iron).
const SPREAD := [0.078, 0.046, 0.0085]
const HOIST := [0.090, 0.054, 0.012]

func spreader(a: Vector3, b: Vector3) -> void:
	chain(BRASS, a, b, SPREAD[0], SPREAD[1], SPREAD[2], 3, 4, BRASS_TILE)

## A suspension ring (upright, in the x/y plane) at `c`.
func suspension_ring(c: Vector3, r: float, d: float) -> void:
	var path := PackedVector3Array()
	for k in 20:
		var th := TAU * k / 20
		path.append(c + Vector3(r * cos(th), r * sin(th), 0))
	tube(BRASS, path, true, d * 0.5, 8, BRASS_TILE, 0.9)

## The iron hook the hoist chain (or the large crown's ring) hangs from, under a plate in the vault at `top`; returns
## the centre of the hook's wire at the bottom of its bend.
func hook(top: Vector3, drop: float) -> Vector3:
	var br := 0.026
	var c := top + Vector3(0, -drop + br, 0)
	var path := PackedVector3Array([top + Vector3(-br, 0, 0), c + Vector3(-br, 0, 0)])
	for k in range(1, 10):
		var th := PI + PI * k / 9.0
		path.append(c + Vector3(br * cos(th), br * sin(th), 0))
	path.append(c + Vector3(br, 0.022, 0))
	tube(IRON, path, false, 0.007, 8, IRON_TILE)
	lathe(IRON, [[0.0, -0.012], [0.05, -0.012], [0.058, -0.006], [0.06, 0.0]], 12, Transform3D(Basis.IDENTITY, top), IRON_TILE, 0.9, false)
	return c + Vector3(0, -br, 0)

## ---- the three crowns -------------------------------------------------------------------------------------------
## Each is built in its own frame: y 0 = the old ring's foot (the authored hanging height), centred on its axis.

## Large crown (St James's and St Paul's aisles, 2.5 m): 12 lights, three spreader chains to an upright suspension ring
## whose top is at `hang` (the hoist hangs it from there).
func large_body(hang: float) -> void:
	var R := 1.2
	var cand0 := PI / 12.0
	# lights first: their flames darken the brass laid after them
	flames.clear()
	var hs := heights(12, 0.30)
	var ledge := 0.058 + 0.20 + 0.042
	for i in 12:
		var th := cand0 + TAU * i / 12
		flames.append(Vector3(R * cos(th), flame_y(ledge, hs[i]), R * sin(th)))
	ring(R, 0.0, 0.20, 36, 0.0, 12, 0.050, 0.004)
	flames.clear()
	for i in 12:
		var th := cand0 + TAU * i / 12
		light(Vector3(R * cos(th), ledge, R * sin(th)), hs[i], 0.014)
	# the cast boss the three chains meet at: a ball with an eye for each chain and one on top
	var ball := 0.07
	stem(hang - 0.045 - 0.20, hang - 0.045, ball, [])
	var bc := Vector3(0, hang - 0.245 + ball * 1.18, 0)
	for i in 3:
		var th := TAU * i / 3.0
		var dir := Vector3(cos(th), 0, sin(th))
		var at := Vector3((R - 0.034) * cos(th), ledge, (R - 0.034) * sin(th))
		eye(at, -dir, 0.013, 0.008)
		var lug := bc + dir * (ball * 0.97) + Vector3(0, -0.02, 0)
		eye_down(lug + Vector3(0, -0.013, 0), dir, 0.013, 0.008)
		spreader(at + Vector3.UP * 0.018, lug + Vector3(0, -0.018, 0))

## The hoist: an iron chain from a crown's top eye at `hang` to the hook under its vault plate at `top`.
func hoist(hang: float, top: float, _large: bool) -> void:
	var hb := hook(Vector3(0, top, 0), 0.10)
	chain(IRON, Vector3(0, hang - 0.012, 0), hb + Vector3(0, 0.006, 0), HOIST[0], HOIST[1], HOIST[2], 3, 4, IRON_TILE)

## Small crown (St Charles's nave and the choirs, 1.6 m): 8 lights, a turned stem with four spokes and four chains,
## hoisted on an iron chain to `top`.
func small(top: float) -> void:
	var R := 0.8
	var ledge := 0.058 + 0.16 + 0.042
	var cand0 := PI / 8.0
	flames.clear()
	var hs := heights(8, 0.26)
	for i in 8:
		var th := cand0 + TAU * i / 8
		flames.append(Vector3(R * cos(th), flame_y(ledge, hs[i]), R * sin(th)))
	ring(R, 0.0, 0.16, 24, 0.0, 8, 0.036, 0.003)
	var stem_top := stem(-0.20, 0.95, 0.075, [0.03, 0.88])
	flames.clear()
	for i in 8:
		var th := cand0 + TAU * i / 8
		light(Vector3(R * cos(th), ledge, R * sin(th)), hs[i], 0.0125)
	for i in 4:
		var th := TAU * i / 4.0
		var dir := Vector3(cos(th), 0, sin(th))
		spoke(dir * 0.028 + Vector3(0, 0.03, 0), dir * (R - 0.016) + Vector3(0, 0.03, 0))
		var at := dir * (R - 0.034) + Vector3(0, ledge, 0)
		eye(at, -dir, 0.013, 0.008)
		collar_chain(at, dir, 0.88)
	if top > 0.0: hoist(stem_top, top, false)

## Two-tier crown (the cathedral's nave, 2.1 m under 1.2 m): 12 and 8 lights on a turned stem, spokes to both rings,
## chains from the lower ring to the stem's upper collar, hoisted to `top`.
func tiered(top: float) -> void:
	var R0 := 1.05
	var R1 := 0.6
	var l0 := 0.058 + 0.18 + 0.042
	var y1 := 0.60
	var l1 := y1 + 0.058 + 0.14 + 0.042
	var hs0 := heights(12, 0.30)
	var hs1 := heights(8, 0.26)
	flames.clear()
	for i in 12:
		var th := PI / 12.0 + TAU * i / 12
		flames.append(Vector3(R0 * cos(th), flame_y(l0, hs0[i]), R0 * sin(th)))
	for i in 8:
		var th := PI / 8.0 + TAU * i / 8
		flames.append(Vector3(R1 * cos(th), flame_y(l1, hs1[i]), R1 * sin(th)))
	ring(R0, 0.0, 0.18, 36, 0.0, 12, 0.046, 0.004)
	ring(R1, y1, 0.14, 24, 0.0, 8, 0.034, 0.003)
	var stem_top := stem(-0.30, 1.55, 0.09, [0.03, y1 + 0.03, 1.45])
	flames.clear()
	for i in 12:
		var th := PI / 12.0 + TAU * i / 12
		light(Vector3(R0 * cos(th), l0, R0 * sin(th)), hs0[i], 0.014)
	for i in 8:
		var th := PI / 8.0 + TAU * i / 8
		light(Vector3(R1 * cos(th), l1, R1 * sin(th)), hs1[i], 0.0125)
	for i in 4:
		var th := TAU * i / 4.0
		var dir := Vector3(cos(th), 0, sin(th))
		spoke(dir * 0.028 + Vector3(0, 0.03, 0), dir * (R0 - 0.016) + Vector3(0, 0.03, 0))
		spoke(dir * 0.028 + Vector3(0, y1 + 0.03, 0), dir * (R1 - 0.016) + Vector3(0, y1 + 0.03, 0))
		var at := dir * (R0 - 0.034) + Vector3(0, l0, 0)
		eye(at, -dir, 0.013, 0.008)
		var under := dir * R1 + Vector3(0, y1 - 0.011, 0)
		eye_down(under, dir, 0.013, 0.008)
		spreader(at + Vector3.UP * 0.018, under + Vector3.DOWN * 0.005)
		var d2 := Vector3(cos(th + PI / 4.0), 0, sin(th + PI / 4.0))
		var at2 := d2 * (R1 - 0.034) + Vector3(0, l1, 0)
		eye(at2, -d2, 0.013, 0.008)
		collar_chain(at2, d2, 1.45)
	if top > 0.0: hoist(stem_top, top, false)

func mesh(materials: Array) -> ArrayMesh:
	var im := ImporterMesh.new()
	for i in 3:
		var S: Surf = s[i]
		if S.idx.is_empty(): continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = S.v
		arr[Mesh.ARRAY_NORMAL] = S.n
		arr[Mesh.ARRAY_TEX_UV] = S.uv
		arr[Mesh.ARRAY_COLOR] = S.c
		arr[Mesh.ARRAY_INDEX] = S.idx
		im.add_surface(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, materials[i], ["brass", "wax", "iron"][i])
	im.generate_lods(25.0, 60.0, [])
	return im.get_mesh()

func triangles() -> int:
	return s[0].tris() + s[1].tris() + s[2].tris()

## A crown's collision stand-in (never drawn): a plain 16-sided band where each ring is, foot to ledge.
static func hull(kind: String) -> ArrayMesh:
	var rings: Array = {"large": [[1.2, 0.0, 0.30]], "small": [[0.8, 0.0, 0.26]], "tiered": [[1.05, 0.0, 0.28], [0.6, 0.6, 0.84]]}[kind]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for r in rings:
		var R: float = r[0]
		for k in 16:
			var a := TAU * k / 16.0
			var b := TAU * (k + 1) / 16.0
			for w: float in [0.04, -0.04]:
				var p0 := Vector3((R + w) * cos(a), r[1], (R + w) * sin(a))
				var p1 := Vector3((R + w) * cos(b), r[1], (R + w) * sin(b))
				var q0 := p0 + Vector3(0, r[2] - r[1], 0)
				var q1 := p1 + Vector3(0, r[2] - r[1], 0)
				for p in [p0, p1, q1, p0, q1, q0]: st.add_vertex(p)
			for y: float in [r[1], r[2]]:
				var o0 := Vector3((R + 0.04) * cos(a), y, (R + 0.04) * sin(a))
				var o1 := Vector3((R + 0.04) * cos(b), y, (R + 0.04) * sin(b))
				var i0 := Vector3((R - 0.04) * cos(a), y, (R - 0.04) * sin(a))
				var i1 := Vector3((R - 0.04) * cos(b), y, (R - 0.04) * sin(b))
				for p in [o0, o1, i1, o0, i1, i0]: st.add_vertex(p)
	return st.commit()

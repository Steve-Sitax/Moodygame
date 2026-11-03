# Ruien kit: the folding iron footbridge (Steve's choice B, #286 and #283, 2026-11-03).
#
# Where a rui channel cuts a walkway (a tee mouth in a gallery's ledge, a junction room's walkway across a mouth) people
# cross on two riveted iron leaves; Antigoon wades upright through the channel when they stand folded up. The model,
# its collision and its behaviour are native and shared by every bridge (godot/src/World/Ruien/RuienFoldBridge.cs,
# native-godot/src/Services/NativeRuienBridges.cs); the export only places it: a "bridges" marker per crossing with
# the two hinge pivots at walk level on the deck's centre line and the side the lifting gear stands on. The game
# reads the markers (RuienImport -> markers.json -> RuienData.Bridges). The stone under it is the area's own coping:
# each leaf's bluestone seat is laid over the coping with its hinge 0.18 m back from the coping's nose.
#
# Why two leaves and not one: a 3.1 m leaf standing up needs 3.1 m of head room by the mouth; the gallery's basket
# vault over its ledge gives 1.5 to 1.9 m and a junction room's sail vault about 1.6 m over its walkway. Each half
# leaf stands 1.55 m tall, flat in the plane of its jamb, with the channel between them clear for his 0.93 m body.
import numpy as np

F = dict(
    pivot_back=0.18,     # hinge axis behind the coping's nose (the seat's front lies on the nose line)
    nose=0.04,           # every coping stands this far over the water (kit/meet.py returns, junction_gen.coping_line)
    host_s=1.9,          # tee: the deck's centre line on the gallery ledge (host lateral): the basket vault falls
                         # towards the wall, so Jef's head and the rails' swing (1.86 m, the leaf and rail's diagonal) keep clear
    room_d=0.5,          # junction room: the deck's centre line out from the wall; the wall-side rail swings 3.6 cm
                         # clear of the mouth ring's 6 cm proud face
    half=0.36, rail=0.385, seat=(0.42, 0.62),   # deck half width, rail line, seat reach on the plain and the gear side
    leaf_up=1.56,        # a standing leaf's top over the deck (half span plus its toe board)
)

def marker(bid, a, b, gear):
    g = np.asarray(gear, float); g = g / max(np.linalg.norm(g), 1e-9)
    return dict(id=bid, a=[float(v) for v in a], b=[float(v) for v in b], gear=[float(g[0]), float(g[1])])

def for_tee(t, name):
    """The tee's bridge across the branch's culvert through the host ledge, on the two dressed return copings."""
    lo, hi = t.cl
    pts = []
    for l_e in (t.l_far, t.l_we):
        away = -np.sign((lo + hi) / 2 - l_e)
        l = l_e - away * F['nose'] + away * F['pivot_back']
        q = float(t.q_at(l, F['host_s']))
        pts.append(t.world(np.array(q), np.array(l), np.array(t.hsec.ledge_y)))
    gear = t.sigma * t.nh           # towards the gallery wall: the gear box stands on the return coping, under the high vault
    return marker('%s_tee' % name, pts[0], pts[1], gear)

def for_room(room, m, rid):
    """A junction room's bridge over mouth m's channel, along the room wall, on the coping returns either side."""
    from kit import junction_gen as JG
    a, b = JG.channel_part(m)
    ta, tb = a + F['nose'] - F['pivot_back'], b - F['nose'] + F['pivot_back']
    p0, tv, n, L = JG.wall_frame(room.rect, m['wall'])
    y = JG.SEC.ledge_y
    A = JG.wpt(room.rect, m['wall'], ta, F['room_d']); B = JG.wpt(room.rect, m['wall'], tb, F['room_d'])
    return marker('%s_%s' % (rid, m['route']), [A[0], y, A[1]], [B[0], y, B[1]], -n)

def check(mk, channel=2.8, tol=0.01):
    """Span and level: the pivots stand 0.14 m outside both channel edges at walk level."""
    a, b = np.array(mk['a']), np.array(mk['b'])
    span = float(np.linalg.norm((b - a)[[0, 2]]))
    want = channel + 2 * (F['pivot_back'] - F['nose'])
    return abs(span - want) < tol and abs(a[1] - b[1]) < 1e-6, span

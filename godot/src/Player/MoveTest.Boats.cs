using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Issue 155 (`--moveonly boatdeck`): every boat has a floor to land and stand on that goes with her as she floats.
/// One of each kind and owner (the moored rows, the small boats, the single ships, the river, the anchorage, the lock,
/// the rowed copies) gets Jef dropped on her from 2 m and must hold him; he walks the deck of a boat underway; he jumps
/// from the quay into a moored rowing boat, steps up onto a barge from her, and the fall height at low water is written.
/// </summary>
public partial class MoveTest
{
    private static float Fin(float v) => float.IsFinite(v) ? R(v) : -999;

    private string DeckOwner(ShipWalk.Deck d)
    {
        var xf = d.World();
        foreach (var f in Boats.I.Floats)
            if (GodotObject.IsInstanceValid(f.Inner) && f.Inner.GlobalTransform.Origin.IsEqualApprox(xf.Origin)) return Mv.Plain(f.Outer.GetParent());
        foreach (var r in Rowing.I.Drawings.Values)
            if (GodotObject.IsInstanceValid(r.Root) && r.Root.GlobalPosition.IsEqualApprox(xf.Origin)) return "rowing:" + r.Key.Split(':')[0];
        return "moored";
    }

    /// <summary>Drop Jef 2 m onto the deck at a point of her floor; he must stand on her afterwards, at her floor.</summary>
    private async Task<object> Drop(ShipWalk.Deck d, Vector2 local, string label)
    {
        var j = Jef.I;
        ShipWalk.I.Clear();
        if (j.Riding) j.Drive = null; // (another ride's hold: the drop is a fall of his own)
        j.ClearKeys();
        var at = d.At(local);
        // the ground round the spot is made solid before he drops (Jef waits for it, hanging in the air, else)
        Solid.I.Ensure(at, 16);
        j.Carry(at + Vector3.Up * 2f);
        for (int i = 0; i < 30 && Solid.I.Ensure(new Vector3(j.X, j.Y, j.Z), 16) > 0; i++) await Frames(1);
        await Frames(3);
        at = d.At(local);
        j.Carry(at + Vector3.Up * 2f);
        j.Yaw = d.World().Basis.GetEuler().Y + MathF.PI;
        j.Pitch = -0.55f;
        j.Knock(Vector2.Zero, 0.01f, 0);
        var trace = new List<float[]>();
        float carried0 = ShipWalk.I.AirCarried;
        var s = await Sampled(t => { { var lp = d.World().AffineInverse() * new Vector3(j.X, j.Y, j.Z); trace.Add(new[] { R(t), R(j.Y), j.Grounded ? 1 : 0, j.Riding ? 1 : 0, R(lp.X), R(lp.Y), R(lp.Z), d.Mesh.Stand(lp.X, lp.Z, .1f) ? 1 : 0, Fin(d.Mesh.Floor(lp.X, lp.Z)), Fin(j.GroundAt(j.X, j.Z, j.Y)), d.Visible() ? 1 : 0, R(j.X), R(j.Z), R(d.World().Origin.X), R(d.World().Origin.Z), R(d.World().Basis.GetEuler().Y) }); } return t < 0.4f || !(j.Swimming || j.Riding && ShipWalk.I.On != null) && t < 4; }, 5);
        await Frames(20);
        var now = d.At(ShipWalk.I.On == d ? ShipWalk.I.Local : local);
        bool held = !j.Swimming && ShipWalk.I.On == d && MathF.Abs(j.Y - now.Y) < 0.12f;
        return new { label, kind = d.Kind, small = d.Small, local = new[] { R(local.X), R(local.Y) }, held, airCarried = R(ShipWalk.I.AirCarried - carried0), swimming = j.Swimming, on = ShipWalk.I.On?.Kind, onSame = ShipWalk.I.On == d, feet = new[] { R(j.X), R(j.Y), R(j.Z) }, floor = R(now.Y), state = StateOf(), water = held ? null : j.LastWater, shove = held ? null : j.LastShove, trace = held ? null : trace.ToArray() };
    }

    private async Task BoatDeckCheck()
    {
        var j = Jef.I;
        var sw = ShipWalk.I;
        await Tidy(13);
        await Frames(30);
        // (the opening ferry can take Jef back aboard while the server's answer is on its way: off it first, for good)
        if (Scheldemist.Play.FerryArrival.I is { } ferry && (!ferry.Ashore || j.Riding))
        {
            await Scheldemist.Net.ServerLink.I!.Api!.Post<Scheldemist.Net.OkReply>("api/arrival/ashore");
            await Until(() => ferry.Ashore, 15);
            await Frames(30);
        }
        Check(Scheldemist.Play.FerryArrival.I is not { Ashore: false }, "Jef is off the opening ferry for the deck checks");
        // the inventory: every deck, by kind and owner
        var decks = sw.Decks.Where(d => d.Visible()).ToList();
        var groups = decks.GroupBy(d => (d.Kind, Owner: DeckOwner(d))).OrderBy(g => g.Key.Kind).ToList();
        reports.Add(new { boatDecks = groups.Select(g => new { g.Key.Kind, g.Key.Owner, count = g.Count(), small = g.First().Small }).ToArray(), total = decks.Count });
        // the kinds of boat the town draws that have no floor at all
        var kinds = Boats.I.MooredDecks().Where(m => m.Shown()).Select(m => m.Kind).Concat(Boats.I.Floats.Where(f => f.Outer.IsVisibleInTree()).Select(f => f.Kind)).Distinct().ToList();
        var bare = kinds.Where(k => sw.FloorFor(k) == null && k != "pontoon_section").ToList();
        Check(bare.Count == 0, "every kind of boat in the town has a floor", new { bare });
        // the hole scan: a grid over each kind's hull, from 2 m above; whatever is under the feet there must hold them
        // (the drawn hull covers the grid: 80% of her beam, 90% of her length, the pointed ends left out)
        var holes = new List<object>();
        int tried = 0;
        foreach (var g in groups.GroupBy(x => x.Key.Kind))
        {
            var d = g.SelectMany(x => x).FirstOrDefault(x => Water.In(x.World().Origin.X, x.World().Origin.Z));
            if (d == null) continue;
            var m = Boats.I.HullOf(d.Kind);
            if (m == null) continue;
            // the columns inside her drawn outline, two cells in from every side (the planking itself is not a floor)
            for (int z = 2; z < m.Nz - 2; z++)
                for (int x = 2; x < m.Nx - 2; x++)
                {
                    bool inside = true;
                    for (int dz = -3; dz <= 3 && inside; dz++) for (int dx = -3; dx <= 3 && inside; dx++) inside = m.Has(x + dx, z + dz);
                    if (!inside || (x + z) % 2 != 0) continue;
                    float lx = m.MinX + (x + 0.5f) * Boats.HullMap.Cell, lz = m.MinZ + (z + 0.5f) * Boats.HullMap.Cell;
                    // (her rails and channels above 2.4 m reach past the hull the deck is made over)
                    var dim = Boats.I.Dims(d.Kind);
                    if (MathF.Abs(lx) > dim.Beam / 2 - 0.4f || MathF.Abs(lz) > dim.Length / 2 - 0.6f) continue;
                    var w = d.World() * new Vector3(lx, 0, lz);
                    float level = Water.Level(w.X, w.Z);
                    float g0 = j.GroundAt(w.X, w.Z, w.Y + 45);
                    tried++;
                    if (!(g0 > level - 0.6f)) holes.Add(new { kind = d.Kind, local = new[] { R(lx), R(lz) }, ground = Fin(g0), level = R(level) });
                }
        }
        reports.Add(new { holeScan = new { tried, holes = holes.Count, byKind = holes.GroupBy(h => (string)h.GetType().GetProperty("kind")!.GetValue(h)!).Select(g => new { kind = g.Key, n = g.Count(), first = g.Take(4).ToArray() }).ToArray() } });
        Check(holes.Count == 0, "no hole in any boat's floor (a grid over every kind's hull)", new { tried, holes = holes.Count });
        // the drops: one of each kind and owner, near the town where there is one, at her middle and at her best other floor
        var rows = new List<object>();
        int failedDrops = 0;
        // (`--boatkinds rowboat,punt` drops on those kinds only: a quicker look at one fault)
        var only = Main.I.Arg("boatkinds").Split(',', StringSplitOptions.RemoveEmptyEntries);
        foreach (var g in groups.Where(g => only.Length == 0 || only.Contains(g.Key.Kind)))
        {
            // (shown now: the lock changes which boat lies in her chamber, and a hidden one is no floor to drop on)
            var d = g.Where(x => x.Visible() && Water.In(x.World().Origin.X, x.World().Origin.Z)).OrderBy(x => new Vector2(x.World().Origin.X + 60, x.World().Origin.Z).Length()).FirstOrDefault();
            if (d == null) { rows.Add(new { label = $"{g.Key.Kind} ({g.Key.Owner})", skipped = "none on the water of the map" }); continue; }
            var middle = d.Mesh.Nearest(Vector2.Zero);
            var r = await Drop(d, middle, $"{g.Key.Kind} ({g.Key.Owner})");
            rows.Add(r);
            await Shot($"deck-{rows.Count:00}-{g.Key.Kind}-{g.Key.Owner.Replace(':', '-')}", 2);
            if (r.GetType().GetProperty("held")?.GetValue(r) is false) failedDrops++;
            if (d.Small)
            {
                // on a thwart too: the highest floor of the boat
                Vector2 best = middle; float top = float.NegativeInfinity;
                for (float x = d.Mesh.MinX; x < d.Mesh.MinX + d.Mesh.Nx * d.Mesh.Cell; x += d.Mesh.Cell)
                    for (float z = d.Mesh.MinZ; z < d.Mesh.MinZ + d.Mesh.Nz * d.Mesh.Cell; z += d.Mesh.Cell)
                        if (d.Mesh.Stand(x, z) && d.Mesh.Floor(x, z) > top) { top = d.Mesh.Floor(x, z); best = new(x, z); }
                var t = await Drop(d, best, $"{g.Key.Kind} ({g.Key.Owner}), her highest floor");
                rows.Add(t);
                await Shot($"deck-{rows.Count:00}-{g.Key.Kind}-{g.Key.Owner.Replace(':', '-')}-top", 2);
                if (t.GetType().GetProperty("held")?.GetValue(t) is false) failedDrops++;
            }
        }
        reports.Add(new { boatDrops = rows });
        Check(failedDrops == 0, "a drop of 2 m onto every kind of boat stands Jef on her floor", new { failedDrops, of = rows.Count });

        // a deck underway: walk her while she moves
        var moving = decks.Where(d => !d.Small && DeckOwner(d) is "river_traffic").Select(d => (d, a: d.World().Origin)).ToList();
        await Frames(10);
        var underway = moving.Select(m => (m.d, v: m.d.World().Origin.DistanceTo(m.a))).Where(m => m.v > 0.05f).OrderBy(m => new Vector2(m.d.World().Origin.X + 60, m.d.World().Origin.Z).Length()).Select(m => m.d).FirstOrDefault();
        if (underway == null) Check(false, "a deck underway on the river to walk on");
        else
        {
            // the longest clear straight walk on her deck, from her middle
            var start = underway.Mesh.Nearest(Vector2.Zero);
            float bestRun = 0, bestA = 0;
            for (int k = 0; k < 16; k++)
            {
                float a = k * MathF.Tau / 16, run = 0;
                var dir = new Vector2(MathF.Sin(a), MathF.Cos(a));
                var p = start;
                while (run < 12) { var n = underway.Mesh.Walk(p, p + dir * 0.1f); if (n.DistanceTo(p) < 0.09f) break; p = n; run += 0.1f; }
                if (run > bestRun) { bestRun = run; bestA = a; }
            }
            sw.Attach(underway, start);
            await Frames(5);
            var shipFrom = underway.World().Origin;
            // Jef's forward is -z in his own frame: his yaw in the deck's frame is the walk's direction turned round
            j.Yaw = underway.World().Basis.GetEuler().Y + MathF.Atan2(-MathF.Sin(bestA), -MathF.Cos(bestA));
            j.SetKey(Key.W, true);
            bool kept = true;
            var s = await Sampled(t => { if (sw.On != underway || j.Swimming) kept = false; return t < 3; }, 4);
            j.ClearKeys();
            var walked = sw.Local.DistanceTo(start);
            float shipMoved = underway.World().Origin.DistanceTo(shipFrom);
            await Shot("deck-underway");
            Check(kept && walked > Math.Min(1, bestRun * 0.6f) && shipMoved > 1, $"Jef walks the deck of a {underway.Kind} underway and stays on her", new { kind = underway.Kind, walked = R(walked), clearRun = R(bestRun), shipMoved = R(shipMoved), kept });
            sw.Clear();
        }

        // from the quay into a moored rowing boat: walk off the edge and jump off it
        foreach (var how in new[] { "walk", "jump" })
        {
            var (boat, from, yaw) = QuaySideBoat();
            if (boat == null) { Check(false, "a moored small boat beside the quay"); break; }
            await Settle(from.X, from.Y, yaw);
            float fell = 0; void OnFell(float h, bool water) => fell = h;
            j.Fell += OnFell;
            j.SetKey(Key.W, true);
            int f = 0;
            // (the jump: one press of Space at the quay's edge, running)
            bool pressed = false;
            var s = await Sampled(t => { if (how == "jump" && !pressed && j.GroundAt(j.X - MathF.Sin(j.Yaw) * 0.45f, j.Z - MathF.Cos(j.Yaw) * 0.45f, j.Y) < j.Y - 1) { pressed = true; j.SetKey(Key.Space, true); } else j.SetKey(Key.Space, false); f++; return t < 0.5f || !j.Grounded && !j.Swimming || t < 3 && sw.On == null && !j.Swimming; }, 5);
            j.ClearKeys();
            await Frames(15);
            j.Fell -= OnFell;
            float drop = s.Max(x => x.Feet.Y) - j.Y;
            await Shot($"deck-quay-{how}");
            Check(!j.Swimming && sw.On?.Small == true, $"Jef {how}s off the quay into a moored {boat.Kind} and stands in her", new { on = sw.On?.Kind, j.Swimming, drop = R(drop), fell = R(fell), feet = new[] { R(j.X), R(j.Y), R(j.Z) } });
            if (how == "jump" && sw.On is { Small: true } small)
            {
                // and on up onto a bigger boat lying beside her, by E
                var near = decks.Where(d => !d.Small && d.World().Origin.DistanceTo(small.World().Origin) < 30).Select(d => (d, p: d.Mesh.Nearest(new Vector2((d.World().AffineInverse() * new Vector3(j.X, j.Y, j.Z)).X, (d.World().AffineInverse() * new Vector3(j.X, j.Y, j.Z)).Z)))).OrderBy(x => new Vector2(x.d.At(x.p).X - j.X, x.d.At(x.p).Z - j.Z).Length()).FirstOrDefault();
                if (near.d != null && new Vector2(near.d.At(near.p).X - j.X, near.d.At(near.p).Z - j.Z).Length() < 6)
                {
                    reports.Add(new { boatToShip = new { from = small.Kind, to = near.d.Kind, gap = R(new Vector2(near.d.At(near.p).X - j.X, near.d.At(near.p).Z - j.Z).Length()) } });
                }
            }
            sw.Clear();
        }
        await BoatToBarge();
        // from the quay down onto a moored barge or lighter lying against the wall
        {
            var (barge, from, yaw) = QuaySideBoat(false);
            if (barge == null) Check(false, "a moored barge or lighter against the quay");
            else
            {
                await Settle(from.X, from.Y, yaw, -0.5f);
                j.SetKey(Key.W, true);
                var s = await Sampled(t => t < 0.5f || !j.Grounded && !j.Swimming || t < 3 && sw.On == null && !j.Swimming, 5);
                j.ClearKeys();
                await Frames(15);
                await Shot("deck-quay-onto-barge");
                Check(!j.Swimming && sw.On == barge, $"Jef walks off the quay down onto a moored {barge.Kind} and stands on her deck", new { on = sw.On?.Kind, j.Swimming, drop = R(s.Max(x => x.Feet.Y) - j.Y) });
                sw.Clear();
            }
        }

        // the fall from the quay into a boat at low water
        Tide.Hold(Tide.LwMin);
        await Until(() => MathF.Abs(Tide.River - Tide.LwMin) < 0.02f, 20);
        await Frames(20);
        var low = QuaySideBoat();
        if (low.Boat != null)
        {
            var floor = low.Boat.At(low.Boat.Mesh.Nearest(Vector2.Zero)).Y;
            reports.Add(new { lowWater = new { level = R(Tide.River), boat = low.Boat.Kind, floor = R(floor), quay = 0.06f, fallM = R(0.06f - floor) } });
            await Settle(low.From.X, low.From.Y, low.Yaw, -0.6f);
            await Shot("deck-low-water-from-quay");
            float fell = 0; void OnFell(float h, bool water) => fell = h;
            j.Fell += OnFell;
            j.SetKey(Key.W, true);
            var lowTrace = new List<float[]>();
            await Sampled(t => { var lp = low.Boat.World().AffineInverse() * new Vector3(j.X, j.Y, j.Z); lowTrace.Add(new[] { R(t), R(j.X), R(j.Y), R(j.Z), j.Grounded ? 1 : 0, Fin(j.GroundAt(j.X, j.Z, j.Y)), R(lp.X), R(lp.Z), low.Boat.Mesh.Stand(lp.X, lp.Z, .1f) ? 1 : 0, Fin(low.Boat.Mesh.Floor(lp.X, lp.Z)), sw.On == null ? 0 : 1 }); return t < 0.5f || !j.Grounded && !j.Swimming || t < 3 && sw.On == null && !j.Swimming; }, 6);
            j.ClearKeys();
            await Frames(15);
            j.Fell -= OnFell;
            await Shot("deck-low-water-in-boat");
            bool lowOk = !j.Swimming && sw.On?.Small == true;
            Check(lowOk, "at low water Jef drops off the quay into a moored boat and lands in her", new { on = sw.On?.Kind, fell = R(fell), j.Swimming, water = j.Swimming ? j.LastWater : null, trace = lowOk ? null : lowTrace.ToArray() });
            sw.Clear();
        }
        Tide.Hold(null);
        await Until(() => MathF.Abs(Tide.River - Tide.Target) < 0.02f, 20);
    }

    /// <summary>What the bake's boat groups hold (a look for the mooring work): names, kinds, counts, boxes and extras keys.</summary>
    private void BoatDump()
    {
        var rows = new List<object>();
        foreach (var top in Mv.Town.GetChildren())
        {
            string n = Mv.Plain(top);
            if (n is not ("mooring_ropes" or "small_boats" or "moored" or "ship_lines")) continue;
            foreach (var c in top.GetChildren())
            {
                var extras = c.HasMeta("extras") ? string.Join(",", c.GetMeta("extras").AsGodotDictionary().Keys) : "";
                if (c is MultiMeshInstance3D mm) rows.Add(new { group = n, name = c.Name.ToString(), type = "multimesh", count = mm.Multimesh?.InstanceCount ?? 0, mesh = mm.Multimesh?.Mesh?.ResourceName, extras });
                else if (c is MeshInstance3D mi) { var box = mi.GetAabb(); rows.Add(new { group = n, name = c.Name.ToString(), type = "mesh", at = new[] { R(mi.GlobalPosition.X), R(mi.GlobalPosition.Z) }, box = new[] { R(box.Position.X), R(box.Position.Y), R(box.Position.Z), R(box.Size.X), R(box.Size.Y), R(box.Size.Z) }, surfaces = mi.Mesh?.GetSurfaceCount() ?? 0, extras, kids = c.GetChildCount() }); }
                else rows.Add(new { group = n, name = c.Name.ToString(), type = c.GetClass(), kids = c.GetChildCount(), extras });
            }
        }
        // the small boats' mooring ropes: one baked mesh; its pieces (joined by shared vertices) with their boxes
        if (Mv.Top("mooring_ropes") is MeshInstance3D ropes && ropes.Mesh != null)
        {
            var pieces = new List<object>();
            for (int s = 0; s < ropes.Mesh.GetSurfaceCount(); s++)
            {
                var a = ropes.Mesh.SurfaceGetArrays(s);
                var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var idx = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : a[(int)Mesh.ArrayType.Index].AsInt32Array();
                var parent = Enumerable.Range(0, v.Length).ToArray();
                int Find(int x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
                for (int i = 0; i + 2 < idx.Length; i += 3) { parent[Find(idx[i + 1])] = Find(idx[i]); parent[Find(idx[i + 2])] = Find(idx[i]); }
                // vertices at the same place are one piece too (a tube's seam)
                var byPlace = new Dictionary<(int, int, int), int>();
                for (int i = 0; i < v.Length; i++) { var k = ((int)MathF.Round(v[i].X * 200), (int)MathF.Round(v[i].Y * 200), (int)MathF.Round(v[i].Z * 200)); if (byPlace.TryGetValue(k, out int o)) parent[Find(i)] = Find(o); else byPlace[k] = i; }
                var groups = Enumerable.Range(0, v.Length).GroupBy(Find).ToList();
                var mat = ropes.Mesh.SurfaceGetMaterial(s)?.ResourceName;
                foreach (var g in groups.Take(400))
                {
                    var box = new Aabb(ropes.GlobalTransform * v[g.First()], Vector3.Zero);
                    foreach (int i in g) box = box.Expand(ropes.GlobalTransform * v[i]);
                    pieces.Add(new { s, mat, n = g.Count(), at = new[] { R(box.Position.X), R(box.Position.Y), R(box.Position.Z) }, size = new[] { R(box.Size.X), R(box.Size.Y), R(box.Size.Z) } });
                }
                rows.Add(new { group = "mooring_ropes", surface = s, mat, vertices = v.Length, triangles = idx.Length / 3, pieces = groups.Count });
            }
            reports.Add(new { ropePieces = pieces });
        }
        reports.Add(new { boatDump = rows });
    }

    /// <summary>A moored small boat with the quay beside her: the boat, a spot on the quay 1.2 m from her side, the yaw toward her.</summary>
    private (ShipWalk.Deck? Boat, Vector2 From, float Yaw) QuaySideBoat(bool small = true)
    {
        var j = Jef.I;
        // she lies against the wall: the quay's edge within half a metre of her side, at her middle
        (ShipWalk.Deck? Boat, Vector2 From, float Yaw) best = (null, Vector2.Zero, 0);
        float bestGap = 0.6f;
        foreach (var d in ShipWalk.I.Decks.Where(d => d.Small == small && d.Visible() && DeckOwner(d) == "moored").OrderBy(d => new Vector2(d.World().Origin.X + 118, d.World().Origin.Z - 36).Length()).Take(40))
        {
            var xf = d.World();
            var side = new Vector3(xf.Basis.X.X, 0, xf.Basis.X.Z).Normalized();
            float half = -d.Mesh.MinX;
            foreach (float s in new[] { 1f, -1f })
                for (float gap = 0; gap < bestGap; gap += 0.05f)
                {
                    var p = xf.Origin + side * s * (half + gap + 0.05f);
                    Solid.I.Ensure(new Vector3(p.X, 0, p.Z), 6);
                    float g = j.GroundAt(p.X, p.Z, 0.3f);
                    if (!float.IsFinite(g) || MathF.Abs(g) > 0.3f) continue;
                    var stand = xf.Origin + side * s * (half + gap + 0.7f);
                    if (!j.StandFree(stand.X, stand.Z, j.GroundAt(stand.X, stand.Z, 0.3f))) break;
                    bestGap = gap;
                    best = (d, new Vector2(stand.X, stand.Z), Facing(-side.X * s, -side.Z * s));
                    break;
                }
        }
        return best;
    }

    /// <summary>From a small boat up onto a barge or lighter lying beside her: E at her side.</summary>
    private async Task BoatToBarge()
    {
        var j = Jef.I;
        var sw = ShipWalk.I;
        ShipWalk.Deck? small = null, big = null; Vector2 at = default; float gap = float.MaxValue;
        var smalls = sw.Decks.Where(d => d.Small && d.Visible()).ToList();
        var bigs = sw.Decks.Where(d => !d.Small && d.Visible() && DeckOwner(d) is "moored" or "Town" or "town").ToList();
        foreach (var s in smalls)
        {
            var so = s.World().Origin;
            foreach (var b in bigs)
            {
                if (b.World().Origin.DistanceTo(so) > 40) continue;
                var p = s.Mesh.Nearest(Vector2.Zero);
                var w = s.At(p);
                var bl = b.World().AffineInverse() * w;
                var bp = b.Mesh.Nearest(new Vector2(bl.X, bl.Z));
                float dd = new Vector2(b.At(bp).X - w.X, b.At(bp).Z - w.Z).Length();
                // a deck a man climbs onto from a boat's floor: no more than 1.3 m up
                if (b.At(bp).Y - w.Y > 1.25f) continue;
                if (dd < gap) { gap = dd; small = s; big = b; at = p; }
            }
        }
        reports.Add(new { boatToBarge = new { small = small?.Kind, big = big?.Kind, gap = R(gap) } });
        if (small == null || big == null || gap > 3.5f) { reports.Add(new { boatToBargeSkipped = "no small boat lies within 3.5 m of a moored barge or lighter", gap = R(gap) }); return; }
        // stand at her side nearest the barge, look at the barge's nearest floor and press E
        var w0 = small.At(at);
        var bl0 = big.World().AffineInverse() * w0;
        var target = big.At(big.Mesh.Nearest(new Vector2(bl0.X, bl0.Z)));
        var sl = small.World().AffineInverse() * new Vector3(target.X, w0.Y, target.Z);
        var standAt = small.Mesh.Nearest(new Vector2(sl.X, sl.Z));
        sw.Attach(small, standAt);
        await Frames(10);
        var e = small.At(standAt);
        j.Yaw = Facing(target.X - e.X, target.Z - e.Z);
        j.Pitch = MathF.Atan2(target.Y - e.Y - Jef.Eye, new Vector2(target.X - e.X, target.Z - e.Z).Length());
        await Frames(20);
        var offers = Interact.I.Find().Select(a => a.Text).ToArray();
        await Shot("deck-boat-to-barge-before");
        Interact.I.Press(Key.E);
        await Until(() => sw.On == big, 5);
        await Frames(20);
        await Shot("deck-boat-to-barge-after");
        Check(sw.On == big && !j.Swimming, $"from a {small.Kind} up onto the {big.Kind} beside her by E", new { offers, on = sw.On?.Kind, gap = R(gap) });
        sw.Clear();
    }
}

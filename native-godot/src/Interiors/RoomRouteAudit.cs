using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.World;
namespace Scheldemist.Native.Interiors;

/// <summary>
/// The room route audit in the game itself (issue 139): for every editable room in its town shell, a walk on foot with Jef's
/// own ground and body tests (his step, his width and height, the stairs, every door held open) from the street before each of
/// its doors, and from its entry points, to every seat, bed, counter and stove of its furniture. The workshop's own floor graph
/// does not see the town's stair holes or Jef's body; this is the route a player and a townsperson have.
/// `--room-route-audit dir` (with `--no-ai`, its own `--db`, `--prefs`, `--author-root`, port and user data) writes
/// `room-route-audit.json`; `--audit-rooms room-a,room-b` picks rooms. Exit 1 when a room has a place no route reaches.
/// </summary>
public static class RoomRouteAudit
{
    private const float Cell = .125f;
    private static readonly PhysicsShapeQueryParameters3D bodyProbe = new() { Shape = new CylinderShape3D { Radius = Jef.Radius, Height = Jef.Tall - Jef.Step }, CollisionMask = Scheldemist.World.Solid.Layer, Margin = 0 };
    private static string Output = "";
    /// <summary>How far round the room the walk may go: an upper room's stairs and a hall's porch lie outside its own bounds.</summary>
    private const float Margin = 10;
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); Output = output; var rooms = new List<object>(); string? error = null; bool ok = true;
        async Task Frames(int n = 1) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(160);
            while (!game.Loaded || ServerLink.I?.Up != true || !GameState.I.Live || Scheldemist.Menu.Loading.Busy)
            { if (DateTime.UtcNow > deadline) throw new TimeoutException("Native game did not become ready."); await Frames(); }
            var town = (NativeTown)game.World; var api = ServerLink.I!.Api!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
            // every door held open, a rented home's too (as the interiors check does)
            Doors.I.Held = true; foreach (var d in Doors.I.All.Where(d => !d.Fixed)) Doors.I.Force(d, true);
            Jef.I.TestInput = true; GameState.I.PlayingWhen = () => false;
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            Jef.I.Place(10, 12, 0, 0, 40);
            // (the leaves swing open over a second or two; the walk tests the open doorways)
            await Frames(180);
            // dev: `--audit-line x0,z0,x1,z1,feet` walks one straight line with Jef's tests and says what holds a body on it
            if (Scheldemist.Native.Game.NativeArguments.Arg("audit-line").Split(',') is { Length: 5 } line)
            {
                var n = line.Select(t => float.Parse(t, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                var from = new Vector3(n[0], n[4], n[1]); var to = new Vector3(n[2], n[4], n[3]); var dir = to - from; float length = dir.Length(); dir /= length; float feet = n[4];
                var notes = new List<string>();
                for (float t = 0; t <= length; t += .0625f)
                {
                    var q = from + dir * t; float g = Jef.I.GroundAt(q.X, q.Z, feet + .1f);
                    bodyProbe.Transform = new Transform3D(Basis.Identity, new Vector3(q.X, g + Jef.Step + (Jef.Tall - Jef.Step) / 2, q.Z));
                    var hits = float.IsFinite(g) ? Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(bodyProbe, 4) : new Godot.Collections.Array<Godot.Collections.Dictionary>();
                    notes.Add($"{t:0.00} ({q.X:0.00},{q.Z:0.00}) ground {g:0.00}: " + string.Join(" + ", hits.Select(h => Scheldemist.World.Solid.I.BodyName(h["rid"].AsRid()) is { Length: > 0 } nm ? nm : (h["collider"].AsGodotObject() as Node)?.GetPath().ToString() ?? "?")));
                    if (float.IsFinite(g) && g <= feet + Jef.Step) feet = g;
                }
                File.WriteAllLines(Path.Combine(output, "audit-line.txt"), notes);
            }
            var only = Scheldemist.Native.Game.NativeArguments.Arg("audit-rooms").Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
            foreach (var state in town.Layouts.Districts.Where(d => d.District.RoomId != "" && (only.Count == 0 || only.Contains(d.District.Id))))
            {
                var started = DateTime.UtcNow;
                var row = await Room(state, Frames, game);
                ok &= row.Pass;
                rooms.Add(new { name = state.District.Id, room = state.District.RoomId, pass = row.Pass, row.Seeds, row.Reached, row.Places, row.Unreachable, row.Placed, seconds = Math.Round((DateTime.UtcNow - started).TotalSeconds, 1) });
                GD.Print($"room route audit {state.District.Id}: {(row.Pass ? "pass" : "FAIL")} ({row.Places} places, {row.Unreachable.Count} without a route, {row.Placed.Count} where the game sets its people)");
                File.WriteAllText(Path.Combine(output, "room-route-audit.json"), JsonSerializer.Serialize(new { ok, rooms }, new JsonSerializerOptions { WriteIndented = true }));
            }
            Doors.I.Held = false;
        }
        catch (Exception e) { error = e.ToString(); ok = false; GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "room-route-audit.json"), JsonSerializer.Serialize(new { ok, error, rule = "Jef's GroundAt and BodyFree (cylinder 0.32 m, 0.36 m step, 1.75 m tall), quarter-metre cells over the room bounds and 10 m round them, every door held open; a place is reached within 0.7 m of a seat, 1.1 m of a bed, 1.5 m of a counter or stove, at its foot height", rooms }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"room route audit: {(ok ? "PASS" : "FAIL")}; {Path.Combine(output, "room-route-audit.json")}");
        game.GetTree().Quit(ok ? 0 : 1);
    }

    private sealed record Result(bool Pass, object[] Seeds, int Reached, int Places, List<object> Unreachable, List<object> Placed);

    /// <summary>
    /// Where the game sets people down without a walk, so no route is asked of the places there (the same rules as the people
    /// code): a hall's roles that appear in place and anyone 2 m or more above the hall's floor (HallPeople.CeremonyEnter: the
    /// organist in the loft, the confessor in his box, the Vleeshuis theatre upstairs). The prison's wings and cells are shut
    /// by design (no door into them opens) and its people start at home there (PrisonPeople): see Room.
    /// </summary>
    private static List<(Vector3 At, float Radius, string Why)> Staged(string roomId, out float? hallFloor)
    {
        var list = new List<(Vector3, float, string)>(); hallFloor = null;
        using var halls = JsonDocument.Parse(Scheldemist.People.HallPeopleData.Json);
        foreach (var hall in halls.RootElement.GetProperty("rooms").EnumerateArray())
        {
            if (hall.GetProperty("id").GetString() != roomId) continue;
            var o = hall.GetProperty("origin"); float floor = hall.GetProperty("floorY").GetSingle(); hallFloor = floor;
            var frame = new Transform3D(new Basis(Vector3.Up, hall.GetProperty("yaw").GetSingle()), new Vector3(o.GetProperty("x").GetSingle(), floor, o.GetProperty("z").GetSingle()));
            if (!halls.RootElement.GetProperty("roles").TryGetProperty(roomId, out var roles)) continue;
            foreach (var role in roles.EnumerateObject())
                if (role.Value.TryGetProperty("appear", out var appear) && appear.GetBoolean() && role.Value.TryGetProperty("at", out var at)
                    && hall.GetProperty("marks").TryGetProperty(at.GetString()!, out var mark))
                    list.Add((frame * new Vector3(mark.GetProperty("x").GetSingle(), mark.TryGetProperty("y", out var y) ? y.GetSingle() : 0, mark.GetProperty("z").GetSingle()), .8f, $"the {role.Name} appears in place there"));
        }
        return list;
    }

    private static async Task<Result> Room(NativeDistrictLayouts.DistrictState state, Func<int, Task> frames, NativeTownGame game)
    {
        var room = state.District; var rect = room.RoomBounds.Grow(Margin); var frame = room.RoomFrame;
        int w = (int)Math.Ceiling(rect.Size.X / Cell), d = (int)Math.Ceiling(rect.Size.Y / Cell);
        Vector3 At(int ix, int iz) => frame * new Vector3(rect.Position.X + (ix + .5f) * Cell, 0, rect.Position.Y + (iz + .5f) * Cell);
        (int x, int z)? CellOf(Vector3 world) { var l = frame.AffineInverse() * world; int x = (int)Math.Floor((l.X - rect.Position.X) / Cell), z = (int)Math.Floor((l.Z - rect.Position.Y) / Cell); return x < 0 || z < 0 || x >= w || z >= d ? null : (x, z); }
        // where a walk in starts: the street step before each of the room's doors, and the room's own entry points
        var starts = new List<Vector3>();
        var inside = room.RoomBounds.Grow(1.5f);
        var doors = new List<string>();
        var near = room.RoomBounds.Grow(Margin / 2);
        foreach (var door in Doors.I.All)
        {
            // the street before every door round the room (its house door at any height: an upper room's way in is that
            // door and the stairs): the open ground of the town's walk grid nearest the doorway, so the walk comes in over the threshold
            var l = frame.AffineInverse() * door.Middle;
            if (!near.HasPoint(new Vector2(l.X, l.Z))) continue;
            if (Scheldemist.World.Ways.NearestOpen(door.Middle.X, door.Middle.Z, 4) is not { } street) continue;
            starts.Add(new Vector3(street.X, door.Middle.Y - 1.1f, street.Y)); // (Middle stands 1.1 m above the doorway's foot)
            if (!inside.HasPoint(new Vector2(l.X, l.Z))) continue;
            doors.Add(door.Id + (door.Fixed ? " (never opens)" : "") + (door.CanPass ? " open" : " shut"));
            // through the doorway on a straight line from the street: what holds a body there, every eighth of a metre
            var from = new Vector3(street.X, door.Middle.Y - 1.1f, street.Y); var through = new Vector3(door.Middle.X, from.Y, door.Middle.Z) - from; through.Y = 0;
            float length = through.Length(); if (length < .05f) continue; through /= length;
            float feet = from.Y; var held = new List<string>();
            for (float t = 0; t <= length + 1.5f; t += .125f)
            {
                var q = from + through * t; float g = Jef.I.GroundAt(q.X, q.Z, feet + .1f);
                if (!float.IsFinite(g) || g > feet + Jef.Step) { held.Add($"{t:0.00} m: no step up ({g:0.00})"); break; }
                feet = g;
                bodyProbe.Transform = new Transform3D(Basis.Identity, new Vector3(q.X, g + Jef.Step + (Jef.Tall - Jef.Step) / 2, q.Z));
                var hits = Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(bodyProbe, 2);
                if (hits.Count > 0) held.Add($"{t:0.00} m ({q.X:0.00},{g:0.00},{q.Z:0.00}): " + string.Join(" + ", hits.Select(h => Scheldemist.World.Solid.I.BodyName(h["rid"].AsRid()) is { Length: > 0 } n ? n : (h["collider"].AsGodotObject() as Node)?.GetPath().ToString() ?? "?")));
            }
            doors[^1] += held.Count == 0 ? " (a body passes)" : " (held: " + string.Join("; ", held.Take(6)) + ")";
        }
        starts.AddRange(room.EntryPoints.Length > 0 ? room.EntryPoints : new[] { room.WalkSpawn });
        var height = new Dictionary<(int, int, int), float>(); var queue = new Queue<(int, int, int)>();
        var seeds = new List<object>();
        foreach (var s in starts)
        {
            if (CellOf(s) is not { } c) { seeds.Add(new { at = new[] { s.X, s.Y, s.Z }, outside = true }); continue; }
            var p = At(c.x, c.z); float g = Jef.I.GroundAt(p.X, p.Z, s.Y + .3f);
            bool fits = float.IsFinite(g) && Math.Abs(g - s.Y) < 1 && Jef.I.BodyFree(p.X, g, p.Z);
            seeds.Add(new { at = new[] { s.X, s.Y, s.Z }, ground = float.IsFinite(g) ? g : (float?)null, fits });
            if (!fits) continue;
            var key = (c.x, c.z, (int)MathF.Round(g * 10));
            if (height.TryAdd(key, g)) queue.Enqueue(key);
        }
        int steps = 0;
        while (queue.TryDequeue(out var cur))
        {
            float y = height[cur];
            foreach (var (dx, dz) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
            {
                int nx = cur.Item1 + dx, nz = cur.Item2 + dz;
                if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
                var p = At(nx, nz); float g = Jef.I.GroundAt(p.X, p.Z, y);
                if (!float.IsFinite(g) || g > y + Jef.Step || g < y - .45f || !Jef.I.BodyFree(p.X, g, p.Z)) continue;
                var key = (nx, nz, (int)MathF.Round(g * 10));
                if (height.TryAdd(key, g)) queue.Enqueue(key);
            }
            // (a large hall takes many thousands of cells: let the engine draw meanwhile)
            if (++steps % 1500 == 0) await frames(1);
        }
        var reached = height.Select(kv => { var p = At(kv.Key.Item1, kv.Key.Item2); return new Vector3(p.X, kv.Value, p.Z); }).ToArray();
        var unreachable = new List<object>(); var placed = new List<object>(); int places = 0;
        var staged = Staged(room.RoomId, out var hallFloor);
        foreach (var o in state.Objects.GetChildren().OfType<AuthoredObject>())
        {
            var a = o.Asset; if (a == null || a.SeatPoints.Length == 0 && a.FurnitureKind is not ("bed" or "counter" or "stove")) continue;
            places++;
            var xf = o.GlobalTransform.AffineInverse();
            float reach = a.FurnitureKind is "stove" or "counter" ? 1.5f : a.FurnitureKind == "bed" ? 1.1f : .7f;
            float foot = a.SeatPoints.Length > 0 ? a.SeatPoints[0].Y : a.StandPoint.Y;
            bool found = reached.Any(p =>
            {
                var local = xf * p - a.FootprintOffset;
                return Math.Abs((xf * p).Y - foot) < .4f && Math.Abs(local.X) <= a.Footprint.X / 2 + reach && Math.Abs(local.Z) <= a.Footprint.Z / 2 + reach;
            });
            if (found) continue;
            var seat = o.ToGlobal(a.SeatPoints.Length > 0 ? a.SeatPoints[0] : a.StandPoint);
            string? why = room.RoomId == "prison" ? "inside the prison's shut wings and cells: its people start at home there (PrisonPeople)"
                : hallFloor is { } hf && seat.Y - hf >= 2 ? $"{seat.Y - hf:0.0} m above the hall's floor: the game sets its people there"
                : staged.Where(q => new Vector2(q.At.X - seat.X, q.At.Z - seat.Z).Length() < q.Radius && Math.Abs(q.At.Y - seat.Y) < 1.5f).Select(q => q.Why).FirstOrDefault();
            if (why != null) { placed.Add(new { id = o.ObjectId, title = a.Title, kind = a.FurnitureKind, why }); continue; }
            // from the nearest cell reached at that height, straight towards it: what holds a body on the way
            var aim = o.ToGlobal(a.SeatPoints.Length > 0 ? a.SeatPoints[0] with { Y = foot } : a.StandPoint);
            var nearest = reached.Where(p => Math.Abs(p.Y - aim.Y) < 1).OrderBy(p => new Vector2(p.X - aim.X, p.Z - aim.Z).Length()).FirstOrDefault(new Vector3(float.NaN, 0, 0));
            var held = new List<string>();
            if (float.IsFinite(nearest.X))
            {
                var dir = new Vector3(aim.X - nearest.X, 0, aim.Z - nearest.Z); float len = dir.Length(); if (len > .01f) dir /= len;
                float feet = nearest.Y;
                for (float t = .125f; t <= len && held.Count < 6; t += .125f)
                {
                    var q = nearest + dir * t; float g = Jef.I.GroundAt(q.X, q.Z, feet + .1f);
                    if (!float.IsFinite(g) || g > feet + Jef.Step || g < feet - .45f) { held.Add($"{t:0.00} m: ground {g:0.00} from {feet:0.00}"); break; }
                    feet = g; bodyProbe.Transform = new Transform3D(Basis.Identity, new Vector3(q.X, g + Jef.Step + (Jef.Tall - Jef.Step) / 2, q.Z));
                    var hits = Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(bodyProbe, 2);
                    if (hits.Count > 0) held.Add($"{t:0.00} m ({q.X:0.00},{g:0.00},{q.Z:0.00}): " + string.Join(" + ", hits.Select(h => Scheldemist.World.Solid.I.BodyName(h["rid"].AsRid()) is { Length: > 0 } n ? n : (h["collider"].AsGodotObject() as Node)?.GetPath().ToString() ?? "?")));
                }
            }
            string? picture = null;
            if (float.IsFinite(nearest.X) && unreachable.Count < 4 && Output != "")
            {
                // from the nearest cell reached, at eye height, looking at the place (13:00 clear)
                var eye = nearest + Vector3.Up * 1.6f; var look = aim + Vector3.Up * .8f;
                if (eye.DistanceTo(look) > .3f)
                {
                    game.Cam.GlobalPosition = eye; var rotation = new Transform3D(Basis.Identity, eye).LookingAt(look).Basis.GetRotationQuaternion();
                    if (game.Cam is FlyCam fly) fly.Face(rotation); else game.Cam.Quaternion = rotation;
                    await frames(12); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    picture = Path.Combine(Output, room.Id + "-" + o.ObjectId + ".png");
                    using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(picture);
                }
            }
            unreachable.Add(new { id = o.ObjectId, title = a.Title, kind = a.FurnitureKind, at = new[] { o.GlobalPosition.X, o.GlobalPosition.Y, o.GlobalPosition.Z },
                nearestReached = float.IsFinite(nearest.X) ? new[] { nearest.X, nearest.Y, nearest.Z } : null, onTheWay = held, picture });
        }
        if (unreachable.Count > 0 && Output != "")
        {
            // the cells reached, by storey of 1.5 m in the room's frame, half-metre squares: R reached, S a start, X a place without a route
            var text = new System.Text.StringBuilder($"doors {string.Join(", ", doors)}" + System.Environment.NewLine);
            var inverse = frame.AffineInverse();
            foreach (var storey in reached.GroupBy(p => Math.Round((inverse * p).Y / 1.5)).OrderBy(g => g.Key))
            {
                int mw = (int)Math.Ceiling(rect.Size.X / .5f), md = (int)Math.Ceiling(rect.Size.Y / .5f); var cells = new char[mw * md]; Array.Fill(cells, '.');
                void Mark(Vector3 at, char c) { var l = inverse * at; int x = (int)((l.X - rect.Position.X) / .5f), z = (int)((l.Z - rect.Position.Y) / .5f); if (x >= 0 && z >= 0 && x < mw && z < md) cells[z * mw + x] = c; }
                foreach (var p in storey) Mark(p, 'R');
                foreach (var st in starts) if (Math.Round((inverse * st).Y / 1.5) == storey.Key) Mark(st, 'S');
                foreach (var o in state.Objects.GetChildren().OfType<AuthoredObject>()) if (unreachable.Any(u => ((dynamic)u).id == o.ObjectId)) Mark(o.GlobalPosition, 'X');
                text.AppendLine($"storey at about {storey.Key * 1.5:0.0} m (room frame), heights {storey.Min(p => p.Y):0.00} to {storey.Max(p => p.Y):0.00}, x from {rect.Position.X:0.0}, z from {rect.Position.Y:0.0}, 0.5 m squares:");
                for (int z = 0; z < md; z++) text.AppendLine($"{rect.Position.Y + z * .5f,7:0.0} " + new string(cells, z * mw, mw));
            }
            text.AppendLine("unreachable: " + string.Join("; ", unreachable.Select(u => JsonSerializer.Serialize(u))));
            File.WriteAllText(Path.Combine(Output, room.Id + ".game-map.txt"), text.ToString());
        }
        return new Result(unreachable.Count == 0, seeds.ToArray(), reached.Length, places, unreachable, placed);
    }
}


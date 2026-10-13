using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>
/// `-- --homedoortest &lt;dir&gt; --home cellar --no-ai --db &lt;dir&gt;/test.sqlite`: a home's street door and the way
/// in, on foot. Jef walks to the door from the street with W held and finds it shut; he takes the key for the night
/// at the notice, the door opens, and he walks in to the middle of the room (down the steps, if the room is below the
/// street), looks out of each window, and walks back out to the street. Writes homedoortest.json (each step, where
/// Jef stood, whether the door could be passed) and the pictures. The route inside is found with Jef's own ground
/// test, a quarter metre at a time, and then walked.
/// </summary>
[GamePart(994)]
public partial class HomeDoorTest : Node
{
    private string dir = "";
    private readonly List<object> steps = new();
    private readonly List<string> pictures = new();
    private int failures;

    public override void _Ready()
    {
        dir = Main.I.Arg("homedoortest");
        if (dir == "") return;
        dir = Path.GetFullPath(dir);
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Run()
    {
        string error = "";
        try
        {
            if (Main.I.Arg("route-rooms") is { Length: > 0 } rooms) { await RouteRooms(rooms.Split(',')); return; }
            if (!Main.I.Flag("no-ai") || Paths.Database != Path.Combine(dir, "test.sqlite")) throw new InvalidOperationException("homedoortest needs --no-ai and --db <dir>/test.sqlite");
            await Until(() => ServerLink.I?.Up == true && GameState.I.Live, 100);
            Jef.I.TestInput = true;
            GameState.I.PlayingWhen = () => false;
            Dialogs.I!.KeepMouse = true;
            var api = ServerLink.I!.Api!;
            await api.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(10, 12, 0);
            await Until(() => FerryArrival.I.Ashore && !Jef.I.Riding, 15);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 0, weather = "clear", food = 10, sleep = 10, warmth = 10, health = 10, money_c = 500 }));
            Scheldemist.World.Daylight.I!.SetTime(13f);
            Scheldemist.World.Daylight.I.Settle();
            await HomeLife.I.Load();
            Check(await Until(() => HomeLife.I.Info != null, 15), "home information");
            string id = Main.I.Arg("home", "cellar");
            var h = HomeLife.I.Info!.Homes.First(x => x.Id == id);
            var f = HomeLife.I.Frames[id];
            var door = Doors.I.Get(Spots.BakedName("home:" + id)) ?? throw new InvalidOperationException("no door for home " + id);
            var wall = new Vector2(h.Wall[0], h.Wall[1]); var outward = new Vector2(h.Out[0], h.Out[1]);
            Note("door", new { door.Id, door.Kind, door.Open, canPass = door.CanPass, h.Wall, h.Out });

            // 1. from the street, without the key: the door is shut and solid
            // six metres out when that is street; an alley is narrower, and six metres out is inside the house across it
            float away = new[] { 6f, 4f, 3f, 2f }.FirstOrDefault(d => Scheldemist.World.Ways.Reachable(wall.X + outward.X * d, wall.Y + outward.Y * d), 1.6f);
            var street = wall + outward * away;
            Jef.I.Place(street.X, street.Y, MathF.Atan2(-(wall.X - street.X), -(wall.Y - street.Y)));
            await Frames(30);
            await Shot("1-street");
            await WalkTo(wall - outward * 1.2f, 12);
            Note("at the shut door", Here());
            Check(!door.CanPass, "the door is shut without the key");
            Check(Jef.I.Blocked && (new Vector2(Jef.I.X, Jef.I.Z) - wall).Dot(outward) > 0, "Jef stands outside it, held by it");
            Note("what E offers at the shut door", Interact.I.Find().Select(a => a.Text).ToArray());
            await Shot("2-shut-door");

            // 2. the key, at the notice by the door
            Look(Jef.I.X, Jef.I.Z, wall.X, wall.Y, 1.2f);
            await Frames(10);
            Check(Interact.I.Find().Any(a => a.Text.StartsWith("read the notice:")), "the notice by the door is offered");
            Interact.I.Press(Key.E);
            await Until(() => Dialogs.I!.Top?.DialogName == "home notice", 3);
            await Shot("3-notice");
            int money = GameState.I.Money;
            Dialogs.I!.Top?.OnKey("Digit1", "1");
            Check(await Until(() => HomeLife.I.Info?.Lease?.Home == id && !HomeLife.I.Busy, 10), "the key for the night is taken");
            Note("paid", money - GameState.I.Money);
            Dialogs.I.Top?.OnKey("Escape", "Escape");
            Check(await Until(() => door.CanPass, 6), "the key opens the door");
            await Frames(100);
            await Shot("4-door-open");

            // 3. in, and down to the room
            var middle = f.World(0, f.D / 2);
            var route = Route(wall, outward, (p, g) => MathF.Abs(g - f.Y) < 0.3f && (p - new Vector2(middle.X, middle.Z)).Length() < 0.8f);
            Check(route != null, "a walkable route runs from the street door to the room floor");
            if (route != null)
            {
                Note("route", new { cells = route.Count, lowest = route.Min(p => p.Y), from = route[0], to = route[^1] });
                bool atRoom = true;
                for (int i = 0; i < route.Count; i += 2) atRoom &= await WalkTo(new Vector2(route[i].X, route[i].Z), 4);
                atRoom &= await WalkTo(new Vector2(route[^1].X, route[^1].Z), 4);
                Note("in the room", Here());
                Check(atRoom && f.Inside, "Jef walked into the room and stands inside its frame");
                Check(MathF.Abs(Jef.I.Y - f.Y) < 0.5f, "on the room's floor");
                Look(Jef.I.X, Jef.I.Z, wall.X, wall.Y, 1.3f);
                await Frames(10);
                await Shot("5-room-looking-to-the-door");
                var centre = f.World(0, f.D / 2);
                await WalkTo(new Vector2(centre.X, centre.Z), 6);
                Look(Jef.I.X, Jef.I.Z, centre.X * 2 - Jef.I.X, centre.Z * 2 - Jef.I.Z, 1.0f);
                await Shot("6-room");

                // 4. each window from inside
                foreach (var (name, pos, normal) in Windows(id))
                {
                    foreach (var (depth, tag) in new[] { (1.3f, "far"), (0.45f, "close") })
                    {
                        var stand = pos - normal * depth;
                        Jef.I.Place(stand.X, stand.Z, MathF.Atan2(-normal.X, -normal.Z), 0, f.Y);
                        await Frames(10);
                        Jef.I.Pitch = Math.Clamp(MathF.Atan2(pos.Y - (Jef.I.Y + Jef.Eye), depth), -1.2f, 1.2f);
                        await Frames(10);
                        Note($"window {name} {tag}", new { pos, normal, jefY = Jef.I.Y });
                        await Shot($"7-window-{name}-{tag}");
                    }
                    // straight up from the sill: the way out of a light well
                    Jef.I.Pitch = 1.2f; await Frames(6);
                    await Shot($"7-window-{name}-up");
                }

                // 5. and back out
                var way = new List<Vector3>(route); way.Reverse();
                Jef.I.Place(way[0].X, way[0].Z, 0, 0, way[0].Y);
                await Frames(10);
                bool out1 = true;
                for (int i = 0; i < way.Count; i += 2) out1 &= await WalkTo(new Vector2(way[i].X, way[i].Z), 4);
                out1 &= await WalkTo(wall + outward * 1.5f, 6);
                Note("back at the street", Here());
                Check(out1 && (new Vector2(Jef.I.X, Jef.I.Z) - wall).Dot(outward) > 1f, "Jef walked back out to the street");
                Look(Jef.I.X, Jef.I.Z, wall.X, wall.Y, 1.3f);
                await Shot("9-street-again");
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("homedoortest: " + error); }
        finally
        {
            File.WriteAllText(Path.Combine(dir, "homedoortest.json"), JsonSerializer.Serialize(new { ok = error == "" && failures == 0, error, failures, steps, pictures }, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
            await Frames(30);
            GetTree().Quit(error == "" && failures == 0 ? 0 : 1);
        }
    }

    /// <summary>`--route-rooms home_cellar,poesje`: is there a way on foot from each room's street door down to its lowest floor? (No server, no key: the door's leaf is not asked.)</summary>
    private async Task RouteRooms(string[] rooms)
    {
        await Frames(60);
        foreach (string spec in rooms)
        {
            string room = spec.Split(':')[0];
            float floorY = spec.Contains(':') ? float.Parse(spec.Split(':')[1], System.Globalization.CultureInfo.InvariantCulture) : float.NaN;
            var marker = Scheldemist.World.BakedWorld.All(Main.I.World).OfType<Node3D>().FirstOrDefault(n => n.Name.ToString() == "opening_" + room + "_door" && n.HasMeta("extras"));
            var root = Scheldemist.World.BakedWorld.All(Main.I.World).OfType<Node3D>().FirstOrDefault(n => n.Name.ToString() == "ROOM_" + room);
            if (marker == null || root == null) { Check(false, $"{room}: its door marker and room are found"); continue; }
            var e = marker.GetMeta("extras").AsGodotDictionary();
            var normal = (((marker.GetParent() as Node3D)?.GlobalTransform.Basis ?? Basis.Identity) * new Vector3(e["nx"].AsSingle(), 0, e["nz"].AsSingle())).Normalized();
            float lowest = float.PositiveInfinity;
            foreach (var m in Scheldemist.World.BakedWorld.All(root).OfType<MeshInstance3D>().Where(m => m.Mesh != null)) lowest = Math.Min(lowest, (m.GlobalTransform * m.Mesh!.GetAabb()).Position.Y);
            var wall = new Vector2(marker.GlobalPosition.X, marker.GlobalPosition.Z);
            Jef.I.Place(wall.X + normal.X * 2, wall.Y + normal.Z * 2, 0);
            await Frames(10);
            if (float.IsNaN(floorY)) floorY = lowest;
            var route = Route(wall, new Vector2(normal.X, normal.Z), (p, g) => g < floorY + 0.3f);
            Check(route != null, $"{room}: a walkable route runs from the street door down to the floor at {floorY:0.00}");
            if (route != null) Note(room, new { cells = route.Count, lowest = route.Min(p => p.Y) });
        }
    }

    private static IEnumerable<(string, Vector3, Vector3)> Windows(string id)
    {
        foreach (var n in Scheldemist.World.BakedWorld.All(Main.I.World).OfType<Node3D>())
        {
            if (!n.Name.ToString().StartsWith("opening_home_" + id + "_w", StringComparison.Ordinal) || !n.HasMeta("extras")) continue;
            var e = n.GetMeta("extras").AsGodotDictionary();
            var basis = (n.GetParent() as Node3D)?.GlobalTransform.Basis ?? Basis.Identity;
            var normal = (basis * new Vector3(e["nx"].AsSingle(), 0, e["nz"].AsSingle())).Normalized();
            yield return (n.Name.ToString()["opening_home_".Length..], n.GlobalPosition, normal);
        }
    }

    /// <summary>
    /// A route on foot from just inside the street door to the middle of the room: a search over the cells behind the
    /// door (a quarter metre apart, in 0.1 m height layers). From a cell at height y Jef may go to a neighbour whose
    /// ground (his own ground test) is no more than a step above and no more than 0.45 m below, where his body fits.
    /// The cells are (x, height, z).
    /// </summary>
    private List<Vector3>? Route(Vector2 wall, Vector2 outward, Func<Vector2, float, bool> reached)
    {
        var inward = -outward; var side = new Vector2(-inward.Y, inward.X);
        const float cell = 0.25f; const int W = 48, D = 60; // 12 m across, 15 m in
        Vector2 At(int iu, int id) => wall + inward * (0.4f + id * cell) + side * ((iu - W / 2) * cell);
        int start = W / 2;
        var parent = new Dictionary<(int, int, int), (int, int, int)?>();
        var height = new Dictionary<(int, int, int), float>();
        var queue = new Queue<(int, int, int)>();
        var p0 = At(start, 0);
        float g0 = Jef.I.GroundAt(p0.X, p0.Y, 0.3f);
        var first = (start, 0, (int)MathF.Round(g0 * 10));
        parent[first] = null; height[first] = g0; queue.Enqueue(first);
        (int, int, int)? goal = null;
        while (queue.Count > 0 && goal == null)
        {
            var cur = queue.Dequeue(); float y = height[cur];
            foreach (var (du, dd) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
            {
                int nu = cur.Item1 + du, nd = cur.Item2 + dd;
                if (nu < 0 || nd < 0 || nu >= W || nd >= D) continue;
                var p = At(nu, nd);
                float g = Jef.I.GroundAt(p.X, p.Y, y);
                if (!float.IsFinite(g) || g > y + Jef.Step || g < y - 0.45f || !Jef.I.BodyFree(p.X, g, p.Y)) continue;
                var key = (nu, nd, (int)MathF.Round(g * 10));
                if (parent.ContainsKey(key)) continue;
                parent[key] = cur; height[key] = g; queue.Enqueue(key);
                if (reached(p, g)) { goal = key; break; }
            }
        }
        if (goal == null)
        {
            // the farthest it got: where the search stopped short
            var low = height.OrderBy(kv => kv.Value).First(); var far = height.OrderByDescending(kv => kv.Key.Item2).First();
            var lp = At(low.Key.Item1, low.Key.Item2); var fp = At(far.Key.Item1, far.Key.Item2);
            for (float ahead = 0.25f; ahead <= 1.0f; ahead += 0.25f)
            {
                var q = fp + inward * ahead;
                float gq = Jef.I.GroundAt(q.X, q.Y, far.Value);
                Note($"{ahead:0.00} m on from the farthest cell", new { ground = gq, bodyFits = float.IsFinite(gq) && Jef.I.BodyFree(q.X, gq, q.Y), top = Scheldemist.World.Solid.I.NameAt(new Vector3(q.X, far.Value + 2f, q.Y), new Vector3(q.X, far.Value - 1.5f, q.Y)), ahead = Scheldemist.World.Solid.I.NameAt(new Vector3(fp.X, far.Value + 0.9f, fp.Y), new Vector3(q.X, far.Value + 0.9f, q.Y)) });
            }
            Note("no route: the search reached", new { cells = height.Count, lowest = low.Value, lowestAt = new[] { lp.X, lp.Y }, farthestIn = far.Key.Item2 * cell + 0.4f, farthestAt = new[] { fp.X, fp.Y }, farthestY = far.Value });
            return null;
        }
        var path = new List<Vector3>();
        for ((int, int, int)? k = goal; k != null; k = parent[k.Value])
        {
            var p = At(k.Value.Item1, k.Value.Item2);
            path.Add(new Vector3(p.X, height[k.Value], p.Y));
        }
        path.Reverse();
        return path;
    }

    private object Here() => new { x = Jef.I.X, y = Jef.I.Y, z = Jef.I.Z, blocked = Jef.I.Blocked, grounded = Jef.I.Grounded };

    private static void Look(float x, float z, float tx, float tz, float height)
    {
        Jef.I.Yaw = MathF.Atan2(-(tx - x), -(tz - z));
        Jef.I.Pitch = MathF.Atan2(height - (Jef.I.Y + Jef.Eye), MathF.Max(0.1f, MathF.Sqrt((tx - x) * (tx - x) + (tz - z) * (tz - z))));
    }

    /// <summary>Walk with W held, steering at the target; false if stuck for two seconds or out of time.</summary>
    private async Task<bool> WalkTo(Vector2 target, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        double stuck = 0;
        var jef = Jef.I;
        var last = new Vector2(jef.X, jef.Z);
        while (Time.GetTicksMsec() < end)
        {
            var delta = target - new Vector2(jef.X, jef.Z);
            if (delta.Length() < 0.3f) { jef.ClearKeys(); return true; }
            jef.Yaw = MathF.Atan2(-delta.X, -delta.Y);
            jef.Pitch = 0;
            jef.SetKey(Key.W, true);
            await Frames(1);
            var now = new Vector2(jef.X, jef.Z);
            stuck = now.DistanceTo(last) < 0.002f ? stuck + GetProcessDeltaTime() : 0;
            last = now;
            if (stuck > 2) break;
        }
        jef.ClearKeys();
        return false;
    }

    private void Note(string name, object value) { steps.Add(new { name, value }); GD.Print($"homedoortest: {name} {JsonSerializer.Serialize(value, Api.Json)}"); }
    private void Check(bool ok, string name)
    {
        steps.Add(new { name, ok });
        GD.Print($"homedoortest: {(ok ? "ok" : "FAIL")} {name}");
        if (!ok) failures++;
    }
    private async Task<bool> Until(Func<bool> test, double seconds) { ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000); while (Time.GetTicksMsec() < end) { if (test()) return true; await Frames(1); } return test(); }
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Shot(string name) { await Frames(6); string file = Path.Combine(dir, name + ".png"); GetViewport().GetTexture().GetImage().SavePng(file); pictures.Add(file); }
}

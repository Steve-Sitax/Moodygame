using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>
/// The people who stand where their work is (the browser's game/people.ts, with town.ts postEmployers): the
/// Rijnkaai's own (Sooi, the widow Peeters, Tuur, Fientje, the sailor on the Anna Maria's deck) and the board's
/// employers, who are townspeople taken out of the town's list. They turn to face Jef when he comes near, move
/// their hands when he stands close, take a few steps now and then (LocalRound) and are solid for him. They are at
/// their post in their hours (shared/night.ts POST_HOURS; an employer in his working hours) and gone home outside
/// them; after dark, one with work open for Jef stands under the nearest lamp or holds a lantern, and the givers of
/// night work keep to their corner with a lantern.
/// Not here: what they say (talk), the work they give (jobs), and the lanes the browser keeps their posts out of
/// (the omnibus and the drays: those parts are not ported).
/// </summary>
[GamePart(205)]
public partial class PostedPeople : Node
{
    public sealed class Posted
    {
        public string Id = "";
        public string Name = "";
        public string Kind = "";
        public bool Talks = true;
        public bool OnDeck;
        /// <summary>The post by day, and where he stands now (the post, or under a lamp at night).</summary>
        public (double x, double z, double yaw) Home, Anchor;
        public double X, Z, Y, Yaw;
        public bool Present = true;
        public bool Lantern;
        public Resident? Resident;
        public Human? Human;
        public Node3D Group = null!;
        internal StaticBody3D? Solid;
        internal LocalRound? Round;
        internal double Facing, Gesture, GestureWait;
        internal Node3D? LanternNode;
        internal LanternPool.Source? Light;
    }

    /// <summary>The Rijnkaai's own hours at the post (shared/night.ts POST_HOURS); anyone else is always there.</summary>
    private static readonly Dictionary<string, (double from, double to)> PostHours = new() { ["sooi"] = (5, 20), ["peeters"] = (7, 19), ["fientje"] = (6, 18), ["tuur"] = (7, 26) };
    private static readonly string[] NightGivers = { "fence", "smuggler", "nightcarter", "cracksman" };
    /// <summary>The brig's deck over the water, and the bottom she sits on at low tide (world/rijnkaai.ts, world/tide.ts).</summary>
    private const float DeckOverWater = 2.4f, BrigFloor = -4.4f;

    public static PostedPeople? I { get; private set; }
    public IReadOnlyList<Posted> List => list;
    /// <summary>The employers with work Jef can take, and those whose work he has in hand (the jobs part may set them; else read from the store).</summary>
    public HashSet<string>? OpenWork, TakenWork;

    private readonly List<Posted> list = new();
    private readonly List<Pt> lamps = new();
    private readonly Random rng = new();
    private Townspeople? town;
    private bool built;
    private double postT;

    public PostedPeople()
    {
        I = this;
    }

    public Posted? Get(string id) => list.FirstOrDefault(n => n.Id == id);

    private static bool InSpan(double h, (double from, double to) s)
    {
        double x = ((h % 24) + 24) % 24;
        return (x >= s.from && x < s.to) || (x + 24 >= s.from && x + 24 < s.to);
    }

    private static bool IsNight(double h) => h >= 19 || h < 6.5;

    public override void _Ready()
    {
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        if (town == null || !Humans.Ready) SetProcess(false);
    }

    private void Build()
    {
        built = true;
        var data = town!.Data!;
        // the doors and the lamps of the town's data (shared/city.json), the spots (shared/spots.json)
        var spots = new Dictionary<string, Pt>();
        var door = new Dictionary<string, (double x, double z, double ox, double oz)>();
        try
        {
            string city = Water.CityJson();
            using var doc = JsonDocument.Parse(File.ReadAllText(city));
            foreach (var l in doc.RootElement.GetProperty("decor").GetProperty("lamps").EnumerateArray()) lamps.Add(new Pt(l[0].GetDouble(), l[1].GetDouble()));
            foreach (var d in doc.RootElement.GetProperty("doors").EnumerateObject())
                if (d.Value.ValueKind == JsonValueKind.Object && d.Value.TryGetProperty("out", out var o))
                    door[d.Name] = (d.Value.GetProperty("x").GetDouble(), d.Value.GetProperty("z").GetDouble(), o[0].GetDouble(), o[1].GetDouble());
            using var sp = JsonDocument.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(city)!, "spots.json")));
            foreach (var s in sp.RootElement.EnumerateObject().Where(q => q.Value.ValueKind == JsonValueKind.Object)) spots[s.Name] = new Pt(s.Value.GetProperty("x").GetDouble(), s.Value.GetProperty("z").GetDouble());
        }
        catch (Exception e)
        {
            GD.PrintErr($"posted people: the town's data did not read ({e.Message}): the Rijnkaai's doors by their known places, no night posts under lamps");
        }
        // (world/city.ts doorSpot: d out of the door, `side` along the front)
        (double x, double z) DoorSpot(string name, double d, double side, double x0, double z0)
        {
            if (!door.TryGetValue(name, out var q)) return (x0, z0);
            return (q.x + q.ox * d - q.oz * side, q.z + q.oz * d + q.ox * side);
        }
        var sooi = DoorSpot("hessenatie", 1.6, -2.2, 12.93, 44.4);
        var peeters = DoorSpot("peeters", 1.3, -2.0, -33.13, 44.7);
        Add(new Posted { Id = "sooi", Name = "Sooi", Kind = "sooi", Home = (sooi.x, sooi.z, Math.PI) });
        Add(new Posted { Id = "peeters", Name = "Widow Peeters", Kind = "peeters", Home = (peeters.x, peeters.z, Math.PI) });
        Add(new Posted { Id = "tuur", Name = "Tuur", Kind = "tuur", Home = (8.0, -7.4, 0) });
        Add(new Posted { Id = "fientje", Name = "Fientje", Kind = "fientje", Home = (45.2, 10.2, -Math.PI / 2) });
        Add(new Posted { Id = "sailor", Name = "a sailor", Kind = "sailor", Home = (-38.5, -4.6, 0), Talks = false, OnDeck = true });
        // the board's employers: at their post, facing their spot
        foreach (var (id, spot) in data.Employers)
        {
            var r = data.Residents.FirstOrDefault(q => q.Id == id);
            if (r == null) continue;
            spots.TryGetValue(spot, out var sp);
            double bx = r.Work.At?[0] ?? sp.X + 1.2, bz = r.Work.At?[1] ?? sp.Z + 1.2;
            // a post a body cannot stand on: the nearest spot round it where one can
            (double x, double z) at = (bx, bz);
            if (!town.Walk!.Free(bx, bz))
            {
                var offsets = new List<(double, double)> { (0, 1.4), (0, 2.2), (-1.2, 1.4), (1.2, 1.4), (0, -2.2) };
                for (double rad = 2; rad <= 12; rad += 0.5)
                    for (int k = 0; k < 16; k++) offsets.Add((Math.Cos(k * Math.PI / 8) * rad, Math.Sin(k * Math.PI / 8) * rad));
                foreach (var (dx, dz) in offsets)
                    if (town.Walk.Free(bx + dx, bz + dz))
                    {
                        at = (bx + dx, bz + dz);
                        break;
                    }
            }
            string kind = Humans.IsKind(r.Kind) ? r.Kind : "docker_a";
            Add(new Posted { Id = id, Name = r.Name, Kind = kind, Resident = r, Home = (at.x, at.z, spots.ContainsKey(spot) ? Math.Atan2(sp.X - at.x, sp.Z - at.z) : r.Work.At?[2] ?? 0) });
        }
        GD.Print($"posted people: {list.Count} at their posts ({list.Count(n => n.Resident != null)} employers)");
    }

    private void Add(Posted n)
    {
        n.Human = Humans.Make(n.Kind);
        if (n.Human == null) return;
        n.Anchor = n.Home;
        (n.X, n.Z, n.Yaw) = n.Home;
        n.Facing = n.Yaw;
        n.GestureWait = 1 + rng.NextDouble() * 2;
        n.Group = new Node3D { Name = "posted_" + n.Id };
        n.Group.AddChild(n.Human.Root);
        Main.I.View.AddChild(n.Group);
        n.Human.Start();
        if (!n.OnDeck)
        {
            // solid for Jef (people.ts: a 0.7 m box round them, moved with them)
            n.Solid = new StaticBody3D { Name = "posted_body_" + n.Id, CollisionLayer = Solid.Layer, CollisionMask = 0 };
            n.Solid.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(0.7f, 1.7f, 0.7f) }, Position = new Vector3(0, 0.85f, 0) });
            Main.I.View.AddChild(n.Solid);
        }
        list.Add(n);
    }

    public override void _ExitTree()
    {
        foreach (var n in list) n.Human?.Dispose();
        if (I == this) I = null;
    }

    private void SetPresent(Posted n, bool on)
    {
        if (on && !n.Present) n.Round = null;
        n.Present = on;
        n.Group.Visible = on;
        if (n.Solid != null) n.Solid.CollisionLayer = on ? Solid.Layer : 0;
        if (!on)
        {
            n.Lantern = false;
            Lantern(n);
        }
    }

    /// <summary>After dark, someone with work for Jef stands by a lamp near the post; null: back to the post.</summary>
    private static void NightPost(Posted n, (double x, double z, double yaw)? at)
    {
        var to = at ?? n.Home;
        if (n.Anchor.x == to.x && n.Anchor.z == to.z) return;
        n.Anchor = to;
        n.Round = null;
        n.X = to.x;
        n.Z = to.z;
    }

    /// <summary>Who is at the post now, where, and who shows a light (town.ts postEmployers).</summary>
    private void Posts(int day, double hour)
    {
        bool dark = IsNight(hour);
        var open = OpenWork ?? new HashSet<string>(GameState.I.Jobs.Where(j => j.Status == "offered").Select(j => j.EmployerNpc));
        var taken = TakenWork ?? new HashSet<string>(GameState.I.Jobs.Where(j => j.Status == "taken").Select(j => j.EmployerNpc));
        foreach (var n in list)
        {
            if (n.Resident == null)
            {
                // the Rijnkaai's own: at the post in their hours, with a lantern after dark while their work is open
                bool here = !PostHours.TryGetValue(n.Id, out var span) || InSpan(hour, span);
                if (n.Present != here) SetPresent(n, here);
                n.Lantern = here && dark && open.Contains(n.Id) && PostHours.ContainsKey(n.Id);
                continue;
            }
            // at the post in working hours only
            bool work = Whereabouts.ActivityAt(n.Resident.Sched, day, hour).Act == "work";
            if (n.Present != work) SetPresent(n, work);
            if (!work)
            {
                n.Lantern = false;
                continue;
            }
            // a giver of night work keeps to his dark corner, a shaded lantern in his hand
            if (NightGivers.Contains(n.Id))
            {
                NightPost(n, null);
                n.Lantern = true;
                continue;
            }
            if (dark && (open.Contains(n.Id) || taken.Contains(n.Id)))
            {
                // under the nearest lamp within 25 m of the post; else a lantern in hand
                Pt? best = null;
                double bd = 25;
                foreach (var l in lamps)
                {
                    double d = Whereabouts.Hypot(l.X - n.Home.x, l.Z - n.Home.z);
                    if (d < bd)
                    {
                        bd = d;
                        best = l;
                    }
                }
                if (best != null)
                {
                    double x = best.Value.X + 0.9, z = best.Value.Z + 0.9;
                    bool free = town!.Walk!.Free(x, z);
                    NightPost(n, free ? (x, z, Math.Atan2(n.Home.x - x, n.Home.z - z)) : null);
                    n.Lantern = !free;
                }
                else
                {
                    NightPost(n, null);
                    n.Lantern = true;
                }
            }
            else
            {
                NightPost(n, null);
                n.Lantern = false;
            }
        }
    }

    public override void _Process(double delta)
    {
        if (town?.Paused == true) return;
        if (town?.Data == null || town.Walk == null) return;
        if (!built) Build();
        if ((postT -= delta) <= 0)
        {
            postT = 0.25;
            Posts(town.Day, town.Hour);
        }
        var jef = Jef.I is { Fly: false } j ? j : null;
        var cam = Main.I.Cam.GlobalPosition;
        double fog = town.Crowd?.FogDistance ?? 40;
        foreach (var n in list)
        {
            if (!n.Present) continue;
            double d = jef != null ? Whereabouts.Hypot(n.X - jef.X, n.Z - jef.Z) : double.PositiveInfinity;
            Func<double, double, bool> free = town.Walk.Free;
            if (n.Round == null)
            {
                int seed = n.Id.Sum(c => (int)c);
                var home = (n.Anchor.x, n.Anchor.z);
                if (!free(home.x, home.z))
                {
                    bool found = false;
                    foreach (double r in new[] { 0.4, 0.8, 1.2 })
                    {
                        for (int i = 0; i < 16 && !found; i++)
                        {
                            double a = i * Math.PI / 8;
                            var q = (home.x + Math.Sin(a) * r, home.z + Math.Cos(a) * r);
                            if (!free(q.Item1, q.Item2)) continue;
                            home = q;
                            found = true;
                        }
                        if (found) break;
                    }
                }
                var routes = LocalRound.RoundRoutes(home, free, seed, n.OnDeck ? 1.1 : 2.5);
                if (routes.Count == 0) routes = LocalRound.RoundRoutes(home, free, seed, 0.8);
                n.Round = new LocalRound(home, routes, seed);
            }
            n.Round.Update(delta, d < 3.2, free);
            n.X = n.Round.X;
            n.Z = n.Round.Z;
            n.Y = n.OnDeck ? Math.Max(Tide.LevelAt(-40, -7.2f), BrigFloor) + DeckOverWater : town.Walk.BaseAt(n.X, n.Z);
            // walking: the way he goes; Jef within six metres: he looks at him; else as he stands at the post
            if (n.Round.Walking) n.Facing = n.Round.Yaw;
            else if (d < 6) n.Facing = Math.Atan2(jef!.X - n.X, jef.Z - n.Z);
            else n.Facing = n.Anchor.yaw;
            n.Yaw += Math.Atan2(Math.Sin(n.Facing - n.Yaw), Math.Cos(n.Facing - n.Yaw)) * Math.Min(1, delta * 3);
            n.Group.Position = new Vector3((float)n.X, (float)n.Y, (float)n.Z);
            n.Group.Rotation = new Vector3(0, (float)n.Yaw, 0);
            if (n.Solid != null) n.Solid.Position = n.Group.Position;
            Lantern(n);
            // in the fog nobody sees his hands move
            if (Whereabouts.Hypot(n.X - cam.X, n.Z - cam.Z) < fog + 4) Animate(n, delta, d);
        }
    }

    /// <summary>A lit lantern in the right hand, and its light on the world (Carried.cs).</summary>
    private static void Lantern(Posted n)
    {
        if (n.Lantern && n.LanternNode == null)
        {
            n.LanternNode = Carried.Lantern();
            Main.I.View.AddChild(n.LanternNode);
            n.Light = LanternPool.I?.Add();
        }
        else if (!n.Lantern && n.LanternNode != null)
        {
            n.LanternNode.QueueFree();
            n.LanternNode = null;
            LanternPool.I?.Remove(n.Light);
            n.Light = null;
        }
        if (n.LanternNode == null) return;
        var hand = n.Human!.Hand(true);
        n.LanternNode.Position = hand != null ? hand.Value - new Vector3(0, 0.12f, 0) : new Vector3((float)n.X + 0.3f, (float)n.Y + 0.75f, (float)n.Z + 0.15f);
        if (n.Light != null)
        {
            n.Light.Pos = n.LanternNode.Position - new Vector3(0, 0.08f, 0);
            n.Light.On = true;
        }
        Carried.FaceHalo(n.LanternNode, Main.I.Cam.GlobalPosition);
    }

    /// <summary>Idle; when Jef stands close, now and then a few words with the hands.</summary>
    private void Animate(Posted n, double dt, double d)
    {
        var h = n.Human!;
        if (n.Round is { Walking: true })
        {
            h.Play("walk");
            h.SetPace((float)n.Round.Speed);
        }
        else if (n.Talks && d < 3.2)
        {
            if (n.Gesture > 0)
            {
                n.Gesture -= dt;
                if (n.Gesture <= 0)
                {
                    h.Play("idle", 0.5f);
                    n.GestureWait = 3 + rng.NextDouble() * 5;
                }
            }
            else if ((n.GestureWait -= dt) <= 0)
            {
                h.Play("talk", 0.4f);
                n.Gesture = h.LoopTime * (1 + rng.Next(2));
            }
        }
        else if (h.Motion != "idle")
        {
            n.Gesture = 0;
            h.Play("idle", 0.5f);
        }
        h.Update((float)dt);
    }
}

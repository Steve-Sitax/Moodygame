using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Town;

/// <summary>
/// The people inside the houses that stand in the world with their rooms (shared/inworld_houses.json: taverns and
/// shops): a tavern's keeper and drinkers and a shop's keeper and callers go in at the open door instead of standing
/// before it (the browser's game/interiors.ts tavernOpen), and are seen inside, through the door and the windows.
/// Here they stand about the room on its floor (the walk dump knows the rooms' floors), the keeper at the back,
/// turning to talk to one another. The browser seats them at the tables and the counter by the room's own plan
/// (interiors.ts, shared/housePlan.ts), and keeps the homes' routines (homes.ts) and the landmark halls' people
/// (landmarks.ts): those plans are not ported yet.
/// Whether a door stands open is the doors' part: Townspeople.DoorAt answers when it is set; until then a house is
/// open while its keeper is at work.
/// </summary>
public sealed class Indoors
{
    public sealed class House
    {
        public string Id = "", Kind = "";
        public Pt Door, Out;
        /// <summary>Where the town sends those who go in (the place's point, a shop's door step).</summary>
        public Pt Goal;
        public Resident? Keeper;
        internal List<Pt>? Spots;
        internal readonly Dictionary<string, Figure> Figures = new();
    }

    internal sealed class Figure
    {
        public Human Human = null!;
        public Node3D Group = null!;
        public double Yaw, Want, Wait;
        public int Spot;
    }

    private const double DrawR = 45, AnimR = 28;
    private const int PerHouse = 10, MostFigures = 28;

    public readonly List<House> Houses = new();
    private readonly Dictionary<string, House> byPlace = new();
    private readonly Townspeople town;
    private readonly Random rng = new();
    private double turn;
    public int Drawn { get; private set; }

    public Indoors(Townspeople town)
    {
        this.town = town;
        var data = town.Data!;
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Water.CityJson())!, "inworld_houses.json");
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            foreach (var h in doc.RootElement.GetProperty("houses").EnumerateArray())
            {
                string id = h.GetProperty("id").GetString() ?? "", kind = h.GetProperty("kind").GetString() ?? "";
                if (kind is not ("tavern" or "shop")) continue;
                var d = h.GetProperty("door");
                var house = new House { Id = id, Kind = kind, Door = new Pt(d[0].GetDouble(), d[1].GetDouble()) };
                if (kind == "tavern")
                {
                    if (!data.Places.TryGetValue(id, out var pl)) continue;
                    house.Out = pl.Out ?? new Pt(0, -1);
                    house.Goal = new Pt(pl.X, pl.Z);
                    house.Keeper = data.Residents.FirstOrDefault(r => r.Work.Kind == "tavern" && r.Work.Place == id);
                }
                else
                {
                    var shop = data.Shops.FirstOrDefault(s => "shop:" + s.Id == id);
                    if (shop == null) continue;
                    house.Out = shop.Out;
                    data.Places.TryGetValue(shop.Id, out var pl);
                    house.Goal = pl?.Door ?? (pl != null ? new Pt(pl.X, pl.Z) : shop.Door);
                    house.Keeper = data.Residents.FirstOrDefault(r => r.Id == shop.Keeper);
                }
                Houses.Add(house);
                byPlace[id] = house;
            }
        }
        catch (Exception e)
        {
            GD.PrintErr($"indoors: the list of houses with rooms did not read ({e.Message}): people stand before the doors");
        }
    }

    /// <summary>Is this tavern or shop ("tavern:x", "shop:id") in the world with its door open, so its people go in?</summary>
    public bool Open(string place)
    {
        if (!byPlace.TryGetValue(place, out var h)) return false;
        if (town.DoorAt?.Invoke(place) is { } open) return open;
        return h.Keeper != null && Whereabouts.ActivityAt(h.Keeper.Sched, town.Day, town.Hour).Act == "work";
    }

    /// <summary>The room's standing spots: its floor behind the door, a metre apart, the deepest first (the keeper's).</summary>
    private List<Pt> SpotsOf(House h)
    {
        if (h.Spots != null) return h.Spots;
        var walk = town.Walk!;
        var seen = new HashSet<(int, int)>();
        var queue = new Queue<(int, int)>();
        var cells = new List<Pt>();
        // from a step inside the door, over the floor a body fits on, never back out through the door's plane
        for (double inStep = 1.0; inStep <= 2.5 && queue.Count == 0; inStep += 0.5)
        {
            double sx = h.Door.X - h.Out.X * inStep, sz = h.Door.Z - h.Out.Z * inStep;
            if (walk.Free(sx, sz)) queue.Enqueue(((int)Math.Round(sx * 2), (int)Math.Round(sz * 2)));
        }
        foreach (var c in queue) seen.Add(c);
        while (queue.Count > 0 && cells.Count < 600)
        {
            var (ix, iz) = queue.Dequeue();
            double x = ix / 2.0, z = iz / 2.0;
            cells.Add(new Pt(x, z));
            foreach (var (dx, dz) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
            {
                var n = (ix + dx, iz + dz);
                double nx = n.Item1 / 2.0, nz = n.Item2 / 2.0;
                if (seen.Contains(n) || !walk.Free(nx, nz)) continue;
                double behind = -((nx - h.Door.X) * h.Out.X + (nz - h.Door.Z) * h.Out.Z);
                if (behind < 0.7 || Whereabouts.Hypot(nx - h.Door.X, nz - h.Door.Z) > 9) continue;
                seen.Add(n);
                queue.Enqueue(n);
            }
        }
        var spots = new List<Pt>();
        foreach (var c in cells.OrderByDescending(c => Whereabouts.Hypot(c.X - h.Door.X, c.Z - h.Door.Z)))
        {
            if (spots.Count >= PerHouse) break;
            // a metre from the next, and room round the body
            if (spots.Any(s => Whereabouts.Hypot(s.X - c.X, s.Z - c.Z) < 1.1)) continue;
            if (!walk.Free(c.X + 0.3, c.Z) || !walk.Free(c.X - 0.3, c.Z) || !walk.Free(c.X, c.Z + 0.3) || !walk.Free(c.X, c.Z - 0.3)) continue;
            spots.Add(c);
        }
        return h.Spots = spots;
    }

    /// <summary>Who is inside this house now: those who went in at its door (the keeper first).</summary>
    public List<Townspeople.Sim> Inside(House h) => town.Sims
        .Where(s => s.Inside && s.Goal.Mode == "inside" && Math.Abs(s.Goal.X - h.Goal.X) < 0.6 && Math.Abs(s.Goal.Z - h.Goal.Z) < 0.6)
        .OrderBy(s => s.R == h.Keeper ? 0 : 1).ThenBy(s => s.R.Id, StringComparer.Ordinal).ToList();

    public void Update(double dt, Vector3 eye)
    {
        turn -= dt;
        bool roster = turn <= 0;
        if (roster) turn = 0.5;
        int drawn = 0;
        foreach (var h in Houses)
        {
            double d = Whereabouts.Hypot(h.Door.X - eye.X, h.Door.Z - eye.Z);
            if (roster)
            {
                var want = d < DrawR ? Inside(h).Take(PerHouse).ToList() : new List<Townspeople.Sim>();
                var spots = want.Count > 0 ? SpotsOf(h) : new List<Pt>();
                foreach (var id in h.Figures.Keys.Where(id => want.All(s => s.R.Id != id)).ToList()) Drop(h, id);
                for (int i = 0; i < want.Count && i < spots.Count; i++)
                {
                    var s = want[i];
                    if (h.Figures.ContainsKey(s.R.Id) || Houses.Sum(q => q.Figures.Count) >= MostFigures) continue;
                    // the keeper at the back; the others on the spots nobody has yet
                    int spot = Enumerable.Range(0, spots.Count).First(k => h.Figures.Values.All(f => f.Spot != k));
                    var human = Humans.Make(Humans.IsKind(s.Kind) ? s.Kind : "docker_a");
                    if (human == null) continue;
                    var at = spots[spot];
                    var g = new Node3D { Name = "indoors_" + s.R.Id };
                    g.AddChild(human.Root);
                    Main.I.View.AddChild(g);
                    var body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 };
                    body.AddChild(new CollisionShape3D { Shape = new CylinderShape3D { Radius = 0.3f, Height = 1.5f }, Position = new Vector3(0, 0.75f, 0) }); g.AddChild(body);
                    human.Start();
                    double yaw = Math.Atan2(h.Door.X - at.X, h.Door.Z - at.Z);
                    g.Position = new Vector3((float)at.X, (float)town.Walk!.BaseAt(at.X, at.Z), (float)at.Z);
                    g.Rotation = new Vector3(0, (float)yaw, 0);
                    h.Figures[s.R.Id] = new Figure { Human = human, Group = g, Yaw = yaw, Want = yaw, Spot = spot, Wait = rng.NextDouble() * 4 };
                }
            }
            if (h.Figures.Count == 0) continue;
            drawn += h.Figures.Count;
            if (d > AnimR) continue;
            var list = h.Figures.Values.ToList();
            foreach (var f in list)
            {
                if ((f.Wait -= dt) <= 0)
                {
                    // a word with the nearest other, or a look to the door
                    var p = f.Group.Position;
                    var other = list.Where(o => o != f).OrderBy(o => o.Group.Position.DistanceSquaredTo(p)).FirstOrDefault();
                    bool talk = other != null && rng.NextDouble() < 0.5;
                    f.Want = other != null && rng.NextDouble() < 0.8 ? Math.Atan2(other.Group.Position.X - p.X, other.Group.Position.Z - p.Z) : Math.Atan2(h.Door.X - p.X, h.Door.Z - p.Z);
                    f.Human.Play(talk ? "talk" : f.Human.Woman || rng.NextDouble() < 0.5 ? "idle" : "fold", 0.4f);
                    f.Wait = talk ? 2.5 + rng.NextDouble() * 3 : 4 + rng.NextDouble() * 7;
                }
                f.Yaw += Math.Atan2(Math.Sin(f.Want - f.Yaw), Math.Cos(f.Want - f.Yaw)) * Math.Min(1, dt * 3);
                f.Group.Rotation = new Vector3(0, (float)f.Yaw, 0);
                f.Human.Update((float)dt);
            }
        }
        Drawn = drawn;
    }

    private static void Drop(House h, string id)
    {
        if (!h.Figures.Remove(id, out var f)) return;
        f.Group.QueueFree();
    }

    /// <summary>For a check: every figure drawn inside.</summary>
    public IEnumerable<Node3D> Groups => Houses.SelectMany(h => h.Figures.Values.Select(f => f.Group));
    public Vector3? PositionOf(string id) => Houses.SelectMany(h => h.Figures).FirstOrDefault(p => p.Key == id).Value?.Group.GlobalPosition;

    public void Dispose()
    {
        foreach (var h in Houses)
            foreach (var id in h.Figures.Keys.ToList()) Drop(h, id);
    }
}

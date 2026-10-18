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
/// (interiors.ts, shared/housePlan.ts): their seated table allocation still needs porting. Home visitors and
/// landmark rosters live in HomeVisitors and HallPeople.
/// Whether a door stands open is the doors' part: Townspeople.DoorAt answers when it is set; until then a house is
/// open while its keeper is at work.
/// </summary>
public sealed partial class Indoors
{
    public sealed class House
    {
        public string Id = "", Kind = "";
        public Pt Door, Out;
        public readonly List<Pt> EntryLane=new();
        /// <summary>Where the town sends those who go in (the place's point, a shop's door step).</summary>
        public Pt Goal;
        public Resident? Keeper;
        /// <summary>Where the keeper behind the counter looks when not talking: the customers' side of the bar.</summary>
        public Pt? Serve;
        internal List<Pt>? Spots;
        internal readonly Dictionary<string, Figure> Figures = new();
        internal readonly List<Townspeople.Sim> Wanted = new(PerHouse);
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
    /// <summary>A drawn indoor figure's node and its standing place (for checks).</summary>
    public (Node3D Group,int Spot)? FigureNode(House h,string id)=>h.Figures.TryGetValue(id,out var f)?(f.Group,f.Spot):null;
    public (Vector3 At,string Motion)? FigureAt(string room,string id)
    {
        var house=Houses.FirstOrDefault(h=>h.Id==room);
        return house!=null && house.Figures.TryGetValue(id,out var figure)?(figure.Group.GlobalPosition,figure.Human.Motion??""):null;
    }
    private readonly Dictionary<string, House> byPlace = new();
    private readonly Townspeople town;
    private readonly Random rng = new();
    private double turn;
    public int Drawn { get; private set; }

    public Indoors(Townspeople town)
    {
        this.town = town;
        clearanceQuery.Exclude=new Godot.Collections.Array<Rid>{Scheldemist.Player.Jef.I.Body.GetRid()};
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
                if(Main.I.World.NativeRoom(id) is {} room)
                {house.Door=new(room.Frame.Origin.X,room.Frame.Origin.Z);var outward=-room.Frame.Basis.Z.Normalized();house.Out=new(outward.X,outward.Z);}
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
        return h.Spots = RoomSpots(h);
    }

    /// <summary>Who is inside this house now: those who went in at its door (the keeper first).</summary>
    private sealed class InsideOrder : IComparer<Townspeople.Sim>
    {
        public Resident? Keeper;
        public int Compare(Townspeople.Sim? a, Townspeople.Sim? b)
        {
            int keeper = (a!.R == Keeper ? 0 : 1).CompareTo(b!.R == Keeper ? 0 : 1);
            return keeper != 0 ? keeper : StringComparer.Ordinal.Compare(a.R.Id, b.R.Id);
        }
    }
    private readonly InsideOrder insideOrder = new();
    private readonly List<string> removed = new(PerHouse);
    private static readonly List<Pt> NoSpots = new();
    public List<Townspeople.Sim> Inside(House h)
    {
        var want = h.Wanted;
        want.Clear();
        for (int i = 0; i < town.Sims.Count; i++)
        {
            var s = town.Sims[i];
            if (s.Inside && s.Goal.Mode == "inside" && Math.Abs(s.Goal.X - h.Goal.X) < 0.6 && Math.Abs(s.Goal.Z - h.Goal.Z) < 0.6) want.Add(s);
        }
        insideOrder.Keeper = h.Keeper;
        want.Sort(insideOrder);
        return want;
    }

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
                var want = h.Wanted;
                if (d < DrawR) { Inside(h); if (want.Count > PerHouse) want.RemoveRange(PerHouse, want.Count - PerHouse); }
                else want.Clear();
                var spots = want.Count > 0 ? SpotsOf(h) : NoSpots;
                removed.Clear();
                foreach (string id in h.Figures.Keys)
                {
                    bool keep = false;
                    foreach (var person in want) if (person.R.Id == id) { keep = true; break; }
                    if (!keep && Scheldemist.Talks.ConversationHold.I?.Held(id)!=true) removed.Add(id);
                }
                foreach (string id in removed) Drop(h, id);
                int total = 0;
                foreach (var house in Houses) total += house.Figures.Count;
                for (int i = 0; i < want.Count && i < spots.Count; i++)
                {
                    var s = want[i];
                    if (h.Figures.ContainsKey(s.R.Id) || total >= MostFigures) continue;
                    // the keeper at the back; the others on the spots nobody has yet
                    int spot = h.Serve != null && s.R != h.Keeper ? 1 : 0;
                    for (; spot < spots.Count; spot++)
                    {
                        bool taken = false;
                        foreach (var figure in h.Figures.Values) if (figure.Spot == spot) { taken = true; break; }
                        if (!taken) break;
                    }
                    if (spot == spots.Count) continue;
                    var human = Humans.Make(s.Kind) ?? Humans.Make("docker_a");
                    if (human == null) continue;
                    var at = spots[spot];
                    var g = new Node3D { Name = "indoors_" + s.R.Id };
                    g.AddChild(human.Root);
                    Main.I.View.AddChild(g);
                    total++;
                    human.SetIndoor(true);
                    human.SetIdentity(s.R.Id);
                    human.Start();
                    var look = spot == 0 && h.Serve is { } serve ? serve : h.Door;
                    double yaw = Math.Atan2(look.X - at.X, look.Z - at.Z);
                    g.Position = new Vector3((float)at.X, FloorY(h,at), (float)at.Z);
                    g.Rotation = new Vector3(0, (float)yaw, 0);
                    h.Figures[s.R.Id] = new Figure { Human = human, Group = g, Yaw = yaw, Want = yaw, Spot = spot, Wait = rng.NextDouble() * 4 };
                }
            }
            if (h.Figures.Count == 0) continue;
            drawn += h.Figures.Count;
            if (d > AnimR) continue;
            var list = h.Figures.Values;
            foreach (var pair in h.Figures)
            {
                var f=pair.Value;
                Yield(h,f,dt,eye);
                if(Scheldemist.Talks.ConversationHold.I?.Facing(pair.Key) is {} facing)
                {var p=f.Group.Position;bool seated=f.Human.Motion=="sit";f.Human.FaceConversation(new(facing.X,p.Y+1.6f,facing.Y),seated);if(!seated){f.Want=Math.Atan2(facing.X-p.X,facing.Y-p.Z);f.Human.Play("talk",.25f);}f.Wait=1;}
                else f.Human.FaceConversation(null);
                if ((f.Wait -= dt) <= 0)
                {
                    // a word with the nearest other, or a look to the door
                    var p = f.Group.Position;
                    Figure? other = null;
                    float distance = float.PositiveInfinity;
                    foreach (var candidate in list)
                    {
                        if (candidate == f) continue;
                        float gap = candidate.Group.Position.DistanceSquaredTo(p);
                        if (gap < distance) { other = candidate; distance = gap; }
                    }
                    bool talk = other != null && rng.NextDouble() < 0.5;
                    var look = f.Spot == 0 && h.Serve is { } serve ? serve : h.Door;
                    f.Want = other != null && rng.NextDouble() < 0.8 ? Math.Atan2(other.Group.Position.X - p.X, other.Group.Position.Z - p.Z) : Math.Atan2(look.X - p.X, look.Z - p.Z);
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
        f.Human.Dispose();
        f.Group.QueueFree();
    }

    /// <summary>For a check: every figure drawn inside.</summary>
    public IEnumerable<Human> Models(House h) => h.Figures.Values.Select(f=>f.Human);
    public IEnumerable<Node3D> Groups => Houses.SelectMany(h => h.Figures.Values.Select(f => f.Group));
    public Vector3? PositionOf(string id)
    {
        if (town.ActionPerson(id) is { ActionHeld: true, Inside: false }) return null;
        foreach (var h in Houses) if (h.Figures.TryGetValue(id, out var figure)) return figure.Group.GlobalPosition;
        return null;
    }

    public void Dispose()
    {
        foreach (var h in Houses)
            foreach (var id in h.Figures.Keys.ToList()) Drop(h, id);
        clearanceQuery.Dispose();clearanceShape.Dispose();
    }
}

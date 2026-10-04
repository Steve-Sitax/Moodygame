using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The doors of the town that open (world/houseInWorld.ts, hallInWorld.ts, cathedralInWorld.ts; game/interiors.ts,
/// game/landmarks.ts). In the browser no key opens a door: a door stands open or shut as the server says (a shop
/// while its keeper is at work, a tavern, the Poesje from half past six, the landmarks by their hours) or by the
/// clock (the three churches, six to seven), the leaf turns by itself and Jef walks in. E shows only at a shut
/// door ("try the door of ..."), and says why it is shut.
///
/// The leaves are the bake's own nodes: a house's hinge is the first child of `house_&lt;place&gt;`; a hall's and the
/// cathedral's leaves have no names and are found by their material (`&lt;hall&gt;_leaf`, `cath_door_oak`). The bake
/// froze every leaf as it stood at 13:00; from there they turn as the browser turns them (a house in about a
/// second, a hall's heavy leaves at 0.55 rad a second). A shut door is solid (a box in the doorway, on Solid's
/// layer); an open one is passed. As in the browser nobody carries goods in through a house door.
/// </summary>
[GamePart(62)]
public partial class Doors : Node
{
    public static Doors I { get; private set; } = null!;

    // houseInWorld.ts
    private const float HouseOpen = 1.45f; // rad
    private const float HouseRate = 0.9f; // of the whole swing a second
    private const float HallRate = 0.55f; // rad a second
    /// <summary>The leaf has really swung: the doorway can be passed (houseInWorld.ts, hallInWorld.ts).</summary>
    private const float Passable = 0.08f;
    private const float ReachDoor = 1.8f; // interiors.ts
    private const float ReachLandmark = 2.0f; // landmarks.ts
    private const double ShopsEveryS = 15, LandmarksEveryS = 12;

    public sealed class Leaf
    {
        public Node3D Hinge = null!;
        /// <summary>The hinge's turn when the door stands wide open (radians, signed).</summary>
        public float OpenAngle;
    }

    public sealed class Door
    {
        /// <summary>"shop:bakery_rijn", "tavern:ankere", "poesje", "home:cellar"; a landmark door's id ("townhall_main"); a church ("carolus").</summary>
        public string Id = "";
        /// <summary>"shop", "tavern", "poesje", "home", "landmark" or "church".</summary>
        public string Kind = "";
        public string Label = "";
        public List<Leaf> Leaves = new();
        /// <summary>How far open it stands now, 0 to 1, and where it is going.</summary>
        public float Open, Target;
        /// <summary>The server (or the clock) has said whether it is open; until then it stands as the bake left it.</summary>
        public bool Known;
        /// <summary>The middle of the doorway on the wall line, and the step in the street before it.</summary>
        public Vector3 Middle;
        public Vector2 Step;
        public string? Keeper;
        public int PriceC;
        public string Landmark = "";
        internal StaticBody3D? Body;
        internal CollisionShape3D? Shape;
        /// <summary>It never opens here (shut in the bake, and nothing says which way it turns).</summary>
        public bool Fixed;
        /// <summary>Held open or shut by a check (Doors.Force); what the server last said waits in Said.</summary>
        public bool Forced;
        public bool? Said;
        public bool CanPass => Shape == null || Shape.Disabled;
    }

    private readonly List<Door> doors = new();
    private readonly Offers keyOffers = new() { Options = new() };
    public IReadOnlyList<Door> All => doors;
    public Door? Get(string id)
    {
        if (!Dev.SpeedComparison.Cached) return GetOriginal(id);
        foreach (var door in doors) if (door.Id == id) return door;
        return null;
    }
    private Door? GetOriginal(string id) => doors.FirstOrDefault(d => d.Id == id);

    /// <summary>Is Jef carrying goods (the goods' part says)? Then no house door lets him in.</summary>
    public Func<bool> HandsFull { get; set; } = () => false;

    private double sinceShops = 1e9, sinceLandmarks = 1e9;
    private bool askedShops, askedLandmarks;
    private double saidFull;

    // shared/landmarks.ts
    private static readonly Dictionary<string, string> LandmarkLabel = new()
    {
        ["cathedral"] = "the cathedral",
        ["townhall"] = "the town hall",
        ["vleeshuis"] = "the Vleeshuis",
        ["steen"] = "the museum in the Steen",
        ["oostershuis"] = "the Oostershuis",
    };
    private static readonly Dictionary<string, string> ClosedText = new()
    {
        ["cathedral"] = "The west door is shut for the night. The cathedral opens at six in the morning.",
        ["townhall"] = "The town hall's door is shut. The offices open at nine on weekdays.",
        ["vleeshuis"] = "The Vleeshuis is locked. Peyrot's cellar opens at seven on weekdays.",
        ["steen"] = "A board by the door: \"MUSEUM OF ANTIQUITIES. Open from ten till four. Admission free.\" The door is shut.",
        ["oostershuis"] = "The gate of the Oostershuis is barred. The State's warehouse opens at seven on weekdays.",
    };
    /// <summary>The churches that open by the clock alone, six to seven in the evening (carolusHall.ts, gothicHall.ts).</summary>
    private static readonly string[] Churches = { "carolus", "stpaul", "stjacob" };

    public Doors()
    {
        I = this;
        // the leaves turn: Solid leaves them out, the doorway's own box stands in
        Solid.Leave.Add(IsLeafNode);
    }

    // ------------------------------------------------------------------ finding the leaves in the bake

    private static bool IsHouse(Node n)
    {
        string s = n.Name.ToString();
        if (!s.StartsWith("house_", StringComparison.Ordinal)) return false;
        if (s.StartsWith("house_lining_", StringComparison.Ordinal) || s.StartsWith("house_glow_", StringComparison.Ordinal)) return false;
        return !(s.EndsWith("_openings", StringComparison.Ordinal) || s.EndsWith("_light_well", StringComparison.Ordinal) || s.EndsWith("_grating", StringComparison.Ordinal) || s.EndsWith("_in", StringComparison.Ordinal));
    }

    /// <summary>A house's hinge: the first child of `house_&lt;place&gt;` (houseInWorld.ts street.children[0]).</summary>
    private static Node3D? HouseHinge(Node house)
    {
        foreach (var c in house.GetChildren())
            if (c is Node3D n3 && c is not MeshInstance3D)
                return n3;
        return null;
    }

    private static string LeafMaterial(Node n)
    {
        if (n is not MeshInstance3D { Mesh: not null } mi) return "";
        for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
        {
            string name = mi.Mesh.SurfaceGetMaterial(s)?.ResourceName ?? "";
            if (name == "cath_door_oak") return "cathedral";
            if (name.EndsWith("_leaf", StringComparison.Ordinal) && name != "house_leaf") return name[..^5];
        }
        return "";
    }

    /// <summary>Solid asks: is this node a leaf that turns (so it gets no wall of its own)?</summary>
    private static bool IsLeafNode(Node n)
    {
        var p = n.GetParent();
        if (p != null && IsHouse(p) && HouseHinge(p) == n) return true;
        return HallOf(n) != "";
    }

    /// <summary>A hall's hinge: a group of meshes only, one of them in the hall's leaf material (the frame above it holds groups too). "": not one.</summary>
    private static string HallOf(Node n)
    {
        if (n is MeshInstance3D || n is not Node3D || n.GetChildCount() == 0) return "";
        string hall = "";
        foreach (var c in n.GetChildren())
        {
            if (c is not MeshInstance3D) return "";
            string m = LeafMaterial(c);
            if (m != "") hall = m;
        }
        return hall;
    }

    public override void _Ready()
    {
        var world = Main.I.World;
        var halls = new Dictionary<string, List<Node3D>>();
        foreach (var n in BakedWorld.All(world))
        {
            if (IsHouse(n) && n is Node3D house && HouseHinge(n) is { } hinge)
            {
                // rotation.y = -dir * open * 1.45 with dir = -sign(hingeX)
                float sign = hinge.Position.X >= 0 ? 1 : -1;
                var d = new Door
                {
                    Id = n.Name.ToString()["house_".Length..],
                    Kind = "house",
                    Leaves = { new Leaf { Hinge = hinge, OpenAngle = sign * HouseOpen } },
                    Open = Math.Clamp(MathF.Abs(hinge.Rotation.Y) / HouseOpen, 0, 1),
                };
                d.Target = d.Open;
                doors.Add(d);
                continue;
            }
            string hall = HallOf(n);
            if (hall == "") continue;
            if (!halls.TryGetValue(hall, out var list)) halls[hall] = list = new List<Node3D>();
            list.Add((Node3D)n);
        }
        // a hall's leaves: those of one doorway stand within a few metres of each other
        foreach (var (hall, hinges) in halls)
        {
            var left = new List<Node3D>(hinges);
            while (left.Count > 0)
            {
                var first = left[0];
                var set = left.Where(h => h.GlobalPosition.DistanceTo(first.GlobalPosition) < 6.5f).ToList();
                left.RemoveAll(set.Contains);
                var d = new Door { Id = hall, Kind = Churches.Contains(hall) ? "church" : "hall", Landmark = hall };
                foreach (var h in set) d.Leaves.Add(new Leaf { Hinge = h, OpenAngle = h.Rotation.Y });
                // shut in the bake: the way it opens is not known here, so it stays shut (the prison, the governor's door)
                d.Fixed = d.Leaves.All(l => MathF.Abs(l.OpenAngle) < 0.2f);
                d.Open = d.Target = d.Fixed ? 0 : 1;
                doors.Add(d);
            }
        }
        foreach (var d in doors) MakeBody(d);
        Main.I.World.Report["doors"] = doors.Count;
        GD.Print($"doors: {doors.Count(d => d.Kind == "house")} house doors, {doors.Count(d => d.Kind != "house")} hall doors; open in the bake: {doors.Count(d => d.Open > 0.5f)}");
        Interact.I?.AddProvider(Keys);
        GameState.I.ClockChanged += ByTheClock;
    }

    /// <summary>The doorway's box: where the leaves are when shut, a little thicker than the leaf.</summary>
    private void MakeBody(Door d)
    {
        var frame = d.Leaves[0].Hinge.GetParent() as Node3D;
        if (frame == null) return;
        var inv = frame.GlobalTransform.AffineInverse();
        Aabb? box = null;
        foreach (var leaf in d.Leaves)
        {
            var was = leaf.Hinge.Rotation;
            leaf.Hinge.Rotation = new Vector3(was.X, 0, was.Z);
            foreach (var n in BakedWorld.All(leaf.Hinge))
            {
                if (n is not MeshInstance3D { Mesh: not null } mi) continue;
                var b = (inv * mi.GlobalTransform) * mi.Mesh.GetAabb();
                box = box == null ? b : box.Value.Merge(b);
            }
            leaf.Hinge.Rotation = was;
        }
        if (box == null) return;
        var a = box.Value;
        var size = new Vector3(Math.Max(a.Size.X, 0.3f), Math.Max(a.Size.Y, 1.9f), Math.Max(a.Size.Z, 0.3f));
        // (the narrow way is the wall's thickness: whichever of x and z is the thin one)
        var centre = a.GetCenter();
        d.Shape = new CollisionShape3D { Shape = new BoxShape3D { Size = size }, Position = centre };
        d.Body = new StaticBody3D { Name = "door_" + Spots.BakedName(d.Id), CollisionLayer = Solid.Layer, CollisionMask = 0 };
        d.Body.AddChild(d.Shape);
        Main.I.View.AddChild(d.Body);
        d.Body.GlobalTransform = frame.GlobalTransform;
        d.Middle = frame.GlobalTransform * new Vector3(centre.X, a.Position.Y + 1.1f, centre.Z);
        d.Step = new Vector2(d.Middle.X, d.Middle.Z);
        d.Shape.Disabled = d.Open > Passable;
    }

    // ------------------------------------------------------------------ what the server says

    private Door? House(string place)
    {
        string name = Spots.BakedName("house_" + place);
        return doors.FirstOrDefault(d => d.Kind is "house" or "shop" or "tavern" or "poesje" or "home" && ("house_" + d.Id) == name);
    }

    private static Vector2 Pair(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle());

    private void AskShops()
    {
        var api = ServerLink.I?.Api;
        if (api == null || askedShops) return;
        askedShops = true;
        sinceShops = 0;
        api.Run(api.Get<JsonElement>("api/shops"), r =>
        {
            askedShops = false;
            foreach (var s in r.GetProperty("shops").EnumerateArray())
            {
                var d = House("shop:" + s.GetProperty("place").GetString());
                if (d == null) continue;
                d.Kind = "shop";
                d.Label = s.GetProperty("label").GetString() ?? "";
                d.Step = Pair(s.GetProperty("door"));
                d.Keeper = s.TryGetProperty("keeper", out var k) && k.ValueKind == JsonValueKind.Object ? k.GetProperty("first").GetString() : null;
                Set(d, s.GetProperty("open").GetBoolean());
            }
        }, _ => askedShops = false);
        api.Run(api.Get<JsonElement>("api/interiors"), r =>
        {
            foreach (var t in r.GetProperty("taverns").EnumerateArray())
            {
                var d = House(t.GetProperty("place").GetString() ?? "");
                if (d == null) continue;
                d.Kind = "tavern";
                d.Label = t.GetProperty("label").GetString() ?? "";
                d.Step = Pair(t.GetProperty("door"));
                d.Keeper = t.TryGetProperty("keeper", out var k) && k.ValueKind == JsonValueKind.Object && k.TryGetProperty("first", out var f) ? f.GetString() : null;
                Set(d, t.GetProperty("open").GetBoolean());
            }
            if (r.TryGetProperty("poesje", out var p) && p.ValueKind == JsonValueKind.Object && House("poesje") is { } pd)
            {
                pd.Kind = "poesje";
                pd.Label = p.GetProperty("label").GetString() ?? "";
                pd.Step = Pair(p.GetProperty("door"));
                pd.PriceC = p.GetProperty("price_c").GetInt32();
                Set(pd, p.GetProperty("open").GetBoolean());
            }
        });
    }

    private void AskLandmarks()
    {
        var api = ServerLink.I?.Api;
        if (api == null || askedLandmarks) return;
        askedLandmarks = true;
        sinceLandmarks = 0;
        api.Run(api.Get<JsonElement>("api/landmarks"), r =>
        {
            askedLandmarks = false;
            foreach (var l in r.GetProperty("doors").EnumerateArray())
            {
                var step = Pair(l.GetProperty("step"));
                var o = Pair(l.GetProperty("out"));
                var wall = step - o;
                // the leaves nearest this door's place on the wall
                var d = doors.Where(q => q.Kind is "hall" or "landmark").OrderBy(q => new Vector2(q.Middle.X, q.Middle.Z).DistanceTo(wall)).FirstOrDefault();
                if (d == null || new Vector2(d.Middle.X, d.Middle.Z).DistanceTo(wall) > 6) continue;
                d.Kind = "landmark";
                d.Id = l.GetProperty("id").GetString() ?? d.Id;
                d.Landmark = l.GetProperty("landmark").GetString() ?? "";
                d.Label = l.GetProperty("label").GetString() ?? "";
                d.Step = step;
                Set(d, l.GetProperty("open").GetBoolean());
            }
        }, _ => askedLandmarks = false);
    }

    /// <summary>The three churches open by the clock, six to seven in the evening.</summary>
    private int askedHour = -1;

    private void ByTheClock()
    {
        double h = GameState.I.HourF;
        // the hour turned (or the clock jumped): the keepers come and go on the hour
        if (GameState.I.Hour != askedHour)
        {
            askedHour = GameState.I.Hour;
            sinceShops = sinceLandmarks = 1e9;
        }
        foreach (var d in doors)
            if (d.Kind == "church")
                Set(d, h >= 6 && h < 19);
    }

    private static void Set(Door d, bool open)
    {
        d.Said = open;
        if (d.Fixed || d.Forced) return;
        d.Known = true;
        d.Target = open ? 1 : 0;
    }

    /// <summary>Dev and the checks: open or shut a door now, whatever the server says, until Release.</summary>
    public void Force(Door d, bool open)
    {
        d.Forced = true;
        d.Known = true;
        d.Target = open ? 1 : 0;
    }

    /// <summary>Back to what the server (or the clock) last said.</summary>
    public void Release(Door d)
    {
        d.Forced = false;
        if (d.Said is { } open) Set(d, open);
    }

    // ------------------------------------------------------------------ every frame

    public override void _Process(double delta)
    {
        sinceShops += delta;
        sinceLandmarks += delta;
        if (ServerLink.I?.Up == true && GameState.I.Live)
        {
            if (sinceShops >= ShopsEveryS) AskShops();
            if (sinceLandmarks >= LandmarksEveryS) AskLandmarks();
        }
        float dt = (float)Math.Min(delta, 0.1);
        bool full = HandsFull();
        saidFull = Math.Max(0, saidFull - delta);
        foreach (var d in doors)
        {
            if (d.Open != d.Target)
            {
                float rate = d.Kind is "hall" or "landmark" or "church" ? HallRate / Math.Max(0.3f, MathF.Abs(d.Leaves[0].OpenAngle)) : HouseRate;
                d.Open = Mathf.MoveToward(d.Open, d.Target, rate * dt);
                foreach (var leaf in d.Leaves)
                {
                    var r = leaf.Hinge.Rotation;
                    leaf.Hinge.Rotation = new Vector3(r.X, leaf.OpenAngle * d.Open, r.Z);
                }
            }
            if (d.Shape == null) continue;
            bool house = d.Kind is "shop" or "tavern" or "poesje" or "home" or "house";
            bool shut = d.Open <= Passable || (full && house);
            if (d.Shape.Disabled == shut) d.Shape.Disabled = !shut;
            // interiors.ts: "Not with that in your arms. Set it down first."
            if (full && house && d.Open > Passable && saidFull <= 0 && Jef.I != null)
            {
                float dist = new Vector2(Jef.I.X - d.Middle.X, Jef.I.Z - d.Middle.Z).Length();
                if (dist < 0.9f && Jef.I.Blocked)
                {
                    saidFull = 6;
                    GameState.I.Say("Not with that in your arms. Set it down first.");
                }
            }
        }
    }

    // ------------------------------------------------------------------ E at a shut door (interiors.ts keys, landmarks.ts keys)

    private Offers? Keys(float x, float z)
    {
        return Dev.SpeedComparison.Cached ? KeysCached(x, z) : KeysOriginal(x, z);
    }
    public bool SameKeys(float x, float z) => Dev.OfferComparison.Same(() => KeysOriginal(x, z), () => KeysCached(x, z));
    private Offers? KeysCached(float x, float z)
    {
        var jef = Jef.I;
        if (jef == null || jef.Swimming || jef.Climbing) return null;
        var options = keyOffers.Options!; options.Clear();
        foreach (var d in doors)
        {
            if (!d.Known || d.Target > 0 || d.Kind is "church" or "hall" or "house" or "home") continue;
            float distance = new Vector2(d.Step.X - x, d.Step.Y - z).Length();
            if (d.Kind == "landmark")
            {
                if (distance > ReachLandmark || MathF.Abs(jef.Y - (d.Middle.Y - 1.1f)) > 1.6f) continue;
                options.Add((distance - 0.25f, DoorAction(d, new Vector3(d.Middle.X, d.Middle.Y + 0.1f, d.Middle.Z))));
            }
            else if (!(distance > ReachDoor) && d.Kind is "shop" or "tavern" or "poesje")
                options.Add((distance - 0.2f, DoorAction(d, new Vector3(d.Middle.X, jef.Y + 1.1f, d.Middle.Z))));
        }
        return options.Count > 0 ? keyOffers : null;
    }
    private static Act DoorAction(Door door, Vector3 at) => door.Kind switch
    {
        "landmark" => Act.At(Key.E, $"try the door of {LandmarkLabel.GetValueOrDefault(door.Landmark, door.Label)}", at, () => GameState.I.Say(ClosedText.GetValueOrDefault(door.Landmark, "The door is shut."))),
        "shop" => Act.At(Key.E, $"try the door of {door.Label}", at, () => GameState.I.Say($"The shutters are up at {door.Label}. {(door.Keeper != null ? $"{door.Keeper} opens again in the morning." : "Nobody answers.")}")),
        "tavern" => Act.At(Key.E, $"try the door of {door.Label}", at, () => GameState.I.Say($"The door of {door.Label} is barred. {(door.Keeper != null ? $"{door.Keeper} opens again later." : "Nobody answers.")}")),
        _ => Act.At(Key.E, "read the board by the cellar door", at, () => GameState.I.Say($"A painted board: \"POESJE. Every evening from seven. {door.PriceC} centimes.\" The door is shut."))
    };
    private Offers? KeysOriginal(float x, float z)
    {
        var jef = Jef.I;
        if (jef == null || jef.Swimming || jef.Climbing) return null;
        var options = new List<(float, Act)>();
        foreach (var d in doors)
        {
            if (!d.Known || d.Target > 0 || d.Kind is "church" or "hall" or "house" or "home") continue; // an open door: walk in
            float dist = new Vector2(d.Step.X - x, d.Step.Y - z).Length();
            var at = new Vector3(d.Middle.X, jef.Y + 1.1f, d.Middle.Z);
            var door = d;
            if (d.Kind == "landmark")
            {
                if (dist > ReachLandmark || MathF.Abs(jef.Y - (d.Middle.Y - 1.1f)) > 1.6f) continue;
                at.Y = d.Middle.Y + 0.1f;
                options.Add((dist - 0.25f, Act.At(Key.E, $"try the door of {LandmarkLabel.GetValueOrDefault(d.Landmark, d.Label)}", at, () => GameState.I.Say(ClosedText.GetValueOrDefault(door.Landmark, "The door is shut.")))));
                continue;
            }
            if (dist > ReachDoor) continue;
            if (d.Kind == "shop")
                options.Add((dist - 0.2f, Act.At(Key.E, $"try the door of {d.Label}", at, () => GameState.I.Say($"The shutters are up at {door.Label}. {(door.Keeper != null ? $"{door.Keeper} opens again in the morning." : "Nobody answers.")}"))));
            else if (d.Kind == "tavern")
                options.Add((dist - 0.2f, Act.At(Key.E, $"try the door of {d.Label}", at, () => GameState.I.Say($"The door of {door.Label} is barred. {(door.Keeper != null ? $"{door.Keeper} opens again later." : "Nobody answers.")}"))));
            else if (d.Kind == "poesje")
                options.Add((dist - 0.2f, Act.At(Key.E, "read the board by the cellar door", at, () => GameState.I.Say($"A painted board: \"POESJE. Every evening from seven. {door.PriceC} centimes.\" The door is shut."))));
        }
        return options.Count > 0 ? new Offers { Options = options } : null;
    }
}

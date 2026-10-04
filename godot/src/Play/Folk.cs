using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.Play;

/// <summary>
/// The people the hands deal with (employers, recipients, owners of goods, anyone to talk to): where a person is,
/// by id. The townspeople are the town part's (Town/Townspeople.cs: a resident is in the street while he has a
/// body near Jef); the Rijnkaai's four (Sooi, the widow Peeters, Tuur, Fientje) and the sailor stand where the
/// bake froze them until their own part walks them (game/people.ts NPCS). A job's recipient who is nobody of the
/// town ("the mate of the Anna Maria") is a plain stand-in figure.
/// </summary>
public static class Folk
{
    /// <summary>Turn a person to look at a point (he looks at Jef when handing something over). Set by the part that walks him.</summary>
    public static Action<string, float, float>? LookAt;

    /// <summary>game/people.ts NPCS: the Rijnkaai's own people, and where they stand when the bake has no figure of them.</summary>
    private static readonly Dictionary<string, (string Name, Func<Vector3> At)> Known = new()
    {
        ["sooi"] = ("Sooi", () => Door("hessenatie", 1.6f, -2.2f)),
        ["peeters"] = ("Widow Peeters", () => Door("peeters", 1.3f, -2.0f)),
        ["tuur"] = ("Tuur", () => new Vector3(8.0f, 0, -7.4f)),
        ["fientje"] = ("Fientje", () => new Vector3(45.2f, 0, 10.2f)),
        ["sailor"] = ("a sailor", () => new Vector3(-38.5f, 0, -4.6f)),
    };
    private static readonly Dictionary<string, Vector3?> found = new();
    private static Townspeople? town;
    private static Dictionary<string, Townspeople.Sim>? byId;
    private static int simCount = -1;

    private static Vector3 Door(string name, float d, float side)
    {
        var (x, z) = Spots.DoorSpot(name, d, side);
        return new Vector3(x, 0, z);
    }

    private static Townspeople? Town => town ??= Main.I.GetChildren().OfType<Townspeople>().FirstOrDefault();

    private static Townspeople.Sim? Sim(string id)
    {
        var t = Town;
        if (t == null) return null;
        if (byId == null || simCount != t.Sims.Count)
        {
            simCount = t.Sims.Count;
            byId = new Dictionary<string, Townspeople.Sim>();
            foreach (var s in t.Sims) byId[s.R.Id] = s;
        }
        return byId.GetValueOrDefault(id);
    }

    /// <summary>Where the person stands (feet), or null: nobody knows him, or he is indoors.</summary>
    public static Vector3? At(string id)
    {
        if (Known.TryGetValue(id, out var k))
        {
            if (found.TryGetValue(id, out var at)) return at;
            // the bake's frozen figure of him
            var node = Main.I.World.FindChild(id, true, false) as Node3D;
            at = node != null ? node.GlobalPosition : k.At();
            found[id] = at;
            return at;
        }
        var sim = Sim(id);
        if (sim == null || sim.Inside) return null;
        if (sim.P != null) return new Vector3((float)sim.P.X, sim.P.Group.GlobalPosition.Y, (float)sim.P.Z);
        return new Vector3((float)sim.X, 0, (float)sim.Z);
    }

    public static bool Present(string id) => At(id) != null;

    public static string NameOf(string id, string fallback = "") => Known.TryGetValue(id, out var k) ? k.Name : Sim(id)?.R.Name is { Length: > 0 } n ? n : fallback;

    public static float Dist(string id, float x, float z)
    {
        var at = At(id);
        return at == null ? float.PositiveInfinity : MathF.Sqrt((at.Value.X - x) * (at.Value.X - x) + (at.Value.Z - z) * (at.Value.Z - z));
    }

    /// <summary>Someone within reach to talk to: who, where he stands, how far; Fixed: one of the Rijnkaai's own.</summary>
    public sealed record Person(string Id, string Name, string? Title, Vector3 At, float Dist, bool Fixed);

    /// <summary>people.ts and town.ts nearestTalker: the people in reach of (x, z), each a candidate for "talk to".</summary>
    public static IEnumerable<Person> Near(float x, float z, float reach)
    {
        foreach (string id in new[] { "sooi", "peeters", "tuur", "fientje" })
        {
            float d = Dist(id, x, z);
            if (d < reach) yield return new Person(id, Known[id].Name, null, At(id)!.Value, d, true);
        }
        var t = Town;
        if (t == null) yield break;
        foreach (var s in t.Sims)
        {
            // only who has a body in the street now
            if (s.P == null || s.Inside) continue;
            float dx = (float)s.P.X - x, dz = (float)s.P.Z - z;
            if (MathF.Abs(dx) >= reach || MathF.Abs(dz) >= reach) continue;
            float d = MathF.Sqrt(dx * dx + dz * dz);
            if (d < reach) yield return new Person(s.R.Id, s.R.Name, s.R.Label != "" ? s.R.Label : null, new Vector3((float)s.P.X, s.P.Group.GlobalPosition.Y, (float)s.P.Z), d, false);
        }
    }

    /// <summary>A figure a job brings (game/figures.ts Figure): a person of people.glb standing at a place.</summary>
    public sealed class Figure
    {
        public Node3D Node = null!;
        internal Scheldemist.People.Human? Human;
        public Vector3 Position => Node.Position;
        public void Update(float dt) => Human?.Update(dt);
        /// <summary>Turn to look at (x, z).</summary>
        public void Face(float x, float z) => Node.Rotation = new Vector3(0, MathF.Atan2(x - Node.Position.X, z - Node.Position.Z), 0);
        public void Remove()
        {
            if (GodotObject.IsInstanceValid(Node)) Node.QueueFree();
        }
    }

    /// <summary>A figure of a kind of people.glb ("recipient", "stranger", "foreman", "thief"), feet at (x, y, z); the grey-box stand-in when the models are not there.</summary>
    public static Figure MakeFigure(string kind, float x, float z, float y = 0)
    {
        var h = Scheldemist.People.Humans.Make(kind);
        if (h == null) return new Figure { Node = StandIn(kind, x, z, y, 0x2a3440) };
        h.Root.Name = "figure_" + kind;
        h.Root.Position = new Vector3(x, y, z);
        Main.I.View.AddChild(h.Root);
        h.Start();
        return new Figure { Node = h.Root, Human = h };
    }

    /// <summary>
    /// A plain stand-in figure (people.ts' grey-box shapes: a coat, a head, a cap), feet at (x, y, z), until (or if
    /// not) the model loads.
    /// </summary>
    public static Node3D StandIn(string name, float x, float z, float y = 0, uint coat = 0x4a4036)
    {
        var g = new Node3D { Name = "standin_" + name, Position = new Vector3(x, y, z) };
        var body = new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.2f, BottomRadius = 0.34f, Height = 1.3f, RadialSegments = 6, Rings = 1, Material = Goods.I.Plain(coat) }, Position = new Vector3(0, 0.72f, 0) };
        var head = new MeshInstance3D { Mesh = new SphereMesh { Radius = 0.13f, Height = 0.26f, RadialSegments = 6, Rings = 3, Material = Goods.I.Plain(0x7a6454) }, Position = new Vector3(0, 1.5f, 0) };
        var cap = new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.15f, BottomRadius = 0.15f, Height = 0.07f, RadialSegments = 8, Rings = 1, Material = Goods.I.Plain(0x1a1a1a) }, Position = new Vector3(0, 1.63f, 0) };
        g.AddChild(body);
        g.AddChild(head);
        g.AddChild(cap);
        Main.I.View.AddChild(g);
        return g;
    }
}

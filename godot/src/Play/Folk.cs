using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The people the hands deal with (employers, foremen, recipients), until the townspeople's part is merged:
/// where a person is, by id. The townspeople's part sets `Folk.Where` (one line) and every job follows the real
/// people; until then the Rijnkaai's five stand where the bake froze them (game/people.ts NPCS: the nodes named
/// sooi, peeters, tuur, fientje, sailor), and a job's recipient is a plain stand-in figure.
/// The talk and shop windows come the same way: `Folk.OpenTalk` and `Folk.OpenShop` are set by the talk part
/// (`Folk.OpenTalk = (id, name) => Talk.I.Open(id, name)`); not set, no "talk to" key is offered.
/// </summary>
public static class Folk
{
    /// <summary>"Where is this person now?" (feet; null: not in the street). Set by the townspeople's part.</summary>
    public static Func<string, Vector3?>? Where;
    /// <summary>A person's name by id, from the townspeople's part.</summary>
    public static Func<string, string?>? Name;
    /// <summary>Turn a person to look at a point (he looks at Jef when handing something over).</summary>
    public static Action<string, float, float>? LookAt;
    /// <summary>Open the talk window with a person. Set by the talk part.</summary>
    public static Action<string, string>? OpenTalk;
    /// <summary>Open a seller's wares. Set by the talk part.</summary>
    public static Action<string, string>? OpenShop;
    /// <summary>The talk or shop window is up (no keys meanwhile).</summary>
    public static Func<bool>? TalkOpen;

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

    private static Vector3 Door(string name, float d, float side)
    {
        var (x, z) = Spots.DoorSpot(name, d, side);
        return new Vector3(x, 0, z);
    }

    /// <summary>Where the person stands (feet), or null when nobody knows.</summary>
    public static Vector3? At(string id)
    {
        if (Where != null) return Where(id);
        if (!Known.TryGetValue(id, out var k)) return null;
        if (found.TryGetValue(id, out var at)) return at;
        // the bake's frozen figure of him
        var node = Main.I.World.FindChild(id, true, false) as Node3D;
        at = node != null ? node.GlobalPosition : k.At();
        found[id] = at;
        return at;
    }

    public static bool Present(string id) => At(id) != null;

    public static string NameOf(string id, string fallback = "") => Name?.Invoke(id) ?? (Known.TryGetValue(id, out var k) ? k.Name : fallback);

    public static float Dist(string id, float x, float z)
    {
        var at = At(id);
        return at == null ? float.PositiveInfinity : MathF.Sqrt((at.Value.X - x) * (at.Value.X - x) + (at.Value.Z - z) * (at.Value.Z - z));
    }

    /// <summary>The Rijnkaai's people, for the "talk to" key.</summary>
    public static IEnumerable<string> Talkers => new[] { "sooi", "peeters", "tuur", "fientje" };

    /// <summary>
    /// A plain stand-in figure (people.ts' grey-box shapes: a coat and a head), feet at (x, y, z), for a person the
    /// townspeople's part will bring. Solid like a person is not: he is walked round by the eye only.
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

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The time the big movers run on (ships, bridges, the lock, trains, cranes, omnibuses, clocks): the game's clock
/// from the store (GameState.I.Day, HourF) and the seconds the picture has run (the browser's `t` of
/// world/rijnkaai.ts update(t, dt)). For tests the hour can be held: `-- --hour 13.5` (and `--day 2`), or
/// MoverClock.Hold(13.5) from a test. A held hour runs on at the game's rate, so things still move.
/// </summary>
[GamePart(4)]
public partial class MoverClock : Node
{
    /// <summary>Seconds since the town came in (the browser's t).</summary>
    public static double T { get; private set; }
    /// <summary>The frame's step in seconds, at most a tenth (a hitch does not throw a ship forward).</summary>
    public static double Dt { get; private set; }
    public static int Day { get; private set; } = 1;
    /// <summary>The hour with its fraction, 0 to 24.</summary>
    public static double HourF { get; private set; } = 13;
    /// <summary>Game hours since Monday 0:00.</summary>
    public static double Hours => (Math.Max(1, Day) - 1) * 24 + HourF;
    /// <summary>Counts frames, for parts that work in turns.</summary>
    public static ulong Frame { get; private set; }
    /// <summary>How rough the water is (the browser's uSea): 1 on a plain day.</summary>
    public static float Sea { get; private set; } = 1;
    /// <summary>The hour is held by a test (not the server's).</summary>
    public static bool Held => held >= 0;

    private static double held = -1;
    private static int heldDay = -1;
    private static double heldAt;

    /// <summary>Hold the clock at this hour (it runs on from there at the game's rate). A negative hour lets go.</summary>
    public static void Hold(double hour, int day = -1)
    {
        held = hour;
        heldDay = day;
        heldAt = T;
        Read();
        // the light and the townspeople of that hour too (a test's pictures are lit by the hour it sets)
        if (hour >= 0 && Daylight.I != null)
        {
            Daylight.I.SetTime((float)hour);
            Daylight.I.Settle();
        }
    }

    public override void _Ready()
    {
        ProcessPriority = -100; // before every mover
        string h = Main.I.Arg("hour");
        if (h != "" && double.TryParse(h, NumberStyles.Float, CultureInfo.InvariantCulture, out double hour))
            Hold(hour, int.TryParse(Main.I.Arg("day"), out int d) ? d : -1);
        Read();
        // what moves is claimed before the still world is made solid (World/Solid.cs, the next part)
        Bridges.Claims();
        Lock.Claims();
        Railway.Claims();
    }

    private static void Read()
    {
        var s = GameState.I;
        Day = heldDay > 0 ? heldDay : s.Day;
        if (held >= 0)
        {
            double h = held + (T - heldAt) * ClockRate.GameMinPerRealS / 60;
            HourF = h - 24 * Math.Floor(h / 24);
            Tide.Set(Day, (float)HourF);
        }
        else HourF = s.HourF;
    }

    public override void _Process(double delta)
    {
        Dt = Math.Min(delta, 0.1);
        T += Dt;
        Frame++;
        Read();
        // the sea: a storm raises the waves, the boats roll (rijnkaai.ts update)
        string w = GameState.I.Weather;
        float sea = w == "storm" ? 3.6f : w == "rain" ? 1.5f : w == "clear" ? 1.1f : 0.85f;
        Sea += (sea - Sea) * (float)Math.Min(1, Dt * 0.05);
    }
}

/// <summary>What the movers share: finding the bake's nodes by the names the TypeScript gave them, the browser's random numbers.</summary>
public static class Mv
{
    /// <summary>A baked node's name as the TypeScript gave it: Godot's import adds a number to a name used twice.</summary>
    public static string Plain(Node n)
    {
        // (a name that itself ends in a number, draw_beam_6, cannot be told from a counted one: the model's own name, kept
        // in the node's extras, says it)
        if (n.HasMeta("extras") && n.GetMeta("extras").AsGodotDictionary().TryGetValue("name", out var own) && own.VariantType == Variant.Type.String) return own.AsString();
        string s = n.Name.ToString();
        int e = s.Length;
        while (e > 0 && char.IsDigit(s[e - 1])) e--;
        if (e > 0 && e < s.Length && s[e - 1] == '_') e--;
        return e > 0 ? s[..e] : s;
    }

    public static Node Town => Main.I.World.GetChild(0);

    /// <summary>The groups of this name right under the town's root (the browser's scene.add of a named Group).</summary>
    public static List<Node3D> Tops(string name)
    {
        var list = new List<Node3D>();
        foreach (var c in Town.GetChildren())
            if (c is Node3D n && Plain(c) == name) list.Add(n);
        return list;
    }

    public static Node3D? Top(string name)
    {
        var l = Tops(name);
        return l.Count > 0 ? l[0] : null;
    }

    public static IEnumerable<Node3D> Kids(Node parent, string name)
    {
        foreach (var c in parent.GetChildren())
            if (c is Node3D n && Plain(c) == name) yield return n;
    }

    /// <summary>The frozen thing is a mover's now: World/Solid.cs makes no wall of it (its part brings its own body).</summary>
    public static void Claim(Node n) => n.SetMeta("mover", true);

    /// <summary>The browser's rng (world/route.ts rng, mulberry32): same seed, same numbers.</summary>
    public static Func<double> Rng(uint seed)
    {
        uint s = seed;
        return () =>
        {
            unchecked
            {
                s += 0x6d2b79f5;
                uint t = s;
                t = (uint)((int)(t ^ (t >> 15)) * (int)(t | 1));
                t ^= t + (uint)((int)(t ^ (t >> 7)) * (int)(t | 61));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        };
    }

    /// <summary>
    /// A solid that moves with `owner` (a bridge's leaf, a lock gate, a wagon): a kinematic body on the still
    /// world's layer, with the drawn triangles of the meshes under it as its shape. Jef walks on it and into it.
    /// </summary>
    public static AnimatableBody3D Body(Node3D owner, string name = "solid", Func<MeshInstance3D, bool>? only = null)
    {
        var body = new AnimatableBody3D { Name = name, SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0 };
        // physics takes no stretched shapes: a stretched owner (a lock gate) gets its body beside it, following it,
        // with the stretch worked into the triangles
        var plain = owner.GlobalTransform.Orthonormalized();
        bool stretched = !owner.GlobalTransform.Basis.Scale.IsEqualApprox(Vector3.One);
        if (stretched)
        {
            owner.GetParent().AddChild(body);
            body.GlobalTransform = plain;
            var follow = new RemoteTransform3D { Name = name + "_follow", UpdateScale = false, UseGlobalCoordinates = true };
            owner.AddChild(follow);
            follow.RemotePath = follow.GetPathTo(body);
        }
        else owner.AddChild(body);
        var inv = plain.AffineInverse();
        foreach (var c in BakedWorld.All(owner))
        {
            if (c is not MeshInstance3D { Mesh: not null, Visible: true } mi || (only != null && !only(mi))) continue;
            if (mi.Mesh.GetSurfaceCount() == 0 || mi.Mesh is ArrayMesh am && am.SurfaceGetPrimitiveType(0) != Mesh.PrimitiveType.Triangles) continue;
            var rel = inv * mi.GlobalTransform;
            var faces = mi.Mesh.GetFaces();
            if (faces.Length < 3) continue;
            for (int i = 0; i < faces.Length; i++) faces[i] = rel * faces[i];
            var shape = new ConcavePolygonShape3D { BackfaceCollision = true };
            shape.SetFaces(faces);
            body.AddChild(new CollisionShape3D { Shape = shape });
        }
        return body;
    }

    /// <summary>A solid box that moves with `owner` (in the owner's frame): cheaper than its triangles.</summary>
    public static AnimatableBody3D BoxBody(Node3D owner, Aabb box, string name = "solid")
    {
        var body = new AnimatableBody3D { Name = name, SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0 };
        owner.AddChild(body);
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = box.Size }, Position = box.GetCenter() });
        return body;
    }

    public static float Clamp01(float x) => x < 0 ? 0 : x > 1 ? 1 : x;
    public static double Clamp(double x, double a, double b) => x < a ? a : x > b ? b : x;
    public static float Smooth(float x)
    {
        float k = Clamp01(x);
        return k * k * (3 - 2 * k);
    }

    /// <summary>The box of everything drawn under n, in the world.</summary>
    public static Aabb WorldBox(Node n)
    {
        Aabb box = default;
        bool any = false;
        foreach (var c in BakedWorld.All(n))
        {
            if (c is not MeshInstance3D { Mesh: not null } mi) continue;
            var b = mi.GlobalTransform * mi.Mesh.GetAabb();
            box = any ? box.Merge(b) : b;
            any = true;
        }
        return box;
    }

    /// <summary>The box of everything drawn under n, in n's own frame.</summary>
    public static Aabb LocalBox(Node3D n)
    {
        Aabb box = default;
        bool any = false;
        var inv = n.GlobalTransform.AffineInverse();
        foreach (var c in BakedWorld.All(n))
        {
            if (c is not MeshInstance3D { Mesh: not null } mi) continue;
            var b = (inv * mi.GlobalTransform) * mi.Mesh.GetAabb();
            box = any ? box.Merge(b) : b;
            any = true;
        }
        return box;
    }
}

/// <summary>Dev: `-- --dumptree file [--dumpof a,b] [--dumpdepth 3]` writes the baked groups as Godot sees them (names, kinds, places), then quits.</summary>
[GamePart(950)]
public partial class MoverDump : Node
{
    public override void _Ready()
    {
        string md = Main.I.Arg("modeldump");
        if (md != "")
        {
            // `--modeldump boats:schooner,barque_sail file`: the model library's tree of those top nodes
            var parts = md.Split(':');
            var model = Scheldemist.Models.ModelLibrary.Get(parts[0]);
            var o = new System.Text.StringBuilder();
            if (model != null)
            {
                o.Append("roots: ").Append(string.Join(", ", model.Roots.Keys)).Append('\n');
                if (parts.Length > 1)
                    foreach (string r in parts[1].Split(','))
                        if (model.Roots.TryGetValue(r, out var root))
                            foreach (var n in BakedWorld.All(root))
                            {
                                string ex = n.HasMeta("extras") ? Json.Stringify(n.GetMeta("extras")).Replace("\n", "") : "";
                                string mats = n is MeshInstance3D { Mesh: not null } mi ? " mats: " + string.Join("|", Enumerable.Range(0, mi.Mesh.GetSurfaceCount()).Select(i => mi.Mesh.SurfaceGetMaterial(i)?.ResourceName ?? "?")) + $" prim {(mi.Mesh as ArrayMesh)?.SurfaceGetPrimitiveType(0)}" : "";
                                o.Append($"{root.GetPathTo(n)} [{n.GetType().Name}]{mats} {ex[..Math.Min(140, ex.Length)]}\n");
                            }
            }
            System.IO.File.WriteAllText(Main.I.Arg("dumptree", "modeldump.txt"), o.ToString());
            GetTree().Quit();
            return;
        }
        string f = Main.I.Arg("dumptree");
        if (f == "") return;
        var want = new HashSet<string>(Main.I.Arg("dumpof").Split(',', StringSplitOptions.RemoveEmptyEntries));
        int depth = int.TryParse(Main.I.Arg("dumpdepth"), out int d) ? d : 3;
        var sb = new System.Text.StringBuilder();
        void Line(Node n, int lvl)
        {
            string at = n is Node3D n3 ? $" @{n3.GlobalPosition.X:0.00},{n3.GlobalPosition.Y:0.00},{n3.GlobalPosition.Z:0.00} ry{n3.GlobalRotation.Y:0.000}{(n3.Visible ? "" : " HIDDEN")}" : "";
            string extra = "";
            if (n is MeshInstance3D { Mesh: not null } mi) extra = $" mesh s{mi.Mesh.GetSurfaceCount()} v{(mi.Mesh.GetSurfaceCount() > 0 ? mi.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length : 0)} box{mi.Mesh.GetAabb().Position}+{mi.Mesh.GetAabb().Size}";
            if (n is MultiMeshInstance3D mm) extra = $" copies {mm.Multimesh.InstanceCount} first {mm.Multimesh.GetInstanceTransform(0).Origin} box{mm.Multimesh.Mesh.GetAabb().Position}+{mm.Multimesh.Mesh.GetAabb().Size}";
            if (n.HasMeta("extras"))
            {
                string ex = Json.Stringify(n.GetMeta("extras")).Replace("\n", "");
                extra += " ex:" + ex[..Math.Min(200, ex.Length)];
            }
            sb.Append(new string(' ', lvl * 2)).Append(n.Name).Append(" [").Append(n.GetType().Name).Append(']').Append(at).Append(extra).Append('\n');
        }
        void Walk(Node n, int lvl, bool on)
        {
            bool hit = want.Contains(Mv.Plain(n));
            if (hit && !on) { on = true; lvl = 0; }
            if (on) Line(n, lvl);
            if (on && lvl >= depth) return;
            foreach (var c in n.GetChildren()) Walk(c, lvl + 1, on);
        }
        if (want.Count == 0)
            foreach (var c in Mv.Town.GetChildren()) Line(c, 0);
        else Walk(Main.I.World, 0, false);
        System.IO.File.WriteAllText(f, sb.ToString());
        GetTree().Quit();
    }
}

/// <summary>Reusable immediate overlap query; native results stay native instead of making result arrays.</summary>
public sealed class MoverOverlap
{
    private readonly SphereShape3D sphere = new();
    private readonly ShapeCast3D cast;
    private object? owner;
    public MoverOverlap(float margin = 0)
    {
        cast = new ShapeCast3D { Name = "mover_overlap", Shape = sphere, Enabled = false,
            TargetPosition = Vector3.Zero, CollisionMask = Solid.Layer, CollideWithAreas = false, Margin = margin, MaxResults = 1 };
        Main.I.View.AddChild(cast);
    }
    public bool Free(object who, Godot.Collections.Array<Rid> exclude, Vector2 at, float radius)
    {
        if (owner != who)
        {
            owner = who;
            cast.ClearExceptions();
            for (int i=0;i<exclude.Count;i++) cast.AddExceptionRid(exclude[i]);
        }
        if (sphere.Radius != radius) sphere.Radius = radius;
        cast.GlobalPosition = new Vector3(at.X, 0.9f, at.Y);
        cast.ForceShapecastUpdate();
        return !cast.IsColliding();
    }
}

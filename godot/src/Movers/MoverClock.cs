using System;
using System.Collections.Generic;
using System.Globalization;
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
    }

    public override void _Ready()
    {
        ProcessPriority = -100; // before every mover
        string h = Main.I.Arg("hour");
        if (h != "" && double.TryParse(h, NumberStyles.Float, CultureInfo.InvariantCulture, out double hour))
            Hold(hour, int.TryParse(Main.I.Arg("day"), out int d) ? d : -1);
        Read();
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

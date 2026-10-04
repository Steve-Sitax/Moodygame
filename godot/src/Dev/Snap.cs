using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// Test pictures from chosen views, hours and weathers in one run (docs/testing.md: a good view, midday and clear
/// unless the dark or the fog is what is tested):
///   -- --snap dir --views "day:-118,1.62,36,180,0,13,clear;night:-118,1.62,36,180,10,22,mist"
/// Each view: name:x,y,z,yaw,pitch[,hour,weather,storm] (degrees; storm: the great storm's level 0..1; yaw 0 looks to -z, 180 to +z; pitch up). A view with no
/// place ("name:,,,,,21,rain") keeps the camera of the bake's first place. A view named lantern... follows the
/// burning lantern nearest its camera from a few steps away. Writes dir/name.png and prints the mean
/// frame time there, then quits.
/// </summary>
[GamePart(900)]
public partial class Snap : Node
{
    private string dir = "";
    private readonly List<string[]> views = new();
    private int view = -1, frame;
    private ulong last;
    private readonly List<double> times = new();
    private readonly List<Node3D> hidden = new();
    private const int Wait = 50, Timed = 90;

    public override void _Ready()
    {
        dir = Paths.TestOutput("snap");
        string v = Main.I.Arg("views");
        if (dir == "" || v == "")
        {
            SetProcess(false);
            return;
        }
        System.IO.Directory.CreateDirectory(dir);
        foreach (var one in v.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            int c = one.IndexOf(':');
            views.Add(new[] { one[..c] }.Concat(one[(c + 1)..].Split(',')).ToArray());
        }
        // (the pictures are taken from the free camera: Jef gives it up)
        if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
        ProcessPriority = -100;
        Next();
    }

    private static float F(string s) => float.Parse(s, CultureInfo.InvariantCulture);

    private void Next()
    {
        view++;
        frame = 0;
        times.Clear();
        if (view >= views.Count)
        {
            // (dev: --whatis x,y,z lists the drawn meshes whose box holds that point, small ones first)
            if (Main.I.Arg("whatis") is { Length: > 0 } wi)
            {
                var q = wi.Split(',').Select(F).ToArray();
                var pt = new Vector3(q[0], q[1], q[2]);
                var hits = new List<(float, string)>();
                foreach (var nd in BakedWorld.All(Main.I.View))
                    if (nd is GeometryInstance3D gi && gi.IsVisibleInTree() && (gi.GlobalTransform * gi.GetAabb()).Grow(0.05f).HasPoint(pt))
                    {
                        var mat = (gi as MeshInstance3D)?.Mesh?.SurfaceGetMaterial(0) as ShaderMaterial;
                        hits.Add(((gi.GlobalTransform * gi.GetAabb()).Size.Length(), $"{gi.GetPath().ToString().Split('/').TakeLast(3).Aggregate((x, y) => x + "/" + y)} mat {mat?.ResourceName} kind {(mat != null ? Render.Psx.KindOf(mat.Shader)?.ToString() : "")}"));
                    }
                foreach (var (size, what) in hits.OrderBy(h => h.Item1).Take(12)) GD.Print($"whatis {size:0.0} {what}".Substring(0, Math.Min(300, $"whatis {size:0.0} {what}".Length)));
            }
            // (what the bake still hides as not ported)
            System.IO.File.WriteAllLines(System.IO.Path.Combine(dir, "unported.txt"), Main.I.World.Unported.Distinct());
            // (dev: the bake's figures drawn now, frozen as they were at bake time)
            var bodies = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(b => b.Name.ToString().Contains("_body") && b.IsVisibleInTree()).ToList();
            GD.Print($"baked figures drawn: {bodies.Count} ({string.Join(", ", bodies.Take(12).Select(b => b.GetPath().ToString().Split('/').TakeLast(4).Aggregate((x, y) => x + "/" + y)))})");
            foreach (var ub in BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(b => Main.I.World.Unported.Contains(b.Name.ToString()) || Main.I.World.Unported.Contains($"{b.GetParent()?.Name}/{b.Name}")))
            {
                Node3D? fig = ub.GetParent() as Node3D;
                while (fig != null && fig.GetParent() is Node3D up && up.Name != "town" && fig is not { } ) fig = up;
                var root = ub as Node3D;
                while (root.GetParent() is Node3D q && q.Name != "town") root = q;
                GD.Print($"unported figure {ub.Name}: {ub.GetPath().ToString().Split('/').TakeLast(5).Aggregate((x, y) => x + "/" + y)} group shown {root.IsVisibleInTree()} figure shown {(ub.GetParent()?.GetParent() as Node3D)?.IsVisibleInTree()}");
            }
            foreach (var fb in BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(b => System.Text.RegularExpressions.Regex.IsMatch(b.Name.ToString(), "^(priest|tourist|beggar|urchin|soldier|ragman)_body")))
                GD.Print($"figure body {fb.Name}: shown {fb.IsVisibleInTree()}, material {fb.Mesh?.SurfaceGetMaterial(0)?.GetClass()} {(fb.Mesh?.SurfaceGetMaterial(0) as ShaderMaterial)?.HasMeta("baked_invisible")}");
            // (dev: what a nameless one is: where, how big, its materials)
            foreach (var nd in BakedWorld.All(Main.I.World))
                if (nd is MeshInstance3D um && um.Mesh != null && Main.I.World.Unported.Contains($"{um.GetParent()?.Name}/{um.Name}"))
                    GD.Print($"unported {um.GetParent()?.Name}/{um.Name}: box {um.GlobalTransform * um.GetAabb()}, {string.Join(", ", Enumerable.Range(0, um.Mesh.GetSurfaceCount()).Select(i => $"{um.Mesh.SurfaceGetMaterial(i)?.GetClass()} '{um.Mesh.SurfaceGetMaterial(i)?.ResourceName}' {(um.Mesh as ArrayMesh)?.SurfaceGetArrayLen(i)} corners"))}, path {um.GetPath()}");
            GetTree().Quit();
            SetProcess(false);
            return;
        }
        var a = views[view];
        // (dev: a view named name~node~node draws without those nodes, to find what draws a thing)
        foreach (var h in hidden) h.Visible = true;
        hidden.Clear();
        foreach (var n in a[0].Split('~').Skip(1))
            foreach (var nd in BakedWorld.All(Main.I.View))
                if (nd is Node3D n3 && n3.Name == n && n3.Visible)
                {
                    n3.Visible = false;
                    hidden.Add(n3);
                }
        var cam = Main.I.Cam;
        if (a.Length > 5 && a[1] != "")
        {
            cam.Position = new Vector3(F(a[1]), F(a[2]), F(a[3]));
            var q = Basis.FromEuler(new Vector3(Mathf.DegToRad(F(a[5])), Mathf.DegToRad(F(a[4])), 0), EulerOrder.Yxz).GetRotationQuaternion();
            if (cam is Player.FlyCam fly) fly.Face(q);
            else cam.Quaternion = q;
        }
        if (a.Length > 6 && a[6] != "")
        {
            Daylight.I.SetTime(F(a[6]));
            Tide.Set(1, F(a[6])); // (Monday's tide at that hour)
        }
        if (a.Length > 7 && a[7] != "") Daylight.I.SetWeather(a[7]);
        // (a view named bilge...: the pumps near it work now)
        if (ShipWater.I is { } sw) sw.PumpNow = a[0].StartsWith("bilge");
        // (held: the events part sets the storm every frame, and the test's level would fade)
        Daylight.I.StormHold = a.Length > 8 && a[8] != "" ? F(a[8]) : null;
        Daylight.I.SetStorm(a.Length > 8 && a[8] != "" ? F(a[8]) : 0);
        Daylight.I.Settle();
    }

    /// <summary>Where a view of the air's small life looks from and at, or null (a plain view).</summary>
    private static (Vector3 from, Vector3 at)? Target(string name)
    {
        var cam = Main.I.Cam.GlobalPosition;
        if (name.StartsWith("cateye") && NightLife.I is { Info.eyes: > 0 } nl)
        {
            var e = nl.Info.firstEye;
            var back = new Vector3(cam.X - e.X, 0, cam.Z - e.Z).Normalized();
            return (e + back * 8 + new Vector3(0, 1.4f, 0), e);
        }
        if (name.StartsWith("moth") && Lights.I is { } li && li.LampCount > 0)
        {
            int best = 0;
            for (int i = 1; i < li.LampCount; i++) if (li.LampAt(i).DistanceSquaredTo(cam) < li.LampAt(best).DistanceSquaredTo(cam)) best = i;
            var l = li.LampAt(best);
            return (l + new Vector3(1.6f, -0.9f, 1.6f), l);
        }
        if (name.StartsWith("gutter") && Gutters.I is { } gu && gu.Nearest(cam) is { } s)
            return (s.foot + s.outward * 4.5f + new Vector3(0, 1.0f, 0), s.foot + new Vector3(0, 1.6f, 0));
        if (name.StartsWith("blob") && Main.I.GetNodeOrNull<Town.Townspeople>("Townspeople")?.Crowd is { } crowd)
        {
            Vector3? best = null;
            // (a walker out on open ground, the camera a little above: the soft shadow at the feet; a view named
            // blob..._off draws it without the shadows, for the before-and-after)
            if (Blobs.I is { } bl) bl.Shown = !name.Contains("_off");
            foreach (var p in crowd.Walking)
                if (p.Shown && Ways.Open(p.Group.GlobalPosition.X, p.Group.GlobalPosition.Z, 1.5) && (best == null || p.Group.GlobalPosition.DistanceSquaredTo(cam) < best.Value.DistanceSquaredTo(cam))) best = p.Group.GlobalPosition;
            if (best is { } b)
            {
                var back = new Vector3(cam.X - b.X, 0, cam.Z - b.Z).Normalized();
                return (b + back * 3.2f + new Vector3(0, 2.6f, 0), b);
            }
        }
        if (name.StartsWith("bilge") && ShipWater.I is { } sw)
        {
            var (o, outward) = sw.NearestOutlet(cam);
            var across = new Vector3(-outward.Z, 0, outward.X);
            return (o + outward * 4.5f + across * 2.5f + new Vector3(0, 3.2f, 0), o + outward * 0.9f + new Vector3(0, -0.8f, 0));
        }
        if (name.StartsWith("surf") && Surf.I is { Info.edges: > 0 } su)
        {
            var e = su.Info.edge0;
            var inland = new Vector3(cam.X - e.X, 0, cam.Z - e.Z).Normalized();
            var side = new Vector3(-inland.Z, 0, inland.X);
            return (e + inland * 7 + side * 6 + new Vector3(0, 1.7f, 0), e + new Vector3(0, 1.5f, 0));
        }
        return null;
    }

    public override void _Process(double delta)
    {
        if (view < 0 || view >= views.Count) return;
        ulong now = Time.GetTicksUsec();
        if (frame > Wait) times.Add((now - last) / 1000.0);
        last = now;
        frame++;
        if (views[view][0].StartsWith("lantern") && People.LanternPool.I?.NearestLit(Main.I.Cam.GlobalPosition) is { } lamp)
        {
            var cam = Main.I.Cam;
            cam.GlobalPosition = lamp + new Vector3(2.2f, 0.9f, 2.2f);
            var q = Basis.LookingAt(lamp - cam.GlobalPosition).GetRotationQuaternion();
            if (cam is Player.FlyCam fly) fly.Face(q);
            else cam.Quaternion = q;
        }
        // (the air's small life: a view named cateye / moth / gutter / surf looks at the nearest one from a little way off)
        if (Target(views[view][0]) is { } t)
        {
            var cam = Main.I.Cam;
            cam.GlobalPosition = t.from;
            var q = Basis.LookingAt(t.at - t.from).GetRotationQuaternion();
            if (cam is Player.FlyCam fly) fly.Face(q);
            else cam.Quaternion = q;
        }
        // (the first view waits for the loading screen to go)
        if (frame < Wait + Timed + (view == 0 ? 240 : 0)) return;
        string name = views[view][0];
        Main.I.GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, name + ".png"));
        // (dev: --whatray fx,fy;... lists the drawn meshes whose box the ray through that point of the picture meets,
        // small ones first; fx, fy are 0..1 across and down)
        if (Main.I.Arg("whatray") is { Length: > 0 } wr)
            foreach (var one in wr.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                var f = one.Split(',').Select(F).ToArray();
                var cam3 = Main.I.View.GetCamera3D();
                var px = new Vector2(f[0], f[1]) * Main.I.GetViewport().GetVisibleRect().Size;
                Vector3 o = cam3.ProjectRayOrigin(px), d = cam3.ProjectRayNormal(px);
                var hits = new List<(float, string)>();
                foreach (var nd in BakedWorld.All(Main.I.View))
                    if (nd is GeometryInstance3D gi && gi.IsVisibleInTree() && (gi.GlobalTransform * gi.GetAabb()).IntersectsSegment(o, o + d * 5000))
                        hits.Add(((gi.GlobalTransform * gi.GetAabb()).Size.Length(), $"{(gi.GlobalTransform * gi.GetAabb()).GetCenter().DistanceTo(o):0} m {gi.GetPath().ToString().Split('/').TakeLast(3).Aggregate((x, y) => x + "/" + y)} {gi.GetClass()} mat {(gi.MaterialOverride ?? (gi as MeshInstance3D)?.Mesh?.SurfaceGetMaterial(0))?.ResourceName}"));
                foreach (var (size, what) in hits.OrderBy(h => h.Item1).Take(60)) GD.Print($"whatray {name} {one} {size:0} {what}");
            }
        if (ShipWater.I is { } sw) GD.Print($"snap {name} ship water: {sw.Info}");
        if (LandmarkRooms.I is { } lr) GD.Print($"snap {name} landmark rooms: {string.Join(", ", lr.Info.Select(i => $"{i.building} {i.lit}/{i.windows}"))}; steen lanterns {lr.LanternInfo.lit}/{lr.LanternInfo.lanterns}");
        times.Sort();
        GD.Print($"snap {name} air: wind {Daylight.I.Wind.Length():0.00}, rain {Daylight.I.Rain:0.00}, storm {Daylight.I.Storm:0.00}, night life {NightLife.I?.Info}, surf {Surf.I?.Info}, gutters {Gutters.I?.Info}, breath {Breath.I?.Info}, blobs {Blobs.I?.Count}");
        GD.Print($"snap {name}: {times.Average():0.00} ms a frame (p95 {times[(int)(times.Count * 0.95)]:0.00}), {RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame)} draws, {Render.Psx.ShaderCount} psx shaders");
        Next();
    }
}

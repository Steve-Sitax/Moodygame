using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Dev: <c>--razed-scan &lt;file&gt;</c> lists what the loaded town still draws over the razed houses' plots: every visible
/// triangle (and every copy) 0.5 m or more up, within 1.5 m of a razed outline and nearer to it than to any standing house,
/// grouped by node, material and 2 m cell. Trees, the churchyard, the square dressing and the squares' benches are counted
/// apart (they belong there); the rest is a leftover to look at. Writes the list and quits.
/// </summary>
public partial class NativeRazedScan : Node
{
    private const float Above = 0.5f;
    // (dev: --razed-scan-margin <m> looks further out than 1.5 m)
    private static float Margin = 1.5f;
    // (dev: --razed-scan-box x0,z0,x1,z1[;...] lists everything in those boxes instead)
    private static Rect2[]? Box;

    public override void _Ready()
    {
        string file = Scheldemist.Main.I.Arg("razed-scan");
        if (float.TryParse(Scheldemist.Main.I.Arg("razed-scan-margin"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float m)) Margin = m;
        var box = Scheldemist.Main.I.Arg("razed-scan-box").Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(b => b.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray()).Where(b => b.Length == 4)
            .Select(b => new Rect2(b[0], b[1], b[2] - b[0], b[3] - b[1])).ToArray();
        if (box.Length > 0) Box = box;
        if (file != "") _ = Run(Path.GetFullPath(file));
    }

    private async Task Run(string file)
    {
        ulong end = Time.GetTicksMsec() + 600_000;
        while (Time.GetTicksMsec() < end && Scheldemist.Main.I.World?.IsInsideTree() != true) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        for (int i = 0; i < 300; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        GD.Print("razed-scan: town ready, scanning");
        Rays(Scheldemist.Main.I.Arg("razed-scan-ray"), file);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var razed = NativeRazedHouses.Last;
        var boxes = Box is { } only ? only.Select(b => (Outline: new[] { b.Position, b.Position + new Vector2(b.Size.X, 0), b.End, b.Position + new Vector2(0, b.Size.Y) }, Box: b)).ToArray() : razed.Razed.Select(o => (Outline: o, Box: Rect(o))).ToArray();
        var standing = Box != null ? Array.Empty<(Vector2[] Outline, Rect2 Box)>() : razed.Standing.Select(o => (Outline: o, Box: Rect(o))).ToArray();
        var groups = new Dictionary<(string Node, string Material, int Alpha, int X, int Z), (int Count, float Y0, float Y1, Vector3 At)>();
        var kept = new SortedDictionary<string, int>();
        void Add(string why, string node, string material, Vector3 p, int alpha = -1)
        {
            if (why != "") { kept[why] = kept.GetValueOrDefault(why) + 1; return; }
            var key = (node, material, alpha, (int)MathF.Floor(p.X / 2), (int)MathF.Floor(p.Z / 2));
            var g = groups.TryGetValue(key, out var had) ? had : (Count: 0, Y0: float.MaxValue, Y1: float.MinValue, At: p);
            groups[key] = (g.Count + 1, Math.Min(g.Y0, p.Y), Math.Max(g.Y1, p.Y), g.At);
        }
        foreach (var n in BakedWorld.All(Scheldemist.Main.I))
        {
            if (n is not GeometryInstance3D gi || !gi.IsVisibleInTree()) continue;
            var mesh = (gi as MeshInstance3D)?.Mesh ?? (gi as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (mesh == null || mesh.GetSurfaceCount() == 0) continue;
            var box = gi.GlobalTransform * gi.GetAabb();
            var near = boxes.Where(o => Overlaps(box, o.Box)).ToArray();
            if (near.Length == 0) continue;
            string why = Why(gi), path = Short(gi);
            var meshClock = System.Diagnostics.Stopwatch.StartNew();
            if (gi is MultiMeshInstance3D copies)
            {
                var mm = copies.Multimesh; var local = mm.Mesh.GetAabb();
                for (int i = 0; i < mm.InstanceCount; i++)
                {
                    var b = gi.GlobalTransform * mm.GetInstanceTransform(i) * local;
                    var c = b.GetCenter();
                    if (b.End.Y >= Above && Leftover(near, standing, c)) Add(why, path, Material(mesh, null, 0), c);
                }
                continue;
            }
            var xf = gi.GlobalTransform;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (mesh is not ArrayMesh am || am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
                var arrays = am.SurfaceGetArrays(s);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : Array.Empty<int>();
                if (ix.Length == 0) ix = Enumerable.Range(0, v.Length).ToArray();
                string material = Material(mesh, gi as MeshInstance3D, s);
                var colours = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.PackedColorArray ? arrays[(int)Mesh.ArrayType.Color].AsColorArray() : null;
                for (int t = 0; t + 2 < ix.Length; t += 3)
                {
                    Vector3 a = xf * v[ix[t]], b = xf * v[ix[t + 1]], c = xf * v[ix[t + 2]];
                    if ((b - a).Cross(c - a).LengthSquared() < 1e-10f) continue;
                    var p = (a + b + c) / 3;
                    if (p.Y >= Above && Leftover(near, standing, p)) Add(why, path, material, p, colours != null ? (int)MathF.Round(colours[ix[t]].A * 255) : -1);
                }
            }
            if (meshClock.ElapsedMilliseconds > 2000) GD.Print($"razed-scan: {path} took {meshClock.ElapsedMilliseconds} ms");
        }
        var lines = new List<string> { $"# razed scan: {razed.Razed.Count} razed outlines; leftover groups {groups.Count}, triangles {groups.Values.Sum(g => g.Count)}" };
        lines.AddRange(kept.Select(k => $"# kept {k.Key}: {k.Value}"));
        lines.AddRange(groups.OrderByDescending(g => g.Value.Count).Select(g => FormattableString.Invariant($"{g.Value.Count}\t{g.Value.At.X:0.0},{g.Value.Y0:0.0}-{g.Value.Y1:0.0},{g.Value.At.Z:0.0}\t{g.Key.Node}\t{g.Key.Material}\talpha {g.Key.Alpha}")));
        File.WriteAllLines(file, lines);
        GD.Print($"razed-scan: {clock.ElapsedMilliseconds} ms, {groups.Count} groups, {groups.Values.Sum(g => g.Count)} triangles -> {file}");
        GetTree().Quit();
    }

    /// <summary>
    /// (dev: --razed-scan-ray x,y,z,yaw,pitch,fx,fy[;...]: the nearest drawn triangles on the ray through that point of a
    /// snap view's picture, fx and fy 0..1 across and down; written next to the scan as its -rays.txt)
    /// </summary>
    private static void Rays(string spec, string file)
    {
        if (spec == "") return;
        var lines = new List<string>();
        var cam = Scheldemist.Main.I.View.GetCamera3D();
        var size = Scheldemist.Main.I.GetViewport().GetVisibleRect().Size;
        foreach (var one in spec.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var f = one.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
            cam.GlobalTransform = new Transform3D(Basis.FromEuler(new Vector3(Mathf.DegToRad(f[4]), Mathf.DegToRad(f[3]), 0), EulerOrder.Yxz), new Vector3(f[0], f[1], f[2]));
            var px = new Vector2(f[5], f[6]) * size;
            Vector3 o = cam.ProjectRayOrigin(px), d = cam.ProjectRayNormal(px);
            var hits = new List<(float At, string What)>();
            foreach (var n in BakedWorld.All(Scheldemist.Main.I))
            {
                if (n is not MeshInstance3D mi || !mi.IsVisibleInTree() || mi.Mesh is not ArrayMesh am) continue;
                var xf = mi.GlobalTransform;
                if (!(xf * mi.GetAabb()).Grow(0.05f).IntersectsSegment(o, o + d * 400)) continue;
                for (int s = 0; s < am.GetSurfaceCount(); s++)
                {
                    if (am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
                    var arrays = am.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : Array.Empty<int>();
                    if (ix.Length == 0) ix = Enumerable.Range(0, v.Length).ToArray();
                    var colours = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.PackedColorArray ? arrays[(int)Mesh.ArrayType.Color].AsColorArray() : null;
                    for (int t = 0; t + 2 < ix.Length; t += 3)
                    {
                        Vector3 a = xf * v[ix[t]], b = xf * v[ix[t + 1]], c = xf * v[ix[t + 2]];
                        if (Geometry3D.RayIntersectsTriangle(o, d, a, b, c).Obj is not Vector3 hit) continue;
                        hits.Add((o.DistanceTo(hit), FormattableString.Invariant($"{hit.X:0.00},{hit.Y:0.00},{hit.Z:0.00}\t{Short(mi)}\t{Material(am, mi, s)}\talpha {(colours != null ? (int)MathF.Round(colours[ix[t]].A * 255) : -1)}\ttriangle {t / 3} corners {a.X:0.00} {a.Y:0.00} {a.Z:0.00} / {b.X:0.00} {b.Y:0.00} {b.Z:0.00} / {c.X:0.00} {c.Y:0.00} {c.Z:0.00}")));
                    }
                }
            }
            lines.AddRange(hits.OrderBy(h => h.At).Take(8).Select(h => FormattableString.Invariant($"{one}\t{h.At:0.00} m\t{h.What}")));
        }
        File.WriteAllLines(Path.ChangeExtension(file, null) + "-rays.txt", lines);
    }

    private static Rect2 Rect(Vector2[] o)
    {
        var lo = new Vector2(o.Min(p => p.X), o.Min(p => p.Y)); var hi = new Vector2(o.Max(p => p.X), o.Max(p => p.Y));
        return new Rect2(lo, hi - lo).Grow(Margin);
    }

    private static bool Leftover((Vector2[] Outline, Rect2 Box)[] razed, (Vector2[] Outline, Rect2 Box)[] standing, Vector3 p)
    {
        var q = new Vector2(p.X, p.Z);
        float At(Vector2[] o) => NativeRazedHouses.Inside(o, q) ? 0 : NativeRazedHouses.EdgeDistance(o, q);
        float r = float.MaxValue;
        foreach (var h in razed) if (h.Box.HasPoint(q)) r = Math.Min(r, At(h.Outline));
        if (r > Margin) return false;
        foreach (var h in standing) if (h.Box.Grow(r).HasPoint(q) && At(h.Outline) <= r) return false;
        return true;
    }

    /// <summary>Why a node belongs on the cleared ground ("" when it does not).</summary>
    private static string Why(Node node)
    {
        string name = node.Name.ToString();
        if (System.Text.RegularExpressions.Regex.IsMatch(name, @"^INST\d+_tree")) return "trees";
        for (Node? n = node; n != null; n = n.GetParent())
        {
            if (n.HasMeta(NativeChurchyard.Meta)) return "churchyard";
            if (n.HasMeta(NativeSquareDressing.Meta)) return "square dressing";
            if (n.HasMeta(NativeRazedHouses.DressingMeta)) return "square benches";
            if (n.Name == "town_wall") return "town wall";
        }
        return "";
    }

    private static string Material(Mesh mesh, MeshInstance3D? m, int s) => (m?.GetActiveMaterial(s) ?? mesh.SurfaceGetMaterial(s)) is { } mat ? (mat.ResourcePath != "" ? mat.ResourcePath : mat.ResourceName) : "";

    private static string Short(Node n) => string.Join("/", n.GetPath().ToString().Split('/').TakeLast(3));

    private static bool Overlaps(Aabb box, Rect2 r) => box.Position.X <= r.End.X && box.End.X >= r.Position.X && box.Position.Z <= r.End.Y && box.End.Z >= r.Position.Y && box.End.Y >= Above;
}

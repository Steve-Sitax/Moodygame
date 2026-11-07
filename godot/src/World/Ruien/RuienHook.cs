using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The lamp hook for a curved vault wall (Steve, 2026-11-02): a straight bracket's back bar and brace stand off a
/// curving wall and float, so a lamp there hangs from a forged hook instead. One shared model: an 18 mm round bar
/// leaded 50 mm into a brick joint, a 75 mm square wall plate laid on the brick (the wall's own normal at the
/// fixing) with two dome-headed bolts and a lead collar, a level arm out over the lantern with an upturned, knobbed
/// end, and a ring from which the lantern hangs plumb. Straight walls keep the bracket.
/// </summary>
public static class RuienHook
{
    /// <summary>A lantern's top above its light marker (the export's brass cap; the kit lamp's too).</summary>
    public const float TopAboveLight = .169f;
    private const float BarR = .009f, RingR = .02f, RingTube = .004f;
    /// <summary>The hook's arm is at least this long; the glass hangs at least this far off the brick.</summary>
    public const float MinArm = .22f, MinGlass = .12f;

    /// <summary>
    /// The hooks of an exported area's lamps listed in lampHooks: their brackets leave every level and the
    /// collision. A lantern the curving wall comes too close to (or into) moves out, with its light, until it hangs
    /// clear on the hook's arm.
    /// </summary>
    public static int Fit(RuienData.Area area, RuienArea export, Node3D root)
    {
        using var profile=Dev.StartupTiming.Measure("ruien.hooks."+area.Id);
        int fitted = 0;
        var lod0 = export.Keys.SelectMany(k => k.Lods[0]).ToList();
        var all = export.Keys.SelectMany(k => k.Lods.SelectMany(l => l)).ToList();
        var walls = lod0.Select(m => m.Mesh).OfType<ArrayMesh>().ToList();
        foreach (var s in area.Sources.Where(s => s.Kind == "lamp" && area.LampHooks.Contains(s.Id)))
        {
            var removed = new List<Vector3>();
            var light = s.At;
            foreach (var mi in all)
            {
                if (mi.Mesh is not ArrayMesh mesh || !mesh.GetAabb().Grow(.6f).HasPoint(light)) continue;
                if (Without(mesh, f => f == "ruien_iron", c => Bracket(c, light), lod0.Contains(mi) ? removed : null) is { } done) mi.Mesh = done;
            }
            if (removed.Count == 0) { GD.PushWarning($"ruien hook: no bracket at {s.Id}"); continue; }
            // The bracket's far end is at the wall: its direction from the lantern, level.
            var far = removed.OrderByDescending(p => new Vector2(p.X - light.X, p.Z - light.Z).Length()).First();
            var dir = new Vector3(far.X - light.X, 0, far.Z - light.Z).Normalized();
            walls = lod0.Select(m => m.Mesh).OfType<ArrayMesh>().ToList();
            if (Fitting(walls, light, dir) is not { } fit) { GD.PushWarning($"ruien hook: no wall behind {s.Id}"); continue; }
            if (fit.shift.LengthSquared() > 0)
            {
                // The lantern (brass, glass, gauze, flame) moves out with its light.
                foreach (var mi in all)
                    if (mi.Mesh is ArrayMesh mesh && mesh.GetAabb().Grow(.6f).HasPoint(light) && Moved(mesh, light, fit.shift) is { } moved) mi.Mesh = moved;
                s.At += fit.shift;
            }
            GD.Print($"ruien hook: {s.Id} arm {(fit.wall - fit.hang).Length():0.000} m, moved out {fit.shift.Length():0.000} m");
            root.AddChild(Build(fit.wall, fit.normal, fit.hang, dir, s.Id));
            // The old bracket's collision goes (the hook and the lantern are overhead and thin).
            if (export.Shape != null)
            {
                var data = export.Shape.Data;
                var keep = new List<Vector3>(data.Length);
                for (int i = 0; i + 2 < data.Length; i += 3)
                    if (!Enumerable.Range(i, 3).All(k => Near(data[k], light, far)))
                    { keep.Add(data[i]); keep.Add(data[i + 1]); keep.Add(data[i + 2]); }
                if (keep.Count != data.Length) export.Shape.Data = keep.ToArray();
            }
            fitted++;
        }
        return fitted;
    }

    /// <summary>
    /// A kit lamp on a curved wall: the hook fitted to the brick behind the lantern; the piece moves out when the wall
    /// comes too close. False when no brick is found.
    /// </summary>
    public static bool Place(Node3D root, Node3D piece, IEnumerable<ArrayMesh> walls, Vector3 lanternTop, string id)
    {
        using var profile=Dev.StartupTiming.Measure("ruien.hook.place");
        var dir = piece.Basis * Vector3.Right; dir.Y = 0; dir = dir.Normalized();
        var light = piece.Transform * lanternTop - Vector3.Up * TopAboveLight;
        if (Fitting(walls, light, dir) is not { } fit) { GD.PushWarning($"ruien hook: no wall behind {id}"); return false; }
        piece.Position += fit.shift;
        GD.Print($"ruien hook: {id} arm {(fit.wall - fit.hang).Length():0.000} m, moved out {fit.shift.Length():0.000} m");
        root.AddChild(Build(fit.wall, fit.normal, fit.hang, dir, id));
        return true;
    }

    /// <summary>
    /// Fit a hook between a lantern (its light) and the wall it hangs on (dir: level, from the lantern to the wall):
    /// the wall at the arm's height and at the glass's foot, found from the gallery side, and how far the lantern must
    /// move out to hang clear. Null: no wall.
    /// </summary>
    public static (Vector3 wall, Vector3 normal, Vector3 hang, Vector3 shift)? Fitting(IEnumerable<ArrayMesh> walls, Vector3 light, Vector3 dir)
    {
        var top = light + Vector3.Up * TopAboveLight;
        float arm = top.Y + RingR + BarR - RingTube;
        var list = walls.ToList();
        if (Wall(list, new Vector3(light.X, arm, light.Z), dir) is not { } high) return null;
        var low = Wall(list, light + Vector3.Down * .1f, dir);
        float dHigh = (high.at - light).Dot(dir), dLow = low is { } l ? (l.at - light).Dot(dir) : dHigh;
        float shift = Math.Max(0, Math.Max(MinArm - dHigh, MinGlass - dLow));
        var move = -dir * shift;
        return (high.at, high.normal, new Vector3(light.X, arm, light.Z) + move, move);
    }

    /// <summary>The first brick met along dir (level) through `at`, searched from 0.8 m on the near side.</summary>
    private static (Vector3 at, Vector3 normal)? Wall(List<ArrayMesh> walls, Vector3 at, Vector3 dir)
    {
        var from = at - dir * .8f; const float reach = 1.8f; float best = reach; var normal = -dir;
        var end=from+dir*reach;
        // A conservative short-ray box rejects distant triangles before the native exact intersection.
        // Keep a centimetre of margin around the box for floating-point boundary cases.
        var lo=new Vector3(Math.Min(from.X,end.X)-.01f,Math.Min(from.Y,end.Y)-.01f,Math.Min(from.Z,end.Z)-.01f);
        var hi=new Vector3(Math.Max(from.X,end.X)+.01f,Math.Max(from.Y,end.Y)+.01f,Math.Max(from.Z,end.Z)+.01f);
        foreach (var mesh in walls)
        {
            if (!mesh.GetAabb().Grow(.1f).IntersectsSegment(from, from + dir * reach)) continue;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (!mesh.SurfaceGetName(s).Contains("brick")) continue;
                var arrays = mesh.SurfaceGetArrays(s);
                var p = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var ix = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                for (int t = 0; t + 2 < ix.Length; t += 3)
                {
                    Vector3 a = p[ix[t]], b = p[ix[t + 1]], c = p[ix[t + 2]];
                    if(Math.Max(a.X,Math.Max(b.X,c.X))<lo.X || Math.Min(a.X,Math.Min(b.X,c.X))>hi.X
                        || Math.Max(a.Y,Math.Max(b.Y,c.Y))<lo.Y || Math.Min(a.Y,Math.Min(b.Y,c.Y))>hi.Y
                        || Math.Max(a.Z,Math.Max(b.Z,c.Z))<lo.Z || Math.Min(a.Z,Math.Min(b.Z,c.Z))>hi.Z)continue;
                    if (Geometry3D.RayIntersectsTriangle(from, dir, a, b, c).Obj is not Vector3 hit) continue;
                    float d = from.DistanceTo(hit);
                    if (d >= best) continue;
                    best = d;
                    normal = (b - a).Cross(c - a).Normalized();
                    if (normal.Dot(dir) > 0) normal = -normal;
                }
            }
        }
        return best < reach ? (from + dir * best, normal) : null;
    }

    // The straight bracket: back bar, arm, brace and hanger, between the lantern and the wall (no lantern brass).
    private static bool Bracket(Vector3 c, Vector3 light) =>
        new Vector2(c.X - light.X, c.Z - light.Z).Length() < .52f && c.Y > light.Y - .16f && c.Y < light.Y + .36f;

    // A collision triangle of the old bracket: over the line from the lantern to the bracket's far end.
    private static bool Near(Vector3 p, Vector3 light, Vector3 far)
    {
        if (p.Y < light.Y - .2f || p.Y > light.Y + .4f) return false;
        var a = new Vector2(light.X, light.Z); var b = new Vector2(far.X, far.Z); var q = new Vector2(p.X, p.Z);
        var ab = b - a; float t = Math.Clamp((q - a).Dot(ab) / Math.Max(ab.LengthSquared(), 1e-6f), 0, 1);
        return q.DistanceTo(a + ab * t) < .12f && (q - a).Dot(ab) < ab.LengthSquared() - .0004f;
    }

    /// <summary>A copy of the mesh without the triangles drop picks in the surfaces family names; null when none.</summary>
    public static ArrayMesh? Without(ArrayMesh mesh, Func<string, bool> family, Func<Vector3, bool> drop, List<Vector3>? removed = null)
    {
        bool any = false;
        var selected=new Dictionary<int,Godot.Collections.Array?>();
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            string name = mesh.SurfaceGetName(s);
            if(!family(name))continue;
            var arrays=mesh.SurfaceGetArrays(s);
            var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
            var keep=new List<int>(ix.Length);
            for(int t=0;t<ix.Length;t+=3)
            {
                var c=(p[ix[t]]+p[ix[t+1]]+p[ix[t+2]])/3;
                if(drop(c))
                {
                    any=true;
                    if(removed!=null){removed.Add(p[ix[t]]);removed.Add(p[ix[t+1]]);removed.Add(p[ix[t+2]]);}
                }
                else {keep.Add(ix[t]);keep.Add(ix[t+1]);keep.Add(ix[t+2]);}
            }
            arrays[(int)Mesh.ArrayType.Index]=keep.ToArray();
            selected[s]=keep.Count==0?null:arrays;
        }
        if(!any)return null;
        // Most meshes near a lamp contain no bracket. Never rebuild their unrelated masonry surfaces.
        var done=new ArrayMesh();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
        {
            var arrays=selected.TryGetValue(s,out var picked)?picked:mesh.SurfaceGetArrays(s);
            if(arrays!=null)Copy(done,mesh,s,arrays,mesh.SurfaceGetName(s));
        }
        return done;
    }

    // The lantern's parts round its light (brass pot and cap, glass, gauze, flame) moved by shift.
    private static ArrayMesh? Moved(ArrayMesh mesh, Vector3 light, Vector3 shift)
    {
        bool any=false;
        var selected=new Dictionary<int,Godot.Collections.Array>();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
        {
            string name=mesh.SurfaceGetName(s);
            if(!name.Contains("Brass_lamp") && !name.Contains("Lamp_"))continue;
            var arrays=mesh.SurfaceGetArrays(s);
            var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            for(int i=0;i<p.Length;i++)
                if(new Vector2(p[i].X-light.X,p[i].Z-light.Z).Length()<.09f && p[i].Y>light.Y-.14f && p[i].Y<light.Y+.2f)
                {p[i]+=shift;any=true;}
            arrays[(int)Mesh.ArrayType.Vertex]=p;selected[s]=arrays;
        }
        if(!any)return null;
        var done=new ArrayMesh();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
            Copy(done,mesh,s,selected.TryGetValue(s,out var arrays)?arrays:mesh.SurfaceGetArrays(s),mesh.SurfaceGetName(s));
        return done;
    }

    private static void Copy(ArrayMesh done, ArrayMesh mesh, int s, Godot.Collections.Array arrays, string name)
    {
        done.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, mesh.SurfaceGetFormat(s) & ~Mesh.ArrayFormat.FlagCompressAttributes);
        done.SurfaceSetName(done.GetSurfaceCount() - 1, name);
        done.SurfaceSetMaterial(done.GetSurfaceCount() - 1, mesh.SurfaceGetMaterial(s));
    }

    /// <summary>The hook: wall plate on the brick at wall (its normal), a level arm out to hang, the ring there.</summary>
    public static Node3D Build(Vector3 wall, Vector3 normal, Vector3 hang, Vector3 dir, string id)
    {
        var st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles);
        var iron = RuienMaterials.Get("ruien_iron");
        void Rod(Vector3 a, Vector3 b, float r)
        {
            var d = b - a; var y = d.Normalized();
            var x = y.Cross(Mathf.Abs(y.Y) > .9f ? Vector3.Right : Vector3.Up).Normalized(); var z = x.Cross(y);
            var t = new SurfaceTool(); t.CreateFrom(new CylinderMesh { TopRadius = r, BottomRadius = r, Height = d.Length(), RadialSegments = 12, Rings = 1 }, 0); t.Deindex();
            st.AppendFrom(t.Commit(), 0, new Transform3D(new Basis(x, y, z), (a + b) / 2));
        }
        void Ball(Vector3 at, float r, Vector3? axis = null)
        {
            bool half = axis != null;
            var t = new SurfaceTool(); t.CreateFrom(new SphereMesh { Radius = r, Height = half ? r : 2 * r, RadialSegments = 12, Rings = 6, IsHemisphere = half }, 0); t.Deindex();
            var y = axis ?? Vector3.Up; var x = y.Cross(Mathf.Abs(y.Y) > .9f ? Vector3.Right : Vector3.Up).Normalized();
            st.AppendFrom(t.Commit(), 0, new Transform3D(new Basis(x, y, x.Cross(y)), at));
        }
        // The arm meets the brick at wall; the bar runs on 50 mm into the joint behind the plate (leaded in).
        // The plate lies on the brick: square to the wall's own normal, its edges level and plumb in that plane.
        var up = (Vector3.Up - normal * normal.Dot(Vector3.Up)).Normalized(); var side = up.Cross(normal);
        st.AppendFrom(BevelMesh.Box(new Vector3(.075f, .075f, .009f), .002f, iron), 0, new Transform3D(new Basis(side, up, normal), wall + normal * .0045f));
        foreach (float v in new[] { -.025f, .025f }) Ball(wall + normal * .009f + up * v, .009f, normal);
        Rod(wall + normal * .009f, wall + normal * .02f, .016f); // the lead collar round the bar
        Rod(wall + dir * .05f, hang - dir * .045f, BarR);
        // The end turns up in a short knobbed scroll, so the ring cannot slide off.
        var end = hang - dir * .045f; var tip = end - dir * .012f + Vector3.Up * .035f;
        Ball(end, BarR); Rod(end, tip, BarR * .9f); Ball(tip, BarR * 1.25f);
        // The ring hangs from the bar, its plane square to the arm; the lantern's cap hangs from the ring.
        var ring = new SurfaceTool(); ring.CreateFrom(new TorusMesh { InnerRadius = RingR - RingTube, OuterRadius = RingR + RingTube, Rings = 24, RingSegments = 8 }, 0); ring.Deindex();
        var ry = dir; var rx = Vector3.Up.Cross(ry).Normalized(); var rz = rx.Cross(ry);
        st.AppendFrom(ring.Commit(), 0, new Transform3D(new Basis(rx, ry, rz), hang + Vector3.Down * (RingR - RingTube - BarR)));
        var node = new Node3D { Name = "lamp_hook_" + id };
        RuienStair.Add(node, st, "ruien_iron", false);
        return node;
    }
}

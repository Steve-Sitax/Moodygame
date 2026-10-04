using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Play;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Opening probes in the real world, using the browser interior check's pane-free sample grid.</summary>
public static class InteriorVisibility
{
    private sealed record Triangle(Vector3 A, Vector3 B, Vector3 C, bool Two, float Facing, string Material)
    {
        public Aabb Box => new Aabb(A, Vector3.Zero).Expand(B).Expand(C);
    }
    // Local-space triangle BVH: huge city chunks must not be walked afresh for every opening ray.
    private sealed class Tree
    {
        public Aabb Box;
        public Tree? Left, Right;
        public Triangle[]? Leaves;
        public Tree(Triangle[] tris)
        {
            Box = tris[0].Box;
            foreach (var t in tris) Box = Box.Merge(t.Box);
            if (tris.Length <= 12) { Leaves = tris; return; }
            int axis = Box.Size.X > Box.Size.Y ? (Box.Size.X > Box.Size.Z ? 0 : 2) : (Box.Size.Y > Box.Size.Z ? 1 : 2);
            Array.Sort(tris, (a, b) => a.Box.GetCenter()[axis].CompareTo(b.Box.GetCenter()[axis]));
            int mid = tris.Length / 2;
            Left = new(tris[..mid]); Right = new(tris[mid..]);
        }
        public (float distance, string material)? Cast(Vector3 o, Vector3 d, float far)
        {
            if (!Box.Grow(0.0001f).IntersectsSegment(o, o + d * far)) return null;
            (float distance, string material)? best = null;
            if (Leaves != null) foreach (var t in Leaves)
            {
                var ab = t.B - t.A; var ac = t.C - t.A;
                if (!t.Two && ab.Cross(ac).Dot(d) * t.Facing > 0) continue;
                var p = d.Cross(ac); float det = ab.Dot(p);
                if (Math.Abs(det) < 1e-9f) continue;
                float inv = 1 / det; var s = o - t.A;
                float u = s.Dot(p) * inv;
                if (u < 0 || u > 1) continue;
                var q = s.Cross(ab); float v = d.Dot(q) * inv;
                if (v < 0 || u + v > 1) continue;
                float dist = ac.Dot(q) * inv;
                if (dist > 0.001f && dist <= far && (best == null || dist < best.Value.distance)) best = (dist, t.Material);
            }
            else
            {
                best = Left!.Cast(o, d, far);
                var right = Right!.Cast(o, d, best?.distance ?? far);
                if (right != null && (best == null || right.Value.distance < best.Value.distance)) best = right;
            }
            return best;
        }
    }
    private sealed record Model(MeshInstance3D Node, Aabb WorldBox, Transform3D Inverse, Tree Tree, string Path);
    private sealed record Hit(float Distance, string Path, string Material, bool Room);
    private static Model? Read(MeshInstance3D n, Dictionary<Mesh, Tree?> trees)
    {
        if (n.Mesh is not { } mesh) return null;
        if (!trees.TryGetValue(mesh, out var tree))
        {
            var tris = new List<Triangle>();
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var material = n.GetActiveMaterial(s); string name = material?.ResourceName ?? "";
                if (material?.HasMeta("baked_invisible") == true) continue;
                var kind = material is ShaderMaterial sm ? Psx.KindOf(sm.Shader) : null;
                if (kind is { Add: true } || kind is { Blend: true } && material is ShaderMaterial pane && pane.GetShaderParameter("albedo").AsColor().A < 0.95f || name.Contains("glass", StringComparison.OrdinalIgnoreCase) || name.Contains("glow", StringComparison.OrdinalIgnoreCase)) continue;
                if (material is BaseMaterial3D { Transparency: not BaseMaterial3D.TransparencyEnum.Disabled }) continue;
                var arrays = mesh.SurfaceGetArrays(s);
                if (arrays.Count == 0 || arrays[(int)Mesh.ArrayType.Vertex].VariantType == Variant.Type.Nil) continue;
                var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var normals = arrays[(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? Array.Empty<Vector3>() : arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                var indices = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Array.Empty<int>() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                int count = indices.Length == 0 ? vertices.Length : indices.Length;
                int Index(int i) => indices.Length == 0 ? i : indices[i];
                for (int i = 0; i + 2 < count; i += 3)
                {
                    var a = vertices[Index(i)]; var b = vertices[Index(i + 1)]; var c = vertices[Index(i + 2)];
                    var cross = (b - a).Cross(c - a);
                    if (cross.LengthSquared() < 1e-12f) continue;
                    float facing = normals.Length == vertices.Length && cross.Dot(normals[Index(i)]) < 0 ? -1 : 1;
                    tris.Add(new(a, b, c, kind?.TwoSided ?? true, facing, name));
                }
            }
            trees[mesh] = tree = tris.Count == 0 ? null : new Tree(tris.ToArray());
        }
        return tree == null ? null : new(n, n.GlobalTransform * mesh.GetAabb(), n.GlobalTransform.AffineInverse(), tree, n.GetPath().ToString());
    }
    private static Hit? Cast(IEnumerable<Model> models, Vector3 o, Vector3 d, float far, Node3D room)
    {
        Hit? best = null;
        foreach (var m in models)
        {
            float reach = best?.Distance ?? far;
            if (!m.WorldBox.Grow(0.0001f).IntersectsSegment(o, o + d * reach)) continue;
            var hit = m.Tree.Cast(m.Inverse * o, m.Inverse.Basis * d, reach);
            if (hit is { } h) best = new(h.distance, m.Path, h.material, room.IsAncestorOf(m.Node));
        }
        return best;
    }
    private static Godot.Collections.Dictionary Extras(Node n) => n.GetMeta("extras").AsGodotDictionary();
    private static List<Vector3> Samples(Node3D marker, out Vector3 normal, out float depth)
    {
        var e = Extras(marker);
        float Number(string k, float fallback = 0) => e.TryGetValue(k, out var v) ? v.AsSingle() : fallback;
        var basis = (marker.GetParent() as Node3D)?.GlobalTransform.Basis ?? Basis.Identity;
        normal = (basis * new Vector3(Number("nx"), Number("ny"), Number("nz"))).Normalized();
        var tangent = (basis * new Vector3(Number("tx", -normal.Z), 0, Number("tz", normal.X))).Normalized();
        if (tangent.LengthSquared() < 0.5f) tangent = normal.Cross(Vector3.Up).Normalized();
        depth = Number("depth", 0.3f);
        float hw = Number("hw", 0.3f), yb = Number("yb", marker.GlobalPosition.Y - 0.5f), yt = Number("yt", marker.GlobalPosition.Y + 0.5f);
        string shape = e.TryGetValue("shape", out var sh) ? sh.AsString() : "rect";
        bool arch = Number("arch") != 0;
        var pts = new List<Vector3>();
        if (shape == "round") foreach (var (a, f) in new[] { (0.6f, 0.45f), (2.2f, 0.55f), (3.9f, 0.5f), (5.2f, 0.6f) })
            pts.Add(marker.GlobalPosition + tangent * (MathF.Cos(a) * Number("r", hw) * f) + Vector3.Up * (MathF.Sin(a) * Number("r", hw) * f));
        else if (shape == "quad") foreach (float f in new[] { -0.37f, -0.13f, 0.11f, 0.33f }) pts.Add(marker.GlobalPosition + tangent * (f * hw * 2));
        else foreach (float fu in new[] { -0.37f, -0.13f, 0.13f, 0.37f }) foreach (float fy in e["kind"].AsString() == "door" ? new[] { 0.18f, 0.54f } : new[] { 0.18f, 0.54f, 0.84f })
            pts.Add(new Vector3(marker.GlobalPosition.X, yb + (yt - yb - (arch ? hw : 0)) * fy, marker.GlobalPosition.Z) + tangent * (fu * hw * 2));
        return pts;
    }
    public static async Task<object> Run(Checks check, Func<int, Task> frames)
    {
        var targets = BakedWorld.All(Main.I).OfType<IInteriorAuditSource>().SelectMany(s => s.InteriorAuditTargets).ToArray();
        var markers = BakedWorld.All(Main.I.World).OfType<Node3D>().Where(n => n.Name.ToString().StartsWith("opening_") && n.HasMeta("extras") && Extras(n).ContainsKey("kind")).ToArray();
        var problems = new List<string>(); var list = new List<object>();
        string chosen = Main.I.Arg("interior-rooms");
        var selected = chosen.Length == 0 ? targets : targets.Where(t => chosen.Split(',').Contains(t.Id)).ToArray();
        bool details = Main.I.Flag("interior-ray-details");
        var trees = new Dictionary<Mesh, Tree?>();
        int blocked = 0, empty = 0, visibleRooms = 0, closedDoors = 0, streetBlocked = 0;
        var doorStates = Doors.I.All.Select(d => (d, d.Forced, d.Known, d.Target)).ToArray();
        bool fly = Player.Jef.I.Fly;
        if (!fly) Player.Jef.I.ToggleFly();
        var cam = Main.I.Cam; var saved = cam.GlobalTransform;
        if (targets.Length == 0) problems.Add("no live room registry");
        foreach (var m in markers) if (targets.Count(t => t.Openings.Contains(m)) != 1) problems.Add("opening must have exactly one room: " + m.GetPath());
        try
        {
            foreach (var d in Doors.I.All.Where(d => !d.Fixed)) Doors.I.Force(d, true);
            await frames(480); // heavy leaves swing at 0.55 rad/s: let the actual door finish opening
            // Read all meshes, including culled rooms. Visibility is selected again at each real room visit.
            // The per-opening test uses these same bounds. Avoid building BVHs for unrelated districts and rooms.
            var models = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>()
                .Where(n => n.Mesh != null && selected.Any(t => (n.GlobalTransform * n.Mesh.GetAabb()).Intersects(t.Bounds.Grow(3))))
                .Select(n => Read(n, trees)).Where(m => m != null).Cast<Model>().ToArray();
            foreach (var target in selected)
            {
                Rooms.I.AuditRoom = target.Id;
                if (target.Openings.Count == 0) { problems.Add("room has no opening markers: " + target.Id); continue; }
                foreach (var marker in target.Openings)
                {
                    var e = Extras(marker); string kind = e["kind"].AsString(); string label = e.TryGetValue("label", out var l) ? l.AsString() : marker.Name.ToString();
                    var pts = Samples(marker, out var normal, out float depth);
                    if (normal.LengthSquared() < 0.5f) { problems.Add("no opening normal: " + label); continue; }
                    cam.GlobalPosition = marker.GlobalPosition + normal * (depth + 1.5f);
                    await frames(2);
                    // Both room and street use their actual current visibility, with this room pinned and its lining removed.
                    var near = models.Where(m => m.WorldBox.Intersects(target.Bounds.Grow(3)) && m.Node.IsVisibleInTree()).ToArray();
                    int toRoom = 0, toShell = 0, toNothing = 0, toStreet = 0; var probes = new List<object>();
                    float reach = Math.Max(40, target.Bounds.Size.Length() + 2);
                    bool liveDoor = Doors.I.All.Any(d => !d.Fixed && d.Middle.DistanceTo(marker.GlobalPosition) < 2);
                    bool closed = kind == "door" && !liveDoor && (target.ShutDoors.Contains(marker) || Doors.I.All.Any(d => d.Fixed && d.Middle.DistanceTo(marker.GlobalPosition) < 2));
                    foreach (var p in pts)
                    {
                        var hit = Cast(near, p + normal * 0.6f, -normal, reach, target.Room);
                        bool wall = hit != null && !hit.Room && hit.Distance < 0.6f + depth + 0.35f;
                        bool through = target.Apertures.Any(b => !b.Grow(0.15f).HasPoint(marker.GlobalPosition) && b.IntersectsSegment(p + normal * 0.6f, p - normal * reach));
                        if (wall) toShell++;
                        else if (through || hit != null && (hit.Room || target.Bounds.Grow(0.2f).HasPoint(p + normal * 0.6f - normal * hit.Distance))) toRoom++;
                        else toNothing++;
                        // Just inside the reveal, trace the same aperture back to the street. A room lining there fails.
                        float insideDepth = depth + 0.12f;
                        var reverse = Cast(near, p - normal * insideDepth, normal, insideDepth + 0.8f, target.Room);
                        Vector3? streetDirection = reverse == null || reverse.Distance > insideDepth + 0.6f ? normal : null;
                        // A louvred bell opening and a cellar light well have an angled view. Trace through the same
                        // aperture point, starting inside; do not mistake their real slats/outer well wall for a pane.
                        List<object>? angles = details ? new() : null;
                        if (streetDirection == null) foreach (float slope in new[] { -0.5f, 0.5f, -1f, 1f, -1.5f, 1.5f, -2f, 2f, -3f, 3f, -4f, 4f })
                        {
                            var direction = (normal + Vector3.Up * slope).Normalized();
                            float outward = direction.Dot(normal);
                            var inside = p - direction * (insideDepth / outward);
                            if (!target.Bounds.Grow(0.05f).HasPoint(inside)) continue;
                            var angled = Cast(near, inside, direction, (insideDepth + 0.8f) / outward, target.Room);
                            angles?.Add(new { slope, inside = new[] { inside.X, inside.Y, inside.Z }, hit = angled });
                            if (angled == null || angled.Distance > (insideDepth + 0.6f) / outward) { streetDirection = direction; break; }
                        }
                        if (streetDirection != null) toStreet++;
                        probes.Add(new { point = new[] { p.X, p.Y, p.Z }, hit, reverse, streetDirection = streetDirection is { } sd ? new[] { sd.X, sd.Y, sd.Z } : null, angles, through, blocked = wall });
                    }
                    bool occluded = !closed && toRoom == 0 && toShell >= pts.Count * 0.6f;
                    bool absent = !closed && toRoom == 0 && toNothing > 0;
                    bool insideBlocked = !closed && toStreet < pts.Count * 0.3f;
                    if (closed) closedDoors++;
                    else
                    {
                        if (occluded) { blocked++; problems.Add(target.Id + ": closed shell at " + label); }
                        if (absent) { empty++; problems.Add(target.Id + ": no room seen at " + label); }
                        if (!occluded && !absent && toRoom < pts.Count * 0.3f) problems.Add(target.Id + ": room shows through too few samples at " + label);
                        if (insideBlocked) { streetBlocked++; problems.Add(target.Id + ": street blocked from inside at " + label); }
                        if (toRoom >= pts.Count * 0.3f && !insideBlocked) visibleRooms++;
                    }
                    list.Add(new { room = target.Id, label, path = marker.GetPath().ToString(), at = new[] { marker.GlobalPosition.X, marker.GlobalPosition.Y, marker.GlobalPosition.Z }, kind, closed, blocked = occluded, empty = absent, streetBlocked = insideBlocked, toRoom, toShell, toNothing, toStreet, samples = probes });
                }
                GD.Print($"interiors: {target.Id}, {target.Openings.Count} openings visited");
            }
        }
        finally
        {
            Rooms.I.AuditRoom = null; cam.GlobalTransform = saved;
            foreach (var (d, forced, known, target) in doorStates) { Doors.I.Release(d); d.Forced = forced; d.Known = known; d.Target = target; }
            if (!fly) Player.Jef.I.ToggleFly();
        }
        return new { ok = problems.Count == 0, registeredRooms = targets.Length, buildings = targets.Length, openings = markers.Length, blocked, empty, streetBlocked, visibleRooms, closedDoors, list, problems, diagnosticOnly = chosen.Length > 0, selectedRooms = chosen,
            notCovered = new[] { "floor reachability, lining seams and full shell containment require a walking plan", "sample rays do not certify every aperture pixel or visibility through opaque decorative glass", "MultiMesh geometry and unmarked painted windows", "permanently fixed door leaves stay shut" } };
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>A room part can expose its real geometry without coupling the check to its implementation.</summary>
public interface IInteriorAuditSource
{
    IReadOnlyList<InteriorAuditTarget> InteriorAuditTargets { get; }
}
public sealed record InteriorAuditTarget(string Id, Node3D Shell, Node3D Room, IReadOnlyList<Node3D> Openings);

public static class BuildingAudit
{
    private static Godot.Collections.Dictionary Extras(Node n) => n.HasMeta("extras") ? n.GetMeta("extras").AsGodotDictionary() : new();
    private static bool Clock(Node n) => Extras(n).TryGetValue("liveClock", out var live) && live.AsBool() || n.Name.ToString().StartsWith("clock_face", StringComparison.OrdinalIgnoreCase) || n.Name.ToString().StartsWith("clock_hands", StringComparison.OrdinalIgnoreCase);
    private static ulong Fingerprint(Node3D n)
    {
        ulong h = 1469598103934665603;
        void Number(float v) { h ^= BitConverter.SingleToUInt32Bits(v); h *= 1099511628211; }
        foreach (var node in BakedWorld.All(n).Prepend(n).OfType<Node3D>())
        {
            var t = node.GlobalTransform;
            foreach (var v in new[] { t.Origin, t.Basis.X, t.Basis.Y, t.Basis.Z }) { Number(v.X); Number(v.Y); Number(v.Z); }
            if (node is MeshInstance3D { Mesh: { } mesh }) for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                if (arrays.Count == 0) continue;
                foreach (var v in arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array()) { Number(v.X); Number(v.Y); Number(v.Z); }
            }
        }
        return h;
    }
    public static async Task<object> Clocks(Checks check, Func<int, Task> frames)
    {
        var registry = Movers.Clocks.I;
        if (registry == null) return new { ok = false, total = 0, running = 0, problems = new[] { "live clock registry is unavailable" } };
        await Kit.I.Light(13); await frames(30);
        var first = registry.Dials.ToDictionary(d => d.Node.GetInstanceId(), d => Fingerprint(d.Node));
        await Kit.I.Light(13.5); await frames(60);
        var rows = registry.Report();
        var list = registry.Dials.Select((d, i) => new { where = d.Node.GetPath().ToString(), at = new[] { d.Node.GlobalPosition.X, d.Node.GlobalPosition.Y, d.Node.GlobalPosition.Z }, shown = rows[i].Shown, shows = rows[i].Shows, offBy = rows[i].OffBy, running = rows[i].Running && first[d.Node.GetInstanceId()] != Fingerprint(d.Node), source = "shared live clock registry: hand angles and motion" }).ToArray();
        var problems = list.Where(d => !d.running).Select(d => "clock did not follow the game from 13:00 to 13:30: " + d.where).ToList();
        // An independent marker inventory prevents an omitted clock from disappearing from the check.
        var claimed = registry.Dials.Select(d => d.Node.GetInstanceId()).ToHashSet();
        problems.AddRange(BakedWorld.All(Main.I.View).OfType<Node3D>().Where(Clock).Where(n => !claimed.Contains(n.GetInstanceId())).Select(n => "clock marker missing from live registry: " + n.GetPath()));
        if (list.Length == 0) problems.Add("no clock faces found: missing clock inventory");
        return new { ok = problems.Count == 0, total = list.Length, running = list.Count(d => d.running), hours = new[] { 13, 13.5 }, list, problems,
            notCovered = new[] { "painted clock faces without markers or liveClock metadata" } };
    }
    private sealed record Surface(Vector3[] Vertices, int[] Indices, string Material);
    private sealed record Model(MeshInstance3D Node, Aabb Bounds, Surface[] Surfaces);
    private sealed record Hit(float Distance, string Path, bool Room);
    private static Model? Read(MeshInstance3D n)
    {
        if (n.Mesh == null) return null;
        var list = new List<Surface>();
        for (int i = 0; i < n.Mesh.GetSurfaceCount(); i++)
        {
            var a = n.Mesh.SurfaceGetArrays(i);
            if (a.Count == 0 || a[(int)Mesh.ArrayType.Vertex].VariantType == Variant.Type.Nil) continue;
            string name = n.GetActiveMaterial(i)?.ResourceName ?? "";
            // Transparent glazing is an allowed pane, not an opaque wall. Glows do not establish a room behind it.
            if (name.Contains("glass", StringComparison.OrdinalIgnoreCase) || name.Contains("glow", StringComparison.OrdinalIgnoreCase) || n.Name.ToString().Contains("window_light")) continue;
            if (n.GetActiveMaterial(i) is BaseMaterial3D { Transparency: not BaseMaterial3D.TransparencyEnum.Disabled }) continue;
            var vertices = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var indices = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Array.Empty<int>() : a[(int)Mesh.ArrayType.Index].AsInt32Array();
            list.Add(new(vertices, indices, name));
        }
        return new(n, n.Mesh.GetAabb(), list.ToArray());
    }
    private static float? Ray(Vector3 o, Vector3 d, Vector3 a, Vector3 b, Vector3 c)
    {
        var ab = b - a; var ac = c - a; var p = d.Cross(ac);
        float det = ab.Dot(p);
        if (Math.Abs(det) < 1e-8f) return null;
        float inv = 1 / det; var s = o - a;
        float u = s.Dot(p) * inv;
        if (u < 0 || u > 1) return null;
        var q = s.Cross(ab); float v = d.Dot(q) * inv;
        if (v < 0 || u + v > 1) return null;
        float t = ac.Dot(q) * inv;
        return t > 0.001f ? t : null;
    }
    private static Hit? Cast(IEnumerable<Model> models, Vector3 origin, Vector3 direction, float far, Node3D? room)
    {
        Hit? best = null;
        foreach (var model in models)
        {
            // Goods and crowd parts can detach a baked node after this inventory was read.
            if (!GodotObject.IsInstanceValid(model.Node) || !model.Node.IsInsideTree() || !model.Node.IsVisibleInTree()) continue;
            var inverse = model.Node.GlobalTransform.AffineInverse();
            var o = inverse * origin; var d = inverse.Basis * direction;
            if (!model.Bounds.IntersectsSegment(o, o + d * far)) continue;
            foreach (var surface in model.Surfaces)
            {
                int count = surface.Indices.Length == 0 ? surface.Vertices.Length : surface.Indices.Length;
                Vector3 Vertex(int i) => surface.Vertices[surface.Indices.Length == 0 ? i : surface.Indices[i]];
                for (int i = 0; i + 2 < count; i += 3)
                {
                    var t = Ray(o, d, Vertex(i), Vertex(i + 1), Vertex(i + 2));
                    if (t is not { } distance || distance > far || best != null && distance >= best.Distance) continue;
                    best = new(distance, model.Node.GetPath().ToString(), room != null && (room == model.Node || room.IsAncestorOf(model.Node)));
                }
            }
        }
        return best;
    }
    public static async Task<object> Interiors(Checks check, Func<int, Task> frames)
    {
        var all = BakedWorld.All(Main.I.View).ToArray();
        var sources = BakedWorld.All(Main.I).OfType<IInteriorAuditSource>().SelectMany(s => s.InteriorAuditTargets).ToArray();
        var markers = all.OfType<Node3D>().Where(n => n.Name.ToString().StartsWith("opening_") && Extras(n).ContainsKey("kind")).ToArray();
        var models = all.OfType<MeshInstance3D>().Where(n => n.IsVisibleInTree()).Select(Read).Where(m => m != null).Cast<Model>().ToArray();
        foreach (var d in Doors.I.All.Where(d => !d.Fixed)) Doors.I.Force(d, true);
        await frames(180);
        var problems = new List<string>();
        var list = new List<object>();
        var buildings = new HashSet<string>();
        if (sources.Length == 0) problems.Add("no live interior geometry registry: room visibility cannot be certified; implement IInteriorAuditSource in the room part");
        if (markers.Length == 0) problems.Add("no baked opening markers: missing interior inventory");
        int blocked = 0, empty = 0, visibleRooms = 0;
        for (int i = 0; i < markers.Length; i++)
        {
            var n = markers[i]; var e = Extras(n);
            float Number(string k, float fallback = 0) => e.TryGetValue(k, out var value) ? value.AsSingle() : fallback;
            string label = e.TryGetValue("label", out var l) ? l.AsString() : n.Name.ToString();
            var normal = new Vector3(Number("nx"), 0, Number("nz"));
            if (normal.LengthSquared() < 0.5f) { problems.Add("opening has no outward normal: " + n.GetPath()); continue; }
            normal = normal.Normalized();
            float thickness = Number("depth", 0.2f), halfWidth = Number("hw", 0.5f), height = Number("yt", 2) - Number("yb");
            string building = n.GetParent().GetPath().ToString(); buildings.Add(building);
            var target = sources.FirstOrDefault(t => t.Openings.Contains(n));
            var samples = new List<object>(); bool occluded = false, behind = false, roomVisible = false;
            foreach (float offset in new[] { -0.35f, 0f, 0.35f })
            {
                var side = new Vector3(-normal.Z, 0, normal.X);
                var middle = n.GlobalPosition + side * halfWidth * offset;
                var origin = middle + normal * (thickness / 2 + 0.35f);
                var hit = Cast(models, origin, -normal, 20, target?.Room);
                bool wall = hit != null && hit.Distance < thickness + 0.65f;
                occluded |= wall;
                behind |= hit != null && !wall;
                roomVisible |= hit?.Room == true && !wall;
                samples.Add(new { offset, hit, blocked = wall });
            }
            if (occluded) { blocked++; problems.Add("opaque geometry across opening: " + label + " (" + n.GetPath() + ")"); }
            if (!behind) { empty++; problems.Add("no geometry seen behind opening within 20 m: " + label); }
            if (target != null && !roomVisible) problems.Add("registered room is not visible through opening: " + label);
            if (roomVisible) visibleRooms++;
            list.Add(new { label, path = n.GetPath().ToString(), building, kind = e["kind"].AsString(), height, blocked = occluded, geometryBehind = behind, roomVisible = target == null ? (bool?)null : roomVisible, samples });
            if (i % 8 == 0) await frames(1);
        }
        var unmarked = sources.Where(t => t.Openings.Count == 0).Select(t => t.Id).ToArray();
        problems.AddRange(unmarked.Select(id => "room has no opening markers: " + id));
        return new { ok = problems.Count == 0, buildings = buildings.Count, registeredRooms = sources.Length, openings = markers.Length, blocked, empty, visibleRooms, list, problems,
            diagnosticOnly = sources.Length == 0,
            doors = Doors.I.All.Select(d => new { d.Id, d.Fixed, d.CanPass, d.Open }),
            notCovered = new[] { "room floor reachability, lining seams and containment (needs the room's walking plan)", "painted windows and rooms without opening metadata unless supplied by IInteriorAuditSource", "MultiMesh geometry", "shader-only aperture discard and glass with unnamed materials: triangle probe findings need visual confirmation", "centre and two side rays sample the aperture; they do not prove every pixel is clear", "private and permanently fixed doors stay shut" } };
    }
}

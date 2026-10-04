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
public sealed record InteriorAuditTarget(string Id, Node3D Shell, Node3D Room, IReadOnlyList<Node3D> Openings, Aabb Bounds, IReadOnlyList<Aabb> Apertures, IReadOnlyList<Node3D> ShutDoors);

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
        var dials = BakedWorld.All(Main.I.View).OfType<Node3D>().Where(Clock).ToArray();
        await Kit.I.Light(13); await frames(30);
        var first = dials.ToDictionary(n => n.GetInstanceId(), Fingerprint);
        await Kit.I.Light(13.5); await frames(60);
        var list = dials.Select(n => new { where = n.GetPath().ToString(), at = new[] { n.GlobalPosition.X, n.GlobalPosition.Y, n.GlobalPosition.Z }, shown = n.IsVisibleInTree(), running = first[n.GetInstanceId()] != Fingerprint(n), source = "liveClock extras / clock_face / clock_hands" }).ToArray();
        var problems = list.Where(d => !d.running).Select(d => "clock did not change from 13:00 to 13:30: " + d.where).ToList();
        if (list.Length == 0) problems.Add("no clock faces found: missing clock inventory");
        return new { ok = problems.Count == 0, total = list.Length, running = list.Count(d => d.running), hours = new[] { 13, 13.5 }, list, problems,
            notCovered = new[] { "painted clock faces without markers or liveClock metadata", "whether moved hands show the correct time (this fallback tests motion only)", "GPU-only clock animation that does not change mesh vertices or transforms" } };
    }
    public static Task<object> Interiors(Checks check, Func<int, Task> frames) => InteriorVisibility.Run(check, frames);
}

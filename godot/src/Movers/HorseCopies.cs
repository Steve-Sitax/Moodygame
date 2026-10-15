using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The horses of a pool of copies (the train and omnibus pool, the traffic's drays): the baked body and leg copies take
/// the new parts' meshes and a coat's material; the neck, head, ears, tail, reins and traces are new copies beside
/// them, written each frame with the rest. A pool has one coat, or is a herd: each pair of horses (a team) takes a coat
/// from HorseModel.Herd by its number, and the pool keeps one set of copies for each coat in use, so the callers write a
/// horse's body and legs through BodyOf and LegOf.
/// </summary>
public sealed class HorseCopies
{
    private sealed class Variant
    {
        public Copies? Body, Neck, Head, EarL, EarR, Tail, Reins, Traces;
        public readonly Copies?[] Legs = new Copies?[4];
    }

    private readonly Variant[] variants;
    private readonly int[] variantOf;
    private HorseModel.Frames frames;

    private static Copies Make(Node group, string name, string part, int count, Material m, GeometryInstance3D.ShadowCastingSetting shadow)
    {
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = HorseModel.Mesh(part), InstanceCount = count };
        var node = new MultiMeshInstance3D { Name = name, Multimesh = mm, MaterialOverride = m, CastShadow = shadow };
        group.AddChild(node);
        var c = new Copies(node, count);
        c.ZeroAll();
        return c;
    }

    /// <summary>`body` and `legs` (front, front lower, hind, hind lower) are the baked copies (count horses, legs two each).
    /// `coat` null: a herd, a coat for each `perTeam` horses in a row by their number and `seed`.</summary>
    public HorseCopies(Node group, Copies? body, Copies?[] legs, string? coat, bool withTraces, string prefix, int seed = 0, int perTeam = 2)
    {
        int n = body?.Count ?? 0;
        var coats = new List<string>();
        variantOf = new int[n];
        for (int i = 0; i < n; i++)
        {
            string c = coat ?? HorseModel.CoatOf(i / perTeam, seed);
            int v = coats.IndexOf(c);
            if (v < 0) { v = coats.Count; coats.Add(c); }
            variantOf[i] = v;
        }
        if (coats.Count == 0) coats.Add(coat ?? "bay");
        var shadow = body?.Node.CastShadow ?? GeometryInstance3D.ShadowCastingSetting.On;
        string[] legParts = { "leg_front", "leg_front_lo", "leg_hind", "leg_hind_lo" };
        variants = new Variant[coats.Count];
        for (int v = 0; v < variants.Length; v++)
        {
            var m = HorseModel.Material(coats[v]);
            string tag = prefix + "_" + coats[v];
            var x = variants[v] = new Variant();
            if (v == 0)
            {
                x.Body = body;
                if (body != null) { body.Mm.Mesh = HorseModel.Mesh("body"); body.Node.MaterialOverride = m; }
                for (int k = 0; k < legs.Length; k++)
                {
                    x.Legs[k] = legs[k];
                    if (legs[k] is { } l) { l.Mm.Mesh = HorseModel.Mesh(legParts[k]); l.Node.MaterialOverride = m; }
                }
            }
            else
            {
                if (body != null) x.Body = Make(group, tag + "_horsebody_mm", "body", n, m, shadow);
                for (int k = 0; k < legs.Length; k++)
                    if (legs[k] is { } l) x.Legs[k] = Make(group, tag + "_" + legParts[k] + "_mm", legParts[k], l.Count, m, shadow);
            }
            x.Neck = Make(group, tag + "_horseneck_mm", "neck", n, m, shadow);
            x.Head = Make(group, tag + "_horsehead_mm", "head", n, m, shadow);
            x.EarL = Make(group, tag + "_horseearl_mm", "ear_l", n, m, shadow);
            x.EarR = Make(group, tag + "_horseearr_mm", "ear_r", n, m, shadow);
            x.Tail = Make(group, tag + "_horsetail_mm", "tail", n, m, shadow);
            x.Reins = Make(group, tag + "_horserein_mm", "rein", 2 * n, m, GeometryInstance3D.ShadowCastingSetting.Off);
            if (withTraces) x.Traces = Make(group, tag + "_horsetrace_mm", "trace", 2 * n, m, GeometryInstance3D.ShadowCastingSetting.Off);
        }
    }

    private Variant Of(int i) => variants[i >= 0 && i < variantOf.Length ? variantOf[i] : 0];

    /// <summary>Horse i's body copies, in its coat's set.</summary>
    public Copies? BodyOf(int i) => Of(i).Body;

    /// <summary>Horse i's leg copies `part` (0 front, 1 front lower, 2 hind, 3 hind lower), in its coat's set.</summary>
    public Copies? LegOf(int i, int part) => Of(i).Legs[part];

    public void Set(int i, in Transform3D bodyFrame, HorseGait.Pose p)
    {
        if (i < 0 || i >= variantOf.Length) return;
        var v = Of(i);
        HorseModel.Place(bodyFrame, p, ref frames, v.Traces != null);
        v.Neck?.Set(i, frames.Neck); v.Head?.Set(i, frames.Head); v.EarL?.Set(i, frames.EarL); v.EarR?.Set(i, frames.EarR); v.Tail?.Set(i, frames.Tail);
        v.Reins?.Set(2 * i, frames.ReinL); v.Reins?.Set(2 * i + 1, frames.ReinR);
        v.Traces?.Set(2 * i, frames.TraceL); v.Traces?.Set(2 * i + 1, frames.TraceR);
    }

    public void Zero(int i)
    {
        if (i < 0 || i >= variantOf.Length) return;
        var v = Of(i);
        v.Neck?.Zero(i); v.Head?.Zero(i); v.EarL?.Zero(i); v.EarR?.Zero(i); v.Tail?.Zero(i);
        v.Reins?.Zero(2 * i); v.Reins?.Zero(2 * i + 1); v.Traces?.Zero(2 * i); v.Traces?.Zero(2 * i + 1);
        v.Body?.Zero(i);
        foreach (var l in v.Legs) { l?.Zero(i * 2); l?.Zero(i * 2 + 1); }
    }

    /// <summary>The new copies' buffers (the baked body and legs of the first coat are committed by their owner).</summary>
    public void Commit()
    {
        for (int k = 0; k < variants.Length; k++)
        {
            var v = variants[k];
            v.Neck?.Commit(); v.Head?.Commit(); v.EarL?.Commit(); v.EarR?.Commit(); v.Tail?.Commit(); v.Reins?.Commit(); v.Traces?.Commit();
            if (k == 0) continue;
            v.Body?.Commit();
            foreach (var l in v.Legs) l?.Commit();
        }
    }
}

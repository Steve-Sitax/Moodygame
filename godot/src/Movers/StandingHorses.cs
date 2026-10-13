using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The horses that stand: the Rijnkaai's dray horse waiting in its shafts, and the farrier's horse tied at the post of his
/// lean-to on the Eilandje (it stood in the baked yard as a simple model of its own: now the one horse of horse.scn,
/// one model per thing, its old triangles taken out of the yard's mesh when the town comes in). Each stands on its four
/// feet (the farrier's resting a hind foot on its toe), and nods, turns its ears and swishes its tail like the rest.
/// </summary>
[GamePart(36)]
public partial class StandingHorses : Node
{
    private sealed class Standing
    {
        public Node3D Root = null!;
        public Node3D Body = null!;
        public Node3D[] Legs = null!;
        public HorseNodes Parts = null!;
        public int Id;
        public bool Rest;
    }

    private readonly List<Standing> horses = new();
    private readonly HorseGait.Pose pose = new();

    public override void _Ready()
    {
        if (!HorseModel.Ready) { SetProcess(false); return; }
        // the Rijnkaai's dray horse: the baked standing horse in front of its hitched dray
        if (Mv.Top("dray_horse") is { } dray && dray.GetNodeOrNull<MeshInstance3D>("horse") is { } old)
        {
            old.Visible = false;
            Add(dray, old.Transform, "chestnut", true, 400, false);
        }
        // the farrier's horse, tied at the post at +3.1 m in his yard (build_trades.py tr_farrier): the old model out of
        // the yard's mesh (every triangle past the post), the horse in its place, head to the post
        if (Mv.Top("trades")?.GetNodeOrNull<Node3D>("trade_farrier") is { } yard && yard.GetNodeOrNull<MeshInstance3D>("farrier_trades_solid") is { } solid)
        {
            int cut = Cut(solid, p => p.X > 3.2f);
            Add(yard, new Transform3D(new Basis(Vector3.Up, -MathF.PI / 2), new Vector3(5.25f, 0, 0.3f)), "bay", false, 401, true);
            GD.Print($"standing horses: the farrier's old horse taken out of his yard ({cut} triangles)");
        }
        GD.Print($"standing horses: {horses.Count}");
    }

    /// <summary>The mesh without the triangles whose three corners all pass `gone` (local space); the triangles cut.</summary>
    private static int Cut(MeshInstance3D mi, Func<Vector3, bool> gone)
    {
        if (mi.Mesh is not ArrayMesh src || src.GetSurfaceCount() != 1) return 0;
        var arrays = src.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var keep = new List<int>(idx.Length);
        int cut = 0;
        for (int t = 0; t + 2 < idx.Length; t += 3)
        {
            if (gone(v[idx[t]]) && gone(v[idx[t + 1]]) && gone(v[idx[t + 2]])) { cut++; continue; }
            keep.Add(idx[t]); keep.Add(idx[t + 1]); keep.Add(idx[t + 2]);
        }
        if (cut == 0) return 0;
        arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
        var mesh = new ArrayMesh();
        // (the custom channels' formats, bits 13 to 24 of the surface's format, go with the arrays)
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, flags: (Mesh.ArrayFormat)((long)src.SurfaceGetFormat(0) & (0xFFFL << 13)));
        mesh.SurfaceSetMaterial(0, src.SurfaceGetMaterial(0));
        mesh.ResourceName = src.ResourceName;
        mi.Mesh = mesh;
        return cut;
    }

    private void Add(Node3D parent, Transform3D at, string coat, bool traces, int id, bool rest)
    {
        var root = new Node3D { Name = "standing_horse", Transform = at };
        parent.AddChild(root);
        var body = new MeshInstance3D { Name = "horse_body" };
        root.AddChild(body);
        var legs = new Node3D[8];
        for (int k = 0; k < 8; k++)
        {
            legs[k] = new MeshInstance3D { Name = "horse_leg" + k };
            root.AddChild(legs[k]);
        }
        var parts = HorseNodes.Make(body, legs, coat, traces, id);
        if (parts == null) { root.QueueFree(); return; }
        horses.Add(new Standing { Root = root, Body = body, Legs = legs, Parts = parts, Id = id, Rest = rest });
        Pose(horses[^1]);
    }

    private void Pose(Standing h)
    {
        HorseGait.PoseAt(pose, 0, 0);
        // the farrier's horse rests its near hind foot on the toe
        if (h.Rest) HorseGait.LegAt(pose, 2, HorseGait.HindSole + 0.05f, 0.07f);
        HorseGait.Life(pose, 0, 0, 0, MoverClock.T, h.Id);
        h.Body.Transform = new Transform3D(Basis.Identity, new Vector3(0, pose.Bob, 0));
        for (int k = 0; k < 4; k++)
        {
            var l = pose.Legs[k];
            h.Legs[k * 2].Transform = new Transform3D(new Basis(Vector3.Right, l.Up), new Vector3(l.X, l.Uy, l.Uz));
            h.Legs[k * 2 + 1].Transform = new Transform3D(new Basis(Vector3.Right, l.Lp), new Vector3(l.X, l.Ly, l.Lz));
        }
        h.Parts.Set(pose);
    }

    public override void _Process(double delta)
    {
        var eye = Main.I.Cam?.GlobalPosition ?? Vector3.Zero;
        foreach (var h in horses)
        {
            if (!GodotObject.IsInstanceValid(h.Root) || !h.Root.IsVisibleInTree()) continue;
            if (h.Root.GlobalPosition.DistanceTo(eye) > 70) continue;
            Pose(h);
        }
    }
}

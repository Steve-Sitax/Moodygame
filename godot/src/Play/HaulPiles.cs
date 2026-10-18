using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The dockers' sack piles and the Rijnkaai's cart sacks are real goods (#130): each sack the server keeps (ids
/// "haul:&lt;route&gt;a:&lt;n&gt;" and "sack:&lt;k&gt;:&lt;n&gt;") is drawn as itself by Goods, the one sack model the dockers carry, so a
/// pile shrinks as they take from it and fills again. The town's bake drew those very sacks merged into its
/// goods_sacks meshes: before the town's collision is made (Solid, part 10), their triangles are taken out there,
/// found by each sack's own place, turn and size in the authored goods (services/native-goods.json, "initial").
/// </summary>
[GamePart(9)]
public partial class HaulPiles : Node
{
    /// <summary>A lying sack's size (shared/goods.ts SACK_LIE: 0.88 long along its turn's x, 0.3 high, 0.5 wide), a
    /// little more for the bake's own slump and tied ears.</summary>
    private const float HalfLong = 0.5f, HalfWide = 0.3f, High = 0.36f;
    public int Sacks { get; private set; }
    public int TrianglesTaken { get; private set; }

    /// <summary>Is this one of the goods drawn as itself instead of the bake's merged heap?</summary>
    public static bool Drawn(string id) => id.StartsWith("haul:", StringComparison.Ordinal) || id.StartsWith("sack:", StringComparison.Ordinal);

    private readonly List<(Vector3 At, float Cos, float Sin)> sacks = new();

    public override void _Ready()
    {
        if (Paths.NativeDataRoot == null) return;
        string file = Path.Combine(Paths.NativeDataRoot, "services", "native-goods.json");
        if (!File.Exists(file)) return;
        var data = JsonNode.Parse(File.ReadAllText(file));
        if (data?["initial"] is not JsonArray initial) return;
        foreach (var node in initial)
        {
            if (node is not JsonObject it || it["kind"]?.GetValue<string>() != "sacks" || it["id"]?.GetValue<string>() is not { } id || !Drawn(id)) continue;
            float rot = (float)(it["rot"]?.GetValue<double>() ?? 0);
            sacks.Add((new Vector3((float)it["x"]!.GetValue<double>(), (float)(it["y"]?.GetValue<double>() ?? 0), (float)it["z"]!.GetValue<double>()), MathF.Cos(rot), MathF.Sin(rot)));
        }
        Sacks = sacks.Count;
        foreach (var n in BakedWorld.All(Main.I.World))
            if (n is MeshInstance3D { Mesh: not null } mi && (mi.Name.ToString().StartsWith("goods_sacks", StringComparison.Ordinal) || mi.GetParent()?.Name.ToString().StartsWith("goods_sacks", StringComparison.Ordinal) == true))
                Mask(mi);
        GD.Print($"haul piles: {Sacks} sacks drawn as goods, {TrianglesTaken} of their triangles taken out of the bake");
    }

    private bool InSack(Vector3 p)
    {
        foreach (var (at, c, s) in sacks)
        {
            float dx = p.X - at.X, dz = p.Z - at.Z, dy = p.Y - at.Y;
            if (dy < -0.04f || dy > High || Math.Abs(dx) > HalfLong + 0.1f || Math.Abs(dz) > HalfLong + 0.1f) continue;
            // in the sack's own frame (a turn of rot about y: its length along x)
            float lx = dx * c - dz * s, lz = dx * s + dz * c;
            if (Math.Abs(lx) <= HalfLong && Math.Abs(lz) <= HalfWide) return true;
        }
        return false;
    }

    private void Mask(MeshInstance3D mi)
    {
        var mesh = mi.Mesh;
        var xf = mi.GlobalTransform;
        var made = new ArrayMesh();
        int taken = 0, kept = 0;
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var arrays = mesh.SurfaceGetArrays(s);
            var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var index = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (index.Length == 0) { index = new int[pos.Length]; for (int i = 0; i < index.Length; i++) index[i] = i; }
            var keep = new List<int>(index.Length);
            for (int t = 0; t + 2 < index.Length; t += 3)
            {
                var centre = xf * ((pos[index[t]] + pos[index[t + 1]] + pos[index[t + 2]]) / 3);
                if (InSack(centre)) { taken++; continue; }
                keep.Add(index[t]); keep.Add(index[t + 1]); keep.Add(index[t + 2]);
            }
            kept += keep.Count / 3;
            if (keep.Count == 0) keep.AddRange(new[] { 0, 0, 0 }); // (every surface stays, for its material)
            arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            made.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
        }
        if (taken == 0) return;
        TrianglesTaken += taken;
        // a heap that was only these sacks: nothing of it stays (and the town's collision leaves a hidden node out)
        if (kept == 0) { mi.Visible = false; return; }
        var overrides = new Material?[mi.GetSurfaceOverrideMaterialCount()];
        for (int s = 0; s < overrides.Length; s++) overrides[s] = mi.GetSurfaceOverrideMaterial(s);
        mi.Mesh = made;
        for (int s = 0; s < overrides.Length; s++) mi.SetSurfaceOverrideMaterial(s, overrides[s]);
    }
}

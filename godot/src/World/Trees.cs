using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The falling leaves (the browser's world/trees3d.ts fallingLeaves): five a tree, small diamonds that drift round and
/// down, turning, and start again at the top. The bake froze them where they were; here each leaf finds its tree again
/// (the nearest tree's foot to its five; a willow's start lower) and the psx material moves it from the time alone
/// (Psx.Kind Tree 5). The trees' sway in the wind and the gale is the psx material's too (Tree 1 to 4, psx_gale).
/// </summary>
[GamePart(36)]
public partial class Trees : Node
{
    private const int Per = 5;

    /// <summary>Counts for a check: the leaves falling, the groups.</summary>
    public (int leaves, int groups) Info { get; private set; }

    public override void _Ready()
    {
        var all = BakedWorld.All(Main.I.World).OfType<MultiMeshInstance3D>().ToList();
        // the trees' feet, and which are willows (they start their leaves lower)
        var feet = new List<(Vector3 at, bool willow)>();
        foreach (var mmi in all)
        {
            string n = mmi.Name.ToString();
            if (!n.Contains("bark") || !n.Contains("tree") || mmi.Multimesh == null) continue;
            bool willow = n.Contains("willow");
            var basis = mmi.GlobalTransform;
            for (int i = 0; i < mmi.Multimesh.InstanceCount; i++) feet.Add(((basis * mmi.Multimesh.GetInstanceTransform(i)).Origin, willow));
        }
        int leaves = 0, groups = 0;
        foreach (var mmi in all)
        {
            if (!mmi.Name.ToString().Contains("treesfalling") || mmi.Multimesh is not { } old) continue;
            var src = old.Mesh?.SurfaceGetMaterial(0) as ShaderMaterial ?? mmi.MaterialOverride as ShaderMaterial;
            if (src == null || Psx.KindOf(src.Shader) is not { } kind) continue;
            var mat = (ShaderMaterial)src.Duplicate();
            mat.Shader = Psx.ShaderOf(kind with { Tree = 5, VertexColor = true });
            int n = old.InstanceCount;
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = (Mesh)old.Mesh!.Duplicate(), InstanceCount = n };
            mm.Mesh.SurfaceSetMaterial(0, mat);
            var box = new Aabb();
            for (int t0 = 0; t0 < n; t0 += Per)
            {
                int m = Math.Min(Per, n - t0);
                // where its leaves are now, and the tree nearest them
                var mid = Vector3.Zero;
                float low = float.MaxValue;
                for (int i = 0; i < m; i++)
                {
                    var p = (mmi.GlobalTransform * old.GetInstanceTransform(t0 + i)).Origin;
                    mid += p / m;
                    low = Math.Min(low, p.Y);
                }
                var best = feet.Count > 0 ? feet.MinBy(f => new Vector2(f.at.X - mid.X, f.at.Z - mid.Z).LengthSquared()) : (at: new Vector3(mid.X, low - 1, mid.Z), willow: false);
                bool found = new Vector2(best.at.X - mid.X, best.at.Z - mid.Z).Length() < 4.5f;
                // (no tree near: one of the park's plants; its leaves fall round where they were, from lower down)
                var foot = found ? best.at : new Vector3(mid.X, low - 1, mid.Z);
                float top0 = found ? (best.willow ? 4 : 7) : 3;
                for (int i = 0; i < m; i++)
                {
                    int li = t0 + i;
                    float R(int k) => Hash(foot.X + li * 0.37f, foot.Z, 10 + k);
                    mm.SetInstanceTransform(li, new Transform3D(Basis.Identity, foot));
                    mm.SetInstanceCustomData(li, new Color(top0 + R(1) * 2, (0.6f + R(2) * 2.4f) * (found ? 1 : 0.5f), 0.35f + R(4) * 0.3f, li));
                    mm.SetInstanceColor(li, old.UseColors ? old.GetInstanceColor(li) : new Color(0.78f, 0.6f, 0.19f));
                    var b = new Aabb(foot - new Vector3(5, 0, 5), new Vector3(10, top0 + 3, 10));
                    box = li == 0 ? b : box.Merge(b);
                }
            }
            var fresh = new MultiMeshInstance3D { Name = mmi.Name + "_falling", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = mmi.Layers };
            Main.I.View.AddChild(fresh);
            fresh.GlobalTransform = new Transform3D(Basis.Identity, Vector3.Zero);
            mm.CustomAabb = box;
            mmi.Visible = false;
            leaves += n;
            groups++;
        }
        Info = (leaves, groups);
        GD.Print($"trees: {feet.Count} trees, {leaves} falling leaves in {groups} groups");
    }

    /// <summary>trees3d.ts hash: a number 0..1 from a place and a key.</summary>
    private static float Hash(float x, float z, int k)
    {
        int h = (int)MathF.Round(x * 10) * 73856093 ^ (int)MathF.Round(z * 10) * 19349663 ^ (k + 1) * 83492791;
        h = (h ^ (int)((uint)h >> 15)) * 0x2c1b3c6d;
        h = (h ^ (int)((uint)h >> 12)) * 0x297a2d39;
        return (uint)(h ^ (int)((uint)h >> 15)) / 4294967296f;
    }
}

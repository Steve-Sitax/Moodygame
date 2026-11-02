using Godot;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

/// <summary>Dev: write the church shells' triangles for study (#227, #225, #224).
/// Run church-shell-dump.tscn -- --out &lt;dir outside the checkout&gt; --roots node-09812,node-00798 [--box x0,y0,z0,x1,y1,z1].
/// One text file a root: a line "S" per surface (node path, mesh resource, surface, material), then a line "T" per
/// triangle with its index, world corners, vertex normals (world), uv and vertex colour alpha.</summary>
public partial class ChurchShellDump : Node
{
    public override void _Ready()
    {
        _ = Run();
    }

    async System.Threading.Tasks.Task Run()
    {
        try
        {
            // (a scene's authored objects build their meshes once in the tree: wait a few frames)
            foreach (var root in Arg("roots").Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var scene = ResourceLoader.Load<PackedScene>(root.StartsWith("res://") ? root : $"res://world/town/roots/{root}.scn").Instantiate<Node3D>();
                scene.Name = root.Replace("res://", "").Replace('/', '_').Replace('.', '_'); AddChild(scene);
            }
            for (int i = 0; i < 5; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            Dump(); GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    static string Arg(string name)
    {
        var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--" + name);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : "";
    }

    void Dump()
    {
        string output = Arg("out"); if (output == "") throw new ArgumentException("--out is required");
        Directory.CreateDirectory(output);
        float[]? box = Arg("box") is { Length: > 0 } b ? b.Split(',').Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray() : null;
        var ci = CultureInfo.InvariantCulture;
        foreach (var root in Arg("roots").Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var scene = GetNode<Node3D>(root.Replace("res://", "").Replace('/', '_').Replace('.', '_'));
            using var w = new StreamWriter(Path.Combine(output, scene.Name + ".txt"));
            int total = 0;
            foreach (var node in scene.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
            {
                if (node.Mesh is not ArrayMesh mesh || !node.IsVisibleInTree()) continue;
                var xf = node.GlobalTransform; var nb = xf.Basis.Inverse().Transposed();
                for (int s = 0; s < mesh.GetSurfaceCount(); s++)
                {
                    if (mesh.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
                    var arrays = mesh.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var n = arrays[(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? new Vector3[v.Length] : arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    var uv = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil ? new Vector2[v.Length] : arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    var col = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.Color].AsColorArray();
                    var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var mat = node.GetActiveMaterial(s) ?? mesh.SurfaceGetMaterial(s);
                    bool headed = false;
                    for (int t = 0; t + 2 < ix.Length; t += 3)
                    {
                        Vector3 a = xf * v[ix[t]], bb = xf * v[ix[t + 1]], c = xf * v[ix[t + 2]];
                        if (box != null)
                        {
                            var lo = a.Min(bb).Min(c); var hi = a.Max(bb).Max(c);
                            if (hi.X < box[0] || lo.X > box[3] || hi.Y < box[1] || lo.Y > box[4] || hi.Z < box[2] || lo.Z > box[5]) continue;
                        }
                        if (!headed)
                        {
                            w.WriteLine($"S\t{scene.GetPathTo(node)}\t{mesh.ResourcePath}\t{s}\t{mat?.ResourceName}\t{mat?.ResourcePath}\t{(mat as BaseMaterial3D)?.CullMode.ToString() ?? (mat as ShaderMaterial)?.Shader?.ResourcePath}");
                            headed = true;
                        }
                        var line = new System.Text.StringBuilder();
                        line.Append("T\t").Append(t / 3);
                        foreach (int k in new[] { ix[t], ix[t + 1], ix[t + 2] })
                        {
                            var p = xf * v[k]; var nn = (nb * n[k]).Normalized();
                            line.Append('\t').Append(string.Join(",", new[] { p.X, p.Y, p.Z, nn.X, nn.Y, nn.Z, uv[k].X, uv[k].Y, col != null ? col[k].A : -1f, col != null ? col[k].R : -1f, col != null ? col[k].G : -1f, col != null ? col[k].B : -1f }.Select(f => f.ToString("0.#####", ci))));
                        }
                        w.WriteLine(line.ToString()); total++;
                    }
                }
            }
            GD.Print($"church-shell-dump: {root} {total} triangles");
            scene.QueueFree();
        }
    }
}

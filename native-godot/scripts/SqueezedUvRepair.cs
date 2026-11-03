using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>#225: the parish churches' rounded arrises and narrow faces drew their stone picture squeezed (the bake gave
/// a bevel's corners the uv of the two faces it joins: up to 170 times too many blocks across 1 to 3 cm, read in the sun
/// as gold streaks, as beside Sint-Carolus' left apse window). Each such triangle (its uv 3 times denser or thinner than
/// the surface's own picture scale either way) is mapped again flat at the surface's own scale: upright faces along
/// the level line of the face (as the walls run) and down the slope, flat ones over the plan; its corners get their own
/// copies so the faces beside keep theirs. Geometry, ids and placement unchanged.
/// Run squeezed-uv-repair.tscn -- --root node-00798 --prefix church_ --record &lt;dir outside the checkout&gt;.</summary>
public partial class SqueezedUvRepair : Node
{
    public override void _Ready()
    {
        try { Repair(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    static string Arg(string name)
    {
        var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--" + name);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : "";
    }

    /// <summary>The uv's two stretch factors across a triangle (uv units a metre, larger first).</summary>
    static (float Hi, float Lo, float Area) Stretch(Vector3 a, Vector3 b, Vector3 c, Vector2 ta, Vector2 tb, Vector2 tc)
    {
        Vector3 e1 = b - a, e2 = c - a; var n = e1.Cross(e2); float area = n.Length() / 2;
        if (area < 1e-9f) return (0, 0, 0);
        var x = e1.Normalized(); var y = n.Normalized().Cross(x);
        float x1 = e1.Length(), x2 = e2.Dot(x), y2 = e2.Dot(y);
        if (Math.Abs(x1 * y2) < 1e-12f) return (0, 0, 0);
        Vector2 d1 = tb - ta, d2 = tc - ta;
        // J * [x1 x2; 0 y2] = [d1 d2]
        float j00 = d1.X / x1, j10 = d1.Y / x1;
        float j01 = (d2.X - j00 * x2) / y2, j11 = (d2.Y - j10 * x2) / y2;
        double s1 = (double)j00 * j00 + (double)j01 * j01 + (double)j10 * j10 + (double)j11 * j11;
        double det = (double)j00 * j11 - (double)j01 * j10;
        double hi = Math.Sqrt((s1 + Math.Sqrt(Math.Max(0, s1 * s1 - 4 * det * det))) / 2);
        // det = hi * lo avoids cancellation on the very narrow bevel faces we inspect.
        return ((float)hi, hi > 0 ? (float)(Math.Abs(det) / hi) : 0, area);
    }

    void Repair()
    {
        string root = Arg("root"), prefix = Arg("prefix"), output = Arg("record");
        bool audit = OS.GetCmdlineUserArgs().Contains("--audit");
        string materialFilter = Arg("material");
        float? requestedScale = float.TryParse(Arg("scale"), NumberStyles.Float, CultureInfo.InvariantCulture, out float parsedScale) && parsedScale > 0 ? parsedScale : null;
        if (root == "" || output == "") throw new ArgumentException("--root and --record are required");
        Directory.CreateDirectory(output);
        var scene = ResourceLoader.Load<PackedScene>($"res://world/town/roots/{root}.scn").Instantiate<Node3D>(); AddChild(scene);
        var records = new List<object>();
        foreach (var node in scene.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
        {
            string name = node.Name.ToString();
            if (!name.StartsWith(prefix) || name.Contains("glass") || node.Mesh is not ArrayMesh source || source.ResourcePath == "") continue;
            var xf = node.GlobalTransform;
            var result = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) result.SetMeta(key, source.GetMeta(key));
            int fixedTris = 0;
            var surfaces = new List<string>();
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                var arrays = source.SurfaceGetArrays(s);
                var material = source.SurfaceGetMaterial(s);
                bool textured = material is ShaderMaterial sm && sm.GetShaderParameter("tex").Obj is Texture2D
                    && (materialFilter == "" || material.ResourceName == materialFilter);
                if (textured && source.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles && arrays[(int)Mesh.ArrayType.TexUV].VariantType != Variant.Type.Nil)
                {
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var w = v.Select(p => xf * p).ToArray();
                    var st = new (float Hi, float Lo, float Area)[ix.Length / 3];
                    for (int t = 0; t < st.Length; t++) st[t] = Stretch(w[ix[3 * t]], w[ix[3 * t + 1]], w[ix[3 * t + 2]], uv[ix[3 * t]], uv[ix[3 * t + 1]], uv[ix[3 * t + 2]]);
                    // the surface's own scale: the median of its large faces (over 0.2 m2)
                    var large = st.Where(q => q.Area > 0.2f && q.Lo > 0).Select(q => q.Lo).OrderBy(q => q).ToArray();
                    if (requestedScale != null || large.Length >= 10)
                    {
                        float scale = requestedScale ?? large[large.Length / 2];
                        var bad = Enumerable.Range(0, st.Length).Where(t => st[t].Area > 0 && (st[t].Hi > 3 * scale || st[t].Lo < scale / 3)).ToArray();
                        if (bad.Length > 0)
                        {
                            if (audit)
                            {
                                fixedTris += bad.Length;
                                surfaces.Add($"{s}: {bad.Length} of {st.Length} at {scale:0.000}");
                                if (bad.Length < 10)
                                    foreach (int t in bad) GD.Print($"UV triangle {name}/{s}/{t}: area={st[t].Area:E3} stretch={st[t].Hi:E3}/{st[t].Lo:E3}");
                                continue;
                            }
                            // new corners for the bad triangles: every array copied, the uv mapped again
                            int n0 = v.Length;
                            var copy = new List<int>();
                            var newUv = new List<Vector2>(uv);
                            foreach (int t in bad)
                            {
                                Vector3 a = w[ix[3 * t]], b = w[ix[3 * t + 1]], c = w[ix[3 * t + 2]];
                                var n = (c - a).Cross(b - a).Normalized();
                                Vector3 ud, vd;
                                if (Math.Abs(n.Y) < 0.7f) { ud = Vector3.Up.Cross(n).Normalized(); vd = (Vector3.Down - n * n.Dot(Vector3.Down)).Normalized(); }
                                else
                                {
                                    ud = (Vector3.Right - n * n.X).Normalized();
                                    vd = n.Cross(ud).Normalized();
                                    if (vd.Dot(Vector3.Back) < 0) vd = -vd;
                                }
                                var centre = (uv[ix[3 * t]] + uv[ix[3 * t + 1]] + uv[ix[3 * t + 2]]) / 3;
                                var pc = (a + b + c) / 3;
                                // Microscopic slivers cannot retain a large UV offset and a sub-micron chart
                                // in floats at once. A local chart keeps them finite and noncollapsed.
                                if (st[t].Area < 1e-6f) { centre = Vector2.Zero; pc = a; }
                                for (int k = 0; k < 3; k++)
                                {
                                    var p = w[ix[3 * t + k]] - pc;
                                    copy.Add(ix[3 * t + k]);
                                    newUv.Add(centre + new Vector2(p.Dot(ud), p.Dot(vd)) * scale);
                                    ix[3 * t + k] = n0 + copy.Count - 1;
                                }
                            }
                            for (int a = 0; a < (int)Mesh.ArrayType.Max; a++)
                            {
                                if (a == (int)Mesh.ArrayType.Index || arrays[a].VariantType == Variant.Type.Nil) continue;
                                if (a == (int)Mesh.ArrayType.TexUV) { arrays[a] = newUv.ToArray(); continue; }
                                arrays[a] = arrays[a].VariantType switch
                                {
                                    Variant.Type.PackedVector3Array => Extend(arrays[a].AsVector3Array(), copy, 1),
                                    Variant.Type.PackedVector2Array => Extend(arrays[a].AsVector2Array(), copy, 1),
                                    Variant.Type.PackedColorArray => Extend(arrays[a].AsColorArray(), copy, 1),
                                    Variant.Type.PackedFloat32Array => Extend(arrays[a].AsFloat32Array(), copy, arrays[a].AsFloat32Array().Length / v.Length),
                                    Variant.Type.PackedInt32Array => Extend(arrays[a].AsInt32Array(), copy, arrays[a].AsInt32Array().Length / v.Length),
                                    Variant.Type.PackedByteArray => Extend(arrays[a].AsByteArray(), copy, arrays[a].AsByteArray().Length / v.Length),
                                    _ => throw new InvalidDataException($"{name} surface {s}: array {a} of {arrays[a].VariantType}"),
                                };
                            }
                            arrays[(int)Mesh.ArrayType.Index] = ix;
                            fixedTris += bad.Length;
                            surfaces.Add($"{s}: {bad.Length} of {st.Length} at {scale:0.000}");
                        }
                    }
                }
                if (audit) continue;
                // Recompressing decoded positions shifts narrow arrises (up to 3 mm on the cathedral), and
                // half-precision UVs can collapse the newly repaired charts. Keep full precision here.
                var flags = (Mesh.ArrayFormat)((long)source.SurfaceGetFormat(s) & (((long)Mesh.ArrayFormat.FormatCustomMask << (int)Mesh.ArrayFormat.FormatCustom0Shift) | ((long)Mesh.ArrayFormat.FormatCustomMask << (int)Mesh.ArrayFormat.FormatCustom1Shift)));
                result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, flags);
                result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, source.SurfaceGetMaterial(s));
                if (result.SurfaceGetFormat(result.GetSurfaceCount() - 1) != (source.SurfaceGetFormat(s) & ~Mesh.ArrayFormat.FlagCompressAttributes)) throw new InvalidDataException($"{name} surface {s}: format {result.SurfaceGetFormat(result.GetSurfaceCount() - 1)} was {source.SurfaceGetFormat(s)}");
            }
            if (fixedTris == 0) continue;
            string path = source.ResourcePath, file = ProjectSettings.GlobalizePath(path);
            if (audit)
            {
                records.Add(new { node = name, mesh = path, triangles = fixedTris, surfaces });
                GD.Print($"Squeezed uv audit: {name} ({path}): {fixedTris} triangles ({string.Join("; ", surfaces)})");
                continue;
            }
            var bytes = File.ReadAllBytes(file);
            string backup = Path.Combine(output, Path.GetFileName(file));
            if (File.Exists(backup)) throw new IOException("Backup exists; use a fresh record directory");
            File.WriteAllBytes(backup, bytes);
            if (ResourceSaver.Save(result, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            records.Add(new { node = name, mesh = path, triangles = fixedTris, surfaces, before = Convert.ToHexString(SHA256.HashData(bytes)), after = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))) });
            GD.Print($"Squeezed uv: {name} ({path}): {fixedTris} triangles mapped again ({string.Join("; ", surfaces)})");
        }
        if (records.Count == 0 && !audit) throw new InvalidDataException("Nothing squeezed (repaired already?)");
        File.WriteAllText(Path.Combine(output, audit ? "squeezed-uv-audit.json" : "squeezed-uv.json"), JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true }));
    }

    static T[] Extend<T>(T[] source, List<int> copy, int stride)
    {
        var list = new List<T>(source);
        foreach (int i in copy) for (int k = 0; k < stride; k++) list.Add(source[i * stride + k]);
        return list.ToArray();
    }
}

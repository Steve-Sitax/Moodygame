using Godot;
using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Scheldemist.World;

// Offline check of the collision proxy on stored shapes: `-- --shapes res://a.res,res://b.res --out <folder>`.
// Writes each shape's original and proxy triangles (float32 x, y, z) for tools/collision/deviation.py, and the counts.
public partial class CollisionProxyProof : Node
{
    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); } catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    static string Arg(string name) { var a = OS.GetCmdlineUserArgs(); int i = Array.IndexOf(a, "--" + name); return i >= 0 && i + 1 < a.Length ? a[i + 1] : ""; }
    void Run()
    {
        string folder = Arg("out"); Directory.CreateDirectory(folder);
        var rows = new System.Collections.Generic.List<object>();
        foreach (string path in Arg("shapes").Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var loaded = ResourceLoader.Load(path);
            var faces = loaded is ConcavePolygonShape3D shape ? shape.Data : ((Mesh)loaded).GetFaces();
            var clock = System.Diagnostics.Stopwatch.StartNew();
            // (--error <metres>: another collapse error, its two guards scaled with it; the game uses the defaults)
            float error = float.TryParse(Arg("error"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float asked) ? asked : CollisionProxy.Error;
            var result = CollisionProxy.Simplify(faces, error, error * 2.5f, error * 2f);
            double ms = clock.Elapsed.TotalMilliseconds;
            string name = path.Replace("res://", "").Replace('/', '_').Replace(".res", "");
            if (!OS.GetCmdlineUserArgs().Contains("--no-dump"))
            {
                File.WriteAllBytes(Path.Combine(folder, name + ".original.f32"), MemoryMarshal.AsBytes(faces.AsSpan()).ToArray());
                File.WriteAllBytes(Path.Combine(folder, name + ".proxy.f32"), MemoryMarshal.AsBytes(result.Faces.AsSpan()).ToArray());
            }
            rows.Add(new { path, before = result.Before, after = result.After, collapsed = result.Collapsed, strayed = result.Dropped, restored = result.Restored, ms = Math.Round(ms) });
            GD.Print($"COLLISION_PROXY {path}: {result} in {ms:0} ms");
        }
        File.WriteAllText(Path.Combine(folder, "proxy-proof.json"), System.Text.Json.JsonSerializer.Serialize(rows, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }
}

using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

// Issue #84 partial: the checked-in plan contains only four bark materials and two bark textures. Run in Forward+ (not
// headless):
//   godot --rendering-method forward_plus --path . res://scripts/plan84-promote.tscn -- --plan <plan.json> --record <folder> --backup <folder>
// The plan lists the textures to build and, per material, its new colour and height texture, the scale its uv is
// multiplied by (the set's metres a tile against the mesh's own metres a uv unit), its bump scale and albedo. Every
// material must still be the one the plan was made from (its SHA-256); originals are copied to --backup first and never
// overwritten. Colour maps are stored BC7 (sRGB, mipmaps), height maps L8 with mipmaps (linear: the shaders' bump_map
// has no source_color hint). Only the materials' parameters change: same shader, so no new shader kind; meshes, nodes
// and permanent ids are untouched. Reproduction requires the original material hashes in a separate checkout;
// an already-promoted checkout is rejected. See world/notes/plan84-installation.md.
public partial class Plan84Promote : Node
{
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Plan 84 promotion stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run the promotion in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        string Opt(string name) { int i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException("--" + name); }
        string planPath = Opt("plan"), record = Opt("record"), backup = Opt("backup");
        Directory.CreateDirectory(record); Directory.CreateDirectory(backup);
        var plan = JsonDocument.Parse(File.ReadAllText(planPath)).RootElement;
        var mats = plan.GetProperty("materials").EnumerateArray().ToArray();
        foreach (var m in mats)
        {
            string p = m.GetProperty("material").GetString()!;
            if (Hash(p) != m.GetProperty("sourceHash").GetString()) throw new IOException("Changed since the plan was made: " + p);
            if (File.Exists(Path.Combine(backup, Path.GetFileName(p)))) throw new IOException("A backup exists already (an earlier promotion?): " + p);
        }
        // the textures: built from the pictures, stored once, shared by every material that uses them
        var built = new Dictionary<string, Texture2D>(); var texRecord = new Dictionary<string, object>();
        foreach (var t in plan.GetProperty("textures").EnumerateObject())
        {
            string png = t.Value.GetProperty("png").GetString()!, kind = t.Value.GetProperty("kind").GetString()!, outPath = t.Value.GetProperty("out").GetString()!;
            string src = Hash(png);
            if (t.Value.TryGetProperty("sha256", out var want) && want.GetString() != src) throw new IOException("Picture differs from the plan: " + png);
            var img = Image.LoadFromFile(ProjectSettings.GlobalizePath(png));
            int w = img.GetWidth(), h = img.GetHeight();
            if (kind == "height")
            {
                img.Convert(Image.Format.L8);
                img.GenerateMipmaps();
            }
            else
            {
                bool alpha = img.DetectAlpha() != Image.AlphaMode.None;
                img.Convert(alpha ? Image.Format.Rgba8 : Image.Format.Rgb8);
                img.GenerateMipmaps();
                if (img.Compress(Image.CompressMode.Bptc, Image.CompressSource.Srgb) != Error.Ok) throw new IOException("BC7 compression failed: " + png);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(ProjectSettings.GlobalizePath(outPath))!);
            var tex = ImageTexture.CreateFromImage(img);
            tex.ResourceName = Path.GetFileNameWithoutExtension(outPath);
            if (ResourceSaver.Save(tex, outPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(outPath);
            built[t.Name] = ResourceLoader.Load<Texture2D>(outPath, null, ResourceLoader.CacheMode.Replace);
            texRecord[outPath] = new { source = png, sourceHash = src, kind, width = w, height = h, format = img.GetFormat().ToString(), installedHash = Hash(outPath) };
        }
        var originals = new Dictionary<string, string>(); var installed = new Dictionary<string, string>(); var counts = new Dictionary<string, object>();
        foreach (var m in mats)
        {
            string p = m.GetProperty("material").GetString()!;
            bool compressed = File.ReadAllBytes(ProjectSettings.GlobalizePath(p)).Take(4).SequenceEqual("RSCC"u8.ToArray());
            var mat = ResourceLoader.Load<ShaderMaterial>(p, null, ResourceLoader.CacheMode.Replace);
            string? originalShader = mat.Shader?.Code;
            var before = new { tex = (mat.GetShaderParameter("tex").AsGodotObject() as Resource)?.ResourcePath, bump = (mat.GetShaderParameter("bump_map").AsGodotObject() as Resource)?.ResourcePath,
                uv = mat.GetShaderParameter("uv_xform").ToString(), bumpScale = mat.GetShaderParameter("bump_scale").ToString(), albedo = mat.GetShaderParameter("albedo").ToString() };
            mat.SetShaderParameter("tex", built[m.GetProperty("tex").GetString()!]);
            if (m.TryGetProperty("bump", out var b) && b.ValueKind == JsonValueKind.String) mat.SetShaderParameter("bump_map", built[b.GetString()!]);
            if (m.TryGetProperty("bump_scale", out var bs) && bs.ValueKind == JsonValueKind.Number) mat.SetShaderParameter("bump_scale", (float)bs.GetDouble());
            if (m.TryGetProperty("uv_scale", out var us) && us.ValueKind == JsonValueKind.Array)
            {
                var old = mat.GetShaderParameter("uv_xform").VariantType == Variant.Type.Vector4 ? mat.GetShaderParameter("uv_xform").AsVector4() : new Vector4(1, 1, 0, 0);
                mat.SetShaderParameter("uv_xform", new Vector4(old.X * (float)us[0].GetDouble(), old.Y * (float)us[1].GetDouble(), old.Z, old.W));
            }
            if (m.TryGetProperty("albedo", out var al) && al.ValueKind == JsonValueKind.Array)
                mat.SetShaderParameter("albedo", new Color((float)al[0].GetDouble(), (float)al[1].GetDouble(), (float)al[2].GetDouble(), (float)al[3].GetDouble()));
            originals[p] = Hash(p);
            File.Copy(ProjectSettings.GlobalizePath(p), Path.Combine(backup, Path.GetFileName(p)), false);
            if (ResourceSaver.Save(mat, p, compressed ? ResourceSaver.SaverFlags.Compress : ResourceSaver.SaverFlags.None) != Error.Ok) throw new IOException(p);
            installed[p] = Hash(p);
            var back = ResourceLoader.Load<ShaderMaterial>(p, null, ResourceLoader.CacheMode.Ignore);
            if ((back.GetShaderParameter("tex").AsGodotObject() as Resource)?.ResourcePath != built[m.GetProperty("tex").GetString()!].ResourcePath || back.Shader?.Code != originalShader)
                throw new IOException("Reload differs: " + p);
            counts[p] = new { name = m.GetProperty("name").GetString(), set = m.GetProperty("set").GetString(), before,
                after = new { tex = (back.GetShaderParameter("tex").AsGodotObject() as Resource)?.ResourcePath, bump = (back.GetShaderParameter("bump_map").AsGodotObject() as Resource)?.ResourcePath,
                    uv = back.GetShaderParameter("uv_xform").ToString(), bumpScale = back.GetShaderParameter("bump_scale").ToString(), albedo = back.GetShaderParameter("albedo").ToString() } };
        }
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), plan = planPath, backup, textures = texRecord, originalHashes = originals, installedHashes = installed, materials = counts },
            new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Plan 84 promoted: {built.Count} textures, {mats.Length} materials; originals in {backup}");
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Recovery;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

/// <summary>One-time intake of auxiliary maps and existing Godot game materials. Never run by gameplay.</summary>
public partial class NativeVisualRecovery : Node
{
    private string output = "res://game/rijnkaai";
    private readonly HashSet<ulong> saved = new();
    private int resourceCount;
    private void Save(Resource resource, string path)
    {
        resource.TakeOverPath(path);
        if (ResourceSaver.Save(resource, path, ResourceSaver.SaverFlags.Compress) != Error.Ok)
            throw new IOException("Cannot save " + path);
    }
    private void Textures(Material material)
    {
        foreach (var property in material.GetPropertyList())
        {
            if (property["type"].AsInt32() != (int)Variant.Type.Object) continue;
            if (material.Get(property["name"].AsStringName()).AsGodotObject() is not Resource texture || texture is not (Texture2D or TextureLayered) || texture.ResourcePath.StartsWith("res://") || !saved.Add(texture.GetInstanceId())) continue;
            Save(texture, output + "/resources/texture-" + resourceCount++.ToString("D3") + ".res");
        }
    }
    private static BaseMaterial3D Standard(Material material)
    {
        if (material is BaseMaterial3D standard) return (BaseMaterial3D)standard.Duplicate();
        var shader = (ShaderMaterial)material;
        var uv = shader.GetShaderParameter("uv_transform").AsVector4();
        var made = new StandardMaterial3D { ResourceName = material.ResourceName,
            AlbedoTexture = shader.GetShaderParameter("albedo_tex").As<Texture2D>(), AlbedoColor = shader.GetShaderParameter("albedo_color").AsColor(),
            Uv1Scale = new Vector3(uv.X, uv.Y, 1), Uv1Offset = new Vector3(uv.Z, uv.W, 0),
            VertexColorUseAsAlbedo = shader.GetShaderParameter("use_vertex_color").AsBool() };
        if (shader.GetShaderParameter("emission_color").VariantType != Variant.Type.Nil)
        { made.Emission = shader.GetShaderParameter("emission_color").AsColor(); made.EmissionEnabled = made.Emission != Colors.Black; }
        return made;
    }
    public override void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();
            if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("This intake needs the renderer to serialize texture arrays. Run it without --headless.");
            string source = Scheldemist.Native.Game.NativeArguments.Arg("source");
            if (source == "") throw new ArgumentException("--source must name the completed town GLB for this one-time intake.");
            output = Scheldemist.Native.Game.NativeArguments.Arg("visuals", output);
            if (!output.StartsWith("res://game/") || !LayoutDocument.ValidId(output["res://game/".Length..])) throw new ArgumentException("--visuals must be res://game/<id>.");
            string districtId = Scheldemist.Native.Game.NativeArguments.Arg("district", "rijnkaai-recovered");
            if (!LayoutDocument.ValidId(districtId)) throw new ArgumentException("Invalid district id.");
            var recoveryReport = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovered/" + districtId + "/recovery-report.json")))!;
            using (var fingerprintInput = File.OpenRead(source))
                if (Convert.ToHexString(SHA256.HashData(fingerprintInput)).ToLowerInvariant() != recoveryReport["source"]!["sha256"]!.GetValue<string>())
                    throw new InvalidDataException("The material input must match the district's recovered town snapshot.");
            string absolute = ProjectSettings.GlobalizePath(output);
            if (Directory.Exists(absolute)) throw new IOException("Keep existing native material edits; choose another output for a new intake.");
            Directory.CreateDirectory(Path.Combine(absolute, "resources"));
            Directory.CreateDirectory(Path.Combine(absolute, "maps"));
            using var reader = new BinaryReader(File.OpenRead(source));
            reader.BaseStream.Position = 12; int length = reader.ReadInt32(); reader.ReadUInt32();
            var gltf = JsonNode.Parse(reader.ReadBytes(length))!.AsObject();
            string textureDir = Path.Combine(Path.GetDirectoryName(source)!, "town_tex");
            var district = ResourceLoader.Load<AuthorDistrict>("res://recovered/" + districtId + "/district.tres");
            var facts = JsonNode.Parse(File.ReadAllText(Path.ChangeExtension(source, ".json")))!;
            facts["instances"] = new JsonObject();
            facts["facts"]!["lights"] = new JsonArray(facts["facts"]!["lights"]!.AsArray().Where(l => l!["type"]!.GetValue<string>() != "PointLight").Select(l => l!.DeepClone()).ToArray());
            facts["places"] = new JsonArray(new JsonObject { ["place"] = "native-" + districtId, ["pos"] = new JsonArray(district.WalkSpawn.X, district.WalkSpawn.Y + 1.62f, district.WalkSpawn.Z), ["quat"] = new JsonArray(0, 1, 0, 0) });
            File.WriteAllText(Path.Combine(absolute, "facts.json"), facts.ToJsonString());
            var lights = JsonNode.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(source)!, "town_lights.json")))!;
            bool Inside(JsonNode light) => district.Bounds.Grow(6).HasPoint(new Vector2(light["at"]![0]!.GetValue<float>(), light["at"]![2]!.GetValue<float>()));
            lights["spill"] = new JsonArray(lights["spill"]!.AsArray().Where(l => Inside(l!)).Select(l => l!.DeepClone()).ToArray());
            lights["panes"] = new JsonArray(); lights["rooms"] = new JsonArray();
            File.WriteAllText(Path.Combine(absolute, "lights.json"), lights.ToJsonString());
            foreach (string map in new[] { "skyshade", "dirt", "shore", "foul" })
                foreach (string ext in new[] { ".png", ".json" })
                    File.Copy(Path.Combine(textureDir, map + ext), Path.Combine(absolute, "maps", map + ext));
            var builder = new BakedWorld();
            var table = new JsonObject(); int fixedSamplers = 0;
            string backup = ProjectSettings.GlobalizePath("res://proof/wall-mapping/material-backup"); Directory.CreateDirectory(backup);
            string materialSource = Scheldemist.Native.Game.NativeArguments.Arg("material-source", "res://recovered/rijnkaai-20261012/resources");
            foreach (string file in Directory.GetFiles(ProjectSettings.GlobalizePath(materialSource), "*.res").Order())
            {
                if (ResourceLoader.Load(file) is not Material material || !material.HasMeta("legacy_material_index")) continue;
                int index = material.GetMeta("legacy_material_index").AsInt32();
                var original = gltf["materials"]![index]!;
                var bm = Standard(material);
                var wrap = RecoverySampler.Modes(gltf, original);
                if (material is BaseMaterial3D && bm.AlbedoTexture != null && (wrap.u != wrap.v || wrap.u == 33648))
                {
                    File.Copy(file, Path.Combine(backup, Path.GetFileName(file)), false);
                    var corrected = RecoverySampler.Create((BaseMaterial3D)material, wrap.u, wrap.v);
                    Save(corrected, material.ResourcePath); fixedSamplers++;
                }
                using var description = JsonDocument.Parse(original.ToJsonString());
                if (builder.RecoverMaterial(bm, description.RootElement, textureDir) is not ShaderMaterial gameMaterial) continue;
                PreserveClamp(gameMaterial, wrap.u, wrap.v);
                Textures(gameMaterial);
                string path = output + "/resources/material-" + index + ".res";
                Save(gameMaterial, path); table[index.ToString()] = path;
            }
            var waterKind = new Psx.Kind(false, false, false, false, true, false, 0, false, false, true, Water: 1);
            var water = BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = Color.Color8(138, 154, 146) }, waterKind, 0);
            using var waterOptions = JsonDocument.Parse("{\"water\":true}"); Psx.ApplyOptions(water, waterKind, waterOptions.RootElement, textureDir);
            Textures(water); Save(water, output + "/river.res");
            File.WriteAllText(Path.Combine(absolute, "materials.json"), table.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            File.WriteAllText(Path.Combine(absolute, "intake.json"), JsonSerializer.Serialize(new { source, district = districtId, sourceFingerprint = recoveryReport["source"], fixedSamplers, materials = table.Count, auxiliaryTextures = resourceCount, runtime = "native resources only" }, new JsonSerializerOptions { WriteIndented = true }));
            builder.Free();
            GD.Print($"Native game intake: {table.Count} game materials, {resourceCount} auxiliary textures, {fixedSamplers} repaired samplers.");
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }

    public static void PreserveClamp(ShaderMaterial material, int u, int v)
    {
        if (u != 33071 && v != 33071) return;
        string code = material.Shader.Code;
        string coordinates = "vec2 uv = UV;";
        if (u == 33071) coordinates += "\n\tuv.x = clamp(uv.x, 0.5 / float(textureSize(tex, 0).x), 1.0 - 0.5 / float(textureSize(tex, 0).x));";
        if (v == 33071) coordinates += "\n\tuv.y = clamp(uv.y, 0.5 / float(textureSize(tex, 0).y), 1.0 - 0.5 / float(textureSize(tex, 0).y));";
        material.Shader = new Shader { Code = code.Replace("vec2 uv = UV;", coordinates) };
    }
}

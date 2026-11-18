using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Game;

// Read-only inventory of installed scenery, props and character resources. Resolution is a
// review lead, not a defect verdict: small masks and procedural materials can be intentional.
public partial class VisualQualityAudit : Node
{
    private sealed record Picture(string Slot, string Path, int Width, int Height, int Layers);
    private sealed record Sample(string Node, string Mesh, float[] Bounds, int Vertices, bool Visible);
    private sealed class MaterialRow
    {
        public string Path { get; init; } = "";
        public string Name { get; init; } = "";
        public string Shader { get; init; } = "";
        public int Uses { get; set; }
        public List<Picture> Pictures { get; } = new();
        public Dictionary<string,string> Parameters { get; } = new();
        public List<Sample> Samples { get; } = new();
    }
    private readonly Dictionary<ulong, MaterialRow> materials = new();
    private readonly List<Sample> unassigned = new();
    private readonly HashSet<string> dependencies = new(StringComparer.Ordinal);
    private readonly HashSet<string> missing = new(StringComparer.Ordinal);
    private int meshes;

    public static async Task CaptureRuntime(Scheldemist.Native.World.NativeTownGame game, string output)
    {
        try
        {
            while (!game.Loaded || Scheldemist.Menu.Loading.Busy || !Scheldemist.Game.GameState.I.Live)
                await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
            for (int i = 0; i < 180; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
            Directory.CreateDirectory(output);
            var audit = new VisualQualityAudit();
            try
            {
                audit.Visit(game, Transform3D.Identity, "runtime", true);
                var modelRoots = new Dictionary<string,string[]>();
                foreach (string model in new[] { "stalls", "props", "benches", "clutter" })
                    if (Scheldemist.Models.ModelLibrary.Get(model) is { } loaded) modelRoots[model] = loaded.Roots.Keys.Order().ToArray();
                var benches = Scheldemist.Play.BenchPlaces.All.Select(b => new { b.Id, b.Model, x=b.At.Origin.X, y=b.At.Origin.Y, z=b.At.Origin.Z });
                File.WriteAllText(Path.Combine(output, "runtime-inventory.json"), JsonSerializer.Serialize(new { audit.meshes, materials=audit.materials.Values, audit.unassigned, modelRoots, benches }, new JsonSerializerOptions { WriteIndented = true }));
                GD.Print($"VISUAL_RUNTIME_AUDIT: {audit.meshes} meshes, {audit.materials.Count} materials");
            }
            finally { audit.Free(); }
        }
        catch (Exception e) { GD.PushError(e.ToString()); game.GetTree().Quit(1); }
    }

    public override void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();
            var args = OS.GetCmdlineUserArgs();
            int outputArg = Array.IndexOf(args, "--quality-output");
            string output = outputArg >= 0 ? args[outputArg + 1] : ProjectSettings.GlobalizePath("res://../.scratch/visual-quality");
            Directory.CreateDirectory(output);
            var roots = new List<string> { "res://world/town/scene.tscn" };
            const string models = "res://assets/game-models/";
            roots.AddRange(ResourceLoader.ListDirectory(models).Where(p => p.EndsWith(".scn", StringComparison.Ordinal) && !p.Contains("antigoon", StringComparison.OrdinalIgnoreCase)).Select(p => models + p));
            foreach (string path in roots)
            {
                AuditDependencies(path);
                var packed = ResourceLoader.Load<PackedScene>(path);
                if (packed == null) { missing.Add(path); continue; }
                var root = packed.Instantiate();
                Visit(root, Transform3D.Identity, path, true);
                root.Free();
            }
            var result = new { roots, meshes, dependencyCount = dependencies.Count, missing = missing.Order().ToArray(), materials = materials.Values.OrderBy(m => m.Path).ThenBy(m => m.Name), unassigned };
            File.WriteAllText(Path.Combine(output, "inventory.json"), JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"VISUAL_AUDIT: {roots.Count} roots, {meshes} meshes, {materials.Count} materials, {missing.Count} missing dependencies, {unassigned.Count} unassigned surfaces");
            GetTree().Quit();
        }
        catch (Exception e) { GD.PushError(e.ToString()); GetTree().Quit(1); }
    }

    private void AuditDependencies(string path)
    {
        if (!dependencies.Add(path)) return;
        if (!Godot.FileAccess.FileExists(path) && !ResourceLoader.Exists(path)) { missing.Add(path); return; }
        foreach (string raw in ResourceLoader.GetDependencies(path))
        {
            string child = raw.Split("::", StringSplitOptions.None)[^1];
            if (child.StartsWith("res://", StringComparison.Ordinal)) AuditDependencies(child);
        }
    }

    private void Visit(Node node, Transform3D parent, string path, bool visible)
    {
        path += "/" + node.Name;
        var frame = node is Node3D n ? n.IsInsideTree() ? n.GlobalTransform : parent * n.Transform : parent;
        visible &= node is not Node3D n3 || n3.Visible;
        if (node is MultiMeshInstance3D multimesh && multimesh.Multimesh is { } copies)
            visible &= copies.InstanceCount > 0 && copies.VisibleInstanceCount != 0;
        Mesh? mesh = node is MeshInstance3D mi ? mi.Mesh : node is MultiMeshInstance3D mm ? mm.Multimesh?.Mesh : null;
        if (mesh != null)
        {
            meshes++;
            var box = frame * mesh.GetAabb();
            for (int surface = 0; surface < mesh.GetSurfaceCount(); surface++)
            {
                Material? material = node is MeshInstance3D instance ? instance.GetActiveMaterial(surface) : ((GeometryInstance3D)node).MaterialOverride ?? mesh.SurfaceGetMaterial(surface);
                var sample = new Sample(path, mesh.ResourcePath, new[] { box.Position.X, box.Position.Y, box.Position.Z, box.Size.X, box.Size.Y, box.Size.Z }, mesh is ArrayMesh arrays ? arrays.SurfaceGetArrayLen(surface) : -1, visible);
                if (material == null) { unassigned.Add(sample); continue; }
                if (!materials.TryGetValue(material.GetInstanceId(), out var row))
                {
                    row = new MaterialRow { Path = material.ResourcePath, Name = material.ResourceName, Shader = material is ShaderMaterial sm ? sm.Shader?.ResourcePath ?? "" : material.GetClass() };
                    materials.Add(material.GetInstanceId(), row);
                    if (material is ShaderMaterial shader && shader.Shader != null)
                    {
                        foreach (var uniform in shader.Shader.GetShaderUniformList())
                        {
                            string name = uniform.AsGodotDictionary()["name"].AsString();
                            using var value = shader.GetShaderParameter(name);
                            if (value.VariantType == Variant.Type.Object)
                            {
                                if (value.AsGodotObject() is Texture2D texture) row.Pictures.Add(new Picture(name, texture.ResourcePath, texture.GetWidth(), texture.GetHeight(), 1));
                                else if (value.AsGodotObject() is TextureLayered layers) row.Pictures.Add(new Picture(name, layers.ResourcePath, layers.GetWidth(), layers.GetHeight(), layers.GetLayers()));
                            }
                            else if (value.VariantType != Variant.Type.Nil) row.Parameters[name] = value.ToString();
                        }
                    }
                    else if (material is BaseMaterial3D standard)
                    {
                        foreach (BaseMaterial3D.TextureParam slot in Enum.GetValues<BaseMaterial3D.TextureParam>())
                            if (slot != BaseMaterial3D.TextureParam.Max && standard.GetTexture(slot) is { } texture)
                                row.Pictures.Add(new Picture(slot.ToString(), texture.ResourcePath, texture.GetWidth(), texture.GetHeight(), 1));
                    }
                }
                row.Uses++;
                if (row.Samples.Count < 8) row.Samples.Add(sample);
            }
        }
        foreach (var child in node.GetChildren()) Visit(child, frame, path, visible);
    }
}

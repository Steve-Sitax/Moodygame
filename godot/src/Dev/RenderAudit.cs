using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Read-only inventory of real scene materials and lights. Run separately from the frame budget.</summary>
public sealed class RenderAudit
{
    private readonly HashSet<string> people2Kinds = new();
    private readonly HashSet<ulong> materials = new();
    private readonly HashSet<string> firstKinds = new();
    private readonly Dictionary<string, string> firstKindLocations = new();
    private readonly Dictionary<string, string> newKinds = new();
    private readonly List<object> made = new();
    private readonly List<object> lights = new();
    private readonly HashSet<string> problems = new();
    private Dictionary<string, int>? firstLights;
    private int firstPsx;
    private int samples;
    private int nativePreviewLights;
    private static string Hash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)))[..16];
    private static string Location(Node node) => node.IsInsideTree() ? node.GetPath().ToString() : "prepared-model/" + node.Name;
    private readonly Dictionary<ulong, (string Code, string Kind)> shaderKinds = new();
    private readonly HashSet<ulong> checkedShaders = new();
    private string Kind(Material m)
    {
        if (m is ShaderMaterial s)
        {
            if (s.Shader == null) return "shader:missing";
            ulong id = s.Shader.GetInstanceId();
            if (!checkedShaders.Add(id) && shaderKinds.TryGetValue(id, out var known)) return known.Kind;
            string code = s.Shader.Code;
            if (shaderKinds.TryGetValue(id, out var old) && old.Code == code) return old.Kind;
            string kind = "shader:" + Hash(code);
            if (s.Shader.ResourceName == "people2") people2Kinds.Add(kind);
            shaderKinds[id] = (code, kind);
            return kind;
        }
        if (m is BaseMaterial3D b)
        {
            // All feature toggles, flags and texture presence that select Godot's built-in shader variants.
            var switches = b.GetPropertyList().Select(p => p["name"].AsString())
                .Where(n => n.Contains("enabled") || n.EndsWith("_mode") || n.EndsWith("_texture") || n.StartsWith("flags/") || n is "vertex_color_use_as_albedo" or "vertex_color_is_srgb")
                .OrderBy(n => n).Select(n => n + "=" + (n.EndsWith("_texture") ? (b.Get(n).VariantType != Variant.Type.Nil).ToString() : b.Get(n).ToString()));
            return m.GetClass() + ":" + Hash(string.Join(";", switches));
        }
        return m.GetClass().ToString();
    }
    public void Sample(string label)
    {
        bool first = samples++ == 0;
        checkedShaders.Clear();
        var sampleKinds = new Dictionary<ulong, string>();
        var counts = new Dictionary<string, int>();
        // Native model prototypes are already loaded/shared even when their chalk or other prop is not drawn yet.
        var nodes = BakedWorld.All(Main.I).Concat(Models.ModelLibrary.PreparedScenes.SelectMany(BakedWorld.All));
        foreach (var n in nodes)
        {
            if (n is Light3D light)
            {
                if (light.HasMeta("native_preview_only")) { if (first) nativePreviewLights++; continue; }
                string key = light.GetClass().ToString();
                counts[key] = counts.GetValueOrDefault(key) + 1;
                if (!light.IsVisibleInTree()) problems.Add("light hidden: " + light.GetPath());
            }
            void See(Material? m)
            {
                if (m == null) return;
                ulong id = m.GetInstanceId();
                if (!sampleKinds.TryGetValue(id, out var k)) sampleKinds[id] = k = Kind(m);
                if (first) { firstKinds.Add(k); firstKindLocations.TryAdd(k, Location(n)); }
                else if (!firstKinds.Contains(k)) { newKinds[k] = Location(n); problems.Add("new material/shader kind after first frame: " + k); }
                if (!materials.Add(m.GetInstanceId()) || first) return;
                made.Add(new { sample = label, path = Location(n), id = m.GetInstanceId(), name = m.ResourceName, kind = k });
            }
            if (n is GeometryInstance3D g) { See(g.MaterialOverride); See(g.MaterialOverlay); }
            Mesh? mesh = n is MeshInstance3D mi ? mi.Mesh : n is MultiMeshInstance3D mm ? mm.Multimesh?.Mesh : null;
            if (mesh != null) for (int i = 0; i < mesh.GetSurfaceCount(); i++) See(n is MeshInstance3D instance ? instance.GetActiveMaterial(i) : mesh.SurfaceGetMaterial(i));
            if (n is GpuParticles3D particles)
            {
                See(particles.ProcessMaterial as Material);
                for (int i = 0; i < particles.DrawPasses; i++)
                    if (particles.GetDrawPassMesh(i) is { } pm) for (int j = 0; j < pm.GetSurfaceCount(); j++) See(pm.SurfaceGetMaterial(j));
            }
            if (n is CanvasItem c) See(c.Material);
        }
        if (first) { firstLights = counts; firstPsx = Render.Psx.ShaderCount; }
        // The native cache is also prepared before frame one; keep its count stable as well as the code inventory.
        else if (Render.Psx.ShaderCount != firstPsx) problems.Add($"psx shader kinds changed from {firstPsx} to {Render.Psx.ShaderCount}");
        if (!first && (counts.Count != firstLights!.Count || counts.Any(p => firstLights.GetValueOrDefault(p.Key) != p.Value))) problems.Add("light counts changed at " + label);
        // Keep all changes, and the named route snapshots; avoid a huge copy per frame.
        if (first || !label.StartsWith("frame") || counts.Any(p => firstLights!.GetValueOrDefault(p.Key) != p.Value)) lights.Add(new { at = label, counts });
    }
    public object Report() => new { people2ShaderKinds = people2Kinds.Order().ToArray(), people2ShaderKindCount = people2Kinds.Count, nativePreviewLights, generatedCacheEntries = Render.Psx.ShaderCount, firstGeneratedCacheEntries = firstPsx, ok = problems.Count == 0, programs = Render.Psx.ShaderCount, firstPrograms = firstPsx, materials = materials.Count, firstKinds = firstKinds.Order().ToArray(), firstKindLocations, madeAfterFirstFrame = made, newKinds, lightSettings = lights, samples, problems = problems.Order().ToArray(),
        notCovered = new[] { "GPU driver compilation timing and transient resources made and freed between scene samples", "unvisited game actions that make new materials" } };
}

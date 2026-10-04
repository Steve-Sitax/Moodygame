using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The town as the browser game builds it, baked by tools/godot/export-scene.mjs (docs/godot-port.md): one glb with
/// every node of the scene, what three knows and glTF does not in the extras (hidden nodes, the material's kind, the
/// psx options), the copies of every InstancedMesh and the day's facts in a json beside it. Loaded at run time: the
/// nodes keep their names, so the game's parts find theirs as the browser's do.
/// </summary>
public partial class BakedWorld : Node3D
{
    public JsonDocument Facts { get; private set; } = null!;
    public Dictionary<string, object> Report { get; } = new();
    /// <summary>Meshes with a shader of the browser's own (sky, glows, fire): hidden until their part is ported.</summary>
    public List<string> Unported { get; } = new();
    /// <summary>How far Load is, for the loading screen (Load may run beside the main thread): "read", "parse", "build", "materials", "done"; and how many of the scene's nodes have their materials.</summary>
    public volatile string Stage = "";
    public volatile int StageDone, StageTotal;

    private JsonElement gltf;
    private string glb = "";
    private string texDir = "";
    private readonly Dictionary<string, Texture2D> psxTextures = new();
    private ShaderMaterial? invisible;

    public Error Load(string glbPath)
    {
        ulong t0 = Time.GetTicksMsec();
        Facts = JsonDocument.Parse(File.ReadAllText(Paths.TownFacts(glbPath)));
        texDir = Paths.TownTextures(glbPath);
        Stage = "read";
        gltf = ReadJsonChunk(glbPath);
        glb = glbPath;
        Psx.LoadShared(texDir); // the sky map and the dirt map every psx material reads
        Stage = "parse";

        var doc = new GltfDocument();
        var state = new GltfState();
        var err = doc.AppendFromFile(glbPath, state);
        if (err != Error.Ok) return err;
        Stage = "build";
        var scene = doc.GenerateScene(state);
        if (scene == null) return Error.ParseError;
        scene.Name = "town";
        AddChild(scene);
        Report["glbMs"] = (double)(Time.GetTicksMsec() - t0);
        Stage = "materials";

        // hidden nodes: Godot keeps a glTF node's extras as the node's "extras" meta
        int hidden = 0;
        foreach (var n in All(scene))
        {
            if (n is not Node3D n3 || !n.HasMeta("extras")) continue;
            var ex = n.GetMeta("extras").AsGodotDictionary();
            if (ex.TryGetValue("hidden", out var h) && h.AsBool())
            {
                n3.Visible = false;
                hidden++;
            }
        }
        Report["hiddenInFile"] = CountHidden(gltf);

        // the materials, by the glTF material's index
        var imported = state.GetMaterials();
        var jsonMats = gltf.GetProperty("materials");
        var made = new Dictionary<Material, Material?>();
        for (int i = 0; i < imported.Count && i < jsonMats.GetArrayLength(); i++)
            if (imported[i] is BaseMaterial3D bm)
                made[bm] = Convert(bm, jsonMats[i], false);

        var instances = Facts.RootElement.GetProperty("instances");
        int meshes = 0, lights = 0, copies = 0, multi = 0;
        var nodes = All(scene).ToList();
        StageTotal = nodes.Count;
        foreach (var n in nodes)
        {
            StageDone++;
            if (n is Light3D l)
            {
                // the game's own lights come with their parts (the sun, the lamps, the lanterns)
                lights++;
                l.QueueFree();
                continue;
            }
            if (n is Camera3D cam)
            {
                cam.QueueFree();
                continue;
            }
            if (n is not MeshInstance3D mi || mi.Mesh == null) continue;
            meshes++;
            string name = mi.Name.ToString();
            bool inst = name.StartsWith("INST") && instances.TryGetProperty(name, out _);
            bool colours = inst && instances.GetProperty(name).TryGetProperty("c", out _);
            bool unported = false;
            bool allInvisible = mi.Mesh.GetSurfaceCount() > 0;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var m = mi.Mesh.SurfaceGetMaterial(s);
                // (no material in the file: three's exporter leaves a ShaderMaterial out altogether, e.g. the houses' grime
                // decals, and Godot gives the face a plain material of its own: a white face lit by the sun only)
                if (m == null || (m is BaseMaterial3D && !made.ContainsKey(m)))
                {
                    unported = true;
                    continue;
                }
                if (!made.TryGetValue(m, out var psx)) continue;
                if (psx == null)
                {
                    unported = true;
                    continue;
                }
                if (colours && psx is ShaderMaterial sm) psx = WithVertexColour(sm);
                if (!psx.HasMeta("baked_invisible")) allInvisible = false;
                mi.Mesh.SurfaceSetMaterial(s, psx);
            }
            if (unported)
            {
                mi.Visible = false;
                // (three's nameless meshes read as Mesh123: the list names them by their parent too)
                Unported.Add(name.StartsWith("Mesh") && name.Length > 4 && char.IsDigit(name[4]) ? $"{mi.GetParent()?.Name}/{name}" : name);
            }
            if (allInvisible) mi.Visible = false;
            if (!inst) continue;
            var e = instances.GetProperty(name);
            int count = e.GetProperty("count").GetInt32();
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = colours, Mesh = mi.Mesh, InstanceCount = count };
            var v = new float[16];
            int k = 0, c = 0;
            foreach (var x in e.GetProperty("m").EnumerateArray())
            {
                v[k++] = x.GetSingle();
                if (k < 16) continue;
                k = 0;
                mm.SetInstanceTransform(c++, new Transform3D(new Basis(new Vector3(v[0], v[1], v[2]), new Vector3(v[4], v[5], v[6]), new Vector3(v[8], v[9], v[10])), new Vector3(v[12], v[13], v[14])));
            }
            if (colours)
            {
                var col = e.GetProperty("c");
                for (int i = 0; i < count; i++)
                    mm.SetInstanceColor(i, new Color(col[i * 3].GetSingle(), col[i * 3 + 1].GetSingle(), col[i * 3 + 2].GetSingle()));
            }
            var mmi = new MultiMeshInstance3D { Multimesh = mm, Transform = mi.Transform, Name = name + "_mm", Visible = mi.Visible };
            mi.GetParent().AddChild(mmi);
            mi.QueueFree();
            copies += count;
            multi++;
        }
        Report["meshes"] = meshes;
        Report["materials"] = made.Count;
        Report["shaders"] = Psx.ShaderCount;
        Report["hidden"] = hidden;
        Report["lightsRemoved"] = lights;
        Report["multiMeshes"] = multi;
        Report["copies"] = copies;
        Report["unported"] = Unported.Count;
        Report["readyMs"] = (double)(Time.GetTicksMsec() - t0);
        Stage = "done";
        return Error.Ok;
    }

    private readonly Dictionary<ShaderMaterial, ShaderMaterial> coloured = new();

    /// <summary>The same material with the copies' own colours (an InstancedMesh with instanceColor).</summary>
    private ShaderMaterial WithVertexColour(ShaderMaterial m)
    {
        if (coloured.TryGetValue(m, out var c)) return c;
        c = (ShaderMaterial)m.Duplicate();
        var kind = (Psx.Kind)kinds[m] with { VertexColor = true };
        c.Shader = Psx.ShaderOf(kind);
        kinds[c] = kind;
        coloured[m] = c;
        return c;
    }

    private readonly Dictionary<ShaderMaterial, Psx.Kind> kinds = new();

    /// <summary>A glTF material as the psx material the browser game drew it with; null: a shader of the browser's own.</summary>
    private Material? Convert(BaseMaterial3D bm, JsonElement j, bool vertexColour)
    {
        JsonElement three = default, psx = default, bake = default;
        bool hasThree = j.TryGetProperty("extras", out var ex) && ex.TryGetProperty("three", out three);
        bool hasPsx = hasThree && ex.TryGetProperty("psx", out psx) && psx.TryGetProperty("bake", out bake) && bake.ValueKind == JsonValueKind.Object;
        string name = j.TryGetProperty("name", out var mn) ? mn.GetString() ?? "" : bm.ResourceName;
        // Earlier bakes omitted Material.visible. These are the browser's explicitly hidden stand-in panes;
        // its real room glass and additive landmark_window_light copies must still be drawn.
        bool oldPane = name is "cath_atlas_lit" or "church_atlas_lit" or "sh_glass_lit" or "vh_glass_lit" or "steen_glass_lit" or "landmark_glass_lit";
        if (hasThree && three.TryGetProperty("visible", out var visible) ? visible.ValueKind == JsonValueKind.False : oldPane)
        {
            invisible ??= new ShaderMaterial { Shader = new Shader { Code = "shader_type spatial; render_mode unshaded, depth_draw_never; void fragment() { discard; }" }, ResourceName = "baked_invisible" };
            invisible.SetMeta("baked_invisible", true);
            return invisible;
        }
        string type = hasThree ? three.GetProperty("type").GetString() ?? "" : "";
        // (a landmark's window light copied into its room left the exporter without its three extras: it is the same
        // additive, unfogged light as the shell's own, landmarkWindows.ts matFor)
        if (!hasThree && name == "landmark_window_light")
        {
            var lk = new Psx.Kind(Unlit: true, Blend: true, Scissor: false, TwoSided: false, DepthWrite: false, Snap: hasPsx, Atlas: 0, VertexColor: true, Add: true, Fog: false);
            var lm = PsxMaterial(bm, lk, 0, 1, 0, 1);
            lm.SetShaderParameter("albedo", new Color(0, 0, 0, 1));
            kinds[lm] = lk;
            return lm;
        }
        // (three's exporter writes a ShaderMaterial as a bare default material, without the extras)
        if (!hasThree || type is "ShaderMaterial" or "RawShaderMaterial") return null;

        bool Flag(string k, bool d) => hasThree && three.TryGetProperty(k, out var v) ? v.ValueKind == JsonValueKind.True : d;
        double Num(JsonElement e, string k, double d) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : d;

        bool transparent = Flag("transparent", bm.Transparency == BaseMaterial3D.TransparencyEnum.Alpha);
        double alphaTest = Num(three, "alphaTest", 0);
        var kind = new Psx.Kind(
            Unlit: type is "MeshBasicMaterial" or "LineBasicMaterial" or "PointsMaterial",
            Blend: transparent,
            Scissor: alphaTest > 0,
            TwoSided: (int)Num(three, "side", bm.CullMode == BaseMaterial3D.CullModeEnum.Disabled ? 2 : 0) == 2,
            DepthWrite: Flag("depthWrite", true),
            Snap: hasPsx && !(bake.TryGetProperty("noSnap", out var ns) && ns.ValueKind == JsonValueKind.True),
            Atlas: hasPsx ? (int)Num(bake, "atlas", 0) : 0,
            VertexColor: vertexColour || Flag("vertexColors", false),
            Add: transparent && (int)Num(three, "blending", 1) == 2,
            Fog: Flag("fog", true));
        // the psx options the browser made it with (relief, wet, puddles, patches, the foot of the walls ...)
        if (hasPsx) kind = Psx.WithOptions(kind, bake);
        var m = PsxMaterial(bm, kind, hasPsx ? Num(bake, "affine", 1) : 0, hasPsx ? Num(bake, "fogReach", 1) : 1, alphaTest, transparent ? (float)Num(three, "opacity", bm.AlbedoColor.A) : null);
        if (hasPsx) Psx.ApplyOptions(m, kind, bake, texDir);
        kinds[m] = kind;
        return m;
    }

    /// <summary>The psx material of a glTF material with these switches: the baked town's, and the models a part loads itself (Models/ModelLibrary.cs).</summary>
    public static ShaderMaterial PsxMaterial(BaseMaterial3D bm, Psx.Kind kind, double affine = 1, double fogReach = 1, double alphaTest = 0, float? opacity = null)
    {
        if (bm.ResourceName == "cap") return Psx.Cap(); // (a hull's water cap: draws nothing, keeps the water out of the boat)
        var m = new ShaderMaterial { Shader = Psx.ShaderOf(kind), ResourceName = bm.ResourceName };
        var albedo = bm.AlbedoColor;
        if (opacity != null) albedo.A = opacity.Value;
        m.SetShaderParameter("albedo", albedo);
        if (bm.AlbedoTexture != null) m.SetShaderParameter("tex", bm.AlbedoTexture);
        if (bm.EmissionEnabled)
        {
            m.SetShaderParameter("emission", new Vector3(bm.Emission.R, bm.Emission.G, bm.Emission.B) * bm.EmissionEnergyMultiplier);
            if (bm.EmissionTexture != null) m.SetShaderParameter("emission_tex", bm.EmissionTexture);
        }
        m.SetShaderParameter("affine", affine);
        m.SetShaderParameter("fog_reach", fogReach);
        if (alphaTest > 0) m.SetShaderParameter("alpha_cut", alphaTest);
        m.SetShaderParameter("uv_xform", new Vector4(bm.Uv1Scale.X, bm.Uv1Scale.Y, bm.Uv1Offset.X, bm.Uv1Offset.Y));
        m.RenderPriority = bm.RenderPriority;
        return m;
    }

    /// <summary>
    /// A vertex attribute of a baked mesh as floats, straight from the glb (Godot's importer drops the browser's own
    /// attributes: _ASEED, _AAGE ...): the node's first primitive, `attr` as named in the file ("POSITION", "_ASEED").
    /// `nth`: which of the nodes of that name. Null when there is none. For a part's load, not a frame.
    /// </summary>
    public float[]? Attribute(string node, string attr, int nth = 0)
    {
        if (glb == "") return null;
        var nodes = gltf.GetProperty("nodes");
        int seen = 0;
        foreach (var nd in nodes.EnumerateArray())
        {
            if (!nd.TryGetProperty("name", out var nm) || nm.GetString() != node || !nd.TryGetProperty("mesh", out var mi)) continue;
            if (seen++ < nth) continue;
            var prim = gltf.GetProperty("meshes")[mi.GetInt32()].GetProperty("primitives")[0];
            if (!prim.GetProperty("attributes").TryGetProperty(attr, out var ai)) return null;
            var acc = gltf.GetProperty("accessors")[ai.GetInt32()];
            if (acc.GetProperty("componentType").GetInt32() != 5126) return null; // (floats only)
            int comps = acc.GetProperty("type").GetString() switch { "SCALAR" => 1, "VEC2" => 2, "VEC3" => 3, "VEC4" => 4, _ => 0 };
            int count = acc.GetProperty("count").GetInt32();
            var bv = gltf.GetProperty("bufferViews")[acc.GetProperty("bufferView").GetInt32()];
            long off = (bv.TryGetProperty("byteOffset", out var bo) ? bo.GetInt64() : 0) + (acc.TryGetProperty("byteOffset", out var ao) ? ao.GetInt64() : 0);
            int stride = bv.TryGetProperty("byteStride", out var bs) ? bs.GetInt32() : comps * 4;
            using var f = File.OpenRead(glb);
            var head = new byte[20];
            f.ReadExactly(head);
            long bin = 20 + BitConverter.ToInt32(head, 12) + 8; // (the json chunk, then the bin chunk's own header)
            var raw = new byte[(long)stride * (count - 1) + comps * 4];
            f.Seek(bin + off, SeekOrigin.Begin);
            f.ReadExactly(raw);
            var outv = new float[count * comps];
            for (int i = 0; i < count; i++)
                for (int c = 0; c < comps; c++) outv[i * comps + c] = BitConverter.ToSingle(raw, i * stride + c * 4);
            return outv;
        }
        return null;
    }

    private static int CountHidden(JsonElement gltf)
    {
        int n = 0;
        foreach (var node in gltf.GetProperty("nodes").EnumerateArray())
            if (node.TryGetProperty("extras", out var ex) && ex.TryGetProperty("hidden", out var h) && h.ValueKind == JsonValueKind.True) n++;
        return n;
    }

    private static JsonElement ReadJsonChunk(string glb)
    {
        using var f = File.OpenRead(glb);
        var head = new byte[20];
        f.ReadExactly(head);
        int n = BitConverter.ToInt32(head, 12);
        var buf = new byte[n];
        f.ReadExactly(buf);
        return JsonDocument.Parse(Encoding.UTF8.GetString(buf)).RootElement;
    }

    public static IEnumerable<Node> All(Node n)
    {
        yield return n;
        foreach (var c in n.GetChildren())
            foreach (var d in All(c))
                yield return d;
    }
}

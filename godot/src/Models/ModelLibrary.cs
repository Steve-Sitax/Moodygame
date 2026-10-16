using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Models;

/// <summary>
/// Native model PackedScenes are loaded once, then copied with shared meshes, materials, skins and clips.
/// Material policies retain each original model loader's transparency, colour and lighting behavior.
/// NativeScene is configured before game parts start; a configured native loader never falls back to GLB.
/// </summary>
public static class ModelLibrary
{
    /// <summary>How a model's loader in the browser makes its materials: the psx options and three's switches.</summary>
    public record Look(bool TwoSided = false, bool? Unlit = null, double Affine = 1, double FogReach = 1, bool Snap = true, bool VertexColor = false);

    public sealed class Model
    {
        public string Name = "";
        /// <summary>The file's scene, kept out of the tree: the source of every copy.</summary>
        public Node3D Scene = null!;
        /// <summary>The file's clips by name, as Godot read them (tracks by the file's own node paths).</summary>
        public Dictionary<string, Animation> Clips = new();
        /// <summary>The top nodes by name ("baker", "crate_seat" ...).</summary>
        public Dictionary<string, Node3D> Roots = new();
        public int Materials;
        public double LoadMs;

        /// <summary>A copy of a top node: its own nodes (and skeleton), the file's meshes, skins and materials shared.</summary>
        public Node3D? Copy(string root)
        {
            if (!Roots.TryGetValue(root, out var src)) return null;
            return (Node3D)src.Duplicate((int)(Node.DuplicateFlags.Groups | Node.DuplicateFlags.Scripts | Node.DuplicateFlags.Signals));
        }
    }

    private static readonly Dictionary<string, Model?> Loaded = new();
    /// <summary>Prepared shared prototypes, including materials not yet copied into the live town.</summary>
    public static IEnumerable<Node3D> PreparedScenes
    {
        get { foreach (var model in Loaded.Values) if (model != null) yield return model.Scene; }
    }
    /// <summary>Native projects supply their stored PackedScenes. A configured loader never falls back to GLB.</summary>
    public static Func<string, Node3D?>? NativeScene { get; set; }
    public static bool Available(string name) => NativeScene != null ? Godot.ResourceLoader.Exists("res://assets/game-models/" + name + ".scn") : File.Exists(Path.Combine(Dir, name + ".glb"));

    public static string Dir
    {
        get
        {
            return Paths.Models;
        }
    }

    /// <summary>The model file `name` (no ".glb"), read at the first ask; null (said once) when it is not there.</summary>
    public static Model? Get(string name, Look? look = null)
    {
        if (Loaded.TryGetValue(name, out var had)) return had;
        ulong t0 = Time.GetTicksUsec();
        string path = Path.Combine(Dir, name + ".glb");
        Model? m = null;
        if (NativeScene == null && !File.Exists(path)) GD.PrintErr($"model {name}: {path} is not there. Write the models: node tools/godot/models.mjs");
        else
        {
            var doc = new GltfDocument();
            var state = new GltfState();
            var err = NativeScene != null ? Error.Ok : doc.AppendFromFile(path, state);
            var scene = NativeScene != null ? NativeScene(name) : err == Error.Ok ? doc.GenerateScene(state) as Node3D : null;
            if (scene == null) GD.PrintErr($"model {name}: did not load ({err})");
            else
            {
                m = new Model { Name = name, Scene = scene };
                // the boat contract's hidden children (docs/boats.md): the walkable deck, the solid boxes and the far
                // copy are data, never drawn with the model
                foreach (var n in BakedWorld.All(scene))
                    if (n is Node3D a && IsAside(a.Name.ToString())) a.Visible = false;
                Convert(m, look ?? new Look());
                HideHelpers(scene);
                foreach (var c in scene.GetChildren())
                {
                    if (c is AnimationPlayer ap)
                    {
                        foreach (var lib in ap.GetAnimationLibraryList())
                            foreach (var an in ap.GetAnimationLibrary(lib).GetAnimationList())
                                m.Clips[an] = ap.GetAnimationLibrary(lib).GetAnimation(an);
                    }
                    else if (c is Node3D n) m.Roots[n.Name] = n;
                }
                m.LoadMs = (Time.GetTicksUsec() - t0) / 1000.0;
            }
        }
        Loaded[name] = m;
        return m;
    }

    /// <summary>A boat model's hidden child: "&lt;kind&gt;_walk", "_block" or "_far" (docs/boats.md).</summary>
    public static bool IsAside(string name) => name.EndsWith("_walk") || name.EndsWith("_block") || name.EndsWith("_far");

    /// <summary>Every material of the file once, as a psx material (BakedWorld.PsxMaterial), set on the shared meshes.</summary>
    /// <summary>
    /// docs/boats.md: a hull's helper children (the walk floor "_walk", the blocks "_block", the far copy "_far") are
    /// read by their users, never drawn with the hull (the browser takes them out of its models the same way).
    /// </summary>
    private static void HideHelpers(Node n)
    {
        foreach (var c in n.GetChildren())
        {
            if (c is Node3D d)
            {
                string s = d.Name.ToString();
                if (s.EndsWith("_walk", StringComparison.Ordinal) || s.EndsWith("_block", StringComparison.Ordinal) || s.EndsWith("_far", StringComparison.Ordinal)) d.Visible = false;
            }
            HideHelpers(c);
        }
    }

    private static void Convert(Model m, Look look)
    {
        var made = new Dictionary<Material, Material>();
        var atlased = new Dictionary<Material, Material>();
        var turned = new HashSet<Mesh>();
        foreach (var n in BakedWorld.All(m.Scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null) continue;
            if (turned.Add(mi.Mesh)) TurnCellRows(mi.Mesh);
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var old = mi.Mesh.SurfaceGetMaterial(s);
                if (old is ShaderMaterial shader)
                {
                    if (ModelMaterialPolicy(m.Name, shader.ResourceName, Psx.KindOf(shader.Shader) ?? new Psx.Kind(), look) is not { } policy) continue;
                    if (!made.TryGetValue(old, out var converted))
                    {
                        var copy=(ShaderMaterial)shader.Duplicate(); copy.Shader=Psx.ShaderOf(policy);
                        copy.SetShaderParameter("affine",0.0);copy.SetShaderParameter("fog_reach",shader.ResourceName=="tr_glow"?1.3:1.0);
                        if(policy.Scissor)copy.SetShaderParameter("alpha_cut",.3);
                        made[old]=converted=copy;
                    }
                    mi.Mesh.SurfaceSetMaterial(s,converted);continue;
                }
                if (old is not BaseMaterial3D bm) continue;
                // an atlas mesh (the goods atlas "goods", the draught team's "goods_team") is read as the town bake reads it:
                // Atlas 4, cell = UV2, uv = (cell + fract(uv)) / 4 (build_props.py, ATLAS_N). The same material could sit on
                // a mesh with and without a cell set, so the two are kept apart.
                bool cells = IsAtlasSurface(mi.Mesh, s);
                var atlasKey = cells ? atlased : made;
                if (!atlasKey.TryGetValue(old, out var psx))
                {
                    bool blend = bm.Transparency is BaseMaterial3D.TransparencyEnum.Alpha or BaseMaterial3D.TransparencyEnum.AlphaDepthPrePass;
                    bool scissor = bm.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor;
                    var kind = new Psx.Kind(
                        Unlit: look.Unlit ?? bm.ShadingMode == BaseMaterial3D.ShadingModeEnum.Unshaded,
                        Blend: blend,
                        Scissor: scissor,
                        TwoSided: look.TwoSided || bm.CullMode == BaseMaterial3D.CullModeEnum.Disabled,
                        DepthWrite: true,
                        Snap: look.Snap,
                        Atlas: cells ? AtlasCells : 0,
                        VertexColor: look.VertexColor,
                        Add: false,
                        Fog: true);
                    var policy=ModelMaterialPolicy(m.Name,bm.ResourceName,kind,look);
                    if(policy!=null)kind=policy.Value;
                    // the relief the browser gives every textured surface (issue 78): a bump from its own picture, as the
                    // baked town's materials have theirs. Not for what is lit by nothing, a body the skeleton bends (the
                    // browser's rule), or a decal or pane seen through (bumps.ts autoBump)
                    float bumpScale = 0;
                    Texture2D? height = null;
                    var drawn = ModelBump.Authored(m.Name, bm.ResourceName);
                    if (!Psx.BumpOff && !kind.Unlit && !kind.Blend && mi.Skin == null && bm.AlbedoTexture is { } picture && bm.NormalTexture == null
                        && ModelBump.StrengthOf(bm.ResourceName, picture.ResourceName != "" ? picture.ResourceName : picture.ResourcePath, mi.Name.ToString() + " " + mi.GetParent()?.Name) is var rule
                        && (rule > 0 ? rule : drawn != null && !ModelBump.IsSmooth(bm.ResourceName) ? 0.8f : 0f) is var strength and > 0
                        && (drawn ?? ModelBump.HeightOf(picture)) is { } map)
                    {
                        bumpScale = strength;
                        height = map;
                        kind = kind with { Bump = true };
                    }
                    psx = BakedWorld.PsxMaterial(bm, kind, look.Affine, look.FogReach, scissor ? bm.AlphaScissorThreshold : 0);
                    if (height != null && psx is ShaderMaterial relief) { relief.SetShaderParameter("bump_map", height); relief.SetShaderParameter("bump_scale", bumpScale); }
                    if(policy!=null && psx is ShaderMaterial adapted){adapted.SetShaderParameter("affine",0.0);adapted.SetShaderParameter("fog_reach",bm.ResourceName=="tr_glow"?1.3:1.0);if(policy.Value.Scissor)adapted.SetShaderParameter("alpha_cut",.3);}
                    atlasKey[old] = psx;
                }
                mi.Mesh.SurfaceSetMaterial(s, psx);
            }
        }
        m.Materials = made.Count + atlased.Count;
    }

    /// <summary>The goods and team atlases are 4 x 4 cells of 64 px (build_props.py ATLAS_N): the town bake's Atlas value.</summary>
    public const int AtlasCells = 4;

    /// <summary>A surface that draws on the goods atlas ("goods") or the draught team's ("goods_team") and names its cell in UV2.</summary>
    private static bool IsAtlasSurface(Mesh mesh, int surface) =>
        mesh is ArrayMesh am && am.SurfaceGetFormat(surface).HasFlag(Mesh.ArrayFormat.FormatTexUV2)
        && am.SurfaceGetMaterial(surface) is BaseMaterial3D { ResourceName: "goods" or "goods_team" };

    /// <summary>
    /// The props file's cells arrive with Godot's glTF import's V flip (row r is stored as 1 - r: the top row as 1, the
    /// bottom as -2), while the town bake's cells are the rows themselves (the shader reads cell = UV2, row 0 the top).
    /// Turned back once per mesh, so one shader kind reads both. (A cell row is whole: 1 - y keeps it whole.)
    /// </summary>
    private static void TurnCellRows(Mesh mesh)
    {
        if (mesh is not ArrayMesh am) return;
        int n = am.GetSurfaceCount();
        bool any = false;
        for (int s = 0; s < n && !any; s++) any = IsAtlasSurface(am, s);
        if (!any) return;
        var kept = new List<(Mesh.PrimitiveType Type, Godot.Collections.Array Arrays, Godot.Collections.Array<Godot.Collections.Array> Shapes, Material? Material, string Name, bool Turn)>();
        for (int s = 0; s < n; s++)
            kept.Add((am.SurfaceGetPrimitiveType(s), am.SurfaceGetArrays(s), am.SurfaceGetBlendShapeArrays(s), am.SurfaceGetMaterial(s), am.SurfaceGetName(s), IsAtlasSurface(am, s)));
        am.ClearSurfaces();
        foreach (var k in kept)
        {
            if (k.Turn)
            {
                var cells = k.Arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array();
                for (int i = 0; i < cells.Length; i++) cells[i] = new Vector2(cells[i].X, 1 - cells[i].Y);
                k.Arrays[(int)Mesh.ArrayType.TexUV2] = cells;
            }
            am.AddSurfaceFromArrays(k.Type, k.Arrays, k.Shapes);
            int at = am.GetSurfaceCount() - 1;
            if (k.Material != null) am.SurfaceSetMaterial(at, k.Material);
            if (k.Name != "") am.SurfaceSetName(at, k.Name);
        }
    }

    /// <summary>Loader semantics that plain glTF material flags cannot express; shared with geometry proofs.</summary>
    public static Psx.Kind? ModelMaterialPolicy(string model,string material,Psx.Kind original,Look look)
    {
        if(model=="trades" && material is "tr_solid" or "tr_decal" or "tr_glow")
            return original with {Unlit=material=="tr_glow",Blend=material=="tr_decal",Scissor=material=="tr_decal",TwoSided=true,DepthWrite=material!="tr_decal",VertexColor=true,Add=false,Fog=true};
        if(model=="stalls" && material=="market_mud")
            return original with {Unlit=false,Blend=true,Scissor=true,DepthWrite=false,TwoSided=look.TwoSided,VertexColor=true,Add=false,Fog=true};
        return null;
    }

    /// <summary>At the game's end: the kept scenes go (they are in no tree, so nothing else frees them).</summary>
    public static void FreeAll()
    {
        foreach (var m in Loaded.Values) m?.Scene.Free();
        Loaded.Clear();
    }

    /// <summary>For a check: the tree under a node, one line each.</summary>
    public static IEnumerable<string> Describe(Node n, int depth = 0)
    {
        string more = n switch
        {
            Skeleton3D sk => $" bones {sk.GetBoneCount()}: {string.Join(" ", Enumerable.Range(0, sk.GetBoneCount()).Select(sk.GetBoneName))}",
            MeshInstance3D mi => $" mesh surfaces {mi.Mesh?.GetSurfaceCount()} skeleton '{mi.Skeleton}' skin {(mi.Skin != null)}",
            _ => "",
        };
        string at = n is Node3D n3 ? $" at {n3.Position} scale {n3.Scale}" : "";
        yield return new string(' ', depth * 2) + n.Name + " (" + n.GetClass() + ")" + at + more;
        foreach (var c in n.GetChildren())
            foreach (var l in Describe(c, depth + 1))
                yield return l;
    }
}

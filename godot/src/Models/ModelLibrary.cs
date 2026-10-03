using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Models;

/// <summary>
/// The game's models (client/public/models/*.glb, written without Draco by tools/godot/models.mjs into
/// godot/baked/models/): each file is read once at run time, kept, and handed out as copies that share its meshes
/// and materials. The materials become the psx material the way the browser's loader of that model makes them
/// (humans.ts, props.ts ... call psx(new MeshLambertMaterial({ map })) with their own options: `Look`).
/// The folder: option --models dir, else baked/models beside the project.
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

    public static string Dir
    {
        get
        {
            string d = Main.I?.Arg("models", "") ?? "";
            return d != "" ? d : ProjectSettings.GlobalizePath("res://baked/models");
        }
    }

    /// <summary>The model file `name` (no ".glb"), read at the first ask; null (said once) when it is not there.</summary>
    public static Model? Get(string name, Look? look = null)
    {
        if (Loaded.TryGetValue(name, out var had)) return had;
        ulong t0 = Time.GetTicksUsec();
        string path = Path.Combine(Dir, name + ".glb");
        Model? m = null;
        if (!File.Exists(path)) GD.PrintErr($"model {name}: {path} is not there. Write the models: node tools/godot/models.mjs");
        else
        {
            var doc = new GltfDocument();
            var state = new GltfState();
            var err = doc.AppendFromFile(path, state);
            var scene = err == Error.Ok ? doc.GenerateScene(state) as Node3D : null;
            if (scene == null) GD.PrintErr($"model {name}: did not load ({err})");
            else
            {
                m = new Model { Name = name, Scene = scene };
                Convert(m, look ?? new Look());
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

    /// <summary>Every material of the file once, as a psx material (BakedWorld.PsxMaterial), set on the shared meshes.</summary>
    private static void Convert(Model m, Look look)
    {
        var made = new Dictionary<Material, Material>();
        foreach (var n in BakedWorld.All(m.Scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null) continue;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var old = mi.Mesh.SurfaceGetMaterial(s);
                if (old is not BaseMaterial3D bm) continue;
                if (!made.TryGetValue(old, out var psx))
                {
                    bool blend = bm.Transparency == BaseMaterial3D.TransparencyEnum.Alpha;
                    bool scissor = bm.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor;
                    var kind = new Psx.Kind(
                        Unlit: look.Unlit ?? bm.ShadingMode == BaseMaterial3D.ShadingModeEnum.Unshaded,
                        Blend: blend,
                        Scissor: scissor,
                        TwoSided: look.TwoSided || bm.CullMode == BaseMaterial3D.CullModeEnum.Disabled,
                        DepthWrite: true,
                        Snap: look.Snap,
                        Atlas: 0,
                        VertexColor: look.VertexColor,
                        Add: false,
                        Fog: true);
                    psx = BakedWorld.PsxMaterial(bm, kind, look.Affine, look.FogReach, scissor ? bm.AlphaScissorThreshold : 0);
                    made[old] = psx;
                }
                mi.Mesh.SurfaceSetMaterial(s, psx);
            }
        }
        m.Materials = made.Count;
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

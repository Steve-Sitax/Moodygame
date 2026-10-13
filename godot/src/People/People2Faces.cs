using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

public static class People2Faces
{
    private static readonly Dictionary<string, int> bags = new();
    internal static void Forget() => bags.Clear();
    // FNV-1a over UTF-16 code units, independent of randomized .NET string hashes.
    private static uint Hash(string text)
    {
        uint hash = 2166136261;
        foreach (char c in text) { hash ^= c; hash = unchecked(hash * 16777619); }
        return hash;
    }
    internal static void Next(Human human)
    {
        int at = bags.GetValueOrDefault(human.Kind);
        bags[human.Kind] = at + 1;
        // A permutation per 22-person bag, rotated by kind. No repeats within a bag.
        int face = (int)((Hash(human.Kind) % 22 + (uint)(at % 22) * 7) % 22);
        human.Root.SetMeta("face_id", face);
    }
    public static int SetIdentity(Node3D root, string stableId)
    {
        int face = (int)(Hash(stableId) % 22);
        root.SetMeta("face_id", face);
        root.SetMeta("face_seed", (long)Hash(stableId));
        People2Material.Tone(root, Hash(stableId));
        return face;
    }
    /// <summary>Assign once at spawn. Reset omitted keys; do not clamp authored weights.</summary>
    public static int SetFace(Node3D root, IReadOnlyDictionary<string, float> weights)
    {
        int assigned = 0;
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not MeshInstance3D mi || mi.Mesh is not ArrayMesh mesh || !mi.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) continue;
            for (int i = 0; i < mesh.GetBlendShapeCount(); i++)
            {
                string name = mesh.GetBlendShapeName(i);
                float weight = weights.GetValueOrDefault(name);
                mi.SetBlendShapeValue(i, weight);
                if (weights.ContainsKey(name)) assigned++;
            }
        }
        return assigned;
    }
    internal static void EyeFlags(MeshInstance3D mi)
    {
        if (mi.Mesh is not ArrayMesh source || mi.Skin == null) return;
        // Red = eye; green = full-square head picture. Colours never multiply the skin picture.
        // Interim import derives the flag from skin binds; new models may write the same channel directly.
        var sk = mi.GetNodeOrNull<Skeleton3D>(mi.Skeleton);
        var result = new ArrayMesh { BlendShapeMode = source.BlendShapeMode };
        for (int i = 0; i < source.GetBlendShapeCount(); i++) result.AddBlendShape(source.GetBlendShapeName(i));
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array();
            var weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
            var colours = arrays[(int)Mesh.ArrayType.Color].AsColorArray();
            // Recompute the eye flag while preserving the authored head selector.
            {
                if (colours.Length != vertices.Length) colours = new Color[vertices.Length];
                int influences = vertices.Length > 0 ? weights.Length / vertices.Length : 0;
                for (int v = 0; v < vertices.Length; v++)
                {
                    float eye = 0;
                    for (int k = 0; k < influences; k++)
                    {
                        int bind = bones[v * influences + k];
                        string name = mi.Skin.GetBindName(bind);
                        int bone = mi.Skin.GetBindBone(bind);
                        if (name == "" && sk != null && bone >= 0) name = sk.GetBoneName(bone);
                        if (name is "eyeL" or "eyeR") eye += weights[v * influences + k];
                    }
                    colours[v] = new Color(eye > 0.5f ? 1 : 0, colours[v].G, colours[v].B, 1);
                }
                arrays[(int)Mesh.ArrayType.Color] = colours;
            }
            result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, source.SurfaceGetBlendShapeArrays(s), flags: source.SurfaceGetFormat(s) & Mesh.ArrayFormat.FlagUse8BoneWeights);
            result.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
        }
        mi.Mesh = result;
    }
}

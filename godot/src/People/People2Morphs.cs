using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>
/// The people2 sliders' moves, kept small for the game (docs/godot-people2.md "Sliders"). The authored glb carries
/// MakeHuman's sliders as live morph targets on every near copy, far copy and hair piece; Godot would store each one
/// dense (every vertex of every key), over 100 MB. At intake the moves are taken out of the meshes into one sparse
/// file, people2-resources/morphs.bin (per mesh, per key: the vertices that move, their move and their normal's change
/// as half floats), and the stored meshes carry no blend shapes. People2Faces bakes each person's sliders into their
/// own mesh at spawn from this file.
/// </summary>
public static class People2Morphs
{
    public const string File = "res://assets/game-models/people2-resources/morphs.bin";
    private const uint Magic = 0x4F4D3250; // "P2MO"
    private const float MinMove = 2e-5f, MinNormal = 2e-3f;

    public sealed class Key
    {
        public int[] Index = Array.Empty<int>();
        public Vector3[] Move = Array.Empty<Vector3>(), Normal = Array.Empty<Vector3>();
    }

    /// <summary>Take every mesh's blend shapes out of a scene (intake): returns the sparse file's bytes; every
    /// MeshInstance3D gets a copy of its mesh without blend shapes.</summary>
    public static byte[] Extract(Node scene, out int meshes, out long entries)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms, Encoding.UTF8);
        var found = new List<(string name, int verts, List<(string key, Key k)> keys)>();
        var stripped = new Dictionary<Mesh, ArrayMesh>();
        entries = 0;
        foreach (var n in BakedWorld.All(scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh is not ArrayMesh source) continue;
            if (source.GetBlendShapeCount() > 0 && source.GetSurfaceCount() > 0)
            {
                var arrays = source.SurfaceGetArrays(0);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var nr = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                var shapes = source.SurfaceGetBlendShapeArrays(0);
                var keys = new List<(string, Key)>();
                for (int k = 0; k < source.GetBlendShapeCount() && k < shapes.Count; k++)
                {
                    var sv = shapes[k][(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var sn = shapes[k][(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? null : shapes[k][(int)Mesh.ArrayType.Normal].AsVector3Array();
                    if (sv.Length != v.Length) continue;
                    bool rel = source.BlendShapeMode == Mesh.BlendShapeMode.Relative && LooksRelative(sv, v);
                    bool relN = sn != null && sn.Length == nr.Length && source.BlendShapeMode == Mesh.BlendShapeMode.Relative && LooksRelative(sn, nr);
                    var idx = new List<int>(); var mv = new List<Vector3>(); var nm = new List<Vector3>();
                    for (int i = 0; i < sv.Length; i++)
                    {
                        Vector3 d = rel ? sv[i] : sv[i] - v[i];
                        Vector3 dn = sn == null || sn.Length != sv.Length ? Vector3.Zero : relN ? sn[i] : sn[i] - nr[i];
                        if (d.Length() < MinMove && dn.Length() < MinNormal) continue;
                        idx.Add(i); mv.Add(d); nm.Add(dn);
                    }
                    if (idx.Count == 0) continue;
                    keys.Add((source.GetBlendShapeName(k).ToString(), new Key { Index = idx.ToArray(), Move = mv.ToArray(), Normal = nm.ToArray() }));
                    entries += idx.Count;
                }
                found.Add((mi.Name.ToString(), v.Length, keys));
            }
            if (source.GetBlendShapeCount() > 0)
            {
                if (!stripped.TryGetValue(source, out var plain))
                {
                    plain = new ArrayMesh();
                    for (int s = 0; s < source.GetSurfaceCount(); s++)
                    {
                        plain.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), source.SurfaceGetArrays(s), flags: source.SurfaceGetFormat(s) & Mesh.ArrayFormat.FlagUse8BoneWeights);
                        plain.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
                    }
                    plain.ResourceName = source.ResourceName;
                    stripped[source] = plain;
                }
                mi.Mesh = plain;
            }
        }
        w.Write(Magic); w.Write(1u); w.Write(found.Count);
        foreach (var (name, verts, keys) in found)
        {
            Str(w, name); w.Write(verts); w.Write(keys.Count);
            foreach (var (key, k) in keys)
            {
                Str(w, key); w.Write(k.Index.Length);
                bool wide = verts > 65535;
                foreach (int i in k.Index) { if (wide) w.Write(i); else w.Write((ushort)i); }
                foreach (var d in k.Move) { w.Write((Half)d.X); w.Write((Half)d.Y); w.Write((Half)d.Z); }
                foreach (var d in k.Normal) { w.Write((Half)d.X); w.Write((Half)d.Y); w.Write((Half)d.Z); }
            }
        }
        meshes = found.Count;
        w.Flush();
        return ms.ToArray();
    }

    /// <summary>The file read back: mesh name -> (vertex count, key -> moves).</summary>
    public static Dictionary<string, (int verts, Dictionary<string, Key> keys)> Read(byte[] data)
    {
        var out_ = new Dictionary<string, (int, Dictionary<string, Key>)>(StringComparer.Ordinal);
        using var r = new BinaryReader(new MemoryStream(data), Encoding.UTF8);
        if (r.ReadUInt32() != Magic || r.ReadUInt32() != 1) throw new InvalidDataException("Not a people2 morph file.");
        int meshes = r.ReadInt32();
        for (int m = 0; m < meshes; m++)
        {
            string name = Str(r);
            int verts = r.ReadInt32(), keyCount = r.ReadInt32();
            var keys = new Dictionary<string, Key>(StringComparer.Ordinal);
            for (int k = 0; k < keyCount; k++)
            {
                string key = Str(r);
                int n = r.ReadInt32();
                var kk = new Key { Index = new int[n], Move = new Vector3[n], Normal = new Vector3[n] };
                bool wide = verts > 65535;
                for (int i = 0; i < n; i++) kk.Index[i] = wide ? r.ReadInt32() : r.ReadUInt16();
                for (int i = 0; i < n; i++) kk.Move[i] = new Vector3((float)r.ReadHalf(), (float)r.ReadHalf(), (float)r.ReadHalf());
                for (int i = 0; i < n; i++) kk.Normal[i] = new Vector3((float)r.ReadHalf(), (float)r.ReadHalf(), (float)r.ReadHalf());
                keys[key] = kk;
            }
            out_[name] = (verts, keys);
        }
        return out_;
    }

    private static bool LooksRelative(Vector3[] shape, Vector3[] basis)
    {
        double s = 0, b = 0;
        int step = Math.Max(1, shape.Length / 400);
        for (int i = 0; i < shape.Length; i += step) { s += shape[i].Length(); b += basis[i].Length(); }
        return s < 0.25 * b;
    }

    private static void Str(BinaryWriter w, string s)
    {
        var b = Encoding.UTF8.GetBytes(s);
        w.Write((ushort)b.Length); w.Write(b);
    }

    private static string Str(BinaryReader r) => Encoding.UTF8.GetString(r.ReadBytes(r.ReadUInt16()));
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// A small reader for the Blender export's binary glTF (docs/ruien-native.md): every mesh node's triangles in world
/// coordinates with all their attributes, the custom ones too (_AO, _BAKECOL), which Godot's own glTF import drops.
/// Only what the export writes: triangle lists, float or normalised integer accessors, node TRS or matrix transforms.
/// </summary>
public static class RuienGlb
{
    public sealed class Prim
    {
        public string Material = "";
        public Vector3[] Pos = Array.Empty<Vector3>();
        public Vector3[]? Nrm;
        public Vector2[]? Uv;
        public Color[]? Col;
        public float[]? Ao;
        public Color[]? Bake;
        public int[] Idx = Array.Empty<int>();
    }

    public sealed class Obj
    {
        public string Name = "";
        public readonly List<Prim> Prims = new();
        public JsonElement Extras;
    }

    public static List<Obj> Read(string file)
    {
        var bytes = File.ReadAllBytes(file);
        if (BitConverter.ToUInt32(bytes, 0) != 0x46546C67) throw new InvalidDataException("not a GLB: " + file);
        int jsonLen = BitConverter.ToInt32(bytes, 12);
        var json = JsonDocument.Parse(Encoding.UTF8.GetString(bytes, 20, jsonLen)).RootElement;
        int binStart = 20 + jsonLen + 8;
        var accessors = json.GetProperty("accessors");
        var views = json.GetProperty("bufferViews");
        string[] mats = json.TryGetProperty("materials", out var ms) ? ms.EnumerateArray().Select(m => m.TryGetProperty("name", out var n) ? n.GetString()! : "").ToArray() : Array.Empty<string>();

        float[] Floats(int acc, out int comps)
        {
            var a = accessors[acc];
            int count = a.GetProperty("count").GetInt32();
            comps = a.GetProperty("type").GetString() switch { "SCALAR" => 1, "VEC2" => 2, "VEC3" => 3, "VEC4" => 4, _ => throw new InvalidDataException("accessor type") };
            int ct = a.GetProperty("componentType").GetInt32();
            bool norm = a.TryGetProperty("normalized", out var nz) && nz.GetBoolean();
            var v = views[a.GetProperty("bufferView").GetInt32()];
            int off = binStart + (v.TryGetProperty("byteOffset", out var bo) ? bo.GetInt32() : 0) + (a.TryGetProperty("byteOffset", out var ao) ? ao.GetInt32() : 0);
            int size = ct switch { 5126 => 4, 5123 or 5122 => 2, 5121 or 5120 => 1, 5125 => 4, _ => 4 };
            int stride = v.TryGetProperty("byteStride", out var bs) ? bs.GetInt32() : size * comps;
            var o = new float[count * comps];
            for (int i = 0; i < count; i++)
                for (int c = 0; c < comps; c++)
                {
                    int p = off + i * stride + c * size;
                    o[i * comps + c] = ct switch
                    {
                        5126 => BitConverter.ToSingle(bytes, p),
                        5123 => norm ? BitConverter.ToUInt16(bytes, p) / 65535f : BitConverter.ToUInt16(bytes, p),
                        5121 => norm ? bytes[p] / 255f : bytes[p],
                        5122 => norm ? Math.Max(BitConverter.ToInt16(bytes, p) / 32767f, -1) : BitConverter.ToInt16(bytes, p),
                        5120 => norm ? Math.Max((sbyte)bytes[p] / 127f, -1) : (sbyte)bytes[p],
                        5125 => BitConverter.ToUInt32(bytes, p),
                        _ => 0,
                    };
                }
            return o;
        }
        int[] Ints(int acc)
        {
            var a = accessors[acc];
            int count = a.GetProperty("count").GetInt32(), ct = a.GetProperty("componentType").GetInt32();
            var v = views[a.GetProperty("bufferView").GetInt32()];
            int off = binStart + (v.TryGetProperty("byteOffset", out var bo) ? bo.GetInt32() : 0) + (a.TryGetProperty("byteOffset", out var ao) ? ao.GetInt32() : 0);
            var o = new int[count];
            for (int i = 0; i < count; i++)
                o[i] = ct switch { 5125 => (int)BitConverter.ToUInt32(bytes, off + i * 4), 5123 => BitConverter.ToUInt16(bytes, off + i * 2), _ => bytes[off + i] };
            return o;
        }

        var nodes = json.GetProperty("nodes");
        var meshes = json.TryGetProperty("meshes", out var mm) ? mm : default;
        var result = new List<Obj>();
        Transform3D Local(JsonElement n)
        {
            if (n.TryGetProperty("matrix", out var m))
            {
                var f = m.EnumerateArray().Select(e => e.GetSingle()).ToArray();
                return new Transform3D(new Basis(new Vector3(f[0], f[1], f[2]), new Vector3(f[4], f[5], f[6]), new Vector3(f[8], f[9], f[10])), new Vector3(f[12], f[13], f[14]));
            }
            var t = n.TryGetProperty("translation", out var tr) ? new Vector3(tr[0].GetSingle(), tr[1].GetSingle(), tr[2].GetSingle()) : Vector3.Zero;
            var r = n.TryGetProperty("rotation", out var ro) ? new Quaternion(ro[0].GetSingle(), ro[1].GetSingle(), ro[2].GetSingle(), ro[3].GetSingle()) : Quaternion.Identity;
            var s = n.TryGetProperty("scale", out var sc) ? new Vector3(sc[0].GetSingle(), sc[1].GetSingle(), sc[2].GetSingle()) : Vector3.One;
            return new Transform3D(new Basis(r).Scaled(s), t);
        }
        void Walk(int ni, Transform3D parent)
        {
            var n = nodes[ni];
            var xf = parent * Local(n);
            if (n.TryGetProperty("mesh", out var mi))
            {
                var mesh = meshes[mi.GetInt32()];
                var obj = new Obj { Name = n.TryGetProperty("name", out var nm) ? nm.GetString()! : "mesh" + ni };
                if (n.TryGetProperty("extras", out var ex)) obj.Extras = ex.Clone();
                var nb = xf.Basis.Inverse().Transposed();
                foreach (var p in mesh.GetProperty("primitives").EnumerateArray())
                {
                    if (p.TryGetProperty("mode", out var md) && md.GetInt32() != 4) continue;
                    var at = p.GetProperty("attributes");
                    var pr = new Prim { Material = p.TryGetProperty("material", out var pm) && pm.GetInt32() < mats.Length ? mats[pm.GetInt32()] : "" };
                    var pos = Floats(at.GetProperty("POSITION").GetInt32(), out _);
                    int count = pos.Length / 3;
                    pr.Pos = new Vector3[count];
                    for (int i = 0; i < count; i++) pr.Pos[i] = xf * new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                    if (at.TryGetProperty("NORMAL", out var na))
                    {
                        var nf = Floats(na.GetInt32(), out _);
                        pr.Nrm = new Vector3[count];
                        for (int i = 0; i < count; i++) pr.Nrm[i] = (nb * new Vector3(nf[i * 3], nf[i * 3 + 1], nf[i * 3 + 2])).Normalized();
                    }
                    if (at.TryGetProperty("TEXCOORD_0", out var ua))
                    {
                        var uf = Floats(ua.GetInt32(), out _);
                        pr.Uv = new Vector2[count];
                        for (int i = 0; i < count; i++) pr.Uv[i] = new Vector2(uf[i * 2], uf[i * 2 + 1]);
                    }
                    if (at.TryGetProperty("COLOR_0", out var ca))
                    {
                        var cf = Floats(ca.GetInt32(), out int cc);
                        pr.Col = new Color[count];
                        for (int i = 0; i < count; i++) pr.Col[i] = new Color(cf[i * cc], cf[i * cc + 1], cf[i * cc + 2], cc > 3 ? cf[i * cc + 3] : 1);
                    }
                    if (at.TryGetProperty("_AO", out var aa))
                    {
                        var af = Floats(aa.GetInt32(), out int ac);
                        pr.Ao = new float[count];
                        for (int i = 0; i < count; i++) pr.Ao[i] = af[i * ac];
                    }
                    if (at.TryGetProperty("_BAKECOL", out var ba))
                    {
                        var bf = Floats(ba.GetInt32(), out int bc);
                        pr.Bake = new Color[count];
                        for (int i = 0; i < count; i++) pr.Bake[i] = new Color(bf[i * bc], bf[i * bc + 1], bf[i * bc + 2], bc > 3 ? bf[i * bc + 3] : 1);
                    }
                    pr.Idx = p.TryGetProperty("indices", out var ix) ? Ints(ix.GetInt32()) : Enumerable.Range(0, count).ToArray();
                    obj.Prims.Add(pr);
                }
                result.Add(obj);
            }
            if (n.TryGetProperty("children", out var ch)) foreach (var c in ch.EnumerateArray()) Walk(c.GetInt32(), xf);
        }
        var scene = json.GetProperty("scenes")[json.TryGetProperty("scene", out var si) ? si.GetInt32() : 0];
        foreach (var r in scene.GetProperty("nodes").EnumerateArray()) Walk(r.GetInt32(), Transform3D.Identity);
        return result;
    }
}

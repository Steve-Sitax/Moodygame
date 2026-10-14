using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>
/// Every person's own face and body (docs/people.md "Faces in the game"). The people2 meshes carry MakeHuman's
/// sliders as shape keys; at load their moves are kept here (sparse, in RAM) and the meshes are stripped of them. At
/// spawn a person gets a face from their stable id (FaceFor: the same recipe as face_types.face_for, so every PC
/// shows the same person), and their near and far meshes are baked once: the body's or kind's mesh, the chosen hair,
/// beard and moustache pieces merged into it (one draw), every slider's move added. The face picture is a layer of the
/// face array (instance uniform face_layer); the body's skin takes the face's tone (body_tone).
/// </summary>
public static class People2Faces
{
    private static readonly Dictionary<string, int> bags = new();
    // New parts can arrive on the main thread while the shaping worker reads immutable templates.
    private static readonly ConcurrentDictionary<string, Template> templates = new(StringComparer.Ordinal);
    private static JsonDocument? faceTypes, sliders;
    private static readonly Dictionary<string, int> faceLayers = new(StringComparer.Ordinal);
    internal static long BakeCount { get; private set; }
    internal static double BakeMs { get; private set; }
    internal static double MaxBakeMs { get; private set; }

    internal static void Forget()
    {
        // Loading/unloading may wait; gameplay never waits for a shaping worker.
        foreach (var job in jobs) if (job.Worker != null) job.Worker.GetAwaiter().GetResult();
        foreach (var job in cache.Values) { job.Near?.Dispose(); job.Far?.Dispose(); }
        foreach (var template in templates.Values) template.Stripped.Dispose();
        morphFile = null;
        requests.Clear(); activeRequests.Clear(); jobs.Clear(); cache.Clear(); bindMaps.Clear();
        bags.Clear(); templates.Clear(); faceLayers.Clear();
        faceTypes?.Dispose(); faceTypes = null; sliders?.Dispose(); sliders = null;
        BakeCount = 0; BakeMs = MaxBakeMs = 0;
    }

    // FNV-1a over UTF-16 code units, independent of randomized .NET string hashes.
    private static uint Hash(string text)
    {
        uint hash = 2166136261;
        foreach (char c in text) { hash ^= c; hash = unchecked(hash * 16777619); }
        return hash;
    }
    // FNV-1a 32 over UTF-8 bytes (face_types.fnv1a32).
    private static uint Fnv1a(string text)
    {
        uint h = 0x811C9DC5;
        foreach (byte b in System.Text.Encoding.UTF8.GetBytes(text)) { h ^= b; h = unchecked(h * 0x01000193); }
        return h;
    }

    // ---------------------------------------------------------------- the meshes' moves, kept at load

    private sealed class Template
    {
        public string Name = "";
        public Vector3[] V = Array.Empty<Vector3>(), N = Array.Empty<Vector3>();
        public float[]? Tan;
        public Vector2[]? UV;
        public Color[]? C;
        public int[]? Bones;
        public float[]? Weights;
        public int[] Index = Array.Empty<int>();
        public Mesh.ArrayFormat Format;
        public Material? Material;
        public Skin? Skin;
        public string[] BindNames = Array.Empty<string>();
        public readonly Dictionary<string, (int[] idx, Vector3[] dp, Vector3[] dn)> Keys = new(StringComparer.Ordinal);
        public ArrayMesh Stripped = null!;
    }

    private static Dictionary<string, (int verts, Dictionary<string, People2Morphs.Key> keys)>? morphFile;
    /// <summary>The sliders' moves of every people2 mesh (written at intake: People2Morphs).</summary>
    internal static void LoadMorphs(string part = "people2")
    {
        morphFile = null;
        string file = "res://assets/game-models/" + part + "-resources/morphs.bin";
        if (!Godot.FileAccess.FileExists(file)) throw new InvalidDataException("Missing people morph part: " + file);
        morphFile = People2Morphs.Read(Godot.FileAccess.GetFileAsBytes(file));
    }

    /// <summary>At load: keep a mesh's arrays and its sliders' moves (the morph file, or the mesh's own shape keys);
    /// give the instance a mesh without shape keys (eye flag in red, the authored face flag in green kept).</summary>
    internal static void Capture(MeshInstance3D mi)
    {
        if (mi.Mesh is not ArrayMesh source) return;
        string name = mi.Name.ToString();
        if (templates.TryGetValue(name, out var known) && ReferenceEquals(known.Stripped, mi.Mesh)) return;
        var arrays = source.SurfaceGetArrays(0);
        var t = new Template { Name = name, Format = source.SurfaceGetFormat(0), Material = source.SurfaceGetMaterial(0), Skin = mi.Skin };
        t.V = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        t.N = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        if (arrays[(int)Mesh.ArrayType.Tangent].VariantType != Variant.Type.Nil) t.Tan = arrays[(int)Mesh.ArrayType.Tangent].AsFloat32Array();
        if (t.Tan != null && t.Tan.Length != t.V.Length * 4) t.Tan = null;
        t.UV = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        t.C = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? Enumerable.Repeat(new Color(0, 0, 1, 1), t.V.Length).ToArray() : arrays[(int)Mesh.ArrayType.Color].AsColorArray();
        if (t.C.Length != t.V.Length) t.C = Enumerable.Repeat(new Color(0, 0, 1, 1), t.V.Length).ToArray();
        t.Bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array();
        t.Weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
        t.Index = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        // the eye flag: vertices of the eyeballs (weighted to eyeL/eyeR); the face flag stays as authored
        var sk = mi.GetNodeOrNull<Skeleton3D>(mi.Skeleton);
        if (mi.Skin != null)
        {
            t.BindNames = new string[mi.Skin.GetBindCount()];
            for (int b = 0; b < t.BindNames.Length; b++)
            {
                string bn = mi.Skin.GetBindName(b);
                int bone = mi.Skin.GetBindBone(b);
                if (bn == "" && sk != null && bone >= 0) bn = sk.GetBoneName(bone);
                t.BindNames[b] = bn;
            }
            int inf = t.V.Length > 0 ? t.Weights.Length / t.V.Length : 0;
            for (int v = 0; v < t.V.Length; v++)
            {
                float eye = 0;
                for (int k = 0; k < inf; k++)
                {
                    int bind = t.Bones[v * inf + k];
                    if (bind >= 0 && bind < t.BindNames.Length && t.BindNames[bind] is "eyeL" or "eyeR") eye += t.Weights[v * inf + k];
                }
                t.C[v] = new Color(eye > 0.5f ? 1 : 0, t.C[v].G, t.C[v].B, t.C[v].A);
            }
        }
        // the shape keys: Godot keeps them as offsets (relative) or as whole shapes; the moves are kept sparse
        var shapes = source.SurfaceGetBlendShapeArrays(0);
        for (int k = 0; k < source.GetBlendShapeCount() && k < shapes.Count; k++)
        {
            var sv = shapes[k][(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var sn = shapes[k][(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? null : shapes[k][(int)Mesh.ArrayType.Normal].AsVector3Array();
            if (sv.Length != t.V.Length) continue;
            bool relative = source.BlendShapeMode == Mesh.BlendShapeMode.Relative && LooksRelative(sv, t.V);
            var idx = new List<int>(); var dp = new List<Vector3>(); var dn = new List<Vector3>();
            for (int v = 0; v < sv.Length; v++)
            {
                Vector3 d = relative ? sv[v] : sv[v] - t.V[v];
                Vector3 n = sn == null || sn.Length != sv.Length ? Vector3.Zero : (relative && LooksRelative(sn, t.N) ? sn[v] : sn[v] - t.N[v]);
                if (d.LengthSquared() > 1e-12f || n.LengthSquared() > 1e-8f) { idx.Add(v); dp.Add(d); dn.Add(n); }
            }
            t.Keys[source.GetBlendShapeName(k).ToString()] = (idx.ToArray(), dp.ToArray(), dn.ToArray());
        }
        if (morphFile != null && morphFile.TryGetValue(name, out var mf) && mf.verts == t.V.Length)
            foreach (var (key, k) in mf.keys) t.Keys[key] = (k.Index, k.Move, k.Normal);
        t.Stripped = Build(t, t.V, t.N, t.C);
        templates[name] = t;
        mi.Mesh = t.Stripped;
    }

    private static bool LooksRelative(Vector3[] shape, Vector3[] basis)
    {
        double s = 0, b = 0;
        int step = Math.Max(1, shape.Length / 400);
        for (int i = 0; i < shape.Length; i += step) { s += shape[i].Length(); b += basis[i].Length(); }
        return s < 0.25 * b;
    }

    private static Prepared Prepare(Template t, Vector3[] v, Vector3[] n, Color[] c, Template[]? pieces = null, Vector3[][]? pv = null, Vector3[][]? pn = null)
    {
        var a = new Prepared { Source = t };
        if (pieces == null || pieces.Length == 0)
        {
            a.V = v; a.N = n;
            if (t.Tan != null) a.Tan = t.Tan;
            a.UV = t.UV!; a.C = c;
            if (t.Bones is { Length: > 0 } && t.Weights is { Length: > 0 }) { a.Bones = t.Bones; a.Weights = t.Weights; }
            if (t.Index.Length > 0) a.Index = t.Index;
        }
        else
        {
            int inf = t.V.Length > 0 ? t.Weights!.Length / t.V.Length : 4;
            int nv = v.Length + pieces.Sum(p => p.V.Length), ni = t.Index.Length + pieces.Sum(p => p.Index.Length);
            var V = new Vector3[nv]; var N = new Vector3[nv]; var UV = new Vector2[nv]; var C = new Color[nv];
            var B = new int[nv * inf]; var W = new float[nv * inf]; var I = new int[ni];
            float[]? Tan = t.Tan != null ? new float[nv * 4] : null;
            Array.Copy(v, V, v.Length); Array.Copy(n, N, n.Length); Array.Copy(t.UV!, UV, v.Length); Array.Copy(c, C, v.Length);
            Array.Copy(t.Bones!, B, t.Bones!.Length); Array.Copy(t.Weights!, W, t.Weights!.Length); Array.Copy(t.Index, I, t.Index.Length);
            if (Tan != null) Array.Copy(t.Tan!, Tan, t.Tan!.Length);
            int ov = v.Length, oi = t.Index.Length;
            for (int p = 0; p < pieces.Length; p++)
            {
                var pc = pieces[p];
                int pinf = pc.V.Length > 0 ? pc.Weights!.Length / pc.V.Length : inf;
                var map = BindMap(pc, t);
                Array.Copy(pv![p], 0, V, ov, pc.V.Length); Array.Copy(pn![p], 0, N, ov, pc.V.Length);
                Array.Copy(pc.UV!, 0, UV, ov, pc.V.Length); Array.Copy(pc.C!, 0, C, ov, pc.V.Length);
                for (int i = 0; i < pc.V.Length; i++)
                    for (int k = 0; k < inf; k++)
                    {
                        bool has = k < pinf;
                        int bind = has ? pc.Bones![i * pinf + k] : 0;
                        B[(ov + i) * inf + k] = has && bind >= 0 && bind < map.Length ? map[bind] : 0;
                        W[(ov + i) * inf + k] = has ? pc.Weights![i * pinf + k] : 0;
                    }
                if (Tan != null) for (int i = 0; i < pc.V.Length * 4; i++) Tan[ov * 4 + i] = pc.Tan != null && i < pc.Tan.Length ? pc.Tan[i] : (i % 4 == 3 ? 1 : (i % 4 == 0 ? 1 : 0));
                for (int i = 0; i < pc.Index.Length; i++) I[oi + i] = pc.Index[i] + ov;
                ov += pc.V.Length; oi += pc.Index.Length;
            }
            a.V = V; a.N = N;
            if (Tan != null) a.Tan = Tan;
            a.UV = UV; a.C = C;
            a.Bones = B; a.Weights = W; a.Index = I;
        }
        return a;
    }

    private sealed class Prepared
    {
        public Template Source = null!;
        public Vector3[] V = null!, N = null!;
        public Vector2[] UV = null!;
        public Vector2[]? PlayerRegions;
        public Color[] C = null!;
        public int[]? Bones, Index;
        public float[]? Tan, Weights;
        public Vector3[][]? Expressions;
        public Vector3[][]? ExpressionNormals;
    }
    private static ArrayMesh Upload(Prepared p)
    {
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = p.V; a[(int)Mesh.ArrayType.Normal] = p.N;
        a[(int)Mesh.ArrayType.TexUV] = p.UV; a[(int)Mesh.ArrayType.Color] = p.C;
        if (p.PlayerRegions != null) a[(int)Mesh.ArrayType.TexUV2] = p.PlayerRegions;
        if (p.Tan != null) a[(int)Mesh.ArrayType.Tangent] = p.Tan;
        if (p.Bones is { Length: > 0 }) a[(int)Mesh.ArrayType.Bones] = p.Bones;
        if (p.Weights is { Length: > 0 }) a[(int)Mesh.ArrayType.Weights] = p.Weights;
        if (p.Index is { Length: > 0 }) a[(int)Mesh.ArrayType.Index] = p.Index;
        // Godot octahedrally packs blend normals as unit directions. Absolute targets
        // avoid turning a small normal delta into a full-strength direction on the GPU.
        var mesh = new ArrayMesh { BlendShapeMode = Mesh.BlendShapeMode.Normalized };
        var shapes = new Godot.Collections.Array<Godot.Collections.Array>();
        if (p.Expressions != null)
            for (int k = 0; k < LiveKeys.Length; k++)
            {
                mesh.AddBlendShape(LiveKeys[k]);
                var sa = new Godot.Collections.Array(); sa.Resize((int)Mesh.ArrayType.Max);
                sa[(int)Mesh.ArrayType.Vertex] = p.Expressions[k];
                sa[(int)Mesh.ArrayType.Normal] = p.ExpressionNormals![k];
                if (p.Tan != null) sa[(int)Mesh.ArrayType.Tangent] = p.Tan;
                shapes.Add(sa);
            }
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a, shapes, flags: p.Source.Format & Mesh.ArrayFormat.FlagUse8BoneWeights);
        if (p.Source.Material != null) mesh.SurfaceSetMaterial(0, p.Source.Material);
        return mesh;
    }
    private static readonly string[] LiveKeys = { "blink", "brow_raise", "smile" };
    private static ArrayMesh Build(Template t, Vector3[] v, Vector3[] n, Color[] c, Template[]? pieces = null, Vector3[][]? pv = null, Vector3[][]? pn = null)
        => Upload(Prepare(t, v, n, c, pieces, pv, pn));

    /// <summary>For the cost proof only: a static copy of a people2 mesh (no skeleton) with its first nKeys sliders as
    /// live Godot blend shapes (dense, absolute targets), to compare per-frame blend-shape cost against the bake.</summary>
    internal static ArrayMesh? BenchMesh(string name, int nKeys)
    {
        if (!templates.TryGetValue(name, out var t)) return null;
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = t.V; a[(int)Mesh.ArrayType.Normal] = t.N;
        a[(int)Mesh.ArrayType.TexUV] = t.UV!; a[(int)Mesh.ArrayType.Color] = t.C!;
        if (t.Index.Length > 0) a[(int)Mesh.ArrayType.Index] = t.Index;
        var keys = t.Keys.OrderBy(k => k.Key, StringComparer.Ordinal).Take(nKeys).ToList();
        var mesh = new ArrayMesh { BlendShapeMode = Mesh.BlendShapeMode.Normalized };
        var shapes = new Godot.Collections.Array<Godot.Collections.Array>();
        foreach (var (key, k) in keys)
        {
            mesh.AddBlendShape(key);
            var sv = (Vector3[])t.V.Clone(); var sn = (Vector3[])t.N.Clone();
            for (int i = 0; i < k.idx.Length; i++) { sv[k.idx[i]] += k.dp[i]; sn[k.idx[i]] = (sn[k.idx[i]] + k.dn[i]).Normalized(); }
            var sa = new Godot.Collections.Array(); sa.Resize((int)Mesh.ArrayType.Max);
            sa[(int)Mesh.ArrayType.Vertex] = sv; sa[(int)Mesh.ArrayType.Normal] = sn;
            shapes.Add(sa);
        }
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a, shapes);
        if (t.Material != null) mesh.SurfaceSetMaterial(0, t.Material);
        return mesh;
    }

    private static readonly Dictionary<(string, string), int[]> bindMaps = new();
    private static int[] BindMap(Template piece, Template body)
    {
        if (bindMaps.TryGetValue((piece.Name, body.Name), out var m)) return m;
        m = new int[piece.BindNames.Length];
        for (int i = 0; i < m.Length; i++)
        {
            int j = Array.IndexOf(body.BindNames, piece.BindNames[i]);
            m[i] = j >= 0 ? j : Math.Min(i, Math.Max(0, body.BindNames.Length - 1));
        }
        return m;
    }

    // ---------------------------------------------------------------- a person's face (face_types.face_for)

    /// <summary>A face: its type, slider values, face picture, hair, beard and moustache.</summary>
    public sealed record Face(string Type, Dictionary<string, float> Sliders, string Cell, string Hair, string? Beard, string? Moustache, float Crook);

    private static JsonElement Types => Data().RootElement;
    private static JsonDocument Data()
    {
        faceTypes ??= JsonDocument.Parse(File.ReadAllText(Paths.Shared("faceTypes.json")));
        sliders ??= JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleSliders.json")));
        return faceTypes;
    }

    private sealed class Rng
    {
        private uint a;
        public Rng(uint seed) => a = seed;
        public uint U32()
        {
            unchecked
            {
                a += 0x6D2B79F5;
                uint t = a;
                t = (t ^ (t >> 15)) * (t | 1);
                t ^= t + ((t ^ (t >> 7)) * (t | 61));
                return t ^ (t >> 14);
            }
        }
        public double Uniform() => U32() / 4294967296.0;
        public double Gauss() => (Uniform() + Uniform() + Uniform() + Uniform() - 2.0) * 1.7320508;
        /// <summary>A key of {key: weight} in key order ("none" sorts as the empty key, first).</summary>
        public string? Pick(IEnumerable<(string key, double w)> items)
        {
            var list = items.OrderBy(i => i.key == "none" ? "" : i.key, StringComparer.Ordinal).ToList();
            double total = list.Sum(i => i.w), r = Uniform() * total;
            foreach (var (k, w) in list) { r -= w; if (r < 0) return k == "none" ? null : k; }
            var last = list[^1].key;
            return last == "none" ? null : last;
        }
    }

    private static IEnumerable<(string, double)> Weights(JsonElement e) => e.EnumerateObject().Select(p => (p.Name, p.Value.GetDouble()));
    private static float Round3(double v) => (float)Math.Round(v, 3, MidpointRounding.ToEven);

    /// <summary>face_types.face_for: the face of a person of a kind from their seed, sex (m/f) and age.</summary>
    public static Face FaceFor(uint seed, string kind, string sex, double age, string? origin = null)
    {
        var root = Types;
        var sliderList = sliders!.RootElement.GetProperty("sliders").EnumerateArray().ToList();
        if (root.GetProperty("cast").TryGetProperty(kind, out var cast)) // the named cast: one person, one fixed face
        {
            var s0 = sliderList.ToDictionary(s => s.GetProperty("name").GetString()!, _ => 0f);
            foreach (var p in cast.GetProperty("sliders").EnumerateObject()) s0[p.Name] = (float)p.Value.GetDouble();
            double ca = cast.GetProperty("age").GetDouble();
            s0["face_age"] = Round3(Math.Clamp((ca - 40) / 35.0, -0.6, 1.0));
            return new Face(cast.GetProperty("type").GetString()!, s0, cast.GetProperty("cell").GetString()!, cast.GetProperty("hair").GetString()!,
                Str(cast.GetProperty("beard")), Str(cast.GetProperty("moustache")), cast.TryGetProperty("crook", out var cr) ? (float)cr.GetDouble() : 0);
        }
        var rng = new Rng(Fnv1a($"{kind}:{seed}"));
        var types = root.GetProperty("types");
        string sx = age < 15 ? "c" : sex;
        var kt = root.GetProperty("kinds").TryGetProperty(kind, out var kk) ? Weights(kk).ToList()
            : (sex == "f" ? root.GetProperty("kinds").GetProperty("wife_a") : root.GetProperty("kinds").GetProperty("recipient")).EnumerateObject().Select(p => (p.Name, p.Value.GetDouble())).ToList();
        var cand = kt.Where(c => types.GetProperty(c.Item1).GetProperty("sex").GetString() is var s && (s == sx || s == "b")).ToList();
        if (origin != null)
        {
            var o = cand.Where(c => types.GetProperty(c.Item1).GetProperty("origin").GetString() == origin).ToList();
            if (o.Count == 0) o = types.EnumerateObject().Where(t => t.Value.GetProperty("origin").GetString() == origin && t.Value.GetProperty("sex").GetString() is var s2 && (s2 == sx || s2 == "b")).Select(t => (t.Name, 1.0)).ToList();
            if (o.Count > 0) cand = o;
        }
        if (cand.Count == 0) cand = types.EnumerateObject().Where(t => t.Value.GetProperty("sex").GetString() is var s3 && (s3 == sx || s3 == "b")).Select(t => (t.Name, 1.0)).ToList();
        string tname = rng.Pick(cand)!;
        var t = types.GetProperty(tname);
        double defSpread = root.GetProperty("defaultSpread").GetDouble();
        var bodySpread = root.GetProperty("bodySpread");
        var vals = new Dictionary<string, float>(StringComparer.Ordinal);
        foreach (var s in sliderList)
        {
            string name = s.GetProperty("name").GetString()!;
            bool face = s.GetProperty("group").GetString() == "face";
            double m = 0, sd = face ? defSpread : (bodySpread.TryGetProperty(name, out var bs) ? bs.GetDouble() : 0.25);
            var table = t.GetProperty(face ? "sliders" : "body");
            bool named = table.TryGetProperty(name, out var ms);
            if (named) { m = ms[0].GetDouble(); sd = ms[1].GetDouble(); }
            if ((name is "origin_african" or "origin_asian" or "eye_fold") && !named) { m = 0; sd = 0; }
            if (name == "bust" && sex != "f") { m = 0; sd = 0; }
            double g = rng.Gauss();
            double lo = s.GetProperty("oneWay").GetBoolean() ? 0.0 : -1.0;
            vals[name] = Round3(Math.Clamp(m + sd * g, lo, 1.0));
        }
        vals["face_age"] = age >= 15 ? Round3(Math.Clamp((age - 40) / 35.0, -0.6, 1.0)) : -0.3f;
        string hair;
        if (age < 15) hair = rng.Pick(new[] { (sex == "f" ? "plaits" : "crop", 1.0) })!;
        else
        {
            List<(string, double)> hw = root.GetProperty("kindHair").TryGetProperty(kind, out var kh) ? Weights(kh).ToList()
                : Weights(t.GetProperty("hair")).Where(h => (h.Item1 is "bun" or "plaits" or "coronet" or "undercap") == (sex == "f")).ToList();
            if (hw.Count == 0) hw = new() { (sex == "f" ? "bun" : "crop", 1.0) };
            hair = rng.Pick(hw)!;
        }
        var cells = CellsFor(t, sex, age, kind, hair);
        if (origin != null && age >= 15 && root.GetProperty("originCells").TryGetProperty(origin + "/" + sex, out var oc)) cells = oc.EnumerateArray().Select(e => e.GetString()!).ToList();
        string cell = cells[(int)(rng.Uniform() * cells.Count) % cells.Count];
        string? beard = sex == "m" && age >= 18 ? rng.Pick(Weights(t.GetProperty("beard"))) : null;
        string? mous = sex == "m" && age >= 17 ? rng.Pick(Weights(t.GetProperty("moustache"))) : null;
        if (beard == "full" && mous == null) mous = "walrus";
        double crookChance = t.GetProperty("extras").TryGetProperty("crook", out var cc) ? cc.GetDouble() : 0;
        float crook = rng.Uniform() < crookChance ? Round3(rng.Uniform()) : 0;
        return new Face(tname, vals, cell, hair, beard, mous, crook);
    }

    private static string? Str(JsonElement e) => e.ValueKind == JsonValueKind.String ? e.GetString() : null;

    private static List<string> CellsFor(JsonElement t, string sex, double age, string kind, string hair)
    {
        var root = Types;
        var all = root.GetProperty("cellOrder").EnumerateArray().Select(e => e.GetString()!).ToList();
        List<string> cells = root.GetProperty("kindCells").TryGetProperty(kind, out var kc) ? kc.EnumerateArray().Select(e => e.GetString()!).ToList()
            : t.GetProperty("cells").EnumerateArray().Select(e => e.GetString()!).ToList();
        List<string> Or(List<string> a, List<string> b) => a.Count > 0 ? a : b;
        if (age < 15)
        {
            cells = Or(cells.Where(c => c.StartsWith("c_", StringComparison.Ordinal)).ToList(), cells);
            cells = Or(cells.Where(c => c.StartsWith("c_girl", StringComparison.Ordinal) == (sex == "f")).ToList(), cells);
        }
        else if (age >= 58) cells = Or(cells.Where(c => c.StartsWith(sex == "m" ? "om_" : "of_", StringComparison.Ordinal)).ToList(), cells);
        else cells = Or(cells.Where(c => c.StartsWith(sex + "_", StringComparison.Ordinal)).ToList(), cells);
        var bald = cells.Where(c => c.Contains("bald", StringComparison.Ordinal)).ToList();
        if (hair == "bald") cells = Or(bald, cells); // Preserve age/sex even when no bald picture exists in that group.
        else cells = Or(cells.Where(c => !c.Contains("bald", StringComparison.Ordinal)).ToList(), cells);
        return cells;
    }

    /// <summary>Slider values to shape key weights (peopleSliders.json).</summary>
    public static Dictionary<string, float> KeyWeights(IReadOnlyDictionary<string, float> values)
    {
        Data();
        var w = new Dictionary<string, float>(StringComparer.Ordinal);
        foreach (var s in sliders!.RootElement.GetProperty("sliders").EnumerateArray())
        {
            string name = s.GetProperty("name").GetString()!;
            if (!values.TryGetValue(name, out float v) || v == 0) continue;
            var keys = s.GetProperty("keys");
            if (s.GetProperty("oneWay").GetBoolean()) w[keys[0].GetString()!] = Math.Max(0, v);
            else if (s.GetProperty("signed").GetBoolean() || v >= 0 || keys.GetArrayLength() < 2) w[keys[0].GetString()!] = v;
            else w[keys[1].GetString()!] = -v;
        }
        return w;
    }

    // ---------------------------------------------------------------- baking a person

    private sealed class Job
    {
        public string Id = "", Kind = "", Body = "";
        public Face Face = null!;
        public Dictionary<string, float> Weights = null!;
        public string RecipeKind = "", Sex = "m";
        public uint Seed;
        public double Age;
        public float Hands;
        public readonly List<Request> Users = new();
        public Task<Prepared>? Worker;
        public ArrayMesh? Far, Near;
        public double WorkerMs;
    }
    private sealed class Request
    {
        public Node3D Root = null!;
        public string Id = "";
        public Job Job = null!;
        public MeshInstance3D? Far, Near;
        public bool FarApplied, NearApplied;
    }
    private static readonly Dictionary<string, Job> cache = new(StringComparer.Ordinal);
    private static readonly List<Job> jobs = new();
    private static readonly List<Request> requests = new();
    private static readonly Dictionary<Node3D, Request> activeRequests = new();
    internal static double LastUploadMs { get; private set; }
    internal static int Pending => requests.Count;
    internal static double MaxWorkerMs { get; private set; }
    internal static long UploadCount { get; private set; }

    private static Prepared Compute(Job job, int lod)
    {
        long start = Stopwatch.GetTimestamp();
        if (job.Face == null)
        {
            job.Face = FaceFor(job.Seed == 0 ? 1 : job.Seed, job.RecipeKind, job.Sex, job.Age);
            job.Weights = KeyWeights(job.Face.Sliders);
            if (job.Weights.ContainsKey("s_eyes_open")) job.Weights["s_eyes_open"] -= 0.28f;
            else job.Weights["s_eyes_open_neg"] = job.Weights.GetValueOrDefault("s_eyes_open_neg") + 0.28f;
            if (job.Hands > 0) job.Weights["hands_hard"] = job.Hands;
        }
        var t = templates[job.Kind + "_lod" + lod];
        var pieces = new List<Template>();
        foreach (var (kind, style) in new[] { ("hair", job.Face.Hair), ("beard", job.Face.Beard), ("mous", job.Face.Moustache) })
            if (style != null && templates.TryGetValue($"{job.Body}_{kind}_{style}_lod{lod}", out var pt)) pieces.Add(pt);
        var (v, n) = Apply(t, job.Weights);
        var pv = new Vector3[pieces.Count][]; var pn = new Vector3[pieces.Count][];
        for (int i = 0; i < pieces.Count; i++) (pv[i], pn[i]) = Apply(pieces[i], job.Weights);
        var p = Prepare(t, v, n, t.C!, pieces.ToArray(), pv, pn);
        if (lod == 0)
        {
            p.Expressions = new Vector3[LiveKeys.Length][];
            p.ExpressionNormals = new Vector3[LiveKeys.Length][];
            for (int k = 0; k < LiveKeys.Length; k++)
            {
                var d = p.Expressions[k] = (Vector3[])p.V.Clone();
                var dn = p.ExpressionNormals[k] = (Vector3[])p.N.Clone();
                if (!t.Keys.TryGetValue(LiveKeys[k], out var key)) throw new InvalidDataException("Missing live people2 expression: " + t.Name + "/" + LiveKeys[k]);
                for (int i = 0; i < key.idx.Length; i++) { int vtx = key.idx[i]; d[vtx] += key.dp[i]; dn[vtx] = (dn[vtx] + key.dn[i]).Normalized(); }
            }
        }
        job.WorkerMs = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
        return p;
    }

    // Called once by People2Warmup's process. Never upload two meshes in one frame.
    internal static void Pump()
    {
        LastUploadMs = 0;
        bool workerBusy = false;
        for (int i = 0; i < jobs.Count; i++) if (jobs[i].Worker != null) { workerBusy = true; break; }
        for (int i = requests.Count - 1; i >= 0; i--)
        {
            var r = requests[i];
            if (!GodotObject.IsInstanceValid(r.Root)) { activeRequests.Remove(r.Root); requests.RemoveAt(i); r.Job.Users.Remove(r); continue; }
            if (!activeRequests.TryGetValue(r.Root, out var current) || !ReferenceEquals(current, r)) { requests.RemoveAt(i); r.Job.Users.Remove(r); continue; }
            if (!r.FarApplied && r.Job.Far != null)
            {
                if (r.Far != null) { r.Far.Mesh = r.Job.Far; r.Far.Visible = true; r.Far.VisibilityRangeBegin = r.Job.Near != null ? 15 : 0; }
                r.FarApplied = true;
                r.Root.SetMeta("face_type", r.Job.Face.Type); r.Root.SetMeta("face_cell", r.Job.Face.Cell);
                r.Root.SetMeta("face_hair", r.Job.Face.Hair + "/" + (r.Job.Face.Beard ?? "-") + "/" + (r.Job.Face.Moustache ?? "-"));
                People2Material.Face(r.Root, r.Job.Face.Cell);
            }
            if (r.FarApplied && !r.NearApplied && r.Job.Near != null)
            {
                if (r.Near != null) { r.Near.Mesh = r.Job.Near; r.Near.Visible = true; }
                if (r.Far != null) r.Far.VisibilityRangeBegin = 15;
                r.NearApplied = true;
            }
            if (r.NearApplied) { activeRequests.Remove(r.Root); requests.RemoveAt(i); r.Job.Users.Remove(r); }
        }
        for (int i = 0; i < jobs.Count; i++)
        {
            var j = jobs[i];
            if (j.Users.Count == 0 && j.Worker == null) { jobs.RemoveAt(i--); continue; }
            if (!workerBusy && j.Worker == null && j.Users.Count > 0)
            {
                bool close = j.Far == null;
                if (!close) foreach (var r in j.Users)
                    if (r.Root.IsInsideTree() && r.Root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition) < 225) { close = true; break; }
                if (close) { int lod = j.Far == null ? 1 : 0; j.Worker = Task.Run(() => Compute(j, lod)); workerBusy = true; }
            }
            if (j.Worker == null || !j.Worker.IsCompleted) continue;
            var p = j.Worker.GetAwaiter().GetResult(); j.Worker = null;
            long start = Stopwatch.GetTimestamp();
            var mesh = Upload(p);
            LastUploadMs = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            MaxWorkerMs = Math.Max(MaxWorkerMs, j.WorkerMs);
            BakeCount++; UploadCount++; BakeMs += LastUploadMs; MaxBakeMs = Math.Max(MaxBakeMs, LastUploadMs);
            if (j.Far == null) j.Far = mesh;
            else { j.Near = mesh; jobs.RemoveAt(i); }
            break;
        }
    }

    internal static void Warmup()
    {
        Data();
        if (!templates.ContainsKey("man_middling_lod0")) return;
        var j = new Job { Kind = "man_middling", Body = "man_middling", RecipeKind = "docker_a", Seed = 1873, Age = 30 };
        // JIT/first RenderingServer upload belongs to loading, never a resident spawn.
        foreach (int lod in new[] { 1, 0 }) { var p = Task.Run(() => Compute(j, lod)).GetAwaiter().GetResult(); using var mesh = Upload(p); }
    }

    private static (Vector3[] v, Vector3[] n) Apply(Template t, Dictionary<string, float> w)
    {
        var v = (Vector3[])t.V.Clone();
        var n = (Vector3[])t.N.Clone();
        bool moved = false;
        foreach (var (key, weight) in w)
        {
            if (weight == 0 || !t.Keys.TryGetValue(key, out var k)) continue;
            moved = true;
            for (int i = 0; i < k.idx.Length; i++)
            {
                int j = k.idx[i];
                v[j] += k.dp[i] * weight;
                n[j] += k.dn[i] * weight;
            }
        }
        if (moved) for (int i = 0; i < n.Length; i++) n[i] = n[i].LengthSquared() > 1e-12f ? n[i].Normalized() : t.N[i];
        return (v, n);
    }

    // ---------------------------------------------------------------- spawn

    internal static float PlayerSlider(Menu.Profile profile, Menu.Character.Shape shape)
    {
        return Math.Clamp(PlayerValue(profile, shape.Id), shape.Min, shape.Max);
    }
    internal static float PlayerValue(Menu.Profile profile, string id)
    {
        if (profile.Sliders.TryGetValue(id, out float explicitValue)) return explicitValue;
        if (id == "face_age") return Math.Clamp((profile.Age - 40) / 22f, -.6f, .9f);
        float? build = id switch {
            "weight" => profile.Build == "slight" ? -.6f : profile.Build == "stout" ? .6f : 0,
            "muscle" => profile.Build == "slight" ? -.4f : profile.Build == "stout" ? .1f : 0,
            "shoulders" => profile.Build == "slight" ? -.5f : profile.Build == "stout" ? .4f : 0,
            "hips_wide" => profile.Build == "slight" ? -.3f : profile.Build == "stout" ? .5f : 0,
            "belly" => profile.Build == "slight" ? -.5f : profile.Build == "stout" ? .7f : 0,
            "buttocks" => profile.Build == "stout" ? .4f : 0,
            "bust" => profile.Build == "slight" ? -.6f : profile.Build == "stout" ? .6f : 0, _ => null };
        if (build.HasValue) return build.Value;
        Data();
        if (!Types.GetProperty("types").TryGetProperty(profile.FaceType, out var preset)) preset = Types.GetProperty("types").GetProperty(profile.Sex == "woman" ? "young_woman" : "flemish_docker");
        foreach (string group in new[] { "sliders", "body" })
            if (preset.GetProperty(group).TryGetProperty(id, out var value)) return value[0].GetSingle();
        return 0;
    }

    /// <summary>One local player's explicit recipe. Never enters the resident identity queue or network cache.</summary>
    internal static void Player(Node3D root, Menu.Profile profile, bool arms)
    {
        Data();
        string kind = root.GetMeta("people2_mesh_kind").AsString();
        string body = root.GetMeta("people2_body").AsString();
        bool woman = profile.Sex == "woman";
        string type = profile.FaceType;
        var types = Types.GetProperty("types");
        if (!types.TryGetProperty(type, out var preset)) preset = types.GetProperty(woman ? "young_woman" : "flemish_docker");
        var values = new Dictionary<string, float>(StringComparer.Ordinal);
        foreach (string group in new[] { "sliders", "body" })
            foreach (var s in preset.GetProperty(group).EnumerateObject()) values[s.Name] = s.Value[0].GetSingle();
        foreach (var shape in Menu.Character.Shapes)
            values[shape.Id] = PlayerSlider(profile, shape);
        foreach (string id in new[] { "face_age", "buttocks", "bust" }) values[id] = PlayerValue(profile, id);
        string groupPrefix = profile.Age >= 46 ? woman ? "of" : "om" : woman ? "f" : "m";
        int hairHex = Menu.Character.HairColours.First(s => s.Id == profile.Hair.Colour).Hex;
        var chosenHair = new Vector3((hairHex >> 16 & 255) / 255f, (hairHex >> 8 & 255) / 255f, (hairHex & 255) / 255f);
        string cell = Types.GetProperty("cells").EnumerateObject().Where(c => c.Value.GetProperty("group").GetString() == groupPrefix)
            .OrderBy(c => { var rgb = c.Value.GetProperty("hairRgb"); return chosenHair.DistanceSquaredTo(new Vector3(rgb[0].GetSingle(), rgb[1].GetSingle(), rgb[2].GetSingle())); }).First().Name;
        string hair = profile.Hair.Style switch { "short" => "crop", "long" => "long", "balding" => "bald", _ => profile.Hair.Style };
        if (profile.Clothes.Head.Kind != "none") hair = woman ? "undercap" : "capped";
        string? beard = profile.Beard == "none" ? null : profile.Beard != "" ? profile.Beard : profile.Face switch { "beard" => "short", "whiskers" => "chops", _ => null };
        string? moustache = profile.Moustache == "none" ? null : profile.Moustache != "" ? profile.Moustache : profile.Face switch { "moustache" => "chevron", "walrus" or "beard" => "walrus", _ => null };
        var job = new Job { Kind = kind, Body = body, Face = new Face(type, values, cell, hair, beard, moustache, 0), Weights = KeyWeights(values) };
        job.Weights["hands_hard"] = woman ? .15f : .3f;
        var p = Compute(job, 0);
        // Rest-space palette regions must not move between hat/shirt/lower colours when a limb is posed.
        p.PlayerRegions = p.V.Select(v => new Vector2(v.Y, v.X)).ToArray();
        if (arms)
        {
            var template = p.Source;
            int inf = p.Weights!.Length / p.V.Length;
            var skeleton = root.GetNode<Skeleton3D>("Skeleton3D");
            // The view model starts just above the elbow, where its hidden cut stays behind the eye.
            float cut = skeleton.GetBoneGlobalRest(skeleton.FindBone("armLowL")).Origin.Y + .025f;
            bool ArmVertex(int v)
            {
                float weight = 0;
                for (int k = 0; k < inf; k++)
                {
                    int b = p.Bones![v * inf + k];
                    string name = b < template.BindNames.Length ? template.BindNames[b] : "";
                    if (name.StartsWith("armLow") || name.StartsWith("armTwist") || name.StartsWith("hand") || name.StartsWith("thumb") || name.StartsWith("index") || name.StartsWith("middle") || name.StartsWith("ring")) weight += p.Weights[v * inf + k];
                }
                return weight > .35f && p.V[v].Y < cut;
            }
            var index = new List<int>();
            for (int i = 0; i < p.Index!.Length; i += 3)
                if (ArmVertex(p.Index[i]) && ArmVertex(p.Index[i + 1]) && ArmVertex(p.Index[i + 2]))
                { index.Add(p.Index[i]); index.Add(p.Index[i + 1]); index.Add(p.Index[i + 2]); }
            CapOpenEnds(p, index, inf);
            p.Index = index.ToArray(); p.Expressions = null; p.ExpressionNormals = null;
            root.SetMeta("arm_triangles", index.Count / 3);
        }
        foreach (var n in BakedWorld.All(root).OfType<MeshInstance3D>().ToArray())
        {
            string name = n.Name.ToString();
            if (name == kind + "_lod0")
            { n.Mesh = Upload(p); n.Visible = true; n.VisibilityRangeBegin = n.VisibilityRangeEnd = 0; }
            else n.Visible = false;
        }
        People2Material.Face(root, cell);
        root.SetMeta("player_recipe", Menu.Character.ToJson(profile));
    }

    // The first-person sleeve is cut open at the elbow. When the upper arm points at the eye (ladder, oars)
    // the camera looks straight down that tube, so each open rim is closed with a fan to its centre.
    private static void CapOpenEnds(Prepared p, List<int> index, int inf)
    {
        var edges = new Dictionary<(int, int), int>();
        for (int i = 0; i < index.Count; i += 3)
            for (int k = 0; k < 3; k++) edges[(index[i + k], index[i + (k + 1) % 3])] = index[i + (k + 2) % 3];
        var next = new Dictionary<int, List<int>>();
        foreach (var (a, b) in edges.Keys)
            if (!edges.ContainsKey((b, a))) { if (!next.TryGetValue(a, out var l)) next[a] = l = new List<int>(); l.Add(b); }
        var seen = new HashSet<int>(); var loops = new List<List<int>>();
        foreach (int start in next.Keys.OrderBy(v => v))
        {
            if (seen.Contains(start)) continue;
            // Flood one connected rim (jagged cuts can branch; the fan only needs the vertex set and its edges).
            var group = new List<int>(); var stack = new Stack<int>(); stack.Push(start);
            while (stack.Count > 0)
            {
                int v = stack.Pop(); if (!seen.Add(v)) continue; group.Add(v);
                if (next.TryGetValue(v, out var outs)) foreach (int w in outs) stack.Push(w);
                foreach (var pair in next) if (pair.Value.Contains(v) && !seen.Contains(pair.Key)) stack.Push(pair.Key);
            }
            loops.Add(group);
        }
        if (loops.Count == 0) return;
        int count = p.V.Length, extra = loops.Count, tan = p.Tan != null ? p.Tan.Length / count : 0;
        Array.Resize(ref p.V, count + extra); Array.Resize(ref p.N, count + extra); Array.Resize(ref p.UV, count + extra);
        Array.Resize(ref p.C, count + extra);
        if (p.PlayerRegions != null) { var r = p.PlayerRegions; Array.Resize(ref r, count + extra); p.PlayerRegions = r; }
        var bones = p.Bones!; var weights = p.Weights!; var tangents = p.Tan;
        Array.Resize(ref bones, (count + extra) * inf); Array.Resize(ref weights, (count + extra) * inf);
        if (tangents != null) Array.Resize(ref tangents, (count + extra) * tan);
        for (int l = 0; l < loops.Count; l++)
        {
            var group = loops[l]; int centre = count + l, first = group[0];
            Vector3 sum = Vector3.Zero; foreach (int v in group) sum += p.V[v];
            p.V[centre] = sum / group.Count; p.N[centre] = Vector3.Up;
            p.UV[centre] = p.UV[first]; p.C[centre] = p.C[first];
            if (p.PlayerRegions != null) p.PlayerRegions[centre] = new Vector2(p.V[centre].Y, p.V[centre].X);
            for (int k = 0; k < inf; k++) { bones[centre * inf + k] = bones[first * inf + k]; weights[centre * inf + k] = weights[first * inf + k]; }
            if (tangents != null) for (int k = 0; k < tan; k++) tangents[centre * tan + k] = tangents[first * tan + k];
            foreach (int a in group)
                if (next.TryGetValue(a, out var outs)) foreach (int b in outs) { index.Add(b); index.Add(a); index.Add(centre); }
        }
        p.Bones = bones; p.Weights = weights; p.Tan = tangents;
    }

    internal static void Next(Human human)
    {
        int at = bags.GetValueOrDefault(human.Kind);
        bags[human.Kind] = at + 1;
        // A permutation per 22-person bag, rotated by kind. No repeats within a bag.
        int face = (int)((Hash(human.Kind) % 22 + (uint)(at % 22) * 7) % 22);
        human.Root.SetMeta("face_id", face);
        if (templates.Count > 0) SetIdentity(human.Root, human.Kind + "#" + at);
    }

    /// <summary>A person's face from their stable id: the same on every PC. Bakes their meshes and sets their face
    /// picture and skin tone.</summary>
    public static int SetIdentity(Node3D root, string stableId)
    {
        uint seed = Hash(stableId);
        int faceId = (int)(seed % 22);
        root.SetMeta("face_id", faceId);
        root.SetMeta("face_seed", (long)seed);
        People2Material.Tone(root, seed);
        if (!root.HasMeta("people2_kind")) return faceId;
        string kind = root.HasMeta("people2_kind") ? root.GetMeta("people2_kind").AsString() : root.Name.ToString();
        string body = root.HasMeta("people2_body") ? root.GetMeta("people2_body").AsString() : kind;
        if (templates.Count == 0 || !File.Exists(Paths.Shared("faceTypes.json"))) return faceId;
        string sex = root.HasMeta("people2_female") && root.GetMeta("people2_female").AsBool() ? "f" : "m";
        double age = body.StartsWith("old_", StringComparison.Ordinal) ? 62 + seed % 20 : body.StartsWith("child_", StringComparison.Ordinal) ? 7 + seed % 5 : 18 + seed % 38;
        float hands = root.HasMeta("people2_hands_hard") ? (float)root.GetMeta("people2_hands_hard").AsDouble() : 0;
        if (root.HasMeta("people2_identity") && root.GetMeta("people2_identity").AsString() == stableId) return faceId;
        root.SetMeta("people2_identity", stableId);
        string meshKind = root.GetMeta("people2_mesh_kind").AsString();
        string cacheId = stableId + "\n" + meshKind + "\n" + hands;
        if (!cache.TryGetValue(cacheId, out var job))
        {
            job = new Job { Id = cacheId, Kind = meshKind, Body = body, RecipeKind = kind, Sex = sex, Seed = seed, Age = age, Hands = hands };
            cache[cacheId] = job; jobs.Add(job);
            // Keep completed identities for respawns without retaining every resident ever seen.
            if (cache.Count > 128)
                foreach (var entry in cache)
                    if (entry.Value.Far != null && entry.Value.Worker == null && entry.Value.Users.Count == 0 && entry.Key != cacheId) { jobs.Remove(entry.Value); cache.Remove(entry.Key); break; }
        }
        else if (job.Near == null && !jobs.Contains(job)) jobs.Add(job);
        var request = new Request { Root = root, Id = stableId, Job = job };
        foreach (var n in BakedWorld.All(root).ToList())
        {
            if (n is not MeshInstance3D mi) continue;
            string name = mi.Name.ToString();
            if (name.Contains("_hair_") || name.Contains("_beard_") || name.Contains("_mous_")) { mi.GetParent()?.RemoveChild(mi); mi.QueueFree(); }
            else if (name.EndsWith("_lod0")) { request.Near = mi; mi.Visible = false; }
            else if (name.EndsWith("_lod1")) { request.Far = mi; mi.Visible = true; mi.VisibilityRangeBegin = 0; }
        }
        job.Users.Add(request); requests.Add(request); activeRequests[root] = request;
        return faceId;
    }

    /// <summary>Set live shape keys (tests and a future character creator on an unbaked mesh). Reset omitted
    /// weights; do not clamp authored weights.</summary>
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

    /// <summary>The face_types.json test vectors, recomputed: how many agree (type, cell, hair, sliders within 1e-3).</summary>
    internal static (int ok, int total) SelfTest()
    {
        var root = Types;
        int ok = 0, total = 0;
        foreach (var t in root.GetProperty("tests").EnumerateArray())
        {
            total++;
            var a = t.GetProperty("args");
            var f = FaceFor((uint)a.GetProperty("seed").GetInt64(), a.GetProperty("kind").GetString()!, a.GetProperty("sex").GetString()!, a.GetProperty("age").GetDouble());
            var e = t.GetProperty("face");
            string expectedCell = e.GetProperty("cell").GetString()!;
            bool cellOkay = f.Cell == expectedCell;
            bool same = f.Type == e.GetProperty("type").GetString() && cellOkay && f.Hair == e.GetProperty("hair").GetString()
                && f.Beard == Str(e.GetProperty("beard")) && f.Moustache == Str(e.GetProperty("moustache"));
            foreach (var p in e.GetProperty("sliders").EnumerateObject())
                if (!f.Sliders.TryGetValue(p.Name, out float v) || Math.Abs(v - p.Value.GetDouble()) > 1.5e-3) same = false;
            if (same) ok++;
            else GD.Print($"people2 face test differs: {a} -> {f.Type} {f.Cell} {f.Hair} {f.Beard} {f.Moustache} {string.Join(",", f.Sliders.Where(kv => e.GetProperty("sliders").TryGetProperty(kv.Key, out var x) && Math.Abs(x.GetDouble() - kv.Value) > 1.5e-3).Select(kv => kv.Key + "=" + kv.Value))}");
        }
        return (ok, total);
    }

    internal static int Templates => templates.Count;
    internal static (int bald, int wrongAge) YoungBaldTest()
    {
        int bald = 0, wrong = 0;
        for (uint seed = 1; seed <= 512; seed++)
        {
            var f = FaceFor(seed, "docker_a", "m", 25 + seed%25);
            if (f.Hair != "bald") continue;
            bald++;
            if (!f.Cell.StartsWith("m_", StringComparison.Ordinal)) wrong++;
        }
        return (bald, wrong);
    }
}

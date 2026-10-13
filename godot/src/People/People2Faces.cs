using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    private static readonly Dictionary<string, Template> templates = new(StringComparer.Ordinal);
    private static JsonDocument? faceTypes, sliders;
    private static readonly Dictionary<string, int> faceLayers = new(StringComparer.Ordinal);
    internal static long BakeCount { get; private set; }
    internal static double BakeMs { get; private set; }
    internal static double MaxBakeMs { get; private set; }

    internal static void Forget()
    {
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
    internal static void LoadMorphs()
    {
        morphFile = null;
        if (!Godot.FileAccess.FileExists(People2Morphs.File)) return;
        morphFile = People2Morphs.Read(Godot.FileAccess.GetFileAsBytes(People2Morphs.File));
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
        t.C = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? new Color[t.V.Length] : arrays[(int)Mesh.ArrayType.Color].AsColorArray();
        if (t.C.Length != t.V.Length) t.C = new Color[t.V.Length];
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
                t.C[v] = new Color(eye > 0.5f ? 1 : 0, t.C[v].G, t.C[v].B, 1);
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

    private static ArrayMesh Build(Template t, Vector3[] v, Vector3[] n, Color[] c, Template[]? pieces = null, Vector3[][]? pv = null, Vector3[][]? pn = null)
    {
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        if (pieces == null || pieces.Length == 0)
        {
            a[(int)Mesh.ArrayType.Vertex] = v; a[(int)Mesh.ArrayType.Normal] = n;
            if (t.Tan != null) a[(int)Mesh.ArrayType.Tangent] = t.Tan;
            a[(int)Mesh.ArrayType.TexUV] = t.UV!; a[(int)Mesh.ArrayType.Color] = c;
            if (t.Bones is { Length: > 0 } && t.Weights is { Length: > 0 }) { a[(int)Mesh.ArrayType.Bones] = t.Bones; a[(int)Mesh.ArrayType.Weights] = t.Weights; }
            if (t.Index.Length > 0) a[(int)Mesh.ArrayType.Index] = t.Index;
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
            a[(int)Mesh.ArrayType.Vertex] = V; a[(int)Mesh.ArrayType.Normal] = N;
            if (Tan != null) a[(int)Mesh.ArrayType.Tangent] = Tan;
            a[(int)Mesh.ArrayType.TexUV] = UV; a[(int)Mesh.ArrayType.Color] = C;
            a[(int)Mesh.ArrayType.Bones] = B; a[(int)Mesh.ArrayType.Weights] = W; a[(int)Mesh.ArrayType.Index] = I;
        }
        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a, flags: t.Format & Mesh.ArrayFormat.FlagUse8BoneWeights);
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
        return bindMaps[(piece.Name, body.Name)] = m;
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
        if (hair == "bald") cells = Or(bald, all.Where(c => c.Contains("bald", StringComparison.Ordinal)).ToList());
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

    /// <summary>Bake a person's near and far meshes once: the body's (or kind's) mesh, the chosen pieces of the
    /// base body merged in, every slider's move added. Returns the number of meshes baked.</summary>
    internal static int Bake(Node3D root, string kindName, string baseBody, Face face, float handsHard)
    {
        ulong t0 = Time.GetTicksUsec();
        var w = KeyWeights(face.Sliders);
        if (handsHard > 0) w["hands_hard"] = handsHard;
        int baked = 0;
        var pieceNodes = new List<MeshInstance3D>();
        foreach (var n in BakedWorld.All(root).ToList())
        {
            if (n is not MeshInstance3D mi) continue;
            string name = mi.Name.ToString();
            if (name.Contains("_hair_", StringComparison.Ordinal) || name.Contains("_beard_", StringComparison.Ordinal) || name.Contains("_mous_", StringComparison.Ordinal)) { pieceNodes.Add(mi); continue; }
            int lod = name.EndsWith("_lod0", StringComparison.Ordinal) ? 0 : name.EndsWith("_lod1", StringComparison.Ordinal) ? 1 : -1;
            if (lod < 0 || !templates.TryGetValue(name, out var t)) continue;
            var pieces = new List<Template>();
            foreach (var (kind, style) in new[] { ("hair", face.Hair), ("beard", face.Beard), ("mous", face.Moustache) })
                if (style != null && templates.TryGetValue($"{baseBody}_{kind}_{style}_lod{lod}", out var pt)) pieces.Add(pt);
            var (v, nrm) = Apply(t, w);
            var pv = new Vector3[pieces.Count][]; var pn = new Vector3[pieces.Count][];
            for (int p = 0; p < pieces.Count; p++) (pv[p], pn[p]) = Apply(pieces[p], w);
            mi.Mesh = Build(t, v, nrm, t.C!, pieces.ToArray(), pv, pn);
            baked++;
        }
        foreach (var mi in pieceNodes) { mi.GetParent()?.RemoveChild(mi); mi.QueueFree(); }
        root.SetMeta("face_type", face.Type);
        root.SetMeta("face_cell", face.Cell);
        root.SetMeta("face_hair", face.Hair + "/" + (face.Beard ?? "-") + "/" + (face.Moustache ?? "-"));
        double ms = (Time.GetTicksUsec() - t0) / 1000.0;
        BakeCount++; BakeMs += ms; MaxBakeMs = Math.Max(MaxBakeMs, ms);
        return baked;
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

    internal static void Next(Human human)
    {
        int at = bags.GetValueOrDefault(human.Kind);
        bags[human.Kind] = at + 1;
        // A permutation per 22-person bag, rotated by kind. No repeats within a bag.
        int face = (int)((Hash(human.Kind) % 22 + (uint)(at % 22) * 7) % 22);
        human.Root.SetMeta("face_id", face);
        if (People2.Enabled && templates.Count > 0) SetIdentity(human.Root, human.Kind + "#" + at);
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
        string kind = root.HasMeta("people2_kind") ? root.GetMeta("people2_kind").AsString() : root.Name.ToString();
        string body = root.HasMeta("people2_body") ? root.GetMeta("people2_body").AsString() : kind;
        if (templates.Count == 0 || !File.Exists(Paths.Shared("faceTypes.json"))) return faceId;
        string sex = root.HasMeta("people2_female") && root.GetMeta("people2_female").AsBool() ? "f" : "m";
        double age = body.StartsWith("old_", StringComparison.Ordinal) ? 62 + seed % 20 : body.StartsWith("child_", StringComparison.Ordinal) ? 7 + seed % 5 : 18 + seed % 38;
        var face = FaceFor(seed == 0 ? 1 : seed, kind, sex, age);
        float hands = root.HasMeta("people2_hands_hard") ? (float)root.GetMeta("people2_hands_hard").AsDouble() : 0;
        Bake(root, kind, body, face, hands);
        People2Material.Face(root, face.Cell);
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
            bool same = f.Type == e.GetProperty("type").GetString() && f.Cell == e.GetProperty("cell").GetString() && f.Hair == e.GetProperty("hair").GetString()
                && f.Beard == Str(e.GetProperty("beard")) && f.Moustache == Str(e.GetProperty("moustache"));
            foreach (var p in e.GetProperty("sliders").EnumerateObject())
                if (!f.Sliders.TryGetValue(p.Name, out float v) || Math.Abs(v - p.Value.GetDouble()) > 1.5e-3) same = false;
            if (same) ok++;
            else GD.Print($"people2 face test differs: {a} -> {f.Type} {f.Cell} {f.Hair} {f.Beard} {f.Moustache} {string.Join(",", f.Sliders.Where(kv => e.GetProperty("sliders").TryGetProperty(kv.Key, out var x) && Math.Abs(x.GetDouble() - kv.Value) > 1.5e-3).Select(kv => kv.Key + "=" + kv.Value))}");
        }
        return (ok, total);
    }

    internal static int Templates => templates.Count;
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #174: the town's shop fronts, shop windows and front doors (and #28: the Carolus's doors, round windows and louvres).
/// The bake drew a shop window as a painted pane of jars on a shelf, a front door as a painted leaf, and a wooden shop front as
/// plain boxes; those are gone (scripts/repair-shopfronts.py) and every window and door leaf is listed in
/// world/town/facades/shopfronts.json. Each part is a copy of one model per part (assets/models/shopfronts,
/// scripts/build_shopfronts.py): pilasters, the fascia and cornice, the panelled stall riser and sill, the window's frame with
/// its mullions and fanlight, the glass, the display behind it (bed, two shelves, back board, a cloth and a valance), and a
/// panelled door leaf with its brass knob and letter plate. The goods in a window are its trade's (assets/models/shopgoods,
/// scripts/shop_goods.py: one model per good; the fish are the market's own models), with price cards and a hanging oil lamp.
///
/// Drawing: the fronts, frames, glass and doors of a block are put together into one mesh per material when the town loads
/// (a few draws a block, shown within its near range, <see cref="NativeNearDetail"/>); the displays and goods stand behind the
/// glass and are MultiMeshes per 30 m cell, drawn nearer (<see cref="GoodsNear"/>). Paint: the shutters' painted wood (kept, or
/// flaking on a worn house). In the evening a lit shop's window (its hours: the bake's lit pane over it) shows its goods in its
/// lamp's light: a cell's lit windows change to a lit copy of their meshes whose materials give back the lamp's warm light (no
/// light of Godot's is made). A part on a razed house is left out. <c>--shopfronts-file &lt;json&gt;</c> reads another list;
/// <c>--no-shopfronts</c> draws none.
/// </summary>
public static partial class NativeShopFronts
{
    public const string File = "res://world/town/facades/shopfronts.json";
    private const string Models = "res://assets/models/shopfronts/";
    private const string Goods = "res://assets/models/shopgoods/";
    private const string Worn = "res://assets/materials/town-facades-20261018/shutter-paint-worn.tres";
    private const float WornFrom = NativeShutters.WornFrom;
    /// <summary>Metres past a cell's own radius within which its windows' displays and goods are drawn (seen through glass, near).</summary>
    public const float GoodsNear = 20f;
    private const float Cell = 30f;
    /// <summary>The lamp-lit goods' warm light (the street's oil lamps' colour), and the lamp glass's.</summary>
    private static readonly Color LampLight = new(1.0f, 0.62f, 0.3f), LampGlass = new(1.0f, 0.78f, 0.5f);
    private const float Lit = 0.2f; // (a display's lamp light over its parts' pictures)

    private sealed record Front(float P, float[] Paint, float Wear);
    private sealed record Item(string M, float X, float Y, float Z, float R);
    private sealed record Window(string Chunk, float[] At, float[] X, float[] N, float W, string Bucket, float Wear, string Trade, Front? Front, float[] Sash, float[]? Lit, Item[] Goods);
    private sealed record Door(string Chunk, float[] Hinge, float[] Along, float[] X, float[] N, float W, float H, string Model, float[] Paint, float Wear, bool Knob, bool Letterplate);
    /// <summary>#28: a part of the Carolus, placed by its middle (`Centred`: the model's own middle along x), fitted by Sx and Sy.</summary>
    private sealed record Part(string Model, float[] At, float[] X, float[] N, float Sx, float Sy, float[] Paint, float Centred = 0);
    private sealed record Doc(Window[] Windows, Door[] Doors, Part[]? Parts);

    /// <summary>A cell's lit windows' copies: their meshes and lit meshes, and the hours the lamps burn.</summary>
    private sealed class LitSet
    {
        public float From, To;
        public readonly List<(MultiMesh Mm, Mesh Day, Mesh Lit)> Copies = new();
        public bool On;
    }
    private static readonly List<LitSet> litSets = new();
    public static (int Windows, int Doors, int Goods, int Meshes, int Sets, int LitWindows) Counts { get; private set; }

    public static int Install(Node3D town, NativeRazedHouses.Result razed, string? path = null)
    {
        path ??= File;
        if (Scheldemist.Main.I.Flag("no-shopfronts")) return 0;
        if (!Godot.FileAccess.FileExists(path) && !System.IO.File.Exists(path)) return 0;
        string text = path.StartsWith("res://", StringComparison.Ordinal) ? Godot.FileAccess.GetFileAsString(path) : System.IO.File.ReadAllText(path);
        var doc = JsonSerializer.Deserialize<Doc>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var meshes = new Dictionary<string, Mesh>();
        Mesh Model(string name)
        {
            if (meshes.TryGetValue(name, out var m)) return m;
            if (name.StartsWith("fish:", StringComparison.Ordinal)) return meshes[name] = Fish(name[5..]);
            return meshes[name] = ResourceLoader.Load<Mesh>((IsKit(name) ? Models : Goods) + name + ".res");
        }
        var worn = ResourceLoader.Load<Material>(Worn);
        // the outside parts, by block: put together into one mesh a block; the inside ones, by cell and lit group: MultiMeshes
        var outside = new Dictionary<string, List<(string Model, Transform3D At, Color Colour, bool Worn)>>();
        // (a lit window's boards and cloths each by their colour: a lamp's light shows their own colour, not their picture's)
        var inside = new Dictionary<(string Cell, string Model, string Group, Color Tint), List<(Transform3D At, Color Colour)>>();
        var cellLit = new Dictionary<string, List<(float From, float To)>>();
        void Out(string chunk, string model, Transform3D at, Color c, bool w)
        {
            if (!outside.TryGetValue(chunk, out var list)) outside[chunk] = list = new();
            list.Add((model, at, c, w));
        }
        void In(string cell, string model, string group, Transform3D at, Color c, bool tinted = false)
        {
            var key = (cell, model, group, tinted && group != "" ? c : Colors.White);
            if (!inside.TryGetValue(key, out var list)) inside[key] = list = new();
            list.Add((at, c));
        }
        static Vector3 V(float[] a) => new(a[0], a[1], a[2]);
        static Color C(float[] a) => new(a[0], a[1], a[2]);
        static Color Faded(Color c) { float g = c.R * 0.3f + c.G * 0.59f + c.B * 0.11f; return c.Lerp(new Color(g, g, g), 0.25f); }
        int windows = 0, doors = 0, goods = 0, left = 0;
        foreach (var w in doc.Windows)
        {
            Vector3 at = V(w.At), x = V(w.X), n = V(w.N), up = Vector3.Up;
            if (razed.Owned(at.X, at.Z)) { left++; continue; }
            float wb = int.Parse(w.Bucket) / 100f;
            var frame = new Basis(x, up, n);
            Transform3D Part(float widthScale) => new(new Basis(x * widthScale, up, n), at);
            // the wooden front: pilasters either side, the fascia and cornice over, the stall riser and sill under
            if (w.Front is { } f)
            {
                bool fw = f.Wear > WornFrom; var paint = fw ? Faded(C(f.Paint)) : C(f.Paint);
                foreach (int s in new[] { -1, 1 })
                    Out(w.Chunk, "pilaster", new Transform3D(new Basis(x * (f.P / 0.13f), up, n), at + x * s * (w.W / 2 + f.P / 2)), paint, fw);
                Out(w.Chunk, "head_" + w.Bucket, Part((w.W + 2 * f.P + 0.08f) / (wb + 0.34f)), paint, fw);
                Out(w.Chunk, "stall_" + w.Bucket, Part(w.W / wb), paint, fw);
            }
            bool sw = w.Wear > WornFrom; var sash = sw ? Faded(C(w.Sash)) : C(w.Sash);
            Out(w.Chunk, "sash_" + w.Bucket, Part(w.W / wb), sash, sw);
            Out(w.Chunk, "glass_" + w.Bucket, Part(w.W / wb), Colors.White, false);
            // the display: lit in the evening when the shop keeps a lamp burning
            string cell = $"{MathF.Floor(at.X / Cell)},{MathF.Floor(at.Z / Cell)}";
            string group = "";
            if (w.Lit is { Length: 2 } lit)
            {
                group = "lit";
                if (!cellLit.TryGetValue(cell, out var hours)) cellLit[cell] = hours = new();
                hours.Add((lit[0], lit[1]));
            }
            var dark = new Color(0.2f, 0.13f, 0.08f); // (the display's boards: a dark varnish)
            In(cell, "display_" + w.Bucket, group, Part(w.W / wb), dark, true);
            var dye = Dye(w.Trade, w.At[0] + w.At[2]);
            In(cell, "cloth_" + w.Bucket, group, Part(w.W / wb), dye, true);
            In(cell, "valance_" + w.Bucket, group, Part(w.W / wb), dye, true);
            foreach (var g in w.Goods)
            {
                var b = frame * new Basis(Vector3.Up, g.R);
                float tone = 0.92f + 0.16f * Hash(w.At[0] + g.X, w.At[2] + g.Z);
                In(cell, g.M, group, new Transform3D(b, at + x * g.X + up * g.Y + n * g.Z), new Color(tone, tone, tone));
                goods++;
            }
            windows++;
        }
        foreach (var d in doc.Doors)
        {
            Vector3 hinge = V(d.Hinge), along = V(d.Along), x = V(d.X), n = V(d.N), up = Vector3.Up;
            if (razed.Owned(hinge.X, hinge.Z)) { left++; continue; }
            var size = Model(d.Model).GetMeta("part_size").AsVector3();
            bool dw = d.Wear > WornFrom; var paint = dw ? Faded(C(d.Paint)) : C(d.Paint);
            // the leaf's model runs from its hinge at x = 0 to x = W: placed by its middle, it is the same both ways across
            var basis = new Basis(x * (d.W / size.X), up * (d.H / size.Y), n);
            Out(d.Chunk, d.Model, new Transform3D(basis, hinge + along * (d.W / 2) - x * (d.W / 2)), paint, dw);
            if (d.Knob) Out(d.Chunk, "knob", new Transform3D(new Basis(x, up, n), hinge + along * (d.W - 0.075f) + up * 1.0f + n * 0.05f), Colors.White, false);
            if (d.Letterplate) Out(d.Chunk, "letterplate", new Transform3D(new Basis(x, up, n), hinge + along * (d.W / 2) + up * (d.H * 0.42f) + n * 0.05f), Colors.White, false);
            doors++;
        }
        foreach (var p in doc.Parts ?? Array.Empty<Part>())
        {
            Vector3 x = V(p.X), n = V(p.N);
            Out("carolus", p.Model, new Transform3D(new Basis(x * p.Sx, Vector3.Up * p.Sy, n), V(p.At) - x * (p.Centred * p.Sx)), C(p.Paint), false);
        }
        var holder = new Node3D { Name = "shop_fronts" };
        town.AddChild(holder);
        // the outside: one mesh a block, one surface per material (the worn paint its own)
        int mergedMeshes = 0;
        foreach (var (chunk, list) in outside.OrderBy(o => o.Key))
        {
            var mesh = Merge(list.Select(l => (Model(l.Model), l.At, l.Colour, l.Worn ? worn : null)));
            var aabb = mesh.GetAabb();
            var node = new MeshInstance3D
            {
                Name = "shopfronts_" + chunk, Mesh = mesh, VisibilityRangeEnd = aabb.Size.Length() * 0.5f + NativeNearDetail.Near,
                VisibilityRangeEndMargin = NativeNearDetail.Fade, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            };
            // (their collision is the plain boxes repair-shopfronts.py added to the blocks' stand-ins: Solid leaves this out)
            node.SetMeta(NativeNearDetail.NoCollision, true);
            holder.AddChild(node);
            mergedMeshes++;
        }
        // the inside: MultiMeshes per cell, model and lit group; a cell's lit windows share its lamps' hours
        litSets.Clear();
        var byCell = new Dictionary<string, LitSet>();
        int sets = 0;
        foreach (var ((cell, model, group, tint), list) in inside.OrderBy(s => s.Key.Cell).ThenBy(s => s.Key.Model).ThenBy(s => s.Key.Group).ThenBy(s => s.Key.Tint.ToHtml()))
        {
            var mesh = Model(model);
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = mesh, InstanceCount = list.Count };
            var box = new Aabb(list[0].At.Origin, Vector3.Zero);
            for (int i = 0; i < list.Count; i++) { mm.SetInstanceTransform(i, list[i].At); mm.SetInstanceColor(i, list[i].Colour); box = box.Expand(list[i].At.Origin); }
            holder.AddChild(new MultiMeshInstance3D
            {
                Name = $"shopgoods_{cell}_{model}{(group == "" ? "" : "_lit")}{(tint == Colors.White ? "" : "_" + tint.ToHtml(false))}", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                VisibilityRangeEnd = box.Size.Length() * 0.5f + 2f + GoodsNear, VisibilityRangeEndMargin = 6f,
                VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            });
            sets++;
            if (group != "")
            {
                if (!byCell.TryGetValue(cell, out var ls))
                {
                    // (the hours most of the cell's lit shops keep: the middle of their openings and closings)
                    var h = cellLit[cell]; var froms = h.Select(t => t.From).OrderBy(v => v).ToArray(); var tos = h.Select(t => t.To).OrderBy(v => v).ToArray();
                    byCell[cell] = ls = new LitSet { From = froms[froms.Length / 2], To = tos[tos.Length / 2] }; litSets.Add(ls);
                }
                ls.Copies.Add((mm, mesh, LitMesh(mesh, tint)));
            }
        }
        holder.AddChild(new Lamps { Name = "shop_window_lamps" });
        int litWindows = cellLit.Values.Sum(v => v.Count);
        Counts = (windows, doors, goods, mergedMeshes, sets, litWindows);
        GD.Print($"shop fronts: {windows} windows, {doors} door leaves, {goods} goods ({left} on razed houses left out); {mergedMeshes} block meshes, {sets} goods sets; {litWindows} windows lit in the evening in {litSets.Count} cells");
        return windows + doors;
    }

    private static readonly string[] Kit = { "pilaster", "head_", "stall_", "sash_", "glass_", "display_", "valance_", "cloth_", "door_", "knob", "letterplate", "church_door", "fanlight", "oculus", "louvre" };
    /// <summary>A part of the front kit (build_shopfronts.py), else one of the goods (shop_goods.py).</summary>
    private static bool IsKit(string model) => Kit.Any(k => model.StartsWith(k, StringComparison.Ordinal));
    private static float Hash(float a, float b) { float h = MathF.Sin(a * 12.9898f + b * 78.233f) * 43758.547f; return h - MathF.Floor(h); }
    /// <summary>The display cloth's dye: the trade's (a draper's or a hatter's a deep velvet), a little of the street's own.</summary>
    private static Color Dye(string trade, float seed)
    {
        Color[] dyes = { new(0.45f, 0.08f, 0.08f), new(0.1f, 0.25f, 0.14f), new(0.16f, 0.18f, 0.36f), new(0.55f, 0.45f, 0.3f), new(0.38f, 0.1f, 0.22f) };
        int k = trade switch { "bakery" or "grocer" or "corn" => 3, "chemist" or "clockmaker" => 1, "draper" or "hatter" => 4, "tobacco" or "wine" or "tavern" => 0, _ => (int)(Hash(seed, 3.1f) * dyes.Length) % dyes.Length };
        return dyes[k];
    }

    /// <summary>Copies of models put together into one mesh: each copy's surfaces moved into place, its colour into the vertex
    /// colour, one surface per material (a worn copy's paint surfaces on the worn paint material).</summary>
    private static ArrayMesh Merge(IEnumerable<(Mesh Mesh, Transform3D At, Color Colour, Material? Paint)> copies)
    {
        var parts = new Dictionary<Material, (List<Vector3> P, List<Vector3> N, List<Vector2> Uv, List<Color> C, List<int> I)>();
        var cache = new Dictionary<(Mesh, int), (Vector3[] P, Vector3[] N, Vector2[] Uv, Color[] C, int[] I)>();
        foreach (var (mesh, at, colour, paint) in copies)
        {
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (!cache.TryGetValue((mesh, s), out var a))
                {
                    var arr = mesh.SurfaceGetArrays(s);
                    var p = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    cache[(mesh, s)] = a = (p, arr[(int)Mesh.ArrayType.Normal].AsVector3Array(), arr[(int)Mesh.ArrayType.TexUV].AsVector2Array(),
                        arr[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? Enumerable.Repeat(Colors.White, p.Length).ToArray() : arr[(int)Mesh.ArrayType.Color].AsColorArray(),
                        arr[(int)Mesh.ArrayType.Index].AsInt32Array());
                }
                var mat = mesh.SurfaceGetMaterial(s);
                if (paint != null && mat is ShaderMaterial sm && sm.ResourceName.StartsWith("shutter_paint", StringComparison.Ordinal)) mat = paint;
                if (!parts.TryGetValue(mat, out var t)) parts[mat] = t = (new(), new(), new(), new(), new());
                int baseIndex = t.P.Count; var nb = at.Basis.Inverse().Transposed();
                for (int i = 0; i < a.P.Length; i++)
                {
                    t.P.Add(at * a.P[i]); t.N.Add((nb * a.N[i]).Normalized()); t.Uv.Add(a.Uv[i]); t.C.Add(a.C[i] * colour);
                }
                foreach (int i in a.I) t.I.Add(baseIndex + i);
            }
        }
        var merged = new ArrayMesh();
        foreach (var (mat, t) in parts)
        {
            var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = t.P.ToArray(); arrays[(int)Mesh.ArrayType.Normal] = t.N.ToArray(); arrays[(int)Mesh.ArrayType.TexUV] = t.Uv.ToArray();
            arrays[(int)Mesh.ArrayType.Color] = t.C.ToArray(); arrays[(int)Mesh.ArrayType.Index] = t.I.ToArray();
            merged.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, Mesh.ArrayFormat.FlagCompressAttributes);
            merged.SurfaceSetMaterial(merged.GetSurfaceCount() - 1, mat);
        }
        return merged;
    }

    /// <summary>The market's own fish (smallgoods' cod and plaice, workgoods' herring): one model per kind, as on the fish tables.</summary>
    private static Mesh Fish(string kind)
    {
        var copy = kind == "herring" ? Scheldemist.Play.WorkGoods.Copy("held_fish")
            : Scheldemist.Models.ModelLibrary.Get("smallgoods", Scheldemist.Play.WorkGoods.Look)?.Copy(kind);
        var mi = copy == null ? null : BakedWorld.All(copy).OfType<MeshInstance3D>().FirstOrDefault(m => m.Mesh != null);
        var mesh = mi?.Mesh is { } m0 ? (Mesh)m0.Duplicate() : new ArrayMesh();
        if (mi != null && mesh is ArrayMesh am)
            for (int s = 0; s < am.GetSurfaceCount(); s++) if (mi.GetActiveMaterial(s) is { } mat) am.SurfaceSetMaterial(s, mat);
        copy?.QueueFree();
        return mesh;
    }

    private static readonly Dictionary<(Material, Color), Material> litMaterials = new();
    /// <summary>The same model with lit materials: each gives back the lamp's warm light over its own picture times its tint
    /// (the copies' own colour: the lit emission leaves the vertex colour out), the lamp's glass glowing; on the material's
    /// own shader (no new shader kind).</summary>
    private static Mesh LitMesh(Mesh day, Color tint)
    {
        if (day is not ArrayMesh am) return day;
        var lit = (ArrayMesh)am.Duplicate();
        for (int s = 0; s < lit.GetSurfaceCount(); s++)
        {
            var m = am.SurfaceGetMaterial(s);
            if (m is not ShaderMaterial sm) continue;
            if (!litMaterials.TryGetValue((sm, tint), out var made))
            {
                var c = (ShaderMaterial)sm.Duplicate();
                bool glow = sm.ResourceName.EndsWith("_glow", StringComparison.Ordinal);
                var col = glow ? LampGlass * 2.6f : LampLight * Lit * tint;
                c.SetShaderParameter("emission", new Vector3(col.R, col.G, col.B));
                if (sm.GetShaderParameter("tex").Obj is Texture2D tex) c.SetShaderParameter("emission_tex", tex);
                c.SetShaderParameter("fill", 0.0f);
                c.ResourceName = sm.ResourceName + "_lit";
                litMaterials[(sm, tint)] = made = c;
            }
            lit.SurfaceSetMaterial(s, made);
        }
        return lit;
    }

    /// <summary>Turns a cell's lit windows to their lit copies while the shops' lamps burn (their hours, after dark).</summary>
    private sealed partial class Lamps : Node
    {
        private double t;
        public override void _Process(double delta)
        {
            t += delta;
            if (t < 0.5) return;
            t = 0;
            var day = Daylight.I;
            if (day == null) return;
            float hourN = day.Hour < 12 ? day.Hour + 24 : day.Hour;
            foreach (var s in litSets)
            {
                bool on = day.Night > 0.25f && hourN >= s.From && hourN < s.To;
                if (on == s.On) continue;
                s.On = on;
                foreach (var (mm, dayMesh, litMesh) in s.Copies) mm.Mesh = on ? litMesh : dayMesh;
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Native.Authoring;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issues #149, #160, #164: the town's street pumps, horse troughs, cellar hatches and washing. The bake drew them as plain
/// boxes and flat cloth cards inside the street-life and clutter meshes (taken out: scripts/repair_street_furniture.py) and
/// as the courts' pump copies in the churches group (hidden here); world/town/furniture/street-furniture.json
/// (scripts/plan_street_furniture.py) says where each new one stands.
/// - Pumps: the street-props kit's cast-iron pump with its stone basin, one model everywhere, as authored objects (their
///   own collision); the court pumps keep their places, so the washerwomen and the pump sounds find them as before.
/// - Hatches: the kit's cellar hatch against its house, flush with the paving (its frame 3 mm proud), walkable.
/// - Troughs: the blue-stone horse trough (the laundry pack), solid as a box.
/// - Washing: one model per piece (shirt, shift, trousers, apron, stockings, sheet, towel), copied along each line with its
///   own tint, pegged with the one wooden peg; the line a hemp rope sagging between two iron rings on the walls; the wash
///   poles out of windows. Copies are MultiMeshes per 32 m cell, near-range only; none is solid (all over head height).
///   The cloth sways in the wind and darkens in the rain (its material: Psx's wet-paint kind with cloth_sway, wet_paint).
/// <c>--street-furniture-file &lt;json&gt;</c> reads another plan; <c>--keep-old-street-furniture</c> keeps the court pumps.
/// </summary>
public static class NativeStreetFurniture
{
    public const string File = "res://world/town/furniture/street-furniture.json";
    public const string Meta = "native_street_furniture";
    private const string PumpAsset = "res://recovered/street-props-20261015/props/street-pump-iron.tres";
    private const string HatchAsset = "res://recovered/street-props-20261015/props/cellar-hatch.tres";
    private const float Cell = 32f;
    /// <summary>How near the washing shows (the old cards showed from anywhere; past this a line is a few pixels).</summary>
    public const float Near = 90f, PegNear = 28f, RingNear = 36f, Fade = 10f;
    private const float RopeRadius = 0.005f, RopeLay = 0.088f;

    public sealed record Piece(string Kind, string? Cloth, float T, bool Flip, float[] Tint, float[]? At);
    public sealed record Ring(float[] At, float Yaw, float[] Attach);
    public sealed record Line(string Id, string Pack, Ring[] Rings, float Sag, Piece[] Pieces);
    public sealed record Pole(string Id, float[] At, float[][] Basis, float[] Dir, Piece[] Pieces);
    public sealed record Placed(string Id, float[] At, float Yaw, int SourceIndex = -1);
    public sealed record Plan(Placed[] Pumps, Placed[] Troughs, Placed[] Hatches, Line[] Lines, Pole[] Poles);

    private static Plan? Read(string? path)
    {
        path ??= File;
        if (!Godot.FileAccess.FileExists(path) && !System.IO.File.Exists(path)) return null;
        string text = path.StartsWith("res://", StringComparison.Ordinal) ? Godot.FileAccess.GetFileAsString(path) : System.IO.File.ReadAllText(path);
        return JsonSerializer.Deserialize<Plan>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    private static Vector3 V(float[] a) => new(a[0], a[1], a[2]);
    /// <summary>A piece's dye as the plan gives it (sRGB, as seen), as the copy's colour the shader multiplies by (linear).</summary>
    private static Color Tint(float[] t) => new Color(t[0], t[1], t[2]).SrgbToLinear();

    /// <summary>
    /// The pumps and hatches (authored kit objects) and the courts' old pumps hidden; before collision and the walk map read
    /// the town (any thread: nodes and resources only).
    /// </summary>
    public static (int Pumps, int Hatches, int OldCourtPumps) Install(Node3D town, string? path)
    {
        var plan = Read(path);
        if (plan == null) return (0, 0, 0);
        var pump = ResourceLoader.Load<AuthorAsset>(PumpAsset); var hatch = ResourceLoader.Load<AuthorAsset>(HatchAsset);
        int pumps = 0, hatches = 0, old = 0;
        var holder = new Node3D { Name = "street_furniture" };
        holder.SetMeta(Meta, true);
        town.AddChild(holder);
        void Put(Placed p, AuthorAsset asset, string prefix)
        {
            var o = new AuthoredObject { Name = prefix + p.Id, ObjectId = p.Id, Asset = asset, Position = V(p.At), Rotation = new Vector3(0, p.Yaw, 0) };
            o.SetMeta(Meta, true);
            holder.AddChild(o);
        }
        foreach (var p in plan.Pumps) { Put(p, pump, "pump_"); pumps++; }
        foreach (var h in plan.Hatches) { Put(h, hatch, "hatch_"); hatches++; }
        // the courts' pumps (churches group): the bake's copies give way to the kit's pump at the same place
        var courts = plan.Pumps.Where(p => p.SourceIndex >= 0).Select(p => p.SourceIndex).ToHashSet();
        if (town.GetNodeOrNull<Node3D>("churches") is { } churches)
            foreach (var n in churches.GetChildren().OfType<Node3D>())
                if (n.HasMeta("source_node_index") && courts.Contains(n.GetMeta("source_node_index").AsInt32()))
                {
                    n.Visible = false; old++;
                    foreach (var c in BakedWorld.All(n)) c.SetMeta("native_replaced_event_snapshot", true);
                }
        return (pumps, hatches, old);
    }

    /// <summary>The troughs and the washing (main thread: the pack's materials are made here).</summary>
    public static (int Troughs, int Lines, int Pieces, int Pegs, int Poles) Dress(Node3D town, string? path)
    {
        var plan = Read(path);
        if (plan == null || ModelLibrary.Get("laundry", new ModelLibrary.Look(TwoSided: true, VertexColor: true)) is not { } pack) return (0, 0, 0, 0, 0);
        var holder = town.GetNodeOrNull<Node3D>("street_furniture") ?? new Node3D { Name = "street_furniture" };
        if (holder.GetParent() == null) { holder.SetMeta(Meta, true); town.AddChild(holder); }
        Mesh Model(string name) => ((MeshInstance3D)pack.Roots[name]).Mesh;
        // the cloth: wet in the rain, swaying in the wind (one copy of each material, the same kind as before)
        var cloth = new Dictionary<string, Material>();
        Material Cloth(Material m, string key)
        {
            if (cloth.TryGetValue(key, out var made)) return made;
            var c = (ShaderMaterial)m.Duplicate();
            c.SetShaderParameter("wet_paint", 1.25f); c.SetShaderParameter("cloth_sway", 1.0f);
            return cloth[key] = c;
        }
        var models = new Dictionary<string, Mesh>();
        Mesh Piece(string kind, string? weave)
        {
            string key = kind + "/" + (weave ?? "");
            if (models.TryGetValue(key, out var m)) return m;
            var src = (ArrayMesh)Model(kind);
            var mat = src.SurfaceGetMaterial(0);
            if (weave == "ticking") mat = ((MeshInstance3D)pack.Roots["ticking_sample"]).Mesh.SurfaceGetMaterial(0);
            var mesh = Lods(src, Cloth(mat, (weave ?? "") + mat.ResourceName));
            return models[key] = mesh;
        }
        // ------------------------------------------------------------ troughs: solid stone
        int troughs = 0;
        foreach (var t in plan.Troughs)
        {
            var at = V(t.At);
            var node = new Node3D { Name = "trough_" + t.Id, Position = at, Rotation = new Vector3(0, t.Yaw, 0) };
            node.SetMeta(Meta, true);
            node.AddChild(new MeshInstance3D { Name = "Mesh", Mesh = Model("trough") });
            var body = new StaticBody3D { Name = "Solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
            body.AddChild(new CollisionShape3D { Name = "Shape", Shape = new BoxShape3D { Size = new Vector3(2.04f, 0.62f, 0.74f) }, Position = new Vector3(0, 0.31f, 0) });
            node.AddChild(body);
            holder.AddChild(node); troughs++;
        }
        // ------------------------------------------------------------ washing: per cell, per model
        var sets = new Dictionary<(int, int, string), List<(Transform3D At, Color Tint)>>();
        var ropes = new Dictionary<(int, int), SurfaceTool>();
        void Add((int, int) cell, string model, Transform3D at, Color tint)
        {
            var k = (cell.Item1, cell.Item2, model);
            if (!sets.TryGetValue(k, out var l)) sets[k] = l = new();
            l.Add((at, tint));
        }
        (int, int) CellOf(Vector3 p) => ((int)MathF.Floor(p.X / Cell), (int)MathF.Floor(p.Z / Cell));
        int lines = 0, pieces = 0, pegs = 0;
        Basis Along(Vector3 x)
        {
            x = x.Normalized(); var y = (Vector3.Up - x * x.Dot(Vector3.Up)).Normalized(); return new Basis(x, y, x.Cross(y));
        }
        foreach (var line in plan.Lines)
        {
            Vector3 a = V(line.Rings[0].Attach), b = V(line.Rings[1].Attach);
            Vector3 At(float t) => a + (b - a) * t + Vector3.Down * (line.Sag * 4 * t * (1 - t));
            Vector3 Tangent(float t) => (b - a) + Vector3.Down * (line.Sag * 4 * (1 - 2 * t));
            var cell = CellOf((a + b) / 2);
            foreach (var r in line.Rings) Add(cell, "line_ring", new Transform3D(new Basis(Vector3.Up, r.Yaw), V(r.At)), Colors.White);
            Rope(ropes, cell, At, a.DistanceTo(b));
            foreach (var p in line.Pieces)
            {
                var basis = Along(Tangent(p.T));
                if (p.Flip) basis = basis.Rotated(Vector3.Up, MathF.PI);
                var at = new Transform3D(basis, At(p.T));
                string key = p.Kind + "/" + (p.Cloth ?? "");
                Add(cell, key, at, Tint(p.Tint));
                pieces++;
                foreach (float u in PegsOf(pack, p.Kind))
                {
                    var pb = Along(Tangent(p.T)); var pa = at.Origin + basis.X * u;
                    Add(cell, "peg", new Transform3D(pb, pa), Colors.White); pegs++;
                }
            }
            lines++;
        }
        int poles = 0;
        foreach (var pole in plan.Poles)
        {
            var at = V(pole.At); var cell = CellOf(at);
            var basis = new Basis(V(pole.Basis[0]), V(pole.Basis[1]), V(pole.Basis[2]));
            Add(cell, "wash_pole", new Transform3D(basis, at), Colors.White);
            foreach (var p in pole.Pieces)
            {
                if (p.At == null) continue;
                Add(cell, p.Kind + "/" + (p.Cloth ?? ""), new Transform3D(Along(V(pole.Dir)), V(p.At)), Tint(p.Tint));
                pieces++;
            }
            poles++;
        }
        var ropeMat = ((MeshInstance3D)pack.Roots["rope_sample"]).Mesh.SurfaceGetMaterial(0);
        foreach (var ((cx, cz, model), list) in sets.OrderBy(s => s.Key.Item1).ThenBy(s => s.Key.Item2).ThenBy(s => s.Key.Item3))
        {
            string[] parts = model.Split('/');
            Mesh mesh = parts.Length == 2 ? Piece(parts[0], parts[1] == "" ? null : parts[1]) : Model(model);
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = mesh, InstanceCount = list.Count };
            for (int i = 0; i < list.Count; i++) { mm.SetInstanceTransform(i, list[i].At); mm.SetInstanceColor(i, list[i].Tint); }
            bool small = model is "peg" or "line_ring";
            var node = new MultiMeshInstance3D
            {
                Name = $"washing_{cx}_{cz}_{model.Replace('/', '_')}", Multimesh = mm,
                VisibilityRangeEnd = model == "peg" ? PegNear : model == "line_ring" ? RingNear : Near, VisibilityRangeEndMargin = Fade,
                VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
                CastShadow = small ? GeometryInstance3D.ShadowCastingSetting.Off : GeometryInstance3D.ShadowCastingSetting.On,
            };
            node.SetMeta(Meta, true);
            holder.AddChild(node);
        }
        foreach (var ((cx, cz), st) in ropes)
        {
            st.SetMaterial(ropeMat);
            var node = new MeshInstance3D { Name = $"washing_{cx}_{cz}_rope", Mesh = st.Commit(), VisibilityRangeEnd = Near, VisibilityRangeEndMargin = Fade,
                VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            node.SetMeta(Meta, true);
            holder.AddChild(node);
        }
        return (troughs, lines, pieces, pegs, poles);
    }

    /// <summary>The pegs' places along a piece: metres along the line from its middle (build_laundry.py's laundry.json "pegs").</summary>
    private static float[] PegsOf(ModelLibrary.Model pack, string kind)
    {
        return PegTable.TryGetValue(kind, out var p) ? p : Array.Empty<float>();
    }
    private static readonly Dictionary<string, float[]> PegTable = new()
    {
        ["shirt"] = new[] { -0.22f, 0.22f }, ["shift"] = new[] { -0.24f, 0.24f }, ["trousers"] = new[] { -0.17f, 0.17f }, ["apron"] = new[] { -0.25f, 0.25f },
        ["stockings"] = new[] { -0.2f, 0.06f }, ["sheet"] = new[] { -0.62f, 0f, 0.62f }, ["towel"] = new[] { -0.19f, 0.19f },
    };

    /// <summary>The line: a hemp rope swept along its sag, 8 sides, its twist's picture repeating every lay.</summary>
    private static void Rope(Dictionary<(int, int), SurfaceTool> ropes, (int, int) cell, Func<float, Vector3> at, float span)
    {
        if (!ropes.TryGetValue(cell, out var st)) { st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles); ropes[cell] = st; }
        int n = Math.Max(8, (int)(span / 0.35f)), sides = 8;
        var rings = new Vector3[n + 1][]; var norms = new Vector3[n + 1][]; var along = new float[n + 1];
        for (int i = 0; i <= n; i++)
        {
            float t = i / (float)n; var p = at(t); var d = (at(Math.Min(1, t + 0.01f)) - at(Math.Max(0, t - 0.01f))).Normalized();
            var side = d.Cross(Vector3.Up).Normalized(); var up = side.Cross(d).Normalized();
            rings[i] = new Vector3[sides + 1]; norms[i] = new Vector3[sides + 1];
            for (int j = 0; j <= sides; j++)
            {
                float a = MathF.Tau * j / sides; var nrm = side * MathF.Cos(a) + up * MathF.Sin(a);
                norms[i][j] = nrm; rings[i][j] = p + nrm * RopeRadius;
            }
            along[i] = i == 0 ? 0 : along[i - 1] + at(t).DistanceTo(at((i - 1) / (float)n));
        }
        void Vtx(int i, int j)
        {
            st.SetNormal(norms[i][j]); st.SetUV(new Vector2(along[i] / RopeLay, j / (float)sides)); st.SetColor(Colors.White); st.AddVertex(rings[i][j]);
        }
        for (int i = 0; i < n; i++)
            for (int j = 0; j < sides; j++)
            {
                Vtx(i, j); Vtx(i + 1, j); Vtx(i + 1, j + 1);
                Vtx(i, j); Vtx(i + 1, j + 1); Vtx(i, j + 1);
            }
    }

    /// <summary>A piece's mesh with the engine's levels of detail (a line's far pieces drop to a fraction of their triangles).</summary>
    private static Mesh Lods(ArrayMesh src, Material material)
    {
        var im = new ImporterMesh();
        for (int s = 0; s < src.GetSurfaceCount(); s++)
            im.AddSurface(Mesh.PrimitiveType.Triangles, src.SurfaceGetArrays(s), null, null, material, src.SurfaceGetName(s));
        im.GenerateLods(60, 25, new Godot.Collections.Array());
        return im.GetMesh();
    }
}

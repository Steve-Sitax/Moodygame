using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// An area's Blender export into game resources (docs/ruien-native.md), once, headless (RuienConvert):
/// - every mesh object of every LOD file (manifest.json "files") as its own compressed mesh resource, its surfaces
///   named by their family (the game gives each its shared Ruien material), its vertex colour the weather masks, UV2.x
///   the baked AO; grouped by the export's area key (gallery_s0, hall_bay12 ...) so the game switches a key's LODs
///   together;
/// - the col_* meshes as one collision shape;
/// - the markers (lamps, daylight openings, mist, water) in the game's own terms (markers.json).
/// Writes res://world/ruien/&lt;area&gt;/: area.json (the keys, their meshes and boxes), mesh_*.res, collision.res,
/// markers.json.
/// </summary>
public static class RuienImport
{
    public static string Convert(string exportDir, string areaId, string lods = "0")
    {
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(exportDir, "manifest.json"))).RootElement;
        // --out also works through the existing conversion scene without changing its dispatcher.
        var args = OS.GetCmdlineUserArgs();
        int outArg = Array.IndexOf(args, "--out");
        if (outArg >= 0 && outArg + 1 >= args.Length) throw new ArgumentException("--out needs an output folder");
        string outRes = outArg >= 0 ? Path.GetFullPath(args[outArg + 1]).Replace('\\', '/') : $"res://world/ruien/{areaId}";
        string outDir = ProjectSettings.GlobalizePath(outRes);
        Directory.CreateDirectory(outDir);
        foreach (var old in Directory.GetFiles(outDir, "mesh_*.res")) File.Delete(old);
        string prefix = $"ruien_{(manifest.TryGetProperty("route", out var route) ? route.GetString() : areaId)}_";
        var keys = new SortedDictionary<string, Dictionary<int, List<(string file, Aabb box, int tris)>>>();
        var area = RuienData.Load().Areas.FirstOrDefault(a => a.Id == areaId);
        var skip = area?.SkipKeys ?? new HashSet<string>();
        float waterMin = manifest.TryGetProperty("waterMin", out var wm) ? wm.GetSingle()
            : area?.WaterMin ?? manifest.GetProperty("markers").GetProperty("water").EnumerateArray().First().GetProperty("height").GetSingle();
        int meshes = 0, tris = 0;
        // Generated lines and rooms always receive the native metric charts. The original O2 study still
        // goes through its separate immutable-snapshot repair, without changing its conversion bytes.
        bool uvRepair = manifest.TryGetProperty("cls", out _) ||
            (manifest.TryGetProperty("uvRepair", out var ur) && ur.ValueKind == JsonValueKind.True);
        var surfaceArea = area;
        if (manifest.TryGetProperty("surfaceLayout", out var layout))
        {
            var section = RuienData.Load().Classes[manifest.GetProperty("cls").GetString()!]
                with { WalkwaySide = layout.GetProperty("walkwaySide").GetInt32() };
            var points = layout.GetProperty("path").EnumerateArray().Select(p => new Vector2(p[0].GetSingle(), p[1].GetSingle())).ToArray();
            var zone = new RuienData.Zone { Id = areaId, S = section, Path = points, Along = new float[points.Length] };
            for (int i = 1; i < points.Length; i++) zone.Along[i] = zone.Along[i - 1] + points[i].DistanceTo(points[i - 1]);
            surfaceArea = new RuienData.Area { Id = areaId };
            surfaceArea.Zones.Add(zone);
        }
        bool pave = uvRepair && surfaceArea != null;
        if (pave) RuienPaving.Layout(surfaceArea!);
        var pavingFaces = new List<Vector3>();
        foreach (var f in manifest.GetProperty("files").EnumerateObject())
        {
            if (!f.Value.TryGetProperty("lod", out var lodE) || lodE.ValueKind != JsonValueKind.Number) continue;
            int lod = lodE.GetInt32();
            // (the levels kept: by default only the full one, which measured no slower than the lighter one and keeps
            // the area within the repository's budget; --lods 0,1 keeps both)
            if (!lods.Split(',').Contains(lod.ToString())) continue;
            var t0 = Time.GetTicksMsec();
            var objects = RuienGlb.Read(Path.Combine(exportDir, f.Name)).ToArray();
            if (uvRepair) ChartBricks(objects);
            foreach (var obj in objects)
            {
                string name = obj.Name.StartsWith(prefix) ? obj.Name[prefix.Length..] : obj.Name;
                var m = Regex.Match(name, @"^(?<key>.+)_lod(?<lod>\d+)_(?<n>\d+)$");
                string key = m.Success ? m.Groups["key"].Value : name;
                if (skip.Contains(key)) continue; // (the area's skipKeys: the town draws its own there)
                var mesh = Build(obj, out int n, uvRepair, pave, lod, charted: uvRepair, pavingFaces: lod == 0 ? pavingFaces : null);
                if (mesh == null) continue;
                string file = $"mesh_{key}_lod{lod}_{(m.Success ? m.Groups["n"].Value : "00")}.res";
                var err = ResourceSaver.Save(mesh, $"{outRes}/{file}", ResourceSaver.SaverFlags.Compress);
                if (err != Error.Ok) throw new IOException($"could not write {file}: {err}");
                if (!keys.TryGetValue(key, out var byLod)) keys[key] = byLod = new();
                if (!byLod.TryGetValue(lod, out var list)) byLod[lod] = list = new();
                list.Add((file, mesh.GetAabb(), n));
                meshes++; tris += n;
            }
            GD.Print($"ruien import: {f.Name} in {Time.GetTicksMsec() - t0} ms");
        }
        // collision: every col_* triangle, one shape
        var col = new List<Vector3>();
        var named = new List<(string name, Vector3 a, Vector3 b, Vector3 c)>();
        // a mover's own collision (col_gate_door_n goes with the mover outlet_door_n: its name ends the same) is kept apart
        var movers = manifest.TryGetProperty("movers", out var mv) && mv.ValueKind == JsonValueKind.Object ? mv.EnumerateObject().Select(m => m.Name).ToList() : new List<string>();
        string? MoverOf(string colName) => movers.FirstOrDefault(m => colName.EndsWith("_" + string.Join("_", m.Split('_').TakeLast(2))));
        var moverCol = new Dictionary<string, List<Vector3>>();
        foreach (var f in manifest.GetProperty("files").EnumerateObject().Where(f => f.Name.Contains("collision")))
            foreach (var obj in RuienGlb.Read(Path.Combine(exportDir, f.Name)))
                foreach (var p in obj.Prims)
                    for (int i = 0; i + 2 < p.Idx.Length; i += 3)
                    {
                        var into = MoverOf(obj.Name) is { } mover ? (moverCol.TryGetValue(mover, out var l) ? l : moverCol[mover] = new List<Vector3>()) : col;
                        into.Add(p.Pos[p.Idx[i]]); into.Add(p.Pos[p.Idx[i + 1]]); into.Add(p.Pos[p.Idx[i + 2]]);
                        named.Add((obj.Name, p.Pos[p.Idx[i]], p.Pos[p.Idx[i + 1]], p.Pos[p.Idx[i + 2]]));
                    }
        col.AddRange(pavingFaces);
        ResourceSaver.Save(new ConcavePolygonShape3D { Data = col.ToArray(), BackfaceCollision = true }, $"{outRes}/collision.res", ResourceSaver.SaverFlags.Compress);
        foreach (var old in Directory.GetFiles(outDir, "collision_*.res")) File.Delete(old);
        foreach (var (mover, tri) in moverCol)
            ResourceSaver.Save(new ConcavePolygonShape3D { Data = tri.ToArray(), BackfaceCollision = true }, $"{outRes}/collision_{mover}.res", ResourceSaver.SaverFlags.Compress);
        var index = new
        {
            about = "Made by RuienImport from the Blender export (docs/ruien-native.md). Do not edit; convert again.",
            piece = manifest.TryGetProperty("piece", out var pc) ? pc.GetString() : "",
            keys = keys.ToDictionary(k => k.Key, k => k.Value.ToDictionary(l => "lod" + l.Key, l => l.Value.Select(e => new
            {
                e.file, e.tris,
                box = new[] { e.box.Position.X, e.box.Position.Y, e.box.Position.Z, e.box.End.X, e.box.End.Y, e.box.End.Z },
            }).ToArray())),
        };
        File.WriteAllText(Path.Combine(outDir, "area.json"), JsonSerializer.Serialize(index, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) + "\n");
        File.WriteAllText(Path.Combine(outDir, "markers.json"), Markers(manifest.GetProperty("markers"), named, mv, moverCol.Keys, waterMin) + "\n");
        return $"{areaId}: {meshes} meshes, {tris} triangles in {keys.Count} keys, collision {col.Count / 3} triangles, written to {outRes}";
    }

    /// <summary>
    /// Kit pieces (export/kit/kit.json) into one shared mesh each, around its pivot (res://world/ruien/kit/&lt;piece&gt;.res),
    /// placed by an area's "kit" list wherever it needs one. Only the pieces asked for (the repository's budget).
    /// </summary>
    public static string ConvertKit(string kitDir, string pieces)
    {
        var kit = JsonDocument.Parse(File.ReadAllText(Path.Combine(kitDir, "kit.json"))).RootElement.GetProperty("pieces");
        string outRes = "res://world/ruien/kit";
        Directory.CreateDirectory(ProjectSettings.GlobalizePath(outRes));
        var done = new List<string>();
        foreach (string name in pieces.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var files = kit.GetProperty(name).GetProperty("files").EnumerateObject().Select(f => f.Name).Where(f => f.Contains("_lod0")).ToList();
            var mesh = new ArrayMesh { ResourceName = name };
            int tris = 0;
            foreach (var f in files)
                foreach (var obj in RuienGlb.Read(Path.Combine(kitDir, f)))
                    if (Build(obj, out int n) is { } part)
                    {
                        for (int s = 0; s < part.GetSurfaceCount(); s++)
                        {
                            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, part.SurfaceGetArrays(s), null, null, part.SurfaceGetFormat(s));
                            mesh.SurfaceSetName(mesh.GetSurfaceCount() - 1, part.SurfaceGetName(s));
                        }
                        tris += n;
                    }
            var err = ResourceSaver.Save(mesh, $"{outRes}/{name}.res", ResourceSaver.SaverFlags.Compress);
            if (err != Error.Ok) throw new IOException($"could not write {name}: {err}");
            done.Add($"{name} {tris} triangles");
        }
        return string.Join(", ", done);
    }

    /// <summary>
    /// One object, with named family surfaces and Godot winding. Legacy conversions use compressed attributes
    /// and 16-bit index chunks; repaired exports retain full-precision charts with 32-bit indices when needed.
    /// </summary>
    public static ArrayMesh? Build(RuienGlb.Obj obj, out int tris, bool uvRepair = false, bool pave = false, int lod = 0, bool charted = false, List<Vector3>? pavingFaces = null)
    {
        tris = 0;
        var mesh = new ArrayMesh { ResourceName = obj.Name };
        using var paving = new SurfaceTool();
        paving.Begin(Mesh.PrimitiveType.Triangles);
        bool paved = false;
        foreach (var p in obj.Prims)
        {
            // (a family the game leaves out: the study's patches of street paving, where the town has its own street)
            if (RuienMaterials.Skipped(p.Material)) continue;
            int n = p.Idx.Length - p.Idx.Length % 3;
            int t = 0;
            while (t < n)
            {
                var map = new Dictionary<int, int>();
                var idx = new List<int>();
                for (; t < n; t += 3)
                {
                    int a = p.Idx[t], b = p.Idx[t + 2], c = p.Idx[t + 1];
                    int fresh = (map.ContainsKey(a) ? 0 : 1) + (map.ContainsKey(b) ? 0 : 1) + (map.ContainsKey(c) ? 0 : 1);
                    if (!uvRepair && map.Count + fresh > 65000) break;
                    foreach (int v in new[] { a, b, c })
                    {
                        if (!map.TryGetValue(v, out int k)) map[v] = k = map.Count;
                        idx.Add(k);
                    }
                }
                if (idx.Count < 3) continue;
                var order = new int[map.Count];
                foreach (var (src, dst) in map) order[dst] = src;
                var arrays = new Godot.Collections.Array();
                arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex] = order.Select(i => p.Pos[i]).ToArray();
                if (p.Nrm != null) arrays[(int)Mesh.ArrayType.Normal] = order.Select(i => p.Nrm[i]).ToArray();
                if (p.Uv != null) arrays[(int)Mesh.ArrayType.TexUV] = order.Select(i => p.Uv[i]).ToArray();
                // CUSTOM0 (8 bits each): the bake's base colour as its square root (its weight in the bake's alpha
                // folded in: a part the bake did not cover is black, the shader keeps the masks' colour there), and AO
                var custom = new byte[order.Length * 4];
                for (int k = 0; k < order.Length; k++)
                {
                    int i = order[k];
                    var b = p.Bake != null ? p.Bake[i] : new Color(0, 0, 0, 0);
                    float w = Math.Clamp(b.A, 0, 1);
                    custom[k * 4] = (byte)Math.Clamp(MathF.Round(MathF.Sqrt(Math.Max(b.R, 0)) * w * 255), 0, 255);
                    custom[k * 4 + 1] = (byte)Math.Clamp(MathF.Round(MathF.Sqrt(Math.Max(b.G, 0)) * w * 255), 0, 255);
                    custom[k * 4 + 2] = (byte)Math.Clamp(MathF.Round(MathF.Sqrt(Math.Max(b.B, 0)) * w * 255), 0, 255);
                    custom[k * 4 + 3] = (byte)Math.Clamp(MathF.Round(Math.Max(p.Ao != null ? p.Ao[i] : 1, 0.02f) * 255), 1, 255);
                }
                arrays[(int)Mesh.ArrayType.Custom0] = custom;
                arrays[(int)Mesh.ArrayType.Color] = order.Select(i => p.Col != null ? p.Col[i] : new Color(0, 0, 0, 0)).ToArray();
                arrays[(int)Mesh.ArrayType.Index] = idx.ToArray();
                var format = Mesh.ArrayFormat.FlagCompressAttributes | (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.Rgba8Unorm << (int)Mesh.ArrayFormat.FormatCustom0Shift);
                // Quantized UVs collapse millimetre bevel charts, so a repaired surface keeps full-precision attributes.
                if (uvRepair)
                {
                    if (RuienUnfold.Bricks(p.Material))
                    {
                        if (pave) paved |= RuienPaving.Extract(arrays, paving, lod == 0 ? .045f : .075f);
                        if (arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length == 0) continue;
                        if (!charted) RuienUnfold.Apply(arrays, p.Material);
                    }
                    RuienUv.Repair(arrays, p.Material, localPhase: true);
                    format &= ~Mesh.ArrayFormat.FlagCompressAttributes;
                }
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, format);
                mesh.SurfaceSetName(mesh.GetSurfaceCount() - 1, p.Material);
                tris += arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length / 3;
            }
        }
        if (paved)
        {
            paving.Index();
            using var pm = paving.Commit();
            pavingFaces?.AddRange(pm.GetFaces());
            var arrays = pm.SurfaceGetArrays(0);
            RuienUv.Repair(arrays, "ruien_setts", continuous: true);
            RuienUv.UnfoldFlanks(arrays, "ruien_setts");
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetName(mesh.GetSurfaceCount() - 1, "ruien_setts");
            tris += arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length / 3;
        }
        return mesh.GetSurfaceCount() > 0 ? mesh : null;
    }

    // Export chunk boundaries are storage boundaries, not masonry seams. Unfold the whole family's
    // connected geometry, then return each triangle to its original object, preserving keys and LOD bounds.
    private static void ChartBricks(IEnumerable<RuienGlb.Obj> objects)
    {
        foreach (var group in objects.SelectMany(o => o.Prims).Where(p => RuienUnfold.Bricks(p.Material)).GroupBy(p => p.Material))
        {
            var parts = group.ToArray();
            var triangles = new RuienPatch.Tris();
            var indices = new List<int>();
            foreach (var p in parts)
            {
                int start = triangles.P.Count;
                indices.AddRange(p.Idx.Select(i => i + start));
                for (int i = 0; i < p.Pos.Length; i++)
                {
                    triangles.P.Add(p.Pos[i]);
                    triangles.N.Add(p.Nrm?[i] ?? Vector3.Up);
                    triangles.Uv.Add(p.Uv?[i] ?? Vector2.Zero);
                    triangles.C.Add(p.Col?[i] ?? new Color(0, 0, 0, 0));
                    var b = p.Bake?[i] ?? new Color(0, 0, 0, 0);
                    byte Pack(float c) => (byte)Math.Clamp(MathF.Round(MathF.Sqrt(Math.Max(c, 0)) * Math.Clamp(b.A, 0, 1) * 255), 0, 255);
                    triangles.Bake.Add(new[] { Pack(b.R), Pack(b.G), Pack(b.B), (byte)Math.Clamp(MathF.Round(Math.Max(p.Ao?[i] ?? 1, .02f) * 255), 1, 255) });
                }
            }
            var arrays = RuienPatch.ToArrays(triangles);
            arrays[(int)Mesh.ArrayType.Index] = indices.ToArray();
            RuienUnfold.Apply(arrays, group.Key);
            var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var normal = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
            var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var colour = arrays[(int)Mesh.ArrayType.Color].AsColorArray();
            var bake = arrays[(int)Mesh.ArrayType.Custom0].AsByteArray();
            var ix = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            int offset = 0;
            foreach (var p in parts)
            {
                int count = p.Idx.Length;
                var map = new Dictionary<int, int>();
                p.Idx = ix.Skip(offset).Take(count).Select(i => { if (!map.TryGetValue(i, out int k)) map[i] = k = map.Count; return k; }).ToArray();
                var order = map.OrderBy(k => k.Value).Select(k => k.Key).ToArray();
                p.Pos = order.Select(i => pos[i]).ToArray(); p.Nrm = order.Select(i => normal[i]).ToArray();
                p.Uv = order.Select(i => uv[i]).ToArray(); p.Col = order.Select(i => colour[i]).ToArray();
                p.Ao = order.Select(i => bake[i * 4 + 3] / 255f).ToArray();
                float Linear(byte b) => b * b / (255f * 255f);
                p.Bake = order.Select(i => new Color(Linear(bake[i * 4]), Linear(bake[i * 4 + 1]), Linear(bake[i * 4 + 2]), 1)).ToArray();
                offset += count;
            }
        }
    }

    /// <summary>The first collision triangle (of the names picked) along a ray: its distance, or null (Moller-Trumbore).</summary>
    private static float? Hit(List<(string name, Vector3 a, Vector3 b, Vector3 c)> col, Vector3 o, Vector3 d, Func<string, bool> pick)
    {
        float best = float.MaxValue;
        foreach (var (name, a, b, c) in col)
        {
            if (!pick(name)) continue;
            Vector3 e1 = b - a, e2 = c - a, p = d.Cross(e2);
            float det = e1.Dot(p);
            if (MathF.Abs(det) < 1e-9f) continue;
            float inv = 1 / det;
            var s = o - a;
            float u = s.Dot(p) * inv;
            if (u < 0 || u > 1) continue;
            var q = s.Cross(e1);
            float v = d.Dot(q) * inv;
            if (v < 0 || u + v > 1) continue;
            float t = e2.Dot(q) * inv;
            if (t > 1e-4f && t < best) best = t;
        }
        return best < float.MaxValue ? best : null;
    }

    /// <summary>
    /// The export's lights, mist and water in the game's terms (RuienData sources, mist, water). Blender's lamps
    /// (watts) become lamps; its sun spots far above the grates and the air shaft become daylight openings where they
    /// meet the street; its area light over the hatch the hatch's opening; its wide side-gallery spots cool mouths.
    /// Render-only lights (the street's gas lamp over the vliet) and the outdoor and dust volumes are left out.
    /// </summary>
    private static string Markers(JsonElement mk, List<(string name, Vector3 a, Vector3 b, Vector3 c)> col, JsonElement movers, IEnumerable<string> moverCol, float waterMin)
    {
        var sources = new List<object>();
        bool openings = mk.TryGetProperty("daylight_openings", out var dl);
        static float[] V(JsonElement e) => e.EnumerateArray().Select(x => x.GetSingle()).ToArray();
        static string Hex(float[] c) => "#" + string.Concat(c.Take(3).Select(x => ((int)Math.Clamp(MathF.Round(x * 255), 0, 255)).ToString("x2")));
        foreach (var l in mk.GetProperty("lamps").EnumerateArray())
        {
            string name = l.GetProperty("name").GetString()!;
            var pos = V(l.GetProperty("pos"));
            if (pos[1] > 0.5f && l.GetProperty("kind").GetString() == "point") continue; // (the street's lamp: the town's own)
            if (l.GetProperty("kind").GetString() == "area")
            {
                // a patch of daylight (the hatch): the opening over the stair
                var hatch = mk.GetProperty("stairs").EnumerateArray().Select(s => V(s.GetProperty("hatch"))).FirstOrDefault();
                if (hatch != null && !openings)
                    sources.Add(new { id = name, kind = "hatch", at = new[] { (hatch[0] + hatch[1]) / 2, -0.3f, (hatch[2] + hatch[3]) / 2 }, dir = new[] { 0f, -1f, 0f }, size = new[] { hatch[1] - hatch[0], hatch[3] - hatch[2] }, power = 2.2f, range = 16f, beam = 3.3f });
                continue;
            }
            float w = l.GetProperty("power_w").GetSingle();
            sources.Add(new { id = name, kind = "lamp", at = pos, color = Hex(V(l.GetProperty("color"))), power = MathF.Round(w * 0.045f, 2), range = l.GetProperty("range_m").GetSingle() });
        }
        if (openings)
            foreach (var o in dl.EnumerateArray())
            {
                string name = o.GetProperty("name").GetString()!, kind = o.GetProperty("kind").GetString()!;
                // A stair hatch admits sky at its actual street opening. Treating the lower doorway as a
                // full-size horizontal emitter cast a false white hotspot across the hall's seepage wall.
                var at = V(o.GetProperty(kind=="hatch"?"centre":"vault_opening"));
                bool round = kind.StartsWith("round");
                float[] size = round ? new[] { o.GetProperty("radius_m").GetSingle() * 2, o.GetProperty("radius_m").GetSingle() * 2 } : V(o.GetProperty("size_m"));
                var d = new Vector3(0, -1, 0);
                var bottom = new Vector3(at[0], at[1], at[2]);
                float fall = Hit(col, bottom + d * 0.05f, d, n => !n.Contains("ladder")) is { } hb ? hb + 0.05f : 99;
                fall = Math.Min(fall, bottom.Y - waterMin);
                string k = kind == "hatch" ? "hatch" : round ? "shaft" : "grate";
                float power = k == "hatch" ? 2.2f : round ? 5f : 6f;
                sources.Add(new { id = name, kind = k, at = new[] { at[0], at[1] - 0.05f, at[2] }, dir = new[] { 0f, -1f, 0f }, size, round, bars = k == "hatch" ? 0 : round ? 5 : 6, power, range = k == "hatch" ? 16f : 14f, beam = Math.Max(fall, 0.5f) });
            }
        foreach (var b in mk.GetProperty("beams").EnumerateArray())
        {
            string name = b.GetProperty("name").GetString()!;
            var pos = V(b.GetProperty("pos"));
            var dir = V(b.GetProperty("dir"));
            float cone = b.GetProperty("cone_deg").GetSingle();
            if (cone < 10 && pos[1] > 5 && dir[1] < -0.3f)
            {
                if (openings) continue; // (the export's own openings stand for these)
                // where the sun spot meets the street: the opening it comes down through
                float t = pos[1] / -dir[1];
                var d = new Vector3(dir[0], dir[1], dir[2]).Normalized();
                var street = new Vector3(pos[0] + dir[0] * t, 0, pos[2] + dir[2] * t);
                bool air = name.Contains("air");
                // its light comes in where the shaft meets the vault (the vault's collision; a hall's crown), and falls
                // to the next thing below it, or the water
                float down = Hit(col, street + d * -0.5f, d, n => n.Contains("vault")) is { } hv ? hv - 0.5f : (-0.95f - 0f) / d.Y;
                var bottom = street + d * Math.Max(down, 0.3f);
                float fall = Hit(col, bottom + d * 0.05f, d, n => !n.Contains("ladder")) is { } hb ? hb + 0.05f : 99;
                fall = Math.Min(fall, (bottom.Y - waterMin) / -d.Y);
                var at = new[] { bottom.X, bottom.Y - 0.05f, bottom.Z };
                float len = Math.Max(fall, 0.5f);
                sources.Add(new { id = name, kind = air ? "shaft" : "grate", at, dir, size = air ? new[] { 0.7f, 0.7f } : new[] { 0.66f, 0.66f }, round = air, bars = air ? 5 : 6, power = air ? 5.0f : 6.0f, range = 14f, beam = len });
            }
            else
                sources.Add(new { id = name, kind = "mouth", at = pos, dir, size = new[] { 3.0f, 2.2f }, power = MathF.Round(b.GetProperty("power_w").GetSingle() * 0.008f, 3), range = 18f, beam = 0f });
        }
        var mist = mk.GetProperty("mist").EnumerateArray()
            .Where(m => m.GetProperty("name").GetString()!.StartsWith("rot_mist"))
            .Select(m => new { id = m.GetProperty("name").GetString(), min = V(m.GetProperty("min")), max = V(m.GetProperty("max")), density = MathF.Round(m.GetProperty("density_peak").GetSingle() * 0.7f, 3) }).ToList();
        var water = new List<object>();
        foreach (var w in mk.GetProperty("water").EnumerateArray())
        {
            string id = w.GetProperty("name").GetString()!;
            if (id == "vliet") continue; // (outside: the town's own water)
            if (w.TryGetProperty("outline", out var ol)) water.Add(new { id, outline = ol.EnumerateArray().Select(V).ToArray(), flow = new[] { 0f, -0.01f } });
            else water.Add(new { id, line = w.GetProperty("centre_line").EnumerateArray().Select(V).ToArray(), width = w.GetProperty("width").GetSingle(), flow = new[] { 0f, -0.04f } });
        }
        return JsonSerializer.Serialize(new { about = "Made by RuienImport from the export markers (docs/ruien-native.md). Do not edit; convert again.", sources, mist, water,
            movers = movers.ValueKind == JsonValueKind.Object ? movers.EnumerateObject().Select(m => new
            {
                id = m.Name, kind = m.Value.GetProperty("kind").GetString(), pivot = V(m.Value.GetProperty("pivot")),
                openDeg = m.Value.TryGetProperty("open_rotation_y_deg", out var od) ? od.GetSingle() : 0f,
                travel = m.Value.TryGetProperty("travel_y", out var tv) ? V(tv) : null,
                collision = moverCol.Contains(m.Name) ? $"collision_{m.Name}.res" : null,
            }).ToArray() : null,
            // folding footbridges (kit/fold_bridge.py): pivots at walk level and the lifting gear's side, as exported
            bridges = mk.TryGetProperty("bridges", out var br) && br.ValueKind == JsonValueKind.Array ? br.EnumerateArray().Select(b => new
            {
                id = b.GetProperty("id").GetString(), a = V(b.GetProperty("a")), b = V(b.GetProperty("b")), gear = b.TryGetProperty("gear", out var g) ? V(g) : null,
            }).ToArray() : null,
            ladders = mk.GetProperty("ladders").EnumerateArray().Select(l => new { id = l.GetProperty("name").GetString(), bottom = V(l.GetProperty("bottom")), top = V(l.GetProperty("top")), grate = V(l.GetProperty("grate_size_m")) }).ToArray(),
            stairs = mk.GetProperty("stairs").EnumerateArray().Select(l => new { id = l.GetProperty("name").GetString(), bottom = V(l.GetProperty("bottom")), top = V(l.GetProperty("top")), hatch = V(l.GetProperty("hatch")) }).ToArray() }, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
}

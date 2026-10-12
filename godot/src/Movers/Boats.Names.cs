using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Movers;

public partial class Boats
{
    private sealed record VesselName(string Id, string Kind, string? Name, string? Port, string? Of, JsonElement Where, JsonElement Cells);
    private sealed record NameZone(string Role, Mesh Mesh, Transform3D Part);
    private readonly Dictionary<string, ShaderMaterial> nameMaterials = new();
    private readonly Dictionary<string, List<NameZone>> nameZones = new();
    private readonly List<VesselName> vesselNames = new();
    private readonly HashSet<string> usedNames = new();
    private JsonElement namesAtlas, namesFleet;
    private static readonly System.Text.RegularExpressions.Regex NameZonePattern = new("_name_(bow_[ps]|stern|box_[ps])(?:_\\d+)?$", System.Text.RegularExpressions.RegexOptions.Compiled);

    private void InitNames()
    {
        string atlas = Paths.Public("models/boat_names.json"), fleet = Paths.Shared("fleet.json");
        if (!File.Exists(atlas) || !File.Exists(fleet)) { GD.PrintErr("boat names: registry or atlas missing"); return; }
        using var a = JsonDocument.Parse(File.ReadAllText(atlas)); namesAtlas = a.RootElement.Clone();
        using var f = JsonDocument.Parse(File.ReadAllText(fleet)); namesFleet = f.RootElement.Clone();
        foreach (var v in namesFleet.GetProperty("vessels").EnumerateArray())
        {
            string id = v.GetProperty("id").GetString()!;
            namesAtlas.GetProperty("vessels").TryGetProperty(id, out var cells);
            vesselNames.Add(new(id, v.GetProperty("kind").GetString()!, Text(v, "name"), Text(v, "port"), Text(v, "of"), v.GetProperty("where"), cells));
        }
        int page = 0;
        foreach (var p in namesAtlas.GetProperty("pages").EnumerateArray())
        {
            var image = Image.LoadFromFile(Paths.Public("models/" + p.GetProperty("file").GetString()));
            int h = image.GetHeight() / 4;
            for (int band = 0; band < 4; band++)
            {
                var slice = image.GetRegion(new Rect2I(0, band * h, image.GetWidth(), h));
                // Raw glTF zones and Godot textures both use v downward.
                slice.GenerateMipmaps();
                var kind = new Psx.Kind(false, false, false, false, true, false, 0, false, false, true, NameCell: 4);
                var material = new ShaderMaterial { Shader = Psx.ShaderOf(kind), ResourceName = $"boat_names_{page}_{band}" };
                material.SetShaderParameter("tex", ImageTexture.CreateFromImage(slice));
                material.SetShaderParameter("affine", 0f);
                nameMaterials[$"{page}:{band}"] = material;
            }
            page++;
        }
        // A separate follower updates row lettering from the existing live frames; W4 owns their motion.
        foreach (var node in BakedWorld.All(Mv.Town))
            if (node is GeometryInstance3D mesh && (mesh.MaterialOverride ?? (mesh as MeshInstance3D)?.Mesh?.SurfaceGetMaterial(0) ?? (mesh as MultiMeshInstance3D)?.Multimesh.Mesh?.SurfaceGetMaterial(0)) is ShaderMaterial material && Psx.KindOf(material.Shader)?.NameCell > 0) mesh.Visible = false;
        AddChild(new NameRows { OwnerBoats = this, ProcessPriority = -49 });
    }

    private static string? Text(JsonElement v, string key) => v.ValueKind == JsonValueKind.Object && v.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
    private VesselName? TakeName(string kind, string how, Vector3 at, string? id = null)
    {
        if (namesFleet.ValueKind != JsonValueKind.Object) return null;
        VesselName? found = id == null ? null : vesselNames.FirstOrDefault(v => v.Id == id);
        if (id?.StartsWith("spare:") == true)
            foreach (var family in namesAtlas.GetProperty("spare").EnumerateObject())
                foreach (var s in family.Value.EnumerateArray())
                    if (Text(s, "name") == id[6..])
                    {
                        var details = namesFleet.GetProperty("spare_details").GetProperty(id[6..]);
                        found = new(id, kind, id[6..], Text(details, "port"), null, default, s);
                    }
        found ??= vesselNames.Where(v => v.Kind == kind && Text(v.Where, "how") == how && !usedNames.Contains(v.Id)).OrderBy(v => v.Where.TryGetProperty("at", out var p) ? MathF.Pow(p[0].GetSingle() - at.X, 2) + MathF.Pow(p[1].GetSingle() - at.Z, 2) : 1e12f).FirstOrDefault();
        if (found == null)
        {
            string family = namesFleet.GetProperty("family").TryGetProperty(kind, out var familyJson) ? familyJson.GetString()! : kind;
            var spare = namesAtlas.GetProperty("spare");
            if (!spare.TryGetProperty(family, out var list)) list = spare.GetProperty("small");
            foreach (var s in list.EnumerateArray())
            {
                string name = s.GetProperty("name").GetString()!, spareId = "spare:" + name;
                if (usedNames.Contains(spareId)) continue;
                var details = namesFleet.GetProperty("spare_details").GetProperty(name);
                found = new(spareId, kind, name, Text(details, "port"), null, default, s); break;
            }
        }
        if (found != null) usedNames.Add(found.Id);
        else GD.PrintErr($"boat names: no unused name for {kind} ({how})");
        return found;
    }

    public void SetVesselName(Float f, string id) => NameVessel(f, id);
    public void NameCopy(Node3D hull, string kind, string id) => NameVessel(new Float { Outer = hull, Inner = hull, Kind = kind }, id);

    private void NameVessel(Float f, string? requested = null)
    {
        if (namesAtlas.ValueKind != JsonValueKind.Object) return;
        // Prepared pool entries get their name on first use, so growing an invisible pool consumes no names.
        if (f.Prepared) return;
        string parent = Mv.Plain(f.Outer.GetParent());
        string how = parent == "river_traffic" ? f.Kind == "liner" ? "anchorage" : "river" : parent.Contains("lock") ? "lock" : parent == "opening_bridges" ? "passage" : "place";
        string? id = requested;
        foreach (var n in new[] { f.Outer, f.Inner })
            if (requested == null && n.HasMeta("extras")) { var ex = n.GetMeta("extras").AsGodotDictionary(); if (ex.TryGetValue("vesselId", out var vi)) id = vi.AsString(); }
        if (requested == null && id != null && usedNames.Contains(id)) id = null;
        var v = TakeName(f.Kind, how, f.Outer.Position, id);
        if (v == null) return;
        f.Outer.SetMeta("vesselId", v.Id); f.Outer.SetMeta("vesselName", v.Name ?? "");
        var actual = ZonesIn(f.Inner);
        // Old baked hulls have lettering welded into their hull texture. Adding a second board would double it.
        // Their new zones and removal of the old letters require the lead's next bake.
        if (actual.Count == 0 && id != null) actual = ZonesFor(f.Kind);
        if (actual.Count == 0) return;
        foreach (var old in BakedWorld.All(f.Inner).OfType<Node3D>().Where(n => NameZonePattern.IsMatch(n.Name.ToString()) || n.Name.ToString().StartsWith("hull_names_"))) old.Visible = false;
        foreach (var child in f.Inner.GetChildren()) if (child.Name == "vessel_lettering") { f.Inner.RemoveChild(child); child.Free(); }
        var holder = new Node3D { Name = "vessel_lettering" }; f.Inner.AddChild(holder);
        foreach (var z in actual) if (z.Role != "bow" || !actual.Any(a => a.Role == "box")) AddNamePlate(holder, z, new[] { v }, new[] { z.Part });
    }

    private static List<NameZone> ZonesIn(Node3D root)
    {
        var zones = new List<NameZone>();
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D { Mesh: not null } m && NameZonePattern.Match(n.Name.ToString()) is { Success: true } match)
            {
                string zone = match.Groups[1].Value;
                zones.Add(new(zone.StartsWith("bow") ? "bow" : zone.StartsWith("box") ? "box" : "stern", m.Mesh, root.GlobalTransform.AffineInverse() * m.GlobalTransform));
            }
        return zones;
    }

    private List<NameZone> ZonesFor(string kind)
    {
        if (nameZones.TryGetValue(kind, out var zones)) return zones;
        var root = ModelLibrary.Get(kind == "ferry" ? "ferry" : "boats", new ModelLibrary.Look(TwoSided: true, Affine: 0.6))?.Copy(kind);
        if (root == null) return nameZones[kind] = new();
        // Off-tree templates: local transforms, without querying GlobalTransform.
        zones = new();
        void Visit(Node3D node, Transform3D transform)
        {
            var t = transform * node.Transform;
            if (node is MeshInstance3D { Mesh: not null } m && NameZonePattern.Match(node.Name.ToString()) is { Success: true } match)
            { string zone = match.Groups[1].Value; zones.Add(new(zone.StartsWith("bow") ? "bow" : zone.StartsWith("box") ? "box" : "stern", m.Mesh, t)); }
            foreach (var child in node.GetChildren()) if (child is Node3D n) Visit(n, t);
        }
        foreach (var child in root.GetChildren()) if (child is Node3D n) Visit(n, Transform3D.Identity);
        root.Free(); return nameZones[kind] = zones;
    }

    private List<(MultiMesh Mm, int[] Indices)> AddNamePlate(Node3D parent, NameZone z, VesselName[] vessels, Transform3D[] transforms)
    {
        var bands = new Dictionary<string, List<(int Index, int Cell)>>();
        for (int i = 0; i < vessels.Length; i++)
        {
            if (vessels[i].Cells.ValueKind != JsonValueKind.Object || !vessels[i].Cells.TryGetProperty(z.Role, out var id)) continue;
            var c = namesAtlas.GetProperty("cells")[id.GetInt32()];
            int cell = c.GetProperty("cell").GetInt32(); string key = $"{c.GetProperty("page").GetInt32()}:{cell / 16}";
            if (!bands.TryGetValue(key, out var band)) bands[key] = band = new();
            band.Add((i, cell % 16));
        }
        var result = new List<(MultiMesh, int[])>();
        foreach (var (key, band) in bands)
        {
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = z.Mesh, InstanceCount = band.Count };
            for (int i = 0; i < band.Count; i++)
            { var b = band[i]; mm.SetInstanceTransform(i, transforms[b.Index]); mm.SetInstanceCustomData(i, new Color(b.Cell % 4, b.Cell / 4, 0, 0)); }
            var node = new MultiMeshInstance3D { Name = "hull_names_" + z.Role, Multimesh = mm, MaterialOverride = nameMaterials[key] };
            // The tide changes their height by five metres; keep row culling conservative.
            node.CustomAabb = new Aabb(new Vector3(-500, -20, -500), new Vector3(1000, 100, 1000));
            parent.AddChild(node); result.Add((mm, band.Select(b => b.Index).ToArray()));
        }
        return result;
    }

    private partial class NameRows : Node
    {
        public Boats OwnerBoats = null!;
        private int floatsSeen, rowsSeen;
        private readonly List<(Row Row, MultiMesh Mm, int[] Idx, Transform3D Part)> plates = new();
        public override void _Process(double delta)
        {
            var b = OwnerBoats;
            for (; floatsSeen < b.floats.Count; floatsSeen++)
            {
                var f = b.floats[floatsSeen];
                if (!f.Outer.HasMeta("vesselId") && f.Outer.IsVisibleInTree()) b.NameVessel(f);
            }
            // Eager pool entries are named on activation, not while invisible on their shelf.
            foreach (var f in b.floats) if (!f.Prepared && !f.Outer.HasMeta("vesselId") && f.Outer.IsVisibleInTree()) b.NameVessel(f);
            for (; rowsSeen < b.rows.Count; rowsSeen++)
            {
                var row = b.rows[rowsSeen];
                if (row.Node?.GetParent() is not Node3D parent) continue;
                var names = new VesselName[row.N];
                for (int i = 0; i < row.N; i++)
                {
                    string? id = null;
                    if (parent.HasMeta("extras") && parent.GetMeta("extras").AsGodotDictionary().TryGetValue("nameVessels", out var ids))
                        foreach (var value in ids.AsGodotArray())
                        {
                            var v = value.AsGodotDictionary();
                            if (v["kind"].AsString() == row.Kind && Math.Abs(v["x"].AsDouble() - row.X[i]) < .3 && Math.Abs(v["z"].AsDouble() - row.Z[i]) < .3) { id = v["id"].AsString(); break; }
                        }
                    names[i] = b.TakeName(row.Kind, Mv.Plain(parent) == "small_boats" ? "mooring" : "row", new Vector3(row.X[i], 0, row.Z[i]), id)!;
                }
                if (names.Any(n => n == null)) continue;
                // A new bake already contains browser lettering sets. Hide these once before adding any row.
                if (rowsSeen == 0) foreach (var n in BakedWorld.All(Mv.Town)) if (n is Node3D node && node.Name.ToString().Contains("hull_names_") && node.GetParent() is Node3D p && Mv.Plain(p) is "moored" or "small_boat_lettering") node.Visible = false;
                var zones = b.ZonesFor(row.Kind);
                foreach (var z in zones.Where(z => z.Role != "bow" || !zones.Any(a => a.Role == "box")))
                    foreach (var (mm, idx) in b.AddNamePlate(parent, z, names, row.World)) plates.Add((row, mm, idx, z.Part));
            }
            foreach (var p in plates)
                for (int i = 0; i < p.Idx.Length; i++)
                {
                    int j = p.Idx[i]; var t = p.Row.World[j] * p.Part;
                    t = b.PlayerDraw(p.Row, j, t);
                    if (p.Row.Node != null && !p.Row.Node.IsVisibleInTree()) t.Basis = new Basis(Vector3.Zero, Vector3.Zero, Vector3.Zero);
                    p.Mm.SetInstanceTransform(i, t);
                }
        }
    }
}

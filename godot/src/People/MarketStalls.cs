using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Models;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>game/stalls.ts: the table stays, its keeper's work hours choose goods and extended awning
/// or rolled awning and tarpaulin. Each model uses one MultiMesh for all its copies.
/// Shop fronts use shared/shopFront.ts's exact wall-length rule, keeping doors and corners clear.</summary>
[GamePart(210)]
public partial class MarketStalls : Node
{
    private sealed record Part(Mesh Mesh, Transform3D Local);
    public sealed class Stall
    {
        public string Keeper = "", Label = "";
        public double X, Z, Yaw, Scale = 1;
        public bool Open;
        internal string[] Always = Array.Empty<string>(), Day = Array.Empty<string>(), Night = Array.Empty<string>();
    }
    public static MarketStalls? I { get; private set; }
    public readonly List<Stall> List = new();
    public int OpenCount => List.Count(s => s.Open);
    public double RebuildMs { get; private set; }
    private readonly Dictionary<string, List<Part>> parts = new();
    private readonly Dictionary<Mesh, MultiMeshInstance3D> batches = new();
    private Townspeople? town;
    private ModelLibrary.Model? model;
    private Node3D root = null!;
    private bool loaded;
    private double wait;
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        root = new Node3D { Name = "live_town_stalls" }; Main.I.View.AddChild(root);
    }
    private static bool Rough(string where) => Regex.IsMatch(where, "vismarkt|werf|rijn|kaai|quay|canal|lane|steenplein", RegexOptions.IgnoreCase);
    private List<Part> Parts(string name)
    {
        if (parts.TryGetValue(name, out var cached)) return cached;
        var found = new List<Part>(); parts[name] = found;
        string use = model!.Roots.ContainsKey(name + "_bare") ? name + "_bare" : name;
        if (!model.Roots.TryGetValue(use, out var proto)) return found;
        void Read(Node n, Transform3D at)
        {
            if (n is MeshInstance3D mi && mi.Mesh != null) found.Add(new Part(mi.Mesh, at));
            foreach (var child in n.GetChildren()) Read(child, child is Node3D spatial ? at * spatial.Transform : at);
        }
        Read(proto, new Transform3D(Basis.Identity.Scaled(proto.Scale), Vector3.Zero));
        // The one common sack in each Blender socket, rather than the old sacks duplicated into every model.
        if (sockets != null && sockets.RootElement.TryGetProperty(name, out var rows)) foreach (var row in rows.EnumerateArray())
        {
            bool open = row.GetProperty("k").GetString() == "open";
            float l = open ? row.GetProperty("r").GetSingle() * 2 : row.GetProperty("L").GetSingle();
            float h = open ? row.GetProperty("h").GetSingle() : row.GetProperty("H").GetSingle(), w = open ? l : row.GetProperty("W").GetSingle();
            var sack = Carried.Sack(l, h, w);
            if (sack == null) continue;
            var m = row.GetProperty("m");
            var local = new Transform3D(new Basis(new Vector3(m[0].GetSingle(), m[1].GetSingle(), m[2].GetSingle()), new Vector3(m[4].GetSingle(), m[5].GetSingle(), m[6].GetSingle()), new Vector3(m[8].GetSingle(), m[9].GetSingle(), m[10].GetSingle())), new Vector3(m[12].GetSingle(), m[13].GetSingle(), m[14].GetSingle()));
            found.Add(new Part(sack.Mesh, local * sack.Transform)); sack.Free();
        }
        return found;
    }
    private JsonDocument? sockets;
    private void Load()
    {
        loaded = true;
        model = ModelLibrary.Get("stalls", new ModelLibrary.Look(TwoSided: true, Affine: 0.6, VertexColor: true));
        if (model == null) return;
        string shared = Path.GetDirectoryName(Water.CityJson())!;
        string socketFile = Path.GetFullPath(Path.Combine(shared, "..", "client", "src", "game", "stalls_sack_sockets.json"));
        if (File.Exists(socketFile)) sockets = JsonDocument.Parse(File.ReadAllText(socketFile));
        foreach (var s in town!.Data!.Stalls)
        {
            bool rough = Rough(s.Place);
            List.Add(new Stall { X = s.X, Z = s.Z, Yaw = Math.Atan2(s.Face.X, s.Face.Z), Keeper = s.Keeper ?? "", Label = s.Place,
                Always = new[] { "stall_frame" }, Day = new[] { rough ? "stall_awning_canvas" : "stall_awning", rough || s.Goods == "fish" ? "" : "stall_cloth", "stall_goods_" + s.Goods, "stall_more_" + s.Goods }, Night = new[] { "stall_awning_rolled", "stall_tarp" } });
        }
        using var build = JsonDocument.Parse(File.ReadAllText(Path.Combine(shared, "city_build.json")));
        foreach (var shop in town.Data.Shops)
        {
            if (shop.Goods == null) continue;
            var spot = ShopSpot(build.RootElement.GetProperty("houses"), shop.Wall, shop.Out);
            if (spot == null) continue;
            var p = spot.Value;
            string goods = shop.Id.StartsWith("cobbler") ? "boots" : shop.Goods == "cloth" ? "wares" : shop.Goods;
            string far = p.side.X * -shop.Out.Z + p.side.Z * shop.Out.X > 0 ? "shop_sack_l" : "shop_sack_r";
            List.Add(new Stall { X = p.x, Z = p.z, Yaw = Math.Atan2(shop.Out.X, shop.Out.Z), Scale = p.scale, Keeper = shop.Keeper, Label = shop.Id,
                Always = new[] { "shop_table" }, Day = new[] { p.awning ? "shop_awning" : "", "shop_goods_" + goods, "shop_more_" + goods, goods == "fish" ? "" : far, Rough(shop.Id + " " + shop.Label) ? "shop_mud" : "" }, Night = new[] { p.awning ? "shop_awning_rolled" : "", "shop_tarp" } });
        }
        foreach (var n in BakedWorld.All(Main.I.World)) if (n.Name == "town_stalls" && n is Node3D old) old.Visible = false;
        UpdateHours(true);
    }
    private static (double x, double z, double scale, bool awning, Pt side)? ShopSpot(JsonElement houses, Pt wall, Pt outward)
    {
        double sx = -outward.Z, sz = outward.X, best = double.PositiveInfinity, plus = 4.5, minus = 4.5;
        foreach (var house in houses.EnumerateArray())
        {
            if (house.TryGetProperty("gone", out var gone) && gone.ValueKind == JsonValueKind.True) continue;
            var fp = house.GetProperty("fp");
            for (int i = 0; i < fp.GetArrayLength(); i++)
            {
                var a = fp[i]; var b = fp[(i + 1) % fp.GetArrayLength()];
                double ax = a[0].GetDouble(), az = a[1].GetDouble(), bx = b[0].GetDouble(), bz = b[1].GetDouble(), ex = bx - ax, ez = bz - az, length = Whereabouts.Hypot(ex, ez);
                if (length < 1 || Math.Abs((ex * outward.X + ez * outward.Z) / length) > 0.1) continue;
                double t = Math.Clamp(((wall.X - ax) * ex + (wall.Z - az) * ez) / (length * length), 0, 1), d = Whereabouts.Hypot(wall.X - (ax + ex * t), wall.Z - (az + ez * t));
                if (d > 0.25 || t <= 0 || t >= 1 || d >= best) continue;
                double pa = (ax - wall.X) * sx + (az - wall.Z) * sz, pb = (bx - wall.X) * sx + (bz - wall.Z) * sz;
                best = d; plus = Math.Max(pa, pb); minus = -Math.Min(pa, pb);
            }
        }
        (double scale, bool awning, double centre)? Layout(double room)
        {
            double span = room - 0.7 - 0.2;
            if (span >= 2.6) return (1, true, 2);
            if (span >= 1.8) return (span / 2.6, true, 0.7 + span / 2);
            return span >= 1.2 ? (Math.Min(1, span / 1.6), false, 0.7 + span / 2) : null;
        }
        var p = Layout(plus); var m = Layout(minus);
        double Score((double scale, bool awning, double centre)? q) => q is { } v ? v.scale + (v.awning ? 1 : 0) : -1;
        int sign = p is { scale: 1, awning: true } ? 1 : Score(m) > Score(p) ? -1 : 1;
        var layout = sign > 0 ? p : m;
        if (layout is not { } l) return null;
        var side = new Pt(sx * sign, sz * sign);
        return (wall.X + side.X * l.centre, wall.Z + side.Z * l.centre, l.scale, l.awning, side);
    }
    private void UpdateHours(bool force = false)
    {
        var keepers = town!.Data!.Residents.ToDictionary(r => r.Id);
        bool changed = force;
        foreach (var s in List)
        {
            bool open = keepers.TryGetValue(s.Keeper, out var r) && Whereabouts.ActivityAt(r.Sched, town.Day, town.Hour).Act == "work";
            if (s.Open != open) { s.Open = open; changed = true; }
        }
        if (!changed) return;
        ulong started = Time.GetTicksUsec();
        var instances = new Dictionary<Mesh, List<Transform3D>>();
        foreach (var s in List)
        {
            var at = new Transform3D(new Basis(Vector3.Up, (float)s.Yaw).Scaled(new Vector3((float)s.Scale, 1, 1)), new Vector3((float)s.X, (float)town.Walk!.BaseAt(s.X, s.Z), (float)s.Z));
            foreach (var name in s.Always.Concat(s.Open ? s.Day : s.Night))
                foreach (var part in Parts(name))
                {
                    if (!instances.TryGetValue(part.Mesh, out var list)) instances[part.Mesh] = list = new();
                    list.Add(at * part.Local);
                }
        }
        foreach (var batch in batches.Values) batch.Visible = false;
        foreach (var (mesh, transforms) in instances)
        {
            if (!batches.TryGetValue(mesh, out var batch)) { batch = new MultiMeshInstance3D(); batches[mesh] = batch; root.AddChild(batch); }
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = mesh, InstanceCount = transforms.Count };
            for (int i = 0; i < transforms.Count; i++) mm.SetInstanceTransform(i, transforms[i]);
            batch.Multimesh = mm; batch.Visible = true;
        }
        RebuildMs = (Time.GetTicksUsec() - started) / 1000.0;
    }
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Paused) return;
        if (!loaded) Load();
        if ((wait -= delta) > 0 || model == null) return;
        wait = 1; UpdateHours();
    }
    public override void _ExitTree() { root.QueueFree(); sockets?.Dispose(); if (I == this) I = null; }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Scheldemist.Play;

// M8f "shared goods" (shared/goods.ts): the liftable goods of the quays are the SERVER's. It keeps one list of every
// item and tells every PC each change; a PC only draws that list and asks the server to lift, put down or hand over.
// The records carry the server's own names (Api.Json turns JobId into job_id by itself; a name that is not
// snake_case there has its own [JsonPropertyName]).

/// <summary>One liftable thing as the server has it (shared/goods.ts GoodsItem).</summary>
public sealed record GoodsItem
{
    /// <summary>Stable: own:&lt;owner&gt;:&lt;n&gt;, pile:&lt;pile&gt;:&lt;n&gt;, job:&lt;job&gt;:&lt;n&gt;, spawn:&lt;n&gt; for the rest.</summary>
    public string Id { get; init; } = "";
    /// <summary>"crates", "sacks", "barrels", "hides", "rope", "parcel" or "chests".</summary>
    public string Kind { get; init; } = "";
    /// <summary>Its model when not a job's plain goods: "cask", "p:&lt;model&gt;" (props.glb), "q:&lt;model&gt;" (quaygoods.glb).</summary>
    public string? Look { get; init; }
    public double? H { get; init; }
    public double? Sc { get; init; }
    [JsonPropertyName("cartOnly")] public bool? CartOnly { get; init; }
    public string? Owner { get; init; }
    public int? Job { get; init; }
    public double X { get; init; }
    public double Z { get; init; }
    /// <summary>Height of its base.</summary>
    public double Y { get; init; }
    public double Rot { get; init; }
    /// <summary>What it rests on: nothing (the ground), one item (a straight stack), or two (a pyramid of barrels).</summary>
    public List<string> On { get; init; } = new();
    /// <summary>Who has it now: {p: player}, {npc: id} or {cart: id}; null: it lies.</summary>
    public JsonElement? By { get; init; }
    public bool? Broken { get; init; }
    public bool? Heavy { get; init; }
    public int N { get; init; }
    public int Rev { get; init; }
    public double[]? Home { get; init; }
    public bool? Keep { get; init; }

    [JsonIgnore] public bool Lies => By == null || By.Value.ValueKind != JsonValueKind.Object;
    /// <summary>The player who carries it, or null.</summary>
    [JsonIgnore] public int? ByPlayer => !Lies && By!.Value.TryGetProperty("p", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : null;
}

/// <summary>GET /api/goods.</summary>
public sealed record GoodsList
{
    public int V { get; init; }
    public int You { get; init; } = 1;
    public List<GoodsItem> Items { get; init; } = new();
}

/// <summary>POST /api/goods: 200 {ok, v, items, gone}; refused (409) {ok: false, error, why, v, items as they are now}.</summary>
public sealed record GoodsReply
{
    public bool Ok { get; init; }
    public int V { get; init; }
    public List<GoodsItem> Items { get; init; } = new();
    public List<string>? Gone { get; init; }
    public string? Error { get; init; }
    public string? Why { get; init; }
}

/// <summary>The push to every PC: what changed (whole items) and what is gone.</summary>
public sealed record GoodsPush
{
    public int V { get; init; }
    public List<GoodsItem> Items { get; init; } = new();
    public List<string> Gone { get; init; } = new();
    public string Why { get; init; } = "";
    public JsonElement? Who { get; init; }
    public bool? Full { get; init; }
    public double[]? At { get; init; }
}

/// <summary>game/props.ts GOODS: how a kind of goods is called, carried and heard.</summary>
public sealed record GoodsInfo(string One, float H, float Speed, string Thud, float HoldX, float HoldY, float HoldZ, string Broken);

/// <summary>The rules of shared/goods.ts both the server and the game run, so a put down looks the same before the server's answer is in.</summary>
public static class GoodsRules
{
    public static readonly Dictionary<string, GoodsInfo> Info = new()
    {
        ["crates"] = new("crate", 0.7f, 0.62f, "wood", 0, -0.72f, -0.86f, "The crate splits along a seam. Coffee beans rattle out onto the stones."),
        ["sacks"] = new("sack", 0.3f, 0.6f, "soft", 0, -0.62f, -0.8f, "A seam gives. Grain runs out of the sack in a thin stream."),
        ["barrels"] = new("barrel", 0.9f, 0.55f, "wood", 0, -0.8f, -0.85f, "A stave cracks. It smells sharp and sweet: jenever, leaking into your sleeve."),
        ["hides"] = new("bundle of hides", 0.28f, 0.66f, "soft", 0, -0.6f, -0.8f, "The cord snaps. One of the hides is fine soft leather, the kind a man could sell."),
        ["rope"] = new("coil of rope", 0.3f, 0.75f, "soft", 0, -0.62f, -0.78f, "The coil comes loose. Nobody would miss a length of good tarred rope."),
        ["chests"] = new("chest", 0.47f, 0.6f, "wood", 0, -0.7f, -0.85f, "The hasp gives. Folded linen, a Bible and a pair of good boots: all a family owns."),
        ["parcel"] = new("parcel", 0.3f, 0.95f, "plank", 0.18f, -0.5f, -0.62f, "The paper tears. Inside, something wrapped in oilcloth, heavier than it looks."),
    };

    public static GoodsInfo Of(string kind) => Info.TryGetValue(kind, out var g) ? g : Info["crates"];

    /// <summary>The quay's own casks (props.glb "barrel"): a little taller than a job's barrel.</summary>
    public const double CaskH = 0.95;
    /// <summary>Stacks: three high at most (a pyramid's rows count as levels).</summary>
    public const int MaxStack = 3;
    /// <summary>Half the footprint of a job's item (its collider).</summary>
    public const float Foot = 0.33f;
    /// <summary>An item within this of a point is "there" (to stack on, to find a free slot).</summary>
    public const double Touch = 0.55;

    /// <summary>FNV-1a, 32 bits (over the UTF-16 code units, as the browser's charCodeAt).</summary>
    public static uint Hash32(string s)
    {
        uint h = 0x811c9dc5;
        foreach (char c in s)
        {
            h ^= c;
            h = unchecked(h * 0x01000193);
        }
        return h;
    }

    /// <summary>The turn an item gets when it is put down for the n-th time: 0 to 0.4 rad.</summary>
    public static double RotFor(string id, int n) => Math.Round(Hash32($"{id}#{n}") / 4294967296.0 * 0.4 * 1000) / 1000;

    public static double HeightOf(GoodsItem it) => it.H ?? (it.Look == "cask" ? CaskH : Of(it.Kind).H);
    public static double TopOf(GoodsItem it) => it.Y + HeightOf(it);
    public static double R3(double v) => Math.Round(v * 1000) / 1000;

    public static bool HasAbove(IEnumerable<GoodsItem> list, string id) => list.Any(o => o.Lies && o.On.Contains(id));

    /// <summary>Its level: 1 on the ground, one more than the highest it rests on.</summary>
    public static int LevelOf(IReadOnlyList<GoodsItem> list, GoodsItem it, int guard = 0)
    {
        if (it.On.Count == 0 || guard > 8) return 1;
        int m = 0;
        foreach (string id in it.On)
        {
            var b = list.FirstOrDefault(o => o.Id == id);
            if (b != null) m = Math.Max(m, LevelOf(list, b, guard + 1));
        }
        return m + 1;
    }

    public sealed record Placement(double X, double Z, double Y, List<string> On);

    /// <summary>
    /// Where an item set down at (x, z) comes to rest among the lying goods (`skip`: itself): on the top-most item
    /// there (a straight stack), on two barrels side by side (a pyramid: barrels only), or on the ground. Null: the
    /// stack there is full. (shared/goods.ts placeAt)
    /// </summary>
    public static Placement? PlaceAt(IEnumerable<GoodsItem> list, string kind, double x, double z, string? skip = null)
    {
        var lying = list.Where(o => o.Lies && o.Id != skip && Math.Abs(o.X - x) < 3 && Math.Abs(o.Z - z) < 3).ToList();
        var tops = lying.Where(o => !lying.Any(a => a.On.Contains(o.Id))).ToList();
        GoodsItem? under = null;
        double underD = double.PositiveInfinity;
        foreach (var o in tops)
        {
            double d = Math.Sqrt((o.X - x) * (o.X - x) + (o.Z - z) * (o.Z - z));
            if (d > Touch) continue;
            // the highest there, the nearer of two at one height
            if (under == null || o.Y > under.Y + 1e-6 || (Math.Abs(o.Y - under.Y) <= 1e-6 && d < underD))
            {
                under = o;
                underD = d;
            }
        }
        if (kind == "barrels")
        {
            // a pyramid: between two barrels of one row, when the point is nearer their middle than any one of them
            (GoodsItem a, GoodsItem b, double d, double mx, double mz)? best = null;
            var casks = tops.Where(o => o.Kind == "barrels").ToList();
            for (int i = 0; i < casks.Count; i++)
                for (int j = i + 1; j < casks.Count; j++)
                {
                    var a = casks[i];
                    var b = casks[j];
                    if (Math.Abs(a.Y - b.Y) > 0.05) continue;
                    double ab = Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Z - b.Z) * (a.Z - b.Z));
                    if (ab < 0.45 || ab > 1.0) continue;
                    double mx = (a.X + b.X) / 2, mz = (a.Z + b.Z) / 2;
                    double d = Math.Sqrt((mx - x) * (mx - x) + (mz - z) * (mz - z));
                    if (d < 0.3 && (best == null || d < best.Value.d)) best = (a, b, d, mx, mz);
                }
            if (best != null && best.Value.d < underD)
            {
                int lv = Math.Max(LevelOf(lying, best.Value.a), LevelOf(lying, best.Value.b));
                if (lv >= MaxStack) return null;
                return new Placement(R3(best.Value.mx), R3(best.Value.mz), R3(Math.Max(TopOf(best.Value.a), TopOf(best.Value.b))), new List<string> { best.Value.a.Id, best.Value.b.Id });
            }
        }
        if (under != null)
        {
            if (LevelOf(lying, under) >= MaxStack) return null;
            return new Placement(under.X, under.Z, R3(TopOf(under)), new List<string> { under.Id });
        }
        return new Placement(R3(x), R3(z), 0, new List<string>());
    }
}

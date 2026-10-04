using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Scheldemist.Town;

/// <summary>A point on the ground: [x, z] in the game's data.</summary>
public readonly record struct Pt(double X, double Z);

/// <summary>[from hour, to hour, what, where]; hours may pass 24 (server town/schedule.ts Seg).</summary>
public readonly record struct Seg(double A, double B, string Act, string? Where);

public sealed class Schedule
{
    public Seg[] Day = Array.Empty<Seg>();
    public Seg[] Sunday = Array.Empty<Seg>();
}

/// <summary>What a resident does for work and where (client net/api.ts WorkSpec).</summary>
public sealed class WorkSpec
{
    public string Place = "";
    public string Kind = "";
    /// <summary>x, z, yaw.</summary>
    public double[]? At;
    public Pt? A;
    public Pt? B;
    public Pt[]? Route;
    public double[]? Faces;
    public Pt? Door;
    public int? Stall;
    public string? Shop;
    public bool Seat;
    public string? Motion;
}

/// <summary>A resident as GET /api/town gives him (client net/api.ts TownResident).</summary>
public sealed class Resident
{
    public string Id = "";
    public string Name = "";
    public string First = "";
    public int Age = 35;
    public string Sex = "m";
    public string Kind = "";
    public string Trade = "";
    public string Label = "";
    public double HomeX, HomeZ, HomeSx, HomeSz;
    public WorkSpec Work = new();
    public Schedule Sched = new();
    public bool Dog;
    /// <summary>His dog's look ("dog_brown" ...), or null.</summary>
    public string? DogLook;
    public string? Mate;

    // kept answers of the shared sum (Whereabouts.cs): his day routes, by day
    internal Dictionary<int, Whereabouts.Stop[]> RouteCache = new();
    internal (int day, int gen, Whereabouts.Stop[] stops)? PartialRoute;
    internal readonly Whereabouts.Where WhereValue = new(), WhereSecond = new();
    internal uint? RoundHash;
}

public sealed class TownPlace
{
    public string Label = "";
    public double X, Z, R;
    public Pt? Door;
    public Pt? Out;
    public Pt[]? Route;
}

public sealed class TownStall
{
    public string Place = "";
    public double X, Z;
    public Pt Face;
    public string Goods = "";
    public string? Keeper;
}

public sealed class TownShop
{
    public string Id = "";
    public string Label = "";
    public Pt Door, Wall, Out;
    public string? Goods;
    public string Keeper = "";
}

/// <summary>The town the server made (GET /api/town): the client walks it by the game clock.</summary>
public sealed class TownData
{
    public Dictionary<string, Dictionary<(string Act, string Place), Pt>> Anchors = new();
    public long Seed;
    public Dictionary<string, TownPlace> Places = new();
    public List<TownStall> Stalls = new();
    public List<TownShop> Shops = new();
    public List<(string id, string spot)> Employers = new();
    public List<Resident> Residents = new();

    // kept answers of the shared sum
    internal Dictionary<string, (double fraction, double mps)>? HaulCrews;

    private static Pt P(JsonElement e) => new(e[0].GetDouble(), e[1].GetDouble());
    private static Pt? Po(JsonElement o, string k) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Array && e.GetArrayLength() >= 2 ? P(e) : null;
    private static string S(JsonElement o, string k, string d = "") => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() ?? d : d;
    private static string? So(JsonElement o, string k) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
    private static double N(JsonElement o, string k, double d = 0) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Number ? e.GetDouble() : d;
    private static Pt[]? Pts(JsonElement o, string k) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().Select(P).ToArray() : null;
    private static double[]? Nums(JsonElement o, string k) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().Select(x => x.GetDouble()).ToArray() : null;

    private static Seg[] Segs(JsonElement o, string k) => o.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Array
        ? e.EnumerateArray().Select(s => new Seg(s[0].GetDouble(), s[1].GetDouble(), s[2].GetString() ?? "home", s.GetArrayLength() > 3 && s[3].ValueKind == JsonValueKind.String ? s[3].GetString() : null)).ToArray()
        : Array.Empty<Seg>();

    public static Schedule ScheduleOf(JsonElement sched) => new() { Day = Segs(sched, "day"), Sunday = Segs(sched, "sunday") };

    public static TownData Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var t = new TownData { Seed = (long)N(root, "seed") };
        if (root.TryGetProperty("anchors", out var anchors))
            foreach (var person in anchors.EnumerateObject())
            {
                var points = new Dictionary<(string Act, string Place), Pt>();
                foreach (var point in person.Value.EnumerateObject())
                {
                    int colon = point.Name.IndexOf(':');
                    if (colon <= 0) throw new JsonException("invalid shared anchor key");
                    points[(point.Name[..colon], point.Name[(colon + 1)..])] = new Pt(point.Value[0].GetDouble(), point.Value[1].GetDouble());
                }
                t.Anchors[person.Name] = points;
            }
        foreach (var p in root.GetProperty("places").EnumerateObject())
            t.Places[p.Name] = new TownPlace { Label = S(p.Value, "label"), X = N(p.Value, "x"), Z = N(p.Value, "z"), R = N(p.Value, "r"), Door = Po(p.Value, "door"), Out = Po(p.Value, "out"), Route = Pts(p.Value, "route") };
        foreach (var s in root.GetProperty("stalls").EnumerateArray())
            t.Stalls.Add(new TownStall { Place = S(s, "place"), X = N(s, "x"), Z = N(s, "z"), Face = Po(s, "face") ?? new Pt(0, 1), Goods = S(s, "goods"), Keeper = So(s, "keeper") });
        foreach (var s in root.GetProperty("shops").EnumerateArray())
            t.Shops.Add(new TownShop { Id = S(s, "id"), Label = S(s, "label"), Door = Po(s, "door") ?? default, Wall = Po(s, "wall") ?? default, Out = Po(s, "out") ?? new Pt(0, -1), Goods = So(s, "goods"), Keeper = S(s, "keeper") });
        foreach (var e in root.GetProperty("employers").EnumerateArray()) t.Employers.Add((S(e, "id"), S(e, "spot")));
        foreach (var r in root.GetProperty("residents").EnumerateArray())
        {
            var home = r.GetProperty("home");
            var w = r.GetProperty("work");
            var sched = r.GetProperty("sched");
            t.Residents.Add(new Resident
            {
                Id = S(r, "id"), Name = S(r, "name"), First = S(r, "first"), Age = (int)N(r, "age", 35), Sex = S(r, "sex", "m"), Kind = S(r, "kind"), Trade = S(r, "trade"), Label = S(r, "label"),
                HomeX = N(home, "x"), HomeZ = N(home, "z"), HomeSx = N(home, "sx"), HomeSz = N(home, "sz"),
                Work = new WorkSpec
                {
                    Place = S(w, "place"), Kind = S(w, "kind"), At = Nums(w, "at"), A = Po(w, "a"), B = Po(w, "b"), Route = Pts(w, "route"), Faces = Nums(w, "faces"), Door = Po(w, "door"),
                    Stall = w.TryGetProperty("stall", out var st) && st.ValueKind == JsonValueKind.Number ? st.GetInt32() : null, Shop = So(w, "shop"),
                    Seat = w.TryGetProperty("seat", out var seat) && seat.ValueKind == JsonValueKind.True, Motion = So(w, "motion"),
                },
                Sched = ScheduleOf(sched),
                Dog = r.TryGetProperty("dog", out var dog) && dog.ValueKind == JsonValueKind.Object,
                DogLook = dog.ValueKind == JsonValueKind.Object ? So(dog, "look") ?? "dog_brown" : null,
                Mate = So(r, "mate"),
            });
        }
        return t;
    }
}

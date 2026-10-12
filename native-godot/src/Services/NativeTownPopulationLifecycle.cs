using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>One source-ordered native fresh-town pipeline. Ordinary startup and save loads keep their residents.</summary>
public sealed class NativeTownPopulationLifecycle : INativeServiceModule
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C => population.Host.Context;
    public NativeTownAssets Assets { get; }
    public NativeTownTransportPopulation Transport { get; }
    public NativeTownVisitorsPopulation Visitors { get; }
    public NativeTownLampsPopulation Lamps { get; }
    public Func<uint> NewSeed = Seed;
    public Action<string, int>? StageCompleted;
    public static readonly string[] StageOrder = { "town", "garrison", "press", "homes", "lamps", "visitors", "emigrants", "landmarks", "bike", "cart", "transport", "lively", "night", "shops", "cafes", "back", "standing", "wall", "mills" };
    private static string S(JsonNode? node, string key, string fallback = "") => NativeTownPopulation.S(node, key, fallback);
    private static double N(JsonNode? node) => NativeTownPopulation.N(node);
    public NativeTownPopulationLifecycle(NativeTownPopulation population, NativeEmigrants emigrants)
    {
        this.population = population; Assets = new(population); Transport = new(population, Assets); Visitors = new(population); Lamps = new(population);
        if (population.Augment.Count != 0) throw new InvalidOperationException("Install one population lifecycle before adding separate population callbacks.");
        var press = new NativeTownPressPopulation(population); var homes = new NativeTownHomesPopulation(population); var immigrantPopulation = new NativeTownEmigrantsPopulation(population, emigrants); var landmarks = new NativeTownLandmarksPopulation(population); var workshops = new NativeTownWorkshopsPopulation(population); var lively = new NativeTownLivelyPopulation(population); var night = new NativeTownNightPopulation(population); var shops = new NativeTownShopsPopulation(population); var cafes = new NativeTownCafesPopulation(population); var back = new NativeTownBackPopulation(population); var standing = new NativeTownStandingPopulation(population); var wall = new NativeTownWallPopulation(population); var mills = new NativeTownMillsPopulation(population);
        void Add(string stage, Action<uint> ensure) => population.Augment.Add(seed => { ensure(seed); StageCompleted?.Invoke(stage, C.Scalar<int>("SELECT COUNT(*) FROM resident")); });
        // Generate already contains the original garrison before these seventeen additions.
        population.Augment.Add(_ => { int count = C.Scalar<int>("SELECT COUNT(*) FROM resident"); StageCompleted?.Invoke("town", count); StageCompleted?.Invoke("garrison", count); });
        Add("press", press.Ensure); Add("homes", seed => { homes.Ensure(seed); }); Add("lamps", seed => { Lamps.Ensure(seed); }); Add("visitors", seed => { Visitors.Ensure(seed); }); Add("emigrants", immigrantPopulation.Ensure); Add("landmarks", landmarks.Ensure);
        Add("bike", seed => { workshops.EnsureBike(seed); }); Add("cart", seed => { workshops.EnsureCart(seed); }); Add("transport", seed => { Transport.Ensure(seed); }); Add("lively", seed => { lively.Ensure(seed); }); Add("night", seed => { night.Ensure(seed); }); Add("shops", seed => { shops.Ensure(seed); }); Add("cafes", seed => { cafes.Ensure(seed); }); Add("back", seed => { back.Ensure(seed); }); Add("standing", seed => { standing.Ensure(seed); }); Add("wall", seed => { wall.Ensure(seed); }); Add("mills", seed => { mills.Ensure(seed); });
    }
    private static uint Seed()
    {
        if (uint.TryParse(Environment.GetEnvironmentVariable("SCHELDEMIST_TOWN_SEED"), out var seed) && seed > 0) return seed;
        return BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4)) & 0x7fffffffu;
    }
    private JsonNode? Setting(string key)
    {
        string? raw = C.Scalar<string>("SELECT value_json FROM game_setting WHERE key=$p0", key); if (raw == null) return null; try { return JsonNode.Parse(raw); } catch { return null; }
    }
    private bool IsSize(JsonNode? size) => size is JsonValue v && v.TryGetValue<string>(out var text) && population.Facts["TOWN_SIZES"]!.AsObject().ContainsKey(text);
    private static bool IsEventSize(JsonNode? size) => size is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number && N(v) is 20 or 50 or 100;
    public int EventSize() { var size = Setting("event_size"); return IsEventSize(size) ? (int)N(size) : 100; }
    public int EventPeopleMax() => Math.Min(100, EventSize());
    public int ClampEventCount(double count) => double.IsFinite(count) ? (int)Math.Clamp(Math.Floor(count + .5), 0, EventPeopleMax()) : 0;
    public string TownSize() { var size = Setting("town_size"); return IsSize(size) ? size!.GetValue<string>() : "normal"; }
    public JsonObject View()
    {
        string current = S(C.World("town"), "size", "normal"); if (!population.Facts["TOWN_SIZES"]!.AsObject().ContainsKey(current)) current = "normal";
        return new JsonObject { ["eventSize"] = EventSize(), ["eventSizes"] = new JsonArray(20, 50, 100), ["townSize"] = TownSize(), ["townSizes"] = new JsonArray(population.Facts["TOWN_SIZES"]!.AsObject().Select(p => (JsonNode)new JsonObject { ["id"] = p.Key, ["label"] = S(p.Value, "label"), ["about"] = p.Value!["about"]!.DeepClone() }).ToArray()), ["current"] = new JsonObject { ["size"] = current, ["residents"] = C.Scalar<int>("SELECT COUNT(*) FROM resident") } };
    }
    public JsonObject Update(JsonObject body)
    {
        if (body.ContainsKey("eventSize") && !IsEventSize(body["eventSize"])) throw new NativeServiceException("event size is one of 20, 50, 100", 400);
        if (body.ContainsKey("townSize") && !IsSize(body["townSize"])) throw new NativeServiceException("town size is one of " + string.Join(", ", population.Facts["TOWN_SIZES"]!.AsObject().Select(p => p.Key)), 400);
        C.Atomic(() => { foreach (var pair in new[] { ("eventSize", "event_size"), ("townSize", "town_size") }) if (body.ContainsKey(pair.Item1)) C.Execute("INSERT INTO game_setting(key,value_json) VALUES($p0,$p1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", pair.Item2, body[pair.Item1]!.ToJsonString()); }); return View();
    }
    public JsonObject Rebuild(uint seed, string size)
    {
        population.InvalidateDoors(); Assets.Clear(); var town = population.Rebuild(seed, size); Assets.Clear(); return town;
    }
    public void RefreshLamps() { if (C.Scalar<int>("SELECT COUNT(*) FROM resident") > 0) Lamps.Ensure((uint)N(C.World("town")?["seed"])); }
    public void Register(NativeServiceHost host)
    {
        host.Register("GET", "/api/settings/population", _ => View()); host.Register("POST", "/api/settings/population", r => { if (r.PlayerId != 1) throw new NativeServiceException("only the host changes population settings", 403); return Update(r.Body); });
        host.NewGame += () => { Rebuild(NewSeed(), TownSize()); };
        host.Loaded += () => { Assets.Clear(); RefreshLamps(); };
        // Startup never regenerates an imported or saved town. Only current scene lamp tours may change.
        if (C.Scalar<int>("SELECT COUNT(*) FROM resident") == 0) Rebuild(NewSeed(), TownSize()); else RefreshLamps();
    }
}

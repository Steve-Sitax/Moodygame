using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.Services;

/// <summary>Resident records, public town data, schedules, shop hours and native-scene route service.
/// Resident IDs and households live in SQLite; the existing pure C# whereabouts sum owns their movement.</summary>
public sealed class NativeTown : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private Dictionary<string, JsonObject>? residents;
    private TownData? model;
    private JsonObject? privateTown;
    public Func<double, double, double, bool> AnchorOpen = Ways.Open;
    public Func<double, double, bool> AnchorReachable = Ways.Reachable;
    public Func<double, double, double, (double x, double z)?> AnchorSnap = (x, z, maximum) => Ways.NearestOpen(x, z, maximum) is { } p ? (p.X, p.Y) : null;
    private readonly Dictionary<string, JsonArray?> ways = new();
    private readonly object waysGate = new();
    private long waysRevision;
    private Task<JsonObject>? planned;
    private readonly Dictionary<string, (double Lag, double At)> lags = new();
    private double sweptAt = -1;
    private long sweptMilliseconds;
    public NativeTown(NativeServiceHost host) => this.host = host;
    public long Revision => Interlocked.Read(ref waysRevision);
    public IReadOnlyDictionary<string, JsonObject> Residents => residents ??= C.Rows("SELECT data_json FROM resident ORDER BY id")
        .Select(row => JsonNode.Parse(row!["data_json"]!.GetValue<string>())!.AsObject()).ToDictionary(row => S(row, "id"), StringComparer.Ordinal);
    public JsonObject? Resident(string id) => Residents.TryGetValue(id, out var value) ? value : null;
    public TownData Model => model ??= TownData.Parse(PublicTown().ToJsonString());
    public void Clear() { residents = null; model = null; privateTown = null; lock (waysGate) { ways.Clear(); Interlocked.Increment(ref waysRevision); planned = null; } lags.Clear(); sweptAt = -1; sweptMilliseconds = 0; }
    internal static string S(JsonNode? row, string key, string fallback = "") => row?[key]?.GetValue<string>() ?? fallback;
    internal static double N(JsonNode? value)
    {
        if (value is not JsonValue node) return 0;
        if (node.TryGetValue<double>(out var number)) return number;
        if (node.TryGetValue<int>(out var integer)) return integer;
        return node.TryGetValue<long>(out var wide) ? wide : 0;
    }
    public JsonObject PrivateTown()
    {
        if (privateTown != null) return privateTown.DeepClone().AsObject();
        var town = C.World("town")?.DeepClone().AsObject() ?? throw new NativeServiceException("Town records are missing", 500);
        town["residents"] = new JsonArray(Residents.Values.Select(r => (JsonNode)r.DeepClone()).ToArray());
        var modelInput = town.DeepClone().AsObject(); modelInput["employers"] ??= new JsonArray(); var source = TownData.Parse(modelInput.ToJsonString()); var anchors = new JsonObject();
        foreach (var r in source.Residents) {
            var fixedPoints = new JsonObject();
            foreach (var seg in r.Sched.Day.Concat(r.Sched.Sunday)) {
                string act = seg.Act, place = seg.Where ?? (act == "work" ? "work" : "home"); if (act is not ("stroll" or "play" or "loiter" or "market")) continue;
                var anchor = Whereabouts.AnchorOf(r, source, act, place); if (anchor.Indoor || AnchorOpen(anchor.X, anchor.Z, .45) && AnchorReachable(anchor.X, anchor.Z)) continue;
                if (!source.Places.TryGetValue(place, out var location)) source.Places.TryGetValue(System.Text.RegularExpressions.Regex.Replace(place, "^[a-z]+:", ""), out location);
                var route = location?.Route?.Where(p => AnchorOpen(p.X, p.Z, .45) && AnchorReachable(p.X, p.Z)).ToArray();
                (double x, double z)? point = act == "stroll" && route is { Length: > 0 } ? route.OrderBy(p => Math.Sqrt((p.X - anchor.X) * (p.X - anchor.X) + (p.Z - anchor.Z) * (p.Z - anchor.Z))).Select(p => ((double)p.X, (double)p.Z)).First() : AnchorSnap(anchor.X, anchor.Z, 30);
                if (point != null) fixedPoints[act + ":" + place] = new JsonArray(point.Value.x, point.Value.z);
            }
            if (fixedPoints.Count > 0) anchors[r.Id] = fixedPoints;
        }
        town["anchors"] = anchors; privateTown = town; return town.DeepClone().AsObject();
    }
    public JsonObject PublicTown()
    {
        var town = PrivateTown();
        var people = new JsonArray();
        foreach (var resident in Residents.Values)
        {
            var person = new JsonObject();
            foreach (string field in new[] { "id", "name", "first", "age", "sex", "kind", "trade", "household", "home", "work", "sched", "dog", "mate" }) person[field] = resident[field]?.DeepClone();
            person["role"] = resident["family_role"]?.DeepClone();
            person["label"] = C.Scalar<string>("SELECT role FROM npc WHERE id=$p0", S(resident, "id"));
            person["wares"] = host.Trade.Wares(S(resident, "id"));
            people.Add(person);
        }
        town["residents"] = people;
        var employers = new JsonArray();
        foreach (var pair in C.Rules["employers"]!.AsObject())
            if (pair.Value?["town"]?.GetValue<bool>() == true) employers.Add(new JsonObject { ["id"] = pair.Key, ["spot"] = pair.Value["door"]?.DeepClone() });
        town["employers"] = employers;
        return town;
    }
    public Now Activity(string id)
    {
        var resident = Model.Residents.FirstOrDefault(r => r.Id == id);
        if (resident == null) throw new NativeServiceException("nobody by that name here", 404);
        var clock = host.Clock.View();
        return Whereabouts.ActivityAt(resident.Sched, NativeCoreClock.Number(clock, "day"), NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0);
    }
    public bool AtWork(string id)
    {
        var resident = Resident(id);
        if (resident == null) return C.Scalar<long>("SELECT COUNT(*) FROM npc WHERE id=$p0", id) != 0;
        var work = resident["work"]!;
        var closed = C.World("m4_closed") as JsonObject;
        if (closed?.ContainsKey(S(work, "place")) == true || closed?.ContainsKey(S(work, "shop")) == true) return false;
        string phase = S(C.World("tempest"), "phase");
        if (S(work, "kind") == "tavern" && N(resident["age"]) >= 14 && phase is "coming" or "peak" or "easing") return true;
        return Activity(id).Act == "work";
    }
    public JsonObject? ResolveRoom(int playerId, string place)
    {
        var town = C.World("town"); var found = town?["places"]?[place];
        if (found == null) return null;
        var keeper = Residents.Values.FirstOrDefault(r => S(r["work"], "place") == place && S(r["work"], "kind") is "shop" or "tavern");
        if (keeper == null || !AtWork(S(keeper, "id"))) return null;
        return new JsonObject { ["shelter"] = "sheltered", ["place"] = place, ["label"] = found["label"]?.DeepClone() };
    }
    private JsonArray? FindWay(string key)
    {
        long revision; lock (waysGate) { revision = waysRevision; if (ways.TryGetValue(key, out var cached)) return cached?.DeepClone().AsArray(); }
        var match = Regex.Match(key, @"^(-?\d+),(-?\d+)>(-?\d+),(-?\d+)$");
        if (!match.Success) return null;
        var numbers = Enumerable.Range(1, 4).Select(i => double.Parse(match.Groups[i].Value, CultureInfo.InvariantCulture)).ToArray();
        var path = Ways.Path(new Vector2((float)numbers[0], (float)numbers[1]), new Vector2((float)numbers[2], (float)numbers[3]));
        var value = path == null ? null : new JsonArray(path.Select(point => (JsonNode)new JsonArray(point.X, point.Y)).ToArray());
        lock (waysGate) { if (revision == waysRevision) { if (ways.Count > 20000) ways.Clear(); ways[key] = value; } }
        return value?.DeepClone().AsArray();
    }
    public JsonObject WaysByKey(IEnumerable<string> keys)
    {
        var result = new JsonObject();
        foreach (string key in keys.Where(k => k.Length < 40 && Regex.IsMatch(k, @"^(-?\d+),(-?\d+)>(-?\d+),(-?\d+)$")).Take(60)) result[key] = FindWay(key);
        return new JsonObject { ["ways"] = result };
    }
    private static HashSet<string> PlannedKeys(TownData town)
    {
        var keys = new HashSet<string>();
        foreach (var resident in town.Residents)
        {
            for (int day = 1; day <= 7; day++)
            {
                foreach (var part in day % 7 == 0 ? resident.Sched.Sunday : resident.Sched.Day)
                {
                    double start = part.A % 24, previousHour = start - 0.000001; int previousDay = day;
                    if (previousHour < 0) { previousHour += 24; previousDay--; }
                    var now = Whereabouts.ActivityAt(resident.Sched, day, start);
                    var before = Whereabouts.ActivityAt(resident.Sched, previousDay, previousHour);
                    var a = Whereabouts.AnchorOf(resident, town, before.Act, before.Place);
                    var b = Whereabouts.AnchorOf(resident, town, now.Act, now.Place);
                    if (Math.Abs(a.X - b.X) >= 0.5 || Math.Abs(a.Z - b.Z) >= 0.5) keys.Add(Whereabouts.WayKey(a.X, a.Z, b.X, b.Z));
                }
            }
            var work = Whereabouts.AnchorOf(resident, town, "work", "work");
            if (work.Route is { Length: > 1 } route)
                for (int i = 0; i < route.Length - (work.Loop ? 0 : 1); i++) keys.Add(Whereabouts.WayKey(route[i].X, route[i].Z, route[(i + 1) % route.Length].X, route[(i + 1) % route.Length].Z));
        }
        return keys;
    }
    private JsonObject PlanWays(TownData town, long? revision = null)
    {
        var result = new JsonObject();
        foreach (string key in PlannedKeys(town)) {
            if (revision.HasValue && revision.Value != Interlocked.Read(ref waysRevision)) throw new NativeServiceException("Town changed; ask for its ways again.", 409);
            if (FindWay(key) is { } path) result[key] = path;
        }
        return new JsonObject { ["ways"] = result };
    }
    public JsonObject PlanWays() => PlanWays(Model);
    /// <summary>Route the detached town model off the service gate. Clock, weather and gameplay commands keep answering.</summary>
    public async Task<JsonObject> PlanWaysAsync()
    {
        var snapshot = await host.WithState(_ => (Town: Model, Revision: Interlocked.Read(ref waysRevision))).ConfigureAwait(false);
        Task<JsonObject> work;
        lock (waysGate) {
            if (snapshot.Revision != waysRevision) throw new NativeServiceException("Town changed; ask for its ways again.", 409);
            work = planned ??= Task.Run(() => PlanWays(snapshot.Town, snapshot.Revision));
        }
        try {
            var result = await work.ConfigureAwait(false);
            if (snapshot.Revision != Interlocked.Read(ref waysRevision)) throw new NativeServiceException("Town changed; ask for its ways again.", 409);
            return result.DeepClone().AsObject();
        } catch { lock (waysGate) if (ReferenceEquals(planned, work)) planned = null; throw; }
    }
    public async Task<JsonObject> WaysByKeyAsync(IEnumerable<string> keys)
    {
        var selected = keys.ToArray(); long revision = await host.WithState(_ => Interlocked.Read(ref waysRevision)).ConfigureAwait(false);
        var result = await Task.Run(() => WaysByKey(selected)).ConfigureAwait(false);
        if (revision != Interlocked.Read(ref waysRevision)) throw new NativeServiceException("Town changed; ask for its ways again.", 409);
        return result;
    }
    private double AbsoluteHour()
    {
        var clock = host.Clock.View();
        return (NativeCoreClock.Number(clock, "day") - 1) * 24 + NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0;
    }
    public JsonObject Lags(JsonObject? input = null)
    {
        double now = AbsoluteHour();
        if (input != null) foreach (var pair in input.Take(120))
        {
            double lag = N(pair.Value);
            if (!Residents.ContainsKey(pair.Key) || !double.IsFinite(lag)) continue;
            lag = Math.Clamp(lag, 0, 1);
            if (lags.TryGetValue(pair.Key, out var old)) lag = Math.Min(lag, old.Lag + Math.Max(0, now - old.At) + 0.05);
            else lag = Math.Min(lag, 0.25);
            if (lag <= 0) lags.Remove(pair.Key); else lags[pair.Key] = (lag, now);
        }
        if (C.Now - sweptMilliseconds > 5000)
        {
            sweptMilliseconds = C.Now;
            if (sweptAt >= 0 && Math.Abs(now - sweptAt) > 0.5) lags.Clear();
            sweptAt = now;
            var clock = host.Clock.View(); int day = NativeCoreClock.Number(clock, "day");
            double hour = NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0;
            foreach (string id in lags.Keys.ToArray())
            {
                var person = Model.Residents.FirstOrDefault(r => r.Id == id);
                if (person == null || Whereabouts.SettleLag(person, Model, day, hour, WayOf, lags[id].Lag) <= 0) lags.Remove(id);
            }
        }
        var answer = new JsonObject();
        foreach (var pair in lags) answer[pair.Key] = Math.Round(pair.Value.Lag, 3);
        return new JsonObject { ["lags"] = answer };
    }
    private Pt[]? WayOf(double ax, double az, double bx, double bz, out bool known)
    {
        known = true;
        var path = FindWay(Whereabouts.WayKey(ax, az, bx, bz));
        return path?.Select(point => new Pt(N(point?[0]), N(point?[1]))).ToArray();
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/town", _ => PublicTown());
        service.RegisterAsync("GET", "/api/town/ways", async _ => await PlanWaysAsync().ConfigureAwait(false));
        service.RegisterAsync("POST", "/api/town/ways", async r => await WaysByKeyAsync((r.Body["keys"] as JsonArray ?? new()).Select(k => k?.GetValue<string>() ?? "")).ConfigureAwait(false));
        service.Register("GET", "/api/town/lags", _ => Lags());
        service.Register("POST", "/api/town/lags", r => Lags(r.Body["lags"] as JsonObject));
        service.Trade.WorkResolver = AtWork;
        var previousRoom = service.ResolveRoom;
        service.ResolveRoom = (player, place) => ResolveRoom(player, place) ?? previousRoom?.Invoke(player, place);
        service.NewGame += Clear; service.Loaded += Clear;
    }
}

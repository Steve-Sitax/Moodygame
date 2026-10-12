using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.World;

namespace Scheldemist.Native.Services;

/// <summary>The Stadspark keeper's persistent, claimed, timed work and existing household dog walkers.</summary>
public sealed class NativePark : INativeServiceModule
{
    private const string Key = "stadspark-work-v1";
    public const int CleanCount = 10, CleanPay = 35;
    public static readonly (double x, double z) Keeper = (-302.7, 299.5);
    private static readonly (double x, double z)[] Feed = { (-306, 303), (-286, 292) };
    private readonly NativeServiceHost host;
    private readonly NativeTown town;
    private readonly JsonNode park;
    private NativeServiceContext C => host.Context;
    public Func<double, double, double, bool> GroundOpen = Ways.Open;
    public Func<double, double, bool> Reachable = Ways.Reachable;
    public Func<int, (double x, double z)?>? PositionOf;
    private readonly Dictionary<int, (double x, double z, long at)> seen = new();
    public NativePark(NativeServiceHost host, NativeTown town, JsonNode? city = null)
    {
        this.host = host; this.town = town;
        park = (city ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("city.json"))))!["decor"]!["park"]!;
    }
    private static double N(JsonNode? n) => NativeTown.N(n);
    private static double Number(JsonNode? n)
    {
        if (n is not JsonValue v) return double.NaN;
        if (v.TryGetValue<double>(out var d)) return d;
        if (v.TryGetValue<int>(out var i)) return i;
        if (v.TryGetValue<long>(out var l)) return l;
        return double.NaN;
    }
    private static string S(JsonNode? n, string key) => NativeTown.S(n, key);
    private static double H(double x, double z) => Math.Sqrt(x * x + z * z);
    private static double D(double x, double z, JsonNode? n) => H(x - N(n?["x"]), z - N(n?["z"]));
    private static bool InPark(double x, double z) => x > -355 && x < -248 && z > 277 && z < 342;
    private bool InOutline(double x, double z)
    {
        var poly = park["outline"]!.AsArray(); bool inside = false;
        for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++) {
            double ax = N(poly[i]?[0]), az = N(poly[i]?[1]), bx = N(poly[j]?[0]), bz = N(poly[j]?[1]);
            if ((az > z) != (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
        }
        return inside;
    }
    private bool Open() { var clock = host.Clock.View(); double hour = N(clock["hour"]) + N(clock["minute"]) / 60; return hour >= 7 && hour < 18 && S(clock, "weather") != "storm"; }
    private void Save(JsonObject state) => C.SetWorld(Key, state);
    private void Scatter(JsonObject state)
    {
        uint seed = unchecked((uint)(int)N(state["day"]) * 2654435761u + 1873u);
        double Random() { seed = unchecked(seed * 1664525u + 1013904223u); return seed / 4294967296.0; }
        var piles = state["piles"]!.AsArray(); var placed = piles.Where(p => p?["owner"] != null).ToList();
        foreach (var pile in piles.Where(p => p?["owner"] == null)) {
            for (int i = 0; i < 2500; i++) {
                double x = -354 + Random() * 104, z = 279 + Random() * 62;
                if (!InPark(x, z) || !InOutline(x, z) || !GroundOpen(x, z, .45) || !Reachable(x, z) || placed.Any(p => D(x, z, p) < 1.4)) continue;
                pile!["x"] = x; pile["z"] = z; break;
            }
            placed.Add(pile);
        }
        state["layoutVersion"] = 2;
    }
    private JsonObject Read()
    {
        int day = (int)N(host.Clock.View()["day"]); var old = C.World(Key)?.AsObject();
        if (old != null && N(old["day"]) == day) { if (N(old["layoutVersion"]) != 2) { Scatter(old); Save(old); } return old; }
        var state = new JsonObject { ["day"] = day, ["piles"] = new JsonArray(), ["next"] = 0, ["shifts"] = new JsonObject(), ["dogs"] = new JsonObject(), ["fed"] = new JsonObject(), ["worker"] = new JsonObject { ["x"] = Keeper.x, ["z"] = Keeper.z } };
        var piles = state["piles"]!.AsArray();
        foreach (var line in park["lines"]!.AsArray()) foreach (var point in line!["pts"]!.AsArray()) {
            if (piles.Count >= 28) break;
            double x = N(point?[0]), z = N(point?[1]);
            if (InPark(x, z) && GroundOpen(x, z, .4) && piles.All(p => D(x, z, p) > 2.4)) {
                int next = (int)N(state["next"]); piles.Add(new JsonObject { ["id"] = next, ["x"] = x, ["z"] = z, ["owner"] = null }); state["next"] = next + 1;
            }
        }
        Scatter(state); Save(state); return state;
    }
    private (double x, double z) At(int player, JsonNode? at, JsonNode? near = null, double reach = 2.6, bool verifyPlayer = true)
    {
        double x = Number(at?["x"]), z = Number(at?["z"]);
        if (!double.IsFinite(x) || !double.IsFinite(z) || !InPark(x, z)) throw new NativeServiceException("You must be in the Stadspark.", 409);
        var actual = PositionOf?.Invoke(player);
        if (actual == null && seen.TryGetValue(player, out var p) && C.Now - p.at < 30000) actual = (p.x, p.z);
        if (verifyPlayer && actual != null && H(actual.Value.x - x, actual.Value.z - z) > 3) throw new NativeServiceException("Walk there first.", 409);
        if (near != null && D(x, z, near) > reach) throw new NativeServiceException("Come closer.", 409);
        return (x, z);
    }
    private static JsonObject KeeperPoint() => new() { ["x"] = Keeper.x, ["z"] = Keeper.z };
    public JsonObject View(int player = 1)
    {
        var state = Read(); return new JsonObject { ["day"] = state["day"]!.DeepClone(), ["piles"] = state["piles"]!.DeepClone(), ["shift"] = state["shifts"]?[player.ToString()]?.DeepClone(), ["worker"] = state["worker"]!.DeepClone(), ["open"] = Open() };
    }
    public string Action(int player, string action, JsonObject body) => C.Atomic(() => {
        var state = Read(); var (x, z) = At(player, body["at"], verifyPlayer: action is not ("keeper" or "dog"));
        if (!Open() && action != "cancel") throw new NativeServiceException("The keeper works from seven until six, except in a gale.", 409);
        string who = player.ToString(); var shifts = state["shifts"]!.AsObject(); var shift = shifts[who]?.AsObject(); var piles = state["piles"]!.AsArray();
        if (action == "take") {
            At(player, body["at"], KeeperPoint());
            if (shift != null) throw new NativeServiceException(shift["paid"]!.GetValue<bool>() ? "You have finished today's round." : "Finish your round first.", 409);
            var selected = piles.Where(p => p?["owner"] == null).OrderBy(p => D(x, z, p)).Take(CleanCount).ToArray();
            if (selected.Length < CleanCount) throw new NativeServiceException("Not enough left for a full round. Try again tomorrow.", 409);
            foreach (var pile in selected) pile!["owner"] = player;
            shifts[who] = new JsonObject { ["ids"] = new JsonArray(selected.Select(p => p!["id"]!.DeepClone()).ToArray()), ["cleaned"] = new JsonArray(), ["paid"] = false, ["ready"] = 0, ["pending"] = null }; Save(state);
            return $"The keeper lends you a scoop and bucket. Clear {CleanCount} dog droppings for {CleanPay} c. The marked piles are yours.";
        }
        if (action == "cancel") {
            At(player, body["at"], KeeperPoint()); if (shift == null || shift["paid"]!.GetValue<bool>()) throw new NativeServiceException("No round in hand.", 409);
            foreach (var pile in piles) if (pile?["owner"] != null && N(pile["owner"]) == player) pile["owner"] = null;
            shift["paid"] = true; Save(state); return "You return the tools. No pay for an unfinished round.";
        }
        if (action is "prepare" or "clean") {
            if (shift == null || shift["paid"]!.GetValue<bool>()) throw new NativeServiceException("Ask the keeper for work first.", 409);
            var pile = piles.FirstOrDefault(p => body["id"] != null && N(p?["id"]) == N(body["id"]) && p?["owner"] != null && N(p["owner"]) == player);
            if (pile == null) throw new NativeServiceException("That pile is gone or belongs to another round.", 409);
            At(player, body["at"], pile, 2.1);
            if (action == "prepare") { shift["pending"] = pile["id"]!.DeepClone(); shift["ready"] = C.Now + 1600; Save(state); return "Scooping…"; }
            if (shift["pending"] == null || N(shift["pending"]) != N(pile["id"]) || C.Now < N(shift["ready"])) throw new NativeServiceException("Finish scooping first.", 409);
            shift["cleaned"]!.AsArray().Add(pile["id"]!.DeepClone()); shift["pending"] = null; piles.Remove(pile);
            if (shift["cleaned"]!.AsArray().Count == CleanCount) {
                shift["paid"] = true; C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1", CleanPay, player);
                C.Log(player, "park_clean", null, $"Cleared ten dog droppings in the Stadspark; earned {CleanPay} c.");
            }
            Save(state); return shift["paid"]!.GetValue<bool>() ? $"Ten cleared. The keeper pays you {CleanPay} c." : $"{shift["cleaned"]!.AsArray().Count}/{CleanCount} cleared.";
        }
        if (action == "feed") {
            if (!Feed.Any(p => H(x - p.x, z - p.z) < 2.6)) throw new NativeServiceException("Feed the birds at the pond's edge.", 409);
            if (C.Now - N(state["fed"]?[who]) < 12000) throw new NativeServiceException("Let them finish the last handful.", 409);
            if (C.Execute("UPDATE player SET money_c=money_c-1 WHERE id=$p0 AND money_c>=1", player) == 0) throw new NativeServiceException("A handful of the keeper's grain costs 1 c.", 409);
            state["fed"]![who] = C.Now; Save(state); return "You scatter a handful of grain by the water.";
        }
        if (action == "dog") {
            string id = S(body, "owner"); var owner = town.Resident(id);
            if (owner?["dog"] == null || !GroundOpen(x, z, .22) || C.Now - N(state["dogs"]?[id]) < 180000 || piles.Count >= 48) throw new NativeServiceException("No new droppings here.", 409);
            state["dogs"]![id] = C.Now; int next = (int)N(state["next"]); piles.Add(new JsonObject { ["id"] = next, ["x"] = x, ["z"] = z, ["owner"] = null }); state["next"] = next + 1; Save(state); return "";
        }
        if (action == "keeper") {
            var pile = piles.FirstOrDefault(p => body["id"] != null && N(p?["id"]) == N(body["id"]) && p?["owner"] == null);
            if (pile == null || piles.Count(p => p?["owner"] == null) <= CleanCount) return "";
            At(player, body["at"], pile, 1.5, false); state["worker"] = new JsonObject { ["x"] = x, ["z"] = z }; piles.Remove(pile); Save(state); return "";
        }
        throw new NativeServiceException("Unknown park action.", 400);
    });
    public void EnsureWalkers()
    {
        const string key = "stadspark-dog-walkers-v1"; if (C.World(key) != null) return; int count = 0;
        var candidates = town.Residents.Values.Where(r => S(r, "trade") == "housewife" && S(r, "id").StartsWith("bk", StringComparison.Ordinal) && S(r, "kind") is "wife_a" or "shopwife").OrderBy(r => H(N(r["home"]?["sx"]) - Keeper.x, N(r["home"]?["sz"]) - Keeper.z)).ToArray();
        foreach (var original in candidates) {
            if (N(original["stats"]?["wealth"]) < 3 || original["sched"]?["day"] is not JsonArray day || !day.Any(s => s is JsonArray { Count: > 3 } && s[3]?.GetValue<string>() == "park")) continue;
            var person = original.DeepClone().AsObject(); person["dog"] ??= new JsonObject { ["name"] = new[] { "César", "Fido", "Belle" }[count % 3], ["look"] = new[] { "dog_grey", "dog_spotted", "dog_black" }[count % 3] };
            double start = 13 + count * .35, end = 15.5 + count * .35;
            var segments = day.Where(s => N(s?[1]) <= 12 || N(s?[0]) >= end + 1).Select(s => s!.DeepClone().AsArray()).ToList();
            segments.Add(new JsonArray(12, start, "home")); segments.Add(new JsonArray(start, end, "stroll", "park")); segments.Add(new JsonArray(end, end + 1, "home"));
            var tidy = new JsonArray(); foreach (var segment in segments.OrderBy(s => N(s[0]))) {
                double from = tidy.Count > 0 ? Math.Max(N(segment[0]), N(tidy[^1]?[1])) : N(segment[0]);
                if (N(segment[1]) - from < .25) continue; segment[0] = from; tidy.Add(segment);
            }
            person["sched"]!["day"] = tidy; C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1", person.ToJsonString(), S(person, "id")); if (++count == 3) break;
        }
        C.SetWorld(key, new JsonObject { ["count"] = count }); town.Clear();
    }
    public void Register(NativeServiceHost service)
    {
        EnsureWalkers(); service.NewGame += () => { seen.Clear(); EnsureWalkers(); }; service.Loaded += () => { seen.Clear(); EnsureWalkers(); };
        service.TickHooks.Add((r, _) => { if (r.Body["pos"] is JsonObject pos && pos["x"] != null && pos["z"] != null) { double x = N(pos["x"]), z = N(pos["z"]); if (double.IsFinite(x) && double.IsFinite(z)) seen[r.PlayerId] = (x, z, C.Now); } });
        service.Register("GET", "/api/park", r => View(r.PlayerId));
        service.Register("POST", "/api/park/:action", r => new JsonObject { ["text"] = Action(r.PlayerId, r.Param("action"), r.Body), ["park"] = View(r.PlayerId), ["state"] = service.Payload(r.PlayerId) });
    }
}

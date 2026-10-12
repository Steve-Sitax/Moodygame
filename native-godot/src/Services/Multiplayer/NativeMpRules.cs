using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed class NativeMpOwners
{
    private readonly Dictionary<string, int> numbers = new(StringComparer.Ordinal);
    private readonly Dictionary<int, string> ids = new();
    private readonly Dictionary<int, int> owners = new();
    private readonly List<int> ownerOrder = new();
    private int next = 1;
    public int? NumberOf(string id) { if (numbers.TryGetValue(id, out int n)) return n; if (next > 65535) return null; numbers[id] = n = next++; ids[n] = id; return n; }
    public string? IdOf(int number) => ids.GetValueOrDefault(number);
    public int OwnerOf(int number) => owners.GetValueOrDefault(number);
    public bool Owns(int player, int number) => owners.TryGetValue(number, out int owner) && owner == player;
    public int Count(int player) => owners.Values.Count(x => x == player);
    public JsonArray List() => new(ownerOrder.Select(n => (JsonNode)Row(n, ids[n], owners[n])).ToArray());
    private static JsonArray Row(int number, string id, int owner) => new(number, id, owner);
    public (JsonArray Changes, JsonArray Denied) Claim(int player, IEnumerable<string> requested, bool steal, Func<string, int?> pinOf)
    {
        var changes = new JsonArray(); var denied = new JsonArray();
        foreach (string id in requested.Take(200)) {
            if (string.IsNullOrEmpty(id) || id.Length > 64) continue;
            int? number = NumberOf(id); if (number == null) continue; int n = number.Value, current = OwnerOf(n); if (current == player) continue;
            int? pin = pinOf(id);
            bool take = pin == player || (!(pin != null && current == pin) && (current == 0 || (steal && player == 1 && current != 1)));
            if (take) { if(!owners.ContainsKey(n))ownerOrder.Add(n);owners[n] = player; changes.Add(Row(n, id, player)); } else denied.Add(Row(n, id, current));
        }
        return (changes, denied);
    }
    public JsonArray Release(int player, IEnumerable<string> requested, IEnumerable<string>? gone = null)
    {
        var result = new JsonArray();
        void One(string id, int to) { if (!numbers.TryGetValue(id, out int number) || !Owns(player, number)) return; owners.Remove(number);ownerOrder.Remove(number); result.Add(Row(number, id, to)); }
        foreach (string id in requested.Take(200)) One(id, 0); foreach (string id in (gone ?? Array.Empty<string>()).Take(200)) One(id, -1); return result;
    }
    public JsonArray DropAll(int player) { var result = new JsonArray(); foreach (int n in ownerOrder.Where(n => owners[n] == player).ToArray()) { owners.Remove(n);ownerOrder.Remove(n); result.Add(Row(n, ids[n], 0)); } return result; }
    public void Clear() {owners.Clear();ownerOrder.Clear();}
}

public sealed record NativeMpWorldSeat(int Id, bool Host, bool Online, long StateAt, double? Rate = null);
public sealed class NativeMpWorldPc
{
    public int Id { get; private set; }
    public long LastWorldAt { get; private set; }
    private long hostSince, since; private int worldSeen;
    public int? Choose(IReadOnlyList<NativeMpWorldSeat> seats, long now)
    {
        bool Draws(NativeMpWorldSeat s) => s.Online && now - s.StateAt < 1500 && (s.Rate == null || s.Rate >= 4);
        var host = seats.FirstOrDefault(s => s.Host);
        if (host != null && Draws(host)) { if (hostSince == 0) hostSince = now; } else hostSince = 0;
        var current = seats.FirstOrDefault(s => s.Id == Id);
        bool okay = current != null && current.Online && (now - LastWorldAt < 3000 || (Draws(current) && worldSeen == 0 && now - since < 20000));
        int want = Id;
        if (!okay) { var pick = host != null && Draws(host) ? host : seats.Where(Draws).OrderBy(x => x.Id).FirstOrDefault(); want = pick?.Id ?? (current?.Online == true ? Id : 0); }
        else if (host != null && current != null && !current.Host && hostSince != 0 && now - hostSince >= 3000 && now - since >= 10000) want = host.Id;
        if (want == Id) return null; Id = want; LastWorldAt = since = now; worldSeen = 0; return want;
    }
    public void Heard(long now) { LastWorldAt = now; worldSeen++; }
    public void Reset() { Id = 0; LastWorldAt = hostSince = since = 0; worldSeen = 0; }
}

public sealed record NativeMpVerdict(bool Ok, string? Why = null, bool Anchored = false, double Dist = 0, double Speed = 0);
public sealed class NativeMpPlausible
{
    private static readonly double[] MaxSpeed = { 3.4, 1, 1.6, 1.2, 1, 8, 6, 3.2, 3.4, 8 };
    public NativeMpState? Good { get; private set; }
    private NativeMpState? pending; private long pendingSince; private double lastSnapAt = double.NegativeInfinity;
    private readonly bool trusted;
    public readonly JsonObject Stats = new() { ["frames"] = 0, ["accepted"] = 0, ["refused"] = 0, ["speed"] = 0, ["climb"] = 0, ["time"] = 0, ["snaps"] = 0, ["anchored"] = 0, ["corrections"] = 0 };
    public NativeMpPlausible(bool trusted) => this.trusted = trusted;
    private void Count(string key) => Stats[key] = Stats[key]!.GetValue<int>() + 1;
    private NativeMpVerdict Step(NativeMpState a, NativeMpState b) {
        double dt = Math.Max(.02, (b.T - a.T) / 1000), dist = Math.Sqrt(Math.Pow(b.X - a.X, 2) + Math.Pow(b.Z - a.Z, 2)), speed = dist / dt;
        if (dist > Math.Max(MaxSpeed[Math.Clamp(a.Mode, 0, 9)], MaxSpeed[Math.Clamp(b.Mode, 0, 9)]) * 1.25 * dt + .35) return new(false, "speed", Dist: dist, Speed: speed);
        if (b.Y - a.Y > 1.2 + 2.5 * dt) return new(false, "climb", Dist: dist, Speed: speed); return new(true, Dist: dist, Speed: speed);
    }
    public NativeMpVerdict Check(NativeMpState s, long now) {
        Count("frames"); NativeMpVerdict Refuse(string why, double dist = 0, double speed = 0) { Count("refused"); if (why is "speed" or "climb" or "time") Count(why); return new(false, why, Dist: dist, Speed: speed); }
        if (s.T > now + 1500) return Refuse("time"); var a = Good; if (a == null) { Good = s; Count("accepted"); return new(true); }
        if (s.T <= a.T) return Refuse("old");
        if ((s.Flags & 32) != 0 && (trusted || now - lastSnapAt >= 30000)) { lastSnapAt = now; Good = s; pending = null; Count("snaps"); Count("accepted"); return new(true, Dist: Math.Sqrt(Math.Pow(s.X - a.X, 2) + Math.Pow(s.Z - a.Z, 2))); }
        var step = Step(a, s); if (step.Ok) { Good = s; pending = null; Count("accepted"); return step; }
        if (pending != null && Step(pending, s).Ok) { pending = s; if (now - pendingSince >= 2000) { Good = s; pending = null; Count("anchored"); Count("accepted"); return new(true, Anchored: true, Dist: step.Dist, Speed: step.Speed); } }
        else { pending = s; pendingSince = now; }
        return Refuse(step.Why!, step.Dist, step.Speed);
    }
}

public sealed class NativeMpBucket
{
    private double tokens; private long at; private readonly double rate, burst;
    public NativeMpBucket(double rate, double burst, long now) => (this.rate, this.burst, tokens, at) = (rate, burst, burst, now);
    public bool Take(long now) { double dt = Math.Max(0, now - at) / 1000.0; at = now; tokens = Math.Min(burst, tokens + dt * rate); if (tokens < 1) return false; tokens--; return true; }
}

public sealed class NativeMpSeatLimiter
{
    public static readonly IReadOnlyDictionary<string, (int Normal, int Rate, int Burst)> Limits = new Dictionary<string, (int,int,int)> { ["state"] = (20,40,120), ["puppets"] = (20,50,100), ["animals"] = (10,30,60), ["world"] = (10,20,40), ["figs"] = (10,1000,1000), ["text"] = (10,60,120) };
    private readonly Dictionary<string, NativeMpBucket> buckets = new();
    private readonly Dictionary<string, (long Start, int Count, int Strikes)> windows = new();
    public readonly JsonObject Dropped = new(Limits.Keys.Select(k => KeyValuePair.Create<string,JsonNode?>(k, JsonValue.Create(0))));
    public string Message(string kind, long now) {
        var limit = Limits[kind]; if (!windows.TryGetValue(kind, out var w)) w = (now, 0, 0);
        if (now - w.Start >= 1000) w = (now, 0, w.Count > 10 * limit.Normal && now - w.Start < 2000 ? w.Strikes + 1 : 0);
        w.Count++; windows[kind] = w; if (w.Strikes >= 4 && w.Count > 10 * limit.Normal) return "flood";
        if (!buckets.TryGetValue(kind, out var bucket)) buckets[kind] = bucket = new(limit.Rate, limit.Burst, now);
        if (bucket.Take(now)) return "ok"; Dropped[kind] = Dropped[kind]!.GetValue<int>() + 1; return "drop";
    }
}

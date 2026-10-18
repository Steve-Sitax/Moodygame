using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownTalk
{
    public const int HoldSeconds = 180;
    private sealed record Hold(int Player, long Started, long Heard, double X, double Z, double FaceX, double FaceZ);
    private readonly Dictionary<string, Hold> holds = new(StringComparer.Ordinal);
    private readonly Dictionary<int, string> holdEnded = new();
    public IReadOnlyDictionary<string, int> TalkPins(IEnumerable<int> online)
    {
        SweepHolds(); var on = online.ToHashSet();
        return holds.Where(p => on.Contains(p.Value.Player)).ToDictionary(p => p.Key, p => p.Value.Player);
    }
    private bool HeldByOther(int player,string npc)
    {SweepHolds();return holds.TryGetValue(npc,out var held)&&held.Player!=player;}
    private static JsonObject BusyTalk()=>new(){["npc_line"]="I am speaking to someone else. A moment, please.",["choices"]=new JsonArray(),["end"]=true,["free"]=false};
    private void SweepHolds()
    {
        foreach (var (id, h) in holds.ToArray())
            if (C.Now - h.Started >= HoldSeconds * 1000 || C.Now - h.Heard > 5000)
            { holds.Remove(id); holdEnded[h.Player] = C.Now - h.Started >= HoldSeconds * 1000 ? "I must be off." : "Goodbye for now."; }
    }
    private object HoldTalk(NativeServiceRequest r)
    {
        SweepHolds(); string id = r.Text("npc"), mode = r.Text("mode");
        if (mode == "release") { if (holds.TryGetValue(id, out var old) && old.Player == r.PlayerId) holds.Remove(id); }
        else if (id.Length > 0)
        {
            double x = NativeGoods.Number(r.Body["x"],double.NaN), z = NativeGoods.Number(r.Body["z"],double.NaN), nx = NativeGoods.Number(r.Body["npc_x"],double.NaN), nz = NativeGoods.Number(r.Body["npc_z"],double.NaN);
            if (!new[] { x, z, nx, nz }.All(double.IsFinite) || new[] { x, z, nx, nz }.Any(v => Math.Abs(v) > 2000))
                throw new NativeServiceException("invalid talk position", 400);
            if (mode == "open")
            {
                if (C.Scalar<long>("SELECT COUNT(*) FROM npc WHERE id=$p0", id) == 0) throw new NativeServiceException("nobody here", 404);
                if (holds.TryGetValue(id, out var other) && other.Player != r.PlayerId) throw new NativeServiceException("They are speaking to someone else.", 409);
                foreach (string previous in holds.Where(p => p.Value.Player == r.PlayerId && p.Key != id).Select(p => p.Key).ToArray()) holds.Remove(previous);
                holdEnded.Remove(r.PlayerId);
                if (!holds.ContainsKey(id) && Math.Sqrt(Math.Pow(x - nx, 2) + Math.Pow(z - nz, 2)) <= 4.2)
                    holds[id] = new(r.PlayerId, C.Now, C.Now, nx, nz, x, z);
            }
            if (holds.TryGetValue(id, out var h) && h.Player == r.PlayerId)
            {
                if (Math.Sqrt(Math.Pow(x - h.X, 2) + Math.Pow(z - h.Z, 2)) > 4.2)
                { holds.Remove(id); holdEnded[r.PlayerId] = "Goodbye for now."; }
                else holds[id] = h with { Heard = C.Now, FaceX = x, FaceZ = z };
            }
        }
        return new JsonObject {
            ["active"] = holds.TryGetValue(id, out var mine) && mine.Player == r.PlayerId,
            ["line"] = holdEnded.GetValueOrDefault(r.PlayerId, "Goodbye for now."),
            ["holds"] = new JsonArray(holds.Select(p => (JsonNode)new JsonObject {
                ["npc"] = p.Key, ["player"] = p.Value.Player, ["x"] = p.Value.FaceX, ["z"] = p.Value.FaceZ, ["npc_x"] = p.Value.X, ["npc_z"] = p.Value.Z }).ToArray())
        };
    }
}

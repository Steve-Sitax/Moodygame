using System;
using System.Linq;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

/// <summary>The newspaper, post and pawn office keep their state in the native save.</summary>
public sealed partial class NativePress : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private int Day => (int)N(host.Clock.View(), "day");
    private int Hour => (int)N(host.Clock.View(), "hour");
    private static string S(JsonNode? n, string key, string fallback = "") => NativeGoods.S(n, key, fallback);
    private static double N(JsonNode? n, string key, double fallback = 0) => NativeGoods.N(n, key, fallback);
    private static JsonArray A(JsonNode? n) => NativeGoods.A(n);
    private JsonObject? Town => C.World("press") as JsonObject;
    private string Name(string id) => C.Scalar<string>("SELECT name FROM npc WHERE id=$p0", id) ?? "The clerk";
    private string ItemName(string kind) => S(host.Trade.Item(kind), "name", kind);
    private int Money(int who) => C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0", who);
    private int Pockets(int who) => C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0", who);
    public Func<int, string, JsonObject, Task<JsonObject?>>? NarrateAsync;
    public Func<int> DailyCallLimit = () => 120;
    public Func<int, string, string> TextFor = (_, text) => text;
    private int generation;
    private JsonObject? definitions;
    private JsonObject Definitions => definitions ??= JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory, "native-press.json")))!.AsObject();
    public NativePress(NativeServiceHost host) => this.host = host;
    public void Register(NativeServiceHost service)
    {
        RegisterPawn(service); RegisterPost(service); RegisterLetters(service); RegisterPaper(service);
        service.NewGame += () => generation++;
        service.Loaded += () => generation++;
    }
    public bool CanCallPress() => NarrateAsync != null && C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook IN('newspaper','letter','clerk')", Day) < 6
        && (DailyCallLimit() == 0 || C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0", Day) < DailyCallLimit() - 15);
    public static string DateLine(int day) => new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" }[((day - 1) % 7 + 7) % 7] + $" {12 + day} October 1873";
    private JsonObject? Resident(string id)
    {
        string? json = C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0", id);
        return string.IsNullOrEmpty(json) ? null : JsonNode.Parse(json)!.AsObject();
    }
    private static double Value(JsonNode? node) => NativeGoods.Number(node);
    private static JsonObject Point(double x, double z) => new() { ["x"] = x, ["z"] = z };
    private static bool Within(JsonObject a, JsonObject b, double radius) => double.IsFinite(N(a, "x", double.NaN)) && double.IsFinite(N(a, "z", double.NaN))
        && Math.Sqrt(Math.Pow(N(a, "x") - N(b, "x"), 2) + Math.Pow(N(a, "z") - N(b, "z"), 2)) <= radius;
    private static double Distance(JsonNode a, JsonNode b) => Math.Sqrt(Math.Pow(N(a, "x") - N(b, "x"), 2) + Math.Pow(N(a, "z") - N(b, "z"), 2));
    private JsonObject Reply(int who, JsonObject reply)
    {
        host.PublishState(who);
        return NativeCoreClock.Join(reply, host.Payload(who));
    }
    private static void Refuse(string message, int status = 409) => throw new NativeServiceException(message, status);
}

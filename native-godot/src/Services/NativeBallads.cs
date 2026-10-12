using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

/// <summary>Daily songs and Sunday sermons use public engine facts and persisted, player-owned sheets.</summary>
public sealed partial class NativeBallads : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private readonly NativeEvents events;
    private NativeServiceContext C => host.Context;
    private readonly JsonObject data;
    private int Day => (int)N(host.Clock.View(), "day");
    private double Hour => N(host.Clock.View(), "hour") + N(host.Clock.View(), "minute") / 60;
    private static string S(JsonNode? n, string key, string fallback = "") => NativeGoods.S(n, key, fallback);
    private static double N(JsonNode? n, string key, double fallback = 0) => NativeGoods.N(n, key, fallback);
    private static JsonArray A(JsonNode? n) => NativeGoods.A(n);
    private static bool B(JsonNode? n, string key) => NativeGoods.B(n, key);
    private static JsonArray Strings(IEnumerable<string> strings) => new(strings.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray());
    private static uint Hash(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619); return h; }
    private JsonObject? Person(string id) => actions.Resident(id);
    private IEnumerable<JsonObject> Residents() => C.Rows("SELECT data_json FROM resident ORDER BY id").Select(r => JsonNode.Parse(S(r, "data_json"))!.AsObject());
    public Func<int, string, JsonObject, Task<JsonObject?>>? NarrateAsync;
    public Func<int> DailyCallLimit = () => 120;
    public Func<int, JsonObject>? CathedralView;
    public Func<int, string?>? Inside;
    public Func<int, string, string> TextFor = (_, text) => text;
    private int generation;
    private readonly Dictionary<string, Task<JsonObject?>> writing = new();
    private readonly HashSet<string> pending = new();
    public Task WritingSettled => Task.WhenAll(writing.Values.ToArray());
    public NativeBallads(NativeServiceHost host, NativeActions actions, NativeEvents events)
    {
        (this.host, this.actions, this.events) = (host, actions, events);
        data = JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory, "native-ballads.json")))!.AsObject();
    }
    private JsonObject Reply(int player, JsonObject result) { host.PublishState(player); return NativeCoreClock.Join(result, host.Payload(player)); }
    private void Reset() { generation++; writing.Clear(); pending.Clear(); }
    public void Register(NativeServiceHost service)
    {
        service.NewGame += Reset; service.Loaded += Reset;
        service.Register("GET", "/api/ballad", r => View(r.PlayerId));
        service.RegisterAsync("POST", "/api/ballad/today", async r => { await Write(false); return await host.WithState(_ => View(r.PlayerId)); });
        service.Register("POST", "/api/ballad/buy", r => Reply(r.PlayerId, Buy(r.PlayerId)));
        service.Register("GET", "/api/ballad/sheet/:day", r => Sheet(r.PlayerId, int.TryParse(r.Param("day"), out int d) ? d : -1));
        service.RegisterAsync("GET", "/api/sermon", async r => {
            var sermon = await Write(true); if (sermon == null) throw new NativeServiceException("no sermon today", 404);
            return await host.WithState(_ => SermonView(r.PlayerId, sermon));
        });
        service.Register("POST", "/api/sermon/heard", r => Reply(r.PlayerId, Hear(r.PlayerId)));
        service.RegisterAsync("POST", "/api/dev/ballad", async r => {
            await Write(false); return await host.WithState(_ => {
                var result = Plan(r.Text("corner"), 1, true);
                return B(result, "ok") ? new JsonObject { ["ok"] = true, ["event"] = result["event"]!["id"]!.DeepClone(), ["place"] = result["event"]!["place"]!.DeepClone() } : result;
            });
        });
        var before = events.StageAct;
        events.StageAct = (ev, stage, index) => { before?.Invoke(ev, stage, index); if (S(stage, "act") == "ballad_sing") Sing(ev, stage); };
        service.Interiors.GuestProviders.Add(TavernGuest);
        service.TickHooks.Add((_, advanced) => {
            if (!advanced) return;
            if (Hour >= 7 && C.World("ballad:" + Day) == null) Observe(Write(false));
            PlanDay();
            if (Day % 7 == 0 && Hour >= 6 && Hour < 11 && C.World("sermon:" + Day) == null) Observe(Write(true));
            LogSermon();
        });
    }
    private static void Observe(Task task) => _ = task.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
}

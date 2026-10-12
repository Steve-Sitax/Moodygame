using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    public Action? PlanComing;
    private Task? morning;
    public JsonObject? PaperOf(int day)
    {
        string? json = C.Scalar<string>("SELECT paper_json FROM newspaper WHERE day=$p0", day);
        return string.IsNullOrEmpty(json) ? null : JsonNode.Parse(json)!.AsObject();
    }
    public JsonArray FactsOf(int day)
    {
        string? json = C.Scalar<string>("SELECT facts_json FROM newspaper WHERE day=$p0", day);
        return string.IsNullOrEmpty(json) ? new JsonArray() : JsonNode.Parse(json)!.AsArray();
    }
    public async Task<JsonObject> MakePaper()
    {
        var prepare = await host.WithState(_ => {
            var have = PaperOf(Day); if (have != null) return (Day, Generation: generation, Have: have, Facts: new JsonArray(), Request: (JsonObject?)null);
            WriteHarbour(Day); var facts = PaperFacts(Day);
            var request = CanCallPress() ? new JsonObject { ["system"] = Definitions["paperSystem"]!.DeepClone(), ["schema"] = Definitions["paperSchema"]!.DeepClone(),
                ["prompt"] = new JsonObject { ["date"] = DateLine(Day), ["facts"] = facts.DeepClone(), ["instructions"] = "Write four to six short articles, one factual item per numbered fact; news from abroad must be included. Shipping has one line per numbered ship. Every number, name, date and place must come from the corresponding fact. The cry is a short newsboy's shout from the headline. Never invent an event." }.ToJsonString() } : null;
            return (Day, Generation: generation, Have: (JsonObject?)null, Facts: facts, Request: request);
        }).ConfigureAwait(false);
        if (prepare.Have != null) return new JsonObject { ["paper"] = prepare.Have };
        JsonObject? paper = null; string? error = prepare.Request == null ? "no budget" : null;
        if (prepare.Request != null && NarrateAsync != null)
        {
            try { var output = await NarrateAsync(1, "newspaper", prepare.Request).ConfigureAwait(false); if (output != null) paper = CleanPaper(prepare.Day, prepare.Facts, output); else error = "narration unavailable"; }
            catch { error = "narration unavailable"; }
        }
        paper ??= EnginePaper(prepare.Day, prepare.Facts);
        return await host.WithState(_ => {
            if (generation != prepare.Generation) return new JsonObject { ["paper"] = paper, ["error"] = "new game" };
            var again = PaperOf(prepare.Day); if (again != null) return new JsonObject { ["paper"] = again };
            C.Execute("INSERT INTO newspaper(day,name,price_c,facts_json,paper_json,source,error) VALUES($p0,$p1,5,$p2,$p3,$p4,$p5)", prepare.Day, PaperName, prepare.Facts.ToJsonString(), paper.ToJsonString(), S(paper, "source"), error);
            string second = S(A(paper["articles"]).ElementAtOrDefault(1), "headline");
            host.Interiors.WriteEvent("log", "newspaper", $"{PaperName} this morning leads with \"{S(paper, "headline")}\"" + (second != "" ? $"; also \"{second}\"" : "") + ".", 4);
            string fact = $"This morning's {PaperName} leads with {S(paper, "headline").ToLowerInvariant()}: {S(A(paper["articles"]).FirstOrDefault(), "text")}";
            C.Execute("INSERT INTO world_fact(text,weight,day,tags) VALUES($p0,4,$p1,'paper')", fact[..Math.Min(300, fact.Length)], prepare.Day);
            var result = new JsonObject { ["paper"] = paper }; if (error != null) result["error"] = error; return result;
        }).ConfigureAwait(false);
    }
    public int PaperReference(int who)
    {
        if (PaperOf(Day) == null) Refuse("the papers are not in yet; wait a little");
        var mine = C.Rows("SELECT id,ref FROM item WHERE kind='newspaper' AND player_id=$p0", who);
        if (mine.Any(m => N(m, "ref") == Day)) Refuse("you have today's paper already");
        foreach (var item in mine) C.Execute("DELETE FROM item WHERE id=$p0", (int)N(item, "id"));
        return Day;
    }
    public JsonObject Paper(int who, double day)
    {
        if (C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='newspaper' AND ref=$p0 AND player_id=$p1", day, who) == 0) Refuse("you have no such paper", 404);
        var paper = PaperOf((int)day) ?? throw new NativeServiceException("no such paper", 404);
        paper["notices"] = new JsonArray(FactsOf((int)day).Where(f => S(f, "kind") == "work").Select(f => (JsonNode)JsonValue.Create(Regex.Replace(S(f, "text"), "^Wanted today: ", ""))!).ToArray()); return paper;
    }
    public JsonObject Press(int who)
    {
        var town = Town; var paper = PaperOf(Day); var post = town?["post"]?.DeepClone(); if (post != null) post["at"] = PostCounter();
        return new JsonObject { ["paper"] = new JsonObject { ["day"] = Day, ["name"] = PaperName, ["price_c"] = 5, ["printed"] = paper != null, ["cry"] = paper?["cry"]?.DeepClone(), ["headline"] = paper?["headline"]?.DeepClone() },
            ["corners"] = town?["corners"]?.DeepClone() ?? new JsonArray(), ["post"] = post, ["berg"] = town?["berg"]?.DeepClone(), ["medal"] = Medal(who) };
    }
    private void MorningCheck()
    {
        if (morning is { IsCompleted: false } || C.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='job_board' AND day=$p0", Day) == 0) return;
        if (Value(C.World("press_morning")) == Day) { if (EnsureLetterRound() != null) host.PublishState(); return; }
        if (C.Rows("SELECT id FROM player").All(p => C.PlayerState((int)N(p, "id"), "ending") != null)) return;
        morning = RunMorning(Day, generation); Observe(morning);
    }
    private async Task RunMorning(int day, int started)
    {
        await host.WithState(_ => {
            if (Value(C.World("press_coming")) != day) { C.SetWorld("press_coming", day); PlanComing?.Invoke(); }
            return true;
        }).ConfigureAwait(false);
        var result = await MakePaper().ConfigureAwait(false);
        var players = await host.WithState(_ => {
            if (generation != started) return Array.Empty<int>();
            var paper = result["paper"]!; host.Publish("paper", new JsonObject { ["day"] = day, ["cry"] = paper["cry"]!.DeepClone(), ["headline"] = paper["headline"]!.DeepClone() });
            if (Value(C.World("press_letter")) == day) return Array.Empty<int>();
            C.SetWorld("press_letter", day); return C.Rows("SELECT id FROM player ORDER BY id").Select(p => (int)N(p, "id")).ToArray();
        }).ConfigureAwait(false);
        foreach (int who in players)
        {
            var letter = await MaybeLetter(who).ConfigureAwait(false); if (letter == null) continue;
            await host.WithState(_ => {
                if (generation != started) return false;
                if (who == 1) host.Publish("press", new JsonObject { ["text"] = S(letter, "status") == "given" ? $"A boy brings you a letter from {S(letter, "sender_name")}. (I to read it.)" : "A letter for you waits at the post office." });
                host.PublishState(who); return true;
            }).ConfigureAwait(false);
        }
        await host.WithState(_ => { if (generation == started) C.SetWorld("press_morning", day); return true; }).ConfigureAwait(false);
    }
    private async Task<object?> DevPress(NativeServiceRequest request)
    {
        var result = new JsonObject();
        if (request.Bool("paper"))
        {
            await host.WithState(_ => C.Execute("DELETE FROM newspaper WHERE day=$p0", Day)).ConfigureAwait(false);
            var made = await MakePaper().ConfigureAwait(false); var paper = made["paper"]!;
            result["paper"] = new JsonObject { ["source"] = paper["source"]!.DeepClone(), ["headline"] = paper["headline"]!.DeepClone(), ["error"] = made["error"]?.DeepClone() };
            await host.WithState(_ => { host.Publish("paper", new JsonObject { ["day"] = paper["day"]!.DeepClone(), ["cry"] = paper["cry"]!.DeepClone(), ["headline"] = paper["headline"]!.DeepClone() }); return true; }).ConfigureAwait(false);
        }
        if (request.Bool("letter"))
        {
            var letter = await MaybeLetter(request.PlayerId, true).ConfigureAwait(false);
            result["letter"] = letter == null ? null : new JsonObject { ["id"] = letter["id"]!.DeepClone(), ["kind"] = letter["kind"]!.DeepClone(), ["from"] = letter["sender_name"]!.DeepClone(), ["source"] = letter["source"]!.DeepClone(), ["status"] = letter["status"]!.DeepClone() };
            if (letter != null) await host.WithState(_ => { host.Publish("press", new JsonObject { ["text"] = $"A boy brings you a letter from {S(letter, "sender_name")}. (I to read it.)" }); return true; }).ConfigureAwait(false);
        }
        await host.WithState(_ => { host.PublishState(request.PlayerId); return true; }).ConfigureAwait(false); return result;
    }
    private void RegisterPaper(NativeServiceHost service)
    {
        service.Register("GET", "/api/press", r => Press(r.PlayerId));
        service.Register("GET", "/api/paper/:day", r => Paper(r.PlayerId, double.TryParse(r.Param("day"), out var day) ? day : double.NaN));
        service.RegisterAsync("POST", "/api/dev/press", DevPress);
        service.Trade.ItemReferences["newspaper"] = who => PaperReference(who);
        service.Jobs.BoardExtras.Add(MorningCheck); service.TickHooks.Add((_, _) => MorningCheck());
    }
}

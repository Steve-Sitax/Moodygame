using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    private static readonly Regex WordSums = new(@"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|a|some)\s+(francs?|centimes?|guilders?|pounds?|napoleons?|louis|sous?)\b", RegexOptions.IgnoreCase);
    private static readonly Regex Gifts = new(@"\b(enclos\w*|banknote|bank note|money order|postal order|gold coin|here is (some|a little) money|i send you (some|a little) money|reward you with)\b", RegexOptions.IgnoreCase);
    public static bool SumsOk(string text, JsonObject offer)
    {
        if (WordSums.IsMatch(text)) return false;
        var allowed = new[] { N(offer, "pay_c"), N(offer, "fee_c"), N(offer, "pay_c") - N(offer, "fee_c") }.Where(n => n > 0).Select(n => n.ToString(System.Globalization.CultureInfo.InvariantCulture)).ToHashSet();
        foreach (Match m in Regex.Matches(text, @"(\d+)\s*(francs?|centimes?|c\b|fr\b|guilders?|pounds?)", RegexOptions.IgnoreCase))
            if (!allowed.Contains(m.Groups[1].Value) || m.Groups[2].Value.StartsWith("fr", StringComparison.OrdinalIgnoreCase)) return false;
        return Regex.Matches(text, @"\b\d{3,}\b").All(m => allowed.Contains(m.Value));
    }
    public static JsonObject FallbackLetter(JsonObject plan)
    {
        var offer = plan["offer"]!; string why = S(plan, "why"), kind = S(offer, "kind"), signature = S(plan, "signature"); bool stranger = why == "stranger";
        string ask = kind == "letter"
            ? $" Carry a letter for me to the door of {S(offer, "to_name")}. {(stranger ? "It waits for you at the post office counter." : "Fetch it at my door.")}" + (N(offer, "pay_c") != 0 ? $" There are {N(offer, "pay_c")} centimes in it for you when it is done." : " Do this and we are square.")
            : kind == "telegram" ? $" I need a wire sent to {S(offer, "city")}. {(stranger ? "The words wait at the post office counter." : "Fetch the words at my door.")} Pay the {N(offer, "fee_c")} centimes at the counter and you shall have {N(offer, "pay_c")} back when it is sent." : "";
        string body = S(plan, "kind") switch {
            "complaint" => "I have not forgotten what you did. Neither has the street. A man new to the town should mind how he goes.",
            "make_right" => "I have not forgotten what you did. But I will give you a chance to make it right." + ask,
            "thanks" => "I write to thank you. Not everyone on the quays would have done the same. I will not forget it.",
            "errand" => "You seem an honest sort, so I will ask you a small service." + ask,
            "telegram" => "You seem a willing sort, so I will ask you a small service." + ask,
            "news" => A(plan["facts"]).ElementAtOrDefault(1) is { } fact ? "A word to the wise. " + Regex.Replace(fact.GetValue<string>(), @"^News they could pass on \(from the town\): ", "") + " Keep your eyes open." : "A word to the wise: keep your eyes open on the quays these days, and your purse closer.",
            _ => "You do not know me, but I know a little of you. I have a small service to ask, and I ask it of you for a reason." + ask
        };
        return new JsonObject { ["salutation"] = stranger ? "To the young man Jef," : "Jef,", ["body"] = body.Trim(), ["closing"] = why == "wronged" ? "That is all." : "Yours,",
            ["signature"] = stranger ? signature : S(plan, "sender_name").Split(' ')[0], ["telegram"] = kind == "telegram" ? $"ARRIVE {S(offer, "city", "SOON").ToUpperInvariant()} THURSDAY STOP SAY NOTHING TO THE FAMILY STOP" : "" };
    }
    public static (JsonObject Text, bool Ok) CleanLetter(JsonObject plan, JsonObject output)
    {
        string body = NativeCoreInteriors.PlainEnglish(S(output, "body"));
        string all = string.Join(" ", S(output, "salutation"), body, S(output, "closing"), S(output, "signature"), S(output, "telegram"));
        string signature = NativeCoreInteriors.PlainEnglish(S(output, "signature")), intended = S(plan, "signature");
        bool signatureOk = S(plan, "why") == "stranger" ? signature.Contains(intended[..Math.Min(3, intended.Length)]) : Regex.Split(intended, @"\s+").Any(w => w.Length > 2 && signature.Contains(w));
        if (!SumsOk(all, plan["offer"]!.AsObject()) || Gifts.IsMatch(all) || body.Length < 30) return (FallbackLetter(plan), false);
        string telegram = "";
        if (S(plan["offer"], "kind") == "telegram")
        {
            var words = Regex.Split(Regex.Replace(S(output, "telegram"), "[^A-Za-z .,'-]", " ").ToUpperInvariant(), @"\s+").Where(w => w != "").ToArray();
            telegram = words.Length is > 0 and <= 20 ? string.Join(" ", words) : S(FallbackLetter(plan), "telegram");
        }
        string Short(string text) { text = NativeCoreInteriors.PlainEnglish(text); return text[..Math.Min(60, text.Length)]; }
        return (new JsonObject { ["salutation"] = Short(S(output, "salutation")), ["body"] = body, ["closing"] = Short(S(output, "closing")), ["signature"] = signatureOk ? signature : intended, ["telegram"] = telegram }, true);
    }
    public async Task<JsonObject?> MaybeLetter(int who, bool force = false, Func<double>? random = null)
    {
        var prepare = await host.WithState(_ => {
            if (!force && !LetterDue(who, random)) return (Id: 0, Generation: generation, Plan: (JsonObject?)null, Request: (JsonObject?)null);
            var plan = PlanLetter(who, random); if (S(plan, "sender") == "") return (Id: 0, Generation: generation, Plan: (JsonObject?)null, Request: (JsonObject?)null);
            C.Execute("INSERT INTO letter(day,hour,sender,sender_name,why,kind,facts_json,offer_json,status,player_id) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,'writing',$p8)", Day, Hour, S(plan, "sender"), S(plan, "sender_name"), S(plan, "why"), S(plan, "kind"), plan["facts"]!.ToJsonString(), plan["offer"]!.ToJsonString(), who);
            int id = C.Scalar<int>("SELECT last_insert_rowid()");
            var request = CanCallPress() ? new JsonObject { ["system"] = Definitions["letterSystem"]!.DeepClone(), ["schema"] = Definitions["letterSchema"]!.DeepClone(),
                ["prompt"] = TextFor(who, new JsonObject { ["date"] = DateLine(Day), ["plan"] = plan.DeepClone(), ["sender"] = S(plan, "why") == "stranger" ? null : Resident(S(plan, "sender")), ["instructions"] = "Write this person's short letter to Jef. Only the facts and offer supplied; no invented gifts or sums. A telegram is at most twenty words in capitals. Keep the supplied signature. Use the real engine terms exactly." }.ToJsonString()) } : null;
            return (Id: id, Generation: generation, Plan: plan, Request: request);
        }).ConfigureAwait(false);
        if (prepare.Plan == null) return null;
        var text = FallbackLetter(prepare.Plan); string source = "engine";
        if (prepare.Request != null && NarrateAsync != null)
        {
            try { var output = await NarrateAsync(who, "letter", prepare.Request).ConfigureAwait(false); if (output != null) { var cleaned = CleanLetter(prepare.Plan, output); text = cleaned.Text; source = cleaned.Ok ? "claude" : "engine"; } }
            catch { /* The same authoritative plan has handwritten words. */ }
        }
        return await host.WithState(_ => {
            if (generation != prepare.Generation) return null;
            var plan = prepare.Plan;
            C.Atomic(() => {
                var job = ErrandJob(plan);
                if (job != null && S(text, "telegram") != "")
                {
                    var task = JsonNode.Parse(C.Scalar<string>("SELECT task_json FROM job WHERE id=$p0", job))!.AsObject(); task["words"] = S(text, "telegram");
                    C.Execute("UPDATE job SET task_json=$p0 WHERE id=$p1", task.ToJsonString(), job);
                }
                string status = Pockets(who) < 6 ? "given" : "waiting";
                C.Execute("UPDATE letter SET text_json=$p0,source=$p1,status=$p2,job_id=$p3 WHERE id=$p4 AND player_id=$p5", text.ToJsonString(), source, status, job, prepare.Id, who);
                if (status == "given") C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('letter',NULL,$p0,$p1)", prepare.Id, who);
                C.Log(who, "letter_came", S(plan, "why") == "stranger" ? null : S(plan, "sender"), "A letter came for Jef from " + S(plan, "sender_name") + ".", "world");
            });
            host.Interiors.WriteEvent("log", "letter", $"A letter came for Jef from {S(plan, "sender_name")} ({S(plan, "kind").Replace('_', ' ')}).", 3, actor: S(plan, "why") == "stranger" ? null : S(plan, "sender"));
            return C.One("SELECT * FROM letter WHERE id=$p0 AND player_id=$p1", prepare.Id, who);
        }).ConfigureAwait(false);
    }
    public JsonObject Letter(int who, double id)
    {
        var letter = C.One("SELECT * FROM letter WHERE id=$p0 AND player_id=$p1", id, who);
        bool held = C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='letter' AND ref=$p0 AND player_id=$p1", id, who) > 0;
        if (letter == null || !held && S(letter, "status") != "read") Refuse("no such letter in your pockets", 404);
        if (S(letter, "status") == "given") C.Execute("UPDATE letter SET status='read' WHERE id=$p0", id);
        var result = JsonNode.Parse(S(letter, "text_json"))!.AsObject();
        result["id"] = letter!["id"]!.DeepClone(); result["date"] = DateLine((int)N(letter, "day")); result["from"] = S(letter, "sender_name"); result["offer"] = JsonNode.Parse(S(letter, "offer_json"));
        var job = letter["job_id"] == null ? null : C.One("SELECT id,status,title,pay_c,day FROM job WHERE id=$p0", (int)N(letter, "job_id"));
        if (job != null) { job["today"] = N(job, "day") == Day; job.Remove("day"); }
        result["job"] = job; return result;
    }
    private readonly List<Task> writing = new();
    public Task WritingSettled() => Task.WhenAll(writing.ToArray());
    private void Observe(Task task) { writing.RemoveAll(t => t.IsCompleted); writing.Add(task); _ = task.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default); }
    private void RegisterLetters(NativeServiceHost service)
    {
        service.Register("GET", "/api/letter/:id", r => Letter(r.PlayerId, double.TryParse(r.Param("id"), out var id) ? id : double.NaN));
    }
}

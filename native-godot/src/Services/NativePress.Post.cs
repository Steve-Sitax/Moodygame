using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    private const string PostLabel = "the post and telegraph office";
    private string PostClerk => S(Town?["post"], "clerk");
    private bool PostOpen => PostClerk != "" && host.Trade.AtWork(PostClerk);
    public JsonObject? PostCounter()
    {
        var post = Town?["post"]; if (post == null) return null;
        var at = Resident(PostClerk)?["work"]?["at"] ?? post["step"];
        return at is JsonArray a ? new JsonObject { ["x"] = Value(a[0]), ["z"] = Value(a[1]), ["label"] = PostLabel } : null;
    }
    private JsonObject[] Addressees() => C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row => JsonNode.Parse(S(row, "data_json"))!.AsObject())
        .Where(r => N(r, "age") >= 16 && S(r, "id") != PostClerk && S(r, "trade") is not ("soldier" or "sentry" or "corporal")).ToArray();
    private static JsonObject HomePoint(JsonNode r) => Point(N(r["home"], "sx"), N(r["home"], "sz"));
    private static JsonArray AsRound(JsonObject start, IEnumerable<JsonObject> stops)
    {
        var left = stops.ToList(); var result = new JsonArray(); var at = start;
        while (left.Count > 0)
        {
            var next = left.OrderBy(p => Distance(at, p)).First(); left.Remove(next); result.Add(next.DeepClone()); at = next;
        }
        return result;
    }
    private static double RouteLength(JsonObject start, JsonArray stops)
    {
        JsonNode at = start; double distance = 0;
        foreach (var stop in stops) { distance += Distance(at, stop!); at = stop!; }
        return distance;
    }
    private int InsertLetterJob(string title, string employer, int pay, string pitch, JsonObject task, string source)
    {
        C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,'grote-markt','letters',$p3,'low',$p4,NULL,$p5,$p6,$p7,'offered')",
            Day, title[..Math.Min(title.Length, 70)], employer, pay, host.Jobs.Tier(), pitch[..Math.Min(pitch.Length, 360)], task.ToJsonString(), source);
        return C.Scalar<int>("SELECT last_insert_rowid()");
    }
    public int? EnsureLetterRound(Func<double>? random = null)
    {
        if (Day % 7 == 0 || PostClerk == "" || PostCounter() is not JsonObject counter) return null;
        if (C.Scalar<int>("SELECT COUNT(*) FROM job WHERE day=$p0 AND task_type='letters' AND source='post' AND status IN('offered','taken','done','failed')", Day) > 0) return null;
        uint seed = unchecked((uint)((N(C.World("town"), "seed", 1873) * 13) + Day * 101));
        double Roll()
        {
            seed = unchecked(seed + 0x6d2b79f5);
            uint t = unchecked((seed ^ (seed >> 15)) * (seed | 1));
            t ^= unchecked(t + (t ^ (t >> 7)) * (t | 61));
            return (t ^ (t >> 14)) / 4294967296.0;
        }
        random ??= Roll;
        var near = Addressees().Where(r => Distance(counter, HomePoint(r)) is >= 40 and <= 220).ToArray();
        if (near.Length == 0) return null;
        var centre = HomePoint(near[(int)Math.Floor(random() * near.Length)]);
        var pool = near.OrderBy(r => Distance(HomePoint(r), centre));
        int count = 3 + (int)Math.Floor(random() * 3); var households = new HashSet<int>(); var chosen = new List<JsonObject>();
        foreach (var r in pool)
        {
            if (chosen.Count >= count) break;
            if (!households.Add((int)N(r, "household"))) continue;
            chosen.Add(new JsonObject { ["id"] = S(r, "id"), ["name"] = S(r, "name"), ["x"] = N(r["home"], "sx"), ["z"] = N(r["home"], "sz"), ["what"] = "door" });
        }
        if (chosen.Count < 2) return null;
        var stops = AsRound(counter, chosen); var band = host.Jobs.Plan.Data["tierPay"]![host.Jobs.Tier()]!;
        int pay = (int)Math.Clamp(Math.Floor((30 + 12 * stops.Count + RouteLength(counter, stops) / 15) / 5 + .5) * 5, Value(band[0]), Value(band[1]));
        var task = new JsonObject { ["kind"] = "letters", ["goods"] = "letters", ["from"] = counter.DeepClone(), ["stops"] = stops, ["fee_c"] = 0, ["twist"] = "none", ["limit_s"] = null };
        return InsertLetterJob($"Letters for {stops.Count} doors", PostClerk, pay, $"{stops.Count} letters from the morning mail, to doors about the town. Under each door, the right name on each. Fetch them at the post office counter.", task, "post");
    }
    private (JsonObject Job, JsonObject Task) TakenLetters(int who, double id)
    {
        var job = host.Jobs.List(who).FirstOrDefault(j => N(j, "id") == id)?.AsObject();
        if (job == null || S(job, "status") != "taken" || N(job, "taken_by") != who || S(job["task"], "kind") != "letters") Refuse("no round of letters in hand");
        return (job!, job!["task"]!.AsObject());
    }
    private void SaveLetterTask(double id, JsonObject task)
    {
        task["progress"] = new JsonObject { ["delivered"] = A(task["stops"]).Count(s => s?["done"]?.GetValue<bool>() == true), ["lost"] = 0, ["sold"] = 0 };
        C.Execute("UPDATE job SET task_json=$p0 WHERE id=$p1", task.ToJsonString(), id);
    }
    public JsonObject PickUpLetters(int who, double id, JsonObject at)
    {
        var (job, task) = TakenLetters(who, id);
        if (task["picked"]?.GetValue<bool>() == true) return new JsonObject { ["text"] = "You have them already." };
        if (!Within(at, task["from"]!.AsObject(), 6.5)) Refuse("you are not there yet");
        bool fromPost = S(task["from"], "label") == PostLabel;
        if (fromPost && !PostOpen) Refuse("the post office is shut");
        if (Pockets(who) >= 6) Refuse("your pockets are full; eat something or leave it");
        var stops = A(task["stops"]); bool tele = stops.Any(s => S(s, "what") == "telegraph");
        C.Atomic(() => {
            C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES($p0,$p1,$p2)", tele || stops.Count == 1 ? "letter" : "letters", id, who);
            task["picked"] = true; SaveLetterTask(id, task);
        });
        string employer = S(job, "employer_name");
        string text = tele ? $"{employer} gives you a slip with the words for the wire{(task["city"] != null ? " to " + S(task, "city") : "")}. The fee is {N(task, "fee_c")} centimes at the counter."
            : fromPost ? $"The clerk counts {stops.Count} letters into your hand. \"Under the door, the right name on each.\""
            : $"{employer} hands you a folded letter. \"For {S(stops.FirstOrDefault(), "name", "them")}, and no one else.\"";
        return new JsonObject { ["text"] = text };
    }
    public JsonObject DeliverLetter(int who, double id, double index, JsonObject at)
    {
        var (job, task) = TakenLetters(who, id); var stops = A(task["stops"]);
        if (task["picked"]?.GetValue<bool>() != true) Refuse("fetch the letters first");
        var stop = index == Math.Floor(index) && index >= 0 && index < stops.Count ? stops[(int)index]!.AsObject() : null;
        if (stop == null || S(stop, "what") != "door") Refuse("no such door on the round", 404);
        int Left() => stops.Count(s => s?["done"]?.GetValue<bool>() != true);
        if (stop!["done"]?.GetValue<bool>() == true) return new JsonObject { ["text"] = "That one is delivered.", ["left"] = Left() };
        if (!Within(at, stop, 4.5)) Refuse("that is not the right door");
        stop["done"] = true;
        C.Atomic(() => { SaveLetterTask(id, task); C.Log(who, "delivered_letter", S(stop, "id"), $"Jef put a letter under the door of {S(stop, "name")}, for {S(job, "employer_name")}."); });
        host.Trade.Remember(who, S(stop, "id"), "A letter came under my door; the new man, Jef, brought it.", 2);
        int left = Left(); return new JsonObject { ["text"] = $"Under the door of {S(stop, "name")}. " + (left > 0 ? $"{left} to go." : "That was the last one."), ["left"] = left };
    }
    public JsonObject SendTelegram(int who, double id, JsonObject at)
    {
        var (job, task) = TakenLetters(who, id);
        var stop = A(task["stops"]).FirstOrDefault(s => S(s, "what") == "telegraph" && s?["done"]?.GetValue<bool>() != true);
        if (stop == null) Refuse("no telegram to send");
        if (task["picked"]?.GetValue<bool>() != true) Refuse("fetch the words first");
        if (!PostOpen) Refuse("the telegraph counter is shut");
        if (!Within(at, PostCounter()!, 5.5)) Refuse("go to the counter");
        int fee = (int)N(task, "fee_c"); if (Money(who) < fee) Refuse($"the wire costs {fee} centimes and you have {Money(who)}");
        stop!["done"] = true;
        C.Atomic(() => {
            C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1", fee, who); SaveLetterTask(id, task);
            C.Log(who, "sent_telegram", S(job, "employer_npc"), $"Jef sent a telegram to {S(task, "city", "another town")} for {S(job, "employer_name")}, {fee} centimes.");
        });
        return new JsonObject { ["text"] = $"The clerk counts the words, takes your {fee} centimes and taps it out: \"{S(task, "words", "COMING SOON")}\"" };
    }
    public JsonObject CollectWaiting(int who)
    {
        if (!PostOpen) Refuse("the post office is shut");
        var waiting = C.Rows("SELECT id,sender_name FROM letter WHERE status='waiting' AND player_id=$p0 ORDER BY id", who); int n = 0;
        C.Atomic(() => {
            foreach (var letter in waiting)
            {
                if (Pockets(who) >= 6) break;
                C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('letter',NULL,$p0,$p1)", (int)N(letter, "id"), who);
                C.Execute("UPDATE letter SET status='given' WHERE id=$p0", (int)N(letter, "id")); n++;
            }
        });
        if (waiting.Count == 0) return new JsonObject { ["text"] = "\"Nothing for you today.\"", ["n"] = 0 };
        if (n == 0) Refuse("your pockets are full");
        return new JsonObject { ["text"] = $"The clerk hands you {(n == 1 ? "a letter" : n + " letters")} from the pigeonholes.", ["n"] = n };
    }
    public JsonObject Post(int who) => new() {
        ["label"] = PostLabel, ["clerk"] = PostClerk == "" ? null : PostClerk, ["clerk_name"] = PostClerk == "" ? null : Name(PostClerk), ["open"] = PostOpen,
        ["at"] = PostCounter(), ["waiting"] = C.Scalar<int>("SELECT COUNT(*) FROM letter WHERE status='waiting' AND player_id=$p0", who), ["telegram_fee_c"] = 50, ["telegram_words"] = 20,
        ["round"] = host.Jobs.List(who).FirstOrDefault(j => S(j, "task_type") == "letters" && S(j, "employer_npc") == PostClerk && S(j, "status") == "offered")?.DeepClone()
    };
    public void Discard(int who, double item)
    {
        var row = C.One("SELECT kind,job_id FROM item WHERE id=$p0 AND player_id=$p1", item, who) ?? throw new NativeServiceException("not in your pockets", 404);
        if (row["job_id"] != null || S(row, "kind") is not ("newspaper" or "letter")) Refuse("you had better keep that");
        C.Execute("DELETE FROM item WHERE id=$p0 AND player_id=$p1", item, who);
    }
    private void RegisterPost(NativeServiceHost service)
    {
        service.Register("GET", "/api/post", r => Post(r.PlayerId));
        service.Register("POST", "/api/post/collect", r => Reply(r.PlayerId, CollectWaiting(r.PlayerId)));
        service.Register("POST", "/api/post/pickup", r => Reply(r.PlayerId, PickUpLetters(r.PlayerId, N(r.Body, "job", double.NaN), r.Body)));
        service.Register("POST", "/api/post/deliver", r => NativeCoreClock.Join(DeliverLetter(r.PlayerId, N(r.Body, "job", double.NaN), N(r.Body, "index", double.NaN), r.Body), host.Payload(r.PlayerId)));
        service.Register("POST", "/api/post/telegram", r => {
            var result = SendTelegram(r.PlayerId, N(r.Body, "job", double.NaN), r.Body);
            BeginRemark(r.PlayerId, PostClerk, "Jef hands in a telegram and pays the fee at the counter. The clerk sends it down the wire.", "\"Sent. It will be there before you are home.\"");
            return Reply(r.PlayerId, result);
        });
        service.Register("POST", "/api/pockets/discard", r => { Discard(r.PlayerId, N(r.Body, "id", double.NaN)); host.PublishState(r.PlayerId); return host.Payload(r.PlayerId); });
        void Round() { if (C.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='job_board' AND day=$p0", Day) > 0 && EnsureLetterRound() != null) host.PublishState(); }
        service.Jobs.BoardExtras.Add(Round); service.TickHooks.Add((_, _) => Round());
    }
}

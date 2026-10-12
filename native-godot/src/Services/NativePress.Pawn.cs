using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    private const string BergLabel = "the Berg van Barmhartigheid";
    private static readonly Dictionary<string, int> PawnWorth = new() {
        ["medal"] = 90, ["lantern"] = 40, ["pocket_watch"] = 80, ["handkerchief"] = 10
    };
    public static int LoanFor(string kind) => (int)Math.Floor(PawnWorth.GetValueOrDefault(kind) * (kind is "medal" or "pocket_watch" ? .8 : 2.0 / 3) / 5) * 5;
    public static int HotLoan(string kind) => (int)Math.Floor(LoanFor(kind) / 10.0) * 5;
    public static int RateFor(int loan) => Math.Max(1, (int)Math.Ceiling(loan * .05));
    public static int DueDay(int day) => Math.Min(7, day + 3);
    public static int RedeemCost(JsonObject pledge, int day) => (int)(N(pledge, "loan_c") + N(pledge, "rate_c") * Math.Max(1, day - N(pledge, "day") + 1));
    private static string DayName(int day) => new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" }[((day - 1) % 7 + 7) % 7] + " night";
    private string Clerk => S(Town?["berg"], "clerk");
    public string Medal(int who) => who == 1 ? S(Town, "medal", "owned") : "none";
    private void SetMedal(string status) { var town = Town; if (town != null) { town["medal"] = status; C.SetWorld("press", town); } }
    private void BergOpen()
    {
        if (Clerk == "") Refuse("there is no pawn office in this town", 404);
        if (!host.Trade.AtWork(Clerk)) Refuse("the Berg's counter is shut; it opens in the morning");
    }
    private bool Stolen(int item) => C.Scalar<int>("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='deed'") > 0
        && C.Scalar<int>("SELECT COUNT(*) FROM deed WHERE item_id=$p0 AND status='open'", item) > 0;
    public JsonObject Berg(int who)
    {
        var offers = new JsonArray();
        if (Medal(who) == "owned") offers.Add(new JsonObject { ["item"] = 0, ["kind"] = "medal", ["name"] = ItemName("medal"), ["loan_c"] = LoanFor("medal") });
        foreach (var item in C.Rows("SELECT id,kind FROM item WHERE job_id IS NULL AND player_id=$p0 ORDER BY id", who))
        {
            string kind = S(item, "kind"); int id = (int)N(item, "id");
            if (PawnWorth.ContainsKey(kind)) offers.Add(new JsonObject { ["item"] = id, ["kind"] = kind, ["name"] = ItemName(kind), ["loan_c"] = Stolen(id) ? HotLoan(kind) : LoanFor(kind) });
        }
        var tickets = new JsonArray(C.Rows("SELECT * FROM pawn WHERE status='held' AND player_id=$p0 ORDER BY id", who).Select(row => (JsonNode)new JsonObject {
            ["id"] = row!["id"]!.DeepClone(), ["name"] = row["item_name"]!.DeepClone(), ["loan_c"] = row["loan_c"]!.DeepClone(),
            ["rate_c"] = row["rate_c"]!.DeepClone(), ["due_day"] = row["due_day"]!.DeepClone(), ["redeem_c"] = RedeemCost(row.AsObject(), Day)
        }).ToArray());
        return new JsonObject { ["label"] = BergLabel, ["clerk"] = Clerk == "" ? null : Clerk, ["clerk_name"] = Clerk == "" ? null : Name(Clerk),
            ["open"] = Clerk != "" && host.Trade.AtWork(Clerk), ["day"] = Day, ["offers"] = offers, ["tickets"] = tickets,
            ["terms"] = "Loans at two thirds of the worth, four fifths on silver. Interest 5 in the hundred a day begun. Redeem within 3 days; pledges not redeemed are sold." };
    }
    public JsonObject Pawn(int who, double item)
    {
        BergOpen(); string kind;
        if (item == 0)
        {
            if (Medal(who) != "owned") Refuse("you have no medal to pawn");
            kind = "medal";
            if (Pockets(who) >= 6) Refuse("your pockets are full; there is no room for the ticket");
        }
        else
        {
            var row = C.One("SELECT id,kind,job_id FROM item WHERE id=$p0 AND player_id=$p1", item, who) ?? throw new NativeServiceException("not in your pockets", 404);
            if (row["job_id"] != null) Refuse("that is not yours to pawn");
            kind = S(row, "kind");
        }
        bool hot = item != 0 && Stolen((int)item); int loan = hot ? HotLoan(kind) : LoanFor(kind);
        if (loan == 0) Refuse("the Berg lends on goods that keep, not on " + ItemName(kind));
        int rate = RateFor(loan), due = DueDay(Day); string name = ItemName(kind);
        int id = C.Atomic(() => {
            if (item == 0) SetMedal("pawned"); else C.Execute("DELETE FROM item WHERE id=$p0 AND player_id=$p1", item, who);
            C.Execute("INSERT INTO pawn(item_kind,item_name,worth_c,loan_c,rate_c,day,hour,due_day,status,player_id) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,'held',$p8)", kind, name, PawnWorth[kind], loan, rate, Day, Hour, due, who);
            int added = C.Scalar<int>("SELECT last_insert_rowid()");
            C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('pawn_ticket',NULL,$p0,$p1)", added, who);
            C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1", loan, who);
            C.Log(who, "pawned", kind, $"Jef pawned {name} at the Berg van Barmhartigheid for {loan} centimes.");
            return added;
        });
        if (Clerk != "") host.Trade.Remember(who, Clerk, $"Jef pawned {Regex.Replace(name, "^your ", "his ")} with me for {loan} centimes.", 3);
        if (hot && Clerk != "") host.Trade.Remember(who, Clerk, $"Jef brought me {name} that was not his, by the look of it.", 4);
        string warning = hot ? "The clerk turns it over, looks at you, and halves the sum. \"No questions.\" " : "";
        return new JsonObject { ["text"] = $"{warning}The clerk writes a ticket, No. {1000 + id}, and counts out {loan} centimes. Redeem by {DayName(due)}.", ["pawn"] = C.One("SELECT * FROM pawn WHERE id=$p0", id) };
    }
    public JsonObject Redeem(int who, double pawnId)
    {
        BergOpen(); var pledge = C.One("SELECT * FROM pawn WHERE id=$p0 AND player_id=$p1", pawnId, who);
        if (pledge == null || S(pledge, "status") != "held") Refuse("no such pledge at the Berg", 404);
        var ticket = C.One("SELECT id FROM item WHERE kind='pawn_ticket' AND ref=$p0 AND player_id=$p1", pawnId, who);
        if (ticket == null) Refuse("no ticket, no pledge");
        int cost = RedeemCost(pledge!, Day); if (Money(who) < cost) Refuse($"not enough money: {cost} c to redeem it");
        string kind = S(pledge, "item_kind"), name = S(pledge, "item_name");
        C.Atomic(() => {
            C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1", cost, who);
            C.Execute("DELETE FROM item WHERE id=$p0", (int)N(ticket, "id"));
            if (kind == "medal") SetMedal("owned"); else C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES($p0,NULL,$p1)", kind, who);
            C.Execute("UPDATE pawn SET status='redeemed',paid_c=$p0,closed_day=$p1 WHERE id=$p2", cost, Day, pawnId);
            C.Log(who, "redeemed", kind, $"Jef redeemed {name} at the Berg van Barmhartigheid for {cost} centimes.");
        });
        string closing = kind == "medal" ? "The medal comes back in a twist of paper; you sew it into your coat again." : $"The clerk fetches {name} from the back.";
        return new JsonObject { ["text"] = $"You hand over the ticket and {cost} centimes. {closing}", ["paid_c"] = cost };
    }
    public JsonArray ForfeitPawns()
    {
        var late = C.Rows("SELECT * FROM pawn WHERE status='held' AND due_day<$p0", Day);
        if (late.Count == 0) return late;
        C.Atomic(() => {
            foreach (var p in late)
            {
                int id = (int)N(p, "id"), who = (int)N(p, "player_id", 1); string kind = S(p, "item_kind"), name = S(p, "item_name");
                C.Execute("UPDATE pawn SET status='forfeit',closed_day=$p0 WHERE id=$p1", Day, id);
                C.Execute("DELETE FROM item WHERE kind='pawn_ticket' AND ref=$p0 AND player_id=$p1", id, who);
                if (kind == "medal") SetMedal("sold");
                C.Log(who, "pawn_sold", kind, $"The Berg van Barmhartigheid sold {Regex.Replace(name, "^your ", "Jef's ")} at its sale; the ticket had run out.");
                host.Interiors.WriteEvent("log", "pawn_sold", $"A pledge of Jef's ({Regex.Replace(name, "^your ", "his ")}) went to the Berg's sale.", 3);
            }
        });
        return late;
    }
    public JsonObject Ticket(int who, double id)
    {
        if (C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='pawn_ticket' AND ref=$p0 AND player_id=$p1", id, who) == 0) Refuse("not in your pockets", 404);
        var p = C.One("SELECT * FROM pawn WHERE id=$p0", id) ?? throw new NativeServiceException("no such pledge at the Berg", 404);
        return new JsonObject { ["no"] = 1000 + (int)N(p, "id"), ["name"] = p["item_name"]!.DeepClone(), ["loan_c"] = p["loan_c"]!.DeepClone(),
            ["rate_c"] = p["rate_c"]!.DeepClone(), ["day"] = p["day"]!.DeepClone(), ["due"] = DayName((int)N(p, "due_day")), ["redeem_c"] = RedeemCost(p, Day), ["status"] = p["status"]!.DeepClone() };
    }
    private void RegisterPawn(NativeServiceHost service)
    {
        service.Register("GET", "/api/berg", r => Berg(r.PlayerId));
        service.Register("GET", "/api/ticket/:id", r => Ticket(r.PlayerId, double.TryParse(r.Param("id"), out var id) ? id : double.NaN));
        service.Register("POST", "/api/berg/pawn", r => {
            var result = Pawn(r.PlayerId, N(r.Body, "item", double.NaN)); var pledge = result["pawn"]!;
            BeginRemark(r.PlayerId, Clerk, $"Jef pawns {Regex.Replace(S(pledge, "item_name"), "^your ", "his ")}. The Berg lends {N(pledge, "loan_c")} centimes on it. Interest {N(pledge, "rate_c")} centimes a day. The ticket runs out on day {N(pledge, "due_day")}.", $"\"Ticket {1000 + N(pledge, "id")}. Lose it and you lose the {(S(pledge, "item_kind") == "medal" ? "medal" : "pledge")}.\"");
            var reply = Reply(r.PlayerId, result); reply["berg"] = Berg(r.PlayerId); return reply;
        });
        service.Register("POST", "/api/berg/redeem", r => {
            var result = Redeem(r.PlayerId, N(r.Body, "pawn", double.NaN));
            BeginRemark(r.PlayerId, Clerk, $"Jef redeems his pledge and pays {N(result, "paid_c")} centimes, the loan and the interest.", "\"Paid and done. Mind you keep it this time.\"");
            var reply = Reply(r.PlayerId, result); reply["berg"] = Berg(r.PlayerId); return reply;
        });
        void MorningSale()
        {
            if (C.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='job_board' AND day=$p0", Day) == 0) return;
            var sold = ForfeitPawns();
            foreach (var p in sold.Where(p => N(p, "player_id", 1) == 1)) host.Publish("press", new JsonObject { ["text"] = $"The ticket ran out: the Berg van Barmhartigheid sold {S(p, "item_name")} at its sale." });
            if (sold.Count > 0) host.PublishState();
        }
        service.Jobs.BoardExtras.Add(MorningSale);
        service.TickHooks.Add((_, _) => MorningSale());
    }
}

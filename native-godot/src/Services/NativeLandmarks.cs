using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Schedule/event-derived landmark interior populations, with the original landmark priority.</summary>
public sealed partial class NativeLandmarks : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeTown town;
    private NativeServiceContext C => host.Context;
    private readonly Dictionary<int, string> inside = new();
    public Func<int, string, string>? TextFor;
    public static readonly string[] Ids = { "cathedral", "townhall", "vleeshuis", "steen", "oostershuis" };
    private static readonly Dictionary<string, string> Labels = new() { ["cathedral"] = "the cathedral", ["townhall"] = "the town hall", ["vleeshuis"] = "the Vleeshuis", ["steen"] = "the museum in the Steen", ["oostershuis"] = "the Oostershuis" };
    private static readonly Dictionary<string, string> Titles = new() { ["lm_curate"] = "the curate", ["lm_organist"] = "the organist", ["lm_beadle"] = "the beadle", ["lm_chairs"] = "the chair woman", ["lm_registrar"] = "the registrar", ["lm_alderman"] = "the alderman", ["lm_copyclerk"] = "a clerk", ["lm_concierge"] = "the porter", ["lm_cellarmaster"] = "Peyrot's cellar master", ["lm_painter"] = "the painter", ["lm_custodian"] = "the attendant", ["lm_storekeeper"] = "the storekeeper" };
    private static readonly (string id, string landmark, string label, double x, double z, double outZ, double y, string entry)[] DoorFacts = {
        ("cathedral_west", "cathedral", "the west door of the cathedral", -262,144.3,-1,0,"main"), ("townhall_main","townhall","the town hall",-257,63,1,0,"main"),
        ("vleeshuis_main","vleeshuis","the Vleeshuis",-122,87.5,-1,0,"main"),("vleeshuis_north","vleeshuis","the north door of the Vleeshuis",-115.7,110.4,1,0,"north"),
        ("steen_museum","steen","the museum in the Steen",-183.5,-21.6,1,2.2,"main"),("oostershuis_gate","oostershuis","the Oostershuis",120,123,-1,0,"main") };
    public NativeLandmarks(NativeServiceHost host, NativeTown town) => (this.host, this.town) = (host, town);
    private static string S(JsonNode? n, string key, string fallback = "") => NativeTown.S(n, key, fallback);
    private static double N(JsonNode? n) => NativeTown.N(n);
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static JsonNode Parse(JsonNode? n, string key, string fallback = "[]") => JsonNode.Parse(S(n, key, fallback))!;
    private int Day => (int)N(host.Clock.View()["day"]);
    private double Hour => N(host.Clock.View()["hour"]) + N(host.Clock.View()["minute"]) / 60;
    public static int Weekday(int day) => (day - 1) % 7 + 1;
    public static JsonObject? Theatre(int day, double hour) => Weekday(day) is 2 or 5 && hour >= 19 && hour < 22 ? new JsonObject { ["kind"] = "rehearsal", ["from"] = 19, ["to"] = 22 } : Weekday(day) == 7 && hour >= 18 && hour < 21 ? new JsonObject { ["kind"] = "performance", ["from"] = 18, ["to"] = 21 } : null;
    public static bool Open(string id, int day, double hour) => id switch { "cathedral" => hour >= 6 && hour < 19, "townhall" => Weekday(day) != 7 && hour >= 9 && hour < 16, "vleeshuis" => Weekday(day) != 7 && hour >= 7 && hour < 18 || Theatre(day, hour) != null, "steen" => hour >= 10 && hour < 16, "oostershuis" => Weekday(day) != 7 && hour >= 7 && hour < 18, _ => false };
    public static JsonObject? Mass(int day, double hour)
    {
        JsonObject Service(string kind, double from, double to, string celebrant, bool organ) => new() { ["kind"] = kind, ["from"] = from, ["to"] = to, ["celebrant"] = celebrant, ["organ"] = organ };
        if (Weekday(day) == 7) { if (hour >= 7 && hour < 8) return Service("low", 7, 8, "confessor", false); if (hour >= 9 && hour < 11) return Service("high", 9, 11, "parish", true); if (hour >= 15 && hour < 16) return Service("vespers", 15, 16, "confessor", true); return null; }
        foreach (int h in new[] { 7, 9, 11 }) if (hour >= h && hour < h + 1) return Service("low", h, h + 1, "confessor", false); return null;
    }
    public static bool ConfessionOpen(int day, double hour) => Mass(day, hour) == null && (Weekday(day) == 7 ? hour >= 6.5 && hour < 9 : hour >= 8 && hour < 12 || hour >= 14.5 && hour < 18.5);
    public static bool CivilDay(int day) => Weekday(day) is 2 or 4 or 6;
    public static bool CivilNow(int day, double hour) => CivilDay(day) && hour >= 11 && hour < 12;
    private static uint Hash(string value) { uint h = 2166136261; foreach (char c in value) h = unchecked((h ^ c) * 16777619); return h; }
    private static IEnumerable<JsonObject> Pick(IEnumerable<JsonObject> people, int count, string seed) => people.OrderBy(r => Hash(S(r, "id") + seed)).Take(count);
    private static bool Away(JsonNode? person) => S(person?["visitor"], "role") == "stranger" && person?["visitor"]?["here"]?.GetValue<bool>() != true;
    private static bool Newcomer(JsonNode? person) => S(person, "id").StartsWith("lm_", StringComparison.Ordinal);
    private static string Activity(JsonObject person, int day, double hour) => NativeShops.Activity(person, day, hour).act;
    private static bool Working(JsonObject? person, int day, double hour) => person != null && Activity(person, day, hour) == "work";
    private static bool Works(JsonNode? person, string id) => S(person?["work"], "place") == "landmark:" + id;
    private static JsonObject Person(JsonObject r, string role, string? title = null)
    {
        var result = new JsonObject { ["role"] = role }; foreach (string field in new[] { "id", "name", "first", "kind", "sex", "age" }) result[field] = r[field]?.DeepClone();
        title ??= Titles.GetValueOrDefault(S(r, "id")); if (title != null) result["title"] = title; return result;
    }
    public HashSet<string> Busy()
    {
        var busy = C.Rows("SELECT npc_id FROM npc_action WHERE status='active'").Select(r => S(r, "npc_id")).ToHashSet();
        foreach (var row in C.Rows("SELECT people_json FROM town_event WHERE status='running'")) foreach (var id in A(Parse(row, "people_json"))) busy.Add(id!.GetValue<string>()); return busy;
    }
    private IEnumerable<JsonObject> Free(int day, double hour, HashSet<string> busy) => town.Residents.Values.Where(r => N(r["age"]) >= 16 && !busy.Contains(S(r, "id")) && !Away(r) && S(r["work"], "kind") != "wait" && S(r, "trade") != "infant" && S(r, "id") != "fortune" && !Newcomer(r) && Activity(r, day, hour) == "home");
    public JsonObject? Wedding()
    {
        foreach (var row in C.Rows("SELECT * FROM town_event WHERE status='running' ORDER BY id DESC")) {
            var leads = A(Parse(row, "leads_json")); if (!leads.Any(l => S(l, "role") == "bride") || !leads.Any(l => S(l, "role") == "groom")) continue;
            var stages = A(Parse(row, "stages_json")); if (S(row, "place") != "cathedral_west" && !stages.Any(s => S(s, "place") == "cathedral_west")) continue;
            int index = (int)N(row?["stage"]), enter = stages.Select((s, i) => (s, i)).Where(p => S(p.s, "op") == "enter").Select(p => p.i).DefaultIfEmpty(-1).First(), walk = stages.Select((s, i) => (s, i)).Where(p => S(p.s, "op") == "procession").Select(p => p.i).DefaultIfEmpty(-1).First();
            return new JsonObject { ["row"] = row!.DeepClone(), ["leads"] = leads, ["stage"] = enter >= 0 ? index < enter ? "coming" : index == enter ? "vows" : "leaving" : walk >= 0 && index >= walk ? "leaving" : "vows", ["enters"] = enter >= 0 };
        }
        return null;
    }
    public JsonObject? Hall()
    {
        double now = (Day - 1) * 1440 + Hour * 60;
        foreach (var row in C.Rows("SELECT * FROM town_event WHERE status='running' ORDER BY id DESC")) {
            var stages = A(Parse(row, "stages_json")); int index = (int)N(row?["stage"]); if (index < 0 || index >= stages.Count) continue;
            int k = -1; for (int i = index; i >= 0; i--) if (S(stages[i], "op") == "enter" && S(stages[i], "hall", "cathedral_west") == "cathedral_west") { k = i; break; }
            if (k < 0 || index > k + 1) continue;
            double from = N(row?["start_m"]) + stages.Take(k).Sum(s => N(s?["minutes"])), to = from + N(stages[k]?["minutes"]);
            var acts = C.Rows("SELECT npc_id,phase,data_json FROM npc_action WHERE event_id=$p0 AND status='active'", (int)N(row?["id"])); string part;
            IEnumerable<JsonNode?> present;
            if (index == k) { part = "in"; present = acts.Where(a => S(a, "phase") == "in"); }
            else if (S(stages[index], "op") == "depart" && now - to < 8) { part = "out"; present = acts.Where(a => S(a, "phase") != "leave" && N(Parse(a, "data_json", "{}")["hall"]) != 0); }
            else continue;
            var order = A(Parse(row, "people_json")); var ids = present.Select(a => S(a, "npc_id")).OrderBy(id => { int i = order.Select(n => n!.GetValue<string>()).ToList().IndexOf(id); return i < 0 ? 9999 : i; }); var leads = A(Parse(row, "leads_json"));
            string kind = leads.Any(l => S(l, "role") == "bride") && leads.Any(l => S(l, "role") == "groom") ? "wedding" : S(row, "template") == "funeral" || leads.Any(l => S(l, "role") is "widow" or "bearers") ? "funeral" : "other";
            return new JsonObject { ["row"] = row!.DeepClone(), ["leads"] = leads, ["from_m"] = from, ["to_m"] = to, ["inside"] = new JsonArray(ids.Select(id => (JsonNode)JsonValue.Create(id)!).ToArray()), ["kind"] = kind, ["part"] = part };
        }
        return null;
    }
    public (JsonObject groom, JsonObject bride)? CivilCouple(int day)
    {
        if (!CivilDay(day)) return null; string key = "landmarks:civil:" + day; var saved = C.World(key);
        if (saved is JsonValue) return null;
        if (saved is JsonObject) { var groom = town.Resident(S(saved, "groom")); var bride = town.Resident(S(saved, "bride")); return groom != null && bride != null ? (groom, bride) : null; }
        var wed = new HashSet<string>(); foreach (var row in C.Rows("SELECT leads_json FROM town_event WHERE status IN ('running','done')")) foreach (var lead in A(Parse(row, "leads_json"))) if (S(lead, "role") is "bride" or "groom") wed.Add(S(lead, "id"));
        foreach (var row in C.Rows("SELECT value_json FROM world_state WHERE key LIKE 'landmarks:civil:%'")) { var couple = Parse(row, "value_json", "null"); if (couple is JsonObject) { wed.Add(S(couple, "groom")); wed.Add(S(couple, "bride")); } }
        var busy = Busy(); var excluded = new HashSet<string> { "soldier", "sentry", "corporal", "priest", "police", "emigrant", "beggar", "thief" };
        bool Ok(JsonObject r) => !excluded.Contains(S(r, "trade")) && !Away(r) && S(r["work"], "kind") != "wait" && !Newcomer(r) && !S(r, "id").StartsWith("stranger_", StringComparison.Ordinal) && !wed.Contains(S(r, "id")) && !busy.Contains(S(r, "id")) && S(r["work"], "place") != "town_hall";
        var men = town.Residents.Values.Where(r => S(r, "sex") == "m" && N(r["age"]) >= 21 && N(r["age"]) <= 48 && S(r, "family_role") is "son" or "single" or "lodger" or "widower" && Ok(r));
        var women = town.Residents.Values.Where(r => S(r, "sex") == "f" && N(r["age"]) >= 16 && N(r["age"]) <= 42 && S(r, "family_role") is "daughter" or "single" or "lodger" or "widow" && Ok(r));
        foreach (var groom in Pick(men, int.MaxValue, "civil:" + day)) {
            var bride = women.Where(w => N(w["household"]) != N(groom["household"]) && Math.Abs(N(w["age"]) - N(groom["age"])) <= 14).OrderBy(w => Math.Pow(N(w["home"]?["sx"]) - N(groom["home"]?["sx"]), 2) + Math.Pow(N(w["home"]?["sz"]) - N(groom["home"]?["sz"]), 2)).FirstOrDefault();
            if (bride == null) continue; C.SetWorld(key, new JsonObject { ["groom"] = groom["id"]!.DeepClone(), ["bride"] = bride["id"]!.DeepClone() }); return (groom, bride);
        }
        C.SetWorld(key, "none"); return null;
    }
    public JsonArray RegisterToday(int day, double hour)
    {
        var result = new JsonArray(); var civil = CivilCouple(day);
        if (civil != null && hour >= 11.5) result.Add($"Married at the town hall before the alderman: {S(civil.Value.groom, "name")} and {S(civil.Value.bride, "name")}.");
        foreach (var row in C.Rows("SELECT leads_json FROM town_event WHERE day=$p0 AND status IN ('running','done')", day)) { var leads = A(Parse(row, "leads_json")); var g = leads.FirstOrDefault(l => S(l, "role") == "groom"); var b = leads.FirstOrDefault(l => S(l, "role") == "bride"); if (g != null && b != null) result.Add($"Married at the town hall this morning, and after in the cathedral: {S(g, "name")} and {S(b, "name")}."); }
        return result;
    }
    public JsonArray Posters(int player)
    {
        var result = new JsonArray(); foreach (var row in C.Rows("SELECT kind,text_json FROM poster WHERE status='up' ORDER BY id DESC LIMIT 6")) { var text = Parse(row, "text_json", "{}"); string Read(string key) => TextFor?.Invoke(player, S(text, key)) ?? S(text, key); var poster = new JsonObject { ["kind"] = S(row, "kind"), ["heading"] = Read("heading"), ["body"] = Read("body"), ["footer"] = Read("footer") }; if (S(poster, "heading") != "" || S(poster, "body") != "") result.Add(poster); } return result;
    }
    private JsonObject NowOf(string id, int day, double hour, HashSet<string> busy, int player)
    {
        bool open = Open(id, day, hour); var people = new JsonArray(); var seen = new HashSet<string>();
        void Add(JsonObject? person, string role, string? title = null) { if (person != null && seen.Add(S(person, "id"))) people.Add(Person(person, role, title)); }
        var result = new JsonObject { ["id"] = id, ["label"] = Labels[id], ["open"] = open, ["day"] = day, ["hour"] = hour, ["people"] = people, ["service"] = null, ["organ"] = false, ["confession"] = new JsonObject { ["open"] = false, ["priest"] = null }, ["wedding"] = null, ["funeral"] = null, ["civil"] = null, ["register"] = new JsonArray(), ["posters"] = new JsonArray(), ["theatre"] = null };
        if (id == "cathedral") Cathedral(result, Add, day, hour, busy);
        else if (id == "townhall") {
            if (open) {
                var couple = CivilNow(day, hour) ? CivilCouple(day) : null;
                if (couple != null) {
                    var (g, b) = couple.Value; Add(g, "c_groom", null); Add(b, "c_bride", null); Add(town.Resident("lm_alderman"), "alderman_wed", null); Add(town.Resident("lm_registrar"), "registrar_wed", null);
                    var fam = town.Residents.Values.Where(r => (N(r["household"]) == N(g["household"]) || N(r["household"]) == N(b["household"])) && S(r, "id") != S(g, "id") && S(r, "id") != S(b, "id") && Activity(r, day, hour) == "home" && !busy.Contains(S(r, "id"))).ToArray();
                    foreach (var w in Pick(Free(day, hour, busy).Where(r => S(r, "sex") == "m" && N(r["age"]) >= 21 && !fam.Contains(r) && S(r, "id") != S(g, "id")), 2, "wit:" + day)) Add(w, "witness", null);
                    foreach (var f in fam.Take(5)) Add(f, "c_guest", null); result["civil"] = new JsonObject { ["groom"] = g["name"]!.DeepClone(), ["bride"] = b["name"]!.DeepClone() };
                }
                foreach (var r in town.Residents.Values) if ((S(r["work"], "place") == "town_hall" || Works(r, id)) && Working(r, day, hour)) Add(r, S(r, "id") switch { "lm_registrar" => "registrar", "lm_alderman" => "alderman", "lm_concierge" => "concierge", _ => "clerk" }, S(r, "trade") == "clerk" && !Titles.ContainsKey(S(r, "id")) ? "a clerk" : null);
                int slot = (int)Math.Floor(hour * 2), i = 0; foreach (var r in Pick(Free(day, hour, busy).Where(r => !seen.Contains(S(r, "id"))), 1 + (int)(Hash($"c:{day}:{slot}") % 3), $"caller:{day}:{slot}")) Add(r, i++ == 0 ? "caller" : "waiting", null);
                result["posters"] = Posters(player);
            }
            result["register"] = RegisterToday(day, hour);
        }
        else if (open && id == "vleeshuis") {
            foreach (var r in town.Residents.Values) if (Works(r, id) && Working(r, day, hour)) Add(r, S(r, "trade") switch { "cellar_master" => "cellarmaster", "painter" => "painter", _ => "cellarman" }, S(r, "trade") == "cellarman" ? "a cellarman" : null);
            var th = Theatre(day, hour); if (th != null) {
                var society = Pick(town.Residents.Values.Where(r => N(r["age"]) >= 18 && N(r["age"]) <= 60 && N(r["stats"]?["wealth"]) >= 2 && !Newcomer(r) && S(r["work"], "kind") != "wait" && !Away(r)), 14, "liefde-en-eendragt");
                int i = 0; foreach (var r in society.Where(r => Activity(r, day, hour) == "home" && !busy.Contains(S(r, "id"))).Take(6)) Add(r, i == 0 ? "prompter" : "actor", i++ == 0 ? "the society's prompter" : "a player of the society");
                if (S(th, "kind") == "performance") foreach (var r in Pick(Free(day, hour, busy).Where(r => !seen.Contains(S(r, "id"))), 16, "aud:" + day)) Add(r, "audience", null);
                result["theatre"] = new JsonObject { ["kind"] = th["kind"]!.DeepClone() };
            }
        }
        else if (open && id == "steen") {
            var custodian = town.Resident("lm_custodian"); if (Working(custodian, day, hour)) Add(custodian, "custodian", null);
            int slot = (int)Math.Floor(hour), count = Math.Min(6, 2 + (int)(Hash($"v:{day}:{slot}") % 5) - (hour < 11 ? 1 : 0));
            foreach (var r in Pick(Free(day, hour, busy).Where(r => N(r["stats"]?["wealth"]) >= 2 || N(r["stats"]?["gossip"]) >= 6), count, $"museum:{day}:{slot}")) Add(r, "visitor", null);
        }
        else if (open && id == "oostershuis") foreach (var r in town.Residents.Values) if (Works(r, id) && Working(r, day, hour)) Add(r, S(r, "trade") == "storekeeper" ? "storekeeper" : "porter", S(r, "trade") == "natie" ? "a natie man" : null);
        return result;
    }
    public JsonObject View(string id, int player = 1)
    {
        if (!Ids.Contains(id)) throw new NativeServiceException("no such landmark", 404); int day = Day; double hour = Hour; var busy = Busy(); var civil = CivilNow(day, hour) ? CivilCouple(day) : null;
        if (civil != null) { busy.Add(S(civil.Value.groom, "id")); busy.Add(S(civil.Value.bride, "id")); }
        foreach (string prior in Ids) { if (prior == id) break; foreach (var person in NowOf(prior, day, hour, new HashSet<string>(busy), player)["people"]!.AsArray()) busy.Add(S(person, "id")); }
        if (id == "townhall" && civil != null) { busy.Remove(S(civil.Value.groom, "id")); busy.Remove(S(civil.Value.bride, "id")); }
        return NowOf(id, day, hour, busy, player);
    }
    public JsonArray Doors()
    {
        bool eventOpen = Wedding() != null || Hall() != null;
        return new JsonArray(DoorFacts.Select(d => (JsonNode)new JsonObject { ["id"] = d.id, ["landmark"] = d.landmark, ["label"] = d.label, ["step"] = new JsonArray(d.x, d.z), ["out"] = new JsonArray(0, d.outZ), ["y"] = d.y, ["entry"] = d.entry, ["open"] = Open(d.landmark, Day, Hour) || d.landmark == "cathedral" && eventOpen }).ToArray());
    }
    public string? Inside(int player) => inside.GetValueOrDefault(player);
    public void SetInside(int player, string? id) { if (id == null) inside.Remove(player); else { if (!Ids.Contains(id)) throw new NativeServiceException("no such landmark", 404); inside[player] = id; } }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/landmarks", r => new JsonObject { ["doors"] = Doors() });
        service.Register("GET", "/api/landmark/:id", r => { var result = View(r.Param("id"), r.PlayerId); if (r.Param("id") == "cathedral") result["barred"] = Barred(r.PlayerId); return result; });
        service.Register("POST", "/api/landmark/here", r => { SetInside(r.PlayerId, r.Body["id"] == null ? null : r.Text("id", "invalid")); return new JsonObject { ["ok"] = true }; });
        RegisterDeeds(); RegisterConfession(); service.NewGame += inside.Clear; service.Loaded += inside.Clear;
    }
}

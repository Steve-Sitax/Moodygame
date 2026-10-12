using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeLandmarks
{
    private void Cathedral(JsonObject result, Action<JsonObject?, string, string?> add, int day, double hour, System.Collections.Generic.HashSet<string> busy)
    {
        void Add(JsonObject? r, string role, string? title = null) => add(r, role, title);
        var people = result["people"]!.AsArray(); var service = Mass(day, hour);
        var curate = town.Resident("lm_curate"); var parish = town.Residents.Values.FirstOrDefault(r => S(r, "trade") == "priest" && S(r, "id") != "lm_curate"); var sexton = town.Residents.Values.FirstOrDefault(r => S(r, "trade") == "sexton");
        var organist = town.Resident("lm_organist"); var beadle = town.Resident("lm_beadle"); var chairs = town.Resident("lm_chairs");
        var wed = Wedding(); var hall = Hall(); var wedLeads = A(wed?["leads"]); var hallLeads = A(hall?["leads"]);
        if (wed != null) result["wedding"] = new JsonObject { ["event"] = wed["row"]!["id"]!.DeepClone(), ["title"] = wed["row"]!["title"]!.DeepClone(), ["groom"] = wedLeads.First(l => S(l, "role") == "groom")!["name"]!.DeepClone(), ["bride"] = wedLeads.First(l => S(l, "role") == "bride")!["name"]!.DeepClone(), ["stage"] = wed["stage"]!.DeepClone() };
        if (hall != null && S(hall, "kind") == "funeral") result["funeral"] = new JsonObject { ["event"] = hall["row"]!["id"]!.DeepClone(), ["title"] = hall["row"]!["title"]!.DeepClone(), ["widow"] = hallLeads.FirstOrDefault(l => S(l, "role") == "widow")?["name"]?.DeepClone(), ["part"] = hall["part"]!.DeepClone() };
        bool inEvent = hall != null && S(hall, "kind") != "wedding";
        if (hall != null && (S(hall, "kind") != "wedding" || wed?["enters"]?.GetValue<bool>() == true)) {
            if (S(hall, "part") == "in") { if (organist != null && Activity(organist, day, hour) != "church") Add(organist, "organist"); Add(sexton, "sexton", "the sexton"); }
            int n = 0;
            foreach (var id in A(hall["inside"])) {
                var person = town.Resident(id!.GetValue<string>()); if (person == null) continue; var lead = hallLeads.FirstOrDefault(l => S(l, "id") == S(person, "id")); string role = S(lead, "role");
                if (role == "priest") Add(person, S(hall, "kind") == "funeral" ? "requiem_priest" : "wedding_priest", "the priest");
                else if (role is "groom" or "bride") Add(person, role);
                else if (role == "bearers") Add(person, "bearer" + Math.Clamp((int)N(lead?["n"]), 0, 3), "a bearer");
                else if (role == "widow") Add(person, "widow", "the widow");
                else if (N(person["age"]) >= 6 && n++ < 26) Add(person, S(hall, "kind") == "funeral" ? "mourner" : "guest");
            }
        }
        if (wed != null && S(wed, "stage") == "vows" && wed["enters"]!.GetValue<bool>() == false) {
            Add(town.Resident(S(wedLeads.First(l => S(l, "role") == "groom"), "id")), "groom"); Add(town.Resident(S(wedLeads.First(l => S(l, "role") == "bride"), "id")), "bride");
            Add(town.Resident(S(wedLeads.FirstOrDefault(l => S(l, "role") == "priest"), "id")) ?? parish ?? curate, "wedding_priest", "the priest"); Add(sexton, "sexton", "the sexton");
            if (organist != null && Activity(organist, day, hour) != "church") Add(organist, "organist"); var leadIds = wedLeads.Select(l => S(l, "id")).ToHashSet();
            foreach (var person in A(Parse(wed["row"], "people_json")).Select(id => id!.GetValue<string>()).Where(id => !leadIds.Contains(id)).Select(town.Resident).Where(r => r != null && N(r["age"]) >= 6).Take(26)) Add(person, "guest");
        }
        bool taken = S(wed, "stage") == "vows" || inEvent;
        if (service != null && !taken) {
            var celebrant = S(service, "celebrant") == "parish" && Working(parish, day, hour) ? parish : Working(curate, day, hour) ? curate : parish; Add(celebrant, "celebrant", "the priest");
            if (S(service, "kind") == "high") Add(ReferenceEquals(celebrant, curate) ? parish : curate, "preacher", ReferenceEquals(celebrant, curate) ? "the priest" : "the curate");
            if (S(service, "kind") != "low" || Working(sexton, day, hour)) Add(sexton, "sexton", "the sexton");
            if (Working(beadle, day, hour)) Add(beadle, "beadle_mass"); if (Working(chairs, day, hour)) Add(chairs, "chairs_collect"); if (service["organ"]!.GetValue<bool>() && Working(organist, day, hour)) Add(organist, "organist");
            var flock = Weekday(day) == 7 ? town.Residents.Values.Where(r => Activity(r, day, hour) == "church" && !busy.Contains(S(r, "id"))).OrderBy(r => Hash(S(r, "id"))).Take(30) : Pick(Free(day, hour, busy).Where(r => N(r["stats"]?["piety"]) >= 6), 12, $"mass:{day}:{N(service["from"])}");
            foreach (var person in flock) Add(person, "worshipper");
        }
        else if (!taken) {
            if (Working(curate, day, hour)) Add(curate, ConfessionOpen(day, hour) ? "confessor" : "sacristy"); if (Working(beadle, day, hour)) Add(beadle, "beadle"); if (Working(chairs, day, hour)) Add(chairs, "chairs");
            if (Working(organist, day, hour) && Weekday(day) != 7 && hour >= 13.5 && hour < 15) Add(organist, "organist");
            int slot = (int)Math.Floor(hour * 2), i = 0; var roles = new[] { "candle", "prayer", "chapel", "prayer", "candle" };
            foreach (var person in Pick(Free(day, hour, busy).Where(r => N(r["stats"]?["piety"]) >= 5), 2 + (int)(Hash($"n:{day}:{slot}") % 4), $"pray:{day}:{slot}")) Add(person, roles[i++ % roles.Length]);
        }
        bool organ = people.Any(p => S(p, "role") == "organist"); var inBox = people.FirstOrDefault(p => S(p, "role") == "confessor"); result["organ"] = organ; result["confession"] = new JsonObject { ["open"] = inBox != null, ["priest"] = inBox?["id"]?.DeepClone() };
        double HourOf(double m) => (m % 1440 + 1440) % 1440 / 60;
        if (hall != null && S(hall, "kind") == "funeral" && S(hall, "part") == "in") { double to = HourOf(N(hall["to_m"])); result["service"] = new JsonObject { ["kind"] = "funeral", ["from"] = HourOf(N(hall["from_m"])), ["to"] = to == 0 ? 24 : to, ["celebrant"] = "parish", ["organ"] = organ }; }
        else if (S(wed, "stage") == "vows") result["service"] = new JsonObject { ["kind"] = "wedding", ["from"] = hour, ["to"] = hour + 1, ["celebrant"] = "parish", ["organ"] = organ };
        else result["service"] = inEvent ? null : service;
        bool kept = result["wedding"] != null || result["funeral"] != null; result["open"] = result["open"]!.GetValue<bool>() || kept; if (!result["open"]!.GetValue<bool>()) result["people"] = new JsonArray();
    }
}

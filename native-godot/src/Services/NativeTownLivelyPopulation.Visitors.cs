using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownLivelyPopulation
{
    private sealed partial class Builder
    {
        private void MakeStalls()
        {
            foreach (var stall in A(k.Facts["CHURCH_STALLS"])) {
                var home = FreeHome(N(stall?["x"]), N(stall?["z"])); int hh = ++k.Household; var point = Snap(N(stall?["x"]), N(stall?["z"]), 2); string id = "stall:" + S(stall, "id");
                outPlaces[id] = new JsonObject { ["label"] = S(stall, "side") == "groenplaats" ? "the stalls against the cathedral on the Groenplaats side" : "the stall against the cathedral in the Blauwmoezelstraat", ["x"] = point.x, ["z"] = point.z, ["r"] = 3, ["district"] = "grote-markt" };
                bool old = k.Rng() < .5; string kind = old ? "old_woman" : k.Pick(new JsonArray("shopwife", "wife_b")); int age = old ? k.Int(58, 74) : k.Int(34, 56); var r = Add("devotion_seller", kind, "f", age, home, hh, old ? "widow" : "head", new() { ["place"] = id, ["kind"] = "post", ["at"] = new JsonArray(point.x, point.z, N(stall?["yaw"])) });
                Schedule(r, new(Seg(k.J(8), 12.5, "work"), Seg(13.5, k.J(18), "work")), new(Seg(k.J(6.75), 12.75, "work"), Seg(13.5, k.J(17), "work")));
            }
        }
        private void MakeBeggars()
        {
            bool hasWest = k.Residents.Any(r => S(r, "trade") == "beggar" && S(r["work"], "place") == "cathedral"); int i = 0;
            foreach (var at in A(k.Facts["CHURCH_BEGGARS"]).Skip(hasWest ? 1 : 0).Take(2)) {
                var home = FreeHome(-230 + i * 40, 250); bool female = i++ == 0; var point = Snap(N(at?[0]), N(at?[1]), 1.5); int age = k.Int(48, 76), hh = ++k.Household; var r = Add("beggar", female ? "old_woman" : "beggar", female ? "f" : "m", age, home, hh, female ? "widow" : "single", new() { ["place"] = "cathedral", ["kind"] = "beg", ["at"] = new JsonArray(point.x, point.z, N(at?[2])) });
                Schedule(r, new(Seg(k.J(7.5), 12, "work"), Seg(13, k.J(19), "work")), new(Seg(6.5, 13, "work"), Seg(14, k.J(19), "work")));
            }
        }
        private void MakeBeguines()
        {
            var at = k.Facts["BEGUINES_AT"]!; var home = FreeHome(N(at[0]), N(at[1])); int hh = ++k.Household;
            foreach (var name in A(k.Facts["BEGUINES"]).Take(2)) {
                int age = k.Int(38, 70); var r = Add("beguine", "beguine", "f", age, home, hh, "single", new() { ["place"] = "home", ["kind"] = "inside", ["door"] = new JsonArray(N(home["sx"]), N(home["sz"])) }, (name![0]!.GetValue<string>(), name[1]!.GetValue<string>())); r["stats"]!["piety"] = Math.Max(N(r["stats"]?["piety"]), 8);
                Schedule(r, new(Seg(k.J(8.25, 0), k.J(9.75, 0), "church", "church"), Seg(10, k.J(11.25), "market", Nearest(markets, (-254, 94))), Seg(k.J(15, 0), k.J(16.5, 0), "stroll", "play:handschoenmarkt")), new(Seg(8.25, 11, "church", "church"), Seg(15, 17, "stroll", "play:handschoenmarkt")));
            }
        }
        private void MakeTravellers()
        {
            var at = k.Facts["HOTEL_AT"]!; var home = FreeHome(N(at[0]), N(at[1])); var sights = A(k.Facts["SIGHTS"]); var route = sights.Select(q => Snap(N(q?[0]), N(q?[1]), 3)).ToArray(); var faces = sights.Select((q, i) => Round(Math.Atan2(N(q?[2]) - route[i].x, N(q?[3]) - route[i].z) * 1000) / 1000).ToArray();
            outPlaces["round:sights"] = new JsonObject { ["label"] = "the sights of Antwerp", ["x"] = route[0].x, ["z"] = route[0].z, ["r"] = 60, ["district"] = "grote-markt" }; int coupleHh = ++k.Household, singleHh = ++k.Household; var party = new List<JsonObject>();
            foreach (var tourist in A(k.Facts["TOURISTS"])) {
                bool couple = S(tourist, "surname") == "Pemberton"; string sex = S(tourist, "sex"); var r = Add("tourist", S(tourist, "kind"), sex, (int)N(tourist?["age"]), home, couple ? coupleHh : singleHh, couple ? sex == "m" ? "husband" : "wife" : "single", new() { ["place"] = "round:sights", ["kind"] = "round", ["route"] = Route(route), ["faces"] = new JsonArray(faces.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()) }, (S(tourist, "first"), S(tourist, "surname"))); r["origin"] = couple ? "London" : "Manchester"; party.Add(r);
                Schedule(r, new(Seg(k.J(9.5), 12, "work"), Seg(12, k.J(13.25), "church", "church"), Seg(k.J(14.25), k.J(17), "work")), new(Seg(k.J(11.5), 13, "work"), Seg(k.J(14.5), k.J(16.5), "work")));
            }
            party[1]["sched"] = party[0]["sched"]!.DeepClone(); party[0]["mate"] = S(party[1], "id"); party[1]["mate"] = S(party[0], "id");
        }
    }
}

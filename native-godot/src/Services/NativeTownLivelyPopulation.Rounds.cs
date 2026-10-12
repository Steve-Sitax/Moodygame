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
        private void MakeRounds()
        {
            var houses = new HashSet<int>(); var stops = new List<(double x, double z)>(); var cartTrades = A(k.Facts["CART_TRADES"]).Concat(A(k.Facts["DOGCART_TRADES"])).Select(t => t!.GetValue<string>()).ToHashSet(); JsonObject? sweep = null;
            foreach (var spec in A(k.Facts["ROUNDS"])) {
                string trade = S(spec, "trade"), sex = S(spec, "sex"), role = "head"; var at = (x: N(spec?["at"]?[0]), z: N(spec?["at"]?[1])); JsonObject home; int hh;
                if (trade == "baker_boy") { string shop = S(spec, "key") == "bread_rijn" ? "bakery_rijn" : "bakery_steen"; var baker = k.Residents.FirstOrDefault(r => S(r["work"], "shop") == shop && S(r, "trade") == "baker") ?? k.Residents.FirstOrDefault(r => S(r["work"], "shop") == shop); if (baker == null) continue; home = baker["home"]!.DeepClone().AsObject(); hh = (int)N(baker["household"]); role = "apprentice"; }
                else if (trade == "nun") { var convent = k.Facts["CONVENT_AT"]!; home = FreeHome(N(convent[0]), N(convent[1])); hh = ++k.Household; role = "sister"; }
                else { home = FreeHome(at.x, at.z); hh = ++k.Household; role = sex == "f" ? k.Pick(new JsonArray("head", "widow")) : "head"; }
                string id = "round:" + S(spec, "key"); var round = rounds.Build(at, N(spec?["reach"]), (int)N(spec?["stops"]), (N(home["sx"]), N(home["sz"])), k.Rng, houses, cartTrades.Contains(trade) ? 1.1 : .5, stops); houses.UnionWith(round.Houses); stops.AddRange(round.Route);
                var first = round.Route.Count > 0 ? round.Route[0] : (N(home["sx"]), N(home["sz"])); outPlaces[id] = new JsonObject { ["label"] = S(spec, "label"), ["x"] = first.Item1, ["z"] = first.Item2, ["r"] = N(spec?["reach"]), ["district"] = S(spec, "district") }; var work = new JsonObject { ["place"] = id, ["kind"] = "round", ["route"] = Route(round.Route), ["faces"] = new JsonArray(round.Faces.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()) };
                int count = trade == "nun" ? 2 : 1, sisterIndex = (int)Math.Floor(k.Rng() * A(k.Facts["SISTERS"]).Count); var pair = new List<JsonObject>();
                for (int i = 0; i < count; i++) {
                    int age = k.Int((int)N(spec?["age"]?[0]), (int)N(spec?["age"]?[1])); (string first, string surname)? name = null; string? full = null;
                    if (trade == "nun") { string sister = A(k.Facts["SISTERS"])[(sisterIndex + i) % A(k.Facts["SISTERS"]).Count]!.GetValue<string>(); var family = Name("f"); name = (sister, family.surname); full = "Sister " + sister; }
                    var r = Add(trade, S(spec, "kind"), sex, age, home, hh, role, work, name, full); pair.Add(r); string? tavern = taverns.Length > 0 ? Nearest(taverns, (N(home["sx"]), N(home["sz"]))) : null; string play = Nearest(plays, (N(home["sx"]), N(home["sz"]))), market = Nearest(markets, (N(home["sx"]), N(home["sz"])));
                    RoundSchedule(r, trade, tavern, play, market); if (trade == "sweep") sweep = r;
                }
                if (pair.Count == 2) { pair[1]["sched"] = pair[0]["sched"]!.DeepClone(); pair[0]["mate"] = S(pair[1], "id"); pair[1]["mate"] = S(pair[0], "id"); }
            }
            if (sweep != null) { var boy = Add("sweep", "sweep_boy", "m", k.Int(9, 12), sweep["home"]!.AsObject(), (int)N(sweep["household"]), "apprentice", sweep["work"]!.AsObject()); boy["sched"] = sweep["sched"]!.DeepClone(); boy["mate"] = S(sweep, "id"); sweep["mate"] = S(boy, "id"); }
        }
        private void RoundSchedule(JsonObject r, string trade, string? tavern, string play, string market)
        {
            var day = new JsonArray(); var sunday = new JsonArray();
            void Tavern(double from, double to) { if (tavern != null) day.Add(Seg(k.J(from), k.J(to), "tavern", tavern)); }
            switch (trade) {
                case "milk_woman": day.Add(Seg(k.J(5.75), k.J(9.5), "work")); day.Add(Seg(k.J(10), k.J(11), "market", market)); day.Add(Seg(k.J(15.75), k.J(17.5), "work")); sunday.Add(Seg(k.J(6), k.J(8.5), "work")); Church(sunday, r, 9, 11); break;
                case "baker_boy": day.Add(Seg(k.J(6.25), k.J(9.25), "work")); day.Add(Seg(k.J(14.5), k.J(16), "work")); day.Add(Seg(k.J(16.5), k.J(18), "play", play)); sunday.Add(Seg(k.J(7), k.J(8.75), "work")); sunday.Add(Seg(k.J(9), k.J(11), "church", "church")); sunday.Add(Seg(k.J(14), k.J(17), "play", play)); break;
                case "grinder": day.Add(Seg(k.J(8.75), 12, "work")); day.Add(Seg(k.J(13.25), k.J(17), "work")); Tavern(19, 21.5); Church(sunday, r, 9, 11); if (tavern != null) sunday.Add(Seg(k.J(16), k.J(20), "tavern", tavern)); break;
                case "ragman": day.Add(Seg(k.J(8), 12, "work")); day.Add(Seg(k.J(13), k.J(16.5), "work")); Tavern(18.5, 21); sunday.Add(Seg(k.J(14), k.J(17), "loiter", play)); break;
                case "coalman": day.Add(Seg(k.J(7), 12, "work")); day.Add(Seg(k.J(13), k.J(16), "work")); Tavern(18.5, 21); Church(sunday, r, 9, 11); sunday.Add(Seg(k.J(15), k.J(17), "stroll", play)); break;
                case "sweep": day.Add(Seg(k.J(7), 12, "work")); day.Add(Seg(k.J(13), k.J(16.5), "work")); Church(sunday, r, 9, 11); sunday.Add(Seg(k.J(14.5), k.J(17), "stroll", play)); break;
                case "mussel_seller": day.Add(Seg(k.J(10), k.J(12.75), "work")); day.Add(Seg(k.J(16.5), k.J(20), "work")); Church(sunday, r, 9, 11); break;
                case "broom_seller": day.Add(Seg(k.J(9), 12, "work")); day.Add(Seg(k.J(13), k.J(16.5), "work")); sunday.Add(Seg(k.J(8.75), k.J(11), "church", "church")); break;
                case "nun": day.Add(Seg(k.J(9, 0), 12, "work")); day.Add(Seg(k.J(14, 0), k.J(17, 0), "work")); sunday.Add(Seg(8.75, 11, "church", "church")); sunday.Add(Seg(14.5, 16.5, "work")); break;
            }
            Schedule(r, day, sunday);
        }
    }
}

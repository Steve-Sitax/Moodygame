using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownBackPopulation
{
    private sealed partial class Builder
    {
        private readonly Dictionary<string, int> counts = new();
        private void Join(string? key) { if (key != null) counts[key] = counts.GetValueOrDefault(key) + 1; }
        private string? WithRoom(IEnumerable<string> keys, (double x, double z) at, int capacity, double maximum = 1e9) { var eligible = keys.Where(k => counts.GetValueOrDefault(k) < capacity && D(At(All(k)), at) < maximum).ToArray(); return eligible.Length > 0 ? Nearest(eligible, at) : null; }
        private List<string> Spread(IEnumerable<string> keys, int n) { var list = keys.ToArray(); var result = list.Length > 0 ? new List<string> { list[0] } : new(); while (result.Count < Math.Min(n, list.Length)) { string best = ""; double distance = -1; foreach (string k in list) { if (result.Contains(k)) continue; double d = result.Min(o => D(At(All(o)), At(All(k)))); if (d > distance) { distance = d; best = k; } } result.Add(best); } return result; }
        private void MakePoor()
        {
            var quays = new[] { "rijnkaai", "werf", "bassin", "bassin_south", "entrepot", "canal", "vismarkt" }.Where(k => A(p.Facts["HAULS"]?[k]).Count > 0 && places[k] != null).ToArray(); var washers = new Dictionary<string, int>();
            string? PumpNear((double x, double z) at) { var candidates = hubs.Where(h => h.Pump != null && D((h.X, h.Z), at) < 130 && washers.GetValueOrDefault(h.Pump) < 5).Select(h => h.Pump!).ToArray(); return candidates.Length > 0 ? Nearest(candidates, at) : null; }
            var gangs = Spread(hubs.Where(h => h.Corner != null).Select(h => h.Corner!), Math.Max(3, (int)R(8 * scale))); var cardSites = Spread(hubs.Where(h => h.Cards != null).Select(h => h.Cards!), Math.Max(3, (int)R(10 * scale))); var knots = new List<string>();
            foreach (var h in hubs) { if (h.Corner == null || gangs.Contains(h.Corner)) continue; var c = All(h.Corner); knots.Add(Place("knot:" + h.Key, "a street corner where the men out of work stand", N(c["x"]), N(c["z"]), 2, new() { ["out"] = c["out"]?.DeepClone() })); }
            var gossipSites = new List<string>(); int maximum = scale >= 1.2 ? 150 : scale >= .85 ? 135 : 30;
            var order = hubs.Select(h => (h, k: h.Pump != null ? -1 : rng())).OrderBy(o => o.k).Select(o => o.h).ToArray(); int households = 0, hubNo = 0;
            foreach (var h in order) {
                int number = h.Pump != null ? scale >= .85 ? 3 : 1 : h.Corner != null ? scale >= .85 ? 2 : hubNo % 2 : scale >= .85 ? 1 : hubNo % 2; hubNo++;
                for (int k = 0; k < number && households < maximum; k++) {
                    var d = FreeDoor(h.X, h.Z, 60, Alley) ?? FreeDoor(h.X, h.Z, 60, q => g.Across(q) < 9); if (d == null) continue;
                    var home = Home(d); var at = Step(home); int hh = ++household; households++; string surname = Surname();
                    string? pump = h.Pump != null && washers.GetValueOrDefault(h.Pump) < 5 ? h.Pump : PumpNear(at), corner = WithRoom(gangs, at, 5), cards = WithRoom(cardSites, at, 5, 140), gossip = WithRoom(gossipSites, at, 3, 30);
                    if (gossip == null) { gossip = "gossip:" + h.Key + (k > 0 ? "_" + k : ""); var point = g.RoomNear(at.x + N(d["out"]?[0]) * 1.6, at.z + N(d["out"]?[1]) * 1.6, 1, 4, groupPoints, 3) ?? at; groupPoints.Add(point); Place(gossip, "a neighbour's door", point.x, point.z, 1.5, new() { ["out"] = d["out"]!.DeepClone() }); gossipSites.Add(gossip); }
                    string? lanes = h.Lanes; string play = h.Play ?? Nearest(outPlaces.Select(q => q.Key).Where(key => key.StartsWith("play:bk", StringComparison.Ordinal)), at), market = Nearest(markets, at); string? tavern = WithRoom(taverns, at, 7, 220); Join(tavern); string church = NearestChurch(at);
                    bool widow = Chance(.18); int manAge = Int(26, 52);
                    if (!widow) {
                        if (Chance(.12)) MakeDrinker(h, home, hh, surname, manAge, tavern ?? market);
                        else MakeLabourer(home, hh, surname, manAge, quays, lanes, tavern, cards, knots, church);
                    }
                    int womanAge = widow ? Int(36, 60) : Math.Max(22, manAge - Int(0, 8)); bool washes = pump != null && Chance(.6); if (washes) washers[pump!] = washers.GetValueOrDefault(pump!) + 1; Join(gossip);
                    string trade = washes ? "washerwoman" : Chance(.3) ? "seamstress" : "housewife", kind = Pick(new[] { "wife_a", "wife_b", "wife_b", "fishwife_b" }); var work = Work(washes ? pump! : "home", washes ? "post" : "inside");
                    if (washes) { var pp = At(All(pump!)); var point = g.RoomNear(pp.x, pp.z, .45, 2.5) ?? pp; work["at"] = new JsonArray(point.x, point.z, 0); } else work["door"] = Pt(at.x, at.z);
                    var wife = Add(trade, kind, "f", womanAge, home, hh, widow ? "widow" : "wife", surname, work, new(), new());
                    MakeWifeSchedule(wife, washes, lanes, gossip, market, church, play);
                    int kids = Int(0, 2) + (Chance(.25) ? 1 : 0); string doorstep = play;
                    if (kids > 0) { var point = g.RoomNear(at.x + N(d["out"]?[0]) * 1.8, at.z + N(d["out"]?[1]) * 1.8, 1.2, 4); if (point != null) doorstep = Place("play:bkh" + hh, "the street before their door", point.Value.x, point.Value.z, 5); }
                    for (int c = 0; c < kids; c++) {
                        int age = Int(4, 13); string sex = Chance(.5) ? "m" : "f", childKind = age < 6 && Chance(.5) ? sex == "m" ? "boy" : "girl" : sex == "m" ? Pick(new[] { "boy", "urchin" }) : Pick(new[] { "girl", "girl_b" });
                        var day = new JsonArray(Seg(J(8), J(10), "play", doorstep), Seg(J(10), 12, "play", play), Seg(J(12.75), J(15), "play", play), Seg(J(15), J(18.5), "play", doorstep)); var sunday = new JsonArray();
                        if (Chance(.5)) sunday.Add(Seg(J(8.75), J(10), "church", church)); sunday.Add(Seg(J(10.5), J(12.25), "play", doorstep)); sunday.Add(Seg(J(13.25), J(15.5), "play", play)); sunday.Add(Seg(J(15.5), J(18.25), "play", doorstep));
                        Add("child", childKind, sex, age, home, hh, sex == "m" ? "son" : "daughter", surname, Work(play, "roam"), day, sunday);
                    }
                    if (corner != null && Chance(.65)) MakeLad(home, hh, surname, corner, lanes);
                    if (Chance(.55)) MakeOld(home, d, hh, surname, lanes, cards, tavern, church, gossip);
                }
            }
        }
        private void MakeDrinker(Hub h, JsonObject home, int hh, string surname, int age, string tavern)
        {
            var at = Step(home); var points = new List<(double x, double z)>(); for (int t = 0; t < 5; t++) { var point = g.RoomNear(h.X - 40 + rng() * 80, h.Z - 40 + rng() * 80, .9, 10); if (point != null) points.Add(point.Value); }
            var route = points.Count >= 2 ? points : new() { at, at }; string id = Place("drunk:" + hh, "the back streets", route[0].x, route[0].z, 30); string kind = Pick(new[] { "docker_a", "docker_b", "docker_c" }); var work = Work(id, "roam"); work["route"] = Route(route);
            var man = Add("drunkard", kind, "m", age, home, hh, "head", surname, work,
                new(Seg(J(10.5), J(13), "tavern", tavern), Seg(13, J(15), "work"), Seg(J(15), J(21.5), "tavern", tavern), Seg(J(21.75), J(24.5), "work")),
                new(Seg(J(11), J(14), "tavern", tavern), Seg(14, J(16), "work"), Seg(J(16), J(22), "tavern", tavern), Seg(J(22.25), J(24.75), "work"))); MinStat(man, "piety", 2); MaxStat(man, "temper", 5);
        }
        private void MakeLabourer(JsonObject home, int hh, string surname, int age, string[] quays, string? lanes, string? tavern, string? cards, List<string> knots, string church)
        {
            string quay = Pick(quays); var hauls = A(p.Facts["HAULS"]![quay]); var haul = hauls[(int)Math.Floor(rng() * hauls.Count)]!; string trade = Chance(.7) ? "docker" : "porter"; bool drinker = Chance(.55); string? knot = Chance(.45) ? WithRoom(knots, Step(home), 5, 120) : null; Join(knot); string? sunCards = cards != null && counts.GetValueOrDefault(cards) < 5 ? cards : null; Join(sunCards);
            string kind = trade == "porter" ? "porter" : Pick(new[] { "docker_a", "docker_b", "docker_c" }); var work = Work(quay, trade == "docker" ? "haul" : "roam"); if (trade == "docker") { work["a"] = haul["a"]!.DeepClone(); work["b"] = haul["b"]!.DeepClone(); } else work["route"] = new JsonArray(haul["a"]!.DeepClone(), haul["b"]!.DeepClone());
            var day = new JsonArray(); if (knot != null) {
                day.Add(Seg(J(5.5, .2), J(6.75), "work")); day.Add(Seg(J(8), J(10.5), "loiter", knot)); if (lanes != null) day.Add(Seg(J(10.5), J(11.5), "stroll", lanes)); if (tavern != null) day.Add(Seg(J(11.5), J(12.25), "tavern", tavern)); day.Add(Seg(J(12.25), J(13), "home")); day.Add(Seg(J(13), J(16), "loiter", knot)); if (cards != null) day.Add(Seg(J(16), J(18), "loiter", cards)); if (tavern != null) day.Add(Seg(J(18.5), J(22, .5), "tavern", tavern));
            } else { day.Add(Seg(J(6, .2), J(12), "work")); day.Add(Seg(J(12), J(12.75), "home")); day.Add(Seg(J(12.75), J(18.25), "work")); if (drinker && tavern != null) day.Add(Seg(J(19), J(22, .5), "tavern", tavern)); }
            var sunday = new JsonArray(); if (Chance(.4)) sunday.Add(Seg(J(8.75), J(10), "church", church)); if (sunCards != null) sunday.Add(Seg(J(14.5), J(18), "loiter", sunCards)); if (drinker && tavern != null) sunday.Add(Seg(J(18.5), J(22), "tavern", tavern));
            Add(trade, kind, "m", age, home, hh, "head", surname, work, day, sunday);
        }
        private void MakeWifeSchedule(JsonObject wife, bool washes, string? lanes, string gossip, string market, string church, string play)
        {
            var day = new JsonArray(); if (washes) { day.Add(Seg(J(7), J(11.75), "work")); day.Add(Seg(J(11.75), J(12.75), "home")); day.Add(Seg(J(12.75), J(16.25), "work")); day.Add(Seg(J(16.5), J(17.75), "loiter", gossip)); day.Add(Seg(J(17.75), J(18.5), "market", market)); }
            else { if (lanes != null && Chance(.5)) day.Add(Seg(J(8.5), J(9.75), "stroll", lanes)); else day.Add(Seg(J(8.5), J(9.75), "market", market)); day.Add(Seg(J(10.25), J(11.75), "loiter", gossip)); if (lanes != null) day.Add(Seg(J(13.5), J(14.75), "stroll", lanes)); day.Add(Seg(J(15), J(16.25), "loiter", gossip)); day.Add(Seg(J(16.5), J(17.75), "stroll", Chance(.5) ? "park" : play)); }
            var sunday = new JsonArray(); ChurchOf(sunday, wife, 8.75, 10, church); sunday.Add(Seg(J(10.5), J(13.25), "loiter", gossip)); sunday.Add(Seg(J(15), J(17.25), "stroll", Chance(.5) ? "park" : "walk")); wife["sched"] = new JsonObject { ["day"] = NativeTownPopulation.Tidy(day), ["sunday"] = NativeTownPopulation.Tidy(sunday) };
        }
        private void MakeLad(JsonObject home, int hh, string surname, string corner, string? lanes)
        {
            Join(corner); int age = Int(16, 21); string kind = Pick(new[] { "docker_a", "docker_c", "docker_c", "thief" }); var work = Work(corner, "roam"); work["route"] = new JsonArray(Pt(N(All(corner)["x"]), N(All(corner)["z"])));
            var day = new JsonArray(Seg(J(10), J(12.5), "loiter", corner), Seg(J(12.5), J(13.5), "home")); if (lanes != null) day.Add(Seg(J(13.5), J(15), "stroll", lanes)); day.Add(Seg(J(15), J(18.75), "loiter", corner)); day.Add(Seg(J(19.25), J(23.5, .5), "loiter", corner));
            var lad = Add("loafer", kind, "m", age, home, hh, "son", surname, work, day, new(Seg(J(11), J(14), "loiter", corner), Seg(J(14.75), J(23.5, .5), "loiter", corner))); MaxStat(lad, "courage", 6);
        }
        private void MakeOld(JsonObject home, JsonObject d, int hh, string surname, string? lanes, string? cards, string? tavern, string church, string gossip)
        {
            int age = Int(60, 79); if (Chance(.6)) {
                Join(cards); var at = Step(home); string step = Place("step:" + hh, "a chair by the door", at.x, at.z, 1.5, new() { ["door"] = Pt(at.x, at.z), ["out"] = d["out"]!.DeepClone() }); string kind = Pick(new[] { "ragman", "beggar", "docker_b" });
                var day = new JsonArray(Seg(J(8.5), J(11), "loiter", step)); if (lanes != null) day.Add(Seg(J(11), J(11.75), "stroll", lanes)); day.Add(Seg(J(12.75), J(14), "loiter", step)); day.Add(cards != null ? Seg(J(14), J(18), "loiter", cards) : Seg(J(14), J(17.5), "loiter", step)); if (tavern != null && Chance(.5)) day.Add(Seg(J(19), J(21), "tavern", tavern));
                var sunday = new JsonArray(); if (Chance(.6)) sunday.Add(Seg(J(8.75), J(10), "church", church)); sunday.Add(Seg(J(10.5), J(13.75), "loiter", step)); if (cards != null) sunday.Add(Seg(J(14), J(18), "loiter", cards)); var pa = Add("retired", kind, "m", age, home, hh, "father", surname, Work(step, "roam"), day, sunday); MaxStat(pa, "gossip", 5);
            } else {
                Join(gossip); var work = Work("home", "inside"); var at = Step(home); work["door"] = Pt(at.x, at.z); var day = new JsonArray(Seg(J(10.5), J(11.75), "loiter", gossip)); if (lanes != null) day.Add(Seg(J(14), J(15.25), "stroll", lanes)); day.Add(Seg(J(16.25), J(17.5), "loiter", gossip)); Add("retired", "old_woman", "f", age, home, hh, "mother", surname, work, day, new(Seg(J(8.75), J(10), "church", church), Seg(J(10.5), J(13.25), "loiter", gossip)));
            }
        }
    }
}

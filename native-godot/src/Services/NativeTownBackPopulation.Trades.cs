using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownBackPopulation
{
    private sealed partial class Builder
    {
        private (List<(double x, double z)> route, List<double> faces) RoundOf((double x, double z) at, int number, double reach)
        {
            var route = new List<(double x, double z)>(); var faces = new List<double>(); var candidates = backDoors.Where(d => D(Step(d), at) < reach).OrderBy(d => N(d["house"])).ToArray();
            for (int t = 0; t < number * 4 && route.Count < number && candidates.Length > 0; t++) {
                var d = Pick(candidates); int side = Chance(.5) ? 1 : -1; double outX = N(d["out"]?[0]), outZ = N(d["out"]?[1]); double x = NativeTownBackGeometry.R1(N(d["sx"]) + outX * .6 - outZ * side * 1.3), z = NativeTownBackGeometry.R1(N(d["sz"]) + outZ * .6 + outX * side * 1.3);
                if (!g.Standable(x, z, .4) || route.Any(q => D(q, (x, z)) < 12)) continue; route.Add((x, z)); faces.Add(R(Math.Atan2(N(d["x"]) - x, N(d["z"]) - z) * 1000) / 1000);
            }
            var order = new List<int>(); var left = Enumerable.Range(0, route.Count).ToList(); var current = at;
            while (left.Count > 0) { int best = 0; for (int q = 1; q < left.Count; q++) if (D(route[left[q]], current) < D(route[left[best]], current)) best = q; int i = left[best]; left.RemoveAt(best); order.Add(i); current = route[i]; }
            return (order.Select(i => route[i]).ToList(), order.Select(i => faces[i]).ToList());
        }
        private static JsonObject RoundWork(string id, string kind, List<(double x, double z)> route, List<double>? faces = null) { var work = Work(id, kind); work["route"] = Route(route); if (faces != null) work["faces"] = new JsonArray(faces.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()); return work; }
        private void MakeTrades()
        {
            foreach (var church in ChurchFacts.Take(2)) {
                if (!churches.TryGetValue(church.id, out var cp)) continue; var door = All(cp.id); var at = At(door); var d = FreeDoor(at.x, at.z, 50, q => !Alley(q)) ?? FreeDoor(at.x, at.z, 90); if (d == null) continue;
                var round = RoundOf(at, 7, 110); var first = round.route.Count > 0 ? round.route[0] : at; string id = Place("visits:" + church.id, "the sick of the parish of " + church.label, first.x, first.z, 110);
                int age = Int(42, 68), hh = ++household; string surname = Surname(); var priest = Add("parish_priest", "priest", "m", age, Home(d), hh, "single", surname, RoundWork(id, "round", round.route, round.faces),
                    new(Seg(J(7, 0), J(8.25), "church", cp.id), Seg(J(9.5), 12, "work"), Seg(J(14.5), J(16.75), "work"), Seg(J(17, 0), J(18, 0), "church", cp.id)),
                    new(Seg(6.5, 12.5, "church", cp.id), Seg(J(15, 0), J(16.5, 0), "church", cp.id))); MaxStat(priest, "piety", 8); priest["name"] = "Father " + S(priest, "surname");
            }
            var used = new HashSet<int>(); var usedStops = residents.Where(r => S(r["work"], "kind") == "round").SelectMany(r => A(r["work"]?["route"])).Select(q => (x: N(q?[0]), z: N(q?[1]))).ToList();
            var sellers = new[] { (key: "grinder", trade: "grinder", kind: "grinder", at: (x: 70.0, z: 262.0), label: "the lanes toward the Sint-Pauluskerk", room: .5), (key: "ragman", trade: "ragman", kind: "ragman", at: (x: -255.0, z: 290.0), label: "the lanes by the Stadspark", room: 1.1) };
            foreach (var seller in sellers) {
                var d = FreeDoor(seller.at.x, seller.at.z, 90, Alley) ?? FreeDoor(seller.at.x, seller.at.z, 140); if (d == null) continue;
                var round = rounds.Build(seller.at, 95, 9, Step(d), rng, used, seller.room, usedStops); if (round.Route.Count < 3) continue; used.UnionWith(round.Houses); usedStops.AddRange(round.Route); string id = Place("visits:" + seller.key, seller.label, round.Route[0].x, round.Route[0].z, 95); string? tavern = TavernNear(Step(d));
                int age = Int(38, 68), hh = ++household; string surname = Surname(); var day = new JsonArray(Seg(J(8.75), 12, "work"), Seg(J(13.25), J(16.75), "work")); if (tavern != null) day.Add(Seg(J(18.5), J(21), "tavern", tavern)); var sunday = new JsonArray(); if (tavern != null) sunday.Add(Seg(J(15), J(19), "tavern", tavern));
                var r = Add(seller.trade, seller.kind, "m", age, Home(d), hh, "head", surname, RoundWork(id, "round", round.Route, round.Faces), day, sunday); MaxStat(r, "gossip", 5);
            }
            var doctorDoor = FreeDoor(-40, 250, 120, q => !Alley(q) && N(q["storeys"]) >= 3);
            if (doctorDoor != null) {
                var at = Step(doctorDoor); var round = RoundOf(at, 8, 170); var first = round.route.Count > 0 ? round.route[0] : at; string id = Place("visits:doctor", "his patients in the back streets", first.x, first.z, 170); int age = Int(40, 62), hh = ++household; string surname = Surname();
                var doc = Add("doctor", "gentleman", "m", age, Home(doctorDoor), hh, "head", surname, RoundWork(id, "round", round.route, round.faces), new(Seg(J(9), 12, "work"), Seg(J(14), J(17), "work")), new(Seg(J(8.75), J(10.25), "church", NearestChurch(at)), Seg(J(15), J(16.5), "work"))); doc["name"] = "Doctor " + S(doc, "surname");
            }
            foreach (var church in ChurchFacts) {
                if (!churches.TryGetValue(church.id, out var cp)) continue; var door = At(All(cp.id)); var at = g.RoomNear(door.x + Math.Cos(cp.face) * 2.6, door.z - Math.Sin(cp.face) * 2.6, .5, 3); if (at == null) continue;
                var d = FreeDoor(door.x, door.z, 160, Alley) ?? FreeDoor(door.x, door.z, 200); if (d == null) continue; bool female = Chance(.5); int age = Int(46, 78), hh = ++household; string surname = Surname(); var work = Work(cp.id, "beg"); work["at"] = new JsonArray(at.Value.x, at.Value.z, cp.face + Math.PI);
                Add("beggar", female ? "old_woman" : "beggar", female ? "f" : "m", age, Home(d), hh, female ? "widow" : "single", surname, work, new(Seg(J(7.5), 12, "work"), Seg(J(12.75), J(18.5), "work")), new(Seg(6.5, 13, "work"), Seg(14, J(18), "work")));
            }
            int number = Math.Max(2, (int)R(3 * scale)); var corners = hubs.Where(h => h.Corner != null).Select(h => At(All(h.Corner!))).OrderBy(q => q.x).ToArray();
            for (int w = 0; w < number && corners.Length >= 3; w++) {
                var band = corners.Where((_, i) => Math.Floor(i / (double)corners.Length * number) == w).ToArray(); if (band.Length < 2) continue; var d = FreeDoor(band[0].x, band[0].z, 80, Alley) ?? FreeDoor(band[0].x, band[0].z, 140); if (d == null) continue;
                var route = band.Select(q => g.RoomNear(q.x + 2.5, q.z + 2.5, .5, 4) ?? q).ToList(); string id = Place("watch:" + w, "the night round of the back streets", route[0].x, route[0].z, 80); string kind = Pick(new[] { "docker_b", "docker_c" }); int age = Int(40, 64), hh = ++household; string surname = Surname();
                Add("watchman", kind, "m", age, Home(d), hh, "head", surname, RoundWork(id, "patrol", route), new(Seg(21, 29, "work")), new(Seg(21, 29, "work")));
            }
        }
    }
}

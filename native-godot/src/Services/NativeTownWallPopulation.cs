using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Rampart garrison, demolition workers, dog walker, lovers and kite children on native elevated support.</summary>
public sealed class NativeTownWallPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownWallPopulation(NativeTownPopulation population) => this.population = population;
    public int Ensure(uint seed) => Install(population, "wf", () => Generate(seed, population.Snapshot()));
    public JsonObject Generate(uint seed, JsonObject town)
    {
        var output = new JsonArray(); var outPlaces = new JsonObject(); var wall = population.City["decor"]?["rampart"]; if (wall == null) return new() { ["residents"] = output, ["places"] = outPlaces };
        var k = new NativeTownRoleSeed(population, seed ^ 0x0a11f01c, "wall", town); int next = 0; double thickness = N(wall["t"]); var tops = A(wall["tops"]);
        JsonNode? Segment(string name) => A(wall["segments"]).FirstOrDefault(q => S(q, "name") == name);
        (double x, double z)? At(string name, double along, double offset) { var segment = Segment(name); if (segment == null) return null; double off = thickness - offset; return (N(segment["o"]?[0]) + N(segment["t"]?[0]) * along - N(segment["n"]?[0]) * off, N(segment["o"]?[1]) + N(segment["t"]?[1]) * along - N(segment["n"]?[1]) * off); }
        double FieldYaw(string name) { var segment = Segment(name)!; return Math.Atan2(N(segment["n"]?[0]), N(segment["n"]?[1])); }
        bool InTop(double x, double z) => tops.Any(ring => {
            var points = A(ring); bool inside = false; for (int i = 0, j = points.Count - 1; i < points.Count; j = i++) { double xi = N(points[i]?[0]), zi = N(points[i]?[1]), xj = N(points[j]?[0]), zj = N(points[j]?[1]); if ((zi > z) != (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; } return inside;
        });
        (double x, double z)? OnWalk(string name, double along, double offset) {
            foreach (double d in new[] { 0, .3, -.3, .6, -.6, 1, -1, 1.5 }) { var point = At(name, along, offset + d); if (point == null) return null; double x = NativeTownBackGeometry.R1(point.Value.x), z = NativeTownBackGeometry.R1(point.Value.z); if (InTop(x, z) && population.Flags(x, z) == 0 && population.Reachable(x, z) && population.Open(x, z, .35)) return (x, z); } return null;
        }
        string? TavernNear(double x, double z) => k.Places.Where(q => q.Key.StartsWith("tavern:", StringComparison.Ordinal)).OrderBy(q => NativeTownBackGeometry.D(N(q.Value?["x"]), N(q.Value?["z"]), x, z)).Select(q => q.Key).FirstOrDefault();
        JsonObject Add(string trade, string kind, int age, JsonObject home, JsonObject work, JsonArray day, JsonArray sunday, string sex = "m", int? hh = null, string role = "single", string? surname = null) {
            var name = k.Name(() => next.ToString(), surname, sex == "m" ? "FIRST_M" : "FIRST_F"); string id = "wf" + (++next).ToString("D2"); int household = hh ?? ++k.Household; var person = k.Person(id, trade, kind, sex, age, home, household, role, name, work, day, sunday); if (!k.Have.Contains(id)) output.Add(person); return person;
        }
        void There(string id, string label, (double x, double z) at, double radius, JsonObject? extra = null) { if (k.Places[id] != null) return; var place = new JsonObject { ["label"] = label, ["x"] = at.x, ["z"] = at.z, ["r"] = radius, ["district"] = "town" }; if (extra != null) foreach (var pair in extra) place[pair.Key] = pair.Value?.DeepClone(); outPlaces[id] = place; }
        List<(double x, double z)> Points((string name, double s, double o)[] points) => points.Select(p => OnWalk(p.name, p.s, p.o)).Where(p => p != null).Select(p => p!.Value).ToList();
        var barracks = k.Places["barracks"]; JsonObject? soldierHome = barracks == null ? null : new() { ["house"] = -1, ["x"] = N(barracks["x"]), ["z"] = N(barracks["z"]), ["sx"] = N(barracks["x"]), ["sz"] = N(barracks["z"]) };
        var rounds = new[] {
            (id: "wall:round_day", points: new[] { ("seg4", 72.0, 3.4), ("seg4", 110.0, 3.6), ("seg4", 150.0, 3.4), ("seg5", 12.0, 3.5), ("seg5", 45.0, 3.6), ("seg5", 70.0, 3.4) }, day: new JsonArray(Seg(k.J(7.75), 12, "work"), Seg(13, k.J(17.75), "work"))),
            (id: "wall:round_eve", points: new[] { ("seg5", 100.0, 3.4), ("seg5", 140.0, 2.6), ("seg5", 175.0, 3.5), ("seg6", 30.0, 3.4), ("seg6", 80.0, 3.5), ("seg7", 20.0, 3.4), ("seg7", 60.0, 3.2) }, day: new JsonArray(Seg(k.J(17.75), 23.5, "work")))
        };
        if (soldierHome != null) foreach (var rd in rounds) {
            var points = Points(rd.points); if (points.Count < 3) continue; var loop = points.Concat(points.Skip(1).Take(points.Count - 2).Reverse()).ToArray(); There(rd.id, "the round of the ramparts", points[points.Count / 2], 30); int hh = ++k.Household; var pair = new List<JsonObject>();
            for (int i = 0; i < 2; i++) pair.Add(Add("soldier", "sentry", k.Int(20, 27), soldierHome, new() { ["place"] = rd.id, ["kind"] = "roam", ["route"] = Route(loop), ["door"] = new JsonArray(N(soldierHome["sx"]), N(soldierHome["sz"])) }, rd.day.DeepClone().AsArray(), rd.day.DeepClone().AsArray(), hh: hh));
            pair[0]["mate"] = S(pair[1], "id"); pair[1]["mate"] = S(pair[0], "id");
        }
        if (soldierHome != null) foreach (var box in A(k.Facts["BOXES"])) {
            string segment = S(box, "seg"); if (Segment(segment) == null) continue; var point = OnWalk(segment, N(box?["s"]), thickness - .65 - .5 - .85); if (point == null) continue; string id = S(box, "id"); There(id, S(box, "label"), point.Value, 3); double yaw = Round((FieldYaw(segment) + Math.PI) * 100) / 100; int hh = ++k.Household;
            var shifts = new[] { new JsonArray(Seg(5.75, 10, "work"), Seg(13.75, 18, "work"), Seg(21.75, 26, "work")), new JsonArray(Seg(1.75, 6, "work"), Seg(9.75, 14, "work"), Seg(17.75, 22, "work")) }; var pair = new List<JsonObject>();
            foreach (var shift in shifts) pair.Add(Add("sentry", "sentry", k.Int(20, 26), soldierHome, new() { ["place"] = id, ["kind"] = "guard", ["at"] = new JsonArray(point.Value.x, point.Value.z, yaw), ["door"] = new JsonArray(N(soldierHome["sx"]), N(soldierHome["sz"])) }, shift.DeepClone().AsArray(), shift.DeepClone().AsArray(), hh: hh)); pair[0]["mate"] = S(pair[1], "id"); pair[1]["mate"] = S(pair[0], "id");
        }
        {
            var works = k.Facts["WORKS"]!; string segment = S(works, "seg"); double s0 = N(works["s0"]), s1 = N(works["s1"]); var seg = Segment(segment);
            var heap = OnWalk(segment, s0 + 2.5, thickness - .65 - 1.25); var heap2 = OnWalk(segment, s1 - 2.5, thickness - .65 - 1.25); var stack = OnWalk(segment, s0 - 2.3, 1.75); var stack2 = OnWalk(segment, s1 + 2.2, 1.75); var winch = OnWalk(segment, (s0 + s1) / 2 + .6, thickness - .65 - 1); var sorter = OnWalk(segment, s0 - 3.2, 2.1); var boss = OnWalk(segment, s0 - 5.6, 2.2);
            if (seg != null && heap != null && heap2 != null && stack != null && stack2 != null && winch != null && sorter != null && boss != null) {
                var mid = At(segment, (s0 + s1) / 2, 3.5)!.Value; There("wall:works", "the town's works on the ramparts, where the old wall comes down", (NativeTownBackGeometry.R1(mid.x), NativeTownBackGeometry.R1(mid.z)), 12); double field = FieldYaw(segment), along = Math.Atan2(N(seg["t"]?[0]), N(seg["t"]?[1])); string? tavern = TavernNear(stack.Value.x, stack.Value.z);
                JsonArray Week(double from, double to, bool evening) { var day = new JsonArray(Seg(k.J(from, 0), 12, "work"), Seg(13, k.J(to, 0), "work")); if (evening && tavern != null) day.Add(Seg(k.J(18.5), k.J(21), "tavern", tavern)); return day; }
                JsonArray Sunday(bool pious) { var day = new JsonArray(); if (pious) day.Add(Seg(8.75, 11, "church", "church")); if (tavern != null) day.Add(Seg(k.J(15), k.J(18.5), "tavern", tavern)); return day; }
                JsonObject AtHome((double x, double z) point) => Home(k.DoorNear(point.x - 40 + k.Rng() * 80, point.z - 60 + k.Rng() * 80, 260));
                Add("works_foreman", "foreman", k.Int(40, 55), AtHome(boss.Value), new() { ["place"] = "wall:works", ["kind"] = "post", ["at"] = new JsonArray(boss.Value.x, boss.Value.z, Round((field - .4) * 100) / 100) }, Week(6.75, 17.75, false), Sunday(true), role: "head");
                Add("navvy", "docker_a", k.Int(19, 40), AtHome(heap.Value), new() { ["place"] = "wall:works", ["kind"] = "haul", ["a"] = new JsonArray(heap.Value.x, heap.Value.z), ["b"] = new JsonArray(stack.Value.x, stack.Value.z) }, Week(7, 17.5, true), Sunday(k.Rng() < .4));
                Add("navvy", "docker_c", k.Int(19, 40), AtHome(heap2.Value), new() { ["place"] = "wall:works", ["kind"] = "haul", ["a"] = new JsonArray(heap2.Value.x, heap2.Value.z), ["b"] = new JsonArray(stack2.Value.x, stack2.Value.z) }, Week(7, 17.5, true), Sunday(k.Rng() < .4));
                Add("navvy", "docker_b", k.Int(25, 50), AtHome(winch.Value), new() { ["place"] = "wall:works", ["kind"] = "post", ["at"] = new JsonArray(winch.Value.x, winch.Value.z, Round((field + Math.PI) * 100) / 100), ["motion"] = "pull" }, Week(7, 17.5, false), Sunday(k.Rng() < .5));
                Add("navvy", "docker_a", k.Int(16, 60), AtHome(sorter.Value), new() { ["place"] = "wall:works", ["kind"] = "post", ["at"] = new JsonArray(sorter.Value.x, sorter.Value.z, Round(along * 100) / 100), ["motion"] = "crouch" }, Week(7, 17.5, true), Sunday(k.Rng() < .5));
            }
        }
        {
            var point = OnWalk("seg6", 60, 3.4) ?? (-300, 330); var r = Add("retired", "old_man", k.Int(62, 74), Home(k.DoorNear(point.Item1 + 30, point.Item2 - 40, 260)), new() { ["place"] = "home", ["kind"] = "roam", ["route"] = new JsonArray() }, new(Seg(k.J(9.5), k.J(10.75), "stroll", "walk"), Seg(k.J(15.25), k.J(16.5), "stroll", "walk")), new(Seg(8.75, 11, "church", "church"), Seg(k.J(14.75), k.J(16.25), "stroll", "walk")), role: "head"); r["dog"] = new JsonObject { ["name"] = k.Pick(A(k.Facts["DOGS"])), ["look"] = k.Pick(new JsonArray("dog_brown", "dog_black", "dog_spotted", "dog_grey")) };
        }
        {
            var point = OnWalk("seg6", 44, thickness - .65 - .45); if (point != null) {
                var seg = Segment("seg6")!; There("lovers:wall", "a quiet corner of the ramparts, looking out over the fields", point.Value, 2, new() { ["out"] = new JsonArray(Round(N(seg["n"]?[0]) * 1000) / 1000, Round(N(seg["n"]?[1]) * 1000) / 1000) });
                var day = new JsonArray(Seg(k.J(18, 0), 19, "stroll", "walk"), Seg(19, k.J(20.25), "loiter", "lovers:wall")); var sunday = new JsonArray(Seg(k.J(15, 0), 16.5, "stroll", "walk"), Seg(16.5, k.J(17.5), "loiter", "lovers:wall"));
                JsonArray WorkingDay() => new(new[] { Seg(8, 12, "work"), Seg(13, 17.5, "work") }.Concat(day.Select(q => q!.DeepClone().AsArray())).Select(q => (JsonNode)q).ToArray()); JsonArray SundayDay() => new(new[] { Seg(8.75, 11, "church", "church") }.Concat(sunday.Select(q => q!.DeepClone().AsArray())).Select(q => (JsonNode)q).ToArray());
                var lad = Add("clerk", "clerk", k.Int(19, 24), Home(k.DoorNear(point.Value.x + 40, point.Value.z - 60, 260)), new() { ["place"] = "home", ["kind"] = "inside" }, WorkingDay(), SundayDay());
                var girl = Add("seamstress", "girl_b", k.Int(18, 22), Home(k.DoorNear(point.Value.x + 70, point.Value.z - 30, 260)), new() { ["place"] = "home", ["kind"] = "inside" }, WorkingDay(), SundayDay(), "f"); lad["work"]!["door"] = new JsonArray(N(lad["home"]?["sx"]), N(lad["home"]?["sz"])); girl["work"]!["door"] = new JsonArray(N(girl["home"]?["sx"]), N(girl["home"]?["sz"])); lad["mate"] = S(girl, "id"); girl["mate"] = S(lad, "id");
            }
        }
        {
            var kite = k.Facts["KITE"]!; (double x, double z)? point = null; for (int i = 0; i < 24 && point == null; i++) { double angle = i * 2.4, distance = i * .25, x = NativeTownBackGeometry.R1(N(kite["x"]) + Math.Sin(angle) * distance), z = NativeTownBackGeometry.R1(N(kite["z"]) + Math.Cos(angle) * distance); if (InTop(x, z) && population.Flags(x, z) == 0 && population.Reachable(x, z) && population.Open(x, z, 1.2)) point = (x, z); }
            if (point != null) { There("kite:ne", "the lawn on the north-east bastion, where the children fly their kites", point.Value, 5); int hh = ++k.Household; var home = Home(k.DoorNear(point.Value.x - 40, point.Value.z - 50, 260)); var day = new JsonArray(Seg(k.J(15.75), k.J(17.25), "loiter", "kite:ne")); var sunday = new JsonArray(Seg(8.75, 11, "church", "church"), Seg(k.J(14), k.J(16.5), "loiter", "kite:ne"));
                var boy = Add("child", "boy", k.Int(9, 12), home, new() { ["place"] = "kite:ne", ["kind"] = "roam" }, day, sunday, hh: hh, role: "child"); Add("child", "girl", k.Int(7, 10), home, new() { ["place"] = "kite:ne", ["kind"] = "roam" }, day.DeepClone().AsArray(), sunday.DeepClone().AsArray(), "f", hh, "child", S(boy, "surname"));
            }
        }
        return new JsonObject { ["residents"] = output, ["places"] = outPlaces };
    }
}

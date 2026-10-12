using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownBackPopulation
{
    private sealed partial class Builder
    {
        private sealed class Hub { public string Key = ""; public double X, Z; public string? Pump, Corner, Cards, Play, Lanes; }
        private readonly List<Hub> hubs = new();
        private readonly List<(double x, double z)> groupPoints = new();
        private readonly List<string> lovers = new();
        private readonly Dictionary<string, (string id, double face)> churches = new();
        private readonly List<string> taverns = new();
        private static readonly (string id, string label)[] ChurchFacts = { ("stjacob", "Sint-Jacobskerk"), ("stpaul", "Sint-Pauluskerk"), ("carolus", "Sint-Carolus Borromeus") };
        private string NearestChurch((double x, double z) at) => churches.Count == 0 ? "church" : Nearest(churches.Values.Select(c => c.id), at);
        private string? TavernNear((double x, double z) at) => taverns.Count == 0 ? null : Nearest(taverns, at);
        private void MakePlaces()
        {
            int pi = 0; foreach (var pump in A(p.City["alleys"]?["pumps"])) {
                double x = N(pump?[0]), z = N(pump?[1]); int index = pi++; if (g.RoomNear(x, z, .45, 2.5) == null) continue;
                string id = Place("pump:" + index, "the pump in the court", x, z, 3); hubs.Add(new() { Key = "p" + index, X = x, Z = z, Pump = id });
            }
            int ci = 0; foreach (var corner in g.Corners()) {
                string id = Place("corner:" + ci, "a street corner in the back streets", corner.x, corner.z, 2.5, new() { ["out"] = Pt(Math.Sin(corner.wall), Math.Cos(corner.wall)) });
                var near = hubs.FirstOrDefault(h => h.Pump != null && h.Corner == null && D((h.X, h.Z), (corner.x, corner.z)) < 45);
                if (near != null) near.Corner = id; else hubs.Add(new() { Key = "c" + ci, X = corner.x, Z = corner.z, Corner = id }); ci++;
            }
            int si = 0; for (double x = -366; x <= 232; x += 30) for (double z = 150; z <= 356; z += 30) {
                var point = g.RoomNear(x, z, .8, 9); if (point == null || !NativeTownBackGeometry.InBack(point.Value.x, point.Value.z) || hubs.Any(h => D((h.X, h.Z), point.Value) < 26)) continue;
                if (backDoors.Count(d => D(Step(d), point.Value) < 25) < 4) continue; hubs.Add(new() { Key = "s" + si++, X = point.Value.x, Z = point.Value.z });
            }
            groupPoints.AddRange(hubs.Where(h => h.Pump != null).Select(h => (h.X, h.Z)));
            foreach (var h in hubs) {
                var cards = h.Key.StartsWith('s') ? null : g.RoomNear(h.X + 5, h.Z + 4, 1.5, 12, groupPoints, 5.5); if (cards != null) { groupPoints.Add(cards.Value); h.Cards = Place("cards:" + h.Key, "a game of cards on a doorstep", cards.Value.x, cards.Value.z, 1.5); }
                var play = h.Key.StartsWith('s') ? null : g.RoomNear(h.X - 3, h.Z - 5, 2.5, 14, groupPoints, 6); if (play != null) { groupPoints.Add(play.Value); h.Play = Place("play:bk" + h.Key, "a court where the children play", play.Value.x, play.Value.z, 7); }
                var middle = g.RoomNear(h.X, h.Z, .5, 4); var spokes = new List<(double x, double z)>();
                for (int i = 0; i < 12; i++) { double angle = i / 12.0 * Math.PI * 2, length = g.Run(h.X, h.Z, angle, 45); if (length < 10) continue;
                    var point = g.RoomNear(h.X + Math.Sin(angle) * length * .85, h.Z + Math.Cos(angle) * length * .85, .5, 3); if (point != null && !spokes.Any(q => D(q, point.Value) < 9)) spokes.Add(point.Value); }
                if (middle != null && spokes.Count >= 2) h.Lanes = Place("lanes:" + h.Key, "the lanes round about", middle.Value.x, middle.Value.z, 45, new() { ["route"] = Route(spokes.SelectMany(q => new[] { q, middle.Value })) });
            }
            var park = p.City["decor"]?["park"]; var outline = A(park?["outline"]); (double x, double z) centre = outline.Count > 0 ? (outline.Sum(q => N(q?[0]) / outline.Count), outline.Sum(q => N(q?[1]) / outline.Count)) : (-300, 312);
            var at = g.RoomNear(centre.x, centre.z - 14, .8, 16) ?? centre; var parkRoute = new List<(double x, double z)>(); var lines = A(park?["lines"]);
            var paths = lines.Count > 0 ? lines.Select(l => A(l?["pts"])) : A(park?["paths"]).Select(path => A(path));
            foreach (var path in paths) foreach (var point in path) { var q = (x: N(point?[0]), z: N(point?[1])); if (parkRoute.Count > 0 && D(parkRoute[^1], q) < 6) continue; if (g.Standable(q.x, q.z, .5)) parkRoute.Add((NativeTownBackGeometry.R1(q.x), NativeTownBackGeometry.R1(q.z))); }
            Place("park", "the Stadspark", at.x, at.z, 26, parkRoute.Count >= 4 ? new() { ["route"] = Route(parkRoute) } : null);
            var walk = g.WallWalk(); var mid = walk.Count > 0 ? walk[walk.Count / 2] : (-60, 352); Place("walk", "the walk on the ramparts", mid.Item1, mid.Item2, 40, walk.Count >= 4 ? new() { ["route"] = Route(walk) } : null);
            int pondIndex = 0; foreach (var pond in A(park?["ponds"])) {
                double px = N(pond?[0]), pz = N(pond?[1]), radius = N(pond?[2]); foreach (double angle in new[] { Math.PI, Math.PI * .5, Math.PI * 1.5, 0 }) {
                    var q = g.RoomNear(px + Math.Sin(angle) * (radius + 2), pz + Math.Cos(angle) * (radius + 2), .8, 4); if (q == null) continue;
                    lovers.Add(Place("lovers:" + pondIndex, "the edge of the pond in the Stadspark", q.Value.x, q.Value.z, 1.5, new() { ["out"] = Pt(px - q.Value.x, pz - q.Value.z) })); break;
                } pondIndex++;
            }
            foreach (var church in ChurchFacts) { var door = g.ChurchDoor(church.id); if (door != null) churches[church.id] = (Place("church:" + church.id, "the door of the " + church.label, door.Value.x, door.Value.z, 4), door.Value.face); }
        }
        private void MakeTaverns()
        {
            var sites = hubs.Where(h => h.Corner != null).OrderBy(h => h.X).ToArray(); var labels = A(names["KROEGEN"]);
            for (int i = 0; i < labels.Count && sites.Length > 0; i++) {
                var h = sites[(int)Math.Floor((i + .5) / labels.Count * sites.Length)]; var d = FreeDoor(h.X, h.Z, 30, q => !Alley(q) && g.Across(q) >= 5 && g.Standable(N(q["sx"]) + N(q["out"]?[0]) * 1.8, N(q["sz"]) + N(q["out"]?[1]) * 1.8, .6)); if (d == null) continue;
                string id = Place("kroeg:" + i, labels[i]!.GetValue<string>(), N(d["sx"]), N(d["sz"]), 4, new() { ["door"] = Pt(N(d["sx"]), N(d["sz"])), ["out"] = d["out"]!.DeepClone() }); taverns.Add(id);
                int hh = ++household; string surname = Surname(); int age = Int(34, 62); var work = Work(id, "tavern"); work["at"] = new JsonArray(NativeTownBackGeometry.R1(N(d["sx"]) + N(d["out"]?[0]) * .8), NativeTownBackGeometry.R1(N(d["sz"]) + N(d["out"]?[1]) * .8), R(Math.Atan2(N(d["out"]?[0]), N(d["out"]?[1])) * 1000) / 1000);
                var keeper = Add("publican", "publican", "m", age, Home(d), hh, "head", surname, work, new(Seg(J(10), 25, "work")), new(Seg(J(11.5), 25, "work"))); MaxStat(keeper, "gossip", 6);
                string kind = Pick(new[] { "wife_a", "wife_b" }); int wifeAge = Math.Max(24, age - Int(0, 8)); var inside = Work("home", "inside"); inside["door"] = Pt(N(d["sx"]), N(d["sz"]));
                Add("housewife", kind, "f", wifeAge, Home(d), hh, "wife", surname, inside, new(Seg(J(9), J(10.25), "market", Nearest(markets, Step(d)))), new(Seg(J(8.75), J(10), "church", NearestChurch(Step(d)))));
            }
        }
    }
}

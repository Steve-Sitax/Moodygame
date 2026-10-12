using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownBackPopulation
{
    private sealed partial class Builder
    {
        private void MakeBetter()
        {
            var middleDoors = doors.Where(d => !NativeTownBackGeometry.InBack(N(d["sx"]), N(d["sz"])) && N(d["sz"]) > 50).ToArray(); int number = (int)R(10 * scale); var better = backDoors.Where(d => !Alley(d) && N(d["storeys"]) >= 3 && g.Across(d) >= 7).OrderBy(d => N(d["house"])).ToArray();
            for (int i = 0; i < number && better.Length > 0; i++) {
                var candidate = Pick(better); var d = FreeDoor(N(candidate["sx"]), N(candidate["sz"]), 30, q => !Alley(q) && N(q["storeys"]) >= 3); if (d == null) continue;
                var home = Home(d); var hp = Step(home); int hh = ++household; string surname = Surname(); var office = Pick(middleDoors); string church = NearestChurch(hp), market = Nearest(markets, hp); int age = Int(30, 58); var work = Work("grote_markt", "inside"); work["door"] = Pt(N(office["sx"]), N(office["sz"]));
                var day = new JsonArray(Seg(J(7.75), J(12), "work"), Seg(J(12), J(13), "home"), Seg(J(13.25), J(18), "work")); if (Chance(.4)) day.Add(Seg(J(19.5), J(20.75), "stroll", "park"));
                Add("clerk", "clerk", "m", age, home, hh, "head", surname, work, day, new(Seg(J(8.75), J(10.25), "church", church), Seg(J(14.5), J(17), "stroll", Chance(.5) ? "walk" : "park")));
                string kind = Pick(new[] { "wife_a", "shopwife" }); int wifeAge = Math.Max(24, age - Int(0, 10)); var inside = Work("home", "inside"); inside["door"] = Pt(hp.x, hp.z);
                var wife = Add("housewife", kind, "f", wifeAge, home, hh, "wife", surname, inside, new(Seg(J(10), J(11.5), "market", market), Seg(J(15), J(16.75), "stroll", "park")), new(Seg(J(8.75), J(10.25), "church", church), Seg(J(14.5), J(17), "stroll", "walk"))); MaxStat(wife, "wealth", 3);
                int maidAge = Int(16, 30); string maidSurname = Surname(); Add("maid", "maid", "f", maidAge, home, hh, "servant", maidSurname, inside, new(Seg(J(6.5), 9, "work"), Seg(9, J(10.5), "market", market), Seg(10.5, J(19.5), "work")), new(Seg(J(7.25), J(8.5), "church", church), Seg(J(15), J(17.5), "stroll", "park")));
                int kids = Int(0, 2); for (int c = 0; c < kids; c++) { int childAge = Int(5, 12); string sex = Chance(.5) ? "m" : "f", childKind = sex == "m" ? "boy" : Pick(new[] { "girl", "girl_b" }); Add("child", childKind, sex, childAge, home, hh, sex == "m" ? "son" : "daughter", surname, Work("park", "roam"), new(Seg(J(14), J(17), "play", "park")), new(Seg(J(8.75), J(10.25), "church", church), Seg(J(14.5), J(17), "stroll", "walk"))); }
            }
        }
        private void MakeLovers()
        {
            var girls = output.Where(r => S(r, "sex") == "f" && N(r["age"]) >= 16 && N(r["age"]) <= 24 && S(r, "trade") is "maid" or "washerwoman" or "seamstress").ToArray();
            var boys = output.Where(r => S(r, "sex") == "m" && N(r["age"]) >= 17 && N(r["age"]) <= 26 && S(r, "trade") is not "drunkard" and not "loafer").ToArray(); var extra = boys.Length < lovers.Count ? output.Where(r => S(r, "trade") == "loafer").ToArray() : Array.Empty<JsonObject>();
            for (int i = 0; i < lovers.Count; i++) {
                var girl = i < girls.Length ? girls[i] : null; var boy = i < boys.Length ? boys[i] : i < extra.Length ? extra[i] : null; if (girl == null || boy == null || N(girl["household"]) == N(boy["household"])) continue;
                var evening = Seg(J(19.5), J(21.25), "loiter", lovers[i]); var sunday = Seg(J(15.5), J(17.5), "loiter", lovers[i]);
                foreach (var r in new[] { girl, boy }) {
                    JsonArray Replace(string key, JsonArray meeting) { var list = new JsonArray(A(r["sched"]?[key]).Where(s => N(s?[1]) <= N(meeting[0]) || N(s?[0]) >= N(meeting[1])).Select(s => s!.DeepClone()).ToArray()); list.Add(meeting.DeepClone()); return NativeTownPopulation.Tidy(list); }
                    r["sched"] = new JsonObject { ["day"] = Replace("day", evening), ["sunday"] = Replace("sunday", sunday) }; r["mate"] = S(ReferenceEquals(r, girl) ? boy : girl, "id");
                }
            }
        }
    }
}

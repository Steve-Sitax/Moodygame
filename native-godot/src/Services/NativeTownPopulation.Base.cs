using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownPopulation
{
    public JsonObject Generate(uint seed, string size = "normal") => new Builder(this, seed, size).Make();
    private sealed class Job { public readonly string Trade, Place; public Job(string trade, string place) => (Trade, Place) = (trade, place); }
    private sealed partial class Builder
    {
        private readonly NativeTownPopulation owner;
        private readonly uint seed;
        private readonly string size;
        private readonly double scale;
        private readonly int target;
        private Func<double> rng;
        private JsonObject Facts => owner.Facts;
        private readonly JsonObject places = new();
        private readonly List<JsonObject> residents = new(), shops = new(), stalls = new();
        private readonly Dictionary<string, JsonObject> shopDoors = new();
        private readonly HashSet<int> used, shopHouses = new();
        private readonly HashSet<string> usedNames = new();
        private readonly List<JsonObject> free;
        private readonly HashSet<string> femaleTrades = new() { "fishwife", "market_woman", "maid", "laundress", "seamstress", "housewife", "shopwife" };
        private readonly Dictionary<string, string> pendingPlace = new();
        private List<Job> pending = new();
        private readonly HashSet<Job> must = new();
        private string[] taverns = Array.Empty<string>();
        private int household, nextId = 1, stallNext;
        private List<(double x, double z)> lamps = new();
        public Builder(NativeTownPopulation owner, uint seed, string size)
        {
            this.owner = owner; this.seed = seed; this.size = size; rng = Random(seed); target = (int)N(Facts["TOWN_SIZES"]?[size]?["target"]); if (target == 0) target = 190; scale = size == "normal" ? 1 : target / 190.0;
            free = owner.Doors.ToList(); used = A(owner.Kept["houses"]).Select(h => (int)N(h?["house"])).ToHashSet();
        }
        private double Rnd(double a, double b) => a + rng() * (b - a);
        private int Int(int a, int b) => (int)Math.Floor(Rnd(a, b + 1));
        private T Pick<T>(IReadOnlyList<T> list) => list[(int)Math.Floor(rng() * list.Count)];
        private string PickName(string list) => Pick(A(Facts[list]).Select(p => p!.GetValue<string>()).ToArray());
        private bool Chance(double p) => rng() < p;
        private (double x, double z) Snap(double x, double z) => owner.Snap(x, z, 8) ?? (x, z);
        private static JsonArray Pt(double x, double z) => new(x, z);
        private static double Distance(double ax, double az, double bx, double bz) => Math.Sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
        private JsonObject? DoorNear(double x, double z, double max, int spread = 1)
        {
            int keptCount = A(owner.Kept["houses"]).Select(h => N(h?["house"])).Distinct().Count(); if (scale > 1 && free.Count - used.Count + keptCount <= 90) return null;
            var choices = free.Where(d => !used.Contains((int)N(d["house"]))).Select(d => (d, distance: Distance(N(d["sx"]), N(d["sz"]), x, z))).Where(p => p.distance <= max).OrderBy(p => p.distance).Take(spread).ToArray();
            if (choices.Length == 0) return null; var selected = Pick(choices).d; used.Add((int)N(selected["house"])); return selected;
        }
        private static JsonObject Home(JsonObject d) { var home = new JsonObject(); foreach (string key in new[] { "house", "x", "z", "sx", "sz" }) home[key] = d[key]!.DeepClone(); return home; }
        private JsonObject? ShareHouse(double x, double z)
        {
            var homes = new Dictionary<int, (JsonObject home, HashSet<int> households)>();
            foreach (var r in residents) { int h = (int)N(r["home"]?["house"]); if (h < 0 || shopHouses.Contains(h)) continue; if (!homes.TryGetValue(h, out var entry)) entry = (r["home"]!.AsObject(), new HashSet<int>()); entry.households.Add((int)N(r["household"])); homes[h] = entry; }
            return homes.Values.Where(h => h.households.Count < 3).OrderBy(h => Distance(N(h.home["sx"]), N(h.home["sz"]), x, z) + h.households.Count * 25).Select(h => h.home.DeepClone().AsObject()).FirstOrDefault();
        }
        private JsonObject Stats(string trade, int age, bool oldBonus = true)
        {
            var def = Facts["TRADES"]![trade]!; var stats = new JsonObject(); foreach (var keyNode in A(Facts["STATS"])) { string key = keyNode!.GetValue<string>(); double value = 5 + (rng() + rng() + rng() - 1.5) * 4 + N(def["bias"]?[key]); if (oldBonus && age >= 55 && key is "piety" or "gossip") value++; if (age < 25 && key == "courage") value++; if (oldBonus && age < 15 && key == "gossip") value -= 2; stats[key] = Math.Clamp((int)Math.Floor(value + .5), 0, 10); }
            stats["wealth"] = Int((int)N(def["wealth"]?[0]), (int)N(def["wealth"]?[1])); return stats;
        }
        private string Name(string sex, string surname)
        {
            for (int i = 0; i < 40; i++) { string first = PickName(sex == "m" ? "MEN" : "WOMEN"); if (A(Facts["TAKEN"]).Any(n => n!.GetValue<string>() == first)) continue; if (usedNames.Add(first + " " + surname)) return first; } return PickName(sex == "m" ? "MEN" : "WOMEN");
        }
        private string Surname()
        {
            for (int i = 0; i < 20; i++) { string name = PickName("SURNAMES"); if (!A(Facts["TAKEN"]).Any(n => n!.GetValue<string>() == name)) return name; } return PickName("SURNAMES");
        }
        private string Kind(string trade, string sex, int age)
        {
            if (age < 15) return sex == "m" ? trade == "street_child" ? "urchin" : "boy" : Pick(new[] { "girl", "girl_b" });
            if (sex == "f") return trade switch { "fishwife" => Pick(new[] { "fishwife_a", "fishwife_b" }), "maid" => "maid", "shopwife" or "fish_merchant" => "shopwife", "thief" => "wife_b", _ => age >= 60 ? "old_woman" : trade == "market_woman" ? Pick(new[] { "wife_a", "wife_b", "fishwife_b" }) : Pick(new[] { "wife_a", "wife_b" }) };
            return trade switch { "docker" or "natie" => Pick(new[] { "docker_a", "docker_b", "docker_c", "docker_sack" }), "porter" => "porter", "carter" => "carter", "boatman" or "sailor" => "sailor_b", "baker" => "baker", "grocer" or "chandler" or "tobacconist" or "cobbler" or "draper" => "shopkeeper", "pawnbroker" or "clerk" => "clerk", "publican" or "brewer" => "publican", "merchant" => "gentleman", "police" or "water_bailiff" => "police", "priest" => "priest", "sexton" or "retired" => "old_man", "foreman" => "foreman", "beggar" => "beggar", "thief" => "thief", "lamplighter" => "docker_c", _ => age >= 60 ? "old_man" : Pick(new[] { "docker_a", "docker_b", "docker_c" }) };
        }
        private JsonObject Add(string sex, int age, string trade, string role, string surname, JsonObject home, JsonObject work, int hh, string? id = null)
        {
            string first = Name(sex, surname); var person = new JsonObject { ["id"] = id ?? "r" + (nextId++).ToString("D3"), ["first"] = first, ["surname"] = surname, ["name"] = first + " " + surname, ["age"] = age, ["sex"] = sex, ["household"] = hh, ["family_role"] = role, ["trade"] = trade, ["faction"] = Facts["TRADES"]![trade]!["faction"]?.DeepClone(), ["kind"] = Kind(trade, sex, age), ["home"] = home.DeepClone(), ["work"] = work.DeepClone(), ["sched"] = new JsonObject { ["day"] = new JsonArray(), ["sunday"] = new JsonArray() }, ["stats"] = Stats(trade, age), ["dog"] = null }; residents.Add(person); return person;
        }
        private List<T> Shuffle<T>(List<T> list) { for (int i = list.Count - 1; i > 0; i--) { int j = (int)Math.Floor(rng() * (i + 1)); (list[i], list[j]) = (list[j], list[i]); } return list; }
        private JsonObject Work(string trade, string place, JsonObject home)
        {
            string kind = S(Facts["TRADES"]![trade], "work"); var result = new JsonObject { ["place"] = place, ["kind"] = kind }; var pl = places[place];
            if (kind == "haul") { var route = Pick(A(Facts["HAULS"]?[place] ?? Facts["HAULS"]?["rijnkaai"]).ToArray())!; var a = Snap(N(route["a"]?[0]), N(route["a"]?[1])); var b = Snap(N(route["b"]?[0]), N(route["b"]?[1])); result["a"] = Pt(a.x, a.z); result["b"] = Pt(b.x, b.z); }
            else if (kind == "patrol") result["route"] = place == "lamps" ? new JsonArray(lamps.Select(p => (JsonNode)Pt(p.x, p.z)).ToArray()) : new JsonArray(A(Facts["PATROLS"]?[place] ?? Facts["PATROLS"]?["quays"]).Select(p => { var s = Snap(N(p?[0]), N(p?[1])); return (JsonNode)Pt(s.x, s.z); }).ToArray());
            else if (kind == "roam") {
                if (trade == "thief") { var points = A(Facts["HAUNTS"]).Select(p => { var s = Snap(N(p?[0]), N(p?[1])); return Pt(s.x, s.z); }).ToList(); result["place"] = "night"; result["route"] = new JsonArray(Shuffle(points).Take(4).Cast<JsonNode>().ToArray()); }
                else { var c = pl ?? places["rijnkaai"]!; var points = new JsonArray(); for (int i = 0; i < 12 && points.Count < 4; i++) { double a = rng() * Math.PI * 2; var q = owner.Snap(N(c["x"]) + Math.Cos(a) * N(c["r"]) * .7, N(c["z"]) + Math.Sin(a) * N(c["r"]) * .7, 6); if (q != null) points.Add(Pt(q.Value.x, q.Value.z)); } if (points.Count == 0) points.Add(Pt(N(c["x"]), N(c["z"]))); result["place"] = places.ContainsKey(place) ? place : "rijnkaai"; result["route"] = points; }
            }
            else if (kind == "beg") { var c = pl ?? places["steenplein"]!; var p = Snap(N(c["x"]) + Rnd(-2, 2), N(c["z"]) + Rnd(-2, 2)); result["at"] = new JsonArray(p.x, p.z, rng() * Math.PI * 2); }
            else if (kind == "inside") { var d = place == "home" ? null : DoorNear(pl == null ? N(home["sx"]) : N(pl["x"]), pl == null ? N(home["sz"]) : N(pl["z"]), 45, 4); result["door"] = Pt(N(d?["sx"] ?? home["sx"]), N(d?["sz"] ?? home["sz"])); }
            return result;
        }
        private string Nearest(IEnumerable<string> keys, double x, double z) => keys.OrderBy(k => Distance(N(places[k]?["x"]), N(places[k]?["z"]), x, z)).First();
        private Job? TakeJob(Func<Job, bool> predicate, JsonObject home)
        {
            var job = pending.Where(predicate).OrderBy(j => places[j.Place] == null ? 100 : Distance(N(places[j.Place]?["x"]), N(places[j.Place]?["z"]), N(home["sx"]), N(home["sz"]))).FirstOrDefault(); if (job != null) pending.Remove(job); return job;
        }
        private string? FemaleJob(JsonObject home) { if (!Chance(.4)) return null; var job = TakeJob(j => femaleTrades.Contains(j.Trade) && j.Trade != "maid", home); if (job == null) return null; pendingPlace[job.Trade] = job.Place; return job.Trade; }
        private Job? MaleJob(JsonObject home) => Chance(.8) ? TakeJob(j => !femaleTrades.Contains(j.Trade) && j.Trade is not ("thief" or "beggar" or "priest" or "police" or "lamplighter" or "retired"), home) : null;
        private void Kids(JsonObject parent, int motherAge)
        {
            int count = motherAge > 44 ? Int(0, 2) : Int(0, 4); for (int i = 0; i < count; i++) { int age = Math.Max(1, Math.Min(motherAge - 17, Int(1, 15))); if (age < 1) continue; string sex = Chance(.5) ? "m" : "f", trade = age < 5 ? "infant" : age >= 12 && sex == "m" ? "errand_boy" : "child"; var home = parent["home"]!.AsObject(); string play = Nearest(A(Facts["PLAY"]).Select(p => "play:" + p!.GetValue<string>()), N(home["sx"]), N(home["sz"])); string parentPlace = S(parent["work"], "place"); var work = trade == "errand_boy" ? Work("errand_boy", places.ContainsKey(parentPlace) ? parentPlace : "rijnkaai", home) : new JsonObject { ["place"] = play, ["kind"] = trade == "infant" ? "inside" : "roam" }; Add(sex, age, trade, sex == "m" ? "son" : "daughter", S(parent, "surname"), home, work, (int)N(parent["household"])); }
        }
        private void Family(JsonObject head, string? wifeTrade = null, JsonObject? wifeWork = null, bool noKids = false)
        {
            int age = (int)N(head["age"]), hh = (int)N(head["household"]); var home = head["home"]!.AsObject(); string surname = S(head, "surname");
            if (S(head, "sex") == "m" && age >= 20 && Chance(age > 60 ? .5 : .72)) { int wifeAge = Math.Max(18, age + Int(-8, 2)); string trade = wifeTrade ?? FemaleJob(home) ?? "housewife", place = wifeTrade != null ? S(wifeWork, "place", "home") : pendingPlace.GetValueOrDefault(trade, "home"); Add("f", wifeAge, trade, "wife", surname, home, wifeWork ?? Work(trade, place, home), hh); if (!noKids) Kids(head, wifeAge); }
            else if (S(head, "sex") == "f" && age >= 20 && Chance(.55) && S(head, "family_role") != "widow") { int husbandAge = age + Int(-2, 8); var job = MaleJob(home); Add("m", husbandAge, job?.Trade ?? "docker", "husband", surname, home, Work(job?.Trade ?? "docker", job?.Place ?? Pick(new[] { "rijnkaai", "werf", "bassin" }), home), hh); if (!noKids) Kids(head, age); }
            else if (!noKids && age >= 28 && age < 60 && Chance(.35)) { head["family_role"] = S(head, "sex") == "f" ? "widow" : "widower"; Kids(head, age); }
            if (Chance(.12)) { var job = MaleJob(home) ?? new Job("sailor", "rijnkaai"); int lodgerAge = Int(19, 45); string last = Surname(); Add("m", lodgerAge, job.Trade, "lodger", last, home, Work(job.Trade, job.Place, home), hh); }
        }
        private List<Job> Jobs()
        {
            var list = new List<Job>(); void AddJobs(string trade, string place, int count, bool fixedCount = false) { int n = fixedCount || scale == 1 ? count : Math.Max(1, (int)Math.Floor(count * scale + .5)); for (int i = 0; i < n; i++) list.Add(new Job(trade, place)); }
            foreach (var j in new[] { ("docker","rijnkaai",7),("docker","werf",4),("docker","bassin",4),("docker","bassin_south",2),("natie","hessenatie",5),("natie","entrepot",6),("porter","rijnkaai",2),("porter","werf",1),("carter","rijnkaai",1),("carter","grote_markt",1),("carter","canal",1),("boatman","werf",2),("boatman","vismarkt",2),("boatman","canal",2),("sailor","rijnkaai",3),("sailor","bassin",2),("sailor","werf",2) }) AddJobs(j.Item1,j.Item2,j.Item3);
            if (scale == 1) { AddJobs("police","quays",2);AddJobs("police","town",1);AddJobs("police","werf",1); } else for (int i = 0; i < Math.Max(4,(int)Math.Floor(4*scale+.5));i++) list.Add(new Job("police",new[]{"quays","town","quays","werf"}[i%4]));
            AddJobs("priest","cathedral",1,true);AddJobs("lamplighter","lamps",1,true);
            foreach (var j in new[] { ("beggar","cathedral",1),("beggar","steenplein",1),("beggar","canal",1),("thief","night",5),("clerk","entrepot",1),("clerk","town_hall",2),("merchant","grote_markt",2),("retired","home",4),("fishwife","vismarkt",6),("market_woman","grote_markt",6),("maid","grote_markt",4),("laundress","canal",3),("seamstress","home",2) }) AddJobs(j.Item1,j.Item2,j.Item3); return list;
        }
        private void AssignStall(JsonObject person, int index, string place)
        {
            var stall = stalls[index]; stall["keeper"] = person["id"]!.DeepClone(); var p = Snap(N(stall["x"]) - N(stall["face"]?[0]), N(stall["z"]) - N(stall["face"]?[1])); person["work"] = new JsonObject { ["place"] = place, ["kind"] = "stall", ["stall"] = index, ["at"] = new JsonArray(p.x,p.z,Math.Atan2(N(stall["face"]?[0]),N(stall["face"]?[1]))) };
        }
        private int? StallFor(string place) { for (int k = 0; k < stalls.Count; k++) { int index = (stallNext + k) % stalls.Count; if (S(stalls[index], "place") == place && stalls[index]["keeper"] == null) { stallNext = index + 1; return index; } } return null; }
        public JsonObject Make()
        {
            BuildPlaces(); pending = Shuffle(Jobs()); if (scale != 1) { var seen = new HashSet<string>(); var firsts = pending.Where(j => { bool first = !seen.Contains(j.Trade); seen.Add(j.Trade); return j.Trade == "police" || first; }).ToArray(); pending = firsts.Concat(pending.Where(j => !firsts.Contains(j))).ToList(); foreach (var j in firsts) must.Add(j); }
            foreach (var e in A(Facts["TOWN_EMPLOYERS"])) { var spot = owner.City; var sp = owner.Spot(S(e,"spot")); double x=N(sp["x"]),z=N(sp["z"]); var d=DoorNear(x,z,120,3)??DoorNear(x,z,1e9)??throw new NativeServiceException("No native house is available for an employer.",409);var home=Home(d);int hh=++household;string last=Surname();var p=Snap(x+1.2,z+1.2);var head=Add(S(e,"sex"),Int(38,58),S(e,"trade"),"head",last,home,new JsonObject{["place"]=S(e,"spot"),["kind"]="post",["at"]=new JsonArray(p.x,p.z,Math.Atan2(x-p.x,z-p.z))},hh,S(e,"id"));Family(head); }
            foreach(var s in A(Facts["SHOPS"])) { string id=S(s,"id");if(!shopDoors.TryGetValue(id,out var d))continue;var home=Home(d);int hh=++household;string last=Surname();var seller=NativeTownHouseDoors.ShopSeller(owner.Buildings["houses"]!.AsArray(),d)??(N(d["x"])+N(d["out"]?[0])*.9,N(d["z"])+N(d["out"]?[1])*.9);var p=Snap(seller.Item1,seller.Item2);string sex=S(s,"trade")=="draper"&&Chance(.5)?"f":"m",trade=sex=="f"?"shopwife":S(s,"trade");double yaw=Math.Atan2(N(d["out"]?[0]),N(d["out"]?[1]));var head=Add(sex,Int(30,62),trade,"head",last,home,new JsonObject{["place"]=id,["kind"]="shop",["shop"]=id,["at"]=new JsonArray(p.x,p.z,yaw)},hh);shops.Add(new JsonObject{["id"]=id,["label"]=s!["label"]!.DeepClone(),["door"]=Pt(N(d["sx"]),N(d["sz"])),["wall"]=Pt(N(d["x"]),N(d["z"])),["out"]=d["out"]!.DeepClone(),["goods"]=s["goods"]?.DeepClone(),["keeper"]=head["id"]!.DeepClone()});if(sex=="m")Family(head,"shopwife",new JsonObject{["place"]=id,["kind"]="shop",["shop"]=id,["at"]=new JsonArray(N(d["sx"]),N(d["sz"]),yaw)});else Family(head); }
            foreach(var t in A(Facts["TAVERNS"])) {string id="tavern:"+S(t,"id");var pl=places[id];if(pl?["door"]==null)continue;double x=N(pl["door"]?[0]),z=N(pl["door"]?[1]);var home=new JsonObject{["house"]=-1,["x"]=x,["z"]=z,["sx"]=x,["sz"]=z};int hh=++household;string last=Surname();var p=Snap(x+N(pl["out"]?[0])*.8,z+N(pl["out"]?[1])*.8);var head=Add("m",Int(32,60),"publican","head",last,home,new JsonObject{["place"]=id,["kind"]="tavern",["at"]=new JsonArray(p.x,p.z,Math.Atan2(N(pl["out"]?[0]),pl["out"]?[1]==null?-1:N(pl["out"]?[1])))},hh);Family(head);}
            while(pending.Count>0&&(residents.Count<target||pending.Any(must.Contains))) {var job=pending[0];pending.RemoveAt(0);if(residents.Count>=target&&!must.Contains(job))continue;bool full=residents.Count>=target;var anchor=places[job.Place]??places[job.Place=="night"?"vismarkt":job.Place=="lamps"?"steenplein":"rijnkaai"]!;var d=DoorNear(N(anchor["x"]),N(anchor["z"]),160,6)??DoorNear(N(anchor["x"]),N(anchor["z"]),1e9,3);var home=d!=null?Home(d):scale>1?ShareHouse(N(anchor["x"]),N(anchor["z"])):null;if(home==null)break;int hh=++household;bool female=femaleTrades.Contains(job.Trade)||job.Trade=="beggar"&&Chance(.3)||job.Trade=="thief"&&Chance(.2);string sex=female?"f":"m";int age=job.Trade switch{"retired"=>Int(62,76),"maid"=>Int(15,24),"beggar"=>Int(40,72),"thief"=>Int(16,34),_=>Int(19,56)};string last=Surname();var head=Add(sex,age,job.Trade,job.Trade=="maid"?"single":"head",last,home,Work(job.Trade,job.Place,home),hh);if(job.Trade is "fishwife" or "market_woman"){int? i=StallFor(job.Place);if(i!=null)AssignStall(head,i.Value,job.Place);else head["work"]=Work("laundress",job.Place,home);}if(job.Trade=="priest"){var c=owner.Spot("cathedral_door");var p=Snap(N(c["x"])+1.5,N(c["z"])-.6);head["work"]=new JsonObject{["place"]="cathedral",["kind"]="post",["at"]=new JsonArray(p.x,p.z,Math.PI)};head["family_role"]="single";continue;}if(job.Trade is "maid" or "thief" or "beggar"||full)continue;Family(head);}
            AddStreetChildren(); FinishMarkets(); EnsurePriestPolice();foreach(var r in residents)r["sched"]=owner.Schedule(r,places,taverns,rng);
            var dogOwners=new HashSet<string>{"docker","carter","boatman","retired","beggar","brewer","lamplighter","porter","natie"};foreach(var family in residents.GroupBy(r=>N(r["household"]))) {var person=family.FirstOrDefault(r=>dogOwners.Contains(S(r,"trade")));if(person!=null&&Chance(S(person,"trade")=="beggar"?.6:.18))person["dog"]=new JsonObject{["name"]=PickName("DOGS"),["look"]=PickName("DOG_LOOKS")};}
            AddGarrison();var result=new JsonObject{["seed"]=(long)seed,["places"]=places,["stalls"]=new JsonArray(stalls.Cast<JsonNode>().ToArray()),["shops"]=new JsonArray(shops.Cast<JsonNode>().ToArray()),["residents"]=new JsonArray(residents.Cast<JsonNode>().ToArray())};if(size!="normal")result["size"]=size;return result;
        }
        partial void AddGarrison();
    }
}

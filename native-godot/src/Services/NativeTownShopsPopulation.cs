using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Original shop placement, keeper generation and older empty-front repairs with household-safe relocation.</summary>
public sealed class NativeTownShopsPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C=>population.Host.Context;
    private readonly JsonObject facts;
    private static string S(JsonNode? n,string key,string fallback="")=>NativeTownPopulation.S(n,key,fallback);
    private static double N(JsonNode? n)=>NativeTownPopulation.N(n);
    private static JsonArray A(JsonNode? n)=>NativeTownPopulation.A(n);
    private static bool B(JsonNode? n,string key)=>n?[key]is JsonValue v&&v.TryGetValue<bool>(out var b)&&b;
    private static double Distance(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    private static uint Hash(string text){uint h=2166136261;foreach(char ch in text)h=unchecked((h^ch)*16777619);return h;}
    private static int Round(double n)=>(int)Math.Floor(n+.5);
    private static readonly string[] firsts={"Florimond","Isidoor","Achiel","Gommaar","Cyriel","Hippoliet","Norbert","Aloïs","Jozef","Leopold","Désiré","Evarist"};
    private static readonly string[] surnames={"Verstraeten","De Coninck","Van Dyck","Moretus","Huybrechts","Van Riel","Schoofs","De Wolf","Mortelmans","Van Aken","Cools","Van den Bergh","Wouters","Janssens","De Meyer","Claes"};
    private static readonly string[] recordKeys={"press","veloshop","cartshop","emigrants","homes","poesje:door"};
    public NativeTownShopsPopulation(NativeTownPopulation population){this.population=population;facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-shop-population.json")))!.AsObject();}
    private int? Own(string id){var entry=A(population.Kept["houses"]).FirstOrDefault(h=>S(h,"id")==id);return entry==null?null:(int)N(entry["house"]);}
    private HashSet<int> Kept()=>A(population.Kept["houses"]).Select(h=>(int)N(h?["house"])).ToHashSet();
    private sealed class Taken {public HashSet<int> Houses=new();public HashSet<int> Homes=new();public List<(double X,double Z)> Points=new();}
    private Taken RecordDoors()
    {
        var result=new Taken();foreach(string key in recordKeys){var state=C.World(key);if(state==null)continue;string json=state.ToJsonString();foreach(Match m in Regex.Matches(json,@"""(?:step|wall)"":\[(-?[\d.]+),(-?[\d.]+)\]"))result.Points.Add((double.Parse(m.Groups[1].Value,System.Globalization.CultureInfo.InvariantCulture),double.Parse(m.Groups[2].Value,System.Globalization.CultureInfo.InvariantCulture)));foreach(Match m in Regex.Matches(json,@"""house"":(\d+)"))result.Houses.Add(int.Parse(m.Groups[1].Value));}return result;
    }
    private Taken TakenDoors(JsonObject town)
    {
        var result=RecordDoors();result.Houses.UnionWith(Kept());foreach(var r in A(town["residents"])){int house=(int)N(r?["home"]?["house"]);if(house>=0){result.Houses.Add(house);result.Homes.Add(house);}if(r?["work"]?["door"]is JsonArray d)result.Points.Add((N(d[0]),N(d[1])));}foreach(var p in town["places"]!.AsObject())if(p.Value?["door"]is JsonArray d)result.Points.Add((N(d[0]),N(d[1])));foreach(var shop in A(town["shops"]))if(shop?["door"]is JsonArray d)result.Points.Add((N(d[0]),N(d[1])));return result;
    }
    private static bool FreeDoor(JsonObject d,Taken taken,int? own=null)=>(own!=null&&(int)N(d["house"])==own?!taken.Homes.Contains((int)N(d["house"])):!taken.Houses.Contains((int)N(d["house"])))&&!taken.Points.Any(p=>Distance(p.X,p.Z,N(d["sx"]),N(d["sz"]))<2.2||Distance(p.X,p.Z,N(d["x"]),N(d["z"]))<2.2);
    private (JsonArray Keeper,JsonArray Wife) StandAt(JsonObject d)
    {
        double ox=N(d["out"]?[0]),oz=N(d["out"]?[1]),x=N(d["x"])-oz*1.9+ox*.6,z=N(d["z"])+ox*1.9+oz*.6;var at=population.Snap(x+ox*.2,z+oz*.2,8)??(x+ox*.2,z+oz*.2);double yaw=Math.Atan2(ox,oz);return(new(at.Item1,at.Item2,yaw),new(N(d["sx"]),N(d["sz"]),yaw));
    }
    private static JsonObject Home(JsonObject d)=>new(){["house"]=d["house"]!.DeepClone(),["x"]=N(d["x"]),["z"]=N(d["z"]),["sx"]=N(d["sx"]),["sz"]=N(d["sz"])};
    private static JsonObject KeeperSched(JsonObject def,string? tavern,bool evening)
    {
        var day=new JsonArray(A(def["hours"]).Select(h=>(JsonNode)new JsonArray(N(h?[0]),N(h?[1]),"work")).ToArray());double last=N(A(def["hours"]).LastOrDefault()?[1]);if(evening&&tavern!=null&&last<=19.75)day.Add(new JsonArray(Math.Max(20,last+.75),22,"tavern",tavern));var sunday=new JsonArray(A(def["sunday"]).Select(h=>(JsonNode)new JsonArray(N(h?[0]),N(h?[1]),"work")).ToArray());bool Busy(double h)=>sunday.Any(s=>h>=N(s?[0])-.25&&h<N(s?[1])+.25);sunday.Add(!Busy(9)&&!Busy(10.5)?new JsonArray(8.75,11,"church","church"):new JsonArray(11.25,12.25,"church","church"));sunday.Add(new JsonArray(15,17,"stroll","play:grote_markt"));return new(){["day"]=day,["sunday"]=new JsonArray(sunday.OrderBy(s=>N(s?[0])).Select(s=>s!.DeepClone()).ToArray())};
    }
    private static void PlaceShop(JsonObject shop,JsonObject d,JsonObject places)
    {
        shop["door"]=new JsonArray(N(d["sx"]),N(d["sz"]));shop["wall"]=new JsonArray(N(d["x"]),N(d["z"]));shop["out"]=d["out"]!.DeepClone();string id=S(shop,"id");var place=places[id]?.DeepClone().AsObject()??new JsonObject{["label"]=S(shop,"label"),["r"]=3,["district"]="town"};place["x"]=N(d["sx"]);place["z"]=N(d["sz"]);place["door"]=shop["door"]!.DeepClone();place["out"]=d["out"]!.DeepClone();places[id]=place;
    }
    public JsonObject Ensure(uint seed)
    {
        if(C.Scalar<int>("SELECT COUNT(*) FROM resident")==0)return new(){["added"]=0,["moved"]=0};var rec=C.World("shops_m7")?.DeepClone().AsObject()??new JsonObject{["v"]=1,["added"]=new JsonArray(),["moved"]=new JsonArray(),["skipped"]=new JsonArray()};var town=population.Snapshot();var people=A(town["residents"]);var shops=A(town["shops"]).DeepClone().AsArray();var places=town["places"]!.DeepClone().AsObject();var todo=A(facts["newShops"]).Where(d=>!shops.Any(s=>S(s,"id")==S(d,"id"))&&!A(rec["skipped"]).Any(k=>S(k,"id")==S(d,"id"))).Select(d=>d!.AsObject()).ToArray();
        var toMove=facts["oldShops"]!.AsObject().Select(p=>p.Key).Where(id=>Own("shop:"+id)!=null&&shops.Any(s=>S(s,"id")==id)&&!A(rec["moved"]).Any(m=>m?.GetValue<string>()==id)&&!A(rec["skipped"]).Any(k=>S(k,"id")==id)).ToArray();
        bool outside=shops.Any(s=>population.Doors.FirstOrDefault(d=>(int)N(d["house"])==Own("shop:"+S(s,"id")))is{} door&&Distance(N(s?["wall"]?[0]),N(s?["wall"]?[1]),N(door["x"]),N(door["z"]))>=.6);if(todo.Length==0&&toMove.Length==0&&!outside)return new(){["added"]=0,["moved"]=0};
        var taken=TakenDoors(town);var changed=new Dictionary<string,JsonObject>();var addedRows=new List<JsonObject>();var byId=people.ToDictionary(r=>S(r,"id"),r=>r!.AsObject());var rng=NativeTownPopulation.Random(unchecked((uint)N(town["seed"])^0x54090873));var usedSurnames=people.Select(r=>S(r,"surname")).ToHashSet();int household=Math.Max(0,people.Select(r=>(int)N(r?["household"])).DefaultIfEmpty(0).Max()),moved=0;
        void Skip(string id,string why)=>A(rec["skipped"]).Add(new JsonObject{["id"]=id,["why"]=why});
        foreach(string id in toMove){
            int own=Own("shop:"+id)!.Value;var shop=shops.First(s=>S(s,"id")==id)!.AsObject();var d=population.Doors.FirstOrDefault(q=>(int)N(q["house"])==own);if(d==null){Skip(id,$"house {own} has no door in this city");continue;}if(Distance(N(shop["wall"]?[0]),N(shop["wall"]?[1]),N(d["x"]),N(d["z"]))<.6){A(rec["moved"]).Add(id);continue;}
            double? keeperHousehold=byId.GetValueOrDefault(S(shop,"keeper"))is{} keeper?N(keeper["household"]):null;bool others=people.Any(r=>N(r?["home"]?["house"])==own&&(keeperHousehold==null||N(r?["household"])!=keeperHousehold));var ownTaken=new Taken{Houses=taken.Houses,Homes=new(),Points=taken.Points};if(others||!FreeDoor(d,ownTaken,own)){Skip(id,$"its own house {own} is taken in this town");continue;}PlaceShop(shop,d,places);var stand=StandAt(d);
            foreach(var r in people.Where(r=>S(r?["work"],"shop")==id)){string rid=S(r,"id");var edited=changed.GetValueOrDefault(rid)??r!.DeepClone().AsObject();edited["work"]!["at"]=(rid==S(shop,"keeper")?stand.Keeper:stand.Wife).DeepClone();changed[rid]=edited;}taken.Houses.Add(own);taken.Points.Add((N(d["sx"]),N(d["sz"])));A(rec["moved"]).Add(id);moved++;
        }
        foreach(var def in todo){
            string id=S(def,"id");int? own=Own("shop:"+id);if(B(def,"onlyVacant")&&own!=null&&taken.Homes.Contains(own.Value)){Skip(id,"listed house is an existing household's home");continue;}var d=own==null?null:population.Doors.FirstOrDefault(q=>(int)N(q["house"])==own&&FreeDoor(q,taken,own));d??=population.Doors.Where(q=>!B(q,"alley")&&FreeDoor(q,taken)&&Distance(N(q["sx"]),N(q["sz"]),N(def["x"]),N(def["z"]))<45).OrderBy(q=>Distance(N(q["sx"]),N(q["sz"]),N(def["x"]),N(def["z"]))).FirstOrDefault();if(d==null){Skip(id,"no free door near its anchor");continue;}taken.Houses.Add((int)N(d["house"]));taken.Points.Add((N(d["sx"]),N(d["sz"])));
            string trade=S(def,"trade"),first=firsts[(int)Math.Floor(rng()*firsts.Length)],surname=surnames.Where((s,i)=>!usedSurnames.Contains(s)&&(Hash(id)+(uint)i)%3!=0).FirstOrDefault()??surnames.FirstOrDefault(s=>!usedSurnames.Contains(s))??"Claes";usedSurnames.Add(surname);var stand=StandAt(d);string? tavern=A(facts["taverns"]).Select(t=>"tavern:"+S(t,"id")).Where(k=>places[k]?["door"]!=null).OrderBy(k=>Distance(N(places[k]?["x"]),N(places[k]?["z"]),N(d["sx"]),N(d["sz"]))).FirstOrDefault();var tradeDef=facts["trades"]![trade]!;int Stat(string key)=>Math.Clamp(5+Round(rng()*4-2)+(int)N(tradeDef["bias"]?[key]),0,10);
            int age=34+(int)Math.Floor(rng()*28);var sched=KeeperSched(def,tavern,rng()<.4);var stats=new JsonObject();foreach(string key in new[]{"honesty","temper","piety","warmth","greed","courage","gossip"})stats[key]=Stat(key);var wealth=A(tradeDef["wealth"]);stats["wealth"]=N(wealth[0])+Math.Floor(rng()*(N(wealth[1])-N(wealth[0])+1));
            var resident=new JsonObject{["id"]="sk_"+id,["first"]=first,["surname"]=surname,["name"]=first+" "+surname,["age"]=age,["sex"]=S(def,"sex"),["household"]=++household,["family_role"]="head",["trade"]=trade,["faction"]=tradeDef["faction"]?.DeepClone(),["kind"]=S(def,"kind"),["home"]=Home(d),["work"]=new JsonObject{["place"]=id,["kind"]="shop",["shop"]=id,["at"]=stand.Keeper.DeepClone()},["sched"]=sched,["stats"]=stats,["dog"]=null};
            places[id]=new JsonObject{["label"]=S(def,"label"),["x"]=N(d["sx"]),["z"]=N(d["sz"]),["r"]=3,["district"]="town",["door"]=new JsonArray(N(d["sx"]),N(d["sz"])),["out"]=d["out"]!.DeepClone()};shops.Add(new JsonObject{["id"]=id,["label"]=S(def,"label"),["door"]=new JsonArray(N(d["sx"]),N(d["sz"])),["wall"]=new JsonArray(N(d["x"]),N(d["z"])),["out"]=d["out"]!.DeepClone(),["goods"]=def["goods"]?.DeepClone(),["keeper"]=S(resident,"id")});addedRows.Add(resident);A(rec["added"]).Add(id);
        }
        moved+=MoveIntoOwnHouse(shops,places,people.Select(r=>r!.AsObject()).Concat(addedRows).ToArray(),changed,rec);
        C.Atomic(()=>{foreach(var r in addedRows){string id=S(r,"id");if(byId.ContainsKey(id))continue;C.Execute("INSERT OR IGNORE INTO npc(id,name,role,district,faction,persona_json,spot_id,active)VALUES($p0,$p1,$p2,'town',$p3,'{}',NULL,1)",id,S(r,"name"),S(facts["trades"]?[S(r,"trade")],"label"),r["faction"]==null?null:S(r,"faction"));C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id)VALUES($p0,1)",id);C.Execute("INSERT OR IGNORE INTO resident(id,household,trade,data_json)VALUES($p0,$p1,$p2,$p3)",id,(int)N(r["household"]),S(r,"trade"),r.ToJsonString());}foreach(var r in changed.Values)C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1",r.ToJsonString(),S(r,"id"));town.Remove("residents");town["places"]=places;town["shops"]=shops;C.SetWorld("town",town);C.SetWorld("shops_m7",rec);});population.Town.Clear();return new(){["added"]=addedRows.Count,["moved"]=moved};
    }
    private static bool Near(JsonNode? point,double x,double z,double radius)=>point is JsonArray p&&Distance(N(p[0]),N(p[1]),x,z)<radius;
    private int MoveIntoOwnHouse(JsonArray shops,JsonObject places,JsonObject[] originals,Dictionary<string,JsonObject> changed,JsonObject record)
    {
        JsonObject[] Now()=>originals.Select(r=>changed.GetValueOrDefault(S(r,"id"))??r).ToArray();JsonObject Edit(JsonObject r){string id=S(r,"id");var edited=changed.GetValueOrDefault(id)??r.DeepClone().AsObject();changed[id]=edited;return edited;}var records=RecordDoors();var kept=Kept();int moved=0;
        foreach(var node in shops){var shop=node!.AsObject();int? own=Own("shop:"+S(shop,"id"));var d=population.Doors.FirstOrDefault(q=>(int)N(q["house"])==own);if(d==null||Distance(N(shop["wall"]?[0]),N(shop["wall"]?[1]),N(d["x"]),N(d["z"]))<.6)continue;var people=Now();bool Mine(JsonObject r)=>S(r["work"],"shop")==S(shop,"id")||S(r,"id")==S(shop,"keeper");
            bool other=shops.Any(s=>!ReferenceEquals(s,shop)&&(Near(s?["door"],N(d["sx"]),N(d["sz"]),2.2)||Near(s?["wall"],N(d["x"]),N(d["z"]),.6)))||places.Any(p=>p.Key!=S(shop,"id")&&Near(p.Value?["door"],N(d["sx"]),N(d["sz"]),2.2))||people.Any(r=>!Mine(r)&&Near(r["work"]?["door"],N(d["sx"]),N(d["sz"]),2.2))||records.Houses.Contains((int)N(d["house"]))||records.Points.Any(p=>Distance(p.X,p.Z,N(d["sx"]),N(d["sz"]))<2.2||Distance(p.X,p.Z,N(d["x"]),N(d["z"]))<2.2);if(other)continue;
            var keeper=people.FirstOrDefault(r=>S(r,"id")==S(shop,"keeper"));double? keeperHh=keeper==null?null:N(keeper["household"]);var lodgers=people.Where(r=>N(r["home"]?["house"])==N(d["house"])&&(keeperHh==null||N(r["household"])!=keeperHh)).ToArray();if(lodgers.Length>0&&B(A(facts["newShops"]).FirstOrDefault(s=>S(s,"id")==S(shop,"id")),"onlyVacant"))continue;
            var plan=new List<(JsonObject[] People,JsonObject Door)>();var used=people.Select(r=>(int)N(r["home"]?["house"])).Where(h=>h>=0).ToHashSet();var taken=new List<JsonNode?>();taken.AddRange(shops.Select(s=>s?["door"]));taken.AddRange(places.Select(p=>p.Value?["door"]).Where(p=>p!=null));taken.AddRange(people.Select(r=>r["work"]?["door"]).Where(p=>p!=null));taken.AddRange(records.Points.Select(p=>(JsonNode)new JsonArray(p.X,p.Z)));bool ok=true;
            foreach(var household in lodgers.GroupBy(r=>N(r["household"]))){var to=population.Doors.Where(q=>!B(q,"alley")&&N(q["house"])!=N(d["house"])&&!used.Contains((int)N(q["house"]))&&!kept.Contains((int)N(q["house"]))&&!records.Houses.Contains((int)N(q["house"]))&&!taken.Any(p=>Near(p,N(q["sx"]),N(q["sz"]),2.2))).OrderBy(q=>Distance(N(q["sx"]),N(q["sz"]),N(d["sx"]),N(d["sz"]))).FirstOrDefault();if(to==null){ok=false;break;}used.Add((int)N(to["house"]));plan.Add((household.ToArray(),to));}if(!ok)continue;
            foreach(var move in plan)foreach(var person in move.People)Edit(person)["home"]=Home(move.Door);var old=shop["door"]!.DeepClone().AsArray();PlaceShop(shop,d,places);var stand=StandAt(d);foreach(var person in Now().Where(Mine)){var edited=Edit(person);edited["work"]!["at"]=(S(edited,"id")==S(shop,"keeper")?stand.Keeper:stand.Wife).DeepClone();if(S(edited,"id")=="sk_"+S(shop,"id")&&Near(new JsonArray(N(edited["home"]?["sx"]),N(edited["home"]?["sz"])),N(old[0]),N(old[1]),.6))edited["home"]=Home(d);}
            if(!A(record["moved"]).Any(m=>m?.GetValue<string>()==S(shop,"id")))A(record["moved"]).Add(S(shop,"id"));record["skipped"]=new JsonArray(A(record["skipped"]).Where(k=>S(k,"id")!=S(shop,"id")).Select(k=>k!.DeepClone()).ToArray());moved++;
        }return moved;
    }
}

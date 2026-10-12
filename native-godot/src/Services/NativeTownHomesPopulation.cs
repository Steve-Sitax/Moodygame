using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Original homes/town.ts free-door selection, landlord/dealer additions and saved-dealer name repair.</summary>
public sealed class NativeTownHomesPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C=>population.Host.Context;
    private static readonly string[] classes={"cellar","garret","widow","alley","merchant"};
    private static readonly Dictionary<string,(double X,double Z,string Where)> want=new(){["garret"]=(-120,117,"in the Schipperskwartier"),["cellar"]=(-90,133,"by the Canal des Brasseurs"),["alley"]=(-307,284,"behind the cathedral"),["merchant"]=(-16,45,"on the Rijnkaai"),["widow"]=(-175,75,"near the Vismarkt")};
    private static string S(JsonNode? n,string key,string fallback="")=>NativeTownPopulation.S(n,key,fallback);
    private static double N(JsonNode? n)=>NativeTownPopulation.N(n);
    private static JsonArray A(JsonNode? n)=>NativeTownPopulation.A(n);
    private static uint Hash(string text){uint h=2166136261;foreach(char ch in text)h=unchecked((h^ch)*16777619);return h;}
    private static double Distance(double ax,double az,double bx,double bz)=>Math.Sqrt(Math.Pow(ax-bx,2)+Math.Pow(az-bz,2));
    private static string District(double x,double z)=>x>40?"eilandje":x> -40?"rijnkaai":x> -150?z>60?"canal":"vismarkt":z>60?"grote-markt":"steenplein";
    public NativeTownHomesPopulation(NativeTownPopulation population)=>this.population=population;
    private double LaneWidth(JsonObject door)
    {
        double w=0;var outward=A(door["out"]);for(double s=0;s<40;s+=.25){if(!population.Open(N(door["sx"])+N(outward[0])*s,N(door["sz"])+N(outward[1])*s,.1))break;w=s;}return w+Distance(N(door["sx"]),N(door["sz"]),N(door["x"]),N(door["z"]));
    }
    private bool Fits(string cls,JsonObject d){double storeys=N(d["storeys"]);return cls switch{"garret"=>storeys>=4,"cellar"=>storeys>=2,"alley"=>LaneWidth(d)<5&&storeys<=3,"merchant"=>storeys>=3&&N(d["out"]?[1])<-.7,"widow"=>storeys>=2&&storeys<=4,_=>false};}
    private JsonObject? Nearest(IEnumerable<JsonObject> doors,double x,double z,Func<JsonObject,bool> ok)=>doors.Where(ok).OrderBy(d=>Distance(N(d["sx"]),N(d["sz"]),x,z)).FirstOrDefault();
    private List<JsonObject> FreeDoors(JsonObject town,List<(double X,double Z)> extra)
    {
        var people=A(town["residents"]);var houses=new HashSet<int>(people.Select(r=>(int)N(r?["home"]?["house"])));var taken=extra.ToList();void take(JsonNode? a){if(a is JsonArray point&&point.Count>=2)taken.Add((N(point[0]),N(point[1])));}
        foreach(var r in people){taken.Add((N(r?["home"]?["sx"]),N(r?["home"]?["sz"])));take(r?["work"]?["door"]);}foreach(var p in town["places"]!.AsObject())take(p.Value?["door"]);foreach(var shop in A(town["shops"]))take(shop?["door"]);
        foreach(string key in new[]{"poesje:door","press"}){var record=C.World(key);if(record==null)continue;if(record["sx"]!=null&&record["sz"]!=null)taken.Add((N(record["sx"]),N(record["sz"])));take(record["post"]?["step"]);foreach(var corner in A(record["corners"]))taken.Add((N(corner?["x"]),N(corner?["z"])));}
        return population.Doors.Where(d=>!houses.Contains((int)N(d["house"]))&&!taken.Any(p=>Distance(p.X,p.Z,N(d["sx"]),N(d["sz"]))<4)).ToList();
    }
    private static JsonObject Home(JsonObject d)=>new(){["house"]=d["house"]!.DeepClone(),["x"]=d["x"]!.DeepClone(),["z"]=d["z"]!.DeepClone(),["sx"]=d["sx"]!.DeepClone(),["sz"]=d["sz"]!.DeepClone()};
    private static string NearestKey(JsonObject places,string prefix,double x,double z,string fallback)=>places.Where(p=>p.Key.StartsWith(prefix,StringComparison.Ordinal)).OrderBy(p=>Distance(N(p.Value?["x"]),N(p.Value?["z"]),x,z)).Select(p=>p.Key).FirstOrDefault()??fallback;
    private bool Add(JsonObject resident,string role,JsonObject door)
    {
        if(C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0",S(resident,"id"))>0)return false;population.AddResident(resident,role,District(N(door["sx"]),N(door["sz"])));return true;
    }
    private void RenameDoor(JsonObject? record)
    {
        string id=S(record?["dealer"],"id");var person=population.Town.Resident(id);if(record?["dealer"] is not JsonObject dealer||person==null||S(person,"first")!="Door")return;var changed=person.DeepClone().AsObject();changed["first"]="Dolf";changed["name"]="Dolf "+S(changed,"surname");C.Atomic(()=>{C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1",changed.ToJsonString(),id);C.Execute("UPDATE npc SET name=$p0 WHERE id=$p1",S(changed,"name"),id);dealer["label"]=S(changed,"name")+"'s second-hand shop";C.SetWorld("homes",record);var town=C.World("town")?.AsObject();if(town?["places"]?["dealer_shop"] is JsonObject shop){shop["label"]=dealer["label"]!.DeepClone();C.SetWorld("town",town);}});population.Town.Clear();
    }
    public JsonObject Ensure(uint seed)
    {
        if(C.Scalar<int>("SELECT COUNT(*) FROM resident")==0)return new JsonObject{["homes"]=0,["widow"]=false,["dealer"]=false};var before=C.World("homes") as JsonObject;RenameDoor(before);if(N(before?["v"])==1&&A(before?["homes"]).Count==5&&before?["dealer"]!=null)return new JsonObject{["homes"]=0,["widow"]=false,["dealer"]=false};
        var town=population.Snapshot();var people=A(town["residents"]);var places=town["places"]!.AsObject();var rng=NativeTownPopulation.Random(seed^0x404e73);var record=before??new JsonObject{["v"]=1,["homes"]=new JsonArray(),["dealer"]=null,["widow"]=null};var homes=record["homes"]!.AsArray();var added=new JsonObject{["homes"]=0,["widow"]=false,["dealer"]=false};var surnames=new HashSet<string>(people.Select(r=>S(r,"surname")));string surname(string[] list)=>list.FirstOrDefault(n=>!surnames.Contains(n))??list[0];int household=people.Max(r=>(int)N(r?["household"]));var owners=people.Where(r=>N(r?["age"])>=30&&(S(r,"trade") is "merchant" or "brewer" or "fish_merchant"||N(r?["stats"]?["wealth"])>=6)).OrderBy(r=>Hash(S(r,"id")+seed)).ToArray();int ownerAt=0;
        var kept=new Dictionary<string,int>();foreach(var h in A(population.Kept["houses"]))if(S(h,"kind")=="home"&&S(h,"cls").Length>0)kept[S(h,"cls")]=(int)N(h?["house"]);
        C.Atomic(()=>{var taken=homes.Select(h=>(X:N(h?["step"]?[0]),Z:N(h?["step"]?[1]))).ToList();if(record["dealer"]!=null)taken.Add((N(record["dealer"]?["step"]?[0]),N(record["dealer"]?["step"]?[1])));
            foreach(string cls in classes){if(homes.Any(h=>S(h,"cls")==cls))continue;var choice=want[cls];var free=FreeDoors(town,taken);var door=free.FirstOrDefault(d=>kept.TryGetValue(cls,out int house)&&(int)N(d["house"])==house&&Fits(cls,d))??Nearest(free,choice.X,choice.Z,d=>Fits(cls,d));if(door==null)continue;taken.Add((N(door["sx"]),N(door["sz"])));string landlord=owners.Length>0?S(owners[ownerAt++%owners.Length],"id"):"";
                if(cls=="widow"){string first=new[]{"Rosalie","Mathilde","Coleta","Barbara","Joanna"}[(int)Math.Floor(rng()*5)],sn=surname(new[]{"Verlinden","Van Hoof","Goossens","Mertens","Wouters"});var widow=new JsonObject{["id"]="widow_landlady",["first"]=first,["surname"]=sn,["name"]=first+" "+sn,["age"]=58+(int)Math.Floor(rng()*10),["sex"]="f",["household"]=++household,["family_role"]="widow",["trade"]="seamstress",["faction"]=population.Facts["TRADES"]!["seamstress"]!["faction"]?.DeepClone(),["kind"]="old_woman",["home"]=Home(door),["work"]=new JsonObject{["place"]="home",["kind"]="inside",["door"]=new JsonArray(N(door["sx"]),N(door["sz"]))},["sched"]=new JsonObject{["day"]=new JsonArray(new JsonArray(9,10.25,"market",NearestKey(places,"market:",N(door["sx"]),N(door["sz"]),"market:vismarkt"))),["sunday"]=new JsonArray(new JsonArray(8.75,11,"church","church"))},["stats"]=new JsonObject{["honesty"]=7,["temper"]=4,["piety"]=7,["warmth"]=6,["greed"]=4,["courage"]=3,["gossip"]=7,["wealth"]=3},["dog"]=null};added["widow"]=Add(widow,"widow who lets a room",door);landlord="widow_landlady";record["widow"]=landlord;}
                homes.Add(new JsonObject{["id"]=cls,["cls"]=cls,["label"]=S(C.Rules["homeClasses"]?[cls],"label")+" "+choice.Where,["house"]=door["house"]!.DeepClone(),["step"]=new JsonArray(N(door["sx"]),N(door["sz"])),["wall"]=new JsonArray(N(door["x"]),N(door["z"])),["out"]=door["out"]!.DeepClone(),["landlord"]=landlord});added["homes"]=(int)N(added["homes"])+1;
            }
            if(record["dealer"]==null){var door=Nearest(FreeDoors(town,taken),-207,69,d=>N(d["storeys"])>=2);if(door!=null){var outward=door["out"]!.AsArray();var q=population.Snap(N(door["sx"])+N(outward[0])*.8,N(door["sz"])+N(outward[1])*.8,8)??(N(door["sx"])+N(outward[0])*.8,N(door["sz"])+N(outward[1])*.8);double yaw=Math.Atan2(N(outward[0]),N(outward[1]));string first=new[]{"Rik","Sus","Fons","Staf","Lowie"}[(int)Math.Floor(rng()*5)],sn=surname(new[]{"Van Ooteghem","Cuypers","Nuyts","Bogaerts","Sels"});var dealer=new JsonObject{["id"]="dealer",["first"]=first,["surname"]=sn,["name"]=first+" "+sn,["age"]=50+(int)Math.Floor(rng()*12),["sex"]="m",["household"]=++household,["family_role"]="single",["trade"]="dealer",["faction"]=population.Facts["TRADES"]!["dealer"]!["faction"]?.DeepClone(),["kind"]="shopkeeper",["home"]=Home(door),["work"]=new JsonObject{["place"]="dealer_shop",["kind"]="post",["at"]=new JsonArray(q.Item1,q.Item2,yaw)},["sched"]=new JsonObject{["day"]=new JsonArray(new JsonArray(8,12.5,"work"),new JsonArray(13.5,18,"work")),["sunday"]=new JsonArray(new JsonArray(8.75,11,"church","church"))},["stats"]=new JsonObject{["honesty"]=5,["temper"]=4,["piety"]=4,["warmth"]=6,["greed"]=7,["courage"]=4,["gossip"]=7,["wealth"]=3},["dog"]=null};added["dealer"]=Add(dealer,S(population.Facts["TRADES"]?["dealer"],"label"),door);record["dealer"]=new JsonObject{["id"]="dealer",["label"]=first+" "+sn+"'s second-hand shop",["step"]=new JsonArray(N(door["sx"]),N(door["sz"])),["wall"]=new JsonArray(N(door["x"]),N(door["z"])),["out"]=outward.DeepClone(),["at"]=new JsonArray(q.Item1,q.Item2,yaw)};}}
            if(record["dealer"] is JsonObject shop){var point=shop["step"]!.AsArray();population.AddPlaces(new JsonObject{["dealer_shop"]=new JsonObject{["label"]=shop["label"]!.DeepClone(),["x"]=point[0]!.DeepClone(),["z"]=point[1]!.DeepClone(),["r"]=3,["district"]=District(N(point[0]),N(point[1])),["door"]=point.DeepClone(),["out"]=shop["out"]!.DeepClone()}});}C.SetWorld("homes",record);
        });population.Town.Clear();return added;
    }
}

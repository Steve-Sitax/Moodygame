using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
namespace Scheldemist.Native.Services;

/// <summary>Madame Zelie and five stable stranger slots, with newly chosen native homes on regeneration.</summary>
public sealed class NativeTownVisitorsPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C=>population.Host.Context;
    private readonly JsonObject facts;
    private static string S(JsonNode? n,string k,string f="")=>NativeTownPopulation.S(n,k,f);
    private static double N(JsonNode? n)=>NativeTownPopulation.N(n);
    private static JsonArray A(JsonNode? n)=>NativeTownPopulation.A(n);
    private static double D(double x,double z,JsonNode? p)=>Math.Sqrt(Math.Pow(x-N(p?["sx"]),2)+Math.Pow(z-N(p?["sz"]),2));
    public NativeTownVisitorsPopulation(NativeTownPopulation population){this.population=population;facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-family.json")))!.AsObject();}
    private JsonObject? FreeDoor(double x,double z,HashSet<int> skip)
    {
        var town=population.Snapshot();var people=A(town["residents"]);var houses=people.Select(r=>(int)N(r?["home"]?["house"])).ToHashSet();var occupied=new List<(double x,double z)>();foreach(var r in people){occupied.Add((N(r?["home"]?["sx"]),N(r?["home"]?["sz"])));if(r?["work"]?["door"]is JsonArray door)occupied.Add((N(door[0]),N(door[1])));}
        foreach(var place in town["places"]!.AsObject())if(place.Value?["door"]is JsonArray door)occupied.Add((N(door[0]),N(door[1])));
        return population.Doors.Where(d=>!houses.Contains((int)N(d["house"]))&&!skip.Contains((int)N(d["house"]))&&!occupied.Any(p=>Math.Sqrt(Math.Pow(p.x-N(d["sx"]),2)+Math.Pow(p.z-N(d["sz"]),2))<4)).OrderBy(d=>D(x,z,d)).FirstOrDefault();
    }
    public int Ensure(uint seed)
    {
        if(population.Town.Residents.Count==0)return 0;var prototypes=A(facts["prototypes"]);if(prototypes.All(p=>population.Town.Residents.ContainsKey(S(p,"id"))))return 0;var used=A(population.Kept["houses"]??population.Kept["kept"]).Select(p=>(int)N(p?["house"]??p)).ToHashSet();foreach(var h in A(C.World("homes")?["homes"]))used.Add((int)N(h?["house"]));
        int household=population.Town.Residents.Values.Select(p=>(int)N(p["household"])).DefaultIfEmpty().Max()+1,added=0;JsonObject? lodging=null;int lodgingHousehold=household+1;
        C.Atomic(()=>{foreach(var prototype in prototypes){string id=S(prototype,"id");if(C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0",id)>0)continue;bool fortune=id=="fortune";var home=fortune?FreeDoor(-230,112,used):(lodging??=FreeDoor(-200,34,used));home??=population.Doors.FirstOrDefault();if(home==null)continue;if(fortune)used.Add((int)N(home["house"]));var person=prototype!.DeepClone().AsObject();person["household"]=fortune?household:lodgingHousehold;person["home"]=new JsonObject{["house"]=home["house"]!.DeepClone(),["x"]=home["x"]!.DeepClone(),["z"]=home["z"]!.DeepClone(),["sx"]=home["sx"]!.DeepClone(),["sz"]=home["sz"]!.DeepClone()};
            if(fortune){var at=population.Snap(-240,101,8)??(-240,101);person["work"]!["at"]=new JsonArray(at.Item1,at.Item2,Math.Atan2(-254-at.Item1,94-at.Item2));}else person["work"]!["route"]=new JsonArray(new JsonArray(N(home["sx"]),N(home["sz"])));
            population.AddResident(person,S(person["visitor"],"label"),fortune?"grote-markt":"steenplein");added++;
        }});return added;
    }
    public void SaveVisitor(JsonObject person){population.AddResident(person,S(person["visitor"],"label"),S(person["visitor"],"role")=="fortune"?"grote-markt":"steenplein");}
}

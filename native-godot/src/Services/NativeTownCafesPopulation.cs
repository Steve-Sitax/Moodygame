using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Original neighbourhood cafe keepers and regulars; existing households keep their addresses.</summary>
public sealed class NativeTownCafesPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C=>population.Host.Context;
    private readonly JsonObject facts;
    private static string S(JsonNode? n,string key,string fallback="")=>NativeTownPopulation.S(n,key,fallback);
    private static double N(JsonNode? n)=>NativeTownPopulation.N(n);
    private static JsonArray A(JsonNode? n)=>NativeTownPopulation.A(n);
    public NativeTownCafesPopulation(NativeTownPopulation population){this.population=population;facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-shop-population.json")))!.AsObject();}
    private (double X,double Z) Snap(double x,double z)=>population.Snap(x,z,8)??(x,z);
    public int Ensure(uint seed)
    {
        if(C.Scalar<int>("SELECT COUNT(*) FROM resident")==0)return 0;var town=population.Snapshot();var people=A(town["residents"]);var places=town["places"]!.DeepClone().AsObject();var rows=new List<JsonObject>();var ids=people.Select(r=>S(r,"id")).ToHashSet();var surnames=people.Select(r=>S(r,"surname")).ToHashSet();int household=Math.Max(0,people.Select(r=>(int)N(r?["household"])).DefaultIfEmpty(0).Max());
        foreach(var cafe in A(facts["cafes"])){
            string place="tavern:"+S(cafe,"id");var own=A(population.Kept["houses"]).FirstOrDefault(h=>S(h,"id")==place);var door=population.Doors.FirstOrDefault(d=>N(d["house"])==N(own?["house"]));
            if(own==null||door==null)throw new InvalidOperationException(place+": listed café has no house door");if(places[place]==null&&people.Any(r=>N(r?["home"]?["house"])==N(door["house"])))continue;places[place]??=new JsonObject{["label"]=S(cafe,"label"),["x"]=N(door["sx"]),["z"]=N(door["sz"]),["r"]=4,["district"]="town",["door"]=new JsonArray(N(door["sx"]),N(door["sz"])),["out"]=door["out"]!.DeepClone()};
            bool rough=place==S(facts,"gangCafe"),keeper=people.Any(r=>S(r,"trade")=="publican"&&S(r?["work"],"place")==place);int family=++household;string[] choices={rough?"Van Gils":"De Wilde","Vervoort","Van Riel","De Keersmaecker","Verbrugge","Van Mechelen","De Schutter","Bogaert"};string surname=choices.FirstOrDefault(n=>!surnames.Contains(n))??"Van "+(S(cafe,"id")=="linde"?"Linden":"Cattem");surnames.Add(surname);
            for(int i=keeper?1:0;i<4;i++){string id=$"cafe_{S(cafe,"id")}_{i}";if(ids.Contains(id))continue;string first=(rough?new[]{"Gust","Louis","Karel","Jan"}:new[]{"Pieter","Marie","Victor","Rosalie"})[i],sex=!rough&&i%2!=0?"f":"m";double ox=N(door["out"]?[0]),oz=N(door["out"]?[1]);var at=Snap(N(door["sx"])+ox*1.5,N(door["sz"])+oz*1.5);var other=Snap(at.X+oz*4,at.Z-ox*4);
                rows.Add(new JsonObject{["id"]=id,["first"]=first,["surname"]=surname,["name"]=first+" "+surname,["sex"]=sex,["age"]=28+i*9,["household"]=family,["family_role"]=i==0?"head":"lodger",["trade"]=i==0?"publican":"retired",["faction"]=rough?"smokkelaars":null,["kind"]=i==0?"shopkeeper":sex=="f"?"wife_b":i==2?"old_man":"docker_b",
                    ["home"]=new JsonObject{["house"]=door["house"]!.DeepClone(),["x"]=N(door["x"]),["z"]=N(door["z"]),["sx"]=N(door["sx"]),["sz"]=N(door["sz"])},
                    ["work"]=i==0?new JsonObject{["place"]=place,["kind"]="tavern",["at"]=new JsonArray(at.X,at.Z,Math.Atan2(ox,oz))}:new JsonObject{["place"]=place,["kind"]="roam",["route"]=new JsonArray(new JsonArray(at.X,at.Z),new JsonArray(other.X,other.Z))},
                    ["sched"]=i==0?new JsonObject{["day"]=new JsonArray(new JsonArray(6,8,"home"),new JsonArray(8,24,"work")),["sunday"]=new JsonArray(new JsonArray(6,9,"home"),new JsonArray(9,24,"work"))}:new JsonObject{["day"]=new JsonArray(new JsonArray(7,10,"work"),new JsonArray(10,14,"tavern",place),new JsonArray(14,17,"work"),new JsonArray(17,23.5,"tavern",place)),["sunday"]=new JsonArray(new JsonArray(9,12,"work"),new JsonArray(12,23,"tavern",place))},
                    ["stats"]=new JsonObject{["honesty"]=rough?2:6,["temper"]=rough?7:3,["piety"]=rough?2:5,["warmth"]=rough?2:7,["greed"]=5,["courage"]=rough?8:4,["gossip"]=7,["wealth"]=i==0?4:2},["dog"]=null});ids.Add(id);
            }
        }
        if(rows.Count==0&&A(facts["cafes"]).All(c=>town["places"]?["tavern:"+S(c,"id")]!=null))return 0;
        C.Atomic(()=>{foreach(var r in rows){string id=S(r,"id");C.Execute("INSERT OR IGNORE INTO npc(id,name,role,district,faction,persona_json,spot_id,active)VALUES($p0,$p1,$p2,'town',$p3,'{}',NULL,1)",id,S(r,"name"),S(r,"trade")=="publican"?"publican":"café regular",r["faction"]==null?null:S(r,"faction"));C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id)VALUES($p0,1)",id);C.Execute("INSERT INTO resident(id,household,trade,data_json)VALUES($p0,$p1,$p2,$p3)",id,(int)N(r["household"]),S(r,"trade"),r.ToJsonString());}town.Remove("residents");town["places"]=places;C.SetWorld("town",town);});population.Town.Clear();return rows.Count;
    }
}

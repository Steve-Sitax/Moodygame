using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Original night/givers.ts augmentation and moved-post repair, using current native house doors and navigation.</summary>
public sealed class NativeTownNightPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C=>population.Host.Context;
    private static readonly (string Id,string Spot,string Kind,double Dx,double Dz)[] givers={
        ("fence","vliet_steps","stranger",3,3),("smuggler","werf_quay","sailor_b",-3,2.5),("nightcarter","canal_west","carter",-3,-2),("cracksman","bassin_south","thief",-10.5,1.1)};
    private static string S(JsonNode? n,string key,string fallback="")=>NativeTownPopulation.S(n,key,fallback);
    private static double N(JsonNode? n)=>NativeTownPopulation.N(n);
    private static uint Hash(string s){uint h=2166136261;foreach(char ch in s)h=unchecked((h^ch)*16777619);return h;}
    public NativeTownNightPopulation(NativeTownPopulation population)=>this.population=population;
    private JsonArray? Post((string Id,string Spot,string Kind,double Dx,double Dz) giver)
    {
        var spot=population.Spots[giver.Spot];if(spot==null)return null;double sx=N(spot["x"]),sz=N(spot["z"]);var q=population.Snap(sx+giver.Dx,sz+giver.Dz,8)??population.Snap(sx,sz,12)??(sx,sz);return new JsonArray(q.Item1,q.Item2,Math.Atan2(sx-q.Item1,sz-q.Item2));
    }
    public int Ensure(uint seed)
    {
        var town=population.Snapshot();var people=town["residents"]!.AsArray();if(people.Count==0)return 0;var missing=givers.Where(g=>!people.Any(r=>S(r,"id")==g.Id)).ToArray();int moved=0;
        foreach(var g in givers){var person=people.FirstOrDefault(r=>S(r,"id")==g.Id)?.AsObject();var post=person==null?null:Post(g);if(person==null||post==null||person["work"]?["at"] is not JsonArray at||Math.Sqrt(Math.Pow(N(at[0])-N(post[0]),2)+Math.Pow(N(at[1])-N(post[1]),2))<.3)continue;person["work"]!["at"]=post;C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1",person.ToJsonString(),g.Id);moved++;}if(moved>0)population.Town.Clear();if(missing.Length==0)return 0;
        var rng=NativeTownPopulation.Random(seed^0x00074e17);var used=new HashSet<string>(people.Select(r=>S(r,"surname")));int household=people.Count==0?0:people.Max(r=>(int)N(r?["household"]));string[] firsts={"Rik","Door","Lowie","Nand","Staf","Miel","Pier","Warre"},surnames={"De Kat","Van Hool","Smet","Verhaegen","Luyckx","Beirens","Goossens","De Bie"};
        C.Atomic(()=>{foreach(var g in missing){int hh=++household;var post=Post(g);if(post==null)continue;var door=population.Doors.OrderBy(d=>Math.Sqrt(Math.Pow(N(d["sx"])-N(post[0]),2)+Math.Pow(N(d["sz"])-N(post[1]),2))).FirstOrDefault();if(door==null)continue;string first=firsts[(int)((Hash(g.Id)+(uint)Math.Floor(rng()*firsts.Length))%(uint)firsts.Length)],surname=surnames.FirstOrDefault(s=>!used.Contains(s))??surnames[Hash(g.Id)%(uint)surnames.Length];used.Add(surname);var trade=population.Facts["TRADES"]![g.Id]!;var schedule=new JsonArray(new JsonArray(21,29,"work"));var person=new JsonObject{["id"]=g.Id,["first"]=first,["surname"]=surname,["name"]=first+" "+surname,["age"]=30+(int)Math.Floor(rng()*22),["sex"]="m",["household"]=hh,["family_role"]="lodger",["trade"]=g.Id,["faction"]=trade["faction"]?.DeepClone(),["kind"]=g.Kind,["home"]=new JsonObject{["house"]=door["house"]!.DeepClone(),["x"]=door["x"]!.DeepClone(),["z"]=door["z"]!.DeepClone(),["sx"]=door["sx"]!.DeepClone(),["sz"]=door["sz"]!.DeepClone()},["work"]=new JsonObject{["place"]=g.Spot,["kind"]="post",["at"]=post},["sched"]=new JsonObject{["day"]=schedule,["sunday"]=schedule.DeepClone()},["stats"]=new JsonObject{["honesty"]=2,["temper"]=5,["piety"]=1,["warmth"]=4,["greed"]=7,["courage"]=6,["gossip"]=3,["wealth"]=3},["dog"]=null};
            // Existing NPC metadata/memories stay intact on an older save with a missing resident record.
            C.Execute("INSERT OR IGNORE INTO npc(id,name,role,district,faction,persona_json,spot_id,active) VALUES($p0,$p1,$p2,'town',$p3,'{}',NULL,1)",g.Id,S(person,"name"),S(trade,"label"),S(trade,"faction"));C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,1)",g.Id);C.Execute("INSERT OR IGNORE INTO resident(id,household,trade,data_json) VALUES($p0,$p1,$p2,$p3)",g.Id,hh,g.Id,person.ToJsonString());}});population.Town.Clear();return missing.Length;
    }
}

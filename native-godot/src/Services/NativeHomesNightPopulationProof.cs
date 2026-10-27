using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

/// <summary>Original Homes/Night additions against recorded original navigation inputs. Fixtures never serve runtime gameplay.</summary>
public partial class NativeHomesNightPopulationProof : Node
{
    public override void _Ready()
    {
        try{
            var args=OS.GetCmdlineUserArgs();string output=args.Length>0?args[0]:ProjectSettings.GlobalizePath("res://proof/homes-night-population/result.json"),data=args.Length>1?args[1]:ProjectSettings.GlobalizePath("res://services/data");var oracle=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/homes-night-population.json")))!;var queries=oracle["queries"]!;var checks=new List<object>();
            void Check(string name,JsonNode? expected,JsonNode? actual){var normalized=actual==null?null:JsonNode.Parse(actual.ToJsonString());string? difference=NativePopulationProof.Difference(expected,normalized,name);checks.Add(new{name,passed=difference==null,difference});if(difference!=null){Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,JsonSerializer.Serialize(new{passed=false,checks},new JsonSerializerOptions{WriteIndented=true}));throw new InvalidOperationException(difference);}}
            JsonObject Static(string name)=>JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/"+name+".json")))!.AsObject();
            // (#220) The oracle was recorded from the original game before #134 moved these job places out of the vehicle
            // lanes; the parity replay keeps their original places (the game itself uses the moved ones).
            JsonObject OriginalSpots(JsonObject spots){foreach(var(id,x,z)in new[]{("crane_foot",-18.0,8.2),("ship_gangway",-42.0,7.6),("east_carts",50.5,8.0),("bassin_quay",160.0,30.0),("bassin_south",120.0,120.8),("werf_pontoon",-249.0,8.2),("werf_quay",-295.0,8.2),("canal_west",-87.0,100.0),("mill_yard",-138.5,345.0),("bakery_rijn_door",-3.2,77.5)})if(spots[id] is JsonObject o){o["x"]=x;o["z"]=z;}return spots;}
            foreach(var example in oracle["cases"]!.AsArray()){
                using var host=new NativeServiceHost(new NativeServiceOptions(":memory:",data,Path.Combine(Path.GetDirectoryName(output)!,"isolated-saves")));var town=new NativeTown(host);var population=new NativeTownPopulation(host,town,city:Static("city"),buildings:Static("city_build"),kept:Static("inworld_houses"),spots:OriginalSpots(Static("spots")),houseDoors:oracle["doors"]!.AsArray().Select(d=>d!.AsObject()).ToArray());
                string Key(params double[] numbers)=>string.Join(",",numbers.Select(n=>Math.Floor(n*1000000+.5).ToString(System.Globalization.CultureInfo.InvariantCulture)));JsonNode? Query(string name,params double[] numbers){string key=Key(numbers);var dictionary=queries[name]!.AsObject();if(!dictionary.ContainsKey(key))throw new InvalidOperationException("Unrecorded original Homes/Night navigation query "+name+":"+key);return dictionary[key];}
                population.Snap=(x,z,max)=>Query("nearestOpen",x,z,max) is {} q?(NativeTown.N(q["x"]),NativeTown.N(q["z"])):null;population.Open=(x,z,r)=>Query("open",x,z,r)!.GetValue<bool>();population.Reachable=(x,z)=>Query("reachable",x,z)!.GetValue<bool>();population.Flags=(x,z)=>(int)NativeTown.N(Query("flags",x,z));
                host.Context.Execute("PRAGMA foreign_keys=OFF");host.Context.Atomic(()=>{foreach(string table in new[]{"resident","npc_memory","npc_relationship","npc","job","world_event_who","world_event","log"})host.Context.Execute("DELETE FROM "+table);foreach(string key in new[]{"homes","press","poesje:door","night_board"})host.Context.Execute("DELETE FROM world_state WHERE key=$p0",key);host.Context.SetWorld("town",example!["beforeWorld"]);foreach(var person in example["before"]!["residents"]!.AsArray())population.AddResident(person!.DeepClone().AsObject());host.Context.SetWorld("press",example["press"]);});host.Context.Execute("PRAGMA foreign_keys=ON");town.Clear();
                uint seed=(uint)NativeTown.N(example?["seed"]);string label=seed+":"+NativeTown.S(example,"size");var homes=new NativeTownHomesPopulation(population);var added=homes.Ensure(seed);Check("original home additions "+label,example!["added"],added);Check("original homes/private people "+label,example["homed"],population.Snapshot());Check("original home door/landlord/dealer definitions "+label,example["homes"],host.Context.World("homes"));Check("original landlord/dealer metadata "+label,example["homeRoles"],host.Context.Rows("SELECT id,name,role,district,faction FROM npc WHERE id IN('dealer','widow_landlady') ORDER BY id"));var beforeHomes=population.Snapshot().DeepClone();homes.Ensure(seed);Check("saved homes remain unchanged "+label,beforeHomes,population.Snapshot());
                var night=new NativeTownNightPopulation(population);Check("original night addition count "+label,example["nightAdded"],JsonValue.Create(night.Ensure(seed)));Check("original night private residents/posts "+label,example["nighted"],population.Snapshot());Check("original night NPC metadata "+label,example["nightRoles"],host.Context.Rows("SELECT id,name,role,district,faction FROM npc WHERE id IN('fence','smuggler','nightcarter','cracksman') ORDER BY id"));var beforeNight=population.Snapshot().DeepClone();night.Ensure(seed);Check("saved night people remain unchanged "+label,beforeNight,population.Snapshot());
                var dealer=town.Resident("dealer")!.DeepClone().AsObject();dealer["first"]="Door";dealer["name"]="Door "+NativeTown.S(dealer,"surname");host.Context.Execute("UPDATE resident SET data_json=$p0 WHERE id='dealer'",dealer.ToJsonString());town.Clear();homes.Ensure(seed);Check("older Door dealer becomes Dolf "+label,JsonValue.Create("Dolf"),town.Resident("dealer")?["first"]);Check("renamed dealer shop label "+label,host.Context.World("homes")?["dealer"]?["label"],host.Context.World("town")?["places"]?["dealer_shop"]?["label"]);
                var giver=town.Resident("cracksman")!.DeepClone().AsObject();var old=giver["work"]!["at"]!.AsArray();old[0]=NativeTown.N(old[0])+1;host.Context.Execute("UPDATE resident SET data_json=$p0 WHERE id='cracksman'",giver.ToJsonString());town.Clear();night.Ensure(seed);Check("older moved night post repaired "+label,example["nighted"]!["residents"]!.AsArray().First(r=>NativeTown.S(r,"id")=="cracksman")!["work"]!["at"],town.Resident("cracksman")?["work"]?["at"]);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,JsonSerializer.Serialize(new{passed=true,checks},new JsonSerializerOptions{WriteIndented=true}));GD.Print($"native Homes/Night population proof: {checks.Count} checks passed; {output}");GetTree().Quit();
        }catch(Exception error){GD.PushError(error.ToString());GetTree().Quit(1);}
    }
}


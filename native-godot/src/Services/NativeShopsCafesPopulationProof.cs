using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeShopsCafesPopulationProof : Node
{
    public override void _Ready()
    {
        try{
            var args=OS.GetCmdlineUserArgs();string output=args.Length>0?args[0]:ProjectSettings.GlobalizePath("res://proof/shop-population/result.json"),data=args.Length>1?args[1]:ProjectSettings.GlobalizePath("res://services/data");var oracle=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/shop-population.json")))!;var queries=oracle["queries"]!;var checks=new List<object>();
            void Check(string name,JsonNode? expected,JsonNode? actual){var normalized=actual==null?null:JsonNode.Parse(actual.ToJsonString());string? difference=NativePopulationProof.Difference(expected,normalized,name);checks.Add(new{name,passed=difference==null,difference});if(difference!=null){Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,JsonSerializer.Serialize(new{passed=false,checks},new JsonSerializerOptions{WriteIndented=true}));throw new InvalidOperationException(difference);}}
            JsonObject Static(string name)=>JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/"+name+".json")))!.AsObject();
            foreach(var example in oracle["cases"]!.AsArray()){
                using var host=new NativeServiceHost(new NativeServiceOptions(":memory:",data,Path.Combine(Path.GetDirectoryName(output)!,"isolated-saves")));var town=new NativeTown(host);var population=new NativeTownPopulation(host,town,city:Static("city"),buildings:Static("city_build"),kept:Static("inworld_houses"),spots:Static("spots"),houseDoors:oracle["doors"]!.AsArray().Select(d=>d!.AsObject()).ToArray());
                string Key(params double[] numbers)=>string.Join(",",numbers.Select(n=>Math.Floor(n*1000000+.5).ToString(System.Globalization.CultureInfo.InvariantCulture)));JsonNode? Query(string name,params double[] numbers){string key=Key(numbers);var all=queries[name]!.AsObject();if(!all.TryGetPropertyValue(key,out var q))throw new InvalidOperationException("Unrecorded original shop/cafe query "+name+":"+key);return q;}population.Snap=(x,z,max)=>Query("nearestOpen",x,z,max)is{} q?(NativeTown.N(q["x"]),NativeTown.N(q["z"])):null;population.Open=(x,z,r)=>Query("open",x,z,r)!.GetValue<bool>();population.Reachable=(x,z)=>Query("reachable",x,z)!.GetValue<bool>();population.Flags=(x,z)=>(int)NativeTown.N(Query("flags",x,z));
                host.Context.Execute("PRAGMA foreign_keys=OFF");host.Context.Atomic(()=>{foreach(string table in new[]{"resident","npc_memory","npc_relationship","npc","job","world_event_who","world_event","log"})host.Context.Execute("DELETE FROM "+table);foreach(string key in new[]{"shops_m7","homes","press","poesje:door","veloshop","cartshop","emigrants"})host.Context.Execute("DELETE FROM world_state WHERE key=$p0",key);host.Context.SetWorld("town",example!["beforeWorld"]);foreach(var person in example["before"]!["residents"]!.AsArray())population.AddResident(person!.DeepClone().AsObject());});host.Context.Execute("PRAGMA foreign_keys=ON");town.Clear();Check("original input and runtime anchors "+example!["seed"]+":"+example["size"],example["before"],population.Snapshot());
                uint seed=(uint)NativeTown.N(example?["seed"]);string label=seed+":"+NativeTown.S(example,"size");var shops=new NativeTownShopsPopulation(population);Check("original shops count "+label,example!["added"],shops.Ensure(seed));Check("original shops/private residents "+label,example["shopped"],population.Snapshot());Check("original persisted shops "+label,example["worldShopped"],host.Context.World("town"));Check("original shops record "+label,example["record"],host.Context.World("shops_m7"));Check("original shop NPC metadata "+label,example["shopRoles"],host.Context.Rows("SELECT id,name,role,district,faction FROM npc WHERE id LIKE 'sk_%' ORDER BY id"));var beforeShops=population.Snapshot().DeepClone();shops.Ensure(seed);Check("saved shops idempotent "+label,beforeShops,population.Snapshot());
                var cafes=new NativeTownCafesPopulation(population);Check("original cafe count "+label,example["cafeAdded"],JsonValue.Create(cafes.Ensure(seed)));Check("original cafes/private residents "+label,example["cafed"],population.Snapshot());Check("original persisted cafes "+label,example["worldCafed"],host.Context.World("town"));Check("original cafe NPC metadata "+label,example["cafeRoles"],host.Context.Rows("SELECT id,name,role,district,faction FROM npc WHERE id LIKE 'cafe_%' ORDER BY id"));var beforeCafes=population.Snapshot().DeepClone();cafes.Ensure(seed);Check("saved cafes idempotent "+label,beforeCafes,population.Snapshot());
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,JsonSerializer.Serialize(new{passed=true,checks},new JsonSerializerOptions{WriteIndented=true}));GD.Print($"native shop/cafe population proof: {checks.Count} checks passed; {output}");GetTree().Quit();
        }catch(Exception error){GD.PushError(error.ToString());GetTree().Quit(1);}
    }
}

using Scheldemist.Native.Services;
using System.Text.Json.Nodes;
long now=10000;
var output=Path.GetFullPath(args[0]);var checks=new List<object>();
using var host=new NativeServiceHost(new NativeServiceOptions(Path.Combine(output,"game.sqlite"),args[1],Path.Combine(output,"saves"),()=>now));
var access=new NativeRuienAccess(host,new[]{"keeper"});host.AddModule(access);
async Task<JsonNode> Call(string method,string path,object? body=null)=>JsonNode.Parse(await host.Call(method,path,body==null?null:System.Text.Json.JsonSerializer.Serialize(body)))!;
void Check(string name,bool pass){checks.Add(new{name,pass});Console.WriteLine($"{name}: {pass}");if(!pass)throw new Exception(name);}
Check("new hatch closed",!(await Call("GET","api/ruien/hatches/keeper"))["open"]!.GetValue<bool>());
await Call("POST","api/ruien/hatches/keeper",new{open=true});
await Call("POST","api/save",new{slot="slot1",label="Ruien access proof"});
await Call("POST","api/ruien/hatches/keeper",new{open=false});
Check("explicit close",!(await Call("GET","api/ruien/hatches/keeper"))["open"]!.GetValue<bool>());
await Call("POST","api/load",new{slot="slot1"});
Check("save/load restores open lid",(await Call("GET","api/ruien/hatches/keeper"))["open"]!.GetValue<bool>());
try{await Call("POST","api/ruien/hatches/keeper",new{open="yes"});Check("invalid state refused",false);}catch(NativeServiceException e){Check("invalid state refused",e.Status==400);}
try{await Call("GET","api/ruien/hatches/missing");Check("unknown hatch refused",false);}catch(NativeServiceException e){Check("unknown hatch refused",e.Status==404);}
await Call("POST","api/ruien/hatches/keeper",new{open=false});
access.WorkRoutes["keeper"]=Enumerable.Range(0,24).Select(i=>new NativeRuienAccess.Point(0,i<20?-i*.18:-3.6,i*.30)).ToArray();
await Call("GET","api/ruien/crew");
Check("workman opens lid",(await Call("GET","api/ruien/hatches/keeper"))["workman_passing"]!.GetValue<bool>());
var before=await Call("GET","api/ruien/crew");
now+=1000;var waiting=await Call("GET","api/ruien/crew");
Check("workman waits for hinge swing",waiting[0]!["z"]!.GetValue<double>()==before[0]!["z"]!.GetValue<double>());
JsonNode crew=waiting;for(int i=0;i<22;i++){now+=500;crew=await Call("GET","api/ruien/crew");}
Check("workman walks native flight",crew[0]!["z"]!.GetValue<double>()>1&&crew[0]!["y"]!.GetValue<double>()<-.5);
await Call("POST","api/save",new{slot="slot2"});var saved=host.Context.World("ruien_crew:keeper:0")!.DeepClone();
for(int i=0;i<10;i++){now+=500;await Call("GET","api/ruien/crew");}
await Call("POST","api/load",new{slot="slot2"});Check("crew route progress saved",JsonNode.DeepEquals(saved,host.Context.World("ruien_crew:keeper:0")));
File.WriteAllText(Path.Combine(output,"result.json"),System.Text.Json.JsonSerializer.Serialize(checks,new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));

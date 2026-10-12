using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Town;

namespace Scheldemist.People;

/// <summary>Market-day extra stalls, their sellers and shoppers, using native model geometry and source rules.</summary>
[GamePart(214)]
public partial class NativeMarket : Node
{
    public static NativeMarket? I {get;private set;}
    private Townspeople town=null!;
    private JsonObject definitions=null!;
    private NativeMarketLayout layout=null!;
    private readonly List<Field> fields=new();
    private readonly Dictionary<(string Source,string Name),List<ModelPart>> parts=new();
    private readonly Dictionary<(string Source,string Name),double[]> modelPoints=new();
    private readonly Dictionary<string,Material> materials=new();
    private readonly Dictionary<Material,Material> coloured=new();
    private readonly Dictionary<Puppet,Browser> browsing=new();
    private readonly Dictionary<Puppet,string> netIds=new();
    private readonly HashSet<string> openKeepers=new();
    private readonly Dictionary<string,double> soldOut=new();
    private readonly HashSet<string> emptyShelves=new();
    private readonly Random random=new();
    private double think,tradePoll;
    private bool built,adopted,polling,dead;
    private int revision;
    private sealed record ModelPart(Mesh Mesh,Transform3D Local,string Material);
    private sealed class Field
    {
        public JsonObject Definition=null!;
        public string Place="";
        public NativeMarketPoint Centre;
        public NativeMarketPoint[] Entries=Array.Empty<NativeMarketPoint>();
        public Node3D Group=null!;
        public List<NativeMarketItem> Items=new();
        public readonly List<Batch> Batches=new();
        public readonly Dictionary<NativeMarketItem,SellerDrawn> Sellers=new();
        public readonly Dictionary<NativeMarketItem,StaticBody3D[]> Bodies=new();
        public readonly List<Puppet> Shoppers=new();
        public int Low=-1,High=-1;
        public bool On;
    }
    private sealed class SellerDrawn {public Puppet Body=null!;public double Talk;public bool Fled;}
    private sealed class Batch {public MultiMesh Mesh=null!;public MultiMeshInstance3D Node=null!;public readonly List<(int Rank,Transform3D Transform,Color Tint)> Rows=new();}
    private sealed class Target : NativeMarketTarget {public Field? Field;public NativeMarketItem? Item;}
    private sealed class Browser : NativeMarketBrowser {}
    public int Items=>fields.Sum(f=>f.Items.Count);
    public int Up=>fields.Sum(f=>Math.Max(0,f.High-f.Low));
    public int Shoppers=>fields.Sum(f=>f.Shoppers.Count);
    public int Sellers=>fields.Sum(f=>f.Sellers.Count);
    public JsonArray Inspect()=>new(fields.Select(f=>(JsonNode?)new JsonObject{
        ["place"]=f.Place,["items"]=f.Items.Count,["up"]=Math.Max(0,f.High-f.Low),["on"]=f.On,["sellers"]=f.Sellers.Count,["shoppers"]=f.Shoppers.Count,["meshes"]=f.Batches.Count,
        ["emptyShelf"]=emptyShelves.Contains(f.Place),["soldOutAt"]=soldOut.TryGetValue(f.Place+":"+town.Day,out var soldAt)?JsonValue.Create(soldAt):null,
        ["colliders"]=f.Bodies.Values.SelectMany(b=>b).Count(b=>b.CollisionLayer!=0),
        ["people"]=new JsonArray(f.Shoppers.Select(p=>(JsonNode?)new JsonObject{["id"]=p.Group.GetInstanceId().ToString(),["kind"]=p.Kind,["x"]=p.X,["z"]=p.Z,["phase"]=browsing.GetValueOrDefault(p)?.Phase,["motion"]=p.Human.Motion,["bought"]=p.Bought}).ToArray()),
        ["fronts"]=new JsonArray(f.Items.Where(i=>i.Rank>=f.Low&&i.Rank<f.High).Select(i=>(JsonNode?)new JsonObject{["kind"]=i.Kind,["goods"]=i.Goods,["x"]=i.Front.X,["z"]=i.Front.Z,["yaw"]=i.Yaw}).ToArray())
    }).ToArray());
    public override void _Ready(){I=this;town=Main.I.GetNode<Townspeople>("Townspeople");town.PopulationChanged+=Reset;town.MarketBrowse=Browse;town.MarketForget=Forget;PrepareMaterials();}
    private static double N(JsonNode? n)=>n?.GetValue<double>()??0;
    private static string S(JsonNode? n)=>n?.GetValue<string>()??"";
    private static double Distance(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    private double R(double low,double high)=>low+random.NextDouble()*(high-low);
    private T Pick<T>(IReadOnlyList<T> list)=>list[random.Next(list.Count)];
    private static NativeMarketRect Rect(JsonNode n)=>new(N(n["minX"]),N(n["maxX"]),N(n["minZ"]),N(n["maxZ"]));
    private static bool OthersSee(double x,double z){if(Together.I is not{On:true} t)return false;return t.Roster.Any(r=>r.Id!=t.PlayerId&&t.PlayerAt(r.Id)is{} p&&Distance(x,z,p.X,p.Z)<45);}
    private static double Nearest(double x,double z){var me=Main.I.Cam.GlobalPosition;double result=Distance(x,z,me.X,me.Z);if(Together.I is{} t)foreach(var r in t.Roster)if(r.Id!=t.PlayerId&&t.PlayerAt(r.Id)is{} p)result=Math.Min(result,Distance(x,z,p.X,p.Z));return result;}
    private void Reset()
    {
        revision++;polling=false;built=false;think=tradePoll=0;
        foreach(var f in fields){foreach(var p in f.Shoppers.ToArray())Drop(p,true);foreach(var s in f.Sellers.Values)town.Crowd?.RemovePuppet(s.Body);f.Group.Visible=false;foreach(var bs in f.Bodies.Values)foreach(var b in bs){b.Visible=false;b.CollisionLayer=0;}f.Group.QueueFree();foreach(var b in f.Batches)b.Mesh.Dispose();}
        fields.Clear();browsing.Clear();netIds.Clear();soldOut.Clear();emptyShelves.Clear();openKeepers.Clear();
    }
    public override void _Process(double dt)
    {
        if(town.Data==null||town.Walk==null||town.Crowd==null||town.Paused)return;if(!built)Build();dt=Math.Min(dt,.1);
        if(!adopted&&NativeExtras.I is{} network){adopted=true;network.OnAdopt("x:ms:",(id,p)=>{var f=fields.OrderBy(f=>Distance(p.X,p.Z,f.Centre.X,f.Centre.Z)).FirstOrDefault();if(f==null)return false;f.Shoppers.Add(p);netIds[p]=id;var b=new Browser{Place=f.Place,Phase=f.On?"pick":"gone",Time=1,Want=1+random.Next(2),Own=true};browsing[p]=b;if(!f.On)Leave(p,b,f);return true;});}
        if((tradePoll-=dt)<=0){tradePoll=15;_=PollTrade();}
        bool now=(think-=dt)<=0;if(now){think=.5;openKeepers.Clear();if(MarketStalls.I is{} keepers)foreach(var s in keepers.List)if(s.Open)openKeepers.Add(s.Keeper);}
        var me=Main.I.Cam.GlobalPosition;
        foreach(var f in fields){
            string soldKey=f.Place+":"+town.Day;if(now&&!soldOut.ContainsKey(soldKey)&&emptyShelves.Contains(f.Place)&&Share(f.Place,town.Day,town.Hour)>0)soldOut[soldKey]=town.Hour;
            double share=Share(f.Place,town.Day,town.Hour,soldOut.GetValueOrDefault(soldKey,double.NaN));int count=f.Items.Count;bool rising=town.Hour<12;
            int high=share>0?(rising?(int)Math.Floor(share*count+1e-6):count):0,low=share>0?(rising?0:count-(int)Math.Floor(share*count+1e-6)):0;Window(f,low,Math.Max(low,high));
            double distance=Distance(me.X,me.Z,f.Centre.X,f.Centre.Z);f.Group.Visible=distance<140;f.On=Share(f.Place,town.Day,town.Hour)>=.25&&town.StormLevel<=.3;
            if(now){DrawSellers(f,distance,me);MakeShoppers(f,distance,me);}StepSellers(f,dt);
        }
        foreach(var pair in browsing.ToArray()){if(!town.Crowd.Alive(pair.Key)){browsing.Remove(pair.Key);continue;}if(pair.Value.Own)StepBrowser(pair.Key,pair.Value,dt);}
    }
    private async System.Threading.Tasks.Task PollTrade()
    {
        var api=ServerLink.I?.Api;if(polling||api==null||dead)return;polling=true;int at=revision;
        try{var data=await api.Get<JsonElement>("api/trade");if(at!=revision||dead)return;emptyShelves.Clear();if(data.TryGetProperty("posts",out var posts))foreach(var p in posts.EnumerateArray())if(p.TryGetProperty("id",out var id)&&p.GetProperty("stock").GetDouble()<=p.GetProperty("floor").GetDouble())emptyShelves.Add(id.GetString()!);}
        catch(ApiException){}finally{if(at==revision)polling=false;}
    }
    public override void _ExitTree(){dead=true;Reset();town.PopulationChanged-=Reset;if(town.MarketBrowse==Browse)town.MarketBrowse=null;if(town.MarketForget==Forget)town.MarketForget=null;NativeExtras.I?.OffAdopt("x:ms:");foreach(var mesh in parts.Values.SelectMany(p=>p).Select(p=>p.Mesh).Distinct())mesh.Dispose();foreach(var m in coloured.Values)m.Dispose();if(I==this)I=null;}
}

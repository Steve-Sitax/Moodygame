using System;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Net.Mp;
using Scheldemist.Town;
namespace Scheldemist.People;
[GamePart(213)]
public partial class NativeSteenVisitors : Node
{
    public static NativeSteenVisitors? I {get;private set;}
    private readonly NativeSteenRules rules=new();
    private readonly NativeSteenContext context=new();
    private readonly Random random=new();
    private Townspeople town=null!;
    private bool adopted;
    public int Count=>rules.Visitors.Count;
    public int Outside=>rules.Visitors.Count(v=>v.State!="inside");
    public JsonArray Inspect()=>new(rules.Visitors.Select(v=>(JsonNode?)new JsonObject{["kind"]=v.Kind,["state"]=v.State,["id"]=v.Id,["x"]=v.Body?.X,["z"]=v.Body?.Z,["age"]=v.Age,["goesIn"]=v.GoesIn,["look"]=new JsonArray(v.Look.X,v.Look.Z),["to"]=new JsonArray(v.To.X,v.To.Z),["motion"]=v.Body?.Tag is Puppet p?p.Human.Motion:null,["busy"]=v.Body?.Tag is Puppet b&&town.Crowd?.PuppetBusy(b)==true}).ToArray());
    public override void _Ready(){I=this;town=Main.I.GetNode<Townspeople>("Townspeople");town.PopulationChanged+=Reset;context.Random=random.NextDouble;context.Hidden=(x,z)=>town.Crowd!.IsHidden(x,z);context.SeenByOthers=OthersSee;context.NearestPlayer=Nearest;context.RunGroup=()=>NativeExtras.I?.RunAnimal("g:st",-185,-12,75)!=false;
        context.Alive=b=>b.Tag is Puppet p&&town.Crowd!.Alive(p);context.Busy=b=>b.Tag is Puppet p&&town.Crowd!.PuppetBusy(p);context.Add=(kind,x,z,yaw,pace)=>town.Crowd!.AddPuppet(kind,x,z,yaw,pace)is{} p?new(){X=p.X,Z=p.Z,Tag=p}:null;
        context.Go=(b,x,z,pace)=>town.Crowd!.PuppetGo((Puppet)b.Tag!,x,z,pace);context.Stand=(b,m,yaw)=>town.Crowd!.PuppetStand((Puppet)b.Tag!,m,yaw);context.Remove=b=>town.Crowd!.RemovePuppet((Puppet)b.Tag!);context.NewId=kind=>Together.I?.On==true?NativeExtras.I?.NewId("sv",kind):null;context.Person=(id,b)=>NativeExtras.I?.Person(id,(Puppet)b.Tag!);context.Release=(id,ended)=>{if(ended)NativeExtras.I?.PersonGone(id);else NativeExtras.I?.Release(id);};
    }
    private static double Dist(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    private static bool OthersSee(double x,double z){if(Together.I is not{On:true} t)return false;return t.Roster.Any(r=>r.Id!=t.PlayerId&&t.PlayerAt(r.Id)is{} p&&Dist(x,z,p.X,p.Z)<45);}
    private static double Nearest(double x,double z){var me=Main.I.Cam.GlobalPosition;double min=Dist(x,z,me.X,me.Z);if(Together.I is{} t)foreach(var r in t.Roster)if(r.Id!=t.PlayerId&&t.PlayerAt(r.Id)is{} p)min=Math.Min(min,Dist(x,z,p.X,p.Z));return min;}
    private void Reset()=>rules.Reset(context);
    public override void _Process(double delta)
    {
        if(town.Crowd==null||town.Data==null||town.Paused)return;var crowd=town.Crowd;
        if(!adopted&&NativeExtras.I is{} share){adopted=true;share.OnAdopt("x:sv:",(id,p)=>{var goal=NativeSteenRules.Ends[random.Next(NativeSteenRules.Ends.Length)];crowd.PuppetGo(p,goal.X,goal.Z);rules.Visitors.Add(new(){Id=id,Kind=id.Split(':')[2],Body=new(){X=p.X,Z=p.Z,Tag=p},State="leaving",Look=goal});return true;});}
        foreach(var v in rules.Visitors)if(v.Body?.Tag is Puppet p){v.Body.X=p.X;v.Body.Z=p.Z;}var me=Main.I.Cam.GlobalPosition;context.Multiplayer=Together.I?.On==true;rules.Frame(Math.Min(delta,.1),town.Hour>=10&&town.Hour<16,Dist(me.X,me.Z,-185,-12)<90,me.X,me.Z,context);
        foreach(var v in rules.Visitors)if(v.Body?.Tag is Puppet p){p.X=v.Body.X;p.Z=v.Body.Z;}
    }
    public override void _ExitTree(){Reset();NativeExtras.I?.OffAdopt("x:sv:");town.PopulationChanged-=Reset;if(I==this)I=null;}
}

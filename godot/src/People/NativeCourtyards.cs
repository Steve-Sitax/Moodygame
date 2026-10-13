using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Net.Mp;
using Scheldemist.Town;

namespace Scheldemist.People;

[GamePart(207)]
public partial class NativeCourtyards : Node
{
    public static NativeCourtyards? I { get; private set; }
    private Townspeople town=null!;
    private readonly Dictionary<string, Stack<SmallLifeKit.Actor>> pool = new();
    public double LogicMs { get; private set; }
    private readonly List<Drawn> animals=new();
    private readonly Random rng=new();
    private Func<double> random=null!;
    private Func<double,double,double,bool> free=null!;
    private readonly List<(double X,double Z,double Radius)> clear=new();
    private readonly List<(double MinX,double MaxX,double MinZ,double MaxZ)> lanes=new();
    private bool built;
    private sealed class Drawn{public NativeCourtAnimal State=null!;public Node3D Body=null!;public SmallLifeKit.Actor Skin=null!;public double Distance;public float Size=1;}
    public int Hens=>animals.Count(a=>a.State.Kind=="hen");
    public int Goats=>animals.Count(a=>a.State.Kind=="goat");
    public IEnumerable<(string Id,string Kind,double X,double Z,Node3D Body)> List=>animals.Select(a=>(a.State.Id,a.State.Kind,a.State.X,a.State.Z,a.Body));
    public override void _Ready(){I=this;town=Main.I.GetNode<Townspeople>("Townspeople");town.PopulationChanged+=Reset;random=rng.NextDouble;free=Free;
        foreach(var (kind,count) in new[]{("hen",18),("cockerel",6),("goat",2)}) {
            var copies=new Stack<SmallLifeKit.Actor>();pool[kind]=copies;
            for(int i=0;i<count;i++)copies.Push(new SmallLifeKit.Actor(Main.I.View,kind));
        }
    }
    private void Reset(){foreach(var a in animals){NativeExtras.I?.Release(a.State.Id);a.Body.Visible=false;pool[a.Skin.Kind].Push(a.Skin);}animals.Clear();clear.Clear();lanes.Clear();built=false;}
    private bool Open(double x,double z)=>town.Walk!.NativeCellFree((int)Math.Floor((x-town.Walk.X0)*4),(int)Math.Floor((z-town.Walk.Z0)*4));
    private bool Free(double x,double z,double radius)=>town.Walk!.Free(x,z)&&town.Walk.Free(x-radius,z)&&town.Walk.Free(x+radius,z)&&town.Walk.Free(x,z-radius)&&town.Walk.Free(x,z+radius);
    private bool Clear(double x,double z,double radius)=>clear.All(p=>Math.Sqrt(Math.Pow(x-p.X,2)+Math.Pow(z-p.Z,2))>p.Radius+radius)&&!lanes.Any(p=>x>p.MinX-radius&&x<p.MaxX+radius&&z>p.MinZ-radius&&z<p.MaxZ+radius);
    private void Build()
    {
        if(!SmallLifeKit.Ready)throw new InvalidDataException("smalllife kit missing");
        var data=town.Data!;foreach(var r in data.Residents){clear.Add((r.HomeSx,r.HomeSz,1.4));if(r.Work.Door is{} d)clear.Add((d.X,d.Z,1.4));if(r.Work.At is{Length:>=2} at)clear.Add((at[0],at[1],1.4));if(r.Work.Route!=null)foreach(var p in r.Work.Route)clear.Add((p.X,p.Z,1.6));}
        foreach(var s in data.Shops)clear.Add((s.Door.X,s.Door.Z,1.6));
        using(var spots=JsonDocument.Parse(File.ReadAllText(Paths.Shared("spots.json"))))foreach(var p in spots.RootElement.EnumerateObject())if(p.Value.ValueKind==JsonValueKind.Object&&p.Value.TryGetProperty("x",out var x)&&p.Value.TryGetProperty("z",out var z)&&x.ValueKind==JsonValueKind.Number&&z.ValueKind==JsonValueKind.Number)clear.Add((x.GetDouble(),z.GetDouble(),3));
        using(var city=JsonDocument.Parse(File.ReadAllText(Paths.Shared("city.json"))))foreach(var d in city.RootElement.GetProperty("doors").EnumerateObject())clear.Add((d.Value.GetProperty("x").GetDouble(),d.Value.GetProperty("z").GetDouble(),Math.Min(d.Value.GetProperty("width").GetDouble()/2,5)+2));
        using(var extras=JsonDocument.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot??Paths.Root,"services","native-extras.json"))))foreach(var l in extras.RootElement.GetProperty("courtLanes").EnumerateArray())lanes.Add((l.GetProperty("minX").GetDouble(),l.GetProperty("maxX").GetDouble(),l.GetProperty("minZ").GetDouble(),l.GetProperty("maxZ").GetDouble()));
        var homes=data.Residents.Where(r=>r.HomeHouse>=0).Select(r=>{double len=Math.Sqrt(Math.Pow(r.HomeSx-r.HomeX,2)+Math.Pow(r.HomeSz-r.HomeZ,2));if(len==0)len=1;return new NativeCourtHome(r.HomeHouse,r.HomeX,r.HomeZ,(r.HomeSx-r.HomeX)/len,(r.HomeSz-r.HomeZ)/len);});
        foreach(var a in NativeCourtyardRules.Make(homes,Open,Free,Clear))Make(a);built=true;
    }
    private void Make(NativeCourtAnimal a)
    {
        string kind=a.Kind=="hen"&&a.Id.EndsWith(":0",StringComparison.Ordinal)?"cockerel":a.Kind;
        if(pool[kind].Count==0)throw new InvalidOperationException("courtyard pool capacity");
        var skin=pool[kind].Pop();float size=.94f+.12f*(float)NativeCourtyardRules.H01(a.Id);
        skin.Body.Name=a.Id.Replace(':','_');
        skin.Body.Scale=Vector3.One*size;
        animals.Add(new(){State=a,Body=skin.Body,Skin=skin,Size=size});
    }
    private readonly List<(double X,double Z)> players=new(8);
    public override void _Process(double delta)
    {
        if(town.Data==null||town.Walk==null||town.Paused)return;if(!built)Build();ulong start=Time.GetTicksUsec();double dt=Math.Min(delta,.1),now=(Together.I?.ServerNow??Time.GetTicksMsec())/1000.0;var me=Main.I.Cam.GlobalPosition;players.Clear();players.Add((me.X,me.Z));
        if(Together.I is{On:true} together)foreach(var r in together.Roster)if(r.Id!=together.PlayerId&&together.PlayerAt(r.Id)is{} p)players.Add((p.X,p.Z));
        foreach(var d in animals){var a=d.State;double distance=Math.Sqrt(Math.Pow(a.X-me.X,2)+Math.Pow(a.Z-me.Z,2));d.Body.Visible=distance<45;if(!d.Body.Visible)continue;double oldX=a.X,oldZ=a.Z;bool here=NativeExtras.I?.RunAnimal(a.Id,a.X,a.Z,45)!=false;
            if(here){if(a.Kind=="hen")NativeCourtyardRules.Hen(a,dt,players,random,free);else NativeCourtyardRules.Goat(a,dt,random,free);NativeExtras.I?.PutAnimal(a.Id,new(a.X,a.Z,a.Yaw,a.Walking?"walk":a.Kind=="hen"?"peck":"graze"));}
            else if(NativeExtras.I?.Animal(a.Id)is{} s){a.X=s.X;a.Z=s.Z;a.Yaw=s.Yaw;a.Walking=s.Motion=="walk";a.Peck+=dt;if(a.Walking)a.Gait+=dt*3;}
            else{d.Body.Visible=false;continue;}
            d.Distance+=Math.Sqrt(Math.Pow(a.X-oldX,2)+Math.Pow(a.Z-oldZ,2));
            string kind=d.Skin.Kind;int flourish=(int)(now/8+NativeCourtyardRules.H01(a.Id)*20)%10;
            string motion=a.Walking?(a.Fled&&a.Kind=="hen"?"run":"walk"):a.Kind=="hen"?(flourish==0?"flap":flourish<3?"scratch":"peck"):(town.Hour>18&&flourish<3?"lie":flourish==0?"butt":flourish<4?"chew":"graze");
            var clip=SmallLifeKit.Kinds[kind].Clips[motion];
            d.Skin.Pose(motion,clip.Stride>0?d.Distance/(clip.Stride*d.Size):now/clip.Seconds+NativeCourtyardRules.H01(a.Id));
            d.Body.Position=new((float)a.X,(float)town.Walk.BaseAt(a.X,a.Z),(float)a.Z);d.Body.Rotation=new(0,(float)a.Yaw,0);
        }
        LogicMs=(Time.GetTicksUsec()-start)/1000.0;
    }
    public override void _ExitTree(){town.PopulationChanged-=Reset;Reset();foreach(var copies in pool.Values)foreach(var skin in copies)skin.Body.QueueFree();pool.Clear();if(I==this)I=null;}
}

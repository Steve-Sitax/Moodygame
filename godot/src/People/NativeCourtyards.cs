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
    private Townspeople town=null!;
    private ModelLibrary.Model? model;
    private readonly List<Drawn> animals=new();
    private readonly Random rng=new();
    private readonly List<(double X,double Z,double Radius)> clear=new();
    private readonly List<(double MinX,double MaxX,double MinZ,double MaxZ)> lanes=new();
    private bool built;
    private sealed class Drawn{public NativeCourtAnimal State=null!;public Node3D Body=null!,Head=null!;public Node3D[] Legs=Array.Empty<Node3D>();}
    public int Hens=>animals.Count(a=>a.State.Kind=="hen");
    public int Goats=>animals.Count(a=>a.State.Kind=="goat");
    public IEnumerable<(string Id,string Kind,double X,double Z,Node3D Body)> List=>animals.Select(a=>(a.State.Id,a.State.Kind,a.State.X,a.State.Z,a.Body));
    public override void _Ready(){town=Main.I.GetNode<Townspeople>("Townspeople");town.PopulationChanged+=Reset;}
    private void Reset(){foreach(var a in animals){NativeExtras.I?.Release(a.State.Id);a.Body.QueueFree();}animals.Clear();clear.Clear();lanes.Clear();built=false;}
    private bool Open(double x,double z)=>town.Walk!.NativeCellFree((int)Math.Floor((x-town.Walk.X0)*4),(int)Math.Floor((z-town.Walk.Z0)*4));
    private bool Free(double x,double z,double radius)=>town.Walk!.Free(x,z)&&town.Walk.Free(x-radius,z)&&town.Walk.Free(x+radius,z)&&town.Walk.Free(x,z-radius)&&town.Walk.Free(x,z+radius);
    private bool Clear(double x,double z,double radius)=>clear.All(p=>Math.Sqrt(Math.Pow(x-p.X,2)+Math.Pow(z-p.Z,2))>p.Radius+radius)&&!lanes.Any(p=>x>p.MinX-radius&&x<p.MaxX+radius&&z>p.MinZ-radius&&z<p.MaxZ+radius);
    private void Build()
    {
        model=ModelLibrary.Get("lively",new(TwoSided:true,VertexColor:true));if(model==null){built=true;return;}
        var data=town.Data!;foreach(var r in data.Residents){clear.Add((r.HomeSx,r.HomeSz,1.4));if(r.Work.Door is{} d)clear.Add((d.X,d.Z,1.4));if(r.Work.At is{Length:>=2} at)clear.Add((at[0],at[1],1.4));if(r.Work.Route!=null)foreach(var p in r.Work.Route)clear.Add((p.X,p.Z,1.6));}
        foreach(var s in data.Shops)clear.Add((s.Door.X,s.Door.Z,1.6));
        using(var spots=JsonDocument.Parse(File.ReadAllText(Paths.Shared("spots.json"))))foreach(var p in spots.RootElement.EnumerateObject())if(p.Value.ValueKind==JsonValueKind.Object&&p.Value.TryGetProperty("x",out var x)&&p.Value.TryGetProperty("z",out var z)&&x.ValueKind==JsonValueKind.Number&&z.ValueKind==JsonValueKind.Number)clear.Add((x.GetDouble(),z.GetDouble(),3));
        using(var city=JsonDocument.Parse(File.ReadAllText(Paths.Shared("city.json"))))foreach(var d in city.RootElement.GetProperty("doors").EnumerateObject())clear.Add((d.Value.GetProperty("x").GetDouble(),d.Value.GetProperty("z").GetDouble(),Math.Min(d.Value.GetProperty("width").GetDouble()/2,5)+2));
        using(var extras=JsonDocument.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot??Paths.Root,"services","native-extras.json"))))foreach(var l in extras.RootElement.GetProperty("courtLanes").EnumerateArray())lanes.Add((l.GetProperty("minX").GetDouble(),l.GetProperty("maxX").GetDouble(),l.GetProperty("minZ").GetDouble(),l.GetProperty("maxZ").GetDouble()));
        var homes=data.Residents.Where(r=>r.HomeHouse>=0).Select(r=>{double len=Math.Sqrt(Math.Pow(r.HomeSx-r.HomeX,2)+Math.Pow(r.HomeSz-r.HomeZ,2));if(len==0)len=1;return new NativeCourtHome(r.HomeHouse,r.HomeX,r.HomeZ,(r.HomeSx-r.HomeX)/len,(r.HomeSz-r.HomeZ)/len);});
        foreach(var a in NativeCourtyardRules.Make(homes,Open,Free,Clear))Make(a);built=true;
    }
    private Node3D? Part(string name){var p=model!.Copy(name);if(p!=null)p.Position=Vector3.Zero;return p;}
    private void Make(NativeCourtAnimal a)
    {
        var body=Part(a.Kind+"_body");var head=Part(a.Kind+"_head");int count=a.Kind=="hen"?2:4;var legs=new Node3D[count];for(int i=0;i<count;i++)legs[i]=Part(a.Kind+"_leg")!;
        if(body==null||head==null||legs.Any(p=>p==null)){body?.Free();head?.Free();foreach(var p in legs)p?.Free();return;}
        var group=new Node3D{Name=a.Id.Replace(':','_')};group.AddChild(body);head.Position=a.Kind=="hen"?new(0,.34f,.1f):new(0,.72f,.4f);group.AddChild(head);
        for(int i=0;i<count;i++){legs[i].Position=a.Kind=="hen"?new(i==0?-.04f:.04f,.17f,0):new(i%2==0?-.1f:.1f,.5f,i<2?.3f:-.32f);group.AddChild(legs[i]);}
        Main.I.View.AddChild(group);animals.Add(new(){State=a,Body=group,Head=head,Legs=legs});
    }
    public override void _Process(double delta)
    {
        if(town.Data==null||town.Walk==null||town.Paused)return;if(!built)Build();double dt=Math.Min(delta,.1),now=(Together.I?.ServerNow??Time.GetTicksMsec());var me=Main.I.Cam.GlobalPosition;var players=new List<(double X,double Z)>{(me.X,me.Z)};
        if(Together.I is{On:true} together)foreach(var r in together.Roster)if(r.Id!=together.PlayerId&&together.PlayerAt(r.Id)is{} p)players.Add((p.X,p.Z));
        foreach(var d in animals){var a=d.State;double distance=Math.Sqrt(Math.Pow(a.X-me.X,2)+Math.Pow(a.Z-me.Z,2));d.Body.Visible=distance<45;if(!d.Body.Visible)continue;bool here=NativeExtras.I?.RunAnimal(a.Id,a.X,a.Z,45)!=false;
            if(here){if(a.Kind=="hen")NativeCourtyardRules.Hen(a,dt,players,rng.NextDouble,Free);else NativeCourtyardRules.Goat(a,dt,rng.NextDouble,Free);NativeExtras.I?.PutAnimal(a.Id,new(a.X,a.Z,a.Yaw,a.Walking?"walk":a.Kind=="hen"?"peck":"graze"));}
            else if(NativeExtras.I?.Animal(a.Id)is{} s){a.X=s.X;a.Z=s.Z;a.Yaw=s.Yaw;a.Walking=s.Motion=="walk";a.Peck+=dt;if(a.Walking)a.Gait+=dt*3;}
            else{d.Body.Visible=false;continue;}
            float step=a.Walking?(float)(a.Kind=="hen"?Math.Sin(now/70)*.5:Math.Sin(a.Gait*Math.Tau)*.22):0;for(int i=0;i<d.Legs.Length;i++)d.Legs[i].Rotation=new((i==0||i==3?1:-1)*step,0,0);
            float head=a.Kind=="hen"?(float)(!a.Walking?Math.Pow(Math.Max(0,Math.Sin(a.Peck*5)),3)*1.2:0):a.Walking||distance<4?0:(float)(.9+Math.Sin(now/900)*.15);d.Head.Rotation=new(head,0,0);
            d.Body.Position=new((float)a.X,(float)town.Walk.BaseAt(a.X,a.Z)+(a.Kind=="hen"&&a.Walking?Math.Abs(step)*.02f:0),(float)a.Z);d.Body.Rotation=new(0,(float)a.Yaw,0);
        }
    }
    public override void _ExitTree(){town.PopulationChanged-=Reset;Reset();}
}

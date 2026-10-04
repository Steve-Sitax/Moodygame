using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.Town;
namespace Scheldemist.People;

/// <summary>The browser's prisonHall.ts rounds and exercise ring, driven by the real prison roster.</summary>
[GamePart(233)]
public partial class PrisonPeople:Node
{
    public static PrisonPeople? I {get;private set;}
    public sealed class Slot
    {public string Id="",On="",Motion="";public Human Human=null!;public Node3D Root=null!;public LocalRound Round=null!;public float Y,Yaw,Seat;}
    private sealed class RingMan {public Human Human=null!;public Node3D Root=null!;public float Angle;}
    public readonly List<Slot> Figures=new();private readonly List<RingMan> ringers=new(10);
    public PrisonView? State {get;private set;}public string? Visitor {get;private set;}
    public HallPeople.Hall Floor {get;private set;}=null!;public Transform3D Frame=>frame;
    public int RingCount {get;private set;}public int ActionArrivals {get;private set;}
    private JsonDocument data=null!;private Transform3D frame;private float ringX,ringZ,ringR;
    private double poll;private bool polling;private int epoch;
    private Func<Actors.Run,double,bool>? previousRoom;private Townspeople town=null!;
    private sealed class RoomActor {public Human Human=null!;public Node3D Root=null!;public readonly Queue<Vector3> Path=new();public Vector3 Goal;public bool Reported;}
    private readonly Dictionary<long,RoomActor> roomActors=new();private readonly List<long> ended=new();
    public override void _Ready()
    {
        I=this;town=GetParent().GetNode<Townspeople>("Townspeople");data=JsonDocument.Parse(PrisonData.Json);var d=data.RootElement;var origin=d.GetProperty("origin");frame=new(new Basis(Vector3.Up,d.GetProperty("yaw").GetSingle()),new(origin.GetProperty("x").GetSingle(),0,origin.GetProperty("z").GetSingle()));
        var plan=d.GetProperty("plan");var grid=plan.GetProperty("freeGrid");var rows=new List<string>();foreach(var r in grid.GetProperty("rows").EnumerateArray())rows.Add(r.GetString()!);int n=plan.GetProperty("nodes").GetArrayLength()+2,size=rows.Count*rows[0].Length;
        Floor=new(){Id="prison",Origin=frame.Origin,Yaw=d.GetProperty("yaw").GetDouble(),Plan=plan,GridRows=rows.ToArray(),RouteDistance=new float[n],RoutePrevious=new int[n],RouteUsed=new bool[n],GridDistance=new float[size],GridPrevious=new int[size],GridVisited=new int[size]};
        foreach(var spec in d.GetProperty("specs").EnumerateArray())
        {
            var h=Humans.Make(spec.GetProperty("kind").GetString()!)!;var root=new Node3D{Name="prison_"+spec.GetProperty("id").GetString(),Visible=false};Main.I.View.AddChild(root);root.AddChild(h.Root);h.Start();var routes=new List<List<(double,double)>>();
            foreach(var path in spec.GetProperty("routes").EnumerateArray()){var route=new List<(double,double)>();foreach(var p in path.EnumerateArray())route.Add((p[0].GetDouble(),p[1].GetDouble()));routes.Add(route);}var home=spec.GetProperty("home");
            Figures.Add(new(){Id=spec.GetProperty("id").GetString()!,On=spec.GetProperty("on").GetString()!,Motion=spec.GetProperty("motion").GetString()!,Y=spec.GetProperty("y").GetSingle(),Yaw=spec.GetProperty("yaw").GetSingle(),Seat=spec.GetProperty("seat").GetSingle(),Human=h,Root=root,Round=new((home[0].GetDouble(),home[1].GetDouble()),routes,spec.GetProperty("seed").GetInt32())});
        }
        string[] kinds={"docker_a","docker_b","docker_c","old_man","beggar","sailor_b","docker_c","old_man","docker_b","docker_a"};
        for(int i=0;i<10;i++){var h=Humans.Make(kinds[i])!;var root=new Node3D{Name="prison_ring_"+i,Visible=false};Main.I.View.AddChild(root);root.AddChild(h.Root);h.Start();h.SetPace(.8f);ringers.Add(new(){Human=h,Root=root,Angle=i/10f*Mathf.Tau});}
        var ring=d.GetProperty("ring");ringX=ring.GetProperty("x").GetSingle();ringZ=ring.GetProperty("z").GetSingle();ringR=(ring.GetProperty("r_in").GetSingle()+ring.GetProperty("r_out").GetSingle())/2;
        previousRoom=Actors.I!.RoomMovement;Actors.I.RoomMovement=MoveAction;Interact.I.AddProvider(Keys);if(Menu.MainMenu.I is {} m)m.WorldReplaced+=Replaced;ServerLink.I?.WhenUp(()=>_=Load());
    }
    private void Replaced(string how,ClientState? state){epoch++;State=null;Visitor=null;poll=0;ClearActors();}
    public async Task Load()
    {if(polling||ServerLink.I?.Api is not {} api)return;polling=true;int e=epoch;try{var state=await api.MovingPrison();if(e==epoch){State=state;poll=10;}}catch(ApiException){}finally{polling=false;}}
    public async Task Visit(string? id=null)
    {if(ServerLink.I?.Api is not {} api)return;var v=await api.MovingPrisonVisit(id);if(v.Ok)Visitor=v.Id;GameState.I.Say(v.Text);}
    private Offers? Keys(float x,float z)
    {
        if(State==null)return null;var local=frame.AffineInverse()*new Vector3(x,0,z);
        if(State.Visiting&&local.X>5.6&&local.X<11.5&&local.Z>1.8&&local.Z<3.6)return new(){Only=new(){Act.Me(Key.E,"ask to see a prisoner",()=>_=Visit())}};
        foreach(var f in Figures)if(f.Root.Visible&&f.On is "gate" or "guard" or "chief" or "visits" or "yard"&&new Vector2(f.Root.Position.X-x,f.Root.Position.Z-z).Length()<2)
            return new(){Only=new(){Act.Me(Key.E,"speak to the warder",()=>_=Ask(f.On))}};
        return null;
    }
    private async Task Ask(string role){if(ServerLink.I?.Api is {} api)GameState.I.Say((await api.MovingPrisonAsk(role=="gate"&&State?.DayShift!=true?"gate_night":role)).Text);}
    private bool Has(string role){if(State==null)return false;foreach(var w in State.Warders)if(w.Role==role)return true;return false;}
    private bool On(Slot f)=>f.On switch{"always"=>true,"visitor"=>Visitor!=null,"gate"=>Has("gate")||Has("gate_night"),"yard"=>State?.Exercise==true&&Has("yard"),"visits"=>State?.Visiting==true&&Has("visits"),"day"=>State?.DayShift==true,"clerk"=>town.Hour>=8&&town.Hour<18,"director"=>town.Hour>=9&&town.Hour<16,"governor"=>town.Hour>=18&&town.Hour<22,_=>Has(f.On)};
    public override void _Process(double delta)
    {
        if(!(GameState.I.Playing||Jef.I.TestInput))return;double dt=Math.Min(delta,.1);if((poll-=dt)<=0){poll=State==null?2:10;_=Load();}if(State?.Visiting!=true)Visitor=null;
        var j=frame.AffineInverse()*new Vector3(Jef.I.X,0,Jef.I.Z);
        foreach(var f in Figures)
        {
            var round=f.Round;var world=frame*new Vector3((float)round.X,f.Y,(float)round.Z);bool visible=State!=null&&On(f)&&new Vector2(world.X-Jef.I.X,world.Z-Jef.I.Z).Length()<130;f.Root.Visible=visible;if(!visible)continue;
            bool visitor=f.On=="visitor"&&Visitor!=null;round.Update(dt,visitor||Whereabouts.Hypot(j.X-round.X,j.Z-round.Z)<.9);bool home=Whereabouts.Hypot(round.X-round.Home.x,round.Z-round.Home.z)<.01&&!round.Walking;
            bool sit=home&&f.Motion=="sit"&&f.Human.CanSit;f.Root.Position=frame*new Vector3((float)round.X,f.Y+(sit?f.Human.SitDrop(f.Seat):0),(float)round.Z);f.Root.Rotation=new(0,(float)(Floor.Yaw+(round.Walking?round.Yaw:home?f.Yaw:round.Yaw)),0);f.Human.Play(round.Walking?"walk":home?f.Motion:"behind");f.Human.SetPace((float)round.Speed);f.Human.Update((float)dt);
        }
        RingCount=0;for(int i=0;i<ringers.Count;i++){var r=ringers[i];r.Root.Visible=State?.Exercise==true&&i<Math.Min(State.Ring,10)&&frame.Origin.DistanceTo(new(Jef.I.X,0,Jef.I.Z))<130;if(!r.Root.Visible)continue;RingCount++;r.Angle-=(float)(.8/ringR*dt);r.Root.Position=frame*new Vector3(ringX+MathF.Cos(r.Angle)*ringR,.05f,ringZ+MathF.Sin(r.Angle)*ringR);r.Root.Rotation=new(0,r.Angle+MathF.PI/2+(float)Floor.Yaw,0);r.Human.Play("walk");r.Human.Update((float)dt);}
        ended.Clear();foreach(var pair in roomActors){bool present=false;foreach(var run in Actors.I!.Runs)if(run.Action.Id==pair.Key){present=true;break;}if(!present)ended.Add(pair.Key);}foreach(var id in ended){roomActors[id].Root.QueueFree();roomActors.Remove(id);}
    }
    private bool MoveAction(Actors.Run run,double dt)
    {
        var a=run.Action;if(a.TargetX is not {} x||a.TargetZ is not {} z||State?.Visiting!=true)return previousRoom?.Invoke(run,dt)==true;
        var target=new Vector3((float)x,0,(float)z);if(!HallPeople.PrisonFree(Floor,target))return previousRoom?.Invoke(run,dt)==true;
        var person=run.Person??=town.ActionPerson(a.Npc);if(person==null)return false;if(!ReferenceEquals(person.ActionOwner,Actors.I))town.ActionHold(person,Actors.I!,true);
        var gate=frame*new Vector3(0,0,1.6f);
        if(!roomActors.TryGetValue(a.Id,out var actor))
        {
            var pos=new Vector3((float)person.X,0,(float)person.Z);if(!HallPeople.PrisonFree(Floor,pos)){if(pos.DistanceTo(gate)>3)return false;pos=gate;}
            var human=Humans.Make(person.Kind);if(human==null)return false;var root=new Node3D{Name="prison_action_"+a.Npc,Position=pos};Main.I.View.AddChild(root);root.AddChild(human.Root);human.Start();roomActors[a.Id]=actor=new(){Human=human,Root=root,Goal=new(float.PositiveInfinity,0,0)};town.ActionInside(person,pos.X,pos.Z);run.Indoors=true;
        }
        if(actor.Goal.DistanceSquaredTo(target)>.01f){actor.Path.Clear();foreach(var p in HallPeople.PrisonRoute(Floor,actor.Root.Position,target))actor.Path.Enqueue(p);actor.Goal=target;actor.Reported=false;if(actor.Path.Count==0){Actors.I!.PrisonBlocked(run);return true;}}
        float step=(float)(1.3*dt);bool walking=false;while(step>0&&actor.Path.Count>0){var to=actor.Path.Peek();var delta=to-actor.Root.Position;float distance=delta.Length();if(distance<.02f){actor.Path.Dequeue();continue;}float moved=Math.Min(step,distance);actor.Root.Position+=delta/distance*moved;actor.Root.Rotation=new(0,MathF.Atan2(delta.X,delta.Z),0);step-=moved;walking=true;}
        person.X=actor.Root.Position.X;person.Z=actor.Root.Position.Z;actor.Human.Play(walking?"walk":"idle");actor.Human.SetPace(1.3f);actor.Human.Update((float)dt);
        if(actor.Path.Count==0&&!actor.Reported){actor.Reported=true;ActionArrivals++;Actors.I!.PrisonArrived(run);}return true;
    }
    private void ClearActors(){foreach(var actor in roomActors.Values)actor.Root.QueueFree();roomActors.Clear();}
    public override void _ExitTree(){if(Actors.I!=null)Actors.I.RoomMovement=previousRoom;if(Menu.MainMenu.I is {} m)m.WorldReplaced-=Replaced;ClearActors();foreach(var f in Figures)f.Root.QueueFree();foreach(var r in ringers)r.Root.QueueFree();data.Dispose();I=null;}
}

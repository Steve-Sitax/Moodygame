using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Play;

/// <summary>emigrants.ts: the engine's families and luggage; one family on each real lighter.</summary>
[GamePart(361)]
public partial class Emigrants : Node
{
    public static Emigrants I { get; private set; } = null!;
    public EmigrantView? Info { get; private set; }
    public event Action<int, EmigrantBoard>? Answered;
    private sealed class Camp { public EmigrantFamily Family=null!; public Node3D Group=new(); public readonly List<Node3D> Chests=new(); }
    private sealed class Walker { public string Id=""; public Townspeople.Sim Sim=null!; public Vector2 To; }
    private sealed class Crossing { public EmigrantFamily Family=null!; public int Tow; public float Time; public readonly List<Walker> Walkers=new(); public bool Reported; }
    private sealed class Passenger { public Human Human=null!; public Node3D Group=null!; }
    private sealed class Lowering { public Node3D Prop=null!; public Vector3 From, Slot; public float Time; }
    private sealed class Deck { public Node3D Group=new(); public readonly List<Passenger> People=new(); public readonly List<Node3D> Chests=new(); public readonly List<Lowering> Lowering=new(); }
    private static readonly Vector2[] PeopleSlots={new(1.45f,-7.2f),new(1.45f,7.2f),new(1.45f,-6.2f),new(1.45f,6.2f),new(.5f,-7.8f),new(.5f,7.7f),new(1.45f,-5.3f),new(1.45f,5.3f),new(-.4f,-7.2f),new(-.4f,7.2f),new(.4f,-6.5f),new(.4f,6.6f)};
    private static readonly Vector2[] ChestSlots={new(-1.3f,-8.2f),new(-1.3f,8.1f),new(-1.3f,-7.2f),new(-1.3f,7.1f),new(-.2f,-8.5f),new(-.2f,8.4f)};
    private readonly Dictionary<int,Camp> camps=new();
    private readonly Dictionary<int,Crossing> crossings=new();
    private readonly Dictionary<int,Deck> decks=new();
    private readonly Dictionary<string,Node3D> templates=new();
    private Townspeople? town;
    private double poll, think;
    private bool loading,dead;
    private int generation;
    public int CampCount=>camps.Count;
    public int AboardCount { get {int n=0;foreach(var d in decks.Values)n+=d.People.Count;return n;} }
    public int LinerTransfers { get; private set; }
    public Vector3? DeckPerson { get { foreach(var d in decks.Values)if(d.People.Count>0)return d.People[0].Group.GlobalPosition;return null; } }
    private static MeshInstance3D Part(PrimitiveMesh mesh,Material material,float x,float y,float z)=>new(){Mesh=mesh,MaterialOverride=material,Position=new(x,y,z)};
    public override void _Ready()
    {
        I=this;town=GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        // All prop meshes and materials exist before play; copies share them.
        templates["chest"]=Goods.I.MakeGoods("chests");
        var bundle=new Node3D();bundle.AddChild(Part(new SphereMesh{Radius=.3f,Height=.6f,RadialSegments=6,Rings=3},Goods.I.Plain(0x7a7470),0,.22f,0));bundle.GetChild<Node3D>(0).Scale=new(1.25f,.75f,1);bundle.AddChild(Part(new SphereMesh{Radius=.08f,Height=.16f,RadialSegments=6,Rings=2},Goods.I.Plain(0x7a7470),0,.47f,0));templates["bundle"]=bundle;
        var bed=new Node3D();var roll=Part(new CylinderMesh{TopRadius=.3f,BottomRadius=.3f,Height=1.15f,RadialSegments=7,Rings=1},Goods.I.Plain(0xa8a090),0,.3f,0);roll.Rotation=new(0,0,MathF.PI/2);bed.AddChild(roll);foreach(float x in new[]{-.35f,.35f}) {var band=Part(new CylinderMesh{TopRadius=.315f,BottomRadius=.315f,Height=.05f,RadialSegments=7,Rings=1},Goods.I.Plain(0x7a6646),x,.3f,0);band.Rotation=new(0,0,MathF.PI/2);bed.AddChild(band);}templates["featherbed"]=bed;
        var basket=new Node3D();basket.AddChild(Part(new CylinderMesh{TopRadius=.22f,BottomRadius=.16f,Height=.26f,RadialSegments=7,Rings=1},Goods.I.Plain(0x9a8660),0,.13f,0));templates["basket"]=basket;
        foreach(var t in templates.Values){t.Visible=false;AddChild(t);}
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;
    }
    private void Reset(string how,ClientState? state)
    {
        generation++;Info=null;poll=0;
        foreach(var c in crossings.Values)foreach(var id in c.Family.Members)town?.ReleaseFromLighter(id,false);
        crossings.Clear();foreach(var c in camps.Values)c.Group.QueueFree();camps.Clear();foreach(var d in decks.Values){foreach(var p in d.People)p.Human.Dispose();d.Group.QueueFree();}decks.Clear();LinerTransfers=0;
    }
    public async Task Load()
    {
        if(loading||dead||town?.Data==null||ServerLink.I?.Api is not {} api)return;loading=true;int g=generation;
        try
        {
            var next=await api.Emigrants();if(dead||g!=generation)return;
            bool arrivals=next.Families.Any(f=>f.Members.Any(id=>!town.Data.Residents.Any(r=>r.Id==id)));
            if(arrivals){var people=await api.Town();if(dead||g!=generation)return;town.ReadEmigrantArrivals(people,next.Families.SelectMany(f=>f.Members).ToHashSet());}
            Info=next;
            foreach(var f in next.Families)
            {
                if(camps.TryGetValue(f.Household,out var old)){old.Family=f;continue;}
                if(crossings.ContainsKey(f.Household))continue;
                var camp=new Camp{Family=f};Main.I.View.AddChild(camp.Group);camps.Add(f.Household,camp);
                foreach(var p in f.Props) {if(p.Z<12||town.Walk?.Free(p.X,p.Z)!=true||!templates.TryGetValue(p.Kind,out var source))continue;var prop=(Node3D)source.Duplicate();prop.Visible=true;prop.Position=new(p.X,0,p.Z);prop.Rotation=new(0,p.Yaw,0);camp.Group.AddChild(prop);if(p.Kind=="chest")camp.Chests.Add(prop);}
            }
            foreach(var key in camps.Keys.ToArray()) if(!next.Families.Any(f=>f.Household==key)){camps[key].Group.QueueFree();camps.Remove(key);}
        }catch(ApiException){poll=2;}finally{loading=false;}
    }
    public override void _Process(double dt)
    {
        if((poll-=dt)<=0 && ServerLink.I?.Up==true){poll=6;_ = Load();}
        if(Info==null||town?.Crowd==null||River.I?.Anchorage is not {} a)return;
        if((think-=dt)<=0)
        {
            think=.5;
            foreach(var c in camps.Values){bool near=new Vector2(Jef.I.X-31,Jef.I.Z-27).Length()<90;bool day=GameState.I.HourF>=7.25 && GameState.I.HourF<18.25;c.Group.Visible=near&&day;bool away=c.Family.Luggage is "taken" or "done";foreach(var p in c.Chests)p.Visible=!away;}
            if(GameState.I.HourF>=Info.Ship.From && GameState.I.HourF<Info.Ship.To+1)
                for(int i=0;i<a.Tows.Count;i++){var t=a.Tows[i];if(t.Stop!=1||t.Phase!="dwell"||t.Crab<.99||t.Dwell<=25||crossings.Values.Any(c=>c.Tow==i&&!c.Reported))continue;var f=Info.Families.Where(f=>f.BoardingToday&&!f.WaitingForJef&&!crossings.ContainsKey(f.Household)).OrderBy(f=>f.ArrivedAt).FirstOrDefault();if(f!=null)Start(f,i,t);}
        }
        foreach(var c in crossings.Values)
        {
            if(c.Reported)continue;c.Time+=(float)dt;var t=a.Tows[c.Tow];bool gone=t.Stop!=1||t.Phase!="dwell";
            for(int k=c.Walkers.Count-1;k>=0;k--){var w=c.Walkers[k];var p=w.Sim.P;if(gone||c.Time>45||p==null||!town.Crowd.Alive(p)||new Vector2((float)p.X-w.To.X,(float)p.Z-w.To.Y).Length()<1.3f){Aboard(c,w.Id,w.Sim);c.Walkers.RemoveAt(k);}}
            if(c.Walkers.Count==0 && c.Time>=0){c.Reported=true;_ = Report(c);}
        }
        foreach(var entry in decks)
        {
            var d=entry.Value;var t=a.Tows[entry.Key];d.Group.GlobalTransform=t.Lighter.Boat.Outer.GlobalTransform;
            if(t.Stop==0&&t.Phase=="dwell"){if(d.People.Count>0){LinerTransfers+=d.People.Count;foreach(var p in d.People){p.Human.Dispose();p.Group.QueueFree();}d.People.Clear();foreach(var p in d.Chests)p.QueueFree();d.Chests.Clear();}continue;}
            bool near=d.Group.GlobalPosition.DistanceTo(Main.I.Cam.GlobalPosition)<140;d.Group.Visible=near;
            if(near)foreach(var p in d.People)p.Human.Update((float)dt);
            for(int k=d.Lowering.Count-1;k>=0;k--){var l=d.Lowering[k];l.Time=Math.Min(1,l.Time+(float)dt/3.5f);var to=d.Group.ToGlobal(l.Slot);l.Prop.GlobalPosition=l.From.Lerp(to,l.Time)+Vector3.Up*MathF.Sin(MathF.PI*l.Time)*1.4f;if(l.Time>=1){l.Prop.Reparent(d.Group);l.Prop.Position=l.Slot;l.Prop.Rotation=new(0,MathF.PI/2,0);d.Chests.Add(l.Prop);d.Lowering.RemoveAt(k);}}
        }
    }
    private Deck DeckFor(int tow){if(decks.TryGetValue(tow,out var d))return d;d=new();Main.I.View.AddChild(d.Group);decks.Add(tow,d);return d;}
    private void Start(EmigrantFamily f,int tow,Anchorage.Tow t)
    {
        var c=new Crossing{Family=f,Tow=tow};crossings.Add(f.Household,c);int i=0;
        foreach(string id in f.Members)
        {
            var s=town!.ClaimForLighter(id);if(s?.P is not {} p){Aboard(c,id,s);continue;}
            float x=Math.Clamp(t.Lighter.Boat.Outer.GlobalPosition.X+(i++-f.Members.Count/2f)*1.1f,20,36);var to=town.Crowd!.CanStand(x,1.2)?(x: (double)x,z:1.2):town.Crowd.OpenNear(x,1.6)??(x:(double)x,z:2.0);
            town.Crowd.PuppetGo(p,to.x,to.z,1.25);c.Walkers.Add(new(){Id=id,Sim=s,To=new((float)to.x,(float)to.z)});
        }
        var deck=DeckFor(tow);deck.Group.GlobalTransform=t.Lighter.Boat.Outer.GlobalTransform;
        if(camps.Remove(f.Household,out var camp)){foreach(var prop in camp.Chests){var slot=ChestSlots[(deck.Chests.Count+deck.Lowering.Count)%ChestSlots.Length];var from=prop.GlobalPosition;prop.Reparent(Main.I.View);prop.Visible=true;deck.Lowering.Add(new(){Prop=prop,From=from,Slot=new(slot.X,.62f,slot.Y)});}camp.Group.QueueFree();}
    }
    private void Aboard(Crossing c,string id,Townspeople.Sim? s)
    {
        string kind=s?.Kind??town!.Data!.Residents.FirstOrDefault(r=>r.Id==id)?.Kind??"docker_a";town!.HideForLighter(id);
        if(c.Family.Baby?.Child==id)return;var human=Humans.Make(Humans.IsKind(kind)?kind:"docker_a");if(human==null)return;var d=DeckFor(c.Tow);var slot=PeopleSlots[d.People.Count%PeopleSlots.Length];var g=new Node3D{Position=new(slot.X,.62f,slot.Y),Rotation=new(0,MathF.PI/2,0)};g.AddChild(human.Root);d.Group.AddChild(g);human.Start();human.Play("idle");d.People.Add(new(){Human=human,Group=g});
    }
    private async Task Report(Crossing c)
    {
        int g=generation;try{var r=await ServerLink.I!.Api!.EmigrantBoard(c.Family.Household);if(dead||g!=generation)return;foreach(var id in c.Family.Members)town!.ReleaseFromLighter(id,true);Answered?.Invoke(c.Family.Household,r);GameState.I.Say($"The {c.Family.Surname} family went down into the lighter with their chests. She takes them out to the Kempenland.");await Load();}
        catch(ApiException e){if(!dead&&g==generation){GameState.I.Say(e.Message);c.Reported=false;c.Time=-5;}}
    }
    public override void _ExitTree(){dead=true;Reset("exit",null);if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}

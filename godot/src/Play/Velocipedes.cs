using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

[GamePart(924)]
public partial class Velocipedes:Node
{
    public static Velocipedes I {get;private set;}=null!;
    public sealed class Machine
    {public VeloInfo Info=new();public Node3D Root=null!;public Node3D? Steer,Front,Rear;public StaticBody3D Solid=null!;}
    public readonly Dictionary<string,Machine> Machines=new();
    public Machine? Ridden {get;private set;}
    public VeloJef? Ownership {get;private set;}
    public bool Busy {get;private set;}
    public float Speed {get;private set;}
    public float Heading {get;private set;}
    public float Steer {get;private set;}
    public float FallT {get;private set;}
    public string LastEvent {get;private set;}="";
    public event Action<string,object>? Answered;
    private Node3D root=null!;
    private ModelLibrary.Model? model;
    private RayCast3D floor=null!;
    private ShapeCast3D room=null!;
    private VeloGround ground=null!;
    private readonly Func<float,bool> drive;
    private Func<(int Kind,int Sub,float Heading)?>? otherGear;
    private Interact.Entry? counter;
    private float x,y,z,dist,wob,time,eventAt=-9,pollT,seenT,lean;
    private bool polling;
    private bool testRisk;
    private int epoch,notice=-1;
    private RideSaved? savedRide;
    public Velocipedes(){I=this;drive=Drive;}
    public void RiderTestRisk(bool on)
    {if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("velo dice fixture outside ridetest");testRisk=on;}
    private float Roll()=>testRisk?(Speed>3.5f?0:1):GD.Randf();
    public override void _Ready()
    {
        root=new Node3D{Name="jef_velocipedes"};Main.I.View.AddChild(root);
        model=ModelLibrary.Get("velocipede",new(Affine:.5,VertexColor:true));
        floor=new RayCast3D{Name="velo_floor",Enabled=false,CollisionMask=Solid.Layer,TargetPosition=new(0,-60,0)};Main.I.View.AddChild(floor);
        room=new ShapeCast3D{Name="velo_room",Enabled=false,CollisionMask=Solid.Layer,TargetPosition=Vector3.Zero,MaxResults=1,Margin=0,Shape=new CylinderShape3D{Radius=.38f,Height=1.4f}};Main.I.View.AddChild(room);
        ground=new VeloGround();Interact.I.AddProvider(Keys);
        if(Together.I is {} together){otherGear=together.Gear;together.Gear=Gear;}
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Replaced;
        ServerLink.I?.WhenUp(()=>_=Load(true));
    }
    private (int Kind,int Sub,float Heading)? Gear()=>Ridden!=null?(MpProtocol.GearVelo,0,Heading+MathF.PI):otherGear?.Invoke();
    private void Replaced(string how,ClientState? client)
    {savedRide=RideSaves.Read<RideSaved>(client,"ride");epoch++;Clear();foreach(var m in Machines.Values)m.Root.QueueFree();Machines.Clear();counter?.Dispose();counter=null;_=Load(true);}
    public override void _ExitTree()
    {Clear();counter?.Dispose();if(Together.I is {} together)together.Gear=otherGear;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Replaced;}
    public async Task Load(bool restore=false)
    {
        var api=ServerLink.I?.Api;if(api==null||polling)return;polling=true;int e=epoch;
        try
        {
            var v=await api.Velos();var own=await api.VeloTransport();if(e!=epoch)return;
            if(restore&&savedRide==null){savedRide=await RideSaves.ReadRide(api);if(e!=epoch)return;}
            if(restore&&savedRide is {Kind:"velo"} back&&v.Velos.Exists(m=>m.Id==back.Id&&m.Mine&&m.Ridden))
            {Ownership=own.Jef;Apply(v);if(Machines.TryGetValue(back.Id,out var machine)){Ridden=machine;x=back.X;z=back.Z;y=Floor(x,z,Jef.I.Y);if(!float.IsFinite(y))y=0;Heading=back.Yaw;Speed=Steer=FallT=0;machine.Solid.CollisionLayer=0;Jef.I.Drive=drive;Jef.I.DrivenEye=1.86f;Jef.I.Carry(new(x,y,z));savedRide=null;return;}}
            savedRide=null;
            if(restore)foreach(var m in v.Velos)if(m.Mine&&m.Ridden){await api.VeloLeave(m.Id,m.X,m.Z,m.Yaw,false);if(e!=epoch)return;}
            if(restore)v=await api.Velos();if(e!=epoch)return;
            Ownership=own.Jef;Apply(v);
            if(Ownership?.Notice is {} n&&n.N!=notice){notice=n.N;if(n.Text!="")GameState.I.Say(n.Text);}
            if(counter==null&&Ownership?.Shop is {} shop&&shop.Step.Length>=2)
                counter=Interact.I.Add(new Interact.Entry{Place=new(shop.Step[0],1.4f,shop.Step[1]),Reach=2.4f,Label=()=>"the velocipede maker's wares",Run=()=>Scheldemist.Talks.Shop.I?.OpenAt(shop.Id,shop.Label)});
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{polling=false;if(e!=epoch&&IsInsideTree())_=Load(true);}
    }
    public void Apply(VeloWorld world)
    {
        var present=new HashSet<string>();foreach(var v in world.Velos)
        {
            present.Add(v.Id);if(!Machines.TryGetValue(v.Id,out var m))
            {
                var node=model?.Copy("velocipede");if(node==null)continue;root.AddChild(node);
                m=new(){Root=node};foreach(var n in BakedWorld.All(node))if(n is Node3D c){if(c.Name=="velocipede_steer")m.Steer=c;if(c.Name=="velocipede_front")m.Front=c;if(c.Name=="velocipede_rear")m.Rear=c;}
                m.Solid=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};node.AddChild(m.Solid);
                m.Solid.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=new(.5f,1.1f,1.7f)},Position=new(0,.55f,0)});Machines[v.Id]=m;
            }
            m.Info=v;if(m==Ridden&&(!v.Mine||!v.Ridden))Clear();if(m==Ridden)continue;Park(m);
        }
        var gone=new List<string>();foreach(var pair in Machines)if(!present.Contains(pair.Key))gone.Add(pair.Key);
        foreach(string id in gone){var m=Machines[id];if(m==Ridden){Clear();GameState.I.Say("You get off. The velocipede is gone.");}m.Root.QueueFree();Machines.Remove(id);}
    }
    private void Park(Machine m)
    {
        m.Solid.CollisionLayer=0;float feet=Floor(m.Info.X,m.Info.Z,0);if(!float.IsFinite(feet))feet=0;
        m.Root.Position=new(m.Info.X,feet+(m.Info.Down?.33f:0),m.Info.Z);m.Root.Rotation=new(0,m.Info.Yaw,m.Info.Down?-1.42f:.06f);
        m.Root.Visible=!m.Info.Ridden;m.Solid.CollisionLayer=m.Info.Ridden?0:Solid.Layer;
        if(m.Steer!=null)m.Steer.Rotation=new(0,m.Info.Down?.3f:.12f,0);
    }
    private Offers Keys(float px,float pz)
    {
        if(!Scheldemist.Dev.SpeedComparison.Cached||FallT>0||Busy||Ridden!=null)return KeysOriginal(px,pz);
        return WalkingKeys();
    }
    private readonly Offers walkingOffers = new() { Options = new() }, emptyOffers = new();
    public bool SameKeys(float x,float z)=>Scheldemist.Dev.OfferComparison.Same(()=>KeysOriginal(x,z),()=>FallT>0||Busy||Ridden!=null?KeysOriginal(x,z):WalkingKeys());
    private Offers WalkingKeys()
    {
        var j=Jef.I;if(j.Riding||j.Laden||j.Swimming||j.Climbing)return emptyOffers;
        var options=walkingOffers.Options!;options.Clear();
        foreach(var machine in Machines.Values)
        {
            if(!machine.Info.Mine||machine.Info.Ridden)continue;
            float distance=new Vector2(j.X-machine.Info.X,j.Z-machine.Info.Z).Length();
            if(distance<1.7f)options.Add((distance,MountAction(machine)));
        }
        return walkingOffers;
    }
    private Act MountAction(Machine machine)=>Act.At(Key.E,"get on the velocipede",new(machine.Info.X,.8f,machine.Info.Z),()=>_=Mount(machine));
    private Offers KeysOriginal(float px,float pz)
    {
        if(FallT>0||Busy)return new(){Only=new()};
        if(Ridden!=null)return new(){Only=new(){Act.Me(Key.E,"get off the velocipede",()=>_=Leave())}};
        var j=Jef.I;if(j.Riding||j.Laden||j.Swimming||j.Climbing)return new();
        var options=new List<(float,Act)>();foreach(var m in Machines.Values)
        {if(!m.Info.Mine||m.Info.Ridden)continue;float d=new Vector2(j.X-m.Info.X,j.Z-m.Info.Z).Length();if(d<1.7f)options.Add((d,Act.At(Key.E,"get on the velocipede",new(m.Info.X,.8f,m.Info.Z),()=>_=Mount(m))));}
        return new(){Options=options};
    }
    public async Task Mount(Machine m)
    {
        if(Busy||Jef.I.Riding||Jef.I.Laden||!m.Info.Mine)return;Busy=true;int e=++epoch;
        try
        {
            var reply=await ServerLink.I!.Api!.VeloMount(m.Info,Jef.I.X,Jef.I.Z);if(e!=epoch)return;GameState.I.Apply(reply);Answered?.Invoke("mount",reply);
            Ridden=m;m.Info=m.Info with{Ridden=true,Down=false};m.Solid.CollisionLayer=0;
            x=m.Info.X;z=m.Info.Z;y=Floor(x,z,Jef.I.Y);if(!float.IsFinite(y))y=Jef.I.Y;
            Heading=m.Info.Yaw+MathF.PI;Speed=Steer=wob=FallT=0;
            Jef.I.Yaw=Heading;Jef.I.Drive=drive;Jef.I.Carry(new(x,y,z));Jef.I.DrivenEye=1.86f;
            GameState.I.Say("You swing a leg over the saddle. W to pedal, S to brake, A and D or the mouse to steer, E to get off.");
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    private void Clear(){if(Jef.I.Drive==drive){Jef.I.Drive=null;Jef.I.DrivenEye=Jef.Eye;Jef.I.DrivenRoll=0;}Ridden=null;Speed=0;FallT=0;}
    public async Task Leave(bool down=false)
    {
        var m=Ridden;if(m==null||Busy)return;Busy=true;int e=++epoch;
        var at=new Vector3(x,y,z);float heading=Heading;Ridden=null;Speed=0;
        for(int i=0;i<3;i++)
        {float a=heading+(i==0?MathF.PI/2:i==1?-MathF.PI/2:MathF.PI);float xx=x-MathF.Sin(a)*(down?.9f:.75f),zz=z-MathF.Cos(a)*(down?.9f:.75f);if(Free(xx,zz,y)&&Math.Abs(Floor(xx,zz,y)-y)<.2f){x=xx;z=zz;break;}}
        if(down){FallT=1.6f;Jef.I.Carry(new(x,y,z));}else{Clear();Jef.I.Carry(new(x,y,z));}
        m.Info=m.Info with{X=at.X,Z=at.Z,Yaw=heading+MathF.PI,Ridden=false,Down=down};Park(m);
        try{var reply=await ServerLink.I!.Api!.VeloLeave(m.Info.Id,at.X,at.Z,heading+MathF.PI,down);if(e!=epoch)return;m.Info=reply with{Id=m.Info.Id,Mine=m.Info.Mine,Owner=m.Info.Owner};Park(m);Answered?.Invoke(down?"fall":"leave",reply);}
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    private float Floor(float xx,float zz,float feet)
    {floor.GlobalPosition=new(xx,feet+.3f,zz);floor.ForceRaycastUpdate();return floor.IsColliding()?floor.GetCollisionPoint().Y:float.NegativeInfinity;}
    private bool Free(float xx,float zz,float feet)
    {room.GlobalPosition=new(xx,feet+1.05f,zz);room.ForceShapecastUpdate();return !room.IsColliding();}
    private static bool Wet(float xx,float zz)=>Water.In(xx,zz)&&!(xx>5&&xx<9&&zz>-12&&zz<0);
    private void Event(string value)
    {
        if(value!="fall"&&time-eventAt<1.2f)return;eventAt=time;LastEvent=value;
        GameState.I.Say(value switch{"fall"=>"The wheel catches and throws you. You land on the stones with the velocipede on top of you.","edge"=>"You stop short of the water's edge.","steps"=>"Steps: get off and walk the machine.","bump"=>"The iron tyre bangs against something.",_=>"The front wheel wobbles in the rail groove."});
    }
    public bool Drive(float dt)
    {
        var j=Jef.I;time+=dt;
        if(FallT>0){FallT=Math.Max(0,FallT-dt);float low=Math.Min(1,FallT/.9f);j.DrivenEye=Jef.Eye-(Jef.Eye-.5f)*low;j.DrivenRoll=.45f*low;if(FallT==0)Clear();return true;}
        var m=Ridden;if(m==null)return false;
        Solid.I.Ensure(new(x,y,z),14);
        bool K(Key key)=>j.KeyDown(key);var g=ground.At(x,z);bool hard=K(Key.Shift);float top=(g.Kind switch{"flags"=>5,"wood"=>4.2f,"earth"=>2.8f,_=>4.6f})*(hard?1.15f:1);
        float v=Speed;if(K(Key.W)||K(Key.Up))v=v<top?Math.Min(top,v+(hard?1.9f:1.4f)*dt):Math.Max(top,v-1.5f*dt);
        else if(K(Key.S)||K(Key.Down)||j.Frozen)v=v>0?Math.Max(0,v-3.6f*dt):j.Frozen?0:Math.Max(-.6f,v-.8f*dt);
        else v=v>0?Math.Max(0,v-(.22f+(g.Kind=="earth"?.9f:0)+(g.Rut?.3f:0))*dt):Math.Min(0,v+1.5f*dt);
        float want=(K(Key.A)||K(Key.Left)?.5f:0)-(K(Key.D)||K(Key.Right)?.5f:0);bool keys=want!=0;
        float off=MathF.Atan2(MathF.Sin(j.Yaw-Heading),MathF.Cos(j.Yaw-Heading));if(!keys&&Math.Abs(off)<1.4f&&Math.Abs(v)>.15f)want=Math.Clamp(off*1.4f,-.45f,.45f);
        want/=1+Math.Abs(v)*.15f;Steer+=(want-Steer)*(1-MathF.Exp(-dt*6));wob=Math.Max(0,wob-dt*.8f);
        float dh=v*MathF.Tan(Steer+wob*MathF.Sin(time*13)*.2f)/1.18f*dt;Heading+=dh;
        float fx=-MathF.Sin(Heading),fz=-MathF.Cos(Heading),dx=fx*v*dt,dz=fz*v*dt;
        if(dx!=0||dz!=0)
        {
            float nx=x+dx,nz=z+dz;if(!Free(nx,nz,y)){if(Free(nx,z,y))nz=z;else if(Free(x,nz,y))nx=x;else{nx=x;nz=z;}}
            float ng=Floor(nx,nz,y),sign=Math.Sign(v);
            if(Math.Abs(ng-y)>.16f||Wet(nx+fx*.7f*sign,nz+fz*.7f*sign)){Event(Wet(nx+fx*.9f*sign,nz+fz*.9f*sign)||ng<y-1?"edge":"steps");v=0;}
            else{float moved=new Vector2(nx-x,nz-z).Length(),wish=new Vector2(dx,dz).Length();if(moved<wish*.4f&&Math.Abs(v)>1.2f){Event("bump");v*=.15f;}else if(moved<wish*.9f)v*=1-Math.Min(1,dt*3);x=nx;z=nz;y=ng;dist+=moved*sign;}
        }
        float sp=Math.Abs(v);if(sp>1.2f)
        {float q=sp/4.6f,risk=0,throwOff=0;if(g.Rail!=Vector2.Zero){float along=Math.Abs(new Vector2(fx,fz).Dot(g.Rail));risk=(along>.85f?3:along>.5f?1.5f:.3f)*q;if(along>.85f&&sp>3.4f)throwOff=.3f;}if(g.Rut)risk=Math.Max(risk,.35f*q);if(g.Kind=="earth")risk=Math.Max(risk,.2f*q);
            if(risk>0&&Roll()<risk*dt){if((wob>.5f&&sp>3)||Roll()<throwOff){Event("fall");_=Leave(true);return true;}wob=1;v*=.8f;Event("wobble");}}
        Speed=v;lean=-Steer*Math.Min(1,sp/3)*.22f+wob*MathF.Sin(time*13)*.07f;
        j.Carry(new(x,y,z),keys?dh:0);j.DrivenEye=1.86f+Math.Abs(MathF.Sin(dist/.46f))*.022f*Math.Min(1,sp);j.DrivenRoll=lean*.45f;
        m.Root.Position=new(x,y,z);m.Root.Rotation=new(0,Heading+MathF.PI,lean);m.Root.Visible=true;
        if(m.Steer!=null)m.Steer.Rotation=new(0,Steer,0);if(m.Front!=null)m.Front.Rotation=new(dist/.46f,0,0);if(m.Rear!=null)m.Rear.Rotation=new(dist/.38f,0,0);
        return true;
    }
    public override void _Process(double delta)
    {
        float dt=(float)delta;pollT+=dt;seenT+=dt;if(pollT>15&&!Busy){pollT=0;_=Load();}if(seenT>5&&Ownership?.List.Count>0){seenT=0;_=Seen();}
        foreach(var m in Machines.Values)if(m!=Ridden)m.Root.Visible=!m.Info.Ridden&&new Vector2(m.Info.X-Jef.I.X,m.Info.Z-Jef.I.Z).Length()<70;
    }
    private async Task Seen(){try{await ServerLink.I!.Api!.VeloSeen(Jef.I.X,Jef.I.Z);}catch(ApiException){}}
}

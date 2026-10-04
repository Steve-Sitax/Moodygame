using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Models;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

[GamePart(925)]
public partial class Rowing:Node,RowPhysics.IWorld
{
    public static Rowing I {get;private set;}=null!;
    public sealed class Drawn
    {public string Key="",Kind="rowboat";public float X,Z,Yaw;public bool Drift;public Node3D Root=null!,Oars=null!;public readonly Node3D[] Pivot=new Node3D[2],Dip=new Node3D[2],Feather=new Node3D[2];public readonly float[] Shipped=new float[2];public RowPhysics.Hull Hull;}
    public RowWorld Data {get;private set;}=new();
    public readonly Dictionary<string,Drawn> Drawings=new();
    public Drawn? Boat {get;private set;}
    public RowPhysics Rower {get;}=new();
    public bool Busy {get;private set;}
    public event Action<string,object>? Answered;
    private Node3D root=null!;
    private ModelLibrary.Model? models;
    private Material wood=null!,dark=null!,iron=null!;
    private CylinderMesh shaft=null!,handle=null!,collar=null!;
    private BoxMesh blade=null!;
    private ShapeCast3D space=null!;
    private CylinderShape3D shape=null!;
    private readonly Func<float,bool> drive;
    private Func<bool>? oldJump;
    private Func<(int Kind,int Sub,float Heading)?>? otherGear;
    private float pollT,bumpT;
    private int epoch,notice=-1;
    private bool polling,strokePending;
    private static readonly string[] Kinds={"rowboat","punt","workboat","dinghy","shipsboat","gig","bumboat","eelboat","oldboat"};
    private const float Out=2,In=.7f,Blade=.55f;
    public Rowing(){I=this;drive=Drive;rowWhere=()=>new(Rower.X,Rower.Z);}
    public override void _Ready()
    {
        root=new Node3D{Name="jef_rowing"};Main.I.View.AddChild(root);models=ModelLibrary.Get("boats",new(TwoSided:true,Affine:.6));
        Boats.I.PlayerWarmHulls();
        WarmNavigation();
        if(models!=null)foreach(var n in BakedWorld.All(models.Scene))if(n is MeshInstance3D{Mesh:not null} m)for(int i=0;i<m.Mesh.GetSurfaceCount();i++)
        {var mat=m.Mesh.SurfaceGetMaterial(i);if(mat?.ResourceName=="wood")wood=mat;if(mat?.ResourceName=="wood_dark")dark=mat;if(mat?.ResourceName=="iron")iron=mat;}
        shaft=new CylinderMesh{TopRadius=.022f,BottomRadius=.028f,Height=Out+In-Blade,RadialSegments=5};handle=new CylinderMesh{TopRadius=.018f,BottomRadius=.018f,Height=.14f,RadialSegments=5};collar=new CylinderMesh{TopRadius=.034f,BottomRadius=.034f,Height=.08f,RadialSegments=5};blade=new BoxMesh{Size=new(Blade,.15f,.022f)};
        shape=new CylinderShape3D{Radius=.8f,Height=1.6f};space=new ShapeCast3D{Name="row_water_room",Shape=shape,Enabled=false,TargetPosition=Vector3.Zero,CollisionMask=Solid.Layer,Margin=0,MaxResults=1};Main.I.View.AddChild(space);
        Interact.I.AddProvider(Keys);oldJump=Jef.I.OnJump;Jef.I.OnJump=Jump;
        if(Together.I is {} together){otherGear=together.Gear;together.Gear=Gear;}
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Replaced;
        ServerLink.I?.WhenUp(()=>_=Load(true));
    }
    private (int Kind,int Sub,float Heading)? Gear()=>Boat!=null?(MpProtocol.GearRowboat,Array.IndexOf(Kinds,Boat.Kind),Rower.Heading):otherGear?.Invoke();
    private void Clear(){ReleaseNavigation();if(Jef.I.Drive==drive){Jef.I.Drive=null;Jef.I.DrivenEye=Jef.Eye;Jef.I.DrivenRoll=0;}Boat=null;}
    private void Replaced(string how,ClientState? client){epoch++;Clear();foreach(var d in Drawings.Values)d.Root.QueueFree();Drawings.Clear();Boats.I.PlayerShowSmall();_=Load(true);}
    public override void _ExitTree(){Clear();Jef.I.OnJump=oldJump;Boats.I.PlayerShowSmall();if(Together.I is {} together)together.Gear=otherGear;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Replaced;}
    public async Task Load(bool restore=false)
    {
        var api=ServerLink.I?.Api;if(api==null||polling)return;polling=true;int e=epoch;
        try
        {
            var data=await api.RowWorld();if(e!=epoch)return;
            if(restore&&data.On!=null)
            {var home=data.On=="hire"?data.Hire?.Left??data.Landings.Where(l=>l.Id==data.Hire?.Landing).Select(l=>new RowPlace{X=l.X,Z=l.Z,Yaw=l.Yaw}).FirstOrDefault():data.Boats.Where(b=>b.Id==data.On).Select(b=>new RowPlace{X=b.X,Z=b.Z,Yaw=b.Yaw}).FirstOrDefault();
                if(home!=null){var left=await api.RowLeave(home.X,home.Z,home.Yaw,true);if(e!=epoch)return;data=left.Row;}}
            Apply(data);
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{polling=false;}
    }
    private Drawn Make(string key,string kind,float x,float z,float yaw)
    {
        var obj=models?.Copy(kind)??throw new InvalidOperationException("missing boat model "+kind);root.AddChild(obj);obj.Transform=Transform3D.Identity;
        foreach(var n in BakedWorld.All(obj))if(n is Node3D c&&(c.Name.ToString().EndsWith("_cap")||c.Name.ToString().EndsWith("_stow")))c.Visible=false;
        var d=new Drawn{Key=key,Kind=kind,X=x,Z=z,Yaw=yaw,Root=obj,Hull=RowPhysics.Hull.Of(kind),Oars=new Node3D{Name="row_oars"}};obj.AddChild(d.Oars);
        for(int i=0;i<2;i++)
        {
            float side=i==0?1:-1;var pin=d.Hull.Pin;var p=new Node3D{Name=i==0?"port":"starboard",Position=new(pin.X*side,pin.Y,pin.Z)};var dip=new Node3D();var feather=new Node3D();d.Oars.AddChild(p);p.AddChild(dip);dip.AddChild(feather);d.Pivot[i]=p;d.Dip[i]=dip;d.Feather[i]=feather;
            if(i==1)p.Scale=new(-1,1,1);
            feather.AddChild(new MeshInstance3D{Mesh=shaft,MaterialOverride=wood,Position=new((Out-Blade-In)/2,0,0),Rotation=new(0,0,MathF.PI/2)});
            feather.AddChild(new MeshInstance3D{Mesh=handle,MaterialOverride=dark,Position=new(-In+.07f,0,0),Rotation=new(0,0,MathF.PI/2)});
            feather.AddChild(new MeshInstance3D{Mesh=blade,MaterialOverride=dark,Position=new(Out-Blade/2,0,0)});
            feather.AddChild(new MeshInstance3D{Mesh=collar,MaterialOverride=iron,Rotation=new(0,0,MathF.PI/2)});
        }
        d.Oars.Visible=false;Drawings[key]=d;return d;
    }
    public void Apply(RowWorld data)
    {
        Data=data;Boats.I.PlayerShowSmall();var wanted=new HashSet<string>();
        foreach(var l in data.Landings)
        {Boats.I.PlayerHideSmall(l.X,l.Z,true);string key="berth:"+l.Id;wanted.Add(key);if(!Drawings.TryGetValue(key,out var d))d=Make(key,l.Kind,l.X,l.Z,l.Yaw);if(d!=Boat){d.X=l.X;d.Z=l.Z;d.Yaw=l.Yaw;}d.Root.Visible=!(Boat?.Key==key||data.On=="hire"&&data.Hire?.Landing==l.Id);}
        foreach(var b in data.Boats)
        {
            if(b.Lost||!b.Mine)continue;Boats.I.PlayerHideSmall(b.Home.X,b.Home.Z,true);wanted.Add(b.Id);if(!Drawings.TryGetValue(b.Id,out var d))d=Make(b.Id,b.Kind,b.X,b.Z,b.Yaw);if(d!=Boat&&!d.Drift){d.X=b.X;d.Z=b.Z;d.Yaw=b.Yaw;}d.Root.Visible=!b.Ridden;
        }
        if(data.Hire?.Left is {} left&&data.On!="hire")
        {wanted.Add("mine");if(!Drawings.TryGetValue("mine",out var d))d=Make("mine",data.Hire.Kind,left.X,left.Z,0);}
        if(Busy&&data.On=="hire"&&Drawings.ContainsKey("mine"))wanted.Add("mine");
        var gone=new List<string>();foreach(var pair in Drawings)if(!wanted.Contains(pair.Key)&&pair.Value!=Boat)gone.Add(pair.Key);foreach(string key in gone){Drawings[key].Root.QueueFree();Drawings.Remove(key);}
        if(Boat!=null&&data.On==null&&!Busy){var at=Rower.Seat;Clear();Jef.I.Place(at.X,at.Z,Jef.I.Yaw,Jef.I.Pitch,at.Y);}
        if(data.Notice is {} note&&note.N!=notice){notice=note.N;if(note.Text!="")GameState.I.Say(note.Text);}
    }
    private Offers Keys(float x,float z)
    {
        if(!Scheldemist.Dev.SpeedComparison.Cached || Busy || Boat!=null)return KeysOriginal(x,z);
        return WalkingKeys(x,z);
    }
    private readonly Offers walkingOffers = new() { Options = new() }, emptyOffers = new();
    public bool SameKeys(float x,float z)=>Scheldemist.Dev.OfferComparison.Same(()=>KeysOriginal(x,z),()=>Busy||Boat!=null?KeysOriginal(x,z):WalkingKeys(x,z));
    private Offers WalkingKeys(float x,float z)
    {
        var j=Jef.I;if(j.Riding||j.Climbing)return emptyOffers;
        var options=walkingOffers.Options!;options.Clear();
        foreach(var landing in Data.Landings)
        {
            float distance=new Vector2(x-landing.Landing[0],z-landing.Landing[1]).Length();
            if(!j.Swimming&&distance<2.4f&&j.Y<Water.Level(x,z)+3.2f)options.Add((distance,HireAction(landing)));
        }
        foreach(var drawing in Drawings.Values)
        {
            if(drawing.Key.StartsWith("berth:")||drawing==Boat)continue;
            var at=SeatOf(drawing);float distance=HullDistance(drawing,x,z),drop=j.Y-at.Y;
            if(distance<(j.Swimming?1.4f:drop>1.3f?2.2f:2)&&drop<3.6f)options.Add((distance,BoardAction(drawing,at,drop)));
        }
        return walkingOffers;
    }
    private Act HireAction(RowLanding landing)=>Act.At(Key.E,$"hire a {landing.Kind.Replace("rowboat","rowing boat")} from {landing.Waterman} ({Data.Fees.HireC} c)",new(landing.X,Water.Level(landing.X,landing.Z)+.7f,landing.Z),()=>_=Hire(landing));
    private Act BoardAction(Drawn drawing,Vector3 at,float drop)=>Act.At(Key.E,Jef.I.Swimming?"climb into your boat":drop>1.3f?"jump down into your boat":"get into your boat",new(at.X,at.Y+.35f,at.Z),()=>_=Board(drawing,drop>1.3f));
    private Offers KeysOriginal(float x,float z)
    {
        if(Busy)return new(){Only=new()};if(Boat!=null){var exit=ExitHere();return new(){Only=new(){Act.Me(Key.E,exit?.Ladder==true?"climb out up the ladder":exit!=null?"step out and tie up the boat":"go over the side into the water",()=>_=Leave(exit))}};}
        var j=Jef.I;if(j.Riding||j.Climbing)return new();var options=new List<(float,Act)>();
        foreach(var l in Data.Landings)
        {float d=new Vector2(x-l.Landing[0],z-l.Landing[1]).Length();if(!j.Swimming&&d<2.4f&&j.Y<Water.Level(x,z)+3.2f)options.Add((d,Act.At(Key.E,$"hire a {l.Kind.Replace("rowboat","rowing boat")} from {l.Waterman} ({Data.Fees.HireC} c)",new(l.X,Water.Level(l.X,l.Z)+.7f,l.Z),()=>_=Hire(l))));}
        foreach(var d in Drawings.Values)
        {if(d.Key.StartsWith("berth:")||d==Boat)continue;var at=SeatOf(d);float dist=HullDistance(d,x,z),drop=j.Y-at.Y;
            if(dist<(j.Swimming?1.4f:drop>1.3f?2.2f:2)&&drop<3.6f)options.Add((dist,Act.At(Key.E,j.Swimming?"climb into your boat":drop>1.3f?"jump down into your boat":"get into your boat",new(at.X,at.Y+.35f,at.Z),()=>_=Board(d,drop>1.3f))));}
        return new(){Options=options};
    }
    private static Vector3 SeatOf(Drawn d)=>new(d.X+MathF.Sin(d.Yaw)*d.Hull.SeatZ,Water.Level(d.X,d.Z)+d.Hull.SeatY,d.Z+MathF.Cos(d.Yaw)*d.Hull.SeatZ);
    private static float HullDistance(Drawn d,float x,float z)
    {float sx=MathF.Sin(d.Yaw),sz=MathF.Cos(d.Yaw),dx=x-d.X,dz=z-d.Z,along=Math.Clamp(dx*sx+dz*sz,-d.Hull.Half,d.Hull.Half);return Math.Max(0,new Vector2(dx-sx*along,dz-sz*along).Length()-d.Hull.Beam);}
    private bool Jump()
    {
        var j=Jef.I;if(!j.Riding&&!j.Laden&&!j.Swimming&&!j.Climbing&&!Busy)
            foreach(var d in Drawings.Values)if(!d.Key.StartsWith("berth:"))
            {var at=SeatOf(d);float drop=j.Y-at.Y,dx=d.X-j.X,dz=d.Z-j.Z;if(drop>1.3f&&drop<=3.6f&&HullDistance(d,j.X,j.Z)<2.2f&&(-MathF.Sin(j.Yaw)*dx-MathF.Cos(j.Yaw)*dz)>new Vector2(dx,dz).Length()*.2f){_=Board(d,true);return true;}}
        return oldJump?.Invoke()??false;
    }
    public async Task Hire(RowLanding l)
    {
        if(Busy||Jef.I.Laden||Jef.I.Riding)return;Busy=true;int e=++epoch;
        try{var r=await ServerLink.I!.Api!.RowHire(l.Id,Jef.I.X,Jef.I.Z);if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Row);Sit(Drawings["berth:"+l.Id]);Answered?.Invoke("hire",r);GameState.I.Say(r.Text+" W pulls, S backs water, A/D turn, Shift pulls hard, E gets out.");}
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    public async Task Board(Drawn d,bool jump=false)
    {
        if(Busy||Jef.I.Riding||Jef.I.Laden)return;Busy=true;int e=++epoch;bool climbing=false;
        try
        {
            if(d.Key=="mine"){var r=await ServerLink.I!.Api!.RowBoard(d.X,d.Z);if(e!=epoch)return;Apply(r.Row);Answered?.Invoke("board",r);}
            else{var b=Data.Boats.FirstOrDefault(b=>b.Id==d.Key&&b.Mine);if(b==null)return;var r=await ServerLink.I!.Api!.RowMountMine(b,Jef.I.X,Jef.I.Z);if(e!=epoch)return;GameState.I.Apply(r);var w=await ServerLink.I.Api.RowWorld();if(e!=epoch)return;Apply(w);Answered?.Invoke("board",r);}
            if(jump||Jef.I.Swimming){climbing=true;var at=SeatOf(d);var j=Jef.I;var head=jump?new Vector3(j.X+(at.X-j.X)*.35f,j.Y+.35f,j.Z+(at.Z-j.Z)*.35f):new Vector3(at.X,at.Y+.35f,at.Z);j.ClimbTo(new[]{(head,jump?.22f:.6f),(at,jump?Math.Max(.3f,MathF.Sqrt(2*Math.Max(.3f,j.Y+.35f-at.Y)/9.81f)):.35f)},()=>{if(e==epoch)Sit(d);Busy=false;});}else Sit(d);
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{if(!climbing)Busy=false;}
    }
    private void Sit(Drawn d)
    {Boat=d;Rower.Start(d.X,d.Z,d.Yaw,d.Hull);d.Root.Visible=d.Oars.Visible=true;Jef.I.Yaw=d.Yaw+MathF.PI;Jef.I.Pitch=-.12f;Jef.I.Carry(Rower.Seat);Jef.I.DrivenEye=.78f;Jef.I.Drive=drive;}
    public Exit? ExitHere()
    {
        var seat=Rower.Seat;var exit=QuayExits.Near(seat.X,seat.Z,2.3f)??QuayExits.Near(Rower.X,Rower.Z,2);if(exit!=null)return exit;
        if(Data.On=="hire")foreach(var l in Data.Landings)if(new Vector2(Rower.X-l.X,Rower.Z-l.Z).Length()<9){exit=QuayExits.Near(l.Landing[0],l.Landing[1],3);if(exit!=null)return exit;}
        // The low pier is also reachable from a rowing boat. Higher decks need their own moving-frame handoff.
        for(int i=0;i<16;i++){float a=i*MathF.PI/8,tx=seat.X+MathF.Cos(a)*1.8f,tz=seat.Z+MathF.Sin(a)*1.8f;if(tx>5.3f&&tx<8.7f&&tz>-11.7f&&tz<-.3f&&Water.Level(tx,tz)>-2&&Jef.I.StandFree(tx,tz,0))return new(){Gx=seat.X,Gz=seat.Z,Tx=tx,Tz=tz,Ty=0};}
        return null;
    }
    public async Task Leave(Exit? exit)
    {
        var d=Boat;if(d==null||Busy)return;Busy=true;int e=++epoch;float x=Rower.X,z=Rower.Z,yaw=Rower.Heading;var seat=Rower.Seat;
        Clear();d.X=x;d.Z=z;d.Yaw=yaw;d.Oars.Visible=false;
        if(exit!=null)
        {var keys=new List<(Vector3,float)>();keys.Add((new(exit.Gx,seat.Y-.3f,exit.Gz),.5f));if(exit.Ladder)keys.Add((new(exit.Gx,exit.Ty+.15f,exit.Gz),Math.Max(.3f,(exit.Ty+.15f-seat.Y+.3f)/.9f)));keys.Add((new(exit.Tx,exit.Ty,exit.Tz),.7f));Jef.I.ClimbTo(keys,null);}
        else{float side=d.Hull.Beam+.55f;for(int i=0;i<2;i++){float s=i==0?1:-1,xx=seat.X+MathF.Cos(yaw)*side*s,zz=seat.Z-MathF.Sin(yaw)*side*s;if(Jef.I.SwimFree(xx,zz)){Jef.I.DropFromBoat(new(xx,Water.Level(xx,zz)-.3f,zz));break;}}d.Drift=z<-1;}
        try{var r=await ServerLink.I!.Api!.RowLeave(x,z,yaw,exit!=null);if(e!=epoch)return;GameState.I.Apply(r);if(r.Row.Hire?.Left!=null){Drawings.Remove(d.Key);if(Drawings.TryGetValue("mine",out var old)&&old!=d)old.Root.QueueFree();d.Key="mine";Drawings["mine"]=d;}Apply(r.Row);Answered?.Invoke("leave",r);if(r.Text!="")GameState.I.Say(r.Text);}
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    bool RowPhysics.IWorld.Free(float x,float z,float radius)
    {
        radius*=.9f;
        if(!NavigationFree(x,z,radius))return false;
        float diag=radius*.70710678f;
        if(!Water.In(x,z)||!Water.In(x+radius,z)||!Water.In(x-radius,z)||!Water.In(x,z+radius)||!Water.In(x,z-radius)||!Water.In(x+diag,z+diag)||!Water.In(x+diag,z-diag)||!Water.In(x-diag,z+diag)||!Water.In(x-diag,z-diag)||(x>5-radius&&x<9+radius&&z>-12-radius&&z<radius))return false;
        if(!Boats.I.PlayerWaterFree(x,z,radius))return false;
        shape.Radius=radius;space.GlobalPosition=new(x,Water.Level(x,z)+.6f,z);space.ForceShapecastUpdate();if(space.IsColliding())return false;
        float bed=Boats.BedAt(x,z);if(float.IsFinite(bed)&&Water.Level(x,z)-bed<.35f)return false;
        foreach(var d in Drawings.Values)if(d!=Boat&&d.Root.Visible){float dx=x-d.X,dz=z-d.Z,c=MathF.Cos(d.Yaw),s=MathF.Sin(d.Yaw);if(Math.Abs(dx*c-dz*s)<d.Hull.Beam+radius&&Math.Abs(dx*s+dz*c)<d.Hull.Half+radius)return false;}
        return true;
    }
    public object RiderTestWater(float x,float z,float radius)
    {if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("row water fixture outside ridetest");shape.Radius=radius;space.GlobalPosition=new(x,Water.Level(x,z)+.6f,z);space.ForceShapecastUpdate();bool ships=Boats.I.PlayerWaterFree(x,z,radius);var hull=Boats.I.PlayerLastHull;return new{x,z,radius,water=Water.In(x,z),ships,kind=hull.Kind,at=new{hull.At.X,hull.At.Y,hull.At.Z},owner=hull.Owner?.Name.ToString(),parent=hull.Owner?.GetParent()?.Name.ToString(),native=space.IsColliding(),collider=space.IsColliding()?(space.GetCollider(0) as Node)?.Name.ToString():"",free=((RowPhysics.IWorld)this).Free(x,z,radius)};}
    Vector2 RowPhysics.IWorld.Current(float x,float z)
    {if(z>-1||(x>100&&x<120&&z>-6))return Vector2.Zero;float hour=(float)GameState.I.HourF,rate=(Tide.At(GameState.I.Day,hour+.01f)-Tide.At(GameState.I.Day,hour-.01f))/.02f;return new(.16f*Math.Clamp(-rate/1.2f,-1,1)*Math.Clamp(-z/12,.3f,1)*(MoverClock.Sea>2.5f?1.6f:1),0);}
    private bool Drive(float dt)
    {
        var d=Boat;if(d==null||!Navigate())return false;var j=Jef.I;float before=Rower.Heading;
        bool caught=Rower.Step(dt,this,j.KeyDown(Key.W)||j.KeyDown(Key.Up),j.KeyDown(Key.S)||j.KeyDown(Key.Down),j.KeyDown(Key.A)||j.KeyDown(Key.Left),j.KeyDown(Key.D)||j.KeyDown(Key.Right),j.KeyDown(Key.Shift),out float bump);
        if(caught&&!strokePending)_=Stroke(Rower.Hard);bumpT-=dt;if(bump>.45f&&bumpT<=0){bumpT=1.2f;GameState.I.Say("The boat bumps against something. Back water and pull clear.");}
        d.X=Rower.X;d.Z=Rower.Z;d.Yaw=Rower.Heading;d.Root.Transform=new(new Basis(Vector3.Up,d.Yaw)*new Basis(Vector3.Right,Rower.Pitch)*new Basis(Vector3.Back,Rower.Roll),new(d.X,Rower.Y,d.Z));
        PoseOars(d);j.Carry(Rower.Seat,Rower.Heading-before);j.DrivenEye=.78f;j.DrivenRoll=-Rower.Roll*MathF.Cos(j.Yaw-(Rower.Heading+MathF.PI));return true;
    }
    private async Task Stroke(bool hard){strokePending=true;try{var r=await ServerLink.I!.Api!.RowStroke(hard);Answered?.Invoke("stroke",r);}catch(ApiException){}finally{strokePending=false;}}
    private void PoseOars(Drawn d)
    {
        float ph=Rower.Phase,bladeMid=Out-Blade/2,dipIn=MathF.Asin(Math.Min(.95f,(d.Hull.Pin.Y+.06f)/bladeMid)),dipOut=MathF.Asin(Math.Min(.95f,Math.Max(0,d.Hull.Pin.Y-.22f)/bladeMid));
        for(int i=0;i<2;i++)
        {
            float a=i==0?Rower.Port:Rower.Starboard,w=Math.Min(1,Math.Abs(a)*1.5f),th,dp,fe;
            if(ph<.45f){float u=Mathf.SmoothStep(0,1,ph/.45f);th=a>=0?.55f-u:-.45f+u;dp=dipIn;fe=0;}
            else{float u=(ph-.45f)/.55f,k=Mathf.SmoothStep(0,1,u);th=a>=0?-.45f+k:.55f-k;dp=dipOut-MathF.Sin(MathF.PI*Math.Min(1,u*1.2f))*.05f;fe=MathF.Sin(MathF.PI*Math.Min(1,u*1.15f))*MathF.PI/2*.95f;if(u<.08f)dp=Mathf.Lerp(dipIn,dipOut,u/.08f);if(u>.92f)dp=Mathf.Lerp(dipOut,dipIn,(u-.92f)/.08f);}
            th*=w;dp=Mathf.Lerp(dipOut+.04f,dp,w);fe*=w;float side=i==0?1:-1,bx=d.Hull.Pin.X*side+side*bladeMid*MathF.Cos(th),bz=d.Hull.Pin.Z+bladeMid*MathF.Sin(th),hx=d.X+MathF.Cos(d.Yaw)*bx+MathF.Sin(d.Yaw)*bz,hz=d.Z-MathF.Sin(d.Yaw)*bx+MathF.Cos(d.Yaw)*bz;
            float want=((RowPhysics.IWorld)this).Free(hx,hz,.15f)?0:1;d.Shipped[i]+=(want-d.Shipped[i])*.15f;float ship=d.Shipped[i];th=Mathf.Lerp(th,-1.35f,ship);dp=Mathf.Lerp(dp,-.08f,ship);fe=Mathf.Lerp(fe,MathF.PI/2,ship);
            d.Pivot[i].Rotation=new(0,i==0?-th:th,0);d.Dip[i].Rotation=new(0,0,-dp);d.Feather[i].Rotation=new(i==0?fe:-fe,0,0);
        }
    }
    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Play.Rowing");
        float dt=(float)Math.Min(delta,.1);pollT+=dt;if(pollT>(Boat!=null||Data.Hire!=null?3:10)&&!Busy){pollT=0;_=Load();}
        NavigationTraffic(dt);
        foreach(var d in Drawings.Values)if(d!=Boat)
        {if(d.Drift){var c=((RowPhysics.IWorld)this).Current(d.X,d.Z);d.X+=c.X*dt;d.Z+=c.Y*dt;}d.Root.Position=new(d.X,BoatWater.At(d.X,d.Z),d.Z);d.Root.Rotation=new(0,d.Yaw,0);}
    }
}

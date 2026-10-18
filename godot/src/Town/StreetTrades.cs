using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;
using Scheldemist.People;
using Scheldemist.World;
namespace Scheldemist.Town;

/// <summary>The browser's travelling milk, bread and knife-grinding equipment.</summary>
[GamePart(214)]
public partial class StreetTrades : Node
{
    private sealed class Kit
    {
        public Townspeople.Sim Person=null!;public Puppet Puppet=null!;
        public Node3D Root=null!,Body=null!;public Node3D? Wheel,OtherWheel,Stone,Fly;
        public readonly Animal?[] Dogs=new Animal?[2];
        public readonly Vector2[] Trail=new Vector2[40];
        public int Count,DogsN;public double Roll,Speed,Spin;
        public bool Seen;
        // the grinder (#129): pushing his barrow, stepping in between its handles, or at work there; where the barrow
        // stands parked, his wheel's distance ahead of him now, and the barrow's solid box
        public int State;public Vector3 ParkAt;public double ParkYaw,Ahead=GrinderWheelAhead;public Vector2 LastAt,StepTo;public double StepTime,SolidAhead=GrinderWheelAhead;
        public CollisionShape3D? Shape;
        public bool Cart;public Node3D? Bundle;
    }
    // the cart dog: the Belgian draught dog (matin), fawn or brindle
    private static readonly string[] DogLooks={"dog_draught","dog_draught","dog_draught","dog_draught_brindle","dog_draught_brindle"};
    // The handles end 1.6 m behind the wheel. Leave them 30 cm in front of the
    // operator, with room for his body and a walking step before the kit updates.
    private const double GrinderWheelAhead=1.9;
    // The stone's axle sits 0.55 m behind the wheel (barrow_stone below); the grind clip holds the knife to a stone
    // 0.5 m before him (peopleRig.json work.clips.grind.stone): at work he stands between the handles (#129).
    private const double GrinderStoneBehind=.55,GrinderStoneReach=.5;
    private const int Pushing=0,SteppingIn=1,Grinding=2;
    // the barrow's solid while pushed (frame, stone, handles before him) and while he stands in its handles (the
    // frame and the stone before him; the handles beside him are no wall)
    private static readonly (Vector3 Size,Vector3 Centre) GrinderPushed=(new(.7f,1,1.6f),new(0,.5f,-.7f));
    // (it ends 0.6 m before where he stands at the stone: a walker's clearance, so he is never inside his own barrow)
    private static (Vector3 Size,Vector3 Centre) GrinderWorked(double work){float d=.1f+(float)Math.Max(.12,work-.6);return(new(.7f,1,d),new(0,.5f,.1f-d/2));}
    private readonly Dictionary<string,Kit> kits=new();
    /// <summary>The cart dog's place in the cart's frame: its middle this far ahead of the axle (its hindquarters clear the
    /// cross bar at 1.2 m), the second dog this far beside the first (+x, the cart's left), outside the left shaft.</summary>
    private const float DogAhead=1.57f,DogBeside=.44f;
    // the trace hooks on the outer faces of the shafts, the shafts' ends (in the tugs, 0.03 m past them), cart-local;
    // the second dog's traces go to the front corner of the cart's box and to the left shaft
    private static readonly Vector3 HookL=new(.24f,.345f,1.31f),HookR=new(-.24f,.345f,1.31f),TipL=new(.22f,.34f,1.45f),TipR=new(-.22f,.34f,1.45f),HookL2=new(.34f,.5f,.42f),HookL2b=new(.24f,.345f,1.0f);
    private readonly List<string> gone=new(32);
    private Townspeople? town;
    internal bool HasKit(string id)=>kits.ContainsKey(id);
    /// <summary>For a check: the dog carts out now and their first dog.</summary>
    internal IEnumerable<(Node3D root,Animal? dog)> CartDogs{get{foreach(var k in kits.Values)if(k.DogsN>0&&k.Dogs[0]!=null&&k.Root.Visible)yield return(k.Root,k.Dogs[0]);}}
    /// <summary>For a check: the grinder's stone (its axle) and whether he is at work at it.</summary>
    internal (Vector3 Stone,bool Grinding)? GrinderStone(string id)=>kits.TryGetValue(id,out var k)&&k.Stone!=null?(k.Stone.GlobalPosition,k.State==Grinding):null;
    internal Vector3? KitPosition(string id)=>kits.TryGetValue(id,out var k)?k.Bundle!=null?k.Puppet.Group.GlobalPosition:k.Root.GlobalPosition:null;
    public int DogCarts {get;private set;}public int Grinders {get;private set;}
    public override void _Ready(){town=Main.I.GetNodeOrNull<Townspeople>("Townspeople");ModelLibrary.Get("lively",new(TwoSided:true,Affine:0,VertexColor:true));if(Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;}
    private Kit? Make(Townspeople.Sim s,Puppet p)
    {
        var model=ModelLibrary.Get("lively",new(TwoSided:true,Affine:0,VertexColor:true));if(model==null)return null;
        bool grinder=s.R.Trade=="grinder",milk=s.R.Trade=="milk_woman";
        bool cart=s.R.Trade is "ragman" or "coalman" or "mussel_seller",brooms=s.R.Trade=="broom_seller";
        var body=cart||brooms?new Node3D():model.Copy(grinder?"barrow":milk?"dogcart_milk":"dogcart_bread");if(body==null)return null;
        var root=new Node3D{Name="street_trade_"+s.R.Id};root.AddChild(body);Main.I.View.AddChild(root);
        var kit=new Kit{Person=s,Puppet=p,Root=root,Body=body};
        Node3D? Part(string name,Vector3 at){var n=model.Copy(name);if(n!=null){n.Position=at;root.AddChild(n);}return n;}
        if(cart)
        {
            kit.Cart=true;p.Pushes=true;p.Nose=3.3;p.Reach=.6;
            p.Cart=new PushCart(Main.I.View,false);root.Reparent(p.Cart.Root);root.Position=Vector3.Zero;
            for(int i=0;i<3;i++)if(Carried.Load(s.R.Trade=="mussel_seller"?"fishbox":"sack",1) is {} load){load.Position=new((i%2==0?-.24f:.24f),.8f+(i/2)*.25f,0);body.AddChild(load);}
        }
        else if(brooms)
        {
            kit.Bundle=model.Copy("broom_bundle");if(kit.Bundle!=null){kit.Bundle.Position=new(.16f*p.Human.Scale,1.46f*p.Human.Scale,-.05f);kit.Bundle.Rotation=new(-.35f,0,0);p.Group.AddChild(kit.Bundle);}return kit;
        }
        else if(grinder)
        {
            kit.Wheel=Part("barrow_wheel",new(0,.3f,0));kit.Stone=Part("barrow_stone",new(0,1.02f,-.55f));kit.Fly=Part("barrow_fly",new(.3f,.85f,-.8f));Grinders++;p.Nose=GrinderWheelAhead;p.Reach=.4;
        }
        else
        {
            kit.Wheel=Part("dogcart_wheel",new(-.38f,.3f,0));kit.OtherWheel=Part("dogcart_wheel",new(.38f,.3f,0));
            kit.DogsN=milk&&Townspeople.TradeHash("dogs:"+s.R.Id)>=.5?2:1;
            for(int i=0;i<kit.DogsN;i++){var dog=Animal.Make(DogLooks[(int)(Townspeople.TradeHash("dog:"+s.R.Id+":"+i)*DogLooks.Length)],"cart:"+s.R.Id+":"+i);if(dog==null)continue;kit.Dogs[i]=dog;dog.ShowHarness(true);dog.Play("idle");var dogSolid=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};var dogBox=new BoxShape3D{Size=new(.6f,.6f,1)};dogSolid.AddChild(new CollisionShape3D{Shape=dogBox,Position=new(0,.3f,0)});dog.Group.AddChild(dogSolid);WalkMap.RegisterBody(dogSolid,new Aabb(new(-.3f,0,-.5f),dogBox.Size),owner:p);}
            for(int i=0;i<26;i++)kit.Trail[i]=new((float)(p.X-Math.Sin(p.Yaw)*i*.2),(float)(p.Z-Math.Cos(p.Yaw)*i*.2));kit.Count=26;DogCarts++;
        }
        var solid=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
        var shape=new BoxShape3D{Size=cart?new(1.1f,1,1.7f):grinder?new(.7f,1,1.6f):new(.84f,1,1.1f)};var center=grinder?new Vector3(0,.5f,-.7f):new Vector3(0,.5f,-.1f);
        var collision=new CollisionShape3D{Shape=shape,Position=center};solid.AddChild(collision);root.AddChild(solid);WalkMap.RegisterBody(solid,new Aabb(center-shape.Size/2,shape.Size),owner:p);
        if(grinder){kit.Shape=collision;kit.LastAt=new((float)p.X,(float)p.Z);}
        return kit;
    }
    private static Vector2 Behind(Kit k,double distance)
    {
        for(int i=1;i<k.Count;i++){var a=k.Trail[i-1];var b=k.Trail[i];double length=a.DistanceTo(b);if(length>=distance)return a.Lerp(b,(float)(distance/Math.Max(.001,length)));distance-=length;}
        return k.Trail[k.Count-1];
    }
    public override void _Process(double delta)
    {
        if(town?.Crowd==null||town.Paused)return;
        foreach(var k in kits.Values)k.Seen=false;
        foreach(var s in town.Simulations)
        {
            if(s.ActionHeld||s.Inside||s.Goal.Mode!="patrol"||s.R.Work.Kind!="round"||s.R.Trade is not ("milk_woman" or "baker_boy" or "grinder" or "ragman" or "coalman" or "mussel_seller" or "broom_seller")||s.P is not {} p)continue;
            if(kits.TryGetValue(s.R.Id,out var old)&&old.Puppet!=p){Remove(s.R.Id);old=null;}
            var k=old??Make(s,p);if(k==null)continue;kits[s.R.Id]=k;k.Seen=true;
            bool moving=town.Crowd.PuppetBusy(p);double dt=Math.Min(.1,delta);
            if(k.Cart){town.Crowd.PuppetLantern(p,s.R.Trade=="mussel_seller"&&town.Hour>=18.25);continue;}
            if(s.R.Trade=="broom_seller")continue;
            if(s.R.Trade=="grinder")Grind(k,p,moving,dt);
            else
            {
                var current=new Vector2((float)p.X,(float)p.Z);double step=current.DistanceTo(k.Trail[0]);k.Speed+=(Math.Min(3,step/Math.Max(.001,dt))-k.Speed)*Math.Min(1,dt*5);
                if(step>.2){for(int i=Math.Min(39,k.Count);i>0;i--)k.Trail[i]=k.Trail[i-1];k.Trail[0]=current;k.Count=Math.Min(40,k.Count+1);}else k.Trail[0]=current;
                // the dog stands in the shafts: its harness's tugs carry the shaft ends and its traces run back to the
                // hooks on the shafts (lively.glb dogcart: shafts at x +-0.22, 0.34 m up, their ends 1.45 m ahead of the
                // axle); a second dog pulls beside the left shaft
                Vector2 headAt=Behind(k,.4),cartAt=Behind(k,2.2);var dir=headAt-cartAt;double yaw=dir.LengthSquared()>.001?Math.Atan2(dir.X,dir.Y):p.Yaw;var right=new Vector2((float)Math.Cos(yaw),(float)-Math.Sin(yaw));var fwd=new Vector2((float)Math.Sin(yaw),(float)Math.Cos(yaw));cartAt-=right*.55f;
                k.Root.Position=new(cartAt.X,(float)town.Walk!.BaseAt(cartAt.X,cartAt.Y),cartAt.Y);k.Root.Rotation=new(0,(float)yaw,0);k.Roll+=k.Speed*dt/.3;
                if(k.Wheel!=null)k.Wheel.Rotation=new((float)k.Roll,0,0);if(k.OtherWheel!=null)k.OtherWheel.Rotation=new((float)k.Roll,0,0);
                for(int i=0;i<k.DogsN;i++)if(k.Dogs[i] is {} dog){var a=cartAt+fwd*DogAhead+right*(i==0?0:DogBeside);dog.Group.Position=new(a.X,(float)town.Walk.BaseAt(a.X,a.Y),a.Y);dog.Group.Rotation=new(0,(float)yaw,0);dog.Play(k.Speed>.15?"walk":"idle");dog.Update((float)dt);dog.Group.Visible=p.Shown;
                    if(p.Shown){var xf=k.Root.GlobalTransform;dog.Hitch(xf*(i==0?HookL:HookL2),xf*(i==0?HookR:HookL2b),i==0?xf*TipL:(Vector3?)null,i==0?xf*TipR:(Vector3?)null);}}
            }
            k.Root.Visible=p.Shown;
        }
        gone.Clear();foreach(var pair in kits)if(!pair.Value.Seen)gone.Add(pair.Key);foreach(var id in gone)Remove(id);
    }
    /// <summary>The knife grinder and his barrow (#129). He pushes it by its handles' ends; where he stops he parks it,
    /// steps in between its handles to the stone and grinds there with the knife on the stone; going on, he pushes
    /// it out ahead of him again.</summary>
    private void Grind(Kit k,Puppet p,bool moving,double dt)
    {
        var here=new Vector2((float)p.X,(float)p.Z);double walked=here.DistanceTo(k.LastAt);k.LastAt=here;
        double work=GrinderStoneBehind+GrinderStoneReach*p.Human.WorkRatio("grind");
        Vector3 at;double yaw;
        if(k.State==Pushing)
        {
            // the barrow goes out ahead of him to the pushing reach (at once once it is there)
            k.Ahead=Math.Min(GrinderWheelAhead,k.Ahead+walked);
            // (its solid grows back to the handles' ends only as he falls back behind them)
            if(k.State==Pushing&&Math.Abs(k.Ahead-k.SolidAhead)>.1&&k.SolidAhead<GrinderWheelAhead){k.SolidAhead=k.Ahead>=GrinderWheelAhead-.01?GrinderWheelAhead:k.Ahead;BarrowSolid(k,k.SolidAhead>=GrinderWheelAhead?GrinderPushed:GrinderWorked(k.SolidAhead));}
            double x=p.X+Math.Sin(p.Yaw)*k.Ahead,z=p.Z+Math.Cos(p.Yaw)*k.Ahead;
            at=new((float)x,(float)town!.Walk!.BaseAt(x,z),(float)z);yaw=p.Yaw;
            if(!moving&&k.Ahead>=GrinderWheelAhead-.01)
            {
                // stopped: the barrow stays; he steps in to the stone
                k.ParkAt=at;k.ParkYaw=yaw;k.State=SteppingIn;k.StepTime=0;
                // (where the ground there is no place to stand, as close to the stone as it lets him)
                while(work<GrinderWheelAhead-.05&&!town.Walk.FreeFor(p,x-Math.Sin(yaw)*work,z-Math.Cos(yaw)*work))work+=.1;
                k.StepTo=new((float)(x-Math.Sin(yaw)*work),(float)(z-Math.Cos(yaw)*work));
                if(!p.Remote)town.Crowd!.PuppetGo(p,k.StepTo.X,k.StepTo.Y,.6); // (a guest sees the host's step)
                k.SolidAhead=work;BarrowSolid(k,GrinderWorked(work));
            }
            else if(!moving&&!p.Remote)town.Crowd!.PuppetStand(p,"idle",p.Yaw);
        }
        else
        {
            at=k.ParkAt;yaw=k.ParkYaw;
            if(k.State==SteppingIn)
            {
                k.StepTime+=dt;
                if(!moving&&(here.DistanceTo(k.StepTo)<.15||k.StepTime>4)){k.State=Grinding;if(!p.Remote){p.X=k.StepTo.X;p.Z=k.StepTo.Y;k.LastAt=k.StepTo;}}
            }
            if(k.State==Grinding)
            {
                if(moving)
                {
                    // on his way again: he pushes the barrow out before him from where it stands
                    k.State=Pushing;k.Ahead=Math.Max(0,(new Vector2(at.X,at.Z)-here).Length());
                }
                else if(!p.Remote)town.Crowd!.PuppetStand(p,"grind",yaw);
            }
        }
        double step=k.Root.Position.DistanceTo(at);k.Root.Position=at;k.Root.Rotation=new(0,(float)yaw,0);
        k.Roll+=step/.3;k.Spin+=k.State==Grinding&&!moving?dt*14:0;
        if(k.Wheel!=null)k.Wheel.Rotation=new((float)k.Roll,0,0);if(k.Stone!=null)k.Stone.Rotation=new((float)k.Spin,0,0);if(k.Fly!=null)k.Fly.Rotation=new((float)(k.Spin*.6),0,0);
    }
    private static void BarrowSolid(Kit k,(Vector3 Size,Vector3 Centre) box)
    {
        if(k.Shape?.Shape is not BoxShape3D shape)return;
        shape.Size=box.Size;k.Shape.Position=box.Centre;
        if(k.Shape.GetParent() is StaticBody3D body)
        {
            WalkMap.ResizeBody(body,new Aabb(box.Centre-box.Size/2,box.Size));
            // the barrow set down grows round whoever passes it: ease them out (the stuck check found one inside, 2026-10-18)
            Main.I.GetNodeOrNull<Townspeople>("Townspeople")?.Crowd?.MoveOutOf(body.GlobalTransform*new Aabb(box.Centre-box.Size/2,box.Size));
        }
    }
    private void Remove(string id){if(!kits.Remove(id,out var k))return;if(GodotObject.IsInstanceValid(k.Root))k.Root.QueueFree();if(GodotObject.IsInstanceValid(k.Bundle))k.Bundle!.QueueFree();if(k.Cart){k.Puppet.Pushes=false;k.Puppet.Nose=0;k.Puppet.Reach=.3;town?.Crowd?.PuppetLantern(k.Puppet,false);}foreach(var dog in k.Dogs)dog?.Dispose();if(k.Person.R.Trade=="grinder"){Grinders--;k.Puppet.Nose=0;k.Puppet.Reach=.3;}else if(k.DogsN>0)DogCarts--;}
    private void Reset(string how,Net.ClientState? state){gone.Clear();foreach(var id in kits.Keys)gone.Add(id);foreach(var id in gone)Remove(id);}
    public override void _ExitTree(){Reset("exit",null);if(Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}
public partial class Townspeople{internal static double TradeHash(string id)=>LifeHash(id);}

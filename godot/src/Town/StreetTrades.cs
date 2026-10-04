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
        public bool Cart;public Node3D? Bundle;
    }
    private static readonly string[] DogLooks={"dog_brown","dog_black","dog_spotted","dog_grey"};
    private readonly Dictionary<string,Kit> kits=new();
    private readonly List<string> gone=new(32);
    private Townspeople? town;
    internal bool HasKit(string id)=>kits.ContainsKey(id);
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
            kit.Wheel=Part("barrow_wheel",new(0,.3f,0));kit.Stone=Part("barrow_stone",new(0,1.02f,-.55f));kit.Fly=Part("barrow_fly",new(.3f,.85f,-.8f));Grinders++;p.Nose=1.3;p.Reach=.4;
        }
        else
        {
            kit.Wheel=Part("dogcart_wheel",new(-.38f,.3f,0));kit.OtherWheel=Part("dogcart_wheel",new(.38f,.3f,0));
            kit.DogsN=milk&&Townspeople.TradeHash("dogs:"+s.R.Id)>=.5?2:1;
            for(int i=0;i<kit.DogsN;i++){var dog=Animal.Make(DogLooks[(int)(Townspeople.TradeHash("dog:"+s.R.Id+":"+i)*4)]);if(dog==null)continue;kit.Dogs[i]=dog;Main.I.View.AddChild(dog.Group);var harness=model.Copy("harness");if(harness!=null){harness.Position=new(0,-.06f,.18f);dog.Group.AddChild(harness);}dog.Play("idle");var dogSolid=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};var dogBox=new BoxShape3D{Size=new(.6f,.6f,1)};dogSolid.AddChild(new CollisionShape3D{Shape=dogBox,Position=new(0,.3f,0)});dog.Group.AddChild(dogSolid);WalkMap.RegisterBody(dogSolid,new Aabb(new(-.3f,0,-.5f),dogBox.Size),owner:p);}
            for(int i=0;i<26;i++)kit.Trail[i]=new((float)(p.X-Math.Sin(p.Yaw)*i*.2),(float)(p.Z-Math.Cos(p.Yaw)*i*.2));kit.Count=26;DogCarts++;
        }
        var solid=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
        var shape=new BoxShape3D{Size=cart?new(1.1f,1,1.7f):grinder?new(.7f,1,1.6f):new(.84f,1,1.1f)};var center=grinder?new Vector3(0,.5f,-.7f):new Vector3(0,.5f,-.1f);
        solid.AddChild(new CollisionShape3D{Shape=shape,Position=center});root.AddChild(solid);WalkMap.RegisterBody(solid,new Aabb(center-shape.Size/2,shape.Size),owner:p);
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
            if(s.R.Trade=="grinder")
            {
                double x=p.X+Math.Sin(p.Yaw)*1.6,z=p.Z+Math.Cos(p.Yaw)*1.6;
                var at=new Vector3((float)x,(float)town.Walk!.BaseAt(x,z),(float)z);double step=k.Root.Position.DistanceTo(at);k.Root.Position=at;k.Root.Rotation=new(0,(float)p.Yaw,0);
                k.Roll+=moving?step/.3:0;k.Spin+=moving?0:dt*14;
                if(k.Wheel!=null)k.Wheel.Rotation=new((float)k.Roll,0,0);if(k.Stone!=null)k.Stone.Rotation=new((float)k.Spin,0,0);if(k.Fly!=null)k.Fly.Rotation=new((float)(k.Spin*.6),0,0);
                if(!moving)town.Crowd.PuppetStand(p,"grind",p.Yaw);
            }
            else
            {
                var current=new Vector2((float)p.X,(float)p.Z);double step=current.DistanceTo(k.Trail[0]);k.Speed+=(Math.Min(3,step/Math.Max(.001,dt))-k.Speed)*Math.Min(1,dt*5);
                if(step>.2){for(int i=Math.Min(39,k.Count);i>0;i--)k.Trail[i]=k.Trail[i-1];k.Trail[0]=current;k.Count=Math.Min(40,k.Count+1);}else k.Trail[0]=current;
                Vector2 dogAt=Behind(k,.5),cartAt=Behind(k,2);var dir=dogAt-cartAt;double yaw=dir.LengthSquared()>.001?Math.Atan2(dir.X,dir.Y):p.Yaw;var right=new Vector2((float)Math.Cos(yaw),(float)-Math.Sin(yaw));dogAt-=right*.55f;cartAt-=right*.55f;
                k.Root.Position=new(cartAt.X,(float)town.Walk!.BaseAt(cartAt.X,cartAt.Y),cartAt.Y);k.Root.Rotation=new(0,(float)yaw,0);k.Roll+=k.Speed*dt/.3;
                if(k.Wheel!=null)k.Wheel.Rotation=new((float)k.Roll,0,0);if(k.OtherWheel!=null)k.OtherWheel.Rotation=new((float)k.Roll,0,0);
                for(int i=0;i<k.DogsN;i++)if(k.Dogs[i] is {} dog){var a=dogAt+right*(k.DogsN==1?0:i==0?-.2f:.2f);dog.Group.Position=new(a.X,(float)town.Walk.BaseAt(a.X,a.Y),a.Y);dog.Group.Rotation=new(0,(float)yaw,0);dog.Play(k.Speed>.15?"walk":"idle");dog.Update((float)dt);dog.Group.Visible=p.Shown;}
            }
            k.Root.Visible=p.Shown;
        }
        gone.Clear();foreach(var pair in kits)if(!pair.Value.Seen)gone.Add(pair.Key);foreach(var id in gone)Remove(id);
    }
    private void Remove(string id){if(!kits.Remove(id,out var k))return;k.Root.QueueFree();k.Bundle?.QueueFree();if(k.Cart){k.Puppet.Pushes=false;k.Puppet.Nose=0;k.Puppet.Reach=.3;town?.Crowd?.PuppetLantern(k.Puppet,false);}foreach(var dog in k.Dogs)dog?.Dispose();if(k.Person.R.Trade=="grinder"){Grinders--;k.Puppet.Nose=0;k.Puppet.Reach=.3;}else if(k.DogsN>0)DogCarts--;}
    private void Reset(string how,Net.ClientState? state){gone.Clear();foreach(var id in kits.Keys)gone.Add(id);foreach(var id in gone)Remove(id);}
    public override void _ExitTree(){Reset("exit",null);if(Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}
public partial class Townspeople{internal static double TradeHash(string id)=>LifeHash(id);}

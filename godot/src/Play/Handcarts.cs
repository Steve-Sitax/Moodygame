using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
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

[GamePart(923)]
public partial class Handcarts : Node, CartPhysics.IWorld
{
    public static Handcarts I { get; private set; } = null!;
    public sealed class Drawn
    {
        public HandcartInfo Info=new();
        public Node3D Root=null!, Bed=null!, Wheels=null!;
        public StaticBody3D Body=null!;
        public readonly Godot.Collections.Array<Rid> Exclude=new();
        public float WheelAngle,Tilt,Hold;
        public float X,Z,Yaw;
    }
    public readonly Dictionary<string,Drawn> Drawings=new();
    public string? Held { get; private set; }
    public bool Busy { get; private set; }
    public CartView View { get; private set; }=new();
    public event Action<string,CartReply>? Answered;
    private Node3D root=null!;
    private ModelLibrary.Model? props;
    private RayCast3D floor=null!;
    private MoverOverlap overlap=null!;
    private readonly Godot.Collections.Array<Rid> none=new();
    private Func<Item,bool>? otherHeld;
    private Func<(int Kind,int Sub,float Heading)?>? otherGear;
    private readonly Func<Vector2,Vector2,float,Vector2> step;
    private float dir,pollT,sendT,seenT;
    private Vector2 lastSent;
    private int? jobSeen;
    private int epoch,notice=-1;
    private bool polling,sending;
    private Task sendTask=Task.CompletedTask;
    private Interact.Entry? shopPrompt;
    private readonly List<Node3D> shopModels=new();
    private readonly List<Rect2> craneRails=new();
    public Handcarts() { I=this; step=Step; }
    public override void _Ready()
    {
        root=new Node3D {Name="jef_handcarts"}; Main.I.View.AddChild(root);
        props=ModelLibrary.Get("props");
        using(var city=JsonDocument.Parse(File.ReadAllText(Water.CityJson())))
            foreach(var rail in city.RootElement.GetProperty("decor").GetProperty("crane_rails").EnumerateArray())
            {float x0=rail[0].GetSingle(),z0=rail[1].GetSingle(),x1=rail[2].GetSingle(),z1=rail[3].GetSingle();craneRails.Add(new Rect2(Math.Min(x0,x1)-.6f,Math.Min(z0,z1)-.6f,Math.Abs(x1-x0)+1.2f,Math.Abs(z1-z0)+1.2f));}
        floor=new RayCast3D {Name="handcart_floor",Enabled=false,CollisionMask=Solid.Layer,TargetPosition=new(0,-60,0)}; Main.I.View.AddChild(floor);
        overlap=new MoverOverlap();
        otherHeld=Goods.I.ShowHeld; Goods.I.ShowHeld=ShowHeld;
        Jobs.I.CartCarryAction=CarryAction;
        Interact.I.AddProvider(Keys);
        if(Together.I is { } together) {otherGear=together.Gear;together.Gear=Gear;}
        if(Scheldemist.Menu.MainMenu.I is { } menu)menu.WorldReplaced+=Replaced;
        ServerLink.I?.WhenUp(()=>_ = Load());
    }
    public override void _ExitTree()
    {
        ClearHold(); Goods.I.ShowHeld=otherHeld; Jobs.I.CartCarryAction=null;
        if(Together.I is { } together)together.Gear=otherGear;
        if(Scheldemist.Menu.MainMenu.I is { } menu)menu.WorldReplaced-=Replaced;
        shopPrompt?.Dispose();
    }
    private (int Kind,int Sub,float Heading)? Gear() => Held!=null?(MpProtocol.GearHandcart,0,dir+MathF.PI):otherGear?.Invoke();
    private void Forget(Drawn d)
    {foreach(var it in Goods.I.All.Values)if(it.Obj is { } obj&&obj.GetParent()==d.Bed){obj.Reparent(root,true);obj.Visible=false;}d.Root.QueueFree();}
    private void Replaced(string how,ClientState? client) { epoch++;ClearHold(); foreach(var d in Drawings.Values)Forget(d);Drawings.Clear();shopPrompt?.Dispose();shopPrompt=null;foreach(var model in shopModels)model.QueueFree();shopModels.Clear();_ = Load(true); }
    public async Task Load(bool restore=false)
    {
        var api=ServerLink.I?.Api;if(api==null||polling)return;polling=true;int e=epoch;
        try
        {
            var v=await api.Carts();if(e!=epoch)return;
            if(restore || Held==null)
                foreach(var c in v.List.Where(c=>c.Held)) {await api.CartRelease(c.Id,c.X,c.Z,c.Yaw);if(e!=epoch)return;}
            if(v.List.Any(c=>c.Held)&&Held==null)v=await api.Carts();
            Apply(v);
            foreach(var c in v.List.Where(c=>c.Kind=="lent"&&!c.Placed).ToArray())await PlaceLent(c);
            if(restore)Goods.I.RefreshCartGoods();
        }
        catch(ApiException ex) {if(restore)GameState.I.Say(ex.Message);}
        finally {polling=false;}
    }
    public void Apply(CartView v)
    {
        View=v;
        foreach(var id in Drawings.Keys.Where(id=>!v.List.Any(c=>c.Id==id)).ToArray())
        { if(id==Held)ClearHold();Forget(Drawings[id]);Drawings.Remove(id); }
        foreach(var c in v.List)
        {
            if(!Drawings.TryGetValue(c.Id,out var d)) {d=Make(c);if(d==null)continue;Drawings.Add(c.Id,d);}
            d.Info=c.Id==Held?c with {X=d.Info.X,Z=d.Info.Z,Yaw=d.Info.Yaw,Held=true}:c;
            if(c.Id!=Held){d.X=c.X;d.Z=c.Z;d.Yaw=c.Yaw;}
            Park(d); DressLoad(d);
        }
        if(v.Notice is { } n&&n.N!=notice){notice=n.N;GameState.I.Say(n.Text);}
        if(shopPrompt==null&&v.Shop is {Step.Length:>=2} shop)
        {
            shopPrompt=Interact.I.Add(new Interact.Entry {Place=new(shop.Step[0],1.4f,shop.Step[1]),Reach=2.4f,Label=()=>"the wheelwright's wares",Run=()=>Scheldemist.Talks.Shop.I?.OpenAt(shop.Id,shop.Label)});
            foreach(var at in shop.Show)
                if(at.Length>=3&&props?.Copy("tr_handcart") is { } body&&props.Copy("tr_handcart_wheels") is { } wheel)
                { var display=new Node3D {Position=new(at[0],0,at[1]),Rotation=new(0,at[2]+MathF.PI,0)};root.AddChild(display);display.AddChild(body);display.AddChild(wheel);wheel.Position=new(0,.57f,0);shopModels.Add(display); }
        }
    }
    private Drawn? Make(HandcartInfo c)
    {
        var body=props?.Copy("tr_handcart");var wheels=props?.Copy("tr_handcart_wheels");
        if(body==null||wheels==null){body?.Free();wheels?.Free();return null;}
        var d=new Drawn {Info=c,X=c.X,Z=c.Z,Yaw=c.Yaw,Root=new Node3D {Name="handcart_"+c.Id[5..]},Bed=new Node3D {Name="bed",Position=new(0,.57f,0)},Wheels=wheels,Body=new StaticBody3D {CollisionLayer=Solid.Layer,CollisionMask=0}};
        root.AddChild(d.Root);d.Root.AddChild(d.Bed);d.Bed.AddChild(body);body.Position=new(0,-.57f,0);d.Root.AddChild(wheels);wheels.Position=new(0,.57f,0);d.Root.AddChild(d.Body);
        d.Body.AddChild(new CollisionShape3D {Shape=new BoxShape3D {Size=new(1.44f,.65f,1.9f)},Position=new(0,.65f,0)});
        d.Body.AddChild(new CollisionShape3D {Shape=new BoxShape3D {Size=new(.8f,.12f,1.55f)},Position=new(0,.65f,1.68f)});
        d.Exclude.Add(d.Body.GetRid());return d;
    }
    private void Park(Drawn d)
    {
        d.Root.Position=new(d.X,0,d.Z);d.Root.Rotation=new(0,d.Yaw+MathF.PI,0);d.Body.CollisionLayer=d.Info.Id==Held?0:Solid.Layer;
    }
    private bool ShowHeld(Item it)
    {
        if(it.S.By is {ValueKind:JsonValueKind.Object} by&&by.TryGetProperty("cart",out var q)&&q.ValueKind==JsonValueKind.String)
        {
            string holder=q.GetString()!;string prefix=$"hc:{Goods.I.Me}:";
            if(holder.StartsWith(prefix,StringComparison.Ordinal)&&Drawings.TryGetValue(holder[prefix.Length..],out var d)) {DressLoad(d);return true;}
        }
        return otherHeld?.Invoke(it)==true;
    }
    private void DressLoad(Drawn d)
    {
        Span<float> tops=stackalloc float[4];tops.Fill(.2f);
        // Stable item order, so a refresh never shuffles the load.
        int n=0;
        foreach(var pair in d.Info.Load.Select((it,i)=>(it,i)).OrderBy(p=>p.it.Gid??"~"+p.i))
        {
            var load=pair.it;int i=n++,k=i%4;
            if(load.Gid==null||!Goods.I.All.TryGetValue(load.Gid,out var item)||item.Obj==null)continue;
            var obj=item.Obj;if(obj.GetParent()!=d.Bed)obj.Reparent(d.Bed,false);
            obj.Visible=true;obj.Scale=Vector3.One*.6f;
            obj.Position=new(k%2==0?-.26f:.26f,tops[k],k<2?-.42f:.3f);obj.Rotation=new(0,(i*.37f)%.3f-.15f,0);
            tops[k]+=(float)(item.S.H??GoodsRules.Of(item.Kind).H)*.6f;
        }
    }
    private static float CartDistance(Drawn d,float x,float z)
    {float sx=MathF.Sin(d.Yaw),cz=MathF.Cos(d.Yaw),t=Math.Clamp((x-d.X)*sx+(z-d.Z)*cz,-2.15f,.95f);return new Vector2(x-d.X-sx*t,z-d.Z-cz*t).Length();}
    private Drawn? Nearest(float x,float z)
    {
        Drawn? best=null;float bd=2.4f;
        foreach(var d in Drawings.Values)
        {
            float dist=CartDistance(d,x,z);if(dist<bd){bd=dist;best=d;}
        }
        return best;
    }
    private Act? CarryAction(Item item,float x,float z)
    {
        if(Held!=null||Jef.I.Riding||Nearest(x,z) is not { } d)return null;
        return Act.At(Key.E,$"put the {GoodsRules.Of(item.Kind).One} on the cart",new(d.X,Jef.I.Y+.7f,d.Z),()=>_ = LoadGoods(d,item));
    }
    private Offers? Keys(float x,float z)
    {
        if(Held!=null&&Drawings.TryGetValue(Held,out var held))
        {var acts=new List<Act> {Act.Me(Key.E,"let go of the handcart",()=>_ = Release())};if(UnloadAction(held) is { } all)acts.Add(all);return new Offers {Only=acts};}
        if(Jef.I.Riding||Jef.I.Swimming||Jef.I.Climbing||Goods.I.Carried!=null||Nearest(x,z) is not { } d)return null;
        var c=d.Info;var at=new Vector3(d.X,Jef.I.Y+.7f,d.Z);
        string label=c.Kind=="hire"?"take the hired handcart":c.Kind=="lent"?"take "+c.Label:c.Kind=="taken"?"take the handcart":"take your handcart";
        var extras=new List<Act>();if(c.Load.Count>0)extras.Add(Act.At(Key.G,"lift the load off the cart",at,()=>_ = Unload(d)));
        if(UnloadAction(d) is { } all2)extras.Add(all2);
        return new Offers {Options=new() {(CartDistance(d,x,z),Act.At(Key.E,label,at,()=>_ = Grip(d)))},Extra=extras};
    }
    private Act? UnloadAction(Drawn d)
    {
        foreach(var job in Jobs.I.InHand())
        {
            var task=JobTask.Of(job);
            if(task?.Kind!="carry"||task.Twist=="foreman_watches"||!d.Info.Load.Any(l=>l.Job==job.Id)||Spots.Get(task.To) is not { } to)continue;
            if(new Vector2(Jef.I.X-to.X,Jef.I.Z-to.Z).Length()<=4.5f)return Act.Me(Key.F,"unload the job's goods here",()=>_ = Unload(d,job.Id));
        }
        return null;
    }
    public async Task Grip(Drawn d)
    {
        if(Busy||Held!=null||Jef.I.Laden||Jef.I.Riding)return;Busy=true;int e=++epoch;
        try
        {
            var r=await ServerLink.I!.Api!.CartHold(d.Info.Id,Jef.I.X,Jef.I.Z);if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Carts);Answered?.Invoke("hold",r);
            d.Body.CollisionLayer=0;
            var c=d.Info;dir=c.Yaw;
            var p=new Vector2(c.X-MathF.Sin(dir)*2.6f,c.Z-MathF.Cos(dir)*2.6f);
            if(!Jef.I.StandFree(p.X,p.Y,0)){p=new(Jef.I.X,Jef.I.Z);dir=MathF.Atan2(c.X-p.X,c.Z-p.Y);}
            Held=c.Id;d.Body.CollisionLayer=0;Jef.I.Place(p.X,p.Y,dir-MathF.PI,Jef.I.Pitch);Jef.I.Laden=true;Jef.I.CartStep=step;
            sendT=0;lastSent=new(d.X,d.Z);GameState.I.Say("You take the shafts. W pushes, the mouse turns the cart with you. E lets go.");
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    private void ClearHold()
    {
        Held=null;if(Jef.I.CartStep==step)Jef.I.CartStep=null;Jef.I.Laden=Goods.I.Carried!=null;Jef.I.SpeedFactor=1;
    }
    public async Task Release(bool force=false,bool keepParked=false)
    {
        if(Busy||Held==null||!Drawings.TryGetValue(Held,out var d))return;
        var p=new CartPhysics.Pose(Jef.I.X,Jef.I.Z,dir);
        if(!force)for(int i=0;i<11;i++){var q=CartPhysics.Point(p,i);if(OnRails(q.X,q.Y)){GameState.I.Say("Not on the rails: the railway and cranes need them clear. Push it clear first.");return;}}
        Busy=true;int e=++epoch;string id=Held;var axle=keepParked?new Vector2(d.X,d.Z):CartPhysics.Axle(p);ClearHold();d.X=axle.X;d.Z=axle.Y;d.Yaw=dir;d.Info=d.Info with {X=axle.X,Z=axle.Y,Yaw=dir,Held=false};Park(d);
        try{await sendTask;if(e!=epoch)return;var r=await ServerLink.I!.Api!.CartRelease(id,axle.X,axle.Y,dir);if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Carts);Answered?.Invoke("release",r);}
        catch(ApiException ex){GameState.I.Say(ex.Message);await Load();}finally{Busy=false;}
    }
    public async Task LoadGoods(Drawn d,Item item)
    {
        if(Busy)return;Busy=true;int e=++epoch;
        try
        {
            var r=await ServerLink.I!.Api!.CartLoad(d.Info.Id,new CartLoad {Kind=item.Kind,Gid=item.Id,Job=item.JobId,Owner=item.S.Owner,Broken=item.Broken,Heavy=item.Heavy},Jef.I.X,Jef.I.Z);
            if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Carts);Goods.I.MoveOntoCart(item,$"hc:{Goods.I.Me}:{d.Info.Id}");DressLoad(d);Answered?.Invoke("load",r);
            GameState.I.Say($"On the cart: {d.Info.Load.Count} things ({d.Info.Kg} kg).");
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    public async Task Unload(Drawn d,int? job=null)
    {
        if(Busy)return;Busy=true;int e=++epoch;
        try
        {
            var r=await ServerLink.I!.Api!.CartUnload(d.Info.Id,Jef.I.X,Jef.I.Z,job);if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Carts);
            if(r.Goods is { } json)
            {
                if(json.ValueKind==JsonValueKind.Array)foreach(var g in json.EnumerateArray()) {var it=Goods.I.CartGoods(g.Deserialize<GoodsItem>(Api.Json)!);if(it!=null&&job!=null)Jobs.I.CartDelivered(job.Value,it);}
                else if(json.ValueKind==JsonValueKind.Object&&Goods.I.CartGoods(json.Deserialize<GoodsItem>(Api.Json)!) is { } it)Jobs.I.CartLifted(it);
            }
            Answered?.Invoke(job==null?"unload one":"unload job",r);
            GameState.I.Say(job==null?"You lift it off the cart.":"You tip the goods off the cart and stack them at the goal.");
        }
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
    private async Task PlaceLent(HandcartInfo c)
    {
        if(!Drawings.TryGetValue(c.Id,out var d))return;
        d.Body.CollisionLayer=0; Vector3? best=null;
        for(int ring=0;ring<=4&&best==null;ring++)for(int k=0;k<(ring==0?1:16)&&best==null;k++)
        {
            float a=k*MathF.Tau/16,x=c.X+MathF.Cos(a)*ring*.75f,z=c.Z+MathF.Sin(a)*ring*.75f;
            for(int turn=0;turn<4;turn++) {float yaw=c.Yaw+turn*MathF.PI/2;var p=new CartPhysics.Pose(x-MathF.Sin(yaw)*2.6f,z-MathF.Cos(yaw)*2.6f,yaw);if(CartPhysics.Misfit(p,this)==0&&Jef.I.StandFree(p.X,p.Z,0)){best=new(x,z,yaw);break;}}
        }
        d.Body.CollisionLayer=Solid.Layer;
        var v=best??new(c.X,c.Z,c.Yaw);var r=await ServerLink.I!.Api!.CartPlace(c.Id,v.X,v.Y,v.Z);Apply(r.Carts);
    }
    public Vector2 Step(Vector2 from,Vector2 to,float dt)
    {
        var p=CartPhysics.Step(new(from.X,from.Y,dir),to,Jef.I.Yaw+MathF.PI,dt,this,Jef.I.Y);dir=p.Dir;return new(p.X,p.Z);
    }
    public bool OnRails(float x,float z)
    {if(Railway.I.OnRails(x,z))return true;foreach(var band in craneRails)if(band.HasPoint(new(x,z)))return true;return false;}
    bool CartPhysics.IWorld.Water(float x,float z)=>Water.In(x,z)&&!(x>5&&x<9&&z>-12&&z<0);
    float CartPhysics.IWorld.Base(float x,float z)
    {floor.GlobalPosition=new(x,.5f,z);floor.ForceRaycastUpdate();return floor.IsColliding()?floor.GetCollisionPoint().Y:float.NegativeInfinity;}
    bool CartPhysics.IWorld.Free(float x,float z,float radius)
    {var ex=Held!=null&&Drawings.TryGetValue(Held,out var d)?d.Exclude:none;return overlap.Free(this,ex,new(x,z),radius);}
    int CartPhysics.IWorld.People(CartPhysics.Pose p)
    {int n=0;foreach(var person in StreetPeople.Walking())for(int i=0;i<11;i++){var q=CartPhysics.Point(p,i);if(new Vector2((float)person.X-q.X,(float)person.Z-q.Y).Length()<q.Z+.25f)n++;}return n;}
    public override void _Process(double delta)
    {
        float dt=(float)delta;pollT+=dt;seenT+=dt;
        if(Held!=null&&Drawings.TryGetValue(Held,out var d))
        {
            var j=Jef.I;var axle=CartPhysics.Axle(new(j.X,j.Z,dir));
            if(j.Riding||j.Swimming||j.Climbing||axle.DistanceTo(new(d.X,d.Z))>3){_ = Release(true,true);return;}
            j.Laden=true;j.SpeedFactor=MathF.Round((.85f-.3f*Math.Clamp(d.Info.Kg/Math.Max(1,View.Limit.Kg),0,1))*100)/100;
            d.WheelAngle-=((axle.X-d.X)*MathF.Sin(dir)+(axle.Y-d.Z)*MathF.Cos(dir))/.57f;d.Wheels.Rotation=new(d.WheelAngle,0,0);
            d.X=axle.X;d.Z=axle.Y;d.Yaw=dir;Park(d);sendT+=dt;
            if(sendT>3&&axle.DistanceTo(lastSent)>1&&!sending&&!Busy){sendT=0;lastSent=axle;sendTask=Send(d.Info with {X=d.X,Z=d.Z,Yaw=d.Yaw});}
        }
        foreach(var cart in Drawings.Values)
        {
            cart.Root.Visible=new Vector2(cart.X-Jef.I.X,cart.Z-Jef.I.Z).LengthSquared()<70*70;
            cart.Hold+=((cart.Info.Id==Held?1:0)-cart.Hold)*Math.Min(1,dt*3);
            float rho=MathF.Sqrt(.18f*.18f+2.15f*2.15f),want=(MathF.Atan2(.18f,2.15f)-MathF.Asin(.31f/rho))*cart.Hold;
            cart.Tilt+=(want-cart.Tilt)*Math.Min(1,dt*6);cart.Bed.Rotation=new(cart.Tilt,0,0);
        }
        int? job=Jobs.I.Active?.Id;if(job!=jobSeen){jobSeen=job;pollT=Math.Max(pollT,11);}
        if(pollT>12&&!Busy){pollT=0;_ = Load();}
        if(seenT>5&&Drawings.Count>0&&ServerLink.I?.Api is { } api){seenT=0;api.Run(api.CartSeen(Jef.I.X,Jef.I.Z),_=>{});}
    }
    private async Task Send(HandcartInfo c)
    {sending=true;try{await ServerLink.I!.Api!.CartAt(c.Id,c.X,c.Z,c.Yaw);}catch(ApiException){}finally{sending=false;}}
}

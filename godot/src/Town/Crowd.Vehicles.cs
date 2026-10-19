using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.Movers;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.World;
using Handcart = Scheldemist.People.PushCart;

namespace Scheldemist.Town;

internal sealed class NativePersonVehicle
{
    public int Kind, Load, Goods;
    public double X, Z, Distance, Speed, Nose, Reach;
    public float Size;
    public Node3D? Root, Front, Rear, Steer;
    public Handcart? Cart;
    public NativeLedDray? Dray;
    public readonly List<Node3D> Items = new();
    public bool InitialHeading;
    public Func<double,double,double,double,bool>? ClearSpoke;
    public Func<double,double,bool>? ClearGrip;
    /// <summary>Where a pushed handcart's grips were last pushed from, ahead of and across from its man (his own frame).</summary>
    public double GripAlong=.45,GripAcross;
}

public sealed partial class Crowd
{
    /// <summary>Protocol 5: 0 walking, 1 velocipede, 2 handcart, 3 horse dray; discrete cargo bytes.</summary>
    public void PuppetVehicle(Puppet p, int kind, int load = 0, int goods = 0)
    {
        kind = kind is >= 0 and <= 3 ? kind : 0;
        p.Human.UseExternalVehicle(kind != 0);
        load = Math.Clamp(load, 0, 255); goods = Math.Clamp(goods, 0, 5);
        p.NetworkVehicle = kind; p.NetworkLoad = load; p.NetworkGoods = goods;
        if (p.Vehicle is { } same && same.Kind == kind) {
            if (same.Load != load || same.Goods != goods) SetVehicleLoad(p, same, load, goods);
            return;
        }
        DropVehicle(p);
        if (kind == 0) return;
        p.Cart?.Dispose(); p.Cart = null;
        var v = new NativePersonVehicle { Kind = kind, X = p.X, Z = p.Z, Nose = p.Nose, Reach = p.Reach, Size = p.Size, Load = -1, Goods = -1 };
        p.Vehicle = v;
        if (kind == 1) {
            p.Nose = .8; p.Reach = .35; p.Size = 1; p.Group.Scale = Vector3.One;
            v.InitialHeading=map.IsNative&&!p.Remote;
            v.ClearSpoke=(ax,az,bx,bz)=>BicycleSpoke(p,ax,az,bx,bz);
            v.ClearGrip=(x,z)=>map.BodyClearanceFor(p,x,z);
            v.Root = ModelLibrary.Get("velocipede", new ModelLibrary.Look(TwoSided: true))?.Copy("velocipede");
            if (v.Root != null) {
                if(v.InitialHeading)v.Root.Visible=false;
                parent.AddChild(v.Root);
                v.Front = BakedWorld.All(v.Root).OfType<Node3D>().FirstOrDefault(n => n.Name == "velocipede_front");
                v.Rear = BakedWorld.All(v.Root).OfType<Node3D>().FirstOrDefault(n => n.Name == "velocipede_rear");
                v.Steer = BakedWorld.All(v.Root).OfType<Node3D>().FirstOrDefault(n => n.Name == "velocipede_steer");
            }
            p.Human.Play("ride", .2f);
        } else if (kind == 2) {
            p.Nose = 3.3; p.Reach = .6;
            if (Handcart.Has) {
                v.Cart = new Handcart(parent, false); v.Root = v.Cart.Root;
                var box=new Aabb(new(-.72f, 0, -.9f), new(1.44f, 1.3f, 1.9f));var body=Mv.BoxBody(v.Root,box,"cart_solid");WalkMap.RegisterBody(body,box,true,p);
                box=new Aabb(new(-.42f, .25f, .98f), new(.84f, .75f, 1.2f));body=Mv.BoxBody(v.Root,box,"shafts_solid");WalkMap.RegisterBody(body,box,true,p);
            }
        } else {
            v.Dray = new NativeLedDray(parent,p); v.Root = v.Dray.Root;
            v.Dray.Place(p.X, p.Z, p.Yaw);
        }
        SetVehicleLoad(p, v, load, goods);
    }

    public (double x, double z, double yaw)? PuppetCartAt(Puppet p) => p.Vehicle?.Cart is { } cart ? (cart.Axle.x, cart.Axle.z, cart.Yaw) : null;
    public Node3D? PuppetVehicleNode(Puppet p)=>p.Vehicle?.Root;
    public double PuppetVehicleDistance(Puppet p)=>p.Vehicle?.Distance??0;
    public readonly record struct MovementSnapshot(int PathCount,int PathIndex,int Replans,bool NativeRoute,double? GoalX,double? GoalZ,double? NextX,double? NextZ,bool? NextSupported,bool? NoseSupported,int NativeSearches,double Yaw,bool HeadingReady,bool? TailSupported,bool? StraightNoseSupported);
    public MovementSnapshot PuppetMovement(Puppet p)
    {
        var point=p.Pi<p.Path.Count?p.Path[p.Pi]:((double x,double z)?)null;
        double dx=(point?.x??p.X)-p.X,dz=(point?.z??p.Z)-p.Z,length=Hyp(dx,dz);
        return new(p.Path.Count,p.Pi,p.Replans,p.NativeRouting,p.Dest?.x,p.Dest?.z,point?.x,point?.z,
            point==null?null:map.SupportsStep(p.X,p.Z,point.Value.x,point.Value.z),
            p.Vehicle?.Kind==1?BicycleSpoke(p,p.X,p.Z,p.X+Math.Sin(p.Yaw)*p.Nose,p.Z+Math.Cos(p.Yaw)*p.Nose):null,
            p.NativeRoute?.Searches??0,p.Yaw,p.Vehicle?.InitialHeading!=true,
            p.Vehicle?.Kind==1?BicycleSpoke(p,p.X,p.Z,p.X-Math.Sin(p.Yaw)*NativeBicycleTurn.RearAxle,p.Z-Math.Cos(p.Yaw)*NativeBicycleTurn.RearAxle):null,
            point==null||length<1e-6?null:map.FreeFor(p,p.X+dx/length*p.Nose,p.Z+dz/length*p.Nose));
    }

    private void DropVehicle(Puppet p)
    {
        if (p.Vehicle is not { } v) return;
        v.Root?.QueueFree(); p.Nose = v.Nose; p.Reach = v.Reach; p.Size = v.Size;
        p.Human.GripTargets(null, null);
        p.Group.Scale = Vector3.One * p.Size; p.Vehicle = null;
        p.Human.Play(p.PMotion, .3f);
    }

    private static readonly Vector3[] CartItems = {
        new(-.22f,.2f,-.2f), new(.22f,.2f,-.2f),new(-.22f,.2f,.3f),new(.22f,.2f,.3f),new(0,.52f,.05f),new(0,.45f,.55f)
    };
    private static readonly Vector3[] CartSacks = {
        new(0,-.2f,-.1f),new(0,-.2f,.4f),new(0,-.2f,.9f),new(0,.03f,.15f),new(0,.03f,.65f),new(0,.26f,.4f)
    };

    private static void SetVehicleLoad(Puppet p, NativePersonVehicle v, int count, int goods)
    {
        bool replace = v.Goods != goods;
        v.Load = count; v.Goods = goods;
        if (v.Dray != null) { v.Dray.Loaded = count > 0; return; }
        if (v.Cart == null) return;
        if (replace) { foreach (var item in v.Items) item.QueueFree(); v.Items.Clear(); }
        if (v.Items.Count == 0) for (int i = 0; i < 6; i++) {
            string type = goods == 5 ? "sack" : goods == 2 ? (i % 2 == 0 ? "tub" : "basket") : goods == 3 ? (i % 3 == 0 ? "chair" : "crate") : i % 3 == 1 ? "sack" : i % 3 == 2 ? "basket" : "crate";
            var item = VehicleCargo(type, p.Id * 6 + i);
            item.Position = goods == 5 ? CartSacks[i] : CartItems[i];
            item.Rotation = new(0, goods == 5 ? (i % 2 == 1 ? MathF.PI : 0) + (i * .37f) % .1f - .05f : (i * .37f) % .5f - .25f, 0);
            if (goods != 5) item.Scale *= type == "sack" ? .5f : type == "crate" ? .6f : 1;
            v.Cart.LoadFrame.AddChild(item); v.Items.Add(item);
        }
        for (int i = 0; i < v.Items.Count; i++) v.Items[i].Visible = i < count;
    }

    public static void CartCargo(Handcart cart,List<Node3D> items,int count,int goods,int seed)
    {
        if(items.Count>0&&items[0].GetMeta("cargo_kind",-1).AsInt32()!=goods){foreach(var item in items)item.QueueFree();items.Clear();}
        if(items.Count==0)for(int i=0;i<6;i++){
            string type=goods==5?"sack":goods==2?(i%2==0?"tub":"basket"):goods==3?(i%3==0?"chair":"crate"):i%3==1?"sack":i%3==2?"basket":"crate";
            var item=VehicleCargo(type,seed*6+i);item.SetMeta("cargo_kind",goods);item.Position=goods==5?CartSacks[i]:CartItems[i];
            item.Rotation=new(0,goods==5?(i%2==1?MathF.PI:0)+(i*.37f)%.1f-.05f:(i*.37f)%.5f-.25f,0);
            if(goods!=5)item.Scale*=type=="sack"?.5f:type=="crate"?.6f:1;
            cart.LoadFrame.AddChild(item);items.Add(item);
        }
        for(int i=0;i<items.Count;i++)items[i].Visible=i<count;
    }

    private static readonly StandardMaterial3D CartWood = new() { AlbedoColor = new("705738"), Roughness = .94f };
    private static readonly StandardMaterial3D CartWicker = new() { AlbedoColor = new("947750"), Roughness = .97f };
    private static Node3D VehicleCargo(string kind, int i)
    {
        if (kind == "sack" && Carried.Sack(.88f,.3f,.5f) is { } sack) return sack;
        if (kind == "crate" && CrateModel.Make(i % CrateModel.Goods, false, CrateModel.Class["small"]) is { } crate) return crate;
        // the household's tub and lidded basket are the work goods' own (#151), a little smaller to fit the cart's
        // slots; the chair is the street's chair (lively.glb, the lace makers' and the stall keepers')
        if (kind is "tub" or "basket" && WorkGoods.Copy(kind, kind == "tub" ? 0.7f : 0.78f) is { } goods) { var holder = new Node3D { Name = "cart_" + kind }; holder.AddChild(goods); return holder; }
        if (kind == "chair" && Scheldemist.Models.ModelLibrary.Get("lively", WorkGoods.Look)?.Copy("chair") is { } chair) { chair.Transform = Transform3D.Identity; var holder = new Node3D { Name = "cart_chair" }; holder.AddChild(chair); return holder; }
        var root = new Node3D { Name = "cart_" + kind };
        if (kind is "basket" or "tub") {
            float r = kind == "tub" ? .22f : .2f, h = kind == "tub" ? .2f : .24f;
            var material = kind == "tub" ? CartWood : CartWicker;
            root.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = r, BottomRadius = r - .04f, Height = h, RadialSegments = 16, Material = material }, Position = new(0,h / 2,0) });
            // A rolled wooden/wicker rim rather than an exposed sharp cap edge.
            root.AddChild(new MeshInstance3D { Mesh = new TorusMesh { InnerRadius = r - .007f, OuterRadius = r + .007f, Rings = 16, RingSegments = 8, Material = material }, Position = new(0,h,0) });
        } else if (kind == "chair") {
            void Piece(Vector3 size, Vector3 at) => root.AddChild(new MeshInstance3D { Mesh = CargoWood(size), Position = at });
            Piece(new(.4f,.035f,.38f),new(0,.32f,0));
            foreach (float x in new[] { -.17f,.17f }) foreach (float z in new[] { -.15f,.15f }) Piece(new(.035f,.33f,.035f),new(x,.165f,z));
            foreach (float x in new[] { -.17f,.17f }) Piece(new(.035f,.34f,.035f),new(x,.5f,-.15f));
            Piece(new(.36f,.12f,.025f),new(0,.61f,-.15f));
        }
        return root;
    }
    private static readonly Dictionary<Vector3,ArrayMesh> CargoWoodMeshes = new();
    private static ArrayMesh CargoWood(Vector3 size)
    {
        if (CargoWoodMeshes.TryGetValue(size,out var mesh)) return mesh;
        const float radius = .002f;
        var half = size / 2; var inner = half - Vector3.One * radius;
        using var surface = new SurfaceTool(); surface.Begin(Mesh.PrimitiveType.Triangles);
        void Triangle(Vector3 a,Vector3 b,Vector3 c,Vector3 outward) {
            if ((b-a).Cross(c-a).Dot(outward)>0) (b,c)=(c,b);
            foreach (var point in new[]{a,b,c}) { var core=point.Clamp(-inner,inner); var normal=(point-core).Normalized(); surface.SetNormal(normal); surface.AddVertex(core+normal*radius); }
        }
        for(int axis=0;axis<3;axis++) foreach(int sign in new[]{-1,1}) {
            int u=(axis+1)%3,v=(axis+2)%3; float[] us={-half[u],-inner[u],inner[u],half[u]},vs={-half[v],-inner[v],inner[v],half[v]};
            var outward=Vector3.Zero;outward[axis]=sign;
            Vector3 Point(float x,float y){var p=Vector3.Zero;p[axis]=sign*half[axis];p[u]=x;p[v]=y;return p;}
            for(int x=0;x<3;x++)for(int y=0;y<3;y++){var a=Point(us[x],vs[y]);var b=Point(us[x+1],vs[y]);var c=Point(us[x+1],vs[y+1]);var d=Point(us[x],vs[y+1]);Triangle(a,b,c,outward);Triangle(a,c,d,outward);}
        }
        surface.SetMaterial(CartWood); return CargoWoodMeshes[size]=surface.Commit();
    }

    /// <summary>How long a pushed handcart waits for someone in its way before its pusher looks for another way (seconds).</summary>
    private const double CartPatience = 6;
    /// <summary>How deep a body of radius r at (x, z) is in a pushed handcart whose axle is at (ax, az), heading dir: its cart box
    /// and its shafts back to the grips, the boxes of PuppetVehicle's cart_solid and shafts_solid in PushCart's frame (turned
    /// half round: the shafts point back along +z). 0 when it is clear of both.</summary>
    private static double CartDepth(double ax,double az,double dir,double x,double z,double r)
    {
        double wx=x-ax,wz=z-az,s=Math.Sin(dir),c=Math.Cos(dir),lx=Math.Abs(-wx*c+wz*s),lz=-wx*s-wz*c;
        double body=Math.Min(.72+r-lx,Math.Min(lz+.9+r,1.0+r-lz)),shafts=Math.Min(.42+r-lx,Math.Min(lz-.98+r,2.18+r-lz));
        return Math.Max(0,Math.Max(body,shafts));
    }
    /// <summary>The room a pushed handcart keeps from a body (the stuck check's body is 0.25 m round; a little more).</summary>
    private const double CartRoom=.32;
    /// <summary>How deep a body of radius r at (x, z) is in the knife grinder's barrow pushed out before him (StreetTrades: its box
    /// from 0.4 m to 2.0 m ahead of him, 0.7 m wide) when he stands at (px, pz) facing yaw.</summary>
    private static double BarrowDepth(double px,double pz,double yaw,double x,double z,double r)
    {
        double wx=x-px,wz=z-pz,s=Math.Sin(yaw),c=Math.Cos(yaw),along=wx*s+wz*c,across=Math.Abs(wx*c-wz*s);
        return Math.Max(0,Math.Min(.35+r-across,Math.Min(along-.4+r,2.0+r-along)));
    }
    /// <summary>Whom CartOnSomeone last found in the way (for the route notes).</summary>
    private Puppet? cartOnWho;
    /// <summary>Would what this body pushes (a handcart, the grinder's barrow), moved by (dx, dz) (as it stands, and swung round to
    /// yaw), come onto someone, or further onto him? (#192: a handcart rolled on over a seller, a standing man and a child who had
    /// no room to step out of its lane; the grinder's barrow over a woman pushing her cart.)</summary>
    private bool CartOnSomeone(Puppet p,double dx,double dz,double yaw)
    {
        var v=p.Vehicle;var cart=v?.Cart;
        if(cart==null&&!p.Barrow)return false;
        // a handcart hangs from its grips and comes round behind its man's turn (PushCart.Push): its axle swings about his hands,
        // so every heading on the way from the cart's own to his new one is looked at, about every 0.15 rad, from where his hands
        // will be (and where it stands now, moved with him)
        var (ax,az)=cart?.Axle??(0,0);double dir=cart?.Yaw??0,reach=cart?.Reach??0,turn=Math.Atan2(Math.Sin(yaw-dir),Math.Cos(yaw-dir));
        double sy=Math.Sin(yaw),cy=Math.Cos(yaw),along=v?.GripAlong??0,across=v?.GripAcross??0;
        double hx=p.X+dx+sy*along+cy*across,hz=p.Z+dz+cy*along-sy*across;int turns=cart==null?0:Math.Max(1,(int)Math.Ceiling(Math.Abs(turn)/.15));
        foreach(var q in people){
            if(q==p||Math.Abs(q.X-p.X)>5||Math.Abs(q.Z-p.Z)>5)continue;
            double now=cart!=null?CartDepth(ax,az,dir,q.X,q.Z,CartRoom):BarrowDepth(p.X,p.Z,p.Yaw,q.X,q.Z,CartRoom),after;
            // (the barrow turns with him, his heading coming round to the step's over the next frames: every heading on the way, #197)
            if(cart==null){double bt=Math.Atan2(Math.Sin(yaw-p.Yaw),Math.Cos(yaw-p.Yaw));int bn=Math.Max(1,(int)Math.Ceiling(Math.Abs(bt)/.15));after=0;for(int i=0;i<=bn;i++)after=Math.Max(after,BarrowDepth(p.X+dx,p.Z+dz,p.Yaw+bt*i/bn,q.X,q.Z,CartRoom));}
            else{
                after=CartDepth(ax+dx,az+dz,dir,q.X,q.Z,CartRoom);
                for(int i=0;i<=turns;i++){double h=dir+turn*i/turns;after=Math.Max(after,CartDepth(hx+Math.Sin(h)*reach,hz+Math.Cos(h)*reach,h,q.X,q.Z,CartRoom));}
            }
            if(after>0&&after>now-1e-6){cartOnWho=q;return true;}
        }
        return false;
    }
    /// <summary>Does someone stand where a handcart parked with its axle at (x, z), heading yaw, would stand? 0 nobody, 1 someone,
    /// 2 someone pushing a cart or barrow (who cannot be set aside: what he pushes would jump with him). Its drawing waits (#192).</summary>
    public int SomeoneOnParkedCart(double x,double z,double yaw)
    {
        int on=0;
        foreach(var q in people)if(Math.Abs(q.X-x)<4&&Math.Abs(q.Z-z)<4&&CartDepth(x,z,yaw,q.X,q.Z,CartRoom)>0){if(q.Vehicle!=null||q.Barrow)return 2;on=1;}
        return on;
    }
    /// <summary>Is (x, z) clear of this body's own barrow set down (the knife grinder's)? Everyone else, and the grinder pushing it, is.</summary>
    private bool OwnClear(Puppet p,double x,double z)=>!p.Grinder||p.Barrow||map.ClearOfOwn(p,x,z);
    /// <summary>Would this pusher's step be clear but for something passing: the ground, the parked and standing bodies (not the
    /// vehicles going by) let the step and his cart's nose through?</summary>
    private bool PassingHolds(Puppet p,double ux,double uz,double step)
    {
        double nx=p.X+ux*step,nz=p.Z+uz*step;var nose=p.Nose>0?NosePoint(p,nx,nz,ux,uz):(x:nx,z:nz);
        return map.PathFree(nx,nz)&&map.PathFree(nose.x,nose.z)&&map.SupportsStep(p.X,p.Z,nx,nz)&&(p.NativeRouting||grid.IsOpen(nx,nz));
    }
    /// <summary>Would a step of this pusher to (x, z), heading yaw, bring what he pushes onto someone? False for everyone else.</summary>
    private bool PushedOnSomeone(Puppet p,double x,double z,double yaw)=>(p.Vehicle?.Cart!=null||p.Barrow)&&Hyp(x-p.X,z-p.Z)>1e-6&&CartOnSomeone(p,x-p.X,z-p.Z,yaw);
    /// <summary>Whoever a pushed handcart or barrow has come onto after all (a cart swings round behind its man's turn and comes up to
    /// his hands when he takes hold; the barrow turns with him) is shoved out of it, across it or off its end, onto free ground.</summary>
    private void CartShove(Puppet p)
    {
        var cart=p.Vehicle?.Cart;
        if(cart==null&&!p.Barrow||p.Remote)return;
        // the thing's frame: an origin, its heading (local z) and across (local x)
        var (ox,oz)=cart?.Axle??(p.X,p.Z);double h=cart?.Yaw??p.Yaw,s=Math.Sin(h),c=Math.Cos(h);
        // (the walk map's margin round a body is 0.3 m: out to beyond it)
        const double r=.31,clear=.38;
        double Depth(double x,double z)=>cart!=null?CartDepth(ox,oz,h,x,z,r):BarrowDepth(ox,oz,h,x,z,r);
        foreach(var q in people){
            if(q==p||q.Remote||q.Vehicle!=null||q.State=="sit"||Math.Abs(q.X-p.X)>5||Math.Abs(q.Z-p.Z)>5||Depth(q.X,q.Z)<=0)continue;
            double wx=q.X-ox,wz=q.Z-oz,across=wx*c-wz*s,along=wx*s+wz*c;
            // the ways out: to either side (a cart's shafts are narrower than its box), or off the far end; (a cart's frame is
            // turned half round: its far end is towards -heading)
            double half=cart==null?.35:-along>.98?.42:.72,side=across>=0?1:-1,end=cart==null?2.0+clear:.9+clear;
            Span<(double a,double l)> outs=stackalloc (double,double)[]{(side*(half+clear),along),(-side*(half+clear),along),(across,end)};
            (double x,double z)? best=null;double bestD=double.MaxValue;
            foreach(var o in outs){
                double x=ox+o.a*c+o.l*s,z=oz-o.a*s+o.l*c,d=Hyp(x-q.X,z-q.Z);
                if(d<bestD&&Depth(x,z)<=0&&map.FreeFor(q,x,z)&&!Bridges.OnRaised(x,z)){best=(x,z);bestD=d;}
            }
            if(best==null)continue;
            if(MoveOutLog.Count<200)MoveOutLog.Add($"puppet {q.Id} {q.State} shoved by puppet {p.Id}'s {(cart!=null?"handcart":"barrow")} from {q.X:0.00},{q.Z:0.00} to {best.Value.x:0.00},{best.Value.z:0.00}");
            q.X=best.Value.x;q.Z=best.Value.z;
        }
    }

    private void MoveVehicle(Puppet p,double dt,bool shown,double ground)
    {
        var v=p.Vehicle!; double step=Hyp(p.X-v.X,p.Z-v.Z);v.X=p.X;v.Z=p.Z;v.Distance+=step;
        v.Speed+=(Math.Min(6,step/Math.Max(dt,.001))-v.Speed)*Math.Min(1,dt*6);
        if(v.Kind==1) {
            if(v.InitialHeading&&TryBicycleStep(p,p.X,p.Z,1,out double mountedYaw)){p.Yaw=mountedYaw;v.InitialHeading=false;}
            p.Group.Position=new((float)(p.X-Math.Sin(p.Yaw)*.05),(float)ground+p.Human.RideLift(),(float)(p.Z-Math.Cos(p.Yaw)*.05));
            p.Group.Rotation=new(0,(float)p.Yaw,0);
            p.Human.Play("ride",.2f);p.Human.SetPhase("ride",(float)(v.Distance/.46/Math.Tau));
            if(v.Root!=null){v.Root.Visible=shown&&!v.InitialHeading;v.Root.Position=new((float)p.X,(float)ground,(float)p.Z);v.Root.Rotation=new(0,(float)p.Yaw,0);}
            if(v.Front!=null)v.Front.Rotation=new((float)(v.Distance/.46),0,0);
            if(v.Rear!=null)v.Rear.Rotation=new((float)(v.Distance/.38),0,0);
            // both hands on the actual grips (#172): the grips' middles on the steering head (build_velocipede.py, as
            // Velocipedes.PlayerGrip), in the rider's own frame so the hands follow on the next pose
            if(v.Root!=null){var root=p.Human.Root.GlobalTransform.AffineInverse();Vector3 Grip(float x)=>v.Steer?.ToGlobal(new(x,.626f,-.11f))??v.Root.ToGlobal(new(x,1.086f,.45f));p.Human.GripTargets(root*Grip(.36f),root*Grip(-.36f));}
        } else if(v.Cart!=null) {
            // walking only while actually moving: held at a corner, the driver stands rather than walking on the spot
            bool going=p.State=="walk"&&v.Speed>.1;
            p.Human.Play(p.Conversing?"talk":going?(p.Kind is "carter" or "porter"?"walk":"push"):"idle",.25f);
            if(p.Conversing){v.Cart.Root.Visible=shown;return;}
            var hands=Carters.Hands(p.Human,p.Group,new((float)p.X,(float)p.Z),(float)p.Yaw);
            if(going){double hx=hands.X-p.X,hz=hands.Z-p.Z,sy=Math.Sin(p.Yaw),cy=Math.Cos(p.Yaw);v.GripAlong=hx*sy+hz*cy;v.GripAcross=hx*cy-hz*sy;}
            // (it comes round behind his turn only as he walks on: swung on after he stopped for someone in its way, the cart came onto
            // her, a seller pushing her own cart past it, whom nothing could shove out, #197)
            v.Cart.Push(dt,hands.X,hands.Z,hands.Y-ground,step>1e-4?p.Yaw:v.Cart.Yaw,going?1:0,ground);v.Cart.Root.Visible=shown;
        } else if(v.Dray!=null) {
            bool going=p.State=="walk"&&v.Speed>.1;
            p.Human.Play(p.Conversing?"talk":going?"walk":"idle",.25f);
            v.Dray.Follow(dt,p.X,p.Z,p.Yaw,going?v.Speed:0,ground);
            v.Dray.Root.Visible=Hyp(p.X-viewX,p.Z-viewZ)<FogDistance+10;
        }
    }
}

/// <summary>The source LedDray: articulated axles and horse following a leader's actual retained trail.</summary>
internal sealed class NativeLedDray
{
    public readonly Node3D Root=new(){Name="led_dray"};
    private readonly Node3D? bed,fore,rear,front,load;
    private readonly DrayHorse? horse;
    private readonly AnimatableBody3D bedBody,horseBody;
    private readonly List<Vector2> trail=new();
    private Vector2 head;
    private float gait,rearRoll,frontRoll;
    public bool Loaded {set{if(load!=null)load.Visible=value;}}
    public NativeLedDray(Node parent,Puppet owner)
    {
        var props=ModelLibrary.Get("props",new ModelLibrary.Look(TwoSided:true));
        Node3D? Part(string n){var p=props?.Copy(n);if(p!=null)Root.AddChild(p);return p;}
        bed=Part("tr_dray_bed");fore=Part("tr_dray_fore");rear=Part("tr_wheels_rear");front=Part("tr_wheels_front");
        load=Part("tr_load_sacks");var body=Part("tr_horse_body");var legs=new List<Node3D>();
        foreach(string n in new[]{"tr_leg_front","tr_leg_front","tr_leg_hind","tr_leg_hind"}){var up=Part(n);var lo=Part(n+"_lo");if(up!=null&&lo!=null){legs.Add(up);legs.Add(lo);}}
        // the led drays' horses take a coat from the herd by their number
        if(body!=null&&legs.Count==8)horse=new DrayHorse(body,legs.ToArray());
        bedBody=Mv.BoxBody(Root,new Aabb(new(-.95f,0,-1.9f),new(1.9f,1.7f,3.8f)),"bed_solid");
        horseBody=Mv.BoxBody(Root,new Aabb(new(-.4f,0,-1.2f),new(.8f,1.8f,2.4f)),"horse_solid");parent.AddChild(Root);
        WalkMap.RegisterBody(bedBody,new Aabb(new(-.95f,0,-1.9f),new(1.9f,1.7f,3.8f)),true,owner);
        WalkMap.RegisterBody(horseBody,new Aabb(new(-.4f,0,-1.2f),new(.8f,1.8f,2.4f)),true,owner);
    }
    public void Place(double x,double z,double yaw){trail.Clear();head=new((float)x,(float)z);for(float d=0;d<=7;d+=.2f)trail.Add(head-new Vector2((float)Math.Sin(yaw),(float)Math.Cos(yaw))*d);}
    private (Vector2 at,float yaw) Back(float d)
    {
        float acc=0,yaw=float.NaN;var p=head;
        foreach(var q in trail){float len=p.DistanceTo(q);if(len>1e-4f){yaw=MathF.Atan2(p.X-q.X,p.Y-q.Y);if(acc+len>=d)return(p.Lerp(q,Math.Max(0,d-acc)/len),yaw);acc+=len;}p=q;}
        if(float.IsNaN(yaw))yaw=0;return(p-new Vector2(MathF.Sin(yaw),MathF.Cos(yaw))*(d-acc),yaw);
    }
    private (Vector2 at,float yaw) SmoothBack(float d){var p=Back(d);var f=Back(d-.4f);var r=Back(d+.4f);if(f.at.DistanceTo(r.at)>.2f)p.yaw=MathF.Atan2(f.at.X-r.at.X,f.at.Y-r.at.Y);p.at+=new Vector2(-MathF.Cos(p.yaw),MathF.Sin(p.yaw))*.85f;return p;}
    public void Follow(double dt,double x,double z,double yaw,double speed,double ground)
    {
        if(trail.Count==0)Place(x,z,yaw);head=new((float)x,(float)z);if(head.DistanceTo(trail[0])>=.2f){trail.Insert(0,head);if(trail.Count>60)trail.RemoveAt(60);}
        var h=SmoothBack(1);var b=SmoothBack(3.05f);var a=SmoothBack(5.45f);
        float by=MathF.Atan2(b.at.X-a.at.X,b.at.Y-a.at.Y),fy=MathF.Atan2(h.at.X-b.at.X,h.at.Y-b.at.Y),ds=(float)(speed*dt);
        rearRoll+=ds/.52f;frontRoll+=ds/.42f;gait=(gait+(float)(speed/1.35*dt))%1;
        void Put(Node3D? n,Vector2 at,float y,float heading,float pitch=0){if(n!=null)DrayHorse.Put(n,at,y,heading,pitch);}
        Root.Position=new(0,(float)ground,0);Put(bed,a.at,0,by);Put(load,a.at,0,by);Put(fore,b.at,0,fy);Put(rear,a.at,.52f,by,rearRoll);Put(front,b.at,.42f,fy,frontRoll);
        horse?.Set(h.at,h.yaw,gait,Math.Min(1,(float)speed/.8f));Put(bedBody,a.at+new Vector2(MathF.Sin(by),MathF.Cos(by))*1.15f,0,by);Put(horseBody,h.at,0,h.yaw);
    }
}

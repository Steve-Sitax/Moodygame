using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>The quay's street traffic (traffic.ts): the same sampled routes, seeded paces, stops, four-beat gait and pushed carts.</summary>
[GamePart(47)]
public partial class Traffic : Node
{
    public static Traffic? I { get; private set; }
    public sealed class Vehicle
    {
        public string Route = "", Kind = "", Load = "", State = "go";
        public OmnibusLines.Loop Path = null!;
        public float S, V, Pace, Gait, RearRoll, FrontRoll, Timer, Front, Back, Off, Want, Wait, Gone, Stuck, BackM;
        public int Index, LoadIndex, LastStop = -1, Backs;
        public (float S, float Secs, float Chance) Stop;
        public Node3D Frame = null!;
        public Human? Man;
        public PushCart? Cart;
        public AnimatableBody3D? BedBody, HorseBody;
        public Vector2 At;
        public float Yaw;
        public readonly Godot.Collections.Array<Rid> Exclude = new();
    }
    public IReadOnlyList<Vehicle> Vehicles => vehicles;
    private readonly List<Vehicle> vehicles = new();
    private Copies? bed, fore, rear, front, horse;
    private readonly Copies?[] legs = new Copies?[4];
    private readonly Dictionary<string, Copies?> loads = new();
    private readonly HorseGait.Pose pose = new();
    private readonly PhysicsShapeQueryParameters3D query = new() { Shape = new SphereShape3D { Radius = 0.45f }, CollisionMask = Solid.Layer, CollideWithAreas = false };
    private uint seed = 1873;
    private float Rand() { unchecked { seed = seed * 1664525 + 1013904223; } return (float)(seed / 4294967296.0); }

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("traffic");
        if (g == null) { SetProcess(false); return; }
        bed = Copies.Find(g, "trdraybed"); fore = Copies.Find(g, "trdrayfore");
        rear = Copies.Find(g, "trwheelsrear"); front = Copies.Find(g, "trwheelsfront"); horse = Copies.Find(g, "trhorsebody");
        string[] names = { "trlegfront", "trlegfrontlo", "trleghind", "trleghindlo" };
        for (int i = 0; i < 4; i++) legs[i] = Copies.Find(g, names[i]);
        foreach (string name in new[] { "casks", "sacks", "bales", "tarp" }) loads[name] = Copies.Find(g, "trload" + name);
        var frames = g.GetChildren().OfType<Node3D>().Where(n => n is not MeshInstance3D and not MultiMeshInstance3D && !Mv.Plain(n).StartsWith("pushcart")).ToList();
        var carts = g.GetChildren().OfType<Node3D>().Where(n => Mv.Plain(n) == "pushcart").ToList();
        int dray = 0, cart = 0;
        void Route(string name, (float, float)[] points, bool loop, Vector2 stop, float secs, float chance, params (string Kind, float At, string Load)[] kinds)
        {
            float half = kinds.Any(k => k.Kind == "dray") ? 1.9f : 1.4f;
            var lp = Path(points, loop, half);
            int nearest = Enumerable.Range(0, lp.X.Length).MinBy(i => new Vector2(lp.X[i] - stop.X, lp.Z[i] - stop.Y).LengthSquared());
            foreach (var k in kinds)
            {
                int i = vehicles.Count;
                if (i >= frames.Count || k.Kind == "handcart" && cart >= carts.Count) { GD.PrintErr($"traffic: {name} has no baked rig"); continue; }
                var v = new Vehicle { Route = name, Kind = k.Kind, Load = k.Load, Path = lp, S = k.At * lp.Length, Pace = k.Kind == "dray" ? 1.2f + Rand() * 0.15f : 1 + Rand() * 0.12f,
                    Gait = Rand(), Frame = frames[i], Front = k.Kind == "dray" ? 6.15f : 0.95f, Back = k.Kind == "dray" ? -0.8f : -3.05f,
                    Stop = (nearest * 0.25f, secs, chance) };
                v.Man = Carters.Make(v.Frame, k.Kind == "dray" ? new[] { "docker_b", "docker_a", "docker_c" }[i % 3] : "carter", k.Kind == "handcart");
                if (k.Kind == "handcart")
                {
                    v.Cart = new PushCart(carts[cart++]);
                    foreach (var b in BakedWorld.All(v.Cart.Root).OfType<AnimatableBody3D>()) v.Exclude.Add(b.GetRid());
                }
                else
                {
                    v.Index = dray++;
                    v.LoadIndex = vehicles.Count(o => o.Kind == "dray" && o.Load == k.Load);
                    v.BedBody = Box(new Vector3(1.9f, 1.6f, 3.8f));
                    v.HorseBody = Box(new Vector3(0.8f, 1.8f, 2.6f));
                    v.Exclude.Add(v.BedBody.GetRid()); v.Exclude.Add(v.HorseBody.GetRid());
                }
                vehicles.Add(v);
                Place(v, 0, 0, true);
            }
        }
        Route("rijnkaai_back", new (float,float)[] { (-4.2f,66.4f),(0,66),(30.9f,63.1f),(29.2f,80),(28,100),(28.6f,108.7f),(14,106.8f),(-0.5f,105.4f),(-3,88),(-4.2f,66.4f) }, true, new(14,106.8f),18,0.5f,("dray",0.1f,"casks"));
        Route("eilandje", new (float,float)[] { (120,11),(158.6f,11),(158.6f,43),(122,43),(122,35),(120,32) }, true,new(137.5f,43),25,0.7f,("dray",0.05f,"bales"),("handcart",0.55f,""));
        Route("werf", new (float,float)[] { (-305,8.3f),(-216,8.3f),(-216,30),(-305,30) }, true,new(-249,8.3f),20,0.6f,("dray",0.2f,"tarp"),("handcart",0.7f,""));
        Route("bassin_south", new (float,float)[] { (74,119.5f),(168,119.5f),(176,122),(196,122) }, false,new(186.5f,122),20,0.8f,("handcart",0.3f,""));
        GD.Print($"traffic: {vehicles.Count} rigs ({dray} horse drays, {cart} pushed handcarts)");
        if (MoversTest.On) Probes();
    }

    private AnimatableBody3D Box(Vector3 size)
    {
        var b = new AnimatableBody3D { SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0 };
        AddChild(b);
        b.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size }, Position = new Vector3(0, size.Y / 2, 0) });
        return b;
    }

    public static OmnibusLines.Loop Path((float X, float Z)[] raw, bool loop, float half)
    {
        var points = raw.Where((p,i) => (i == 0 && !loop) || new Vector2(p.X - raw[(i + raw.Length - 1) % raw.Length].X, p.Z - raw[(i + raw.Length - 1) % raw.Length].Z).Length() > 0.01f).ToArray();
        if (!loop)
        {
            var sides = new List<(float,float)>();
            foreach (int sign in new[] { 1,-1 })
            {
                var side = new List<(float,float)>();
                for (int i = 0; i < points.Length; i++)
                {
                    var a = points[Math.Max(0,i-1)]; var b = points[Math.Min(points.Length-1,i+1)];
                    float l = Math.Max(1e-6f,new Vector2(b.X-a.X,b.Z-a.Z).Length()), off = half * 0.45f * sign;
                    side.Add((points[i].X - (b.Z-a.Z)/l*off,points[i].Z+(b.X-a.X)/l*off));
                }
                if (sign < 0) side.Reverse();
                sides.AddRange(side);
            }
            points = sides.ToArray();
        }
        return new OmnibusLines.Loop(points, loop ? 6 : 2.2f, 8);
    }

    private static Vector2 At(Vehicle v,float s,float? off = null)
    {
        var p = v.Path.At(s); float o = off ?? v.Off;
        if (o != 0) { float h = v.Path.Yaw(s); p += new Vector2(MathF.Cos(h),-MathF.Sin(h))*o; }
        return p;
    }

    private bool Free(Vehicle v,Vector2 p,float radius = 0.45f)
    {
        query.Exclude = v.Exclude;
        query.Transform = new Transform3D(Basis.Identity,new Vector3(p.X,0.9f,p.Y));
        ((SphereShape3D)query.Shape).Radius = radius;
        return Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(query,1).Count == 0;
    }

    private string? Blocked(Vehicle v)
    {
        if (Jef.I != null)
            for (float o=v.Back;o<=v.Front+2.5f;o+=0.8f)
            {
                float r=(v.Kind=="dray"?1:0.8f)+(v.Off!=0?0.45f:o>v.Front?0.6f:1);
                if (At(v,v.S+o).DistanceTo(new Vector2(Jef.I.X,Jef.I.Z))<r) return "player";
            }
        foreach (var w in vehicles)
            if (w!=v && w.Path==v.Path && v.Path.Wrap(w.S+w.Back-v.S-v.Front)<2.5f) return "queue";
        foreach (float d in new[] {1.3f,2.4f})
        {
            var at=At(v,v.S+v.Front+d);
            if (!Free(v,at)) return "thing";
            if(d==1.3f) foreach(var p in StreetPeople.Walking()) if(Math.Abs(p.X-at.X)<.7 && Math.Abs(p.Z-at.Y)<.7) return "thing";
        }
        return null;
    }

    private bool SideClear(Vehicle v,float off)
    {
        float r = v.Kind=="dray"?1:0.8f;
        for (float s=v.Back;s<=v.Front+8;s+=1.2f)
        {
            var p=At(v,v.S+s,off);
            if (!Free(v,p,r) || Jef.I!=null && p.DistanceTo(new Vector2(Jef.I.X,Jef.I.Z))<r+0.6f) return false;
        }
        return true;
    }

    private void Move(Vehicle v,float dt)
    {
        float target=v.Pace;
        if (v.State=="stand") { target=0; v.Timer-=dt; if (v.Timer<=0) v.State="go"; }
        else
        {
            string? why=Blocked(v);
            v.State=why==null?"go":"wait";
            if (why!=null) target=0;
            v.Wait=why is "player" or "thing"?v.Wait+dt:0;
            if (v.Want==0 && v.Wait>6)
            {
                foreach (float side in new[] {-1.7f,1.7f})
                    if (SideClear(v,side)) { v.Want=side; v.Gone=0; v.Wait=0; break; }
            }
            else if (v.Want!=0)
            {
                v.Gone+=v.V*dt;
                if ((v.Gone>10 && SideClear(v,0)) || v.Wait>6) { v.Want=0; v.Wait=0; }
            }
            v.Off+=Math.Clamp(v.Want-v.Off,-0.7f*dt,0.7f*dt);
            v.Stuck=why=="thing"?v.Stuck+dt:0;
            if (v.Stuck>60) { v.Stuck=0; v.BackM=6; v.Backs++; }
            if (v.BackM>0)
            {
                float d=Math.Min(0.6f*dt,v.BackM);
                if (Free(v,At(v,v.S+v.Back-1.6f),0.6f)) { v.S=v.Path.Wrap(v.S-d); v.BackM-=d; } else v.BackM=0;
                v.V=target=0; v.State="wait";
            }
            float ahead=v.Path.Wrap(v.Stop.S-v.S);
            if (ahead<0.3f && v.LastStop!=0)
            {
                v.LastStop=0;
                if (Rand()<v.Stop.Chance) { v.State="stand"; v.Timer=v.Stop.Secs*(0.7f+Rand()*0.6f); target=0; }
            }
            else if (ahead<4 && v.LastStop!=0) target=Math.Min(target,0.35f+ahead*0.25f);
        }
        v.V+=(target-v.V)*Math.Min(1,dt*(target<v.V?3:1.2f));
        if (v.V<0.01f && target==0) v.V=0;
        float ds=v.V*dt;
        v.S=v.Path.Wrap(v.S+ds);
        // Arc and wheel phase keep running even when the distant figure updates in turns.
        v.RearRoll+=ds/0.52f; v.FrontRoll+=ds/0.42f; v.Gait=(v.Gait+v.V/1.35f*dt)%1;
        if (v.Kind=="dray" && v.V<=0.05f) v.Gait*=MathF.Pow(0.98f,dt*60);
        var eye=Main.I.Cam.GlobalPosition;
        v.At=At(v,v.S);
        bool near=v.At.DistanceTo(new Vector2(eye.X,eye.Z))<(Daylight.I?.FogFar??200)+15;
        if (near || MoverClock.Frame%4==(ulong)(vehicles.IndexOf(v)%4)) Place(v,dt,ds,near);
    }

    private void Place(Vehicle v,float dt,float ds,bool near)
    {
        var a=At(v,v.S); v.At=a;
        v.Frame.Visible=near;
        if (v.Kind=="dray")
        {
            var b=At(v,v.S+2.4f); var c=At(v,v.S+4.45f);
            float by=MathF.Atan2(b.X-a.X,b.Y-a.Y),fy=MathF.Atan2(c.X-b.X,c.Y-b.Y),hy=v.Path.Yaw(v.S+4.45f);
            v.Yaw=by;
            v.BedBody!.Transform=new Transform3D(new Basis(Vector3.Up,by),new Vector3(a.X+MathF.Sin(by)*1.15f,0,a.Y+MathF.Cos(by)*1.15f));
            v.HorseBody!.Transform=new Transform3D(new Basis(Vector3.Up,hy),new Vector3(c.X,0,c.Y));
            if (near)
            {
                bed?.Put(v.Index,a.X,0,a.Y,by); fore?.Put(v.Index,b.X,0,b.Y,fy);
                rear?.Put(v.Index,a.X,0.52f,a.Y,by,v.RearRoll); front?.Put(v.Index,b.X,0.42f,b.Y,fy,v.FrontRoll);
                loads[v.Load]?.Put(v.LoadIndex,a.X,0,a.Y,by);
                HorseGait.PoseAt(pose,v.Gait,Math.Min(1,v.V/0.8f),0,1.35f);
                horse?.Put(v.Index,c.X,pose.Bob,c.Y,hy);
                float cy=MathF.Cos(hy),sy=MathF.Sin(hy);
                for (int k=0;k<4;k++)
                {
                    var l=pose.Legs[k]; int j=v.Index*2+k%2,up=k<2?0:2;
                    legs[up]?.Put(j,c.X+l.X*cy+l.Uz*sy,l.Uy,c.Y-l.X*sy+l.Uz*cy,hy,l.Up);
                    legs[up+1]?.Put(j,c.X+l.X*cy+l.Lz*sy,l.Ly,c.Y-l.X*sy+l.Lz*cy,hy,l.Lp);
                }
            }
            else
            {
                foreach (var m in new[] {bed,fore,rear,front,horse}) m?.Zero(v.Index);
                loads[v.Load]?.Zero(v.LoadIndex);
                foreach (var m in legs) { m?.Zero(v.Index*2); m?.Zero(v.Index*2+1); }
            }
            DrayHorse.Put(v.Frame,c+new Vector2(MathF.Cos(hy)*0.85f+MathF.Sin(hy),-MathF.Sin(hy)*0.85f+MathF.Cos(hy)),0,hy);
        }
        else
        {
            float yaw=v.Path.Yaw(v.S-2.15f*0.5f); v.Yaw=yaw;
            var p=At(v,v.S-2.15f)-new Vector2(MathF.Sin(yaw),MathF.Cos(yaw))*0.45f;
            DrayHorse.Put(v.Frame,p,0,yaw);
            v.Cart!.Push(dt,Carters.Hands(v.Man,v.Frame,p,yaw),yaw,v.State=="stand"?0:1);
            v.Cart.Root.Visible=near;
        }
        v.Man?.Play(v.V>0.08f?"walk":"idle"); v.Man?.SetPace(Math.Max(0.3f,v.V));
        if (near) v.Man?.Update(dt);
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("traffic");
        foreach (var v in vehicles) Move(v,(float)MoverClock.Dt);
        foreach (var m in new[] {bed,fore,rear,front,horse}) m?.Commit();
        foreach (var m in legs) m?.Commit();
        foreach (var m in loads.Values) m?.Commit();
        MoverCost.End("traffic");
    }

    private void Probes()
    {
        foreach (string kind in new[] {"dray","handcart"})
        {
            var v=vehicles.First(x=>x.Kind==kind && x.Route==(kind=="dray"?"werf":"bassin_south"));
            MoversTest.Add(new MoversTest.Probe {
                Name="street_"+kind,Hour=13,Gap=3,MaxWait=30,Ready=()=>v.V>0.6f,
                Start=()=>
                {
                    var target=kind=="dray"?new Vector2(-285,8.3f):new Vector2(145,119.5f);
                    int s=Enumerable.Range(0,v.Path.X.Length).MinBy(i=>new Vector2(v.Path.X[i]-target.X,v.Path.Z[i]-target.Y).LengthSquared());
                    v.S=s*0.25f; v.V=v.Pace; v.State="go";
                },
                Where=()=> (new Vector3(v.At.X,0,v.At.Y),v.S,$"{v.Route} {v.Kind}, {v.V:0.00} m/s, {v.State}, horse phase {v.Gait:0.000}"),
                View=()=> { var f=new Vector3(MathF.Sin(v.Yaw),0,MathF.Cos(v.Yaw)); var side=new Vector3(f.Z,0,-f.X); var at=new Vector3(v.At.X,1,v.At.Y)+f*(kind=="dray"?2.3f:-0.6f); return (at+side*5+f*2+Vector3.Up*2,at); }
            });
        }
    }
}

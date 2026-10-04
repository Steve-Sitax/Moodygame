using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>The two goods rounds, from shared/goods.ts and cartRuns.ts: their place follows only from day and HourF.</summary>
[GamePart(48)]
public partial class GoodsDrays : Node
{
    public static GoodsDrays? I { get; private set; }
    public sealed class Leg
    {
        public Vector2[] Points = Array.Empty<Vector2>();
        public double[] Cum = Array.Empty<double>();
        public double T0,T1,Yaw0;
        public double Length => Cum[^1];
        public (Vector2 At,float Yaw) Along(double s)
        {
            if (s<=0) return (Points[0]+new Vector2((float)Math.Sin(Yaw0),(float)Math.Cos(Yaw0))*(float)s,(float)Yaw0);
            int n=Points.Length-1;
            if (s>=Length)
            {
                var d=Points[n]-Points[n-1]; float yaw=MathF.Atan2(d.X,d.Y);
                return (Points[n]+new Vector2(MathF.Sin(yaw),MathF.Cos(yaw))*(float)(s-Length),yaw);
            }
            int i=1; while (i<Cum.Length-1 && Cum[i]<s) i++;
            var dir=Points[i]-Points[i-1];
            return (Points[i-1]+dir*(float)((s-Cum[i-1])/(Cum[i]-Cum[i-1])),MathF.Atan2(dir.X,dir.Y));
        }
    }
    public sealed class Rig
    {
        public string Id="",CartId="",Label="";
        public Leg[] Legs=Array.Empty<Leg>();
        public Node3D Root=null!,Frame=null!,Bed=null!;
        public Human? Man;
        public PushCart? Cart;
        public MeshInstance3D[] Parts=Array.Empty<MeshInstance3D>();
        public DrayHorse? Horse;
        public AnimatableBody3D? Body,HorseBody;
        public int Leg;
        public double S;
        public bool Moving;
        public Vector2 At;
        public float Yaw,Gait,RearRoll,FrontRoll;
    }
    private readonly List<Rig> rigs=new();
    public IReadOnlyList<Rig> Rigs=>rigs;
    public Node3D? BedOf(string cart)=>rigs.FirstOrDefault(r=>r.CartId==cart)?.Bed;
    public const double Pace=1.1,MPerMin=Pace*ClockRate.RealSPerGameMin;

    public override void _Ready()
    {
        I=this;
        var g=Mv.Top("goods_drays");
        if (g==null) { SetProcess(false); return; }
        var dy=new Vector2(27.5f,22); var dh=new Vector2(26.47f,15.3f); var dt=new Vector2(20.22f,15.3f);
        Vector2[] East()=>Arc(31.45,18.65,3.35,0,180);
        Vector2[] West()=>Arc(20.22,18.65,3.35,180,360);
        Vector2[] Join(params Vector2[][] arrays)=>arrays.SelectMany(a=>a).ToArray();
        var casks=Plan(new[] { Join(new[]{dy},East(),new[]{dh}),new[]{dh,dt},Join(new[]{dt},West(),new[]{dy}),Join(new[]{dy},East(),new[]{dt}),Join(new[]{dt},West(),East(),new[]{dh}),Join(new[]{dh},West(),new[]{dy}) },480,540,960,1020);
        var cy=new Vector2(12.4f,20.6f); var ch=new Vector2(15.06f,20.6f); var ct=new Vector2(25.04f,20.6f);
        var ce=Arc(27.6,19.45,1.15,0,180); var cw=Arc(11.5,19.45,1.15,180,360);
        var sacks=Plan(new[] { new[]{cy,ch},new[]{ch,ct},Join(new[]{ct},ce,cw,new[]{cy}),new[]{cy,ct},Join(new[]{ct},ce,new[]{new Vector2(15.06f,18.3f)}),Join(new[]{new Vector2(15.06f,18.3f)},cw,new[]{cy}) },600,660,840,900);
        void Add(string id,string cartId,string label,Leg[] legs,bool dray)
        {
            var root=g.GetChildren().OfType<Node3D>().FirstOrDefault(n=>n.Name.ToString()==(dray?"goods_dray ":"goods_cart ")+id);
            var frame=g.GetChildren().OfType<Node3D>().FirstOrDefault(n=>n.Name.ToString()=="goods_carter "+id);
            if (root==null || frame==null) { GD.PrintErr($"goods drays: no baked {id}"); return; }
            var r=new Rig {Id=id,CartId=cartId,Label=label,Legs=legs,Root=root,Frame=frame};
            r.Man=Carters.Make(frame,dray?"docker_b":"carter",!dray);
            if (dray)
            {
                root.Transform=Transform3D.Identity;
                r.Parts=root.GetChildren().OfType<MeshInstance3D>().ToArray();
                if (r.Parts.Length<13) { GD.PrintErr("goods drays: the horse has no leg parts"); return; }
                r.Horse=new DrayHorse(r.Parts[4],r.Parts.Skip(5).Take(8).Cast<Node3D>().ToArray());
                r.Bed=root.GetChildren().OfType<Node3D>().FirstOrDefault(n=>n is not MeshInstance3D)??new Node3D();
                if (r.Bed.GetParent()==null) root.AddChild(r.Bed);
                r.Body=Mv.BoxBody(root,new Aabb(new(-0.95f,0,-1.9f),new(1.9f,1.7f,3.8f)),"bed_solid");
                r.HorseBody=Mv.BoxBody(root,new Aabb(new(-0.4f,0,-1.2f),new(0.8f,1.8f,2.4f)),"horse_solid");
            }
            else { r.Cart=new PushCart(root); r.Bed=r.Cart.Pivot; }
            rigs.Add(r);
            Read(r);
            Place(r,0,true);
        }
        Add("casks","dray:hessenatie","the Hessenatie's dray with the casks",casks,true);
        Add("sacks","cart:sacks","the Rijnkaai's sack handcart",sacks,false);
        GD.Print($"goods drays: {rigs.Count} rounds driven by the game clock");
        if (MoversTest.On) Probes();
    }

    private static Vector2[] Arc(double x,double z,double radius,double from,double to)
    {
        int n=Math.Max(1,(int)Math.Floor(Math.Abs(to-from)/30+0.5));
        var a=new Vector2[n+1];
        for (int i=0;i<=n;i++) { double h=(from+(to-from)*i/n)*Math.PI/180; a[i]=new((float)Math.Round(x+radius*Math.Sin(h),3),(float)Math.Round(z+radius*Math.Cos(h),3)); }
        return a;
    }

    public static Leg[] Plan(Vector2[][] paths,double outAt,double down,double back,double home)
    {
        Leg Make(Vector2[] raw,double yaw)
        {
            var p=new List<Vector2>();
            foreach (var q in raw) if (p.Count==0 || p[^1].DistanceTo(q)>0.01f) p.Add(q);
            for (int r=0;r<2 && p.Count>=3;r++)
            {
                var q=new List<Vector2> {p[0]};
                for (int i=0;i+1<p.Count;i++) { if (i>0) q.Add(p[i]*0.75f+p[i+1]*0.25f); if (i+2<p.Count) q.Add(p[i]*0.25f+p[i+1]*0.75f); }
                q.Add(p[^1]); p=q;
            }
            var cum=new double[p.Count];
            for (int i=1;i<p.Count;i++) cum[i]=cum[i-1]+p[i].DistanceTo(p[i-1]);
            return new Leg {Points=p.ToArray(),Cum=cum,Yaw0=yaw};
        }
        double EndYaw(Leg l) { var d=l.Points[^1]-l.Points[^2]; return Math.Atan2(d.X,d.Y); }
        double yaw=EndYaw(Make(paths[^1],0));
        var result=new Leg[6];
        for (int i=0;i<6;i++)
        {
            var l=Make(paths[i],yaw);
            l.T0=i switch {0=>outAt-8-l.Length/MPerMin,1=>outAt+8,2=>down+8,3=>back-8-l.Length/MPerMin,4=>back+8,_=>home+8};
            l.T1=l.T0+l.Length/MPerMin; result[i]=l; yaw=EndYaw(l);
        }
        return result;
    }

    public static (int Leg,double S,bool Moving) CartAt(Leg[] legs,double minute,bool sunday)
    {
        if (sunday || minute<legs[0].T0) return (legs.Length-1,legs[^1].Length,false);
        int k=0; for (int i=0;i<legs.Length;i++) if (minute>=legs[i].T0) k=i;
        return (k,Math.Min(legs[k].Length,(minute-legs[k].T0)*MPerMin),minute<legs[k].T1);
    }

    private static void Read(Rig r) => (r.Leg,r.S,r.Moving)=CartAt(r.Legs,MoverClock.HourF*60,MoverClock.Day%7==0);

    private static void Place(Rig r,float step,bool near)
    {
        var l=r.Legs[r.Leg];
        var (man,yaw)=l.Along(r.S-(r.Cart!=null?2.6:0)); r.At=man; r.Yaw=yaw;
        DrayHorse.Put(r.Frame,man,0,yaw); r.Frame.Visible=near;
        r.Man?.Play(r.Moving?"walk":"idle"); r.Man?.SetPace((float)Pace);
        if (near) r.Man?.Update(step);
        if (r.Cart!=null)
        {
            var (axle,_)=l.Along(r.S);
            var hands=Carters.Hands(r.Man,r.Frame,man,yaw);
            float dir=MathF.Atan2(axle.X-hands.X,axle.Y-hands.Z);
            if (r.Cart.Axle.DistanceTo(axle)>0.4f) r.Cart.Place(hands.X,hands.Z,dir);
            r.Cart.Push(step,hands,dir,r.Moving?1:0);
            r.Root.Visible=near;
            return;
        }
        (Vector2 At,float Yaw) At(double behind)
        {
            var (p,h)=l.Along(r.S-behind); var (f,_)=l.Along(r.S-behind+0.4); var (b,_2)=l.Along(r.S-behind-0.4);
            if (f.DistanceTo(b)>0.2f) h=MathF.Atan2(f.X-b.X,f.Y-b.Y);
            p+=new Vector2(-MathF.Cos(h),MathF.Sin(h))*0.85f;
            return (p,h);
        }
        var (horse,hy)=At(1); var (fore,fy)=At(3.05); var (rear,ry)=At(5.45);
        float by=MathF.Atan2(fore.X-rear.X,fore.Y-rear.Y),frontYaw=MathF.Atan2(horse.X-fore.X,horse.Y-fore.Y);
        DrayHorse.Put(r.Parts[0],rear,0,by); DrayHorse.Put(r.Bed,rear,0,by);
        DrayHorse.Put(r.Parts[1],fore,0,frontYaw); DrayHorse.Put(r.Parts[2],rear,0.52f,by,r.RearRoll); DrayHorse.Put(r.Parts[3],fore,0.42f,frontYaw,r.FrontRoll);
        r.Body!.Transform=new Transform3D(new Basis(Vector3.Up,by),new Vector3(rear.X+MathF.Sin(by)*1.15f,0,rear.Y+MathF.Cos(by)*1.15f));
        r.HorseBody!.Transform=new Transform3D(new Basis(Vector3.Up,hy),new Vector3(horse.X,0,horse.Y));
        r.Horse!.Set(horse,hy,r.Gait,r.Moving?1:0);
        r.Root.Visible=near;
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("goods_drays");
        var eye=Main.I.Cam.GlobalPosition;
        for (int i=0;i<rigs.Count;i++)
        {
            var r=rigs[i]; Read(r);
            float ds=r.Moving?(float)(Pace*MoverClock.Dt):0;
            r.Gait=(r.Gait+ds/1.35f)%1; r.RearRoll+=ds/0.52f; r.FrontRoll+=ds/0.42f;
            var (at,_)=r.Legs[r.Leg].Along(r.S);
            bool near=at.DistanceTo(new Vector2(eye.X,eye.Z))<(Daylight.I?.FogFar??200)+15;
            if (near || MoverClock.Frame%4==(ulong)i) Place(r,(float)MoverClock.Dt*(near?1:4),near);
        }
        MoverCost.End("goods_drays");
    }

    private void Probes()
    {
        foreach (var r in rigs)
        {
            MoversTest.Add(new MoversTest.Probe {
                Name="goods_"+r.Id,Hour=r.Id=="casks"?8+8.5/60:10+9.0/60,Gap=3,
                Ready=()=>r.Moving,
                Where=()=> (new Vector3(r.At.X,0,r.At.Y),r.S,$"{r.Label}, leg {r.Leg}, {r.S:0.000} m, {(r.Moving?"moving":"standing")}"),
                View=()=> { var at=r.Cart!=null?new Vector3(r.Cart.Axle.X,1,r.Cart.Axle.Y):r.Body!.GlobalPosition+new Vector3(MathF.Sin(r.Yaw)*1.4f,1,MathF.Cos(r.Yaw)*1.4f); return (at+new Vector3(5,2.5f,5),at); },
                Check=()=> { var expected=CartAt(r.Legs,MoverClock.HourF*60,MoverClock.Day%7==0); return expected.Leg==r.Leg && Math.Abs(expected.S-r.S)<0.01?"":"the rig differs from the game clock"; }
            });
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;

namespace Scheldemist.Movers;

/// <summary>The families on the five barges (game/lifeAboard.ts), in Human bodies on the live hull frame.</summary>
[GamePart(49)]
public partial class ShipLife : Node
{
    private sealed class Round
    {
        public Vector2 At,Home;
        public float Yaw;
        public bool Walking,AtHome=true;
        private readonly Vector2[] route;
        private Vector2[] path=Array.Empty<Vector2>();
        private bool outbound;
        private int next,index;
        private float wait;
        public Round(Vector2 home,Vector2[] route,int seed) { At=Home=home; this.route=route; wait=4+seed%19; }
        public void Step(float dt)
        {
            Walking=false; dt=Math.Min(dt,0.15f);
            if (path.Length==0)
            {
                if ((wait-=dt)>0) return;
                if (outbound) { path=route.Take(route.Length-1).Reverse().Append(Home).ToArray(); outbound=false; }
                else { path=route; outbound=true; next++; }
                index=0;
            }
            float step=0.5f*dt;
            while (step>0 && index<path.Length)
            {
                var d=path[index]-At; float len=d.Length();
                if (len<0.001f) { index++; continue; }
                float k=Math.Min(step/len,1); At+=d*k; Yaw=MathF.Atan2(d.X,d.Y); Walking=true; step-=len;
                if (k==1) index++;
            }
            if (index==path.Length) { path=Array.Empty<Vector2>(); wait=outbound?5+next%7:18+next%13; }
            AtHome=path.Length==0 && !outbound;
        }
    }
    private sealed class Member
    {
        public Human Human=null!;
        public Node3D Root=null!;
        public Round Round=null!;
        public string Motion="";
        public float Yaw;
    }
    private sealed class Family
    {
        public string Kind="";
        public Node3D Root=null!;
        public Func<Transform3D> Hull=null!;
        public readonly List<Member> People=new();
    }
    private readonly List<Family> families=new();
    public int People=>families.Sum(f=>f.People.Count);
    public override void _Ready()
    {
        if (Boats.I==null || !Humans.Ready) { SetProcess(false); return; }
        foreach (var g in Mv.Tops("life_aboard")) g.Visible=false;
        foreach (var spot in new[] {new Vector3(-287,0,-6),new Vector3(-228,0,-4),new Vector3(150,0,-6),new Vector3(72,0,78),new Vector3(120,0,108)})
        {
            var near=Boats.I.NearMoored(spot,"hengst","rhine_barge");
            if (near==null) continue;
            var f=new Family {Kind=near.Value.Kind,Hull=near.Value.World,Root=new Node3D {Name="live_family",Visible=false}};
            Mv.Town.AddChild(f.Root);
            f.Root.Transform=f.Hull();
            bool rhine=f.Kind=="rhine_barge";
            void Add(string kind,string motion,Vector3 at,float yaw,Vector2[] route)
            {
                var human=Humans.Make(kind); if (human==null) return;
                var root=new Node3D {Position=at,Rotation=new Vector3(0,yaw,0)};
                f.Root.AddChild(root); root.AddChild(human.Root); human.Start(); human.Play(motion,0);
                f.People.Add(new Member {Human=human,Root=root,Motion=motion,Yaw=yaw,Round=new Round(new Vector2(at.X,at.Z),route,(f.People.Count+1)*7+Math.Abs((int)f.Hull().Origin.X))});
            }
            if (rhine)
            {
                Add("old_man","smoke",new(0.7f,1.22f,-16.1f),0.2f,new[] {new Vector2(1.3f,-16.1f),new Vector2(1,-16.3f)});
                Add("wife_b","wash",new(-1.4f,0.8f,-11.4f),MathF.PI/2,new[] {new Vector2(-0.4f,-11.4f),new Vector2(0.7f,-11.1f)});
                Add("girl","idle",new(1.8f,0.8f,-10.8f),-MathF.PI/2,new[] {new Vector2(1.8f,-11.5f),new Vector2(1,-11.5f)});
            }
            else
            {
                Add("sailor_b","smoke",new(0.55f,1.3f,-9.75f),0.3f,new[] {new Vector2(1.2f,-9.75f),new Vector2(0.85f,-10)});
                Add("wife_a","wash",new(-1.15f,0.74f,-6.2f),MathF.PI/2,new[] {new Vector2(-0.3f,-6.2f),new Vector2(0.6f,-5.9f)});
                Add("boy","idle",new(1.55f,0.74f,-5.6f),-MathF.PI/2,new[] {new Vector2(1.55f,-6.1f),new Vector2(0.85f,-6.1f)});
            }
            families.Add(f);
        }
        GD.Print($"life aboard: {People} people on {families.Count} live barges");
        if (MoversTest.On && families.Count>0)
        {
            var f=families[0];
            MoversTest.Add(new MoversTest.Probe {Name="ship_family",Hour=13,Gap=3,MinMove=0.003,
                Where=()=> (f.People[0].Root.GlobalPosition,f.Root.Rotation.Z,$"{f.People.Count} Human figures ride the {f.Kind}'s tide and roll"),
                View=()=> { var at=f.People[0].Root.GlobalPosition+Vector3.Up*0.8f; return (at+new Vector3(4,2,5),at); }
            });
        }
    }
    public override void _Process(double delta)
    {
        MoverCost.Begin("ship_life");
        var eye=Main.I.Cam.GlobalPosition;
        foreach (var f in families)
        {
            var hull=f.Hull();
            bool near=MoverClock.HourF>=6.5 && MoverClock.HourF<21 && Game.GameState.I.Weather!="storm" && new Vector2(hull.Origin.X-eye.X,hull.Origin.Z-eye.Z).Length()<70;
            f.Root.Visible=near;
            if (!near) continue;
            f.Root.Transform=hull;
            foreach (var p in f.People)
            {
                p.Round.Step((float)MoverClock.Dt); var r=p.Round; bool rhine=f.Kind=="rhine_barge";
                double t=0.5+r.At.Y/(rhine?34.0:21);
                float deck=(float)((rhine?0.85:0.8)+(rhine?0.75:0.95)*Math.Pow(Math.Abs(2*t-1),3)+(rhine?0.25:0.5)*Math.Pow(Math.Max(0,(t-0.8)/0.2),2)-0.28);
                p.Root.Position=new Vector3(r.At.X,deck,r.At.Y);
                p.Root.Rotation=new Vector3(0,r.Walking?r.Yaw:r.AtHome?p.Yaw:r.Yaw+MathF.PI,0);
                p.Human.Play(r.Walking?"walk":r.AtHome?p.Motion:p.Human.Kind is "boy" or "girl"?"idle":"behind");
                p.Human.SetPace(0.5f); p.Human.Update((float)MoverClock.Dt);
            }
        }
        MoverCost.End("ship_life");
    }
}

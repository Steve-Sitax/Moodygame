using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>Boat lanterns from the model's lamps extra: live hull frames, the browser's dusk fade and flicker.</summary>
[GamePart(50)]
public partial class BoatLamps : Node
{
    public static BoatLamps I {get;private set;}=null!;
    private sealed record Lamp(Func<Transform3D> World, Func<bool> Visible, Vector3 Local, int Kind, float Phase, Action<Vector3,float>? Spill)
    {
        /// <summary>The lantern's glass in its frame, when the model has glass round the lamp: lit over it (#167).</summary>
        public Transform3D? Glass {get;init;}
    }
    private readonly List<Lamp> lamps=new();
    private readonly Dictionary<string,(Vector3 At,int Kind,Transform3D? Glass)[]> points=new();
    private readonly HashSet<Boats.Float> registered=new();
    private static readonly Color[] Colors={new(1,.82f,.5f),new(1,.25f,.15f),new(.35f,1,.45f)};
    private Copies draw=null!;
    private long seed=91;
    private float lit;
    private bool burning;
    private int floatCount = -1;
    private (Vector3 At,int Kind,Transform3D? Glass)[] Points(string kind)
    {
        if (points.TryGetValue(kind,out var p)) return p;
        var root=ModelLibrary.Get("boats")?.Roots.GetValueOrDefault(kind);
        var list=new List<(Vector3,int,Transform3D?)>();
        if (root!=null && root.HasMeta("extras") && root.GetMeta("extras").AsGodotDictionary().TryGetValue("lamps",out var raw))
        {
            using var json=JsonDocument.Parse(raw.AsString());
            var glass=GlassPoints(root);
            foreach (var q in json.RootElement.EnumerateArray())
            {
                var at=new Vector3(q[0].GetSingle(),q[2].GetSingle(),-q[1].GetSingle());
                list.Add((at,q.GetArrayLength()>3?q[3].GetInt32():0,GlassBox(glass,at)));
            }
        }
        points[kind]=p=list.ToArray(); return p;
    }
    private void Add(string kind,Func<Transform3D> world,Func<bool> visible)
    {
        foreach (var p in Points(kind))
        {
            seed=seed*16807%2147483647;
            int k=Math.Clamp(p.Kind,0,2);
            lamps.Add(new(world,visible,p.At,k,(float)(seed/2147483647.0*6.283),Lights.I?.AddMoving(kind+" lantern",Colors[k],k==0?.55f:.3f)){Glass=p.Glass});
            if(p.Glass!=null)GlassLanterns++;
        }
    }
    public override void _Ready()
    {
        I=this;
        if (Boats.I==null) {SetProcess(false); return;}
        foreach (var hull in Boats.I.MooredHulls()) Add(hull.Kind,hull.World,hull.Shown);
        Register();
        var mesh=new SphereMesh {Radius=.12f,Height=.24f,RadialSegments=6,Rings=3};
        mesh.Material=BakedWorld.PsxMaterial(new StandardMaterial3D {AlbedoColor=new Color(1,1,1)},new Psx.Kind(Unlit:true,Blend:true,Scissor:false,TwoSided:false,DepthWrite:false,Snap:true,Atlas:0,VertexColor:true,Add:true,Fog:true));
        PrepareWindows(mesh.Material);
        var mm=new MultiMesh {TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=mesh,InstanceCount=Math.Max(512,lamps.Count+128)};
        var node=new MultiMeshInstance3D {Name="live_boat_lanterns",Multimesh=mm};
        Mv.Town.AddChild(node); draw=new Copies(node); draw.ZeroAll(); draw.Commit();
        if(lamps.Count>0)Main.I.World.Unported.Remove("boat_lamps");
        GD.Print($"boat lanterns: {lamps.Count} on live hulls, fixed spill slots, {GlassLanterns} with glass lit over it");
        if(MoversTest.On && lamps.Count>0)
        {
            var l=lamps[0];
            MoversTest.Add(new MoversTest.Probe {Name="boat_lantern",Hour=23,Gap=3,MinMove=.001,MinTurn=.003,
                Ready=()=>lit>.9f,Where=()=> (l.World()*l.Local,lit*(.9+.1*Math.Sin(MoverClock.T*7.3+l.Phase)*Math.Sin(MoverClock.T*3.1+l.Phase*2)),"live hull lantern, kind "+l.Kind),
                View=()=> {var at=l.World()*l.Local;return(at+new Vector3(4,1,-4),at);},Check=()=>lit>.9f?"":"the boat lantern did not light at night"});
        }
    }
    private void Register()
    {
        if (floatCount == Boats.I.Floats.Count) return;
        floatCount = Boats.I.Floats.Count;
        foreach (var f in Boats.I.Floats)
            if (registered.Add(f)) Add(f.Kind,()=>f.Inner.GlobalTransform,()=>IsInstanceValid(f.Outer) && f.Outer.IsVisibleInTree());
    }
    public override void _Process(double delta)
    {
        MoverCost.Begin("boat_lamps"); Register();
        lit+=((Daylight.I?.LampsLit??0)-lit)*(float)Math.Min(1,MoverClock.Dt*2);
        if (lit<=.005f)
        {
            if (burning) { draw.ZeroAll(); foreach (var l in lamps) l.Spill?.Invoke(Vector3.Down*999,0); draw.Commit(); GlassOff(); }
            UpdateWindows(0);
            burning=false; StageBurning=0; GlassBurning=0; MoverCost.End("boat_lamps"); return;
        }
        UpdateWindows(lit);
        burning=true;
        var eye=Main.I.Cam.GlobalPosition; float far=(Daylight.I?.FogFar??200)+15; int stage=0; glassBurning=0;
        for (int i=0;i<lamps.Count;i++)
        {
            var l=lamps[i];
            if(!l.Visible()) {draw.Zero(i);l.Spill?.Invoke(Vector3.Down*999,0);LitGlass(i,l,default,0);continue;}
            var xf=l.World();
            bool near=new Vector2(xf.Origin.X-eye.X,xf.Origin.Z-eye.Z).LengthSquared()<far*far;
            if (!near || lit<=.005f) {draw.Zero(i); l.Spill?.Invoke(Vector3.Down*999,0); LitGlass(i,l,default,0); continue;}
            var at=xf*l.Local;
            float flick=.9f+.1f*MathF.Sin((float)MoverClock.T*7.3f+l.Phase)*MathF.Sin((float)MoverClock.T*3.1f+l.Phase*2);
            draw.Set(i,new Transform3D(Basis.Identity,at)); draw.Tint(i,Colors[l.Kind]*(lit*flick));
            l.Spill?.Invoke(at,lit>.05f?1:0);
            if(OnStage(i))stage++;
            LitGlass(i,l,xf,lit*flick);
        }
        StageBurning=stage; GlassBurning=glassBurning; draw.Commit(); glass?.Commit(); MoverCost.End("boat_lamps");
    }
}

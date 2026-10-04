using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Movers;

public partial class BoatLamps
{
    private sealed record Pane(Func<Transform3D> World,Func<bool> Visible,Transform3D Local);
    private readonly List<Pane> panes=new(64);
    private Copies windows=null!;
    public int FerryLanterns {get;private set;}
    public int FerryWindows=>panes.Count;
    internal float LampLevel=>lit;
    private void PrepareWindows(Material material)
    {
        var mm=new MultiMesh {TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,InstanceCount=64,Mesh=new QuadMesh {Size=Vector2.One,Material=material}};
        var node=new MultiMeshInstance3D {Name="ferry_windows_lit",Multimesh=mm};Mv.Town.AddChild(node);windows=new(node);windows.ZeroAll();windows.Commit();
    }
    private static Vector3 Blender(JsonElement p)=>new(p[0].GetSingle(),p[2].GetSingle(),-p[1].GetSingle());
    public void AddFerry(Func<Transform3D> frame,Func<bool> visible)
    {
        if(ModelExtras.Get("ferry","ferry","lights") is not {} data)return;
        void AddLight(JsonElement p,int kind,float power,Func<bool>? arc=null)
        {
            if(lamps.Count>=512)throw new InvalidOperationException("Boat lantern pool exhausted at load.");
            seed=seed*16807%2147483647;lamps.Add(new(frame,arc??visible,Blender(p),kind,(float)(seed/2147483647.0*6.283),power>0?Lights.I?.AddMoving("St. Anna lantern",Colors[kind],power):null));FerryLanterns++;
        }
        bool InArc(int side)
        {if(!visible())return false;var eye=frame().AffineInverse()*Main.I.Cam.GlobalPosition;return side==0?eye.Z<Math.Abs(eye.X)*.414f:eye.X*side>0&&eye.Z<Math.Abs(eye.X)*.414f;}
        if(data.TryGetProperty("mast",out var mast)&&mast.ValueKind==JsonValueKind.Array)AddLight(mast,0,.8f,()=>InArc(0));
        if(data.TryGetProperty("side",out var sides))foreach(var p in sides.EnumerateArray()){int side=p[3].GetSingle()>0?1:-1;AddLight(p,side>0?1:2,0,()=>InArc(side));}
        if(data.TryGetProperty("lanterns",out var lanterns))foreach(var p in lanterns.EnumerateArray())AddLight(p,0,1.6f);
        if(data.TryGetProperty("windows",out var ws))foreach(var p in ws.EnumerateArray())
        {
            if(panes.Count>=64)throw new InvalidOperationException("Ferry pane pool exhausted at load.");
            var normal=new Vector3(p[3].GetSingle(),0,-p[4].GetSingle());var basis=Basis.LookingAt(-normal).Scaled(new(p[5].GetSingle()*.86f,p[6].GetSingle()*.86f,1));
            panes.Add(new(frame,visible,new(basis,Blender(p)+normal*.012f)));
        }
    }
    private void UpdateWindows(float level)
    {
        for(int i=0;i<panes.Count;i++){var p=panes[i];if(level<=.005f||!p.Visible())windows.Zero(i);else{windows.Set(i,p.World()*p.Local);windows.Tint(i,new Color(1,.6f,.22f)*level);}}windows.Commit();
    }
}

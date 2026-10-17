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
    public float LampLevel=>lit;
    private void PrepareWindows(Material material)
    {
        var mm=new MultiMesh {TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,InstanceCount=64,Mesh=new QuadMesh {Size=Vector2.One,Material=material}};
        var node=new MultiMeshInstance3D {Name="ferry_windows_lit",Multimesh=mm};Mv.Town.AddChild(node);windows=new(node);windows.ZeroAll();windows.Commit();
        PrepareStageGlass(material);
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
    /// <summary>The Werf landing stage's lanterns (#147): the stage's lamps extra, kept in the boat lantern pool so they
    /// ride the tide with the stage and light at dusk like the boats'. Their glass is painted solid and lit like any
    /// wood, so at night a glow box the size of each lantern's glass (measured from the stage's own mesh) is laid over
    /// it, in the lanterns' own additive glow material: no new shader kind, no new light.</summary>
    public int StageLanterns {get;private set;}
    /// <summary>For a check: how many of the stage's lanterns were drawn burning in the last frame.</summary>
    public int StageBurning {get;private set;}
    /// <summary>For a check: how many of the stage's lanterns had their glass found in the stage's mesh.</summary>
    public int StageGlassMeasured {get;private set;}
    private int stageFrom=-1;
    private Copies? stageGlass;
    private readonly List<Transform3D> stageGlassLocal=new(8);
    private void PrepareStageGlass(Material material)
    {
        var mm=new MultiMesh {TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,InstanceCount=8,Mesh=new BoxMesh {Size=Vector3.One,Material=material}};
        var node=new MultiMeshInstance3D {Name="stage_lantern_glass_lit",Multimesh=mm};Mv.Town.AddChild(node);stageGlass=new(node);stageGlass.ZeroAll();stageGlass.Commit();
    }
    public void AddStage(Node3D stage,Func<Transform3D> frame,Func<bool> visible)
    {
        if(stageFrom>=0||ModelExtras.Get("ferry","landing_stage","lamps") is not {ValueKind:JsonValueKind.Array} data)return;
        // the glass of every lantern on the stage, in the stage's own frame
        var glass=new List<Vector3>();var inverse=stage.GlobalTransform.AffineInverse();
        foreach(var n in BakedWorld.All(stage))
        {
            if(n is not MeshInstance3D{Mesh:{} mesh} mi)continue;
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                string a=mesh.SurfaceGetMaterial(s)?.ResourceName??"",b=mi.GetActiveMaterial(s)?.ResourceName??"";
                if(!a.Contains("lamp_glass")&&!b.Contains("lamp_glass"))continue;
                var xf=inverse*mi.GlobalTransform;foreach(var v in mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())glass.Add(xf*v);
            }
        }
        stageFrom=lamps.Count;
        foreach(var p in data.EnumerateArray())
        {
            if(lamps.Count>=512||stageGlassLocal.Count>=8)throw new InvalidOperationException("Boat lantern pool exhausted at load.");
            var at=Blender(p);seed=seed*16807%2147483647;
            lamps.Add(new(frame,visible,at,0,(float)(seed/2147483647.0*6.283),Lights.I?.AddMoving("landing stage lantern",Colors[0],1.1f)));StageLanterns++;
            // its glass: the glass points round the lamp (a lantern is 0.2 to 0.3 m wide and 0.3 to 0.4 m tall)
            Vector3 lo=new(1e9f,1e9f,1e9f),hi=-lo;int found=0;
            foreach(var v in glass)if(MathF.Abs(v.X-at.X)<.3f&&MathF.Abs(v.Z-at.Z)<.3f&&MathF.Abs(v.Y-at.Y)<.35f){lo=lo.Min(v);hi=hi.Max(v);found++;}
            if(found>=8)StageGlassMeasured++;else{lo=at-new Vector3(.13f,.2f,.13f);hi=at+new Vector3(.13f,.2f,.13f);}
            stageGlassLocal.Add(new(Basis.Identity.Scaled(hi-lo+new Vector3(.012f,.002f,.012f)),(lo+hi)/2));
        }
        GD.Print($"landing stage lanterns: {StageLanterns}, glass measured on {StageGlassMeasured}");
    }
    private bool OnStage(int i)=>stageFrom>=0&&i>=stageFrom&&i<stageFrom+StageLanterns;
    /// <summary>A stage lantern's glass: lit to this level over its frame, or out (0).</summary>
    private void StageGlass(int i,in Transform3D world,float level)
    {
        if(stageGlass==null)return;int j=i-stageFrom;
        if(level<=0){stageGlass.Zero(j);return;}
        stageGlass.Set(j,world*stageGlassLocal[j]);stageGlass.Tint(j,new Color(1,.6f,.26f)*(level*.62f));
    }
    private void StageGlassOff(){if(stageGlass==null)return;stageGlass.ZeroAll();stageGlass.Commit();}
    private void UpdateWindows(float level)
    {
        for(int i=0;i<panes.Count;i++){var p=panes[i];if(level<=.005f||!p.Visible())windows.Zero(i);else{windows.Set(i,p.World()*p.Local);windows.Tint(i,new Color(1,.6f,.22f)*level);}}windows.Commit();
    }
}

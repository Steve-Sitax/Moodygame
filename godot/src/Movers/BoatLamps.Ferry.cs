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
        PrepareGlass(material);
    }
    private static Vector3 Blender(JsonElement p)=>new(p[0].GetSingle(),p[2].GetSingle(),-p[1].GetSingle());
    public void AddFerry(Func<Transform3D> frame,Func<bool> visible)
    {
        if(ModelExtras.Get("ferry","ferry","lights") is not {} data)return;
        var glass=ModelLibrary.Get("ferry")?.Roots.GetValueOrDefault("ferry") is {} root?GlassPoints(root):new List<Vector3>();
        void AddLight(JsonElement p,int kind,float power,Func<bool>? arc=null)
        {
            if(lamps.Count>=512)throw new InvalidOperationException("Boat lantern pool exhausted at load.");
            var at=Blender(p);var box=GlassBox(glass,at);if(box!=null)GlassLanterns++;
            seed=seed*16807%2147483647;lamps.Add(new(frame,arc??visible,at,kind,(float)(seed/2147483647.0*6.283),power>0?Lights.I?.AddMoving("St. Anna lantern",Colors[kind],power):null){Glass=box});FerryLanterns++;
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
    /// ride the tide with the stage and light at dusk like the boats'.</summary>
    public int StageLanterns {get;private set;}
    /// <summary>For a check: how many of the stage's lanterns were drawn burning in the last frame.</summary>
    public int StageBurning {get;private set;}
    /// <summary>For a check: how many of the stage's lanterns had their glass found in the stage's mesh.</summary>
    public int StageGlassMeasured {get;private set;}
    /// <summary>For a check: how many lanterns (boats, ferry, stage) have their glass lit over it at night.</summary>
    public int GlassLanterns {get;private set;}
    /// <summary>For a check: how many lanterns' glass was drawn lit in the last frame.</summary>
    public int GlassBurning {get;private set;}
    private int stageFrom=-1,glassBurning;
    private Copies? glass;
    /// <summary>
    /// A lantern's glass is painted solid and lit like any wood, which hides the small glow ball inside (#147, #167).
    /// At night a glow box the size of the glass, measured from the model's own mesh, is laid over it, in the lanterns'
    /// own additive glow material: one copy per lantern of the pool, no new shader kind, no new light.
    /// </summary>
    private void PrepareGlass(Material material)
    {
        var mm=new MultiMesh {TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,InstanceCount=Math.Max(512,lamps.Count+128),Mesh=new BoxMesh {Size=Vector3.One,Material=material}};
        var node=new MultiMeshInstance3D {Name="lantern_glass_lit",Multimesh=mm};Mv.Town.AddChild(node);glass=new(node);glass.ZeroAll();glass.Commit();
    }
    /// <summary>Every vertex of the model's glass ("glass", "lamp_glass"), in the model root's own frame; hidden helper
    /// copies (the far copy) left out.</summary>
    private static List<Vector3> GlassPoints(Node3D root)
    {
        var list=new List<Vector3>();
        foreach(var n in BakedWorld.All(root))
        {
            if(n is not MeshInstance3D{Mesh:{} mesh} mi)continue;
            var xf=Transform3D.Identity;bool shown=true;
            for(Node? p=mi;p!=null&&p!=root;p=p.GetParent())if(p is Node3D q){xf=q.Transform*xf;shown&=q.Visible;}
            if(!shown)continue;
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                string a=mesh.SurfaceGetMaterial(s)?.ResourceName??"",b=mi.GetActiveMaterial(s)?.ResourceName??"";
                if(!IsGlass(a)&&!IsGlass(b))continue;
                foreach(var v in mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())list.Add(xf*v);
            }
        }
        return list;
    }
    private static bool IsGlass(string material)=>material.Contains("glass",StringComparison.OrdinalIgnoreCase)&&!material.Contains("window",StringComparison.OrdinalIgnoreCase);
    /// <summary>The box of the glass round a lamp (a lantern is 0.17 to 0.3 m wide and 0.2 to 0.4 m tall), or null when
    /// the model has no glass there.</summary>
    private static Transform3D? GlassBox(List<Vector3> glass,Vector3 at)
    {
        Vector3 lo=new(1e9f,1e9f,1e9f),hi=-lo;int found=0;
        foreach(var v in glass)if(MathF.Abs(v.X-at.X)<.3f&&MathF.Abs(v.Z-at.Z)<.3f&&MathF.Abs(v.Y-at.Y)<.35f){lo=lo.Min(v);hi=hi.Max(v);found++;}
        if(found<8)return null;
        return new(Basis.Identity.Scaled(hi-lo+new Vector3(.012f,.002f,.012f)),(lo+hi)/2);
    }
    public void AddStage(Node3D stage,Func<Transform3D> frame,Func<bool> visible)
    {
        if(stageFrom>=0||ModelExtras.Get("ferry","landing_stage","lamps") is not {ValueKind:JsonValueKind.Array} data)return;
        // the glass of every lantern on the stage, in the stage's own frame
        var points=GlassPoints(stage);
        stageFrom=lamps.Count;
        foreach(var p in data.EnumerateArray())
        {
            if(lamps.Count>=512)throw new InvalidOperationException("Boat lantern pool exhausted at load.");
            var at=Blender(p);seed=seed*16807%2147483647;
            var box=GlassBox(points,at);
            if(box!=null)StageGlassMeasured++;else box=new(Basis.Identity.Scaled(new Vector3(.272f,.402f,.272f)),at);
            GlassLanterns++;
            lamps.Add(new(frame,visible,at,0,(float)(seed/2147483647.0*6.283),Lights.I?.AddMoving("landing stage lantern",Colors[0],1.1f)){Glass=box});StageLanterns++;
        }
        GD.Print($"landing stage lanterns: {StageLanterns}, glass measured on {StageGlassMeasured}");
    }
    private bool OnStage(int i)=>stageFrom>=0&&i>=stageFrom&&i<stageFrom+StageLanterns;
    /// <summary>A lantern's glass: lit to this level over its frame, or out (0). Lanterns without glass draw nothing here.</summary>
    private void LitGlass(int i,Lamp l,in Transform3D world,float level)
    {
        if(glass==null||l.Glass is not {} local)return;
        if(level<=0){glass.Zero(i);return;}
        glassBurning++;
        glass.Set(i,world*local);glass.Tint(i,(l.Kind==0?new Color(1,.6f,.26f):Colors[l.Kind])*(level*.62f));
    }
    private void GlassOff(){if(glass==null)return;glass.ZeroAll();glass.Commit();}
    private void UpdateWindows(float level)
    {
        for(int i=0;i<panes.Count;i++){var p=panes[i];if(level<=.005f||!p.Visible())windows.Zero(i);else{windows.Set(i,p.World()*p.Local);windows.Tint(i,new Color(1,.6f,.22f)*level);}}windows.Commit();
    }
}

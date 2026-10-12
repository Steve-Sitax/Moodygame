using System;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.Movers;

public partial class Boats
{
    /// <summary>Dev: the largest waterline error, with each boat's normal heave removed.</summary>
    public float WaterlineError()
    {
        float error=0, t=(float)MoverClock.T;
        foreach(var row in rows)
            for(int i=0;i<row.N;i++)
            {
                if(row.Gone[i]) continue;
                float level=Tide.LevelAt(row.X[i],row.Z[i]), floor=row.Floor[i];
                float free=level<=floor+0.06f?0:1, w=MathF.Tau/row.M[3], h=row.M[0]*Math.Min(MoverClock.Sea,3.6f)*free;
                float heave=h*MathF.Sin(w*t+row.P0[i])+h*0.4f*MathF.Sin(2.3f*w*t+row.P0[i]*1.7f);
                error=MathF.Max(error,MathF.Abs(row.World[i].Origin.Y-heave-MathF.Max(level,floor)));
            }
        foreach(var f in floats)
        {
            if(!IsInstanceValid(f.Outer)||!f.Outer.IsVisibleInTree()) continue;
            var p=f.Outer.Position;
            float floor=MathF.Max(BoatGround.Floor(f.Kind,p.X,p.Z,f.Outer.Rotation.Y),float.IsNaN(f.Floor)?float.NegativeInfinity:f.Floor);
            error=MathF.Max(error,MathF.Abs(p.Y-MathF.Max(Tide.LevelAt(p.X,p.Z),floor)));
        }
        return error;
    }

    /// <summary>The grounded waterline of the moored hull beside a crane.</summary>
    public float HoldLevel(float x, float z)
    {
        float best=26, level=Tide.LevelAt(x,z);
        foreach(var row in rows)
        {
            if(Dims(row.Kind).Length<9 || row.Kind=="pontoon_section") continue;
            for(int i=0;i<row.N;i++)
            {
                float d=new Vector2(row.X[i]-x,row.Z[i]-z).Length();
                if(d>=best || row.Gone[i]) continue;
                best=d;level=MathF.Max(Tide.LevelAt(row.X[i],row.Z[i]),row.Floor[i]);
            }
        }
        foreach(var f in floats)
        {
            if(f.Outer.GetParent()!=Mv.Town || !f.Outer.Visible || Dims(f.Kind).Length<9 || f.Kind=="pontoon_section") continue;
            var p=f.Outer.Position;float d=new Vector2(p.X-x,p.Z-z).Length();
            if(d>=best) continue;
            best=d;level=MathF.Max(Tide.LevelAt(p.X,p.Z),MathF.Max(BoatGround.Floor(f.Kind,p.X,p.Z,f.Outer.Rotation.Y),float.IsNaN(f.Floor)?float.NegativeInfinity:f.Floor));
        }
        return level;
    }

    // W0's caps on bare hulls may be absent from an older bake. Use the current
    // model's cap while the lead prepares the combined town bake.
    private MeshInstance3D? CurrentCap(string kind)
    {
        var model=ModelLibrary.Get("boats",new ModelLibrary.Look(TwoSided:true,Affine:0.6));
        if(model==null) return null;
        foreach(string name in new[]{kind+"_bare",kind})
            if(model.Roots.TryGetValue(name,out var source))
            {
                var cap=BakedWorld.All(source).OfType<MeshInstance3D>().FirstOrDefault(m=>m.Name.ToString().EndsWith("_cap"));
                if(cap!=null) return cap;
            }
        return null;
    }

    private void FillMissingCaps()
    {
        foreach(var f in floats)
        {
            if(BakedWorld.All(f.Inner).OfType<MeshInstance3D>().Any(m=>m.Name.ToString().EndsWith("_cap"))) continue;
            if(CurrentCap(f.Kind) is not {} cap) continue;
            f.Inner.AddChild(new MeshInstance3D{Name=f.Kind+"_cap",Mesh=cap.Mesh,Transform=cap.Transform});
        }
        foreach(var row in rows)
        {
            if(row.Meshes.Any(m=>m.Mm.Mesh is {} mesh && Enumerable.Range(0,mesh.GetSurfaceCount()).Any(s=>mesh.SurfaceGetMaterial(s)?.ResourceName=="cap"))) continue;
            if(CurrentCap(row.Kind) is not {Mesh:not null} cap) continue;
            var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=cap.Mesh,InstanceCount=row.N};
            var mi=new MultiMeshInstance3D{Name="INST0_"+row.Kind.Replace("_","")+"moored_mm",Multimesh=mm};
            row.Node?.GetParent().AddChild(mi);
            row.Meshes.Add((mm,cap.Transform,new float[row.N*12]));
            Write(row,(float)MoverClock.T);
        }
    }
}

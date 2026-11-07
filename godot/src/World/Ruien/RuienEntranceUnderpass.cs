using System;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

public static partial class RuienEntrance
{
    public sealed class WalkUnderpass
    {
        public Vector3 From,To;
        public float Width,Bed;
        public Transform3D Frame,Inverse;
        public float Length;
    }

    private static WalkUnderpass ReadUnderpass(JsonElement e)
    {
        Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
        var a=V(e.GetProperty("from"));var b=V(e.GetProperty("to"));var dir=(b-a).Normalized();
        var frame=new Transform3D(new Basis(Vector3.Up.Cross(dir),Vector3.Up,dir),a);
        return new WalkUnderpass{From=a,To=b,Length=a.DistanceTo(b),Width=e.GetProperty("width").GetSingle(),
            Bed=e.GetProperty("bed").GetSingle(),Frame=frame,Inverse=frame.AffineInverse()};
    }

    // Keep the existing hall walk open below a new buried stair. The new brick barrel supports the stair above it.
    private static float UnderpassAir(Spec s,Vector3 world)
    {
        var w=s.Underpass!;var p=w.Inverse*world;float half=w.Width/2+.005f;
        float side=p.Y<=1.55f?half-MathF.Abs(p.X):half-new Vector2(p.X,p.Y-1.55f).Length();
        return Math.Min(Math.Min(side,p.Y+.08f),Math.Min(p.Z+.03f,w.Length+.03f-p.Z));
    }

    private static Node3D BuildUnderpass(Spec s)
    {
        var w=s.Underpass!;var root=new Node3D{Name="hall_walk_underpass",Transform=s.Local.AffineInverse()};
        var brick=new SurfaceTool();var arch=new SurfaceTool();brick.Begin(Mesh.PrimitiveType.Triangles);arch.Begin(Mesh.PrimitiveType.Triangles);
        var mat=RuienMaterials.Get("ruien_brick_stretcher");float floor=w.From.Y,half=w.Width/2;
        foreach(float side in new[]{-1f,1f})
        {
            var lo=new Vector3(side<0?-half-.24f:half,w.Bed-floor,-.01f);
            var hi=new Vector3(side<0?-half:half+.24f,1.55f,w.Length+.01f);
            brick.AppendFrom(BevelMesh.Box(hi-lo,.008f,mat),0,w.Frame*new Transform3D(Basis.Identity,(lo+hi)/2));
        }
        var direction=(w.To-w.From).Normalized();
        RuienStair.Vault(arch,w.From+Vector3.Up*1.55f,w.To+Vector3.Up*1.55f,Vector3.Up.Cross(direction),half,half,.24f);
        RuienStair.Add(root,brick,"ruien_brick_stretcher",true);
        RuienStair.Add(root,arch,"ruien_brick_header",true,barrel:true);
        return root;
    }
}

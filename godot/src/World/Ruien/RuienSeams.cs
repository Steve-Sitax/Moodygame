using System;
using System.Linq;
using Godot;
namespace Scheldemist.World.Ruien;
/// <summary>Loft new lining to a retained section without moving the retained export or paving.</summary>
public static class RuienSeams
{
    public static bool Apply(Godot.Collections.Array arrays,RuienData.Area area)
    {
        if(area.SeamProfiles.Count==0)return false;
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var n=arrays[(int)Mesh.ArrayType.Normal].VariantType==Variant.Type.Nil?Array.Empty<Vector3>():arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var section=area.Zones[0].S;
        Vector3 Map(Vector3 at)
        {
            foreach(var seam in area.SeamProfiles)
            {
                var xy=new Vector2(at.X,at.Z)-seam.At;float u=xy.Dot(seam.Direction);
                float baseSpring=seam.Portal?-2.7f:section.Spring,crown=seam.Portal?-.9f:section.Crown;
                if(u<-seam.Before-.02f||u>seam.Length||at.Y<Math.Min(seam.Spring,baseSpring)||at.Y>=crown)continue;
                var across=new Vector2(seam.Direction.Y,-seam.Direction.X);float x=xy.Dot(across);
                float Shell(float spring)=>seam.Portal?1.8f*MathF.Sqrt(Math.Clamp(1-MathF.Pow(Math.Max(0,at.Y-spring)/(crown-spring),2),0,1)):(section with{Spring=spring}).Shell(at.Y);
                float shell=Shell(baseSpring),fade=1-Mathf.SmoothStep(seam.PlateauAfter,seam.Length,Math.Max(0,u));
                if(u<0&&seam.Before>0)fade*=1-Mathf.SmoothStep(seam.PlateauBefore,seam.Before,-u);
                // Keep the centre of ribs continuous, and taper into the surrounding gallery masonry.
                float radial=Math.Clamp(Math.Abs(x)/Math.Max(shell,.01f),0,1);
                if(seam.Portal)radial*=1-Mathf.SmoothStep(2.15f,2.8f,Math.Abs(x));
                float shift=(Shell(seam.Spring)-shell)*fade*radial;
                var moved=across*(MathF.Sign(x)*shift);at+=new Vector3(moved.X,0,moved.Y);
            }
            return at;
        }
        for(int i=0;i<p.Length;i++)
        {
            var at=p[i];var moved=Map(at);if(moved==at)continue;p[i]=moved;
            if(n.Length!=p.Length)continue;const float e=.001f;
            var jacobian=new Basis((Map(at+Vector3.Right*e)-Map(at-Vector3.Right*e))/(2*e),
                (Map(at+Vector3.Up*e)-Map(at-Vector3.Up*e))/(2*e),(Map(at+Vector3.Back*e)-Map(at-Vector3.Back*e))/(2*e));
            n[i]=(jacobian.Inverse().Transposed()*n[i]).Normalized();
        }
        arrays[(int)Mesh.ArrayType.Vertex]=p;if(n.Length==p.Length)arrays[(int)Mesh.ArrayType.Normal]=n;return true;
    }
}

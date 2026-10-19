using System;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Woven drying net for a quay rack. Actual cord geometry shares the rack's existing material kind.</summary>
public static class RuienNet
{
    public static ArrayMesh Make(Material material,float width=2.9f,float height=1.8f)
    {
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);st.SetMaterial(material);
        void Cord(Vector3 a,Vector3 b)
        {
            var t=(b-a).Normalized();var u=t.Cross(MathF.Abs(t.Y)>.9f?Vector3.Right:Vector3.Up).Normalized();var v=t.Cross(u);
            for(int k=0;k<6;k++)
            {
                float aa=k*MathF.Tau/6,bb=(k+1)*MathF.Tau/6;
                var n=u*MathF.Cos(aa)+v*MathF.Sin(aa);var m=u*MathF.Cos(bb)+v*MathF.Sin(bb);
                var p=a+n*.004f;var q=b+n*.004f;var r=b+m*.004f;var s=a+m*.004f;
                foreach(var (at,normal) in new[]{(p,n),(r,m),(q,n),(p,n),(s,m),(r,m)})
                {st.SetNormal(normal);st.SetColor(new Color(.19f,.135f,.07f));st.SetUV(new(at.X,at.Y));st.AddVertex(at);}
            }
        }
        Vector3 P(float x,float y,float side)
        {
            float hem=height*(.91f+.09f*MathF.Sin(x*2.1f+side));
            return new Vector3(x*width/2,-y*hem,side*.045f+.055f*MathF.Sin(x*7+y*3)*y+.006f*MathF.Sin(y*16*MathF.PI));
        }
        foreach(float side in new[]{-1f,1f})
        {
            for(int x=0;x<=24;x++)for(int y=0;y<16;y++)Cord(P(x/12f-1,y/16f,side),P(x/12f-1,(y+1)/16f,side));
            for(int y=0;y<=16;y++)for(int x=0;x<24;x++)Cord(P(x/12f-1,y/16f,side),P((x+1)/12f-1,y/16f,side));
        }
        var mesh=st.Commit();
        var header=BevelMesh.Box(new Vector3(width+.3f,.07f,.07f),.004f,material);
        var a=header.SurfaceGetArrays(0);var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        a[(int)Mesh.ArrayType.Vertex]=p.Select(v=>v+new Vector3(0,-.03f,0)).ToArray();
        a[(int)Mesh.ArrayType.Color]=p.Select(_=>new Color(.1f,.065f,.03f)).ToArray();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a);mesh.SurfaceSetMaterial(1,material);
        return mesh;
    }
}

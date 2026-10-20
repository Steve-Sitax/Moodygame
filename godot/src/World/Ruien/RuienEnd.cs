using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// A gallery stub closed by later brick infill, one reusable kit piece (areas.json channelEnds): a full-section
/// wall a little inside the stub's last ring, with an arched culvert at the channel carrying the water on through
/// iron bars into a short, dark brick-lined run. Replaces the export's flat dark end card.
/// </summary>
public static class RuienEnd
{
    public readonly record struct Spec(string Id,Vector3 At,Vector3 Axis,float Half,float Bottom,float Top,float Culvert,float Spring);

    public static List<Spec> Read(JsonElement area)
    {
        var list=new List<Spec>();
        if(!area.TryGetProperty("channelEnds",out var ends))return list;
        foreach(var e in ends.EnumerateArray())
        {
            var at=e.GetProperty("at");var ax=e.GetProperty("axis");
            list.Add(new Spec(e.GetProperty("id").GetString()!,new Vector3(at[0].GetSingle(),at[1].GetSingle(),at[2].GetSingle()),
                new Vector3(ax[0].GetSingle(),0,ax[2].GetSingle()).Normalized(),e.GetProperty("half").GetSingle(),
                e.GetProperty("bottom").GetSingle(),e.GetProperty("top").GetSingle(),e.GetProperty("culvert").GetSingle(),e.GetProperty("spring").GetSingle()));
        }
        return list;
    }

    /// <summary>Water continuing into the culvert run behind the bars (an outline at the area's water level).</summary>
    public static Vector2[] CulvertWater(Spec s)
    {
        var lat=Vector3.Up.Cross(s.Axis).Normalized();float w=s.Culvert/2-.02f;
        Vector2 P(float along,float side){var p=s.At+s.Axis*along+lat*side;return new Vector2(p.X,p.Z);}
        return new[]{P(-.02f,-w),P(-.02f,w),P(.9f,w),P(.9f,-w)};
    }

    public static Node3D Build(Spec s)
    {
        var root=new Node3D{Name="ruien_end_"+s.Id};
        var lat=Vector3.Up.Cross(s.Axis).Normalized();var face=-s.Axis;
        var brick=new SurfaceTool();brick.Begin(Mesh.PrimitiveType.Triangles);brick.SetCustomFormat(0,SurfaceTool.CustomFormat.Rgba8Unorm);
        var iron=new SurfaceTool();iron.Begin(Mesh.PrimitiveType.Triangles);
        Vector3 W(Vector2 q,float depth=0)=>s.At+lat*q.X+Vector3.Up*q.Y+s.Axis*depth;
        float r=s.Culvert/2;
        // Lime runs from the old crown joint and damp rising from the water: in the weather colour.
        Color Weather(Vector3 p)
        {
            float x=(p-s.At).Dot(lat);float streak=MathF.Pow(MathF.Max(0,MathF.Sin(x*7.1f+1.3f)*MathF.Sin(x*2.3f)),6);
            float high=Math.Clamp((p.Y-(s.Spring-.4f))/2.6f,0,1);
            float wet=Math.Clamp(1-(p.Y-(s.Spring-.3f))/1.2f,0,1);
            return new Color(.25f+.6f*wet,.55f*streak*high+.08f,.2f+.25f*high,.15f*wet);
        }
        void Tri(Vector3 a,Vector3 b,Vector3 c,Vector3 n,float ao)
        {
            if((b-a).Cross(c-a).Dot(n)>0)(b,c)=(c,b);
            foreach(var p in new[]{a,b,c}){brick.SetNormal(n);brick.SetUV(new Vector2(p.Dot(lat),p.Y));brick.SetColor(Weather(p));brick.SetCustom(0,new Color(0,0,0,ao));brick.AddVertex(p);}
        }
        // The arch outline of the culvert, from the left jamb foot over the crown to the right jamb foot.
        var arch=new List<Vector2>{new(-r,s.Bottom)};
        for(int i=0;i<=16;i++){float a=MathF.PI-i*MathF.PI/16;arch.Add(new Vector2(r*MathF.Cos(a),s.Spring+r*MathF.Sin(a)));}
        arch.Add(new Vector2(r,s.Bottom));
        var outline=new List<Vector2>{new(-s.Half,s.Bottom)};outline.AddRange(arch);
        outline.AddRange(new[]{new Vector2(s.Half,s.Bottom),new Vector2(s.Half,s.Top),new Vector2(-s.Half,s.Top)});
        var poly=outline.ToArray();var tri=Geometry2D.TriangulatePolygon(poly);
        for(int i=0;i<tri.Length;i+=3)Tri(W(poly[tri[i]]),W(poly[tri[i+1]]),W(poly[tri[i+2]]),face,.85f);
        // Reveal through the infill (36 cm), then the dark culvert run with a closed back.
        const float wall=.36f,run=.9f;
        for(int i=0;i+1<arch.Count;i++)
        {
            var q0=arch[i];var q1=arch[i+1];var mid=(q0+q1)/2;
            var inward=new Vector3(0,0,0)+lat*(-mid.X)+Vector3.Up*(s.Spring-mid.Y);
            if(q0.Y<=s.Spring&&q1.Y<=s.Spring)inward=lat*(-MathF.Sign(mid.X));
            var n=inward.Normalized();
            float[] stations={0,wall,wall+run*.5f,wall+run};
            for(int k=0;k+1<stations.Length;k++)
            {
                float d0=stations[k],d1=stations[k+1];
                float ao0=k==0?.8f:Mathf.Lerp(.5f,.05f,(d0-wall)/run),ao1=Mathf.Lerp(.5f,.05f,(d1-wall)/run);
                if(k==0)ao1=.5f;
                var a=W(q0,d0);var b=W(q1,d0);var c=W(q1,d1);var d=W(q0,d1);
                Tri(a,b,c,n,(ao0+ao1)/2);Tri(a,c,d,n,(ao0+ao1)/2);
            }
        }
        var backPoly=arch.ToArray();var backTri=Geometry2D.TriangulatePolygon(backPoly);
        for(int i=0;i<backTri.Length;i+=3)Tri(W(backPoly[backTri[i]],wall+run),W(backPoly[backTri[i+1]],wall+run),W(backPoly[backTri[i+2]],wall+run),face,.04f);
        // Wrought bars in the reveal, leaded into the arch and the sill below water; two flat ties.
        void Bar(Vector3 c,Vector3 size)=>iron.AppendFrom(BevelMesh.Box(size,.003f,RuienMaterials.Get("ruien_iron")),0,new Transform3D(new Basis(lat,Vector3.Up,s.Axis),c));
        for(int i=1;i<=5;i++)
        {
            float x=-r+i*s.Culvert/6;float topY=s.Spring+MathF.Sqrt(MathF.Max(0,r*r-x*x))+.03f;
            Bar(W(new Vector2(x,(topY+s.Bottom)/2),.12f),new Vector3(.03f,topY-s.Bottom,.03f));
        }
        foreach(float y in new[]{s.Spring-.05f,s.Spring-.85f})Bar(W(new Vector2(0,y),.09f),new Vector3(s.Culvert+.04f,.05f,.012f));
        RuienStair.Add(root,brick,"ruien_brick_header",true);
        RuienStair.Add(root,iron,"ruien_iron",true);
        return root;
    }
}

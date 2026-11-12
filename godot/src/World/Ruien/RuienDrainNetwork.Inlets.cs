using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienDrainNetwork
{
    private static Vector3[] InletPath(Inlet inlet)
    {
        float shallow=Math.Min(-.55f,inlet.From.Y-.23f),radius=inlet.Diameter/2;
        var horizontal=new Vector2(inlet.From.X-inlet.To.X,inlet.From.Z-inlet.To.Z).Length();
        if(horizontal<radius*4)return new[]{inlet.From,inlet.To};
        var middle=inlet.Via is {Length:>2}?inlet.Via.Skip(1).SkipLast(1).Select(p=>new Vector3(p.X,shallow,p.Y)):Array.Empty<Vector3>();
        var raw=new[]{inlet.From,new Vector3(inlet.From.X,shallow,inlet.From.Z)}.Concat(middle)
            .Concat(new[]{new Vector3(inlet.To.X,shallow,inlet.To.Z),inlet.To}).ToArray();
        var points=raw.Where((p,i)=>i==0||p.DistanceTo(raw[i-1])>.001f).ToArray();
        var result=new List<Vector3>{points[0]};
        for(int i=1;i+1<points.Length;i++)
        {
            var a=points[i-1];var b=points[i];var c=points[i+1];var incoming=(b-a).Normalized();var outgoing=(c-b).Normalized();
            float angle=MathF.Acos(Math.Clamp(incoming.Dot(outgoing),-1,1));if(angle<.001f){result.Add(b);continue;}
            float halfTurn=MathF.Tan(angle/2);
            float r=Math.Min(inlet.Diameter*1.5f,Math.Min(a.DistanceTo(b),b.DistanceTo(c))*.4f/halfTurn),cut=r*halfTurn;
            if(r<radius*1.15f)throw new InvalidOperationException("Inlet elbow folds inside its bore: "+inlet.Id);
            var start=b-incoming*cut;var normal=(outgoing-incoming*MathF.Cos(angle)).Normalized();var centre=start+normal*r;
            var axis=incoming.Cross(outgoing).Normalized();var delta=start-centre;int count=Math.Max(2,(int)MathF.Ceiling(angle/Mathf.DegToRad(7.5f)));
            for(int k=0;k<=count;k++){float t=angle*k/count;result.Add(centre+delta*MathF.Cos(t)+axis.Cross(delta)*MathF.Sin(t));}
        }
        result.Add(points[^1]);return result.Where((p,i)=>i==0||p.DistanceTo(result[i-1])>.0001f).ToArray();
    }
    private static ArrayMesh InletMesh(Inlet inlet)
    {
        var original=InletPath(inlet);var first=(original[1]-original[0]).Normalized();var last=(original[^1]-original[^2]).Normalized();
        const float lip=.0015f;var path=original.Take(1).Concat(new[]{original[0]+first*lip}).Concat(original.Skip(1).SkipLast(1))
            .Concat(new[]{original[^1]-last*lip,original[^1]}).ToArray();
        var horizontal=new Vector3(inlet.To.X-inlet.From.X,0,inlet.To.Z-inlet.From.Z);
        var initial=horizontal.LengthSquared()>.0001f?Vector3.Up.Cross(horizontal).Normalized():Vector3.Right;
        Vector3 Across(Vector3 tangent,Vector3 previous)
        {
            var projected=previous-tangent*previous.Dot(tangent);
            return projected.LengthSquared()>.000001f?projected.Normalized():tangent.Cross(MathF.Abs(tangent.Y)>.9f?Vector3.Right:Vector3.Up).Normalized();
        }
        float radius=inlet.Diameter/2,inner=Math.Max(.01f,radius-.008f);const int n=20;var g=new Geometry();var length=new float[path.Length];
        for(int i=1;i<path.Length;i++)length[i]=length[i-1]+path[i].DistanceTo(path[i-1]);
        foreach(bool inside in new[]{false,true})
        {
            int start=g.P.Count;
            var x=initial;
            for(int row=0;row<path.Length;row++)
            {
                var tangent=(path[Math.Min(path.Length-1,row+1)]-path[Math.Max(0,row-1)]).Normalized();x=Across(tangent,x);var y=tangent.Cross(x).Normalized();
                float r=inside?inner:radius;if(row==0||row==path.Length-1)r+=inside?lip:-lip;
                for(int i=0;i<=n;i++)
                {
                    float angle=Mathf.Tau*i/n;var normal=x*MathF.Cos(angle)+y*MathF.Sin(angle);
                    g.Vertex(path[row]+normal*r,normal*(inside?-1:1),new Vector2(angle*radius,length[row])/.9f,
                        new Color(.45f+.05f*MathF.Sin(length[row]*1.7f),.08f,.24f,.08f));
                }
            }
            for(int row=0;row+1<path.Length;row++)for(int i=0;i<n;i++)
            {
                int a=start+row*(n+1)+i,b=a+n+1;g.Triangle(a,b,b+1,g.N[a]);g.Triangle(a,b+1,a+1,g.N[a]);
            }
        }
        int perWall=path.Length*(n+1);
        foreach(int row in new[]{0,path.Length-1})for(int i=0;i<n;i++)
        {
            int a=row*(n+1)+i,b=a+perWall;var want=row==0?-first:last;
            g.Triangle(a,a+1,b+1,want);g.Triangle(a,b+1,b,want);
        }
        // Cast sockets lie on the straight runs, away from the elbow sweeps.
        for(int k=0;k+1<original.Length;k++)
        {
            var a=original[k];var b=original[k+1];float span=a.DistanceTo(b);if(span<1.1f)continue;
            var tangent=(b-a).Normalized();var x=Across(tangent,initial);var y=tangent.Cross(x).Normalized();
            for(float u=.38f;u<span-.2f;u+=1.8f)
            {
                var centre=a+tangent*u;var section=new[]{new Vector2(-.065f,radius),new Vector2(-.06f,radius+.006f),new Vector2(-.05f,radius+.012f),
                    new Vector2(.045f,radius+.012f),new Vector2(.06f,radius+.004f),new Vector2(.065f,radius)};int start=g.P.Count;
                for(int j=0;j<section.Length;j++)for(int i=0;i<=n;i++)
                {
                    float angle=Mathf.Tau*i/n;var radial=x*MathF.Cos(angle)+y*MathF.Sin(angle);
                    var slope=section[Math.Min(section.Length-1,j+1)]-section[Math.Max(0,j-1)];var normal=(radial*slope.X-tangent*slope.Y).Normalized();
                    g.Vertex(centre+tangent*section[j].X+radial*section[j].Y,normal,new Vector2(angle*radius,u+section[j].X)/.9f,new Color(.5f,.08f,.28f,.08f));
                }
                for(int j=0;j+1<section.Length;j++)for(int i=0;i<n;i++)
                {int q=start+j*(n+1)+i,z=q+n+1;g.Triangle(q,z,z+1,g.N[q]);g.Triangle(q,z+1,q+1,g.N[q]);}
            }
        }
        using var arrays=g.Arrays();var mesh=new ArrayMesh{ResourceName="gully_"+inlet.Id};mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetName(0,"ruien_iron");return mesh;
    }
}

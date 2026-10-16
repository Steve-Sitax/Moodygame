using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Models;

/// <summary>
/// Boxes with a real chamfer on every edge and corner (AGENTS.md model edges): six inset faces, twelve chamfer strips
/// and eight clipped corners. Shared by the furniture intake and the small runtime props (ladders, books).
/// </summary>
public static class BevelMesh
{
    private static readonly Dictionary<(Vector3 Size, float Bevel, Material Material), ArrayMesh> made = new();
    /// <summary>The same box again for the same size, bevel and material: one mesh shared by every copy.</summary>
    public static ArrayMesh Shared(Vector3 size, float bevel, Material material)
    {
        var key = (size, bevel, material);
        if (!made.TryGetValue(key, out var mesh)) made[key] = mesh = Box(size, bevel, material);
        return mesh;
    }
    public static ArrayMesh Box(Vector3 size, float bevel, Material material)
    {
        var h=size*.5f;float b=Math.Min(bevel,Math.Min(h.X,Math.Min(h.Y,h.Z))*.4f);
        var planes=new List<(Vector3 n,float d)>();for(int axis=0;axis<3;axis++)foreach(int sign in new[]{-1,1}){var n=Vector3.Zero;n[axis]=sign;planes.Add((n,h[axis]));}
        for(int a=0;a<3;a++)for(int c=a+1;c<3;c++)foreach(int sa in new[]{-1,1})foreach(int sc in new[]{-1,1}){var n=Vector3.Zero;n[a]=sa;n[c]=sc;planes.Add((n,h[a]+h[c]-b));}
        foreach(int x in new[]{-1,1})foreach(int y in new[]{-1,1})foreach(int z in new[]{-1,1})planes.Add((new(x,y,z),h.X+h.Y+h.Z-2*b));
        var points=new List<Vector3>();for(int a=0;a<planes.Count;a++)for(int c=a+1;c<planes.Count;c++)for(int d=c+1;d<planes.Count;d++)
        {var p=planes[a];var q=planes[c];var r=planes[d];float det=p.n.Dot(q.n.Cross(r.n));if(Math.Abs(det)<.0001f)continue;var v=(q.n.Cross(r.n)*p.d+r.n.Cross(p.n)*q.d+p.n.Cross(q.n)*r.d)/det;if(planes.All(f=>f.n.Dot(v)<=f.d+.00001f)&&!points.Any(t=>t.DistanceSquaredTo(v)<1e-10f))points.Add(v);}
        var tool=new SurfaceTool();tool.Begin(Mesh.PrimitiveType.Triangles);tool.SetMaterial(material);
        foreach(var plane in planes)
        {var n=plane.n.Normalized();var poly=points.Where(v=>Math.Abs(plane.n.Dot(v)-plane.d)<.00002f).ToArray();if(poly.Length<3)continue;var centre=poly.Aggregate(Vector3.Zero,(a,v)=>a+v)/poly.Length;var u=n.Cross(Math.Abs(n.Y)<.8f?Vector3.Up:Vector3.Right).Normalized();var v=n.Cross(u);poly=poly.OrderBy(p=>Math.Atan2((p-centre).Dot(v),(p-centre).Dot(u))).ToArray();for(int i=1;i<poly.Length-1;i++)foreach(var p in new[]{poly[0],poly[i+1],poly[i]}){tool.SetNormal(n);tool.SetUV(new(p.Dot(u),p.Dot(v)));tool.AddVertex(p);}}
        return tool.Commit();
    }
}

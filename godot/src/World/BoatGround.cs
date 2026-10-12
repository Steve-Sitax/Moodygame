using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>The drawn mud and hull undersides, sampled once for grounding at any tide.</summary>
public static class BoatGround
{
    private const float Cell = 0.25f;
    private static readonly Dictionary<(int, int), float> mud = new();
    private static readonly Dictionary<string, Vector3[]> bottoms = new();
    private static readonly Dictionary<(string, float, float, float), float> floors = new();
    private static (int, int) Key(float x, float z) => ((int)MathF.Floor(x / Cell), (int)MathF.Floor(z / Cell));

    public static void ReadMud(Node root)
    {
        mud.Clear(); floors.Clear();
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not MeshInstance3D { Mesh: not null } mi || !mi.Name.ToString().StartsWith("tide_mud")) continue;
            // Keep older bakes usable until integration: the lock is a dredged
            // chamber, and the brig's declared grounding berth has a real bed.
            bool hasBerth = false;
            var corrected = new ArrayMesh();
            for (int surface = 0; surface < mi.Mesh.GetSurfaceCount(); surface++)
            {
                var arrays = mi.Mesh.SurfaceGetArrays(surface);
                var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var indices = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                foreach(var v in vertices)
                {
                    var p=mi.GlobalTransform*v;
                    if(MathF.Abs(p.Y+7.4f)<0.005f && p.X>=-60.01f && p.X<=-19.99f && p.Z>=-11.71f && p.Z<=-2.99f) hasBerth=true;
                }
                var keep = new List<int>();
                int triangleCount = indices.Length > 0 ? indices.Length : vertices.Length;
                for (int i=0; i+2<triangleCount; i+=3)
                {
                    int a=indices.Length>0?indices[i]:i, b=indices.Length>0?indices[i+1]:i+1, c=indices.Length>0?indices[i+2]:i+2;
                    var mid=mi.GlobalTransform*((vertices[a]+vertices[b]+vertices[c])/3);
                    if(Tide.RegionAt(mid.X,mid.Z)==2) continue;
                    keep.Add(a);keep.Add(b);keep.Add(c);
                }
                if(keep.Count==0) continue;
                arrays[(int)Mesh.ArrayType.Index]=keep.ToArray();
                corrected.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
                corrected.SurfaceSetMaterial(corrected.GetSurfaceCount()-1,mi.Mesh.SurfaceGetMaterial(surface));
            }
            if (!hasBerth)
            {
                var berth = new Godot.Collections.Array(); berth.Resize((int)Mesh.ArrayType.Max);
                var inv=mi.GlobalTransform.AffineInverse();
                berth[(int)Mesh.ArrayType.Vertex]=new[]{inv*new Vector3(-60,-7.4f,-11.7f),inv*new Vector3(-20,-7.4f,-11.7f),inv*new Vector3(-20,-7.4f,-3),inv*new Vector3(-60,-7.4f,-3)};
                berth[(int)Mesh.ArrayType.Normal]=new[]{Vector3.Up,Vector3.Up,Vector3.Up,Vector3.Up};
                berth[(int)Mesh.ArrayType.TexUV]=new[]{new Vector2(-15,-2.925f),new Vector2(-5,-2.925f),new Vector2(-5,-0.75f),new Vector2(-15,-0.75f)};
                berth[(int)Mesh.ArrayType.Color]=new[]{new Color(.75f,.7275f,.69f),new Color(.75f,.7275f,.69f),new Color(.75f,.7275f,.69f),new Color(.75f,.7275f,.69f)};
                berth[(int)Mesh.ArrayType.Index]=new[]{0,2,1,0,3,2};
                corrected.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,berth);
                corrected.SurfaceSetMaterial(corrected.GetSurfaceCount()-1,mi.Mesh.SurfaceGetMaterial(0));
            }
            mi.Mesh=corrected;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var arr = mi.Mesh.SurfaceGetArrays(s);
                var pts = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var idx = arr[(int)Mesh.ArrayType.Index].AsInt32Array();
                int count = idx.Length > 0 ? idx.Length : pts.Length;
                for (int k = 0; k + 2 < count; k += 3)
                {
                    var a = mi.GlobalTransform * pts[idx.Length > 0 ? idx[k] : k];
                    var b = mi.GlobalTransform * pts[idx.Length > 0 ? idx[k + 1] : k + 1];
                    var c = mi.GlobalTransform * pts[idx.Length > 0 ? idx[k + 2] : k + 2];
                    float d = (b.Z-c.Z)*(a.X-c.X)+(c.X-b.X)*(a.Z-c.Z);
                    if (MathF.Abs(d) < 1e-9f) continue;
                    for (int x=(int)MathF.Floor(MathF.Min(a.X,MathF.Min(b.X,c.X))/Cell); x<=(int)MathF.Floor(MathF.Max(a.X,MathF.Max(b.X,c.X))/Cell); x++)
                        for (int z=(int)MathF.Floor(MathF.Min(a.Z,MathF.Min(b.Z,c.Z))/Cell); z<=(int)MathF.Floor(MathF.Max(a.Z,MathF.Max(b.Z,c.Z))/Cell); z++)
                        {
                            float px=(x+0.5f)*Cell, pz=(z+0.5f)*Cell;
                            float u=((b.Z-c.Z)*(px-c.X)+(c.X-b.X)*(pz-c.Z))/d;
                            float v=((c.Z-a.Z)*(px-c.X)+(a.X-c.X)*(pz-c.Z))/d;
                            if(u < -1e-4f || v < -1e-4f || 1-u-v < -1e-4f) continue;
                            float y=u*a.Y+v*b.Y+(1-u-v)*c.Y;
                            mud[(x,z)]=MathF.Max(mud.GetValueOrDefault((x,z),float.NegativeInfinity),y);
                        }
                }
            }
        }
    }

    public static void Register(string kind, IEnumerable<(Mesh Mesh, Transform3D Frame)> meshes)
    {
        if (bottoms.ContainsKey(kind)) return;
        var cells = new Dictionary<(int, int), Vector3>();
        foreach (var (mesh, frame) in meshes)
            for (int s=0; s<mesh.GetSurfaceCount(); s++)
            {
                if (mesh.SurfaceGetMaterial(s)?.ResourceName == "cap") continue;
                foreach (var v in mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                {
                    var p=frame*v;
                    if(p.Y>0) continue;
                    var key=((int)MathF.Round(p.X*10),(int)MathF.Round(p.Z*10));
                    if(!cells.TryGetValue(key,out var old)||p.Y<old.Y) cells[key]=p;
                }
            }
        bottoms[kind]=new List<Vector3>(cells.Values).ToArray();
        floors.Clear();
    }

    public static float Floor(string kind, float x, float z, float yaw)
    {
        var key=(kind,x,z,yaw);
        if(floors.TryGetValue(key,out float found)) return found;
        float floor=float.NegativeInfinity, c=MathF.Cos(yaw), s=MathF.Sin(yaw);
        if(bottoms.TryGetValue(kind,out var pts))
            foreach(var p in pts)
                if(mud.TryGetValue(Key(x+p.X*c+p.Z*s,z-p.X*s+p.Z*c),out float y)) floor=MathF.Max(floor,y-p.Y);
        if(float.IsFinite(floor)) floor+=0.01f;
        if(floors.Count>=1024) { using var it=floors.Keys.GetEnumerator(); if(it.MoveNext()) floors.Remove(it.Current); }
        return floors[key]=floor;
    }
}

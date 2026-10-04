using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>Foot floors measured from the public model at load, with headroom and a body margin.</summary>
public sealed class MeshDeck
{
    private readonly record struct Tri(Vector3 A,Vector3 B,Vector3 C);
    public readonly float MinX,MinZ,Cell;
    public readonly int Nx,Nz;
    private readonly float[] heights;
    private MeshDeck(float minX,float maxX,float minZ,float maxZ,float height,float[][] obstacles,float cell)
    {
        MinX=minX;MinZ=minZ;Cell=cell;Nx=(int)MathF.Ceiling((maxX-minX)/cell)+1;Nz=(int)MathF.Ceiling((maxZ-minZ)/cell)+1;heights=new float[Nx*Nz];
        for(int z=0;z<Nz;z++)for(int x=0;x<Nx;x++){float px=minX+x*cell,pz=minZ+z*cell;bool blocked=false;foreach(var r in obstacles)if(px>=r[0]&&px<=r[1]&&pz>=r[2]&&pz<=r[3]){blocked=true;break;}heights[z*Nx+x]=blocked?float.NegativeInfinity:height;}
    }
    public static MeshDeck Flat(float minX,float maxX,float minZ,float maxZ,float height,float[][] obstacles,float cell=.2f)=>new(minX,maxX,minZ,maxZ,height,obstacles,cell);
    public MeshDeck(Node3D model,float minX,float maxX,float minZ,float maxZ,float minimum,float cell=.2f)
    {
        MinX=minX;MinZ=minZ;Cell=cell;Nx=(int)MathF.Ceiling((maxX-minX)/cell)+1;Nz=(int)MathF.Ceiling((maxZ-minZ)/cell)+1;heights=new float[Nx*Nz];Array.Fill(heights,float.NegativeInfinity);
        var cells=new Dictionary<long,List<Tri>>();
        static long Key(int x,int z)=>((long)x<<32)^(uint)z;
        void Scan(Node n,Transform3D xf,bool first=false)
        {
            if(n.Name.ToString().Contains("rigging")||n.Name.ToString().EndsWith("_cap"))return;
            if(n is Node3D n3&&!first)xf*=n3.Transform;
            if(n is MeshInstance3D{Mesh:not null} m)
            {var faces=m.Mesh.GetFaces();for(int i=0;i+2<faces.Length;i+=3)
            {var t=new Tri(xf*faces[i],xf*faces[i+1],xf*faces[i+2]);var normal=(t.B-t.A).Cross(t.C-t.A).Normalized();if(Math.Abs(normal.Y)<.2f)continue;
                int x0=(int)MathF.Floor(Math.Min(t.A.X,Math.Min(t.B.X,t.C.X))*2),x1=(int)MathF.Floor(Math.Max(t.A.X,Math.Max(t.B.X,t.C.X))*2),z0=(int)MathF.Floor(Math.Min(t.A.Z,Math.Min(t.B.Z,t.C.Z))*2),z1=(int)MathF.Floor(Math.Max(t.A.Z,Math.Max(t.B.Z,t.C.Z))*2);
                for(int x=x0;x<=x1;x++)for(int z=z0;z<=z1;z++){long k=Key(x,z);if(!cells.TryGetValue(k,out var list))cells[k]=list=new();list.Add(t);}
            }}
            foreach(var child in n.GetChildren())Scan(child,xf);
        }
        Scan(model,Transform3D.Identity,true);
        var hits=new List<float>();
        for(int z=0;z<Nz;z++)for(int x=0;x<Nx;x++)
        {
            float px=MinX+x*cell,pz=MinZ+z*cell;hits.Clear();if(!cells.TryGetValue(Key((int)MathF.Floor(px*2),(int)MathF.Floor(pz*2)),out var triangles))continue;
            foreach(var t in triangles)
            {float den=(t.B.Z-t.C.Z)*(t.A.X-t.C.X)+(t.C.X-t.B.X)*(t.A.Z-t.C.Z);if(Math.Abs(den)<.000001f)continue;float a=((t.B.Z-t.C.Z)*(px-t.C.X)+(t.C.X-t.B.X)*(pz-t.C.Z))/den,b=((t.C.Z-t.A.Z)*(px-t.C.X)+(t.A.X-t.C.X)*(pz-t.C.Z))/den;if(a<-.0001f||b<-.0001f||a+b>1.0001f)continue;float y=a*t.A.Y+b*t.B.Y+(1-a-b)*t.C.Y;if(y>minimum)hits.Add(y);}
            float floor=float.PositiveInfinity;foreach(float y in hits)floor=Math.Min(floor,y);if(!float.IsFinite(floor))continue;bool blocked=false;foreach(float y in hits)if(y>floor+.25f&&y<floor+1.9f){blocked=true;break;}if(!blocked)heights[z*Nx+x]=floor;
        }
        // A rail/bench top is not another floor: only the low deck in each transverse row counts.
        for(int z=0;z<Nz;z++){float low=float.PositiveInfinity;for(int x=0;x<Nx;x++)if(float.IsFinite(heights[z*Nx+x]))low=Math.Min(low,heights[z*Nx+x]);for(int x=0;x<Nx;x++)if(heights[z*Nx+x]>low+.12f)heights[z*Nx+x]=float.NegativeInfinity;}
    }
    public float Floor(float x,float z)
    {int ix=(int)MathF.Round((x-MinX)/Cell),iz=(int)MathF.Round((z-MinZ)/Cell);return ix>=0&&ix<Nx&&iz>=0&&iz<Nz?heights[iz*Nx+ix]:float.NegativeInfinity;}
    public bool Stand(float x,float z,float margin=.18f)=>float.IsFinite(Floor(x,z))&&float.IsFinite(Floor(x+margin,z))&&float.IsFinite(Floor(x-margin,z))&&float.IsFinite(Floor(x,z+margin))&&float.IsFinite(Floor(x,z-margin));
    public Vector2 Walk(Vector2 from,Vector2 to)
    {if(Stand(to.X,to.Y))return to;if(Stand(to.X,from.Y))return new(to.X,from.Y);if(Stand(from.X,to.Y))return new(from.X,to.Y);return from;}
    public Vector2 Nearest(Vector2 p)
    {float distance=float.PositiveInfinity;Vector2 best=p;for(int z=0;z<Nz;z++)for(int x=0;x<Nx;x++){var v=new Vector2(MinX+x*Cell,MinZ+z*Cell);if(Stand(v.X,v.Y)&&v.DistanceSquaredTo(p)<distance){distance=v.DistanceSquaredTo(p);best=v;}}return best;}
    public List<Vector2> Path(Vector2 start,Vector2 end)
    {
        start=Nearest(start);end=Nearest(end);int Index(Vector2 p)=>(int)MathF.Round((p.Y-MinZ)/Cell)*Nx+(int)MathF.Round((p.X-MinX)/Cell);Vector2 At(int i)=>new(MinX+(i%Nx)*Cell,MinZ+(i/Nx)*Cell);
        int first=Index(start),last=Index(end);var parent=new int[Nx*Nz];Array.Fill(parent,-1);parent[first]=first;var queue=new Queue<int>();queue.Enqueue(first);
        int[] steps={-1,1,-Nx,Nx};while(queue.Count>0&&parent[last]<0){int at=queue.Dequeue();foreach(int step in steps){int next=at+step;if(next<0||next>=parent.Length||parent[next]>=0||Math.Abs(next%Nx-at%Nx)>1)continue;var p=At(next);if(!Stand(p.X,p.Y))continue;parent[next]=at;queue.Enqueue(next);}}
        var result=new List<Vector2>();if(parent[last]<0)return result;for(int i=last;i!=first;i=parent[i])result.Add(At(i));result.Add(start);result.Reverse();
        for(int i=result.Count-2;i>0;i--)if((result[i]-result[i-1]).Normalized().DistanceTo((result[i+1]-result[i]).Normalized())<.01f)result.RemoveAt(i);return result;
    }
    public void ConnectedTo(Vector2 seed)
    {
        seed=Nearest(seed);int first=(int)MathF.Round((seed.Y-MinZ)/Cell)*Nx+(int)MathF.Round((seed.X-MinX)/Cell);var seen=new bool[Nx*Nz];var keep=new bool[Nx*Nz];var queue=new Queue<int>();queue.Enqueue(first);seen[first]=true;int[] steps={-1,1,-Nx,Nx};
        while(queue.Count>0){int at=queue.Dequeue();foreach(int step in steps){int next=at+step;if(next<0||next>=seen.Length||seen[next]||Math.Abs(next%Nx-at%Nx)>1)continue;if(!Stand(MinX+(next%Nx)*Cell,MinZ+(next/Nx)*Cell))continue;seen[next]=true;queue.Enqueue(next);}}
        // Keep the neighbouring floor samples a standing body's margin reads too.
        for(int i=0;i<seen.Length;i++)if(seen[i])for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++){int x=i%Nx+dx,z=i/Nx+dz;if(x>=0&&x<Nx&&z>=0&&z<Nz)keep[z*Nx+x]=true;}
        for(int i=0;i<keep.Length;i++)if(!keep[i])heights[i]=float.NegativeInfinity;
    }
}

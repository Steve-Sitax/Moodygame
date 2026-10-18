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
    private float[] heights;
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
            if(n.Name.ToString().Contains("rigging")||n.Name.ToString().EndsWith("_cap")||n.Name.ToString().EndsWith("_far")||n.Name.ToString().EndsWith("_block"))return;
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
    /// <summary>A small hull's floors (issue 155): her bottom boards and, where they cross, her thwarts and stern sheets, each
    /// at its own height, read from the drawn model so the feet stand where the eye sees wood. A cell's floor is its lowest
    /// flat wooden top under the sheer with headroom over it (a hood, a tarp, a thwart over the boards); canvas, water in
    /// the bilge, nets and lettering are never a floor. The cap and the oars laid in are not read.</summary>
    public static MeshDeck Hull(Node3D model,float minX,float maxX,float minZ,float maxZ,float keel,float sheer,float cell=.1f)=>new(model,minX,maxX,minZ,maxZ,keel,sheer,cell);
    private static readonly HashSet<string> NoFloor=new(){"canvas","canvas_tan","hood","tarp","flag","washing","rigging","shrouds","netting","names","names2","names3","names4","bilge","window","glass","rope"};
    private static readonly HashSet<string> NoRoof=new(){"flag","washing","rigging","shrouds","names","names2","names3","names4","bilge","window","glass","rope"};
    private MeshDeck(Node3D model,float minX,float maxX,float minZ,float maxZ,float keel,float sheer,float cell)
    {
        const float bottom=-8;
        MinX=minX;MinZ=minZ;Cell=cell;MaxStep=.36f;Small=sheer<100;Nx=(int)MathF.Ceiling((maxX-minX)/cell)+1;Nz=(int)MathF.Ceiling((maxZ-minZ)/cell)+1;heights=new float[Nx*Nz];Array.Fill(heights,float.NegativeInfinity);
        var cells=new Dictionary<long,List<(Tri T,bool Floor,bool Roof,bool Up,bool Cloth)>>();
        static long Key(int x,int z)=>((long)x<<32)^(uint)z;
        void Scan(Node n,Transform3D xf,bool first=false)
        {
            string name=n.Name.ToString();
            if(name.Contains("rigging")||name.EndsWith("_cap")||name.EndsWith("_far")||name.EndsWith("_block")||name.EndsWith("_stow")||name.Contains("_name_"))return;
            if(n is Node3D n3&&!first)xf*=n3.Transform;
            if(n is MeshInstance3D{Mesh:not null} m)
                for(int s=0;s<m.Mesh.GetSurfaceCount();s++)
                {
                    string mat=(m.GetSurfaceOverrideMaterial(s)??m.Mesh.SurfaceGetMaterial(s))?.ResourceName??"";bool floor=!NoFloor.Contains(mat),roof=!NoRoof.Contains(mat),cloth=mat is "canvas" or "canvas_tan" or "hood" or "tarp";if(!floor&&!roof)continue;
                    var arrays=m.Mesh.SurfaceGetArrays(s);var v=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var index=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?null:arrays[(int)Mesh.ArrayType.Index].AsInt32Array();int count=index?.Length??v.Length;
                    for(int i=0;i+2<count;i+=3)
                    {
                        var t=new Tri(xf*v[index?[i]??i],xf*v[index?[i+1]??i+1],xf*v[index?[i+2]??i+2]);var normal=(t.B-t.A).Cross(t.C-t.A);if(normal.LengthSquared()<1e-12f)continue;normal=normal.Normalized();
                        // (two-sided: the winding does not say which side is up)
                        bool up=Math.Abs(normal.Y)>=.6f;if(!up&&!roof)continue;
                        int x0=(int)MathF.Floor(Math.Min(t.A.X,Math.Min(t.B.X,t.C.X))*4),x1=(int)MathF.Floor(Math.Max(t.A.X,Math.Max(t.B.X,t.C.X))*4),z0=(int)MathF.Floor(Math.Min(t.A.Z,Math.Min(t.B.Z,t.C.Z))*4),z1=(int)MathF.Floor(Math.Max(t.A.Z,Math.Max(t.B.Z,t.C.Z))*4);
                        for(int x=x0;x<=x1;x++)for(int z=z0;z<=z1;z++){long k=Key(x,z);if(!cells.TryGetValue(k,out var list))cells[k]=list=new();list.Add((t,floor,roof,up,cloth));}
                    }
                }
            foreach(var child in n.GetChildren())Scan(child,xf);
        }
        Scan(model,Transform3D.Identity,true);
        var floors=new List<float>();var roofs=new List<float>();var hard=new List<float>();var covered=new bool[Nx*Nz];
        for(int z=0;z<Nz;z++)for(int x=0;x<Nx;x++)
        {
            float px=MinX+x*cell,pz=MinZ+z*cell;floors.Clear();roofs.Clear();hard.Clear();if(!cells.TryGetValue(Key((int)MathF.Floor(px*4),(int)MathF.Floor(pz*4)),out var triangles))continue;
            foreach(var (t,floor,roof,up,cloth) in triangles)
            {
                float den=(t.B.Z-t.C.Z)*(t.A.X-t.C.X)+(t.C.X-t.B.X)*(t.A.Z-t.C.Z);if(Math.Abs(den)<.000001f)continue;float a=((t.B.Z-t.C.Z)*(px-t.C.X)+(t.C.X-t.B.X)*(pz-t.C.Z))/den,b=((t.C.Z-t.A.Z)*(px-t.C.X)+(t.A.X-t.C.X)*(pz-t.C.Z))/den;if(a<-.0001f||b<-.0001f||a+b>1.0001f)continue;
                float y=a*t.A.Y+b*t.B.Y+(1-a-b)*t.C.Y;if(y<bottom)continue;if(y<keel+(Small?2.4f:6f))covered[z*Nx+x]=true;if(roof){roofs.Add(y);if(!cloth)hard.Add(y);}if(floor&&up&&y<=sheer)floors.Add(y);
            }
            // under her deck line only where it is open to the sky and shallow (an open lighter's hold, a cockpit): never the
            // hull's own bottom under a hold's floor, the bilge under a closed deck, nor a ship's deep hold under an open hatch
            floors.Sort();float best=float.NegativeInfinity;
            for(int i=floors.Count-1;i>=0;i--){float h=floors[i];if(h>=keel)continue;if(h<keel-2){floors.RemoveAt(i);continue;}foreach(float r in hard)if(r>h+.12f){floors.RemoveAt(i);break;}}
            // the lowest top with nothing over it from a step above the feet to a crouching head (a thwart's own underside
            // lies under its top, the boards under a thwart have the thwart over them)
            for(int i=0;i<floors.Count&&!float.IsFinite(best);i++){float h=floors[i];bool free=true;foreach(float r in roofs)if(r>h+.12f&&r<h+1.3f){free=false;break;}if(free)best=h;}
            // covered over all round (a hood, a tarp over the boards): the highest top all the same, so nothing that is drawn lets a foot through
            if(!float.IsFinite(best)&&floors.Count>0)best=floors[^1];
            heights[z*Nx+x]=best;
        }
        // inside her sides, where the planking rounds up too steep to be a floor, and over a ship's open hatch: the floor beside
        // it goes on, so a foot that comes down there stands, and never drops into the water in the hull or down her hold
        for(int pass=0;pass<(Small?3:10);pass++)
        {
            var next=(float[])heights.Clone();
            for(int z=0;z<Nz;z++)for(int x=0;x<Nx;x++)
            {
                int i=z*Nx+x;if(float.IsFinite(heights[i])||!covered[i])continue;float low=float.PositiveInfinity;
                for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=Nx||nz>=Nz)continue;float h=heights[nz*Nx+nx];if(float.IsFinite(h))low=Math.Min(low,h);}
                if(float.IsFinite(low))next[i]=low;
            }
            heights=next;
        }
    }
    /// <summary>The most the feet go up from one cell to the next while walking on her (a thwart off the bottom boards is a
    /// step up only when it is low enough; higher, it is climbed with a jump). Infinite for the flat decks.</summary>
    public readonly float MaxStep=float.PositiveInfinity;
    /// <summary>A small boat's bottom boards and thwarts (made under her sheer), not a ship's deck.</summary>
    public readonly bool Small;
    public float Floor(float x,float z)
    {int ix=(int)MathF.Round((x-MinX)/Cell),iz=(int)MathF.Round((z-MinZ)/Cell);return ix>=0&&ix<Nx&&iz>=0&&iz<Nz?heights[iz*Nx+ix]:float.NegativeInfinity;}
    public bool Stand(float x,float z,float margin=.18f)=>float.IsFinite(Floor(x,z))&&float.IsFinite(Floor(x+margin,z))&&float.IsFinite(Floor(x-margin,z))&&float.IsFinite(Floor(x,z+margin))&&float.IsFinite(Floor(x,z-margin));
    private bool StepTo(Vector2 from,float fx,float fz)=>Stand(fx,fz)&&Floor(fx,fz)<=Floor(from.X,from.Y)+MaxStep;
    public Vector2 Walk(Vector2 from,Vector2 to)
    {if(StepTo(from,to.X,to.Y))return to;if(StepTo(from,to.X,from.Y))return new(to.X,from.Y);if(StepTo(from,from.X,to.Y))return new(from.X,to.Y);return from;}
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

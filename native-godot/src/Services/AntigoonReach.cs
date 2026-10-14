using System;
using System.Collections.Generic;
using System.IO;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Services;

/// <summary>
/// Antigoon's reachability map: every half-metre spot of the town where the giant fits, grouped into street areas he
/// can walk through without squeezing under an arch or through a gate. Built once per world content and kept on disk.
/// He lives in one area; every spot he cannot walk to from there is a safe place.
/// </summary>
public sealed class AntigoonReach
{
    public const double Cell=.5;
    // Bump when the giant's clearance or area rules change, so an old map is rebuilt.
    public const int Version=2;
    // An area worth roaming: at least this many square metres, lit by town lamps, not open land at the map's edge.
    public const double MinArea=1500;
    public const int MinLamps=3;
    public readonly int X0,Z0,W,D;
    private readonly ushort[] areas;
    public int Count { get; }
    public int Areas { get; }
    private AntigoonReach(int x0,int z0,int w,int d,ushort[] areas)
    {
        X0=x0;Z0=z0;W=w;D=d;this.areas=areas;var seen=new HashSet<ushort>();
        foreach(ushort a in areas)if(a!=0){Count++;seen.Add(a);}
        Areas=seen.Count;
    }
    private (int,int) CellOf(P p)=>((int)Math.Round(p.X/Cell)-X0,(int)Math.Round(p.Z/Cell)-Z0);
    private int AreaAt(int i,int k)=>i<0||k<0||i>=W||k>=D?0:areas[k*W+i];
    public P At(int i,int k)=>new((i+X0)*Cell,(k+Z0)*Cell);
    /// <summary>The street area at `p` (0 where he does not fit).</summary>
    public int Area(P p){var (i,k)=CellOf(p);return AreaAt(i,k);}
    public bool Reachable(P p)=>Area(p)!=0;
    /// <summary>True when a spot of `area` lies within `radius` metres: standing there he can kick `p`.</summary>
    public bool Near(P p,double radius,int area)
    {
        if(area==0)return false;
        var (ci,ck)=CellOf(p);int r=(int)Math.Ceiling(radius/Cell);
        for(int k=-r;k<=r;k++)for(int i=-r;i<=r;i++)if(i*i+k*k<=r*r&&AreaAt(ci+i,ck+k)==area)return true;
        return false;
    }
    /// <summary>True when any spot of his map lies within `radius` metres.</summary>
    public bool NearAny(P p,double radius)
    {
        var (ci,ck)=CellOf(p);int r=(int)Math.Ceiling(radius/Cell);
        for(int k=-r;k<=r;k++)for(int i=-r;i<=r;i++)if((i*i+k*k)*Cell*Cell<=radius*radius&&AreaAt(ci+i,ck+k)!=0)return true;
        return false;
    }
    /// <summary>Spots of `area` (any area when 0) within `radius` metres of `centre`.</summary>
    public IEnumerable<P> Within(P centre,double radius,int area=0)
    {
        var (ci,ck)=CellOf(centre);int r=(int)Math.Ceiling(radius/Cell);
        for(int k=-r;k<=r;k++)for(int i=-r;i<=r;i++)
            if(i*i+k*k<=r*r&&AreaAt(ci+i,ck+k) is var a&&a!=0&&(area==0||a==area))yield return At(ci+i,ck+k);
    }
    public IEnumerable<P> All(){for(int k=0;k<D;k++)for(int i=0;i<W;i++)if(areas[k*W+i]!=0)yield return At(i,k);}

    /// <summary>
    /// Measure the giant's clearance on every cell (in parallel: `fits` must be thread-safe), flood the connected
    /// street areas and keep those worth roaming. `lamps` mark the lit town. Bounds are in metres.
    /// </summary>
    public static AntigoonReach Build(Func<P,bool> fits,IReadOnlyList<P> lamps,double minX,double minZ,double maxX,double maxZ)
    {
        int x0=(int)Math.Floor(minX/Cell),z0=(int)Math.Floor(minZ/Cell),w=(int)Math.Ceiling(maxX/Cell)-x0+1,d=(int)Math.Ceiling(maxZ/Cell)-z0+1;
        var open=new bool[w*d];
        // Half the cores: the town is still loading beside it.
        var cores=new System.Threading.Tasks.ParallelOptions{MaxDegreeOfParallelism=Math.Max(1,Environment.ProcessorCount/2)};
        System.Threading.Tasks.Parallel.For(0,d,cores,k=>{for(int i=0;i<w;i++)open[k*w+i]=fits(new((i+x0)*Cell,(k+z0)*Cell));});
        var label=new int[w*d];var sizes=new List<int>{0};var edge=new List<bool>{false};var queue=new Queue<int>();
        for(int start=0;start<label.Length;start++)
        {
            if(!open[start]||label[start]!=0)continue;
            int id=sizes.Count,size=0;bool touches=false;label[start]=id;queue.Enqueue(start);
            while(queue.Count>0)
            {
                int n=queue.Dequeue(),i=n%w,k=n/w;size++;
                if(i==0||k==0||i==w-1||k==d-1)touches=true;
                void Try(int a,int b){if(a<0||b<0||a>=w||b>=d)return;int m=b*w+a;if(open[m]&&label[m]==0){label[m]=id;queue.Enqueue(m);}}
                Try(i+1,k);Try(i-1,k);Try(i,k+1);Try(i,k-1);
            }
            sizes.Add(size);edge.Add(touches);
        }
        // Lamps stand at the kerb; count each lamp for the areas within a few metres of its post.
        var lit=new int[sizes.Count];
        foreach(var lamp in lamps)
        {
            var near=new HashSet<int>();int li=(int)Math.Round(lamp.X/Cell)-x0,lk=(int)Math.Round(lamp.Z/Cell)-z0;
            for(int k=-6;k<=6;k++)for(int i=-6;i<=6;i++){int a=li+i,b=lk+k;if(a>=0&&b>=0&&a<w&&b<d&&label[b*w+a]!=0)near.Add(label[b*w+a]);}
            foreach(int id in near)lit[id]++;
        }
        var keep=new ushort[sizes.Count];ushort next=0;
        for(int id=1;id<sizes.Count;id++)
            if(sizes[id]*Cell*Cell>=MinArea&&lit[id]>=MinLamps&&!edge[id]&&next<ushort.MaxValue)keep[id]=++next;
        var areas=new ushort[w*d];
        for(int n=0;n<label.Length;n++)if(label[n]!=0)areas[n]=keep[label[n]];
        return new(x0,z0,w,d,areas);
    }

    public void Save(string path,string key)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temp=path+".tmp";
        using(var file=new BinaryWriter(File.Create(temp)))
        {
            file.Write("ANTIGOON-REACH");file.Write(Version);file.Write(key);file.Write(X0);file.Write(Z0);file.Write(W);file.Write(D);
            var bytes=new byte[areas.Length*2];Buffer.BlockCopy(areas,0,bytes,0,bytes.Length);file.Write(bytes);
        }
        File.Move(temp,path,true);
    }
    public static AntigoonReach? Load(string path,string key)
    {
        try
        {
            if(!File.Exists(path))return null;
            using var file=new BinaryReader(File.OpenRead(path));
            if(file.ReadString()!="ANTIGOON-REACH"||file.ReadInt32()!=Version||file.ReadString()!=key)return null;
            int x0=file.ReadInt32(),z0=file.ReadInt32(),w=file.ReadInt32(),d=file.ReadInt32();
            if(w<=0||d<=0||(long)w*d>16_000_000)return null;
            var bytes=file.ReadBytes(w*d*2);if(bytes.Length!=w*d*2)return null;
            var areas=new ushort[w*d];Buffer.BlockCopy(bytes,0,areas,0,bytes.Length);
            return new(x0,z0,w,d,areas);
        }
        catch(Exception e) when (e is IOException or EndOfStreamException or UnauthorizedAccessException){return null;}
    }
}

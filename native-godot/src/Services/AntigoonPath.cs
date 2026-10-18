using System;
using System.Collections.Generic;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.Services;

/// <summary>Light-weighted routes on the same lattice as the giant's clearance map.</summary>
public static class AntigoonPath
{
    public static P[]? Find(AntigoonReach map,P a,P b,Func<P,float> glow,bool leaps)
    {
        const double cell=AntigoonReach.Cell,pad=16;const int most=200000;
        // Use the reach map's half-metre lattice. A grid shifted with each start/goal samples different sides
        // of a blocked cell and can return a route that the next movement step cannot follow.
        double x0=Math.Floor((Math.Min(a.X,b.X)-pad)/cell)*cell,z0=Math.Floor((Math.Min(a.Z,b.Z)-pad)/cell)*cell;
        int nx=(int)Math.Ceiling((Math.Max(a.X,b.X)+pad-x0)/cell)+1,nz=(int)Math.Ceiling((Math.Max(a.Z,b.Z)+pad-z0)/cell)+1;
        if(nx<=0||nz<=0||(long)nx*nz>most)return null;
        P At(int i,int k)=>new(x0+i*cell,z0+k*cell);
        var open=new sbyte[nx*nz];
        bool Free(int i,int k){if(i<0||k<0||i>=nx||k>=nz)return false;int n=k*nx+i;if(open[n]==0){var p=At(i,k);open[n]=(sbyte)(map.Reachable(p)?1:leaps&&map.Jumpable(p)?2:-1);}return open[n]>0;}
        // A leap is a last resort too: an obstacle costs as much as four metres of walking round it.
        float Cost(int i,int k){var p=At(i,k);float lit=glow(p);return (1+6*Math.Clamp((lit-.2f)/.4f,0,1))*(open[k*nx+i]==2?4:1);}
        int? Near(P p){int ci=(int)Math.Round((p.X-x0)/cell),ck=(int)Math.Round((p.Z-z0)/cell);int? best=null;double bd=double.PositiveInfinity;for(int dk=-4;dk<=4;dk++)for(int di=-4;di<=4;di++){if(!Free(ci+di,ck+dk))continue;double d=p.Distance(At(ci+di,ck+dk));if(d<bd){bd=d;best=(ck+dk)*nx+ci+di;}}return best;}
        if(Near(a) is not int start||Near(b) is not int goal)return null;
        var g=new float[nx*nz];Array.Fill(g,float.PositiveInfinity);var from=new int[nx*nz];Array.Fill(from,-1);
        var queue=new PriorityQueue<int,float>();g[start]=0;queue.Enqueue(start,0);int gi=goal%nx,gk=goal/nx;bool found=false;
        while(queue.TryDequeue(out int n,out float f))
        {
            if(n==goal){found=true;break;}
            int i=n%nx,k=n/nx;if(f>g[n]+(float)Math.Sqrt((i-gi)*(i-gi)+(k-gk)*(k-gk))+1e-3f)continue;
            for(int dk=-1;dk<=1;dk++)for(int di=-1;di<=1;di++)
            {
                if(di==0&&dk==0)continue;int ni=i+di,nk=k+dk;
                if(!Free(ni,nk)||di!=0&&dk!=0&&(!Free(i+di,k)||!Free(i,k+dk)))continue;
                int m=nk*nx+ni;float step=(di!=0&&dk!=0?1.4142f:1)*Cost(ni,nk),ng=g[n]+step;
                if(ng<g[m]){g[m]=ng;from[m]=n;queue.Enqueue(m,ng+(float)Math.Sqrt((ni-gi)*(ni-gi)+(nk-gk)*(nk-gk)));}
            }
        }
        if(!found)return null;
        var cells=new List<int>();for(int n=goal;n>=0;n=from[n]){cells.Add(n);if(n==start)break;}cells.Reverse();
        // Straighten the grid steps where the straight line stays on his map and no brighter than its ends.
        bool Line(int p,int q)
        {
            var u=At(p%nx,p/nx);var v=At(q%nx,q/nx);int count=(int)Math.Ceiling(u.Distance(v)/(cell*.25));
            float limit=Math.Max(Cost(p%nx,p/nx),Cost(q%nx,q/nx))+.2f;
            int previousI=p%nx,previousK=p/nx;
            for(int t=1;t<=count;t++){var w=new P(u.X+(v.X-u.X)*t/count,u.Z+(v.Z-u.Z)*t/count);int wi=(int)Math.Round((w.X-x0)/cell),wk=(int)Math.Round((w.Z-z0)/cell);if(!Free(wi,wk)||Cost(wi,wk)>limit||wi!=previousI&&wk!=previousK&&(!Free(wi,previousK)||!Free(previousI,wk)))return false;previousI=wi;previousK=wk;}
            return true;
        }
        var route=new List<P>{At(cells[0]%nx,cells[0]/nx)};int at=0;
        while(at<cells.Count-1){int far=cells.Count-1;while(far>at+1&&!Line(cells[at],cells[far]))far--;route.Add(At(cells[far]%nx,cells[far]/nx));at=far;}
        return route.ToArray();
    }
}

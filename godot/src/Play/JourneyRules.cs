using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Play;

/// <summary>Engine-owned transport.ts rules. Geometry and API access are supplied by the native world.</summary>
public static class JourneyRules
{
    public readonly record struct Point(double X,double Z) { public double Distance(Point b)=>Math.Sqrt((X-b.X)*(X-b.X)+(Z-b.Z)*(Z-b.Z)); }
    public sealed record Load(string What,int Items);
    public sealed record Stop(string Id,string Line,double X,double Z);
    public sealed record Plan(string Mode,string Why,double Dist,double Secs,Stop? Board=null,Stop? Alight=null) { public int FareC=>0; }
    public sealed record Ask(Point From,Point To,Load? Load=null,int Group=1,bool Velo=false,bool Cart=false,bool Dray=false,bool Boat=false,Point? WaterFrom=null,Point? WaterTo=null,Stop[]? Stops=null,Func<Stop,double>? WaitAt=null,int Age=30);
    public const double WalkMax=300,HiddenSpeed=6;
    public static double Speed(string mode)=>mode switch{"velocipede"=>4.2,"omnibus"=>3.2,"handcart"=>.95,"dray"=>1.2,_=>1.3};
    public static double WalkSecs(double distance)=>distance*1.35/1.3;
    public static Plan Choose(Ask a)
    {
        double dist=a.From.Distance(a.To);Plan Make(string m,string why,double secs,Stop? board=null,Stop? alight=null)=>new(m,why,dist,secs,board,alight);
        double Road(string m)=>dist*1.35/Speed(m);
        double BoatSecs()=>a.WaterFrom is Point from&&a.WaterTo is Point to?WalkSecs(a.From.Distance(from))+from.Distance(to)*1.2/1.3+WalkSecs(to.Distance(a.To)):double.PositiveInfinity;
        bool water=a.WaterFrom.HasValue&&a.WaterTo.HasValue;
        if(a.Load is {Items:>0} load){if(a.Boat&&water)return Make("boat","a load, and the boat lies by the water at both ends",BoatSecs());if(a.Dray&&load.Items>=3)return Make("dray","a big load for the dray",Road("dray"));if(a.Cart)return Make("handcart","a load for the handcart",Road("handcart"));if(a.Dray)return Make("dray","a load, and the dray is there",Road("dray"));return Make("walk","a load, but nothing to put it on: carried by hand",Road("walk")*1.2);}
        if(a.Group>=2&&a.Boat&&water&&dist>=120)return Make("boat","the family goes along the water in their boat",BoatSecs());
        if(dist<=WalkMax)return Make("walk","a short way",Road("walk"));
        if(a.Velo&&a.Age>=15&&a.Age<60)return Make("velocipede","a long way, and the velocipede is at hand",Road("velocipede"));
        double best=double.PositiveInfinity;Stop? board=null,alight=null;
        foreach(var s in a.Stops??Array.Empty<Stop>()){double wa=a.From.Distance(new(s.X,s.Z));if(wa>170)continue;foreach(var t in a.Stops??Array.Empty<Stop>()){if(t.Line!=s.Line||t.Id==s.Id)continue;double wb=a.To.Distance(new(t.X,t.Z));if(wb>170)continue;double secs=WalkSecs(wa)+(a.WaitAt==null?90:Math.Max(WalkSecs(wa),a.WaitAt(s)))+new Point(s.X,s.Z).Distance(new(t.X,t.Z))*1.5/3.2+WalkSecs(wb);if(secs<best){best=secs;board=s;alight=t;}}}
        if(board!=null&&best<WalkSecs(dist)*1.25)return Make("omnibus","a long way, with an omnibus stop at both ends",best,board,alight);
        return Make("walk","a long way, on foot",Road("walk"));
    }
    public static Load? ScheduleLoad(string trade,int wealth,string from,string to)
    {
        if(trade is not("market_woman" or "fishwife" or "grocer" or "dealer"))return null;
        string what=trade=="fishwife"?"fish":trade=="dealer"?"furniture":"goods";
        if(from=="home"&&to.StartsWith("work",StringComparison.Ordinal))return new(what,2+Math.Min(2,(int)Math.Floor(wealth/2.0)));
        return from.StartsWith("work",StringComparison.Ordinal)&&to=="home"?new(what,1):null;
    }
    public sealed record Family(string Id,int Age,bool Home);
    public sealed record Loading(string[] Carriers,(string Who,int Item)[][] Rounds,double Secs);
    public static Loading PlanLoading(int items,string owner,IEnumerable<Family> family)
    {
        int n=Math.Clamp(items,0,12);var carriers=new[]{owner}.Concat(family.Where(f=>f.Id!=owner&&f.Home&&f.Age>=10).Take(n>1?3:0).Select(f=>f.Id)).ToArray();var rounds=new List<(string,int)[]>();
        for(int i=0;i<n;){var round=new List<(string,int)>();foreach(string who in carriers){if(i>=n)break;round.Add((who,i++));}rounds.Add(round.ToArray());}return new(carriers,rounds.ToArray(),rounds.Count*9);
    }
    public static Point[]? WaterPath(Func<double,double,bool> free,Point a,Point b,double cell=2,double pad=60,int maxCells=250000)
    {
        double x0=Math.Min(a.X,b.X)-pad,z0=Math.Min(a.Z,b.Z)-pad;int nx=(int)Math.Ceiling((Math.Max(a.X,b.X)+pad-x0)/cell),nz=(int)Math.Ceiling((Math.Max(a.Z,b.Z)+pad-z0)/cell);
        if(nx<=0||nz<=0||(long)nx*nz>maxCells)return null;var ok=Enumerable.Repeat((sbyte)-1,nx*nz).ToArray();
        double X(int i)=>x0+(i+.5)*cell;double Z(int j)=>z0+(j+.5)*cell;
        bool Open(int i,int j){if(i<0||j<0||i>=nx||j>=nz)return false;int k=j*nx+i;if(ok[k]<0)ok[k]=(sbyte)(free(X(i),Z(j))?1:0);return ok[k]==1;}
        int? Near(Point p){int i0=(int)Math.Floor((p.X-x0)/cell),j0=(int)Math.Floor((p.Z-z0)/cell),best=int.MaxValue;int? found=null;for(int dj=-3;dj<=3;dj++)for(int di=-3;di<=3;di++){if(!Open(i0+di,j0+dj))continue;int d=di*di+dj*dj;if(d<best){best=d;found=(j0+dj)*nx+i0+di;}}return found;}
        int? start=Near(a),target=Near(b);if(start==null||target==null)return null;int sk=start.Value,tk=target.Value,n=nx*nz;
        var g=Enumerable.Repeat(float.PositiveInfinity,n).ToArray();var from=Enumerable.Repeat(-1,n).ToArray();var closed=new bool[n];var heap=new List<(double F,int K)>();
        double H(int i,int j)=>new Point(i,j).Distance(new(tk%nx,tk/nx));
        void Push(int k,double f){heap.Add((f,k));int i=heap.Count-1;while(i>0){int p=(i-1)>>1;if(heap[p].F<=heap[i].F)break;(heap[p],heap[i])=(heap[i],heap[p]);i=p;}}
        int Pop(){int top=heap[0].K;var last=heap[^1];heap.RemoveAt(heap.Count-1);if(heap.Count>0){heap[0]=last;int i=0;while(true){int l=i*2+1,r=l+1,m=i;if(l<heap.Count&&heap[l].F<heap[m].F)m=l;if(r<heap.Count&&heap[r].F<heap[m].F)m=r;if(m==i)break;(heap[m],heap[i])=(heap[i],heap[m]);i=m;}}return top;}
        g[sk]=0;Push(sk,H(sk%nx,sk/nx));bool found=false;int guard=0;
        while(heap.Count>0&&guard++<n){int k=Pop();if(closed[k])continue;closed[k]=true;if(k==tk){found=true;break;}int i=k%nx,j=k/nx;for(int dj=-1;dj<=1;dj++)for(int di=-1;di<=1;di++){if(di==0&&dj==0)continue;int ni=i+di,nj=j+dj;if(!Open(ni,nj)||(di!=0&&dj!=0&&(!Open(i+di,j)||!Open(i,j+dj))))continue;int nk=nj*nx+ni;if(closed[nk])continue;double ng=g[k]+(di!=0&&dj!=0?Math.Sqrt(2):1);if(ng<g[nk]){g[nk]=(float)ng;from[nk]=k;Push(nk,ng+H(ni,nj));}}}
        if(!found)return null;var cells=new List<Point>();for(int k=tk;k>=0;k=from[k]){cells.Add(new(X(k%nx),Z(k/nx)));if(k==sk)break;}cells.Reverse();
        bool Line(Point p,Point q){int count=(int)Math.Ceiling(p.Distance(q)/(cell*.5));for(int i=1;i<count;i++)if(!free(p.X+(q.X-p.X)*i/count,p.Z+(q.Z-p.Z)*i/count))return false;return true;}
        var result=new List<Point>{cells[0]};int at=0;while(at<cells.Count-1){int m=cells.Count-1;while(m>at+1&&!Line(cells[at],cells[m]))m--;result.Add(cells[m]);at=m;}return result.ToArray();
    }
}

using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.People;

public sealed class NativeSteenBody {public double X,Z;public object? Tag;}
public sealed class NativeSteenVisitor
{public string Kind="",State="coming";public NativeSteenBody? Body;public string? Id;public NativeMarketPoint Look,To;public bool GoesIn;public double Age;}
public sealed class NativeSteenContext
{
    public Func<double> Random=null!;
    public Func<double,double,bool> Hidden=null!,SeenByOthers=null!;
    public Func<NativeSteenBody,bool> Alive=null!,Busy=null!;
    public Func<double,double,double> NearestPlayer=null!;
    public Func<bool> RunGroup=null!;
    public Func<string,double,double,double,double,NativeSteenBody?> Add=null!;
    public Action<NativeSteenBody,double,double,double?> Go=null!;
    public Action<NativeSteenBody,string,double?> Stand=null!;
    public Action<NativeSteenBody> Remove=null!;
    public Func<string,string?> NewId=null!;
    public Action<string,NativeSteenBody> Person=null!;
    public Action<string,bool> Release=null!;
    public bool Multiplayer;
}
/// <summary>Exact museum visitor coming/look/entry/inside/exit/leaving rules from steenlife.ts.</summary>
public sealed class NativeSteenRules
{
    public static readonly NativeMarketPoint Door=new(-183.5,-23);
    public static readonly NativeMarketPoint[] Ends={new(-196,12),new(-178,22),new(-210,-18),new(-157,-12),new(-212,12)};
    public static readonly NativeMarketPoint[] Looks={new(-183.3,-20.2),new(-181.2,-19.6),new(-185.6,-19.8),new(-179.2,-20.4)};
    public static readonly string[] Kinds={"gentleman","wife_a","wife_b","clerk","priest","old_woman","sailor_b","maid","wife_a","gentleman"};
    public readonly List<NativeSteenVisitor> Visitors=new();
    public double SpawnTime=3;
    private static double Distance(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    public void Drop(NativeSteenVisitor v,NativeSteenContext c,bool ended=true){if(v.Id!=null)c.Release(v.Id,ended);v.Id=null;if(v.Body!=null&&c.Alive(v.Body))c.Remove(v.Body);v.Body=null;}
    public void Reset(NativeSteenContext c){foreach(var v in Visitors)Drop(v,c);Visitors.Clear();SpawnTime=3;}
    public void Frame(double dt,bool open,bool near,double cx,double cz,NativeSteenContext c)
    {
        double R(double lo,double hi)=>lo+c.Random()*(hi-lo);T Pick<T>(IReadOnlyList<T> list)=>list[(int)Math.Floor(c.Random()*list.Count)];
        foreach(var v in Visitors)if(v.Body!=null&&v.Id!=null)c.Person(v.Id,v.Body);
        for(int i=Visitors.Count-1;i>=0;i--){var v=Visitors[i];if(v.Body!=null&&!c.Alive(v.Body))v.Body=null;if(!near){Drop(v,c,!(v.Body!=null&&c.Multiplayer&&c.NearestPlayer(v.Body.X,v.Body.Z)<60));Visitors.RemoveAt(i);continue;}v.Age+=dt;var p=v.Body;
            switch(v.State){
                case "coming":if(p==null){Visitors.RemoveAt(i);break;}if(!c.Busy(p)||Distance(p.X,p.Z,v.Look.X,v.Look.Z)<.6){c.Stand(p,c.Random()<.3?"fold":"idle",Math.Atan2(Door.X-p.X,Door.Z-p.Z));v.State="looking";v.Age=-R(5,11);}else if(v.Age>150){Drop(v,c);Visitors.RemoveAt(i);}break;
                case "looking":if(p==null){Visitors.RemoveAt(i);break;}if(v.Age>0){if(v.GoesIn&&open){c.Go(p,Door.X+R(-.3,.3),Door.Z+.6,.9);v.State="entering";}else{var end=Pick(Ends);c.Go(p,end.X,end.Z,null);v.State="leaving";}v.Age=0;}break;
                case "entering":if(p==null){Visitors.RemoveAt(i);break;}if(Distance(p.X,p.Z,Door.X,Door.Z)<3.4||!c.Busy(p)&&v.Age>1||v.Age>25){v.To=new(Door.X+R(-.25,.25),Door.Z+.3);c.Stand(p,"walk",Math.PI);v.State="stepIn";}break;
                case "stepIn":if(p==null||Step(p,v.To,dt,.8)){if(p!=null)Drop(v,c);v.State="inside";v.Age=-R(40,120);}break;
                case "inside":if(v.Age>0||!open){p=c.Add(v.Kind,Door.X,Door.Z+.3,0,1.1);if(p==null)break;v.Body=p;v.Id=c.NewId(v.Kind);c.Stand(p,"walk",0);v.To=new(Door.X+R(-.6,.6),Door.Z+3);v.State="stepOut";v.Age=0;}break;
                case "stepOut":if(p==null){Visitors.RemoveAt(i);break;}if(Step(p,v.To,dt,.9)||v.Age>8){var end=Pick(Ends);c.Go(p,end.X,end.Z,null);v.State="leaving";v.Age=0;}break;
                case "leaving":if(p==null||!c.Busy(p)&&v.Age>1.5||v.Age>90||Distance(p.X,p.Z,cx,cz)>25&&c.Hidden(p.X,p.Z)){Drop(v,c);Visitors.RemoveAt(i);}break;
            }
        }
        if(!near||!open||!c.RunGroup())return;SpawnTime-=dt;if(SpawnTime<=0&&Visitors.Count(v=>v.State!="inside")<3&&Visitors.Count<5){SpawnTime=R(12,32);
            var ends=Ends.Where(p=>c.Hidden(p.X,p.Z)&&!c.SeenByOthers(p.X,p.Z)&&Distance(p.X,p.Z,cx,cz)>8).ToArray();if(ends.Length==0)return;var from=Pick(ends);string kind=Pick(Kinds);var p=c.Add(kind,from.X,from.Z,0,R(1,1.25));if(p==null)return;var free=Looks.Where(l=>!Visitors.Any(v=>v.Look==l)).ToArray();var look=Pick(free.Length>0?free:Looks);c.Go(p,look.X,look.Z,null);var visitor=new NativeSteenVisitor{Kind=kind,Body=p,Look=look,GoesIn=c.Random()<.7,Id=c.NewId(kind)};Visitors.Add(visitor);
        }
    }
    private static bool Step(NativeSteenBody p,NativeMarketPoint to,double dt,double speed){double dx=to.X-p.X,dz=to.Z-p.Z,len=Math.Sqrt(dx*dx+dz*dz);if(len<.08)return true;double k=Math.Min(1,speed*dt/len);p.X+=dx*k;p.Z+=dz*k;return false;}
}

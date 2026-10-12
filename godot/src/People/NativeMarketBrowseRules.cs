using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.People;

public class NativeMarketTarget {public double X,Z,Yaw;public string Goods="",Keeper="";}
public class NativeMarketBrowser {public string Place="",Phase="pick";public double Time;public NativeMarketTarget? Target;public int Visits,Want,Tries;public bool Own;}
public sealed class NativeMarketBrowseContext
{
    public double X,Z;
    public Func<double> Random=null!;
    public Func<string,IReadOnlyList<NativeMarketTarget>> Targets=null!;
    public Func<double,double,(double X,double Z)?> Open=null!;
    public Func<bool> Busy=null!;
    public Func<string,bool> HasField=null!;
    public Action<double,double,double> Go=null!;
    public Action<string,double> Stand=null!;
    public Action<NativeMarketTarget,double> Gesture=null!;
    public Action<string> Buy=null!,Leave=null!;
    public Func<string,string> Bought=null!;
}
/// <summary>The original pick/go/look/haggle/buy/leave state machine, separate from rendering.</summary>
public static class NativeMarketBrowseRules
{
    public static void Step(NativeMarketBrowser b,double dt,NativeMarketBrowseContext c)
    {
        double R(double lo,double hi)=>lo+c.Random()*(hi-lo);T Pick<T>(IReadOnlyList<T> list)=>list[(int)Math.Floor(c.Random()*list.Count)];
        double Dist(NativeMarketTarget t)=>Math.Sqrt(Math.Pow(t.X-c.X,2)+Math.Pow(t.Z-c.Z,2));b.Time-=dt;
        switch(b.Phase){
            case "pick":
                if(b.Time>0)return;if(b.Visits>=b.Want){if(b.Own&&c.HasField(b.Place))c.Leave(b.Place);else b.Visits=0;return;}
                var all=c.Targets(b.Place);var near=all.Where(t=>Dist(t)<(c.Random()<.7?12:30)&&Dist(t)>1).ToArray();var target=near.Length>0?Pick(near):all.Count>0?Pick(all):null;if(target==null){b.Time=2;return;}var q=c.Open(target.X+R(-.3,.3),target.Z+R(-.3,.3));if(q==null){b.Time=1;return;}b.Target=target;b.Phase="go";b.Time=30;b.Tries=0;c.Go(q.Value.X,q.Value.Z,R(.8,1.05));return;
            case "go":
                if(c.Busy()&&b.Time>0)return;if(Dist(b.Target!)>2.2){b.Phase="pick";b.Time=R(.5,2);return;}c.Stand("idle",b.Target!.Yaw);b.Phase="look";b.Time=R(1.5,3.5);return;
            case "look":
                if(b.Time>0)return;if(c.Random()<.3){b.Phase="pick";b.Visits++;b.Time=R(.3,1.2);return;}c.Stand("talk",b.Target!.Yaw);c.Gesture(b.Target,4);b.Phase="haggle";b.Time=R(2.5,4.5);return;
            case "haggle":
                if(b.Time>0)return;if(c.Random()<.6){c.Buy(c.Bought(b.Target!.Goods));c.Gesture(b.Target,1.5);}c.Stand("idle",b.Target!.Yaw);b.Visits++;b.Phase="pick";b.Time=R(.8,2);return;
            case "leave":case "gone":if(!c.Busy())b.Phase="gone";return;
        }
    }
}
public static class NativeMarketCalendar
{
    public static double Share(string place,int day,double hour,double soldOutAt=double.NaN)
    {
        double setup,open,close,gone,rest,late=16.5,lateGone=17.5;int weekday=((day-1)%7+7)%7+1;
        if(place=="vismarkt"){if(weekday==7)return 0;setup=5.5;open=7;close=12.5;gone=14;rest=.35;}
        else if(place=="grote_markt"){if(weekday is not(3 or 6))return 0;setup=6;open=7.5;close=13;gone=14.5;rest=.3;}else return 0;
        double h=(hour%24+24)%24,share=h<setup||h>=lateGone?0:h<open?(h-setup)/(open-setup):h<close?1:h<gone?1-(1-rest)*(h-close)/(gone-close):h<late?rest:rest*(1-(h-late)/(lateGone-late));
        if(double.IsNaN(soldOutAt)||hour<soldOutAt||hour<open)return share;return Math.Min(share,1-(1-rest)*Math.Min(1,(hour-soldOutAt)/.75));
    }
}


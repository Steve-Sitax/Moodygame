using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Native.Services;

/// <summary>Server-owned encounter simulation. No client controls health, hits or enemy movement.</summary>
public sealed class AntigoonBrain
{
    public readonly record struct Point(double X, double Z)
    {
        public double Distance(Point p) => Math.Sqrt((X-p.X)*(X-p.X)+(Z-p.Z)*(Z-p.Z));
        public Point Toward(Point p,double distance) { double d=Distance(p); return d<1e-6?this:new(X+(p.X-X)*Math.Min(1,distance/d),Z+(p.Z-Z)*Math.Min(1,distance/d)); }
    }
    public sealed record Player(int Id,Point At,bool Available=true);
    public const double WalkSpeed=1.8, RunSpeed=4.8, AttackRange=2.2, ContactTime=.62, AttackDuration=1.35, SafeLight=.45, ShieldSpeed=.7;
    // Prey spotted from afar: he stops dead and stares, then charges. Close prey gets the boot at once.
    public const double NoticeTime=1.6, NoticeDistance=7, NoticeRest=14, LungeSpeed=2.6;
    public const int KickDamage=3;
    public Point Position { get; private set; }
    public Point Home { get; private set; }
    public double Yaw { get; private set; }
    public int Health { get; private set; }=120;
    public string State { get; private set; }="hidden";
    public double StateTime { get; private set; }
    public int Target { get; private set; }
    public int AttackSerial { get; private set; }
    /// <summary>Landed kicks per target; clients play the knock-back when their count rises.</summary>
    public Dictionary<int,int> Kicks { get; }=new();
    public Func<Point,double> Light = _=>0;
    public Func<Point,bool> Clear = _=>true;
    public Func<Point,Point,bool> Sight = (_,_)=>true;
    public Func<Point,Point,IReadOnlyList<Point>?> Path = (_,to)=>new[]{to};
    /// <summary>False where he cannot stand within kicking reach: such spots are safe places.</summary>
    public Func<Point,bool> Reach = _=>true;
    public Action<int,int>? HurtPlayer;
    public List<Point> Patrol { get; }=new();
    private readonly Dictionary<int,double> swings=new();
    private IReadOnlyList<Point>? route;
    private Point routeGoal;
    private int routeIndex, patrolIndex;
    private double routeAge,now,calmUntil,noticedAt=-NoticeRest,darkPicked=-1;
    private Point shieldGoal;
    private bool contacted;
    public AntigoonBrain(Point home) { Position=Home=home; }
    public void Restore(Point p,int health) { Position=p;Health=Math.Clamp(health,0,120);Set(Health==0?"death":"hidden"); }
    public void Reveal() { if(Health>0)Set("idle"); }
    public bool BeginThrow(Point lamp)
    {
        if(Health<=0||State is "hidden" or "attack" or "hit" or "recoil_light" or "retreat" or "shield" or "notice"||Light(Position)>=SafeLight)return false;
        Target=0;Yaw=Math.Atan2(lamp.X-Position.X,lamp.Z-Position.Z);Set("throw");return true;
    }
    private void Set(string state) { if(State==state)return;State=state;StateTime=0;contacted=false;if(state=="attack")AttackSerial++; }
    public bool Strike(Player p)
    {
        if(!p.Available||Health<=0||State=="hidden"||p.At.Distance(Position)>2.5||!Sight(p.At,Position))return false;
        if(swings.TryGetValue(p.Id,out double last)&&now-last<.8)return false;
        swings[p.Id]=now;Health=Math.Max(0,Health-15);Target=State=="shield"?0:p.Id;
        if(Health==0)Set("death");else if(State is not ("attack" or "shield"))Set("hit");return true;
    }
    public void Step(double dt,bool night,IReadOnlyList<Player> players)
    {
        dt=Math.Clamp(dt,0,.1);now+=dt;StateTime+=dt;routeAge+=dt;
        if(Health<=0){Set("death");return;}
        if(!night)
        {
            Target=0;
            if(Position.Distance(Home)<.45){Set("hidden");return;}
            Set("retreat");Move(Home,RunSpeed,dt,true);return;
        }
        if(State=="shield"||Light(Position)>=SafeLight)
        {
            // Out of the light by the shortest way: shield his eyes and grope toward the nearest dark spot he can reach.
            if(State!="shield") { shieldGoal=DarkGoal();Set("shield"); }
            Target=0;calmUntil=now+1.2;
            // Re-choose at most twice a second: each choice tries real routes.
            bool moved=Position.Distance(shieldGoal)>=.55&&Move(shieldGoal,ShieldSpeed,dt,true);
            if(!moved&&now-darkPicked>.5){shieldGoal=DarkGoal();route=null;}
            if(Light(Position)<SafeLight&&StateTime>.8)Set("walk");
            return;
        }
        if(State=="hidden")Set("idle");
        if(State=="hit") {if(StateTime<.36)return;Set("idle");}
        if(State=="throw") {if(StateTime<2.4)return;Set("idle");}
        if(State=="notice")
        {
            if(players.FirstOrDefault(p=>p.Id==Target) is {} prey)Yaw=Math.Atan2(prey.At.X-Position.X,prey.At.Z-Position.Z);
            if(StateTime<NoticeTime)return;Set("run");
        }
        var target=players.Where(p=>now>=calmUntil&&p.Available&&Light(p.At)<SafeLight&&p.At.Distance(Position)<24&&Reach(p.At)&&Sight(Position,p.At)).OrderBy(p=>p.At.Distance(Position)).FirstOrDefault();
        if(State=="attack")
        {
            var victim=players.FirstOrDefault(p=>p.Id==Target&&p.Available);
            // He lunges into the wind-up: a fleeing resident gets the running kick, a player a heavy step.
            if(StateTime<ContactTime&&victim!=null&&Position.Distance(victim.At)>1.9)
            {
                Move(victim.At,Target<0?RunSpeed*.8:LungeSpeed,dt,false);
                if(State!="attack")return;
                Yaw=Math.Atan2(victim.At.X-Position.X,victim.At.Z-Position.Z);
            }
            if(!contacted&&StateTime>=ContactTime)
            {
                contacted=true;
                if(victim!=null&&victim.At.Distance(Position)<AttackRange+.25&&Light(victim.At)<SafeLight&&Sight(Position,victim.At))
                {
                    double facing=Math.Atan2(victim.At.X-Position.X,victim.At.Z-Position.Z);
                    if(Math.Cos(facing-Yaw)>.35){Kicks[victim.Id]=Kicks.GetValueOrDefault(victim.Id)+1;HurtPlayer?.Invoke(victim.Id,KickDamage);}
                }
            }
            if(StateTime>=AttackDuration)Set("idle");return;
        }
        if(target!=null)
        {
            bool fresh=Target!=target.Id;Target=target.Id;Yaw=Math.Atan2(target.At.X-Position.X,target.At.Z-Position.Z);
            if(Position.Distance(target.At)<=AttackRange){Set("attack");return;}
            if(fresh&&State!="run"&&now-noticedAt>=NoticeRest&&Position.Distance(target.At)>=NoticeDistance){noticedAt=now;Set("notice");return;}
            Set("run");if(!Move(target.At,RunSpeed,dt,false)&&State!="shield")Roam(dt);return;
        }
        Target=0;Roam(dt);
    }
    private Point DarkGoal()
    {
        darkPicked=now;
        var spots=new List<Point>(Patrol);
        foreach(double r in new[]{3.0,6,10})for(int i=0;i<12;i++){double a=i*Math.PI/6;spots.Add(new(Position.X+Math.Sin(a)*r,Position.Z+Math.Cos(a)*r));}
        foreach(var p in spots.Where(p=>p.Distance(Position)>.6&&Clear(p)).OrderBy(p=>Light(p)+.02*p.Distance(Position)).Take(8))
            if(Path(Position,p) is {Count:>0})return p;
        return RoamGoal();
    }
    private Point RoamGoal()=>Patrol.Count>0?Patrol[patrolIndex%Patrol.Count]:new(Position.X+Math.Sin(Yaw)*3,Position.Z+Math.Cos(Yaw)*3);
    private void Roam(double dt)
    {
        // Move straight through reached waypoints and immediately skip unusable routes.
        for(int i=0;i<Patrol.Count;i++)
        {
            var goal=RoamGoal();
            if(Position.Distance(goal)<.55){patrolIndex++;route=null;continue;}
            Set("walk");if(Move(goal,WalkSpeed,dt,false)||State=="shield")return;
            patrolIndex++;route=null;
        }
        // A changed prop may block the authored circuit. Find another nearby walking direction.
        for(int i=0;i<12;i++)
        {
            double angle=Yaw+i*Math.PI/6;var goal=new Point(Position.X+Math.Sin(angle)*3,Position.Z+Math.Cos(angle)*3);
            if(!Clear(goal)||Path(Position,goal) is not {Count:>0})continue;
            Set("walk");if(Move(goal,WalkSpeed,dt,false)||State=="shield")return;
        }
        Set("idle");
    }
    private bool Move(Point goal,double speed,double dt,bool allowLight)
    {
        if(route==null||routeAge>1.2||routeGoal.Distance(goal)>2)
        { route=Path(Position,goal);routeGoal=goal;routeAge=0;routeIndex=0; }
        if(route==null||route.Count==0)return false;
        while(routeIndex<route.Count-1&&Position.Distance(route[routeIndex])<.3)routeIndex++;
        Point next=Position.Toward(route[routeIndex],speed*dt);
        if(!Clear(next)){route=null;return false;}
        if(!allowLight&&Light(next)>=SafeLight)
        {shieldGoal=goal;Target=0;Set("shield");return false;}
        if(Position.Distance(next)>1e-5)Yaw=Math.Atan2(next.X-Position.X,next.Z-Position.Z);
        bool moved=Position.Distance(next)>1e-5;Position=next;return moved;
    }
}

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
    public const double WalkSpeed=1.8, RunSpeed=4.8, AttackRange=2.2, ContactTime=.62, AttackDuration=1.35, SafeLight=.45;
    public Point Position { get; private set; }
    public Point Home { get; private set; }
    public double Yaw { get; private set; }
    public int Health { get; private set; }=120;
    public string State { get; private set; }="hidden";
    public double StateTime { get; private set; }
    public int Target { get; private set; }
    public int AttackSerial { get; private set; }
    public Func<Point,double> Light = _=>0;
    public Func<Point,bool> Clear = _=>true;
    public Func<Point,Point,bool> Sight = (_,_)=>true;
    public Func<Point,Point,IReadOnlyList<Point>?> Path = (_,to)=>new[]{to};
    public Action<int,int>? HurtPlayer;
    public List<Point> Patrol { get; }=new();
    private readonly Dictionary<int,double> swings=new();
    private IReadOnlyList<Point>? route;
    private Point routeGoal;
    private int routeIndex, patrolIndex;
    private double routeAge,now,lostSight,patrolStall;
    private bool contacted;
    public AntigoonBrain(Point home) { Position=Home=home; }
    public void Restore(Point p,int health) { Position=p;Health=Math.Clamp(health,0,120);Set(Health==0?"death":"hidden"); }
    public void Reveal() { if(Health>0)Set("idle"); }
    public bool BeginThrow(Point lamp)
    {
        if(Health<=0||State is "hidden" or "attack" or "hit" or "recoil_light" or "retreat"||Light(Position)>=SafeLight)return false;
        Target=0;Yaw=Math.Atan2(lamp.X-Position.X,lamp.Z-Position.Z);Set("throw");return true;
    }
    private void Set(string state) { if(State==state)return;State=state;StateTime=0;contacted=false;if(state=="attack")AttackSerial++; }
    public bool Strike(Player p)
    {
        if(!p.Available||Health<=0||State=="hidden"||p.At.Distance(Position)>2.5||!Sight(p.At,Position))return false;
        if(swings.TryGetValue(p.Id,out double last)&&now-last<.8)return false;
        swings[p.Id]=now;Health=Math.Max(0,Health-15);Target=p.Id;
        if(Health==0)Set("death");else if(State!="attack")Set("hit");return true;
    }
    public void Step(double dt,bool night,IReadOnlyList<Player> players)
    {
        dt=Math.Clamp(dt,0,.1);now+=dt;StateTime+=dt;routeAge+=dt;
        if(Health<=0){Set("death");return;}
        bool lit=Light(Position)>=SafeLight;
        if(lit&&State!="recoil_light"&&State!="retreat")Set("recoil_light");
        if(State=="recoil_light") { if(StateTime>=.65)Set("retreat");else return; }
        if(!night||State=="retreat")
        {
            Target=0;
            if(Position.Distance(Home)<.45){Set("hidden");return;}
            Set("retreat");Move(Home,RunSpeed,dt,true);
            if(night&&!lit&&StateTime>2.5)Set("idle");
            return;
        }
        if(State=="hidden")Set("idle");
        if(State=="hit") {if(StateTime<.36)return;Set("idle");}
        if(State=="throw") {if(StateTime<2.4)return;Set("idle");}
        var target=players.Where(p=>p.Available&&Light(p.At)<SafeLight&&p.At.Distance(Position)<24&&Sight(Position,p.At)).OrderBy(p=>p.At.Distance(Position)).FirstOrDefault();
        if(State=="attack")
        {
            var victim=players.FirstOrDefault(p=>p.Id==Target&&p.Available);
            // A fleeing resident keeps moving during wind-up. Follow through with the running kick.
            if(Target<0&&StateTime<ContactTime&&victim!=null&&Position.Distance(victim.At)>1.2)
            {
                Move(victim.At,RunSpeed*.8,dt,false);
                if(State!="attack")return;
            }
            if(!contacted&&StateTime>=ContactTime)
            {
                contacted=true;
                if(victim!=null&&victim.At.Distance(Position)<AttackRange+.25&&Light(victim.At)<SafeLight&&Sight(Position,victim.At))
                {
                    double facing=Math.Atan2(victim.At.X-Position.X,victim.At.Z-Position.Z);
                    if(Math.Cos(facing-Yaw)>.35)HurtPlayer?.Invoke(victim.Id,2);
                }
            }
            if(StateTime>=AttackDuration)Set("idle");return;
        }
        if(target!=null)
        {
            Target=target.Id;lostSight=0;Yaw=Math.Atan2(target.At.X-Position.X,target.At.Z-Position.Z);
            if(Position.Distance(target.At)<=AttackRange){Set("attack");return;}
            Set("run");Move(target.At,RunSpeed,dt,false);return;
        }
        lostSight+=dt;
        if(lostSight>3)Target=0;
        if(Patrol.Count==0){Set("idle");return;}
        var goal=Patrol[patrolIndex%Patrol.Count];
        if(Position.Distance(goal)<.55){patrolIndex++;patrolStall=0;Set("idle");return;}
        var before=Position;Set("walk");Move(goal,WalkSpeed,dt,false);
        patrolStall=Position.Distance(before)<.001?patrolStall+dt:0;
        if(patrolStall>3){patrolIndex++;patrolStall=0;route=null;}
    }
    private void Move(Point goal,double speed,double dt,bool escaping)
    {
        if(route==null||routeAge>1.2||routeGoal.Distance(goal)>2)
        { route=Path(Position,goal);routeGoal=goal;routeAge=0;routeIndex=0; }
        if(route==null||route.Count==0){if(!escaping)Set("idle");return;}
        while(routeIndex<route.Count-1&&Position.Distance(route[routeIndex])<.3)routeIndex++;
        Point next=Position.Toward(route[routeIndex],speed*dt);
        double currentLight=Light(Position),nextLight=Light(next);
        if(!Clear(next)||nextLight>=SafeLight&&(!escaping||nextLight>currentLight+.005))
        { route=null;if(!escaping)Set("idle");return; }
        if(Position.Distance(next)>1e-5)Yaw=Math.Atan2(next.X-Position.X,next.Z-Position.Z);
        Position=next;
    }
}

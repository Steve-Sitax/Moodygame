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
    public const double WalkSpeed=1.8, RunSpeed=4.8, AttackRange=2.2, ContactTime=.62, AttackDuration=1.35, SafeLight=.45, ShieldSpeed=1.3;
    // Prey spotted from afar: he stops dead and stares, then charges. Close prey gets the boot at once.
    public const double NoticeTime=1.6, NoticeDistance=7, NoticeRest=14, LungeSpeed=2.6;
    public const int KickDamage=3;
    // Every second attack he grabs instead: bends to seize the neck, lifts the prey to his face, stares, throws.
    public const double GrabContact=.8, GrabRelease=3.1, GrabDuration=3.9, GrabRange=2.4, ThrowDistance=6;
    public const int ThrowDamage=3, WallDamage=2;
    public sealed record Throw(int Serial,int Victim,Point From,Point To,bool Wall);
    // Hunger: with no one to hunt he goes from food to food: fish and flesh first, grain only when nothing better is
    // near. Cats and dogs run from him; one he catches, he eats.
    public sealed record Food(string Id,string Kind,Point At,Point Stand,double Worth);
    public sealed record Beast(string Id,string Species,Point At);
    public const double EatTime=8, FoodRest=600, HuntRange=16, SeizeRange=2.2;
    public List<Food> Foods { get; }=new();
    public Func<IReadOnlyList<Beast>> Beasts = ()=>Array.Empty<Beast>();
    /// <summary>What he is eating: "food:&lt;id&gt;" or "beast:&lt;id&gt;" (null when not eating).</summary>
    public string? Meal { get; private set; }
    /// <summary>The cat or dog he is after.</summary>
    public string? Prey { get; private set; }
    /// <summary>Animals he has eaten tonight; they are gone for good.</summary>
    public HashSet<string> Eaten { get; }=new();
    private readonly Dictionary<string,double> fed=new();
    private string? goingFor;
    public string? GoingFor=>goingFor;
    private int stuck;
    // A leap over an obstacle he cannot step over: crouch and spring, clear it, land and walk on.
    public const double JumpTime=.95, JumpTakeoff=.3, JumpHeight=1.7;
    /// <summary>Cells he can leap across but not stand on.</summary>
    public Func<Point,bool> Jumpable = _=>false;
    /// <summary>His height above the street now (in a leap).</summary>
    public double Lift=>State=="jump"&&StateTime>JumpTakeoff?JumpHeight*Math.Sin(Math.PI*Math.Min(1,(StateTime-JumpTakeoff)/(JumpTime-JumpTakeoff-.12))):0;
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
    /// <summary>The prey in his fist (0: none). Its position is his, not its own, until the throw.</summary>
    public int Held { get; private set; }
    public Throw? LastThrow { get; private set; }
    /// <summary>Where a body thrown from `from` toward `to` comes down: short of `to` when a wall is in the way.</summary>
    public Func<Point,Point,Point> Landing = (_,to)=>to;
    public Action<Throw>? Thrown;
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
    private Point shieldGoal,jumpFrom,jumpTo;
    // The way his body points while he walks: it comes round at a giant's pace, and he slows until it has.
    private double heading,noLeapUntil;
    /// <summary>False for a while after a leap he could not make: his routes then go round every obstacle.</summary>
    public bool LeapsAllowed=>State!="shield"&&now>=noLeapUntil;
    private string jumpThen="walk";
    /// <summary>Proof aid: where he is heading while shielding, and the next patrol spot.</summary>
    public (Point Shield,Point Patrol) Goals=>(shieldGoal,RoamGoal());
    private bool contacted,grabNext;
    private int throws;
    public AntigoonBrain(Point home) { Position=Home=home; }
    public void Restore(Point p,int health) { Position=p;Health=Math.Clamp(health,0,120);Set(Health==0?"death":"hidden"); }
    public void Reveal() { if(Health>0)Set("idle"); }
    public bool BeginThrow(Point lamp)
    {
        if(Health<=0||State is "hidden" or "attack" or "grab" or "jump" or "hit" or "recoil_light" or "retreat" or "shield" or "notice"||Light(Position)>=SafeLight)return false;
        Target=0;Yaw=Math.Atan2(lamp.X-Position.X,lamp.Z-Position.Z);Set("throw");return true;
    }
    private void Set(string state)
    {
        if(State==state)return;
        if(State=="eat"&&state!="eat")Meal=null;
        if(state is "walk" or "run" or "retreat" or "shield"&&State is not ("walk" or "run" or "retreat" or "shield" or "jump"))heading=Yaw;
        // Whatever ends a grab early (light, a blow, dawn) lets the prey drop at his feet.
        if(State=="grab"&&Held!=0)Release(1.4,false);
        State=state;StateTime=0;contacted=false;if(state is "attack" or "grab")AttackSerial++;
    }
    private void Release(double distance,bool flung)
    {
        var dir=new Point(Math.Sin(Yaw),Math.Cos(Yaw));var from=new Point(Position.X+dir.X*.9,Position.Z+dir.Z*.9);
        var want=new Point(from.X+dir.X*distance,from.Z+dir.Z*distance);var to=flung?Landing(from,want):want;
        LastThrow=new(++throws,Held,from,to,flung&&to.Distance(from)<distance-.3);Held=0;Thrown?.Invoke(LastThrow);
    }
    public bool Strike(Player p)
    {
        if(!p.Available||Health<=0||State=="hidden"||p.At.Distance(Position)>2.5||!Sight(p.At,Position))return false;
        if(swings.TryGetValue(p.Id,out double last)&&now-last<.8)return false;
        swings[p.Id]=now;Health=Math.Max(0,Health-15);Target=State=="shield"?0:p.Id;
        // A blow while he holds someone makes him drop them: a friend can free a grabbed player.
        if(Health==0)Set("death");else if(State is not ("attack" or "shield"))Set("hit");return true;
    }
    public void Step(double dt,bool night,IReadOnlyList<Player> players)
    {
        dt=Math.Clamp(dt,0,.1);now+=dt;StateTime+=dt;routeAge+=dt;
        Unstick();
        if(Health<=0){Set("death");return;}
        // A leap is finished whatever happens around him: nothing turns him back in mid-air.
        if(State=="jump")
        {
            // Crouch in place, then fly from take-off to landing; a short landing crouch before walking on.
            double u=Math.Clamp((StateTime-JumpTakeoff)/(JumpTime-JumpTakeoff-.12),0,1);
            Position=new(jumpFrom.X+(jumpTo.X-jumpFrom.X)*u,jumpFrom.Z+(jumpTo.Z-jumpFrom.Z)*u);
            if(StateTime>=JumpTime){Position=jumpTo;route=null;Set(jumpThen);}
            return;
        }
        if(!night)
        {
            Target=0;
            if(Position.Distance(Home)<.45){Set("hidden");return;}
            Set("retreat");Move(Home,RunSpeed,dt,true);return;
        }
        if(State=="shield"||Light(Position)>=SafeLight)
        {
            // Out of the light by the shortest way: shield his eyes and grope toward the nearest dark spot he can reach.
            if(State!="shield"||Light(shieldGoal)>=SafeLight) { bool entering=State!="shield";if(entering)Set("shield");if(entering||now-darkPicked>.5)shieldGoal=DarkGoal(); }
            Target=0;calmUntil=now+1.2;
            // Re-choose at most twice a second: each choice tries real routes.
            bool moved=Position.Distance(shieldGoal)>=.55&&Move(shieldGoal,ShieldSpeed,dt,true);
            if(!moved&&now-darkPicked>.5){shieldGoal=DarkGoal();route=null;}
            // Out only once clearly dark: at the very edge of a lamp's pool he would flicker in and out.
            if(Light(Position)<SafeLight*.8&&StateTime>.8)Set("walk");
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
        if(State=="grab")
        {
            var prey=players.FirstOrDefault(p=>p.Id==Target&&p.Available);
            if(Held==0&&!contacted&&prey!=null)
            {
                Yaw=Math.Atan2(prey.At.X-Position.X,prey.At.Z-Position.Z);
                if(Position.Distance(prey.At)>1.8)Move(prey.At,Target<0?RunSpeed*.7:LungeSpeed,dt,false);
                if(State!="grab")return;
            }
            if(!contacted&&StateTime>=GrabContact)
            {
                contacted=true;
                if(prey!=null&&prey.At.Distance(Position)<GrabRange&&Light(prey.At)<SafeLight&&Sight(Position,prey.At)&&Math.Cos(Math.Atan2(prey.At.X-Position.X,prey.At.Z-Position.Z)-Yaw)>.5)Held=prey.Id;
            }
            if(contacted&&Held==0&&StateTime>=GrabContact+.6){Set("idle");return;}
            if(Held!=0&&StateTime>=GrabRelease)Release(ThrowDistance,true);
            if(StateTime>=GrabDuration)Set("idle");
            return;
        }
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
            if(Position.Distance(target.At)<=AttackRange){Set(grabNext?"grab":"attack");grabNext=!grabNext;return;}
            if(fresh&&State!="run"&&now-noticedAt>=NoticeRest&&Position.Distance(target.At)>=NoticeDistance){noticedAt=now;Set("notice");return;}
            Set("run");if(!Move(target.At,RunSpeed,dt,false)&&State!="shield")Roam(dt);return;
        }
        Target=0;
        if(Hunt(dt))return;
        if(State=="eat")
        {
            if(StateTime<EatTime)return;
            if(Meal is {} meal&&meal.StartsWith("food:"))fed[meal[5..]]=now;
            Meal=null;Set("walk");
        }
        if(Forage(dt))return;
        Roam(dt);
    }
    /// <summary>A cat or dog near and in the dark: run it down; within reach, seize it and eat it.</summary>
    private bool Hunt(double dt)
    {
        if(State=="eat"&&Meal?.StartsWith("beast:")==true){if(StateTime<EatTime)return true;Meal=null;Set("walk");}
        var prey=Beasts().Where(b=>!Eaten.Contains(b.Id)&&b.At.Distance(Position)<HuntRange&&Light(b.At)<SafeLight&&Reach(b.At)&&Sight(Position,b.At))
            .OrderBy(b=>b.Id==Prey?0:1).ThenBy(b=>b.At.Distance(Position)).FirstOrDefault();
        if(prey==null){Prey=null;return false;}
        Prey=prey.Id;Yaw=Math.Atan2(prey.At.X-Position.X,prey.At.Z-Position.Z);
        if(prey.At.Distance(Position)<=SeizeRange)
        {
            Meal="beast:"+prey.Id;Eaten.Add(prey.Id);Prey=null;Set("eat");Meal="beast:"+prey.Id;return true;
        }
        Set("run");if(!Move(prey.At,RunSpeed*.9,dt,false)&&State!="shield"){Prey=null;return false;}
        return true;
    }
    /// <summary>The best food place he can reach in the dark: worth over distance, none eaten from lately.</summary>
    private bool Forage(double dt)
    {
        if(Foods.Count==0)return false;
        // Near beats far: every 15 m of walking costs half the gap between fish (worth 3) and grain (worth 1).
        var best=Foods.Where(f=>now-fed.GetValueOrDefault(f.Id,-FoodRest)>=FoodRest&&Light(f.Stand)<SafeLight*.7&&Clear(f.Stand))
            .OrderByDescending(f=>f.Worth-f.Stand.Distance(Position)/15-(f.Id==goingFor?0:.3)).FirstOrDefault();
        if(best==null){goingFor=null;return false;}
        goingFor=best.Id;
        if(Position.Distance(best.Stand)<1.1)
        {
            Yaw=Math.Atan2(best.At.X-Position.X,best.At.Z-Position.Z);Set("eat");Meal="food:"+best.Id;return true;
        }
        Set("walk");
        // A stuck step now and then is no reason to give a place up; three in a row and he tries elsewhere a while.
        if(!Move(best.Stand,WalkSpeed,dt,false)&&State!="shield")
        {
            if(++stuck>=3){fed[best.Id]=now-FoodRest+60;goingFor=null;stuck=0;}
            return false;
        }
        stuck=0;return true;
    }
    /// <summary>Start a leap toward `toward` over the obstacle ahead, if there is street to land on beyond it.</summary>
    private bool Leap(Point toward)
    {
        if(State is "jump" or "attack" or "grab" or "shield")return false;
        double d=Position.Distance(toward);if(d<1e-3)return false;
        var dir=new Point((toward.X-Position.X)/d,(toward.Z-Position.Z)/d);
        bool over=false;
        for(double r=.3;r<=AntigoonReach.JumpDepth+1.6;r+=.25)
        {
            var p=new Point(Position.X+dir.X*r,Position.Z+dir.Z*r);
            if(Jumpable(p)){over=true;continue;}
            if(!Clear(p))return false;
            // Land a little beyond the obstacle, on street he can stand on.
            if(over){jumpFrom=Position;jumpTo=new(p.X+dir.X*.6,p.Z+dir.Z*.6);if(!Clear(jumpTo))jumpTo=p;jumpThen=State is "run" or "retreat"?State:"walk";Yaw=Math.Atan2(dir.X,dir.Z);Set("jump");return true;}
        }
        return false;
    }
    private Point progressAt;private double progressTime;
    /// <summary>
    /// Safety net: meaning to walk but not 30 cm further in 4 s, he gives his goal up, leaves leaps and targets alone
    /// for a moment and walks on to his next spot. Whatever blocks him, he never stands frozen.
    /// </summary>
    private void Unstick()
    {
        if(State is not ("walk" or "run")){progressAt=Position;progressTime=now;return;}
        if(Position.Distance(progressAt)>.3){progressAt=Position;progressTime=now;return;}
        if(now-progressTime<4)return;
        progressAt=Position;progressTime=now;route=null;noLeapUntil=now+8;calmUntil=now+3;patrolIndex++;Prey=null;
        if(goingFor!=null){fed[goingFor]=now-FoodRest+60;goingFor=null;}
    }
    private Point DarkGoal()
    {
        darkPicked=now;
        // A lit square can be wide: look up to 25 m out, and go for real darkness, not the dimmest lit spot nearby.
        var spots=new List<Point>(Patrol);
        foreach(double r in new[]{3.0,6,10,15,20,25})for(int i=0;i<16;i++){double a=i*Math.PI/8;spots.Add(new(Position.X+Math.Sin(a)*r,Position.Z+Math.Cos(a)*r));}
        var open=spots.Where(p=>p.Distance(Position)>1.5&&Clear(p)).Select(p=>(At:p,Lit:Light(p))).ToList();
        var dark=open.Where(p=>p.Lit<SafeLight*.7).OrderBy(p=>p.At.Distance(Position)).Concat(open.OrderBy(p=>p.Lit+.01*p.At.Distance(Position)));
        foreach(var p in dark.Take(10))
            if(Path(Position,p.At) is {Count:>0})return p.At;
        return RoamGoal();
    }
    private Point RoamGoal()=>Patrol.Count>0?Patrol[patrolIndex%Patrol.Count]:new(Position.X+Math.Sin(Yaw)*3,Position.Z+Math.Cos(Yaw)*3);
    private void Roam(double dt)
    {
        // Move straight through reached waypoints and immediately skip unusable routes.
        for(int i=0;i<Patrol.Count;i++)
        {
            var goal=RoamGoal();
            // A patrol spot a lamp now lights is no place for him: pass it by.
            if(Position.Distance(goal)<.55||Light(goal)>=SafeLight){patrolIndex++;route=null;continue;}
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
        {
            route=Path(Position,goal);routeGoal=goal;routeAge=0;routeIndex=0;
            // A fresh route starts on the grid spot nearest him, which may lie behind: never step back to it.
            // Only that first spot is passed over, never a corner further on: cutting a corner walks into the wall.
            if(route!=null&&route.Count>1&&Position.Distance(route[0])<1.0&&Position.Distance(route[1])<=route[0].Distance(route[1])+.05)routeIndex=1;
        }
        if(route==null||route.Count==0)return false;
        while(routeIndex<route.Count-1&&Position.Distance(route[routeIndex])<.6)routeIndex++;
        // Into a sharp corner he slows, as a walker does, so his body comes round with his path.
        double bearing=Math.Atan2(route[routeIndex].X-Position.X,route[routeIndex].Z-Position.Z);
        double gap=Math.IEEERemainder(bearing-heading,2*Math.PI);heading+=Math.Clamp(gap,-3*dt,3*dt);
        double corner=Math.Abs(Math.IEEERemainder(bearing-heading,2*Math.PI));
        if(corner>.5)speed*=Math.Max(.25,1-(corner-.5)/2);
        // He goes where his body points; heading straight at the next spot would slide him sideways round a corner.
        var along=new Point(Position.X+Math.Sin(heading)*speed*dt,Position.Z+Math.Cos(heading)*speed*dt);
        Point next=corner<.3?Position.Toward(route[routeIndex],speed*dt):along;
        // Heading into a wall at a corner: slow to a third and swing round onto the route, rather than give the step up.
        if(!Clear(next)){heading+=Math.Clamp(Math.IEEERemainder(bearing-heading,2*Math.PI),-6*dt,6*dt);next=Position.Toward(route[routeIndex],speed*.33*dt);}
        if(!Clear(next))
        {
            if(Jumpable(next)&&Leap(route[routeIndex]))return true;
            // A leap he cannot make (no street to land on in line): route round without leaps for a while.
            if(Jumpable(next))noLeapUntil=now+8;
            route=null;return false;
        }
        if(!allowLight&&Light(next)>=SafeLight)
        {shieldGoal=Light(goal)<SafeLight?goal:DarkGoal();Target=0;Set("shield");return false;}
        if(Position.Distance(next)>1e-5)Yaw=heading;
        bool moved=Position.Distance(next)>1e-5;Position=next;return moved;
    }
}

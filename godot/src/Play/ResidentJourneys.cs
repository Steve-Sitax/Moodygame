using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Town;
namespace Scheldemist.Play;

/// <summary>journeys.ts: named schedule travellers use a real free resident seat and walk on at their destination.</summary>
[GamePart(232)]
public partial class ResidentJourneys:Node
{
    public static ResidentJourneys? I {get;private set;}
    public sealed class Trip
    {
        public Townspeople.Sim Person=null!;public Vector2 To;public string Key="",Phase="tostop";
        public OmnibusLines.Stop Board=null!,Alight=null!;public Omnibus.Bus? Bus;
        public double Time,Go,Wait;public float Best=float.PositiveInfinity;public double Stuck;
    }
    public readonly List<Trip> Trips=new();
    public int Boarded {get;private set;}public int Alighted {get;private set;}public int Finished {get;private set;}public int WalkFallbacks {get;private set;}
    private Townspeople town=null!;
    public override void _Ready(){I=this;town=GetParent().GetNode<Townspeople>("Townspeople");Omnibus.I.ResidentOff+=Off;if(Menu.MainMenu.I is {} m)m.WorldReplaced+=Replaced;}
    public override void _ExitTree(){Omnibus.I.ResidentOff-=Off;if(Menu.MainMenu.I is {} m)m.WorldReplaced-=Replaced;Reset();I=null;}
    private void Replaced(string how,Net.ClientState? state)=>Reset();
    private void Reset(){while(Trips.Count>0)End(Trips[^1],false);}
    public bool Begin(Townspeople.Sim s,string previous)
    {
        if(s.ActionHeld||s.MillRun||Net.Mp.Together.I?.Guest==true)return false;
        // Sellers' loaded carts take precedence in transport.ts; a load must never become a bus trip.
        if(s.R.Trade is "market_woman" or "fishwife" or "grocer" or "dealer" && (previous.StartsWith("home")&&s.Key.StartsWith("work")||previous.StartsWith("work")&&s.Key.StartsWith("home")))return false;
        var to=town.Anchor(s);var plan=Plan(new((float)s.X,(float)s.Z),new((float)to.X,(float)to.Z));if(plan==null)return false;
        return Start(s,new((float)to.X,(float)to.Z),plan.Value.Board,plan.Value.Alight);
    }
    public (OmnibusLines.Stop Board,OmnibusLines.Stop Alight)? Plan(Vector2 from,Vector2 to)
    {
        // server/town/transport.ts: WALK_MAX_M, STOP_NEAR_M, DETOUR, SPEED and BUS_PATIENCE.
        float dist=from.DistanceTo(to);if(dist<=300)return null;double best=double.PositiveInfinity;
        (OmnibusLines.Stop Board,OmnibusLines.Stop Alight)? result=null;
        foreach(var a in OmnibusLines.Stops){double wa=from.DistanceTo(new(a.X,a.Z));if(wa>170)continue;
            foreach(var b in OmnibusLines.Stops){if(a.Line!=b.Line||a.Id==b.Id)continue;double wb=to.DistanceTo(new(b.X,b.Z));if(wb>170)continue;
                double walkA=wa*1.35/1.3,secs=walkA+Math.Max(walkA,WaitAt(a))+new Vector2(a.X,a.Z).DistanceTo(new(b.X,b.Z))*1.5/3.2+wb*1.35/1.3;
                if(secs>dist*1.35/1.3*1.25||secs>=best)continue;best=secs;result=(a,b);}}
        return result;
    }
    private double WaitAt(OmnibusLines.Stop stop)
    {
        double best=9999;OmnibusLines.Line? line=null;
        for(int i=0;i<Omnibus.I.Buses.Count;i++){var bus=Omnibus.I.Buses[i];if(bus.Line.Id!=stop.Line)continue;line=bus.Line;
            foreach(var at in bus.StopAt)if(at.Stop.Id==stop.Id)best=Math.Min(best,bus.At?.Id==stop.Id?0:bus.Loop.Wrap(at.S-bus.S)/2.6);}
        if(line!=null)best=Math.Max(best,(OmnibusLines.Due(line,stop.Id,(town.Day-1)*1440+town.Hour*60)-((town.Day-1)*1440+town.Hour*60))*2-20);
        return best;
    }
    public bool Start(Townspeople.Sim s,Vector2 to,OmnibusLines.Stop board,OmnibusLines.Stop alight)
    {
        if(s.ActionHeld||board.Line!=alight.Line||board.Id==alight.Id||!town.ActionHold(s,this))return false;
        Trips.Add(new(){Person=s,To=to,Key=s.Key,Board=board,Alight=alight});return true;
    }
    private void Off(Omnibus.Bus bus,string id,Vector3 foot)
    {foreach(var t in Trips)if(t.Person.R.Id==id&&t.Bus==bus){t.Bus=null;t.Phase="walkon";t.Time=0;t.Person.X=foot.X;t.Person.Z=foot.Z;town.ActionOutside(t.Person);Alighted++;return;}}
    private void End(Trip t,bool arrived)
    {Omnibus.I.RemoveResident(t.Person.R.Id);Trips.Remove(t);if(arrived)Finished++;town.ActionOutside(t.Person);town.ActionRelease(t.Person,this);}
    private bool Walk(Trip t,Vector2 to,double dt)
    {
        var s=t.Person;float distance=new Vector2((float)s.X,(float)s.Z).DistanceTo(to);if(distance<1.6)return true;
        if(distance<t.Best-.15f){t.Best=distance;t.Stuck=0;}else t.Stuck+=dt;
        if(t.Stuck>45){WalkFallbacks++;End(t,false);return false;}
        if(s.P==null){town.ActionMoveHidden(s,to.X,to.Y,6*dt);if(Whereabouts.Hypot(s.X-Main.I.Cam.GlobalPosition.X,s.Z-Main.I.Cam.GlobalPosition.Z)<55)town.ActionClaim(s);}
        if(s.P is {} p){s.X=p.X;s.Z=p.Z;if((t.Go-=dt)<=0||!town.Crowd!.PuppetBusy(p)){t.Go=1.2;town.Crowd!.PuppetGo(p,to.X,to.Y,1.3);}}
        return false;
    }
    public override void _Process(double delta)
    {
        if(!(GameState.I.Playing||Player.Jef.I.TestInput))return;double dt=Math.Min(delta,.1);
        for(int i=Trips.Count-1;i>=0;i--){var t=Trips[i];var s=t.Person;
            if(!ReferenceEquals(s.ActionOwner,this)){Omnibus.I.RemoveResident(s.R.Id);Trips.RemoveAt(i);continue;}t.Time+=dt;
            if(t.Phase=="bus"){if(t.Bus!=null){s.X=t.Bus.Pa.X;s.Z=t.Bus.Pa.Y;}continue;}
            if(t.Phase=="walkon"){if(Walk(t,t.To,dt))End(t,true);continue;}
            if(t.Phase=="tostop"){if(Walk(t,Omnibus.WaitingAt(t.Board),dt)){t.Phase="wait";t.Time=0;t.Stuck=0;t.Best=float.PositiveInfinity;if(s.P is {} p)town.Crowd!.PuppetStand(p,"idle",Math.Atan2(t.Board.X-p.X,t.Board.Z-p.Z));}continue;}
            t.Wait+=dt;if(t.Wait>300){t.Phase="walkon";WalkFallbacks++;continue;}
            for(int k=0;k<Omnibus.I.Buses.Count;k++){var bus=Omnibus.I.Buses[k];if(bus.At?.Id!=t.Board.Id||bus.Line.Id!=t.Board.Line||!Omnibus.I.BoardResident(bus,s.R.Id,s.Kind,t.Alight.Id))continue;
                town.ActionInside(s,s.X,s.Z);t.Bus=bus;t.Phase="bus";Boarded++;break;}
        }
    }
}

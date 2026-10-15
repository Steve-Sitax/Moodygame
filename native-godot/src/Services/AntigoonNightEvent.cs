using System;
using System.Collections.Generic;
using System.Linq;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Services;

/// <summary>Host-owned street panic, pursuit selection and timed rock impacts.</summary>
public sealed class AntigoonNightEvent
{
    public sealed record Witness(string Id,P At,P Home);
    public sealed record Lamp(string Id,P At,double Height);
    public sealed class Resident
    {
        public string Id="",Phase="flee"; public int TargetId,Scream;
        public P At,Home; public double Yaw,Time,RouteAge; public IReadOnlyList<P>? Route; public int Corner;
        /// <summary>A throw: where the flight starts and lands, and whether a wall stopped it.</summary>
        public P From,To; public bool Wall; public int Throw;
    }
    public const double FlightTime=.85, Sprawl=2.2;
    public sealed record Rock(int Serial,string Lamp,P From,P To,double Height,double Started,double Release,double Impact);
    public readonly Dictionary<string,Resident> Residents=new();
    public readonly List<Rock> Rocks=new();
    public Func<P,P,IReadOnlyList<P>?> HumanPath=(_,b)=>new[]{b};
    public Func<P,bool> HumanClear=_=>true;
    public Func<IReadOnlyList<Lamp>> Lamps=()=>Array.Empty<Lamp>();
    public Action<string>? Extinguish;
    public double Now {get;private set;}
    private double chaseAt=5,throwAt=3;
    private int identity,serial,screams;
    private int selected;
    private readonly Dictionary<string,double> immunity=new();
    public bool Owns(string id)=>Residents.ContainsKey(id);
    public void KnockDown(int target)
    {
        var person=Residents.Values.FirstOrDefault(p=>p.TargetId==target);
        if(person==null||person.Phase!="flee")return;
        person.Phase="down";person.Time=0;person.Scream=++screams;
        selected=0;chaseAt=Now+18;
    }
    /// <summary>The thrown resident flies from his fist to the landing spot, lies sprawled, then gets up.</summary>
    public void Thrown(AntigoonBrain.Throw t)
    {
        var person=Residents.Values.FirstOrDefault(p=>p.TargetId==t.Victim);if(person==null)return;
        person.Phase="thrown";person.Time=0;person.From=t.From;person.To=t.To;person.Wall=t.Wall;person.Throw=t.Serial;person.At=t.From;person.Scream=++screams;
        person.Yaw=Math.Atan2(t.To.X-t.From.X,t.To.Z-t.From.Z);selected=0;chaseAt=Now+18;
    }
    public void Step(double dt,bool night,AntigoonBrain giant,IReadOnlyList<Witness> witnesses)
    {
        Now+=dt;
        // A resident in his fist hangs where his hand is.
        foreach(var p in Residents.Values)
        {
            if(giant.Held==p.TargetId&&p.Phase is "flee" or "held"){p.Phase="held";p.At=new(giant.Position.X+Math.Sin(giant.Yaw)*.9,giant.Position.Z+Math.Cos(giant.Yaw)*.9);p.Yaw=giant.Yaw+Math.PI;}
        }
        Rocks.RemoveAll(r=>Now<r.Release&&giant.State!="throw");
        foreach(var rock in Rocks.Where(r=>Now>=r.Impact).ToArray()) {Extinguish?.Invoke(rock.Lamp);Rocks.Remove(rock);}
        bool active=night&&giant.Health>0&&giant.State!="hidden";
        if(active)foreach(var w in witnesses)
        {
            if(Residents.Count>=24)break;
            if(Residents.ContainsKey(w.Id)||immunity.GetValueOrDefault(w.Id)>Now||w.At.Distance(giant.Position)>22||!giant.Sight(w.At,giant.Position))continue;
            Residents[w.Id]=new(){Id=w.Id,TargetId=--identity,At=w.At,Home=w.Home,Scream=++screams};
        }
        foreach(var p in Residents.Values.ToArray())
        {
            p.Time+=dt;p.RouteAge+=dt;
            if(p.Phase=="held")continue;
            if(p.Phase=="thrown")
            {
                double u=Math.Min(1,p.Time/FlightTime);p.At=new(p.From.X+(p.To.X-p.From.X)*u,p.From.Z+(p.To.Z-p.From.Z)*u);
                if(p.Time>=FlightTime+Sprawl){p.Phase="down";p.Time=0;}
                continue;
            }
            if(p.Phase=="down") {if(p.Time>=3&&(!active||p.At.Distance(giant.Position)>14)){p.Phase="rise";p.Time=0;}continue;}
            if(p.Phase=="rise") {if(p.Time>=1.4){p.Phase="flee";p.Time=0;p.Route=null;}continue;}
            if(p.Phase=="home") {if(p.Time>=8){Residents.Remove(p.Id);immunity[p.Id]=Now+90;}continue;}
            if(p.At.Distance(p.Home)<.85){p.Phase="home";p.Time=0;continue;}
            // Real paths to real home thresholds; no straight-line wall crossing.
            if(p.Route==null||p.RouteAge>3){p.Route=HumanPath(p.At,p.Home);p.Corner=0;p.RouteAge=0;}
            if(p.Route is {Count:>0})
            {
                while(p.Corner<p.Route.Count-1&&p.At.Distance(p.Route[p.Corner])<.2)p.Corner++;
                var next=p.At.Toward(p.Route[p.Corner],3.2*dt);
                if(HumanClear(next)){if(next.Distance(p.At)>.0001)p.Yaw=Math.Atan2(next.X-p.At.X,next.Z-p.At.Z);p.At=next;}
                else p.Route=null;
            }
        }
        var victim=Residents.Values.FirstOrDefault(p=>p.TargetId==selected);
        if(victim==null||victim.Phase!="flee"||giant.State=="shield"||!giant.Reach(victim.At)||giant.Light(victim.At)>=AntigoonBrain.SafeLight||!giant.Sight(giant.Position,victim.At)||!active||giant.State=="idle"&&victim.At.Distance(giant.Position)>AntigoonBrain.AttackRange)
        {if(selected!=0)chaseAt=Now+12;selected=0;}
        if(active&&giant.State!="shield"&&selected==0&&Now>=chaseAt)
        {
            var choices=Residents.Values.Where(p=>p.Phase=="flee"&&p.At.Distance(giant.Position)<24&&giant.Light(p.At)<AntigoonBrain.SafeLight&&giant.Reach(p.At)&&giant.Sight(giant.Position,p.At)).OrderBy(p=>p.At.Distance(giant.Position)).ToArray();
            if(choices.Length>0)selected=choices[(serial+screams)%choices.Length].TargetId;
            chaseAt=Now+18;
        }
        if(!active||Now<throwAt||selected!=0||giant.State is "attack" or "hit" or "retreat" or "recoil_light" or "throw" or "shield")return;
        var lamp=Lamps().Where(l=>l.At.Distance(giant.Position) is >=7 and <=26&&giant.Sight(giant.Position,l.At)).OrderBy(l=>l.At.Distance(giant.Position)).FirstOrDefault();
        throwAt=Now+(lamp==null?4:14);
        if(lamp!=null&&giant.BeginThrow(lamp.At))
            Rocks.Add(new(++serial,lamp.Id,giant.Position,lamp.At,lamp.Height,Now,Now+.7,Now+.7+Math.Max(.35,lamp.At.Distance(giant.Position)/16)));
    }
    public AntigoonBrain.Player[] Targets()=>Residents.Values.Where(p=>p.TargetId==selected&&p.Phase=="flee").Select(p=>new AntigoonBrain.Player(p.TargetId,p.At)).ToArray();
}

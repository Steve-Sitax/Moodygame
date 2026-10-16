using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.Services;

/// <summary>
/// The story's staged sighting (chapter 1): a scrape at a dark junction ahead of Jef, then the giant crosses it from
/// cover to cover below the roofline and walks on, out of sight, towards the river. He never attacks or targets
/// anyone here; he appears and goes only behind real cover, and only while Jef plays alone. The developer event's
/// brain takes precedence when it runs.
/// </summary>
public sealed partial class NativeAntigoon
{
    /// <summary>For a player: the junction where the story's sighting may play now, and where he walks off to.</summary>
    public Func<int,(P Junction,P Goal)?> StoryWanted=_=>null;
    /// <summary>What the player met: "staged", "scrape", "figure", "steps".</summary>
    public Action<int,string>? StoryWitnessed;
    /// <summary>(junction, eye, goal): a crossing hidden at both ends from the eye, and a hidden walk on towards goal.</summary>
    public Func<P,P,P,(IReadOnlyList<P> Cross,IReadOnlyList<P> Tail)?> StageAt=(_,_,_)=>null;
    /// <summary>(eye, giant): can an eye at a man's height see any part of him (legs, chest or head)?</summary>
    public Func<P,P,bool> BodyVisible=(_,_)=>false;
    /// <summary>Is there a roof over this spot (a hall or church floor his map may include)? Sightings stay out of doors.</summary>
    public Func<P,bool> Roofed=_=>false;
    public const double SightingNear=26, SightingFar=44, CrossSpeed=1.9, ScrapePause=1.4;
    private readonly Dictionary<int,double> facing=new();
    private sealed class Crossing
    {
        public List<P> Route=new(); public int TailFrom; public double Along,Time,Seen,Look,Step; public P At; public double Yaw;
        public P Junction; public bool Going,Hidden,Figure; public int Steps,Sound; public string SoundKind=""; public P SoundAt;
    }
    private Crossing? crossing;
    private double stageTry;
    private int sounds;
    private void Face(NativeServiceRequest r){if(r.Body["yaw"] is JsonValue v&&v.TryGetValue<double>(out var yaw)&&double.IsFinite(yaw))facing[r.PlayerId]=yaw;}
    private static double Length(IReadOnlyList<P> path){double sum=0;for(int i=1;i<path.Count;i++)sum+=path[i].Distance(path[i-1]);return sum;}
    private void StoryStep(double dt)
    {
        if(host.MultiplayerEnabled()||developmentEnabled){crossing=null;return;}
        var eye=PositionOf(1);
        if(crossing==null){if(dt>0)TryStage(dt,eye);return;}
        var c=crossing;c.Time+=dt;
        // Seen: in Jef's view cone, not hidden by any wall, near enough to make out in the dark.
        if((c.Look-=dt)<=0&&eye is {} e)
        {
            c.Look=.2;
            bool seen=!c.Hidden&&e.Distance(c.At)<55&&InView(1,e,c.At,55)&&BodyVisible(e,c.At);
            if(seen){c.Seen+=.2;if(c.Seen>=.6&&!c.Figure){c.Figure=true;StoryWitnessed?.Invoke(1,"figure");}}
            // Past the far corner and out of every line of sight: from now on only his steps are left.
            if(!c.Hidden&&(Segment(c)>=c.TailFrom||c.Along>=Length(c.Route))&&!BodyVisible(e,c.At))c.Hidden=true;
        }
        // He stands in cover after the scrape until Jef looks towards the junction, or a few breaths have passed.
        if(!c.Going)
        {
            if(c.Time<ScrapePause||c.Time<7&&!(eye is {} look&&InView(1,look,c.Junction,50)))return;
            c.Going=true;
        }
        double total=Length(c.Route);
        if(c.Along<total)
        {
            c.Along=Math.Min(total,c.Along+CrossSpeed*dt);var next=PointAt(c.Route,c.Along);
            if(next.Distance(c.At)>1e-5)c.Yaw=Math.Atan2(next.X-c.At.X,next.Z-c.At.Z);c.At=next;
        }
        if(c.Hidden&&(c.Step-=dt)<=0)
        {
            c.Step=.62;Sound(c,"step");
            if(eye is {} heard&&heard.Distance(c.At)<55&&++c.Steps==3)StoryWitnessed?.Invoke(1,"steps");
        }
        // The walk is over once he is out of sight at its end; if Jef still sees him there, he waits there, breathing.
        if(c.Along>=total&&(c.Hidden||eye==null))crossing=null;
    }
    private void TryStage(double dt,P? eye)
    {
        if((stageTry-=dt)>0||eye is not {} e||!Available(1)||!facing.ContainsKey(1))return;
        stageTry=1.5;
        if(StoryWanted(1) is not {} want)return;
        double d=e.Distance(want.Junction);if(d<SightingNear||d>SightingFar)return;
        // Staging searches real routes under the state lock: after a miss from here, wait longer before the next try.
        if(StageAt(want.Junction,e,want.Goal) is not {} stage||stage.Cross.Count<2){stageTry=5;return;}
        var route=stage.Cross.ToList();route.AddRange(stage.Tail.Skip(1));
        var c=new Crossing{Route=route,TailFrom=stage.Cross.Count-1,At=route[0],Junction=want.Junction};c.Yaw=Math.Atan2(route[1].X-c.At.X,route[1].Z-c.At.Z);
        crossing=c;StoryWitnessed?.Invoke(1,"staged");
        // A shoulder drags along a wall in the dark: the sound that turns Jef's head, before anything is seen.
        Sound(c,"scrape");if(e.Distance(c.At)<60)StoryWitnessed?.Invoke(1,"scrape");
    }
    private void Sound(Crossing c,string kind){c.Sound=++sounds;c.SoundKind=kind;c.SoundAt=c.At;}
    private bool InView(int player,P eye,P at,double degrees)
    {
        if(!facing.TryGetValue(player,out var yaw))return false;
        double d=eye.Distance(at);if(d<1e-3)return true;
        return ((at.X-eye.X)*-Math.Sin(yaw)+(at.Z-eye.Z)*-Math.Cos(yaw))/d>=Math.Cos(degrees*Math.PI/180);
    }
    private static int Segment(Crossing c){double left=c.Along;for(int i=1;i<c.Route.Count;i++){double l=c.Route[i].Distance(c.Route[i-1]);if(left<=l)return i-1;left-=l;}return c.Route.Count-1;}
    private static P PointAt(IReadOnlyList<P> route,double along)
    {
        for(int i=1;i<route.Count;i++){double l=route[i].Distance(route[i-1]);if(along<=l)return route[i-1].Toward(route[i],along);along-=l;}
        return route[^1];
    }
    /// <summary>The crossing in the shared view, when no developer brain is out. Never a development spawn: no locator.</summary>
    private void StoryView(JsonObject v,int player)
    {
        v["story_near"]=player==1&&!host.MultiplayerEnabled()&&StoryWanted(1) is {} want&&PositionOf(1) is {} eye&&eye.Distance(want.Junction)<90;
        if(crossing is not {} c||brain!=null||player!=1)return;
        bool walking=c.Going&&c.Along<Length(c.Route);
        v["active"]=!c.Hidden;v["x"]=c.At.X;v["y"]=Ground(c.At);v["z"]=c.At.Z;v["yaw"]=c.Yaw;v["health"]=120;
        v["state"]=walking?"walk":"idle";v["state_time"]=c.Time;v["attack_serial"]=0;v["target"]=0;v["kicked"]=0;
        if(c.Sound>0)v["story_sound"]=new JsonObject{["serial"]=c.Sound,["kind"]=c.SoundKind,["x"]=c.SoundAt.X,["y"]=Ground(c.SoundAt)+(c.SoundKind=="scrape"?2.6:.1),["z"]=c.SoundAt.Z};
    }
}

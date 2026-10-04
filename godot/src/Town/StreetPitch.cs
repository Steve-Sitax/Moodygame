using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;
namespace Scheldemist.Town;

public partial class Townspeople
{
    private sealed class ChalkPitch
    {
        public double X,Z,Yaw,Clock,Hop,Poll;
        public bool Ready;
        public ulong Frame;
        public readonly List<Sim> Line=new(12);
        public Node3D Root=null!,Marbles=null!;
    }
    private readonly Dictionary<string,ChalkPitch?> chalkPitches=new();
    private readonly List<Sim> gameRoster=new(16);
    private ChalkPitch? Pitch(string id)
    {
        if(chalkPitches.TryGetValue(id,out var old))return old;
        if(Place(id) is not {} pl||Walk==null)return null;
        double yaw=LifeHash(id+":yaw")*Math.PI;
        for(double d=2;d<Math.Max(8,pl.R);d+=1.5)for(int k=0;k<12;k++)
        {
            double a=k/12.0*Math.PI*2+LifeHash(id)*6,x=pl.X+Math.Cos(a)*d,z=pl.Z+Math.Sin(a)*d;
            bool clear=true;
            for(int dx=-4;dx<=4&&clear;dx++)for(int dz=-4;dz<=4&&clear;dz++)clear=Walk.Free(x+dx,z+dz);
            if(!clear)continue;
            var root=new Node3D{Name="chalk_pitch_"+id,Position=new((float)x,(float)Walk.BaseAt(x,z),(float)z)};
            var model=ModelLibrary.Get("lively",LifeLook)!;
            var hop=model.Copy("chalk_hop");if(hop!=null){hop.Position=new(0,.02f,0);hop.Rotation=new(0,(float)yaw,0);root.AddChild(hop);}
            var ring=model.Copy("chalk_ring");if(ring!=null){ring.Position=new((float)Math.Cos(yaw)*3.2f,.02f,(float)-Math.Sin(yaw)*3.2f);root.AddChild(ring);}
            var marbles=model.Copy("marbles")??new Node3D();marbles.Position=new((float)Math.Cos(yaw)*3.2f,.005f,(float)-Math.Sin(yaw)*3.2f);marbles.Visible=false;root.AddChild(marbles);
            Main.I.View.AddChild(root);var pitch=new ChalkPitch{X=x,Z=z,Yaw=yaw,Root=root,Marbles=marbles};chalkPitches[id]=pitch;return pitch;
        }
        chalkPitches[id]=null;return null;
    }
    private string ActualGame(Sim s)
    {
        string kind=GameOf(s);if(kind!="rope")return kind;
        int n=0;foreach(var q in sims)if(q.P is {} p&&p.Human.Scale<.9&&!q.ActionHeld&&q.Goal.Mode=="play"&&q.Goal.Place==s.Goal.Place&&GameOf(q)=="rope")n++;
        return n<3?"hopscotch":"rope";
    }
    private bool ChalkStep(Sim s,string kind,double dt)
    {
        string id=s.Goal.Place??"";var r=Pitch(id);if(r==null)return false;
        var p=s.P!;
        if(r.Frame!=Engine.GetProcessFrames())
        {
            r.Frame=Engine.GetProcessFrames();r.Clock+=dt;r.Marbles.Visible=false;r.Poll-=dt;
            if(r.Poll<=0)
            {
                r.Poll=.5;
                for(int i=r.Line.Count-1;i>=0;i--){var q=r.Line[i];if(q.P==null||q.ActionHeld||q.Goal.Mode!="play"||q.Goal.Place!=id||ActualGame(q)!="hopscotch")r.Line.RemoveAt(i);}
                foreach(var q in sims)if(q.P is {} body&&body.Human.Scale<.9&&!q.ActionHeld&&q.Goal.Mode=="play"&&q.Goal.Place==id&&ActualGame(q)=="hopscotch"&&Dist(body.X,body.Z,r.X,r.Z)<6&&!r.Line.Contains(q))r.Line.Add(q);
            }
            if(r.Ready){r.Hop+=dt;if(r.Hop>=1.2+17*.6){r.Hop=0;r.Ready=false;if(r.Line.Count>1){var first=r.Line[0];r.Line.RemoveAt(0);r.Line.Add(first);}}}
        }
        double fx=Math.Sin(r.Yaw),fz=Math.Cos(r.Yaw),rx=Math.Cos(r.Yaw),rz=-Math.Sin(r.Yaw);
        if(kind=="hopscotch")
        {
            int i=r.Line.IndexOf(s),n=r.Line.Count;
            double Spot(int j)=>j==0?-1.85:-1.5+(j-.5)*3/8;
            if(i==0)
            {
                if(r.Hop<1.2){r.Ready=ReachGame(p,r.X+fx*Spot(0),r.Z+fz*Spot(0),dt);if(r.Ready)Crowd!.PuppetStand(p,"idle",r.Yaw);return true;}
                double v=r.Hop-1.2;int hop=Math.Min(16,(int)(v/.6));double frac=Math.Min(1,(v-hop*.6)/.6),air=Math.Min(1,frac*2),e=air*air*(3-2*air),from,to,yaw=r.Yaw;
                if(hop<8){from=Spot(hop);to=Spot(hop+1);}else if(hop==8){from=to=Spot(8);yaw+=Math.PI*e;}else{from=Spot(17-hop);to=Spot(16-hop);yaw+=Math.PI;}
                double along=from+(to-from)*e,x=r.X+fx*along,z=r.Z+fz*along;
                bool free=Walk!.Free(x,z);foreach(var other in Crowd!.Walking)if(other!=p&&Dist(other.X,other.Z,x,z)<.7)free=false;
                if(Dist(Player.Jef.I.X,Player.Jef.I.Z,x,z)<.8)free=false;
                if(!free){r.Hop-=dt;return true;}
                Crowd.PuppetStand(p,"hop",yaw);p.X=x;p.Z=z;p.Human.SetPhase("hop",(float)frac);return true;
            }
            int q=i<0?n:i-1;double offset=(q-(n-2)/2.0)*.7;
            if(ReachGame(p,r.X-fx*2.6+rx*offset,r.Z-fz*2.6+rz*offset,dt))Crowd!.PuppetStand(p,"idle",r.Yaw);
            return true;
        }
        gameRoster.Clear();foreach(var q in sims)if(q.P is {} body&&body.Human.Scale<.9&&!q.ActionHeld&&q.Goal.Mode=="play"&&q.Goal.Place==id&&ActualGame(q)==kind)gameRoster.Add(q);
        gameRoster.Sort(CompareGamePlayers);
        int slot=Math.Max(0,gameRoster.IndexOf(s)),count=Math.Max(1,gameRoster.Count);
        double angle=r.Yaw+(slot+.5)/count*Math.PI*2,cx=r.X+rx*3.2,cz=r.Z+rz*3.2;
        if(kind=="marbles")r.Marbles.Visible=true;
        if(!ReachGame(p,cx+Math.Sin(angle)*.95,cz+Math.Cos(angle)*.95,dt))return true;
        double face=Math.Atan2(cx-p.X,cz-p.Z);bool mine=(int)(r.Clock/4)%count==slot;
        if((s.Wait-=dt)<=0){Crowd!.PuppetStand(p,mine||LifeHash(s.R.Id+":kneel")<.7?"crouch":"talk",face);s.Wait=3+LifeHash(s.R.Id)*3;}
        if(kind=="tops"&&lifeProps.TryGetValue(s.R.Id,out var kit)&&kit.prop.GetChildCount()>0&&kit.prop.GetChild(0) is Node3D top)
        {
            var at=new Vector3((float)(cx+Math.Sin(angle)*.3+Math.Sin(r.Clock*.7+slot)*.08),(float)Walk!.BaseAt(cx,cz),(float)(cz+Math.Cos(angle)*.3+Math.Cos((r.Clock*.7+slot)*1.3)*.08));
            top.GlobalPosition=at;top.GlobalRotation=new((float)Math.Sin(r.Clock*3)*.12f,(float)(r.Clock*30),0);top.GlobalBasis=top.GlobalBasis.Orthonormalized();
        }
        return true;
    }
    private static int CompareGamePlayers(Sim a,Sim b)=>string.CompareOrdinal(a.R.Id,b.R.Id);
    internal bool HasGamePitch(Sim s)=>Pitch(s.Goal.Place??"")!=null;
    internal bool GameReady(Sim s)
    {
        string kind=ActualGame(s);if(kind=="tag")return true;if(s.P==null||!GamePropDrawn(s))return false;
        if(kind=="hoops")return true;
        if(kind=="rope")return s.P.Human.Motion is "rope" or "hop";
        if(Pitch(s.Goal.Place??"") is not {} r)return false;
        if(kind=="hopscotch")return r.Line.Count>0&&r.Ready;
        return Dist(s.P.X,s.P.Z,r.X+Math.Cos(r.Yaw)*3.2,r.Z-Math.Sin(r.Yaw)*3.2)<1.2&&s.P.Human.Motion is "crouch" or "talk";
    }
    private void ClearChalkPitches(){foreach(var r in chalkPitches.Values)r?.Root.QueueFree();chalkPitches.Clear();}
}

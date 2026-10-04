using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Talks;
namespace Scheldemist.Play;
public partial class LandmarkLife
{
    private sealed class Reaction { public HallPeople.Figure Figure=null!; public double Nod, Look; }
    private readonly Dictionary<string,Reaction> reactions = new();
    private Vector2 lastFeet;
    private bool feetKnown, hushBusy;
    private double runTime, hushClock, hushAt=-100, putOut=-1;
    public HushReply? LastHush { get; private set; }
    public int NodsShown { get; private set; }
    public int LastWitnesses { get; private set; }
    private HallPeople.Hall? Congregation() { if(HallPeople.I!=null) foreach(var h in HallPeople.I.Halls) if(h.Id=="cathedral")return h; return null; }
    private Reaction ReactionOf(HallPeople.Figure f) { if(!reactions.TryGetValue(f.Id,out var r)||r.Figure!=f) reactions[f.Id]=r=new(){Figure=f};return r; }
    private void NodCongregation()
    {
        if(sermon==null || Congregation() is not {} hall)return;
        int present=0;foreach(string id in sermon.Nodders)if(hall.Figures.ContainsKey(id))present++;
        if(present==0)return;
        for(int k=0;k<2;k++){int wanted=(sermonLine*3+k*5)%present,index=0;foreach(string id in sermon.Nodders)if(hall.Figures.TryGetValue(id,out var f)&&index++==wanted){ReactionOf(f).Nod=1.4;NodsShown++;break;}}
    }
    private void WhisperAt(SermonGossip gossip)
    {
        if(Congregation() is not {} hall)return;
        if(hall.Figures.TryGetValue(gossip.Id,out var f)) Bubbles.I?.Say(()=>IsInstanceValid(f.Group)?f.Group.GlobalPosition+Vector3.Up*1.1f:Vector3.Zero,gossip.Name+", in a whisper",gossip.Text);
        if(gossip.To!=null&&hall.Figures.TryGetValue(gossip.To,out var other))ReactionOf(other).Nod=1.4;
    }
    private void ResetIndoor(){Soundscape.I?.Organ(false);reactions.Clear();feetKnown=false;runTime=0;putOut=-1;LastHush=null;NodsShown=0;hushAt=-100;}
    private void UpdateIndoor(double dt)
    {
        hushClock+=dt;
        Soundscape.I?.Organ(here?.Id=="cathedral" && here.State?.Organ==true);
        if(here?.Id=="cathedral" && here.State?.Barred==true && putOut<0){GameState.I.Say("The beadle stands in the doorway, his staff across it. \"Not today, young man. You had your chance.\"");putOut=.01;}
        foreach(var r in reactions.Values)
        {
            if(!IsInstanceValid(r.Figure.Group))continue;
            r.Nod=Math.Max(0,r.Nod-dt); r.Look=Math.Max(0,r.Look-dt);
            var rotation=r.Figure.Group.Rotation;
            rotation.X=r.Nod>0?Math.Max(0,(float)Math.Sin((1.4-r.Nod)*9))*.08f:0;
            if(r.Look>0)rotation.Y=MathF.Atan2(Jef.I.X-r.Figure.Group.GlobalPosition.X,Jef.I.Z-r.Figure.Group.GlobalPosition.Z);
            r.Figure.Group.Rotation=rotation;
        }
        if(putOut>=0 && (putOut-=dt)<=0){putOut=-1;if(here?.Id=="cathedral"){CathedralComfort.I.Stand();Jef.I.Place(-262,144.3f,0);}}
        var feet=new Vector2(Jef.I.X,Jef.I.Z);float speed=feetKnown?feet.DistanceTo(lastFeet)/(float)Math.Max(dt,.001):0;lastFeet=feet;feetKnown=true;
        if(here?.Id!="cathedral"||Jef.I.Riding){runTime=0;return;}
        runTime=speed>2.5f&&speed<12?runTime+dt:Math.Max(0,runTime-dt*2);
        if(runTime>=.5&&!hushBusy&&hushClock-hushAt>=6)_ = RunHush();
    }
    public async Task RunHush()
    {
        if(hushBusy||here?.Id!="cathedral"||Congregation() is not {} hall||ServerLink.I?.Api is not {} api)return;
        int count=0;HallPeople.Figure? nearest=null,beadle=null;float closest=float.MaxValue;float radius=here.State?.Service!=null?22:14;
        foreach(var f in hall.Figures.Values){float d=new Vector2(f.Group.GlobalPosition.X-Jef.I.X,f.Group.GlobalPosition.Z-Jef.I.Z).Length();if(f.Leaving||f.Group.GlobalPosition.Y-hall.Origin.Y>=2)continue;if(f.Role.StartsWith("beadle")&&d<30)beadle=f;if(d<radius){count++;if(d<closest){nearest=f;closest=d;}}}
        LastWitnesses=count;if(count==0)return;hushBusy=true;hushAt=hushClock;int g=generation;
        try{var reply=await api.CathedralRan(count);if(dead||g!=generation||here?.Id!="cathedral")return;GameState.I.Apply(reply);if(!reply.Counted)return;LastHush=reply;
            foreach(var f in hall.Figures.Values)if(f.Group.GlobalPosition.DistanceTo(new(Jef.I.X,hall.Origin.Y,Jef.I.Z))<16)ReactionOf(f).Look=3.5;
            var speaker=reply.Speaker=="beadle"?beadle??nearest:nearest??beadle;
            if(speaker!=null){var f=speaker;Bubbles.I?.Say(()=>IsInstanceValid(f.Group)?f.Group.GlobalPosition+Vector3.Up*1.5f:Vector3.Zero,reply.Speaker=="beadle"?"The beadle":"A churchgoer",reply.Line);}
            if(reply.Text.Length>0)GameState.I.Say(reply.Text);
            if(reply.Leave){putOut=2.6;if(beadle!=null){beadle.Path.Clear();beadle.Path.Enqueue(new(Jef.I.X-.6f,hall.Origin.Y,Jef.I.Z));beadle.Wait=0;}}
        }catch(ApiException){}finally{hushBusy=false;}
    }
}

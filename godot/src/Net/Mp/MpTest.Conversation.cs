using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;

namespace Scheldemist.Net.Mp;
public partial class MpTest
{
    private async Task<bool> HostConversation()
    {
        GameState.I.Apply(await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear"}));
        Scheldemist.World.Daylight.I.Settle();
        var town=Main.I.GetNode<Townspeople>("Townspeople");
        if(!await Until(()=>town.Sims.Any(s=>s.P is {Remote:false}&&!s.ActionHeld&&!s.ServerEventDriven&&s.R.Trade is not ("thief" or "police")),20))return Fail("no talk subject");
        var s=town.Sims.Where(s=>s.P is {Remote:false}&&!s.ActionHeld&&!s.ServerEventDriven&&s.R.Trade is not ("thief" or "police")).OrderBy(s=>new Vector2((float)s.X-Jef.I.X,(float)s.Z-Jef.I.Z).LengthSquared()).First();
        Jef.I.Place((float)s.P!.X+1.2f,(float)s.P.Z+1.4f,0);await Frames(4);
        Talk.I!.Open(s.R.Id,s.R.Name);await Frames(45);
        var start=new Vector2((float)s.P.X,(float)s.P.Z);
        Jef.I.Yaw=MathF.Atan2(Jef.I.X-(float)s.P.X,Jef.I.Z-(float)s.P.Z);await Frames(12);
        await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        using(var image=GetViewport().GetTexture().GetImage())image.SavePng(Path.Combine(dir,"mp-talk-host.png"));
        MovingWrite("mp-talk-open.json",new{npc=s.R.Id,x=s.P.X,z=s.P.Z,action=s.ActionOwner?.GetType().Name,serverDriven=s.ServerEventDriven,owner=NativeStreet.I?.OwnerOf(s.R.Id),remote=s.P.Remote});
        var observed=await MovingRead("mp-talk-seen.json",60);doc["talk_seen"]=observed;
        bool stopped=start.DistanceTo(new((float)s.P.X,(float)s.P.Z))<.3f;
        if(!stopped || observed?.GetProperty("ok").GetBoolean()!=true)return Fail("guest did not see the held talk pose");
        Talk.I.Close();MovingWrite("mp-talk-close.json",new{npc=s.R.Id});
        var released=await MovingRead("mp-talk-released.json",30);doc["talk_released"]=released;
        doc["conversation_checks"]=new[]{
            new{name="host stops",pass=stopped},
            new{name="guest remote talk pose",pass=observed?.GetProperty("seen").GetBoolean()==true},
            new{name="guest sees stopped position",pass=observed?.GetProperty("moved").GetSingle()<.3f},
            new{name="guest matches host position",pass=observed?.GetProperty("gap").GetSingle()<.35f},
            new{name="second player cannot take ownership",pass=observed?.GetProperty("pinned").GetBoolean()==true},
            new{name="close reaches guest",pass=released?.GetProperty("ok").GetBoolean()==true}};
        return released?.GetProperty("ok").GetBoolean()==true&&await HostPostedConversation();
    }
    private async Task<bool> GuestConversation()
    {
        var row=await MovingRead("mp-talk-open.json",120);if(row==null)return Fail("host did not start conversation");
        string id=row.Value.GetProperty("npc").GetString()!;var town=Main.I.GetNode<Townspeople>("Townspeople");
        Jef.I.Place(row.Value.GetProperty("x").GetSingle()+2,row.Value.GetProperty("z").GetSingle()+2,0);
        bool seen=await Until(()=>NativeStreet.I!.OwnerOf(id)==1&&town.ActionPerson(id)?.P is {Remote:true,Human.Motion:"talk"},30);
        var s=town.ActionPerson(id);var a=new Vector2((float)(s?.P?.X??0),(float)(s?.P?.Z??0));await Frames(45);
        float moved=a.DistanceTo(new((float)(s?.P?.X??0),(float)(s?.P?.Z??0)));
        Together.I!.SendText(new{type="claim",ids=new[]{id},steal=true});await Frames(15);
        bool pinned=NativeStreet.I!.OwnerOf(id)==1;
        float gap=new Vector2((float)(s?.P?.X??0),(float)(s?.P?.Z??0)).DistanceTo(new(row.Value.GetProperty("x").GetSingle(),row.Value.GetProperty("z").GetSingle()));
        MovingWrite("mp-talk-seen.json",new{ok=seen&&moved<.3f&&pinned&&gap<.35f,seen,moved,pinned,gap,motion=s?.P?.Human.Motion,remote=s?.P?.Remote,action=s?.ActionOwner?.GetType().Name,serverDriven=s?.ServerEventDriven,owner=NativeStreet.I?.OwnerOf(id),received=NativeStreet.I?.Received,transmitted=NativeStreet.I?.Transmitted});
        if(await MovingRead("mp-talk-close.json",30)==null)return Fail("host never closed talk");
        bool released=await Until(()=>ConversationHold.I?.Held(id)!=true&&s?.P?.Human.Motion!="talk",20);
        MovingWrite("mp-talk-released.json",new{ok=released,held=ConversationHold.I?.Held(id),motion=s?.P?.Human.Motion,remote=s?.P?.Remote,action=s?.ActionOwner?.GetType().Name,serverDriven=s?.ServerEventDriven,owner=NativeStreet.I?.OwnerOf(id),received=NativeStreet.I?.Received,transmitted=NativeStreet.I?.Transmitted});
        if(!seen||!pinned||!released)return false;
        return await GuestPostedConversation();
    }
    private async Task<bool> HostPostedConversation()
    {
        var posted=Scheldemist.People.PostedPeople.I!.List.First(n=>n.Id=="sooi"&&n.Present);
        Jef.I.Place((float)posted.X+1.2f,(float)posted.Z+1,0);await Frames(8);Talk.I!.Open(posted.Id,posted.Name);await Frames(20);
        MovingWrite("mp-posted-open.json",new{npc=posted.Id,x=posted.X,z=posted.Z});
        var seen=await MovingRead("mp-posted-seen.json",45);doc["posted_seen"]=seen;
        Talk.I.Close();MovingWrite("mp-posted-close.json",new{npc=posted.Id});
        var ended=await MovingRead("mp-posted-released.json",20);doc["posted_released"]=ended;
        return seen?.GetProperty("ok").GetBoolean()==true&&ended?.GetProperty("ok").GetBoolean()==true;
    }
    private async Task<bool> GuestPostedConversation()
    {
        var row=await MovingRead("mp-posted-open.json",45);if(row==null)return Fail("no working conversation");
        string id=row.Value.GetProperty("npc").GetString()!;float x=row.Value.GetProperty("x").GetSingle(),z=row.Value.GetProperty("z").GetSingle();
        Jef.I.Place(x+2,z+2,0);
        var posted=Scheldemist.People.PostedPeople.I!.Get(id);
        bool talk=await Until(()=>posted?.Human?.Motion=="talk"&&ConversationHold.I?.Held(id)==true,20);await Frames(30);
        float gap=posted==null?999:new Vector2((float)posted.X-x,(float)posted.Z-z).Length();
        MovingWrite("mp-posted-seen.json",new{ok=talk&&gap<.03f,talk,gap});
        if(await MovingRead("mp-posted-close.json",20)==null)return false;
        bool released=await Until(()=>ConversationHold.I?.Held(id)!=true,15);
        MovingWrite("mp-posted-released.json",new{ok=released});return talk&&gap<.03f&&released;
    }
}

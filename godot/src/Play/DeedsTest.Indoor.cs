using System;
using System.Text.Json;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;
public partial class DeedsTest
{
    private Scheldemist.Net.Mp.MpSession? cellGuest;
    private double guestSend,guestPing,guestTime;
    public override void _Process(double dt)
    {
        if(cellGuest is not {} guest)return;guest.Pump();guestTime+=dt;
        if((guestPing-=dt)<=0){guestPing=1;guest.Ping();}
        if((guestSend-=dt)<=0){guestSend=.05;guest.SendState(new(){T=guest.ServerNow,X=10+(float)Math.Sin(guestTime)*.5f,Z=12,Mode=0,Flags=Scheldemist.Net.Mp.MpProtocol.FlagGrounded,Vx=.5f*(float)Math.Cos(guestTime)});}
    }
    private async Task HeldCell(Api api)
    {
        var host=await Scheldemist.Net.Mp.Together.I!.Host(false);
        Check(await Until(()=>Scheldemist.Net.Mp.Together.I!.Connected,12),"host live player connected for cell check");
        // A second authenticated, live socket represents the awake player. Tokens never enter the report.
        var joined=await api.Post<JsonElement>("api/mp/join",new { code=host.Code,name="Indoor test guest" });
        using var guest=new Api(api.Url){Token=joined.GetProperty("token").GetString()};
        using var movement=new Scheldemist.Net.Mp.MpSession(api.Url,guest.Token,joined.GetProperty("id").GetInt32());
        try
        {
            cellGuest=movement;movement.Start();Check(await Until(()=>{movement.Pump();movement.Ping();return movement.Open && movement.Id!=0;},12),"second live player connected for cell check");
            Check(await Until(()=>Scheldemist.Net.Mp.Together.I!.Roster.Count(r=>r.Online)>=2,12),"two online players in engine roster");
            await guest.Post<OkReply>("api/arrival/ashore");
            // Leave more than one real world tick before dawn: dev/set resets the
            // tick limit, so the next five-minute tick may happen before the arrest.
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new { day=2,hour=5,minute=45,money_c=500,health=10,food=10,warmth=10,sleep=10 }));
            await Fixture("police");await Deeds.I.Seize();await Deeds.I.Poll();
            Check(await Until(()=>Day.I.Asleep,10),"held cell uses existing sleep owner");
            Check((await api.Police()).Held,"host stays held while another player is awake");
            var awake=await guest.Tick(new WhereReport("street",false),false,new Pos3(10,12,0));
            Check(awake.Rest==null,"second player can keep walking while host is held");
            bool refused=false;try{await api.Wake();}catch(ApiException e){refused=e.Status==409;}
            Check(refused || (await api.Police()).Held,"wake key cannot release held prisoner");await Until(()=>false,1.4);await Shot("two-player-held-cell");
            // Only the multiplayer world's real tick advances each player's rest.
            // dev/advance moves its clock but deliberately does not spend a prisoner's sleep.
            var heldAt=await api.Tick(GameState.I.Where(),true,new Pos3(Jef.I.X,Jef.I.Z,Jef.I.Y));GameState.I.Apply(heldAt);replies.Add(new{cellHeldAt=new{heldAt.Clock,heldAt.Rest,heldAt.Woke}});
            Check(heldAt.Rest?.At is {} cellAt&&new Vector2(Jef.I.X-(float)cellAt.X,Jef.I.Z-(float)cellAt.Z).Length()<.1f,"held player occupies engine cell position for the other player");
            bool released=await Until(()=>!Day.I.Asleep,45);replies.Add(new{cellReleaseProbe=new{released,clock=(await api.Jobs()).Clock,police=await api.Police(),Scheldemist.Net.Mp.Together.I!.PausedAll}});Check(released,"held cell releases at world dawn");await Deeds.I.Poll();
            Check((await api.Police()).Cell,"dawn presents prison summary");await Deeds.I.ShowCell();await Until(()=>false,1.4);await Shot("two-player-cell-dawn");await Deeds.I.LeaveCell();
            Check(!(await api.Police()).Held && !(await api.Police()).Cell,"prison summary acknowledged after world dawn");
            replies.Add(new { heldCell=new { guestId=joined.GetProperty("id").GetInt32(),secondPlayerAwake=true,released=await api.Police() } });
        }
        finally { cellGuest=null;movement.Dispose();guest.Dispose();await Scheldemist.Net.Mp.Together.I!.StopHosting(); }
    }
}

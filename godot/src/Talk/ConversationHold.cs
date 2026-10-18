using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Talks;

/// <summary>The server owns the conversation lease. Existing street packets carry its pose to observers.</summary>
[GamePart(335)]
public partial class ConversationHold : Node
{
    public static ConversationHold? I { get; private set; }
    private Townspeople town = null!;
    private readonly Dictionary<string, Vector2> held = new();
    private readonly Dictionary<string, Vector2> anchors = new();
    private readonly Dictionary<string, ((double x,double z)? Dest, double Pace)> resume = new();
    private string? wanted, acquired;
    private string goodbye="Goodbye for now.";
    private double poll;
    private bool waiting;
    private int generation;
    public bool Held(string id) => held.ContainsKey(id) || wanted == id;
    public Vector2? Anchor(string id) => anchors.TryGetValue(id,out var at)?at:null;
    public Vector2? Facing(string id) => wanted == id ? new(Jef.I.X,Jef.I.Z) : held.TryGetValue(id,out var at) ? at : null;
    public override void _Ready()
    {
        I=this; town=Main.I.GetNode<Townspeople>("Townspeople");
        Talk.I!.OnOpen += Open; Talk.I.OnClose += Close;
        town.BeforeCrowd += Pose; town.PopulationChanged += Reset;
    }
    private void Open(string id) { goodbye="Goodbye for now.";wanted=id; poll=0; Pose(0); }
    private void Close(string id)
    {
        if(wanted!=id)return; wanted=null; held.Remove(id); anchors.Remove(id); poll=0;
        var at=Bubbles.I?.PositionOf?.Invoke(id) ?? town.Indoors?.PositionOf(id) ?? town.ActionPerson(id)?.P?.Group.GlobalPosition;
        if(at is Vector3 p) Bubbles.I?.Say(()=>p+Vector3.Up*1.65f,Talk.I?.Who(id)?.Name??"",goodbye,id);
        Resume(id);
    }
    public override void _Process(double delta)
    {
        if(ServerLink.I?.Up!=true || town.Data==null)return;
        if(wanted is {} id && Position(id) is Vector2 at && at.DistanceTo(new(Jef.I.X,Jef.I.Z))>4.2f)
            End("Goodbye for now.");
        if(!waiting && (poll-=delta)<=0){poll=.3; _=Poll();}
    }
    private Vector2? Position(string id)
    {
        if(town.Indoors?.PositionOf(id) is {} p)return new(p.X,p.Z);
        if(town.PositionOf(id) is {} q)return new((float)q.x,(float)q.z);
        return null;
    }
    private void End(string line)
    {
        if(wanted==null)return; goodbye=line; Talk.I?.Close();
        GameState.I.Say(line); LastEnd=line;
    }
    public string LastEnd {get;private set;}="";
    private async Task Poll()
    {
        if(ServerLink.I?.Api is not {} api)return; waiting=true; int epoch=generation;
        try
        {
            if(acquired!=null && acquired!=wanted) { await api.Post<JsonElement>("api/talk/hold",new{npc=acquired,mode="release"}); acquired=null; }
            string? id=wanted; var at=id==null?null:Position(id);
            var result=await api.Post<JsonElement>("api/talk/hold",new{npc=id??"",mode=id==null?"list":acquired==id?"renew":"open",x=Jef.I.X,z=Jef.I.Z,npc_x=at?.X??Jef.I.X,npc_z=at?.Y??Jef.I.Z});
            if(epoch!=generation || !IsInsideTree())return;
            var previous=held.Keys.ToArray();held.Clear();anchors.Clear();
            foreach(var row in result.GetProperty("holds").EnumerateArray()){string npc=row.GetProperty("npc").GetString()!;held[npc]=new(row.GetProperty("x").GetSingle(),row.GetProperty("z").GetSingle());anchors[npc]=new(row.GetProperty("npc_x").GetSingle(),row.GetProperty("npc_z").GetSingle());}
            foreach(string old in previous)if(!held.ContainsKey(old)&&old!=wanted)Resume(old);
            if(id!=null && result.GetProperty("active").GetBoolean())acquired=id;
            else if(id!=null && wanted==id)End(result.GetProperty("line").GetString()??"I must be off.");
        }
        catch(ApiException e){if(wanted!=null)End(e.Message);}
        finally{waiting=false;}
    }
    private void Pose(double dt)
    {
        foreach(var s in town.Sims)
        {
            if(!Held(s.R.Id) || s.P is not {} p)continue;
            var target=Facing(s.R.Id);
            p.Human.FaceConversation(target is {} t?new Vector3(t.X,p.Group.GlobalPosition.Y+1.6f,t.Y):null,p.NetworkVehicle==1||p.State=="sit");
            if(p.Remote)continue;
            if(!resume.ContainsKey(s.R.Id))resume[s.R.Id]=(p.Dest,p.Pace);
            var at=Facing(s.R.Id); double? yaw=at.HasValue?Math.Atan2(at.Value.X-p.X,at.Value.Y-p.Z):null;
            // Mounted bodies retain the vehicle heading; attention turns their head/torso, not the horse/cart.
            town.Crowd!.PuppetStand(p,p.NetworkVehicle==1?"ride":"talk",p.NetworkVehicle>0?null:yaw);
            p.Conversing=true;
        }
    }
    private void Resume(string id)
    {
        if(town.ActionPerson(id)?.P is {} p){p.Conversing=false;p.Human.FaceConversation(null);p.Human.Root.Rotation=Vector3.Zero;if(resume.Remove(id,out var old)&&old.Dest is {} d)town.Crowd!.PuppetGo(p,d.x,d.z,old.Pace);}
    }
    private void Reset(){generation++;wanted=acquired=null;Talk.I?.Close();foreach(string id in resume.Keys.ToArray())Resume(id);held.Clear();anchors.Clear();poll=0;}
    public override void _ExitTree(){if(Talk.I is {} talk){talk.OnOpen=talk.OnOpen-Open??(_=>{});talk.OnClose=talk.OnClose-Close??(_=>{});}town.BeforeCrowd-=Pose;town.PopulationChanged-=Reset;Reset();I=null;}
}

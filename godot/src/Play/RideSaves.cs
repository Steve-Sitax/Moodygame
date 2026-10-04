using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

public sealed record RideSaved(string Kind,string Id,float X,float Z,float Yaw,int Seat=-1,bool Ladder=false,float Height=0);

public sealed record RowSaved(string What,string Kind,float X,float Z,float Yaw);

/// <summary>The same rowing save as the browser, plus Jef's feet rather than camera height.</summary>
[GamePart(928)]
public partial class RideSaves:Node
{
    public static RideSaves I {get;private set;}=null!;
    private Func<ClientState>? previous;
    public override void _Ready()
    {
        I=this;
        if(Scheldemist.Menu.MainMenu.I is {} menu){previous=menu.Saves.Capture;menu.Saves.Capture=Capture;menu.WorldReplaced+=Replaced;}
    }
    public ClientState Capture()
    {
        var j=Jef.I;var state=GameState.I;var (hour,minute)=state.Shown;
        var result=previous?.Invoke()??new ClientState(new(state.Day,hour,minute),"Antwerp",new(j.X,j.Z,j.Y,j.Yaw,j.Pitch,j.Swimming,j.Crouching));
        var more=result.More==null?new Dictionary<string,JsonElement>():new(result.More);
        more.Remove("row");more.Remove("ride");
        RideSaved? ride=null;
        if(Handcarts.I?.Held is {} id&&Handcarts.I.Drawings.TryGetValue(id,out var cart))ride=new("cart",id,cart.X,cart.Z,cart.Yaw);
        else if(Velocipedes.I?.Ridden is {} velo)ride=new("velo",velo.Info.Id,j.X,j.Z,Velocipedes.I.Heading);
        else if(Ride.I?.Bus is {} bus)ride=new("omnibus",bus.Index.ToString(),Ride.I.WalkAt.X,Ride.I.WalkAt.Y,bus.Yaw,Ride.I.Seat);
        else if(CraneClimb.I?.On>=0)ride=CraneClimb.I.Saved();
        else if(ShipWalk.I?.On is {} deck)ride=new("ship",ShipWalk.I.Decks.IndexOf(deck)+":"+deck.Kind,ShipWalk.I.Local.X,ShipWalk.I.Local.Y,j.Yaw);
        if(ride!=null)more["ride"]=JsonSerializer.SerializeToElement(ride,Api.Json);
        if(Rowing.I?.Boat is {} boat&&Rowing.I.Data.On is {} on)
            more["row"]=JsonSerializer.SerializeToElement(new RowSaved(on,boat.Kind,Rowing.I.Rower.X,Rowing.I.Rower.Z,Rowing.I.Rower.Heading),Api.Json);
        return result with {More=more};
    }
    public static async System.Threading.Tasks.Task<RideSaved?> ReadRide(Api api)
    {var state=await api.GetClientState();return state.Client is {} raw?Read<RideSaved>(raw.Deserialize<ClientState>(Api.Json),"ride"):null;}
    public static T? Read<T>(ClientState? state,string key) where T:class
    {
        try{var result=state?.More?.TryGetValue(key,out var value)==true?value.Deserialize<T>(Api.Json):null;if(result is RideSaved ride&&(!float.IsFinite(ride.X)||!float.IsFinite(ride.Z)||!float.IsFinite(ride.Yaw)||!float.IsFinite(ride.Height)||Math.Abs(ride.X)>2000||Math.Abs(ride.Z)>2000))return null;return result;}catch(JsonException){return null;}
    }
    private void Replaced(string how,ClientState? state)
    {
        if(state==null)return;var p=state.Pose;
        if(!Jef.I.Riding)Jef.I.Place((float)p.X,(float)p.Z,(float)p.Yaw,(float)p.Pitch,(float)p.Y);
        if(p.Swimming&&!Jef.I.Riding)Jef.I.DropFromBoat(new((float)p.X,(float)p.Y,(float)p.Z));
    }
    public override void _ExitTree()
    {if(Scheldemist.Menu.MainMenu.I is {} menu){menu.WorldReplaced-=Replaced;menu.Saves.Capture=previous;}}
}

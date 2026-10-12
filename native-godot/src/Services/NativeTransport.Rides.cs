using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTransport
{
    private JsonObject? Ticket(int player){var ticket=C.PlayerState(player,"ride")as JsonObject;if(ticket==null||!Line(S(ticket,"line"))||!Stop(S(ticket,"from"))||ticket["since"]==null)return null;double elapsed=Minute-N(ticket,"since");return elapsed<0||elapsed>240?null:ticket;}
    private bool Line(string id)=>Data["omnibus"]?["timing"]?[id]!=null;
    private bool Stop(string id)=>A(Data["omnibus"]?["stops"]).Any(s=>S(s,"id")==id);
    private bool Calls(string line,string stop)=>Data["omnibus"]?["timing"]?[line]?["offsetMin"]?[stop]!=null;
    public string? RidePlace(int player){var ticket=Ticket(player);return ticket==null||ticket["on"] is JsonValue v&&v.TryGetValue<bool>(out bool on)&&!on?null:B(ticket,"roof")?"roof":"inside";}
    public JsonObject RideView(int player)
    {
        var ticket=Ticket(player);JsonObject? on=null,change=null;
        if(ticket!=null){double elapsed=Minute-N(ticket,"since");if(ticket["on"]?.GetValue<bool>()!=false)on=new(){["line"]=S(ticket,"line"),["place"]=B(ticket,"roof")?"roof":"inside",["from"]=S(ticket,"from"),["minutes"]=elapsed,["left"]=240-elapsed};else if(N(ticket,"changes")<1)change=new(){["from_line"]=S(ticket,"line")};}
        return new(){["on"]=on,["fare_c"]=5,["change"]=change};
    }
    private int NextSlot(string line,int absolute)
    {
        int headway=(int)N(Data["omnibus"]!["timing"]![line],"headwayMin"),day=(int)Math.Floor(absolute/1440.0),minute=absolute-day*1440;
        if(minute<=360)return day*1440+360;int slot=360+(int)Math.Ceiling((minute-360)/(double)headway)*headway;return slot<=1320?day*1440+slot:(day+1)*1440+360;
    }
    public List<int> Departures(string line,string stop,int absolute,int count=3)
    {
        var offset=Data["omnibus"]?["timing"]?[line]?["offsetMin"]?[stop];if(offset==null)return new();int off=(int)V(offset),slot=NextSlot(line,absolute-off);var result=new List<int>();while(result.Count<count){result.Add(slot+off);slot=NextSlot(line,slot+1);}return result;
    }
    private static string ClockText(int absolute){int minute=((absolute%1440)+1440)%1440;return minute/60+":"+(minute%60).ToString("D2");}
    private bool InService(string line,string stop){int offset=(int)V(Data["omnibus"]!["timing"]![line]!["offsetMin"]![stop]),minute=(((Minute-offset)%1440)+1440)%1440;return minute>=355&&minute<=1380;}
    private JsonObject Timetable(string stop)
    {
        var lines=new JsonArray();var words=new List<string>();foreach(var node in A(Data["omnibus"]?["lines"])){string line=S(node,"id"),name=S(node,"name");if(!Calls(line,stop))continue;var next=Departures(line,stop,Minute).Select(ClockText).ToList();int every=(int)N(Data["omnibus"]!["timing"]![line],"headwayMin");lines.Add(new JsonObject{["line"]=line,["name"]=name,["every_min"]=every,["next"]=new JsonArray(next.Select(t=>(JsonNode)JsonValue.Create(t)!).ToArray())});words.Add(char.ToUpperInvariant(name[0])+name[1..]+": every "+every+" minutes, next at "+string.Join(", ",next)+".");}
        string label=S(A(Data["omnibus"]?["stops"]).FirstOrDefault(s=>S(s,"id")==stop),"name",stop);return new(){["stop"]=stop,["name"]=label,["lines"]=lines,["text"]=char.ToUpperInvariant(label[0])+label[1..]+". "+string.Join(" ",words)};
    }
    public JsonObject Alight(int player){var ticket=C.PlayerState(player,"ride")as JsonObject;if(ticket==null||ticket["on"]?.GetValue<bool>()==false)return new(){["text"]=""};ticket["on"]=false;ticket["roof"]=false;C.SetPlayerState(player,"ride",ticket);return new(){["text"]="You step down onto the cobbles."};}
    private JsonObject Board(int player,string line,string stop,bool hop)
    {
        if(!Line(line))Refuse("no such line",400);if(!Stop(stop))Refuse("no such stop",400);if(!Calls(line,stop))Refuse("that line does not call there",400);if(RidePlace(player)!=null)Refuse("you are on the omnibus already");
        if(!hop&&!InService(line,stop))Refuse("the omnibuses do not run now: the first is due here at "+ClockText(Departures(line,stop,Minute,1)[0]));
        var previous=Ticket(player);bool change=previous!=null&&previous["on"]?.GetValue<bool>()==false&&S(previous,"line")!=line&&N(previous,"changes")<1;
        if(!change&&Money(player)<5)Refuse("not enough money: the fare is 5 c");
        C.Atomic(()=>{if(!change)C.Execute("UPDATE player SET money_c=money_c-5 WHERE id=$p0",player);C.SetPlayerState(player,"ride",new JsonObject{["since"]=change?N(previous,"since"):Minute,["line"]=line,["from"]=stop,["on"]=true,["changes"]=change?N(previous,"changes")+1:0});C.Log(player,change?"changed_omnibus":"rode_omnibus",stop,change?"Jef changed onto another omnibus line.":"Jef paid five centimes and boarded an omnibus.");});
        return new(){["fare_c"]=change?0:5,["change"]=change,["text"]=change?"The conductor punches your ticket: a change, nothing to pay.":hop?"You count 5 c into the conductor's hand. He grunts and punches a ticket.":"You pay the conductor 5 c and step up onto the back platform."};
    }
    private void RegisterRides()
    {
        host.Register("POST","/api/ride",r=>{if(C.PlayerState(r.PlayerId,"ending")!=null)Refuse("the week is over");JsonObject reply;
            switch(r.Text("action")){
                case "board":reply=Board(r.PlayerId,r.Text("line"),r.Text("stop"),false);break;
                case "hop":string line=r.Text("line");if(!Line(line))Refuse("no such line",400);reply=Board(r.PlayerId,line,S(Data["omnibus"]!["timing"]![line],"terminus"),true);break;
                case "alight":reply=Alight(r.PlayerId);break;
                case "seat":string place=r.Text("place");if(place is not("inside"or"roof"))Refuse("place must be inside or roof",400);var ticket=Ticket(r.PlayerId);if(ticket==null||RidePlace(r.PlayerId)==null)Refuse("you are not on an omnibus");ticket!["roof"]=place=="roof";C.SetPlayerState(r.PlayerId,"ride",ticket);reply=new(){["place"]=place};break;
                case "timetable":if(!Stop(r.Text("stop")))Refuse("no such stop",400);return Timetable(r.Text("stop"));
                default:throw new NativeServiceException("action must be board, hop, alight, seat or timetable",400);
            }
            host.PublishState(r.PlayerId);return Response(r.PlayerId,reply);
        });
        host.MidnightHooks.Add(day=>{foreach(var player in host.OnlinePlayers())C.SetPlayerState(player,"ride",null);});
    }
}

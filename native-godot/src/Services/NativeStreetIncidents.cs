using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Authoritative fall damage and the night thieves who take money from a player.</summary>
public sealed class NativeStreetIncidents : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private sealed record Pending(string Thief, int Amount, long At, int Day);
    private readonly Dictionary<int, Pending> pending = new();
    public Func<int,string,string>? ThiefCaught;
    public NativeStreetIncidents(NativeServiceHost host) => this.host=host;
    private static int N(JsonNode? n,string key) => n is JsonObject row ? NativeCoreClock.Number(row,key) : 0;
    private static string S(JsonNode? n,string key) => n?[key]?.GetValue<string>() ?? "";
    private JsonObject? Resident(string id) => C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",id) is {} json ? JsonNode.Parse(json)!.AsObject() : null;
    public void Register(NativeServiceHost service)
    {
        service.Register("POST","/api/fall",r=>{var result=Fall(r.PlayerId,r.Body);if(N(result,"hurt")>0)host.PublishState(r.PlayerId);return NativeCoreClock.Join(result,host.Payload(r.PlayerId));});
        service.Register("POST","/api/resident/:id/pick",r=>{var result=Pick(r.PlayerId,r.Param("id"));host.PublishState(r.PlayerId);return NativeCoreClock.Join(result,host.Payload(r.PlayerId));});
        service.Register("POST","/api/resident/:id/catch",r=>{var result=Catch(r.PlayerId,r.Param("id"));result["text"]=S(result,"text")+(ThiefCaught?.Invoke(r.PlayerId,r.Param("id"))??"");host.PublishState(r.PlayerId);return NativeCoreClock.Join(result,host.Payload(r.PlayerId));});
        service.NewGame += pending.Clear; service.Loaded += pending.Clear;
    }
    private static double Numeric(JsonNode? value)
    {
        if(value==null)return 0;
        if(value is JsonArray array)return array.Count==0?0:array.Count==1?Numeric(array[0]):0;
        if(value is not JsonValue primitive)return 0;
        if(primitive.TryGetValue<double>(out var number))return double.IsNaN(number)?0:number;
        if(primitive.TryGetValue<bool>(out var boolean))return boolean?1:0;
        if(!primitive.TryGetValue<string>(out var text))return 0;
        text=text.Trim();
        if(text.Length>2 && text[0]=='0') {
            int radix=char.ToLowerInvariant(text[1]) switch {'x'=>16,'b'=>2,'o'=>8,_=>0};
            if(radix>0)try{return Convert.ToInt64(text[2..],radix);}catch(Exception error)when(error is FormatException or OverflowException or ArgumentException){return 0;}
        }
        return double.TryParse(text,NumberStyles.Float,CultureInfo.InvariantCulture,out number)&&!double.IsNaN(number)?number:0;
    }
    public JsonObject Fall(int player,JsonObject body)
    {
        double height=Math.Clamp(Numeric(body["height"]),0,60);
        if(body["water"] is JsonValue water && water.TryGetValue<bool>(out var wet) && wet || height<3)return new(){["hurt"]=0,["text"]=null};
        var person=C.One("SELECT health FROM player WHERE id=$p0",player);if(person==null)return new(){["hurt"]=0,["text"]=null};
        int harm=height>=12?4:height>=8?3:height>=5?2:1,hurt=Math.Max(0,Math.Min(harm,N(person,"health")-1));
        if(hurt>0)C.Execute("UPDATE player SET health=MAX(1,health-$p0) WHERE id=$p1",hurt,player);
        return new(){["hurt"]=hurt,["text"]=height>=12?"You hit the stones hard. Everything goes white for a moment. Something in you is badly hurt.":height>=8?"You land badly. Pain shoots up through your legs and back.":height>=5?"You come down hard and your ankle turns under you.":"You land heavily. Your knees jar and your ankles ache."};
    }
    public JsonObject Pick(int player,string id)
    {
        var person=Resident(id);if(person==null||S(person,"trade")!="thief")throw new NativeServiceException("not a thief",409);
        var clock=host.Clock.View();int hour=N(clock,"hour"),day=N(clock,"day");
        if(hour<20&&hour>=6)throw new NativeServiceException("too light for that",409);
        string key="picks:"+day;var done=C.World(key) as JsonObject??new();
        if(done.ContainsKey(id))throw new NativeServiceException("this one has tried already tonight",409);
        if(done.Count>=2)throw new NativeServiceException("enough for one night",409);
        bool success=C.Roll()<.55+(N(person["stats"],"courage")-5)*.03;
        int money=C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player),took=0;string text;
        if(money<5)text="A quick hand goes through your coat and finds nothing. Someone laughs in the dark.";
        else if(!success){text="You feel a hand at your pocket and knock it away. Someone slips off into the dark.";host.Trade.Remember(player,id,"I tried Jef's pocket and he felt it. Quick, that one.",4);}
        else {
            took=Math.Min(60,Math.Min(money,Math.Max(5,(int)Math.Floor(money*(.2+C.Roll()*.25)/5+.5)*5)));
            text="Someone brushes past you in the dark. A moment later your pocket is lighter.";
            C.Atomic(()=>{C.Execute("UPDATE player SET money_c=MAX(0,money_c-$p0) WHERE id=$p1",took,player);C.Log(player,"robbed",id,$"Someone picked Jef's pocket at night and took {took} centimes.");});
            host.Trade.Remember(player,id,$"I lifted {took} centimes from Jef's pocket in the dark. He never saw me.",5,"Jef had his pocket picked in the dark, and never saw who",-1);
            pending[player]=new(id,took,C.Now,day);
        }
        done[id]=took;C.SetWorld(key,done);return new(){["took_c"]=took,["felt"]=!success||took==0,["text"]=text};
    }
    public JsonObject Catch(int player,string id)
    {
        var person=Resident(id)??throw new NativeServiceException("nobody by that name",404);
        if(!pending.TryGetValue(player,out var take)||take.Thief!=id||C.Now-take.At>25000||take.Day!=N(host.Clock.View(),"day"))throw new NativeServiceException("nothing to get back from this one",409);
        pending.Remove(player);int back=take.Amount;
        C.Atomic(()=>{C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",back,player);C.Log(player,"caught_thief",id,$"Jef caught the pickpocket {S(person,"name")} and took back his {back} centimes.");});
        host.Trade.Remember(player,id,"Jef caught me by the collar and took his money back. I'll remember his face.",7,"Jef caught a pickpocket by the collar and got his money back",2);
        return new(){["back_c"]=back,["text"]=$"You grab {S(person,"first")} by the collar. Your {back} centimes come out of a sleeve, and {(S(person,"sex")=="f"?"she":"he")} twists free and runs."};
    }
}

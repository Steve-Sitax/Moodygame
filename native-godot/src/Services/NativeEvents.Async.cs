using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeEvents
{
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int>? DailyCallLimit;
    private int generation;
    private Task? thinking;
    public Task NarrationSettled()=>thinking??Task.CompletedTask;
    private JsonObject DirectorRequest(bool invent=false)=>NativeNorthNarration.Request("director_think",new(){["clock"]=host.Clock.View(),["events"]=List(1),["places"]=C.World("town")?["places"]?.DeepClone(),["threads"]=C.Rows("SELECT verb,text FROM log ORDER BY id DESC LIMIT 12"),["templates"]=Data["templates"]!.DeepClone(),["invent"]=invent},NativeNorthNarration.Director,"Compose one plausible town event from supplied places and real recent facts. Use at most six typed stages, at most 240 game minutes total and no money gifts to the player. Invent a new event only when requested. Scripted fire/hiring templates keep engine stages. The engine rejects overlap and invalid effects.");
    private void EnginePick()
    {
        int hour=(int)N(host.Clock.View(),"hour");if(hour<8||hour>=21||C.Roll()>=.35)return;var choices=A(Data["templates"]).Where(t=>!B(t,"routine")&&A(t?["fitHours"]?[(((Day-1)%7)+1).ToString()]).Any(h=>V(h)==hour)&&(!B(t,"oncePerDay")||C.Scalar<int>("SELECT COUNT(*) FROM town_event WHERE day=$p0 AND template=$p1",Day,S(t,"id"))==0)).ToArray();double total=choices.Sum(t=>N(t,"weight"));if(total<=0)return;double roll=C.Roll()*total;foreach(var choice in choices){roll-=N(choice,"weight");if(roll<=0){FromTemplate(S(choice,"id"));break;}}
    }
    private void QueueDirector()
    {
        if(NarrateAsync==null||!NativeNorthNarration.MayCall(C,Day,"director_think",12,DailyCallLimit?.Invoke()??120)){EnginePick();return;}if(thinking!=null&&!thinking.IsCompleted)return;var request=DirectorRequest();int started=generation,day=Day;thinking=Think(request,started,day);
    }
    private async Task Think(JsonObject request,int started,int day)
    {
        JsonObject? response=null;try{response=await NarrateAsync!(1,"director_think",request).ConfigureAwait(false);}catch{}await host.WithState(_=>{if(generation!=started||Day!=day)return false;if(response!=null){response["source"]="claude";if(B(Plan(response),"ok"))return true;}EnginePick();return false;}).ConfigureAwait(false);
    }
    /// <summary>The dev route answers as the retired server did: ok, id, title and where, beside the event row.</summary>
    private static JsonObject DevReply(JsonObject plan)
    {
        if(!B(plan,"ok")||plan["event"]is not JsonObject ev)return plan;
        string label=S(A(JsonNode.Parse(S(ev,"stages_json","[]"))).FirstOrDefault(),"label",S(ev,"place"));
        plan["id"]=ev["id"]?.DeepClone();plan["title"]=ev["title"]?.DeepClone();plan["where"]=label;return plan;
    }
    private async Task<object?> DevDirectorAsync(NativeServiceRequest r)
    {
        var prepare=await host.WithState(_=>{if(r.Text("template")!="")return(Answer:(JsonObject?)DevReply(FromTemplate(r.Text("template"),1,true)),Request:(JsonObject?)null,Generation:generation);if(!r.Bool("think")&&!r.Bool("invent"))return(Answer:(JsonObject?)new JsonObject{["templates"]=new JsonArray(A(Data["templates"]).Select(t=>t!["id"]!.DeepClone()).ToArray())},Request:(JsonObject?)null,Generation:generation);return(Answer:(JsonObject?)null,Request:(JsonObject?)DirectorRequest(r.Bool("invent")),Generation:generation);}).ConfigureAwait(false);
        if(prepare.Answer!=null)return prepare.Answer;JsonObject? output=null;if(NarrateAsync!=null)try{output=await NarrateAsync(r.PlayerId,"director_think",prepare.Request!).ConfigureAwait(false);}catch{}return await host.WithState(_=>{if(generation!=prepare.Generation)return new JsonObject{["ok"]=false,["why"]="The week changed while the director thought."};if(output==null)return new JsonObject{["ok"]=false,["source"]="engine",["why"]="No director provider is active."};output["source"]="claude";return DevReply(Plan(output));}).ConfigureAwait(false);
    }
}

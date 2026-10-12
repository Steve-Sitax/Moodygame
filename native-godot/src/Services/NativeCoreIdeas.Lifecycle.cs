using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    private Task? runningIdeas;
    private bool startupScheduled;
    public string? LifecycleError {get;private set;}
    public Func<bool>? EveryoneEnded;
    private bool WorldEnded()
    {
        if(EveryoneEnded!=null)return EveryoneEnded();bool week=C.Rows("SELECT value_json FROM player_state WHERE key='ending' UNION ALL SELECT value_json FROM world_state WHERE key='ending'").Any(r=>S(Parse(S(r,"value_json","{}")),"kind")=="week");
        return week||host.OnlinePlayers().All(who=>C.PlayerState(who,"ending")!=null||(who==1&&C.World("ending")!=null));
    }
    // Called from short, serialized board/tick hooks. The newspaper must actually exist first.
    public void Check()
    {
        if(runningIdeas is{IsCompleted:false}||C.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='job_board' AND day=$p0",Day)==0||WorldEnded())return;
        bool during=V(C.World("ideas_morning"))==Day;if(!during&&C.Scalar<int>("SELECT COUNT(*) FROM newspaper WHERE day=$p0",Day)==0)return;LifecycleError=null;runningIdeas=during?During(generation):Morning(Day,generation);Observe(runningIdeas);
    }
    public async Task LifecycleSettled(){var task=runningIdeas;if(task!=null)await task.ConfigureAwait(false);}
    public void Start(){if(startupScheduled)return;startupScheduled=true;Observe(Startup());}
    private async Task Startup(){await Task.Delay(2500).ConfigureAwait(false);await host.WithState(_=>{Check();return true;}).ConfigureAwait(false);}
    private async Task Morning(int day,int started)
    {
        try{
            var down=await host.WithState(_=>{if(generation!=started)return new JsonArray();C.SetWorld("ideas_morning",day);var removed=TakeDown();MissMeetings();return removed;}).ConfigureAwait(false);
            var replies=await AnswerLetters().ConfigureAwait(false);
            await host.WithState(_=>{if(generation!=started)return false;foreach(var r in replies){string from=S(r,"from"),kind=S(r?["effect"],"kind");host.PublishFor((int)N(r,"player",1),"press",new JsonObject{["text"]=$"A reply to your letter, from {from}. (I to read it.)"+(kind=="invite"?$" {from.Split(' ')[0]} asks you to come by the door today.":kind=="gift"?$" Something came with it: {S(r?["effect"],"name")}.":"")});}return true;}).ConfigureAwait(false);
            if(!await host.WithState(_=>generation==started).ConfigureAwait(false))return;
            var diary=await MaybeDiary().ConfigureAwait(false);var plans=await host.WithState(_=>generation==started?MorningPlans():new JsonArray()).ConfigureAwait(false);var ids=await PutUp(plans).ConfigureAwait(false);
            await host.WithState(_=>{if(generation!=started)return false;if(down.Count>0||ids.Count>0||diary!=null)PushIdeas();PushJobs();return true;}).ConfigureAwait(false);
        }catch{LifecycleError="The morning notices could not be completed.";throw;}
    }
    private async Task During(int started)
    {
        try{
            var unstuck=await UnstickDiaries().ConfigureAwait(false);var state=await host.WithState(_=>{if(generation!=started)return new JsonObject();if(unstuck.Count>0)PushIdeas();var down=TakeDown();foreach(var r in down)if(N(r,"paid_c")!=0)host.PublishFor((int)N(r,"player",1),"press",new JsonObject{["text"]=$"The police paid you the {N(r,"paid_c")} centimes reward on the bill: the pickpocket you named was found."});MissMeetings();var plans=C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up'")<9?new JsonArray(WantedPlans().Take(2).Select(p=>p!.DeepClone()).ToArray()):new JsonArray();return new JsonObject{["down"]=down,["plans"]=plans};}).ConfigureAwait(false);
            if(state.Count==0)return;var ids=await PutUp(A(state["plans"])).ConfigureAwait(false);await host.WithState(_=>{if(generation==started&&(A(state["down"]).Count>0||ids.Count>0)){PushIdeas();PushJobs();}return true;}).ConfigureAwait(false);
        }catch{LifecycleError="The town notices could not be updated.";throw;}
    }
    private static bool Truthy(JsonNode? node){if(node==null)return false;if(node is not JsonValue value)return true;if(value.TryGetValue<string>(out var text))return text!="";if(value.TryGetValue<bool>(out var boolean))return boolean;if(value.TryGetValue<double>(out var number))return number!=0;return true;}
    private async Task<object?> DevIdeas(NativeServiceRequest request)
    {
        var body=request.Body;var result=new JsonObject();if(Truthy(body["news"])){var news=await host.WithState(_=>{C.Execute("DELETE FROM news_abroad WHERE day=$p0",Day);string key=body["news"]is JsonValue v&&v.TryGetValue<string>(out var s)?s:S(A(data["news"]).FirstOrDefault(),"key");var first=C.One("SELECT data_json FROM world_event WHERE day=$p0 AND verb='ship_in' ORDER BY id LIMIT 1",Day);return RollNews(Day,first==null?null:Parse(S(first,"data_json","{}")),force:key);});result["news"]=news;}
        if(Truthy(body["posters"])){var plans=await host.WithState(_=>MorningPlans(C.Roll));result["posters"]=await PutUp(plans).ConfigureAwait(false);}
        if(Truthy(body["lost"])){var plan=await host.WithState(_=>LostPlan(C.Roll));result["lost"]=plan==null?null:await PutUp(new JsonArray(plan)).ConfigureAwait(false);}
        if(Truthy(body["diary"])){string force=body["diary"]is JsonValue v&&v.TryGetValue<string>(out var s)?s:"*";var diary=await MaybeDiary(force,C.Roll).ConfigureAwait(false);result["diary"]=diary==null?null:new JsonObject{["id"]=diary["id"]!.DeepClone(),["owner"]=diary["owner"]!.DeepClone(),["x"]=diary["x"]!.DeepClone(),["z"]=diary["z"]!.DeepClone(),["source"]=diary["source"]!.DeepClone()};}
        if(Truthy(body["replies"])){await host.WithState(_=>C.Execute("UPDATE jef_letter SET reply_day=$p0 WHERE status='sent' AND player_id=$p1",Day,request.PlayerId));result["replies"]=await AnswerLetters().ConfigureAwait(false);}
        if(Truthy(body["trouble"])){int job=await host.WithState(_=>C.Scalar<int>("SELECT id FROM job WHERE status='taken' AND taken_by=$p0",request.PlayerId));if(job==0)result["trouble"]="take a job first";else{string kind=S(body,"trouble");if(!new[]{"stowaway","broken_crate","customs","rival","weather"}.Contains(kind))kind="stowaway";await host.WithState(_=>C.Execute("DELETE FROM job_trouble WHERE job_id=$p0",job));var trouble=await MaybeTrouble(job,kind,C.Roll).ConfigureAwait(false);result["trouble"]=await host.WithState(_=>{if(trouble==null)return(JsonNode?)JsonValue.Create("that trouble does not fit this job");C.Execute("UPDATE job_trouble SET after_s=2 WHERE id=$p0",N(trouble,"id"));host.Publish("trouble",new JsonObject{["job_id"]=job});return TroubleView(job);});}}
        await host.WithState(_=>{PushIdeas();PushJobs();return true;});return result;
    }
    public void RegisterLifecycle(NativeServiceHost service)
    {
        service.Jobs.BoardExtras.Add(Check);service.TickAfterHooks.Add(_=>Check());service.RegisterAsync("POST","/api/dev/ideas",DevIdeas);
    }
}

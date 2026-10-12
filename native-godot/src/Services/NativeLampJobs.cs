using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Real dusk work on the current native lamp rounds, including a spare pole, range checks and deadlines.</summary>
public sealed class NativeLampJobs : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    private int lastHour=-1;
    public NativeLampJobs(NativeServiceHost host)=>this.host=host;
    private static JsonArray A(JsonNode? node)=>node as JsonArray??new();
    private static double V(JsonNode? n){if(n is JsonValue v){if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;}return 0;}
    private static double N(JsonNode? n,string key)=>V(n?[key]);
    private static string S(JsonNode? n,string key,string fallback="")=>n?[key]is JsonValue v&&v.TryGetValue<string>(out var s)?s:fallback;
    private static bool B(JsonNode? n,string key)=>n?[key]is JsonValue v&&v.TryGetValue<bool>(out var b)&&b;
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    public JsonArray Rounds()=>A(C.World("townlife_lamps")?["rounds"]);
    public JsonObject? Help()=>C.World("lamps_help")as JsonObject;
    public JsonObject? HelpNow(){var h=Help();return h!=null&&N(h,"day")==Day?h:null;}
    public static int StretchMost(int n)=>Math.Min(10,Math.Max(n/2,n-4>=5?5:0));
    public static int StretchOf(JsonObject round)
    {
        var lamps=A(round["lamps"]);var at=A(round["at"]);int n=lamps.Count,k=0;
        for(int t=5;t<=StretchMost(n);t++){
            if(lamps.Skip(n-t).Any(l=>S(l,"wicket")!=""))break;
            if((V(at[n-1])-V(at[n-t]))*1.1/1.55+t*3>150)break;
            k=t;
        }
        return k==0?-1:n-k;
    }
    public static double StretchWalk(JsonObject round,int from)=>V(A(round["at"])[A(round["lamps"]).Count-1])-V(A(round["at"])[from]);
    public static int Pay(int count,double walk)=>(int)Math.Floor((20+10*count+5*walk/50)/5+.5)*5;
    public static string Time(double h){int m=(int)Math.Floor(h*60+.5);return (m/60%24)+":"+(m%60).ToString("00");}
    public static bool FogAt(JsonObject? fog,double hour){if(fog==null)return false;bool on=B(fog,"start");foreach(var turn in A(fog["turns"]))if(N(turn,"h")<=hour)on=B(turn,"fog");return on;}
    public static JsonObject Times(JsonObject round,int k)
    {
        double eff=N(round,"len")+A(round["lamps"]).Count*14;if(eff==0)eff=1;
        double done=(V(A(round["at"])[k])+k*14+14*.6)/eff;
        return new(){["on"]=N(round,"dusk")+done*3.7,["off"]=5+done*3.7};
    }
    public JsonObject? BuildJob(string? roundId=null,int who=1)
    {
        var fit=Rounds().Where(r=>r is JsonObject o&&StretchOf(o)>=0).ToArray();
        var round=(roundId==null?(fit.Length==0?null:fit[Day%fit.Length]):fit.FirstOrDefault(r=>S(r,"id")==roundId))as JsonObject;
        if(round==null)return null;
        string lighter=S(round,"lamplighter");
        var npc=C.One("SELECT district,faction FROM npc WHERE id=$p0",lighter);if(npc==null)return null;
        int from=StretchOf(round);
        var lamps=new JsonArray(A(round["lamps"]).Skip(from).Select(l=>(JsonNode)new JsonObject{
            ["id"]=l!["id"]!.DeepClone(),["x"]=l["x"]!.DeepClone(),["z"]=l["z"]!.DeepClone(),
            ["sx"]=l["sx"]!.DeepClone(),["sz"]=l["sz"]!.DeepClone()
        }).ToArray());
        double open=Math.Ceiling(N(round,"dusk")*60-1e-6)/60,until=Math.Floor((open+2.25)*60+1e-6)/60;
        var band=A(host.Jobs.Plan.Data["tierPay"]?[host.Jobs.Tier(who)]);
        int pay=(int)Math.Max(V(band[0]),Math.Min(V(band[1]),Pay(lamps.Count,StretchWalk(round,from))));
        string title,pitch;
        if(Day%2==0){title="Lamps at dusk";pitch=$"My knee is bad tonight. Take the last {lamps.Count} lamps of my round: the spare pole leans on the first. Not one before {Time(open)}; a lamp lit in daylight wastes the town's gas. All of them burning by {Time(until)}.";}
        else{title="Light my last lamps";pitch=$"I have more lamps than legs this evening. The last {lamps.Count} of my round are yours, the pole waits at the first one. Start at {Time(open)}, when the light goes, and have them lit by {Time(until)}.";}
        return new(){["title"]=title,["employer"]=lighter,["pay_c"]=pay,["pitch"]=pitch,
            ["district"]=npc["district"]?.DeepClone(),["faction"]=npc["faction"]?.DeepClone(),
            ["task"]=new JsonObject{["kind"]="lamps",["goods"]="lamps",["round"]=S(round,"id"),["from"]=from,["lamps"]=lamps,
                ["pole"]=new JsonObject{["x"]=lamps[0]!["sx"]!.DeepClone(),["z"]=lamps[0]!["sz"]!.DeepClone()},
                ["open"]=open,["until"]=until,["take_by"]=Math.Floor((open+.75)*60+1e-6)/60,["twist"]="none",["limit_s"]=null}};
    }
    public int InsertJob(JsonObject j,int who=1)
    {
        C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status)VALUES($p0,$p1,$p2,$p3,'lamps',$p4,'low',$p5,NULL,$p6,$p7,'lamps','offered')",
            Day,S(j,"title"),S(j,"employer"),S(j,"district"),N(j,"pay_c"),host.Jobs.Tier(who),S(j,"pitch"),j["task"]!.ToJsonString());
        return C.Scalar<int>("SELECT last_insert_rowid()");
    }
    public int? OfferJob()
    {
        if(Hour<5||C.Scalar<int>("SELECT COUNT(*) FROM job WHERE day=$p0 AND source='lamps'",Day)>0||FogAt(host.Clock.FogView(),5))return null;
        var j=BuildJob();return j==null||Hour>=N(j["task"],"take_by")-.25?null:InsertJob(j);
    }
    private void Taking(JsonObject j,int who)
    {
        if(S(j,"source")=="lamps"&&S(j["task"],"kind")=="lamps"&&Hour>=N(j["task"],"take_by"))
            throw new NativeServiceException($"too late for that one: {S(j,"employer_name")} is out on his round and has lit them himself",409);
    }
    private void Taken(JsonObject j,int who)
    {
        if(S(j,"source")!="lamps"||S(j["task"],"kind")!="lamps")return;
        var t=j["task"]!;
        C.SetWorld("lamps_help",new JsonObject{["day"]=j["day"]!.DeepClone(),["round"]=t["round"]!.DeepClone(),["from"]=t["from"]!.DeepClone(),
            ["lit"]=new JsonArray(),["open"]=t["open"]!.DeepClone(),["until"]=t["until"]!.DeepClone(),["job"]=j["id"]!.DeepClone()});
    }
    private (JsonObject job,JsonObject task) InHand(int who,int id)
    {
        var j=host.Jobs.List(who).FirstOrDefault(row=>N(row,"id")==id)as JsonObject;
        if(j==null||S(j,"status")!="taken"||C.Scalar<int>("SELECT COUNT(*) FROM job WHERE id=$p0 AND taken_by=$p1",id,who)==0||j["task"]is not JsonObject t||S(t,"kind")!="lamps")
            throw new NativeServiceException("no lamps in hand",409);
        return(j,t);
    }
    private void SaveTask(int id,JsonObject t)
    {
        t["progress"]=new JsonObject{["delivered"]=A(t["lamps"]).Count(l=>B(l,"done")),["lost"]=0,["sold"]=0};
        C.Execute("UPDATE job SET task_json=$p0 WHERE id=$p1",t.ToJsonString(),id);
    }
    private static bool Within(double x,double z,JsonNode p)=>Math.Pow(x-N(p,"x"),2)+Math.Pow(z-N(p,"z"),2)<=3.2*3.2;
    public JsonObject TakePole(int who,int id,double x,double z)
    {
        var(j,t)=InHand(who,id);if(B(t,"picked"))return new(){["text"]="You have the pole already."};
        if(!Within(x,z,t["pole"]!))throw new NativeServiceException("the pole is not here",409);
        t["picked"]=true;SaveTask(id,t);
        var row=C.One("SELECT data_json FROM resident WHERE id=$p0",S(j,"employer_npc"));string? name=null;
        if(row!=null){var r=JsonNode.Parse(S(row,"data_json","{}"));name=S(r,"name").Split(' ')[0];}
        string first=name??S(j,"employer_name");
        return new(){["text"]=Hour<N(t,"open")?$"You take {first}'s spare pole. The lamps are lit from {Time(N(t,"open"))}, when the light goes.":$"You take {first}'s spare pole. {A(t["lamps"]).Count} lamps, all by {Time(N(t,"until"))}."};
    }
    public JsonObject Light(int who,int id,string lamp,double x,double z)
    {
        var(j,t)=InHand(who,id);var lamps=A(t["lamps"]);var l=lamps.FirstOrDefault(l=>S(l,"id")==lamp)as JsonObject;
        if(l==null)throw new NativeServiceException("that lamp is not one of yours",404);
        int Left()=>lamps.Count(l=>!B(l,"done"));
        if(B(l,"done"))return new(){["text"]="That one burns already.",["left"]=Left()};
        if(!B(t,"picked"))throw new NativeServiceException("fetch the pole first",409);
        if(!Within(x,z,new JsonObject{["x"]=l["sx"]!.DeepClone(),["z"]=l["sz"]!.DeepClone()}))throw new NativeServiceException("you cannot reach that lamp from here",409);
        if(Hour<N(t,"open"))throw new NativeServiceException($"too early: the lamps are lit from {Time(N(t,"open"))}",409);
        if(Hour>=N(t,"until"))throw new NativeServiceException($"too late: the lamps were to burn by {Time(N(t,"until"))}",409);
        l["done"]=true;
        C.Atomic(()=>{
            SaveTask(id,t);var help=Help();
            if(help!=null&&N(help,"job")==id&&!A(help["lit"]).Any(n=>n?.GetValue<string>()==lamp)){A(help["lit"]).Add(lamp);C.SetWorld("lamps_help",help);}
            C.Log(who,"lit_lamp",lamp,$"Jef lit a street lamp ({lamp}) on the round of {S(j,"employer_name")}.");
        });
        int n=Left();return new(){["text"]=n==0?"The gas catches. That was the last one.":$"The gas catches. {n} to go.",["left"]=n};
    }
    public int Expire()
    {
        int count=0;
        foreach(var node in C.Rows("SELECT id,day,status,title,employer_npc,task_json,taken_by FROM job WHERE source='lamps' AND status IN('offered','taken')")){
            var row=node!.AsObject();var t=JsonNode.Parse(S(row,"task_json"))!.AsObject();
            if(!(N(row,"day")<Day||(S(row,"status")=="offered"?Hour>=N(t,"take_by"):Hour>=N(t,"until")+.25)))continue;
            count++;int id=(int)N(row,"id");
            if(S(row,"status")=="offered"){C.Execute("UPDATE job SET status='expired' WHERE id=$p0",id);continue;}
            int who=row["taken_by"]==null?1:(int)N(row,"taken_by"),lit=A(t["lamps"]).Count(l=>B(l,"done"));
            if(lit>0){host.Jobs.Finish(who,id,new JsonObject{["delivered"]=lit,["lost"]=0,["sold"]=0,["pocketed"]=false,["late"]=false,["left_post_s"]=0,["thief"]="none",["bribe_taken"]=false,["seen_away"]=false});continue;}
            C.Atomic(()=>{C.Execute("UPDATE job SET status='failed' WHERE id=$p0",id);C.Log(who,"failed_job",id.ToString(),$"The lamps of \"{S(row,"title")}\" were not lit by {Time(N(t,"until"))}; the lamplighter lit them himself, late.");});
            host.Trade.Remember(who,S(row,"employer_npc"),"Jef took the last lamps of my round and never lit one. I lit them myself, late, in the dark.",4,"Jef left a lamplighter's lamps dark",-1);
        }
        return count;
    }
    private static double Position(NativeServiceRequest r,string field)
    {
        if(r.Body[field]is not JsonValue value||!value.TryGetValue<double>(out var n)||!double.IsFinite(n))throw new NativeServiceException("bad position",400);
        return n;
    }
    private static int JobId(NativeServiceRequest r)
    {
        // The original routes use Number(body.job); ordinary numeric strings remain valid.
        if(r.Body["job"]is not JsonValue value)return 0;
        double n;
        if(value.TryGetValue<double>(out var number))n=number;
        else if(value.TryGetValue<bool>(out var flag))n=flag?1:0;
        else if(value.TryGetValue<string>(out var text)&&double.TryParse(text,System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out var parsed))n=parsed;
        else return 0;
        return double.IsFinite(n)&&n==Math.Floor(n)&&n>=int.MinValue&&n<=int.MaxValue?(int)n:0;
    }
    private JsonObject WithPayload(int who,JsonObject result){foreach(var p in host.Payload(who))result[p.Key]=p.Value?.DeepClone();return result;}
    public void Register(NativeServiceHost service)
    {
        service.Register("POST","/api/lamps/pole",r=>WithPayload(r.PlayerId,TakePole(r.PlayerId,JobId(r),Position(r,"x"),Position(r,"z"))));
        service.Register("POST","/api/lamps/light",r=>{var result=Light(r.PlayerId,JobId(r),r.Text("lamp"),Position(r,"x"),Position(r,"z"));host.PublishState(r.PlayerId);return WithPayload(r.PlayerId,result);});
        service.Register("POST","/api/dev/lamps/job",r=>{
            var j=BuildJob(r.Body["round"]is JsonValue v&&v.TryGetValue<string>(out var id)?id:null,r.PlayerId)??throw new NativeServiceException("no lamplighter's round for that",409);
            int jobId=InsertJob(j,r.PlayerId);host.PublishState(r.PlayerId);
            var round=Rounds().First(o=>S(o,"id")==S(j["task"],"round"))!.AsObject();
            return new JsonObject{["id"]=jobId,["title"]=j["title"]!.DeepClone(),["pay_c"]=j["pay_c"]!.DeepClone(),["task"]=j["task"]!.DeepClone(),["employer"]=j["employer"]!.DeepClone(),["plan"]=Times(round,(int)N(j["task"],"from"))};
        });
        service.TakeJobChecks.Add(Taking);service.TakeJobHooks.Add(Taken);
        service.PayloadParts.Add(_=>new JsonObject{["lamps_help"]=HelpNow()});
        service.Jobs.BoardExtras.Add(()=>OfferJob());
        service.TickAfterHooks.Add(_=>{try{bool changed=Expire()>0;int hour=(int)Math.Floor(Hour);if(hour!=lastHour){lastHour=hour;if(OfferJob()!=null)changed=true;}if(changed)host.PublishState();}catch(Exception e){Console.Error.WriteLine("[native lamps] tick: "+e.Message);}});
        service.NewGame+=()=>lastHour=-1;service.Loaded+=()=>lastHour=-1;
    }
}

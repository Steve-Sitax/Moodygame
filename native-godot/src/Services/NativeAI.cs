using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed record NativeAiResult(bool Ok, JsonNode? Output, string? Error, long Milliseconds);

/// <summary>Asynchronous, bounded narration in process. Schemas and game modules retain authority over every number.</summary>
public sealed class NativeAI : INativeServiceModule, IDisposable
{
    private readonly NativeServiceHost host;
    private readonly NativeAiProviders providers;
    private readonly CancellationTokenSource closing = new();
    private readonly SemaphoreSlim slots = new(3,3);
    private readonly ConcurrentDictionary<string,SemaphoreSlim> hooks = new();
    public NativeAiConfiguration Settings { get; }
    public readonly Dictionary<string,Func<NativeAiRequest,CancellationToken,Task<NativeAiAnswer>>> Runners = new();
    public int TimeoutMilliseconds { get; set; } = 20000;
    /// <summary>Typed talk (the player waits with the box open) gets a quarter longer, at most 25 s; the client gives up at 30 s.</summary>
    public int TypedTimeoutMilliseconds { get; set; } = 25000;
    /// <summary>A retry starts only with at least this much time left; a retry that cannot finish is not started (fix 4).</summary>
    public int RetryMinimumMilliseconds { get; set; } = 6000;
    private int testing;
    /// <summary>The newest outcome per route (provider|model): a failed call with no later success says the AI is not answering.</summary>
    private readonly ConcurrentDictionary<string,(bool Ok,string Error,DateTime At)> outcomes = new();
    private static string Key(NativeAiRoute route) => route.Provider+"|"+route.Model;
    private void Note(NativeAiRoute route,bool ok,string error)
    {
        // a schema miss or a slow answer means the model is there; only a failure to reach it counts against readiness
        if(!ok&&(error.StartsWith("schema:",StringComparison.Ordinal)||error.StartsWith("timeout",StringComparison.Ordinal)||error.StartsWith("call budget",StringComparison.Ordinal)))return;
        outcomes[Key(route)]=(ok,error,DateTime.UtcNow);
    }
    /// <summary>Whether the AI can answer now, for the menu line and the typing box: off, no login, not answering, or ready.</summary>
    public (string State,string Title,string Text) Readiness()
    {
        if(Settings.Locked)return("off","AI off for this run",NativeAiConfiguration.LockedText);
        if(Settings.Mode=="walk")return("off","AI off","People answer with written lines and you pick from the choices. Turn AI on with the menu's AI item or in AI setup.");
        if(Settings.Kinds.All(k=>S(Settings.Effective(k),"provider")=="none"))return("off","No AI chosen","Every kind of work is set to the written lines. Pick an AI in Esc, AI setup.");
        var choice=Settings.ChoiceForHook("resident_talk");
        if(choice==null)return("ready","AI on, talk written","Conversations use the written lines; the rest of the town uses AI. Change it in Esc, AI setup.");
        var route=RouteOf("resident_talk",choice)!;
        if(!Runners.ContainsKey(route.Provider))
        {
            if(route.Provider=="claude"&&NativeAiProviders.FindClaude()==null)return("no_login","No AI login","Claude Code is not installed or not found on this PC. Open Esc, AI setup and pick another AI, or install Claude Code and log in.");
            if(route.Provider=="anthropic"&&S(Settings.Connection("anthropic_api"),"apiKey")=="")return("no_login","No AI login","No Anthropic API key is set. Open Esc, AI setup to enter one.");
            if(route.Provider=="openai"&&S(Settings.Connection("openai_compat"),"baseUrl")=="")return("no_login","No AI login","No address is set for the OpenAI-compatible AI. Open Esc, AI setup.");
        }
        if(outcomes.TryGetValue(Key(route),out var last)&&!last.Ok)
        {
            string why=last.Error.Length>140?last.Error[..140]+"...":last.Error;
            return("failing","AI not answering","The last call failed ("+why+"). People use written lines meanwhile. Open Esc, AI setup and press Test.");
        }
        return("ready","AI ready","Default: "+Settings.Label(Settings.Effective("talk"))+".");
    }
    /// <summary>True when the talk hook may call a model: AI on, a provider chosen, and a login or key in place.</summary>
    public bool CanUse(string hook)=>Settings.ChoiceForHook(hook)!=null&&Readiness().State!="no_login";
    public JsonObject View()
    {
        var view=Settings.View();var (state,title,text)=Readiness();
        view["status"]=new JsonObject{["state"]=state,["title"]=title,["text"]=text};view["locked"]=Settings.Locked;
        return view;
    }
    public NativeAI(NativeServiceHost host, string configuration, bool walk = false)
    {
        this.host = host;
        Settings = new NativeAiConfiguration(Path.Combine(host.Context.Options.DataDirectory,"native-ai.json"),configuration,walk);
        providers = new NativeAiProviders(Settings,Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configuration))!,"ai-cwd-native"));
        host.Context.Execute("UPDATE ai_call SET error='stopped by game restart' WHERE error='running'");
    }
    private static string S(JsonNode? n,string key) => NativeGoods.S(n,key);
    private NativeAiRoute DefaultRoute() => Model(Settings.Definitions["models"]!["opus"]!);
    private static NativeAiRoute Model(JsonNode node,string? why=null) => new(S(node,"provider"),S(node,"model"),S(node,"effort") is { Length: >0 } effort ? effort : null,why);
    public NativeAiRoute? RouteOf(string hook,JsonObject choice)
    {
        string provider = S(choice,"provider");
        if (provider == "none") return null;
        bool typed = Settings.Definitions["typedHooks"]!.AsArray().Any(n=>n!.GetValue<string>()==hook);
        if (provider == "recommended")
        {
            string key = Settings.Definitions["routes"]?[hook]?.GetValue<string>() ?? "opus";
            var route = Model(Settings.Definitions["models"]![key]!);
            if (route.Provider != "codex") return route;
            if (Environment.GetEnvironmentVariable("SCHELDEMIST_ALL_CLAUDE") == "1") return DefaultRoute() with { Overruled = "all_claude" };
            if (typed) return DefaultRoute() with { Overruled = "player_text" };
            if (NativeAiProviders.FindCodex() == null && !Runners.ContainsKey("codex")) return DefaultRoute() with { Overruled = "no_codex" };
            return route;
        }
        if (typed && Settings.TypedLines == "claude_only" && provider is not ("claude_local" or "anthropic_api"))
        {
            var preferred = Settings.Effective("_default");
            if (S(preferred,"provider") is "claude_local" or "anthropic_api") return RouteOf("ai_setup_test",preferred)! with { Overruled = "player_text" };
            return DefaultRoute() with { Overruled = "player_text" };
        }
        if (provider == "codex_cli" && Environment.GetEnvironmentVariable("SCHELDEMIST_ALL_CLAUDE") == "1") return DefaultRoute() with { Overruled = "all_claude" };
        if (provider == "codex_cli" && NativeAiProviders.FindCodex() == null && !Runners.ContainsKey("codex")) return DefaultRoute() with { Overruled = "no_codex" };
        string runner = provider switch { "claude_local"=>"claude","anthropic_api"=>"anthropic","codex_cli"=>"codex","openai_compat"=>"openai","ollama"=>"ollama",_=>throw new NativeServiceException("unknown provider") };
        return new(runner,S(choice,"model"),S(choice,"effort") is { Length: >0 } effort ? effort : null);
    }
    private Task<NativeAiAnswer> Run(NativeAiRequest request,CancellationToken stop) => Runners.TryGetValue(request.Route.Provider,out var runner) ? runner(request,stop) : providers.Run(request,stop);
    private async Task WaitOpen(CancellationToken stop)
    {
        while (!await host.WithState(_=>!host.Saves.Paused && S(host.Saves.Gate(),"mode")=="open").ConfigureAwait(false)) await Task.Delay(25,stop).ConfigureAwait(false);
        stop.ThrowIfCancellationRequested();
    }
    public async Task<NativeAiResult> Call(string hook,string system,string prompt,JsonObject schema,int playerId=1,Func<JsonNode?,bool>? validate=null)
    {
        var choice = Settings.ChoiceForHook(hook);
        if (choice == null) return new(false,null,"no AI (walk-around mode or hand-written for this kind)",0);
        await WaitOpen(closing.Token).ConfigureAwait(false);
        var watch = Stopwatch.StartNew();
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(closing.Token);
        bool typedHook = Settings.Definitions["typedHooks"]!.AsArray().Any(n=>n!.GetValue<string>()==hook);
        int timeout = typedHook ? Math.Clamp(Math.Min(TypedTimeoutMilliseconds,(int)Math.Min(25000L,Math.Max(TimeoutMilliseconds,1)*5L/4)),1,25000) : Math.Clamp(TimeoutMilliseconds,1,20000); limit.CancelAfter(timeout);
        var lane = hooks.GetOrAdd(hook+":"+playerId,_=>new SemaphoreSlim(1,1));
        bool hasLane=false,hasSlot=false;
        string error="no attempt";
        try
        {
            await lane.WaitAsync(limit.Token).ConfigureAwait(false); hasLane=true;
            await slots.WaitAsync(limit.Token).ConfigureAwait(false); hasSlot=true;
            choice = Settings.ChoiceForHook(hook);
            if (choice == null) return new(false,null,"no AI (walk-around mode or hand-written for this kind)",watch.ElapsedMilliseconds);
            var route = RouteOf(hook,choice)!;
            for(int attempt=0;attempt<2&&!limit.IsCancellationRequested;attempt++)
            {
                if(attempt>0&&timeout-watch.ElapsedMilliseconds<Math.Min(RetryMinimumMilliseconds,timeout/2)){error+="; no time left for a retry";break;}
                long booked = await host.WithState(c=> {
                    var clock=host.Clock.View();int day=NativeCoreClock.Number(clock,"day");
                    int cap=Settings.CallsPerDay;
                    if(cap>0&&c.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",day)>=cap)return 0L;
                    c.Execute("INSERT INTO ai_call(day,hour,hook,provider,model,ms,ok,error,player_id) VALUES($p0,$p1,$p2,$p3,$p4,0,0,'running',$p5)",day,NativeCoreClock.Number(clock,"hour"),hook,route.Provider,route.Model,playerId);
                    return c.Scalar<long>("SELECT last_insert_rowid()");
                }).ConfigureAwait(false);
                if(booked==0)return new(false,null,"call budget for this day used up",watch.ElapsedMilliseconds);
                var attemptWatch=Stopwatch.StartNew(); NativeAiAnswer? answer=null;bool accepted=false;string? fit=null;
                try
                {
                    answer=await Run(new(route,system,prompt,schema),limit.Token).WaitAsync(limit.Token).ConfigureAwait(false);
                    // small misses (a line a little long, a fourth choice, a weight of 0) are trimmed or clamped, not thrown away
                    var fitted=new List<string>();answer=answer with{Output=NativeAiSchema.Fit(answer.Output,schema,fitted)};
                    accepted=NativeAiSchema.Valid(answer.Output,schema)&&(validate?.Invoke(answer.Output)??true);
                    if(accepted&&fitted.Count>0)fit="fitted: "+string.Join(", ",fitted.Distinct().Take(6));
                    if(!accepted)error="schema: the answer did not fit the game's format"+(answer.Output!=null&&!NativeAiSchema.Valid(answer.Output,schema)?" ("+NativeAiSchema.Why(answer.Output,schema)+")":answer.Output==null?" (no answer)":" (engine check)");
                }
                catch(Exception e){error=limit.IsCancellationRequested?$"timeout after {timeout} ms":hook=="confession"?"the private reply could not be written":Settings.Scrub(e.Message);}
                string? failure=accepted?null:error[..Math.Min(500,error.Length)];
                Note(route,accepted,failure??"");
                await host.WithState(c=>c.Execute("UPDATE ai_call SET ms=$p0,in_tokens=$p1,out_tokens=$p2,cache_read=$p3,ok=$p4,error=$p5 WHERE id=$p6",attemptWatch.ElapsedMilliseconds,answer?.InputTokens,answer?.OutputTokens,answer?.CacheRead,accepted?1:0,failure??fit,booked)).ConfigureAwait(false);
                if(accepted){await WaitOpen(closing.Token).ConfigureAwait(false);return new(true,answer!.Output!.DeepClone(),null,watch.ElapsedMilliseconds);}
                if(route.Provider=="codex"&&S(choice,"provider")=="recommended"&&!error.StartsWith("schema:",StringComparison.Ordinal))route=DefaultRoute();
            }
            return new(false,null,error,watch.ElapsedMilliseconds);
        }
        catch(OperationCanceledException){return new(false,null,closing.IsCancellationRequested?"the game is closing":$"timeout after {timeout} ms",watch.ElapsedMilliseconds);}
        finally{if(hasSlot)slots.Release();if(hasLane)lane.Release();}
    }
    private static readonly JsonObject TestSchema = JsonNode.Parse("{\"type\":\"object\",\"properties\":{\"line\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":300}},\"required\":[\"line\"]}")!.AsObject();
    private async Task<NativeAiResult> TestRoute(NativeAiRoute route)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(closing.Token);
        limit.CancelAfter(Math.Clamp(TimeoutMilliseconds,1,20000)); var watch = Stopwatch.StartNew();
        try
        {
            var answer = await Run(new(route,"You write lines for townspeople in Antwerp in the autumn of 1873. Plain English. Answer only the JSON asked for.","A dock porter on the Rijnkaai greets a stranger on a grey morning. Write one short greeting, at most 20 words.",TestSchema),limit.Token).WaitAsync(limit.Token).ConfigureAwait(false);
            answer = answer with { Output = NativeAiSchema.Fit(answer.Output,TestSchema) };
            if (!NativeAiSchema.Valid(answer.Output,TestSchema)) throw new InvalidOperationException("The answer did not fit the game's format.");
            Note(route,true,"");
            return new(true,answer.Output,null,watch.ElapsedMilliseconds);
        }
        catch(Exception e) { string why=Settings.Scrub(limit.IsCancellationRequested?"No answer within 20 seconds.":e.Message); if(!limit.IsCancellationRequested)Note(route,false,why); return new(false,null,why,watch.ElapsedMilliseconds); }
    }
    private async Task<object?> Test(NativeServiceRequest request)
    {
        if(request.PlayerId!=1)throw new NativeServiceException("Only the host may change the AI settings.",403);
        if(Interlocked.Exchange(ref testing,1)!=0)throw new NativeServiceException("a test is already running",409);
        try
        {
            var targets=new List<(string Id,JsonObject Choice)>();
            if(request.Body["choice"] is JsonObject supplied)targets.Add(("choice",Settings.NormalChoice(supplied)));
            else if(request.Bool("all"))targets.AddRange(Settings.Kinds.Select(k=>(k,Settings.Effective(k))));
            else if(Settings.Kinds.Contains(request.Text("kind")))targets.Add((request.Text("kind"),Settings.Effective(request.Text("kind"))));
            else throw new NativeServiceException("send a kind, choice or all");
            var results=new JsonArray();
            var calls=new Dictionary<string,Task<NativeAiResult>>();
            var plans=new List<(string Target,JsonObject Choice,NativeAiRoute? Route)>();
            foreach(var target in targets)
            {
                IEnumerable<string> testHooks=S(target.Choice,"provider")!="recommended"?new[]{"ai_setup_test"}:target.Id=="choice"?Settings.Definitions["hooks"]!.AsObject().SelectMany(p=>p.Value!.AsArray().Select(n=>n!.GetValue<string>())):Settings.Definitions["hooks"]![target.Id]!.AsArray().Select(n=>n!.GetValue<string>());
                var routes=testHooks.Select(h=>RouteOf(h,target.Choice)).Distinct().ToArray();
                foreach(var route in routes)
                {
                    plans.Add((target.Id,target.Choice,route));
                    if(route!=null) {string key=route.Provider+"|"+route.Model+"|"+route.Effort;if(!calls.ContainsKey(key))calls[key]=TestRoute(route);}
                }
            }
            await Task.WhenAll(calls.Values).ConfigureAwait(false);
            foreach(var plan in plans)
            {
                    var route=plan.Route;
                    string provider=route?.Provider switch {"claude"=>"claude_local","codex"=>"codex_cli","anthropic"=>"anthropic_api","openai"=>"openai_compat","ollama"=>"ollama",_=>S(plan.Choice,"provider")};
                    var row=new JsonObject{["target"]=plan.Target,["label"]=Settings.Label(plan.Choice),["provider"]=provider,["model"]=route?.Model,["ok"]=true,["ms"]=0};
                    if(route==null)row["note"]="No AI: the game uses its hand-written lines.";
                    else
                    {
                        var answer=await calls[route.Provider+"|"+route.Model+"|"+route.Effort].ConfigureAwait(false);
                        row["ok"]=answer.Ok;row["ms"]=answer.Milliseconds;
                        if(answer.Ok)
                        {
                            string line=NativeCoreInteriors.PlainEnglish(S(answer.Output,"line"));row["line"]=line[..Math.Min(200,line.Length)];
                        }
                        else row["error"]=answer.Error;
                    }
                    results.Add(row);
            }
            return new JsonObject{["results"]=results};
        }
        finally{Interlocked.Exchange(ref testing,0);}
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/ai/config",r=>{var view=View();view["host"]=r.PlayerId==1;return view;});
        service.Register("PUT","/api/ai/config",r=>{if(r.PlayerId!=1)throw new NativeServiceException("Only the host may change the AI settings.",403);if(Settings.Locked)throw new NativeServiceException(NativeAiConfiguration.LockedText,409);Settings.Patch(r.Body);var view=View();view["host"]=true;
            // every player (a guest too) hears at once whether AI is on: the typing box follows without a restart
            host.Publish("ai",new JsonObject{["mode"]=view["mode"]!.DeepClone(),["status"]=view["status"]!.DeepClone()});return view;});
        service.RegisterAsync("POST","/api/ai/test",Test);
    }
    public void Dispose(){closing.Cancel();providers.Dispose();}
}

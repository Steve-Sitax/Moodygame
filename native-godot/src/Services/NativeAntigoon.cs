using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Services;

/// <summary>One shared giant. Requests advance a single real-time clock; hits are checked on the host.</summary>
public sealed partial class NativeAntigoon : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private AntigoonBrain? brain;
    private long last, saved;
    public Func<int,P?> PositionOf = _=>null;
    public Func<P,bool> Clear = _=>false;
    public Func<P,double> Ground = _=>0;
    public Func<P,double> Light = _=>1;
    public Func<P,P,IReadOnlyList<P>?> Path = (_,_)=>null;
    public Func<P,P,bool> Sight = (_,_)=>false;
    public Func<P,P,bool>? SpawnVisible;
    public Func<P,bool> BackAlley = _=>true;
    public Func<P,P?> Snap = p=>p;
    private long spawnAttempt;
    public NativeAntigoon(NativeServiceHost host)=>this.host=host;
    private double Hour { get { var c=host.Clock.View();return NativeGoods.Number(c["hour"])+NativeGoods.Number(c["minute"])/60; } }
    private bool Night=>Hour>=20||Hour<6;
    public void Register(NativeServiceHost service)
    {
        RegisterEvent(service);
        RegisterDevelopment(service);
        service.Register("GET","/api/antigoon",r=>{Advance();return View(r.PlayerId);});
        service.Register("POST","/api/antigoon/investigate",r=>
        {
            if(host.MultiplayerEnabled())throw new NativeServiceException("The scripted investigation is single-player only.",409);
            host.Context.SetPlayerState(r.PlayerId,"antigoon_quest",JsonValue.Create("investigate"));
            Advance();return View(r.PlayerId);
        });
        service.Register("POST","/api/antigoon/strike",r=>
        {
            if(host.Saves.Paused)throw new NativeServiceException("The town is paused.",409);
            Advance();bool hit=brain!=null&&PositionOf(r.PlayerId) is {} p&&brain.Strike(new(r.PlayerId,p,Available(r.PlayerId)));
            if(hit)Save();var v=View(r.PlayerId);v["hit"]=hit;return v;
        });
        service.NewGame+=Reset;service.Loaded+=Reset;
    }
    private void Reset(){brain=null;last=0;saved=0;spawnAttempt=0;street=null;observed.Clear();}
    private bool Available(int id)=>NativeGoods.Number(host.Player(id)["health"])>0&&host.Clock.Where(id)["shelter"]?.GetValue<string>()=="outside";
    private void Advance()
    {
        long now=host.Context.Now;
        if(host.Saves.Paused){last=now;return;}
        var players=host.OnlinePlayers().Distinct().Select(id=>(id,p:PositionOf(id))).Where(v=>v.p!=null).Select(v=>new AntigoonBrain.Player(v.id,v.p!.Value,Available(v.id))).ToArray();
        if(brain==null)
        {
            if(!Night||players.Length==0){last=now;return;}
            if(host.Context.World("antigoon") is JsonObject old)
            {
                var home=new P(NativeGoods.Number(old["hx"]),NativeGoods.Number(old["hz"]));
                if(Clear(home)){Create(home);brain!.Restore(new P(NativeGoods.Number(old["x"]),NativeGoods.Number(old["z"])),(int)NativeGoods.Number(old["health"]));}
            }
            if(brain==null&&now>=spawnAttempt)
            {
                spawnAttempt=now+5000;
                P from=players[0].At;
                for(int i=0;i<96;i++)
                {
                    double a=i*Math.PI*2/32,r=28+i/32*18;var candidate=Snap(new P(from.X+Math.Sin(a)*r,from.Z+Math.Cos(a)*r));if(candidate is not {} p)continue;
                    if(!Clear(p)||!BackAlley(p)||Light(p)>=.25||players.Any(v=>(SpawnVisible??Sight)(v.At,p))||Path(p,from)==null)continue;
                    Create(p);Save();break;
                }
            }
        }
        double elapsed=last==0||now-last>1000?0:Math.Clamp((now-last)/1000.0,0,.5);last=now;
        if(brain==null)return;
        var witnesses=observed.Values.Where(v=>now-v.At<1500).Select(v=>v.Person).ToArray();
        while(elapsed>.0001){double dt=Math.Min(.05,elapsed);street!.Step(dt,Night,brain,witnesses);brain.Step(dt,Night,players.Concat(street.Targets()).ToArray());elapsed-=dt;}
        if(now-saved>2000)Save();
    }
    private void Create(P home)
    {
        street=new(){HumanPath=HumanPath,HumanClear=HumanClear,Lamps=()=>Lighting?.Targets()??Array.Empty<AntigoonNightEvent.Lamp>(),Extinguish=id=>Lighting?.Extinguish(id)};
        brain=new(home){Clear=Clear,Light=Light,Path=Path,Sight=Sight,HurtPlayer=(id,damage)=>
        {
            if(id<0){street.KnockDown(id);return;}
            host.Context.Execute("UPDATE player SET health=MAX(0,health-$p0) WHERE id=$p1",damage,id);
            if(NativeGoods.Number(host.Player(id)["health"])<=0)host.Clock.End(id,"health");
            host.PublishState(id);
        }};
        for(int i=0;i<16;i++)
        {
            double a=i*Math.PI/8;var candidate=Snap(new(home.X+Math.Sin(a)*(16+i%3*12),home.Z+Math.Cos(a)*(16+i%3*12)));
            if(candidate is {} p&&Clear(p)&&Path(home,p)!=null)brain.Patrol.Add(p);
        }
        // Preserve usable intermediate street points when radial destinations fall inside houses.
        foreach(int id in host.OnlinePlayers())if(PositionOf(id) is {} eye&&Path(home,eye) is {} approach)
            foreach(var p in approach.Where(p=>p.Distance(home)>6&&p.Distance(home)<55))
                if(brain.Patrol.All(q=>q.Distance(p)>7))brain.Patrol.Add(p);
        brain.Patrol.Add(home);
    }
    private void Save()
    {
        if(brain==null)return;saved=host.Context.Now;
        host.Context.SetWorld("antigoon",new JsonObject{["x"]=brain.Position.X,["z"]=brain.Position.Z,["hx"]=brain.Home.X,["hz"]=brain.Home.Z,["health"]=brain.Health});
    }
    private JsonObject View(int player)
    {
        var v=new JsonObject{["active"]=brain!=null&&brain.State!="hidden",["night"]=Night,["multiplayer"]=host.MultiplayerEnabled(),["quest"]=host.Context.PlayerState(player,"antigoon_quest")?.DeepClone(),["server_ms"]=host.Context.Now};
        if(brain!=null){v["x"]=brain.Position.X;v["y"]=Ground(brain.Position);v["z"]=brain.Position.Z;v["yaw"]=brain.Yaw;v["health"]=brain.Health;v["state"]=brain.State;v["state_time"]=brain.StateTime;v["attack_serial"]=brain.AttackSerial;v["target"]=brain.Target;}
        EventView(v);
        return v;
    }
}

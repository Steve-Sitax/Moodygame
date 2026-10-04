using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>Night gang demand: the server chooses the men, demand, risk and outcome.</summary>
[GamePart(352)]
public partial class Gangs : Node
{
    public static Gangs? I { get; private set; }
    public GangView? Gang { get; private set; }
    public GangReply? LastReply { get; private set; }
    public bool CardOpen => card.IsOpen;
    private readonly List<Townspeople.Sim> held = new();
    private readonly List<Puppet> extras = new();
    private readonly List<GangPerson> near = new();
    private Townspeople? town;
    private Window card = null!;
    private ColorRect veil = null!;
    private Label line = null!;
    private double rollT = 10, moveT, answerT, veilT;
    private bool arriving, busy, disposed, pushBound;
    private Api? Api => ServerLink.I?.Api;
    public override void _Ready()
    {
        I = this; town = Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        card = new Window("gang", Write, Key) { Cursor = false, EscCloses = false };
        veil = new ColorRect { Color = new Color(.035f,.025f,.02f,.8f),Visible=false,MouseFilter=Control.MouseFilterEnum.Ignore };
        veil.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        line = new Label { HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,AutowrapMode=TextServer.AutowrapMode.WordSmart };
        line.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect); veil.AddChild(line); Main.I.Ui.AddChild(veil);
        ServerLink.I?.WhenUp(() => { _ = Load(); if (!pushBound && Api != null) { Api.OtherPushed += OnPush; pushBound = true; } });
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Replaced;
    }
    private void Replaced(string how, ClientState? state) { Clear(); _ = Load(); }
    private void OnPush(PushMsg push)
    {
        if (push.Type != "gang" || !push.Body.TryGetProperty("gang",out var row) || row.ValueKind != System.Text.Json.JsonValueKind.Object) return;
        var gang = row.Deserialize<GangView>(Api.Json); if (gang != null) Show(gang);
    }
    public async System.Threading.Tasks.Task Load()
    {
        if (Api == null || disposed) return;
        try { if ((await Api.GangState()).Gang is { } g) Show(g); }
        catch (ApiException) { }
    }
    private GangFacts Facts()
    {
        float x=Jef.I.X,z=Jef.I.Z; bool lit=Deeds.I?.Lit==true;
        if (!lit && (GameState.I.HourF>=18.5 || GameState.I.HourF<6.2) && Lights.I!=null)
            foreach (var lamp in Lights.I.Lamps) if (new Vector2(lamp.at.X-x,lamp.at.Z-z).LengthSquared()<64) { lit=true; break; }
        bool quay=false;
        for(int i=0;i<8;i++) { float a=i*MathF.PI/4; if(Water.In(x+MathF.Cos(a)*6,z+MathF.Sin(a)*6)) { quay=true; break; } }
        near.Clear(); if(town!=null) foreach(var s in town.Sims) if(s.P!=null && !s.Inside && (s.P.X-x)*(s.P.X-x)+(s.P.Z-z)*(s.P.Z-z)<3600) near.Add(new GangPerson(s.R.Id,s.P.X,s.P.Z));
        return new GangFacts(x,z,lit,quay,GameState.I.Where().At!=null,Goods.I?.Carried!=null,new List<GangPerson>(near));
    }
    public async System.Threading.Tasks.Task Roll(bool force=false)
    {
        if (busy || Gang!=null || Api==null) return; busy=true;
        try { if ((await Api.GangRoll(Facts(),force)).Gang is { } g) Show(g); }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { busy=false; }
    }
    private void Show(GangView gang)
    {
        if (Gang?.Id==gang.Id) return;
        Clear(); Gang=gang; arriving=true; answerT=14; moveT=0;
        if (town?.Crowd==null) return;
        int count=Math.Max(3,gang.Members);
        for(int i=0;i<count;i++)
        {
            Townspeople.Sim? sim=null;
            if (i<gang.Lads.Count) sim=town.ClaimPlayerPerson(gang.Lads[i],this,gang.X+Math.Cos(i*2.1)*9,gang.Z+Math.Sin(i*2.1)*9);
            if(sim?.P!=null) held.Add(sim);
            else
            {
                var open=town.Crowd.OpenNear(gang.X+Math.Cos(i*2.1)*9,gang.Z+Math.Sin(i*2.1)*9);
                var p=open is { } pos ? town.Crowd.AddPuppet("thief",pos.x,pos.z) : null;
                if(p!=null) extras.Add(p);
            }
        }
    }
    private Sheet? Write()
    {
        if (Gang==null) return null;
        var sheet=Deeds.Paper("A gang blocks your way","Three men, hands in their coats. Nobody else about.");
        sheet.Text("\"Evening, friend. That purse looks heavy. " + Gang.DemandC + " centimes and you walk on.\"",Face.Print,18,bottom:15);
        sheet.Keys("R  run · F  fight · H  shout for the watch · P  pay " + Gang.DemandC + " c");
        return sheet;
    }
    private void Key(string code,string key)
    {
        string? how=code switch { "KeyR"=>"run","KeyF"=>"fight","KeyH"=>"shout","KeyP"=>"pay",_=>null };
        if(how!=null) _=Answer(how);
    }
    public async System.Threading.Tasks.Task Answer(string how)
    {
        if (busy || Gang==null || Api==null) return; busy=true;
        try
        {
            var reply=await Api.GangAnswer(Gang.Id,how,Facts()); if(disposed)return; LastReply=reply;
            GameState.I.Apply(reply); var r=reply.Result;
            if(r.Hands!="keep") Goods.I?.DropCarried(r.Hands=="taken"?"taken":"snatched");
            if(r.Outcome=="robbed") { veil.Visible=true; line.Text=r.Text; veilT=7+r.Text.Length/40.0; }
            else GameState.I.Say(r.Text);
            Clear();
        }
        catch(ApiException e) { GameState.I.Say(e.Message); }
        finally { busy=false; }
    }
    private void Clear()
    {
        card.Close(); Gang=null; arriving=false;
        if(town!=null) foreach(var sim in held) town.ActionRelease(sim,this);
        held.Clear(); if(town?.Crowd!=null) foreach(var p in extras) town.Crowd.RemovePuppet(p); extras.Clear();
    }
    public override void _Process(double delta)
    {
        if (disposed) return;
        if(veil.Visible && (veilT-=delta)<=0) veil.Visible=false;
        if(Gang==null)
        {
            if((rollT-=delta)<=0) { rollT=10; if(GameState.I.Live && !Day.I.Busy && (GameState.I.HourF>=20 || GameState.I.HourF<5) && GameState.I.Where().At==null) _=Roll(); }
            return;
        }
        if (town?.Crowd==null) return;
        if(arriving)
        {
            if((moveT-=delta)>0) return; moveT=.2;
            int close=0, count=0;
            foreach(var sim in held) if(sim.P is { } p) { double a=count++*2.1,tx=Jef.I.X+Math.Cos(a)*2.7,tz=Jef.I.Z+Math.Sin(a)*2.7; if((p.X-tx)*(p.X-tx)+(p.Z-tz)*(p.Z-tz)<4)close++; else town.Crowd.PuppetGo(p,tx,tz,2.3); }
            foreach(var p in extras) { double a=count++*2.1,tx=Jef.I.X+Math.Cos(a)*2.7,tz=Jef.I.Z+Math.Sin(a)*2.7; if((p.X-tx)*(p.X-tx)+(p.Z-tz)*(p.Z-tz)<4)close++; else town.Crowd.PuppetGo(p,tx,tz,2.3); }
            if(close>=Math.Min(2,count) || (answerT-=.2)<=-11) { arriving=false; answerT=14; card.Open(); GameState.I.Say("The gang closes round you. " + Gang.DemandC + " centimes and you walk on."); }
        }
        else if(!busy && (answerT-=delta)<=0) _=Answer("stand");
    }
    public override void _ExitTree()
    {
        disposed=true; Clear(); veil.QueueFree(); if(Api!=null) Api.OtherPushed-=OnPush;
        if(Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced-=Replaced;
        if(I==this) I=null;
    }
}

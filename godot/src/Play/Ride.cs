using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>Browser ride.ts: the live back step, platform, aisle, seats, roof and conductor.</summary>
[GamePart(920)]
public partial class Ride : Node, IDialog
{
    public static Ride I { get; private set; } = null!;
    public Omnibus.Bus? Bus { get; private set; }
    public int Seat { get; private set; } = -1;
    public Vector2 WalkAt { get; private set; } = new(0, -1.5f);
    public bool Busy { get; private set; }
    public bool Unpaid { get; private set; }
    public bool FareOpen => page == "fare";
    public bool Riding => Bus != null;
    public string DialogName => page == "fare" ? "conductor" : "stop timetable";
    private string page = "", words = "";
    private Sheet? sheet;
    private string sheetFor = "";
    private float fareWait, putOffWait, lastYaw;
    private int putOffTries;
    private bool puttingOff;
    private OmnibusLines.Stop? lastStop;
    private readonly Func<float, bool> drive;
    private Func<bool>? jumpBefore;
    private RideSaved? savedRide;
    private int epoch;
    public event Action<string, RideReply>? Answered;
    public Ride() { I = this; drive = Drive; }
    public override void _Ready()
    {
        Interact.I.AddProvider(Keys);
        foreach (var stop in RideStops.All)
        {
            string id = stop.Id;
            Interact.I.Add(new Vector3(stop.X, 1.5f, stop.Z), 1.8f, () => Riding ? null : "read the timetable", () => _ = Timetable(id));
        }
        Jef.I.ProcessPriority = 10; // after the movers, before his own step
        jumpBefore = Jef.I.OnJump;
        Jef.I.OnJump = Jump;
        Dialogs.I!.Resized += Render;
        ServerLink.I?.WhenUp(() => _ = Restore());
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Replaced;
    }
    public override void _ExitTree()
    {
        if (Jef.I.OnJump == Jump) Jef.I.OnJump = jumpBefore;
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        if (Dialogs.I != null) Dialogs.I.Resized -= Render;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Replaced;
    }
    private void Replaced(string how, Scheldemist.Net.ClientState? client)
    {
        epoch++;savedRide=RideSaves.Read<RideSaved>(client,"ride");
        Close();
        if (Bus != null) { Omnibus.I.SetPlayerSeat(Bus, -1); Omnibus.I.HoldPlayer(Bus, false); }
        Bus = null; Seat = -1; Unpaid = false; Busy = false; puttingOff = false;
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        _ = Restore();
    }
    private async Task Restore()
    {
        if (ServerLink.I?.Api is not { } api) return;
        int e=epoch;try { var p = await api.Jobs();if(e!=epoch)return;if(savedRide==null)savedRide=await RideSaves.ReadRide(api);if(e!=epoch)return;
            if(savedRide is {Kind:"omnibus"} back&&p.Ride?.On is {} ticket&&int.TryParse(back.Id,out int index))
            {foreach(var bus in Omnibus.I.Buses)if(bus.Index==index&&bus.Line.Id==ticket.Line){Start(bus);WalkAt=Inside(back.X,back.Z)?new(back.X,back.Z):new(0,-1.5f);if(back.Seat>=0)Sit(back.Seat);Drive(0);savedRide=null;return;}}
            savedRide=null;if (p.Ride?.On != null && !Riding) Take("restore", await api.Ride("alight", "")); }
        catch (ApiException error) { GameState.I.Say(error.Message); }
    }
    public static Vector3 StepOf(Omnibus.Bus b) => b.Frame.ToGlobal(new Vector3(0, 0, -2.6f));
    private bool Eligible => !Riding && !Busy && !Jef.I.Swimming && !Jef.I.Climbing && !Jef.I.Riding;
    private Omnibus.Bus? RollingNear()
    {
        if (!Eligible || Jef.I.Laden || Omnibus.I == null) return null;
        Omnibus.Bus? best = null;
        float bd = 2;
        foreach (var b in Omnibus.I.Buses)
        {
            if (b.At != null || b.V < .3f) continue;
            var s = StepOf(b); float d = new Vector2(s.X - Jef.I.X, s.Z - Jef.I.Z).Length();
            if (d < bd) { best = b; bd = d; }
        }
        return best;
    }
    private bool Jump()
    {
        var b = RollingNear();
        if (b == null) return jumpBefore?.Invoke() ?? false;
        Hop(b); return true;
    }
    private Offers? Keys(float x, float z)
    {
        if (!Scheldemist.Dev.SpeedComparison.Cached || Riding) return KeysOriginal(x, z);
        return WalkingKeys(x, z);
    }
    private readonly Offers walkingOffers = new() { Options = new() };
    public bool SameKeys(float x, float z) => Scheldemist.Dev.OfferComparison.Same(() => KeysOriginal(x, z), () => Riding ? KeysOriginal(x, z) : WalkingKeys(x, z));
    private Offers? WalkingKeys(float x, float z)
    {
        if (!Eligible || Omnibus.I == null) return null;
        var options = walkingOffers.Options!; options.Clear();
        foreach (var b in Omnibus.I.Buses)
        {
            var s = StepOf(b); float distance = new Vector2(s.X - x, s.Z - z).Length();
            if (b.At != null && distance <= 2.8f) options.Add((distance - .5f, BoardAction(b, s)));
        }
        if (RollingNear() is { } rolling) options.Add((-.5f, HopAction(rolling, StepOf(rolling))));
        return walkingOffers;
    }
    private Act BoardAction(Omnibus.Bus bus, Vector3 step)
    {
        int fare = GameState.I.Payload?.Ride?.FareC ?? 0;
        bool change = GameState.I.Payload?.Ride?.Change is { } c && c.FromLine != bus.Line.Id;
        return Act.AtGround(Key.E, $"get on the {bus.Line.Board} omnibus ({(change ? "a free change" : fare + " c")})", step.X, step.Z, () => _ = Board(bus));
    }
    private Act HopAction(Omnibus.Bus bus, Vector3 step) => Act.AtGround(Key.E, "jump onto the " + bus.Line.Board + " omnibus (E or Space)", step.X, step.Z, () => Hop(bus));
    private Offers? KeysOriginal(float x, float z)
    {
        if (Riding)
        {
            var only = new List<Act>();
            if (!Busy && !puttingOff)
            {
                if (Seat >= 0) only.Add(Act.Me(Key.E, Seat >= 12 ? "climb down from the roof" : "stand up", Stand));
                else
                {
                    if (Bus!.At is { } stop) only.Add(Act.Me(Key.E, "get off at " + stop.Name, () => _ = Leave()));
                    else if ((WalkAt - new Vector2(0, -1.5f)).Length() < .9f && Landing() != null) only.Add(Act.Me(Key.E, "jump off", () => _ = Leave()));
                    else
                    {
                        int i = LookedAtSeat();
                        if (i >= 0) only.Add(Act.Me(Key.E, "sit down here", () => Sit(i)));
                    }
                    if ((WalkAt - new Vector2(-.45f, -1.6f)).Length() < .85f && !Jef.I.Laden) only.Add(Act.Me(Key.F, "climb up to the roof seat", () => Sit(12)));
                }
            }
            return new Offers { Only = only };
        }
        if (!Eligible || Omnibus.I == null) return null;
        var options = new List<(float, Act)>();
        foreach (var b in Omnibus.I.Buses)
        {
            var s = StepOf(b); float d = new Vector2(s.X - x, s.Z - z).Length();
            if (b.At != null && d <= 2.8f)
            {
                int fare = GameState.I.Payload?.Ride?.FareC ?? 0;
                bool change = GameState.I.Payload?.Ride?.Change is { } c && c.FromLine != b.Line.Id;
                options.Add((d - .5f, Act.AtGround(Key.E, $"get on the {b.Line.Board} omnibus ({(change ? "a free change" : fare + " c")})", s.X, s.Z, () => _ = Board(b))));
            }
        }
        var rolling = RollingNear();
        if (rolling != null) { var s = StepOf(rolling); options.Add((-.5f, Act.AtGround(Key.E, "jump onto the " + rolling.Line.Board + " omnibus (E or Space)", s.X, s.Z, () => Hop(rolling)))); }
        return new Offers { Options = options };
    }
    public async Task Board(Omnibus.Bus b)
    {
        if (!Eligible || b.At == null) return;
        if (Jef.I.Laden) { GameState.I.Say("The conductor shakes his head. No goods on the omnibus."); return; }
        int e=epoch;Busy = true; Omnibus.I.HoldPlayer(b, true);
        try { var reply=await ServerLink.I!.Api!.Ride("board", b.At.Id, b.Line.Id);if(e!=epoch)return;Take("board",reply);Start(b); }
        catch (ApiException error) { GameState.I.Say(error.Message); }
        finally { Omnibus.I.HoldPlayer(b, false); Busy = false; }
    }
    public void Hop(Omnibus.Bus b)
    {
        if (!Eligible || Jef.I.Laden) return;
        Start(b); Unpaid = true; fareWait = 1.8f;
        GameState.I.Say("You run, grab the brass rail and swing up onto the back platform.");
    }
    private void Start(Omnibus.Bus b)
    {
        Bus = b; Seat = -1; WalkAt = new Vector2(0, -1.5f); lastYaw = b.Yaw; lastStop = b.At;
        Jef.I.Yaw = b.Yaw + MathF.PI; Jef.I.DrivenEye = Jef.Eye; Jef.I.Drive = drive;
        Drive(0);
    }
    private static bool Inside(float x, float z) =>
        x >= -.55f && x <= .55f && z >= -1.77f && z <= -1.17f ||
        x >= -.18f && x <= .18f && z >= -1.25f && z <= -.9f ||
        x >= -.26f && x <= .26f && z >= -.95f && z <= 2.85f;
    private bool Drive(float dt)
    {
        if (Bus == null) return false;
        var j = Jef.I; float dr = Mathf.Wrap(Bus.Yaw - lastYaw, -MathF.PI, MathF.PI); lastYaw = Bus.Yaw;
        if (Seat < 0 && !j.Frozen)
        {
            float fx = (j.KeyDown(Key.D) || j.KeyDown(Key.Right) ? 1 : 0) - (j.KeyDown(Key.A) || j.KeyDown(Key.Left) ? 1 : 0);
            float fz = (j.KeyDown(Key.S) || j.KeyDown(Key.Down) ? 1 : 0) - (j.KeyDown(Key.W) || j.KeyDown(Key.Up) ? 1 : 0);
            var v = new Vector2(fx, fz).LimitLength() * Jef.Walk * dt;
            float a = j.Yaw - Bus.Yaw, c = MathF.Cos(a), s = MathF.Sin(a);
            float nx = WalkAt.X + v.X * c + v.Y * s, nz = WalkAt.Y - v.X * s + v.Y * c;
            if (Inside(nx, nz)) WalkAt = new(nx, nz);
            else if (Inside(nx, WalkAt.Y)) WalkAt = new(nx, WalkAt.Y);
            else if (Inside(WalkAt.X, nz)) WalkAt = new(WalkAt.X, nz);
        }
        Vector3 at = Seat < 0 ? new(WalkAt.X, WalkAt.Y < -1.15f ? .74f : .83f, WalkAt.Y) : SeatAt(Seat);
        if (Seat >= 0) at.X *= Seat >= 12 ? 1.15f : 1.02f;
        j.DrivenEye = Seat < 0 ? Jef.Eye : .78f;
        j.Carry(Bus.Frame.ToGlobal(at), dr);
        return true;
    }
    public static Vector3 SeatAt(int i) => i < 12 ? new(i < 6 ? -.6f : .6f, 1.26f, -.63f + i % 6 * .64f) : new(i < 16 ? -.32f : .32f, 2.97f, -.5f + (i - 12) % 4 * .95f);
    private int LookedAtSeat()
    {
        if (Bus == null) return -1;
        var eye = Jef.I.Cam.GlobalPosition; var forward = -Jef.I.Cam.GlobalBasis.Z;
        float best = .9f; int seat = -1;
        for (int i = 0; i < 12; i++)
        {
            if (Omnibus.I.Passengers(Bus).Any(p => p.Seat == i)) continue;
            var d = Bus.Frame.ToGlobal(SeatAt(i) + Vector3.Up * .25f) - eye;
            if (d.Length() > 2.6f) continue;
            float dot = d.Normalized().Dot(forward);
            if (dot > best) { best = dot; seat = i; }
        }
        return seat;
    }
    public void Sit(int i)
    {
        if (Bus == null || i < 0 || i >= 20 || Omnibus.I.Passengers(Bus).Any(p => p.Seat == i)) return;
        Seat = i; Omnibus.I.SetPlayerSeat(Bus, i);
        Jef.I.Yaw = Bus.Yaw + (i < 6 || i >= 16 ? -MathF.PI / 2 : MathF.PI / 2); Jef.I.Pitch = -.05f;
        if (i >= 12) { GameState.I.Say("You climb the iron rungs to the roof and sit on the long bench, your back to the other side."); _ = SeatReport("roof"); }
    }
    public void Stand()
    {
        if (Bus == null || Seat < 0) return;
        WalkAt = Seat >= 12 ? new(-.45f, -1.6f) : new(SeatAt(Seat).X * .3f, SeatAt(Seat).Z);
        if (Seat >= 12) _ = SeatReport("inside");
        Omnibus.I.SetPlayerSeat(Bus, -1); Seat = -1;
    }
    private async Task SeatReport(string place)
    {
        try { Take("seat", await ServerLink.I!.Api!.Ride("seat", "", place: place)); }
        catch (ApiException error) { GameState.I.Say(error.Message); }
    }
    private Vector3? Landing()
    {
        if (Bus == null) return null;
        var p = Bus.Frame.ToGlobal(new Vector3(0, 0, -1.45f));
        var step = StepOf(Bus);
        for (int i = 0; i < 3; i++)
        {
            var s = i == 0 ? step : p + Bus.Frame.GlobalBasis.X * (i == 1 ? 1.6f : -1.6f);
            float ground = Jef.I.GroundAt(s.X, s.Z, .1f);
            if (float.IsFinite(ground) && ground > -.6f && !Water.In(s.X, s.Z) && Jef.I.BodyFree(s.X, ground, s.Z)) return new(s.X, ground, s.Z);
        }
        return null;
    }
    public async Task Leave(string text = "")
    {
        if (Bus == null || Busy) return;
        var spot = Landing(); if (spot == null) { GameState.I.Say("There is no room to land here."); return; }
        var bus = Bus; bool unpaid = Unpaid;
        Close(); Unpaid = false; puttingOff = false; Seat = -1; Omnibus.I.SetPlayerSeat(bus, -1);
        Bus = null; Jef.I.Drive = null; Jef.I.DrivenEye = Jef.Eye;
        Jef.I.Place(spot.Value.X, spot.Value.Z, Jef.I.Yaw, Jef.I.Pitch, spot.Value.Y);
        if (text != "") GameState.I.Say(text);
        if (unpaid) return;
        Busy = true;
        try { Take("alight", await ServerLink.I!.Api!.Ride("alight", bus.At?.Id ?? "")); }
        catch (ApiException error) { GameState.I.Say(error.Message); }
        finally { Busy = false; }
    }
    private void Take(string action, RideReply reply) { GameState.I.Apply(reply); if (reply.Text != "") GameState.I.Say(reply.Text); Answered?.Invoke(action, reply); }
    public async Task AnswerFare(bool pay)
    {
        Close(); if (!Unpaid || Bus == null) return;
        if (!pay) { puttingOff = true; putOffWait = 0; putOffTries = 0; return; }
        Busy = true;
        try { Take("hop", await ServerLink.I!.Api!.Ride("hop", "", Bus.Line.Id)); Unpaid = false; }
        catch (ApiException error) { GameState.I.Say(error.Message); puttingOff = true; putOffWait = 0; putOffTries = 0; }
        finally { Busy = false; }
    }
    public void OnKey(string code, string key)
    {
        if (page == "fare") { if (key == "1") _ = AnswerFare(true); else if (key == "2" || code == "Escape") _ = AnswerFare(false); }
        else if (code is "Escape" or "KeyE") Close();
    }
    public void Close() { page = ""; Dialogs.I?.Close(this); if (sheet != null) sheet.Card.Visible = false; }
    public async Task Timetable(string stop)
    {
        try { words = (await ServerLink.I!.Api!.Timetable(stop)).Text; page = "timetable"; Dialogs.I!.Open(this); Render(); }
        catch (ApiException error) { GameState.I.Say(error.Message); }
    }
    private void Render()
    {
        if (page == "") return;
        string signature = page + words + GameState.I.Payload?.Ride?.FareC + GameState.I.Payload?.Ride?.Change?.FromLine + Dialogs.I!.Ui;
        if (sheet != null && sheetFor == signature) { sheet.Card.Visible = true; sheet.Place(); return; }
        sheetFor = signature;
        sheet?.Card.QueueFree(); float ui = Dialogs.I!.Ui;
        sheet = new Sheet(ui, Math.Min(520 * ui, GetViewport().GetVisibleRect().Size.X * .86f), Css.Hex("d4cab0"), (22, 14, 22, 12));
        sheet.Where = (win, size) => new Vector2((win.X - size.X) / 2, win.Y * .86f - size.Y);
        sheet.Text(page == "fare" ? "The conductor squeezes past and holds out his hand. \"Fare, if you please.\"" : Css.Esc(words), Face.Print, 16);
        if (page == "fare")
        {
            var state = GameState.I.Payload?.Ride; bool change = state?.Change is { } c && c.FromLine != Bus?.Line.Id;
            sheet.Row(1, change ? "show your ticket (a free change)" : $"pay the fare ({state?.FareC} c)", size: 16);
            sheet.Row(2, "refuse", size: 16); sheet.Keys("1  pay · 2 or Esc  refuse");
        }
        else sheet.Keys("E or Esc  close");
        Dialogs.I.Layer.AddChild(sheet.Card); sheet.Place();
    }
    public override void _Process(double delta)
    {
        if (Bus == null) return;
        float dt = (float)Math.Min(delta, .1);
        if (Unpaid && !puttingOff && !Busy && (fareWait -= dt) <= 0)
        {
            if (page != "fare") { page = "fare"; fareWait = 15; Dialogs.I!.Open(this); Render(); }
            else _ = AnswerFare(false);
        }
        if (puttingOff && !Busy && (putOffWait -= dt) <= 0)
        {
            putOffWait = .8f; putOffTries++;
            if (Landing() != null) _ = Leave("\"No fare, no ride! Off with you, you thieving rat!\" The conductor plants a boot in your back.");
        }
        if (Bus?.At != lastStop)
        {
            lastStop = Bus?.At;
            if (lastStop != null)
            {
                GameState.I.Say("The conductor calls out: " + lastStop.Name + ".");
                if (!Unpaid && GameState.I.Payload?.Ride?.On == null) _ = Leave("The conductor puts you off: your ticket has run out.");
            }
        }
    }
}

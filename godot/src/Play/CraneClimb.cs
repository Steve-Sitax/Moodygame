using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>Browser craneclimb.ts: ladder stays on the travelling portal; the gallery turns with the working jib.</summary>
[GamePart(921)]
public partial class CraneClimb : Node
{
    public static CraneClimb I { get; private set; } = null!;
    public int On { get; private set; } = -1;
    public bool OnLadder { get; private set; }
    public Vector2 Local { get; private set; }
    private float height, lastYaw, push;
    private bool saidWait, jumpHeld;
    private Vector3 footOffset;
    private readonly Func<float, bool> drive;
    public readonly RaisedDeck Deck = new(new[]
    {
        new RaisedDeck.Area(1.29f,1.93f,-1.93f,1.73f,6.42f), new RaisedDeck.Area(-1.93f,-1.29f,-1.93f,1.73f,6.42f),
        new RaisedDeck.Area(-1.93f,1.93f,-1.93f,-1.44f,6.42f), new RaisedDeck.Area(-1.45f,1.45f,-2.22f,-1.44f,6.42f),
        new RaisedDeck.Area(-1.1f,1.1f,-2.44f,-1.44f,6.42f), new RaisedDeck.Area(-.85f,.85f,-2.63f,-1.44f,6.42f),
        new RaisedDeck.Area(-.24f,.24f,-2.93f,-2.2f,6.42f), new RaisedDeck.Area(.6f,1.7f,-1.06f,-.39f,6.42f),
        new RaisedDeck.Area(.47f,1.13f,-1.24f,1.38f,6.54f), new RaisedDeck.Area(-.76f,1.13f,.8f,1.38f,6.54f),
    });
    public CraneClimb() { I = this; drive = Drive; }
    public override void _Ready()
    {
        Interact.I.AddProvider(Keys);
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Replaced;
    }
    public override void _ExitTree()
    {
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Replaced;
    }
    private void Replaced(string how, Scheldemist.Net.ClientState? client)
    {
        On = -1; OnLadder = false; push = 0;
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        var back=RideSaves.Read<RideSaved>(client,"ride");
        if(back is {Kind:"crane"}&&int.TryParse(back.Id,out int i)&&i>=0&&i<Railway.I.LadderCount)
        {var l=Railway.I.LadderAt(i);var foot=StandOf(l);if(foot==null)return;Deck.Frame=l.Deck;if(!back.Ladder&&!Deck.Stand(back.X,back.Z,.12f))return;On=i;OnLadder=back.Ladder;height=Math.Clamp(back.Height,0,5.42f);Local=new(back.X,back.Z);footOffset=foot.Value-l.Hang;lastYaw=l.Deck.Basis.GetEuler().Y;Jef.I.Drive=drive;Drive(0);}
    }
    public RideSaved Saved()=>new("crane",On.ToString(),Local.X,Local.Y,lastYaw,Ladder:OnLadder,Height:height);
    private Vector3? StandOf(Railway.Ladder l)
    {
        var d = l.Head - l.Foot; d.Y = 0; d = d.Normalized();
        for (float s = 0; s <= 2.5f; s += .25f)
        {
            var p = l.Foot + d * s;
            float y = Jef.I.GroundAt(p.X, p.Z, .3f);
            if (y > -.6f && y < .5f && Jef.I.BodyFree(p.X, y, p.Z)) return new(p.X, y, p.Z);
        }
        return null;
    }
    public Vector3? FootOf(int i) => StandOf(Railway.I.LadderAt(i));
    private int NearFoot(float x, float z)
    {
        if (Jef.I.Y > .5f || Jef.I.Swimming || Jef.I.Riding || Railway.I == null) return -1;
        int best = -1; float bd = 1.4f;
        for (int i = 0; i < Railway.I.LadderCount; i++)
        {
            var l = Railway.I.LadderAt(i);
            if (new Vector2(l.Foot.X - x, l.Foot.Z - z).Length() > 4) continue;
            var foot = StandOf(l); if (foot == null) continue;
            float d = new Vector2(foot.Value.X - x, foot.Value.Z - z).Length();
            if (d < bd) { best = i; bd = d; }
        }
        return best;
    }
    private Offers? Keys(float x, float z)
    {
        if (On >= 0)
        {
            var l = Railway.I.LadderAt(On);
            var acts = new List<Act>();
            if (!OnLadder && new Vector2(x - l.Head.X, z - l.Head.Z).Length() < 1.3f && HeadOnDeck(l)) acts.Add(Act.Me(Key.E, "climb down the ladder", Down));
            return new Offers { Only = acts };
        }
        int i = NearFoot(x, z); if (i < 0) return null;
        var ladder = Railway.I.LadderAt(i);
        var at = ladder.Hang - new Vector3(MathF.Sin(ladder.Face), 0, MathF.Cos(ladder.Face)) * .3f; at.Y = 1.4f;
        return new Offers { Options = new() { (0, Act.At(Key.E, "climb the crane's ladder", at, () => Up(i))) } };
    }
    private bool HeadOnDeck(Railway.Ladder l)
    {
        Deck.Frame = l.Deck; var at = l.Deck.AffineInverse() * l.Head;
        return Deck.Stand(at.X, at.Z, .12f);
    }
    public void Up(int i)
    {
        if (On >= 0 || Jef.I.Riding) return;
        if (Jef.I.Laden) { GameState.I.Say("Not with goods in your arms."); return; }
        var l = Railway.I.LadderAt(i); var foot = StandOf(l); if (foot == null) return;
        On = i; OnLadder = true; height = .05f; footOffset = foot.Value - l.Hang; saidWait = false;
        Jef.I.Yaw = l.Face; Jef.I.Pitch = Math.Clamp(Jef.I.Pitch, -.4f, .6f); Jef.I.Drive = drive;
        lastYaw = l.Deck.Basis.GetEuler().Y;
    }
    public void Down()
    {
        if (On < 0 || OnLadder) return;
        var l = Railway.I.LadderAt(On); var foot = StandOf(l) ?? l.Foot;
        OnLadder = true; height = 5.22f; footOffset = foot - l.Hang; Jef.I.Yaw = l.Face;
    }
    private bool Drive(float dt)
    {
        if (On < 0) return false;
        var l = Railway.I.LadderAt(On); var j = Jef.I;
        if (OnLadder)
        {
            int v = j.Frozen ? 0 : (j.KeyDown(Key.W) || j.KeyDown(Key.Up) ? 1 : 0) - (j.KeyDown(Key.S) || j.KeyDown(Key.Down) ? 1 : 0);
            height += v * .9f * dt;
            if (height >= 5.42f)
            {
                if (!HeadOnDeck(l)) { height = 5.42f; if (!saidWait) { saidWait = true; GameState.I.Say("The cabin is swung away. You hold on at the top of the ladder till the gallery comes round."); } }
                else { OnLadder = false; var p = l.Deck.AffineInverse() * l.Head; Local = new(p.X, p.Z); lastYaw = l.Deck.Basis.GetEuler().Y; }
            }
            if (height <= 0 && v < 0)
            {
                var foot = l.Hang + footOffset; On = -1; OnLadder = false; j.Drive = null; j.Place(foot.X, foot.Z, j.Yaw, j.Pitch, foot.Y); return false;
            }
            if (OnLadder) { j.DrivenEye = Jef.Eye - MathF.Abs(MathF.Sin(height * 5.5f)) * .04f; j.Carry(new(l.Hang.X, height, l.Hang.Z)); return true; }
        }
        Deck.Frame = l.Deck;
        float yaw = l.Deck.Basis.GetEuler().Y, dr = Mathf.Wrap(yaw - lastYaw, -MathF.PI, MathF.PI); lastYaw = yaw;
        float fx = (j.KeyDown(Key.D) || j.KeyDown(Key.Right) ? 1 : 0) - (j.KeyDown(Key.A) || j.KeyDown(Key.Left) ? 1 : 0);
        float fz = (j.KeyDown(Key.S) || j.KeyDown(Key.Down) ? 1 : 0) - (j.KeyDown(Key.W) || j.KeyDown(Key.Up) ? 1 : 0);
        if (j.Frozen) fx = fz = 0;
        var v2 = new Vector2(fx, fz).LimitLength() * Jef.Walk * dt;
        float a = j.Yaw - yaw, c = MathF.Cos(a), s = MathF.Sin(a);
        Local = Deck.Walk(Local, Local + new Vector2(v2.X * c + v2.Y * s, -v2.X * s + v2.Y * c));
        j.DrivenEye = Jef.Eye; j.Carry(Deck.At(Local), dr);
        bool jump = j.KeyDown(Key.Space);
        if (jump && !jumpHeld && !j.Frozen) { On = -1; j.LaunchFromRide(); jumpHeld = true; return false; }
        jumpHeld = jump; return true;
    }
    public override void _Process(double delta)
    {
        if (On >= 0) return;
        if (Jef.I.Laden || Jef.I.Frozen) { push = 0; return; }
        int i = NearFoot(Jef.I.X, Jef.I.Z);
        if (i < 0 || !(Jef.I.KeyDown(Key.W) || Jef.I.KeyDown(Key.Up))) { push = 0; return; }
        var l = Railway.I.LadderAt(i); float diff = Mathf.Wrap(Jef.I.Yaw - l.Face, -MathF.PI, MathF.PI);
        if (Math.Abs(diff) < .6f) { push += (float)delta; if (push > .45f) { push = 0; Up(i); } }
    }
}

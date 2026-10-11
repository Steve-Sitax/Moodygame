using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// Browser craneclimb.ts: ladder stays on the travelling portal; the gallery turns with the working jib.
/// (2026-10-11, Steve: "when we climb them, they just keep moving as they were and we go correctly with them") the
/// crane's work does not change for a rider; Jef steps after the movers (priority 10), so each frame he is carried
/// with the crane's pose of that frame: on the rungs with the portal, up top with the deck, the view turning with it.
/// He gets on where the ladder is (a crane halts its travel for anyone at its legs), off at the top onto the gallery
/// under the ladder head, and off at the bottom onto free ground at the foot as it is then, else he holds on.
/// (2026-10-11, Steve: "when cabin is rotated away of crane when climbing, we should just climb over railing. Make
/// smooth animation. Same with going on ladder, it is not a smooth transition") Every step on and off is one smooth
/// move (Player/Glide.cs) from the frame he leaves into the frame he goes to (the ground, the portal, the turning
/// deck): the path is kept in both and he passes from the one to the other over the move, so it stays whole while the
/// crane works on, and the view turns to the rungs with it. At the top with the gallery swung away he climbs over its
/// railing onto the nearest walk of it; from the gallery he climbs back over it onto the ladder the same way.
/// </summary>
[GamePart(921)]
public partial class CraneClimb : Node
{
    public static CraneClimb I { get; private set; } = null!;
    public int On { get; private set; } = -1;
    public bool OnLadder { get; private set; }
    public Vector2 Local { get; private set; }
    public float Height => height;
    private float height, lastYaw, push, eyeNow = Jef.Eye;
    private bool saidWait, saidNoRoom, jumpHeld;
    private readonly Func<float, bool> drive;
    /// <summary>The gallery's floor, and how high the feet go to swing a leg over its railing (1 m high).</summary>
    public const float DeckY = 6.42f, RailClear = 0.65f;
    /// <summary>Feet on the first rung, and on the top rung under the ladder head.</summary>
    public const float Bottom = 0.3f, Top = 5.42f;
    public readonly RaisedDeck Deck = new(new[]
    {
        new RaisedDeck.Area(1.29f,1.93f,-1.93f,1.73f,6.42f), new RaisedDeck.Area(-1.93f,-1.29f,-1.93f,1.73f,6.42f),
        new RaisedDeck.Area(-1.93f,1.93f,-1.93f,-1.44f,6.42f), new RaisedDeck.Area(-1.45f,1.45f,-2.22f,-1.44f,6.42f),
        new RaisedDeck.Area(-1.1f,1.1f,-2.44f,-1.44f,6.42f), new RaisedDeck.Area(-.85f,.85f,-2.63f,-1.44f,6.42f),
        new RaisedDeck.Area(-.24f,.24f,-2.93f,-2.2f,6.42f), new RaisedDeck.Area(.6f,1.7f,-1.06f,-.39f,6.42f),
        new RaisedDeck.Area(.47f,1.13f,-1.24f,1.38f,6.54f), new RaisedDeck.Area(-.76f,1.13f,.8f,1.38f,6.54f),
    });

    /// <summary>A move on or off the ladder, under way: no keys meanwhile.</summary>
    private sealed class Move
    {
        public Glide A = null!, B = null!;
        public Func<Transform3D> FromFrame = null!, ToFrame = null!;
        public bool FromDeck, ToDeck, Turn;
        public float T, Yaw0, Yaw1;
        public Action Done = null!;
        public string Name = "";
    }
    private Move? move;
    /// <summary>Getting on or off the ladder: a smooth move under way, and which ("on", "top", "over", "down", "back over", "off").</summary>
    public bool Moving => move != null;
    public string MoveName => move?.Name ?? "";
    /// <summary>How far through the move he is, 0 to 1.</summary>
    public float MoveShare => move == null ? 0 : move.T / Math.Max(move.A.Duration, move.B.Duration);

    public CraneClimb() { I = this; drive = Drive; }
    public override void _Ready()
    {
        Interact.I.AddProvider(Keys);
        if (Jef.I.ProcessPriority < 10) Jef.I.ProcessPriority = 10; // after the movers, as Ride.cs: the crane is posed first
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Replaced;
    }
    public override void _ExitTree()
    {
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Replaced;
    }
    private void Replaced(string how, Scheldemist.Net.ClientState? client)
    {
        On = -1; OnLadder = false; push = 0; move = null;
        if (Jef.I.Drive == drive) Jef.I.Drive = null;
        var back=RideSaves.Read<RideSaved>(client,"ride");
        if(back is {Kind:"crane"}&&float.IsFinite(back.Height)&&float.IsFinite(back.X)&&float.IsFinite(back.Z)&&int.TryParse(back.Id,out int i)&&i>=0&&i<Railway.I.LadderCount)
        {var l=Railway.I.LadderAt(i);if(StandOf(l)==null)return;Deck.Frame=l.Deck;if(!back.Ladder&&!Deck.Stand(back.X,back.Z,.12f))return;On=i;OnLadder=back.Ladder;height=Math.Clamp(back.Height,Bottom,Top);Local=new(back.X,back.Z);lastYaw=l.Deck.Basis.GetEuler().Y;eyeNow=Jef.Eye;Jef.I.Drive=drive;Drive(0);}
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
            if (!OnLadder && move == null)
            {
                if (new Vector2(x - l.Head.X, z - l.Head.Z).Length() < 1.3f && HeadOnDeck(l)) acts.Add(Act.Me(Key.E, "climb down the ladder", Down));
                else if (OverRail(l) is { } over && new Vector2(x, z).DistanceTo(Flat(l.Deck * new Vector3(over.X, DeckY, over.Y))) < 0.9f)
                    acts.Add(Act.Me(Key.E, "climb over the railing onto the ladder", DownOver));
            }
            return new Offers { Only = acts };
        }
        int i = NearFoot(x, z); if (i < 0) return null;
        var ladder = Railway.I.LadderAt(i);
        var at = ladder.Hang - new Vector3(MathF.Sin(ladder.Face), 0, MathF.Cos(ladder.Face)) * .3f; at.Y = 1.4f;
        return new Offers { Options = new() { (0, Act.At(Key.E, "climb the crane's ladder", at, () => Up(i))) } };
    }
    private static Vector2 Flat(Vector3 v) => new(v.X, v.Z);
    private bool HeadOnDeck(Railway.Ladder l)
    {
        Deck.Frame = l.Deck; var at = l.Deck.AffineInverse() * l.Head;
        return Deck.Stand(at.X, at.Z, .12f);
    }

    /// <summary>
    /// The gallery is swung away from the ladder head: the nearest place on its walk to step down to over the railing
    /// (deck frame), within reach of the head, or null (the gallery is at the head, or too far round).
    /// </summary>
    private Vector2? OverRail(Railway.Ladder l)
    {
        Deck.Frame = l.Deck;
        var at = l.Deck.AffineInverse() * l.Head;
        var head = new Vector2(at.X, at.Z);
        if (Deck.Stand(head.X, head.Y, .12f)) return null;
        Vector2? best = null;
        float bd = 1.35f;
        for (float r = 0.2f; r <= 1.35f && best == null; r += 0.05f)
            for (int k = 0; k < 36; k++)
            {
                float a = k * MathF.Tau / 36;
                var p = head + new Vector2(MathF.Cos(a), MathF.Sin(a)) * r;
                if (Deck.Stand(p.X, p.Y, .2f) && Math.Abs(Deck.Floor(p.X, p.Y) - DeckY) < .01f && r < bd) { bd = r; best = p; }
            }
        return best;
    }

    /// <summary>The portal's frame: the ladder is on it (it travels, it does not turn).</summary>
    private static Transform3D Portal(Railway.Ladder l) => new(new Basis(Vector3.Up, l.Face - MathF.PI), l.Deck.Origin);

    public void Up(int i)
    {
        if (On >= 0 || Jef.I.Riding) return;
        if (Jef.I.Laden) { GameState.I.Say("Not with goods in your arms."); return; }
        var l = Railway.I.LadderAt(i); if (StandOf(l) == null) return;
        On = i; OnLadder = true; height = Bottom; saidWait = saidNoRoom = false;
        Jef.I.Pitch = Math.Clamp(Jef.I.Pitch, -.4f, .6f);
        lastYaw = l.Deck.Basis.GetEuler().Y;
        // a step in to the rungs and up onto the first one, turning to face them
        var j = Jef.I;
        var face = new Vector3(MathF.Sin(l.Face), 0, MathF.Cos(l.Face));
        var rung = new Vector3(l.Hang.X, Bottom, l.Hang.Z);
        var near = rung - face * 0.22f; near.Y = j.Y + 0.1f;
        Start("on", new[] { (near, 0.35f), (rung, 0.35f) }, () => Transform3D.Identity, false, () => Portal(Railway.I.LadderAt(i)), false, Vector3.Zero, l.Face, () => { });
        eyeNow = Jef.Eye;
        j.Drive = drive;
    }

    public void Down()
    {
        if (On < 0 || OnLadder || move != null) return;
        var l = Railway.I.LadderAt(On); int id = On;
        var lip = l.Head + (l.Hang - l.Head) * 0.3f; lip.Y = DeckY + 0.12f;
        var rung = new Vector3(l.Hang.X, Top - 0.2f, l.Hang.Z);
        OnLadder = true; height = Top - 0.2f; saidNoRoom = false;
        Start("down", new[] { (lip, 0.45f), (rung, 0.6f) }, () => Railway.I.LadderAt(id).Deck, true, () => Portal(Railway.I.LadderAt(id)), false, Vector3.Zero, l.Face, () => { });
    }

    /// <summary>From the gallery over its railing onto the top of the ladder (the deck swung away from the ladder head).</summary>
    public void DownOver()
    {
        if (On < 0 || OnLadder || move != null) return;
        var l = Railway.I.LadderAt(On); int id = On;
        var j = Jef.I;
        var top = new Vector3(l.Hang.X, Top - 0.05f, l.Hang.Z);
        var from = new Vector3(j.X, j.Y, j.Z);
        var outward = new Vector3(top.X - from.X, 0, top.Z - from.Z).Normalized();
        var up = from + outward * 0.2f; up.Y = DeckY + RailClear;
        var over = top - outward * 0.2f; over.Y = DeckY + RailClear;
        OnLadder = true; height = Top - 0.05f; saidNoRoom = false;
        Start("back over", new[] { (up, 0.7f), (over, 0.6f), (top, 0.8f) }, () => Railway.I.LadderAt(id).Deck, true, () => Portal(Railway.I.LadderAt(id)), false, Vector3.Zero, l.Face, () => { });
    }

    /// <summary>
    /// A move from one frame into another (the world, the portal, the deck), through points taken in the world as they
    /// are now: the path is kept in both frames and he goes from the one to the other over the move, so a crane that
    /// travels or slews meanwhile carries the move with it and its end lands where it should. The body turns to `yaw`
    /// with it (NaN: he keeps his own way of looking).
    /// </summary>
    private void Start(string name, (Vector3 p, float dur)[] keys, Func<Transform3D> from, bool fromDeck, Func<Transform3D> to, bool toDeck, Vector3 v0, float yaw, Action done)
    {
        var j = Jef.I;
        var at = new Vector3(j.X, j.Y, j.Z);
        Glide In(Transform3D f)
        {
            var inv = f.AffineInverse();
            return new Glide(inv * at, keys.Select(k => (inv * k.p, k.dur)).ToList(), inv.Basis * v0, Vector3.Zero, 0.8f, Jef.ClimbMax);
        }
        move = new Move { Name = name, A = In(from()), B = In(to()), FromFrame = from, ToFrame = to, FromDeck = fromDeck, ToDeck = toDeck, Yaw0 = j.Yaw, Yaw1 = yaw, Turn = float.IsFinite(yaw), Done = done };
    }

    /// <summary>One frame of a move: where he is, the view turning toward the rungs and with the deck; true when it is over.</summary>
    private bool Step(float dt, Railway.Ladder l)
    {
        var m = move!;
        m.T += dt;
        float d = Math.Max(m.A.Duration, m.B.Duration);
        float k = Math.Clamp(m.T / d, 0, 1), w = k * k * k * (k * (6 * k - 15) + 10);
        var at = (m.FromFrame() * m.A.At(m.T)).Lerp(m.ToFrame() * m.B.At(m.T), w);
        // the view turns with the deck as it slews, as much as he is on it
        float deckYaw = l.Deck.Basis.GetEuler().Y, dr = Mathf.Wrap(deckYaw - lastYaw, -MathF.PI, MathF.PI);
        lastYaw = deckYaw;
        float share = (m.FromDeck ? 1 - w : 0) + (m.ToDeck ? w : 0);
        var j = Jef.I;
        float turn = dr * share;
        if (m.Turn)
        {
            m.Yaw0 += turn;
            m.Yaw1 += turn;
            float target = m.Yaw0 + Mathf.Wrap(m.Yaw1 - m.Yaw0, -MathF.PI, MathF.PI) * w;
            turn = Mathf.Wrap(target - j.Yaw, -MathF.PI, MathF.PI);
        }
        j.Carry(at, turn, true);
        eyeNow += (Jef.Eye - eyeNow) * (1 - MathF.Exp(-dt * 12));
        j.DrivenEye = eyeNow;
        if (m.T < d) return false;
        move = null;
        m.Done();
        return true;
    }

    private bool Drive(float dt)
    {
        if (On < 0) return false;
        var l = Railway.I.LadderAt(On); var j = Jef.I;
        if (move != null)
        {
            Step(dt, l);
            return On >= 0 && j.Drive == drive;
        }
        if (OnLadder)
        {
            int v = j.Frozen ? 0 : (j.KeyDown(Key.W) || j.KeyDown(Key.Up) ? 1 : 0) - (j.KeyDown(Key.S) || j.KeyDown(Key.Down) ? 1 : 0);
            height += v * .9f * dt;
            if (height >= Top && v > 0)
            {
                height = Top;
                int id = On;
                var from = new Vector3(l.Hang.X, Top, l.Hang.Z);
                if (HeadOnDeck(l))
                {
                    // up through the gate onto the gallery's tongue
                    var lip = l.Hang + (l.Head - l.Hang) * 0.3f; lip.Y = DeckY + 0.15f;
                    var head = l.Head; head.Y = DeckY;
                    var at = l.Deck.AffineInverse() * l.Head;
                    j.Carry(from);
                    Start("top", new[] { (lip, 0.55f), (head, 0.45f) }, () => Portal(Railway.I.LadderAt(id)), false, () => Railway.I.LadderAt(id).Deck, true, new Vector3(0, .9f * v, 0), float.NaN,
                        () => { OnLadder = false; Local = new(at.X, at.Z); lastYaw = Railway.I.LadderAt(id).Deck.Basis.GetEuler().Y; });
                    Step(dt, l);
                    return true;
                }
                if (OverRail(l) is { } spot)
                {
                    // the gallery is swung away: up the stiles, a leg over its railing, down onto its walk
                    var to = l.Deck * new Vector3(spot.X, DeckY, spot.Y);
                    var outward = new Vector3(to.X - from.X, 0, to.Z - from.Z).Normalized();
                    var up = from + outward * 0.2f; up.Y = DeckY + RailClear;
                    var over = to - outward * 0.25f; over.Y = DeckY + RailClear;
                    j.Carry(from);
                    Start("over", new[] { (up, 0.9f), (over, 0.6f), (to, 0.6f) }, () => Portal(Railway.I.LadderAt(id)), false, () => Railway.I.LadderAt(id).Deck, true, new Vector3(0, .9f * v, 0), float.NaN,
                        () => { OnLadder = false; Local = spot; lastYaw = Railway.I.LadderAt(id).Deck.Basis.GetEuler().Y; });
                    Step(dt, l);
                    return true;
                }
                if (!saidWait) { saidWait = true; GameState.I.Say("The cabin is swung right round. You hold on at the top of the ladder till the gallery comes nearer."); }
            }
            if (height <= Bottom && v < 0)
            {
                // off onto the ground at the foot where the portal has rolled to now; nowhere free there: hold on
                height = Bottom;
                if (StandOf(l) is { } foot)
                {
                    int id = On;
                    var face = new Vector3(MathF.Sin(l.Face), 0, MathF.Cos(l.Face));
                    var back = new Vector3(l.Hang.X, Bottom, l.Hang.Z) - face * 0.22f; back.Y = foot.Y + 0.1f;
                    j.Carry(new Vector3(l.Hang.X, Bottom, l.Hang.Z));
                    Start("off", new[] { (back, 0.35f), (foot, 0.35f) }, () => Portal(Railway.I.LadderAt(id)), false, () => Transform3D.Identity, false, Vector3.Zero, float.NaN,
                        () => { On = -1; OnLadder = false; Jef.I.StandOnFeet(); });
                    Step(dt, l);
                    return On >= 0;
                }
                if (!saidNoRoom) { saidNoRoom = true; GameState.I.Say("There is no room to step off here. You hold on to the bottom rung."); }
            }
            // hand over hand: a small pull on every rung, eased so the view never jumps; held still, the view is still
            float pull = MathF.Abs(MathF.Sin((height - Bottom) * 5.5f)) * .04f;
            if (v != 0) eyeNow += (Jef.Eye - pull - eyeNow) * (1 - MathF.Exp(-dt * 12));
            j.DrivenEye = eyeNow;
            j.Carry(new(l.Hang.X, height, l.Hang.Z));
            return true;
        }
        Deck.Frame = l.Deck;
        float yaw = l.Deck.Basis.GetEuler().Y, dr = Mathf.Wrap(yaw - lastYaw, -MathF.PI, MathF.PI); lastYaw = yaw;
        float fx = (j.KeyDown(Key.D) || j.KeyDown(Key.Right) ? 1 : 0) - (j.KeyDown(Key.A) || j.KeyDown(Key.Left) ? 1 : 0);
        float fz = (j.KeyDown(Key.S) || j.KeyDown(Key.Down) ? 1 : 0) - (j.KeyDown(Key.W) || j.KeyDown(Key.Up) ? 1 : 0);
        if (j.Frozen) fx = fz = 0;
        var v2 = new Vector2(fx, fz).LimitLength() * Jef.Walk * dt;
        float a = j.Yaw - yaw, c = MathF.Cos(a), s = MathF.Sin(a);
        Local = Deck.Walk(Local, Local + new Vector2(v2.X * c + v2.Y * s, -v2.X * s + v2.Y * c));
        eyeNow += (Jef.Eye - eyeNow) * (1 - MathF.Exp(-dt * 12));
        j.DrivenEye = eyeNow; j.Carry(Deck.At(Local), dr, true);
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

using System;
using System.Buffers.Binary;
using System.Collections.Generic;

namespace Scheldemist.Net.Mp;

/// <summary>One player's state as it goes over the movement socket (shared/mpProtocol.ts MpState).</summary>
public struct MpState
{
    public uint Seq;
    /// <summary>When it was true, on the server's clock (ms).</summary>
    public double T;
    public float X, Y, Z, Vx, Vy, Vz, Yaw, Pitch;
    public int Mode;
    public int Flags;
    public int Base;
    /// <summary>M8b: GEAR kind (low 2 bits) and which one (the rest); its heading in Lyaw.</summary>
    public int Gear;
    public float Lx, Ly, Lz, Lyaw;
}

/// <summary>Who is in the game (shared/mpProtocol.ts RosterEntry).</summary>
public sealed record RosterEntry
{
    public int Id { get; init; }
    public string Name { get; init; } = "";
    /// <summary>The look (shared/character.ts appearanceCode).</summary>
    public string Code { get; init; } = "";
    public bool Host { get; init; }
    public bool Admin { get; init; }
    public bool Away { get; init; }
    public bool Online { get; init; }
}

/// <summary>
/// What goes over the movement socket (/mp): shared/mpProtocol.ts, the players' part. Each game sends its own man
/// 20 times a second as one binary frame (68 bytes); the server sends each game one binary batch of the others
/// 20 times a second. Everything else (hello, the roster, pings, "pause all") is JSON text. The townspeople's, the
/// animals', the job figures' and the moving world's messages are not read here yet (their kinds are named so
/// they can be told apart and handed to the parts that will).
/// </summary>
public static class MpProtocol
{
    /// <summary>Bumped when the frames change: the server turns a game of another build away.</summary>
    public const int Protocol = 5;
    public const int SendHz = 20;
    public const double SendMs = 1000.0 / SendHz;

    public static readonly string[] Modes = { "walk", "crouch", "swim", "climb", "ladder", "ride", "bike", "row", "fly", "sit" };

    public const int FlagJumped = 1, FlagLanded = 2, FlagGrounded = 4, FlagHurry = 8, FlagAway = 16, FlagSnap = 32, FlagStep = 64, FlagLantern = 128;
    public const int BaseNone = 0, BaseOmnibus = 1;
    public const int GearNone = 0, GearRowboat = 1, GearVelo = 2, GearHandcart = 3;

    public const int StateBytes = 68;
    public const byte MsgState = 1, MsgBatch = 2, MsgPuppets = 3, MsgFigs = 4, MsgAnimals = 5;
    private const int Body = 66;

    public static int ModeIndex(string mode) => Math.Max(0, Array.IndexOf(Modes, mode));

    private static void WriteBody(Span<byte> b, in MpState s)
    {
        b[0] = (byte)s.Mode;
        BinaryPrimitives.WriteUInt16LittleEndian(b[1..], (ushort)s.Flags);
        BinaryPrimitives.WriteUInt16LittleEndian(b[3..], (ushort)s.Base);
        b[5] = (byte)s.Gear;
        BinaryPrimitives.WriteUInt32LittleEndian(b[6..], s.Seq);
        BinaryPrimitives.WriteDoubleLittleEndian(b[10..], s.T);
        int p = 18;
        Span<float> all = stackalloc float[] { s.X, s.Y, s.Z, s.Vx, s.Vy, s.Vz, s.Yaw, s.Pitch, s.Lx, s.Ly, s.Lz, s.Lyaw };
        foreach (float f in all)
        {
            BinaryPrimitives.WriteSingleLittleEndian(b[p..], f);
            p += 4;
        }
    }

    private static MpState ReadBody(ReadOnlySpan<byte> b)
    {
        Span<float> f = stackalloc float[12];
        for (int i = 0; i < 12; i++) f[i] = BinaryPrimitives.ReadSingleLittleEndian(b[(18 + i * 4)..]);
        return new MpState
        {
            Mode = b[0],
            Flags = BinaryPrimitives.ReadUInt16LittleEndian(b[1..]),
            Base = BinaryPrimitives.ReadUInt16LittleEndian(b[3..]),
            Gear = b[5],
            Seq = BinaryPrimitives.ReadUInt32LittleEndian(b[6..]),
            T = BinaryPrimitives.ReadDoubleLittleEndian(b[10..]),
            X = f[0], Y = f[1], Z = f[2], Vx = f[3], Vy = f[4], Vz = f[5], Yaw = f[6], Pitch = f[7], Lx = f[8], Ly = f[9], Lz = f[10], Lyaw = f[11],
        };
    }

    /// <summary>This game to the server: its own state.</summary>
    public static byte[] EncodeState(in MpState s)
    {
        var b = new byte[StateBytes];
        b[0] = MsgState;
        b[1] = 0;
        WriteBody(b.AsSpan(2), s);
        return b;
    }

    /// <summary>The server to this game: the others' states, and the server's time when it was sent. Null: not a well-formed batch.</summary>
    public static (double ServerNow, List<(int Id, MpState S)> List)? DecodeBatch(ReadOnlySpan<byte> b)
    {
        if (b.Length < 10 || b[0] != MsgBatch) return null;
        int n = b[1];
        if (b.Length != 10 + n * (2 + Body)) return null;
        var list = new List<(int, MpState)>(n);
        int o = 10;
        for (int i = 0; i < n; i++)
        {
            var s = ReadBody(b.Slice(o + 2, Body));
            if (float.IsFinite(s.X) && float.IsFinite(s.Y) && float.IsFinite(s.Z) && double.IsFinite(s.T)) list.Add((BinaryPrimitives.ReadUInt16LittleEndian(b[o..]), s));
            o += 2 + Body;
        }
        return (BinaryPrimitives.ReadDoubleLittleEndian(b[2..]), list);
    }
}

/// <summary>Where another player is drawn now (net/mp/remotes.ts Pose).</summary>
public struct Pose
{
    public float X, Y, Z, Yaw, Pitch, Vx, Vz;
    /// <summary>Speed on the ground (m/s): the walk's pace.</summary>
    public float Speed;
    public int Mode, Flags, Base, Gear;
    public float Lx, Ly, Lz, Lyaw;
    /// <summary>The newest state is older than the draw time (going on by guess, or standing).</summary>
    public bool Stale;
}

/// <summary>
/// One other player, drawn a little in the past (net/mp/remotes.ts RemoteTrack, the same numbers):
/// - a jitter buffer: the states as they came, on the server's timeline;
/// - drawn Delay ms in the past: 100 ms to start, then what the network asks for (80 to 250 ms: the 95th
///   percentile of how late the states come, plus 15), changing by at most 5% of the time passing;
/// - between two states a cubic Hermite curve with their velocities; turns take the short way round;
/// - a state marked "snap" is not reached by an in-between: he is there;
/// - no new state: on with the last velocity for 250 ms at most, then he stands.
/// </summary>
public sealed class RemoteTrack
{
    public const double DelayStart = 100, DelayMin = 80, DelayMax = 250, ExtrapolateMs = 250;

    private readonly List<MpState> buf = new();
    private readonly List<double> late = new();
    public double Delay = DelayStart;
    /// <summary>States in, states that came out of order, frames with nothing to draw from, frames drawn by guess.</summary>
    public int States, Dropped, Starved, Extrapolated;

    public void ResetStats() => States = Dropped = Starved = Extrapolated = 0;

    public void Push(in MpState s, double arrivedServerNow)
    {
        bool any = buf.Count > 0;
        double lastT = any ? buf[^1].T : s.T;
        if (any && s.T <= lastT)
        {
            Dropped++;
            return;
        }
        States++;
        buf.Add(s);
        if (buf.Count > 60) buf.RemoveRange(0, buf.Count - 60);
        // what counts is how long after the newest state before this one the next one comes
        late.Add(arrivedServerNow - lastT);
        if (late.Count > 60) late.RemoveAt(0);
    }

    /// <summary>The delay the network asks for now.</summary>
    public double Wanted()
    {
        if (late.Count < 10) return DelayStart;
        var sorted = late.ToArray();
        Array.Sort(sorted);
        double p95 = sorted[(int)Math.Floor(sorted.Length * 0.95)];
        return Math.Max(DelayMin, Math.Min(DelayMax, p95 + 15));
    }

    /// <summary>Move the delay toward what is wanted, never faster than 5% of the time passing.</summary>
    public void Adapt(double dtMs)
    {
        double step = dtMs * 0.05;
        Delay += Math.Max(-step, Math.Min(step, Wanted() - Delay));
    }

    private static float Wrap(float a) => MathF.Atan2(MathF.Sin(a), MathF.Cos(a));

    private static float Hermite(float p0, float v0, float p1, float v1, float dt, float u)
    {
        float u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * dt * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * dt * v1;
    }

    private static float HermiteD(float p0, float v0, float p1, float v1, float dt, float u)
    {
        float u2 = u * u;
        return ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * dt * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * dt * v1) / Math.Max(dt, 1e-6f);
    }

    private static Pose Of(in MpState s, float x, float y, float z, float yaw, float pitch, float vx, float vz, bool stale) => new()
    {
        X = x, Y = y, Z = z, Yaw = yaw, Pitch = pitch, Vx = vx, Vz = vz, Speed = MathF.Sqrt(vx * vx + vz * vz),
        Mode = s.Mode, Flags = s.Flags, Base = s.Base, Gear = s.Gear, Lx = s.Lx, Ly = s.Ly, Lz = s.Lz, Lyaw = s.Lyaw, Stale = stale,
    };

    /// <summary>Where he is drawn at serverNow (null before the first state).</summary>
    public Pose? Sample(double serverNow)
    {
        if (buf.Count == 0) return null;
        double t = serverNow - Delay;
        // drop what is long past, keeping one state before the draw time
        while (buf.Count > 2 && buf[1].T <= t) buf.RemoveAt(0);
        var a = buf[0];
        if (t <= a.T) return Of(a, a.X, a.Y, a.Z, a.Yaw, a.Pitch, a.Vx, a.Vz, false);
        if (buf.Count == 1) return Extrapolate(a, t);
        var c = buf[1];
        if (t > c.T) return Extrapolate(c, t);
        // a snap: no in-between; he stays at a until c's time, then he is at c
        if ((c.Flags & MpProtocol.FlagSnap) != 0) return Of(a, a.X, a.Y, a.Z, a.Yaw, a.Pitch, 0, 0, false);
        float dt = (float)((c.T - a.T) / 1000);
        float u = (float)((t - a.T) / (c.T - a.T));
        float x = Hermite(a.X, a.Vx, c.X, c.Vx, dt, u);
        float y = Hermite(a.Y, a.Vy, c.Y, c.Vy, dt, u);
        float z = Hermite(a.Z, a.Vz, c.Z, c.Vz, dt, u);
        float vx = HermiteD(a.X, a.Vx, c.X, c.Vx, dt, u);
        float vz = HermiteD(a.Z, a.Vz, c.Z, c.Vz, dt, u);
        float yaw = a.Yaw + Wrap(c.Yaw - a.Yaw) * u;
        float pitch = a.Pitch + (c.Pitch - a.Pitch) * u;
        var p = Of(u < 0.5f ? a : c, x, y, z, yaw, pitch, vx, vz, false);
        // one-off flags (a jump, a step) belong to the state they came with: only the newer carries them
        p.Flags = c.Flags & ~(MpProtocol.FlagJumped | MpProtocol.FlagLanded | MpProtocol.FlagStep);
        // (a platform's frame, or the heading of his gear: eased between the two states)
        if ((a.Base != 0 && a.Base == c.Base) || (a.Base == 0 && a.Gear != 0 && a.Gear == c.Gear))
        {
            p.Lx = a.Lx + (c.Lx - a.Lx) * u;
            p.Ly = a.Ly + (c.Ly - a.Ly) * u;
            p.Lz = a.Lz + (c.Lz - a.Lz) * u;
            p.Lyaw = a.Lyaw + Wrap(c.Lyaw - a.Lyaw) * u;
            p.Base = a.Base;
        }
        return p;
    }

    private Pose Extrapolate(in MpState s, double t)
    {
        bool over = t - s.T > ExtrapolateMs;
        if (over) Starved++;
        else Extrapolated++;
        float k = (float)(Math.Min(ExtrapolateMs, t - s.T) / 1000);
        // on the ground only: in the air a guess would sink him into the ground or float him
        bool on = (s.Flags & MpProtocol.FlagGrounded) != 0;
        return Of(s, s.X + (on ? s.Vx * k : 0), s.Y, s.Z + (on ? s.Vz * k : 0), s.Yaw, s.Pitch, over ? 0 : s.Vx, over ? 0 : s.Vz, true);
    }
}

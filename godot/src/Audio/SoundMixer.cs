using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Reflection;
using System.Runtime.CompilerServices;
using Godot;

namespace Scheldemist.Audio;

/// <summary>
/// The soundscape's mixer: the buses (the browser's gain groups), the places (the browser's Spot: fog gain, air
/// lowpass, panner, reverb send), the playing voices and their envelopes, and the made sounds' way from a graph to a
/// player (rendered on a worker thread, played as an AudioStreamWav). See docs/godot-port-sound.md.
/// </summary>
public partial class Soundscape
{
    // ------------------------------------------------------------------ numbers that tie Godot to Web Audio

    /// <summary>Web Audio's panner gives a mono sound straight ahead 0.7071 in each ear (equal power).</summary>
    private const double WebAudioCentre = 0.70710678;
    /// <summary>
    /// What Godot gives a 3D player straight ahead in each ear, measured by the self-test ("tone 2 m ahead"): the same
    /// 0.7071. With PanStrength 2 Godot's stereo panning is Web Audio's equal power in every direction measured
    /// (45 degrees off: 0.382 and 0.924 in both), so no make-up is needed.
    /// </summary>
    private const double GodotCentre = 0.70710678;
    private const double PanMakeup = WebAudioCentre / GodotCentre;
    /// <summary>A lowpass or highpass Q of q dB in Web Audio is this resonance in Godot's one-stage filter.</summary>
    private static float Reso(double qDb) => (float)Math.Pow(10, qDb / 20);
    /// <summary>
    /// Web Audio's convolver scales its impulse so that noise comes back at sqrt(samples) x 0.00125 x 44100 / rate
    /// (at 48 kHz): the level each reverb here is set to. Seconds of impulse in, gain out.
    /// </summary>
    private static double ConvolverGain(double seconds) => Math.Sqrt(seconds * 48000) * 0.00125 * 44100 / 48000;
    /// <summary>
    /// Godot's reverb as the self-test measured it ("reverb, room size" rows; damping 0.6, 44.1 kHz): the gain it
    /// gives noise back at with Wet = 1, and the seconds it takes to fall 60 dB, by room size.
    /// </summary>
    private static readonly (double room, double gain, double t60)[] GodotReverb =
    {
        (0, 0.933, 0.75), (0.2, 1.053, 0.78), (0.4, 1.199, 0.9), (0.6, 1.391, 1.35), (0.75, 1.603, 2.25), (0.85, 1.817, 3.3), (0.92, 2.047, 4.8),
    };
    private static double GodotReverbGain(double roomSize)
    {
        var t = GodotReverb;
        if (roomSize <= t[0].room) return t[0].gain;
        for (int i = 1; i < t.Length; i++)
            if (roomSize <= t[i].room) return t[i - 1].gain + (t[i].gain - t[i - 1].gain) * (roomSize - t[i - 1].room) / (t[i].room - t[i - 1].room);
        return t[^1].gain;
    }
    /// <summary>The room size whose tail is `seconds` long (Godot's shortest is 0.75 s).</summary>
    private static float RoomFor(double seconds)
    {
        var t = GodotReverb;
        if (seconds <= t[0].t60) return 0;
        for (int i = 1; i < t.Length; i++)
            if (seconds <= t[i].t60) return (float)(t[i - 1].room + (t[i].room - t[i - 1].room) * (seconds - t[i - 1].t60) / (t[i].t60 - t[i - 1].t60));
        return (float)t[^1].room;
    }

    /// <summary>
    /// The organ's share of the hall's echo. In the browser the organ goes into the hall's convolver twice (through
    /// the room and straight in): with the echo it is about 1.7 dB louder than alone. This factor on the hall's wet
    /// level gives the same in Godot (self-test: "organ with the hall's echo").
    /// </summary>
    private const double OrganEcho = 0.78;
    private const int ChanCount = 48;
    private static float Db(double g) => g <= 1e-5 ? -100f : (float)(20 * Math.Log10(g));

    // ------------------------------------------------------------------ buses

    private sealed class Chan
    {
        public int Index;
        public StringName Name = null!;
        public AudioEffectLowPassFilter Lp = null!;
        public AudioEffectHighPassFilter Hp = null!;
        public float Cut = 20500;
        public bool HpOn;
        public string Send = "";
    }

    private readonly Dictionary<string, int> busIndex = new();
    private readonly Dictionary<string, StringName> busName = new();
    private readonly Stack<Chan> freeChans = new();
    private AudioEffectLowPassFilter streetLpFx = null!;
    private AudioEffectReverb outdoorVerb = null!, roomVerb = null!, hallVerb = null!, organVerb = null!;
    private Node3D holder = null!;
    private Node flatHolder = null!;
    private readonly Stack<AudioStreamPlayer3D> free3d = new();
    private readonly Stack<AudioStreamPlayer> free2d = new();
    private int made3d, made2d;

    /// <summary>Compile the audio paths during loading, including first-use graph builders and timer closures.</summary>
    private static void WarmCode()
    {
        foreach (var type in typeof(Soundscape).Assembly.GetTypes())
        {
            if (type.Namespace != typeof(Soundscape).Namespace || type.ContainsGenericParameters) continue;
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                if (!method.IsAbstract && !method.ContainsGenericParameters && method.GetMethodBody() != null)
                    RuntimeHelpers.PrepareMethod(method.MethodHandle);
            foreach (var ctor in type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static))
                if (ctor.GetMethodBody() != null) RuntimeHelpers.PrepareMethod(ctor.MethodHandle);
        }
    }

    /// <summary>No scene nodes or native player initialization when a sound first plays.</summary>
    private void WarmPlayers()
    {
        var silence = new AudioStreamWav { Format = AudioStreamWav.FormatEnum.Format8Bits, MixRate = 8000, Data = new byte[256] };
        for (int i = 0; i < 128; i++)
        {
            var p = Take3d();
            p.Stream = silence;
            p.VolumeDb = -100;
            p.Play();
            p.Stop();
            warmed3d.Add(p);
        }
        foreach (var p in warmed3d) free3d.Push(p);
        warmed3d.Clear();
        for (int i = 0; i < 48; i++)
        {
            var p = Take2d();
            p.Stream = silence;
            p.VolumeDb = -100;
            p.Play();
            p.Stop();
            warmed2d.Add(p);
        }
        foreach (var p in warmed2d) free2d.Push(p);
        warmed2d.Clear();
    }
    private readonly List<AudioStreamPlayer3D> warmed3d = new(128);
    private readonly List<AudioStreamPlayer> warmed2d = new(48);

    private int AddBus(string name, string send, double gain = 1, params AudioEffect[] fx)
    {
        int i = AudioServer.BusCount;
        AudioServer.AddBus();
        AudioServer.SetBusName(i, name);
        AudioServer.SetBusSend(i, send);
        AudioServer.SetBusVolumeDb(i, Db(gain));
        foreach (var f in fx) AudioServer.AddBusEffect(i, f);
        busIndex[name] = i;
        busName[name] = name;
        return i;
    }

    private static AudioEffectReverb Verb(double seconds, double wet, double dry)
    {
        float room = RoomFor(seconds);
        return new AudioEffectReverb { RoomSize = room, Damping = 0.6f, Spread = 1, Hipass = 0, PredelayMsec = 20, PredelayFeedback = 0, Dry = (float)dry, Wet = (float)Math.Clamp(wet / GodotReverbGain(room), 0, 1) };
    }

    private static void SetVerb(AudioEffectReverb v, double seconds, double wet)
    {
        float room = RoomFor(seconds);
        v.RoomSize = room;
        v.Wet = (float)Math.Clamp(wet / GodotReverbGain(room), 0, 1);
    }

    /// <summary>
    /// The buses. A Godot bus sends only to a bus before it, so the order is the mix's order backwards.
    /// Master: compressor, limiter. Street: the street's level and the walls' lowpass. Reverb: the foggy outdoor tail.
    /// Room: the room's own echo and the hall's. Ch00..: one per playing place, with its air lowpass.
    /// </summary>
    private void MakeBuses()
    {
        busIndex["Master"] = 0;
        busName["Master"] = "Master";
        // Web Audio's compressor (threshold -18, ratio 3, knee 30) is nearly straight up to full level (1.5 dB off at
        // 0 dBFS) and adds 0.9 dB. Godot's counts the dB over the threshold twice (x 2.08): ratio 1.04 gives that 1.5 dB.
        AudioServer.AddBusEffect(0, new AudioEffectCompressor { Threshold = -18, Ratio = 1.04f, Gain = 0.9f, AttackUs = 3000, ReleaseMs = 250 });
        AudioServer.AddBusEffect(0, new AudioEffectHardLimiter { CeilingDb = -0.3f });

        streetLpFx = new AudioEffectLowPassFilter { CutoffHz = 20000, Resonance = Reso(1), Db = AudioEffectFilter.FilterDB.Filter6Db };
        AddBus("Street", "Master", 0.9, streetLpFx);
        // foggy outdoor space: long soft tail (the browser's impulse(3.8, 2.6), reverbIn 0.55)
        outdoorVerb = Verb(3.5, ConvolverGain(3.8), 0);
        AddBus("Reverb", "Street", 0.55, outdoorVerb);
        // the Sound settings' four buses (src/Menu/Apply.cs makes them when it runs first, sending to Master): the same
        // names here, moved behind Street and sent into it, so the settings' levels are the mix levels
        foreach (string k in Kinds)
        {
            string name = Cap(k);
            int have = AudioServer.GetBusIndex(name);
            if (have < 0)
            {
                AddBus(name, "Street");
                continue;
            }
            AudioServer.MoveBus(have, AudioServer.BusCount - 1);
            AudioServer.SetBusSend(AudioServer.BusCount - 1, "Street");
            busIndex[name] = AudioServer.BusCount - 1;
            busName[name] = name;
        }
        AddBus("Murmur", "Ambience", 1, new AudioEffectLowPassFilter { CutoffHz = 2200, Resonance = Reso(1), Db = AudioEffectFilter.FilterDB.Filter6Db });
        AddBus("MurmurWet", "Reverb", 1, new AudioEffectLowPassFilter { CutoffHz = 2200, Resonance = Reso(1), Db = AudioEffectFilter.FilterDB.Filter6Db });
        // the room: a short, close reverb (impulse(0.7, 5), send 0.22) and the hall's (set by SetInterior)
        hallVerb = Verb(2, 0, 1);
        roomVerb = Verb(0.52, 0.22 * ConvolverGain(0.7), 1);
        AddBus("Room", "Master", 1, hallVerb, roomVerb);
        foreach (string k in Kinds) AddBus("Room" + Cap(k), "Room");
        // the organ and the altar bell have the hall's echo on a bus of their own, past the room's: held notes ring in
        // Godot's reverb far more than noise does (its combs), so their echo is set by what the self-test measures
        // for the organ, not by the level for noise (OrganEcho)
        organVerb = Verb(2, 0, 1);
        AddBus("Organ", "Master", 1, organVerb);

        for (int i = 0; i < ChanCount; i++)
        {
            var lp = new AudioEffectLowPassFilter { CutoffHz = 20500, Resonance = Reso(0.5), Db = AudioEffectFilter.FilterDB.Filter6Db };
            var hp = new AudioEffectHighPassFilter { CutoffHz = 110, Resonance = Reso(1), Db = AudioEffectFilter.FilterDB.Filter6Db };
            string name = $"Ch{i:00}";
            int idx = AddBus(name, "Street", 1, lp, hp);
            AudioServer.SetBusEffectEnabled(idx, 1, false);
            freeChans.Push(new Chan { Index = idx, Name = busName[name], Lp = lp, Hp = hp, Send = "Street" });
        }

        // (moving a bus shifts the ones behind it: every index is read again, by name)
        foreach (string name in new List<string>(busIndex.Keys)) busIndex[name] = AudioServer.GetBusIndex(name);
        foreach (var c in freeChans) c.Index = AudioServer.GetBusIndex(c.Name);

        holder = new Node3D { Name = "Sound" };
        Main.I.View.AddChild(holder);
        // the ear is the camera of the world's viewport
        Main.I.View.AudioListenerEnable3D = true;
        flatHolder = new Node { Name = "SoundFlat" };
        AddChild(flatHolder);
    }

    private static string Cap(string k) => k switch
    {
        "ambience" => "Ambience", "voices" => "Voices", "music" => "Music", "effects" => "Effects",
        _ => char.ToUpperInvariant(k[0]) + k[1..],
    };
    private static readonly string[] Kinds = { "ambience", "voices", "music", "effects" };

    /// <summary>A kind's bus: the street's, or the room's while Indoors runs.</summary>
    private string Bus(string kind) => inRoom ? "Room" + Cap(kind) : Cap(kind);
    /// <summary>The browser's `this.master`: the street, or the room while Indoors runs.</summary>
    private string MasterBus => inRoom ? "Room" : "Street";

    // ------------------------------------------------------------------ places and voices

    /// <summary>The browser's gain automation on one source: straight lines between (seconds from the start, level).</summary>
    private sealed class Env
    {
        private readonly double[] t, v;
        public Env(params (double t, double v)[] p)
        {
            t = new double[p.Length];
            v = new double[p.Length];
            for (int i = 0; i < p.Length; i++) (t[i], v[i]) = p[i];
        }
        public double At(double x)
        {
            if (x <= t[0]) return v[0];
            for (int i = 1; i < t.Length; i++)
                if (x < t[i]) return t[i] > t[i - 1] ? v[i - 1] + (v[i] - v[i - 1]) * (x - t[i - 1]) / (t[i] - t[i - 1]) : v[i];
            return v[^1];
        }
    }

    /// <summary>One playing stream at a place.</summary>
    private sealed class V
    {
        public AudioStream Stream = null!;
        public string What = "";
        public double Gain = 1, StreamScale = 1, Pitch = 1, From, Start, Len = double.PositiveInfinity;
        public Env? Env;
        /// <summary>A level that follows a target (the browser's setTargetAtTime on a gain).</summary>
        public double Level = 1, LevelT = 1, LevelTau = 0.5;
        public bool Started;
        public AudioStreamPlayer3D? P3, W3;
        public AudioStreamPlayer? P2, W2;
        public float LastDb = float.NaN, LastWetDb = float.NaN;
        public Action? OnEnd;
        public double RawPeak = -1;
    }

    /// <summary>
    /// A place for a sound (the browser's Spot): fog gain, air lowpass, panner, and a reverb send that grows with
    /// distance. `Flat`: no place, it plays at the ear (the beds, Jef's own steps). `Raw`: a bare panner (the water).
    /// </summary>
    private sealed class Spot
    {
        public double X, Y, Z, Ref = 1, Rolloff = 1, Reach = 150, Cap = 14000, Dull = 0.5, Max = 150, Occl = 1, WetBase;
        public bool Flat, Raw, Hold, Dropped, Had, Hp;
        public string Out = "Street", WetBus = "Reverb";
        public Chan? Chan;
        public double Fog = 1, Lp = 14000, Wet, FogT = 1, LpT = 14000, WetT, Pan = 1;
        /// <summary>The source's own lowpass (a far thud, a recorded clap): the lower of it and the air's is set.</summary>
        public double SrcLp = double.PositiveInfinity;
        public double Level = 1, LevelT = 1, LevelTau = 0.5;
        public (double gain, double lp, double lx, double lz, double sx, double sz)? Occ;
        public readonly List<V> Voices = new();
        public int Pending;
        public bool Moved = true;
        public bool Counts => !Flat && !Raw;
    }

    private readonly List<Spot> spots = new();
    private int placedCount;
    private bool inRoom;

    private Spot NewSpot(double x, double y, double z, double refM, double rolloff, double reach, double wet, double cap, string outBus, double max, double occl = 1)
    {
        var sp = new Spot { X = x, Y = y, Z = z, Ref = refM, Rolloff = rolloff, Reach = reach, WetBase = wet, Cap = cap, Out = outBus, Max = max, Occl = occl };
        P0();
        TakeChan(sp);
        P1(0);
        P0();
        TuneSpot(sp, true);
        P1(1);
        P0();
        ApplyCut(sp);
        P1(0);
        spots.Add(sp);
        placedCount++;
        return sp;
    }

    /// <summary>A sound at the ear on a bus; `lowpass` 0: none; `wet`: its send to the outdoor reverb.</summary>
    private Spot FlatSpot(string outBus, double lowpass = 0, double wet = 0, bool highpass = false, bool hold = false)
    {
        var sp = new Spot { Flat = true, Out = outBus, WetBase = wet, Wet = wet, WetT = wet, Hold = hold, Hp = highpass, Cap = lowpass > 0 ? lowpass : 20500, Lp = lowpass > 0 ? lowpass : 20500 };
        sp.LpT = sp.Lp;
        P0();
        if (lowpass > 0 || highpass) TakeChan(sp);
        ApplyCut(sp);
        P1(0);
        spots.Add(sp);
        return sp;
    }

    /// <summary>Where the main-thread time of starting a sound goes, in ms (the self-test reports it).</summary>
    private readonly double[] prof = new double[5];
    private static readonly string[] ProfNames = { "bus", "tune", "player", "play", "volume" };
    private long profT;
    private void P0() => profT = System.Diagnostics.Stopwatch.GetTimestamp();
    private void P1(int i) => prof[i] += System.Diagnostics.Stopwatch.GetElapsedTime(profT).TotalMilliseconds;

    private void TakeChan(Spot sp)
    {
        if (freeChans.Count == 0) return; // (all 48 in use: it plays without its lowpass)
        var c = freeChans.Pop();
        sp.Chan = c;
        SendChan(sp);
        if (c.HpOn != sp.Hp)
        {
            AudioServer.SetBusEffectEnabled(c.Index, 1, sp.Hp);
            c.HpOn = sp.Hp;
        }
    }

    /// <summary>The place's lowpass on its bus (at once when the place is made: the bus still has its last user's).</summary>
    private static void ApplyCut(Spot sp)
    {
        if (sp.Chan == null) return;
        float cut = (float)Math.Clamp(Math.Min(sp.Lp, sp.SrcLp), 200, 20500);
        if (Math.Abs(cut - sp.Chan.Cut) <= sp.Chan.Cut * 0.01f) return;
        sp.Chan.Cut = cut;
        sp.Chan.Lp.CutoffHz = cut;
    }

    private void SendChan(Spot sp)
    {
        var c = sp.Chan;
        if (c == null || c.Send == sp.Out) return;
        AudioServer.SetBusSend(c.Index, busName[sp.Out]);
        c.Send = sp.Out;
    }

    private void MoveSpot(Spot sp, double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z)) return; // (a thing at no place for a frame: the sound stays where it was)
        sp.X = x;
        sp.Z = z;
        sp.Moved = true;
    }

    private void DropSpot(Spot sp)
    {
        if (sp.Dropped) return;
        sp.Dropped = true;
        for (int i = sp.Voices.Count - 1; i >= 0; i--) Release(sp.Voices[i]);
        sp.Voices.Clear();
        if (sp.Chan != null) freeChans.Push(sp.Chan);
        sp.Chan = null;
        if (spots.Remove(sp) && sp.Counts) placedCount--;
    }

    /// <summary>Fade a place out and drop it (the browser's stopVoice, and the stop of an event's sound).</summary>
    private void FadeDrop(Spot sp, double tau, double after)
    {
        sp.LevelT = 0;
        sp.LevelTau = tau;
        After(after, () => DropSpot(sp));
    }

    private void Release(V v)
    {
        if (v.P3 != null) { v.P3.Stop(); free3d.Push(v.P3); v.P3 = null; }
        if (v.W3 != null) { v.W3.Stop(); free3d.Push(v.W3); v.W3 = null; }
        if (v.P2 != null) { v.P2.Stop(); free2d.Push(v.P2); v.P2 = null; }
        if (v.W2 != null) { v.W2.Stop(); free2d.Push(v.W2); v.W2 = null; }
    }

    private AudioStreamPlayer3D Take3d()
    {
        if (free3d.Count > 0) return free3d.Pop();
        made3d++;
        // Godot's own distance curve is off (the gain by distance is ours: Web Audio's inverse with a rolloff);
        // no area checks, no Doppler, no distance filter. (The filter's dB must be 0: at its default -24 a quiet
        // player gets a high shelf that takes 3 dB off a sharp sound even with the cutoff at 20.5 kHz; the self-test's
        // "thud 2 m ahead" row found it.)
        var p = new AudioStreamPlayer3D { AttenuationModel = AudioStreamPlayer3D.AttenuationModelEnum.Disabled, MaxDb = 24, AreaMask = 0, AttenuationFilterCutoffHz = 20500, AttenuationFilterDb = 0, PanningStrength = PanStrength, MaxPolyphony = 1 };
        holder.AddChild(p);
        return p;
    }

    private AudioStreamPlayer Take2d()
    {
        if (free2d.Count > 0) return free2d.Pop();
        made2d++;
        var p = new AudioStreamPlayer { MaxPolyphony = 1 };
        flatHolder.AddChild(p);
        return p;
    }

    /// <summary>How hard Godot pans a 3D sound (1 on the player x 0.5 in the project by default). Set by the self-test's "pan right" row.</summary>
    private const float PanStrength = 2f;

    /// <summary>Add a stream to a place. `delay` s from now; `len` s it plays (real seconds), after which it is freed.</summary>
    private V Add(Spot sp, AudioStream stream, string what, double gain, double pitch = 1, double from = 0, double len = double.PositiveInfinity, double delay = 0, Env? env = null, double rawPeak = -1)
    {
        var v = new V { Stream = stream, What = what, Gain = gain, StreamScale = recordingScales.GetValueOrDefault(stream, 1), Pitch = pitch, From = from, Start = now + Math.Max(0, delay), Len = len, Env = env, RawPeak = rawPeak };
        sp.Voices.Add(v);
        sp.Had = true;
        if (delay <= 0) Begin(sp, v);
        return v;
    }

    private void Begin(Spot sp, V v)
    {
        frameSound = v.What;
        v.Started = true;
        v.Start = now;
        // (the gain by distance is right from the first sample: a place made this frame has not been through MixTick yet)
        if (!sp.Flat)
        {
            double d0 = DistTo(sp.X, sp.Y, sp.Z);
            sp.Pan = double.IsFinite(d0) ? Inverse(d0, sp.Ref, sp.Rolloff) * PanMakeup : 0;
        }
        bool wet = sp.WetBase > 0 && !sp.Raw;
        StringName bus = sp.Chan?.Name ?? busName[sp.Out];
        P0();
        if (sp.Flat)
        {
            v.P2 = Take2d();
            Set(v.P2, v, bus);
            if (wet) Set(v.W2 = Take2d(), v, busName[sp.WetBus]);
        }
        else
        {
            var at = new Vector3((float)sp.X, (float)sp.Y, (float)sp.Z);
            v.P3 = Take3d();
            v.P3.Position = at;
            Set3(v.P3, v, bus);
            if (wet)
            {
                v.W3 = Take3d();
                v.W3.Position = at;
                Set3(v.W3, v, busName[sp.WetBus]);
            }
        }
        P1(2);
        P0();
        Volumes(sp, v, true);
        P1(4);
        P0();
        float from = (float)v.From;
        v.P2?.Play(from);
        v.W2?.Play(from);
        v.P3?.Play(from);
        v.W3?.Play(from);
        P1(3);
        if (test != null)
        {
            long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
            test.Started(sp, v);
            testMs += System.Diagnostics.Stopwatch.GetElapsedTime(t0).TotalMilliseconds;
        }
    }

    private static void Set(AudioStreamPlayer p, V v, StringName bus)
    {
        p.Stream = v.Stream;
        p.PitchScale = (float)v.Pitch;
        p.Bus = bus;
    }

    private static void Set3(AudioStreamPlayer3D p, V v, StringName bus)
    {
        p.Stream = v.Stream;
        p.PitchScale = (float)v.Pitch;
        p.Bus = bus;
    }

    private double VoiceGain(Spot sp, V v) => v.Gain * v.StreamScale * (v.Env?.At(now - v.Start) ?? 1) * v.Level * sp.Level * sp.Fog * sp.Pan;

    private void Volumes(Spot sp, V v, bool first = false)
    {
        double g = VoiceGain(sp, v);
        float db = Db(g);
        if (first || Math.Abs(db - v.LastDb) > 0.05f)
        {
            v.LastDb = db;
            if (v.P3 != null) v.P3.VolumeDb = db;
            if (v.P2 != null) v.P2.VolumeDb = db;
        }
        if (v.W3 == null && v.W2 == null) return;
        // The second player bypasses the dry category bus. Give its echo that category's setting too.
        float wdb = Db(g * sp.Wet * wetLevels.GetValueOrDefault(sp.Out, 1));
        if (first || Math.Abs(wdb - v.LastWetDb) > 0.05f)
        {
            v.LastWetDb = wdb;
            if (v.W3 != null) v.W3.VolumeDb = wdb;
            if (v.W2 != null) v.W2.VolumeDb = wdb;
        }
    }

    /// <summary>Web Audio's inverse distance model.</summary>
    private static double Inverse(double d, double refM, double rolloff) => refM / (refM + rolloff * (Math.Max(d, refM) - refM));

    private static double Toward(double cur, double target, double tau, double dt) => Math.Abs(target - cur) < 1e-6 ? target : target + (cur - target) * Math.Exp(-dt / Math.Max(1e-3, tau));

    /// <summary>Every frame: the places follow the ear, the voices their envelopes; what has ended is freed.</summary>
    private void MixTick(double dt)
    {
        for (int s = spots.Count - 1; s >= 0; s--)
        {
            var sp = spots[s];
            sp.Level = Toward(sp.Level, sp.LevelT, sp.LevelTau, dt);
            if (!sp.Flat)
            {
                double d = DistTo(sp.X, sp.Y, sp.Z);
                sp.Pan = double.IsFinite(d) ? Inverse(d, sp.Ref, sp.Rolloff) * PanMakeup : 0;
                if (!sp.Raw)
                {
                    sp.Fog = Toward(sp.Fog, sp.FogT, 0.4, dt);
                    sp.Wet = Toward(sp.Wet, sp.WetT, 0.4, dt);
                    sp.Lp = Toward(sp.Lp, sp.LpT, 0.4, dt);
                }
            }
            ApplyCut(sp);
            Vector3 at = default;
            if (sp.Moved && !sp.Flat) at = new Vector3((float)sp.X, (float)sp.Y, (float)sp.Z);
            for (int i = sp.Voices.Count - 1; i >= 0; i--)
            {
                var v = sp.Voices[i];
                if (!v.Started)
                {
                    if (now >= v.Start) Begin(sp, v);
                    continue;
                }
                if (now - v.Start >= v.Len || (v.P3 != null && !v.P3.Playing) || (v.P2 != null && !v.P2.Playing))
                {
                    Release(v);
                    sp.Voices.RemoveAt(i);
                    v.OnEnd?.Invoke();
                    if (sp.Dropped) break;
                    continue;
                }
                v.Level = Toward(v.Level, v.LevelT, v.LevelTau, dt);
                if (sp.Moved && !sp.Flat)
                {
                    v.P3!.Position = at;
                    if (v.W3 != null) v.W3.Position = at;
                }
                Volumes(sp, v);
            }
            sp.Moved = false;
            if (!sp.Dropped && !sp.Hold && sp.Had && sp.Voices.Count == 0 && sp.Pending == 0) DropSpot(sp);
        }
    }

    /// <summary>Four times a second: the air lowpass, the fog loss and the reverb send by distance and weather (the browser's tuneSpot).</summary>
    private void TuneSpot(Spot sp, bool first)
    {
        if (sp.Flat || sp.Raw) return;
        double d = DistTo(sp.X, sp.Y, sp.Z);
        if (!double.IsFinite(d)) return;
        var l = listenerPos;
        var occ = sp.Occ;
        if (occ == null || Math.Abs(occ.Value.lx - l.X) + Math.Abs(occ.Value.lz - l.Z) > 1.5 || Math.Abs(occ.Value.sx - sp.X) + Math.Abs(occ.Value.sz - sp.Z) > 1.5)
        {
            var (g, lpk) = Occlusion(sp.X, sp.Z, sp.Occl);
            occ = sp.Occ = (g, lpk, l.X, l.Z, sp.X, sp.Z);
        }
        sp.LpT = Math.Max(200, Math.Min(sp.Cap, AirLp(d, sp.Reach, sp.Dull)) * occ.Value.lp);
        // the audible radius: fades out from 0.6 of it, silent beyond; and what stands in the way
        double edge = double.IsFinite(sp.Max) ? 1 - Ramp(d, sp.Max * 0.6, sp.Max) : 1;
        sp.FogT = FogLoss(d) * edge * occ.Value.gain;
        // far off, more of what you hear is the echo off the fog and the walls
        sp.WetT = sp.WetBase * (0.6 + 1.4 * Ramp(d, 20, 400));
        if (first)
        {
            (sp.Lp, sp.Fog, sp.Wet) = (sp.LpT, sp.FogT, sp.WetT);
            sp.Pan = Inverse(d, sp.Ref, sp.Rolloff) * PanMakeup;
        }
    }

    // ------------------------------------------------------------------ made sounds: from a graph to a player

    // Publish fully initialized nodes. ConcurrentQueue.TryDequeue can spin behind a producer that has reserved
    // a slot but not published it yet; a preempted render worker must never make the frame thread wait.
    private sealed class ReadyQueue
    {
        private sealed class Work
        {
            public readonly Action Fn;
            public Work? Next;
            public Work(Action fn) => Fn = fn;
        }
        private Work? published, pending;
        public void Enqueue(Action fn)
        {
            var work = new Work(fn);
            Work? before;
            do
            {
                before = Volatile.Read(ref published);
                work.Next = before;
            } while (Interlocked.CompareExchange(ref published, work, before) != before);
        }
        // One consumer (the frame thread). Reverse each detached batch to preserve publication order.
        // No lock, spin or wait on a producer on this side; a not-yet-published callback waits for another frame.
        public bool TryDequeue(out Action fn)
        {
            if (pending == null)
            {
                var batch = Interlocked.Exchange(ref published, null);
                while (batch != null)
                {
                    var next = batch.Next;
                    batch.Next = pending;
                    pending = batch;
                    batch = next;
                }
            }
            if (pending == null) { fn = null!; return false; }
            fn = pending.Fn;
            pending = pending.Next;
            return true;
        }
    }
    private readonly ReadyQueue ready = new();
    private int mixRate = 44100;
    /// <summary>Renders asked for and not yet in (dev: Graph).</summary>
    private int rendering;

    private Wa NewCtx() => new(mixRate) { SampleSeconds = name => buf.TryGetValue(name, out var s) ? s.GetLength() : -1 };

    /// <summary>A rendered buffer as a stream: silence trimmed off the end, scaled to nearly full level (`scale` gives the true level back).</summary>
    private static (AudioStreamWav? stream, double scale, double seconds, double peak) ToWav(float[] d, int rate, bool loop = false)
    {
        int n = d.Length;
        float peak = 0;
        for (int i = 0; i < n; i++) peak = Math.Max(peak, Math.Abs(d[i]));
        if (!(peak > 1e-6f) || !float.IsFinite(peak)) return (null, 0, 0, 0);
        if (!loop)
        {
            float floor = Math.Max(peak * 3e-4f, 1e-6f);
            while (n > 256 && Math.Abs(d[n - 1]) < floor) n--;
            n = Math.Min(d.Length, n + 64);
        }
        var bytes = new byte[n * 2];
        float k = 0.95f * 32767 / peak;
        for (int i = 0; i < n; i++)
        {
            short s = (short)Math.Round(d[i] * k);
            bytes[i * 2] = (byte)s;
            bytes[i * 2 + 1] = (byte)(s >> 8);
        }
        var w = new AudioStreamWav { Format = AudioStreamWav.FormatEnum.Format16Bits, MixRate = rate, Stereo = false, Data = bytes };
        if (loop)
        {
            w.LoopMode = AudioStreamWav.LoopModeEnum.Forward;
            w.LoopBegin = 0;
            w.LoopEnd = n;
        }
        return (w, peak / 0.95, (double)n / rate, peak);
    }

    /// <summary>
    /// Build and render a made sound's graph on a worker. Start its recordings at the original requested times
    /// when the graph is ready, and its buffer when rendered. `built` receives the maker's length on the main thread.
    /// </summary>
    private void MadeAt(Spot sp, Make make, string what, double gain = 1, double tail = 0.1, double delay = 0, Action<double>? built = null)
    {
        frameSound = what;
        sp.Pending++;
        rendering++;
        double t0 = now;
        Task.Run(() =>
        {
            (AudioStreamWav? stream, double scale, double seconds, double peak) r = default;
            try
            {
                // Graph construction allocates nodes and timelines too, so it belongs beside rendering.
                var c = NewCtx();
                double len = make(c, c.Destination, 0);
                if (built != null || c.Extras.Count > 0) ready.Enqueue(() =>
                {
                    if (sp.Dropped) return;
                    built?.Invoke(len);
                    foreach (var e in c.Extras)
                    {
                        if (!buf.TryGetValue(e.Sample, out var s)) continue;
                        double real = Math.Min(e.Secs, Math.Max(0, s.GetLength() - e.From)) / e.Rate;
                        if (real <= 0) continue;
                        double f = Math.Min(e.Fade, real / 2);
                        var env = f > 0 ? new Env((0, 0), (f, 1), (Math.Max(f, real - f), 1), (real, 0)) : null;
                        if (e.Lowpass > 0) sp.SrcLp = Math.Min(sp.SrcLp, e.Lowpass);
                        Add(sp, s, e.Sample, gain * e.Gain, e.Rate, e.From, real, Math.Max(0, delay + e.At - (now - t0)), env);
                    }
                });
                if (c.Destination.HasInputs) r = ToWav(c.Render(len + tail), c.Rate);
            }
            catch (Exception e)
            {
                GD.PrintErr($"[sound] {what}: {e.Message}");
            }
            ready.Enqueue(() =>
            {
                rendering--;
                sp.Pending--;
                if (sp.Dropped || r.stream == null) return;
                Add(sp, r.stream, what, gain * r.scale, 1, 0, r.seconds + 0.02, Math.Max(0, delay - (now - t0)), null, r.peak);
            });
        });
    }

    /// <summary>A bed that never changes, rendered once as a loop: `seconds` long, the last second crossfaded into the first.</summary>
    private static (AudioStreamWav stream, double scale) RenderLoop(Func<Wa, double> build, int rate, double seconds)
    {
        var c = new Wa(rate);
        build(c);
        const double fade = 1;
        var all = c.Render(seconds + fade);
        int n = (int)(seconds * rate), nf = (int)(fade * rate);
        var loop = new float[n];
        Array.Copy(all, loop, n);
        for (int i = 0; i < nf && n + i < all.Length; i++)
        {
            float k = (float)i / nf;
            loop[i] = loop[i] * k + all[n + i] * (1 - k);
        }
        var w = ToWav(loop, rate, true);
        return (w.stream!, w.scale);
    }

    // ------------------------------------------------------------------ timers (the browser's setTimeout)

    private sealed class Timer
    {
        public double At;
        public Action Fn = null!;
        public bool Dead;
    }
    private readonly List<Timer> timers = new();

    private Timer After(double seconds, Action fn)
    {
        var t = new Timer { At = now + seconds, Fn = fn };
        timers.Add(t);
        return t;
    }

    private void RunTimers()
    {
        for (int i = timers.Count - 1; i >= 0; i--)
        {
            var t = timers[i];
            if (!t.Dead && now < t.At) continue;
            timers.RemoveAt(i);
            if (!t.Dead) t.Fn();
        }
    }
}
